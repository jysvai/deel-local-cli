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

/*
 * 코드 울타리 안은 글이 아니라 예시다. 거기 적힌 주소는 우리 파일이 아니다.
 *
 * ── 백틱 셋만 세면 백틱 넷짜리 울타리에서 안팎이 뒤집힌다 ────────────────
 *
 * 마크다운을 마크다운 안에 보이려면 울타리를 백틱 넷으로 연다(````). 이
 * 저장소가 실제로 그렇게 적는다 — `docs/{ko,en}/releases/1.20.md` 의 452째
 * 줄이 그 자리다. 그런데 여태 ``` 로 시작하는 줄이면 무조건 뒤집었다. 백틱
 * 넷으로 연 울타리 **안**의 ```js 한 줄이 울타리를 닫아 버리고, 그 뒤로는
 * 안과 밖이 통째로 뒤바뀐 채 파일 끝까지 간다.
 *
 * 뒤집힌 다음의 글은 전부 「울타리 안」 이라 검사에서 빠졌다. 2,500줄짜리
 * 파일의 앞머리에서 뒤집혔으니, 그 뒤에 끊긴 링크를 적어도 관문은 초록이다 —
 * 검사한다고 적어 놓고 한 줄도 안 보는 것과 같다.
 *
 * CommonMark 그대로 잰다: 연 울타리보다 **짧은** 울타리로는 못 닫고, 닫는
 * 줄에는 다른 글자가 없어야 한다. 물결(~~~) 울타리도 같은 자리에서 센다.
 */
function 울타리빼기(글) {
  let 연것 = null;                                // 열려 있는 울타리의 글자와 길이
  return 글
    .split('\n')
    .map((줄) => {
      const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(줄);
      if (m) {
        const [글자, 길이, 뒤] = [m[1][0], m[1].length, m[2]];
        if (!연것) {
          // 여는 줄. 백틱 울타리의 정보 글자에는 백틱이 못 들어간다 —
          // ```js x``` 한 줄은 울타리가 아니라 그냥 글이다.
          if (글자 === '`' && 뒤.includes('`')) return 줄;
          연것 = { 글자, 길이 };
          return '';
        }
        if (글자 === 연것.글자 && 길이 >= 연것.길이 && 뒤.trim() === '') 연것 = null;
        return '';
      }
      return 연것 ? '' : 줄;
    })
    .join('\n');
}

/*
 * 그 파일의 **제목**들. 울타리 안은 벗기고 본다 — 셸 예시 안의 주석 한 줄
 * (`# 설치`)이 제목 행세를 하면, 그 이름을 가리킨 닻이 초록으로 지나간다.
 * GitHub 에는 그 닻이 없으므로 읽는 사람만 막다른 길에 선다. 검사가 있는데
 * 반대로 답하는 것이 검사가 없는 것보다 나쁘다.
 */
function 닻들(파일) {
  const 것 = new Set();
  for (const 줄 of 울타리빼기(readFileSync(파일, 'utf8')).split('\n')) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(줄);
    if (m) 것.add(닻(m[1]));
  }
  return 것;
}

/*
 * README 의 그림은 전부 `raw.githubusercontent` 절대 주소다 — npm 페이지에서도
 * 보이려면 그래야 한다. 그래서 그림 검사가 `^https?:` 한 줄에서 통째로 비껴갔고,
 * 머리말은 그림을 본다고 적어 둔 채 **한 장도 안 봤다.** 이름을 틀리게 적어도
 * 초록이고, 깨진 그림은 읽는 사람만 본다.
 *
 * 우리 저장소를 가리키는 주소만 이 PC 파일로 돌려놓고 본다. 남의 저장소 주소를
 * 우리 파일인 양 재면 그게 거짓 경고가 된다 — 그래서 package.json 의 이름표와
 * 맞을 때만 돌려놓는다.
 */
const 우리저장소 = (() => {
  try {
    const url = JSON.parse(readFileSync('package.json', 'utf8'))?.repository?.url ?? '';
    const m = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(url);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch { return null; }
})();

/** 문서가 가리킨 그림이 이 PC 의 어느 파일인가. 우리가 잴 것이 아니면 null. */
function 이PC자리(주소, 파일) {
  if (!/^https?:/.test(주소)) return normalize(join(dirname(파일), 주소)).replace(/\\/g, '/');
  if (!우리저장소) return null;
  const 앞 = `https://raw.githubusercontent.com/${우리저장소}/`;
  if (!주소.startsWith(앞)) return null;
  const 뒤 = 주소.slice(앞.length).split('/');
  뒤.shift();                                   // 가지 이름 한 칸
  const 길 = 뒤.join('/');
  return 길 || null;
}

/** 문서가 실제로 가리킨 그림. 아무도 안 가리키는 것을 찾는 데 쓴다. */
const 쓰인그림 = new Set();
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
  // 폴더가 통째로 없으면 여기서 ENOENT 로 죽었다. 관문(`npm run docs`)이
  // 부르는 연장이 스택을 토하면, 링크가 끊긴 것인지 폴더가 없어진 것인지를
  // 사람이 못 가른다. 없으면 없다고 적고 나머지는 그대로 본다.
  if (!existsSync(`docs/${말}`)) { 탈.push(`docs/${말} (폴더 없음)`); continue; }
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
    const 자리 = 이PC자리(m[1], 파일);
    if (!자리) continue;
    if (!existsSync(자리)) { 탈.push(`${파일} → ${m[1]} (그림 없음)`); continue; }
    쓰인그림.add(자리);
  }
}

/*
 * 아무 문서도 안 가리키는 그림은 아무도 못 본다. 쌓이면 어느 것이 살아 있는
 * 그림인지 사람이 못 가른다 — 그래서 여기서 막는다. 그림을 그려 놓고 아직
 * 문서에 안 걸었다면, 거는 것이 남은 일이다.
 */
if (existsSync('docs/assets')) {
  for (const 이름 of readdirSync('docs/assets')) {
    const 자리 = `docs/assets/${이름}`;
    if (!쓰인그림.has(자리)) 탈.push(`${자리} (아무 문서도 안 가리킴)`);
  }
}
/*
 * ko ↔ en 짝. 「문서는 짝으로 둔다」 는 집안 규칙인데 지키는 검사가 없었다 —
 * 한쪽 말에만 문서를 더해도 관문이 초록으로 지나가고, 반대말을 읽는 사람만
 * 없는 쪽에 선다. 링크가 안 끊겨도 그 사람에게는 문서가 없는 것과 같다.
 */
function 짝없는문서() {
  const 목록 = (말) => {
    const 것 = new Set();
    const 담기 = (자리, 앞) => {
      for (const f of readdirSync(자리, { withFileTypes: true })) {
        if (f.isDirectory()) 담기(`${자리}/${f.name}`, `${앞}${f.name}/`);
        else if (/\.md$/.test(f.name)) 것.add(`${앞}${f.name}`);
      }
    };
    if (existsSync(`docs/${말}`)) 담기(`docs/${말}`, '');
    return 것;
  };
  const ko = 목록('ko');
  const en = 목록('en');
  const 난것 = [];
  for (const f of ko) if (!en.has(f)) 난것.push(`docs/en/${f} (ko 에만 있고 en 에 없음)`);
  for (const f of en) if (!ko.has(f)) 난것.push(`docs/ko/${f} (en 에만 있고 ko 에 없음)`);
  return 난것.sort();
}
탈.push(...짝없는문서());
console.log('');
if (탈.length) {
  for (const s of 탈) console.log(`  ✗ ${s}`);
  console.log(`\n  끊긴 링크 ${탈.length}개`);
  process.exitCode = 1;
} else {
  console.log(`  문서 ${볼것.length}개 · 끊긴 링크 없음`);
}
console.log('');
