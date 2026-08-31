// 에이전트 루프. 모델 → 도구 → 결과 → 모델 을 답이 나올 때까지 돈다.
// 화면에 그릴 것은 이벤트로 흘려보낸다 — 화면 코드와 섞지 않는다.
import { chat, chatStream, assistantMessage, toolMessage } from '../backend/adapter.js';
import { 그림메시지 } from '../backend/vision.js';
import { 어떻게할까 } from '../safety/policy.js';
import { toolSchemas, runTool, TOOLS, 파일현황 } from '../tools/index.js';
import { isMutating } from '../safety/guard.js';
import { effortFor, tokensFor, fullCap, wasCut, shiftLevel } from './effort.js';
import { 살린쓰기 } from './salvage.js';
import { 배울것, 길이문제인가 } from '../backend/learn.js';
import { compact, shouldCompact, shouldFold, foldToolResults, foldImages } from './compact.js';
import { 걸음수, 하위걸음수, 요약길이 } from './budget.js';
import { Session } from './session.js';
import { 최대깊이, 하위모드, 하위요약 } from '../tools/task.js';
import { 프로필찾기, 쓸수있나, 연결만들기, 알릴말, 목록보기 } from './models.js';
import { allowTemporarily, isOffline } from '../safety/network.js';
import { 가리기, 훑기, 가렸다는말, 봤다는말, 가릴도구 } from '../safety/secrets.js';
import { get as workMode } from './modes.js';
import { 지시말 } from '../i18n/index.js';

/*
 * 콜백으로만 소식을 주는 부름을, 제너레이터가 중간에 내보낼 수 있는 모양으로 바꾼다.
 *
 * chat() 이나 compact() 는 await 하나로 끝나는 부름이라, 그 안에서 "서버가 막았다,
 * 2초 기다린다" 같은 소식이 생겨도 화면으로 나올 길이 없었다. 소식을 우편함에
 * 넣어 두고 받는 쪽이 하나씩 꺼내 yield 한다. 부름이 끝나면 소식()도 끝난다.
 *
 *   const 편지 = 우편함((알려줘) => chat(conn, { ..., onBackoff: 알려줘 }));
 *   for await (const 소식 of 편지.소식()) yield 소식;
 *   const 답 = await 편지.부름;
 */
function 우편함(부르기) {
  const 함 = [];
  let 깨우기 = null;
  let 끝 = false;
  const 부름 = 부르기((소식) => { 함.push(소식); 깨우기?.(); });
  부름.then(() => { 끝 = true; 깨우기?.(); }, () => { 끝 = true; 깨우기?.(); });
  return {
    부름,
    async *소식() {
      while (!끝 || 함.length) {
        if (함.length) { yield 함.shift(); continue; }
        await new Promise((r) => { 깨우기 = r; });
        깨우기 = null;
      }
    },
  };
}

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

/**
 * 도구 결과 중에서 **대화에 실을 글**을 고른다.
 *
 * ── 왜 따로 두나 ────────────────────────────────────────────────────────
 *
 * 여태 여기는 `result.content ?? ''` 한 줄이었다. 그런데 도구가 `summary` 만
 * 돌려주는 자리가 있다 — Recall 이 지난 대화를 다 뒤졌지만 못 찾았을 때가
 * 그렇다. 그 경우 모델에게 가는 것은 **빈 글**이다.
 *
 * 사람 화면에는 「지난 대화 12개를 다 뒤졌지만 없습니다」 가 멀쩡히 찍힌다.
 * 그래서 아무도 눈치를 못 챈다. 정작 모델은 아무 말도 못 들었으므로,
 * 못 찾았다는 것도 모르고 **찾아본 적이 있다는 것조차** 모른다. 그 자리에서
 * 모델이 하는 일은 둘 중 하나다 — 없는 것을 지어내거나, 사람에게 엉뚱한
 * 선택지를 들이민다. 실제 제보가 딱 그 모양이었다.
 *
 * 그래서 규칙을 셋으로 못 박는다.
 *   1) 글이 있으면 그대로.
 *   2) 글이 없고 요약이 있으면 요약을 싣는다 — 사람이 본 것과 같은 말이다.
 *   3) 둘 다 없으면 **없다고 말한다.** 침묵은 지어내기를 부른다.
 */
export function 실을글(result) {
  if (result?.error) return `오류: ${result.error}`;
  const 글 = result?.content;
  if (String(글 ?? '').trim()) return String(글);
  const 요약 = String(result?.summary ?? '').trim();
  if (요약) return 요약;
  return '도구는 돌았지만 돌려준 것이 없습니다.'
    + ' 없는 것을 있다고 지어내지 말고, 못 얻었다는 것을 그대로 두고 다음으로 넘어가세요.';
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

export async function* run(session, ctx, userText, { signal = null, 깊이 = 0, 그림들 = null, 끼어들기 = null } = {}) {
  /*
   * 되돌리기 턴은 **부모만** 연다.
   *
   * 하위 작업이 제 턴을 열면 `/undo` 한 번이 하위가 만든 것만 되돌리고
   * 부모가 만든 것은 남긴다 — 반쪽만 되돌아간 폴더가 된다. 사람 눈에는
   * 한 번 시킨 일이니 한 번에 되돌아가야 맞다.
   *
   * 턴을 **사람 말을 넣기 전에** 연다. 그래야 그 말 자체가 이 턴의 첫 말로
   * 표시되고, 되감을 때 시킨 말까지 같이 걷힌다. 시킨 말만 남으면 모델은
   * 되돌린 일을 또 하려 든다.
   */
  if (!깊이) session.턴시작(ctx.history.nextTurn());
  // @ 로 그림을 지목했으면 그 말과 함께 실어 보낸다 (backend/vision.js).
  session.push(그림들?.length
    ? 그림메시지(session.conn?.kind, { 글: userText, 그림들 })
    : { role: 'user', content: userText });
  ctx.audit.turn(깊이 ? `[하위작업 ${깊이}겹] ${userText}` : userText);

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

  /*
   * 이번에 사람이 실제로 친 말. 도구가 볼 수 있게 여기 걸어 둔다.
   *
   * Ask 관문(agent/askcheck.js)이 이걸 본다 — "사용자가 이미 적어 준 것을
   * 되묻고 있나" 는 원문 없이는 판단할 수 없다. 프롬프트에는 들어 있지만
   * 그건 모델이 보는 것이고, 우리 코드가 볼 수 있는 자리가 없었다.
   *
   * 하위 작업에서는 그 하위가 받은 할일이 들어온다. 그게 맞다 — 하위에게
   * '사용자의 말' 은 자기가 받은 할일이다.
   */
  ctx.요청 = String(userText ?? '');

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
  /*
   * 몇 번까지 봐 줄까는 **이 모델을 겪어 본 만큼** 정한다 (agent/card.js).
   *
   * 되풀이가 버릇인 모델에서는 세 번까지 기다릴 이유가 없다. 되풀이한 만큼
   * 컨텍스트가 차고 그만큼 요약이 빨리 온다 — 걸음만 태우는 것이 아니다.
   * 겪은 것이 모자라면 여태 쓰던 3 그대로다.
   */
  const 이카드 = ctx?.카드 ?? null;
  const MAX_SAME = 이카드?.조정?.같은것한계 ?? 3;
  let 멈출까 = null;
  const 막힘셈 = (call, 이유) => {
    // 파일 하나가 아니라 **그 파일** 을 센다. 이름만 세면 서로 다른 파일 세 개를
    // 고치다 실패한 것이 한 덩어리로 뭉쳐 턴이 죽는다. 다섯 군데 중 두 군데만
    // 고쳐 놓고 '헛돌고 있어 멈췄습니다' 가 되는 것이 그 모습이다.
    const 어디 = call.args?.file_path ?? call.args?.path ?? call.args?.pattern ?? call.args?.command ?? call.args?.목적 ?? '';
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
  /*
   * 서명은 한 모양으로 맞춰 놓고 견준다 (NFC).
   *
   * 맥은 파일 이름을 자모를 쪼개서 돌려준다. 그래서 `Read(PDF_경로.md)` 와
   * `Read(PDF_경로.md)` 가 글자로는 다른 호출이 된다 — 같은 파일을 두 번 읽고
   * 두 번 싣고도 되풀이로 안 잡힌다. 실제로 3,250줄짜리 파일이 그렇게 두 번 들어갔다.
   */
  const 서명만들기 = (call) => {
    try { return `${call.name}(${JSON.stringify(call.args ?? {})})`.normalize('NFC'); }
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
  /*
   * 이 턴에 모델에게 보여 줄 도구.
   *
   * 하위 작업이면 `도구제한` 이 차 있다 — **부모가 가졌던 것** 이다. 그것을
   * 그대로 넘기면 toolSchemas 가 거기에 다시 하위의 작업 모드를 걸러 얹으므로,
   * 하위가 가질 수 있는 것은 언제나 부모가 가졌던 것의 부분집합이 된다.
   *
   * 이게 없으면 구멍이 하나 생긴다. 설계 모드는 "파일을 안 바꾼다" 는 약속인데,
   * 하위가 제 모드를 code 로 골라 버리면 그 약속이 하위에서 깨진다. 화면에는
   * 여전히 설계 모드라고 떠 있는 채로 파일이 바뀐다. task.js 의 하위모드() 가
   * 모드 쪽에서 한 겹 막고, 여기가 도구 쪽에서 한 겹 더 막는다.
   */
  const tools = toolSchemas(session.도구제한 ?? null, {
    hasSkills: (session.skills?.length ?? 0) > 0,
    web: session.web !== false && !isOffline(),   // 오프라인이면 웹 도구는 아예 안 보여 준다
    work: session.effectiveWork(),                // 작업 모드가 쓰는 것만 (modes.js)
    // 밖에서 붙인 도구(MCP). 붙은 것이 없으면 아무것도 안 는다.
    mcp: ctx.mcp ?? null,
    // 이 자리에 언어 서버가 있을 때만 Def·Refs 를 보여 준다 (tools/lsp.js).
    // 없는 자리에서 목록에 세워 두면 모델이 부르고, 실패를 받고, 또 부른다.
    lsp: session.lsp === true,
    // 창이 좁으면 도구 설명을 줄여 싣는다 (budget.js 의 설명길이).
    // 도구를 빼는 게 아니라 설명만 줄이므로 할 수 있는 일은 안 달라진다.
    ctx: conn.ctx ?? null,
    // 그림을 볼 수 있는 모델일 때만 Read 설명에 그림 이야기를 넣는다.
    // 못 보는데 넣어 두면 모델이 화면 사진을 열려 들고, 그때마다 한 걸음이 헛간다.
    vision: conn.vision === true,
  });

  /*
   * 하위 작업에게 물려줄 도구 이름들.
   *
   * MCP 도구는 뺀다. toolSchemas 는 이름을 받으면 TOOLS 표에서 찾는데, MCP
   * 이름은 그 표에 없어서 undefined 를 읽다 죽는다. MCP 는 이름 목록이 아니라
   * ctx.mcp 로 따로 넘어가므로 하위도 그 길로 똑같이 받는다.
   */
  const 내도구 = tools.map((t) => t.function.name).filter((n) => !n.startsWith('mcp__'));
  /*
   * 깊이 상한. 부모(0) → 하위(1) → 하위의 하위(2) 까지다.
   *
   * 상한에 닿으면 목록에서 Task 를 뺀다. "더 쪼개지 마라" 고 부탁하지 않는다 —
   * 모델은 부탁을 잊고, 잊으면 하위가 하위를 끝없이 낳는다.
   */
  const 자식도구 = 깊이 + 1 >= 최대깊이 ? 내도구.filter((n) => n !== 'Task') : 내도구;
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

  /*
   * ── 조사만 하고 "무엇을 도와드릴까요" 로 끝내는 것 ────────────
   *
   * 실제로 이렇게 끝난 턴이다. 할 일 셋을 적어 놓고, 파일 스물일곱 개를
   * 읽고, 그중 하나도 안 끝낸 채로 —
   *
   *   ☰ TodoWrite(3건)  ▶ 문서와 실행 구조를 확인한다  ☐ README 를 정리한다 …
   *   ◧ Read × 스물일곱
   *   ▌ 무엇을 도와드릴까요? 프로젝트 구조와 실행 방식은 확인했습니다.
   *   ── 30.9초 · 도구 27회
   *
   * 사람은 "문서 정리해줘" 라고 말했고 30초를 기다렸는데, 바뀐 파일은 없다.
   * 다시 "정리해줘" 라고 하면 또 처음부터 읽는다 — 조사한 것은 매번 버려진다.
   * 걸음 수 상한으로도, 반복 감지로도 이 자리는 안 잡힌다. 모델은 오류 없이,
   * 정중하게, 제 일을 사람에게 되돌려주고 끝낸 것이다.
   *
   * 그래서 한 번만 되민다. 세 가지가 다 맞을 때만이다 —
   *   · 이번 턴에 바꾼 파일이 하나도 없다
   *   · 파일을 바꿀 수 있는 모드다 (설계·묻기 모드는 안 바꾸는 것이 정상이다)
   *   · 되묻는 말로 끝났거나, 남은 할 일이 있는데 답이 한 줄이다
   *
   * 한 번뿐인 이유: 두 번 밀면 못 하는 일을 두고 실랑이가 된다. 한 번 밀었는데도
   * 또 물으면 그건 진짜 막힌 것이니, 그 말을 사람에게 그대로 보여 준다.
   *
   * 물어볼 것이 진짜로 있을 때는 Ask 도구가 있다. 그것은 도구 호출이라
   * 여기까지 오지 않는다 — 막히는 것은 글로 되묻고 턴을 닫는 쪽뿐이다.
   */
  let 민적 = false;
  /*
   * 인사에는 안 민다.
   *
   * 「안녕」 한 마디에 모델이 "안녕하세요! 무엇을 도와드릴까요?" 라고 답하면
   * 그건 **맞는 답**이다. 그런데 그 말이 되묻는말에 걸려서 되밀렸다 —
   *
   *   ❯ 안녕
   *     ▌ 안녕하세요! 무엇을 도와드릴까요?
   *     ↺ 읽기만 하고 끝내려고 해서 한 번 되밀었습니다
   *     ▌ 안녕하세요! 반갑습니다.
   *     ── 6.8초
   *
   * 인사 한 마디에 모델을 두 번 부른다. 로컬 모델에서 그 왕복이 6.8초다.
   * 되밀기는 「시킨 일을 안 하고 되돌려준」 자리를 잡으라고 만든 것인데,
   * 인사는 시킨 일이 없다. 시킨 것이 없으면 안 한 것도 없다.
   */
  const 인사인가 = /^(안녕[가-힣]*|반(가|갑)[가-힣]*|하이|ㅎㅇ+|헬로[우가-힣]*|고마[가-힣]*|감사[가-힣]*|수고[가-힣]*|hi|hello|hey|yo|thanks?|thank you|테스트|test|ok(ay)?|네|응)[\s!.~?ㅎㅋ,]*$/i
    .test(String(userText ?? '').trim());
  const 되묻는말 = /무엇을\s*도와|무엇을\s*해\s*드릴|원하시는\s*(작업|것)|어떤\s*(작업|것)\s*(을|부터)|말씀해\s*주세요|알려\s*주세요|지시해\s*주세요|어떻게\s*할까요|해\s*드릴까요|진행할까요|what would you like|how can i (help|assist)|let me know (what|which|how)|shall i\b|would you like me to/i;

  /** 이번 답을 되밀까. 밀 이유를 돌려주고, 아니면 null. */
  const 밀어줄까 = (글) => {
    if (민적 || 깊이) return null;
    if (인사인가) return null;                            // 시킨 것이 없으면 안 한 것도 없다
    if (손댄파일.size) return null;                       // 뭐라도 바꿨으면 일은 한 것이다
    if (!모드.tools.includes('Write')) return null;         // 안 바꾸는 모드는 그게 맞다
    const 말 = String(글 ?? '').trim();
    if (되묻는말.test(말)) return '되물음';
    const 남은 = (ctx.todos ?? []).filter((x) => x.state !== 'done');
    // 진짜 보고는 길다. 한 줄로 끝났고 할 일이 남았으면 놓은 것이다.
    if (남은.length && 말.length < 120) return '할일남음';
    return null;
  };

  const 되미는말 = () => {
    const 시킨 = String(userText ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
    return 지시말() === 'en'
      ? `Nothing has been changed yet. What was asked: "${시킨}"\n`
        + 'The reading is done. Do it now — do not ask back. Deciding how is your job.\n'
        + 'If a tool is genuinely blocking you, say in one line what blocked you.'
      : `아직 아무것도 안 바꿨습니다. 시킨 것은 이것입니다: "${시킨}"\n`
        + '읽는 것은 끝났습니다. 되묻지 말고 지금 하세요 — 어떻게 할지 정하는 것이 당신 일입니다.\n'
        + '정말 도구가 막고 있으면 무엇이 막았는지 한 줄로 말하세요.';
  };

  while (steps < maxSteps) {
    steps++;

    /*
     * ── 도중에 한 말을 여기서 받는다 (끼어들기) ──────────────────────────
     *
     * 일하는 동안 친 말은 여태 **턴이 끝날 때까지** 기다렸다. 로컬 모델은
     * 한 턴이 몇 분씩 가는데, 그 사이에 "아, 그건 말고 저거" 라고 쳐도
     * 모델은 하던 길을 끝까지 간다. 사람이 할 수 있는 것은 Ctrl+C 로
     * 지금까지 한 것을 통째로 버리는 것뿐이었다.
     *
     * 그래서 걸음마다 **모델을 부르기 직전에** 받아 넣는다. 다음 부름에
     * 그 말이 같이 실리니, 하던 일을 버리지 않고 방향만 튼다.
     *
     * 도구가 도는 중간에는 안 넣는다 — 도구 호출과 그 답 사이에 사람 말이
     * 끼면 대화 모양이 깨져서 게이트웨이가 400 을 준다. 걸음의 머리는
     * 언제나 도구 답이 다 붙은 뒤다.
     */
    /*
     * 첫 걸음에는 안 받는다.
     *
     * 첫 부름 전에 큐에 남아 있는 것은 **턴이 시작되기 전에** 친 말이다.
     * 그건 원래 다음 턴이 될 것이었는데, 여기서 끌어다 넣으면 사람이 따로
     * 시킨 두 가지가 한 턴으로 뭉친다. 끼어들기는 「가던 길을 트는 것」이지
     * 「줄 서 있는 것을 당겨오는 것」이 아니다.
     */
    const 끼어든말 = (깊이 || steps <= 1) ? null : 끼어들기?.();
    if (끼어든말) {
      session.push({ role: 'user', content: 끼어든말 });
      ctx.audit.turn(`[도중에 끼어든 말] ${끼어든말}`);
      yield { type: 'steer', text: 끼어든말 };
    }
    /*
     * 이 모델이 실제로 어떻게 하고 있는지 센다 (agent/grade.js).
     *
     * 이름에 70B 라고 적혀 있어도 걸음마다 인자가 잘리면 그건 붙들어 줘야
     * 하는 상태다. 이름은 첫 어림일 뿐이고, 여기서 세는 것이 진짜 근거다.
     * 세기만 한다 — 판단은 grade.js 가 하고, 프롬프트는 다음 걸음부터 달라진다.
     */
    session.본것?.걸음셈();
    ctx.배움?.모델본것(conn.model, '걸음');
    // 단계마다 필요한 생각의 양이 다르다. effort.js 가 그 배분을 갖고 있다.
    const stage = steps === 1 ? 'plan' : lastToolFailed ? 'fix' : 'work';
    const level = effortFor(think, effort, stage);
    // 상한은 모델 컨텍스트와 지금 찬 양에서 계산한다. 고정 숫자가 아니다.
    // 출력 상한을 아는 값이 둘 있다 — 사용자가 정한 것(/out)과 서버에서 알아낸 것.
    // 사람이 정한 것이 먼저다. 둘 다 없으면 null 이고, 그때만 effort.js 의 MAX_CAP 에 선다.
    const room = { ctx: conn.ctx ?? 0, used: session.breakdown().used, max: conn.maxTokens ?? conn.maxOut ?? null };
    /*
     * 이 모델이 인자를 자주 잘라 먹는다면 처음부터 넉넉히 준다 (agent/card.js).
     *
     * 지금은 잘린 **뒤에야** 상한을 올려 다시 부른다. 한 번은 반드시 버리는 셈이다.
     * 잘리는 것이 이 모델의 버릇으로 재어졌다면 그 한 번을 매번 버릴 이유가 없다.
     * 상한은 최댓값이지 정해진 길이가 아니라서, 짧게 답하는 턴에는 값이 안 든다.
     */
    const cap = 이카드?.조정?.상한먼저올리기
      ? Math.max(tokensFor(effort, stage, room), fullCap(room))
      : tokensFor(effort, stage, room);
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
    /*
     * 서버가 잠깐 막아 기다렸다 다시 부른 횟수는 /cost 와 deel run --json 이 본다.
     * 다만 **정말 다시 불렀을 때** 센다 — 알림을 낸 뒤 기다리다 Ctrl+C 로 끊기면
     * 다시 부른 것이 아니다. 그래서 셈은 미뤄 두고, 다음 소식이 오면 그때 더한다.
     */
    let 미룬셈 = 0;
    const 셈하기 = () => { session.usage.retries = (session.usage.retries ?? 0) + 미룬셈; 미룬셈 = 0; };
    const 끝셈 = (err) => { if (err?.name === 'Aborted') 미룬셈 = 0; else 셈하기(); };
    const askModel = async function* (maxTokens, think, { 한번에 = false } = {}) {
      if (conn.streaming && !한번에) {
        try {
          for await (const ev of chatStream(conn, ask(maxTokens, think))) {
            셈하기();   // 무슨 소식이든 왔다는 것은 앞의 다시 부름이 실제로 있었다는 뜻
            if (ev.type === 'done') msg = ev.message;
            else {
              if (ev.type === 'content') 흘린것 += ev.text ?? '';
              if (ev.type === 'backoff') 미룬셈 = 1;
              yield ev;
            }
          }
        } catch (err) { 끝셈(err); throw err; }
        셈하기();
      } else {
        yield { type: 'waiting' };
        /*
         * 한 번에 받는 길은 await 하나라 알림이 흘러나오지 않는다. 그래서 부름을
         * 띄워 두고, 알림이 오면 먼저 내보내고, 답이 오면 그때 끝낸다. 안 그러면
         * 서버가 60초 기다리라 한 동안 화면에는 '생각 중' 만 떠 있다 — 사람은
         * 모델이 느린 줄 알지만 실은 429 였다.
         */
        const 편지 = 우편함((onBackoff) => chat(conn, { ...ask(maxTokens, think), onBackoff }));
        for await (const 알림 of 편지.소식()) { 셈하기(); 미룬셈 = 1; yield 알림; }
        try { msg = await 편지.부름; } catch (err) { 끝셈(err); throw err; }
        셈하기();
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
      let 마지막상한 = cap;
      if (wasCut(msg) && (full > cap || 낮춘생각 !== level)) {
        yield {
          type: 'retry',
          why: full > cap ? '대답이 상한에서 잘렸습니다' : '대답이 잘렸습니다 — 생각을 줄여 자리를 냅니다',
          from: cap, to: full, think: 낮춘생각,
        };
        마지막상한 = full;
        yield* askModel(full, 낮춘생각);
      }

      /*
       * 우리가 할 수 있는 것을 다 했는데도 잘렸다 — 여기서 입을 다물면 안 된다.
       *
       * 상한도 올려 봤고 생각도 줄여 봤는데 여전히 잘렸으면, 남은 일은 사람
       * 몫이다. 그런데 여태 그냥 조용히 끝냈다. 화면에는 중간에서 끊긴 답만
       * 남는다 — 사람 눈에는 모델이 게을러서 대충 답한 것으로 보이니 같은 것을
       * 다시 시키고, 같은 자리에서 또 잘린다. 몇 분씩 가는 로컬 모델에서
       * 이 왕복은 비싸다.
       *
       * 안 되는 것은 **까닭과 손댈 자리를 같이** 말한다 (`/out`).
       * 다시 부른 뒤에 보는 것이 중요하다. 부르기 전에 판정하면, 상한을 올려
       * 멀쩡히 끝난 답에까지 경고가 붙는다 — 그러면 곧 아무도 안 읽는다.
       */
      if (wasCut(msg)) {
        yield {
          type: 'capped',
          cap: 마지막상한,
          정한값: conn.maxTokens ?? conn.maxOut ?? null,
        };
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
        session.본것?.본것('빈답');
        ctx.배움?.모델본것(conn.model, '빈답');
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

    /*
     * 방금 보낸 것이 실제로 몇 토큰이었는지 서버가 알려 줬다. 우리 추정과
     * 견줘서 배운다 — 여기가 유일하게 정답을 아는 자리다.
     *
     * 답을 push 하기 **전**이어야 한다. 지금 이력이 곧 방금 보낸 프롬프트다.
     */
    const 새보정 = session.배운다?.(msg.usage?.in);
    // 배운 배수를 디스크에도 남긴다. 다음에 켤 때 이 값으로 시작한다.
    if (새보정) ctx.배움?.보정본것(conn.model, 새보정);

    session.push(assistantMessage(conn.kind, msg));

    if (!msg.toolCalls?.length) {
      const 왜 = 밀어줄까(msg.content);
      if (왜) {
        민적 = true;
        session.push({ role: 'user', content: 되미는말() });
        yield { type: 'nudge', why: 왜, text: msg.content };
        continue;
      }
      yield { type: 'done', steps, text: msg.content, files: 마무리() };
      return;
    }

    // 도구를 돌린다. 읽기만 하는 것들이 이어지면 한꺼번에, 나머지는 하나씩.
    lastToolFailed = false;
    const 거절 = (call, note) => {
      lastToolFailed = true;
      session.push(toolMessage(conn.kind, { callId: call.id, name: call.name, content: note }));
    };

    /*
     * 이번 턴에 Read 로 연 그림들.
     *
     * 도구 결과가 다 들어간 **뒤에** 한꺼번에 붙인다. 하나 읽을 때마다 바로
     * 붙이면 도구 결과 사이에 사람 말이 끼어드는데, 그러면 뒤에 오는 도구
     * 결과들이 짝을 잃는다 — 게이트웨이가 통째로 400 을 준다.
     */
    const 붙일그림 = [];

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
          session.본것?.본것('잘린인자');
          ctx.배움?.모델본것(conn.model, '잘린인자');
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

        /*
         * 적어 둔 규칙이 모드보다 먼저다 (safety/policy.js).
         *
         *   금지  — 물어보지도 않는다. 물어보는 것은 막는 것이 아니다.
         *           `npm test` 에 스무 번 y 를 친 손은 스물한 번째도 친다.
         *   허락  — 모드가 뭐든 안 묻는다.
         *   없으면 예전 그대로 모드가 정한다.
         *
         * 막았으면 **어디에 적힌 규칙인지까지** 말한다. 그 말이 없으면 사람은
         * 제 설정을 고칠 수도, 관리자에게 무엇을 풀어 달라고 할 수도 없다.
         */
        const 판정 = 어떻게할까(ctx.규칙들, call.name, call.args);
        if (판정.답 === 'deny') {
          ctx.audit?.blocked?.('규칙으로 금지됨', `${판정.출처}: ${판정.규칙}`);
          거절(call, `${판정.출처}에 적힌 규칙 ${판정.규칙} 으로 막혀 있습니다.`
            + ' 이 방법은 쓸 수 없습니다 — 다른 길을 찾거나, 왜 필요한지 사용자에게 말하세요.'
            + ' 같은 것을 다시 부르지 마세요.');
          if (막힘셈(call, '규칙 금지')) 멈출까 = '규칙으로 막힌 것을 계속 다시 부르고 있습니다';
          yield {
            type: 'tool', name: call.name, args: call.args, showLabel: true,
            result: { error: `막힘 — ${판정.출처}의 ${판정.규칙}` },
          };
          continue;
        }

        // 모드에 따라 물어본다. 기본(auto)은 안 묻고 되돌리기로 대응한다.
        const needsOk = 판정.답 === 'allow' ? false : session.mode === 'strict'
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

      /*
       * ── 하위 작업 ─────────────────────────────────────────────────────
       *
       * 여기서 가로챈다. 평범한 도구 경로(runTool)로 보내면 안 된다.
       *
       * 도구는 `{content, summary}` 만 돌려줄 뿐 이벤트를 못 흘린다. 하위
       * 작업은 몇 분씩 도는 일이라, 그 길로 보내면 그동안 화면이 완전히
       * 죽는다 — 사람은 멈춘 건지 도는 건지 알 수 없어 Ctrl+C 를 누른다.
       * 그래서 여기서 직접 돌리고, 하위 루프의 이벤트를 깊이만 붙여 그대로
       * 위로 올려보낸다. 화면은 그걸 한 단 들여 그린다 (ui/screen.js).
       *
       * Task 는 읽기전용이 아니므로 묶기()가 언제나 혼자 한 덩어리로 낸다.
       */
      if (실행할것.length === 1 && 실행할것[0].name === 'Task') {
        const call = 실행할것[0];
        const 목적 = String(call.args?.목적 ?? call.args?.purpose ?? '').trim() || '이름 없는 작업';
        const 할일 = String(call.args?.할일 ?? call.args?.task ?? '').trim();

        // 할 일이 비면 하위는 아무것도 모른 채로 시작한다. 하위는 이 대화를
        // 못 보므로, 여기서 통과시키면 걸음만 태우고 빈손으로 돌아온다.
        if (!할일) {
          const note = '할일 이 비어 있습니다. 하위 작업은 지금 대화를 볼 수 없으니,'
            + ' 필요한 배경·정한 것·파일 경로와 "무엇이 끝나면 다 된 것인지" 를 할일 에 다 적어 주세요.';
          거절(call, note);
          if (막힘셈(call, '할일 비었음')) 멈출까 = '하위 작업을 할 일 없이 계속 부르고 있습니다';
          yield { type: 'tool', name: 'Task', args: call.args, result: { error: '할일이 비었습니다' }, showLabel: true };
          continue;
        }

        const 자식모드 = 하위모드(call.args?.모드 ?? call.args?.mode, 모드.id);

        /*
         * ── 다른 모델에게 떼어 주기 ─────────────────────────────────────
         *
         * 안 적으면 지금 쓰는 것 그대로다. 적었으면 **사람이 설정에 적어 둔
         * 프로필**에서만 찾는다 — 모델이 주소를 지어내면 그 자리로 나갈 뻔하고,
         * 그건 이 프로그램이 하는 약속을 그 자리에서 깨는 것이다.
         *
         * 못 찾으면 조용히 지금 모델로 돌지 않는다. 시킨 쪽은 작은 모델에게
         * 넘긴 줄 알고 창을 아끼고 있는데 실제로는 큰 모델이 다 받는 셈이라,
         * 원인을 못 찾는 쪽으로 어긋난다. 무엇이 있는지 적어 되돌려 준다.
         */
        let 자식conn = conn;
        let 자리닫기 = null;
        let 모델알림 = null;
        const 부른모델 = String(call.args?.모델 ?? call.args?.model ?? '').trim();
        if (부른모델) {
          const 찾음 = 프로필찾기(부른모델);
          if (!찾음.ok) {
            const 있는것 = 목록보기().map((x) => x.id).join(' · ') || '(설정에 프로필이 없습니다)';
            거절(call, `${찾음.why}. 쓸 수 있는 이름: ${있는것}`);
            yield { type: 'tool', name: 'Task', args: call.args, result: { error: 찾음.why }, showLabel: true };
            continue;
          }
          const 되나 = 쓸수있나(찾음.prof);
          if (!되나.ok) {
            거절(call, `${부른모델} 은 지금 못 씁니다 — ${되나.why}`);
            yield { type: 'tool', name: 'Task', args: call.args, result: { error: 되나.why }, showLabel: true };
            continue;
          }
          자식conn = 연결만들기(찾음.prof);
          모델알림 = 알릴말(conn, 자식conn);
          // 그 일이 도는 동안만 연다. 끝나면 반드시 닫는다 — 아래 finally.
          if (모델알림.다른자리) 자리닫기 = allowTemporarily(자식conn.base);
        }

        const 자식 = new Session(자식conn, {
          root: session.root,
          // 승인 방식은 그대로 물려준다. 하위가 승인을 우회하면 strict 가 거짓말이 된다.
          mode: session.mode,
          work: 자식모드,
          level: session.level,
          think: session.think,
          effort: session.effort,
          web: session.web,
          // 부모보다 적게 준다 (budget.js). 사람이 직접 정한 값이 있으면 그 절반.
          maxSteps: session.stepsSet
            ? Math.max(4, Math.floor(session.maxSteps / 2))
            // 걸음 수는 **하위가 쓸 창**으로 잰다. 부모 창으로 재면, 작은 모델에게
            // 떼어 준 일이 제 창보다 큰 걸음 수를 받아 중간에 창이 찬 채로 돈다.
            : 하위걸음수(자식모드, 자식conn.ctx),
        });
        // 스킬·명령·기억은 부모가 켤 때 한 번 찾아 든 것이다. 하위도 같은 것을 본다.
        자식.skills = session.skills;
        자식.commands = session.commands;
        자식.plugins = session.plugins;
        자식.memory = session.memory;
        자식.도구제한 = 자식도구;

        /*
         * 여닫는 줄에는 깊이를 안 붙인다.
         *
         * 이벤트가 들고 다니는 깊이는 **그 이벤트를 낸 자리 기준**이고, 위로
         * 한 겹 올라갈 때마다 1씩 붙어 절대 깊이가 된다. 그런데 이 줄은 하위가
         * 낸 것이 아니라 **하위를 떼어 주는 쪽**이 내는 경계선이다. 여기서
         * 미리 +1 을 해 두면 두 겹째에서 1이 두 번 붙어 3이 된다.
         * 경계선은 부모 자리에 그어야 어디부터가 떼어 낸 일인지 보인다.
         */
        /*
         * 다른 모델을 쓰면 **어디로 나가는지까지** 적는다.
         *
         * 조용히 여는 것이 제일 나쁘다. 상태줄의 ⌂ 는 이 세션의 연결을 보고
         * 있어서 하위가 딴 데로 나가는 것을 모른다. 그러니 이 줄과 감사기록이
         * 그 사실을 남기는 유일한 자리다.
         */
        yield {
          type: 'task_start', 목적, 모드: 자식모드, steps: 자식.maxSteps,
          모델: 모델알림?.말 ?? null, 밖으로: 모델알림?.밖으로 ?? false,
        };
        ctx.audit.tool('Task', { 목적, 모드: 자식모드, 모델: 모델알림?.말 ?? null },
          { summary: `하위 작업 시작 (${깊이 + 1}겹)${모델알림 ? ` · ${모델알림.말}` : ''}` });

        let 끝 = null;
        try {
          /*
           * ctx 를 **그대로** 넘긴다. 새로 만들면 안 된다.
           *
           * scope 를 새로 만들면 "이 폴더 밖은 못 건드린다" 가 하위에서 거짓이
           * 되고, history 를 새로 만들면 하위가 고친 파일이 `/undo` 에 안 잡히며,
           * audit 을 새로 만들면 하위가 한 일이 감사기록에서 통째로 사라진다.
           * 셋 다 "자율 실행을 사내에 설득할 때 근거가 되는" 것들이다.
           */
          for await (const ev of run(자식, ctx, 할일, { signal, 깊이: 깊이 + 1 })) {
            // 하위의 '끝' 은 부모의 끝이 아니다. 여기서 삼키고 요약으로 바꾼다 —
            // 그대로 올리면 화면이 이번 턴이 다 끝난 줄 알고 입력 상자를 세운다.
            if (ev.type === 'done' || ev.type === 'limit' || ev.type === 'stuck' || ev.type === 'aborted') {
              끝 = ev;
              break;
            }
            yield { ...ev, depth: (ev.depth ?? 0) + 1 };
          }
        } catch (err) {
          // 하위가 터져도 부모 턴은 살린다. 무엇 때문에 터졌는지는 요약에 실린다.
          끝 = { type: 'stuck', why: String(err?.message ?? err), steps: 0, files: [] };
        } finally {
          // 잠깐 열어 둔 자리는 무슨 일이 있어도 닫는다. 안 닫으면 그 세션이
          // 끝날 때까지 그 주소가 열린 채로 남는다 — '한 자리만 연다' 가 깨진다.
          try { 자리닫기?.(); } catch { /* 닫다 터져도 이번 턴은 이어간다 */ }
        }

        /*
         * 하위가 건드린 파일은 부모의 것이기도 하다. 턴 끝 목록에 같이 올린다.
         *
         * `/diff` 쪽은 따로 안 챙겨도 된다 — 하위의 도구 이벤트를 그대로 위로
         * 올려보내므로, repl.js 의 도구 처리가 부모 세션에 그대로 적어 넣는다.
         * 여기서 또 합치면 같은 변경이 두 번 세어진다.
         */
        for (const f of 끝?.files ?? []) if (f?.path) 손댄파일.add(f.path);
        // 하위가 쓴 토큰·시간도 이번 턴의 셈에 들어가야 한다. 안 그러면 /context 가 거짓말을 한다.
        session.usage.in += 자식.usage.in;
        session.usage.out += 자식.usage.out;
        session.usage.calls += 자식.usage.calls;
        session.usage.ms += 자식.usage.ms;
        session.usage.retries = (session.usage.retries ?? 0) + (자식.usage.retries ?? 0);

        const 글 = 하위요약({
          목적, 모드: 자식모드, 끝, 모델: 모델알림?.말 ?? null,
          글자수: 요약길이(conn.ctx),
          보인이름: (경로) => ctx.scope?.show?.(경로) ?? 경로,
        });
        session.push(toolMessage(conn.kind, { callId: call.id, name: 'Task', content: 글 }));
        ctx.audit.tool('Task', { 목적 }, { summary: 글.slice(0, 300) });
        yield { type: 'task_done', 목적, 모드: 자식모드, 끝, 모델: 모델알림?.말 ?? null };

        // 사용자가 중단했으면 부모도 여기서 멈춘다. 하위만 끊고 이어가면
        // 무엇이 중단된 것인지 알 수 없는 화면이 된다.
        if (끝?.type === 'aborted') { yield { type: 'aborted', steps, kept: true }; return; }
        if (끝?.type !== 'done') {
          lastToolFailed = true;
          // 하위가 계속 못 끝내면 부모가 같은 덩이를 또 떼어 준다. 그건 헛도는 것이다.
          if (막힘셈(call, `하위 ${끝?.type ?? '실패'}`)) {
            멈출까 = `하위 작업 "${목적}" 이 계속 끝을 못 봅니다`;
          }
        }
        continue;
      }

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
        /*
         * 이 모델이 실제로 어떻게 하고 있는지 (agent/grade.js).
         *
         * Edit 실패는 '파일에 있는 글을 그대로 옮겨 적는' 능력을 그대로 잰다 —
         * 작은 모델이 제일 자주 걸리는 자리다. 여기서 세어 두면 다음 걸음의
         * 프롬프트가 "Read 한 바로 다음 걸음에 고쳐라" 로 바뀐다.
         */
        if (call.name === 'Edit' && result.error) session.본것?.본것('편집실패');
        else if (!result.error) session.본것?.본것('도구성공');

        /*
         * 겪은 것을 디스크에도 쌓는다 (agent/evolve.js).
         *
         * 위의 지켜본것은 이 대화가 끝나면 사라진다. 그래서 어제 알아낸 것을
         * 오늘 또 알아내야 했다 — `pnpm` 이 이 PC 에 없다는 걸 매일 다시 겪는다.
         * 명령의 성패는 이 폴더의 사실이므로 폴더 쪽에 남긴다.
         */
        if (call.name === 'Bash' && call.args?.command) {
          ctx.배움?.명령본것(call.args.command, !result.error, result.error ?? '');
        }
        if (call.name === 'Edit' && result.error) ctx.배움?.모델본것(conn.model, '편집실패');

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
        // 한 번에 여러 개를 쓴 경우. changed 하나만 보면 나머지가 조용히 빠져서,
        // 턴 끝에 "만들어졌다" 고 확인해 주는 파일이 넷 중 하나만 나온다.
        for (const f of result.여럿 ?? []) if (f.ok && f.path) 손댄파일.add(f.path);

        // 앞에서 똑같이 부른 적이 있고 결과도 같으면, 결과를 다시 싣지 않는다.
        let 실을것 = 실을글(result);
        if (!result.error) {
          const 서명 = 서명만들기(call);
          // 결과도 한 모양으로 맞춰 견준다. 여러 도구가 받은 경로를 답에 그대로
          // 되돌려 쓰므로, 자모가 쪼개진 경로로 부르면 결과까지 달라 보인다.
          const 같은꼴 = 실을것.normalize('NFC');
          const 앞것 = 부른것.get(서명);
          if (앞것 !== undefined && 앞것 === 같은꼴) {
            session.본것?.본것('되풀이');
            const n = (막힘.get(`반복|${서명}`) ?? 0) + 1;
            막힘.set(`반복|${서명}`, n);
            실을것 = `앞에서 부른 ${call.name} 과 인자도 결과도 같습니다. 결과는 그대로라 다시 싣지 않습니다.`
              + ' 같은 것을 또 부르지 말고 다음 일로 넘어가세요.';
            if (n + 1 >= MAX_SAME) 멈출까 = `${call.name} 을 같은 인자로 계속 부르고 있습니다 — 결과가 매번 같습니다`;
          } else {
            부른것.set(서명, 같은꼴);
          }
        }

        /*
         * ── 비밀 가리기 ─────────────────────────────────────────────────
         *
         * 여기가 도구 결과가 대화로 들어가는 **유일한** 자리다. 여기서 막으면
         * 모델에게도 안 가고 `.deel/sessions/*.jsonl` 에도 안 적힌다. 한 번
         * 새면 두 벌이 되는 것을 한 곳에서 끊는다.
         *
         * 새는 자리는 거의 항상 명령 출력이다 — env · git remote -v · curl -v ·
         * 검사 실패 로그. 그래서 그런 도구만 가린다.
         *
         * 파일에서 읽어 온 글은 **안 가린다.** 가리면 모델이 가려진 글을 보고
         * 그대로 되돌려 써서, 진짜 열쇠가 있던 자리에 표가 적힌다 — 비밀을
         * 지키려다 비밀을 지우는 셈이다. 대신 무엇이 들어왔는지 알린다.
         */
        const 아는열쇠들 = [conn.key, process.env.DEEL_API_KEY].filter(Boolean);
        let 비밀 = [];
        if (가릴도구.has(call.name)) {
          const 가린 = 가리기(실을것, { 열쇠들: 아는열쇠들 });
          if (가린.가린것.length) {
            비밀 = 가린.가린것;
            실을것 = 가린.글 + 가렸다는말(가린.가린것);
          }
        } else if (result.content) {
          // 안 고치고 보기만 한다. 사람이 알아야 손을 쓸 수 있다.
          비밀 = 훑기(실을것, { 열쇠들: 아는열쇠들 });
        }
        if (비밀.length) {
          ctx.audit?.write?.('secret', {
            tool: call.name,
            가렸나: 가릴도구.has(call.name),
            무엇: 비밀.map((x) => `${x.종류}×${x.몇번}`).join(' '),
          });
        }

        session.push(toolMessage(conn.kind, {
          callId: call.id,
          name: call.name,
          content: 실을것,
        }));
        if (result.그림) 붙일그림.push(result.그림);
        yield {
          type: 'tool',
          name: call.name,
          args: call.args,
          result,
          ms,
          parallel: 함께,
          ...(비밀.length ? { 비밀: { 가렸나: 가릴도구.has(call.name), 말: 봤다는말(비밀) } } : {}),
        };
      }
    }

    // 연 그림들을 사람 말 자리로 붙인다 (backend/vision.js).
    if (붙일그림.length) {
      const 이름들 = 붙일그림.map((g) => g.show).join(' · ');
      session.push(그림메시지(conn.kind, {
        글: 붙일그림.length === 1
          ? `방금 연 그림입니다: ${이름들}`
          : `방금 연 그림 ${붙일그림.length}장입니다: ${이름들}`,
        그림들: 붙일그림,
      }));
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

    /*
     * 요약해서 접기 **전에** 도구 결과부터 접는다.
     *
     * 자리를 먹는 것은 대개 사람 말이 아니라 옛날에 읽어 둔 파일이다. 그쪽을
     * 먼저 비우면 요약 압축을 한참 미룰 수 있고, 미루는 동안 대화는 한 글자도
     * 안 잃는다. 그래도 차면 아래에서 통째로 요약한다.
     */
    if (shouldFold(session)) {
      const f = foldToolResults(session);
      if (f.접은것) yield { type: 'folded', ...f };
      // 그림은 사람 말 자리에 실려서 위 접기가 못 건드린다. 따로 뺀다.
      const g = foldImages(session);
      if (g.뺀것) yield { type: 'images_folded', ...g };
    }

    // 컨텍스트가 차오르면 오래된 대화를 '요약해서' 접는다. 그냥 자르면 하던 일을 잊는다.
    if (shouldCompact(session)) {
      yield { type: 'compacting' };
      // 요약을 부르다 서버가 막으면 그 알림도 화면으로 — '접는 중' 뒤에 60초를 숨기지 않는다.
      const 편지 = 우편함((onBackoff) => compact(session, { auto: true, signal, onBackoff }));
      for await (const 알림 of 편지.소식()) yield 알림;
      const r = await 편지.부름;
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
