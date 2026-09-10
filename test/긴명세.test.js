// 긴 영어 명세를 통째로 붙여 넣었을 때 어디로 가나.
//
// ── 왜 이 검사가 생겼나 ─────────────────────────────────────────────────
//
// 「빈 폴더에서 웹 앱을 처음부터 만들어라」 는 5,000자짜리 영어 지시문을
// 그대로 붙여 넣어 봤다. 그 안에는 이런 줄이 **명시적으로** 들어 있었다 —
//
//   "Do not stop after producing a plan."
//   "Do not ask the user to choose implementation details."
//
// 그런데 라우터는 그 글을 **계획 모드 + 승인 창**으로 보냈다. 계획을 내고
// 사람에게 물어보며 멈추는 자리다. 시킨 것과 정확히 반대다.
//
// 까닭이 넷이었고 넷 다 서로 달랐다.
//
//   1. 영어 겹침 규칙이 **쉼표**를 이음말로 셌다. 영어에서 쉼표로 이어진
//      동사들은 차례가 아니라 열거다("design, implement, test, verify").
//   2. 「묻지 말라」 규칙이 `don't` 만 알고 `do not` 을 몰랐다. 격식 있는
//      명세는 거의 언제나 띄어 쓴 쪽을 쓴다.
//   3. 「고치라는 말」 규칙이 한국어 어미로만 가려서 영어를 하나도 못 봤다.
//      그래서 읽기 전용 모드가 후보에서 안 빠졌다.
//   4. 5,000자 글에서 **한 번 걸린 낱말**이 모드를 정했다. 그런 글에는 모든
//      모드의 낱말이 한 번씩 나온다 — 그건 뜻이 아니라 소음이다.
//
// 넷 중 하나만 남아도 이 지시문은 잘못된 자리로 간다. 그래서 넷을 따로 잰다.
import { route, 묻지말라했나, 손대라했나, 겹친요청 } from '../src/agent/route.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// 실제로 받은 지시문의 뼈대. 길이와 낱말 분포를 그대로 살린다.
const 명세 = `Full-Project Development Benchmark
You are starting in an empty working directory.
Your task is to independently design, implement, test, verify, and complete a
production-oriented web application entirely from scratch.

1. Strict Workspace Isolation
You must work exclusively inside the current working directory.
Do not inspect, read, search, modify, execute, copy from, or otherwise access files
outside the current working directory.

2. Independent Development
Determine the architecture, technology choices, data model, API structure,
state-management strategy, security approach, testing strategy, and project
organization independently.

3. Autonomous Planning and Execution
Analyze the requirements yourself and create your own implementation plan.
Do not ask the user to choose implementation details.
Do not stop after producing a plan.
Planning is only the beginning of the task.
After planning, continue autonomously through implementation, testing, debugging,
verification, and final review.
If an implementation or test fails, investigate the cause, make the necessary
correction, and continue.

Project
Build a complete Work Request and Approval Management Web Application.
The application should be usable as a real internal business application.

4. Users and Authorization
The system must support Standard User, Approver, Administrator.
Authorization must be enforced by the application itself.

13. Automated Testing
Create meaningful automated tests for the project.
Actually execute the tests.
If a test fails, investigate the cause rather than weakening the test.

17. Final Report Language
The final report must be written in Korean.`;

trace('0-길이');
check('★ 재려는 것이 정말 긴 글이다', 명세.length >= 1500, `${명세.length}자`);

// ── 1. 쉼표 열거를 차례로 읽지 않는다 ───────────────────────────────────
trace('1-쉼표열거');
{
  /*
   * "design, implement, test, verify" 는 「설계하고 나서 만들어라」 가 아니다.
   * 겹침으로 읽으면 계획 모드 + 승인 창으로 가서 계획만 내고 멈춘다.
   */
  check('★★★ 쉼표로 이어진 동사 열거는 겹침이 아니다',
    겹친요청('independently design, implement, test, verify, and complete it').겹침 === false, '');
  check('★★★ 그 지시문 전체도 겹침이 아니다', 겹친요청(명세).겹침 === false,
    JSON.stringify(겹친요청(명세)));

  // 진짜 겹침은 그대로 잡아야 한다. 안 그러면 고친 게 아니라 꺼 버린 것이다.
  check('★★ "plan and then build it" 은 그대로 겹침이다',
    겹친요청('plan and then build it').겹침 === true, '');
  check('★★ "design it and implement it" 도 겹침이다',
    겹친요청('design it and implement it').겹침 === true, '');
  check('★★ "draft the schema, then write the migration" 도 겹침이다',
    겹친요청('draft the schema, then write the migration').겹침 === true, '');
}

// ── 2. 「묻지 말라」 를 영어로 적어도 알아본다 ──────────────────────────
trace('2-묻지말라');
{
  check('★★★ "Do not stop after producing a plan" 을 알아본다',
    묻지말라했나('Do not stop after producing a plan.') === true, '');
  check('★★★ "Do not ask the user" 도 알아본다',
    묻지말라했나('Do not ask the user to choose implementation details.') === true, '');
  check('★★ 줄임말도 그대로', 묻지말라했나("don't stop, just finish it") === true, '');
  check('★★ "continue autonomously" 도 같은 뜻이다',
    묻지말라했나('continue autonomously through implementation') === true, '');
  check('★★ 그 지시문 전체에서도 참이다', 묻지말라했나(명세) === true, '');

  // 안 적은 사람에게 켜지면 승인 창이 조용히 사라진다 — 그건 더 나쁘다.
  check('★★★ 그런 말이 없으면 거짓이다',
    묻지말라했나('Build a small web app with tests.') === false, '');
  check('★★ "stop the server" 같은 말에 안 걸린다',
    묻지말라했나('stop the dev server when done') === false, '');
}

// ── 3. 영어로 시킨 말도 「고치라는 말」 로 센다 ──────────────────────────
trace('3-손대라');
{
  check('★★★ "Build a complete … Application." 은 고치라는 말이다',
    손대라했나('Build a complete Work Request Application.') === true, '');
  check('★★ 번호 매긴 줄에서도 본다',
    손대라했나('1. Implement the approval workflow') === true, '');
  check('★★ 목록 표시 뒤에서도 본다', 손대라했나('- Fix the race condition') === true, '');
  check('★★ 그 지시문 전체에서도 참이다', 손대라했나(명세) === true, '');

  /*
   * 여기가 위험한 쪽이다. 넓게 잡으면 「설명해 줘」 가 고치라는 말이 되고,
   * 그러면 읽기 전용 모드(설계·점검·묻기)가 영영 안 골라진다.
   */
  check('★★★ 문장 가운데 낱말은 시킴말이 아니다',
    손대라했나('Explain how the build system works.') === false, '');
  check('★★★ 명사로 쓰인 것도 아니다',
    손대라했나('The build is broken and I want to understand why.') === false, '');
  check('★★ 한국어 규칙은 그대로 산다', 손대라했나('이 파일 좀 고쳐줘') === true, '');
  check('★★ 한국어 읽기 요청도 그대로', 손대라했나('이 구조 설명해줘') === false, '');
}

// ── 4. 긴 글에서 낱말 하나가 모드를 정하지 않는다 ───────────────────────
trace('4-긴글');
{
  /*
   * 5,000자 글에 `fails` 가 조건절에 딱 한 번 있었다. 그 한 번이 디버그
   * 모드를 골랐다 — 빈 폴더에 새 앱을 만드는 일에 「재현부터 하라」 가 붙는다.
   */
  const r = route(명세);
  check('★★★ 긴 명세는 낱말 하나로 모드를 정하지 않는다', r.mode === null, String(r.mode));
  /*
   * 까닭의 모양이 둘이다 — 「글이 길어 …」(신호가 하나뿐일 때)와
   * 「글이 길고 A(8점) 가 B(6점) 보다 세서 …」(뺀 것이 더 셀 때).
   * 낱말 하나를 못박으면 뒤엣것이 생겼을 때 뜻은 맞는데 검사만 터진다.
   * 그래서 **길다고 말했는가**를 본다.
   */
  check('★★ 왜 안 정했는지 사람에게 말한다', /글이 길/.test(String(r.why)), String(r.why));
  check('★★ 까닭에 견준 모드와 점수가 같이 나온다',
    !/보다 세서/.test(String(r.why)) || /\(\d+점\)/.test(String(r.why)), String(r.why));

  // 짧은 말은 예전 그대로여야 한다. 길이 규칙이 짧은 말까지 무디게 만들면
  // 그건 고친 것이 아니라 라우터를 꺼 버린 것이다.
  check('★★★ 짧은 말은 그대로 고른다', route('이거 왜 안 되는지 디버깅해줘').mode === 'debug',
    String(route('이거 왜 안 되는지 디버깅해줘').mode));
  check('★★★ 짧은 코드 요청도 그대로',
    route('로그인 폼 만들어줘').mode === 'code', String(route('로그인 폼 만들어줘').mode));

  /*
   * 긴 글이라도 신호가 뚜렷하면 고른다. 「길면 무조건 종합」 이 아니다 —
   * 그러면 긴 지시문을 쓰는 사람은 모드를 영영 못 쓴다.
   */
  const 긴디버그 = `${'배경 설명이 길게 이어집니다. '.repeat(110)}
이거 왜 안 되는지 원인 찾아서 디버깅해줘. 재현부터 하고 버그 고쳐줘.`;
  check('★★ 긴 글이어도 신호가 뚜렷하면 고른다',
    긴디버그.length >= 1500 && route(긴디버그).mode === 'debug',
    `${긴디버그.length}자 → ${route(긴디버그).mode}`);
}

// ── 5. 이 지시문이 실제로 갈 자리 ───────────────────────────────────────
trace('5-최종');
{
  /*
   * 종합 모드여야 한다. 도구가 전부 있고, 걸음이 넉넉하고, 승인 창이 없고,
   * 단계가 일을 따라간다(agent/단계.js). 그리고 「묻지 말라」 와 「고치라」 가
   * 둘 다 참이라 계획에서 만들기로 넘어가는 길도 열려 있다.
   */
  const r = route(명세);
  check('★★★ 계획 모드로 안 보낸다 (계획만 내고 멈추는 자리)', r.mode !== 'plan', String(r.mode));
  check('★★★ 승인 창을 안 띄운다', r.겹침 === false, String(r.겹침));
  check('★★★ 읽기 전용 모드로도 안 보낸다',
    !['architect', 'inspect', 'ask'].includes(String(r.mode)), String(r.mode));
  check('★★★ 단계가 넘어갈 조건이 둘 다 참이다 (계획 → 코드)',
    묻지말라했나(명세) === true && 손대라했나(명세) === true, '');
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n긴 명세 라우팅 검사  ${D}(붙여 넣은 지시문이 어디로 가나)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
