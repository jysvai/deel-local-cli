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
import { mkdtempSync, readFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// 검사들이 쓸 가짜 설정 폴더. 진짜 ~/.deel 을 건드리지 못하게 한다.
const 설정집 = mkdtempSync(join(tmpdir(), 'deel-test-home-'));

const FILES = [
  'smoke.js',
  'loop.test.js',
  'retry.test.js',
  'proxy.test.js',
  'shell.test.js',
  'ignore.test.js',
  'commit.test.js',
  'keystore.test.js',
  'azure.test.js',
  'vision.test.js',
  'policy.test.js',
  'task.test.js',
  'outline.test.js',
  'network.test.js',
  'web.test.js',
  'abort.test.js',
  'parallel.test.js',
  'modes.test.js',
  'route.test.js',
  'planapprove.test.js',
  'ask.test.js',
  'move.test.js',
  'nudge.test.js',
  'resize.test.js',
  'promptlang.test.js',
  'paste.test.js',
  'ctxsize.test.js',
  'cli.test.js',
  'oneshot.test.js',
  'detect.test.js',
  'ui.test.js',
  'tui.test.js',
  'box.test.js',
  'md.test.js',
  'diff.test.js',
  'mention.test.js',
  'truncated.test.js',
  'ui2.test.js',
  'motion.test.js',
  'office.test.js',
  'newline.test.js',
  'motioncmd.test.js',
  'preview.test.js',
  'setup.test.js',
  'guard.test.js',
  'secrets.test.js',
  'sbom.test.js',
  'undo.test.js',
  'bigfile.test.js',
  'limits.test.js',
  'stuck.test.js',
  'encoding.test.js',
  'commands.test.js',
  'commands-more.test.js',
  'xlsx.test.js',
  'docs.test.js',
  'compact.test.js',
  'store.test.js',
  'threads.test.js',
  'evolve.test.js',
  'pins.test.js',
  'card.test.js',
  'evidence.test.js',
  'recall.test.js',
  'mcp.test.js',
  'memory.test.js',
  'project.test.js',
  'rewind.test.js',
  'notify.test.js',
  'intro.test.js',
  'banner.test.js',
  'statusbar.test.js',
  'i18n.test.js',
  'models.test.js',
  'prompt.test.js',
  'cache.test.js',
  'export.test.js',
  'preset.test.js',
  'lsp.test.js',
  // 뒤에서 도는 명령. 진짜로 프로세스를 띄우고 죽이므로 다른 것들보다 느리다.
  'jobs.test.js',
  'acp.test.js',
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
    // 표준오류는 잡지 않고 그대로 물려준다.
    //
    // 파이프로 받으면 abort() 로 죽을 때 메시지를 잃는다. 윈도우에서 파이프
    // 쓰기는 비동기라, 죽는 순간 아직 안 나간 것이 버려지기 때문이다.
    // 죽는 이유가 적힌 바로 그 줄이 사라진다 — 실제로 그것 때문에 원인을
    // 한 바퀴 더 돌아 찾았다. 요약에 못 실어도 화면에는 남는 편이 낫다.
    // abort 로 죽으면 화면에 아직 안 나간 글이 전부 사라진다. 그래서 진행 자리를
    // 디스크에 따로 적게 한다. 죽은 뒤에도 남는 유일한 단서다.
    const 자취 = join(tmpdir(), `deel-trace-${process.pid}-${file}.txt`);
    try { rmSync(자취, { force: true }); } catch { /* 없으면 그만 */ }

    /*
     * 표준오류를 어디로 보낼까.
     *
     * 평소에는 그대로 물려준다(inherit) — 파이프로 받으면 abort() 로 죽을 때
     * 아직 안 나간 것이 버려져서, 죽는 이유가 적힌 바로 그 줄이 사라진다.
     *
     * 그런데 CI 에서는 그 화면을 볼 권한이 있어야 읽힌다. 밖에서 보이는 것은
     * "exit code 1" 뿐이라, 정작 죽는 이유는 아무 데도 안 남는 셈이다.
     * 그래서 CI 에서만 **파일**로 받는다. 파일은 파이프가 아니라서 abort 로
     * 죽어도 앞엣것이 남고, 죽은 뒤에 읽어 주석에 실을 수 있다.
     */
    const 오류자리 = process.env.GITHUB_ACTIONS
      ? join(tmpdir(), `deel-err-${process.pid}-${file}.txt`)
      : null;
    let 오류fd = null;
    if (오류자리) {
      try { rmSync(오류자리, { force: true }); } catch { /* 없으면 그만 */ }
      // 'wx' 로 연다 — 지운 바로 뒤·여는 바로 앞 그 틈에 같은 이름으로 다른
      // 무언가(심볼릭 링크 등)가 생겨 있으면 그걸 타지 않고 그냥 실패한다.
      try { 오류fd = openSync(오류자리, 'wx'); } catch { 오류fd = null; }
    }

    const kid = spawn(process.execPath, [join(here, file)], {
      stdio: ['ignore', 'pipe', 오류fd ?? 'inherit'],
      // 설정 폴더를 임시 자리로 돌린다.
      //
      // 검사가 사람의 ~/.deel/config.json 을 바꾼 적이 실제로 있다. /level 이
      // 고른 값을 설정에 남기는데, 그게 진짜 설정이었다. 파일마다 조심하는
      // 것보다 여기서 한 번 막는 편이 확실하다 — 앞으로 검사를 새로 넣는
      // 사람이 이걸 몰라도 안전하다.
      // 미리보기 검사가 진짜 브라우저 창을 띄우면 사람 화면이 난장판이 된다.
      env: { ...process.env, FORCE_COLOR: C ? '1' : '', DEEL_TRACE: 자취, DEEL_HOME: 설정집, DEEL_NO_OPEN: '1' },
    });

    let out = '';
    let err = '';
    kid.stdout.on('data', (b) => { out += b; process.stdout.write(b); });

    kid.on('close', (code, signal) => {
      // 숫자를 세어 둔다. 없으면 없는 대로 둔다 — 세는 게 목적이 아니다.
      const m = out.match(/(\d+)개 통과 · (\d+)개 실패|통과 (\d+) · 실패 (\d+)/);
      let steps = [];
      try { steps = readFileSync(자취, 'utf8').split('\n').filter(Boolean); } catch { /* 없을 수 있다 */ }
      try { rmSync(자취, { force: true }); } catch { /* 그만 */ }
      // 파일로 받아 둔 표준오류를 걷어 온다. abort 로 죽었어도 여기엔 남는다.
      if (오류자리) {
        try { closeSync(오류fd); } catch { /* 이미 닫혔다 */ }
        try { err = readFileSync(오류자리, 'utf8'); } catch { /* 없을 수 있다 */ }
        try { rmSync(오류자리, { force: true }); } catch { /* 그만 */ }
        if (err.trim()) process.stderr.write(err);   // 화면에도 그대로 남긴다
      }
      // 무엇이 틀렸는지도 챙긴다. 숫자만으로는 고칠 수가 없다.
      const 실패줄 = out
        .replace(/\x1b\[[0-9;]*m/g, '')
        .split('\n')
        .filter((l) => /^\s*✗/.test(l))
        .map((l) => l.trim())
        .slice(0, 20);

      done({
        file,
        code: code ?? null,
        signal: signal ?? null,
        ms: Date.now() - t0,
        passed: m ? Number(m[1] ?? m[3]) : null,
        failed: m ? Number(m[2] ?? m[4]) : null,
        quiet: out.trim().length === 0,
        err: err.trim(),
        steps,
        실패줄,
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
  // 화면에 아무것도 안 남아도 이건 남는다. 어디까지 갔는지 알려주는 유일한 단서다.
  if (x.steps?.length) {
    console.log(d(`     지나온 자리: ${x.steps.join(' → ')}`));
    if (!x.steps.includes('끝-정상종료')) {
      // 자리표는 구간에 '들어갈 때' 찍힌다. 그러니 마지막 자리표가 죽은 구간이다.
      // 전에 이걸 '그 다음 구간' 으로 읽어 엉뚱한 데를 파느라 한 바퀴 헛돌았다.
      console.log(r(`     ↑ 마지막 자리표가 죽은 구간입니다 — '${x.steps.at(-1)}' 안에서 죽었습니다.`));
      console.log(d(`     (자리표는 구간에 들어갈 때 찍힙니다. 다음 자리표에 못 닿았다는 뜻입니다.)`));
    }
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

/*
 * CI 에서는 실패를 **주석(annotation)** 으로도 남긴다.
 *
 * GitHub 의 실행 기록은 로그를 열 권한이 있어야 읽힌다. 그래서 밖에서는
 * "exit code 1" 한 줄만 보이고, 무엇이 틀렸는지는 아무 데도 안 남는다.
 * `::error` 로 찍은 것은 주석이 되어 실행 화면 맨 위와 PR 의 그 줄에 뜨고,
 * 로그를 안 열어도 보인다.
 *
 * 줄바꿈은 그대로 못 넣는다 — 한 줄이 한 주석이라, 안 바꾸면 첫 줄만 남는다.
 * %25 를 먼저 바꾸는 것이 중요하다. 나중에 바꾸면 우리가 넣은 %0A 의 % 까지
 * 다시 바뀌어 글자 그대로 %250A 가 찍힌다.
 */
if (process.env.GITHUB_ACTIONS) {
  const 감싸기 = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  for (const x of 진) {
    const 몸 = [
      `종료코드 ${x.signal ?? x.code}${x.failed ? ` · 실패 ${x.failed}개` : ''}`,
      // 어느 판에서 진 것인지 같이 적는다. 판마다 다르게 지는 것이 실제로
      // 있었고(리눅스만·Node 24 만), 그걸 모르면 못 재현한다.
      `${process.platform} · node ${process.version}`,
      ...(x.실패줄 ?? []),
      ...(x.steps?.length && !x.steps.includes('끝-정상종료')
        ? [`지나온 자리: ${x.steps.join(' → ')}`, `↑ '${x.steps.at(-1)}' 안에서 죽었습니다.`]
        : []),
      // 죽은 이유가 적힌 줄. 주석에 실어야 밖에서도 읽힌다.
      ...(x.err ? ['── 표준오류 ──', ...x.err.split('\n').filter(Boolean).slice(-25)] : []),
    ].join('\n');
    console.log(`::error file=test/${x.file},title=검사 실패::${감싸기(몸)}`);
  }
}

try { rmSync(설정집, { recursive: true, force: true }); } catch { /* 임시 폴더다 */ }

process.exitCode = 진.length ? 1 : 0;
