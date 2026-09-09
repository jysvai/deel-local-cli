// 못 붙은 것은 **다시 붙어 본다** — 한 세션이 거기서 안 끝나게.
//
// ── 왜 이 검사가 생겼나 ─────────────────────────────────────────────────
//
// 「한 세션에서 계속 진행되게 해 달라」 는 말에서 시작했다. 재 보니 세션이
// 바뀌는 것이 아니라 **턴이 죽고 있었다.**
//
// retry.js 는 여태 「시간 초과는 다시 안 부른다」 였다. 그 규칙은 머리말
// 시계(5분)를 두고 한 말로는 옳다 — 5분 기다렸다가 또 5분을 기다리는 것은
// 사람을 붙드는 짓이다.
//
// 그런데 그 한 규칙이 **아직 붙지도 못한 것**까지 같이 덮고 있었다.
//
//   fetch 로 안 닿는 주소를 부르면 10초 만에 UND_ERR_CONNECT_TIMEOUT 이 온다.
//   그 코드는 다시부를코드 에 없었다 → 턴이 통째로 죽는다.
//
// 무선이 잠깐 끊기거나, 노트북이 깨어나거나, VPN 이 다시 붙는 동안이 전부
// 여기다. 몇 초 뒤면 되는 것들인데 사람은 같은 말을 다시 치고, 그 턴에 읽어
// 둔 도구 결과는 날아갔다.
//
// 소켓이 아예 안 생긴 자리라 **서버에는 아무것도 안 갔다.** 다시 불러도 두
// 벌이 될 답이 없다 — 다시 부르기에 제일 안전한 종류다.
//
// ── 여기서 제일 조심할 것 ───────────────────────────────────────────────
//
// 넓게 잡으면 **안 되는 것을 세 번씩 두드린다.** 주소를 잘못 친 사람은 틀린
// 주소로 세 번 가고, 세 배 늦게 「주소가 틀렸다」 를 듣는다. 그래서 3번
// (안 부르는 쪽)이 이 파일의 알맹이다.
import { createServer } from 'node:http';
import { 다시부를까, 못붙은것인가, 기본정책 } from '../src/backend/retry.js';
import { req, 원시요청, 연결기본, 못붙음오류 } from '../src/backend/http.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { 프록시정하기, 프록시지우기 } from '../src/backend/proxy.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 1. 못 붙은 것은 다시 부른다 ─────────────────────────────────────────
trace('1-다시부름');
{
  const 못붙음 = [
    ['UND_ERR_CONNECT_TIMEOUT', 'undici 가 10초 안에 소켓을 못 얻음 — 곧장 가는 길'],
    ['CONNECT_TIMEOUT', '우리가 노드 길에 붙인 이름 — 프록시·인증서 쓰는 길'],
    ['ETIMEDOUT', 'OS 가 TCP 연결에서 손을 뗌'],
    ['EAI_AGAIN', '이름 풀이가 **잠깐** 안 됨'],
    ['ENETUNREACH', '망이 잠깐 없음 (깨어나는 중·VPN 이 붙는 중)'],
    ['EHOSTUNREACH', ''],
    ['ENETDOWN', ''],
    ['ENETRESET', ''],
  ];
  for (const [코드, 왜] of 못붙음) {
    check(`★★★ ${코드} 는 다시 부른다`,
      다시부를까({ status: 0, code: 코드, attempt: 1 }) === true, 왜);
  }
  check('★★ 붙었다 끊긴 것도 그대로 다시 부른다 (여태 하던 것)',
    다시부를까({ status: 0, code: 'ECONNRESET', attempt: 1 }) === true, '');
}

// ── 2. 두 길이 같은 말을 한다 ───────────────────────────────────────────
trace('2-두길');
{
  /*
   * 곧장 가는 길과 프록시·인증서 길이 **같은 자리에서 다른 결말**이면, 같은
   * 게이트웨이를 쓰는데 프록시를 켠 사람만 못 쓰게 된다. 설명하기 제일 어려운
   * 종류의 차이라 여기서 못 박는다.
   */
  check('★★★ 곧장 가는 길의 코드와 노드 길의 코드가 둘 다 다시 부르는 쪽이다',
    다시부를까({ code: 'UND_ERR_CONNECT_TIMEOUT' }) === 다시부를까({ code: 'CONNECT_TIMEOUT' }), '');
  check('★★ 노드 길 오류에 코드가 붙어 있다', 못붙음오류(10000).code === 'CONNECT_TIMEOUT', '');
  check('★★ 사람이 읽을 말에 초가 적혀 있다', /10초/.test(못붙음오류(10000).message),
    못붙음오류(10000).message);
  check('★ 붙는 데까지 주는 시간이 undici 와 같다 (10초)', 연결기본 === 10000, String(연결기본));
}

// ── 3. 안 되는 것은 세 번 두드리지 않는다 ───────────────────────────────
trace('3-안부름');
{
  /*
   * 여기가 위험한 쪽이다. 「연결 실패니까 다시」 로 뭉뚱그리면, 주소를 잘못
   * 친 사람이 틀린 주소로 세 번 가고 세 배 늦게 답을 듣는다.
   */
  check('★★★ ENOTFOUND 는 안 부른다 — 이름이 틀린 것은 백 번 물어도 틀리다',
    다시부를까({ status: 0, code: 'ENOTFOUND', attempt: 1 }) === false, '');
  check('★★★ ECONNREFUSED 도 안 부른다 — 서버가 꺼져 있다',
    다시부를까({ status: 0, code: 'ECONNREFUSED', attempt: 1 }) === false, '');
  check('★★★ 머리말 시계(5분)가 끝난 것은 안 부른다 — 5분을 또 기다릴 일이 아니다',
    다시부를까({ status: 0, code: 'TimeoutError', attempt: 1 }) === false, '');
  check('★★★ 흐름이 멎어 우리가 끊은 것도 안 부른다 — 반쯤 온 답이 두 벌 된다',
    다시부를까({ status: 0, code: 'STALL', attempt: 1 }) === false, '');
  check('★★ 살아 있다는 신호만 오다 끊은 것도 안 부른다',
    다시부를까({ status: 0, code: 'NONEWS', attempt: 1 }) === false, '');
  check('★★★ 400·401 은 그대로 안 부른다',
    다시부를까({ status: 400, attempt: 1 }) === false && 다시부를까({ status: 401, attempt: 1 }) === false, '');

  /*
   * EAI_AGAIN 과 ENOTFOUND 는 이름이 닮았지만 뜻이 정반대다. 규격이 앞엣것을
   * 「지금은 못 하겠다, 다시 물어라」 로 정해 두었다. 둘을 갈라 놓는 것이
   * 이 목록의 값어치라, 붙여 놓고 잰다.
   */
  check('★★★ EAI_AGAIN 과 ENOTFOUND 를 가른다',
    다시부를까({ code: 'EAI_AGAIN' }) === true && 다시부를까({ code: 'ENOTFOUND' }) === false, '');
}

// ── 4. 횟수 울타리는 그대로다 ───────────────────────────────────────────
trace('4-횟수');
{
  // 못 붙었다고 무한히 두드리면 그건 고친 게 아니라 울타리를 치운 것이다.
  const 정책 = 기본정책();
  check('★★★ 못 붙은 것도 최대 횟수를 넘기면 그만둔다',
    다시부를까({ code: 'UND_ERR_CONNECT_TIMEOUT', attempt: 정책.최대 + 1 }, 정책) === false,
    `최대 ${정책.최대}`);
  check('★★ 마지막 한 번까지는 부른다',
    다시부를까({ code: 'UND_ERR_CONNECT_TIMEOUT', attempt: 정책.최대 }, 정책) === true, '');
}

// ── 5. 못붙은것인가 가 화면에 쓸 만한가 ─────────────────────────────────
trace('5-가르기');
{
  check('★★ 못 붙은 것을 참이라 한다', 못붙은것인가('UND_ERR_CONNECT_TIMEOUT') === true, '');
  check('★★ 붙었다 끊긴 것은 거짓이다', 못붙은것인가('ECONNRESET') === false, '');
  check('★ 빈 값에도 안 죽는다', 못붙은것인가(null) === false && 못붙은것인가(undefined) === false, '');
}

// ── 6. 진짜 연결에서도 그 코드가 나오나 ─────────────────────────────────
trace('6-실물');
{
  /*
   * 목록만 맞추고 실제로 안 나오는 코드면 아무것도 안 고친 것이다. 그래서
   * 소켓을 실제로 열어 본다 — 다만 **밖으로는 안 나간다.** 서버를 띄우고
   * 바로 닫아, 아무도 안 듣는 포트를 만든다.
   */
  const srv = createServer((q, s) => s.end('ok'));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const 포트 = srv.address().port;
  await new Promise((r) => srv.close(r));
  const 주소 = `http://127.0.0.1:${포트}`;
  allowEndpoint(주소);   // 자물쇠(safety/network.js)는 이 검사가 여는 자리가 아니다

  const r = await req(`${주소}/`, { method: 'GET', timeout: 5000, 연결: 1000 });
  check('★★ 아무도 안 듣는 포트는 실패로 온다 (던지지 않는다)', r.ok === false, JSON.stringify(r.code));
  // 꺼진 포트는 거절(ECONNREFUSED)이다 — 다시 불러도 같다. 그걸 확인한다.
  check('★★★ 꺼진 포트를 세 번 두드리지 않는다',
    다시부를까({ status: r.status, code: r.code, attempt: 1 }) === false, String(r.code));
  check('★ 사람이 읽을 말이 붙어 있다', typeof r.error === 'string' && r.error.length > 0, String(r.error));
  resetNet();
}

// ── 7. 프록시 길도 같은 시계를 쓰나 ─────────────────────────────────────
trace('7-노드길');
{
  /*
   * 여기가 이 판에서 제일 크게 달라진 자리다.
   *
   * **전에는** 프록시를 켠 사람만 머리말 시계(5분)가 붙는 시간까지 같이 재고
   * 있었다. 프록시가 안 닿으면 5분을 꽉 채우고 나서 `TimeoutError` 로 죽었고,
   * 그건 다시 부르는 목록에 없다 — 5분 뒤에 턴이 통째로 사라졌다.
   *
   * 곧장 가는 사람은 같은 자리에서 10초 만에 알고 다시 붙는다. 같은 게이트웨이,
   * 같은 망인데 프록시 하나로 결말이 갈렸다.
   *
   * 주소는 TEST-NET-1(192.0.2.0/24)이다. 규격이 문서·예제용으로 떼어 둔
   * 대역이라 라우팅이 안 된다 — 이 검사는 **밖으로 한 바이트도 안 보낸다.**
   */
  프록시정하기({ env: { HTTP_PROXY: 'http://192.0.2.1:3128' }, 로컬우회: false });
  const 프록시주소 = 'http://192.0.2.9:8080';
  allowEndpoint(프록시주소);

  const t0 = Date.now();
  let 탈 = null;
  try {
    // 머리말 시계는 30초로 넉넉히 두고, 연결 시계만 500ms 로 줄인다.
    // 연결 시계가 없으면 30초를 다 쓴다 — 그 차이가 이 검사가 재는 것이다.
    await 원시요청(`${프록시주소}/x`, { method: 'GET', timeout: 30000, 연결: 500 });
  } catch (e) { 탈 = e; }
  const 걸린 = Date.now() - t0;
  프록시지우기();
  resetNet();

  check('★★★ 프록시가 안 닿으면 연결 시계에서 멎는다 (머리말 시계를 안 기다린다)',
    걸린 < 5000, `${걸린}ms · 머리말 시계는 30000ms`);
  check('★★★ 그 실패에 다시 부를 수 있는 코드가 붙는다',
    탈?.code === 'CONNECT_TIMEOUT', String(탈?.code));
  check('★★★ 그래서 이 실패는 턴을 안 죽인다',
    다시부를까({ status: 0, code: 탈?.code, attempt: 1 }) === true, String(탈?.code));
  check('★★ 사람에게 「응답이 없다」 가 아니라 「못 붙었다」 고 말한다',
    /연결하지 못했습니다/.test(String(탈?.message)), String(탈?.message));
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n못 붙은 것 다시 붙기 검사  ${D}(한 세션이 망 한 번에 안 끝나게)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
