/**
 * 문서 링크가 진짜 있는 자리를 가리키나 본다.
 *
 * README 를 나눈 뒤로는 링크가 파일 경계를 넘는다. 끊어져도 아무 데도 안 찍히고,
 * 읽는 사람만 막다른 길에 선다. 그래서 검사한다 —
 *
 *   · 파일 링크(`docs/ko/tools.md`)가 실제로 있나
 *   · 닻(`#140`, `#사내-반입`)이 그 파일의 제목에서 나오나
 *   · 그림(`docs/assets/*.svg`)이 있나
 *
 *   node tools/check-docs.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const 탈 = [];

/** GitHub 가 제목에서 만드는 닻. 이 셈이 틀리면 검사 자체가 거짓이 된다. */
function 닻(제목) {
  return 제목
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    // 빈칸 하나가 하이픈 하나다. 여러 칸을 하나로 줄이면 안 된다 —
    // `쉬움 · 개발자` 의 닻은 `쉬움--개발자` 이지 `쉬움-개발자` 가 아니다.
    .replace(/ /g, '-');
}

/** 코드 울타리 안은 글이 아니라 예시다. 거기 적힌 주소는 우리 파일이 아니다. */
function 울타리빼기(글) {
  let 안 = false;
  return 글
    .split('\n')
    .map((줄) => {
      if (/^\s*```/.test(줄)) { 안 = !안; return ''; }
      return 안 ? '' : 줄;
    })
    .join('\n');
}

function 닻들(파일) {
  const 것 = new Set();
  for (const 줄 of readFileSync(파일, 'utf8').split('\n')) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(줄);
    if (m) 것.add(닻(m[1]));
  }
  return 것;
}

const 볼것 = ['README.md', 'README.ko.md'];
for (const 말 of ['ko', 'en']) {
  // 릴리스 노트처럼 줄기마다 폴더로 나뉜 것도 같이 본다. 안 보면 그 안의
  // 링크만 검사 밖에 남아서, 끊겨도 아무 데도 안 찍힌다.
  const 담기 = (자리) => {
    for (const f of readdirSync(자리, { withFileTypes: true })) {
      if (f.isDirectory()) 담기(`${자리}/${f.name}`);
      else if (/\.md$/.test(f.name)) 볼것.push(`${자리}/${f.name}`);
    }
  };
  담기(`docs/${말}`);
}

for (const 파일 of 볼것) {
  const 글 = 울타리빼기(readFileSync(파일, 'utf8'));
  const 여기닻 = 닻들(파일);
  for (const m of 글.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const 주소 = m[1];
    if (/^(https?:|mailto:)/.test(주소)) continue;

    const [자리, 닻이름] = 주소.split('#');
    let 대상 = 파일;
    if (자리) {
      대상 = normalize(join(dirname(파일), 자리)).replace(/\\/g, '/');
      if (!existsSync(대상)) { 탈.push(`${파일} → ${주소} (파일 없음)`); continue; }
      // 폴더 링크(docs/ko/)는 GitHub 에서 목록으로 열린다. 그건 그대로 둔다.
      if (!/\.md$/.test(대상)) continue;
    }
    if (닻이름) {
      const 있는것 = 대상 === 파일 ? 여기닻 : 닻들(대상);
      if (!있는것.has(닻이름.toLowerCase())) 탈.push(`${파일} → ${주소} (닻 없음)`);
    }
  }
  // 그림도 본다. 낱말 울타리(`src="app.js"`) 안은 예시라 빼고 본다.
  for (const m of 글.replace(/`[^`\n]*`/g, '').matchAll(/(?:src|srcset)="([^"]+)"/g)) {
    if (/^https?:/.test(m[1])) continue;
    const 자리 = normalize(join(dirname(파일), m[1])).replace(/\\/g, '/');
    if (!existsSync(자리)) 탈.push(`${파일} → ${m[1]} (그림 없음)`);
  }
}

console.log('');
if (탈.length) {
  for (const s of 탈) console.log(`  ✗ ${s}`);
  console.log(`\n  끊긴 링크 ${탈.length}개`);
  process.exitCode = 1;
} else {
  console.log(`  문서 ${볼것.length}개 · 끊긴 링크 없음`);
}
console.log('');
