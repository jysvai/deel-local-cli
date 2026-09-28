/*
 * 글 속에 적힌 도구 부름을 건진다 (2.1.3).
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 *
 * 작은 모델은 도구를 **글로** 부른다. 서버가 그 모델의 부름 꼴을 모르거나(채팅 틀이 없는 GGUF ·
 * 오래된 Ollama 틀 · 사내 게이트웨이의 변환 누락), 모델이 배운 꼴과 서버가 기다리는 꼴이 다르면
 * `tool_calls` 는 비어 오고 답 글에 이런 것이 실린다.
 *
 *     <tool_call>{"name": "Read", "arguments": {"file_path": "a.js"}}</tool_call>     Hermes · Qwen
 *     <function=Read>{"file_path": "a.js"}</function>                                 Llama 3.1
 *     <tool_call><function=Read><parameter=file_path>a.js</parameter></function>…      Qwen3-Coder
 *     [TOOL_CALLS] [{"name": "Read", "arguments": {...}}]                              Mistral
 *     ```json {"name": "Read", "arguments": {...}} ```                                 표 없는 것
 *
 * 여태 이것을 「도구를 안 부르고 글로만 답했다」 로 읽고 턴을 끝냈다. 모델은 일을 하려 했는데 우리가
 * 못 알아들은 것이다. 이제 **우리가 내준 도구 이름**으로 적힌 것만 건져 진짜 부름으로 돌린다.
 * 건진 부름도 네이티브 부름과 같은 관문(모드 · 승인 · 정책 바닥)을 지난다 — 건졌다고 덜 묻지 않는다.
 *
 * ── 무엇을 안 건지나 ────────────────────────────────────────────────────
 *
 *   · 내준 적 없는 이름. 글 속 예시(`{"name": "search", ...}`)를 부름으로 읽으면 안 된다. 한 덩이에
 *     모르는 이름이 하나라도 섞이면 그 덩이는 통째로 안 건진다.
 *   · 울타리(```) 안에 든 표는 예시다 — 형식을 설명하는 답이 그렇게 적는다.
 *   · 울타리나 맨 JSON 꼴은 **답이 거의 그것 하나뿐일 때만** 건진다. 설명 글 사이에 든 예시를
 *     부름으로 읽으면, 쓰기·명령 도구는 사람이 시키지 않은 일을 한다. 울타리가 둘 이상이면 예시를
 *     늘어놓은 글로 본다. 표(<tool_call> 따위)가 붙은 꼴은 모델이 부르려고 쓴 것이라 어디에 있든 건진다.
 */

import { 읽어보기 } from './loosejson.js';

const 객체인가 = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/*
 * 이름과 인자를 한 덩이에서 뽑는다. 모델마다 칸 이름이 다르다 —
 * `arguments`(OpenAI · Hermes) · `parameters`(Llama) · `args` · `input`(Anthropic 을 흉내 낸 것).
 * `function: {name, arguments}` 로 한 겹 싸서 오기도 한다.
 */
function 부름꼴(v) {
  if (!객체인가(v)) return null;
  const 속 = 객체인가(v.function) ? v.function : v;
  const 이름 = typeof 속.name === 'string' ? 속.name : null;
  if (!이름) return null;
  let 인자 = 속.arguments ?? 속.parameters ?? 속.args ?? 속.input ?? {};
  if (typeof 인자 === 'string') 인자 = 읽어보기(인자.trim() || '{}');
  if (!객체인가(인자)) return null;
  return { 이름, 인자 };
}

/** 한 덩이 JSON 이 부름 하나거나 부름 여럿의 배열이면 [{이름, 인자}], 아니면 null. */
function 부름들로(v) {
  const 목록 = Array.isArray(v) ? v : [v];
  if (!목록.length) return null;
  const out = [];
  for (const x of 목록) {
    const 하나 = 부름꼴(x);
    if (!하나) return null;
    out.push(하나);
  }
  return out;
}

/*
 * Qwen3-Coder 꼴: <function=이름> <parameter=칸>값</parameter> … </function>. 값은 JSON 이면 JSON 으로.
 *
 * 수는 **글자 그대로 되돌아올 때만** 수로 읽는다. 칸 값은 날글이라 `01234`(번호) · `1.50`(판) 도 온다 —
 * 수로 읽으면 앞 0 과 끝 0 이 사라진 다른 값이 도구로 간다(2차 눈이 짚었다).
 */
function 칸꼴(몸) {
  const 인자 = {};
  const 칸무늬 = /<parameter=([^>\s]+)>\s*([\s\S]*?)\s*<\/parameter>/g;
  let m;
  let 있었나 = false;
  while ((m = 칸무늬.exec(몸))) {
    있었나 = true;
    const 날것 = m[2];
    const t = 날것.trim();
    let 읽은;
    if (/^[[{"]|^(?:true|false|null|True|False|None)$/.test(t)) 읽은 = 읽어보기(t);
    else if (/^-?\d/.test(t) && String(Number(t)) === t) 읽은 = Number(t);
    인자[m[1]] = 읽은 === undefined ? 날것 : 읽은;
  }
  return 있었나 ? 인자 : null;
}

/*
 * <function=이름> 덩이들. 한 <tool_call> 안에 여럿이 올 수 있다 — 한 무늬로 통째로 잡으면 앞 것의 끝 표까지
 * 몸으로 삼켜 뒤 것 인자로 부름 **하나**가 됐다. 다음 <function= 앞에서도 끊는다.
 */
function 함수덩이들(몸) {
  const out = [];
  const 무늬 = /<function=([^>\s]+)>\s*([\s\S]*?)\s*(?:<\/function>|(?=<function=)|$)/g;
  let m;
  while ((m = 무늬.exec(몸))) {
    const 인자 = 칸꼴(m[2]) ?? (m[2].trim() ? 읽어보기(m[2].trim()) : {});
    if (!객체인가(인자)) return null;
    out.push({ 이름: m[1], 인자 });
  }
  return out.length ? out : null;
}

/**
 * 글 속 부름을 건진다.
 *
 * @param {string} 글      모델이 낸 답 글
 * @param {string[]} 이름들 이번에 내준 도구 이름들
 * @returns {{부름: Array<{name, args}>, 남은글: string} | null}  건진 것이 없으면 null
 */
export function 글속부름(글, 이름들) {
  const s = String(글 ?? '');
  if (!s.trim() || !이름들?.length) return null;
  // 이름은 대소문자를 안 가려 맞추고, 돌려줄 때는 우리 이름으로 적는다(read → Read).
  const 우리이름 = new Map(이름들.map((n) => [String(n).toLowerCase(), String(n)]));
  const 맞춤 = (n) => 우리이름.get(String(n ?? '').trim().toLowerCase()) ?? null;
  const 부름 = [];
  const 뗄곳 = [];
  const 담기 = (목록, 시작, 끝) => {
    const 맞춘 = [];
    for (const x of 목록) {
      const 이름 = 맞춤(x.이름);
      if (!이름) return false;
      맞춘.push({ name: 이름, args: x.인자 });
    }
    부름.push(...맞춘);
    뗄곳.push([시작, 끝]);
    return true;
  };

  // ── 1. 표가 붙은 꼴 — 울타리 밖이면 어디에 있든 건진다 ──────────────────
  // 울타리(```) 안의 표는 형식을 보여 주는 예시다. 건지면 설명하다 적은 명령이 돈다.
  // 안 닫힌 울타리는 글 끝까지다 — 길이 제한으로 잘린 답이 예시를 열어 둔 채 끝난다.
  const 울타리자리 = [...s.matchAll(/```[\s\S]*?(?:```|$)/g)].map((u) => [u.index, u.index + u[0].length]);
  const 울안 = (i) => 울타리자리.some(([a, b]) => i >= a && i < b);
  // <tool_call> … </tool_call> (끝 표 없이 글이 끝나도 받는다 — 서버가 멈춤 낱말로 끝 표를 떼는 일이 있다).
  // 몸은 다음 <tool_call> 을 넘지 않는다 — 말로 꺼낸 표 하나가 뒤따르는 진짜 부름까지 몸으로 삼켰다.
  const 표무늬 = /<tool_call>\s*((?:(?!<tool_call>)[\s\S])*?)\s*(?:<\/tool_call>|(?=<tool_call>)|$)/g;
  let m;
  while ((m = 표무늬.exec(s))) {
    const 몸 = m[1];
    if (!몸.trim() || 울안(m.index)) continue;
    if (몸.trim().startsWith('<function=')) {
      const 목록 = 함수덩이들(몸);
      if (목록) 담기(목록, m.index, m.index + m[0].length);
      continue;
    }
    const 목록 = 부름들로(읽어보기(몸.trim()));
    if (목록) 담기(목록, m.index, m.index + m[0].length);
  }
  // <function=이름>{…}</function> 이 <tool_call> 밖에 홀로 온 꼴 (Llama 3.1)
  const 함수무늬 = /<function=([^>\s]+)>\s*([\s\S]*?)\s*<\/function>/g;
  while ((m = 함수무늬.exec(s))) {
    if (울안(m.index) || 뗄곳.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const 인자 = 칸꼴(m[2]) ?? (m[2].trim() ? 읽어보기(m[2].trim()) : {});
    if (객체인가(인자)) 담기([{ 이름: m[1], 인자 }], m.index, m.index + m[0].length);
  }
  // [TOOL_CALLS] [ … ] (Mistral) — 뒤는 JSON 배열 하나. 배열 뒤에 말이 붙기도 해서, 닫는 ] 를 뒤에서부터
  // 하나씩 대 보며 부름 배열로 읽히는 첫 자리까지만 뗀다.
  const 미스트랄 = /\[TOOL_CALLS\]\s*(?=\[)/.exec(s);
  if (미스트랄 && !울안(미스트랄.index)) {
    const 시작 = 미스트랄.index + 미스트랄[0].length;
    for (let 끝 = s.lastIndexOf(']'), 번 = 0; 끝 > 시작 && 번 < 20; 끝 = s.lastIndexOf(']', 끝 - 1), 번++) {
      const 목록 = 부름들로(읽어보기(s.slice(시작, 끝 + 1)));
      if (!목록) continue;
      담기(목록, 미스트랄.index, 끝 + 1);
      break;
    }
  }
  if (부름.length) return 마무리(s, 부름, 뗄곳);

  // ── 2. 울타리·맨 JSON — 답이 거의 그것뿐일 때만 ─────────────────────
  const 곁글한도 = 200;
  const 울타리무늬 = /```(?:json|tool_call|tool|function)?\s*\n?([\s\S]*?)\n?```/gi;
  const 울타리들 = [...s.matchAll(울타리무늬)];
  // 울타리가 **하나일 때만** 본다. 둘 이상이면 예시를 늘어놓은 글이다 — 부름 여럿은 한 울타리에 배열로 온다.
  if (울타리들.length === 1) {
    const u = 울타리들[0];
    const 목록 = 부름들로(읽어보기(u[1].trim()));
    const 곁글 = (s.slice(0, u.index) + s.slice(u.index + u[0].length)).trim();
    if (목록 && 곁글.length <= 곁글한도 && 담기(목록, u.index, u.index + u[0].length)) return 마무리(s, 부름, 뗄곳);
    return null;
  }
  if (울타리들.length) return null;
  const 맨 = s.trim();
  if (/^[[{]/.test(맨)) {
    const 목록 = 부름들로(읽어보기(맨));
    if (목록 && 담기(목록, 0, s.length)) return 마무리(s, 부름, 뗄곳);
  }
  return null;
}

function 마무리(s, 부름, 뗄곳) {
  const 차례 = [...뗄곳].sort((a, b) => b[0] - a[0]);
  let 남은 = s;
  for (const [a, b] of 차례) 남은 = 남은.slice(0, a) + 남은.slice(b);
  return { 부름, 남은글: 남은.replace(/\n{3,}/g, '\n\n').trim() };
}
