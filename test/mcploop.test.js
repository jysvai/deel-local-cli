// MCP 도구가 **에이전트 루프를 지나** 실제로 불리는가 — src/agent/loop.js 의 앞거르기 관문들.
//
// ── 왜 이걸 재나 ───────────────────────────────────────────────────────
//
// mcp.test.js 는 runTool 을 곧바로 부른다. 그래서 루프 앞거르기의 「모르는 도구」 관문
// (TOOLS 표에 이름이 있나)이 MCP 이름을 늘 거절하고 있어도 초록이었다. 목록에는 붙은
// 서버의 도구가 실려 나가고, 모델이 그걸 부르면 「모르는 도구입니다」 만 돌아갔다.
//
// 거꾸로 모드 관문은 `mcp__` 이름을 통째로 봐줬다. 묻기·계획 모드는 MCP 도구를 목록에
// 안 싣는데(남의 서버가 무엇을 바꿀지 모른다), 이름으로 부르면 그냥 돌았다.
//
// 둘 다 2.0.0 2차 리뷰가 짚은 자리를 따라가다 찾았다. 그래서 가짜 게이트웨이와 가짜 서버로
// **서버가 실제로 불렸나**를 잰다. 화면 글이 아니라.
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

/** 첫 부름에 `부름` 도구를 쓰라고 하고, 그다음은 끝내는 가짜 게이트웨이. */
async function 띄우기(부름) {
  let 몇번 = 0;
  const 받은몸통 = [];
  const s = createServer((q, res) => {
    let body = '';
    q.on('data', (d) => (body += d));
    q.on('end', () => {
      몇번 += 1;
      받은몸통.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: 몇번 === 1
            ? { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 부름, arguments: JSON.stringify({ q: '인코딩' }) } }] }
            : { content: '끝냈습니다.' },
          finish_reason: 몇번 === 1 ? 'tool_calls' : 'stop',
        }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      }));
    });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  서버들.push(s);
  return { base: `http://127.0.0.1:${s.address().port}/v1`, 받은몸통 };
}

/** backend/mcp.js 의 붙은 서버와 같은 모양. 불린 것을 적어 둔다. */
function 가짜MCP() {
  const 불린것 = [];
  return {
    불린것,
    이름: 'wiki',
    도구: [{ name: 'search', description: '사내 위키 검색', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }],
    살아있나: () => true,
    쓸수있나: () => true,
    부르기: async (도구, args) => { 불린것.push({ 도구, args }); return { text: `찾은 것: ${args?.q}` }; },
  };
}

async function 돌리기(work, 부름 = 'mcp__wiki__search') {
  const { base, 받은몸통 } = await 띄우기(부름);
  resetNet(); allowEndpoint(base);
  const root = mkdtempSync(join(tmpdir(), 'deel-mcploop-'));
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 16000 };
  const session = new Session(conn, { root, work });
  const 서버 = 가짜MCP();
  session.mcp = [서버];
  const ctx = {
    scope: makeScope(root), history: new History(root), audit: new Audit(root),
    seen: new Set(), 모드: 'auto', mcp: [서버],
  };
  for await (const ev of run(session, ctx, '위키에서 인코딩 찾아줘', { 끼어들기: () => null })) void ev;
  const 결과 = String(session.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'c1')?.content ?? '');
  return { 서버, 결과, 받은몸통 };
}

trace('1-코드모드');
{
  const r = await 돌리기('code');
  check('  코드 모드에는 MCP 도구가 실려 나간다', (r.받은몸통[0] ?? '').includes('mcp__wiki__search'), '');
  check('★★★ 모델이 부른 MCP 도구가 루프를 지나 실제로 불린다', r.서버.불린것.length === 1,
    `${r.서버.불린것.length}번 · ${r.결과.slice(0, 80)}`);
  check('★★ 서버의 답이 결과로 실린다', /찾은 것: 인코딩/.test(r.결과), r.결과.slice(0, 120));
}

trace('2-묻기모드');
{
  const r = await 돌리기('ask');
  check('  묻기 모드에는 MCP 도구를 안 싣는다', !(r.받은몸통[0] ?? '').includes('mcp__wiki__search'), '');
  check('★★★ 안 실은 MCP 도구를 이름으로 불러도 안 돈다', r.서버.불린것.length === 0, `${r.서버.불린것.length}번`);
  check('★ 모드에서 못 쓴다고 말한다', /모드/.test(r.결과), r.결과.slice(0, 120));
}

trace('3-없는MCP이름');
{
  // 붙은 서버 이름에 없는 도구를 지어 부르면 「모르는 도구」 로 막고 헛돌기 셈에 넣는다(3회차).
  // 모드 관문만 보면 MCP 를 실어 보낸 걸음에서는 지어낸 이름도 서버까지 가고, 셈을 비켜 계속 부른다.
  const r = await 돌리기('code', 'mcp__wiki__nope');
  check('★★ 목록에 없는 MCP 이름은 서버까지 안 간다', r.서버.불린것.length === 0, `${r.서버.불린것.length}번`);
  check('★ 모르는 도구라고 말한다', /모르는 도구/.test(r.결과), r.결과.slice(0, 120));
}

for (const s of 서버들) s.close();

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\nMCP 도구 루프 관문 검사  ${D}(붙은 서버의 도구가 실제로 불리나 · 읽기 전용 모드에서는 안 불리나)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
