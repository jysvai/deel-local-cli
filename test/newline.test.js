// 여러 줄로 한 메시지 보내기 — Alt+Enter 와 줄 끝 백틱.
//
// ── 왜 이 파일이 생겼나 ─────────────────────────────────────────────────
//
// 1.5.0 은 이 둘을 넣고도 **둘 다 망가진 채로** 나갔다. 적대적 리뷰 셋이
// 전부 이 코드를 의심했지만 원인은 셋 다 못 짚었다. 검사가 하나도 없었기
// 때문이다 — 화면에 그려지는 모습만 보면 멀쩡했다.
//
//   · Alt+Enter: rl.line 안에 \n 을 넣었더니 화면은 맞는데 **보낼 때** 값이
//     뒤집혔다. readline 의 history 가 \n 에서 줄을 쪼개 거꾸로 쌓고 \r 로
//     다시 붙여 돌려준다. "안녕\n반가워" 를 쳤는데 모델은 "반가워\r안녕" 을 받았다.
//   · 백틱: 끝이 백틱이기만 하면 이어쓰기로 봐서 "read `a.js`" 같은
//     **평범한 요청**이 안 보내지고 닫는 백틱까지 뜯겼다.
//
// 그래서 여기서 재는 것은 "그려지는 모습" 이 아니라 **보내지는 값**이다.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import { 이어쓰기표시 } from '../src/repl.js';
import { trace } from './trace.mjs';

const 여기 = dirname(fileURLToPath(import.meta.url));
const 뿌리 = dirname(여기);

const pass = [];
const fail = [];
const 적어둘것 = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

/**
 * repl.js 가 터미널에서 하는 일을 그대로 흉내 낸다.
 *
 * 진짜 TTY 가 없으므로 PassThrough 에 isTTY 를 세워 준다. history 는 반드시
 * repl.js 와 같은 200 이어야 한다 — 0 으로 두면 이 파일이 잡으려는 결함이
 * 통째로 사라져 검사가 늘 통과한다.
 */
function 쳐보기(조각들, { 개행을rl에넣기 = false } = {}) {
  const 입력 = new PassThrough();
  입력.isTTY = true;
  입력.setRawMode = () => {};
  const 출력 = new PassThrough();
  출력.isTTY = true;
  출력.columns = 80;
  출력.rows = 40;
  출력.on('data', () => {});

  const rl = readline.createInterface({ input: 입력, output: 출력, terminal: true, historySize: 200 });

  let 쌓인 = null;
  입력.on('keypress', (ch, key) => {
    if (!key || key.name !== 'return' || !key.meta) return;
    if (개행을rl에넣기) {
      // 1.5.0 이 하던 방식. 이 검사는 이것이 **깨진다는 것**을 못 박는다.
      const 앞 = (rl.line ?? '').slice(0, rl.cursor ?? 0);
      const 뒤 = (rl.line ?? '').slice(rl.cursor ?? 0);
      rl.line = `${앞}\n${뒤}`;
      rl.cursor = 앞.length + 1;
      return;
    }
    // 지금 방식: 커서 자리에 줄표를 끼운다. 상자가 그만큼 늘어난다.
    const 글 = rl.line ?? '';
    const 자리 = Math.min(rl.cursor ?? 글.length, 글.length);
    rl.line = 글.slice(0, 자리) + 줄표 + 글.slice(자리);
    rl.cursor = 자리 + 1;
  });

  let 보낼것 = null;
  rl.on('line', (l) => {
    보낼것 = String(l).replaceAll(줄표, '\n');
    쌓인 = null;
  });

  for (const s of 조각들) 입력.write(s);
  rl.close();
  return 보낼것;
}

const ALT = '\x1b\r';   // Alt/Option+Enter — 터미널이 ESC 를 앞에 붙여 보낸다
// 상자 안에서 들고 있는 줄바꿈. repl.js 의 줄표 와 같은 값이어야 한다.
const 줄표 = '\uE000';

trace('1-Alt+Enter가-순서를-지키나');
{
  const 사례 = [
    ['두 줄',      ['안녕', ALT, '반가워', '\r'],            '안녕\n반가워'],
    ['세 줄',      ['a', ALT, 'b', ALT, 'c', '\r'],          'a\nb\nc'],
    ['영문 두 줄',  ['abc', ALT, 'def', '\r'],                'abc\ndef'],
    ['빈 줄 끼움',  ['위', ALT, ALT, '아래', '\r'],            '위\n\n아래'],
    ['개행 없이',   ['그냥 한 줄', '\r'],                      '그냥 한 줄'],
  ];
  for (const [이름, 조각, 기대] of 사례) {
    const 실제 = 쳐보기(조각);
    check(`${이름}: 친 순서 그대로 보낸다`, 실제 === 기대, JSON.stringify(실제));
  }
}

trace('2-예전방식이-왜-안되는지');
{
  /*
   * ── 이 블록은 Node 를 재는 자리다. 통과·실패로 걸지 않는다 ──────────────
   *
   * 처음에는 "예전 방식은 틀렸다" 를 **못 박는** 검사로 뒀다. 그런데 CI 에서
   * 갈렸다:
   *
   *   node 24  →  "안녕\n반가워" 를 보내면 "반가워\r안녕" 이 온다 (뒤집힘)
   *   node 20·22 →  "안녕\n반가워" 가 그대로 온다 (안 뒤집힘)
   *
   * 리눅스·윈도 둘 다 같았으니 OS 가 아니라 **Node 판** 문제다. 여러 줄
   * history 처리가 24 에서 들어오면서 갈렸다.
   *
   * 그러니 이건 우리 코드의 성질이 아니라 **Node 의 성질**이다. Node 의
   * 성질을 통과 조건으로 걸면, 우리가 아무것도 안 고쳐도 남의 판올림에
   * 검사가 빨개진다. 그래서 재기만 하고 적어 둔다.
   *
   * 그럼 "다시 rl.line 에 \n 을 넣는" 퇴행은 무엇이 막나 — 아래 3번이
   * 소스를 직접 본다. 그쪽은 Node 판과 무관하다.
   */
  const 망가진것 = 쳐보기(['안녕', ALT, '반가워', '\r'], { 개행을rl에넣기: true });
  const 뒤집혔나 = 망가진것 !== '안녕\n반가워';
  적어둘것.push(`이 Node(${process.version})에서 rl.line 에 \\n 을 넣으면: `
    + (뒤집혔나 ? `뒤집힌다 → ${JSON.stringify(망가진것)}` : '안 뒤집힌다 (판마다 다르다)'));
  // 어느 쪽이든 안 터지기만 하면 된다. 값이 안 나오면 그건 흉내가 깨진 것이다.
  check('예전 방식을 흉내 내도 검사가 안 터진다', typeof 망가진것 === 'string',
    JSON.stringify(망가진것));
}

trace('2.5-소스가-그-방식으로-안-돌아갔나');
{
  /*
   * ── 퇴행을 막는 진짜 자리 ───────────────────────────────────────────────
   *
   * 위가 Node 판을 타므로, 못 박는 일은 여기서 한다. repl.js 의 Alt+Enter
   * 갈래가 **rl.line 에 개행을 도로 넣는지**를 소스에서 직접 본다. Node 가
   * 무엇을 하든 이 규칙은 그대로다.
   *
   * 왜 규칙이냐면: 어떤 Node 에서는 멀쩡히 돌아서, 넣어 놓고도 한참 모른다.
   * 그러다 판이 올라가는 날 사용자 화면에서 줄 순서가 뒤집힌다 — 1.5.0 이
   * 실제로 그렇게 나갔다.
   *
   * 주석은 떼고 본다. 왜 그러면 안 되는지를 주석에 적으면 그 예시가 규칙에
   * 걸려 빨개진다 — 설명을 적을수록 검사가 화내는 꼴이라 결국 설명을 지운다.
   */
  const 소스 = readFileSync(new URL('../src/repl.js', import.meta.url), 'utf8');
  const 코드만 = 소스.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const 넣는꼴 = /rl\.line\s*=[^;]*\\n/;
  check('repl.js 가 rl.line 에 개행을 안 넣는다', !넣는꼴.test(코드만),
    코드만.split('\n').find((l) => 넣는꼴.test(l))?.trim() ?? '');

  /*
   * 대신 무엇을 넣나 — 줄표다.
   *
   * 이력에게는 평범한 글자 하나라 쪼갤 거리가 없다. 이 글자가 사라지면
   * 상자 안에서 줄이 안 바뀌는 것으로 되돌아간 것이므로 여기서 잡는다.
   */
  check('상자 안 줄바꿈은 줄표로 들고 있는다', /const 줄표 = '\\uE000'/.test(코드만),
    코드만.split('\n').find((l) => /줄표\s*=/.test(l))?.trim() ?? '(없다)');
  check('그리기·보내기 직전에 진짜 개행으로 편다', /replaceAll\(줄표, '\\n'\)/.test(코드만));

  // 줄 끝 백틱으로 쌓아 두는 길도 그대로 살아 있어야 한다.
  check('줄 끝 백틱으로 쌓는 길도 남아 있다', /줄쌓기\s*\(/.test(코드만));
}

trace('3-백틱-표시');
{
  // 보내야 하는 것 — 하나라도 이어쓰기로 잡히면 사람 눈에 Enter 가 안 먹는다.
  const 보낼것들 = [
    'read `config.json`',
    'echo `date`',
    '이 파일 고쳐줘 `a.js`',
    '설명해줘: `npm test`',
    '```',
    '```js',
    'C:\\Users\\me\\',
    '보통 문장',
    '',
  ];
  for (const l of 보낼것들) check(`그냥 보낸다: ${JSON.stringify(l)}`, 이어쓰기표시(l) === false);

  // 이어써야 하는 것
  for (const l of ['안녕 `', '`', '첫째 줄이야  `']) {
    check(`이어쓴다: ${JSON.stringify(l)}`, 이어쓰기표시(l) === true);
  }
}

trace('3.5-일하는-도중에-쳐도-되나');

/*
 * ── 되는 자리와 안 되는 자리가 갈려 있었다 ──────────────────────────────
 *
 * 백틱 이어쓰기는 **입력을 기다리는 동안에만** 먹었다. deel 이 일하는 도중에
 * 미리 쳐 두면(`화면.대기갱신` 으로 가는 갈래) 백틱이 그냥 글자로 나갔다 —
 * 첫 줄이 백틱을 단 채 혼자 보내지고, 다음 줄은 따로 또 보내진다.
 *
 * 사람 눈에는 **줄바꿈이 안 먹는 것**으로 보인다. 게다가 기다릴 때는 되고
 * 일할 때는 안 되니, 어느 쪽이 맞는지도 알기 어렵다. 미리 치는 것은 원래
 * 일하는 중에 하는 짓이라, 오히려 이쪽이 더 흔한 자리다.
 *
 * 여기서는 소스가 두 갈래 모두에서 이어쓰기를 보는지 본다. 진짜 CLI 를
 * 띄워 재는 것은 box.test.js 가 하고, 여기서는 **갈래가 안 갈렸는지**만
 * 못 박는다 — 이 결함은 갈래가 갈려 있던 것 자체였다.
 */
{
  const 소스 = readFileSync(new URL('../src/repl.js', import.meta.url), 'utf8');
  const 줄들 = 소스.split(/\r?\n/);
  /*
   * 미리 치는 갈래가 시작되는 자리부터 그 갈래 안을 본다.
   *
   * 끝을 `화면.대기갱신` 으로 잡으려다 한 번 헛짚었다 — 고친 뒤로 그 줄이
   * 이 갈래에 **둘** 생겨서(이어쓰기 중에 한 번, 보낼 때 한 번), 첫 번째에서
   * 잘려 정작 봐야 할 줄이 창 밖으로 나갔다. 넉넉히 잡고 본다.
   */
  const 대기시작 = 줄들.findIndex((l) => /일하는 도중에 미리 쳐 둔 것/.test(l));
  const 갈래안 = 대기시작 >= 0 ? 줄들.slice(대기시작, 대기시작 + 40).join('\n') : '';

  check('일하는 도중에도 이어쓰기를 본다', /이어쓰기표시\(l\)/.test(갈래안),
    대기시작 < 0 ? '미리 치는 갈래를 못 찾음' : '그 갈래에서 이어쓰기표시 를 안 본다');
  check('일하는 도중에 쌓은 줄도 \\n 으로 잇는다', /이어쓰기줄들, l\]\.join\('\\n'\)/.test(갈래안),
    '쌓아만 두고 안 이어 붙이면 마지막 줄만 나간다');

  /*
   * 쌓는 중이면 빈 줄도 흘려보내면 안 된다. `l.trim()` 만 보고 있으면
   * 이어쓰기 도중의 빈 줄에서 갈래를 빠져나가, 쌓아 둔 것이 통째로 사라진다.
   */
  check('쌓는 중에는 빈 줄도 이 갈래로 온다',
    /else if \(l\.trim\(\) \|\| 이어쓰기줄들 !== null\)/.test(소스));
}

trace('3.7-진짜로-상자-안에서-줄이-바뀌나');

/*
 * ── 소스를 훑는 것만으로는 모자란다 ─────────────────────────────────────
 *
 * 위 검사들은 흉내 낸 readline 을 본다. 그런데 사용자가 겪은 것은 그게
 * 아니었다 — 줄바꿈은 되는데 친 줄이 **상자 밖 위로** 올라가 버려서, 고칠
 * 수도 없고 두 줄이 한눈에 안 보였다. 보내지는 값만 맞으면 통과하는 검사로는
 * 그 차이를 못 잡는다.
 *
 * 그래서 진짜 deel 을 띄우고, 터미널이 Option+Enter 에 보내는 바이트를 그대로
 * 흘려 넣은 다음 **두 가지**를 본다.
 *   · 모델이 받은 값이 "안녕\n반가워" 인가 (뒤집히지 않았나)
 *   · 그 줄이 상자 밖으로 올라갔나 (올라갔으면 예전 그대로다)
 */
{
  const 받은것 = [];
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (String(req.url).endsWith('/models')) return send({ data: [{ id: '스텁모델', object: 'model' }] });
      const j = (() => { try { return JSON.parse(b || '{}'); } catch { return {}; } })();
      const u = (j.messages ?? []).filter((m) => m.role === 'user').at(-1);
      if (u) 받은것.push(String(u.content));
      return send({ id: 'x', object: 'chat.completion', model: '스텁모델',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '네' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 } });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));

  const home = mkdtempSync(join(tmpdir(), 'deel-nl-home-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 's', level: '개발자',
    profiles: [{
      id: 's', name: 's', kind: 'openai', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`,
      auth: 'none', apiKey: '', model: '스텁모델', ctx: 32768, streaming: false, tools: false,
    }],
  }), 'utf8');
  const root = mkdtempSync(join(tmpdir(), 'deel-nl-'));

  // CI 를 빼야 상자 화면이 켜진다 — box.test.js 와 같은 이유다.
  const { CI, ...환경 } = process.env;
  const 앞선것 = join(여기, 'tty-preload.mjs').replace(/\\/g, '/');
  const kid = spawn(process.execPath,
    ['--import', `file:///${앞선것}`, join(뿌리, 'bin', 'deel.js'), '--root', root, '--offline'],
    { cwd: 뿌리, stdio: ['pipe', 'pipe', 'pipe'], env: { ...환경, DEEL_HOME: home } });

  let out = '';
  // 조각 경계에서 한글이 쪼개지면 글자가 깨진다. 스트림에 맡긴다.
  kid.stdout.setEncoding('utf8');
  kid.stderr.setEncoding('utf8');
  kid.stdout.on('data', (d) => { out += d; });
  kid.stderr.on('data', (d) => { out += d; });
  const 자기 = (ms) => new Promise((r) => setTimeout(r, ms));

  /*
   * 시간이 아니라 **조건**을 기다린다 (paste.test.js 와 같은 이유).
   *
   * 전에는 `자기(1600)` 이었다. 혼자 돌리면 넉넉하지만 검사 96개를 함께
   * 돌리면 이 PC 에서 그 안에 deel 이 다 못 뜬다. 그러면 첫 글자가 아직
   * 채비 안 된 입력으로 들어가고, 이 파일만 가끔 빨개진다 — 혼자 돌리면
   * 멀쩡해서 원인 찾기가 제일 나쁜 종류다.
   */
  const 기다리기 = async (뭐, 될때까지, 최대 = 20000) => {
    const 끝 = Date.now() + 최대;
    while (Date.now() < 끝) {
      if (될때까지()) return true;
      await 자기(50);
    }
    check(`${뭐} 를 ${최대}ms 안에 못 봤다`, false, out.slice(-160));
    return false;
  };
  const 조용해지면 = (몇번 = 8) => {
    let 앞길이 = -1; let 그대로 = 0;
    return () => {
      if (out.length === 앞길이) { 그대로 += 1; return 그대로 >= 몇번; }
      앞길이 = out.length; 그대로 = 0; return false;
    };
  };

  /*
   * 무엇을 기다려야 하나 — **입력 자리(❯)가 그려질 때까지**다.
   *
   * 처음에 "화면이 조용해지면" 하나로 잡았다가 헛짚었다. 켜는 도중에도 잠깐씩
   * 조용한 틈이 있어서(인트로가 무언가를 기다리는 사이), 아직 키 처리가
   * 안 걸린 자리에 글자를 밀어 넣었다. 그러면 Option+Enter 가 그냥 글자로
   * 먹혀 "안녕반가워" 가 된다 — 이 파일이 잡으려는 결함과 **똑같은 증상**이라,
   * 원인을 코드 쪽으로 오해하기 딱 좋다.
   *
   * ❯ 는 입력 상자를 그릴 때 나온다. 그게 보였으면 키를 받을 채비가 끝난 것이다.
   */
  const 민것 = () => out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  await 기다리기('입력 자리(❯)가 그려지기', () => 민것().includes('❯'));
  await 기다리기('그리기가 끝나기', 조용해지면());

  /*
   * 조건으로 기다리는 것은 **켤 때와 보낸 뒤**뿐이다.
   *
   * 사이의 한 글자 한 글자는 그대로 짧게 잔다. 여기는 흔들린 적이 없고,
   * 무엇보다 상자는 글자를 칠 때마다 다시 그리지 않는다 — '안녕' 을 쳐도
   * 다음 판이 올 때까지 화면에는 안 나온다. 그걸 신호로 삼으면 있지도 않은
   * 것을 20초 기다리게 된다(실제로 그렇게 한 번 헛짚었다).
   */
  kid.stdin.write('안녕');
  await 자기(250);
  const 켠뒤 = out.length;          // 여기서부터가 줄바꿈을 누른 뒤 화면이다
  kid.stdin.write(ALT);             // Option+Enter
  await 자기(350);
  kid.stdin.write('반가워');
  await 자기(400);
  const 보내기전 = out;             // Enter 를 치기 바로 전 화면
  kid.stdin.write('\n');            // 사람이 Enter 를 친다
  await 기다리기('두 줄이 모델까지 가기', () => 받은것.length >= 1);
  await 기다리기('답이 화면에 되비치기', 조용해지면());
  kid.stdin.write('/exit\n');
  await Promise.race([new Promise((r) => kid.on('close', r)), 자기(7000).then(() => kid.kill())]);
  srv.close();

  check('두 줄이 한 번에 한 덩이로 간다', 받은것.length === 1,
    `${받은것.length}번 갔다: ${받은것.map((m) => JSON.stringify(m)).join(' · ')}`);
  check('친 순서 그대로 간다', 받은것[0] === '안녕\n반가워', JSON.stringify(받은것[0] ?? '(안 옴)'));
  // 줄표가 새어 나가면 모델이 뜻 없는 사용자 영역 글자를 요청으로 읽는다.
  check('줄표가 모델에게 안 샌다', !String(받은것[0] ?? '').includes(줄표), JSON.stringify(받은것[0] ?? ''));

  /*
   * 상자 밖으로 올라갔나.
   *
   * 예전 방식은 줄을 확정해 찍으면서 "… 다음 줄. 그냥 Enter 로 보냅니다" 를
   * 같이 남겼다. 그 안내가 다시 보이면 예전 방식으로 되돌아간 것이다.
   */
  const 누른뒤 = out.slice(켠뒤).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  check('친 줄을 상자 밖으로 올리지 않는다', !/다음 줄\. 그냥 Enter/.test(누른뒤),
    누른뒤.split('\n').find((l) => /다음 줄/.test(l))?.trim() ?? '');
  /*
   * 두 줄이 **한 상자 안에** 같이 있나.
   *
   * 그냥 두 말이 화면 어딘가에 보이는 것으로는 모자란다 — 예전 방식도 둘 다
   * 보였다(하나는 상자 밖, 하나는 상자 안). 양쪽 테두리(│) 안에 이어진 두
   * 줄로 들어 있어야 상자가 실제로 두 줄로 늘어난 것이다.
   */
  const 보내기전화면 = 보내기전.slice(켠뒤).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  const 상자줄들 = 보내기전화면.split('\n').filter((l) => /│.*│/.test(l));
  /*
   * 두 줄이 나란히 붙어 있는지로 보면 안 된다. 상자는 **바뀐 줄만** 다시
   * 보내므로(inputbox 의 그리기), 마지막 판에는 고쳐 그린 줄 하나만 나간다.
   *
   * 대신 표를 본다. 상자 안 첫 줄만 ❯ 를 달고 이어지는 줄은 안 단다. 그러니
   * **테두리 안에 ❯ 없이 들여쓴 「반가워」** 가 곧 "같은 상자의 둘째 줄" 이다.
   * 예전 방식이면 반가워 는 새 상자의 첫 줄이라 ❯ 를 달고 나온다.
   */
  const 첫줄있나 = 상자줄들.some((l) => /│\s*❯\s*안녕\s*│/.test(l));
  const 둘째줄있나 = 상자줄들.some((l) => /│\s+반가워\s*│/.test(l) && !l.includes('❯'));
  check('둘째 줄이 같은 상자 안에 들어간다', 첫줄있나 && 둘째줄있나,
    JSON.stringify(상자줄들.slice(-4)));

  rmSync(home, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}

trace('4-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n여러 줄 보내기  ${D}(그려지는 모습이 아니라 보내지는 값을 잰다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
if (적어둘것.length) { console.log(''); for (const l of 적어둘것) console.log(`  ${D}· ${l}${X}`); }
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
