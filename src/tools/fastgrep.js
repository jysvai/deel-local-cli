// 이미 깔려 있는 빠른 찾기 도구를 빌려 쓴다.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────
//
// `Grep` 은 자바스크립트로 파일을 하나씩 열어 읽는다. 의존성 0개라는 약속을
// 지키려면 그래야 했다. 그런데 파일이 5만 개쯤 되는 저장소에서는 한 번 찾는
// 데 수십 초가 간다. 그동안 화면은 멈춰 있고 사람은 기다린다.
//
// 그런데 개발자 PC 에는 `rg`(ripgrep)가 이미 깔려 있는 경우가 많다. VS Code
// 가 같이 깔고, git 이 있으면 `git grep` 도 있다. **깔지는 않고, 있으면 쓴다.**
// 이건 의존성이 아니다 — 없으면 예전 길로 가고 결과는 같다.
//
// ── 무엇을 조심하나 ────────────────────────────────────────────────────
//
//   1) **어느 엔진으로 찾았는지 말한다.** rg 와 자바스크립트 정규식은 문법이
//      조금 다르다(rg 는 Rust regex — 되돌아보기가 없다). 결과가 다르게 나왔을
//      때 무엇으로 찾은 것인지 모르면 사람은 코드를 의심한다.
//
//   2) **범위 밖으로 못 나간다.** 찾을 자리는 언제나 scope 가 준 절대경로
//      하나뿐이고, 무늬는 인자로만 넘긴다. 셸을 안 거치므로 무늬 안의
//      따옴표·세미콜론이 명령이 되지 못한다.
//
//   3) **못 찾으면 조용히 예전 길로.** 엔진이 죽거나 낯선 문법에 화를 내면
//      결과가 없는 것이 아니라 우리가 못 물어본 것이다. 그때 '일치 없음' 을
//      돌려주면 사람은 없는 줄 안다. 그래서 실패는 실패로 두고 JS 로 다시 찾는다.
import { spawnSync } from 'node:child_process';
import { 돌려보기 } from './spawn.js';
import { join } from 'node:path';

/*
 * 정규식으로 찾을 것이 없는 파일들.
 *
 * **여기가 한 벌뿐인 원본이다.** Grep 의 자바스크립트 길은 이 목록으로 정규식을
 * 만들고, rg 는 이 목록으로 `--iglob !*.png` 를 만든다. 두 군데에 따로 적어 두면
 * 언젠가 한쪽만 고쳐지고, 그때부터 같은 명령이 PC 마다 다른 답을 낸다 —
 * rg 가 깔린 사람만 8MB 번들 속 글자를 찾게 되는 식으로. 그건 오류도 안 나고
 * 아무도 눈치 못 챈다.
 */
export const 안볼확장자 = [
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svgz', 'pdf',
  'zip', 'gz', 'tgz', '7z', 'rar',
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat',
  'db', 'sqlite', 'sqlite3',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv',
  'class', 'jar', 'pyc', 'pyo', 'o', 'a', 'lib', 'pack', 'idx',
  'map', 'min.js', 'min.css', 'lock',
];

/** 위 목록으로 만든 정규식. 자바스크립트 길이 쓴다. */
export const 안볼정규식 = new RegExp(`\\.(${안볼확장자.map((x) => x.replace(/\./g, '\\.')).join('|')})$`, 'i');

/** 위 목록으로 만든 rg 옵션. 대소문자를 안 가린다(정규식의 `i` 와 맞춘다). */
export function 안볼글로브() {
  return 안볼확장자.flatMap((x) => ['--iglob', `!*.${x}`]);
}

/*
 * 있는지 한 번만 본다.
 *
 * 매번 `rg --version` 을 돌리면 찾기 한 번에 프로세스가 하나 더 뜬다.
 * 없는 PC 에서는 그 실패가 매번 수십 ms 씩 쌓인다.
 */
let 본것 = null;

function 있나(이름, 인자) {
  const r = spawnSync(이름, 인자, { encoding: 'utf8', timeout: 4000, windowsHide: true });
  return !r.error && r.status === 0;
}

export function 엔진찾기({ 다시 = false, env = process.env } = {}) {
  if (본것 && !다시) return 본것;
  // 끄고 싶을 때가 있다 — 결과가 다르다고 의심될 때 같은 자리에서 견주려면.
  if (env.DEEL_GREP === 'js') { 본것 = { rg: false, gitgrep: false, 왜: 'DEEL_GREP=js 로 꺼 두었습니다' }; return 본것; }
  본것 = {
    rg: 있나('rg', ['--version']),
    gitgrep: 있나('git', ['--version']),
    왜: null,
  };
  return 본것;
}

/** 검사가 원래대로 돌려놓을 때. */
export function 엔진잊기() { 본것 = null; return null; }

/** 이 폴더가 git 저장소 안인가. `git grep` 은 저장소 안에서만 돈다. */
export function 저장소인가(폴더) {
  const r = spawnSync('git', ['-C', 폴더, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8', timeout: 4000, windowsHide: true,
  });
  return !r.error && r.status === 0 && /true/.test(r.stdout ?? '');
}

/*
 * rg 로 찾는다.
 *
 * 돌려주는 것은 **줄 목록**이다. 세는 일과 자르는 일은 부르는 쪽이 한다 —
 * 그래야 JS 로 찾았을 때와 결과 모양이 같아진다. 모양이 갈리면 '엔진에 따라
 * 화면이 다른' 프로그램이 되는데, 그건 이 도구가 피하려는 것이다.
 *
 * @returns {{ok:true, 줄들:string[], 잘림:boolean} | {ok:false, 왜:string}}
 */
export async function rg로찾기({ 무늬, 자리, glob = null, 대소문자무시 = false, 무시파일 = null, 최대 = 5000, timeout = 20000, signal = null }) {
  const 인자 = [
    '--line-number',
    '--no-heading',
    '--with-filename',
    '--color', 'never',
    // 아주 큰 파일은 안 본다(JS 길과 같은 규칙). 글이 아닌 파일은 rg 가 기본으로 건너뛴다.
    '--max-filesize', '2M',
    /*
     * git 저장소가 아니어도 .gitignore 를 지킨다.
     *
     * rg 는 기본으로 **저장소 안에서만** .gitignore 를 본다. 저장소 밖에서는
     * 그 파일을 글자로만 여기고 out/ · secret.txt 를 그냥 뒤진다. 우리 JS 길은
     * 저장소든 아니든 지키므로, 이 한 줄이 없으면 같은 폴더에서 엔진에 따라
     * 답이 갈린다 — 그것도 **비밀을 더 보는 쪽으로**.
     */
    '--no-require-git',
  ];
  if (대소문자무시) 인자.push('--ignore-case');
  if (glob) 인자.push('--glob', glob);
  // 자바스크립트 길이 안 여는 파일은 rg 도 안 열게 한다. 같은 목록에서 나온다.
  인자.push(...안볼글로브());
  /*
   * .deelignore 도 지켜야 한다.
   *
   * rg 는 .gitignore 는 알지만 .deelignore 는 모른다. 그대로 두면 "git 에는
   * 안 적고 deel 만 건너뛸 것" 이 rg 가 깔린 PC 에서만 조용히 검색된다.
   * 같은 명령이 PC 마다 다른 답을 내는 셈이라, 이건 빠른 것보다 나쁘다.
   */
  if (무시파일) 인자.push('--ignore-file', 무시파일);
  // `--` 뒤로 넘겨서 무늬가 옵션으로 안 읽히게 한다. `-foo` 같은 무늬가 실제로 있다.
  인자.push('--regexp', 무늬, '--', 자리);

  const r = await 돌려보기('rg', 인자, { timeout, signal });
  // rg 는 못 찾으면 1, 진짜 탈이 나면 2 를 준다. 1 은 성공(빈 결과)이다.
  if (r.error) return { ok: false, 왜: r.error.message };
  if (r.status === 2) return { ok: false, 왜: (r.stderr ?? '').split('\n')[0] || 'rg 가 무늬를 못 읽었습니다' };
  const 줄들 = String(r.stdout ?? '').split('\n').filter(Boolean);
  return { ok: true, 줄들: 줄들.slice(0, 최대), 잘림: 줄들.length > 최대 };
}

/** `git grep` 으로 찾는다. rg 가 없고 여기가 저장소일 때. */
export async function git로찾기({ 무늬, 자리, 대소문자무시 = false, 최대 = 5000, timeout = 20000, signal = null }) {
  const 인자 = ['-C', 자리, '--no-pager', 'grep', '--line-number', '--no-color', '-I', '-E'];
  if (대소문자무시) 인자.push('-i');
  // 여기도 같은 목록으로 뺀다. git 은 경로무늬 앞머리에 마법을 붙여 빼낸다.
  인자.push('-e', 무늬, '--', '.', ...안볼확장자.map((x) => `:(exclude,icase)*.${x}`));
  const r = await 돌려보기('git', 인자, { timeout, signal });
  if (r.error) return { ok: false, 왜: r.error.message };
  if (r.status !== 0 && r.status !== 1) {
    return { ok: false, 왜: (r.stderr ?? '').split('\n')[0] || 'git grep 이 무늬를 못 읽었습니다' };
  }
  const 줄들 = String(r.stdout ?? '').split('\n').filter(Boolean);
  // git grep 은 저장소 기준 상대경로를 준다. 절대경로로 맞춰 준다 — 아래에서 한 모양으로 쓴다.
  const 고친것 = 줄들.map((l) => {
    const i = l.indexOf(':');
    if (i < 0) return l;
    return join(자리, l.slice(0, i)) + l.slice(i);
  });
  return { ok: true, 줄들: 고친것.slice(0, 최대), 잘림: 고친것.length > 최대 };
}

/*
 * `경로:줄번호:내용` 한 줄을 가른다.
 *
 * 윈도우 경로에는 `C:` 가 있어서 **첫 번째 콜론으로 자르면 안 된다.**
 * `C:\a\b.js:12:const x = 1;` 을 첫 콜론에서 자르면 파일 이름이 `C` 가 된다.
 *
 * 그 일은 아래 정규식이 이미 막는다. `(.*?)` 는 게으른 짝짓기라 짧은 쪽부터
 * 보지만, 그 뒤에 **`:숫자:` 가 반드시 와야 한다.** `C` 다음은 `:\Users…`
 * 라 숫자가 아니므로 그 자리는 버려지고, 진짜 줄 번호 앞 콜론까지 늘어난다.
 *
 * 전에는 여기에 "첫 조각이 한 글자면 다시 본다" 는 갈래가 하나 더 있었다.
 * 지우고 검사를 돌려도 아무것도 안 빨개졌다 — 닿지 않는 길이었다는 뜻이다.
 * 막고 있는 척만 하는 코드는 없느니만 못해서 지웠다. 대신 윈도우 경로를
 * 재는 검사를 test/fastgrep.test.js 에 남겨 둔다.
 */
export function 줄가르기(줄) {
  const m = /^(.*?):(\d+):([\s\S]*)$/.exec(줄);
  if (!m) return null;
  return { 파일: m[1], 줄: Number(m[2]), 내용: m[3] };
}

/**
 * 빠른 엔진으로 찾아 본다. 못 쓰면 null — 부르는 쪽이 예전 길로 간다.
 *
 * @returns {{엔진:string, 줄들:Array<{파일,줄,내용}>, 잘림:boolean} | null}
 */
export async function 빠르게찾기({ 무늬, 자리, glob = null, 대소문자무시 = false, 무시파일 = null, 최대 = 5000, signal = null }) {
  const 것 = 엔진찾기();
  if (것.rg) {
    const r = await rg로찾기({ 무늬, 자리, glob, 대소문자무시, 무시파일, 최대, signal });
    if (r.ok) return { 엔진: 'rg', 줄들: r.줄들.map(줄가르기).filter(Boolean), 잘림: r.잘림 };
    // rg 가 무늬를 못 읽은 것일 수 있다(Rust regex 에는 되돌아보기가 없다).
    // 그건 '없다' 가 아니라 '못 물어봤다' 이므로 예전 길로 내려간다.
    return null;
  }
  // git grep 은 .deelignore 를 시킬 방법이 없다. 그 파일이 있으면 예전 길로 간다 —
  // 사람이 "deel 은 여기 보지 마라" 고 적어 둔 것을 못 지키면 빠른 것이 뜻이 없다.
  if (것.gitgrep && !무시파일 && 저장소인가(자리)) {
    const r = await git로찾기({ 무늬, 자리, 대소문자무시, 최대, signal });
    if (r.ok) return { 엔진: 'git grep', 줄들: r.줄들.map(줄가르기).filter(Boolean), 잘림: r.잘림 };
    return null;
  }
  return null;
}

/** 화면·결과 꼬리에 적을 한마디. 무엇으로 찾았는지 사람이 알아야 한다. */
export function 엔진말(이름) {
  if (!이름) return '';
  return `(${이름} 으로 찾았습니다 — 이 PC 에 이미 있어서 빌려 썼습니다)`;
}
