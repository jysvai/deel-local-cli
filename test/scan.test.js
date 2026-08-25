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
// listening:false — 이 검사는 띄운 세 대만 봐야 한다. 이 PC 에 떠 있는 다른 것이
// 끼어들면 결과가 컴퓨터마다 달라진다. 훑기 자체는 아래에서 따로 본다.
const 내포트 = [ollamaPort, lmsPort, llamaPort];
const 훑은것 = await scanLocal({ ports: 내포트, timeout: 2500, listening: false });

/*
 * `ports` 는 **더 볼 자리**이지 볼 자리 전부가 아니다 — 알려진 자리(11434 · 1234 ·
 * 8080 …)는 언제나 같이 본다. `deel scan --ports 9000` 이 그렇게 동작해야 하고
 * README 에도 '추가로 볼 포트' 라고 적혀 있다.
 *
 * 그래서 이 검사는 **내가 띄운 세 대만** 골라 놓고 본다. 전에는 안 그랬고,
 * 이 PC 에서 LM Studio 가 1234 를 잡고 있던 날 네 대가 잡혀 무너졌다 —
 * 검사가 사람 컴퓨터에 무엇이 떠 있느냐에 따라 달라지면 안 된다.
 * (겸사겸사 검사가 남의 서버를 두드리지도 않게 된다.)
 */
const found = 훑은것.filter((f) => 내포트.includes(f.port));

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

// 알려준 세 자리는 하나도 안 빠뜨렸고, 그 밖에 잡힌 것은 전부 이 PC 에 진짜로
// 떠 있는 서버다(아무 답도 없는 자리를 '찾았다' 고 하지는 않는다).
check('알려준 자리를 하나도 안 빠뜨림', 내포트.every((p) => 훑은것.some((f) => f.port === p)),
  훑은것.map((f) => f.port).join(', '));
check('찾았다는 것은 전부 답을 한 자리', 훑은것.every((f) => f.base && (f.models?.length ?? 0) >= 0),
  훑은것.map((f) => `${f.port}:${f.runtime}`).join(', '));

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

// ── 알려지지 않은 자리의 서버도 찾는가 ──────────────────────────────────
//
// 알려진 포트 13곳만 두드리면 직접 세운 프록시나 사내 게이트웨이를 못 찾는다.
// 그런 것들은 아무 포트나 쓰고, /v1 이 아닌 앞머리를 쓰기도 한다.
// 그래서 이 컴퓨터에서 실제로 듣고 있는 자리도 같이 본다.
{
  resetNet();
  // /v1/models 는 없고 /api/v1/models 만 있는 서버 — 프록시에 흔한 모양
  const 프록시 = createServer((req, res) => {
    if (req.url === '/api/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'gw-qwen-32b' }, { id: 'gw-llama-70b' }] }));
    }
    res.writeHead(404); res.end('nope');
  });
  servers.push(프록시);
  const 프록시포트 = await new Promise((r) => 프록시.listen(0, '127.0.0.1', () => r(프록시.address().port)));

  const t0 = Date.now();
  // ports 로 알려주지 않는다. 스스로 찾아야 한다.
  const 훑음 = await scanLocal({ timeout: 1200 });
  const 걸린시간 = Date.now() - t0;

  const 잡힘 = 훑음.find((f) => f.port === 프록시포트);
  check('안 알려준 자리의 서버를 찾아낸다', !!잡힘, `자리 ${훑음.훑은자리}곳 훑음`);
  check('/v1 이 아닌 앞머리도 찾는다', 잡힘?.base?.endsWith('/api/v1'), 잡힘?.base ?? '없음');
  check('모델 목록까지 가져온다', 잡힘?.models?.length === 2, (잡힘?.models ?? []).map((m) => m.id).join(', '));
  check('무엇인지 이름을 붙인다', typeof 잡힘?.runtime === 'string' && 잡힘.runtime.length > 0, 잡힘?.runtime ?? '');

  // HTTP 로 답하지 않는 자리에서 시간 초과를 기다리면 훑기가 몇 분이 된다.
  // 실제로 이 PC 에는 파일 공유·RPC 같은 자리가 여럿 열려 있다.
  check('열린 자리가 많아도 빨리 끝난다', 걸린시간 < 20000, `${(걸린시간 / 1000).toFixed(1)}초 · ${훑음.훑은자리}곳`);
  check('안 본 자리가 있으면 알려준다', Array.isArray(훑음.안본자리), String(훑음.안본자리?.length ?? '없음'));

  // 끄고 싶을 때 끌 수 있어야 한다.
  resetNet();
  const 안훑음 = await scanLocal({ ports: [], timeout: 800, listening: false });
  check('listening:false 면 안 훑는다', !안훑음.some((f) => f.port === 프록시포트), `${안훑음.length}대 찾음`);
}

// 듣고 있는 포트를 실제로 알아내는가
{
  const { listeningPorts } = await import('../src/backend/scan.js');
  const p = listeningPorts();
  check('듣고 있는 포트를 알아낸다', Array.isArray(p) && p.length > 0, `${p.length}개`);
  check('포트 번호가 말이 된다', p.every((x) => Number.isInteger(x) && x > 0 && x < 65536), p.slice(0, 6).join(', '));
  check('정렬되어 있다', p.every((x, i) => i === 0 || p[i - 1] <= x), '');
}

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
