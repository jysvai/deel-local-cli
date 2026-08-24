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

trace('10-치움');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n엑셀 읽기 검사  ${D}(규격대로 만든 파일로. 진짜 엑셀 출력 대조는 아직)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
