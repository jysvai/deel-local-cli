/*
 * 브라우저로 로그인 — 열쇠를 붙여 넣지 않고 계정으로 받아 온다 (2.1.4).
 *
 * 제공자 데이터에 `링크로그인: { 여는곳, 바꾸는곳, 열쇠이름 }` 이 있으면 이 흐름을 탄다
 * (지금은 openrouter.js 하나). OAuth PKCE 한 바퀴다:
 *
 *   1. 검증자(무작위 32바이트)를 짓고, 그 sha256 을 도전으로 싣은 로그인 주소를 브라우저로 연다.
 *   2. 로그인이 끝나면 로그인 쪽이 코드를 준다 — 이 PC 의 콜백 문으로, 또는 화면에 (원격).
 *   3. 코드 + 검증자를 바꾸는곳에 POST 하면 열쇠가 온다.
 *
 * ── 열쇠는 우리만 받을 수 있다 ─────────────────────────────────────────
 *
 * 코드만으로는 열쇠가 안 나온다 — 검증자가 있어야 한다. 검증자는 브라우저·콜백 길로는 한 번도
 * 안 지나고(그 길로 가는 것은 해시인 도전뿐), 교환 창구에 HTTPS 로 한 번 직접 간다. 다른
 * 프로그램이나 웹 페이지가 콜백에 제 코드를 끼워 넣어도, 그 코드를 낸 도전은 우리 것이 아니라
 * 교환에서 403 이다. 콜백 길도 판마다 새로 지은 16바이트라 밖에서 맞혀 부를 수가 없다.
 *
 * ── 나가는 문 ───────────────────────────────────────────────────────────
 *
 * 우리가 직접 나가는 것은 **교환 POST 한 번**이다. http.js 의 req() — 나가는 문 하나 — 로 가고,
 * 자물쇠는 그 동안만 바꾸는곳 하나를 연다(allowTemporarily). 로그인 화면은 사람의 브라우저가
 * 연다. 봉인(offline)이면 둘 다 안 한다 — 브라우저도 안 열고 묻지도 않는다.
 */
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { req, serverMessage } from './backend/http.js';
import { allowTemporarily } from './safety/network.js';
import { 바깥인가 } from './safety/runmode.js';
import { 브라우저로 } from './ui/browser.js';
import { ask } from './ui/prompt.js';
import { say, c, clip } from './ui/ansi.js';

/** 코드는 10분 뒤 만료된다(OpenRouter). 그 절반을 기다린다. */
export const 기다림기본 = 5 * 60_000;

/** PKCE 한 쌍. 검증자는 RFC 7636 글자(base64url) 43자, 도전은 그 sha256 의 base64url. */
export function PKCE만들기() {
  const 검증자 = randomBytes(32).toString('base64url');
  const 도전 = createHash('sha256').update(검증자).digest('base64url');
  return { 검증자, 도전 };
}

/**
 * 브라우저가 이 PC 에 없을 것 같은가.
 *
 * SSH 로 들어왔거나, 리눅스인데 화면(X · Wayland)이 없으면 그렇다고 본다 — 컨테이너·원격 서버.
 * 그때는 콜백 문을 열어 봐야 브라우저가 못 닿으므로, 로그인 쪽이 코드를 화면에 띄우게 하고
 * 사람이 붙여 넣는다. WSL 은 윈도 브라우저가 localhost 로 닿으므로 이 자리로 친다.
 *
 * 틀려도 갇히지 않는다: 이 자리로 잘못 봤으면 `deel setup --no-browser` 로 붙여넣기 길을 간다.
 * 원격으로 잘못 봤으면 붙여넣기 길이 어디서나 되므로 코드만 옮기면 된다.
 */
export function 원격인가(env = process.env, platform = process.platform) {
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return true;
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY && !env.WSL_DISTRO_NAME) return true;
  return false;
}

/**
 * 사람이 붙여 넣은 것에서 코드를 꺼낸다. 못 꺼내면 null.
 *
 * 코드만 붙여도, 주소창의 주소를 통째로(`…?code=…`) 붙여도 된다. 주소 속 코드는 퍼센트
 * 인코딩돼 있으므로 풀어서 준다 — 안 풀면 `%2B` 가 그대로 가서 403 이다.
 */
export function 코드꺼내기(글) {
  const s = String(글 ?? '').trim();
  if (!s) return null;
  // 조각(#) 뒤에 실려 오는 꼴도 받는다.
  const 걸림 = /(?:^|[?&#\s])code=([^&#\s]+)/.exec(s);
  if (걸림) {
    let 코드;
    try { 코드 = decodeURIComponent(걸림[1]); } catch { return null; }
    return 코드 && !/[\s\x00-\x1f]/.test(코드) ? 코드 : null;
  }
  // 코드 없이 온 주소·문장은 코드가 아니다(로그인 쪽 주소를 잘못 붙였거나, 거절하고 돌아온 주소).
  // `=` 는 받는다 — base64 패딩이 붙은 코드가 있다.
  return /^[^\s/:?&#]+$/.test(s) ? s : null;
}

/*
 * ── 콜백 문: 127.0.0.1 과 ::1 에 같은 포트로 ────────────────────────────
 *
 * 콜백 주소는 `localhost` 다(OpenRouter 가 아무 포트나 받는 이름). 브라우저는 그것을 127.0.0.1
 * 로도 ::1 로도 풀 수 있어서 둘 다에 듣는다. 같은 포트의 ::1 을 **남이 쥐고 있으면** 그 포트는
 * 버리고 새로 고른다 — 안 그러면 ::1 로 푼 브라우저가 코드를 그 남에게 넘기고, 우리는 5분을
 * 기다리다 끝난다(2.1.4 Gemini 검토). IPv6 가 아예 없는 기계는 127.0.0.1 하나로 간다.
 */
function 듣기(서버, 포트, 호스트) {
  return new Promise((풀기, 버리기) => {
    const 탈 = (e) => { 서버.off('listening', 됨); 버리기(e); };
    // 듣기 시작한 뒤의 서버 오류(받기 중 EMFILE 따위)는 삼킨다 — 받이가 없으면 프로세스가 죽는다.
    // 로그인은 기다림이 끝나면 저절로 실패로 끝난다.
    const 됨 = () => { 서버.off('error', 탈); 서버.on('error', () => {}); 풀기(); };
    서버.once('error', 탈);
    서버.once('listening', 됨);
    서버.listen(포트, 호스트);
  });
}
/*
 * 닫는다. 쉬는 연결(브라우저가 미리 열어 둔 것)은 바로 닫고, 아직 답을 보내는 연결은 조금 기다렸다가
 * 끊는다 — 답이 나가기 전에 끊으면 브라우저에는 「로그인됐습니다」 대신 연결 끊김이 뜬다.
 */
function 다닫기(서버들) {
  return Promise.all(서버들.map((s) => new Promise((풀기) => {
    try {
      s.close(() => 풀기());
      s.closeIdleConnections?.();
      setTimeout(() => s.closeAllConnections?.(), 1000).unref();
    } catch { 풀기(); }
  })));
}

/** @returns {Promise<{포트: number, 귀들: number, 닫기: () => Promise<void>}>} */
export async function 콜백귀열기(처리, { 첫포트 = 0, 시도 = 8 } = {}) {
  let 포트 = 첫포트;
  for (let n = 0; n < 시도; n++) {
    const 넷 = createServer(처리);
    try { await 듣기(넷, 포트, '127.0.0.1'); } catch { 포트 = 0; continue; }
    const p = 넷.address().port;
    const 여섯 = createServer(처리);
    let 탈 = null;
    try { await 듣기(여섯, p, '::1'); } catch (e) { 탈 = e; }
    if (!탈) return { 포트: p, 귀들: 2, 닫기: () => 다닫기([넷, 여섯]) };
    if (탈.code === 'EADDRINUSE') { await 다닫기([넷]); 포트 = 0; continue; }
    return { 포트: p, 귀들: 1, 닫기: () => 다닫기([넷]) };
  }
  const 넷 = createServer(처리);
  await 듣기(넷, 0, '127.0.0.1');
  return { 포트: 넷.address().port, 귀들: 1, 닫기: () => 다닫기([넷]) };
}

// 브라우저에 돌려줄 한 쪽. 코드는 안 싣는다. 이 쪽 주소에 코드가 있으므로 남에게 안 넘기고
// (no-referrer) 어디에도 안 남긴다(no-store). 밖의 것을 하나도 안 불러온다.
function 쪽보내기(res, 됐나) {
  const 몸 = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>deel</title>`
    + `<h1>${됐나 ? '로그인됐습니다' : '로그인이 안 됐습니다'}</h1>`
    + `<p>${됐나 ? '터미널로 돌아가세요. 이 창은 닫아도 됩니다.' : '터미널로 돌아가 다시 해 보세요.'}</p></html>`;
  const buf = Buffer.from(몸, 'utf8');
  res.writeHead(됐나 ? 200 : 400, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'",
    connection: 'close',
  });
  res.end(buf);
}

const 이름만 = (제공자) => String(제공자?.이름 ?? '').replace(/\s*\(.*\)\s*$/, '') || '로그인';

/**
 * 로그인해서 열쇠를 받아 온다. 던지지 않는다.
 *
 * @param 제공자  `링크로그인` 칸이 있는 제공자
 * @param o.봉인  offline 이 켜져 있나. 켜져 있고 로그인 창구가 바깥이면 아무것도 안 한다.
 * @param o.원격  브라우저가 이 PC 에 없나 — 그러면 콜백 대신 코드를 붙여 넣게 한다.
 * @param o.열기  주소를 브라우저로 여는 것 (검사가 브라우저 흉내로 갈아 끼운다)
 * @param o.받기  한 줄 묻기 (붙여넣기 길)
 * @returns {Promise<{ok: true, 열쇠: string} | {ok: false, 까닭: string}>}
 */
export async function 링크로그인(제공자, {
  봉인 = false, 원격 = 원격인가(), 열기 = 브라우저로, 받기 = (물음) => ask(물음), 기다림 = 기다림기본, 말 = say,
} = {}) {
  const 곳 = 제공자?.링크로그인;
  if (!곳?.여는곳 || !곳?.바꾸는곳) return { ok: false, 까닭: '이 제공자는 브라우저 로그인을 열지 않습니다.' };
  if (봉인 && (바깥인가(곳.여는곳) || 바깥인가(곳.바꾸는곳))) {
    return { ok: false, 까닭: '봉인되어 있어 로그인하러 나가지 않습니다 — 관리 정책이나 설정에 offline 이 켜져 있습니다.' };
  }

  const { 검증자, 도전 } = PKCE만들기();
  const 로그인주소 = (콜백) => {
    const u = new URL(곳.여는곳);
    if (콜백) u.searchParams.set('callback_url', 콜백);
    u.searchParams.set('code_challenge', 도전);
    u.searchParams.set('code_challenge_method', 'S256');
    if (곳.열쇠이름) u.searchParams.set('key_label', 곳.열쇠이름);
    return u.href;
  };
  const 누구 = 이름만(제공자);

  let 코드;
  if (원격) {
    // 콜백 없이 가면 로그인 쪽이 코드를 화면에 띄운다. 어느 기기의 브라우저로 열어도 된다.
    말('');
    말(`  ${c.gray(`아래 주소를 아무 기기의 브라우저로 여세요. ${누구} 에 로그인하면 코드가 뜹니다.`)}`);
    말(`    ${로그인주소(null)}`);
    말('');
    const 받은것 = await 받기('로그인 뒤 뜬 코드 (주소째 붙여도 됩니다)');
    코드 = 코드꺼내기(받은것);
    if (!코드) {
      return {
        ok: false,
        까닭: String(받은것 ?? '').trim()
          ? '붙여 넣은 것에서 코드를 못 찾았습니다 — 로그인 뒤 화면에 뜬 코드만, 또는 code= 가 든 주소를 넣으세요.'
          : '코드가 비었습니다 — 아무것도 안 바꿨습니다.',
      };
    }
  } else {
    const 비밀길 = `/deel-${randomBytes(16).toString('hex')}`;
    let 알리기 = null;
    const 돌아옴 = new Promise((풀기) => { 알리기 = 풀기; });
    const 처리 = (rq, rs) => {
      let u = null;
      try { u = new URL(rq.url, 'http://localhost'); } catch { /* 아래에서 404 */ }
      if (rq.method !== 'GET' || u?.pathname !== 비밀길) {
        rs.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
        rs.end('not found');
        return;
      }
      const 받은코드 = u.searchParams.get('code');
      // 쪽이 다 나간 뒤에 받는다 — 받자마자 문을 닫으면 쪽이 끊긴다.
      // 처음 온 것 하나만 받는다 — 새로고침·미리 불러오기로 두 번 와도 약속은 한 번만 풀린다.
      rs.once('finish', () => 알리기(받은코드 ? { 코드: 받은코드 } : { 오류: u.searchParams.get('error') || '코드 없이 돌아왔습니다' }));
      쪽보내기(rs, !!받은코드);
    };
    let 귀;
    try { 귀 = await 콜백귀열기(처리); }
    catch (e) { return { ok: false, 까닭: `로그인을 받을 문을 못 열었습니다 — ${e?.message ?? e}. deel setup --no-browser 로 해 보세요.` }; }
    let 타이머 = null;
    try {
      const 주소 = 로그인주소(`http://localhost:${귀.포트}${비밀길}`);
      말('');
      말(`  ${c.gray(`브라우저에서 ${누구} 로그인을 엽니다. 안 열리면 이 주소를 여세요:`)}`);
      말(`    ${주소}`);
      말(`  ${c.gray(`로그인을 기다립니다 (${Math.max(1, Math.round(기다림 / 60000))}분 · 그만두려면 Ctrl+C).`)}`);
      말(`  ${c.gray('브라우저가 다른 기기에 있으면 Ctrl+C 뒤')} ${c.cyan('deel setup --no-browser')}`);
      try { 열기(주소); } catch { /* 주소는 화면에 있다 */ }
      const 결과 = await Promise.race([
        돌아옴,
        new Promise((풀기) => { 타이머 = setTimeout(() => 풀기({ 시간: true }), 기다림); }),
      ]);
      if (결과.시간) {
        return { ok: false, 까닭: '로그인이 안 돌아와 기다리는 시간이 지났습니다 — 아무것도 안 바꿨습니다. 다시 하려면 deel setup' };
      }
      if (!결과.코드) return { ok: false, 까닭: `로그인하고 돌아오지 않았습니다 — ${clip(String(결과.오류), 120)}` };
      코드 = 결과.코드;
    } finally {
      clearTimeout(타이머);
      await 귀.닫기();
    }
  }

  // ── 코드 → 열쇠 ────────────────────────────────────────────────────────
  let r;
  const 닫기 = allowTemporarily(곳.바꾸는곳);
  try {
    r = await req(곳.바꾸는곳, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { code: 코드, code_verifier: 검증자, code_challenge_method: 'S256' },
      timeout: 20000,
    });
  } catch (e) {
    // 자물쇠(NetBlocked)·끊음만 던진다. 통신 실패는 r.ok=false 로 온다.
    return { ok: false, 까닭: `열쇠로 못 바꿨습니다 — ${e?.message ?? e}` };
  } finally {
    닫기();
  }
  if (!r.ok) {
    return { ok: false, 까닭: `열쇠로 못 바꿨습니다 (${r.status ? `HTTP ${r.status}` : '안 닿음'}) — ${clip(serverMessage(r).replace(/\s+/g, ' '), 160)}` };
  }
  const 열쇠 = r.json?.key;
  if (typeof 열쇠 !== 'string' || !열쇠 || /\s/.test(열쇠)) {
    return { ok: false, 까닭: `로그인은 됐는데 열쇠가 안 왔습니다 — ${누구} 쪽 답이 뜻밖의 꼴입니다. 열쇠를 직접 붙여 넣어 주세요.` };
  }
  return { ok: true, 열쇠 };
}
