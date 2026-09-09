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
//
// Anthropic 은 `anthropic-` 을 앞에 달고, 남은 것을 **뒤에** 적는다
// (`anthropic-ratelimit-requests-remaining`). 그 이름을 몰라서, Claude 직통과
// Bedrock 게이트웨이에서는 이 줄이 **언제나 비어 있었다** — 서버는 매 응답에
// 남은 양을 실어 보내고 있었는데 우리만 못 읽었다. 그래서 그 두 자리에서는
// 아직도 429 를 맞아야만 알 수 있었다. 이 파일이 없애려던 바로 그 상황이다.

// 읽을 이름들. 앞에서부터 처음 있는 것 하나를 쓴다.
const 요청남음 = [
  'x-ratelimit-remaining-requests', 'ratelimit-remaining-requests', 'x-ratelimit-remaining',
  'anthropic-ratelimit-requests-remaining',
];
/*
 * 토큰 통은 **여러 개일 수 있다.**
 *
 * Anthropic 은 입력과 출력을 따로 센다. 둘은 서로 다른 통이고, 둘 중
 * **먼저 바닥나는 쪽**이 곧 막히는 쪽이다.
 *
 * 여태 이걸 한 줄짜리 이름 목록으로 두고 골라() 로 「처음 있는 것」 을
 * 집었다. 목록 차례상 입력이 앞이라, 입력 100,000 · 출력 0 인 응답에서
 * 남은 양을 **100,000 으로 적었다.** 그러면 미리기다릴까() 가 「아직
 * 넉넉하다」 고 보고 곧장 다음 요청을 보내 429 를 맞는다. 주석에는
 * 「먼저 바닥나는 쪽」 이라고 적혀 있었는데 코드는 그 반대를 했다.
 *
 * 남음과 한도를 **짝으로** 묶어 두고, 남은 것이 가장 적은 짝을 쓴다.
 * 짝으로 안 묶으면 화면이 「출력 0 / 입력 한도 100만」 같은 소리를 한다.
 */
const 토큰통 = [
  ['x-ratelimit-remaining-tokens', 'x-ratelimit-limit-tokens'],
  ['ratelimit-remaining-tokens', 'ratelimit-limit-tokens'],
  ['anthropic-ratelimit-tokens-remaining', 'anthropic-ratelimit-tokens-limit'],
  ['anthropic-ratelimit-input-tokens-remaining', 'anthropic-ratelimit-input-tokens-limit'],
  ['anthropic-ratelimit-output-tokens-remaining', 'anthropic-ratelimit-output-tokens-limit'],
];
const 요청한도 = ['x-ratelimit-limit-requests', 'ratelimit-limit-requests', 'anthropic-ratelimit-requests-limit'];
/*
 * 풀리는 때. Anthropic 은 초가 아니라 **날짜(RFC 3339)** 로 준다 —
 * `언제풀리나` 가 Date.parse 로 받아 지금과의 차이를 초로 바꾼다.
 */
const 다시언제 = [
  'retry-after', 'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens', 'ratelimit-reset',
  'anthropic-ratelimit-requests-reset', 'anthropic-ratelimit-tokens-reset',
];

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

/** 토큰 통 중 **가장 적게 남은** 짝. 없으면 둘 다 null. */
function 가장빠듯한통(머리) {
  let 고른것 = { 토큰: null, 토큰한도: null };
  for (const [남음이름, 한도이름] of 토큰통) {
    const 남 = 숫자(골라(머리, [남음이름]));
    if (남 === null) continue;
    if (고른것.토큰 === null || 남 < 고른것.토큰) {
      고른것 = { 토큰: 남, 토큰한도: 숫자(골라(머리, [한도이름])) };
    }
  }
  return 고른것;
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
    ...가장빠듯한통(머리),
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

/*
 * ── 창구마다 따로 센다 ──────────────────────────────────────────────────
 *
 * 값이 한 벌이면 **누구 것인지**가 없다. 그런데 이 프로그램은 한 번에 여러
 * 창구를 부른다 — 본 모델, 하위 작업이 고른 모델(agent/loop.js), `/model` 로
 * 물어보는 자리, 요약을 짓는 자리. 사내 게이트웨이가 「남은 것 0, 55초 뒤」
 * 라고 답하면, 그 다음에 **전혀 다른 주소**로 나가는 요청까지 55초를 기다렸다.
 * 옆에 켜 둔 로컬 모델이 남의 할당량 때문에 멎는 것이다.
 *
 * 그래서 창구별로 담아 두고, 보내기 전에 비킬 때는 **그 창구 것만** 본다.
 * 화면(상태줄·/cost)은 여전히 마지막 것을 쓴다 — 사람이 보는 것은 지금 쓰는
 * 창구 하나라, 그 자리에는 한 벌로 충분하다.
 */
const 자리들 = new Map();
const 자리최대 = 24;

/** 이 연결을 가리키는 이름. 주소의 호스트와 모델까지만 쓴다 — 열쇠는 안 넣는다. */
export function 할당량자리(conn) {
  if (!conn) return '';
  let host = '';
  try { host = new URL(String(conn.base ?? '')).host; } catch { host = ''; }
  /*
   * 규격까지 넣는다. 전선 카드 열쇠와 같은 까닭이다(agent/evolve.js) —
   * mantle 은 `/openai/v1` 과 `/anthropic/v1` 이 **같은 호스트에 같은 모델
   * 이름**으로 서 있어서, 규격을 빼면 한쪽이 바닥났다고 다른 쪽까지 기다린다.
   */
  const 꼴 = String(conn.kind ?? '').trim();
  return `${host}|${String(conn.model ?? '').trim()}${꼴 ? `#${꼴}` : ''}`;
}

/**
 * 응답 머리에서 할당량을 읽어 적어 둔다.
 *
 * `막힘` 은 **그 응답이 429 였나**다. 머리에 남은 수가 안 실려 와도 이 한
 * 글자는 안다 — 그리고 그것만으로도 다음 요청을 띄울 까닭이 된다
 * (아래 미리기다릴까).
 *
 * @param {boolean} [옵션.막힘] 이 응답이 429 였나
 */
export function 할당량기억(머리, 어디 = '', { 막힘 = false } = {}) {
  const 것 = 할당량읽기(머리);
  것.막힘 = !!막힘;
  /*
   * 429 는 머리가 비어 있어도 적어 둔다.
   *
   * 게이트웨이 상당수가 막을 때 남은 수도 `Retry-After` 도 안 준다. 그래도
   * **방금 막혔다는 사실**은 우리가 안다. 그 하나로 다음 요청을 조금 띄울 수
   * 있고, 그게 이 루프에서 제일 크게 듣는다 — 200걸음짜리 턴에서 41번째가
   * 바로 다시 두드리면 한도는 영영 안 풀린다.
   */
  if (것.있나 || 막힘) {
    const 적을것 = { ...것, 때: Date.now() };
    마지막 = 적을것;
    if (어디) {
      자리들.delete(어디);
      자리들.set(어디, 적을것);
      // 오래 안 쓴 자리부터 버린다. 창구를 옮겨 다녀도 표가 안 자란다.
      while (자리들.size > 자리최대) 자리들.delete(자리들.keys().next().value);
    }
  } else if (어디) {
    /*
     * 머리가 없는 **성공** 응답. 적을 것은 없지만, 앞서 적어 둔 「막혔다」 는
     * 지워야 한다. 안 지우면 한 번 막힌 뒤로 낡을 때까지(낡은값) 멀쩡한
     * 요청마다 띄운다 — 고친 것이 아니라 새 고장이다.
     */
    const 옛 = 자리들.get(어디);
    if (옛?.막힘) 자리들.set(어디, { ...옛, 막힘: false });
    if (마지막?.막힘) 마지막 = { ...마지막, 막힘: false };
  }
  return 것;
}

/** 마지막으로 본 할당량. 자리를 주면 **그 창구 것**, 안 주면 가장 최근 것. */
export function 마지막할당량(어디 = '') {
  if (어디) return 자리들.get(어디) ?? null;
  return 마지막;
}

export function 할당량잊기(어디 = '') {
  if (어디) { 자리들.delete(어디); return null; }
  마지막 = null;
  자리들.clear();
  return null;
}

/*
 * ── 맞기 전에 비킨다 ────────────────────────────────────────────────────
 *
 * 서버는 매 응답에 「남은 것이 없다, 언제 풀린다」 를 실어 보낸다. 그런데
 * 여태 그 값은 **화면에만** 썼다. 그래서 남은 것이 0 인 줄 알면서도 그대로
 * 다음 요청을 보내고, 429 를 맞고, 다시 부르기 사다리를 태우고, 세 번째에
 * 턴이 죽었다. 사람이 본 것은 「호출 한도 초과」 한 줄이다.
 *
 * 맞기 전에 아는 것과 맞고 나서 아는 것은 사람이 할 일이 다르다. 알고 있으면
 * 그냥 기다렸다 보내면 된다 — 기다리는 것은 실패가 아니다.
 *
 * 조심한 것:
 *   · **모르면 안 기다린다.** 헤더를 안 주는 서버가 많고, 모르는 것을 0 으로
 *     치면 멀쩡한 연결이 영영 기다린다.
 *   · 풀림 시각이 없으면 안 기다린다. 얼마나 기다릴지 모르는 채로 붙들면
 *     화면이 멈춘 것과 구별이 안 된다.
 *   · 오래된 값으로는 안 정한다. 방금 응답이 아니면 그 사이 풀렸을 수 있다.
 *   · 상한을 둔다. 그보다 길면 사람이 정할 일이다 — 사실대로 말하고 보낸다.
 *
 * @returns {number|null} 기다릴 밀리초. 안 기다려도 되면 null
 */
export const 낡은값 = 60000;      // 이보다 오래된 할당량으로는 안 정한다
export const 미리기다림상한 = 60000;

/*
 * 방금 막혔으면 다음 요청을 이만큼은 띄운다.
 *
 * 서버가 「언제 오라」 고 말해 줬으면 그 말을 쓴다(풀림). 이건 **아무 말도 안
 * 해 줬을 때**의 바닥이다. 게이트웨이 상당수가 막을 때 남은 수도 `Retry-After`
 * 도 안 준다 — 그때 우리가 아는 것은 「방금 막혔다」 하나뿐이다.
 *
 * 이건 서버의 창을 짐작하는 것이 아니다. **우리 박자를 늦추는 것**이다. 그
 * 둘은 다르다 — 앞엣것은 없는 것을 지어내는 짓이고, 뒤엣것은 우리가 얼마나
 * 빨리 두드릴지 우리가 정하는 것이다.
 *
 * 5초로 둔다. 실제로 본 한도가 **초당**이라(Bedrock 의 ApplyGuardrail text
 * units per second) 몇 초만 띄워도 듣는다. 그러면서 한 번 막혔다고 사람이
 * 체감할 만큼 느려지지도 않는다.
 */
export const 막힘띄움 = 5000;

/*
 * 어느 창구 것인지는 **부르는 쪽이 정해서 준다.** 기본값을 두지 않는다.
 *
 * 전에는 `것 = 마지막` 이었다. 그 기본값이 곧 「아무 창구나 마지막에 답한
 * 것」 이라, 빠뜨리고 부르면 옆 창구의 바닥난 할당량으로 이쪽이 기다린다 —
 * 방금 고친 그 고장이다. 기본값을 없애면 다음에 빠뜨렸을 때 조용히 옛
 * 동작으로 돌아가는 대신 눈에 보이게 어긋난다.
 */
/**
 * 왜 띄우나 — `'바닥'`(남은 것이 0 이라고 서버가 말해 줌) 또는 `'막힘'`(방금 429).
 *
 * 화면 문구가 여기서 갈린다. 「할당량이 바닥났다」 는 **서버가 그렇게 말해 줬을
 * 때만** 할 수 있는 말이다. 429 만 맞고 남은 수는 못 받은 자리에서 그 말을 하면
 * 화면이 모르는 것을 아는 척하는 것이다 — 이 프로그램이 안 하기로 한 바로 그것.
 */
export function 왜띄우나(것) {
  if (!것) return null;
  const 바닥난것 = (것.요청 !== null && 것.요청 <= 0) || (것.토큰 !== null && 것.토큰 <= 0);
  if (바닥난것) return '바닥';
  return 것.막힘 ? '막힘' : null;
}

export function 미리기다릴까(것, 지금 = Date.now()) {
  if (!것?.있나 && !것?.막힘) return null;
  if (!(것.때 > 0) || 지금 - 것.때 > 낡은값) return null;

  const 바닥난것 = (것.요청 !== null && 것.요청 <= 0) || (것.토큰 !== null && 것.토큰 <= 0);
  // 서버가 언제 오라고 말해 줬으면 그 말이 먼저다. 바닥났다고 했거나 방금 막혔거나.
  if ((바닥난것 || 것.막힘) && 것.풀림 > 0) {
    // 그 응답을 받은 뒤로 흐른 만큼은 빼 준다.
    const 남은초 = 것.풀림 - Math.floor((지금 - 것.때) / 1000);
    if (남은초 > 0) return Math.min(남은초 * 1000, 미리기다림상한);
  }

  /*
   * 아무 말도 없이 막기만 한 자리. 그래도 방금 막혔다는 것은 안다 —
   * 그만큼은 띄운다 (막힘띄움). 바닥났다고만 하고 풀림 시각이 없는 것은
   * 여기 안 들어온다. 언제 풀릴지 모르는 것과 방금 맞은 것은 다르다.
   */
  if (것.막힘) {
    const 남은 = 막힘띄움 - (지금 - 것.때);
    if (남은 > 0) return Math.min(남은, 미리기다림상한);
  }
  return null;
}
