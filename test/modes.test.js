// 작업 모드 검증.
//
// 확인해야 할 것은 '모드가 바뀌었다' 가 아니다. 바꿔 봐야 실제로 달라지지
// 않으면 아무 의미가 없다. 그래서 세 가지를 본다.
//
//   1) 읽기만 하는 모드에서는 파일을 바꾸는 도구가 모델에게 아예 안 간다
//   2) 모드에 따라 생각의 배분과 걸음 수가 실제로 달라진다
//   3) 사용자가 직접 정한 값은 모드가 덮지 않는다
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODES, ORDER, normalize, get, next, canWrite, allow } from '../src/agent/modes.js';
import { toolSchemas } from '../src/tools/index.js';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { effortFor } from '../src/agent/effort.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 1. 이름 알아듣기 ────────────────────────────────────────────────────
check('영문 이름', normalize('architect') === 'architect');
check('한글 이름', normalize('계획') === 'plan');
check('다른 한글 이름', normalize('플랜') === 'plan');
check('줄임말', normalize('d') === 'debug');
check('대소문자 무시', normalize('CODE') === 'code');
check('모르는 이름은 null', normalize('없는모드') === null);
check('빈 값도 null', normalize('') === null);

// ── 2. 차례로 돌리기 (Shift+Tab) ────────────────────────────────────────
{
  const 돈것 = [];
  let cur = 'code';
  for (let i = 0; i < ORDER.length; i++) { 돈것.push(cur); cur = next(cur); }
  check('여섯 모드를 다 거침', new Set(돈것).size === ORDER.length, 돈것.join('→'));
  check('한 바퀴 돌면 제자리', cur === 'code', cur);
}

// ── 3. 읽기 전용 모드에는 바꾸는 도구가 없다 ────────────────────────────
const 바꾸는것 = ['Write', 'Edit', 'Bash'];
for (const id of ORDER) {
  const 이름들 = toolSchemas(null, { hasSkills: true, web: true, work: id })
    .map((t) => t.function.name);
  const 있는바꾸는것 = 이름들.filter((n) => 바꾸는것.includes(n));

  if (canWrite(id)) {
    check(`${MODES[id].name}: 바꾸는 도구가 있다`, 있는바꾸는것.length === 3, 있는바꾸는것.join(','));
  } else {
    check(`${MODES[id].name}: 바꾸는 도구가 없다`, 있는바꾸는것.length === 0,
      있는바꾸는것.length ? `새어 나감: ${있는바꾸는것.join(',')}` : '');
  }
  check(`${MODES[id].name}: Read 는 언제나 있다`, 이름들.includes('Read'), 이름들.join(','));
}

check('계획 모드에 TodoWrite 는 있다',
  toolSchemas(null, { work: 'plan' }).map((t) => t.function.name).includes('TodoWrite'));
check('묻기 모드에는 TodoWrite 도 없다',
  !toolSchemas(null, { work: 'ask' }).map((t) => t.function.name).includes('TodoWrite'));

// 없는 것을 만들어 주지는 않는다 — 오프라인이면 웹 도구는 모드와 무관하게 없다
check('오프라인이면 모드와 무관하게 웹 도구 없음',
  !toolSchemas(null, { web: false, work: 'ask' }).map((t) => t.function.name).includes('WebFetch'));

check('allow 는 있는 것 중에서만 고른다',
  allow('code', ['Read', '없는도구']).join(',') === 'Read',
  allow('code', ['Read', '없는도구']).join(','));

// ── 4. 모드가 생각의 배분과 걸음 수를 실제로 바꾼다 ─────────────────────
check('계획은 깊게', get('plan').effort === 'deep');
check('코드는 아껴서', get('code').effort === 'save');
check('디버그는 걸음이 넉넉', get('debug').steps > get('ask').steps,
  `${get('debug').steps} vs ${get('ask').steps}`);
check('총괄이 가장 넉넉', get('orchestrator').steps === Math.max(...ORDER.map((k) => MODES[k].steps)));

// ── 5. 진짜 루프에서 확인 ───────────────────────────────────────────────
// 가짜 게이트웨이가 받은 요청을 그대로 들여다본다. 프롬프트가 아니라
// 실제로 보낸 도구 목록을 본다 — 부탁이 아니라 사실이어야 한다.
const 받은것 = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    받은것.push(JSON.parse(body || '{}'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: '알겠습니다.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/v1`;
resetNet();
allowEndpoint(base);

const root = mkdtempSync(join(tmpdir(), 'deel-mode-'));
const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 32768, streaming: false, tools: true };
const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
ctx.history.nextTurn();

async function 한턴(work, opts = {}) {
  받은것.length = 0;
  const s = new Session(conn, { root, work, ...opts });
  for await (const _ of run(s, ctx, '해줘')) { /* 흘려보낸다 */ }
  return { body: 받은것[0], s };
}

{
  const { body } = await 한턴('plan');
  const 이름들 = (body?.tools ?? []).map((t) => t.function.name);
  check('계획 모드로 실제 보낸 요청에 Write 없음', !이름들.includes('Write'), 이름들.join(','));
  check('계획 모드로 실제 보낸 요청에 Bash 없음', !이름들.includes('Bash'), 이름들.join(','));
  const sys = body?.messages?.[0]?.content ?? '';
  check('시스템 프롬프트에 지금 모드가 적힘', sys.includes('계획'), sys.slice(0, 60));
}

{
  const { body } = await 한턴('code');
  const 이름들 = (body?.tools ?? []).map((t) => t.function.name);
  check('코드 모드로 실제 보낸 요청에 Write 있음', 이름들.includes('Write'), 이름들.join(','));
}

// ── 6. 사용자가 직접 정한 값은 모드가 안 덮는다 ─────────────────────────
// 보낸 값은 원래 강도가 아니라 '단계별로 보정된' 값이다. effort.js 가 첫 판단을
// 한 칸 올리기도 하기 때문이다. 그래서 기대값도 같은 셈으로 구한다 —
// 여기서 숫자를 손으로 적으면 배분 규칙이 바뀔 때마다 검사가 거짓말을 한다.
const 보낸강도 = (b) => b?.reasoning_effort ?? b?.think;

{
  // 계획 모드는 think 를 high 로 올리려 한다. 사용자가 low 로 정해 뒀으면 그게 이긴다.
  const s = new Session(conn, { root, work: 'plan', think: 'low' });
  s.thinkSet = true;
  받은것.length = 0;
  for await (const _ of run(s, ctx, '해줘')) { /* */ }
  const 기대 = effortFor('low', get('plan').effort, 'plan');
  check('사용자가 정한 think 가 이긴다', 보낸강도(받은것[0]) === 기대,
    `보냄 ${보낸강도(받은것[0])} · 기대 ${기대}`);
}

{
  // 안 정해 뒀으면 모드가 정한 값이 쓰인다
  const s = new Session(conn, { root, work: 'plan', think: 'low' });
  받은것.length = 0;
  for await (const _ of run(s, ctx, '해줘')) { /* */ }
  const 기대 = effortFor(get('plan').think, get('plan').effort, 'plan');
  check('안 정했으면 모드 값이 쓰인다', 보낸강도(받은것[0]) === 기대,
    `보냄 ${보낸강도(받은것[0])} · 기대 ${기대}`);
}

{
  // 위 둘이 실제로 다른 값이어야 의미가 있다. 같으면 검사가 아무것도 안 지킨 것이다.
  const 정한것 = effortFor('low', get('plan').effort, 'plan');
  const 모드것 = effortFor(get('plan').think, get('plan').effort, 'plan');
  check('두 경우가 실제로 다르다', 정한것 !== 모드것, `${정한것} vs ${모드것}`);
}

server.closeAllConnections?.();
server.close();
await new Promise((r) => setImmediate(r));
rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n작업 모드 검사  ${D}(바꾸면 실제로 달라지는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
