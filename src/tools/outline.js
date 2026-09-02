/**
 * Outline — 프로젝트의 **뼈대만** 싸게 보여 준다.
 *
 * ── 왜 이게 필요한가 ───────────────────────────────────────────────────
 *
 * 지금 남의 코드를 이해하는 길은 두 가지뿐이다.
 *   Glob  → 경로만 나온다. 안에 무엇이 있는지는 모른다.
 *   Read  → 파일을 통째로 읽는다. 창이 순식간에 찬다.
 *
 * 가운데가 비어 있었다. budget.js 가 Read 줄 수를 모델에 맞춰 잘라 주긴 하지만,
 * **자른 파일은 구조를 안 보여 준다** — 앞 200줄에 import 만 있는 파일이 흔하다.
 * 그래서 모델은 "무엇이 어디 있는지" 를 모른 채로 고치기 시작하고, 엉뚱한 파일에
 * 새 함수를 만들어 넣는다. 이미 있는 것을 못 봤기 때문이다.
 *
 * Outline 은 같은 폴더를 Read 의 몇십 분의 일로 보여 준다. 함수·클래스·export
 * 이름과 줄 번호만 뽑기 때문이다. 이름만 봐도 "이건 여기 있겠구나" 가 서고,
 * 그 다음에 그 파일 하나만 Read 하면 된다.
 *
 * ── 왜 정규식인가 ──────────────────────────────────────────────────────
 *
 * 제대로 하려면 언어마다 파서가 필요하다(tree-sitter). 그런데 이 프로그램은
 * 의존성이 0개다 — 사내에 미승인 SW 를 못 들이기 때문이고, 그건 못 바꾼다.
 *
 * 정규식은 틀릴 수 있다. 문자열 안에 든 `function` 을 함수로 볼 수도 있다.
 * 그래도 쓰는 이유는, 여기서 나온 것은 **다음에 무엇을 Read 할지 고르는 데**
 * 쓰이지 그 자체로 판단 근거가 되지 않기 때문이다. 몇 개 더 나오거나 덜 나와도
 * 다음 걸음이 조금 더 걸릴 뿐, 틀린 코드가 나가지는 않는다.
 *
 * 대신 **모르는 것은 모른다고 말한다.** 못 읽는 확장자를 조용히 빼면 모델은
 * 그 파일이 없는 줄 안다. 그게 정규식의 부정확함보다 훨씬 나쁘다.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { walk, SKIP_DIRS, globToRegex, 내부살림 } from './fsutil.js';
import { 건너뜀말 } from './ignore.js';
import { decode, looksBinary } from './encoding.js';
import { 찾을개수, 뼈대줄수 } from '../agent/budget.js';
import { 말, 세말 } from '../i18n/index.js';

/* 결과 한 줄을 잇는다 — 빈 조각은 버린다(tools/index.js 의 이어 와 같은 것). */
const 이어 = (...조각들) => 조각들.filter((x) => x != null && String(x) !== '').join(' · ');

/**
 * 언어별로 '뼈대' 를 이루는 것들.
 *
 * 각 항목은 [정규식, 갈래]. 정규식의 첫 번째 잡음이 이름이다.
 * 갈래는 화면에 붙는 한 글자짜리 표시다 — 이름만 스무 줄 늘어놓으면
 * 무엇이 함수고 무엇이 자료인지 안 보인다.
 */
const 규칙 = {
  js: [
    [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\p{L}$_][\p{L}\p{N}$_]*)/u, 'fn'],
    [/^\s*(?:export\s+)?(?:abstract\s+)?class\s+([\p{L}$_][\p{L}\p{N}$_]*)/u, 'class'],
    [/^\s*(?:export\s+)?(?:const|let|var)\s+([\p{L}$_][\p{L}\p{N}$_]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\p{L}$_][\p{L}\p{N}$_]*)\s*=>/u, 'fn'],
    [/^\s*(?:export\s+)?(?:interface|type|enum)\s+([\p{L}$_][\p{L}\p{N}$_]*)/u, 'type'],
    [/^\s*export\s+(?:const|let|var)\s+([\p{L}$_][\p{L}\p{N}$_]*)/u, 'const'],
    // 클래스 안의 메서드. 들여쓰기가 있고 괄호로 이어지는 이름.
    [/^\s{2,}(?:static\s+|async\s+|get\s+|set\s+|#)?([\p{L}$_][\p{L}\p{N}$_]*)\s*\([^)]*\)\s*\{/u, 'method'],
  ],
  py: [
    [/^\s*class\s+([\p{L}_][\p{L}\p{N}_]*)/u, 'class'],
    [/^\s*(?:async\s+)?def\s+([\p{L}_][\p{L}\p{N}_]*)/u, 'fn'],
    [/^([A-Z_][A-Z0-9_]{2,})\s*[:=]/, 'const'],
  ],
  java: [
    [/^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:class|interface|enum|record)\s+([\p{L}_][\p{L}\p{N}_]*)/u, 'class'],
    [/^\s*(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?[\p{L}\p{N}_<>[\],\s]+\s+([\p{L}_][\p{L}\p{N}_]*)\s*\(/u, 'method'],
  ],
  go: [
    [/^func\s+(?:\([^)]*\)\s*)?([\p{L}_][\p{L}\p{N}_]*)/u, 'fn'],
    [/^type\s+([\p{L}_][\p{L}\p{N}_]*)/u, 'type'],
    [/^(?:const|var)\s+([\p{L}_][\p{L}\p{N}_]*)/u, 'const'],
  ],
  rs: [
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([\p{L}_][\p{L}\p{N}_]*)/u, 'fn'],
    [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type)\s+([\p{L}_][\p{L}\p{N}_]*)/u, 'type'],
    [/^\s*impl(?:<[^>]*>)?\s+([\p{L}_][\p{L}\p{N}_:]*)/u, 'impl'],
  ],
  cs: [
    [/^\s*(?:public|private|protected|internal)?\s*(?:static\s+|sealed\s+|abstract\s+|partial\s+)*(?:class|interface|struct|enum|record)\s+([\p{L}_][\p{L}\p{N}_]*)/u, 'class'],
    [/^\s*(?:public|private|protected|internal)\s+(?:static\s+|async\s+|virtual\s+|override\s+)*[\p{L}\p{N}_<>[\],?\s]+\s+([\p{L}_][\p{L}\p{N}_]*)\s*\(/u, 'method'],
  ],
  md: [
    [/^(#{1,4})\s+(.+?)\s*$/, '#'],
  ],
  html: [
    [/^\s*<(?:section|main|header|footer|nav|article|form|table|dialog)\b[^>]*\bid="([^"]+)"/i, 'tag'],
    [/^\s*<(section|main|header|footer|nav|article|form|table|dialog)\b/i, 'tag'],
    [/^\s*<h([1-3])\b[^>]*>(.*?)</i, '#'],
  ],
  css: [
    [/^([.#][\p{L}_-][\p{L}\p{N}_-]*(?:\s*[,>+~]\s*[^{]+)?)\s*\{/u, 'rule'],
    [/^(@[\p{L}-]+[^{]*)\{/u, 'at'],
  ],
  sh: [
    [/^\s*(?:function\s+)?([\p{L}_][\p{L}\p{N}_]*)\s*\(\)\s*\{/u, 'fn'],
  ],
  json: [],   // 자료다. 뼈대라고 할 것이 없다 — 아래에서 따로 다룬다.
};

/** 확장자 → 규칙 이름. 여기 없는 것은 '못 읽는다' 고 말한다. */
const 확장자 = {
  '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'js',
  '.ts': 'js', '.tsx': 'js', '.mts': 'js', '.cts': 'js',
  '.py': 'py', '.pyi': 'py',
  '.java': 'java', '.kt': 'java', '.kts': 'java', '.groovy': 'java', '.scala': 'java',
  '.go': 'go',
  '.rs': 'rs',
  '.cs': 'cs',
  '.md': 'md', '.markdown': 'md',
  '.html': 'html', '.htm': 'html', '.vue': 'html', '.svelte': 'html',
  '.css': 'css', '.scss': 'css', '.less': 'css',
  '.sh': 'sh', '.bash': 'sh', '.zsh': 'sh',
  '.json': 'json',
};

/** 뼈대를 못 뽑는 확장자라도 '무엇인지' 는 말해 줄 수 있는 것들. */
const 설명만 = {
  '.yml': 'YAML 설정', '.yaml': 'YAML 설정', '.toml': 'TOML 설정', '.ini': '설정',
  '.env': '환경 변수', '.txt': '글', '.csv': '표', '.sql': 'SQL',
  '.xml': 'XML', '.svg': '벡터 그림', '.lock': '잠금 파일',
};

/*
 * 이름처럼 생겼지만 이름이 아닌 것들.
 *
 * 메서드 규칙은 `들여쓰기 + 이름(...) {` 을 잡는데, 그 모양은 `if (…) {` 와
 * 똑같다. 걸러 내지 않으면 뼈대에 if·for·while 이 줄줄이 올라온다 —
 * 실제로 screen.js 뼈대에 `method if`, inputbox.js 에 `method for` 가 떴다.
 * 자리를 먹는 것도 문제지만, 그게 있으면 진짜 이름을 눈으로 못 고른다.
 */
const 이름아님 = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'try', 'finally',
  'return', 'function', 'class', 'new', 'delete', 'typeof', 'void', 'with',
  'constructor',   // 진짜 이름이지만 클래스마다 하나씩 있어 목록만 채운다
]);

/** 한 줄이 너무 길면 자른다 — 이름이 길어야 60자다. */
const 짧게 = (s, n = 72) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * 파일 하나의 뼈대를 뽑는다.
 *
 * @returns {{항목:Array<{줄:number,갈래:string,이름:string}>, 줄수:number, 왜못읽나:string|null}}
 */
export function 뼈대뽑기(글, 확장) {
  const 규칙이름 = 확장자[String(확장).toLowerCase()];
  if (!규칙이름) return { 항목: [], 줄수: 0, 왜못읽나: '아직 뼈대를 못 뽑는 종류' };

  const 줄들 = String(글).split('\n');

  // JSON 은 코드가 아니라 자료다. 맨 위 열쇠들이 곧 뼈대다.
  if (규칙이름 === 'json') {
    const 항목 = [];
    for (const [i, 한줄] of 줄들.entries()) {
      const m = /^\s{0,4}"([^"]+)"\s*:/.exec(한줄);
      if (m) 항목.push({ 줄: i + 1, 갈래: 'key', 이름: m[1] });
      if (항목.length >= 40) break;
    }
    return { 항목, 줄수: 줄들.length, 왜못읽나: null };
  }

  const 표 = 규칙[규칙이름] ?? [];
  const 항목 = [];
  const 본것 = new Set();

  for (const [i, 한줄] of 줄들.entries()) {
    // 주석 줄은 건너뛴다. 주석 안의 예제 코드가 뼈대로 올라오면 안 된다.
    if (/^\s*(?:\/\/|\/\*|\*|#(?!\s*[#!])|--)/.test(한줄) && 규칙이름 !== 'md') continue;
    for (const [re, 갈래] of 표) {
      const m = re.exec(한줄);
      if (!m) continue;
      // md 헤딩과 html 헤딩은 잡음이 둘이다 — 깊이와 글.
      let 이름;
      let 실갈래 = 갈래;
      if (갈래 === '#' && m[2] !== undefined) {
        const 깊이 = 규칙이름 === 'md' ? m[1].length : Number(m[1]);
        이름 = `${'  '.repeat(Math.max(0, 깊이 - 1))}${m[2]}`;
        실갈래 = `h${깊이}`;
      } else {
        이름 = m[1];
      }
      이름 = 짧게(이름);
      if (!이름 || 이름아님.has(이름.trim())) continue;
      const 열쇠 = `${실갈래}|${이름.trim()}`;
      if (본것.has(열쇠)) continue;       // 같은 이름이 여러 번 걸리는 규칙이 있다
      본것.add(열쇠);
      항목.push({ 줄: i + 1, 갈래: 실갈래, 이름 });
      break;                              // 한 줄은 한 가지로만 센다
    }
  }
  return { 항목, 줄수: 줄들.length, 왜못읽나: null };
}

/** 파일 하나를 안전하게 읽어 온다. 바이너리·내부살림은 안 읽는다. */
function 글읽기(abs) {
  const 막을이유 = 내부살림(abs);
  if (막을이유) return { 막힘: 막을이유 };
  let buf;
  try { buf = readFileSync(abs); } catch (e) { return { 막힘: e.message }; }
  if (looksBinary(buf)) return { 막힘: '바이너리' };
  try { return { 글: decode(buf).text }; } catch { return { 글: buf.toString('utf8') } ; }
}

/**
 * Outline 도구.
 *
 * 폴더를 주면 그 안을, 파일을 주면 그 파일 하나를 본다.
 */
export const OUTLINE_TOOL = {
  schema: {
    name: 'Outline',
    description:
      '폴더나 파일의 **뼈대만** 본다 — 파일별 함수·클래스·타입·헤딩 이름과 줄 번호.'
      + ' 남의 코드를 고치기 전에 이걸 먼저 불러라. 파일을 통째로 Read 하는 것보다'
      + ' 수십 분의 일만 쓰면서 "무엇이 어디 있는지" 를 알 수 있다.'
      + ' 여기서 고칠 자리를 고른 다음, **그 파일만** Read 해라.'
      + ' js/ts · py · java/kotlin · go · rust · c# · md · html · css · sh · json 을 읽는다.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '폴더 또는 파일 경로. 없으면 작업 폴더 전체' },
        pattern: { type: 'string', description: '이름으로 좁히기 (예: **/*.js). 없으면 다 본다' },
      },
      required: [],
    },
  },

  run(args, ctx) {
    const 시작 = args.path ? ctx.scope.resolve(args.path) : ctx.scope.root;
    if (!existsSync(시작)) return { error: `없는 경로입니다: ${args.path ?? '.'}` };

    const 하나인가 = statSync(시작).isFile();
    let 파일들 = 하나인가
      ? [{ path: 시작, rel: ctx.scope.show(시작), mtime: statSync(시작).mtimeMs }]
      : walk(시작, { skipDirs: SKIP_DIRS, signal: ctx.signal });
    if (파일들.끊김) return { error: '중단했습니다. 폴더를 끝까지 안 훑었습니다.', 끝났다: true, 중단됨: true };
    const 건너뜀 = 하나인가 ? '' : 건너뜀말(파일들.건너뜀, 파일들.잘림, 파일들.상한);   // .gitignore 로 건너뛴 수 (tools/ignore.js)

    // 좁히는 방식은 Glob 도구와 **같은 것**을 쓴다. 두 도구가 같은 패턴에
    // 다르게 답하면 모델이 둘 중 어느 것을 믿어야 할지 알 수 없다.
    if (args.pattern && !하나인가) {
      const re = globToRegex(args.pattern);
      파일들 = 파일들.filter((f) => re.test(f.rel) || re.test(f.rel.split('/').pop()));
    }

    if (!파일들.length) return { content: '볼 파일이 없습니다.', summary: 세말('count', 0) };

    // 최근에 손댄 것부터. 지금 하는 일과 가까울 가능성이 높다.
    파일들.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));

    const 파일상한 = 찾을개수(ctx.모델컨텍스트);
    const 줄상한 = 뼈대줄수(ctx.모델컨텍스트);
    const 볼것 = 파일들.slice(0, 파일상한);

    const 줄들 = [];
    let 쓴줄 = 0;
    const 못읽은것 = new Map();     // 이유 → 그 이유로 못 읽은 파일들
    let 뼈대있는파일 = 0;
    let 항목수 = 0;
    let 자리모자람 = false;

    for (const f of 볼것) {
      if (쓴줄 >= 줄상한) { 자리모자람 = true; break; }
      const 보인이름 = ctx.scope.show(f.path);
      const 확장 = extname(f.path).toLowerCase();

      if (!확장자[확장]) {
        const 뭔지 = 설명만[확장];
        const 이유 = 뭔지 ? `${뭔지} — 뼈대 없음` : '아직 뼈대를 못 뽑는 종류';
        못읽은것.set(이유, [...(못읽은것.get(이유) ?? []), 보인이름]);
        continue;
      }

      const 읽음 = 글읽기(f.path);
      if (읽음.막힘) {
        못읽은것.set(읽음.막힘, [...(못읽은것.get(읽음.막힘) ?? []), 보인이름]);
        continue;
      }

      const { 항목, 줄수 } = 뼈대뽑기(읽음.글, 확장);
      if (!항목.length) {
        못읽은것.set('안에 이름 붙은 것이 없음', [...(못읽은것.get('안에 이름 붙은 것이 없음') ?? []), 보인이름]);
        continue;
      }

      뼈대있는파일++;
      줄들.push(`${보인이름}  (${줄수}줄)`);
      쓴줄++;
      // 파일 하나가 목록을 통째로 먹지 않게 한다. 500개짜리 파일 하나가
      // 나머지 마흔 개를 밀어내면 '구조를 본다' 는 뜻이 없어진다.
      const 파일당 = Math.max(6, Math.floor(줄상한 / Math.max(4, 볼것.length)));
      const 보일항목 = 항목.slice(0, 파일당);
      for (const it of 보일항목) {
        줄들.push(`  ${String(it.줄).padStart(5)}  ${it.갈래.padEnd(6)} ${it.이름}`);
        쓴줄++;
      }
      if (항목.length > 보일항목.length) {
        줄들.push(`         … 그 밖에 ${항목.length - 보일항목.length}개 더`);
        쓴줄++;
      }
      항목수 += 항목.length;
      줄들.push('');
      쓴줄++;
    }

    /*
     * 못 읽은 것을 **반드시 말한다.**
     *
     * 조용히 빼면 모델은 그 파일이 없는 줄 안다. 그러면 이미 있는 설정을
     * 다시 만들거나, .yml 안에 든 답을 못 찾고 헤맨다. 정규식이 몇 개 틀리는
     * 것보다 "없는 줄 알았다" 가 훨씬 비싸다.
     */
    if (못읽은것.size) {
      줄들.push('여기 있지만 뼈대는 못 뽑은 것 (필요하면 Read 로 직접 읽어라):');
      for (const [이유, 목록] of 못읽은것) {
        const 앞 = 목록.slice(0, 8).join(' · ');
        const 더 = 목록.length > 8 ? ` … 그 밖에 ${목록.length - 8}개` : '';
        줄들.push(`  [${이유}] ${앞}${더}`);
      }
    }

    if (파일들.length > 볼것.length || 자리모자람) {
      줄들.push('');
      줄들.push(`… 모두 ${파일들.length}개 중 ${뼈대있는파일}개의 뼈대만 실었습니다.`
        + ' 좁혀서 다시 부르세요 (path 나 pattern 을 주면 됩니다).');
    }

    return {
      content: 줄들.join('\n').trimEnd() + 건너뜀,
      summary: 이어(세말('files', 뼈대있는파일), 세말('places', 항목수))
        + (못읽은것.size ? ` · ${말('sum.unread', { n: [...못읽은것.values()].reduce((a, x) => a + x.length, 0) })}` : ''),
    };
  },
};
