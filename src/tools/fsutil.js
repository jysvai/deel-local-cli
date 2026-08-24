// 파일 훑기와 glob 매칭. 외부 패키지 없이 직접 구현한다.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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
