/**
 * 슬래시 명령을 이름으로 찾는 규칙 — 대화 화면(commands.js)과 `deel run`(oneshot.js)이 같이 쓴다.
 *
 * 여기가 commands.js 안에 있었다. 그래서 `deel run` 은 이 셋을 쓰려고 대화 화면의 명령 전부
 * (화면 · 설정 · 플러그인 · 스캔 …)를 읽었다. 규칙은 한 벌로 두되, 가벼운 자리로 뺀다 (2.1.3).
 * commands.js 는 여기서 받아 그대로 내보낸다 — 부르던 자리는 안 바뀐다.
 */
/** `ext:ReviewCode` 의 꼬리 — 언제나 낮춰서 돌려준다. 찾기와 「비슷한 것」 이 같은 잣대를 쓰게 한다. */
const 꼬리이름 = (이름) => String(이름 ?? '').split(':').pop().toLowerCase();

/*
 * ── 이 PC 에서 찾은 슬래시 명령을 이름으로 찾는다 ───────────────────────
 *
 * 대화 화면(commands.js 의 default 갈래)과 배치(oneshot.js)가 **같은 규칙**을 써야 한다. 같은 글자를
 * 쳤는데 창에 따라 되고 안 되면 사람은 어느 쪽을 믿을지 정할 수 없다. 그래서 두 벌로 적지
 * 않고 여기 한 군데에 둔다.
 *
 * 찾는 차례는 셋이다 — 적은 그대로 · 대소문자 무시 · 꼬리 이름.
 * 마지막 칸이 `x.name.split(':').pop() === 낮춘` 이었다 (8회차 그밖 명령2). 왼쪽은 파일에
 * 적힌 그대로고 오른쪽은 낮춘 말이라 둘이 만날 수가 없다. `ext:ReviewCode` 는 `/ReviewCode`
 * 로도 `/reviewcode` 로도 「모르는 명령」 이었고, 「비슷한 것」 에도 안 떴다 — 깔려 있는
 * 명령이 어느 길로도 안 보이는 자리다. 배치에서는 그대로 1 로 선다.
 */
export function 슬래시명령찾기(목록, 부른이름) {
  const 것들 = 목록 ?? [];
  const 낮춘 = String(부른이름 ?? '').toLowerCase();
  return 것들.find((x) => x.name === 부른이름)
    ?? 것들.find((x) => x.name.toLowerCase() === 낮춘)
    ?? 것들.find((x) => 꼬리이름(x.name) === 낮춘)
    ?? null;
}

/** 못 찾았을 때 「비슷한 것」 으로 늘어놓을 것. 찾기와 같은 잣대(낮춘 꼬리)를 쓴다. */
export function 비슷한슬래시명령(목록, 부른이름, 몇 = 5) {
  const 낮춘 = String(부른이름 ?? '').toLowerCase();
  if (!낮춘) return [];
  return (목록 ?? [])
    .filter((x) => x.name.toLowerCase().includes(낮춘) || 낮춘.includes(꼬리이름(x.name)))
    .slice(0, 몇);
}

/*
 * 프롬프트 인자를 가른다. 빈칸으로 가르되 따옴표("…" · '…')로 묶은 것은 한 인자다 — 파일 이름에 빈칸이
 * 든다. 마지막 인자는 남은 글을 **그대로** 받는다 — 여러 줄 코드를 넘기면 줄바꿈 · 들여쓰기가 살아야 한다.
 * 남은 것이 통째로 한 따옴표 묶음이면 따옴표만 벗긴다.
 */
function 인자가르기(글, 몇) {
  const s = String(글 ?? '');
  const 값들 = [];
  let i = 0;
  for (let k = 0; k < 몇; k++) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (k === 몇 - 1) {
      const 남은 = s.slice(i).trimEnd();
      const 묶음 = /^(["'])((?:(?!\1)[\s\S])*)\1$/.exec(남은);
      값들.push(묶음 ? 묶음[2] : 남은);
      break;
    }
    const 끝 = s[i] === '"' || s[i] === "'" ? s.indexOf(s[i], i + 1) : -1;
    if (끝 > i) { 값들.push(s.slice(i + 1, 끝)); i = 끝 + 1; continue; }
    const 시작 = i;
    while (i < s.length && !/\s/.test(s[i])) i++;
    값들.push(s.slice(시작, i));
  }
  return 값들;
}

/**
 * `/mcp__<서버>__<이름> 인자…` — MCP 서버가 낸 프롬프트를 받아 글로 편다 (2.1.3 · backend/mcp.js 의 프롬프트받기).
 *
 * 대화 화면과 `deel run` 이 같은 것을 쓴다 — 슬래시명령찾기 를 한 벌로 둔 것과 같은 까닭이다.
 * 인자는 빈칸으로 갈라 적힌 차례대로 채우고, 마지막 인자가 나머지를 다 받는다(한 문장을 통째로 넘기게 ·
 * 인자가르기).
 *
 * @returns null — 그런 프롬프트가 없다(부르는 쪽은 여느 슬래시 명령을 찾는다)
 *          { 탈 } — 있는데 못 폈다 · { text, 서버이름, 이름 } — 모델에게 보낼 글
 */
export async function MCP프롬프트펴기(서버들, 부른이름, 인자글 = '', { signal = null } = {}) {
  const { 이름풀기 } = await import('./backend/mcp.js');
  const 갈린것 = 이름풀기(부른이름);
  if (!갈린것) return null;
  const 서버 = (서버들 ?? []).find((s) => s?.이름 === 갈린것.서버);
  const 프롬프트 = (서버?.프롬프트 ?? []).find((p) => p?.name === 갈린것.도구);
  if (!프롬프트) return null;
  const 인자이름들 = (프롬프트.arguments ?? []).map((a) => a.name);
  const 값들 = 인자가르기(인자글, 인자이름들.length);
  const 인자 = {};
  인자이름들.forEach((n, i) => { if (값들[i]) 인자[n] = 값들[i]; });
  // hasOwn — 인자 이름이 constructor · toString 이면 `in` 은 Object 원형에서 찾아 「있다」 고 한다.
  const 빠진것 = (프롬프트.arguments ?? []).filter((a) => a.required && !Object.hasOwn(인자, a.name)).map((a) => a.name);
  if (빠진것.length) {
    return { 탈: `인자가 모자랍니다 — /${부른이름} ${인자이름들.map((n) => `<${n}>`).join(' ')} (빠진 것: ${빠진것.join(' · ')})` };
  }
  if (!서버.쓸수있나()) return { 탈: `${서버.이름} 서버가 죽었습니다: ${서버.죽음 ?? '이유 모름'}` };
  try {
    const text = await 서버.프롬프트받기(프롬프트.name, 인자, { signal });
    if (!text.trim()) return { 탈: `${서버.이름} 서버가 빈 프롬프트를 줬습니다` };
    return { text, 서버이름: 서버.이름, 이름: 프롬프트.name };
  } catch (e) {
    return { 탈: `프롬프트를 못 받았습니다 — ${String(e?.message ?? e)}` };
  }
}
