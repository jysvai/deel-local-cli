// .gitignore 를 읽어, git 이 건너뛰는 것을 도구도 건너뛴다 — Glob · Grep · Outline · Verify · @폴더.
//
// 왜: walk() 는 정해진 폴더 몇 개(node_modules · dist …)만 건너뛰었다. 실제 저장소는 out/ ·
// .gradle/ · coverage/ · 만들어진 코드 · 자료 덤프를 .gitignore 에 적어 두는데, 그걸 다 훑으면
// 32k 창에서 Grep 한 번이 빌드 산출물로 예산을 다 쓴다. 사람은 git 이 안 보는 것을 도구도
// 안 볼 거라고 생각한다 — 그 기대를 맞춘다.
//
// 지원하는 것 — git 규칙의 부분집합:
//   빈 줄 · # 주석 · !부정 · 끝의 / (폴더만) · 앞의 / (그 자리에 고정) · * · ** · ? · [abc] · \ 이스케이프
//   슬래시가 없는 패턴은 어느 깊이든 이름으로 맞고, 슬래시가 있으면 그 파일이 있는 폴더 기준이다.
//   아래 폴더의 .gitignore 는 그 아래에만 적용되고, 뒤에 오는 규칙이 이긴다 (git 과 같다).
//   건너뛴 폴더 안의 것은 !로도 되살릴 수 없다 (git 도 그렇다 — 폴더째 안 들어간다).
//   뿌리의 .deelignore 도 같은 문법으로 .gitignore 뒤에 읽는다 — git 에는 안 적고 deel 만 건너뛸 것.
// 안 하는 것: 작업 폴더 **위**의 .gitignore, .git/info/exclude, core.excludesFile.
// 윈도우에서는 대소문자를 안 가린다 (globToRegex 와 같다).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 규칙 파일 하나를 규칙 목록으로.
 * @param {string} text  파일 내용
 * @param {string} 기준  그 파일이 있는 폴더 (작업 폴더 기준 상대, / 구분, 뿌리면 '')
 */
export function 규칙읽기(text, 기준 = '') {
  const out = [];
  for (const 줄 of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const r = 패턴규칙(줄, 기준);
    if (r) out.push(r);
  }
  return out;
}

/** 줄 하나 → 규칙. 빈 줄·주석이면 null. */
export function 패턴규칙(줄, 기준 = '') {
  let p = String(줄 ?? '');
  // 끝의 빈칸은 뗀다 — 역슬래시로 살린 것만 남긴다.
  p = p.replace(/(?<!\\)\s+$/, '');
  if (!p || p.startsWith('#')) return null;
  let 부정 = false;
  if (p.startsWith('!')) { 부정 = true; p = p.slice(1); }
  else if (p.startsWith('\\!') || p.startsWith('\\#')) p = p.slice(1);
  if (!p) return null;
  let 폴더만 = false;
  if (p.endsWith('/') && !p.endsWith('\\/')) { 폴더만 = true; p = p.replace(/\/+$/, ''); }
  if (!p) return null;
  let 고정 = false;
  if (p.startsWith('/')) { 고정 = true; p = p.replace(/^\/+/, ''); }
  // 슬래시가 가운데 있어도 그 자리에 고정된다. 없으면 어느 깊이든 이름으로.
  if (p.includes('/')) 고정 = true;
  const 몸 = 글롭정규식(p);
  const src = 고정 ? `^${몸}$` : `(?:^|/)${몸}$`;
  return { re: new RegExp(src, process.platform === 'win32' ? 'i' : ''), 부정, 폴더만, 기준: String(기준 ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''), 원문: 줄 };
}

// gitignore 글롭 → 정규식 몸통 (앞뒤 고정은 부르는 쪽이 붙인다).
function 글롭정규식(p) {
  let re = '';
  let i = 0;
  while (i < p.length) {
    const ch = p[i];
    if (ch === '\\' && i + 1 < p.length) { re += 글자(p[i + 1]); i += 2; continue; }
    if (ch === '*') {
      if (p[i + 1] === '*') {
        /*
         * `**` 는 **제 자리에 있을 때만** 슬래시를 넘는다.
         *
         *   맨 앞의 별둘 + 슬래시   → 어느 깊이든
         *   맨 뒤의 슬래시 + 별둘   → 그 안의 전부
         *   슬래시 사이의 별둘      → 폴더 0개 이상
         *
         * 그 밖의 자리(`a**b`)는 git 이 그냥 별 하나로 읽는다 — 슬래시를 안
         * 넘는다. 여기서 `.*` 로 읽으면 `a**b` 가 `a/dir/b` 를 걸어 버려서,
         * git 은 그대로 두는 파일을 deel 만 감춘다. 규칙을 적은 사람은
         * 없어진 파일을 찾을 길이 없다.
         */
        const 앞이경계 = i === 0 || p[i - 1] === '/';
        if (앞이경계 && p[i + 2] === '/') { re += '(?:.*/)?'; i += 3; continue; }
        if (앞이경계 && i + 2 === p.length) { re += '.*'; i += 2; continue; }
        // 붙어 있는 별은 몇 개든 하나로 친다.
        while (p[i] === '*') i += 1;
        re += '[^/]*';
        continue;
      }
      re += '[^/]*'; i += 1; continue;
    }
    if (ch === '?') { re += '[^/]'; i += 1; continue; }
    if (ch === '[') {
      const end = p.indexOf(']', i + 1);
      if (end > i + 1) {
        let 안 = p.slice(i + 1, end);
        if (안.startsWith('!')) 안 = '^' + 안.slice(1);
        re += `[${안.replace(/\\/g, '\\\\')}]`;
        i = end + 1;
        continue;
      }
      re += '\\['; i += 1; continue;
    }
    re += 글자(ch); i += 1;
  }
  return re;
}

function 글자(ch) { return ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); }

// 규칙의 기준 폴더 안에 있는 경로면 그 기준부터의 경로를, 아니면 null.
function 기준안(rel, 기준) {
  if (!기준) return rel;
  if (rel === 기준) return null;                    // 기준 폴더 자신은 그 안의 규칙 대상이 아니다
  if (!rel.startsWith(기준 + '/')) return null;
  return rel.slice(기준.length + 1);
}

/** 경로 하나가 규칙에 걸리는가 — 부모 폴더는 이미 통과했다고 보고 이 경로만 본다. walk 가 쓴다. */
export function 걸리나(rel, 폴더인가, 규칙들) {
  let 답 = false;
  for (const r of 규칙들) {
    if (r.폴더만 && !폴더인가) continue;
    const sub = 기준안(rel, r.기준);
    if (sub === null) continue;
    if (r.re.test(sub)) 답 = !r.부정;
  }
  return 답;
}

/**
 * 경로 하나가 무시되는가 — 부모 폴더까지 본다. 건너뛴 폴더 안의 것은 !로도 못 살린다.
 * @param {string} rel  작업 폴더 기준 상대 경로 (/ 구분)
 */
export function 무시하나(rel, 폴더인가, 규칙들) {
  if (!규칙들?.length) return false;
  const 칸 = String(rel).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').split('/');
  for (let i = 1; i < 칸.length; i++) {
    if (걸리나(칸.slice(0, i).join('/'), true, 규칙들)) return true;
  }
  return 걸리나(칸.join('/'), 폴더인가, 규칙들);
}

/** 파일을 읽어 규칙으로. 없거나 못 읽으면 빈 목록. */
export function 파일규칙읽기(path, 기준 = '') {
  try { return 규칙읽기(readFileSync(path, 'utf8'), 기준); } catch { return []; }
}

/** 뿌리의 규칙 — .gitignore 다음에 .deelignore. */
export function 뿌리규칙읽기(root) {
  return [...파일규칙읽기(join(root, '.gitignore'), ''), ...파일규칙읽기(join(root, '.deelignore'), '')];
}

/**
 * 뿌리부터 이 폴더까지 오면서 만나는 규칙을 다 모은다.
 *
 * walk() 는 내려가면서 폴더마다 더하면 되지만, @폴더 처럼 중간을 바로 들여다보는
 * 쪽은 자기 위쪽을 스스로 되짚어야 한다. 안 그러면 sub/.gitignore 가 있는데도
 * @sub 로 지목했을 때만 규칙이 없는 것처럼 보인다 — 같은 폴더가 도구마다 다르게
 * 보이는 것이 제일 나쁘다.
 */
export function 계보규칙읽기(root, rel = '') {
  const 규칙 = 뿌리규칙읽기(root);
  const 조각 = String(rel ?? '').replace(/\\/g, '/').split('/').filter((x) => x && x !== '.');
  let 여기 = '';
  for (const 한칸 of 조각) {
    여기 = 여기 ? `${여기}/${한칸}` : 한칸;
    규칙.push(...파일규칙읽기(join(root, ...여기.split('/'), '.gitignore'), 여기));
  }
  return 규칙;
}

/** 화면 한 줄. 건너뛴 것이 없으면 빈 문자열 — 없는데 줄을 만들면 그게 소음이다. */
/**
 * @param 건너뜀 `{ 폴더, 파일 }` — .gitignore 로 뺀 수
 * @param 잘림   상한에서 멈췄나 (walk 가 붙여 준다)
 * @param 상한   몇 개까지 봤나. 0 이면 수 없이 말한다.
 *               (숫자를 인자로 받는다 — fsutil 이 ignore 를 부르므로 거꾸로 가져오면 고리가 된다)
 */
export function 건너뜀말(건너뜀, 잘림 = false, 상한 = 0) {
  const 폴더 = 건너뜀?.폴더 ?? 0;
  const 파일 = 건너뜀?.파일 ?? 0;
  const 줄 = [];
  if (폴더 || 파일) {
    const 몫 = [폴더 ? `폴더 ${폴더}개` : null, 파일 ? `파일 ${파일}개` : null].filter(Boolean).join(' · ');
    줄.push(`(.gitignore 로 ${몫} 건너뜀 — 경로를 직접 주면 Read 된다)`);
  }
  /*
   * 상한에서 멈췄으면 반드시 말한다.
   *
   * 이 한 줄이 없으면 "일치 없음" 이 "없다" 로 읽힌다. 실제로는 안 본 것이다.
   */
  if (잘림) {
    const 몇 = 상한 ? `${상한.toLocaleString('en-US')}개까지만` : '앞부분만';
    줄.push(`(파일이 너무 많아 ${몇} 봤습니다 — 못 본 자리에 있는 것은 여기 안 나옵니다. 폴더를 좁혀서 다시 시켜 보세요)`);
  }
  return 줄.length ? `\n\n${줄.join('\n')}` : '';
}
