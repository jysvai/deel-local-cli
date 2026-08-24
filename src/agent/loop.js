// 에이전트 루프. 모델 → 도구 → 결과 → 모델 을 답이 나올 때까지 돈다.
// 화면에 그릴 것은 이벤트로 흘려보낸다 — 화면 코드와 섞지 않는다.
import { chat, chatStream, assistantMessage, toolMessage } from '../backend/adapter.js';
import { toolSchemas, runTool, TOOLS } from '../tools/index.js';
import { isMutating } from '../safety/guard.js';
import { effortFor, tokensFor, fullCap, wasCut } from './effort.js';
import { compact, shouldCompact } from './compact.js';
import { isOffline } from '../safety/network.js';

// think 값을 규격에 맞게. 'off' 는 사고를 끈다.
function thinkFor(conn, level) {
  if (level === 'off') return conn.kind === 'ollama' ? false : undefined;
  return level;
}

export async function* run(session, ctx, userText) {
  session.push({ role: 'user', content: userText });
  ctx.audit.turn(userText);
  ctx.history.nextTurn();

  const conn = session.conn;
  const tools = toolSchemas(null, {
    hasSkills: (session.skills?.length ?? 0) > 0,
    web: session.web !== false && !isOffline(),   // 오프라인이면 웹 도구는 아예 안 보여 준다
  });
  const attempted = new Set();   // 같은 변경성 명령을 두 번 실행하지 않기 위한 기록
  let steps = 0;
  let lastToolFailed = false;    // 직전 단계에서 도구가 오류를 냈나 → 다음 판단은 세게

  while (steps < session.maxSteps) {
    steps++;
    // 단계마다 필요한 생각의 양이 다르다. effort.js 가 그 배분을 갖고 있다.
    const stage = steps === 1 ? 'plan' : lastToolFailed ? 'fix' : 'work';
    const level = effortFor(session.think, session.effort, stage);
    // 상한은 모델 컨텍스트와 지금 찬 양에서 계산한다. 고정 숫자가 아니다.
    const room = { ctx: conn.ctx ?? 0, used: session.breakdown().used, max: conn.maxTokens ?? null };
    const cap = tokensFor(session.effort, stage, room);
    yield { type: 'stage', stage, level, cap, step: steps };

    const ask = (maxTokens, think) => ({
      messages: session.wire(),
      tools,
      think: thinkFor(conn, think),
      maxTokens,
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

    // 도구를 순서대로 실행한다.
    lastToolFailed = false;
    for (const call of msg.toolCalls) {
      if (!TOOLS[call.name]) {
        lastToolFailed = true;
        session.push(toolMessage(conn.kind, {
          callId: call.id, name: call.name,
          content: `모르는 도구입니다. 쓸 수 있는 것: ${Object.keys(TOOLS).join(', ')}`,
        }));
        yield { type: 'tool', name: call.name, args: call.args, result: { error: '모르는 도구' } };
        continue;
      }

      // 변경성 명령은 실패해도 다시 실행하지 않는다 — 두 번 돌면 사고다.
      if (call.name === 'Bash' && isMutating(call.args?.command)) {
        const key = String(call.args.command).trim();
        if (attempted.has(key)) {
          lastToolFailed = true;
          const note = '같은 변경성 명령을 다시 실행하지 않습니다. 두 번 실행되면 사고가 납니다.';
          session.push(toolMessage(conn.kind, { callId: call.id, name: call.name, content: note }));
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
          lastToolFailed = true;
          const note = '사용자가 거부했습니다. 다른 방법을 찾거나 이유를 물어보세요.';
          session.push(toolMessage(conn.kind, { callId: call.id, name: call.name, content: note }));
          yield { type: 'tool', name: call.name, args: call.args, result: { error: '거부됨' } };
          continue;
        }
      }

      yield { type: 'tool_start', name: call.name, args: call.args };
      const t0 = Date.now();
      const result = await runTool(call.name, call.args, ctx);
      const ms = Date.now() - t0;
      session.usage.ms += ms;

      if (result.error) lastToolFailed = true;
      if (call.name === 'Read' && result.content) session.noteRead(call.args.file_path, result.content);

      session.push(toolMessage(conn.kind, {
        callId: call.id,
        name: call.name,
        content: result.error ? `오류: ${result.error}` : result.content ?? '',
      }));
      yield { type: 'tool', name: call.name, args: call.args, result, ms };
    }

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
