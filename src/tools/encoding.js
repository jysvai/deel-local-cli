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

/*
 * ── 0 바이트가 있다고 다 그림은 아니다 ──────────────────────────────────
 *
 * UTF-16 은 영문 한 글자를 두 바이트로 쓴다. 뒤 한 바이트는 0 이다.
 *
 *     'Hello'  →  48 00 65 00 6C 00 6C 00 6F 00
 *
 * 그래서 「0 바이트가 있으면 그림」 이라는 잣대에 **멀쩡한 글 파일이 통째로
 * 걸렸다.** 읽기 도구가 그 잣대를 먼저 보므로, 사람은 이런 답을 받았다 —
 *
 *     Read notes.txt
 *       ✗ 바이너리 파일입니다 — 텍스트로 읽을 수 없습니다
 *
 * 앞머리에 표식(BOM)이 **찍혀 있어도** 그랬다. 이 파일은 utf-16le 를 알아보고
 * 읽고 바이트까지 똑같이 되돌려 쓸 줄 아는데, 그 앞에서 막혔다. 윈도우에서
 * 만든 파일에 흔한 인코딩이라 남의 파일이 아니라 제 파일에서 걸린다.
 *
 * ── 자리 쏠림만으로는 한글을 하나도 못 건졌다 ──────────────────────────
 *
 * 처음 고칠 때 잣대를 「0 이 **한쪽 자리에만** 나온다」 로 잡았다 — LE 는
 * 홀수 자리, BE 는 짝수 자리. 영문에는 맞는 말이고, 그래서 영문 UTF-16 은
 * 그때 읽히기 시작했다. 그리고 머리말에 「한글 UTF-16 문서도 읽는다」 고
 * 적었다. **재 보지 않고 적었다.** 재 보니 한 줄도 안 읽혔다:
 *
 *     UTF-16LE "안녕하세요 반갑습니다"   ✗ 바이너리 파일입니다
 *     UTF-16LE "글을 쓰는 자리입니다"    ✗ 바이너리 파일입니다
 *     UTF-16BE 같은 글                  ✗ 바이너리 파일입니다
 *
 * 한글은 두 바이트가 다 차 있어서(`48 C5`) 0 이 안 나온다. 그러니 0 이
 * 나오는 자리는 **띄어쓰기와 줄바꿈뿐**이고, 그건 홀수 자리에 한둘이다 —
 * 「둘 이상」 이라는 문턱에 걸린다. 게다가 `가`(U+AC00) · `글`(U+AE00)처럼
 * 낮은 바이트가 0 인 음절이 하나만 섞이면 **짝수 자리에도** 0 이 생겨서
 * 「한쪽에만」 이 통째로 깨진다. 그 두 가지가 겹치면 BE 쪽 조건에 걸려
 * **거꾸로 읽히기까지** 한다.
 *
 * ── 그래서 이미 있는 점수표에 후보로 넣는다 ────────────────────────────
 *
 * 아래 guess() 는 후보마다 엄격하게 풀어 보고 「그 인코딩으로 쓴 진짜 글
 * 같은가」 를 점수로 매긴다. 표본 21개를 21개 맞힌 자다. UTF-16 도 그
 * 저울에 같이 올리면 될 일이었다.
 *
 * 그냥 풀어 보는 것만으로는 **못 가른다.** 재 봤다 — CP949 로 쓴 한국어
 * 문서도, Shift_JIS 일본어 문서도, GBK 중국어 문서도 UTF-16BE 로 깨끗하게
 * 풀린다(제어문자 하나 없이). 나오는 글자가 희귀한 한글·한자일 뿐이다.
 * 가르는 것은 **흔한 글자냐**이고, 그건 점수표가 이미 세고 있다.
 *
 * 자리 쏠림은 버리지 않고 **증거 한 가지**로 남긴다. 0 이 넉넉히 나오는
 * 영문 UTF-16 은 쏠림이 결정적이라, 거기에만 힘을 준다.
 */
function 글같나(buf, id, 잘림 = false) {
  let text;
  // 잘라 낸 표본이면 끝 글자가 반쪽일 수 있다 — stream 으로 풀면 그 반쪽은 탈이 아니다.
  try { text = new TextDecoder(id, { fatal: true }).decode(buf, { stream: 잘림 }); } catch { return null; }
  if (!text.length) return null;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 0x20 || (c >= 0x7F && c <= 0x9F)) return null;   // 제어문자 — 글이 아니다
    if (c >= 0xE000 && c <= 0xF8FF) return null;             // 사용자 영역 — 글에 안 나온다
  }
  return text;
}

/**
 * UTF-16 으로 풀리는 후보들. 점수는 아래 점수() 와 같은 저울이다.
 *
 * 두 바이트 단위라 **다 온 파일**의 길이가 홀수면 애초에 아니다. 앞머리만
 * 잘라 온 표본(`잘림`)은 다르다 — 글자 한가운데서 끊긴 것이라 홀수가 정상이다.
 * 그 둘을 안 가르고 홀수 바이트를 그냥 버리던 때는, 다 온 홀수 길이 파일이
 * UTF-16 으로 읽혔다 (9회차 · 2차 눈 · 주석과 코드가 서로 다른 말).
 *
 * 너무 짧으면 우연히 풀리는 것이 많다. 두 자(넉 바이트)가 안 되면 볼 것이
 * 아예 없어 그만두고, 그 위로는 점수만으로 정하지 않고 **자리 쏠림**을 같이 본다
 * (아래 쏠림). 「여덟 바이트는 있어야 본다」 고 적혀 있던 자리다 — 코드는 그런
 * 문턱을 둔 적이 없다. 문턱이 아니라 쏠림이 가르는 것이라 코드 쪽이 맞았다.
 *
 * @param {boolean} 잘림  앞머리만 잘라 온 표본인가
 */
function utf16후보(buf, 잘림 = false) {
  if (!잘림 && buf.length % 2) return [];
  const n = Math.min(buf.length - (buf.length % 2), 8000);
  if (n < 4) return [];
  const 본것 = buf.subarray(0, n);
  let 짝 = 0;
  let 홀 = 0;
  for (let i = 0; i < n; i++) if (본것[i] === 0) { if (i % 2) 홀 += 1; else 짝 += 1; }
  // 0 이 한쪽에 몰려 있고 그 수가 넉넉하면(글자 넷 중 하나꼴) 쏠림이 결정적이다.
  const 넉넉 = n / 8;
  const out = [];
  for (const id of ['utf-16le', 'utf-16be']) {
    /*
     * 앞 8000바이트만 볼 때는 그 자리가 짝(서로게이트) 한가운데일 수 있다.
     * 부르는 쪽이 「앞머리만 잘라 왔다」 고 한 때도 마찬가지다 — 그 말을
     * 여기까지 안 옮기던 때는, 짝수 길이로 잘린 표본의 마지막 서러게이트가
     * 반쪽만 남아 fatal 디코더가 던졌고 **그 결과 UTF-16LE 짜리가 UTF-16BE
     * 로 읽혔다.** 못 알아본 것이 아니라 **다른 것으로 알아봤다.**
     */
    const 글 = 글같나(본것, id, 잘림 || n < buf.length);
    if (글 === null) continue;
    const 맞는쪽 = id === 'utf-16le' ? 홀 : 짝;
    const 틀린쪽 = id === 'utf-16le' ? 짝 : 홀;
    const 쏠림 = 틀린쪽 === 0 && 맞는쪽 >= 넉넉 && 맞는쪽 >= 2;
    out.push({ id, score: 점수(글, id) + (쏠림 ? 3 : 0), 쏠림 });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * 이 바이트들은 UTF-16 인가. 아니면 null.
 *
 * @param {Buffer} buf
 * @param {Array}  옛것후보  이미 매겨 둔 레거시 후보(guess 의 결과). 없으면 여기서 매긴다.
 */
export function utf16인가(buf, 옛것후보 = null, { 잘림 = false } = {}) {
  const bom = bomOf(buf);
  if (bom && bom.id !== 'utf-8') return bom.id;
  const 열여섯 = utf16후보(buf, 잘림);
  if (!열여섯.length) return null;
  /*
   * ── UTF-8 로도 말이 되면 **자리 쏠림이 있어야** UTF-16 이라 한다 ────────
   *
   * 아스키만 든 글은 어떤 두 바이트를 묶어도 한자 한 글자가 된다. 그래서
   * 점수만 보면 UTF-16 이 이긴다 — 옛 인코딩으로는 그냥 아스키라 셀 글자가
   * 없어 0점이고, UTF-16 으로는 한자가 쏟아져 3점씩 붙기 때문이다.
   *
   *     "hello-encoding"          → 桥汬漭敮捯摩湧
   *     "hello\0world … text ok"  → 敨汬o 潷汲…       (NUL 한 개 든 평범한 글)
   *     01 00 03 00 05 00 …       → ĀȀ̀…            (한쪽에만 0 인 제어문자 덩이)
   *
   * 앞 둘은 멀쩡한 UTF-8 이고 셋째는 그림이다. 셋 다 UTF-16 으로 읽혀서
   * 「NUL 있으면 바이너리」 와 「명령 출력을 바이트로 받아 푼다」 가 같이
   * 빨개졌다.
   *
   * 가르는 것은 **자리 쏠림**이다. 진짜 UTF-16 아스키 문서는 글자마다 0 이
   * 하나씩 같은 자리에 박힌다 — 넉넉하고 가지런하다. 위 셋은 0 이 없거나
   * (앞 둘) 가지런해도 수가 안 맞는다.
   *
   * 한글·한자가 든 UTF-16 은 이 조건에 안 걸린다. 그 바이트열은 UTF-8
   * 규칙에 안 맞아서 여기 오지도 않는다.
   */
  if (isUtf8(buf) && !열여섯[0].쏠림) return null;
  /*
   * 옛 인코딩으로 읽는 편이 더 그럴듯하면 UTF-16 이 아니다.
   *
   * 이 한 줄이 거짓 양성을 막는다. CP949 문서는 euc-kr 로 풀면 흔한 한글이
   * 쏟아지고(높은 점수) UTF-16BE 로 풀면 희귀한 한글이 나온다(낮은 점수).
   * 반대로 진짜 UTF-16 한글 문서는 옛 인코딩으로 풀면 0 바이트가 제어문자로
   * 잡혀 크게 깎인다.
   */
  const 옛것 = 옛것후보 ?? guess(buf, { 잘림 });
  const 제일나은옛것 = 옛것.length ? 옛것[0].score : -Infinity;
  if (열여섯[0].score <= 제일나은옛것) return null;
  return 열여섯[0].id;
}

/** 글자가 아닌 파일인가. 0 바이트가 있으면 그림·실행파일 같은 것이다. */
export function looksBinary(buf) {
  if (utf16인가(buf)) return false;
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
  /*
   * UTF-16 은 어느 나라 말이든 담는다. 그래서 「이 인코딩이면 이 글자」 라는
   * 편향이 없다 — 한글·가나·한자·라틴을 다 곧이곧대로 받는다.
   *
   * 자모만 음수다. 낱자(ㄱ·ㅏ)만 늘어놓은 글은 사람이 안 쓴다. 다른 인코딩을
   * UTF-16 으로 잘못 풀었을 때 자주 나오는 것이 그것이라, 여기서 가른다.
   */
  'utf-16le': { 한글: 4,  자모: -2, 가나: 4,  한자: 3,  라틴: 3,  부호: 1 },
  'utf-16be': { 한글: 4,  자모: -2, 가나: 4,  한자: 3,  라틴: 3,  부호: 1 },
};

// 자주 쓰는 글자. 동점을 가르는 것은 결국 이것이다.
// 깨진 글에서 나오는 한글·한자는 희귀한 것들이라 여기에 거의 안 걸린다.
const 흔한한글 = new Set([...'이다는에하고지의있을로가사서대시한를수요리어아스나자기인정부상도문그무전등성니습해개년월일시분초원건확인요청결재보고회의첨부']);
const 흔한한자 = new Set([...'的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样进最新報告書項目度務部社長株式會員請查收謝件附這測試繁體簡']);

/**
 * 후보를 점수순으로. 첫 번째가 가장 그럴듯한 것이다.
 *
 * `잘림` 은 **파일 앞머리만 잘라 온 표본**이라는 뜻이다.
 *
 * 큰 파일은 앞 64KB 만 보고 판정한다(tools/index.js 의 재는인코딩). 그런데
 * 그 자리가 두 바이트 글자의 한가운데면 앞 바이트 하나가 외톨이로 남고,
 * 엄격 모드는 그 한 바이트 때문에 CP949 후보를 **통째로** 떨어뜨렸다. 남는
 * 것은 아무 바이트나 받는 CP1252 뿐이라 64KB 넘는 사내 CP949 로그에 한 줄
 * 붙이면 「CP1252 에 없는 글자」 로 거절되거나, `·` 처럼 양쪽에 다 있는
 * 글자는 CP1252 바이트로 **조용히** 붙었다. 자른 자리를 맞추던 자는 UTF-8
 * 경계만 알았다 — 오히려 한 바이트를 더 깎아 외톨이를 만들기도 했다.
 *
 * stream 으로 풀면 끝의 반쪽 글자는 「아직 덜 온 것」 이라 탈이 아니다.
 * 한가운데의 없는 조합은 여전히 탈이라 거르는 힘은 그대로다.
 */
export function guess(buf, { 잘림 = false } = {}) {
  const 후보 = [];
  for (const cand of LEGACY) {
    let text;
    // 엄격 모드로 해독한다. 없는 조합이 하나라도 있으면 그 인코딩이 아니다.
    //
    // 다만 **windows-1252 는 여기서 안 걸러진다.** WHATWG 의 windows-1252 는 정의가
    // 비어 있는 다섯 바이트(81·8D·8F·90·9D)도 같은 번호의 제어문자로 옮기게 돼 있어서,
    // fatal 로 돌려도 256 바이트를 다 받는다(검사: 인코딩 「늘 후보다」). 그래서
    // windows-1252 는 언제나 후보로 남고, 가르는 일은 전부 점수가 한다.
    // 걸러지는 것은 두 바이트 인코딩 넷뿐이다.
    try { text = new TextDecoder(cand.id, { fatal: true }).decode(buf, { stream: 잘림 }); } catch { continue; }
    후보.push({ id: cand.id, score: 점수(text, cand.id) });
  }
  후보.sort((a, b) => b.score - a.score);
  return 후보;
}

/*
 * ── 짧은 파일에서 판정이 흔들리던 세 가지 ───────────────────────────────
 *
 * 실제 문장을 N 글자씩 잘라 재 봤다(표본 문장 넷 × 자리 여럿). 고치기 전:
 *
 *   Shift_JIS 「ます。担当は山田太郎です。東京本」 (20자)  → GBK
 *   GBK       「并提交报告，谢谢大家的配合与支持。负责人是张经理」 (24자, 32자도) → UTF-16BE
 *   짧은 표본 모음(두세 글자 낱말 183개)                    → 29개 틀림
 *
 * 스무 자가 넘는 사내 문서가 엉뚱한 인코딩으로 읽히면 「짧아서」 가 아니다.
 * 까닭은 둘이었다.
 *
 *   1) GBK · Big5 는 거의 모든 두 바이트를 받는다. Shift_JIS 한자 바이트
 *      (앞 0x88–0x9F)를 GBK 로 풀면 **GB2312 밖 확장 자리**의 한자가 줄줄이
 *      나온다. 중국어 글은 그 자리 글자를 드물게 쓰는데 점수표는 같은 3점을 줬다.
 *      → 확장 자리(GBK: 앞 0xB0–0xF7·뒤 0xA1 이상 밖, Big5: 앞 0xA4–0xF9 밖)
 *        한자는 1점으로 센다. 넉 자 미만이면 안 깎는다 — 석 자로는 드문지
 *        흔한지 말할 근거가 없고, 그때는 힌트가 가른다(박빙).
 *   2) UTF-16 으로 잘못 풀면 두 바이트마다 아무 한글·한자가 나온다. 진짜
 *      한국어·중국어 글에는 흔한 글자가 섞이는데 점수표는 드문 음절에도
 *      4점을 줬다. → UTF-16 후보에서 흔한 글자 목록 밖의 한글 음절은 2점,
 *      한자는 1점. (옛 인코딩 후보는 그대로다 — 거기서는 이미 비대칭이 가른다)
 *
 * 고친 뒤(같은 표본): 넉 자부터 Shift_JIS · Big5 · CP949 는 한 개도 안 틀리고,
 * **여섯 자부터 옛 인코딩 넷이 다 맞는다.** 표식 없는 UTF-16 은 **열 자부터**
 * 다 맞는다. 짧은 표본 모음은 29 → 18.
 *
 * ── 그보다 짧으면 **못 가른다** — 짐작으로 다룬다 ─────────────────────────
 *
 * 두세 글자는 같은 바이트가 여러 인코딩에서 멀쩡한 글이다. `谢谢`(GBK D0BB D0BB)
 * 는 UTF-8 로도 맞는 `лл` 이고, `確認` 은 Shift_JIS 로도 GBK 로도 흔한 한자다.
 * 점수를 더 비틀면 반대쪽(짧은 UTF-16, 짧은 GBK)이 틀린다 — 재 봤다. 그래서
 * 여섯 자(UTF-16 은 열 자) 미만인 옛 인코딩 조각은 대개 sure:false 로 돌아오고, Read 는
 * 「짐작」 으로 적고, Write·Edit 은 그 표시를 달고 쓴다. 힌트(fallback)가 박빙을 가른다.
 *
 * **예외 하나** — 바이트가 UTF-8 로도 빈틈없이 맞으면 UTF-8 이 먼저 이기고 sure:true 다.
 * 위의 `谢谢` 가 그렇다: utf-8 · sure:true 로 `лл` 이 나온다. 짧은 조각에서
 * 「sure:true 면 틀림없다」 로 읽으면 안 된다 — 이 크기에서는 알려진 한계다.
 */
function 점수(s, id) {
  const w = 기대[id];
  const 열여섯 = id.startsWith('utf-16');
  let 합 = 0;
  let 수 = 0;
  let 드문 = 0;
  const cs = [...s];
  /*
   * ── 한글이 멀쩡하면 CP949 의 한자는 깎지 않는다 (2.0.0 6회차 · Gemini 인코딩6) ──
   *
   * 「CP949 문서에 한자는 드물다」 로 한자마다 깎았다. 그런데 계약서·공문은 한자를 섞어 쓴다 —
   * 「契約書 第1條 株式會社 甲과 乙은 …」 이 GBK 로 읽혀 글이 통째로 중국 글자로 깨졌다. 한글
   * 음절 바이트를 GBK 로 풀면 흔한 중국 한자가 나와서 GBK 가 0.4–0.8점 앞섰다.
   *
   * 가르는 것은 한글 쪽이다. 진짜 한국어는 흔한 음절(이·다·는·을…)이 넉넉히 섞이고, 중국어·
   * 일본어 바이트를 CP949 로 잘못 풀면 2,350 음절 중 아무것이나 나와 흔한 것은 드물다(수 %).
   * 그래서 흔한 음절이 셋 이상이고 한글의 30% 이상이면 한자를 한국 글의 한자로 쳐 준다.
   */
  let 한자값 = w.한자;
  if (id === 'euc-kr') {
    let 한글수 = 0;
    let 흔한수 = 0;
    for (const ch of cs) {
      if (!한글음절(ch.codePointAt(0))) continue;
      한글수++;
      if (흔한한글.has(ch)) 흔한수++;
    }
    if (흔한수 >= 3 && 흔한수 >= 한글수 * 0.3) 한자값 = 2;
  }
  for (let i = 0; i < cs.length; i++) {
    const ch = cs[i];
    const c = ch.codePointAt(0);
    if (c < 0x80) {
      // 탭·줄바꿈 말고 제어문자가 글 속에 있으면 잘못 읽은 것이다.
      if (c === 9 || c === 10 || c === 13 || c >= 0x20) continue;
      합 -= 8; 수++; continue;
    }
    수++;
    // UTF-16 으로 풀린 드문 한글·한자는 덜 믿는다 (위 머리말 2).
    if (한글음절(c)) 합 += (열여섯 && !흔한한글.has(ch)) ? 2 : w.한글;
    else if (한글자모(c)) 합 += w.자모;
    else if (가나(c)) 합 += w.가나;
    else if (한자(c)) {
      합 += (열여섯 && !흔한한자.has(ch)) ? 1 : 한자값;
      if (확장자리한자(id, ch)) 드문 += 1;
    }
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
  // GBK·Big5 확장 자리 한자는 1점으로 (위 머리말 1). 넉 자 미만은 힌트에 맡긴다.
  if (수 >= 4) 합 -= 드문 * (w.한자 - 1);
  return 수 ? 합 / 수 : 0;
}

/** GBK·Big5 로 쓴 이 한자가 흔한 글에 드문 **확장 자리**에 있나. 다른 인코딩이면 거짓. */
function 확장자리한자(id, ch) {
  if (id !== 'gbk' && id !== 'big5') return false;
  const b = reverseTable(id).get(ch);
  if (!b || b.length !== 2) return true;
  // GBK: GB2312 한자 자리(앞 B0–F7, 뒤 A1–FE). Big5: 상용·차상용 한자(앞 A4–F9).
  if (id === 'gbk') return !(b[0] >= 0xB0 && b[0] <= 0xF7 && b[1] >= 0xA1);
  return !(b[0] >= 0xA4 && b[0] <= 0xF9);
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
/*
 * 힌트 이름을 받아 준다.
 *
 * 아는 이름은 `euc-kr` 처럼 TextDecoder 가 쓰는 것뿐이었다. 그런데 사람도
 * 설정도 코드페이지 이름으로 적는다 — 화면에 `CP949` 라고 찍어 주는 것이
 * 이 파일의 label() 이다. 그렇게 적어 넣으면 `후보.find(x => x.id === 힌트)`
 * 가 영영 못 찾아서 **힌트가 통째로 무시됐다.** 무시했다는 말도 안 나온다.
 *
 * 짐작이 박빙일 때만 힌트가 결정을 하니, 안 듣는 것을 알아채기도 어렵다 —
 * 대개는 내용이 이겨서 맞는 답이 나오고, 아슬아슬한 파일에서만 틀린다.
 */
export function 이름정리(값) {
  const 날것 = String(값 ?? '').trim().toLowerCase();
  if (!날것) return null;
  /*
   * 유니코드 이름은 **그대로 돌려준다.**
   *
   * 여기는 옛 인코딩 이름만 알았고, 모르면 null 이었다. 그래서 `fallback:
   * 'utf-8'` 을 넣으면 `이름정리(fallback) ?? 이름정리(system) ?? …` 에서
   * null 로 떨어져 **이 컴퓨터의 옛 인코딩**이 대신 힌트가 됐다. 사람이
   * 「모르겠으면 UTF-8 로 봐」 라고 적어 둔 자리에서 CP949 를 밀어 준 셈이다.
   *
   * 힌트 후보에는 안 걸린다(옛 인코딩만 후보다). 그게 맞는 답이다 — 여기까지
   * 왔다는 것은 UTF-8 이 이미 아니라고 판정됐다는 뜻이라, 그 힌트로 밀어
   * 줄 것이 없다. 다만 **사람이 적은 것을 남의 것으로 바꿔치지는 않는다.**
   */
  if (/^utf-?8(-bom)?$/.test(날것)) return 'utf-8';
  if (/^utf-?16-?le(-bom)?$/.test(날것)) return 'utf-16le';
  if (/^utf-?16-?be(-bom)?$/.test(날것)) return 'utf-16be';
  /*
   * ── 구분자를 떼고 본다 (2.0.0 7회차 · Gemini 인코딩7a) ────────────────────
   *
   * 위 고침은 **앞가지**(cp·ms·windows-)만 걷었다. 구분자는 그대로 남아서
   * `shift-jis` 한 줄이 여전히 null 이었다 — 웹 charset 도 메일 머리글도
   * 하이픈으로 적는 쪽이 더 흔하고, `iso-8859-1` 은 웹에서 제일 많이 적히는
   * 이름인데 여기는 한 번도 알아들은 적이 없다.
   *
   * 무시하면 아무 말도 안 남는다는 것이 이 자리의 값어치다. 그래서 사람이
   * 쓰는 꼴을 **다 적어 놓고** 고른다. 짐작으로 받아 주지는 않는다 — 모르는
   * 이름을 아무거나로 읽으면 힌트가 거짓말이 된다.
   */
  const 납작 = 날것.replace(/[\s._-]+/g, '').replace(/^x/, '');
  const 별명 = {
    // 한국
    euckr: 'euc-kr', ksc5601: 'euc-kr', ksc56011987: 'euc-kr', kscms5601: 'euc-kr',
    uhc: 'euc-kr', cp949: 'euc-kr', ms949: 'euc-kr', windows949: 'euc-kr', 949: 'euc-kr',
    // 일본
    shiftjis: 'shift_jis', sjis: 'shift_jis', mskanji: 'shift_jis', shiftjis2004: 'shift_jis',
    cp932: 'shift_jis', ms932: 'shift_jis', windows932: 'shift_jis', 932: 'shift_jis',
    // 중국
    gbk: 'gbk', gb2312: 'gbk', csgb2312: 'gbk', chinese: 'gbk',
    cp936: 'gbk', ms936: 'gbk', windows936: 'gbk', 936: 'gbk',
    // 대만
    big5: 'big5', csbig5: 'big5', cp950: 'big5', ms950: 'big5', windows950: 'big5', 950: 'big5',
    // 서유럽 — WHATWG 는 iso-8859-1 을 windows-1252 로 읽으라고 못 박았다.
    windows1252: 'windows-1252', cp1252: 'windows-1252', ms1252: 'windows-1252', 1252: 'windows-1252',
    latin1: 'windows-1252', l1: 'windows-1252', iso88591: 'windows-1252', iso885915: 'windows-1252',
  };
  return 별명[납작] ?? null;
}

export function detect(buf, { fallback = null, system = null, 잘림 = false } = {}) {
  if (!buf.length) return { id: 'utf-8', sure: true, why: '빈 파일' };

  const bom = bomOf(buf);
  if (bom) return { id: bom.id, sure: true, bom: bom.size, why: '앞머리 표식' };

  /*
   * 표식 없는 UTF-16 을 여기서 가른다. isUtf8 보다 **먼저** 봐야 한다.
   *
   * UTF-16 로 쓴 영문은 바이트가 전부 0x7F 아래라서 isUtf8 이 그냥 통과시킨다.
   * 그러면 「UTF-8 · 확실함」 이라고 답하고, 글은 `H\0e\0l\0l\0o\0` 가 된다 —
   * 글자 수가 두 배가 되고 사이사이 0 이 박힌다. 확실하다고 적어 놓은 답이라
   * 부르는 쪽이 되물을 까닭도 없다.
   */
  const u16 = utf16인가(buf, null, { 잘림 });
  if (u16) return { id: u16, sure: true, bom: 0, why: '두 바이트마다 0 — 표식 없는 UTF-16' };

  if (isUtf8(buf)) {
    const 아스키밖 = buf.some((b) => b > 0x7F);
    return { id: 'utf-8', sure: true, why: 아스키밖 ? 'UTF-8 규칙에 맞음' : 'ASCII 뿐' };
  }

  // 사람이 적어 준 힌트와 이 컴퓨터의 기본값을 갈라 둔다. 못 썼다고 말해 주는 것은
  // **적어 준 것**뿐이다 — 아무도 안 적은 기본값을 못 썼다고 탓하면 그건 군말이다.
  const 적힌힌트 = 이름정리(fallback) ?? 이름정리(system);
  const 힌트 = 적힌힌트 ?? systemLegacy();
  const 후보 = guess(buf, { 잘림 });
  /*
   * 지금 목록으로는 여기 못 온다 — WHATWG 의 windows-1252 는 256 바이트를 다 받아서
   * 엄격 모드로도 안 걸러진다(검사: 인코딩 「늘 후보다」). LEGACY 목록이 바뀌는 날을
   * 위한 그물로만 남긴다. **여기 올 수 있는 척 적어 두면 아래 힌트 이야기가 거짓말이 된다.**
   */
  if (!후보.length) {
    return { id: 힌트, sure: false, why: '어느 인코딩으로도 말이 안 됨 — 힌트로 봄' };
  }

  /*
   * 적어 준 힌트로 **아예 안 읽히는** 바이트면 후보에 못 오른다. 그러면 박빙 비교에도
   * 안 들어가고 화면에는 「내용으로 짐작」 한 줄만 남는다 — 사람이 적어 준 것을 안 썼는데
   * 안 썼다는 말이 없다.
   *
   * 이름정리 머리말이 같은 꼴을 이미 한 번 걷어냈다(이름을 못 알아들어 힌트가 통째로
   * 무시되던 자리). 여기는 이름이 아니라 **바이트**가 안 맞는 쪽이라 그 고침이 안 닿았다.
   * 한 파일씩 볼 때는 답이 맞아서 안 보이고, 여러 파일을 한꺼번에 돌릴 때 어느 파일에서
   * 내 지정이 무시됐는지 짚을 자리가 없다.
   */
  // 옛 인코딩 이름일 때만 말한다. UTF-8 · UTF-16 은 여기 오기 **전에** 이미 아니라고
  // 따로 판정된 것이라, 후보에 없는 것이 설계대로다 — 그것을 「못 썼다」 고 적으면
  // 없는 문제를 알리는 셈이 된다(거짓 경고도 결함이다).
  const 옛이름인가 = (id) => LEGACY.some((x) => x.id === id);
  const 못쓴힌트 = 적힌힌트 && 옛이름인가(적힌힌트) && !후보.some((x) => x.id === 적힌힌트) ? 적힌힌트 : null;
  const 덧말 = 못쓴힌트 ? ` · 적어 준 ${못쓴힌트} 로는 이 바이트가 안 읽혀 안 썼습니다` : '';

  const 으뜸 = 후보[0];
  const 힌트것 = 후보.find((x) => x.id === 힌트);
  if (힌트것 && 힌트것 !== 으뜸 && 으뜸.score - 힌트것.score < 박빙) {
    return { id: 힌트것.id, sure: false, why: `${으뜸.id} 와 박빙이라 힌트를 따름`, 후보 };
  }
  const 여유 = 후보.length > 1 ? 으뜸.score - 후보[1].score : Infinity;
  return { id: 으뜸.id, sure: false, why: `내용으로 짐작 (${여유 === Infinity ? '단독' : `${여유.toFixed(1)}점 차`})${덧말}`, 후보 };
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

/**
 * 바이트를 글로. 무엇으로 읽었는지도 같이 돌려준다.
 *
 * 돌려주는 encoding 은 **되돌려 쓸 때 그대로 넣을 이름**이다. 읽을 때 쓴 해독기
 * 이름이 아니다. 이 둘이 갈리는 자리가 UTF-8 BOM 이다.
 *
 * BOM 있는 UTF-8 파일도 해독기는 그냥 'utf-8' 이면 된다 — 앞 3바이트를 잘라내고
 * 넘기니까. 그런데 그 이름을 그대로 돌려주면 되돌려 쓸 때 BOM 이 없어진다.
 * 한 글자 고쳤을 뿐인데 엑셀에서 CSV 한글이 깨지고, .ps1 이 오작동한다.
 * 화면의 /diff 에는 의도한 변경만 보이니 원인을 연결할 방법이 없다.
 *
 * encode() 에는 'utf-8-bom' 을 받는 자리가 처음부터 있었다. 다만 그 이름을
 * 만들어 주는 곳이 없어서 한 번도 안 불렸다 — 끊어져 있던 길을 여기서 잇는다.
 */
export function decode(buf, { fallback = null, system = null, 잘림 = false } = {}) {
  const found = detect(buf, { fallback, system, 잘림 });
  const body = found.bom ? buf.subarray(found.bom) : buf;
  let text;
  try {
    text = new TextDecoder(found.id, { fatal: false }).decode(body);
  } catch {
    text = body.toString('utf8');
    return { text, encoding: 'utf-8', sure: false, why: `${found.id} 를 이 Node 가 모름` };
  }
  /*
   * UTF-16 도 표식 유무를 이름에 담는다.
   *
   * 여태 `encode('utf-16le')` 는 표식을 **언제나** 붙였다. 원본에 표식이
   * 있는 파일만 여기까지 왔으니 그때는 맞았는데, 이제 표식 없는 것도
   * 들어온다. 그대로 두면 한 글자 고쳤을 뿐인데 앞머리에 두 바이트가 생긴다 —
   * UTF-8 쪽에서 이미 겪고 고쳐 둔 바로 그 자리다.
   */
  const 표식붙은이름 = (id) => (found.bom ? `${id}-bom` : id);
  const 되돌릴이름 = found.id === 'utf-8' || found.id === 'utf-16le' || found.id === 'utf-16be'
    ? 표식붙은이름(found.id)
    : found.id;
  return { text, encoding: 되돌릴이름, sure: found.sure, why: found.why, bom: found.bom ?? 0 };
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
  const 미룸 = [];
  for (let hi = 0x81; hi <= 0xFE; hi++) {
    for (let lo = 0x40; lo <= 0xFE; lo++) {
      try {
        const ch = dec.decode(Uint8Array.of(hi, lo));
        if (ch.length !== 1) continue;
        if (뒷자리인가(id, hi)) { 미룸.push([ch, hi, lo]); continue; }
        if ((마지막자리글자[id]?.has(ch)) || !map.has(ch)) map.set(ch, Uint8Array.of(hi, lo));
      } catch { /* 없는 조합 */ }
    }
  }
  // 뒷자리밖에 없는 글자는 그 자리로라도 쓴다 — 못 쓴다고 하는 것보다 낫다.
  for (const [ch, hi, lo] of 미룸) if (!map.has(ch)) map.set(ch, Uint8Array.of(hi, lo));
  _tables.set(id, map);
  return map;
}

/*
 * ── 한 글자에 바이트 자리가 둘인 것 — **표준 자리**를 고른다 ─────────────
 *
 * 역표를 「먼저 만난 것」 으로 채우고 있었다. 바이트 순으로 돌기 때문에
 * Big5 의 十 은 호환 자리 A2CC 가 표준 자리 A451 보다 먼저 걸렸다. 그래서
 * 새로 쓰는 十 이 전부 A2CC 로 나갔다 — 다른 도구로 검색하면 안 걸리는 十 이다.
 *
 * 브라우저·Node 가 쓰는 WHATWG 인코더와 같은 규칙으로 맞춘다.
 *   Big5      : 앞 바이트가 0xA1 아래(HKSCS)인 자리는 뒤로 미룬다. 그리고
 *               아래 여섯 글자는 **마지막** 자리를 쓴다(十·卅·괘선 넷).
 *   Shift_JIS : 0xED~0xEF (NEC 가 고른 IBM 확장 — 0xFA 쪽과 겹친다)는 뒤로 미룬다.
 *
 * 이것만으로는 **이미 파일에 있는** 호환 자리를 못 지킨다. 그건 아래
 * 바꾼데만쓰기 가 지킨다 — 손 안 댄 바이트는 역표를 아예 안 거친다.
 */
const 마지막자리글자 = { big5: new Set(['═', '╞', '╡', '╪', '十', '卅']) };
function 뒷자리인가(id, hi) {
  if (id === 'big5') return hi < 0xA1;
  if (id === 'shift_jis') return hi >= 0xED && hi <= 0xEF;
  return false;
}

/**
 * 글을 바이트로. 읽을 때와 같은 인코딩으로 되돌린다.
 *
 * 그 인코딩에 없는 글자가 있으면 바꾸지 않고 알린다. 물음표로 뭉개서 저장하면
 * 사용자는 그 사실을 모른 채 원본을 잃는다. 조용히 망가뜨리느니 멈추는 게 낫다.
 */
export function encode(text, encoding = 'utf-8') {
  /*
   * 하이픈은 있어도 없어도 같은 이름이다 (8회차 · 바깥).
   *
   * 여기는 `utf-8` 과 `utf8` 은 둘 다 받으면서 UTF-16 만 하이픈이 든 꼴 하나씩만
   * 알았다. 그런데 Node 가 쓰는 이름이 `utf16le` 라, 그 이름으로 들어온 글이 이 문을
   * 다 지나쳐 아래 역표 만들기로 떨어졌다 — 역표가 없으니 fellBack 이 서고 **조용히
   * UTF-8 바이트**가 나왔다. 바로 아래에 「한 글자 고쳤을 뿐인데 파일 전체가 다른
   * 인코딩이 되는 자리라 여기서 막는다」 고 적어 둔 그 막이, 하이픈 하나에 샜다.
   * 이름정리() 가 보는 꼴과 같게 맞춘다 — 거기는 `-bom` 을 떼므로 여기서 따로 본다.
   */
  const id = String(encoding).toLowerCase()
    .replace(/^utf-?8(?=$|-bom$)/, 'utf-8')
    .replace(/^utf-?16-?(le|be)(?=$|-bom$)/, 'utf-16$1');

  if (id === 'utf-8') return { buf: Buffer.from(text, 'utf8'), lost: [] };
  if (id === 'utf-8-bom') {
    return { buf: Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]), lost: [] };
  }
  /*
   * 표식은 **원본에 있던 것만** 붙인다. `-bom` 이 붙은 이름이 그 뜻이다.
   * 없던 파일에 붙이면 앞머리 두 바이트가 늘고, 그건 도구가 마음대로 한 변경이다.
   */
  if (id === 'utf-16le' || id === 'utf-16le-bom') {
    const le = Buffer.from(text, 'utf16le');
    return { buf: id.endsWith('-bom') ? Buffer.concat([Buffer.from([0xFF, 0xFE]), le]) : le, lost: [] };
  }
  if (id === 'utf-16be' || id === 'utf-16be-bom') {
    // Node 는 utf16be 로 쓸 줄 모른다. LE 로 쓰고 두 바이트씩 뒤집으면 그게 BE 다.
    // 없으면 아래 역표 만들기로 떨어지고, 그건 실패해서 조용히 UTF-8 이 된다 —
    // 한 글자 고쳤을 뿐인데 파일 전체가 다른 인코딩이 되는 자리라 여기서 막는다.
    const le = Buffer.from(text, 'utf16le');
    for (let i = 0; i + 1 < le.length; i += 2) { const t = le[i]; le[i] = le[i + 1]; le[i + 1] = t; }
    return { buf: id.endsWith('-bom') ? Buffer.concat([Buffer.from([0xFE, 0xFF]), le]) : le, lost: [] };
  }

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

/**
 * 옛 글을 새 글로 바꿔 쓸 바이트. **안 바뀐 앞뒤는 읽은 바이트를 그대로** 쓴다.
 *
 * ── 왜 통째로 encode 하면 안 되나 ──────────────────────────────────────
 *
 * Edit·Write 는 고친 글 **전체**를 역표로 다시 만들었다. 그런데 옛 인코딩에는
 * 한 글자에 바이트 자리가 둘 이상인 것이 있다 — Shift_JIS 에서만 398자,
 * Big5 10자, GBK 2자. 역표는 그중 한 자리만 알므로, 파일에 다른 자리로 적혀
 * 있던 글자는 **한 글자도 안 고쳤는데 바이트가 바뀐다.**
 *
 *     Shift_JIS 문서   … 計算結果は ≒(8790) 百です。確認 …
 *     「確認」 을 「承認」 으로 Edit
 *     → ≒ 가 81E0 으로 바뀐다. 글자로는 같아서 /diff 에는 안 뜬다.
 *
 * 바이트로 견주는 쪽(사내 검색·대조·서명·git)에서만 깨지고, 사람은 고친 한
 * 줄만 봤으니 이을 길이 없다. 「읽은 그대로 되돌려 쓴다」 는 이 파일의 규칙이
 * 글자 단위로만 지켜지고 있었다.
 *
 * 그래서 옛 글과 새 글의 같은 앞·같은 뒤를 잘라 내고 **가운데만** 역표로
 * 만든다. 앞뒤 바이트 길이는 그 글을 역표로 만든 길이로 잰다 — 자리가 둘인
 * 글자도 두 바이트씩이라 길이는 같다. 마지막으로 되풀어 봐서 새 글과 똑같지
 * 않으면(길이가 어긋나는 드문 글자) 여태처럼 통째로 만든 것을 쓴다.
 *
 * 못 옮기는 글자(lost)·인코더 없음(fellBack)은 통째로 만든 결과를 그대로
 * 돌려준다 — 부르는 쪽의 거절 갈래가 그 값을 본다.
 */
export function 바꾼데만쓰기(원바이트, 옛글, 새글, encoding) {
  // 사람이 아는 이름(`cp949`·`CP949`·`ms949`)으로 불러도 바이트를 지킨다 (EB2-후속 · 8회차).
  // 소문자로만 내리면 `cp949` 가 LEGACY 에 안 걸려 아래 지키기를 통째로 건너뛰었다 —
  // 고친 한 줄만 보이는 화면 뒤에서 **파일 전체가 UTF-8 로 다시 써졌다.**
  // 이름정리 가 이미 아는 별명을 이 문 앞에서만 안 쓰고 있었다.
  //
  // 이 줄이 `통째` 보다 **위에** 있어야 한다. encode 를 날이름으로 부르면 그 자리에서
  // 이미 fellBack 이 서고, 바로 아래 `if (통째.fellBack …) return` 이 지키기를 건너뛴다.
  // 다만 **표식(BOM)이 붙은 이름은 이름정리에 안 넘긴다.** 이름정리 는 힌트를 고르는
  // 자라 `-bom` 을 떼어서 돌려준다(`utf-8-bom` → `utf-8`). 그 값을 encode 에 주면
  // BOM 붙은 파일이 BOM 없이 다시 써졌다 — 엑셀이 내보낸 CSV · .ps1 · 메모장
  // UTF-16LE 가 한 글자 Edit 만으로 앞 두세 바이트를 잃었다. encode 는 `-bom` 을
  // 이미 알아들으니 날이름 그대로 넘기면 된다.
  const 날이름 = String(encoding).toLowerCase();
  const id = /-bom$/.test(날이름) ? 날이름 : (이름정리(encoding) ?? 날이름);
  const 통째 = encode(새글, id);
  if (통째.fellBack || 통째.lost.length) return 통째;
  if (!LEGACY.some((x) => x.id === id) || !Buffer.isBuffer(원바이트) || typeof 옛글 !== 'string') return 통째;

  const 짧은 = Math.min(옛글.length, 새글.length);
  let 앞 = 0;
  while (앞 < 짧은 && 옛글.charCodeAt(앞) === 새글.charCodeAt(앞)) 앞 += 1;
  let 뒤 = 0;
  while (뒤 < 짧은 - 앞 && 옛글.charCodeAt(옛글.length - 1 - 뒤) === 새글.charCodeAt(새글.length - 1 - 뒤)) 뒤 += 1;

  const 앞것 = encode(옛글.slice(0, 앞), id);
  const 뒤것 = encode(옛글.slice(옛글.length - 뒤), id);
  // 원래 글에 역표로 못 옮기는 글자가 있으면(깨진 바이트) 자리를 잴 수 없다.
  if (앞것.lost.length || 뒤것.lost.length) return 통째;
  if (앞것.buf.length + 뒤것.buf.length > 원바이트.length) return 통째;
  const 가운데 = encode(새글.slice(앞, 새글.length - 뒤), id);
  const buf = Buffer.concat([
    원바이트.subarray(0, 앞것.buf.length),
    가운데.buf,
    원바이트.subarray(원바이트.length - 뒤것.buf.length),
  ]);
  try {
    if (new TextDecoder(id, { fatal: true }).decode(buf) === 새글) return { buf, lost: [] };
  } catch { /* 자리가 어긋났다 — 통째로 만든 것을 쓴다 */ }
  return 통째;
}

/**
 * 화면에 적을 짧은 이름. 'CP949' 처럼 사람이 아는 말로.
 *
 * 받은 id 를 **소문자로 낮춰 보고** 고른다. 안 낮추던 때는 사람이나 설정이 대문자로
 * 적어 둔 이름(`EUC-KR`·`UTF-8-BOM`)이 아래 어느 줄에도 안 걸려서, 사람이 아는 말로
 * 바꿔 주라고 있는 함수가 받은 글자를 그대로 되뱉었다 — 같은 파일이 자리에 따라
 * `CP949` 로도 `EUC-KR` 로도 찍혔다. 이름을 고르는 쪽(이름정리)은 이미 낮춰 본다.
 */
export function label(id) {
  const 낮춘것 = String(id ?? '').toLowerCase();
  if (낮춘것 === 'utf-8') return 'UTF-8';
  if (낮춘것 === 'utf-8-bom') return 'UTF-8(BOM)';
  if (낮춘것 === 'utf-16le') return 'UTF-16LE';
  if (낮춘것 === 'utf-16be') return 'UTF-16BE';
  if (낮춘것 === 'utf-16le-bom') return 'UTF-16LE(BOM)';
  if (낮춘것 === 'utf-16be-bom') return 'UTF-16BE(BOM)';
  const f = LEGACY.find((x) => x.id === 낮춘것);
  return f ? `CP${f.cp}` : String(id).toUpperCase();
}
