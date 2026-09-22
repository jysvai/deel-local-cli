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

import { 루프백인가, 숫자주소펴기, 여섯펴기 } from '../safety/network.js';

/*
 * 루프백은 safety/network.js 가 편다 (루프백인가).
 *
 * 여기는 `/^127\./` 로 **글자 앞머리**를 봤다(사냥4 W15). 그래서 `127.example.com` 은
 * 이름인데 루프백으로 읽혀 프록시를 건너뛰었고 — 바깥으로 직접 못 나가는 사내에서는
 * 그대로 「연결 실패」 다 — 진짜 루프백인 `[::ffff:127.0.0.1]` 은 프록시로 돌아 나갔다.
 * network.js 가 같은 탈을 먼저 고쳤는데 여기만 옛 잣대로 남아 있었다. 잣대를 두 벌 두면
 * 늘 한쪽만 고쳐진다 — 그래서 옮겨 적지 않고 불러다 쓴다.
 */
const 루프백 = (h) => 루프백인가(h);

/*
 * 탈 글에 실을 주소 — 사람 이름·비밀번호를 가린다.
 *
 * 탈 글은 화면과 진단 보고서에 그대로 찍힌다. `http://user:secret@…` 를 못 읽었다고
 * 원문째 적으면, 비밀번호를 파일에 안 남기려고 해 둔 것들이 그 한 줄로 무너진다.
 */
const 가린주소 = (s) => String(s).replace(/^((?:[a-z][a-z0-9+.-]*:)?\/\/)?[^/@\s]*@/i, '$1…@');

/** 'http://user:pass@host:8080' → { url, host, port, auth }. 못 읽으면 { 탈 } */
export function 프록시읽기(값) {
  const s = String(값 ?? '').trim();
  if (!s) return null;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`); } catch { return { 탈: `프록시 주소를 읽을 수 없습니다: ${가린주소(s)}` }; }
  if (u.protocol !== 'http:') {
    return { 탈: `${u.protocol}// 프록시는 지원하지 않습니다 (http:// 프록시만 됩니다): ${가린주소(s)}` };
  }
  /*
   * ── 사람 이름·비밀번호를 못 푸는 판 (사냥4 W6) ────────────────────────
   *
   * 비밀번호에 맨 `%` 가 들어 있으면(`p%zz` · `100%`) URL 은 읽히는데 decodeURIComponent
   * 가 URIError 를 던졌다. 여기는 켤 때(config.load → 프록시정하기) 부르는 자리라, 그
   * 한 번의 던짐이 **모든 실행을** 「URI malformed」 한 줄로 끝냈다 — 무엇이 틀렸는지
   * 말해 줄 deel doctor 조차 못 띄운다. 비밀번호에 % 가 드는 일은 드물지 않다.
   *
   * 머리말이 약속한 대로 { 탈 } 로 남기고 직접 간다. 무엇을 고치면 되는지(%25)까지
   * 말하되, 비밀번호는 싣지 않는다.
   */
  let auth = null;
  if (u.username) {
    try {
      auth = `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64')}`;
    } catch {
      return { 탈: `프록시 주소의 사용자·비밀번호를 읽을 수 없습니다 — 글자 % 는 %25 로 적어야 합니다: http://…@${u.host}` };
    }
  }
  return {
    url: `http://${u.host}`,
    host: u.hostname,
    port: Number(u.port || 80),
    auth,
  };
}

/** NO_PROXY 한 줄을 항목 배열로. */
function 우회목록(값) {
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
    /*
     * ── 세 꼴이 안 맞았다 (사냥4 W14) ──────────────────────────────────
     *
     *   [fd00::5]        대괄호를 안 벗겨서 글자가 끝내 달랐다
     *   [fd00::5]:8080   통째로 IPv6 로 보고 포트를 안 갈랐다
     *   10.0.0.0/8       대역을 글자로 견줬다
     *
     * curl · Go · Python 이 다 받는 꼴이라 사내 NO_PROXY 에 흔히 적혀 있다. 안 맞으면
     * 사내 대역이 **조용히** 프록시로 돌아 나간다 — 되면 느리고, 안 되면 「연결 실패」 다.
     * 포트를 가르는 것은 이제 「콜론 앞에 콜론이 없을 때」 뿐이다. `fd00::5` 는 가르지 않는다.
     */
    const 괄호 = /^\[([^\]]+)\](?::(\d+))?$/.exec(항목);
    if (괄호) { 이름 = 괄호[1]; 포트 = 괄호[2] ? Number(괄호[2]) : null; }
    else {
      const m = /^(.*):(\d+)$/.exec(항목);
      if (m && !m[1].includes(':')) { 이름 = m[1]; 포트 = Number(m[2]); }
    }
    if (포트 !== null && 포트 !== p) continue;
    if (이름.includes('/')) { if (대역에드나(h, 이름)) return true; continue; }
    이름 = 이름.replace(/^\*/, '').replace(/^\./, '');
    if (!이름) continue;
    if (h === 이름 || h.endsWith(`.${이름}`)) return true;
    // IPv6 는 같은 주소를 여러 철자로 적는다(fd00::5 · fd00:0::5). 펴서 견준다.
    if (h.includes(':') && 이름.includes(':')) {
      const 가 = 여섯펴기(h);
      const 나 = 여섯펴기(이름);
      if (가 && 나 && 가.every((x, i) => x === 나[i])) return true;
    }
  }
  return false;
}

/**
 * 이 주소가 `10.0.0.0/8` · `fd00::/8` 같은 대역 안인가. 이름에는 안 걸린다.
 * 주소를 펴는 것은 safety/network.js 의 것을 쓴다 — `10.1` 같은 줄인 꼴도 거기서 편다.
 */
function 대역에드나(h, 대역) {
  const [밑, 길이글] = String(대역).split('/');
  if (!/^\d{1,3}$/.test(길이글 ?? '')) return false;
  const 길이 = Number(길이글);
  const 넷밑 = 숫자주소펴기(밑);
  const 넷h = 숫자주소펴기(h);
  if (넷밑 && 넷h) {
    if (길이 > 32) return false;
    const 수 = (x) => x.split('.').reduce((n, v) => n * 256 + Number(v), 0);
    const 칸 = 2 ** (32 - 길이);
    return Math.floor(수(넷h) / 칸) === Math.floor(수(넷밑) / 칸);
  }
  const 여섯밑 = 여섯펴기(밑);
  const 여섯h = 여섯펴기(h);
  if (!여섯밑 || !여섯h || 길이 > 128) return false;
  for (let i = 0, 남은 = 길이; i < 8 && 남은 > 0; i++, 남은 -= 16) {
    const 가림 = (0xffff << (16 - Math.min(16, 남은))) & 0xffff;
    if ((여섯밑[i] & 가림) !== (여섯h[i] & 가림)) return false;
  }
  return true;
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
  if (프록시비켜가나(u)) return null;

  if (지금.출처 === 'config') return { ...것, 출처: 'config' };
  const k = u.protocol === 'https:' ? 'https' : 'http';
  const p = 것[k] ?? 것.all;
  if (!p) return null;
  return { ...p, 출처: 것[k] ? 것.출처[k] : 것.출처.all };
}

/**
 * 이 주소는 프록시가 있어도 안 거치나 — 루프백(로컬우회) · NO_PROXY.
 *
 * 프록시고르기 가 가르는 자리이고, 진단 보고서도 같은 것으로 가른다: 못 쓰는 프록시(socks5 등)를
 * 알리는 줄은 **어차피 안 거칠 주소**에는 안 낸다. 로컬 모델이 안 붙는 까닭을 찾는 사람을
 * 상관없는 프록시 쪽으로 보내게 된다 (2.0.0 6회차 RP1).
 * @param {string|URL} url  못 읽는 주소면 false
 */
export function 프록시비켜가나(url) {
  let u;
  try { u = url instanceof URL ? url : new URL(url); } catch { return false; }
  if (지금.로컬우회 && 루프백(u.hostname)) return true;
  const 포트 = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  return 우회할까(u.hostname, 포트, 지금.우회);
}

/** 검사용 — 아무것도 안 정한 상태로. */
export function 프록시지우기() {
  지금 = { 프록시: null, 출처: null, 우회: [], 로컬우회: true, 탈: null };
}
