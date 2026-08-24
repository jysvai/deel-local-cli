// 여러 로컬 서버를 한꺼번에 찾아내는지 검증한다.
//
// 로컬 런타임은 하나만 쓰지 않는다. Ollama 로 작은 모델을, LM Studio 로 큰 모델을
// 동시에 띄워 두는 게 보통이다. 그래서 가짜 서버 세 대를 서로 다른 자리에 띄우고
// 훑기가 셋을 다 찾아 규격까지 구분하는지 본다.
import { createServer } from 'node:http';
import { scanLocal, toProfiles } from '../src/backend/scan.js';
import { resetNet } from '../src/safety/network.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const servers = [];
function 서버(handler) {
  const s = createServer((req, res) => {
    const body = handler(req.url);
    if (!body) { res.writeHead(404); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  servers.push(s);
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
}

// 1) Ollama 흉내
const ollamaPort = await 서버((url) => {
  if (url === '/api/version') return { version: '0.5.7' };
  if (url === '/api/tags') {
    return { models: [
      { name: 'qwen2.5-coder:7b', size: 4_700_000_000, details: { parameter_size: '7B' } },
      { name: 'llama3.2:1b', size: 1_300_000_000, details: { parameter_size: '1B' } },
    ] };
  }
  return null;
});

// 2) LM Studio 흉내 — /v1/models 와 LM Studio 만의 /api/v0/models
const lmsPort = await 서버((url) => {
  if (url === '/v1/models') return { data: [{ id: 'devstral-small-2507', owned_by: 'org' }] };
  if (url === '/api/v0/models') return { data: [{ id: 'devstral-small-2507' }] };
  return null;
});

// 3) llama.cpp 흉내 — /props 가 있다
const llamaPort = await 서버((url) => {
  if (url === '/v1/models') return { data: [{ id: 'gemma-3-4b-it' }] };
  if (url === '/props') return { default_generation_settings: { n_ctx: 8192 } };
  return null;
});

resetNet();
const found = await scanLocal({ ports: [ollamaPort, lmsPort, llamaPort], timeout: 2500 });

check('세 대를 모두 찾음', found.length === 3, `${found.length}대`);

const byPort = Object.fromEntries(found.map((f) => [f.port, f]));
const o = byPort[ollamaPort];
const l = byPort[lmsPort];
const c3 = byPort[llamaPort];

check('Ollama 를 Ollama 로 알아봄', o?.runtime === 'Ollama' && o?.kind === 'ollama', o?.runtime);
check('Ollama 판까지 읽음', o?.version === '0.5.7', o?.version);
check('Ollama 모델 2개', o?.models.length === 2, String(o?.models.length));
check('모델 크기를 사람이 읽게', o?.models[0].note.includes('7B') && o?.models[0].note.includes('GB'), o?.models[0].note);

check('LM Studio 를 자국으로 알아봄', l?.runtime === 'LM Studio', l?.runtime);
check('LM Studio 는 OpenAI 호환으로', l?.kind === 'openai' && l?.base.endsWith('/v1'), l?.base);
check('LM Studio 는 추정이 아님', l?.guessed === false);

check('llama.cpp 를 /props 로 알아봄', c3?.runtime === 'llama.cpp', c3?.runtime);

check('빈 포트는 안 잡음', !found.some((f) => ![ollamaPort, lmsPort, llamaPort].includes(f.port)),
  found.map((f) => f.port).join(', '));

// ── 프로필로 바꾸기 ─────────────────────────────────────────────────────
const profiles = toProfiles(found);
check('모델 하나당 프로필 하나', profiles.length === 4, `${profiles.length}개`);
check('이름에 런타임과 모델이 같이', profiles.some((p) => p.name.includes('Ollama') && p.name.includes('qwen2.5-coder')),
  profiles[0]?.name);
check('프로필 id 가 겹치지 않음', new Set(profiles.map((p) => p.id)).size === profiles.length);
check('주소가 서로 다름', new Set(profiles.map((p) => p.baseUrl)).size === 3);
check('로컬 표시가 붙음', profiles.every((p) => p.local === true));

// 이미 있던 설정은 되쓴다 — 키·검증결과를 훑기 한 번에 날리면 안 된다.
const 기존 = [{ id: 'my-ollama', baseUrl: `http://127.0.0.1:${ollamaPort}`, model: 'qwen2.5-coder:7b', apiKey: 'keep-me', tools: true, ctx: 40960 }];
const 다시 = toProfiles(found, 기존);
const 되쓴 = 다시.find((p) => p.model === 'qwen2.5-coder:7b');
check('기존 프로필 id 를 지킴', 되쓴?.id === 'my-ollama', 되쓴?.id);
check('기존 키를 안 날림', 되쓴?.apiKey === 'keep-me');
check('기존에 확인해 둔 능력을 안 날림', 되쓴?.tools === true && 되쓴?.ctx === 40960);

// ── 훑기가 자물쇠를 원래대로 돌려놓는가 ─────────────────────────────────
const { allowed } = await import('../src/safety/network.js');
check('훑고 나면 열어 둔 자리를 다 닫음', allowed().length === 0, allowed().join(', '));

for (const s of servers) { s.closeAllConnections?.(); s.close(); }
await new Promise((r) => setImmediate(r));

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n로컬 서버 훑기 검사  ' + D + '(여러 런타임을 한꺼번에 찾아 구분하는가)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
