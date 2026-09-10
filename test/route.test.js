// 종합 모드에서 요청을 보고 알맞은 작업 모드로 옮겨 가는지.
//
// 가장 중요한 것은 '틀리게 옮기지 않는다' 다.
// 잘못 옮기면 사용자는 왜 막혔는지 모른 채 막힌다 — 특히 읽기 전용 모드로
// 잘못 보내면 "왜 파일을 안 고쳐?" 가 된다. 그래서 애매하면 안 옮긴다.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { route, 손대라했나, 겹친요청, 묻지말라했나 } from '../src/agent/route.js';
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

  /*
   * 「… 좀 해줘」 — 낱말과 '좀' 사이에 **빈칸**이 온다.
   *
   * 규칙이 `점검(해|좀|을|이)` 처럼 붙어 있는 꼴만 봐서, 한국말에서 제일 흔한
   * 이 부탁꼴이 통째로 안 걸렸다. 여덟 마디가 전부 종합에 남았다 —
   * 안 걸린 규칙은 아무 데서도 안 터지므로 여태 아무도 몰랐다.
   * (자동모드.test.js 의 죽은 규칙 검사가 잡았다.)
   */
  ['배포 전에 점검 좀 해줘', 'inspect'],
  ['이 로그 분석 좀 해줘', 'inspect'],
  ['이거 검토 좀 해줘', 'inspect'],
  ['설명 좀 해줘', 'ask'],
  ['이 함수 수정 좀 해줘', 'code'],
  ['캐시 구현 좀 해줘', 'code'],
  ['이 줄 삭제 좀 해줘', 'code'],
  ['원인 좀 찾아줘', 'debug'],

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

trace('8-손대라는말');
// ── 고치라고 했는데 읽기만 하는 모드로 보내지 않는다 ────────────────────
//
// "폴더 구조 개선해줘" 가 설계 모드로 갔다. 설계는 읽기만 하는 모드라, 사람은
// 고쳐 달라고 하고 설계안 한 장을 받았다. route.js 맨 위에 적힌 것이 정확히
// 그 경우다 — "읽기 전용 모드로 잘못 보내면 사용자는 '왜 파일을 안 고쳐?'
// 하고 막힌다."
//
// 점수로는 못 막는다. '구조' 와 '개선' 이 둘 다 설계의 강한 신호라, 뒤에 붙은
// '해줘' 를 아무리 봐도 안 뒤집힌다. 그래서 동사를 따로 본다.
{
  const 읽기만 = new Set(['architect', 'plan', 'ask']);

  // 고치라는 말이 든 것들 — 읽기만 하는 모드로 가면 안 된다.
  const 손대라 = [
    ['폴더 구조 개선해줘', '제보받은 그 말'],
    ['이 저장소 구조 개선해주세요', '높임말'],
    ['로그 함수들 어떻게 나누면 좋을지 보고 나눠줘', '보고 나서 나누라는 것'],
    ['모듈로 분리해줘', '설계 신호 + 실행 동사'],
    ['레이어 정리해줘', '계층은 설계 신호다'],
    ['의존성 방향 바꿔줘', '설계 신호 + 실행 동사'],
    ['아키텍처대로 구현해줘', '설계 신호 + 실행 동사'],
  ];
  for (const [말, 왜] of 손대라) {
    const r = route(말);
    check(`★ 고치라는 말은 읽기만 하는 모드로 안 간다 — "${말}"`,
      !읽기만.has(r.mode), `${왜} → ${r.mode} (${r.why})`);
  }

  // 읽고 말하라는 말 — 여기까지 막으면 안 된다.
  const 읽어라 = [
    ['이 코드 구조가 어떻게 되어 있는지 설명해줘', '설명은 손대는 말이 아니다'],
    ['이 프로젝트 아키텍처 알려줘', '알려 달라는 것'],
    ['레이어 나누는 설계만 먼저 봐줘', '나누는 안을 보자는 것'],
    ['계획 좀 세워줘', '계획을 달라는 것'],
    ['구조를 어떻게 잡을지 알려줘', '어떻게 잡을지 묻는 것'],
    ['어느 쪽이 나을지 검토만 해줘', '검토만'],
  ];
  for (const [말, 왜] of 읽어라) {
    check(`★ 읽고 말하라는 말은 그대로 둔다 — "${말}"`,
      !route(말).뺀것?.length, `${왜} → 뺀것=${JSON.stringify(route(말).뺀것 ?? [])}`);
  }

  // 무엇 때문에 안 보냈는지 사람이 알 수 있어야 한다.
  const 뺀것본것 = route('폴더 구조 개선해줘');
  check('무엇을 뺐는지 말한다', (뺀것본것.뺀것 ?? []).includes('architect'),
    JSON.stringify(뺀것본것.뺀것 ?? []));
  check('왜 안 보냈는지도 말한다', /고치라는 말/.test(뺀것본것.why), 뺀것본것.why);

  // 겹친 요청은 이 규칙보다 먼저다. "정리해주고 만들어줘" 는 계획을 내고
  // 승인을 받아 실행까지 잇는 길이라, 여기서 plan 을 빼면 그 길이 막힌다.
  const 겹친것 = route('정리해주고 만들어줘');
  check('★ 겹친 요청은 그대로 계획으로 간다 (승인 뒤 실행까지 잇는 길)',
    겹친것.mode === 'plan' && 겹친것.겹침 === true, `${겹친것.mode} 겹침=${겹친것.겹침}`);

  check('손대라했나 를 따로도 물을 수 있다',
    손대라했나('개선해줘') === true && 손대라했나('설명해줘') === false);
  check('아무것도 안 줘도 안 터진다', 손대라했나() === false && 손대라했나(null) === false);
}


// ── 긴 지시문을 읽기 전용으로 보내지 않는다 ─────────────────────────────
//
// ★★ 이 파일 맨 위에 적어 둔 것이 정확히 이 경우다 — "읽기 전용 모드로
//     잘못 보내면 사용자는 '왜 파일을 안 고쳐?' 하고 막힌다."
//
// 실제로 들어온 1,300자짜리 지시문에서 두 가지가 한꺼번에 어긋났다.
//   1) 800자 떨어진 '검토해서' 와 '추가하' 가 짝지어져 겹침으로 잡혔다 →  계획 모드
//   2) 해라체("만들어라 · 수정만 수행해라")가 손대라는말 목록에 아예 없었다
//      → 읽기 전용 모드가 후보에서 안 빠졌다
//
// 둘 다 조용하다. 사람은 고쳐 달라고 세 번 적었는데 계획서 한 장을 받는다.
{
  const 진짜지시문 = [
    '이 프로젝트의 공동작업 기능을 실제 배포 전 점검한다고 가정하고 전체적으로 검토해줘.',
    '목표는 여러 사용자가 동시에 편집할 때 발생할 수 있는 데이터 손실, 덮어쓰기, 충돌,',
    '동기화 실패 또는 상태 불일치 문제를 찾아 실제로 개선하는 것이다.',
    '문제를 재현할 수 있는 자동화 테스트를 먼저 만들어라.',
    '기존 동작을 유지하면서 근본 원인을 해결하는 최소 범위의 코드 수정만 수행해라.',
    '수정 후 새로 만든 재현 테스트를 다시 실행하고 기존 회귀 테스트도 실행해라.',
    '테스트가 실패하면 바로 종료하지 말고 실패 원인을 분석해라.',
    '사용자에게 추가 정보가 반드시 필요한 상황이 아니라면 중간에 멈춰서 확인을 요청하지 말고,',
    '분석부터 수정과 검증까지 스스로 진행해라.',
  ].join('\n');

  const r = route(진짜지시문);
  check('★★ 고치라는 긴 지시문은 파일을 고칠 수 있는 모드로 간다',
    canWrite(r.mode ?? DEFAULT), `${r.mode ?? '(그대로)'} · ${r.why}`);
  check('★★ 계획 모드로 안 보낸다 — 계획만 내고 멈추는 모드다', r.mode !== 'plan', String(r.mode));
  check('★ 읽기만 하는 점검으로도 안 보낸다', r.mode !== 'inspect', String(r.mode));

  check('★ 해라체를 손대라는 말로 알아본다', 손대라했나(진짜지시문) === true);
  check('  「만들어라」 하나로도 알아본다', 손대라했나('재현 테스트를 먼저 만들어라') === true);
  check('  「지워라」 도 마찬가지', 손대라했나('임시 파일 지워라') === true);
  check('  읽고 말하라는 해라체는 아니다', 손대라했나('구조를 설명해라') === false);

  /*
   * ── 맨 「라」 뒤에 말이 더 붙어도 알아본다 ────────────────────────────
   *
   * 위 세 줄이 전부 **시킴말이 글 맨 끝**인 문장이었다. 그래서 이 자리가
   * 오래 깨져 있었는데도 아무도 몰랐다.
   *
   * 무늬를 템플릿 글로 짓는데 거기 `\s` 를 한 겹으로 적어서, 자바스크립트가
   * 백슬래시를 먹고 **글자 `s`** 만 정규식에 닿았다. 그 결과 맨 「라」 는
   * 글 끝이나 . ! ? ~ , 앞에서만 걸렸다 — 빈칸이 오면 안 걸렸다.
   *
   * 사람이 실제로 쓰는 말은 거의 다 여러 마디다. 즉 제일 흔한 꼴이 통째로
   * 빠져 있었다. 여기서 빈칸·줄바꿈·다음 문장을 다 못 박는다.
   */
  check('★★★ 「바꿔라 지금 해줘」 — 뒤에 빈칸이 와도 알아본다',
    손대라했나('바꿔라 지금 해줘') === true);
  check('★★★ 「지워라 그리고 저장해」 — 마디가 이어져도 알아본다',
    손대라했나('지워라 그리고 저장해') === true);
  check('★★★ 줄바꿈이 뒤따라도 알아본다',
    손대라했나('바꿔라\n다음 문장도 있다') === true);
  check('★★★ 탭이 뒤따라도 알아본다', 손대라했나('바꿔라\t그리고') === true);
  check('★★ 글 끝일 때도 그대로 알아본다 (여태 되던 것)',
    손대라했나('그것 좀 바꿔라') === true);
  check('★★ 문장부호 뒤도 그대로 (여태 되던 것)',
    손대라했나('바꿔라. 그리고 알려줘') === true);
  /*
   * 그렇다고 아무 「라」 나 걸리면 안 된다. 「~라고」 는 시킴말이 아니라
   * 인용이다 — 여기 걸리면 남의 말을 옮긴 문장이 죄다 고치라는 말이 된다.
   */
  check('★★★ 「~라고」 는 인용이지 시킴말이 아니다',
    손대라했나('바꾸라고 했었는지 알려줘') === false, String(손대라했나('바꾸라고 했었는지 알려줘')));

  check('★★ 800자 떨어진 두 말은 겹침이 아니다', 겹친요청(진짜지시문).겹침 === false,
    겹친요청(진짜지시문).why);
  check('★ 한 문장 안의 겹침은 그대로 잡는다', 겹친요청('정리해서 만들어줘').겹침 === true);
  check('★ 계획 세우고 구현도 그대로', 겹친요청('계획 세우고 나서 구현해줘').겹침 === true);
  check('★ 영어 겹침도 그대로', 겹친요청('plan and then build it').겹침 === true);

  /*
   * ★★ 묻지 말라고 적어 둔 사람에게는 승인 창을 안 띄운다.
   *
   * 겹침의 값은 「계획을 보여 주고 승인을 받는다」 인데, 받지 말라고 글로
   * 적어 둔 사람에게는 그 값이 손해뿐이다 — 계획 모드는 내고 멈춘다.
   */
  check('★★ 「멈추지 말고」 라고 적으면 겹침이 아니다',
    묻지말라했나(진짜지시문) === true
    && 겹친요청('정리해서 만들어줘. 중간에 멈추지 말고 끝까지 해라.').겹침 === false);
  check('안 적은 사람에게는 그대로 겹침이다', 묻지말라했나('정리해서 만들어줘') === false);
  check('영어로 적어도 알아본다', 묻지말라했나('review and then implement it without asking') === true);
}

trace('6-치움');
rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n모드 자동 전환 검사  ${D}(요청을 보고 알맞은 모드로 옮겨 가는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
// ── 점검으로 간다 ───────────────────────────────────────────────────────
//
// ★★ 이 갈래가 없던 동안 이런 말이 전부 묻기로 갔다. 묻기는 짧게 답하고,
//     얕게 생각하고, 열두 걸음에서 멈춘다 — 셋 다 이 일에는 틀린 값이다.
{
  const 진짜있었던말 = [
    '이 프로젝트의 공동작업 기능을 분석해서 동시 편집 시 데이터 손실, 덮어쓰기,',
    '충돌 또는 상태 불일치가 발생할 가능성이 있는 부분을 찾아줘.',
    '실제 코드 근거가 있는 문제만 제시하고 각 문제마다 관련 파일과 함수를 설명해줘.',
    '코드는 수정하지 마.',
    '최대 5개까지만 찾아줘.',
  ].join('\n');
  const r = route(진짜있었던말);
  check('★★ 결함을 찾으라는 말은 점검으로 간다', r.mode === 'inspect', `${r.mode} (${r.score}점)`);

  check('보안 점검도 점검', route('보안 취약점 점검해줘').mode === 'inspect');
  check('코드 리뷰도 점검', route('코드 리뷰해줘').mode === 'inspect');
  check('경합 조건도 점검', route('동시 편집할 때 데이터 날아갈 자리 찾아줘').mode === 'inspect');

  // 갈라야 하는 자리 — 여기서 헷갈리면 새 모드가 남의 일을 뺏는다.
  check('★ 짧은 물음은 그대로 묻기', route('이 파일 설명해줘').mode === 'ask');
  check('★ 증상이 있으면 디버그다', route('오류 원인 분석해줘').mode === 'debug',
    String(route('오류 원인 분석해줘').mode));
  check('★★ 고치라는 말이 붙으면 점검으로 안 보낸다 — 읽기만 하는 모드다',
    route('성능 분석해서 개선해줘').mode !== 'inspect',
    String(route('성능 분석해서 개선해줘').mode));
  check('감사 인사는 안 걸린다', route('감사합니다').mode !== 'inspect',
    String(route('감사합니다').mode));
}


console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
