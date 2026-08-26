// 컨텍스트가 차면 요약해서 접고 계속 이어 가는지 검증한다.
//
// 여기서 확인해야 하는 것은 "줄었다" 가 아니다. 줄이는 건 그냥 지워도 된다.
// 확인할 것은 (1) 도구 호출과 결과의 짝이 안 깨졌는가 (깨지면 서버가 400 을 낸다)
//            (2) 접은 뒤에도 처음 시킨 일과 요약이 남아 있는가
//            (3) 요약을 못 받아도 프로그램이 멈추지 않는가
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/agent/session.js';
import { compact, shouldCompact, split, safeCut, COMPACT_AT, foldToolResults, shouldFold, FOLD_AT, 접힘표 } from '../src/agent/compact.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { discover } from '../src/skills/discover.js';

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
  /*
   * **빈 폴더**에서 잰다.
   *
   * 전에는 process.cwd() 로 쟀는데, 폴더 지문(agent/project.js)이 생기면서
   * 그 값이 **이 저장소의 생김새**를 따라 움직이게 됐다. 위쪽에 파일을 하나
   * 더하거나 package.json 에 스크립트를 하나 넣으면 이 숫자가 오른다 —
   * 프롬프트를 한 글자도 안 건드렸는데 말이다.
   *
   * 그러면 이 검사가 무슨 말을 하는지가 흐려진다. 여기서 재려는 것은
   * '프롬프트와 도구 정의가 얼마인가' 이지 '이 폴더에 파일이 몇 개인가' 가
   * 아니다. 그래서 바닥값은 빈 폴더에서 재고, 폴더 지문이 그 위에 얼마를
   * 얹는지는 바로 아래에서 따로 못 박는다.
   */
  const 빈폴더 = mkdtempSync(join(tmpdir(), 'deel-고정몫-'));
  const 잰것 = (ctx, root = 빈폴더) => {
    const s = new Session({ ...conn, ctx }, { root });
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
   * 품고 다니는 스킬까지 얹어서 다시 잰다.
   *
   * 위 숫자는 **스킬이 하나도 없는** 세션이다. Session 은 skills = [] 로
   * 시작하고 repl 이 켜질 때 채우기 때문에, 여기서는 그 몫이 아예 안 잡혔다.
   * 전에는 그래도 됐다 — 스킬은 그 PC 에 있는 것이라 없을 수도 있었으니까.
   *
   * 그런데 이제 여섯 남짓을 패키지에 품고 다닌다(src/skills/builtin).
   * 늘 실리는 것이 됐으니 **늘 실리는 몫**으로 재야 한다. 안 그러면 이 검사가
   * 2,713 이라고 말하는데 실제로는 3,000 을 넘는 일이 생긴다 —
   * 울타리가 있는데 울타리 밖에서 재는 꼴이다.
   */
  {
    const 내장든것 = new Session({ ...conn, ctx: 8192 }, { root: 빈폴더 });
    내장든것.skills = discover(빈폴더, { home: 빈폴더 }).skills;
    const 고정 = 내장든것.breakdown().used;
    const 얹힌것 = 고정 - 작은것.고정;
    check('품고 다니는 스킬이 몇 개인지 안다', 내장든것.skills.length >= 5,
      `${내장든것.skills.length}개 · ${내장든것.skills.map((s) => s.name).join(', ')}`);
    // 설명을 길게 쓰면 여기가 먼저 빨개진다. 설명은 '언제 쓰나' 만 적는다.
    check('내장 스킬이 얹는 몫이 400토큰을 안 넘는다', 얹힌것 < 400,
      `${얹힌것}토큰 얹음 (스킬 ${내장든것.skills.length}개)`);
    check('내장까지 얹어도 8k 에서 절반은 안 넘는다', 고정 / 8192 < 0.5,
      `${고정}토큰 = ${Math.round((고정 / 8192) * 100)}%`);
  }

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

  /*
   * 폴더 지문이 그 위에 얼마를 얹는가.
   *
   * 이것도 접히지 않는 고정 몫이다. 값을 하기는 한다 — 모델이 켜자마자
   * 밟던 세 걸음(Glob·package.json·검사 돌리는 법)을 안 밟아도 된다.
   * 그래도 8k 에서 100토큰이 넘어가면 아껴 준 걸음보다 먹는 자리가 커진다.
   *
   * 여기는 **이 저장소 자신**으로 잰다. 실제로 사람이 켜는 자리가 이런 폴더다.
   */
  const 지문값 = 잰것(8192, process.cwd()).고정 - 작은것.고정;
  check('폴더 지문은 8k 에서 150토큰 안쪽', 지문값 > 0 && 지문값 < 150,
    `${지문값}토큰 (빈 폴더 ${작은것.고정} → 이 저장소 ${작은것.고정 + 지문값})`);

  rmSync(빈폴더, { recursive: true, force: true });
}

// ── 요약하기 전에 도구 결과부터 접는가 ─────────────────────────────────
//
// 자리를 먹는 것은 대개 사람 말이 아니라 옛날에 읽어 둔 파일이다. 요약 압축은
// 사람 말과 모델의 판단까지 세 줄로 줄이므로, 그 전에 잃는 것이 적은 쪽부터
// 비운다.
//
// 여기서 재는 것 넷:
//   1) 짝이 안 깨지는가 — 지우는 게 아니라 내용만 바꾸므로 원래 안 깨져야 한다
//   2) 최근 것은 남는가 — 방금 읽은 것을 접으면 그 자리에서 다시 읽는다
//   3) 두 번 돌려도 같은 것을 또 세지 않는가
//   4) 무엇이었는지는 남는가 — 모델이 다시 읽으려면 경로를 알아야 한다
{
  const 호출 = (id, 경로) => ({
    role: 'assistant', content: null,
    tool_calls: [{ id, type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: 경로 }) } }],
  });
  const 결과 = (id, 글) => ({ role: 'tool', tool_call_id: id, content: 글 });
  const 긴글 = (n) => 'const x = 1;\n'.repeat(n);

  const s = new Session({ model: 'm', base: 'http://127.0.0.1:1', ctx: 32768, kind: 'openai' }, { root: process.cwd() });
  s.push({ role: 'user', content: '이 폴더 좀 봐줘' });
  for (let i = 1; i <= 7; i++) {
    s.push(호출(`c${i}`, `src/파일${i}.js`));
    s.push(결과(`c${i}`, 긴글(60)));
  }
  s.push({ role: 'user', content: '이제 고쳐줘' });

  /*
   * 도구 결과 몫으로 잰다. 합계로 재면 시스템 프롬프트·도구 정의 같은 고정 몫이
   * 섞여서, 잘 접어도 숫자가 조금밖에 안 움직인다 — 접기가 건드릴 수 없는 값이
   * 분모에 들어 있기 때문이다. 접기가 무슨 일을 했는지는 그 줄에서만 보인다.
   */
  const 결과몫 = (x) => x.breakdown().rows.find((r) => r.label.startsWith('도구 결과'))?.n ?? 0;
  const 접기전 = 결과몫(s);
  const 전체전 = s.breakdown().used;
  const r = foldToolResults(s);

  check('오래된 도구 결과가 접힌다', r.접은것 === 3, `${r.접은것}개 (7개 중 최근 4개는 남겨야 함)`);
  check('도구 결과 몫이 실제로 준다', 결과몫(s) < 접기전 * 0.7,
    `${접기전.toLocaleString()} → ${결과몫(s).toLocaleString()} 토큰`);
  check('아낀 토큰을 세어서 알려 준다', r.아낀토큰 > 0 && Math.abs(r.아낀토큰 - (전체전 - s.breakdown().used)) <= 5,
    `${r.아낀토큰}토큰 · 합계 ${전체전.toLocaleString()} → ${s.breakdown().used.toLocaleString()}`);

  const 결과들 = s.messages.filter((m) => m.role === 'tool');
  check('최근 4개는 원문 그대로', 결과들.slice(-4).every((m) => !m.content.startsWith(접힘표)));
  check('접힌 자리에 무엇을 읽었는지가 남는다', /Read\(src\/파일1\.js\)/.test(결과들[0].content),
    결과들[0].content.slice(0, 60));
  check('사람 말은 한 글자도 안 건드린다',
    s.messages[0].content === '이 폴더 좀 봐줘' && s.messages.at(-1).content === '이제 고쳐줘');

  // 지우는 게 아니라 내용만 바꾸므로 짝은 원래 안 깨진다. 그래도 잰다 —
  // 이게 이 방식을 고른 이유이고, 나중에 '지우는' 쪽으로 바뀌면 여기서 걸린다.
  let 짝깨짐 = null;
  s.messages.forEach((m, i) => {
    if (짝깨짐) return;
    if (m.role === 'tool' && !s.messages[i - 1]?.tool_calls?.length && s.messages[i - 1]?.role !== 'tool') 짝깨짐 = `${i}번`;
  });
  check('접어도 호출·결과 짝이 안 깨진다', 짝깨짐 === null, 짝깨짐 ?? '');

  // 두 번째 부름 — 이미 접은 것을 또 세면 화면에 거짓 숫자가 뜬다.
  const r2 = foldToolResults(s);
  check('이미 접은 것은 다시 안 센다', r2.접은것 === 0, `${r2.접은것}개`);

  // 작은 결과는 접어도 자리가 안 준다. 오히려 무엇을 했는지만 잃는다.
  const t = new Session({ model: 'm', base: 'http://127.0.0.1:1', ctx: 32768, kind: 'openai' }, { root: process.cwd() });
  for (let i = 1; i <= 8; i++) { t.push(호출(`d${i}`, `a${i}.js`)); t.push(결과(`d${i}`, '1군데 고쳤습니다')); }
  check('짧은 결과는 안 접는다', foldToolResults(t).접은것 === 0);

  // 언제 접기 시작하나 — 요약 압축(80%)보다 일찍이어야 미루는 뜻이 있다.
  check('요약 압축보다 먼저 접는다', FOLD_AT < COMPACT_AT, `${FOLD_AT} < ${COMPACT_AT}`);
  const 빈것 = new Session({ model: 'm', base: 'http://127.0.0.1:1', ctx: 32768, kind: 'openai' }, { root: process.cwd() });
  check('한가할 때는 안 접는다', shouldFold(빈것) === false);

  /*
   * 이게 이 기능을 만든 이유다 — **요약 압축을 얼마나 미루는가.**
   *
   * 같은 대화를 두 번 돌린다. 한 번은 접지 않고, 한 번은 차오를 때마다 도구
   * 결과를 접으면서. 요약 압축이 처음 걸리는 턴이 몇 번째인지를 센다.
   * 미루는 동안 대화는 한 글자도 안 잃는다 — 그게 이 숫자의 뜻이다.
   */
  const 굴려보기 = (접나) => {
    const x = new Session({ model: 'm', base: 'http://127.0.0.1:1', ctx: 16000, kind: 'openai' }, { root: process.cwd() });
    x.push({ role: 'user', content: '이 폴더 전체를 훑고 로그 형식을 통일해줘' });
    for (let 턴 = 1; 턴 <= 200; 턴++) {
      x.push(호출(`t${턴}`, `src/파일${턴}.js`));
      x.push(결과(`t${턴}`, 긴글(40)));
      x.push({ role: 'assistant', content: `${턴}번째 파일을 봤습니다.` });
      x.push({ role: 'user', content: '계속' });
      if (접나 && shouldFold(x)) foldToolResults(x);
      if (shouldCompact(x)) return 턴;
    }
    return 200;
  };
  const 안접고 = 굴려보기(false);
  const 접고 = 굴려보기(true);
  check('접으면 요약 압축이 한참 뒤로 밀린다', 접고 >= 안접고 * 2,
    `요약 압축이 처음 걸리는 턴: ${안접고}턴 → ${접고}턴 (${(접고 / 안접고).toFixed(1)}배)`);
}

// ── 추정을 실제에 맞춰 가는가 ───────────────────────────────────────────
//
// estimateTokens 는 추정이다. 서버는 매 응답에 진짜 값을 실어 주는데 여태
// /cost 에만 쓰고 버렸다. 안 맞으면 답이 조용히 잘리거나 창을 놀린다.
//
// 여기서 재는 것은 '보정을 한다' 가 아니라 **틀린 방향으로 안 간다** 이다.
// 자기 값을 되먹여 스스로 부풀거나, 서버가 딴 것을 세고 있을 때 따라가면
// 지금보다 나빠진다.
{
  const 만들기 = () => {
    const s = new Session({ model: 'm', base: 'http://127.0.0.1:1', ctx: 32768, kind: 'openai' },
      { root: process.cwd() });
    // 재기에 충분한 만큼 채운다 (200토큰 아래는 표본이 작아 일부러 안 배운다).
    for (let i = 0; i < 12; i++) s.push({ role: 'user', content: '로그 형식을 통일해 주세요. '.repeat(20) });
    return s;
  };

  const s = 만들기();
  const 처음 = s.breakdown().used;
  check('배우기 전에는 추정 그대로', s.보정 === 1 && s.보정잰것 === 0);

  // 서버가 "실제로는 20% 더 많았다" 고 알려 준 셈.
  s.배운다(Math.round(처음 * 1.2));
  check('실제값을 받으면 보정이 붙는다', Math.abs(s.보정 - 1.2) < 0.01, `보정 ${s.보정?.toFixed(3)}`);
  check('보정이 화면 숫자에 먹는다', Math.abs(s.breakdown().used - 처음 * 1.2) / 처음 < 0.02,
    `${처음} → ${s.breakdown().used}`);
  check('줄을 더한 값과 합계가 맞는다',
    s.breakdown().rows.reduce((a, r) => a + r.n, 0) === s.breakdown().used);
  check('남은 자리도 같이 줄어든다', s.breakdown().left === 32768 - s.breakdown().used);

  // 되먹임 방어 — 같은 실제값을 계속 줘도 보정이 계속 자라면 안 된다.
  // (견주는 값으로 보정 먹인 추정을 쓰면 매번 1.2배씩 커진다. 실제로 겪기 쉬운 실수다.)
  const 한번 = s.보정;
  for (let i = 0; i < 5; i++) s.배운다(Math.round(처음 * 1.2));
  check('같은 값을 다시 줘도 안 부푼다', Math.abs(s.보정 - 한번) < 0.01, `${한번.toFixed(3)} → ${s.보정.toFixed(3)}`);

  // 못 믿을 값은 안 배운다.
  const t = 만들기();
  t.배운다(0); t.배운다(null); t.배운다(-5); t.배운다('몰라');
  check('실제값을 안 주는 서버에서는 안 배운다', t.보정잰것 === 0 && t.보정 === 1);
  t.배운다(t.breakdown().used * 9);
  check('말도 안 되는 값은 안 따라간다', t.보정잰것 === 0, `보정 ${t.보정}`);

  // 표본이 작으면 비율이 튄다.
  const u = new Session({ model: 'm', base: 'http://127.0.0.1:1', ctx: 32768, kind: 'openai' }, { root: process.cwd() });
  const 작은지 = u.breakdown().used < 200;
  if (작은지) {
    u.배운다(50);
    check('표본이 작으면 건너뛴다', u.보정잰것 === 0);
  } else {
    check('표본이 작으면 건너뛴다', true, '이 저장소에서는 빈 대화도 200토큰이 넘어 못 잼');
  }

  // 한 번 튄 값에 휘둘리지 않는다 — 두 번째부터는 천천히 따라간다.
  const v = 만들기();
  const v처음 = v.breakdown().used;
  v.배운다(Math.round(v처음 * 1.0));
  v.배운다(Math.round(v.breakdown().used / v.보정 * 1.5));
  check('한 번 튄 값을 통째로 안 믿는다', v.보정 > 1.05 && v.보정 < 1.25, `보정 ${v.보정.toFixed(3)}`);
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n자동 압축 검사  ' + D + '(차면 요약해 접고 계속 이어 가는가)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
// process.exit 로 끊으면 윈도우에서 닫히는 중인 서버 핸들 때문에 libuv 가 소리를 낸다.
// 종료 코드만 세워 두고 이벤트 루프가 스스로 비도록 둔다.
process.exitCode = fail.length ? 1 : 0;
