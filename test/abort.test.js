// 생성 중 Ctrl+C 로 끊는 것이 실제로 되는지 검증한다.
//
// 확인할 것:
//   1) 정말 멈추는가 — 흘러오던 것을 더 안 받는가
//   2) 끊은 뒤 대화가 성한가 — 도구 호출만 있고 결과가 없으면 다음에 이어할 수 없다
//   3) 도구를 돌리는 중에 끊으면 남은 도구를 실행하지 않는가
//   4) 끊은 것을 오류로 취급하지 않는가
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 천천히 흘려 보내는 가짜 게이트웨이 ──────────────────────────────────
let 보낸조각 = 0;
let 모드 = 'slow';
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', async () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (모드 === 'tools') {
      // 도구 두 개를 한꺼번에 부른다
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [
        { index: 0, id: 'c1', function: { name: 'Write', arguments: '{"file_path":"one.txt","content":"1"}' } },
        { index: 1, id: 'c2', function: { name: 'Write', arguments: '{"file_path":"two.txt","content":"2"}' } },
      ] } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
      return res.end();
    }
    // 아주 천천히 100조각을 흘린다 — 끊지 않으면 한참 걸린다
    for (let i = 0; i < 100; i++) {
      if (res.writableEnded || res.destroyed) return;
      보낸조각++;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `조각${i} ` } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, 40));
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/v1`;
resetNet();
allowEndpoint(base);

const root = mkdtempSync(join(tmpdir(), 'deel-abort-'));
const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 32768, streaming: true, tools: true };
const 만들기 = () => ({
  scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set(),
});

// ── 1. 흘러오는 중에 끊기 ───────────────────────────────────────────────
모드 = 'slow';
보낸조각 = 0;
{
  const s = new Session(conn, { root });
  const ctx = 만들기();
  ctx.history.nextTurn();
  const ac = new AbortController();
  const 받은 = [];
  let 글자 = 0;

  const t0 = Date.now();
  for await (const ev of run(s, ctx, '길게 답해줘', { signal: ac.signal })) {
    받은.push(ev.type);
    if (ev.type === 'content') {
      글자 += ev.text.length;
      if (글자 > 20) ac.abort();   // 조금 받다가 끊는다
    }
  }
  const 걸린 = Date.now() - t0;

  check('중단 이벤트가 나옴', 받은.includes('aborted'), 받은.join(','));
  check('오류로 취급하지 않음', !받은.includes('error'), 받은.join(','));
  check('끝까지 안 기다림', 걸린 < 3000, `${걸린}ms (안 끊으면 4초 넘음)`);
  check('조각을 다 받지 않음', 보낸조각 < 100, `${보낸조각}/100 조각`);

  // 끊은 뒤 대화가 성한가 — 그대로 이어 보낼 수 있어야 한다
  let 깨짐 = null;
  s.messages.forEach((m, i) => {
    if (깨짐) return;
    if (m.role === 'tool' && !s.messages[i - 1]?.tool_calls?.length) 깨짐 = `${i}번 tool 앞에 호출 없음`;
    if (m.tool_calls?.length && s.messages[i + 1]?.role !== 'tool') 깨짐 = `${i}번 호출 뒤에 결과 없음`;
  });
  check('끊은 뒤 대화가 성함', 깨짐 === null, 깨짐 ?? '');
  check('사용자 말은 남아 있음', s.messages[0]?.content === '길게 답해줘');
}

// ── 2. 시작하자마자 끊기 ────────────────────────────────────────────────
모드 = 'tools';
{
  const s = new Session(conn, { root });
  const ctx = 만들기();
  ctx.history.nextTurn();
  const ac = new AbortController();
  ac.abort();                       // 부르기도 전에 끊긴 상태

  const 받은 = [];
  for await (const ev of run(s, ctx, '파일 두 개 만들어줘', { signal: ac.signal })) 받은.push(ev.type);

  check('처음부터 끊겨 있으면 바로 중단', 받은.includes('aborted'), 받은.join(','));
  check('도구를 실행하지 않음', !existsSync(join(root, 'one.txt')) && !existsSync(join(root, 'two.txt')));
  check('부르기 전이면 채울 것도 없음',
    !s.messages.some((m) => m.role === 'tool'), '결과가 생겼다면 이상하다');
}

// ── 2-1. 도구가 도는 도중에 끊기 — 짝을 채워야 한다 ─────────────────────
// 이게 실제로 일어나는 모양이다. 모델이 도구 두 개를 부르고, 첫 도구가 도는 사이에
// 사용자가 Ctrl+C 를 누른다. 두 번째 호출의 결과 자리가 비면 다음에 이어할 수 없다.
모드 = 'tools';
{
  const root2 = mkdtempSync(join(tmpdir(), 'deel-abort2-'));
  const s = new Session(conn, { root: root2 });
  const ctx = { scope: makeScope(root2), history: new History(root2), audit: new Audit(root2), seen: new Set() };
  ctx.history.nextTurn();
  const ac = new AbortController();

  const 받은 = [];
  for await (const ev of run(s, ctx, '파일 두 개 만들어줘', { signal: ac.signal })) {
    받은.push(ev.type);
    if (ev.type === 'tool') ac.abort();   // 첫 도구가 끝나자마자 끊는다
  }

  check('도구 도는 중 끊으면 중단됨', 받은.includes('aborted'), 받은.join(','));
  check('첫 도구는 이미 돌았다', existsSync(join(root2, 'one.txt')));
  check('둘째 도구는 안 돌았다', !existsSync(join(root2, 'two.txt')));

  const 호출 = s.messages.filter((m) => m.tool_calls?.length).flatMap((m) => m.tool_calls).length;
  const 결과 = s.messages.filter((m) => m.role === 'tool').length;
  check('호출 개수만큼 결과가 채워짐', 호출 === 결과 && 호출 === 2, `호출 ${호출} · 결과 ${결과}`);
  check('안 돈 것에는 이유가 적힘',
    s.messages.some((m) => m.role === 'tool' && String(m.content).includes('중단')),
    JSON.stringify(s.messages.filter((m) => m.role === 'tool').map((m) => String(m.content).slice(0, 30))));
  rmSync(root2, { recursive: true, force: true });
}

// ── 3. 안 끊으면 끝까지 간다 (중단이 늘 도는 게 아님을 확인) ────────────
모드 = 'tools';
{
  const s = new Session(conn, { root });
  const ctx = 만들기();
  ctx.history.nextTurn();
  const 받은 = [];
  for await (const ev of run(s, ctx, '파일 두 개 만들어줘', { signal: null })) {
    받은.push(ev.type);
    if (받은.filter((x) => x === 'tool').length >= 2) break;   // 도구 두 개 돌면 그만
  }
  check('안 끊으면 도구가 실제로 돎', existsSync(join(root, 'one.txt')) && existsSync(join(root, 'two.txt')));
  check('중단 이벤트는 안 나옴', !받은.includes('aborted'), 받은.join(','));
}

server.closeAllConnections?.();
server.close();
rmSync(root, { recursive: true, force: true });
await new Promise((r) => setImmediate(r));

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n생성 중 끊기 검사  ' + D + '(Ctrl+C 로 멈추고, 대화는 성한가)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
