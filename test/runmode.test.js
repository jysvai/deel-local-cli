// 실행 모드 — 말하지 않으면 바깥으로 안 나가는가.
//
// ── 무엇이 문제였나 ─────────────────────────────────────────────────────
//
// 여태 자물쇠는 `--offline` 하나였고 **기본은 열림**이었다. `.deel/config.json`
// 의 baseUrl 한 줄만 바꾸면 그대로 바깥으로 나갔다. 화면에 ↗ 가 뜨긴 했지만
// 그건 **알리는 것**이지 막는 것이 아니다.
//
// 「완전 로컬」 이 이 도구의 정체성인데, 코드가 지키는 것은 그 절반이었다.
//
// ── 무엇을 지키나 ───────────────────────────────────────────────────────
//
//   1. 주소와 허가가 **둘 다** 있어야 나간다. 주소만 바꿔서는 못 나간다.
//   2. 로컬·사내망은 셋 중 어느 모드에서도 그냥 간다 — 봉인도 마찬가지다.
//      (offline 은 「인터넷 없음」이 아니라 「회사 밖으로 안 나감」이다)
//   3. 봉인은 기억해 둔 허가까지 무시한다. 제일 센 상태다.
//   4. 물어볼 사람이 없는 자리(run · acp)에서는 묻는 대신 **멈추고 말한다.**
//   5. 대화 도중 /model 로 갈아탈 때도 같은 문을 지난다.
//   6. 화면 첫 줄에 판 번호와 지금 모드가 뜬다.
import { readFileSync } from 'node:fs';
import { 모드들, 모드고르기, 지금모드, 바깥인가, 나갈수있나, 모드글 } from '../src/safety/runmode.js';
import { headerLines, statusLine } from '../src/ui/status.js';
import { VERSION } from '../src/version.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 벗기기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

trace('1-모드-셋');

{
  check('모드가 셋이다', 모드들.length === 3, 모드들.map((m) => m.영).join(' '));
  check('이름이 겹치지 않는다', new Set(모드들.map((m) => m.영)).size === 3);
  check('글자가 겹치지 않는다', new Set(모드들.map((m) => m.글자)).size === 3,
    모드들.map((m) => m.글자).join(' '));

  // 아무것도 안 주면 기본은 「이 안」 이다. 이게 이번 판의 요점이다 —
  // 기본값이 열림이면 자물쇠가 아니라 안내문이다.
  check('★ 기본은 이 안이다', 지금모드().영 === 'default', 지금모드().영);
  check('--online 이면 바깥', 지금모드({ online: true }).영 === 'online');
  check('--offline 이면 봉인', 지금모드({ offline: true }).영 === 'offline');

  /*
   * 둘을 같이 주면 막는 쪽을 따른다.
   *
   * 반대로 하면 `--offline` 을 붙였는데 나가는 일이 생긴다. 자물쇠가 헐거운
   * 것보다 나쁜 것은, 잠갔다고 믿게 해 놓고 헐거운 것이다.
   */
  check('★ 둘 다 주면 봉인이 이긴다', 지금모드({ online: true, offline: true }).영 === 'offline',
    지금모드({ online: true, offline: true }).영);

  check('이름으로도 집힌다', 모드고르기('online').영 === 'online' && 모드고르기('바깥').영 === 'online');
  check('모르는 이름은 기본으로', 모드고르기('없는모드').영 === 'default');
  check('모드글이 글자와 이름을 준다', 모드글(모드고르기('offline')) === '⛊ 봉인', 모드글(모드고르기('offline')));
}

trace('2-어디가-바깥인가');

{
  for (const 안쪽 of [
    'http://127.0.0.1:11434/v1',
    'http://localhost:8080/v1',
    'http://192.168.0.10:1234/v1',   // 집·사무실 공유기
    'http://10.20.30.40/v1',         // 사내망
    'http://172.20.1.5/v1',          // 사내망 (172.16~31)
    'http://[::1]:8000/v1',
  ]) check(`이 안: ${안쪽}`, !바깥인가(안쪽));

  for (const 밖 of [
    'https://api.anthropic.com',
    'https://api.openai.com/v1',
    'https://generativelanguage.googleapis.com/v1beta/openai/',
    'https://bedrock-mantle.ap-northeast-2.api.aws/openai/v1',
    'http://172.32.0.1/v1',          // 172.32 는 사설 대역이 아니다
  ]) check(`바깥: ${밖}`, 바깥인가(밖));

  /*
   * 못 읽는 주소는 바깥으로 친다.
   *
   * 모르면 조이는 쪽이다. 읽을 수 없는 주소를 「이 안」 으로 봐 주면 이상하게
   * 생긴 주소 한 줄로 자물쇠가 통째로 풀린다.
   */
  for (const 이상한것 of ['', null, undefined, '주소아님', 'ㅁㄴㅇㄹ']) {
    check(`★ 못 읽는 주소는 바깥으로 친다: ${JSON.stringify(이상한것)}`, 바깥인가(이상한것));
  }
}

trace('3-나갈수있나-표');

/*
 * ── 계획표의 표를 그대로 옮겨 검사한다 ──────────────────────────────────
 *
 * 모드 | 로컬·사내 | 바깥·허가 있음 | 바깥·허가 없음
 * ─────┼──────────┼───────────────┼──────────────
 * 이안  | 통과      | 통과           | 물어봄
 * 바깥  | 통과      | 통과           | 통과 (안 물어봄)
 * 봉인  | 통과      | 막음           | 막음
 */
{
  const 표 = [
    // [모드, 바깥, 허가, 되나, 물어볼까]
    ['default', false, false, true, false],
    ['default', false, true, true, false],
    ['default', true, true, true, false],
    ['default', true, false, false, true],
    ['online', false, false, true, false],
    ['online', true, false, true, false],
    ['online', true, true, true, false],
    ['offline', false, false, true, false],
    ['offline', false, true, true, false],
    ['offline', true, true, false, false],
    ['offline', true, false, false, false],
  ];
  for (const [모드이름, 바깥, 허가, 되나, 물어볼까] of 표) {
    const r = 나갈수있나(모드고르기(모드이름), { 바깥, 허가 });
    const 자리 = `${모드이름} · ${바깥 ? '바깥' : '이 안'} · ${허가 ? '허가O' : '허가X'}`;
    check(`${자리} → ${되나 ? '통과' : 물어볼까 ? '물어봄' : '막음'}`,
      r.되나 === 되나 && !!r.물어볼까 === 물어볼까, JSON.stringify(r));
  }

  // 표에서 제일 중요한 두 칸을 따로 못 박는다. 이 둘이 이번 자물쇠 자체다.
  check('★ 주소만 바꿔서는 못 나간다 (허가 없이 바깥)',
    나갈수있나(모드고르기('default'), { 바깥: true, 허가: false }).되나 === false);
  check('★ 봉인은 기억해 둔 허가를 무시한다',
    나갈수있나(모드고르기('offline'), { 바깥: true, 허가: true }).되나 === false);
  check('★ 봉인이어도 사내망은 간다 — offline 은 「인터넷 없음」이 아니다',
    나갈수있나(모드고르기('offline'), { 바깥: false, 허가: false }).되나 === true);
}

trace('4-켜는-자리마다-이-문을-지나나');

/*
 * 표가 맞아도 부르는 데가 없으면 사람에게는 하나도 안 고쳐졌다.
 *
 * 연결을 여는 자리는 넷이다 — 대화(repl) · 한 번만(oneshot) · 에디터(acp) ·
 * 도중에 갈아타기(commands 의 /model). 하나라도 빠지면 그 길로 그냥 나간다.
 */
{
  const 소스 = Object.fromEntries(
    ['src/repl.js', 'src/oneshot.js', 'src/acp/serve.js', 'src/commands.js', 'src/setup.js']
      .map((f) => [f, readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')]));

  for (const f of ['src/repl.js', 'src/oneshot.js', 'src/acp/serve.js']) {
    check(`${f} 가 문을 지난다`, /나갈수있나\(실행모드/.test(소스[f]));
    // 허가를 물어야 하는데 그냥 열어 버리면 문을 지난 것이 아니다.
    check(`${f} 는 물어야 할 때 안 연다`,
      /물어볼까[\s\S]{0,700}?allowEndpoint\(conn\.base\)/.test(소스[f])
      || /if \(!나감\.물어볼까\) allowEndpoint/.test(소스[f]));
  }
  check('/model 로 갈아탈 때도 지난다', /나가도되나묻기\(session, p\)/.test(소스['src/commands.js']));
  check('모델만 바꿀 때도 지난다',
    (소스['src/commands.js'].match(/if \(!await 나가도되나묻기\(session, p\)\) return;/g) ?? []).length === 2);
  check('setup 이 「나가도 되나」 를 받아 적는다',
    /바깥인가\(found\.base\)/.test(소스['src/setup.js']) && /online: true/.test(소스['src/setup.js']));

  /*
   * 물어볼 사람이 없는 자리에서는 **묻지 않고 멈춘다.**
   *
   * 파이프 뒤에는 답할 사람이 없다. 거기서 물으면 스크립트가 영영 서 있고,
   * 그냥 나가면 바깥으로 나가는 줄 아무도 모른다. 둘 다 나쁘다.
   */
  check('★ run 은 묻는 대신 멈추고 말한다', /needs-online/.test(소스['src/oneshot.js']));
  check('run 이 무엇을 하면 되는지 알려 준다', /--online 을 붙이거나/.test(소스['src/oneshot.js']));
  check('★ acp 도 묻는 대신 또렷하게 거절한다',
    /잘못된인자오류\([\s\S]{0,200}?이 컴퓨터 밖으로 나갑니다/.test(소스['src/acp/serve.js']));
}

trace('5-화면에-판과-모드가-뜨나');

/*
 * 판 번호가 화면 어디에도 없었다. `deel --version` 을 따로 쳐야 알았는데,
 * 그 질문이 나오는 자리는 대개 뭔가 이상할 때고 그때 사람은 화면을 캡처해
 * 보낸다. 캡처에 판 번호가 없으면 무슨 판 이야기인지부터 다시 물어야 한다.
 */
{
  const 세션 = (base, 모드) => ({
    conn: { base, kind: 'openai', model: 'aya', ctx: 32768, streaming: true, tools: true, think: false },
    root: '/tmp/일감', mode: 'auto', work: 'auto', 실행모드: 모드,
  });
  const 머리 = (s) => 벗기기(headerLines(s, { skills: [], commands: [], plugins: [] }, false).join('\n'));

  const 안 = 머리(세션('http://127.0.0.1:11434/v1', 모드고르기('default')));
  check('★ 첫 줄에 판 번호가 뜬다', 안.split('\n')[0].includes(VERSION), 안.split('\n')[0]);
  check('★ 첫 줄에 지금 모드가 뜬다', /⌂ 이 안 \(기본\)/.test(안.split('\n')[0]), 안.split('\n')[0]);

  const 밖 = 머리(세션('https://api.anthropic.com', 모드고르기('online')));
  check('바깥 모드면 그렇게 뜬다', /↗ 바깥 \(online\)/.test(밖.split('\n')[0]), 밖.split('\n')[0]);

  const 봉 = 머리(세션('https://api.anthropic.com', 모드고르기('offline')));
  check('봉인 모드면 그렇게 뜬다', /⛊ 봉인 \(offline\)/.test(봉.split('\n')[0]), 봉.split('\n')[0]);

  /*
   * 모드를 안 심어 준 화면에서는 아무것도 안 그린다.
   *
   * 모르는 것을 기본값으로 지어내면, 봉인으로 켠 줄 알았는데 화면은 「이 안」
   * 이라고 하는 자리가 생긴다 — 안 보여 주느니만 못하다.
   */
  const 모름 = 머리(세션('http://127.0.0.1:11434/v1', undefined));
  check('★ 모드를 모르면 지어내지 않는다', !/이 안 \(기본\)|바깥 \(online\)|봉인/.test(모름.split('\n')[0]),
    모름.split('\n')[0]);
  check('그래도 판 번호는 뜬다', 모름.split('\n')[0].includes(VERSION), 모름.split('\n')[0]);
}

trace('5-2-판번호가-안전표시를-밀어내나');

/*
 * ── 판 번호가 승인 방식을 밀어내면 안 된다 ──────────────────────────────
 *
 * 처음에는 판 번호를 폴더 이름 옆에 붙였다. 여덟 칸이 앞쪽에서 늘어나니
 * 106~113칸 터미널에서 온 줄이 짧은 꼴로 바뀌었고, 승인 방식이
 * `⏵ 위험만 확인` 에서 `⏵ 위험만` 이 됐다. 「내 파일이 안 물어보고 바뀌는가」
 * 가 흐려진 것이다 — 이 파일이 여러 번 적어 둔 그 손해다.
 *
 * 그래서 판 번호는 맨 뒤에 혼자 두고, 자리가 모자라면 **접기보다 먼저** 뺀다.
 */
{
  const 세션 = {
    conn: { base: 'http://127.0.0.1:11434/v1', kind: 'openai', model: 'qwen2.5-coder:14b', ctx: 32768, streaming: true, tools: true },
    root: '/tmp/deel-box', mode: 'confirm', work: 'auto', think: 'medium', effort: 'save',
    breakdown: () => ({ system: 100, messages: 900, tools: 50 }),
    usage: { in: 1000, out: 200 }, messages: [],
  };
  const 줄 = (w) => 벗기기(statusLine(세션, { max: w }));

  check('넓으면 판 번호가 뜬다', 줄(140).includes(VERSION), 줄(140).slice(-30));
  check('★ 좁아지면 판 번호부터 빠진다', !줄(106).includes(VERSION), 줄(106).slice(-30));
  for (const w of [106, 110, 113]) {
    check(`★ ${w}칸에서 승인 방식이 그대로다`, /⏵ 위험만 확인/.test(줄(w)),
      (줄(w).match(/⏵[^▏]*/) ?? [''])[0].trim());
  }
  // 정말 좁아지면 접는 것은 예전 그대로다 — 판 번호 때문에 달라진 게 아니다.
  check('아주 좁으면 예전처럼 접는다', /⏵ 위험만(?! 확인)/.test(줄(80)), 줄(80).slice(-24));
}

trace('6-깃발이-붙어-있나');

{
  const bin = readFileSync(new URL('../bin/deel.js', import.meta.url), 'utf8');
  // BOOL 에 없으면 --online 이 뒤의 낱말을 값으로 삼켜 버린다.
  // 실제로 그런 일이 있었다 — deel run --json "..." 이 시킬 말을 통째로 먹었다.
  check('--online 이 값 없는 깃발로 등록됐다', /BOOL = new Set\(\[[^\]]*'online'/.test(bin));
  check('세 자리(run·chat·acp)에 다 넘긴다', (bin.match(/online: flags\.online/g) ?? []).length === 3,
    String((bin.match(/online: flags\.online/g) ?? []).length));
  check('deel online 이라고 쳐도 된다', /친명령 === 'online'/.test(bin));
  check('도움말이 셋을 다 적는다', /--online/.test(bin) && /⌂ 이 안/.test(bin) && /⛊ 봉인/.test(bin));

  const comp = readFileSync(new URL('../src/completion.js', import.meta.url), 'utf8');
  check('탭 완성에도 있다', /'--online'/.test(comp));
}

trace('7-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n실행 모드 검사  ${D}(말하지 않으면 바깥으로 안 나가는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
