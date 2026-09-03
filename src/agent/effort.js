// 추론 강도를 '한 값' 이 아니라 '단계별' 로 나눈다.
//
// 왜 나누나:
//   에이전트 한 번의 대답은 모델을 여러 번 부른다. 그런데 부를 때마다 필요한 생각의 양이 다르다.
//   - 처음: 무엇을 할지 정한다. 여기서 틀리면 뒤가 전부 헛돈다. → 세게
//   - 중간: 파일을 읽고 "그래서 다음 한 수" 만 둔다. → 얕아도 된다
//   - 막힘: 도구가 오류를 냈다. 얕게 생각하면 같은 실수를 또 한다. → 세게
//   전부 똑같이 세게 두면 느리고, 전부 얕게 두면 엉뚱한 길로 간다.

import { 언어 } from '../i18n/index.js';

/*
 * 눈금이 여섯이다.
 *
 * `xhigh` 가 늘었다. Claude 계열이 실제로 받는 눈금이 low·medium·high·xhigh·
 * max 다섯인데, 우리 눈금이 넷뿐이라 `high` 와 `max` 사이가 통째로 비어
 * 있었다. 그 사이가 하필 **코딩·에이전트 작업에 제일 잘 맞는 자리**다.
 *
 * 받는 곳이 없는 전선에서는 있는 것 중 가장 가까운 아래로 내려간다
 * (backend/wire.js 의 눈금맞추기). 그러니 눈금을 늘려도 못 받는 서버에서
 * 400 이 나지 않는다.
 */
export const LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

/*
 * 단계 이름은 화면에 그대로 나간다. 그래서 영어 이름을 여기 같이 둔다 —
 * modes.js 의 en 과 같은 방식이다. i18n 표에 같은 말을 또 적어 두면
 * 단계를 하나 늘릴 때 한쪽만 늘어나서 화면에 빈칸이 뜬다.
 */
export const STAGES = {
  plan: { label: '첫 판단', why: '무엇을 할지 정하는 자리', en: 'First call', whyEn: 'Deciding what to do' },
  work: { label: '이어가기', why: '도구 결과를 읽고 다음 한 수', en: 'Continue', whyEn: 'Reading a tool result, picking the next move' },
  fix: { label: '막혔을 때', why: '직전 도구가 오류를 냄', en: 'Stuck', whyEn: 'The last tool returned an error' },
};

// shift = 기준 강도에서 몇 칸 올리고 내릴지.
// share = 남은 컨텍스트 중 이 단계의 출력에 내줄 비율.
//
// 출력 상한을 숫자로 못 박으면 안 된다. 컨텍스트 4k 짜리 모델에 4096 을 주면
// 입력 자리가 하나도 안 남고, 200k 짜리 모델에는 턱없이 모자란다.
// 그래서 '남은 자리의 몇 %' 로 정하고, 아래위로만 울타리를 친다.
//
// share 를 왜 넉넉히 잡나 — 여기서 한 번 잘못 알고 있었다:
//   상한은 '쓸 예산' 이 아니라 '넘지 못하는 선' 이다. 상한을 작게 잡아도 모델이
//   짧게 답하면 토큰은 그만큼만 나간다. 아끼는 효과가 없다. 반대로 답이 그 선에
//   닿으면 **말이 중간에서 끊긴다.** 즉 share 를 조이면 아끼는 게 아니라 자르는 것이다.
//
//   실제로 그래서 파일이 안 만들어졌다. 이어가기(work) 가 0.15 였는데, 파일을 쓰는
//   호출은 대개 이 단계에서 나온다. 32k 모델에서 4,600 토큰 — 1,000줄짜리 HTML 은
//   그 세 배가 필요하다. 매번 같은 자리에서 잘렸다.
//
//   다음 턴이 들어갈 자리는 아래 tokensFor 의 room/2 가 이미 지킨다. 그러니 여기서
//   또 조일 이유가 없다. 단계별 차이는 남겨 두되, 어느 단계든 한 번은 쓸 만큼 준다.
export const PROFILES = {
  even: {
    name: '균일',
    // 화면 말이 영어일 때 쓰는 이름. modes.js 의 en 과 같은 방식이다 —
    // i18n 표에 같은 말을 또 적어 두면 언젠가 둘이 갈라진다.
    en: 'even',
    desc: '모든 단계 같은 강도 — 예측 가능한 대신 느립니다',
    descEn: 'Same effort at every stage - predictable, but slower',
    shift: { plan: 0, work: 0, fix: 0 },
    share: { plan: 0.40, work: 0.40, fix: 0.40 },
  },
  save: {
    name: '절약',
    en: 'save',
    desc: '첫 판단만 세게, 이어가기는 얕게 — 대개 이게 낫습니다',
    descEn: 'Hard on the first call, shallow while continuing - usually the better trade',
    shift: { plan: 0, work: -1, fix: +1 },
    share: { plan: 0.40, work: 0.35, fix: 0.45 },
  },
  deep: {
    name: '깊게',
    en: 'deep',
    desc: '전 단계 한 칸씩 위로 — 어려운 일에만',
    descEn: 'Every stage one notch up - for hard work only',
    shift: { plan: +1, work: 0, fix: +1 },
    share: { plan: 0.50, work: 0.45, fix: 0.50 },
  },
};

// 울타리.
// 아래: 이보다 작으면 도구 호출 한 개도 못 뱉는다. 생각을 많이 하는 모델은 더 필요하다.
export const MIN_CAP = 512;
/**
 * 출력 상한을 **모를 때** 쓰는 값.
 *
 * 컨텍스트가 128k 라도 '한 번에 낼 수 있는 출력' 은 대개 훨씬 작다. 모델 한계보다
 * 큰 max_tokens 를 보내면 그냥 거부하는 게이트웨이가 있어서, 모르면 이 선에 선다.
 *
 * **아는 값이 있으면 이 값은 비켜선다.** 전에는 그게 안 됐다 —
 *   Math.min(cap, max ?? MAX_CAP, MAX_CAP)
 * 세 번째 인자가 무조건 다시 조여서, 사용자가 적어 둔 max 는 낮출 수만 있고
 * 올릴 수는 없었다. /ctx out 200k 를 해도 16,384 였다. 그런데 주석도 README 도
 * /ctx 안내도 셋 다 '올릴 수 있다' 고 말했다. 문서에 적힌 탈출구가 막혀 있었던 것이다.
 *
 * 아는 값은 두 곳에서 온다 — 사용자가 정한 것(/out)과 서버에서 알아낸 것(backend/ctxsize).
 */
export const MAX_CAP = 16384;

const ALIAS = { 균일: 'even', 절약: 'save', 깊게: 'deep', uniform: 'even', thrifty: 'save' };

export function normalizeProfile(v) {
  const k = String(v ?? '').trim().toLowerCase();
  return PROFILES[k] ? k : (ALIAS[String(v ?? '').trim()] ?? null);
}

// 기준 강도에서 몇 칸 옮긴다. 끝을 넘지 않는다.
export function shiftLevel(level, by) {
  const i = LEVELS.indexOf(level);
  if (i < 0) return level;
  return LEVELS[Math.min(LEVELS.length - 1, Math.max(0, i + by))];
}

/**
 * 이번 호출에 쓸 강도.
 * off 는 사람이 "생각 끄기" 를 고른 것이므로 어떤 단계에서도 켜지 않는다.
 *
 * `고정` 은 **단계별로 안 움직인다** 는 뜻이다. 바깥 모델에 붙었을 때 켠다.
 *
 *   왜: 생각 설정이 요청마다 달라지면 그 자체로 캐시가 깨진다. 걸음마다
 *   plan → work → fix 로 눈금을 옮기면, 걸음마다 대화 전체가 다시 나간다.
 *   한 걸음 얕게 생각해서 아끼는 것보다 60k 짜리 앞머리를 다시 보내는 값이
 *   훨씬 크다. 로컬 모델은 자기 KV 캐시를 쓰고 토큰 값을 따로 안 내므로
 *   여태 하던 대로 단계별로 움직인다.
 */
export function effortFor(base, profileKey, stage, { 고정 = false } = {}) {
  if (base === 'off') return 'off';
  if (고정) return base;
  const p = PROFILES[normalizeProfile(profileKey) ?? 'save'];
  return shiftLevel(base, p.shift[stage] ?? 0);
}

/*
 * ── 시킨 말에 따라 강도를 고른다 ────────────────────────────────────────
 *
 * `/think max` 는 「언제나 max 로 생각해라」 가 아니라 「필요하면 max 까지
 * 써도 된다」 는 뜻이다. 사람이 정한 값은 **천장**이지 고정값이 아니다.
 *
 * 「안녕」 한 마디에 max 로 생각하면 답이 느려지고 값만 나간다. 생각 토큰은
 * 출력 단가로 나가서, 그 한 마디가 실제로 제일 비싼 토큰이 된다.
 *
 * ── 언제 안 움직이나 ────────────────────────────────────────────────────
 *
 * 대화가 이미 쌓였으면 **천장 그대로 둔다.** 강도가 바뀌면 캐시가 깨지는데,
 * 60k 짜리 앞머리를 다시 보내는 값이 짧은 턴 하나에서 아끼는 값보다 훨씬
 * 크기 때문이다. 아끼자고 한 일이 더 쓰는 일이 되면 안 된다.
 */

/** 대화가 이만큼 쌓이면 강도를 더 안 움직인다 — 그때부터는 캐시가 더 비싸다. */
export const 유지문턱 = 8;

/** 인사·맞장구. 시킨 일이 없으면 깊이 생각할 것도 없다. */
export const 인사말 = /^(안녕[가-힣]*|반(가|갑)[가-힣]*|하이|ㅎㅇ+|헬로[우가-힣]*|고마[가-힣]*|감사[가-힣]*|수고[가-힣]*|hi|hello|hey|yo|thanks?|thank you|테스트|test|ok(ay)?|네|응)[\s!.~?ㅎㅋ,]*$/i;

export function 인사인가(글) {
  return 인사말.test(String(글 ?? '').trim());
}

/** 일을 시키는 말인가 — 이게 있으면 가벼운 턴이 아니다. */
const 일하는말 = /고쳐|고치|만들|수정|추가|삭제|지워|구현|리팩|바꿔|정리|실행|돌려|테스트|빌드|배포|커밋|설치|분석|찾아|검토|계획|write|edit|create|fix|add|remove|delete|implement|refactor|run|build|deploy|commit|install|analy[sz]e|review|plan/i;
/** 경로·파일 이름·지목(@)이 보이면 코드를 만지는 턴이다. */
const 경로같은것 = /[\\/]|@|\.(js|mjs|cjs|ts|tsx|jsx|py|java|kt|go|rs|rb|php|cs|c|h|cpp|md|json|ya?ml|toml|css|html|sh|ps1|sql)\b/i;

/**
 * 깊이 생각할 것 없는 가벼운 말인가.
 *
 * 넉넉하게 잡는다 — 헷갈리면 「가볍지 않다」 쪽이다. 잘못 낮추면 진짜 일이
 * 얕게 처리되는데, 그 손해가 토큰 몇 푼보다 훨씬 크다.
 */
export function 가벼운가(글) {
  const s = String(글 ?? '').trim();
  if (!s) return false;
  if (인사인가(s)) return true;
  if (s.length > 60) return false;
  if (일하는말.test(s) || 경로같은것.test(s)) return false;
  // 줄이 여럿이면 붙여넣은 것이다 — 짧아 보여도 가벼운 말이 아니다.
  if (s.includes('\n')) return false;
  return true;
}

/**
 * 이번 턴의 기준 강도.
 *
 * @param {string} 요청     사람이 이번에 친 말
 * @param {string} 천장     사람이 정한 강도 (이보다 위로는 절대 안 간다)
 * @param {object} o
 * @param {number} o.대화크기  지금까지 쌓인 메시지 수 (캐시를 지킬지 정한다)
 * @param {boolean} o.켜짐    자동 조절을 쓰나 (`/think auto` 로 끈다)
 */
export function 자동강도(요청, 천장, { 대화크기 = 0, 켜짐 = true } = {}) {
  const 기준 = LEVELS.includes(천장) ? 천장 : 'medium';
  if (!켜짐 || 기준 === 'off') return 기준;
  const s = String(요청 ?? '').trim();
  if (!s) return 기준;
  // 대화가 쌓인 뒤에는 안 움직인다. 캐시를 지키는 쪽이 이긴다.
  if (대화크기 >= 유지문턱) return 기준;
  if (!가벼운가(s)) return 기준;
  const 바라는것 = 인사인가(s) ? 'low' : 'medium';
  // 천장 위로는 안 올린다 — 사람이 낮게 잡아 뒀으면 그 뜻을 지킨다.
  return 아래로만(바라는것, 기준);
}

/** 천장 아래로만 내린다. 위로는 절대 안 간다. */
function 아래로만(바라는것, 천장) {
  return LEVELS.indexOf(바라는것) < LEVELS.indexOf(천장) ? 바라는것 : 천장;
}

/**
 * 이 천장에서 **가벼운 말**이 받게 될 강도.
 *
 * `/think` 화면이 「max 라고 정했는데 왜 medium 인가」 에 답하려면 이 값이
 * 필요하다. 여태는 화면이 빈 글로 자동강도()를 불러서 늘 천장이 돌아왔고,
 * 그래서 「가벼운 말은 max 까지 낮춰 씁니다」 라는 말이 안 되는 줄이 떴다.
 *
 * 여기서 실제로 나가는 값을 셈하지는 않는다 — 그건 사람이 무엇을 치느냐에
 * 달렸다. 이 함수가 답하는 것은 **가장 낮게 갈 수 있는 자리**다.
 */
export function 가벼운강도(천장, { 켜짐 = true } = {}) {
  const 기준 = LEVELS.includes(천장) ? 천장 : 'medium';
  if (!켜짐 || 기준 === 'off') return 기준;
  return 아래로만('low', 기준);
}

/**
 * 이번 호출에 내줄 출력 토큰 상한.
 *
 * 모델마다 다르다. 컨텍스트가 얼마인지, 지금 얼마나 차 있는지에 따라 남는 자리가 다르고
 * 그 남는 자리 안에서만 답을 받을 수 있다. 고정 숫자를 쓰면 작은 모델에서는 입력이 밀리고
 * 큰 모델에서는 답이 잘린다.
 *
 * @param {object} o
 * @param {number} o.ctx   모델 컨텍스트 (conn.ctx)
 * @param {number} o.used  지금 쓰고 있는 양 (session.breakdown().used)
 * @param {number} o.max   사용자가 프로필에 직접 적어 둔 상한이 있으면 그것을 넘지 않는다
 */
export function tokensFor(profileKey, stage, { ctx = 0, used = 0, max = null } = {}) {
  const p = PROFILES[normalizeProfile(profileKey) ?? 'save'];
  const share = p.share[stage] ?? 0.3;

  // 컨텍스트를 모르면(진단 전) 보수적으로 잡는다.
  const room = ctx > 0 ? Math.max(0, ctx - used) : 4096;

  let cap = Math.floor(room * share);
  // 남은 자리의 절반을 넘겨 주지 않는다. 답이 길어져도 다음 턴이 들어갈 자리는 남겨야 한다.
  cap = Math.min(cap, Math.floor(room / 2));
  // 아는 상한이 있으면 그것을 따른다. 모를 때만 MAX_CAP 에 선다.
  cap = Math.min(cap, max ?? MAX_CAP);
  cap = Math.max(cap, MIN_CAP);
  // 남은 자리 자체가 바닥이면 울타리 아래라도 남은 만큼만 준다.
  return room > 0 ? Math.min(cap, Math.max(MIN_CAP, room)) : MIN_CAP;
}

/** 잘렸을 때 풀어 줄 최대 상한 — 남은 자리를 거의 다 내준다. */
export function fullCap({ ctx = 0, used = 0, max = null } = {}) {
  const room = ctx > 0 ? Math.max(0, ctx - used) : 4096;
  return Math.max(MIN_CAP, Math.min(Math.floor(room * 0.8), max ?? MAX_CAP));
}

/**
 * 잘린 응답인가. 잘린 채로 넘어가면 도구 호출이 반토막 나서 조용히 실패한다.
 *
 * finish_reason 만 보면 안 된다. 사내 게이트웨이나 중계 서버는 잘라 놓고도
 * 'stop' 이라고 하는 경우가 실제로 있다. 그러면 상한을 올려 다시 부를 기회를
 * 놓친 채 반토막 호출이 그냥 지나간다.
 *
 * 그런데 인자 JSON 이 깨진 것 자체가 잘렸다는 증거다 — 모델은 반쪽짜리 JSON 을
 * 일부러 만들지 않는다. 그래서 말을 안 해 줘도 이걸 보고 안다.
 */
export function wasCut(msg) {
  const s = String(msg?.stopped ?? '');
  if (s === 'length' || s === 'max_tokens' || s === 'MAX_TOKENS') return true;
  return (msg?.toolCalls ?? []).some((t) => t?.argsBroken);
}

// 화면에 보여줄 표. 상한은 지금 붙어 있는 모델 기준으로 계산해서 보여준다 —
// 모델을 바꾸면 이 숫자도 같이 바뀐다.
export function table(base, profileKey, room = {}) {
  const key = normalizeProfile(profileKey) ?? 'save';
  const p = PROFILES[key];
  /*
   * 화면 말이 한국어가 아니면 영어 이름으로 낸다.
   *
   * 여태 이 표는 언제나 한국어였다. /lang en 으로 켠 사람은 「단계 강도
   * 출력상한」 옆에 「첫 판단·이어가기·막혔을 때」 가 서 있는 화면을 봤다 —
   * 표의 틀만 영어고 알맹이가 한국어면 아무것도 안 읽힌다.
   *
   * 일본어·중국어도 영어로 간다. i18n 의 물러날곳(ja→en→ko)과 같은 규칙이다.
   */
  const 한국어 = 언어() === 'ko';
  return {
    key,
    name: 한국어 ? p.name : (p.en ?? p.name),
    desc: 한국어 ? p.desc : (p.descEn ?? p.desc),
    ctx: room.ctx ?? 0,
    used: room.used ?? 0,
    rows: Object.entries(STAGES).map(([stage, s]) => ({
      stage,
      label: 한국어 ? s.label : (s.en ?? s.label),
      why: 한국어 ? s.why : (s.whyEn ?? s.why),
      level: effortFor(base, key, stage),
      cap: tokensFor(key, stage, room),
      share: p.share[stage],
      moved: p.shift[stage],
    })),
  };
}
