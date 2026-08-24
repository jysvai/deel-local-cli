// 파일 훑기와 glob 매칭. 외부 패키지 없이 직접 구현한다.
import { readdirSync, statSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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

export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.deel', '.svn', '.hg', 'dist', 'build',
  '.next', '.nuxt', '.cache', '__pycache__', '.venv', 'venv', 'target',
]);

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

// 폴더를 훑어 파일 목록을 낸다. { path(절대), rel(/구분), mtime, size }
export function walk(root, { limit = 20000, skipDirs = SKIP_DIRS } = {}) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < limit) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (skipDirs.has(e.name)) continue;
        stack.push(full);
      } else if (e.isFile()) {
        let st;
        try { st = statSync(full); } catch { continue; }
        out.push({
          path: full,
          rel: relative(root, full).split(sep).join('/'),
          mtime: st.mtimeMs,
          size: st.size,
        });
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

// 텍스트 파일인지 — 앞부분에 NUL 이 있으면 바이너리로 본다.
export function isText(path) {
  try {
    const fd = readFileSync(path);
    return !fd.subarray(0, 8000).includes(0);
  } catch { return false; }
}

export function readText(path) {
  const buf = readFileSync(path);
  if (buf.subarray(0, 8000).includes(0)) {
    const err = new Error('바이너리 파일입니다 — 텍스트로 읽을 수 없습니다');
    err.binary = true;
    throw err;
  }
  return buf.toString('utf8');
}
