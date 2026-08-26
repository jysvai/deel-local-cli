// 종합 모드에서 요청을 보고 알맞은 작업 모드로 옮겨 가는지.
//
// 가장 중요한 것은 '틀리게 옮기지 않는다' 다.
// 잘못 옮기면 사용자는 왜 막혔는지 모른 채 막힌다 — 특히 읽기 전용 모드로
// 잘못 보내면 "왜 파일을 안 고쳐?" 가 된다. 그래서 애매하면 안 옮긴다.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { route } from '../src/agent/route.js';
import { MODES, ORDER, DEFAULT, normalize, canWrite } from '../src/agent/modes.js';
import { Session } from '../src/agent/session.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

trace('1-종합모드');

// ── 종합 모드가 기본인가 ────────────────────────────────────────────────
check('기본은 종합이다', DEFAULT === 'auto', DEFAULT);
check('종합이 목록 맨 앞이다', ORDER[0] === 'auto', ORDER.join(', '));
check('종합은 파일을 바꿀 수 있다', canWrite('auto'));
check('종합도 이름이 있다', MODES.auto?.name === '종합', MODES.auto?.name);
for (const 별명 of ['종합', '자동', '기본', 'auto', 'AUTO']) {
  check(`'${별명}' 을 종합으로 알아본다`, normalize(별명) === 'auto', String(normalize(별명)));
}

trace('2-고르기');

// ── 실제 말투로 골라 보기 ───────────────────────────────────────────────
//
// 정답이 null 이면 '옮기지 말아야 한다' 는 뜻이다.
const 표본 = [
  // 고장 — 신호가 뚜렷하다
  ['로그인이 왜 안 되지?', 'debug'],
  ['빌드하면 에러 나는데 봐줘', 'debug'],
  ['테스트가 자꾸 실패해', 'debug'],
  ['앱이 시작하자마자 죽어요', 'debug'],
  ['TypeError: cannot read property of undefined 이거 뭐 때문이야', 'debug'],
  ['버그 하나 있는데 원인 좀 찾아줘', 'debug'],
  ['스크롤이 이상해 가끔 멈춰', 'debug'],

  // 계획
  ['결제 기능 추가하려는데 먼저 계획 좀 세워줘', 'plan'],
  ['이거 어떤 순서로 하면 좋을지 계획해줘', 'plan'],
  ['작업 계획부터 잡자', 'plan'],
  ['리팩터링 로드맵 좀 그려줘', 'plan'],

  // 설계
  ['이 모듈 구조를 어떻게 바꾸는 게 좋을까', 'architect'],
  ['인증 레이어 설계 좀 봐줘', 'architect'],
  ['상태관리를 어떻게 나누는 게 좋을지', 'architect'],
  ['아키텍처 관점에서 어느 쪽이 나을까', 'architect'],

  // 설명
  ['이 함수 뭐야?', 'ask'],
  ['이 코드가 어떻게 동작하는지 설명해줘', 'ask'],
  ['useMemo 랑 useCallback 차이가 뭐야', 'ask'],
  ['이 설정값 무슨 뜻이야', 'ask'],

  // 총괄
  ['전체 로그 형식을 다 통일해줘', 'orchestrator'],
  ['테스트 전부 다시 짜고 끝까지 돌려줘', 'orchestrator'],
  ['여러 파일에 흩어진 거 하나씩 다 정리해줘', 'orchestrator'],

  // 구현
  ['로그인 버튼 색 좀 바꿔줘', 'code'],
  ['이 함수에 널 체크 추가해줘', 'code'],
  ['README 에 설치 방법 좀 써줘', 'code'],
  ['이 파일 이름 바꿔줘', 'code'],
  ['쓰지 않는 import 지워줘', 'code'],
  ['캐시 로직 구현해줘', 'code'],

  // 옮기면 안 되는 것 — 짧은 말, 맞장구, 이어 말하기
  ['음', null],
  ['ㅇㅇ', null],
  ['그래서?', null],
  ['계속해줘', null],
  ['고마워', null],
  ['src/app.js', null],
  ['아까 그거 다시', null],
];

let 맞음 = 0;
const 틀림 = [];
for (const [문장, 정답] of 표본) {
  const r = route(문장);
  if (r.mode === 정답) 맞음++;
  else 틀림.push(`${JSON.stringify(문장.slice(0, 26))} → ${r.mode ?? '(안 옮김)'} (정답 ${정답 ?? '(안 옮김)'})`);
}
check(`말투 ${표본.length}개를 다 맞힌다`, 맞음 === 표본.length, 틀림.slice(0, 3).join(' · '));

// 틀리는 방향이 중요하다. 애매할 때 옮기는 것보다 안 옮기는 편이 안전하다.
const 헛옮김 = 표본.filter(([문장, 정답]) => 정답 === null && route(문장).mode !== null);
check('애매한 말을 억지로 옮기지 않는다', 헛옮김.length === 0, 헛옮김.map((x) => x[0]).join(', '));

trace('3-읽기전용조심');

// ── 읽기 전용 모드로는 조심해서 보낸다 ──────────────────────────────────
//
// 고치라는 말이 섞였는데 설명 모드로 보내면 사용자는 막힌다.
// 그래서 읽기 전용 모드의 문턱을 더 높게 뒀다. 그게 지켜지는지 본다.
const 고쳐달라는말 = [
  '이거 설명해주고 고쳐줘',
  '구조 좀 보고 리팩터링해줘',
  '계획대로 만들어줘',
];
for (const 말 of 고쳐달라는말) {
  const m = route(말).mode;
  check(`"${말.slice(0, 18)}" 를 읽기 전용으로 안 보낸다`, m === null || canWrite(m), String(m));
}

trace('4-세션배선');

// ── 골라 넣은 모드가 실제로 쓰이는가 ────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'deel-route-'));
const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', auth: 'none', key: null, model: 'x', ctx: 32768 };

{
  const s = new Session(conn, { root });
  check('세션은 종합으로 태어난다', s.work === 'auto', s.work);
  check('처음엔 골라 넣은 것이 없다', s.routed === null, String(s.routed));
  check('그때 쓰는 모드는 종합', s.effectiveWork() === 'auto', s.effectiveWork());
  check('종합 절차가 프롬프트에 실린다', s.systemPrompt().includes('지금은 **종합** 모드다'), '');

  // 골라 넣으면 도구·프롬프트가 전부 그 모드를 따라야 한다.
  s.routed = 'plan';
  check('골라 넣으면 그 모드가 쓰인다', s.effectiveWork() === 'plan', s.effectiveWork());
  const sys = s.systemPrompt();
  check('골라 넣은 모드의 절차가 실린다', sys.includes('계획 세우기'), '');
  check('종합 절차는 빠진다', !sys.includes('지금은 **종합** 모드다'), '');
  check('기본 모드는 그대로 종합이다', s.work === 'auto', s.work);

  // 한마디가 끝나면 다시 처음부터 고른다 — 눌러붙지 않는다.
  s.routed = null;
  check('비우면 다시 종합으로 돌아온다', s.effectiveWork() === 'auto', s.effectiveWork());
}

// 도구 목록까지 따라가는가 — 이게 어긋나면 읽기 전용 모드에서 파일이 바뀐다.
{
  const { toolSchemas } = await import('../src/tools/index.js');
  const s = new Session(conn, { root });
  const 이름들 = (work) => toolSchemas(null, { hasSkills: false, web: false, work }).map((t) => t.function?.name ?? t.name);

  s.routed = 'plan';
  const 계획도구 = 이름들(s.effectiveWork());
  check('계획으로 골라 넣으면 Write 가 안 간다', !계획도구.includes('Write'), 계획도구.join(', '));
  check('계획으로 골라 넣어도 Read 는 간다', 계획도구.includes('Read'), '');

  s.routed = null;
  const 종합도구 = 이름들(s.effectiveWork());
  check('종합에서는 Write 가 간다', 종합도구.includes('Write'), 종합도구.join(', '));
}

trace('5-사람이고른것');

// ── 사람이 직접 고르면 저절로 옮기지 않는다 ─────────────────────────────
{
  const { handle } = await import('../src/commands.js');
  const { makeScope } = await import('../src/safety/guard.js');
  const { History } = await import('../src/safety/undo.js');
  const { Audit } = await import('../src/safety/audit.js');
  const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
  ctx.history.nextTurn();

  const 조용히 = async (fn) => {
    const 원래 = process.stdout.write.bind(process.stdout);
    let 모인것 = '';
    process.stdout.write = (chunk) => { 모인것 += chunk; return true; };
    try { const v = await fn(); return { v, out: 모인것 }; } finally { process.stdout.write = 원래; }
  };

  const s = new Session(conn, { root });
  s.routed = 'debug';                       // 저절로 옮겨 간 상태
  await 조용히(() => handle('/code', s, ctx));
  check('직접 고르면 기본 모드가 바뀐다', s.work === 'code', s.work);
  check('직접 고르면 골라 넣은 것을 지운다', s.routed === null, String(s.routed));
  check('그래서 이번 한마디부터 바로 먹는다', s.effectiveWork() === 'code', s.effectiveWork());

  // 다시 맡기기
  const r = await 조용히(() => handle('/work 종합', s, ctx));
  check('/work 종합 으로 다시 맡길 수 있다', s.work === 'auto', s.work);
  check('다시 맡기면 그렇다고 말해 준다', /저절로 옮겨 갑니다/.test(r.out), r.out.trim().split('\n').slice(-2)[0] ?? '');

  // 한 낱말 명령으로도 되어야 한다
  const s2 = new Session(conn, { root, work: 'plan' });
  await 조용히(() => handle('/auto', s2, ctx));
  check('/auto 로도 종합이 된다', s2.work === 'auto', s2.work);

  // 직접 고른 모드는 화면에 '직접 고르셨다' 고 알려 줘야 한다
  const r2 = await 조용히(() => handle('/plan', s2, ctx));
  check('직접 고르면 안 바뀐다고 알려 준다', /저절로 바뀌지 않습니다/.test(r2.out), r2.out.trim().split('\n').slice(-2)[0] ?? '');
}

trace('7-겹친요청');
// ── 계획과 실행이 한 말에 같이 들었을 때 ────────────────────────────────
//
// "정리해서 만들어줘" 가 계획 한 줄 없이 파일부터 만들어 버렸다. 점수표에서
// '만들어'(code 4점)가 이겼기 때문이다. 이제 겹친 것은 따로 알아보고
// 계획 → 승인 → 실행으로 잇는다.
//
// **안 떠야 하는 것을 더 촘촘히 본다.** 자율 실행이 이 프로젝트의 결정인데
// 승인 창이 아무 때나 뜨면 그 결정을 갉아먹는다. 놓치는 것보다 이쪽이 나쁘다.
{
  const 떠야 = [
    ['계획해주고 만들어줘', '사용자가 든 예'],
    ['정리해서 만들어줘', '실제로 겪은 그 말'],
    ['설계하고 구현해줘', '사용자가 든 예'],
    ['ax비전 선포를 위한 내용들 정리해서 만들어줘', '겪은 원문'],
    ['먼저 검토하고 고쳐줘', '검토 → 실행'],
    ['방향 잡고 코드 작성해줘', '방향 → 작성'],
    ['조사한 다음 세팅해줘', '한 다음'],
    ['plan it and then build the whole thing', '영어'],
    ['design then implement the parser', '영어 then'],
  ];
  for (const [말, 왜] of 떠야) {
    const r = route(말);
    check(`겹침으로 본다 — "${말}"`, r.겹침 === true && r.mode === 'plan',
      `${왜} → mode=${r.mode} 겹침=${r.겹침}`);
  }

  const 안떠야 = [
    ['이거 고쳐줘', '그냥 실행'],
    ['버그 잡아줘', '그냥 실행'],
    ['파일 하나 만들어줘', '계획말이 없다'],
    ['코드 정리해줘', "'정리' 하나로는 겹침이 아니다 — 그 자체가 할 일"],
    ['코드 정리하고 커밋해줘', '커밋은 실행말이 아니다'],
    ['만들고 나서 정리해줘', '순서가 반대 — 계획을 미리 볼 것이 없다'],
    ['계획이 뭐야', '묻는 말'],
    ['로드맵 보여줘', '계획만 달라는 것'],
    ['설계 설명해줘', '설명'],
    ['이 함수 분석해줘', '실행말이 없다'],
  ];
  for (const [말, 왜] of 안떠야) {
    check(`겹침이 아니다 — "${말}"`, route(말).겹침 !== true, 왜);
  }

  // 왜 그렇게 봤는지 화면에 뜨므로, 근거는 사람이 읽을 수 있어야 한다.
  const 근거 = route('정리해서 만들어줘');
  check('무엇을 보고 겹침이라 했는지 말한다',
    근거.why.includes('정리해서') && 근거.why.includes('만들어'), 근거.why);
  // 겹침이 아닌 길에서도 이 값이 있어야 한다 — 없으면 화면 쪽에서 undefined 를 본다.
  check('겹침이 아닌 답에도 겹침 칸이 있다',
    route('이거 고쳐줘').겹침 === false && route('음').겹침 === false);
}

trace('6-치움');
rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n모드 자동 전환 검사  ${D}(요청을 보고 알맞은 모드로 옮겨 가는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
