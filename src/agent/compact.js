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
import { estimateTokens } from './session.js';

// 몇 %에서 접기 시작할지. 접고 나서 다시 금방 차면 아무 소용이 없으니 넉넉히 비운다.
export const COMPACT_AT = 0.8;
export const KEEP_TAIL_RATIO = 0.3;   // 최근 대화 중 남길 비율
export const KEEP_HEAD = 2;           // 맨 처음 요청은 언제나 남긴다 (목표가 거기 있다)

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

/**
 * 도구 호출과 결과가 갈라지지 않는 자리를 찾는다.
 * i 번째부터 남긴다고 할 때, 안전한 i 로 옮겨 준다.
 */
export function safeCut(messages, i) {
  let k = Math.max(0, Math.min(i, messages.length));
  // tool 결과로 시작하면 그 앞의 assistant(tool_calls) 가 없어 규격이 깨진다. 앞으로 당긴다.
  while (k > 0 && messages[k]?.role === 'tool') k--;
  return k;
}

/**
 * 머리 쪽 자르는 자리.
 * 머리가 '결과를 기다리는 도구 호출' 로 끝나면 그 결과가 접혀 없어져 짝이 깨진다.
 * 그런 assistant 는 머리에서 뺀다 — 접히는 쪽에 같이 넘긴다.
 */
export function safeHead(messages, k) {
  let h = Math.max(0, Math.min(k, messages.length));
  while (h > 0 && messages[h - 1]?.tool_calls?.length) h--;
  return h;
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
export async function compact(session, { auto = false } = {}) {
  const before = session.breakdown().used;
  const parts = split(session.messages);
  if (!parts) return { ok: false, why: '접을 만큼 쌓이지 않았습니다', folded: 0, before, after: before };

  const text = transcript(parts.fold);
  let summary = null;
  try {
    const r = await chat(session.conn, {
      messages: [
        { role: 'system', content: '너는 대화를 요약한다. 요약 외에 다른 말을 하지 않는다.' },
        { role: 'user', content: `${요약지시}\n\n----- 대화 -----\n${text}` },
      ],
      maxTokens: 1200,
      think: session.conn.kind === 'ollama' ? false : 'low',   // 요약에 깊은 사고는 필요 없다
    });
    summary = (r.content ?? '').trim();
  } catch (err) {
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
      content: `[앞선 대화 ${parts.fold.length}개를 요약해 접었습니다. 아래가 그 요약입니다.]\n\n${summary}\n\n[요약 끝. 이어서 진행하세요. 파일 내용이 필요하면 다시 읽으세요.]`,
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
