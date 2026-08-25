/**
 * 화면 한 장.
 *
 * 왜 이 파일이 생겼나:
 *   repl.js 안에 say()·process.stdout.write 가 79군데 흩어져 있었다. 그 상태로는
 *   전체화면 화면(TUI)을 얹을 수가 없다 — 어디로 무엇이 나가는지 한 군데서 못 잡으니
 *   두 화면이 같은 코드를 나눠 쓰려다 결국 둘 다 어중간해진다.
 *
 *   그래서 '무엇을 그린다' 와 '어떻게 그린다' 를 가른다. repl.js 는 이제
 *   `화면.줄(...)`·`화면.답조각(...)` 처럼 **뜻**만 말하고, 그것을 줄로 흘릴지
 *   칸에 담아 다시 그릴지는 여기서 정한다.
 *
 * 두 가지 구현이 있다:
 *   줄화면(LineScreen)  지금까지의 그 화면. 위에서 아래로 흘러간다.
 *                       파이프·기록·CI·`deel run`·검사가 전부 이것을 읽는다.
 *   전체화면(TuiScreen) ui/tui.js. 사람이 터미널 앞에 앉아 있을 때만.
 *
 * **줄화면을 없애지 않는 것이 핵심이다.** 전체화면은 터미널을 통째로 점유하고
 * 커서를 옮겨 가며 다시 그린다. 그 출력을 파일로 넘기면 제어문자 덩어리가 되고,
 * CI 로그에서는 읽을 수가 없다. 그래서 두 벌을 갖고 상황에 따라 고른다.
 */
import { c, say, cursor, box, cols } from './ansi.js';
import { statusLine, contextWarning } from './status.js';
import { spin } from './spinner.js';

/**
 * 지금 이 자리에서 전체화면을 써도 되는가.
 *
 * 셋 다 맞아야 한다. 하나라도 아니면 줄화면이다 —
 * 애매하면 줄화면이 맞다. 잘못 켜면 사용자 화면이 깨지지만,
 * 잘못 안 켜면 그냥 지금까지의 화면일 뿐이다.
 */
export function 전체화면쓸까({ tui = null } = {}) {
  if (tui === false) return false;              // deel --no-tui
  if (!process.stdout.isTTY) return false;      // 파이프·기록·CI
  if (!process.stdin.isTTY) return false;       // 입력이 파이프로 들어옴 (검사·데모)
  if (process.env.TERM === 'dumb') return false;
  if (process.env.CI) return false;
  // 창이 너무 작으면 칸을 나눌 자리가 없다. 억지로 나누면 글자가 겹친다.
  if ((process.stdout.columns ?? 0) < 60 || (process.stdout.rows ?? 0) < 16) return false;
  if (tui === true) return true;
  return true;
}

/**
 * 줄로 흘려보내는 화면 — 지금까지의 그 화면.
 *
 * 여기 있는 메서드 하나하나가 전에 repl.js 에 흩어져 있던 출력 한 줄과
 * **글자 하나까지 같아야 한다.** 검사가 전부 이 화면을 글로 읽고 있어서,
 * 다르면 그 자리에서 잡힌다. 그게 이 갈라내기가 맞는지 재는 자다.
 */
export class LineScreen {
  constructor() {
    this.kind = 'line';
    // 곧 지워질 줄이 화면에 있나. \r 로 커서만 앞으로 보내 놓고 안 지우면
    // 다음에 오는 짧은 글이 그 줄 위에 겹쳐 찍힌다.
    this.임시중 = false;
    this.돌림 = null;
  }

  // ── 흘러가는 글 ────────────────────────────────────────────────────────

  /** 한 줄. 이미 색이 입혀진 글을 받는다. */
  줄(s = '') { this.임시지움(); say(s); }

  /** 줄바꿈 없이 이어 붙인다 — 스트리밍으로 오는 답. */
  붙임(s) { this.임시지움(); process.stdout.write(s); }

  // ── 곧 지워질 표시 ─────────────────────────────────────────────────────

  /**
   * 기다리는 중. \r 로 커서만 앞으로 보낸다.
   *
   * 파이프일 때도 찍는다 — 데모·기록에서 '무엇을 기다리는 중이었나' 가
   * 남아야 한다. 다만 지워야 할 줄로 세는 것은 터미널일 때만이다.
   */
  기다림(s) {
    process.stdout.write(`  ${s}\r`);
    if (process.stdout.isTTY) this.임시중 = true;
  }

  /** 생각하는 중. 글자 수가 계속 바뀌므로 터미널일 때만 그린다. */
  생각(s) {
    if (!process.stdout.isTTY) return;
    cursor.clearLine();
    process.stdout.write(`  ${s}`);
    this.임시중 = true;
  }

  임시지움() {
    if (this.임시중) { cursor.clearLine(); this.임시중 = false; }
  }

  /**
   * 사람이 치고 있던 입력 줄을 지운다.
   *
   * Shift+Tab 으로 작업 모드를 돌릴 때처럼, 입력을 기다리는 도중에 화면에
   * 한 줄을 끼워 넣어야 하는 자리가 있다. 안 지우면 `❯ ` 뒤에 새 글이 붙는다.
   * 전체화면에서는 입력이 제 칸에 따로 있어서 지울 것이 없다.
   */
  입력지움() { cursor.clearLine(); }

  /** 오래 걸리는 일에 돌아가는 표시를 세운다. */
  돌리기(label) { this.돌림 = spin(label); return this.돌림; }

  // spinner 가 멈추면서 이미 줄을 지우고 커서를 되살린다. 여기서 또 지우지 않는다 —
  // 화면에 나가는 제어문자가 한 벌이라도 달라지면 그게 갈라내기의 흔적이 된다.
  돌림멈춤(finalLine) {
    if (!this.돌림) return;
    this.돌림.stop(finalLine);
    this.돌림 = null;
  }

  // ── 자리를 차지하는 것 ─────────────────────────────────────────────────

  /** 켤 때 한 번 그리는 머리말 상자. */
  머리말(lines) {
    say('');
    for (const l of box(lines, { tone: c.gray })) say('  ' + l);
  }

  /**
   * 입력 자리. 위에 상태줄을 한 줄 깔고 그 아래에 커서를 둔다.
   *
   * 줄화면에서는 이게 매번 새로 찍힌다 — 대화가 길어지면 상태줄이 화면에
   * 여러 번 남는다. 그게 흘러가는 화면의 성질이고, 기록으로 읽을 때는
   * 오히려 그때그때 상태를 알 수 있어 낫다.
   */
  입력자리(session) {
    say('');
    say(statusLine(session));
    const w = contextWarning(session);
    if (w) say(` ${w}`);
    process.stdout.write(` ${c.hcyan('❯')} `);
  }

  /** 오른쪽 칸에 들어갈 것들. 줄화면에는 오른쪽 칸이 없다. */
  파일칸() { /* 줄화면은 안 그린다 */ }

  할일칸() { /* 할 일은 나올 때마다 줄로 흘려보낸다 (repl.js 가 그린다) */ }

  /** 창 크기가 바뀌었다. 줄화면은 다시 그릴 것이 없다. */
  다시그림() { }

  close() {
    this.돌림멈춤();
    this.임시지움();
  }
}

/**
 * 상황에 맞는 화면을 하나 고른다.
 *
 * 전체화면 쪽은 필요할 때만 읽어 들인다. 줄화면으로 돌 때 tui.js 를
 * 파싱조차 안 하게 하려는 것이다 — `deel run` 이 조금이라도 빨리 시작해야 한다.
 */
export async function 화면고르기(opts = {}) {
  if (!전체화면쓸까(opts)) return new LineScreen();
  try {
    const { TuiScreen } = await import('./tui.js');
    return new TuiScreen(opts);
  } catch (e) {
    // 전체화면을 못 세우면 조용히 줄화면으로 간다. 화면 하나 때문에
    // 프로그램이 안 뜨는 일은 없어야 한다.
    const s = new LineScreen();
    s.줄(`  ${c.gray(`전체화면을 못 켰습니다 — 줄 화면으로 갑니다. (${e.message})`)}`);
    return s;
  }
}
