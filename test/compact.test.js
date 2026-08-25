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

/*
 * 컨텍스트 16,000.
 *
 * 전에는 8,000이었는데, 그 크기에서는 이 검사가 **접기로 풀 수 없는 것**을
 * 재고 있었다. 대화가 한 줄도 없어도 시스템 프롬프트 967 + 도구 정의 1,951 =
 * 2,918토큰이 이미 나간다. 8,000이면 그게 36%다. 접기는 대화만 줄일 수 있으니
 * 아무리 잘 접어도 그 아래로는 못 내려간다.
 *
 * 그 사실 자체는 아래 '고정 몫' 절에서 따로 잰다. 여기서는 접기가 제 일을
 * 하는지만 본다.
 */
const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 16000, streaming: false };

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

// ── 접어도 못 줄이는 몫 ─────────────────────────────────────────────────
//
// 접기는 **대화만** 줄인다. 시스템 프롬프트와 도구 정의는 매 요청에 통째로
// 다시 나가므로 접어도 그대로다. 그 고정 몫이 창의 절반을 넘으면, 아무리 잘
// 접어도 남는 자리가 없다 — 사람 눈에는 "모델이 갑자기 멍청해졌다" 로 보인다.
//
// 그래서 그 몫이 얼마인지를 **숫자로 못 박아 둔다.** 프롬프트에 한 줄 더할
// 때마다 이 값이 오르고, 작은 모델에서 먼저 티가 난다.
{
  const 잰것 = (ctx) => {
    const s = new Session({ ...conn, ctx }, { root: process.cwd() });
    const b = s.breakdown();
    return { 고정: b.used, 비율: b.used / ctx };
  };

  const 큰것 = 잰것(131072);
  check('고정 몫이 큰 모델에서는 티가 안 난다', 큰것.비율 < 0.05,
    `${큰것.고정}토큰 = ${Math.round(큰것.비율 * 100)}%`);

  // 8k 는 로컬에서 흔히 쓰는 제일 작은 크기다. 여기서 절반을 넘으면 못 쓴다.
  const 작은것 = 잰것(8192);
  check('8k 모델에서도 고정 몫이 절반은 안 넘는다', 작은것.비율 < 0.5,
    `${작은것.고정}토큰 = ${Math.round(작은것.비율 * 100)}%`);

  // 여기가 울타리다. 지금 31% 다.
  //
  // 한 번 빨개진 적이 있다. 도구를 셋(Outline·Verify·Task) 더하면서 4,045토큰,
  // 49% 까지 갔다. 그때 도구를 뺄까 하다가 안 뺐다 — 빼면 8k 모델만 할 수 있는
  // 일이 달라져서, 사용자가 피하려던 "환경마다 다르게 동작" 이 된다.
  // 대신 **설명을 창에 맞춰 줄였다** (budget.js 의 설명길이, session.js 의
  // 짧은 기본 규칙). 도구 이름과 인자는 그대로라 할 수 있는 일은 똑같다.
  check('고정 몫이 2,800토큰을 안 넘는다', 작은것.고정 < 2800,
    `${작은것.고정}토큰 (프롬프트를 늘리면 여기가 먼저 빨개진다)`);

  /*
   * 반대쪽도 막아 둔다.
   *
   * 줄이기가 큰 창에까지 먹으면, 좋은 모델이 "이 도구를 왜 쓰는지" 를 못 읽는다.
   * Outline 을 Read 앞에 부르게 만드는 것이 그 두 문장이라, 그게 사라지면
   * 큰 모델이 오히려 예전처럼 파일을 통째로 읽기 시작한다.
   */
  const 큰창고정 = 잰것(131072).고정;
  check('큰 창에서는 설명을 안 줄인다', 큰창고정 > 작은것.고정 * 1.4,
    `8k ${작은것.고정} → 131k ${큰창고정}토큰`);
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n자동 압축 검사  ' + D + '(차면 요약해 접고 계속 이어 가는가)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
// process.exit 로 끊으면 윈도우에서 닫히는 중인 서버 핸들 때문에 libuv 가 소리를 낸다.
// 종료 코드만 세워 두고 이벤트 루프가 스스로 비도록 둔다.
process.exitCode = fail.length ? 1 : 0;
