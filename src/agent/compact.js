// 컨텍스트가 차면 오래된 대화를 '요약해서' 이어 간다.
//
// 그냥 잘라내면 방금까지 뭘 하고 있었는지 모델이 잊는다. 파일을 다시 읽고,
// 이미 고친 곳을 또 고치고, 정해 둔 방침을 어긴다. 그래서 자르는 대신 접는다.
//
// 접을 때 지켜야 하는 것 두 가지:
//   1) 도구 호출과 그 결과는 한 몸이다. 사이를 끊으면 규격 위반이라 서버가 400 을 낸다.
//   2) 요약도 모델이 만든다. 그 요청이 실패하면 프로그램이 멈추면 안 된다 —
//      실패하면 옛 방식(그냥 자르기)으로 물러선다.
import { chat, 부른것들, 결과들, 도구결과인가 } from '../backend/adapter.js';
import { estimateTokens, safeCut, safeHead, 못박을것 } from './session.js';
import { wasCut } from './effort.js';
import { 그림장수, 글만 } from '../backend/vision.js';

// 몇 %에서 접기 시작할지. 접고 나서 다시 금방 차면 아무 소용이 없으니 넉넉히 비운다.
export const COMPACT_AT = 0.8;
export const KEEP_TAIL_RATIO = 0.3;   // 최근 대화 중 남길 비율
export const KEEP_HEAD = 2;           // 맨 처음 요청은 언제나 남긴다 (목표가 거기 있다)

/*
 * ── 그 전에, 도구 결과부터 접는다 ──────────────────────────────────────
 *
 * 요약 압축은 잃는 것이 크다. 사람이 한 말도, 모델이 왜 그렇게 정했는지도
 * 세 줄로 줄어든다. 그런데 자리를 실제로 먹고 있는 것은 대개 그쪽이 아니다.
 *
 *   Read 로 600줄짜리 파일을 한 번 열면 32k 창의 15% 가 그 자리에서 사라지고,
 *   그 사본은 대화가 끝날 때까지 이력에 그대로 눌러앉는다. 이미 다 읽고 고친
 *   파일인데도 그렇다. 세 번 읽으면 창의 절반이 옛날 파일 내용이다.
 *
 * 그래서 80% 에서 통째로 요약하기 전에, 먼저 **오래된 도구 결과만** 한 줄로
 * 접는다. 사람 말과 모델의 판단은 한 글자도 안 건드린다. 무엇을 읽었는지는
 * 남기므로 모델은 필요하면 그 파일을 다시 읽으면 된다 — 읽는 값은 싸고,
 * 하던 일을 잊는 값은 비싸다.
 *
 * 최근 것은 안 접는다. 방금 읽은 것을 접으면 그 자리에서 다시 읽게 되고,
 * 그러면 접은 보람이 없다.
 */
export const FOLD_AT = 0.55;      // 이 아래로는 접을 이유가 없다
export const KEEP_RECENT = 4;     // 최근 도구 결과 이만큼은 원문 그대로 둔다
export const FOLD_MIN = 300;      // 이보다 작으면 접어도 자리가 안 준다 (글자 수)
export const 접힘표 = '(접힘)';

/*
 * ── 접기는 **묶음으로** 한다 ────────────────────────────────────────────
 *
 * 여태 이 함수는 걸음마다 「최근 넷 빼고 다」 를 접었다. 얼핏 맞는 말인데,
 * 걸음마다 도구 결과가 하나씩 늘어나므로 실제로 하는 일은
 * **걸음마다 딱 하나씩 접는 것**이었다.
 *
 * 접는다는 것은 이력 가운데 있는 글을 **딴 글로 바꿔치는 것**이다. 그러면
 * 그 자리부터 뒤가 전부 새 글이 되고, 프리픽스 캐시는 거기서 끊긴다.
 * 즉 걸음마다 한 줄을 아끼려고 **걸음마다 대화 전체를 다시 보내고 있었다.**
 * 아끼려던 것보다 훨씬 크게 쓴 셈이다.
 *
 * 그래서 문턱을 둔다 — 이만큼 비울 수 있을 때만 접는다. 그러면 접기가
 * 가끔 크게 일어나고, 그 사이에는 앞머리가 가만히 있는다.
 */
export const 최소이득 = 2000;

/** 인자에서 사람이 알아볼 한 조각만 뽑는다. 경로가 제일 쓸모 있다. */
function 어디(args) {
  if (!args || typeof args !== 'object') return '';
  for (const k of ['file_path', 'path', 'pattern', 'command', 'query', 'url', '목적']) {
    const v = args[k];
    if (typeof v === 'string' && v.trim()) return v.trim().replace(/\s+/g, ' ').slice(0, 60);
  }
  return '';
}

/*
 * ── 그림은 따로 뺀다 ───────────────────────────────────────────────────
 *
 * 위의 접기는 도구 결과(role:'tool')만 건드린다. 사람 말은 한 글자도 안 건드리는
 * 것이 그 함수의 약속이라 그렇다. 그런데 그림은 **사람 말 자리에** 실린다
 * (backend/vision.js 의 그림메시지 머리말 — 도구 결과에는 못 넣는다).
 *
 * 그림 한 장은 base64 로 몇 MB 다. 화면 사진 몇 장을 이어 보여 주면 대화가
 * 그것만으로 무거워지고, 오래된 사진은 이미 이야기가 끝난 것이다. 그래서
 * 최근 몇 장만 남기고 나머지는 **무엇이었는지만 남기고** 뺀다.
 *
 * 사람이 쓴 말은 그대로 둔다 — 빼는 것은 그림 조각뿐이다.
 */
export const KEEP_IMAGES = 2;

/** 오래된 그림을 이름만 남기고 뺀다. @returns {{뺀것:number, 뺀것들:Array}} */
export function foldImages(session, { keep = KEEP_IMAGES } = {}) {
  const ms = session.messages ?? [];
  const 자리 = [];
  ms.forEach((m, i) => { if (그림장수(m)) 자리.push(i); });

  const 뺄것 = 자리.slice(0, Math.max(0, 자리.length - keep));
  const 뺀것들 = [];
  for (const i of 뺄것) {
    const m = ms[i];
    const 장수 = 그림장수(m);
    const 글 = 글만(m);
    ms[i] = { ...m, content: `${글}
${접힘표} 그림 ${장수}장은 자리를 비우려고 뺐습니다. 필요하면 다시 여세요.` };
    delete ms[i].images;
    뺀것들.push({ 장수 });
  }
  return { 뺀것: 뺄것.length, 뺀것들 };
}

export function shouldFold(session, at = FOLD_AT) {
  const b = session.breakdown();
  return b.total > 0 && b.used / b.total >= at;
}

/**
 * 오래된 도구 결과를 한 줄로 접는다.
 *
 * 짝은 안 건드린다 — 메시지를 지우는 게 아니라 **내용만** 바꾸므로 호출과
 * 결과의 짝이 그대로다. 규격이 깨질 자리가 아예 없다.
 *
 * @returns {{접은것: number, 아낀토큰: number}}
 */
export function foldToolResults(session, { keep = KEEP_RECENT, min = FOLD_MIN, 이득문턱 = 최소이득 } = {}) {
  const ms = session.messages ?? [];

  /*
   * 호출 쪽에서 이름과 인자를 가져온다. 결과 메시지에는 그게 안 실려 있다.
   *
   * 부름도 결과도 규격마다 다른 자리에 담긴다(backend/adapter.js). 여기가
   * `tool_calls` 와 `role:'tool'` 만 보던 동안 Anthropic 창구에서는 **접은 것이
   * 늘 0 이었다** — 55% 에서 싸게 자리를 비우는 단계가 통째로 죽어 있었고,
   * 그대로 80% 의 손실 있는 요약으로 직행했다. 캐시가 제일 중요한 창구에서
   * 캐시를 지키려고 만든 단계가 안 돈 것이다.
   */
  const 이름표 = new Map();
  for (const m of ms) {
    for (const c of 부른것들(m)) if (c.id) 이름표.set(c.id, { name: c.name ?? '도구', args: c.args ?? {} });
  }

  const 자리 = [];
  ms.forEach((m, i) => {
    if (!도구결과인가(m)) return;
    const 것들 = 결과들(m);
    // 한 메시지에 결과가 여럿 실리는 규격이 있다. 그때는 이어 붙여 한 자리로 본다.
    const 글 = 것들.map((x) => x.글).join('\n');
    if (글.startsWith(접힘표)) return;      // 이미 접은 것
    const 첫 = 것들[0];
    자리.push({ i, 글, 이름: 이름표.get(첫?.id)?.name ?? 첫?.name ?? '' });
  });

  /*
   * ── 가장 최근 할 일 목록은 안 접는다 ─────────────────────────────────
   *
   * 접힘 문구는 「필요하면 다시 읽으세요」다. 파일이면 맞는 말이다 — 읽는
   * 값은 싸고 하던 일을 잊는 값은 비싸니까. 그런데 **할 일 목록은 다시
   * 읽을 파일이 없다.** 접는 순간 남은 항목이 어디에도 없어진다.
   *
   * 그래서 긴 작업일수록 뒤로 갈수록 시킨 것을 빠뜨렸다 — 「대화를 잘
   * 기억 못 한다」로 제보받은 것의 큰 몫이 여기였다.
   *
   * 옛 목록은 그대로 접는다. 새 목록이 나온 순간 옛것은 이미 틀린 것이라
   * 남겨 둘수록 해롭다. 지키는 것은 **마지막 하나**뿐이고, 목록 하나는
   * 몇백 글자라 자리도 거의 안 먹는다.
   */
  const 지킬할일 = 자리.filter((x) => x.이름 === 'TodoWrite').at(-1)?.i ?? -1;

  const 접을것 = 자리
    .slice(0, Math.max(0, 자리.length - keep))
    .filter((x) => x.글.length >= min && x.i !== 지킬할일);

  /*
   * 비울 수 있는 양이 문턱에 못 미치면 **이번에는 안 접는다.**
   *
   * 한 줄 아끼자고 앞머리를 깨면 그 걸음에 대화가 통째로 다시 나간다.
   * 모아 두었다가 한 번에 접는 편이 눈에 띄게 싸다. 자리가 정말 모자라면
   * 80% 에서 요약 압축이 받아 준다 — 안전망은 그쪽에 있다.
   */
  const 예상이득 = 접을것.reduce((a, x) => a + estimateTokens(x.글), 0);
  if (예상이득 < 이득문턱) {
    return { 접은것: 0, 아낀토큰: 0, 접은것들: [], 미룸: true, 모인것: 예상이득 };
  }

  let 아낀토큰 = 0;
  // 무엇을 버렸는지 이름으로 남긴다.
  //
  // 조용히 버리면 사람이 모른다 — "아까 그 파일 내용 어디 갔지" 를 스스로 답할
  // 길이 없다. 접힌 자리에 표시가 남긴 하지만 그건 모델이 보는 쪽이고,
  // 사람 화면에는 여기서 돌려주는 목록으로 알려 준다.
  const 접은것들 = [];

  for (const { i, 글 } of 접을것) {
    const m = ms[i];
    const 아는것 = 이름표.get(m.tool_call_id) ?? { name: m.tool_name ?? '도구', args: {} };
    const 곳 = 어디(아는것.args);
    const 줄수 = 글.split('\n').length;
    const 전 = estimateTokens(글);
    ms[i] = {
      ...m,
      content: `${접힘표} ${아는것.name}${곳 ? `(${곳})` : ''} — ${줄수}줄. `
        + '자리를 비우려고 내용을 접었습니다. 필요하면 다시 읽으세요.',
    };
    const 아낀것 = 전 - estimateTokens(ms[i].content);
    아낀토큰 += 아낀것;
    /*
     * 자른 표시용 이름(곳)과 **진짜 경로**를 따로 담는다.
     *
     * 곳 은 화면에 쓰려고 60자에서 자른 것이라, 이걸로 파일 기억을 지우면
     * 긴 경로가 안 맞아서 조용히 안 지워진다 — 그러면 접힌 파일을 다시
     * 읽을 때 「앞에서 읽은 그대로입니다」 만 돌아간다(agent/filemem.js).
     */
    const 경로 = typeof 아는것.args?.file_path === 'string'
      ? 아는것.args.file_path
      : (typeof 아는것.args?.path === 'string' ? 아는것.args.path : null);
    접은것들.push({ 도구: 아는것.name, 곳, 경로, 줄수, 토큰: Math.max(0, 아낀것) });
  }

  return { 접은것: 접을것.length, 아낀토큰: Math.max(0, 아낀토큰), 접은것들 };
}

/**
 * 접힌 파일을 **파일 기억에서 지울 때 쓸 열쇠** (agent/filemem.js).
 *
 * 접은 자리에 남은 경로는 모델이 적어 보낸 글자 그대로다 — 대개 `src/a.js`
 * 같은 상대 경로다. 그런데 파일 기억은 `ctx.scope.resolve()` 를 거친 **절대
 * 경로**로 묶여 있다(tools/index.js 의 읽은것). 그대로 지우면 Map 이 안 맞아서
 * 조용히 아무것도 안 지워지고, 그러면 접혀 사라진 파일을 다시 읽을 때
 * 「앞에서 읽은 그대로입니다」 가 돌아간다. 모델은 대화 어디에도 없는 글을
 * 가리키는 쪽지를 받고, 결국 또 읽는다 — 접기로 아낀 것을 되읽기로 도로 쓴다.
 *
 * 울타리 밖이라 못 풀면 적힌 그대로 돌려준다. 둘 다 지워 보는 것은 부르는
 * 쪽 몫이다 — 지우는 일은 없는 열쇠에도 안전하다.
 *
 * @param {string} 경로  접은 자리에 적혀 있던 경로 (모델이 준 그대로)
 * @param {object|null} scope  safety/guard.js 의 울타리
 * @returns {string} 지울 때 쓸 열쇠
 */
export function 접힌파일열쇠(경로, scope = null) {
  const 적힌것 = String(경로 ?? '');
  if (!적힌것) return 적힌것;
  try { return scope?.resolve?.(적힌것) ?? 적힌것; } catch { return 적힌것; }
}

const 요약지시 = `지금까지의 대화를 다음 형식으로 요약하세요. 이어서 일할 사람이 이것만 보고도 계속할 수 있어야 합니다.
추측하지 말고 실제로 오간 내용만 쓰세요. 한국어로, 각 항목 3줄 이내로 쓰세요.

## 목표
사용자가 무엇을 시켰는가.

## 한 일
어떤 파일을 어떻게 고쳤는가. 파일 경로를 그대로 적으세요.

## 알아낸 것
코드·환경에 대해 확인된 사실. 다시 조사하지 않아도 되도록.

## 정한 것
어떤 방침·이름·구조로 하기로 했는가. 사용자가 거절한 것도 적으세요.

## 남은 일
아직 안 한 것.`;

// 자르는 자리를 찾는 두 함수는 session.js 에 있다. 접기와 그냥 줄이기(trim)가
// **같은 잣대**를 써야 하기 때문이다 — 한쪽만 짝을 맞추면 물러서는 순간 대화가 망가진다.
// 쓰던 자리가 있으니 이름은 그대로 내보낸다.
export { safeCut, safeHead } from './session.js';

/*
 * 시킨 말과 남은 할 일을 못 박는 것은 session.js 에 있다. 접기와 줄이기가
 * **같은 것**을 박아야 하기 때문이다 — 한쪽만 고치면 물러서는 순간 대화가
 * 어긋난다. safeCut·safeHead 를 그리 둔 것과 같은 까닭이다.
 */
export { 못박은요청, 못박은할일, 못박을것 } from './session.js';

/** 접을 구간과 남길 구간을 나눈다. */
export function split(messages, { keepHead = KEEP_HEAD, tailRatio = KEEP_TAIL_RATIO } = {}) {
  const n = messages.length;
  const wantTail = Math.max(4, Math.floor(n * tailRatio));
  const cut = safeCut(messages, n - wantTail);
  const head = safeHead(messages, Math.min(keepHead, cut));
  if (cut <= head) return null;                    // 접을 것이 없다
  const fold = messages.slice(head, cut);
  if (fold.length < 4) return null;
  return { head: messages.slice(0, head), fold, tail: messages.slice(cut) };
}

// 요약에 넣을 글. 도구 결과는 길기만 하고 요약에 도움이 안 되니 앞부분만 준다.
function transcript(msgs) {
  const out = [];
  for (const m of msgs) {
    /*
     * 누가 한 말인지도 규격을 봐야 안다. Anthropic 은 도구 결과를 **사람
     * 차례**에 싣기 때문에, role 만 보면 도구가 뱉은 것이 전부 「사용자」 가
     * 된다. 그러면 아래 400자 자르기도 안 걸려서, 요약을 시키는 요청에 도구
     * 출력이 통째로 실려 나간다 — 요약하려는 대화보다 요약 요청이 더 커진다.
     * 그리고 그렇게 만든 요약이 대화를 **대신하게** 된다.
     */
    const 결과인가 = 도구결과인가(m);
    const who = 결과인가 ? '도구결과' : (m.role === 'user' ? '사용자' : m.role === 'assistant' ? '나' : '도구결과');
    let body = 결과인가
      ? 결과들(m).map((x) => x.글).join('\n')
      : (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''));
    if (결과인가) body = body.slice(0, 400);
    const calls = 부른것들(m).map((t) => `${t.name}(${JSON.stringify(t.args ?? {}).slice(0, 160)})`);
    if (calls.length) out.push(`${who}: [도구] ${calls.join(', ')}`);
    if (body.trim()) out.push(`${who}: ${body.trim()}`);
  }
  return out.join('\n');
}

/**
 * 실제로 접는다.
 * @returns {{ok:boolean, folded:number, before:number, after:number, summary?:string, why?:string}}
 */
export async function compact(session, { auto = false, signal = null, onBackoff = null } = {}) {
  const before = session.breakdown().used;
  const parts = split(session.messages);
  if (!parts) return { ok: false, why: '접을 만큼 쌓이지 않았습니다', folded: 0, before, after: before };

  const text = transcript(parts.fold);
  let summary = null;
  // 왜 못 받았는지. 「못 받았다」 만으로는 사람이 할 수 있는 일이 없다.
  let 못한까닭 = null;
  // 서버가 잠깐 막아 다시 부른 횟수. 알림은 부르는 쪽(onBackoff)이 화면에 내고, 셈은 여기서 한다.
  let 다시 = 0;
  const 셈하기 = (n) => { session.usage.retries = (session.usage.retries ?? 0) + Math.max(0, n); };
  try {
    const r = await chat(session.conn, {
      messages: [
        { role: 'system', content: '너는 대화를 요약한다. 요약 외에 다른 말을 하지 않는다.' },
        { role: 'user', content: `${요약지시}\n\n----- 대화 -----\n${text}` },
      ],
      maxTokens: 1200,
      think: session.conn.kind === 'ollama' ? false : 'low',   // 요약에 깊은 사고는 필요 없다
      // 사용자가 Ctrl+C 를 누르면 이것도 멈춰야 한다. 안 받으면 답하는 도중
      // 화면이 멈춰 있고 아무 키도 안 먹는 것처럼 보인다.
      signal,
      onBackoff: (알림) => { 다시 += 1; onBackoff?.(알림); },
      // 요약 하나에 5분을 기다릴 이유가 없다. 그만한 서버면 그냥 줄이는 편이 빠르다.
      timeout: 60000,
    });
    셈하기(다시);
    /*
     * 받은 것을 그대로 믿지 않는다. 이 요약은 **대화를 대신하게 될 글**이라,
     * 반쪽이거나 거절이면 대화 전체가 그 반쪽으로 바뀐다.
     *
     *   · 상한에 걸려 잘린 요약 — 비어 있지 않으니 그냥 통과했다. 그러면
     *     대화가 문장 중간에서 끊긴 한 토막으로 바뀐다.
     *   · 거절 — 이 규격은 거절 글을 `content` 에 담는다(adapter.js). 그러면
     *     대화 전체가 「그건 도와드릴 수 없습니다」 한 줄이 된다.
     *
     * 둘 다 `ok: true` 로 보고됐다. 그냥 줄이는 편이 훨씬 낫다.
     */
    if (r?.거절) 못한까닭 = '요약을 거절당했습니다';
    else if (wasCut(r)) 못한까닭 = '요약이 상한에서 잘렸습니다';
    else summary = (r.content ?? '').trim();
  } catch (err) {
    // 사용자가 끊은 것은 실패가 아니다. 대화를 건드리지 않고 그대로 둔다 —
    // 여기서 물러서기(trim)까지 해 버리면, 끊었는데 대화가 줄어 있게 된다.
    if (err?.name === 'Aborted' || signal?.aborted) {
      셈하기(다시 - 1);   // 기다리다 끊긴 마지막 것은 다시 부른 것이 아니다
      return { ok: false, aborted: true, why: '중단했습니다', folded: 0, before, after: before };
    }
    셈하기(다시);
    /*
     * 서버가 한 말을 **버리지 않는다.**
     *
     * 여태 `err` 를 통째로 흘렸다. 열쇠가 만료돼 401 이든, 게이트웨이가
     * 모르는 칸에 400 을 내든, 모델 이름이 틀렸든 화면에는 늘 「요약을 받지
     * 못해 그냥 줄였습니다」 한 줄이었다. 그러면 사람은 압축이 왜 매번
     * 물러서는지 알 길이 없고, 고칠 데는 대개 한 줄이면 되는 것이었다.
     */
    못한까닭 = err?.serverMessage
      ? `요약을 못 받았습니다 — ${String(err.serverMessage).replace(/\s+/g, ' ').trim().slice(0, 120)}`
      : `요약을 못 받았습니다 — ${String(err?.message ?? err).slice(0, 120)}`;
    summary = null;
  }

  // 요약을 못 받았으면 옛 방식으로 물러선다. 멈추지는 않는다.
  if (!summary) {
    const folded = session.trim();
    /*
     * 여기서도 들고 있던 파일 내용을 버린다. 아래 성공한 길과 **같은 까닭**이다.
     *
     * 이 자리를 한동안 빠뜨리고 있었다. 성공한 길에만 넣어 두면, 정작 요약을
     * 못 받아 물러선 자리 — 서버가 흔들릴 때라 제일 자주 지나가는 길 — 에서만
     * 조용히 어긋난다. trim() 은 옛 메시지를 진짜로 지우므로, 지운 뒤에도
     * 「앞에서 읽은 그대로입니다」 를 내밀면 모델은 대화에 없는 글을 가리키는
     * 쪽지만 받는다. 통째로 다시 싣는 것보다 훨씬 나쁘다.
     */
    if (folded > 0) session.파일기억?.잊기();
    const after = session.breakdown().used;
    return {
      ok: folded > 0, folded, before, after, fallback: true,
      why: 못한까닭 ? `${못한까닭}. 그냥 줄였습니다` : '요약을 받지 못해 그냥 줄였습니다',
    };
  }

  session.messages = [
    ...parts.head,
    {
      role: 'user',
      content: `[앞선 대화 ${parts.fold.length}개를 요약해 접었습니다. 아래가 그 요약입니다.]\n\n${summary}\n\n`
        + 못박을것(session)
        + '[요약 끝. 이어서 진행하세요. 파일 내용이 필요하면 다시 읽으세요.]',
    },
    ...parts.tail,
  ];
  session.filesRead.clear();   // 접힌 뒤에는 읽어 둔 파일도 기억에서 지운다
  /*
   * 들고 있던 파일 내용도 같이 버린다.
   *
   * 「앞에서 읽은 그대로입니다」 는 그 앞엣것이 대화에 살아 있을 때만 참이다.
   * 접어 버린 뒤에도 그 쪽지를 내밀면, 모델은 있지도 않은 글을 가리키는 말만
   * 받는다 — 통째로 다시 싣는 것보다 훨씬 나쁘다.
   */
  session.파일기억?.잊기();

  const after = session.breakdown().used;
  return { ok: true, folded: parts.fold.length, before, after, summary, auto };
}

/** 지금 접어야 하는가. */
export function shouldCompact(session, at = COMPACT_AT) {
  const b = session.breakdown();
  return b.total > 0 && b.used / b.total >= at;
}
