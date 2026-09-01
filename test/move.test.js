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
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../src/tools/index.js';
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

  const r = TOOLS.Move.run({ from: 'a.js', to: 'src/core/a.js' }, ctx);
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
  TOOLS.Move.run({ from: 'a.js', to: 'src/a.js' }, ctx);

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

  const r = TOOLS.Move.run({ from: 'ui', to: 'src/view' }, ctx);
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

  const r = TOOLS.Move.run({ from: 'a.js', to: 'src/a.js' }, ctx);
  check('겹치면 거절한다', !!r.error, r.error ?? '(그냥 덮어썼다)');
  check('거절했으면 원래 것이 살아 있다', readFileSync(join(root, 'src', 'a.js'), 'utf8') === '원래것\n');
  check('어떻게 하라고 알려 준다', /overwrite/.test(r.error ?? ''));

  const r2 = TOOLS.Move.run({ from: 'a.js', to: 'src/a.js', overwrite: true }, ctx);
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
  const 안으로 = TOOLS.Move.run({ from: 'ui', to: 'ui/inner' }, ctx);
  check('폴더를 제 안으로는 못 옮긴다', !!안으로.error, 안으로.error ?? '(옮겨졌다)');
  check('막았으면 폴더가 그대로 있다', existsSync(join(root, 'ui', 'a.js')));

  const 밖 = (() => {
    try { return TOOLS.Move.run({ from: 'a.js', to: '../밖.js' }, ctx); } catch (e) { return { error: e.message }; }
  })();
  check('작업 폴더 밖으로 못 나간다', !!밖.error, 밖.error ?? '(나갔다)');

  const 없는것 = TOOLS.Move.run({ from: '없는파일.js', to: 'b.js' }, ctx);
  check('없는 파일은 또렷하게 거절한다', /없는 파일/.test(없는것.error ?? ''), 없는것.error ?? '');

  const 같은자리 = TOOLS.Move.run({ from: 'a.js', to: 'a.js' }, ctx);
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

  const r = TOOLS.Move.run({ moves: [
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

  const r = TOOLS.Move.run({ moves: [
    { from: 'a.js', to: 'src/a.js' },
    { from: '없는것.js', to: 'src/b.js' },
    { from: 'c.js', to: 'src/c.js' },
  ] }, ctx);

  check('막힌 것이 있어도 나머지는 옮긴다',
    existsSync(join(root, 'src', 'a.js')) && existsSync(join(root, 'src', 'c.js')), r.error ?? '');
  check('막힌 것을 감추지 않는다', /실패|✗/.test(r.content ?? ''), r.content ?? '');
  check('막힌 것의 이름이 나온다', /없는것\.js/.test(r.content ?? ''), r.content ?? '');

  const 다막힘 = TOOLS.Move.run({ moves: [{ from: '없1.js', to: 'x.js' }, { from: '없2.js', to: 'y.js' }] }, ctx);
  // 하나도 못 옮겼으면 오류여야 한다 — 아니면 모델이 됐다고 넘어간다.
  check('하나도 못 옮기면 오류다', !!다막힘.error, JSON.stringify(다막힘).slice(0, 80));

  rmSync(root, { recursive: true, force: true });
}

trace('9-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n옮기기 검사  ${D}(옮긴 것이 되돌아오는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
