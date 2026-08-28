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
import { readFileSync } from 'node:fs';
import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import { 이어쓰기표시 } from '../src/repl.js';
import { trace } from './trace.mjs';

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
    const 뒤 = (rl.line ?? '').slice(rl.cursor ?? 0);
    (쌓인 ??= []).push((rl.line ?? '').slice(0, rl.cursor ?? 0));
    rl.line = 뒤;
    rl.cursor = 0;
  });

  let 보낼것 = null;
  rl.on('line', (l) => {
    보낼것 = 쌓인 ? [...쌓인, l].join('\n') : l;
    쌓인 = null;
  });

  for (const s of 조각들) 입력.write(s);
  rl.close();
  return 보낼것;
}

const ALT = '\x1b\r';   // Alt/Option+Enter — 터미널이 ESC 를 앞에 붙여 보낸다

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
   */
  const 소스 = readFileSync(new URL('../src/repl.js', import.meta.url), 'utf8');
  const 넣는꼴 = /rl\.line\s*=\s*[^;]*\n/;
  check('repl.js 가 rl.line 에 개행을 안 넣는다', !넣는꼴.test(소스),
    소스.split('\n').find((l) => 넣는꼴.test(l))?.trim() ?? '');

  // 대신 줄을 따로 쌓아 두는 길이 살아 있어야 한다.
  check('여러 줄은 따로 쌓아서 보낸다', /줄쌓기\s*\(/.test(소스));
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

trace('4-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n여러 줄 보내기  ${D}(그려지는 모습이 아니라 보내지는 값을 잰다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
if (적어둘것.length) { console.log(''); for (const l of 적어둘것) console.log(`  ${D}· ${l}${X}`); }
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
