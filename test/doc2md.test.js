/**
 * 문서 → 마크다운 (tools/doc2md.js).
 *
 * ── 여기서 재는 것 ──────────────────────────────────────────────────────
 *
 * 읽는 일은 이미 세 읽개가 하고 있고 그쪽 검사가 따로 있다(docs · xlsx · pdf).
 * 여기서 재는 것은 **그 결과를 마크다운으로 그리는 자리**뿐이다.
 *
 *   · 표가 진짜 마크다운 표가 되는가 (칸 수가 맞고, 머리글 줄이 붙는가)
 *   · 칸 안의 `|` 가 표를 부수지 않는가 — 사내 문서에 파이프가 흔하다
 *   · 칸이 너무 많으면 표 대신 CSV 로 물러나고 **왜 그랬는지 적는가**
 *   · 못 읽은 쪽을 조용히 건너뛰지 않는가 — 빈 쪽은 「없는 문서」 가 된다
 *   · 자를 때 잘랐다고 말하는가
 *
 * 마지막 둘이 이 파일에서 제일 중요하다. 조용히 빠진 자리는 모델이 그것을
 * 「문서에 그런 내용 없다」 의 근거로 삼는다.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeZip } from '../src/pack/zip.js';
import { 마크다운, 표그리기, 바꿀수있나, 읽는갈래 } from '../src/tools/doc2md.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 적어둘것 = [];

const root = mkdtempSync(join(tmpdir(), 'deel-doc2md-'));
const 담기 = (경로, 항목들) => writeFileSync(
  join(root, 경로),
  makeZip(항목들.map(([n, 글]) => ({ name: n, data: Buffer.from(글, 'utf8') }))),
);

// ══ 1. 어떤 갈래를 맡나 ═════════════════════════════════════════════════
trace('1-갈래');
{
  for (const 확 of 읽는갈래) {
    check(`${확} 는 맡는다`, 바꿀수있나(`a.${확}`), `a.${확}`);
  }
  check('맡지 않는 갈래는 아니라고 한다',
    !바꿀수있나('a.ppt') && !바꿀수있나('a.js') && !바꿀수있나('a'));
}

// ══ 2. 표 그리기 ════════════════════════════════════════════════════════
trace('2-표');
{
  const md = 표그리기([['이름', '값'], ['지연', '120ms']]);
  check('★ 머리글 줄이 붙는다', md.split('\n')[1] === '| --- | --- |', JSON.stringify(md.split('\n')[1]));
  check('★ 행이 그대로 온다', md.includes('| 지연 | 120ms |'), md.split('\n')[2]);

  /*
   * ★ 칸 안의 파이프.
   *
   * 안 막으면 그 행부터 칸 수가 어긋나고, 마크다운은 그 줄을 표로 안 읽는다.
   * 사내 문서에 `A | B` 같은 칸이 정말 흔하다.
   */
  const 파이프 = 표그리기([['항목', '비고'], ['A | B', '파이프 든 칸']]);
  check('★★ 칸 안의 파이프가 표를 안 부순다', 파이프.includes('A \\| B'), 파이프.split('\n')[2]);

  // 칸 수가 행마다 다른 문서가 흔하다(합쳐진 칸). 제일 넓은 행에 맞춰 채운다.
  const 들쭉 = 표그리기([['a', 'b', 'c'], ['1']]);
  const 폭 = 들쭉.split('\n').map((l) => l.split('|').length);
  check('★ 짧은 행을 채워서 칸 수를 맞춘다', new Set(폭).size === 1, 폭.join(','));

  /*
   * ★★ 표를 부수는 백슬래시는 **끝엣것뿐이다** (19회차 2차 눈).
   *
   * 칸이 백슬래시로 끝나면 그것이 뒤따르는 칸 가름표를 먹어 표가 그 줄부터
   * 어긋난다 — 윈도우 경로가 든 표에서 바로 나온다. 그렇다고 백슬래시를
   * 전부 벗기면 칸 안의 `\d+` 같은 글이 `\\d+` 로 **불어난다.** 한 번
   * 그렇게 고쳤다가 되돌렸다. 두 쪽을 같이 잰다.
   */
  const 한칸 = (값) => 표그리기([['머리'], [값]]).split('\n')[2];
  check('★★ 끝의 백슬래시는 짝을 맞춘다 (칸 가름표를 안 먹게)',
    한칸('경로 C:\\').includes('C:\\\\'), 한칸('경로 C:\\'));
  check('★★ 가운데 백슬래시는 그대로 둔다 (`\\d+` 가 안 불어난다)',
    한칸('`\\d+`').includes('`\\d+`') && !한칸('`\\d+`').includes('`\\\\d+`'), 한칸('`\\d+`'));

  check('빈 표는 안 그린다', 표그리기([]) === '' && 표그리기([['', '']]) === '');

  /*
   * ★ 칸이 너무 많으면 물러난다.
   *
   * 스무 칸짜리 마크다운 표는 읽는 것이 아니라 가로로 흐르는 벽이다. 그때는
   * CSV 로 내되 **왜 그랬는지 적는다** — 조용히 모양을 바꾸면 표가 안 나온
   * 것이 파일 탓인지 우리 탓인지 알 길이 없다.
   */
  const 넓은것 = 표그리기([Array.from({ length: 20 }, (_, i) => `칸${i}`), Array.from({ length: 20 }, (_, i) => String(i))]);
  check('★★ 칸이 너무 많으면 CSV 로 물러난다', 넓은것.startsWith('```csv'), 넓은것.slice(0, 20));
  check('★★ 물러났으면 왜 그랬는지 적는다', /칸이 20개라/.test(넓은것),
    넓은것.split('\n').pop());
}

// ══ 3. pptx · docx ══════════════════════════════════════════════════════
trace('3-오피스');
{
  const 표xml = '<a:tbl><a:tr><a:tc><a:p><a:t>이름</a:t></a:p></a:tc><a:tc><a:p><a:t>값</a:t></a:p></a:tc></a:tr>'
    + '<a:tr><a:tc><a:p><a:t>지연</a:t></a:p></a:tc><a:tc><a:p><a:t>120ms</a:t></a:p></a:tc></a:tr></a:tbl>';
  const 슬라이드 = (제목, 표 = '') => `<?xml version="1.0"?><p:sld xmlns:a="x"><a:p><a:t>${제목}</a:t></a:p>${표}</p:sld>`;
  담기('발표.pptx', [
    ['[Content_Types].xml', '<x/>'],
    ['ppt/slides/slide1.xml', 슬라이드('1분기 요약')],
    ['ppt/slides/slide2.xml', 슬라이드('측정값', 표xml)],
  ]);

  const r = 마크다운(join(root, '발표.pptx'));
  check('pptx 를 읽는다', r.ok, r.ok ? r.summary : r.error);
  check('★ 파일 이름이 제목으로 남는다', /^# 발표\.pptx$/m.test(r.md ?? ''), (r.md ?? '').split('\n')[0]);
  check('★ 장이 제목 줄이 된다', /^## 1장$/m.test(r.md ?? '') && /^## 2장$/m.test(r.md ?? ''));
  check('★★ 장 안의 표가 마크다운 표가 된다',
    /\| 이름 \| 값 \|/.test(r.md ?? '') && /\| 지연 \| 120ms \|/.test(r.md ?? ''),
    (r.md ?? '').split('\n').filter((l) => l.startsWith('|')).join(' / '));
  적어둘것.push(`pptx → ${(r.md ?? '').split('\n').length}줄 마크다운`);

  const docx = '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>개요</w:t></w:r></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>항목</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>비고</w:t></w:r></w:p></w:tc></w:tr>'
    + '<w:tr><w:tc><w:p><w:r><w:t>A | B</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>파이프</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '<w:p><w:r><w:t>끝</w:t></w:r></w:p></w:body></w:document>';
  담기('보고서.docx', [['[Content_Types].xml', '<x/>'], ['word/document.xml', docx]]);
  const d = 마크다운(join(root, '보고서.docx'));
  check('docx 를 읽는다', d.ok, d.ok ? d.summary : d.error);
  check('★ 구획이 하나면 제목 줄을 안 만든다', !/^## /m.test(d.md ?? ''), (d.md ?? '').split('\n')[2]);
  check('★★ 표 앞뒤 글이 표에 안 먹힌다',
    /^개요$/m.test(d.md ?? '') && /^끝$/m.test(d.md ?? ''),
    (d.md ?? '').replace(/\n/g, ' / '));
  check('★★ 칸 안의 파이프를 막는다', (d.md ?? '').includes('A \\| B'));
}

// ══ 4. pdf — 못 읽은 쪽을 말한다 ════════════════════════════════════════
trace('4-pdf');
{
  const 자료 = join(dirname(fileURLToPath(import.meta.url)), '자료');
  const 글있는것 = 마크다운(join(자료, '진짜-크롬.pdf'));
  check('pdf 를 읽는다', 글있는것.ok, 글있는것.ok ? 글있는것.summary : 글있는것.error);
  check('★ 쪽이 제목 줄이 된다', /^## 1쪽$/m.test(글있는것.md ?? ''));
  check('★ 글이 실린다', /결제 한도/.test(글있는것.md ?? ''),
    (글있는것.md ?? '').split('\n').slice(0, 4).join(' / '));

  /*
   * ★★ 글이 없는 쪽을 **조용히 건너뛰지 않는다.**
   *
   * 건너뛰면 그 문서는 「그 쪽에 아무것도 없는 문서」 가 된다. 모델은 그걸
   * 근거로 "그런 내용 없습니다" 라고 답하고, 사람은 그 말을 믿는다.
   */
  const 그림만 = 마크다운(join(자료, '진짜-그림만.pdf'));
  check('★★ 못 읽은 쪽을 조용히 건너뛰지 않는다',
    /못 읽었습니다/.test(그림만.md ?? ''), (그림만.md ?? '').split('\n').pop());
  check('★ 왜 못 읽었는지도 적는다', /스캔|OCR/.test(그림만.md ?? ''),
    (그림만.md ?? '').split('\n').pop());

  /*
   * ★★★ 쪽이 **통째로 빠진** 것은 마크다운 **안에** 적혀야 한다.
   *
   * 못 읽은 쪽은 `## 3쪽` 자리에 「못 읽었습니다」 가 남지만, 쪽 나무가 끊겨
   * 아예 안 걸린 쪽은 남길 자리조차 없다. 그 말이 `summary` 한 줄에만 있으면,
   * `.md` 로 떨어뜨려 둔 다음부터는 **아무 데도 없다** — 문서가 제 입으로 3쪽
   * 이라고 적어 뒀는데 1쪽짜리 온전한 문서로 남는다.
   */
  const 반쪽 = join(root, '반쪽나무.pdf');
  writeFileSync(반쪽, 반쪽나무pdf());
  const r반 = 마크다운(반쪽);
  check('★★★ 마크다운 안에 「몇 쪽을 못 건졌다」 가 적힌다',
    r반.ok && /못 건짐/.test(r반.md ?? ''), (r반.md ?? r반.error ?? '').split('\n').slice(0, 3).join(' / '));
  check('★★★ 문서가 적어 둔 쪽 수도 같이 적힌다',
    /3쪽이라고 적어 두었는데/.test(r반.md ?? ''), (r반.md ?? '').split('\n')[1]);
  check('★★ 「없다고 답하지 마세요」 도 같이 간다',
    /답하지 마세요/.test(r반.md ?? ''), (r반.md ?? '').split('\n')[3]);
  // 멀쩡한 문서에 이 말이 붙으면 거짓 경고다 — 안 하느니만 못하다.
  check('  (짝) 온전한 문서에는 안 붙는다',
    !/못 건짐|답하지 마세요/.test(글있는것.md ?? ''), (글있는것.md ?? '').split('\n')[1]);
}

/**
 * /Kids 셋 중 둘이 끊긴 PDF 를 바이트로 짓는다 (pdf.test.js 의 `반쪽나무` 와 같은 꼴).
 *
 * 덧붙여 저장하다 끊긴 계약서·서명 PDF 에 정말 흔한 모양이라, 자료 파일로
 * 두지 않고 여기서 짓는다 — 어디가 어긋나 있는지가 눈에 보여야 한다.
 */
function 반쪽나무pdf() {
  const 흐름 = 'BT /F1 12 Tf 72 720 Td (FIRST PAGE ONLY) Tj ET';
  const 객체 = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 7 0 R 8 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${흐름.length} >>\nstream\n${흐름}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let 글 = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const 자리 = [];
  객체.forEach((몸, i) => {
    자리.push(글.length);
    글 += `${i + 1} 0 obj\n${몸}\nendobj\n`;
  });
  const xref자리 = 글.length;
  글 += `xref\n0 ${객체.length + 1}\n0000000000 65535 f \n`;
  for (const off of 자리) 글 += `${String(off).padStart(10, '0')} 00000 n \n`;
  글 += `trailer\n<< /Size ${객체.length + 1} /Root 1 0 R >>\nstartxref\n${xref자리}\n%%EOF\n`;
  return Buffer.from(글, 'latin1');
}

// ══ 5. 자를 때는 잘랐다고 말한다 ════════════════════════════════════════
trace('5-자르기');
{
  const 긴것 = Array.from({ length: 400 }, (_, i) => `<w:p><w:r><w:t>문단 ${i} ${'가'.repeat(60)}</w:t></w:r></w:p>`).join('');
  담기('긴문서.docx', [
    ['[Content_Types].xml', '<x/>'],
    ['word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${긴것}</w:body></w:document>`],
  ]);
  const r = 마크다운(join(root, '긴문서.docx'), { maxChars: 2000 });
  check('★★ 자르면 잘랐다고 말한다', (r.말 ?? []).some((x) => /잘랐습니다/.test(x)),
    JSON.stringify(r.말));
  check('★ 상한 언저리에서 멈춘다', (r.md ?? '').length <= 2400, `${(r.md ?? '').length}자`);
  적어둘것.push(`긴 문서 400문단 → ${(r.md ?? '').length}자로 잘라 냄`);
}

// ══ 6. 못 바꾸는 갈래 ═══════════════════════════════════════════════════
trace('6-못바꿈');
{
  writeFileSync(join(root, '그냥.js'), 'const a = 1;\n', 'utf8');
  const r = 마크다운(join(root, '그냥.js'));
  check('★ 못 바꾸는 갈래는 그렇게 말한다', !r.ok && /갈래가 아닙니다/.test(r.error), r.error?.split('\n')[0]);
  // 길을 같이 준다 — 「안 된다」 로 끝나면 사람은 다음에 무엇을 할지 모른다.
  check('★ 무엇은 되는지 같이 알려 준다', /hwpx|pptx/.test(r.error ?? ''), (r.error ?? '').split('\n')[1]);
  check('★ LibreOffice 로 빌려 읽는 길도 알려 준다', /LibreOffice/.test(r.error ?? ''),
    (r.error ?? '').split('\n')[2]);

  const 없는것 = 마크다운(join(root, '없는파일.docx'));
  check('없는 파일에도 안 터진다', !없는것.ok && typeof 없는것.error === 'string', 없는것.error);
}

// ── 마무리 ──────────────────────────────────────────────────────────────
trace('7-치움');
rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n문서 → 마크다운 검사  ${D}(표가 표가 되는가 · 빠진 자리를 말하는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
for (const 글 of 적어둘것) console.log(`  ${D}· ${글}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
