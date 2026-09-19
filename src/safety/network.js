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
/*
 * 철자를 편다 — 끝 점을 떼고, 대괄호를 벗기고, ::ffff: 로 싼 IPv4 는 점 네 개 꼴로.
 *
 * 아래 isLocalHost · 루프백인가 · 안쪽주소인가 가 **같은 펴기**를 쓴다. 표마다 따로
 * 펴면 한쪽만 `[::ffff:127.0.0.1]` 을 알아보는 모양이 다시 생긴다 — backend/proxy.js 가
 * 제 잣대(`/^127\./`)를 따로 들고 있다가 딱 그렇게 됐다(사냥4 W15).
 */
function 철자펴기(h) {
  let s = String(h ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (s.startsWith('::ffff:')) {
    const 뒤 = s.slice(7);
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(뒤);
    s = hex
      ? [hex[1], hex[2]].flatMap((x) => { const n = parseInt(x, 16); return [n >> 8, n & 255]; }).join('.')
      : 뒤;
  }
  return s;
}

export const isLocalHost = (h) => {
  const s = 철자펴기(h);
  if (LOCAL.has(s)) return true;
  const 넷 = 숫자주소펴기(s);
  if (넷) {
    const [a, b] = 넷.split('.').map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;                       // 그 밖의 숫자 주소는 바깥이다
  }
  if (/^fe[89ab][0-9a-f]:/.test(s) || /^f[cd][0-9a-f]{2}:/.test(s)) return true;
  return false;
};

/*
 * 이 컴퓨터 **자신**인가 — 사내망은 빼고.
 *
 * 프록시 고르기(backend/proxy.js)가 「루프백은 언제나 직접」 을 가를 때 쓴다. 거기는
 * `/^127\./` 로 글자 앞머리를 봐서 두 쪽으로 틀렸다(사냥4 W15). `127.example.com` 은
 * **이름인데** 루프백으로 읽혀 프록시를 건너뛰었고 — 바깥으로 직접 못 나가는 사내에서는
 * 그대로 「연결 실패」 다 — 진짜 루프백인 `[::ffff:127.0.0.1]` 은 프록시로 돌아 나갔다.
 * 아래 숫자주소펴기 머리말이 여기서 먼저 고친 바로 그 탈이라, 잣대를 옮기지 않고 내준다.
 */
export const 루프백인가 = (h) => {
  const s = 철자펴기(h);
  if (s === 'localhost' || s === '::1' || s === '0.0.0.0') return true;
  const 넷 = 숫자주소펴기(s);
  return !!넷 && 넷.startsWith('127.');
};

/*
 * ── 웹이 닿으면 안 되는 안쪽 — isLocalHost 보다 **넓다** ───────────────────
 *
 * isLocalHost 는 두 일을 한다. WebFetch 가 안 읽을 곳이고, 동시에 **봉인(offline)이
 * 그래도 열어 주는 곳**이다(아래 checkUrl · safety/runmode.js 의 바깥인가). 그래서 막을
 * 곳을 거기에 더하면 막는 쪽은 조여지지만 봉인 쪽은 **풀린다** — 통신사 CGNAT(100.64/10)
 * 너머가 「이 안」 이 되어 봉인 중에도 나간다. 그건 고치는 것이 아니라 다른 구멍이다.
 *
 * 그런데 막는 쪽에는 빈 데가 있었다(사냥4 W9). 되돌림 검사가 그리로 따라갔다:
 *
 *   100.100.100.200      알리바바 클라우드 메타데이터. 100.64/10(공유 주소) 안에 산다
 *   fec0::/10            옛 사이트로컬. 사내 IPv6 로 아직 쓰는 곳이 있다
 *   64:ff9b::a9fe:a9fe   NAT64 에 싼 169.254.169.254 — 벗기면 메타데이터다
 *   ::7f00:1             IPv4 호환 꼴에 싼 127.0.0.1
 *
 * 메타데이터에 닿으면 임시 자격증명이 모델에게 실린다. 그래서 **막는 쪽만** 넓힌 표를
 * 따로 둔다 — WebFetch(tools/webfetch.js)와 사설로풀리나 가 이걸 쓰고, 봉인은 계속
 * isLocalHost 를 쓴다. 벤치마크(198.18/15)·멀티캐스트·예약(224/4 · 240/4)도 웹 문서가
 * 사는 자리가 아니라 같이 막는다.
 */
export const 안쪽주소인가 = (h) => {
  if (isLocalHost(h)) return true;
  const s = 철자펴기(h).replace(/%.*$/, '');   // fe80::1%eth0 같은 영역 꼬리는 뗀다
  const 넷 = 숫자주소펴기(s);
  if (넷) {
    const [a, b] = 넷.split('.').map(Number);
    if (a === 100 && b >= 64 && b <= 127) return true;     // 공유 주소(CGNAT) — 알리바바 메타데이터
    if (a === 198 && (b === 18 || b === 19)) return true;   // 벤치마크
    if (a >= 224) return true;                              // 멀티캐스트 · 예약 · 브로드캐스트
    return false;
  }
  const 여덟 = 여섯펴기(s);
  if (!여덟) return false;
  if ((여덟[0] & 0xffc0) === 0xfec0) return true;           // fec0::/10 옛 사이트로컬
  if ((여덟[0] & 0xff00) === 0xff00) return true;           // ff00::/8 멀티캐스트
  // IPv4 를 싼 꼴은 벗겨서 다시 본다 — 싼 채로 보면 「바깥 IPv6」 으로 읽힌다.
  const 끝넷 = () => `${여덟[6] >> 8}.${여덟[6] & 255}.${여덟[7] >> 8}.${여덟[7] & 255}`;
  if (여덟[0] === 0x64 && 여덟[1] === 0xff9b && 여덟.slice(2, 6).every((x) => x === 0)) return 안쪽주소인가(끝넷());   // NAT64
  if (여덟.slice(0, 6).every((x) => x === 0)) return 안쪽주소인가(끝넷());                                             // IPv4 호환
  if (여덟[0] === 0x2002) return 안쪽주소인가(`${여덟[1] >> 8}.${여덟[1] & 255}.${여덟[2] >> 8}.${여덟[2] & 255}`);     // 6to4
  return false;
};

/**
 * IPv6 글을 16비트 마디 여덟 개로. 못 읽으면 null.
 * `::` 줄임과 끝에 붙은 점 넷 IPv4(`::ffff:1.2.3.4` · `64:ff9b::1.2.3.4`)를 받는다.
 * 프록시의 NO_PROXY 대역 견주기(backend/proxy.js)도 이걸 쓴다.
 */
export function 여섯펴기(글) {
  let s = String(글 ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!s.includes(':')) return null;
  const 점넷 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (점넷) {
    const 펴진 = 숫자주소펴기(점넷[1]);
    if (!펴진) return null;
    const [a, b, c, d] = 펴진.split('.').map(Number);
    s = s.slice(0, 점넷.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const 갈림 = s.split('::');
  if (갈림.length > 2) return null;
  const 마디로 = (x) => (x ? x.split(':') : []);
  const 앞 = 마디로(갈림[0]);
  const 뒤 = 갈림.length === 2 ? 마디로(갈림[1]) : [];
  const 빈칸 = 8 - 앞.length - 뒤.length;
  if (갈림.length === 2 ? 빈칸 < 1 : 빈칸 !== 0) return null;
  const 모두 = [...앞, ...Array(갈림.length === 2 ? 빈칸 : 0).fill('0'), ...뒤];
  if (모두.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  return 모두.map((x) => parseInt(x, 16));
}

/*
 * ── 「숫자로 적힌 주소」 는 점 넷만이 아니다 ─────────────────────────────
 *
 * 여기는 `/^(127|10|0)\./` 처럼 **글자 앞머리**로 봤다. 두 쪽으로 틀렸다.
 *
 * 한쪽은 **덜 막았다.** 운영체제의 주소 푸는 자(getaddrinfo/inet_aton)는
 * 점 넷 말고도 여러 꼴을 받는다. 전부 같은 자리를 가리킨다:
 *
 *   169.254.169.254   ← 클라우드 메타데이터. 임시 자격증명이 나온다
 *   2852039166        ← 같은 주소를 32비트 한 덩이로
 *   0251.0376.0251.0376  ← 8진
 *   0xA9.0xFE.0xA9.0xFE  ← 16진
 *   127.1             ← 마디를 줄인 꼴
 *
 * 아래 사설로풀리나() 는 `/^[0-9.]+$/` 면 「위 isLocalHost 가 이미 본다」 며
 * DNS 조회까지 건너뛰었다. 보지 않았다. 그래서 숫자 한 덩이로 적으면 글자
 * 검사도 이름 풀기도 둘 다 지나갔다.
 *
 * 다른 쪽은 **더 막았다.** `/^(127|10|0)\./` 는 **이름**에도 걸린다 —
 * `0.gravatar.com` · `0.pool.ntp.org` · `10.example.com` 이 전부 「사내」 로
 * 분류됐다. WebFetch 에서는 까닭 없는 거절로 보이고(시끄럽다), runmode 의
 * 바깥인가() 에서는 조용하다 — 게이트웨이 주소가 그런 이름이면
 * `바깥 = false` 가 되어 **봉인(offline) 중에도** 나갈 수 있다고 답한다.
 *
 * 그래서 숫자 주소는 **펴서** 보고, 이름은 숫자 규칙을 아예 안 태운다.
 * inet_aton 규칙 그대로다 — 마디 1~4개, 마지막 마디가 남은 자리를 다 먹는다.
 */
export function 숫자주소펴기(s) {
  const 마디 = String(s).split('.');
  if (마디.length < 1 || 마디.length > 4) return null;
  const 값들 = [];
  for (const m of 마디) {
    if (!/^(?:0[xX][0-9a-fA-F]{1,8}|0[0-7]*|[1-9]\d*)$/.test(m)) return null;
    const n = /^0[xX]/.test(m) ? parseInt(m, 16) : (/^0[0-7]+$/.test(m) ? parseInt(m, 8) : Number(m));
    if (!Number.isFinite(n) || n < 0) return null;
    값들.push(n);
  }
  const 앞 = 값들.slice(0, -1);
  const 끝 = 값들[값들.length - 1];
  if (앞.some((x) => x > 255)) return null;
  const 남은칸 = 4 - 앞.length;
  if (끝 >= 2 ** (8 * 남은칸)) return null;
  const out = [...앞];
  for (let i = 남은칸 - 1; i >= 0; i--) out.push((끝 / 2 ** (8 * i)) & 255);
  return out.join('.');
}

/**
 * 이 이름이 **실제로 어디로 풀리나.** 하나라도 사내·로컬이면 막는다.
 *
 * ── 왜 이름만 보면 모자란가 ───────────────────────────────────────────
 *
 * 위 isLocalHost 는 **글자**를 본다. `localhost` · `127.0.0.1` ·
 * `[::ffff:127.0.0.1]` 같은 철자를 촘촘히 편다. 그런데 이런 주소는 그 어느
 * 철자에도 안 걸린다:
 *
 *   https://내부로푸는이름.example.com/   ← A 레코드가 169.254.169.254
 *
 * 이름은 평범한 공개 도메인이고, DNS 만 공격자가 쥐고 있으면 된다. 글자
 * 검사를 지나서 **클라우드 메타데이터**(임시 자격증명이 나온다)나 사내
 * 서비스에 그대로 닿는다. 모델에게 주소 한 줄을 읽히는 것으로 끝난다.
 *
 * 그래서 이름을 실제로 풀어 보고, 돌아온 주소를 **전부** 본다. 하나라도
 * 사내·로컬이면 막는다 — 여러 개 중 하나만 안전한 척하는 응답도 있다.
 *
 * ── 여기까지가 이 자가 막는 것 ────────────────────────────────────────
 *
 * 푼 뒤에 실제 연결이 다시 풀린다(TOCTOU). 그 사이에 DNS 를 바꾸면 이 검사를
 * 지나고도 다른 데로 갈 수 있다. 그것까지 막으려면 푼 주소를 소켓에 못
 * 박아야 하는데, `fetch` 는 그 자리를 안 내준다. 여기서 막는 것은 **한 번
 * 푸는 것으로 끝나는 흔한 길**이고, 못 막는 것은 위에 적은 그 틈이다.
 * 적어 두지 않으면 다음 사람이 이것을 완전한 자물쇠로 여긴다.
 */
export async function 사설로풀리나(hostname) {
  const h = String(hostname ?? '').trim();
  if (!h) return null;
  // 숫자로 적힌 주소는 풀 것이 없다 — 부르는 쪽(WebFetch)이 안쪽주소인가 로 이미 본다.
  // 「숫자로 적힌」 을 글자 앞머리가 아니라 **펴 보고** 가른다(숫자주소펴기 머리말).
  if (숫자주소펴기(h) || h.includes(':') || h.startsWith('[')) return null;
  let 주소들;
  try {
    const { lookup } = await import('node:dns/promises');
    주소들 = await lookup(h, { all: true, verbatim: true });
  } catch {
    // 못 풀면 어차피 못 붙는다. 여기서 막을 것도 없다.
    return null;
  }
  // 풀려 나온 주소도 **막는 표**(안쪽주소인가)로 본다. isLocalHost 로 보면 A 레코드 한 줄이
  // 100.100.100.200(알리바바 메타데이터)을 가리킬 때 그대로 지나간다 (사냥4 W9).
  const 걸린것 = 주소들.map((a) => a.address).filter((a) => 안쪽주소인가(a));
  return 걸린것.length ? { 주소들: 주소들.map((a) => a.address), 걸린것 } : null;
}

function originOf(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

/*
 * 거쳐 갈 프록시 주소에서 **호스트만** 꺼낸다. 못 읽으면 null.
 *
 * 프록시읽기(backend/proxy.js)는 `http://host:port` 꼴로 넘기지만, 여기까지 오는 길에
 * 스킴 없는 `host:port` 가 섞여도 같은 답을 내야 한다 — 봉인을 가르는 자리라 「못 읽었다」 가
 * 「검사 안 함」 이 되면 안 된다. 사람 이름·비밀번호는 여기서 떨어져 나간다.
 */
function 경유호스트(거쳐) {
  const s = String(거쳐 ?? '').trim();
  if (!s) return null;
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`).hostname; } catch { return null; }
}

// 하나뿐인 문지기. 모듈 하나에 상태를 두는 것은 일부러다 —
// 여기저기서 각자 예외를 두면 자물쇠가 아니게 된다.
const gate = {
  allow: new Set(),     // 통과시킬 origin 들
  offline: false,       // true 면 이 컴퓨터 밖은 전부 거절
  log: [],              // 실제로 나간 곳 (사람이 확인용)
  enforced: true,
};

/*
 * 모델 연결 주소를 허용 목록에 올린다. **이전에 올린 것은 지운다.**
 *
 * 여럿을 한 번에 줄 수 있다. 다만 그건 "하나씩 더 쌓는" 길이 아니다 — 부르는
 * 쪽이 지금 열려 있어야 할 것 **전부**를 한 번에 말하는 것이다. 쌓는 길을
 * 내주면 여기저기서 한 줄씩 더하다가 자물쇠가 자물쇠가 아니게 된다.
 *
 * 여럿이 필요한 자리는 하나다. 사람이 스킴을 안 적은 주소를 넣었을 때,
 * 자리마다 기본으로 붙이는 스킴이 달라서(로컬은 http, Azure 는 https) 둘 다
 * 열어 둬야 우리가 만든 주소를 우리 자물쇠가 막지 않는다. 호스트는 사람이
 * 적어 넣은 그 하나뿐이라 넓어지는 것이 아니다.
 */
export function allowEndpoint(baseUrl) {
  gate.allow.clear();
  for (const u of Array.isArray(baseUrl) ? baseUrl : [baseUrl]) {
    if (u) gate.allow.add(originOf(u));
  }
  /*
   * 잠깐 연 것(allowTemporarily)은 여기가 닫는 자리가 아니다. 통째로 비우면서 같이 쓸어
   * 갔더니, 플러그인을 받는 동안 /model 로 갈아탄 것만으로 받던 곳이 「허용되지 않은
   * 주소」 로 막혔다(8회차). 닫는 것은 잠깐 연 자가 받아 간 함수뿐이라, 아직 살아 있는
   * 것은 도로 올린다. 「원래 열려 있었나」 는 이제 **새 목록** 기준이다 — 그래야 마지막이
   * 닫을 때 새 연결을 실수로 안 닫는다.
   */
  for (const [o, 칸] of 잠깐연것) {
    칸.원래 = gate.allow.has(o);
    gate.allow.add(o);
  }
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
  /*
   * ── 봉인은 **거쳐 가는 기계**도 본다 (8회차) ───────────────────────────
   *
   * 목적지만 봤다. isLocalHost 는 사내망(10.x · 192.168.x · 172.16–31.x)까지 「이 안」 으로
   * 치는데, 프록시를 비켜 가는 잣대(backend/proxy.js 프록시비켜가나)는 **루프백만**이다.
   * 그래서 `--offline` + LAN Ollama(192.168.0.50) + `HTTP_PROXY=proxy.사내.example:8080`
   * 조합에서 목적지만 검사를 받고, 패킷이 실제로 닿는 첫 기계인 사내 프록시는 아무 검사도
   * 안 받았다 — 게이트웨이 열쇠가 실린 요청이 봉인 중에 그대로 컴퓨터 밖으로 나갔다.
   *
   * 봉인이 막는 것은 「이 컴퓨터 밖」 이지 프록시라는 말이 아니다. 그래서 프록시에도 목적지와
   * **같은 잣대**(isLocalHost)를 댄다 — 루프백 프록시(127.0.0.1:3128)를 거쳐 로컬 창구에
   * 붙는 길은 그대로 열려 있고, 바깥으로 나가는 프록시만 막힌다. 주소를 못 읽으면 막는다
   * (모를 때는 좁은 쪽). 탈 글에는 호스트만 싣는다 — 프록시 주소에는 비밀번호가 실려 온다.
   */
  if (gate.offline && 거쳐) {
    const 경유 = 경유호스트(거쳐);
    if (!경유 || !isLocalHost(경유)) {
      throw new NetBlocked(url,
        `오프라인 모드입니다 — 거쳐 갈 프록시(${경유 ?? '읽을 수 없는 주소'})가 이 컴퓨터 밖입니다.`);
    }
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
  // 거친 것이 없으면 **비운다.** 놔두면 직접 나간 요청 뒤에도 심사서·화면이 옛 프록시를
  // 「이 프록시를 거친다」 고 적는다 — 어디로 나갔는지 묻는 자리에서 제일 나쁜 거짓말이다(8회차).
  마지막경유 = 거쳐 ? { url: 거쳐 } : null;
  return true;
}
