// 일하는 중에 도는 작은 그림.
//
// ── 여기서 무엇을 지키나 ────────────────────────────────────────────────
//
// 이건 꾸미기라서 "예쁜가" 는 못 잰다. 대신 **깨뜨릴 수 있는 것**을 잰다.
//
//   1. 폭. 상자 안에 들어가는 것이라 한 장이라도 폭이 다르면 그 순간 테두리가
//      어긋난다. 90ms 마다 바뀌므로 눈으로는 '떨리는 상자' 로 보이고,
//      무엇 때문인지 알아내기 어렵다.
//   2. 글자 종류. 이모지나 ● ▪ 같은 기호가 섞이면 동아시아 로캘에서 두 칸으로
//      잡혀 같은 일이 벌어진다. 점자만 쓴다.
//   3. 갈래 빠짐. working.js 에 갈래를 더하고 여기를 안 더하면 조용히 기본으로
//      떨어진다. 오류가 안 나서 아무도 모른다.
//   4. 끌 수 있는가. 점자가 안 나오는 자리·화면 읽기 프로그램이 있다.
import {
  틀, 그림들, 점자로, 그림고르기, 칸수, 가로, 세로, 테마들, 테마, 테마이름,
} from '../src/ui/motion.js';
import { 문구 } from '../src/ui/working.js';
import { width } from '../src/ui/ansi.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

trace('1-점자로');
// ── 그림을 점자로 바꾸는 것이 맞나 ──────────────────────────────────────
//
// 점 번호가 하나라도 어긋나면 그림이 통째로 뒤집힌다. 그런데 화면에서는
// '뭔가 이상한데' 정도로만 보여서 못 찾는다. 여기서 한 점씩 못 박는다.
{
  const 빈것 = ['......', '......', '......', '......'];
  const 꽉찬것 = ['######', '######', '######', '######'];
  check('빈 그림은 빈 점자', 점자로(빈것) === '⠀⠀⠀');
  check('꽉 찬 그림은 꽉 찬 점자', 점자로(꽉찬것) === '⣿⣿⣿');

  // 점 하나씩. 왼쪽 위부터 1·2·3·7, 오른쪽이 4·5·6·8 이다.
  const 한점 = (r, c) => {
    const g = ['......', '......', '......', '......'];
    g[r] = g[r].slice(0, c) + '#' + g[r].slice(c + 1);
    return 점자로(g).charCodeAt(0) - 0x2800;
  };
  const 표 = [[0, 0, 0x01, '1'], [1, 0, 0x02, '2'], [2, 0, 0x04, '3'], [3, 0, 0x40, '7'],
    [0, 1, 0x08, '4'], [1, 1, 0x10, '5'], [2, 1, 0x20, '6'], [3, 1, 0x80, '8']];
  for (const [r, c, 값, 번호] of 표) {
    check(`${r}행 ${c}열 = ${번호}번 점`, 한점(r, c) === 값,
      `0x${한점(r, c).toString(16)} (0x${값.toString(16)} 이어야)`);
  }

  // 격자를 벗어난 자리를 만지면 터진다 — 그림을 짧게 적는 실수는 반드시 난다.
  // '##' 은 **가로로** 두 점이다(1번·4번). 세로로 착각해서 ⠃ 로 적었다가 걸렸다.
  check('줄이 모자라도 안 터진다', 점자로(['##']) === '⠉⠀⠀', 점자로(['##']));
  check('아예 빈 배열도 안 터진다', 점자로([]) === '⠀⠀⠀');
}

trace('2-폭');
// ── 폭이 한 장도 안 어긋나나 ────────────────────────────────────────────
{
  let 폭틀림 = [];
  let 글자수틀림 = [];
  let 점자아닌것 = [];
  for (const [갈래, 장들] of Object.entries(틀)) {
    for (const [i, g] of 장들.entries()) {
      if (width(g) !== 칸수) 폭틀림.push(`${갈래}[${i}] 폭 ${width(g)}`);
      if ([...g].length !== 칸수) 글자수틀림.push(`${갈래}[${i}] ${[...g].length}자`);
      for (const ch of g) {
        const cp = ch.codePointAt(0);
        if (cp < 0x2800 || cp > 0x28ff) 점자아닌것.push(`${갈래}[${i}] U+${cp.toString(16)}`);
      }
    }
  }
  check('모든 장이 같은 폭', 폭틀림.length === 0, 폭틀림.slice(0, 3).join(', '));
  check('모든 장이 같은 글자수', 글자수틀림.length === 0, 글자수틀림.slice(0, 3).join(', '));
  check('점자 말고는 안 섞인다', 점자아닌것.length === 0, 점자아닌것.slice(0, 3).join(', '));

  // 원본 그림도 격자에 맞아야 한다. 한 줄이 짧으면 조용히 꺼진 것으로 채워져서
  // 화면에서는 '왜 저기가 비지' 로만 보인다.
  const 격자틀림 = [];
  for (const [갈래, 장들] of Object.entries(그림들)) {
    for (const [i, g] of 장들.entries()) {
      if (g.length !== 세로) 격자틀림.push(`${갈래}[${i}] ${g.length}줄`);
      for (const [r, 줄] of g.entries()) {
        if (줄.length !== 가로) 격자틀림.push(`${갈래}[${i}] ${r}행 ${줄.length}칸`);
      }
    }
  }
  check('원본 그림이 6×4 격자에 딱 맞는다', 격자틀림.length === 0, 격자틀림.slice(0, 3).join(', '));
}

trace('3-갈래');
// ── working.js 의 갈래를 다 덮나 ────────────────────────────────────────
//
// 문구는 있는데 그림이 없으면 조용히 기본으로 떨어진다. 오류가 안 나므로
// 화면을 한참 보고 나서야 "얘만 왜 다른 그림이지" 하고 알게 된다.
{
  const 문구갈래 = Object.keys(문구);
  const 없는것 = 문구갈래.filter((k) => !틀[k]);
  check('문구가 있는 갈래는 그림도 있다', 없는것.length === 0, 없는것.join(', '));
  const 남는것 = Object.keys(틀).filter((k) => !문구갈래.includes(k));
  check('쓰지도 않는 그림은 없다', 남는것.length === 0, 남는것.join(', '));

  /*
   * 갈래마다 달라야 의미가 있다. 다 같으면 '무엇을 하는 중인지 보인다' 가 거짓말이 된다.
   *
   * 처음에는 **첫 장만** 비교했는데 그게 틀렸다. 기본과 느긋은 같은 덩어리가
   * 한쪽으로 지나가느냐 왔다 갔다 하느냐로 갈리므로 첫 장이 같다 — 그런데도
   * 화면에서는 전혀 다르게 보인다. 여기서 재야 하는 것은 한 장이 아니라 **움직임**이다.
   *
   * 없는 갈래는 위에서 이미 실패로 잡았다. 여기서 또 터지면 나머지 검사가 통째로
   * 안 돌아서, 빠진 것 하나 때문에 이 파일이 아무것도 못 재게 된다.
   */
  const 움직임 = 문구갈래.filter((k) => 틀[k]).map((k) => [k, 틀[k].join('')]);
  const 겹친것 = [];
  for (let i = 0; i < 움직임.length; i++) {
    for (let j = i + 1; j < 움직임.length; j++) {
      if (움직임[i][1] === 움직임[j][1]) 겹친것.push(`${움직임[i][0]}=${움직임[j][0]}`);
    }
  }
  check('갈래마다 움직임이 다르다', 겹친것.length === 0, 겹친것.join(', '));

  // 한 장짜리는 그림이 아니라 그냥 글자다. 움직이는 것이 이 파일의 존재 이유다.
  const 안움직이는것 = Object.entries(틀).filter(([, 장들]) => new Set(장들).size < 2);
  check('모든 갈래가 실제로 움직인다', 안움직이는것.length === 0,
    안움직이는것.map(([k]) => k).join(', '));
}

trace('4-고르기');
// ── 틱을 어떻게 줘도 안 터지나 ──────────────────────────────────────────
{
  check('틱이 돌면 한 바퀴 돈다',
    그림고르기('쓰기', 0) === 그림고르기('쓰기', 틀.쓰기.length)
    && 그림고르기('쓰기', 1) !== 그림고르기('쓰기', 0));
  check('아주 큰 틱도 괜찮다', 틀.읽기.includes(그림고르기('읽기', 987654321)));
  // 음수는 안 올 것 같지만, 안 올 것 같은 값이 오는 것이 이런 자리다.
  check('음수 틱도 안 터진다', 틀.읽기.includes(그림고르기('읽기', -7)));
  check('소수점도 안 터진다', 틀.읽기.includes(그림고르기('읽기', 3.9)));
  check('모르는 갈래는 기본으로', 그림고르기('그런갈래없음', 0) === 틀.기본[0]);
  check('갈래를 안 줘도 안 터진다', 틀.기본.includes(그림고르기(undefined, 2)));

  // 오래 걸릴 때 쓰는 것은 느긋해야 한다. 빠르게 깜빡이면 더 조급해 보인다.
  check('느긋 갈래가 제일 천천히 돈다',
    틀.느긋.length >= Math.max(...Object.entries(틀).filter(([k]) => k !== '느긋')
      .map(([, v]) => v.length)),
    `느긋 ${틀.느긋.length}장 · 나머지 최대 ${Math.max(...Object.entries(틀)
      .filter(([k]) => k !== '느긋').map(([, v]) => v.length))}장`);
}

trace('5-끄기');
// ── 끌 수 있나 ──────────────────────────────────────────────────────────
//
// 점자가 안 나오는 터미널이 있고, 화면 읽기 프로그램에는 이런 것이 방해가 된다.
// 못 끄게 해 두면 그런 사람은 도구를 아예 못 쓴다.
{
  const 원래 = process.env.DEEL_NO_MOTION;
  process.env.DEEL_NO_MOTION = '1';
  const 껐을때 = 그림고르기('쓰기', 3);
  check('끄면 한 칸짜리로 돌아간다', [...껐을때].length === 1 && width(껐을때) === 1, 껐을때);
  check('꺼도 여전히 움직인다', 그림고르기('쓰기', 3) !== 그림고르기('쓰기', 4));
  if (원래 === undefined) delete process.env.DEEL_NO_MOTION; else process.env.DEEL_NO_MOTION = 원래;
  check('되돌리면 다시 그림', [...그림고르기('쓰기', 3)].length === 칸수);
}

trace('6-테마');
/*
 * ── 테마 ────────────────────────────────────────────────────────────────
 *
 * 기사·동물은 꾸미기지만, 깨뜨릴 수 있는 것은 기본과 똑같다. 폭이 어긋나면
 * 테두리가 떨리고, 갈래가 빠지면 조용히 기본으로 떨어진다. 그래서 위에서
 * 기본에 하던 검사를 **테마마다 그대로** 다시 돌린다. 새 테마를 넣는 사람이
 * 이 규칙을 몰라도 여기서 걸린다.
 */
{
  const 문구갈래 = Object.keys(문구);
  const 폭틀림 = [];
  const 격자틀림 = [];
  const 점자아닌것 = [];
  const 갈래빠짐 = [];
  const 안움직임 = [];
  const 겹친것 = [];
  const 느긋안느긋 = [];

  for (const [이름, t] of Object.entries(테마들)) {
    // 1. 폭 — 한 장이라도 어긋나면 그 순간 상자가 떨린다.
    for (const [갈래, 장들] of Object.entries(t.틀)) {
      for (const [i, g] of 장들.entries()) {
        if (width(g) !== t.칸수 || [...g].length !== t.칸수) {
          폭틀림.push(`${이름}/${갈래}[${i}] 폭 ${width(g)}·${[...g].length}자`);
        }
        for (const ch of g) {
          const cp = ch.codePointAt(0);
          if (cp < 0x2800 || cp > 0x28ff) 점자아닌것.push(`${이름}/${갈래}[${i}]`);
        }
      }
    }
    // 2. 원본 격자 — 한 줄이 짧으면 조용히 꺼진 것으로 채워져 '왜 저기가 비지' 가 된다.
    for (const [갈래, 장들] of Object.entries(t.그림들)) {
      for (const [i, g] of 장들.entries()) {
        if (g.length !== 세로) 격자틀림.push(`${이름}/${갈래}[${i}] ${g.length}줄`);
        for (const [r, 줄] of g.entries()) {
          if (줄.length !== t.가로) 격자틀림.push(`${이름}/${갈래}[${i}] ${r}행 ${줄.length}칸`);
        }
      }
    }
    // 3. 갈래 빠짐·남음 — working.js 의 문구와 짝이 맞아야 한다.
    for (const k of 문구갈래) if (!t.틀[k]) 갈래빠짐.push(`${이름}/${k} 없음`);
    for (const k of Object.keys(t.틀)) if (!문구갈래.includes(k)) 갈래빠짐.push(`${이름}/${k} 남음`);
    // 4. 실제로 움직이나 · 갈래끼리 다른가
    const 움직임 = [];
    for (const [갈래, 장들] of Object.entries(t.틀)) {
      if (new Set(장들).size < 2) 안움직임.push(`${이름}/${갈래}`);
      움직임.push([갈래, 장들.join('')]);
    }
    for (let i = 0; i < 움직임.length; i++) {
      for (let j = i + 1; j < 움직임.length; j++) {
        if (움직임[i][1] === 움직임[j][1]) 겹친것.push(`${이름}/${움직임[i][0]}=${움직임[j][0]}`);
      }
    }
    // 5. 느긋이 제일 길어야 한다 — 오래 기다릴 때 빨리 깜빡이면 더 조급해진다.
    const 남 = Math.max(...Object.entries(t.틀).filter(([k]) => k !== '느긋').map(([, v]) => v.length));
    if ((t.틀.느긋?.length ?? 0) < 남) 느긋안느긋.push(`${이름} 느긋 ${t.틀.느긋?.length}장 < ${남}장`);
  }

  check('테마마다 모든 장의 폭이 같다', 폭틀림.length === 0, 폭틀림.slice(0, 3).join(', '));
  check('테마마다 점자 말고는 안 섞인다', 점자아닌것.length === 0, 점자아닌것.slice(0, 3).join(', '));
  check('테마마다 격자에 딱 맞는다', 격자틀림.length === 0, 격자틀림.slice(0, 3).join(', '));
  check('테마마다 갈래가 문구와 짝이 맞는다', 갈래빠짐.length === 0, 갈래빠짐.slice(0, 3).join(', '));
  check('테마마다 모든 갈래가 움직인다', 안움직임.length === 0, 안움직임.slice(0, 3).join(', '));
  check('테마마다 갈래끼리 움직임이 다르다', 겹친것.length === 0, 겹친것.slice(0, 3).join(', '));
  check('테마마다 느긋이 제일 천천히 돈다', 느긋안느긋.length === 0, 느긋안느긋.join(', '));

  // 사람 모양은 세 칸에 넣으면 얼룩이 된다. 넓은 테마가 진짜로 넓은지 잰다.
  check('기사·동물은 기본보다 넓다',
    테마들.기사.칸수 > 테마들.기본.칸수 && 테마들.동물.칸수 > 테마들.기본.칸수,
    `기본 ${테마들.기본.칸수}칸 · 기사 ${테마들.기사.칸수}칸 · 동물 ${테마들.동물.칸수}칸`);
}

trace('7-테마고르기');
/*
 * 고르는 것이 실제로 먹히나. 그리고 **오타 하나로 프로그램이 안 뜨면 안 된다** —
 * 모르는 이름은 조용히 기본으로 가야 한다.
 */
{
  const 원래 = process.env.DEEL_MOTION;
  const 재보기 = (v) => {
    if (v === undefined) delete process.env.DEEL_MOTION; else process.env.DEEL_MOTION = v;
    return 테마이름();
  };

  check('안 주면 기본', 재보기(undefined) === '기본');
  check('한글로 고른다', 재보기('기사') === '기사' && 재보기('동물') === '동물');
  check('영어로도 고른다', 재보기('knight') === '기사' && 재보기('animal') === '동물');
  check('대문자도 받는다', 재보기('KNIGHT') === '기사', 재보기('KNIGHT'));
  check('앞뒤 빈칸도 받는다', 재보기('  기사  ') === '기사');
  check('모르는 이름은 조용히 기본', 재보기('그런테마없음') === '기본');
  check('빈 값도 기본', 재보기('') === '기본');

  // 고른 테마가 실제로 화면에 나오나 — 폭이 곧 눈에 보이는 차이다.
  재보기('기사');
  const 기사글 = 그림고르기('쓰기', 0);
  check('기사를 고르면 기사가 나온다', 테마들.기사.틀.쓰기.includes(기사글), 기사글);
  check('그때 폭도 같이 넓어진다', width(기사글) === 테마들.기사.칸수, `${width(기사글)}칸`);

  재보기(undefined);
  check('되돌리면 기본 폭', width(그림고르기('쓰기', 0)) === 칸수);

  // 끄기는 테마보다 세다. 점자가 안 나오는 자리에서는 테마가 무슨 소용인가.
  재보기('기사');
  const 끈것 = process.env.DEEL_NO_MOTION;
  process.env.DEEL_NO_MOTION = '1';
  check('테마를 골라도 끄기가 이긴다', width(그림고르기('쓰기', 3)) === 1, 그림고르기('쓰기', 3));
  if (끈것 === undefined) delete process.env.DEEL_NO_MOTION; else process.env.DEEL_NO_MOTION = 끈것;

  if (원래 === undefined) delete process.env.DEEL_MOTION; else process.env.DEEL_MOTION = 원래;
  check('검사가 환경을 안 더럽힌다', 테마이름() === '기본' && 테마() === 테마들.기본);
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n일하는 그림 검사  ${D}(90ms 마다 바뀌어도 상자가 안 흔들리는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);

// 무엇을 그린 것인지 눈으로도 한 번 보여 준다. 숫자만으로는 그림이 뒤집혀도 모른다.
console.log(`\n  ${D}갈래별 첫 두 장${X}`);
for (const [갈래, 장들] of Object.entries(틀)) {
  console.log(`    ${D}${갈래.padEnd(4)}${X} ${장들.slice(0, 4).join('  ')}   ${D}${장들.length}장${X}`);
}

console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
