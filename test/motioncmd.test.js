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

trace('4-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n/motion 명령  ${D}(고른 것이 실제로 화면에 물리나)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
