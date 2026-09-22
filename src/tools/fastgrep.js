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
import { statSync } from 'node:fs';
import { 돌려보기 } from './spawn.js';
import { SKIP_DIRS, glob거르개 } from './fsutil.js';
import { join, relative, sep, isAbsolute } from 'node:path';

// 이보다 큰 파일은 안 본다 — 자바스크립트 길(GREP_MAX_FILE)과 rg(--max-filesize 2M)와 같은 값.
const 큰파일 = 2 * 1024 * 1024;

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

/**
 * 위 목록으로 만든 정규식. 자바스크립트 길이 쓴다.
 *
 * 점만 벗기고 있었다. 지금 목록에는 점 말고 특수한 글자가 없어서 탈이 안 났지만,
 * `c++` 같은 갈래 이름을 한 줄 더하는 날 그 줄이 조용히 **다른 무늬**가 된다.
 * 목록은 사람이 늘리는 자리니 벗기는 쪽을 온전하게 둔다.
 */
const 정규식글자벗기기 = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const 안볼정규식 = new RegExp(`\\.(${안볼확장자.map(정규식글자벗기기).join('|')})$`, 'i');

/** 위 목록으로 만든 rg 옵션. 대소문자를 안 가린다(정규식의 `i` 와 맞춘다). */
export function 안볼글로브() {
  return 안볼확장자.flatMap((x) => ['--iglob', `!*.${x}`]);
}

/*
 * ── 두 길이 **같은 자리를 본다** ───────────────────────────────────────
 *
 * 안 볼 확장자는 한 벌로 맞춰 놨는데, 정작 **어느 폴더·어느 파일을 도느냐**
 * 는 두 길이 따로 정하고 있었다.
 *
 *   rg  : 점으로 시작하는 것을 기본으로 안 본다. 대신 dist·build·venv 는 돈다.
 *   walk: 점 규칙이 아예 없다(다 본다). 대신 SKIP_DIRS 를 안 돈다.
 *
 * 그래서 같은 폴더에서 같은 무늬로 찾았는데 —
 *
 *   rg 가 있는 PC  →  dist/bundle.js · build/out.js · venv/lib.js
 *   rg 가 없는 PC  →  .github/workflows/ci.yml · .env.example · .eslintrc.json
 *
 * 겹치는 답이 src/a.js 하나뿐이었다(실제로 재 봤다). 「CI 설정 어디서 고쳐」
 * 를 rg 가 깔린 PC 에서 물으면 한 줄도 안 나오고, 모델은 그 침묵을 사실로
 * 받아 「이 저장소에는 워크플로가 없습니다」 로 답을 맺는다. 오류도 안 나고
 * 꼬리말도 안 붙으니 사람은 PC 차이라는 것을 영영 모른다.
 *
 * 이 파일 머리말이 목록을 한 벌만 두자고 적어 둔 까닭이 그것이다. 이제
 * 점 파일은 rg 도 보고(`--hidden`), 안 볼 폴더는 walk 가 쓰는 그 목록을
 * 그대로 옮겨 적는다. `.git` 도 그 목록에 있어서 같이 빠진다 — 점 파일을
 * 보기 시작하면 제일 먼저 걸리는 것이 저장소 살림이다.
 */
export function 안볼폴더글로브() {
  return [...SKIP_DIRS].flatMap((d) => ['--iglob', `!${d}/`]);
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
  // rg 가 깔린 PC 에서 git grep 길을 재 보려면 rg 만 끈다 — 안 그러면 그 길은 rg 없는 PC 에서만 돈다.
  if (env.DEEL_GREP === 'git') { 본것 = { rg: false, gitgrep: 있나('git', ['--version']), 왜: 'DEEL_GREP=git 로 rg 를 꺼 두었습니다' }; return 본것; }
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
export async function rg로찾기({ 무늬, 자리, 뿌리 = null, glob = null, 대소문자무시 = false, 무시파일 = null, 최대 = 5000, timeout = 20000, signal = null, 부르기 = 돌려보기 }) {
  const 인자 = [
    '--line-number',
    '--no-heading',
    '--with-filename',
    // 경로 끝을 콜론 대신 NUL 로 찍는다 — 리눅스·맥의 파일 이름에는 `:숫자:` 가 들 수 있다 (아래 줄가르기).
    '--null',
    '--color', 'never',
    /*
     * CRLF 파일의 `$` 를 줄 끝으로 본다.
     *
     * 이게 없으면 rg 는 `\n` 만 줄 끝으로 알아서 `end$` 가 `end\r\n` 에 안 맞았다.
     * 자바스크립트 길도 줄마다 `\r` 을 달고 있어서 두 길 다 윈도우 파일에서
     * 「일치 없음」 이었다. 두 길을 같이 고친다 (tools/index.js 의 한파일에서찾기).
     */
    '--crlf',
    ...rg거르는인자({ glob, 무시파일, 자리, 뿌리 }),
  ];
  if (대소문자무시) 인자.push('--ignore-case');
  // `--` 뒤로 넘겨서 무늬가 옵션으로 안 읽히게 한다. `-foo` 같은 무늬가 실제로 있다.
  const 덤 = rg작업폴더(뿌리, { glob, 무시파일 });
  const { 찾을, 되붙이기 } = rg찾을자리(뿌리, 자리, 덤);
  인자.push('--regexp', 무늬, '--', 찾을);

  const r = await 부르기('rg', 인자, { timeout, signal, 덤 });
  const 못준까닭 = rg가못준까닭(r);
  if (못준까닭) return { ok: false, 왜: 못준까닭 };
  // 경로는 첫 NUL 앞이다(--null). 그 앞만 원래 뿌리에 되붙인다.
  const 줄들 = String(r.stdout ?? '').split('\n').filter(Boolean).map((줄) => {
    const 경로끝 = 줄.indexOf('\0');
    return 경로끝 < 0 ? 줄 : 되붙이기(줄.slice(0, 경로끝)) + 줄.slice(경로끝);
  });
  return { ok: true, 줄들: 줄들.slice(0, 최대), 잘림: 줄들.length > 최대 };
}

/**
 * rg 가 **답을 준 것인가.** 아니면 왜 못 줬는지.
 *
 * rg 의 끝맺음은 셋뿐이다 — 0(찾음) · 1(못 찾음) · 2(무늬·자리가 틀림).
 * 1 은 성공(빈 결과)이고, **그 밖은 전부 「우리가 못 물어본 것」** 이다.
 *
 * ── 왜 `status === 2` 로는 모자랐나 ────────────────────────────────────
 *
 * 여기가 그 한 줄이었다. 그런데 **신호로 죽은** 자식은 status 가 숫자가
 * 아니라 `null` 이다 — spawn.js 의 'close' 가 종료 코드를 그대로 주는데,
 * 신호로 끊긴 프로세스에는 그 코드가 없다. error 도 비어 있다(우리가 죽인
 * 것이 아니니까). OOM killer 가 걷어가거나, 사람이 kill 하거나, 컨테이너가
 * 메모리 상한으로 끊는 자리가 다 그렇다.
 *
 * 그 자리에서 이 자는 `ok: true` 를 올려 보냈다. stdout 은 반 토막이거나
 * 비어 있는데 부르는 쪽은 그걸 **다 찾아본 결과**로 받는다 — 화면에는
 * 「일치 없음」. 이 파일 머리말 3번이 「결과가 없는 것이 아니라 우리가 못
 * 물어본 것」 이라고 적어 둔 바로 그 자리에서, 못 물어본 것이 없는 것으로
 * 나갔다. 실패로 두면 부르는 쪽이 자바스크립트 길로 내려가 다시 찾는다.
 *
 * @returns {string|null} 못 준 까닭. 답을 줬으면 null.
 */
export function rg가못준까닭(r) {
  if (r?.error) return r.error.message;
  if (r?.status === 0 || r?.status === 1) return null;
  const 첫줄 = String(r?.stderr ?? '').split('\n')[0];
  if (r?.status === 2) return 첫줄 || 'rg 가 무늬를 못 읽었습니다';
  if (r?.status == null) return 첫줄 || 'rg 가 끝맺지 못하고 죽었습니다 (신호로 끊겼습니다)';
  return 첫줄 || `rg 가 ${r.status} 로 끝났습니다`;
}

/*
 * ── rg 가 **글자로 못 푸는** 파일 ─────────────────────────────────────────
 *
 * rg 는 UTF-8 과 표식 있는 UTF-16 만 글자로 푼다. 그 밖은 바이트 그대로 보거나
 * (CP949 · Shift_JIS · 표식 없는 UTF-16) NUL 을 만나는 순간 그 파일을 버린다.
 * 자바스크립트 길은 그 셋을 다 읽는다(encoding.js 가 알아보고 풀고, 바이너리
 * 판정은 앞 8,000바이트만 본다). 그래서 같은 폴더에서 「결재」 를 찾으면 —
 *
 *   rg 가 있는 PC  →  src/a.js
 *   rg 가 없는 PC  →  src/a.js · 사내문서.txt(CP949) · out.txt(UTF-16) · 로그.txt
 *
 * 이 파일 머리말이 「같은 명령이 PC 마다 다른 답을 내면 빠른 게 아니다」 라고
 * 세 번 적어 둔 바로 그 고장이, 하필 사내 문서에서 났다.
 *
 * rg 에 그 인코딩을 가르칠 수는 없다(내용을 보고 고르는 것은 우리 쪽 일이다).
 * 대신 **어느 파일이 그런지**는 rg 가 빨리 안다 — NUL 이나 UTF-8 에 없는
 * 바이트열이 하나라도 든 파일을 한 번 더 훑어 이름만 받는다. 그 파일들은 rg 의
 * 답을 버리고 자바스크립트 길과 **똑같은 방법으로** 다시 읽는다(Grep 도구가 한다).
 *
 * 무늬는 바이트로 본다(`(?-u)`). 한 줄 안에서 이런 것이 보이면 UTF-8 이 아니다:
 *   NUL · UTF-8 에 절대 안 나오는 바이트 · 앞 바이트 없는 이음 바이트 ·
 *   이음이 모자란 앞 바이트 · 이음이 남는 글자 · 너무 길게 쓴 것과 서로게이트.
 * 표식 있는 UTF-16 은 rg 가 먼저 UTF-8 로 풀어서 여기 안 걸린다 — 맞다, rg 가
 * 그건 제대로 찾는다.
 */
const 이음 = '[\\x80-\\xBF]';
const 이음아님 = '(?:[^\\x80-\\xBF]|$)';
const 못푸는바이트무늬 = '(?-u:'
  + [
    '\\x00',
    '[\\xC0\\xC1\\xF5-\\xFF]',
    `(?:^|[\\x00-\\x7F])${이음}`,
    `[\\xC2-\\xDF]${이음아님}`,
    `[\\xE0-\\xEF](?:${이음아님}|${이음}${이음아님})`,
    `[\\xF0-\\xF4](?:${이음아님}|${이음}${이음아님}|${이음}${이음}${이음아님})`,
    `[\\xC2-\\xDF]${이음}{2}`,
    `[\\xE0-\\xEF]${이음}{3}`,
    `[\\xF0-\\xF4]${이음}{4}`,
    '\\xE0[\\x80-\\x9F]', '\\xED[\\xA0-\\xBF]', '\\xF0[\\x80-\\x8F]', '\\xF4[\\x90-\\xBF]',
  ].join('|')
  + ')';

/** rg 가 글자로 못 푸는 파일 이름들. 거르는 규칙은 rg로찾기 와 **같은 것**을 쓴다. */
/*
 * `부르기` 를 밖에서 받는 까닭은 **검사 때문**이다 (tools/clipboard.js 와 같은 규칙).
 * 신호로 죽은 rg · 2 가 아닌 종료코드는 진짜 rg 로는 만들 수가 없어서, 그 갈래가
 * 영영 안 재진다. 여기가 조용히 빈 목록을 올리면 사내 문서가 검색에서 통째로
 * 사라지는 자리라, 재지는 조각을 내놓는 것이 맞다.
 */
export async function rg못푸는파일({ 자리, 뿌리 = null, glob = null, 무시파일 = null, timeout = 20000, signal = null, 부르기 = 돌려보기 }) {
  const 인자 = [
    '--files-with-matches',
    '--color', 'never',
    // NUL 이 든 파일도 끝까지 본다. 안 그러면 rg 가 그 파일을 버려서 이름도 안 나온다.
    '--text',
    ...rg거르는인자({ glob, 무시파일, 자리, 뿌리 }),
  ];
  const 덤 = rg작업폴더(뿌리, { glob, 무시파일 });
  const { 찾을, 되붙이기 } = rg찾을자리(뿌리, 자리, 덤);
  인자.push('--regexp', 못푸는바이트무늬, '--', 찾을);
  const r = await 부르기('rg', 인자, { timeout, signal, 덤 });
  /*
   * 실패는 **rg가못준까닭 한 자로** 가른다. 여기는 `error` 와 `status === 2` 두 줄뿐이라,
   * 신호로 죽거나(`status === null`) 2 가 아닌 값으로 끝나면 **빈 목록이 `ok:true`** 로
   * 올라갔다. 그러면 빠르게찾기 가 「따로 볼 파일 없음」 으로 받아, CP949·Shift_JIS·
   * 표식 없는 UTF-16 파일을 한 개도 되읽지 않는다 — rg 가 그 파일에서 낸 답은 버려졌는데
   * 다시 읽지도 않으니 결과가 조용히 「일치 없음」 이 된다. 이 함수 머리말이 「거르는
   * 규칙은 rg로찾기 와 같은 것을 쓴다」 고 적어 두고 여기만 옛 두 줄이었다.
   */
  const 못준까닭 = rg가못준까닭(r);
  if (못준까닭) return { ok: false, 왜: 못준까닭 };
  const 파일들 = String(r.stdout ?? '').split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean).map(되붙이기);
  return { ok: true, 파일들 };
}

/**
 * 어느 파일·폴더를 보나 — rg 를 부르는 **모든** 자리가 이 한 벌을 쓴다.
 * 두 번 부르는 rg(찾기 · 못 푸는 파일 세기)가 서로 다른 파일을 보면
 * 거기서 또 답이 갈린다.
 */
/*
 * ── rg 는 glob 을 **제 작업 폴더** 기준으로 맞춘다 ──────────────────────────
 *
 * `--glob src/*.js` 와 `--ignore-file` 의 무늬는 rg 를 띄운 작업 폴더에서부터
 * 읽힌다 — 찾을 자리가 아니다. deel 은 작업 폴더를 안 정하고 띄워서, 사람이
 * 다른 폴더에서 deel 을 켰거나 검사처럼 뿌리와 다른 자리에서 돌면 빗금 든
 * glob 이 한 파일에도 안 맞았다(오류 없이 「일치 없음」). .deelignore 의
 * `src/secret.txt` 같은 줄도 같은 까닭으로 안 먹었다.
 *
 * 작업 폴더를 작업 범위의 뿌리로 정한다. .deelignore 가 사는 자리도 거기다.
 *
 * glob 도 .deelignore 도 없으면 **안 바꾼다.** 윈도우는 떠 있는 프로세스의
 * 작업 폴더를 못 지운다. 멈추라고 해서 죽인 rg 는 몇 ms 더 살아 있고, 그동안
 * 그 폴더가 잠긴다 — test/abort-tools.test.js 가 바로 그 자리에서 EPERM 으로
 * 잡았다. 작업 폴더가 뜻을 갖는 것은 위 두 무늬뿐이라 그때만 옮긴다.
 */
function rg작업폴더(뿌리, { glob = null, 무시파일 = null } = {}) {
  return 뿌리 && (glob || 무시파일) ? { cwd: 뿌리 } : {};
}

/*
 * ── 작업 폴더를 정했으면 찾을 자리도 **그 기준 상대경로로** 넘긴다 (2.0.1) ──
 *
 * rg 는 glob 을 작업 폴더 기준으로 맞춘다. 그러려면 찾을 자리가 작업 폴더
 * **밑으로 보여야** 한다 — 그 판단은 글자로 한다. 그런데 윈도우에서는 같은
 * 폴더를 두 가지로 적을 수 있다:
 *
 *   C:\Users\RUNNER~1\AppData\Local\Temp       (8.3 짧은 이름 — os.tmpdir() 가 준다)
 *   C:\Users\runneradmin\AppData\Local\Temp    (긴 이름 — 같은 폴더)
 *
 * Chocolatey·Scoop 은 rg 를 **심(shim)** 으로 깐다. 재 보니 심을 거치면 작업
 * 폴더가 긴 이름으로 바뀌어 진짜 rg 가 뜬다. 우리는 찾을 자리를 짧은 이름으로
 * 넘겼으니 rg 눈에는 그 자리가 작업 폴더 밑이 아니고, 빗금 든 glob 이 한 파일에도
 * 안 맞았다 — 오류 없이 「일치 없음」, `!` 빼기는 아무것도 안 뺐다.
 *
 * 둘 중 하나만 있어서는 안 깨진다(윈도 러너에서 갈라 봤다):
 *
 *   심 + 짧은 이름     → 5개 빨강
 *   진짜 rg.exe + 짧은 이름 → 121 통과
 *   심 + 긴 이름       → 121 통과
 *
 * 윈도우에서 rg 는 대개 choco·scoop 으로 깔고, 짧은 이름은 사용자 이름이 여덟
 * 글자를 넘거나 빈칸이 들면 %TEMP% 에 그대로 온다. 흔한 짝이다.
 *
 * 그래서 이름 적는 방식에 기대지 않는다. 찾을 자리를 **뿌리 기준 상대경로**로
 * 넘기면 rg 는 제 작업 폴더에서부터 걸어 들어가고, 작업 폴더를 어떻게 적었든
 * 상관이 없다. 나온 경로는 **원래 뿌리에 되붙여** 돌려준다 — 아래로 흐르는
 * 경로 꼴은 예전과 똑같다.
 *
 * 작업 폴더를 안 정하는 판(glob·무시파일 없음)과, 찾을 자리가 뿌리 밖인 판은
 * 예전대로 절대경로를 넘긴다.
 */
function rg찾을자리(뿌리, 자리, 덤) {
  const 그대로 = { 찾을: 자리, 되붙이기: (f) => f };
  if (!덤?.cwd || !뿌리 || !자리) return 그대로;
  const 상대 = relative(뿌리, 자리);
  if (isAbsolute(상대) || 상대 === '..' || 상대.startsWith(`..${sep}`)) return 그대로;
  return { 찾을: 상대 || '.', 되붙이기: (f) => (isAbsolute(f) ? f : join(뿌리, f)) };
}

/*
 * glob 하나를 rg 인자로. 규칙은 fsutil.js 의 glob거르개 와 **같다**.
 *
 * 작업 폴더가 뿌리이므로 빗금 든 무늬는 뿌리 기준으로 맞는다. 찾는 폴더가
 * 뿌리 아래(path=src)면 「찾는 폴더 기준」 으로도 맞아야 해서 그 앞머리를 붙인
 * 무늬를 하나 더 준다 — rg 는 여러 --glob 을 「하나라도 맞으면」 으로 읽고,
 * `!` 빼기는 「하나라도 맞으면 뺀다」 로 읽는다. 자바스크립트 쪽과 같은 뜻이다.
 * `/` 로 시작하는 무늬는 뿌리에 묶인 것이라 더 안 붙인다.
 */
export function rg글로브들(glob, { 자리 = null, 뿌리 = null } = {}) {
  if (!glob) return [];
  const 빼기 = glob.startsWith('!');
  const 몸 = 빼기 ? glob.slice(1) : glob;
  const 무늬들 = [몸];
  if (!몸.startsWith('/') && 몸.includes('/') && 뿌리 && 자리) {
    const 앞 = relative(뿌리, 자리);
    if (앞 && 앞 !== '..' && !앞.startsWith(`..${sep}`) && !isAbsolute(앞)) {
      무늬들.push(`${앞.split(sep).join('/')}/${몸}`);
    }
  }
  return 무늬들.map((x) => (빼기 ? `!${x}` : x));
}

function rg거르는인자({ glob = null, 무시파일 = null, 자리 = null, 뿌리 = null } = {}) {
  const 인자 = [
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
    /*
     * 무시 규칙의 **대소문자를 JS 길과 맞춘다.**
     *
     * tools/ignore.js 는 윈도우에서만 규칙을 대소문자 없이 본다(git 의
     * core.ignorecase 기본값과 같은 자세다). rg 는 어느 판에서든 가린다.
     * 그래서 윈도우에서 `.gitignore` 에 `*.log` 를 적어 두면 —
     *
     *   rg 가 깔린 PC   →  A.LOG 가 **검색된다**
     *   안 깔린 PC      →  A.LOG 가 안 검색된다
     *
     * 같은 명령이 PC 에 따라 다른 답을 내고, 하필 **가리라고 적은 것을 더
     * 보는 쪽**으로 갈린다. 이 파일 머리말이 없애려던 바로 그 고장이다.
     * 빠른 길이 다른 답을 내면 그건 빠른 게 아니다.
     *
     * ── 두 자를 **둘 다** 줘야 한다 ────────────────────────────────────
     *
     * `--glob-case-insensitive` 는 **`--glob` 으로 우리가 준 무늬**에만 먹는다.
     * `.gitignore`·`.deelignore` 규칙에는 안 먹는다. 그래서 고친 줄 알고 넘어간
     * 자리에서 그 고장이 그대로 남아 있었다 — 재 보니 `*.tmpx` 를 적어 둔
     * 폴더에서 `A.TMPX` 를 rg 길만 검색했다(자바스크립트 길은 안 봤다).
     * 규칙 파일 쪽 대소문자는 이 자가 따로 정한다.
     */
    ...(process.platform === 'win32' ? ['--glob-case-insensitive', '--ignore-file-case-insensitive'] : []),
    // 점으로 시작하는 것도 본다 — 자바스크립트 길은 처음부터 다 보고 있었다.
    // 무엇이 빠졌었는지는 위 안볼폴더글로브() 에 적어 두었다.
    '--hidden',
  ];
  for (const g of rg글로브들(glob, { 자리, 뿌리 })) 인자.push('--glob', g);
  // 자바스크립트 길이 안 여는 파일·폴더는 rg 도 안 열게 한다. 같은 목록에서 나온다.
  인자.push(...안볼글로브(), ...안볼폴더글로브());
  /*
   * .deelignore 도 지켜야 한다.
   *
   * rg 는 .gitignore 는 알지만 .deelignore 는 모른다. 그대로 두면 "git 에는
   * 안 적고 deel 만 건너뛸 것" 이 rg 가 깔린 PC 에서만 조용히 검색된다.
   * 같은 명령이 PC 마다 다른 답을 내는 셈이라, 이건 빠른 것보다 나쁘다.
   */
  if (무시파일) 인자.push('--ignore-file', 무시파일);
  return 인자;
}

/*
 * ── git grep 에는 **파일만 추리게** 한다 ────────────────────────────────
 *
 * 여기서 사람의 정규식을 그대로 `git grep -E` 에 넘기고 있었다. 네 가지가 샜다:
 *
 *   · ERE 에는 `\d` 가 없다 — `foo\d+` 가 조용히 다른 무늬로 읽혔다
 *   · 기본은 **git 이 아는 파일만** 본다 — 방금 만든 파일은 한 줄도 안 나왔다
 *   · CP949 · 표식 없는 UTF-16 · 8KB 뒤 NUL 파일은 바이트로 보거나(-I) 버렸다
 *   · glob 을 아예 안 넘겼다 — `*.js` 로 좁혀 달라는 말이 무시됐다
 *
 * `-P`(PCRE) 로 바꿔도 못 맞춘다. 재 보니 윈도우의 git 은 로케일을 UTF-8 로
 * 줘도 PCRE 를 **바이트로** 돌려서 `[가-힣]` 이 한 줄도 안 맞았고, 리눅스의
 * git 은 글자로 돌린다. 같은 무늬가 PC 마다 다른 답을 낸다.
 *
 * 그래서 git grep 에게는 **맞는 줄이라면 반드시 품고 있는 글자**(꼭있는글자)만
 * 고정 문자열로 주어 파일을 추리게 하고, 추린 파일은 자바스크립트 길과 같은
 * 함수로 연다(tools/index.js 의 한파일에서찾기). 추린 목록은 답을 품는 쪽으로만
 * 넓으니 답이 자바스크립트 길과 같다. 거기에 git 이 UTF-8 로 못 푸는 파일
 * (git못푸는파일)을 더한다. 꼭 있는 글자를 못 뽑는 무늬는 예전 길로 간다.
 */

/**
 * 정규식이 맞는 줄이면 **반드시** 들어 있는 글자 조각 중 가장 긴 것. 모르면 null.
 *
 * 넓게 잡으면 틀린다(그 글자 없이도 맞는 줄을 놓친다). 그래서 조금이라도
 * 모르겠으면 조각을 끊는다 — 짧아질 뿐 틀리지는 않는다.
 *
 *   · 맨 바깥의 `|` — 어느 갈래가 맞을지 모른다 → null
 *   · 괄호 안에 `|` 가 있거나 괄호 뒤가 `?` `*` `{0,…}` 이면, 앞뒤 보기면 그 괄호는 버린다
 *   · 글자 무리 `[…]` · `.` · `\d` 같은 무리 · `\x41` 같은 번호 글자 → 끊는다
 *   · 대소문자 무시에서 `k`·`s` 는 끊는다 — 유니코드로 접으면 K(켈빈)·ſ 에도 맞는다
 */
export function 꼭있는글자(무늬, { 대소문자무시 = false } = {}) {
  const s = String(무늬 ?? '');
  const 쌓 = [{ 조각들: [], 지금: '', 버림: false, 갈래: false }];
  const 위 = () => 쌓[쌓.length - 1];
  const 끊기 = () => { const f = 위(); if (f.지금) f.조각들.push(f.지금); f.지금 = ''; };
  const 되풀이 = (i) => {
    const c = s[i];
    let 길이 = 0; let 없어도됨 = false; let 여럿 = false;
    if (c === '?' || c === '*') { 길이 = 1; 없어도됨 = true; }
    else if (c === '+') { 길이 = 1; 여럿 = true; }
    else if (c === '{') {
      const m = /^\{(\d+)(,\d*)?\}/.exec(s.slice(i));
      if (m) { 길이 = m[0].length; 없어도됨 = Number(m[1]) === 0; 여럿 = true; }
    }
    if (길이 && s[i + 길이] === '?') 길이 += 1;   // 게으른 표시
    return { 길이, 없어도됨, 여럿 };
  };
  const 못믿을글자 = (ch) => 대소문자무시
    && (/^[ks]$/i.test(ch) || (ch.codePointAt(0) > 0x7F && ch.toLowerCase() !== ch.toUpperCase()));
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      const d = s[i + 1];
      if (d === undefined) return null;
      if (/[A-Za-z0-9]/.test(d)) {
        // 무리(\d \w \s …) · 자리 표시(\b) · 번호 글자(\x41 \u0041 \u{…} \cJ) · 되부르기(\1 \k<이름>)
        끊기();
        let j = i + 2;
        if (s[j] === '{' && /[pPux]/.test(d)) { const e = s.indexOf('}', j); if (e < 0) return null; j = e + 1; }
        else if (d === 'k' && s[j] === '<') { const e = s.indexOf('>', j); if (e < 0) return null; j = e + 1; }
        else if (d === 'x') j += 2;
        else if (d === 'u') j += 4;
        else if (d === 'c') j += 1;
        else if (/[0-9]/.test(d)) while (/[0-9]/.test(s[j] ?? '')) j++;
        i = j + 되풀이(j).길이;
        continue;
      }
      // 빗금 뒤 문장부호는 그 글자 그대로다 (`\.` `\$` `\(`).
      const q = 되풀이(i + 2);
      if (q.없어도됨 || 못믿을글자(d)) 끊기();
      else { 위().지금 += d; if (q.여럿) 끊기(); }
      i = i + 2 + q.길이;
    } else if (c === '[') {
      let j = i + 1;
      while (j < s.length && s[j] !== ']') { if (s[j] === '\\') j++; j++; }
      if (j >= s.length) return null;
      끊기();
      i = j + 1 + 되풀이(j + 1).길이;
    } else if (c === '(') {
      끊기();
      let j = i + 1; let 버림 = false;
      if (s[j] === '?') {
        if (s[j + 1] === ':') j += 2;
        else if (s[j + 1] === '<' && s[j + 2] !== '=' && s[j + 2] !== '!') {
          const e = s.indexOf('>', j); if (e < 0) return null; j = e + 1;
        } else {
          // 앞뒤 보기 `(?=…)` `(?!…)` `(?<=…)` · 깃발 `(?i:…)` — 안의 글자를 믿지 않는다
          버림 = true;
          j += 2;
        }
      }
      쌓.push({ 조각들: [], 지금: '', 버림, 갈래: false });
      i = j;
    } else if (c === ')') {
      if (쌓.length === 1) return null;
      끊기();
      const f = 쌓.pop();
      const q = 되풀이(i + 1);
      if (!f.버림 && !f.갈래 && !q.없어도됨) 위().조각들.push(...f.조각들);
      i = i + 1 + q.길이;
    } else if (c === '|') {
      if (쌓.length === 1) return null;
      끊기(); 위().갈래 = true; i += 1;
    } else if (c === '.' || c === '^' || c === '$') {
      끊기();
      i = i + 1 + 되풀이(i + 1).길이;
    } else if ('*+?{}]'.includes(c)) {
      return null;   // 되풀이할 것이 없는 되풀이 표시 · 짝 없는 괄호 — 낯선 무늬다
    } else {
      const ch = String.fromCodePoint(s.codePointAt(i));
      const q = 되풀이(i + ch.length);
      if (q.없어도됨 || 못믿을글자(ch)) 끊기();
      else { 위().지금 += ch; if (q.여럿) 끊기(); }
      i = i + ch.length + q.길이;
    }
  }
  if (쌓.length !== 1) return null;
  끊기();
  const 조각들 = 쌓[0].조각들;
  if (!조각들.length) return null;
  return 조각들.reduce((a, b) => (Buffer.byteLength(b) > Buffer.byteLength(a) ? b : a));
}

// 자바스크립트 길이 안 여는 파일·폴더는 git 도 안 연다. 같은 목록에서 나온다.
function git경로빼기() {
  return [
    ...안볼확장자.map((x) => `:(exclude,icase)*.${x}`),
    ...[...SKIP_DIRS].map((d) => `:(exclude,glob,icase)**/${d}/**`),
  ];
}

async function git파일목록(자리, 인자, { timeout, signal, env = null }) {
  const r = await 돌려보기('git', ['-C', 자리, '-c', 'core.quotePath=false', '--no-pager', 'grep', ...인자], {
    timeout, signal, 덤: env ? { env: { ...process.env, ...env } } : {},
  });
  if (r.error) return { ok: false, 왜: r.error.message };
  // git grep 은 못 찾으면 1 이다. 그 밖(128 — PCRE 없이 빌드한 git 등)은 못 물어본 것이다.
  if (r.status !== 0 && r.status !== 1) {
    return { ok: false, 왜: (r.stderr ?? '').split('\n')[0] || 'git grep 이 무늬를 못 읽었습니다' };
  }
  // -z 라 이름 사이가 NUL 이다. 이름에 빈칸·따옴표가 있어도 안 깨진다. 찾는 자리 기준 상대경로로 온다.
  const 파일들 = String(r.stdout ?? '').split('\0').map((x) => x.replace(/^\n/, '')).filter(Boolean).map((x) => join(자리, x));
  return { ok: true, 파일들 };
}

/**
 * 꼭 있는 글자를 품은 파일들. 커밋 안 한 새 파일도 본다(`--untracked` — .gitignore 는 지킨다).
 * 글이 아닌 파일(-I)은 뺀다 — 그중 글인 것(표식 없는 UTF-16)은 git못푸는파일 이 잡는다.
 */
export async function git후보파일({ 글자, 자리, 대소문자무시 = false, timeout = 20000, signal = null }) {
  const 인자 = ['-l', '-z', '-I', '--untracked', '-F'];
  if (대소문자무시) 인자.push('-i');
  인자.push('-e', 글자, '--', '.', ...git경로빼기());
  return git파일목록(자리, 인자, { timeout, signal });
}

/**
 * git 이 UTF-8 로 못 읽는 파일들 — rg못푸는파일 과 같은 바이트 무늬.
 *
 * 로케일을 C 로 못박는다. UTF-8 로케일의 리눅스 git 은 PCRE 를 글자로 돌려서
 * `[\x80-\xBF]` 가 바이트가 아니라 U+0080~U+00BF 가 되고, CP949 파일이 한 개도
 * 안 걸린다. `-a` 로 NUL 든 파일도 끝까지 본다.
 */
export async function git못푸는파일({ 자리, timeout = 20000, signal = null }) {
  const 바이트무늬 = 못푸는바이트무늬.replace(/^\(\?-u:/, '(?:');
  const 인자 = ['-l', '-z', '-a', '--untracked', '-P', '-e', 바이트무늬, '--', '.', ...git경로빼기()];
  return git파일목록(자리, 인자, { timeout, signal, env: { LC_ALL: 'C' } });
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
/*
 * ── 경로 끝이 NUL 이면 그 자리로 가른다 (2.0.0 6회차 Gemini 빠른찾기6) ─────────
 *
 * 위 정규식은 `:숫자:` 가 **처음** 나오는 자리를 경로 끝으로 본다. 윈도우는 파일 이름에 콜론을
 * 못 쓰니 그걸로 됐지만, 리눅스·맥은 쓸 수 있다 — `backup-12:30:45.txt:7:hello` 가 파일
 * `backup-12` · 줄 30 으로 갈렸다. 시각을 붙인 백업·로그 이름에서 그대로 생긴다.
 * rg 를 `--null` 로 불러 경로 뒤를 NUL 로 받는다. 파일 이름에는 NUL 이 못 드니 모호함이 없다.
 * NUL 없는 줄(예전 꼴)은 여전히 아래 정규식으로 본다.
 */
export function 줄가르기(줄) {
  const 끝 = 줄.indexOf('\0');
  if (끝 >= 0) {
    const n = /^(\d+):([\s\S]*)$/.exec(줄.slice(끝 + 1));
    return n ? { 파일: 줄.slice(0, 끝), 줄: Number(n[1]), 내용: n[2] } : null;
  }
  const m = /^(.*?):(\d+):([\s\S]*)$/.exec(줄);
  if (!m) return null;
  return { 파일: m[1], 줄: Number(m[2]), 내용: m[3] };
}

/**
 * 빠른 엔진으로 찾아 본다. 못 쓰면 null — 부르는 쪽이 예전 길로 간다.
 *
 * @returns {{엔진:string, 줄들:Array<{파일,줄,내용}>, 잘림:boolean} | null}
 */
export async function 빠르게찾기({ 무늬, 자리, 뿌리 = null, glob = null, 대소문자무시 = false, 무시파일 = null, 최대 = 5000, signal = null }) {
  const 것 = 엔진찾기();
  if (것.rg) {
    /*
     * 찾기와 「rg 가 못 푸는 파일 세기」 를 같이 돌린다 (rg못푸는파일 머리말).
     * 못 푼 파일에서 나온 rg 의 줄은 버린다 — 바이트 그대로 찍힌 깨진 글이거나
     * NUL 앞에서 끊긴 반쪽이다. 그 파일들은 `따로볼파일` 로 넘겨 부르는 쪽이
     * 예전 길과 같은 방법으로 읽는다. 세기가 실패하면 어느 답을 믿을지 모르니
     * 통째로 예전 길로 간다.
     */
    const [r, 못푼것] = await Promise.all([
      rg로찾기({ 무늬, 자리, 뿌리, glob, 대소문자무시, 무시파일, 최대, signal }),
      rg못푸는파일({ 자리, 뿌리, glob, 무시파일, signal }),
    ]);
    if (r.ok && 못푼것.ok) {
      const 따로 = new Set(못푼것.파일들);
      return {
        엔진: 'rg',
        줄들: r.줄들.map(줄가르기).filter(Boolean).filter((x) => !따로.has(x.파일)),
        잘림: r.잘림,
        따로볼파일: 못푼것.파일들,
      };
    }
    // rg 가 무늬를 못 읽은 것일 수 있다(Rust regex 에는 되돌아보기가 없다).
    // 그건 '없다' 가 아니라 '못 물어봤다' 이므로 예전 길로 내려간다.
    return null;
  }
  // git grep 은 .deelignore 를 시킬 방법이 없다. 그 파일이 있으면 예전 길로 간다 —
  // 사람이 "deel 은 여기 보지 마라" 고 적어 둔 것을 못 지키면 빠른 것이 뜻이 없다.
  if (것.gitgrep && !무시파일 && 저장소인가(자리)) {
    // 파일만 추리고 읽기는 자바스크립트 길과 같은 함수로 한다 (꼭있는글자 위 머리말).
    const 글자 = 꼭있는글자(무늬, { 대소문자무시 });
    if (!글자) return null;
    const [후보, 못푼것] = await Promise.all([
      git후보파일({ 글자, 자리, 대소문자무시, signal }),
      git못푸는파일({ 자리, signal }),
    ]);
    if (!후보.ok || !못푼것.ok) return null;
    const 맞나 = glob거르개(glob, { 뿌리, 자리 });
    const 크기괜찮나 = (f) => { try { return statSync(f).size <= 큰파일; } catch { return false; } };
    const 볼것 = [...new Set([...후보.파일들, ...못푼것.파일들])]
      .filter((f) => 맞나(f) && !안볼정규식.test(f) && 크기괜찮나(f))
      .sort();
    return { 엔진: 'git grep', 줄들: [], 잘림: false, 따로볼파일: 볼것, 따로볼까닭: '추림' };
  }
  return null;
}

/** 화면·결과 꼬리에 적을 한마디. 무엇으로 찾았는지 사람이 알아야 한다. */
export function 엔진말(이름) {
  if (!이름) return '';
  return `(${이름} 으로 찾았습니다 — 이 PC 에 이미 있어서 빌려 썼습니다)`;
}
