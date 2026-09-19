// PDF 읽기 (src/tools/pdf.js).
//
// ── 무엇을 재나 ────────────────────────────────────────────────────────
//
// 빠른 것도, 예쁜 것도 아니다. **거짓말을 안 하는 것**이다.
//
// PDF 는 글이 아예 안 든 것이 흔하다 — 스캔본, /ToUnicode 없는 글꼴, 암호.
// 그때 빈 글을 돌려주면 「그런 내용이 없는 문서」로 읽히고, 모델은 그걸 근거로
// 답한다. 그래서 여기서 제일 많이 재는 것은 **못 읽었을 때 못 읽었다고 하는가**다.
//
// 본보기는 두 갈래로 쓴다.
//   · 손으로 만든 PDF — 속을 정확히 아는 것. 구조가 깨진 경우까지 만들 수 있다.
//   · 진짜 크롬이 뽑은 PDF (test/자료/) — 내 짐작이 아니라 현장의 물건.
//     크롬은 글자 하나마다 Td 로 옮기고 Tj 로 찍는데, 이걸 모르고 만들면
//     「결제」가 「결 제」로 나온다. 손으로 만든 본보기로는 그 함정이 안 보인다.
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import {
  readPdf, toText, summarize, 못읽은말, isPdfPath, looksPdf, 유니코드표읽기, 흐름풀기, 값읽기, pdf는못고침, 한쪽도못읽음말,
} from '../src/tools/pdf.js';
import { TOOLS } from '../src/tools/index.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 여기 = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'deel-pdf-'));

/* ── PDF 만드는 손 ────────────────────────────────────────────────────
 *
 * 객체를 늘어놓고 xref 를 붙인다. 일부러 망가뜨리는 스위치가 붙어 있다 —
 * 현장의 PDF 는 xref 와 /Length 가 틀린 것이 정말 흔해서, 그걸 견디는지가
 * 「읽힌다/안 읽힌다」를 가른다.
 */
function 만들기(객체들, {
  트레일러 = '', xref틀림 = false, 길이틀림 = false, 판 = '1.4',
  사이 = ' ', 짧은줄 = false, 증분 = [],
} = {}) {
  const 조각 = [Buffer.from(`%PDF-${판}\n%\xe2\xe3\xcf\xd3\n`, 'latin1')];
  let 길이 = 조각[0].length;
  const 자리표 = new Map();
  for (const o of 객체들) {
    자리표.set(o.번호, 길이);
    let 몸;
    if (o.흐름 !== undefined) {
      const L = 길이틀림 ? o.흐름.length + 13 : o.흐름.length;
      몸 = Buffer.concat([
        Buffer.from(`${o.번호} 0${사이}obj\n<< ${o.사전 ?? ''} /Length ${L} >>\nstream\n`, 'latin1'),
        o.흐름,
        Buffer.from('\nendstream\nendobj\n', 'latin1'),
      ]);
    } else {
      몸 = Buffer.from(`${o.번호} 0${사이}obj\n${o.글}\nendobj\n`, 'latin1');
    }
    조각.push(몸); 길이 += 몸.length;
  }
  const xref자리 = 길이;
  const 최대 = Math.max(...객체들.map((o) => o.번호));
  const 꼬리 = 짧은줄 ? '' : ' ';                 // 줄을 19자로 쓰는 프로그램이 있다
  const 줄 = ['xref', `0 ${최대 + 1}`, `0000000000 65535 f${꼬리}`];
  for (let n = 1; n <= 최대; n += 1) {
    const off = xref틀림 ? 7 : (자리표.get(n) ?? 0);
    줄.push(`${String(off).padStart(10, '0')} 00000 ${자리표.has(n) ? 'n' : 'f'}${꼬리}`);
  }
  줄.push('trailer', `<< /Size ${최대 + 1} /Root 1 0 R ${트레일러} >>`, 'startxref', String(xref자리), '%%EOF');
  const 표 = Buffer.from(`${줄.join('\n')}\n`, 'latin1');
  조각.push(표); 길이 += 표.length;

  /*
   * 증분 저장 — 고친 객체를 **파일 뒤에 덧붙이고** 새 xref 가 옛 xref 를
   * /Prev 로 가리킨다. 폼을 채워 저장하거나 주석을 달면 실제로 이 꼴이 된다.
   * 옛 객체는 파일 안에 그대로 남아 있다.
   */
  if (증분.length) {
    let 덧 = '';
    const 덧자리 = [];
    for (const o of 증분) {
      덧자리.push([o.번호, 길이 + 덧.length]);
      덧 += o.흐름 !== undefined
        ? `${o.번호} 0 obj\n<< /Length ${o.흐름.length} >>\nstream\n${o.흐름.toString('latin1')}\nendstream\nendobj\n`
        : `${o.번호} 0 obj\n${o.글}\nendobj\n`;
    }
    let 둘째 = `xref\n0 1\n0000000000 65535 f \n`;
    for (const [번호, off] of 덧자리) 둘째 += `${번호} 1\n${String(off).padStart(10, '0')} 00000 n \n`;
    둘째 += `trailer\n<< /Size ${최대 + 1} /Root 1 0 R /Prev ${xref자리} >>\n`
      + `startxref\n${길이 + 덧.length}\n%%EOF\n`;
    조각.push(Buffer.from(덧 + 둘째, 'latin1'));
  }
  return Buffer.concat(조각);
}

/** 흔한 뼈대 — 카탈로그 · 쪽나무 · 쪽 하나. */
function 한쪽짜리({ 내용, 자원 = '/Font << /F1 5 0 R >>', 글꼴 = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 더 = [], 옵션 = {} }) {
  return 만들기([
    { 번호: 1, 글: '<< /Type /Catalog /Pages 2 0 R >>' },
    { 번호: 2, 글: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { 번호: 3, 글: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${자원} >> /Contents 4 0 R >>` },
    { 번호: 4, ...(Buffer.isBuffer(내용) ? { 흐름: 내용, 사전: 옵션.사전4 ?? '' } : { 글: 내용 }) },
    { 번호: 5, 글: 글꼴 },
    ...더,
  ], 옵션);
}

const 흐름으로 = (글) => Buffer.from(글, 'latin1');
const 글만 = (r) => toText(r).text.replace(/^--- .*? ---\n?/gm, '').trim();

// ── 1. 아주 단순한 것부터 ──────────────────────────────────────────────
trace('1-단순');
{
  const b = 한쪽짜리({ 내용: 흐름으로('BT /F1 12 Tf 72 720 Td (Hello, world!) Tj 0 -14 Td (Second line) Tj ET') });
  const r = readPdf(b);
  check('읽힌다', r.ok === true, r.error);
  check('쪽수를 센다', r.쪽수 === 1, String(r.쪽수));
  check('글이 나온다', 글만(r) === 'Hello, world!\nSecond line', JSON.stringify(글만(r)));
  check('줄이 나뉜다 (Td 로 내려가면)', toText(r).text.split('\n').length === 3, JSON.stringify(toText(r).text));
  check('못 읽은 쪽이 없다', r.못읽은쪽.length === 0, JSON.stringify(r.못읽은쪽));
  check('요약이 쪽수를 말한다', summarize(r) === 'pdf · 1쪽', summarize(r));
  check('못읽은말은 빈 글', 못읽은말(r) === '');
  check('판을 읽는다', r.판 === '1.4', r.판);
}

// ── 2. 압축된 내용 (거의 모든 PDF 가 이렇다) ───────────────────────────
trace('2-압축');
{
  const 속 = deflateSync(Buffer.from('BT /F1 12 Tf 72 720 Td (Compressed text) Tj ET', 'latin1'));
  const b = 한쪽짜리({ 내용: 속, 옵션: { 사전4: '/Filter /FlateDecode' } });
  const r = readPdf(b);
  check('Flate 로 눌린 내용을 푼다', r.ok && 글만(r) === 'Compressed text', r.ok ? 글만(r) : r.error);
}

// ── 3. 한글 — Identity-H 와 /ToUnicode ────────────────────────────────
trace('3-한글');
{
  // 두 바이트 글리프 번호 0001·0002·0003 을 '한'·'글'·' ' 로 되돌리는 표.
  const 표 = `/CIDInit /ProcSet findresource begin
1 begincodespacerange <0000> <FFFF> endcodespacerange
3 beginbfchar
<0001> <D55C>
<0002> <AE00>
<0003> <0020>
endbfchar
end`;
  const 글꼴 = '<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /Identity-H '
    + '/DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Test /DW 1000 >>] /ToUnicode 6 0 R >>';
  const b = 한쪽짜리({
    내용: 흐름으로('BT /F1 12 Tf 72 720 Td <000100020003000100020002> Tj ET'),
    글꼴,
    더: [{ 번호: 6, 흐름: 흐름으로(표) }],
  });
  const r = readPdf(b);
  check('Identity-H 한글을 되돌린다', r.ok && 글만(r) === '한글 한글글', r.ok ? JSON.stringify(글만(r)) : r.error);
  check('그때는 못 읽은 쪽이 없다', r.못읽은쪽.length === 0, JSON.stringify(r.못읽은쪽));
}

// ── 4. ★ /ToUnicode 가 없으면 — 못 읽었다고 한다 ──────────────────────
trace('4-표없음');
{
  const 글꼴 = '<< /Type /Font /Subtype /Type0 /BaseFont /없는것 /Encoding /Identity-H '
    + '/DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /BaseFont /없는것 /DW 1000 >>] >>';
  const b = 한쪽짜리({ 내용: 흐름으로('BT /F1 12 Tf 72 720 Td <00010002> Tj ET'), 글꼴 });
  const r = readPdf(b);
  check('★ 빈 글을 그냥 돌려주지 않는다', r.ok && r.못읽은쪽.length === 1, JSON.stringify(r.못읽은쪽));
  check('★ 왜 못 읽었는지 말한다', /ToUnicode/.test(r.못읽은쪽[0]?.왜 ?? ''), r.못읽은쪽[0]?.왜);
  check('★ 글 안에도 그 자리에 적는다', /이 쪽은 글로 못 읽었습니다/.test(toText(r).text), toText(r).text);
  check('★ 요약에 못 읽은 쪽수가 뜬다', /1쪽 못 읽음/.test(summarize(r)), summarize(r));
  check('★ 「없는 것이 아니라 못 꺼낸 것」이라고 못박는다',
    /없는 것이 아니라 못 꺼낸 것/.test(못읽은말(r)), 못읽은말(r));
}

// ── 5. ★ 암호 — 지어내지 않고 길을 준다 ──────────────────────────────
trace('5-암호');
{
  const b = 한쪽짜리({
    내용: 흐름으로('BT /F1 12 Tf 72 720 Td (secret) Tj ET'),
    옵션: { 트레일러: '/Encrypt 9 0 R /ID [<01> <02>]' },
  });
  const r = readPdf(b);
  check('★ 암호가 걸리면 읽은 척하지 않는다', r.ok === false, JSON.stringify(r).slice(0, 120));
  check('★ 암호 때문이라고 말한다', /암호가 걸린/.test(r.error), r.error);
  check('★ 어떻게 하면 되는지 알려 준다', /암호 없는 사본/.test(r.error), r.error);
}

// ── 6. ★ 글 없는 쪽 (스캔본) ──────────────────────────────────────────
trace('6-스캔');
{
  const b = 한쪽짜리({
    내용: 흐름으로('q 200 0 0 200 100 500 cm /Im0 Do Q'),
    자원: '/XObject << /Im0 7 0 R >>',
    더: [{ 번호: 7, 사전: '/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8', 흐름: Buffer.from([0xff]) }],
  });
  const r = readPdf(b);
  check('★ 글 없는 쪽을 빈 글로 안 넘긴다', r.ok && r.못읽은쪽.length === 1, JSON.stringify(r.못읽은쪽));
  check('★ 스캔본일 수 있다고 짚어 준다', /스캔|OCR/.test(r.못읽은쪽[0]?.왜 ?? ''), r.못읽은쪽[0]?.왜);
}

// ── 7. ★ 못 푸는 압축 — 이름을 그대로 준다 ────────────────────────────
trace('7-못푸는압축');
{
  const b = 한쪽짜리({ 내용: Buffer.from([1, 2, 3, 4]), 옵션: { 사전4: '/Filter /LZWDecode' } });
  const r = readPdf(b);
  check('★ 못 푸는 압축이면 그 쪽을 못 읽었다고 한다', r.ok && r.못읽은쪽.length === 1, JSON.stringify(r.못읽은쪽));
  check('★ 어떤 압축인지 이름을 준다', /LZWDecode/.test(r.못읽은쪽[0]?.왜 ?? ''), r.못읽은쪽[0]?.왜);
}

// ── 7b. ★ 반만 읽은 쪽을 다 읽었다고 하지 않는다 ──────────────────────
//
// 한 쪽의 /Contents 는 흐름 **여러 개**일 수 있다. 하나가 막혀도 다른 하나가
// 살아나면 글은 나온다. 그 글은 그 쪽의 일부일 뿐인데 온전한 쪽으로 세면,
// 빠진 표·빠진 조항이 「문서에 없는 것」이 되어 그대로 답에 실린다.
// 아래 ⑫(글리프를 못 되돌린 쪽)는 이미 일부라고 적고 있었다 — 같은 정직이다.
trace('7b-반만읽음');
{
  const 여러흐름쪽 = (내용참조, 더) => 만들기([
    { 번호: 1, 글: '<< /Type /Catalog /Pages 2 0 R >>' },
    { 번호: 2, 글: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { 번호: 3, 글: `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents ${내용참조} >>` },
    { 번호: 5, 글: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    ...더,
  ]);

  // ① 흐름 둘 중 하나가 못 푸는 압축. 남은 하나로 글이 나온다.
  const r1 = readPdf(여러흐름쪽('[4 0 R 6 0 R]', [
    { 번호: 4, 흐름: 흐름으로('BT /F1 12 Tf 72 720 Td (Visible half) Tj ET') },
    { 번호: 6, 흐름: Buffer.from([1, 2, 3, 4]), 사전: '/Filter /LZWDecode' },
  ]));
  check('★ 흐름 하나가 막히면 — 살아난 글은 오고, 그 쪽은 일부라고 한다',
    /Visible half/.test(글만(r1)) && (r1.못읽은쪽 ?? []).some((x) => x.번호 === 1 && x.일부),
    `${글만(r1)} · ${JSON.stringify(r1.못읽은쪽)}`);
  check('★ 막힌 까닭(압축 이름)을 그대로 준다', /LZWDecode/.test(r1.못읽은쪽?.[0]?.왜 ?? ''), r1.못읽은쪽?.[0]?.왜);
  check('★ 본문 알림에도 일부만 읽었다고 적힌다', /일부만 읽었습니다/.test(못읽은말(r1)), 못읽은말(r1));

  // ② 없는 객체를 가리키는 흐름 — 끊긴 참조도 못 읽은 것이다.
  const r2 = readPdf(여러흐름쪽('[4 0 R 8 0 R]', [
    { 번호: 4, 흐름: 흐름으로('BT /F1 12 Tf 72 720 Td (Half of it) Tj ET') },
  ]));
  check('★ 끊긴 참조도 일부만 읽은 것으로 센다',
    (r2.못읽은쪽 ?? []).some((x) => x.번호 === 1 && x.일부 && /끊/.test(x.왜)), JSON.stringify(r2.못읽은쪽));

  // ③ 끝이 잘린 Flate. 부풀린 데까지 건지는 것은 맞다 — 건졌다고 말해야 한다.
  const 온전 = deflateSync(Buffer.from('BT /F1 12 Tf 72 720 Td (Head of page) Tj 0 -14 Td (Tail that got cut off) Tj ET', 'latin1'));
  const r3 = readPdf(한쪽짜리({ 내용: 온전.subarray(0, 온전.length - 12), 옵션: { 사전4: '/Filter /FlateDecode' } }));
  check('★ 끝이 잘린 흐름 — 앞부분은 건지고, 잘렸다고 말한다',
    /Head of page/.test(글만(r3)) && (r3.못읽은쪽 ?? []).some((x) => x.번호 === 1 && x.일부 && /잘렸/.test(x.왜)),
    `${글만(r3)} · ${JSON.stringify(r3.못읽은쪽)}`);
}

// ── 8. 깨진 파일을 견딘다 ──────────────────────────────────────────────
trace('8-깨진것');
{
  const 본문 = 'BT /F1 12 Tf 72 720 Td (Survives broken xref) Tj ET';
  const 틀린xref = 한쪽짜리({ 내용: 흐름으로(본문), 옵션: { xref틀림: true } });
  const r1 = readPdf(틀린xref);
  check('xref 자리가 다 틀려도 읽는다 (파일을 훑어서)', r1.ok && /Survives broken xref/.test(글만(r1)), r1.ok ? 글만(r1) : r1.error);

  const 틀린길이 = 한쪽짜리({ 내용: 흐름으로(본문), 옵션: { 길이틀림: true } });
  const r2 = readPdf(틀린길이);
  check('/Length 가 틀려도 읽는다 (endstream 을 찾아서)', r2.ok && /Survives broken xref/.test(글만(r2)), r2.ok ? 글만(r2) : r2.error);

  // startxref 자체가 없는 것 (덧붙이다 잘린 파일).
  const 잘린것 = Buffer.from(틀린xref.toString('latin1').replace(/startxref[\s\S]*$/, ''), 'latin1');
  const r3 = readPdf(잘린것);
  check('startxref 가 없어도 카탈로그를 찾아 읽는다', r3.ok && /Survives broken xref/.test(글만(r3)), r3.ok ? 글만(r3) : r3.error);

  // 쪽 나무가 없는 것 — /Type /Page 를 주워서라도 읽는다.
  const 나무없음 = 만들기([
    { 번호: 1, 글: '<< /Type /Catalog >>' },
    { 번호: 3, 글: '<< /Type /Page /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>' },
    { 번호: 4, 흐름: 흐름으로('BT /F1 12 Tf 72 720 Td (Orphan page) Tj ET') },
    { 번호: 5, 글: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
  ]);
  const r4 = readPdf(나무없음);
  check('쪽 나무가 깨져도 쪽을 주워 읽는다', r4.ok && /Orphan page/.test(글만(r4)), r4.ok ? 글만(r4) : r4.error);

  /*
   * ★ 주워서 세운 차례는 문서의 차례가 아니다.
   *
   * 주울 때 쓸 수 있는 것은 객체 번호뿐인데, 그건 쪽 차례와 상관이 없다 —
   * 선형화한 파일은 첫 쪽을 맨 뒤 번호로 두고, 덧붙여 저장하면 고친 쪽만 큰
   * 번호로 붙는다. 그런데 나가는 글에는 「N쪽」 이라는 또렷한 번호가 찍힌다.
   * 못 믿는다고 같이 말하지 않으면 그 번호가 그대로 답의 근거가 된다.
   */
  check('★ 쪽을 주워 왔으면 차례를 못 믿는다고 말한다', r4.쪽차례모름 === true, JSON.stringify(r4.쪽차례모름));
  check('★ 주운 차례가 요약에 뜬다', /쪽 차례 확인 못 함/.test(summarize(r4)), summarize(r4));
  check('★ 주운 차례를 본문 알림에도 적는다 (못 읽은 쪽이 하나도 없어도)',
    /차례가 아닐 수 있습니다/.test(못읽은말(r4)), JSON.stringify(못읽은말(r4)));

  /*
   * ★★★ 쪽 나무가 **반만** 걸린 판 (막판 훑기).
   *
   * 위 갈래는 나무를 **하나도** 못 걸었을 때만 선다. /Kids 셋 중 둘이 끊긴 파일
   * (덧붙여 저장하다 끊긴 계약서·서명 PDF 에 흔하다)에서는 한 쪽만 건지고도
   * 못읽은쪽 0 · 「pdf · 1쪽」 으로 올라갔다. 문서가 **제 입으로 3쪽이라고 적어**
   * 두었는데(/Count) 그 숫자를 아무 데서도 안 봤다. 나머지 두 쪽은 「없는 것」 이
   * 되고, 모델은 한 쪽으로 문서 전체를 판단한다 — 이 파일이 예순 줄에 걸쳐
   * 경계하는 바로 그 고장이다.
   */
  const 반쪽나무 = 만들기([
    { 번호: 1, 글: '<< /Type /Catalog /Pages 2 0 R >>' },
    { 번호: 2, 글: '<< /Type /Pages /Kids [3 0 R 7 0 R 8 0 R] /Count 3 >>' },
    { 번호: 3, 글: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>' },
    { 번호: 4, 흐름: 흐름으로('BT /F1 12 Tf 72 720 Td (FIRST PAGE ONLY) Tj ET') },
    { 번호: 5, 글: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
  ]);
  const r5 = readPdf(반쪽나무);
  check('★★★ 문서가 적어 둔 쪽 수보다 적게 건지면 그렇다고 말한다 — 요약에',
    r5.ok && /못 건/.test(summarize(r5)), r5.ok ? summarize(r5) : r5.error);
  check('★★★ 본문 알림에도 몇 쪽이 빠졌는지 적는다',
    /3쪽[\s\S]*못 건|못 건[\s\S]*2쪽/.test(못읽은말(r5)), JSON.stringify(못읽은말(r5)));
  // 멀쩡한 문서에는 이 말이 안 붙는다 — 거짓 경고면 안 하느니만 못하다.
  const 멀쩡한것 = readPdf(한쪽짜리({ 내용: 'BT /F1 12 Tf 72 720 Td (Fine) Tj ET' }));
  check('  (짝) /Count 와 맞으면 아무 말도 안 붙는다',
    !/못 건/.test(summarize(멀쩡한것)) && !/못 건/.test(못읽은말(멀쩡한것)),
    `${summarize(멀쩡한것)} | ${못읽은말(멀쩡한것)}`);
}

// ── 8b. ★ PDF 1.5 — xref 흐름과 객체 흐름 ─────────────────────────────
trace('8b-xref흐름');
{
  /*
   * 요즘 PDF 는 대개 이 꼴이다 (워드·리브레오피스·관공서 문서).
   * xref 가 표가 아니라 **눌린 흐름**이고, 사전 객체들은 ObjStm 안에 모여
   * 한꺼번에 눌려 있다. 이걸 못 읽으면 「요즘 PDF 는 다 안 읽히는」 물건이 된다.
   */
  const 속객체 = [
    { 번호: 1, 글: '<< /Type /Catalog /Pages 2 0 R >>' },
    { 번호: 2, 글: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { 번호: 3, 글: '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>' },
    { 번호: 5, 글: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
  ];
  // ObjStm: 앞에 「번호 자리」 짝이 늘어서고, 그 뒤에 몸통이 붙는다.
  let 몸 = '';
  const 머리조각 = [];
  for (const o of 속객체) { 머리조각.push(`${o.번호} ${몸.length}`); 몸 += `${o.글} `; }
  const 머리 = `${머리조각.join(' ')} `;
  const objstm속 = deflateSync(Buffer.from(머리 + 몸, 'latin1'));

  const 내용 = deflateSync(Buffer.from('BT /F1 12 Tf 72 720 Td (Modern PDF) Tj ET', 'latin1'));

  // 자리를 직접 셈해 가며 파일을 짓는다.
  const 조각 = [Buffer.from('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let 길이 = 조각[0].length;
  const 자리 = {};
  const 넣기 = (번호, buf) => { 자리[번호] = 길이; 조각.push(buf); 길이 += buf.length; };
  넣기(4, Buffer.concat([
    Buffer.from(`4 0 obj\n<< /Filter /FlateDecode /Length ${내용.length} >>\nstream\n`, 'latin1'),
    내용, Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ]));
  넣기(6, Buffer.concat([
    Buffer.from(`6 0 obj\n<< /Type /ObjStm /N ${속객체.length} /First ${머리.length} /Filter /FlateDecode /Length ${objstm속.length} >>\nstream\n`, 'latin1'),
    objstm속, Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ]));

  const xref자리 = 길이;
  // W [1 2 1] — 갈래 1바이트 · 값 2바이트 · 값 1바이트
  const 칸 = [];
  const 넣칸 = (t, a, b) => 칸.push(t & 0xff, (a >> 8) & 0xff, a & 0xff, b & 0xff);
  넣칸(0, 0, 255);                 // 0번
  넣칸(2, 6, 0);                   // 1번 — 6번 묶음의 0째
  넣칸(2, 6, 1);
  넣칸(2, 6, 2);
  넣칸(1, 자리[4], 0);              // 4번 — 낱개
  넣칸(2, 6, 3);                   // 5번
  넣칸(1, 자리[6], 0);              // 6번
  넣칸(1, xref자리, 0);             // 7번 — 저 자신
  const xref속 = deflateSync(Buffer.from(칸));
  조각.push(Buffer.concat([
    Buffer.from(`7 0 obj\n<< /Type /XRef /Size 8 /W [1 2 1] /Root 1 0 R /Filter /FlateDecode /Length ${xref속.length} >>\nstream\n`, 'latin1'),
    xref속,
    Buffer.from(`\nendstream\nendobj\nstartxref\n${xref자리}\n%%EOF\n`, 'latin1'),
  ]));
  const b = Buffer.concat(조각);

  const r = readPdf(b);
  check('★ xref 흐름 + 객체 흐름(PDF 1.5)을 읽는다', r.ok && /Modern PDF/.test(글만(r)), r.ok ? JSON.stringify(글만(r)) : r.error);
  check('그때도 쪽수를 센다', r.쪽수 === 1, String(r.쪽수));
  check('판을 1.5 로 읽는다', r.판 === '1.5', r.판);

  // 낱개로는 어디에도 없는 객체다 — 묶음을 안 펼치면 못 찾는다.
  check('묶음 안의 객체는 파일에 낱개로 없다', !b.toString('latin1').includes('/Type /Catalog'), '카탈로그가 그냥 보입니다');
}

// ── 9. 여러 쪽 · 순서 ──────────────────────────────────────────────────
trace('9-여러쪽');
{
  const 쪽들 = [1, 2, 3];
  const 객체 = [
    { 번호: 1, 글: '<< /Type /Catalog /Pages 2 0 R >>' },
    { 번호: 2, 글: `<< /Type /Pages /Kids [${쪽들.map((n) => `${10 + n} 0 R`).join(' ')}] /Count 3 >>` },
    { 번호: 5, 글: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
  ];
  for (const n of 쪽들) {
    객체.push({ 번호: 10 + n, 글: `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /Contents ${20 + n} 0 R >>` });
    객체.push({ 번호: 20 + n, 흐름: 흐름으로(`BT /F1 12 Tf 72 720 Td (Page ${n} body) Tj ET`) });
  }
  const r = readPdf(만들기(객체));
  check('세 쪽을 다 읽는다', r.ok && r.쪽수 === 3, String(r.쪽수));
  check('쪽 순서가 맞다', 글만(r) === 'Page 1 body\nPage 2 body\nPage 3 body', JSON.stringify(글만(r)));
  check('쪽마다 이름표가 붙는다', /--- 1쪽 ---[\s\S]*--- 3쪽 ---/.test(toText(r).text), toText(r).text.slice(0, 60));

  // 가운데 쪽만 못 읽으면 — 그 자리에 적혀야 한다. 끝에 몰아 적으면
  // 모델이 3쪽 내용을 2쪽 것으로 쓴다.
  const 객체2 = 객체.map((o) => (o.번호 === 22 ? { 번호: 22, 흐름: Buffer.from([9, 9]), 사전: '/Filter /LZWDecode' } : o));
  const r2 = readPdf(만들기(객체2));
  const 줄들 = toText(r2).text.split('\n');
  const i못 = 줄들.findIndex((l) => /못 읽었습니다/.test(l));
  check('못 읽은 쪽은 그 자리에 적는다',
    줄들[i못 - 1] === '--- 2쪽 ---' && 줄들[i못 + 1] === '--- 3쪽 ---',
    JSON.stringify(줄들));
  check('못 읽은 쪽 번호를 말한다', /\(2쪽\)/.test(못읽은말(r2)), 못읽은말(r2));
}

// ── 10. 걸개들 ─────────────────────────────────────────────────────────
trace('10-걸개');
{
  const 본문 = 'BT /F1 12 Tf 72 720 Td (Filtered) Tj ET';
  const 열여섯 = Buffer.from(`${Buffer.from(본문, 'latin1').toString('hex')}>`, 'latin1');
  const r1 = readPdf(한쪽짜리({ 내용: 열여섯, 옵션: { 사전4: '/Filter /ASCIIHexDecode' } }));
  check('ASCIIHexDecode 를 푼다', r1.ok && /Filtered/.test(글만(r1)), r1.ok ? 글만(r1) : r1.error);

  // 되풀이 압축: [길이-1][바이트…] · 128 은 끝
  const 조각 = Buffer.from(본문, 'latin1');
  const 되풀이 = Buffer.concat([Buffer.from([조각.length - 1]), 조각, Buffer.from([128])]);
  const r2 = readPdf(한쪽짜리({ 내용: 되풀이, 옵션: { 사전4: '/Filter /RunLengthDecode' } }));
  check('RunLengthDecode 를 푼다', r2.ok && /Filtered/.test(글만(r2)), r2.ok ? 글만(r2) : r2.error);

  // 걸개 두 겹 (Flate 위에 ASCIIHex) — 실제로 쓰이는 조합이다.
  const 두겹 = Buffer.from(`${deflateSync(Buffer.from(본문, 'latin1')).toString('hex')}>`, 'latin1');
  const r3 = readPdf(한쪽짜리({ 내용: 두겹, 옵션: { 사전4: '/Filter [/ASCIIHexDecode /FlateDecode]' } }));
  check('걸개가 두 겹이어도 차례로 푼다', r3.ok && /Filtered/.test(글만(r3)), r3.ok ? 글만(r3) : r3.error);
}

// ── 11. 낱말 사이 빈칸 ─────────────────────────────────────────────────
trace('11-빈칸');
{
  // TJ 의 큰 음수는 낱말 사이를 벌린 것 — 빈칸으로 읽어야 한다.
  const r = readPdf(한쪽짜리({ 내용: 흐름으로('BT /F1 12 Tf 72 720 Td [(Hello)-400(world)] TJ ET') }));
  check('TJ 의 큰 음수는 빈칸이 된다', r.ok && 글만(r) === 'Hello world', r.ok ? JSON.stringify(글만(r)) : r.error);

  // 작은 음수는 글자 사이 미세 조정이다 — 빈칸이 아니다.
  const r2 = readPdf(한쪽짜리({ 내용: 흐름으로('BT /F1 12 Tf 72 720 Td [(Hel)-20(lo)] TJ ET') }));
  check('작은 음수는 빈칸이 아니다', r2.ok && 글만(r2) === 'Hello', r2.ok ? JSON.stringify(글만(r2)) : r2.error);

  /*
   * 빈칸을 글자로 안 찍고 **자리만 옮겨** 만드는 PDF 가 많다(TeX·인디자인).
   * 그때 「낱말이 끝났나」를 가르는 잣대는 글꼴에 적힌 글자 너비뿐이다.
   * 어림으로 때우면 넓은 글꼴에서는 없는 빈칸이 생기고, 좁은 글꼴에서는
   * 있는 빈칸이 사라진다. 아래 두 줄이 그 둘을 각각 잡는다.
   */
  const 넓은글꼴 = '<< /Type /Font /Subtype /Type1 /BaseFont /Wide /FirstChar 65 /LastChar 68 /Widths [1000 1000 1000 1000] >>';
  const r3 = readPdf(한쪽짜리({
    내용: 흐름으로('BT /F1 10 Tf 72 720 Td (AB) Tj 20 0 Td (CD) Tj ET'),
    글꼴: 넓은글꼴,
  }));
  check('넓은 글꼴: 글자 너비만큼 옮긴 것은 빈칸이 아니다',
    r3.ok && 글만(r3) === 'ABCD', r3.ok ? JSON.stringify(글만(r3)) : r3.error);

  const 좁은글꼴 = '<< /Type /Font /Subtype /Type1 /BaseFont /Narrow /FirstChar 65 /LastChar 68 /Widths [250 250 250 250] >>';
  const r4 = readPdf(한쪽짜리({
    내용: 흐름으로('BT /F1 10 Tf 72 720 Td (AB) Tj 9 0 Td (CD) Tj ET'),
    글꼴: 좁은글꼴,
  }));
  check('좁은 글꼴: 글자 너비보다 더 벌어진 것은 빈칸이다',
    r4.ok && 글만(r4) === 'AB CD', r4.ok ? JSON.stringify(글만(r4)) : r4.error);
}

// ── 12. 폼 XObject 안의 글 ────────────────────────────────────────────
trace('12-폼');
{
  const b = 한쪽짜리({
    내용: 흐름으로('BT /F1 12 Tf 72 720 Td (Outer) Tj ET\nq /Fm0 Do Q'),
    자원: '/Font << /F1 5 0 R >> /XObject << /Fm0 8 0 R >>',
    더: [{
      번호: 8,
      사전: '/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /Font << /F1 5 0 R >> >>',
      흐름: 흐름으로('BT /F1 12 Tf 10 10 Td (Inside form) Tj ET'),
    }],
  });
  const r = readPdf(b);
  check('폼 안에 든 글도 읽는다', r.ok && /Outer/.test(글만(r)) && /Inside form/.test(글만(r)), r.ok ? JSON.stringify(글만(r)) : r.error);
}

// ── 13. /ToUnicode 표 읽기 (낱개) ─────────────────────────────────────
trace('13-표읽기');
{
  const a = 유니코드표읽기('1 beginbfchar <0041> <0061> endbfchar');
  check('bfchar 를 읽는다', a.표.get(0x41) === 'a', JSON.stringify([...a.표]));
  check('코드 폭을 안다 (두 바이트)', a.폭 === 2, String(a.폭));

  const b = 유니코드표읽기('1 beginbfrange <0020> <0022> <0041> endbfrange');
  check('bfrange(첫 글자 꼴)를 편다', b.표.get(0x20) === 'A' && b.표.get(0x22) === 'C', JSON.stringify([...b.표]));

  const c = 유니코드표읽기('1 beginbfrange <0030> <0031> [<D55C> <AE00>] endbfrange');
  check('bfrange(배열 꼴)도 읽는다', c.표.get(0x30) === '한' && c.표.get(0x31) === '글', JSON.stringify([...c.표]));

  const d = 유니코드표읽기('1 beginbfchar <01> <D55CAE00> endbfchar');
  check('한 코드가 두 글자로 풀리는 것도 읽는다', d.표.get(1) === '한글', JSON.stringify([...d.표]));
  check('한 바이트 코드폭도 안다', d.폭 === 1, String(d.폭));

  check('빈 표는 빈 표', 유니코드표읽기('').표.size === 0);
  check('쓰레기를 넣어도 안 터진다', 유니코드표읽기('beginbfchar <ZZ> endbfchar').표.size === 0);
}

// ── 14. 아닌 것들 ──────────────────────────────────────────────────────
trace('14-아닌것');
{
  check('PDF 아니면 아니라고 한다', readPdf(Buffer.from('그냥 글입니다')).error?.includes('PDF 가 아닙니다'), readPdf(Buffer.from('x')).error);
  check('빈 것도 안 터진다', readPdf(Buffer.alloc(0)).ok === false);
  check('머리만 있고 속이 없으면 쪽을 못 찾았다고 한다',
    /쪽을 못 찾았습니다/.test(readPdf(Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1')).error ?? ''),
    readPdf(Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1')).error);
  check('isPdfPath 는 확장자로 본다', isPdfPath('a.pdf') && isPdfPath('A.PDF') && !isPdfPath('a.docx') && !isPdfPath(null));
  check('looksPdf 는 속으로 본다', looksPdf(Buffer.from('%PDF-1.7\n')) && !looksPdf(Buffer.from('PK\x03\x04')));
  check('흐름풀기에 흐름 아닌 것을 주면 그렇다고 한다', 흐름풀기(null, (x) => x).ok === false);
  check('없는 파일은 못 읽었다고 한다', readPdf(join(root, '없다.pdf')).ok === false);
}

// ── 15. 자르기 ─────────────────────────────────────────────────────────
trace('15-자르기');
{
  const 긴글 = Array.from({ length: 200 }, (_, i) => `(줄 ${i} 아주 긴 내용이 여기 들어갑니다) Tj 0 -14 Td`).join(' ');
  const r = readPdf(한쪽짜리({ 내용: 흐름으로(`BT /F1 12 Tf 72 720 Td ${긴글} ET`) }));
  const 자른것 = toText(r, { maxChars: 200 });
  check('길면 자른다', 자른것.text.length < 400, String(자른것.text.length));
  check('자르면 잘랐다고 말한다', 자른것.잘림.length === 1 && /잘랐습니다/.test(자른것.잘림[0]), JSON.stringify(자른것.잘림));
  check('안 길면 군말이 없다', toText(r).잘림.length === 0);
}

// ── 16. ★ 진짜 크롬이 뽑은 PDF ────────────────────────────────────────
trace('16-진짜');
{
  const 진짜 = join(여기, '자료', '진짜-크롬.pdf');
  if (existsSync(진짜)) {
    const r = readPdf(진짜);
    check('★ 진짜 PDF 가 읽힌다', r.ok === true, r.error);
    const t = 글만(r);
    /*
     * 크롬은 글자 하나마다 Td 로 옮기고 Tj 로 찍는다. 그 이동을 「낱말 사이
     * 틈」으로 잘못 보면 「결제」가 「결 제」가 된다. 손으로 만든 본보기에는
     * 그 함정이 없어서, 이 줄이 그것을 지키는 유일한 자리다.
     */
    check('★ 한글이 글자마다 벌어지지 않는다', /결제 한도는 1,000,000원입니다\./.test(t), JSON.stringify(t));
    check('★ 영문 낱말이 쪼개지지 않는다', /The quick brown fox jumps over the lazy dog\./.test(t), JSON.stringify(t));
    check('★ 없는 빈칸을 지어내지 않는다', !/[가-힣] [가-힣]{1}(?![가-힣])/.test(t.replace(/한도는 /, '')), JSON.stringify(t));
    check('★ 못 읽은 쪽이 없다', r.못읽은쪽.length === 0, JSON.stringify(r.못읽은쪽));
  } else {
    check('진짜 PDF 본보기가 있다', false, `없습니다: ${진짜}`);
  }

  const 그림만 = join(여기, '자료', '진짜-그림만.pdf');
  if (existsSync(그림만)) {
    const r = readPdf(그림만);
    check('★ 진짜 그림만 든 쪽을 못 읽었다고 한다', r.ok && r.못읽은쪽.length === 1, JSON.stringify(r.못읽은쪽));
    check('★ 그때 OCR 을 짚어 준다', /OCR/.test(r.못읽은쪽[0]?.왜 ?? ''), r.못읽은쪽[0]?.왜);
    check('★ 요약에도 드러난다', /못 읽음/.test(summarize(r)), summarize(r));
  } else {
    check('진짜 그림 PDF 본보기가 있다', false, `없습니다: ${그림만}`);
  }
}

// ── 17. 도구에 붙었나 ──────────────────────────────────────────────────
trace('17-도구');
{
  const 파일 = join(root, '명세.pdf');
  writeFileSync(파일, 한쪽짜리({ 내용: 흐름으로('BT /F1 12 Tf 72 720 Td (Tool level) Tj ET') }));
  const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };

  const r = await TOOLS.Read.run({ file_path: '명세.pdf' }, ctx);
  check('Read 가 PDF 를 글로 준다', /Tool level/.test(String(r.content)), String(r.content).slice(0, 80));
  check('Read 요약이 pdf 라고 말한다', /pdf/.test(String(r.summary)), String(r.summary));
  check('고칠 수 없다고 미리 적어 준다', /Edit\/Write 로 고칠 수 없습니다/.test(String(r.content)), String(r.content).slice(-120));

  // 읽었다고 고칠 수 있게 되면 안 된다 — 여기가 원본이 죽는 자리다.
  check('읽어도 seen 에 안 들어간다', !ctx.seen.has(파일), [...ctx.seen].join(' '));
  const e = TOOLS.Edit.run({ file_path: '명세.pdf', old_string: 'Tool', new_string: 'X' }, ctx);
  check('Edit 을 또렷하게 거절한다', /PDF 는 이 도구로 고칠 수 없습니다/.test(e.error ?? ''), e.error);
  check('거절이 길을 같이 준다', /새 파일에 쓰세요/.test(e.error ?? ''), e.error);
  const 앞 = readFileSync(파일);
  const w = TOOLS.Write.run({ file_path: '명세.pdf', content: '망가뜨리기' }, ctx);
  check('Write 도 거절한다', /고칠 수 없습니다/.test(w.error ?? ''), w.error);
  check('거절 뒤에도 원본이 그대로다', Buffer.compare(앞, readFileSync(파일)) === 0);
  check('못고침 안내가 파일 이름을 담는다', /명세\.pdf/.test(pdf는못고침('명세.pdf')), pdf는못고침('명세.pdf'));
}

// ── 18. ★ 못 읽는 것이 아니라 「다른 것이」 읽히던 자리들 ──────────────
trace('18-다른것');
{
  /*
   * 여기 모인 것은 못 읽는 결함이 아니다. **다른 것이 읽히는** 결함이다.
   *
   * 못 읽으면 화면에 「이 쪽은 글로 못 읽었습니다」가 뜬다. 그런데 고치기 전
   * 값, 엉뚱한 한자, 사라진 뒷부분은 아무 말 없이 지나간다 — 글이 그럴듯하게
   * 나오니 사람도 모델도 볼 길이 없다. 그래서 이 절은 전부 「무엇이 나왔나」
   * 를 글자까지 맞춘다.
   */

  // ① 증분 저장 — 폼을 채우고 저장하면 옛 객체가 파일에 그대로 남는다.
  {
    const 뼈대 = (글) => [
      { 번호: 1, 글: '<< /Type /Catalog /Pages 2 0 R >>' },
      { 번호: 2, 글: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      { 번호: 3, 글: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>' },
      { 번호: 4, 흐름: 흐름으로(`BT /F1 12 Tf 72 700 Td (${글}) Tj ET`) },
      { 번호: 5, 글: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    ];
    const b = 만들기(뼈대('OLD price 1000'), {
      증분: [{ 번호: 4, 흐름: 흐름으로('BT /F1 12 Tf 72 700 Td (NEW price 2000) Tj ET') }],
    });
    const t = 글만(readPdf(b));
    check('★ 증분 저장한 PDF 가 고친 값을 읽는다', /NEW price 2000/.test(t), JSON.stringify(t));
    check('★ 그때 옛 값이 섞이지 않는다', !/OLD/.test(t), JSON.stringify(t));
  }

  // ② 객체 머리에 줄바꿈이 낀 파일 — xref 까지 틀리면 훑기가 마지막 안전망이다.
  for (const [이름, 사이] of [['줄바꿈', '\r\n'], ['빈칸 두 칸', '  ']]) {
    const b = 한쪽짜리({
      내용: 흐름으로('BT /F1 12 Tf 72 700 Td (Scanned in) Tj ET'),
      옵션: { 사이, xref틀림: true },
    });
    const r = readPdf(b);
    check(`★ 머리에 ${이름}이 끼고 xref 도 틀린 파일을 읽는다`,
      r.ok && /Scanned in/.test(글만(r)), r.ok ? JSON.stringify(글만(r)) : r.error);
  }

  // ③ xref 줄이 19자인 파일 — 표를 잃으면 trailer 도 같이 잃는다.
  {
    const b = 한쪽짜리({
      내용: 흐름으로('BT /F1 12 Tf 72 700 Td (Secret) Tj ET'),
      옵션: { 짧은줄: true, 트레일러: '/Encrypt 9 0 R' },
    });
    const r = readPdf(b);
    check('★ 19자 xref 줄에서도 trailer 를 읽는다 (암호를 놓치지 않는다)',
      r.ok === false && /암호가 걸린/.test(r.error ?? ''), r.ok ? JSON.stringify(글만(r)) : r.error);
  }

  // ③b xref 줄이 19자이고, 글 속에 PDF 문법이 적힌 문서.
  {
    /*
     * 「3 0 obj」 라는 글자가 본문에 실린 문서(PDF 규격을 설명하는 문서가
     * 그렇다)는 훑기가 그 자리를 객체 3 으로 잘못 짚는다. 뒤에 나온 것이
     * 이기기 때문이다. 그때 제자리를 아는 것은 xref 표 하나뿐이다 — 표를
     * 한 줄이라도 잃으면 쪽이 통째로 사라진다.
     */
    const b = 한쪽짜리({
      내용: 흐름으로('BT /F1 12 Tf 72 700 Td (A header looks like 3 0 obj in the file) Tj ET'),
      옵션: { 짧은줄: true },
    });
    const r = readPdf(b);
    check('★ 19자 xref 표가 본문 속 가짜 머리를 바로잡는다',
      r.ok && /A header looks like/.test(글만(r)), r.ok ? JSON.stringify(글만(r)) : r.error);
  }

  // ③c 눌린 PDF(ObjStm)를 고쳐 저장한 꼴 — 고친 객체만 낱개로 덧붙는다.
  {
    /*
     * 요즘 PDF 는 사전들이 ObjStm 안에 눌려 있다. 그걸 고쳐 저장하면 고친
     * 객체만 **낱개로** 뒤에 붙고 옛 묶음은 파일에 그대로 남는다. 자리만
     * 최신으로 지켜 놓고 묶음 쪽을 안 지키면, 묶음을 먼저 보는 탓에 **고치기
     * 전 값**을 읽는다 — 자리를 지킨 것이 반쪽만 고친 것이 된다.
     */
    const 쪽사전 = (내용번호) => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
      + `/Resources << /Font << /F1 5 0 R >> >> /Contents ${내용번호} 0 R >>`;
    // 고칠 객체(쪽 사전 3)가 **묶음 안에** 들어 있는 꼴이다. 주석을 달거나
    // 내용을 갈아 끼우면 그 쪽 사전이 낱개로 다시 붙는다.
    const 속객체 = [
      { 번호: 1, 글: '<< /Type /Catalog /Pages 2 0 R >>' },
      { 번호: 2, 글: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      { 번호: 3, 글: 쪽사전(4) },
      { 번호: 5, 글: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    ];
    let 몸 = '';
    const 머리조각 = [];
    for (const o of 속객체) { 머리조각.push(`${o.번호} ${몸.length}`); 몸 += `${o.글} `; }
    const 머리 = `${머리조각.join(' ')} `;
    const objstm = deflateSync(Buffer.from(머리 + 몸, 'latin1'));
    const 옛내용 = 흐름으로('BT /F1 12 Tf 72 700 Td (OLD in objstm) Tj ET');
    const 새내용 = 흐름으로('BT /F1 12 Tf 72 700 Td (NEW loose object) Tj ET');

    const 조각 = [Buffer.from('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let 길이 = 조각[0].length;
    const 자리 = {};
    const 넣기 = (번호, buf) => { 자리[번호] = 길이; 조각.push(buf); 길이 += buf.length; };
    const 붙이기 = (s) => { const b2 = Buffer.from(s, 'latin1'); 조각.push(b2); 길이 += b2.length; };
    const 흐름객체 = (번호, 사전, 몸통) => Buffer.concat([
      Buffer.from(`${번호} 0 obj\n<< ${사전} /Length ${몸통.length} >>\nstream\n`, 'latin1'),
      몸통, Buffer.from('\nendstream\nendobj\n', 'latin1'),
    ]);
    // xref 흐름 한 줄: [갈래 1바이트][자리 4바이트][곁 2바이트]
    const xref줄 = (갈래, a, b2) => {
      const buf = Buffer.alloc(7);
      buf[0] = 갈래; buf.writeUInt32BE(a, 1); buf.writeUInt16BE(b2, 5);
      return buf;
    };

    넣기(4, 흐름객체(4, '', 옛내용));
    넣기(6, 흐름객체(6, `/Type /ObjStm /N ${속객체.length} /First ${머리.length} /Filter /FlateDecode`, objstm));
    const 첫xref = 길이;
    const 옛표 = deflateSync(Buffer.concat([
      xref줄(0, 0, 65535),
      xref줄(2, 6, 0), xref줄(2, 6, 1), xref줄(2, 6, 2),   // 1·2·3 은 묶음 안
      xref줄(1, 자리[4], 0),                                // 4 는 낱개
      xref줄(2, 6, 3),                                      // 5 도 묶음 안
      xref줄(1, 자리[6], 0),
    ]));
    넣기(7, 흐름객체(7, '/Type /XRef /Size 8 /W [1 4 2] /Root 1 0 R /Filter /FlateDecode', 옛표));
    붙이기(`startxref\n${첫xref}\n%%EOF\n`);

    // ── 고쳐 저장: 쪽 사전 3 을 낱개로 다시 붙이고, 새 내용 9 를 가리킨다 ──
    const 새쪽자리 = 길이;
    붙이기(`3 0 obj\n${쪽사전(9)}\nendobj\n`);
    const 새내용자리 = 길이;
    넣기(9, 흐름객체(9, '', 새내용));
    const 둘째xref = 길이;
    const 새표 = deflateSync(Buffer.concat([xref줄(1, 새쪽자리, 0), xref줄(1, 새내용자리, 0)]));
    조각.push(흐름객체(8, `/Type /XRef /Size 10 /Index [3 1 9 1] /W [1 4 2] /Root 1 0 R /Prev ${첫xref} /Filter /FlateDecode`, 새표));
    조각.push(Buffer.from(`startxref\n${둘째xref}\n%%EOF\n`, 'latin1'));

    const r = readPdf(Buffer.concat(조각));
    const t = r.ok ? 글만(r) : r.error;
    check('★ 눌린 PDF 를 고쳐 저장해도 고친 값을 읽는다', /NEW loose object/.test(t), JSON.stringify(t));
    check('★ 그때 묶음 속 옛 값이 이기지 않는다', !/OLD/.test(t), JSON.stringify(t));
  }

  // ④ 두 자리로 적힌 목적지 — 뒤를 메우면 없는 한자가 된다.
  {
    const { 표 } = 유니코드표읽기('1 beginbfchar\n<01> <41>\nendbfchar');
    check('두 자리 목적지를 앞으로 메운다', 표.get(1) === 'A', JSON.stringify(표.get(1) ?? null));
    // 메우는 자리가 맨 앞 한 곳이어야 한다 — 뒤 토막만 메우면 첫 글자가 도로 한자가 된다.
    const b2 = 유니코드표읽기('1 beginbfchar\n<02> <410042>\nendbfchar');
    check('★ 세 바이트 목적지도 앞으로 메운다', b2.표.get(2) === 'AB', JSON.stringify(b2.표.get(2) ?? null));
  }

  // ⑤ 배열 꼴 뒤에 엉뚱한 범위가 생기지 않는다.
  {
    const { 표 } = 유니코드표읽기('1 beginbfrange\n<0020> <0022> [<0041> <0042> <0043>]\nendbfrange');
    check('배열 꼴은 배열 꼴로만 읽는다', 표.get(0x20) === 'A' && 표.get(0x22) === 'C', JSON.stringify([...표]));
    check('★ 대괄호 안을 또 다른 범위로 읽지 않는다', !표.has(0x41) && !표.has(0x42), JSON.stringify([...표]));
  }

  // ⑥ `<0000>` 은 글자가 아니다.
  {
    const a = 유니코드표읽기('1 beginbfchar\n<01> <0000>\nendbfchar');
    const b = 유니코드표읽기('1 beginbfrange\n<03> <05> <0000>\nendbfrange');
    const 다 = [...a.표.values(), ...b.표.values()].join('');
    check('NUL 을 글에 섞지 않는다', !다.includes(String.fromCharCode(0)), JSON.stringify(다));
  }

  // ⑦ 붙박이 그림 자료 안의 `EI` — 그 뒤의 글이 통째로 사라졌다.
  {
    const 그림 = Buffer.from([0x9a, 0x45, 0x49, 0x28, 0x7f, 0x03, 0xe1, 0x28, 0x11]);  // … EI ( …
    const 내용 = Buffer.concat([
      흐름으로('BT /F1 12 Tf 72 700 Td (before) Tj ET\nBI /W 3 /H 3 /CS /G /BPC 8 ID '),
      그림,
      흐름으로('\nEI\nBT /F1 12 Tf 72 400 Td (after) Tj ET\n'),
    ]);
    const t = 글만(readPdf(한쪽짜리({ 내용 })));
    check('★ 그림 자료 안의 EI 에서 끊지 않는다', /before/.test(t) && /after/.test(t), JSON.stringify(t));
  }

  // ⑧ 낱말마다 BT/ET 를 끊는 조판 — 한 줄이 낱말마다 쪼개졌다.
  {
    // 낱말 사이 빈칸은 글 쪽에 실려 있다 (조판 프로그램이 그렇게 쓴다).
    // 여기서 재는 것은 ET 가 줄을 가르는지 하나다.
    const 내용 = 흐름으로([
      'BT /F1 12 Tf 72 700 Td (Total ) Tj ET',
      'BT /F1 12 Tf 105 700 Td (1,000,000 ) Tj ET',
      'BT /F1 12 Tf 165 700 Td (won) Tj ET',
      'BT /F1 12 Tf 72 680 Td (Next line) Tj ET',
    ].join('\n'));
    const t = 글만(readPdf(한쪽짜리({ 내용 })));
    check('★ BT/ET 가 줄을 가르지 않는다', /Total 1,000,000 won/.test(t), JSON.stringify(t));
    check('★ 그래도 세로로 움직이면 줄을 바꾼다', /\nNext line/.test(t), JSON.stringify(t));
  }

  // ⑨ 카탈로그 앞에 속사전이 있는 파일 — 자원을 물려 둔 한글 문서에서 드러난다.
  {
    const 표 = ['/CIDInit /ProcSet findresource begin',
      '1 begincodespacerange <0000> <FFFF> endcodespacerange',
      '2 beginbfchar', '<0001> <D55C>', '<0002> <AE00>', 'endbfchar', 'end'].join('\n');
    const 글꼴 = '<< /Type /Font /Subtype /Type0 /BaseFont /T /Encoding /Identity-H '
      + '/DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /BaseFont /T /DW 1000 >>] /ToUnicode 6 0 R >>';
    const b = 만들기([
      { 번호: 1, 글: '<< /ViewerPreferences << /FitWindow true >> /Type /Catalog /Pages 2 0 R >>' },
      // 자원을 쪽나무에 물려 둔다 — 쪽만 주워 오는 길로 빠지면 같이 사라진다.
      { 번호: 2, 글: '<< /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 5 0 R >> >> >>' },
      { 번호: 3, 글: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>' },
      { 번호: 4, 흐름: 흐름으로('BT /F1 12 Tf 72 700 Td <00010002> Tj ET') },
      { 번호: 5, 글: 글꼴 },
      { 번호: 6, 흐름: 흐름으로(표) },
    ]);
    // trailer 의 /Root 를 지워 「카탈로그를 직접 찾는」 길만 남긴다.
    const 망친것 = Buffer.from(b.toString('latin1').replace('/Root 1 0 R', '             '), 'latin1');
    const r = readPdf(망친것);
    check('★ 속사전이 먼저 와도 카탈로그를 찾는다', r.ok && 글만(r) === '한글',
      r.ok ? JSON.stringify(글만(r)) + JSON.stringify(r.못읽은쪽) : r.error);
  }

  // ⑩ 자원에 /XObject 가 있을 뿐인 빈 쪽 — OCR 은 할 일이 없다.
  {
    const b = 한쪽짜리({
      내용: 흐름으로('q 1 0 0 1 0 0 cm Q'),
      자원: '/Font << /F1 5 0 R >> /XObject << /Im0 5 0 R >>',
    });
    const r = readPdf(b);
    check('★ 아무것도 안 그린 빈 쪽을 스캔본이라 하지 않는다',
      !/OCR/.test(r.못읽은쪽?.[0]?.왜 ?? ''), r.못읽은쪽?.[0]?.왜);
    check('그래도 글이 없다고는 말한다', /글이 없는 쪽/.test(r.못읽은쪽?.[0]?.왜 ?? ''), r.못읽은쪽?.[0]?.왜);
  }

  // ⑪ 이름 안의 `#` 은 두 자리여야 한다.
  {
    const [값] = 값읽기(Buffer.from('<< /A#1/B 2 >>', 'latin1'), 0);
    check('#1 이 뒤 낱말을 삼키지 않는다', 값?.['A#1']?.이름 === 'B', JSON.stringify(값));
    const [값2] = 값읽기(Buffer.from('<< /A#41 2 >>', 'latin1'), 0);
    check('#41 은 여태처럼 A 로 읽는다', 값2?.AA === 2, JSON.stringify(값2));
  }

  // ⑫ 두 바이트 글꼴에 홀수 바이트가 오면 — 없는 글리프를 만들지 않는다.
  {
    const 표 = ['/CIDInit /ProcSet findresource begin',
      '1 begincodespacerange <0000> <FFFF> endcodespacerange',
      '2 beginbfchar', '<0001> <D55C>', '<4100> <AE00>', 'endbfchar', 'end'].join('\n');
    const 글꼴 = '<< /Type /Font /Subtype /Type0 /BaseFont /T /Encoding /Identity-H '
      + '/DescendantFonts [<< /Type /Font /Subtype /CIDFontType2 /BaseFont /T /DW 1000 >>] /ToUnicode 6 0 R >>';
    // <000141> — 세 바이트다. 마지막 0x41 에 0 을 붙이면 <4100> 이 되어 「글」이 나온다.
    const b = 한쪽짜리({
      내용: 흐름으로('BT /F1 12 Tf 72 700 Td <000141> Tj ET'),
      글꼴,
      더: [{ 번호: 6, 흐름: 흐름으로(표) }],
    });
    const r = readPdf(b);
    // 여기선 글 자체를 본다 — toText 는 「일부만 읽었다」 알림을 같이 싣는다.
    const 뽑힌것 = (r.덩이들?.[0]?.문단들 ?? []).join('');
    check('★ 반 토막 난 코드로 글자를 지어내지 않는다', 뽑힌것 === '한', JSON.stringify(뽑힌것));
    check('그 쪽을 일부만 읽었다고 말한다',
      (r.못읽은쪽 ?? []).some((x) => x.일부 && /1자를 못 되돌렸습니다/.test(x.왜)), JSON.stringify(r.못읽은쪽));
  }
}

trace('문서6');
/*
 * 2.0.0 6회차 · Gemini 문서6 — 실행으로 가린 셋.
 *
 *   4.5MB 짜리 PDF 한 장(1GiB 공백을 눌러 담은 흐름 하나)을 읽는 데 최고 RSS 가 2GB 를 넘었다 — 흐름을
 *   풀 때 크기 상한이 없었다. 그런 흐름 몇 개면 deel 이 메모리 부족으로 죽는다. PDF 는 남이 보낸 바이트다.
 *   ToUnicode 의 `<0000> <00FF> <0000>` 범위(0 에서 시작하는 꼴)를 통째로 건너뛰어 그 글꼴 글이 다 사라졌다.
 *   toText 는 첫 문단이 상한보다 길면 그 문단을 버리고 머리말만 줬다 — 「잘랐다」 면서 한 글자도 없었다.
 */
{
  const { 유니코드표읽기 } = await import('../src/tools/pdf.js');
  const 영시작 = 유니코드표읽기('1 beginbfrange\n<0000> <00FF> <0000>\nendbfrange');
  check('★ 0 에서 시작하는 bfrange 도 표에 싣는다 (6회차 문서6)', 영시작.표.get(0x41) === 'A' && 영시작.표.get(0x20) === ' ', `크기 ${영시작.표.size}`);
  check('  0 번 자리(NUL)는 글자로 안 싣는다', !영시작.표.has(0), JSON.stringify(영시작.표.get(0)));

  const 긴문단 = toText({ 덩이들: [{ 이름: '1쪽', 문단들: ['가'.repeat(50), '나'] }], 못읽은쪽: [] }, { maxChars: 10 });
  check('★ 첫 문단이 상한보다 길어도 상한까지는 싣는다 (6회차 문서6)', 긴문단.text.includes('가'.repeat(5)) && 긴문단.잘림.length === 1, JSON.stringify(긴문단));

  const 폭탄 = 한쪽짜리({ 내용: deflateSync(Buffer.alloc(96 * 1024 * 1024, 0x20), { level: 1 }), 옵션: { 사전4: '/Filter /FlateDecode' } });
  const 폭탄결과 = readPdf(폭탄);
  check('★★ 풀면 너무 큰 흐름은 끝까지 풀지 않고 그렇다고 말한다 (6회차 문서6)',
    (폭탄결과.못읽은쪽 ?? []).some((x) => /풀지 않았습니다/.test(x.왜)), JSON.stringify(폭탄결과.못읽은쪽));

  // BT 는 글 자리를 (0,0) 으로 되돌린다. 거기서 Td 없이 찍은 글이 앞 덩이 끝에 붙어 「HelloWorld」 가 됐다.
  const 새덩이 = readPdf(한쪽짜리({ 내용: 흐름으로('BT /F1 12 Tf 72 720 Td (Hello) Tj ET BT /F1 12 Tf (World) Tj ET') }));
  check('★ BT 뒤 자리를 안 옮기고 찍은 글은 앞 덩이 글에 안 붙인다 (6회차 문서6)', 글만(새덩이) === 'Hello\nWorld', JSON.stringify(글만(새덩이)));
  const 한줄덩이 = readPdf(한쪽짜리({ 내용: 흐름으로('BT /F1 12 Tf 72 720 Td (Total) Tj ET BT /F1 12 Tf 110 720 Td (won) Tj ET') }));
  check('  같은 줄에 덩이만 나눈 글은 여전히 한 줄이다', !글만(한줄덩이).includes('\n') && 글만(한줄덩이).includes('won'), JSON.stringify(글만(한줄덩이)));

  // 리터럴 문자열 속 역슬래시 없는 줄끝은 LF 하나다(규격 7.3.4.2). CR 을 그대로 두어 뽑힌 글에 CR 이 섞였다.
  const [줄끝값] = 값읽기(Buffer.from('(a\r\nb\rc\nd)', 'latin1'), 0);
  check('★ 리터럴 문자열 속 CR·CRLF 는 LF 하나로 읽는다 (6회차 문서6좁)',
    JSON.stringify([...줄끝값.바이트]) === JSON.stringify([97, 10, 98, 10, 99, 10, 100]), JSON.stringify([...줄끝값.바이트]));
  const [이음값] = 값읽기(Buffer.from('(a\\\r\nb)', 'latin1'), 0);
  check('  역슬래시 뒤 줄끝은 여전히 줄 이음이다', JSON.stringify([...이음값.바이트]) === JSON.stringify([97, 98]), JSON.stringify([...이음값.바이트]));

  /*
   * 피디에프6c · DecodeParms 의 Columns 가 이름(`/x`)이거나 Colors 가 음수면 예측 되돌리기가
   * `Buffer.alloc(NaN)` 으로 RangeError 를 던졌고, 그게 readPdf **밖으로** 나와 멀쩡한 다른
   * 쪽까지 통째로 못 읽었다. 망가진 흐름은 그 흐름만 「못 풀었다」 여야 한다.
   */
  const 두쪽 = (맞춤) => 만들기([
    { 번호: 1, 글: '<< /Type /Catalog /Pages 2 0 R >>' },
    { 번호: 2, 글: '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>' },
    { 번호: 3, 글: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 6 0 R >> >> >>' },
    { 번호: 4, 사전: `/Filter /FlateDecode /DecodeParms ${맞춤}`, 흐름: deflateSync(Buffer.from('BT /F1 12 Tf 10 10 Td (HelloOne) Tj ET', 'latin1')) },
    { 번호: 5, 글: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 7 0 R /Resources << /Font << /F1 6 0 R >> >> >>' },
    { 번호: 6, 글: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    { 번호: 7, 흐름: Buffer.from('BT /F1 12 Tf 10 10 Td (WorldTwo) Tj ET', 'latin1') },
  ]);
  const 짝두쪽 = readPdf(두쪽('<< >>'));
  check('  (짝) 멀쩡한 두 쪽 PDF 는 두 쪽 다 읽는다', 짝두쪽.ok && /HelloOne/.test(toText(짝두쪽).text) && /WorldTwo/.test(toText(짝두쪽).text), JSON.stringify(짝두쪽.못읽은쪽));
  for (const [이름, 맞춤] of [['Columns 가 이름', '<< /Predictor 12 /Columns /x >>'], ['Colors 가 음수', '<< /Predictor 12 /Columns 4 /Colors -3 >>'], ['BitsPerComponent 가 0', '<< /Predictor 12 /Columns 4 /BitsPerComponent 0 >>']]) {
    let r;
    try { r = readPdf(두쪽(맞춤)); } catch (e) { r = { 던짐: `${e.name}: ${e.message}`.slice(0, 80) }; }
    check(`★★ ${이름}인 쪽이 있어도 readPdf 가 던지지 않고 그 쪽만 못 읽는다 (6회차 피디에프6c)`,
      r.ok === true && (r.못읽은쪽 ?? []).some((x) => x.번호 === 1 && /예측 설정\(DecodeParms\)이 망가져/.test(x.왜)) && /WorldTwo/.test(toText(r).text),
      r.던짐 ?? JSON.stringify(r.못읽은쪽));
  }
  const { 흐름풀기 } = await import('../src/tools/pdf.js');
  let 직접;
  try { 직접 = 흐름풀기({ 사전: { Filter: { 이름: 'FlateDecode' }, DecodeParms: { Predictor: 12, Columns: -4 } }, 날것: deflateSync(Buffer.from([2, 1, 2, 3, 4])) }, (x) => x); } catch (e) { 직접 = { 던짐: e.message }; }
  check('  흐름풀기 는 망가진 예측 설정에 ok:false 와 까닭을 돌려준다', 직접.ok === false && typeof 직접.왜 === 'string' && !직접.던짐, JSON.stringify(직접));
}

// ── 19. ★ 2.0.0 8회차 — 걸러내기·판(generation)·사람에게 나가는 말 ─────
trace('19-8회차');
{
  /*
   * ① 앞머리에 쓰레기가 붙은 **잘린** 흐름.
   *
   * 둘 다 현장에서 흔하다 — 흐름 앞에 잡바이트가 붙은 것, 그리고 끝이 잘린 것.
   * 하나씩이면 이미 건졌는데 둘이 겹치면 반 토막도 못 건지고 통째로 버렸다.
   * 그러면 그 쪽은 「글이 없는 쪽」 이 되어 스캔본과 구분이 안 된다.
   */
  const 온전 = deflateSync(Buffer.from('BT /F1 12 Tf 72 720 Td (Head of page) Tj 0 -14 Td (Tail that got cut off) Tj ET', 'latin1'));
  const 잘린것 = 온전.subarray(0, 온전.length - 12);
  const 쓰레기머리 = Buffer.concat([Buffer.from([0x80, 0x81]), 잘린것]);
  const 낱개 = 흐름풀기({ 사전: { Filter: { 이름: 'FlateDecode' } }, 날것: 쓰레기머리 }, (x) => x);
  check('★ 앞머리 쓰레기 + 끝 잘림이 겹쳐도 반 토막은 건진다',
    낱개.ok === true && 낱개.잘림 === true && /Head of page/.test(낱개.자료?.toString('latin1') ?? ''),
    JSON.stringify({ ok: 낱개.ok, 왜: 낱개.왜 }));
  const r쓰레기 = readPdf(한쪽짜리({ 내용: 쓰레기머리, 옵션: { 사전4: '/Filter /FlateDecode' } }));
  check('★ 그 쪽은 글이 나오고 「일부만 읽었다」 가 된다',
    /Head of page/.test(글만(r쓰레기)) && (r쓰레기.못읽은쪽 ?? []).some((x) => x.번호 === 1 && x.일부 && /잘렸/.test(x.왜)),
    `${글만(r쓰레기)} · ${JSON.stringify(r쓰레기.못읽은쪽)}`);

  /*
   * ② 예측(Predictor) 한 줄도 못 채우는 자료. 빈 자료를 ok 로 돌려주면 그 쪽은
   * 조용히 사라진다. 게다가 Columns 가 크면 쓰지도 않을 1GB 짜리 줄 버퍼를 잡았다.
   */
  const 짧은자료 = 흐름풀기({
    사전: { Filter: { 이름: 'FlateDecode' }, DecodeParms: { Predictor: 12, Columns: 1 << 23, Colors: 1, BitsPerComponent: 8 } },
    날것: deflateSync(Buffer.from([2, 1, 2, 3])),
  }, (x) => x);
  check('★ 예측 한 줄도 못 채우는 자료를 빈 자료로 ok 하지 않는다',
    짧은자료.ok === false && /한 줄/.test(짧은자료.왜 ?? ''), JSON.stringify(짧은자료));

  /*
   * ③ 걸개가 둘인데 DecodeParms 가 사전 하나. 규격상 ASCIIHex·ASCII85·RunLength 는
   * 맞춤을 안 받으므로, 그 사전은 맞춤을 받는 걸개(Flate·LZW) 것이다. 첫 걸개에
   * 붙이면 아직 눌려 있는 바이트에 예측을 되돌려 흐름이 통째로 깨진다.
   */
  {
    const 예측붙임 = Buffer.from([2, 10, 20, 30, 2, 30, 30, 30]);   // 2줄 × 3칸, Up 예측
    const 날것 = Buffer.from(`${deflateSync(예측붙임).toString('hex')}>`, 'latin1');
    const 걸개둘 = [{ 이름: 'ASCIIHexDecode' }, { 이름: 'FlateDecode' }];
    const 맞춤 = { Predictor: 12, Columns: 3, Colors: 1, BitsPerComponent: 8 };
    const 하나 = 흐름풀기({ 사전: { Filter: 걸개둘, DecodeParms: 맞춤 }, 날것 }, (x) => x);
    const 배열 = 흐름풀기({ 사전: { Filter: 걸개둘, DecodeParms: [null, 맞춤] }, 날것 }, (x) => x);
    check('★ 걸개가 둘이고 DecodeParms 가 사전 하나면 맞춤을 받는 걸개에 붙인다',
      하나.ok === true && JSON.stringify([...하나.자료]) === JSON.stringify([10, 20, 30, 40, 50, 60]),
      JSON.stringify({ ok: 하나.ok, 왜: 하나.왜, 자료: 하나.자료 ? [...하나.자료] : null }));
    check('  배열로 또박또박 적어 준 것은 여태처럼 읽는다',
      배열.ok === true && JSON.stringify([...배열.자료]) === JSON.stringify([10, 20, 30, 40, 50, 60]),
      JSON.stringify({ ok: 배열.ok, 왜: 배열.왜 }));
  }
}

// ── 19b. ★ 어느 판(generation)이 이기나 — 한 규칙으로 ──────────────────
//
// 「고친 PDF 에서 고치기 전 값을 읽는다」 는 결함이 세 갈래로 나 있었다. 셋 다
// 같은 물음 하나다 — **한 객체를 두 판이 말할 때 누가 이기나.**
//
// 규칙은 하나다. **최신 판이 이긴다.** 최신이 어느 것인지는 둘로 안다.
//   · xref 가 있으면 — 최신 xref 부터 거슬러 읽으니 **먼저 정해진 것**이 최신이다.
//     낱개든 묶음(ObjStm)이든 한 번 정해지면 더 옛 판이 못 덮는다.
//   · xref 가 그 객체를 모르면 — 증분 저장은 파일 **뒤에** 붙으니 뒤에 있는 것이 최신이다.
trace('19b-판');
{
  const 흐름객체 = (번호, 사전, 몸통) => Buffer.concat([
    Buffer.from(`${번호} 0 obj\n<< ${사전} /Length ${몸통.length} >>\nstream\n`, 'latin1'),
    몸통, Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ]);
  // xref 흐름 한 줄: [갈래 1바이트][자리 4바이트][곁 2바이트]
  const xref줄 = (갈래, a, b2) => {
    const buf = Buffer.alloc(7);
    buf[0] = 갈래; buf.writeUInt32BE(a, 1); buf.writeUInt16BE(b2, 5);
    return buf;
  };
  // 객체 하나만 든 ObjStm 을 짓는다.
  const 묶음짓기 = (번호, 속번호, 속글) => {
    const 머리 = `${속번호} 0 `;
    const 속 = deflateSync(Buffer.from(`${머리}${속글}`, 'latin1'));
    return 흐름객체(번호, `/Type /ObjStm /N 1 /First ${머리.length} /Filter /FlateDecode`, 속);
  };
  const 쪽사전 = (내용번호) => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
    + `/Resources << /Font << /F1 5 0 R >> >> /Contents ${내용번호} 0 R >>`;
  const 본문 = (글) => 흐름으로(`BT /F1 12 Tf 72 700 Td (${글}) Tj ET`);

  /*
   * ④ 최신 xref 가 「이 객체는 묶음 안에 있다」 고 정해 준 것을, 옛 xref 의
   *    낱개 자리가 덮었다. 묶음 쪽(= 고친 값)은 「이미 정해졌다」 며 버려졌다.
   */
  {
    const 조각 = [Buffer.from('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let 길이 = 조각[0].length;
    const 자리 = {};
    const 넣기 = (번호, buf) => { 자리[번호] = 길이; 조각.push(buf); 길이 += buf.length; };
    const 붙이기 = (s) => { const b2 = Buffer.from(s, 'latin1'); 조각.push(b2); 길이 += b2.length; };
    const 낱개 = (번호, 글) => Buffer.from(`${번호} 0 obj\n${글}\nendobj\n`, 'latin1');

    넣기(1, 낱개(1, '<< /Type /Catalog /Pages 2 0 R >>'));
    넣기(2, 낱개(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
    넣기(3, 낱개(3, 쪽사전(4)));                       // 옛 판 — 낱개
    넣기(4, 흐름객체(4, '', 본문('OLD loose page')));
    넣기(5, 낱개(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
    const 첫xref = 길이;
    const 옛표 = deflateSync(Buffer.concat([
      xref줄(0, 0, 65535),
      xref줄(1, 자리[1], 0), xref줄(1, 자리[2], 0), xref줄(1, 자리[3], 0),
      xref줄(1, 자리[4], 0), xref줄(1, 자리[5], 0),
    ]));
    넣기(7, 흐름객체(7, '/Type /XRef /Size 8 /Index [0 6] /W [1 4 2] /Root 1 0 R /Filter /FlateDecode', 옛표));
    붙이기(`startxref\n${첫xref}\n%%EOF\n`);

    // ── 고쳐 저장: 쪽 사전 3 을 **묶음 안에** 다시 넣고, 새 내용 9 를 가리킨다 ──
    넣기(9, 흐름객체(9, '', 본문('NEW in objstm')));
    넣기(10, 묶음짓기(10, 3, 쪽사전(9)));
    const 둘째xref = 길이;
    const 새표 = deflateSync(Buffer.concat([
      xref줄(2, 10, 0),                                 // 3 은 이제 묶음 10 의 0째
      xref줄(1, 자리[9], 0), xref줄(1, 자리[10], 0),
    ]));
    조각.push(흐름객체(11, `/Type /XRef /Size 12 /Index [3 1 9 2] /W [1 4 2] /Root 1 0 R /Prev ${첫xref} /Filter /FlateDecode`, 새표));
    조각.push(Buffer.from(`startxref\n${둘째xref}\n%%EOF\n`, 'latin1'));

    const r = readPdf(Buffer.concat(조각));
    const t = r.ok ? 글만(r) : r.error;
    check('★ 최신 xref 가 「묶음 안」 이라 한 객체를 옛 xref 의 낱개가 못 덮는다',
      /NEW in objstm/.test(t) && !/OLD/.test(t), JSON.stringify(t));
  }

  /*
   * ④b 같은 규칙의 묶음-대-묶음 쪽 — 옛 판도 새 판도 묶음 안에 있는 꼴.
   *    눌린 PDF 를 고쳐 저장하면 고친 사전이 **새 묶음**으로 붙고 옛 묶음은
   *    그대로 남는다. 먼저 정해진 판(최신 xref)이 이겨야 한다.
   */
  {
    const 조각 = [Buffer.from('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let 길이 = 조각[0].length;
    const 자리 = {};
    const 넣기 = (번호, buf) => { 자리[번호] = 길이; 조각.push(buf); 길이 += buf.length; };
    const 붙이기 = (s2) => { const b2 = Buffer.from(s2, 'latin1'); 조각.push(b2); 길이 += b2.length; };
    const 낱개 = (번호, 글) => Buffer.from(`${번호} 0 obj\n${글}\nendobj\n`, 'latin1');

    넣기(1, 낱개(1, '<< /Type /Catalog /Pages 2 0 R >>'));
    넣기(2, 낱개(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
    넣기(5, 낱개(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
    넣기(4, 흐름객체(4, '', 본문('OLD in old objstm')));
    넣기(6, 묶음짓기(6, 3, 쪽사전(4)));                 // 옛 판 — 옛 묶음 안
    const 첫xref = 길이;
    const 옛표 = deflateSync(Buffer.concat([
      xref줄(0, 0, 65535),
      xref줄(1, 자리[1], 0), xref줄(1, 자리[2], 0),
      xref줄(2, 6, 0),                                  // 3 은 묶음 6 의 0째
      xref줄(1, 자리[4], 0), xref줄(1, 자리[5], 0), xref줄(1, 자리[6], 0),
    ]));
    넣기(7, 흐름객체(7, '/Type /XRef /Size 8 /Index [0 7] /W [1 4 2] /Root 1 0 R /Filter /FlateDecode', 옛표));
    붙이기(`startxref\n${첫xref}\n%%EOF\n`);

    넣기(9, 흐름객체(9, '', 본문('NEW in new objstm')));
    넣기(10, 묶음짓기(10, 3, 쪽사전(9)));               // 새 판 — 새 묶음 안
    const 둘째xref = 길이;
    const 새표 = deflateSync(Buffer.concat([
      xref줄(2, 10, 0),                                 // 3 은 이제 묶음 10 의 0째
      xref줄(1, 자리[9], 0), xref줄(1, 자리[10], 0),
    ]));
    조각.push(흐름객체(11, `/Type /XRef /Size 12 /Index [3 1 9 2] /W [1 4 2] /Root 1 0 R /Prev ${첫xref} /Filter /FlateDecode`, 새표));
    조각.push(Buffer.from(`startxref\n${둘째xref}\n%%EOF\n`, 'latin1'));

    const r = readPdf(Buffer.concat(조각));
    const t = r.ok ? 글만(r) : r.error;
    check('★ 묶음이 둘일 때도 최신 xref 가 짚어 준 묶음이 이긴다',
      /NEW in new objstm/.test(t) && !/OLD/.test(t), JSON.stringify(t));
  }

  /*
   * ⑤ 최신 xref **뒤에** 덧붙은 낱개 객체. 그 xref 는 이 객체를 모른다 —
   *    파일 뒤에 붙은 것이 나중 판이다. 여태는 xref 자리에 진짜 객체가 있기만
   *    하면 무조건 덮어, 덧붙은 고친 값을 버렸다.
   */
  {
    const 바탕 = 한쪽짜리({ 내용: 본문('OLD price 1000') });
    const 덧 = Buffer.from(`4 0 obj\n<< /Length ${본문('NEW price 2000').length} >>\nstream\n${본문('NEW price 2000').toString('latin1')}\nendstream\nendobj\n`, 'latin1');
    const r = readPdf(Buffer.concat([바탕, 덧]));
    const t = r.ok ? 글만(r) : r.error;
    check('★ 최신 xref 뒤에 덧붙은 낱개 객체가 이긴다 (xref 가 모르는 판이다)',
      /NEW price 2000/.test(t) && !/OLD/.test(t), JSON.stringify(t));
  }

  /*
   * ⑤b 선형화(linearized)한 파일에서 그 규칙이 헛돌지 않는지.
   *
   *    웹에 올리는 PDF 는 첫쪽 xref 를 **파일 앞머리**에 두고, 맨 끝 startxref 가
   *    그 앞머리 xref 를 가리킨다(주 xref 는 /Prev 로 뒤에 있다). 그래서 「최신
   *    xref 보다 뒤면 새 판」 으로 재면 **거의 모든 객체**가 새 판이 되어, 본문에
   *    `3 0 obj` 라고 적힌 문서를 xref 가 바로잡아 주던 길이 막힌다.
   *    견주는 것은 본 xref 칸 중 **가장 뒤엣것**이어야 한다.
   */
  {
    const 객체들 = [
      { 번호: 1, 글: '<< /Type /Catalog /Pages 2 0 R >>' },
      { 번호: 2, 글: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      { 번호: 3, 글: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>' },
      { 번호: 4, 흐름: 흐름으로('BT /F1 12 Tf 72 700 Td (A header looks like 3 0 obj in the file) Tj ET') },
      { 번호: 5, 글: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    ];
    const 머리 = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1');
    const 최대 = 5;
    // 앞머리 첫쪽 xref — 1번만 적고 /Prev 로 뒤의 주 xref 를 가리킨다.
    const 첫표 = (자리1, 주자리) => Buffer.from(`${['xref', '0 1', '0000000000 65535 f ', '1 1',
      `${String(자리1).padStart(10, '0')} 00000 n `, 'trailer',
      `<< /Size ${최대 + 1} /Root 1 0 R /Prev ${String(주자리).padStart(10, '0')} >>`].join('\n')}\n`, 'latin1');
    const 객체시작 = 머리.length + 첫표(0, 0).length;

    const 몸 = []; const 자리표 = new Map(); let 길이 = 객체시작;
    for (const o of 객체들) {
      자리표.set(o.번호, 길이);
      const b2 = o.흐름 !== undefined
        ? Buffer.concat([Buffer.from(`${o.번호} 0 obj\n<< /Length ${o.흐름.length} >>\nstream\n`, 'latin1'), o.흐름, Buffer.from('\nendstream\nendobj\n', 'latin1')])
        : Buffer.from(`${o.번호} 0 obj\n${o.글}\nendobj\n`, 'latin1');
      몸.push(b2); 길이 += b2.length;
    }
    const 주자리 = 길이;
    const 주줄 = ['xref', `0 ${최대 + 1}`, '0000000000 65535 f '];
    for (let n = 1; n <= 최대; n += 1) 주줄.push(`${String(자리표.get(n)).padStart(10, '0')} 00000 n `);
    주줄.push('trailer', `<< /Size ${최대 + 1} /Root 1 0 R >>`);
    const b = Buffer.concat([머리, 첫표(자리표.get(1), 주자리), ...몸,
      Buffer.from(`${주줄.join('\n')}\n`, 'latin1'),
      Buffer.from(`startxref\n${머리.length}\n%%EOF\n`, 'latin1')]);

    const r = readPdf(b);
    check('★ 선형화한 파일에서도 xref 가 본문 속 가짜 머리를 바로잡는다',
      r.ok && /A header looks like/.test(글만(r)), r.ok ? JSON.stringify(글만(r)) : r.error);
  }

  /*
   * ⑥ xref 를 아예 못 믿어 훑기로 묶음을 펼칠 때. 옛 묶음이 먼저 들어가
   *    새 묶음의 고친 값을 막았다 — 이때 최신을 가르는 것은 파일 안 자리뿐이다.
   */
  {
    const 조각 = [Buffer.from('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    const 붙이기 = (buf) => 조각.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'latin1'));
    붙이기('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    붙이기('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
    붙이기('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
    붙이기(흐름객체(4, '', 본문('OLD in old objstm')));
    붙이기(묶음짓기(6, 3, 쪽사전(4)));                 // 옛 묶음 — 파일 앞쪽
    붙이기(흐름객체(9, '', 본문('NEW in new objstm')));
    붙이기(묶음짓기(10, 3, 쪽사전(9)));                // 새 묶음 — 파일 뒤쪽
    // xref 는 없다 (덧붙이다 잘린 파일). 훑기와 카탈로그 찾기만 남는다.

    const r = readPdf(Buffer.concat(조각));
    const t = r.ok ? 글만(r) : r.error;
    check('★ xref 를 못 믿을 때는 파일 뒤에 있는 묶음이 이긴다',
      /NEW in new objstm/.test(t) && !/OLD/.test(t), JSON.stringify(t));
  }
}

// ── 19c. ★ 사람에게 나가는 말 — 두 번 붙지 않고, 까닭을 안 지운다 ────────
//
// 여기 넷은 코드가 아니라 **말**이다. 못 읽은 쪽을 몇 쪽이 왜 못 읽었는지로
// 보여주는 것이 이 파일의 일인데, 그 말이 겹치거나 사라지면 사람은 문서를
// 잘못 판단한다 — 반만 읽은 문서를 다 읽은 줄 알고 답의 근거로 쓴다.
trace('19c-말');
{
  const 여러흐름쪽 = (내용참조, 더) => 만들기([
    { 번호: 1, 글: '<< /Type /Catalog /Pages 2 0 R >>' },
    { 번호: 2, 글: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { 번호: 3, 글: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents ${내용참조} >>` },
    { 번호: 5, 글: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    ...더,
  ]);
  const 막힌흐름 = { 번호: 6, 흐름: Buffer.from([1, 2, 3, 4]), 사전: '/Filter /LZWDecode' };

  // ⑦ 한 쪽은 글이 나오고 흐름 하나가 막힌 쪽 — 안내가 앞뒤로 두 번 붙었다.
  const 반쪽 = readPdf(여러흐름쪽('[4 0 R 6 0 R]', [
    { 번호: 4, 흐름: 흐름으로('BT /F1 12 Tf 72 720 Td (Visible half) Tj ET') },
    막힌흐름,
  ]));
  const 반쪽글 = toText(반쪽).text;
  check('★ 일부만 읽었다는 안내가 한 쪽에 두 번 붙지 않는다',
    (반쪽글.match(/일부만 읽었습니다/g) ?? []).length === 1, JSON.stringify(반쪽글));
  check('  그래도 못 읽은 까닭은 그 자리에 남는다', /LZWDecode/.test(반쪽글), JSON.stringify(반쪽글));

  // ⑨ 일부만 읽은 쪽만 있으면 요약이 그냥 `pdf · N쪽` 이라 화면에서 사라졌다.
  check('★ 일부만 읽은 쪽만 있어도 요약에 뜬다',
    /일부만 읽음/.test(summarize(반쪽)), summarize(반쪽));

  // ⑧ 흐름이 막혀 글을 못 꺼낸 쪽을 「글이 없는 쪽」 으로 덮어썼다.
  //    (자료들이 아예 빈 경우는 이미 까닭을 적고 있었다 — 같은 정직이 여기만 빠졌다.)
  const 막힌빈쪽 = readPdf(여러흐름쪽('[4 0 R 6 0 R]', [
    { 번호: 4, 흐름: 흐름으로('q 1 0 0 1 0 0 cm Q') },
    막힌흐름,
  ]));
  check('★ 흐름이 막혀 글이 안 나온 쪽은 그 까닭을 지우지 않는다',
    /LZWDecode/.test(막힌빈쪽.못읽은쪽?.[0]?.왜 ?? '') && !/스캔|OCR/.test(막힌빈쪽.못읽은쪽?.[0]?.왜 ?? ''),
    JSON.stringify(막힌빈쪽.못읽은쪽));

  // ⑩ 빈 쪽·흐름 실패까지 전부 「그림으로만 들어 있습니다 — OCR」 로 안내했다.
  //    빈 쪽이면 OCR 은 할 일이 없고, 흐름이 막힌 것은 애초에 글이 있을 수 있다.
  const 빈쪽 = readPdf(여러흐름쪽('4 0 R', [{ 번호: 4, 흐름: 흐름으로('q 1 0 0 1 0 0 cm Q') }]));
  check('★ 빈 쪽뿐인 문서에 OCR 을 시키지 않는다',
    !/OCR 이 필요/.test(한쪽도못읽음말(빈쪽, 'a.pdf')) && /OCR 도 할 일이 없습니다/.test(한쪽도못읽음말(빈쪽, 'a.pdf')),
    한쪽도못읽음말(빈쪽, 'a.pdf'));
  check('★ 흐름이 막힌 문서에도 OCR 이 아니라 못 푼 까닭을 말한다',
    !/OCR/.test(한쪽도못읽음말(막힌빈쪽, 'b.pdf')) && /LZWDecode/.test(한쪽도못읽음말(막힌빈쪽, 'b.pdf')),
    한쪽도못읽음말(막힌빈쪽, 'b.pdf'));
  const 스캔본 = readPdf(한쪽짜리({
    내용: 흐름으로('q 200 0 0 200 100 500 cm /Im0 Do Q'),
    자원: '/XObject << /Im0 7 0 R >>',
    더: [{ 번호: 7, 사전: '/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8', 흐름: Buffer.from([0xff]) }],
  }));
  check('  진짜 스캔본에는 여태처럼 OCR 을 말한다',
    /OCR/.test(한쪽도못읽음말(스캔본, 'c.pdf')), 한쪽도못읽음말(스캔본, 'c.pdf'));
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\nPDF 읽기 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
