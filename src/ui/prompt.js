// 입력 받기 — 한 줄, 비밀번호(가림), 목록 선택, 예/아니오.
import { c, say, width } from './ansi.js';

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

/*
 * ── ESC 로 시작하는 순서는 **통째로** 뗀다 ──────────────────────────────
 *
 * 예전에는 ESC 한 글자만 버리고 뒤따르는 것은 글자로 담았다. 화살표 하나가 `[D`, Delete 가
 * `[3~`, 붙여넣기 표시가 `[200~` … `[201~` 로 남았다. `deel setup` 의 API 키 물음은 ● 로 가려
 * 있어서 사람은 그걸 볼 수가 없다 — 오타를 고치려고 왼쪽 화살표를 한 번 누르면 열쇠가 조용히
 * 틀어져 저장되고, 붙을 때 401 이 난다. 무엇이 틀렸는지는 아무 데도 안 남는다.
 *
 * 이 물음은 커서를 옮기는 편집기가 아니다(끝에 붙이고 끝에서 지우기만 한다). 그래서 화살표·Home·
 * Delete 는 **아무 일도 안 하는 것**이 맞고, 붙여넣기 표시는 벗기고 알맹이만 받는다.
 *
 * 돌려주는 값: 순서의 마지막 글자 자리. 순서가 이 토막 끝에서 끊겼으면 -1 — 느린 원격 터미널은
 * `ESC [` 와 `3~` 를 두 토막으로 보낸다. 그때는 남겨 뒀다가 다음 토막 앞에 붙여 다시 본다.
 */
function 순서끝(글자들, i) {
  const 둘째 = 글자들[i + 1];
  if (둘째 === undefined) return -1;
  if (둘째 === '[') {
    // CSI — 매개 글자(0x30–0x3F)·사이 글자(0x20–0x2F) 뒤에 마침 글자(0x40–0x7E) 하나.
    for (let j = i + 2; j < 글자들.length; j++) {
      const k = 글자들[j].charCodeAt(0);
      if (k >= 0x40 && k <= 0x7e) return j;
      // 순서에 올 수 없는 글자(엔터·한글 …)가 끼었다. 거기서 끊고 그 글자는 제대로 읽게 둔다.
      if (k < 0x20 || k > 0x3f) return j - 1;
    }
    return -1;
  }
  // SS3 — 일부 터미널의 화살표·F1~F4 (ESC O A).
  //
  // 셋째 글자를 무엇이든 끝 글자로 먹었다. ESC 를 누르고 O 를 치고 엔터를 치면 엔터가 순서의 끝으로
  // 사라져 물음이 안 끝났다. SS3 의 끝 글자는 0x40–0x7E 뿐이다 — 아니면 홑 ESC(Alt+O)로 본다.
  if (둘째 === 'O') {
    const 셋째 = 글자들[i + 2];
    if (셋째 === undefined) return -1;
    const k = 셋째.charCodeAt(0);
    return k >= 0x40 && k <= 0x7e ? i + 2 : i;
  }
  // 홑 ESC (ESC 키 · Alt+글자). 여태처럼 ESC 만 떼고 뒤 글자는 글자로 둔다.
  return i;
}

/*
 * ── 앞 물음이 덩이 끝의 \r 에서 끝났나 (Gemini 화면4) ──────────────────────
 *
 * CRLF 로 적은 답 파일을 파이프로 흘리면 `ans1\r` | `\nans2\r\n` 처럼 \r 과 \n 이 **두 덩이에
 * 갈려** 올 수 있다. 첫 물음은 \r 에서 끝나고, 그 \n 은 다음 물음이 받아 **엔터로** 읽었다 —
 * 빈 답이 끼고 뒤의 답이 한 칸씩 밀린다(주소 물음에 모델 이름이 들어간다). 한 덩이 안의 CRLF
 * 는 이미 한 번으로 친다(아래). 덩이 사이는 물음이 바뀌므로 이 모듈이 기억한다.
 *
 * 다음 덩이의 **맨 앞 \n 하나만** 삼키고, **파이프일 때만** 기억한다. 터미널(raw)은 엔터를 늘 덩이 끝
 * \r 하나로 보내 CRLF 가 갈릴 일이 없다 — 거기서도 기억하면 엔터 뒤 첫 키로 친 Ctrl+J(\n)가 먹혀
 * 물음이 안 끝났다(Gemini 화면5).
 */
let 덩이끝CR = false;

// 한 줄 입력. mask=true 면 ● 로 가린다.
export function ask(label, { mask = false, def = '' } = {}) {
  const prefix = `  ${c.gray('›')} ${label} `;
  process.stdout.write(prefix + (def ? c.gray(`[${def}] `) : ''));
  let buf = '';
  // 앞 토막 끝에서 끊긴 ESC 순서. 다음 토막 앞에 붙여 다시 본다.
  let 꼬리 = '';
  return readKeys((ch, done) => {
    // 글자 단위로 훑되 자리를 기억한다. 엔터에서 멈출 때 '남은 것' 을 알아야 해서다.
    const 글자들 = [...(꼬리 + ch)];
    꼬리 = '';
    let 시작 = 0;
    if (덩이끝CR) {
      덩이끝CR = false;
      if (글자들[0] === '\n') 시작 = 1;
    }
    for (let i = 시작; i < 글자들.length; i++) {
      const ch1 = 글자들[i];
      const code = ch1.charCodeAt(0);
      if (code === 3) { say(''); process.exit(130); }            // Ctrl+C
      if (code === 27) {                                         // ESC 순서
        const 끝 = 순서끝(글자들, i);
        if (끝 === -1) { 꼬리 = 글자들.slice(i).join(''); break; }
        i = 끝;
        continue;
      }
      if (code === 13 || code === 10) {                          // Enter
        say('');
        // 한 덩어리에 여러 줄이 실려 올 수 있다 — 붙여넣기, 파이프 입력, 느린 터미널.
        // 예전에는 엔터를 만나면 그 덩어리의 나머지를 그냥 버렸다. 그러면 이어서
        // 물어보는 쪽이 아무것도 못 받고 멈춘 것처럼 보인다. 무엇이 사라졌는지도
        // 화면에 안 남아서, 사람은 자기가 안 친 줄 안다.
        // 그래서 되돌려 놓는다 — 다음에 읽는 쪽이 받아 간다.
        let 다음 = i + 1;
        if (code === 13 && 글자들[다음] === '\n') 다음++;         // CRLF 는 한 번으로 친다
        else if (code === 13 && 다음 === 글자들.length && !process.stdin.isTTY) 덩이끝CR = true; // \n 이 다음 덩이로 갈렸을 수 있다 (덩이끝CR 머리말)
        const 남은것 = 글자들.slice(다음).join('');
        /*
         * **먼저 손을 떼고** 되돌린다.
         *
         * 거꾸로 했었다 — 되돌리고 나서 done 으로 손을 뗐다. 그런데 흐르는 중인 입력에
         * unshift 하면 그 자리에서 곧바로 'data' 가 다시 난다. 그걸 받는 것은 **아직 붙어
         * 있는 이 물음**이라, `first\nsecond\n` 이 한 덩어리로 오면 첫 물음이 「firstsecond」
         * 를 받고 둘째 물음은 영영 답을 못 받았다. `echo … | deel setup` 이 그 길이다.
         * 손을 떼면(멈춤) 되돌린 것은 버퍼에 가만히 있다가 다음 물음이 받아 간다.
         */
        const 끝남 = done(buf.length ? buf : def);
        if (남은것) { try { process.stdin.unshift(남은것); } catch { /* 못 돌려놔도 이 줄은 살린다 */ } }
        return 끝남;
      }
      if (code === 127 || code === 8) {                          // Backspace
        if (buf.length) {
          /*
           * 코드 단위가 아니라 **글자 하나**를 지운다. 그림글자는 UTF-16 두 토막이라
           * 한 토막만 떼면 반쪽 글자가 열쇠·이름에 남는다 — 화면에는 안 보이고 값만 깨진다.
           * 지운 칸 수도 글자 폭만큼이다 — 한글 하나를 한 칸만 지우면 반쪽이 화면에 남는다.
           */
          const 뗀것 = [...buf].pop();
          buf = buf.slice(0, -뗀것.length);
          const 칸 = mask ? 1 : Math.max(1, width(뗀것));
          process.stdout.write('\b'.repeat(칸) + ' '.repeat(칸) + '\b'.repeat(칸));
        }
        continue;
      }
      if (code < 32) continue;
      buf += ch1;
      process.stdout.write(mask ? c.gray('●') : ch1);
    }
  });
}

/*
 * 지금 암호를 받는 중인 readline 들.
 *
 * 암호는 **일하는 도중에** 묻는다(엑셀 도구). 그 동안 repl 의 입력 상자는 rl.line 을 「미리
 * 쳐 둔 글」 로 그리고, Enter 친 줄을 「예약된 다음 말」 로 다룬다 — 둘 다 암호를 글자 그대로
 * 다룬다는 뜻이다. 가로챌 것은 되비추기(_writeToOutput)만이 아니었다. 그래서 가리는 중인지를
 * 밖에서 물어볼 수 있게 둔다(가림중).
 */
const 가리는rl = new WeakSet();

/** 이 readline 이 지금 암호를 받는 중인가. repl 이 입력 상자에 그 글을 그릴지 정할 때 본다. */
export function 가림중(rl) {
  return !!rl && typeof rl === 'object' && 가리는rl.has(rl);
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
      /*
       * 줄바꿈·제어 순서는 그대로 두고, 글자만 가린다 — **한 덩이 안에서** 갈라서.
       *
       * 첫 글자가 ESC 면 통째로 제어로 보고 흘렸었다. 그런데 readline 은 지우개·화살표에서 줄을
       * 새로 그리며 「프롬프트 + 지금까지 친 글」 을 한 번에 넘긴다. 프롬프트에 색이 입혀져 있으면
       * 그 첫 글자가 ESC 라, 친 암호가 글자 그대로 화면에 찍혔다(Gemini 화면4). 맨 프롬프트면
       * 거꾸로 프롬프트까지 ● 로 덮였다.
       *
       * 그래서 앞의 프롬프트는 가리지 않고 떼어 두고, 나머지에서 제어 순서·줄바꿈만 살리고 글자는
       * 전부 ● 로 바꾼다.
       */
      const 글 = String(s);
      const 프롬프트 = typeof this.getPrompt === 'function' ? String(this.getPrompt() ?? '') : '';
      const 앞 = 프롬프트 && 글.startsWith(프롬프트) ? 프롬프트 : '';
      const 가림 = 글.slice(앞.length).replace(/(\x1b\[[0-?]*[ -/]*[@-~])|([\r\n]+)|([^\x1b\r\n]+)/g,
        (통, 순서, 줄, 글자) => (글자 ? c.gray('●'.repeat([...글자].length)) : 통));
      return 원래.call(this, 앞 + 가림);
    };
  } else {
    process.stdout.write(c.gray('(입력해도 화면에 안 보입니다) '));
  }

  /*
   * ── 입력 이력에 안 남긴다 ────────────────────────────────────────────
   *
   * readline 은 Enter 친 줄을 이력(historySize)에 쌓는다. 암호도 한 줄이라 그대로 쌓였다 —
   * 암호를 넣고 나서 다음 입력칸에서 위 화살표를 한 번 누르면 암호가 글자 그대로 되살아났다.
   * 어깨너머로 보이는 것은 물론이고, 그 줄을 모르고 Enter 치면 모델에게 간다.
   *
   * 받은 줄을 이력에서 **도로 뺀다.** 받는 동안 이력을 끄는 길(historySize = 0)은 못 쓴다 — Node 의
   * readline 은 historySize 를 읽기만 하게 막아 두었다(대입하면 던진다). readline 은 줄을 이력
   * **맨 앞**에 끼운 뒤에 'line' 을 쏘고, 우리는 그 줄을 받은 바로 그 자리에서 빼므로 그 사이에
   * 다른 줄이 끼어들 틈이 없다.
   */
  const 이력 = Array.isArray(rl?.history) ? rl.history : null;
  const 표시할수있나 = !!rl && typeof rl === 'object';
  if (표시할수있나) 가리는rl.add(rl);

  try {
    const a = await nextLine();
    if (이력 && a !== null && 이력[0] === a) 이력.shift();
    return a === null ? null : a.trim();
  } finally {
    if (원래) rl._writeToOutput = 원래;
    if (표시할수있나) 가리는rl.delete(rl);
    say('');
  }
}

// 전각 숫자(０–９)를 보통 숫자로. 일본어·중국어 입력기는 번호를 이렇게 낸다.
const 숫자펴기 = (s) => String(s ?? '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));

// 없는 번호를 몇 번까지 되묻나. 끝이 있어야 같은 틀린 답이 계속 오는 자리에서 안 멈춘다.
const 되묻기 = 2;

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
  /*
   * ── 없는 번호는 말없이 기본값으로 가지 않는다 ──────────────────────────
   *
   * `9` 나 `abc` 를 치면 아무 말 없이 기본값을 골랐다. 사람은 친 번호가 먹은 줄 알고 넘어가고,
   * 붙는 것은 고른 적 없는 모델·리전이다. 화면 어디에도 「그건 없는 번호」 라는 말이 없다.
   *
   * `되묻기 = 2` 라 **두 번까지 더 묻는다** — 처음까지 세면 사람은 세 번 친다. 여기를
   * 부르는 자리(모델 40개·리전·제공자 고르기)는 목록이 길어 손이 미끄러지기 쉽고, 잘못
   * 고르면 고른 적 없는 모델에 붙는다. 그래서 기회를 한 번이 아니라 두 번 준다.
   * 그래도 틀리면 기본값으로 가되 **그렇게 했다고 적는다.** 되묻는 횟수에
   * 끝을 둔다 — 답을 파이프로 흘려 넣는 자리에서 같은 틀린 답이 계속 오면 영영 안 끝난다.
   * 빈 답(그냥 Enter)은 틀린 답이 아니라 「기본으로」 라는 답이라 되묻지 않는다.
   */
  for (let 번째 = 0; ; 번째++) {
    const 받은것 = await askFn('번호', { def: String(def + 1) });
    const 글 = 숫자펴기(받은것).trim();
    const n = parseInt(글, 10);
    if (Number.isFinite(n) && n >= 1 && n <= items.length) return n - 1;
    if (!글) return def;
    if (번째 >= 되묻기) {
      const 기본 = items[def];
      const 이름 = typeof 기본 === 'string' ? 기본 : 기본?.label ?? '';
      say(`  ${c.yellow('!')} ${c.gray(`목록에 없는 번호라 기본값 ${def + 1}번${이름 ? `(${이름})` : ''}으로 둡니다.`)}`);
      return def;
    }
    say(`  ${c.yellow('!')} ${c.gray(`「${글}」 은 목록에 없습니다 — 1~${items.length} 사이 번호를 넣어 주세요.`)}`);
  }
}

export async function confirm(label, def = true) {
  const hint = def ? '(Y/n)' : '(y/N)';
  const a = (await ask(`${label} ${c.gray(hint)}`, { def: def ? 'y' : 'n' })).trim().toLowerCase();
  return a === 'y' || a === 'yes' || a === '예' || a === 'ㅇ';
}
