// 입력 받기 — 한 줄, 비밀번호(가림), 목록 선택, 예/아니오.
import { c, say, mark, cursor } from './ansi.js';

function raw() {
  return process.stdin.isTTY ? process.stdin.setRawMode.bind(process.stdin) : null;
}

function readKeys(onKey) {
  return new Promise((resolve) => {
    const setRaw = raw();
    if (setRaw) setRaw(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const handler = (chunk) => {
      const done = onKey(chunk, (value) => {
        process.stdin.off('data', handler);
        if (setRaw) setRaw(false);
        process.stdin.pause();
        resolve(value);
      });
      return done;
    };
    process.stdin.on('data', handler);
  });
}

// 한 줄 입력. mask=true 면 ● 로 가린다.
export function ask(label, { mask = false, def = '' } = {}) {
  const prefix = `  ${c.gray('›')} ${label} `;
  process.stdout.write(prefix + (def ? c.gray(`[${def}] `) : ''));
  let buf = '';
  return readKeys((ch, done) => {
    for (const ch1 of ch) {
      const code = ch1.charCodeAt(0);
      if (code === 3) { say(''); process.exit(130); }            // Ctrl+C
      if (code === 13 || code === 10) {                          // Enter
        say('');
        return done(buf.length ? buf : def);
      }
      if (code === 127 || code === 8) {                          // Backspace
        if (buf.length) {
          buf = buf.slice(0, -1);
          process.stdout.write('\b \b');
        }
        continue;
      }
      if (code < 32) continue;
      buf += ch1;
      process.stdout.write(mask ? c.gray('●') : ch1);
    }
  });
}

/**
 * REPL 안에서 암호를 받는다. 화면에 안 찍히게.
 *
 * REPL 은 readline 이 stdin 을 쥐고 있어서 위의 ask 를 그대로 못 쓴다.
 * readline 이 되비추는 자리를 잠깐 가로채서 ● 로 바꾼다. 못 가로채면
 * 아예 아무것도 안 찍는다 — 화면에 암호가 보이느니 안 보이고 치는 편이 낫다.
 *
 * @param {import('node:readline').Interface} rl
 * @param {string} label 물어볼 말
 * @param {() => Promise<string|null>} nextLine 한 줄 받아오는 함수 (REPL 의 큐)
 */
export async function askHidden(rl, label, nextLine) {
  process.stdout.write(`  ${c.gray('›')} ${label} `);

  const 원래 = typeof rl?._writeToOutput === 'function' ? rl._writeToOutput : null;
  if (원래) {
    rl._writeToOutput = function (s) {
      // 줄바꿈·지우기 같은 제어는 그대로 두고, 글자만 가린다.
      if (/^[\r\n]+$/.test(s) || s.startsWith('\x1b')) return 원래.call(this, s);
      this.output.write(c.gray('●'.repeat([...s].length)));
    };
  } else {
    process.stdout.write(c.gray('(입력해도 화면에 안 보입니다) '));
  }

  try {
    const a = await nextLine();
    return a === null ? null : a.trim();
  } finally {
    if (원래) rl._writeToOutput = 원래;
    say('');
  }
}

// 목록에서 번호로 고르기.
// REPL 안에서는 readline 이 stdin 을 쥐고 있으므로 ask 를 갈아끼워 쓴다.
export async function pick(label, items, { def = 0, ask: askFn = ask } = {}) {
  say('');
  say(`  ${c.bold(label)}`);
  items.forEach((it, i) => {
    const tag = i === def ? c.cyan(' ←기본') : '';
    const line = typeof it === 'string' ? it : it.label;
    const note = typeof it === 'object' && it.note ? c.gray('  ' + it.note) : '';
    say(`    ${c.cyan(String(i + 1).padStart(2))}  ${line}${note}${tag}`);
  });
  say('');
  const raw = await askFn('번호', { def: String(def + 1) });
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > items.length) return def;
  return n - 1;
}

export async function confirm(label, def = true) {
  const hint = def ? '(Y/n)' : '(y/N)';
  const a = (await ask(`${label} ${c.gray(hint)}`, { def: def ? 'y' : 'n' })).trim().toLowerCase();
  return a === 'y' || a === 'yes' || a === '예' || a === 'ㅇ';
}
