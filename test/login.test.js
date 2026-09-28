// 브라우저로 로그인 — 열쇠를 붙여 넣지 않고 계정으로 받아 온다 (2.1.4).
//
// ── 여기서 지키려는 것 ──────────────────────────────────────────────────
//
//   1. **받은 열쇠는 우리만 바꿀 수 있다.** 코드를 열쇠로 바꾸려면 검증자가 있어야 하고
//      (PKCE), 검증자는 브라우저·콜백 길로는 안 지나고 교환 창구로만 간다. 콜백 길도 판마다 새로 짓는다.
//   2. **봉인이면 아무 데도 안 간다.** 브라우저도 안 열고, 교환도 안 한다.
//   3. **기다림에 끝이 있다.** 사람이 창을 닫고 떠나도 문은 닫힌다.
//   4. **열쇠는 화면에 안 찍힌다.** 받은 것은 부르는 쪽에 넘길 뿐이다.
//
// 붙는 곳은 이 컴퓨터 안의 가짜 서버뿐이다. openrouter.ai 로는 안 나간다.
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { PKCE만들기, 원격인가, 코드꺼내기, 링크로그인, 콜백귀열기 } from '../src/login.js';
import { 여는명령 } from '../src/ui/browser.js';
import { allowed, resetNet } from '../src/safety/network.js';
import { 제공자고르기 } from '../src/providers/index.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
// 그 포트에 아직 누가 듣고 있나. 닫혔으면 true.
const 닫혔나 = (port) => new Promise((풀기) => {
  const s = connect({ port, host: '127.0.0.1' });
  s.on('connect', () => { s.destroy(); 풀기(false); });
  s.on('error', () => 풀기(true));
});

trace('1-PKCE');

{
  const a = PKCE만들기();
  const b = PKCE만들기();
  check('검증자는 RFC 7636 글자만 43~128자', /^[A-Za-z0-9\-._~]{43,128}$/.test(a.검증자), a.검증자);
  const 기대 = createHash('sha256').update(a.검증자).digest('base64url');
  check('★ 도전 = base64url(sha256(검증자)), 패딩 없음', a.도전 === 기대 && !a.도전.includes('='), a.도전);
  check('★ 판마다 새로 짓는다', a.검증자 !== b.검증자 && a.도전 !== b.도전);
}

trace('2-원격판정');

{
  check('SSH 로 들어왔으면 원격', 원격인가({ SSH_CONNECTION: '1.2.3.4 5 6.7.8.9 22' }, 'linux'));
  check('SSH_TTY 만 있어도 원격', 원격인가({ SSH_TTY: '/dev/pts/0', DISPLAY: ':0' }, 'linux'));
  check('윈도 SSH 도 원격', 원격인가({ SSH_CLIENT: '1.2.3.4 5 22' }, 'win32'));
  check('리눅스인데 화면이 없으면 원격(컨테이너)', 원격인가({}, 'linux'));
  check('리눅스 데스크톱은 이 자리', !원격인가({ DISPLAY: ':0' }, 'linux'));
  check('웨이랜드도 이 자리', !원격인가({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux'));
  check('WSL 은 윈도 브라우저로 여니 이 자리', !원격인가({ WSL_DISTRO_NAME: 'Ubuntu' }, 'linux'));
  check('윈도 · 맥은 이 자리', !원격인가({}, 'win32') && !원격인가({}, 'darwin'));
}

trace('3-코드꺼내기');

{
  const 것들 = [
    ['abc123', 'abc123'],
    ['  abc-1_2.3~  ', 'abc-1_2.3~'],
    ['http://localhost:51423/deel-x?code=zz9&state=1', 'zz9'],
    ['주소창: http://localhost:1/cb?state=1&code=q%2Bw', 'q+w'],
    ['code=kk', 'kk'],
    // 패딩 든 코드 · 조각(#) 뒤 코드도 코드다 (2.1.4 Gemini 리뷰).
    ['AQIDBA==', 'AQIDBA=='],
    ['http://localhost:8080/#code=my_code_123', 'my_code_123'],
    ['', null],
    ['   ', null],
    ['두 낱말', null],
    ['https://openrouter.ai/auth?error=access_denied', null],
  ];
  for (const [넣은것, 기대] of 것들) {
    check(`코드꺼내기(${JSON.stringify(넣은것)}) → ${기대}`, 코드꺼내기(넣은것) === 기대, String(코드꺼내기(넣은것)));
  }
}

trace('4-브라우저-여는-명령');

{
  const url = 'https://openrouter.ai/auth?callback_url=http%3A%2F%2Flocalhost%3A1%2Fx&code_challenge=AB&code_challenge_method=S256';
  const [윈명령, 윈인자, 윈설정] = 여는명령(url, 'win32');
  /*
   * `cmd /c start "" <url>` 은 따옴표 밖의 `&` 를 명령 구분자로 먹는다. 로그인 주소에는 `&` 가
   * 셋이라 브라우저에는 `?callback_url=…` 까지만 가고, 뒤는 명령으로 돌려진다. Node 는 빈칸 없는
   * 인자를 따옴표로 안 싸므로 우리가 싸고, Node 가 그 따옴표를 `\"` 로 망치지 않게 그대로 넘긴다.
   * (rundll32 로 비켜 가는 길은 사내 보안 정책이 막는 일이 흔하다 — 2.1.4 Gemini 검토.)
   */
  check('윈도는 여태처럼 cmd start', /^cmd$/i.test(윈명령) && 윈인자.includes('start'), `${윈명령} ${JSON.stringify(윈인자)}`);
  check('★ 윈도: 주소를 따옴표로 싸서 & 가 명령 구분자로 안 먹힌다', 윈인자.at(-1) === `"${url}"`, JSON.stringify(윈인자.at(-1)));
  check('★ 윈도: 그 따옴표를 Node 가 다시 안 싼다', 윈설정?.windowsVerbatimArguments === true, JSON.stringify(윈설정));
  check('★ 따옴표가 든 주소는 안 넘긴다', 여는명령('https://x/"&calc', 'win32') === null, JSON.stringify(여는명령('https://x/"&calc', 'win32')));
  /*
   * cmd 는 따옴표 안에서도 `%이름%` 을 펼친다. 주소에 있는 이름이면 주소가 바뀐 채 열린다 —
   * `%cd%` 처럼 환경에 없는 cmd 동적 변수도 펼친다(2.1.4 Gemini 리뷰). 그럴 때는 안 넘긴다.
   * 퍼센트 인코딩 사이(`%3A%2F`)는 그런 이름이 없으니 그대로 넘긴다.
   */
  check('★ cmd 가 펼칠 %이름% 이 든 주소는 안 넘긴다 (환경변수)', 여는명령('https://x/?q=%FOO%', 'win32', { Foo: '1' }) === null);
  check('★ cmd 동적 변수도 (%cd% · %RANDOM%)', 여는명령('https://x/?q=%cd%', 'win32', {}) === null && 여는명령('https://x/?%random%', 'win32', {}) === null);
  check('퍼센트 인코딩 사이는 그대로 넘긴다', 여는명령(url, 'win32', { PATH: 'x', TEMP: 'y' }) !== null);
  check('맥은 open', JSON.stringify(여는명령(url, 'darwin').slice(0, 2)) === JSON.stringify(['open', [url]]));
  check('리눅스는 xdg-open', JSON.stringify(여는명령(url, 'linux').slice(0, 2)) === JSON.stringify(['xdg-open', [url]]));
}

trace('4b-두-귀');

{
  /*
   * 콜백 주소는 `localhost` 라 브라우저가 127.0.0.1 로도 ::1 로도 풀 수 있다. 한쪽에만 들으면
   * 다른 쪽으로 푼 브라우저는 거절당하고, **같은 포트의 ::1 을 남이 쥐고 있으면** 코드가 그 남에게
   * 간다(PKCE 라 열쇠는 못 받지만 로그인은 5분을 기다리다 끝난다). 둘 다 쥘 수 있는 포트를 고른다
   * (2.1.4 Gemini 검토).
   */
  const 남 = createServer((_, res) => res.end('남'));
  const 여섯있나 = await new Promise((풀기) => { 남.once('error', () => 풀기(false)); 남.listen(0, '::1', () => 풀기(true)); });
  if (여섯있나) {
    const 남포트 = 남.address().port;
    const 귀 = await 콜백귀열기(() => {}, { 첫포트: 남포트 });
    check('★ ::1 의 그 포트를 남이 쥐고 있으면 다른 포트를 고른다', 귀.포트 !== 남포트, `${귀.포트} vs ${남포트}`);
    check('★ 고른 포트는 ::1 에도 듣는다', 귀.귀들 === 2, String(귀.귀들));
    await 귀.닫기();
    check('닫으면 둘 다 닫힌다', await 닫혔나(귀.포트), String(귀.포트));
  } else {
    check('(이 기계는 IPv6 가 없다 — 127.0.0.1 하나로 듣는다)', true);
    const 귀 = await 콜백귀열기(() => {});
    check('IPv6 가 없으면 127.0.0.1 하나로 연다', 귀.귀들 === 1 && 귀.포트 > 0, String(귀.귀들));
    await 귀.닫기();
  }
  남.close();
}

trace('5-가짜-OpenRouter');

// ── 가짜 OpenRouter 교환 창구 ─────────────────────────────────────────────
//
// 받은 검증자를 sha256 해서, 1단계 주소에 실렸던 도전과 맞는지 **진짜로** 본다.
// 맞을 때만 열쇠를 준다. 그래야 「검증자를 엉뚱한 것으로 보냈다」 가 초록불로 안 숨는다.
let 도전들 = new Map();         // code → 그 코드를 낼 때 받은 도전
let 교환답 = null;              // 이 판에 줄 답을 갈아 끼운다 (없으면 정상)
const 받은교환 = [];
const 교환 = createServer((req, res) => {
  let 몸 = '';
  req.on('data', (c) => (몸 += c));
  req.on('end', () => {
    const 보냄 = (code, o, 꼴 = 'application/json') => {
      res.writeHead(code, { 'content-type': 꼴 });
      res.end(typeof o === 'string' ? o : JSON.stringify(o));
    };
    if (req.method !== 'POST' || req.url !== '/api/v1/auth/keys') return 보냄(405, { error: { message: 'Method Not Allowed' } });
    let j = null;
    try { j = JSON.parse(몸); } catch { /* 아래에서 거절 */ }
    받은교환.push(j);
    if (교환답) return 교환답(보냄, j);
    if (j?.code_challenge_method !== 'S256') return 보냄(400, { error: { message: 'Invalid code_challenge_method' } });
    const 도전 = 도전들.get(j?.code);
    const 셈 = createHash('sha256').update(String(j?.code_verifier ?? '')).digest('base64url');
    if (!도전 || 도전 !== 셈) return 보냄(403, { error: { message: 'Invalid code or code_verifier' } });
    보냄(200, { key: `sk-or-v1-받은열쇠-${j.code}` });
  });
});
await new Promise((r) => 교환.listen(0, '127.0.0.1', r));
const 교환포트 = 교환.address().port;

const 가짜곳 = {
  ...제공자고르기('openrouter'),
  링크로그인: {
    여는곳: `http://127.0.0.1:${교환포트}/auth`,
    바꾸는곳: `http://127.0.0.1:${교환포트}/api/v1/auth/keys`,
    열쇠이름: 'deel',
  },
};

// 브라우저 흉내. 주소를 받아 로그인이 끝난 척 콜백을 부른다.
function 콜백부르기(주소, 덧붙임 = '') {
  return new Promise((풀기) => {
    const u = new URL(주소);
    const q = request({ hostname: u.hostname, port: u.port, path: u.pathname + encodeURI(덧붙임), method: 'GET', autoSelectFamily: true }, (res) => {
      let 몸 = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (몸 += c));
      res.on('end', () => 풀기({ status: res.statusCode, 몸, 머리: res.headers }));
    });
    q.on('error', (e) => 풀기({ status: 0, 몸: String(e?.code ?? e) }));
    q.end();
  });
}

{
  // ── 이 자리 흐름: 링크 → 브라우저 → 콜백 → 교환 ──────────────────────
  const 줄들 = [];
  let 연주소 = null;
  let 콜백답 = null;
  let 콜백주소 = null;
  const r = await 링크로그인(가짜곳, {
    원격: false,
    말: (s) => 줄들.push(String(s)),
    열기: (주소) => {
      연주소 = new URL(주소);
      콜백주소 = 연주소.searchParams.get('callback_url');
      도전들.set('code-1', 연주소.searchParams.get('code_challenge'));
      // 브라우저는 따로 돈다 — 여는 쪽을 붙잡지 않는다.
      setTimeout(async () => { 콜백답 = await 콜백부르기(콜백주소, `?code=code-1`); }, 20);
      return true;
    },
  });
  const 화면 = 줄들.join('\n');
  check('★ 로그인하면 열쇠를 받는다', r.ok === true && r.열쇠 === 'sk-or-v1-받은열쇠-code-1', JSON.stringify(r));
  check('1단계 주소가 여는곳이다', 연주소 && `${연주소.origin}${연주소.pathname}` === 가짜곳.링크로그인.여는곳, String(연주소));
  check('도전 방식은 S256', 연주소?.searchParams.get('code_challenge_method') === 'S256');
  check('열쇠 이름을 채워 준다', 연주소?.searchParams.get('key_label') === 'deel');
  const cb = 콜백주소 ? new URL(콜백주소) : null;
  check('★ 콜백은 localhost 의 판마다 다른 길', cb?.hostname === 'localhost' && /^\/deel-[0-9a-f]{32}$/.test(cb?.pathname ?? ''), 콜백주소);
  check('브라우저에 끝났다는 쪽을 준다', 콜백답?.status === 200 && /터미널/.test(콜백답?.몸 ?? ''), JSON.stringify(콜백답?.status));
  check('★ 그 쪽에 코드를 안 싣는다', !String(콜백답?.몸).includes('code-1'));
  check('그 쪽은 저장·전달하지 않는다', /no-store/.test(콜백답?.머리?.['cache-control'] ?? '') && /no-referrer/.test(콜백답?.머리?.['referrer-policy'] ?? ''),
    JSON.stringify([콜백답?.머리?.['cache-control'], 콜백답?.머리?.['referrer-policy']]));
  check('★ 안 열려도 되게 링크를 화면에 찍는다', 화면.includes('callback_url='), 화면.slice(0, 80).replace(/\s+/g, ' '));
  check('★ 열쇠를 화면에 안 찍는다', !화면.includes('받은열쇠'));
  check('★ 끝나면 콜백 문을 닫는다', await 닫혔나(Number(cb?.port)), cb?.port);
  check('★ 교환하러 잠깐 연 문도 닫는다', !allowed().some((o) => o.includes(String(교환포트))), JSON.stringify(allowed()));
}

{
  // 다른 길로 오면 404 이고 기다림은 이어진다. 맞는 길이 와야 끝난다.
  let 엉뚱답 = null;
  const r = await 링크로그인(가짜곳, {
    원격: false, 말: () => {},
    열기: (주소) => {
      const u = new URL(주소);
      const 콜백 = u.searchParams.get('callback_url');
      도전들.set('code-2', u.searchParams.get('code_challenge'));
      setTimeout(async () => {
        const 딴길 = new URL(콜백);
        딴길.pathname = '/deel-00000000000000000000000000000000';
        엉뚱답 = await 콜백부르기(딴길.href, '?code=code-2');
        await 콜백부르기(콜백, '?code=code-2');
      }, 20);
      return true;
    },
  });
  check('★ 모르는 길로 온 코드는 404', 엉뚱답?.status === 404, String(엉뚱답?.status));
  check('맞는 길이 오면 그대로 끝난다', r.ok === true, JSON.stringify(r));
}

{
  // 남의 코드 — 그 코드를 낸 도전은 우리 것이 아니다. PKCE 가 막아야 한다.
  const r = await 링크로그인(가짜곳, {
    원격: false, 말: () => {},
    열기: (주소) => {
      const 콜백 = new URL(주소).searchParams.get('callback_url');
      도전들.set('남의코드', createHash('sha256').update('남의검증자').digest('base64url'));
      setTimeout(() => 콜백부르기(콜백, '?code=남의코드'), 20);
      return true;
    },
  });
  check('★ 남이 끼워 넣은 코드로는 열쇠를 못 받는다', r.ok === false && !r.열쇠, JSON.stringify(r));
  check('못 받은 까닭에 서버 말을 싣는다', /Invalid code or code_verifier/.test(r.까닭 ?? ''), r.까닭);
  check('403 이라고도 적는다', /403/.test(r.까닭 ?? ''), r.까닭);
}

{
  // 로그인 창에서 거절하고 돌아오면 코드가 없다. 5분을 다 기다리지 않는다.
  const t0 = Date.now();
  const r = await 링크로그인(가짜곳, {
    원격: false, 말: () => {}, 기다림: 20000,
    열기: (주소) => {
      const 콜백 = new URL(주소).searchParams.get('callback_url');
      setTimeout(() => 콜백부르기(콜백, '?error=access_denied'), 20);
      return true;
    },
  });
  check('★ 코드 없이 돌아오면 바로 끝낸다', r.ok === false && Date.now() - t0 < 10000, `${Date.now() - t0}ms`);
  check('돌아온 까닭을 적는다', /access_denied/.test(r.까닭 ?? ''), r.까닭);
}

{
  // 창을 닫고 떠난 사람. 기다림에 끝이 있어야 하고, 끝나면 문을 닫는다.
  let 콜백포트 = null;
  const r = await 링크로그인(가짜곳, {
    원격: false, 말: () => {}, 기다림: 300,
    열기: (주소) => { 콜백포트 = Number(new URL(new URL(주소).searchParams.get('callback_url')).port); return false; },
  });
  check('★ 기다림이 끝나면 실패로 끝낸다', r.ok === false && /시간이 지났/.test(r.까닭 ?? ''), JSON.stringify(r));
  check('★ 시간이 지나도 콜백 문을 닫는다', 콜백포트 && await 닫혔나(콜백포트), String(콜백포트));
}

{
  // 교환 창구가 이상한 답을 준 판들.
  const 판 = async (답) => {
    교환답 = 답;
    try {
      return await 링크로그인(가짜곳, {
        원격: true, 말: () => {}, 받기: async () => 'code-x',
      });
    } finally { 교환답 = null; }
  };
  const 웹쪽 = await 판((보냄) => 보냄(200, '<html>login</html>', 'text/html'));
  check('★ 200 인데 JSON 이 아니면 열쇠로 안 친다', 웹쪽.ok === false && !웹쪽.열쇠, JSON.stringify(웹쪽));
  const 빈열쇠 = await 판((보냄) => 보냄(200, { key: '' }));
  check('★ 빈 열쇠는 열쇠가 아니다', 빈열쇠.ok === false, JSON.stringify(빈열쇠));
  const 빈칸열쇠 = await 판((보냄) => 보냄(200, { key: 'sk-or v1' }));
  check('빈칸 든 열쇠도 아니다', 빈칸열쇠.ok === false, JSON.stringify(빈칸열쇠));
  const 만료 = await 판((보냄) => 보냄(403, { error: { message: 'Authorization code expired' } }));
  check('만료된 코드는 서버 말을 싣는다', 만료.ok === false && /expired/.test(만료.까닭 ?? ''), 만료.까닭);
}

{
  // 교환 창구가 죽어 있다. 던지지 않고 까닭을 준다.
  const 죽은곳 = { ...가짜곳, 링크로그인: { ...가짜곳.링크로그인, 바꾸는곳: 'http://127.0.0.1:1/api/v1/auth/keys' } };
  let r;
  try { r = await 링크로그인(죽은곳, { 원격: true, 말: () => {}, 받기: async () => 'code-y' }); }
  catch (e) { r = { 던짐: String(e?.message ?? e) }; }
  check('★ 교환 창구가 안 닿아도 던지지 않는다', r.ok === false && typeof r.까닭 === 'string', JSON.stringify(r));
}

trace('6-원격-붙여넣기');

{
  const 줄들 = [];
  let 물은말 = null;
  let 연것 = false;
  let 링크 = null;
  const r = await 링크로그인(가짜곳, {
    원격: true,
    말: (s) => {
      줄들.push(String(s));
      const 걸림 = /(http:\/\/127\.0\.0\.1:\d+\/auth\?\S+)/.exec(String(s));
      if (걸림) {
        링크 = new URL(걸림[1]);
        도전들.set('붙인코드', 링크.searchParams.get('code_challenge'));
      }
    },
    열기: () => { 연것 = true; return true; },
    받기: async (말) => { 물은말 = 말; return '  http://localhost:9/whatever?code=붙인코드&state=1  '; },
  });
  check('★ 원격이면 여기서 브라우저를 안 연다', !연것);
  check('★ 원격 링크에는 콜백이 없다 — 로그인 쪽이 코드를 화면에 띄운다', 링크 && !링크.searchParams.has('callback_url'), String(링크));
  check('원격 링크도 S256 · 열쇠 이름', 링크?.searchParams.get('code_challenge_method') === 'S256' && 링크?.searchParams.get('key_label') === 'deel');
  check('코드를 붙여 넣으라고 묻는다', /코드/.test(물은말 ?? ''), 물은말);
  check('★ 주소를 통째 붙여 넣어도 코드를 꺼내 바꾼다', r.ok === true && r.열쇠 === 'sk-or-v1-받은열쇠-붙인코드', JSON.stringify(r));

  const 빈답 = await 링크로그인(가짜곳, { 원격: true, 말: () => {}, 받기: async () => '   ' });
  check('빈 답이면 교환하러 안 간다', 빈답.ok === false && /비었/.test(빈답.까닭 ?? ''), JSON.stringify(빈답));
}

trace('7-봉인');

{
  const 받기전 = 받은교환.length;
  let 연것 = false;
  const 진짜곳 = 제공자고르기('openrouter');
  const r = await 링크로그인(진짜곳, {
    // 새면 콜백 문을 열고 기다린다 — 5분을 서 있지 말고 곧 끝나게 한다.
    봉인: true, 원격: false, 말: () => {}, 기다림: 500,
    열기: () => { 연것 = true; return true; },
    받기: async () => { 연것 = true; return 'x'; },
  });
  check('★ 봉인이면 로그인하러 안 나간다', r.ok === false && /봉인/.test(r.까닭 ?? ''), JSON.stringify(r));
  check('★ 봉인이면 브라우저도 안 열고 묻지도 않는다', !연것);
  check('봉인이면 교환도 없다', 받은교환.length === 받기전);

  // 사내망 창구는 봉인에서도 그대로 간다 — 봉인이 막는 것은 「이 컴퓨터 밖」 이다.
  const 안쪽 = await 링크로그인(가짜곳, {
    봉인: true, 원격: true, 말: () => {},
    받기: async () => { 도전들.set('봉인안', [...도전들.values()].at(-1)); return 'code-없음'; },
  });
  check('사내 창구는 봉인에서도 교환하러 간다', 받은교환.length > 받기전 && 안쪽.ok === false, JSON.stringify(안쪽));
}

trace('8-제공자-자리');

{
  const p = 제공자고르기('openrouter');
  check('★ OpenRouter 가 목록에 있다', !!p);
  check('★ 로그인 창구는 openrouter.ai 의 https', p?.링크로그인?.여는곳 === 'https://openrouter.ai/auth'
    && p?.링크로그인?.바꾸는곳 === 'https://openrouter.ai/api/v1/auth/keys', JSON.stringify(p?.링크로그인));
  check('모델 창구는 OpenAI 규격', p?.규격 === 'openai' && p?.인증 === 'bearer' && p?.주소들()[0] === 'https://openrouter.ai/api/v1');
}

trace('9-치움');
교환.close();
resetNet();

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n브라우저로 로그인 검사  ${D}(받은 열쇠는 우리만 바꿀 수 있고, 봉인이면 아무 데도 안 간다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
// 빨간 판에서는 안 닫힌 문(콜백 서버 따위)이 프로세스를 붙잡아 돌리개의 시한까지 선다. 결과는 위에 다 적었다.
if (fail.length) setTimeout(() => process.exit(1), 2000).unref();
