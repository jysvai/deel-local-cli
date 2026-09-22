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

/*
 * ── 끝 빈칸 떼기는 git 과 **똑같이** (2.0.2 · G4) ─────────────────────────────
 *
 * 「역슬래시 바로 뒤 빈칸은 살린다」 로 쟀더니 `foo\\ ` 가 틀렸다. 앞의 `\\` 는 역슬래시 **글자**
 * 하나이고 빈칸은 안 살린 것이라 git 은 `foo\` 로 읽는데, 우리는 빈칸까지 남겨 `foo\ ` 를 찾았다.
 * git(dir.c 의 trim_trailing_spaces)을 그대로 옮긴다 — 역슬래시는 다음 글자 하나를 먹고, 떼는 것은
 * 끝에 이어진 **빈칸**(' ')뿐이다. 탭은 git 도 안 뗀다.
 */
export function 끝빈칸떼기(줄) {
  const p = String(줄 ?? '');
  let 빈칸자리 = -1;
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === ' ') { if (빈칸자리 < 0) 빈칸자리 = i; continue; }
    if (ch === '\\') { i++; if (i >= p.length) return p; }
    빈칸자리 = -1;
  }
  return 빈칸자리 >= 0 ? p.slice(0, 빈칸자리) : p;
}

/** 줄 하나 → 규칙. 빈 줄·주석이면 null. */
export function 패턴규칙(줄, 기준 = '') {
  let p = String(줄 ?? '');
  // 끝의 빈칸은 뗀다 — 역슬래시로 살린 것만 남긴다.
  p = 끝빈칸떼기(p);
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
  /*
   * ── 망가진 한 줄은 **그 줄만** 버린다 (사냥5 L3) ────────────────────────
   *
   * `file[z-a].tmp` 처럼 글자 묶음 범위가 거꾸로면 RegExp 가 던진다. 그 던짐이
   * 파일규칙읽기 의 catch 까지 올라가 **파일 전체 규칙**이 빈 목록이 됐다 — 한 줄 오타로
   * build/ · *.log 까지 사라져 Glob·Grep 이 빌드 산출물을 다시 훑었고, 왜 그런지 아무
   * 말도 없었다.
   *
   * git 은 거꾸로 된 범위를 「아무것도 안 맞는 무늬」 로 읽는다. 그러니 이 줄을 규칙
   * 없음(null)으로 치는 것이 git 과 같은 결과다. 나머지 줄은 그대로 산다.
   */
  let re;
  try { re = new RegExp(src, process.platform === 'win32' ? 'i' : ''); } catch { return null; }
  return { re, 부정, 폴더만, 기준: String(기준 ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''), 원문: 줄 };
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
      /*
       * ── 글자 묶음은 git 과 같게 (6회차 Gemini 무시규칙6 · 진짜 git 과 견줌) ──────────
       *
       * · 묶음은 **슬래시를 안 맞힌다.** JS 묶음을 그대로 써서 `a[!b]c` 가 `a/c` 를, `x[a/]y` 가
       *   `x/y` 를 걸었다 — git 은 두는 파일을 deel 만 감췄다. 그래서 앞에 `(?!/)` 를 둔다.
       * · 묶음 첫 글자(`!` 뒤 포함)의 `]` 는 닫는 괄호가 아니라 글자다 — `[]a]` 는 `]` 또는 `a`.
       *   첫 `]` 에서 닫아 둘 다 놓쳤다.
       */
      let j = i + 1;
      const 부정묶음 = p[j] === '!' || p[j] === '^';
      if (부정묶음) j += 1;
      const end = p.indexOf(']', p[j] === ']' ? j + 1 : j);
      if (end > j) {
        const 안 = p.slice(j, end).replace(/\\/g, '\\\\').replace(/]/g, '\\]');
        re += `(?!/)[${부정묶음 ? '^' : ''}${안}]`;
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
 * @param 건너뜀 `{ 폴더, 파일, 못연폴더, 못연파일 }` — 앞의 둘은 .gitignore 로 뺀 수,
 *               뒤의 둘은 열려다 실패한 수 (fsutil.js 의 walk 가 센다)
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
   * 못 연 것은 **건너뛴 것과 다르게** 말한다.
   *
   * .gitignore 로 뺀 것은 우리가 알고 뺀 것이라 "경로를 직접 주면 읽힌다" 가
   * 맞는 말이다. 못 연 것은 그렇지 않다 — 경로를 줘도 안 열린다. 막은 것을
   * 풀거나(권한), 켜거나(OneDrive), 고쳐야(끊긴 정션) 열린다.
   *
   * 이 줄이 없던 동안 화면에 뜬 것은 `일치 없음` 넉 자뿐이었다. 안 본 자리가
   * 통째로 있는데도 다 찾아본 것과 글자 하나 다르지 않았다.
   */
  const 못연폴더 = 건너뜀?.못연폴더 ?? 0;
  const 못연파일 = 건너뜀?.못연파일 ?? 0;
  if (못연폴더 || 못연파일) {
    const 몫 = [못연폴더 ? `폴더 ${못연폴더}개` : null, 못연파일 ? `파일 ${못연파일}개` : null].filter(Boolean).join(' · ');
    /*
     * 「못 열었다」 고만 적던 때, 멀쩡한 심볼릭 링크·정션에도 그 말이 붙었다.
     * 훑는 쪽(fsutil.js 의 walk)은 **일부러** 링크를 안 따라 들어가고 그것을 안 본
     * 것으로 센다 — 바깥을 가리키는 링크 하나가 범위를 통째로 넓히고, 제 안을
     * 가리키면 끝없이 돌기 때문이다. 그건 실패가 아니라 정책인데, 이 줄이 그것을
     * 실패로 적어서 사람은 있지도 않은 권한 문제를 찾아 헤맸다. 모노레포의
     * `packages/*` 링크 하나면 Grep·Glob·Outline 꼬리에 매번 붙는다.
     */
    줄.push(`(${몫}는 안을 한 번도 안 봤습니다 — 심볼릭 링크·정션은 따라 들어가지 않고, 권한·잠금·끊긴 링크일 수도 있습니다. 「없다」 가 아닙니다)`);
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
