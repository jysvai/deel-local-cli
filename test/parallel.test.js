// 읽기 도구를 동시에 돌리는 것과 할 일 목록을 검증한다.
//
// 병렬은 빨라지는 게 목적이지만, 확인해야 할 것은 속도가 아니라 안전이다.
//   1) 파일을 바꾸는 도구는 절대 같이 안 돌아야 한다
//   2) 결과가 호출 순서대로 돌아와야 한다 (뒤섞이면 모델이 헷갈린다)
//   3) 하나가 실패해도 나머지가 살아야 한다
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 묶기 } from '../src/agent/loop.js';
import { run } from '../src/agent/loop.js';
import { Session } from '../src/agent/session.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { runTool } from '../src/tools/index.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 1. 덩어리 나누기 ────────────────────────────────────────────────────
const c = (name) => ({ id: 'x', name, args: {} });

let g = 묶기([c('Read'), c('Read'), c('Grep')]);
check('읽기끼리는 한 덩어리', g.length === 1 && g[0].parallel && g[0].calls.length === 3,
  JSON.stringify(g.map((x) => x.calls.length)));

g = 묶기([c('Read'), c('Write'), c('Read')]);
check('쓰기가 끼면 갈라짐', g.length === 3, JSON.stringify(g.map((x) => `${x.parallel}:${x.calls.length}`)));
check('쓰기는 혼자 돎', g[1].parallel === false && g[1].calls[0].name === 'Write');

g = 묶기([c('Write'), c('Edit'), c('Bash')]);
check('바꾸는 것끼리도 안 묶임', g.length === 3 && g.every((x) => !x.parallel));

g = 묶기([c('Read'), c('Glob'), c('Bash'), c('Grep'), c('WebFetch')]);
check('앞뒤로 갈라 묶음', g.length === 3
  && g[0].calls.length === 2 && g[1].calls[0].name === 'Bash' && g[2].calls.length === 2,
  JSON.stringify(g.map((x) => x.calls.map((y) => y.name))));

check('빈 목록은 빈 결과', 묶기([]).length === 0);

// ── 2. 진짜로 동시에 도는가 ─────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'deel-par-'));
for (const n of ['a', 'b', 'c']) writeFileSync(join(root, `${n}.txt`), `${n} 내용\n`.repeat(50), 'utf8');

let 호출순 = 0;
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (호출순++ === 0) {
      return res.end(JSON.stringify({
        choices: [{
          message: {
            content: null,
            tool_calls: ['a', 'b', 'c'].map((n, i) => ({
              id: `t${i}`, type: 'function',
              function: { name: 'Read', arguments: JSON.stringify({ file_path: `${n}.txt` }) },
            })),
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }));
    }
    res.end(JSON.stringify({
      choices: [{ message: { content: '다 읽었습니다.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/v1`;
resetNet();
allowEndpoint(base);

const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 32768, streaming: false, tools: true };
const s = new Session(conn, { root });
const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
ctx.history.nextTurn();

const 시작들 = [];
const 묶음시작 = [];
const 결과들 = [];
for await (const ev of run(s, ctx, '세 파일 읽어줘')) {
  if (ev.type === 'tool_start') 시작들.push(ev.name);
  if (ev.type === 'tools_start') 묶음시작.push(ev);
  if (ev.type === 'tool') 결과들.push(ev);
}

// 같이 도는 것은 하나씩 알리지 않는다 — 이름 셋이 먼저 뜨고 결과 셋이 뒤에 몰리면
// 화면에서 어느 결과가 어느 파일 것인지 읽을 수 없다.
check('묶음으로 한 번만 알림', 묶음시작.length === 1 && 묶음시작[0].count === 3,
  `묶음 ${묶음시작.length}회 · ${묶음시작[0]?.count}개`);
check('낱개 시작 알림은 안 옴', 시작들.length === 0, `${시작들.length}개`);
check('묶음에 이름이 들어 있음',
  JSON.stringify(묶음시작[0]?.names) === JSON.stringify(['Read', 'Read', 'Read']),
  JSON.stringify(묶음시작[0]?.names));
check('동시 실행으로 표시됨', 결과들.every((r) => r.parallel === true), JSON.stringify(결과들.map((r) => r.parallel)));
check('결과가 호출 순서대로', 결과들.map((r) => r.args.file_path).join(',') === 'a.txt,b.txt,c.txt',
  결과들.map((r) => r.args.file_path).join(','));
check('세 개 다 읽힘', 결과들.every((r) => !r.result.error), JSON.stringify(결과들.map((r) => r.result.error)));

// 대화 이력의 짝도 맞아야 한다
const 호출수 = s.messages.filter((m) => m.tool_calls?.length).flatMap((m) => m.tool_calls).length;
const 결과수 = s.messages.filter((m) => m.role === 'tool').length;
check('호출 수와 결과 수가 같음', 호출수 === 결과수 && 호출수 === 3, `호출 ${호출수} · 결과 ${결과수}`);

// ── 3. 하나가 실패해도 나머지는 산다 ────────────────────────────────────
{
  const ctx2 = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
  const rs = await Promise.all([
    runTool('Read', { file_path: 'a.txt' }, ctx2),
    runTool('Read', { file_path: '없는파일.txt' }, ctx2),
    runTool('Read', { file_path: 'c.txt' }, ctx2),
  ]);
  check('하나 실패해도 나머지 성공', !rs[0].error && !!rs[1].error && !rs[2].error,
    JSON.stringify(rs.map((r) => (r.error ? '실패' : '성공'))));
}

// ── 4. 할 일 목록 ───────────────────────────────────────────────────────
{
  const ctx3 = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
  const T = (todos) => runTool('TodoWrite', { todos }, ctx3);

  let r = await T([
    { text: '로그 형식 통일', state: 'doing' },
    { text: '테스트 고치기', state: 'todo' },
    { text: '문서 갱신', state: 'todo' },
  ]);
  check('목록이 만들어짐', !r.error, r.error ?? '');
  check('진행 상황을 셈', r.summary === '0/3 완료', r.summary);
  check('목록이 글로 나옴', r.content.includes('▶ 로그 형식 통일') && r.content.includes('☐ 테스트 고치기'),
    r.content.split('\n')[0]);

  r = await T([
    { text: '로그 형식 통일', state: 'done' },
    { text: '테스트 고치기', state: 'doing' },
    { text: '문서 갱신', state: 'todo' },
  ]);
  check('끝난 것을 셈', r.summary.startsWith('1/3 완료'), r.summary);
  check('방금 끝난 것을 알려줌', r.summary.includes('방금 1개'), r.summary);
  check('ctx 에 남아 다음 턴에 이어짐', ctx3.todos?.length === 3);

  const bad = await T([
    { text: '가', state: 'doing' },
    { text: '나', state: 'doing' },
  ]);
  check('진행 중 둘은 거절', !!bad.error && bad.error.includes('하나만'), bad.error ?? '통과해 버림');

  check('빈 목록 거절', !!(await T([])).error);

  // Claude Code 식 이름(status/content, in_progress/completed)도 받아 준다
  const 다른이름 = await runTool('TodoWrite', {
    todos: [{ content: '가', status: 'completed' }, { content: '나', status: 'in_progress' }],
  }, ctx3);
  check('다른 이름 표기도 받아줌', !다른이름.error && 다른이름.summary.startsWith('1/2'),
    다른이름.error ?? 다른이름.summary);
}

server.closeAllConnections?.();
server.close();
rmSync(root, { recursive: true, force: true });
await new Promise((r) => setImmediate(r));

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n병렬 실행·할 일 목록 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
