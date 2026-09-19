// 엑셀 읽기 검사.
//
// 시험용 파일을 규격(ECMA-376)대로 직접 만들어 읽힌다. 엑셀이 깔려 있어야
// 돌아가는 검사는 CI 에서 못 쓰기 때문이다. 대신 엑셀이 실제로 내놓는 모양을
// 최대한 따라 만든다 — 공용 문자열, 서식 있는 글, 인라인 문자열, 날짜 서식,
// 빈 칸, 건너뛴 줄, Z 뒤의 열까지.
//
// 아직 못 한 것: 이 PC 의 엑셀 COM 이 계속 '바쁘다' 고 답해서, 진짜 엑셀이
// 저장한 파일로 맞춰 보지는 못했다. 그건 따로 확인해야 한다.
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeZip } from '../src/pack/zip.js';
import { readZip, looksZip } from '../src/pack/zip.js';
import { readXlsx, toCsv, cellRef, unescapeXml, looksOle } from '../src/tools/xlsx.js';
import { 시트모으기, 빈시트답, canUseExcel, 없는엑셀, SCRIPT } from '../src/tools/excel-com.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

trace('1-zip');

// ── zip 읽기부터 ────────────────────────────────────────────────────────
{
  const z = makeZip([
    { name: 'a.txt', data: Buffer.from('안녕하세요 여러분 안녕하세요 여러분 안녕하세요 여러분', 'utf8') },
    { name: '폴더/b.bin', data: Buffer.from([1, 2, 3]) },
    { name: 'c/d/깊은.txt', data: Buffer.from('깊이', 'utf8') },
  ]);
  check('내가 만든 zip 을 내가 읽는다', looksZip(z));
  const { files, skipped } = readZip(z);
  check('세 개가 다 나온다', files.size === 3, `${files.size}개 · 건너뜀 ${skipped.length}`);
  check('압축된 것이 원래대로', files.get('a.txt')?.toString('utf8').startsWith('안녕하세요 여러분'), '');
  check('작아서 안 압축된 것도 원래대로', Buffer.compare(files.get('폴더/b.bin'), Buffer.from([1, 2, 3])) === 0);
  check('한글 이름이 살아 있다', files.has('c/d/깊은.txt'), [...files.keys()].join(', '));

  const 일부 = readZip(z, { only: (n) => n === 'a.txt' });
  check('필요한 것만 풀 수 있다', 일부.files.size === 1, String(일부.files.size));

  let 던짐 = null;
  try { readZip(Buffer.from('zip 아님')); } catch (e) { 던짐 = e; }
  check('zip 이 아니면 그렇다고 말한다', /zip 이 아닙니다/.test(던짐?.message ?? ''), 던짐?.message ?? '안 던짐');
}

trace('2-부품');

// ── 작은 부품들 ─────────────────────────────────────────────────────────
check('A1 → 1열', cellRef('A1').col === 1 && cellRef('A1').row === 1);
check('Z9 → 26열', cellRef('Z9').col === 26 && cellRef('Z9').row === 9);
check('AA1 → 27열', cellRef('AA1').col === 27);
check('BC12 → 55열', cellRef('BC12').col === 55, String(cellRef('BC12').col));
check('XFD1 → 16384열', cellRef('XFD1').col === 16384, String(cellRef('XFD1').col));
check('&amp; 풀기', unescapeXml('a&amp;b&lt;c&gt;d&quot;e&apos;f') === `a&b<c>d"e'f`);
check('숫자 참조 풀기', unescapeXml('&#54620;&#xAE00;') === '한글', unescapeXml('&#54620;&#xAE00;'));
check('OLE 표식 알아봄', looksOle(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0x00])));
check('zip 은 OLE 가 아님', !looksOle(makeZip([{ name: 'x', data: Buffer.from('x') }])));

trace('3-엑셀만들기');

// ── 시험용 xlsx 만들기 ──────────────────────────────────────────────────
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const 공용 = [
  '문서번호', '제목', '금액', '기안일', '비고',
  'A-2024-001', '사무용품 구매 품의', '긴급',
  'A-2024-002', '외주 용역 계약 (한글 · 漢字 · English)',
  'A-2024-003', '쉼표, 따옴표" 들어간 제목', '확인',
  '가운데만 있는 줄',
];

// 서식이 섞인 글은 <si> 안에 <r><t> 가 여러 개 온다. 이어 붙여야 한 문장이 된다.
const sharedXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="${NS}" count="${공용.length + 1}" uniqueCount="${공용.length + 1}">
${공용.map((s) => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('\n')}
<si><r><rPr><b/></rPr><t xml:space="preserve">굵은 </t></r><r><t>보통</t></r><rPh sb="0" eb="1"><t>후리가나</t></rPh></si>
</sst>`;
const 굵은보통 = 공용.length;   // 마지막에 넣은 것의 번호

// 스타일: 0번은 보통, 1번은 기본 날짜서식(14), 2번은 사용자 날짜서식(164)
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy&quot;년&quot;\\ mm&quot;월&quot;\\ dd&quot;일&quot;"/><numFmt numFmtId="165" formatCode="#,##0&quot;원&quot;"/></numFmts>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;

// 45366 = 2024-03-15, 45383 = 2024-04-01, 45432 = 2024-05-20
const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}"><dimension ref="A1:E7"/><sheetData>
<row r="1" spans="1:5"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>
<row r="2" spans="1:5"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2" s="3"><v>1250000</v></c><c r="D2" s="1"><v>45366</v></c><c r="E2" t="s"><v>7</v></c></row>
<row r="3" spans="1:5"><c r="A3" t="s"><v>8</v></c><c r="B3" t="s"><v>9</v></c><c r="C3" s="3"><v>48000000</v></c><c r="D3" s="2"><v>45383</v></c><c r="E3"/></row>
<row r="4" spans="1:5"><c r="A4" t="s"><v>10</v></c><c r="B4" t="s"><v>11</v></c><c r="C4" s="3"><v>0</v></c><c r="D4" s="1"><v>45432</v></c><c r="E4" t="s"><v>12</v></c></row>
<row r="5" spans="1:5"><c r="A5" t="inlineStr"><is><t>인라인 문자열</t></is></c><c r="B5" t="s"><v>${굵은보통}</v></c><c r="C5"><v>-3000</v></c><c r="D5" t="b"><v>1</v></c><c r="E5" t="b"><v>0</v></c></row>
<row r="7" spans="2:2"><c r="B7" t="s"><v>13</v></c></row>
</sheetData></worksheet>`;

// 둘째 시트: 수식, 오류값, Z 뒤의 열, 소수
const sheet2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}"><sheetData>
<row r="1"><c r="A1"><f>SUM(B1:C1)</f><v>7.5</v></c><c r="B1"><v>2.5</v></c><c r="C1"><v>5</v></c><c r="AB1" t="str"><f>"글"</f><v>수식이 낳은 글</v></c></row>
<row r="2"><c r="A2" t="e"><v>#REF!</v></c></row>
</sheetData></worksheet>`;

const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="${RNS}"><sheets>
<sheet name="결재문서" sheetId="1" r:id="rId1"/>
<sheet name="계산" sheetId="2" r:id="rId2"/>
<sheet name="숨긴시트" sheetId="3" state="hidden" r:id="rId3"/>
</sheets></workbook>`;

const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${RNS}/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="${RNS}/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="${RNS}/worksheet" Target="worksheets/sheet3.xml"/>
<Relationship Id="rId4" Type="${RNS}/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

const sheet3 = `<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>숨겨진 값</t></is></c></row></sheetData></worksheet>`;

const 엑셀 = makeZip([
  { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types/>', 'utf8') },
  { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8') },
  { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(relsXml, 'utf8') },
  { name: 'xl/sharedStrings.xml', data: Buffer.from(sharedXml, 'utf8') },
  { name: 'xl/styles.xml', data: Buffer.from(stylesXml, 'utf8') },
  { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet1, 'utf8') },
  { name: 'xl/worksheets/sheet2.xml', data: Buffer.from(sheet2, 'utf8') },
  { name: 'xl/worksheets/sheet3.xml', data: Buffer.from(sheet3, 'utf8') },
]);

trace('4-읽기');

const { sheets, notes } = readXlsx(엑셀);
const s1 = sheets[0];
const s2 = sheets[1];
const s3 = sheets[2];

check('시트를 셋 다 찾았다', sheets.length === 3, `${sheets.length}개 · 말: ${notes.join(' / ')}`);
check('시트 이름이 한글 그대로', s1.name === '결재문서' && s2.name === '계산', `${s1.name} / ${s2.name}`);
check('숨긴 시트도 담되 숨긴 줄 안다', s3.hidden === true && s3.rows[0][0] === '숨겨진 값', JSON.stringify(s3.rows));

check('머리줄이 공용 문자열에서 나온다', s1.rows[0].join('|') === '문서번호|제목|금액|기안일|비고', s1.rows[0].join('|'));
check('한자·중점·영문이 안 깨진다', s1.rows[2][1] === '외주 용역 계약 (한글 · 漢字 · English)', s1.rows[2][1]);
check('따옴표·쉼표가 값 안에 그대로', s1.rows[3][1] === '쉼표, 따옴표" 들어간 제목', s1.rows[3][1]);

check('기본 날짜서식(14)을 날짜로 읽는다', s1.rows[1][3] === '2024-03-15', s1.rows[1][3]);
check('사용자 날짜서식(164)도 날짜로 읽는다', s1.rows[2][3] === '2024-04-01', s1.rows[2][3]);
check('돈 서식(165)은 날짜가 아니다', s1.rows[1][2] === '1250000', s1.rows[1][2]);
check('0 도 사라지지 않는다', s1.rows[3][2] === '0', JSON.stringify(s1.rows[3][2]));
check('음수도 그대로', s1.rows[4][2] === '-3000', s1.rows[4][2]);

check('인라인 문자열을 읽는다', s1.rows[4][0] === '인라인 문자열', s1.rows[4][0]);
check('서식 섞인 글을 이어 붙인다', s1.rows[4][1] === '굵은 보통', JSON.stringify(s1.rows[4][1]));
check('참·거짓을 글로 바꾼다', s1.rows[4][3] === 'TRUE' && s1.rows[4][4] === 'FALSE', `${s1.rows[4][3]}/${s1.rows[4][4]}`);
check('빈 칸은 빈 채로', s1.rows[2][4] === '', JSON.stringify(s1.rows[2][4]));

// 6번째 줄이 통째로 없다. 자리를 안 지키면 아래 값이 한 줄 위로 올라온다.
check('건너뛴 줄이 자리를 지킨다', s1.rows.length === 7 && s1.rows[5].every((x) => x === ''), `${s1.rows.length}줄`);
check('건너뛴 뒤 값이 제 줄에', s1.rows[6][1] === '가운데만 있는 줄', JSON.stringify(s1.rows[6]));

check('수식 자체가 아니라 값이 들어온다', s2.rows[0][0] === '7.5', s2.rows[0][0]);
check('수식이 낳은 글도 값으로', s2.rows[0][27] === '수식이 낳은 글', s2.rows[0][27]);
check('Z 뒤의 열이 제 자리에', s2.rows[0].length === 28 && s2.rows[0][3] === '', String(s2.rows[0].length));
check('오류값을 지우지 않는다', s2.rows[1][0] === '#REF!', s2.rows[1][0]);

trace('5-CSV');

const csv = toCsv(s1.rows);
const 첫줄 = csv.split('\n')[0];
check('CSV 머리줄', 첫줄 === '문서번호,제목,금액,기안일,비고', 첫줄);
check('쉼표 든 값은 따옴표로 감싼다', csv.includes('"쉼표, 따옴표"" 들어간 제목"'), csv.split('\n')[3]);
check('CSV 줄 수가 표와 같다', csv.split('\n').length === s1.rows.length, `${csv.split('\n').length} vs ${s1.rows.length}`);

trace('6-거절');

// 엑셀이 아닌 것을 엑셀이라고 하면 안 된다
{
  let e = null;
  try { readXlsx(makeZip([{ name: 'x.txt', data: Buffer.from('그냥 zip') }])); } catch (err) { e = err; }
  check('workbook 없으면 엑셀이 아니라고 한다', /엑셀 파일이 아닙니다/.test(e?.message ?? ''), e?.message ?? '안 던짐');
}

trace('7-도구');

// ── Read 도구로 실제로 ───────────────────────────────────────────────────
{
  const { runTool } = await import('../src/tools/index.js');
  const { makeScope } = await import('../src/safety/guard.js');
  const { History } = await import('../src/safety/undo.js');
  const { Audit } = await import('../src/safety/audit.js');
  const { isExcelPath } = await import('../src/tools/excel.js');

  check('확장자로 엑셀을 알아본다', isExcelPath('a.xlsx') && isExcelPath('B.XLSM') && isExcelPath('c.xls'));
  check('엑셀 아닌 것은 아니라고 한다', !isExcelPath('a.txt') && !isExcelPath('a.xlsx.bak') && !isExcelPath('a'));

  const root = mkdtempSync(join(tmpdir(), 'deel-xl-tool-'));
  const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
  ctx.history.nextTurn();

  writeFileSync(join(root, '결재문서.xlsx'), 엑셀);
  const r = await runTool('Read', { file_path: '결재문서.xlsx' }, ctx);
  check('Read 가 엑셀을 표로 돌려준다', !r.error && r.content.includes('문서번호,제목,금액'), r.error ?? r.content.slice(0, 60));
  check('시트 이름을 표시한다', r.content.includes('### 시트: 결재문서'), r.content.split('\n')[0]);
  check('시트가 여럿이면 다 준다', r.content.includes('### 시트: 계산'), '');
  check('요약에 시트·줄 수가 뜬다', /시트 3개 · \d+줄/.test(r.summary), r.summary);
  check('고칠 수 없는 파일이라고 알려준다', r.content.includes('Edit/Write 로 고칠 수 없습니다'), '');

  // 엑셀 파일은 '읽었다' 로 치지 않는다. 안 그러면 Edit 이 고칠 수 있다고 오해한다.
  check('엑셀은 Edit 대상이 되지 않는다', !ctx.seen.has(join(root, '결재문서.xlsx')), [...ctx.seen].join(','));
  const e = await runTool('Edit', { file_path: '결재문서.xlsx', old_string: '문서번호', new_string: '번호' }, ctx);
  check('엑셀을 고치려 하면 막힌다', !!e.error, e.error?.split('\n')[0] ?? '고쳐져 버림');
  check('왜 못 고치는지 말해 준다', /고칠 수 없습니다/.test(e.error ?? ''), e.error?.split('\n')[0] ?? '');
  check('그럼 어떻게 하는지도 말해 준다', /엑셀에서 직접|CSV 로 따로/.test(e.error ?? ''), '');

  // 통째로 덮어쓰면 열리지도 않는 파일이 된다. 그쪽도 막혀야 한다.
  const 전 = readFileSync(join(root, '결재문서.xlsx'));
  const w = await runTool('Write', { file_path: '결재문서.xlsx', content: '망가뜨리기' }, ctx);
  check('엑셀을 덮어쓰려 해도 막힌다', !!w.error, w.error?.split('\n')[0] ?? '덮어써져 버림');
  check('막을 때 원본을 안 건드린다', Buffer.compare(전, readFileSync(join(root, '결재문서.xlsx'))) === 0);

  // 엑셀 파일인 척하는 것
  writeFileSync(join(root, '가짜.xlsx'), Buffer.from('이건 그냥 글입니다', 'utf8'));
  const f = await runTool('Read', { file_path: '가짜.xlsx' }, ctx);
  check('엑셀 아닌 것을 엑셀이라 안 한다', !!f.error && /엑셀 파일이 아닙니다/.test(f.error), f.error ?? f.content?.slice(0, 40));

  // 암호가 걸린 것(OLE 로 시작). 이 자리에서 엑셀을 못 쓰면 그렇다고 말해야 한다.
  writeFileSync(join(root, '암호걸림.xlsx'), Buffer.concat([
    Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]), Buffer.alloc(512),
  ]));
  const g = await runTool('Read', { file_path: '암호걸림.xlsx' }, ctx);
  check('암호 파일은 조용히 실패하지 않는다', !!g.error && g.error.length > 10, g.error ?? '오류가 없음');
  check('무엇이 필요한지 말해 준다', /엑셀|암호/.test(g.error ?? ''), g.error ?? '');

  rmSync(root, { recursive: true, force: true });
}

trace('8-탭구분');

// ── 엑셀이 내놓는 탭 구분 글 읽기 ───────────────────────────────────────
{
  const { tsv } = await import('../src/tools/excel-com.js');
  const 글 = 'A\tB\tC\r\n1\t"쉼표, 있음"\t3\r\n"따옴표 ""안"""\t"두 줄\n짜리"\t\r\n';
  const t = tsv(글);
  check('탭으로 칸을 가른다', t[0].join('|') === 'A|B|C', t[0].join('|'));
  check('따옴표 안의 쉼표는 한 칸', t[1][1] === '쉼표, 있음', t[1][1]);
  check('두 번 쓴 따옴표를 하나로', t[2][0] === '따옴표 "안"', t[2][0]);
  check('칸 안의 줄바꿈을 지킨다', t[2][1] === '두 줄\n짜리', JSON.stringify(t[2][1]));
  check('줄 수가 맞다', t.length === 3, String(t.length));
}

trace('9-암호가샐길');

// ── 암호가 새 나갈 길이 있나 ────────────────────────────────────────────
//
// 이건 돌려보는 검사가 아니라 코드를 읽는 검사다. 암호가 새는 것은 한 번
// 일어나면 되돌릴 수 없고, 새는 순간에는 아무 증상도 없기 때문이다.
// 그래서 '샐 수 있는 자리' 자체를 없앤 채로 두고, 그게 유지되는지 본다.
{
  const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const com = src('../src/tools/excel-com.js');
  const xl = src('../src/tools/excel.js');

  // 1) 명령줄로 안 나간다. 작업 관리자에서 남의 명령줄이 보인다.
  const spawn줄 = com.match(/spawn\([^)]*\)/s)?.[0] ?? '';
  check('암호를 명령줄 인자로 안 넘긴다', !/password|pw\b/.test(spawn줄), spawn줄.slice(0, 80));

  // 2) 파일로 안 나간다. 임시 스크립트에도 안 넣는다.
  check('암호를 파일에 안 쓴다',
    !/writeFileSync\([^)]*(password|\bpw\b)/s.test(com), '');
  // 엑셀에게 시킬 글은 통째로 고정이어야 한다. 끼워 넣는 자리가 하나라도
  // 있으면 언젠가 거기에 암호가 들어간다. 아예 자리를 안 만든다.
  const script = com.match(/const SCRIPT = `([\s\S]*?)`;/)?.[1];
  check('엑셀에게 시킬 글을 찾았다', typeof script === 'string' && script.length > 100, String(script?.length));
  check('그 글에 끼워 넣는 자리가 없다', script !== undefined && !script.includes('${'),
    script?.match(/\$\{[^}]*\}/g)?.join(', ') ?? '');

  // 3) 설정·감사기록에 안 남는다.
  for (const [이름, 글] of [['excel-com.js', com], ['excel.js', xl]]) {
    check(`${이름} 가 설정을 안 건드린다`, !/\bsave\(|config\.js/.test(글), '');
    check(`${이름} 가 감사기록에 안 적는다`, !/audit\./.test(글), '');
  }

  // 4) 나가는 길은 자식 프로세스의 표준입력 하나뿐이어야 한다.
  const 쓰는곳 = [...com.matchAll(/(\w[\w.]*)\.write\(\s*`?\$?\{?(password|pw)\b/g)].map((m) => m[1]);
  check('암호를 쓰는 자리는 stdin 하나뿐', 쓰는곳.length === 1 && 쓰는곳[0] === 'kid.stdin', 쓰는곳.join(', ') || '없음');

  // 5) 돌려주지도 않는다. 부른 쪽이 실수로 어딘가 적을 수 있다.
  check('읽기 결과에 암호를 담아 돌려주지 않는다', !/return\s*\{[^}]*password/s.test(xl), '');
}

trace('9b-터무니없는주소');

// ── 주소 하나로 메모리를 다 먹는 파일 (2.0.0 4회차 사냥) ─────────────────
//
// 1KB 도 안 되는 xlsx 에 `<row r="80000000">` 나 `<c r="AAAAAA1">` 한 줄이면
// 읽개가 그 번호까지 빈 줄·빈 칸을 **실제로 만들어** 채웠다. 힙이 바닥나
// 프로세스가 죽는다 — 하던 대화까지 같이. 엑셀 파일은 남이 보낸 바이트다.
//
// 죽는지를 이 검사 프로세스 안에서 재면 검사가 같이 죽는다. 그래서 힙을 작게
// 묶은 자식 프로세스에서 연다. 멀쩡한데 커다란 시트(한 칸이 백만째 줄에 있다)는
// 여기서 바로 잰다 — 고치기 전에도 이 프로세스를 죽이지는 않는 크기다.
{
  const { spawnSync } = await import('node:child_process');
  const 열글자 = (n) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
  const 한시트wb = `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="${RNS}"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const 한시트rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`;
  const 한시트 = (sheetData) => makeZip([
    { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
    { name: 'xl/workbook.xml', data: Buffer.from(한시트wb) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(한시트rels) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(`<?xml version="1.0"?><worksheet xmlns="${NS}"><sheetData>${sheetData}</sheetData></worksheet>`) },
  ]);
  const 글칸 = (ref, 값) => `<c r="${ref}" t="inlineStr"><is><t>${값}</t></is></c>`;

  // 자식 프로세스: 힙 64MB · 60초. 죽거나 멈추면 status 가 0 이 아니다.
  const 자식에서 = (sheetData) => {
    const 코드 = `
      import { makeZip } from ${JSON.stringify(new URL('../src/pack/zip.js', import.meta.url).href)};
      import { readXlsx } from ${JSON.stringify(new URL('../src/tools/xlsx.js', import.meta.url).href)};
      const b = makeZip([
        { name: 'xl/workbook.xml', data: Buffer.from(${JSON.stringify(한시트wb)}) },
        { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(${JSON.stringify(한시트rels)}) },
        { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(${JSON.stringify(`<worksheet xmlns="${NS}"><sheetData>${sheetData}</sheetData></worksheet>`)}) },
      ]);
      const r = readXlsx(b);
      const rows = r.sheets[0].rows;
      console.log(JSON.stringify({ 줄: rows.length, 폭: rows.reduce((m, x) => Math.max(m, x.length), 0), notes: r.notes }));
    `;
    const p = spawnSync(process.execPath, ['--max-old-space-size=64', '--input-type=module', '-e', 코드],
      { encoding: 'utf8', timeout: 60000 });
    let 결과 = null;
    try { 결과 = JSON.parse(p.stdout.trim().split('\n').pop()); } catch { /* 죽었으면 낼 것이 없다 */ }
    return { 살았다: p.status === 0 && 결과 !== null, 결과, 말: `status ${p.status} · ${p.signal ?? ''} · ${(p.stderr ?? '').split('\n').find((l) => /heap|Error/.test(l)) ?? ''}`.slice(0, 160) };
  };

  const 줄폭탄 = 자식에서(`<row r="80000000">${글칸('A80000000', 'x')}</row>`);
  check('★★ 줄 번호 하나(80000000)로 프로세스가 죽지 않는다', 줄폭탄.살았다, 줄폭탄.말);
  check('★ 엑셀 한계 밖 줄은 뺐다고 말한다', /한계/.test((줄폭탄.결과?.notes ?? []).join(' ')), JSON.stringify(줄폭탄.결과));
  const 열폭탄 = 자식에서(`<row r="1">${글칸('AAAAAA1', 'x')}</row>`);
  check('★★ 열 주소 하나(AAAAAA1)로 프로세스가 죽지 않는다', 열폭탄.살았다, 열폭탄.말);
  check('★ 엑셀 한계 밖 열은 뺐다고 말한다', /한계/.test((열폭탄.결과?.notes ?? []).join(' ')), JSON.stringify(열폭탄.결과));

  // 멀쩡한데 멀리 떨어진 칸. 백만 줄을 만들지 않고, 건너뛴 것을 말한다.
  const 먼줄 = readXlsx(한시트(`<row r="1">${글칸('A1', '처음')}</row><row r="1000000">${글칸('A1000000', '끝')}</row>`));
  const 먼줄행 = 먼줄.sheets[0].rows;
  check('★★ 백만째 줄의 한 칸 때문에 빈 줄 백만 개를 만들지 않는다', 먼줄행.length <= 3, `${먼줄행.length}줄`);
  check('  값은 둘 다 나온다', 먼줄행[0]?.[0] === '처음' && 먼줄행.at(-1)?.[0] === '끝', JSON.stringify(먼줄행.slice(0, 3)));
  check('★★ 건너뛴 빈 줄을 몇 개·어디부터인지 말한다',
    먼줄.notes.some((n) => /빈 줄/.test(n) && /999,?998/.test(n) && /1,?000,?000행/.test(n)), 먼줄.notes.join(' / '));

  const 먼열 = readXlsx(한시트(`<row r="1">${글칸('A1', '왼')}${글칸('XFD1', '오른')}</row>${Array.from({ length: 99 }, (_, i) => `<row r="${i + 2}">${글칸(`A${i + 2}`, String(i))}</row>`).join('')}`));
  const 먼열행 = 먼열.sheets[0].rows;
  check('★★ XFD 열의 한 칸 때문에 줄마다 빈 칸 16384 개를 만들지 않는다',
    먼열행.length === 100 && 먼열행.every((r) => r.length === 2), `${먼열행.length}줄 · 폭 ${먼열행[0]?.length}`);
  check('  오른쪽 끝 값이 제 줄에', 먼열행[0][1] === '오른' && 먼열행[1][0] === '0', JSON.stringify(먼열행[0]).slice(0, 80));
  check('★★ 건너뛴 빈 열을 말한다', 먼열.notes.some((n) => /빈 열/.test(n) && /16,?382/.test(n)), 먼열.notes.join(' / '));

  // 틈은 좁은데 칸이 많다 — 대각선. 줄 1200 × 열 1200 = 144만 칸.
  const 대각 = readXlsx(한시트(Array.from({ length: 1200 }, (_, i) => `<row r="${i + 1}">${글칸(`${열글자(i + 1)}${i + 1}`, String(i + 1))}</row>`).join('')));
  const 대각행 = 대각.sheets[0].rows;
  const 대각폭 = 대각행.reduce((m, r) => Math.max(m, r.length), 0);
  check('★★ 펼친 표의 칸 수에 상한이 있다 (100만 칸)', 대각행.length * 대각폭 <= 1_000_000 && 대각행.length > 0,
    `${대각행.length}줄 × ${대각폭}`);
  check('  앞쪽 값은 그대로', 대각행[0]?.[0] === '1' && 대각행[1]?.[1] === '2', '');
  check('★★ 그리고 아래쪽을 몇 줄 뺐는지 말한다', 대각.notes.some((n) => /상한/.test(n) && /줄/.test(n)), 대각.notes.join(' / '));

  /*
   * 주소(r) 없이 적힌 칸의 열은 **앞 칸 다음**이다 — 값이 있든 없든.
   *
   * 다시 짠 뒤로 「앞에서 값이 들어간 마지막 열 + 1」 로 셌다. 그러면 `<c/>` 나 값 없는
   * `<c s="2"></c>` 가 끼면 그 자리가 안 세어져 뒤 칸이 한 칸씩 왼쪽으로 당겨진다.
   * 엑셀은 r 을 늘 적지만 다른 도구가 만든 파일은 안 적기도 한다 (4회차 Gemini 리뷰 · 실행 확인).
   */
  const r없는칸 = (중간) => readXlsx(한시트(`<row><c t="inlineStr"><is><t>1</t></is></c>${중간}<c t="inlineStr"><is><t>3</t></is></c></row>`)).sheets[0].rows;
  check('★ r 없는 빈 칸 <c/> 도 한 칸을 차지한다', JSON.stringify(r없는칸('<c/>')) === '[["1","","3"]]', JSON.stringify(r없는칸('<c/>')));
  check('★ 값 없는 <c s="2"></c> 도 한 칸을 차지한다', JSON.stringify(r없는칸('<c s="2"></c>')) === '[["1","","3"]]', JSON.stringify(r없는칸('<c s="2"></c>')));
}

trace('엑셀6');
/*
 * 2.0.0 6회차 · Gemini 엑셀6 — 작은 xlsx 를 짜서 가린 여섯.
 *
 * 값 없는 공용문자열 칸(`<c t="s"></c>`)에 0번 글이 들어갔고, 불리언 `true` 가 FALSE 로 나왔고,
 * 인라인 문자열의 읽기표(`<rPh>`)가 본문에 붙었고, `x:` 접두사를 붙여 적은 파일은 「읽을 수 있는
 * 시트가 없습니다」 로 끝났다. `&#X41;` 은 안 풀렸고, 속성 값 속 `>` 에서 태그가 끊겨 날짜 서식을 놓쳤다.
 */
{
  const 짓기6 = (시트, { 공용 = '<sst><si><t>첫공용</t></si></sst>', 서식 = null, p = '' } = {}) => makeZip([
    { name: 'xl/workbook.xml', data: Buffer.from(`<${p}workbook xmlns:r="r"><${p}sheets><${p}sheet name="S" sheetId="1" r:id="rId1"/></${p}sheets></${p}workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/sharedStrings.xml', data: Buffer.from(공용) },
    ...(서식 ? [{ name: 'xl/styles.xml', data: Buffer.from(서식) }] : []),
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(시트) },
  ]);
  const 줄들6 = (시트, o) => { try { return JSON.stringify(readXlsx(짓기6(시트, o)).sheets[0].rows); } catch (e) { return `던짐 ${e.message}`; } };
  const 한줄6 = (칸들) => `<worksheet><sheetData><row r="1">${칸들}</row></sheetData></worksheet>`;

  const 빈공용 = 줄들6(한줄6('<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"></c><c r="C1" t="s"><v></v></c><c r="D1"><v>9</v></c>'));
  check('★ 값 없는 공용문자열 칸은 빈 칸이다 — 0번 글을 끌어오지 않는다 (6회차 엑셀6)', 빈공용 === '[["첫공용","","","9"]]', 빈공용);
  const 참거짓 = 줄들6(한줄6('<c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>true</v></c><c r="C1" t="b"></c><c r="D1" t="b"><v>0</v></c>'));
  check('★ 불리언 true 는 TRUE, 값 없는 불리언은 빈 칸 (6회차 엑셀6)', 참거짓 === '[["TRUE","TRUE","","FALSE"]]', 참거짓);
  const 읽기표 = 줄들6(한줄6('<c r="A1" t="inlineStr"><is><t>東京</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh></is></c>'));
  check('★ 인라인 문자열의 읽기표(rPh)는 본문에 안 붙인다 (6회차 엑셀6)', 읽기표 === '[["東京"]]', 읽기표);
  const 접두 = 줄들6('<x:worksheet xmlns:x="m"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1"><x:v>5</x:v></x:c></x:row></x:sheetData></x:worksheet>',
    { p: 'x:', 공용: '<x:sst xmlns:x="m"><x:si><x:t>첫공용</x:t></x:si></x:sst>' });
  check('★★ x: 접두사를 붙여 적은 파일도 읽는다 (6회차 엑셀6)', 접두 === '[["첫공용","5"]]', 접두);

  /*
   * ★★ 그 고침이 **반쪽**이었다 (막판 훑기).
   *
   * 태그 이름의 접두사는 떼어 놓고 관계 열쇠는 `r:id` 를 글자 그대로 찾았다. 접두사
   * 이름은 규격이 정하는 것이 아니라 그 파일이 정하는 별명이라(`xmlns:rel="…"`),
   * 다른 이름으로 적은 통합문서는 고침 뒤에도 똑같이 「읽을 수 있는 시트가 없습니다」
   * 로 죽었다. 윈도우 밖에서는 엑셀 COM 대체 길도 없어 그대로 끝난다.
   */
  const 관계접두 = (접두) => {
    const ns = 접두 ? ` xmlns:${접두}="rel"` : '';
    const 칸 = 접두 ? `${접두}:id` : 'id';
    const z = makeZip([
      { name: 'xl/workbook.xml', data: Buffer.from(`<workbook${ns}><sheets><sheet name="S" sheetId="1" ${칸}="rId1"/></sheets></workbook>`) },
      { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>') },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(한줄6('<c r="A1"><v>7</v></c>')) },
    ]);
    try { return JSON.stringify(readXlsx(z).sheets[0].rows); } catch (e) { return `던짐 ${e.message}`; }
  };
  for (const 접두 of ['r', 'rel', 'r2', null]) {
    check(`★★★ 관계 열쇠의 접두사가 무엇이든 시트를 찾는다 — ${접두 ?? '접두사 없음'}`,
      관계접두(접두) === '[["7"]]', 관계접두(접두));
  }
  check('★ &#X41; 대문자 X 도 푼다 (6회차 엑셀6)', unescapeXml('&#X41;&#x42;&#67;') === 'ABC', unescapeXml('&#X41;&#x42;&#67;'));
  const 날짜 = 줄들6(한줄6('<c r="A1" s="1"><v>45000</v></c>'),
    { 서식: '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="[>0]yyyy-mm-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>' });
  check('★ 속성 값 속 > 에서 태그를 안 끊는다 — 날짜 서식을 알아본다 (6회차 엑셀6)', 날짜 === '[["2023-03-15"]]', 날짜);

  /*
   * 날짜 서식을 가르는 것은 **따옴표·대괄호를 뺀 뒤 남은 글자**다 (8회차 · 바깥).
   *
   * 여기 「그러면서 숫자 서식은 아닌 것」 이라는 조건이 하나 더 붙어 있었는데,
   * 앞이 참이면 뒤는 **늘** 참이라 어떤 입력에도 안 걸리는 죽은 조건이었다
   * (무작정 다 돌려 봤다: 앞이 참인 1,560,474건 중 0건). 지키는 척만 하는 줄은
   * 다음 사람이 그 줄을 믿고 진짜 조건을 빼게 만든다. 죽은 줄을 지우고, 살아
   * 있는 쪽(글자가 있나)이 정말로 가르는지를 여기서 못 박는다.
   */
  const 돈서식 = 줄들6(한줄6('<c r="A1" s="1"><v>45000</v></c>'),
    { 서식: '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="#,##0.00_);[Red]\\(#,##0.00\\)"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>' });
  check('★ 글자가 없는 숫자 서식은 날짜가 아니다', 돈서식 === '[["45000"]]', 돈서식);
  const 붙는말 = 줄들6(한줄6('<c r="A1" s="1"><v>45000</v></c>'),
    { 서식: '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="#,##0&quot;days&quot;"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>' });
  check('★ 따옴표 안의 글자(days)는 붙는 말이라 날짜로 안 본다', 붙는말 === '[["45000"]]', 붙는말);
  const 시각서식 = 줄들6(한줄6('<c r="A1" s="1"><v>45000</v></c>'),
    { 서식: '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="[h]:mm:ss"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>' });
  check('★ 대괄호 밖에 글자가 남는 시각 서식은 날짜로 본다', 시각서식 !== '[["45000"]]', 시각서식);
}

trace('엑셀-셀주소');
{
  /*
   * 주석에 적힌 보기가 틀려 있었다 — 「BC12 → col 54」. BC 는 2×26+3 = 55 이고,
   * 54 는 BB 다. 코드가 맞고 주석이 틀렸다. 그 보기를 검사로 옮겨 못 박는다.
   */
  check('★ BC12 는 55열 12행이다 (BB 가 54)',
    cellRef('BC12').col === 55 && cellRef('BC12').row === 12 && cellRef('BB12').col === 54,
    JSON.stringify([cellRef('BC12'), cellRef('BB12')]));
  check('  A1 은 1열, Z1 은 26열, AA1 은 27열',
    cellRef('A1').col === 1 && cellRef('Z1').col === 26 && cellRef('AA1').col === 27,
    JSON.stringify([cellRef('A1').col, cellRef('Z1').col, cellRef('AA1').col]));
}

trace('10-치움');

trace('6-못읽은시트');

// ── 시트 하나를 못 읽고서 「다 읽었습니다」 라고 하면 안 된다 ────────────
//
// 엑셀에게 맡기는 길은 시트를 임시 txt 로 뽑아 하나씩 읽는다. 그중 하나를
// 못 읽으면 `catch { continue; }` 로 **조용히 건너뛰고** ok 로 돌아갔다.
// 사람과 모델에게는 시트 하나가 통째로 없는 표가 「다 읽었습니다」 로 간다 —
// 「그런 시트 없다」 와 구별이 안 되는 고장이다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-xlcom-'));
  writeFileSync(join(방, '1.txt'), '가\t나\n1\t2\n', 'utf8');
  // 2.txt 는 일부러 안 만든다 — 엑셀이 못 뽑았거나 백신이 지운 판이다.
  writeFileSync(join(방, '3.txt'), '다\n3\n', 'utf8');
  const r = 시트모으기(방, [{ i: 1, name: '첫장' }, { i: 2, name: '둘째장' }, { i: 3, name: '셋째장' }]);
  check('읽은 시트는 그대로 준다', r.sheets.length === 2 && r.sheets[0].name === '첫장', JSON.stringify(r.sheets.map((s) => s.name)));
  check('★★ 못 읽은 시트를 이름으로 남긴다', r.못읽은.length === 1 && /둘째장/.test(r.못읽은[0]),
    JSON.stringify(r.못읽은));
  check('다 읽으면 못 읽은 것이 없다', 시트모으기(방, [{ i: 1, name: '첫장' }]).못읽은.length === 0, '');

  /*
   * **하나도** 못 읽었을 때가 더 나빴다 (8회차 · 바깥).
   *
   * 시트가 다 못 읽힌 판에서 `못읽은` 목록을 통째로 버리고 「뽑아낼 시트가
   * 없습니다」 로 돌려줬다. 그 말은 **빈 통합문서**라는 뜻이라, 사람은 파일이
   * 원래 비었다고 믿는다 — 실은 시트 셋을 하나도 못 읽은 것이다. 위에서 이름을
   * 남기게 고쳐 놓고, 정작 그 이름이 제일 필요한 자리에서 버리고 있었다.
   */
  const 빈방 = mkdtempSync(join(tmpdir(), 'deel-xlcom0-'));
  const 하나도 = 시트모으기(빈방, [{ i: 1, name: '첫장' }, { i: 2, name: '둘째장' }]);
  const 답 = 빈시트답(하나도.못읽은);
  check('★★ 하나도 못 읽었으면 「시트가 없다」 고 하지 않는다',
    !/뽑아낼 시트가 없습니다/.test(답.message ?? ''), String(답.message));
  check('★★ 못 읽은 시트 이름을 그 말에 담는다',
    /첫장/.test(답.message ?? '') && /둘째장/.test(답.message ?? '') && 답.못읽은?.length === 2,
    String(답.message));
  check('  정말로 시트가 없는 판은 여태 말대로다',
    빈시트답([]).reason === 'empty' && /뽑아낼 시트가 없습니다/.test(빈시트답([]).message),
    JSON.stringify(빈시트답([])));
  rmSync(빈방, { recursive: true, force: true });
  rmSync(방, { recursive: true, force: true });
}

trace('6b-엑셀을시킬수있나');
{
  /*
   * `canUseExcel()` 은 **판**을 보는 문지기다 — 윈도우가 아니면 엑셀을 시킬 길이
   * 아예 없다. 「엑셀이 깔렸나」 를 여기서 답하지는 않는다. 그건 실제로 불러 봐야
   * 알고(등록만 되고 실행이 안 되는 자리가 흔하다), 그 답은 없는엑셀() 이 COM 번호로
   * 가려서 사람 말로 돌려준다. 이 검사는 두 문장이 서로 다른 일을 한다는 것을 못 박는다.
   */
  check('canUseExcel 은 판만 본다 (win32 인가)',
    canUseExcel() === (process.platform === 'win32'), `${process.platform} → ${canUseExcel()}`);
  check('★ 엑셀이 없다는 답은 COM 번호로 가린다 — 말로 안 가린다',
    없는엑셀('0x80040154 Class not registered') && 없는엑셀('CO_E_SERVER_EXEC_FAILURE')
    && !없는엑셀('암호가 맞지 않습니다'), '');
}

// ── 한글 암호가 파워셸까지 **그대로** 닿나 (막판 훑기) ──────────────────
trace('9-한글암호');
/*
 * ★★★ 나가는 쪽(stdout)은 decode() 로 콘솔 인코딩을 제대로 푸는데, **들어가는 쪽**은
 * UTF-8 로 써 보내고 있었다. `[Console]::In` 은 이 PC 의 콘솔 입력 코드페이지로 읽으므로,
 * 한글 암호 다섯 글자가 딴 글자 일곱 개가 된다. 엑셀은 당연히 거절하고, 사람은
 * 「암호가 맞지 않습니다 (2/3)」 를 세 번 본 뒤 제 파일에서 쫓겨난다 — 맞는 암호를
 * 넣었는데. 한국 회사 문서에서 흔한 자리다.
 *
 * 엑셀 없이도 잰다: 스크립트에서 **암호를 읽는 앞부분만** 떼어 파워셸에 그대로 물린다.
 */
if (process.platform === 'win32') {
  const { spawn } = await import('node:child_process');
  const 앞 = `${SCRIPT.split('$xl = $null')[0]}
[Console]::Out.Write((($pw.ToCharArray() | ForEach-Object { [int]$_ }) -join ","))
`;
  const enc = Buffer.from(앞, 'utf16le').toString('base64');
  const 받은것 = await new Promise((done) => {
    const kid = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, DEEL_XL_IN: 'a', DEEL_XL_OUT: 'b' },
    });
    let 밖 = '';
    kid.stdout.on('data', (c) => { 밖 += c; });
    kid.on('error', () => done(null));
    kid.on('close', () => done(밖.trim()));
    try { kid.stdin.write('비밀번호1\n', 'utf8'); kid.stdin.end(); } catch { done(null); }
  });
  const 바라는것 = [...'비밀번호1'].map((c) => c.codePointAt(0)).join(',');
  if (받은것 == null) check('(파워셸을 못 불러서 한글 암호 자리는 못 쟀습니다)', true, '');
  else check('★★★ 한글 암호가 파워셸까지 글자 그대로 닿는다', 받은것 === 바라는것, `${받은것} ≠ ${바라는것}`);
} else {
  check('(윈도우가 아니라 한글 암호 자리는 못 쟀습니다)', true, process.platform);
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n엑셀 읽기 검사  ${D}(규격대로 만든 파일로. 진짜 엑셀 출력 대조는 아직)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
