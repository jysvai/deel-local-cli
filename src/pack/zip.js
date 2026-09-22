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
/*
 * DOS 날짜의 해는 1980 부터 일곱 비트, 즉 2107 까지다 (6회차 Gemini 묶음6).
 *
 * 묶기는 파일 mtime 을 그대로 싣는데, 1970 시각인 파일(재현 빌드·풀어 온 묶음)은 `-10 << 9` 가 위 비트를
 * 채워 목록에 **2098 년**으로 적혔고, 2108 년은 0 으로 돌아 1980 이 됐다. 담을 수 있는 끝에 붙인다.
 */
function 담을시각(d) {
  const 해 = d.getFullYear();
  if (!(해 >= 1980)) return new Date(1980, 0, 1);
  if (해 > 2107) return new Date(2107, 11, 31, 23, 59, 58);
  return d;
}

const UTF8_NAMES = 0x0800;   // 플래그 11번 비트 — 이름이 UTF-8 이라는 표시

/*
 * 한 꾸러미에서 풀어 줄 크기의 **합** (2.0.0 3회차 사냥).
 *
 * readZip 은 항목 하나를 64MB 에서 멈춘다. 그런데 합은 안 봤다 — 64MB 로 부푸는 몇십 KB 짜리 조각을
 * 수백 개 담은 .docx 하나면 푼 버퍼가 전부 Map 에 붙들린 채 메모리가 바닥나 대화까지 같이 죽는다.
 * 모델이 시키는 대로 여는 파일이라 남이 정한 바이트다. tar 쪽 푼것상한(256MB)과 같은 크기로 둔다.
 * 넘는 항목은 건너뛴 것(skipped)으로 이름과 까닭을 남긴다.
 */
export const 풀기총상한 = 256 * 1024 * 1024;

/*
 * ── zip64 없이 담을 수 있는 끝 (2.0.2 · Z5) ───────────────────────────────────
 *
 * 이 zip 은 zip64 를 안 쓴다. 항목 수·이름 길이는 16비트, 크기·자리는 32비트 칸이다.
 * 넘으면 `writeUInt16LE` 가 날것 RangeError(「must be >= 0 and <= 65535」)를 던졌다 —
 * 그것도 파일 수만 개를 **다 눌러 담은 뒤** 맨 끝 표식을 쓰다가. 무엇이 넘었는지 사람
 * 말로, 넘는 순간에 멈춘다. 검사에서 끝을 좁혀 잴 수 있게 한도는 넘겨받는다.
 */
export const zip한도 = { 개수: 0xffff, 이름: 0xffff, 크기: 0xffffffff };

/**
 * @param {Array<{name:string, data:Buffer, mtime?:Date, mode?:number}>} entries
 *        name 은 zip 안에서의 경로. 구분자는 항상 '/'.
 *        mode 는 유닉스 권한(예: 0o755). 실행 파일에 필요하다.
 * @returns {Buffer}
 */
export function makeZip(entries, 한도 = zip한도) {
  if (entries.length > 한도.개수) {
    throw new Error(`zip 에 담을 파일이 ${entries.length.toLocaleString('en-US')}개입니다 — 한 묶음에 ${한도.개수.toLocaleString('en-US')}개까지 담습니다 (zip64 는 만들지 않습니다). 나눠서 묶으세요.`);
  }
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
    if (nameBuf.length > 한도.이름) throw new Error(`zip 에 담을 이름이 너무 깁니다 (${nameBuf.length}바이트) — ${한도.이름}바이트까지: ${e.name.slice(0, 80)}…`);
    if (raw.length > 한도.크기 || offset + 30 + nameBuf.length + body.length > 한도.크기) {
      throw new Error(`zip 이 zip64 없이 담는 크기(${한도.크기.toLocaleString('en-US')}바이트 · 약 4GB)를 넘습니다 — 나눠서 묶으세요 (넘은 자리: ${e.name})`);
    }

    const when = 담을시각(e.mtime ?? new Date());
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
    // `<< 16` 은 부호 있는 32비트라 파일 종류 비트(statSync 의 0o100755)가 붙으면 음수가 되어
    // writeUInt32LE 가 던졌다 — `>>> 0` 으로 부호 없는 수로 돌린다 (6회차 Gemini 묶음6).
    ch.writeUInt32LE((((e.mode ?? 0o644) & 0xffff) << 16) >>> 0, 38);
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
  /*
   * 주석은 아무 바이트나 담는다 — 같은 네 바이트가 주석 안에 있으면 뒤에서 처음 만난 그것을 끝표식으로
   * 읽어 목록 0개를 조용히 냈다 (6회차 Gemini 묶음6). 진짜 끝표식은 **목록이 바로 앞에서 끝난다**
   * (시작 + 크기 = 제자리). 그런 것이 없으면(앞에 딴 바이트가 붙은 자체 풀림 exe 등) 예전대로 처음 것.
   */
  let 처음 = -1;
  for (let i = buf.length - 22; i >= 끝; i--) {
    if (buf.readUInt32LE(i) !== EOCD_SIG) continue;
    if (처음 < 0) 처음 = i;
    if (buf.readUInt32LE(i + 16) + buf.readUInt32LE(i + 12) === i) return i;
  }
  return 처음;
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
export function readZip(buf, { only = null, 총상한 = 풀기총상한 } = {}) {
  const files = new Map();
  const skipped = [];
  // 푼 크기의 합. 항목마다 64MB 상한만 두면 64MB 로 부푸는 조각 수백 개로 메모리가 바닥난다(풀기총상한 머리말).
  let 푼합 = 0;
  /*
   * 건너뛴 까닭을 **둘로 가른다** (2.0.0 8회차 판정).
   *
   * 여태 한 가지 말만 남겼다 — 「나머지는 안 풀었습니다」. 그런데 코드는
   * `continue` 라서 **뒤따르는 작은 항목은 그대로 푼다.** 동작은 옳다(자리에
   * 들어가는 만큼은 준다). 틀린 것은 말이었다. 받는 쪽은 그 뒤가 비었다고 읽는다.
   *
   *   · 자리가 아예 없다(남은 ≤ 0)  → 이 뒤로는 정말 아무것도 안 푼다
   *   · 이 항목 하나가 자리보다 크다 → 이것만 건너뛰고 뒤엣것은 계속 푼다
   */
  const MB = Math.round(총상한 / 1024 / 1024 * 10) / 10;
  const 자리없음 = () => `푼 크기의 합이 상한(${MB}MB)을 다 씀 — 이 뒤로는 아무것도 안 풀었습니다`;
  const 혼자큼 = (크기, 남은) => `이 항목 하나가 남은 자리보다 큼 (${크기} > ${남은}, 상한 ${MB}MB) — 이것만 건너뛰고 뒤엣것은 계속 풉니다`;
  /*
   * ── 푼 내용이 목록의 CRC32 와 맞나 ─────────────────────────────────────
   *
   * 크기만 봤다 (2.0.0 4회차 사냥). 담기(store)로 들어간 알맹이 한 바이트가 망가져도,
   * deflate 가 크기는 맞게 풀리는데 내용이 틀려도 그대로 「읽었다」 로 내놨다. xlsx 라면
   * 숫자 하나가 소리 없이 바뀐 표다. 틀리면 건너뛴 것으로 이름과 까닭을 남긴다 —
   * 이 함수 머리말대로 조용히 넘기지 않는다.
   *
   * 값: 표 기반 JS CRC32 가 64MB 에 0.1초 남짓이라 풀기총상한(256MB)을 다 채워도 1초 안이다.
   */
  const CRC틀림 = (name, 내용, 적힌) => {
    const 실제 = crc32(내용);
    if (실제 === 적힌) return false;
    const 열여섯 = (n) => n.toString(16).padStart(8, '0');
    skipped.push({ name, why: `CRC 가 안 맞음 — 내용이 망가졌습니다 (목록 ${열여섯(적힌)} ≠ 실제 ${열여섯(실제)})` });
    return true;
  };

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
    // 로컬 머리의 CRC 가 아니라 중앙 목록의 것을 쓴다. 플래그 3번 비트(뒤에 붙는 기술자)가
    // 선 항목은 로컬 머리에 0 이 적혀 있고, 중앙 목록에는 늘 참값이 있다.
    const 적힌crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    // 이름은 UTF-8 표시가 있으면 UTF-8, 없으면 예전 zip 관례대로 그냥 바이트다.
    // xlsx 는 안쪽 이름이 전부 ASCII 라 어느 쪽이든 같다.
    // 옛 .NET(ZipFile, 4.6.1 전)은 이름을 역슬래시로 적는다. 목록에서 'xl/workbook.xml' 을 찾는 쪽이
    // 못 찾아 표가 비어 보였다 — 표준(APPNOTE 4.4.17)의 '/' 로 맞춘다 (6회차 Gemini 묶음6).
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
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

    const 남은 = 총상한 - 푼합;
    const 이크기 = method === 0 ? body.length : rawSize;
    if (남은 <= 0) { skipped.push({ name, why: 자리없음() }); continue; }
    if (이크기 > 남은) { skipped.push({ name, why: 혼자큼(이크기, 남은) }); continue; }
    if (method === 0) {
      // 담기(store)는 누른 크기와 푼 크기가 같아야 한다. 목록이 다른 숫자를
      // 적어 뒀으면 둘 중 하나가 거짓말이다 — 어느 쪽이든 그대로 쓰면 안 된다.
      if (body.length !== rawSize) {
        skipped.push({ name, why: `푼 크기가 안 맞음 (${body.length} ≠ ${rawSize})` });
        continue;
      }
      // 알맹이가 버퍼 끝에서 잘려 짧아진 것도 여기서 CRC 로 걸린다.
      if (CRC틀림(name, body, 적힌crc)) continue;
      files.set(name, Buffer.from(body));
      푼합 += body.length;
    } else if (method === 8) {
      try {
        /*
         * ── 풀기 **전에** 상한을 정한다 ──────────────────────────────
         *
         * 여기가 `inflateRawSync(body)` 한 줄이었다. 다 풀어 놓고 나서
         * 크기를 견줬으니, 크기가 안 맞는 것을 **알아내는 시점이 이미 늦다.**
         *
         *   작은 deflate 조각 + 수 GB 로 부푸는 내용  →  프로세스가 죽는다
         *
         * `.docx`·`.xlsx` 는 사람이 아무 데서나 받아 오는 파일이고, 우리는
         * 모델이 시키는 대로 그것을 연다. 즉 남이 정한 바이트로 우리 메모리를
         * 정하게 두고 있었다. 목록에 적힌 크기(rawSize)를 이미 읽어 뒀으면서
         * 쓰지 않은 것이 아까운 자리다.
         *
         * zlib 는 `maxOutputLength` 로 그 자리에서 멈춰 준다. 다 풀고 재는
         * 것과 달리 **메모리를 안 쓰고** 멈춘다.
         */
        const 한항목상한 = 64 * 1024 * 1024;      // 이 프로그램이 여는 문서의 현실적 위쪽
        const 상한 = Math.min(rawSize > 0 ? rawSize : 한항목상한, 한항목상한, 남은);
        const out = inflateRawSync(body, { maxOutputLength: 상한 });
        /*
         * `rawSize &&` 가 앞에 있었다 (2.0.0 8회차 판정).
         *
         * 목록이 「이 항목은 0바이트」 라고 우기면 `&&` 가 거기서 멈춰 **크기
         * 대조를 통째로 건너뛰었다.** 0 이라고 적힌 항목이 몇십 바이트로 풀려
         * 나와도 그대로 「읽었다」 가 됐다. 크기를 안 보던 4회차 그 자리와 같은 꼴이다.
         *
         * 가운데 목록(central directory)의 크기 칸은 흘려보내기(data descriptor)를
         * 쓴 묶음에서도 늘 채워져 있다. 그래서 조건 없이 대 봐도 된다 —
         * 진짜 0바이트 파일은 `out.length` 도 0 이라 그대로 지나간다.
         */
        if (out.length !== rawSize) {
          skipped.push({ name, why: `푼 크기가 안 맞음 (${out.length} ≠ ${rawSize})` });
          continue;
        }
        if (CRC틀림(name, out, 적힌crc)) continue;
        files.set(name, out);
        푼합 += out.length;
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
