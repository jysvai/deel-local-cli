// 검사를 하나씩 돌리고, 어느 파일이 어떻게 끝났는지 표로 남긴다.
//
// 왜 만들었나:
//   전에는 `node a.js && node b.js && ...` 였다. 이러면 두 가지가 안 보인다.
//
//   1) 어느 파일이 죽었는지 — 화면에 찍힌 마지막 글이 죽은 파일의 것이라는
//      보장이 없다. 통과를 다 찍고 종료할 때 죽을 수도 있고, 아무것도 못
//      찍고 죽을 수도 있다. 실제로 윈도우 CI 에서 그 둘을 구분 못 해
//      한참 헤맸다.
//   2) 뒤에 있는 파일들의 상태 — && 는 첫 실패에서 멈추므로, 한 번 돌려서
//      알 수 있는 게 하나뿐이다. 고치고 다시 올리기를 반복하게 된다.
//
//   그래서 전부 돌리고, 파일별 종료코드를 따로 적는다. '통과 표시' 가 아니라
//   '종료코드' 가 CI 가 보는 값이기 때문이다.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const FILES = [
  'smoke.js',
  'loop.test.js',
  'network.test.js',
  'web.test.js',
  'abort.test.js',
  'parallel.test.js',
  'compact.test.js',
  'store.test.js',
  'scan.test.js',
  'plugins.test.js',
  'no-bundle.test.js',
  'edit-bench.js',
];

const C = process.stdout.isTTY || process.env.FORCE_COLOR || process.env.CI;
const g = (s) => (C ? `\x1b[32m${s}\x1b[0m` : s);
const r = (s) => (C ? `\x1b[31m${s}\x1b[0m` : s);
const d = (s) => (C ? `\x1b[90m${s}\x1b[0m` : s);

// 한 파일을 돌린다. 화면에는 그대로 흘려보내고, 나중에 쓸 것만 따로 모은다.
function runOne(file) {
  return new Promise((done) => {
    const t0 = Date.now();
    const kid = spawn(process.execPath, [join(here, file)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: C ? '1' : '' },
    });

    let out = '';
    let err = '';
    kid.stdout.on('data', (b) => { out += b; process.stdout.write(b); });
    // stderr 도 화면에 그대로 보낸다. 조용히 죽는 경우를 놓치지 않기 위해서다.
    kid.stderr.on('data', (b) => { err += b; process.stderr.write(b); });

    kid.on('close', (code, signal) => {
      // 숫자를 세어 둔다. 없으면 없는 대로 둔다 — 세는 게 목적이 아니다.
      const m = out.match(/(\d+)개 통과 · (\d+)개 실패|통과 (\d+) · 실패 (\d+)/);
      done({
        file,
        code: code ?? null,
        signal: signal ?? null,
        ms: Date.now() - t0,
        passed: m ? Number(m[1] ?? m[3]) : null,
        failed: m ? Number(m[2] ?? m[4]) : null,
        quiet: out.trim().length === 0,
        err: err.trim(),
      });
    });
  });
}

const results = [];
// 첫 실패에서 멈추지 않는다 — 한 번 돌려서 전부 알아야 한다.
for (const f of FILES) results.push(await runOne(f));

const 진 = results.filter((x) => x.code !== 0);
const 총통과 = results.reduce((a, x) => a + (x.passed ?? 0), 0);
const 총실패 = results.reduce((a, x) => a + (x.failed ?? 0), 0);

const W = (s, n) => s + ' '.repeat(Math.max(0, n - [...String(s)].length));

console.log('');
console.log('  ' + '─'.repeat(66));
console.log(`  ${W('검사 파일', 22)}${W('종료코드', 10)}${W('통과', 8)}${W('실패', 8)}시간`);
console.log('  ' + '─'.repeat(66));
for (const x of results) {
  const ok = x.code === 0;
  const 표 = ok ? g('✓') : r('✗');
  const 코드 = x.signal ? `${x.signal}` : String(x.code);
  console.log(`  ${표} ${W(x.file, 20)}${W(ok ? d(코드) : r(코드), ok ? 19 : 19)}` +
              `${W(x.passed ?? '-', 8)}${W(x.failed ?? '-', 8)}${d(`${(x.ms / 1000).toFixed(1)}초`)}`);
}
console.log('  ' + '─'.repeat(66));
console.log(`  ${총통과}개 통과 · ${총실패}개 실패 · 파일 ${results.length}개 중 ${results.length - 진.length}개 정상 종료`);
console.log('');

// 통과를 다 찍고도 종료코드가 0 이 아닌 경우가 있다. 그 구분을 눈에 띄게 적는다.
for (const x of 진) {
  console.log(r(`  ✗ ${x.file} — 종료코드 ${x.signal ?? x.code}`));
  // 0xC0000409. 윈도우가 abort() 를 이 숫자로 알린다. 그냥 보면 무슨 뜻인지 모른다.
  if (x.code === 3221226505) {
    console.log(d('     0xC0000409 — 윈도우 abort() 입니다. 검사가 틀린 게 아니라'));
    console.log(d('     끝낼 때 남은 핸들 때문에 죽었습니다. process.exit() 를 쓰고 있지 않은지 보세요.'));
  }
  if (x.quiet) {
    console.log(d('     아무것도 못 찍고 죽었습니다 — 파일을 읽다가 터진 쪽입니다.'));
  } else if ((x.failed ?? 0) === 0) {
    console.log(d('     검사는 전부 통과했는데 종료코드만 1 입니다 —'));
    console.log(d('     끝낼 때 남은 핸들·처리 안 된 거절 때문입니다. 화면만 보면 초록으로 보입니다.'));
  }
  if (x.err) {
    console.log(d('     ── 표준오류 ──'));
    for (const line of x.err.split('\n').slice(0, 12)) console.log(d(`     ${line}`));
  }
  console.log('');
}

process.exitCode = 진.length ? 1 : 0;
