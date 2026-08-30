// 프록시 뒤에서도 게이트웨이에 닿는가 — 그리고 프록시를 거쳐도 자물쇠는 그대로인가.
//
// ── 왜 이걸 재나 ────────────────────────────────────────────────────────
//
// README 는 "프록시 뒤면 HTTPS_PROXY" 라고 적어 놨는데, Node 의 fetch 는 그 변수를
// 안 본다. 직접 재 보니 프록시는 요청을 한 건도 못 봤다. 바깥으로 직접 못 나가는
// 사내망에서는 "연결 실패" 한 줄로 끝났다. 적힌 탈출구가 막혀 있는 것이 제일 나쁘다.
//
// 여기서 재는 것:
//   1) 어느 프록시로 갈지 고르는 규칙 (환경변수·설정·NO_PROXY·루프백)
//   2) http 대상: 프록시가 절대 주소 요청을 **실제로** 받는다. 흘려 받기도 통한다
//   3) https 대상: 프록시가 CONNECT 를 받고, 그 터널 안에서 TLS 가 선다
//      (자식 프로세스에서 — NODE_EXTRA_CA_CERTS 는 뜰 때 읽는 값이다)
//   4) 프록시를 거쳐도 허용 목록에 없는 대상은 프록시에조차 안 닿는다
//   5) 되돌림(redirect)은 한 번 더 자물쇠를 지난다 — 직접 갈 때도, 프록시로 갈 때도
//   6) 프록시가 없거나(꺼짐) 인증을 요구하면 그렇다고 말한다
//   7) 터널을 여는 중에 Ctrl+C 를 누르면 바로 멈춘다
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect as netConnect } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { req, Aborted } from '../src/backend/http.js';
import { allowEndpoint, resetNet, NetBlocked, contacted, 프록시경유 } from '../src/safety/network.js';
import {
  프록시정하기, 프록시고르기, 프록시지우기, 우회할까, 프록시읽기, 프록시설정,
} from '../src/backend/proxy.js';
import { 증명서만들기 } from './mkcert.mjs';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const here = fileURLToPath(import.meta.url);

// ═══════════════════════════════════════════════════════════════════════
// 1. 고르는 규칙 — 순수 함수
// ═══════════════════════════════════════════════════════════════════════
trace('1-고르기');
{
  check('주소를 읽는다', 프록시읽기('http://proxy.corp:8080')?.host === 'proxy.corp' && 프록시읽기('http://proxy.corp:8080')?.port === 8080);
  check('scheme 이 없으면 http 로 본다', 프록시읽기('proxy.corp:3128')?.url === 'http://proxy.corp:3128');
  check('user:pass 는 Basic 으로', 프록시읽기('http://u:p%40w@h:1')?.auth === `Basic ${Buffer.from('u:p@w').toString('base64')}`);
  check('socks5 는 안 된다고 말한다', /지원하지 않습니다/.test(프록시읽기('socks5://h:1')?.탈 ?? ''));
  check('https:// 프록시도 안 된다고 말한다', /지원하지 않습니다/.test(프록시읽기('https://h:1')?.탈 ?? ''));

  check('NO_PROXY * 는 전부', 우회할까('a.b', 443, ['*']));
  check('.corp.com 은 뒤가 맞으면', 우회할까('wiki.corp.com', 443, ['.corp.com']) && !우회할까('corp.com.evil', 443, ['.corp.com']));
  check('corp.com 도 뒤가 맞으면', 우회할까('wiki.corp.com', 443, ['corp.com']) && 우회할까('corp.com', 443, ['corp.com']));
  check('host:port 는 포트까지', 우회할까('intra', 8443, ['intra:8443']) && !우회할까('intra', 443, ['intra:8443']));
  check('IPv4 그대로', 우회할까('10.1.2.3', 80, ['10.1.2.3']) && !우회할까('10.1.2.30', 80, ['10.1.2.3']));
  check('*.internal 꼴도', 우회할까('a.internal', 443, ['*.internal']));

  const env = { HTTPS_PROXY: 'http://10.0.0.1:8080', http_proxy: 'http://10.0.0.2:3128', NO_PROXY: '.corp.com' };
  프록시정하기({ env });
  check('https 대상은 HTTPS_PROXY', 프록시고르기('https://ai-gw.example.net/v1')?.url === 'http://10.0.0.1:8080');
  check('http 대상은 http_proxy (소문자도 본다)', 프록시고르기('http://ai-gw.example.net/v1')?.url === 'http://10.0.0.2:3128');
  check('출처를 적는다', 프록시고르기('https://ai-gw.example.net/v1')?.출처 === 'HTTPS_PROXY');
  check('NO_PROXY 에 걸리면 직접', 프록시고르기('https://wiki.corp.com/x') === null);
  check('루프백은 언제나 직접 — 로컬 Ollama 가 프록시로 나가면 안 된다', 프록시고르기('http://127.0.0.1:11434/v1') === null && 프록시고르기('http://localhost:1234/v1') === null);
  check('설정에 적으면 켜진 것으로 본다', 프록시설정().켜짐 && 프록시설정().프록시들.length === 2);

  프록시정하기({ env: { ALL_PROXY: 'http://10.0.0.9:9' } });
  check('ALL_PROXY 는 둘 다 받는다', 프록시고르기('https://a.example.net/')?.url === 'http://10.0.0.9:9' && 프록시고르기('http://a.example.net/')?.url === 'http://10.0.0.9:9');

  프록시정하기({ env, config: { proxy: 'none' } });
  check("설정 proxy: 'none' 이면 환경변수가 있어도 안 쓴다", 프록시고르기('https://ai-gw.example.net/v1') === null && !프록시설정().켜짐);
  프록시정하기({ env, config: { proxy: 'proxy.corp:8080' } });
  check('설정이 환경변수를 이긴다', 프록시고르기('https://ai-gw.example.net/v1')?.url === 'http://proxy.corp:8080' && 프록시고르기('https://ai-gw.example.net/v1')?.출처 === 'config');
  프록시정하기({ env: { HTTPS_PROXY: 'socks5://1.2.3.4:1080' } });
  check('못 쓰는 프록시는 탈로 남기고 직접 간다', 프록시고르기('https://a.example.net/') === null && /socks5/.test(프록시설정().탈 ?? ''));
  프록시정하기({ env: {} });
  check('아무것도 없으면 꺼짐', !프록시설정().켜짐 && 프록시고르기('https://a.example.net/') === null);
  check('비밀번호는 화면용 설정에 안 나온다', !JSON.stringify(프록시정하기({ env: { HTTPS_PROXY: 'http://u:secret@h:1' } })).includes('secret'));
  프록시지우기();
}

// ═══════════════════════════════════════════════════════════════════════
// 가짜 프록시 둘 (하나는 인증 요구) + http 대상 + https 대상
// ═══════════════════════════════════════════════════════════════════════
const 대상본것 = [];
const 터널포트 = [];   // 프록시가 뚫어 준 터널의 뒷단 포트 — TLS 서버가 본 상대 포트와 맞아야 한다
const target = httpServer((rq, rs) => {
  let body = '';
  rq.on('data', (d) => (body += d));
  rq.on('end', () => {
    대상본것.push({ method: rq.method, url: rq.url, host: rq.headers.host, body });
    if (rq.url === '/v1/stream') {
      rs.writeHead(200, { 'Content-Type': 'text/event-stream' });
      rs.write('data: 1\n\n');
      setTimeout(() => { rs.write('data: 2\n\n'); rs.write('data: [DONE]\n\n'); rs.end(); }, 20);
      return;
    }
    if (rq.url === '/redirect') {
      rs.writeHead(302, { Location: `http://127.0.0.1:${몰래.address().port}/steal` });
      return rs.end();
    }
    if (rq.url === '/redirect-same') {
      rs.writeHead(302, { Location: '/v1/models' });
      return rs.end();
    }
    rs.writeHead(200, { 'Content-Type': 'application/json', 'X-Seen-Body': String(body.length) });
    rs.end(JSON.stringify({ data: [{ id: 'proxied-model' }], echo: body ? JSON.parse(body) : null }));
  });
});
const 몰래본것 = [];
const 몰래 = httpServer((rq, rs) => { 몰래본것.push(rq.url); rs.end('{}'); });

const { key, cert } = 증명서만들기();
const tls = httpsServer({ key, cert }, (rq, rs) => {
  let body = '';
  rq.on('data', (d) => (body += d));
  rq.on('end', () => {
    // 어느 소켓으로 왔는지 남긴다 — 프록시 터널을 거쳐 온 것과 직접 온 것을 가르는 유일한 표시다.
    대상본것.push({ method: rq.method, url: rq.url, tls: true, from: rq.socket.remotePort });
    if (rq.url === '/v1/stream') {
      rs.writeHead(200, { 'Content-Type': 'text/event-stream' });
      rs.write('data: 1\n\n');
      setTimeout(() => { rs.write('data: 2\n\n'); rs.write('data: [DONE]\n\n'); rs.end(); }, 20);
      return;
    }
    rs.writeHead(200, { 'Content-Type': 'application/json' });
    rs.end(JSON.stringify({ data: [{ id: 'tls-model' }] }));
  });
});

function 가짜프록시({ 인증 = false, 먹통 = false } = {}) {
  const 본것 = [];
  const p = httpServer((rq, rs) => {
    본것.push(`${rq.method} ${rq.url}`);
    if (인증 && !rq.headers['proxy-authorization']) {
      rs.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="corp"' });
      return rs.end();
    }
    if (rq.headers['proxy-authorization']) 본것.push(`auth ${rq.headers['proxy-authorization']}`);
    let u;
    try { u = new URL(rq.url); } catch { rs.writeHead(400); return rs.end('절대 주소가 아니다'); }
    const 앞 = httpRequest({
      host: '127.0.0.1', port: u.port, path: u.pathname + u.search, method: rq.method,
      headers: { ...rq.headers, host: u.host },
    }, (r) => { rs.writeHead(r.statusCode, r.headers); r.pipe(rs); });
    앞.on('error', () => { rs.writeHead(502); rs.end('bad gateway'); });
    rq.pipe(앞);
  });
  p.on('connect', (rq, socket, head) => {
    본것.push(`CONNECT ${rq.url}`);
    if (먹통) return;                       // 영영 대답 안 한다 — 끊기 검사용
    if (인증 && !rq.headers['proxy-authorization']) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="corp"\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (rq.headers['proxy-authorization']) 본것.push(`auth ${rq.headers['proxy-authorization']}`);
    const [, port] = rq.url.split(':');
    // 진짜 프록시가 이름을 푸는 자리다. localhost 는 여기서 127.0.0.1 로 간다.
    const 뒤 = netConnect(Number(port), '127.0.0.1', () => {
      터널포트.push(뒤.localPort);
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) 뒤.write(head);
      뒤.pipe(socket);
      socket.pipe(뒤);
    });
    뒤.on('error', () => socket.destroy());
    socket.on('error', () => 뒤.destroy());
  });
  return { p, 본것 };
}
const { p: proxy, 본것: 프록시본것 } = 가짜프록시();
const { p: authProxy, 본것: 인증프록시본것 } = 가짜프록시({ 인증: true });
const { p: 먹통프록시 } = 가짜프록시({ 먹통: true });

for (const s of [target, 몰래, tls, proxy, authProxy, 먹통프록시]) await new Promise((r) => s.listen(0, '127.0.0.1', r));
const 대상포트 = target.address().port;
const 프록시포트 = proxy.address().port;

// ═══════════════════════════════════════════════════════════════════════
// 2. http 대상 — 프록시가 절대 주소 요청을 실제로 받는다
// ═══════════════════════════════════════════════════════════════════════
trace('2-http경유');
{
  프록시정하기({ env: { HTTP_PROXY: `http://127.0.0.1:${프록시포트}` }, 로컬우회: false });
  resetNet();
  allowEndpoint(`http://127.0.0.1:${대상포트}`);
  프록시본것.length = 0; 대상본것.length = 0;

  const r = await req(`http://127.0.0.1:${대상포트}/v1/chat/completions`, { method: 'POST', body: { messages: [{ role: 'user', content: '안녕' }] } });
  check('프록시를 거쳐 닿는다', r.ok && r.json?.data?.[0]?.id === 'proxied-model', JSON.stringify({ ok: r.ok, status: r.status, error: r.error }));
  check('프록시는 절대 주소로 받는다', 프록시본것[0] === `POST http://127.0.0.1:${대상포트}/v1/chat/completions`, 프록시본것.join(' · '));
  check('대상은 본문을 그대로 받는다', 대상본것[0]?.body.includes('안녕') && r.json?.echo?.messages?.[0]?.content === '안녕', JSON.stringify(대상본것[0]));
  check('닿은 기록에 프록시 경유가 적힌다', contacted()[0]?.via === `http://127.0.0.1:${프록시포트}`, JSON.stringify(contacted()));
  check('무엇을 거쳤는지 물으면 답한다', 프록시경유()?.url === `http://127.0.0.1:${프록시포트}`, JSON.stringify(프록시경유()));

  // 흘려 받기
  const s = await req(`http://127.0.0.1:${대상포트}/v1/stream`, { method: 'POST', body: { a: 1 }, stream: true });
  let 글 = '';
  if (s.ok && s.res?.body) {
    const reader = s.res.body.getReader();
    const dec = new TextDecoder();
    while (true) { const { done, value } = await reader.read(); if (done) break; 글 += dec.decode(value, { stream: true }); }
  }
  check('흘려 받기도 프록시를 지난다', /data: 1[\s\S]*data: 2[\s\S]*\[DONE\]/.test(글), 글.slice(0, 80));
  check('흘려 받을 때도 머리말이 있다', s.res?.headers?.get?.('content-type')?.includes('text/event-stream'), String(s.res?.headers?.get?.('content-type')));

  // 허용 안 된 대상은 프록시에조차 안 간다
  프록시본것.length = 0;
  let 막힘 = null;
  try { await req(`http://127.0.0.1:${몰래.address().port}/v1/models`); } catch (e) { 막힘 = e; }
  check('허용 안 된 대상은 던져서 막는다', 막힘 instanceof NetBlocked, 막힘?.name);
  check('그 요청은 프록시에조차 안 닿는다', 프록시본것.length === 0 && 몰래본것.length === 0, 프록시본것.join(' · '));

  // 프록시가 꺼져 있으면 그렇다고 말한다
  const 닫힌포트 = 먹통프록시.address().port;   // 잠깐 빌려 쓴다 — CONNECT 가 아니라 평범한 요청이라 바로 502/끊김이 난다
  프록시정하기({ env: { HTTP_PROXY: `http://127.0.0.1:1` }, 로컬우회: false });
  const 꺼짐 = await req(`http://127.0.0.1:${대상포트}/v1/models`, { timeout: 3000 });
  check('프록시가 꺼져 있으면 프록시 이야기를 한다', !꺼짐.ok && /프록시/.test(꺼짐.error ?? '') && /127\.0\.0\.1:1\b/.test(꺼짐.error ?? ''), JSON.stringify({ status: 꺼짐.status, error: 꺼짐.error }));
  void 닫힌포트;

  // 인증을 요구하면 그렇다고 말한다 (http 대상 쪽)
  프록시정하기({ env: { HTTP_PROXY: `http://127.0.0.1:${authProxy.address().port}` }, 로컬우회: false });
  const 인증 = await req(`http://127.0.0.1:${대상포트}/v1/models`, { timeout: 3000 });
  check('407 이면 인증 이야기를 한다', !인증.ok && 인증.status === 407 && /인증/.test(인증.error ?? ''), JSON.stringify({ status: 인증.status, error: 인증.error }));
  프록시정하기({ env: { HTTP_PROXY: `http://user:pw@127.0.0.1:${authProxy.address().port}` }, 로컬우회: false });
  인증프록시본것.length = 0;
  const 인증됨 = await req(`http://127.0.0.1:${대상포트}/v1/models`, { timeout: 3000 });
  check('user:pw 를 주면 Proxy-Authorization 을 붙여 통한다', 인증됨.ok && 인증프록시본것.some((x) => x.startsWith('auth Basic ')), 인증프록시본것.join(' · '));
}

// ═══════════════════════════════════════════════════════════════════════
// 3. 되돌림은 한 번 더 자물쇠를 지난다 — 직접 갈 때도, 프록시로 갈 때도
// ═══════════════════════════════════════════════════════════════════════
trace('3-되돌림');
for (const 길 of ['직접', '프록시']) {
  if (길 === '직접') 프록시지우기();
  else 프록시정하기({ env: { HTTP_PROXY: `http://127.0.0.1:${프록시포트}` }, 로컬우회: false });
  resetNet();
  allowEndpoint(`http://127.0.0.1:${대상포트}`);
  몰래본것.length = 0;
  let 막힘 = null;
  try { await req(`http://127.0.0.1:${대상포트}/redirect`); } catch (e) { 막힘 = e; }
  check(`[${길}] 허용 안 된 곳으로 되돌리면 막는다`, 막힘 instanceof NetBlocked, 막힘?.name ?? '안 막힘');
  check(`[${길}] 그 곳에는 한 건도 안 닿는다`, 몰래본것.length === 0, 몰래본것.join(' · '));
  const 같은곳 = await req(`http://127.0.0.1:${대상포트}/redirect-same`);
  check(`[${길}] 같은 자리 안의 되돌림은 따라간다`, 같은곳.ok && 같은곳.json?.data?.[0]?.id === 'proxied-model', JSON.stringify({ status: 같은곳.status, error: 같은곳.error }));
}

// ═══════════════════════════════════════════════════════════════════════
// 4. 터널을 여는 중에 끊기
// ═══════════════════════════════════════════════════════════════════════
trace('4-끊기');
{
  프록시정하기({ env: { HTTPS_PROXY: `http://127.0.0.1:${먹통프록시.address().port}` }, 로컬우회: false });
  resetNet();
  allowEndpoint(`https://localhost:${tls.address().port}`);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 60);
  const t0 = Date.now();
  let 끊김 = null;
  try { await req(`https://localhost:${tls.address().port}/v1/models`, { signal: ac.signal, timeout: 10000 }); } catch (e) { 끊김 = e; }
  check('터널을 여는 중에 끊으면 바로 Aborted', 끊김 instanceof Aborted && Date.now() - t0 < 1500, `${끊김?.name} · ${Date.now() - t0}ms`);

  // 프록시가 CONNECT 에 영영 답을 안 하면 시간 제한이 받는다
  const t1 = Date.now();
  const 시간 = await req(`https://localhost:${tls.address().port}/v1/models`, { timeout: 300 });
  check('CONNECT 가 안 오면 시간 제한으로 끝난다', !시간.ok && /시간 초과/.test(시간.error ?? '') && Date.now() - t1 < 3000, JSON.stringify({ error: 시간.error, ms: Date.now() - t1 }));
}

// ═══════════════════════════════════════════════════════════════════════
// 5. https 대상 — CONNECT 터널 (자식 프로세스, 인증서를 믿게 해서)
// ═══════════════════════════════════════════════════════════════════════
trace('5-https터널');
{
  const dir = mkdtempSync(join(tmpdir(), 'deel-proxy-'));
  const pem = join(dir, 'ca.pem');
  writeFileSync(pem, cert);
  프록시본것.length = 0; 인증프록시본것.length = 0; 대상본것.length = 0;
  // 자식은 따로 둔 파일이다(proxy-child.mjs) — NODE_EXTRA_CA_CERTS 는 뜰 때 읽는 값이라서.
  const 아이 = spawn(process.execPath, [join(dirname(here), 'proxy-child.mjs')], {
    env: {
      ...process.env,
      DEEL_PROXY_TEST_PROXY: String(프록시포트),
      DEEL_PROXY_TEST_AUTHPROXY: String(authProxy.address().port),
      DEEL_PROXY_TEST_TARGET: String(tls.address().port),
      NODE_EXTRA_CA_CERTS: pem,
    },
    cwd: dirname(here),
  });
  let out = '';
  let err = '';
  아이.stdout.on('data', (d) => (out += d));
  아이.stderr.on('data', (d) => (err += d));
  const 시계 = setTimeout(() => 아이.kill(), 30000);
  const code = await new Promise((r) => 아이.on('close', r));
  clearTimeout(시계);
  let 결과 = [];
  try { 결과 = JSON.parse(out.trim().split('\n').pop() || '[]'); } catch {}
  check('자식이 곱게 끝난다', code === 0 && 결과.length > 0, `code=${code} · ${err.slice(0, 300)}`);
  for (const r of 결과) check(`[https] ${r.name}`, r.cond, r.note);
  check('프록시가 CONNECT 를 받았다', 프록시본것.some((x) => x === `CONNECT localhost:${tls.address().port}`), 프록시본것.join(' · '));
  check('허용 안 된 https 대상은 CONNECT 조차 안 왔다', !프록시본것.some((x) => x.includes(`:${tls.address().port + 1}`)), 프록시본것.join(' · '));
  check('TLS 서버가 실제 요청을 받았다', 대상본것.some((x) => x.tls && x.url === '/v1/models'), JSON.stringify(대상본것.slice(0, 3)));
  // CONNECT 만 보내 놓고 정작 요청은 직접 나간 적이 있었다(agent: false 가 createConnection 을 무시했다).
  // 대상이 이 컴퓨터라 답은 왔고, 터널 소켓만 열린 채 남아 프로세스가 안 끝났다. 소켓으로 가른다.
  const TLS로온것 = 대상본것.filter((x) => x.tls);
  check('TLS 요청이 전부 터널을 거쳐 왔다 (직접 나간 것이 없다)',
    TLS로온것.length > 0 && TLS로온것.every((x) => 터널포트.includes(x.from)),
    `터널 ${터널포트.join(',')} · 온 곳 ${TLS로온것.map((x) => x.from).join(',')}`);
  check('인증 프록시는 user:pw 를 CONNECT 에서도 받았다', 인증프록시본것.some((x) => x.startsWith('auth Basic ')), 인증프록시본것.join(' · '));
  rmSync(dir, { recursive: true, force: true });
}

// ── 결과 ────────────────────────────────────────────────────────────────
const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n프록시 검사 — 프록시 뒤에서도 닿고, 자물쇠는 그대로인가\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);

프록시지우기();
resetNet();
for (const s of [target, 몰래, tls, proxy, authProxy, 먹통프록시]) { s.closeAllConnections?.(); s.close(); }
await new Promise((r) => setImmediate(r));
process.exitCode = fail.length ? 1 : 0;
