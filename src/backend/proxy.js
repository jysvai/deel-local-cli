// 프록시를 거칠지, 거친다면 어디로 갈지를 정한다. 소켓은 안 만든다 — 그건 http.js 의 일이다.
//
// 왜 필요한가:
//   README 는 "프록시 뒤면 HTTPS_PROXY 를 주라" 고 적어 놨었다. 그런데 Node 의 fetch 는
//   그 환경변수를 **안 본다.** 직접 재 봤다 — HTTP_PROXY 를 주고 fetch 를 하니 프록시는
//   요청을 한 건도 못 봤고, 대상 서버로 곧장 갔다. (Node 24 부터 NODE_USE_ENV_PROXY=1
//   로 켜면 보긴 하는데, 프로세스가 뜨기 전에 걸어야 하고 Node 20·22 에는 없다.)
//   바깥으로 직접 못 나가는 사내망에서는 그게 "연결 실패" 한 줄로 끝났다. 적혀 있는
//   탈출구가 실제로는 막혀 있는 것이 제일 나쁘다.
//
// 어느 것이 이기나:
//   1) 설정 파일의 proxy — 'none' 이면 환경변수가 있어도 안 쓴다. 회사 PC 는 프록시
//      환경변수가 전역으로 박혀 있는데, 그걸 못 끄면 게이트웨이가 사내망 안에 있어도
//      프록시로 돌아 나간다.
//   2) 환경변수 — https 대상은 HTTPS_PROXY, http 대상은 HTTP_PROXY, 둘 다 없으면 ALL_PROXY.
//      소문자 이름도 본다 (리눅스 도구들은 소문자를 먼저 본다).
//   3) NO_PROXY 에 걸리면 직접 — `*` 는 전부, `.corp.com`·`corp.com` 은 뒤가 맞으면,
//      `host:port` 는 포트까지, IPv4 는 그대로.
//   4) 그리고 **루프백은 언제나 직접 간다.** localhost 의 Ollama 가 프록시로 나가서
//      죽는 것을 막는 규칙이다. curl 은 안 그러지만 윈도우·브라우저는 다 이렇게 한다.
//
// 지원하지 않는 것은 그렇다고 말한다: https:// 프록시, socks5://, PAC 파일, 윈도우
// 레지스트리 프록시, NTLM/Negotiate 인증. 조용히 직접 가는 것보다 낫다.

const 루프백 = (h) => {
  const s = String(h ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  return s === 'localhost' || s === '::1' || /^127\./.test(s) || s === '0.0.0.0';
};

/** 'http://user:pass@host:8080' → { url, host, port, auth }. 못 읽으면 { 탈 } */
export function 프록시읽기(값) {
  const s = String(값 ?? '').trim();
  if (!s) return null;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`); } catch { return { 탈: `프록시 주소를 읽을 수 없습니다: ${s}` }; }
  if (u.protocol !== 'http:') {
    return { 탈: `${u.protocol}// 프록시는 지원하지 않습니다 (http:// 프록시만 됩니다): ${s}` };
  }
  const auth = u.username
    ? `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64')}`
    : null;
  return {
    url: `http://${u.host}`,
    host: u.hostname,
    port: Number(u.port || 80),
    auth,
  };
}

/** NO_PROXY 한 줄을 항목 배열로. */
export function 우회목록(값) {
  return String(값 ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
}

/** 이 대상이 NO_PROXY 에 걸리나. */
export function 우회할까(hostname, port, 목록) {
  const h = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  const p = Number(port);
  for (const 항목 of 목록 ?? []) {
    if (항목 === '*') return true;
    let 이름 = 항목;
    let 포트 = null;
    const m = /^(.*):(\d+)$/.exec(항목);
    if (m && !/^\[?[0-9a-f:]+\]?$/i.test(항목)) { 이름 = m[1]; 포트 = Number(m[2]); }
    if (포트 !== null && 포트 !== p) continue;
    이름 = 이름.replace(/^\*/, '').replace(/^\./, '');
    if (!이름) continue;
    if (h === 이름 || h.endsWith(`.${이름}`)) return true;
  }
  return false;
}

let 지금 = { 프록시: null, 출처: null, 우회: [], 로컬우회: true, 탈: null };

/**
 * 켤 때 한 번 정한다. 설정이 환경변수를 이긴다.
 * @param {{ env?: object, config?: object|null, 로컬우회?: boolean }} 자리
 *   로컬우회 는 검사만 false 로 준다 — 진짜 실행에서는 루프백이 언제나 직접이다.
 */
export function 프록시정하기({ env = process.env, config = null, 로컬우회 = true } = {}) {
  const 읽기 = (k) => env[k] ?? env[k.toLowerCase()] ?? null;
  const 우회 = 우회목록(읽기('NO_PROXY'));
  const 정한값 = config?.proxy;
  let 고른것 = null;
  let 출처 = null;
  let 탈 = null;

  if (정한값 === 'none' || 정한값 === false) {
    // 일부러 끈 것. 환경변수는 안 본다.
  } else if (typeof 정한값 === 'string' && 정한값.trim()) {
    고른것 = 프록시읽기(정한값);
    출처 = 'config';
  } else {
    // 환경변수는 대상 규격에 따라 다르므로 여기서는 둘 다 들고 있다가 고를 때 본다.
    고른것 = {
      https: 읽기('HTTPS_PROXY') ? 프록시읽기(읽기('HTTPS_PROXY')) : null,
      http: 읽기('HTTP_PROXY') ? 프록시읽기(읽기('HTTP_PROXY')) : null,
      all: 읽기('ALL_PROXY') ? 프록시읽기(읽기('ALL_PROXY')) : null,
      출처: { https: 'HTTPS_PROXY', http: 'HTTP_PROXY', all: 'ALL_PROXY' },
    };
    출처 = 'env';
    if (!고른것.https && !고른것.http && !고른것.all) { 고른것 = null; 출처 = null; }
  }
  if (고른것?.탈) { 탈 = 고른것.탈; 고른것 = null; 출처 = null; }
  for (const k of ['https', 'http', 'all']) {
    if (고른것?.[k]?.탈) { 탈 = 고른것[k].탈; 고른것[k] = null; }
  }
  지금 = { 프록시: 고른것, 출처, 우회, 로컬우회, 탈 };
  return 프록시설정();
}

/** 지금 정해진 것 (화면·심사서용). 비밀번호는 안 낸다. */
export function 프록시설정() {
  const 것 = 지금.프록시;
  const 하나 = (p, 출처) => (p ? { url: p.url, 출처, 인증: !!p.auth } : null);
  let 목록 = [];
  if (지금.출처 === 'config' && 것) 목록 = [하나(것, 'config')];
  else if (지금.출처 === 'env' && 것) {
    목록 = [
      것.https ? 하나(것.https, 'HTTPS_PROXY') : null,
      것.http ? 하나(것.http, 'HTTP_PROXY') : null,
      것.all ? 하나(것.all, 'ALL_PROXY') : null,
    ].filter(Boolean);
  }
  return { 프록시들: 목록, 우회: 지금.우회.slice(), 로컬우회: 지금.로컬우회, 탈: 지금.탈, 켜짐: 목록.length > 0 };
}

/**
 * 이 주소로 갈 때 거칠 프록시. 없으면 null (직접 간다).
 * @returns {{ url, host, port, auth, 출처 }|null}
 */
export function 프록시고르기(url) {
  const 것 = 지금.프록시;
  if (!것) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (지금.로컬우회 && 루프백(u.hostname)) return null;
  const 포트 = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  if (우회할까(u.hostname, 포트, 지금.우회)) return null;

  if (지금.출처 === 'config') return { ...것, 출처: 'config' };
  const k = u.protocol === 'https:' ? 'https' : 'http';
  const p = 것[k] ?? 것.all;
  if (!p) return null;
  return { ...p, 출처: 것[k] ? 것.출처[k] : 것.출처.all };
}

/** 검사용 — 아무것도 안 정한 상태로. */
export function 프록시지우기() {
  지금 = { 프록시: null, 출처: null, 우회: [], 로컬우회: true, 탈: null };
}
