// 컨텍스트가 차면 요약해서 접고 계속 이어 가는지 검증한다.
//
// 여기서 확인해야 하는 것은 "줄었다" 가 아니다. 줄이는 건 그냥 지워도 된다.
// 확인할 것은 (1) 도구 호출과 결과의 짝이 안 깨졌는가 (깨지면 서버가 400 을 낸다)
//            (2) 접은 뒤에도 처음 시킨 일과 요약이 남아 있는가
//            (3) 요약을 못 받아도 프로그램이 멈추지 않는가
import { createServer } from 'node:http';
import { Session } from '../src/agent/session.js';
import { compact, shouldCompact, split, safeCut, COMPACT_AT } from '../src/agent/compact.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 가짜 게이트웨이 ─────────────────────────────────────────────────────
let mode = 'ok';
let 받은요약요청 = null;
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (mode === 'dead') { res.writeHead(500); return res.end('{}'); }
    const j = JSON.parse(body || '{}');
    받은요약요청 = j;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: '## 목표\n로그 형식 통일\n\n## 한 일\nsrc/runner.js 의 console.log 를 log.info 로 바꿈\n\n## 알아낸 것\n로거는 src/log.js 에 있음\n\n## 정한 것\nconsole.log 는 쓰지 않기로 함\n\n## 남은 일\nsrc/worker.js 가 남음',
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 800, completion_tokens: 120 },
    }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/v1`;
resetNet();
allowEndpoint(base);

const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 8000, streaming: false };

// 도구 호출 짝이 들어 있는 긴 대화를 만든다.
function 대화만들기(turns) {
  const out = [{ role: 'user', content: '이 폴더에서 로그 형식 통일해줘' }];
  for (let i = 0; i < turns; i++) {
    out.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: `src/f${i}.js` }) } }] });
    out.push({ role: 'tool', tool_call_id: `c${i}`, name: 'Read', content: '가'.repeat(600) });
    out.push({ role: 'assistant', content: `${i}번째 파일을 봤습니다. ` + '나'.repeat(200) });
    out.push({ role: 'user', content: '계속' });
  }
  return out;
}

// ── 1. 자르는 자리가 짝을 안 깬다 ───────────────────────────────────────
const 짝 = [
  { role: 'user', content: 'a' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'x' }] },
  { role: 'tool', tool_call_id: 'x', content: 'r' },
  { role: 'assistant', content: 'b' },
];
check('tool 결과에서 자르지 않음', 짝[safeCut(짝, 2)]?.role !== 'tool');
check('자를 자리가 없으면 그대로', safeCut(짝, 0) === 0);
check('끝에서 자르기', safeCut(짝, 4) === 4);

// ── 2. 실제로 접는다 ────────────────────────────────────────────────────
mode = 'ok';
const s = new Session(conn, { root: process.cwd() });
s.messages = 대화만들기(12);
const 첫요청 = s.messages[0].content;
const before = s.breakdown();
check('접기 전에 이미 가득 참', shouldCompact(s, COMPACT_AT), `${Math.round(before.used / before.total * 100)}%`);

const r = await compact(s);
check('접기 성공', r.ok, r.why ?? '');
check('실제로 줄어듦', r.after < r.before, `${r.before} → ${r.after}`);
check('절반 아래로 줄어듦', r.after < r.before * 0.5, `${Math.round(r.after / r.before * 100)}% 남음`);
check('처음 시킨 일이 남아 있음', s.messages[0].content === 첫요청);
check('요약이 대화에 들어감', s.messages.some((m) => String(m.content).includes('로그 형식 통일')));
check('요약에 파일 경로가 남음', s.messages.some((m) => String(m.content).includes('src/runner.js')));
check('남은 일도 남음', s.messages.some((m) => String(m.content).includes('src/worker.js')));

// 짝 검사 — 접은 뒤 배열이 규격을 지키는가
let 짝깨짐 = null;
for (let i = 0; i < s.messages.length; i++) {
  const m = s.messages[i];
  if (m.role === 'tool') {
    const prev = s.messages[i - 1];
    const 앞에호출 = prev && (prev.tool_calls?.length || prev.role === 'tool');
    if (!앞에호출) { 짝깨짐 = `${i}번째 tool 앞에 호출이 없음`; break; }
  }
  if (m.tool_calls?.length) {
    const next = s.messages[i + 1];
    if (!next || next.role !== 'tool') { 짝깨짐 = `${i}번째 호출 뒤에 결과가 없음`; break; }
  }
}
check('도구 호출·결과 짝이 안 깨짐', 짝깨짐 === null, 짝깨짐 ?? '');
check('요약 요청에 사고를 안 씀', 받은요약요청?.reasoning_effort === 'low', String(받은요약요청?.reasoning_effort));

// ── 3. 접은 뒤 계속 쌓아도 또 접힌다 ────────────────────────────────────
s.messages.push(...대화만들기(10));
check('다시 차오름', shouldCompact(s));
const r2 = await compact(s);
check('두 번째도 접힘', r2.ok && r2.after < r2.before, `${r2.before} → ${r2.after}`);
check('접은 뒤 여유가 생김', !shouldCompact(s),
  `${Math.round(s.breakdown().used / s.breakdown().total * 100)}%`);

// ── 4. 모델이 죽어도 멈추지 않는다 ──────────────────────────────────────
mode = 'dead';
const s3 = new Session(conn, { root: process.cwd() });
s3.messages = 대화만들기(12);
const r3 = await compact(s3);
check('요약 실패해도 던지지 않음', typeof r3 === 'object');
check('실패하면 그냥 줄이기로 물러섬', r3.fallback === true && r3.after < r3.before,
  `${r3.before} → ${r3.after}`);

// ── 5. 접을 게 없으면 조용히 넘어간다 ───────────────────────────────────
mode = 'ok';
const s4 = new Session(conn, { root: process.cwd() });
s4.messages = [{ role: 'user', content: '안녕' }];
const r4 = await compact(s4);
check('짧은 대화는 안 접음', !r4.ok && r4.folded === 0);
check('짧은 대화는 그대로', s4.messages.length === 1);
check('split 이 null 을 돌려줌', split(s4.messages) === null);

server.closeAllConnections?.();
server.close();
await new Promise((r) => setImmediate(r));

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n자동 압축 검사  ' + D + '(차면 요약해 접고 계속 이어 가는가)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
// process.exit 로 끊으면 윈도우에서 닫히는 중인 서버 핸들 때문에 libuv 가 소리를 낸다.
// 종료 코드만 세워 두고 이벤트 루프가 스스로 비도록 둔다.
process.exitCode = fail.length ? 1 : 0;
