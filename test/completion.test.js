// `deel completion <셸>` — 탭 눌러 완성하기 (src/completion.js).
//
// ── 무엇을 재나 ────────────────────────────────────────────────────────
//
// 완성이 알려 주는 명령이 실제로 없으면 도움말보다 나쁘다. 도움말은 안 읽으면
// 그만이지만 완성은 **없는 것을 있다고 우긴다.** 그래서 여기서 제일 중요한
// 것은 목록이 bin/deel.js 와 안 갈리는지다 — 새 명령을 넣고 완성에 안 적으면,
// 또는 완성에만 적고 안 만들면, 이 검사가 빨개진다.
//
// 그리고 **진짜 셸에 넣어서 눌러 본다.** 스크립트가 만들어지는 것만 보면
// 안 보이는 탈이 있다. 실제로 파워셸 쪽에서 두 개가 그렇게 잡혔다 —
// 문법이 틀린 줄 하나와, 빈칸까지 친 자리에서 앞 낱말을 하나 더 앞으로 본 것.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { 명령들, 숨은명령, 깃발들, 셸들, 완성스크립트, runCompletion } from '../src/completion.js';
import { MODES } from '../src/agent/modes.js';
import { LEVELS, PROFILES } from '../src/agent/effort.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const skip = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 건너뜀 = (name, 왜) => skip.push({ name, 왜 });

const 있나 = (이름, 인자) => {
  const r = spawnSync(이름, 인자, { encoding: 'utf8', timeout: 8000, windowsHide: true });
  return !r.error && r.status === 0;
};

// ── 1. ★ 목록이 진짜 명령과 안 갈린다 ─────────────────────────────────
trace('1-안갈림');
{
  const 소스 = readFileSync(resolve('bin/deel.js'), 'utf8');
  // switch 안의 `case '이름':` 만 줍는다.
  const 진짜 = new Set(
    [...소스.matchAll(/^\s*case '([^']*)':/gm)].map((m) => m[1]).filter(Boolean),
  );
  const 적은것 = new Set(명령들.map((x) => x.이름));
  for (const h of 숨은명령) 적은것.add(h);
  // version·help 는 switch 앞에서 따로 받는다. 있는 것으로 친다.
  진짜.add('version'); 진짜.add('help');

  const 없는데적음 = [...적은것].filter((n) => !진짜.has(n));
  const 있는데안적음 = [...진짜].filter((n) => !적은것.has(n));
  check('★ 완성이 없는 명령을 알려 주지 않는다', 없는데적음.length === 0, 없는데적음.join(' '));
  check('★ 있는 명령을 빠뜨리지 않는다', 있는데안적음.length === 0, 있는데안적음.join(' '));
  check('명령마다 한글 뜻이 적혀 있다', 명령들.every((x) => x.뜻 && x.뜻.length >= 3),
    명령들.filter((x) => !x.뜻 || x.뜻.length < 3).map((x) => x.이름).join(' '));
  // 파워셸 툴팁은 영문을 쓴다(CP949 함정). 한쪽만 적으면 툴팁이 비어 버린다.
  check('★ 명령마다 영문 뜻도 적혀 있다', 명령들.every((x) => x.en && /^[ -~]+$/.test(x.en)),
    명령들.filter((x) => !x.en || !/^[ -~]+$/.test(x.en)).map((x) => x.이름).join(' '));
  check('★ 깃발마다 영문 뜻도 적혀 있다', 깃발들.every((x) => x.en && /^[ -~]+$/.test(x.en)),
    깃발들.filter((x) => !x.en || !/^[ -~]+$/.test(x.en)).map((x) => x.이름).join(' '));

  // 값 목록도 코드에서 온 것이어야 한다. 손으로 베끼면 언젠가 갈린다.
  const 값찾기 = (이름) => 깃발들.find((x) => x.이름 === 이름)?.값;
  check('★ --mode 값이 진짜 모드 목록이다',
    값찾기('--mode').join(' ') === Object.keys(MODES).join(' '), 값찾기('--mode').join(' '));
  check('★ --think 값이 진짜 단계 목록이다',
    값찾기('--think').join(' ') === LEVELS.join(' '), 값찾기('--think').join(' '));
  check('★ --effort 값이 진짜 프로필 목록이다',
    값찾기('--effort').join(' ') === Object.keys(PROFILES).join(' '), 값찾기('--effort').join(' '));
}

// ── 2. 낸 것의 모양 ───────────────────────────────────────────────────
trace('2-모양');
{
  for (const 셸 of 셸들) {
    const r = 완성스크립트(셸);
    check(`${셸} 스크립트를 낸다`, r.ok === true && r.글.length > 200, r.ok ? String(r.글.length) : r.왜);
    check(`${셸} 스크립트에 넣는 법이 적혀 있다`, /넣는 법|Install/.test(r.글 ?? ''), (r.글 ?? '').slice(0, 60));
  }
  const b = 완성스크립트('bash').글;
  check('bash 판은 complete 로 붙인다', /complete -F _deel deel/.test(b));
  check('zsh 판은 bashcompinit 을 먼저 부른다', /bashcompinit/.test(완성스크립트('zsh').글));
  check('파워셸 판은 Register-ArgumentCompleter 를 쓴다', /Register-ArgumentCompleter/.test(완성스크립트('pwsh').글));

  check('모르는 셸은 안 된다고 한다', 완성스크립트('fish').ok === false, JSON.stringify(완성스크립트('fish')));
  check('그때 있는 것을 알려 준다', /bash/.test(완성스크립트('fish').왜 ?? ''), 완성스크립트('fish').왜);
  check('안 주면 물어본다', 완성스크립트('').ok === false && /어느 셸/.test(완성스크립트('').왜), 완성스크립트('').왜);
  check('대소문자를 안 가린다', 완성스크립트('BASH').ok === true);

  // 셸 스크립트 안에 그대로 실릴 글자들 — 따옴표가 섞이면 스크립트가 깨진다.
  const 위험 = [...명령들, ...깃발들]
    .filter((x) => /['"`$\\]/.test(x.이름) || /["`\\]/.test(String(x.en)));
  check('이름·뜻에 스크립트를 깨뜨릴 글자가 없다', 위험.length === 0, JSON.stringify(위험));

  /*
   * ★ 파워셸 스크립트는 처음부터 끝까지 ASCII 여야 한다.
   *
   * CP949 는 두 바이트 인코딩이라 한글 UTF-8 바이트를 짝지어 먹다가 닫는
   * 따옴표까지 삼킨다. 그러면 문자열이 안 닫혀 그 줄이 문법 오류가 된다.
   * 「따옴표 안이니 깨져도 괜찮겠지」가 틀렸던 자리다 — 진짜 파워셸이 알려 줬다.
   */
  const ps = 완성스크립트('powershell').글;
  const 밖 = [...ps].filter((ch) => ch.charCodeAt(0) > 126 || ch.charCodeAt(0) < 9);
  check('★ 파워셸 스크립트에 ASCII 밖 글자가 없다', 밖.length === 0, 밖.slice(0, 20).join(''));
}

// ── 3. ★ 진짜 bash 에 넣고 눌러 본다 ──────────────────────────────────
trace('3-bash');
if (있나('bash', ['-c', 'echo ok'])) {
  const 방 = mkdtempSync(join(tmpdir(), 'deel-comp-'));
  const 파일 = join(방, 'c.bash').replace(/\\/g, '/');
  writeFileSync(파일, 완성스크립트('bash').글, 'utf8');

  const 문법 = spawnSync('bash', ['-n', 파일], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  check('★ bash 문법이 맞다', 문법.status === 0, (문법.stderr ?? '').split('\n')[0]);

  /** 실제로 탭을 누른 것과 같은 상태를 만들고 _deel 을 부른다. */
  const 눌러보기 = (낱말들, 자리) => {
    const 셸 = `source '${파일}'\n`
      + `COMP_WORDS=(${낱말들.map((w) => `'${w}'`).join(' ')})\n`
      + `COMP_CWORD=${자리}\n`
      + '_deel\n'
      + 'printf "%s\\n" "${COMPREPLY[*]}"\n';
    const r = spawnSync('bash', ['-c', 셸], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return (r.stdout ?? '').trim();
  };

  check('★ 첫 낱말이면 명령이 나온다', 눌러보기(['deel', ''], 1).split(' ').includes('sbom'), 눌러보기(['deel', ''], 1));
  check('★ 앞글자를 치면 좁혀진다', 눌러보기(['deel', 'sb'], 1) === 'sbom', 눌러보기(['deel', 'sb'], 1));
  check('★ --mode 다음에는 모드만 나온다',
    눌러보기(['deel', '--mode', ''], 2) === Object.keys(MODES).join(' '), 눌러보기(['deel', '--mode', ''], 2));
  check('★ --think 다음에는 단계만 나온다',
    눌러보기(['deel', '--think', ''], 2) === LEVELS.join(' '), 눌러보기(['deel', '--think', ''], 2));
  check('★ completion 다음에는 셸만 나온다',
    눌러보기(['deel', 'completion', ''], 2) === 셸들.join(' '), 눌러보기(['deel', 'completion', ''], 2));
  check('★ 깃발을 치는 중이면 깃발만 나온다', 눌러보기(['deel', '--js'], 1) === '--json', 눌러보기(['deel', '--js'], 1));
  check('명령을 이미 골랐으면 명령을 또 안 낸다',
    !눌러보기(['deel', 'run', ''], 2).split(' ').includes('sbom'), 눌러보기(['deel', 'run', ''], 2));
} else {
  건너뜀('진짜 bash 에 넣고 눌러 보기', '이 PC 에 bash 가 없습니다');
}

// ── 4. ★ 진짜 파워셸에 넣고 눌러 본다 ────────────────────────────────
trace('4-파워셸');
if (process.platform === 'win32' && 있나('powershell', ['-NoProfile', '-Command', 'exit 0'])) {
  const 방 = mkdtempSync(join(tmpdir(), 'deel-comp-ps-'));
  const 파일 = join(방, 'c.ps1');
  writeFileSync(파일, 완성스크립트('powershell').글, 'utf8');

  const 눌러보기 = (줄) => {
    const 스크립트 = `$ErrorActionPreference='Stop'\n. '${파일.replace(/'/g, "''")}'\n`
      + `$r = TabExpansion2 -inputScript ${JSON.stringify(줄)} -cursorColumn ${줄.length}\n`
      + '($r.CompletionMatches | ForEach-Object { $_.CompletionText }) -join " "\n';
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 스크립트], {
      encoding: 'utf8', timeout: 60000, windowsHide: true,
    });
    return { 글: (r.stdout ?? '').trim(), 탈: (r.stderr ?? '').trim() };
  };

  const 첫 = 눌러보기('deel sb');
  check('★ 파워셸 스크립트가 오류 없이 돈다', 첫.탈 === '', 첫.탈.split('\n')[0]);
  check('★ 파워셸에서도 명령이 좁혀진다', 첫.글 === 'sbom', `${첫.글} / ${첫.탈.split('\n')[0]}`);
  const 모드 = 눌러보기('deel --mode ');
  check('★ 파워셸: 빈칸까지 친 자리에서도 앞 낱말을 제대로 본다',
    모드.글 === Object.keys(MODES).join(' '), 모드.글);
  const 단계 = 눌러보기('deel --think ');
  check('★ 파워셸: --think 다음에는 단계만', 단계.글 === LEVELS.join(' '), 단계.글);
  const 깃발 = 눌러보기('deel --js');
  check('★ 파워셸: 깃발도 좁혀진다', 깃발.글 === '--json', 깃발.글);
} else {
  건너뜀('진짜 파워셸에 넣고 눌러 보기', '윈도우가 아니거나 powershell 이 없습니다');
}

// ── 5. 명령이 붙었나 ──────────────────────────────────────────────────
trace('5-명령');
{
  const 돌리기 = (인자) => spawnSync(process.execPath, [resolve('bin/deel.js'), ...인자], {
    encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, DEEL_HOME: mkdtempSync(join(tmpdir(), 'deel-home-')), NO_COLOR: '1' },
  });

  const r = 돌리기(['completion', 'bash']);
  check('deel completion bash 가 돈다', r.status === 0, String(r.status));
  check('★ 스크립트는 표준출력으로만 나온다 (파이프에 물릴 수 있게)',
    /complete -F _deel deel/.test(r.stdout ?? '') && !/complete -F/.test(r.stderr ?? ''),
    (r.stderr ?? '').slice(0, 80));
  check('군말이 안 섞인다 (첫 줄이 주석)', (r.stdout ?? '').startsWith('# deel'), (r.stdout ?? '').slice(0, 40));

  const bad = 돌리기(['completion', 'fish']);
  check('모르는 셸이면 종료코드가 1', bad.status === 1, String(bad.status));
  check('그때 표준출력은 비어 있다', (bad.stdout ?? '').trim() === '', (bad.stdout ?? '').slice(0, 60));
  check('까닭은 표준오류로', /fish/.test(bad.stderr ?? ''), (bad.stderr ?? '').trim());

  const 빈것 = 돌리기(['completion']);
  check('셸을 안 주면 물어본다', 빈것.status === 1 && /어느 셸/.test(빈것.stderr ?? ''), (빈것.stderr ?? '').trim());
}

// ── 6. runCompletion 낱개 ─────────────────────────────────────────────
trace('6-낱개');
{
  const 원래 = process.stdout.write;
  let 모은것 = '';
  process.stdout.write = (s) => { 모은것 += s; return true; };
  const 코드 = runCompletion(['bash']);
  process.stdout.write = 원래;
  check('되면 0 을 준다', 코드 === 0, String(코드));
  check('낸 것이 스크립트다', /complete -F _deel/.test(모은것), 모은것.slice(0, 40));

  const 원래2 = process.stderr.write;
  process.stderr.write = () => true;
  const 코드2 = runCompletion(['fish']);
  process.stderr.write = 원래2;
  check('안 되면 1 을 준다', 코드2 === 1, String(코드2));
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const Y = '\x1b[33m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n탭 완성 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
for (const s of skip) console.log(`  ${Y}－${X} ${s.name}  ${D}${s.왜}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패${skip.length ? ` · ${skip.length}개 건너뜀` : ''}\n`);
process.exitCode = fail.length ? 1 : 0;
