// 글자 인코딩 검증.
//
// 가장 중요한 것은 '읽을 수 있다' 가 아니라 '고쳐도 안 상한다' 다.
// 사내 문서는 UTF-8 이 아닌 경우가 흔한데, 읽고 고쳐 저장하면서 조용히
// UTF-8 로 바뀌면 원본을 잃는다. 그래서 왕복을 본다.
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encode, decode, detect, isUtf8, bomOf, looksBinary, label, LEGACY } from '../src/tools/encoding.js';
import { readTextFull } from '../src/tools/fsutil.js';
import { runTool } from '../src/tools/index.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 1. UTF-8 인지 알아보기 ──────────────────────────────────────────────
check('ASCII 는 UTF-8', isUtf8(Buffer.from('hello world', 'ascii')));
check('한글 UTF-8 은 UTF-8', isUtf8(Buffer.from('한글입니다', 'utf8')));
check('CP949 바이트는 UTF-8 아님', !isUtf8(encode('한글입니다', 'euc-kr').buf));
check('짧게 쓸 걸 길게 쓴 것 거절', !isUtf8(Buffer.from([0xC0, 0x80])));
check('꼬리 없는 앞바이트 거절', !isUtf8(Buffer.from([0xE0, 0x81])));
check('UTF-8 에 없는 바이트 거절', !isUtf8(Buffer.from([0xFF, 0xFE, 0x41])));
check('빈 것은 UTF-8', isUtf8(Buffer.alloc(0)));

// ── 2. 앞머리 표식 ──────────────────────────────────────────────────────
check('UTF-8 BOM 알아봄', bomOf(Buffer.from([0xEF, 0xBB, 0xBF, 0x41]))?.id === 'utf-8');
check('UTF-16LE BOM 알아봄', bomOf(Buffer.from([0xFF, 0xFE, 0x41, 0x00]))?.id === 'utf-16le');
check('표식 없으면 null', bomOf(Buffer.from('abc')) === null);
{
  const withBom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('한글', 'utf8')]);
  const r = decode(withBom);
  check('BOM 은 내용에서 걷어냄', r.text === '한글', JSON.stringify(r.text));
}

// ── 3. 바이너리는 글로 안 읽는다 ────────────────────────────────────────
check('NUL 있으면 바이너리', looksBinary(Buffer.from([0x50, 0x4B, 0x00, 0x01])));
check('보통 글은 바이너리 아님', !looksBinary(Buffer.from('평범한 글\n', 'utf8')));

// ── 4. 왕복 — 이게 핵심이다 ─────────────────────────────────────────────
const 표본 = {
  'euc-kr': '품의서 결재 요청드립니다.\n금액: 1,200,000원\n',
  'shift_jis': '日本語のテキストです。\n',
  'gbk': '中文文本内容。\n',
  'big5': '繁體中文內容。\n',
  'windows-1252': 'Café naïve résumé\n',
};
for (const [enc, 글] of Object.entries(표본)) {
  const e = encode(글, enc);
  check(`${label(enc)} 왕복`, decode(e.buf, { fallback: enc }).text === 글,
    JSON.stringify(decode(e.buf, { fallback: enc }).text));
  check(`${label(enc)} 는 UTF-8 보다 짧거나 같다`, e.buf.length <= Buffer.byteLength(글, 'utf8'),
    `${e.buf.length} vs ${Buffer.byteLength(글, 'utf8')}`);
}
check('UTF-8 왕복', decode(encode('아무 글이나', 'utf-8').buf).text === '아무 글이나');

// ── 5. 못 담는 글자는 뭉개지 않고 알린다 ────────────────────────────────
{
  const r = encode('한글과 이모지 🚀', 'euc-kr');
  check('못 담는 글자를 알려줌', r.lost.includes('🚀'), JSON.stringify(r.lost));
  const r2 = encode('한글만 있음', 'euc-kr');
  check('담을 수 있으면 조용함', r2.lost.length === 0, JSON.stringify(r2.lost));
}

// ── 6. 알아보기 순서 ────────────────────────────────────────────────────
check('표식이 있으면 그게 우선', detect(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('x')])).sure === true);
check('UTF-8 이면 확신함', detect(Buffer.from('한글', 'utf8')).sure === true);
check('아니면 짐작이라고 말함', detect(encode('한글', 'euc-kr').buf, { fallback: 'euc-kr' }).sure === false);
check('아는 인코딩 목록이 있다', LEGACY.length >= 5 && LEGACY.every((x) => x.id && x.cp));

// ── 7. 도구를 통해 실제로 ───────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'deel-enc-'));
const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
ctx.history.nextTurn();

writeFileSync(join(root, '사내문서.txt'), encode('품의서\n금액: 1,200,000원\n비고: 긴급\n', 'euc-kr').buf);
writeFileSync(join(root, '보통문서.md'), '# 안내\nUTF-8 문서\n', 'utf8');

{
  const r = readTextFull(join(root, '사내문서.txt'));
  check('readTextFull 이 인코딩을 알려줌', r.encoding === 'euc-kr', r.encoding);
  check('내용이 안 깨짐', r.text.startsWith('품의서'), JSON.stringify(r.text.slice(0, 10)));
}

{
  const r = await runTool('Read', { file_path: '사내문서.txt' }, ctx);
  check('Read 가 CP949 를 읽음', r.content.includes('품의서'), r.error ?? r.content.slice(0, 40));
  check('Read 요약에 인코딩이 뜸', r.summary.includes('CP949'), r.summary);
}

{
  const r = await runTool('Edit', {
    file_path: '사내문서.txt', old_string: '1,200,000원', new_string: '1,500,000원',
  }, ctx);
  check('CP949 파일을 고칠 수 있음', !r.error, r.error ?? '');
  const 뒤 = decode(readFileSync(join(root, '사내문서.txt')));
  check('고친 뒤에도 CP949 그대로', 뒤.encoding === 'euc-kr', 뒤.encoding);
  check('고친 내용이 맞음', 뒤.text.includes('1,500,000원'), JSON.stringify(뒤.text.split('\n')[1]));
  check('나머지도 안 깨짐', 뒤.text.includes('품의서') && 뒤.text.includes('긴급'));
}

{
  // 못 담는 글자를 넣으려 하면 안 쓰고 멈춘다 — 조용히 뭉개는 것보다 낫다
  const 전 = readFileSync(join(root, '사내문서.txt'));
  const r = await runTool('Edit', { file_path: '사내문서.txt', old_string: '긴급', new_string: '긴급 🚀' }, ctx);
  check('못 담는 글자는 거절', !!r.error, r.error?.split('\n')[0] ?? '통과해 버림');
  check('거절할 때 이유를 말함', (r.error ?? '').includes('CP949'), r.error?.split('\n')[0] ?? '');
  check('거절하면 원본을 안 건드림', Buffer.compare(전, readFileSync(join(root, '사내문서.txt'))) === 0);
}

{
  await runTool('Read', { file_path: '보통문서.md' }, ctx);
  const r = await runTool('Edit', { file_path: '보통문서.md', old_string: 'UTF-8 문서', new_string: 'UTF-8 문서입니다 🚀' }, ctx);
  check('UTF-8 파일에는 이모지가 들어감', !r.error, r.error ?? '');
  check('UTF-8 파일은 UTF-8 그대로', decode(readFileSync(join(root, '보통문서.md'))).encoding === 'utf-8');
}

{
  // 새로 만드는 파일은 UTF-8 이다. 요즘 만드는 것까지 옛 인코딩으로 둘 이유가 없다.
  const r = await runTool('Write', { file_path: '새파일.txt', content: '새로 만든 글 🚀\n' }, ctx);
  check('새 파일은 UTF-8', !r.error && decode(readFileSync(join(root, '새파일.txt'))).encoding === 'utf-8', r.error ?? '');
}

{
  const r = await runTool('Bash', { command: 'echo 한글 출력' }, ctx);
  check('명령 출력의 한글이 안 깨짐', r.content.includes('한글'), JSON.stringify(r.content.trim().slice(0, 30)));
}

rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n글자 인코딩 검사  ${D}(읽고 고쳐도 원본이 안 상하는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
