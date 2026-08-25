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
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { History } from '../src/safety/undo.js';
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

trace('8-치움');
rmSync(방, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n되돌리기 검사  ${D}(안전망이 파일을 지우지 않는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
