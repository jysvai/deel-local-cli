// 잘려 온 도구 호출에서 **건질 수 있는 만큼 건진다.**
//
// 무슨 일이 있었나:
//   대시보드 HTML 한 장을 만들라고 시켰다. 모델이 Write 를 부르는데 인자 JSON 이
//   출력 상한에서 잘렸다. 잘린 JSON 은 읽을 수 없으니 통째로 버렸다. 모델은
//   똑같이 다시 시도했고, 또 같은 자리에서 잘렸다. 13번 만에 컨텍스트가 다 찼다.
//   71초를 쓰고 **파일은 한 글자도 안 생겼다.**
//
//   그런데 잘린 그 JSON 안에는 이미 받아 놓은 250줄이 들어 있었다. 경로도 온전했다.
//   버릴 이유가 없다. 250줄을 쓰고 "여기까지 썼으니 이어 붙여라" 라고 하면
//   그 다음 호출은 나머지만 보내면 된다 — 잘릴 일이 없다.
//
// 왜 JSON.parse 로는 안 되나:
//   JSON.parse 는 전부 맞거나 전부 틀리거나 둘 중 하나다. 마지막 따옴표가 없다는
//   이유로 앞의 250줄까지 같이 버린다. 그래서 앞에서부터 읽어 나가다가 더 못
//   읽는 자리에서 멈추는 방식으로 따로 만든다.
//
// 조심할 것:
//   여기서 건진 값은 **완전하지 않다.** 마지막 값은 잘려 있다. 그래서 이 결과를
//   쓰는 쪽은 어느 값이 잘렸는지(truncatedKey) 반드시 보고 판단해야 한다.
//   Edit 의 old_string 을 반쪽만 건져 쓰면 엉뚱한 자리를 고친다. loop.js 가
//   Write·Append 만 살리는 이유다.

/**
 * 잘린 JSON 에서 읽히는 데까지 읽는다.
 *
 * @returns {{args: object, keys: string[], truncatedKey: string|null, complete: boolean}}
 *   args         온전히 읽은 값들 (+ 잘린 값 하나는 받은 데까지)
 *   truncatedKey 잘린 값의 이름. null 이면 잘린 값 없이 그냥 끝난 것
 *   complete     닫는 괄호까지 제대로 나왔나
 */
export function partialParse(raw) {
  const s = String(raw ?? '');
  const 빈것 = { args: {}, keys: [], truncatedKey: null, complete: false };
  let i = 0;

  const 공백건너뛰기 = () => { while (i < s.length && /\s/.test(s[i])) i++; };

  공백건너뛰기();
  if (s[i] !== '{') return 빈것;
  i++;

  const args = {};
  const keys = [];

  for (;;) {
    공백건너뛰기();
    if (i >= s.length) return { args, keys, truncatedKey: null, complete: false };
    if (s[i] === '}') return { args, keys, truncatedKey: null, complete: true };
    if (s[i] === ',') { i++; continue; }
    if (s[i] !== '"') return { args, keys, truncatedKey: null, complete: false };

    const k = 글읽기(s, i);
    if (!k.complete) return { args, keys, truncatedKey: null, complete: false };  // 이름이 잘렸으면 값도 없다
    i = k.end;
    공백건너뛰기();
    if (s[i] !== ':') return { args, keys, truncatedKey: null, complete: false };
    i++;
    공백건너뛰기();
    if (i >= s.length) return { args, keys, truncatedKey: null, complete: false };

    if (s[i] === '"') {
      const v = 글읽기(s, i);
      args[k.text] = v.text;
      keys.push(k.text);
      if (!v.complete) return { args, keys, truncatedKey: k.text, complete: false };
      i = v.end;
    } else if (s[i] === '{' || s[i] === '[') {
      const end = 짝찾기(s, i);
      // 안 닫힌 덩어리는 통째로 버린다. 반쪽 객체는 건져도 쓸 데가 없고,
      // 잘못 건지면 있지도 않은 값이 있는 것처럼 보인다.
      if (end < 0) return { args, keys, truncatedKey: null, complete: false };
      try { args[k.text] = JSON.parse(s.slice(i, end + 1)); keys.push(k.text); } catch { /* 못 읽으면 버린다 */ }
      i = end + 1;
    } else {
      // 숫자·true·false·null
      let j = i;
      while (j < s.length && !',}'.includes(s[j])) j++;
      const 조각 = s.slice(i, j).trim();
      if (j >= s.length) return { args, keys, truncatedKey: null, complete: false };   // 값이 잘렸다
      try { args[k.text] = JSON.parse(조각); keys.push(k.text); } catch { /* 버린다 */ }
      i = j;
    }
  }
}

/**
 * JSON 문자열 하나를 읽는다. 끝까지 못 읽어도 읽은 데까지 돌려준다.
 *
 * 이 함수가 이 파일의 핵심이다. \n · \" · \\ 는 물론 \uXXXX 도 풀어야 한다 —
 * 한글이 그 모양으로 오는 게이트웨이가 있다. 실제로 사용자 게이트웨이가 그랬다.
 * 마지막에 escape 가 반토막 나 있으면(\ 하나만, 또는 \u12) 그건 버린다.
 */
function 글읽기(s, start) {
  let i = start + 1;      // 여는 따옴표 다음
  let out = '';
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') return { text: out, end: i + 1, complete: true };
    if (ch !== '\\') { out += ch; i++; continue; }

    const n = s[i + 1];
    if (n === undefined) break;                    // \ 하나만 남고 끝났다 — 버린다
    if (n === 'u') {
      const hex = s.slice(i + 2, i + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) break;   // \u12 에서 끊겼다
      out += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    const 표 = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
    if (n in 표) { out += 표[n]; i += 2; continue; }
    out += n; i += 2;                              // 모르는 escape 는 글자 그대로
  }
  return { text: out, end: s.length, complete: false };
}

/** 여는 괄호에 맞는 닫는 괄호 자리. 없으면 -1. 따옴표 안은 안 센다. */
function 짝찾기(s, start) {
  const 열림 = s[start];
  const 닫힘 = 열림 === '{' ? '}' : ']';
  let depth = 0;
  let 글속 = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (글속) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') 글속 = false;
      continue;
    }
    if (ch === '"') { 글속 = true; continue; }
    if (ch === 열림) depth++;
    else if (ch === 닫힘) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * 잘린 Write 호출을 '지금 바로 쓸 수 있는 것' 으로 바꾼다.
 *
 * 마지막 줄은 버린다. 반쪽 줄(`<div class="ca`)로 끝나 있으면 이어 붙이는 쪽이
 * 그 반쪽에 정확히 맞춰 이어야 하는데, 약한 모델은 그걸 못 한다. 온전한 줄까지만
 * 남기고 "그 다음 줄부터 쓰라" 고 하면 훨씬 쉬운 문제가 된다.
 *
 * @returns {{path: string, content: string, lines: number, lastLine: string}|null}
 */
export function 살린쓰기(raw) {
  const r = partialParse(raw);
  const path = r.args.file_path ?? r.args.path ?? r.args.filePath;
  const body = r.args.content;
  if (typeof path !== 'string' || !path.trim()) return null;
  if (typeof body !== 'string' || !body) return null;
  // 경로 자체가 잘렸으면 엉뚱한 자리에 쓴다. 그건 안 건진다.
  if (r.truncatedKey === 'file_path' || r.truncatedKey === 'path') return null;

  // 내용이 온전히 다 왔는데도 JSON 이 깨진 것이라면(뒤쪽 다른 인자에서 잘림)
  // 마지막 줄을 버릴 이유가 없다.
  const 내용잘림 = r.truncatedKey === 'content';
  let content = body;
  if (내용잘림) {
    const 끝 = body.lastIndexOf('\n');
    // 줄바꿈이 한 번도 없으면 **아무것도 안 건진다.**
    //
    // 이어 붙이라고 하려면 '어디까지 썼는지' 를 줄 단위로 말해 줄 수 있어야 한다.
    // 온전한 줄이 하나도 없으면 반쪽 줄에 정확히 이어 붙이라고 부탁하는 셈인데,
    // 약한 모델은 그걸 못 한다 — 앞을 다시 쓰거나 이음매가 어긋난다.
    // 그럴 바에는 안 쓰고 '나눠 보내라' 고 하는 편이 낫다.
    if (끝 < 0) return null;
    content = body.slice(0, 끝 + 1);
  }
  if (!content) return null;

  const lines = content.split('\n');
  const 마지막 = [...lines].reverse().find((l) => l.trim()) ?? '';
  return {
    path: path.trim(),
    content,
    lines: content.endsWith('\n') ? lines.length - 1 : lines.length,
    lastLine: 마지막.trim().slice(0, 60),
    cut: 내용잘림,
  };
}
