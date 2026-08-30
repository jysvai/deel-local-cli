// Azure OpenAI — 주소 모양이 다른 것 하나 때문에 연결이 통째로 안 되던 자리.
//
// ── 무엇을 재나 ────────────────────────────────────────────────────────
//
// 사내에서 OpenAI 를 쓰는 곳은 대개 Azure 를 거치는데, Azure 는 OpenAI 호환이라면서
// 주소 모양만 다르다. 모델 이름이 주소 안에 있고, `?api-version=` 이 없으면 400 이고,
// 모델 목록은 `/models` 가 아니라 `/openai/deployments` 에 있고, 열쇠는 `api-key`
// 헤더다. 그래서 포털에서 복사한 주소를 그대로 넣으면 `.../v1/models` 를 두드리다
// "연결 실패" 로 끝났다 — 주소는 맞는데 우리가 몰랐던 것이라 사람이 고칠 수도 없었다.
//
// 여기서는 **가짜 Azure 서버가 실제로 받은 경로와 헤더**로 잰다. 우리 쪽 문자열을
// 우리 쪽 함수로 다시 확인하는 검사는 아무것도 증명하지 못한다.
import { createServer } from 'node:http';
import {
  애저인가, 애저풀기, 애저base, 배포목록, 애저정하기, 지금판, 판되돌리기,
} from '../src/backend/azure.js';
import { candidates, detect } from '../src/backend/detect.js';
import { 요청주소, chat, chatStream } from '../src/backend/adapter.js';
import { probeCtx } from '../src/backend/ctxsize.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 기본판 = 판되돌리기();

// ── 1. 이게 Azure 인가 ─────────────────────────────────────────────────
trace('1-알아보기');
{
  const 맞는것 = [
    'https://내회사.openai.azure.com',
    'https://내회사.openai.azure.com/',
    'https://내회사.openai.azure.com/openai/deployments/gpt-4o',
    'https://내회사.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-06-01',
    'https://내회사.cognitiveservices.azure.com/openai/deployments/gpt-4o',
    'https://foundry.services.ai.azure.com/openai/deployments/gpt-4o',
    'https://gw.사내.local/openai/deployments/gpt-4o',   // 앞단만 사내 주소인 경우
    '내회사.openai.azure.com',
  ];
  const 아닌것 = [
    'http://127.0.0.1:1234/v1',
    'https://api.openai.com/v1',
    'https://gw.example.com/v1',
    'https://azure.example.com/v1',        // 이름만 azure
    'https://내회사.openai.azure.com.evil.example/v1',   // 뒤에 딴 도메인이 붙은 것
    '',
  ];
  for (const u of 맞는것) check(`Azure 로 본다: ${u.slice(0, 52)}`, 애저인가(u) === true);
  for (const u of 아닌것) check(`Azure 가 아니다: ${u || '(빈 글)'}`, 애저인가(u) === false);
}

// ── 2. 복사해 온 주소를 푼다 ───────────────────────────────────────────
trace('2-풀기');
{
  const 표 = [
    ['https://a.openai.azure.com', null],
    ['https://a.openai.azure.com/', null],
    ['https://a.openai.azure.com/openai/deployments/gpt-4o', 'gpt-4o'],
    ['https://a.openai.azure.com/openai/deployments/gpt-4o/', 'gpt-4o'],
    ['https://a.openai.azure.com/openai/deployments/gpt-4o/chat/completions', 'gpt-4o'],
    ['https://a.openai.azure.com/openai/deployments/우리-gpt4o-01', '우리-gpt4o-01'],
  ];
  for (const [입력, 배포] of 표) {
    const r = 애저풀기(입력);
    check(`풀기: ${입력.slice(8, 60)} → 배포 ${배포 ?? '(없음)'}`, r?.배포 === 배포, JSON.stringify(r?.배포));
  }
  const r = 애저풀기('https://a.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2099-01-01');
  check('주소에 적힌 판을 그대로 따른다', r.판 === '2099-01-01', r.판);
  check('뒤에 붙은 chat/completions 는 버린다 (우리가 다시 붙인다)',
    r.base === 'https://a.openai.azure.com/openai/deployments/gpt-4o?api-version=2099-01-01', r.base);
  check('목록 주소는 배포 위쪽이다', r.목록주소 === 'https://a.openai.azure.com/openai/deployments?api-version=2099-01-01', r.목록주소);
  check('판이 안 적혀 있으면 기본판을 쓴다', 애저풀기('https://a.openai.azure.com/openai/deployments/x').판 === 기본판, 기본판);
  check('배포 이름이 없으면 base 도 없다 (목록부터 봐야 한다)', 애저풀기('https://a.openai.azure.com').base === null);
  check('한글·기호가 든 배포 이름은 인코딩한다', 애저base('https://a.openai.azure.com', '우리 배포', '2024-10-21')
    === 'https://a.openai.azure.com/openai/deployments/%EC%9A%B0%EB%A6%AC%20%EB%B0%B0%ED%8F%AC?api-version=2024-10-21');

  애저정하기({ env: { DEEL_AZURE_API_VERSION: '2025-03-01' } });
  check('환경변수로 판을 바꾼다', 지금판() === '2025-03-01' && 애저풀기('https://a.openai.azure.com/openai/deployments/x').판 === '2025-03-01');
  애저정하기({ env: {}, config: { apiVersion: '2024-08-01-preview' } });
  check('설정 파일로도 바꾼다', 지금판() === '2024-08-01-preview');
  애저정하기({ env: { DEEL_AZURE_API_VERSION: '2030-01-01' }, config: { apiVersion: '2024-08-01-preview' } });
  check('환경변수가 설정보다 세다', 지금판() === '2030-01-01');
  판되돌리기();

  check('배포 목록을 모델 목록으로 바꾼다', JSON.stringify(배포목록({
    data: [{ id: 'gpt-4o-사내', model: 'gpt-4o', status: 'succeeded' }, { id: '옛것', model: 'gpt-35-turbo', status: 'updating' }, { 이상한것: 1 }],
  })) === JSON.stringify([{ id: 'gpt-4o-사내', note: 'gpt-4o' }, { id: '옛것', note: 'gpt-35-turbo · updating' }]));
}

// ── 3. 후보 주소 — Azure 에는 /v1 을 안 붙인다 ────────────────────────
trace('3-후보');
{
  const azure = candidates('https://a.openai.azure.com/openai/deployments/gpt-4o');
  check('Azure 주소는 그대로 하나만 본다', azure.length === 1 && !azure[0].includes('/v1'), azure.join(' '));
  const 보통 = candidates('http://127.0.0.1:1234');
  check('보통 주소는 하던 대로 넓힌다 (회귀)', 보통.includes('http://127.0.0.1:1234/v1') && 보통.length === 3, 보통.join(' '));
}

// ── 4. 요청 주소 — 물음표 뒤가 끝에 남는가 ────────────────────────────
trace('4-요청주소');
{
  const azure = { kind: 'openai', base: 'https://a.openai.azure.com/openai/deployments/gpt-4o?api-version=2024-10-21' };
  check('경로는 물음표 앞에, 판은 맨 뒤에',
    요청주소(azure) === 'https://a.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21',
    요청주소(azure));
  check('보통 주소는 하던 그대로 (회귀)', 요청주소({ kind: 'openai', base: 'http://h/v1' }) === 'http://h/v1/chat/completions');
  check('Ollama 도 그대로 (회귀)', 요청주소({ kind: 'ollama', base: 'http://h' }) === 'http://h/api/chat');
  check('끝의 슬래시를 하나로 정리한다', 요청주소({ kind: 'openai', base: 'http://h/v1/?x=1' }) === 'http://h/v1/chat/completions?x=1');
}

// ── 가짜 Azure ─────────────────────────────────────────────────────────
const 받은것 = [];
let 목록상태 = 200;
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://127.0.0.1');
    받은것.push({ 길: u.pathname, 판: u.searchParams.get('api-version'), 헤더: req.headers, 몸: body });
    const 보내기 = (코드, 것) => { res.writeHead(코드, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(것)); };

    // 배포 목록
    if (u.pathname === '/openai/deployments') {
      if (목록상태 !== 200) return 보내기(목록상태, { error: { message: '권한 없음' } });
      if (!u.searchParams.get('api-version')) return 보내기(400, { error: { message: 'api-version 이 없습니다' } });
      if (!req.headers['api-key']) return 보내기(401, { error: { message: 'api-key 헤더가 필요합니다' } });
      return 보내기(200, { data: [{ id: '사내-gpt4o', model: 'gpt-4o', status: 'succeeded' }, { id: '사내-mini', model: 'gpt-4o-mini', status: 'succeeded' }] });
    }
    // 대화
    const m = /^\/openai\/deployments\/([^/]+)\/chat\/completions$/.exec(u.pathname);
    if (m) {
      if (!u.searchParams.get('api-version')) return 보내기(400, { error: { message: 'api-version 이 없습니다' } });
      if (!req.headers['api-key']) return 보내기(401, { error: { message: 'api-key 헤더가 필요합니다' } });
      if (/"stream":true/.test(body)) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"흘려"}}]}\n\n');
        res.write('data: {"choices":[{"delta":{"content":" 보냄"}}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n');
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      return 보내기(200, {
        choices: [{ message: { content: `${decodeURIComponent(m[1])} 가 답했습니다` }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      });
    }
    보내기(404, { error: { message: `그런 자리는 없습니다: ${u.pathname}` } });
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const 포트 = server.address().port;
const origin = `http://127.0.0.1:${포트}`;
resetNet();
allowEndpoint(origin);

// ── 5. 알아보기 — 포털에서 복사한 그대로 ──────────────────────────────
trace('5-detect');
{
  받은것.length = 0;
  const found = await detect(`${origin}/openai/deployments/사내-gpt4o`, 'key-1');
  check('Azure 를 알아본다', found.kind === 'openai' && found.azure === true, JSON.stringify({ kind: found.kind, azure: found.azure }));
  check('api-key 방식을 고른다', found.auth === 'api-key', found.auth);
  check('배포 목록을 모델 목록으로 준다', found.models.map((m) => m.id).join(',') === '사내-gpt4o,사내-mini', JSON.stringify(found.models));
  check('base 에 판이 붙어 있다', /\/openai\/deployments\/%EC%82%AC%EB%82%B4-gpt4o\?api-version=/.test(found.base) || /\/openai\/deployments\/사내-gpt4o\?api-version=/.test(decodeURIComponent(found.base)), found.base);
  check('/v1/models 같은 자리는 두드리지도 않는다', !받은것.some((x) => /\/v1|\/models$/.test(x.길)), 받은것.map((x) => x.길).join(' '));
  check('목록을 물을 때도 판을 붙인다', 받은것[0]?.판 === 기본판, String(받은것[0]?.판));

  // 배포 이름 없이 회사 주소만 준 경우 — 목록에서 첫 배포로 이어 준다.
  받은것.length = 0;
  const 만origin = await detect(origin + '/openai/deployments', 'key-1');
  check('배포 없이 회사 주소만 줘도 목록으로 이어 준다', 만origin.kind === 'openai' && /사내-gpt4o/.test(decodeURIComponent(만origin.base)), 만origin.base);
}

// ── 6. 진짜로 보내 본다 ───────────────────────────────────────────────
trace('6-대화');
{
  받은것.length = 0;
  const found = await detect(`${origin}/openai/deployments/사내-mini`, 'key-1');
  const conn = { kind: 'openai', base: found.base, auth: found.auth, key: 'key-1', model: '사내-mini', ctx: 8000 };
  const r = await chat(conn, { messages: [{ role: 'user', content: '안녕' }], maxTokens: 50 });
  check('답이 온다', /사내-mini 가 답했습니다/.test(r.content), r.content);

  const 대화요청 = 받은것.find((x) => /chat\/completions$/.test(x.길));
  check('경로가 정확하다', 대화요청?.길 === '/openai/deployments/%EC%82%AC%EB%82%B4-mini/chat/completions'
    || decodeURIComponent(대화요청?.길 ?? '') === '/openai/deployments/사내-mini/chat/completions', 대화요청?.길);
  check('판이 붙어서 간다', 대화요청?.판 === 기본판, String(대화요청?.판));
  check('api-key 헤더로 간다', 대화요청?.헤더['api-key'] === 'key-1', JSON.stringify(대화요청?.헤더['api-key']));
  check('Authorization 은 안 보낸다', !대화요청?.헤더.authorization);

  // 흘려 받기도 같은 주소로 가야 한다.
  받은것.length = 0;
  let 흘러온것 = '';
  for await (const ev of chatStream(conn, { messages: [{ role: 'user', content: '안녕' }], maxTokens: 50 })) {
    if (ev.type === 'content') 흘러온것 += ev.text;
  }
  const 흘림요청 = 받은것.find((x) => /chat\/completions$/.test(x.길));
  check('흘려 받기도 답이 온다', 흘러온것 === '흘려 보냄', JSON.stringify(흘러온것));
  check('흘려 받기도 판을 붙여 간다', 흘림요청?.판 === 기본판 && /chat\/completions$/.test(흘림요청?.길 ?? ''), `${흘림요청?.길}?api-version=${흘림요청?.판}`);
}

// ── 7. 목록을 막아 둔 테넌트 ──────────────────────────────────────────
trace('7-목록막힘');
{
  목록상태 = 403;
  받은것.length = 0;
  const found = await detect(`${origin}/openai/deployments/사내-gpt4o`, 'key-1');
  check('목록이 막혀도 연결 실패로 안 친다', found.kind === 'openai', JSON.stringify(found.kind));
  check('주소에 적힌 배포로 그냥 간다', /사내-gpt4o/.test(decodeURIComponent(found.base ?? '')), found.base);
  check('못 본 것을 못 봤다고 말한다', /배포 목록을 못 봤습니다/.test(found.warn ?? ''), found.warn);
  check('모델 목록은 비었다고 정직하게 준다', Array.isArray(found.models) && found.models.length === 0);

  // 그 상태로도 대화는 된다.
  const conn = { kind: 'openai', base: found.base, auth: 'api-key', key: 'key-1', model: '사내-gpt4o' };
  const r = await chat(conn, { messages: [{ role: 'user', content: 'x' }], maxTokens: 20 });
  check('목록이 막혀 있어도 대화는 된다', /사내-gpt4o 가 답했습니다/.test(r.content), r.content);
  목록상태 = 200;
}

// ── 8. 컨텍스트 길이 — 없는 문을 두드리지 않는다 ─────────────────────
trace('8-ctx');
{
  받은것.length = 0;
  const conn = { kind: 'openai', base: `${origin}/openai/deployments/사내-mini?api-version=${기본판}`, auth: 'api-key', key: 'key-1', model: '사내-mini' };
  const r = await probeCtx(conn, { timeout: 3000 });
  check('Azure 에서는 길이를 못 얻는다고 말한다', r.value === null && /Azure/.test(r.why ?? ''), r.why);
  check('그러느라 서버를 두드리지도 않는다', 받은것.length === 0, `${받은것.length}번 두드림`);
}

// ── 9. 열쇠에 한글이 섞이면 ───────────────────────────────────────────
//
// 이 검사를 여기 두는 이유: Azure 를 붙이다 실제로 걸린 자리다. 열쇠를
// 붙여넣을 때 한글이나 따옴표가 딸려 오면 요청이 만들어지지도 않는데,
// 예전 메시지는 "연결 실패 — 주소·포트·프록시를 확인하세요" 였다.
// 그 말을 믿고 방화벽부터 뒤지게 된다.
trace('9-한글열쇠');
{
  const { req } = await import('../src/backend/http.js');
  const { headersFor } = await import('../src/backend/http.js');
  const r = await req(`${origin}/openai/deployments?api-version=${기본판}`, {
    headers: headersFor('api-key', '열쇠-한글이-섞임'),
    timeout: 5000,
  });
  check('한글 열쇠는 요청이 안 나간다', r.ok === false, JSON.stringify(r.status));
  check('무엇이 잘못됐는지 그대로 말해 준다', /한글·특수문자가 섞여/.test(r.error ?? ''), r.error);
  check('주소·프록시 탓으로 돌리지 않는다', !/주소·포트·프록시를 확인/.test(r.error ?? ''), r.error);
}

server.close();

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\nAzure 규격 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? D + '  ' + p.note + X : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
