// 일하는 도중에 낀 말 (steering) — src/agent/loop.js 의 끼어들기.
//
// ── 왜 이걸 재나 ───────────────────────────────────────────────────────
//
// 로컬 모델은 한 턴이 몇 분씩 간다. 그 사이에 "아, 그건 말고 저거" 라고 쳐도
// 여태는 **턴이 끝날 때까지** 기다렸다. 사람이 할 수 있는 것은 Ctrl+C 로
// 지금까지 한 것을 통째로 버리는 것뿐이었다.
//
// 그래서 재는 것은 하나다 — **그 말이 다음 부름에 실제로 실려 나가는가.**
// 화면에 「낀 말」이라고 찍히기만 하고 모델에게 안 가면, 사람은 방향을 튼
// 줄 알고 기다리다가 원래 하던 것을 끝까지 보게 된다. 그게 제일 나쁘다.
//
// 그래서 가짜 게이트웨이가 **받은 몸통**으로 잰다. 화면 글자가 아니라.
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
 * 두 걸음 도는 가짜 게이트웨이.
 *
 * 첫 부름에는 도구를 하나 쓰라고 하고, 그 다음부터는 그냥 끝낸다.
 * 그래서 「걸음 사이」가 실제로 생긴다 — 낀 말이 들어갈 자리다.
 */
function 두걸음게이트웨이(받은몸통) {
  return (q, res) => {
    let body = '';
    q.on('data', (d) => (body += d));
    q.on('end', () => {
      받은몸통.push(body);
      const 처음인가 = 받은몸통.length === 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: 처음인가
            ? { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: 'a.txt' }) } }] }
            : { content: '끝냈습니다.' },
          finish_reason: 처음인가 ? 'tool_calls' : 'stop',
        }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      }));
    });
  };
}

function 판깔기(base) {
  const root = mkdtempSync(join(tmpdir(), 'deel-steer-'));
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 8000 };
  const session = new Session(conn, { root });
  const ctx = {
    scope: makeScope(root), history: new History(root), audit: new Audit(root),
    seen: new Set(), 모드: 'auto',
  };
  return { root, session, ctx };
}

// ── 1. ★ 낀 말이 다음 부름에 실려 나간다 ──────────────────────────────
trace('1-실려나간다');
{
  const 받은몸통 = [];
  const base = await 띄우기(두걸음게이트웨이(받은몸통));
  resetNet(); allowEndpoint(base);
  const { session, ctx } = 판깔기(base);

  let 남은것 = ['그건 말고 로그부터 봐줘'];
  const 이벤트 = [];
  for await (const ev of run(session, ctx, '이 파일 고쳐줘', {
    끼어들기: () => 남은것.shift() ?? null,
  })) 이벤트.push(ev);

  check('두 번 이상 부른다 (걸음 사이가 생긴다)', 받은몸통.length >= 2, `${받은몸통.length}번`);
  check('★ 낀 말이 두 번째 부름에 실려 나간다',
    /그건 말고 로그부터 봐줘/.test(받은몸통[1] ?? ''), (받은몸통[1] ?? '').slice(0, 120));
  check('첫 부름에는 없었다 (그때는 아직 안 쳤으니)',
    !/그건 말고 로그부터/.test(받은몸통[0] ?? ''), '첫 부름에 미리 들어갔습니다');
  check('★ 낀 말을 화면에도 알린다', 이벤트.some((e) => e.type === 'steer' && /로그부터/.test(e.text)),
    JSON.stringify(이벤트.filter((e) => e.type === 'steer')));

  // 대화에도 사람 말로 남아야 한다 — 다음 턴에서도 그 지시가 살아 있어야 한다.
  const 사람말 = session.messages.filter((m) => m.role === 'user').map((m) => String(m.content ?? ''));
  check('★ 대화에 사람 말로 남는다', 사람말.some((t) => /로그부터/.test(t)), JSON.stringify(사람말));
  check('원래 시킨 말도 그대로 남는다', 사람말.some((t) => /이 파일 고쳐줘/.test(t)), JSON.stringify(사람말));
}

// ── 2. 안 쳤으면 아무 일도 없다 ───────────────────────────────────────
trace('2-안쳤을때');
{
  const 받은몸통 = [];
  const base = await 띄우기(두걸음게이트웨이(받은몸통));
  allowEndpoint(서버들.map((s) => `http://127.0.0.1:${s.address().port}/v1`));
  const { session, ctx } = 판깔기(base);

  const 이벤트 = [];
  for await (const ev of run(session, ctx, '이 파일 고쳐줘', { 끼어들기: () => null })) 이벤트.push(ev);
  check('안 쳤으면 낀 말 알림이 없다', !이벤트.some((e) => e.type === 'steer'));
  check('안 쳤으면 사람 말이 하나뿐이다',
    session.messages.filter((m) => m.role === 'user').length === 1,
    String(session.messages.filter((m) => m.role === 'user').length));

  // 끼어들기를 아예 안 줘도 돌아야 한다 (ACP·oneshot 이 그렇게 부른다).
  const { session: s2, ctx: c2 } = 판깔기(base);
  const 이벤트2 = [];
  for await (const ev of run(s2, c2, '고쳐줘')) 이벤트2.push(ev);
  check('끼어들기를 안 줘도 안 터진다', 이벤트2.length > 0, String(이벤트2.length));
}

// ── 3. 도구 답 사이를 안 가른다 ───────────────────────────────────────
trace('3-모양');
{
  /*
   * 도구를 부르고 그 답이 붙기 전에 사람 말이 끼면 대화 모양이 깨져서
   * 게이트웨이가 400 을 준다. 걸음의 머리에서만 넣는 까닭이다.
   *
   * 나간 몸통을 그대로 읽어서, tool 답 바로 앞에 user 가 끼지 않았는지 본다.
   */
  const 받은몸통 = [];
  const base = await 띄우기(두걸음게이트웨이(받은몸통));
  allowEndpoint(서버들.map((s) => `http://127.0.0.1:${s.address().port}/v1`));
  const { session, ctx } = 판깔기(base);

  let 남은것 = ['한 마디', '두 마디'];
  for await (const ev of run(session, ctx, '고쳐줘', { 끼어들기: () => 남은것.shift() ?? null })) void ev;

  const 마지막 = JSON.parse(받은몸통[받은몸통.length - 1]);
  const 차례 = 마지막.messages.map((m) => m.role);
  // tool 은 언제나 assistant(도구 부름) 바로 뒤에 붙어야 한다.
  const 깨진자리 = 차례.findIndex((r, i) => r === 'tool' && 차례[i - 1] !== 'assistant' && 차례[i - 1] !== 'tool');
  check('★ 도구 부름과 그 답 사이에 사람 말이 안 낀다', 깨진자리 < 0, 차례.join(' → '));
  check('낀 말은 도구 답이 다 붙은 뒤에 온다',
    차례.lastIndexOf('user') > 차례.lastIndexOf('tool'), 차례.join(' → '));
}

// ── 4. 큐에서 빼 간다 (같은 말이 두 번 안 나가게) ────────────────────
trace('4-큐');
{
  /*
   * repl.js 쪽 셈법을 그대로 흉내낸다. 넘기고 큐에도 남기면 턴이 끝난 뒤
   * 같은 말이 한 번 더 나간다 — 사람은 두 번 시킨 적이 없다.
   */
  const queue = ['/mode strict', '로그부터 봐줘', '/undo'];
  const 끼어들기 = () => {
    const i = queue.findIndex((x) => !String(x ?? '').trimStart().startsWith('/'));
    if (i < 0) return null;
    const [것] = queue.splice(i, 1);
    return String(것).trim() || null;
  };
  check('★ 슬래시 명령은 안 건넨다 (설정이 턴 한가운데서 바뀌면 안 된다)',
    끼어들기() === '로그부터 봐줘', JSON.stringify(queue));
  check('★ 건넨 것은 큐에서 빠진다 (두 번 안 나간다)',
    !queue.includes('로그부터 봐줘') && queue.length === 2, JSON.stringify(queue));
  check('슬래시 명령은 큐에 그대로 남는다 (턴 끝나고 처리)',
    queue.join('|') === '/mode strict|/undo', JSON.stringify(queue));
  check('남은 것이 명령뿐이면 더 안 건넨다', 끼어들기() === null, JSON.stringify(queue));
}

for (const s of 서버들) s.close();
resetNet();

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n도중에 낀 말 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
