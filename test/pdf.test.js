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
  readPdf, toText, summarize, 못읽은말, isPdfPath, looksPdf, 유니코드표읽기, 흐름풀기, pdf는못고침,
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
function 만들기(객체들, { 트레일러 = '', xref틀림 = false, 길이틀림 = false, 판 = '1.4' } = {}) {
  const 조각 = [Buffer.from(`%PDF-${판}\n%\xe2\xe3\xcf\xd3\n`, 'latin1')];
  let 길이 = 조각[0].length;
  const 자리표 = new Map();
  for (const o of 객체들) {
    자리표.set(o.번호, 길이);
    let 몸;
    if (o.흐름 !== undefined) {
      const L = 길이틀림 ? o.흐름.length + 13 : o.흐름.length;
      몸 = Buffer.concat([
        Buffer.from(`${o.번호} 0 obj\n<< ${o.사전 ?? ''} /Length ${L} >>\nstream\n`, 'latin1'),
        o.흐름,
        Buffer.from('\nendstream\nendobj\n', 'latin1'),
      ]);
    } else {
      몸 = Buffer.from(`${o.번호} 0 obj\n${o.글}\nendobj\n`, 'latin1');
    }
    조각.push(몸); 길이 += 몸.length;
  }
  const xref자리 = 길이;
  const 최대 = Math.max(...객체들.map((o) => o.번호));
  const 줄 = ['xref', `0 ${최대 + 1}`, '0000000000 65535 f '];
  for (let n = 1; n <= 최대; n += 1) {
    const off = xref틀림 ? 7 : (자리표.get(n) ?? 0);
    줄.push(`${String(off).padStart(10, '0')} 00000 ${자리표.has(n) ? 'n' : 'f'} `);
  }
  줄.push('trailer', `<< /Size ${최대 + 1} /Root 1 0 R ${트레일러} >>`, 'startxref', String(xref자리), '%%EOF');
  조각.push(Buffer.from(`${줄.join('\n')}\n`, 'latin1'));
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

  const r = TOOLS.Read.run({ file_path: '명세.pdf' }, ctx);
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

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\nPDF 읽기 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
