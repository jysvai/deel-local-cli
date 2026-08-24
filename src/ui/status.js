// 상태줄. 지금 무엇으로, 어디까지 차서 돌고 있는지 한 줄로 보여 준다.
//
// 남의 패키지를 붙이지 않는다. 필요한 숫자는 전부 session 이 이미 갖고 있고,
// 화면 그리기는 ansi.js 만 쓴다. 반입 심사에 새로 설명할 것이 늘지 않게 하려는 뜻이다.
import { c, gauge, width, clip, cols, mark } from './ansi.js';
import { PROFILES } from '../agent/effort.js';
import { isLocalHost, isOffline } from '../safety/network.js';

// 한 조각씩 따로 만든다. 좁은 화면에서는 뒤에서부터 떨군다.
// 순서 = 중요도 순. 앞쪽이 끝까지 살아남는다.
export const SEGMENTS = {
  dir: { desc: '작업 폴더', make: (s) => c.gray(base(s.root)) },

  model: { desc: '모델 이름', make: (s) => c.hcyan(clip(s.conn.model, 24)) },

  ctx: {
    desc: '컨텍스트 사용량',
    make: (s) => {
      const b = s.breakdown();
      // 넘칠 수는 있지만 화면에 219% 라고 적으면 고장난 것처럼 보인다. 100 에서 멈춘다.
      const r = Math.min(1, b.total > 0 ? b.used / b.total : 0);
      const pct = Math.round(r * 100);
      const tone = r > 0.85 ? c.hred : r > 0.6 ? c.hyellow : c.gray;
      return `${gauge(r, 10)} ${tone(pct + '%')} ${c.gray(short(b.used) + '/' + short(b.total))}`;
    },
  },

  think: {
    desc: '추론 강도·배분',
    make: (s) => {
      const p = PROFILES[s.effort] ?? PROFILES.save;
      return `${c.gray('◇')} ${c.white(s.think)}${c.gray('·')}${c.magenta(p.name)}`;
    },
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

export const DEFAULT_SEGMENTS = ['dir', 'model', 'ctx', 'think', 'mode', 'tok'];

function base(p) {
  const parts = String(p ?? '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? '~';
}

// 12345 → 12.3k.  상태줄은 자리가 없다.
function short(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 1000000) return (v / 1000).toFixed(v < 10000 ? 1 : 0) + 'k';
  return (v / 1000000).toFixed(1) + 'M';
}

/**
 * 상태줄 한 줄을 만든다. 폭이 모자라면 덜 중요한 조각부터 뺀다.
 * @param {import('../agent/session.js').Session} session
 */
export function statusLine(session, { segments = DEFAULT_SEGMENTS, max = cols() - 2 } = {}) {
  const sep = ` ${c.gray('▏')} `;
  let parts = segments
    .map((k) => SEGMENTS[k]?.make(session))
    .filter((x) => x != null && x !== '');

  // 뒤에서부터 떨궈 폭을 맞춘다. 앞쪽(폴더·모델·컨텍스트)이 마지막까지 남는다.
  while (parts.length > 1 && width(parts.join(sep)) + 2 > max) parts.pop();

  return ` ${c.gray('▏')}${parts.join(sep)}`;
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
