/**
 * Verify — 만든 것이 **실제로 되는지** 본다.
 *
 * ── 왜 이게 필요한가 ───────────────────────────────────────────────────
 *
 * 턴 끝에 이렇게 뜬다.
 *   ✓ index.html · 410줄 · 18.2KB
 *
 * 이건 파일이 **있다**는 증명이지 **된다**는 증명이 아니다. `<div>` 를 안 닫아
 * 놨어도, `src="app.js"` 가 없는 파일을 가리켜도, JS 에 괄호가 하나 모자라도
 * 똑같이 초록으로 뜬다. 사람은 그 초록을 믿고 다음 일로 넘어간다.
 *
 * 프롬프트에 "다 했으면 확인한다" 는 이미 넣어 뒀다. 그런데 확인할 **길**을
 * 안 줬다. 그러면 그건 부탁이지 규칙이 아니다.
 *
 * ── 무엇을 확인하나 ────────────────────────────────────────────────────
 *
 * 돌려 볼 수 있는 것은 돌려 본다 (node --check · py_compile).
 * 못 돌리는 것은 **읽어서** 본다 (HTML 태그 짝, 빠진 참조, CSS 중괄호 짝,
 * JSON 파싱).
 *
 * 임의의 명령은 **여기서 안 돌린다.** 검사 스크립트는 무슨 짓이든 할 수 있어서,
 * 그걸 돌리는 길은 Bash 하나여야 한다 — 승인 관문과 안전 검사가 거기에만 있다.
 * 이 도구가 몰래 돌리면 strict 모드의 약속이 이 자리에서만 깨진다.
 * 여기서는 "이 프로젝트엔 npm test 가 있다" 고 알려 주기만 한다.
 *
 * 그리고 제일 중요한 것 — **못 확인한 것은 못 확인했다고 말한다.**
 * 조용히 넘기면 사람이 받는 신호는 '확인함' 과 구별되지 않는다. 그럴 바에는
 * 이 도구가 없는 편이 낫다. 확인 못 한 것을 확인했다고 하는 것이 제일 나쁘다.
 */
import { existsSync, statSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { extname, dirname, resolve, join, delimiter, isAbsolute, relative, basename, sep } from 'node:path';
import { walk, SKIP_DIRS, 내부살림 } from './fsutil.js';
import { 건너뜀말 } from './ignore.js';
import { 확인법들 } from './checkmethods.js';
import { decode, looksBinary } from './encoding.js';
import { 셸환경 } from '../safety/shellenv.js';
import { 말 } from '../i18n/index.js';

/* 결과 한 줄을 잇는다 — 빈 조각은 버린다(tools/index.js 의 이어 와 같은 것). */
const 이어 = (...조각들) => 조각들.filter((x) => x != null && String(x) !== '').join(' · ');

/**
 * 짝이 맞아야 하는 HTML 태그. 안 닫아도 되는 것(void)은 뺀다.
 *
 * ── 닫는 태그를 **규격이 생략해도 된다고 적어 둔 것**도 같이 뺀다 ────────
 *
 * 여기 void 만 들어 있던 때, 아래 것들이 전부 「안 닫았습니다」 로 찍혔다 —
 *
 *     <ul><li>하나<li>둘</ul>      <p>첫째<p>둘째      <table><tr><td>a<td>b</table>
 *
 * 브라우저가 멀쩡히 그리는 마크업이고, HTML 이 **허락하는** 꼴이다. 같은 판의
 * tools/webfetch.js 머리말이 이미 그렇게 적어 뒀다 — 「옛 사내 페이지에는 정말로
 * 그렇게 적혀 있다」. 두 파일이 같은 사실에 반대로 굴고 있었다.
 *
 * 이 자리는 `failed: true` 를 세운다. 거짓 탈 하나면 걸음이 거기서 안 끝나고,
 * 모델은 멀쩡한 줄을 고치러 간다 — 바로 아래 html보기 머리말이 「확인 안 하는
 * 것보다 나쁘다」 고 적어 둔 그것이다. 여는 태그를 안 쌓으니 짝짓기에서 통째로
 * 빠지고, `<div>` · `<span>` · `<table>` 처럼 정말 닫아야 하는 것은 그대로 잡는다.
 */
const 안닫아도되는것 = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr', '!doctype', '!--',
  // 규격이 닫는 태그 생략을 허락하는 것들
  'html', 'head', 'body', 'p', 'li', 'dt', 'dd', 'option', 'optgroup',
  'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'rt', 'rp',
]);

/**
 * 여는 태그가 **스스로 닫았나.**
 *
 * `뒤.endsWith('/')` 하나로 봤더니 `<a href=/>` 가 self-closing 으로 잡혔다. 거기 `/` 는
 * 따옴표를 안 쓴 속성값이지 닫는 표시가 아니다(브라우저도 여는 `<a>` 로 읽는다). 그래서
 * 여는 태그를 안 쌓았고, 뒤따르는 `</a>` 가 「여는 <a> 가 없습니다」 라는 거짓 탈이 됐다.
 * 거짓 탈은 확인 안 하는 것보다 나쁘다 — 모델이 멀쩡한 줄을 고치러 간다.
 *
 * 따옴표 안엣것을 지운 뒤, 끝의 `/` **앞**이 빈칸이거나 따옴표이거나 아무것도 없을 때만
 * 닫는 표시로 본다. `=` 나 글자가 붙어 있으면 속성값의 일부다.
 */
function 스스로닫았나(뒤) {
  const 민것 = String(뒤).replace(/"[^"]*"|'[^']*'/g, '""').trimEnd();
  if (!민것.endsWith('/')) return false;
  const 앞 = 민것.slice(0, -1);
  return 앞 === '' || /[\s"']$/.test(앞);
}

/**
 * HTML 을 읽어 본다.
 *
 * 파서를 쓰지 않는다(의존성 0개). 대신 **틀렸다고 확신할 수 있는 것만** 잡는다 —
 * 애매한 것은 넘긴다. 잘못된 경고를 내면 모델이 멀쩡한 파일을 고치기 시작하고,
 * 그게 확인 안 하는 것보다 나쁘다.
 */
export function html보기(글, { 있는파일 = () => true } = {}) {
  const 탈 = [];
  const 쌓임 = [];

  // 주석과 script/style 안엣것은 빼고 본다 — 그 안의 `<` 는 태그가 아니다.
  const 뼈 = String(글)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '<$1></$1>');

  for (const m of 뼈.matchAll(/<(\/?)([a-zA-Z!][a-zA-Z0-9-]*)([^>]*)>/g)) {
    const 닫는가 = m[1] === '/';
    const 이름 = m[2].toLowerCase();
    const 뒤 = m[3] ?? '';
    if (안닫아도되는것.has(이름) || 스스로닫았나(뒤)) continue;
    if (!닫는가) { 쌓임.push(이름); continue; }
    // 닫는 태그. 짝이 맞는 자리를 찾는다.
    const i = 쌓임.lastIndexOf(이름);
    if (i < 0) { 탈.push(`</${이름}> 를 닫는데 여는 <${이름}> 가 없습니다`); continue; }
    const 안닫힌것 = 쌓임.splice(i).slice(1);
    for (const x of 안닫힌것) 탈.push(`<${x}> 를 안 닫았습니다 (</${이름}> 앞에서 끊겼습니다)`);
  }
  for (const x of 쌓임) 탈.push(`<${x}> 를 안 닫았습니다`);

  /*
   * 가리키는 파일이 실제로 있나. 이게 "열었는데 아무것도 안 보인다" 의 첫째 원인이다.
   *
   * ── 「없다」 와 「우리가 못 본다」 를 가른다 ────────────────────────────
   *
   * 여기는 있는파일() 의 답을 참/거짓으로만 봤다. 그래서 부르는 쪽이
   * "이건 내가 못 짚는다" 고 말할 길이 없었고, 못 짚은 것이 전부 **없는
   * 것**으로 적혔다. 실제로 이렇게 났다 —
   *
   *     <script src="/static/app.js">
   *     ✗ /static/app.js 을 가리키는데 그 파일이 없습니다   ← 멀쩡한 마크업
   *
   * 웹에서 앞의 `/` 는 **문서 뿌리**지 그 파일이 있는 폴더가 아니다. 그걸
   * 파일 폴더 기준으로 이어 붙였으니 당연히 없는 자리가 나온다. 그리고 이
   * 거짓 경보는 조용하지도 않다 — failed 가 참으로 서고, 모델은 멀쩡한
   * 줄을 「고치기」 시작한다. 확인 안 한 것보다 나쁜 쪽이다.
   *
   * 이제 null 은 '없다' 가 아니라 '우리가 못 본다' 는 뜻이다. 못 본 것은
   * 탈로 적지 않고, 부르는 쪽이 「확인 못 한 것」 으로 따로 적는다.
   */
  /*
   * 참조는 **주석을 뺀 글**에서 찾는다 (2.0.0 6회차 검증6). 태그 짝은 주석을 뺀 뼈로 보면서 참조는
   * 원문에서 찾아, 주석으로 막아 둔 `<script src="지운.js">` 를 없는 파일로 적었다. 뼈를 그대로 안 쓰는
   * 까닭 — 뼈는 script·style 태그의 속성까지 비워서 `<script src>` 가 사라진다.
   * 주소는 퍼센트를 풀어서 찾는다. 브라우저는 `my%20photo.png` 를 `my photo.png` 로 찾는데 글자
   * 그대로 찾아 「없습니다」 를 적었다. 못 푸는 `%` 는 적힌 그대로 찾는다.
   */
  /*
   * 속성을 고르는 자리는 **놓침과 거짓 탈이 같이 사는** 곳이다 (8회차 확인). 여태 큰따옴표에
   * 소문자에 낱말 경계도 없었다 —
   *   `src='logo.png'` · `<IMG SRC="logo.png">`   아예 안 봤다 (놓침)
   *   `data-src="avatar.png"`                     참조로 세어 「없습니다」 를 적었다 (거짓 탈)
   * 앞에 `-` 나 글자가 붙은 것은 다른 속성이므로 뒤보기로 막고, 작은따옴표도 같이 받고,
   * 속성 이름은 대소문자를 안 가린다. `javascript:` 는 파일이 아니라 코드라 바깥 것에 넣는다.
   */
  /*
   * 대신 **script·style 의 속은 뺀다** (막판 훑기). 원문을 그대로 훑던 때,
   * 자바스크립트 속의 대입 한 줄이 HTML 참조로 세어졌다 —
   *
   *     <script> img.src = 'logo.svg'; el.href = "docs.html"; </script>
   *     → logo.svg 을 가리키는데 그 파일이 없습니다   (거짓 탈 · failed:true)
   *
   * 이번 판에 홑따옴표를 받기 시작하면서 훨씬 자주 걸린다 — JS 는 홑따옴표를 더 쓴다.
   * 여는 태그는 **남긴다.** 위 머리말이 적어 둔 대로 `<script src="…">` 는 진짜 참조다.
   * 뒤보기에 점을 더한 것은 닫는 태그가 없는 script 처럼 이 벗기기가 못 미치는 자리용이다
   * (`img.src`). HTML 속성 앞에는 점이 올 수 없으니 잃는 것이 없다.
   */
  const 참조볼글 = String(글)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<(script|style)\b[^>]*>)[\s\S]*?(<\/\2\s*>)/gi, '$1$3');
  for (const m of 참조볼글
    .matchAll(/(?<![-\w.])(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const 곳 = m[1] ?? m[2];
    if (!곳) continue;                                                  // src="" 는 가리키는 데가 없다
    if (/^(?:https?:|data:|mailto:|tel:|javascript:|#|\/\/)/i.test(곳)) continue;   // 바깥 것은 못 본다
    let 찾을곳 = 곳.split(/[?#]/)[0];
    try { 찾을곳 = decodeURIComponent(찾을곳); } catch { /* 적힌 그대로 */ }
    const 있나 = 있는파일(찾을곳);
    if (있나 === null) continue;
    if (!있나) 탈.push(`${곳} 을 가리키는데 그 파일이 없습니다`);
  }

  return 탈;
}

/**
 * HTML 이 가리키는 자리를 **무엇을 기준으로** 찾나.
 *
 * 상대 경로(`app.js` · `../lib/x.css`)는 그 HTML 파일이 있는 폴더 기준이다.
 * 앞에 `/` 가 붙은 것은 다르다 — 브라우저가 **문서 뿌리**부터 찾는다. 문서
 * 뿌리가 어디인지는 이 파일을 읽어서 알 길이 없다. 서버 설정에 있고,
 * 프로젝트 뿌리일 수도 public/ 일 수도 dist/ 일 수도 있다.
 *
 * 그래서 프로젝트 뿌리로 한 번 찾아보고, 거기 있으면 있다고 한다. 없으면
 * **없다고는 안 한다** — 문서 뿌리가 딴 데라는 뜻일 뿐인데 없다고 적으면
 * 멀쩡한 줄을 고치게 만든다.
 *
 * @returns {boolean|null} null 은 '우리가 못 봤다'. '없다' 가 아니다.
 */
function 참조있나(곳, 파일abs, 뿌리) {
  if (곳.startsWith('/')) {
    if (!뿌리) return null;
    const 자리 = resolve(뿌리, `.${곳}`);
    if (울타리밖(자리, 뿌리)) return null;
    return existsSync(자리) ? true : null;
  }
  const 자리 = resolve(dirname(파일abs), 곳);
  /*
   * 작업 폴더 밖은 **안 짚는다** (2.0.0 6회차 검증6). 짚었더니 있을 때는 조용하고 없을 때는 「없습니다」
   * 라서, `../../` 로 적은 HTML 한 장이 울타리 밖 파일이 있는지 없는지를 모델에게 알려 주는 창이 됐다.
   * 밖은 「못 짚었다」 로 적는다 — 있다고도 없다고도 안 한다.
   */
  if (뿌리 && 울타리밖(자리, 뿌리)) return null;
  return existsSync(자리);
}

const 울타리밖 = (자리, 뿌리) => {
  const rel = relative(resolve(뿌리), 자리);
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
};

/** CSS 중괄호 짝. 이것만으로도 '스타일이 통째로 안 먹는' 경우는 거의 다 잡힌다. */
export function css보기(글) {
  // 주석과 **따옴표 문자열**을 한 무늬로 뺀다 (2.0.0 6회차 검증6). `content: "{"` 의 `{` 를 세어 멀쩡한
  // CSS 에 「중괄호를 안 닫았습니다」 를 적었다. 한 무늬로 훑어야 문자열 속 `/*` 나 주석 속 따옴표에 안 속는다.
  const 뼈 = String(글).replace(/\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\[\s\S])*"|'(?:[^'\\\n]|\\[\s\S])*'/g, '');
  const 연것 = (뼈.match(/\{/g) ?? []).length;
  const 닫은것 = (뼈.match(/\}/g) ?? []).length;
  if (연것 === 닫은것) return [];
  return [연것 > 닫은것
    ? `중괄호를 ${연것 - 닫은것}개 안 닫았습니다 (여는 것 ${연것} · 닫는 것 ${닫은것})`
    : `닫는 중괄호가 ${닫은것 - 연것}개 더 많습니다 (여는 것 ${연것} · 닫는 것 ${닫은것})`];
}

/** JSON 은 그냥 파싱해 본다 — 되면 되는 것이다. */
export function json보기(글) {
  try { JSON.parse(글); return []; }
  catch (e) { return [String(e.message)]; }
}

/*
 * ── 확인 명령은 **셸 없이**, 우리가 고른 실행 파일로 돌린다 (사냥5 H1) ──────────
 *
 * 여기는 `node --check "<파일>"` 을 글자로 만들어 셸에 넘겼다(윈도우 cmd.exe · 유닉스 /bin/sh).
 * 그리고 checkCommand 를 거치니 Bash 와 같은 안전 검사라고 적어 뒀다. 실제로는 이랬다 —
 *
 *   · cmd.exe 는 이름만 준 프로그램을 **PATH 보다 지금 폴더에서 먼저** 찾는다. cwd 가 저장소
 *     뿌리라, 뿌리에 `node.cmd` 가 있으면 그게 돌았다. 받아 온 저장소에서 Verify({}) 한 번이면
 *     승인 없이, strict 모드에서도, **걸러지지 않은 환경**(DEEL_API_KEY·남의 열쇠째)으로.
 *   · /bin/sh 는 큰따옴표 안의 `$(…)` 를 푼다. 파일 이름이 `x$(touch P).js` 면 그게 돈다.
 *
 * 이 파일 머리말이 스스로 못 박은 「임의의 명령은 여기서 안 돌린다」 가 바로 이 자리에서
 * 깨졌다. checkCommand 는 위험한 **명령 모양**을 보는 것이라 이 둘을 못 잡는다.
 *
 * 그래서 셸을 안 거친다. node 는 지금 이 프로그램을 돌리는 그 node(process.execPath),
 * 파이썬은 **우리가 PATH 에서** 찾은 절대 경로다 — 빈 칸·`.`·상대 경로 칸과 작업 폴더 안의
 * 칸은 건너뛴다. 파일 경로는 인자 하나로 넘어가니 이름에 무엇이 들었든 글자일 뿐이다.
 * 환경은 Bash 와 같은 거른 환경(safety/shellenv.js)을 준다. 파이썬은 `-I` 로 띄운다 —
 * 안 그러면 `-m py_compile` 이 작업 폴더를 sys.path 앞에 넣어 저장소의 `py_compile.py` 를
 * 가져와 돌린다(같은 구멍의 파이썬 쪽).
 */
function 명령돌리기(파일, 인자, { cwd, 제한 = 60000, env } = {}) {
  return new Promise((끝) => {
    execFile(파일, 인자, {
      cwd, env, timeout: 제한, maxBuffer: 4 * 1024 * 1024,
      windowsHide: true, encoding: 'buffer',
    }, (err, so, se) => {
      const 풀기 = (b) => (b && b.length ? decode(Buffer.from(b)).text : '');
      const out = [풀기(so), 풀기(se)].filter(Boolean).join('\n').trim();
      const 시그널 = err?.signal ?? null;
      const code = 시그널 ? null : (err?.code ?? 0);
      끝({ ok: !시그널 && code === 0, code, 시그널, out, 없음: err?.code === 'ENOENT' });
    });
  });
}

/**
 * 이름으로 실행 파일을 PATH 에서 찾는다 — 셸이 찾게 두지 않는다 (위 머리말).
 *
 * 지금 폴더를 뜻하는 칸(빈 칸·`.`·상대 경로)과 작업 폴더 안의 칸은 건너뛴다. 그 자리의
 * 파일은 저장소가 심을 수 있다. 윈도우에서는 `.exe` 만 본다 — `.cmd`·`.bat` 은 결국
 * cmd.exe 를 부르는 것이라 셸을 안 거친다는 뜻이 없어진다.
 *
 * @returns {string|null} 절대 경로. 못 찾으면 null — 그러면 「도구가 없다」 로 말한다.
 */
function 경로에서찾기(이름들, { env = process.env, 뿌리 = null } = {}) {
  const 윈 = process.platform === 'win32';
  // 윈도우 환경 이름은 대소문자를 안 가린다(Path · PATH). 거른 환경 객체는 평범한 객체라 직접 찾는다.
  const 칸 = Object.keys(env ?? {}).find((k) => (윈 ? k.toUpperCase() === 'PATH' : k === 'PATH'));
  const 목록 = String((칸 && env[칸]) ?? '').split(delimiter);
  const 뿌리abs = 뿌리 ? resolve(뿌리) : null;
  for (const 이름 of 이름들) {
    for (const 날것 of 목록) {
      const 폴더 = 날것.trim().replace(/^"(.*)"$/, '$1');
      if (!폴더 || !isAbsolute(폴더)) continue;
      if (뿌리abs) {
        const rel = relative(뿌리abs, resolve(폴더));
        if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) continue;
      }
      const 후보 = join(폴더, 윈 ? `${이름}.exe` : 이름);
      try { if (statSync(후보).isFile()) return 후보; } catch { /* 여기엔 없다 */ }
    }
  }
  return null;
}

/**
 * 폴더를 통째로 볼 때 한 번에 보는 파일 수.
 *
 * 상한이 있는 것 자체는 옳다 — 저장소가 크면 한 번의 Verify 가 몇 분이 된다.
 * 다만 **넘친 것을 말해야** 한다. 안 말하면 마흔한 번째 파일이 깨져 있어도
 * 「확인했습니다」 로 끝난다. 이 파일이 있는 까닭과 정면으로 어긋난다.
 */
const 한번에최대 = 40;

/**
 * 폴더를 훑을 때 고르는 종류 — 아래에서 돌려 보거나 읽어서 볼 줄 아는 것만.
 * `.scss`·`.less` 는 읽는 자리(css보기)는 받는데 고르는 자리에 빠져 있어서 기본 훑기가 안 봤다 (2.0.0 6회차 검증6).
 */
const 볼만한확장 = new Set(['.html', '.htm', '.css', '.scss', '.less', '.json', '.js', '.mjs', '.cjs', '.py']);
const 볼만한것인가 = (p) => 볼만한확장.has(extname(p).toLowerCase());

/**
 * 이 확장자를 돌려 볼 명령이 있나. 없으면 null — 그러면 '못 돌려 봤다' 고 말한다.
 *
 * 돌려주는 것은 글자 명령이 아니라 {파일, 인자} 다 — 셸을 안 거친다(명령돌리기 머리말).
 * 파일이 null 이면 이 컴퓨터에 그 도구가 없다는 뜻이다.
 */
function 돌릴명령(확장, { 뿌리 = null, env = process.env } = {}) {
  switch (확장) {
    case '.js': case '.mjs': case '.cjs':
      return { 파일: process.execPath, 인자: (p) => ['--check', p], 어떻게: 'node --check' };
    case '.py':
      return {
        파일: 경로에서찾기(process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'], { env, 뿌리 }),
        /*
         * `-B` 가 없으면 py_compile 이 원본 옆에 `__pycache__/*.pyc` 를 **써 놓는다.**
         * 이 파일 머리말은 여기서 아무것도 안 돌리고 안 남긴다고 적어 두었는데, 확인
         * 한 번에 승인도 감사도 되돌리기도 없는 파일이 작업 폴더에 생겼다 — 그러고는
         * git status 에 뜬다. 바이트코드는 우리가 쓸 것도 아니다.
         */
        인자: (p) => ['-I', '-X', `pycache_prefix=${join(tmpdir(), 'deel-pyc')}`, '-m', 'py_compile', p],
        어떻게: 'py_compile',
      };
    default: return null;
  }
}

const 짧게 = (s, n = 300) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export const VERIFY_TOOL = {
  schema: {
    name: 'Verify',
    description:
      '만든 것이 실제로 되는지 확인한다. 일을 끝내기 전에 **반드시** 한 번 불러라.'
      + ' 파일이 있다는 것과 그 파일이 된다는 것은 다르다 — 안 닫힌 태그, 없는 파일을'
      + ' 가리키는 src, 괄호 하나 모자란 JS 는 파일 목록만 봐서는 안 보인다.'
      + ' 돌려 볼 수 있는 것은 돌려 보고(node --check · py_compile),'
      + ' 못 돌리는 것은 읽어서 본다(HTML 태그 짝 · 빠진 참조 · CSS 중괄호 · JSON).'
      + ' 확인 못 한 종류는 못 했다고 그대로 말해 준다.'
      + ' 검사·빌드를 돌리는 것은 Bash 로 해라 — 그건 사용자 승인을 거쳐야 하는 일이다.',
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: '확인할 파일들. 없으면 작업 폴더에서 확인할 수 있는 것을 다 본다.',
        },
      },
      required: [],
    },
  },

  async run(args, ctx) {
    const 뿌리 = ctx.scope.root;

    // 볼 파일 고르기. 안 주면 작업 폴더에서 확인할 수 있는 것을 찾는다.
    let 볼것 = [];
    // 상한에 걸려 안 본 것의 수. 0 이 아니면 아래에서 못한것 에 넣는다.
    let 넘친수 = 0;
    // .gitignore 로 안 본 것은 셈해 뒀다가 끝에 적는다. 조용히 빼면
    // "빌드 산출물에 탈이 있는데 왜 확인이 통과냐" 를 사람이 못 푼다.
    // 못 연 폴더·파일도 같이 이고 간다 (fsutil.js 의 walk). 여기서 안 더하면
    // 「확인된 것 3개」 밑에 안 본 자리가 통째로 숨는다.
    const 건너뜀 = { 폴더: 0, 파일: 0, 못연폴더: 0, 못연파일: 0 };
    // 훑기 상한에서 멈춘 것도 같이 챙긴다 — 안 본 것을 "탈 없음" 으로 읽히게 두면 안 된다.
    let 잘림 = false;
    let 상한 = 0;
    const 셈더하기 = (목록) => {
      건너뜀.폴더 += 목록.건너뜀?.폴더 ?? 0;
      건너뜀.파일 += 목록.건너뜀?.파일 ?? 0;
      건너뜀.못연폴더 += 목록.건너뜀?.못연폴더 ?? 0;
      건너뜀.못연파일 += 목록.건너뜀?.못연파일 ?? 0;
      if (목록.잘림) { 잘림 = true; 상한 = 목록.상한 ?? 상한; }
    };
    if (Array.isArray(args.paths) && args.paths.length) {
      /*
       * 짚어 준 **폴더**는 기본 훑기와 같은 거름·상한을 탄다 (2.0.0 6회차 검증6). 여기는 폴더 안 것을
       * 확장자도 안 가리고 상한도 없이 전부 담았다 — `paths: ['src']` 한 번에 js 가 천 개면 node 를 천 번
       * 띄웠고, 그림·문서는 「확인 못 한 것」 으로 쏟아져 진짜 탈이 묻혔다. 이름을 대 준 파일은 그대로 다 본다.
       */
      const 폴더에서 = [];
      for (const p of args.paths) {
        let abs;
        try { abs = ctx.scope.resolve(p); } catch (e) { 볼것.push({ 없음: p, 왜: e.message }); continue; }
        if (!existsSync(abs)) { 볼것.push({ 없음: p, 왜: '파일이 없습니다' }); continue; }
        if (statSync(abs).isDirectory()) {
          const 안것 = await walk(abs, { skipDirs: SKIP_DIRS });
          셈더하기(안것);
          for (const f of 안것) if (볼만한것인가(f.path)) 폴더에서.push({ path: f.path });
        } else 볼것.push({ path: abs });      // 짚어 준 파일은 규칙과 상관없이 본다
      }
      넘친수 = Math.max(0, 폴더에서.length - 한번에최대);
      볼것.push(...폴더에서.slice(0, 한번에최대));
    } else {
      const 전부 = await walk(뿌리, { skipDirs: SKIP_DIRS });
      셈더하기(전부);
      const 볼만한것 = 전부.filter((f) => 볼만한것인가(f.path));
      볼것 = 볼만한것.slice(0, 한번에최대).map((f) => ({ path: f.path }));
      /*
       * 상한에 걸려 안 본 것은 **말한다.**
       *
       * 이 파일 머리말이 스스로 못 박아 둔 것이 있다 — 「못 확인한 것은 못
       * 확인했다고 말한다. 확인 못 한 것을 확인했다고 하는 것이 제일 나쁘다.」
       * .gitignore 로 건너뛴 것과 walk 상한은 그렇게 하고 있었는데, **이
       * 상한만 아무 데도 안 적혔다.**
       *
       * 그래서 파일이 마흔 개를 넘으면, 마흔한 번째부터는 깨져 있어도
       * 「확인했습니다」 로 끝났다. failed 도 거짓이라 루프까지 성공으로
       * 넘어간다. 상한 자체보다 **말을 안 한 것**이 탈이다.
       */
      넘친수 = 볼만한것.length - 볼것.length;
    }

    const 된것 = [];
    const 탈난것 = [];
    const 못한것 = [];
    // 확인 명령에 물려줄 환경 — Bash 와 같은 거른 것 (명령돌리기 머리말). 확장자마다 고른 명령은 한 번만 찾는다.
    const 자식환경 = 셸환경(process.env, { 남길것: ctx.셸남길것 ?? [] }).env;
    const 고른명령 = {};
    if (넘친수 > 0) {
      못한것.push({
        이름: `그 밖의 ${넘친수}개`,
        왜: `한 번에 ${한번에최대}개까지만 봅니다 — 나머지는 paths 로 짚어서 다시 부르세요`,
      });
    }

    for (const x of 볼것) {
      if (x.없음) { 탈난것.push({ 이름: x.없음, 탈: [x.왜] }); continue; }
      const abs = x.path;
      const 이름 = ctx.scope.show(abs);
      const 확장 = extname(abs).toLowerCase();

      /*
       * 안 보는 살림 파일이라도 **안 봤다고는 말한다.**
       *
       * 여기는 `continue` 한 줄이었다. 그래서 짚어 준 경로가 살림 자리면
       * 된것에도 탈난것에도 못한것에도 안 들어가고 그냥 사라졌다 —
       *
       *     Verify(paths: ['.deel/config.json'])
       *     → 확인할 수 있는 파일이 없었습니다
       *
       * 준 것은 하나인데 답은 「없다」 다. 사람이 이름을 대서 시킨 일에
       * 아무 말도 안 하는 것은 이 파일 머리말이 딱 하나 못 박아 둔 것
       * (「못 확인한 것은 못 확인했다고 말한다」)과 정면으로 어긋난다.
       *
       * 안 읽는 것은 그대로다 — 열쇠가 든 파일을 열지 않는 까닭은 fsutil.js
       * 의 내부살림 에 적혀 있다. 안 읽되, 왜 안 읽었는지는 그 자리에서 말한다.
       */
      const 살림이유 = 내부살림(abs);
      if (살림이유) { 못한것.push({ 이름, 왜: 살림이유 }); continue; }
      let buf;
      try { buf = readFileSync(abs); } catch (e) { 탈난것.push({ 이름, 탈: [e.message] }); continue; }
      if (looksBinary(buf)) { 못한것.push({ 이름, 왜: '바이너리 — 돌려 볼 수 없습니다' }); continue; }
      const 글 = decode(buf).text;

      // ── 돌려 볼 수 있는 것 ──────────────────────────────────────────
      // 셸 없이, 고른 실행 파일로, 거른 환경으로 (명령돌리기 머리말 · 사냥5 H1).
      if (!(확장 in 고른명령)) 고른명령[확장] = 돌릴명령(확장, { 뿌리, env: 자식환경 });
      const 만들기 = 고른명령[확장];
      if (만들기) {
        if (!만들기.파일) { 못한것.push({ 이름, 왜: `${확장} 을 확인할 도구가 이 컴퓨터에 없습니다` }); continue; }
        const r = await 명령돌리기(만들기.파일, 만들기.인자(abs), { cwd: 뿌리, 제한: 30000, env: 자식환경 });
        // 도구 자체가 이 컴퓨터에 없으면 '틀렸다' 가 아니라 '못 봤다' 이다.
        // 파이썬이 안 깔린 PC 에서 py 파일을 전부 빨갛게 칠하면 아무도 안 믿는다.
        // (윈도우 스토어 자리표시 python.exe 는 「was not found」 를, 옛 python2 는 -I 에 「Unknown option」 을 낸다.)
        // 그 말들은 **이 파일 이름이 안 나오는** 글에서만 믿는다 (2.0.0 6회차 검증6). 문법 오류 글에는 파일
        // 경로와 원문 한 줄이 따라 나오는데, 원문에 `was not found` 가 있으면 깨진 파일이 「도구가 없다」 로 넘어갔다.
        const 도구없다는말 = !r.out.includes(basename(abs))
          && /not recognized|command not found|찾을 수 없|No such file|was not found|Unknown option/i.test(r.out);
        if (!r.ok && (r.없음 || 도구없다는말)) {
          못한것.push({ 이름, 왜: `${확장} 을 확인할 도구가 이 컴퓨터에 없습니다` });
        } else if (r.ok) 된것.push({ 이름, 어떻게: 만들기.어떻게 });
        else 탈난것.push({ 이름, 탈: [짧게(r.out) || `종료코드 ${r.code}`] });
        continue;
      }

      // ── 읽어서 보는 것 ──────────────────────────────────────────────
      let 탈 = null;
      /*
       * 한 파일은 **한 칸에만** 선다 (8회차 확인).
       *
       * 여기서 못 짚은 참조를 바로 못한것 에 밀어 넣고는, 아래에서 탈이 없다고 된것 에 또
       * 넣었다. 그래서 같은 파일이 「? 어느 파일인지 못 짚었습니다」 와 「✓ 읽어서 확인」 으로
       * 나란히 찍혔고, 확인됨+탈+못확인 의 합이 실제로 본 파일 수보다 컸다. 사람은 ✓ 를 보고
       * 넘어간다 — 못 확인한 것을 확인했다고 하는 것이 제일 나쁜 쪽이다.
       * 그래서 말만 만들어 두고, 어느 칸에 설지는 아래 한 자리에서 정한다.
       */
      let 못짚음말 = null;
      if (확장 === '.html' || 확장 === '.htm') {
        // 못 짚은 참조는 탈이 아니라 「확인 못 한 것」 이다 (참조있나 참고).
        const 못짚은것 = [];
        탈 = html보기(글, {
          있는파일: (곳) => {
            const 답 = 참조있나(곳, abs, 뿌리);
            if (답 === null) 못짚은것.push(곳);
            return 답;
          },
        });
        if (못짚은것.length) {
          못짚음말 = `${못짚은것.slice(0, 3).join(' · ')}${못짚은것.length > 3 ? ` 그 밖에 ${못짚은것.length - 3}개` : ''}`
            + ' — 앞의 / 는 문서 뿌리 기준이라, 또는 작업 폴더 밖이라 어느 파일인지 못 짚었습니다 (없다는 뜻이 아닙니다)';
        }
      } else if (['.css', '.scss', '.less'].includes(확장)) {
        탈 = css보기(글);
      } else if (확장 === '.json') {
        탈 = json보기(글);
      }

      if (탈 === null) { 못한것.push({ 이름, 왜: `${확장 || '확장자 없음'} 은 아직 확인할 줄 모릅니다` }); continue; }
      if (탈.length) { 탈난것.push({ 이름, 탈 }); continue; }
      if (못짚음말) { 못한것.push({ 이름, 왜: 못짚음말 }); continue; }
      된것.push({ 이름, 어떻게: 확장 === '.json' ? 'JSON 파싱' : '읽어서 확인' });
    }

    // ── 사실대로 적는다 ───────────────────────────────────────────────
    const 줄 = [];

    if (탈난것.length) {
      줄.push(`탈난 것 ${탈난것.length}개 — 여기부터 고쳐라:`);
      for (const x of 탈난것) {
        줄.push(`  ✗ ${x.이름}`);
        for (const t of x.탈.slice(0, 5)) 줄.push(`      ${t}`);
        if (x.탈.length > 5) 줄.push(`      … 그 밖에 ${x.탈.length - 5}개`);
      }
      줄.push('');
    }

    if (된것.length) {
      줄.push(`확인된 것 ${된것.length}개:`);
      for (const x of 된것.slice(0, 20)) 줄.push(`  ✓ ${x.이름} (${x.어떻게})`);
      if (된것.length > 20) 줄.push(`  … 그 밖에 ${된것.length - 20}개`);
      줄.push('');
    }

    /*
     * 못 확인한 것을 **반드시** 적는다.
     *
     * 이걸 빼면 "확인된 것 3개" 만 보이고, 사람도 모델도 그게 전부인 줄 안다.
     * 그러면 이 도구는 확인해 주는 물건이 아니라 안심시켜 주는 물건이 된다.
     */
    if (못한것.length) {
      줄.push(`확인 못 한 것 ${못한것.length}개 (**됐다고 말하면 안 된다**):`);
      for (const x of 못한것.slice(0, 15)) 줄.push(`  ? ${x.이름} — ${x.왜}`);
      if (못한것.length > 15) 줄.push(`  … 그 밖에 ${못한것.length - 15}개`);
    }

    if (!줄.length) 줄.push('확인할 수 있는 파일이 없었습니다. 무엇을 확인할지 paths 로 알려 주세요.');

    /*
     * 이 프로젝트가 스스로 정해 둔 확인 방법이 있으면 **알려만 준다.**
     *
     * 여기서 직접 돌리지 않는다. 검사 스크립트는 무슨 짓이든 할 수 있고,
     * 그걸 돌리는 길은 Bash 하나뿐이어야 한다 — 거기에만 승인 관문과 안전
     * 검사가 걸려 있기 때문이다. 이 도구가 몰래 돌리면 strict 모드에서
     * "물어보고 실행한다" 는 약속이 이 자리에서만 깨진다.
     */
    const 확인들 = 확인법들(뿌리);
    if (확인들.length) {
      줄.push('');
      if (확인들.length === 1) {
        줄.push(`이 프로젝트에는 ${확인들[0].명령} 가 있습니다. 진짜로 도는지 보려면 Bash 로 돌려라.`);
      } else {
        /*
         * **하나만 알려 주면 하나만 돈다.**
         *
         * 벤치마크에서 진 자리가 여기다 — 검사가 셋인 프로젝트에서 우리는
         * 하나만 알려 줬고, 그래서 하나만 돌았고, 회귀 범위가 좁았다.
         * 고른 하나가 아니라 **찾은 전부**를 준다. 무엇을 돌릴지는 모델이
         * 정하되, 있는 줄도 몰라서 못 도는 일은 없어야 한다.
         */
        줄.push(`이 프로젝트의 확인 방법은 ${확인들.length}가지입니다. 고친 곳과 닿는 것은 **전부** Bash 로 돌려라 —`);
        for (const { 명령, 어디서 } of 확인들) 줄.push(`  ${명령}   (${어디서})`);
        줄.push('하나만 돌리고 "회귀 검증했다" 고 말하지 마라. 안 돌린 것은 안 돌렸다고 적어라.');
      }
    }

    const 다됐나 = !탈난것.length;
    return {
      content: 줄.join('\n').trim() + 건너뜀말(건너뜀, 잘림, 상한),
      /*
       * 요약은 **본문과 같은 말**을 해야 한다 (8회차 확인).
       *
       * 「확인 못 한 것을 반드시 적는다」 고 위에 적어 놓고, 요약에서는 탈이 하나라도 있으면
       * 그 줄을 통째로 뺐다. 탈난 파일을 고치고 나면 사람 눈에는 「탈 1개 · 확인 1개」 만
       * 남았던 것이고, 못 확인한 파일은 없던 일이 됐다. 그리고 본 것이 없어도 「확인 0개」 를
       * 적어, 아무것도 확인 못 한 판이 확인한 판처럼 보였다. 빈 조각은 이어 가 버린다.
       */
      summary: 이어(
        탈난것.length ? 말('sum.broken', { n: 탈난것.length }) : '',
        된것.length ? 말('sum.verified', { n: 된것.length }) : '',
        못한것.length ? 말('sum.unverified', { n: 못한것.length }) : '',
      ),
      // 루프가 '아직 안 끝났다' 고 알 수 있게. 탈이 났는데 성공으로 넘기면
      // 다음 걸음에서 모델이 "다 됐습니다" 로 답을 맺는다.
      failed: !다됐나,
      확인됨: 된것.length,
      탈: 탈난것.length,
      못확인: 못한것.length,
    };
  },
};

// 확인 방법 찾기는 tools/checkmethods.js 로 옮겼다 — 찾을 자리가 늘어 파일이 무거워졌다.
