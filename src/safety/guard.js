// 자율 실행의 울타리.
// 승인 프롬프트를 안 쓰는 대신 (1) 작업 범위 밖은 못 건드리고
// (2) 되돌릴 수 없는 명령만 막는다. 나머지는 전부 통과시킨다.
import { resolve, relative, isAbsolute, sep, dirname, basename, win32, posix } from 'node:path';
import { realpathSync, readFileSync, lstatSync, readdirSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { 내부살림 } from '../tools/fsutil.js';

export class ScopeError extends Error {}
export class BlockedError extends Error {}

/*
 * ── 같은 이름이 두 가지 모양으로 온다 (맥의 한글 폴더) ──────────────────
 *
 * 맥은 파일 이름을 **자모 분리형(NFD)** 으로 저장한다(`챗` 은 디스크에 세 글자). 모델이 쓰는
 * 한글은 합쳐진 모양(NFC)이다. 눈에는 같지만 **자바스크립트 문자열로는 다르다.**
 *
 *   '오후'.length          → 2   (NFC, 모델이 쓴 것)
 *   '오후'.normalize('NFD') → 4   (맥이 준 것)
 *
 * 글자로만 견주면 한글 폴더에서 **제 작업 폴더 안의 파일이 전부 범위 밖으로 튕기고**, 어느
 * 쪽 모양으로 오느냐에 따라 같은 호출이 됐다 안 됐다 한다.
 *
 * **견줄 때만** 한 모양으로 맞춘다. 돌려주는 경로는 원래 것 그대로 둔다 — 리눅스 파일시스템은
 * 바이트를 그대로 보므로 NFC 와 NFD 가 **다른 파일**이고, 바꿔 버리면 멀쩡한 파일을 못 찾는다.
 * 맥은 찾을 때 두 모양을 같은 것으로 보므로 원래 것을 넘겨도 열린다.
 */
const 같은꼴 = (s) => String(s).normalize('NFC');

/** 이 절대경로가 base 밖인가. */
function 밖(base, abs) {
  const rel = relative(같은꼴(base), 같은꼴(abs));
  return rel.startsWith('..' + sep) || rel === '..' || (isAbsolute(rel) && rel !== '');
}

/**
 * 링크를 따라간 진짜 자리.
 *
 * 윈도우에는 정션(junction)이 흔하다. 작업 폴더 안에 바깥을 가리키는 정션이 하나 있으면 경로
 * 글자만 봐서는 범위 안인데 실제로 닿는 곳은 바깥이라, 글자로만 검사하는 울타리가 그 한 칸으로
 * 통째로 열린다. 아직 없는 파일(새로 쓰는 자리)도 검사해야 하므로, 있는 자리가 나올 때까지
 * 위로 올라가 거기서 링크를 풀고 남은 이름을 다시 붙인다.
 *
 * ── 왜 native 를 먼저 부르나: 윈도우의 8.3 단축명 ─────────────────────
 *
 * 윈도우는 여덟 자가 넘는 이름에 `LONGDI~1` 같은 별명을 같이 만든다. `realpathSync` 는 링크는
 * 풀지만 이 별명은 **안 편다** — 같은 자리를 한쪽은 `RUNNER~1`, 다른 쪽은 `runneradmin` 으로
 * 부르게 된다. `realpathSync.native` 는 OS 에게 물어 긴 이름으로 편다. 사용자 이름이 여덟 자만
 * 넘어도 `%TEMP%` 가 통째로 단축명이 되므로(`C:\Users\RUNNER~1\AppData\Local\Temp`) 남 일이
 * 아니다. git 은 긴 이름으로 답하니 같은 파일이 「저장소 밖」 으로 걸러져, agent/commit.js 에서는
 * 담을 것이 없다고 저장소 전부로 물러서게 된다.
 *
 * native 가 없거나 실패하면 realpathSync 로 물러선다. 견주는 양쪽이 같은 자를 쓰기만 하면 된다.
 */
const 풀기 = (p) => {
  try { return realpathSync.native(p); } catch { /* 없거나 못 물어보는 자리 */ }
  return realpathSync(p);
};

export function 진짜자리(p) {
  const 남은 = [];
  let cur = p;
  for (let i = 0; i < 64; i++) {
    try {
      const r = 풀기(cur);
      return 남은.length ? resolve(r, ...남은) : r;
    } catch { /* 아직 없는 자리 — 한 칸 위로 */ }
    const 위 = dirname(cur);
    if (위 === cur) return p;      // 뿌리까지 갔는데도 없다. 글자 그대로 본다.
    남은.unshift(basename(cur));
    cur = 위;
  }
  return p;
}

/** `/c/Users/…` → `C:/Users/…`. 윈도우에서만, 드라이브 글자 한 자짜리 첫 칸만. */
export function MSYS풀기(p) {
  if (process.platform !== 'win32') return p;
  const m = /^\/([a-zA-Z])(\/|$)/.exec(p);
  return m ? `${m[1].toUpperCase()}:${p.slice(2) || '/'}` : p;
}

/*
 * ── 있는 파일을 없다고 하던 경로 ─────────────────────────────────────────
 *
 * 모델은 사람 말에서 경로를 베껴 온다. 그래서 디스크에 있는 파일인데 이렇게 온다.
 *
 *   ‘hr_dashboard/js/app.js’               따옴표째
 *   qwen 프로젝트/hr_dashboard/js/app.js    작업 폴더 이름을 앞에 한 번 더
 *   /Users/me/qwen\ 프로젝트/a.js           터미널에 끌어다 놓은 모양
 *   ~/qwen 프로젝트/a.js                    집 폴더 줄임
 *   한글 폴더/보고서.md                     디스크와 다른 자모 모양
 *
 * 글자 그대로의 자리가 **없을 때만** 고친다. 있으면 손대지 않는다 — 이름에 진짜 따옴표가 든
 * 파일도 있다. 허락·금지 규칙보다 **먼저** 고쳐야 규칙이 고친 경로를 본다(agent/loop.js).
 * 범위 검사는 고친 뒤에 resolve 가 그대로 한다.
 */
const 있나 = (p) => { try { lstatSync(p); return true; } catch { return false; } };
const 따옴표짝 = [["'", "'"], ['"', '"'], ['`', '`'], ['‘', '’'], ['“', '”'], ['「', '」'], ['『', '』']];

function 껍질벗기(s) {
  let 글 = String(s).trim();
  for (let i = 0; i < 3; i++) {
    const 짝 = 따옴표짝.find(([앞, 뒤]) => 글.length > 2 && 글.startsWith(앞) && 글.endsWith(뒤) && !글.slice(1, -1).includes(뒤));
    if (!짝) break;
    글 = 글.slice(1, -1).trim();
  }
  return 글;
}

/** `~/` 를 펴고, 맥·리눅스에서는 셸 모양의 역빗금을 푼다. 윈도우는 역빗금이 구분자라 안 건드린다. */
function 셸꼴풀기(s) {
  const 펴진 = s.replace(/^~(?=[/\\]|$)/, () => homedir());
  return sep === '/' ? 펴진.replace(/\\([ ()&'"[\]])/g, '$1').replace(/\\/g, '/') : 펴진;
}

/** 뿌리를 다른 모양(NFC·대소문자)으로 적은 경로를 뿌리가 적힌 꼴로. glob 과 rg 는 상대경로를 글자로 잰다. */
function 뿌리꼴로(abs, base) {
  if (abs.startsWith(base) || 밖(base, abs)) return abs;
  const 칸수 = base.split(sep).filter(Boolean).length;
  return resolve(base, ...abs.split(sep).filter(Boolean).slice(칸수));
}

/** 자모 모양만 다른 이름을 디스크에 있는 모양으로 한 칸씩 맞춘다. 못 맞추면 받은 그대로. */
function 디스크꼴로(abs, base) {
  if (있나(abs) || 밖(base, abs)) return abs;
  const 칸들 = relative(같은꼴(base), 같은꼴(abs)).split(sep).filter(Boolean);
  let 지금 = base;
  let 고침 = false;
  for (let i = 0; i < 칸들.length; i++) {
    const 곧장 = resolve(지금, 칸들[i]);
    if (있나(곧장)) { 지금 = 곧장; continue; }
    let 이름들 = [];
    try { 이름들 = readdirSync(지금); } catch { /* 폴더가 아니거나 못 여는 자리 */ }
    const 찾음 = 이름들.find((x) => 같은꼴(x) === 칸들[i]);
    if (찾음 === undefined) return 고침 ? resolve(지금, ...칸들.slice(i)) : abs;
    지금 = resolve(지금, 찾음);
    고침 = true;
  }
  return 지금;
}

/** 앞머리에 작업 폴더 이름(그 위 폴더까지 포함)을 겹쳐 적은 칸 수. */
function 겹친칸수(칸들, base) {
  const 뿌리칸 = base.split(sep).filter(Boolean).map(같은꼴);
  for (let k = Math.min(칸들.length - 1, 뿌리칸.length); k >= 1; k--) {
    const 끝칸 = 뿌리칸.slice(-k);
    if (칸들.slice(0, k).every((x, i) => 같은꼴(x) === 끝칸[i])) return k;
  }
  return 0;
}

/** 모델이 적은 경로 대신 쓸 절대경로. 고칠 것이 없으면 null. */
function 있는자리찾기(p, base, { 쓰기 = false } = {}) {
  const 절대 = (x) => (isAbsolute(x) ? resolve(x) : resolve(base, x));
  const 그대로 = 절대(MSYS풀기(p));
  if (있나(그대로)) return null;
  const 벗긴 = MSYS풀기(셸꼴풀기(껍질벗기(p)));
  if (!벗긴) return null;
  const 벗긴자리 = 디스크꼴로(절대(벗긴), base);
  if (있나(벗긴자리)) return 벗긴자리;
  if (!isAbsolute(벗긴)) {
    const 칸들 = 벗긴.split(/[\\/]/).filter((x) => x && x !== '.');
    const k = 칸들.includes('..') ? 0 : 겹친칸수(칸들, base);
    if (k) {
      const 뗀자리 = 디스크꼴로(resolve(base, ...칸들.slice(k)), base);
      const 위 = dirname(뗀자리);
      // 쓰는 자리는 바로 뿌리 밑으로 안 당긴다 — 프로젝트와 같은 이름의 하위 폴더를 만드는 일은 흔하고(foo/foo/__init__.py), 뿌리의 파일을 덮으면 안 된다.
      const 폴더있음 = 같은꼴(위) !== 같은꼴(base) && 있나(위);
      if (폴더있음 || (!쓰기 && 있나(뗀자리))) return 뗀자리;
    }
  }
  // 아무 데도 없으면 새로 만드는 자리다. 껍질을 벗긴 것만 쓴다 — ‘a.js’ 라는 파일이 생기면 안 된다.
  return 벗긴자리 === 그대로 ? null : 벗긴자리;
}

const 경로인자칸 = new Set(['file_path', 'path', 'paths', 'from', 'to']);
const 쓰는칸 = { Write: 'file_path', Append: 'file_path', Move: 'to' };

/** 도구 인자 속 경로와 glob 무늬를 있는 자리로 맞춘다. 묶음 꼴(files·edits)도 따라 들어간다. */
export function 경로인자맞추기(도구, args, scope) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || !scope?.바로잡기) return;
  for (const [칸, 값] of Object.entries(args)) {
    if (경로인자칸.has(칸) && typeof 값 === 'string') args[칸] = scope.바로잡기(값, { 쓰기: 쓰는칸[도구] === 칸 });
    else if (경로인자칸.has(칸) && Array.isArray(값)) args[칸] = 값.map((x) => (typeof x === 'string' ? scope.바로잡기(x) : x));
    else if (Array.isArray(값)) for (const x of 값) 경로인자맞추기(도구, x, scope);
  }
  // Grep 의 pattern 은 정규식이라 건드리지 않는다. 무늬는 glob 만.
  const 무늬칸 = 도구 === 'Grep' ? 'glob' : 도구 === 'Glob' || 도구 === 'Outline' ? 'pattern' : null;
  // path 를 줬으면 무늬는 그 폴더 기준이라 앞 칸이 작업 폴더 이름과 같아도 우연이다. 껍질만 벗긴다.
  if (무늬칸 && typeof args[무늬칸] === 'string') args[무늬칸] = scope.무늬바로잡기(args[무늬칸], { 겹침도: !args.path || args.path === '.' || args.path === './' });
}

// 작업 범위 — deel 를 띄운 폴더. 그 밖은 읽기도 쓰기도 막는다.
export function makeScope(root) {
  const base = resolve(root);
  // 뿌리 자신도 링크 아래 있을 수 있다(맥의 /tmp 가 그렇다). 그래서 양쪽 다 푼 값으로 견준다.
  let _진짜뿌리 = null;
  const 진짜뿌리 = () => (_진짜뿌리 ??= 진짜자리(base));
  return {
    root: base,
    resolve(p) {
      if (!p || typeof p !== 'string') throw new ScopeError('경로가 비었습니다');
      // Git Bash 꼴 절대 경로(/c/Users/…)는 윈도우에서 C:\Users\… 다. 안 풀면 지금
      // 드라이브 밑의 \c\Users\… 로 읽혀, 안에 있는 파일이 '범위 밖' 으로 막힌다.
      const 경로 = MSYS풀기(p);
      let abs = isAbsolute(경로) ? resolve(경로) : resolve(base, 경로);
      /*
       * ── 글자로는 밖인데 **같은 자리를 다르게 적은 것** ───────────────────────
       *
       * 윈도우는 한 폴더를 두 이름으로 적는다 — `C:\Users\RUNNER~1\…`(8.3) 와
       * `C:\Users\runneradmin\…`. 뿌리를 짧은 이름으로 들고 있는데 모델이 긴 이름 절대경로를
       * 주면(셸의 pwd · 오류 글 · 딴 도구의 답에서 베낀 것) 글자로만 견주면 **같은 폴더의 파일이
       * 「작업 범위 밖」** 으로 막힌다. 그래서 글자로 밖이면 한 번 더 **실제 자리끼리** 견준다.
       * 실제로도 밖이면 막고, 안이면 받되 돌려주는 경로는 **뿌리가 적힌 꼴로** 다시 붙인다 —
       * 되돌리기 기록(rel)·화면 경로(show)·커밋이 다 뿌리의 꼴로 견주기 때문이다.
       */
      if (밖(base, abs)) {
        const 실제 = 진짜자리(abs);
        const 뿌리실제 = 진짜뿌리();
        if (밖(뿌리실제, 실제)) throw new ScopeError(`작업 범위 밖입니다: ${p}\n  범위: ${base}`);
        const 안쪽 = relative(같은꼴(뿌리실제), 같은꼴(실제));
        abs = 안쪽 ? resolve(base, 안쪽) : base;
      }
      abs = 뿌리꼴로(abs, base);
      // 글자로는 안인데 링크를 따라가면 밖인 자리. 정션 하나로 울타리가 열린다.
      // 견주기도 한 모양으로 맞춘다 — 맥의 realpathSync 는 자모 분리형을 돌려주므로, 안 맞추면
      // 링크 없는 평범한 한글 폴더가 매번 '링크를 따라간 자리가 다르다' 로 잡힌다.
      const 진짜 = 진짜자리(abs);
      if (같은꼴(진짜) !== 같은꼴(abs) && 밖(진짜뿌리(), 진짜)) {
        throw new ScopeError(`작업 범위 밖입니다 (링크가 밖을 가리킵니다): ${p}\n  실제 자리: ${진짜}\n  범위: ${base}`);
      }
      return abs;
    },
    /** 모델이 적은 경로를 디스크에 있는 경로로 맞춘 글. 범위 밖이면 절대경로로 돌려줘 resolve 가 「범위 밖」 이라고 막게 한다. */
    바로잡기(p, 덤 = {}) {
      if (typeof p !== 'string' || !p) return p;
      const 자리 = 있는자리찾기(p, base, 덤);
      if (!자리) return p;
      if (밖(base, 자리)) return 자리;
      return relative(base, 뿌리꼴로(자리, base)).split(sep).join('/') || '.';
    },
    /** glob 무늬의 따옴표와 앞에 겹쳐 적은 작업 폴더 이름을 뗀다. */
    무늬바로잡기(무늬, { 겹침도 = true } = {}) {
      const 글 = 껍질벗기(무늬);
      if (!겹침도) return 글;
      const 빼기 = 글.startsWith('!');
      const 몸 = 빼기 ? 글.slice(1) : 글;
      if (isAbsolute(몸)) return 글;
      // 역빗금이 무늬 글자를 이스케이프하면 경로 구분자가 아니다.
      const 칸들 = 몸.split(/\/|\\(?![[\]{}()*?!])/).filter((x) => x !== '.');
      const n = 칸들.findIndex((x) => /[*?[{]/.test(x));
      const 글자칸 = n < 0 ? 칸들.slice(0, -1) : 칸들.slice(0, n);
      const k = 칸들.includes('..') ? 0 : 겹친칸수([...글자칸, '*'], base);
      // 같은 이름의 하위 폴더가 있어도 그 안에 다음 칸이 없으면 겹쳐 적은 것이다.
      const 다음칸 = 칸들[k];
      const 진짜자리 = 다음칸 && !/[*?[{]/.test(다음칸) ? resolve(base, ...칸들.slice(0, k + 1)) : resolve(base, 칸들[0]);
      if (!k || 있나(진짜자리)) return 글;
      return `${빼기 ? '!' : ''}${칸들.slice(k).join('/')}`;
    },
    show(abs) {
      // 여기도 맞춰야 한다. 안 맞추면 제 폴더 안의 파일이 `../../../Users/me/…` 처럼 보인다.
      const rel = relative(같은꼴(base), 같은꼴(abs));
      return rel === '' ? '.' : rel.split(sep).join('/');
    },
  };
}

/*
 * 「뿌리」 로 치는 목표 한 낱말. rm · find · chmod · rsync 규칙이 같이 쓴다.
 *
 *   `/` · `/*` · `/etc` · `/etc/`    뿌리와 그 바로 아래 한 칸 — 코드조각인가() 가 한 마디짜리를
 *                                    코드로 넘기므로 여기서 잡아야 한다(`rm -rf /etc`).
 *   `~` · `$HOME` · `${HOME}`        집 폴더
 *   `C:` · `C:\` · `C:/`             윈도우 드라이브
 *
 * 따옴표를 둘러도 같다. 뒤에 글자가 더 붙으면(`/tmp/x` · `~/Downloads`) 안 걸린다 — 부르는 규칙이
 * 뒤에 빈칸이나 끝을 요구한다.
 *
 * ── 빗금을 **겹쳐** 적은 뿌리 ─────────────────────────────
 *
 * POSIX 는 겹친 빗금을 하나로 읽으니 `//` · `///` 도 `/` 다(`rm -rf //` · `find // -delete`).
 * checkPaths 가 받아 줄 수도 없다 — 코드조각인가() 가 빗금만 남은 낱말을 넘기는데, 그건 코드 속
 * `// 주석` 이 낱말로 잘려 오는 자리라 풀 수가 없다. 그러니 여기가 **유일한** 턱이다. 뿌리 빗금과
 * 한 칸 뒤 빗금을 둘 다 여러 자로 받는다 — `//.` · `///etc` · `//*` 도 걸린다.
 *
 * ── `~이름` 은 **남의 집**이다 ────────────────────────────
 *
 * 셸은 `~root` 를 root 의 집으로 푼다(`rm -Rf ~root`). 이름은 글자나 밑줄로 시작할 때만 받는다 —
 * `~1` · `~+` 은 셸의 다른 뜻이고, 가운데 물결(`a~b` · `PROGRA~1` · `HEAD~1`)은 앞에 빈칸이 오지
 * 않아 애초에 안 닿는다.
 */
const 뿌리목표 = String.raw`["']?(?:\/+(?:[\w.-]+\/*)?|~(?:[A-Za-z_][\w.-]*)?\/*|\$\{?HOME\}?\/*|[A-Za-z]:[\\/]*)\*?["']?`;

/*
 * ── cmd·파워셸에는 **다른 뿌리목표**를 쓴다 ──────────────────────
 *
 * 위 뿌리목표 의 첫 갈래 `\/+(?:[\w.-]+\/*)?` 는 「뿌리 또는 뿌리 바로 아래 한 칸」(`/` · `/usr`)
 * 이다. cmd 에서 `/s` · `/q` 는 **스위치**지 경로가 아니라서, 그대로 쓰면 `rd /s /q node_modules`
 * 가 막히는데 유닉스 짝 `rm -rf node_modules` 는 통과한다. 같은 일에 다른 답이 나오면 규칙이
 * 아니라 우연이다.
 *
 * 그래서 윈도우 쪽은 빗금 뒤에 이름을 **안 받는다** — `rmdir /s /q /` 처럼 빗금만 있는 것은
 * 막고 `/s` 는 스위치로 지나간다. 대신 별(`C:\*` · `/*` · `~/*`)과 역빗금 뿌리를 받는다
 * (파워셸에서 `\` 하나는 지금 드라이브의 뿌리다). 「뿌리 바로 아래 한 칸」 은 **드라이브 쪽에**
 * 둔다 — `C:\Windows` · `C:\Users` 는 유닉스의 `/usr` 와 같은 자리다. 두 칸부터는 안 본다
 * (`C:\proj\tmp` 는 그대로 돈다).
 *
 * 적는 법만 다른 같은 자리도 받는다.
 *
 *     rmdir /s /q \\?\C:\        긴 경로 접두사 (윈도우가 그대로 받는다)
 *     rd /s /q \\.\C:\           장치 이름 공간
 *     rd /s /q %SystemDrive%\    cmd 가 푸는 자리표 — `C:` 다
 *
 * 자리표는 **뿌리를 가리키는 것만** 적는다. `%TEMP%` · `%BUILD_DIR%` 는 안 넣는다 —
 * `rd /s /q %TEMP%` 는 사람이 실제로 하는 청소다.
 */
// 파워셸은 중괄호 꼴도 받는다 — `${env:SystemDrive}`.
const 윈자리표이름 = String.raw`(?:SystemDrive|SystemRoot|windir|HOMEDRIVE|USERPROFILE|ProgramFiles(?:\(x86\))?|ProgramData|ALLUSERSPROFILE|PUBLIC)`;
const 윈자리표 = String.raw`(?:\$\{env:${윈자리표이름}\}|\$env:${윈자리표이름}|%${윈자리표이름}%)`;
/*
 * 드라이브 뒤에 이름이 오려면 **가름표가 하나는** 있어야 한다. `C:temp` 는 뿌리가 아니라 「C
 * 드라이브의 지금 자리 아래 temp」 라 막으면 멀쩡한 청소가 막힌다. `C:` 와 `C:\` 와
 * `C:\Users` 는 막는다.
 */
const 윈뿌리목표 = String.raw`["']?(?:(?:[\\/]{2}[?.][\\/])?[A-Za-z]:(?:[\\/]+(?:[\w.-]+[\\/]*)?)?|[\\/]+|~(?:[A-Za-z_][\w.-]*)?[\\/]*|\$\{?HOME\}?[\\/]*|${윈자리표}[\\/]*)\*?["']?`;

// 되돌릴 수 없는 것만 막는다. 목록이 길어지면 도구가 쓸모없어진다.
const BLOCKED = [
  // `/c` · `/c/` 는 Git Bash 에서 C:\ 다.
  /*
   * 스위치는 **차례도 토막 수도 안 따진다.** `rm -r -f /` · `rm -f -r /` · `rm --recursive --force /`
   * 가 `rm -rf /` 와 뜻이 같기 때문이다. 이 마디 안에 되풀이 스위치가 **있고**(앞보기 하나)
   * 밀어붙이기 스위치도 **있으면**(앞보기 둘) 본다. 짧은 꼴(`-r` · `-rf` · `-fr`)과 긴 꼴
   * (`--recursive`)이 `--?[a-z]*r` 한 갈래에 다 들어온다.
   *
   * 목표는 글 끝에만 묶지 않는다 — `rm -rf /*` · `rm -rf / *` · `rm -rf "/*"` 는 셸이 `/*` 를
   * 뿌리 아래 전부로 펴서 지운다. 목표 뒤에 별 하나와 따옴표를 받고 **빈칸이나 끝**이 오면 된다.
   *
   * 스위치는 **낱말째** 본다. `--?[a-z]*r` 로 보면 `rm --force /a` 의 `force` 안 r 이 「재귀」
   * 로 읽혀 파일 하나 지우는 명령이 막힌다. `-f` 는 안 묻는다 — 모델이 도는 자리는 터미널이
   * 아니라서 `rm -r ~` 도 묻지 않고 지운다.
   */
  {
    re: new RegExp(String.raw`\brm\b(?=[^|;&]*\s(?:-[a-z]*r[a-z]*|--recursive)(?=\s|$))[^|;&]*\s${뿌리목표}(?=\s|$)`, 'i'),
    why: '뿌리 폴더를 통째로 지우려 합니다',
  },
  /*
   * ── 뿌리를 미는 것은 rm 만이 아니다 ───────────────────────
   *
   * 코드조각인가() 는 맨 `/` 를 검사에서 넘기면서 「뿌리를 미는 명령은 BLOCKED 가 따로 더 확실하게
   * 잡는다」 고 약속한다(`find / -delete` · `chmod -R 777 /` · `rsync -a --delete x/ /`). 뿌리
   * (`/` · `~` · `$HOME`)를 **목표로** 할 때만 본다. `find . -delete` · `chmod -R 755 ./dist` 는
   * 지나간다. find 는 경로 앞에 `-L`·`-H`·`-P` 가 올 수 있고, 지우개는 `/bin/rm` 처럼 자리째 적기도
   * 한다.
   */
  { re: new RegExp(String.raw`\bfind\b(?:\s+-[HLPO]\w*)*\s+${뿌리목표}(?=\s)(?=[^|;&]*\s-(?:delete\b|exec(?:dir)?\s+(?:\S*\/)?rm\b))`, 'i'), why: '뿌리 폴더 아래를 통째로 지웁니다' },
  // 대소문자를 가린다 — chmod 의 `-r` 은 재귀가 아니라 「읽기 권한 빼기」 다. `-Rf` 처럼 붙여 적은 것도 받는다.
  { re: new RegExp(String.raw`\b(?:chmod|chown|chgrp)\b(?=[^|;&]*\s(?:-[a-zA-Z]*R[a-zA-Z]*|--recursive)(?=\s|$))[^|;&]*\s${뿌리목표}(?=\s|$)`), why: '뿌리 폴더 전체의 권한·주인을 바꿉니다' },
  // rsync 는 **마지막** 낱말이 받는 쪽이다. `rsync -a --delete / backup/` 은 뿌리를 떠 오는 것이라 안 막는다. `--del` 은 줄임꼴.
  { re: new RegExp(String.raw`\brsync\b(?=[^|;&]*\s--del(?:ete[\w-]*)?(?=[\s=]|$))[^|;&]*\s${뿌리목표}\s*$`), why: '뿌리 폴더를 복사본에 맞춰 지웁니다' },
  { re: /\b(mkfs|fdisk|diskpart)\b/i, why: '디스크를 초기화하는 명령입니다' },
  { re: /\bformat\s+[a-z]:/i, why: '드라이브를 포맷하는 명령입니다' },
  // 윈도우 짝을 빠뜨리면 안 된다 — deel 은 윈도우에서 주로 돈다.
  /*
   * ── rd · del: 스위치는 아무 차례로나 오고, 막는 판단은 **목표**로 한다 ──────
   *
   * `/s` 는 「하위까지」 일 뿐 어디를 지우는지와 상관이 없다. `/s` 가 있다고 막으면 `rd /s /q
   * node_modules` 가 막힌다(유닉스 짝 `rm -rf node_modules` 는 통과). 그래서 위 rm·find·chmod 와
   * 같은 잣대를 쓴다 — 스위치는 **앞보기**로 있는지만 보고(차례를 안 따진다), 막는 판단은 목표가
   * 뿌리목표 일 때만. del 도 목표가 스위치보다 **앞**에 오는 `del C:\ /f /s /q` 를 잡는다.
   * `\*` 로 끝나는 갈래(`del /s /q D:\proj\*`)는 그대로 둔다.
   */
  { re: new RegExp(String.raw`\b(?:rd|rmdir)\b(?=[^|;&]*\s\/s\b)[^|;&]*\s${윈뿌리목표}(?=\s|$)`, 'i'), why: '폴더를 통째로 지웁니다 — 정션이 있으면 원본까지 딸려 갑니다' },
  { re: new RegExp(String.raw`\bdel\b(?=[^|;&]*\s\/[sq]\b)[^|;&]*(?:\\\*|\s${윈뿌리목표}(?=\s|$))`, 'i'), why: '하위 폴더까지 전부 지웁니다' },
  // 파워셸도 같은 일을 한다. 드라이브 뿌리나 집 폴더를 통째로 미는 것만 본다 — 폴더 하나 지우는
  // 평범한 Remove-Item 까지 막으면 도구를 못 쓴다.
  /*
   * 어순을 안 따진다. `Remove-Item C:\ -Recurse -Force` · `Remove-Item -Recurse -Force C:/` ·
   * `Remove-Item ~ -Recurse -Force` 는 플래그가 경로 뒤에 오거나 빗금이 앞쪽이어도 파워셸이 받는
   * 같은 명령이다. `-Recurse` 가 이 마디 안에 **있기만** 하면 되고(앞보기), 목표는 마디 어디에
   * 있어도 된다. 뒤에 `\s|$` 를 붙여 「드라이브 **뿌리**」 일 때만 잡는다 — `C:\proj\tmp` 는
   * 통과한다.
   *
   * ReDoS 주의: 가운데 `(-?[a-z]*\s*)*` 처럼 양쪽 다 빈 문자열을 허용하는 겹은 안 맞는 긴 입력에서
   * 되돌아가는 경우의 수가 기하급수로 늘어 guard 검사 자체가 멈춘다. 각 겹은 최소 한 글자를 먹게
   * 하고, 별(`*`)은 하나씩만 둔다.
   */
  {
    /*
     * `-r[a-z]*` 인 까닭: 파워셸은 헷갈리지 않는 한 매개변수를 **줄여서** 받는다. Remove-Item 에서
     * `r` 로 시작하는 것은 `-Recurse` 하나뿐이라 `-rec` · `-recur` 가 다 통한다.
     *
     * 목표에 `[\\/]` 한 갈래를 더 둔 까닭: 파워셸에서 `/` 나 `\` 하나만 적으면 **지금 드라이브의
     * 뿌리**다. 별(`*`)도 받는다 — 셸이 별을 펴서 그 아래를 통째로 지우므로 `C:\*` · `/*` · `~/*`
     * 도 뿌리다(위 rm 규칙과 같은 잣대).
     *
     * 파워셸의 **다른 이름**도 같은 명령이다. `ri` · `rd` · `rmdir` · `del` · `erase` 는 전부
     * Remove-Item 이다. 위 rd · del 규칙은 cmd 의 `/s` · `/q` 만 보고 여기는 긴 이름만 보면
     * `ri -Recurse -Force C:\` 가 지나간다(checkPaths 가 범위 밖으로 막아 주지만 이 목록은 그와
     * 따로 서는 겹이다).
     */
    re: new RegExp(String.raw`(?<![\w-])(?:Remove-Item|ri|rd|rmdir|del|erase)\b(?=[^|;&]*\s-r[a-z]*\b)[^|;&]*\s${윈뿌리목표}(?=\s|$)`, 'i'),
    why: '드라이브나 집 폴더를 통째로 지웁니다',
  },
  // `git push -f` 도 막는다 — 사람이 실제로 더 많이 치는 짧은 꼴이다.
  {
    re: /git\s+push\b[^|;&]*(?:--force(?!-with-lease)|\s-[a-z]*f[a-z]*\b)/i,
    why: '원격 이력을 덮어씁니다 (--force-with-lease 를 쓰세요)',
  },
  // 낱말만 보면 안 된다. `node scripts/shutdown.js` · `npm run reboot` 이 막히므로 명령의 **첫 낱말**일 때만 본다.
  { re: /(^|[|;&]\s*)(sudo\s+)?(shutdown|reboot|halt|poweroff)\b/i, why: '시스템을 끕니다' },
  // 포크 폭탄.
  //
  // 껐다 켜면 기계는 돌아오니 되돌릴 수 없는 것은 아니지만, **아직 안 적은 것들**(저장 안 한
  // 것, 하던 대화)은 돌아오지 않는다.
  //
  // 이름은 아무거나 될 수 있으니 이름이 아니라 **모양**을 본다: 함수를 만들고, 그 안에서 **저를
  // 불러 곧바로 파이프나 뒤로 보내기에** 물리고, 밖에서 그 이름을 부른다(뒷갈이 \2 로 같은 이름인지
  // 까지). '저를 부른 **바로 뒤**가 | 나 &' 인 것이 열쇠다 — 그냥 이름과 & 가 몸 안에 있다고 보면
  // `up(){ docker compose up -d & }; up` 이 걸린다(up 뒤에는 `-d`). 이름 앞뒤 낱말 경계로
  // `tee -a out.log` 의 log 를 잘못 읽지 않게 하고, 앞자리에 따옴표와 여는 괄호를 넣어
  // `bash -c ":(){ :|:& };:"` 처럼 한 겹 싸도 잡는다.
  {
    re: /(^|[|;&\s"'(])([\w.:]{1,16})\s*\(\s*\)\s*\{[^}]*(?<![\w.])\2(?![\w.])\s*[|&][^}]*\}\s*;?\s*(?<![\w.])\2(?![\w.])/,
    why: '스스로를 끝없이 불려 기계를 멈춰 세웁니다 (포크 폭탄)',
  },
  // 같은 것을 한 줄로 적는 오래된 방법. 이 모양으로 쓸 다른 일이 없다.
  { re: /\bfork\s+while\s+fork\b/i, why: '스스로를 끝없이 불려 기계를 멈춰 세웁니다 (포크 폭탄)' },
  /*
   * 받아서 곧바로 셸에 먹이는 것.
   *
   * 뜻이 같은 다른 적는 법이 다 걸려야 한다 — `wget -qO- http://x | sh`(받아 오는 다른 이름),
   * `curl http://x | sudo bash`(사이에 낱말 하나), `curl http://x | zsh`(다른 셸). 받아 오는
   * 이름을 한 갈래로 묶고, 파이프와 셸 사이에 `sudo`·`env` 가 끼는 것을 받아 주고, 흔한 셸 이름을
   * 다 적는다.
   */
  {
    /*
     * 셸을 **자리째** 적는 것도 같은 셸이다(`| /bin/bash` · `| /usr/bin/sh`). 앞에 폴더가 붙는
     * 것만 받는다 — 앞 조각은 빗금으로 끝나야 하고 셸 이름은 그 뒤 첫 글자부터 시작해야 하므로 이름
     * **안**에 sh 가 든 것(`hash.sh` · `fish.py`)은 안 걸린다. 감싸는 낱말 앞에도 자리를 받고
     * (`| /usr/bin/env bash`), 셸 이름 앞의 자리는 따옴표 안이면 빈칸도 받는다
     * (`| "C:\Program Files\Git\bin\bash.exe"`).
     *
     * ── 앞머리 인자 자리는 **되돌이(ReDoS)** 를 피해야 한다 ─────────────────
     *
     * `\S+=\S+` 로 두면 `!==!` 한 조각을 등호 자리마다 다르게 쪼갤 수 있어, 그런 조각이 늘어선
     * 글에서 갈래가 두 배씩 불어나 **막으려고 둔 울타리가 프로그램을 멈춘다.** 여기 들어오는 것은
     * 모델이 지어낸 명령줄이라 길이도 정해져 있지 않다.
     *
     * 인자 꼴을 하나씩 적어 두면 적지 않은 꼴에서 통째로 빠져나간다(`curl … | sudo -u root bash`
     * 는 `root` 가 어느 꼴도 아니라 맞추기가 멈춘다. `-C dir` · `--user x` 도 같다). 그래서
     * **셸이 아닌 낱말은 무엇이든 건너뛴다** 로 뒤집는다. `\S+\s+` 는 빈칸으로 쪼개는 길이 하나뿐이고
     * 앞의 부정 전방탐색은 자리를 안 먹으므로 겹침이 없다.
     *
     * 감싸는 낱말(`sudo`·`env`…)은 **그대로 못 박아 둔다** — 풀면 `curl … | grep foo bash` 가 걸려
     * 거짓 경고가 된다.
     */
    re: /\b(?:curl|wget|fetch|aria2c)\b[^|]*\|\s*(?:["']?(?:[^|"'\s]*[\\/])?(?:sudo|doas|env|nohup|command)["']?\s+(?:(?!["']?(?:[^|"'\n]*[\\/])?(?:ba|z|k|da|c|tc|fi)?sh(?:\.exe)?(?=["'\s]|$))\S+\s+)*)?["']?(?:[^|"'\n]*[\\/])?(?:ba|z|k|da|c|tc|fi)?sh(?:\.exe)?(?=["'\s]|$)/i,
    why: '받은 스크립트를 그대로 실행합니다',
  },
  {
    re: /\b(?:iwr|irm|invoke-webrequest|invoke-restmethod|curl|wget)\b[^|]*\|\s*(?:iex|invoke-expression)\b/i,
    why: '받은 스크립트를 그대로 실행합니다',
  },
];

/*
 * ── 뒤에 한 마디만 붙여도 열리면 안 된다 ──────────────────────────────
 *
 * 위 규칙 여럿이 `\s*$` 로 **글 끝**에 못을 박는다. 셸은 한 줄에 여러 마디를 넣고 **둘 다**
 * 실행하므로 `rm -rf / ; echo done` · `rm -rf / && echo done` · `del /f /s /q C:\ & echo done` 처럼
 * 뒤에 붙이는 것이 새면 울타리가 통째로 열린다.
 *
 * 그래서 **마디로 갈라 각 마디를 따로 본다.** 규칙은 그대로 두고 보는 자리만 늘린다 — 전체 글도
 * 여전히 본다. 막는 쪽으로만 늘어난다.
 *
 * 따옴표 안은 안 가린다. 가려서 얻는 것(`echo "rm -rf / ; x"` 를 안 막기)보다 잃는 것
 * (`sh -c "rm -rf / ; x"` 를 못 막기)이 크다. 이 목록은 되돌릴 수 없는 것만 담으므로, 애매하면
 * 막고 사람이 다시 적는 편이 낫다.
 */
const 마디로 = (s) => s
  .split(/(?:\|\||&&|[;&|\n\r])+/)
  .map((x) => x.trim())
  .filter(Boolean);

export function checkCommand(cmd) {
  const s = String(cmd);
  /*
   * ── 세지 말고 늘 같이 본다 ──────────────────────────────────────────
   *
   * `마디로(s).length > 1` 일 때만 마디를 보면 `rm -rf / ;` 는 마디가 **하나**다(뒤가 빈 마디라
   * 걸러진다). 마디 목록이 버려지고 남은 전체 글은 `\s*$` 에 안 걸려, 반 마디 붙이면 샌다.
   * 마디가 하나뿐이면 그 마디는 앞뒤 빈칸만 뺀 전체 글이라 늘 같이 봐도 손해가 없다.
   */
  /*
   * ── 따옴표를 **떼고도** 한 번 본다 ──────────────────────────────────
   *
   * 「따옴표 안은 안 가린다」 는 것과 떼고 보는 것은 다르다. 경로에 따옴표를 두르면
   * (`rm -rf "/"` · `Remove-Item -Recurse "C:\"`) 셸에서는 뜻이 안 바뀌는데 규칙이 빗나간다.
   * 따옴표를 뺀 꼴도 볼 것에 넣는다 — 막는 쪽으로만 늘어난다. `sh -c "rm -rf /"` 는 이제 걸리고
   * `echo "결과" > out.txt` 처럼 떼도 아무 규칙에 안 걸리는 것은 그대로 통과한다.
   */
  const 따옴표뺀 = (x) => x.replace(/["'`]/g, '');
  const 마디들 = 마디로(s);
  const 볼것 = [...new Set([s, ...마디들, 따옴표뺀(s), ...마디들.map(따옴표뺀)])];
  for (const b of BLOCKED) {
    for (const 하나 of 볼것) {
      if (b.re.test(하나)) throw new BlockedError(`${b.why}\n  막힌 명령: ${s.slice(0, 120)}`);
    }
  }
  return true;
}

/**
 * 명령줄에 적힌 경로들을 뽑아 울타리 안인지 본다.
 *
 * 왜 필요한가:
 *   Read 도구는 .deel/config.json 을 막는다(게이트웨이 열쇠가 그 안에 있다). 그런데 Bash 로
 *   `type .deel\config.json` 이 되면 읽힌 열쇠가 대화에 실려 게이트웨이로 나가고 세션 기록으로
 *   디스크에도 남는다. 범위도 마찬가지다 — 시스템 프롬프트가 '이 폴더 밖은 읽지도 쓰지도 못한다'
 *   고 말하는데 `cat ../../비밀` 이 되면, 모델은 그 말을 안 믿고 사용자는 울타리가 있다고 믿는다.
 *
 * 어떻게 고르나:
 *   경로처럼 보이는 낱말만 본다(/ 나 \ 가 있거나, ~ 또는 드라이브로 시작). 그리고 **밖으로 나가는
 *   것만** 막는다. sed 의 's/a/b/' 나 npm 의 some/pkg 는 글자로는 경로 같아도 풀어 보면 폴더
 *   안이라 안 걸린다.
 */
export function checkPaths(cmd, scope) {
  if (!scope) return true;
  // 폴더를 옮기고 나면 뒤 낱말은 전부 맨 이름이라 아래 검사에 안 걸린다. 옮기는 것부터 먼저 본다.
  const 옮긴자리 = 폴더옮김검사(String(cmd), scope);
  for (const t of 경로낱말(String(cmd))) {
    // 자료가 아닌 자리는 울타리를 안 묻는다 (봐주는자리 머리말).
    if (봐주는자리(t)) continue;
    // cd 가 가리킨 자리는 위에서 **옮겨 간 자리 기준**으로 이미 봤다. 여기서 또 보면 뿌리 기준으로
    // 풀려서 `cd src/a && cd ../..` 가 밖으로 읽힌다. 본 **횟수만큼만** 건너뛴다 — 글자로 건너뛰면
    // `cd src; cd ..; find .. -delete` 의 뒤 `..` 가 앞 cd 의 `..` 덕에 검사를 비켜 간다.
    const 남은번 = 옮긴자리.get(t) ?? 0;
    if (남은번 > 0) { 옮긴자리.set(t, 남은번 - 1); continue; }
    // 어디인지 모르는 이전 폴더는 밖으로 본다 (경로낱말 의 `~-` 머리말).
    if (/^~-(?=[/\\]|$)/.test(t)) {
      throw new ScopeError(`\`~-\` 는 셸의 이전 폴더(OLDPWD)라 어디인지 알 수 없어 작업 범위 밖으로 봅니다: ${t}`
        + `\n  이 명령 안에 있습니다: ${String(cmd).slice(0, 120)}`);
    }
    let abs;
    try { abs = scope.resolve(t); }
    catch (e) {
      if (e instanceof ScopeError) {
        throw new ScopeError(`${e.message}\n  이 명령 안에 있습니다: ${String(cmd).slice(0, 120)}`);
      }
      continue;
    }
    const 이유 = 내부살림(abs);
    if (이유) throw new BlockedError(`${이유}\n  이 명령 안에 있습니다: ${String(cmd).slice(0, 120)}`);
  }
  return true;
}

/*
 * ── `~이름` 이 가리키는 집 ─────────────────────────────────────────────────
 *
 * 「내 집 옆자리」 로만 풀면 root 로 돌 때 내 집이 `/root` 라 옆자리가 **뿌리**다 — `~admin` 이
 * `/admin` 이 되어, 작업 폴더가 마침 `/admin` 이면 남의 집을 「범위 안」 으로 읽는다. 셸은 passwd
 * 의 `/home/admin` 으로 간다.
 *
 * 유닉스에서는 passwd 에 적힌 집을 먼저 본다. 없으면(맥의 디렉터리 서비스 · 윈도) 내 집 옆자리로
 * 풀되, 그 옆자리가 뿌리면 관례 자리(`/home`)로 간다. 내 이름이면 내 집이다.
 */
export function 남의집(이름, { 집 = homedir(), 나 = null, passwd = null, platform = process.platform } = {}) {
  let 내이름 = 나;
  if (내이름 == null) { try { 내이름 = userInfo().username; } catch { 내이름 = ''; } }
  if (이름 === 내이름) return 집;
  if (platform !== 'win32') {
    let 글 = passwd;
    if (글 == null) { try { 글 = readFileSync('/etc/passwd', 'utf8'); } catch { 글 = ''; } }
    for (const 줄 of String(글).split('\n')) {
      const 칸 = 줄.split(':');
      if (칸[0] === 이름 && 칸[5]) return 칸[5];
    }
  }
  // 판을 넘겨받았으면 경로 셈도 그 판으로 한다. 리눅스에서 윈도 판을 물으면 `C:\Users\me` 가
  // 상대경로로 읽힌다(검사만 그 판을 만든다).
  const 길 = platform === 'win32' ? win32 : posix;
  const 옆 = 길.dirname(집);
  return 길.resolve(옆 === 길.parse(옆).root ? 길.join(옆, 'home') : 옆, 이름);
}

// 셸이 알아서 풀어 주는 자리표. 우리도 같이 풀어야 실제로 닿는 곳을 본다.
function 자리표풀기(s) {
  return s
    .replace(/^~(?=[/\\]|$)/, homedir())
    // `~+` 는 셸의 **지금 폴더**(PWD)라 `.` 과 같다. (`~-` 는 어디인지 모르는 자리라 풀 값이 없어
    // 경로낱말·checkPaths 가 따로 본다.)
    .replace(/^~\+(?=[/\\]|$)/, '.')
    /*
     * `$PWD` · `%CD%` 도 **지금 폴더**다(셸은 작업 폴더에서 뜬다). 경로낱말() 은 자리표가 든 낱말을
     * 「못 푼 것」 으로 보고 자리 검사를 건너뛰므로, 값을 아는데도 안 풀면 `rm -rf $PWD/../옆프로젝트` ·
     * `rd /s /q %CD%\..` 가 새어 나간다(`rm -rf ../옆프로젝트` 는 막히는데).
     *
     * 파워셸은 이름의 크기를 안 가려서(`$pwd`) 크기를 안 본다. 따옴표에 싼 `$(pwd)` 도 같은 값이다
     * (안 싼 것은 괄호에서 잘려 `/../x` 가 절대경로로 걸린다). `$pwd.Path` · `$pwd.ProviderPath`,
     * 링크를 푼 `$(pwd -P)`, 옛 꼴 `` `pwd` `` 도 같은 자리다.
     */
    .replace(/^(?:\$\{PWD\}|\$PWD(?:\.(?:Provider)?Path)?|%CD%|\$\(pwd(?:\s+-[LP])?\)|`pwd(?:\s+-[LP])?`)(?=[/\\]|$)/i, '.')
    // `$OLDPWD` 는 `~-` 와 같은 자리(이전 폴더)다 — 어디인지 모르니 `~-` 로 바꿔 같은 길로 막는다.
    .replace(/^(?:\$\{OLDPWD\}|\$OLDPWD)(?=[/\\]|$)/i, '~-')
    /*
     * `~이름` 은 **그 사람의 집**이다. 안 풀면 `cat ~admin/.ssh/id_rsa` 의 `~admin/…` 이 글자 그대로
     * 남아 scope.resolve 가 작업 폴더 **아래** `./~admin/…` 로 읽고 범위 안이라고 한다.
     *
     * 정확한 위치는 여기서 모른다(passwd 를 안 읽는다). 대신 **내 집 옆자리**(`/home/admin` ·
     * `C:\Users\admin`)로 푼다 — 울타리가 물을 것은 「작업 폴더 밖인가」 하나이고 남의 집은 어느
     * 쪽으로 풀든 밖이다. 이름은 글자·밑줄로 시작할 때만 받는다(`~1` · `~+` 은 셸의 다른 뜻). 가운데
     * 물결(`./~backup` · `PROGRA~1`)은 `^` 에 안 닿는다.
     */
    .replace(/^~([A-Za-z_][\w.-]*)(?=[/\\]|$)/, (전체, 이름) => 남의집(이름))
    /*
     * 파워셸은 `$env:이름` 으로 적는다. 안 풀면 경로낱말() 이 「못 푼 자리표」 로 보고 낱말을
     * **통째로 건너뛰어** 윈도우에서 `pwsh -Command "Get-Content $env:USERPROFILE\.deel\config.json"`
     * 이 울타리를 지나간다. 우리가 모르는 이름이면 안 건드린다 — 아래에서 「못 푼 것」 으로 걸러진다.
     */
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/g, (전체, 이름) => {
      const v = process.env[이름] ?? process.env[String(이름).toUpperCase()];
      return typeof v === 'string' && v ? v : 전체;
    })
    /*
     * 자리표 이름은 **낱말째** 끝나야 한다. 경계를 안 보면 `$HOME_DIR` · `$HOMEPATH` ·
     * `$USERPROFILE_BAK` 처럼 셸에서 전혀 다른 변수의 앞머리를 먹어 「범위 밖」 거짓 경고가 난다.
     * 우리가 값을 모르는 변수는 아래에서 「못 푼 자리표」 로 걸러져 낱말째 건너뛴다는 약속이 있는데,
     * 반쯤 풀면 **아는 척**이 된다. 중괄호 꼴(`${HOME}`)은 제 닫는 괄호가 경계다.
     */
    // 낱말 경계는 **글자 전부**로 본다 — `\w` 는 아스키뿐이라 `$HOME한글` 의 `$HOME` 을 먹는다.
    // 파워셸은 한글 변수 이름을 받는다.
    .replace(/\$\{HOME\}|\$HOME(?![\p{L}\p{N}_])|%USERPROFILE%|\$\{USERPROFILE\}|\$USERPROFILE(?![\p{L}\p{N}_])/giu, homedir());
}

/**
 * 이 낱말은 경로가 아니라 **코드 조각**인가.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 *
 * 여기 오는 것은 셸 명령줄인데 모델은 그 안에 자바스크립트를 통째로 넣는다(`node -e "…"` ·
 * `node - <<'NODE'`). 코드 안의 슬래시가 전부 경로로 보여, 정규식 리터럴
 * (`/data:image\/[\s\S]*?base64,…/g`)이나 `</div>` 가 잘려 온 `/div` 때문에 파일과 아무 상관없는
 * 명령 **전체**가 거절된다. 모델은 왜 막혔는지 모르니 따옴표만 바꿔 가며 여러 번 다시 시도한다.
 *
 * ── 울타리를 얼마나 무르게 하나 ─────────────────────────────────────────
 *
 * 여기서 넘긴 낱말은 검사를 안 받으므로 기준을 좁게 잡는다. **실수로 밖을 건드리는** 경로는
 * `/Users/남/것` 처럼 평범하게 생겼지 정규식 메타문자나 따옴표를 달고 오지 않는다. 일부러 뚫으려는
 * 사람은 이 검사가 있든 없든 `cd ..` 나 `$(…)` 로 지나간다 — 이건 사고를 막는 턱이지 봉인이
 * 아니다(파일 도구 쪽 울타리는 그대로다). 글로브(`*` `?`)는 일부러 안 넘긴다 — `rm /Users/남/*`
 * 은 진짜 경로이고 계속 걸려야 한다.
 */
/** 그 이름에 무엇이 놓였나. 가리키는 곳이 없는 링크도 놓인 것이다. 못 물어보면 놓였다고 친다. */
export function 놓였나(경로) {
  try { lstatSync(경로); return true; } catch (e) { return !(e?.code === 'ENOENT' || e?.code === 'ENOTDIR'); }
}

export function 코드조각인가(낱말) {
  // 따옴표가 낱말 **안**에 섞였다 = 코드를 가운데서 자른 것이다.
  // 파일 이름에 따옴표를 쓰는 사람은 없다시피 하고, 있어도 셸에서 못 쓴다.
  if (/["'`]/.test(낱말)) return true;

  // `/` 로 시작하는데 정규식 메타문자가 들어 있다 = 정규식 리터럴.
  // 진짜 경로에는 이런 글자가 거의 안 들어간다.
  if (낱말.startsWith('/') && /[\\[\](){}|^$+]/.test(낱말)) return true;

  /*
   * 빗금만 남은 조각. `s.replace(/<\/div>/g, '')` 한 줄이 `/` · `\/div` · `/g,` 셋으로 잘리고(낱말
   * 나누기가 `<` `>` 를 경계로 쓴다) 그중 `/` 가 뿌리 폴더로 풀려 명령 전체가 거절된다. 뿌리를
   * 통째로 미는 명령은 여기 몫이 아니다 — `rm -rf /` 는 checkCommand 의 BLOCKED 가 따로 잡는다.
   *
   * `//` · `///` 도 계속 넘긴다. 빗금 두 자를 경로로 치면 heredoc 으로 넣은 코드의 `// 주석` 이
   * 낱말로 잘려 와 **뿌리 = 범위 밖** 이 되고 코드를 넣는 명령이 전부 막힌다(`rm -rf //` 는
   * 뿌리목표 가 잡는다).
   */
  if (/^[/\\]+$/.test(낱말)) return true;
  // 빗금을 백슬래시로 흘린 것(`\/div`)도 정규식이지 경로가 아니다.
  if (낱말.includes('\\/')) return true;

  /*
   * 한 마디짜리 절대 경로(`/div`)는 **디스크에 있을 때만** 본다. `</div>` `<br/>` 같은 태그가 잘려
   * 오면 이 꼴이 되고 그런 이름의 최상위 폴더는 없다. `/tmp` `/etc` 는 실제로 있으므로 검사한다.
   * 없다고 다 넘기면 `mkdir /남의것` 이 지나가지만 그건 변경성 명령이라 checkCommand 가 잡는다.
   */
  if (/^\/[^/\\]+$/.test(낱말)) {
    /*
     * 못 물어봤으면 **경로로 친다.** `true` 는 「코드 조각이다」 곧 울타리 검사를 **안 받는다**는
     * 뜻이라 디스크에 못 물어본 것을 열어 주는 쪽이 된다. 두 실수의 값이 다르다 — 코드 조각을
     * 경로로 잘못 보면 멀쩡한 명령이 한 번 막히고 사람이 다시 치지만, 경로를 코드 조각으로 잘못
     * 보면 울타리가 없는 것과 같고 아무 표시도 안 난다. 모를 때는 좁은 쪽으로 간다.
     *
     * 「있다」 는 **그 이름에 무엇이 놓였나**로 잰다(lstat). existsSync 는 링크를 따라가서 가리키는
     * 곳이 없는 링크(맥 뿌리의 `/.VolumeIcon.icns`)를 「없다」 고 한다. 없다는 답(ENOENT·ENOTDIR)만
     * 「없다」 고, 못 물어본 것은 경로로 친다.
     */
    return !놓였나(낱말);
  }
  return false;
}

/*
 * ── 울타리 밖이지만 막을 까닭이 없는 자리 ───────────────────────────────
 *
 * 울타리는 **사람의 자료**를 지키려고 있다. 자료가 아닌 두 가지가 같이 막히면 모델이 할 수 있는
 * 일을 못 한다.
 *
 *   ▶ Bash(soffice --convert-to txt 보고서.pptx > /dev/null 2>&1)   └ 막힘: /dev/null
 *   ▶ Bash(ls -l /usr/bin/strings)                                  └ 막힘: /usr/bin/strings
 *
 * 앞엣것은 **아무것도 저장되지 않는 자리**다(`2>/dev/null` 은 셸 명령 절반이 달고 다닌다).
 * 뒤엣것은 **이 PC 에 무엇이 깔렸는지 보는 것**이다 — 못 보면 모델은 변환기가 있는지조차
 * 확인할 수 없어 같은 문을 계속 두드린다.
 *
 * **넓히는 것은 이 둘뿐이다.** 남의 홈 · /etc · /var · /tmp 는 그대로 막는다. 프로그램이 든 폴더는
 * 자료가 아니고, 거기 쓰는 것은 어차피 OS 가 막는다.
 */
const 버리는자리 = new Set([
  '/dev/null', '/dev/stdout', '/dev/stderr', '/dev/tty',
  // 윈도우. `\\.\nul` 은 여기 안 적는다 — 아래 봐주는자리() 가 역빗금을
  // 빗금으로 바꾼 뒤에 견주므로 이 철자는 **한 번도 안 맞는다.** 그 꼴은
  // 장치 이름 공간 껍데기를 벗겨 `nul` 로 만들어 이 줄에 닿게 한다.
  'nul', 'nul:',
]);

/**
 * 프로그램이 사는 자리. 자료가 아니라 실행파일이다.
 *
 * **전부 소문자로 적는다** — 견줄 때 소문자로 낮춰서 보기 때문이다.
 * `/Applications` 처럼 대문자를 섞어 적으면 그 줄만 조용히 안 걸린다.
 */
/** 안에 폴더를 더 두는 자리. 여기만 깊이를 안 따진다. */
const 꾸러미자리 = new Set(['/applications', 'c:/program files', 'c:/program files (x86)']);

const 프로그램자리 = [
  '/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/libexec',
  '/usr/local/bin', '/usr/local/sbin',
  '/opt/homebrew/bin', '/opt/homebrew/sbin', '/opt/local/bin',
  '/snap/bin', '/applications',           // 맥은 앱 꾸러미 안에 실행파일이 있다
  /*
   * 윈도우는 **실행파일 폴더만** 적는다. `'c:/windows'` 한 줄이면 `System32/drivers/etc/hosts`,
   * `win.ini`, `System32/config`(레지스트리 하이브), 누구나 쓸 수 있는 `C:/Windows/Temp` 가 전부
   * 그 안이다. 이 목록에 걸리면 checkPaths 가 그 낱말을 **통째로 건너뛰므로**(continue) 울타리가
   * 없는 것과 같다. 유닉스의 `/bin`·`/usr/bin` 은 실행파일만 든 폴더라 이 문제가 없다.
   */
  'c:/windows/system32', 'c:/windows/syswow64',
  'c:/program files', 'c:/program files (x86)',
];

/*
 * ── 목록에 없는 자리에 사는 node ─────────────────────────
 *
 * 위 목록은 **OS 가 깔아 준 자리**만 적는다. 요즘 node 는 거기 안 산다 — nvm 은
 * `~/.nvm/versions/node/v22.14.0/bin`, fnm·volta·asdf 는 저마다 다른 자리, 깃허브 러너는
 * `/opt/hostedtoolcache/node/24.20.0/x64/bin` 이다. 그래서 `node x.js` 는 돌고
 * `/opt/hostedtoolcache/node/24.20.0/x64/bin/node x.js` 는 「작업 범위 밖입니다」 가 된다 —
 * 같은 파일인데 **거짓 경고**다.
 *
 * 자리를 하나씩 적으면 다음 도구가 나올 때 또 샌다. 그래서 **지금 우리를 돌리고 있는 그 node 의
 * 폴더**를 받는다. 거기에 프로그램이 있다는 것은 우리가 거기서 떴으니 참이다. 깊이는 나머지와 같은
 * 한 칸이라 `bin/node`·`bin/npm`·`bin/npx` 까지고, 뿌리(`/` · `c:/`)로 나오면 안 쓴다 — 온
 * 디스크를 여는 것이다.
 */
function 나를돌린자리() {
  let p;
  try { p = dirname(process.execPath); } catch { return null; }
  if (!p) return null;
  const 낮춤 = p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
  if (!낮춤 || 낮춤 === '' || /^[a-z]:$/.test(낮춤)) return null;
  return 낮춤;
}

/**
 * 이 경로는 울타리를 안 물어도 되는 자리인가.
 *
 * @returns {string|null} 봐 주는 까닭. 아니면 null
 */
/*
 * `.` 과 `..` 를 펴서 견줄 수 있는 꼴로 만든다.
 *
 * ── 왜 여기서 펴야 하나 ────────────────────────────────────────────────
 *
 * 아래 봐주는자리() 는 **글자 앞머리**로 견준다. checkPaths 는 **날 낱말**을 그대로 넘기고
 * (`봐주는자리(t)`), 걸리면 `continue` 로 울타리 검사를 통째로 건너뛴다. 안 펴면 이것들이 다
 * 통과한다 —
 *
 *     type "C:\Program Files\..\..\Users\나\.deel\config.json"
 *     cat "C:/Program Files (x86)/../../Users/나/.ssh/id_rsa"
 *     cat /Applications/../Users/나/.ssh/id_rsa
 *
 * 꾸러미자리(`Program Files`·`Applications`)는 깊이를 안 보므로 그 아래로 **무한정** 열린다.
 * 건너뛰기는 `continue` 라 「이 낱말은 안 봤습니다」 를 적는 자리가 없다 — 열쇠가 든 config.json
 * 이 그대로 읽혀 대화에 실리고 `.deel/sessions/*.jsonl` 에 남는다.
 *
 * 폄은 글자로 한다. 봐주는자리는 없는 경로에도 답해야 하고, 존재를 물으면 답이 기계마다 달라진다.
 */
function 점펴기(p) {
  const 조각 = p.split('/');
  const out = [];
  for (const s of 조각) {
    if (s === '.') continue;
    // 맨 앞 조각은 뿌리 표시(`` 나 `c:`)라 남긴다. 그 위로는 못 올라간다.
    if (s === '..') { if (out.length > 1) out.pop(); continue; }
    out.push(s);
  }
  return out.join('/');
}

export function 봐주는자리(경로) {
  const 빗금 = String(경로 ?? '').replace(/\\/g, '/');
  /*
   * `\\.\nul` 은 윈도우의 **장치 이름 공간**이다. 역빗금을 빗금으로 바꾸면 `//./nul` 인데 점펴기 가
   * 가운데 `.` 을 「지금 폴더」 로 읽어 지워 `//nul` 이 되므로 `nul` 에 닿지 못한다. 그래서 껍데기만
   * 벗기고 **안은 그대로 본다.** `\\.\C:\Users\남\.deel` 은 벗겨도 `c:/users/남/.deel` 이라 어느
   * 목록에도 안 걸리고 울타리 검사를 받는다 — 여는 길이 아니다.
   */
  const 장치 = /^\/\/\.\/(.+)$/.exec(빗금);
  const p = 점펴기(장치 ? 장치[1] : 빗금);
  const 낮춤 = p.toLowerCase().replace(/\/+$/, '');
  if (버리는자리.has(낮춤)) return '아무것도 저장되지 않는 자리';
  // 한 칸 아래까지만 본다 (깊이는 아래).
  const 내자리 = 나를돌린자리();
  for (const 자리 of (내자리 && !프로그램자리.includes(내자리) ? [...프로그램자리, 내자리] : 프로그램자리)) {
    if (낮춤 === 자리) return '프로그램이 있는 자리';
    if (!낮춤.startsWith(`${자리}/`)) continue;
    /*
     * **얼마나 깊이까지** 봐주나. 실행파일은 폴더에 **바로** 놓이므로(`/usr/bin/strings`,
     * `system32/cmd.exe`) 기본은 한 칸이다. 깊이를 안 보면 `c:/windows/system32` 를 넣는 순간 그
     * 아래 `drivers/etc/hosts`(그물 설정)와 `config`(레지스트리 하이브)가 통째로 열린다.
     *
     * 꾸러미 자리는 다르다. 맥 앱은 `/Applications/X.app/Contents/MacOS/x`, 윈도우 프로그램은
     * `C:/Program Files/Git/bin/git.exe` 라 한 칸으로 자르면 멀쩡한 명령이 막힌다.
     */
    const 나머지 = 낮춤.slice(자리.length + 1);
    if (꾸러미자리.has(자리) || !나머지.includes('/')) return '프로그램이 있는 자리';
  }
  return null;
}

// 값이 경로가 아니라 **글**인 긴 옵션. 아래 경로낱말() 이 `--이름=값` 의 값을 떼어 볼 때 뺀다
// (`git commit --message=../notes` · `git log --format=%h/%s`). curl 의 `--data=@파일` 은 파일을 읽으니 안 뺀다.
const 글받는옵션 = /^(?:message|format|pretty|title|body|subject|description|grep|author|committer|label|comment|notes?)$/i;

/*
 * ── 빗금 없는 `..` 도 자리다 ────────────────────────────────────────────
 *
 * 빗금이 든 낱말과 드라이브 한 칸(`C:`)만 자리로 치면 **부모 폴더 그 자체**가 후보에도 못 든다.
 * 기본(auto) 모드에서는 셸 명령을 안 묻고 이 울타리가 마지막 문인데 `find .. -delete` ·
 * `rd /s /q ..` · `Remove-Item -Recurse ..` · `git -C .. clean -fdx` 는 작업 폴더의 부모를
 * 통째로 민다. `tar czf o.tgz ..` 는 작업 폴더가 집 바로 밑이면 ~/.ssh 까지 묶어 읽는다. GNU rm
 * 은 `..` 를 스스로 거절해서 안 보였을 뿐이다. 드라이브의 **지금 폴더 기준** 꼴(`C:..` · `C:.`)도
 * 같다 — 윈도에서 `C:..` 는 그 드라이브의 지금 폴더의 부모다.
 *
 * `..` 가 **가운데** 든 것(`HEAD..main` · `{1..5}`)은 부모가 아니다. 낱말 **전체**가 `..` 일 때만.
 */
function 자리꼴인가(s) {
  return s.includes('/') || s.includes('\\') || s === '..' || /^[a-zA-Z]:(?:\.{1,2})?$/.test(s);
}

/** 명령줄에서 경로처럼 보이는 낱말만 골라낸다. */
export function 경로낱말(cmd) {
  const out = [];
  // 따옴표 안은 통째로 한 낱말, 밖은 공백과 셸 기호로 자른다.
  const re = /"([^"]*)"|'([^']*)'|[^\s|;&<>()]+/g;
  let m;
  while ((m = re.exec(cmd))) {
    let t = m[1] ?? m[2] ?? m[0];
    if (!t) continue;
    /*
     * 이름 뒤에 붙은 경로는 값만 떼어 본다. 옵션을 통째로 넘기면 `cat .deel/config.json` 은 막히는데
     * `dd if=.deel/config.json` · `tar --directory=/etc` · `cp --target-directory=/etc` 는 같은 자리인데
     * 지나간다. 긴 옵션의 값과 dd 의 `if=` · `of=` 만 뗀다. 아무 `이름=값` 이나 떼면
     * `NODE_PATH=/usr/lib/node npm test` 같은 환경변수 앞머리가 범위 밖으로 막힌다.
     */
    const 붙은값 = /^--([A-Za-z][\w-]*)=(.+)$/.exec(t) ?? /^(if|of)=(.+)$/.exec(t);
    if (붙은값) {
      if (글받는옵션.test(붙은값[1])) continue;        // `--message=../notes` 는 글이다
      /*
       * 따옴표는 **전부** 뗀다. 위 낱말 자르개는 `"` 로 **시작하는** 것만 한 낱말로 묶으므로
       * `dd if="../secret.txt"` · `tar --directory="/남의것"` 은 값에 따옴표가 남아 `..` 이 안 풀린다
       * (셸에서는 같은 파일이다). 바깥 한 쌍만 떼면 `tar --directory=../".."` 처럼 반만 감싼 것이
       * 지나간다 — checkCommand 도 규칙을 따옴표 뺀 판에 한 번 더 먹인다(위 따옴표뺀).
       */
      t = 붙은값[2].replace(/["'`]/g, '');
    }
    // 컨테이너 볼륨 `./x:/app` — 콜론 뒤는 컨테이너 **안** 자리라 이 PC 쪽(앞)만 본다.
    // 주소(`https://`)·`file:` 과 드라이브(`C:/` · `\\?\C:/`)는 건드리지 않는다 — 아래가 따로 본다.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && !/^file:/i.test(t)) {
      const 볼륨 = /^([^:]{2,}):\/[^:]*(?::[a-z,]+)?$/i.exec(t);
      if (볼륨 && !/^[\\/]{2}[?.][\\/][A-Za-z]$/.test(볼륨[1])) t = 볼륨[1];
    }
    if (t.startsWith('-')) continue;                 // 옵션
    /*
     * 주소는 이 울타리가 볼 것이 아니다 — 그물로 나가는 것은 safety/network.js 가 본다. 딱 하나
     * **`file:` 만 빼고**: 그건 주소 꼴로 적은 이 PC 의 경로다(`curl.exe file:///C:/Users/…/.deel/config.json`).
     * 경로로 되돌려 아래 검사를 그대로 받게 한다.
     */
    if (/^file:/i.test(t)) {
      t = t.replace(/^file:(\/\/)?(localhost)?/i, '');
      // `file:///C:/…` 는 빗금이 하나 남는다. 드라이브 앞의 그것만 떼어 낸다.
      t = t.replace(/^\/(?=[a-zA-Z]:)/, '');
      try { t = decodeURIComponent(t); } catch { /* 못 풀면 적힌 그대로 본다 */ }
      if (!t) continue;
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
      continue;                                       // 주소(http://, ftp:// …)
    }
    // 리디렉션이 붙어 온 것(>out.txt)은 기호를 떼고 본다.
    t = t.replace(/^[<>]+/, '');
    if (!t) continue;
    const 풀린 = 자리표풀기(t);
    /*
     * ── 맨 낱말 `.deel` 도 자리로 친다 ──────────────────────────────────
     *
     * `/` 나 `\` 가 있어야 「자리」 로 치면 `rm -rf .deel` 은 후보로도 안 잡힌다(`rm -rf .deel/history`
     * 는 막히는데). checkPaths 는 이 목록 안에서만 내부살림() 을 부르므로 내부살림 을 고쳐도 소용
     * 없다. 이 이름 하나만 예외로 두되 **품고 있는 것이 아니라 그 이름 자체**일 때만이다 —
     * `.deelignore` · `my.deel.txt` 는 남의 파일이고, 넓히다 반대로 베면 모델이 까닭 없이 무언가를
     * 못 하게 되는데 신고해 줄 사람이 없다.
     */
    // `~-` 는 셸의 **이전 폴더**(OLDPWD)다. deel 을 띄우기 전에 어디 있었는지 우리는 모르고 작업 범위
    // 밖일 수 있다. 안 풀면 `./~-` 로 읽혀 `rm -rf ~-` 가 통과하므로, 빗금이 없어도 자리로 올려 checkPaths
    // 가 밖으로 막게 한다.
    if (/^~-(?=[/\\]|$)/.test(풀린)) { out.push(풀린); continue; }
    const 살림이름 = 풀린 === '.deel' || 풀린.toLowerCase() === '.deel';
    const 경로같나 = 자리꼴인가(풀린) || 살림이름;
    if (!경로같나) continue;
    /*
     * 남은 자리표가 있으면(우리가 못 푼 것) **어디로 갈지 모른다** — 울타리(범위 밖인가)는 못 묻고,
     * 억지로 풀면 엉뚱한 자리를 막는다. 그래도 살림은 자리가 아니라 이름으로도 알아본다
     * (`…/.deel/config.json`). 그래서 못 푼 것은 **이름 검사만** 받고 자리 검사는 건너뛴다. 걸리면
     * checkPaths 가 내부살림() 으로 막는다.
     */
    if (/[$%]/.test(풀린)) {
      if (내부살림(풀린)) out.push(풀린);
      continue;
    }
    if (코드조각인가(풀린)) continue;
    out.push(풀린);
  }
  /*
   * ── 낱말 **가운데** 따옴표를 두르면 울타리가 통째로 비켰다 ────────────
   *
   * 코드조각인가() 는 따옴표가 낱말 안에 섞이면 「코드를 가운데서 자른 것」 으로 보고 후보에서 뺀다.
   * 근거는 「파일 이름에 따옴표를 쓰는 사람은 없다」 인데 여기서 보는 것은 **셸에 적힌 낱말**이고,
   * 셸에서는 `cat ../../secret.txt` · `cat ../../'secret.txt'` · `cat ../../secret".txt"` 가 같은
   * 파일이다. 통째로 두른 것만 위 낱말 나누기가 벗기고 가운데만 두른 것은 검사를 안 받는다.
   *
   * 그래서 따옴표를 **뗀 꼴도 후보에 넣는다.** checkCommand 와 같은 방법이라 막는 쪽으로만
   * 늘어난다. 뗐더니 아무것도 안 남거나 여전히 코드 조각이면 안 들어간다.
   */
  for (const m of String(cmd).matchAll(/"([^"]*)"|'([^']*)'|[^\s|;&<>()]+/g)) {
    // 통째로 두른 것은 위 낱말 나누기가 이미 벗겨서 봤다. 여기서 또 보면 `"C:/Program Files/Git/bin/git.exe"`
    // 가 빈칸에서 잘려 `C:/Program` 이 범위 밖으로 읽힌다.
    if (m[1] !== undefined || m[2] !== undefined) continue;
    const 날것 = m[0];
    if (!/["'`]/.test(날것)) continue;                     // 따옴표가 없으면 위에서 이미 봤다
    const 뗀것 = 자리표풀기(날것.replace(/["'`]/g, ''));
    if (!뗀것 || 뗀것.startsWith('-')) continue;
    if (!자리꼴인가(뗀것)) continue;
    if (/[$%]/.test(뗀것)) { if (내부살림(뗀것)) out.push(뗀것); continue; }
    if (코드조각인가(뗀것)) continue;
    if (!out.includes(뗀것)) out.push(뗀것);
  }
  return out;
}

/*
 * ── 폴더를 옮기면 그 뒤로는 볼 글자가 없다 ─────────────────────────────
 *
 * 위 경로낱말() 은 **경로처럼 생긴 것**만 고른다. `cd .deel` 다음에 오는 `config.json` 은 낱말
 * 후보로도 안 뽑혀 아무 검사도 못 받는다 — `type .deel\config.json` 은 막히는데
 * `cd .deel && type config.json` 은 읽힌다. 같은 파일에 한 줄은 막고 한 줄은 통과하면 시스템
 * 프롬프트와 화면의 「막혀 있다」 가 거짓이 된다(checkPaths 머리말과 같은 까닭).
 *
 * 그래서 **들어가는 것 자체**를 위반으로 본다. 들어간 뒤에는 우리가 볼 수 있는 글자가 남지
 * 않아 거기서 막을 방법이 없다. 넓히지는 않는다 — 모델이 하는 일의 절반이 `cd 하위폴더 && 무엇`
 * 이라 안에서 도는 cd 는 전부 그대로 돈다.
 */
const 폴더옮김 = /^(cd|chdir|pushd|sl|set-location|push-location)$/i;
const 되돌리기 = /^(popd|pop-location)$/i;
/** 셸을 한 겹 씌워 부르는 것들. 안 들여다보면 `sh -c "cd .deel …"` 로 그냥 지나간다. */
const 셸꼴 = /^(?:.*[/\\])?(bash|sh|zsh|dash|ksh|fish|cmd|powershell|pwsh)(\.exe)?$/i;

/** 명령을 실행 단위로 자른다. 따옴표 안의 `;` 는 글자지 이음매가 아니다. */
function 마디들(cmd) {
  const 마디 = [];
  let 지금 = '';
  let 따옴 = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (따옴) { 지금 += c; if (c === 따옴) 따옴 = null; continue; }
    if (c === '"' || c === "'") { 따옴 = c; 지금 += c; continue; }
    if (c === '\n' || c === ';') { 마디.push(지금); 지금 = ''; continue; }
    if (c === '&' || c === '|') {
      마디.push(지금); 지금 = '';
      if (cmd[i + 1] === c) i++;          // && · ||
      continue;
    }
    지금 += c;
  }
  마디.push(지금);
  return 마디;
}

/** 한 마디를 낱말로. 따옴표는 벗기되, 벗겼다는 것은 남긴다(셸 한 겹을 알아보려고). */
function 낱말들(마디) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let m;
  while ((m = re.exec(마디))) {
    const 안 = m[1] ?? m[2];
    out.push({ 글: 안 ?? m[0], 쌌나: 안 != null });
  }
  return out;
}

/**
 * cd 가 어디로 가라는 것인가. 모르면 null — 모르는 것을 막으면 안 된다.
 *
 * 옵션은 건너뛴다: 파워셸의 `-Path`·`-LiteralPath`, 윈도우 cmd 의 `/d`.
 * `/d` 만 콕 집어 본다 — `/etc` 도 빗금으로 시작하지만 그건 진짜 갈 자리다.
 */
function 갈자리(뒤) {
  for (const w of 뒤) {
    if (!w.글) continue;
    // `-` 하나는 옵션이 아니라 이전 폴더다. 옵션으로 건너뛰면 `cd - && rm -rf *` 가 안 보인다.
    if (w.글.startsWith('-') && w.글 !== '-') continue;
    if (/^\/d$/i.test(w.글)) continue;
    return w.글;
  }
  return null;
}

/**
 * 폴더를 옮기는 명령을 따라가며, 옮겨 간 자리가 울타리 안인지 본다.
 *
 * @returns {Map<string, number>} 여기서 이미 본 cd 목적지와 그 횟수. 부르는 쪽은 그만큼은
 *   두 번 보지 않는다 — 뿌리 기준으로 다시 풀면 `cd src/a && cd ../..` 가 밖이 된다.
 */
function 폴더옮김검사(cmd, scope, 시작 = null, 깊이 = 0, 본것 = new Map()) {
  let 여기 = 시작 ?? scope.root;
  const 쌓은것 = [];
  // 이 명령 안에서 cd 로 떠나온 자리. `cd -` 가 가는 곳이다 — 없으면 셸이 물려받은 OLDPWD 라 모른다.
  let 이전 = null;
  // 어디인지 모르는 자리로 옮겼으면 그 적은 글자(`-` · `~-` · `$OLDPWD`). 뒤에 명령이 오면 막는다.
  let 모르는자리 = null;
  for (const 마디 of 마디들(cmd)) {
    const 낱말 = 낱말들(마디);
    if (!낱말.length) continue;
    if (모르는자리 != null) {
      throw new ScopeError(`\`cd ${모르는자리}\` 는 셸의 이전 폴더(OLDPWD)로 가는데 어디인지 알 수 없어, 그 뒤 명령을 작업 범위 밖에서 도는 것으로 봅니다`
        + `\n  이 명령 안에 있습니다: ${cmd.slice(0, 120)}`);
    }
    /*
     * ── cmd 에서 `cd..` 는 `cd ..` 다 ────────────────────────────
     *
     * cmd.exe 는 빈칸을 안 요구한다 — `cd..` · `cd..\..` · `chdir..` 이 `cd ..` 와 같은 일을 한다.
     * 첫 낱말이 **딱** `cd` 일 때만 보면 `cd.. && type secret.txt` 가 빈칸 한 칸 차이로 지나간다.
     * `/d` 스위치가 붙어 오는 것(`cd/d ..`)도 같이 편다. `cdk synth` 처럼 `cd` 로 **시작만** 하는
     * 다른 명령은 안 삼키도록 뒤에 올 수 있는 것을 `/d` 와 점으로만 못박았다.
     */
    const 붙은첫 = /^(cd|chdir|pushd)(?:\/d)?(\.[.\\/]*)?$/i.exec(낱말[0].글);
    const 첫 = 붙은첫 ? 붙은첫[1] : 낱말[0].글;
    /*
     * 뒤꽁무니의 역빗금은 **여기서 눕힌다.** `cd..\..` 는 cmd 의 철자라 칸막이가 `\` 로 온다.
     * 윈도우에서는 resolve 가 칸막이로 읽어 두 칸 위로 가지만 리눅스·맥에서는 `..\..` 가 **한 칸짜리
     * 폴더 이름**이라 제자리에 머문다 — 같은 글자가 판에 따라 다른 뜻이 되어 울타리가 한쪽에서만
     * 선다. 위 무늬가 이 조각을 점과 빗금으로만 못박아 뒀으니 진짜 파일 이름을 다칠 일은 없다.
     */
    const 붙은목적 = 붙은첫?.[2] ? 붙은첫[2].replace(/\\/g, '/') : null;

    // 셸을 한 겹 씌운 것은 안을 들여다본다. 그 안의 cd 는 딴 살림이라
    // (하위 셸이다) 우리 자리는 안 바뀐다 — 결과만 받고 여기는 그대로 둔다.
    if (깊이 < 2 && 셸꼴.test(첫)) {
      for (const w of 낱말.slice(1)) if (w.쌌나) 폴더옮김검사(w.글, scope, 여기, 깊이 + 1, 본것);
      continue;
    }
    if (되돌리기.test(첫)) {
      const 꺼낸 = 쌓은것.pop();
      if (꺼낸 != null) { 이전 = 여기; 여기 = 꺼낸; }
      continue;
    }
    if (!폴더옮김.test(첫)) continue;

    const 목적 = 붙은목적 ?? 갈자리(낱말.slice(1));
    // 인자 없는 cd 는 셸마다 뜻이 다르다(bash 는 집 · cmd 는 지금 자리를 찍기만). 모르는 것을
    // 막으면 멀쩡한 명령이 죽는다.
    if (목적 == null) continue;
    const 풀린 = 자리표풀기(목적);
    /*
     * ── `cd -` · `cd ~-` · `cd $OLDPWD` 는 이전 폴더로 간다 ─────────────────
     *
     * 이 명령 안에서 먼저 옮겼으면 그 떠나온 자리다 — `cd src && make && cd -` 는 뿌리로 돌아온다.
     * 먼저 옮긴 적이 없으면 셸이 물려받은 OLDPWD 라 어디인지 모른다. `cd - && rm -rf *` 가 지나가지
     * 않게 그 **뒤에 오는 명령**을 밖에서 도는 것으로 본다 — `cd -` 하나만 있는 것은 옮기고 끝이라
     * 그대로 둔다(아래 모르는자리). 그 **아래**(`cd ~-/sub` · `cd $OLDPWD/sub`)도 같은 자리에서
     * 시작한다 — `^~-$` 로 딱 그 꼴만 보면 작업 폴더 밑의 `./~-/sub` 로 읽혀 지나간다.
     */
    const 이전아래 = /^~-(?=[/\\]|$)/.test(풀린);
    if (목적 === '-' || 이전아래) {
      // 경로낱말 은 `~-`(· `$OLDPWD`)를 밖으로 올린다. 여기서 풀어 준 것은 checkPaths 가 한 번 비킨다.
      본것.set(풀린, (본것.get(풀린) ?? 0) + 1);
      if (이전 == null) { 모르는자리 = 목적; continue; }
      if (목적 === '-' || 풀린 === '~-') { [여기, 이전] = [이전, 여기]; continue; }
      // 이전 폴더 아래로 — 아래의 범위 검사를 그대로 받는다.
    }
    // 못 푼 자리표가 남아 있으면(`$BUILD_DIR`) 역시 어디로 갈지 모른다.
    if (/[$%]/.test(풀린)) continue;

    const 열린 = MSYS풀기(이전아래 ? 풀린.replace(/^~-[/\\]*/, '') : 풀린);
    const abs = isAbsolute(열린) ? resolve(열린) : resolve(이전아래 ? 이전 : 여기, 열린);
    /*
     * 비킬 낱말로 적는 것은 **따로 선 목적지**뿐이다. `cd..` 처럼 붙여 쓴 것은 경로낱말 에 `..` 로 안
     * 나오므로, 적어 두면 남은 한 번이 뒤의 딴 `..` 를 비켜 준다 — `cd src && cd.. && find .. -delete`.
     * 이전아래 는 위에서 이미 적었다.
     */
    if (!붙은목적 && !이전아래) 본것.set(풀린, (본것.get(풀린) ?? 0) + 1);

    // 프로그램이 있는 자리로 들어가는 것은 자료를 만지는 일이 아니다.
    // 푼 값이 아니라 **적힌 글자**로 본다 — 윈도우에서 resolve('/usr/bin') 은
    // `C:\usr\bin` 이 되어 목록에 안 걸린다 (checkPaths 도 낱말로 본다).
    if (봐주는자리(풀린)) { 이전 = 여기; 여기 = abs; continue; }
    try { scope.resolve(abs); }
    catch (e) {
      if (e instanceof ScopeError) {
        throw new ScopeError(`${e.message}\n  이 명령 안에 있습니다: ${cmd.slice(0, 120)}`);
      }
      throw e;
    }
    // `.deel` 폴더 자신은 내부살림() 이 안 잡는다 — 그건 그 **안의 파일**을
    // 보는 검사다. 여기서는 폴더에 발을 들이는 것이 곧 위반이다.
    const 조각 = abs.replace(/\\/g, '/').split('/');
    const 이유 = 조각.includes('.deel')
      ? 'deel 자신의 살림 폴더입니다. 그 안에 게이트웨이 열쇠가 든 config.json 이 있어'
        + ' 들어가지 않습니다 — 들어가면 뒤 명령이 맨 이름만으로 그 파일에 닿습니다.'
        + ' 연결 상태가 궁금하면 사용자에게 /status 를 쳐 보라고 하세요.'
      : 내부살림(abs);
    if (이유) throw new BlockedError(`${이유}\n  이 명령 안에 있습니다: ${cmd.slice(0, 120)}`);

    if (/^(pushd|push-location)$/i.test(첫)) 쌓은것.push(여기);
    이전 = 여기;
    여기 = abs;
  }
  return 본것;
}

/**
 * 변경성 동작은 실패해도 다시 실행하지 않는다 — 두 번 실행되면 사고다. (RPA 에서 얻은 원칙)
 *
 * **첫 낱말**일 때만 본다. 아무 데나 있어도 걸리면 `node scripts/copy.js` 나 `grep -r "del" src/` 가
 * '변경성 명령' 이 되어 두 번째 시도가 막힌다. 진짜로 파일을 옮기는 명령과 이름만 스친 것은 다르다.
 *
 * ── 지우기·옮기기 무리는 **셸이 달라도** 같은 잣대 ──────
 *
 * confirm 모드는 `Bash && isMutating` 일 때만 묻는다(agent/loop.js). PowerShell 의 Remove-Item ·
 * cmd 의 rmdir · rd · ren · erase · git rm · git mv · git clean · find -delete 가 빠지면 셸로
 * PowerShell 이 골라진 판(tools/shell.js)에서 지우기가 **안 묻고** 돌고 재실행 거부도 없다. 이것들은
 * rm · del 과 같은 무리다(아래 셸쓰기무늬 머리말이 걱정한 `echo x > log` 류 **쓰기**와 다르다). 첫 자리만
 * 보는 것은 그대로라 `node scripts/rename.js` · `npm run rd` 는 안 걸린다.
 */
/*
 * ── 앞 빈칸 한 칸에 이 규칙이 통째로 꺼지면 안 된다 ─────────────────────
 *
 * 머리를 `(^|[|;&]\s*)` 로 두면 글 맨 앞은 **빈칸이 하나도 없을 때만** 맞는다. 부르는 쪽
 * (agent/loop.js)은 모델이 준 글을 안 다듬고 넘기고, 모델은 줄바꿈과 들여쓰기를 곧잘 붙인다 —
 * `isMutating(' rm -rf src')` · `isMutating('\n  git push')` 가 false 가 된다. 거짓이면 재실행
 * 거부도 엄격 모드의 물음도 통째로 안 돈다. 막는 규칙이 아니라 **여는 규칙**이라 화면에는 아무
 * 말도 안 난다.
 */
// 줄바꿈도 이음매다 — `echo prep\ngit push` 가 안 걸렸다.
const MUTATING = /(^\s*|[|;&\n\r]\s*)(sudo\s+)?(git\s+(commit|push|merge|rebase|reset|rm|mv|clean)|npm\s+(publish|install)|pip\s+install|mv|cp|del|erase|rm|rmdir|rd|ren|rename|unlink|shred|move|copy|remove-item|rename-item|ri|rni|find\b[^|;&]*\s-delete|curl\s+-X\s*(POST|PUT|DELETE|PATCH))\b/i;

/*
 * 따옴표 **안**은 셸의 이음매가 아니다. `curl "https://example.com?page=1&del=true"` 의 `&del` 이
 * 「지우기 명령이 이어 붙었다」 로 읽히면 멀쩡한 조회가 변경성으로 걸려 재실행 거부에 막히고
 * 엄격 모드에서 승인 창이 뜬다. checkCommand 는 이미 따옴표를 가려 마디를 자른다(마디들). 길이를
 * 지켜 가리므로 뒤 규칙의 자리 계산은 안 흔들린다.
 */
const 따옴안가리기 = (s) => String(s ?? '')
  .replace(/"[^"]*"|'[^']*'/g, (m) => m[0] + 'x'.repeat(m.length - 2) + m[0]);

export function isMutating(cmd) {
  return MUTATING.test(따옴안가리기(cmd));
}

/*
 * 셸이 **파일에 쓰는 꼴**인가 — 스냅샷을 뜰지 정하는 데만 쓴다.
 *
 * ── 왜 MUTATING 을 넓히지 않고 새로 만드나 ──────────────────────────────
 *
 * MUTATING 은 세 곳에서 쓰인다.
 *
 *   tools/index.js:307   스냅샷을 뜰지            ← 넓히고 싶은 곳
 *   agent/loop.js:1214   같은 명령을 두 번 안 돌린다
 *   agent/loop.js:1255   엄격 모드에서 물어본다
 *
 * 아래 것들을 MUTATING 에 넣으면 뒤의 두 곳이 같이 넓어져 `echo x > log` 마다 승인 창이 뜨고
 * 두 번째 `echo` 가 막힌다. 그래서 **쓰임이 하나뿐인 술어**를 따로 둔다.
 *
 * ── 왜 넉넉해도 되나 ────────────────────────────────────────────────────
 *
 * 여기서 잘못 걸리면 안 떠도 될 스냅샷 한 장을 더 뜰 뿐이다(`echo "a > b"` 처럼 글 안의 부등호도
 * 마찬가지). MUTATING 에서 잘못 걸리면 멀쩡한 명령이 막힌다. 값이 다른 두 실수라 이쪽은 넉넉히 잡는다.
 *
 * ── 왜 이 목록이 필요한가 ───────────────────────────────────────────────
 *
 * 모델이 셸에서 파일을 고치는 흔한 방법 열한 가지 중 MUTATING 에는 `rm` 하나만 걸린다.
 *
 *   O rm f.js
 *   X echo x > f.js      X printf x >> f.js     X sed -i s/a/b/ f.js
 *   X tee f.js           X truncate -s 0 f.js   X dd of=f.js
 *   X node -e "…"        X python -c "…"        X npx prettier --write src/
 *   X git checkout -- f.js
 *
 * 스냅샷이 없으면 그 턴은 기록을 한 줄도 안 남겨서, /undo 가 그 턴의 존재를 모르고 **앞의 무관한
 * 턴**을 되돌린 뒤 성공했다고 적는다. (검사: test/undo.test.js 의 「셸쓰기-다른턴을-되돌리던-것」)
 */
const 셸쓰기무늬 = [
  />{1,2}\s*(?![&>])\S/,                       // echo x > f · printf x >> f  (2>&1 은 & 라 안 걸린다)
  /\bsed\s+(-[a-z]*i\b|--in-place)/i,          // sed -i · sed --in-place
  /\bperl\s+(-[a-z]*i\b|--in-place)/i,
  /\btee\b/i,
  /\b(set-content|add-content|out-file)\b/i,   // 파워셸
  /\btruncate\b/i,
  /\bdd\b[^|;&]*\bof=/i,
  /--write\b/i,                                // prettier --write 류
  /\bprettier\b[^|;&]*\s-w\b/i,                // prettier -w (줄임꼴 — --write 만 보고 놓쳤다 · 6회차 Gemini 쓰나6n O3)
  /\bpatch\b/i,
  // 작업 트리를 되돌리는 것도 파일을 바꾼다. `--` 뒤는 `\b` 로 못 잰다 — `-` 와 공백 사이는 경계가 아니라서
  // `git checkout -- f.js` 는 안 걸리고 `git checkout --help` 만 걸린다.
  /\bgit\s+(checkout\s+--(?=\s|$)|restore\b)/i,
  /*
   * 한 줄짜리 프로그램(`node -e "…"` · `python -c "…"`). 그 안에서 무엇을 하는지는 안 읽는다. 넉넉히
   * 잡아 손해는 스냅샷 한 장이고, 안 잡으면 그 턴이 기록을 안 남겨 /undo 가 **앞의 무관한 턴**을
   * 되돌린다. 첫 낱말이 아니라 마디 안 어디에 있어도 본다(`cd x && node -e "…"`). `-e` · `-c` 는
   * 낱말째여야 해서 `--help` 나 `-eval` 은 안 걸린다. `-p`(`--print`) 도 코드를 돌리고, 셸은 플래그와
   * 값 사이 빈칸을 요구하지 않으며(`python -c"…"`), 윈도우에는 기본 런처 `py` 도 있다.
   */
  /\bnode(?:\.exe)?\b[^|;&]*\s--?(?:e|p|-eval|-print)(?=[\s="']|$)/i,
  /\b(?:python[\d.]*|py)(?:\.exe)?\b[^|;&]*\s-c(?=[\s="']|$)/i,
];

/** 이 명령이 파일 내용을 바꿀 낌새인가. **스냅샷 판단에만** 쓴다. */
export function 셸이파일에쓰나(cmd) {
  const s = String(cmd ?? '');
  return 셸쓰기무늬.some((무늬) => 무늬.test(s));
}
