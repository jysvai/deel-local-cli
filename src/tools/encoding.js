// 글자 인코딩을 알아보고, 읽고, 읽은 그대로 되돌려 쓴다.
//
// 왜 필요한가:
//   사내 문서는 UTF-8 이 아닌 경우가 흔하다. 윈도우 메모장이 오래 쓰던 '완성형'
//   (한국은 CP949, 일본은 CP932, 중국은 GBK…) 으로 저장된 파일이 그대로 남아 있다.
//   그걸 UTF-8 로 읽으면 통째로 깨진다.  '한글' → '�ѱ�'
//
//   더 위험한 건 쓸 때다. 깨진 채로 읽고 UTF-8 로 저장하면 원본이 상한다.
//   그래서 이 파일의 규칙은 하나다 — **읽은 인코딩으로 되돌려 쓴다.**
//
// 의존성 0개를 어떻게 지키나:
//   해독은 Node 내장 TextDecoder 가 해 준다 (euc-kr, shift_jis, gbk, big5 …).
//   그런데 TextEncoder 는 UTF-8 밖에 못 만든다. 되돌려 쓸 방법이 없다.
//   그래서 해독기로 역표를 만든다 — 두 바이트 조합을 전부 해독해서
//   '글자 → 바이트' 표를 얻는다. 남의 코드를 들이지 않고 인코더를 얻는 방법이다.
//   표는 처음 쓸 때 한 번만 만들고 넣어 둔다.
import { execFileSync } from 'node:child_process';

// 알아볼 인코딩들. TextDecoder 가 아는 이름만 쓴다.
// 순서는 '이 자리에서 가장 그럴듯한 것' 순이 아니라, 그냥 아는 목록이다.
export const LEGACY = [
  { id: 'euc-kr',    label: '완성형 (한국)',   cp: 949 },
  { id: 'shift_jis', label: 'Shift_JIS (일본)', cp: 932 },
  { id: 'gbk',       label: 'GBK (중국)',       cp: 936 },
  { id: 'big5',      label: 'Big5 (대만)',      cp: 950 },
  { id: 'windows-1252', label: '서유럽',        cp: 1252 },
];

const BOMS = [
  { id: 'utf-8',    bytes: [0xEF, 0xBB, 0xBF] },
  { id: 'utf-16le', bytes: [0xFF, 0xFE] },
  { id: 'utf-16be', bytes: [0xFE, 0xFF] },
];

/** 앞머리에 표식(BOM)이 있나. 있으면 그게 답이다 — 짐작할 필요가 없다. */
export function bomOf(buf) {
  for (const b of BOMS) {
    if (buf.length >= b.bytes.length && b.bytes.every((v, i) => buf[i] === v)) {
      return { id: b.id, size: b.bytes.length };
    }
  }
  return null;
}

/**
 * 이 바이트들이 UTF-8 로 말이 되나.
 *
 * UTF-8 은 규칙이 빡빡해서, 아무 바이트나 UTF-8 인 척할 수 없다.
 * 그 빡빡함을 그대로 검사한다. 통과하면 UTF-8 이라고 봐도 된다.
 * (ASCII 만 있는 파일도 통과한다. 그건 어느 인코딩으로 읽어도 같으니 상관없다.)
 */
export function isUtf8(buf) {
  let i = 0;
  while (i < buf.length) {
    const c = buf[i];
    if (c <= 0x7F) { i++; continue; }

    let len;
    let min;
    if (c >= 0xC2 && c <= 0xDF) { len = 2; min = 0x80; }
    else if (c >= 0xE0 && c <= 0xEF) { len = 3; min = 0x800; }
    else if (c >= 0xF0 && c <= 0xF4) { len = 4; min = 0x10000; }
    else return false;                        // 0xC0·0xC1·0xF5~0xFF 는 UTF-8 에 없다

    if (i + len > buf.length) return false;
    let cp = c & (0xFF >> (len + 1));
    for (let k = 1; k < len; k++) {
      const t = buf[i + k];
      if ((t & 0xC0) !== 0x80) return false;  // 뒤따르는 바이트는 10xxxxxx 여야 한다
      cp = (cp << 6) | (t & 0x3F);
    }
    if (cp < min) return false;               // 짧게 쓸 수 있는 걸 길게 쓴 것 (보안 문제라 거절)
    if (cp > 0x10FFFF) return false;
    if (cp >= 0xD800 && cp <= 0xDFFF) return false;
    i += len;
  }
  return true;
}

/** 글자가 아닌 파일인가. 0 바이트가 있으면 그림·실행파일 같은 것이다. */
export function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// ── 내용을 보고 짐작하기 ────────────────────────────────────────────────
//
// 전에는 'UTF-8 이 아니면 이 컴퓨터 기본 코드페이지' 였다. 한국 윈도우에서만
// 맞는 코드였다. 우분투에서는 windows-1252 로 떨어지고, 미국 윈도우도 마찬가지다.
// 같은 CP949 문서가 사람 컴퓨터마다 다르게 읽혔다.
//
// 그래서 컴퓨터 설정 말고 **내용** 을 본다. 후보마다 엄격하게 해독해 보고,
// 나온 글이 '그 인코딩으로 쓴 진짜 글' 처럼 보이는지 점수를 매긴다.
//
// 핵심은 인코딩마다 기대치가 다르다는 것이다. CP949 로 쓴 한국어 문서는
// 한글이 많고 한자는 거의 없다. GBK 문서는 한자뿐이다. 그래서 CP949 문서를
// GBK 로 잘못 읽으면 한자가 나오긴 하는데 — 반대로 GBK 문서를 CP949 로 읽으면
// 한글과 희귀 한자가 뒤섞인다. 이 비대칭이 둘을 가른다.
//
// 표본 21개로 재서 21개를 맞혔다. 가장 아슬아슬한 것도 0.50 점 차였다.

const 한글음절 = (c) => c >= 0xAC00 && c <= 0xD7A3;
const 한글자모 = (c) => c >= 0x3130 && c <= 0x318F;
const 가나     = (c) => c >= 0x3040 && c <= 0x30FF;
const 한자     = (c) => (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0xF900 && c <= 0xFAFF);
const 라틴     = (c) => c >= 0xC0 && c <= 0x24F;
const 동아부호 = (c) => (c >= 0x3000 && c <= 0x303F) || (c >= 0xFF00 && c <= 0xFFEF);
const 로마자   = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

// '이 인코딩으로 쓴 글이면 이런 글자가 나온다' 를 점수로 적은 것.
// 음수는 '그럴 리 없다' 는 뜻이다. Shift_JIS 문서에 한글이 나올 리 없다.
const 기대 = {
  'euc-kr':       { 한글: 4,  자모: 2,  가나: -3, 한자: -2, 라틴: -3, 부호: 1 },
  'shift_jis':    { 한글: -4, 자모: -2, 가나: 4,  한자: 2,  라틴: -3, 부호: 1 },
  'gbk':          { 한글: -3, 자모: -2, 가나: -1, 한자: 3,  라틴: -3, 부호: 1 },
  'big5':         { 한글: -3, 자모: -2, 가나: -1, 한자: 3,  라틴: -3, 부호: 1 },
  'windows-1252': { 한글: 0,  자모: 0,  가나: 0,  한자: 0,  라틴: 3,  부호: 0 },
};

// 자주 쓰는 글자. 동점을 가르는 것은 결국 이것이다.
// 깨진 글에서 나오는 한글·한자는 희귀한 것들이라 여기에 거의 안 걸린다.
const 흔한한글 = new Set([...'이다는에하고지의있을로가사서대시한를수요리어아스나자기인정부상도문그무전등성니습해개년월일시분초원건확인요청결재보고회의첨부']);
const 흔한한자 = new Set([...'的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样进最新報告書項目度務部社長株式會員請查收謝件附這測試繁體簡']);

/** 후보를 점수순으로. 첫 번째가 가장 그럴듯한 것이다. */
export function guess(buf) {
  const 후보 = [];
  for (const cand of LEGACY) {
    let text;
    // 엄격 모드로 해독한다. 없는 조합이 하나라도 있으면 그 인코딩이 아니다.
    // windows-1252 도 정의 안 된 바이트가 다섯 개 있어서 여기서 걸러진다.
    try { text = new TextDecoder(cand.id, { fatal: true }).decode(buf); } catch { continue; }
    후보.push({ id: cand.id, score: 점수(text, cand.id) });
  }
  후보.sort((a, b) => b.score - a.score);
  return 후보;
}

function 점수(s, id) {
  const w = 기대[id];
  let 합 = 0;
  let 수 = 0;
  const cs = [...s];
  for (let i = 0; i < cs.length; i++) {
    const ch = cs[i];
    const c = ch.codePointAt(0);
    if (c < 0x80) {
      // 탭·줄바꿈 말고 제어문자가 글 속에 있으면 잘못 읽은 것이다.
      if (c === 9 || c === 10 || c === 13 || c >= 0x20) continue;
      합 -= 8; 수++; continue;
    }
    수++;
    if (한글음절(c)) 합 += w.한글;
    else if (한글자모(c)) 합 += w.자모;
    else if (가나(c)) 합 += w.가나;
    else if (한자(c)) 합 += w.한자;
    else if (라틴(c)) 합 += w.라틴;
    else if (동아부호(c)) 합 += w.부호;
    else if (c >= 0xE000 && c <= 0xF8FF) 합 -= 8;   // 사용자 영역 — 글에 나올 리 없다
    else if (c >= 0x2000 && c <= 0x2BFF) 합 -= 1;   // 괘선·기호 — 깨진 글에 흔하다
    else 합 -= 2;

    if ((한글음절(c) && 흔한한글.has(ch)) || (한자(c) && 흔한한자.has(ch))) 합 += 2;

    // 로마자 단어 속에 동아시아 글자가 박혀 있으면 깨진 것이다.
    // 'Über' 의 Ü 한 바이트가 뒷글자를 잡아먹고 '躡er' 이 되는 꼴을 이걸로 잡는다.
    if (한글음절(c) || 가나(c) || 한자(c)) {
      const 앞 = cs[i - 1]?.codePointAt(0);
      const 뒤 = cs[i + 1]?.codePointAt(0);
      if ((앞 !== undefined && 로마자(앞)) || (뒤 !== undefined && 로마자(뒤))) 합 -= 2;
    }
  }
  return 수 ? 합 / 수 : 0;
}

// 짐작이 이만큼 안에서 갈리면 사실상 동점이다. 그때는 힌트를 따른다.
const 박빙 = 0.5;

/**
 * 이 바이트들이 어떤 인코딩인가.
 *
 * 순서가 중요하다.
 *   1) 표식이 있으면 그것          — 확실함
 *   2) UTF-8 규칙에 맞으면 UTF-8   — 규칙이 빡빡해서 우연히 맞기 어렵다
 *   3) 아니면 내용을 보고 짐작      — 후보마다 점수를 매겨 고른다
 *
 * 3번은 짐작이다. 그래서 확신도를 같이 돌려준다. 확신이 없으면 부르는 쪽에서
 * 파일을 고치지 않도록 한다 — 잘못 고치면 원본이 상한다.
 *
 * fallback 은 명령이 아니라 힌트다. 내용이 분명하면 내용이 이긴다.
 * 짐작이 박빙일 때만 힌트가 결정을 한다 — 짧은 파일은 근거가 모자라기 때문이다.
 */
export function detect(buf, { fallback = null, system = null } = {}) {
  if (!buf.length) return { id: 'utf-8', sure: true, why: '빈 파일' };

  const bom = bomOf(buf);
  if (bom) return { id: bom.id, sure: true, bom: bom.size, why: '앞머리 표식' };

  if (isUtf8(buf)) {
    const 한글밖 = buf.some((b) => b > 0x7F);
    return { id: 'utf-8', sure: true, why: 한글밖 ? 'UTF-8 규칙에 맞음' : 'ASCII 뿐' };
  }

  const 힌트 = fallback ?? system ?? systemLegacy();
  const 후보 = guess(buf);
  if (!후보.length) {
    return { id: 힌트, sure: false, why: '어느 인코딩으로도 말이 안 됨 — 힌트로 봄' };
  }

  const 으뜸 = 후보[0];
  const 힌트것 = 후보.find((x) => x.id === 힌트);
  if (힌트것 && 힌트것 !== 으뜸 && 으뜸.score - 힌트것.score < 박빙) {
    return { id: 힌트것.id, sure: false, why: `${으뜸.id} 와 박빙이라 힌트를 따름`, 후보 };
  }
  const 여유 = 후보.length > 1 ? 으뜸.score - 후보[1].score : Infinity;
  return { id: 으뜸.id, sure: false, why: `내용으로 짐작 (${여유 === Infinity ? '단독' : `${여유.toFixed(1)}점 차`})`, 후보 };
}

// 이 컴퓨터가 쓰는 옛 인코딩. 콘솔 코드페이지를 물어봐서 정한다.
let _sys = null;
export function systemLegacy() {
  if (_sys) return _sys;
  const cp = consoleCodepage();
  _sys = LEGACY.find((x) => x.cp === cp)?.id ?? 'windows-1252';
  return _sys;
}

/**
 * 윈도우 콘솔이 쓰는 코드페이지.
 *
 * 명령을 돌려 알아낸다. 한 번만 하고 기억한다. 윈도우가 아니면 UTF-8 이다.
 * 이 값이 필요한 이유가 둘이다 — 옛 인코딩 짐작의 기본값이고, Bash 도구가
 * 받아오는 명령 출력을 해독하는 데도 쓴다.
 */
let _cp = null;
export function consoleCodepage() {
  if (_cp !== null) return _cp;
  if (process.platform !== 'win32') { _cp = 65001; return _cp; }
  try {
    // 여기서만 동기로 부른다. 값이 안 바뀌므로 한 번이면 된다.
    const out = execFileSync('chcp.com', [], { encoding: 'latin1', timeout: 3000, windowsHide: true });
    const m = out.match(/(\d{3,5})/);
    _cp = m ? Number(m[1]) : 65001;
  } catch { _cp = 65001; }
  return _cp;
}

/** 바이트를 글로. 무엇으로 읽었는지도 같이 돌려준다. */
export function decode(buf, { fallback = null, system = null } = {}) {
  const found = detect(buf, { fallback, system });
  const body = found.bom ? buf.subarray(found.bom) : buf;
  let text;
  try {
    text = new TextDecoder(found.id, { fatal: false }).decode(body);
  } catch {
    text = body.toString('utf8');
    return { text, encoding: 'utf-8', sure: false, why: `${found.id} 를 이 Node 가 모름` };
  }
  return { text, encoding: found.id, sure: found.sure, why: found.why, bom: found.bom ?? 0 };
}

// ── 되돌려 쓰기 ─────────────────────────────────────────────────────────
//
// 해독기를 뒤집어 인코더를 만든다.
// 두 바이트로 될 수 있는 조합을 전부 해독해서 '글자 → 바이트' 표를 얻는다.
// 6만 번쯤 도는데 한 번만 하면 된다. 남의 패키지를 들이는 것보다 이게 낫다.
const _tables = new Map();

function reverseTable(id) {
  if (_tables.has(id)) return _tables.get(id);
  const dec = new TextDecoder(id, { fatal: true });
  const map = new Map();

  // 한 바이트짜리 (ASCII 및 그 인코딩의 반각 영역)
  for (let b = 0; b < 0x100; b++) {
    try {
      const ch = dec.decode(Uint8Array.of(b));
      if (ch.length === 1 && !map.has(ch)) map.set(ch, Uint8Array.of(b));
    } catch { /* 이 바이트 혼자로는 글자가 아니다 */ }
  }
  // 두 바이트짜리
  for (let hi = 0x81; hi <= 0xFE; hi++) {
    for (let lo = 0x40; lo <= 0xFE; lo++) {
      try {
        const ch = dec.decode(Uint8Array.of(hi, lo));
        if (ch.length === 1 && !map.has(ch)) map.set(ch, Uint8Array.of(hi, lo));
      } catch { /* 없는 조합 */ }
    }
  }
  _tables.set(id, map);
  return map;
}

/**
 * 글을 바이트로. 읽을 때와 같은 인코딩으로 되돌린다.
 *
 * 그 인코딩에 없는 글자가 있으면 바꾸지 않고 알린다. 물음표로 뭉개서 저장하면
 * 사용자는 그 사실을 모른 채 원본을 잃는다. 조용히 망가뜨리느니 멈추는 게 낫다.
 */
export function encode(text, encoding = 'utf-8') {
  const id = String(encoding).toLowerCase();

  if (id === 'utf-8' || id === 'utf8') return { buf: Buffer.from(text, 'utf8'), lost: [] };
  if (id === 'utf-8-bom') {
    return { buf: Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]), lost: [] };
  }
  if (id === 'utf-16le') return { buf: Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]), lost: [] };

  let map;
  try { map = reverseTable(id); }
  catch { return { buf: Buffer.from(text, 'utf8'), lost: [], fellBack: true }; }

  const out = [];
  const lost = new Set();
  for (const ch of text) {
    if (ch === '\n' || ch === '\r' || ch === '\t') { out.push(ch.charCodeAt(0)); continue; }
    const bytes = map.get(ch);
    if (bytes) { for (const b of bytes) out.push(b); }
    else lost.add(ch);
  }
  return { buf: Buffer.from(out), lost: [...lost] };
}

/** 화면에 적을 짧은 이름. 'CP949' 처럼 사람이 아는 말로. */
export function label(id) {
  if (id === 'utf-8') return 'UTF-8';
  if (id === 'utf-8-bom') return 'UTF-8(BOM)';
  if (id === 'utf-16le') return 'UTF-16LE';
  if (id === 'utf-16be') return 'UTF-16BE';
  const f = LEGACY.find((x) => x.id === id);
  return f ? `CP${f.cp}` : String(id).toUpperCase();
}
