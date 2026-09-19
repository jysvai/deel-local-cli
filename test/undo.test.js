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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, statSync, chmodSync, appendFileSync } from 'node:fs';
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

trace('4b-새로만든바이너리');

// ── 이번 턴에 **새로 만든** 바이너리는 지운다 (6회차 Gemini 되돌리기6) ──────────
//
// 위 옛 이력 갈래(before:null 이면 못 뜬 것일 수도 있으니 바이너리는 안 지움)가 새 기록에도 그대로 걸려서,
// `cp img.png copy.png` · hwpx 만들기처럼 이번 턴에 새로 만든 그림·문서가 /undo 뒤에도 남았다.
// 새 기록은 「원래 없던 자리」 라고 따로 적어 두고, 그 표가 있으면 바이너리여도 지운다.
{
  const p = join(방, '새그림.png');
  const h = new History(방);
  h.nextTurn();
  const rec = h.snapshot(p, 'Bash');
  check('★ 없던 자리는 없던 자리라고 적는다', rec.없던 === true, JSON.stringify(rec));
  writeFileSync(p, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00, 0x00]));
  const r = h.undo(1);
  check('★★ 이번 턴에 새로 만든 바이너리는 되돌리면 지워진다', !existsSync(p), JSON.stringify(r.restored[0]));
  check('  지웠다고 말한다', /삭제됨/.test(r.restored[0]?.how ?? ''), r.restored[0]?.how);

  // 없던 자리에 **폴더**가 생겼으면 안의 것을 모르니 지우지 않고 그렇다고 말한다 — 실패로 남기지 않는다.
  const 폴더 = join(방, '새폴더');
  h.nextTurn();
  h.snapshot(폴더, 'Bash');
  mkdirSync(폴더);
  writeFileSync(join(폴더, '안.txt'), '안에 든 것');
  const r2 = h.undo(1);
  check('★ 없던 자리에 생긴 폴더는 지우지 않고 그대로 둔다고 말한다', existsSync(join(폴더, '안.txt')) && r2.restored[0]?.skipped === true,
    JSON.stringify(r2.restored[0]));
}

trace('4c-옮긴바이너리');

// ── 옮긴 **그림**을 되돌려도 한 벌은 남는다 (6회차 Gemini 도구6j) ──────────
//
// 4b 의 없던 표(바이너리여도 지운다)가 옮기기에 걸렸다. 옮기기는 떠난 자리와 닿을 자리를 둘 다 뜨는데, 그림은 내용을
// 못 떠서(skipped) 떠난 자리는 「그대로 둠」 으로 넘어가고 닿을 자리는 없던 자리라 지워졌다 — 그림이 한 벌도 안 남았다.
// Move 도구도, 셸 mv(떠난 자리 snapshot · 명령 뒤 새 이름 없던자리기록)도 같았다.
{
  const 그림 = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52]);
  const 판 = mkdtempSync(join(tmpdir(), 'deel-undo-mv-'));
  const ctx = { scope: makeScope(판), history: new History(판), audit: new Audit(판), seen: new Set(), 모델컨텍스트: 200000, enc: new Map() };
  ctx.history.nextTurn();
  writeFileSync(join(판, 'pic.png'), 그림);
  const r = await TOOLS.Move.run({ from: 'pic.png', to: 'moved.png' }, ctx);
  check('준비: 그림을 Move 로 옮겼다', !r.error && existsSync(join(판, 'moved.png')), String(r.error ?? ''));
  const u = ctx.history.undo(1);
  const 남은 = ['pic.png', 'moved.png'].filter((f) => existsSync(join(판, f)));
  check('★★ Move 로 옮긴 그림을 되돌려도 한 벌은 남는다', 남은.length === 1 && readFileSync(join(판, 남은[0])).equals(그림),
    `${남은.join(',') || '없음'} · ${JSON.stringify(u.restored)}`);
  check('  옮겨 온 그림을 왜 안 지웠는지 말한다', u.restored.some((x) => /moved\.png$/.test(x.path) && x.skipped === true && /그대로 둠/.test(x.how)),
    JSON.stringify(u.restored));

  // 폴더째 옮겨도 파일마다 짝지어 뜬다 — 그림은 남고, 같이 옮긴 글 파일은 원래 자리로 돌아온다.
  mkdirSync(join(판, 'imgs'));
  writeFileSync(join(판, 'imgs', 'a.png'), 그림);
  writeFileSync(join(판, 'imgs', 'note.txt'), '메모\n', 'utf8');
  ctx.history.nextTurn();
  const r2 = await TOOLS.Move.run({ from: 'imgs', to: 'imgs2' }, ctx);
  check('준비: 폴더를 옮겼다', !r2.error && existsSync(join(판, 'imgs2', 'a.png')), String(r2.error ?? ''));
  ctx.history.undo(1);
  check('★★ 폴더째 옮긴 그림도 되돌린 뒤 한 벌은 남는다', existsSync(join(판, 'imgs', 'a.png')) || existsSync(join(판, 'imgs2', 'a.png')), '둘 다 없음');
  check('  같이 옮긴 글 파일은 원래 자리로 돌아온다',
    existsSync(join(판, 'imgs', 'note.txt')) && readFileSync(join(판, 'imgs', 'note.txt'), 'utf8') === '메모\n' && !existsSync(join(판, 'imgs2', 'note.txt')), '');

  // 셸 mv 가 남기는 기록 꼴 그대로 — 떠난 자리를 명령 전에 뜨고(바이너리라 skipped), 새 이름은 명령 뒤에 없던 자리로 적는다.
  const 판2 = mkdtempSync(join(tmpdir(), 'deel-undo-mv2-'));
  const h = new History(판2);
  h.nextTurn();
  const 앞 = join(판2, 'shot.png');
  const 뒤 = join(판2, 'shot2.png');
  writeFileSync(앞, 그림);
  h.snapshot(앞, 'Bash');
  writeFileSync(뒤, 그림);
  rmSync(앞);
  h.없던자리기록(뒤, 'Bash');
  h.undo(1);
  check('★★ 셸 mv 로 옮긴 그림을 되돌려도 한 벌은 남는다', existsSync(앞) || existsSync(뒤), '둘 다 없음');

  // 짝: 크기가 다른 새 그림은 옮겨 온 것이 아니다 — 같은 턴에 사라진 그림이 있어도 4b 대로 지운다.
  const 판3 = mkdtempSync(join(tmpdir(), 'deel-undo-mv3-'));
  const h3 = new History(판3);
  h3.nextTurn();
  const 지운것 = join(판3, 'gone.png');
  const 새것 = join(판3, 'new.png');
  writeFileSync(지운것, 그림);
  h3.snapshot(지운것, 'Bash');
  rmSync(지운것);
  h3.snapshot(새것, 'Bash');
  writeFileSync(새것, Buffer.concat([그림, 그림]));
  h3.undo(1);
  check('  짝: 크기가 다른 새 그림은 사라진 그림이 있어도 지운다', !existsSync(새것), '새 그림이 남음');

  for (const d of [판, 판2, 판3]) rmSync(d, { recursive: true, force: true });
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
  check('UTF-16BE 를 알아본다', r.encoding.startsWith('utf-16be'), String(r.encoding));
  check('내용이 맞다', r.text === 'A가', JSON.stringify(r.text));
  /*
   * 되돌려 쓸 때는 **읽을 때 받은 이름**을 그대로 넣는다. 부르는 쪽이 하는
   * 그대로다(`encode(next, 읽음.encoding)`). 여기에 'utf-16be' 를 손으로 박아
   * 두면 표식 유무를 구별하게 된 뒤로는 잘못된 것을 재게 된다.
   */
  const 다시 = encode(r.text, r.encoding);
  check('UTF-16BE 로 되돌려 쓴다', 다시.buf.equals(원본), 다시.buf.toString('hex'));
  check('UTF-8 로 슬쩍 바뀌지 않는다', !다시.fellBack, String(다시.fellBack));

  /*
   * ★★★ 표식은 원본에 있던 것만 붙인다.
   *
   * 표식 없는 UTF-16 도 읽을 수 있게 되면서 이 자리가 생겼다. 전에는 표식
   * 있는 파일만 여기까지 왔으니 언제나 붙이면 맞았는데, 이제는 없던 파일에
   * 두 바이트가 생긴다 — 한 글자 고쳤을 뿐인데. UTF-8 쪽에서 이미 겪고
   * 고쳐 둔 자리다(바로 위 6번).
   */
  // 표식 없는 BE. 너무 짧으면 「우연히 그런 것」 과 못 가르므로 넉넉히 준다.
  const 민짜16 = (() => {
    const le = Buffer.from('Hello world line\r\n', 'utf16le');
    for (let i = 0; i + 1 < le.length; i += 2) { const t = le[i]; le[i] = le[i + 1]; le[i + 1] = t; }
    return le;
  })();
  const r2 = decode(민짜16);
  check('★★ 표식 없는 UTF-16 은 이름에 -bom 이 안 붙는다',
    r2.encoding === 'utf-16be', String(r2.encoding));
  check('★★★ 없던 표식이 생기지 않는다',
    encode(r2.text, r2.encoding).buf.equals(민짜16), encode(r2.text, r2.encoding).buf.toString('hex'));
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
   * 옮긴 **새 이름**도 되돌리면 사라져야 한다 (6회차 Gemini 되돌리기6 을 따라가다 찾음).
   *
   * 지금 있는 이름만 떠서 `new.js` 는 기록이 없었다 — 원래 자리만 살아나고 새 이름도 남아 두 벌이 됐다.
   * 없는 이름을 미리 뜨면 `rm *.tmp` 류에 헛기록이 쌓이므로, 명령 **뒤에** 새로 생긴 파일만 없던 자리로 적는다.
   */
  check('★★ 옮긴 뒤 되돌리면 새 이름은 사라진다 — 두 벌이 안 남는다', !existsSync(join(판, 'new.js')), existsSync(join(판, 'new.js')) ? '새 이름이 남음' : '');

  ctx.history.nextTurn();
  writeFileSync(join(판, 'src.txt'), '복사할 것\n', 'utf8');
  const r2b = await TOOLS.Bash.run({ command: 윈 ? 'copy src.txt dup.txt' : 'cp src.txt dup.txt' }, ctx);
  check('준비: 복사됐다', existsSync(join(판, 'dup.txt')), String(r2b.error ?? ''));
  check('★ 복사로 새로 생긴 이름도 되돌릴 거리로 말한다', (r2b.되돌릴것 ?? []).includes('dup.txt'), JSON.stringify(r2b.되돌릴것));
  ctx.history.undo(1);
  check('★★ 복사한 것을 되돌리면 사본은 사라지고 원본은 남는다', !existsSync(join(판, 'dup.txt')) && existsSync(join(판, 'src.txt')),
    `사본 ${existsSync(join(판, 'dup.txt'))} · 원본 ${existsSync(join(판, 'src.txt'))}`);
  // 그림을 복사한 사본도 같다 — 새로 만든 것이라 바이너리여도 지운다 (undo.js 없던 표).
  ctx.history.nextTurn();
  writeFileSync(join(판, 'pic.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00, 0x00, 0x00, 0x0D]));
  const r2d = await TOOLS.Bash.run({ command: 윈 ? 'copy pic.png pic2.png' : 'cp pic.png pic2.png' }, ctx);
  check('준비: 그림이 복사됐다', existsSync(join(판, 'pic2.png')), String(r2d.error ?? ''));
  ctx.history.undo(1);
  check('★★ 복사로 새로 만든 그림도 되돌리면 사라진다 (바이너리여도)', !existsSync(join(판, 'pic2.png')) && existsSync(join(판, 'pic.png')),
    `사본 ${existsSync(join(판, 'pic2.png'))} · 원본 ${existsSync(join(판, 'pic.png'))}`);

  ctx.history.nextTurn();
  mkdirSync(join(판, 'inner'), { recursive: true });
  writeFileSync(join(판, 'into.txt'), '들어갈 것\n', 'utf8');
  const r2c = await TOOLS.Bash.run({ command: 옮기기('into.txt', 'inner') }, ctx);
  check('준비: 폴더 안으로 옮겨졌다', existsSync(join(판, 'inner', 'into.txt')), String(r2c.error ?? ''));
  ctx.history.undo(1);
  check('★★ 폴더 안으로 옮긴 것을 되돌리면 원래 자리만 남는다', existsSync(join(판, 'into.txt')) && !existsSync(join(판, 'inner', 'into.txt')),
    `원래 ${existsSync(join(판, 'into.txt'))} · 폴더 안 ${existsSync(join(판, 'inner', 'into.txt'))}`);

  /*
   * 폴더 안에 **같은 이름이 이미 있으면** 명령 전에 떠 둔다 (6회차 Gemini 셸뜨기6m N1).
   *
   * 폴더 안으로 들어가는 새 이름은 무조건 명령 뒤로 미뤘다. 그래서 `cp same.txt box` 가 덮어쓴 box/same.txt 를
   * 명령 뒤에 「원래 없던 자리」 로 적었고, /undo 는 옛 내용으로 되돌리기는커녕 그 파일을 **지웠다.** mv 도 같았다.
   */
  const 박스 = join(판, 'box');
  mkdirSync(박스, { recursive: true });
  for (const [이름, 명령] of [['cp', 윈 ? 'copy /Y same.txt box' : 'cp same.txt box'], ['mv', 윈 ? 'move /Y same.txt box' : 'mv same.txt box']]) {
    ctx.history.nextTurn();
    writeFileSync(join(판, 'same.txt'), '새것\n', 'utf8');
    writeFileSync(join(박스, 'same.txt'), '있던것\n', 'utf8');
    const rN = await TOOLS.Bash.run({ command: 명령 }, ctx);
    check(`준비: ${이름} 가 폴더 안 같은 이름을 덮어썼다`, readFileSync(join(박스, 'same.txt'), 'utf8') === '새것\n', String(rN.error ?? ''));
    ctx.history.undo(1);
    const 남은 = existsSync(join(박스, 'same.txt')) ? readFileSync(join(박스, 'same.txt'), 'utf8') : '(없음)';
    check(`★★ ${이름} 로 덮어쓴 폴더 안 같은 이름은 되돌리면 옛 내용으로 돌아온다 — 지워지지 않는다`, 남은 === '있던것\n', JSON.stringify(남은));
  }

  /*
   * `cd 하위 && rm x` — cd 한 자리 기준으로도 푼다 (6회차 직접 사냥 M2 · Gemini 셸뜨기6m N2).
   *
   * 낱말을 작업 폴더 기준으로만 풀어서, 모델이 아주 흔히 쓰는 이 꼴에서 down/gone.txt 를 못 떴다. 뜬 것이 0이라
   * 되돌린다는 말도 없었지만 /undo 뒤에도 안 돌아왔다. 리디렉션으로 만든 새 파일도 cd 한 자리에 생겨 안 지워졌다.
   */
  const 아래 = join(판, 'down');
  mkdirSync(아래, { recursive: true });
  ctx.history.nextTurn();
  writeFileSync(join(아래, 'gone.txt'), '살려야 할 것\n', 'utf8');
  const rCd = await TOOLS.Bash.run({ command: `cd down && ${지우기('gone.txt')}` }, ctx);
  check('준비: cd 뒤에 지웠다', !existsSync(join(아래, 'gone.txt')), String(rCd.error ?? ''));
  check('★ cd 한 자리의 파일도 떠 뒀다고 말한다', (rCd.되돌릴것 ?? []).includes('down/gone.txt'), JSON.stringify(rCd.되돌릴것));
  ctx.history.undo(1);
  check('★★ cd 뒤에 지운 파일도 되돌리면 살아난다',
    existsSync(join(아래, 'gone.txt')) && readFileSync(join(아래, 'gone.txt'), 'utf8') === '살려야 할 것\n', existsSync(join(아래, 'gone.txt')) ? '내용 다름' : '없음');
  ctx.history.nextTurn();
  const rCd2 = await TOOLS.Bash.run({ command: 'cd down && echo hi > made2.txt' }, ctx);
  check('준비: cd 뒤에 리디렉션으로 만들었다', existsSync(join(아래, 'made2.txt')), String(rCd2.error ?? ''));
  ctx.history.undo(1);
  check('★★ cd 뒤에 리디렉션으로 만든 파일도 되돌리면 사라진다', !existsSync(join(아래, 'made2.txt')), '남음');

  /*
   * 쓰는 꼴에서 **파일이 아닌 낱말**을 「떠 뒀습니다」 목록에 올리지 않는다 (6회차 직접 사냥 M1).
   *
   * 리디렉션이 든 명령은 지금 없는 낱말까지 없던 자리로 미리 뜬다(새로 만드는 파일 때문에). 그 낱말이 그대로 목록에
   * 올라가 `echo new > a.txt` 한 줄에 화면이 「echo · new · a.txt 떠 뒀습니다」 를 찍었다. 명령 뒤에 정말 생긴 것만 올린다.
   */
  ctx.history.nextTurn();
  writeFileSync(join(판, 'over.txt'), 'old\n', 'utf8');
  const rM1 = await TOOLS.Bash.run({ command: 'echo fresh > over.txt' }, ctx);
  check('★ 쓰는 꼴의 되돌릴것 에 파일 아닌 낱말이 안 섞인다', JSON.stringify(rM1.되돌릴것) === '["over.txt"]', JSON.stringify(rM1.되돌릴것));
  ctx.history.undo(1);
  check('  짝: 덮어쓴 파일은 그대로 되돌아온다', readFileSync(join(판, 'over.txt'), 'utf8') === 'old\n', JSON.stringify(readFileSync(join(판, 'over.txt'), 'utf8')));
  ctx.history.nextTurn();
  const rM1b = await TOOLS.Bash.run({ command: 'echo fresh > born.txt' }, ctx);
  check('  짝: 새로 만든 파일은 목록에 오른다', (rM1b.되돌릴것 ?? []).includes('born.txt') && !(rM1b.되돌릴것 ?? []).includes('echo'), JSON.stringify(rM1b.되돌릴것));
  ctx.history.undo(1);
  check('  짝: 새로 만든 파일은 되돌리면 사라진다', !existsSync(join(판, 'born.txt')), '남음');

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
  check('상한에 걸렸다는 사실을 같이 말한다', r7.스냅샷상한걸림 === true, String(r7.스냅샷상한걸림));

  /*
   * ── **명령 뒤에 볼 자리**가 상한에 걸려도 말해야 한다 ──────────────────
   *
   * `mv a.txt n00.txt … n29.txt` 처럼 지금 없는 이름이 잔뜩이면 그것들은
   * 「명령 뒤에 정말 생겼나」 를 볼 자리(나중볼것)로 쌓인다. 그 목록이 상한을
   * 넘으면 뒤엣것은 **잘려 나가고 아예 안 본다** — 그래 놓고 상한걸림 은
   * false 였다.
   *
   * 뜬 개수만 세는 앞 갈래와 성격이 같은 누락이다. 화면은 이 값을 보고
   * 「뒤엣것은 보지도 못했다」 를 적으므로, 여기서 false 면 사람은 마흔 개가
   * 다 되돌아갈 줄 안다. 머리말(바꾸기전스냅샷 @returns)이 이미 그렇게
   * 약속해 두었다.
   */
  ctx.history.nextTurn();
  writeFileSync(join(판, 'src.txt'), '옮길 것\n', 'utf8');
  const 새이름들 = [];
  for (let i = 0; i < 30; i++) 새이름들.push(`n${String(i).padStart(2, '0')}.txt`);
  const r8 = await TOOLS.Bash.run({ command: `${옮기기('src.txt', 새이름들.join(' '))}` }, ctx);
  check('★ 나중에 볼 자리가 잘려도 상한에 걸렸다고 말한다', r8.스냅샷상한걸림 === true,
    `상한걸림=${r8.스냅샷상한걸림} 되돌릴것=${(r8.되돌릴것 ?? []).length}개`);

  // 짝: 상한 안이면 거짓 그대로다. 늘 참이면 이 값이 아무 말도 안 하는 것과 같다.
  ctx.history.nextTurn();
  writeFileSync(join(판, 'src2.txt'), '옮길 것\n', 'utf8');
  const r9 = await TOOLS.Bash.run({ command: 옮기기('src2.txt', 'src3.txt') }, ctx);
  check('  짝: 상한 안이면 안 걸렸다고 한다', r9.스냅샷상한걸림 === false, String(r9.스냅샷상한걸림));
}

trace('9-치움');
rmSync(방, { recursive: true, force: true });

/*
 * ── 못 되돌린 것을 되돌렸다고 세지 않는다 ───────────────────────────────
 *
 * 되돌리기가 실패할 수 있다. 그 자리에 폴더가 생겼거나(EISDIR), 다른 프로그램이
 * 파일을 물고 있거나, 권한이 막혔거나.
 *
 * 그때 네 가지가 한꺼번에 어긋나고 있었다.
 *
 *   ① 화면은 「파일 1개를 되돌렸습니다」 — 실패한 것까지 셌다
 *   ② 감사기록에도 그 부풀린 수가 남는다
 *   ③ 부르는 쪽이 /diff 목록에서 그 파일을 뺀다 — 진짜로 바뀐 파일이 사라진다
 *   ④ **스냅샷을 지운다** — 다시 시도할 길이 없어진다
 *
 * 파일만 고쳐진 채로 남고 아무도 그걸 모른다. 되돌리기는 이 프로그램의 안전망이라
 * 여기서 조용히 틀리는 것이 제일 나쁘다.
 */
trace('9-못되돌린것');
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-undo-fail-'));
  const 이력 = new History(방);

  const 될것 = join(방, '될것.txt');
  const 안될것 = join(방, '안될것.txt');
  writeFileSync(될것, '처음\n', 'utf8');
  writeFileSync(안될것, '처음\n', 'utf8');

  이력.nextTurn();
  이력.snapshot(될것, '고침');
  이력.snapshot(안될것, '고침');
  writeFileSync(될것, '고쳐짐\n', 'utf8');
  writeFileSync(안될것, '고쳐짐\n', 'utf8');

  // 되돌리기를 **진짜로** 실패하게 만든다 — 그 자리를 폴더로 바꿔 둔다.
  rmSync(안될것, { force: true });
  mkdirSync(안될것);

  const r = 이력.undo(1);
  const 실패한것 = r.restored.filter((x) => x.ok === false);

  check('★ 되돌린 수는 진짜로 되돌아간 것만 센다', r.되돌린수 === 1,
    `${r.되돌린수}개 (목록에는 ${r.restored.length}개)`);
  check('★ 못한 것을 따로 알려 준다', 실패한것.length === 1 && r.못한것?.length === 1,
    실패한것.map((x) => x.how).join(' · '));
  check('된 것은 진짜로 되돌아갔다', readFileSync(될것, 'utf8') === '처음\n',
    JSON.stringify(readFileSync(될것, 'utf8')));

  /*
   * ★ 그리고 **다시 시도할 수 있어야** 한다.
   *
   * 전에는 성패를 안 가리고 그 턴의 기록을 통째로 잘라냈다. 그러면 한 번 실패한
   * 파일은 스냅샷이 사라져 영영 못 되돌린다 — 안전망이 스스로를 지운 셈이다.
   */
  const 남은기록 = 이력.all().filter((x) => x.path === 안될것);
  check('★ 못 되돌린 것의 기록은 남겨 둔다 (다시 해 볼 수 있게)', 남은기록.length === 1,
    `${남은기록.length}개`);
  const 된기록 = 이력.all().filter((x) => x.path === 될것);
  check('되돌린 것의 기록은 잘라낸다', 된기록.length === 0, `${된기록.length}개`);

  // 막던 것을 치우고 다시 하면 이번엔 된다.
  rmSync(안될것, { recursive: true, force: true });
  writeFileSync(안될것, '고쳐짐\n', 'utf8');
  const 다시 = 이력.undo(1);
  check('★ 막던 것을 치우면 다시 되돌릴 수 있다',
    다시.되돌린수 === 1 && readFileSync(안될것, 'utf8') === '처음\n',
    JSON.stringify(readFileSync(안될것, 'utf8')));

  rmSync(방, { recursive: true, force: true });
}

trace('9b-이름이-부딪쳐-못되돌린것');

/*
 * ★★ 이름이 부딪쳐 **못 되돌린** 기록까지 잘라내던 것 (8회차 판정 undo.js:639·659).
 *
 * 되돌리기는 「되돌린 것만 잘라내고, 못한 것은 그대로 두어 한 번 더 시도할 수 있게」
 * 한다고 적어 두었다. 그런데 못한 것을 `ok === false` 로만 셌다 — 원래 이름 자리에
 * 다른 파일이 있어 이름을 못 되돌린 갈래는 `skipped` 로만 적혀서 그 셈에 안 들었다.
 * 그래서 이름이 그대로 남은 채 이력의 그 턴이 통째로 사라졌고(줄 0개 · turns []),
 * 부딪친 파일을 치운 뒤 /undo 를 다시 쳐도 되돌릴 기록이 없었다. 안전망이 스스로를 지운다.
 *
 * 또 하나: 그 갈래는 restored 에 **원래 이름**으로 적힌다. 이력에서 그 줄을 찾을 때
 * 쓰는 것은 **지금 이름**이라, 그 둘을 같은 것으로 다루면 남기는 셈이 또 빗나간다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-undo-이름부딪침-'));
  const 이력 = new History(방);
  const 앞 = join(방, 'a.txt');
  const 뒤 = join(방, 'b.txt');
  writeFileSync(앞, '첫 내용\n', 'utf8');

  이력.nextTurn();
  const { renameSync } = await import('node:fs');
  renameSync(앞, 뒤);
  이력.이름바꿈기록(앞, 뒤, 'Move');
  writeFileSync(앞, '남이 그 자리에 새로 만든 것\n', 'utf8');   // 원래 이름 자리가 막혔다

  const r = 이력.undo(1);
  check('이름이 부딪치면 안 바꾸고 그렇다고 적는다',
    r.되돌린수 === 0 && r.restored.some((x) => x.skipped === true), JSON.stringify(r.restored));
  check('★★ 못 되돌린 이름 기록은 이력에 남긴다 (다시 해 볼 수 있게)',
    이력.all().length === 1 && 이력.turns().length === 1, `줄 ${이력.all().length}개 · turns ${JSON.stringify(이력.turns())}`);
  check('  파일은 그대로다', existsSync(뒤) && readFileSync(앞, 'utf8') === '남이 그 자리에 새로 만든 것\n', '');

  // 부딪치던 파일을 치우고 다시 하면 이번엔 된다.
  rmSync(앞, { force: true });
  const 다시 = 이력.undo(1);
  check('★★ 부딪치던 것을 치우면 다시 되돌릴 수 있다',
    다시.되돌린수 === 1 && existsSync(앞) && !existsSync(뒤) && readFileSync(앞, 'utf8') === '첫 내용\n',
    JSON.stringify(다시.restored));
  check('  되돌리고 나면 그 기록은 잘라낸다', 이력.all().length === 0, `줄 ${이력.all().length}개`);

  rmSync(방, { recursive: true, force: true });
}

trace('9c-0은-아무것도-아니다');

/*
 * ★ `undo(0)` 이 **전부** 되돌렸다 (8회차 판정 undo.js:542 · 452).
 *
 * `turns.slice(-0)` 은 `slice(0)` 이라 통째로 돌아온다. 지금 유일한 호출부(commands.js)가
 * 0 을 먼저 막고 있어 화면에는 안 나왔지만, 그건 부르는 쪽 한 자리가 지키는 것이지 이
 * 함수가 지키는 것이 아니다 — 되돌리기는 **파일을 실제로 되돌리는** 자리라 여기서 막는다.
 * prune 은 거울처럼 반대로 샜다: `keep:0` 이면 남길 턴을 전부 남겨 한 줄도 안 버렸다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-undo-영-'));
  const 이력 = new History(방);
  const x = join(방, 'x.txt');
  const y = join(방, 'y.txt');
  writeFileSync(x, '옛x\n', 'utf8');
  writeFileSync(y, '옛y\n', 'utf8');
  이력.nextTurn(); 이력.snapshot(x, '고침'); writeFileSync(x, '새x\n', 'utf8');
  이력.nextTurn(); 이력.snapshot(y, '고침'); writeFileSync(y, '새y\n', 'utf8');

  const r = 이력.undo(0);
  // 되돌릴 턴이 없을 때와 **같은 모양**으로 돌려준다 (그 갈래는 되돌린수 를 안 싣는다).
  check('★★ undo(0) 은 한 턴도 안 되돌린다',
    r.turns === 0 && (r.되돌린수 ?? 0) === 0 && r.restored.length === 0 && r.turnIds.length === 0,
    JSON.stringify({ turns: r.turns, 되돌린수: r.되돌린수, restored: r.restored.length }));
  check('  파일도 이력도 그대로다',
    readFileSync(x, 'utf8') === '새x\n' && readFileSync(y, 'utf8') === '새y\n' && 이력.turns().length === 2, '');
  check('  음수도 마찬가지다', 이력.undo(-1).turns === 0 && 이력.turns().length === 2, '');
  check('  1 은 그대로 한 턴을 되돌린다', 이력.undo(1).되돌린수 === 1 && readFileSync(y, 'utf8') === '옛y\n', '');

  // prune 은 반대쪽 — keep:0 이면 남길 턴이 없다는 말이다.
  const 남은턴 = 이력.turns().length;
  const 버린 = 이력.prune({ keep: 0 });
  check('★★ prune({keep:0}) 은 남김없이 버린다',
    버린 === 1 && 이력.turns().length === 0 && 남은턴 === 1, `${버린}개 버림 · ${이력.turns().length}턴 남음`);

  rmSync(방, { recursive: true, force: true });
}

trace('셸쓰기-다른턴을-되돌리던-것');

/*
 * ★★ 셸로 고친 파일 때문에 **엉뚱한 턴**이 되돌아가던 것.
 *
 * ── 무슨 일이었나 ───────────────────────────────────────────────────────
 *
 * 스냅샷은 `isMutating(cmd)` 일 때만 떴다. 그 정규식은 `mv`·`cp`·`rm` 같은
 * **첫 낱말**만 본다. 그런데 모델이 셸에서 파일을 고치는 흔한 방법은 그게
 * 아니다 — `echo x > a.js`, `sed -i`, `tee`, `node -e`, `npx prettier --write`.
 * 열한 가지를 재 보니 `rm` 하나만 걸렸다.
 *
 * 못 뜨는 것이 있는 것 자체는 이 프로그램이 원래 인정하는 바다(위 머리말과
 * docs/safety.md — `↩` 줄이 없으면 아무것도 약속 안 한다). 진짜 문제는
 * 그다음이었다.
 *
 * 스냅샷이 안 뜨면 그 턴은 기록을 **한 줄도** 안 남긴다. 그러면
 * `History.turns()` 가 그 턴의 존재 자체를 모른다. 그래서 `/undo` 한 번이
 * 직전의 **무관한 턴**을 되돌리고, 화면에는 초록색 성공 줄이 뜬다.
 *
 *   턴1: Edit a.js (A0 → A1)
 *   턴2: echo B_PWNED > b.js
 *   /undo  →  a.js 가 A0 으로 되돌아감. b.js 는 그대로 오염.  "✓ 1개 되돌림"
 *
 * 사용자는 방금 벌어진 일을 되돌리라고 했고, 초록불을 봤고, 지키고 싶던
 * 것을 잃었고, 지우고 싶던 것은 그대로 남았다. 「못 되돌린다」 가 아니라
 * **「엉뚱한 것을 되돌린다」** 이므로 정직 규칙(집안 규칙 6) 위반이다.
 *
 * ── 어떻게 고쳤나 ───────────────────────────────────────────────────────
 *
 * 새 기록 종류를 만들지 않았다. `skipped` 모양이 이미 있고(binary·못읽음),
 * 이미 정직한 줄을 찍는다. 셸이 파일에 쓸 낌새면 그 파일로 `skipped` 기록을
 * 하나 남긴다 — 그러면 턴이 보이고, /undo 가 뛰어넘지 못한다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-shellwrite-'));
  const h = new History(방);
  const scope = makeScope(방);
  const ctx = { scope, history: h, audit: new Audit(방), seen: new Set() };

  const a = join(방, 'a.js');
  const b = join(방, 'b.js');
  writeFileSync(a, 'A0\n', 'utf8');
  writeFileSync(b, 'B0\n', 'utf8');

  // 턴 1 — Write 로 a.js 를 고친다 (여기는 원래도 스냅샷이 뜬다).
  h.nextTurn();
  await TOOLS.Write.run({ file_path: 'a.js', content: 'A1\n' }, ctx);
  check('셸쓰기: 턴1 의 Write 는 먹혔다', readFileSync(a, 'utf8').trim() === 'A1', readFileSync(a, 'utf8').trim());

  // 턴 2 — 셸로 b.js 를 덮어쓴다. 여기가 여태 아무 기록도 안 남기던 자리다.
  h.nextTurn();
  await TOOLS.Bash.run({ command: `echo B_PWNED > "${b}"`, description: '덮어쓰기' }, ctx);

  const 턴수 = h.turns().length;
  check('★★ 셸로 덮어쓴 턴이 이력에 보인다', 턴수 >= 2, `턴 ${턴수}개`);

  const r = h.undo(1);
  const a지금 = readFileSync(a, 'utf8').trim();
  check('★★ /undo 한 번이 앞의 무관한 턴을 안 건드린다', a지금 === 'A1',
    `a.js = ${a지금} (A1 이어야 한다 — A0 이면 엉뚱한 턴을 되돌린 것)`);
  check('★ 되돌린 결과가 무언가를 말해 준다', !!r && typeof r === 'object', JSON.stringify(r).slice(0, 120));

  rmSync(방, { recursive: true, force: true });
}

trace('잠금-되돌리기기록도-본인만');

/*
 * ── 되돌리기 기록은 남의 파일 **원문**을 담는다 ─────────────────────────
 *
 * 되돌리려면 고치기 전 내용을 그대로 들고 있어야 한다. 그래서 여기에는
 * `.env` · `id_rsa` · `.npmrc` 가 평문으로 들어온다. 가리지도 않는다 —
 * 가리면 되돌릴 때 사람의 진짜 열쇠가 표로 덮여 없어진다.
 *
 * 즉 이 자리에서 지키는 방법은 파일 권한 하나뿐이었는데 그것이 없었다.
 * umask 022 면 0644 로 만들어져, 같은 PC 의 다른 계정과 공유 홈의 아무나가
 * deel 이 손댄 모든 파일의 원문을 읽었다 — 주인이 0600 으로 잠가 둔 것까지.
 * `.deel` 아래 다른 기록(store · audit)은 전부 잠그는데 여기만 안 잠갔다.
 */
{
  const 살림 = mkdtempSync(join(tmpdir(), 'deel-undo-lock-'));
  const h = new History(살림);
  h.nextTurn();
  const 비밀 = join(살림, '.env');
  writeFileSync(비밀, 'API_KEY=sk-매우비밀\n', 'utf8');
  h.snapshot(비밀, 'Bash');

  // 윈도우는 chmod 가 아무 일도 안 하고 성공한다 — 거기서 「걸었다」 고 적으면 잠근 척이다.
  const 잠금맞나 = (x) => (process.platform === 'win32' ? x?.못함 === 'windows' && x?.모드 === undefined : x?.모드 === 0o600);
  check(process.platform === 'win32' ? '★ 윈도우에서는 잠갔다고 적지 않는다' : '★ 되돌리기 기록에 0600 을 건다',
    잠금맞나(h.잠금), JSON.stringify(h.잠금));
  check('건 자리가 허공이 아니다 (파일이 실제로 있다)', existsSync(h.file), h.file);
  // 잠갔어도 원문은 그대로 담겨 있어야 한다 — 되돌릴 것이 없으면 뜻이 없다.
  check('원문은 그대로 담긴다', readFileSync(h.file, 'utf8').includes('sk-매우비밀'));

  if (process.platform !== 'win32') {
    check('★★ 되돌리기 기록이 정말 0600 이다',
      (statSync(h.file).mode & 0o777) === 0o600, '0' + (statSync(h.file).mode & 0o777).toString(8));
    check('★ 그 폴더도 본인 것이다 (파일만 잠그면 이름은 다 보인다)',
      (statSync(h.dir).mode & 0o777) === 0o700, '0' + (statSync(h.dir).mode & 0o777).toString(8));
  }

  // 통째로 다시 쓰는 자리(되돌리기)를 지나도 빗장이 풀리면 안 된다.
  h.undo(1);
  check(process.platform === 'win32' ? '★ 되돌린 뒤에도 잠갔다고 적지 않는다' : '★ 되돌린 뒤에도 잠겨 있다',
    잠금맞나(h.잠금), JSON.stringify(h.잠금));
  if (process.platform !== 'win32') {
    check('★★ 되돌린 뒤에도 정말 0600 이다',
      (statSync(h.file).mode & 0o777) === 0o600, '0' + (statSync(h.file).mode & 0o777).toString(8));
  }
  rmSync(살림, { recursive: true, force: true });
}

trace('쓰기-실패-턴');

/*
 * ── ★★ 스냅샷을 뜬 **뒤에** 쓰기가 깨지면 그 턴을 남기지 않는다 ─────────────
 *
 * Write·Edit·Append·Move 는 「정말 쓰기 직전」 에 뜬다. 그런데 그 쓰기 자체가
 * 깨지는 판이 있다 — 읽기 전용 파일(EPERM·EACCES), 다른 프로그램이 잡고 있는
 * 파일(EBUSY). 파일은 한 글자도 안 바뀌었는데 기록은 남아서, /undo 는 그
 * 헛턴을 되돌리고 「되돌린수=1」 을 찍고 앞 턴의 진짜 변경은 그대로 둔다.
 * 기록을 지울 길이 History 에 없었다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-undo-fail-'));
  const h = new History(방);
  h.nextTurn();
  const 가 = join(방, '가.txt');
  writeFileSync(가, '원래\n');
  check('떴나 — 안 뜬 파일은 거짓', h.떴나?.(가) === false, String(h.떴나));
  h.snapshot(가, 'Write');
  check('떴나 — 뜬 파일은 참', h.떴나?.(가) === true);
  check('★ 버리기가 이번 턴의 그 기록을 지운다', h.버리기?.(가) === true && h.turns().length === 0 && h.떴나(가) === false,
    `turns=${h.turns().length}`);
  h.snapshot(가, 'Write');
  check('버린 뒤에 다시 뜨면 새로 적힌다', h.turns().length === 1, `turns=${h.turns().length}`);
  rmSync(방, { recursive: true, force: true });
}
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-undo-fail2-'));
  const ctx = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set(), enc: new Map() };
  const 감싸기 = async (일) => { try { return await 일(); } catch (e) { return { error: `(던짐) ${e.message}` }; } };
  ctx.history.nextTurn();
  await TOOLS.Write.run({ file_path: 'doc.txt', content: 'v1\n' }, ctx);   // 앞 턴 — 진짜 변경
  ctx.history.nextTurn();
  const 잠김 = join(방, '잠김.txt');
  writeFileSync(잠김, '잠김\n');
  const 고친것 = join(방, '고친것.txt');
  writeFileSync(고친것, '처음\n');
  chmodSync(잠김, 0o444);
  let 막히나 = false;
  try { appendFileSync(잠김, 'x'); } catch { 막히나 = true; }
  if (막히나) {
    writeFileSync(join(방, 'probe'), '');
    const 턴수 = ctx.history.turns().length;
    await TOOLS.Read.run({ file_path: '잠김.txt' }, ctx);
    const w = await 감싸기(() => TOOLS.Write.run({ file_path: '잠김.txt', content: '새것\n' }, ctx));
    const e = await 감싸기(() => TOOLS.Edit.run({ file_path: '잠김.txt', old_string: '잠김', new_string: '열림' }, ctx));
    const a = await 감싸기(() => TOOLS.Append.run({ file_path: '잠김.txt', content: '더\n' }, ctx));
    check('★ 못 쓴 Write·Edit·Append 는 날 오류가 아니라 사람 말 오류로 돌려준다',
      [w, e, a].every((r) => !!r.error && !/^\(던짐\)/.test(r.error)), [w, e, a].map((r) => String(r.error ?? r.content).split('\n')[0]).join(' | '));
    check('★★ 못 쓴 것은 되돌리기 이력에 턴을 안 남긴다', ctx.history.turns().length === 턴수, `${턴수} → ${ctx.history.turns().length}`);

    // 같은 턴에 **먼저 성공한** 고치기의 기록은 버리면 안 된다.
    await TOOLS.Read.run({ file_path: '고친것.txt' }, ctx);
    await TOOLS.Edit.run({ file_path: '고친것.txt', old_string: '처음', new_string: '둘째' }, ctx);
    chmodSync(고친것, 0o444);
    const 둘째 = await 감싸기(() => TOOLS.Edit.run({ file_path: '고친것.txt', old_string: '둘째', new_string: '셋째' }, ctx));
    chmodSync(고친것, 0o666);
    check('같은 턴 두 번째 고치기가 깨졌다', !!둘째.error, String(둘째.error ?? 둘째.content));
    const u = ctx.history.undo(1);
    check('★★ 먼저 성공한 고치기는 그대로 되돌아간다', readFileSync(고친것, 'utf8') === '처음\n', `되돌린수=${u.되돌린수} ${JSON.stringify(readFileSync(고친것, 'utf8'))}`);
    ctx.history.undo(1);
    check('★★ 그 다음 /undo 는 앞 턴의 진짜 변경을 되돌린다', !existsSync(join(방, 'doc.txt')), `doc남음=${existsSync(join(방, 'doc.txt'))}`);
  } else {
    check('(이 PC 는 읽기 전용 파일에도 쓸 수 있어 쓰기 실패를 못 만든다 — 관리자 계정)', true);
  }
  chmodSync(잠김, 0o666);

  // Move — rename 이 EBUSY 로 깨지는 판은 파일 시스템으로 못 만든다. 갈아 끼운다.
  ctx.history.nextTurn();
  await TOOLS.Write.run({ file_path: 'doc2.txt', content: 'v1\n' }, ctx);
  ctx.history.nextTurn();
  writeFileSync(join(방, '옮길것.txt'), 'M');
  const 턴수 = ctx.history.turns().length;
  const 옛fs = ctx.옮기기fs;
  ctx.옮기기fs = { renameSync: () => { const err = new Error('EBUSY: resource busy or locked, rename'); err.code = 'EBUSY'; throw err; } };
  const m = await 감싸기(() => TOOLS.Move.run({ from: '옮길것.txt', to: '새자리/옮길것.txt' }, ctx));
  ctx.옮기기fs = 옛fs;
  check('옮기기가 EBUSY 로 깨지면 오류다', !!m.error && existsSync(join(방, '옮길것.txt')), String(m.error ?? m.content));
  check('★★ 깨진 옮기기는 이력에 턴을 안 남긴다', ctx.history.turns().length === 턴수, `${턴수} → ${ctx.history.turns().length}`);
  ctx.history.undo(1);
  check('★★ 그 뒤 /undo 는 앞 턴의 진짜 변경을 되돌린다', !existsSync(join(방, 'doc2.txt')), `doc2남음=${existsSync(join(방, 'doc2.txt'))}`);

  // Append 는 인코딩 거절보다 **먼저** 떴다 — 한 글자도 안 붙이고 거절해도 턴이 남았다.
  ctx.history.nextTurn();
  writeFileSync(join(방, '옛글.txt'), encode('사내 문서입니다. 결재 요청드립니다.\n', 'euc-kr').buf);
  const 턴수3 = ctx.history.turns().length;
  const 거절 = await 감싸기(() => TOOLS.Append.run({ file_path: '옛글.txt', content: '웃음 \u{1F600}\n' }, ctx));
  check('CP949 파일에 이모지를 붙이는 것은 거절한다', !!거절.error, String(거절.error ?? 거절.content).split('\n')[0]);
  check('★★ 인코딩으로 거절한 Append 는 이력에 턴을 안 남긴다', ctx.history.turns().length === 턴수3, `${턴수3} → ${ctx.history.turns().length}`);
  rmSync(방, { recursive: true, force: true });
}

/*
 * ── 대소문자만 다른 이름으로 **같은 파일**을 한 턴에 두 번 고친다 ─────────────
 *
 * 윈도우·맥에서 `note.txt` 와 `NOTE.txt` 는 한 파일이다. 스냅샷이 글자로만 견주어
 * 기록이 둘 생겼고(둘째는 첫 쓰기 뒤의 내용), /undo 는 턴 처음이 아니라 **중간
 * 상태**로 되돌려 놓고 「되돌렸습니다」 라고 했다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-undo-case-'));
  writeFileSync(join(방, 'probe.tmp'), '');
  const 안가림 = existsSync(join(방, 'PROBE.TMP'));
  rmSync(join(방, 'probe.tmp'), { force: true });
  if (안가림) {
    const ctx = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set(), enc: new Map() };
    writeFileSync(join(방, 'note.txt'), '처음\n');
    ctx.history.nextTurn();
    await TOOLS.Write.run({ file_path: 'note.txt', content: '둘째\n' }, ctx);
    await TOOLS.Read.run({ file_path: 'NOTE.txt' }, ctx);
    const e = await TOOLS.Edit.run({ file_path: 'NOTE.txt', old_string: '둘째', new_string: '셋째' }, ctx);
    check('대소문자만 다른 이름으로도 고쳐진다', !e.error && readFileSync(join(방, 'note.txt'), 'utf8') === '셋째\n', e.error ?? e.content);
    ctx.history.undo(1);
    check('★★ 대소문자만 다른 이름으로 두 번 고친 턴도 /undo 하면 턴 처음 내용이다', readFileSync(join(방, 'note.txt'), 'utf8') === '처음\n',
      JSON.stringify(readFileSync(join(방, 'note.txt'), 'utf8')));
  } else {
    check('(이 파일 시스템은 대소문자를 가려서 같은 파일이 두 이름을 갖지 않는다)', true);
  }
  rmSync(방, { recursive: true, force: true });
}

trace('밖을-가리키는-기록');

/*
 * ── 이력이 가리키는 곳을 그대로 믿었다 ─────────────────────────────────
 *
 * edits.jsonl 의 한 줄에는 절대 경로가 적힌다. 그 파일은 `.deel/history` 에 있고,
 * 저장소에 딸려 올 수도(누가 올렸거나 일부러 넣었거나), 폴더째 복사될 수도 있다.
 * /undo 는 적힌 경로를 그대로 써서 **작업 폴더 밖**의 파일을 덮고, 지우고, 폴더까지
 * 만들었다 — 그러고 「되돌렸습니다」 라고 했다. 안전망이 울타리 밖으로 손을 뻗는다.
 */
{
  const 바탕 = mkdtempSync(join(tmpdir(), 'deel-undo-밖-'));
  const 프로젝트 = join(바탕, '받은저장소');
  const 바깥 = join(바탕, '바깥');
  mkdirSync(join(프로젝트, '.deel', 'history'), { recursive: true });
  mkdirSync(바깥, { recursive: true });
  writeFileSync(join(바깥, 'victim.txt'), '원래', 'utf8');
  writeFileSync(join(바깥, 'delete-me.txt'), '남아야 함', 'utf8');
  writeFileSync(join(프로젝트, '안.txt'), '지금', 'utf8');
  const at = '2026-01-01T00:00:00.000Z';
  const 줄들 = [
    { turn: 1, at, path: join(바깥, 'victim.txt'), before: '덮였다', label: 'Edit' },
    { turn: 1, at, path: join(바깥, 'delete-me.txt'), before: null, label: 'Write' },
    { turn: 1, at, path: join(바깥, 'newdir', 'planted.txt'), before: 'planted', label: 'Write' },
    // 적힌 절대 경로는 안인데 상대 경로가 밖으로 나가는 줄 — 어느 칸으로도 못 나간다.
    { turn: 1, at, path: join(프로젝트, '안인척.txt'), rel: '../바깥/victim.txt', before: '상대로 덮였다', label: 'Edit' },
    // 옛 판이 적은 절대 경로라도 **이 폴더 안**이면 그대로 되돌린다.
    { turn: 1, at, path: join(프로젝트, '안.txt'), before: '처음', label: 'Edit' },
  ];
  writeFileSync(join(프로젝트, '.deel', 'history', 'edits.jsonl'), 줄들.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  const r = new History(프로젝트).undo(1);
  check('★★ 이력이 밖의 파일을 가리켜도 덮지 않는다', readFileSync(join(바깥, 'victim.txt'), 'utf8') === '원래',
    JSON.stringify(readFileSync(join(바깥, 'victim.txt'), 'utf8')));
  check('★★ 이력이 밖의 파일을 「없던 파일」 이라 해도 안 지운다', existsSync(join(바깥, 'delete-me.txt')), '');
  check('★★ 밖에 파일·폴더를 만들지 않는다', !existsSync(join(바깥, 'newdir')), '');
  check('★ 옛 판의 절대 경로라도 이 폴더 안이면 되돌린다', readFileSync(join(프로젝트, '안.txt'), 'utf8') === '처음',
    JSON.stringify(readFileSync(join(프로젝트, '안.txt'), 'utf8')));
  const 밖것 = r.restored.filter((x) => x.바깥);
  check('★ 건드리지 않은 것을 그렇다고 말한다 (되돌린 척하지 않는다)',
    밖것.length === 4 && 밖것.every((x) => x.skipped && x.ok !== true && /작업 폴더 밖/.test(x.how)) && r.되돌린수 === 1,
    JSON.stringify(r.restored.map((x) => ({ how: x.how, ok: x.ok }))));
  rmSync(바탕, { recursive: true, force: true });
}

/*
 * ── 여기부터 자리표가 없었다 (17회차) ──────────────────────────────────
 *
 * 깃허브 윈도우 러너에서 이 파일이 종료코드 3221226505(0xC0000409 — 윈도우
 * abort())로 죽는다. 그런데 마지막 자리표가 「밖을-가리키는-기록」 이라, 죽은
 * 곳이 그 구간인지 **그 뒤 두 구간 중 하나**인지 가릴 수가 없었다. 자리표는
 * 이럴 때 쓰라고 있는 것이다. 붙여 둔다.
 */
trace('복사한-폴더에서-되돌리기');

{
  // 폴더째 복사한 저장소. 복사본에서 /undo 하면 **원본**을 되돌리고 있었다.
  //
  // fs.cpSync 로 베끼다가 이 검사 파일이 윈도우 + Node 22 에서 아무 말 없이
  // 0xC0000409 로 죽었다 — 임시 폴더 이름에 한글('복사')이 들어 있어서다.
  // 제품 쪽도 같은 자리에서 죽고 있었다(src/tools/index.js 의 안전복사).
  const { copyDir } = await import('../src/tools/fsutil.js');
  const 바탕 = mkdtempSync(join(tmpdir(), 'deel-undo-복사-'));
  const A = join(바탕, 'A');
  const B = join(바탕, 'B');
  mkdirSync(join(A, 'src'), { recursive: true });
  writeFileSync(join(A, 'src', 'app.js'), 'v1', 'utf8');
  const h = new History(A);
  h.nextTurn();
  h.snapshot(join(A, 'src', 'app.js'), 'Edit');
  writeFileSync(join(A, 'src', 'app.js'), 'v2', 'utf8');
  const 적힌것 = JSON.parse(readFileSync(h.file, 'utf8').trim().split('\n')[0]);
  check('★ 새 기록은 작업 폴더 기준 상대 경로를 적는다', 적힌것.rel === 'src/app.js', JSON.stringify(적힌것.rel));

  copyDir(A, B);
  writeFileSync(join(A, 'src', 'app.js'), 'v3 — 원본에서 새로 한 일', 'utf8');
  const hB = new History(B);
  check('  읽을 때는 지금 폴더의 절대 경로로 준다 (/diff 가 그 경로로 찾는다)', hB.all()[0]?.path === join(B, 'src', 'app.js'),
    String(hB.all()[0]?.path));
  const r = hB.undo(1);
  check('★★ 복사한 폴더에서 /undo 하면 그 폴더를 되돌린다', readFileSync(join(B, 'src', 'app.js'), 'utf8') === 'v1',
    JSON.stringify(readFileSync(join(B, 'src', 'app.js'), 'utf8')));
  check('★★ 원래 폴더는 안 건드린다', readFileSync(join(A, 'src', 'app.js'), 'utf8').startsWith('v3'),
    JSON.stringify(readFileSync(join(A, 'src', 'app.js'), 'utf8')));
  check('  되돌린 자리를 지금 폴더로 적는다', r.restored[0]?.path === join(B, 'src', 'app.js'), String(r.restored[0]?.path));
  rmSync(바탕, { recursive: true, force: true });
}

trace('고리-너머는-밖이다');

{
  /*
   * 글자로는 안인데 **고리(정션·심볼릭 링크)를 따라가면 밖**인 자리. 저장소는 링크를
   * 실어 나를 수 있다. 고리는 임시 「바깥」 폴더를 가리키고, 치울 때는 고리만 뗀다.
   */
  const { symlinkSync, unlinkSync, rmdirSync, lstatSync } = await import('node:fs');
  const 바탕 = mkdtempSync(join(tmpdir(), 'deel-undo-고리-'));
  const 프로젝트 = join(바탕, '저장소');
  const 바깥 = join(바탕, '바깥');
  mkdirSync(join(프로젝트, '.deel', 'history'), { recursive: true });
  mkdirSync(바깥, { recursive: true });
  writeFileSync(join(바깥, 'secret.txt'), '원래', 'utf8');
  const 고리 = join(프로젝트, '고리');
  let 고리됨 = false;
  try { symlinkSync(바깥, 고리, 'junction'); 고리됨 = true; } catch (err) { check('  (고리를 못 만들어 건너뜀)', true, String(err?.code)); }
  if (고리됨) {
    try {
      const at = '2026-01-01T00:00:00.000Z';
      writeFileSync(join(프로젝트, '.deel', 'history', 'edits.jsonl'), [
        { turn: 1, at, path: join(고리, 'secret.txt'), rel: '고리/secret.txt', before: '덮였다', label: 'Edit' },
        { turn: 1, at, path: join(고리, 'sub', 'planted.txt'), rel: '고리/sub/planted.txt', before: 'planted', label: 'Write' },
      ].map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8');
      const r = new History(프로젝트).undo(1);
      check('★★ 고리를 따라가면 밖인 파일은 안 덮는다', readFileSync(join(바깥, 'secret.txt'), 'utf8') === '원래',
        JSON.stringify(r.restored.map((x) => x.how)));
      check('★★ 고리 너머에 폴더·파일을 안 만든다', !existsSync(join(바깥, 'sub')), '');
    } finally {
      try { unlinkSync(고리); } catch { try { rmdirSync(고리); } catch { /* 아래에서 확인한다 */ } }
    }
  }
  let 고리남음 = false;
  try { lstatSync(고리); 고리남음 = true; } catch { /* 떼어졌다 */ }
  check('  고리만 떼고 가리키던 폴더는 그대로다', !고리남음 && existsSync(join(바깥, 'secret.txt')), '');
  if (!고리남음) rmSync(바탕, { recursive: true, force: true });
}

trace('반쪽줄');

{
  /*
   * ── 반쪽 줄 뒤에 이어 적으면 /undo 가 **앞 판**을 되돌렸다 ─────────────
   *
   * 적다가 죽으면 마지막 줄이 개행 없이 남는다. 다음 판의 첫 기록이 그 뒤에 붙어
   * 한 줄이 되고, 그 줄은 못 읽는 줄이 된다. 그러면 이번 판의 턴이 이력에 없어서
   * /undo 한 번이 **앞 판의 턴**을 되돌리고 「되돌렸습니다」 라고 했다.
   */
  const 방 = mkdtempSync(join(tmpdir(), 'deel-undo-반쪽-'));
  const f1 = join(방, 'one.txt');
  const f2 = join(방, 'two.txt');
  writeFileSync(f1, 'ONE-V1', 'utf8');
  const h1 = new History(방);
  h1.nextTurn(); h1.snapshot(f1, 'Edit'); writeFileSync(f1, 'ONE-V2', 'utf8');
  appendFileSync(h1.file, JSON.stringify({ turn: h1.turn, at: 'x', path: join(방, 'zzz.txt'), before: 'aaaaaaaaaaaaaaaaaaaa' }).slice(0, 45), 'utf8');
  await new Promise((끝) => setTimeout(끝, 20));
  writeFileSync(f2, 'TWO-V1', 'utf8');
  const h2 = new History(방);                  // 다음 판
  h2.nextTurn(); h2.snapshot(f2, 'Edit'); writeFileSync(f2, 'TWO-V2', 'utf8');
  const r = h2.undo(1);
  check('★★ 반쪽 줄 뒤에 적은 이번 판의 턴을 되돌린다', readFileSync(f2, 'utf8') === 'TWO-V1', JSON.stringify(readFileSync(f2, 'utf8')));
  check('★★ 시키지 않은 앞 판의 턴은 안 건드린다', readFileSync(f1, 'utf8') === 'ONE-V2', JSON.stringify(readFileSync(f1, 'utf8')));
  check('  반쪽 줄은 못 읽은 줄로 센다', r.깨진줄 === 1, String(r.깨진줄));
  rmSync(방, { recursive: true, force: true });
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n되돌리기 검사  ${D}(안전망이 파일을 지우지 않는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
