// `/motion` — 일하는 동안 뭐가 도나.
//
// ── 여기서 무엇을 지키나 ────────────────────────────────────────────────
//
// 예전에는 DEEL_MOTION·DEEL_OFFICE 두 환경변수였다. 켜 보려면 터미널을 껐다
// 켜야 했고 이름도 둘을 외워야 했다 — 재미로 넣은 것을 켜는 데 그만한 품이
// 들면 아무도 안 켠다. 그래서 명령 하나로 합쳤는데, 합치면서 생기는 함정이
// 셋이라 그것들을 잰다.
//
//   1. 고른 것이 **실제로 화면 쪽에 물리나.** 설정 파일에만 적히고 안 물리면
//      "바꿨다는데 안 바뀐다" 가 된다.
//   2. **환경변수가 이기나.** 한 번만 다르게 보려고 `DEEL_MOTION=기사 deel` 을
//      쓰는 길이 살아 있어야 하고, 검사도 그 길로 잰다.
//   3. `/motion 끔` 이 **사람이 넣어 둔 DEEL_NO_MOTION 을 안 지우나.** 끄는
//      길이 둘인데 하나가 다른 하나를 덮으면, 껐다고 믿는 자리에서 그림이 돈다.
import { 적용하기 } from '../src/commands.js';
import { 테마이름, 끔 } from '../src/ui/motion.js';
import { 켜달라했나 } from '../src/ui/office.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 환경치우기 = () => {
  delete process.env.DEEL_MOTION;
  delete process.env.DEEL_OFFICE;
  delete process.env.DEEL_NO_MOTION;
};
환경치우기();

trace('1-고른것이-물리나');
{
  const 바람 = [
    ['기본',   { 테마: '기본', 사무실: false, 끔: false }],
    ['기사',   { 테마: '기사', 사무실: false, 끔: false }],
    ['동물',   { 테마: '동물', 사무실: false, 끔: false }],
    // 사무실을 켜면 상자 안 그림은 조용한 것으로 돌아간다 — 둘 다 같은 것을
    // 말하므로 나란히 두면 같은 소리를 두 번 하는 셈이다.
    ['사무실', { 테마: '기본', 사무실: true,  끔: false }],
    ['끔',     { 테마: '기본', 사무실: false, 끔: true  }],
  ];
  for (const [값, 바라는것] of 바람) {
    적용하기(값);
    check(`/motion ${값}: 그림이 ${바라는것.테마}`, 테마이름() === 바라는것.테마, 테마이름());
    check(`/motion ${값}: 사무실 ${바라는것.사무실}`, 켜달라했나() === 바라는것.사무실, `${켜달라했나()}`);
    check(`/motion ${값}: 끔 ${바라는것.끔}`, 끔() === 바라는것.끔, `${끔()}`);
  }
  // 모르는 값이 와도 안 터지고 기본으로 떨어진다.
  적용하기('그런거없음');
  check('모르는 값이면 기본으로', 테마이름() === '기본' && 켜달라했나() === false);
  적용하기(undefined);
  check('아무것도 안 골랐으면 기본으로', 테마이름() === '기본' && 켜달라했나() === false);
}

trace('2-환경변수가-이기나');
{
  적용하기('동물');
  process.env.DEEL_MOTION = '기사';
  check('DEEL_MOTION 이 설정을 이긴다', 테마이름() === '기사', 테마이름());
  delete process.env.DEEL_MOTION;
  check('환경변수를 치우면 설정이 돌아온다', 테마이름() === '동물', 테마이름());

  적용하기('기본');
  process.env.DEEL_OFFICE = '1';
  check('DEEL_OFFICE 가 설정을 이긴다', 켜달라했나() === true);
  // 환경변수로 **끄는** 것도 이겨야 한다. 설정에서 켜 뒀어도 그렇다.
  적용하기('사무실');
  process.env.DEEL_OFFICE = '0';
  check('DEEL_OFFICE=0 이면 설정이 켜 뒀어도 안 켠다', 켜달라했나() === false);
  delete process.env.DEEL_OFFICE;
  check('환경변수를 치우면 설정대로 켜진다', 켜달라했나() === true);
  환경치우기();
  적용하기('기본');
}

trace('3-끄는-길-둘이-안-싸우나');
{
  /*
   * 사람이 DEEL_NO_MOTION 을 넣어 두고 deel 을 켰다. 그 상태에서 /motion 으로
   * 딴 그림을 골랐을 때, 명령이 그 환경변수를 **지워 버리면 안 된다.**
   * 껐다고 믿는 자리에서 그림이 도는 것이 제일 나쁜 결과다.
   */
  process.env.DEEL_NO_MOTION = '1';
  적용하기('기사');
  check('DEEL_NO_MOTION 은 명령이 못 지운다', process.env.DEEL_NO_MOTION === '1');
  check('그래서 여전히 꺼져 있다', 끔() === true);
  delete process.env.DEEL_NO_MOTION;
  check('환경변수를 치우면 고른 그림이 산다', 끔() === false && 테마이름() === '기사');

  // 반대로 /motion 끔 은 환경변수 없이도 꺼져야 한다.
  적용하기('끔');
  check('/motion 끔 은 환경변수 없이도 끈다', 끔() === true && process.env.DEEL_NO_MOTION === undefined);
  적용하기('기본');
  check('다시 고르면 켜진다', 끔() === false);
  환경치우기();
}

trace('4-화면이-하는-말이-사실인가');

/*
 * ── 고른 것이 안 먹히는 판에서 **안 먹힌다고 말하나** ────────────────────
 *
 * 위 3번은 「환경변수가 이긴다」 는 **동작**을 잰다. 동작은 맞았다. 틀린 것은
 * 그때 화면이 하는 말이었다 —
 *
 *   DEEL_NO_MOTION=1 인 채로 /motion 기사
 *     ✓ 기사로 바꿨습니다. — 중세 기사가 칼을 휘두릅니다
 *        다음 판부터 바로 보입니다. 설정에도 남았습니다.     ← 안 보인다
 *
 * 바로 위에서 사무실이 작은 터미널에 안 뜬다고 굳이 알려 주면서(「켰다고
 * 말해 놓고 안 보이면 그게 고장이다」), 같은 일이 환경변수로 일어날 때는
 * 아무 말도 안 했다.
 *
 * 그리고 반대쪽 — `DEEL_MOTION=cat` 은 **안 이기는데** 「환경변수가
 * 이깁니다」 라고 적혔다. 사람은 설정을 바꿔도 소용없다고 믿고 손을 뗀다.
 */
import { handle } from '../src/commands.js';
import { Session } from '../src/agent/session.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

{
  process.env.DEEL_HOME = mkdtempSync(join(tmpdir(), 'deel-motion-home-'));
  const 뿌리 = mkdtempSync(join(tmpdir(), 'deel-motion-'));
  const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', auth: 'none', key: null,
    model: '검사용', ctx: 32768, streaming: false, tools: false, json: false, think: false };
  const ctx = { scope: makeScope(뿌리), history: new History(뿌리), audit: new Audit(뿌리), seen: new Set() };
  const session = new Session(conn, { root: 뿌리, mode: 'auto', think: 'medium', effort: 'save' });

  const 눌러보기 = async (줄) => {
    const 원래 = process.stdout.write.bind(process.stdout);
    let 담김 = '';
    process.stdout.write = (조각) => { 담김 += String(조각); return true; };
    try { await handle(줄, session, ctx); } finally { process.stdout.write = 원래; }
    return 담김.replace(/\[[0-9;]*m/g, '');
  };

  환경치우기();
  process.env.DEEL_NO_MOTION = '1';
  const 껐을때 = await 눌러보기('/motion 기사');
  check('★★ 환경변수가 꺼 놨으면 안 돈다고 말한다', /DEEL_NO_MOTION/.test(껐을때),
    껐을때.split('\n').filter((l) => l.trim()).join(' / ').slice(0, 110));
  check('★★ 그 판에서 「바로 보입니다」 라고 안 한다', !/바로 보입니다/.test(껐을때));
  check('고른 것 자체는 적어 둔다', 테마이름() === '기사', 테마이름());

  환경치우기();
  적용하기('동물');
  process.env.DEEL_MOTION = 'cat';
  const 모를때 = await 눌러보기('/motion 동물');
  check('환경변수가 정말로 안 이긴다', 테마이름() === '동물', 테마이름());
  check('★★ 안 이기는데 이긴다고 안 한다', !/그쪽이 이깁니다/.test(모를때),
    모를때.split('\n').filter((l) => l.trim()).join(' / ').slice(0, 110));
  check('★ 모르는 이름이라 무시했다고 말한다', /모르는 이름/.test(모를때));

  환경치우기();
  적용하기('동물');
  process.env.DEEL_MOTION = 'knight';
  const 이길때 = await 눌러보기('/motion 동물');
  check('진짜로 이길 때는 이긴다고 말한다', /그쪽이 이깁니다/.test(이길때),
    이길때.split('\n').filter((l) => l.trim()).join(' / ').slice(0, 110));
  check('그리고 실제로 이긴다', 테마이름() === '기사', 테마이름());

  /*
   * `DEEL_NO_MOTION=0` 은 **끄지 말라는 말**이다.
   *
   * `!!process.env.DEEL_NO_MOTION` 로 두면 그 값도 끈다. 바로 옆 DEEL_OFFICE 는
   * 값을 읽어서 0 을 껐다로 보므로(위 2번), 같은 .env 에 둘을 나란히 적으면
   * 하나만 말을 듣고 다른 하나는 반대로 간다 — 화면에는 아무 말도 없이.
   */
  환경치우기();
  for (const [값, 바라는것] of [['0', false], ['false', false], ['off', false], ['', false],
    ['1', true], ['true', true], ['yes', true]]) {
    process.env.DEEL_NO_MOTION = 값;
    적용하기('기사');
    check(`DEEL_NO_MOTION=${JSON.stringify(값)} → ${바라는것 ? '끈다' : '안 끈다'}`,
      끔() === 바라는것, `끔()=${끔()}`);
  }
  환경치우기();
  적용하기('기본');
}

trace('5-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n/motion 명령  ${D}(고른 것이 실제로 화면에 물리나)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
