// 에이전트 루프. 모델 → 도구 → 결과 → 모델 을 답이 나올 때까지 돈다.
// 화면에 그릴 것은 이벤트로 흘려보낸다 — 화면 코드와 섞지 않는다.
import { chat, chatStream, assistantMessage, toolMessage } from '../backend/adapter.js';
import { toolSchemas, runTool, TOOLS, 파일현황 } from '../tools/index.js';
import { isMutating } from '../safety/guard.js';
import { effortFor, tokensFor, fullCap, wasCut, shiftLevel } from './effort.js';
import { 살린쓰기 } from './salvage.js';
import { 배울것, 길이문제인가 } from '../backend/learn.js';
import { compact, shouldCompact } from './compact.js';
import { 걸음수 } from './budget.js';
import { isOffline } from '../safety/network.js';
import { get as workMode } from './modes.js';

/**
 * 아무 내용도 없는 답인가.
 *
 * 글도 없고 도구 호출도 없으면 아무 일도 안 일어난 것이다. 이걸 '성공' 으로
 * 넘기면 화면에 걸린 시간만 찍히고 끝난다 — 오류도 없으니 사용자는 무엇이
 * 잘못됐는지 알 길이 없다. 생각(thinking)만 있는 것도 마찬가지다.
 */
function 빈답인가(msg) {
  if (!msg) return true;
  if ((msg.toolCalls ?? []).length) return false;
  return !String(msg.content ?? '').trim();
}

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

  /*
   * 중단 신호를 도구도 볼 수 있게 여기 걸어 둔다.
   *
   * 없으면 Ctrl+C 가 '도는 도구' 를 못 멈춘다 — 루프는 끊겼는데 Bash 가 띄운
   * 프로세스는 계속 돌고, 화면은 `▶ Bash(npm run dev)` 에서 멈춘 채다.
   * 터미널을 닫는 수밖에 없었다.
   *
   * ctx 를 복사해서 넘기지 않고 그대로 두는 데는 이유가 있다. Read 가 알아낸
   * 인코딩을 ctx.enc 에 적어 두고 Edit 이 그걸 본다. 복사본에 적으면 그 기억이
   * 사라져서, 사내 CP949 문서가 한 번 고치는 것만으로 UTF-8 이 되어 버린다.
   */
  ctx.signal = signal;

  const conn = session.conn;

  /**
   * 같은 실패가 되풀이되는지 센다.
   *
   * 모델은 같은 것을 다시 해도 다른 결과가 나올 거라고 믿는 쪽으로 잘 기운다.
   * 특히 오류 문구가 원인을 안 짚어 줄 때 그렇다. 그러면 걸음 수 상한에 닿을
   * 때까지 같은 호출을 반복하는데, 그동안 컨텍스트는 계속 차오르고 사람은
   * 화면만 보며 기다린다. 71초 동안 열세 번을 부르고 아무것도 안 만든 적이 있다.
   *
   * 걸음 수 상한(maxSteps)으로는 못 막는다 — 그건 '잘 되고 있는 긴 작업' 과
   * '헛도는 작업' 을 구분하지 못한다. 여기서는 같은 자리를 반복하는 것만 본다.
   */
  const 막힘 = new Map();
  const MAX_SAME = 3;
  let 멈출까 = null;
  const 막힘셈 = (call, 이유) => {
    // 파일 하나가 아니라 **그 파일** 을 센다. 이름만 세면 서로 다른 파일 세 개를
    // 고치다 실패한 것이 한 덩어리로 뭉쳐 턴이 죽는다. 다섯 군데 중 두 군데만
    // 고쳐 놓고 '헛돌고 있어 멈췄습니다' 가 되는 것이 그 모습이다.
    const 어디 = call.args?.file_path ?? call.args?.path ?? call.args?.pattern ?? call.args?.command ?? '';
    const 서명 = `${call.name}|${이유}|${String(어디).slice(0, 200)}`;
    const n = (막힘.get(서명) ?? 0) + 1;
    막힘.set(서명, n);
    return n >= MAX_SAME;
  };

  /**
   * 일이 나아갔다고 표시한다.
   *
   * 잘린 것을 살려 파일이 자라는 중이면 헛도는 게 아니다. 그런데 겉모습은 똑같다 —
   * 같은 도구를, 같은 파일에, 여러 번 부른다. 그 표시만 보고 막으면 세 번째
   * 이어붙이기에서 턴이 죽고, 파일은 또 반쪽으로 남는다.
   * 그래서 '나아가고 있다' 는 사실이 확인되면 셈을 되돌린다.
   */
  const 나아감 = () => 막힘.clear();

  /**
   * 이번 턴에 손댄 파일들. 턴이 끝날 때 **디스크를 보고** 사실을 말해 준다.
   *
   * 모델은 도구가 실패해도 "만들었습니다" 로 답을 맺는 일이 있다. 화면에는
   * 그 말만 남고, 사용자는 믿고 다음 일로 넘어간다 — 파일은 없는데.
   * 말이 아니라 파일을 보고 확인해야 그 틈이 안 생긴다.
   */
  const 손댄파일 = new Set();
  const 마무리 = () => [...손댄파일].map(파일현황);

  // 살려 쓴 파일이 지난번보다 실제로 커졌는지 보려고 크기를 기억해 둔다.
  const 살린크기 = new Map();

  // 이번 턴에 서버에게서 한계를 배웠나. 배웠는데도 또 거절당하면 다른 문제다 —
  // 그때는 끝없이 다시 부르지 않고 오류를 그대로 보여 준다.
  let 배운적 = false;
  const 짧게말 = (s) => String(s ?? '').replace(/\s+/g, ' ').slice(0, 200);

  /**
   * 이미 부른 것을 똑같이 또 부르는지 본다.
   *
   * 실패만 세면 이 자리를 못 잡는다. 실제 화면에 이렇게 찍혔다 —
   *   ☰ TodoWrite(3건)   같은 목록, 다섯 번
   *   ❋ Glob(**\/*)  4개  같은 패턴, 네 번
   * 전부 '성공' 이다. 그런데 아무것도 안 나아가고, 같은 결과가 매번 컨텍스트에
   * 한 벌씩 더 쌓인다. 파일 목록 하나가 네 번 들어가면 그만큼 밀려난다.
   *
   * 그래서 두 번째부터는 결과를 다시 안 싣는다 — 짧게 '앞에서 부른 것과 같다'
   * 고만 알려 준다. 짝은 맞아야 하니 답 자체는 반드시 보낸다.
   *
   * 결과가 달라졌으면 그대로 싣는다. 고치고 나서 다시 읽는 것은 정상이다.
   */
  const 부른것 = new Map();
  const 서명만들기 = (call) => {
    try { return `${call.name}(${JSON.stringify(call.args ?? {})})`; }
    catch { return `${call.name}(?)`; }
  };

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
    work: session.effectiveWork(),                // 작업 모드가 쓰는 것만 (modes.js)
    // 밖에서 붙인 도구(MCP). 붙은 것이 없으면 아무것도 안 는다.
    mcp: ctx.mcp ?? null,
  });
  // 모드마다 생각의 배분과 걸음 수가 다르다. 사용자가 따로 정했으면 그걸 존중한다.
  const 모드 = workMode(session.effectiveWork());
  const effort = session.effortSet ? session.effort : (모드.effort ?? session.effort);
  const think = session.thinkSet ? session.think : (모드.think ?? session.think);
  /*
   * 걸음 수 상한은 **모델에 맞춰** 정한다 (budget.js).
   *
   * 전에는 모드마다 숫자가 박혀 있었다(코드 24회). 그 값이 맞는 모델은 하나도
   * 없다 — 8k 모델에는 너무 크고, 655k 모델은 여유가 96% 남았는데도 만들다
   * 만 채로 끊겼다. 사람이 직접 준 값이 있으면 그것이 먼저다.
   */
  const maxSteps = session.stepsSet ? session.maxSteps : 걸음수(모드.id, conn.ctx);
  const attempted = new Set();   // 같은 변경성 명령을 두 번 실행하지 않기 위한 기록
  let steps = 0;
  let lastToolFailed = false;    // 직전 단계에서 도구가 오류를 냈나 → 다음 판단은 세게

  while (steps < maxSteps) {
    steps++;
    // 단계마다 필요한 생각의 양이 다르다. effort.js 가 그 배분을 갖고 있다.
    const stage = steps === 1 ? 'plan' : lastToolFailed ? 'fix' : 'work';
    const level = effortFor(think, effort, stage);
    // 상한은 모델 컨텍스트와 지금 찬 양에서 계산한다. 고정 숫자가 아니다.
    // 출력 상한을 아는 값이 둘 있다 — 사용자가 정한 것(/out)과 서버에서 알아낸 것.
    // 사람이 정한 것이 먼저다. 둘 다 없으면 null 이고, 그때만 effort.js 의 MAX_CAP 에 선다.
    const room = { ctx: conn.ctx ?? 0, used: session.breakdown().used, max: conn.maxTokens ?? conn.maxOut ?? null };
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
    // 흘러온 글을 우리도 모아 둔다. 중간에 끊기면 이것만이 남는 전부다 —
    // chatStream 은 끝까지 가야 message 를 주므로, 끊긴 순간에는 msg 가 비어 있다.
    let 흘린것 = '';
    const askModel = async function* (maxTokens, think, { 한번에 = false } = {}) {
      if (conn.streaming && !한번에) {
        for await (const ev of chatStream(conn, ask(maxTokens, think))) {
          if (ev.type === 'done') msg = ev.message;
          else {
            if (ev.type === 'content') 흘린것 += ev.text ?? '';
            yield ev;
          }
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

      /*
       * 대답이 잘렸다면 한 번은 다시 부른다.
       *
       * 전에는 '상한을 올릴 수 있을 때만' 다시 불렀다. 그런데 컨텍스트가 큰
       * 모델에서는 아낀 상한과 풀어 준 상한이 둘 다 같은 천장(16,384)에 닿아서
       * cap < full 이 거짓이 됐다. **큰 파일을 쓰는 바로 그 기계에서만** 안전망이
       * 꺼져 있었던 것이다.
       *
       * 그리고 상한을 못 올리는 자리에서도 할 수 있는 일이 하나 더 있다 —
       * 생각을 줄이는 것이다. 추론 토큰은 답과 **같은 예산**에서 나간다.
       * 상한이 8,000인데 생각에 6,000을 쓰면 답에 쓸 수 있는 것은 2,000뿐이다.
       * 그래서 다시 부를 때는 생각을 한 칸 낮춘다. 예산이 실제로 남는다.
       *
       * 둘 다 못 하면(이미 천장이고 생각도 꺼져 있으면) 다시 부르지 않는다.
       * 같은 조건으로 또 부르면 같은 자리에서 또 잘린다 — 그건 그냥 낭비다.
       * 그 경우는 아래 '살려 쓰기' 가 받는다.
       */
      const full = Math.max(cap, fullCap(room));
      const 낮춘생각 = level === 'off' || level === 'low' ? level : shiftLevel(level, -1);
      if (wasCut(msg) && (full > cap || 낮춘생각 !== level)) {
        yield {
          type: 'retry',
          why: full > cap ? '대답이 상한에서 잘렸습니다' : '대답이 잘렸습니다 — 생각을 줄여 자리를 냅니다',
          from: cap, to: full, think: 낮춘생각,
        };
        yield* askModel(full, 낮춘생각);
      }

      /*
       * 빈 답을 성공으로 넘기지 않는다.
       *
       * 스트리밍을 무시하는 서버, HTML 오류 페이지를 200 으로 주는 프록시,
       * 규격이 안 맞는 게이트웨이 — 이럴 때 content 가 조용히 '' 가 된다.
       * 화면에는 `── 1.9초` 만 찍히고 끝난다. 오류도 없다. 몇 번을 다시 물어도
       * 같으니, 사용자는 프로그램이 고장 난 줄 안다.
       *
       * 스트리밍을 껐다가 한 번 다시 부른다. 원인이 그쪽이면 그 자리에서 낫는다.
       */
      if (빈답인가(msg) && conn.streaming) {
        yield { type: 'retry', why: '빈 답이 왔습니다 — 스트리밍을 끄고 다시 부릅니다', from: cap, to: cap };
        흘린것 = '';
        yield* askModel(cap, level, { 한번에: true });
        // 껐더니 되면 이 서버는 스트리밍이 안 맞는 것이다. 이번 세션은 계속 꺼 둔다.
        if (!빈답인가(msg)) {
          conn.streaming = false;
          yield { type: 'note', text: '이 서버는 스트리밍 응답이 비어서 이번 세션은 꺼 두고 씁니다.' };
        }
      }
      if (빈답인가(msg)) {
        yield {
          type: 'error',
          text: '서버가 빈 답을 보냈습니다.\n'
            + '  글도 도구 호출도 없습니다. 대개 셋 중 하나입니다 —\n'
            + '  · 모델 이름이 이 서버에 없는 것 (deel status 로 확인)\n'
            + '  · 프록시가 중간에서 응답을 바꿔 놓는 것\n'
            + '  · 컨텍스트가 꽉 차 답할 자리가 없는 것 (/context 로 확인)',
        };
        return;
      }
    } catch (err) {
      if (err?.name === 'Aborted' || signal?.aborted) {
        /*
         * 중단해도 **여기까지 한 말은 남긴다.**
         *
         * 전에는 "여기까지는 대화에 남아 있으니 이어서 말씀하세요" 라고 해 놓고
         * 실제로는 아무것도 안 남겼다. 그래서 "이어서 해줘" 라고 하면 모델이
         * 방금 제가 한 말을 몰랐다. 안내가 거짓이면 안 하느니만 못하다.
         */
        const 남길것 = 흘린것.trim();
        if (!msg && 남길것) session.push({ role: 'assistant', content: 남길것 });
        짝맞추기();
        yield { type: 'aborted', steps, kept: !!남길것 || !!msg };
        return;
      }

      /*
       * 거절당했으면 그 말에서 배운다.
       *
       *   "This model's maximum context length is 8192 tokens, however you requested 41003"
       *
       * 서버가 정답을 알려 준 것이다. 이 방식은 **처음 보는 서버에서도 통한다** —
       * 규격을 몰라도 되고, 새 서버가 나와도 코드를 안 고쳐도 된다.
       *
       * 배운 값을 conn 에 적고 곧바로 다시 부른다. 사용자는 실패를 안 본다.
       * 한 걸음에 한 번만 배운다 — 배웠는데도 또 거절당하면 다른 문제다.
       */
      const 배운 = 배울것(err.serverMessage ?? err.message);
      if (배운 && !배운적) {
        배운적 = true;
        if (배운.kind === 'ctx') {
          conn.ctx = 배운.limit;
          if (ctx.연결저장) { try { ctx.연결저장({ ctx: 배운.limit }); } catch {} }
        } else {
          conn.maxOut = 배운.limit;
          if (conn.maxTokens && conn.maxTokens > 배운.limit) conn.maxTokens = 배운.limit;
          if (ctx.연결저장) { try { ctx.연결저장({ maxTokens: 배운.limit }); } catch {} }
        }
        yield { type: 'learned', what: 배운.kind, limit: 배운.limit, asked: 배운.asked, from: 배운.text };
        steps--;   // 배우느라 쓴 걸음은 안 센다. 일은 아직 시작도 안 했다.
        continue;
      }

      // 숫자는 못 뽑았지만 '길어서' 인 것은 알겠으면, 줄여서 한 번 해 본다.
      if (!배운적 && 길이문제인가(err.serverMessage ?? err.message) && (conn.ctx ?? 0) > 8192) {
        배운적 = true;
        const 줄인것 = Math.max(8192, Math.floor((conn.ctx ?? 32768) / 2));
        conn.ctx = 줄인것;
        yield { type: 'learned', what: 'ctx', limit: 줄인것, guessed: true, from: 짧게말(err.serverMessage ?? err.message) };
        steps--;
        continue;
      }

      yield { type: 'error', text: err.message };
      return;
    }

    session.usage.in += msg.usage?.in ?? 0;
    session.usage.out += msg.usage?.out ?? 0;
    session.usage.calls++;

    session.push(assistantMessage(conn.kind, msg));

    if (!msg.toolCalls?.length) {
      yield { type: 'done', steps, text: msg.content, files: 마무리() };
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
        // 인자가 잘려 온 호출. 도구에 넘기면 안 된다 —
        // 도구는 '경로가 비었다' 같은, 원인과 상관없는 말을 하게 되고
        // 모델은 고칠 게 없다고 보고 똑같이 다시 시도한다. 그래서 끝없이 돈다.
        if (call.argsBroken) {
          // ── 버리기 전에, 건질 수 있는지 먼저 본다 ──────────────────────
          //
          // 잘린 JSON 안에는 이미 받아 놓은 내용이 들어 있다. 경로도 대개 온전하다.
          // 그걸 통째로 버리고 '다시 하세요' 라고 하면, 모델은 똑같이 다시 보내고
          // 똑같은 자리에서 또 잘린다. 그 되풀이가 71초와 파일 0개를 만들었다.
          //
          // 건져서 **실제로 쓰면** 다음 호출은 나머지만 보내면 된다 — 잘릴 일이 없다.
          // 그러니 이건 오류 처리가 아니라 일을 끝내는 길이다.
          //
          // Write 만 살린다. Edit 의 old_string 이 반쪽이면 엉뚱한 자리를 고치거나
          // 안 맞아 실패한다. 그건 안 하느니만 못하다.
          const 건진것 = (call.name === 'Write' || call.name === 'Append') ? 살린쓰기(call.rawArgs) : null;
          if (건진것) {
            const 도구 = call.name === 'Append' ? TOOLS.Append : TOOLS.Write;
            let r;
            try { r = await 도구.run({ file_path: 건진것.path, content: 건진것.content }, ctx); }
            catch (err) { r = { error: err.message }; }

            if (!r.error) {
              /*
               * 나아가고 있나 — 이건 **파일 크기로 판단한다.** 말이 아니라 사실로.
               *
               * 살려 쓰기가 성공했다는 것만으로 나아간 것이라고 보면 안 된다.
               * 모델이 똑같이 잘린 호출을 계속 보내면 매번 같은 내용을 같은 자리에
               * 다시 쓴다 — 성공은 하는데 파일은 그대로다. 그건 헛도는 것이다.
               * 그때 반복 감지를 꺼 버리면 걸음 수를 다 쓸 때까지 안 멈춘다.
               *
               * 파일이 지난번보다 커졌을 때만 나아간 것으로 본다.
               */
              const 지금크기 = r.changed ? (파일현황(r.changed).bytes ?? 0) : 0;
              const 앞크기 = 살린크기.get(r.changed) ?? -1;
              if (지금크기 > 앞크기) {
                살린크기.set(r.changed, 지금크기);
                나아감();
              } else if (막힘셈(call, '살려 써도 파일이 안 자람')) {
                멈출까 = '같은 내용이 계속 잘려서 옵니다 — 더 짧게 나눠 보내야 합니다';
              }
              const note = `인자가 잘려서, **받은 데까지만 파일에 썼습니다.**\n`
                + `  ${건진것.path} · ${건진것.lines}줄까지 저장됨\n`
                + `  마지막 줄: ${건진것.lastLine}\n`
                + `  이어서 Append 로 **그 다음 줄부터** 보내세요. 앞부분은 다시 보내지 마세요 —\n`
                + `  다시 보내면 또 같은 자리에서 잘립니다. 한 번에 300줄 안쪽으로 끊어 보내세요.`;
              session.push(toolMessage(conn.kind, { callId: call.id, name: call.name, content: note }));
              if (r.changed) { session.noteChange(r.changed, r.diff); 손댄파일.add(r.changed); }
              ctx.audit.tool(call.name, { file_path: 건진것.path }, `잘린 것을 살려 ${건진것.lines}줄 씀`);
              yield {
                type: 'tool', name: call.name, args: { file_path: 건진것.path },
                result: { ...r, summary: `${건진것.lines}줄 · 잘린 데까지`, warn: `잘린 데까지만 썼습니다 — ${건진것.lines}줄` },
                showLabel: true,
              };
              continue;
            }
            // 살려 쓰는 것마저 실패했으면(범위 밖 경로 등) 아래 평범한 거절로 내려간다.
          }

          const note = `${call.name} 의 인자(JSON)가 중간에서 잘려 읽을 수 없습니다.`
            + ' 한 번에 보내기엔 내용이 너무 큽니다.\n'
            + '  통째로 다시 보내지 마세요 — 또 같은 자리에서 잘립니다.\n'
            + '  파일을 만드는 중이라면: Write 로 앞부분만 300줄 안쪽으로 만들고,'
            + ' 나머지는 Append 를 여러 번 불러 이어 붙이세요.';
          거절(call, note);
          // 감사기록에 남긴다. 자율 실행을 사내에 설득할 때 근거가 되는 파일이라,
          // '스스로 안 한 일' 도 남아야 한다.
          ctx.audit.blocked('인자가 잘려 실행하지 않음', `${call.name} · ${String(call.rawArgs ?? '').length}자`);
          if (막힘셈(call, '인자잘림')) 멈출까 = '같은 도구 호출이 계속 잘립니다';
          yield { type: 'tool', name: call.name, args: {}, result: { error: '인자가 잘렸습니다 — 한 번에 보내기엔 너무 큽니다' }, showLabel: true };
          continue;
        }

        if (!TOOLS[call.name]) {
          거절(call, `모르는 도구입니다. 쓸 수 있는 것: ${Object.keys(TOOLS).join(', ')}`);
          // 이것도 세야 한다. 없는 이름을 계속 부르며 걸음 수를 다 쓰는 길이 있었다 —
          // 71초 증상과 겉모습이 똑같은데 문만 다르다. 아래 거부·중복도 마찬가지다.
          if (막힘셈(call, '모르는 도구')) 멈출까 = `${call.name} 은 없는 도구인데 계속 부르고 있습니다`;
          yield { type: 'tool', name: call.name, args: call.args, result: { error: '모르는 도구' }, showLabel: true };
          continue;
        }

        // 변경성 명령은 실패해도 다시 실행하지 않는다 — 두 번 돌면 사고다.
        if (call.name === 'Bash' && isMutating(call.args?.command)) {
          const key = String(call.args.command).trim();
          if (attempted.has(key)) {
            const note = '같은 변경성 명령을 다시 실행하지 않습니다. 두 번 실행되면 사고가 납니다.';
            거절(call, note);
            if (막힘셈(call, '두 번째 실행 거부')) 멈출까 = '같은 명령을 계속 다시 부르고 있습니다';
            yield { type: 'tool', name: call.name, args: call.args, result: { error: note }, showLabel: true };
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
            // 거부를 못 알아듣고 같은 것을 계속 물으면 사람만 계속 n 을 치게 된다.
            if (막힘셈(call, '사용자 거부')) 멈출까 = '거부하셨는데도 같은 것을 계속 물어보고 있습니다';
            yield { type: 'tool', name: call.name, args: call.args, result: { error: '거부됨' }, showLabel: true };
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
        if (result.error) {
          lastToolFailed = true;
          // 같은 도구가 같은 이유로 계속 실패하면 헛돌고 있는 것이다.
          // 오류의 첫 줄만 본다 — 뒤에 붙는 경로·숫자는 매번 달라도 원인은 같다.
          const 이유 = String(result.error).split('\n')[0].slice(0, 60);
          if (막힘셈(call, 이유)) 멈출까 = `${call.name} 이 같은 이유로 계속 실패합니다 — ${이유}`;
        }
        if (call.name === 'Read' && result.content) session.noteRead(call.args.file_path, result.content);
        // 실제로 파일이 바뀐 것만 적는다. 턴 끝에 이 목록을 디스크와 견준다.
        if (result.changed) 손댄파일.add(result.changed);

        // 앞에서 똑같이 부른 적이 있고 결과도 같으면, 결과를 다시 싣지 않는다.
        let 실을것 = result.error ? `오류: ${result.error}` : result.content ?? '';
        if (!result.error) {
          const 서명 = 서명만들기(call);
          const 앞것 = 부른것.get(서명);
          if (앞것 !== undefined && 앞것 === 실을것) {
            const n = (막힘.get(`반복|${서명}`) ?? 0) + 1;
            막힘.set(`반복|${서명}`, n);
            실을것 = `앞에서 부른 ${call.name} 과 인자도 결과도 같습니다. 결과는 그대로라 다시 싣지 않습니다.`
              + ' 같은 것을 또 부르지 말고 다음 일로 넘어가세요.';
            if (n + 1 >= MAX_SAME) 멈출까 = `${call.name} 을 같은 인자로 계속 부르고 있습니다 — 결과가 매번 같습니다`;
          } else {
            부른것.set(서명, 실을것);
          }
        }

        session.push(toolMessage(conn.kind, {
          callId: call.id,
          name: call.name,
          content: 실을것,
        }));
        yield { type: 'tool', name: call.name, args: call.args, result, ms, parallel: 함께 };
      }
    }

    // 도구를 돌리다 끕어졌어도 모델이 한 말은 이미 대화에 들어가 있다. 그건 남는다.
    if (signal?.aborted) { yield { type: 'aborted', steps, kept: true }; return; }

    // 헛돌고 있으면 여기서 끊는다. 걸음 수가 남았다고 계속 두면
    // 컨텍스트만 채우고 사람은 기다리기만 한다.
    if (멈출까) {
      ctx.audit.blocked('같은 자리를 반복해 스스로 멈춤', 멈출까);
      yield { type: 'stuck', why: 멈출까, steps, files: 마무리() };
      return;
    }

    // 컨텍스트가 차오르면 오래된 대화를 '요약해서' 접는다. 그냥 자르면 하던 일을 잊는다.
    if (shouldCompact(session)) {
      yield { type: 'compacting' };
      const r = await compact(session, { auto: true, signal });
      if (r.aborted) { yield { type: 'aborted', steps, kept: true }; return; }
      if (r.ok) yield { type: 'compacted', ...r };
      else yield { type: 'compact_failed', why: r.why };
    }
  }

  /*
   * 걸음을 다 썼다.
   *
   * 전에는 `도구 호출 24회에서 멈췄습니다` 한 줄이 전부였다. 무엇이 끝났고
   * 무엇이 안 끝났는지는 사람이 위로 스크롤해 도구 줄을 세어 봐야 알았다.
   * 할 일 목록을 이미 들고 있으니 그걸 그대로 보여 준다 — "이어서 해줘" 라고
   * 할 때 무엇을 이어야 하는지가 화면에 있어야 한다.
   */
  const 남은할일 = (ctx.todos ?? []).filter((x) => x.state !== 'done');
  yield { type: 'limit', steps, files: 마무리(), 남은할일 };
}
