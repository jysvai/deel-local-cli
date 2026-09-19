// /commit — 이번 대화가 바꾼 것을 저장소에 남긴다.
//
// ── 왜 명령으로 두나 ────────────────────────────────────────────────────
//
// 일은 결국 git 을 거쳐야 남는다. 그런데 지금까지 그 마지막 한 걸음은
// 모델이 Bash 로 `git commit -m "…"` 를 치는 것이었고, 거기서 세 가지가 샜다.
//
//   1) 따옴표. 윈도우 cmd 에서 큰따옴표 안의 `"` · `%` · 줄바꿈은 사람이
//      기대한 대로 안 들어간다. 여러 줄 메시지는 사실상 못 쓴다 — 그래서
//      메시지가 한 줄로 쪼그라들고, 왜 고쳤는지가 사라진다.
//   2) 무엇을 담을지. `git add -A` 는 이번 대화와 상관없는 남의 변경까지
//      쓸어 담는다. 사람이 딴 창에서 고치던 파일이 남의 커밋에 실린다.
//   3) 증거. deel 은 무엇을 고쳤고 무엇으로 확인했는지를 이미 알고 있는데
//      (evidence.js), 커밋 메시지에는 그게 한 글자도 안 들어갔다.
//
// 그래서 여기서 셋을 다 맡는다. 메시지는 파일로 넘기고(-F), 담는 것은 이번
// 대화가 건드린 파일뿐이고, 확인 안 된 것이 있으면 메시지에 그렇게 적는다.
//
// ── 안 하는 것 ──────────────────────────────────────────────────────────
//
// 절대로 push 하지 않는다. 되돌릴 수 있는 자리(로컬 커밋)와 못 되돌리는
// 자리(남이 보는 곳) 사이에 사람이 한 번은 있어야 한다.
// 남이 미리 담아 둔 것(index)을 풀지도 않는다 — 남의 준비를 말없이 흩는
// 것이 커밋을 하나 더 만드는 것보다 나쁘다. 대신 화면에 같이 적는다.
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, statSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute, dirname } from 'node:path';
import { 진짜자리 } from '../safety/guard.js';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { chat } from '../backend/adapter.js';
import { 증거모으기 } from './evidence.js';
import { VERSION } from '../version.js';
import { homeDir } from '../config.js';

/** 제목 길이 상한. git 관례(50~72)의 넉넉한 쪽. 한글은 글자 수로 센다. */
export const 제목상한 = 72;

/** 모델에게 보여 줄 diff 길이 상한(글자). 넘으면 자르고 잘랐다고 적는다. */
export const DIFF상한 = 12000;

/**
 * git 을 부른다. 셸을 안 거친다 — 따옴표 사고가 나는 자리가 여기다.
 *
 * @returns {{ok:boolean, code:number, out:string, err:string, 없음?:boolean}}
 */
export function 깃(root, 인자들, { 입력 = null } = {}) {
  let r;
  try {
    /*
     * quotepath 를 끈다.
     *
     * git 은 기본으로 한글 파일 이름을 `"\353\202\250…"` 같은 8진수 이스케이프로
     * 내놓는다. 그 글자를 그대로 화면에 내면 사람은 제 파일을 못 알아보고,
     * 그대로 다시 `git add` 에 넣으면 **없는 파일**을 담으라는 뜻이 된다.
     * 한국어 저장소에서는 이게 예외가 아니라 보통이다.
     */
    r = spawnSync('git', ['-c', 'core.quotepath=false', ...인자들], {
      cwd: root,
      encoding: 'utf8',
      input: 입력 ?? undefined,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    return { ok: false, code: -1, out: '', err: err.message, 없음: err.code === 'ENOENT' };
  }
  if (r.error) return { ok: false, code: -1, out: '', err: r.error.message, 없음: r.error.code === 'ENOENT' };
  return { ok: r.status === 0, code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/** git 이 이 PC 에 있나. 없으면 명령 자체를 안 시작한다. */
export function 깃있나(root = process.cwd()) {
  const r = 깃(root, ['--version']);
  return r.ok && /git version/i.test(r.out);
}

/** 여기가 저장소인가. 맞으면 그 뿌리를 준다 (하위 폴더에서 불러도 된다). */
export function 저장소뿌리(root) {
  const r = 깃(root, ['rev-parse', '--show-toplevel']);
  if (!r.ok) return null;
  const p = r.out.trim();
  return p ? p.replace(/\//g, process.platform === 'win32' ? '\\' : '/') : null;
}

/*
 * deel 자신의 살림은 절대 안 담는다.
 *
 * `.deel/config.json` 에 **게이트웨이 열쇠**가 들어 있다. `/commit 전부` 가
 * `git add -A` 를 그대로 하면 그 열쇠가 커밋에 실리고, 한 번 실린 열쇠는
 * 되돌린 뒤에도 이력에 남는다. 그다음이 push 면 끝이다.
 * `.deel/audit.jsonl`(무엇을 언제 했는지)도 남의 저장소에 갈 것이 아니다.
 */
export const 살림폴더 = '.deel';

/*
 * 살림을 가리는 자를 세 겹으로 둔다. 한 겹은 반드시 뚫린다.
 *
 *   1) 경로 글자   — 어느 깊이에 있든, 대소문자가 어떻든 (`packages/x/.DEEL/…`)
 *   2) git 패스스펙 — 담을 때 아예 빼 달라고 git 에게도 말한다
 *   3) 진짜 자리   — 담긴 뒤 realpath 로 다시 본다. 이름이 다른 링크
 *                    (`alias\ → .deel`)는 앞의 둘을 그냥 지나간다.
 *
 * 열쇠가 한 번 커밋에 실리면 되돌려도 이력에 남는다. 되돌릴 수 없는 것 앞에서는
 * "설마" 를 쓰지 않는다.
 */
const 살림꼴 = /(^|[\\/])\.deel([\\/]|$)/i;

/** 이 경로가 살림을 가리키나 — 글자로 본다. */
export function 살림경로인가(rel) { return 살림꼴.test(String(rel ?? '')); }

/**
 * 이 경로가 **진짜로** 살림 안에 닿나 — 링크를 다 풀고 본다.
 *
 * 푸는 자는 울타리와 같은 것을 쓴다(진짜자리). 여기서 따로 realpathSync 를
 * 부르면 없는 파일에서 그냥 포기하고, 그러면 링크로 들어온 살림이 글자
 * 검사만 거쳐 통과한다 — 열쇠가 담기는 길이 그렇게 열린다.
 */
export function 살림에닿나(abs) {
  const 푼것 = 진짜자리(abs);
  if (살림꼴.test(푼것) || 살림경로인가(abs)) return true;
  /*
   * 이름이 `.deel` 이 아닐 수도 있다 — `DEEL_HOME` 으로 옮기면 그렇다.
   * 살림이 어디인지는 config.js 만 안다. 여기서 또 적으면 한쪽이 낡는다.
   */
  try {
    const 집 = String(homeDir()).replace(/\\/g, '/').replace(/[/]+$/, '').toLowerCase();
    const 낮은 = String(푼것 ?? '').replace(/\\/g, '/').toLowerCase();
    return !!집 && (낮은 === 집 || 낮은.startsWith(집 + '/'));
  } catch { return false; }
}

/** 담을 때 git 에게도 빼 달라고 하는 자리. 어느 깊이든, 대소문자 상관없이. */
const 살림빼기 = [':(exclude,icase,glob)**/.deel/**', ':(exclude,icase,glob)**/.deel'];

/*
 * ── 파일 이름은 글자 그대로 넘긴다 (사냥5 H5-4) ─────────────────────────────
 *
 * `git add -- <경로>` 의 경로 자리는 **패스스펙**이다. git 은 거기 적힌 `[ab].txt` 를
 * 그 이름의 파일로도, 「a.txt 나 b.txt」 라는 글롭으로도 푼다. 그래서 이번 대화가
 * `[ab].txt` 하나만 만들었는데 옆 창에서 고치던 a.txt·b.txt 가 같이 담겨 커밋에
 * 실렸다 — 이 파일이 없애려고 만든 `git add -A` 사고가 이름 한 글자로 되돌아온다.
 * `:(literal)` 을 붙이면 그 한 자리만 글자 그대로 읽는다. 위 살림빼기는 일부러
 * 글롭이라(어느 깊이든) 그대로 둔다 — 패스스펙마다 따로 읽히므로 섞어도 된다.
 */
export const 글자그대로 = (경로) => `:(literal)${경로}`;

/**
 * 링크를 다 푼 진짜 자리 — 자는 울타리와 **같은 것**을 쓴다.
 *
 * 저장소 뿌리를 링크로 열어 둔 사람이 있다(윈도우 junction, 맥의 /tmp).
 * git 은 링크를 풀어서 답하고 우리는 안 풀면, 같은 자리를 두 이름으로 부르게
 * 되어 "이번에 바꾼 것이 없습니다" 가 된다 — 바꾼 것이 있는데도. 그리고 그
 * 「없다」 는 **작업 폴더 전부**로 물러서는 신호다. 이 파일이 없애려고 만들어진
 * 바로 그 `git add -A` 사고가, 경고 한 줄 없이 난다.
 *
 * 여기 자를 따로 두고 있었다. 없는 파일에서 그냥 포기하는 자였고(지운 파일은
 * 이 명령이 제일 자주 다루는 것이다), 윈도우 8.3 단축명도 안 폈다. 울타리
 * (safety/guard.js)에는 그 둘을 다 하는 자가 이미 있었는데도 따로 있었다.
 * 자가 둘이면 언젠가 어긋나고, 어긋나는 날 이 명령은 남의 것까지 담는다.
 */
const 진짜 = 진짜자리;

/**
 * 이번 대화가 건드린 파일 — 저장소 안의 것만, 저장소 기준 상대경로로.
 *
 * 폴더는 안 담는다. `Move` 로 폴더를 옮기면 **닿은 폴더**가 바뀐 것으로 적히는데,
 * 그 폴더 안에는 남이 고치던 파일도 같이 산다. 그걸 그대로 담으면 이 명령이
 * 없애려던 `git add -A` 사고를 이름만 바꿔 다시 내는 셈이다. 안 담은 폴더는
 * 목록으로 돌려주고, 화면이 그렇게 말한다.
 */
/**
 * 이 파일이 **딴 저장소** 안인가 — 서브모듈이나, 안쪽에 따로 `git init` 한 폴더.
 *
 * 그 안 경로를 `git add` 에 실으면 서브모듈은 `fatal: Pathspec … is in submodule`
 * 로 죽고, 같이 실은 바깥 파일까지 못 담아 /commit 이 통째로 안 된다. 등록 안 된
 * 안쪽 저장소는 거꾸로 add 가 0 으로 끝나고 아무것도 안 담는다 — 말없이 빠진다.
 * 뿌리와 파일 사이 폴더에 `.git`(서브모듈은 파일, 안쪽 저장소는 폴더)이 있으면 딴 저장소다.
 * (6회차 Gemini 커밋 C2)
 *
 * @returns {string|null} 그 저장소 폴더 — 저장소 뿌리 기준 상대경로(`/`)
 */
function 딴저장소자리(abs, 기준) {
  for (let d = dirname(abs); d.length > 기준.length && d !== dirname(d); d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return relative(기준, d).replace(/\\/g, '/');
  }
  return null;
}

/** git 의 index 가 이 이름으로 내놓는 것들. 못 물어봤으면 null — 「없다」 와 다르다. */
function 깃이아는것(기준, rel) {
  const r = 깃(기준, ['ls-files', '-z', '--', 글자그대로(rel)]);
  if (!r.ok) return null;
  return r.out.split(String.fromCharCode(0)).filter(Boolean);
}

/**
 * 지워진 뒤에는 stat 이 폴더였는지 안 알려 준다 — git 의 index 에 물어본다.
 *
 * 폴더는 담을 목록에서 뺀다(바로 아래). 그런데 **지워진** 폴더만 그 그물을
 * 빠져나갔다. statSync 가 던지면 「지워진 것은 파일로 친다」 쪽으로 갔고, 그
 * 이름이 그대로 `git add -A -- :(literal)<폴더>` 에 실렸다. git 은 폴더를 받으면
 * 그 아래 **전부**를 담는다 — 옆 창에서 고치던 남의 파일까지. 이 파일이 없애려고
 * 만들어진 바로 그 `git add -A` 사고가 이름만 바꿔 되돌아온 것이다. (8회차 커밋 1)
 *
 * index 가 그 이름 **아래**의 것들을 내놓으면 폴더였다. 그 이름 자체가 나오면
 * 파일이고, 아무것도 안 나오면 git 이 모르던 것이라 여태대로 파일로 친다.
 */
function 지워진폴더인가(기준, rel) {
  const 든것 = 깃이아는것(기준, rel);
  return !!든것 && 든것.length > 0 && !든것.includes(rel);
}

/**
 * 지워졌는데 git 이 그 이름을 **한 번도 본 적이 없나** — 담을 수 없는 이름인가.
 *
 * 이번 대화가 만들었다 지운 임시 파일이 이렇다. 추적된 적이 없으니 index 에도
 * 없고, 작업 폴더에도 이제 없다. 그 이름이 `git add -A -- :(literal)<이름>` 에
 * 실리면 git 은 `fatal: pathspec … did not match any files` 로 죽는데, add 는
 * 하나라도 못 맞추면 **아무것도 안 담고** 끝난다 — 같이 실은 진짜 변경까지
 * 전부. 그래서 /commit 이 통째로 안 됐다. 담을 수 없는 이름 하나 때문에 담을
 * 수 있는 것까지 못 담는 것이 제일 나쁘다. 이 이름만 빼고 나머지는 담는다.
 * (8회차 커밋2)
 *
 * 못 물어봤으면(`null`) 여태대로 담아 본다 — 모르면서 빼면 사람이 담긴 줄 알고
 * 넘어간다. 추적하던 파일의 삭제는 index 에 그 이름이 있으므로 여기 안 걸린다.
 */
function 깃이모르나(기준, rel) {
  const 든것 = 깃이아는것(기준, rel);
  return !!든것 && 든것.length === 0;
}

export function 이번에바꾼것(session, 뿌리) {
  const 기준 = 진짜(뿌리);
  const 것들 = [];
  const 폴더들 = [];
  const 딴저장소 = [];
  const 모르는이름 = [];
  for (const p of (session?.changes?.keys?.() ?? [])) {
    const abs = 진짜(isAbsolute(p) ? p : join(기준, p));
    const rel = relative(기준, abs).replace(/\\/g, '/');
    /*
     * 저장소 밖은 담지 않는다. `..` 로 시작하면 밖이다.
     * (지워진 파일도 여기서 안 새어 나간다 — 진짜() 가 있는 데까지 풀어 준다.)
     *
     * 절대경로도 밖이다. 윈도우에서 **드라이브가 다르면** relative() 가
     * `..` 를 못 만들고 상대경로 대신 `D:\남의폴더\a.txt` 를 그대로 돌려준다.
     * 그러면 위 두 검사를 그냥 지나가서, 저장소 밖 경로가 `git add` 에 실린다 —
     * git 이 `fatal: … is outside repository` 로 죽고 /commit 이 통째로 안 된다.
     * 담지 말아야 할 것 하나 때문에 담아야 할 것도 다 못 담는 꼴이다.
     */
    if (!rel || rel.startsWith('../') || rel === '..' || isAbsolute(rel)) continue;
    if (살림경로인가(rel) || 살림에닿나(abs)) continue;
    const 딴곳 = 딴저장소자리(abs, 기준);
    if (딴곳 !== null) { if (!딴저장소.includes(딴곳)) 딴저장소.push(딴곳); continue; }
    let 폴더인가 = false;
    // 지워졌으면 stat 이 폴더였는지 못 알려 준다 — git 에게 묻는다 (8회차 커밋 1).
    try { 폴더인가 = statSync(abs).isDirectory(); } catch { 폴더인가 = 지워진폴더인가(기준, rel); }
    if (폴더인가) { if (!폴더들.includes(rel)) 폴더들.push(rel); continue; }
    // 지금 없고 git 도 모르는 이름은 담을 수가 없다 — 그것만 빼고 나머지는 담는다 (8회차 커밋2).
    if (!existsSync(abs) && 깃이모르나(기준, rel)) { if (!모르는이름.includes(rel)) 모르는이름.push(rel); continue; }
    if (!것들.includes(rel)) 것들.push(rel);
  }
  것들.sort();
  Object.defineProperty(것들, '폴더', { value: 폴더들.sort(), enumerable: false });
  Object.defineProperty(것들, '딴저장소', { value: 딴저장소.sort(), enumerable: false });
  // 만들었다 지워서 git 이 끝내 못 본 이름 — 안 담았다고 화면이 말한다 (8회차 커밋2).
  Object.defineProperty(것들, '모르는이름', { value: 모르는이름.sort(), enumerable: false });
  return 것들;
}

/**
 * 담는다.
 *
 * `-A` 를 경로와 함께 쓴다 — 그래야 지운 파일도 '지웠다' 로 담긴다.
 * 경로 없이 쓰면 남의 변경까지 쓸어 담는데, 그건 `전부` 를 시켰을 때만 한다.
 */
export function 담기(뿌리, 경로들, { 전부 = false, 안쪽 = '' } = {}) {
  /*
   * `전부` 는 **작업 폴더 전부**지 저장소 전부가 아니다.
   *
   * 큰 저장소의 하위 폴더에서 deel 을 켜는 것은 흔한 일이다(모노레포). 그때
   * 저장소 뿌리에 대고 `git add -A` 를 하면, 옆 팀 폴더와 그 안의 .env 까지
   * 담기고 — 그 내용이 커밋 메시지를 지으러 모델에게도 나간다. 사람은
   * "이 폴더에서 일하는 중" 이라고 알고 있었다.
   */
  // 작업 폴더 이름도 글자 그대로다 — `sub[1]` 폴더에서 켰는데 옆의 `sub1` 이 담기면 안 된다.
  if (전부) return 깃(뿌리, ['add', '-A', '--', 안쪽 ? 글자그대로(안쪽) : '.', ...살림빼기]);
  if (!경로들.length) return { ok: true, code: 0, out: '', err: '' };
  return 깃(뿌리, ['add', '-A', '--', ...경로들.map(글자그대로), ...살림빼기]);
}

/**
 * 담긴 것 중 진짜로 살림에 닿는 것을 도로 뺀다.
 *
 * 이름이 다른 링크는 글자로도 패스스펙으로도 안 걸린다. 여기서 realpath 로
 * 한 번 더 본다. 못 빼면 커밋을 아예 안 한다 — 열쇠가 실릴 바에는 안 되는
 * 편이 낫다.
 *
 * @returns {{샌것: string[], 못뺀것: string[]}}
 */
export function 살림도로빼기(뿌리, 파일들) {
  const 샌것 = 파일들.filter((f) => 살림에닿나(join(뿌리, f)));
  if (!샌것.length) return { 샌것, 못뺀것: [] };
  // 첫 커밋 전이면 HEAD 가 없어 restore 가 안 된다. 그때는 index 에서 지운다.
  // 도로 빼는 것도 글자 그대로 — 글롭으로 풀리면 남이 담아 둔 것까지 풀어 버린다 (사냥5 H5-4).
  const r = 깃(뿌리, ['restore', '--staged', '--', ...샌것.map(글자그대로)]);
  if (!r.ok) 깃(뿌리, ['rm', '--cached', '-q', '-r', '--', ...샌것.map(글자그대로)]);
  const 아직 = 담긴것(뿌리).파일들.filter((f) => 살림에닿나(join(뿌리, f)));
  return { 샌것, 못뺀것: 아직 };
}

/**
 * 지금 담겨 있는 것.
 *
 * ── git 이 **답을 못 한 것**과 **답이 없는 것**은 다르다 ──────────────────
 *
 * 세 번 부르면서 ok 를 한 번도 안 봤다. 그래서 실패가 전부 「빈 값」 으로
 * 내려가고, 부르는 쪽은 그것을 「바뀐 것이 없다」 로 읽었다. 실제로 겪는 꼴이
 * 둘 있다.
 *
 *   · 담긴 diff 가 64MB 를 넘으면 몸통만 ENOBUFS 로 죽는다(spawnSync 의
 *     maxBuffer). 파일 목록은 멀쩡히 오므로 커밋은 그대로 이어지고,
 *     **빈 diff 를 받은 모델**이 「무엇을 바꿨는지는 diff 에 이미 있다」 는
 *     지시 아래 메시지를 짓는다 — 볼 것이 없으니 지어낸다. 큰 데이터 덤프나
 *     묶은 번들은 이 도구가 실제로 만드는 것들이다.
 *   · `.git/index` 가 깨지면 이름 목록부터 죽는다. 그러면 화면에 「담을 것이
 *     없습니다 — 바뀐 내용이 없습니다」 가 뜬다. 사람은 제 일이 안 담긴 줄
 *     알고 다시 담으러 가는데, 실제로 필요한 것은 저장소 손보기다.
 *
 * 그래서 못 읽은 것을 못 읽었다고 같이 돌려준다.
 *
 * @returns {{파일들:string[], 통계:string, diff:string, 못읽음:Array<{무엇:string,왜:string}>}}
 */
export function 담긴것(뿌리) {
  const 이름 = 깃(뿌리, ['diff', '--cached', '--name-only', '-z']);
  const 통계 = 깃(뿌리, ['diff', '--cached', '--stat']);
  const 몸통 = 깃(뿌리, ['diff', '--cached']);
  /*
   * 이름은 NUL 로 끊어 받는다 (6회차 커밋 C5).
   *
   * 줄로 받아 줄마다 trim 하면 ` a.txt` 가 `a.txt` 로 적혀, 살림도로빼기 가 없는
   * 이름으로 링크를 보고 화면·감사기록도 다른 이름을 적는다. 리눅스에서는 탭·따옴표·
   * 줄바꿈이 든 이름이 quotepath 를 꺼도 C 따옴표로 싸여 온다. `-z` 면 손대지 않고 온다.
   */
  const 파일들 = 이름.out.split(String.fromCharCode(0)).filter(Boolean);
  const 못읽음 = [];
  const 적기 = (무엇, r) => {
    if (!r.ok) 못읽음.push({ 무엇, 왜: (r.err || r.out || `git ${무엇} 실패`).trim().split('\n')[0] });
  };
  적기('목록', 이름);
  적기('통계', 통계);
  적기('diff', 몸통);
  return { 파일들, 통계: 통계.out.trimEnd(), diff: 몸통.out, 못읽음 };
}

/** 저장소가 쓰던 말투를 흉내 내라고 최근 제목을 보여 준다. */
export function 최근제목들(뿌리, n = 10) {
  const r = 깃(뿌리, ['log', `-${n}`, '--format=%s']);
  if (!r.ok) return [];                 // 첫 커밋이면 로그가 없다 — 흉내낼 것이 없을 뿐이다
  return r.out.split('\n').map((x) => x.trim()).filter(Boolean);
}

const 스키마 = {
  type: 'object',
  properties: { 제목: { type: 'string' }, 본문: { type: 'string' } },
  required: ['제목', '본문'],
  additionalProperties: false,
};

const 지시 = `너는 지금 준비된 변경(staged diff)을 보고 git 커밋 메시지를 쓴다.

규칙:
- 제목 한 줄, 그다음 본문. 제목은 ${제목상한}자 이내, 마침표 없이.
- 저장소의 최근 제목들과 같은 말투를 쓴다. 그쪽이 conventional commits(feat:·fix:)면 따르고, 아니면 따르지 마라.
- 본문은 **무엇을 바꿨나**가 아니라 **왜 바꿨나**를 쓴다. 무엇을 바꿨는지는 diff 에 이미 있다.
- diff 에서 실제로 보이는 것만 써라. 안 돌린 검사를 돌렸다고 쓰지 마라.
- 없는 이슈 번호·이름을 지어내지 마라.
- 한국어로 써라(저장소의 최근 제목이 영어면 영어로).`;

const 답형식 = `아래 두 줄 형식으로만 답하라. 다른 말은 붙이지 마라.
제목: <한 줄>
본문:
<여러 줄>`;

/** 코드울타리·따옴표를 벗긴다. 작은 모델이 자주 씌운다. */
function 껍질벗기기(글) {
  // CRLF 로 답하는 게이트웨이·모델이 있다. 줄바꿈을 먼저 LF 로 맞춰야 울타리 무늬가 걸린다 —
  // 안 걸리면 JSON 답이 줄글로 갈라져 커밋 제목이 ```json 이 된다 (6회차 커밋 C6).
  let s = String(글 ?? '').replace(/\r\n?/g, '\n').trim();
  const 울타리 = s.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (울타리) s = 울타리[1].trim();
  /*
   * 따옴표도 벗긴다 — 머리말은 벗긴다고 적어 두고 안 벗기고 있었다 (8회차 커밋 5).
   *
   * 답을 통째로 따옴표로 싸서 주는 모델이 있다. 그러면 첫 줄이 `"제목: …` 이 되어
   * `제목:` 무늬가 안 걸리고, 줄글로 읽혀 **라벨째** 커밋 제목이 된다.
   * 안쪽에 같은 따옴표가 또 있으면 껍질이 아니라 인용문이다 — 그때는 그냥 둔다.
   */
  const 짝 = { '"': '"', "'": "'", '`': '`', '「': '」', '『': '』' };
  const 닫는 = 짝[s[0]];
  if (닫는 && s.length >= 2 && s.endsWith(닫는)) {
    const 속 = s.slice(1, -1);
    if (!속.includes(s[0]) && !속.includes(닫는)) s = 속.trim();
  }
  return s;
}

/**
 * 모델이 준 것을 제목과 본문으로 가른다.
 *
 * 세 가지 꼴을 다 받는다 — JSON, `제목:`/`본문:` 꼴, 그냥 줄글. 작은 모델은
 * 시킨 형식을 자주 안 지키는데, 그때마다 실패로 치면 이 명령은 로컬에서
 * 반도 안 된다. 못 알아볼 때만 실패로 친다.
 */
export function 답가르기(글) {
  const s = 껍질벗기기(글);
  if (!s) return null;

  if (s.startsWith('{')) {
    try {
      const j = JSON.parse(s);
      const t = String(j.제목 ?? j.title ?? '').trim();
      const b = String(j.본문 ?? j.body ?? '').trim();
      if (t) return { 제목: t, 본문: b };
    } catch { /* JSON 인 척한 것뿐이면 아래로 */ }
  }

  const 표 = s.match(/^\s*제목\s*[:：]\s*(.+?)\s*$/m);
  if (표) {
    const 뒤 = s.slice(s.indexOf(표[0]) + 표[0].length);
    const 본문표 = 뒤.match(/^\s*본문\s*[:：]\s*/m);
    // 자리는 무늬가 찾은 그 자리다. indexOf 로 다시 뒤지면 앞줄 사족에 낀 같은
    // 글자가 먼저 걸려, 진짜 `본문:` 라벨이 본문에 그대로 남는다 (8회차 커밋 4).
    const 본문 = 본문표 ? 뒤.slice(본문표.index + 본문표[0].length) : 뒤;
    return { 제목: 표[1].trim(), 본문: 본문.trim() };
  }

  const 줄들 = s.split('\n');
  const 첫 = 줄들.findIndex((l) => l.trim());
  if (첫 < 0) return null;
  return { 제목: 줄들[첫].trim(), 본문: 줄들.slice(첫 + 1).join('\n').trim() };
}

/**
 * 제목을 다듬는다. 넘치면 자르되 **버리지 않고** 본문 앞으로 넘긴다.
 *
 * 그냥 자르면 문장이 중간에서 끊긴 채로 영영 남는다. 커밋 제목은 나중에
 * `git log --oneline` 에서 그 커밋을 찾는 유일한 단서라, 끊긴 자리에서
 * 뜻이 뒤집히면(「…를 안 」) 아무도 못 찾는다.
 */
/*
 * 모델이 준 글에서 제어글자를 뺀다.
 *
 * 커밋 메시지는 **두 번 화면에 나간다** — 찍기 전 미리보기와, 나중에 누군가의
 * `git log`. ESC 가 살아 있으면 그 두 자리에서 터미널이 그 글자를 명령으로
 * 읽는다. 보이는 제목과 실제로 적히는 제목을 다르게 만들 수 있고(\x1b[8m 는
 * 글자를 감춘다), 그렇게 적힌 것은 이력에 영영 남아 남의 터미널에서 다시 돈다.
 * 줄바꿈과 탭만 남긴다.
 */
export function 제어글자빼기(글) {
  let 남길것 = '';
  for (const 글자 of String(글 ?? '')) {
    const 값 = 글자.codePointAt(0);
    if (값 === 9 || 값 === 10) { 남길것 += 글자; continue; }   // 탭·줄바꿈만 남긴다
    if (값 < 32 || (값 >= 127 && 값 <= 159)) continue;         // C0·C1 제어글자
    남길것 += 글자;
  }
  return 남길것;
}

/*
 * 모델이 지어낸 꼬리표를 지운다.
 *
 * `Signed-off-by:` 는 사람이 "내가 이 코드에 책임진다" 고 적는 줄이다. 모델이
 * 그 줄을 쓰면 없는 사람의 서명이 이력에 남고, 그걸 세는 도구들은 그것을
 * 진짜로 읽는다. 우리 꼬리표(Generated-by)는 우리가 따로 붙이므로, 모델이
 * 꼬리표를 쓸 이유가 아예 없다.
 */
const 가짜꼬리표 = /^\s*(signed-off-by|co-authored-by|reviewed-by|acked-by|tested-by|generated-by|claude-session)\s*:/i;

/*
 * 이슈를 **닫는** 낱말은 콜론이 없다.
 *
 * 위 목록에 closes·fixes 를 같이 넣어 두고 있었는데, 끝에 `\s*:` 가 붙어 있어
 * 정작 깃허브가 알아보는 꼴(`Closes #123`)은 한 번도 안 걸렸다. 걸러내려던
 * 바로 그것만 통과한 셈이다.
 *
 * 이게 왜 중요하냐면, 이 줄이 기본 가지에 실리는 순간 **깃허브가 그 이슈를
 * 진짜로 닫는다.** 모델이 지어낸 번호면 남의 이슈가 닫힌다 — 커밋을 되돌려도
 * 닫힌 이슈는 안 열린다.
 *
 * 그렇다고 `Fixes` 로 시작하는 줄을 통째로 지우면 안 된다. 「Fixes the crash
 * when …」 은 본문에 있어야 할 진짜 문장이다. 그래서 **뒤에 `#숫자`나 주소만
 * 달랑 오는 꼴**일 때만 지운다.
 *
 * 끝에 온점·쉼표가 붙어도 깃허브는 그 이슈를 닫는다. 그런데 무늬가 `#123` 뒤에
 * 곧바로 줄 끝을 요구해서, 문장처럼 쓴 `Fixes #123.` 은 안 걸리고 통과했다 —
 * 걸러내려던 바로 그것이 온점 하나로 다시 통과한 셈이다. (8회차 커밋 3)
 */
const 닫는말 = /^\s*(clos(e|es|ed)|fix(|es|ed)|resolv(e|es|ed))\s*:?\s*(#\d+|https?:\/\/\S+)\s*[.,;!]*\s*$/i;

export function 꼬리표걸러내기(본문) {
  return String(본문 ?? '')
    .split('\n')
    .filter((줄) => !가짜꼬리표.test(줄) && !닫는말.test(줄))
    .join('\n')
    .trim();
}

export function 제목다듬기(글) {
  let t = 제어글자빼기(글).replace(/\s+/g, ' ').trim();
  t = t.replace(/^["'`「『]+/, '').replace(/["'`」』]+$/, '').trim();
  t = t.replace(/[.。]+$/, '').trim();
  if (!t) return { 제목: '', 남은것: '' };
  if ([...t].length <= 제목상한) return { 제목: t, 남은것: '' };
  const 글자 = [...t];
  const 앞 = 글자.slice(0, 제목상한).join('');
  const 빈칸 = 앞.lastIndexOf(' ');
  const 자를자리 = 빈칸 > 제목상한 * 0.5 ? 빈칸 : 앞.length;
  /*
   * 자른 끝에도 마침표를 안 남긴다 (8회차 커밋 6).
   *
   * 위에서 뗀 것은 **자르기 전** 끝이었다. 문장 경계에서 잘리면 그 자리의
   * 마침표가 그대로 남아, 지시문이 못 박은 「마침표 없이」 를 잘린 제목만 어겼다.
   */
  const 자른것 = 앞.slice(0, 자를자리).trim().replace(/[.。]+$/, '').trim();
  return { 제목: 자른것, 남은것: t.slice(자를자리).trim() };
}

/** 모델이 못 만들었을 때 — 지어내는 대신 사실만 적는다. */
export function 사실로만(파일들, 통계) {
  const 첫 = 파일들[0] ?? '변경';
  const 제목 = 파일들.length > 1 ? `chore: ${첫} 외 ${파일들.length - 1}개 고침` : `chore: ${첫} 고침`;
  const 본문 = [
    '모델이 커밋 메시지를 만들지 못해, 바뀐 것만 그대로 적습니다.',
    '',
    통계 || 파일들.map((f) => `- ${f}`).join('\n'),
  ].join('\n');
  return { 제목, 본문 };
}

/**
 * 메시지 한 덩이로 꾸린다.
 *
 * 확인 안 된 것이 있으면 **본문에** 적는다. 커밋은 나중에 사람이 읽는
 * 유일한 기록이고, "그때 검사를 돌렸던가" 는 그때 안 적으면 영영 모른다.
 */
export function 메시지꾸리기({ 제목, 본문 = '', 확인 = 0, 미확인 = 0, 모델 = '', 버전 = VERSION }) {
  const 몫 = [제어글자빼기(제목).trim()];
  const b = 꼬리표걸러내기(제어글자빼기(본문));
  if (b) 몫.push('', b);
  if (미확인 > 0) 몫.push('', `검증: ${확인}건 확인 · ${미확인}건 미확인`);
  몫.push('', `Generated-by: deel ${버전}${모델 ? ` · ${모델}` : ''}`);
  return `${몫.join('\n')}\n`;
}

/**
 * 커밋 메시지를 짓는다. 지금 대화는 안 보낸다 — 담긴 diff 와 증거만 보낸다.
 *
 * 대화를 통째로 보내면 창을 두 번 먹고, 모델은 제가 한 말을 근거로 제
 * 커밋 메시지를 쓰게 된다. 커밋에 실릴 것은 **코드가 말하는 것**이어야 한다.
 */
export async function 메시지짓기(session, { 뿌리, diff, 통계, 파일들, 증거, 제목 = null, signal = null, onBackoff = null, diff못읽음 = null } = {}) {
  /*
   * diff 를 **못 읽은 것**을 「없는 것」 으로 주면 모델은 지어낸다.
   *
   * 지시문이 「무엇을 바꿨는지는 diff 에 이미 있다」 라고 못을 박아 두었다.
   * 그 상태로 빈 diff 를 주면 모델은 통계 줄만 보고 그럴듯한 이야기를 만든다.
   * 못 봤으면 못 봤다고 말해야 「diff 에서 실제로 보이는 것만 써라」 가 지켜진다.
   */
  const 자른diff = diff못읽음
    ? `(diff 를 못 읽었습니다: ${diff못읽음})\n`
      + '내용을 한 줄도 못 봤습니다. 아래 통계에 적힌 파일 이름과 줄 수만 보고 쓰고,\n'
      + '내용에 대해서는 아무것도 단정하지 마라.'
    : diff.length > DIFF상한
      ? `${diff.slice(0, DIFF상한)}\n… (diff 가 길어 여기서 잘랐습니다 — 나머지는 통계로만 보세요)`
      : diff;
  const 최근 = 최근제목들(뿌리 ?? process.cwd());

  const 몫 = [];
  if (최근.length) 몫.push(`이 저장소의 최근 커밋 제목:\n${최근.map((x) => `- ${x}`).join('\n')}`);
  // 증거는 있는데 셈 칸이 없을 수 있다. 바로 아래 커밋준비() 는 `증거?.셈?.` 으로
  // 읽으면서 여기만 맨몸이었다 — 한쪽이 조심하고 한쪽이 안 하면 언젠가 터진다.
  if (증거?.셈) {
    const 셈 = 증거.셈;
    const 확인 = (셈.파일 ?? 0) - (셈.증명안됨 ?? 0);
    몫.push(`이번에 돌린 것: ${셈.돌린것 ?? 0}개${셈.실패한것 ? ` (실패 ${셈.실패한것}개)` : ''}`
      + `\n확인된 파일 ${확인}개 · 확인 안 된 파일 ${셈.증명안됨 ?? 0}개`);
  }
  몫.push(`바뀐 파일:\n${통계 || 파일들.map((f) => `- ${f}`).join('\n')}`);
  몫.push(`----- diff -----\n${자른diff}`);
  if (제목) 몫.push(`제목은 이미 정해졌다: "${제목}"\n제목은 그대로 두고 본문만 써라.`);
  몫.push(제목 ? '본문만 답하라. 다른 말은 붙이지 마라.' : 답형식);

  try {
    const r = await chat(session.conn, {
      messages: [
        { role: 'system', content: 지시 },
        { role: 'user', content: 몫.join('\n\n') },
      ],
      maxTokens: 700,
      think: session.conn.kind === 'ollama' ? false : 'low',
      json: 제목 ? null : (session.conn.json ? 스키마 : null),
      signal,
      onBackoff,
      timeout: 60000,
    });
    const 글 = (r?.content ?? '').trim();
    if (!글) return null;
    if (제목) {
      // 본문만 달라고 했어도 작은 모델은 `제목:`/`본문:` 꼴을 그대로 흉내 낸다.
      // 그걸 그대로 본문에 넣으면 커밋 안에 '제목:' 이라는 줄이 남는다.
      const 갈린 = /^\s*제목\s*[:：]/m.test(글) ? 답가르기(글) : null;
      // `제목:` 없이 `본문:` 표식만 붙여 답하기도 한다 — 그 표식도 떼야 커밋 첫 줄에 안 남는다 (6회차 커밋 C9).
      return { 제목, 본문: 갈린?.본문 ?? 껍질벗기기(글).replace(/^\s*본문\s*[:：]\s*/, '') };
    }
    return 답가르기(글);
  } catch (err) {
    if (err?.name === 'Aborted' || signal?.aborted) return { 중단: true };
    return null;
  }
}

/**
 * 커밋할 것을 준비한다. 화면은 안 그린다 — 부르는 쪽이 그린다.
 *
 * @returns {Promise<object>} ok:false 면 why 한 줄만 보고 끝내면 된다.
 */
export async function 커밋준비(session, ctx, { 전부 = false, 제목 = null, signal = null, onBackoff = null } = {}) {
  // 링크를 먼저 푼다. git 은 푼 자리로 답하므로, 우리도 같은 이름으로 말해야
  // "바꾼 것이 없습니다" 라는 거짓말이 안 나온다.
  const 여기 = 진짜(ctx?.scope?.root ?? session?.root ?? process.cwd());
  if (!깃있나(여기)) return { ok: false, why: 'git 을 못 찾았습니다 — PATH 에 git 이 있어야 합니다.' };
  const 뿌리 = 진짜(저장소뿌리(여기) ?? '');
  if (!저장소뿌리(여기)) return { ok: false, why: '여기는 git 저장소가 아닙니다 — `git init` 부터 하세요.' };

  const 미리담긴 = 담긴것(뿌리).파일들;      // 남이 먼저 담아 둔 것. 풀지 않고 알리기만 한다.
  const 내것 = 이번에바꾼것(session, 뿌리);
  // 딴 저장소 안만 바꿨으면 「바꾼 파일이 없다」 가 아니다 — 어디서 커밋해야 하는지 말한다 (6회차 커밋 C2).
  if (!전부 && !내것.length && !미리담긴.length && 내것.딴저장소.length) {
    return { ok: false, why: `딴 저장소(${내것.딴저장소.slice(0, 4).join(', ')}) 안에서만 바꿨습니다 — 서브모듈·안쪽 저장소는 그 폴더에서 따로 커밋하세요.` };
  }
  // 만들었다 지운 것뿐이면 「바꾼 파일이 없다」 가 아니다 — 무엇을 왜 못 담는지 말한다 (8회차 커밋2).
  if (!전부 && !내것.length && !미리담긴.length && 내것.모르는이름.length) {
    return { ok: false, why: `이번 대화가 만들었다 지운 것(${내것.모르는이름.slice(0, 4).join(', ')})뿐입니다 — git 이 한 번도 본 적 없는 이름이라 담을 것이 없습니다.` };
  }
  if (!전부 && !내것.length && !미리담긴.length) {
    return { ok: false, why: '이번 대화에서 바꾼 파일이 없습니다 — 작업 폴더 전부를 담으려면 `/commit 전부`.' };
  }

  // `전부` 가 미칠 자리 = 작업 폴더. 저장소 뿌리가 아니다 (담기() 머리말).
  const 안쪽 = relative(뿌리, 여기).replace(/\\/g, '/');
  const 살림바뀜 = !!깃(뿌리, ['status', '--short', '--', 글자그대로(안쪽 ? `${안쪽}/${살림폴더}` : 살림폴더)]).out.trim();
  const 담은결과 = 담기(뿌리, 내것, { 전부, 안쪽 });
  if (!담은결과.ok) return { ok: false, why: `담지 못했습니다 — ${(담은결과.err || '').trim() || 'git add 실패'}` };

  // 이름이 다른 링크로 살림이 딸려 들어왔으면 여기서 도로 뺀다.
  const 뺀것 = 살림도로빼기(뿌리, 담긴것(뿌리).파일들);
  if (뺀것.못뺀것.length) {
    return { ok: false, why: `열쇠가 든 자리(${뺀것.못뺀것.join(', ')})가 담긴 채로 안 빠집니다 — 커밋하지 않았습니다.` };
  }

  const { 파일들, 통계, diff, 못읽음 } = 담긴것(뿌리);
  /*
   * **목록**을 못 읽었으면 「없다」 가 아니다.
   *
   * 깨진 index·잠긴 저장소에서 이 자리는 여태 「바뀐 내용이 없습니다」 를
   * 냈다. 사람은 제 일이 안 담긴 줄 알고 다시 담으러 가는데, 실제로 할 일은
   * 저장소를 손보는 것이다. 까닭을 그대로 옮긴다.
   */
  const 목록못읽음 = 못읽음.find((x) => x.무엇 === '목록');
  if (목록못읽음) {
    return { ok: false, why: `git 이 담긴 것을 못 읽었습니다 — ${목록못읽음.왜}` };
  }
  if (!파일들.length) return { ok: false, why: '담을 것이 없습니다 — 바뀐 내용이 없습니다.' };
  // 몸통(diff)만 죽는 판이 따로 있다 — 64MB 를 넘으면 그렇다. 파일 목록은
  // 멀쩡하므로 커밋 자체는 이어 가되, **모델에게도 화면에도** 못 봤다고 말한다.
  const diff못읽음 = 못읽음.find((x) => x.무엇 === 'diff')?.왜 ?? null;

  const 증거 = (() => { try { return 증거모으기(session, { audit: ctx?.audit }); } catch { return null; } })();
  const 미확인 = 증거?.셈?.증명안됨 ?? 0;
  const 확인 = 증거?.셈 ? (증거.셈.파일 ?? 0) - 미확인 : 0;

  const 지은것 = await 메시지짓기(session, { 뿌리, diff, 통계, 파일들, 증거, 제목, signal, onBackoff, diff못읽음 });
  if (지은것?.중단) return { ok: false, why: '중단했습니다 — 담긴 것은 그대로 둡니다.', aborted: true };

  const 사실 = !지은것;
  const { 제목: 날제목, 본문: 날본문 } = 지은것 ?? 사실로만(파일들, 통계);
  /*
   * 모델이 지은 제목에도 꼬리표를 건다 (8회차 커밋 2).
   *
   * 본문은 메시지꾸리기() 가 거르는데 제목만 맨몸으로 나갔다. 모델이
   * `Fixes #123` 한 줄을 제목으로 주면 그게 커밋 첫 줄이 되고, 그 커밋이 기본
   * 가지에 실리는 순간 **깃허브가 그 이슈를 진짜로 닫는다** — 지어낸 번호면 남의
   * 이슈가 닫히고, 커밋을 되돌려도 닫힌 이슈는 안 열린다.
   * 걸러 내고 남는 것이 없으면 지어낸 제목 대신 사실만 적는다.
   *
   * 사람이 제 손으로 준 제목(`제목`)은 안 건드린다 — 그건 사람 뜻이고, 화면에
   * 미리 보여 준 것과 찍히는 것이 달라지면 승인을 받은 뜻이 없어진다.
   */
  const 고른제목 = 제목 ?? (꼬리표걸러내기(날제목) || 사실로만(파일들, 통계).제목);
  const 다듬 = 제목다듬기(고른제목);
  if (!다듬.제목) return { ok: false, why: '커밋 제목을 만들지 못했습니다.' };
  const 본문 = [다듬.남은것, 날본문].filter(Boolean).join('\n\n');

  const 메시지 = 메시지꾸리기({
    제목: 다듬.제목,
    본문,
    확인,
    미확인,
    모델: session?.conn?.model ?? '',
  });

  const 상태 = 깃(뿌리, ['status', '--short']).out.trimEnd();
  return {
    ok: true,
    뿌리,
    제목: 다듬.제목,
    본문,
    메시지,
    파일들,
    통계,
    상태,
    확인,
    미확인,
    // 이 두 줄이 화면에서 사람이 놀랄 자리를 미리 말해 준다.
    남의것: 미리담긴.filter((f) => !내것.includes(f) && !전부),
    살림뺌: 살림바뀜 || 뺀것.샌것.length > 0,
    링크로샌것: 뺀것.샌것,
    폴더통째: 전부 ? [] : (내것.폴더 ?? []),
    // 서브모듈·안쪽 저장소 안에서 바뀐 것 — 안 담았다고 화면이 말한다 (6회차 커밋 C2).
    딴저장소: 전부 ? [] : (내것.딴저장소 ?? []),
    /*
     * 만들었다 지워서 git 이 끝내 못 본 이름 — 조용히 빼면 사람은 담긴 줄 안다 (8회차 커밋2).
     *
     * 담긴 것에 이미 들어 있는 이름은 여기서 뺀다. 삭제가 **먼저 담겨 있던**
     * 파일은 index 에서도 이름이 사라져 위 그물에 같이 걸리는데, 그건 이번
     * 커밋에 제대로 실린다 — 실린 것을 「안 담았습니다」 라고 말하면 그것도 거짓이다.
     */
    모르는이름: 전부 ? [] : (내것.모르는이름 ?? []).filter((f) => !파일들.includes(f)),
    // git 이 답을 못 한 것. 화면이 그대로 말한다 — 못 본 것을 안 본 척하면
    // 메시지가 무엇을 근거로 쓰였는지가 사라진다.
    diff못읽음,
    // 물어보는 사이에 담긴 것이 바뀌었는지 다시 보라고. 보여 준 것과 다른 것을
    // 찍으면 승인을 받은 뜻이 없어진다.
    다시확인: () => 담긴것(뿌리).파일들,
    사실로만: 사실,
  };
}

/** 진짜로 찍는다. 메시지는 파일로 넘긴다 — 따옴표 사고가 여기서 사라진다. */
export function 커밋실행(뿌리, 메시지, { audit = null, 파일들 = [], 제목 = '' } = {}) {
  const 임시 = join(tmpdir(), `deel-commit-${randomBytes(6).toString('hex')}.txt`);
  try {
    // 잠깐 있다 지워지는 파일이지만 본인만 읽게 둔다 — 여러 사람이 쓰는
    // 리눅스 서버에서 /tmp 는 남의 눈앞이다.
    writeFileSync(임시, 메시지, { encoding: 'utf8', mode: 0o600 });
    const r = 깃(뿌리, ['commit', '--file', 임시, '--cleanup=whitespace']);
    if (!r.ok) return { ok: false, why: (r.err || r.out || 'git commit 실패').trim() };
    const h = 깃(뿌리, ['rev-parse', '--short', 'HEAD']);
    const hash = h.ok ? h.out.trim() : '';
    audit?.write?.('commit', { hash, files: 파일들, title: 제목 });
    return { ok: true, hash, out: r.out.trim() };
  } catch (err) {
    return { ok: false, why: err.message };
  } finally {
    try { unlinkSync(임시); } catch { /* 지워졌으면 그만 */ }
  }
}
