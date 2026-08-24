// ZIP 읽기·쓰기. Node 내장 zlib 만 쓴다.
//
// 윈도우의 Compress-Archive 는 한글 파일 이름을 보장하지 못한다.
// 여기서는 이름을 UTF-8 로 쓰고 플래그 11번 비트를 세워, 어디서 풀어도 이름이 살아 있게 한다.
//
// 읽기는 나중에 붙였다. xlsx 가 사실은 zip 이기 때문이다 — 엑셀 파일을 열려면
// 먼저 이걸 풀어야 한다. 형식이 같으니 한자리에 둔다.
import { deflateRawSync, inflateRawSync } from 'node:zlib';

// --- CRC32 ---------------------------------------------------------------
const TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// --- DOS 날짜·시각 --------------------------------------------------------
function dosTime(d) {
  return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
}
function dosDate(d) {
  return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
}

const UTF8_NAMES = 0x0800;   // 플래그 11번 비트 — 이름이 UTF-8 이라는 표시

/**
 * @param {Array<{name:string, data:Buffer, mtime?:Date, mode?:number}>} entries
 *        name 은 zip 안에서의 경로. 구분자는 항상 '/'.
 *        mode 는 유닉스 권한(예: 0o755). 실행 파일에 필요하다.
 * @returns {Buffer}
 */
export function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8');
    const raw = e.data;
    const crc = crc32(raw);

    // 압축해서 더 커지면 그냥 담는다(store).
    const packed = deflateRawSync(raw, { level: 9 });
    const useDeflate = packed.length < raw.length;
    const body = useDeflate ? packed : raw;
    const method = useDeflate ? 8 : 0;

    const when = e.mtime ?? new Date();
    const time = dosTime(when);
    const date = dosDate(when);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(UTF8_NAMES, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(0x031e, 4);            // 만든 쪽: 유닉스, 버전 3.0
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(UTF8_NAMES, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    // 바깥 속성 위쪽 16비트에 유닉스 권한. bin 의 실행 권한이 여기 실린다.
    ch.writeUInt32LE(((e.mode ?? 0o644) & 0xffff) << 16, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + body.length;
  }

  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, cd, eocd]);
}

// --- ZIP 읽기 -------------------------------------------------------------
//
// 뒤에서부터 읽는다. zip 은 목록(중앙 디렉터리)이 파일 끝에 있고, 그 위치를
// 알려주는 표식(EOCD)이 맨 끝에 있다. 앞에서부터 훑지 않는 이유가 이것이다.

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEocd(buf) {
  // 주석이 붙어 있을 수 있어서 끝에서 최대 64KB 를 뒤로 훑는다.
  const 끝 = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= 끝; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * zip 안의 파일들을 이름 → 내용(Buffer) 으로 돌려준다.
 *
 * 필요한 것만 만들었다 — 담기(store)와 deflate 두 가지. 그게 xlsx 가 쓰는 전부다.
 * 모르는 것을 만나면 조용히 넘기지 않고 무엇을 못 했는지 말한다.
 * 조용히 넘기면 '표가 비어 있다' 로 보이고, 그때는 원인을 찾을 수 없다.
 *
 * @param {Buffer} buf
 * @param {{ only?: (name:string)=>boolean }} [opt] 필요한 것만 풀고 싶을 때
 * @returns {{ files: Map<string,Buffer>, skipped: Array<{name:string, why:string}> }}
 */
export function readZip(buf, { only = null } = {}) {
  const files = new Map();
  const skipped = [];

  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('zip 이 아닙니다 — 끝에 있어야 할 표식을 못 찾았습니다');

  let 개수 = buf.readUInt16LE(eocd + 10);
  let 시작 = buf.readUInt32LE(eocd + 16);
  // 0xffff/0xffffffff 는 'ZIP64 를 보라' 는 표시다. 여기서는 다루지 않는다.
  // 못 다룬다고 말하는 편이 반쯤 읽어 놓고 맞다고 하는 것보다 낫다.
  if (개수 === 0xffff || 시작 === 0xffffffff) {
    throw new Error('ZIP64 형식입니다 — 이 읽기는 4GB 미만 zip 만 다룹니다');
  }

  let p = 시작;
  for (let i = 0; i < 개수; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) {
      throw new Error(`zip 목록이 깨졌습니다 (${i + 1}번째 항목)`);
    }
    const method = buf.readUInt16LE(p + 10);
    const flags = buf.readUInt16LE(p + 8);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    // 이름은 UTF-8 표시가 있으면 UTF-8, 없으면 예전 zip 관례대로 그냥 바이트다.
    // xlsx 는 안쪽 이름이 전부 ASCII 라 어느 쪽이든 같다.
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;              // 폴더
    if (only && !only(name)) continue;

    // 암호가 걸린 항목은 첫 비트가 서 있다. xlsx 전체 암호와는 다른 것이지만,
    // 어느 쪽이든 여기서는 못 푼다.
    if (flags & 0x0001) { skipped.push({ name, why: '항목에 암호가 걸려 있음' }); continue; }

    if (localAt + 30 > buf.length || buf.readUInt32LE(localAt) !== LOC_SIG) {
      skipped.push({ name, why: '내용 위치가 어긋남' });
      continue;
    }
    const lnLen = buf.readUInt16LE(localAt + 26);
    const leLen = buf.readUInt16LE(localAt + 28);
    const at = localAt + 30 + lnLen + leLen;
    const body = buf.subarray(at, at + compSize);

    if (method === 0) {
      files.set(name, Buffer.from(body));
    } else if (method === 8) {
      try {
        const out = inflateRawSync(body);
        if (rawSize && out.length !== rawSize) {
          skipped.push({ name, why: `푼 크기가 안 맞음 (${out.length} ≠ ${rawSize})` });
          continue;
        }
        files.set(name, out);
      } catch (err) {
        skipped.push({ name, why: `풀지 못함 — ${err.message}` });
      }
    } else {
      skipped.push({ name, why: `모르는 압축 방식 ${method}` });
    }
  }

  return { files, skipped };
}

/** 앞머리 네 바이트로 zip 인지 본다. 엑셀 암호 파일과 구분하는 데 쓴다. */
export function looksZip(buf) {
  return buf.length >= 4 && buf.readUInt32LE(0) === LOC_SIG;
}
