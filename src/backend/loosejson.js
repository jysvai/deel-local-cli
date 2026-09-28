/*
 * 모양이 조금 틀린 JSON 을 읽는다 (2.1.3).
 *
 * 작은 모델이 도구 인자에 적는 JSON 은 자주 **끝까지 왔는데 모양만 틀렸다** — 홑따옴표 · 따옴표
 * 없는 열쇠 · 끝 쉼표 · 글 속 날 줄바꿈 · 파이썬 꼴 True/False/None · // 설명. 여태는 이것을
 * 깨진 부름으로 돌려보내 「JSON 을 고쳐 다시 보내라」 했고, 모델은 같은 꼴을 되풀이하다 걸음을
 * 다 썼다. 뜻이 하나로 읽히는 것은 여기서 읽는다.
 *
 * **잘린 것은 읽지 않는다.** 잘린 앞토막(backend/adapter.js 의 잘린모양인가)을 닫아 읽으면 반쪽
 * 내용이 온전한 것처럼 도구로 간다 — 그건 부르는 쪽에서 먼저 가른다. 여기는 괄호가 다 닫혔는데
 * JSON.parse 만 못 읽는 것의 자리다.
 */

/** 느슨하게 읽는다 — 홑따옴표 · 따옴표 없는 열쇠 · 끝 쉼표 · 글 속 날 줄바꿈 · True/False/None. 못 읽으면 던진다. */
export function 느슨한JSON(글) {
  const s = String(글 ?? '');
  let i = 0;
  const 틀림 = (왜) => { throw new SyntaxError(`${왜} (${i}번째 글자)`); };
  const 빈칸 = () => {
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      // 주석 — 작은 모델이 JSON 에 // 설명을 붙이는 일이 있다.
      if (s.startsWith('//', i)) { while (i < s.length && s[i] !== '\n') i++; continue; }
      if (s.startsWith('/*', i)) { const 끝 = s.indexOf('*/', i + 2); i = 끝 < 0 ? s.length : 끝 + 2; continue; }
      return;
    }
  };
  const 글읽기 = () => {
    const 따옴표 = s[i++];
    let out = '';
    while (i < s.length) {
      const ch = s[i++];
      if (ch === 따옴표) return out;
      if (ch !== '\\') { out += ch; continue; }
      const 다음 = s[i++];
      if (다음 === undefined) break;
      if (다음 === 'n') out += '\n';
      else if (다음 === 't') out += '\t';
      else if (다음 === 'r') out += '\r';
      else if (다음 === 'b') out += '\x08';   // 백스페이스 — 역슬래시 b 로 적으면 정규식 실수처럼 읽힌다(자동모드 검사)
      else if (다음 === 'f') out += '\f';
      else if (다음 === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(i, i + 4))) { out += String.fromCharCode(parseInt(s.slice(i, i + 4), 16)); i += 4; }
      // 모르는 되받이(\' · \d)는 글자 그대로 — 모델이 정규식을 JSON 에 옮겨 적으면 이렇게 온다.
      else out += 다음 === "'" || 다음 === '"' || 다음 === '\\' || 다음 === '/' ? 다음 : `\\${다음}`;
    }
    return 틀림('글이 안 닫혔습니다');
  };
  const 낱말 = () => {
    const m = /^[A-Za-z_$\p{L}][\w$\p{L}\p{N}-]*/u.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return m[0];
  };
  const 값 = () => {
    빈칸();
    const ch = s[i];
    if (ch === '{') {
      i++;
      const o = {};
      for (;;) {
        빈칸();
        if (s[i] === '}') { i++; return o; }
        let 열쇠;
        if (s[i] === '"' || s[i] === "'") 열쇠 = 글읽기();
        else { 열쇠 = 낱말(); if (열쇠 === null) 틀림('열쇠가 아닙니다'); }
        빈칸();
        if (s[i] !== ':') 틀림('":" 가 없습니다');
        i++;
        o[열쇠] = 값();
        빈칸();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return o; }
        틀림('"," 나 "}" 가 없습니다');
      }
    }
    if (ch === '[') {
      i++;
      const a = [];
      for (;;) {
        빈칸();
        if (s[i] === ']') { i++; return a; }
        a.push(값());
        빈칸();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; return a; }
        틀림('"," 나 "]" 가 없습니다');
      }
    }
    if (ch === '"' || ch === "'") return 글읽기();
    const 수 = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
    if (수) { i += 수[0].length; return Number(수[0]); }
    const 말 = 낱말();
    if (말 === 'true' || 말 === 'True') return true;
    if (말 === 'false' || 말 === 'False') return false;
    if (말 === 'null' || 말 === 'None') return null;
    return 틀림('값이 아닙니다');
  };
  const 결과 = 값();
  빈칸();
  if (i < s.length) 틀림('뒤에 남은 것이 있습니다');
  return 결과;
}

/** 글을 JSON 으로 — 먼저 곧이곧대로, 안 되면 느슨하게. 못 읽으면 undefined. */
export function 읽어보기(글) {
  try { return JSON.parse(글); } catch { /* 느슨하게 */ }
  try { return 느슨한JSON(글); } catch { return undefined; }
}

