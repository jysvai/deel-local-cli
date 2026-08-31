// 천장에 닿아 잘렸을 때 그렇다고 말하는가.
//
// ── 왜 이걸 재나 ────────────────────────────────────────────────────────
//
// 답 길이 상한에는 절대 천장이 있다(effort.js 의 MAX_CAP = 16,384). 컨텍스트를
// 200k 로 맞춰 놔도 한 번에 낼 수 있는 답은 거기서 끝난다. 상한도 못 올리고
// 생각도 이미 바닥이면 우리가 더 해 줄 것이 없다.
//
// 그런데 여태 그 자리를 **조용히** 끝냈다. 화면에는 중간에서 끊긴 답만 남는다.
// 사람 눈에는 모델이 게을러서 대충 답한 것으로 보이니 같은 것을 다시 시키고,
// 같은 자리에서 또 잘린다. 몇 분씩 가는 로컬 모델에서 이 왕복은 비싸다.
//
// 그래서 재는 것은 하나다 — **잘렸으면 잘렸다고, 손댈 자리와 함께 말하는가.**
// 그리고 그 반대도 같은 무게로 잰다: 아직 올릴 자리가 남았으면 이 말을 하면
// 안 된다. 멀쩡한 답마다 경고가 붙으면 사람은 그 경고를 곧 안 읽는다.
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/agent/loop.js';
import { Session } from '../src/agent/session.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { MAX_CAP, wasCut } from '../src/agent/effort.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 서버들 = [];
async function 띄우기(handler) {
  const s = createServer(handler);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  서버들.push(s);
  return `http://127.0.0.1:${s.address().port}/v1`;
}

/**
 * 언제나 "길이에서 잘렸다" 고 답하는 가짜 게이트웨이.
 *
 * 받은 max_tokens 를 적어 둔다 — 루프가 상한을 올려 다시 부르는지를
 * 화면 글자가 아니라 **나간 몸통**으로 가리려는 것이다.
 */
function 늘잘리는게이트웨이(받은상한) {
  return (q, res) => {
    let body = '';
    q.on('data', (d) => (body += d));
    q.on('end', () => {
      try { 받은상한.push(JSON.parse(body).max_tokens ?? null); } catch { 받은상한.push(null); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: '여기까지 쓰다가 끊' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }));
    });
  };
}

function 판깔기(base, { ctx, maxTokens = null, think = 'off' }) {
  const root = mkdtempSync(join(tmpdir(), 'deel-cap-'));
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx, maxTokens };
  const session = new Session(conn, { root, think });
  return {
    session,
    ctx: {
      scope: makeScope(root), history: new History(root), audit: new Audit(root),
      seen: new Set(), 모드: 'auto',
    },
  };
}

async function 돌리기(옵션) {
  const 받은상한 = [];
  const base = await 띄우기(늘잘리는게이트웨이(받은상한));
  resetNet();
  allowEndpoint(서버들.map((s) => `http://127.0.0.1:${s.address().port}/v1`));
  const { session, ctx } = 판깔기(base, 옵션);
  const 이벤트 = [];
  for await (const ev of run(session, ctx, '긴 파일 하나 써줘')) 이벤트.push(ev);
  return { 이벤트, 받은상한 };
}

trace('1-천장');

// ── 1. 천장에 닿았으면 말한다 ──────────────────────────────────────────
{
  /*
   * 컨텍스트가 크면 아낀 상한도 풀어 준 상한도 둘 다 같은 천장(16,384)에 닿는다.
   * 그래서 더 올릴 자리가 없다 — **큰 모델을 쓰는 바로 그 사람**이 이 자리를 만난다.
   */
  const { 이벤트, 받은상한 } = await 돌리기({ ctx: 200000, think: 'off' });
  const 천장말 = 이벤트.find((e) => e.type === 'capped');

  check('★ 천장에서 잘리면 잘렸다고 말한다', !!천장말, JSON.stringify(이벤트.map((e) => e.type)));
  check('얼마에서 잘렸는지 숫자를 준다', 천장말?.cap === MAX_CAP, `${천장말?.cap} · 천장 ${MAX_CAP}`);
  check('사람이 정한 상한이 아니라고 구분한다', 천장말?.정한값 === null, JSON.stringify(천장말?.정한값));
  // 못 올리는 자리에서 또 부르면 같은 데서 또 잘린다. 그건 그냥 낭비다.
  check('올릴 자리가 없으면 다시 부르지 않는다', 받은상한.length === 1, `${받은상한.length}번 부름`);
  check('보낸 상한이 천장이었다', 받은상한[0] === MAX_CAP, String(받은상한[0]));
}

trace('2-올릴자리있으면');

// ── 2. 아직 올릴 자리가 있으면 이 말을 하면 안 된다 ────────────────────
{
  /*
   * 작은 컨텍스트에서는 아낀 상한(work 0.35)과 풀어 준 상한(0.8)이 다르다.
   * 그러면 루프가 상한을 올려 한 번 더 부르는 것이 먼저다. 그때까지 경고를
   * 띄우면 안 된다 — 멀쩡한 답마다 경고가 붙으면 곧 아무도 안 읽는다.
   */
  const { 이벤트, 받은상한 } = await 돌리기({ ctx: 8000, think: 'off' });
  const 순서 = 이벤트.map((e) => e.type);

  check('★ 올릴 자리가 있으면 먼저 올려 다시 부른다', 이벤트.some((e) => e.type === 'retry'), JSON.stringify(순서));
  check('두 번째는 더 큰 상한으로 나간다',
    받은상한.length >= 2 && 받은상한[1] > 받은상한[0], JSON.stringify(받은상한));
  // 올려서 다시 불렀는데 또 잘렸으면, 그때는 말해 줘야 맞다.
  check('그러고도 잘리면 그때는 말한다', 이벤트.some((e) => e.type === 'capped'), JSON.stringify(순서));
  const 천장말 = 이벤트.find((e) => e.type === 'capped');
  check('두 번째 상한 기준으로 말한다', 천장말 && 천장말.cap === 받은상한[1], `${천장말?.cap} · ${받은상한[1]}`);
}

trace('3-사람이정한값');

// ── 3. 사람이 직접 정해 둔 상한이면 그렇다고 말한다 ────────────────────
{
  /*
   * `/out 4k` 로 낮춰 둔 사람에게 "더 못 올리는 천장입니다" 는 거짓말이다.
   * 그 사람은 제가 정한 값을 올리면 된다 — 할 일이 다르니 말도 달라야 한다.
   */
  const { 이벤트 } = await 돌리기({ ctx: 200000, maxTokens: 4096, think: 'off' });
  const 천장말 = 이벤트.find((e) => e.type === 'capped');
  check('★ 사람이 정한 상한도 잘리면 말한다', !!천장말, JSON.stringify(이벤트.map((e) => e.type)));
  check('사람이 정한 값이라고 알려 준다', 천장말?.정한값 === 4096, String(천장말?.정한값));
  check('그 값에서 잘렸다고 말한다', 천장말?.cap === 4096, String(천장말?.cap));
}

trace('4-안잘렸으면');

// ── 4. 안 잘렸으면 아무 말도 없다 ──────────────────────────────────────
{
  const 받은상한 = [];
  const base = await 띄우기((q, res) => {
    let body = '';
    q.on('data', (d) => (body += d));
    q.on('end', () => {
      받은상한.push(1);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: '다 썼습니다.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }));
    });
  });
  allowEndpoint(서버들.map((s) => `http://127.0.0.1:${s.address().port}/v1`));
  const { session, ctx } = 판깔기(base, { ctx: 200000 });
  const 이벤트 = [];
  for await (const ev of run(session, ctx, '한 마디만')) 이벤트.push(ev);
  check('★ 멀쩡히 끝난 답에는 경고가 없다', !이벤트.some((e) => e.type === 'capped'),
    JSON.stringify(이벤트.map((e) => e.type)));
  check('다시 부르지도 않는다', 받은상한.length === 1, `${받은상한.length}번`);
}

trace('5-잘림판정');

// ── 5. 무엇을 '잘렸다' 로 보나 ─────────────────────────────────────────
{
  check('length 면 잘린 것', wasCut({ stopped: 'length' }));
  check('stop 은 안 잘린 것', !wasCut({ stopped: 'stop' }));
  // 인자 JSON 이 깨진 것 자체가 잘렸다는 증거다 — 모델은 반쪽 JSON 을 일부러 안 만든다.
  check('깨진 도구 인자도 잘린 것으로 본다', wasCut({ stopped: 'stop', toolCalls: [{ argsBroken: true }] }));
  check('멀쩡한 도구 호출은 아니다', !wasCut({ stopped: 'stop', toolCalls: [{ name: 'Read' }] }));
}

for (const s of 서버들) s.close();
resetNet();

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n답 길이 천장 검사  ${D}(잘렸으면 잘렸다고 말하는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
