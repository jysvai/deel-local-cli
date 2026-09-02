// 붙여넣기와 ESC — 여러 줄을 붙이면 한 덩이인가, ESC 가 멈추기만 하는가.
//
// ── 무슨 일이 났었나 ────────────────────────────────────────────────────
//
// 「줄 이어진 거 복사해서 넣으면 각각 한 줄씩 프롬프트 입력되어서 괜히
//  과다하게 된다」
//
// 터미널은 붙여넣기를 그냥 **타자로** 흘려보낸다. 줄바꿈마다 readline 이
// 'line' 을 하나씩 쏘므로, 스무 줄을 붙이면 **스무 번 물어본 것**이 된다.
// 한 덩이로 보내려던 글이 스무 조각으로 쪼개지고, 요청도 스무 번 나간다.
// 느린 로컬 모델에서는 이게 몇 분이다.
//
// 그리고:
//
// 「ESC 누르면 중간에 대화를 멈추게 해줘. Ctrl+Z 하니까 대화 자체를 꺼버려서」
//
// 멈추는 길이 Ctrl+C 뿐이었는데, 그건 **한 번 더 누르면 프로그램을 끝낸다.**
// 급히 멈추려고 두 번 누르면 대화가 통째로 닫힌다.
//
// ── 여기서 무엇을 지키나 ────────────────────────────────────────────────
//
//   1. 붙여넣기 표(`\x1b[200~`…`\x1b[201~`) 안의 줄바꿈은 **안 보낸다.**
//      쌓아 두었다가 사람이 Enter 를 칠 때 한 덩이로 나간다.
//   2. 표를 안 보내는 터미널에서는 **예전 그대로** 돈다. 못 알아듣는 터미널이
//      있어서, 거기서 깨지면 고친 것이 아니라 옮긴 것이다.
//   3. ESC 는 도는 것을 멈추기만 하고 **끝내지 않는다.**
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 여기 = dirname(fileURLToPath(import.meta.url));
const 뿌리 = dirname(여기);
const 소스 = readFileSync(new URL('../src/repl.js', import.meta.url), 'utf8');

trace('1-붙여넣기-표를-켜나');

{
  // 표를 안 켜면 터미널이 붙여넣기를 감싸 주지 않는다 — 아무것도 안 달라진다.
  check('bracketed paste 를 켠다', /\\x1b\[\?2004h/.test(소스));
  // 끄고 나가지 않으면 deel 을 끝낸 뒤 그 터미널의 셸이 붙여넣기 표를 계속
  // 받는다. 우리가 켠 것은 우리가 끈다.
  check('나갈 때 다시 끈다', /\\x1b\[\?2004l/.test(소스));
  check('끄는 것을 exit 에 걸어 둔다', /process\.on\('exit',[\s\S]{0,160}?2004l/.test(소스));
}

trace('2-표-안의-줄을-안-보내나');

{
  check('시작 표를 알아본다', /'\\x1b\[200~'/.test(소스));
  check('끝 표를 알아본다', /'\\x1b\[201~'/.test(소스));

  /*
   * 여기가 핵심이다. 붙이는 도중의 'line' 은 **보내면 안 된다.**
   * 쌓아 두는 자리는 줄 끝 백틱이 쓰는 것과 같아야 한다 — 따로 만들면
   * 둘 중 하나를 고칠 때 다른 하나가 조용히 어긋난다.
   */
  const 줄들 = 소스.split(/\r?\n/);
  const 자리 = 줄들.findIndex((l) => /if \(붙여넣는중\)/.test(l));
  check('붙이는 도중의 줄은 보내지 않고 쌓는다',
    자리 >= 0 && /이어쓰기줄들 \?\?= \[\]\)\.push\(l\); return;/.test(줄들[자리]),
    자리 < 0 ? '그 갈래가 없다' : 줄들[자리].trim());

  // 쌓기만 하고 잇는 코드가 없으면 마지막 줄만 나간다.
  check('쌓은 것을 \\n 으로 이어 보낸다', /이어쓰기줄들, l\]\.join\('\\n'\)/.test(소스));
}

trace('3-못-알아듣는-터미널');

/*
 * 표를 안 보내는 터미널에서는 붙여넣는중 이 끝까지 false 다. 그러면 예전
 * 그대로 줄마다 보내진다 — 나빠지는 것은 없다. 그 사실을 코드로 못 박는다:
 * 붙여넣는중 은 **표를 받았을 때만** 켜져야 한다.
 */
{
  const 켜는자리 = 소스.match(/붙여넣는중 = true/g) ?? [];
  check('표를 받았을 때만 켜진다', 켜는자리.length === 1, `${켜는자리.length}군데에서 켠다`);
  /*
   * 켜는 줄이 시작 표를 본 갈래 안에 있어야 한다.
   *
   * 예전에는 한 줄짜리라 그 줄만 봤는데, 접기(pastechip)가 붙으면서 갈래가
   * 여러 줄이 됐다. 재려는 것은 줄 모양이 아니라 **어느 갈래에서 켜지나**
   * 이므로, 켜는 줄 바로 위 몇 줄 안에 시작 표가 있는지로 본다.
   */
  const 줄목록 = 소스.split(/\r?\n/);
  const 켜는데 = 줄목록.findIndex((l) => /붙여넣는중 = true/.test(l));
  const 켜는둘레 = 켜는데 >= 0 ? 줄목록.slice(Math.max(0, 켜는데 - 2), 켜는데 + 1).join('\n') : '';
  check('켜는 자리가 시작 표다', /\\x1b\[200~/.test(켜는둘레), 켜는둘레.trim().slice(0, 80));

  // 시작 없이 끝 표만 와도 안 엉켜야 한다 — 켜진 적이 없으니 끄는 것이 무해하다.
  // 선언(let 붙여넣는중 = false)은 빼고 센다 — 그건 끄는 자리가 아니다.
  const 끄는자리 = 소스.match(/(?<!let )붙여넣는중 = false/g) ?? [];
  check('끄는 자리도 한 군데다', 끄는자리.length === 1, `${끄는자리.length}군데`);
}

trace('4-ESC');

{
  const 줄들 = 소스.split(/\r?\n/);
  const 자리 = 줄들.findIndex((l) => /key\?\.name === 'escape'/.test(l));
  check('ESC 를 본다', 자리 >= 0);

  const 갈래 = 자리 >= 0 ? 줄들.slice(자리, 자리 + 4).join('\n') : '';
  check('ESC 는 도는 턴을 멈춘다', /turn\.abort\(\)/.test(갈래), 갈래.trim().slice(0, 80));

  /*
   * 멈추기만 해야 한다. 여기서 rl.close() 를 부르면 Ctrl+C 두 번과 같아져서,
   * 사용자가 피하려던 바로 그 일(대화가 통째로 닫힘)이 그대로 난다.
   */
  check('ESC 로는 안 끝난다', !/rl\.close\(\)/.test(갈래), 갈래.trim().slice(0, 80));

  // 도는 중이 아닐 때 치던 글을 지우면 안 된다 — 그게 더 놀랍다.
  check('입력칸을 안 건드린다', !/rl\.line\s*=/.test(갈래), 갈래.trim().slice(0, 80));

  // 조합키가 섞인 ESC(다른 키의 앞머리)를 멈춤으로 읽으면 안 된다.
  check('맨 ESC 일 때만 본다', /!key\.ctrl && !key\.meta && !key\.shift/.test(줄들[자리] ?? ''),
    줄들[자리]?.trim() ?? '');
}

trace('5-켜자마자-눌러도-안-죽나');

/*
 * 키 처리는 인트로를 기다리는 await **앞에서** 걸린다. 그래서 turn 을 그
 * await 뒤에 선언해 두면, 인트로가 도는 동안 아무 키나 누르는 순간 아직
 * 만들어지지 않은 이름을 읽어 터진다(TDZ). 켜자마자 키를 누르면 죽는
 * 프로그램이 되는 셈이라, 선언이 **앞**에 있어야 한다.
 */
{
  const 줄들 = 소스.split(/\r?\n/);
  const 선언 = 줄들.findIndex((l) => /^\s*let turn = null;/.test(l));
  const 키처리 = 줄들.findIndex((l) => /process\.stdin\.on\('keypress'/.test(l));
  check('turn 선언이 키 처리보다 앞이다', 선언 >= 0 && 키처리 >= 0 && 선언 < 키처리,
    `선언 ${선언}줄 · 키 처리 ${키처리}줄`);

  const 붙임 = 줄들.findIndex((l) => /^\s*let 붙여넣는중 = false;/.test(l));
  check('붙여넣는중 선언도 앞이다', 붙임 >= 0 && 붙임 < 키처리, `선언 ${붙임}줄`);

  // 'line' 처리도 이 값을 본다. 키 처리 안에만 있으면 거기서 안 보인다.
  const 라인 = 줄들.findIndex((l) => /rl\.on\('line'/.test(l));
  check('line 처리에서도 보이는 자리다', 붙임 >= 0 && 붙임 < 라인, `line ${라인}줄`);
}

trace('6-진짜로-한-덩이로-가나');

/*
 * ── 소스를 훑는 것만으로는 모자란다 ─────────────────────────────────────
 *
 * 위 검사들은 "그렇게 적혀 있나" 를 본다. 그런데 이 결함이 잡으려는 것은
 * **모델에게 몇 번 갔나** 이고, 그건 진짜 deel 을 띄워 봐야만 알 수 있다.
 *
 * 파이프로는 못 잰다 — 키 처리 자체가 터미널일 때만 걸리기 때문이다. 그래서
 * tty-preload.mjs 로 터미널인 척하고, 터미널이 붙여넣기를 감쌀 때 실제로
 * 보내는 바이트를 그대로 흘려 넣는다.
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

  const home = mkdtempSync(join(tmpdir(), 'deel-paste-home-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 's', level: '개발자',
    profiles: [{
      id: 's', name: 's', kind: 'openai', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`,
      auth: 'none', apiKey: '', model: '스텁모델', ctx: 32768, streaming: false, tools: false,
    }],
  }), 'utf8');
  const root = mkdtempSync(join(tmpdir(), 'deel-paste-'));

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
   * 시간이 아니라 **조건**을 기다린다.
   *
   * 전에는 `자기(1600)` 이었다. 혼자 돌리면 넉넉하지만, 검사 90여 개를 함께
   * 돌리면 이 PC 에서 그 1.6초 안에 deel 이 다 못 뜬다. 그러면 붙여넣기
   * 바이트가 아직 준비 안 된 입력으로 들어가 조각나고, 이 파일만 가끔
   * 빨개졌다 — 혼자 돌리면 멀쩡해서 원인을 찾기가 제일 나쁜 종류다.
   *
   * 무엇을 기다리나: deel 이 켜지면서 터미널에 「붙여넣기 표를 켜라」
   * (\x1b[?2004h) 를 보낸다. 그게 왔으면 받을 준비가 끝난 것이다.
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

  /*
   * 표를 켠 것만으로는 이르다.
   *
   * deel 은 켜지자마자 \x1b[?2004h 를 보내지만, 그 뒤로도 인사말·머리말·
   * 입력 상자를 그린다. 그 사이에 붙여넣기 바이트를 밀어 넣으면 아직 키를
   * 받을 채비가 안 된 자리로 들어가 조각난다.
   *
   * 그래서 표가 켜진 **뒤에 화면이 조용해질 때까지** 기다린다. 그릴 것이
   * 남아 있으면 계속 뭔가 나오고, 다 그렸으면 뚝 끊긴다. 시간을 못 박는 것과
   * 달리 이 방법은 느린 PC 에서도 알아서 맞는다.
   */
  await 기다리기('붙여넣기 표 켜기', () => out.includes('\x1b[?2004h'));
  // ❯ 가 보이면 입력 상자가 그려진 것이다 — 키를 받을 채비가 끝났다는 뜻.
  // 켜는 도중에도 잠깐 조용한 틈이 있어서, 조용해지는 것만으로는 이르다
  // (newline.test.js 에서 그 틈에 걸려 한 번 헛짚었다).
  await 기다리기('입력 자리(❯)가 그려지기',
    () => out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').includes('❯'));
  await 기다리기('화면이 다 그려지기', (() => {
    let 앞길이 = -1; let 그대로인때 = 0;
    return () => {
      if (out.length === 앞길이) { 그대로인때 += 1; return 그대로인때 >= 8; }   // 50ms × 8 = 400ms
      앞길이 = out.length; 그대로인때 = 0; return false;
    };
  })());
  // 터미널이 붙여넣기를 감쌀 때 보내는 바이트 그대로.
  kid.stdin.write('\x1b[200~첫째 줄\n둘째 줄\n셋째 줄\x1b[201~');
  await 자기(500);
  kid.stdin.write('\n');                 // 사람이 Enter 를 친다
  // 모델까지 간 것만으로는 이르다. 화면에 되비치는 것은 그 다음 걸음이라,
  // 여기서 끊으면 아래 「화면에 남는다」 검사가 빈 화면을 보게 된다.
  const 민화면 = () => out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  await 기다리기('붙인 글이 모델까지 가기', () => 받은것.length >= 1);
  await 기다리기('붙인 글이 화면에 되비치기', () => /셋째 줄/.test(민화면()));
  kid.stdin.write('/exit\n');
  await Promise.race([new Promise((r) => kid.on('close', r)), 자기(7000).then(() => kid.kill())]);
  srv.close();

  /*
   * 여기가 이 파일이 있는 이유다. 세 줄을 붙였으면 **한 번** 가야 한다.
   * 세 번 가면 사용자가 겪은 그대로다 — 한 덩이로 보내려던 글이 조각나고,
   * 요청도 그만큼 나간다.
   */
  check('세 줄을 붙여도 한 번만 간다', 받은것.length === 1,
    `${받은것.length}번 갔다: ${받은것.map((m) => JSON.stringify(m.slice(0, 20))).join(' · ')}`);
  check('줄바꿈이 살아서 한 덩이로 간다', 받은것[0] === '첫째 줄\n둘째 줄\n셋째 줄',
    JSON.stringify(받은것[0] ?? '(안 옴)'));
  // 표가 글에 섞이면 모델이 제어문자를 요청으로 읽는다.
  check('붙여넣기 표가 글에 안 섞인다', !/\x1b\[20[01]~/.test(받은것[0] ?? ''),
    JSON.stringify(받은것[0] ?? ''));

  const 화면 = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');

  /*
   * ── 보낸 것이 화면에도 그대로 남나 ──────────────────────────────────
   *
   * 「복사하면 왜 뒷부분은 사라지고 앞부분만 나와?」
   *
   * 보낸 값은 멀쩡했다(위에서 확인했다). 화면에 남는 것이 틀렸다 — 보낼 때
   * 찍는 것이 **마지막 줄**뿐이었다. 앞줄들은 쌓아 두었다가 이어 붙이는데,
   * 붙여넣기는 쌓는 동안 일부러 안 찍기 때문이다(스무 줄이 주르륵 지나가지
   * 않게). 그래서 세 줄을 붙이면 화면에는 셋째 줄만 남았고, 사람은 앞부분이
   * 안 갔다고 생각하고 다시 붙여넣었다.
   *
   * 보낸 값만 재는 검사로는 이걸 못 잡는다. 화면을 따로 봐야 한다.
   *
   * 지금은 붙인 덩이를 **상자에서만** 표로 접는다(pastechip.js). 상자는
   * readline 의 rl.line 이라 여러 줄을 아예 못 그리기 때문이다. 대화에 남길
   * 때는 도로 편다 — 여기 세 줄이 그대로 있어야 한다.
   */
  const 보낸뒤 = 화면.slice(화면.indexOf('접어 뒀습니다'));
  for (const 줄 of ['첫째 줄', '둘째 줄', '셋째 줄']) {
    check(`보낸 뒤 화면에 「${줄}」이 남는다`, 보낸뒤.includes(줄),
      JSON.stringify(보낸뒤.split('\n').filter((l) => l.trim()).slice(0, 6)));
  }

  // 몇 줄 몇 바이트인지는 접은 표가 말해 준다 — 무엇을 붙였는지 모르면 다시 붙인다.
  check('몇 줄을 붙였는지 알려 준다', /붙여넣기 #\d+ · 3줄 · \d+B/.test(화면),
    화면.split('\n').find((l) => /붙여넣기 #/.test(l))?.trim() ?? '(안 알려 준다)');

  rmSync(home, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}

trace('7-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n붙여넣기·ESC 검사  ${D}(스무 줄이 스무 번이 되지 않는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
