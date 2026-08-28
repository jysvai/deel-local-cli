// 상태줄. 지금 무엇으로, 어디까지 차서 돌고 있는지 한 줄로 보여 준다.
//
// 남의 패키지를 붙이지 않는다. 필요한 숫자는 전부 session 이 이미 갖고 있고,
// 화면 그리기는 ansi.js 만 쓴다. 반입 심사에 새로 설명할 것이 늘지 않게 하려는 뜻이다.
import { c, 눈금게이지, width, clip, cols, mark } from './ansi.js';
import { PROFILES } from '../agent/effort.js';
import { get as workMode, canWrite, 보일이름 } from '../agent/modes.js';
import { isLocalHost, isOffline } from '../safety/network.js';
import { COMPACT_AT, FOLD_AT } from '../agent/compact.js';
import { 말, 언어 } from '../i18n/index.js';
import { 표시 as 승인표시, 고르기 as 승인고르기 } from './approve.js';

// 저장소 주소. package.json 의 repository 와 같아야 한다 — 검사가 지킨다.
export const GITHUB = 'https://github.com/jysvai/deel-local-cli';

// 한 조각씩 따로 만든다. 좁은 화면에서는 뒤에서부터 떨군다.
// 순서 = 중요도 순. 앞쪽이 끝까지 살아남는다.
export const SEGMENTS = {
  /*
   * 경계선 — 소스가 어디로 나가는가.
   *
   * 이 프로그램이 하는 말이 딱 하나다. **내 소스가 이 컴퓨터 밖으로 안 나간다.**
   * 그런데 그 말이 켤 때 머리말에 한 번 뜨고는 스크롤에 밀려 사라졌다. 한 시간
   * 뒤에 /model 로 사내 게이트웨이로 갈아탄 사람은, 화면 어디를 봐도 지금
   * 소스가 밖으로 나가고 있다는 것을 알 수가 없었다.
   *
   * 그래서 한 글자를 상태줄 맨 앞에 박아 둔다. 한 칸이면 좁은 터미널에서도
   * 안 밀린다 — 이건 밀리면 안 되는 것이다.
   *   ⌂  이 컴퓨터 안
   *   ↗  바깥으로 나간다
   * 무슨 뜻인지는 켤 때 머리말에서 한 번 읽고 나면 그 다음부터는 글자만 봐도 안다.
   */
  // 폴더 이름은 사람이 짓는다 — 한글로 길게 짓기도 한다. 안 자르면
  // 이 조각 하나가 상태줄을 통째로 넘겨 줄이 접힌다(모델 이름은 이미 자르고 있었다).
  //
  // 경계 글자를 **폴더 앞에 붙여서** 낸다. 따로 조각을 두면 가운뎃점까지
  // 네 칸을 먹는데, 100칸 터미널에서 그 네 칸 때문에 승인 방식이 짧은 이름
  // ('위험만')으로 접혔다. 안전 표시를 흐리게 만드는 안전 표시는 손해다.
  // 붙여 쓰면 두 칸이고, '어디 폴더에서 · 어디로 나가나' 가 한 덩이로 읽힌다.
  dir: {
    get desc() { return 말('seg.dir'); },
    make: (s) => `${경계표(s)} ${c.gray(clip(base(s.root), 20))}`,
    short: (s) => `${경계표(s)} ${c.gray(clip(base(s.root), 12))}`,
  },

  /*
   * 지금 어느 대화 갈래인가.
   *
   * 갈래를 안 쓰면 **아무것도 안 그린다.** 상태줄은 이미 빽빽해서, 안 쓰는
   * 사람에게까지 한 칸을 더 내주면 좁은 터미널에서 뒤엣것이 떨어져 나간다.
   * 갈래가 둘 이상일 때만 repl 이 session.갈래표 를 채운다(agent/threads.js).
   */
  thread: {
    get desc() { return 말('seg.thread'); },
    make: (s) => (s.갈래표 ? c.hcyan(`⑂ ${clip(s.갈래표, 12)}`) : null),
    short: (s) => (s.갈래표 ? c.hcyan(`⑂ ${clip(s.갈래표, 6)}`) : null),
  },

  /*
   * 모델 이름.
   *
   * 좁을 때 더 줄인다. 사내 게이트웨이 이름은 `databricks-gpt-5-6-luna` 처럼
   * 스물세 칸을 그냥 먹는데, 자리가 없을 때 이것 하나 때문에 **셋째 덩이가
   * 통째로 떨어져 나간다** — 승인 방식이 화면에서 사라진다는 뜻이다.
   * 무엇으로 돌고 있는지는 이미 알고 있다. 내 파일이 안 물어보고 바뀌는지는
   * 지금 봐야 안다. 둘 중 하나를 접어야 하면 이쪽이다.
   */
  model: {
    get desc() { return 말('seg.model'); },
    make: (s) => c.hcyan(clip(s.conn.model, 24)),
    short: (s) => c.hcyan(clip(s.conn.model, 14)),
  },

  /*
   * 모델 급 — 얼마나 알아서 하나 (agent/grade.js).
   *
   * 컨텍스트 게이지 바로 옆에 둔다. 그 둘이 다른 축이라는 것이 화면에서
   * 나란히 보여야 한다 — 창이 128k 인데 급이 '작음' 인 경우가 실제로 있고,
   * 그때 "왜 이렇게 조심스럽게 하지" 의 답이 이 한 글자다.
   *
   * 짐작일 때는 흐리게 그린다. 정한 것과 짐작한 것을 같은 색으로 보여주면,
   * 사람은 프로그램이 확인한 사실이라고 읽는다.
   */
  grade: {
    get desc() { return 말('seg.grade'); },
    make: (s) => {
      const g = 볼만한급(s);
      if (!g) return '';
      const 이름 = 급이름(g.급);
      return g.짐작 ? c.gray(`◈ ${이름}?`) : c.white(`◈ ${이름}`);
    },
    short: (s) => {
      const g = 볼만한급(s);
      if (!g) return '';
      // 첫 글자만. 한글이든 영어든 한 글자면 뜻이 남는다 — 작/보/큼, s/m/l.
      const 첫 = [...급이름(g.급)][0] ?? '';
      return g.짐작 ? c.gray(`◈${첫}?`) : c.white(`◈${첫}`);
    },
  },

  /*
   * 컨텍스트 사용량.
   *
   * 게이지에 **눈금 두 개**를 그어 둔다. 55% 를 넘으면 오래된 도구 결과를 접기
   * 시작하고, 80% 를 넘으면 대화를 요약한다. 둘 다 사람 눈에는 갑자기 일어나는
   * 일이라 — 어느 날 갑자기 "앞선 대화를 줄였습니다" 가 뜨고, 모델이 방금 읽은
   * 파일을 잊는다. 막대가 눈금에 다가가는 것이 보이면 먼저 손을 쓸 수 있다:
   * 못 박아 두거나(/pin), 갈래를 새로 파거나, 지금 하던 것을 먼저 끝내거나.
   *
   * 자리를 코드에 두 번 적지 않는다. compact.js 의 값을 그대로 가져온다 —
   * 문턱을 옮겼는데 화면 눈금만 옛 자리에 남으면, 그 눈금은 거짓말이 된다.
   */
  ctx: {
    get desc() { return 말('seg.ctx'); },
    make: (s) => {
      const { r, pct, tone, b } = 참값(s);
      return `${눈금게이지(r, 10, [FOLD_AT, COMPACT_AT])} ${tone(pct + '%')} ${c.gray(short(b.used) + '/' + short(b.total))}`;
    },
    // 자리가 모자라면 정확한 숫자를 접는다. 게이지와 %가 이미 같은 말을 하고 있다.
    short: (s) => {
      const { r, pct, tone } = 참값(s);
      return `${눈금게이지(r, 10, [FOLD_AT, COMPACT_AT])} ${tone(pct + '%')}`;
    },
  },

  // 지금 무슨 일을 하는 중인가. 파일을 못 바꾸는 모드면 자물쇠를 같이 그린다 —
  // 계획만 세우는 중인지 실제로 고치는 중인지 한눈에 보여야 한다.
  work: {
    get desc() { return 말('seg.work'); },
    make: (s) => {
      const 지금 = s.effectiveWork ? s.effectiveWork() : s.work;
      const w = workMode(지금);
      const 잠김 = !canWrite(지금);
      // 저절로 옮겨 간 것인지 사람이 고른 것인지 구분해서 보여준다.
      // 이게 없으면 "왜 갑자기 읽기만 되지" 를 알 길이 없다.
      const 저절로 = s.routed ? c.gray('~') : '';
      // 모드 이름은 표에 영어가 이미 있다(modes.js 의 en). 화면 말이 영어면 그걸 쓴다 —
      // 굳이 i18n 에 같은 말을 또 적어 두면 언젠가 둘이 갈라진다.
      const 이름 = 보일이름(지금);
      const 잠김말 = 언어() === 'en' ? ' read-only' : ' 읽기만';
      return `${c.hcyan(w.glyph)} ${저절로}${잠김 ? c.green(이름) : c.white(이름)}${잠김 ? c.green(잠김말) : ''}`;
    },
  },

  think: {
    get desc() { return 말('seg.think'); },
    make: (s) => {
      const p = PROFILES[s.effort] ?? PROFILES.save;
      // 배분 이름도 화면 말을 따라간다. 강도(medium)는 어느 말에서나 같은
      // 낱말이라, 여기만 한국어로 남으면 `medium·절약` 처럼 반씩 섞인다.
      const 이름 = 언어() === 'en' ? (p.en ?? p.name) : p.name;
      return `${c.gray('◇')} ${c.white(s.think)}${c.gray('·')}${c.magenta(이름)}`;
    },
    // 배분은 강도보다 덜 급하다. 좁으면 강도만 남긴다.
    short: (s) => `${c.gray('◇')} ${c.white(s.think)}`,
  },

  /*
   * 승인 방식 — 내 파일이 물어보고 바뀌는가, 안 물어보고 바뀌는가.
   *
   * 전에는 `auto` 라는 영문 한 낱말이었다. 옆에 `종합`·`medium·절약` 이 나란히
   * 있으니 셋 다 그냥 '모드' 로 보였고, 그중 하나가 **묻지 않고 파일을 고친다**
   * 는 뜻이라는 것은 화면 어디에도 없었다. 이건 꾸미기가 아니라 안전 표시다.
   */
  mode: {
    get desc() { return 말('seg.mode'); },
    make: (s) => 승인표시(s.mode),
    short: (s) => 승인표시(s.mode, { 짧게: true }),
  },

  tok: {
    get desc() { return 말('seg.tok'); },
    make: (s) => s.usage.in || s.usage.out
      ? c.gray(`↑${short(s.usage.in)} ↓${short(s.usage.out)}`)
      : null,
  },

  /*
   * 이번 대화에서 **내 폴더에 무슨 일이 있었나** — 다른 축이라 따로 묶는다.
   *
   * 셋 다 아무 일도 없으면 아무것도 안 그린다. 갓 켠 화면에 `✎ 0 · ↩ 0` 이
   * 서 있으면 자리만 먹고, 좁은 터미널에서는 그것 때문에 뒤엣것이 떨어져 나간다.
   */
  edits: {
    get desc() { return 말('seg.edits'); },
    make: (s) => (s.changes?.size ? c.white(`✎ ${s.changes.size}`) : null),
  },

  /*
   * 확인한 것 (Verify).
   *
   * 탈이 있으면 빨갛게, 없으면 초록으로. 이게 중요한 이유는 모델이 "다
   * 됐습니다" 로 답을 맺는 것과 **실제로 돌려 본 것**이 다른 일이기 때문이다.
   * 화면에 초록 ✓ 가 없으면 아직 아무도 안 돌려 본 것이다.
   */
  verify: {
    get desc() { return 말('seg.verify'); },
    make: (s) => {
      const v = s.검증;
      if (!v?.돈횟수) return null;
      return v.탈 ? c.hred(`✓${v.확인} ✗${v.탈}`) : c.hgreen(`✓${v.확인}`);
    },
    short: (s) => (s.검증?.돈횟수 ? (s.검증.탈 ? c.hred(`✗${s.검증.탈}`) : c.hgreen(`✓${s.검증.확인}`)) : null),
  },

  /*
   * 되돌릴 수 있는 턴 수.
   *
   * 이 프로젝트는 승인 관문 대신 **되돌리기**로 가기로 했다. 그러면 되돌릴
   * 것이 얼마나 남아 있는지가 안전망의 잔량이다 — 그게 화면 어디에도 없으면
   * "지금 /undo 를 누르면 어디까지 돌아가나" 를 눌러 봐야만 알 수 있다.
   * 이력은 오래되면 잘려 나가므로(undo.js) 이 숫자는 줄어들기도 한다.
   */
  undoable: {
    get desc() { return 말('seg.undoable'); },
    make: (s) => (s.되돌릴턴 > 0 ? c.gray(`↩ ${s.되돌릴턴}`) : null),
  },

  tools: { get desc() { return 말('seg.tools'); }, make: (s) => (s.usage.calls ? c.gray(`호출 ${s.usage.calls}`) : null) },

  skills: {
    get desc() { return 말('seg.skills'); },
    make: (s) => (s.skills?.length ? c.gray(`스킬 ${s.skills.length}`) : null),
  },

  time: {
    get desc() { return 말('seg.time'); },
    make: (s) => {
      const ms = Date.now() - s.startedAt;
      return c.gray(ms < 60000 ? `${Math.round(ms / 1000)}초` : `${Math.round(ms / 60000)}분`);
    },
  },
};

/**
 * 상태줄에 무엇을, 어떤 순서로.
 *
 * 전에는 칸 여섯 개가 같은 굵기의 막대로 나란히 서 있었다.
 *   ▏폴더 ▏모델 ▏게이지 ▏◎ 종합 ▏◇ medium·절약 ▏auto
 * 뒤의 셋은 셋 다 '모드' 처럼 생겨서, 무엇이 무엇인지 읽으려면 멈춰서 세어야 했다.
 *
 * 세 덩이로 묶는다 — **어디서(폴더·모델) · 얼마나 찼나(게이지) · 어떻게 도나(모드)**.
 * 덩이 사이만 굵은 칸막이(▏)로 가르고, 덩이 안은 가운뎃점으로 잇는다.
 * 그러면 눈이 세 번만 멈춘다.
 */
export const SEGMENT_GROUPS = [
  ['dir', 'thread', 'model'],
  ['ctx', 'grade'],
  ['work', 'think', 'mode'],
  // 내 폴더에 무슨 일이 있었나. 아무 일도 없으면 이 덩이는 아예 안 선다.
  ['edits', 'verify', 'undoable'],
  ['tok'],
];

// 옛 이름. 조각 이름을 직접 넘기던 자리(검사·설정)가 그대로 돌게 남긴다.
export const DEFAULT_SEGMENTS = SEGMENT_GROUPS.flat();

/**
 * 이 급을 화면에 낼 값어치가 있나.
 *
 * '보통' 을 짐작으로 잡은 것은 **아무것도 못 알아낸 상태**다. 사내 게이트웨이가
 * 그렇고, 그건 기본값이지 알아낸 사실이 아니다. 그걸 상태줄에 적으면 자리만
 * 먹고, 좁은 터미널에서는 그 한 조각 때문에 승인 방식이 밀려 사라진다 —
 * 내 파일이 안 물어보고 바뀌는지가 화면에서 없어지는 것이라 훨씬 비싸다.
 *
 * 알아낸 것이 있거나(짐작이 아님) 기본이 아닌 급일 때만 낸다.
 */
function 볼만한급(s) {
  if (typeof s.급 !== 'function') return null;
  const g = s.급();
  if (g.급 === '보통' && g.짐작) return null;
  return g;
}

// 컨텍스트 게이지가 쓰는 숫자. 자세한 꼴과 짧은 꼴이 같은 값을 봐야 한다.
function 참값(s) {
  const b = s.breakdown();
  // 넘칠 수는 있지만 화면에 219% 라고 적으면 고장난 것처럼 보인다. 100 에서 멈춘다.
  const r = Math.min(1, b.total > 0 ? b.used / b.total : 0);
  const pct = Math.round(r * 100);
  /*
   * %의 색을 게이지와 **같은 자리에서** 바꾼다.
   *
   * 전에는 0.6·0.85 로 따로 잡혀 있어서, 62% 에서 숫자만 노래지고 눈금은
   * 아직 멀쩡했다. 두 개가 다른 말을 하면 사람은 둘 다 안 믿는다.
   * 이제 접기(55%)·요약(80%) 자리에서 같이 바뀐다 — 색이 바뀌는 그 순간이
   * 실제로 무슨 일이 나는 순간이다.
   */
  const tone = r > COMPACT_AT ? c.hred : r > FOLD_AT ? c.hyellow : c.gray;
  return { b, r, pct, tone };
}

/**
 * 경계 한 글자.
 *
 * 못 읽는 주소면 아무것도 안 그린다. 여기서 애매하면 **초록을 안 쓴다** —
 * 초록은 '안 나간다' 는 약속이고, 확인 못 한 것을 확인한 낯으로 내밀면 안 된다.
 */
function 경계표(s) {
  let 로컬 = null;
  try { 로컬 = isLocalHost(new URL(s.conn.base).hostname); } catch { 로컬 = null; }
  if (로컬 === null) return c.gray('?');
  if (!로컬) return c.hyellow('↗');
  // 오프라인 잠금은 '이 안' 보다 더 센 상태지만 글자는 같게 둔다 — 사람이
  // 봐야 하는 판단은 '나가나 안 나가나' 하나뿐이고, 그 위에 글자를 하나 더
  // 얹으면 정작 그 판단이 흐려진다. 잠금 여부는 켤 때 머리말에 적힌다.
  return c.hgreen('⌂');
}

function base(p) {
  const parts = String(p ?? '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? '~';
}

// 12345 → 12.1k.  상태줄은 자리가 없다.
//
// 1000 이 아니라 1024 로 나눈다. 컨텍스트 길이는 죄다 2의 거듭제곱이라
// 1000 으로 나누면 131,072 가 '131k' 로 나온다 — 아무도 그렇게 안 부른다.
// 1024 로 나눠야 128k · 32k · 640k 처럼 실제로 부르는 이름이 나온다.
// 무엇보다 /ctx 가 받는 단위와 같아야 한다. 화면에 655k 라고 띄워 놓고
// 655k 를 치면 다른 값이 되는 게 가장 나쁘다.
function short(n) {
  const v = Number(n) || 0;
  if (v < 1024) return String(v);
  if (v < 1024 * 1024) return (v / 1024).toFixed(v < 10240 ? 1 : 0) + 'k';
  return (v / (1024 * 1024)).toFixed(1) + 'M';
}

/**
 * 상태줄 한 줄을 만든다. 폭이 모자라면 덜 중요한 조각부터 뺀다.
 * @param {import('../agent/session.js').Session} session
 */
export function statusLine(session, { segments = null, max = cols() - 2 } = {}) {
  const 칸막이 = ` ${c.gray('▏')} `;
  const 안쪽 = c.gray(' · ');

  // 설정으로 조각 이름을 직접 준 경우에는 그대로 한 줄로 잇는다(옛 방식).
  const 덩이들 = segments
    ? segments.map((k) => [k])
    : SEGMENT_GROUPS;

  const 그리기 = (짧게, 뺄것 = null) => 덩이들
    .map((그룹) => 그룹
      .map((k) => {
        if (뺄것?.has(k)) return null;
        const seg = SEGMENTS[k];
        if (!seg) return null;
        return 짧게 && seg.short ? seg.short(session) : seg.make(session);
      })
      .filter((x) => x != null && x !== '')
      .join(안쪽))
    .filter((x) => x !== '');

  const 맞나 = (ps) => width(ps.join(칸막이)) + 2 <= max;

  /*
   * 떨구기 전에 **먼저 줄여 본다.**
   *
   * 처음엔 곧바로 뒤에서부터 떨궜다. 그러면 80칸 터미널에서 모델 이름이 조금만
   * 길어도 '어떻게 도나'(모드·강도·승인) 덩이가 통째로 사라졌다 — 세 덩이로
   * 묶어 놓고 정작 세 번째를 못 보는 화면이 된 것이다.
   *
   * 컨텍스트의 '20k/32k' 는 게이지·%와 같은 말을 하고, 배분 이름은 강도보다
   * 덜 급하다. 그 둘을 접으면 대개 다시 들어간다. 정보를 통째로 잃는 것보다
   * 덜 급한 자리를 접는 편이 낫다.
   */
  let parts = 그리기(false);
  if (!맞나(parts)) parts = 그리기(true);

  /*
   * 그래도 모자라면 **급부터** 접는다.
   *
   * 뒤에서부터 떨구면 승인 방식이 먼저 사라진다. 모델 급은 알아 두면 좋은
   * 것이고, 승인 방식은 지금 봐야 하는 것이다 — 내 파일이 안 물어보고 바뀌는지가
   * 거기 적혀 있다. 둘 중 하나를 접어야 하면 언제나 이쪽이다.
   */
  if (!맞나(parts) && !segments) parts = 그리기(true, new Set(['grade']));

  // 여전히 모자라면 뒤에서부터 떨군다. 앞쪽(폴더·모델·컨텍스트)이 마지막까지 남는다.
  while (parts.length > 1 && !맞나(parts)) parts.pop();

  return ` ${c.gray('▏')}${parts.join(칸막이)}`;
}

// 컨텍스트가 위험하면 한마디 붙인다. 상태줄만 보고 넘기지 않도록.
export function contextWarning(session) {
  const b = session.breakdown();
  const r = Math.min(1, b.total > 0 ? b.used / b.total : 0);
  if (r > 0.9) return `${mark.warn} 컨텍스트 ${Math.round(r * 100)}% — ${c.cyan('/compact')} 또는 ${c.cyan('/clear')} 를 권합니다.`;
  if (r > 0.8) return `${c.gray('컨텍스트 ' + Math.round(r * 100) + '% — 곧 오래된 대화를 줄입니다.')}`;
  return null;
}

/**
 * 켤 때 한 번 그리는 머리말 상자 안쪽 줄들.
 */
/** 머리말 모델 줄에 붙는 급 표시. 못 매기면 아무것도 안 붙는다. */
/** 급 이름을 화면 말로. 표에는 한글 id 로 들어 있다(agent/grade.js). */
export function 급이름(급) {
  const 짝 = { 작음: 'grade.small', 보통: 'grade.medium', 큼: 'grade.large' }[급];
  return 짝 ? 말(짝) : String(급 ?? '');
}

function 급머리말(session) {
  if (typeof session.급 !== 'function') return '';
  const g = session.급();
  return c.gray(말('head.gradeSuffix', {
    급: 말('head.grade'),
    급이름: 급이름(g.급),
    짐작: g.짐작 ? ` ${말('head.guess')}` : '',
  }));
}

/**
 * 켤 때 한 번 보여 주는 머리말.
 *
 * @param {boolean} 상자쓰나 입력 상자를 쓰는 화면인가. Shift+Tab · Alt+Enter ·
 *   줄 끝 백틱은 전부 상자 안에서만 도는 것이라(repl.js 의 `if (상자쓰나)`),
 *   줄 화면(`--no-tui`·파이프·CI)에서 이 줄들을 그대로 찍으면 **되지도 않는
 *   조작법을 알려 주는 셈**이 된다. 안 되는 것을 알려 주는 안내는 없느니만 못하다.
 */
export function headerLines(session, found, 상자쓰나 = true) {
  const conn = session.conn;
  const 능력 = [
    conn.streaming ? c.green(말('head.streaming')) : c.gray(말('head.noStreaming')),
    conn.tools ? c.green(말('head.tools')) : c.yellow(말('head.toolsUnknown')),
    conn.think ? c.green(말('head.thinkCtl')) : c.gray(말('head.noThinkCtl')),
  ].join(c.gray(' · '));

  // 코딩 에이전트는 소스를 통째로 모델에 보낸다. '어디로' 가 가장 중요한 한 줄이다.
  let 목적지;
  try {
    const u = new URL(conn.base);
    const 로컬 = isLocalHost(u.hostname);
    목적지 = `${로컬 ? c.green(말('head.inside')) : c.yellow(말('head.outside'))} ${c.white(u.host)}`
      + (isOffline() ? c.green(`  ${말('head.offlineLock')}`) : '');
  } catch { 목적지 = c.gray(String(conn.base)); }

  /*
   * 이름칸 폭을 **말에 맞춰 잰다.**
   *
   * 8칸으로 못 박아 두었더니 영어에서 'approval'(8칸)만 한 칸도 못 벌려
   * 그 줄만 오른쪽으로 밀렸다. 다른 말을 넣을 때마다 이 숫자를 다시 고르게
   * 하는 대신, 제일 긴 이름에서 뽑는다.
   */
  const 이름들 = ['head.model', 'head.send', 'head.conn', 'head.folder', 'head.approve', 'head.thisPC'];
  const 이름칸 = Math.max(...이름들.map((k) => width(말(k)))) + 2;
  const 자리 = (글) => `${글}${' '.repeat(Math.max(1, 이름칸 - width(글)))}`;
  const 빈자리 = ' '.repeat(이름칸);
  const lines = [
    `${c.hcyan(c.bold('deel'))}  ${c.gray(말(conn.kind === 'ollama' ? 'head.spec.ollama' : 'head.spec.openai'))}`,
    '',
    /*
     * 모델 줄에 급을 같이 적는다.
     *
     * 창 크기(토큰)와 급은 다른 축인데, 켤 때 이 둘을 나란히 보지 않으면
     * 나중에 상태줄의 `◈ 작음?` 이 무슨 뜻인지 알 길이 없다. 여기서 한 번
     * 같이 읽고 나면 그 다음부터는 글자만 봐도 안다.
     * 짐작이면 그렇다고 적는다 — 알아낸 사실과 같은 낯으로 내밀면 안 된다.
     */
    `${c.gray(자리(말('head.model')))}${c.white(conn.model)}  ${c.gray(`(${short(conn.ctx)} ${말('head.tokens')}`)}`
      + `${급머리말(session)}${c.gray(')')}`,
    /*
     * 상태줄 맨 앞의 한 글자가 무슨 뜻인지 여기서 한 번 가르친다.
     *
     * 승인 표시(⏵⏵)·급(◈)에 하던 것과 같은 방식이다. 켤 때 한 번 사람 말로
     * 읽고 나면, 그 뒤로는 글자만 봐도 안다. 이 한 글자는 스크롤에 안 밀린다 —
     * 그게 이 머리말 한 줄과 다른 점이고, 이 줄을 넣은 이유다.
     */
    `${c.gray(자리(말('head.send')))}${목적지}  ${c.gray(말('head.nowhereElse'))}`,
    `${빈자리}${c.gray(말('head.glyphHint', { 안: c.hgreen('⌂'), 밖: c.hyellow('↗') }))}`,
    `${c.gray(자리(말('head.conn')))}${능력}`,
    `${c.gray(자리(말('head.folder')))}${c.white(clip(session.root, 56))}`,
    // 켤 때 한 번은 사람 말로 알려 준다. 상태줄의 `⏵⏵ 자동 승인` 이 무슨
    // 뜻인지 여기서 한 번 읽고 나면 그 다음부터는 글자만 봐도 안다.
    `${c.gray(자리(말('head.approve')))}${승인표시(session.mode)}  ${c.gray('— ' + 승인고르기(session.mode).한줄)}`,
  ];
  if (상자쓰나) {
    lines.push(`${빈자리}${c.gray(말('head.shiftTab'))}${c.gray(말('head.shiftTabHint'))}${c.gray(말('head.tabHint'))}`);
    lines.push(`${빈자리}${c.gray(말('head.newlineHint'))}`);
  }
  if (found.skills.length || found.commands.length) {
    lines.push(`${c.gray(자리(말('head.thisPC')))}${c.white(말('head.skills', { n: found.skills.length }))}${c.gray(' · ')}${c.white(말('head.commands', { n: found.commands.length }))}${c.gray(' · ')}${c.white(말('head.plugins', { n: found.plugins.length }))}`);
  }
  /*
   * 별 부탁 한 줄.
   *
   * 맨 아래에 둔다. 위쪽은 **어디로 소스가 나가는지**를 읽는 자리라, 그
   * 사이에 부탁을 끼우면 정작 읽어야 할 줄이 묻힌다.
   *
   * 회색 한 줄로만 둔다. 켤 때마다 나오는 것이라, 눈에 띄게 만들면 열 번째
   * 켤 때부터는 부탁이 아니라 방해가 된다.
   *
   * 사람이 보고 있을 때만 낸다. 상자를 쓰나(상자쓰나)가 아니라 화면이 터미널인가로
   * 가른다 — `--no-tui` 로 쓰는 사람도 사람이지만, 파이프·CI 로 흘러 들어가는
   * 기록에 부탁 줄이 섞이면 그건 그냥 잡음이다.
   */
  if (process.stdout.isTTY) {
    lines.push('');
    lines.push(`${빈자리}${c.gray(말('head.star'))} ${c.cyan(GITHUB)}`);
  }
  return lines;
}
