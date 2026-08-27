/**
 * 사내 문서 읽기 — hwpx · docx · pptx → 글.
 *
 * ── 여기서 재는 것 ──────────────────────────────────────────────────────
 *
 * 사내망의 스펙·공문·회의록이 이 세 형식이다. 지금까지는 "바이너리라 못 읽음"
 * 으로 끝났고, 그 끝이 사고를 낳았다 — hwp 를 정리해 달라고 했더니 Read 가
 * 실패하자 모델이 Write 로 새로 써서 원본이 죽었다(지금은 막혀 있다).
 * 읽기가 되면 그 길 자체가 없어진다.
 *
 * 셋 다 속은 ZIP + XML 이다. 우리 zip 읽개(pack/zip.js)와 xlsx 의 XML
 * 읽기(tags)를 그대로 쓴다 — 의존성 0개 그대로.
 *
 * 검사가 지키는 선 —
 *   · 글의 **차례**가 문서의 차례와 같다 (뒤섞이면 안 읽은 것보다 나쁘다)
 *   · 표는 표로 보인다 (칸이 한 덩어리로 이어 붙으면 뜻이 사라진다)
 *   · 고치기는 못 한다고 **또렷하게** 거절한다 (일반 '바이너리' 오류가 아니라)
 *   · 구형 hwp 는 못 읽는다고 말하고 **어떻게 하면 되는지**를 같이 준다
 *   · 깨진 파일은 깨졌다고 말한다 — 빈 글을 돌려주지 않는다
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeZip } from '../src/pack/zip.js';
import { isDocPath, readDoc, toText as docText, summarize as docSummary, 종류 } from '../src/tools/docs.js';
import { runTool, TOOLS } from '../src/tools/index.js';
import { 도구설명EN } from '../src/tools/desc.en.js';
import { makeScope } from '../src/safety/guard.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 적어둘것 = [];

const root = mkdtempSync(join(tmpdir(), 'deel-docs-'));
mkdirSync(join(root, '문서'), { recursive: true });

const ctx = () => ({
  scope: makeScope(root),
  history: { snapshot() {} },
  audit: { tool() {} },
  seen: new Set(),
  모델컨텍스트: 32768,
});

// ── 꾸러미 만들기. 우리 zip 쓰개로 진짜 zip 을 만든다 — 흉내 바이트가 아니다.
const 담기 = (경로, 항목들) => writeFileSync(join(root, 경로), makeZip(항목들.map(([p, 글]) => ({ name: p, data: Buffer.from(글, 'utf8') }))));

// ══ 1. 확장자 판별 ══════════════════════════════════════════════════════
trace('1-판별');
{
  for (const p of ['a.hwpx', 'b.docx', 'c.pptx', '한 글/보고서.HWPX']) {
    check(`${p} 는 문서다`, isDocPath(p), '');
  }
  for (const p of ['a.hwp', 'a.xlsx', 'a.txt', 'a.zip', 'a.md', '', null]) {
    check(`${p} 는 이 길이 아니다`, !isDocPath(p), '');
  }
  // 구형 hwp 는 isDocPath 가 아니라 별도 안내 대상이다 — 아래 6절.
  check('종류를 안다', 종류('a.hwpx') === 'hwpx' && 종류('b.docx') === 'docx' && 종류('c.pptx') === 'pptx');
}

// ══ 2. hwpx ═════════════════════════════════════════════════════════════
trace('2-hwpx');
{
  const 구획 = (n, 몸) => `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hp="x">${몸}</hs:sec>`;
  담기('문서/보고.hwpx', [
    ['mimetype', 'application/hwp+zip'],
    ['Contents/content.hpf', '<opf/>'],
    ['Contents/section0.xml', 구획(0,
      '<hp:p><hp:run><hp:t>첫 문단입니다.</hp:t></hp:run></hp:p>'
      + '<hp:p><hp:run><hp:t>둘째 </hp:t></hp:run><hp:run><hp:t>문단.</hp:t></hp:run></hp:p>'
      + '<hp:tbl><hp:tr><hp:tc><hp:p><hp:run><hp:t>이름</hp:t></hp:run></hp:p></hp:tc>'
      + '<hp:tc><hp:p><hp:run><hp:t>값</hp:t></hp:run></hp:p></hp:tc></hp:tr>'
      + '<hp:tr><hp:tc><hp:p><hp:run><hp:t>가</hp:t></hp:run></hp:p></hp:tc>'
      + '<hp:tc><hp:p><hp:run><hp:t>1 &amp; 2</hp:t></hp:run></hp:p></hp:tc></hp:tr></hp:tbl>')],
    ['Contents/section1.xml', 구획(1, '<hp:p><hp:run><hp:t>다음 장.</hp:t></hp:run></hp:p>')],
  ]);

  const r = readDoc(join(root, '문서/보고.hwpx'));
  check('hwpx: 읽힌다', r.ok === true, r.error ?? '');
  const { text } = docText(r.덩이들);
  check('hwpx: 문단이 차례대로', text.indexOf('첫 문단') >= 0 && text.indexOf('첫 문단') < text.indexOf('둘째 문단'), text.slice(0, 80));
  check('hwpx: 나뉜 run 이 한 문단으로 붙는다', text.includes('둘째 문단.'), '');
  check('hwpx: 표가 표로 보인다', /이름\s*\|\s*값/.test(text) && /가\s*\|\s*1 & 2/.test(text), text);
  check('hwpx: XML 표기가 풀린다 (&amp; → &)', text.includes('1 & 2'), '');
  check('hwpx: 구획이 갈려 있다', r.덩이들.length === 2, String(r.덩이들.length));
  check('hwpx: 둘째 구획도 온다', text.includes('다음 장.'), '');
  check('hwpx: 요약이 셈을 말한다', /hwpx/.test(docSummary(r)), docSummary(r));
}

// ══ 3. docx ═════════════════════════════════════════════════════════════
trace('3-docx');
{
  담기('문서/공문.docx', [
    ['[Content_Types].xml', '<Types/>'],
    ['word/document.xml',
      '<?xml version="1.0"?><w:document xmlns:w="x"><w:body>'
      + '<w:p><w:r><w:t>제목: 검토 요청</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t xml:space="preserve">붙임 </w:t></w:r><w:r><w:t>1부.</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>앞</w:t><w:tab/><w:t>뒤</w:t></w:r></w:p>'
      + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>항목</w:t></w:r></w:p></w:tc>'
      + '<w:tc><w:p><w:r><w:t>내용</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
      + '</w:body></w:document>'],
  ]);
  const r = readDoc(join(root, '문서/공문.docx'));
  check('docx: 읽힌다', r.ok === true, r.error ?? '');
  const { text } = docText(r.덩이들);
  check('docx: 문단 차례가 맞다', text.indexOf('제목') < text.indexOf('붙임'), '');
  check('docx: 나뉜 run 이 붙는다', text.includes('붙임 1부.'), text);
  check('docx: 탭이 사이를 벌린다', /앞\t뒤/.test(text), JSON.stringify(text.match(/앞.*뒤/)?.[0] ?? ''));
  check('docx: 표가 표로 보인다', /항목\s*\|\s*내용/.test(text), '');
}

// ══ 4. pptx ═════════════════════════════════════════════════════════════
trace('4-pptx');
{
  const 판 = (몸) => `<?xml version="1.0"?><p:sld xmlns:a="x"><p:cSld>${몸}</p:cSld></p:sld>`;
  담기('문서/발표.pptx', [
    ['[Content_Types].xml', '<Types/>'],
    // 이름 차례 함정: 글자로 세우면 slide10 이 slide2 앞에 온다. 숫자로 세워야 한다.
    ['ppt/slides/slide10.xml', 판('<a:p><a:r><a:t>열째 장</a:t></a:r></a:p>')],
    ['ppt/slides/slide1.xml', 판('<a:p><a:r><a:t>첫 장 제목</a:t></a:r></a:p><a:p><a:r><a:t>부제</a:t></a:r></a:p>')],
    ['ppt/slides/slide2.xml', 판('<a:p><a:r><a:t>둘째 장</a:t></a:r></a:p>')],
  ]);
  const r = readDoc(join(root, '문서/발표.pptx'));
  check('pptx: 읽힌다', r.ok === true, r.error ?? '');
  const { text } = docText(r.덩이들);
  check('pptx: 장 차례가 숫자 차례다',
    text.indexOf('첫 장') < text.indexOf('둘째 장') && text.indexOf('둘째 장') < text.indexOf('열째 장'), '');
  check('pptx: 장이 구획으로 갈린다', r.덩이들.length === 3, String(r.덩이들.length));
  check('pptx: 구획 이름에 장 번호가 있다', r.덩이들.some((d) => /2/.test(d.이름)), r.덩이들.map((d) => d.이름).join());
}

// ══ 5. Read 도구로 ══════════════════════════════════════════════════════
trace('5-Read로');
{
  const c = ctx();
  const r = await runTool('Read', { file_path: '문서/보고.hwpx' }, c);
  check('Read: 문서가 글로 온다', !r.error && r.content.includes('첫 문단'), r.error ?? r.content?.slice(0, 60));
  check('Read: 고칠 수 없다고 같이 말한다', /고칠 수 없/.test(r.content), '');
  check('Read: seen 에 안 오른다 — 고칠 물건이 아니다', !c.seen.has(join(root, '문서/보고.hwpx')), '');
  check('Read: 요약이 형식을 말한다', /hwpx/.test(r.summary ?? ''), r.summary);

  // 고치기는 또렷하게 거절한다. 일반 '바이너리' 오류로 넘기지 않는다 —
  // 그 오류는 '왜 안 되는지' 를 모델에게 안 가르쳐서, 모델이 우회로를 찾는다.
  const w = await runTool('Write', { file_path: '문서/보고.hwpx', content: 'x' }, c);
  check('Write: 문서라서 못 고친다고 말한다', !!w.error && /읽기만|고칠 수 없/.test(w.error), w.error);
  const e = await runTool('Edit', { file_path: '문서/보고.hwpx', old_string: 'a', new_string: 'b' }, c);
  check('Edit: 같은 거절', !!e.error && /읽기만|고칠 수 없/.test(e.error), e.error);

  // 도구 설명이 문서를 말한다 — 한국어와 영어 둘 다.
  check('설명(한)이 문서 형식을 말한다', /hwpx/.test(TOOLS.Read.schema.description), '');
  check('설명(영)도 문서 형식을 말한다', /hwpx/i.test(도구설명EN.Read.desc), '');
}

// ══ 6. 안 되는 것들 — 정직하게 ══════════════════════════════════════════
trace('6-안되는것');
{
  // 구형 hwp (OLE). 못 읽는다고 말하고, 어떻게 하면 되는지를 같이 준다.
  const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
  writeFileSync(join(root, '문서/옛것.hwp'), ole);
  const r1 = await runTool('Read', { file_path: '문서/옛것.hwp' }, ctx());
  check('구형 hwp: 못 읽는다고 말한다', !!r1.error, JSON.stringify(r1).slice(0, 80));
  check('구형 hwp: hwpx 로 저장하라는 길을 준다', /hwpx/.test(r1.error ?? ''), r1.error);

  // 깨진 꾸러미. 빈 글을 돌려주면 모델은 '빈 문서' 로 오해한다.
  writeFileSync(join(root, '문서/깨짐.docx'), Buffer.from('PK\x03\x04깨진 것', 'utf8'));
  const r2 = readDoc(join(root, '문서/깨짐.docx'));
  check('깨진 파일: 오류로 말한다', r2.ok === false && !!r2.error, JSON.stringify(r2).slice(0, 80));

  // 진짜 zip 인데 문서가 아닌 것.
  담기('문서/그냥.docx', [['readme.txt', '문서 아님']]);
  const r3 = readDoc(join(root, '문서/그냥.docx'));
  check('알맹이 없는 꾸러미: 오류로 말한다', r3.ok === false && /찾지 못|없습니다/.test(r3.error ?? ''), r3.error);

  // 빈 문단뿐인 문서. 오류가 아니라 '빈 문서' 다 — 둘은 다르다.
  담기('문서/빈것.hwpx', [['Contents/section0.xml', '<hs:sec><hp:p></hp:p></hs:sec>']]);
  const r4 = readDoc(join(root, '문서/빈것.hwpx'));
  check('빈 문서: 오류가 아니다', r4.ok === true, r4.error ?? '');
  const 빈글 = docText(r4.덩이들);
  check('빈 문서: 글이 비었다고 표가 난다', 빈글.text.trim().length === 0 || /비어/.test(빈글.text), JSON.stringify(빈글.text.slice(0, 40)));
}

// ══ 7. 긴 문서는 창에 맞게 ══════════════════════════════════════════════
trace('7-긴문서');
{
  const 문단들 = Array.from({ length: 3000 }, (_, i) => `<hp:p><hp:run><hp:t>문단 ${i + 1} 입니다. ${'같은 말을 늘려 창을 넘겨 본다. '.repeat(3)}</hp:t></hp:run></hp:p>`).join('');
  담기('문서/긴것.hwpx', [['Contents/section0.xml', `<hs:sec>${문단들}</hs:sec>`]]);
  const r = readDoc(join(root, '문서/긴것.hwpx'));
  const { text, 잘림 } = docText(r.덩이들);
  check('긴 문서: 다 안 싣는다', text.length < 200000, String(text.length));
  check('긴 문서: 잘랐으면 잘랐다고 말한다', 잘림.length > 0, JSON.stringify(잘림));
  적어둘것.push(`긴 문서 3,000문단 → ${text.length.toLocaleString()}자로 잘라 실음`);
}

rmSync(root, { recursive: true, force: true });

// ── 마무리 ──────────────────────────────────────────────────────────────
const C = (n, s) => (process.stdout.isTTY || process.env.FORCE_COLOR ? `\x1b[${n}m${s}\x1b[0m` : s);
console.log('');
for (const f of fail) console.log(`  ${C(31, '✗')} ${f.name}${f.note ? C(90, `  ${f.note}`) : ''}`);
for (const 글 of 적어둘것) console.log(`  ${C(90, `· ${글}`)}`);
console.log('');
console.log(`  ${pass.length}개 통과 · ${fail.length}개 실패`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
