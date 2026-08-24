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

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);

export const isLocalHost = (h) => LOCAL.has(String(h).toLowerCase()) ||
  /^127\./.test(h) ||
  /^10\./.test(h) ||
  /^192\.168\./.test(h) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(h);

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
export function allowTemporarily(url) {
  const o = originOf(url);
  const had = gate.allow.has(o);
  gate.allow.add(o);
  return () => { if (!had) gate.allow.delete(o); };
}

export function setOffline(on) { gate.offline = !!on; return gate.offline; }
export function isOffline() { return gate.offline; }
export function allowed() { return [...gate.allow]; }
export function contacted() { return gate.log.slice(); }
export function resetNet() { gate.allow.clear(); gate.log.length = 0; gate.offline = false; }

/**
 * 이 주소로 나가도 되는가. 안 되면 던진다.
 * 통과한 것은 기록에 남는다 — "무엇이 어디로 갔나" 를 나중에 보여 주기 위해서다.
 */
export function checkUrl(url) {
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
  if (seen) seen.n++;
  else gate.log.push({ origin, n: 1, local });
  return true;
}
