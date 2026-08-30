// 도구. 이름과 인자를 Claude Code 와 같게 맞춘다 —
// 그래야 그 관례로 쓰인 스킬·명령이 그대로 먹는다.
import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync, statSync, renameSync, cpSync, rmSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { globToRegex, walk, readText, readTextFull, 내부살림 } from './fsutil.js';
import { 건너뜀말 } from './ignore.js';
import { encode, label as encLabel, decode as decodeBytes, consoleCodepage, looksBinary } from './encoding.js';
import { checkCommand, checkPaths, isMutating } from '../safety/guard.js';
import { 띄우기, JOBS_TOOL } from './jobs.js';
import { 셸명령 } from './shell.js';
import { findMatch, applySpans, reindent, TIER_LABELS } from './edit-match.js';
import { loadSkill } from '../skills/discover.js';
import { WEB_FETCH_TOOL } from './webfetch.js';
import { TODO_TOOL } from './todo.js';
import { TASK_TOOL } from './task.js';
import { OUTLINE_TOOL } from './outline.js';
import { VERIFY_TOOL } from './verify.js';
import { DEF_TOOL, REFS_TOOL } from './lsp.js';
import { 편집후진단, 붙이기 as 진단붙이기, 데우기 } from '../lsp/diag.js';
import { 프로젝트갈래 } from '../lsp/servers.js';
import { allow as allowedIn } from '../agent/modes.js';
import { 도구정의, 이름풀기 } from '../backend/mcp.js';
import { isExcelPath, readExcel, toText as excelText, summarize as excelSummary } from './excel.js';
import { isDocPath, readDoc, toText as docText, summarize as docSummary, looksOldHwp, 옛hwp안내, 문서는못고침 } from './docs.js';
import { diffLines } from '../ui/diff.js';
import { 읽을줄수, 찾을개수, 찾을줄수, 설명길이 } from '../agent/budget.js';
import { 도구설명EN } from './desc.en.js';
import { 지시말 } from '../i18n/index.js';

/*
 * 한 번에 돌려줄 양은 **모델에 맞춰** 정한다 (agent/budget.js).
 *
 * 전에는 못 박혀 있었다 — Read 2,000줄, Glob 200개, Grep 250줄. 그 값이 맞는
 * 모델은 하나도 없다. 8k 짜리에는 한 번으로 창을 넘기는 양이고, 655k 짜리에는
 * 있는 자리의 1%도 안 쓰는 양이다. 같은 숫자가 한쪽에선 너무 크고 다른 쪽에선
 * 너무 작으면, 숫자를 잘못 고른 게 아니라 고정한 것 자체가 틀린 것이다.
 *
 * ctx.모델컨텍스트 가 없으면(검사·일회성 호출) budget.js 가 알아서 기본값을 쓴다.
 */
const MAX_OUT = 30000;
// Grep 이 열어 볼 파일 크기 상한. 이보다 크면 글 파일이라도 안 본다 —
// 한 파일에서 몇십 초를 쓰면 그동안 화면이 멈춘 것처럼 보인다.
const GREP_MAX_FILE = 2 * 1024 * 1024;
// 정규식으로 찾을 것이 없는 파일들. 열어 봐야 시간만 든다.
const 안읽을확장자 = /\.(png|jpe?g|gif|bmp|ico|webp|svgz|pdf|zip|gz|tgz|7z|rar|exe|dll|so|dylib|bin|dat|db|sqlite3?|woff2?|ttf|otf|eot|mp[34]|wav|avi|mov|mkv|class|jar|pyc|pyo|o|a|lib|pack|idx|map|min\.js|min\.css|lock)$/i;
// 이보다 큰 파일은 바뀐 자리를 안 재고 넘어간다. 화면에 못 담을 양이기도 하고,
// 재는 값보다 기다리는 값이 커진다.
const MAX_DIFF_CHARS = 4_000_000;

/**
 * 고치기 전후를 견줘서 화면에 그릴 거리를 만든다.
 *
 * 여기서 절대 죽으면 안 된다 — 파일은 이미 고쳐졌다. 보여주다 터져서
 * '고쳐졌는지 아닌지 모르는' 상태로 끝나는 게 최악이다. 그래서 통째로 감싼다.
 */
function 바뀐자리(before, after) {
  try {
    const 양 = (before?.length ?? 0) + (after?.length ?? 0);
    if (양 > MAX_DIFF_CHARS) return null;
    const d = diffLines(before, after);
    return d.changed ? d : null;
  } catch { return null; }
}

function clip(s, n = MAX_OUT) {
  const t = String(s);
  return t.length > n ? t.slice(0, n) + `\n… (${t.length - n}자 잘림)` : t;
}

const 몇KB = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`);

/*
 * ── 파일에 박힌 그림을 빼고 읽는다 ──────────────────────────────────────
 *
 * 사내 업무용 HTML 은 그림을 파일 안에 base64 로 박아 넣는다(사내망 문서가
 * 다 그렇다). 그러면 919줄짜리 문서가 5MB 가 된다. 줄 수는 멀쩡한데 한 줄이
 * 메가바이트다.
 *
 * 이걸 그대로 실어 보내면 이렇게 된다 — 실제로 재 본 값이다:
 *
 *   919줄 문서, 결과 상한 30,000자
 *   → 모델이 보는 것: **8줄**. 그중 99%가 base64.
 *
 * 여덟 줄로는 아무것도 못 한다. 그래서 모델은 같은 파일을 열한 번 읽고,
 * 그러고도 못 봐서 결국 이런 명령을 쓴다 —
 *
 *   node -e "s.replace(/data:image\/[\s\S]*?base64,[^\"']+/g,'data:[omitted]')"
 *
 * **base64 를 지워야 읽을 수 있다는 것을 모델이 스스로 알아낸 것이다.**
 * 그런데 그 명령마저 울타리에 막혔다(정규식을 경로로 읽었다 — guard.js).
 * 한 요청에 몇 분이 가고 아무것도 안 바뀐 화면이 그렇게 나왔다.
 *
 * 그러니 모델이 할 일이 아니라 여기서 할 일이다. 그림 자리는 몇 바이트인지만
 * 남기고 뺀다 — 모델에게 필요한 것은 그림의 바이트가 아니라 **문서의 뼈대**다.
 *
 * ── 지우는 게 아니다 ────────────────────────────────────────────────────
 *
 * 파일은 한 글자도 안 바뀐다. 실어 보내는 값만 줄인다. Edit 은 파일을 직접
 * 보므로 그림이 든 줄도 그대로 고칠 수 있다 — 다만 생략된 자리를 그대로 베껴
 * old_string 에 넣으면 안 맞는다. 그래서 생략했다는 것을 결과에 또렷이 적는다.
 */
const 그림자리 = /(data:[\w.+-]+\/[\w.+-]+(?:;[\w.+-]+=[\w.+-]+)*;base64,)([A-Za-z0-9+/=\s]{200,})/g;

export function 붙박이그림줄이기(줄들) {
  let 줄인바이트 = 0;
  let 몇개 = 0;
  const 나온것 = 줄들.map((l) => String(l).replace(그림자리, (_, 앞, 몸) => {
    줄인바이트 += 몸.length;
    몇개++;
    return `${앞}…(${몇KB(몸.length)} 생략)…`;
  }));
  const 알림 = 몇개
    ? `\n\n[박힌 그림 ${몇개}개(${몇KB(줄인바이트)})를 빼고 보여 줍니다. 파일은 그대로입니다 —`
      + ' 생략 표시가 든 줄을 Edit 의 old_string 으로 그대로 쓰면 안 맞습니다.'
      + ' 그 줄을 고쳐야 하면 생략된 자리를 뺀 앞뒤 짧은 조각으로 가리키세요.]'
    : '';
  return { 줄들: 나온것, 알림, 줄인바이트, 몇개 };
}

// 엑셀 파일에 쓰려 할 때 하는 말. 왜 안 되는지와, 그럼 어떻게 하는지를 같이 준다.
/**
 * 이 자리에 글을 써 넣으면 안 되는 파일인가.
 *
 * 그림·hwp·pdf·zip 처럼 글이 아닌 파일을 Write 로 덮어쓰면 그 파일은 그 순간
 * 끝난다. 확장자만 그대로인 다른 물건이 되어 열리지도 않는다. 되돌리기도
 * 이런 파일은 내용을 떠 놓지 못하니(undo.js safeRead) 되살릴 방법이 없다.
 *
 * 실제로 있던 길이 이랬다 — hwp 를 정리해 달라고 함 → Read 가 '바이너리' 로
 * 실패 → 모델이 Write 로 새로 씀 → 원본 없어짐 → /undo → 잔해까지 사라짐.
 *
 * 확장자 목록으로 고르지 않는다. 사내 파일은 확장자가 제각각이고, 목록에 없는
 * 것이 반드시 나온다. 내용을 보고 정하면 목록을 관리할 일이 없다.
 * @returns {string|null} 막을 이유. 써도 되면 null.
 */
function 바이너리인가(abs) {
  if (!existsSync(abs)) return null;
  let buf;
  try { buf = readFileSync(abs); } catch { return null; }
  if (!looksBinary(buf)) return null;
  return `글이 아닌 파일입니다 — 덮어쓰면 되살릴 수 없습니다.\n`
    + '  그림·hwp·pdf·압축파일 같은 것을 글로 덮어쓰면 그 파일은 그대로 끝납니다.\n'
    + '  되돌리기도 이런 파일은 내용을 떠 두지 못해서 /undo 로도 못 되돌립니다.\n'
    + '  정말 이 자리를 바꿔야 한다면 사용자에게 직접 물어보고, 다른 이름으로 새로 만드세요.';
}

/** 이 파일이 무슨 인코딩인지. 아직 Read 로 안 읽은 파일을 이어 쓸 때 쓴다. */
function 재는인코딩(abs) {
  try { return decodeBytes(readFileSync(abs)).encoding; } catch { return 'utf-8'; }
}

/**
 * 이 파일이 지금 실제로 어떤 상태인가.
 *
 * 턴이 끝날 때 '만들었습니다' 라는 말이 사실인지 확인하는 데 쓴다. 모델은
 * 도구가 실패해도 "만들었습니다" 라고 답하는 일이 있다. 사용자는 그 말을
 * 믿고 다음 일로 넘어간다 — 파일은 없는데. 그러니 말이 아니라 디스크를 본다.
 */
export function 파일현황(abs) {
  try {
    const st = statSync(abs);
    if (st.isDirectory()) return { path: abs, dir: true };
    return { path: abs, bytes: st.size, lines: 줄수(abs, null) };
  } catch { return { path: abs, missing: true }; }
}

// Bash 한 번에 이만큼까지만 떠 둔다. `rm` 에 파일 이름 백 개를 늘어놓는 일이
// 없지는 않은데, 그때 백 벌을 뜨면 되돌리기 이력이 그 한 번으로 밀려난다.
const 스냅샷상한 = 24;

/**
 * 명령줄에서 **떠 둘 만한** 낱말을 고른다.
 *
 * guard.js 의 경로낱말() 을 안 쓴다. 그쪽은 슬래시가 든 것만 경로로 본다 —
 * 울타리를 지키는 쪽에서는 그게 맞다. 안 걸린 것을 막아 버리면 멀쩡한 명령이
 * 막히기 때문이다. 그런데 `del 지울것.txt` 처럼 **슬래시 없는 파일 이름**이
 * 실제로 제일 흔하고, 그것들이 통째로 빠졌다.
 *
 * 여기는 막는 자리가 아니라 **읽는** 자리라 반대로 잡는다. 넓게 훑고,
 * 실제로 그 자리에 파일이 있을 때만 뜬다. 헛다리를 짚어도 손해가 없다 —
 * 없는 파일은 그냥 넘어간다.
 */
function 뜰만한낱말(cmd) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|[^\s|;&<>()]+/g;
  let m;
  while ((m = re.exec(String(cmd)))) {
    let t = m[1] ?? m[2] ?? m[0];
    if (!t) continue;
    if (t.startsWith('-')) continue;                    // 옵션
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) continue;   // 주소
    t = t.replace(/^[<>]+/, '');
    // 셸이 푸는 자리표·와일드카드는 여기서 못 편다. 억지로 풀면 엉뚱한
    // 파일을 뜨게 되므로 그냥 넘긴다 — 대신 못 떴다는 사실이 결과에 남는다.
    if (!t || /[$%*?]/.test(t)) continue;
    out.push(t);
  }
  return out;
}

/**
 * 파일을 바꾸는 Bash 명령이면, 손대기 전 내용을 떠 둔다.
 *
 * 여기가 없으면 `mv`·`rm` 으로 사라진 것을 /undo 가 못 살린다. Write·Edit 만
 * 지키는 안전망은 절반짜리다 — 모델은 파일을 옮길 때 당연히 Bash 를 쓴다.
 *
 * **못 뜨는 것이 있다는 사실을 숨기지 않는다.** 셸이 푸는 와일드카드(`rm *.tmp`),
 * 스크립트 안에서 지우는 것, 폴더 통째는 여기서 안 보인다. 그래서 결과에
 * '이건 되돌릴 수 있다' 는 말을 붙이지 않고, 뜬 개수만 사실대로 넘긴다.
 *
 * @returns {string[]} 떠 둔 파일들의 보인 이름
 */
function 바꾸기전스냅샷(cmd, ctx) {
  if (!isMutating(cmd)) return [];
  const 뜬것 = [];
  for (const t of 뜰만한낱말(cmd)) {
    if (뜬것.length >= 스냅샷상한) break;
    let abs;
    // 범위 밖은 어차피 checkPaths 가 이미 막았다. 여기서 터지면 안 된다 —
    // 뜨는 데 실패했다고 명령 자체를 막으면 안 되는 명령까지 막힌다.
    try { abs = ctx.scope.resolve(t); } catch { continue; }
    try {
      if (!existsSync(abs) || statSync(abs).isDirectory()) continue;
      ctx.history.snapshot(abs, 'Bash');
      뜬것.push(ctx.scope.show(abs));
    } catch { /* 못 뜨면 그냥 넘어간다. 명령은 돌아야 한다 */ }
  }
  return 뜬것;
}

/** 지금 파일이 몇 줄인가. 붙인 뒤 '얼마나 찼는지' 를 사실로 말해 주려고 센다. */
function 줄수(abs, 인코딩) {
  try {
    const buf = readFileSync(abs);
    if (looksBinary(buf)) return 0;
    const t = 인코딩 && 인코딩 !== 'utf-8' ? decodeBytes(buf).text : buf.toString('utf8');
    return t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
  } catch { return 0; }
}

/**
 * 그 줄과 앞뒤 몇 줄. Edit 이 빗나갔을 때 보여 줄 것.
 *
 * 줄 번호를 같이 붙인다 — 모델이 "몇 번 줄" 로 세어 다시 잡을 수 있어야 한다.
 * 한 줄만 보여 주던 것을 넓힐 때, 넓힌 만큼 자리를 먹으니 짧게 자른다.
 */
function 둘레(text, 줄번호, 보일줄 = 1) {
  const 줄들 = String(text ?? '').split('\n');
  const 가운데 = Math.max(1, Number(줄번호) || 1);
  const 반 = Math.floor(Math.max(1, 보일줄) / 2);
  const 처음 = Math.max(1, 가운데 - 반);
  const 끝 = Math.min(줄들.length, 처음 + Math.max(1, 보일줄) - 1);
  const out = [];
  for (let i = 처음; i <= 끝; i++) {
    const 표 = i === 가운데 ? '→' : ' ';
    out.push(`  ${표} ${String(i).padStart(5)} | ${줄들[i - 1].slice(0, 120)}`);
  }
  return out.join('\n');
}

function 엑셀은못고침(보인이름) {
  return `엑셀 파일은 이 도구로 고칠 수 없습니다: ${보인이름}\n`
    + '  읽기만 됩니다 (CSV 로 바꿔서 보여줍니다). 서식·수식·차트가 든 파일을\n'
    + '  CSV 로 왕복시키면 반드시 뭔가 잃기 때문입니다.\n'
    + '  값을 바꿔야 한다면 CSV 로 따로 내보내 작업하거나, 엑셀에서 직접 고치세요.';
}

/**
 * 엑셀 파일을 표로 읽어 돌려준다.
 *
 * 되돌려 쓰지 않으므로 ctx.enc 에 인코딩을 적지 않는다 — 적어 두면 나중에
 * Edit 이 '이 파일 고칠 수 있다' 고 오해한다. ctx.seen 에도 안 넣는 이유가 같다.
 * 엑셀 파일은 이 도구로 고치는 물건이 아니다.
 */
async function 엑셀읽기(abs, args, ctx) {
  const r = await readExcel(abs, { askPassword: ctx.askPassword ?? null });
  if (!r.ok) return { error: r.error };

  const { text, 잘림 } = excelText(r.sheets);
  const 말 = [...(r.notes ?? []), ...잘림];
  return {
    content: clip(
      `${text}\n\n(엑셀 파일을 CSV 로 바꿔서 보여준 것입니다. 이 파일은 Edit/Write 로 고칠 수 없습니다.)`
      + (말.length ? `\n(${말.join(' · ')})` : ''),
    ),
    summary: excelSummary(r.sheets, r.how) + (잘림.length ? ` · 일부만` : ''),
  };
}


/**
 * 문서(hwpx·docx·pptx)를 글로 읽어 돌려준다.
 *
 * 엑셀읽기와 같은 규칙 — ctx.seen 에 안 넣는다. 넣으면 Edit 이 '이 파일 고칠
 * 수 있다' 고 오해한다. 문서는 이 도구로 고치는 물건이 아니다.
 */
function 문서읽기(abs, ctx) {
  const r = readDoc(abs);
  if (!r.ok) return { error: r.error };
  const { text, 잘림 } = docText(r.덩이들);
  return {
    content: clip(
      `${text || '(빈 문서입니다 — 글이 없습니다.)'}

(${r.갈래} 문서를 글로 바꿔서 보여준 것입니다. 이 파일은 Edit/Write 로 고칠 수 없습니다.)`
      + (잘림.length ? `
(${잘림.join(' · ')})` : ''),
    ),
    summary: docSummary(r) + (잘림.length ? ' · 일부만' : ''),
  };
}

/**
 * 파일 하나를 쓴다 — Write 의 알맹이.
 *
 * 되돌리기 스냅샷을 **여기서** 뜬다. 여러 개를 쓸 때도 파일마다 한 번씩 뜨는
 * 것이 중요하다. 한 덩이로 뜨면 `/undo` 가 전부-아니면-전무가 되어, 넷 중
 * 하나만 잘못 만들었을 때 나머지 셋까지 날려야 한다.
 */
/*
 * ── 하나 옮기기 ─────────────────────────────────────────────────────────
 *
 * 되돌리기는 **내용을 떠 놓는** 방식이다(safety/undo.js). 옮기기는 그 틀에
 * 이렇게 얹는다: 떠난 자리와 닿을 자리를 **둘 다** 뜬다.
 *
 *   떠난 자리 — 내용이 떠지니 되돌리면 그 자리에 다시 쓰인다
 *   닿을 자리 — 없던 파일이라 null 로 떠지고, 되돌리면 지워진다
 *
 * 둘이 합쳐져야 '옮기기 전' 이 된다. 하나만 뜨면 되돌린 뒤 파일이 두 군데
 * 있거나(닿을 자리를 안 뜬 경우) 한 군데도 없다(떠난 자리를 안 뜬 경우).
 *
 * 그림·zip 같은 바이너리는 내용을 못 뜬다(skipped). 그때 되돌리기는 그 파일을
 * **손대지 않는다** — 옮겨진 자리에 그대로 남는다. 되돌아가지는 않지만
 * 없어지지도 않는다. 안전망이 파일을 지우는 것보다 이쪽이 낫다.
 */
function 한개옮기기({ from, to, overwrite = false }, ctx) {
  if (typeof from !== 'string' || !from) return { error: 'from 이 없습니다' };
  if (typeof to !== 'string' || !to) return { error: 'to 가 없습니다' };

  const 앞 = ctx.scope.resolve(from);
  const 뒤 = ctx.scope.resolve(to);
  if (!existsSync(앞)) return { error: `없는 파일입니다: ${from}` };
  if (앞 === 뒤) return { error: `옮길 자리가 지금 자리와 같습니다: ${from}` };

  // 읽기만 막고 옮기기를 열어 두면 .deel/config.json 을 옮겨 연결을 끊을 수 있다.
  for (const p of [앞, 뒤]) { const 왜 = 내부살림(p); if (왜) return { error: 왜 }; }

  const 폴더인가 = statSync(앞).isDirectory();
  /*
   * 폴더를 **제 안으로** 옮기면 그 폴더가 통째로 사라진다 (`mv a a/b`).
   * 셸에서도 잘 나는 사고라 여기서 막는다.
   */
  if (폴더인가 && (뒤 + sep).startsWith(앞 + sep)) {
    return { error: `폴더를 제 안으로 옮길 수 없습니다: ${from} → ${to}` };
  }

  /*
   * 닿을 자리에 이미 있으면 **기본값은 거절**이다.
   *
   * 조용히 덮어쓰면 그 파일 내용이 그 자리에서 없어진다. 구조를 바꾸는 일은
   * 파일을 스무 개씩 옮기는 일이라, 이름이 겹치는 것이 드물지 않다.
   * 겹쳤다고 알려 주면 모델이 이름을 고쳐서 다시 부른다.
   */
  if (existsSync(뒤) && !overwrite) {
    return { error: `이미 있습니다: ${to}\n  덮어쓰려면 overwrite: true 를 주세요.` };
  }

  /*
   * 되돌릴 수 있게 뜬다.
   *
   * 폴더면 안의 파일을 하나씩 짝지어 뜬다. walk 는 node_modules 같은 것을
   * 건너뛰므로(fsutil.js 의 SKIP_DIRS) 그 안은 이력에 안 남는다 — 옮기기는
   * 그대로 되지만 되돌리기에는 안 잡힌다. 그런 폴더를 되돌리자고 수만 개를
   * 뜨는 쪽이 훨씬 나쁘다.
   */
  // 옮길 때는 .gitignore 를 안 본다 — 옮겨지는 것은 전부이고, 되돌리기도 전부를 떠야 한다.
  const 짝들 = 폴더인가
    ? walk(앞, { ignore: false }).map((f) => [f.path, join(뒤, relative(앞, f.path))])
    : [[앞, 뒤]];
  for (const [a, b] of 짝들) {
    ctx.history.snapshot(a, 'Move');
    ctx.history.snapshot(b, 'Move');
  }

  mkdirSync(dirname(뒤), { recursive: true });
  try {
    renameSync(앞, 뒤);
  } catch (err) {
    /*
     * 드라이브가 다르면 rename 이 안 된다 (윈도우 C: → D:, 리눅스 마운트 경계).
     * 그때만 복사해서 옮긴다. 늘 복사하지 않는 것은 큰 폴더에서 값이 크고,
     * 복사 도중에 끊기면 양쪽에 반씩 남기 때문이다.
     */
    if (err.code !== 'EXDEV') return { error: `못 옮겼습니다: ${err.message}` };
    try {
      cpSync(앞, 뒤, { recursive: true });
      rmSync(앞, { recursive: true, force: true });
    } catch (err2) {
      return { error: `못 옮겼습니다: ${err2.message}` };
    }
  }

  for (const [, b] of 짝들) ctx.seen.add(b);
  const 무엇 = 폴더인가 ? `폴더 ${짝들.length}개 파일` : '';
  return {
    content: `옮김: ${ctx.scope.show(앞)} → ${ctx.scope.show(뒤)}${무엇 ? ` (${무엇})` : ''}`,
    summary: `${ctx.scope.show(뒤)}`,
    changed: 뒤,
  };
}

/** 여러 개를 한 번에. 하나가 막혀도 나머지는 옮기고, 무엇이 막혔는지 다 알린다. */
function 여러개옮기기(목록, ctx) {
  const 된것 = [];
  const 안된것 = [];
  for (const 하나 of 목록) {
    const r = 한개옮기기(하나, ctx);
    if (r.error) 안된것.push(`${하나.from ?? '?'} → ${하나.to ?? '?'}: ${r.error}`);
    else 된것.push(r.content);
  }
  /*
   * 하나도 못 옮겼으면 오류로 돌려준다. 그래야 모델이 '됐다' 고 넘어가지
   * 않는다. 하나라도 됐으면 결과로 돌려주되 막힌 것을 그 안에 다 적는다 —
   * 절반만 옮겨진 상태를 모르고 지나가는 것이 제일 나쁘다.
   */
  if (!된것.length) return { error: 안된것.join('\n') || '옮길 것이 없습니다' };
  return {
    content: `${된것.length}개 옮겼습니다${안된것.length ? `, ${안된것.length}개 실패` : ''}.\n`
      + 된것.map((c) => `  ✓ ${c.replace(/^옮김: /, '')}`).join('\n')
      + (안된것.length ? `\n${안된것.map((e) => `  ✗ ${e.split('\n')[0]}`).join('\n')}` : '')
      + (안된것.length ? '\n\n실패한 것만 다시 보내세요. 된 것은 다시 안 보내도 됩니다.' : ''),
    summary: `${된것.length}개 옮김${안된것.length ? ` · ${안된것.length}개 실패` : ''}`,
  };
}

function 한파일쓰기(args, ctx) {
  const abs = ctx.scope.resolve(args.file_path);
    if (typeof args.content !== 'string') return { error: 'content 가 문자열이 아닙니다' };
    // 읽기만 막고 쓰기를 열어 두면 남의 도구 살림을 덮어쓸 수 있다.
    // 제 설정(.deel/config.json)을 덮어쓰면 연결이 통째로 날아간다.
    const 못쓰는이유 = 내부살림(abs);
    if (못쓰는이유) return { error: 못쓰는이유 };
    // 엑셀 파일을 통째로 덮어쓰면 xlsx 가 아니라 그냥 글 파일이 된다.
    // 열리지도 않는 파일이 되고, 원본은 이미 없다. 아예 막는다.
    if (isExcelPath(abs)) return { error: 엑셀은못고침(args.file_path) };
    // 문서(hwpx·docx·pptx)도 같은 이유로 또렷하게 거절한다. 일반 '바이너리'
    // 오류로 넘기면 왜 안 되는지가 안 실려서, 모델이 우회로를 찾는다.
    if (isDocPath(abs)) return { error: 문서는못고침(args.file_path) };
    // 엑셀만 막아서는 모자란다. hwp·pdf·png·zip 도 똑같이 그 순간 끝난다.
    // 게다가 이런 파일은 되돌리기가 내용을 떠 놓지 못하는 종류라 되살릴 길이 없다.
    // 확장자로 고르지 않고 실제 내용으로 본다 — 사내 파일은 확장자가 제각각이다.
    const 바이너리막기 = 바이너리인가(abs);
    if (바이너리막기) return { error: 바이너리막기 };
    ctx.history.snapshot(abs, 'Write');
    const existed = existsSync(abs);
    // 덮어쓰기 전 내용. 바뀐 자리를 보여주려면 지금 떠 놔야 한다.
    // 읽다 터지는 파일(바이너리 등)이면 그냥 없던 셈 친다 — 쓰는 것 자체는 막지 않는다.
    let 이전 = null;
    if (existed) { try { 이전 = readTextFull(abs).text; } catch { 이전 = null; } }
    mkdirSync(dirname(abs), { recursive: true });

    // 원래 있던 파일이면 그 파일이 쓰던 인코딩으로 되돌려 쓴다.
    // 새 파일이면 UTF-8 이다 — 요즘 만드는 파일까지 옛 인코딩으로 둘 이유가 없다.
    const 원래 = existed ? (ctx.enc?.get(abs) ?? 'utf-8') : 'utf-8';
    const 만든것 = encode(args.content, 원래);
    if (만든것.lost.length) {
      return {
        error: `이 파일은 ${encLabel(원래)} 로 되어 있는데, 그 인코딩에 없는 글자가 있습니다: `
             + `${만든것.lost.slice(0, 8).join(' ')}\n`
             + `  그대로 쓰면 그 글자들이 뭉개집니다. 해당 글자를 빼거나, 파일을 UTF-8 로 바꿔도 되는지 사용자에게 물어보세요.`,
      };
    }
    writeFileSync(abs, 만든것.buf);
    ctx.seen.add(abs);
    const n = args.content.split('\n').length;
    const 표기 = 원래 !== 'utf-8' ? ` · ${encLabel(원래)}` : '';
    return {
      content: `${existed ? '덮어씀' : '새로 만듦'}: ${ctx.scope.show(abs)} (${n}줄${표기})`,
      summary: `${n}줄${표기}`,
      changed: abs,
      diff: 바뀐자리(이전, args.content),
    };
}

/**
 * 여러 파일을 한 번에.
 *
 * 하나가 실패해도 나머지는 간다. 첫 실패에서 통째로 멈추면 모델은 무엇이 되고
 * 무엇이 안 됐는지 모른 채 여덟 개를 처음부터 다시 보낸다 — 왕복을 줄이려던
 * 것이 오히려 늘어난다. 그래서 **한 줄씩 다 적어** 돌려준다.
 */
function 여러파일쓰기(목록, ctx) {
  const 결과 = [];
  for (const x of 목록) {
    if (typeof x.file_path !== 'string' || !x.file_path) {
      결과.push({ path: null, ok: false, error: 'file_path 가 없습니다' });
      continue;
    }
    let r;
    try { r = 한파일쓰기(x, ctx); }
    catch (err) { r = { error: String(err?.message ?? err) }; }
    결과.push(r.error
      ? { path: x.file_path, 보인이름: x.file_path, ok: false, error: r.error }
      : {
        path: r.changed,
        보인이름: ctx.scope.show(r.changed),
        ok: true,
        lines: String(x.content ?? '').split('\n').length,
        diff: r.diff,
      });
  }

  const 된것 = 결과.filter((r) => r.ok);
  const 안된것 = 결과.filter((r) => !r.ok);
  const 줄들 = 결과.map((r) => (r.ok
    ? `  ✓ ${r.보인이름} (${r.lines}줄)`
    : `  ✗ ${r.보인이름} — ${String(r.error).split('\n')[0]}`));

  return {
    content: `${된것.length}개 만들었습니다${안된것.length ? `, ${안된것.length}개 실패` : ''}.\n`
      + 줄들.join('\n')
      + (안된것.length ? '\n\n실패한 것만 다시 보내세요. 된 것은 다시 안 보내도 됩니다.' : ''),
    summary: `${된것.length}개 · ${된것.reduce((a, r) => a + (r.lines ?? 0), 0)}줄`
      + (안된것.length ? ` · ${안된것.length}개 실패` : ''),
    // 화면과 루프가 파일별로 처리하도록 그대로 넘긴다. changed 는 안 넣는다 —
    // 넣으면 그 한 개만 세어지고 나머지가 조용히 빠진다.
    여럿: 결과,
    error: 된것.length ? undefined : (안된것[0]?.error ?? '아무것도 못 만들었습니다'),
  };
}

/**
 * 한 군데를 고친다 — Edit 의 알맹이.
 *
 * 결과 모양을 바꾸면 안 된다. changed·diff·tier 를 보고 있는 자리가 셋이다:
 * loop.js 의 잘린 인자 살려쓰기, repl.js 의 바뀐 자리 그리기, 되돌리기 스냅샷.
 */
function 한군데고치기(args, ctx) {
  const abs = ctx.scope.resolve(args.file_path);
  if (!existsSync(abs)) return { error: `파일이 없습니다: ${args.file_path}` };
  const 못고치는이유 = 내부살림(abs);
  if (못고치는이유) return { error: 못고치는이유 };
  // 엑셀 파일은 Read 로 읽히긴 하지만 고칠 수 있는 물건이 아니다.
  // '먼저 Read 로 읽어야 합니다' 라고만 하면 이미 읽은 쪽은 계속 헛돈다.
  if (isExcelPath(abs)) return { error: 엑셀은못고침(args.file_path) };
  if (isDocPath(abs)) return { error: 문서는못고침(args.file_path) };
  if (!ctx.seen.has(abs)) return { error: `먼저 Read 로 읽어야 합니다: ${args.file_path}` };
  if (args.old_string === args.new_string) return { error: 'old_string 과 new_string 이 같습니다' };

  const 읽음 = readTextFull(abs);
  const text = 읽음.text;
  const m = findMatch(text, args.old_string, { replaceAll: !!args.replace_all });

  if (!m.ok) {
    if (m.reason === 'ambiguous') {
      return { error: `${m.count}군데에서 발견됐습니다 (${TIER_LABELS[m.tier]}). 앞뒤로 더 넓게 잡아 하나만 가리키거나 replace_all 을 쓰세요.` };
    }
    /*
     * 비슷한 자리를 몇 줄이나 보여 줄까는 **이 모델을 겪어 본 만큼** 정한다
     * (agent/card.js). Edit 이 자주 빗나가는 모델에는 한 줄만 보여 줘 봐야
     * 다음 시도도 빗나간다 — 앞뒤를 같이 보여 주면 옮겨 담을 것이 분명해진다.
     * 겪은 것이 모자라면 여태처럼 한 줄이다. 자리를 괜히 먹지 않는다.
     */
    const 보일줄 = Math.max(1, ctx?.카드?.조정?.빗나갔을때보일줄 ?? 1);
    const hint = m.near
      ? `\n  파일의 ${m.near.line}번 줄이 가장 비슷합니다:\n${둘레(text, m.near.line, 보일줄)}`
        + '\n  이 줄을 그대로 옮겨 담아 다시 시도하세요.'
      : '\n  Read 로 다시 읽어 실제 내용을 확인하세요.';
    return { error: `찾지 못했습니다.${hint}` };
  }

  ctx.history.snapshot(abs, 'Edit');
  const next = applySpans(text, m.spans, (matched) =>
    m.tier === 'exact' ? args.new_string : reindent(args.new_string, matched, args.old_string));

  // 읽은 그 인코딩으로 되돌려 쓴다.
  const 만든것 = encode(next, 읽음.encoding);
  if (만든것.lost.length) {
    return {
      error: `이 파일은 ${encLabel(읽음.encoding)} 로 되어 있는데, 그 인코딩에 없는 글자를 넣으려 합니다: `
           + `${만든것.lost.slice(0, 8).join(' ')}\n`
           + `  그대로 쓰면 그 글자들이 뭉개집니다. 다른 표현을 쓰거나, 파일을 UTF-8 로 바꿔도 되는지 사용자에게 물어보세요.`,
    };
  }
  writeFileSync(abs, 만든것.buf);

  const n = m.spans.length;
  const how = m.tier === 'exact' ? '' : ` · ${TIER_LABELS[m.tier]}`;
  const 표기 = 읽음.encoding !== 'utf-8' ? ` · ${encLabel(읽음.encoding)}` : '';
  return {
    content: `고침: ${ctx.scope.show(abs)} (${n}군데${how}${표기})`,
    summary: `${n}군데${how}${표기}`,
    changed: abs,
    tier: m.tier,
    diff: 바뀐자리(text, next),
  };
}

/**
 * 여러 군데를 한 번에.
 *
 * **차례로** 적용한다. 같은 파일을 두 번 고치는 경우가 흔한데, 한군데고치기()가
 * 매번 디스크에서 다시 읽으므로 뒤엣것은 앞엣것이 반영된 글을 보고 찾는다.
 * 한꺼번에 계산해서 붙이면 두 자리가 겹칠 때 조용히 어긋난다.
 *
 * 되돌리기는 그대로 한 턴이다. 스냅샷은 파일마다 그 턴의 첫 번만 뜨므로
 * (undo.js snapshot 참고), 같은 파일을 여섯 군데 고쳐도 /undo 한 번이면
 * 여섯 군데 다 손대기 전으로 돌아간다.
 *
 * 하나가 실패해도 나머지는 간다 — 여러파일쓰기() 와 같은 이유다.
 */
function 여러군데고치기(목록, ctx) {
  const 결과 = [];
  for (const x of 목록) {
    if (typeof x.file_path !== 'string' || !x.file_path) {
      결과.push({ path: null, 보인이름: '(경로 없음)', ok: false, error: 'file_path 가 없습니다' });
      continue;
    }
    let r;
    try { r = 한군데고치기(x, ctx); }
    catch (err) { r = { error: String(err?.message ?? err) }; }
    결과.push(r.error
      ? { path: x.file_path, 보인이름: x.file_path, ok: false, error: r.error }
      : {
        path: r.changed,
        보인이름: ctx.scope.show(r.changed),
        ok: true,
        군데: Number(String(r.summary).match(/^(\d+)/)?.[1] ?? 1),
        tier: r.tier,
        diff: r.diff,
      });
  }

  const 된것 = 결과.filter((r) => r.ok);
  const 안된것 = 결과.filter((r) => !r.ok);
  const 줄들 = 결과.map((r) => (r.ok
    ? `  ✓ ${r.보인이름} (${r.군데}군데)`
    : `  ✗ ${r.보인이름} — ${String(r.error).split('\n')[0]}`));

  // 어느 파일이 몇 번 고쳐졌는지. 같은 파일을 여러 번 고치는 것이 보통이라
  // '3개 파일' 이 아니라 '2개 파일 · 5군데' 라고 말해야 사실에 맞는다.
  const 파일수 = new Set(된것.map((r) => r.path)).size;
  const 군데수 = 된것.reduce((a, r) => a + (r.군데 ?? 0), 0);

  return {
    content: `${군데수}군데 고쳤습니다${안된것.length ? `, ${안된것.length}군데 실패` : ''}.\n`
      + 줄들.join('\n')
      + (안된것.length
        ? '\n\n실패한 것만 다시 보내세요. 된 것은 다시 안 보내도 됩니다.'
          + ' 앞엣것이 이미 반영됐으니 **파일을 다시 Read 해서** 지금 내용을 보고 old_string 을 잡으세요.'
        : ''),
    summary: `${파일수}개 파일 · ${군데수}군데` + (안된것.length ? ` · ${안된것.length}개 실패` : ''),
    // 화면과 루프가 자리별로 처리하도록 그대로 넘긴다. changed 는 안 넣는다 —
    // 넣으면 그 한 개만 세어지고 나머지가 조용히 빠진다 (여러파일쓰기 와 같다).
    여럿: 결과,
    error: 된것.length ? undefined : (안된것[0]?.error ?? '아무것도 못 고쳤습니다'),
  };
}

export const TOOLS = {
  Read: {
    schema: {
      name: 'Read',
      description: '파일 하나를 읽는다. 줄 번호가 붙어 돌아온다. 고치기 전에는 반드시 먼저 읽어야 한다.'
        + ' 엑셀 파일(.xlsx/.xlsm/.xls)도 그대로 읽을 수 있다 — 시트별 CSV 로 바꿔서 돌려준다.'
        + ' 한글·워드·파워포인트 문서(.hwpx/.docx/.pptx)도 그대로 읽는다 — 글로 바꿔서 돌려준다.'
        + ' 사용자에게 다른 형식으로 내보내 달라고 할 필요가 없다. 다만 이런 파일들은 읽기만 되고 고칠 수는 없다.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '읽을 파일 경로' },
          offset: { type: 'number', description: '시작 줄 (1부터). 큰 파일에서만 쓴다' },
          limit: { type: 'number', description: '읽을 줄 수' },
        },
        required: ['file_path'],
      },
    },
    run(args, ctx) {
      const abs = ctx.scope.resolve(args.file_path);
      if (!existsSync(abs)) return { error: `파일이 없습니다: ${args.file_path}` };
      if (statSync(abs).isDirectory()) return { error: `폴더입니다. Glob 을 쓰세요: ${args.file_path}` };
      // 제 살림·남의 도구 살림은 안 읽는다 — fsutil 의 내부살림() 머리말 참고.
      const 막을이유 = 내부살림(abs);
      if (막을이유) return { error: 막을이유 };

      // 엑셀 파일은 글이 아니라 압축 꾸러미다. 그냥 읽으면 '바이너리' 로 끝난다.
      // 여기서 표로 바꿔 돌려준다 — 사람이 손으로 CSV 로 내보낼 일이 없게.
      if (isExcelPath(abs)) return 엑셀읽기(abs, args, ctx);
      // hwpx·docx·pptx 도 같다 — 속이 ZIP+XML 이라 글로 바꿔 돌려준다 (docs.js).
      if (isDocPath(abs)) return 문서읽기(abs, ctx);
      /*
       * 구형 hwp 는 '바이너리' 로 끝내지 않는다. 그 오류에는 길이 없어서
       * 모델이 우회로(새로 쓰기)를 찾는다 — 실제로 그렇게 원본이 죽은 적이
       * 있다. 여기서는 hwpx 로 저장하면 읽힌다는 길을 같이 준다.
       */
      if (abs.toLowerCase().endsWith('.hwp')) {
        try {
          const 머리 = readFileSync(abs);
          if (looksOldHwp(abs, 머리)) return { error: 옛hwp안내(ctx.scope.show(abs)) };
        } catch { /* 아래 일반 읽기가 제 오류를 낸다 */ }
      }

      const 읽음 = readTextFull(abs);
      // 무엇으로 읽었는지 기억해 둔다. 나중에 고칠 때 같은 것으로 되돌려 써야 한다.
      // 안 그러면 사내 CP949 문서가 한 번 고치는 것만으로 UTF-8 이 되어 버린다.
      ctx.enc = ctx.enc ?? new Map();
      ctx.enc.set(abs, 읽음.encoding);
      const text = 읽음.text;
      const lines = text.split('\n');
      const start = Math.max(0, (args.offset ?? 1) - 1);
      const 줄상한 = 읽을줄수(ctx.모델컨텍스트);
      const count = Math.min(args.limit ?? 줄상한, 줄상한);
      const slice = lines.slice(start, start + count);
      const 줄인것 = 붙박이그림줄이기(slice);
      const body = 줄인것.줄들.map((l, i) => `${String(start + i + 1).padStart(6)}\t${l}`).join('\n');
      const more = lines.length > start + count ? `\n… 전체 ${lines.length}줄 중 ${start + count}줄까지` : '';
      ctx.seen.add(abs);
      const 별난인코딩 = 읽음.encoding !== 'utf-8';
      return {
        content: clip(body + more + 줄인것.알림),
        summary: `${lines.length}줄`
          + (줄인것.줄인바이트 ? ` · 그림 ${몇KB(줄인것.줄인바이트)} 생략` : '')
          + (별난인코딩 ? ` · ${encLabel(읽음.encoding)}` : ''),
      };
    },
  },

  Write: {
    schema: {
      name: 'Write',
      description: '파일을 새로 쓰거나 통째로 덮어쓴다. 일부만 고칠 때는 Edit 을 쓴다.'
        + ' **여러 파일을 한 번에 만들 수 있다** — files 에 배열로 넣으면 된다.'
        + ' 폴더 구조를 처음 잡을 때는 그렇게 해라. 한 개씩 부르면 파일 수만큼 모델을'
        + ' 다시 불러야 해서, 여덟 개짜리 뼈대에 몇 분이 그냥 간다.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '쓸 파일 경로 (한 개일 때)' },
          content: { type: 'string', description: '파일 전체 내용 (한 개일 때)' },
          files: {
            type: 'array',
            description: '여러 개를 한 번에 만들 때. 이걸 쓰면 file_path·content 는 안 쓴다.',
            items: {
              type: 'object',
              properties: {
                file_path: { type: 'string', description: '쓸 파일 경로' },
                content: { type: 'string', description: '파일 전체 내용' },
              },
              required: ['file_path', 'content'],
            },
          },
        },
        required: [],
      },
    },
    /*
     * 갈래만 정한다. 알맹이는 아래 한파일쓰기() 에 있다.
     *
     * 한 개일 때의 결과 모양은 **한 글자도 안 바꾼다.** 그 모양을 보고 있는
     * 자리가 여럿이다 — loop.js 의 잘린 것 살려쓰기, repl.js 의 바뀐 자리 그리기,
     * 되돌리기 스냅샷. 여러 개는 그것과 다른 모양(여럿)으로 따로 돌려준다.
     */
    run(args, ctx) {
      const 목록 = Array.isArray(args.files) ? args.files.filter((x) => x && typeof x === 'object') : [];
      if (목록.length) return 여러파일쓰기(목록, ctx);
      if (typeof args.file_path !== 'string' || !args.file_path) {
        return { error: 'file_path 가 없습니다. 한 개면 file_path·content 를, 여러 개면 files 배열을 주세요.' };
      }
      return 한파일쓰기(args, ctx);
    },
  },

  Append: {
    schema: {
      name: 'Append',
      description: '파일 끝에 이어 붙인다. 큰 파일은 이렇게 나눠서 만든다.'
        + ' 처음에는 Write 로 앞부분을 만들고, 그 뒤부터는 Append 를 여러 번 불러 끝까지 채운다.'
        + ' 한 번에 다 담으려다 잘리는 것보다 나눠서 확실히 남기는 편이 낫다.'
        + ' Read 로 먼저 읽지 않아도 된다 — 끝에 붙이는 것뿐이라 읽을 이유가 없다.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '이어 붙일 파일 경로' },
          content: { type: 'string', description: '끝에 붙일 내용' },
        },
        required: ['file_path', 'content'],
      },
    },
    run(args, ctx) {
      const abs = ctx.scope.resolve(args.file_path);
      if (typeof args.content !== 'string') return { error: 'content 가 문자열이 아닙니다' };
      if (!args.content) return { error: 'content 가 비었습니다 — 붙일 내용이 없습니다' };
      const 못쓰는이유 = 내부살림(abs);
      if (못쓰는이유) return { error: 못쓰는이유 };
      if (isExcelPath(abs)) return { error: 엑셀은못고침(args.file_path) };
      const 바이너리막기 = 바이너리인가(abs);
      if (바이너리막기) return { error: 바이너리막기 };

      const existed = existsSync(abs);
      if (existed && statSync(abs).isDirectory()) return { error: `폴더입니다: ${args.file_path}` };

      // Append 는 한 턴에 여러 번 불리는 것이 정상이다. 그래도 되돌리기 이력에
      // 사본이 쌓이지 않는다 — History.snapshot 이 턴마다 한 번만 뜬다(undo.js).
      ctx.history.snapshot(abs, 'Append');

      // 원래 있던 파일이면 그 파일이 쓰던 인코딩 그대로 이어 붙인다.
      // 이어 붙이는 조각에는 앞머리 표식(BOM)이 들어가면 안 된다 — 파일 한가운데에
      // BOM 이 박히면 그 자리가 이상한 글자로 보인다. 그래서 표식 없는 이름으로 바꾼다.
      const 원래 = existed ? (ctx.enc?.get(abs) ?? 재는인코딩(abs)) : 'utf-8';
      const 조각인코딩 = 원래 === 'utf-8-bom' ? 'utf-8' : 원래;
      const 만든것 = encode(args.content, 조각인코딩);
      if (만든것.lost.length) {
        return {
          error: `이 파일은 ${encLabel(원래)} 로 되어 있는데, 그 인코딩에 없는 글자가 있습니다: `
               + `${만든것.lost.slice(0, 8).join(' ')}\n`
               + `  그대로 쓰면 그 글자들이 뭉개집니다. 해당 글자를 빼거나, 파일을 UTF-8 로 바꿔도 되는지 사용자에게 물어보세요.`,
        };
      }

      mkdirSync(dirname(abs), { recursive: true });
      if (existed) appendFileSync(abs, 만든것.buf);
      else writeFileSync(abs, 만든것.buf);
      ctx.seen.add(abs);

      const 붙인줄 = args.content.split('\n').length - (args.content.endsWith('\n') ? 1 : 0);
      const 전체줄 = 줄수(abs, 원래);
      const 표기 = 원래 !== 'utf-8' ? ` · ${encLabel(원래)}` : '';
      return {
        content: `${existed ? '이어 붙임' : '새로 만듦'}: ${ctx.scope.show(abs)}`
          + ` (+${붙인줄}줄, 지금 전체 ${전체줄}줄${표기})`,
        summary: `+${붙인줄}줄 · 전체 ${전체줄}줄${표기}`,
        changed: abs,
        // 이어 붙이기는 앞부분이 그대로다. 전후를 통째로 견줄 이유가 없다 —
        // 큰 파일에서 그 비용이 그대로 기다리는 시간이 된다.
        diff: { changed: true, added: 붙인줄, removed: 0, appended: true },
      };
    },
  },

  Edit: {
    schema: {
      name: 'Edit',
      description: '파일에서 정확히 일치하는 문자열을 바꾼다. 먼저 Read 로 읽어야 한다.'
        + ' **고칠 자리가 여럿이면 edits 배열로 한 번에 보내라** — 파일이 서로 달라도 된다.'
        + ' 한 군데씩 부르면 자리 수만큼 모델을 다시 불러야 해서, 여섯 군데짜리 손질에 몇 분이 그냥 간다.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '고칠 파일 경로 (한 군데일 때)' },
          old_string: { type: 'string', description: '바꿀 대상. 파일에서 유일해야 한다' },
          new_string: { type: 'string', description: '바꿀 내용' },
          replace_all: { type: 'boolean', description: '모두 바꾸려면 true' },
          edits: {
            type: 'array',
            description: '여러 군데를 한 번에. 적은 순서대로 차례로 적용된다. 이걸 쓰면 위 인자는 안 쓴다.',
            items: {
              type: 'object',
              properties: {
                file_path: { type: 'string', description: '고칠 파일 경로' },
                old_string: { type: 'string', description: '바꿀 대상' },
                new_string: { type: 'string', description: '바꿀 내용' },
                replace_all: { type: 'boolean', description: '모두 바꾸려면 true' },
              },
              required: ['file_path', 'old_string', 'new_string'],
            },
          },
        },
        required: [],
      },
    },
    /*
     * 갈래만 정한다. Write 와 같은 모양이다 — 한 군데일 때의 결과는 한 글자도
     * 안 바뀐다. 그 모양을 보고 있는 자리가 여럿이라서다(loop.js 의 살려쓰기,
     * repl.js 의 바뀐 자리 그리기, 되돌리기 스냅샷).
     */
    run(args, ctx) {
      const 목록 = Array.isArray(args.edits) ? args.edits.filter((x) => x && typeof x === 'object') : [];
      if (목록.length) return 여러군데고치기(목록, ctx);
      if (typeof args.file_path !== 'string' || !args.file_path) {
        return { error: 'file_path 가 없습니다. 한 군데면 file_path·old_string·new_string 을, 여러 군데면 edits 배열을 주세요.' };
      }
      return 한군데고치기(args, ctx);
    },
  },

  /*
   * ── 파일을 옮긴다 ───────────────────────────────────────────────────────
   *
   * 이게 없어서 「폴더 구조를 역할에 맞게 바꿔 줘」 가 계속 헛돌았다.
   *
   * 도구 목록에 옮기는 것이 없으니 길은 `Bash mv` 하나뿐이었는데, mv 는 위험
   * 명령으로 잡혀 있어서(safety/guard.js 의 MUTATING) 승인 방식에 따라
   * **파일 하나 옮길 때마다** 물었다. 스무 개면 스무 번이다. 게다가 Bash 로
   * 옮긴 것은 되돌리기에 안 잡혀서, /undo 를 눌러도 구조가 안 돌아왔다.
   *
   * 그래서 시키는 일에 맞는 도구가 없었던 것이지, 모델이 말을 안 들은 게
   * 아니었다. 도구를 주면 한 번에 스무 개를 옮기고 되돌리기에도 잡힌다.
   */
  Move: {
    schema: {
      name: 'Move',
      description: '파일·폴더를 옮기거나 이름을 바꾼다. 구조를 바꾸는 일은 이걸로 한다.'
        + ' **여러 개는 moves 배열로 한 번에** — 스무 개를 옮기려고 스무 번 부르지 마라.'
        + ' Bash 의 mv 를 쓰지 마라. 되돌리기에 안 잡히고 매번 승인을 묻는다.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '옮길 파일·폴더 (한 개일 때)' },
          to: { type: 'string', description: '옮겨 갈 자리. 없는 폴더는 만든다 (한 개일 때)' },
          moves: {
            type: 'array',
            description: '여러 개를 한 번에. 이걸 쓰면 from·to 는 안 쓴다.',
            items: {
              type: 'object',
              properties: {
                from: { type: 'string', description: '옮길 파일·폴더' },
                to: { type: 'string', description: '옮겨 갈 자리' },
              },
              required: ['from', 'to'],
            },
          },
          overwrite: {
            type: 'boolean',
            description: '옮겨 갈 자리에 이미 있어도 덮어쓴다. 기본은 false 라 겹치면 거절한다',
          },
        },
        required: [],
      },
    },
    run(args, ctx) {
      const 목록 = Array.isArray(args.moves) ? args.moves.filter((x) => x && typeof x === 'object') : [];
      if (목록.length) {
        return 여러개옮기기(목록.map((m) => ({ ...m, overwrite: m.overwrite ?? args.overwrite })), ctx);
      }
      if (typeof args.from !== 'string' || !args.from) {
        return { error: 'from 이 없습니다. 한 개면 from·to 를, 여러 개면 moves 배열을 주세요.' };
      }
      return 한개옮기기(args, ctx);
    },
  },

  Glob: {
    schema: {
      name: 'Glob',
      description: '이름 패턴으로 파일을 찾는다. 예: **/*.js, src/**/*.{ts,tsx}',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'glob 패턴' },
          path: { type: 'string', description: '찾기 시작할 폴더. 없으면 작업 폴더 전체' },
        },
        required: ['pattern'],
      },
    },
    run(args, ctx) {
      const root = args.path ? ctx.scope.resolve(args.path) : ctx.scope.root;
      const re = globToRegex(args.pattern);
      const 전부 = walk(root);
      // .gitignore 로 건너뛴 것은 수를 말한다 — 조용히 빼면 '그 파일이 없다' 로 읽힌다 (tools/ignore.js).
      const 건너뜀 = 건너뜀말(전부.건너뜀);
      const 맞는것 = 전부
        .filter((f) => re.test(f.rel) || re.test(f.rel.split('/').pop()))
        .sort((a, b) => b.mtime - a.mtime);
      const files = 맞는것.slice(0, 찾을개수(ctx.모델컨텍스트));
      if (!files.length) return { content: `찾은 파일 없음: ${args.pattern}${건너뜀}`, summary: '0개' };
      // 잘랐으면 잘랐다고 말한다. 전에는 '200개' 라고만 해서, 모델이 그게 전부인 줄
      // 알고 "전부 확인했습니다" 로 답을 맺었다. 실제로는 1,400개 중 200개였다.
      const 잘림 = 맞는것.length > files.length
        ? `\n\n… 모두 ${맞는것.length}개인데 최근 것 ${files.length}개만 보여 줍니다. 범위를 좁혀 다시 찾으세요.`
        : '';
      return {
        content: files.map((f) => ctx.scope.show(f.path)).join('\n') + 잘림 + 건너뜀,
        summary: 맞는것.length > files.length ? `${files.length}/${맞는것.length}개` : `${files.length}개`,
      };
    },
  },

  Grep: {
    schema: {
      name: 'Grep',
      description: '파일 내용에서 정규식으로 검색한다.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '정규식' },
          path: { type: 'string', description: '검색할 폴더나 파일' },
          glob: { type: 'string', description: '대상 파일 제한. 예: **/*.js' },
          output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'], description: '기본 files_with_matches' },
          '-i': { type: 'boolean', description: '대소문자 무시' },
          '-n': { type: 'boolean', description: '줄 번호 표시' },
          head_limit: { type: 'number', description: '결과 개수 제한' },
        },
        required: ['pattern'],
      },
    },
    run(args, ctx) {
      let re;
      try { re = new RegExp(args.pattern, args['-i'] ? 'i' : ''); }
      catch (err) { return { error: `정규식이 잘못됐습니다: ${err.message}` }; }

      const root = args.path ? ctx.scope.resolve(args.path) : ctx.scope.root;
      const isFile = existsSync(root) && statSync(root).isFile();
      let files = isFile
        ? [{ path: root, rel: ctx.scope.show(root) }]
        : walk(root);
      const 안본것 = isFile ? '' : 건너뜀말(files.건너뜀).trim();   // .gitignore 로 건너뛴 수 — 꼬리에 적는다
      if (args.glob) {
        const g = globToRegex(args.glob);
        files = files.filter((f) => g.test(f.rel) || g.test(f.rel.split('/').pop()));
      }

      const mode = args.output_mode ?? 'files_with_matches';
      const limit = args.head_limit ?? 찾을줄수(ctx.모델컨텍스트);
      const hitFiles = [];
      const lines = [];
      let total = 0;

      /*
       * 큰 파일과 글이 아닌 파일은 건너뛴다.
       *
       * 전에는 걸러내지 않고 전부 읽었다. node_modules 는 안 훑지만 dist 에 남은
       * 8MB 번들 하나, .map 파일 몇 개, 그림 몇 장이면 30~60초가 그냥 간다.
       * 그동안 화면은 멈춰 있고 Ctrl+C 도 안 먹는다 — 한 덩어리로 도는 코드라서다.
       *
       * 안에 든 것이 글이 아니면 정규식으로 찾을 것도 없다. 크기와 확장자로
       * 먼저 걸러 내면 같은 결과를 훨씬 빨리 얻는다.
       */
      let 건너뛴것 = 0;
      let 멈춤 = null;
      for (const f of files) {
        // 도중에 Ctrl+C 를 눌렀으면 여기서 그만둔다. 찾은 데까지는 준다.
        if (ctx.signal?.aborted) { 멈춤 = '중단'; break; }
        if ((f.size ?? 0) > GREP_MAX_FILE) { 건너뛴것++; continue; }
        if (안읽을확장자.test(f.rel)) { 건너뛴것++; continue; }
        let text;
        try { text = readText(f.path); } catch { 건너뛴것++; continue; }
        const ls = text.split('\n');
        let n = 0;
        for (let i = 0; i < ls.length; i++) {
          if (!re.test(ls[i])) continue;
          n++; total++;
          if (mode === 'content' && lines.length < limit) {
            const num = args['-n'] === false ? '' : `:${i + 1}`;
            lines.push(`${ctx.scope.show(f.path)}${num}: ${ls[i].trim().slice(0, 200)}`);
          }
        }
        if (n) hitFiles.push({ rel: ctx.scope.show(f.path), n });
        if (mode !== 'content' && hitFiles.length >= limit) { 멈춤 = '상한'; break; }
      }

      // 무엇을 못 봤는지 말해 준다. 안 그러면 '없다' 와 '못 봤다' 가 구분이 안 된다.
      const 꼬리 = [
        멈춤 === '중단' ? '(중단하셔서 여기까지만 찾았습니다)' : '',
        멈춤 === '상한' ? `(${limit}개에서 멈췄습니다 — 더 있을 수 있습니다)` : '',
        건너뛴것 ? `(글이 아니거나 너무 큰 파일 ${건너뛴것}개는 건너뛰었습니다)` : '',
        안본것,
      ].filter(Boolean).join(' ');
      const 붙이기 = (s) => (꼬리 ? `${s}\n\n${꼬리}` : s);

      if (!total) return { content: 붙이기(`일치 없음: ${args.pattern}`), summary: '0건' };
      if (mode === 'content') return { content: 붙이기(clip(lines.join('\n'))), summary: `${total}건` };
      if (mode === 'count') {
        return { content: 붙이기(hitFiles.map((f) => `${f.n}\t${f.rel}`).join('\n')), summary: `${hitFiles.length}개 파일` };
      }
      return { content: 붙이기(hitFiles.map((f) => f.rel).join('\n')), summary: `${hitFiles.length}개 파일 · ${total}건` };
    },
  },

  Skill: {
    schema: {
      name: 'Skill',
      description: '스킬 하나를 펼쳐 읽는다. 목록에 이름과 설명만 올라와 있으니, 필요한 것을 골라 이걸로 본문을 받는다.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '스킬 이름 (목록에 있는 그대로)' } },
        required: ['name'],
      },
    },
    run(args, ctx) {
      const want = String(args.name ?? '').trim();
      const list = ctx.skills ?? [];
      if (!list.length) return { error: '이 PC 에서 찾은 스킬이 없습니다.' };

      const hit = list.find((s) => s.name === want)
        ?? list.find((s) => s.name.toLowerCase() === want.toLowerCase())
        ?? list.find((s) => s.name.split(':').pop() === want);
      if (!hit) {
        const near = list.filter((s) => s.name.includes(want) || want.includes(s.name.split(':').pop()))
          .slice(0, 5).map((s) => s.name);
        return { error: `그런 스킬이 없습니다: ${want}` + (near.length ? `\n  비슷한 것: ${near.join(', ')}` : '') };
      }
      const { body, error, cut } = loadSkill(hit, { maxChars: ctx.maxSkillChars ?? 8000 });
      if (error) return { error: `스킬을 읽지 못했습니다: ${error}` };
      ctx.loadedSkills?.add(hit.name);
      return {
        content: `# 스킬: ${hit.name}\n\n${body}`,
        summary: `${Math.round(body.length / 100) / 10}k자${cut ? ' (일부 잘림)' : ''}`,
      };
    },
  },

  Bash: {
    schema: {
      name: 'Bash',
      description: '명령을 실행한다. 되돌릴 수 없는 명령은 막힌다.'
        + ' **끝나지 않는 것(dev 서버·watch)은 background: true 로 띄워라** —'
        + ' 그냥 부르면 시간 초과로 죽는다. 띄운 뒤에는 Jobs 로 출력을 읽는다.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '실행할 명령' },
          description: { type: 'string', description: '무엇을 하는 명령인지 한 줄' },
          timeout: { type: 'number', description: '제한 시간(ms). 기본 120000' },
          background: { type: 'boolean', description: '끝나지 않는 명령이면 true. 바로 돌아오고 Jobs 로 읽는다' },
        },
        required: ['command'],
      },
    },
    async run(args, ctx) {
      const cmd = String(args.command ?? '').trim();
      if (!cmd) return { error: '명령이 비었습니다' };
      try { checkCommand(cmd); }
      catch (err) { ctx.audit.blocked(err.message, cmd); return { error: `막힘 — ${err.message}` }; }
      // Read 에서 막아 둔 것을 Bash 로 우회할 수 있으면 막아 둔 뜻이 없다.
      // 게이트웨이 열쇠가 든 .deel/config.json 이 그런 자리다. guard.js 머리말 참고.
      try { checkPaths(cmd, ctx.scope); }
      catch (err) { ctx.audit.blocked(err.message, cmd); return { error: `막힘 — ${err.message}` }; }

      /*
       * 파일을 바꾸는 명령이면 손대기 전 내용을 떠 둔다.
       *
       * 되돌리기는 Write·Edit 만 지키고 있었다. 그런데 `mv 옛것.js 새것.js` 나
       * `rm 임시.txt` 는 Bash 로 간다 — 그 순간 파일이 사라지는데 /undo 는
       * 아무것도 못 한다. 안전망에 난 구멍치고는 큰 편이다.
       *
       * 명령줄에 적힌 경로 중 **지금 있는 파일**만 뜬다. 완벽하지는 않다 —
       * 셸이 풀어 주는 와일드카드(`rm *.tmp`)나 스크립트 안에서 지우는 것은
       * 여기서 안 보인다. 그래서 '전부 되돌아간다' 고 말하지 않는다.
       * 그래도 손으로 옮기고 지우는 흔한 자리는 이걸로 덮인다.
       */
      const 뜬것 = 바꾸기전스냅샷(cmd, ctx);

      // 끝나지 않는 명령은 뒤에서 띄운다. 여기서 기다리면 그 턴이 통째로 멈춘다.
      if (args.background === true) {
        const r = await 띄우기(cmd, { cwd: ctx.scope.root, 설명: args.description ?? null });
        if (r.error) return { error: r.error };
        if (!r.떴나) {
          // 지켜보는 사이에 죽었다. 포트가 물려 있거나 명령이 틀린 경우다.
          // 이걸 '띄웠습니다' 로 넘기면 모델은 다음 단계로 가고, 사람은 안 뜬
          // 서버를 찾아다닌다. 실패로 못 박고 나온 말을 그대로 준다.
          return {
            error: `띄우자마자 끝났습니다 (${r.시그널 ? `${r.시그널} 시그널` : `종료코드 ${r.종료코드}`}).`
              + ' 뒤에서 돌 명령이 아니거나, 뜨자마자 탈이 난 것입니다.'
              + (r.출력?.trim() ? `\n\n나온 말:\n${clip(r.출력, 4000)}` : ''),
            failed: true,
          };
        }
        return {
          content: `${r.번호}번으로 띄웠습니다: ${cmd}\n`
            + (r.출력?.trim() ? `\n${clip(r.출력, 4000)}\n` : '')
            + `\n계속 돌고 있습니다. 새 출력은 Jobs({번호: ${r.번호}}) 로 읽고, 일이 끝나면 Jobs({번호: ${r.번호}, 끝내기: true}) 로 정리해라.`,
          summary: `${r.번호}번으로 띄움`,
          일감번호: r.번호,
          뒤에서: true,
          되돌릴것: 뜬것,
        };
      }

      // 어느 셸로 넘기나 — tools/shell.js 가 정한다. Jobs 와 같은 답이어야 하므로 한 군데다.
      // (윈도우 cmd 의 따옴표 문제와 그 해법도 거기 적혀 있다.)
      const shell = 셸명령(cmd);

      const 제한 = args.timeout ?? 120000;
      return new Promise((끝) => {
        /*
         * 끝맺음은 한 번만. 그리고 **기다리지 않는다.**
         *
         * 끊었는데도 60초가 걸린 적이 있다. 자식을 죽여도 손자가 파이프를 물고
         * 있으면 execFile 의 콜백이 안 불리기 때문이다. 그래서 죽이라고 시켜 놓고
         * 여기서 바로 끝맺는다 — 뒷정리는 알아서 되게 두고, 사람은 안 기다린다.
         */
        let 끝났나 = false;
        const done = (r) => { if (끝났나) return; 끝났나 = true; 끝(r); };
        // 출력은 글자가 아니라 바이트로 받는다.
        //
        // 윈도우 명령창은 UTF-8 이 아니다. 한국어 윈도우는 CP949 로 뱉는다.
        // 이걸 utf8 이라고 하고 받으면 한글이 통째로 깨진다 — '파싱 성공' 이
        // '�Ľ� ����' 이 된다. 바이트로 받아 이 컴퓨터가 쓰는 것으로 해독한다.
        const kid = execFile(shell.file, shell.args, {
          cwd: ctx.scope.root,
          timeout: 제한,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
          windowsVerbatimArguments: shell.verbatim === true,
          encoding: 'buffer',
        }, (err, stdoutBuf, stderrBuf) => {
          clearTimeout(뒷북);
          ctx.signal?.removeEventListener?.('abort', 끊기);
          const 콘솔 = consoleCodepage() === 65001 ? 'utf-8' : null;
          const 풀기 = (b) => {
            if (!b || !b.length) return '';
            // UTF-8 로 말이 되면 UTF-8 이다. 아니면 이 컴퓨터 콘솔 인코딩으로 본다.
            return decodeBytes(Buffer.from(b), { fallback: 콘솔 }).text;
          };
          const stdout = 풀기(stdoutBuf);
          const stderr = 풀기(stderrBuf);
          const out = [stdout, stderr].filter(Boolean).join('\n').trim();

          if (끊겼나) return done({ error: '사용자가 중단했습니다', content: clip(out) });
          if (err && err.killed) return done({ error: `시간 초과로 중단됨 (${제한}ms)`, content: clip(out) });

          /*
           * 결과를 사실대로 말한다.
           *
           * 전에는 err.code ?? 0 이었다. 그런데 프로세스가 **시그널로 죽으면**
           * code 가 없고 signal 만 있다 — 그러면 0 이 되어 '성공' 으로 넘어갔다.
           * 빌드가 메모리 부족으로 죽었는데 모델은 "빌드 확인했습니다" 라고 답한다.
           *
           * 종료코드도 모델에게 준다. 전에는 화면에만 적고 대화에는 안 실었다.
           * 그러면 모델은 명령이 실패한 줄 모른 채 다음 단계로 넘어간다.
           */
          const 시그널 = err?.signal ?? null;
          const code = 시그널 ? null : (err?.code ?? 0);
          const 잘됨 = !시그널 && code === 0;
          const 꼬리 = 잘됨 ? '' : 시그널 ? `\n\n[${시그널} 시그널로 죽었습니다 — 정상 종료가 아닙니다]` : `\n\n[종료코드 ${code}]`;
          done({
            content: clip(out || '(출력 없음)') + 꼬리,
            summary: 잘됨 ? '성공' : 시그널 ? `${시그널} 로 죽음` : `종료코드 ${code}`,
            failed: !잘됨,
            exitCode: code,
            signal: 시그널,
            // 무엇을 떠 뒀는지 화면이 알아야 '되돌릴 수 있다' 를 사실대로 적는다.
            되돌릴것: 뜬것,
          });
        });

        /*
         * Ctrl+C 로 도는 명령을 멈춘다.
         *
         * 전에는 못 멈췄다. `▶ Bash(npm run dev)` 뒤로 화면이 영영 멈춰 있고,
         * Ctrl+C 는 다음 요청에나 반영됐다. 터미널을 닫는 수밖에 없었다.
         */
        let 끊겼나 = false;
        const 죽이기 = () => {
          // 윈도우에서는 자식만 죽이면 손자가 남는다. 트리째 끝내야 한다.
          // 그리고 **트리 죽이기를 먼저** 한다 — cmd 를 먼저 죽이면 트리의 뿌리가
          // 없어져서 taskkill 이 손자를 못 찾는다. 그러면 손자가 그대로 남아 돈다.
          if (process.platform === 'win32' && kid.pid) {
            try { execFile('taskkill', ['/pid', String(kid.pid), '/t', '/f'], { windowsHide: true }, () => {}); } catch {}
          }
          try { kid.kill(); } catch {}
          // 죽이라고 시켰다고 곧바로 죽는 것은 아니다. 그동안 이 프로세스가
          // 그 손을 붙들고 있으면 deel 을 끝내도 안 끝난다 — 실제로 검사가
          // 60초를 더 기다렸다. 놓아 주고 우리 갈 길을 간다.
          try { kid.unref(); } catch {}
          try { kid.stdout?.destroy(); kid.stderr?.destroy(); } catch {}
        };
        const 끊기 = () => {
          끊겼나 = true;
          죽이기();
          clearTimeout(뒷북);
          // 콜백을 기다리지 않는다. 손자가 파이프를 물고 있으면 안 불릴 수도 있다.
          done({ error: '사용자가 중단했습니다' });
        };
        if (ctx.signal?.aborted) 끊기();
        else ctx.signal?.addEventListener?.('abort', 끊기, { once: true });

        /*
         * execFile 의 timeout 을 못 믿는 자리가 있다.
         *
         * 손자 프로세스가 파이프를 물고 있으면 부모를 죽여도 stdout 이 안 닫혀서
         * 콜백이 안 불린다. 그러면 제 시간 제한이 있는데도 영영 안 끝난다.
         * 그래서 우리 쪽에서도 시계를 하나 걸고, 넘으면 트리째 끝낸다.
         */
        const 뒷북 = setTimeout(() => {
          if (끝났나 || 끊겼나) return;
          죽이기();
          done({ error: `시간 초과로 중단됨 (${제한}ms) — 자식 프로세스가 안 끝나 강제로 끝냈습니다` });
        }, 제한 + 2000);
        // 이 시계 때문에 프로그램이 안 끝나면 안 된다.
        뒷북.unref?.();
      });
    },
  },

  // 웹 읽기는 '데이터가 나가는 길' 과 분리돼 있다 — webfetch.js 머리말 참고.
  WebFetch: WEB_FETCH_TOOL,

  // 긴 작업에서 시킨 것을 빠뜨리지 않게 붙잡아 두는 목록.
  /*
   * 지난 대화 찾기.
   *
   * 왜 도구로도 주나: 사람만 쓰는 /recall 로 두면 **모델이 스스로 못 찾는다.**
   * "저번에 정한 대로 해줘" 같은 말에 모델이 할 수 있는 게 되묻는 것뿐이 된다.
   * 도구로 주면 스스로 지난 대화를 뒤져 그때 정한 것을 갖고 온다 —
   * 대화를 남기는 일이 그제서야 값을 한다.
   *
   * 이 폴더의 기록만 본다. 작업 범위 밖은 애초에 읽을 수 없다.
   */
  /*
   * ── 사람에게 되묻기 ─────────────────────────────────────────────────────
   *
   * 이게 없어서 실제로 이런 일이 났다. 큰 폴더를 "역할에 맞게 구조 바꿔 줘"
   * 라고 시켰더니, 모델이 파일을 스무 개쯤 읽고 나서 대화창에 이렇게 적고
   * 멈췄다:
   *
   *   "수행할 구체적인 작업 요청이 없습니다. 원하는 변경 사항을 알려주세요."
   *
   * 요청은 있었다. 모델이 **어떻게 물어야 할지 몰랐던** 것이다. 물어볼 길이
   * 없으니 글로 적고 턴을 끝냈고, 사람은 아무것도 안 된 화면을 봤다.
   *
   * 되묻기가 도구여야 하는 이유:
   *   · 글로 물으면 그 턴이 **끝난다.** 사람이 답해도 앞의 조사 결과는 이미
   *     끝난 턴에 있고, 모델은 처음부터 다시 읽는다.
   *   · 도구로 물으면 답이 도구 결과로 돌아와 **하던 자리에서 이어진다.**
   *
   * 고를 것을 같이 주게 하는 것이 핵심이다. "어떻게 할까요?" 만 오면 사람은
   * 다시 생각해야 하지만, 세 갈래를 주면 숫자 하나로 끝난다.
   */
  Ask: {
    schema: {
      name: 'Ask',
      /*
       * 첫 문장에 제일 중요한 것을 둔다 — 좁은 창에서는 설명줄이기가
       * **뒤에서부터 문장째로** 잘라 낸다. 8k 에서 남는 것은 앞 90자다.
       */
      description: '갈림길에서 사람에게 하나 묻는다. 글로 "알려주세요" 하고 끝내지 마라 —'
        + ' 턴이 끝나서 여태 본 것이 버려진다. options 에 2~4개를 주면 숫자로 답한다.'
        + ' **이미 사용자가 말한 것을 다시 묻지 마라.** "파일 정리해 줘" 라고 했으면'
        + ' 그게 답이다 — 그대로 하면 된다. 어떻게 할지 정하는 것은 네 일이다.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '한 문장짜리 질문. 무엇을 정해야 하는지 분명하게' },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: '고를 것 2~4개. 각각 한 줄로, 무엇이 달라지는지 알 수 있게',
          },
        },
        required: ['question'],
      },
    },
    async run(args, ctx) {
      const 물음 = String(args.question ?? '').trim();
      if (!물음) return { error: 'question 이 비었습니다' };

      const 고를것 = (Array.isArray(args.options) ? args.options : [])
        .map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 4);

      /*
       * 물어볼 자리가 없는 데서도 안 죽어야 한다 — `deel -p` 한 방 실행, 파이프,
       * 하위 작업. 거기서는 **막히지 말고** 스스로 판단하라고 돌려준다.
       * 답을 기다리며 서 있으면 그 실행은 영영 안 끝난다.
       */
      /*
       * 결과는 반드시 `content` 로 돌려준다.
       *
       * loop.js 가 대화에 싣는 것은 `result.content` 하나다(그 자리 하나로
       * 비밀 가리기·중복 셈이 다 걸린다). 처음에 `answer` 로만 돌려줬더니
       * 화면에는 답이 멀쩡히 뜨는데 **모델에게는 빈 글이 갔다** — 물어보고
       * 답을 받고도 못 들은 셈이라, 없느니만 못한 자리가 될 뻔했다.
       */
      if (typeof ctx.ask물음 !== 'function') {
        return {
          content: '지금은 사람에게 물을 수 없는 자리입니다(한 방 실행·하위 작업).'
            + ' 되묻지 말고 가장 그럴듯한 쪽으로 진행하고, 무엇을 가정했는지 끝에 적으세요.',
        };
      }

      const 답 = await ctx.ask물음(물음, 고를것);
      if (답 === null || 답 === undefined || String(답).trim() === '') {
        return { content: '사람이 답하지 않았습니다. 되묻지 말고 스스로 판단해 이어가세요.' };
      }
      return { content: `사람의 답: ${String(답)}` };
    },
  },

  Recall: {
    schema: {
      name: 'Recall',
      description: '이 폴더의 지난 대화에서 찾는다. "저번에" 처럼 앞선 대화를 가리키면 되묻지 말고 이걸 쓴다.'
        + ' 파일 내용을 찾는 것이 아니다 — 파일은 Grep 이다.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '찾을 말. 낱말 두세 개 (예: "CP949 인코딩")' },
          limit: { type: 'number', description: '가져올 개수 (기본 8)' },
          tools: { type: 'boolean', description: '도구 결과까지 뒤질지 (기본 false)' },
        },
        required: ['query'],
      },
    },
    async run(args, ctx) {
      const { 찾기 } = await import('../agent/recall.js');
      const q = String(args.query ?? '').trim();
      if (!q) return { error: 'query 가 비었습니다' };

      const r = 찾기(ctx.scope.root, q, {
        limit: Math.min(20, Math.max(1, Number(args.limit) || 8)),
        도구결과까지: args.tools === true,
      });

      if (!r.맞은것.length) {
        // 못 찾은 것과 안 찾아본 것은 다르다. 예산에 걸려 멈췄으면 그렇다고 말한다 —
        // 안 그러면 모델이 "그런 대화 없었습니다" 라고 단정한다.
        const 왜 = r.예산초과
          ? `지난 대화 ${r.전체파일}개 중 ${r.본파일}개까지만 뒤졌습니다(양이 많아 멈춤). 못 찾았습니다`
          : `지난 대화 ${r.본파일}개를 다 뒤졌지만 없습니다`;
        return { summary: `${왜}: ${q}`, hits: [], searched: r.본파일, total: r.전체파일, partial: r.예산초과 };
      }

      const 줄들 = r.맞은것.map((h) => {
        const 날 = h.언제 instanceof Date ? h.언제.toISOString().slice(0, 16).replace('T', ' ') : '';
        return `[${h.세션} · ${날} · ${h.누구}] ${h.토막}`;
      });
      return {
        summary: `지난 대화에서 ${r.전체맞음}건 중 ${r.맞은것.length}건`
          + (r.예산초과 ? ` (${r.전체파일}개 중 ${r.본파일}개만 뒤짐)` : ''),
        hits: r.맞은것.map((h) => ({ session: h.세션, when: h.언제, who: h.누구, text: h.토막 })),
        text: 줄들.join('\n'),
        searched: r.본파일,
        total: r.전체파일,
        partial: r.예산초과,
      };
    },
  },

  /*
   * 기억하기.
   *
   * 왜 도구인가: 사람이 /memory 로 적게 하면 아무도 안 적는다. 지금 막 정한
   * 것을 기억할지 말지 판단할 수 있는 것은 그 자리에 있는 모델뿐이다.
   *
   * 왜 짧게 쓰라고 못을 박나: 여기 적힌 것은 **매 요청마다** 통째로 나간다.
   * 모델은 그걸 모르고 파일 내용을 통째로 넣으려 든다. 그러면 기억이
   * 컨텍스트를 먹어 정작 일할 자리가 줄어든다.
   */
  Remember: {
    schema: {
      name: 'Remember',
      description: '대화가 끝나도 남길 것을 한 줄로 적는다. 사용자가 정한 규칙·약속·되풀이하면 안 되는 실수.'
        + ' 이번 일에서만 쓰는 것이나 파일을 읽으면 아는 것은 안 적는다.'
        + ' 이 글은 앞으로 모든 요청에 실린다 — 한 문장으로.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '한 줄 (예: "사내 문서는 CP949 로 읽고 CP949 로 되돌려 쓴다")' },
        },
        required: ['text'],
      },
    },
    async run(args, ctx) {
      const { 더하기 } = await import('../agent/memory.js');
      const r = 더하기(ctx.scope.root, args.text);
      if (!r.ok) return { summary: r.why, remembered: false };
      return {
        summary: `기억했습니다 (${r.줄수}줄)` + (r.넘침 ? ' · 자리가 차서 오래된 것을 뺐습니다' : ''),
        remembered: true,
        line: r.줄,
        // 화면에 무엇을 적었는지 보여 주려고 같이 넘긴다. 사람이 못 보면
        // 틀린 기억이 조용히 쌓인다 — 그게 제일 나쁘다.
        content: r.줄,
      };
    },
  },

  TodoWrite: TODO_TOOL,

  // 만든 것이 진짜 되는지. 끝맺기 전에 오는 자리다 — verify.js 머리말 참고.
  Verify: VERIFY_TOOL,

  // 프로젝트 뼈대만 싸게 보기. Read 앞에 오는 자리다 — outline.js 머리말 참고.
  Outline: OUTLINE_TOOL,

  // 하위 작업. 실행은 loop.js 가 가로채서 한다 — task.js 머리말 참고.
  Task: TASK_TOOL,

  // 뒤에서 도는 명령 보기·끝내기. Bash(background) 와 짝이다 — jobs.js 머리말 참고.
  Jobs: JOBS_TOOL,

  /*
   * 언어 서버에게 묻는 둘. Grep·Outline 을 밀어내지 않고 **더한다** —
   * tools/lsp.js 머리말 참고.
   *
   * 언어 서버가 이 자리에 없으면 toolSchemas 가 목록에서 뺀다. 못 쓰는 도구를
   * 세워 두면 모델은 그걸 부르고, 실패를 받고, 또 부른다.
   */
  Def: DEF_TOOL,
  Refs: REFS_TOOL,
};

/**
 * 도구 설명을 창 크기에 맞게 줄인다.
 *
 * 문장 단위로 자른다. 글자 수로 뚝 자르면 "…파일을 통째로 Read 하는 것보다"
 * 처럼 말이 끊긴 채로 모델에게 간다 — 그건 안 준 것만 못하다.
 * 첫 문장은 무슨 일이 있어도 남긴다. 그게 이 도구가 무엇인지다.
 *
 * 인자 설명도 같이 줄인다. 괄호로 붙인 보충(`(한 개일 때)`)이 먼저 떨어진다.
 */
// from·to 는 Move 만 쓴다. 옮기는 도구에서 "어디서 → 어디로" 는 이름만으로 안다.
const 뻔한인자 = new Set([
  'file_path', 'content', 'pattern', 'path', 'command', 'text', 'name', 'question', 'from', 'to',
]);

export function 설명줄이기(schema, 한도) {
  if (!Number.isFinite(한도)) return schema;

  const 자르기 = (글, 몫) => {
    const s = String(글 ?? '');
    if (s.length <= 몫) return s;
    // 한국어 문장은 '다.' 로 끝난다. 영문 마침표도 같이 본다.
    const 조각 = s.split(/(?<=다\.|[.!?])\s+/);
    let 모은것 = 조각[0] ?? s;
    for (const 다음 of 조각.slice(1)) {
      if ((모은것 + ' ' + 다음).length > 몫) break;
      모은것 += ' ' + 다음;
    }
    return 모은것;
  };

  const p = schema.parameters ?? {};
  const 인자몫 = Math.max(24, Math.round(한도 / 3));
  const 새속성 = {};
  for (const [이름, 값] of Object.entries(p.properties ?? {})) {
    // 이름만 봐도 아는 인자는 아주 좁은 창에서 설명을 통째로 뺀다.
    // `file_path` 가 무엇인지 설명하는 데 토큰을 쓰는 것은, 8k 모델에서는
    // 그 토큰만큼 대화를 잘라먹는 것과 같다. 헷갈릴 만한 것(offset·files·
    // replace_all·목적·할일)은 그대로 둔다 — 거기서 틀리면 일이 안 된다.
    if (한도 <= 100 && 뻔한인자.has(이름)) { 새속성[이름] = { type: 값.type }; continue; }
    /*
     * 배열 안쪽 설명은 좁은 창에서 통째로 뺀다.
     *
     * files·edits 의 items 는 바깥이 이미 한 말을 되풀이한다 — 바깥에서
     * "여러 파일을 한 번에" 라고 하고, 안쪽에서 다시 "쓸 파일 경로"·"파일 전체
     * 내용" 이라고 한다. 이름(file_path·content)만 봐도 아는 것이라, 8k 에서는
     * 그 되풀이가 곧 대화 자리를 먹는 것과 같다.
     *
     * **required 와 type 은 안 건드린다.** 그건 설명이 아니라 규격이라,
     * 빼면 모델이 무엇을 넣어야 하는지를 실제로 모르게 된다.
     */
    if (한도 <= 160 && 값?.type === 'array' && 값.items?.properties) {
      const 안쪽 = {};
      for (const [n, v] of Object.entries(값.items.properties)) 안쪽[n] = { type: v.type };
      새속성[이름] = {
        ...값,
        description: 값.description ? 자르기(String(값.description), 인자몫) : undefined,
        items: { ...값.items, properties: 안쪽 },
      };
      continue;
    }
    새속성[이름] = 값?.description
      ? { ...값, description: 자르기(String(값.description).replace(/\s*\([^)]*\)\s*$/, ''), 인자몫) }
      : 값;
  }
  return {
    ...schema,
    description: 자르기(schema.description, 한도),
    parameters: { ...p, properties: 새속성 },
  };
}

/**
 * 도구 설명을 **모델에게 주는 말**에 맞춘다 (i18n 의 지시말).
 *
 * 화면 말이 아니라 지시말을 본다. 도구 설명은 사람이 아니라 모델이 읽는
 * 글이라, '한국어 화면 + 영어 지시' 를 고른 사람에게는 여기도 영어로
 * 가야 한다 — 그래야 아끼려던 토큰이 실제로 아껴진다.
 *
 * 표에 없는 도구·인자는 한글 설명이 그대로 나간다.
 * 빈 설명을 내보내지 않는다. 설명 없는 도구는 모델이 언제 쓰는지 모른 채로
 * 목록에만 서 있게 되는데, 그건 없는 것보다 나쁘다.
 */
function 영어설명(schema, 이름) {
  if (지시말() !== 'en') return schema;
  const 것 = 도구설명EN[이름];
  if (!것) return schema;

  const p = schema.parameters ?? {};
  const 새속성 = {};
  for (const [인자, 값] of Object.entries(p.properties ?? {})) {
    const 글 = 것.params?.[인자];
    새속성[인자] = 글 ? { ...값, description: 글 } : 값;
  }
  return {
    ...schema,
    description: 것.desc ?? schema.description,
    parameters: { ...p, properties: 새속성 },
  };
}

// 모델에게 넘길 도구 정의 목록.
// 스킬이 없으면 Skill 도구는 빼서 자리를 아낀다.
export function toolSchemas(names = null, { hasSkills = false, web = true, work = null, mcp = null, ctx = null, lsp = false } = {}) {
  let list = names ?? Object.keys(TOOLS).filter((n) => {
    if (n === 'Skill') return hasSkills;
    if (n === 'WebFetch') return web;
    // 언어 서버가 없는 자리에서는 Def·Refs 를 아예 안 보여 준다.
    //
    // 웹 도구를 오프라인에서 숨기는 것과 같은 이유다. 못 쓰는 도구를 목록에
    // 세워 두면 모델은 그걸 부르고, "없습니다" 를 받고, 또 부른다. 그 왕복이
    // 도구 설명으로 나가는 자리보다 비싸다.
    if (n === 'Def' || n === 'Refs') return !!lsp;
    return true;
  });
  // 이름을 직접 준 경우(하위 작업이 부모 것을 물려받을 때)에도 같은 규칙을 건다.
  // 부모에게 있던 것이 하위에서 갑자기 못 쓰게 되지는 않지만, 시험·일회성 호출이
  // 이름을 통째로 넘기는 길이 있어서 여기서 한 겹 더 막는다.
  if (names && !lsp) list = list.filter((n) => n !== 'Def' && n !== 'Refs');
  // 작업 모드가 정해져 있으면 그 모드가 쓰는 것만 남긴다.
  //
  // 설계·계획·묻기 모드에서 파일을 바꾸면 안 된다고 프롬프트로 부탁할 수도 있다.
  // 그런데 모델은 부탁을 잊는다. 목록에서 아예 빼면 잊을 것이 없다.
  if (work) list = allowedIn(work, list);
  /*
   * 창이 좁으면 설명을 줄여 싣는다 (budget.js 의 설명길이).
   *
   * 도구를 빼지는 않는다. 빼면 작은 모델만 할 수 있는 일이 달라져서
   * "환경마다 다르게 동작" 하게 되는데, 그건 이 프로그램이 피하려는 것이다.
   * 이름과 인자는 그대로 남으므로 할 수 있는 일은 똑같다.
   */
  const 한도 = 설명길이(ctx);
  /*
   * 화면 말이 영어면 도구 설명도 영어로 갈아 끼운다 (tools/desc.en.js).
   *
   * 줄이기 **전에** 갈아 끼운다. 순서가 반대면 한글 설명을 한도에 맞춰 자른
   * 다음 영어로 통째로 바꾸는 셈이라, 자른 것이 아무 뜻이 없어지고 영어 글은
   * 한도를 넘긴 채로 실린다.
   *
   * 이름과 인자 이름은 안 건드린다 — 그건 식별자다. Task 의 목적·할일처럼
   * 한글로 된 인자 이름을 바꾸면 그 도구가 아예 안 불린다.
   */
  const 우리것 = list.map((n) => ({
    type: 'function',
    function: 설명줄이기(영어설명(TOOLS[n].schema, n), 한도),
  }));

  /*
   * 밖에서 붙인 도구(MCP)를 뒤에 붙인다.
   *
   * 읽기만 하는 모드(설계·계획·묻기)에서는 안 준다. MCP 서버가 무엇을 하는지
   * 우리는 모른다 — 이름이 search 여도 파일을 쓸 수 있다. 파일을 안 바꾸기로
   * 한 모드에서 '모르는 것' 을 쥐여 주면 그 약속이 약속이 아니게 된다.
   */
  if (mcp?.length && (!work || allowedIn(work, ['Write']).length)) 우리것.push(...도구정의(mcp));
  return 우리것;
}

// 파일을 바꾸는 도구들. 이것만 고친 뒤 진단을 본다.
const 고치는도구 = new Set(['Write', 'Append', 'Edit']);
// 한 번에 볼 파일 수. 여덟 개를 한꺼번에 만들었다고 여덟 번 기다릴 수는 없다.
const 진단볼파일 = 3;

/**
 * 고친 직후에 그 파일이 성한지 본다 — lsp/diag.js 머리말 참고.
 *
 * 여기서 절대 죽으면 안 되고, 늦어서도 안 된다. 파일은 이미 고쳐졌다.
 * 진단은 **덤**이지 이 도구가 성공했는지의 판단 근거가 아니다. 그래서
 * 통째로 감싸고, 이미 떠 있는 서버가 없으면 아무것도 안 하고 그냥 지나간다.
 */
async function 고친뒤진단(name, r, ctx) {
  try {
    if (!고치는도구.has(name) || !r || r.error) return r;
    /*
     * **부른 쪽이 켠 자리에서만** 한다. 기본은 꺼짐이다.
     *
     * 여기서 하는 일은 남의 프로세스를 하나 띄우는 것이다. 그건 띄운 쪽이
     * 거둘 줄 알아야 한다 — 안 거두면 그 서버가 작업 폴더를 cwd 로 물고 있어서
     * 윈도우에서는 폴더 이름조차 못 바꾼다. 그래서 끄는 자리를 갖춘 쪽(repl·
     * oneshot)만 ctx.lsp.켬 을 켠다. 도구를 직접 부르는 자리는 안 켜진다.
     */
    if (ctx.lsp?.켬 !== true) return r;
    const 뿌리 = ctx.scope?.root;
    if (!뿌리) return r;

    const 바뀐 = r.changed
      ? [r.changed]
      : (Array.isArray(r.여럿) ? r.여럿.filter((x) => x?.ok && x.path).map((x) => x.path) : []);
    const 볼것 = [...new Set(바뀐)].slice(0, 진단볼파일);
    if (!볼것.length) return r;

    // 처음 고칠 때 뒤에서 하나 데워 둔다. 이번 것은 못 받아도 다음부터 받는다.
    데우기(뿌리, 볼것[0]);

    const 것들 = await Promise.all(볼것.map((abs) => 편집후진단(뿌리, abs)));
    let 답 = r;
    for (let i = 0; i < 볼것.length; i++) {
      답 = 진단붙이기(답, 것들[i], ctx.scope.show(볼것[i]));
    }
    return 답;
  } catch {
    return r;   // 진단 보다 터져서 편집이 실패로 보이는 일은 없어야 한다
  }
}

/** 이 폴더에서 언어 서버를 쓸 수 있나. repl 이 켤 때 한 번 물어본다. */
export function 언어서버있나(뿌리) {
  try { return !!프로젝트갈래(뿌리); } catch { return false; }
}

export async function runTool(name, args, ctx) {
  // 밖에서 붙인 도구(MCP)는 이름 앞머리로 갈린다.
  //
  // 여기서 먼저 갈라야 하는 이유: MCP 서버는 우리 scope 를 안 지킨다.
  // 남의 프로세스라 파일을 제 마음대로 읽고 쓸 수 있다. 우리 도구인 척
  // 섞이면 "이 폴더 밖은 못 건드린다" 는 말이 거짓이 된다.
  if (name.startsWith('mcp__')) return await runMcpTool(name, args, ctx);

  const t = TOOLS[name];
  if (!t) return { error: `모르는 도구: ${name}` };
  try {
    const r = await t.run(args ?? {}, ctx);
    ctx.audit.tool(name, args, r);
    return await 고친뒤진단(name, r, ctx);
  } catch (err) {
    const r = { error: err.message };
    ctx.audit.tool(name, args, r);
    return r;
  }
}

/**
 * MCP 서버가 준 도구를 부른다.
 *
 * 실패해도 턴을 죽이지 않는다. 남의 프로그램이라 언제든 죽을 수 있고, 그때마다
 * 대화가 끝나 버리면 쓸 수가 없다. 오류를 **결과로** 돌려주면 모델이 그걸 읽고
 * 다른 길을 찾는다.
 *
 * 감사기록에는 우리 도구와 똑같이 남긴다 — 오히려 이쪽이 더 남아야 한다.
 * 남의 프로그램이 무엇을 했는지가 반입 심사에서 물어볼 바로 그것이다.
 */
async function runMcpTool(name, args, ctx) {
  const 갈린것 = 이름풀기(name);
  const r = await (async () => {
    if (!갈린것) return { error: `${name} 은 MCP 도구 이름 꼴이 아닙니다` };
    const 서버 = (ctx.mcp ?? []).find((s) => s.이름 === 갈린것.서버);
    if (!서버) return { error: `${갈린것.서버} 서버가 붙어 있지 않습니다 — /mcp 로 확인하세요` };
    if (!서버.살아있나()) return { error: `${갈린것.서버} 서버가 죽었습니다: ${서버.죽음 ?? '이유 모름'}` };
    try {
      const out = await 서버.부르기(갈린것.도구, args);
      if (out.isError) return { error: out.text || '도구가 오류를 냈습니다' };
      const 글 = out.text ?? '';
      const 줄 = 글 ? 글.split(/\r?\n/).length : 0;
      return { summary: 글 ? `${줄}줄 · ${글.length.toLocaleString()}자` : '빈 답', content: clip(글) };
    } catch (e) {
      return { error: e.message };
    }
  })();
  ctx.audit.tool(name, args, r);
  return r;
}
