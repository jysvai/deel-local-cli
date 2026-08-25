/**
 * 전체화면 화면.
 *
 * 줄화면(ui/screen.js 의 LineScreen)이 위에서 아래로 흘려보낸다면, 여기는
 * 터미널을 칸으로 나눠 놓고 매번 다시 그린다.
 *
 *   ┌─ 대화 ──────────────────────────┬─ 바뀐 파일 ───────┐
 *   │ ▌ 로그 호출을 통일했습니다      │ src/runner.js  +3 │
 *   │ ⏺ Edit(runner.js)  +3 -1        ├─ 할 일 ───────────┤
 *   │                                 │ ☑ 로그 형식 통일  │
 *   └─────────────────────────────────┴───────────────────┘
 *    ▏폴더 · 모델 ▏ ▰▰▱▱▱ 22% ▏ ◎ 종합 · auto
 *    ╭───────────────────────────────────────────────────╮
 *    │ ❯ 집계 함수도 줄여줘                              │
 *    ╰───────────────────────────────────────────────────╯
 *
 * ── 지키기로 한 선 ──────────────────────────────────────────────────────
 *
 * 1) **입력은 readline 이 계속 맡는다.** 키를 직접 받아 줄 편집을 다시 짜면
 *    한글 조합·붙여넣기·위아래 이력·백스페이스를 전부 우리가 떠안게 된다.
 *    그 대신 그릴 때마다 커서를 입력 칸 안에 놓아 주고, **사람이 치는 동안에는
 *    다시 그리지 않는다**(그리면 치던 글자가 지워진다).
 *
 * 2) **나갈 때 대화를 되살려 놓는다.** 전체화면은 vim 처럼 딴 화면을 쓰다가
 *    끝나면 원래 화면으로 돌아간다. 그대로 두면 방금 나눈 대화가 통째로
 *    사라진다 — 스크롤을 올려도 없다. 그래서 원래 화면으로 돌아간 **뒤에**
 *    대화를 다시 찍어 준다. 터미널 스크롤백에 남아야 나중에 찾아본다.
 *
 * 3) **못 그릴 상황이면 안 켠다.** 창이 작거나 파이프면 screen.js 가
 *    아예 이 파일을 안 부른다.
 */
import { c, width, clip, cursor } from './ansi.js';
import { statusLine, contextWarning } from './status.js';

const ALT_ON = '\x1b[?1049h';    // 딴 화면으로
const ALT_OFF = '\x1b[?1049l';   // 원래 화면으로
const 집 = '\x1b[H';             // 커서를 왼쪽 맨 위로
const 화면지움 = '\x1b[2J';
const 줄끝지움 = '\x1b[K';
const 돌림틀 = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// 스크롤백에 되살릴 대화의 최대 줄 수. 다 남기면 몇만 줄이 쏟아진다.
const 되살릴줄 = 600;
// 대화 칸이 들고 있을 줄 수. 이보다 오래된 것은 버린다(세션 기록에는 남는다).
const 버퍼최대 = 4000;
const 오른쪽폭 = 26;

const 자리 = (행, 열 = 1) => `\x1b[${행};${열}H`;

/**
 * 색을 유지하면서 폭에 맞춰 접는다.
 *
 * clip 은 잘라 버리지만 대화는 잘리면 안 된다 — 모델의 답 뒷부분이 통째로
 * 사라진다. 그래서 접는다. 색 코드는 폭이 0 이므로 세지 않고, 줄을 넘길 때
 * 마지막으로 켜져 있던 색을 다음 줄 앞에 다시 켜 준다. 안 그러면 접힌 줄부터
 * 색이 풀려 화면이 얼룩덜룩해진다.
 */
export function 접어쓰기(글, 폭) {
  const s = String(글 ?? '');
  if (폭 < 2) return [s];
  if (width(s) <= 폭) return [s];

  /*
   * 접힌 줄에 앞 들여쓰기를 물려 준다.
   *
   * 안 물려 주면 `  ▌ 모델의 답…` 이 접히는 순간 다음 줄이 왼쪽 끝에서
   * 시작한다. 화면에서 세로줄이 끊겨 보이고, 도구 결과의 `    └ …` 도
   * 두 번째 줄부터 갑자기 튀어나온다 — 무엇에 딸린 글인지 알 수 없게 된다.
   * 들여쓴 만큼은 글자 자리에서 빼야 하므로 접는 폭도 같이 줄인다.
   */
  const 들여 = (/^ */.exec(s)[0] ?? '').slice(0, Math.max(0, 폭 - 8));
  const 이어폭 = Math.max(2, 폭 - 들여.length);

  const 줄들 = [];
  let 지금 = '';
  let w = 0;
  let 색 = '';                       // 지금 켜져 있는 SGR
  for (let i = 0; i < s.length;) {
    // 색 코드는 통째로 옮긴다. 폭에는 안 센다.
    if (s[i] === '\x1b') {
      const m = /^\x1b\[[0-9;]*m/.exec(s.slice(i));
      if (m) {
        지금 += m[0];
        색 = /\x1b\[0?m/.test(m[0]) ? '' : 색 + m[0];
        i += m[0].length;
        continue;
      }
    }
    const ch = s[i];
    const cw = width(ch);
    // 첫 줄은 원래 폭, 접힌 줄부터는 들여쓴 만큼 좁아진다.
    const 한도 = 줄들.length === 0 ? 폭 : 이어폭 + 들여.length;
    if (w + cw > 한도) {
      줄들.push(지금 + (색 ? '\x1b[0m' : ''));
      지금 = 들여 + 색;
      w = 들여.length;
    }
    지금 += ch;
    w += cw;
    i += 1;
  }
  if (지금.trim() !== '' || 줄들.length === 0) 줄들.push(지금 + (색 ? '\x1b[0m' : ''));
  return 줄들;
}

/** 폭에 맞춰 오른쪽을 공백으로 채운다. 안 채우면 앞 그림이 남는다. */
function 채움(글, 폭) {
  const w = width(글);
  if (w > 폭) return clip(글, 폭);
  return 글 + ' '.repeat(폭 - w);
}

export class TuiScreen {
  constructor() {
    this.kind = 'tui';
    this.줄버퍼 = [];        // 확정된 줄 (색 포함, 안 접힌 원본)
    this.열린줄 = null;      // 아직 안 맺은 줄 — 스트리밍으로 붙는 중
    this.임시글 = null;      // '생각 중…' 처럼 곧 지워질 한 줄
    this.상태 = '';          // 상태줄
    this.경고 = null;        // 컨텍스트 경고
    this.파일 = [];          // 오른쪽 위
    this.할일 = [];          // 오른쪽 아래
    this.입력중 = false;     // 사람이 치는 중이면 다시 그리지 않는다
    this.돌림타이머 = null;
    this.돌림글 = '';
    this.돌림칸 = 0;
    this.닫힘 = false;

    this.행 = process.stdout.rows ?? 24;
    this.열 = process.stdout.columns ?? 80;

    process.stdout.write(ALT_ON + 화면지움 + 집);
    cursor.hide();

    // 창 크기가 바뀌면 칸을 다시 잰다. 안 하면 테두리가 어긋난 채로 남는다.
    this.크기바뀜 = () => {
      this.행 = process.stdout.rows ?? 24;
      this.열 = process.stdout.columns ?? 80;
      this.다시그림({ 입력중이어도: true });
    };
    process.stdout.on('resize', this.크기바뀜);

    /*
     * 어떻게 끝나든 터미널을 되돌려 놓는다.
     *
     * 이게 없으면 프로그램이 터지거나 kill 당했을 때 사용자 터미널이 **딴 화면에
     * 갇힌 채** 남는다. 커서도 숨겨진 그대로다. 그 상태에서는 프롬프트도 안 보이고
     * 친 글자도 안 보여서, 터미널을 닫는 것 말고는 방법이 없다 —
     * 우리 잘못으로 남의 창을 못 쓰게 만드는 셈이다.
     *
     * 정상 종료(close)에서도 한 번 더 불리지만 닫힘 표시로 걸러진다.
     */
    this.되돌리기 = () => {
      if (this.닫힘) return;
      this.닫힘 = true;
      clearInterval(this.돌림타이머);
      try { cursor.show(); process.stdout.write(ALT_OFF); } catch { /* 나가는 길이라 더 할 것이 없다 */ }
    };
    process.once('exit', this.되돌리기);
    // 예상 못 한 오류로 죽을 때도 화면부터 되돌리고 오류를 원래 화면에 찍는다.
    // 딴 화면에 찍으면 그 오류가 화면과 함께 사라져 원인을 못 본다.
    this.죽을때 = (e) => {
      this.되돌리기();
      process.off('uncaughtException', this.죽을때);
      process.off('unhandledRejection', this.죽을때);
      throw e;
    };
    process.on('uncaughtException', this.죽을때);
    process.on('unhandledRejection', this.죽을때);
  }

  // ── 흘러가는 글 ────────────────────────────────────────────────────────

  줄(s = '') {
    this.열린줄맺기();
    this.임시글 = null;
    this.줄버퍼.push(s);
    this.줄이기();
    this.다시그림();
  }

  붙임(s) {
    this.임시글 = null;
    const 조각 = String(s ?? '');
    const 부분 = 조각.split('\n');
    if (this.열린줄 === null) this.열린줄 = '';
    this.열린줄 += 부분[0];
    for (let i = 1; i < 부분.length; i++) {
      this.줄버퍼.push(this.열린줄);
      this.열린줄 = 부분[i];
    }
    this.줄이기();
    this.다시그림();
  }

  열린줄맺기() {
    if (this.열린줄 !== null) {
      this.줄버퍼.push(this.열린줄);
      this.열린줄 = null;
    }
  }

  줄이기() {
    if (this.줄버퍼.length > 버퍼최대) this.줄버퍼.splice(0, this.줄버퍼.length - 버퍼최대);
  }

  // ── 곧 지워질 표시 ─────────────────────────────────────────────────────

  기다림(s) { this.임시글 = s; this.다시그림(); }

  생각(s) { this.임시글 = s; this.다시그림(); }

  임시지움() { if (this.임시글 !== null) { this.임시글 = null; this.다시그림(); } }

  /**
   * 오래 걸리는 일에 돌아가는 표시.
   *
   * 줄화면은 한 줄을 \r 로 덮어쓰지만 여기서는 임시 자리를 갱신한다.
   * 사람이 입력을 기다리는 중이면 애초에 이게 안 돌아간다.
   */
  돌리기(label) {
    this.돌림글 = label;
    this.돌림칸 = 0;
    clearInterval(this.돌림타이머);
    const 한칸 = () => {
      this.임시글 = `${c.cyan(돌림틀[this.돌림칸++ % 돌림틀.length])} ${c.gray(this.돌림글)}`;
      this.다시그림();
    };
    한칸();
    this.돌림타이머 = setInterval(한칸, 80);
    // 타이머 하나 때문에 프로그램이 안 끝나면 안 된다.
    if (this.돌림타이머.unref) this.돌림타이머.unref();
    return { stop: (f) => this.돌림멈춤(f) };
  }

  돌림멈춤(finalLine) {
    clearInterval(this.돌림타이머);
    this.돌림타이머 = null;
    this.임시글 = null;
    if (finalLine) this.줄버퍼.push(finalLine);
    this.다시그림();
  }

  // ── 자리를 차지하는 것 ─────────────────────────────────────────────────

  머리말(lines) {
    for (const l of lines) this.줄버퍼.push('  ' + l);
    this.다시그림();
  }

  파일칸(list) { this.파일 = Array.isArray(list) ? list : []; this.다시그림(); }

  할일칸(list) { this.할일 = Array.isArray(list) ? list : []; this.다시그림(); }

  /**
   * 입력 자리.
   *
   * 상태줄과 입력 상자를 그린 뒤 커서를 상자 안에 놓고 보이게 한다.
   * 그 다음부터 readline 이 그 자리에 글자를 되비춘다 — 여기서부터는
   * 사람 차례이므로 다시 그리지 않는다.
   */
  입력자리(session) {
    this.열린줄맺기();
    this.임시글 = null;
    this.상태 = statusLine(session, { max: this.열 - 4 });
    this.경고 = contextWarning(session);
    this.입력중 = false;
    // 다시그림 이 마지막으로 커서를 상자 안 '❯ ' 뒤에 놓아 준다.
    // 여기서 또 옮기면 방금 찍은 ❯ 위에 글자가 겹친다.
    this.다시그림();
    this.입력중 = true;
    cursor.show();
  }

  입력지움() {
    // 전체화면에서는 입력이 제 칸에 따로 있다. 지울 것이 없고,
    // 다음 그리기가 상자를 통째로 다시 그린다.
    this.입력중 = false;
  }

  // ── 그리기 ─────────────────────────────────────────────────────────────

  /**
   * 그릴 화면 한 장을 **값으로** 만든다.
   *
   * 그리기와 내보내기를 가른 이유: TUI 는 터미널일 때만 도니까 검사가 한 번도
   * 안 밟는다. '검사 전부 통과' 가 '화면이 맞다' 를 뜻하지 않는 자리다.
   * 화면을 글 배열로 내놓으면 파이프 안에서도 재 볼 수 있다 —
   * 테두리가 한 칸 어긋난 것은 눈으로는 못 보고 자로만 잡힌다.
   *
   * @returns {{줄들: string[], 커서: {행: number, 열: number}}}
   */
  프레임() {
    const 행 = this.행;
    const 열 = this.열;
    const 아래 = 4;                                   // 상태줄 1 + 입력 상자 3
    const 본문높이 = Math.max(3, 행 - 아래 - 2);       // 위아래 테두리 2
    const 오른 = 열 >= 96 ? 오른쪽폭 : 0;              // 좁으면 오른쪽 칸을 접는다
    // 한 줄의 짜임 —  │ + 왼쪽칸 + (┬ + 오른쪽칸) + │  이 폭 합이 열과 같아야 한다.
    const 왼폭 = 열 - 2 - (오른 ? 오른 + 1 : 0);

    const 줄들 = [];

    const 제목선 = (제목, 폭, 왼끝, 오른끝) => {
      const 안 = ' ' + 제목 + ' ';
      return 왼끝 + 안 + '─'.repeat(Math.max(0, 폭 - width(안))) + 오른끝;
    };

    // 위 테두리
    let 위 = 제목선('대화', 왼폭, '┌', '');
    위 += 오른 ? 제목선('바뀐 파일', 오른, '┬', '┐') : '┐';
    줄들.push(c.gray(위));

    const 본문 = this.본문줄(왼폭 - 1, 본문높이);
    const 곁 = this.곁줄(오른 - 1, 본문높이);
    for (let i = 0; i < 본문높이; i++) {
      let l = c.gray('│') + 채움(' ' + (본문[i] ?? ''), 왼폭);
      if (오른) l += c.gray(곁[i]?.칸막이 ?? '│') + 채움(곁[i]?.글 ?? '', 오른);
      줄들.push(l + c.gray('│'));
    }

    let 아래테 = '└' + '─'.repeat(왼폭);
    if (오른) 아래테 += '┴' + '─'.repeat(오른);
    줄들.push(c.gray(아래테 + '┘'));

    // 상태줄 — 컨텍스트가 위험하면 그 경고가 자리를 대신한다.
    줄들.push(this.경고 ? ` ${this.경고}` : this.상태);

    // 입력 상자.  ' ' + ╭ + 안폭 + ╮  =  열
    const 안폭 = Math.max(2, 열 - 3);
    줄들.push(' ' + c.gray('╭' + '─'.repeat(안폭) + '╮'));
    줄들.push(' ' + c.gray('│') + ' ' + c.hcyan('❯') + ' ' + ' '.repeat(안폭 - 3) + c.gray('│'));
    줄들.push(' ' + c.gray('╰' + '─'.repeat(안폭) + '╯'));

    // 커서는 입력 상자의 '❯ ' 바로 뒤.  ' '(1) │(1) ' '(1) ❯(1) ' '(1) → 6번째 칸
    return { 줄들, 커서: { 행: 줄들.length - 1, 열: 6 } };
  }

  다시그림({ 입력중이어도 = false } = {}) {
    if (this.닫힘) return;
    // 사람이 치는 중에 그리면 치던 글자가 지워진다. 창 크기가 바뀐 때만 예외다.
    if (this.입력중 && !입력중이어도) return;

    const { 줄들, 커서 } = this.프레임();
    cursor.hide();
    let out = 집;
    for (let i = 0; i < this.행; i++) {
      out += 자리(i + 1) + 줄끝지움 + (i < 줄들.length ? 줄들[i] : '');
    }
    out += 자리(커서.행, 커서.열);
    process.stdout.write(out);
  }

  /** 대화 칸에 들어갈 줄들 — 뒤에서부터 채운다(항상 최근 것을 본다). */
  본문줄(폭, 높이) {
    const 원본 = this.줄버퍼.slice();
    if (this.열린줄 !== null) 원본.push(this.열린줄);
    if (this.임시글 !== null) 원본.push('  ' + this.임시글);

    const 접힌 = [];
    // 뒤에서부터 접어 담다가 화면을 채우면 멈춘다. 앞쪽 수천 줄을 접느라
    // 매번 시간을 쓰지 않으려는 것이다.
    for (let i = 원본.length - 1; i >= 0 && 접힌.length < 높이; i--) {
      const 조각 = 접어쓰기(원본[i], 폭);
      for (let j = 조각.length - 1; j >= 0; j--) 접힌.unshift(조각[j]);
    }
    while (접힌.length > 높이) 접힌.shift();
    while (접힌.length < 높이) 접힌.push('');
    return 접힌;
  }

  /** 오른쪽 칸 — 위는 바뀐 파일, 아래는 할 일. 사이에 가로줄을 넣는다. */
  곁줄(폭, 높이) {
    if (폭 <= 0) return [];
    const 줄 = [];
    const 파일칸높이 = Math.max(1, Math.floor((높이 - 1) / 2));

    for (let i = 0; i < 파일칸높이; i++) {
      const f = this.파일[i];
      줄.push({ 칸막이: '│', 글: f ? ' ' + clip(f, 폭 - 1) : '' });
    }
    // 칸을 가르는 줄. 왼쪽 끝이 ├ 라 대화 칸 테두리와 이어져 보인다.
    const 제목 = ' 할 일 ';
    줄.push({ 칸막이: '├', 글: c.gray(제목 + '─'.repeat(Math.max(0, 폭 + 1 - width(제목)))) });
    for (let i = 줄.length; i < 높이; i++) {
      const t = this.할일[i - 파일칸높이 - 1];
      줄.push({ 칸막이: '│', 글: t ? ' ' + clip(t, 폭 - 1) : '' });
    }
    return 줄.slice(0, 높이);
  }

  /**
   * 끝낸다 — 원래 화면으로 돌아가고, 나눈 대화를 스크롤백에 되살린다.
   *
   * 되살리지 않으면 방금 본 것이 통째로 사라진다. 그게 전체화면의 성질이지만,
   * 코딩 도구에서 "방금 뭐라고 했더라" 를 못 찾는 건 곤란하다.
   */
  close() {
    if (this.닫힘) return;
    this.닫힘 = true;
    clearInterval(this.돌림타이머);
    process.stdout.off?.('resize', this.크기바뀜);
    process.off?.('exit', this.되돌리기);
    process.off?.('uncaughtException', this.죽을때);
    process.off?.('unhandledRejection', this.죽을때);
    this.열린줄맺기();

    cursor.show();
    process.stdout.write(ALT_OFF);

    const 남길것 = this.줄버퍼.slice(-되살릴줄);
    if (남길것.length) {
      if (this.줄버퍼.length > 남길것.length) {
        process.stdout.write(c.gray(`  (앞선 ${this.줄버퍼.length - 남길것.length}줄은 줄였습니다 — 전체는 .deel/sessions 에 남아 있습니다)\n`));
      }
      process.stdout.write(남길것.join('\n') + '\n');
    }
  }
}
