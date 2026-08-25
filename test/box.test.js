// 입력 상자를 켠 채로 진짜 deel 을 띄워 본다.
//
// ── 왜 이 파일이 따로 있나 ──────────────────────────────────────────────
//
// 여기서 잡으려는 결함이 실제로 한 번 나갔다.
//
//   화면을 전체화면으로 바꿨더니 **슬래시 명령이 전부 먹통**이 됐다.
//   /help 를 쳐도 아무것도 안 나왔다. 명령이 안 돈 것이 아니라, 결과가
//   찍히자마자 다음 다시그리기에 덮여 사라진 것이었다 — commands.js 를
//   비롯한 여섯 모듈이 화면 객체를 안 거치고 stdout 에 바로 쓰기 때문이다.
//
//   그때 검사 1,745개가 전부 초록이었다. 검사는 자식을 파이프로 띄우고,
//   파이프면 상자·전체화면이 안 켜지니 **그 코드를 한 번도 안 밟았다.**
//
// 그래서 isTTY 만 거짓말하는 앞선불러오기(tty-preload.mjs)를 물려 자식을
// 띄운다. 상자는 켜지고, stdout 은 여전히 파이프라 우리가 다 읽을 수 있다.
//
// 확인하는 것은 하나다 — **사람이 친 명령의 결과가 화면에 남아 있는가.**
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 여기 = dirname(fileURLToPath(import.meta.url));
const 뿌리 = join(여기, '..');
const 앞선것 = join(여기, 'tty-preload.mjs');

trace('1-띄우기');

/**
 * deel 을 상자 모드로 띄우고 줄을 하나씩 넣는다.
 *
 * 모델은 안 부른다 — 닿을 수 없는 주소를 준다. 여기서 보는 것은 화면이지
 * 모델이 아니다. 슬래시 명령만으로 충분하다.
 */
async function 띄우기(줄들, { 상자 = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'deel-box-'));
  const home = mkdtempSync(join(tmpdir(), 'deel-box-home-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 'stub', level: '개발자',
    profiles: [{
      id: 'stub', name: '스텁 연결', kind: 'openai', baseUrl: 'http://127.0.0.1:1/v1',
      auth: 'none', apiKey: '', model: '스텁모델', ctx: 32768, streaming: false, tools: true,
    }],
  }), 'utf8');

  const args = ['--import', `file:///${앞선것.replace(/\\/g, '/')}`,
    join(뿌리, 'bin', 'deel.js'), '--root', root, '--offline', '--ctx', '32768'];
  if (!상자) args.push('--no-tui');

  const kid = spawn(process.execPath, args, {
    cwd: 뿌리,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DEEL_HOME: home, FORCE_COLOR: '1' },
  });

  let out = '';
  kid.stdout.on('data', (b) => { out += b; });
  kid.stderr.on('data', (b) => { out += b; });

  // 끝나기를 기다릴 약속은 **띄우자마자** 걸어 둔다.
  // /exit 로 먼저 끝나 버리면 나중에 거는 on('close') 는 영영 안 온다 —
  // 검사가 통째로 매달린다.
  let 끝남 = false;
  const 닫힘 = new Promise((r) => kid.on('close', () => { 끝남 = true; r(); }));

  const 자기 = (ms) => new Promise((r) => setTimeout(r, ms));
  const 넣기 = (l) => { if (!끝남) { try { kid.stdin.write(l + '\n'); } catch { /* 이미 닫혔다 */ } } };

  await 자기(1800);                       // 켜지고 머리말이 나올 때까지
  for (const l of 줄들) { 넣기(l); await 자기(700); }
  넣기('/exit');
  await Promise.race([닫힘, 자기(3000)]);
  if (!끝남) { kid.kill(); await Promise.race([닫힘, 자기(2000)]); }

  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  // 제어문자를 벗긴 글과 날것을 같이 돌려준다. 둘 다 볼 일이 있다.
  return { 날것: out, 글: out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '') };
}

/**
 * deel 을 상자 모드로 띄워 놓고 키를 눌러 본다.
 *
 * 줄을 통째로 넣는 띄우기() 와 다르다. 여기서는 **키 하나하나**를 보내고
 * 그때마다 상자에 무엇이 그려졌는지 읽는다 — 방향키·백스페이스·이력은
 * 줄 단위로는 잴 수가 없다.
 */
async function 키눌러보기(단계들) {
  const root = mkdtempSync(join(tmpdir(), 'deel-key-'));
  const home = mkdtempSync(join(tmpdir(), 'deel-key-home-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 'stub', level: '개발자',
    profiles: [{
      id: 'stub', name: '스텁 연결', kind: 'openai', baseUrl: 'http://127.0.0.1:1/v1',
      auth: 'none', apiKey: '', model: '스텁모델', ctx: 32768, streaming: false, tools: true,
    }],
  }), 'utf8');

  const kid = spawn(process.execPath, [
    '--import', `file:///${앞선것.replace(/\\/g, '/')}`,
    join(뿌리, 'bin', 'deel.js'), '--root', root, '--offline', '--ctx', '32768',
  ], { cwd: 뿌리, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DEEL_HOME: home, FORCE_COLOR: '1' } });

  let out = '';
  kid.stdout.on('data', (b) => { out += b; });
  kid.stderr.on('data', (b) => { out += b; });
  let 끝남 = false;
  const 닫힘 = new Promise((r) => kid.on('close', () => { 끝남 = true; r(); }));
  const 자기 = (ms) => new Promise((r) => setTimeout(r, ms));

  // 마지막으로 그려진 상자 안쪽 글. 제어문자를 벗기고 테두리를 떼어 낸다.
  const 지금글 = () => {
    const 줄들 = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').split('\n').filter((l) => /│ [❯…] /.test(l));
    return (줄들.at(-1) ?? '').replace(/^.*│ [❯…] /, '').replace(/ *│.*$/, '');
  };

  await 자기(1800);
  const 결과 = [];
  for (const 단계 of 단계들) {
    out = '';
    for (const k of 단계.키) { if (!끝남) { try { kid.stdin.write(k); } catch {} } await 자기(110); }
    await 자기(320);
    const 본것 = 지금글();
    결과.push({ ...단계, 본것, 맞나: 본것 === 단계.기대 });
  }

  if (!끝남) { try { kid.stdin.write('\n/exit\n'); } catch {} }
  await Promise.race([닫힘, 자기(2500)]);
  if (!끝남) { kid.kill(); await Promise.race([닫힘, 자기(1500)]); }
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  return 결과;
}

trace('2-슬래시가보이는가');

// ── 여기가 이 파일의 존재 이유다 ────────────────────────────────────────
{
  const r = await 띄우기(['/help', '/tools', '/memory 검사용 한 줄입니다', '/memory']);

  // 켤 때 나오는 머리말도 테두리를 쓴다. 그러니 테두리만 보면 안 되고,
  // **테두리 안에 ❯ 가 있는 줄**을 봐야 입력 상자를 본 것이다.
  check('상자 모드로 켜졌다', /│ ❯ /.test(r.글), (r.글.match(/│ ❯ .*/) ?? [''])[0].slice(0, 40));
  check('/help 결과가 화면에 남는다', /명령 목록/.test(r.글), '');
  check('/tools 결과가 화면에 남는다', /TodoWrite/.test(r.글), '');
  check('/memory 적기가 화면에 남는다', /기억했습니다/.test(r.글), '');
  check('/memory 목록이 화면에 남는다', /검사용 한 줄입니다/.test(r.글), '');

  // 사람이 보낸 글도 대화에 남아야 한다. 안 남으면 스크롤을 올렸을 때
  // 답만 있고 무엇을 물었는지가 없다.
  check('내가 친 명령이 대화에 남는다', /❯ \/help/.test(r.글), '');

  // 상자를 지우는 제어문자가 실제로 나가야 한다. 안 나가면 상자가 화면에
  // 겹겹이 쌓인다 (파이프에서는 안 보이니 여기서 잰다).
  check('상자를 지우는 제어문자가 나간다', /\x1b\[K/.test(r.날것), '');
  check('커서를 위로 되돌리는 제어문자가 나간다', /\x1b\[\d*A/.test(r.날것), '');

  // 대체 화면(vim 처럼 딴 화면)은 이제 안 쓴다. 쓰면 나갈 때 대화가 통째로
  // 사라지고, 그걸 되살리는 코드를 또 들고 있어야 한다.
  check('딴 화면을 안 쓴다', !/\x1b\[\?1049/.test(r.날것), '');
}

trace('3-키를눌러본다');

// ── 치는 감촉 ───────────────────────────────────────────────────────────
//
// 상자는 readline 이 들고 있는 글을 그린다. 그 사이가 어긋나면 화면과 실제
// 입력이 갈라지고, 그건 **사람이 친 것과 다른 글이 보내지는** 것이다.
//
// 터미널이 보내는 바이트를 그대로 흘려 넣어 잰다. 한글은 두 칸이라 커서 자리가
// 제일 잘 틀리고, 백스페이스가 바이트 단위로 지워지면 글자가 깨진다.
{
  const BS = '\x7f';
  const 왼 = '\x1b[D'; const 오른 = '\x1b[C'; const 위 = '\x1b[A';
  const 맨앞 = '\x01'; const 맨끝 = '\x05';   // Ctrl+A / Ctrl+E

  const r = await 키눌러보기([
    { 이름: '한글을 한 글자씩 친다', 키: ['집', '계', ' ', '함', '수'], 기대: '집계 함수' },
    // 한글 한 글자는 UTF-8 로 세 바이트다. 바이트로 지우면 글자가 깨진다.
    { 이름: '백스페이스가 한 글자를 지운다', 키: [BS], 기대: '집계 함' },
    { 이름: '이어서 두 번 더 지운다', 키: [BS, BS], 기대: '집계' },
    { 이름: '영문을 이어 친다', 키: [' ', 'l', 'o', 'g'], 기대: '집계 log' },
    { 이름: '왼쪽 방향키로 가서 끼워 넣는다', 키: [왼, 왼, 왼, 'X'], 기대: '집계 Xlog' },
    { 이름: '오른쪽으로 가서 지운다', 키: [오른, BS], 기대: '집계 Xog' },
    { 이름: 'Ctrl+A 로 맨 앞에 간다', 키: [맨앞, '앞'], 기대: '앞집계 Xog' },
    { 이름: 'Ctrl+E 로 맨 끝에 간다', 키: [맨끝, '끝'], 기대: '앞집계 Xog끝' },
    { 이름: '통째로 지운다', 키: Array(20).fill(BS), 기대: '' },
    { 이름: '보내고 나면 상자가 빈다', 키: ['다시 쳐 봅니다\n'], 기대: '' },
    { 이름: '위 방향키로 지난 입력을 되살린다', 키: [위], 기대: '다시 쳐 봅니다' },
  ]);

  for (const x of r) {
    check(x.이름, x.맞나, x.맞나 ? '' : `본 것 ${JSON.stringify(x.본것)} · 바란 것 ${JSON.stringify(x.기대)}`);
  }
}

trace('4-줄모드와같은가');

// ── --no-tui 와 내용이 같아야 한다 ──────────────────────────────────────
//
// 상자는 입력칸만 바꾸는 것이다. 대화에 나오는 글이 달라지면 그건 두 화면이
// 갈라진 것이고, 그때부터 한쪽은 아무도 안 본 채로 썩는다.
{
  const 명령 = ['/tools', '/memory 같은지 본다'];
  const 상자 = await 띄우기(명령);
  const 줄 = await 띄우기(명령, { 상자: false });

  const 알맹이 = (글) => 글
    .split('\n')
    .map((l) => l.replace(/[╭╰─╮╯│▏]/g, '').trim())
    .filter((l) => l && !/^❯/.test(l))
    .join('\n');

  for (const 말 of ['TodoWrite', 'Recall', 'Remember', '기억했습니다']) {
    check(`두 화면 다 "${말}" 를 보여 준다`, 알맹이(상자.글).includes(말) && 알맹이(줄.글).includes(말),
      `상자 ${알맹이(상자.글).includes(말)} · 줄 ${알맹이(줄.글).includes(말)}`);
  }

  check('줄 모드는 입력 상자를 안 그린다', !/│ ❯ /.test(줄.글), (줄.글.match(/│ ❯ .*/) ?? [''])[0]);
  check('줄 모드도 ❯ 로 입력을 받는다', /❯/.test(줄.글), '');
  check('줄 모드는 딴 화면도 안 쓴다', !/\x1b\[\?1049/.test(줄.날것), '');
}

trace('5-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n입력 상자 띄워 보기  ${D}(터미널인 척해야만 밟히는 자리)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
