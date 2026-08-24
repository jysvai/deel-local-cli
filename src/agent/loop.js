// 에이전트 루프. 모델 → 도구 → 결과 → 모델 을 답이 나올 때까지 돈다.
// 화면에 그릴 것은 이벤트로 흘려보낸다 — 화면 코드와 섞지 않는다.
import { chat, chatStream, assistantMessage, toolMessage } from '../backend/adapter.js';
import { toolSchemas, runTool, TOOLS } from '../tools/index.js';
import { isMutating } from '../safety/guard.js';
import { effortFor, tokensFor, fullCap, wasCut } from './effort.js';
import { compact, shouldCompact } from './compact.js';
import { isOffline } from '../safety/network.js';
import { get as workMode } from './modes.js';

// think 값을 규격에 맞게. 'off' 는 사고를 끈다.
function thinkFor(conn, level) {
  if (level === 'off') return conn.kind === 'ollama' ? false : undefined;
  return level;
}

// 아무것도 안 바꾸는 도구들. 이것들만 동시에 돌린다.
//
// 왜 이것만인가:
//   Read 세 개를 동시에 하는 것은 안전하다 — 서로 안 건드린다.
//   Write·Edit 을 동시에 돌리면 같은 파일을 두 갈래로 고칠 수 있고,
//   되돌리기 스냅샷 순서도 뒤엉킨다. Bash 는 무슨 짓을 할지 알 수 없다.
//   그래서 '읽기만 하는 것' 이라고 확실한 도구만 묶는다.
const 읽기전용 = new Set(['Read', 'Glob', 'Grep', 'Skill', 'WebFetch']);

/**
 * 호출 목록을 '같이 돌려도 되는 덩어리' 로 자른다.
 * 읽기 전용이 이어지면 한 덩어리, 그 밖의 것은 하나씩 따로.
 */
export function 묶기(calls) {
  const out = [];
  for (const call of calls) {
    const 안전 = 읽기전용.has(call.name);
    const 끝 = out.at(-1);
    if (안전 && 끝?.parallel) 끝.calls.push(call);
    else out.push({ parallel: 안전, calls: [call] });
  }
  return out;
}

export async function* run(session, ctx, userText, { signal = null } = {}) {
  session.push({ role: 'user', content: userText });
  ctx.audit.turn(userText);
  ctx.history.nextTurn();

  const conn = session.conn;

  /**
   * 중단하고 나갈 때 대화를 성한 상태로 남긴다.
   *
   * 모델이 도구를 부르겠다고 해 놓고 결과가 안 들어간 채로 끝나면, 다음에 이어할 때
   * 그 배열을 그대로 보낼 수 없다 — 서버가 400 을 낸다. 그래서 부른 만큼
   * '중단됨' 결과를 채워 짝을 맞춘다.
   */
  const 짝맞추기 = () => {
    const last = session.messages.at(-1);
    const calls = last?.tool_calls ?? [];
    if (!calls.length) return;
    const 이미 = session.messages.filter((m) => m.role === 'tool').length;
    for (const t of calls) {
      session.push(toolMessage(conn.kind, {
        callId: t.id ?? `call_${이미 + 1}`,
        name: t.function?.name ?? t.name ?? '?',
        content: '사용자가 중단했습니다. 실행하지 않았습니다.',
      }));
    }
  };
  const tools = toolSchemas(null, {
    hasSkills: (session.skills?.length ?? 0) > 0,
    web: session.web !== false && !isOffline(),   // 오프라인이면 웹 도구는 아예 안 보여 준다
    work: session.work,                           // 작업 모드가 쓰는 것만 (modes.js)
  });
  // 모드마다 생각의 배분과 걸음 수가 다르다. 사용자가 따로 정했으면 그걸 존중한다.
  const 모드 = workMode(session.work);
  const effort = session.effortSet ? session.effort : (모드.effort ?? session.effort);
  const think = session.thinkSet ? session.think : (모드.think ?? session.think);
  const maxSteps = session.stepsSet ? session.maxSteps : (모드.steps ?? session.maxSteps);
  const attempted = new Set();   // 같은 변경성 명령을 두 번 실행하지 않기 위한 기록
  let steps = 0;
  let lastToolFailed = false;    // 직전 단계에서 도구가 오류를 냈나 → 다음 판단은 세게

  while (steps < maxSteps) {
    steps++;
    // 단계마다 필요한 생각의 양이 다르다. effort.js 가 그 배분을 갖고 있다.
    const stage = steps === 1 ? 'plan' : lastToolFailed ? 'fix' : 'work';
    const level = effortFor(think, effort, stage);
    // 상한은 모델 컨텍스트와 지금 찬 양에서 계산한다. 고정 숫자가 아니다.
    const room = { ctx: conn.ctx ?? 0, used: session.breakdown().used, max: conn.maxTokens ?? null };
    const cap = tokensFor(effort, stage, room);
    yield { type: 'stage', stage, level, cap, step: steps };

    const ask = (maxTokens, think) => ({
      messages: session.wire(),
      tools,
      think: thinkFor(conn, think),
      maxTokens,
      signal,
    });

    let msg;
    const askModel = async function* (maxTokens, think) {
      if (conn.streaming) {
        for await (const ev of chatStream(conn, ask(maxTokens, think))) {
          if (ev.type === 'done') msg = ev.message;
          else yield ev;
        }
      } else {
        yield { type: 'waiting' };
        msg = await chat(conn, ask(maxTokens, think));
        if (msg.thinking) yield { type: 'thinking', text: msg.thinking };
        if (msg.content) yield { type: 'content', text: msg.content };
      }
    };

    try {
      yield* askModel(cap, level);

      // 아낀 상한 때문에 대답이 잘렸다면, 그 단계만 상한을 풀어 한 번 다시 부른다.
      // 잘린 채로 넘어가면 도구 호출이 반토막 나서 조용히 실패한다 —
      // 생각을 많이 하는 모델에서 특히 잘 생긴다.
      const full = fullCap(room);
      if (wasCut(msg) && cap < full) {
        yield { type: 'retry', why: '대답이 상한에서 잘렸습니다', from: cap, to: full };
        yield* askModel(full, level);
      }
    } catch (err) {
      if (err?.name === 'Aborted' || signal?.aborted) {
        짝맞추기();
        yield { type: 'aborted', steps };
        return;
      }
      yield { type: 'error', text: err.message };
      return;
    }

    session.usage.in += msg.usage?.in ?? 0;
    session.usage.out += msg.usage?.out ?? 0;
    session.usage.calls++;

    session.push(assistantMessage(conn.kind, msg));

    if (!msg.toolCalls?.length) {
      yield { type: 'done', steps, text: msg.content };
      return;
    }

    // 도구를 돌린다. 읽기만 하는 것들이 이어지면 한꺼번에, 나머지는 하나씩.
    lastToolFailed = false;
    const 거절 = (call, note) => {
      lastToolFailed = true;
      session.push(toolMessage(conn.kind, { callId: call.id, name: call.name, content: note }));
    };

    for (const 덩어리 of 묶기(msg.toolCalls)) {
      // 돌리는 중에 끊었다면, 남은 것은 실행하지 않고 결과 자리만 채운다.
      // 자리를 비우면 짝이 깨져 다음에 이어할 수 없다.
      if (signal?.aborted) {
        for (const call of 덩어리.calls) {
          session.push(toolMessage(conn.kind, {
            callId: call.id, name: call.name,
            content: '사용자가 중단했습니다. 실행하지 않았습니다.',
          }));
        }
        continue;
      }

      // 먼저 하나씩 걸러 낸다 — 물어보는 것도 여기서. 실제 실행은 통과한 것만.
      const 실행할것 = [];
      for (const call of 덩어리.calls) {
        if (!TOOLS[call.name]) {
          거절(call, `모르는 도구입니다. 쓸 수 있는 것: ${Object.keys(TOOLS).join(', ')}`);
          yield { type: 'tool', name: call.name, args: call.args, result: { error: '모르는 도구' } };
          continue;
        }

        // 변경성 명령은 실패해도 다시 실행하지 않는다 — 두 번 돌면 사고다.
        if (call.name === 'Bash' && isMutating(call.args?.command)) {
          const key = String(call.args.command).trim();
          if (attempted.has(key)) {
            const note = '같은 변경성 명령을 다시 실행하지 않습니다. 두 번 실행되면 사고가 납니다.';
            거절(call, note);
            yield { type: 'tool', name: call.name, args: call.args, result: { error: note } };
            continue;
          }
          attempted.add(key);
        }

        // 모드에 따라 물어본다. 기본(auto)은 안 묻고 되돌리기로 대응한다.
        const needsOk = session.mode === 'strict'
          ? ['Write', 'Edit', 'Bash'].includes(call.name)
          : session.mode === 'confirm'
            ? (call.name === 'Bash' && isMutating(call.args?.command))
            : false;
        if (needsOk && ctx.confirm) {
          const ok = await ctx.confirm(call.name, call.args);
          if (!ok) {
            거절(call, '사용자가 거부했습니다. 다른 방법을 찾거나 이유를 물어보세요.');
            yield { type: 'tool', name: call.name, args: call.args, result: { error: '거부됨' } };
            continue;
          }
        }
        실행할것.push(call);
      }
      if (!실행할것.length) continue;

      // 여럿을 같이 돌릴 때는 '시작' 을 따로 알리지 않는다.
      // 화면에서 이름 셋이 먼저 뜨고 결과 셋이 뒤에 몰려 붙으면, 어느 결과가
      // 어느 파일 것인지 읽을 수 없다. 그럴 때는 끝난 것부터 이름과 결과를 함께 그린다.
      const 함께 = 실행할것.length > 1;
      if (!함께) yield { type: 'tool_start', name: 실행할것[0].name, args: 실행할것[0].args };
      else yield { type: 'tools_start', names: 실행할것.map((x) => x.name), count: 실행할것.length };

      const 한개 = async (call) => {
        const t0 = Date.now();
        let result;
        try { result = await runTool(call.name, call.args, ctx); }
        catch (err) { result = { error: String(err?.message ?? err) }; }
        return { call, result, ms: Date.now() - t0 };
      };

      // 여럿이면 동시에. 읽기만 하는 것들이라 서로 방해하지 않는다.
      const 결과들 = 함께
        ? await Promise.all(실행할것.map(한개))
        : [await 한개(실행할것[0])];

      for (const { call, result, ms } of 결과들) {
        session.usage.ms += ms;
        if (result.error) lastToolFailed = true;
        if (call.name === 'Read' && result.content) session.noteRead(call.args.file_path, result.content);
        session.push(toolMessage(conn.kind, {
          callId: call.id,
          name: call.name,
          content: result.error ? `오류: ${result.error}` : result.content ?? '',
        }));
        yield { type: 'tool', name: call.name, args: call.args, result, ms, parallel: 함께 };
      }
    }

    if (signal?.aborted) { yield { type: 'aborted', steps }; return; }

    // 컨텍스트가 차오르면 오래된 대화를 '요약해서' 접는다. 그냥 자르면 하던 일을 잊는다.
    if (shouldCompact(session)) {
      yield { type: 'compacting' };
      const r = await compact(session, { auto: true });
      if (r.ok) yield { type: 'compacted', ...r };
      else yield { type: 'compact_failed', why: r.why };
    }
  }

  yield { type: 'limit', steps };
}
