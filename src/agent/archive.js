// 접은 원문을 디스크에 손실 없이 남기고 번호로 되찾는다.
//
// 컨텍스트에서 확실히 빼면서 사실을 안 잃으려면 줄이는 자리와 보관하는 자리를 갈라야 한다.
// 모델은 바이트가 아니라 토큰을 읽어서, 이진·base64 를 주면 오히려 늘어난다. 압축은 디스크 쪽 일이고,
// 컨텍스트에는 번호만 남는다. brotli 는 node 에 들어 있어 의존성이 안 는다.
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sessionsDir } from './store.js';

const 보관기간 = 14 * 24 * 60 * 60 * 1000;
const 폴더 = (root) => join(sessionsDir(root), 'archive');
const 번호들 = (곳) => readdirSync(곳).map((x) => /^(\d+)\.br$/.exec(x)?.[1]).filter(Boolean).map(Number);

function 오래된것치우기(곳) {
  const 문턱 = Date.now() - 보관기간;
  for (const n of 번호들(곳)) {
    const 파일 = join(곳, `${n}.br`);
    try { if (statSync(파일).mtimeMs < 문턱) rmSync(파일, { force: true }); } catch { /* 지워지는 중이다 */ }
  }
}

/**
 * @returns {number|null} 되찾을 번호. 못 남겼으면 null — 접기는 그래도 계속한다.
 */
export function 보관(root, 글) {
  try {
    const 곳 = 폴더(root);
    mkdirSync(곳, { recursive: true });
    오래된것치우기(곳);
    const 압축 = brotliCompressSync(Buffer.from(String(글), 'utf8'), { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
    let n = Math.max(0, ...번호들(곳)) + 1;
    // 딴 창의 deel 과 번호가 겹치면 다음 번호로 간다. 남의 원문을 덮어쓰지 않는다.
    for (let 시도 = 0; 시도 < 8; 시도 += 1, n += 1) {
      try { writeFileSync(join(곳, `${n}.br`), 압축, { flag: 'wx', mode: 0o600 }); return n; }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
  } catch { /* 디스크가 찼거나 권한이 없다 */ }
  return null;
}

/** @returns {string|null} 원문. 없는 번호면 null. */
export function 되찾기(root, 번호) {
  const n = Number(번호);
  if (!Number.isInteger(n) || n < 1) return null;
  try { return brotliDecompressSync(readFileSync(join(폴더(root), `${n}.br`))).toString('utf8'); }
  catch { return null; }
}
