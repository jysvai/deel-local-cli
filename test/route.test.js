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
   * ★★★ 빈칸 한 칸으로 시킴말이 통째로 사라지면 안 된다.
   *
   * 「수정해 줘」 는 맞춤법대로 띄어 쓴 꼴이다. 이게 안 걸리면 모드도 갈리고,
   * 「무슨 일을 할까요?」 를 안 묻게 막는 자리(askcheck)도 같이 뚫린다.
   */
  check('★★★ 띄어 쓴 시킴말도 손대라는 말이다',
    손대라했나('코드 수정해 줘') === true && 손대라했나('이 파일 고쳐 주세요') === true,
    `${손대라했나('코드 수정해 줘')} / ${손대라했나('이 파일 고쳐 주세요')}`);
  check('★★ 붙여 쓰나 띄어 쓰나 같은 모드로 간다',
    route('이 구조를 살펴보고 코드 수정해줘').mode === route('이 구조를 살펴보고 코드 수정해 줘').mode,
    `${route('이 구조를 살펴보고 코드 수정해줘').mode} / ${route('이 구조를 살펴보고 코드 수정해 줘').mode}`);
  check('  그래도 세 글자 넘게 떨어지면 아니다',
    손대라했나('나누는 설계만 봐줘') === false);

  /*
   * ★★★ 「…해 보고」 는 한국말에서 제일 흔한 「먼저 보고 나서」 꼴이다.
   *
   * 이게 빠져 있어서 "살펴보고 만들어줘" 가 계획 한 줄 없이 파일부터 만들었다.
   * "정리하고 만들어줘" 와 같은 말인데 이음꼴 하나로 갈렸다.
   */
  check('★★★ 「살펴보고 만들어줘」 도 겹침이다', 겹친요청('살펴보고 만들어줘').겹침 === true,
    겹친요청('살펴보고 만들어줘').why);
  check('★★ 「알아보고 구현해줘」 도 겹침이다', 겹친요청('알아보고 구현해줘').겹침 === true);
  check('★★ 「살펴본 다음 만들어줘」 도 겹침이다', 겹친요청('살펴본 다음 만들어줘').겹침 === true);
  check('★★ 「보고서」 는 이음말이 아니다', 겹친요청('검토 보고서를 만들어줘').겹침 === false,
    겹친요청('검토 보고서를 만들어줘').why);

  /*
   * ★★★ 영어 쉼표 열거를 차례로 읽으면 안 된다.
   *
   * 「이것들을 다 해라」 를 「설계하고 나서 만들어라」 로 읽으면 계획 모드로
   * 가서 계획만 내고 멈춘다 — 시킨 것과 정반대다.
   */
  check('★★★ 쉼표 열거는 겹침이 아니다',
    겹친요청('independently design, implement, test, and build the feature').겹침 === false,
    겹친요청('independently design, implement, test, and build the feature').why);
  check('★★ 차례를 적어 두면 쉼표가 있어도 겹침이다',
    겹친요청('Plan the migration, then implement it').겹침 === true);
  check('★★ 쉼표 없이 and 로 이으면 그대로 겹침이다',
    겹친요청('Design and implement the auth module.').겹침 === true);
  /*
   * ★★ 쉼표를 아예 못 넘게 막았더니 이번엔 차례가 안 걸렸다.
   *
   * 영어는 `and` 앞에 쉼표를 찍는 것이 그냥 흔하다. 열거와 갈리는 자리는
   * 쉼표가 **몇 개냐** 다 — 열거는 여러 번, 차례는 많아야 한 번.
   */
  check('★★ 쉼표 하나 뒤의 and 는 차례다',
    겹친요청('Plan the migration, and implement it').겹침 === true,
    겹친요청('Plan the migration, and implement it').why);

  /*
   * ★★★ 「고치지 마라」 는 고치라는 말이 아니다.
   *
   * 사이가 세 글자라 '지 마' 가 통째로 들어앉고 남은 '라' 가 시킴꼴로 읽혔다.
   * 하지 말라는 말이 하라는 말이 되는 것이라 뒤집힘이 제일 크다.
   */
  for (const 글 of ['이 파일은 절대 고치지 마라', '이 파일은 절대 고치지마라',
    '만들지 마', '고치지 말고 알려 줘', '삭제하지 마세요']) {
    check(`★★★ 하지 말라는 말은 시킴말이 아니다 — "${글}"`,
      손대라했나(글) === false, `손대라=${손대라했나(글)}`);
  }
  /*
   * ★★ 씨끝마다 빈칸 사정이 다르다.
   *
   * 빈칸을 넘어야 하는 것은 도움움직씨 '주다' 뿐이다. '하자·해라' 는 줄기에서
   * 안 떨어진다 — 전부에 빈칸을 열었더니 이름씨 '하자(결함)' 가 걸렸다.
   */
  check('★★ 이름씨 「하자」 는 씨끝이 아니다',
    손대라했나('추가 하자 있는 부분 알려줘') === false,
    `손대라=${손대라했나('추가 하자 있는 부분 알려줘')}`);
  check('  붙여 쓴 「정리하자」 는 그대로 시킴말이다', 손대라했나('정리하자') === true);
  check('★ 「고쳐 줄래」 도 시킴말이다',
    손대라했나('코드 고쳐 줄래?') === true && 손대라했나('코드 고쳐줄래?') === true);

  check('★★ 계획거리와 동사 사이에 「좀」 이 껴도 예외다',
    손대라했나('계획 좀 수정해 줘') === false, `손대라=${손대라했나('계획 좀 수정해 줘')}`);

  /*
   * ★★ 「검토해 보고」 「살펴보고서」 — '보고' 를 이름씨와 가르는 자리.
   *
   * 뒤에 뭐가 오느냐만 봐서는 못 가른다. 앞을 봐야 갈린다 — 움직씨 줄기에
   * 붙어 있으면 이음말이고, 빈칸 뒤에 홀로 섰으면 이름씨다.
   */
  check('★★ 「검토해 보고 만들어줘」 도 겹침이다', 겹친요청('검토해 보고 만들어줘').겹침 === true,
    겹친요청('검토해 보고 만들어줘').why);
  check('★★ 「살펴보고서」 의 -고서 는 이음씨끝이다', 겹친요청('살펴보고서 만들어줘').겹침 === true,
    겹친요청('살펴보고서 만들어줘').why);
  check('★★ 그래도 「계획 보고서 만들어줘」 는 겹침이 아니다',
    겹친요청('계획 보고서 만들어줘').겹침 === false, 겹친요청('계획 보고서 만들어줘').why);
  /*
   * ★★★ 가르는 것은 빈칸이 아니라 **앞말의 품사**다.
   *
   * 붙어 있으면 이음말로 쳤더니 「검토보고서」 가 통째로 겹침이 됐다.
   * '살펴·알아' 는 움직씨 줄기라 뒤의 '보고' 가 도움움직씨이고,
   * '검토·분석' 은 이름씨라 '보고' 가 붙으면 한 낱말이 된다.
   */
  for (const 글 of ['검토보고서 작성해줘', '분석보고서 만들어줘', '분석해 보고서를 작성해 줘',
    '분석 보고도 작성해줘', '검토 보고는 오늘까지 만들어줘']) {
    check(`★★★ 이름씨 '보고' 는 이음말이 아니다 — "${글}"`,
      겹친요청(글).겹침 === false, 겹친요청(글).why);
  }
  for (const 글 of ['살펴보고 만들어줘', '살펴보고서 만들어줘', '살펴 보고 만들어줘',
    '검토해 보고 만들어줘', '알아보고 구현해줘', '살펴본 다음 만들어줘']) {
    check(`★★ 움직씨 줄기 뒤의 '보고' 는 이음말이다 — "${글}"`,
      겹친요청(글).겹침 === true, 겹친요청(글).why);
  }

  /*
   * ★★★ `the design` 은 계획을 세우라는 말이 아니다.
   *
   * 이 네 낱말은 움직씨이자 이름씨다. 앞에 관사가 붙으면 이름씨다 — 그때는
   * 무엇을 가리키는 말이지 계획을 세우라는 말이 아니다. 둘째 보기는 사람이
   * **이미 승인됐다고 적어 놨는데** 또 계획을 내고 승인을 물었다.
   */
  for (const 글 of ['The design is fine. Run the linter and write the changelog.',
    'Our plan is approved. Open the file and make the change.',
    'Read the design doc and implement the parser.']) {
    check(`★★★ 관사가 붙으면 이름씨다 — "${글.slice(0, 34)}…"`,
      겹친요청(글).겹침 === false, 겹친요청(글).why);
  }
  /*
   * ★★★ 위 갈래는 **승인 창만** 껐다 — 점수표는 안 봤다.
   *
   * 바로 위 머리말이 「또 계획을 내고 승인을 물었다」 를 고쳤다고 적어 뒀는데,
   * 끈 것은 뒤엣것(겹침)뿐이다. 점수표의 `plan` 5점이 그대로 남아 있어서 그 말은
   * 여전히 계획 모드로 갔다 — 파일을 바꾸는 도구가 하나도 없는 모드로.
   *
   * 겹침을 끈 것이 오히려 더 나쁘게 만들었다. 겹침일 때는 승인 뒤에 code 로 잇는
   * 길이 있었는데(repl.js 의 이어갈모드), 그 길마저 없어져서 사람은 「이미 승인됐다」
   * 고 적어 놓고 계획서 한 장을 다시 받고 끝난다. 시킨 일이 통째로 안 된다.
   *
   * 잣대는 영어겹침 이 이미 쓰는 것과 같다 — 뒤에 is·was 가 오면 그 낱말은 시킴이
   * 아니라 **이미 있는 것을 가리키는 말**이다.
   */
  for (const 글 of ['Our plan is approved. Open the file and make the change.',
    'Plan is approved, then implement it',
    'The roadmap is approved. Build it.',
    'The plan was rejected. Write a new parser.']) {
    const m = route(글).mode;
    check(`★★★ 이미 있는 계획을 가리키는 말은 읽기 전용으로 안 보낸다 — "${글.slice(0, 34)}…"`,
      m === null || canWrite(m), `${m} · ${route(글).why}`);
  }
  for (const 글 of ['Give me a plan for the migration.', 'Write a roadmap for Q3.',
    'plan the migration', 'Make a plan first.']) {
    check(`★★ 계획을 달라는 영어 말은 그대로 계획이다 — "${글.slice(0, 30)}"`,
      route(글).mode === 'plan', String(route(글).mode));
  }
  check('★★ 맨 and 갈래가 빈칸으로 예순 자 잣대를 못 뚫는다',
    겹친요청(`plan${' '.repeat(300)}and build it`).겹침 === false);
  /*
   * ★★★ 맨 `and` 는 **문장 끝**도 못 넘는다.
   *
   * 쉼표는 막아 놓고 그보다 센 구분자인 마침표는 지나갔다. 그러면 한 문장짜리
   * 규칙이 글 전체를 훑는다 — 관사가 없어 위의 이름씨 규칙이 안 걸리는 자리라,
   * 문장 끝을 안 막으면 여기가 그대로 열린다.
   */
  for (const 글 of ['Design it carefully. Run the linter and write the changelog.',
    'Plan it out. Open the file and make the change.',
    'Draft it quickly! Then run the tests and write the docs.']) {
    check(`★★★ 마침표 건너편과는 안 짝짓는다 — "${글.slice(0, 30)}…"`,
      겹친요청(글).겹침 === false, 겹친요청(글).why);
  }

  /*
   * ★★★ 맨 「라」 는 시킴꼴이기도 하고 서술격조사이기도 하다.
   *
   * 「개선이라」 가 시킴말로 읽혀서, 검토해 달라는 물음이 「고치라는 말」 이
   * 됐다. 그러면 화면에 거꾸로 된 까닭이 뜬다 — 고치라고 한 적이 없는데
   * 「고치라는 말이라 읽기 전용 모드로 안 보냄」.
   */
  for (const 글 of ['이걸 개선이라 볼 수 있는지 검토해 줘', '이 커밋이 리팩터라 불릴 만한지 분석해 줘',
    '이걸 배포라 부르는 게 맞나? 설명해 줘', '지금 구조가 분리라 할 수 있는지 살펴봐 줘']) {
    check(`★★★ '-이라' 는 시킴꼴이 아니다 — "${글.slice(0, 22)}…"`,
      손대라했나(글) === false, `손대라=${손대라했나(글)}`);
  }
  for (const 글 of ['임시 파일 지워라', '바꿔라 지금 해줘', '재현 테스트를 먼저 만들어라', '통일해라']) {
    check(`★★ 그래도 해라체는 시킴말이다 — "${글}"`, 손대라했나(글) === true);
  }

  check('★★ 계획거리와 동사 사이에 어찌씨가 껴도 예외다',
    손대라했나('이전 계획 다시 정리해 줘') === false && 손대라했나('계획 좀 더 정리해줘') === false,
    `${손대라했나('이전 계획 다시 정리해 줘')} / ${손대라했나('계획 좀 더 정리해줘')}`);
  check('  그래도 「계획 파일 수정해 줘」 는 시킴말이다', 손대라했나('계획 파일 수정해 줘') === true);

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

  /*
   * ★★★ 승인받을 사람이 없는 자리에서는 계획부터 내지 않는다.
   *
   * 겹침의 값은 「계획을 보여 주고 **승인을 받아** 그대로 잇는다」 다. 그 값은
   * 승인할 사람이 있어야 생긴다. `deel run` 과 에디터(ACP)에는 승인 창도
   * 이어 갈 턴도 없어서, 계획 모드로 보내면 계획 한 장을 찍고 끝난다 —
   * 계획 모드는 파일을 고치는 도구가 없다. 시킨 일의 절반도 못 준다.
   */
  for (const 글 of ['정리해서 만들어줘', '결제 모듈 설계하고 만들어줘', '살펴보고 만들어줘']) {
    const 물음있음 = route(글);
    const 물음없음 = route(글, { 승인받을수있나: false });
    check(`★★★ 물어볼 사람이 없으면 계획 모드로 안 간다 — "${글}"`,
      물음있음.mode === 'plan' && 물음없음.mode !== 'plan' && canWrite(물음없음.mode),
      `물음○ ${물음있음.mode} · 물음✗ ${물음없음.mode}`);
    check('  그래도 겹쳤다는 것은 말해 준다', 물음없음.겹침 === true);
  }
  /*
   * ★★ 갈래를 건너뛰는 것만으로는 모자란다.
   *
   * 「plan and then build it」 은 점수표의 `plan` 5점이 이겨서 그대로 읽기
   * 전용 모드로 갔다. 겹쳤는데 승인받을 자리가 없으면 실행하라는 절반이
   * 분명히 있다는 뜻이니, 읽기 전용 모드는 후보에서 뺀다.
   */
  {
    const r = route('plan and then build it', { 승인받을수있나: false });
    check('★★★ 점수표가 이겨서 읽기 전용으로 가지도 않는다',
      canWrite(r.mode), `${r.mode} · ${r.why}`);
    check('★★ 왜 뺐는지 까닭이 다르다 — 「고치라는 말이라」 가 아니다',
      /승인받을 자리가 없어서/.test(r.why), r.why);
  }
  check('★ 안 겹친 말은 두 갈래가 같다',
    route('이 파일 고쳐줘').mode === route('이 파일 고쳐줘', { 승인받을수있나: false }).mode);

  /*
   * ★★★ 「계획대로」 는 계획을 달라는 말이 아니다.
   *
   * 계획을 받아 본 사람이 다음에 치는 말이 「위 계획대로 진행해줘」 다.
   * 그 말에 '계획' 이 들어 있어서 또 계획 모드로 갔다 — 계획을 두 장 받고
   * 파일은 그대로다. 승인한 값이 통째로 사라진다.
   */
  for (const 글 of ['위 계획대로 진행해줘', '계획대로 해줘', '계획대로 진행',
    '플랜대로 진행해줘', '계획에 따라 구현해줘', '로드맵대로 만들어줘',
    // '만들어' 가 붙은 것만 재면 헐겁다 — 그건 시킴말이라 어차피 계획이
    // 후보에서 빠진다. 시킴말이 아닌 '진행' 으로도 재야 이 규칙을 잰다.
    '로드맵대로 진행해줘', '플랜대로 해줘']) {
    check(`★★★ 계획을 이으라는 말은 고칠 수 있는 모드로 — "${글}"`,
      canWrite(route(글).mode), `${route(글).mode}`);
  }
  for (const 글 of ['계획 세워줘', '구현 계획 짜 줘', '이 계획 어때?', '이전 계획 정리해 줘']) {
    check(`★★ 계획을 달라는 말은 그대로 계획이다 — "${글}"`,
      route(글).mode === 'plan', String(route(글).mode));
  }

  /*
   * ★★ 한 사실을 두 줄로 말하지 않는다.
   *
   * 겹쳤는데 승인받을 자리가 없으면 `일부러` 와 `겹침` 이 둘 다 참이 된다.
   * 부르는 쪽이 각각 한 줄씩 찍으면 같은 이야기가 겹쳐 뜬다.
   */
  {
    const r = route('plan and then build it', { 승인받을수있나: false });
    check('★★ 겹침과 일부러가 같이 참인 자리가 있다 — 부르는 쪽이 하나만 찍어야 한다',
      r.겹침 === true && r.일부러 === true, `겹침=${r.겹침} 일부러=${r.일부러}`);
  }
  check('영어로 적어도 알아본다', 묻지말라했나('review and then implement it without asking') === true);
}

trace('6-치움');
rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
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

// ── 묻는 말을 못 알아보면 답만 하면 되는 턴이 고칠 수 있는 모드로 돈다 ──
{
  /*
   * ★★ 물음표 뒤에 한마디를 더 붙였다고 물음이 아니게 되면 안 된다.
   *
   * 붙인 「알려줘」 는 더 설명해 달라는 말인데 점수가 되레 깎여서(5 → 3)
   * 문턱을 못 넘었다.
   */
  check('★★ 물음표 뒤에 말이 붙어도 묻기다', route('이거 뭐야? 알려줘').mode === 'ask',
    `${route('이거 뭐야? 알려줘').mode} (${route('이거 뭐야? 알려줘').점수들?.ask ?? 0}점)`);
  check('★ 물음표가 없으면 줄 끝이어야 한다는 것은 그대로',
    route('이거 뭐야').mode === 'ask');

  /*
   * ★★ 공손하게 물을수록 물음으로 안 읽히면 안 된다.
   *
   * 첫머리 못을 `^\s*` 로 박아 두면 빈칸 말고는 아무것도 앞에 못 온다.
   * 그런데 영어로 묻는 사람은 그 자리에 거의 항상 한마디를 붙인다.
   */
  check('★★ 「Please tell me …」 도 묻기다',
    route('Please tell me what this does').mode === 'ask',
    String(route('Please tell me what this does').mode));
  check('★★ 「Could you …」 도 묻기다',
    route('Could you tell me what this does').mode === 'ask',
    String(route('Could you tell me what this does').mode));
  check('★ 「Please show me how to …」 도 묻기다',
    route('Please show me how to run this').mode === 'ask');
  /*
   * ★★ 공손말은 한 마디가 아니라 두 마디가 붙기도 한다.
   *
   * 세로줄로 갈라 두면 둘 중 하나만 먹고 나머지가 남아 통째로 0점이 된다.
   */
  check('★★ 공손말이 둘 붙어도 묻기다',
    route('Please could you tell me what this does').mode === 'ask',
    String(route('Please could you tell me what this does').mode));
  /*
   * ★★★ 물어보고 **나서 고치라**는 한 문장은 묻기가 아니다.
   *
   * 공손말을 받아 주자 이것들이 5점을 꽉 채워 묻기 모드로 갔다. 묻기는 파일을
   * 못 고치는 모드라, 사람은 설명만 받고 이름은 그대로다. 공손말을 받기
   * 전에는 종합(고칠 수 있는 자리)에 남아 있었으니 없던 자리를 만든 셈이다.
   */
  for (const 글 of ['Please show me the config and rename it to config.json.',
    'Could you tell me what changed and update the changelog?',
    'Please tell me which files are unused and delete them.']) {
    check(`★★★ 이어 붙은 시킴 마디가 있으면 묻기가 아니다 — "${글.slice(0, 34)}…"`,
      route(글).mode !== 'ask', String(route(글).mode));
  }
  check('★★ 움직씨가 아닌 and 는 안 건드린다',
    route('Please tell me what to fix and why').mode === 'ask',
    String(route('Please tell me what to fix and why').mode));

  /*
   * ★★★ 못을 뽑은 것이 아니다 — 딸린 마디의 「show me」 는 여전히 물음이
   * 아니다. 여기가 새면 고치라는 말이 파일을 못 고치는 모드로 간다.
   */
  check('★★★ 딸린 마디의 「show me」 는 묻기가 아니다',
    route('Rewrite this function to show me the result.').mode !== 'ask',
    String(route('Rewrite this function to show me the result.').mode));
  check('★★ 「Write the docs and tell me …」 도 묻기가 아니다',
    route('Write the docs and tell me what changed.').mode !== 'ask',
    String(route('Write the docs and tell me what changed.').mode));
  check('★★ 공손말을 붙여도 고치라는 말은 묻기가 아니다',
    route('Please rewrite how to build it.').mode !== 'ask',
    String(route('Please rewrite how to build it.').mode));
}
/*
 * ── 8회차 판정에서 「참」 으로 남은 일곱 자리 ───────────────────────────
 *
 * 하나같이 **넓힌 자리의 가장자리**다. 규칙을 넓힐 때 보기로 든 말은 다
 * 걸리는데, 그 옆 한 칸이 안 걸린다 — 토씨 하나, 빈칸 하나, 쉼표 하나,
 * 물음표 하나 차이다. 사람이 실제로 치는 말은 그 한 칸 쪽이 더 흔하다.
 */
{
  /*
   * ★★★ 「원인」 만 빼고 「이유」 는 안 뺐다.
   *
   * 빼는 자리의 토씨 목록이 `[을이은는]` 이라 「이유를」 「이유가」 가 안
   * 걸렸다. 고장 난 까닭을 묻는 말이 **파일을 못 고치는** 점검 모드로 간다.
   */
  for (const 글 of ['이유를 살펴봐줘', '이 오류 이유를 좀 살펴봐 줘', '까닭를 살펴봐줘',
    '원인를 좀 살펴봐 줘', '이유를 살펴 보고 알려줘']) {
    check(`★★★ 고장의 까닭을 묻는 말은 점검이 아니다 — "${글}"`,
      route(글).mode !== 'inspect', String(route(글).mode));
  }
  check('  그래도 맨 「살펴봐 줘」 는 점검이다', route('이 코드 살펴봐 줘').mode === 'inspect',
    String(route('이 코드 살펴봐 줘').mode));

  /*
   * ★★★ 물음표를 찍으면 「and fix」 문이 통째로 열렸다.
   *
   * 물음표까지 삼키는 갈래가 이기면 뒤를 막는 문이 **삼킨 자리 뒤**에서
   * 열린다 — 이미 지나온 「and fix」 에 닿을 수가 없다. 마침표로 끝낸
   * 같은 말은 막히는데 물음표로 끝낸 것만 묻기로 갔다.
   */
  for (const 글 of ['What is broken in route.js and fix it?',
    'What is broken and fix it?', 'How does this work and then rewrite it?',
    'How do I run this and add a test?']) {
    check(`★★★ 물음표를 찍어도 이어 붙은 시킴 마디는 묻기가 아니다 — "${글.slice(0, 34)}…"`,
      route(글).mode !== 'ask', String(route(글).mode));
  }
  check('  그래도 맨 물음은 묻기다', route('What is broken in route.js?').mode === 'ask',
    String(route('What is broken in route.js?').mode));
  /*
   * ★★ 뒤에 단 문도 그대로 있어야 한다.
   *
   * 낱말 바로 뒤의 문은 **물음표에서 멈춘다** — 물음표 건너편의 시킴 마디는
   * 물음표까지 삼킨 뒤에 열리는 문만 볼 수 있다. 두 문이 서로 다른 데를
   * 지키므로, 한쪽만 남기면 다른 쪽이 통째로 열린다.
   */
  for (const 글 of ['What about the parser? And rewrite it.', 'How about the cache? And rewrite it.']) {
    check(`★★ 물음표 건너편의 시킴 마디도 묻기가 아니다 — "${글}"`,
      route(글).mode !== 'ask', String(route(글).mode));
  }

  /*
   * ★★★ 「말해 줘」 갈래의 문만 이름 속 점에서 끊겼다.
   *
   * `what`·`how` 쪽은 `route.js` 의 점을 넘어가는데 여기만 `[^.!?\n]*` 라,
   * 파일 이름이 하나 끼면 뒤의 「and fix」 를 못 본다.
   */
  for (const 글 of ['Tell me what is in route.js and fix it.',
    'Show me the config.json and rename it to settings.json.',
    'Explain src/agent/route.js and then refactor it.']) {
    check(`★★★ 이름 속 점 너머의 시킴 마디도 본다 — "${글.slice(0, 34)}…"`,
      route(글).mode !== 'ask', String(route(글).mode));
  }
  check('  그래도 맨 설명 부탁은 묻기다', route('Tell me what is in route.js.').mode === 'ask',
    String(route('Tell me what is in route.js.').mode));

  /*
   * ★★★ 「써 줘」 · 「넣어 주세요」 — 맞춤법대로 띄어 쓰면 0점이었다.
   *
   * 이 파일 위쪽이 손대라는말 에서 이미 배운 것인데(「수정해 줘」), 점수표는
   * 그대로 붙여 쓴 꼴만 알고 있었다. 띄어 쓴 사람만 종합에 남았다.
   */
  for (const 글 of ['README 에 설치 방법 좀 써 줘', '이 함수에 널 체크 넣어 주세요',
    '로그 한 줄 넣어 줘', '설정 예시 좀 써 주세요']) {
    check(`★★★ 띄어 써도 시킴말이다 — "${글}"`, route(글).mode === 'code',
      `${route(글).mode} (${route(글).점수들?.code ?? 0}점)`);
  }

  /*
   * ★★ 차례말 뒤에 쉼표가 붙는다.
   *
   * `After approval,` · `Then,` 은 영어에서 더 흔한 꼴인데 쉼표 하나에
   * 겹침이 아니게 됐다 — 계획을 보여 달라는 절반이 통째로 사라진다.
   */
  for (const 글 of ['Plan the migration. After approval, implement it.',
    'Draft the schema. Then, write the migration.',
    'Outline the work. After that, build it.']) {
    check(`★★ 차례말 뒤 쉼표도 넘는다 — "${글.slice(0, 34)}…"`,
      겹친요청(글).겹침 === true, 겹친요청(글).why);
  }
  check('  쉼표가 없던 꼴은 그대로', 겹친요청('Plan the migration, then implement it').겹침 === true);

  /*
   * ★★★ 부정이 예순 자 밖으로 잘리면 무시됐다.
   *
   * 실행말을 예순 자 안에서 찾아 놓고, 그 뒤의 「하지 마」 도 **같은 예순
   * 자 안에서만** 찾았다. 실행말이 가장자리에 걸리면 부정이 잘려 나가고,
   * 하지 말라는 것을 할지 묻는 승인 창이 뜬다.
   */
  {
    const 글 = '설계하고 사용자 인증 흐름과 토큰 갱신 경로, 그리고 오류 처리 방식까지 문서에 아주 자세히 정리해 두되 구현은 하지 마';
    check('★★★ 부정이 예순 자 가장자리에 걸려도 읽는다', 겹친요청(글).겹침 === false,
      `${겹친요청(글).why} (실행말 ${글.search(/구현/)}자)`);
  }
  check('  가까이 붙은 부정은 그대로', 겹친요청('설계하고 구현은 하지 마').겹침 === false);
  check('  부정이 없으면 그대로 겹침', 겹친요청('설계하고 구현은 해줘').겹침 === true);

  /*
   * ★★★ 「하지는 마」 · 「하진 마」 · 「하지도 마」.
   *
   * 부정 무늬가 `지\s*(?:마|말|않)` 라, '지' 와 '마' 사이에 토씨가 하나
   * 끼거나 줄어든 꼴이 오면 못 읽었다. 하지 말라는 말이 하라는 말이 된다.
   */
  for (const 글 of ['설계하고 구현은 하지는 마', '설계하고 구현 하진 마',
    '설계하고 구현은 하지도 마', '정리하고 추가하지는 마', '검토하고 작성은 하진 마']) {
    check(`★★★ 토씨가 껴도 부정이다 — "${글}"`, 겹친요청(글).겹침 === false,
      겹친요청(글).why);
  }
  check('  「하지만」 은 부정이 아니다', 겹친요청('설계하고 구현은 하지만 검토도 해줘').겹침 === true,
    겹친요청('설계하고 구현은 하지만 검토도 해줘').why);
}


/*
 * ── 셈에는 들어가는데 이름은 안 나오던 검사들 ───────────────────────────
 *
 * 이 두 줄이 파일 중간에 있었다. 그 아래에서 검사를 열여덟 개 더 하는데,
 * 목록은 이미 찍힌 뒤였다. 그래서 그 검사가 깨지면 **끝의 숫자만 1 늘고
 * 어느 검사인지는 아무 데도 안 나왔다.** 무엇이 깨졌는지 모르는 빨간불이다.
 *
 * 검사를 다 끝낸 자리에서 찍는다.
 */
console.log(`\n모드 자동 전환 검사  ${D}(요청을 보고 알맞은 모드로 옮겨 가는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);

console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
