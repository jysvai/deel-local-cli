// 게이트웨이가 우리 인증서를 요구할 때 (mTLS).
//
// ── 왜 진짜 TLS 서버를 세우나 ───────────────────────────────────────────
//
// 이 기능은 「옵션이 요청 객체에 실렸는가」 가 아니라 **악수가 되는가** 다.
// 옵션을 실었는지만 보면, 이름을 하나 잘못 쓴 채로 초록불이 뜬다 — 그리고 그
// 사실은 인증서를 요구하는 진짜 게이트웨이 앞에서야 드러난다. 그 자리는 사내망
// 안이라 우리가 못 가 본다.
//
// 그래서 여기서는 진짜로 TLS 서버를 세우고 `requestCert: true` 를 준다. 붙는
// 쪽이 인증서를 안 내면 서버가 거절하고, 내면 서버가 그 주체 이름을 답으로
// 돌려준다 — 그 이름이 우리가 낸 것과 같아야 통과다.
//
// 인증서는 검사가 돌 때 그 자리에서 만든다. 파일로 넣어 두면 언젠가 만료돼서
// 어느 날 아침 아무 이유 없이 빨개진다.
import { createServer } from 'node:https';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 인증서설정, 인증서등록, 인증서찾기, 인증서잊기, 인증서말 } from '../src/backend/clientcert.js';
import { 원시요청 } from '../src/backend/http.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 건너뜀 = [];

const 집 = mkdtempSync(join(tmpdir(), 'deel-cert-'));

// ── 1. 설정 읽기 ───────────────────────────────────────────────────────
trace('1-설정');
{
  check('안 적었으면 없다', 인증서설정({ baseUrl: 'https://x' }) === null);
  check('빈 껍데기는 없는 것으로 친다', 인증서설정({ 인증서: {} }) === null,
    JSON.stringify(인증서설정({ 인증서: {} })));
  // 사내 루트만 적는 자리도 있다 — 우리 인증서는 안 내고 서버 것만 믿는 경우.
  check('사내 루트만 적어도 받는다', 인증서설정({ 인증서: { ca: 'corp.pem' } })?.ca === 'corp.pem');

  const 한글 = 인증서설정({ 인증서: { cert: 'a.pem', key: 'b.key', ca: 'c.pem' } });
  check('한글 이름으로 적은 것을 읽는다', 한글?.cert === 'a.pem' && 한글?.key === 'b.key' && 한글?.ca === 'c.pem');

  const 영문 = 인증서설정({ clientCert: { certFile: 'a.pem', keyFile: 'b.key' } });
  check('영문 이름으로 적은 것도 읽는다', 영문?.cert === 'a.pem' && 영문?.key === 'b.key');

  const pfx = 인증서설정({ 인증서: { pfx: 'x.pfx' } });
  check('pfx 한 덩이만 적어도 읽는다', pfx?.pfx === 'x.pfx');

  /*
   * 화면에 낼 말에 **암호가 들어가면 안 된다.**
   *
   * 이 줄은 `/status` 에 뜨고, 사람들은 그 화면을 그대로 캡처해서 붙인다.
   * 암호가 거기 있으면 그 한 장으로 인증서가 통째로 새는 것과 같다.
   */
  const 말 = 인증서말({ cert: 'a.pem', key: 'b.key', passphrase: '진짜암호' });
  check('★★ 화면 말에 암호가 안 들어간다', !/진짜암호/.test(말), 말);
  check('★ 무엇으로 붙는지는 보여 준다', /a\.pem/.test(말), 말);
}

// ── 2. 파일을 못 읽으면 그 자리에서 말한다 ─────────────────────────────
trace('2-못읽음');
{
  /*
   * 조용히 빼고 붙으면 서버가 주는 것은 TLS 악수 실패 한 줄인데, 그 화면은
   * 「인증서가 없다」 와 「인증서가 틀렸다」 를 구별해 주지 않는다. 경로 오타
   * 하나에 사람은 방화벽부터 뒤지게 된다.
   */
  인증서잊기();
  인증서등록('https://없는곳.example', { cert: join(집, '없는파일.pem'), key: join(집, '없는열쇠.key') });
  let 탈 = null;
  try { 인증서찾기('https://없는곳.example/v1/chat'); } catch (e) { 탈 = e; }
  check('★★ 인증서 파일이 없으면 던진다 — 조용히 빼고 붙지 않는다', 탈 !== null, String(탈?.message ?? '(안 던짐)'));
  check('★ 어느 파일인지 말한다', /없는파일\.pem/.test(String(탈?.message ?? '')), String(탈?.message ?? ''));
  인증서잊기();
}

// ── 3. 등록한 주소에만 붙는다 ──────────────────────────────────────────
trace('3-주소별');
{
  인증서잊기();
  인증서등록('https://우리.example/v1', { cert: 'x', key: 'y' });
  // 파일을 안 만들었으므로 찾으면 던진다 — 여기서 재는 것은 '찾는가' 이므로
  // 던지는 것 자체가 곧 '이 주소에는 붙는다' 는 뜻이다.
  let 우리것 = false;
  try { 인증서찾기('https://우리.example/v1/chat/completions'); } catch { 우리것 = true; }
  check('★ 같은 집이면 경로가 달라도 붙는다', 우리것);
  check('★★ 다른 집에는 안 붙는다', 인증서찾기('https://남의집.example/v1') === null);
  check('★★ 포트가 다르면 다른 집이다', 인증서찾기('https://우리.example:8443/v1') === null);
  인증서잊기();
}

// ── 4. 진짜 악수 ───────────────────────────────────────────────────────
trace('4-진짜-악수');
{
  /*
   * 자체 서명 인증서 두 장을 그 자리에서 만든다 — 서버 것과 우리 것.
   *
   * Node 에는 인증서를 만드는 API 가 없다(키만 만든다). 그래서 시스템에 있는
   * openssl 을 빌린다. 없으면 이 대목은 **못 쟀다고 적고 넘어간다** — 초록으로
   * 세지 않는다. 못 잰 것을 통과로 세면 검사가 거짓말을 하게 된다.
   */
  const { execFileSync } = await import('node:child_process');
  let openssl = true;
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { openssl = false; }

  if (!openssl) {
    건너뜀.push('이 기계에 openssl 이 없어 진짜 악수는 못 쟀다');
  } else {
    const 만들기 = (이름, 주체) => {
      const 키 = join(집, `${이름}.key`);
      const 인증 = join(집, `${이름}.pem`);
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', 키, '-out', 인증, '-days', '2',
        '-subj', `/CN=${주체}`,
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ], { stdio: 'ignore' });
      return { 키, 인증 };
    };
    const 서버것 = 만들기('server', 'localhost');
    // CN 은 아스키로 둔다. openssl 이 이 값을 콘솔 코드페이지로 적어서,
    // 한글을 넣으면 되돌아온 이름이 깨진다 — 우리 쪽 일이 아니다.
    const 나 = 만들기('client', 'deel-test-client');

    const { readFileSync } = await import('node:fs');
    const srv = createServer({
      key: readFileSync(서버것.키),
      cert: readFileSync(서버것.인증),
      // 우리 인증서를 **요구한다.** 이것이 이 검사의 전부다.
      requestCert: true,
      // 자체 서명이라 사슬을 못 탄다. 거절은 안 하고, 받은 것을 그대로 되돌려
      // 준다 — 재려는 것은 '냈는가' 이지 '사내 CA 가 서명했는가' 가 아니다.
      rejectUnauthorized: false,
    }, (req, res) => {
      req.resume();
      const 낸것 = req.socket.getPeerCertificate?.();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 주체: 낸것?.subject?.CN ?? null }));
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `https://127.0.0.1:${srv.address().port}`;

    resetNet();
    allowEndpoint(base);
    // 자체 서명 서버라 그대로는 못 믿는다. 서버 인증서를 사내 루트처럼 얹어
    // 준다 — 사내 CA 를 쓰는 자리와 같은 길이다.
    인증서잊기();
    인증서등록(base, { cert: 나.인증, key: 나.키, ca: 서버것.인증 });

    const r = await 원시요청(`${base}/v1/x`, { timeout: 10000 });
    let 답 = null;
    try { 답 = JSON.parse(r.text); } catch { /* 아래에서 잡힌다 */ }
    check('★★ 우리 인증서를 실제로 내고 붙는다', 답?.주체 === 'deel-test-client',
      `status=${r.status} 주체=${답?.주체 ?? '(못 냄)'}`);

    /*
     * 등록을 지우면 인증서를 안 낸다.
     *
     * 여기가 초록이어야 위 검사가 뜻이 있다 — 서버가 아무에게나 주체 이름을
     * 주는 것이라면 위 검사는 아무것도 안 재는 것이다.
     */
    인증서잊기();
    // 사내 루트만 등록한다 — 우리 인증서는 안 낸다.
    인증서등록(base, { ca: 서버것.인증 });
    const r2 = await 원시요청(`${base}/v1/x`, { timeout: 10000 });
    let 답2 = null;
    try { 답2 = JSON.parse(r2.text); } catch { /* 그만 */ }
    check('★★ 안 적었으면 안 낸다 — 위 검사가 재는 것이 있다는 뜻이다',
      r2.status === 200 && !답2?.주체, `status=${r2.status} 주체=${답2?.주체 ?? '(안 냄)'}`);
    check('★ 사내 루트만 적어도 그 서버는 믿는다', r2.status === 200, `status=${r2.status}`);

    인증서잊기();
    srv.close();
    srv.closeAllConnections?.();
  }
}

rmSync(집, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const Y = '\x1b[33m'; const X = '\x1b[0m';
console.log(`\n우리 인증서로 붙기  ${D}(mTLS — 열쇠 하나로 안 열리는 게이트웨이)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
for (const 글 of 건너뜀) console.log(`  ${Y}⚠${X} ${글}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패`
  + (건너뜀.length ? ` · ${Y}${건너뜀.length}개 건너뜀${X}` : '') + '\n');
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
