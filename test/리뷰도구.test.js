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
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
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

// ── 2. --files 와 범위를 같이 주면 그 범위에서 그 파일만 본다 ──────────
//
// 12차 리뷰를 돌리다 알았다. 한 판이 출력 한도에 걸리면 이 도구가
// 「쪼개서 보려면 --files 를 쓰라」 고 일러 주는데, --files 는 늘 **안 올린
// 것**만 봤다. 커밋된 판에는 쓸 수가 없는 말을 일러 주고 있었던 셈이다.
//
// 그래서 둘을 같이 받는다. 범위가 있으면 그 범위 안에서 그 파일만 본다.
// 다만 `--to` 만 주는 것은 여전히 멈춘다 — 어디부터인지가 없다.
trace('2-같이줌');
{
  const r = 띄우기('--files', 'a.js', '--since', 'HEAD~2');
  const 말 = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const 첫줄 = 말.trim().split('\n').filter((l) => l.trim())[0] ?? '';
  check('★★★ --files 와 --since 를 같이 줘도 안 막는다',
    !/같이 못 씁니다/.test(말), 첫줄);
  /*
   * 여기서도 낱말 하나로 재면 안 된다. 파일 갈래가 내는 「이름을 잘못
   * 적어도 **똑같이** 보입니다」 에 걸려 엉뚱하게 초록이 나왔던 자리다.
   * 재려는 문장을 통째로 못박는다.
   */
  check('★★★ 파일 갈래로 들어간다',
    /이 파일들에 바뀐 자리가 없습니다|볼 것이 없습니다/.test(말), 첫줄);
  check('★★★ agy 를 부르기 전에 끝낸다 — 빈 diff 라서',
    !/agy 를 못 찾았습니다/.test(말), 첫줄);
}
{
  const r = 띄우기('--files', 'a.js', '--to', 'HEAD~1');
  const 말 = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const 첫줄 = 말.trim().split('\n').filter((l) => l.trim())[0] ?? '';
  check('★★★ --to 만 있으면 파일 갈래여도 멈춘다', r.status === 2, `code=${r.status} · ${첫줄}`);
  check('★★★ 왜 안 되는지 말한다 — --to',
    /--to 는 --since 와 같이 써야 합니다/.test(말), 첫줄);
  check('★★★ 파일 갈래를 조용히 돌리지 않는다 — --to',
    !/이 파일들에 바뀐 자리가 없습니다/.test(말), 첫줄);
}

// ── 2-나. --out 은 모델을 부르기 전에 본다 ──────────────────────────────
//
// 폴더를 주면 쪽지를 적는 자리에서 터졌다. 그 자리는 모델을 부른 **뒤**라
// 기다린 시간과 토큰이 다 날아갔다 — 12차 리뷰에서 실제로 세 판을 잃었다.
trace('2나-낼곳');
{
  for (const [낼곳, 무엇] of [['.', '폴더'], ['없는폴더/보고.md', '그 폴더가 없습니다']]) {
    const r = 띄우기('--out', 낼곳);
    const 말 = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const 첫줄 = 말.trim().split('\n').filter((l) => l.trim())[0] ?? '';
    check(`★★★ --out 에 못 적을 자리를 주면 멈춘다 — ${낼곳}`,
      r.status === 2, `code=${r.status} · ${첫줄}`);
    check(`★★★ 왜 못 적는지 말한다 — ${낼곳}`,
      말.includes('--out 에 못 적습니다') && 말.includes(무엇), 첫줄);
    check(`★★★ 모델을 부르기 전에 멈춘다 — ${낼곳}`,
      !/agy 를 못 찾았습니다/.test(말), 첫줄);
  }
}

// ── 2-다. --timeout 도 모델을 부르기 전에 본다 ─────────────────────────
//
// `--print-timeout` 은 단위가 붙은 글자를 받는다. 생숫자를 주면 agy 가
// `missing unit in duration` 으로 거적하고, 도구는 그걸 **빈 답**으로 받아
// 「다시 해 보라」 고만 한다 — 까닭을 아무도 모른다. 14차 리뷰에서 실제로
// 한 판을 그렇게 버렸다. 도움말이 `<초>` 라고 적혀 있던 것이 화근이었다.
trace('2다-기다림');
{
  for (const 한도 of ['900', '40', 'm', '40 m']) {
    const r = 띄우기('--timeout', 한도);
    const 말 = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const 첫줄 = 말.trim().split('\n').filter((l) => l.trim())[0] ?? '';
    check(`★★★ --timeout 에 단위가 없으면 멈춘다 — ${한도}`,
      r.status === 2, `code=${r.status} · ${첫줄}`);
    check(`★★★ 무엇을 줘야 하는지 보인다 — ${한도}`,
      말.includes('단위를 붙여') && 말.includes('40m'), 첫줄);
    check(`★★★ 모델을 부르기 전에 멈춘다 — ${한도}`,
      !/agy 를 못 찾았습니다/.test(말) && !/2차 리뷰 {2}/.test(말), 첫줄);
  }
  // 단위가 붙은 값은 이 울타리를 지나간다(빈 범위 울타리에서 멈춘다).
  // 마이크로초는 두 글자로 온다 — µs(U+00B5)와 μs(U+03BC). Go 가 둘 다 받는다.
  for (const 한도 of ['40m', '900s', '1h30m', '500µs', '500μs']) {
    const r = 띄우기('--timeout', 한도, '--files', '없는파일.js');
    const 말 = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    check(`★★★ 단위가 붙은 값은 안 막는다 — ${한도}`,
      !말.includes('단위를 붙여'), 말.trim().split('\n')[0] ?? '');
  }
}

// 도움말이 생숫자를 주라고 적혀 있으면 같은 일이 되풀이된다.
{
  const r = 띄우기('--help');
  const 말 = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  check('★★★ 도움말이 --timeout 에 단위를 붙이라고 적는다',
    /--timeout <시간>/.test(말) && /40m/.test(말), 말.split('\n').find((l) => l.includes('--timeout')) ?? '');
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

// ── 4½. 안 건드린 파일을 통째로 보는 길 ────────────────────────────────
//
// 이 도구는 **변경분**만 봤다. 그래서 방금 고친 자리는 몇 번씩 보는데, 한 번도
// 안 고친 파일은 한 번도 안 봤다 — 오래 사는 결함이 사는 자리가 그쪽이다.
// `--온통` 이 그 길이고, 여기서 재는 것은 「엉뚱한 것을 조용히 보지 않는가」 다.
trace('4반-온통');
{
  const 빈것 = 띄우기('--온통');
  const 빈말 = `${빈것.stdout ?? ''}${빈것.stderr ?? ''}`;
  check('★★★ --온통 뒤가 비면 멈춘다',
    빈것.status === 2 && /뒤에 파일이 없습니다/.test(빈말), `code=${빈것.status} · ${빈말.trim().split('\n')[0] ?? ''}`);

  /*
   * 없는 파일을 주면 **소리 내어** 멈춘다. `--files` 는 빈 diff 가
   * 「안 바뀌었다」 와 「이름을 잘못 적었다」 로 갈리지 않아 되읊어 주는 것이
   * 전부였는데, 통째로 보는 길은 파일이 있는지 그냥 보면 된다.
   */
  const 없는것 = 띄우기('--온통', '없는파일.js');
  const 없는말 = `${없는것.stdout ?? ''}${없는것.stderr ?? ''}`;
  check('★★★ 없는 파일은 조용히 넘기지 않는다',
    없는것.status === 2 && /그런 파일이 없습니다/.test(없는말), `code=${없는것.status} · ${없는말.trim().split('\n')[0] ?? ''}`);

  // 멀쩡한 파일은 통째로 실려 그다음 자리(agy 찾기)까지 가야 한다.
  const 된것 = 띄우기('--온통', 'a.js');
  const 된말 = `${된것.stdout ?? ''}${된것.stderr ?? ''}`;
  check('★★★ 안 바뀐 파일도 통째로 실린다',
    /agy 를 못 찾았습니다/.test(된말) && !/볼 것이 없습니다/.test(된말),
    `code=${된것.status} · ${된말.trim().split('\n').filter((l) => l.trim())[0] ?? ''}`);
  // 무엇을 보는지 적는 줄(`온통 N개 파일`)은 agy 를 찾은 **뒤**에 찍힌다.
  // 이 검사판은 agy 를 일부러 숨기므로 여기서는 잴 수 없다 — 잴 수 없는 것을
  // 재는 단언을 두면 늘 빨갛거나(지금) 늘 초록인(무늬를 헐겁게 하면) 줄이 된다.
}

// ── 5. 길어서 버려진 판은 짧게 다시 묻는다 ─────────────────────────────
//
// 일곱 판을 돌리는 동안 **네 번** 빈 손으로 돌아왔고, 셋이 같은 까닭이었다 —
// 답이 출력 한도를 넘겨 통째로 버려졌다. 쪽지에 「최대 12건」 이라고 못박아
// 뒀는데도 그랬다.
//
// 빈 답은 「지적할 것이 없다」 와 화면에서 똑같이 생긴다. 사람은 초록을 보고
// 그 커밋을 다 봤다고 믿고 넘어간다 — 이 저장소가 되풀이해 고치는 부류를
// 그걸 잡으려고 만든 도구가 그대로 갖고 있는 셈이다.
//
// 모델을 진짜로 부르지 않고 잰다. 판단하는 자리는 순수 함수 둘이라
// 그것만 따로 부르면 된다 — 아이를 띄우면 밖으로 나가고, 나가면 검사가
// 아니라 도박이 된다.
trace('5-길면짧게');
{
  const { 길이규칙, 짧게다시할까, 왜다시, 두판돌리기 } = await import('../tools/리뷰길이.mjs');
  const { 아는옵션, 낯선옵션, 값빠진옵션 } = await import('../tools/리뷰인자.mjs');
  /*
   * 집안규칙의 보고 형식 줄. 두 판의 형식이 어긋나면 모델은 하나를 버린다.
   *
   * 「보고 형식」 이라는 말은 쪽지에 두 번 나온다 — 형식을 **적는** 줄과
   * "위에 적은 그대로다" 라고 **가리키는** 줄이다(10차 리뷰). 앞엣것을
   * 집어야 하므로 형식 자체(`파일:줄`)가 같이 있는 줄로 좁힌다.
   */
  const 집안규칙형식 = readFileSync(new URL('../tools/review2.mjs', import.meta.url), 'utf8')
    .split('\n').find((줄) => /보고 형식/.test(줄) && /파일:줄/.test(줄)) ?? '';

  const 첫판 = 길이규칙(1).join('\n');
  const 둘째 = 길이규칙(2).join('\n');
  /*
   * 쪽지 **자체의 길이**를 재면 안 된다. 처음엔 그렇게 뒀다가 빨개졌는데,
   * 두 번째 판이 왜 짧게 써야 하는지까지 적느라 쪽지가 더 길기 때문이다.
   * 재야 할 것은 쪽지 길이가 아니라 **시키는 양**이다.
   */
  const 몇건 = (t) => Number((t.match(/최대 (\d+)건/) ?? [])[1] ?? NaN);
  check('★★★ 두 번째 판이 건수를 더 줄여 시킨다',
    몇건(둘째) < 몇건(첫판) && 몇건(둘째) > 0,
    `1판 ${몇건(첫판)}건 · 2판 ${몇건(둘째)}건`);
  check('★★★ 두 판 다 건수를 못박는다',
    Number.isFinite(몇건(첫판)) && Number.isFinite(몇건(둘째)),
    `${몇건(첫판)} / ${몇건(둘째)}`);
  check('★★★ 두 번째 판은 왜 짧게 쓰는지 말한다',
    /버려졌다/.test(둘째), 둘째.split('\n')[1] ?? '');

  /*
   * 빈 답으로 끝난 판은 **까닭에 따라** 다시 묻는다.
   *
   * 여태는 「길어서 잘린 것만」 다시 물었다. 도구 거절은 다시 물어도 같은
   * 자리에 막힌다고 봤기 때문이다. **재 보니 아니었다** — 같은 diff 를 같은
   * 설정으로 다섯 번 돌렸더니 길이초과 한 번, 도구거절 한 번이 났다.
   * 판마다 나는 것이 아니라 **흔들리는 것**이라, 다시 부르면 그만큼 산다
   * (22차 눈금 · `pass@k`). 연결이 끊긴 판만 다시 안 묻는다.
   */
  const 잘림 = { status: 'ERROR', error: 'Your previous response was cut off because it exceeded the output token limit' };
  const 막힘 = { status: 'ERROR', error: 'jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.' };
  check('★★★ 길어서 버려졌으면 다시 묻는다', 짧게다시할까(잘림, '') === true);
  check('★★★ 도구가 막혀 멈춘 판도 다시 묻는다', 왜다시(막힘, '') === '막힘');
  check('★★★ 까닭을 갈라서 말해 준다', 왜다시(잘림, '') === '길이');
  check('★★★ 「짧게 다시」 는 길이일 때만이다', 짧게다시할까(막힘, '') === false);
  check('★★★ 끝맺음이 아예 없어도 안 묻는다', 짧게다시할까(null, '') === false);
  check('★★★ 답이 있으면 안 묻는다', 짧게다시할까(잘림, '· route.js:1 · 뭔가 있다') === false);
  check('★★★ 답이 빈칸뿐이어도 빈 답으로 본다', 짧게다시할까(잘림, '   \n  ') === true);
  /*
   * 8차 리뷰. 주석은 「연결 끊김은 다시 안 묻는다」 고 적어 놓고 `cut off` 를
   * 맨낱말로 잡아서, 망이 끊긴 것까지 40분짜리 재시도로 보냈다. 잘린 것은
   * **답이** 잘린 것이지 연결이 끊긴 것이 아니다.
   */
  for (const 말 of [
    'connection cut off by peer', 'stream cut off', 'socket cut off',
    'ECONNRESET', 'socket hang up', 'read ETIMEDOUT',
    /*
     * 9차 리뷰. 「무엇이 잘렸나」 를 낱말 하나로만 봐서, `response` 가
     * 들어간 망 끊김이 그대로 다시 물어졌다. 잘린 것은 **답**이지
     * 연결이나 흐름이 아니다.
     */
    'response stream cut off by peer', 'output stream cut off',
    'the response connection was cut off by the proxy',
    /*
     * 10차 리뷰. 끼는 이름씨가 없으면 그대로 걸렸다 — `by peer` 는
     * **누가 끊었나**를 말한다. 답이 길어서 버려진 것과는 다른 일이다.
     */
    'response cut off by peer', 'output cut off by the proxy',
    'answer truncated by remote', 'output cut off (ECONNRESET)',
  ]) {
    check(`★★★ 망이 끊긴 것은 다시 안 묻는다 — "${말}"`,
      짧게다시할까({ status: 'ERROR', error: 말 }, '') === false, 말);
  }
  /*
   * 갈래마다 **혼자 걸리는 말**로 잰다. 한 문장에 세 갈래가 다 들어 있으면
   * 두 갈래가 죽어도 나머지 하나에 얹혀 초록이다(8차 리뷰).
   */
  for (const 말 of [
    'Your previous response exceeded the output token limit',
    'the output was cut off',
    'response was cut off before it finished',
    /*
     * 10차 리뷰. 낱말 사이를 빈칸으로만 봐서, 실제 도구가 흔히 내는
     * 쌍점·괄호꼴을 못 잡았다. 관사도 늘 붙는 것이 아니다.
     */
    'output: truncated', 'output (truncated)', 'exceeded output limit',
  ]) {
    check(`★★★ 답이 잘린 것은 다시 묻는다 — "${말.slice(0, 40)}"`,
      짧게다시할까({ status: 'ERROR', error: 말 }, '') === true, 말);
  }

  /*
   * 쪽지끼리 어긋나면 안 된다. 집안규칙은 발견마다 심각도를 요구하는데,
   * 두 번째 판 규칙이 「두 줄」 만 적고 심각도 자리를 안 줬다(8차 리뷰).
   * 모델은 둘 중 하나를 버릴 수밖에 없다.
   */
  /*
   * 낱말이 어딘가 있기만 하면 되는 것이 아니다 — **형식 줄**에 있어야
   * 모델이 그 자리에 적는다(9차 리뷰). 형식을 적은 줄에서 찾는다.
   */
  const 형식줄 = 길이규칙(2).find((줄) => /파일:줄/.test(줄)) ?? '';
  check('★★★ 두 번째 판도 형식 줄에 심각도 자리를 준다',
    /심각도/.test(형식줄), 형식줄 || 둘째);
  /*
   * 낱말 하나가 **양쪽에 있느냐**를 참거짓으로 견주면, 양쪽 다 없어도
   * 초록이고 나머지 칸이 통째로 달라도 초록이다(10차 리뷰). 칸을 세어
   * 견주고, **빈 것은 같아도 안 맞은 것**으로 본다.
   *
   * 이름도 고친다 — 여기서 견주는 것은 1판 규칙이 아니라 집안규칙이다.
   */
  const 형식칸 = (줄) => ['파일:줄', '심각도', '재현'].filter((칸) => 줄.includes(칸)).join('·');
  check('★★★ 두 번째 판 형식이 집안규칙과 어긋나지 않는다',
    형식칸(형식줄) !== '' && 형식칸(형식줄) === 형식칸(집안규칙형식),
    `${형식칸(형식줄)} / ${형식칸(집안규칙형식)}`);

  /*
   * ── 재시도 배선 자체를 잰다 ──────────────────────────────────────────
   *
   * 앞 판은 순수 함수 둘만 재고 **그걸 쓰는 자리**는 안 쟀다. 그래서
   * review2.mjs 에서 재시도 토막을 통째로 지워도 이 파일은 초록이었다
   * (8차 리뷰). 판을 도는 자리를 함수로 빼서 가짜 판을 넣어 잰다.
   */
  {
    const 부른판 = [];
    const 가짜 = (답, 오류 = null, 초 = 1) => (판) => {
      부른판.push(판);
      return { r: { status: 0 }, 끝맺음: 오류 ? { status: 'ERROR', error: 오류 } : null, 답, 걸린초: 초 };
    };
    const 한판이면 = 두판돌리기(가짜('· a.js:1 · 뭔가', null, 3));
    check('★★★ 답이 오면 한 판만 돈다',
      부른판.join(',') === '1' && 한판이면.답 === '· a.js:1 · 뭔가' && 한판이면.걸린초 === 3,
      `${부른판} · ${JSON.stringify(한판이면.답)} · ${한판이면.걸린초}`);
    check('★★ 한 판만 돌았다고 말한다', 한판이면.두판 === false, String(한판이면.두판));

    부른판.length = 0;
    let 몇번 = 0;
    const 두판 = 두판돌리기((판) => {
      부른판.push(판);
      몇번 += 1;
      return 몇번 === 1
        ? { r: { status: 0 }, 끝맺음: { status: 'ERROR', error: 'exceeded the output token limit' }, 답: '', 걸린초: 10 }
        : { r: { status: 0 }, 끝맺음: null, 답: '· b.js:2 · 짧게', 걸린초: 5 };
    });
    check('★★★ 길어서 버려지면 두 번째 판을 부른다', 부른판.join(',') === '1,2', String(부른판));
    check('★★★ 두 번째 판 답으로 갈아 낀다', 두판.답 === '· b.js:2 · 짧게', JSON.stringify(두판.답));
    check('★★★ 걸린 시간은 두 판을 더한다', 두판.걸린초 === 15, String(두판.걸린초));
    check('★★ 두 판 돌았다고 말한다', 두판.두판 === true, String(두판.두판));

    부른판.length = 0;
    const 알린것 = [];
    두판돌리기((판) => (판 === 1
      ? { r: {}, 끝맺음: { status: 'ERROR', error: 'exceeded the output token limit' }, 답: '', 걸린초: 7 }
      : { r: {}, 끝맺음: null, 답: 'x', 걸린초: 1 }), (초) => 알린것.push(초));
    check('★★★ 다시 물을 때 사람에게 말한다', 알린것.length === 1 && 알린것[0] === 7, String(알린것));

    부른판.length = 0;
    두판돌리기(가짜('', 'a tool required the read_file permission'));
    check('★★★ 도구가 거절된 판도 끝판까지 돈다', 부른판.join(',') === '1,2,3', String(부른판));

    부른판.length = 0;
    두판돌리기(가짜('', 'socket hang up'));
    check('★★★ 망이 끊긴 판만 한 번 돌고 만다', 부른판.join(',') === '1', String(부른판));
  }

  /*
   * ── 모르는 옵션은 조용히 넘기면 안 된다 ──────────────────────────────
   *
   * `node tools/review2.mjs --help` 를 쳤더니 도움말이 아니라 **진짜
   * 리뷰가 돌았다.** 모르는 옵션을 그냥 흘려버리기 때문이다. 40분과
   * 토큰이 나가고, 친 사람은 도움말을 기다리고 있다.
   *
   * 오타도 같은 자리다 — `--sinse HEAD~3` 은 아무 말 없이 「HEAD 까지
   * 전부」 가 된다. 고르지 말고 멈춰야 하는 자리다.
   */
  for (const [인자, 바람] of [
    [['--since', 'HEAD~3'], []],
    [['--since', 'HEAD~4', '--to', 'HEAD~3'], []],
    [['--files', 'a.js', 'b.js'], []],
    [['--quiet'], []],
    [['--help'], []],
    [['--nope'], ['--nope']],
    [['--sinse', 'HEAD~3'], ['--sinse']],
    [['--quiet', '--verbose'], ['--verbose']],
    [['--out', '보고.md', '--verbose'], ['--verbose']],
    // 값 자리는 옵션이 아니다 — 값이 붙임표로 시작해도 그건 값이다.
    [['--since', '--weird'], []],
  ]) {
    check(`★★★ 모르는 옵션을 집어낸다 — ${인자.join(' ')}`,
      낯선옵션(인자).join(',') === 바람.join(','), JSON.stringify(낯선옵션(인자)));
  }
  /*
   * 값을 받는 옵션인데 값이 없으면 그것도 멈출 자리다(11차 리뷰).
   * `--since` 만 치면 조용히 「안 올린 것 전부」 가 되는데, 사람은 범위를
   * 줬다고 믿는다 — `--files` 뒤가 비었을 때 이미 한 번 고친 부류다.
   */
  /*
   * 12차 리뷰. 위를 「다음 칸이 아는 옵션이면」 으로 적었더니 셋이 샜다.
   * 셋 다 조용히 「안 올린 것 전부」 로 갔다 — 이 울타리가 막으려던 자리다.
   *
   *     --since --unknown     오타 옵션이 값으로 먹혔다
   *     --since ""            셸의 빈 변수가 값으로 먹혔다
   *     --since -- a.js       POSIX 의 「옵션 끝」 표시가 값으로 먹혔다
   *
   * `--files` 가 빈 것은 여기 몫이 아니다 — 값을 여럿 받는 옵션이라
   * review2.mjs 가 제 울타리로 막는다(빈 목록이면 그 자리에서 멈춘다).
   */
  for (const [인자, 바람] of [
    [['--since'], ['--since']],
    [['--since', 'HEAD~3', '--out'], ['--out']],
    [['--since', 'HEAD~3'], []],
    [['--quiet'], []],
    [['--files'], []],
    [['--since', '--unknown'], ['--since']],
    [['--since', ''], ['--since']],
    [['--since', '   '], ['--since']],
    [['--since', '--', 'a.js'], ['--since']],
    [['--since', '--since'], ['--since']],
    [['--to', 'HEAD', '--model'], ['--model']],
    [['--since', 'HEAD~3', '--to', 'HEAD~1', '--out', '보고.md'], []],
  ]) {
    /*
     * `join(',')` 으로만 재면 `['']` 과 `[]` 가 같아진다(12차 리뷰).
     * 길이도 같이 본다.
     */
    const 잰것 = 값빠진옵션(인자);
    check(`★★★ 값이 빠진 옵션을 집어낸다 — ${인자.join(' ') || '(없음)'}`,
      잰것.length === 바람.length && 잰것.join(',') === 바람.join(','),
      JSON.stringify(잰것));
  }
  /*
   * 목록이 실제로 쓰는 옵션과 어긋나면 멀쩡한 옵션이 「모르는 것」 이 되어
   * 도구가 아예 안 돈다. review2.mjs 가 읽는 옵션을 죽 긁어 견준다.
   */
  {
    const 본문 = readFileSync(new URL('../tools/review2.mjs', import.meta.url), 'utf8');
    /*
     * `[값있나]` 는 글자 하나짜리 묶음이라 `있나` 의 끝 글자에만 기댔다(11차 리뷰).
     *
     * 그리고 **`indexOf` 로 읽는 옵션도 봐야 한다.** `--files`·`--온통` 은
     * 뒤에 파일이 여럿 붙어서 `값()` 으로 못 읽고 `인자.indexOf` 로 찾는다.
     * 그 갈래를 안 긁으면, 목록에 등록하는 것을 잊어도 이 검사는 초록인 채
     * 도구가 「모르는 옵션입니다」 로 안 돈다 — 검사가 지켜야 할 바로 그 자리다.
     * 이름에 한글이 올 수 있으니 `[a-z-]` 로 좁히지 않는다.
     */
    const 쓰는것 = [...new Set([
      ...[...본문.matchAll(/(?:값|있나)\(\s*'(--[^']+)'/g)].map((m) => m[1]),
      ...[...본문.matchAll(/indexOf\(\s*'(--[^']+)'/g)].map((m) => m[1]),
    ])];
    const 빠진것 = 쓰는것.filter((x) => !아는옵션.includes(x));
    check('★★ indexOf 로 읽는 옵션도 긁는다 (--files · --온통)',
      쓰는것.includes('--files') && 쓰는것.includes('--온통'), 쓰는것.join(' '));
    check('★★★ 아는 옵션 목록이 실제로 쓰는 옵션을 다 담는다',
      쓰는것.length > 0 && 빠진것.length === 0, `쓰는것 ${쓰는것.join(' ')} · 빠진것 ${빠진것.join(' ')}`);
  }

  /*
   * 그리고 review2.mjs 가 **그 함수를 쓰는지**도 본다. 함수만 있고 안 쓰면
   * 위 검사는 전부 초록인데 도구는 여전히 한 판만 돈다.
   */
  {
    /*
     * 주석 줄은 빼고 본다 — 부르는 자리를 `//` 로 막아도 무늬는 그대로
     * 걸린다(10차 리뷰). 막힌 부름은 안 부르는 것과 같다.
     */
    const 본문 = readFileSync(new URL('../tools/review2.mjs', import.meta.url), 'utf8')
      .split('\n').filter((줄) => !/^\s*(?:\/\/|\*|\/\*)/.test(줄)).join('\n');
    /*
     * **부르는지**를 봐야 한다. 이름만 찾으면 import 한 줄로 초록이 되고,
     * 정작 부르는 자리를 지워도 안 빨개진다(9차 리뷰).
     */
    check('★★★ review2 가 값빠진옵션을 부른다',
      /값빠진옵션\s*\(/.test(본문), 본문.split('\n').filter((줄) => /값빠진옵션/.test(줄)).join(' / '));
    check('★★★ review2 가 낯선옵션을 부른다',
      /낯선옵션\s*\(/.test(본문) && /from '\.\/리뷰인자\.mjs'/.test(본문),
      본문.split('\n').filter((줄) => /리뷰인자|낯선옵션/.test(줄)).join(' / '));
    check('★★★ review2 가 두판돌리기를 부른다',
      /두판돌리기\s*\(/.test(본문) && /from '\.\/리뷰길이\.mjs'/.test(본문),
      본문.split('\n').filter((줄) => /리뷰길이|두판돌리기/.test(줄)).join(' / '));
  }
}

rmSync(집, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n2차 리뷰 도구 검사  ${D}(엉뚱한 것을 리뷰하느니 멈추기)${X}\n`);
// ── 두 판을 다 잃으면 한 판 더 간다 ────────────────────────────────────
//
// 둘째 판(5건·두 줄)도 넘기는 커밋이 있었다 — 19차 리뷰에서 3.8KB 짜리
// diff 하나를 두 판 다 잃고 **아무것도 못 남겼다.** 들어간 것이 작아도
// 나오는 말이 길면 똑같이 버려진다. 한 건이라도 받는 것이 낫다.
trace('10-셋째판');
{
  const { 길이규칙: 규칙, 두판돌리기: 돌리기 } = await import('../tools/리뷰길이.mjs');
  const 넘침 = { status: 'ERROR', error: 'exceeded the output token limit' };

  /*
   * 「길어서 잘렸다」 를 알리는 말은 하나가 아니다. 밑에 깔린 API 는
   * 마침 까닭을 낱말로 준다 — 그걸 못 알아보면 짧게 다시 묻지도 않고
   * 화면에는 쪼갤 수 없는 방법만 남는다(20차 리뷰).
   */
  const { 짧게다시할까: 다시할까, 왜다시: 왜다시2, 끝난까닭, 실패갈래, 길이규칙: 길이규칙2, 두판돌리기: 두판돌리기2 } = await import('../tools/리뷰길이.mjs');

  /*
   * ── 까닭을 값만 이어 붙이면 자리 이름이 사라진다 ──────────────────
   *
   * `finish_reason: 'length'` 를 값만 뽑아 이으면 `"length"` 하나가 된다.
   * 그러면 무늬가 `^length$` 로만 잡을 수 있고, 옆에 `error` 하나만 더
   * 있어도 `"error: … · length"` 가 돼 못 잡는다. 22차 리뷰가 짚었고
   * 손으로 재 보니 여섯 중 넷이 샜다. 자리 이름을 같이 싣는다.
   */
  for (const [이름, 끝맺음] of [
    ['error 와 같이', { error: 'agy failed', finish_reason: 'length' }],
    ['빈 error 와 같이', { error: '', finish_reason: 'length' }],
    ['자리가 둘', { finishReason: 'length', finish_reason: 'length' }],
    ['오라마 꼴 + error', { error: 'oops', done_reason: 'length' }],
    ['멈춘 쪽 + error', { error: 'oops', stop_reason: 'max_tokens' }],
  ]) {
    check(`★★★ 자리가 둘이어도 길이 초과를 알아본다 — ${이름}`,
      다시할까(끝맺음, ''), 끝난까닭(끝맺음));
  }
  check('★★★ 까닭에 자리 이름을 싣는다',
    끝난까닭({ error: 'x', finish_reason: 'length' }) === 'error: x · finish_reason: length',
    끝난까닭({ error: 'x', finish_reason: 'length' }));
  check('★★★ 빈 자리는 빼고 싣는다',
    끝난까닭({ error: '', finish_reason: 'length' }) === 'finish_reason: length',
    끝난까닭({ error: '', finish_reason: 'length' }));
  check('★★★ 그래도 답은 안 긁는다',
    !/MAX_TOKENS/.test(끝난까닭({ status: 'SUCCESS', response: 'MAX_TOKENS 를 조심하세요' })),
    끝난까닭({ status: 'SUCCESS', response: 'MAX_TOKENS 를 조심하세요' }) || '(빈 것)');

  /*
   * 거절 말이 **따옴표를 달고 오리라고 믿지 않는다.** `required the
   * "command" permission` 만 보게 했더니 따옴표 없는 꼴과 짧은 꼴이
   * 그대로 샜다(23차 리뷰). 넓게 잡는 쪽으로 기운다 — 아닌 것을 막힘으로
   * 보면 두 판 더 부르고 끝나지만, 막힌 것을 놓치면 그 판이 통째로 없어진다.
   */
  for (const [이름, 말] of [
    ['따옴표 있는 진짜 말', 'a tool required the "command" permission that headless mode cannot prompt for'],
    ['따옴표 없는 말', 'a tool required the read_file permission'],
    ['짧은 거절', 'RunCommand was denied'],
    ['저절로 거절', 'so it was auto-denied'],
    ['빈 손이라고만', 'jetski: no output produced'],
  ]) {
    check(`★★★ 거절 말을 꼴을 안 가리고 알아본다 — ${이름}`,
      왜다시2({ error: 말 }, '') === '막힘', 말);
  }

  /*
   * 자리 이름을 싣게 되면서 `^length$` 가 안 맞게 됐는데, 그 무늬만 지우고
   * 새 꼴을 안 넣어 `{error: 'length'}` 가 한동안 샜다 — **내가 낸 회귀**를
   * 23차 리뷰가 잡았다. 자리가 하나일 때는 `<자리>: length` 통째로 본다.
   */
  check('★★★ 자리가 하나뿐이고 값이 length 여도 알아본다',
    왜다시2({ error: 'length' }, '') === '길이');
  check('★★★ 그래도 앞에 말이 붙은 length 는 안 잡는다',
    왜다시2({ error: 'content length mismatch' }, '') === false);
  check('★★★ 자리 이름이 달라도 마찬가지다',
    왜다시2({ stop_reason: 'length' }, '') === '길이');

  /*
   * ── 이어 붙인 뒤에 재면 앵커가 옆 칸 때문에 무너진다 ────────────────
   *
   * 같은 실수를 세 판 내리 했다 — 값만 이으면 자리 이름이 사라지고(22차),
   * 이름을 실으면 `^length$` 가 안 맞고(23차), 새 앵커를 넣었더니 자리가
   * 둘일 때 또 안 맞았다(24차). 이제 **칸마다** 잰다.
   */
  for (const [이름, 끝맺음] of [
    ['자리 하나', { error: 'length' }],
    ['뒤에 딴 자리가 붙어도', { error: 'length', finish_reason: 'stop' }],
    ['앞에 딴 자리가 붙어도', { finishReason: 'stop', error: 'length' }],
    ['자리 셋', { error: 'length', finishReason: 'stop', done_reason: 'ok' }],
  ]) {
    check(`★★★ 옆 칸이 있어도 길이 초과를 알아본다 — ${이름}`,
      왜다시2(끝맺음, '') === '길이', 끝난까닭(끝맺음));
  }
  check('★★★ 그래도 앞에 말이 붙은 length 는 안 잡는다',
    왜다시2({ error: 'content length mismatch', finish_reason: 'stop' }, '') === false);
  /*
   * **앞 칸이 있을 때**가 이어 붙이기와 칸마다 재기를 가르는 자리다.
   * `^<자리>: length` 는 글 맨 앞만 보므로, 이어 붙이면 앞에 칸이 하나만
   * 있어도 안 맞는다. `{status: 'ERROR', error: '…'}` 는 agy 가 늘 주는
   * 꼴이라 이게 진짜 판이다.
   *
   * 어긋내기가 이 자리를 짚어 줬다 — 끝 앵커를 `$` 에서 `\b` 로 풀면서
   * 앞엣 검사들이 둘을 **더는 못 가르게** 됐는데, 그걸 아무도 몰랐다.
   */
  check('★★★ 앞에 딴 칸이 있어도 길이 초과를 알아본다',
    왜다시2({ status: 'ERROR', error: 'length' }, '') === '길이',
    끝난까닭({ status: 'ERROR', error: 'length' }));
  check('★★★ 앞 칸이 둘이어도 마찬가지다',
    왜다시2({ status: 'ERROR', error: 'oops', stop_reason: 'length' }, '') === '길이');
  /*
   * 「한도를 넘겼다」 를 적는 낱말은 **꼬리가 붙어서** 오기도 한다.
   * `MAX_TOKENS` 뒤에 `\b` 를 박았더니 `MAX_TOKENS_EXCEEDED` 가 빠졌고
   * (밑줄은 낱말 경계가 아니다), `context_length_exceeded` 는 오픈AI 가
   * 실제로 주는 오류 이름인데 어느 갈래에도 안 걸렸다(27차 리뷰).
   */
  for (const [이름, 끝맺음] of [
    ['MAX_TOKENS_EXCEEDED', { error: 'MAX_TOKENS_EXCEEDED' }],
    ['context_length_exceeded', { error: 'context_length_exceeded' }],
    ['reason 한 자리', { reason: 'length' }],
  ]) {
    check(`★★★ 꼬리 붙은 한도 낱말도 알아본다 — ${이름}`,
      왜다시2(끝맺음, '') === '길이', 끝난까닭(끝맺음));
  }
  check('★★★ reason: stop 은 다시 안 묻는다', 왜다시2({ reason: 'stop' }, '') === false);

  /*
   * 까닭 자리에 글자가 아닌 것이 올 수 있다. `String({message: …})` 는
   * `[object Object]` 라, 무늬가 조용히 빗나가고 그 판을 버린다(24차 리뷰).
   */
  for (const [이름, 끝맺음, 바람] of [
    ['객체 속 message', { error: { message: 'exceeded the output token limit' } }, '길이'],
    ['객체 속 reason', { error: { reason: 'auto-denied' } }, '막힘'],
    ['통째로 객체', { error: { code: 42, detail: 'MAX_TOKENS' } }, '길이'],
    ['숫자', { error: 500 }, false],
  ]) {
    check(`★★★ 글자가 아닌 까닭도 읽는다 — ${이름}`, 왜다시2(끝맺음, '') === 바람, JSON.stringify(끝맺음));
  }

  /*
   * 권한 이름에 점이 박힌 꼴(`file.read`)이 있다. 사이를 `[^.]` 로 뒀더니
   * 그 꼴이 통째로 빠졌다(24차 리뷰).
   */
  for (const 말 of ['a tool required the file.read permission',
    'a tool required the fs.write.all permission',
    'blocked by a permission that headless mode cannot prompt for']) {
    check(`★★★ 점 박힌 권한 이름도 알아본다 — ${말.slice(0, 40)}`,
      왜다시2({ error: 말 }, '') === '막힘', 말);
  }

  /*
   * 까닭이 **상태 한 칸으로만** 오기도 한다. `까닭자리` 에 `status` 가
   * 없어서 `{status: 'MAX_TOKENS'}` 로 끝난 판은 칸이 하나도 안 잡혀
   * 다시 묻지도 않고 끝났다(26차 리뷰).
   */
  check('★★★ 상태 한 칸으로 온 까닭도 읽는다', 왜다시2({ status: 'MAX_TOKENS' }, '') === '길이');
  check('★★★ 상태로 온 거절도 읽는다', 왜다시2({ status: 'DENIED' }, '') === '막힘');
  check('★★★ 뜻 없는 상태는 다시 안 묻는다', 왜다시2({ status: 'ERROR' }, '') === false);

  /*
   * `length` 뒤에 말이 붙는 꼴이 있다(`length exceeded`). 끝을 `$` 로
   * 막았더니 그 꼴이 빠졌다(26차 리뷰).
   */
  check('★★★ length 뒤에 말이 붙어도 잡는다', 왜다시2({ error: 'length exceeded' }, '') === '길이');
  check('★★★ 그래도 content length 는 안 잡는다', 왜다시2({ error: 'content length mismatch' }, '') === false);

  /*
   * 가르기(무엇이 잘못됐나)와 다시 묻기(또 물을까)는 다른 물음이다.
   * 한 자리로 모으면서 「답이 있으면 안 묻는다」 를 덮어썼던 자리다.
   */
  check('★★★ 갈래는 답이 있어도 왜 죽었는지 말한다',
    실패갈래({ status: 'ERROR', error: 'exceeded the output token limit' }, '· a.js:1 · 뭔가') === '길이초과');
  check('★★★ 그래도 답이 있으면 다시 안 묻는다',
    왜다시2({ status: 'ERROR', error: 'exceeded the output token limit' }, '· a.js:1 · 뭔가') === false);
  for (const [이름, 끝맺음, 답, 바람] of [
    ['성공', { status: 'SUCCESS' }, '· a.js:1 · 뭔가', '성공'],
    ['길이초과', { finish_reason: 'length' }, '', '길이초과'],
    ['도구거절', { error: 'RunCommand was denied' }, '', '도구거절'],
    ['망끊김', { error: 'connection closed by peer' }, '', '망끊김'],
    ['그밖에', { error: 'disk full' }, '', '그밖에'],
  ]) {
    check(`★★★ 갈래를 한 낱말로 가른다 — ${이름}`, 실패갈래(끝맺음, 답) === 바람, 실패갈래(끝맺음, 답));
  }

  /*
   * 막힌 판은 「더 짧게 써라」 가 아니라 「멈추지 말고 적어라」 라고 물어야
   * 한다. 까닭이 판마다 다르니 다시 묻는 말도 달라야 한다.
   *
   * **왜 잃었나와 몇 판 잃었나는 따로다.** 한 덩이로 묶어 뒀더니 첫 판을
   * 길이로, 둘째 판을 도구로 잃은 판에서 셋째 판이 조이기를 통째로 못
   * 받았다(23차 리뷰). 셋째 판은 마지막이라 조이기가 빠지면 또 잃는다.
   */
  const 몇건세기 = (t) => Number((t.match(/최대 (\d+)건/) ?? [])[1] ?? NaN);
  for (const [판, 까닭, 바람건수, 도구얘기] of [
    [2, '길이', 5, false],
    [3, '길이', 3, false],
    [2, '막힘', 5, true],
    [3, '막힘', 3, true],
  ]) {
    const 글 = 길이규칙2(판, 까닭).join('\n');
    check(`★★★ ${판}판·${까닭} 은 ${바람건수}건까지 조인다`, 몇건세기(글) === 바람건수, `${몇건세기(글)}건`);
    check(`★★★ ${판}판·${까닭} 의 머리말이 까닭에 맞는다`,
      /도구를 쓰려다 거절/.test(글) === 도구얘기, 글.split('\n')[1] ?? '');
  }
  /*
   * 조이기는 **까닭을 안 탄다** — 몇 판 잃었느냐로만 정한다. 그래서 막힌
   * 판 쪽지에도 건수 얘기가 같이 들어간다. 이게 맞다(23차에서 그렇게
   * 고쳤다). 주석에는 「도구 얘기만 한다」 고 적혀 있었고 검사는
   * `!/짧게 써라/` 만 봐서 그 어긋남을 못 잡았다(24차 리뷰).
   */
  check('★★★ 막힌 판에도 조이기가 붙는다',
    /최대 5건/.test(길이규칙2(2, '막힘').join('\n')));
  check('★★★ 막힌 판 머리말은 길이 얘기로 시작하지 않는다',
    !/말이 길어/.test(길이규칙2(2, '막힘').join('\n')));
  const 막힘쪽지 = 길이규칙2(2, '막힘').join('\n');
  check('★★★ 막힌 판에는 도구 얘기를 한다', /도구를 쓰려다 거절/.test(막힘쪽지), 막힘쪽지.split('\n')[1] ?? '');
  /*
   * 여기 「막힌 판에 『짧게 써라』 라고 안 한다」 가 있었다. **틀린 약속을
   * 재고 있었다** — 조이기는 까닭을 안 타고 늘 붙는 것이 맞다(23차). 바로
   * 위 두 줄이 진짜 약속을 잰다: 조이기는 붙고, 머리말만 까닭을 탄다.
   */
  check('★★★ 길이일 때는 여태 하던 말 그대로', /짧게 써라/.test(길이규칙2(2, '길이').join('\n')));
  check('★★★ 까닭을 안 주면 길이로 본다', /짧게 써라/.test(길이규칙2(2).join('\n')));

  /*
   * 되풀이하는 자리가 두 까닭을 다 봐야 한다. 한쪽만 보면 나머지 한쪽은
   * 한 판 부르고 버려진다 — 22차의 파일 하나짜리 판이 그렇게 199초 만에
   * 끝났다(세 판이 아니라 한 판이었다).
   */
  for (const [이름, 말, 바람판] of [
    ['길이초과', 'exceeded the output token limit', 3],
    ['도구 막힘', 'jetski: no output produced — auto-denied', 3],
    ['망 끊김', 'socket hang up', 1],
  ]) {
    const r = 두판돌리기2(() => ({ 끝맺음: { error: 말 }, 답: '', 걸린초: 1 }), () => {});
    check(`★★★ 막힌 판도 끝판까지 간다 — ${이름}`, r.몇판 === 바람판, `${r.몇판}판`);
  }
  {
    const 받은 = [];
    두판돌리기2((판, 까닭) => { 받은.push(까닭); return { 끝맺음: { error: 'auto-denied' }, 답: '', 걸린초: 1 }; }, () => {});
    check('★★★ 왜 다시 묻는지를 한판에 넘긴다', 받은[1] === '막힘' && 받은[2] === '막힘', JSON.stringify(받은));
  }
  {
    const 알린까닭 = [];
    두판돌리기2(() => ({ 끝맺음: { error: 'auto-denied' }, 답: '', 걸린초: 1 }), (초, 판, 까닭) => 알린까닭.push(까닭));
    /*
     * `[].every(...)` 는 참이다 — 알림을 아예 안 불러도 초록이었다.
     * **몇 번 불렸는지 먼저 못 박는다**(24차 리뷰).
     */
    check('★★★ 다시 묻는 판마다 알린다', 알린까닭.length === 2, `${알린까닭.length}번`);
    check('★★★ 화면에도 왜 다시 묻는지 알린다',
      알린까닭.length > 0 && 알린까닭.every((x) => x === '막힘'), JSON.stringify(알린까닭));
  }
  const { 줄일말: 말고르기 } = await import('../tools/리뷰길이.mjs');
  for (const 까닭 of ['finishReason: MAX_TOKENS', 'finish_reason: length', 'finish_reason="MAX_TOKENS"',
    '{"done_reason": "length"}', 'stop_reason: max_tokens']) {
    check(`★★★ 길이 초과를 알아본다 — ${까닭}`, 다시할까({ error: 까닭 }, ''), 까닭);
    check(`★★★ 그때 하는 말도 잘림 쪽이다 — ${까닭}`,
      /잘렸습니다/.test(말고르기({ 무엇: '파일 1개', 까닭 }).join(' ')), 까닭);
  }
  /*
   * 까닭이 글이 아니라 **속성 이름**으로 올라오기도 한다 — 밑에 깔린 것이
   * 무엇이냐에 따라 다르다. 하나만 보면 나머지는 못 알아본다(21차 리뷰).
   */
  for (const 끝맺음 of [
    { finishReason: 'MAX_TOKENS' }, { finish_reason: 'length' },
    { done_reason: 'length' }, { stopReason: 'max_tokens' },
  ]) {
    check(`★★★ 속성으로 온 까닭도 알아본다 — ${JSON.stringify(끝맺음)}`,
      다시할까(끝맺음, ''), JSON.stringify(끝맺음));
  }
  /*
   * 끝맺음을 통째로 글자로 만들면 안 된다 — 거기엔 모델이 쓴 **답**도
   * 들어 있어서, 답 안에 `MAX_TOKENS` 라고 적힌 판을 잘린 것으로 오해한다.
   */
  check('★★★ 답에 적힌 낱말을 까닭으로 오해하지 않는다',
    !다시할까({ status: 'SUCCESS', response: 'MAX_TOKENS 를 조심하세요' }, ''),
    'response 안의 MAX_TOKENS');

  // 그렇다고 망이 끊긴 판까지 다시 묻지는 않는다.
  for (const 까닭 of ['socket hang up', 'connection cut off by peer', 'ECONNRESET']) {
    check(`★★★ 망이 끊긴 것은 길이 초과가 아니다 — ${까닭}`, !다시할까({ error: 까닭 }, ''), 까닭);
  }
  // `length` 를 홀로 두면 넓다 — 까닭을 적는 자리와 붙어 있을 때만 본다.
  for (const 까닭 of ['content length mismatch', 'array length 0']) {
    check(`★★★ 아무 length 나 잡지 않는다 — ${까닭}`, !다시할까({ error: 까닭 }, ''), 까닭);
  }

  const 셋째 = 규칙(3).join('\n');
  check('★★★ 셋째 판은 건수를 더 줄인다', /최대 3건/.test(셋째), 셋째.replace(/\n/g, ' / '));
  check('★★★ 셋째 판은 한 줄로 적으라 한다', /한 줄/.test(셋째), 셋째.replace(/\n/g, ' / '));
  check('★★★ 셋째 판이 둘째 판보다 짧게 시킨다',
    Number((셋째.match(/최대 (\d+)건/) ?? [])[1]) < Number((규칙(2).join(' ').match(/최대 (\d+)건/) ?? [])[1]),
    `${(규칙(2).join(' ').match(/최대 \d+건/) ?? [])[0]} → ${(셋째.match(/최대 \d+건/) ?? [])[0]}`);

  {
    const 본판 = [];
    const 끝 = 돌리기((판) => {
      본판.push(판);
      return 판 === 3
        ? { r: {}, 끝맺음: { status: 'SUCCESS' }, 답: '· a.js:1 · 뭔가', 걸린초: 1 }
        : { r: {}, 끝맺음: 넘침, 답: '', 걸린초: 1 };
    });
    check('★★★ 두 판을 잃으면 셋째 판까지 간다', 본판.join(',') === '1,2,3', 본판.join(','));
    check('★★★ 셋째 판이 준 답을 그대로 돌려준다', 끝.답 === '· a.js:1 · 뭔가', String(끝.답));
    check('★★★ 걸린 시간을 다 더한다', 끝.걸린초 === 3, String(끝.걸린초));
    check('★★★ 몇 판째였는지 말해 준다', 끝.몇판 === 3, String(끝.몇판));
  }
  {
    const 본판 = [];
    돌리기((판) => {
      본판.push(판);
      return { r: {}, 끝맺음: 넘침, 답: '', 걸린초: 1 };
    });
    check('★★★ 끝판을 넘겨서 되풀이하지 않는다', 본판.join(',') === '1,2,3', 본판.join(','));
  }
  {
    const 본판 = [];
    돌리기((판) => {
      본판.push(판);
      return { r: {}, 끝맺음: { status: 'ERROR', error: 'socket hang up' }, 답: '', 걸린초: 1 };
    });
    check('★★★ 망이 끊긴 판은 한 번만 부른다', 본판.join(',') === '1', 본판.join(','));
  }
  {
    const 알린것 = [];
    돌리기((판) => (판 === 2
      ? { r: {}, 끝맺음: { status: 'SUCCESS' }, 답: '· a.js:1 · 뭔가', 걸린초: 1 }
      : { r: {}, 끝맺음: 넘침, 답: '', 걸린초: 1 }), (초, 다음판) => 알린것.push(다음판));
    check('★★★ 몇 판째를 다시 묻는지 알려 준다', 알린것.join(',') === '2', 알린것.join(','));
  }
}

// ── 빈 손으로 왔을 때 하는 말이 이 판에서 쓸 수 있는 말인가 ─────────────
//
// 답이 출력 한도에 걸려 잘려도 「빈 채로 돌아왔다」 로 보인다. 그때 여태
// 「--files 로 쪼개 보라」 고만 했는데, 이미 파일 하나를 준 판에서는 쪼갤
// 것이 없다 — 19차 리뷰를 그렇게 한 판 잃고 화면에는 못 쓸 방법만 남았다.
trace('9-줄일말');
{
  const { 줄일말 } = await import('../tools/리뷰길이.mjs');
  const 넘친까닭 = 'Your previous response was cut off because it exceeded the output token limit';

  {
    const 다 = 줄일말({ 무엇: '파일 1개 · HEAD~2..HEAD~1', 까닭: 넘친까닭, 부터: 'HEAD~2', 까지: 'HEAD~1' }).join('\n');
    check('★★★ 잘렸으면 잘렸다고 말한다', /잘렸습니다/.test(다), 다.replace(/\n/g, ' / '));
    check('★★★ 파일이 하나면 파일을 나누라고 안 한다', !/--files/.test(다), 다.replace(/\n/g, ' / '));
    check('★★★ 파일이 하나라는 것을 짚어 준다', /파일이 이미 하나/.test(다), 다.replace(/\n/g, ' / '));
    check('★★★ 지금 보고 있는 판을 되읊는다', /HEAD~2\.\.HEAD~1/.test(다), 다.replace(/\n/g, ' / '));
  }
  {
    const 다 = 줄일말({ 무엇: '파일 7개', 까닭: 넘친까닭 }).join('\n');
    check('★★★ 파일이 여럿이면 나누라고 한다', /--files/.test(다), 다.replace(/\n/g, ' / '));
    check('★★★ 그때는 「이미 하나」 소리를 안 한다', !/이미 하나/.test(다), 다.replace(/\n/g, ' / '));
  }
  {
    const 다 = 줄일말({ 무엇: '파일 1개', 까닭: 'agy 를 못 띄웠습니다' }).join('\n');
    check('★★★ 잘린 게 아니면 잘렸다고 안 한다', !/잘렸습니다/.test(다), 다.replace(/\n/g, ' / '));
    check('★★★ 그때는 여태 하던 말을 그대로 한다', /쪼개서 보려면/.test(다), 다.replace(/\n/g, ' / '));
  }
  {
    const 다 = 줄일말({ 무엇: '', 까닭: '' }).join('\n');
    check('★★★ 아무것도 없어도 다시 하는 법은 말한다', /--timeout 90m/.test(다), 다.replace(/\n/g, ' / '));
  }
  // 함수만 있고 안 쓰면 화면은 그대로다.
  const 본문 = readFileSync(new URL('../tools/review2.mjs', import.meta.url), 'utf8');
  /*
   * 화면에 까닭 적는 줄이 `error` 한 자리만 보고 있었다 — 다시 물을지
   * 정하는 갈래는 일곱 자리를 보는데(24차 리뷰). 같은 도구 안 두 갈래가
   * 어긋나면 한쪽만 고쳐 놓고 고쳤다고 여기게 된다.
   */
  check('★★★ 화면 까닭도 끝난까닭으로 읽는다',
    /const 까닭글 = 끝난까닭\(끝맺음\);/.test(본문)
      && !/String\(끝맺음\.error\)/.test(본문));
  /*
   * `git diff` 는 아직 add 안 한 파일을 한 줄도 안 보여 준다 — 새로 만든
   * 파일은 2차 리뷰를 **한 번도 안 거치고** 들어갔다(24차 리뷰).
   */
  check('★★★ 안 올린 파일도 볼 것에 싣는다',
    /ls-files', '--others', '--exclude-standard'/.test(본문)
      && /새파일diff\(\)/.test(본문));
  check('★★★ 빈 것과 견줄 때 판마다 다른 이름을 쓴다',
    /win32' \? 'NUL' : '\/dev\/null'/.test(본문));

  /*
   * 새 파일을 싣는 자리를 **빈 검사 뒤**에 뒀더니, `--files <새 파일>` 이
   * 여전히 한 줄도 안 보고 나갔다 — 화면에는 「이름을 잘못 적었나」 라고까지
   * 적혔다(25차 리뷰). 고친 자리 바로 옆에 낸 틈이다.
   */
  {
    const 새것줄 = 본문.indexOf('const 새것 = 부터 ?');
    const 빈검사줄 = 본문.indexOf('볼 것이 없습니다 — 이 파일들에');
    check('★★★ 새 파일을 실은 뒤에 빈 검사를 한다',
      새것줄 > 0 && 빈검사줄 > 0 && 새것줄 < 빈검사줄,
      `새것 ${새것줄} · 빈검사 ${빈검사줄}`);
    check('★★★ 빈 검사가 새 파일까지 더해서 본다',
      /if \(!\(r\.stdout \+ 새것\)\.trim\(\)\)/.test(본문));
  }

  /*
   * **잘린 답은 빈 답이 아니다.** 답이 왔는데 상태가 나쁜 판을 통째로
   * 버리면서 화면에는 「빈 채로 돌아왔습니다」 라고 적고 있었다. 다시 묻는
   * 자리는 「답이 조금이라도 오면 다시 안 묻는다」 고 정해 둔 채라, 둘을
   * 합치면 그 판은 **다시 묻지도 않고 받은 것도 안 보여 주는** 자리가 된다.
   */
  check('★★★ 답이 왔으면 상태가 나빠도 보여 준다',
    /if \(답 && 끝맺음\?\.status !== 'SUCCESS'\)/.test(본문)
      && /답이 끝까지 오지 않았습니다/.test(본문));
  check('★★★ 빈 답일 때만 실패로 친다', /^if \(!답\) \{$/m.test(본문));

  /*
   * 어긋내기를 한 자리만 골라 돌리는 길(`npm run mutate -- <경로>`).
   *
   * 전부는 열다섯 분이 넘어서, 방금 넓힌 울타리 하나를 재려고 그걸 기다리면
   * **안 재게 된다.** 그런데 윈도우에서 탭 자동완성으로 경로를 넣으면
   * 역슬래시로 오고, 목록의 `곳` 은 늘 슬래시라 **하나도 안 맞아 종료코드 2**
   * 로 끝난다 — 「잰 줄 알고」 넘어가는 자리다(29차 리뷰).
   */
  {
    const 어긋본문 = readFileSync(new URL('../tools/mutate.mjs', import.meta.url), 'utf8');
    const 걸러줄 = 어긋본문.split('\n').find((줄) => 줄.startsWith('const 걸러 =')) ?? '';
    check('★★ 걸러낼 경로의 역슬래시를 슬래시로 맞춘다',
      걸러줄.includes(String.raw`replace(/\\/g, '/')`), 걸러줄);
    check('★★ 골라 돌렸으면 몇 개만 봤는지 화면에 적는다',
      /어긋들\.length !== 모든어긋\.length/.test(어긋본문) && /골라 돌립니다/.test(어긋본문));
    check('★★ 하나도 안 맞으면 조용히 초록을 내지 않는다',
      /걸러낼 것이 하나도 안 맞습니다/.test(어긋본문) && /process\.exit\(2\)/.test(어긋본문));
  }

  /*
   * 재는 쪽이 재이는 쪽보다 덜 보면 안 된다 — 눈금이 `error` 한 자리만
   * 읽어서, `finish_reason` 에만 까닭이 온 판을 「그밖에」 로 뭉갰다.
   */
  {
    const 눈금 = readFileSync(new URL('../tools/리뷰눈금.mjs', import.meta.url), 'utf8');
    /*
     * 눈금이 **제 무늬를 따로 갖지 않는다.** 한때 갖고 있었고 셋이 다
     * 도구 쪽보다 좁아서, `finish_reason: length` 도 `denied` 홀로도
     * `by peer` 도 「그밖에」 로 뭉갰다(26차 리뷰). 재는 쪽이 재이는 쪽보다
     * 덜 보면 그 표는 거짓말이고, 그 표를 근거로 한 판단이 전부 틀린다.
     */
    check('★★★ 눈금이 도구의 가르기를 그대로 쓴다',
      /import \{[^}]*실패갈래[^}]*\} from '\.\/리뷰길이\.mjs'/.test(눈금)
        && /실패갈래\(/.test(눈금),
      눈금.split('\n').find((l) => l.includes('리뷰길이.mjs')) ?? '');
    check('★★★ 눈금이 제 무늬를 따로 갖지 않는다',
      !/output token limit\|MAX_TOKENS/.test(눈금)
        && !/ECONN\|socket hang up/.test(눈금));
    check('★★★ 있는지만 보는데 파일을 통째로 읽지 않는다',
      /existsSync\(p\)/.test(눈금) && !/readFileSync\(p, \{ flag: 'r' \}\)/.test(눈금));
    check('★★★ 눈금은 모델을 하나로 못박는다',
      /const 모델 = 'gemini-3\.8-flash-high';/.test(눈금));
  }

  check('★★★ review2 가 줄일말을 부른다',
    /import \{[^}]*줄일말[^}]*\} from '\.\/리뷰길이\.mjs'/.test(본문) && /줄일말\(\{/.test(본문),
    본문.split('\n').find((l) => l.includes('줄일말({'))?.trim() ?? '');
}

for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
