// 게이트웨이가 남았다고 알려 주는 할당량.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────
//
// 사내 게이트웨이는 사람마다 할당량을 건다. 그런데 지금까지 그걸 아는 방법은
// **429 를 맞는 것뿐**이었다. 일하는 도중에 갑자기 막히고, 화면에는
// "잠깐 막혔습니다" 가 뜨고, 사람은 언제 풀리는지 모른 채 기다린다.
//
// 그런데 서버는 매 응답에 남은 양을 실어 보내고 있었다. 우리가 안 읽었을
// 뿐이다. 읽어서 보여 주면 사람은 막히기 전에 안다 — 큰 작업을 시작할지,
// 오늘은 여기까지 할지 스스로 정할 수 있다.
//
// ── 이름이 제각각이다 ──────────────────────────────────────────────────
//
// 표준이 없다. OpenAI 계열은 `x-ratelimit-remaining-requests`, Azure 는
// `x-ratelimit-remaining-tokens` 를 쓰기도 하고 아예 안 주기도 한다.
// 그래서 **아는 이름만 읽고, 없으면 없다고 한다.** 없는 것을 0 으로 치면
// 화면에 "0 남음" 이 떠서, 멀쩡한데 다 썼다고 믿게 된다.

// 읽을 이름들. 앞에서부터 처음 있는 것 하나를 쓴다.
const 요청남음 = ['x-ratelimit-remaining-requests', 'ratelimit-remaining-requests', 'x-ratelimit-remaining'];
const 토큰남음 = ['x-ratelimit-remaining-tokens', 'ratelimit-remaining-tokens'];
const 요청한도 = ['x-ratelimit-limit-requests', 'ratelimit-limit-requests'];
const 토큰한도 = ['x-ratelimit-limit-tokens', 'ratelimit-limit-tokens'];
const 다시언제 = ['retry-after', 'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens', 'ratelimit-reset'];

function 골라(머리, 이름들) {
  if (!머리) return null;
  const 보기 = (k) => (typeof 머리.get === 'function' ? 머리.get(k) : 머리[k] ?? 머리[k.toLowerCase()]);
  for (const k of 이름들) {
    const v = 보기(k);
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

/*
 * 숫자로 읽는다. 못 읽으면 null — 0 이 아니다.
 *
 * 이 구분이 여기서 제일 중요하다. 못 읽은 것을 0 으로 치면 화면에
 * "남은 요청 0" 이 뜨고, 사람은 멀쩡한 할당량을 다 썼다고 믿는다.
 */
function 숫자(v) {
  if (v === null) return null;
  const n = Number(String(v).replace(/[,_\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/*
 * `retry-after` 는 초일 수도 날짜일 수도 있다 (RFC 9110).
 * 날짜면 지금과의 차이를 초로 바꾼다. 못 읽으면 null.
 */
export function 언제풀리나(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  const n = Number(s);
  if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  const t = Date.parse(s);
  if (Number.isFinite(t)) return Math.max(0, Math.round((t - Date.now()) / 1000));
  // `1m30s` 같은 꼴을 주는 게이트웨이가 있다.
  const m = /^(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(s);
  if (m && (m[1] || m[2])) return Math.round((Number(m[1] ?? 0) * 60) + Number(m[2] ?? 0));
  return null;
}

/**
 * 응답 머리에서 할당량을 읽는다.
 *
 * @returns {{요청:number|null, 요청한도:number|null, 토큰:number|null, 토큰한도:number|null, 풀림:number|null, 있나:boolean}}
 */
export function 할당량읽기(머리) {
  const 것 = {
    요청: 숫자(골라(머리, 요청남음)),
    요청한도: 숫자(골라(머리, 요청한도)),
    토큰: 숫자(골라(머리, 토큰남음)),
    토큰한도: 숫자(골라(머리, 토큰한도)),
    풀림: 언제풀리나(골라(머리, 다시언제)),
  };
  것.있나 = 것.요청 !== null || 것.토큰 !== null || 것.풀림 !== null;
  return 것;
}

/*
 * 얼마나 남았을 때 화면에 띄울까.
 *
 * 한도를 알면 비율로 본다(10% 아래). 한도를 안 알려주는 서버가 많아서,
 * 그때는 남은 수 자체로 본다 — 요청 20회 아래, 토큰 20,000 아래.
 * 넉넉할 때 자꾸 띄우면 사람이 그 줄을 안 읽게 된다.
 */
export const 요청바닥 = 20;
export const 토큰바닥 = 20000;

export function 아슬아슬한가(것) {
  if (!것?.있나) return false;
  if (것.풀림 !== null && 것.풀림 > 0) return true;
  if (것.요청 !== null) {
    if (것.요청한도) { if (것.요청 / 것.요청한도 <= 0.1) return true; }
    else if (것.요청 <= 요청바닥) return true;
  }
  if (것.토큰 !== null) {
    if (것.토큰한도) { if (것.토큰 / 것.토큰한도 <= 0.1) return true; }
    else if (것.토큰 <= 토큰바닥) return true;
  }
  return false;
}

/** 화면 한 줄. 아는 것만 적는다 — 모르는 자리는 아예 안 적는다. */
export function 할당량말(것) {
  if (!것?.있나) return '';
  const 조각 = [];
  if (것.요청 !== null) 조각.push(`요청 ${것.요청.toLocaleString()}${것.요청한도 ? `/${것.요청한도.toLocaleString()}` : ''}`);
  if (것.토큰 !== null) 조각.push(`토큰 ${것.토큰.toLocaleString()}${것.토큰한도 ? `/${것.토큰한도.toLocaleString()}` : ''}`);
  if (것.풀림 !== null) 조각.push(`${것.풀림}초 뒤 풀림`);
  return 조각.join(' · ');
}

/*
 * 마지막으로 본 할당량. 응답마다 덮어쓴다.
 *
 * 세션에 안 두고 모듈에 두는 까닭: 이걸 읽는 자리가 여럿인데(상태줄, /cost,
 * 시작 화면) 그 자리들이 세션을 다 들고 있지는 않다. 그리고 값 자체가
 * '지금 서버가 말한 것' 이라 한 벌이면 충분하다.
 */
let 마지막 = null;

export function 할당량기억(머리) {
  const 것 = 할당량읽기(머리);
  if (것.있나) 마지막 = { ...것, 때: Date.now() };
  return 것;
}

export function 마지막할당량() { return 마지막; }
export function 할당량잊기() { 마지막 = null; return null; }
