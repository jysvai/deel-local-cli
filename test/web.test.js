// 웹 읽기 도구가 '읽기만' 하는지 검증한다.
//
// 이 도구를 넣는 순간 "코드는 게이트웨이로만 나간다" 가 흔들릴 수 있다.
// 그래서 확인할 것은 세 가지다.
//   1) 나가는 요청에 내 소스·대화가 한 글자도 실리지 않는가 (GET, 본문 없음)
//   2) 사내망·이 컴퓨터 주소를 긁지 않는가
//   3) 다녀온 뒤 자물쇠가 원래대로 닫히는가
import { createServer } from 'node:http';
import { webFetch, 방문기록 } from '../src/tools/webfetch.js';
import { allowEndpoint, allowed, resetNet, setOffline } from '../src/safety/network.js';
import { toolSchemas } from '../src/tools/index.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// 받은 요청을 통째로 기록하는 서버. 본문이 실려 오면 바로 들킨다.
const 받은요청 = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    받은요청.push({ method: req.method, url: req.url, body, headers: req.headers });
    if (req.url === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<html><head><style>p{color:red}</style><script>var x=1</script></head>'
        + '<body><h1>제목</h1><p>본문 첫 줄</p><p>본문 둘째 줄</p></body></html>');
    }
    if (req.url === '/big') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('가'.repeat(60000));
    }
    if (req.url === '/binary') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
    if (req.url === '/404') { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// ── 1. 사내망·로컬은 아예 거절 ──────────────────────────────────────────
resetNet();
for (const u of [
  `http://127.0.0.1:${port}/page`,
  'http://localhost:8080/admin',
  'http://192.168.0.1/router',
  'http://10.0.0.5/internal',
  'http://172.16.3.4/api',
]) {
  const r = await webFetch({ url: u });
  check(`사내망·로컬 거절: ${new URL(u).hostname}`, !!r.error, r.error ? '' : '통과해 버림');
}
check('사내망을 건드리지도 않음', 받은요청.length === 0, `${받은요청.length}건 닿음`);

// ── 2. 형식 검사 ────────────────────────────────────────────────────────
check('주소 아닌 값 거절', !!(await webFetch({ url: '그냥 글자' })).error);
check('file:// 거절', !!(await webFetch({ url: 'file:///etc/passwd' })).error);
check('ftp:// 거절', !!(await webFetch({ url: 'ftp://a.com/x' })).error);

// ── 3. 오프라인이면 아무것도 안 함 ──────────────────────────────────────
setOffline(true);
check('오프라인이면 거절', !!(await webFetch({ url: 'https://example.com' })).error);
const 오프도구 = toolSchemas(null, { hasSkills: false, web: false }).map((t) => t.function.name);
check('오프라인이면 도구 목록에서 아예 뺌', !오프도구.includes('WebFetch'), 오프도구.join(','));
setOffline(false);
const 온도구 = toolSchemas(null, { hasSkills: false, web: true }).map((t) => t.function.name);
check('평소엔 도구 목록에 있음', 온도구.includes('WebFetch'));

// ── 4. 진짜로 읽어 온다 (127.0.0.1 은 막히므로 사설망 판정을 잠깐 우회) ─
// 로컬 서버를 '바깥' 처럼 다룰 수는 없으니, 도구 스키마에 없는 내부 인자로만 연다.
// 모델은 이 인자를 줄 방법이 없다 — 위에서 사내망이 전부 거절된 것이 그 증거다.
const r1 = await webFetch({ url: `http://127.0.0.1:${port}/page` }, { allowPrivate: true });
check('내부 인자로만 로컬 읽기 허용', !r1.error, r1.error ?? '');

if (!r1.error) {
  check('HTML 태그를 벗겨 글만 남김',
    r1.content.includes('본문 첫 줄') && !r1.content.includes('<p>'), '');
  check('script·style 내용은 안 실림',
    !r1.content.includes('var x=1') && !r1.content.includes('color:red'));
  check('어디서 읽었는지 첫 줄에 적음', r1.content.startsWith(`http://127.0.0.1:${port}/page`));

  const 나간것 = 받은요청.at(-1);
  check('GET 으로만 나감', 나간것.method === 'GET', 나간것.method);
  check('본문을 한 글자도 안 실음', 나간것.body === '', `${나간것.body.length}자 실림`);
  check('쿠키·인증 헤더를 안 붙임',
    !나간것.headers.cookie && !나간것.headers.authorization && !나간것.headers['x-api-key']);
  check('보낸 헤더가 최소한',
    Object.keys(나간것.headers).filter((h) => !['host', 'user-agent', 'accept', 'connection', 'accept-encoding', 'accept-language', 'sec-fetch-mode'].includes(h)).length === 0,
    Object.keys(나간것.headers).join(','));
}

const r2 = await webFetch({ url: `http://127.0.0.1:${port}/big`, max_chars: 5000 }, { allowPrivate: true });
check('긴 글은 잘림', !r2.error && r2.summary.includes('잘림'), r2.error ?? r2.summary);
const r3 = await webFetch({ url: `http://127.0.0.1:${port}/binary` }, { allowPrivate: true });
check('이미지 같은 건 거절', !!r3.error, r3.error ?? '읽어 버림');
const r4 = await webFetch({ url: `http://127.0.0.1:${port}/404` }, { allowPrivate: true });
check('404 는 오류로', !!r4.error && r4.error.includes('404'), r4.error ?? '');

// ── 5. 자물쇠를 원래대로 ────────────────────────────────────────────────
resetNet();
allowEndpoint('http://127.0.0.1:9999/v1');
await webFetch({ url: `http://127.0.0.1:${port}/page` }, { allowPrivate: true });
check('웹을 읽어도 모델 자리 하나만 열려 있음',
  allowed().length === 1 && allowed()[0] === 'http://127.0.0.1:9999', allowed().join(', '));
check('다녀온 곳이 기록에 남음', 방문기록.length > 0, `${방문기록.length}건`);

server.closeAllConnections?.();
server.close();
await new Promise((r) => setImmediate(r));

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n웹 읽기 검사  ' + D + '(읽기만 하는가 · 데이터가 안 실려 나가는가)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
