// 켤 때 도는 글자 모션.
//
// 여기서 잴 것은 '예쁜가' 가 아니다. 그건 못 잰다. 잴 수 있는 것은 이 셋이다.
//
//   1) 뜻이 순서대로 나오는가 — deel 이 deel-local 로 자라고, 그 다음에
//      선이 닫히고, 닫힌 다음에야 곁말이 붙는가. 순서가 곧 뜻이다.
//   2) 줄 수가 틀마다 안 변하는가 — 변하면 다시 그릴 때 몇 줄을 올릴지가
//      틀마다 달라지고, 한 번 어긋나면 앞 그림이 화면에 조각으로 남는다.
//   3) 터미널이 아닐 때 제어문자를 안 흘리는가 — 로그 파일에 \x1b[2A 가
//      널리는 것이 이 파일에서 제일 잘 나는 사고다.
import { 틀, 틀수, 마지막틀, 보이기, 기본곁말, 이름너비, 끔, 틀주기 } from '../src/ui/intro.js';
import { width } from '../src/ui/ansi.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// 색을 벗겨야 글자만 잰다.
const 민글 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

const 원래끔 = process.env.DEEL_NO_INTRO;
const 원래모션 = process.env.DEEL_NO_MOTION;
delete process.env.DEEL_NO_INTRO;
delete process.env.DEEL_NO_MOTION;

trace('1-순서가뜻이다');

// ── 뜻이 순서대로 나오는가 ──────────────────────────────────────────────
{
  const 옵 = { 곁말: '이 컴퓨터 안에서만' };
  const 전부 = Array.from({ length: 틀수 }, (_, i) => 틀(i, 옵).map(민글));

  check('첫 틀은 사람이 친 그대로 deel', 전부[0][0].trim().startsWith('deel'), JSON.stringify(전부[0][0]));
  check('첫 틀엔 아직 local 이 없다', !전부[0][0].includes('local'), JSON.stringify(전부[0][0]));
  check('마지막엔 deel-local 이 다 있다', 전부.at(-1)[0].includes('deel-local'), JSON.stringify(전부.at(-1)[0]));

  // 글자는 자라기만 한다. 줄었다 늘었다 하면 깜빡이는 것으로 보인다.
  const 글길이 = 전부.map((f) => 민글(f[0]).trimEnd().replace('▏', '').length);
  check('글자가 줄어드는 틀이 없다', 글길이.every((v, i) => i === 0 || v >= 글길이[i - 1]),
    JSON.stringify(글길이));

  // 선도 자라기만 한다.
  const 선길이 = 전부.map((f) => (민글(f[1]).match(/─+/)?.[0].length ?? 0));
  check('선이 줄어드는 틀이 없다', 선길이.every((v, i) => i === 0 || v >= 선길이[i - 1]),
    JSON.stringify(선길이));
  check('선은 이름 폭까지만 자란다', Math.max(...선길이) === 이름너비(),
    `${Math.max(...선길이)} / ${이름너비()}`);

  // 순서가 뜻이다 — 이름이 다 자란 뒤에 선이 그어지고, 선이 닫힌 뒤에 곁말이 붙는다.
  const 선첫틀 = 선길이.findIndex((v) => v > 0);
  const 이름다된틀 = 글길이.findIndex((v, i) => 전부[i][0].includes('deel-local'));
  check('이름이 다 자란 뒤에 선이 그어진다', 선첫틀 > 이름다된틀, `선 ${선첫틀} / 이름 ${이름다된틀}`);

  const 곁첫틀 = 전부.findIndex((f) => f[1].includes('이 컴퓨터 안에서만'));
  const 선닫힌틀 = 선길이.findIndex((v) => v === 이름너비());
  check('선이 닫힌 뒤에야 곁말이 붙는다', 곁첫틀 >= 선닫힌틀 && 곁첫틀 > 0,
    `곁말 ${곁첫틀} / 닫힘 ${선닫힌틀}`);
  check('곁말은 마지막에만 있다', 전부.filter((f) => f[1].includes('이 컴퓨터')).length === 1);
}

trace('2-줄수가안변한다');

// ── 줄 수가 틀마다 안 변해야 한다 ───────────────────────────────────────
//
// 변하면 다시 그릴 때 올릴 줄 수가 틀마다 달라지고, 한 번 어긋나면 앞 그림이
// 화면에 조각으로 남는다.
{
  const 줄수들 = Array.from({ length: 틀수 }, (_, i) => 틀(i).length);
  check('언제나 두 줄', 줄수들.every((n) => n === 2), JSON.stringify(줄수들));
  check('줄 안에 줄바꿈이 없다',
    Array.from({ length: 틀수 }, (_, i) => 틀(i)).flat().every((l) => !l.includes('\n')));
  check('범위를 벗어난 번호는 마지막 틀', JSON.stringify(틀(9999)) === JSON.stringify(마지막틀()));
  check('음수도 안 죽는다', 틀(-5).length === 2);
  check('숫자가 아니어도 안 죽는다', 틀('아무거나').length === 2 && 틀(null).length === 2);
  check('마지막틀은 마지막 번호와 같다',
    JSON.stringify(마지막틀()) === JSON.stringify(틀(틀수 - 1)));
}

trace('3-이모지를안쓴다');

// ── 이모지·두 칸 기호를 안 쓴다 ─────────────────────────────────────────
//
// 터미널마다 폭이 달라지면 지워야 할 자리가 어긋나 앞 그림이 조각으로 남는다.
{
  const 전부글 = Array.from({ length: 틀수 }, (_, i) => 틀(i, { 곁말: 'x' })).flat().map(민글).join('');
  // 곁말(한글)은 부르는 쪽이 주는 것이라 빼고 잰다. 그림 글자만 본다.
  const 그림글자 = [...전부글].filter((ch) => !/[가-힣\s]/.test(ch));
  check('그림에 쓰는 글자는 전부 한 칸', 그림글자.every((ch) => width(ch) <= 1),
    JSON.stringify(그림글자.filter((ch) => width(ch) > 1)));
  check('이모지가 없다', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(전부글));
}

trace('4-바깥이면색이다르다');

// ── 바깥으로 나가는 연결이면 눈에 띄어야 한다 ───────────────────────────
{
  const 안 = 틀(틀수 - 1, { 바깥: false, 곁말: 기본곁말(false) }).join('');
  const 밖 = 틀(틀수 - 1, { 바깥: true, 곁말: 기본곁말(true) }).join('');
  /*
   * 색은 ansi.js 가 켜고 끈다 — 파이프로 돌면 아예 안 붙는다. 그러니 색 자체를
   * 늘 있다고 보고 재면, 이 검사는 '어디서 돌렸나' 를 재는 것이 되어 버린다.
   * 색이 켜진 자리에서만 색을 보고, 아니면 글자만 본다.
   */
  const 색켜짐 = 틀(0).join('').includes('\x1b[');
  if (색켜짐) {
    check('안과 밖의 색이 다르다', 안 !== 밖);
    check('안쪽은 초록', 안.includes('\x1b[92m'), JSON.stringify(안));
    check('바깥은 노랑 — 그냥 지나치면 안 되는 것이라', 밖.includes('\x1b[93m'), JSON.stringify(밖));
  } else {
    check('색이 꺼진 자리에서는 색을 안 붙인다', !안.includes('\x1b[') && !밖.includes('\x1b['));
    check('색이 꺼져도 곁말로 구분된다', 민글(안) !== 민글(밖), JSON.stringify([민글(안), 민글(밖)]));
    check('색이 꺼져도 선은 그어진다', 안.includes('─'), JSON.stringify(안));
  }
  check('안쪽 곁말', 기본곁말(false).includes('이 컴퓨터 안'), 기본곁말(false));
  check('바깥 곁말', 기본곁말(true).includes('바깥'), 기본곁말(true));
  check('글자 폭은 색과 무관하게 같다',
    민글(틀(틀수 - 1, { 바깥: false })[0]) === 민글(틀(틀수 - 1, { 바깥: true })[0]));
}

trace('5-끄면한장만');

// ── 끄면 한 장만 ────────────────────────────────────────────────────────
{
  let 담김 = '';
  const 쓰기 = (s) => { 담김 += s; };
  const n = await 보이기({ 쓰기, 움직임: false, 곁말: '이 컴퓨터 안에서만' });
  check('한 장만 찍는다', n === 1, String(n));
  // 색(SGR)은 ansi.js 가 터미널이 아닐 때 알아서 안 붙인다. 여기서 막을 것은
  // **커서를 옮기고 지우는** 것이다 — 그게 로그 파일에 남으면 글이 깨진다.
  check('커서를 안 옮긴다 — 로그에 남으면 안 된다', !/\x1b\[\d*[ABCDJK]/.test(담김),
    JSON.stringify(담김.slice(0, 80)));
  check('그래도 이름은 있다', 민글(담김).includes('deel-local'), JSON.stringify(민글(담김)));
  check('그래도 곁말은 있다', 담김.includes('이 컴퓨터 안에서만'));
  check('두 줄이다', 담김.split('\n').filter(Boolean).length === 2, JSON.stringify(담김));
}

trace('6-돌리면제자리에서다시그린다');

// ── 돌릴 때는 제자리에서 다시 그린다 ────────────────────────────────────
{
  let 담김 = '';
  let 쉰횟수 = 0;
  const n = await 보이기({
    쓰기: (s) => { 담김 += s; },
    움직임: true,
    곁말: '이 컴퓨터 안에서만',
    쉬기: async () => { 쉰횟수++; },   // 검사에서 진짜로 기다리지 않는다
  });
  check('틀을 전부 돈다', n === 틀수, `${n} / ${틀수}`);
  check('틀 사이마다 한 번씩 쉰다', 쉰횟수 === 틀수 - 1, `${쉰횟수} / ${틀수 - 1}`);

  const 올림 = (담김.match(/\x1b\[2A/g) ?? []).length;
  check('첫 틀은 안 올라간다 — 위쪽 글을 먹으면 안 된다', 올림 === 틀수 - 1, `${올림} / ${틀수 - 1}`);
  check('올라간 만큼 지운다', (담김.match(/\x1b\[2K/g) ?? []).length === 틀수 * 2);
  check('커서를 숨겼다 다시 보인다',
    담김.includes('\x1b[?25l') === false && 담김.includes('\x1b[?25h') === false,
    '커서 제어는 stdout 으로 직접 나간다 — 쓰기 로는 안 온다');
  check('마지막 모습이 다 자란 이름이다', 담김.endsWith(`${마지막틀({ 곁말: '이 컴퓨터 안에서만' })[1]}\n`),
    JSON.stringify(담김.slice(-40)));
}

trace('7-끄는스위치');

// ── 끄는 스위치 ─────────────────────────────────────────────────────────
{
  check('평소엔 안 꺼져 있다', 끔() === false);
  process.env.DEEL_NO_INTRO = '1';
  check('DEEL_NO_INTRO 로 끈다', 끔() === true);
  delete process.env.DEEL_NO_INTRO;
  process.env.DEEL_NO_MOTION = '1';
  // 그림 돌림표를 끈 사람은 이것도 끈 것으로 본다. 스위치를 두 개 외우게 하지 않는다.
  check('DEEL_NO_MOTION 도 같이 먹는다', 끔() === true);
  delete process.env.DEEL_NO_MOTION;

  check('다 합쳐 1초를 안 넘긴다', 틀주기 * 틀수 < 1000, `${틀주기 * 틀수}ms`);
}

if (원래끔 !== undefined) process.env.DEEL_NO_INTRO = 원래끔;
if (원래모션 !== undefined) process.env.DEEL_NO_MOTION = 원래모션;

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n시작 모션 검사  ${D}(deel 이 deel-local 로 자라고 경계가 닫힌다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
