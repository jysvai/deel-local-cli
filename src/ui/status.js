// 상태줄. 지금 무엇으로, 어디까지 차서 돌고 있는지 한 줄로 보여 준다.
//
// 남의 패키지를 붙이지 않는다. 필요한 숫자는 전부 session 이 이미 갖고 있고,
// 화면 그리기는 ansi.js 만 쓴다. 반입 심사에 새로 설명할 것이 늘지 않게 하려는 뜻이다.
import { c, gauge, width, clip, cols, mark } from './ansi.js';
import { PROFILES } from '../agent/effort.js';
import { get as workMode, canWrite } from '../agent/modes.js';
import { isLocalHost, isOffline } from '../safety/network.js';

// 한 조각씩 따로 만든다. 좁은 화면에서는 뒤에서부터 떨군다.
// 순서 = 중요도 순. 앞쪽이 끝까지 살아남는다.
export const SEGMENTS = {
  // 폴더 이름은 사람이 짓는다 — 한글로 길게 짓기도 한다. 안 자르면
  // 이 조각 하나가 상태줄을 통째로 넘겨 줄이 접힌다(모델 이름은 이미 자르고 있었다).
  dir: { desc: '작업 폴더', make: (s) => c.gray(clip(base(s.root), 20)) },

  model: { desc: '모델 이름', make: (s) => c.hcyan(clip(s.conn.model, 24)) },

  ctx: {
    desc: '컨텍스트 사용량',
    make: (s) => {
      const { r, pct, tone, b } = 참값(s);
      return `${gauge(r, 10)} ${tone(pct + '%')} ${c.gray(short(b.used) + '/' + short(b.total))}`;
    },
    // 자리가 모자라면 정확한 숫자를 접는다. 게이지와 %가 이미 같은 말을 하고 있다.
    short: (s) => {
      const { r, pct, tone } = 참값(s);
      return `${gauge(r, 10)} ${tone(pct + '%')}`;
    },
  },

  // 지금 무슨 일을 하는 중인가. 파일을 못 바꾸는 모드면 자물쇠를 같이 그린다 —
  // 계획만 세우는 중인지 실제로 고치는 중인지 한눈에 보여야 한다.
  work: {
    desc: '작업 모드',
    make: (s) => {
      const 지금 = s.effectiveWork ? s.effectiveWork() : s.work;
      const w = workMode(지금);
      const 잠김 = !canWrite(지금);
      // 저절로 옮겨 간 것인지 사람이 고른 것인지 구분해서 보여준다.
      // 이게 없으면 "왜 갑자기 읽기만 되지" 를 알 길이 없다.
      const 저절로 = s.routed ? c.gray('~') : '';
      return `${c.hcyan(w.glyph)} ${저절로}${잠김 ? c.green(w.name) : c.white(w.name)}${잠김 ? c.green(' 읽기만') : ''}`;
    },
  },

  think: {
    desc: '추론 강도·배분',
    make: (s) => {
      const p = PROFILES[s.effort] ?? PROFILES.save;
      return `${c.gray('◇')} ${c.white(s.think)}${c.gray('·')}${c.magenta(p.name)}`;
    },
    // 배분은 강도보다 덜 급하다. 좁으면 강도만 남긴다.
    short: (s) => `${c.gray('◇')} ${c.white(s.think)}`,
  },

  mode: {
    desc: '실행 모드',
    make: (s) => {
      const tone = s.mode === 'auto' ? c.hyellow : s.mode === 'strict' ? c.hgreen : c.white;
      return tone(s.mode);
    },
  },

  tok: {
    desc: '주고받은 토큰',
    make: (s) => s.usage.in || s.usage.out
      ? c.gray(`↑${short(s.usage.in)} ↓${short(s.usage.out)}`)
      : null,
  },

  tools: { desc: '도구 호출 수', make: (s) => (s.usage.calls ? c.gray(`호출 ${s.usage.calls}`) : null) },

  skills: {
    desc: '이 PC 에서 찾은 스킬',
    make: (s) => (s.skills?.length ? c.gray(`스킬 ${s.skills.length}`) : null),
  },

  time: {
    desc: '켠 지 얼마나',
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
  ['dir', 'model'],
  ['ctx'],
  ['work', 'think', 'mode'],
  ['tok'],
];

// 옛 이름. 조각 이름을 직접 넘기던 자리(검사·설정)가 그대로 돌게 남긴다.
export const DEFAULT_SEGMENTS = SEGMENT_GROUPS.flat();

// 컨텍스트 게이지가 쓰는 숫자. 자세한 꼴과 짧은 꼴이 같은 값을 봐야 한다.
function 참값(s) {
  const b = s.breakdown();
  // 넘칠 수는 있지만 화면에 219% 라고 적으면 고장난 것처럼 보인다. 100 에서 멈춘다.
  const r = Math.min(1, b.total > 0 ? b.used / b.total : 0);
  const pct = Math.round(r * 100);
  const tone = r > 0.85 ? c.hred : r > 0.6 ? c.hyellow : c.gray;
  return { b, r, pct, tone };
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

  const 그리기 = (짧게) => 덩이들
    .map((그룹) => 그룹
      .map((k) => {
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

  // 그래도 모자라면 뒤에서부터 떨군다. 앞쪽(폴더·모델·컨텍스트)이 마지막까지 남는다.
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
export function headerLines(session, found) {
  const conn = session.conn;
  const 능력 = [
    conn.streaming ? c.green('스트리밍') : c.gray('스트리밍 없음'),
    conn.tools ? c.green('도구') : c.yellow('도구 미확인'),
    conn.think ? c.green('추론 조절') : c.gray('추론 조절 없음'),
  ].join(c.gray(' · '));

  // 코딩 에이전트는 소스를 통째로 모델에 보낸다. '어디로' 가 가장 중요한 한 줄이다.
  let 목적지;
  try {
    const u = new URL(conn.base);
    const 로컬 = isLocalHost(u.hostname);
    목적지 = `${로컬 ? c.green('이 컴퓨터 안') : c.yellow('바깥')} ${c.white(u.host)}`
      + (isOffline() ? c.green('  [오프라인 잠금]') : '');
  } catch { 목적지 = c.gray(String(conn.base)); }

  const lines = [
    `${c.hcyan(c.bold('deel'))}  ${c.gray(conn.kind === 'ollama' ? 'Ollama 규격' : 'OpenAI 호환 규격')}`,
    '',
    `${c.gray('모델')}    ${c.white(conn.model)}  ${c.gray('(' + short(conn.ctx) + ' 토큰)')}`,
    `${c.gray('보냄')}    ${목적지}  ${c.gray('← 여기 말고는 어디로도 안 갑니다')}`,
    `${c.gray('연결')}    ${능력}`,
    `${c.gray('폴더')}    ${c.white(clip(session.root, 56))}`,
  ];
  if (found.skills.length || found.commands.length) {
    lines.push(`${c.gray('이 PC')}   ${c.white(`스킬 ${found.skills.length}`)}${c.gray(' · ')}${c.white(`명령 ${found.commands.length}`)}${c.gray(' · ')}${c.white(`플러그인 ${found.plugins.length}`)}`);
  }
  return lines;
}
