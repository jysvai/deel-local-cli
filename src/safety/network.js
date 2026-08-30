// 어디로 말을 걸 수 있는지 한 곳에서 정한다.
//
// 왜 필요한가:
//   코딩 에이전트는 소스 코드를 통째로 모델에 보낸다. 그 주소가 어디인지가 전부다.
//   "설정한 곳으로만 갑니다" 를 말로 하면 언젠가 거짓이 된다. 코드가 막아야 한다.
//
// 규칙:
//   1) 기본은 전부 거절. 허용 목록에 오른 자리만 통과.
//   2) 모델 호출은 setup 에서 정한 그 주소 하나만.
//   3) 플러그인 받기(github)는 사용자가 그 명령을 칠 때만 잠깐 열린다.
//   4) offline 이면 이 컴퓨터 밖은 전부 거절 — 3번도 막힌다.
//
// 여기를 지나지 않는 요청은 없다. http.js 의 req() 가 매번 물어본다.

export class NetBlocked extends Error {
  constructor(url, why) {
    super(`허용되지 않은 주소입니다: ${url}\n  ${why}`);
    this.name = 'NetBlocked';
    this.url = url;
  }
}

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::']);

/*
 * 이 컴퓨터·사내망 주소인가. WebFetch 가 안 읽을 곳, 오프라인 잠금이 그래도 열어 줄 곳.
 *
 * 글자만 보면 빠져나가는 철자가 있었다 — `localhost.`(끝에 점)와 `[::ffff:127.0.0.1]`
 * (IPv4 를 IPv6 에 싼 것)은 둘 다 127.0.0.1 에 붙는데 '바깥' 으로 읽혔다. 되돌림이
 * 그리로 가면 사내 서비스를 읽게 된다. 그래서 먼저 철자를 편다: 끝 점을 떼고, 대괄호를
 * 벗기고, ::ffff: 로 싼 IPv4 는 점 네 개 꼴로 되돌린 뒤 본다.
 * 169.254.* (링크 로컬 — 클라우드 메타데이터가 여기 산다)와 IPv6 의 fe80:: · fc00::/7 도
 * 이 컴퓨터·사내망으로 친다.
 */
export const isLocalHost = (h) => {
  let s = String(h ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (s.startsWith('::ffff:')) {
    const 뒤 = s.slice(7);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(뒤);
    s = hex
      ? [hex[1], hex[2]].flatMap((x) => { const n = parseInt(x, 16); return [n >> 8, n & 255]; }).join('.')
      : 뒤;
  }
  if (LOCAL.has(s)) return true;
  if (/^(127|10|0)\./.test(s) || /^192\.168\./.test(s) || /^172\.(1[6-9]|2\d|3[01])\./.test(s) || /^169\.254\./.test(s)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(s) || /^f[cd][0-9a-f]{2}:/.test(s)) return true;
  return false;
};

function originOf(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

// 하나뿐인 문지기. 모듈 하나에 상태를 두는 것은 일부러다 —
// 여기저기서 각자 예외를 두면 자물쇠가 아니게 된다.
const gate = {
  allow: new Set(),     // 통과시킬 origin 들
  offline: false,       // true 면 이 컴퓨터 밖은 전부 거절
  log: [],              // 실제로 나간 곳 (사람이 확인용)
  enforced: true,
};

/** 모델 연결 주소를 허용 목록에 올린다. 이전에 올린 것은 지운다. */
export function allowEndpoint(baseUrl) {
  gate.allow.clear();
  if (baseUrl) gate.allow.add(originOf(baseUrl));
  return [...gate.allow];
}

/** 잠깐 한 곳을 더 연다. 되돌리는 함수를 준다 — 반드시 finally 에서 부른다. */
/*
 * 잠깐 연다. 돌려주는 함수로 닫는다.
 *
 * 같은 집을 여럿이 겹쳐 열 수 있다 — WebFetch 다섯 개가 한 집에 줄을 서면
 * 첫 것이 닫을 때 나머지 넷이 막히면 안 된다. 그래서 센다. 마지막이 닫을 때만
 * 정말 닫고, 원래(allowEndpoint 로) 열려 있던 집은 끝까지 안 닫는다.
 */
const 잠깐연것 = new Map();   // origin → { n, 원래 }
export function allowTemporarily(url) {
  const o = originOf(url);
  const 칸 = 잠깐연것.get(o) ?? { n: 0, 원래: gate.allow.has(o) };
  칸.n += 1;
  잠깐연것.set(o, 칸);
  gate.allow.add(o);
  let 닫았나 = false;
  return () => {
    if (닫았나) return;   // 두 번 닫아도 남의 몫을 닫지 않는다
    닫았나 = true;
    칸.n -= 1;
    if (칸.n > 0) return;
    잠깐연것.delete(o);
    if (!칸.원래) gate.allow.delete(o);
  };
}

export function setOffline(on) { gate.offline = !!on; return gate.offline; }
export function isOffline() { return gate.offline; }
export function allowed() { return [...gate.allow]; }
export function contacted() { return gate.log.slice(); }
export function resetNet() { gate.allow.clear(); 잠깐연것.clear(); gate.log.length = 0; gate.offline = false; 마지막경유 = null; }

/*
 * 거쳐 간 프록시.
 *
 * 프록시는 허용 목록에 오르는 자리가 아니다 — 목적지는 여전히 그 한 자리이고,
 * 프록시는 거기까지 가는 **길**이다. 그래도 패킷이 실제로 닿는 첫 기계는 프록시라서,
 * 심사서와 화면에는 "이 프록시를 거친다" 가 적혀야 한다. 어디를 거쳤는지 여기 남긴다.
 */
let 마지막경유 = null;
export function 프록시경유() { return 마지막경유; }

/**
 * 이 주소로 나가도 되는가. 안 되면 던진다.
 * 통과한 것은 기록에 남는다 — "무엇이 어디로 갔나" 를 나중에 보여 주기 위해서다.
 * @param {string|null} 거쳐  이 요청이 거칠 프록시 주소. 없으면 직접 간다.
 */
export function checkUrl(url, 거쳐 = null) {
  let u;
  try { u = new URL(url); } catch { throw new NetBlocked(url, '주소 형식이 아닙니다.'); }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new NetBlocked(url, `${u.protocol} 는 쓰지 않습니다.`);
  }

  const local = isLocalHost(u.hostname);
  if (gate.offline && !local) {
    throw new NetBlocked(url, '오프라인 모드입니다 — 이 컴퓨터 밖으로는 나가지 않습니다.');
  }

  const origin = `${u.protocol}//${u.host}`;
  if (!gate.allow.has(origin)) {
    throw new NetBlocked(url,
      gate.allow.size
        ? `지금 허용된 곳: ${[...gate.allow].join(', ')}`
        : '연결이 정해지지 않았습니다. deel setup 을 먼저 하세요.');
  }

  const seen = gate.log.find((x) => x.origin === origin);
  if (seen) { seen.n++; if (거쳐) seen.via = 거쳐; }
  else gate.log.push({ origin, n: 1, local, via: 거쳐 ?? null });
  if (거쳐) 마지막경유 = { url: 거쳐 };
  return true;
}
