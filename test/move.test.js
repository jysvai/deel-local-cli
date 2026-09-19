// 파일 옮기기 (Move 도구).
//
// ── 왜 이게 있어야 하나 ─────────────────────────────────────────────────
//
// 「파일 구조 트리 변경해 줘」 를 시키면 계속 헛돌았다. 모델이 말을 안 들은
// 것이 아니라 **시키는 일에 맞는 도구가 없었다.** 도구 목록에 옮기는 것이
// 없으니 남는 길은 `Bash mv` 하나뿐이었는데,
//
//   · mv 는 위험 명령으로 잡혀 있어 승인 방식에 따라 **파일마다** 묻는다.
//     스무 개를 옮기면 스무 번이다.
//   · Bash 로 옮긴 것은 되돌리기에 **안 잡힌다.** /undo 를 눌러도 구조가
//     안 돌아온다.
//
// ── 여기서 무엇을 지키나 ────────────────────────────────────────────────
//
//   1. 옮긴 뒤 **/undo 로 정말 되돌아가는가.** 이게 이 파일의 핵심이다.
//      옮기기는 '지우기 + 만들기' 라, 한쪽만 떠 놓으면 되돌린 뒤 파일이
//      두 군데 있거나 한 군데도 없다. 안전망이 파일을 잃는 자리다.
//   2. 겹치는 자리에 **조용히 덮어쓰지 않는가.** 구조를 바꾸는 일은 이름이
//      겹치기 쉽다. 조용히 덮으면 그 파일은 그 자리에서 없어진다.
//   3. 폴더를 **제 안으로** 옮기려 할 때 막는가 (`mv a a/b` — 통째로 사라진다).
//   4. 작업 폴더 밖으로 못 나가는가.
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS, 복사해옮기기 } from '../src/tools/index.js';
import { allow, MODES, canWrite } from '../src/agent/modes.js';
import { History } from '../src/safety/undo.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 뿌리 = dirname(dirname(fileURLToPath(import.meta.url)));

/*
 * 진짜 폴더에서 진짜로 옮긴다. 흉내로는 이 검사가 뜻이 없다 — 잡으려는 결함이
 * "디스크에 무엇이 남았나" 라서, 파일 시스템을 흉내 내면 그 결함이 통과한다.
 */
function 판깔기() {
  const root = mkdtempSync(join(tmpdir(), 'deel-move-'));
  const ctx = {
    scope: {
      resolve: (p) => {
        const abs = join(root, p);
        // 실제 Scope 와 같은 규칙 — 뿌리 밖은 거절한다.
        if (!abs.startsWith(root)) throw new Error(`작업 범위 밖입니다: ${p}`);
        return abs;
      },
      show: (abs) => abs.slice(root.length + 1).replace(/\\/g, '/'),
    },
    history: new History(root),
    seen: new Set(),
  };
  ctx.history.nextTurn();
  return { root, ctx };
}

trace('1-도구가-있나');

{
  check('Move 도구가 있다', !!TOOLS.Move);
  check('moves 배열을 받는다', !!TOOLS.Move?.schema?.parameters?.properties?.moves);
  check('overwrite 를 받는다', !!TOOLS.Move?.schema?.parameters?.properties?.overwrite);

  /*
   * 파일을 바꾸는 도구다. 읽기만 하는 모드(설계·계획·묻기)에 들어가면
   * "파일을 안 바꾼다" 는 약속이 깨진다.
   */
  const 있는것 = Object.keys(TOOLS);
  const 샌모드 = Object.keys(MODES).filter((id) => !canWrite(id) && allow(id, 있는것).includes('Move'));
  check('읽기 전용 모드에는 안 준다', 샌모드.length === 0, 샌모드.join(', '));
  const 없는모드 = Object.keys(MODES).filter((id) => canWrite(id) && !allow(id, 있는것).includes('Move'));
  check('쓰는 모드에는 다 준다', 없는모드.length === 0, 없는모드.join(', '));
}

trace('2-한-개-옮기기');

{
  const { root, ctx } = 판깔기();
  writeFileSync(join(root, 'a.js'), 'const x = 1;\n', 'utf8');

  const r = await TOOLS.Move.run({ from: 'a.js', to: 'src/core/a.js' }, ctx);
  check('옮겨졌다', !r.error && existsSync(join(root, 'src', 'core', 'a.js')), r.error ?? '');
  check('떠난 자리는 비었다', !existsSync(join(root, 'a.js')));
  check('내용은 그대로다', readFileSync(join(root, 'src', 'core', 'a.js'), 'utf8') === 'const x = 1;\n');
  // 없는 폴더를 만들어 주지 않으면 구조 바꾸기가 두 걸음이 된다.
  check('없던 폴더를 만들어 준다', existsSync(join(root, 'src', 'core')));
  check('결과를 content 로 돌려준다', typeof r.content === 'string' && r.content.includes('옮김'), r.content);

  rmSync(root, { recursive: true, force: true });
}

trace('3-되돌리기');

/*
 * ── 여기가 제일 중요하다 ────────────────────────────────────────────────
 *
 * 되돌리기는 **내용을 떠 놓는** 방식이라(safety/undo.js), 옮기기를 얹으려면
 * 떠난 자리와 닿을 자리를 둘 다 떠야 한다. 하나만 뜨면:
 *
 *   떠난 자리만 뜸 → 되돌린 뒤 파일이 **두 군데** 있다
 *   닿을 자리만 뜸 → 되돌린 뒤 **한 군데도** 없다 (파일을 잃는다)
 */
{
  const { root, ctx } = 판깔기();
  writeFileSync(join(root, 'a.js'), 'const x = 1;\n', 'utf8');
  await TOOLS.Move.run({ from: 'a.js', to: 'src/a.js' }, ctx);

  ctx.history.undo(1);
  check('되돌리면 원래 자리로 온다', existsSync(join(root, 'a.js')));
  check('되돌리면 옮겨 간 자리는 지워진다', !existsSync(join(root, 'src', 'a.js')));
  check('되돌린 내용이 맞다',
    existsSync(join(root, 'a.js')) && readFileSync(join(root, 'a.js'), 'utf8') === 'const x = 1;\n');

  rmSync(root, { recursive: true, force: true });
}

trace('4-폴더째-옮기기');

{
  const { root, ctx } = 판깔기();
  mkdirSync(join(root, 'ui'), { recursive: true });
  writeFileSync(join(root, 'ui', 'a.js'), 'a\n', 'utf8');
  writeFileSync(join(root, 'ui', 'b.js'), 'b\n', 'utf8');

  const r = await TOOLS.Move.run({ from: 'ui', to: 'src/view' }, ctx);
  check('폴더가 통째로 옮겨졌다', !r.error && existsSync(join(root, 'src', 'view', 'a.js')), r.error ?? '');
  check('안의 것이 다 따라왔다', existsSync(join(root, 'src', 'view', 'b.js')));
  check('떠난 폴더는 없다', !existsSync(join(root, 'ui')));

  ctx.history.undo(1);
  check('폴더도 되돌아온다', existsSync(join(root, 'ui', 'a.js')) && existsSync(join(root, 'ui', 'b.js')));
  check('옮겨 갔던 자리는 비었다', !existsSync(join(root, 'src', 'view', 'a.js')));

  rmSync(root, { recursive: true, force: true });
}

trace('5-겹칠때');

/*
 * 조용히 덮어쓰면 그 파일 내용이 그 자리에서 없어진다. 구조를 바꾸는 일은
 * 파일을 스무 개씩 옮기는 일이라 이름이 겹치는 것이 드물지 않다.
 */
{
  const { root, ctx } = 판깔기();
  writeFileSync(join(root, 'a.js'), '새것\n', 'utf8');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.js'), '원래것\n', 'utf8');

  const r = await TOOLS.Move.run({ from: 'a.js', to: 'src/a.js' }, ctx);
  check('겹치면 거절한다', !!r.error, r.error ?? '(그냥 덮어썼다)');
  check('거절했으면 원래 것이 살아 있다', readFileSync(join(root, 'src', 'a.js'), 'utf8') === '원래것\n');
  check('어떻게 하라고 알려 준다', /overwrite/.test(r.error ?? ''));

  const r2 = await TOOLS.Move.run({ from: 'a.js', to: 'src/a.js', overwrite: true }, ctx);
  check('overwrite 를 주면 덮어쓴다', !r2.error && readFileSync(join(root, 'src', 'a.js'), 'utf8') === '새것\n',
    r2.error ?? '');

  ctx.history.undo(1);
  check('덮어쓴 것도 되돌아온다', readFileSync(join(root, 'src', 'a.js'), 'utf8') === '원래것\n',
    readFileSync(join(root, 'src', 'a.js'), 'utf8'));

  rmSync(root, { recursive: true, force: true });
}

trace('6-막아야-하는-것');

{
  const { root, ctx } = 판깔기();
  writeFileSync(join(root, 'a.js'), 'x\n', 'utf8');
  mkdirSync(join(root, 'ui'), { recursive: true });
  writeFileSync(join(root, 'ui', 'a.js'), 'x\n', 'utf8');

  // 폴더를 제 안으로 — 셸에서도 잘 나는 사고다. 그대로 두면 폴더가 사라진다.
  const 안으로 = await TOOLS.Move.run({ from: 'ui', to: 'ui/inner' }, ctx);
  check('폴더를 제 안으로는 못 옮긴다', !!안으로.error, 안으로.error ?? '(옮겨졌다)');
  check('막았으면 폴더가 그대로 있다', existsSync(join(root, 'ui', 'a.js')));

  const 밖 = await (async () => {
    try { return await TOOLS.Move.run({ from: 'a.js', to: '../밖.js' }, ctx); } catch (e) { return { error: e.message }; }
  })();
  check('작업 폴더 밖으로 못 나간다', !!밖.error, 밖.error ?? '(나갔다)');

  const 없는것 = await TOOLS.Move.run({ from: '없는파일.js', to: 'b.js' }, ctx);
  check('없는 파일은 또렷하게 거절한다', /없는 파일/.test(없는것.error ?? ''), 없는것.error ?? '');

  const 같은자리 = await TOOLS.Move.run({ from: 'a.js', to: 'a.js' }, ctx);
  check('같은 자리로 옮기라면 거절한다', !!같은자리.error, 같은자리.error ?? '');

  rmSync(root, { recursive: true, force: true });
}

trace('7-한꺼번에-여러-개');

/*
 * 구조를 바꾸는 일은 늘 여러 개다. 한 개씩 부르게 두면 파일 수만큼 모델을
 * 다시 불러야 해서, 스무 개짜리 정리에 몇 분이 그냥 간다.
 */
{
  const { root, ctx } = 판깔기();
  for (const n of ['a.js', 'b.js', 'c.js']) writeFileSync(join(root, n), `${n}\n`, 'utf8');

  const r = await TOOLS.Move.run({ moves: [
    { from: 'a.js', to: 'src/a.js' },
    { from: 'b.js', to: 'src/b.js' },
    { from: 'c.js', to: 'test/c.js' },
  ] }, ctx);

  check('셋 다 옮겨졌다',
    !r.error && ['src/a.js', 'src/b.js', 'test/c.js'].every((p) => existsSync(join(root, ...p.split('/')))),
    r.error ?? '');
  check('몇 개 옮겼는지 알려 준다', /3개/.test(r.content ?? ''), r.content?.split('\n')[0] ?? '');

  /*
   * ★ 무엇이 움직였는지 **불러 준 쪽에 돌려줘야** 한다.
   *
   * 여기서 한 개짜리 결과의 changed 를 버리고 있었다. 그래서 스물두 개를
   * 옮기면 화면에는 `22개 옮김` 이 뜨는데 턴이 아는 「손댄 파일」 은 0개였다.
   * 그 값은 턴 끝의 파일 목록도, /commit 도, 헛도는지 재는 자리도 같이 본다.
   * 실제로 그 때문에 파일이 움직이는 중인 턴이 「헛돌고 있어 멈췄습니다」 로
   * 죽었다.
   *
   * 한 개씩 옮길 때는 멀쩡했다 — 배열로 부를 때만 새던 자리다.
   */
  check('★ 무엇이 움직였는지 돌려준다', (r.바뀐것들 ?? []).length === 3,
    `${(r.바뀐것들 ?? []).length}개 (옮긴 것은 3개)`);
  check('★ 옮겨 간 자리를 적는다',
    (r.바뀐것들 ?? []).every((p) => existsSync(p))
    && (r.바뀐것들 ?? []).some((p) => p.replace(/\\/g, '/').endsWith('src/a.js')),
    (r.바뀐것들 ?? []).map((p) => p.replace(/\\/g, '/').split('/').slice(-2).join('/')).join(' · '));

  ctx.history.undo(1);
  check('여러 개도 한 번에 되돌아온다',
    ['a.js', 'b.js', 'c.js'].every((p) => existsSync(join(root, p)))
    && !existsSync(join(root, 'src', 'a.js')));

  rmSync(root, { recursive: true, force: true });
}

trace('8-하나가-막혀도');

/*
 * 절반만 옮겨진 상태를 **모르고 지나가는 것**이 제일 나쁘다. 막힌 것이 있으면
 * 결과 안에 다 적어서, 모델이 '됐다' 고 넘어가지 못하게 한다.
 */
{
  const { root, ctx } = 판깔기();
  writeFileSync(join(root, 'a.js'), 'a\n', 'utf8');
  writeFileSync(join(root, 'c.js'), 'c\n', 'utf8');

  const r = await TOOLS.Move.run({ moves: [
    { from: 'a.js', to: 'src/a.js' },
    { from: '없는것.js', to: 'src/b.js' },
    { from: 'c.js', to: 'src/c.js' },
  ] }, ctx);

  check('막힌 것이 있어도 나머지는 옮긴다',
    existsSync(join(root, 'src', 'a.js')) && existsSync(join(root, 'src', 'c.js')), r.error ?? '');
  check('막힌 것을 감추지 않는다', /실패|✗/.test(r.content ?? ''), r.content ?? '');
  check('막힌 것의 이름이 나온다', /없는것\.js/.test(r.content ?? ''), r.content ?? '');

  const 다막힘 = await TOOLS.Move.run({ moves: [{ from: '없1.js', to: 'x.js' }, { from: '없2.js', to: 'y.js' }] }, ctx);
  // 하나도 못 옮겼으면 오류여야 한다 — 아니면 모델이 됐다고 넘어간다.
  check('하나도 못 옮기면 오류다', !!다막힘.error, JSON.stringify(다막힘).slice(0, 80));

  rmSync(root, { recursive: true, force: true });
}

trace('9-드라이브가다를때');

/*
 * ── ★ 「복사는 됐는데 원본이 안 지워진 것」 은 실패가 아니다 ─────────────
 *
 * C: → D: 처럼 드라이브가 다르면 rename 이 EXDEV 로 깨진다. 그때만 복사한 뒤
 * 원본을 지우는데, 그 둘이 한 try 에 묶여 있었다. 묶여 있으면 **원본만 못
 * 지운** 경우까지 「못 옮겼습니다」가 된다 — 윈도우에서 원본 폴더의 파일
 * 하나를 편집기가 잡고 있으면 바로 그 모양이다.
 *
 * 그 거짓말이 비싼 까닭: 사람은 실패로 알고 다시 옮긴다. 그런데 닿은 자리에는
 * 이미 다 있다. 원본은 계속 남아 있고, 아무도 두 벌이 된 걸 모른다.
 *
 * 진짜 EXDEV 와 진짜 '지우기만 깨짐' 은 검사 PC 마다 다르게 나므로,
 * fs 를 밖에서 넣어 세 갈래를 각각 만든다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-exdev-'));
  const 앞 = join(방, '앞'); const 뒤 = join(방, '뒤');
  mkdirSync(앞, { recursive: true });
  writeFileSync(join(앞, 'a.txt'), '내용', 'utf8');

  const 다됨 = 복사해옮기기(앞, 뒤, {
    복사: (a, b) => { mkdirSync(b, { recursive: true }); writeFileSync(join(b, 'a.txt'), '내용', 'utf8'); },
    지우기: (a) => rmSync(a, { recursive: true, force: true }),
  });
  check('★ 복사도 되고 원본도 지워지면 할 말이 없다',
    !다됨.복사깨짐 && !다됨.원본남음, JSON.stringify(다됨));
  check('★ 그때는 원본이 진짜로 없다', !existsSync(앞));

  const 복사깨짐 = 복사해옮기기(앞, 뒤, {
    복사: () => { const e = new Error('EACCES: permission denied'); throw e; },
    지우기: () => { throw new Error('여기까지 오면 안 된다'); },
  });
  check('★ 복사가 깨지면 실패다', 복사깨짐.복사깨짐 === 'EACCES: permission denied', JSON.stringify(복사깨짐));
  check('★ 복사가 깨졌으면 원본은 안 건드린다', 복사깨짐.원본남음 === undefined,
    '지우기가 불렸으면 위에서 던졌다');

  const 원본남음 = 복사해옮기기(앞, 뒤, {
    복사: () => {},
    지우기: () => { throw new Error('EBUSY: resource busy or locked'); },
  });
  check('★ 원본만 못 지운 것은 실패로 안 친다', 원본남음.복사깨짐 === undefined, JSON.stringify(원본남음));
  check('★ 그래도 원본이 남았다고는 말한다', 원본남음.원본남음 === 'EBUSY: resource busy or locked',
    JSON.stringify(원본남음));

  rmSync(방, { recursive: true, force: true });
}

trace('9-2-못-옮긴-것은-흔적이-없다');

/*
 * ── ★ 못 옮겼으면 되돌리기 이력에도 **아무것도 안 남아야** 한다 ────────────
 *
 * 스냅샷을 먼저 뜨고 옮기다 실패하는 길이 있었다(길 중간이 파일 · 폴더를 있는
 * 폴더 자리에 덮어쓰기 · 대소문자만 다른 제 안). 파일은 한 글자도 안 움직였는데
 * 그 턴이 이력에 남는다. 그러면 /undo 는 **그 헛턴을 되돌리고** 「되돌린수=1」
 * 을 찍는다 — 사람이 되돌리려던 앞 턴의 진짜 변경은 그대로 남는다.
 * 한파일쓰기 머리말이 Write·Edit 에서 이미 막아 둔 그 꼴이다.
 */
const 감싸서 = async (일) => { try { return await 일(); } catch (e) { return { error: `(던짐) ${e.message}` }; } };
{
  const { root, ctx } = 판깔기();
  await TOOLS.Write.run({ file_path: 'doc.txt', content: 'v1\n' }, ctx);   // 앞 턴 — 진짜 변경
  ctx.history.nextTurn();
  writeFileSync(join(root, 'a.txt'), 'A', 'utf8');
  writeFileSync(join(root, 'f.txt'), 'F', 'utf8');
  const 턴수 = ctx.history.turns().length;
  const 막힘 = await 감싸서(() => TOOLS.Move.run({ from: 'a.txt', to: 'f.txt/b.txt' }, ctx));
  check('길 중간이 파일이면 못 옮긴다', !!막힘.error && existsSync(join(root, 'a.txt')), 막힘.error ?? '(옮겨졌다)');
  check('★ 그 말이 날 오류로 튀어나가지 않는다', !/^\(던짐\)/.test(막힘.error ?? ''), 막힘.error ?? '');
  check('★★ 못 옮긴 것은 되돌리기 이력에 턴을 안 남긴다', ctx.history.turns().length === 턴수, `${턴수} → ${ctx.history.turns().length}`);
  const u = ctx.history.undo(1);
  check('★★ 그 뒤 /undo 한 번은 앞 턴의 진짜 변경을 되돌린다', !existsSync(join(root, 'doc.txt')),
    `되돌린수=${u.되돌린수} doc남음=${existsSync(join(root, 'doc.txt'))}`);
  rmSync(root, { recursive: true, force: true });
}
{
  const { root, ctx } = 판깔기();
  mkdirSync(join(root, 'a')); writeFileSync(join(root, 'a', 'x.txt'), 'X');
  mkdirSync(join(root, 'b')); writeFileSync(join(root, 'b', 'y.txt'), 'Y');
  writeFileSync(join(root, 'f.txt'), 'F');
  const 폴더위 = await 감싸서(() => TOOLS.Move.run({ from: 'a', to: 'b', overwrite: true }, ctx));
  check('★ 폴더를 있는 폴더 자리에 덮어쓰려 하면 사람 말로 거절한다',
    !!폴더위.error && !/EPERM|ENOTEMPTY|EISDIR|ENOTDIR|던짐/.test(폴더위.error) && existsSync(join(root, 'b', 'y.txt')) && existsSync(join(root, 'a', 'x.txt')),
    폴더위.error ?? '(옮겨졌다)');
  const 파일을폴더위 = await 감싸서(() => TOOLS.Move.run({ from: 'f.txt', to: 'b', overwrite: true }, ctx));
  check('★ 파일을 폴더 자리에 덮어쓰려 해도 사람 말로 거절한다',
    !!파일을폴더위.error && !/EPERM|EISDIR|던짐/.test(파일을폴더위.error) && existsSync(join(root, 'b', 'y.txt')), 파일을폴더위.error ?? '(옮겨졌다)');
  check('★★ 그 둘도 이력에 턴을 안 남긴다', ctx.history.turns().length === 0, `turns=${ctx.history.turns().length}`);

  /*
   * ── 첫 안내가 **안 되는 길**을 알려 주면 안 된다 ──────────────────────
   *
   * overwrite 없이 있는 폴더 위로 옮기면 「덮어쓰려면 overwrite: true 를
   * 주세요」 가 나왔다. 그대로 하면 바로 위 검사가 재는 「이미 있는 폴더라
   * 덮어쓸 수 없습니다」 로 막힌다 — 같은 도구가 시킨 대로 했는데 거절이다.
   *
   * 모델은 그 한 걸음을 반드시 밟는다(그러라고 적혀 있으니). 걸음 하나를
   * 통째로 버리고, 작은 모델은 거기서 같은 자리를 맴돈다. 첫 안내부터
   * 되는 길을 적어야 한다 — 그 안으로 넣으려면 to 에 이름까지 적는 것.
   */
  const 폴더위덮기없이 = await 감싸서(() => TOOLS.Move.run({ from: 'a', to: 'b' }, ctx));
  check('★ 있는 폴더 위로 옮기면 처음부터 안 된다고 한다',
    !!폴더위덮기없이.error && /덮어쓸 수 없습니다/.test(폴더위덮기없이.error), 폴더위덮기없이.error ?? '(옮겨졌다)');
  check('★ 안 되는 길(overwrite: true)을 시키지 않는다',
    !/overwrite/.test(폴더위덮기없이.error ?? ''), 폴더위덮기없이.error ?? '');
  check('  대신 되는 길을 알려 준다', /이름까지 적어/.test(폴더위덮기없이.error ?? ''), 폴더위덮기없이.error ?? '');

  const 파일을폴더위덮기없이 = await 감싸서(() => TOOLS.Move.run({ from: 'f.txt', to: 'b' }, ctx));
  check('  파일 → 있는 폴더도 같다', !!파일을폴더위덮기없이.error && !/overwrite/.test(파일을폴더위덮기없이.error),
    파일을폴더위덮기없이.error ?? '(옮겨졌다)');

  /*
   * 짝: **파일** 위로 덮어쓰는 것은 진짜로 되는 길이다. 여기까지 막으면
   * 안내를 없앤 것이 아니라 기능을 없앤 것이 된다.
   */
  writeFileSync(join(root, 'g.txt'), 'G');
  const 파일위 = await 감싸서(() => TOOLS.Move.run({ from: 'f.txt', to: 'g.txt' }, ctx));
  check('  짝: 파일 위에는 overwrite 를 알려 준다', /overwrite/.test(파일위.error ?? ''), 파일위.error ?? '(덮어썼다)');

  rmSync(root, { recursive: true, force: true });
}

trace('9-3-링크');

/*
 * ── ★★ 링크를 옮기고 /undo 하면 **링크 너머의 진짜 파일**이 지워졌다 ─────
 *
 * 폴더 링크(윈도우 정션 · 심볼릭 링크)는 walk 가 그 안을 따라 들어가 파일을
 * 짝지어 뜬다. 옮기는 것은 링크 하나인데, 되돌릴 때는 「새 자리의 x.txt 는
 * 원래 없던 것」 이라며 지운다 — 새 자리는 여전히 진짜 폴더를 가리키고 있으니
 * **진짜 파일이 지워진다.** 안전망이 파일을 지우는 꼴이다.
 */
{
  const { root, ctx } = 판깔기();
  mkdirSync(join(root, 'real')); writeFileSync(join(root, 'real', 'x.txt'), 'REAL');
  let 링크됨 = true;
  try { symlinkSync(join(root, 'real'), join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); } catch { 링크됨 = false; }
  if (링크됨) {
    const r = await 감싸서(() => TOOLS.Move.run({ from: 'link', to: 'link2' }, ctx));
    if (!r.error) ctx.history.undo(1);
    check('★★ 링크를 옮기고 되돌려도 링크가 가리키던 진짜 파일은 남는다', existsSync(join(root, 'real', 'x.txt')),
      `${r.error ?? r.content} · real=${readdirSync(join(root, 'real')).join(',')}`);
    check('★ 링크 자체는 옮기지 않는다고 까닭과 함께 말한다', !!r.error && /링크/.test(r.error) && !/던짐/.test(r.error), r.error ?? r.content);
    check('거절했으면 이력도 안 남긴다', ctx.history.turns().length === 0, `turns=${ctx.history.turns().length}`);
  }
  rmSync(root, { recursive: true, force: true });
}

trace('9-4-대소문자');

/*
 * ── 대소문자만 다른 이름 (윈도우·맥) ──────────────────────────────────────
 *
 * 이 파일 시스템들은 `a.txt` 와 `A.txt` 를 같은 파일로 친다. 그래서
 *
 *   Move a.txt → A.txt      「이미 있습니다: A.txt」   (자기 자신과 겹친다고 했다)
 *   Move src → SRC/inner    「EINVAL: invalid argument」 (제 안이라는 것을 못 알아봤다)
 *
 * 둘째는 이력에 헛턴까지 남겼다. 대소문자를 가리는 판(리눅스)에서는 둘 다
 * 서로 다른 이름이라 이 갈래가 없다 — 그래서 가리는지 먼저 재고 돈다.
 */
{
  const { root, ctx } = 판깔기();
  writeFileSync(join(root, 'probe.tmp'), '');
  const 안가림 = existsSync(join(root, 'PROBE.TMP'));
  rmSync(join(root, 'probe.tmp'), { force: true });
  if (안가림) {
    const 이름들 = () => readdirSync(root).filter((x) => x !== '.deel');
    writeFileSync(join(root, 'a.txt'), 'A');
    const r = await 감싸서(() => TOOLS.Move.run({ from: 'a.txt', to: 'A.txt' }, ctx));
    check('★ 대소문자만 바꾸는 이름 바꾸기가 된다', !r.error && 이름들().includes('A.txt') && !이름들().includes('a.txt'),
      `${r.error ?? r.content} → ${이름들().join(',')}`);
    check('이름만 바뀌고 내용은 그대로다', existsSync(join(root, 'A.txt')) && readFileSync(join(root, 'A.txt'), 'utf8') === 'A');
    ctx.history.undo(1);
    check('★ /undo 하면 이름도 되돌아온다', 이름들().includes('a.txt') && !이름들().includes('A.txt')
      && readFileSync(join(root, 'a.txt'), 'utf8') === 'A', 이름들().join(','));

    // 같은 턴에 먼저 고친 파일 — 되돌리면 이름은 몰라도 **내용은** 잃으면 안 된다.
    ctx.history.nextTurn();
    writeFileSync(join(root, 'b.txt'), 'B0');
    ctx.history.nextTurn();
    await TOOLS.Write.run({ file_path: 'b.txt', content: 'B1' }, ctx);
    const r2 = await 감싸서(() => TOOLS.Move.run({ from: 'b.txt', to: 'B.txt' }, ctx));
    ctx.history.undo(1);
    const 남은b = 이름들().find((x) => x.toLowerCase() === 'b.txt');
    check('★★ 같은 턴에 고친 파일의 이름을 바꾸고 되돌려도 내용을 잃지 않는다',
      !!남은b && readFileSync(join(root, 남은b), 'utf8') === 'B0', `${r2.error ?? r2.content} → ${남은b ?? '(없어짐)'}`);
    check('★★ 같은 턴에 고친 파일이어도 /undo 가 이름의 대소문자까지 되돌린다', 남은b === 'b.txt', `${r2.content ?? r2.error} → ${남은b}`);

    // 같은 턴에 새로 만든 파일의 이름만 바꾸고 되돌리면 — 원래 없던 파일이니 없어져야 한다.
    ctx.history.nextTurn();
    await TOOLS.Write.run({ file_path: 'c.txt', content: 'C' }, ctx);
    await 감싸서(() => TOOLS.Move.run({ from: 'c.txt', to: 'C.txt' }, ctx));
    ctx.history.undo(1);
    check('★ 같은 턴에 만든 파일은 이름을 바꿨어도 /undo 뒤에 없다', !이름들().some((x) => x.toLowerCase() === 'c.txt'), 이름들().join(','));

    // 폴더의 대소문자만 바꾸기 — 안의 파일뿐 아니라 폴더 이름도 돌아와야 한다.
    mkdirSync(join(root, 'dir')); writeFileSync(join(root, 'dir', 'x.txt'), 'X');
    ctx.history.nextTurn();
    const 폴더 = await 감싸서(() => TOOLS.Move.run({ from: 'dir', to: 'DIR' }, ctx));
    check('★ 폴더의 대소문자만 바꾸는 이름 바꾸기가 된다', !폴더.error && 이름들().includes('DIR'), `${폴더.error ?? 폴더.content} → ${이름들().join(',')}`);
    ctx.history.undo(1);
    check('★★ /undo 하면 폴더 이름의 대소문자도 되돌아온다', 이름들().includes('dir') && !이름들().includes('DIR')
      && existsSync(join(root, 'dir', 'x.txt')) && readdirSync(join(root, 'dir')).includes('x.txt'), 이름들().join(','));

    mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src', 'x.txt'), 'X');
    ctx.history.nextTurn();
    const 턴수 = ctx.history.turns().length;
    const 제안 = await 감싸서(() => TOOLS.Move.run({ from: 'src', to: 'SRC/inner' }, ctx));
    check('★ 대소문자만 다른 제 안으로 옮기는 것도 알아보고 거절한다', /제 안/.test(제안.error ?? '') && existsSync(join(root, 'src', 'x.txt')),
      제안.error ?? '(옮겨졌다)');
    check('★ 그것도 이력에 턴을 안 남긴다', ctx.history.turns().length === 턴수, `${턴수} → ${ctx.history.turns().length}`);
  }
  rmSync(root, { recursive: true, force: true });
}

trace('10-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n옮기기 검사  ${D}(옮긴 것이 되돌아오는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
