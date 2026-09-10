// `tools/review2.mjs` — 2차 리뷰를 부르는 도구가 **무엇을 보는지**.
//
// ── 왜 이 파일이 생겼나 ─────────────────────────────────────────────────
//
// 이 도구에는 검사가 없었다. 그 사이에 옵션이 셋 어긋났고, 셋 다 같은
// 모양이었다 — **조용히 다른 것을 본다.**
//
//   · `--to HEAD~2` 만 주면 `if (부터)` 에 안 걸려 통째로 무시되고,
//     화면에는 「아직 커밋 안 한 것」 이라고 적힌 채 엉뚱한 것이 나간다.
//   · `--files` 와 `--since` 를 같이 주면 앞엣것이 먼저 돌아가 범위가 사라진다.
//   · 시작과 끝을 같게 주면 빈 diff 를 그대로 모델에 보낸다.
//
// 리뷰 도구가 **엉뚱한 것을 리뷰하는 것**은 안 도는 것보다 나쁘다. 사람은
// 초록을 보고 그 자리를 다 봤다고 믿는다.
//
// ── 어떻게 재나 ─────────────────────────────────────────────────────────
//
// 진짜로 띄운다. 다만 셋 다 **모델을 부르기 전에 끝나는 갈래**다. 그래도
// 혹시 새어 나가면 그 자리에서 터지도록, 아이한테는 agy 를 못 찾는 PATH 를
// 준다 — 이 저장소 규칙상 검사는 밖으로 한 줄도 안 내보낸다.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), '..');
const 도구 = join(뿌리, 'tools', 'review2.mjs');

// ── 0. 커밋 셋짜리 저장소 하나 ──────────────────────────────────────────
trace('0-저장소');
const 집 = mkdtempSync(join(tmpdir(), 'deel-review2-'));
const 깃 = (...args) => spawnSync('git', args, { cwd: 집, encoding: 'utf8' });
깃('init', '-q');
깃('config', 'user.email', 'a@b.c');
깃('config', 'user.name', '검사');
for (const [n, 글] of [['a', '1'], ['b', '2'], ['c', '3']]) {
  writeFileSync(join(집, `${n}.js`), `export const ${n} = ${글};\n`, 'utf8');
  깃('add', '-A');
  깃('commit', '-q', '-m', `${n} 넣음`);
}

/*
 * agy 를 **못 찾게** 만든다. 도구는 깔린 자리를 정해 놓고 보므로
 * (LOCALAPPDATA / 집 폴더), 그 둘을 빈 폴더로 돌려 두면 모델을 부르러
 * 가는 갈래는 전부 「agy 를 못 찾았습니다」 에서 멈춘다.
 *
 * PATH 를 비우지 않는 까닭은 이 도구가 `git` 을 부르기 때문이다 — PATH 를
 * 비우면 재려던 것 대신 git 이 없어서 죽는다.
 */
const 띄우기 = (...args) => spawnSync(process.execPath, [도구, ...args], {
  cwd: 집,
  encoding: 'utf8',
  timeout: 30000,
  env: {
    ...process.env,
    LOCALAPPDATA: 집,
    USERPROFILE: 집,
    HOME: 집,
  },
});

// ── 1. --to 만 주면 멈춘다 ──────────────────────────────────────────────
//
// 「멈춘다」 를 종료코드만으로 재면 안 된다. 이 도구는 agy 를 못 찾을 때도
// 2 로 끝나므로, 한참 뒤에서 다른 까닭으로 죽어도 초록이 된다. 그래서
// **무슨 말로** 멈췄는지, 그리고 **agy 찾기 앞에서** 멈췄는지를 같이 본다.
trace('1-to만');
{
  const r = 띄우기('--to', 'HEAD~2');
  const 말 = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const 첫줄 = 말.trim().split('\n').filter((l) => l.trim())[0] ?? '';
  check('★★★ --to 만 주면 그냥 넘어가지 않는다', r.status === 2, `code=${r.status} · ${첫줄}`);
  check('★★★ 어디부터인지를 되묻는다',
    /--to 는 --since 와 같이 써야 합니다/.test(말), 말.trim().split('\n').slice(0, 3).join(' / '));
  check('★★★ agy 를 찾으러 가기 전에 멈춘다',
    !/agy 를 못 찾았습니다/.test(말), 첫줄);
  check('★★★ 「아직 커밋 안 한 것」 으로 슬쩍 바꾸지 않는다',
    !/아직 커밋 안 한 것/.test(말), 첫줄);
}

// ── 2. --files 와 범위를 같이 주면 멈춘다 ───────────────────────────────
//
// 여기서도 낱말 하나로 재면 안 된다. `/같이/` 로 뒀더니 파일 갈래가 내는
// 「이름을 잘못 적어도 **똑같이** 보입니다」 에 걸려, 아무것도 안 고친
// 상태에서 초록이 나왔다. 재려는 문장을 통째로 못박는다.
trace('2-같이줌');
{
  for (const 뒤 of [['--since', 'HEAD~2'], ['--to', 'HEAD~1']]) {
    const r = 띄우기('--files', 'a.js', ...뒤);
    const 말 = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const 첫줄 = 말.trim().split('\n').filter((l) => l.trim())[0] ?? '';
    check(`★★★ --files 와 ${뒤[0]} 를 같이 주면 멈춘다`, r.status === 2, `code=${r.status} · ${첫줄}`);
    check(`★★★ 왜 안 되는지 말한다 — ${뒤[0]}`,
      /--files 와 --since\/--to 는 같이 못 씁니다/.test(말), 첫줄);
    check(`★★★ 파일 갈래를 조용히 돌리지 않는다 — ${뒤[0]}`,
      !/이 파일들에 바뀐 자리가 없습니다/.test(말), 첫줄);
  }
}

// ── 3. 빈 범위는 모델을 안 부른다 ───────────────────────────────────────
trace('3-빈범위');
{
  const r = 띄우기('--since', 'HEAD~2', '--to', 'HEAD~2');
  const 말 = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  check('★★★ 시작과 끝이 같으면 그냥 끝낸다', r.status === 0, `code=${r.status} · ${말.trim().split('\n')[0] ?? ''}`);
  check('★★★ 볼 것이 없다고 말한다', /볼 것이 없습니다/.test(말), 말.trim().split('\n')[0] ?? '');
  /*
   * 이 검사가 `--to` 가 진짜로 먹는다는 증거다. `--to` 를 무시하면 범위가
   * `HEAD~2..HEAD` 가 되어 바뀐 자리가 **생기고**, 그러면 여기서 안 끝나고
   * 모델을 부르러 가서 PATH 에 막혀 죽는다.
   */
  check('★★★ 화면에 적힌 범위가 시킨 그대로다', /HEAD~2\.\.HEAD~2/.test(말), 말.trim().split('\n').slice(0, 3).join(' / '));
}

// ── 4. 멀쩡한 범위는 여기서 안 막는다 ───────────────────────────────────
//
// 울타리를 옮기면 옮긴 자리에 틈이 생긴다 — 이 저장소가 여러 번 겪은
// 모양이다. 「같이 못 쓴다」 를 너무 넓게 잡아 `--since` 하나도 못 쓰게
// 되면 도구가 통째로 죽는다. 그래서 반대쪽을 잰다: 멀쩡한 범위는 옵션
// 검사를 그냥 지나가서, **그다음 자리**인 agy 찾기에서 멈춰야 한다.
trace('4-멀쩡한범위');
{
  const r = 띄우기('--since', 'HEAD~2', '--to', 'HEAD~1');
  const 말 = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  check('★★★ 멀쩡한 범위는 옵션 검사에 안 걸린다',
    !/같이 못 씁니다|--to 는 --since 와/.test(말), 말.trim().split('\n')[0] ?? '');
  check('★★★ 옵션 검사를 지나 그다음 자리까지 간다',
    /agy 를 못 찾았습니다/.test(말), `code=${r.status} · ${말.trim().split('\n').filter((l) => l.trim())[0] ?? ''}`);
}

rmSync(집, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n2차 리뷰 도구 검사  ${D}(엉뚱한 것을 리뷰하느니 멈추기)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
