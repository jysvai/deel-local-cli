// 도구 6종. 이름과 인자를 Claude Code 와 같게 맞춘다 —
// 그래야 그 관례로 쓰인 스킬·명령이 그대로 먹는다.
import { writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { globToRegex, walk, readText, readTextFull, SKIP_DIRS } from './fsutil.js';
import { encode, label as encLabel, decode as decodeBytes, consoleCodepage } from './encoding.js';
import { checkCommand } from '../safety/guard.js';
import { findMatch, applySpans, reindent, TIER_LABELS } from './edit-match.js';
import { loadSkill } from '../skills/discover.js';
import { WEB_FETCH_TOOL } from './webfetch.js';
import { TODO_TOOL } from './todo.js';
import { allow as allowedIn } from '../agent/modes.js';
import { isExcelPath, readExcel, toText as excelText, summarize as excelSummary } from './excel.js';

const MAX_READ_LINES = 2000;
const MAX_OUT = 30000;

function clip(s, n = MAX_OUT) {
  const t = String(s);
  return t.length > n ? t.slice(0, n) + `\n… (${t.length - n}자 잘림)` : t;
}

// 엑셀 파일에 쓰려 할 때 하는 말. 왜 안 되는지와, 그럼 어떻게 하는지를 같이 준다.
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
      // 엑셀 파일을 통째로 덮어쓰면 xlsx 가 아니라 그냥 글 파일이 된다.
      // 열리지도 않는 파일이 되고, 원본은 이미 없다. 아예 막는다.
      if (isExcelPath(abs)) return { error: 엑셀은못고침(args.file_path) };
      ctx.history.snapshot(abs, 'Write');
      mkdirSync(dirname(abs), { recursive: true });
      const existed = existsSync(abs);

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
      const files = walk(root)
        .filter((f) => re.test(f.rel) || re.test(f.rel.split('/').pop()))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 200);
      if (!files.length) return { content: `찾은 파일 없음: ${args.pattern}`, summary: '0개' };
      return {
        content: files.map((f) => ctx.scope.show(f.path)).join('\n'),
        summary: `${files.length}개`,
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

      for (const f of files) {
        let text;
        try { text = readText(f.path); } catch { continue; }
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
        if (mode !== 'content' && hitFiles.length >= limit) break;
      }

      if (!total) return { content: `일치 없음: ${args.pattern}`, summary: '0건' };
      if (mode === 'content') return { content: clip(lines.join('\n')), summary: `${total}건` };
      if (mode === 'count') {
        return { content: hitFiles.map((f) => `${f.n}\t${f.rel}`).join('\n'), summary: `${hitFiles.length}개 파일` };
      }
      return { content: hitFiles.map((f) => f.rel).join('\n'), summary: `${hitFiles.length}개 파일 · ${total}건` };
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

      const shell = process.platform === 'win32'
        ? { file: process.env.COMSPEC ?? 'cmd.exe', args: ['/d', '/s', '/c', cmd] }
        : { file: '/bin/sh', args: ['-c', cmd] };

      return new Promise((done) => {
        // 출력은 글자가 아니라 바이트로 받는다.
        //
        // 윈도우 명령창은 UTF-8 이 아니다. 한국어 윈도우는 CP949 로 뱉는다.
        // 이걸 utf8 이라고 하고 받으면 한글이 통째로 깨진다 — '파싱 성공' 이
        // '�Ľ� ����' 이 된다. 바이트로 받아 이 컴퓨터가 쓰는 것으로 해독한다.
        execFile(shell.file, shell.args, {
          cwd: ctx.scope.root,
          timeout: args.timeout ?? 120000,
          maxBuffer: 8 * 1024 * 1024,
          windowsHide: true,
          encoding: 'buffer',
        }, (err, stdoutBuf, stderrBuf) => {
          const 콘솔 = consoleCodepage() === 65001 ? 'utf-8' : null;
          const 풀기 = (b) => {
            if (!b || !b.length) return '';
            // UTF-8 로 말이 되면 UTF-8 이다. 아니면 이 컴퓨터 콘솔 인코딩으로 본다.
            return decodeBytes(Buffer.from(b), { fallback: 콘솔 }).text;
          };
          const stdout = 풀기(stdoutBuf);
          const stderr = 풀기(stderrBuf);
          const out = [stdout, stderr].filter(Boolean).join('\n').trim();
          if (err && err.killed) return done({ error: `시간 초과로 중단됨 (${args.timeout ?? 120000}ms)`, content: clip(out) });
          const code = err?.code ?? 0;
          done({
            content: clip(out || '(출력 없음)'),
            summary: code === 0 ? '성공' : `종료코드 ${code}`,
            failed: code !== 0,
          });
        });
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
