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
 * 이미 한 번 고친 부류다. 다음 칸이 없거나 그 칸이 또 옵션이면 값이 없다.
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
    if (다음 === undefined || 아는옵션.includes(String(다음))) 빈것.push(칸);
    else i += 1;
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
    '  node tools/review2.mjs --files a.js b.js   그 파일만 (--since 와 못 씀)',
    '',
    '  --model <이름>    기본 gemini-3.8-flash-high (pro 는 쓰지 않는다)',
    '  --timeout <초>    한 판 기다리는 시간',
    '  --out <자리>      쪽지를 담을 폴더',
    '  --quiet           지나가는 말을 안 찍는다',
    '  --help            이 글',
    '',
  ];
}
