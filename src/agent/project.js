/*
 * 이 폴더가 무슨 프로젝트인가 — 켤 때 한 번 읽어 프롬프트에 넣는다.
 *
 * 왜 필요한가:
 *   남의 코드가 있는 폴더에서 켜면 모델은 아무것도 모르는 채로 시작했다.
 *   그래서 매번 같은 세 걸음을 다시 밟는다 — Glob 으로 위쪽을 훑고,
 *   package.json 을 읽고, 검사를 어떻게 돌리는지 찾는다. 로컬 모델은 한 걸음이
 *   20~40초라 **일을 시작하기도 전에 2분**이 간다. 그 세 걸음의 답은 켤 때
 *   이미 다 알 수 있는 것이다.
 *
 *   더 나쁜 쪽도 있다. 모델이 그 세 걸음을 **안 밟고** 그냥 시작하는 경우다.
 *   그러면 이 프로젝트가 이미 쓰는 것을 모른 채 제 관례로 파일을 만든다 —
 *   npm 프로젝트에 requirements.txt 를 만들어 놓는 식이다.
 *
 * 무엇을 넣나 (값이 큰 순서):
 *   1. 돌릴 수 있는 명령 — npm scripts 가 곧 '이 프로젝트에서 되는 일' 이다
 *   2. 위쪽 생김새 — Glob 한 번을 아낀다
 *   3. 무슨 갈래인가 — node·python·go·rust·java·c#
 *   4. 지금 git 가지 — 어디에 커밋하게 되는지
 *
 * 무엇을 안 하나:
 *   git 을 **띄우지 않는다.** .git/HEAD 를 그냥 읽는다. 켤 때 자식 프로세스를
 *   부르면 큰 저장소에서 몇 초가 걸리고, 그 몇 초는 화면이 멈춘 채로 간다.
 *   안 올린 변경 개수 같은 것은 모델이 필요하면 제 손으로 git 을 부르면 된다.
 *
 *   폴더를 훑지도 않는다. 위쪽 한 겹만 읽는다. 하위까지 내려가면 큰 저장소에서
 *   느려지고, 어차피 프롬프트에 넣을 양은 한 줄뿐이다.
 *
 * 이 글도 **고정 몫**이다 — 매 요청에 통째로 나간다. 그래서 창 크기에 맞춘다.
 *
 * 줄이는 자는 **줄 수가 아니라 줄 길이**다 (2.0.0 8회차 판정에서 바로잡음). 여기는
 * 「8k 에서는 두 줄, 큰 창에서는 네 줄」 이라 적어 뒀는데 어느 창에서나 네 줄이
 * 나갔다 — 창에 따라 달라지는 것은 위쪽 몇 개(10·16·24)와 명령 몇 개(4·6·8)다.
 * 줄을 빼지 않는 데는 까닭이 있다: 위쪽 목록을 통째로 빼면 「그 밖에 N개」 라는
 * 말도 같이 사라져, 모델은 적힌 것이 이 폴더의 전부인 줄 안다.
 * 늘리면 test/compact.test.js 가 먼저 빨개진다.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { 언어 } from '../i18n/index.js';

// 위쪽에 있어도 사람에게 아무 말도 안 해 주는 것들. 적어 봐야 자리만 먹는다.
const 안적을것 = new Set([
  'node_modules', '.git', '.deel', '.claude', '.vscode', '.idea', '__pycache__',
  '.venv', 'venv', 'dist', 'build', 'target', 'out', '.next', '.cache', '.pytest_cache',
  'coverage', '.DS_Store', 'Thumbs.db',
]);

/*
 * ── 여기 옮기는 글자는 **남이 적은 것**이다 (2.0.0 4회차 사냥) ─────────────
 *
 * package.json 의 이름·스크립트 이름, 위쪽 파일 이름, .git/HEAD 의 가지 — 전부
 * 저장소를 만든 사람이 정한다. 그걸 그대로 옮기고 있었다. 이름에 줄바꿈 하나를
 * 넣으면 시스템 글 한가운데 `--- 사용자 규칙 (위 원칙보다 우선) ---` 같은 머리줄을
 * 제 손으로 세울 수 있었고, 5만 자짜리 이름은 이 파일 머리말이 「고정 몫」 이라고
 * 아껴 둔 자리를 통째로 먹었다.
 *
 * 그래서 두 가지를 못 박는다.
 *   · **한 줄**이다 — 제어 글자(줄바꿈·CR·탭·줄 나눔 U+2028/2029)가 든 것은 안 싣는다.
 *     바꿔 적지 않고 뺀다. 바꿔 적은 스크립트 이름은 이 폴더에 없는 명령이 되고,
 *     없는 명령을 알려 주면 모델이 그걸 부른다(명령들 머리말).
 *   · **길이 상한**이 있다 — 넘으면 이름은 잘라 표시를 붙이고, 명령·파일 이름은 뺀다.
 */
const 제어글자 = /[\u0000-\u001f\u007f\u2028\u2029]/;
const 한줄인가 = (s, 최대) => typeof s === 'string' && s.length > 0 && s.length <= 최대 && !제어글자.test(s);
const 이름최대 = 80;
const 명령이름최대 = 60;
const 가지최대 = 120;

/** 떨어져 나온 머리(detached HEAD). 135-136 주석이 적은 말과 같은 글이어야 한다. */
export const 떨어진머리 = '가지 없음 (detached)';

/*
 * 확장자로만 갈래가 정해지는 것들 (2.0.0 8회차 판정).
 *
 * 머리말은 갈래에 c# 을 적어 뒀는데 아래 표식에는 없었다 — .NET 은 이름이 고정된
 * 파일이 없고 `<이름>.csproj` · `<이름>.sln` 처럼 이름이 프로젝트마다 다르다.
 * 그래서 파일 이름 대조로는 영영 안 걸렸고, C# 폴더에서 켜면 갈래가 null 이었다.
 * 위쪽 한 겹은 어차피 읽으므로(위쪽) 확장자만 한 번 더 본다.
 */
const 확장자표식 = [
  { 확장자: '.csproj', 갈래: 'c#' },
  { 확장자: '.sln', 갈래: 'c#' },
  { 확장자: '.fsproj', 갈래: 'f#' },
];

// 파일 하나로 갈래가 정해지는 것들. 위에 있는 것이 먼저 이긴다.
const 표식 = [
  { 파일: 'package.json', 갈래: 'node' },
  { 파일: 'pyproject.toml', 갈래: 'python' },
  { 파일: 'requirements.txt', 갈래: 'python' },
  { 파일: 'go.mod', 갈래: 'go' },
  { 파일: 'Cargo.toml', 갈래: 'rust' },
  { 파일: 'pom.xml', 갈래: 'java (maven)' },
  { 파일: 'build.gradle', 갈래: 'java (gradle)' },
  { 파일: 'build.gradle.kts', 갈래: 'kotlin (gradle)' },
  { 파일: 'Gemfile', 갈래: 'ruby' },
  { 파일: 'composer.json', 갈래: 'php' },
  { 파일: 'CMakeLists.txt', 갈래: 'c/c++ (cmake)' },
];

/** 위쪽 한 겹. 폴더는 뒤에 / 를 붙여 파일과 구별한다. */
function 위쪽(root, 상한) {
  let 것들;
  try { 것들 = readdirSync(root); } catch { return { 목록: [], 더: 0 }; }
  const 폴더 = [];
  const 파일 = [];
  for (const n of 것들) {
    if (안적을것.has(n) || n.startsWith('.')) continue;
    if (!한줄인가(n, 명령이름최대)) continue;       // 리눅스에서는 파일 이름에도 줄바꿈이 들어간다
    try { (statSync(join(root, n)).isDirectory() ? 폴더 : 파일).push(n); }
    catch { /* 읽는 중에 사라졌으면 없는 셈 */ }
  }
  // 폴더가 먼저다. 구조를 먼저 보여 주는 편이 훑을 때 빠르다.
  const 다 = [...폴더.sort().map((n) => `${n}/`), ...파일.sort()];
  return { 목록: 다.slice(0, 상한), 더: Math.max(0, 다.length - 상한) };
}

/**
 * 돌릴 수 있는 명령.
 *
 * 이름을 지어내지 않는다 — 적힌 것만 그대로 옮긴다. 없는 명령을 알려 주면
 * 모델이 그걸 부르고, 실패하고, 다시 찾느라 걸음을 더 쓴다.
 */
function 명령들(root, 갈래, 상한) {
  if (갈래 !== 'node') return [];
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const s = pkg?.scripts;
    if (!s || typeof s !== 'object') return [];
    // 사람이 실제로 부르는 것부터. 나머지는 알파벳순으로 채운다.
    const 앞선것 = ['dev', 'start', 'test', 'build', 'lint', 'typecheck'];
    const 있는것 = Object.keys(s).filter((n) => 한줄인가(n, 명령이름최대));
    const 골라 = [
      ...앞선것.filter((n) => 있는것.includes(n)),
      ...있는것.filter((n) => !앞선것.includes(n)).sort(),
    ];
    return 골라.slice(0, 상한).map((n) => (n === 'test' || n === 'start' ? `npm ${n}` : `npm run ${n}`));
  } catch { return []; }
}

/** package.json 의 이름. 폴더 이름과 다를 때가 많아 따로 본다. */
function 이름(root, 갈래) {
  if (갈래 !== 'node') return null;
  try {
    const n = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))?.name;
    if (typeof n !== 'string' || !n.trim()) return null;
    // 이름은 알려 주는 값이지 부르는 값이 아니라서 빼지 않고 한 줄로 펴서 자른다.
    const 편것 = n.replace(new RegExp(제어글자.source, 'g'), ' ').replace(/\s+/g, ' ').trim();
    if (!편것) return null;
    return 편것.length > 이름최대 ? `${편것.slice(0, 이름최대)}…` : 편것;
  } catch { return null; }
}

/**
 * 지금 git 가지.
 *
 * git 을 안 띄우고 .git/HEAD 를 읽는다. 떨어져 나온 머리(detached HEAD)면
 * 가지 이름 대신 커밋 앞자리가 들어 있는데, 그때는 '가지 없음' 이라고 말한다 —
 * 커밋 해시를 가지 이름처럼 적으면 모델이 그 이름으로 checkout 을 시도한다.
 */
export function git가지(root) {
  try {
    const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    // 가지 이름도 저장소에 딸려 온 파일에서 온다. 한 줄이 아니거나 너무 길면 가지를 모르는 셈 친다.
    if (m) return 한줄인가(m[1], 가지최대) ? m[1] : null;
    return head ? 떨어진머리 : null;
  } catch { return null; }
}

/** 위쪽 한 겹에서 확장자만 보고 갈래를 집는다. 못 찾으면 null. */
function 확장자로갈래(root) {
  let 것들;
  try { 것들 = readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const t of 확장자표식) {
    if (것들.some((d) => d.isFile() && d.name.toLowerCase().endsWith(t.확장자))) return t.갈래;
  }
  return null;
}

/**
 * 이 폴더의 지문.
 *
 * @param 창 모델 컨텍스트 길이. 여기에 맞춰 몇 줄까지 적을지 정한다.
 * @returns {string|null} 프롬프트에 넣을 토막. 적을 것이 없으면 null.
 */
export function 지문(root, 창 = null) {
  // 좁을수록 적게. 이건 접히지 않는 고정 몫이라, 창의 몇 %를 쓸지가 곧 손해다.
  const n = Number(창) || 0;
  const 넉넉한가 = n >= 32000;
  const 아주좁은가 = n > 0 && n < 12000;
  const 위쪽상한 = 아주좁은가 ? 10 : 넉넉한가 ? 24 : 16;
  const 명령상한 = 아주좁은가 ? 4 : 넉넉한가 ? 8 : 6;

  let 갈래 = null;
  for (const t of 표식) {
    if (existsSync(join(root, t.파일))) { 갈래 = t.갈래; break; }
  }
  // 이름이 고정된 파일이 없는 갈래(.NET)는 확장자로 본다 — 위 확장자표식 머리말.
  if (!갈래) 갈래 = 확장자로갈래(root);

  const 줄들 = [];
  const 이 = 이름(root, 갈래);
  const 가지 = git가지(root);

  // 이 토막은 모델이 읽는 글이라 화면 말을 따라간다 — 머리줄도 마찬가지다.
  // 여태 여기만 한국어가 박혀 있어서 영어 화면에도 「node 프로젝트」 가 나갔다 (8회차 판정).
  const 영 = 언어() === 'en';
  const 가지말 = 가지 === 떨어진머리 && 영 ? 'no branch (detached)' : 가지;
  const 머리 = [
    갈래 ? (영 ? `${갈래} project${이 ? ` (${이})` : ''}` : `${갈래} 프로젝트${이 ? ` (${이})` : ''}`) : null,
    가지 ? `git ${가지말}` : null,
  ].filter(Boolean).join(' · ');
  if (머리) 줄들.push(머리);

  const 명 = 명령들(root, 갈래, 명령상한);
  // 명령은 제일 값이 크다. 좁은 창에서 무엇 하나를 남긴다면 이것이다 —
  // '이 프로젝트에서 검사를 어떻게 돌리나' 가 여기 다 들어 있다.
  // 이 토막도 모델이 읽는 글이라 화면 말을 따라간다. 값(명령 이름·파일 이름)은
  // 그대로 둔다 — 그건 이 폴더에 실제로 있는 것이라 옮길 것이 아니다.
  if (명.length) 줄들.push(`${영 ? 'Runnable here' : '돌릴 수 있는 것'}: ${명.join(' · ')}`);

  const w = 위쪽(root, 위쪽상한);
  if (w.목록.length) {
    줄들.push(`${영 ? 'Top level' : '위쪽'}: ${w.목록.join(' ')}${w.더 ? ` (${영 ? `${w.더} more` : `그 밖에 ${w.더}개`})` : ''}`);
  }

  if (!줄들.length) return null;
  /*
   * 마지막 한 줄이 중요하다.
   *
   * 이 토막만 보고 "다 알았다" 고 넘어가면 안 된다. 여기 적힌 것은 위쪽 한 겹과
   * package.json 뿐이고, 하위 폴더 안은 아무것도 안 봤다. 그 사실을 안 적으면
   * 모델은 이걸 프로젝트 전체 지도로 여기고 Outline 을 안 부른다 —
   * 그러면 이 토막이 오히려 손해가 된다.
   */
  줄들.push(영
    ? 'This is the top level only. Call Outline when you need to know what is inside.'
    : '위쪽 한 겹만 본 것이다. 안을 알아야 하면 Outline 을 불러라.');
  return `\n--- ${영 ? 'this folder' : '이 폴더'} ---\n${줄들.join('\n')}`;
}
