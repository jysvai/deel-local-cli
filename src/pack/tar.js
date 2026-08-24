// tar 읽기. GitHub 가 주는 tarball 을 풀기 위한 최소 구현.
// git 이 없는 기기에서도 플러그인을 받을 수 있어야 해서 필요하다.
import { gunzipSync } from 'node:zlib';

const BLOCK = 512;

function str(buf, off, len) {
  const end = buf.indexOf(0, off);
  const stop = end >= 0 && end < off + len ? end : off + len;
  return buf.toString('utf8', off, stop).trim();
}

function octal(buf, off, len) {
  const s = str(buf, off, len).replace(/[^0-7]/g, '');
  return s ? parseInt(s, 8) : 0;
}

/**
 * gzip 된 tar 를 풀어 파일 목록을 돌려준다.
 * @returns {Array<{name:string, data:Buffer, mode:number}>}
 */
export function untargz(gz) {
  const buf = gunzipSync(gz);
  const out = [];
  let pos = 0;
  let longName = null;

  while (pos + BLOCK <= buf.length) {
    const head = buf.subarray(pos, pos + BLOCK);
    // 빈 블록 두 개면 끝.
    if (head.every((b) => b === 0)) break;

    const size = octal(head, 124, 12);
    const type = String.fromCharCode(head[156]) || '0';
    const mode = octal(head, 100, 8);
    const prefix = str(head, 345, 155);
    let name = str(head, 0, 100);
    if (prefix) name = `${prefix}/${name}`;

    pos += BLOCK;
    const data = buf.subarray(pos, pos + size);
    pos += Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L') {                    // GNU 긴 이름
      longName = data.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (type === 'x' || type === 'g') {    // pax 확장 머리 — path 만 본다
      const m = /\d+ path=([^\n]+)\n/.exec(data.toString('utf8'));
      if (m) longName = m[1];
      continue;
    }
    if (longName) { name = longName; longName = null; }

    if (type === '0' || type === '\0' || type === '') {
      out.push({ name: name.replace(/\\/g, '/'), data: Buffer.from(data), mode: mode || 0o644 });
    }
    // 폴더('5')·링크 등은 건너뛴다. 파일만 있으면 폴더는 만들면서 채운다.
  }
  return out;
}

// GitHub tarball 은 최상위에 <repo>-<커밋> 폴더 한 겹이 더 있다. 그걸 벗긴다.
export function stripTop(files) {
  if (!files.length) return files;
  const first = files[0].name.split('/')[0];
  if (!files.every((f) => f.name.startsWith(first + '/'))) return files;
  return files.map((f) => ({ ...f, name: f.name.slice(first.length + 1) }));
}
