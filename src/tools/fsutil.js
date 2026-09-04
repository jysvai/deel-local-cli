// 파일 훑기와 glob 매칭. 외부 패키지 없이 직접 구현한다.
import { readdirSync, statSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { decode, looksBinary } from './encoding.js';
import { 뿌리규칙읽기, 파일규칙읽기, 걸리나 } from './ignore.js';
// 살림이 **어디** 있는지는 config.js 한 곳만 안다 (DEEL_HOME 으로 옮길 수 있다).
import { homeDir } from '../config.js';

/**
 * 폴더를 통째로 옮겨 담는다.
 *
 * fs.cpSync 를 안 쓰는 이유가 둘이다.
 *
 *  1) Node 가 실험 기능으로 표시한 API 다. 판마다 동작이 다르고, 윈도우에서
 *     프로세스가 통째로 죽는 것을 실제로 겪었다 — 검사가 아무 말도 없이
 *     0xC0000409 로 끝났다. 배포되는 코드가 실험 API 에 매달려 있으면 안 된다.
 *
 *  2) cpSync 는 심볼릭 링크를 따라간다. 남이 준 플러그인 폴더에 바깥을 가리키는
 *     링크가 하나 있으면 그것까지 딸려 들어온다. 여기서는 링크를 건너뛴다 —
 *     플러그인은 제 폴더 안의 글 파일이면 충분하다.
 *
 * 하는 일이 뻔해서 읽으면 다 보인다. 그게 이 프로젝트가 원하는 것이다.
 */
export function copyDir(from, to, { skipped = [] } = {}) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const s = join(from, e.name);
    const d = join(to, e.name);
    if (e.isSymbolicLink()) { skipped.push(s); continue; }
    if (e.isDirectory()) copyDir(s, d, { skipped });
    else if (e.isFile()) copyFileSync(s, d);
    // 그 밖(장치·소켓 같은 것)은 건너뛴다. 플러그인에 있을 이유가 없다.
    else skipped.push(s);
  }
  return { skipped };
}

/**
 * 다른 코딩 도구들이 제 살림을 넣어 두는 자리.
 *
 * 프로젝트 파일이 아니라 그 도구의 기록이다 — 지난 대화, 명령 이력, 캐시,
 * 그리고 열쇠. 이 작업과 아무 상관이 없는데 훑을 때 걸려 나오면 모델이
 * 그것부터 읽는다. 실제로 .claude/history.jsonl 을 읽어 컨텍스트를 채운 적이 있다.
 *
 * **목록은 여기 한 곳에만 둔다.** 전에는 훑는 쪽과 읽기 막는 쪽에 따로 적어
 * 놨는데, 그러면 한쪽에만 새 이름을 넣는 날이 반드시 온다. 훑을 때는 안 걸리는데
 * 이름을 대면 읽히는, 설명하기 어려운 상태가 된다.
 *
 * 새 도구는 계속 나온다. 여기 없는 이름이 보이면 그냥 한 줄 더하면 된다.
 */
export const 남의도구살림 = new Set([
  '.claude', '.codex', '.cursor', '.gemini', '.aider', '.continue', '.cline',
  '.roo', '.kilocode', '.windsurf', '.opencode', '.zed', '.trae', '.augment',
  '.qodo', '.tabnine', '.cody', '.sourcegraph', '.copilot', '.amazonq', '.junie',
  '.codeium', '.goose', '.crush', '.gptme', '.openhands', '.devin',
]);

// .aider.chat.history.md 처럼 폴더가 아니라 파일로 흘리는 것들도 있다.
export const 남의도구파일 = /^\.(aider|copilot|continue|cline|codeium|windsurf)[.-]/i;

export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.deel', '.svn', '.hg', 'dist', 'build',
  '.next', '.nuxt', '.cache', '__pycache__', '.venv', 'venv', 'target',
  ...남의도구살림,
]);

/**
 * 이 파일이 '읽어 봐야 도움이 안 되는 살림' 인가.
 *
 * 왜 막나:
 *   실제로 이런 일이 있었다 —
 *     ◧ Read(~/.deel/audit.jsonl)      77줄
 *     ◧ Read(~/.claude/history.jsonl)  35줄
 *   감사기록은 이 프로그램이 방금 무엇을 했는지 적어 둔 것이다. 그걸 다시 읽어
 *   대화에 넣으면 모델이 제 그림자를 좇는다. 사용자가 시킨 일과는 아무 상관이
 *   없고, 컨텍스트만 찬다.
 *
 *   설정 파일은 더 나쁘다. 게이트웨이 열쇠(apiKey)가 그 안에 있다.
 *   읽는 순간 그 열쇠가 대화에 실려 모델로 나가고, 세션 기록으로 디스크에도 남는다.
 *   열쇠를 그 열쇠의 주인에게 보내는 셈이다.
 *
 * 막는 것이지 숨기는 것이 아니다 — 왜 안 되는지 그대로 말해 준다.
 * @returns {string|null} 막을 이유. 막을 것이 아니면 null.
 */
export function 내부살림(abs) {
  const 편 = String(abs ?? '').replace(/\\/g, '/');
  const 조각 = 편.split('/');
  const 이름 = 조각[조각.length - 1] ?? '';
  /*
   * 살림 자리를 `.deel` 이라는 **글자**로 찾고 있었다.
   *
   * 그 폴더는 옮길 수 있다 — `DEEL_HOME` 이 정식 설정이고(config.js), 사내
   * 휴대용 설치와 검사가 실제로 그걸 쓴다. 이름에 `.deel` 이 안 들어가는
   * 자리로 옮기면(`DEEL_HOME=D:/agent`) 이 막이 **통째로 풀린다.**
   * `config.json` 은 게이트웨이 열쇠가 든 파일이고, 이 자는 도구 울타리가
   * 부르는 자다(safety/guard.js 의 checkPaths) — 즉 그 순간 모델이
   * `cat D:/agent/config.json` 으로 열쇠를 읽는다.
   *
   * 기본 이름도 계속 본다. 옮겨 쓰다가 되돌린 사람, 프로젝트 안에 둔 `.deel`,
   * 남의 PC 에서 옮겨 온 폴더가 다 그 이름이다.
   */
  let i = 조각.lastIndexOf('.deel');
  if (i < 0) {
    try {
      const 집 = String(homeDir()).replace(/\\/g, '/').replace(/[/]+$/, '');
      const 낮은 = 편.toLowerCase();
      const 집낮은 = 집.toLowerCase();
      if (집 && (낮은 === 집낮은 || 낮은.startsWith(집낮은 + '/'))) {
        i = 집.split('/').length - 1;
      }
    } catch { /* 집을 못 물어봐도 아래 이름 검사는 그대로 돈다 */ }
  }
  if (i >= 0) {
    const 안 = 조각.slice(i + 1);
    if (안[0] === 'config.json') {
      return 'deel 자신의 설정 파일입니다. 게이트웨이 열쇠가 들어 있어 읽지 않습니다.'
        + ' 연결 상태가 궁금하면 사용자에게 /status 를 쳐 보라고 하세요.';
    }
    /*
     * mcp.json 도 **열쇠를 담는다.**
     *
     * 붙인 MCP 서버마다 `env` 를 통째로 적어 두는 자리라(backend/mcp.js),
     * 토큰이 그대로 들어 있는 경우가 흔하다. config.json 만 막고 이걸 안
     * 막으면 막은 것이 아니다 — 여기가 config.json 과 **같은 종류의 파일**인데
     * 목록에만 안 올라와 있었다.
     *
     * 목록으로 막는 방식이 늘 이렇게 샌다. 새 살림 파일을 늘릴 때는 여기를
     * 같이 봐야 한다 (검사: test/mention.test.js).
     */
    if (안[0] === 'mcp.json') {
      return 'MCP 서버 설정 파일입니다. 붙여 둔 서버의 환경변수(열쇠·토큰)가 들어 있어 읽지 않습니다.'
        + ' 어떤 서버가 붙어 있는지가 궁금하면 사용자에게 /mcp 를 쳐 보라고 하세요.';
    }
    if (['audit.jsonl', 'sessions', 'history'].includes(안[0])) {
      return 'deel 자신의 기록입니다(무엇을 했는지 적어 둔 것). 지금 하는 일에 도움이 안 되고'
        + ' 컨텍스트만 차서 읽지 않습니다. 필요한 것은 대화에 이미 다 있습니다.';
    }
  }
  // 남의 도구 살림. 목록은 남의도구살림 한 곳에만 있다 — 훑는 쪽과 같은 것을 본다.
  const 걸린것 = 조각.find((seg) => 남의도구살림.has(seg)) ?? (남의도구파일.test(이름) ? 이름 : null);
  if (걸린것) {
    return `${걸린것} 은 다른 코딩 도구가 제 기록을 넣어 두는 자리입니다.`
      + ' 지난 대화·명령 이력·열쇠 같은 것이라 이 작업과 상관이 없고, 읽으면 컨텍스트만 찹니다.'
      + ' 정말 그 안의 내용이 필요하면 사용자에게 직접 물어보세요.';
  }
  if (이름 === 'audit.jsonl') {
    return 'deel 자신의 기록입니다. 읽어도 지금 하는 일에 도움이 안 됩니다.';
  }
  return null;
}

// glob 을 정규식으로. **  *  ?  {a,b}  [abc] 를 지원한다.
export function globToRegex(pattern) {
  let re = '';
  let i = 0;
  const p = pattern.replace(/\\/g, '/');
  while (i < p.length) {
    const ch = p[i];
    if (ch === '*') {
      if (p[i + 1] === '*') {
        // **/ 는 "0개 이상의 폴더", ** 는 "무엇이든"
        if (p[i + 2] === '/') { re += '(?:[^/]*\\/)*'; i += 3; }
        else { re += '.*'; i += 2; }
      } else { re += '[^/]*'; i += 1; }
    } else if (ch === '?') { re += '[^/]'; i += 1; }
    else if (ch === '{') {
      const end = p.indexOf('}', i);
      if (end < 0) { re += '\\{'; i += 1; }
      else {
        const parts = p.slice(i + 1, end).split(',').map(escapeLiteral);
        re += `(?:${parts.join('|')})`;
        i = end + 1;
      }
    } else if (ch === '[') {
      const end = p.indexOf(']', i);
      if (end < 0) { re += '\\['; i += 1; }
      else { re += p.slice(i, end + 1); i = end + 1; }
    } else { re += escapeLiteral(ch); i += 1; }
  }
  return new RegExp(`^${re}$`, process.platform === 'win32' ? 'i' : '');
}

function escapeLiteral(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 폴더를 훑어 파일 목록을 낸다. { path(절대), rel(/구분), mtime, size }
 *
 * `ignore` 가 켜져 있으면(기본) .gitignore 가 건너뛰라는 것은 건너뛴다 (tools/ignore.js).
 * skipDirs 는 그 아래의 바닥이다 — .gitignore 가 없어도 node_modules 는 늘 건너뛴다.
 * 돌려주는 배열에는 `건너뜀 = { 폴더, 파일 }` 이 (열거되지 않게) 붙어 있다. 부르는 쪽이 그 수를
 * 화면에 적는다 — 조용히 빼면 "그 파일이 없다" 로 읽힌다.
 * 폴더를 통째로 옮기거나 복사할 때는 `ignore: false` 로 — 그때는 다 있어야 한다.
 *
 * `잘림` 도 같이 붙는다 — **상한에서 멈췄다는 뜻이다.**
 *
 * 전에는 이 상한이 조용했다. 파일 5만 개짜리 저장소에서 앞의 2만 개만 훑고
 * 멈추는데, 아무 데도 그 말이 안 나갔다. 그래서 `Grep` 이 "일치 없음" 이라고
 * 답했다 — 실제로는 뒤쪽 3만 개에 100군데가 있는데도. 못 찾은 것과 안 본 것은
 * 다르고, 그걸 안 가르면 사람은 없는 줄 알고 그냥 간다. 조용한 상한은
 * 틀린 답보다 나쁘다.
 */
export const 기본훑기상한 = 20000;

/**
 * 몇 개까지 훑을까.
 *
 * 2만 개는 대부분의 저장소에 넉넉하지만 큰 단일 저장소에는 모자란다. 그래서
 * 올릴 수 있게 열어 둔다 — 못 보는 것을 알려 주기만 하고 손쓸 방법이 없으면
 * 알려 준 뜻이 없다. 터무니없는 값은 안 받는다(100 미만·200만 초과).
 */
export function 훑기상한(env = process.env) {
  const n = Number(env.DEEL_WALK_LIMIT);
  if (!Number.isFinite(n) || n < 100 || n > 2000000) return 기본훑기상한;
  return Math.floor(n);
}

/**
 * 폴더를 훑는다.
 *
 * @param {AbortSignal|null} signal 멈추라면 훑다 말고 나온다.
 *   사내망 드라이브에서는 파일 20,000개 훑기가 몇 초다. 그 사이에
 *   ESC 를 눌렀는데 끝까지 다 훑고 나서 멈추면, 사람 눈에는 멈추지
 *   않는 것으로 보인다. 나온 것에 `끊김` 을 달아 부르는 쪽이 알게 한다 —
 *   조용히 적게 돌려주면 「그런 파일이 없다」가 되어 버린다.
 */
export function walk(root, { limit = 훑기상한(), skipDirs = SKIP_DIRS, ignore = true, signal = null } = {}) {
  const out = [];
  const 건너뜀 = { 폴더: 0, 파일: 0 };
  let 끊김 = false;
  const stack = [{ dir: root, rel: '', 규칙: ignore ? 뿌리규칙읽기(root) : [] }];
  while (stack.length && out.length < limit) {
    if (signal?.aborted) { 끊김 = true; break; }
    const { dir, rel, 규칙 } = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    // 이 폴더에 .gitignore 가 있으면 그 아래에만 더한다 (뿌리 것은 위에서 읽었다).
    let 여기규칙 = 규칙;
    if (ignore && rel && entries.some((e) => e.name === '.gitignore' && e.isFile())) {
      const 추가 = 파일규칙읽기(join(dir, '.gitignore'), rel);
      if (추가.length) 여기규칙 = [...규칙, ...추가];
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      const erel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (skipDirs.has(e.name)) continue;
        if (여기규칙.length && 걸리나(erel, true, 여기규칙)) { 건너뜀.폴더 += 1; continue; }
        stack.push({ dir: full, rel: erel, 규칙: 여기규칙 });
      } else if (e.isFile()) {
        if (여기규칙.length && 걸리나(erel, false, 여기규칙)) { 건너뜀.파일 += 1; continue; }
        let st;
        try { st = statSync(full); } catch { continue; }
        out.push({ path: full, rel: erel, mtime: st.mtimeMs, size: st.size });
        if (out.length >= limit) break;
      }
    }
  }
  Object.defineProperty(out, '건너뜀', { value: 건너뜀, enumerable: false });
  // 상한까지 찼으면 "여기서 멈췄다" 고 표시한다. 딱 맞아떨어져 끝난 경우까지
  // 잘렸다고 하게 되지만, 그쪽으로 틀리는 편이 낫다 — 덜 봤다고 말하는 것은
  // 사람을 한 번 더 보게 만들 뿐이고, 다 봤다고 말하는 것은 못 보게 만든다.
  Object.defineProperty(out, '잘림', { value: out.length >= limit, enumerable: false });
  Object.defineProperty(out, '상한', { value: limit, enumerable: false });
  Object.defineProperty(out, '끊김', { value: 끊김, enumerable: false });
  return out;
}

/**
 * 글 파일을 읽는다. 무엇으로 쓰여 있든 알아보고 읽는다.
 *
 * 두 번째 값으로 '무엇으로 읽었는지' 를 같이 준다. 부르는 쪽이 그걸 기억해 뒀다가
 * 되돌려 쓸 때 같은 인코딩으로 넣어야 한다. 안 그러면 사내 CP949 문서를 한 번
 * 고치는 것만으로 UTF-8 로 바뀌어 버린다.
 */
export function readTextFull(path) {
  const buf = readFileSync(path);
  if (looksBinary(buf)) {
    const err = new Error('바이너리 파일입니다 — 텍스트로 읽을 수 없습니다');
    err.binary = true;
    throw err;
  }
  const r = decode(buf);
  return { text: r.text, encoding: r.encoding, sure: r.sure, bom: r.bom ?? 0 };
}

/** 글만 필요할 때. 예전 부르던 자리를 그대로 두기 위해 남긴다. */
export function readText(path) {
  return readTextFull(path).text;
}
