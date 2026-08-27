// 화면 출력 기본기 — 색, 커서, 폭 계산, 상자. 외부 의존성 없음.

// 파이프로 넘길 때도 색을 보고 싶으면 FORCE_COLOR=1
const ON = (process.stdout.isTTY || process.env.FORCE_COLOR === '1') && process.env.NO_COLOR === undefined;

const E = (n) => (s) => (ON ? `\x1b[${n}m${s}\x1b[0m` : String(s));

// 흐린 글자의 밝기. 256색을 못 쓰는 옛 콘솔이면 90 으로 되돌린다.
function GRAY() {
  const 뜻 = String(process.env.DEEL_CONTRAST ?? '').toLowerCase();
  if (뜻 === 'low') return 90;
  const 옛콘솔 = process.env.TERM === 'dumb';
  if (옛콘솔) return 뜻 === 'high' ? 37 : 90;
  return 뜻 === 'high' ? '38;5;252' : '38;5;245';
}

export const c = {
  dim: E(2),
  bold: E(1),
  italic: E(3),
  under: E(4),
  red: E(31),
  green: E(32),
  yellow: E(33),
  blue: E(34),
  magenta: E(35),
  cyan: E(36),
  white: E(37),
  // 흐린 글자.
  //
  // 예전에는 90(밝은 검정)이었는데, 배경이 어두우면 배경에 묻히고 밝으면
  // 더 안 보인다. 실제로 "연한 글자가 잘 안 보인다" 는 말을 들었다.
  // 그래서 어느 배경에서도 읽히는 중간 회색을 기본으로 쓴다.
  //
  // 눈에 맞게 바꿀 수 있다:
  //   DEEL_CONTRAST=high  더 밝게 (밝은 배경이나 눈이 피로할 때)
  //   DEEL_CONTRAST=low   예전처럼 흐리게
  gray: E(GRAY()),
  // 밝은 계열 — 어두운 배경에서 본문과 구분이 필요할 때
  hred: E(91),
  hgreen: E(92),
  hyellow: E(93),
  hblue: E(94),
  hmagenta: E(95),
  hcyan: E(96),
  bgRed: E(41),
  bgGreen: E(42),
  bgBlue: E(44),
  bgGray: E(100),
};

/**
 * 256색 한 칸. 큰 글자(intro.js)의 깊이를 낼 때 쓴다.
 *
 * 옛 콘솔(TERM=dumb)은 256색을 모른다. 거기서는 번호가 글에 그대로 찍히므로
 * 아무 색도 안 입힌다 — 색이 없는 것보다 숫자가 새는 것이 훨씬 나쁘다.
 */
export const 색256가능 = () => process.env.TERM !== 'dumb';
export const 번호색 = (n) => (s) => (ON && 색256가능() ? `[38;5;${n}m${s}[0m` : String(s));

export const cursor = {
  hide: () => ON && process.stdout.write('\x1b[?25l'),
  show: () => ON && process.stdout.write('\x1b[?25h'),
  up: (n = 1) => ON && process.stdout.write(`\x1b[${n}A`),
  clearLine: () => ON && process.stdout.write('\x1b[2K\r'),
  // 여러 조각을 한 덩이로 묶어 한 번에 내보낼 때 쓰는 글자값.
  //
  // 나눠 쓰면 그 사이가 화면에 그대로 보인다. 커서를 숨기기 전에 지우는 글이
  // 먼저 나가면, 커서가 상자 안을 훑고 지나가는 것이 눈에 띈다.
  숨김: ON ? '\x1b[?25l' : '',
  보임: ON ? '\x1b[?25h' : '',
};

// 한글·한자·가나는 터미널에서 두 칸을 차지한다. 표 정렬이 이걸 모르면 어긋난다.
export function width(str) {
  let w = 0;
  // 없는 값은 빈 글자로 본다.
  //
  // String(null) 은 'null' 이라 폭이 4 로 나온다. 그러면 상태줄이 네 칸씩
  // 어긋나고, 화면에는 'null' 이라는 글자가 그대로 찍힌다. 모델 이름이나
  // 곁말은 없을 수 있는 값이라 실제로 여기로 들어온다.
  if (str === null || str === undefined) return 0;
  for (const ch of String(str).replace(/\x1b\[[0-9;]*m/g, '')) {
    const cp = ch.codePointAt(0);
    if (
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f9ff)
    ) w += 2;
    else w += 1;
  }
  return w;
}

export function pad(str, target, align = 'left') {
  const gap = Math.max(0, target - width(str));
  if (align === 'right') return ' '.repeat(gap) + str;
  if (align === 'center') {
    const l = Math.floor(gap / 2);
    return ' '.repeat(l) + str + ' '.repeat(gap - l);
  }
  return str + ' '.repeat(gap);
}

// 색 코드를 건드리지 않고 보이는 폭 기준으로 자른다.
export function clip(str, max, tail = '…') {
  if (width(str) <= max) return str;
  let out = '';
  let w = 0;
  const budget = max - width(tail);
  for (const ch of String(str)) {
    const cw = width(ch);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
  }
  return out + tail;
}

// 터미널 가로 폭. 파이프로 넘어가면 알 수 없으니 넉넉히 잡는다.
export const cols = () => process.stdout.columns || 100;

export const say = (s = '') => process.stdout.write(s + '\n');

export function rule(label = '', total = 64) {
  if (!label) return say(c.gray('─'.repeat(total)));
  const left = '── ' + label + ' ';
  say(c.gray(left + '─'.repeat(Math.max(0, total - width(left)))));
}

// 채움 막대. 반쪽 칸까지 써서 좁은 폭에서도 눈금이 보인다.
export function bar(used, total, cells = 32) {
  const ratio = total > 0 ? Math.min(1, used / total) : 0;
  const exact = ratio * cells;
  const full = Math.floor(exact);
  const half = exact - full >= 0.5 && full < cells;
  const tone = ratio > 0.85 ? c.red : ratio > 0.6 ? c.yellow : c.green;
  return tone('█'.repeat(full) + (half ? '▌' : '')) + c.gray('░'.repeat(cells - full - (half ? 1 : 0)));
}

// 상태줄용 얇은 막대.
export function gauge(ratio, cells = 10) {
  // 숫자가 아니면 0 으로 본다.
  //
  // Math.min/max 는 NaN 을 그대로 흘린다. 그러면 repeat(NaN) 이 빈 글자가 되어
  // 막대가 통째로 사라지고, 그만큼 상태줄이 밀린다. 컨텍스트 총량이 0 일 때
  // used/total 이 실제로 NaN 이 된다 — 새 연결에서 드물게 나온다.
  const n = Number(ratio);
  const r = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  const filled = Math.round(r * cells);
  const tone = r > 0.85 ? c.hred : r > 0.6 ? c.hyellow : c.hgreen;
  return tone('▰'.repeat(filled)) + c.gray('▱'.repeat(cells - filled));
}

/**
 * 눈금이 있는 게이지.
 *
 * 게이지가 차는 것은 보이는데 **언제 무슨 일이 나는지**는 안 보였다. 55% 를
 * 넘으면 오래된 도구 결과를 접기 시작하고, 80% 를 넘으면 대화를 요약한다.
 * 둘 다 사람 눈에는 갑자기 일어나는 일이라 — 어느 날 갑자기 "앞선 대화를
 * 줄였습니다" 가 뜨고, 모델이 방금 읽은 파일을 잊는다.
 *
 * 그래서 그 자리에 눈금을 미리 그어 둔다. 막대가 다가가는 것이 보이면
 * 사람이 먼저 손을 쓸 수 있다 — 못 박아 두거나(/pin), 갈래를 새로 파거나.
 * 지나간 눈금은 안 그린다. 이미 일어난 일을 계속 가리킬 이유가 없고,
 * 남겨 두면 막대가 눈금에 가려 어디까지 찼는지가 흐려진다.
 *
 * @param {number} ratio
 * @param {number} cells
 * @param {number[]} 눈금  0~1 사이 자리들
 */
export function 눈금게이지(ratio, cells = 10, 눈금 = []) {
  const n = Number(ratio);
  const r = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  const filled = Math.round(r * cells);
  const tone = r > 0.8 ? c.hred : r > 0.55 ? c.hyellow : c.hgreen;
  const 눈금칸 = new Set(
    (Array.isArray(눈금) ? 눈금 : [])
      .map((v) => Math.min(cells - 1, Math.max(0, Math.floor(Number(v) * cells))))
      .filter((v) => Number.isFinite(v)),
  );
  let out = '';
  for (let i = 0; i < cells; i++) {
    if (i < filled) out += tone('▰');
    else if (눈금칸.has(i)) out += c.white('┆');
    else out += c.gray('▱');
  }
  return out;
}

const BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };

/**
 * 둥근 모서리 상자. 안쪽 폭은 가장 긴 줄에 맞춘다.
 * @param {string[]} lines  색이 들어 있어도 폭 계산은 맞는다.
 */
export function box(lines, { title = '', pad: gap = 1, tone = c.gray, max = cols() - 4 } = {}) {
  const body = lines.map((l) => clip(l, max - gap * 2 - 2));
  const inner = Math.max(
    width(title) + 2,
    ...body.map((l) => width(l)),
  ) + gap * 2;
  const top = title
    ? BOX.tl + BOX.h + ' ' + title + ' ' + BOX.h.repeat(Math.max(0, inner - width(title) - 3)) + BOX.tr
    : BOX.tl + BOX.h.repeat(inner) + BOX.tr;
  const out = [tone(top)];
  for (const l of body) out.push(tone(BOX.v) + ' '.repeat(gap) + pad(l, inner - gap * 2) + ' '.repeat(gap) + tone(BOX.v));
  out.push(tone(BOX.bl + BOX.h.repeat(inner) + BOX.br));
  return out;
}

export const mark = {
  ok: c.green('✓'),
  no: c.red('✗'),
  warn: c.yellow('⚠'),
  dot: c.cyan('⏺'),
  arrow: c.gray('›'),
  think: c.magenta('✻'),
  run: c.hcyan('▶'),
  bar: c.gray('▏'),
  tree: c.gray('└'),
  branch: c.gray('├'),
};
