// 컨텍스트 길이를 서버에서 제대로 알아내는가.
//
// 이 숫자 하나가 프로그램 전체 크기를 정한다. 작게 잡히면 파일을 몇 개 못 읽히고,
// 대화가 금방 접히고, 답 길이 상한도 같이 줄어든다. 그런데 화면에는 아무 표시도
// 안 뜬다 — 그냥 조용히 작아진다. 그래서 서버 종류별로 실제 응답 모양을 만들어
// 하나씩 확인한다.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeCtx, parseSize, fmtSize, 기본값 } from '../src/backend/ctxsize.js';
import { allowEndpoint } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

trace('1-숫자읽기');

// ── 사람이 치는 대로 받는가 ─────────────────────────────────────────────
//
// 655360 을 손으로 치면 자릿수를 틀린다. 그래서 655k 를 받는다.
for (const [넣은것, 나올것] of [
  ['32768', 32768],
  ['655360', 655360],
  // k 는 1024 다. 컨텍스트 길이는 죄다 2의 거듭제곱이라 그래야 아귀가 맞는다 —
  // 655,360 은 '655k' 가 아니라 640k 다. 화면에도 640k 로 적어 그걸 알려 준다.
  ['640k', 655360],
  ['640K', 655360],
  ['128k', 131072],
  ['32k', 32768],
  ['1m', 1048576],
  ['262,144', 262144],
  [' 128k ', 131072],
]) {
  check(`'${넣은것}' → ${나올것}`, parseSize(넣은것) === 나올것, String(parseSize(넣은것)));
}

// 말이 안 되는 값은 안 받는다. 받아 버리면 매 요청이 조용히 실패한다.
for (const 나쁜것 of ['', 'abc', '0', '12', '-500', '99999999999', 'k', '1.2.3', null, undefined]) {
  check(`'${나쁜것}' 은 안 받는다`, parseSize(나쁜것) === null, String(parseSize(나쁜것)));
}

check('33k 로 줄여 적는다', fmtSize(32768) === '32k', fmtSize(32768));
check('655k 로 줄여 적는다', fmtSize(655360) === '640k', fmtSize(655360));
check('1.0M 로 줄여 적는다', fmtSize(1048576) === '1.0M', fmtSize(1048576));
check('기본값은 32768', 기본값 === 32768, String(기본값));

trace('2-서버모양별');

// ── 서버 종류별로 실제 응답 모양을 흉내 내 본다 ─────────────────────────
//
// 전부 이 컴퓨터 안(127.0.0.1)에서만 돈다. 밖으로 나가는 연결은 없다.
async function 띄우기(handler) {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (ch) => (body += ch));
    req.on('end', () => {
      let parsed = null;
      try { parsed = body ? JSON.parse(body) : null; } catch {}
      const r = handler(req.url.split('?')[0], parsed);
      if (!r) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, port: srv.address().port };
}

const 상황들 = [
  {
    이름: 'LM Studio — 모델 최대와 올린 길이가 다름',
    handler: (url) => {
      if (url === '/api/v0/models/qwen') {
        return { id: 'qwen', max_context_length: 655360, loaded_context_length: 32768 };
      }
      return null;
    },
    기대: { value: 32768, max: 655360, loaded: 32768 },
    왜: '올려 둔 길이가 실제로 보낼 수 있는 값이다. 최대를 믿고 보내면 거절당한다.',
  },
  {
    이름: 'LM Studio — 최대까지 올려 둠',
    handler: (url) => (url === '/api/v0/models'
      ? { data: [{ id: 'qwen', max_context_length: 655360, loaded_context_length: 655360 }] }
      : null),
    기대: { value: 655360, max: 655360, loaded: 655360 },
  },
  {
    이름: 'vLLM — 목록 안의 max_model_len',
    handler: (url) => (url === '/v1/models'
      ? { object: 'list', data: [{ id: 'qwen', object: 'model', max_model_len: 262144 }] }
      : null),
    기대: { value: 262144, max: 262144 },
  },
  {
    이름: 'llama.cpp — /props 의 n_ctx',
    handler: (url) => (url === '/props'
      ? { default_generation_settings: { n_ctx: 131072 }, total_slots: 1 }
      : null),
    기대: { value: 131072, max: 131072, loaded: 131072 },
  },
  {
    이름: '모델 상세 — context_window',
    handler: (url) => (url === '/v1/models/qwen' ? { id: 'qwen', context_window: 200000 } : null),
    기대: { value: 200000, max: 200000 },
  },
  {
    이름: '깊이 박아 둔 max_position_embeddings',
    handler: (url) => (url === '/v1/models/qwen'
      ? { id: 'qwen', meta: { config: { max_position_embeddings: 655360 } } }
      : null),
    기대: { value: 655360, max: 655360 },
    왜: '게이트웨이가 모델 config 를 그대로 물려 주는 경우가 있다.',
  },
  {
    이름: '아무 데도 안 알려 주는 서버',
    handler: (url) => (url === '/v1/models' ? { data: [{ id: 'qwen', object: 'model' }] } : null),
    기대: { value: null },
    왜: '없으면 없다고 해야 한다. 지어내면 매 요청이 조용히 실패한다.',
  },
  {
    이름: '말이 안 되는 값은 무시',
    handler: (url) => (url === '/v1/models/qwen' ? { id: 'qwen', context_length: 8 } : null),
    기대: { value: null },
    왜: '8 은 토큰 수가 아니라 다른 뜻이다. 그대로 쓰면 아무것도 못 보낸다.',
  },
];

for (const 상황 of 상황들) {
  const { srv, port } = await 띄우기(상황.handler);
  const base = `http://127.0.0.1:${port}/v1`;
  allowEndpoint(base);
  const r = await probeCtx({ kind: 'openai', base, auth: 'none', key: '', model: 'qwen' }, { timeout: 4000 });
  const 맞나 = Object.entries(상황.기대).every(([k, v]) => r[k] === v);
  check(상황.이름, 맞나, 맞나 ? (상황.왜 ?? '') : `받은 것 value=${r.value} max=${r.max} loaded=${r.loaded}`);
  srv.close();
}

trace('3-Ollama');

{
  const { srv, port } = await 띄우기((url) => (url === '/api/show'
    ? { model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 262144 } }
    : null));
  const base = `http://127.0.0.1:${port}`;
  allowEndpoint(base);
  const r = await probeCtx({ kind: 'ollama', base, auth: 'none', key: '', model: 'qwen3' }, { timeout: 4000 });
  check('Ollama — 이름이 앞에 붙은 context_length 도 찾는다', r.value === 262144, String(r.value));
  srv.close();
}

trace('4-명령');

// ── /ctx 명령이 실제로 값을 바꾸고 남기는가 ─────────────────────────────
{
  const home = mkdtempSync(join(tmpdir(), 'deel-ctx-home-'));
  const root = mkdtempSync(join(tmpdir(), 'deel-ctx-root-'));
  process.env.DEEL_HOME = home;

  const { srv, port } = await 띄우기((url) => (url === '/api/v0/models/qwen'
    ? { id: 'qwen', max_context_length: 655360, loaded_context_length: 655360 }
    : null));
  const base = `http://127.0.0.1:${port}/v1`;
  allowEndpoint(base);

  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 'p',
    profiles: [{ id: 'p', name: 'p', kind: 'openai', baseUrl: base, auth: 'none', apiKey: '', model: 'qwen', ctx: 32768 }],
  }));

  const { handle } = await import('../src/commands.js');
  const { Session } = await import('../src/agent/session.js');
  const { load } = await import('../src/config.js');

  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'qwen', ctx: 32768 };
  const s = new Session(conn, { root });

  const 조용히 = async (fn) => {
    const 원래 = process.stdout.write.bind(process.stdout);
    let 모인것 = '';
    process.stdout.write = (chunk) => { 모인것 += chunk; return true; };
    try { await fn(); return 모인것; } finally { process.stdout.write = 원래; }
  };

  const out1 = await 조용히(() => handle('/ctx', s, {}));
  check('/ctx 는 지금 값을 보여 준다', /32,768/.test(out1), out1.slice(0, 60));
  check('/ctx 는 값을 바꾸지 않는다', s.conn.ctx === 32768, String(s.conn.ctx));

  await 조용히(() => handle('/ctx 655360', s, {}));
  check('/ctx 655360 이 먹는다', s.conn.ctx === 655360, String(s.conn.ctx));
  check('프로필에도 남는다', load().profiles[0].ctx === 655360, String(load().profiles[0].ctx));

  await 조용히(() => handle('/ctx 128k', s, {}));
  check('/ctx 128k 도 먹는다', s.conn.ctx === 131072, String(s.conn.ctx));

  const out2 = await 조용히(() => handle('/ctx 열두개', s, {}));
  check('못 읽는 값은 안 바꾼다', s.conn.ctx === 131072, String(s.conn.ctx));
  check('못 읽었다고 말해 준다', /못 읽었습니다/.test(out2), '');

  s.conn.ctx = 32768;
  await 조용히(() => handle('/ctx auto', s, {}));
  check('/ctx auto 가 서버 값으로 맞춘다', s.conn.ctx === 655360, String(s.conn.ctx));

  // 답 길이는 다른 축이다 — 컨텍스트를 건드리면 안 된다.
  await 조용히(() => handle('/ctx out 32k', s, {}));
  check('/ctx out 은 답 길이만 바꾼다', s.conn.maxTokens === 32768, String(s.conn.maxTokens));
  check('/ctx out 이 컨텍스트를 안 건드린다', s.conn.ctx === 655360, String(s.conn.ctx));

  // 이 값이 실제로 답 길이 상한 계산에 쓰이는가. 안 쓰이면 바꿔 봐야 소용없다.
  const { tokensFor } = await import('../src/agent/effort.js');
  const 좁을때 = tokensFor('save', 'work', { ctx: 8192, used: 0 });
  const 넓을때 = tokensFor('save', 'work', { ctx: 655360, used: 0 });
  check('컨텍스트가 커지면 답 상한도 커진다', 넓을때 > 좁을때, `${좁을때} → ${넓을때}`);

  srv.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}

trace('5-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n컨텍스트 길이 검사  ${D}(모델에 걸린 값을 제대로 찾아 쓰는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
