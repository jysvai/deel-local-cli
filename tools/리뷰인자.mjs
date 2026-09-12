/**
 * 2차 리뷰 도구가 받는 옵션.
 *
 * ── 모르는 옵션을 조용히 흘렸다 ────────────────────────────────────────
 *
 * `node tools/review2.mjs --help` 를 쳤더니 도움말이 아니라 **진짜 리뷰가
 * 돌았다.** 인자를 `indexOf` 로 하나씩 찾기만 했으니, 목록에 없는 말은
 * 그냥 없는 것이 된다. 40분과 토큰이 나가고, 친 사람은 도움말을 기다린다.
 *
 * 오타도 같은 자리다 — `--sinse HEAD~3` 은 아무 말 없이 「HEAD 까지 전부」
 * 가 된다. 콕 집었다고 믿는 사람에게 통째로 돌려주는 꼴이라, 이 도구가
 * `--files` 에서 이미 한 번 고친 부류다. 고르지 말고 멈춰야 한다.
 *
 * 판단하는 자리를 여기로 뺀 까닭은 검사다. review2.mjs 는 불러들이는
 * 순간 리뷰를 도는 스크립트라 검사에서 못 부른다.
 */

/** 값을 뒤 칸에서 받는 옵션. 그 칸은 옵션이 아니라 값이다. */
export const 값받는옵션 = new Set(['--since', '--to', '--model', '--timeout', '--out']);

/** 도구가 아는 옵션 전부. 검사가 review2.mjs 가 실제로 읽는 것과 견준다. */
export const 아는옵션 = [...값받는옵션, '--files', '--quiet', '--help'];

/**
 * 모르는 옵션을 죽 찾아 돌려준다.
 *
 * 붙임표로 시작하지 않는 칸은 값이거나 파일 이름이라 안 본다. 값을 받는
 * 옵션 뒤 한 칸은 그 값이라 건너뛴다 — `--since --weird` 의 뒤엣것은
 * 이상한 값이지 이상한 옵션이 아니다.
 *
 * @param {string[]} 인자
 * @param {string[]} [아는것]
 * @returns {string[]}
 */
export function 낯선옵션(인자, 아는것 = 아는옵션) {
  const 낯선 = [];
  for (let i = 0; i < 인자.length; i += 1) {
    const 칸 = String(인자[i] ?? '');
    if (!칸.startsWith('-')) continue;
    if (아는것.includes(칸)) {
      if (값받는옵션.has(칸)) i += 1;
      continue;
    }
    낯선.push(칸);
  }
  return 낯선;
}

/**
 * 값을 받아야 하는데 **값이 없는** 옵션을 죽 찾아 돌려준다.
 *
 * `--since` 만 치면 조용히 「안 올린 것 전부」 가 된다(11차 리뷰). 사람은
 * 범위를 줬다고 믿는데 도구는 다른 것을 본다 — `--files` 뒤가 비었을 때
 * 이미 한 번 고친 부류다.
 *
 * ── 「값이 있다」 를 너무 넓게 봤다 ────────────────────────────────────
 *
 * 처음엔 「다음 칸이 **아는 옵션**이면 값이 없다」 로 적었다. 12차 리뷰가
 * 그 자리에 남은 틈 셋을 짚었고 셋 다 재현됐다.
 *
 *     --since --unknown     오타 옵션이 값으로 먹혔다
 *     --since ""            셸에서 빈 변수가 오면 값으로 먹혔다
 *     --since -- a.js       POSIX 의 「옵션 끝」 표시가 값으로 먹혔다
 *
 * 셋 다 멈추는 대신 조용히 「안 올린 것 전부」 로 갔다. 이 함수가 막으려던
 * 바로 그 자리다 — 아는 옵션만 볼 것이 아니라 **값처럼 안 생겼나**를
 * 봐야 한다. 붙임표로 시작하면 값이 아니다.
 *
 * 되짚을 자리가 없다: 이 도구가 값으로 받는 것은 커밋 이름·모델 이름·
 * 시간·파일 이름뿐이고 넷 다 붙임표로 시작하지 않는다.
 *
 * 같은 옵션을 두 번 비워 쳐도 이름은 한 번만 적는다 — 화면에
 * 「--since --since」 라고 찍히면 읽는 사람이 제 오타를 못 알아본다.
 *
 * @param {string[]} 인자
 * @returns {string[]}
 */
export function 값빠진옵션(인자) {
  const 빈것 = [];
  for (let i = 0; i < 인자.length; i += 1) {
    const 칸 = String(인자[i] ?? '');
    if (!값받는옵션.has(칸)) continue;
    const 다음 = 인자[i + 1];
    const 값없다 = 다음 === undefined
      || String(다음).trim() === ''
      || String(다음).startsWith('-');
    if (값없다) {
      if (!빈것.includes(칸)) 빈것.push(칸);
    } else i += 1;
  }
  return 빈것;
}

/** `--help` 에 찍을 글. 쓰는 법 주석과 한자리에 두려고 여기 둔다. */
export function 쓰는법() {
  return [
    '',
    '2차 리뷰 — 커밋 하나씩 gemini-3.8-flash-high 에게 보여 주고 쪽지를 받는다.',
    '',
    '  node tools/review2.mjs                     안 올린 판을 본다',
    '  node tools/review2.mjs --since HEAD~3      최근 세 판을 한 판씩',
    '  node tools/review2.mjs --since HEAD~4 --to HEAD~3   그 한 판만',
    '  node tools/review2.mjs --files a.js b.js   그 파일만',
    '  node tools/review2.mjs --since HEAD~4 --to HEAD~3 --files a.js',
    '                                             그 판에서 그 파일만',
    '',
    '  --model <이름>    기본 gemini-3.8-flash-high (pro 는 쓰지 않는다)',
    '  --timeout <시간>  한 판 기다리는 시간 — 단위를 붙인다(40m · 90m · 900s)',
    '  --out <파일>      쪽지를 적을 파일 (예: --out 보고.md)',
    '  --quiet           지나가는 말을 안 찍는다',
    '  --help            이 글',
    '',
  ];
}
