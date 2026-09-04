/**
 * 내보내는 판에 적힌 숫자가 **사실인가.**
 *
 * ── 왜 이 파일이 있나 ──────────────────────────────────────────────────
 *
 * npm 에 올라간 판이 1.12.0 인데 README 의 화면 보기에는 `deel 1.10.0` 이
 * 적혀 있었다. 릴리스 표의 맨 윗줄도 1.10.0 이었다. 두 판이 그 사이에 나갔는데
 * README 만 뒤에 남은 것이다.
 *
 * 검사 배지도 같았다 — `tests-6,869 passing` 이라고 적혀 있는 동안 실제 수는
 * 계속 늘고 있었다. 아무도 안 틀렸다고 말해 주지 않으니 아무도 안 고쳤다.
 *
 * 이런 것이 왜 문제인가: 이 프로그램이 파는 것이 「화면이 거짓말을 안 한다」
 * 인데, **그 프로그램을 소개하는 문서가 거짓말을 하고 있으면** 그 약속을
 * 처음 읽는 자리에서 깨는 셈이다. 받는 사람은 확인할 방법이 없다.
 *
 * 그래서 사람이 기억해서 고치는 것이 아니라, 어긋나면 **검사가 빨개지게** 한다.
 * 판을 올릴 때 이 검사가 무엇을 고쳐야 하는지 그 자리에서 말해 준다.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';
import { VERSION } from '../src/version.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const 판 = pkg.version;
const 읽기 = (p) => readFileSync(join(repo, p), 'utf8');

trace('1-판번호');

// ── 1. 문서에 적힌 판 번호 ──────────────────────────────────────────────
//
// README 의 화면 보기에는 진짜 화면이 찍는 것과 같은 줄이 들어간다. 그 줄의
// 판 번호가 package.json 과 다르면, 그것은 **아직 안 나온 화면**을 보여 주는
// 것이다.
{
  for (const [파일, 꼬리] of [['README.md', 'inside'], ['README.ko.md', '이 안']]) {
    const 글 = 읽기(파일);
    const m = new RegExp(`deel (\\d+\\.\\d+\\.\\d+)\\s+⌂ ${꼬리}`).exec(글);
    check(`★★ ${파일} 의 화면 보기가 지금 판이다`, m?.[1] === 판,
      `README ${m?.[1] ?? '(못 찾음)'} vs package.json ${판}`);
  }

  /*
   * 화면이 말하는 판도 같은 값이어야 한다.
   *
   * 글자를 찾지 않고 **실제로 불러서** 본다. 소스를 정규식으로 뒤지면 주석에
   * 적힌 옛 번호(이 파일이 왜 생겼는지 설명하려고 적어 둔 '0.9.0')까지 잡는다 —
   * 그 검사는 고칠 것이 없는데도 빨개진다.
   */
  check('★★ 화면이 말하는 판이 package.json 과 같다', VERSION === 판, `${VERSION} vs ${판}`);
}

trace('2-릴리스노트');

// ── 2. 이 판의 릴리스 노트가 실제로 있는가 ──────────────────────────────
//
// 판을 올리면서 노트를 안 쓰면, 「무엇이 바뀌었나」 를 묻는 사람에게 답할 것이
// 없다. 링크만 있고 알맹이가 없는 것이 제일 나쁘다 — 있다고 믿고 눌렀는데
// 없는 것이라서.
{
  const 줄기 = 판.split('.').slice(0, 2).join('.');
  for (const 언어 of ['ko', 'en']) {
    const p = `docs/${언어}/releases/${줄기}.md`;
    const 있나 = existsSync(join(repo, p));
    check(`★★ ${p} 가 있다`, 있나, p);
    if (!있나) continue;
    const 글 = readFileSync(join(repo, p), 'utf8');
    check(`★★ ${p} 에 ## ${판} 절이 있다`, 글.includes(`## ${판}`), '');
  }

  // 차례에도 올라와 있어야 한다. 안 올리면 그 줄기는 아무 데서도 안 보인다.
  for (const 언어 of ['ko', 'en']) {
    const 차례 = 읽기(`docs/${언어}/releases.md`);
    check(`★ docs/${언어}/releases.md 차례에 ${줄기}.x 가 있다`,
      차례.includes(`releases/${줄기}.md`), '');
  }

  // README 릴리스 표의 맨 윗줄도 이 판이어야 한다.
  for (const [파일, 언어] of [['README.md', 'en'], ['README.ko.md', 'ko']]) {
    const 글 = 읽기(파일);
    const 표 = 글.slice(글.indexOf(언어 === 'ko' ? '## 릴리스 노트' : '## Release notes'));
    const 첫줄 = 표.split('\n').find((l) => /^\|\s*\*{0,2}\[\d+\.\d+\.\d+\]/.test(l)) ?? '';
    const 첫판 = /\[(\d+\.\d+\.\d+)\]/.exec(첫줄)?.[1] ?? null;
    check(`★★ ${파일} 릴리스 표의 맨 윗줄이 지금 판이다`, 첫판 === 판,
      `${첫판} vs ${판}`);
  }
}

trace('3-배지');

// ── 3. 배지에 박아 둔 숫자 ──────────────────────────────────────────────
//
// 배지는 손으로 적는 숫자다. 손으로 적는 숫자는 반드시 낡는다. 검사 수가
// 실제와 크게 어긋나면 여기서 말한다.
//
// **딱 맞으라고 하지 않는다.** 검사를 하나 더할 때마다 README 를 고치게 하면
// 그게 더 나쁜 규칙이다 — 사람이 검사를 안 늘리게 된다. 대신 「자릿수가
// 맞나」 정도로 본다. 6,869 로 적어 두고 7,000 을 넘겨도 그건 거짓말이 아니라
// 반올림이지만, 5,000 대로 적혀 있으면 그건 다른 프로그램 이야기다.
{
  const 세보기 = () => {
    let n = 0;
    for (const 파일 of ['README.md']) {
      const m = /tests-([\d%C,]+)%20passing/.exec(읽기(파일));
      if (m) n = Number(m[1].replace(/%2C|,/g, ''));
    }
    return n;
  };
  const 적힌수 = 세보기();
  check('★ 검사 배지에 숫자가 있다', 적힌수 > 0, String(적힌수));
  // 실제 수는 여기서 안 센다 — 세려면 전체 검사를 다시 돌려야 하고, 그건
  // 이 파일이 할 일이 아니다. 대신 두 README 가 **서로** 같은 수를 적었는지
  // 는 여기서 본다. 하나만 고치고 하나를 잊는 것이 실제로 나던 일이다.
  const en = /tests-([\d%C,]+)%20passing/.exec(읽기('README.md'))?.[1];
  const ko = /tests-([\d%C,]+)%20passing/.exec(읽기('README.ko.md'))?.[1];
  check('★★ 두 README 의 검사 배지가 같다', !!en && en === ko, `${en} vs ${ko}`);
}

trace('4-담기는것');

// ── 4. 배포 묶음 ────────────────────────────────────────────────────────
{
  const files = pkg.files ?? [];
  for (const 것 of ['bin', 'src', 'README.md', 'README.ko.md', 'LICENSE']) {
    check(`묶음에 ${것} 이 들어간다`, files.includes(것), files.join(', '));
  }
  // 검사와 연장은 안 담는다 — 받는 사람에게 필요 없고, 담으면 크기만 는다.
  check('★ 검사·연장은 안 담는다', !files.includes('test') && !files.includes('tools'),
    files.join(', '));
  check('★ prepublishOnly 가 검사를 돌린다',
    /npm run check/.test(pkg.scripts?.prepublishOnly ?? '')
    && /npm test/.test(pkg.scripts?.prepublishOnly ?? ''), pkg.scripts?.prepublishOnly ?? '');
}

// ── 마무리 ──────────────────────────────────────────────────────────────
const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n내보내는 판의 숫자  ${D}(문서가 거짓말하면 첫 줄에서 약속이 깨진다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
