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
import { writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
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
export function 이번에바꾼것(session, 뿌리) {
  const 기준 = 진짜(뿌리);
  const 것들 = [];
  const 폴더들 = [];
  for (const p of (session?.changes?.keys?.() ?? [])) {
    const abs = 진짜(isAbsolute(p) ? p : join(기준, p));
    const rel = relative(기준, abs).replace(/\\/g, '/');
    // 저장소 밖은 담지 않는다. `..` 로 시작하면 밖이다.
    // (지워진 파일도 여기서 안 새어 나간다 — 진짜() 가 있는 데까지 풀어 준다.)
    if (!rel || rel.startsWith('../') || rel === '..') continue;
    if (살림경로인가(rel) || 살림에닿나(abs)) continue;
    let 폴더인가 = false;
    try { 폴더인가 = statSync(abs).isDirectory(); } catch { /* 지워진 것은 파일로 친다 */ }
    if (폴더인가) { if (!폴더들.includes(rel)) 폴더들.push(rel); continue; }
    if (!것들.includes(rel)) 것들.push(rel);
  }
  것들.sort();
  Object.defineProperty(것들, '폴더', { value: 폴더들.sort(), enumerable: false });
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
  if (전부) return 깃(뿌리, ['add', '-A', '--', 안쪽 || '.', ...살림빼기]);
  if (!경로들.length) return { ok: true, code: 0, out: '', err: '' };
  return 깃(뿌리, ['add', '-A', '--', ...경로들, ...살림빼기]);
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
  const r = 깃(뿌리, ['restore', '--staged', '--', ...샌것]);
  if (!r.ok) 깃(뿌리, ['rm', '--cached', '-q', '-r', '--', ...샌것]);
  const 아직 = 담긴것(뿌리).파일들.filter((f) => 살림에닿나(join(뿌리, f)));
  return { 샌것, 못뺀것: 아직 };
}

/** 지금 담겨 있는 것. */
export function 담긴것(뿌리) {
  const 이름 = 깃(뿌리, ['diff', '--cached', '--name-only']);
  const 통계 = 깃(뿌리, ['diff', '--cached', '--stat']);
  const 몸통 = 깃(뿌리, ['diff', '--cached']);
  const 파일들 = 이름.out.split('\n').map((x) => x.trim()).filter(Boolean);
  return { 파일들, 통계: 통계.out.trimEnd(), diff: 몸통.out };
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
  let s = String(글 ?? '').trim();
  const 울타리 = s.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (울타리) s = 울타리[1].trim();
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

  const 표 = s.match(/^\s*제목\s*[::]\s*(.+?)\s*$/m);
  if (표) {
    const 뒤 = s.slice(s.indexOf(표[0]) + 표[0].length);
    const 본문표 = 뒤.match(/^\s*본문\s*[::]\s*/m);
    const 본문 = 본문표 ? 뒤.slice(뒤.indexOf(본문표[0]) + 본문표[0].length) : 뒤;
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
const 가짜꼬리표 = /^\s*(signed-off-by|co-authored-by|reviewed-by|acked-by|tested-by|generated-by|claude-session|closes|fixes)\s*:/i;

export function 꼬리표걸러내기(본문) {
  return String(본문 ?? '')
    .split('\n')
    .filter((줄) => !가짜꼬리표.test(줄))
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
  return { 제목: 앞.slice(0, 자를자리).trim(), 남은것: t.slice(자를자리).trim() };
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
export async function 메시지짓기(session, { 뿌리, diff, 통계, 파일들, 증거, 제목 = null, signal = null, onBackoff = null } = {}) {
  const 자른diff = diff.length > DIFF상한
    ? `${diff.slice(0, DIFF상한)}\n… (diff 가 길어 여기서 잘랐습니다 — 나머지는 통계로만 보세요)`
    : diff;
  const 최근 = 최근제목들(뿌리 ?? process.cwd());

  const 몫 = [];
  if (최근.length) 몫.push(`이 저장소의 최근 커밋 제목:\n${최근.map((x) => `- ${x}`).join('\n')}`);
  if (증거) {
    const 확인 = 증거.셈.파일 - 증거.셈.증명안됨;
    몫.push(`이번에 돌린 것: ${증거.셈.돌린것}개${증거.셈.실패한것 ? ` (실패 ${증거.셈.실패한것}개)` : ''}`
      + `\n확인된 파일 ${확인}개 · 확인 안 된 파일 ${증거.셈.증명안됨}개`);
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
      const 갈린 = /^\s*제목\s*[::]/m.test(글) ? 답가르기(글) : null;
      return { 제목, 본문: 갈린?.본문 ?? 껍질벗기기(글) };
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
  if (!전부 && !내것.length && !미리담긴.length) {
    return { ok: false, why: '이번 대화에서 바꾼 파일이 없습니다 — 작업 폴더 전부를 담으려면 `/commit 전부`.' };
  }

  // `전부` 가 미칠 자리 = 작업 폴더. 저장소 뿌리가 아니다 (담기() 머리말).
  const 안쪽 = relative(뿌리, 여기).replace(/\\/g, '/');
  const 살림바뀜 = !!깃(뿌리, ['status', '--short', '--', 안쪽 ? `${안쪽}/${살림폴더}` : 살림폴더]).out.trim();
  const 담은결과 = 담기(뿌리, 내것, { 전부, 안쪽 });
  if (!담은결과.ok) return { ok: false, why: `담지 못했습니다 — ${(담은결과.err || '').trim() || 'git add 실패'}` };

  // 이름이 다른 링크로 살림이 딸려 들어왔으면 여기서 도로 뺀다.
  const 뺀것 = 살림도로빼기(뿌리, 담긴것(뿌리).파일들);
  if (뺀것.못뺀것.length) {
    return { ok: false, why: `열쇠가 든 자리(${뺀것.못뺀것.join(', ')})가 담긴 채로 안 빠집니다 — 커밋하지 않았습니다.` };
  }

  const { 파일들, 통계, diff } = 담긴것(뿌리);
  if (!파일들.length) return { ok: false, why: '담을 것이 없습니다 — 바뀐 내용이 없습니다.' };

  const 증거 = (() => { try { return 증거모으기(session, { audit: ctx?.audit }); } catch { return null; } })();
  const 미확인 = 증거?.셈?.증명안됨 ?? 0;
  const 확인 = 증거 ? 증거.셈.파일 - 미확인 : 0;

  const 지은것 = await 메시지짓기(session, { 뿌리, diff, 통계, 파일들, 증거, 제목, signal, onBackoff });
  if (지은것?.중단) return { ok: false, why: '중단했습니다 — 담긴 것은 그대로 둡니다.', aborted: true };

  const 사실 = !지은것;
  const { 제목: 날제목, 본문: 날본문 } = 지은것 ?? 사실로만(파일들, 통계);
  const 다듬 = 제목다듬기(제목 ?? 날제목);
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
