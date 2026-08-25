// 전체화면(TUI) 검사.
//
// 왜 이 파일이 필요한가:
//   TUI 는 터미널일 때만 켜진다. 검사는 전부 파이프로 돌아가니 이 코드는
//   한 번도 안 밟힌다 — '1,519개 통과' 가 '전체화면이 맞다' 를 전혀 뜻하지
//   않는 유일한 자리였다. 그래서 TuiScreen 이 그릴 화면을 값으로 내놓게
//   만들고(프레임()), 그 값을 자로 잰다.
//
//   여기서 보는 것은 '예쁜가' 가 아니라 **'한 칸도 안 어긋나는가'** 다.
//   테두리가 한 칸 밀린 것은 사람 눈으로는 못 보고, 실제 터미널에서는
//   줄이 접혀 화면 전체가 무너진다.
import { width } from '../src/ui/ansi.js';
import { 전체화면쓸까, LineScreen } from '../src/ui/screen.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 벗기기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

trace('1-켤지말지');

// ── 언제 켜고 언제 안 켜는가 ────────────────────────────────────────────
//
// 잘못 켜면 사용자 화면이 제어문자로 뒤덮인다. 잘못 안 켜면 그냥 지금까지의
// 화면일 뿐이다. 그래서 애매하면 안 켜는 쪽이 맞다.
{
  const 원래 = {
    out: process.stdout.isTTY, in: process.stdin.isTTY,
    cols: process.stdout.columns, rows: process.stdout.rows,
    term: process.env.TERM, ci: process.env.CI,
  };
  const 흉내 = (o) => {
    Object.defineProperty(process.stdout, 'isTTY', { value: o.out ?? true, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: o.in ?? true, configurable: true });
    Object.defineProperty(process.stdout, 'columns', { value: o.cols ?? 100, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: o.rows ?? 30, configurable: true });
    if (o.term === undefined) delete process.env.TERM; else process.env.TERM = o.term;
    if (o.ci === undefined) delete process.env.CI; else process.env.CI = o.ci;
  };

  흉내({});
  check('터미널이면 켠다', 전체화면쓸까({ tui: null }) === true);
  check('--no-tui 면 안 켠다', 전체화면쓸까({ tui: false }) === false);

  흉내({ out: false });
  check('출력이 파이프면 안 켠다', 전체화면쓸까({ tui: null }) === false);
  // 여기가 핵심이다 — 사람이 --tui 를 줘도 파이프면 안 켠다.
  // 켜면 기록·CI 가 제어문자 덩어리가 된다.
  check('파이프면 --tui 를 줘도 안 켠다', 전체화면쓸까({ tui: true }) === false);

  흉내({ in: false });
  check('입력이 파이프면 안 켠다 (검사·데모)', 전체화면쓸까({ tui: null }) === false);

  흉내({ cols: 50 });
  check('창이 좁으면 안 켠다', 전체화면쓸까({ tui: null }) === false);
  흉내({ rows: 10 });
  check('창이 낮으면 안 켠다', 전체화면쓸까({ tui: null }) === false);

  흉내({ term: 'dumb' });
  check('옛 콘솔이면 안 켠다', 전체화면쓸까({ tui: null }) === false);
  흉내({ ci: '1' });
  check('CI 면 안 켠다', 전체화면쓸까({ tui: null }) === false);

  // 되돌린다. 뒤 검사들이 이 값을 본다.
  흉내({ out: 원래.out, in: 원래.in, cols: 원래.cols, rows: 원래.rows, term: 원래.term, ci: 원래.ci });
  check('줄화면은 언제나 만들어진다', new LineScreen().kind === 'line');
}

trace('2-접어쓰기');

const { 접어쓰기, TuiScreen } = await import('../src/ui/tui.js');

// ── 색을 유지하면서 폭에 맞춰 접는가 ────────────────────────────────────
{
  check('짧으면 안 건드린다', 접어쓰기('가나다', 20).length === 1);
  check('없는 값도 안 터진다', Array.isArray(접어쓰기(null, 10)));
  check('폭이 말이 안 되면 통째로 돌려준다', 접어쓰기('가나다', 1).length === 1);

  // 한글은 두 칸이다. 이걸 틀리면 접힌 줄이 테두리를 밀어낸다.
  const 한글 = 접어쓰기('가'.repeat(30), 20);
  check('한글을 두 칸으로 세서 접는다', 한글.every((l) => width(l) <= 20),
    한글.map((l) => width(l)).join(', '));
  check('접어도 글자를 안 잃는다', 한글.join('').replace(/\s/g, '') === '가'.repeat(30),
    String(한글.join('').replace(/\s/g, '').length));

  // 색 코드는 폭이 0 이다. 세면 줄이 쓸데없이 일찍 접힌다.
  const 색글 = 접어쓰기('\x1b[31m' + 'a'.repeat(30) + '\x1b[0m', 20);
  check('색 코드는 폭으로 안 센다', 색글.every((l) => width(l) <= 20),
    색글.map((l) => width(l)).join(', '));
  check('접힌 줄에도 색을 다시 켠다', /\x1b\[31m/.test(색글[1] ?? ''),
    JSON.stringify(색글[1] ?? ''));

  // 들여쓰기를 물려주지 않으면 접힌 순간 세로줄이 끊긴다.
  const 들여 = 접어쓰기('    └ ' + '나'.repeat(40), 24);
  check('접힌 줄이 앞 들여쓰기를 물려받는다', 들여.slice(1).every((l) => l.startsWith('    ')),
    JSON.stringify(들여[1] ?? ''));
  check('들여쓰고도 폭을 안 넘는다', 들여.every((l) => width(l) <= 24),
    들여.map((l) => width(l)).join(', '));
}

trace('3-화면그리기');

// ── 화면 한 장이 창에 정확히 들어맞는가 ─────────────────────────────────
function 화면세우기(열, 행) {
  Object.defineProperty(process.stdout, 'columns', { value: 열, configurable: true });
  Object.defineProperty(process.stdout, 'rows', { value: 행, configurable: true });
  const 진짜 = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;      // 딴 화면으로 넘어가는 제어문자를 삼킨다
  const s = new TuiScreen();
  process.stdout.write = 진짜;
  s.닫힘 = true;                          // 이 뒤로는 그리지 않고 값만 본다
  return s;
}

{
  for (const [열, 행] of [[104, 30], [80, 24], [120, 40], [96, 16], [60, 16]]) {
    const s = 화면세우기(열, 행);
    s.머리말(['deel  OpenAI 호환 규격', '모델    qwen2.5-coder:7b']);
    s.줄('  ◈ Edit(src/runner.js)');
    s.줄('    └ 1군데 +3-1');
    s.붙임('  ▌ ');
    s.붙임('한글이 섞인 긴 답입니다. '.repeat(6));
    s.파일칸(['src/runner.js +3-1', 'src/index.js +1-1']);
    s.할일칸(['☑ 로그 형식 통일', '▶ 문서 갱신']);
    s.상태 = ' ▏myproject · qwen3-8b';

    const { 줄들, 커서 } = s.프레임();
    const 틀린줄 = 줄들
      .map((l, i) => [i + 1, width(l)])
      .filter(([i, w]) => w !== 열 && /[┌└│├┬┴┐┘╭╰╮╯]/.test(벗기기(줄들[i - 1])));

    check(`${열}×${행}: 테두리가 한 칸도 안 어긋난다`, 틀린줄.length === 0,
      틀린줄.map(([i, w]) => `${i}행 ${w}칸`).join(', '));
    check(`${열}×${행}: 화면이 창을 안 넘는다`, 줄들.length <= 행, `${줄들.length}줄`);
    check(`${열}×${행}: 커서가 입력 상자 안에 있다`,
      커서.행 === 줄들.length - 1 && 커서.열 >= 3, JSON.stringify(커서));

    s.close();
  }
}

// 좁으면 오른쪽 칸을 접는다. 억지로 나누면 글자가 겹친다.
{
  const 넓 = 화면세우기(120, 30);
  넓.파일칸(['src/a.js +1-0']);
  const 넓글 = 벗기기(넓.프레임().줄들.join('\n'));
  check('넓으면 오른쪽 칸을 그린다', /바뀐 파일/.test(넓글) && /src\/a\.js/.test(넓글));
  넓.close();

  const 좁 = 화면세우기(80, 24);
  좁.파일칸(['src/a.js +1-0']);
  const 좁글 = 벗기기(좁.프레임().줄들.join('\n'));
  check('좁으면 오른쪽 칸을 접는다', !/바뀐 파일/.test(좁글), 좁글.split('\n')[0]);
  좁.close();
}

trace('4-대화담기');

// ── 흘러온 글을 제대로 쌓는가 ───────────────────────────────────────────
{
  const s = 화면세우기(100, 30);

  // 스트리밍은 한 줄에 이어 붙어야 한다. 조각마다 줄이 바뀌면 답이 세로로 흩어진다.
  s.붙임('가나');
  s.붙임('다라');
  check('스트리밍 조각은 한 줄로 이어 붙는다', s.줄버퍼.length === 0 && s.열린줄 === '가나다라',
    JSON.stringify(s.열린줄));

  // 조각 안에 줄바꿈이 있으면 그 자리에서 줄을 맺는다.
  s.붙임('마\n바');
  check('조각 속 줄바꿈에서 줄을 맺는다', s.줄버퍼.at(-1) === '가나다라마' && s.열린줄 === '바',
    JSON.stringify([s.줄버퍼.at(-1), s.열린줄]));

  s.줄('다음 줄');
  check('줄() 은 열린 줄을 먼저 맺는다', s.줄버퍼.at(-2) === '바' && s.줄버퍼.at(-1) === '다음 줄',
    JSON.stringify(s.줄버퍼.slice(-2)));

  // '생각 중…' 은 곧 지워질 표시다. 대화에 남으면 안 된다.
  const 앞길이 = s.줄버퍼.length;
  s.생각('생각 중… 120자');
  check('생각 중은 화면에 보인다', /생각 중/.test(벗기기(s.프레임().줄들.join('\n'))));
  check('생각 중은 대화에 안 쌓인다', s.줄버퍼.length === 앞길이, String(s.줄버퍼.length));
  s.임시지움();
  check('지우면 화면에서도 사라진다', !/생각 중/.test(벗기기(s.프레임().줄들.join('\n'))));

  // 오래된 줄은 버린다. 안 버리면 몇 시간 쓴 뒤 메모리가 계속 는다.
  for (let i = 0; i < 5000; i++) s.줄(`줄 ${i}`);
  check('대화 버퍼가 무한정 안 커진다', s.줄버퍼.length <= 4000, String(s.줄버퍼.length));
  check('버릴 때 최근 것을 남긴다', s.줄버퍼.at(-1) === '줄 4999', String(s.줄버퍼.at(-1)));

  // 최근 것이 화면에 보여야 한다 — 늘 아래를 따라간다.
  check('화면은 최근 줄을 보여 준다', /줄 4999/.test(벗기기(s.프레임().줄들.join('\n'))));

  s.close();
}

trace('5-나갈때');

// ── 나갈 때 대화를 되살리는가 ───────────────────────────────────────────
//
// 전체화면은 vim 처럼 딴 화면을 쓴다. 그냥 나가면 방금 나눈 대화가 통째로
// 사라진다 — 스크롤을 올려도 없다. 코딩 도구에서 "방금 뭐라고 했더라" 를
// 못 찾는 건 곤란하다.
{
  const s = 화면세우기(100, 30);
  s.닫힘 = false;                     // 진짜로 닫아 본다
  s.줄('첫 줄');
  s.붙임('안 맺은 줄');

  const 진짜 = process.stdout.write.bind(process.stdout);
  let 나간것 = '';
  process.stdout.write = (x) => { 나간것 += String(x); return true; };
  s.close();
  process.stdout.write = 진짜;

  const 글 = 벗기기(나간것);
  check('원래 화면으로 되돌린다', /\x1b\[\?1049l/.test(나간것));
  check('나눈 대화를 스크롤백에 되살린다', /첫 줄/.test(글), 글.slice(0, 80));
  check('안 맺은 줄도 되살린다', /안 맺은 줄/.test(글), glimpse(글));
  check('두 번 닫아도 안 터진다', (() => { try { s.close(); return true; } catch { return false; } })());

  function glimpse(x) { return x.replace(/\n/g, '⏎').slice(0, 80); }
}

// 줄이 아주 많으면 다 쏟지 않는다. 몇만 줄을 터미널에 붓는 것은 되살리기가 아니다.
{
  const s = 화면세우기(100, 30);
  s.닫힘 = false;
  for (let i = 0; i < 2000; i++) s.줄(`줄 ${i}`);

  const 진짜 = process.stdout.write.bind(process.stdout);
  let 나간것 = '';
  process.stdout.write = (x) => { 나간것 += String(x); return true; };
  s.close();
  process.stdout.write = 진짜;

  const 줄수 = 벗기기(나간것).split('\n').length;
  check('아주 길면 뒷부분만 되살린다', 줄수 < 700, `${줄수}줄`);
  check('줄였으면 줄였다고 말한다', /줄였습니다/.test(벗기기(나간것)));
  check('되살린 것은 가장 최근 줄로 끝난다', /줄 1999/.test(벗기기(나간것)));
}

// ── 터지거나 죽어도 터미널을 되돌리는가 ─────────────────────────────────
//
// 이게 없으면 프로그램이 터졌을 때 사용자 터미널이 딴 화면에 갇힌 채 남는다.
// 커서도 숨겨진 그대로라 친 글자도 안 보인다 — 터미널을 닫는 수밖에 없다.
// 우리 잘못으로 남의 창을 못 쓰게 만드는 셈이라, 어떻게 끝나든 되돌려야 한다.
{
  const 앞 = { exit: process.listenerCount('exit'), 터짐: process.listenerCount('uncaughtException') };
  const s = 화면세우기(100, 30);
  s.닫힘 = false;
  check('나갈 때 되돌리도록 걸어 둔다', process.listenerCount('exit') > 앞.exit);
  check('터질 때도 되돌리도록 걸어 둔다', process.listenerCount('uncaughtException') > 앞.터짐);

  // 되돌리기를 직접 불러 본다 — 죽는 길에 불리는 그 함수다.
  const 진짜 = process.stdout.write.bind(process.stdout);
  let 나간것 = '';
  process.stdout.write = (x) => { 나간것 += String(x); return true; };
  s.되돌리기();
  process.stdout.write = 진짜;
  check('죽는 길에도 원래 화면으로 되돌린다', /\x1b\[\?1049l/.test(나간것), JSON.stringify(나간것));

  s.닫힘 = false;
  s.close();
  check('닫으면 걸어 둔 것을 도로 뗀다',
    process.listenerCount('exit') === 앞.exit && process.listenerCount('uncaughtException') === 앞.터짐,
    `${process.listenerCount('exit')} / ${process.listenerCount('uncaughtException')}`);
}

trace('6-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n전체화면 검사  ${D}(검사가 파이프로 도니 화면을 값으로 재 본다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
