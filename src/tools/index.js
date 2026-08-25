// 도구 6종. 이름과 인자를 Claude Code 와 같게 맞춘다 —
// 그래야 그 관례로 쓰인 스킬·명령이 그대로 먹는다.
import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { globToRegex, walk, readText, readTextFull, SKIP_DIRS, 내부살림 } from './fsutil.js';
import { encode, label as encLabel, decode as decodeBytes, consoleCodepage, looksBinary } from './encoding.js';
import { checkCommand, checkPaths } from '../safety/guard.js';
import { findMatch, applySpans, reindent, TIER_LABELS } from './edit-match.js';
import { loadSkill } from '../skills/discover.js';
import { WEB_FETCH_TOOL } from './webfetch.js';
import { TODO_TOOL } from './todo.js';
import { allow as allowedIn } from '../agent/modes.js';
import { isExcelPath, readExcel, toText as excelText, summarize as excelSummary } from './excel.js';
import { diffLines } from '../ui/diff.js';

const MAX_READ_LINES = 2000;
const MAX_OUT = 30000;
// Glob 이 한 번에 돌려줄 최대 개수. 넘으면 잘랐다고 말해 준다.
const GLOB_MAX = 200;
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

/** 지금 파일이 몇 줄인가. 붙인 뒤 '얼마나 찼는지' 를 사실로 말해 주려고 센다. */
function 줄수(abs, 인코딩) {
  try {
    const buf = readFileSync(abs);
    if (looksBinary(buf)) return 0;
    const t = 인코딩 && 인코딩 !== 'utf-8' ? decodeBytes(buf).text : buf.toString('utf8');
    return t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
  } catch { return 0; }
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

export const TOOLS = {
  Read: {
    schema: {
      name: 'Read',
      description: '파일 하나를 읽는다. 줄 번호가 붙어 돌아온다. 고치기 전에는 반드시 먼저 읽어야 한다.'
        + ' 엑셀 파일(.xlsx/.xlsm/.xls)도 그대로 읽을 수 있다 — 시트별 CSV 로 바꿔서 돌려준다.'
        + ' 사용자에게 CSV 로 내보내 달라고 할 필요가 없다. 다만 엑셀 파일은 읽기만 되고 고칠 수는 없다.',
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

      const 읽음 = readTextFull(abs);
      // 무엇으로 읽었는지 기억해 둔다. 나중에 고칠 때 같은 것으로 되돌려 써야 한다.
      // 안 그러면 사내 CP949 문서가 한 번 고치는 것만으로 UTF-8 이 되어 버린다.
      ctx.enc = ctx.enc ?? new Map();
      ctx.enc.set(abs, 읽음.encoding);
      const text = 읽음.text;
      const lines = text.split('\n');
      const start = Math.max(0, (args.offset ?? 1) - 1);
      const count = Math.min(args.limit ?? MAX_READ_LINES, MAX_READ_LINES);
      const slice = lines.slice(start, start + count);
      const body = slice.map((l, i) => `${String(start + i + 1).padStart(6)}\t${l}`).join('\n');
      const more = lines.length > start + count ? `\n… 전체 ${lines.length}줄 중 ${start + count}줄까지` : '';
      ctx.seen.add(abs);
      const 별난인코딩 = 읽음.encoding !== 'utf-8';
      return {
        content: clip(body + more),
        summary: `${lines.length}줄` + (별난인코딩 ? ` · ${encLabel(읽음.encoding)}` : ''),
      };
    },
  },

  Write: {
    schema: {
      name: 'Write',
      description: '파일을 새로 쓰거나 통째로 덮어쓴다. 일부만 고칠 때는 Edit 을 쓴다.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '쓸 파일 경로' },
          content: { type: 'string', description: '파일 전체 내용' },
        },
        required: ['file_path', 'content'],
      },
    },
    run(args, ctx) {
      const abs = ctx.scope.resolve(args.file_path);
      if (typeof args.content !== 'string') return { error: 'content 가 문자열이 아닙니다' };
      // 읽기만 막고 쓰기를 열어 두면 남의 도구 살림을 덮어쓸 수 있다.
      // 제 설정(.deel/config.json)을 덮어쓰면 연결이 통째로 날아간다.
      const 못쓰는이유 = 내부살림(abs);
      if (못쓰는이유) return { error: 못쓰는이유 };
      // 엑셀 파일을 통째로 덮어쓰면 xlsx 가 아니라 그냥 글 파일이 된다.
      // 열리지도 않는 파일이 되고, 원본은 이미 없다. 아예 막는다.
      if (isExcelPath(abs)) return { error: 엑셀은못고침(args.file_path) };
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
      description: '파일에서 정확히 일치하는 문자열 하나를 바꾼다. 먼저 Read 로 읽어야 한다.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: '고칠 파일 경로' },
          old_string: { type: 'string', description: '바꿀 대상. 파일에서 유일해야 한다' },
          new_string: { type: 'string', description: '바꿀 내용' },
          replace_all: { type: 'boolean', description: '모두 바꾸려면 true' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
    run(args, ctx) {
      const abs = ctx.scope.resolve(args.file_path);
      if (!existsSync(abs)) return { error: `파일이 없습니다: ${args.file_path}` };
      const 못고치는이유 = 내부살림(abs);
      if (못고치는이유) return { error: 못고치는이유 };
      // 엑셀 파일은 Read 로 읽히긴 하지만 고칠 수 있는 물건이 아니다.
      // '먼저 Read 로 읽어야 합니다' 라고만 하면 이미 읽은 쪽은 계속 헛돈다.
      if (isExcelPath(abs)) return { error: 엑셀은못고침(args.file_path) };
      if (!ctx.seen.has(abs)) return { error: `먼저 Read 로 읽어야 합니다: ${args.file_path}` };
      if (args.old_string === args.new_string) return { error: 'old_string 과 new_string 이 같습니다' };

      const 읽음 = readTextFull(abs);
      const text = 읽음.text;
      const m = findMatch(text, args.old_string, { replaceAll: !!args.replace_all });

      if (!m.ok) {
        if (m.reason === 'ambiguous') {
          return { error: `${m.count}군데에서 발견됐습니다 (${TIER_LABELS[m.tier]}). 앞뒤로 더 넓게 잡아 하나만 가리키거나 replace_all 을 쓰세요.` };
        }
        const hint = m.near
          ? `\n  파일의 ${m.near.line}번 줄이 가장 비슷합니다:\n    ${m.near.text.trim().slice(0, 120)}\n  이 줄을 그대로 옮겨 담아 다시 시도하세요.`
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
      const 맞는것 = walk(root)
        .filter((f) => re.test(f.rel) || re.test(f.rel.split('/').pop()))
        .sort((a, b) => b.mtime - a.mtime);
      const files = 맞는것.slice(0, GLOB_MAX);
      if (!files.length) return { content: `찾은 파일 없음: ${args.pattern}`, summary: '0개' };
      // 잘랐으면 잘랐다고 말한다. 전에는 '200개' 라고만 해서, 모델이 그게 전부인 줄
      // 알고 "전부 확인했습니다" 로 답을 맺었다. 실제로는 1,400개 중 200개였다.
      const 잘림 = 맞는것.length > files.length
        ? `\n\n… 모두 ${맞는것.length}개인데 최근 것 ${files.length}개만 보여 줍니다. 범위를 좁혀 다시 찾으세요.`
        : '';
      return {
        content: files.map((f) => ctx.scope.show(f.path)).join('\n') + 잘림,
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
      if (args.glob) {
        const g = globToRegex(args.glob);
        files = files.filter((f) => g.test(f.rel) || g.test(f.rel.split('/').pop()));
      }

      const mode = args.output_mode ?? 'files_with_matches';
      const limit = args.head_limit ?? 250;
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
      description: '명령을 실행한다. 되돌릴 수 없는 명령은 막힌다.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '실행할 명령' },
          description: { type: 'string', description: '무엇을 하는 명령인지 한 줄' },
          timeout: { type: 'number', description: '제한 시간(ms). 기본 120000' },
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
       * 명령을 셸에 넘기는 방법. 윈도우에서 여기가 조용히 틀려 있었다.
       *
       * 무슨 일이 있었나:
       *   Node 는 인자를 넘길 때 따옴표를 \" 로 바꿔 준다. 그런데 cmd.exe 는
       *   \" 를 모른다. 그래서 따옴표가 든 명령이 통째로 뭉개졌다 —
       *     node -e "console.log(1)"  →  아무것도 안 하고 **종료코드 0**
       *   출력도 없고 오류도 없이 '성공' 이다. 모델은 잘된 줄 알고 넘어간다.
       *   `node -e`, `python -c`, `git commit -m "..."` 이 전부 이 자리였다.
       *
       * Node 의 exec() 가 안에서 하는 것과 똑같이 맞춘다 — 명령을 통째로
       * 따옴표로 감싸고, 인자를 손대지 말라고(verbatim) 일러 준다.
       * /s 는 그 감싼 따옴표 한 쌍을 벗기라는 뜻이라 짝이 맞는다.
       */
      const shell = process.platform === 'win32'
        ? {
          file: process.env.COMSPEC ?? 'cmd.exe',
          args: ['/d', '/s', '/c', `"${cmd}"`],
          verbatim: true,
        }
        : { file: '/bin/sh', args: ['-c', cmd] };

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
  TodoWrite: TODO_TOOL,
};

// 모델에게 넘길 도구 정의 목록.
// 스킬이 없으면 Skill 도구는 빼서 자리를 아낀다.
export function toolSchemas(names = null, { hasSkills = false, web = true, work = null } = {}) {
  let list = names ?? Object.keys(TOOLS).filter((n) => {
    if (n === 'Skill') return hasSkills;
    if (n === 'WebFetch') return web;
    return true;
  });
  // 작업 모드가 정해져 있으면 그 모드가 쓰는 것만 남긴다.
  //
  // 설계·계획·묻기 모드에서 파일을 바꾸면 안 된다고 프롬프트로 부탁할 수도 있다.
  // 그런데 모델은 부탁을 잊는다. 목록에서 아예 빼면 잊을 것이 없다.
  if (work) list = allowedIn(work, list);
  return list.map((n) => ({ type: 'function', function: TOOLS[n].schema }));
}

export async function runTool(name, args, ctx) {
  const t = TOOLS[name];
  if (!t) return { error: `모르는 도구: ${name}` };
  try {
    const r = await t.run(args ?? {}, ctx);
    ctx.audit.tool(name, args, r);
    return r;
  } catch (err) {
    const r = { error: err.message };
    ctx.audit.tool(name, args, r);
    return r;
  }
}
