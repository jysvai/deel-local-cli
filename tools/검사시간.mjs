// 검사 파일마다 한 판이 몇 초인가 — 어긋내기 조각을 고르게 나누는 데만 쓴다.
//
// ── 왜 필요한가 ─────────────────────────────────────────────────────────
//
// 어긋내기를 여덟 조각으로 나눌 때 **개수**로 세면 고르게 안 나뉜다. 어긋
// 하나의 값은 개수가 아니라 짝지은 검사가 얼마나 느린가로 정해지기 때문이다.
//
//   test/jobs.test.js   한 판 55초
//   test/wire.test.js   한 판 0.1초
//
// 500배다. 실제로 조각 1 이 81분, 조각 4 가 1.6분이었다 — 둘 다 207개씩인데.
// 관문 시간은 제일 느린 조각이 정하므로, 그 한 조각이 곧 관문 시간이다.
//
// ── 어떻게 쓰나 ─────────────────────────────────────────────────────────
//
//   npm test > 어디에.txt          (또는 이미 받아 둔 출력)
//   node tools/검사시간.mjs 어디에.txt
//
// `test/검사시간.json` 을 새로 적는다. 화면에 뭐가 바뀌었는지도 적는다.
//
// **리눅스에서 잰 값을 쓴다.** 조각을 나누는 곳이 리눅스 관문이기 때문이다.
// 개발 PC(윈도)에서 재면 윈도 전용 길이 더 돌아 값이 달라지고, 그러면 나누는
// 기준이 「관문이 치를 값」 이 아니게 된다. CI 로그를 그대로 먹여도 된다:
//
//   gh run view --log --job <id> > 로그.txt
//   node tools/검사시간.mjs 로그.txt
//
// ── 낡아도 틀리지 않는다 ────────────────────────────────────────────────
//
// 이 표는 **나누는 데만** 쓴다. 표에 없는 검사는 기본값으로 세고, 값이 실제와
// 어긋나면 조각이 덜 고르게 나뉠 뿐 재는 결과는 그대로다. 그래서 여기에는
// 관문을 안 건다 — 검사 하나 더할 때마다 표를 고치게 하면 아무도 검사를
// 안 늘리게 되고, 그게 훨씬 비싸다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const 뿌리 = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const 들어온것 = process.argv[2];

if (!들어온것 || !existsSync(들어온것)) {
  console.error('  `npm test` 출력을 담은 파일을 주세요 — node tools/검사시간.mjs 출력.txt');
  process.exit(2);
}

/*
 * run.mjs 의 끝 표에서 파일마다 한 줄씩 나온다:
 *
 *   ✓ jobs.test.js        0     184    0    -    54.4초
 *
 * 색은 떼고 본다. 사람이 터미널에서 받은 출력에는 ESC 순서가 섞여 있고,
 * `gh run view --log` 는 같은 것을 **캐럿 꼴(`^[[90m`)로 적어 준다** — 진짜
 * ESC 글자가 아니라 `^` 와 `[` 두 글자다. 한 쪽만 떼면 CI 로그에서 한 줄도
 * 못 찾고 「하나도 못 찾았습니다」 로 끝난다(실제로 그랬다).
 *
 * 줄 앞머리는 안 본다. CI 로그는 줄마다 job 이름과 시각을 앞에 붙인다.
 */
const 글 = readFileSync(들어온것, 'utf8')
  .replace(/\u001b\[[0-9;]*m/g, '')
  .replace(/\^\[\[[0-9;]*m/g, '');
const 잰것 = {};
for (const 줄 of 글.split(/\r?\n/)) {
  const m = /[✓✗]\s+(\S+?\.(?:test\.js|mjs|js))\s+.*?([\d.]+)초\s*$/.exec(줄);
  if (m) 잰것[`test/${m[1]}`] = Number(m[2]);
}

if (Object.keys(잰것).length === 0) {
  console.error('  그 출력에서 검사 시간을 하나도 못 찾았습니다 — `npm test` 의 끝 표가 들어 있는지 보세요.');
  process.exit(2);
}

const 자리 = join(뿌리, 'test', '검사시간.json');
let 옛것 = {};
try { 옛것 = JSON.parse(readFileSync(자리, 'utf8')); } catch { /* 처음 적는 판 */ }

// 열쇠를 정렬해서 적는다 — 안 그러면 다시 뽑을 때마다 줄 순서가 흔들려
// 차이를 읽을 수 없다.
const 정렬된 = Object.fromEntries(Object.keys(잰것).sort().map((k) => [k, 잰것[k]]));
writeFileSync(자리, `${JSON.stringify(정렬된, null, 2)}\n`, 'utf8');

const 느린것 = Object.entries(정렬된).sort((a, b) => b[1] - a[1]).slice(0, 8);
const 새로온것 = Object.keys(정렬된).filter((k) => !(k in 옛것));
const 사라진것 = Object.keys(옛것).filter((k) => !(k in 정렬된));

console.log(`\n  검사 ${Object.keys(정렬된).length}개 · 합 ${Object.values(정렬된).reduce((a, b) => a + b, 0).toFixed(0)}초`);
console.log(`\n  제일 느린 것`);
for (const [k, v] of 느린것) console.log(`    ${String(v).padStart(6)}초  ${k}`);
if (새로온것.length) console.log(`\n  새로 온 검사 ${새로온것.length}개: ${새로온것.slice(0, 5).join(' · ')}`);
if (사라진것.length) console.log(`  표에서 사라진 검사 ${사라진것.length}개: ${사라진것.slice(0, 5).join(' · ')}`);
console.log(`\n  적었습니다 — test/검사시간.json\n`);
