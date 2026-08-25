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
import { createServer } from 'node:http';
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
    // 상자 안엣것만으로는 못 재는 것이 있다 — Shift+Tab 이 대화에 남기는
    // 한 줄 같은 것. 그 단계에 화면으로 나간 것도 같이 돌려준다.
    const 찍힌것 = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
    결과.push({ ...단계, 본것, 찍힌것, 맞나: 본것 === 단계.기대 });
  }

  if (!끝남) { try { kid.stdin.write('\n/exit\n'); } catch {} }
  await Promise.race([닫힘, 자기(2500)]);
  if (!끝남) { kid.kill(); await Promise.race([닫힘, 자기(1500)]); }
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  return 결과;
}

/**
 * 진짜 한 턴을 돌린다 — 도구를 두 번 부르고 파일을 고치고 답까지.
 *
 * 스텁 모델을 세워 놓고, 답하기 전에 잠깐 뜸을 들이게 한다. 그래야 '일하는
 * 중' 표시가 실제로 화면에 뜨는 구간이 생긴다 — 즉시 답하면 그 구간이 없다.
 */
async function 한턴돌리기() {
  const root = mkdtempSync(join(tmpdir(), 'deel-turn-'));
  const home = mkdtempSync(join(tmpdir(), 'deel-turn-home-'));
  writeFileSync(join(root, '집계.py'), 'def total(xs):\n    s = 0\n    for x in xs:\n        s += x\n    return s\n', 'utf8');

  let 차례 = 0;
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (chunk) => { b += chunk; });
    req.on('end', () => setTimeout(() => {
      const 통 = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (!req.url.startsWith('/v1/chat')) return 통({ data: [] });
      차례 += 1;
      if (차례 === 1) return 통({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: '집계.py' }) } }] } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
      if (차례 === 2) return 통({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 't2', type: 'function', function: { name: 'Edit', arguments: JSON.stringify({ file_path: '집계.py', old_string: '    s = 0\n    for x in xs:\n        s += x\n    return s', new_string: '    return sum(xs)' }) } }] } }], usage: { prompt_tokens: 200, completion_tokens: 30 } });
      return 통({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '합계를 sum 으로 줄였습니다.' } }], usage: { prompt_tokens: 300, completion_tokens: 40 } });
    }, 900));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 'stub', level: '개발자',
    profiles: [{
      id: 'stub', name: '스텁', kind: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`,
      auth: 'none', apiKey: '', model: '스텁모델', ctx: 32768, streaming: false, tools: true,
    }],
  }), 'utf8');

  const kid = spawn(process.execPath, [
    '--import', `file:///${앞선것.replace(/\\/g, '/')}`,
    join(뿌리, 'bin', 'deel.js'), '--root', root, '--ctx', '32768',
  ], { cwd: 뿌리, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DEEL_HOME: home, FORCE_COLOR: '1' } });

  let out = '';
  kid.stdout.on('data', (b) => { out += b; });
  kid.stderr.on('data', (b) => { out += b; });
  let 끝남 = false;
  const 닫힘 = new Promise((r) => kid.on('close', () => { 끝남 = true; r(); }));
  const 자기 = (ms) => new Promise((r) => setTimeout(r, ms));

  await 자기(1800);
  kid.stdin.write('집계 함수 좀 줄여줘\n');
  await 자기(6000);
  if (!끝남) { try { kid.stdin.write('/exit\n'); } catch {} }
  await Promise.race([닫힘, 자기(2500)]);
  if (!끝남) { kid.kill(); await Promise.race([닫힘, 자기(1500)]); }
  srv.close();

  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  return { 날것: out, 글: out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '') };
}

trace('2-슬래시가보이는가');

// ── 여기가 이 파일의 존재 이유다 ────────────────────────────────────────
{
  const r = await 띄우기(['/help', '/tools', '/memory 검사용 한 줄입니다', '/memory']);

  // 켤 때 나오는 머리말도 테두리를 쓴다. 그러니 테두리만 보면 안 되고,
  // **테두리 안에 ❯ 가 있는 줄**을 봐야 입력 상자를 본 것이다.
  check('상자 모드로 켜졌다', /│ ❯ /.test(r.글), (r.글.match(/│ ❯ .*/) ?? [''])[0].slice(0, 40));
  /*
   * 아래 넷은 **거르는 검사이지 증명이 아니다.**
   *
   * 여기 적어 두는 이유가 있다. 이 검사를 처음 썼을 때 "슬래시 결과가 화면에
   * 남는다" 를 보면 그 결함을 잡는다고 생각했는데, npm 에 올라간 깨진 판으로
   * 돌려 보니 **그것도 통과했다.** 파이프에는 덮어쓰기가 없기 때문이다 —
   * 명령이 찍은 글도, 그것을 덮는 다시그리기도 둘 다 그냥 쌓인다.
   * 사람 화면에서는 덮이고, 파이프에서는 안 덮인다.
   *
   * 그러니 이 넷은 '명령이 아예 안 돌았다' 만 잡는다. 그것도 잡아야 하니 둔다.
   */
  check('/help 결과가 나온다', /명령 목록/.test(r.글), '');
  check('/tools 결과가 나온다', /TodoWrite/.test(r.글), '');
  check('/memory 적기가 나온다', /기억했습니다/.test(r.글), '');
  check('/memory 목록이 나온다', /검사용 한 줄입니다/.test(r.글), '');
  check('내가 친 명령이 대화에 남는다', /❯ \/help/.test(r.글), '');

  /*
   * ── 실제로 잡는 것은 여기다 ──────────────────────────────────────────
   *
   * 덮어쓰기를 파이프에서 볼 수 없다면, **덮어쓸 수 있는 도구를 안 쓰는지**
   * 를 보면 된다. 대화를 지우고 다시 그리려면 셋 중 하나가 반드시 필요하다:
   *
   *   \x1b[?1049  딴 화면(대체 버퍼)으로 간다
   *   \x1b[2J     화면을 통째로 지운다
   *   \x1b[H·\x1b[r;cH  커서를 절대 좌표로 옮긴다 — 이미 찍힌 줄 위로 간다
   *
   * 상자는 셋 다 안 쓴다. 커서를 **상대로만**(위로 n줄) 옮기고, 그 줄만
   * 지운다. 그래서 위쪽 대화를 건드릴 수가 없다 — 구조로 막힌 것이지
   * 조심해서 막는 것이 아니다.
   *
   * 숫자로 견주면 이렇다 (둘 다 /help 한 번):
   *   깨진 1.0.0   ?1049 1회 · 2J 1회 · 절대이동 161회 · 상대이동 0회
   *   고친 것      ?1049 0회 · 2J 0회 · 절대이동   0회 · 상대이동 9회
   */
  check('딴 화면을 안 쓴다', !/\x1b\[\?1049/.test(r.날것), '');
  check('화면을 통째로 안 지운다', !/\x1b\[2J/.test(r.날것), '');
  check('커서를 절대 좌표로 안 옮긴다 — 위쪽 대화를 덮을 수 없다',
    !/\x1b\[\d*;?\d*H/.test(r.날것),
    (r.날것.match(/\x1b\[\d*;?\d*H/g) ?? []).length + '회');

  // 그러면서도 상자는 제대로 지워야 한다. 안 지우면 겹겹이 쌓인다.
  check('상자를 지우는 제어문자가 나간다', /\x1b\[K/.test(r.날것), '');
  check('커서를 상대로만 되돌린다', /\x1b\[\d*A/.test(r.날것), '');
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

trace('3.2-탭과승인모드');

// ── Tab · Shift+Tab · Ctrl+O ────────────────────────────────────────────
//
// 값으로 재는 것(tui.test.js)과 여기서 재는 것은 다르다. 저기서는 "무엇을
// 채울지" 를 재고, 여기서는 **터미널이 보낸 바이트가 실제로 그 자리까지
// 닿는가** 를 잰다. 그 사이에 readline 이 있어서, 완성기를 잘못 달면
//
//   · Tab 이 줄에 리터럴 탭(`\t`)을 박아 넣고
//   · Shift+Tab 이 그 완성기를 거꾸로 돌려 빈 줄에 `/` 를 밀어 넣는다
//
// 둘 다 실제로 겪은 것이고, 둘 다 값으로는 안 잡힌다.
{
  const TAB = '\t';
  const SHIFTTAB = '\x1b[Z';
  const CTRLO = '\x0f';
  const 지움 = '\x15';                 // Ctrl+U — 줄 통째로

  const r = await 키눌러보기([
    { 이름: '슬래시 명령을 치다 만다', 키: ['/', 'h', 'e', 'l'], 기대: '/hel' },
    { 이름: 'Tab 이 나머지를 채운다', 키: [TAB], 기대: '/help' },
    { 이름: '지우고 갈리는 것을 친다', 키: [지움, '/', 'm', 'o'], 기대: '/mo' },
    // /mode·/model 이 남아 있다. 하나를 골라 박으면 지우는 수고가 더 든다.
    { 이름: '여럿이면 같은 데까지만 채운다', 키: [TAB], 기대: '/mode' },
    { 이름: '더 눌러도 멋대로 안 고른다', 키: [TAB], 기대: '/mode' },
    { 이름: '빈 줄에서 Tab 은 아무 일도 안 한다', 키: [지움, TAB], 기대: '' },
    { 이름: '한글 뒤에서 Tab 을 눌러도 안 깨진다', 키: ['가', '나', TAB], 기대: '가나' },
    // 여기가 핵심이다 — Shift+Tab 이 줄을 건드리면 안 된다. 진짜 완성기를
    // 달면 readline 이 그것을 **거꾸로** 돌려서, 치던 슬래시 명령이 엉뚱한
    // 것으로 바뀐다. 승인 방식만 바뀌어야지 글이 바뀌면 안 된다.
    { 이름: '치던 명령이 있어도 Shift+Tab 이 안 바꾼다', 키: [지움, '/', 'm', 'o', SHIFTTAB], 기대: '/mo' },
    { 이름: '빈 줄에서 Shift+Tab 은 줄을 안 건드린다', 키: [지움, SHIFTTAB], 기대: '' },
    { 이름: '치던 글이 있어도 Shift+Tab 이 안 지운다', 키: ['집계 줄여줘', SHIFTTAB], 기대: '집계 줄여줘' },
    { 이름: 'Ctrl+O 도 치던 글을 안 지운다', 키: [CTRLO], 기대: '집계 줄여줘' },
  ]);

  for (const x of r) {
    check(x.이름, x.맞나, x.맞나 ? '' : `본 것 ${JSON.stringify(x.본것)} · 바란 것 ${JSON.stringify(x.기대)}`);
  }

  // 리터럴 탭이 줄에 박히면 안 된다. 그러면 `/help\t` 가 모델에게 간다.
  check('Tab 이 탭 문자를 안 남긴다', !r.some((x) => x.본것.includes('\t')),
    JSON.stringify(r.map((x) => x.본것).join('|')));

  // 추천 목록이 실제로 화면에 떴는가.
  const 첫단계 = r[0].찍힌것;
  check('치는 중에 추천 목록이 뜬다', /›\s+\/help/.test(첫단계),
    (첫단계.match(/›.*/) ?? [''])[0].slice(0, 60));
  check('설명도 같이 보여 준다', /\/help\s+명령 목록/.test(첫단계),
    (첫단계.match(/\/help.*/) ?? [''])[0].slice(0, 60));
  check('목록은 상자 아래에 붙는다', 첫단계.indexOf('╰') < 첫단계.lastIndexOf('› /help'),
    `╰@${첫단계.indexOf('╰')} 목록@${첫단계.lastIndexOf('› /help')}`);

  // Shift+Tab 은 승인 방식을 돈다 — 작업 모드가 아니다.
  // **첫 번째** 누름을 본다. 뒤엣것을 보면 어디서 어디로 갔는지가 달라진다.
  const 시프트탭 = r.find((x) => x.이름.startsWith('치던 명령이 있어도')).찍힌것;
  check('Shift+Tab 이 승인 방식을 바꾼다', /위험만 확인/.test(시프트탭),
    (시프트탭.match(/.*확인.*/) ?? [''])[0].trim().slice(0, 60));
  check('무엇에서 무엇으로 갔는지 말한다', /자동 승인 → 위험만 확인/.test(시프트탭), '');
  check('무슨 뜻인지도 한 줄로 말한다', /되돌릴 수 없는 명령만/.test(시프트탭), '');
  // 안내 한 줄만 찍고 상태줄이 안 따라오면, 스크롤을 올려야 지금 상태를 안다.
  check('상태줄에도 바로 반영된다', /▏[^\n]*⏵ 위험만 확인/.test(시프트탭),
    (시프트탭.match(/▏[^\n]*(?:자동 승인|위험만 확인|모두 확인)/g) ?? []).map((s) => s.slice(-12)).join(' → '));
  check('Shift+Tab 은 작업 모드를 안 건드린다', !/코드 \(Code\)/.test(시프트탭), '');

  // Ctrl+O 는 작업 모드를 돈다.
  const 컨트롤오 = r.at(-1).찍힌것;
  check('Ctrl+O 가 작업 모드를 바꾼다', /코드 \(Code\)|고치고 만든다/.test(컨트롤오),
    (컨트롤오.match(/.*Code.*/) ?? [''])[0].trim().slice(0, 60));
}

trace('3.5-일하는동안상자가살아있는가');

// ── 작업 중에 화면 아래가 비면 안 된다 ──────────────────────────────────
//
// 이 검사가 잡으려는 것: 첫 도구 결과가 찍히는 순간 상자가 사라지고, 일이
// 끝날 때까지 화면 아래가 텅 빈 채로 남는 것. 로컬 모델은 한 걸음에 수십
// 초가 걸리므로 그 동안 사람은 멈춘 줄 알고 Ctrl+C 를 누른다.
{
  const r = await 한턴돌리기();

  check('일하는 중 상자가 뜬다', /│ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] /.test(r.글),
    (r.글.match(/│ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] .*/) ?? [''])[0].slice(0, 50));
  check('중단하는 법을 같이 알려 준다', /Ctrl\+C 중단/.test(r.글), '');
  check('걸린 시간이 뜬다', /│ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] [^│]*\d+초/.test(r.글), '');

  /*
   * 문구가 **지금 하는 일**을 따라가는가.
   *
   * 아무 말이나 돌려 대면 두 번째부터 아무도 안 읽고, 그때부터는 화면이
   * 조용한 것과 같아진다. 이 턴은 Read → Edit → 답 순서로 도니 문구도
   * 그 순서로 바뀌어야 한다.
   */
  const 말들 = [...new Set([...r.글.matchAll(/│ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] ([^…│]+)…/g)].map((m) => m[1].trim()))];
  check('생각하는 중이라고 한다', 말들.some((t) => /머리|궁리|수 읽|따져|생각/.test(t)), 말들.join(' → '));
  check('파일을 읽을 때 읽는다고 한다', 말들.some((t) => /들여다|훑|뒤지|단서/.test(t)), 말들.join(' → '));
  check('고칠 때 고친다고 한다', 말들.some((t) => /짜는|고쳐|손보|옮기/.test(t)), 말들.join(' → '));
  check('답할 때 답한다고 한다', 말들.some((t) => /답 쓰|정리해서/.test(t)), 말들.join(' → '));
  check('문구가 하나로 안 굳는다', 말들.length >= 3, 말들.join(' → '));

  // 도구 결과가 찍힌 **뒤에도** 상자가 다시 서야 한다. 이게 없으면
  // 첫 결과부터 화면 아래가 빈다 — 정확히 '밋밋해 보인다' 는 그 상태다.
  const 결과뒤 = r.글.slice(r.글.indexOf('└ '));
  check('도구 결과 뒤에도 상자가 다시 선다', /╭/.test(결과뒤) && /│ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(결과뒤),
    결과뒤.split('\n').slice(1, 4).join(' / ').slice(0, 90));

  // 일이 끝나면 반드시 걷어야 한다. 안 걷으면 돌아가는 표시가 붙박이로 남는다.
  const 끝난뒤 = r.글.slice(r.글.lastIndexOf('끝냅니다'));
  check('끝나면 돌아가는 표시가 안 남는다', !/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(끝난뒤), 끝난뒤.trim().slice(0, 60));

  // 승인 방식이 늘 보여야 한다. 내 파일이 물어보고 바뀌는지 아닌지다.
  check('상태줄에 승인 방식이 사람 말로 뜬다', /⏵⏵ 자동/.test(r.글),
    (r.글.match(/▏[^\n]*자동[^\n]*/) ?? [''])[0].slice(0, 70));
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
