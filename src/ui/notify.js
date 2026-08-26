/*
 * 끝났을 때 알리기 — 종소리와 창 제목.
 *
 * 로컬 모델은 느리다. 7B 를 CPU 로 돌리면 한 턴에 2~3분이 예사고, 그동안
 * 사람은 다른 창으로 간다. 그러다 돌아와 보면 이미 5분 전에 끝나 있거나,
 * 더 나쁘게는 "실행할까요?" 에서 3분째 멈춰 서 있다 — 물어본 줄을 몰라서.
 *
 * 클라우드 에이전트는 몇 초 만에 끝나니 알림이 없어도 됐지만, 여기서는
 * 그것이 곧 기다린 시간이 된다. 그래서 딱 두 가지만 한다.
 *
 *   종소리   다 됐을 때, 그리고 **물어볼 때**. 물어볼 때가 더 중요하다 —
 *            끝난 것은 늦게 알아도 되지만, 막혀 있는 것은 그만큼 손해다.
 *   창 제목  탭 이름만 봐도 도는 중인지 끝났는지 알게 한다.
 *
 * ── 어디로 내보내나 ─────────────────────────────────────────────────────
 *
 * stdout 이 터미널이면 stdout, 아니면 stderr. 둘 다 아니면 아무것도 안 한다.
 *
 * 이 순서가 중요하다. ACP(에디터 안에서 쓰기)와 `deel run` 은 stdout 이
 * 파이프다. 거기에 \x07 이나 \x1b]2; 를 흘리면 JSON-RPC 한 줄이 깨져서
 * 에디터가 세션을 통째로 끊는다. 소리 한 번 내려다 연결을 끊는 셈이다.
 * isTTY 를 보는 이유가 이것이고, 여기서만은 '아마 괜찮겠지' 로 안 넘어간다.
 */

/** 끄는 스위치. 켜 두면 소리도 제목도 없다. 조용한 사무실용. */
export const 끔 = () => !!(process.env.DEEL_NO_BELL || process.env.NO_BELL);

/**
 * 몇 초 넘게 걸린 턴만 알린다.
 *
 * "안녕" 에 1초 만에 답할 때마다 딩 소리가 나면, 사람은 이틀 만에 알림을 끈다.
 * 그러면 정작 3분짜리 턴도 못 듣는다. 알림은 아껴 써야 알림이다.
 */
export const 알릴만한초 = 12;

function 내보낼곳() {
  if (끔()) return null;
  if (process.stdout?.isTTY) return process.stdout;
  if (process.stderr?.isTTY) return process.stderr;
  return null;
}

function 쓰기(글) {
  const 곳 = 내보낼곳();
  if (!곳) return false;
  try { 곳.write(글); return true; } catch { return false; }
}

/** 종을 한 번 울린다. @returns {boolean} 실제로 울렸나 */
export function 종() {
  return 쓰기('\x07');
}

/**
 * 창 제목을 바꾼다.
 *
 * OSC 2 (제목만) 와 OSC 1 (아이콘 이름) 을 같이 보낸다. 터미널마다 보는
 * 것이 달라서 — 윈도우 터미널·iTerm 은 2를, 어떤 tmux 설정은 1을 본다.
 * 끝맺음은 BEL(\x07) 대신 ST(\x1b\\) 를 쓴다. BEL 로 끝내면 제목을 바꿀
 * 때마다 종이 같이 울려서, 위에서 아껴 쓰기로 한 소리가 매초 난다.
 */
export function 창제목(글) {
  const s = String(글 ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 120);
  return 쓰기(`\x1b]2;${s}\x1b\\\x1b]1;${s}\x1b\\`);
}

/** 켤 때 있던 제목으로 돌려놓는다. 남의 터미널을 우리 이름으로 두고 나가지 않는다. */
export function 제목되돌리기() {
  return 쓰기('\x1b]2;\x1b\\\x1b]1;\x1b\\');
}

/**
 * 이 턴을 알릴 것인가.
 *
 * @param {object} o
 * @param {number} o.걸린밀리초
 * @param {boolean} [o.물어봄]  사람 답을 기다리는 자리인가. 그러면 시간과 무관하게 알린다.
 * @param {boolean} [o.켬]      설정에서 켰나 (기본 켬)
 * @param {number}  [o.문턱초]
 */
export function 알릴까({ 걸린밀리초 = 0, 물어봄 = false, 켬 = true, 문턱초 = 알릴만한초 } = {}) {
  if (!켬 || 끔()) return false;
  if (물어봄) return true;
  return 걸린밀리초 >= 문턱초 * 1000;
}

/**
 * 상태에 맞는 창 제목 글을 짓는다.
 *
 * 폴더 이름을 앞에 붙인다. 창을 여럿 띄워 놓고 쓰는 사람이 많은데, 전부
 * "deel" 이면 어느 탭이 끝난 건지 알 수가 없다. 탭 이름은 짧게 잘리니
 * 구분되는 것(폴더)을 앞에, 공통인 것(deel)을 뒤에 둔다.
 */
export function 제목글(갈래, { 폴더 = '', 초 = 0 } = {}) {
  const 이름 = 폴더 ? `${폴더} · ` : '';
  if (갈래 === '도는중') return `${이름}deel ${초 >= 60 ? `${Math.floor(초 / 60)}분` : `${Math.max(0, Math.round(초))}초`}`;
  if (갈래 === '물어봄') return `${이름}deel — 물어볼 것이 있습니다`;
  if (갈래 === '끝남') return `${이름}deel — 다 됐습니다`;
  if (갈래 === '탈남') return `${이름}deel — 멈췄습니다`;
  return `${이름}deel`;
}
