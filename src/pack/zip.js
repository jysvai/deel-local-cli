// ZIP 쓰기. Node 내장 zlib 만 쓴다.
//
// 윈도우의 Compress-Archive 는 한글 파일 이름을 보장하지 못한다.
// 여기서는 이름을 UTF-8 로 쓰고 플래그 11번 비트를 세워, 어디서 풀어도 이름이 살아 있게 한다.
import { deflateRawSync } from 'node:zlib';

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
