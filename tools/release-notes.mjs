// 릴리스 노트에서 한 판을 뽑아 GitHub 릴리스 꼴로 낸다.
//
//   node tools/release-notes.mjs <판> --title              →  「2.0.3 — …」 한 줄
//   node tools/release-notes.mjs <판>                      →  본문
//   node tools/release-notes.mjs <판> --latest-flag <태그>  →  --latest 또는 --latest=false
//
// ── 왜 이 파일이 있나 ───────────────────────────────────────────────────
//
// 2.0.2 는 GitHub 에 「Latest」 로 떠 있는데 npm 에는 없었다. 태그를 민 직후
// 손으로 `gh release create` 를 쳤고, 그 뒤 발행 워크플로의 검사가 리눅스에서
// 빨개져 npm 발행이 멈췄다. GitHub 을 보고 2.0.2 를 찾아온 사람이
// `npm i -g` 로 받은 것은 2.0.1 이었다.
//
// 그래서 릴리스는 publish.yml 이 npm 에 올린 **뒤에** 만든다. 손으로 치던 것을
// 워크플로가 치려면, 본문을 뽑는 자리가 저장소 안에 있어야 한다. 판단이 드는
// 것(어디서 끊나 · Latest 로 거나)은 셸이 아니라 여기 두어 검사가 직접 부른다.

import { readFileSync } from 'node:fs';
import { join, dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const 저장소뿌리 = join(dirname(fileURLToPath(import.meta.url)), '..');
const 판꼴 = /^\d+\.\d+\.\d+$/;

// 절은 `## <판>` 부터 **다음 판 머리** 앞까지다. 아무 `## ` 에서나 끊으면
// 2.0.0 처럼 안에 `## 1부 · …` 를 둔 판이 앞머리만 남는다. 판 뒤에 부제를
// 단 머리(`## 2.0.2 — …`)도 판 머리로 본다. `## 1.20.x` 같은 줄기 머리는 아니다.
const 판머리 = /^## v?(\d+\.\d+\.\d+)(?:\s|$)/;
const 머리판 = (l) => 판머리.exec(l)?.[1] ?? null;
const 울타리 = /^\s*(```|~~~)/;
// 판 사이의 가름줄. 마크다운은 `---` 말고도 `***` · `___` · `----` 를 받는다.
const 가름줄 = /^\s*(?:([-*_])(?:\s*\1){2,})?\s*$/;

export function 절뽑기(글, 판) {
  const 줄 = 글.replace(/\r/g, '').split('\n');
  // 코드 울타리 안의 `## 1.0.0` 은 머리가 아니라 보기 글이다.
  const 울안 = [];
  let 안 = false;
  for (const l of 줄) { if (울타리.test(l)) { 울안.push(true); 안 = !안; } else 울안.push(안); }

  const 처음 = 줄.findIndex((l, i) => !울안[i] && 머리판(l) === 판);
  if (처음 < 0) return null;
  let 끝 = 줄.length;
  for (let i = 처음 + 1; i < 줄.length; i++) {
    if (!울안[i] && 머리판(줄[i]) !== null) { 끝 = i; break; }
  }
  const 몸 = 줄.slice(처음 + 1, 끝);
  while (몸.length && 가름줄.test(몸[몸.length - 1])) 몸.pop();
  while (몸.length && !몸[0].trim()) 몸.shift();
  return 몸;
}

// 문서 안의 상대 링크는 GitHub 릴리스 화면에서 전부 끊긴다 — 거기는 문서 폴더가
// 아니다. 그 판의 태그로 못 박은 주소로 바꾼다. `main` 으로 걸면 문서가 나중에
// 바뀌었을 때 옛 판의 릴리스가 새 글을 가리킨다.
//
// 그림은 `blob/` 이 아니라 `raw/` 로 건다 — blob 은 그림을 둘러싼 HTML 쪽이라
// 릴리스 화면에서 깨진 그림이 된다. 괄호 한 겹이 든 주소(`a_(b).md`)까지 받는다.
const 링크꼴 = /(!?)\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

function 한조각풀기(글, { 판, 문서길, 저장소 }) {
  const 여기 = posix.dirname(문서길);
  return 글.replace(링크꼴, (전체, 느낌표, 글자, 곳) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(곳)) return 전체;
    const 바탕 = `${저장소}/${느낌표 ? 'raw' : 'blob'}/v${판}/`;
    let 길;
    if (곳.startsWith('#')) 길 = 문서길 + 곳;
    else if (곳.startsWith('/')) 길 = posix.normalize(곳.slice(1));
    else 길 = posix.normalize(posix.join(여기, 곳));
    return `${느낌표}[${글자}](${바탕}${길})`;
  });
}

// 한 줄 안의 `…` 코드는 건드리지 않는다 — 링크 문법을 보기로 적어 둔 자리다.
export function 링크풀기(줄, 자리) {
  return 줄.split(/(`[^`]*`)/).map((조각, i) => (i % 2 ? 조각 : 한조각풀기(조각, 자리))).join('');
}

export function 저장소주소(pkg) {
  const u = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '');
  // npm 이 받는 줄임꼴: `o/r` · `github:o/r`
  const 줄임 = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(u);
  if (줄임) return `https://github.com/${줄임[1]}`;
  return u.replace(/^git\+/, '').replace(/\.git$/, '');
}

// 옛 태그를 뒤늦게 밀어도 릴리스 job 을 지난다. 그대로 만들면 옛 판이 Latest 를
// 가져간다 (1.18.0 이 실제로 그랬다). 지금 Latest 보다 높을 때만 Latest 로 건다.
// 판은 글자가 아니라 **수로** 견준다 — 글자로 견주면 1.9.0 이 1.10.0 보다 크다.
export function 최신깃발(판, 지금태그) {
  const 수 = (v) => v.replace(/^v/, '').split('.').map(Number);
  if (!지금태그) return '--latest';
  const [a, b] = [수(판), 수(지금태그)];
  if (b.length !== 3 || b.some(Number.isNaN)) throw new Error(`지금 Latest 태그를 못 읽습니다: ${지금태그}`);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? '--latest' : '--latest=false';
  return '--latest';
}

export function 릴리스글(판, 뿌리 = 저장소뿌리) {
  if (!판꼴.test(판)) throw new Error(`판 번호가 아닙니다: ${판}`);
  const 줄기 = 판.split('.').slice(0, 2).join('.');
  const 문서길 = `docs/ko/releases/${줄기}.md`;
  const 몸 = 절뽑기(readFileSync(join(뿌리, 문서길), 'utf8'), 판);
  if (!몸 || !몸.length) throw new Error(`${문서길} 에 ## ${판} 절이 없습니다`);
  const 머리줄 = 몸.find((l) => /^\*\*.+\*\*\s*$/.test(l));
  if (!머리줄) throw new Error(`${문서길} 의 ## ${판} 절에 **한 줄 제목** 이 없습니다`);
  const 저장소 = 저장소주소(JSON.parse(readFileSync(join(뿌리, 'package.json'), 'utf8')));
  if (!/^https:\/\//.test(저장소)) throw new Error(`package.json 의 repository 를 주소로 못 읽습니다: ${저장소 || '(없음)'}`);

  let 안 = false;
  const 본문 = 몸.map((l) => {
    if (울타리.test(l)) { 안 = !안; return l; }
    return 안 ? l : 링크풀기(l, { 판, 문서길, 저장소 });
  });
  return { 제목: `${판} — ${머리줄.trim().slice(2, -2)}`, 본문: 본문.join('\n') + '\n' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [판, ...깃발] = process.argv.slice(2);
  try {
    const 최신자리 = 깃발.indexOf('--latest-flag');
    if (최신자리 >= 0) {
      if (!판꼴.test(판 ?? '')) throw new Error(`판 번호가 아닙니다: ${판}`);
      process.stdout.write(`${최신깃발(판, 깃발[최신자리 + 1] ?? '')}\n`);
    } else {
      const { 제목, 본문 } = 릴리스글(판 ?? '');
      process.stdout.write(깃발.includes('--title') ? `${제목}\n` : 본문);
    }
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
  }
}
