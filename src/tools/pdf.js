/**
 * PDF 읽기 — 쪽마다 글로.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 *
 * hwpx·docx·pptx 는 읽는데 PDF 를 못 읽었다. 그런데 사내에서 「이대로 만들어」
 * 하고 건네지는 스펙·공문·표준서는 대개 PDF 다. 못 읽으면 사람이 손으로
 * 복사해 붙여야 하고, 그 과정에서 표가 깨지고 쪽 순서가 섞인다.
 *
 * ── 왜 의존성 없이 되나 ─────────────────────────────────────────────────
 *
 * PDF 의 속은 「사전(<< >>)과 흐름(stream)」이고, 흐름은 거의 언제나
 * FlateDecode — 곧 zlib 이다. zlib 은 node 에 들어 있다. 그래서 새로 들이는
 * 것 없이 된다. 어려운 것은 압축이 아니라 **글자를 되찾는 일**이다.
 *
 *   PDF 안에 든 것은 글자가 아니라 **글리프 번호**다. 「가」가 아니라
 *   「이 글꼴의 1,283번째 그림」이 적혀 있다. 그래서 글꼴마다 딸린
 *   /ToUnicode 표를 읽어 번호를 글자로 되돌려야 한다. 한글 PDF 는 거의
 *   전부 Identity-H(두 바이트 글리프 번호)라 이 표가 없으면 한 글자도
 *   못 읽는다.
 *
 * ── 무엇을 못 하나 (그리고 그걸 말한다) ─────────────────────────────────
 *
 * PDF 는 「보이는 대로 인쇄하기」 위한 형식이라, 애초에 글이 안 들어 있는
 * 것이 흔하다.
 *
 *   · 스캔한 문서 — 쪽 전체가 사진 한 장이다. 글이 없다.
 *   · /ToUnicode 없는 Identity-H — 글리프 번호만 있고 되돌릴 표가 없다.
 *   · 암호가 걸린 문서 — 흐름이 통째로 암호화돼 있다.
 *
 * 이럴 때 **빈 글을 돌려주면 안 된다.** 빈 글은 「이 문서에는 그런 내용이
 * 없다」로 읽히고, 모델은 그걸 근거로 답한다. 그래서 못 읽은 쪽은 몇 쪽이
 * 왜 안 읽혔는지 이름을 붙여 말한다. 세 쪽짜리에서 두 쪽을 못 읽었으면
 * 그 문서로 무엇을 판단하면 안 되는지가 사람에게 보여야 한다.
 *
 * ── 읽기만 한다 ─────────────────────────────────────────────────────────
 *
 * 엑셀·문서와 같다. 고치기는 없다.
 */
import { readFileSync } from 'node:fs';
import { inflateSync, inflateRawSync, constants as zlib상수 } from 'node:zlib';

// 끝이 잘린 흐름을 부풀릴 때 쓴다 — 「여기까지」로 끝내 달라는 뜻.
const { Z_SYNC_FLUSH } = zlib상수;
import { extname, basename } from 'node:path';

/** 한 번에 글로 바꿔 줄 최대 글자. 넘으면 자르고 잘랐다고 말한다. */
const 최대글자 = 120000;

/* ────────────────────────────────────────────────────────────────────────
 * 1. 낱말 쪼개기
 * ──────────────────────────────────────────────────────────────────────── */

const 공백바이트 = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const 구분바이트 = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

const 공백인가 = (c) => 공백바이트.has(c);
const 끝인가 = (c) => c === undefined || 공백바이트.has(c) || 구분바이트.has(c);

/** 공백과 주석(%…)을 건너뛴다. */
function 건너뛰기(b, i) {
  for (;;) {
    while (i < b.length && 공백인가(b[i])) i += 1;
    if (b[i] === 0x25) {                       // '%' 주석은 줄 끝까지
      while (i < b.length && b[i] !== 0x0a && b[i] !== 0x0d) i += 1;
      continue;
    }
    return i;
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * 2. 값 읽기
 *
 * 돌려주는 꼴:
 *   이름   { 이름: 'Page' }
 *   참조   { 참조: 12, 세대: 0 }
 *   글자   { 바이트: Buffer }      ← PDF 의 문자열은 바이트 뭉치다.
 *   사전   보통 객체 { Type: {이름:'Page'}, … }
 *   흐름   { 사전: {...}, 날것: Buffer }
 *   그 밖  숫자 · true/false · null · 배열
 * ──────────────────────────────────────────────────────────────────────── */

/** `/Name` — `#XX` 는 16진수 한 글자다. */
function 이름읽기(b, i) {
  i += 1;
  const 조각 = [];
  while (i < b.length && !끝인가(b[i])) {
    if (b[i] === 0x23 && i + 2 < b.length) {
      const h = parseInt(String.fromCharCode(b[i + 1], b[i + 2]), 16);
      if (Number.isFinite(h)) { 조각.push(h); i += 3; continue; }
    }
    조각.push(b[i]); i += 1;
  }
  return [{ 이름: Buffer.from(조각).toString('latin1') }, i];
}

const 되돌린것 = { 0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08, 0x66: 0x0c };

/** `(글자)` — 괄호가 짝을 이루면 안쪽 괄호도 글자다. */
function 괄호글자읽기(b, i) {
  i += 1;
  const 조각 = [];
  let 깊이 = 1;
  while (i < b.length) {
    const c = b[i];
    if (c === 0x5c) {                          // 역슬래시
      const n = b[i + 1];
      if (n === undefined) break;
      if (n >= 0x30 && n <= 0x37) {            // 8진수 최대 세 자리
        let 여덟 = 0; let k = 0;
        while (k < 3 && b[i + 1 + k] >= 0x30 && b[i + 1 + k] <= 0x37) {
          여덟 = 여덟 * 8 + (b[i + 1 + k] - 0x30); k += 1;
        }
        조각.push(여덟 & 0xff); i += 1 + k; continue;
      }
      if (n === 0x0a) { i += 2; continue; }    // 줄 이음
      if (n === 0x0d) { i += (b[i + 2] === 0x0a ? 3 : 2); continue; }
      조각.push(되돌린것[n] ?? n); i += 2; continue;
    }
    if (c === 0x28) 깊이 += 1;
    if (c === 0x29) { 깊이 -= 1; if (!깊이) { i += 1; break; } }
    조각.push(c); i += 1;
  }
  return [{ 바이트: Buffer.from(조각) }, i];
}

/** `<AB12>` — 홀수면 마지막에 0 을 채운다(규격이 그렇다). */
function 열여섯글자읽기(b, i) {
  i += 1;
  const 자리 = [];
  while (i < b.length && b[i] !== 0x3e) {
    const c = b[i];
    if (!공백인가(c)) 자리.push(String.fromCharCode(c));
    i += 1;
  }
  i += 1;
  if (자리.length % 2) 자리.push('0');
  const 조각 = [];
  for (let k = 0; k < 자리.length; k += 2) 조각.push(parseInt(자리[k] + 자리[k + 1], 16) & 0xff);
  return [{ 바이트: Buffer.from(조각) }, i];
}

/**
 * 값 하나를 읽는다.
 *
 * @param 흐름풀기 흐름을 만났을 때 `/Length` 를 풀어 줄 함수(참조일 수 있다).
 *                 없으면 endstream 을 찾아서 자른다.
 */
export function 값읽기(b, i, 흐름풀기 = null) {
  i = 건너뛰기(b, i);
  const c = b[i];
  if (c === undefined) return [null, i];

  if (c === 0x2f) return 이름읽기(b, i);
  if (c === 0x28) return 괄호글자읽기(b, i);

  if (c === 0x3c) {
    if (b[i + 1] === 0x3c) return 사전읽기(b, i, 흐름풀기);
    return 열여섯글자읽기(b, i);
  }

  if (c === 0x5b) {                            // 배열
    i += 1;
    const 것들 = [];
    for (;;) {
      i = 건너뛰기(b, i);
      if (i >= b.length || b[i] === 0x5d) { i += 1; break; }
      const [값, 다음] = 값읽기(b, i, 흐름풀기);
      if (다음 === i) { i += 1; continue; }     // 못 읽는 글자는 버리고 나아간다
      것들.push(값); i = 다음;
    }
    return [것들, i];
  }

  if (c === 0x5d || c === 0x3e || c === 0x29) return [null, i + 1];   // 짝 안 맞는 닫기

  // 낱말 하나 (숫자 · true · false · null · 연산자)
  let j = i;
  while (j < b.length && !끝인가(b[j])) j += 1;
  const 말 = b.toString('latin1', i, j);

  if (말 === 'true') return [true, j];
  if (말 === 'false') return [false, j];
  if (말 === 'null') return [null, j];

  if (/^[+-]?[\d.]+$/.test(말)) {
    const 수 = Number(말.replace(/^([+-]?)\./, '$10.'));
    // `12 0 R` 인지 넘겨다본다. 참조를 숫자로 읽으면 온 문서가 어긋난다.
    if (Number.isInteger(수) && 수 >= 0) {
      let k = 건너뛰기(b, j);
      let k2 = k;
      while (k2 < b.length && !끝인가(b[k2])) k2 += 1;
      const 둘째 = b.toString('latin1', k, k2);
      if (/^\d+$/.test(둘째)) {
        const k3 = 건너뛰기(b, k2);
        if (b[k3] === 0x52 && 끝인가(b[k3 + 1])) {       // 'R'
          return [{ 참조: 수, 세대: Number(둘째) }, k3 + 1];
        }
      }
    }
    return [Number.isFinite(수) ? 수 : 0, j];
  }

  // 알 수 없는 낱말은 연산자로 본다 (내용 흐름에서 쓴다).
  return [{ 연산자: 말 }, j === i ? i + 1 : j];
}

/** `<< … >>` 그리고 바로 뒤에 stream 이 오면 흐름까지. */
function 사전읽기(b, i, 흐름풀기) {
  i += 2;
  const 것 = {};
  for (;;) {
    i = 건너뛰기(b, i);
    if (i >= b.length) break;
    if (b[i] === 0x3e && b[i + 1] === 0x3e) { i += 2; break; }
    if (b[i] !== 0x2f) {                        // 열쇠 자리에 이름이 아닌 것 — 버리고 나아간다
      const [, 다음] = 값읽기(b, i, 흐름풀기);
      if (다음 === i) i += 1; else i = 다음;
      continue;
    }
    const [열쇠, i2] = 이름읽기(b, i);
    const [값, i3] = 값읽기(b, i2, 흐름풀기);
    것[열쇠.이름] = 값;
    i = i3;
  }

  const j = 건너뛰기(b, i);
  if (b.toString('latin1', j, j + 6) !== 'stream') return [것, i];

  // 'stream' 뒤에는 CRLF 나 LF 가 온다 (CR 만은 규격 위반이지만 실제로 있다).
  let s = j + 6;
  if (b[s] === 0x0d) s += 1;
  if (b[s] === 0x0a) s += 1;

  let 길이 = 흐름풀기 ? 흐름풀기(것.Length) : (typeof 것.Length === 'number' ? 것.Length : null);
  let 끝 = Number.isInteger(길이) && 길이 >= 0 ? s + 길이 : -1;

  /*
   * 적힌 길이를 곧이곧대로 믿지 않는다.
   *
   * 길이가 틀린 PDF 가 실제로 많다(만든 프로그램이 나중에 고치면서 안 맞춘다).
   * 그대로 자르면 흐름이 깨져 그 쪽이 통째로 안 읽힌다. 그래서 자른 자리에
   * endstream 이 있는지 보고, 아니면 찾아서 맞춘다.
   */
  const 맞나 = 끝 >= 0 && 끝 <= b.length
    && /^\s*endstream/.test(b.toString('latin1', 끝, Math.min(끝 + 20, b.length)));
  if (!맞나) {
    const 찾은 = b.indexOf('endstream', s, 'latin1');
    끝 = 찾은 < 0 ? b.length : 찾은;
    // endstream 바로 앞의 줄바꿈은 흐름의 일부가 아니다.
    while (끝 > s && (b[끝 - 1] === 0x0a || b[끝 - 1] === 0x0d)) 끝 -= 1;
  }

  const 날것 = b.subarray(s, Math.max(s, Math.min(끝, b.length)));
  const 뒤 = b.indexOf('endstream', Math.max(s, 끝), 'latin1');
  return [{ 사전: 것, 날것 }, 뒤 < 0 ? b.length : 뒤 + 9];
}

/* ────────────────────────────────────────────────────────────────────────
 * 3. 걸러내기 (filters)
 * ──────────────────────────────────────────────────────────────────────── */

/** 앞자리 예측(PNG predictor). xref 흐름과 그림에 쓴다. */
function 예측되돌리기(자료, { 예측, 칸수, 색수, 비트 }) {
  if (!예측 || 예측 < 2) return 자료;
  if (예측 === 2) return 자료;                   // TIFF 예측 — 흔치 않고 xref 엔 안 쓴다
  const 한칸 = Math.ceil((색수 * 비트) / 8);
  const 한줄 = Math.ceil((색수 * 비트 * 칸수) / 8);
  const 줄수 = Math.floor(자료.length / (한줄 + 1));
  const 나온것 = Buffer.alloc(줄수 * 한줄);
  let 앞줄 = Buffer.alloc(한줄);
  for (let r = 0; r < 줄수; r += 1) {
    const 표 = 자료[r * (한줄 + 1)];
    const 줄 = Buffer.from(자료.subarray(r * (한줄 + 1) + 1, (r + 1) * (한줄 + 1)));
    for (let k = 0; k < 한줄; k += 1) {
      const a = k >= 한칸 ? 줄[k - 한칸] : 0;
      const bb = 앞줄[k];
      const cc = k >= 한칸 ? 앞줄[k - 한칸] : 0;
      let v = 줄[k];
      if (표 === 1) v += a;
      else if (표 === 2) v += bb;
      else if (표 === 3) v += Math.floor((a + bb) / 2);
      else if (표 === 4) {
        const p = a + bb - cc;
        const pa = Math.abs(p - a); const pb = Math.abs(p - bb); const pc = Math.abs(p - cc);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : cc);
      }
      줄[k] = v & 0xff;
    }
    줄.copy(나온것, r * 한줄);
    앞줄 = 줄;
  }
  return 나온것;
}

function 아스키85풀기(buf) {
  const s = buf.toString('latin1').replace(/\s/g, '').replace(/^<~/, '');
  const 끝 = s.indexOf('~>');
  const 몸 = 끝 < 0 ? s : s.slice(0, 끝);
  const 나온것 = [];
  let 묶음 = []; let i = 0;
  while (i < 몸.length) {
    const ch = 몸[i];
    if (ch === 'z' && !묶음.length) { 나온것.push(0, 0, 0, 0); i += 1; continue; }
    묶음.push(몸.charCodeAt(i) - 33); i += 1;
    if (묶음.length === 5) {
      let v = 0;
      for (const x of 묶음) v = v * 85 + x;
      나온것.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
      묶음 = [];
    }
  }
  if (묶음.length > 1) {
    const n = 묶음.length;
    while (묶음.length < 5) 묶음.push(84);
    let v = 0;
    for (const x of 묶음) v = v * 85 + x;
    const 넷 = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    나온것.push(...넷.slice(0, n - 1));
  }
  return Buffer.from(나온것);
}

function 아스키16풀기(buf) {
  const s = buf.toString('latin1').replace(/\s/g, '');
  const 끝 = s.indexOf('>');
  let 몸 = 끝 < 0 ? s : s.slice(0, 끝);
  if (몸.length % 2) 몸 += '0';
  const 나온것 = [];
  for (let i = 0; i < 몸.length; i += 2) 나온것.push(parseInt(몸.slice(i, i + 2), 16) & 0xff);
  return Buffer.from(나온것);
}

function 되풀이풀기(buf) {
  const 나온것 = [];
  let i = 0;
  while (i < buf.length) {
    const n = buf[i];
    if (n === 128) break;
    if (n < 128) { for (let k = 0; k <= n; k += 1) 나온것.push(buf[i + 1 + k] ?? 0); i += n + 2; }
    else { const v = buf[i + 1] ?? 0; for (let k = 0; k < 257 - n; k += 1) 나온것.push(v); i += 2; }
  }
  return Buffer.from(나온것);
}

/** zlib 머리가 깨진 흐름이 흔해서, 날것(raw)으로도 한 번 더 해 본다. */
function 부풀리기(buf) {
  try { return inflateSync(buf); } catch { /* 아래로 */ }
  try { return inflateRawSync(buf); } catch { /* 아래로 */ }
  // 앞머리에 쓰레기가 붙은 것들 — zlib 머리(0x78)를 찾아 다시.
  for (let i = 1; i < Math.min(buf.length, 32); i += 1) {
    if (buf[i] === 0x78) {
      try { return inflateSync(buf.subarray(i)); } catch { /* 다음 */ }
    }
  }
  /*
   * 끝이 잘린 흐름은 통째로 버리지 않는다.
   *
   * 마지막 쪽이 잘린 PDF 가 실제로 있다. 여기서 빈 것을 돌려주면 그 쪽이
   * 「글 없는 쪽」이 되어 스캔본과 구분이 안 된다. 부풀린 데까지는 건진다.
   */
  try {
    return inflateSync(buf, { finishFlush: Z_SYNC_FLUSH });
  } catch { /* 아래로 */ }
  try {
    return inflateRawSync(buf, { finishFlush: Z_SYNC_FLUSH });
  } catch { return null; }
}

/** 못 푸는 걸개를 만나면 이름을 돌려준다 — 「왜 안 읽혔나」에 그대로 쓴다. */
export function 흐름풀기(흐름, 풀기) {
  if (!흐름?.날것) return { ok: false, 왜: '흐름이 아닙니다' };
  const 사전 = 흐름.사전 ?? {};
  let 자료 = 흐름.날것;
  const 걸개들 = [].concat(풀기(사전.Filter) ?? []).map((f) => 풀기(f)).filter(Boolean);
  const 맞춤들 = [].concat(풀기(사전.DecodeParms) ?? 풀기(사전.DP) ?? []);

  for (let i = 0; i < 걸개들.length; i += 1) {
    const 이름 = 걸개들[i]?.이름;
    const 맞춤 = 풀기(맞춤들[i]) ?? (걸개들.length === 1 ? 풀기(맞춤들[0]) : null) ?? {};
    if (이름 === 'FlateDecode' || 이름 === 'Fl') {
      const 푼것 = 부풀리기(자료);
      if (!푼것) return { ok: false, 왜: '압축을 못 풀었습니다' };
      자료 = 푼것;
    } else if (이름 === 'ASCII85Decode' || 이름 === 'A85') 자료 = 아스키85풀기(자료);
    else if (이름 === 'ASCIIHexDecode' || 이름 === 'AHx') 자료 = 아스키16풀기(자료);
    else if (이름 === 'RunLengthDecode' || 이름 === 'RL') 자료 = 되풀이풀기(자료);
    else if (이름) {
      // LZWDecode · DCTDecode(JPEG) · JPXDecode · CCITTFaxDecode …
      // 그림 걸개이거나 아주 옛 압축이다. 지어내지 말고 이름을 그대로 돌려준다.
      return { ok: false, 왜: `${이름} 은 못 푸는 압축입니다`, 걸개: 이름 };
    }
    const 예측 = 풀기(맞춤?.Predictor);
    if (예측 && 예측 > 1) {
      자료 = 예측되돌리기(자료, {
        예측,
        칸수: 풀기(맞춤.Columns) ?? 1,
        색수: 풀기(맞춤.Colors) ?? 1,
        비트: 풀기(맞춤.BitsPerComponent) ?? 8,
      });
    }
  }
  return { ok: true, 자료 };
}

/* ────────────────────────────────────────────────────────────────────────
 * 4. 문서 — 객체를 어디서 찾나
 *
 * 세 갈래를 다 쓴다.
 *   ① 파일을 통째로 훑어 `N G obj` 자리를 적어 둔다.
 *   ② xref(표든 흐름이든)를 읽어 덮어쓴다.
 *   ③ 객체 흐름(ObjStm) 안에 든 것을 펼친다.
 *
 * ①을 늘 해 두는 것이 요령이다. 현장의 PDF 는 xref 가 틀린 것이 아주 흔한데
 * (덧붙여 저장하다 어긋난다), 그때 xref 만 믿으면 멀쩡한 문서를 「못 읽음」
 * 으로 돌려주게 된다. 사람은 파일이 깨진 줄 안다.
 * ──────────────────────────────────────────────────────────────────────── */

class 문서 {
  constructor(buf) {
    this.b = buf;
    this.자리 = new Map();          // 객체번호 → 파일 위치
    this.푼것 = new Map();          // 객체번호 → 읽어 둔 값
    this.묶음속 = new Map();        // 객체번호 → ObjStm 안에서 읽은 값
    this.trailer = {};
    this.훑기();
    this.xref읽기();
    this.묶음펼치기();
  }

  /** ① 파일 전체에서 `N G obj` 를 찾는다. 뒤에 나온 것이 이긴다(덧붙여 저장). */
  훑기() {
    const s = this.b.toString('latin1');
    const 무늬 = /(?:^|[\s>\]])(\d+)\s+(\d+)\s+obj\b/g;
    let m;
    while ((m = 무늬.exec(s)) !== null) {
      const 자리 = m.index + m[0].length - `${m[1]} ${m[2]} obj`.length;
      this.자리.set(Number(m[1]), 자리);
    }
  }

  /** ② xref 를 따라가며 trailer 를 모은다. */
  xref읽기() {
    const s = this.b.toString('latin1');
    const 끝 = s.lastIndexOf('startxref');
    let 자리 = 끝 >= 0 ? Number((s.slice(끝 + 9, 끝 + 40).match(/\d+/) ?? [])[0]) : NaN;
    const 봤다 = new Set();
    let 걸음 = 0;
    while (Number.isInteger(자리) && 자리 >= 0 && 자리 < this.b.length && !봤다.has(자리) && 걸음 < 64) {
      봤다.add(자리); 걸음 += 1;
      const t = this.xref한칸(자리);
      if (!t) break;
      // 먼저 만난 것이 최신이다 — 이미 있는 열쇠는 안 덮는다.
      for (const [k, v] of Object.entries(t)) if (!(k in this.trailer)) this.trailer[k] = v;
      const 다음 = typeof t.Prev === 'number' ? t.Prev : null;
      // 혼합 파일(XRefStm)은 표와 흐름이 같이 있다.
      if (typeof t.XRefStm === 'number' && !봤다.has(t.XRefStm)) this.xref한칸(t.XRefStm);
      자리 = 다음;
    }
    if (!this.trailer.Root) {
      // trailer 를 못 찾았으면 카탈로그를 직접 찾는다.
      const m = /(\d+)\s+\d+\s+obj\s*<<[^>]{0,400}?\/Type\s*\/Catalog/.exec(this.b.toString('latin1'));
      if (m) this.trailer.Root = { 참조: Number(m[1]), 세대: 0 };
    }
  }

  /** xref 한 칸 — 고전 표이거나 흐름이다. trailer 사전을 돌려준다. */
  xref한칸(자리) {
    const 앞 = 건너뛰기(this.b, 자리);
    if (this.b.toString('latin1', 앞, 앞 + 4) === 'xref') {
      // 고전 표: 자리만 적는다(우리는 훑기로 이미 알지만, 여기가 더 정확하다).
      let i = 앞 + 4;
      for (;;) {
        i = 건너뛰기(this.b, i);
        if (this.b.toString('latin1', i, i + 7) === 'trailer') {
          const [t] = 값읽기(this.b, i + 7, (x) => this.풀기(x));
          return t && typeof t === 'object' ? t : {};
        }
        const m = /^(\d+)\s+(\d+)/.exec(this.b.toString('latin1', i, i + 40));
        if (!m) return {};
        let 번호 = Number(m[1]);
        const 수 = Number(m[2]);
        i = 건너뛰기(this.b, i + m[0].length);
        for (let k = 0; k < 수; k += 1) {
          const 줄 = this.b.toString('latin1', i, i + 20);
          const mm = /^(\d{10})\s(\d{5})\s([nf])/.exec(줄);
          if (mm && mm[3] === 'n') {
            const off = Number(mm[1]);
            // 훑기가 찾은 자리를 못 믿을 때만 xref 를 쓴다. 둘 다 있으면
            // 그 자리에 진짜 `N obj` 가 있는 쪽을 고른다.
            if (this.진짜객체인가(off, 번호)) this.자리.set(번호, off);
            else if (!this.자리.has(번호)) this.자리.set(번호, off);
          }
          번호 += 1;
          i += 20;
          // 줄이 19자인 파일도 있다. 다음 줄 머리를 보고 맞춘다.
          while (i < this.b.length && 공백인가(this.b[i]) && !/\d/.test(String.fromCharCode(this.b[i]))) {
            if (this.b[i] === 0x0a || this.b[i] === 0x0d || this.b[i] === 0x20) break;
            i += 1;
          }
        }
      }
    }

    // xref 흐름
    const [값] = 값읽기(this.b, 앞, (x) => this.풀기(x));
    const 흐름 = 값?.날것 ? 값 : null;
    if (!흐름) {
      // `N G obj` 로 시작하는 자리일 수도 있다.
      const m = /^\s*\d+\s+\d+\s+obj/.exec(this.b.toString('latin1', 앞, 앞 + 40));
      if (!m) return null;
      const [값2] = 값읽기(this.b, 앞 + m[0].length, (x) => this.풀기(x));
      if (!값2?.날것) return null;
      return this.xref흐름읽기(값2);
    }
    return this.xref흐름읽기(흐름);
  }

  xref흐름읽기(흐름) {
    const 사전 = 흐름.사전 ?? {};
    if (사전.Type?.이름 !== 'XRef' && !사전.W) return 사전;
    const r = 흐름풀기(흐름, (x) => this.풀기(x));
    if (!r.ok) return 사전;
    const W = (this.풀기(사전.W) ?? []).map((x) => this.풀기(x) ?? 0);
    if (W.length < 3) return 사전;
    const 크기 = this.풀기(사전.Size) ?? 0;
    const 색인 = this.풀기(사전.Index) ?? [0, 크기];
    const 한줄 = W.reduce((a, x) => a + x, 0);
    let p = 0;
    for (let g = 0; g + 1 < 색인.length; g += 2) {
      let 번호 = this.풀기(색인[g]);
      const 수 = this.풀기(색인[g + 1]);
      for (let k = 0; k < 수 && p + 한줄 <= r.자료.length; k += 1) {
        const 밭 = [];
        for (const w of W) {
          let v = 0;
          for (let q = 0; q < w; q += 1) { v = v * 256 + r.자료[p]; p += 1; }
          밭.push(w === 0 ? null : v);
        }
        const 갈래 = 밭[0] === null ? 1 : 밭[0];
        if (갈래 === 1 && this.진짜객체인가(밭[1], 번호)) this.자리.set(번호, 밭[1]);
        else if (갈래 === 1 && !this.자리.has(번호)) this.자리.set(번호, 밭[1]);
        else if (갈래 === 2) this.묶음자리 = this.묶음자리 ?? new Map(), this.묶음자리.set(번호, 밭[1]);
        번호 += 1;
      }
    }
    return 사전;
  }

  /** 이 자리에 정말 `번호 G obj` 가 있나. xref 가 틀린 파일을 가려낸다. */
  진짜객체인가(자리, 번호) {
    if (!Number.isInteger(자리) || 자리 < 0 || 자리 >= this.b.length) return false;
    const 앞 = 건너뛰기(this.b, 자리);
    const m = /^(\d+)\s+\d+\s+obj/.exec(this.b.toString('latin1', 앞, 앞 + 40));
    return !!m && Number(m[1]) === 번호;
  }

  /** ③ 객체 흐름을 펼친다. 여기 든 객체는 파일에 낱개로 없다. */
  묶음펼치기() {
    const 볼것 = new Set(this.묶음자리 ? [...this.묶음자리.values()] : []);
    // 훑기로 찾은 것 중 ObjStm 도 마저 본다 (xref 가 없거나 틀린 파일).
    for (const [번호] of this.자리) {
      const v = this.낱개읽기(번호);
      if (v?.사전?.Type?.이름 === 'ObjStm') 볼것.add(번호);
    }
    for (const 번호 of 볼것) {
      const 흐름 = this.낱개읽기(번호);
      if (!흐름?.날것) continue;
      const r = 흐름풀기(흐름, (x) => this.풀기(x));
      if (!r.ok) continue;
      const N = this.풀기(흐름.사전.N) ?? 0;
      const 첫 = this.풀기(흐름.사전.First) ?? 0;
      const 머리 = r.자료.toString('latin1', 0, 첫);
      const 수들 = (머리.match(/\d+/g) ?? []).map(Number);
      for (let k = 0; k < N; k += 1) {
        const 객체번호 = 수들[k * 2];
        const 안자리 = 수들[k * 2 + 1];
        if (!Number.isInteger(객체번호) || !Number.isInteger(안자리)) continue;
        if (this.묶음속.has(객체번호)) continue;
        const [값] = 값읽기(r.자료, 첫 + 안자리, (x) => this.풀기(x));
        this.묶음속.set(객체번호, 값);
      }
    }
  }

  /** 파일에서 낱개 객체를 읽는다. */
  낱개읽기(번호) {
    if (this.푼것.has(번호)) return this.푼것.get(번호);
    const 자리 = this.자리.get(번호);
    if (!Number.isInteger(자리)) return null;
    const 앞 = 건너뛰기(this.b, 자리);
    const m = /^\d+\s+\d+\s+obj/.exec(this.b.toString('latin1', 앞, 앞 + 40));
    if (!m) return null;
    this.푼것.set(번호, null);                    // 되돌이 참조 막기
    const [값] = 값읽기(this.b, 앞 + m[0].length, (x) => this.풀기(x));
    this.푼것.set(번호, 값);
    return 값;
  }

  /** 참조면 따라가서 값을 준다. 참조가 아니면 그대로. */
  풀기(v, 깊이 = 0) {
    if (깊이 > 32) return null;
    if (v && typeof v === 'object' && Number.isInteger(v.참조)) {
      const n = v.참조;
      const 안것 = this.묶음속.has(n) ? this.묶음속.get(n) : this.낱개읽기(n);
      return this.풀기(안것, 깊이 + 1);
    }
    return v;
  }

  /** 사전에서 열쇠 하나를 풀어서. */
  꺼내기(사전, 열쇠) {
    const d = this.풀기(사전);
    if (!d || typeof d !== 'object') return null;
    const 안 = d.사전 ?? d;
    return this.풀기(안?.[열쇠]);
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * 5. 쪽 나무
 * ──────────────────────────────────────────────────────────────────────── */

/** 물려받는 것들 — 쪽에 없으면 부모에서 가져온다(규격이 그렇다). */
const 물림 = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

function 쪽모으기(문, 마디, 물린것, 나온것, 본것, 깊이 = 0) {
  const d = 문.풀기(마디);
  if (!d || typeof d !== 'object' || 깊이 > 64 || 나온것.length > 5000) return;
  const 안 = d.사전 ?? d;
  const 이번물림 = { ...물린것 };
  for (const k of 물림) if (안[k] !== undefined) 이번물림[k] = 안[k];

  const 갈래 = 문.풀기(안.Type)?.이름;
  const 아이들 = 문.풀기(안.Kids);

  if (갈래 === 'Page' || (!아이들 && 안.Contents !== undefined)) {
    나온것.push({ 사전: 안, 물림: 이번물림 });
    return;
  }
  if (Array.isArray(아이들)) {
    for (const k of 아이들) {
      const 열쇠 = Number.isInteger(k?.참조) ? k.참조 : null;
      if (열쇠 !== null) { if (본것.has(열쇠)) continue; 본것.add(열쇠); }
      쪽모으기(문, k, 이번물림, 나온것, 본것, 깊이 + 1);
    }
  }
}

/** 쪽 나무가 깨졌을 때 — 파일에 있는 /Type /Page 를 번호 순으로 줍는다. */
function 쪽줍기(문) {
  const 나온것 = [];
  const 번호들 = [...문.자리.keys()].sort((a, b) => a - b);
  const 다 = new Set([...번호들, ...문.묶음속.keys()]);
  for (const n of [...다].sort((a, b) => a - b)) {
    const v = 문.묶음속.has(n) ? 문.묶음속.get(n) : 문.낱개읽기(n);
    const 안 = v?.사전 ?? v;
    if (안 && typeof 안 === 'object' && !Array.isArray(안) && 문.풀기(안.Type)?.이름 === 'Page') {
      나온것.push({ 사전: 안, 물림: {} });
    }
  }
  return 나온것;
}

/* ────────────────────────────────────────────────────────────────────────
 * 6. 글꼴 — 글리프 번호를 글자로
 * ──────────────────────────────────────────────────────────────────────── */

/* WinAnsi 가 Latin-1 과 다른 자리(0x80~0x9f)만 적는다. 나머지는 같다. */
const 윈안시특별 = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
  0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

/** 글리프 이름 → 글자. 흔한 것만 — 없으면 없다고 한다. */
const 이름글자 = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%',
  ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')', asterisk: '*',
  plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/', zero: '0', one: '1',
  two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8',
  nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>',
  question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']',
  asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|',
  braceright: '}', asciitilde: '~', quoteleft: '‘', quoteright: '’',
  quotedblleft: '“', quotedblright: '”', endash: '–', emdash: '—', bullet: '•',
  ellipsis: '…', fi: 'ﬁ', fl: 'ﬂ', nbspace: ' ', won: '₩', Euro: '€',
};

function 글리프이름글자(이름) {
  if (!이름) return null;
  if (이름글자[이름]) return 이름글자[이름];
  let m = /^uni([0-9A-Fa-f]{4,6})$/.exec(이름);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(이름);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  if (/^[A-Za-z]$/.test(이름)) return 이름;
  m = /^(?:g|cid|G|index)(\d+)$/.exec(이름);
  if (m) return null;                            // 번호 이름은 글자를 못 안다
  return null;
}

/** `<0041>` 같은 16진수 뭉치를 코드 값으로. */
function 열여섯값(글) {
  const s = String(글 ?? '').replace(/[^0-9A-Fa-f]/g, '');
  return s ? parseInt(s, 16) : null;
}

/** `<0041>` 을 유니코드 글자로 (UTF-16BE 여러 글자일 수 있다). */
function 열여섯글자(글) {
  const s = String(글 ?? '').replace(/[^0-9A-Fa-f]/g, '');
  if (!s) return '';
  const 짝 = s.length % 4 ? s.padEnd(Math.ceil(s.length / 4) * 4, '0') : s;
  let 나온것 = '';
  for (let i = 0; i < 짝.length; i += 4) 나온것 += String.fromCharCode(parseInt(짝.slice(i, i + 4), 16));
  return 나온것;
}

/**
 * /ToUnicode CMap 을 읽는다.
 *
 * 이 표가 한글 PDF 의 전부다. 없으면 Identity-H 문서는 한 글자도 못 읽는다.
 */
export function 유니코드표읽기(글) {
  const 표 = new Map();
  const 코드폭 = new Set();
  const s = String(글 ?? '');

  for (const m of s.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const p of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      코드폭.add(Math.ceil(p[1].length / 2));
    }
  }
  for (const m of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\/(\S+))/g)) {
      const 코드 = 열여섯값(p[1]);
      if (코드 === null) continue;
      코드폭.add(Math.ceil(p[1].length / 2));
      표.set(코드, p[2] !== undefined ? 열여섯글자(p[2]) : (글리프이름글자(p[3]) ?? ''));
    }
  }
  for (const m of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const 몸 = m[1];
    // `<시작> <끝> [<a> <b> …]` 꼴
    for (const p of 몸.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
      const 시작 = 열여섯값(p[1]);
      코드폭.add(Math.ceil(p[1].length / 2));
      const 것들 = [...p[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => 열여섯글자(x[1]));
      것들.forEach((글자, k) => 표.set(시작 + k, 글자));
    }
    // `<시작> <끝> <첫글자>` 꼴
    for (const p of 몸.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const 시작 = 열여섯값(p[1]);
      const 끝 = 열여섯값(p[2]);
      const 첫 = 열여섯글자(p[3]);
      코드폭.add(Math.ceil(p[1].length / 2));
      if (시작 === null || 끝 === null || 끝 < 시작 || 끝 - 시작 > 65535) continue;
      const 밑 = 첫.charCodeAt(첫.length - 1);
      for (let k = 0; k <= 끝 - 시작; k += 1) {
        if (표.has(시작 + k)) continue;
        표.set(시작 + k, 첫.slice(0, -1) + String.fromCharCode(밑 + k));
      }
    }
  }
  return { 표, 폭: 코드폭.has(2) ? 2 : (코드폭.has(1) ? 1 : 0) };
}

/**
 * 글꼴에 적힌 글자 너비를 읽는다 (1/1000 em → em).
 *
 * 한 바이트 글꼴은 `/FirstChar` 부터 `/Widths` 배열이 죽 이어진다.
 * CID 글꼴은 `/W` 가 두 꼴을 섞어 쓴다 — `c [w …]` 와 `c1 c2 w`.
 * 못 찾은 코드는 `/MissingWidth` 나 `/DW`(기본 1000)로 간다.
 */
function 너비표읽기(문, 안, 두바이트) {
  const 표 = new Map();
  let 기본 = null;

  if (두바이트) {
    const 딸린것 = 문.풀기(안.DescendantFonts);
    const 속 = 문.풀기(Array.isArray(딸린것) ? 딸린것[0] : 딸린것);
    const 속안 = 속?.사전 ?? 속;
    if (속안 && typeof 속안 === 'object') {
      const dw = 문.풀기(속안.DW);
      기본 = (typeof dw === 'number' ? dw : 1000) / 1000;
      const W = 문.풀기(속안.W);
      if (Array.isArray(W)) {
        let i = 0;
        while (i < W.length) {
          const 첫 = 문.풀기(W[i]);
          const 둘째 = 문.풀기(W[i + 1]);
          if (Array.isArray(둘째)) {
            둘째.forEach((w, k) => {
              const v = 문.풀기(w);
              if (typeof v === 'number') 표.set(첫 + k, v / 1000);
            });
            i += 2;
          } else if (typeof 첫 === 'number' && typeof 둘째 === 'number') {
            const w = 문.풀기(W[i + 2]);
            if (typeof w === 'number' && 둘째 >= 첫 && 둘째 - 첫 <= 65535) {
              for (let c = 첫; c <= 둘째; c += 1) 표.set(c, w / 1000);
            }
            i += 3;
          } else i += 1;
        }
      }
    }
    return { 표, 기본: 기본 ?? 1 };
  }

  const 첫코드 = 문.풀기(안.FirstChar);
  const 너비들 = 문.풀기(안.Widths);
  if (Array.isArray(너비들) && Number.isInteger(첫코드)) {
    너비들.forEach((w, k) => {
      const v = 문.풀기(w);
      if (typeof v === 'number') 표.set(첫코드 + k, v / 1000);
    });
  }
  const 서술 = 문.풀기(안.FontDescriptor);
  const 없을때 = 문.풀기((서술?.사전 ?? 서술)?.MissingWidth);
  if (typeof 없을때 === 'number') 기본 = 없을때 / 1000;
  return { 표, 기본 };
}

/**
 * 글꼴 하나를 「바이트 → 글자」 로 바꿔 주는 물건으로 만든다.
 *
 * 못 읽는 글꼴이면 `읽나: false` 를 단다 — 그 쪽이 왜 안 읽혔는지 말하려고.
 */
function 글꼴만들기(문, 글꼴사전) {
  const d = 문.풀기(글꼴사전);
  const 안 = d?.사전 ?? d;
  if (!안 || typeof 안 !== 'object') return { 폭: 1, 표: new Map(), 읽나: true, 기본: true, 너비: { 표: new Map(), 기본: null } };

  const 갈래 = 문.풀기(안.Subtype)?.이름;
  const 인코딩값 = 문.풀기(안.Encoding);
  const 인코딩이름 = 인코딩값?.이름 ?? 문.풀기(인코딩값?.BaseEncoding)?.이름 ?? null;
  const 두바이트 = 갈래 === 'Type0';
  const 너비 = 너비표읽기(문, 안, 두바이트);

  // ① /ToUnicode 가 있으면 그것이 가장 정확하다.
  let 표 = new Map();
  let 폭 = 두바이트 ? 2 : 1;
  const 투 = 문.풀기(안.ToUnicode);
  if (투?.날것) {
    const r = 흐름풀기(투, (x) => 문.풀기(x));
    if (r.ok) {
      const 읽은것 = 유니코드표읽기(r.자료.toString('latin1'));
      표 = 읽은것.표;
      if (읽은것.폭) 폭 = 읽은것.폭;
      if (표.size) return { 폭, 표, 읽나: true, 너비 };
    }
  }

  // ② 두 바이트인데 표가 없으면 — 글리프 번호만 있다. 못 읽는다.
  if (두바이트) {
    return {
      폭: 2,
      표: new Map(),
      읽나: false,
      너비,
      왜: `글꼴 ${문.풀기(안.BaseFont)?.이름 ?? '(이름 없음)'} 에 /ToUnicode 표가 없습니다`,
    };
  }

  // ③ 한 바이트 글꼴 — 인코딩과 Differences 로 만든다.
  const 낱개 = new Map();
  const 기본으로 = (코드) => {
    if (인코딩이름 === 'WinAnsiEncoding' && 윈안시특별[코드]) return 윈안시특별[코드];
    if (코드 >= 0x20 && 코드 < 0x7f) return String.fromCharCode(코드);
    if (코드 >= 0xa0) return String.fromCharCode(코드);      // Latin-1 자리
    return null;
  };
  for (let c = 0; c < 256; c += 1) {
    const g = 기본으로(c);
    if (g !== null) 낱개.set(c, g);
  }
  const 다름 = 문.풀기(인코딩값?.Differences);
  if (Array.isArray(다름)) {
    let 지금 = 0;
    for (const x of 다름) {
      const v = 문.풀기(x);
      if (typeof v === 'number') { 지금 = v; continue; }
      if (v?.이름) {
        const g = 글리프이름글자(v.이름);
        if (g) 낱개.set(지금, g); else 낱개.delete(지금);
        지금 += 1;
      }
    }
  }
  return { 폭: 1, 표: 낱개, 읽나: true, 기본: true, 너비 };
}

/**
 * 바이트 뭉치를 이 글꼴로 읽는다.
 *
 * 못 읽은 코드 수와, 붓이 나아간 거리(em 단위)도 같이 낸다. 거리는 글꼴에
 * 적힌 진짜 너비를 쓰고, 없는 코드만 어림으로 메운다.
 */
function 글자로(글꼴, 바이트들) {
  const 폭 = 글꼴?.폭 === 2 ? 2 : 1;
  const 너비표 = 글꼴?.너비?.표;
  const 너비기본 = 글꼴?.너비?.기본 ?? null;
  let 글 = '';
  let 못읽음 = 0;
  let 나아감 = 0;
  for (let i = 0; i + 폭 <= 바이트들.length + (폭 - 1); i += 폭) {
    const 코드 = 폭 === 2
      ? ((바이트들[i] << 8) | (바이트들[i + 1] ?? 0))
      : 바이트들[i];
    if (코드 === undefined) break;
    const g = 글꼴?.표?.get(코드);
    let 찍은것 = null;
    if (g !== undefined && g !== null && g !== '') { 글 += g; 찍은것 = g; }
    else if (폭 === 1 && 코드 >= 0x20 && 코드 < 0x7f) { 글 += String.fromCharCode(코드); 찍은것 = String.fromCharCode(코드); }
    else 못읽음 += 1;

    const 적힌것 = 너비표?.get(코드);
    if (typeof 적힌것 === 'number') 나아감 += 적힌것;
    else if (typeof 너비기본 === 'number') 나아감 += 너비기본;
    else 나아감 += 찍은것 ? 글자너비비율(찍은것) : 넓은글자;
  }
  return { 글, 못읽음, 나아감 };
}

/* ────────────────────────────────────────────────────────────────────────
 * 7. 내용 흐름에서 글 뽑기
 * ──────────────────────────────────────────────────────────────────────── */

/** 줄이 바뀌었다고 볼 세로 이동(글꼴 크기와 무관한 어림값). */
const 줄바뀜 = 3.5;
/** TJ 안의 이만큼 넘는 음수 이동은 낱말 사이 빈칸으로 본다(1/1000 em). */
const 빈칸이동 = 180;
/** 글자 하나가 나아간 거리를 글꼴 크기의 몇 배로 볼까. */
const 넓은글자 = 1.0;      // 한중일 — 네모 한 칸
const 좁은글자 = 0.5;      // 그 밖 — 어림값

/**
 * 글꼴이 너비를 안 알려줄 때 쓰는 어림값 (글꼴 크기의 배수).
 *
 * 어림은 마지막 수단이다. 처음엔 이것만 썼는데 「jumps」가 「jum ps」로
 * 나왔다 — m 은 0.83em 인데 0.5 로 쳤더니 남는 거리가 빈칸처럼 보였다.
 * 그래서 글꼴에 적힌 진짜 너비(/Widths · /W)를 먼저 읽고, 없을 때만 여기로 온다.
 */
function 글자너비비율(글자) {
  const c = 글자.codePointAt(0) ?? 0;
  if ((c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0x9fff)
    || (c >= 0xa960 && c <= 0xa97f) || (c >= 0xac00 && c <= 0xd7ff)
    || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60)) return 넓은글자;
  return 좁은글자;
}

function 곱하기(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/**
 * 내용 흐름 하나에서 글을 뽑는다.
 *
 * 자리(행렬)를 따라가며 세로로 움직이면 줄을 바꾼다. 정확한 조판을 흉내내는
 * 것이 아니라 **읽을 수 있는 줄**을 만드는 것이 목적이다.
 */
function 흐름에서글(문, 자료, 자원, 깊이 = 0) {
  const b = 자료;
  const 줄들 = [];
  let 이번줄 = '';
  let 앞y = null;
  let 앞x = null;
  let 펜x = null;   // 붓이 지금 어디까지 갔다고 보는가 (자리바뀜 참고)
  let 못읽은코드 = 0;
  let 글낸적 = false;
  const 글꼴통 = new Map();

  let Tm = [1, 0, 0, 1, 0, 0];
  let Tlm = [1, 0, 0, 1, 0, 0];
  let TL = 0;
  let 지금글꼴 = null;
  let 글꼴크기 = 0;

  const 쌓임 = [];
  let i = 0;

  const 줄맺기 = () => {
    const t = 이번줄.replace(/[ \t]+$/, '');
    if (t.trim()) 줄들.push(t);
    이번줄 = '';
  };

  /*
   * 자리가 바뀌었다 — 줄을 바꿀까, 빈칸을 넣을까, 그냥 이어 쓸까.
   *
   * 여기서 조심할 것이 하나 있다. 크롬 같은 프로그램은 **글자 하나마다**
   * `Td` 로 옮기고 `Tj` 로 찍는다. 그래서 가로로 움직였다는 것만 보고 빈칸을
   * 넣으면 「결제」가 「결 제」가 된다 — 글자 사이마다 빈칸이 박힌다.
   *
   * 그 움직임은 대개 **방금 찍은 글자의 너비**다. 그래서 찍은 만큼 붓이
   * 나아갔다고 치고(펜x), 그보다 더 벌어졌을 때만 빈칸으로 본다.
   */
  const 자리바뀜 = () => {
    const x = Tm[4]; const y = Tm[5];
    if (앞y !== null && Math.abs(y - 앞y) > 줄바뀜) {
      줄맺기();
    } else if (펜x !== null && 이번줄 && !/\s$/.test(이번줄)) {
      const 틈 = x - 펜x;
      if (틈 > 0.25 * 글꼴크기 * Math.abs(Tm[0] || 1)) 이번줄 += ' ';
    }
    앞y = y; 앞x = x; 펜x = x;
  };

  const 글쓰기 = (바이트들) => {
    const r = 글자로(지금글꼴, 바이트들);
    못읽은코드 += r.못읽음;
    if (r.글) { 이번줄 += r.글; 글낸적 = true; }
    else if (r.못읽음) 글낸적 = true;            // 글을 그리기는 했다 — 못 읽었을 뿐
    // 찍은 만큼 붓을 밀어 둔다. 다음 이동이 「글자 너비」인지 「진짜 틈」인지
    // 가르는 잣대가 이것뿐이다.
    if (펜x !== null) 펜x += r.나아감 * 글꼴크기 * Math.abs(Tm[0] || 1);
  };

  while (i < b.length) {
    i = 건너뛰기(b, i);
    if (i >= b.length) break;

    // 붙박이 그림은 통째로 건너뛴다. 안 그러면 그림 자료를 낱말로 읽는다.
    if (b[i] === 0x42 && b[i + 1] === 0x49 && 끝인가(b[i + 2])) {   // 'BI'
      const 끝 = b.indexOf('EI', i, 'latin1');
      i = 끝 < 0 ? b.length : 끝 + 2;
      글낸적 = 글낸적 || false;
      continue;
    }

    const [값, 다음] = 값읽기(b, i, null);
    if (다음 <= i) { i += 1; continue; }
    i = 다음;

    if (!값 || typeof 값 !== 'object' || !값.연산자) { 쌓임.push(값); if (쌓임.length > 64) 쌓임.shift(); continue; }

    const op = 값.연산자;
    const 인자 = 쌓임.slice();
    쌓임.length = 0;

    switch (op) {
      case 'BT': Tm = [1, 0, 0, 1, 0, 0]; Tlm = Tm.slice(); 앞y = null; 앞x = null; break;
      case 'ET': 줄맺기(); break;
      case 'TL': TL = Number(인자[0]) || 0; break;
      case 'Td': {
        const tx = Number(인자[0]) || 0; const ty = Number(인자[1]) || 0;
        Tlm = 곱하기([1, 0, 0, 1, tx, ty], Tlm); Tm = Tlm.slice(); 자리바뀜(); break;
      }
      case 'TD': {
        const tx = Number(인자[0]) || 0; const ty = Number(인자[1]) || 0;
        TL = -ty;
        Tlm = 곱하기([1, 0, 0, 1, tx, ty], Tlm); Tm = Tlm.slice(); 자리바뀜(); break;
      }
      case 'Tm': {
        const n = 인자.slice(0, 6).map((x) => Number(x) || 0);
        if (n.length === 6) { Tlm = n; Tm = n.slice(); 자리바뀜(); }
        break;
      }
      case 'T*': {
        Tlm = 곱하기([1, 0, 0, 1, 0, -TL], Tlm); Tm = Tlm.slice(); 자리바뀜(); break;
      }
      case 'Tf': {
        글꼴크기 = Number(인자[1]) || 0;
        const 이름 = 인자[0]?.이름;
        if (이름) {
          if (!글꼴통.has(이름)) {
            const 글꼴들 = 문.꺼내기(자원, 'Font');
            글꼴통.set(이름, 글꼴만들기(문, (글꼴들?.사전 ?? 글꼴들)?.[이름]));
          }
          지금글꼴 = 글꼴통.get(이름);
        }
        break;
      }
      case 'Tj': case 'TJ': case "'": case '"': {
        if (op === "'" || op === '"') { Tlm = 곱하기([1, 0, 0, 1, 0, -TL], Tlm); Tm = Tlm.slice(); 자리바뀜(); }
        const 몫 = op === '"' ? 인자[2] : 인자[인자.length - 1];
        if (op === 'TJ') {
          const 배열 = Array.isArray(몫) ? 몫 : [];
          for (const x of 배열) {
            if (typeof x === 'number') {
              if (-x > 빈칸이동 && 이번줄 && !/\s$/.test(이번줄)) 이번줄 += ' ';
            } else if (x?.바이트) 글쓰기(x.바이트);
          }
        } else if (몫?.바이트) 글쓰기(몫.바이트);
        break;
      }
      case 'Do': {
        // 폼 XObject 안에도 글이 있다 (머리말·표·도장). 깊이는 막아 둔다.
        if (깊이 >= 4) break;
        const 이름 = 인자[0]?.이름;
        if (!이름) break;
        const 것들 = 문.꺼내기(자원, 'XObject');
        const 하나 = 문.풀기((것들?.사전 ?? 것들)?.[이름]);
        if (!하나?.날것) break;
        if (문.풀기(하나.사전?.Subtype)?.이름 !== 'Form') break;
        const r = 흐름풀기(하나, (x) => 문.풀기(x));
        if (!r.ok) break;
        const 속자원 = 문.풀기(하나.사전?.Resources) ?? 자원;
        const 안것 = 흐름에서글(문, r.자료, 속자원, 깊이 + 1);
        줄맺기();
        줄들.push(...안것.줄들);
        못읽은코드 += 안것.못읽은코드;
        글낸적 = 글낸적 || 안것.글낸적;
        break;
      }
      default: break;
    }
  }
  줄맺기();
  return { 줄들, 못읽은코드, 글낸적 };
}

/* ────────────────────────────────────────────────────────────────────────
 * 8. 바깥으로
 * ──────────────────────────────────────────────────────────────────────── */

/** 이 길로 읽는 파일인가. */
export function isPdfPath(p) {
  return typeof p === 'string' && extname(p).toLowerCase() === '.pdf';
}

/** 속이 정말 PDF 인가 (머리 1KB 안에 %PDF- 가 있다). */
export function looksPdf(buf) {
  if (!buf || buf.length < 5) return false;
  return buf.toString('latin1', 0, Math.min(1024, buf.length)).includes('%PDF-');
}

/**
 * PDF 를 쪽마다 글로 읽는다.
 *
 * @returns {{ok:true, 갈래:'pdf', 쪽수:number, 덩이들:Array<{이름,문단들}>,
 *            못읽은쪽:Array<{번호,왜}>, 판:string}
 *          | {ok:false, error:string}}
 */
export function readPdf(경로또는버퍼) {
  let buf;
  try {
    buf = Buffer.isBuffer(경로또는버퍼) ? 경로또는버퍼 : readFileSync(경로또는버퍼);
  } catch (err) {
    return { ok: false, error: `못 읽었습니다: ${err.message}` };
  }
  if (!looksPdf(buf)) return { ok: false, error: 'PDF 가 아닙니다 (머리에 %PDF- 가 없습니다).' };

  let 문;
  try { 문 = new 문서(buf); } catch (err) {
    return { ok: false, error: `PDF 를 여는 데 실패했습니다: ${err.message}` };
  }

  /*
   * 암호가 걸렸으면 여기서 멈춘다.
   *
   * 흐름이 통째로 암호화돼 있어서, 그냥 읽으면 쓰레기가 나오거나 빈 글이
   * 나온다. 빈 글을 돌려주면 「내용이 없는 문서」로 읽히므로, 왜 못 읽는지와
   * 어떻게 하면 되는지를 준다.
   */
  if (문.trailer.Encrypt) {
    return {
      ok: false,
      error: '암호가 걸린 PDF 입니다 — 글을 꺼낼 수 없습니다.\n'
        + '  PDF 뷰어에서 열어 「다른 이름으로 저장」(또는 인쇄 → PDF)으로\n'
        + '  암호 없는 사본을 만든 뒤 그 파일을 주세요.',
    };
  }

  const 판 = (buf.toString('latin1', 0, 16).match(/%PDF-([\d.]+)/) ?? [])[1] ?? '?';

  // 쪽 모으기 — 나무를 먼저, 안 되면 주워서.
  const 뿌리 = 문.풀기(문.trailer.Root);
  const 쪽나무 = 문.꺼내기(뿌리?.사전 ?? 뿌리, 'Pages');
  let 쪽들 = [];
  if (쪽나무) 쪽모으기(문, 쪽나무, {}, 쪽들, new Set());
  if (!쪽들.length) 쪽들 = 쪽줍기(문);
  if (!쪽들.length) {
    return { ok: false, error: 'PDF 안에서 쪽을 못 찾았습니다 — 파일이 깨졌을 수 있습니다.' };
  }

  const 덩이들 = [];
  const 못읽은쪽 = [];

  쪽들.forEach((쪽, 순번) => {
    const 번호 = 순번 + 1;
    const 안 = 쪽.사전;
    const 자원 = 문.풀기(안.Resources ?? 쪽.물림.Resources);
    const 내용 = 문.풀기(안.Contents);
    const 조각들 = Array.isArray(내용) ? 내용 : (내용 ? [내용] : []);

    if (!조각들.length) {
      못읽은쪽.push({ 번호, 왜: '이 쪽에는 그릴 것이 아예 없습니다 (빈 쪽)' });
      덩이들.push({ 이름: `${번호}쪽`, 문단들: [] });
      return;
    }

    const 자료들 = [];
    let 막힌걸개 = null;
    for (const c of 조각들) {
      const 하나 = 문.풀기(c);
      if (!하나?.날것) continue;
      const r = 흐름풀기(하나, (x) => 문.풀기(x));
      if (!r.ok) { 막힌걸개 = 막힌걸개 ?? r.왜; continue; }
      자료들.push(r.자료);
      자료들.push(Buffer.from('\n'));
    }

    if (!자료들.length) {
      못읽은쪽.push({ 번호, 왜: 막힌걸개 ?? '내용 흐름을 못 풀었습니다' });
      덩이들.push({ 이름: `${번호}쪽`, 문단들: [] });
      return;
    }

    let 뽑은것;
    try { 뽑은것 = 흐름에서글(문, Buffer.concat(자료들), 자원); }
    catch (err) {
      못읽은쪽.push({ 번호, 왜: `내용을 읽다 막혔습니다: ${err.message}` });
      덩이들.push({ 이름: `${번호}쪽`, 문단들: [] });
      return;
    }

    const 글있나 = 뽑은것.줄들.some((l) => l.trim());
    if (!글있나) {
      /*
       * 글이 하나도 안 나온 쪽. 왜인지 갈라서 말한다 — 스캔본과 글꼴 문제는
       * 사람이 할 일이 다르다(전자는 OCR, 후자는 다시 뽑기).
       */
      const 그림있나 = /\/Subtype\s*\/Image|\bDo\b/.test(Buffer.concat(자료들).toString('latin1').slice(0, 20000))
        || !!문.꺼내기(자원, 'XObject');
      못읽은쪽.push({
        번호,
        왜: 뽑은것.못읽은코드
          ? '글꼴에 /ToUnicode 표가 없어 글자를 되돌릴 수 없습니다'
          : (그림있나 ? '글이 없는 쪽입니다 (스캔한 사진일 수 있습니다 — OCR 이 필요합니다)' : '글이 없는 쪽입니다'),
      });
      덩이들.push({ 이름: `${번호}쪽`, 문단들: [] });
      return;
    }

    if (뽑은것.못읽은코드 > 0) {
      못읽은쪽.push({
        번호,
        왜: `${뽑은것.못읽은코드}자를 못 되돌렸습니다 (글꼴 표에 없는 글리프) — 이 쪽은 일부만 읽었습니다`,
        일부: true,
      });
    }
    덩이들.push({ 이름: `${번호}쪽`, 문단들: 뽑은것.줄들 });
  });

  return { ok: true, 갈래: 'pdf', 판, 쪽수: 쪽들.length, 덩이들, 못읽은쪽 };
}

/**
 * 쪽들을 한 덩이 글로. 못 읽은 쪽은 **그 자리에** 적는다.
 *
 * 끝에 몰아서 적으면 모델이 3쪽 내용을 2쪽 것으로 잘못 쓴다. 자리에 적어야
 * 「여기가 비었다」가 글의 흐름으로 보인다.
 */
export function toText(r, { maxChars = 최대글자 } = {}) {
  const 잘림 = [];
  const 조각 = [];
  let 셈 = 0;
  const 왜표 = new Map((r.못읽은쪽 ?? []).map((x) => [x.번호, x]));

  for (const d of r.덩이들 ?? []) {
    const 번호 = Number((d.이름.match(/^(\d+)/) ?? [])[1]);
    조각.push(`--- ${d.이름} ---`);
    const 못 = 왜표.get(번호);
    if (못 && !못.일부) {
      조각.push(`[이 쪽은 글로 못 읽었습니다 — ${못.왜}]`);
      continue;
    }
    for (const 문단 of d.문단들) {
      if (셈 + 문단.length > maxChars) {
        잘림.push(`${maxChars.toLocaleString('en-US')}자에서 잘랐습니다 — 뒷부분은 안 실렸습니다`);
        return { text: 조각.join('\n'), 잘림 };
      }
      조각.push(문단);
      셈 += 문단.length + 1;
    }
    if (못?.일부) 조각.push(`[이 쪽은 일부만 읽었습니다 — ${못.왜}]`);
  }
  return { text: 조각.join('\n'), 잘림 };
}

/** 한 줄 요약. Read 의 summary 자리로 간다. */
export function summarize(r) {
  if (!r?.ok) return '';
  const 통째로못읽음 = (r.못읽은쪽 ?? []).filter((x) => !x.일부).length;
  const 뒤 = 통째로못읽음 ? ` · ${통째로못읽음}쪽 못 읽음` : '';
  return `pdf · ${r.쪽수}쪽${뒤}`;
}

/**
 * 못 읽은 쪽을 사람 말로 묶는다. 글 뒤에 붙인다.
 *
 * 여기가 이 파일에서 제일 중요한 자리다. 「3쪽 중 2쪽을 못 읽었다」가 안 보이면
 * 사람도 모델도 남은 한 쪽으로 문서 전체를 판단한다.
 */
export function 못읽은말(r) {
  const 것들 = r?.못읽은쪽 ?? [];
  if (!것들.length) return '';
  const 통째 = 것들.filter((x) => !x.일부);
  const 일부 = 것들.filter((x) => x.일부);
  const 줄 = [];
  if (통째.length) {
    const 쪽말 = 통째.map((x) => x.번호).join(' · ');
    줄.push(`${r.쪽수}쪽 중 ${통째.length}쪽을 글로 못 읽었습니다 (${쪽말}쪽).`);
    for (const 왜 of new Set(통째.map((x) => x.왜))) 줄.push(`  · ${왜}`);
    줄.push('  이 쪽들의 내용은 여기 없습니다 — 없는 것이 아니라 못 꺼낸 것입니다.');
  }
  if (일부.length) 줄.push(`${일부.length}쪽은 일부만 읽었습니다 (${일부.map((x) => x.번호).join(' · ')}쪽).`);
  return 줄.join('\n');
}

/** 고치려 들 때 하는 말. */
export function pdf는못고침(보인이름) {
  return `PDF 는 이 도구로 고칠 수 없습니다: ${보인이름}\n`
    + '  읽기만 됩니다 (쪽마다 글로 바꿔서 보여줍니다). PDF 는 「보이는 대로\n'
    + '  인쇄하기」 위한 형식이라, 글로 바꿨다가 되돌리면 조판이 통째로 사라집니다.\n'
    + `  내용을 바꿔야 한다면 ${basename(String(보인이름))} 은 그대로 두고, 바뀐 내용을\n`
    + '  새 파일에 쓰세요.';
}
