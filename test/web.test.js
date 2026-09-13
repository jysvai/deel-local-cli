// 웹 읽기 도구가 '읽기만' 하는지 검증한다.
//
// 이 도구를 넣는 순간 "코드는 게이트웨이로만 나간다" 가 흔들릴 수 있다.
// 그래서 확인할 것은 세 가지다.
//   1) 나가는 요청에 내 소스·대화가 한 글자도 실리지 않는가 (GET, 본문 없음)
//   2) 사내망·이 컴퓨터 주소를 긁지 않는가
//   3) 다녀온 뒤 자물쇠가 원래대로 닫히는가
import { createServer } from 'node:http';
import { webFetch, 웹되돌림, 방문기록 } from '../src/tools/webfetch.js';
import { allowEndpoint, allowed, resetNet, setOffline } from '../src/safety/network.js';
import { toolSchemas } from '../src/tools/index.js';
// 이제 상한이 모델 크기에서 나온다. 검사도 그 값을 물어봐서 쓴다 —
// 숫자를 여기 다시 박으면 규칙이 바뀔 때 검사만 조용히 틀린 말을 하게 된다.
import { 웹글자수 } from '../src/agent/budget.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// 받은 요청을 통째로 기록하는 서버. 본문이 실려 오면 바로 들킨다.
// EUC-KR 로 적힌 「한글이 그대로 보입니다」 — Node 는 EUC-KR 로 **쓰지는**
// 못해서 바이트를 그대로 적어 둔다.
// Shift_JIS 로 적힌 「日本語のページです」.
const sjis일본어 = Buffer.from([
  0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x82, 0xcc, 0x83, 0x79, 0x81, 0x5b,
  0x83, 0x57, 0x82, 0xc5, 0x82, 0xb7,
]);

const euckr한글 = Buffer.from([
  0xc7, 0xd1, 0xb1, 0xdb, 0xc0, 0xcc, 0x20, 0xb1, 0xd7, 0xb4, 0xeb, 0xb7, 0xce,
  0x20, 0xba, 0xb8, 0xc0, 0xd4, 0xb4, 0xcf, 0xb4, 0xd9,
]);

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

    // ── 되돌림(redirect) ────────────────────────────────────────────────
    // 남의 서버가 302 한 번으로 우리를 어디로든 보낼 수 있다. 그게 이 자리다.
    if (req.url === '/goto') {
      res.writeHead(302, { Location: `http://127.0.0.1:${port}/page` });
      return res.end('');
    }
    if (req.url === '/goto-file') {
      res.writeHead(302, { Location: 'file:///etc/passwd' });
      return res.end('');
    }

    // ── 머리글은 utf-8 이라는데 알맹이는 EUC-KR ────────────────────────
    // 옛 사내 위키·공공기관 페이지가 이렇다. 서버 기본값이 utf-8 로 붙는다.
    if (req.url === '/badcharset') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(Buffer.concat([
        Buffer.from('<html><head><meta charset="euc-kr"></head><body><p>', 'latin1'),
        euckr한글,
        Buffer.from('</p></body></html>', 'latin1'),
      ]));
    }
    // 머리글이 **다른 실제 인코딩**을 가리키는 판. 그러면 그 이름으로 읽혀
    // 버려서 글자가 깨진 채로 남는다 — meta 에 적힌 진짜 이름이 유일한 단서다.
    if (req.url === '/wrongheader') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=shift_jis' });
      return res.end(Buffer.concat([
        Buffer.from('<html><head><meta charset="euc-kr"></head><body><p>', 'latin1'),
        euckr한글,
        Buffer.from('</p></body></html>', 'latin1'),
      ]));
    }
    // 머리글은 utf-8, 알맹이는 Shift_JIS, meta 에만 진짜가 적힌 일본어 페이지.
    // 내용만 보고 짐작하는 쪽(encoding.js)은 우리말 쪽으로 기울어 있어 여기서 깨진다.
    if (req.url === '/sjis') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(Buffer.concat([
        Buffer.from('<html><head><meta charset="shift_jis"></head><body><p>', 'latin1'),
        sjis일본어,
        Buffer.from('</p></body></html>', 'latin1'),
      ]));
    }
    // 이름에 text 가 든 바이너리. 갈래를 낱말로 안 보면 그냥 통과한다.
    if (req.url === '/namehastext') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream; name="context.bin"' });
      return res.end(Buffer.from([0x00, 0x01, 0x02, 0x03]));
    }
    // 낱말은 없지만 멀쩡한 글. 여태 이걸 거절했다.
    if (req.url === '/yaml') {
      res.writeHead(200, { 'Content-Type': 'application/yaml' });
      return res.end('이름: 값' + '\n' + '목록:' + '\n' + '  - 하나' + '\n');
    }
    // 닫는 태그를 안 적은 옛 페이지. HTML 이 그것을 허락한다.
    if (req.url === '/unclosed') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<body><p>첫째 문단<p>둘째 문단<ul><li>하나<li>둘</ul></body>');
    }
    // 되돌림 뒤에 죽는 판. 어느 집이 죽었다고 적히나.
    if (req.url === '/shorturl') {
      res.writeHead(302, { Location: `http://127.0.0.1:${port}/always429` });
      return res.end('');
    }

    // ── 잠시 뒤 되는 오류들 ─────────────────────────────────────────────
    // 처음 두 번은 429, 세 번째는 준다. 진짜 API 가 이렇게 군다.
    if (req.url === '/rate') {
      if (몇번429 > 0) {
        몇번429--;
        res.writeHead(429, { 'Retry-After': '1', 'Content-Type': 'application/json' });
        return res.end('{"error":"rate limited"}');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"ok":true}');
    }
    if (req.url === '/always429') {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      return res.end('slow down');
    }
    if (req.url === '/403') { res.writeHead(403); return res.end('no'); }

    // ── 보기 좋게 들여쓴 JSON ───────────────────────────────────────────
    // 진짜 API 가 흔히 이렇게 준다. 그 공백이 절반 가까이를 먹는다.
    if (req.url === '/prettyjson') {
      const 것 = Array.from({ length: 400 }, (_, i) => ({ id: `코인${i}`, 이름: `이름${i}`, 거래량: i * 1000 }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(것, null, 2));
    }
    if (req.url === '/hugejson') {
      const 것 = Array.from({ length: 4000 }, (_, i) => ({ id: `코인${i}`, 이름: `아주아주긴이름${i}` }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(것, null, 2));
    }

    // 같은 집에 동시에 몇 번 두드려졌나.
    if (req.url.startsWith('/slow')) {
      동시++; 최대동시 = Math.max(최대동시, 동시);
      return setTimeout(() => {
        동시--;
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      }, 80);
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
});
let 몇번429 = 2;
let 동시 = 0;
let 최대동시 = 0;
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

// ── 6. 한 집을 한꺼번에 두드리지 않는다 ────────────────────────────────
//
// 모델은 도구를 한꺼번에 부른다(`5개를 함께 돌립니다`). 그 다섯이 전부 같은
// API 면 상대 쪽에서는 한순간에 다섯 번 두드려진 것으로 보이고, 그래서
// 429 가 돌아온다. 실제로 CoinGecko 에서 그렇게 됐다.
{
  최대동시 = 0;
  const 것들 = await Promise.all([1, 2, 3, 4, 5]
    .map((i) => webFetch({ url: `http://127.0.0.1:${port}/slow${i}` }, { allowPrivate: true })));
  check('같은 집은 한 번에 하나씩 두드린다', 최대동시 === 1, `최대 ${최대동시}회 동시`);
  check('그래도 다섯 다 받아 온다', 것들.every((r) => r.content), 것들.filter((r) => r.error).length + '개 실패');
}

// ── 7. 429 는 오류가 아니라 '천천히 해라' 다 ───────────────────────────
//
// 전에는 `HTTP 429` 한 줄로 끝냈다. 모델은 그 자료를 영영 못 받고, 사람은
// 왜 못 받았는지 모른다. 쉬었다 다시 부르면 대개 된다.
{
  몇번429 = 2;
  const r = await webFetch({ url: `http://127.0.0.1:${port}/rate` }, { allowPrivate: true });
  check('429 면 쉬었다 다시 불러 받아 낸다', !r.error && /ok/.test(r.content ?? ''), r.error ?? r.summary);

  const r2 = await webFetch({ url: `http://127.0.0.1:${port}/always429` }, { allowPrivate: true });
  check('끝까지 429 면 오류로 알린다', !!r2.error, '');
  // 번호만 던지면 모델도 사람도 할 수 있는 게 없다. 무엇을 하면 되는지 말한다.
  check('무엇을 하면 되는지 같이 말한다', /하나씩|잠시 뒤/.test(r2.error ?? ''), String(r2.error).split('\n')[1] ?? '');
  check('몇 초를 쉬어 봤는지 말한다', /\d+초/.test(r2.error ?? ''), String(r2.error).split('\n')[1] ?? '');

  const r3 = await webFetch({ url: `http://127.0.0.1:${port}/403` }, { allowPrivate: true });
  check('403 은 다시 안 부르고 왜인지 말한다', /키|로그인/.test(r3.error ?? ''), String(r3.error).split('\n')[1] ?? '');
  const r4 = await webFetch({ url: `http://127.0.0.1:${port}/404` }, { allowPrivate: true });
  check('404 도 무엇을 하라고 말한다', /주소를 다시/.test(r4.error ?? ''), String(r4.error).replace(/\n/g, ' '));
}

// ── 8. 얼마나 가져올지는 모델 크기에서 나온다 ──────────────────────────
//
// 숫자를 여기 다시 박지 않는다. 박으면 규칙이 바뀔 때 검사만 조용히 틀린 말을
// 하게 된다. budget.js 에 물어보고, 그 값대로 움직이는지를 본다.
{
  const 작은것 = 웹글자수(8192);
  const 큰것 = 웹글자수(655360);
  check('작은 모델에는 적게 준다', 작은것 < 10000, `${작은것.toLocaleString()}자`);
  check('큰 모델에는 많이 준다', 큰것 > 작은것 * 10, `${큰것.toLocaleString()}자`);

  // 8k 모델에 한글 12,000자를 부으면 그 한 번으로 창이 넘친다. 안 넘겨야 한다.
  const r0 = await webFetch({ url: `http://127.0.0.1:${port}/big` }, { allowPrivate: true, 모델컨텍스트: 8192 });
  const 받은0 = parseInt((r0.summary.match(/([\d,]+)자/) ?? [])[1]?.replace(/,/g, '') ?? '0', 10);
  check('8k 모델이면 작게 잘라 준다', 받은0 === 작은것, `${받은0.toLocaleString()}자`);
  check('그 양이 8k 의 절반을 안 넘는다', 받은0 < 8192 / 2, `${받은0}자 vs 창 8192`);

  // 같은 자료라도 큰 모델이면 더 준다.
  const r1 = await webFetch({ url: `http://127.0.0.1:${port}/big` }, { allowPrivate: true, 모델컨텍스트: 655360 });
  const 받은1 = parseInt((r1.summary.match(/([\d,]+)자/) ?? [])[1]?.replace(/,/g, '') ?? '0', 10);
  check('큰 모델이면 안 자르고 다 준다', 받은1 === 60000 && !/잘림/.test(r1.summary), r1.summary);
}

// ── 9. JSON 을 글자 수로 자르면 JSON 이 아니게 된다 ────────────────────
//
// 이게 조용해서 제일 나쁘다. 모델은 `{"a":1,"b":[{"c"` 같은 것을 받고 아무것도
// 못 하는데, 화면에는 `12,800자` 라고만 떠서 사람은 자료를 받은 줄 안다.
{
  // 눌러야만 들어가는 크기를 고른다 — 안 누르면 25,669자, 누르면 16,068자다.
  // 넉넉한 창을 주면 애초에 안 눌러도 들어가서, 누르는지를 못 잰다.
  const 창 = 51200;                     // → 상한 20,000자
  const r = await webFetch({ url: `http://127.0.0.1:${port}/prettyjson` }, { allowPrivate: true, 모델컨텍스트: 창 });
  const 본문 = (r.content ?? '').split('─'.repeat(60) + '\n')[1] ?? '';
  let 읽히나 = false;
  try { JSON.parse(본문); 읽히나 = true; } catch {}
  check('들여쓴 JSON 은 눌러 담아 안 자른다', 읽히나, r.summary);
  check('눌러 담았다고 말해 준다', /눌러 담음/.test(r.summary ?? ''), r.summary);
  check('눌렀으면 잘림이 안 뜬다', !/잘림/.test(r.summary ?? ''), r.summary);

  const r2 = await webFetch({ url: `http://127.0.0.1:${port}/hugejson` }, { allowPrivate: true, 모델컨텍스트: 창 });
  check('눌러도 넘치면 잘렸다고 말한다', /잘림/.test(r2.summary ?? ''), r2.summary);
  // 여기가 핵심이다 — 잘린 JSON 은 못 읽는다는 것을 분명히 말해야 한다.
  check('잘린 JSON 은 못 읽는다고 말한다', /읽을 수 없습니다/.test(r2.content ?? ''), '');
  check('무엇을 하면 되는지 말한다', /범위를 좁혀|max_chars/.test(r2.content ?? ''), '');
  // 전에는 바이트에서 글자를 빼서, 한글이면 7배 부풀려 말했다.
  const 남은것 = /(\d[\d,]*)자가 더 있습니다/.exec(r2.content ?? '')?.[1];
  const 받은것 = parseInt((r2.summary.match(/([\d,]+)자 중/) ?? [])[1]?.replace(/,/g, '') ?? '0', 10);
  check('얼마나 잘렸는지 사실대로 말한다',
    남은것 && Math.abs(parseInt(남은것.replace(/,/g, ''), 10) - (받은것 - 웹글자수(창))) < 2,
    `남았다는 것 ${남은것} · 실제 ${(받은것 - 웹글자수(창)).toLocaleString()}`);
}

// ── 10. 글자로 세는 자리는 글자로 세야 한다 ────────────────────────────
{
  // 한글 60,000자 = UTF-8 로 180,000바이트. 바이트로 세면 세 배로 말하게 된다.
  const 창 = 32768;
  const r = await webFetch({ url: `http://127.0.0.1:${port}/big` }, { allowPrivate: true, 모델컨텍스트: 창 });
  const 남은것 = /(\d[\d,]*)자는 잘렸습니다/.exec(r.content ?? '')?.[1];
  const 맞는값 = (60000 - 웹글자수(창)).toLocaleString();
  check('한글도 글자 수로 말한다', 남은것 === 맞는값,
    `${남은것} (${맞는값} 이어야 한다 — 바이트로 세면 세 배가 된다)`);
}

/*
 * ── ★ 되돌림으로 울타리를 넘지 못한다 ──────────────────────────────────
 *
 * 여기가 이 파일에서 제일 오래 비어 있던 자리다. 직접 친 주소가 사내망인 것은
 * 위에서 재고 있었는데, **바깥 주소가 302 로 사내망을 가리키는** 길은 아무
 * 검사도 안 지나고 있었다. 위험한 쪽은 이쪽이다 — 사람은 바깥 문서 주소
 * 하나만 줬을 뿐인데, 그 서버가 우리를 사내망 안쪽으로 보낸다.
 *
 * 막는 코드는 있었다. 다만 이름 없는 함수로 묻혀 있어서 두 줄을 통째로 지워도
 * 검사가 전부 초록이었다. 「있다」 와 「돈다」 는 다르다.
 */
// (이 파일은 trace 를 안 쓴다)
{
  const 던지나 = (다음, 옵션) => {
    try { 웹되돌림(new URL(다음), 옵션); return false; } catch { return true; }
  };
  check('★ file:// 로 되돌리면 안 따라간다', 던지나('file:///etc/passwd'));
  check('★ 다른 규격(ftp)으로 되돌려도 안 따라간다', 던지나('ftp://a.example/x'));
  check('★ 사내망으로 되돌리면 안 따라간다', 던지나('http://192.168.0.1/router'));
  check('★ 이 컴퓨터로 되돌려도 안 따라간다', 던지나('http://127.0.0.1:9/속살'));
  check('★ localhost 도 마찬가지', 던지나('http://localhost:8080/admin'));
  check('바깥에서 바깥으로는 그대로 따라간다 (막느라 기능을 죽이지 않는다)',
    !던지나('https://example.com/next'));
  check('검사용으로 열어 두면 이 컴퓨터도 따라간다',
    !던지나('http://127.0.0.1:9/속살', { allowPrivate: true }));

  // 그리고 **진짜로 302 를 받아 본다.** 판단이 부르는 자리에 안 물려 있으면
  // 위 검사가 다 통과해도 아무 소용이 없다.
  const 파일로 = await webFetch({ url: `http://127.0.0.1:${port}/goto-file` }, { allowPrivate: true });
  check('★ 302 로 file:// 을 가리키면 실제로 못 따라간다', !!파일로.error,
    파일로.error ?? (파일로.content ?? '').slice(0, 60));
  check('★ 그 파일 내용이 답에 안 실린다', !/root:|bin\/bash/.test(파일로.content ?? ''),
    (파일로.content ?? '').slice(0, 40));

  const 정상 = await webFetch({ url: `http://127.0.0.1:${port}/goto` }, { allowPrivate: true });
  check('보통 되돌림은 그대로 따라간다', /본문 첫 줄/.test(정상.content ?? ''),
    정상.error ?? (정상.content ?? '').slice(0, 40));
}

// ── 인코딩·갈래·태그 ────────────────────────────────────────────────────
{
  /*
   * 머리글에 적힌 charset 이 **틀린** 페이지가 있다. 서버가 기본값으로
   * utf-8 을 붙이고 본문은 EUC-KR 인 옛 사내 위키가 딱 그렇다.
   *
   * 되읽는 자리에 `!머리글` 이 붙어 있어서, 정작 그 판에서는 한 번도 안 돌았다.
   * 깨진 글이 그대로 모델에게 가고, 모델은 깨진 채로 요약한다 — 사람은 왜
   * 엉뚱한 답이 나오는지 알 길이 없다.
   */
  const r = await webFetch({ url: `http://127.0.0.1:${port}/badcharset` }, { allowPrivate: true });
  check('★★ 머리글이 틀리게 적혀 있어도 한글이 안 깨진다',
    /한글이 그대로 보입니다/.test(r.content ?? ''), JSON.stringify((r.content ?? r.error ?? '').slice(0, 60)));
  check('  깨진 글자가 하나도 없다', !/\ufffd/.test(r.content ?? ''), JSON.stringify(r.content?.slice(0, 40)));

  /*
   * 우리말이 아니면 내용만 보고 짐작하는 쪽이 못 맞힌다. 그때 meta 에 적힌
   * 이름이 유일한 단서인데, 머리글이 있으면 그 단서를 아예 안 봤다.
   */
  /*
   * 머리글이 **다른 실제 인코딩**을 가리키면 그 이름으로 읽혀 버린다. 그때만은
   * meta 가 유일한 단서인데, 여태 머리글이 있으면 그 단서를 아예 안 봤다.
   */
  const 틀린머리글 = await webFetch({ url: `http://127.0.0.1:${port}/wrongheader` }, { allowPrivate: true });
  check('★★ 머리글이 다른 인코딩을 가리켜도 meta 를 보고 되읽는다',
    /한글이 그대로 보입니다/.test(틀린머리글.content ?? ''),
    JSON.stringify((틀린머리글.content ?? 틀린머리글.error ?? '').slice(-40)));

  const 일본 = await webFetch({ url: `http://127.0.0.1:${port}/sjis` }, { allowPrivate: true });
  check('★★ 머리글이 틀린 일본어 페이지도 안 깨진다',
    /日本語のページです/.test(일본.content ?? ''),
    JSON.stringify((일본.content ?? 일본.error ?? '').slice(-40)));
}

{
  /*
   * 갈래를 낱말로 안 보면 두 쪽에서 틀린다. `application/octet-stream;
   * name="context.bin"` 은 'context' 안의 text 에 걸려 통과하고(바이너리가
   * 모델에게 간다), `application/yaml` 같은 멀쩡한 글은 거절당한다.
   */
  const 바이너리 = await webFetch({ url: `http://127.0.0.1:${port}/namehastext` }, { allowPrivate: true });
  check('★★ 이름에 text 가 든 바이너리는 안 읽는다',
    /글이 아닌 내용/.test(바이너리.error ?? ''), JSON.stringify((바이너리.error ?? 바이너리.content ?? '').slice(0, 60)));
  const yaml = await webFetch({ url: `http://127.0.0.1:${port}/yaml` }, { allowPrivate: true });
  check('★★ yaml 처럼 낱말 없는 글은 읽는다',
    /이름: 값/.test(yaml.content ?? ''), JSON.stringify((yaml.error ?? yaml.content ?? '').slice(0, 60)));
}

{
  // 닫는 태그만 줄로 바꾸면, 안 적은 페이지가 통째로 한 줄이 된다.
  const r = await webFetch({ url: `http://127.0.0.1:${port}/unclosed` }, { allowPrivate: true });
  const 줄수 = (r.content ?? '').split('\n').filter((l) => l.trim()).length;
  check('★ 닫는 태그를 안 적은 페이지도 줄이 갈린다', 줄수 >= 4, `${줄수}줄 · ${JSON.stringify(r.content)}`);
}

{
  /*
   * 되돌림을 따라가면 **정말 답한 곳**은 처음 주소가 아니다. 처음 주소만
   * 적으면 짧은주소가 힘들어한다고 뜬다 — 사람도 모델도 엉뚱한 쪽을 붙잡고,
   * 심사서의 「어디로 나갔나」 에서도 실제로 통신한 집이 빠진다.
   */
  const 앞기록 = 방문기록.length;
  const r = await webFetch({ url: `http://127.0.0.1:${port}/shorturl` }, { allowPrivate: true });
  const 새로적힌것 = 방문기록.slice(앞기록).map((x) => x.url);
  check('★★ 되돌려 간 곳도 기록에 남는다',
    새로적힌것.some((x) => /always429/.test(x)), JSON.stringify(새로적힌것));
  check('  처음 주소도 그대로 남는다',
    새로적힌것.some((x) => /shorturl/.test(x)), JSON.stringify(새로적힌것));
  check('★ 오류에도 처음 주소가 아니라 닿은 곳이 적힌다',
    /always429/.test(r.error ?? '') || !/shorturl/.test(r.error ?? ''), JSON.stringify(r.error?.slice(0, 80)));
}

{
  // 안내에 적힌 상한이 실제와 달랐다 — 모델이 그 수를 믿고 max_chars 를 정한다.
  const 글 = JSON.stringify(toolSchemas().find((t) => t.function?.name === 'WebFetch') ?? {});
  check('★ 도구 설명의 상한과 실제 상한이 같다',
    !/100,000|100000/.test(글) || /120000/.test(글), '');
}

// ── 멈춤과 줄 서기 ──────────────────────────────────────────────────────
{
  /*
   * 이미 멈춘 신호를 들고 오면 `abort` 는 **다시 안 터진다.** 그 판에서 그냥
   * 잠들면 ESC 를 누른 뒤에도 그 잠을 끝까지 잔다 — 화면에는 「멈추는 중…」 이
   * 그대로 떠 있고, 사람 눈에는 ESC 가 안 먹은 것과 똑같이 보인다.
   */
  /*
   * 닿는 길은 **줄 서 있는 사이에 멈추는** 것이다. webFetch 는 들어올 때 한 번
   * 신호를 보므로, 처음부터 멈춰 있으면 잠까지 가지도 않는다. 줄을 선 뒤에
   * 멈추면 제 차례가 왔을 때 신호는 이미 멈춘 상태다 — 거기가 그 자리다.
   */
  const 잰것 = [];
  for (let i = 0; i < 3; i++) {
    const ac = new AbortController();
    const t0 = Date.now();
    const 앞 = webFetch({ url: `http://127.0.0.1:${port}/slow` }, { allowPrivate: true, signal: ac.signal });
    const 뒤 = webFetch({ url: `http://127.0.0.1:${port}/page` }, { allowPrivate: true, signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await Promise.allSettled([앞, 뒤]);
    잰것.push(Date.now() - t0);
  }
  const 제일빠른것 = Math.min(...잰것);
  // 줄 서는 잠이 400ms 다. 안 자면 앞사람이 끊긴 그 자리에서 바로 끝난다.
  check('★★ 줄 서 있는 사이에 멈추면 그 잠을 안 잔다', 제일빠른것 < 250, `${제일빠른것}ms · ${잰것.join('/')}ms`);

  /*
   * 줄에서 빠지지 않으면, 한참 뒤에 혼자 부르는 요청도 앞사람이 있는 것으로
   * 보여 400ms 를 그냥 잔다 — 줄이 비어 있는데 서 있는 셈이다.
   */
  await webFetch({ url: `http://127.0.0.1:${port}/page` }, { allowPrivate: true });
  const 혼자잰것 = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    await webFetch({ url: `http://127.0.0.1:${port}/page` }, { allowPrivate: true });
    혼자잰것.push(Date.now() - t0);
  }
  const 혼자 = Math.min(...혼자잰것);
  check('★ 줄이 비면 다음 사람이 안 기다린다', 혼자 < 200, `${혼자}ms · ${혼자잰것.join('/')}ms`);
}

server.closeAllConnections?.();
server.close();
await new Promise((r) => setImmediate(r));


const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n웹 읽기 검사  ' + D + '(읽기만 하는가 · 데이터가 안 실려 나가는가)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
