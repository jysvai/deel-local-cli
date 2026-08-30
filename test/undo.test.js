// 되돌리기가 파일을 지우지 않는가.
//
// 왜 이 검사가 따로 있나:
//   되돌리기는 이 프로그램의 안전망이다. 승인 프롬프트를 안 쓰는 대신 /undo 로
//   되돌릴 수 있게 해 놓았다. 그 안전망이 파일을 **지운** 적이 있다.
//
//   '원래 없던 파일' 과 '내용을 못 떠 놓은 파일' 이 둘 다 before: null 이었다.
//   되돌리기는 null 을 보고 '없던 파일이니 지운다' 로 갔다. 그림·hwp 를
//   덮어쓴 뒤 /undo 를 누르면 남아 있던 잔해까지 사라졌다.
//
//   더 나쁜 변종도 있었다. 바이너리 판정 잣대가 두 곳에서 달랐다 —
//   읽기는 앞 8,000바이트만 보고, 스냅샷은 파일 전체를 봤다. 8,000바이트 뒤에
//   NUL 이 하나 든 평범한 소스 파일은 Read·Edit 이 되면서 스냅샷만 비었다.
//   그러고 /undo 를 누르면 멀쩡한 파일이 지워졌다.
//
// 그래서 여기서 재는 것은 하나다 — **되돌리기가 파일을 없애지 않는가.**
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { History } from '../src/safety/undo.js';
import { makeScope } from '../src/safety/guard.js';
import { Audit } from '../src/safety/audit.js';
import { TOOLS } from '../src/tools/index.js';
import { 정한셸 } from '../src/tools/shell.js';
import { decode, encode, looksBinary } from '../src/tools/encoding.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 방 = mkdtempSync(join(tmpdir(), 'deel-undo-'));

trace('1-바이너리');

// ── 바이너리 파일을 되돌리기가 지우지 않는가 ─────────────────────────────
{
  const p = join(방, '보고서.hwp');
  // 한글 문서 앞머리 흉내. 중요한 건 NUL 이 앞쪽에 있다는 것이다.
  const 원본 = Buffer.concat([Buffer.from('HWP Document File'), Buffer.alloc(64), Buffer.from([0xD0, 0xCF, 0x11, 0xE0])]);
  writeFileSync(p, 원본);

  const h = new History(방);
  h.nextTurn();
  const rec = h.snapshot(p, 'Write');
  check('바이너리는 내용을 안 담는다', rec.before === null, JSON.stringify(rec.before)?.slice(0, 40));
  check('못 담았다는 표시가 남는다', rec.skipped === '바이너리', String(rec.skipped));

  // 모델이 덮어썼다고 치고
  writeFileSync(p, '덮어쓴 글', 'utf8');
  const r = h.undo(1);
  check('되돌린 뒤에도 파일이 있다', existsSync(p), existsSync(p) ? '있음' : '지워짐');
  check('건드리지 않았다고 말해 준다', /그대로 둠/.test(r.restored[0]?.how ?? ''), r.restored[0]?.how);
  check('되돌렸다고 거짓말하지 않는다', r.restored[0]?.skipped === true, JSON.stringify(r.restored[0]));
}

trace('2-8000바이트뒤NUL');

// ── 8,000바이트 뒤에 NUL 이 든 글 파일 ──────────────────────────────────
//
// 이게 가장 위험했던 자리다. 읽기·고치기는 되는데 스냅샷만 비어서,
// 사용자가 아무 이상을 못 느끼다가 /undo 한 번에 파일을 잃는다.
{
  const p = join(방, '소스.js');
  const 앞 = 'const 설명 = "긴 주석";\n'.repeat(500);   // 8,000바이트를 넘긴다
  const 원본 = Buffer.concat([Buffer.from(앞, 'utf8'), Buffer.from([0x00]), Buffer.from('\n// 끝\n', 'utf8')]);
  writeFileSync(p, 원본);
  check('준비: 8,000바이트를 넘는다', 원본.length > 8000, `${원본.length}바이트`);
  check('준비: 읽기 잣대로는 글 파일이다', !looksBinary(원본), '앞 8,000바이트에 NUL 없음');

  const h = new History(방);
  h.nextTurn();
  h.snapshot(p, 'Edit');
  writeFileSync(p, '망가뜨림', 'utf8');
  const r = h.undo(1);
  check('되돌린 뒤에도 파일이 있다', existsSync(p), existsSync(p) ? '있음' : '지워짐');
  const 되돌린것 = existsSync(p) ? readFileSync(p) : Buffer.alloc(0);
  check('내용이 바이트까지 그대로 돌아온다', 되돌린것.equals(원본), `${되돌린것.length}바이트`);
  check('되돌렸다고 말한다', r.restored[0]?.how === '되돌림', r.restored[0]?.how);
}

trace('3-정말없던파일');

// ── 원래 없던 파일은 여전히 지워야 한다 ─────────────────────────────────
// 안 지우는 쪽으로만 고치면 되돌리기가 반쪽이 된다. 이쪽도 같이 잰다.
{
  const p = join(방, '새로만든것.txt');
  const h = new History(방);
  h.nextTurn();
  const rec = h.snapshot(p, 'Write');
  check('없던 파일은 before 가 null 이다', rec.before === null, String(rec.before));
  check('없던 파일에는 skipped 가 안 붙는다', rec.skipped === undefined, String(rec.skipped));
  writeFileSync(p, '새 내용', 'utf8');
  const r = h.undo(1);
  check('없던 파일은 지워진다', !existsSync(p), existsSync(p) ? '남아 있음' : '지워짐');
  check('지웠다고 말한다', /삭제됨/.test(r.restored[0]?.how ?? ''), r.restored[0]?.how);
}

trace('4-옛이력');

// ── skipped 표시가 없는 옛 이력 ─────────────────────────────────────────
//
// 이 고침 전에 쌓인 줄에는 skipped 가 없다. 그 줄은 '없던 파일' 로 읽힌다.
// 지금 디스크에 있는 것이 바이너리면 우리가 만든 파일일 리 없으니 안 지운다.
{
  const p = join(방, '옛것.png');
  const h = new History(방);
  h.nextTurn();
  // 옛 모양 그대로 손으로 적는다 — skipped 없이 before: null
  writeFileSync(h.file, JSON.stringify({ turn: h.turn, at: new Date().toISOString(), path: p, before: null, label: 'Write' }) + '\n', 'utf8');
  writeFileSync(p, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00, 0x00]));
  const r = h.undo(1);
  check('옛 이력이어도 바이너리는 안 지운다', existsSync(p), existsSync(p) ? '있음' : '지워짐');
  check('왜 안 지웠는지 말해 준다', /그대로 둠/.test(r.restored[0]?.how ?? ''), r.restored[0]?.how);
}

trace('5-CP949왕복');

// ── CP949 파일이 바이트 그대로 돌아오는가 ───────────────────────────────
{
  const p = join(방, '사내문서.txt');
  const 원본 = encode('가나다 보고서\n항목 3건\n', 'euc-kr').buf;
  writeFileSync(p, 원본);
  const h = new History(방);
  h.nextTurn();
  const rec = h.snapshot(p, 'Edit');
  check('UTF-8 로 못 담는 파일은 바이트로 담는다', rec.enc === 'b64', String(rec.enc));
  writeFileSync(p, '망가뜨림', 'utf8');
  h.undo(1);
  check('CP949 바이트가 그대로 돌아온다', readFileSync(p).equals(원본), readFileSync(p).toString('hex').slice(0, 24));
}

trace('6-BOM왕복');

// ── UTF-8 BOM 이 살아남는가 ─────────────────────────────────────────────
//
// 한 글자만 고쳐도 BOM 이 없어지던 자리다. BOM 이 빠지면 엑셀에서 CSV 한글이
// 깨지고 .ps1 이 오작동한다. 화면의 /diff 에는 의도한 변경만 보이니
// 사용자가 원인을 연결할 방법이 없다 — 그래서 조용한 손상이 가장 나쁘다.
{
  const 원본 = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('이름,수량\n볼펜,3\n', 'utf8')]);
  const r = decode(원본);
  check('BOM 을 떼고 읽는다', r.text.startsWith('이름'), JSON.stringify(r.text.slice(0, 6)));
  check('되돌려 쓸 이름이 utf-8-bom 이다', r.encoding === 'utf-8-bom', String(r.encoding));

  const 다시 = encode(r.text, r.encoding).buf;
  check('BOM 이 그대로 살아 돌아온다', 다시.equals(원본), 다시.subarray(0, 3).toString('hex'));

  // BOM 없는 UTF-8 은 BOM 이 생기면 안 된다 — 반대 방향 손상도 똑같이 나쁘다.
  const 민짜 = Buffer.from('이름,수량\n', 'utf8');
  const r2 = decode(민짜);
  check('BOM 없는 UTF-8 은 그대로 utf-8 이다', r2.encoding === 'utf-8', String(r2.encoding));
  check('없던 BOM 이 생기지 않는다', encode(r2.text, r2.encoding).buf.equals(민짜), '그대로');
}

trace('7-UTF16BE');

// ── UTF-16BE 를 조용히 UTF-8 로 바꾸지 않는가 ───────────────────────────
{
  const 원본 = Buffer.from([0xFE, 0xFF, 0x00, 0x41, 0xAC, 0x00]);   // BOM + 'A' + '가'
  const r = decode(원본);
  check('UTF-16BE 를 알아본다', r.encoding === 'utf-16be', String(r.encoding));
  check('내용이 맞다', r.text === 'A가', JSON.stringify(r.text));
  const 다시 = encode(r.text, 'utf-16be');
  check('UTF-16BE 로 되돌려 쓴다', 다시.buf.equals(원본), 다시.buf.toString('hex'));
  check('UTF-8 로 슬쩍 바뀌지 않는다', !다시.fellBack, String(다시.fellBack));
}

trace('8-Bash로사라진것');

// ── Bash 로 사라진 것도 되돌아가는가 ────────────────────────────────────
//
// 안전망이 Write·Edit 만 지키고 있었다. 그런데 모델은 파일을 옮길 때 당연히
// Bash 를 쓴다 — `mv 옛것.js 새것.js`, `rm 임시.txt`. 그 순간 파일이 사라지는데
// /undo 는 아무것도 못 했다. 절반짜리 안전망이었던 셈이다.
//
// 여기서 재는 것은 둘이다.
//   1. 흔한 자리가 덮이는가 — 슬래시 없는 파일 이름이 제일 흔하다
//   2. **못 뜨는 것을 되돌릴 수 있다고 말하지 않는가** — 이쪽이 더 중요하다.
//      거짓 안심을 주면 사람은 확인 없이 넘어간다.
//
// 파일 이름을 영문으로 두는 이유: 명령줄이 cmd.exe 를 거쳐 간다.
// 콘솔 코드페이지가 949 인 PC 에서 한글 이름을 넘기면 그 자리에서 뭉개진다.
{
  const 판 = join(방, 'bash판');
  mkdirSync(판, { recursive: true });
  const ctx = { scope: makeScope(판), history: new History(판), audit: new Audit(판), seen: new Set() };
  // 어느 셸이 골라졌느냐로 철자를 정한다 — 윈도우라도 Git Bash 가 있으면 rm · mv · cat 이다.
  const 윈 = 정한셸().id === 'cmd';
  const 지우기 = (f) => (윈 ? `del ${f}` : `rm ${f}`);
  const 옮기기 = (a, b) => (윈 ? `move ${a} ${b}` : `mv ${a} ${b}`);

  /*
   * 슬래시 없는 이름을 잡는가.
   *
   * guard.js 의 경로낱말() 은 슬래시가 든 것만 경로로 본다 — 막는 쪽에서는
   * 그게 맞다. 안 걸린 것을 막아 버리면 멀쩡한 명령이 막히기 때문이다.
   * 그런데 `del 지울것.txt` 처럼 슬래시 없는 이름이 실제로 제일 흔하고,
   * 그것들이 통째로 빠져 있었다. 뜨는 쪽은 반대로 넓게 잡는다.
   */
  ctx.history.nextTurn();
  const p1 = join(판, 'temp.txt');
  writeFileSync(p1, '지워질 내용\n', 'utf8');
  const r1 = await TOOLS.Bash.run({ command: 지우기('temp.txt') }, ctx);
  check('명령은 그대로 돈다', !r1.error, String(r1.error));
  check('파일이 실제로 사라졌다', !existsSync(p1), existsSync(p1) ? '남아 있음' : '사라짐');
  check('슬래시 없는 이름도 떠 둔다', (r1.되돌릴것 ?? []).includes('temp.txt'),
    JSON.stringify(r1.되돌릴것));
  const u1 = ctx.history.undo(1);
  check('되돌리면 파일이 살아난다', existsSync(p1), existsSync(p1) ? '살아남' : '없음');
  check('내용까지 그대로 살아난다', existsSync(p1) && readFileSync(p1, 'utf8') === '지워질 내용\n',
    existsSync(p1) ? JSON.stringify(readFileSync(p1, 'utf8')) : '');
  check('무엇을 되돌렸는지 말해 준다', (u1.restored ?? []).length === 1, JSON.stringify(u1.restored?.[0])?.slice(0, 60));

  // 옮기기도 같다. 옮긴 뒤에는 원래 자리가 비어 있으므로 그 자리를 되살린다.
  ctx.history.nextTurn();
  const 원 = join(판, 'old.js');
  writeFileSync(원, 'const 옛것 = 1;\n', 'utf8');
  const r2 = await TOOLS.Bash.run({ command: 옮기기('old.js', 'new.js') }, ctx);
  check('옮기기도 떠 둔다', (r2.되돌릴것 ?? []).includes('old.js'), JSON.stringify(r2.되돌릴것));
  check('옮겨졌다', existsSync(join(판, 'new.js')) && !existsSync(원), '');
  ctx.history.undo(1);
  check('옮긴 것을 되돌리면 원래 자리가 돌아온다', existsSync(원) && readFileSync(원, 'utf8') === 'const 옛것 = 1;\n',
    existsSync(원) ? '돌아옴' : '없음');

  /*
   * 안 바꾸는 명령에는 아무것도 안 뜬다.
   *
   * 매번 뜨면 되돌리기 이력이 `dir`·`node --version` 같은 것으로 가득 찬다.
   * 그러면 정작 되돌리고 싶은 것이 열 칸 뒤로 밀려나서 /undo 를 못 쓴다.
   */
  ctx.history.nextTurn();
  writeFileSync(join(판, 'keep.txt'), '그대로\n', 'utf8');
  const r3 = await TOOLS.Bash.run({ command: 윈 ? 'type keep.txt' : 'cat keep.txt' }, ctx);
  check('읽기만 하는 명령은 안 뜬다', (r3.되돌릴것 ?? []).length === 0, JSON.stringify(r3.되돌릴것));
  check('그래도 명령은 돈다', /그대로/.test(r3.content ?? ''), (r3.content ?? '').trim().slice(0, 20));

  /*
   * 못 뜨는 것을 되돌릴 수 있다고 말하지 않는다.
   *
   * 셸이 풀어 주는 와일드카드는 여기서 안 보인다. `rm *.tmp` 가 무엇을
   * 지울지는 셸만 안다. 억지로 풀면 엉뚱한 파일을 뜨게 되므로 그냥 넘기고,
   * **뜬 것이 없다는 사실이 결과에 그대로 남는다.** 화면은 그 개수를 보고
   * '되돌릴 수 있다' 를 적으므로, 여기가 비어 있으면 아무 약속도 안 한다.
   */
  ctx.history.nextTurn();
  writeFileSync(join(판, 'a.tmp'), '1', 'utf8');
  writeFileSync(join(판, 'b.tmp'), '2', 'utf8');
  const r4 = await TOOLS.Bash.run({ command: 윈 ? 'del *.tmp' : 'rm *.tmp' }, ctx);
  check('와일드카드는 못 뜬다고 사실대로', (r4.되돌릴것 ?? []).length === 0, JSON.stringify(r4.되돌릴것));
  check('그 사실을 숨기려고 명령을 막지는 않는다', !r4.error, String(r4.error));

  // 없는 파일이 적혀 있어도 안 터진다. 헛다리를 짚어도 손해가 없어야 넓게 잡을 수 있다.
  ctx.history.nextTurn();
  const r5 = await TOOLS.Bash.run({ command: 지우기('없는파일이다.txt') }, ctx);
  check('없는 파일은 그냥 넘어간다', (r5.되돌릴것 ?? []).length === 0, JSON.stringify(r5.되돌릴것));
  check('그것 때문에 터지지 않는다', typeof r5 === 'object' && r5 !== null, '');

  // 폴더는 안 뜬다. 폴더를 통째로 뜨면 큰 폴더 하나에 되돌리기가 몇 GB 가 된다.
  ctx.history.nextTurn();
  mkdirSync(join(판, '폴더'), { recursive: true });
  const r6 = await TOOLS.Bash.run({ command: 옮기기('폴더', '폴더2') }, ctx);
  check('폴더는 안 뜬다', (r6.되돌릴것 ?? []).length === 0, JSON.stringify(r6.되돌릴것));

  /*
   * 한 번에 뜨는 개수에 상한이 있다.
   *
   * `rm` 에 파일 이름 백 개를 늘어놓는 일이 없지는 않은데, 그때 백 벌을 뜨면
   * 되돌리기 이력이 그 한 번으로 통째로 밀려난다. 그 앞의 것들을 잃는다.
   */
  ctx.history.nextTurn();
  const 많은것 = [];
  for (let i = 0; i < 40; i++) {
    const n = `m${i}.txt`;
    writeFileSync(join(판, n), String(i), 'utf8');
    많은것.push(n);
  }
  const r7 = await TOOLS.Bash.run({ command: `${윈 ? 'del' : 'rm'} ${많은것.join(' ')}` }, ctx);
  check('한 번에 뜨는 개수에 상한이 있다', (r7.되돌릴것 ?? []).length === 24, `${(r7.되돌릴것 ?? []).length}개`);
}

trace('9-치움');
rmSync(방, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n되돌리기 검사  ${D}(안전망이 파일을 지우지 않는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
