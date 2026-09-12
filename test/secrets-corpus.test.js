// 울타리를 옮기면 **어디까지 흔들렸는지**를 한 판에 보여 주는 눈금자.
//
// ── 왜 만들었나 ─────────────────────────────────────────────────────────
//
// 비밀 가리기는 「이 줄이 비밀인가 코드인가」 를 무늬 하나로 가른다. 그 무늬를
// 한 군데 손대면 손댄 자리만 바뀌지 않는다 — 1.19.1 은 괄호 규칙을 좁혔다가
// 넉 줄을 새게 했고, 1.20.1 은 붙임표를 빼려다 밑줄을 막았고, 같은 판이
// 「값 줄을 보라」 로 고쳤다가 이름 줄을 잃었다. **매번 다음 판에서야
// 드러났다.**
//
// 낱낱의 검사로는 이걸 못 본다. 검사는 적어 둔 줄만 보고, 안 적어 둔 줄은
// 조용히 바뀐다. 그래서 여기서는 **한 뭉치를 통째로** 가려 보고, 가린 결과를
// 파일로 적어 둔 것과 글자 하나까지 견준다.
//
// 어긋나면 그 자체로 잘못은 아니다. 잘못은 **왜 어긋났는지 모른 채 다시
// 적는 것**이다. 어긋난 줄을 옛것·새것으로 나란히 찍어 주는 까닭이다.
//
// 다시 적으려면: node test/secrets-corpus.test.js --기록
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { 가리기 } from '../src/safety/secrets.js';

const 넣을것 = fileURLToPath(new URL('./fixtures/secrets-corpus.txt', import.meta.url));
const 적어둔것 = fileURLToPath(new URL('./fixtures/secrets-corpus.masked.txt', import.meta.url));
const 판넣을것 = fileURLToPath(new URL('./fixtures/secrets-corpus-blocks.txt', import.meta.url));
const 판적어둔것 = fileURLToPath(new URL('./fixtures/secrets-corpus-blocks.masked.txt', import.meta.url));

/** 이름표 줄(`#` 로 시작)과 빈 줄은 재는 대상이 아니다. */
const 잴줄인가 = (줄) => 줄.trim() !== '' && !줄.startsWith('#');

const 줄들 = readFileSync(넣을것, 'utf8').split(/\r?\n/);
const 잰것 = 줄들.map((줄) => (잴줄인가(줄) ? 가리기(줄).글 : 줄)).join('\n');
const 잰줄수 = 줄들.filter(잴줄인가).length;

/*
 * 여러 줄에 걸친 판. `~~~` 한 줄이 판과 판 사이고, 눈금자 제 주석은 `#!`
 * 로 시작한다 — 판 안의 `#` 주석 줄을 살려야 하기 때문이다. 한 줄짜리로는
 * 이걸 못 재는데, 최근 흠 셋 중 둘이 여러 줄에 걸친 자리였다 — 이름과
 * 값이 다른 줄에 있을 때 어느 줄을 보느냐가 매번 문제였다.
 */
const 판나누기 = (글) => 글.split(/\r?\n/).filter((줄) => !줄.startsWith('#!')).join('\n')
  .split(/^~~~$/m).map((판) => 판.replace(/^\n+|\n+$/g, '')).filter((판) => 판 !== '');

const 판들 = 판나누기(readFileSync(판넣을것, 'utf8'));
const 잰판 = 판들.map((판) => 가리기(판).글).join('\n~~~\n');

let 통과 = 0;
let 실패 = 0;

const check = (이름, 맞나, 곁들임 = '') => {
  if (맞나) {
    통과 += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${이름}\x1b[90m  ${곁들임}\x1b[0m`);
    return;
  }
  실패 += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${이름}\x1b[90m  ${곁들임}\x1b[0m`);
};

const 재기 = () => {
  let 적힌것;
  try {
    적힌것 = readFileSync(적어둔것, 'utf8');
  } catch {
    console.log('  \x1b[31m✗\x1b[0m 적어 둔 것이 없습니다 — --기록 으로 먼저 적으세요');
    실패 += 1;
    return;
  }

  const A = 적힌것.replace(/\n$/, '').split('\n');
  const B = 잰것.replace(/\n$/, '').split('\n');
  check('★★★ 잰 줄 수가 같다', A.length === B.length, `적힌 것 ${A.length}줄 · 잰 것 ${B.length}줄`);

  let 어긋 = 0;
  for (let i = 0; i < Math.max(A.length, B.length); i += 1) {
    if (A[i] === B[i]) continue;
    어긋 += 1;
    if (어긋 <= 20) {
      console.log(`      \x1b[31m${i + 1}번째 줄\x1b[0m`);
      console.log(`        적힌 것 ${JSON.stringify(A[i] ?? null)}`);
      console.log(`        잰 것   ${JSON.stringify(B[i] ?? null)}`);
    }
  }
  if (어긋 > 20) console.log(`      \x1b[90m… ${어긋 - 20}줄 더\x1b[0m`);

  check(`★★★ 가린 결과가 적어 둔 것과 같다 — ${잰줄수}줄`, 어긋 === 0, `${어긋}줄이 다릅니다`);

  let 판적힌것;
  try {
    판적힌것 = readFileSync(판적어둔것, 'utf8');
  } catch {
    console.log('  \x1b[31m✗\x1b[0m 여러 줄 판을 적어 둔 것이 없습니다 — --기록 으로 먼저 적으세요');
    실패 += 1;
    return;
  }
  const C = 판적힌것.replace(/\n$/, '').split('\n');
  const D = 잰판.split('\n');
  let 판어긋 = 0;
  for (let i = 0; i < Math.max(C.length, D.length); i += 1) {
    if (C[i] === D[i]) continue;
    판어긋 += 1;
    if (판어긋 <= 20) {
      console.log(`      \x1b[31m여러 줄 판 ${i + 1}번째 줄\x1b[0m`);
      console.log(`        적힌 것 ${JSON.stringify(C[i] ?? null)}`);
      console.log(`        잰 것   ${JSON.stringify(D[i] ?? null)}`);
    }
  }
  check(`★★★ 여러 줄 판도 적어 둔 것과 같다 — ${판들.length}판`,
    판어긋 === 0, `${판어긋}줄이 다릅니다`);

  if (어긋 > 0) {
    console.log('\n  \x1b[90m어긋난 줄마다 **왜** 달라졌는지 말할 수 있어야 다시 적습니다.\x1b[0m');
    console.log('  \x1b[90mnode test/secrets-corpus.test.js --기록\x1b[0m');
  }
};

if (process.argv.includes('--기록')) {
  writeFileSync(적어둔것, 잰것.endsWith('\n') ? 잰것 : `${잰것}\n`, 'utf8');
  writeFileSync(판적어둔것, `${잰판}\n`, 'utf8');
  console.log(`  적었습니다 — ${적어둔것}`);
  console.log(`             ${판적어둔것}`);
  console.log(`  잰 줄 ${잰줄수}개 · 여러 줄 판 ${판들.length}개`);
} else {
  재기();
  console.log(`\n  ${통과}개 통과 · ${실패}개 실패`);
  if (실패) process.exitCode = 1;
}
