// 글자 인코딩 검증.
//
// 가장 중요한 것은 '읽을 수 있다' 가 아니라 '고쳐도 안 상한다' 다.
// 사내 문서는 UTF-8 이 아닌 경우가 흔한데, 읽고 고쳐 저장하면서 조용히
// UTF-8 로 바뀌면 원본을 잃는다. 그래서 왕복을 본다.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encode, decode, detect, isUtf8, bomOf, looksBinary, label, LEGACY, consoleCodepage, guess, 이름정리, 바꾼데만쓰기, utf16인가 } from '../src/tools/encoding.js';
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

// ── 6-2. 컴퓨터 설정이 달라도 같은 답이 나와야 한다 ─────────────────────
//
// 전에는 'UTF-8 이 아니면 이 컴퓨터 기본 코드페이지' 였다. 한국 윈도우에서만
// 맞는 코드였고, 그래서 우분투·미국 윈도우 CI 에서 여섯 갈래가 전부 죽었다.
// 여기서 그 상황을 그대로 만들어 본다 — system 을 넣어 다른 컴퓨터인 척 시킨다.
{
  const 문장 = {
    'euc-kr': '품의서 결재 요청드립니다.\n금액: 1,200,000원\n비고: 긴급\n',
    'shift_jis': 'お世話になっております。よろしくお願いいたします。\n',
    'gbk': '这是一个简体中文的测试文档。\n',
    'big5': '這是一個繁體中文的測試文件。\n',
    'windows-1252': 'Über die Straße, dépôt général\n',
  };
  // 우분투(UTF-8), 미국 윈도우(1252), 한국 윈도우(949), 일본 윈도우(932)
  for (const 척 of ['windows-1252', 'euc-kr', 'shift_jis', 'gbk']) {
    for (const [정답, 글] of Object.entries(문장)) {
      const r = decode(encode(글, 정답).buf, { system: 척 });
      check(`${label(척)} 컴퓨터에서도 ${label(정답)} 를 맞힘`,
        r.encoding === 정답 && r.text === 글, `${r.encoding} — ${r.why}`);
    }
  }
  // 짐작은 짐작이라고 말한다. 확신한다고 하면 부르는 쪽이 방심한다.
  check('짐작은 확신이라고 말하지 않음', decode(encode('품의서', 'euc-kr').buf).sure === false);
  // 근거를 남긴다 — 왜 그렇게 골랐는지 물어볼 수 있어야 한다.
  check('왜 그렇게 골랐는지 말함', /짐작|힌트|말이 안 됨/.test(detect(encode('품의서 결재', 'euc-kr').buf).why ?? ''));
}

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
  /*
   * 표식도 없고 UTF-8 규칙에도 안 맞으면 남은 길은 내용을 보고 점수를 매기는
   * 짐작뿐이다. CP949 와 CP932 는 바이트 범위가 겹쳐서 짧은 파일일수록 자주
   * 뒤집힌다. 그 확신도를 여태 재 놓고 아무 데서도 안 읽어서, 화면에는 짐작이
   * 사실처럼 `CP949` 한 낱말로 떴다 — 사람은 잘 읽힌 줄 알고 그 위에서 고친다.
   */
  check('짐작한 인코딩은 짐작이라고 적는다', r.summary.includes('추정'), r.summary);
}

{
  // 앞머리 표식이 있으면 짐작이 아니다. 확실한 것까지 「추정」 이라고 적으면
  // 곧 그 낱말을 아무도 안 읽는다.
  writeFileSync(join(root, 'bom문서.txt'),
    Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('표식 있음\n', 'utf8')]));
  const r = await runTool('Read', { file_path: 'bom문서.txt' }, ctx);
  check('표식이 있으면 인코딩을 확정으로 적는다',
    r.summary.includes('UTF-8(BOM)') && !r.summary.includes('추정'), r.summary ?? r.error);
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

/*
 * ── Read 를 안 거친 Write 가 인코딩을 갈아엎지 않는가 ────────────────────
 *
 * 「이 파일 전체를 다시 써 줘」 는 모델이 Read 없이 바로 Write 로 가는 흔한
 * 모양이다. 그때 이 도구는 인코딩을 **캐시(ctx.enc)에서만** 찾고, 없으면
 * UTF-8 로 때웠다. 그래서 사내 CP949 문서가 조용히 UTF-8 로 바뀌었다 —
 * 화면에는 `덮어씀: 사내문서.txt (4줄)` 한 줄뿐이다. 인코딩이 바뀌었다는
 * 표기는 「원래가 utf-8 이 아닐 때」 만 붙는데, 그 원래가 이미 틀렸다.
 *
 * 사람이 겪는 것은 이렇다: 사내 뷰어에서 한글이 깨지고, .bat 이면 안 돌고,
 * 「한 줄만 고쳐 달라」 고 했을 뿐이라 원인을 인코딩으로 이을 길이 없다.
 *
 * 고친 자리는 바로 위 줄이다 — Write 는 이미 diff 를 만들려고 readTextFull()
 * 을 부르고 있었고, 잰 인코딩을 버리고 있었다. 재는 값이 있는데 캐시를 볼
 * 까닭이 없다.
 */
{
  const 원래바이트 = encode('결재 품의서\n금액: 1,200,000원\n비고: 긴급\n', 'euc-kr').buf;
  writeFileSync(join(root, '안읽은문서.txt'), 원래바이트);
  // ctx.enc 를 일부러 비워 둔다 — Read 를 한 번도 안 한 상태 그대로.
  const 캐시없는ctx = { ...ctx, enc: new Map() };

  const r = await runTool('Write', {
    file_path: '안읽은문서.txt',
    content: '결재 품의서\n금액: 1,500,000원\n비고: 긴급\n',
  }, 캐시없는ctx);
  check('Read 없이 Write 가 된다', !r.error, r.error ?? '');

  const 뒤 = decode(readFileSync(join(root, '안읽은문서.txt')));
  check('★★ Read 를 안 거쳐도 CP949 그대로 쓴다', 뒤.encoding === 'euc-kr', 뒤.encoding);
  check('★ 내용도 맞다', 뒤.text.includes('1,500,000원') && 뒤.text.includes('품의서'),
    JSON.stringify(뒤.text.slice(0, 40)));
  check('★ 무슨 인코딩으로 썼는지 화면에 적는다', /CP949|EUC-KR/i.test(String(r.content)),
    String(r.content));
}

{
  /*
   * 반대쪽 — 캐시가 **낡았을** 때. 우리가 CP949 로 잡아 둔 뒤에 다른
   * 프로그램이 그 파일을 UTF-8 로 저장했으면, 캐시를 믿는 쪽이 틀린다.
   * 지금은 그 자리에서 다시 재므로 캐시가 무엇을 들고 있든 상관이 없다.
   */
  writeFileSync(join(root, '남이바꾼문서.txt'), Buffer.from('이제는 UTF-8 문서 🚀\n', 'utf8'));
  const 낡은ctx = { ...ctx, enc: new Map([[join(root, '남이바꾼문서.txt'), 'euc-kr']]) };
  const r = await runTool('Write', {
    file_path: '남이바꾼문서.txt', content: '이제는 UTF-8 문서 🚀 고쳤습니다\n',
  }, 낡은ctx);
  check('★★ 낡은 인코딩 캐시 때문에 거절하지 않는다', !r.error, r.error?.split('\n')[0] ?? '');
  const 뒤 = decode(readFileSync(join(root, '남이바꾼문서.txt')));
  check('★★ 지금 파일의 인코딩(UTF-8)으로 쓴다', 뒤.encoding.startsWith('utf-8'), 뒤.encoding);
  check('★ 이모지가 살아 있다', 뒤.text.includes('🚀'), JSON.stringify(뒤.text));
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
  // 명령 출력이 바이트로 들어와 제대로 풀리는지.
  //
  // 한글로 보려면 운영체제 쪽 조건이 맞아야 한다. 미국 윈도우 명령창은
  // 코드페이지가 437 이라 echo 가 한글을 **애초에 못 내보낸다**. 그건 이
  // 코드의 잘못이 아니라 그 컴퓨터의 한계다. CI 러너가 그렇다.
  // 그래서 둘로 나눈다 — 항상 되어야 하는 것과, 될 수 있을 때만 보는 것.
  const a = await runTool('Bash', { command: 'echo hello-encoding' }, ctx);
  check('명령 출력을 바이트로 받아 푼다', a.content.includes('hello-encoding'), JSON.stringify(a.content.trim().slice(0, 40)));

  const 한글가능 = process.platform !== 'win32' || [949, 65001].includes(consoleCodepage());
  const b = await runTool('Bash', { command: 'echo 한글 출력' }, ctx);
  if (한글가능) {
    check('명령 출력의 한글이 안 깨짐', b.content.includes('한글'), JSON.stringify(b.content.trim().slice(0, 30)));
  } else {
    // 그래도 뭔가는 나와야 한다. 조용히 건너뛰면 고장을 못 본다.
    check(`한글 못 내보내는 콘솔(${consoleCodepage()})에서도 죽지는 않음`,
      typeof b.content === 'string' && b.content.length > 0, JSON.stringify(b.content.trim().slice(0, 30)));
  }
}

// ── UTF-16 텍스트를 「바이너리」 라고 거절하지 않는가 ────────────────────
//
// ★★★ UTF-16 은 영문 한 글자를 두 바이트로 쓰고 뒤 한 바이트가 0 이다.
// 「0 바이트가 있으면 그림」 이라는 잣대에 멀쩡한 글 파일이 통째로 걸렸다.
//
//     Read notes.txt  →  ✗ 바이너리 파일입니다 — 텍스트로 읽을 수 없습니다
//
// 앞머리에 표식(BOM)이 찍혀 있어도 그랬다. 이 저장소는 utf-16le 를 알아보고
// 읽고 바이트까지 똑같이 되돌려 쓸 줄 아는데, 그 앞에서 막혔다. 윈도우에서
// 만든 파일에 흔한 인코딩이라 남의 파일이 아니라 제 파일에서 걸린다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'enc16-'));
  const be = (s) => {
    const le = Buffer.from(s, 'utf16le');
    for (let i = 0; i + 1 < le.length; i += 2) { const t = le[i]; le[i] = le[i + 1]; le[i + 1] = t; }
    return le;
  };
  const 글 = '안녕하세요\r\n둘째 줄입니다\r\n';
  const 영문 = 'Hello world\r\nsecond line\r\n';
  const 것들 = [
    ['UTF-16LE 표식 있음', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(글, 'utf16le')]), 'utf-16le-bom'],
    ['UTF-16LE 표식 없음 (한글)', Buffer.from(글, 'utf16le'), 'utf-16le'],
    ['UTF-16LE 표식 없음 (영문)', Buffer.from(영문, 'utf16le'), 'utf-16le'],
    ['UTF-16BE 표식 없음 (한글)', be(글), 'utf-16be'],
  ];
  for (const [이름, buf, 바란이름] of 것들) {
    const p = join(방, 'a.txt');
    writeFileSync(p, buf);
    let r = null;
    let 거절 = null;
    try { r = readTextFull(p); } catch (e) { 거절 = e.message; }
    check(`★★★ ${이름} 을 글로 읽는다`, r !== null, 거절 ?? '');
    if (!r) continue;
    check(`  되돌려 쓸 이름이 ${바란이름}`, r.encoding === 바란이름, String(r.encoding));
    check('  내용이 맞다', r.text === (이름.includes('영문') ? 영문 : 글), JSON.stringify(r.text.slice(0, 24)));
    /*
     * ★★★ 바이트까지 그대로여야 한다. 표식이 없던 파일에 표식이 생기면
     * 한 글자 고쳤을 뿐인데 앞머리 두 바이트가 늘어난다.
     */
    const 되쓴것 = encode(r.text, r.encoding);
    check('  ★★★ 되돌려 쓰면 바이트가 똑같다',
      되쓴것.buf.equals(buf), `${되쓴것.buf.length}바이트 vs ${buf.length}바이트`);
  }

  /*
   * ★★★ 반대쪽 — 진짜 바이너리는 그대로 거절해야 한다. 여기가 새면
   * 그림 파일이 글로 읽혀 화면이 깨지고, 고치면 파일이 죽는다.
   */
  const 진짜들 = [
    ['PNG 머리', Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(40), Buffer.from('IHDR')])],
    ['가운데 NUL 이 든 UTF-8', Buffer.from('hello\0world this is plain text ok', 'utf8')],
    // 홀수 자리에만 0 이 오지만 글이 아닌 것 — 자릿수만 세면 이게 통과한다.
    ['한 자리에만 0 인 제어문자 덩이', (() => {
      const b = Buffer.alloc(64);
      for (let i = 0; i < 64; i += 2) { b[i] = 0x01 + i; b[i + 1] = 0; }
      return b;
    })()],
  ];
  for (const [이름, buf] of 진짜들) {
    const p = join(방, 'b.bin');
    writeFileSync(p, buf);
    let 거절 = null;
    try { readTextFull(p); } catch (e) { 거절 = e.message; }
    check(`★★★ ${이름} 은 그대로 거절한다`, /바이너리/.test(거절 ?? ''), 거절 ?? '글로 읽었다');
  }
  check('★ 0 이 아예 없는 파일은 UTF-16 이 아니다',
    detect(Buffer.from('plain ascii text here and more', 'utf8')).id === 'utf-8');
  rmSync(방, { recursive: true, force: true });
}

// ── 힌트 이름을 사람이 쓰는 대로 받는가 ─────────────────────────────────
//
// ★★ 아는 이름이 `euc-kr` 처럼 TextDecoder 가 쓰는 것뿐이었다. 그런데 화면에
// 찍어 주는 이름은 `CP949` 다(label). 그 이름을 그대로 힌트로 넣으면 후보에서
// 못 찾아 **힌트가 통째로 무시됐고**, 무시했다는 말도 안 나왔다.
{
  const 일본어 = encode('日本語', 'shift_jis').buf;
  const 맨것 = detect(일본어);
  check('★ 힌트가 없으면 내용대로 고른다', 맨것.id === 'shift_jis', `${맨것.id} · ${맨것.why}`);
  for (const 힌 of ['gbk', 'cp936', 'CP936', '936', 'GBK']) {
    const d = detect(일본어, { fallback: 힌 });
    check(`★★ 힌트 '${힌}' 를 알아듣는다`, d.id === 'gbk', `${d.id} · ${d.why}`);
  }
  check('★ 모르는 이름은 없는 셈 친다', detect(일본어, { fallback: '없는것' }).id === 'shift_jis');

  /*
   * ★★ 같은 인코딩을 사람들은 구분자만 바꿔 여러 꼴로 적는다 (2.0.0 7회차 · Gemini 인코딩7a).
   *
   * 위 고침은 **앞가지**(cp·ms·windows-)만 걷었다. 구분자는 그대로 남아서
   * `shift-jis` 한 줄이 여전히 null 이었다 — 웹 charset 도 메일 머리글도
   * 하이픈으로 적는 쪽이 더 흔하다. `iso-8859-1` 은 웹에서 제일 많이 적히는
   * 이름인데 이 함수는 한 번도 알아들은 적이 없다.
   *
   * 무시되면 화면에 아무 말도 안 남는다. 그래서 여기서 다 적어 놓고 잰다.
   */
  const 이름들 = {
    'shift-jis': 'shift_jis', 'Shift-JIS': 'shift_jis', 'shift jis': 'shift_jis',
    'x-sjis': 'shift_jis', 'ms_kanji': 'shift_jis', 'windows-932': 'shift_jis',
    'euc_kr': 'euc-kr', 'EUC_KR': 'euc-kr', 'ks_c_5601-1987': 'euc-kr',
    'ksc_5601': 'euc-kr', 'windows-949': 'euc-kr', 'x-windows-949': 'euc-kr',
    'gb-2312': 'gbk', 'GB_2312': 'gbk', 'windows-936': 'gbk',
    'big-5': 'big5', 'BIG-5': 'big5', 'windows-950': 'big5',
    'iso-8859-1': 'windows-1252', 'ISO_8859-1': 'windows-1252', 'latin-1': 'windows-1252',
  };
  const 못알아들은것 = Object.entries(이름들).filter(([적은것, 뜻]) => 이름정리(적은것) !== 뜻)
    .map(([적은것, 뜻]) => `${적은것}→${이름정리(적은것)} (${뜻} 이어야)`);
  check('★★ 구분자만 다른 이름도 같은 것으로 알아듣는다', 못알아들은것.length === 0, 못알아들은것.slice(0, 5).join(' · '));

  // 여태 알아듣던 것은 그대로 알아들어야 한다.
  const 옛것 = { 'shift_jis': 'shift_jis', sjis: 'shift_jis', '932': 'shift_jis', cp932: 'shift_jis',
    'euc-kr': 'euc-kr', euckr: 'euc-kr', ksc5601: 'euc-kr', cp949: 'euc-kr', uhc: 'euc-kr', '949': 'euc-kr',
    gbk: 'gbk', gb2312: 'gbk', '936': 'gbk', big5: 'big5', '950': 'big5',
    'windows-1252': 'windows-1252', '1252': 'windows-1252', latin1: 'windows-1252',
    'utf-8': 'utf-8', utf8: 'utf-8', 'utf-16le': 'utf-16le', 'utf-16be': 'utf-16be' };
  const 잃은것 = Object.entries(옛것).filter(([적은것, 뜻]) => 이름정리(적은것) !== 뜻)
    .map(([적은것, 뜻]) => `${적은것}→${이름정리(적은것)} (${뜻} 이어야)`);
  check('★ 여태 알아듣던 이름을 잃지 않았다', 잃은것.length === 0, 잃은것.slice(0, 5).join(' · '));

  // 모르는 것은 그대로 모른다고 해야 한다 — 아무 이름이나 받아 주면 힌트가 거짓말이 된다.
  const 몰라야할것 = ['없는것', 'utf-32', 'koi8-r', 'cp1250', 'macroman', ''];
  const 넘겨준것 = 몰라야할것.filter((x) => 이름정리(x) !== null).map((x) => `${x}→${이름정리(x)}`);
  check('★ 모르는 이름은 그대로 null 이다', 넘겨준것.length === 0, 넘겨준것.join(' · '));

  for (const 힌 of ['shift-jis', 'x-sjis']) {
    const d = detect(encode('報告書を確認してください', 'shift_jis').buf, { fallback: 힌 });
    check(`★ 힌트 '${힌}' 가 실제 판정까지 닿는다`, d.id === 'shift_jis', `${d.id} · ${d.why}`);
  }
}

/*
 * ── 몇 글자부터 판정을 믿나 (encoding.js 의 점수 머리말) ─────────────────
 *
 * 실제 문장을 잘라 잰다. 고치기 전에는 스무 자 넘는 Shift_JIS 한자 문장이 GBK 로,
 * 스물넷·서른두 자 GBK 문장이 UTF-16BE 로 읽혔다. 머리말이 적은 문턱(옛 인코딩
 * 여섯 자 · 표식 없는 UTF-16 열 자)이 사실인지를 여기서 지킨다.
 */
{
  const 문장 = {
    'euc-kr': '사내 결재 문서를 확인하시고 회의록과 첨부 파일을 검토한 뒤 다음 주까지 보고서를 제출해 주시기 바랍니다',
    'shift_jis': '会議の資料を確認してから来週までに報告書を提出してください。よろしくお願いします。担当は山田太郎です。東京本社の会議室で行います',
    'gbk': '请在下周之前确认会议资料并提交报告，谢谢大家的配合与支持。负责人是张经理，如有问题请联系我们的办公室',
    'big5': '請在下週之前確認會議資料並提交報告，謝謝大家的配合與支持。負責人是張經理，如有問題請聯繫我們的辦公室',
  };
  const 틀림 = [];
  for (const [id, 글] of Object.entries(문장)) {
    for (const N of [6, 12, 24]) {
      for (let i = 0; i + N <= 글.length; i += 2) {
        const 조각 = 글.slice(i, i + N);
        const b = encode(조각, id);
        if (b.lost.length) continue;
        const d = detect(b.buf);
        if (d.id !== id) 틀림.push(`${id} ${N}자 「${조각}」→${d.id}`);
      }
    }
  }
  check('★★ 여섯 자 이상이면 CP949·Shift_JIS·GBK·Big5 문장 조각을 다 제 인코딩으로 읽는다', 틀림.length === 0, 틀림.slice(0, 4).join(' | '));
  const 틀림16 = [];
  for (const 글 of Object.values(문장)) {
    for (const N of [10, 16]) {
      for (let i = 0; i + N <= 글.length; i += 4) {
        for (const id of ['utf-16le', 'utf-16be']) {
          const buf = Buffer.from(글.slice(i, i + N), 'utf16le');
          if (id === 'utf-16be') buf.swap16();
          const d = detect(buf);
          if (d.id !== id) 틀림16.push(`${id} ${N}자 「${글.slice(i, i + N)}」→${d.id}`);
        }
      }
    }
  }
  check('★★ 열 자 이상이면 표식 없는 UTF-16 문장 조각도 다 제대로 읽는다', 틀림16.length === 0, 틀림16.slice(0, 4).join(' | '));
}

// ── 64KB 넘는 옛 인코딩 파일에 이어 붙이기 ─────────────────────────────
//
// Append 는 인코딩을 앞머리 64KB 로만 잰다. 그 자른 자리가 두 바이트 글자의
// 한가운데면 앞 바이트 하나가 외톨이로 남고, 엄격하게 푸는 CP949 후보가
// 통째로 떨어져 **CP1252 로 판정됐다.** 그러면 한글은 「CP1252 에 없는 글자」
// 로 거절되고, `·` 처럼 두 쪽에 다 있는 글자는 CP1252 바이트로 조용히 붙었다.
// 자른 자리를 UTF-8 경계로만 맞추고 있어서 옛 인코딩은 못 지켰다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-enc-big-'));
  const c = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set() };
  const 줄 = '사내 결재 요청드립니다 금액 확인 바랍니다\n';
  const 줄수 = Math.ceil(70000 / encode(줄, 'euc-kr').buf.length);
  const 틀림 = [];
  const 조용히깨짐 = [];
  for (let 앞 = 0; 앞 < 6; 앞++) {
    const s = 'x'.repeat(앞) + 줄.repeat(줄수);
    for (const [붙일, 담을곳] of [['추가 줄입니다\n', 틀림], ['Total · 100\n', 조용히깨짐]]) {
      const 이름 = `큰${앞}-${담을곳 === 틀림 ? '한글' : '점'}.txt`;
      writeFileSync(join(방, 이름), encode(s, 'euc-kr').buf);
      const r = await runTool('Append', { file_path: 이름, content: 붙일 }, c);
      if (r.error || !readFileSync(join(방, 이름)).equals(encode(s + 붙일, 'euc-kr').buf)) {
        담을곳.push(`${앞}: ${String(r.error ?? r.content).split('\n')[0]}`);
      }
    }
  }
  check('★★ 64KB 넘는 CP949 파일에 한글을 이어 붙여도 CP949 로 붙는다 (자른 자리가 어디든)', 틀림.length === 0,
    `${틀림.length}/6 ${틀림.slice(0, 2).join(' | ')}`);
  check('★★ 두 인코딩에 다 있는 글자(·)를 CP1252 바이트로 조용히 붙이지 않는다', 조용히깨짐.length === 0,
    `${조용히깨짐.length}/6 ${조용히깨짐.slice(0, 2).join(' | ')}`);

  // 줄바꿈이 하나도 없으면 줄 경계로 물러설 자리가 없다. 그래도 지켜야 한다.
  const 한줄틀림 = [];
  for (let 앞 = 0; 앞 < 2; 앞++) {
    const s = 'x'.repeat(앞) + '가나다라마바사아자차카타파하'.repeat(3000);
    const 이름 = `한줄${앞}.txt`;
    writeFileSync(join(방, 이름), encode(s, 'euc-kr').buf);
    const r = await runTool('Append', { file_path: 이름, content: '끝입니다' }, c);
    if (r.error || !readFileSync(join(방, 이름)).equals(encode(s + '끝입니다', 'euc-kr').buf)) {
      한줄틀림.push(`${앞}: ${String(r.error ?? r.content).split('\n')[0]}`);
    }
  }
  check('★ 줄바꿈 없는 64KB 넘는 CP949 파일도 CP949 로 붙는다', 한줄틀림.length === 0, 한줄틀림.join(' | '));

  // 붙이는 사이에 남이 **같은 크기로** 갈아엎은 파일 — 크기만 보던 기억이 낡은 인코딩을 댔다.
  {
    const 이름 = '바꿔치기.txt';
    writeFileSync(join(방, 이름), encode('가나다라마바사\n', 'euc-kr').buf);
    await runTool('Append', { file_path: 이름, content: '아자\n' }, c);
    const 크기 = readFileSync(join(방, 이름)).length;
    const utf = Buffer.concat([Buffer.from('ab'.repeat(20)), Buffer.from('가나다라마\n', 'utf8')]);
    writeFileSync(join(방, 이름), utf.subarray(utf.length - 크기));
    const r = await runTool('Append', { file_path: 이름, content: '한글\n' }, c);
    const 꼬리 = readFileSync(join(방, 이름)).subarray(크기);
    check('★★ 같은 크기로 갈아엎은 파일은 인코딩을 다시 잰다 (UTF-8 파일에 CP949 바이트를 안 붙인다)',
      꼬리.equals(Buffer.from('한글\n', 'utf8')), `${r.content ?? r.error} · 꼬리=${꼬리.toString('hex')}`);
  }
  // 줄 수 기억도 같다 — 같은 크기로 갈아엎고 시각이 바뀌었으면 다시 센다.
  {
    const 이름 = '줄바꿔치기.txt';
    writeFileSync(join(방, 이름), 'a\nb\n');
    await runTool('Append', { file_path: 이름, content: 'c\n' }, c);
    writeFileSync(join(방, 이름), 'abcde\n');   // 같은 6바이트 · 한 줄
    const 나중 = new Date(Date.now() + 60_000);
    utimesSync(join(방, 이름), 나중, 나중);
    const r = await runTool('Append', { file_path: 이름, content: 'x\n' }, c);
    check('★ 같은 크기로 갈아엎은 파일은 줄 수도 다시 센다', /지금 전체 2줄/.test(String(r.content)), String(r.content ?? r.error));
  }
  rmSync(방, { recursive: true, force: true });
}

// ── 옛 인코딩: 손 안 댄 바이트는 한 바이트도 안 바뀐다 ─────────────────
//
// Edit·Write 는 파일 **전체**를 역표로 다시 만든다. 그런데 한 글자에 바이트
// 자리가 둘인 것이 있다 — Big5 의 十 은 A451(표준)과 A2CC, Shift_JIS 의 ≒ 는
// 81E0 과 8790(NEC). 역표는 먼저 만난 쪽 하나만 알아서, 딴 자리 한 글자를
// 고쳤을 뿐인데 문서 곳곳의 十 이 A2CC 로 바뀌었다. 화면의 /diff 에는 안 뜬다 —
// 글자로는 같기 때문이다. 바이트를 보는 쪽(검색·대조·서명)에서만 깨진다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-enc-dup-'));
  const c = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set() };
  const big5 = (글) => Buffer.concat([...글].map((ch) => (ch === '十' ? Buffer.from([0xa4, 0x51]) : encode(ch, 'big5').buf)));
  const 글 = '十月十日會議紀錄，請各部門主管準時出席。報告書內容如下。\r\n第一項：預算審查。\r\n';
  writeFileSync(join(방, 'b5.txt'), big5(글));
  await runTool('Read', { file_path: 'b5.txt' }, c);
  const r = await runTool('Edit', { file_path: 'b5.txt', old_string: '預算審查', new_string: '預算審核' }, c);
  const 뒤 = readFileSync(join(방, 'b5.txt'));
  check('★★ Big5 Edit — 손 안 댄 十(A451) 바이트가 그대로다', 뒤.equals(big5(글.replace('審查', '審核'))),
    `${r.error ?? r.content} · ${뒤.toString('hex').slice(0, 16)}`);
  check('★ 새로 쓰는 十 은 표준 자리(A451)로 쓴다', encode('十', 'big5').buf.toString('hex') === 'a451', encode('十', 'big5').buf.toString('hex'));

  // 표본은 좀 길게 잡는다. 짧은 일본어는 GBK 와 점수가 비슷해 판정부터 흔들린다 —
  // 그건 이 검사가 재려는 것이 아니다.
  const sj앞 = 'これは日本語の文書です。会議の計算結果は';
  const sj = (뒤글) => Buffer.concat([encode(sj앞, 'shift_jis').buf, Buffer.from([0x87, 0x90]), encode(뒤글, 'shift_jis').buf]);
  writeFileSync(join(방, 'sj.txt'), sj('百になりました。内容を確認してください。よろしくお願いします。\r\n'));
  const 읽은sj = await runTool('Read', { file_path: 'sj.txt' }, c);
  const r2 = await runTool('Edit', { file_path: 'sj.txt', old_string: '確認', new_string: '承認' }, c);
  const 뒤2 = readFileSync(join(방, 'sj.txt'));
  check('★★ Shift_JIS Edit — 손 안 댄 ≒(8790) 바이트가 그대로다', 뒤2.equals(sj('百になりました。内容を承認してください。よろしくお願いします。\r\n')),
    `${읽은sj.summary} · ${r2.error ?? r2.content} · 8790 남음=${뒤2.toString('hex').includes('8790')}`);
  const r3 = await runTool('Write', { file_path: 'sj.txt', content: `${sj앞}≒百になりました。内容を承認しました。よろしくお願いします。\r\n` }, c);
  check('★ Shift_JIS Write 도 안 바뀐 앞부분의 바이트를 그대로 둔다',
    readFileSync(join(방, 'sj.txt')).equals(sj('百になりました。内容を承認しました。よろしくお願いします。\r\n')), r3.error ?? r3.content);
  rmSync(방, { recursive: true, force: true });
}

// ── 한자 섞인 한국어 문서 (2.0.0 6회차 · Gemini 인코딩6) ─────────────────
//
// 계약서·공문처럼 한자를 섞어 쓴 CP949 문서가 GBK 로 읽혔다 — 글이 통째로 중국 글자로 깨진다.
// 점수표가 「CP949 문서에 한자는 드물다」 로 한자마다 깎았는데, 한글 음절을 GBK 로 풀면 흔한
// 중국 한자가 나와 GBK 가 이겼다. 한국 사내 문서가 이 프로그램의 첫 손님이다.
{
  for (const 글 of [
    '契約書 第1條 株式會社 甲과 乙은 다음과 같이 契約을 締結한다.\n',
    '第2條(目的) 本 契約은 甲이 乙에게 供給하는 物品의 品質에 關한 事項을 定함을 目的으로 한다.\n',
    '政府는 來年 豫算案을 國會에 提出하였다.\n',
  ]) {
    for (const 척 of ['windows-1252', 'gbk']) {
      const r = decode(encode(글, 'euc-kr').buf, { system: 척 });
      check(`★ 한자 섞인 CP949 문서를 ${label(척)} 컴퓨터에서도 CP949 로 읽는다: ${글.slice(0, 10)}`,
        r.encoding === 'euc-kr' && r.text === 글, `${r.encoding} — ${r.why}`);
    }
  }
}

/*
 * ── 읽는 쪽이 내놓는 이름을 쓰는 쪽이 다 알아듣는가 (2.0.0 7회차 · Gemini 인코딩7b) ──
 *
 * 2차 눈이 「`바꾼데만쓰기(..., 'CP949')` 를 부르면 LEGACY 검사에 걸려 파일 전체가
 * UTF-8 로 다시 써진다」 고 했다. 재 보니 **그 일은 실제로 일어난다** —
 *   바꾼데만쓰기(…, 'cp949') → eab080eb8298eb9dbc  (UTF-8 바이트)
 *   바꾼데만쓰기(…, 'euc-kr') → b0a1b3aab6f3        (CP949 바이트)
 * 다만 지금은 **닿는 길이 없다.** 그 자리에 들어가는 이름은 늘 `decode()` 가 내놓은
 * 것이고, decode 는 정규 이름만 낸다.
 *
 * 고칠 것은 없지만, **그 둘이 갈라지는 날**은 아무 소리도 안 난다 — 파일이 통째로
 * UTF-8 이 되고 /diff 에는 고친 한 줄만 보인다. 그래서 「읽는 쪽의 이름 = 쓰는 쪽이
 * 아는 이름」 을 여기서 못 박는다.
 */
{
  const 낸이름 = new Set();
  for (const enc of [...LEGACY.map((x) => x.id), 'utf-8', 'utf-8-bom', 'utf-16le-bom', 'utf-16be-bom']) {
    const buf = encode('품의서 결재 부탁드립니다 報告 confirm', enc).buf;
    if (buf) 낸이름.add(decode(buf).encoding);
  }
  const 아는이름 = new Set([...LEGACY.map((x) => x.id),
    'utf-8', 'utf-8-bom', 'utf-16le', 'utf-16le-bom', 'utf-16be', 'utf-16be-bom']);
  const 모르는것 = [...낸이름].filter((x) => !아는이름.has(x));
  check('★★ decode 가 내놓는 인코딩 이름은 모두 쓰는 쪽이 아는 이름이다', 모르는것.length === 0,
    모르는것.join(' · ') || [...낸이름].join(' · '));

  // 옛 인코딩 이름이면 바꾼데만쓰기 가 바이트를 지킨다 — 앞뒤가 한 바이트도 안 바뀐다.
  for (const enc of LEGACY.map((x) => x.id)) {
    const 원 = encode('가나다 ABC', enc).buf ?? encode('abc ABC', enc).buf;
    const 옛글 = decode(원).text;
    const r = 바꾼데만쓰기(원, 옛글, `${옛글}X`, decode(원).encoding);
    check(`★ ${label(enc)} 는 앞부분 바이트를 그대로 둔다`,
      !!r.buf && r.buf.subarray(0, 원.length).equals(원), `${enc} · ${r.buf?.toString('hex').slice(0, 24)}`);
  }
}

/*
 * ── EB2-후속 · 별명 이름으로 불러도 바이트를 지키는가 (2.0.0 8회차) ──────
 *
 * 위 칸은 「decode 가 내놓는 이름」 만 쟀다. 그 이름은 늘 정규 이름이라 안 샜다.
 * 그런데 `바꾼데만쓰기` 는 **아무나 부를 수 있는 export** 다. 사람이 아는 이름
 * (`cp949` · `CP949` · `ms949`)으로 부르면 `LEGACY.some(x => x.id === id)` 에
 * 안 걸려 **파일 전체가 UTF-8 로 다시 써졌다.** 실측:
 *   바꾼데만쓰기(…, 'cp949')  → eab080eb8298eb9dbc  (UTF-8 · fellBack)
 *   바꾼데만쓰기(…, 'euc-kr') → b0a1b3aab6f3        (CP949)
 * /diff 에는 고친 한 줄만 보이고, 나머지 줄은 인코딩만 바뀐 채 소리 없이 따라간다.
 * `이름정리` 가 이미 아는 별명을 이 문 앞에서만 안 쓰고 있던 것이라 한 줄로 닫았다.
 */
{
  const 원 = encode('가나다 ABC', 'euc-kr').buf;
  const 정답 = 바꾼데만쓰기(원, '가나다 ABC', '가나라 ABC', 'euc-kr');
  for (const 별명 of ['cp949', 'CP949', 'ms949', 'euckr', 'x-windows-949', 'EUC-KR']) {
    const r = 바꾼데만쓰기(원, '가나다 ABC', '가나라 ABC', 별명);
    check(`★★★ 별명 「${별명}」 으로 불러도 바이트를 지킨다 — 파일이 통째로 UTF-8 이 되지 않는다`,
      !!r.buf && !r.fellBack && r.buf.equals(정답.buf),
      `${r.buf?.toString('hex')} (정답 ${정답.buf?.toString('hex')}${r.fellBack ? ' · fellBack' : ''})`);
  }
  // 못 알아듣는 이름은 예전처럼 통째로 만든 것을 준다 — 넓힌 것이지 헐겁게 한 게 아니다.
  const 엉뚱 = 바꾼데만쓰기(원, '가나다 ABC', '가나라 ABC', '없는인코딩');
  check('★★ 못 알아듣는 이름은 그대로 통째로 만든 것을 준다', !!엉뚱.fellBack,
    `${엉뚱.buf?.toString('hex')}`);
}

/*
 * ── 그 별명 고침이 **표식(BOM)을 떼어 먹었다** (막판 훑기) ───────────────
 *
 * 위 한 줄(`이름정리(encoding) ?? …`)은 옛 인코딩 별명을 알아듣게 하려던 것인데,
 * `이름정리` 는 힌트를 고르는 자라 `-bom` 을 **떼어서** 돌려준다. 그래서 Edit·Write 가
 * BOM 붙은 파일을 고칠 때마다 앞 세(또는 두) 바이트가 사라졌다 —
 *
 *     efbbbf 가나다   →  (한 글자 Edit)  →  가나X다        BOM 없음
 *
 * `encode()` 를 직접 부르는 길은 멀쩡했다(그쪽은 `-bom` 을 안다). 하필 **실제로 쓰는
 * 길**에서만 깎였고, /diff 에는 고친 한 줄만 보인다. 엑셀이 내보낸 CSV · .ps1 ·
 * 메모장 UTF-16LE 가 전부 이 자리다 — BOM 이 없어지면 그 프로그램들이 파일을
 * 다른 인코딩으로 읽는다.
 */
{
  for (const [이름, 앞머리] of [['utf-8-bom', 'efbbbf'], ['utf-16le-bom', 'fffe'], ['utf-16be-bom', 'feff']]) {
    const 원 = encode('가나다 ABC', 이름).buf;
    const r = 바꾼데만쓰기(원, '가나다 ABC', '가나라 ABC', decode(원).encoding);
    check(`★★★ ${이름} 파일을 고쳐도 표식이 남는다`,
      r.buf?.toString('hex').startsWith(앞머리), `${r.buf?.toString('hex').slice(0, 12)} (바라는 앞머리 ${앞머리})`);
    // 사람이 대문자로 적어 준 이름도 같다 — 이름정리 를 거치는 문은 하나다.
    const r2 = 바꾼데만쓰기(원, '가나다 ABC', '가나라 ABC', 이름.toUpperCase());
    check(`  (짝) 대문자 ${이름.toUpperCase()} 로 불러도 같다`,
      r2.buf?.toString('hex').startsWith(앞머리), `${r2.buf?.toString('hex').slice(0, 12)}`);
  }
  // 표식 없는 이름에 표식을 붙이지도 않는다 — 도구가 마음대로 한 변경이 된다.
  const 민 = 바꾼데만쓰기(encode('가나다', 'utf-8').buf, '가나다', '가나라', 'utf-8');
  check('★★ 표식 없던 파일에 표식을 붙이지는 않는다',
    !민.buf?.toString('hex').startsWith('efbbbf'), 민.buf?.toString('hex'));
}

// ── 못 쓴 힌트는 못 썼다고 말하는가 ─────────────────────────────────────
//
// fallback 은 힌트다. 그런데 그 인코딩으로 **아예 안 읽히는** 바이트면 후보
// 목록에 아예 못 올라간다. 그러면 박빙 비교에도 안 들어가고, 화면에는
// 「내용으로 짐작」 한 줄만 남는다 — 사람이 적어 준 것을 안 썼는데 안 썼다는
// 말이 없다. 이름정리 머리말이 이미 같은 꼴(이름을 못 알아들어 통째로 무시)을
// 한 번 걷어냈다. 여기는 이름이 아니라 **바이트**가 안 맞는 쪽이다.
{
  const 독일어 = encode('Über allen Gipfeln ist Ruh, in allen Wipfeln spürest du kaum einen Hauch.', 'windows-1252').buf;
  const 후보이름 = guess(독일어).map((x) => x.id);
  check('이 바이트는 euc-kr 로 아예 안 읽힌다', !후보이름.includes('euc-kr'), 후보이름.join(' · '));

  const 못쓴것 = detect(독일어, { fallback: 'euc-kr' });
  check('★ 적어 준 힌트를 못 썼으면 못 썼다고 적는다', /euc-kr/.test(못쓴것.why ?? ''), `${못쓴것.id} · ${못쓴것.why}`);

  // 쓴 힌트는 조용하다 — 안 쓴 것만 말해야 쓸모가 있다.
  const 한글 = encode('품의서 결재 부탁드립니다. 오늘 안에 부탁드립니다.', 'euc-kr').buf;
  const 쓴것 = detect(한글, { fallback: 'euc-kr' });
  check('★ 쓸 수 있었던 힌트는 군말을 안 붙인다', !/안 썼|못 썼/.test(쓴것.why ?? ''), `${쓴것.id} · ${쓴것.why}`);

  /*
   * UTF-8 · UTF-16 힌트에는 군말을 안 붙인다 (2.0.0 7회차 · 스스로 낸 거짓 경고).
   *
   * 여기까지 왔다는 것은 UTF-8 도 UTF-16 도 아니라고 **이미 따로 판정됐다**는 뜻이다
   * (detect 앞머리). 그 힌트가 후보에 없는 것은 설계대로다. 그것을 「못 썼습니다」 로
   * 적으면 없는 문제를 알리는 셈이 된다 — 거짓 경고도 결함이다.
   */
  for (const 힌 of ['utf-8', 'utf-16le', 'utf-16be']) {
    const d = detect(한글, { fallback: 힌 });
    check(`★ ${힌} 힌트에는 군말을 안 붙인다`, !/안 썼|못 썼/.test(d.why ?? ''), `${d.id} · ${d.why}`);
  }

  // 아무것도 안 적어 줬으면 이 컴퓨터 기본값을 못 썼다고 탓하지 않는다.
  const 안적은것 = detect(독일어);
  check('★ 안 적어 준 것을 못 썼다고 말하지 않는다', !/안 썼|못 썼/.test(안적은것.why ?? ''), `${안적은것.id} · ${안적은것.why}`);

  // windows-1252 는 256 바이트를 다 받는다 — 엄격 모드로도 안 걸러진다.
  const 이상한것 = Buffer.from([0x80, 0x81, 0x8d, 0x8f, 0x90, 0x9d]);
  check('★ windows-1252 는 엄격 모드에서도 안 걸러진다 (늘 후보다)',
    guess(이상한것).some((x) => x.id === 'windows-1252'), guess(이상한것).map((x) => x.id).join(' · ') || '(없음)');
}

/*
 * ── 9회차 (2차 눈 · 인코딩a) — UTF-16 알아보기 세 자리 ──────────────────
 *
 * 셋 다 「못 알아본다」 가 아니라 **「다르게 알아본다」** 쪽이라 화면에 아무
 * 표시가 안 난다. 세 자리 모두 머리말이 약속한 것과 코드가 달랐다.
 */
{
  // 1. 다 온 파일의 길이가 홀수면 UTF-16 이 아니다.
  //    머리말은 「두 바이트 단위라 길이가 홀수면 애초에 아니다」 라고 적어 뒀는데,
  //    코드는 마지막 한 바이트를 **버리고** 짝수로 만들어 계속 봤다.
  //    재 보니 다 온 홀수 5바이트가 utf-16le 로 읽혔다.
  const 홀수 = Buffer.from([0x41, 0x00, 0x42, 0x00, 0x43]);
  check('★★★ 다 온 파일의 길이가 홀수면 UTF-16 이라고 하지 않는다',
    utf16인가(홀수) === null, String(utf16인가(홀수)));

  // 잘라 온 표본은 다르다 — 글자 한가운데서 끊긴 것이라 홀수가 정상이다.
  const 잘린홀수 = Buffer.concat([Buffer.from('안녕하세요 반갑습니다 오늘도 좋은', 'utf16le'), Buffer.from([0xAC])]);
  check('★★ 잘라 온 표본은 홀수여도 그대로 본다',
    utf16인가(잘린홀수, null, { 잘림: true }) === 'utf-16le', String(utf16인가(잘린홀수, null, { 잘림: true })));

  // 2. 「잘림」 을 utf16후보 까지 옮겨 준다.
  //    안 옮기던 때는, 짝수로 잘린 표본의 끝 서러게이트가 반쪽만 남아
  //    fatal 디코더가 던졌고 UTF-16LE 짜리를 못 알아봤다.
  const 온전 = Buffer.from('오늘 회의록입니다 🙂 다음 주에 뵙겠습니다', 'utf16le');
  const 반쪽 = 온전.subarray(0, 온전.length - 2);   // 짝수 · 끝 서러게이트 반쪽
  check('★★★ 끝 글자가 반쪽인 잘린 표본도 UTF-16LE 로 알아본다',
    utf16인가(반쪽, null, { 잘림: true }) === 'utf-16le', String(utf16인가(반쪽, null, { 잘림: true })));
  check('  온전한 것은 당연히 그대로', utf16인가(온전) === 'utf-16le', String(utf16인가(온전)));

  // 3. decode 까지 이어지는가 — 잘린 표본이 통째로 깨져 나오지 않는다.
  const 풀린것 = decode(반쪽, { 잘림: true });
  check('★★ 잘린 UTF-16 표본을 decode 가 글로 풀어 준다',
    풀린것.encoding === 'utf-16le' && 풀린것.text.startsWith('오늘 회의록'),
    `${풀린것.encoding} · ${JSON.stringify(풀린것.text.slice(0, 12))}`);
}

// ── 8회차 · 바깥: 사람이 적는 이름꼴을 한 문 앞에서만 안 알아듣던 자리 ──
{
  /*
   * `encode` 는 `utf-8` 과 `utf8` 은 둘 다 알아들으면서 UTF-16 만 하이픈이 든
   * 이름 하나씩만 알았다. Node 가 쓰는 이름(`utf16le`)으로 주면 그 문을 지나쳐
   * 역표 만들기로 떨어지고, 역표가 없으니 **조용히 UTF-8 바이트**가 나왔다.
   * 한 글자 고쳤을 뿐인데 파일 전체가 다른 인코딩이 되는 자리라고 바로 아래
   * 주석에 적어 놓고, 그 막이 하이픈 하나에 새고 있었다.
   */
  const 잰것 = {};
  for (const id of ['utf-16le', 'utf16le', 'utf-16be', 'utf16be', 'utf-16le-bom', 'utf16le-bom']) {
    const r = encode('가', id);
    잰것[id] = `${r.buf.toString('hex')}${r.fellBack ? ' fellBack' : ''}`;
  }
  check('★★ 하이픈 없는 Node 이름(utf16le)도 UTF-16 으로 쓴다',
    잰것['utf16le'] === 잰것['utf-16le'], JSON.stringify(잰것));
  check('★★ utf16be 도 마찬가지 — UTF-8 로 조용히 안 떨어진다',
    잰것['utf16be'] === 잰것['utf-16be'], JSON.stringify(잰것));
  check('★ 표식(-bom)도 그 꼴 그대로 붙는다',
    잰것['utf16le-bom'] === 잰것['utf-16le-bom'] && /^fffe/.test(잰것['utf-16le-bom']),
    JSON.stringify(잰것));
  check('  어느 꼴로 써도 되읽으면 같은 글이다',
    decode(encode('가나다', 'utf16le').buf, { fallback: 'utf-16le' }).text === '가나다',
    JSON.stringify(decode(encode('가나다', 'utf16le').buf, { fallback: 'utf-16le' }).text));

  /*
   * `label()` 은 id 를 소문자로 안 낮췄다. 그래서 사람이·설정이 대문자로 적어
   * 둔 이름이 그대로 화면에 나갔다 — `EUC-KR` 는 `CP949` 로, `UTF-8-BOM` 은
   * `UTF-8(BOM)` 으로 보여야 하는 자리다. 이름을 골라 주는 쪽(이름정리)은
   * 이미 소문자로 낮춰 보는데 보여 주는 쪽만 안 했다.
   */
  const 이름잰것 = Object.fromEntries(
    ['EUC-KR', 'SHIFT_JIS', 'UTF-8-BOM', 'UTF-16LE', 'Big5'].map((x) => [x, label(x)]));
  check('★★ 대문자로 적은 id 도 사람이 아는 이름으로 보여 준다',
    label('EUC-KR') === label('euc-kr') && label('SHIFT_JIS') === label('shift_jis'),
    JSON.stringify(이름잰것));
  check('★ 표식 붙은 이름도 마찬가지',
    label('UTF-8-BOM') === 'UTF-8(BOM)' && label('UTF-16LE') === 'UTF-16LE',
    JSON.stringify(이름잰것));
  check('  모르는 이름은 여태처럼 대문자로 보여 준다', label('koi8-r') === 'KOI8-R', label('koi8-r'));
}

rmSync(root, { recursive: true, force: true });

const G ='\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n글자 인코딩 검사  ${D}(읽고 고쳐도 원본이 안 상하는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
