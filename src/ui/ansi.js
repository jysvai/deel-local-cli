// 화면 출력 기본기 — 색, 커서, 폭 계산. 외부 의존성 없음.

// 파이프로 넘길 때도 색을 보고 싶으면 FORCE_COLOR=1
const ON = (process.stdout.isTTY || process.env.FORCE_COLOR === '1') && process.env.NO_COLOR === undefined;

const E = (n) => (s) => (ON ? `\x1b[${n}m${s}\x1b[0m` : String(s));

export const c = {
  dim: E(2),
  bold: E(1),
  red: E(31),
  green: E(32),
  yellow: E(33),
  blue: E(34),
  magenta: E(35),
  cyan: E(36),
  gray: E(90),
  bgRed: E(41),
  bgGreen: E(42),
};

export const cursor = {
  hide: () => ON && process.stdout.write('\x1b[?25l'),
  show: () => ON && process.stdout.write('\x1b[?25h'),
  up: (n = 1) => ON && process.stdout.write(`\x1b[${n}A`),
  clearLine: () => ON && process.stdout.write('\x1b[2K\r'),
};

// 한글·한자·가나는 터미널에서 두 칸을 차지한다. 표 정렬이 이걸 모르면 어긋난다.
export function width(str) {
  let w = 0;
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
  return align === 'right' ? ' '.repeat(gap) + str : str + ' '.repeat(gap);
}

export const say = (s = '') => process.stdout.write(s + '\n');

export function rule(label = '', total = 64) {
  if (!label) return say(c.gray('─'.repeat(total)));
  const left = '── ' + label + ' ';
  say(c.gray(left + '─'.repeat(Math.max(0, total - width(left)))));
}

export function bar(used, total, cells = 32) {
  const ratio = total > 0 ? Math.min(1, used / total) : 0;
  const filled = Math.round(ratio * cells);
  const tone = ratio > 0.85 ? c.red : ratio > 0.6 ? c.yellow : c.green;
  return tone('█'.repeat(filled)) + c.gray('░'.repeat(cells - filled));
}

export const mark = {
  ok: c.green('✓'),
  no: c.red('✗'),
  warn: c.yellow('⚠'),
  dot: c.cyan('⏺'),
  arrow: c.gray('›'),
};
