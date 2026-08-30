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
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { 주소가리기 } from '../src/safety/secrets.js';
import { probe } from '../src/backend/probe.js';
import { req, headersFor } from '../src/backend/http.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 기본판 = 판되돌리기();

/*
 * 한 칸이 터져도 나머지는 재고, 터진 칸은 실패로 적는다.
 *
 * 예전에는 살아 있는 서버를 쓰는 칸에서 예외가 나면 검사가 통째로 멈춰서
 * `N개 통과 · M개 실패` 줄이 아예 안 찍혔다. 그러면 무엇이 깨졌는지가 아니라
 * 스택만 남는다 — 되돌아간 자리를 찾는 데 아무 도움이 안 된다.
 */
const 재보기 = async (이름, fn) => {
  try { await fn(); }
  catch (e) { fail.push({ name: `${이름} 이 끝까지 간다`, note: `터짐: ${e.message}` }); }
};

/*
 * 띄운 서버는 **반드시** 여기 적어 두고 끝에서 다 닫는다.
 *
 * 한 칸이 중간에 터지면 그 칸의 close() 를 못 지나간다. 그러면 서버가 열린
 * 채로 남고, Node 는 열린 자리가 있는 한 안 끝난다 — 검사는 다 끝났는데
 * 프로그램이 안 죽어서 밖에서 보면 '멈춘 것' 으로 보인다. 실제로 그렇게
 * 돌연변이 검사가 5분 넘게 매달려 있었다.
 */
const 서버들 = [];
const 띄우기 = async (handler) => {
  const s = createServer(handler);
  서버들.push(s);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return s;
};

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

// ── 3. 후보 주소 — 보통 주소는 하던 그대로 ────────────────────────────
//
// 예전에는 여기서 candidates() 의 Azure 갈래를 쟀다. 그런데 detect() 가 그보다
// 먼저 갈라놓기 때문에 그 갈래에는 닿을 일이 없었다 — 죽은 길을 재고 있었고,
// 그래서 그 두 줄은 통과해도 아무것도 증명하지 못했다. 갈래를 지우고 검사도 지웠다.
trace('3-후보');
{
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
  check('못 본 것을 못 봤다고 말한다', /확인 못 했습니다|못 봤습니다/.test(found.warn ?? ''), found.warn);
  check('무엇을 해 봤는지까지 적는다', /HTTP/.test(found.warn ?? ''), found.warn);
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


// ── 10. 설치 화면이 제 검사에 통과하는가 (probe 가 두드리는 자리) ──────
//
// 이 슬라이스가 제일 크게 놓쳤던 자리다. adapter 는 고쳤는데 probe 는 안 고쳐서,
// 붙기는 붙고 `deel setup` 의 여덟 칸이 통째로 '확인 불가' 로 넘어갔다. 그러면
// 프로필에 스트리밍도 도구 호출도 안 된다고 적히고, 그 뒤로 계속 반쪽으로 돈다.
trace('10-probe');
await 재보기('10-probe', async () => {
  받은것.length = 0;
  const found = await detect(`${origin}/openai/deployments/사내-mini`, 'key-1');
  const r = await probe({ kind: 'openai', base: found.base, auth: found.auth, key: 'key-1', model: '사내-mini' });
  const 대화 = 받은것.filter((x) => /chat\/completions$/.test(x.길));
  check('probe 가 배포 주소를 제대로 두드린다', 대화.length > 0, 받은것.map((x) => x.길).join(' '));
  check('probe 요청에도 판이 붙는다', 대화[0]?.판 === 기본판, String(대화[0]?.판));
  check('판이 경로 안에 섞이지 않는다', !받은것.some((x) => /api-version/.test(x.길)), JSON.stringify(대화[0]?.길));
  check('기본 대화 칸이 통과한다', r.results.find((x) => x.id === 'chat')?.status === 'ok',
    JSON.stringify(r.results.find((x) => x.id === 'chat')?.detail));
  check('나머지 칸이 확인 불가로 안 넘어간다', !r.results.every((x) => x.status === 'skip' || x.id === 'chat'),
    r.results.map((x) => `${x.id}:${x.status}`).join(' '));
});

// ── 11. 못 닿는 주소를 연결됨이라고 하지 않는다 ────────────────────────
trace('11-못닿음');
await 재보기('11-못닿음', async () => {
  // 아무도 안 듣는 자리를 하나 잡는다 — 열었다가 바로 닫아서 확실히 비운다.
  const 잠깐 = await 띄우기(() => {});
  const 죽은포트 = 잠깐.address().port;
  await new Promise((r) => 잠깐.close(r));
  const 죽은곳 = `http://127.0.0.1:${죽은포트}`;
  allowEndpoint([origin, 죽은곳]);

  const r = await detect(`${죽은곳}/openai/deployments/gpt-4o`, 'key-1');
  check('닿지도 못한 것을 붙었다고 하지 않는다', r.kind === null, JSON.stringify({ kind: r.kind, warn: r.warn }));
  check('목록 권한 탓으로 돌리지 않는다', !/목록/.test(r.why ?? ''), r.why);
  check('왜 못 붙었는지 말은 해 준다', !!r.why, r.why);
});

// ── 12. 인증 방식은 다 해 보고 고른다 ──────────────────────────────────
//
// Azure 앞단을 Entra ID 로 감싼 곳은 api-key 에 401 을 주고 Bearer 를 받는다.
// 첫 401 에서 멈추면 그런 곳은 영영 못 붙는다 — 화면은 초록색인데 첫 한마디가 401.
trace('12-인증차례');
await 재보기('12-인증차례', async () => {
  const 본것 = [];
  const s2 = await 띄우기((q, res) => {
    본것.push({ 열쇠: !!q.headers['api-key'], 베어러: !!q.headers.authorization });
    const 보내 = (코드, 것) => { res.writeHead(코드, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(것)); };
    if (q.headers.authorization) return 보내(200, { data: [{ id: '사내-gpt4o', model: 'gpt-4o', status: 'succeeded' }] });
    보내(401, { error: { message: 'Bearer 토큰이 필요합니다' } });
  });
  const b2 = `http://127.0.0.1:${s2.address().port}`;
  allowEndpoint([origin, b2]);

  const r = await detect(`${b2}/openai/deployments/사내-gpt4o`, 'key-1');
  check('401 을 받아도 다음 방식을 해 본다', 본것.length >= 2, JSON.stringify(본것));
  check('되는 방식으로 정한다', r.auth === 'bearer', r.auth);
  check('그래서 목록도 받아 온다', r.models?.[0]?.id === '사내-gpt4o', JSON.stringify(r.models));
  s2.close();

  // 다 막혔을 때 — 열쇠를 줬는데 '인증 없음' 으로 적어 두면 그 뒤 모든 요청이 맨몸으로 나간다.
  const s3 = await 띄우기((q, res) => {
    res.writeHead(q.headers['api-key'] || q.headers.authorization ? 500 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: '안 됩니다' } }));
  });
  const b3 = `http://127.0.0.1:${s3.address().port}`;
  allowEndpoint([origin, b3]);
  const r3 = await detect(`${b3}/openai/deployments/사내-gpt4o`, 'key-1');
  check('열쇠를 줬으면 인증 없음으로 적지 않는다', r3.kind === 'openai' && r3.auth !== 'none',
    JSON.stringify({ kind: r3.kind, auth: r3.auth }));
  s3.close();
});

// ── 13. 앞단 아래 매달린 주소 (APIM 같은 것) ──────────────────────────
trace('13-앞길');
await 재보기('13-앞길', async () => {
  const 본길 = [];
  const s4 = await 띄우기((q, res) => {
    const u = new URL(q.url, 'http://127.0.0.1');
    본길.push(decodeURIComponent(u.pathname));
    const 보내 = (코드, 것) => { res.writeHead(코드, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(것)); };
    if (u.pathname === '/azure-openai/openai/deployments') {
      return 보내(200, { data: [{ id: '사내-gpt4o', model: 'gpt-4o', status: 'succeeded' }] });
    }
    if (/^\/azure-openai\/openai\/deployments\/[^/]+\/chat\/completions$/.test(u.pathname)) {
      let body = '';
      q.on('data', (d) => (body += d));
      return q.on('end', () => 보내(200, {
        choices: [{ message: { content: '앞단 아래에서 답했습니다' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    }
    보내(404, { error: { message: `그런 자리는 없습니다: ${u.pathname}` } });
  });
  const b4 = `http://127.0.0.1:${s4.address().port}`;
  allowEndpoint([origin, b4]);

  const 준것 = `${b4}/azure-openai/openai/deployments/사내-gpt4o/chat/completions?api-version=2024-06-01`;
  const found = await detect(준것, 'key-1');
  check('앞길을 지킨 채로 붙는다', found.kind === 'openai', JSON.stringify({ kind: found.kind, why: found.why }));
  check('base 에 앞길이 남아 있다', /\/azure-openai\/openai\/deployments\//.test(decodeURIComponent(found.base ?? '')), found.base);
  const conn = { kind: 'openai', base: found.base, auth: found.auth, key: 'key-1', model: '사내-gpt4o' };
  const r = await chat(conn, { messages: [{ role: 'user', content: 'x' }], maxTokens: 20 });
  check('앞단 아래로 대화가 오간다', /앞단 아래에서 답했습니다/.test(r.content ?? ''), r.content);
  check('호스트 바로 밑을 두드리지 않는다', !본길.some((x) => x === '/openai/deployments'), 본길.join(' '));
  s4.close();
});

// ── 14. /model 로 배포를 바꿀 때도 같은 자리를 본다 ────────────────────
trace('14-model명령');
await 재보기('14-model명령', async () => {
  받은것.length = 0;
  const { handle } = await import('../src/commands.js');
  const { Session } = await import('../src/agent/session.js');
  const { makeScope } = await import('../src/safety/guard.js');
  const { History } = await import('../src/safety/undo.js');
  const { Audit } = await import('../src/safety/audit.js');
  const { writeFileSync } = await import('node:fs');
  const 집 = mkdtempSync(join(tmpdir(), 'deel-az-'));
  process.env.DEEL_HOME = 집;      // 진짜 ~/.deel 은 안 건드린다

  const conn = {
    kind: 'openai', base: `${origin}/openai/deployments/사내-mini?api-version=${기본판}`,
    auth: 'api-key', key: 'key-1', model: '사내-mini', ctx: 8000,
  };
  // /model 은 등록된 연결이 하나도 없으면 그 자리에서 끝난다. 하나 적어 둔다.
  writeFileSync(join(집, 'config.json'), JSON.stringify({
    profiles: [{
      id: 'az', name: 'az', kind: 'openai', baseUrl: conn.base,
      auth: 'api-key', apiKey: 'key-1', model: '사내-mini',
    }],
    active: 'az',
  }), 'utf8');
  const session = new Session(conn, { root: 집 });
  const ctx = { scope: makeScope(집), history: new History(집), audit: new Audit(집), seen: new Set() };
  const 원래 = console.log;
  console.log = () => {};
  try { await handle('/model 사내-gpt4o', session, ctx); }
  finally { console.log = 원래; }

  check('/model 도 배포 목록 자리를 본다', 받은것.some((x) => x.길 === '/openai/deployments'), 받은것.map((x) => x.길).join(' '));
  check('/model 이 /models 를 두드리지 않는다', !받은것.some((x) => /\/models$/.test(x.길)), 받은것.map((x) => x.길).join(' '));
});

// ── 15. 열쇠가 오류 문구로 새어 나가지 않는다 ──────────────────────────
//
// 헤더 값이 못 실릴 때 런타임이 내는 말 중 하나는 **열쇠를 그대로 따옴표에
// 넣어서** 말한다. 그 문구는 화면에도 뜨고 진단 보고서 파일에도 적히는데,
// 그 파일은 "이것만 가져오시면 됩니다" 라고 우리가 권하는 파일이다.
trace('15-열쇠유출');
await 재보기('15-열쇠유출', async () => {
  const 진짜열쇠 = 'sk-SECRET-DEADBEEF-0123456789';
  const 것들 = [['줄바꿈', `${진짜열쇠}\r\nx`], ['NUL', `${진짜열쇠}${String.fromCharCode(0)}`], ['한글', `${진짜열쇠}한글`]];
  for (const [무엇, 열쇠] of 것들) {
    const r = await req(`${origin}/openai/deployments?api-version=${기본판}`, {
      headers: headersFor('api-key', 열쇠),
      timeout: 5000,
    });
    check(`${무엇} 섞인 열쇠는 요청이 안 나간다`, r.ok === false, JSON.stringify(r.status));
    check(`${무엇}: 오류 문구에 열쇠가 안 실린다`, !String(r.error ?? '').includes('SECRET-DEADBEEF'), r.error);
    check(`${무엇}: 무엇이 잘못됐는지는 말해 준다`, /한글·특수문자가 섞여/.test(r.error ?? ''), r.error);
  }
  // 앞뒤 공백·줄바꿈만 딸려 온 것은 떼고 그냥 보낸다 — 파일에서 복사하면 흔하다.
  const 깔끔 = await req(`${origin}/openai/deployments?api-version=${기본판}`, {
    headers: headersFor('api-key', '  key-1\n'),
    timeout: 5000,
  });
  check('앞뒤 공백은 떼고 그냥 보낸다', 깔끔.ok === true, JSON.stringify({ status: 깔끔.status, error: 깔끔.error }));
});

// ── 16. 주소에 실린 자격증명은 화면·파일에 안 적는다 ───────────────────
trace('16-주소가리기');
{
  const 긴것 = 'https://apim.사내/azure-openai/openai/deployments/gpt-4o?api-version=2024-10-21&subscription-key=SECRET123';
  const 것 = 주소가리기(긴것);
  check('물음표 뒤 값은 가린다', !것.includes('SECRET123'), 것);
  check('이름은 남긴다', 것.includes('subscription-key='), 것);
  check('판 번호는 그대로 둔다', 것.includes('api-version=2024-10-21'), 것);
  check('경로는 그대로 둔다', 것.includes('/azure-openai/openai/deployments/gpt-4o'), 것);
  check('물음표가 없으면 손 안 댄다', 주소가리기('https://gw.corp/v1') === 'https://gw.corp/v1');
  check('Functions 앞단의 code 도 가린다', !주소가리기('https://f.net/api?code=AAA_BBB').includes('AAA_BBB'));
}

// ── 17. 망가진 주소를 만나도 안 죽는다 ─────────────────────────────────
trace('17-망가진주소');
{
  for (const 나쁜것 of ['https://a.openai.azure.com/openai/deployments/100%', 'https://a.openai.azure.com/openai/deployments/%zz']) {
    let 터짐 = null;
    try { 애저풀기(나쁜것); } catch (e) { 터짐 = e.message; }
    check(`퍼센트가 망가져도 안 터진다: ${나쁜것.slice(-6)}`, 터짐 === null, String(터짐));
  }
}

// ── 18. Azure 자원의 /openai/v1 은 예전 그대로 (되돌아가면 안 되는 자리) ─
trace('18-v1창구');
await 재보기('18-v1창구', async () => {
  check('/openai/v1 로 끝나면 Azure 로 안 다룬다', 애저인가('https://a.openai.azure.com/openai/v1') === false);
  check('/v1 로 끝나도 마찬가지', 애저인가('https://a.openai.azure.com/v1') === false);
  check('배포 주소는 그대로 Azure', 애저인가('https://a.openai.azure.com/openai/deployments/x') === true);

  const s5 = await 띄우기((q, res) => {
    const u = new URL(q.url, 'http://127.0.0.1');
    const 맞나 = u.pathname === '/openai/v1/models';
    res.writeHead(맞나 ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(맞나 ? { data: [{ id: 'gpt-4o' }] } : { error: { message: '없음' } }));
  });
  const b5 = `http://127.0.0.1:${s5.address().port}`;
  allowEndpoint([origin, b5]);
  const r = await detect(`${b5}/openai/v1`, 'key-1');
  check('/openai/v1 짜리 창구는 예전 길로 붙는다', r.kind === 'openai' && r.models?.[0]?.id === 'gpt-4o',
    JSON.stringify({ kind: r.kind, why: r.why }));
  s5.close();
});

// ── 19. 목록은 받았는데 배포가 하나도 없을 때 ─────────────────────────
trace('19-빈목록');
await 재보기('19-빈목록', async () => {
  const 셈 = { n: 0 };
  const s6 = await 띄우기((q, res) => {
    셈.n += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [] }));
  });
  const b6 = `http://127.0.0.1:${s6.address().port}`;
  allowEndpoint([origin, b6]);
  const r = await detect(`${b6}/openai/deployments`, 'key-1');
  check('배포가 없으면 없다고 말한다', r.kind === null && /배포된 모델이 없습니다/.test(r.why ?? ''), r.why);
  check('200 을 받고도 또 두드리지 않는다', 셈.n === 1, `${셈.n}번`);
  s6.close();
});

server.close();
for (const x of 서버들) { try { x.close(); } catch { /* 이미 닫힘 */ } }

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\nAzure 규격 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? D + '  ' + p.note + X : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
