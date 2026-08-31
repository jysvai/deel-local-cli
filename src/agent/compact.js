// 컨텍스트가 차면 오래된 대화를 '요약해서' 이어 간다.
//
// 그냥 잘라내면 방금까지 뭘 하고 있었는지 모델이 잊는다. 파일을 다시 읽고,
// 이미 고친 곳을 또 고치고, 정해 둔 방침을 어긴다. 그래서 자르는 대신 접는다.
//
// 접을 때 지켜야 하는 것 두 가지:
//   1) 도구 호출과 그 결과는 한 몸이다. 사이를 끊으면 규격 위반이라 서버가 400 을 낸다.
//   2) 요약도 모델이 만든다. 그 요청이 실패하면 프로그램이 멈추면 안 된다 —
//      실패하면 옛 방식(그냥 자르기)으로 물러선다.
import { chat } from '../backend/adapter.js';
import { estimateTokens, safeCut, safeHead } from './session.js';
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
export function foldToolResults(session, { keep = KEEP_RECENT, min = FOLD_MIN } = {}) {
  const ms = session.messages ?? [];

  // 호출 쪽에서 이름과 인자를 가져온다. 결과 메시지에는 그게 안 실려 있다.
  const 이름표 = new Map();
  for (const m of ms) {
    for (const c of m?.tool_calls ?? []) {
      let args = {};
      try { args = JSON.parse(c?.function?.arguments ?? '{}'); } catch { /* 못 읽으면 그만 */ }
      if (c?.id) 이름표.set(c.id, { name: c?.function?.name ?? '도구', args });
    }
  }

  const 자리 = [];
  ms.forEach((m, i) => {
    if (m?.role !== 'tool') return;
    const 글 = typeof m.content === 'string' ? m.content : '';
    if (글.startsWith(접힘표)) return;      // 이미 접은 것
    자리.push({ i, 글 });
  });

  const 접을것 = 자리.slice(0, Math.max(0, 자리.length - keep)).filter((x) => x.글.length >= min);
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
    접은것들.push({ 도구: 아는것.name, 곳, 줄수, 토큰: Math.max(0, 아낀것) });
  }

  return { 접은것: 접을것.length, 아낀토큰: Math.max(0, 아낀토큰), 접은것들 };
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
 * ── 시킨 말은 요약하지 않는다 ───────────────────────────────────────────
 *
 * 요약 지시에는 「## 목표 — 사용자가 무엇을 시켰는가」 가 있다. 그런데 요약은
 * 요약이다. 네 가지를 적어 준 요청이 「네 가지를 고쳐 달라고 했다」 한 줄로
 * 뭉개지고, **그 네 가지가 무엇이었는지는 사라진다.** 접힌 뒤로는 아무리
 * 찾아도 원문이 없으니, 남은 것을 이어 하려 해도 무엇이 남았는지 모른다.
 *
 * "요청사항이 다량일 경우 몇 번 까먹거나 누락되거나" 의 절반이 여기였다.
 *
 * 그래서 이번에 시킨 말을 **글자 그대로** 한 번 더 박아 둔다. 요약 모델이
 * 무엇을 하든 이 줄은 그대로 남는다. 길면 앞부분만 — 그래도 항목 목록은
 * 대개 앞에 있다.
 */
const 못박을길이 = 1200;

export function 못박은요청(session) {
  const 원문 = String(session?.이번요청 ?? '').trim();
  if (!원문) return '';
  const 실을것 = 원문.length > 못박을길이
    ? `${원문.slice(0, 못박을길이)}\n…(뒷부분 줄임)`
    : 원문;
  return `[이번에 시킨 말 — 요약이 아니라 원문 그대로입니다. 여기 적힌 것을 빠짐없이 하세요.]\n${실을것}\n\n`;
}

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
    const who = m.role === 'user' ? '사용자' : m.role === 'assistant' ? '나' : '도구결과';
    let body = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    if (m.role === 'tool') body = body.slice(0, 400);
    const calls = (m.tool_calls ?? []).map((t) => {
      const fn = t.function ?? t;
      const args = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {});
      return `${fn.name}(${args.slice(0, 160)})`;
    });
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
    summary = (r.content ?? '').trim();
  } catch (err) {
    // 사용자가 끊은 것은 실패가 아니다. 대화를 건드리지 않고 그대로 둔다 —
    // 여기서 물러서기(trim)까지 해 버리면, 끊었는데 대화가 줄어 있게 된다.
    if (err?.name === 'Aborted' || signal?.aborted) {
      셈하기(다시 - 1);   // 기다리다 끊긴 마지막 것은 다시 부른 것이 아니다
      return { ok: false, aborted: true, why: '중단했습니다', folded: 0, before, after: before };
    }
    셈하기(다시);
    summary = null;
  }

  // 요약을 못 받았으면 옛 방식으로 물러선다. 멈추지는 않는다.
  if (!summary) {
    const folded = session.trim();
    const after = session.breakdown().used;
    return { ok: folded > 0, folded, before, after, why: '요약을 받지 못해 그냥 줄였습니다', fallback: true };
  }

  session.messages = [
    ...parts.head,
    {
      role: 'user',
      content: `[앞선 대화 ${parts.fold.length}개를 요약해 접었습니다. 아래가 그 요약입니다.]\n\n${summary}\n\n`
        + 못박은요청(session)
        + '[요약 끝. 이어서 진행하세요. 파일 내용이 필요하면 다시 읽으세요.]',
    },
    ...parts.tail,
  ];
  session.filesRead.clear();   // 접힌 뒤에는 읽어 둔 파일도 기억에서 지운다

  const after = session.breakdown().used;
  return { ok: true, folded: parts.fold.length, before, after, summary, auto };
}

/** 지금 접어야 하는가. */
export function shouldCompact(session, at = COMPACT_AT) {
  const b = session.breakdown();
  return b.total > 0 && b.used / b.total >= at;
}
