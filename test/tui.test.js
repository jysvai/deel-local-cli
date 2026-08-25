// 입력 상자 검사.
//
// 왜 이 파일이 필요한가:
//   상자는 터미널일 때만 그려진다. 검사는 전부 파이프로 도니 이 코드는
//   한 번도 안 밟힌다 — '1,745개 통과' 가 '입력칸이 맞다' 를 전혀 뜻하지
//   않는 유일한 자리였다. 그래서 상자가 그릴 것을 값으로 내놓게 만들고
//   (프레임()), 그 값을 자로 잰다.
//
//   여기서 보는 것은 '예쁜가' 가 아니라 **'한 칸도 안 어긋나는가'** 다.
//   테두리가 한 칸 밀린 것은 사람 눈으로는 못 보고, 실제 터미널에서는
//   줄이 접혀 화면 전체가 무너진다. 커서가 한 칸 밀리면 백스페이스가
//   엉뚱한 자리를 지우는 것처럼 보인다.
//
// ── 한 번 틀렸던 길 ─────────────────────────────────────────────────────
//   처음에는 터미널을 통째로 빌려(대체 화면) 칸을 나눠 그렸다. 그랬더니
//   슬래시 명령이 전부 먹통이 됐다 — commands.js 를 비롯한 여섯 모듈이
//   화면 객체를 안 거치고 stdout 에 바로 쓰는데, 매번 화면을 통째로 다시
//   그리니 그 글이 찍히자마자 덮여 사라졌다. 지금은 대화를 그냥 흘려보내고
//   **입력 상자 몇 줄만** 우리가 지우고 다시 그린다.
import { c, width } from '../src/ui/ansi.js';
import { 상자쓸까, LineScreen, BoxScreen } from '../src/ui/screen.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 벗기기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

trace('1-켤지말지');

// ── 언제 켜고 언제 안 켜는가 ────────────────────────────────────────────
//
// 잘못 켜면 기록·CI 가 제어문자 덩어리가 된다. 애매하면 안 켜는 것이 맞다.
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
  check('터미널이면 켠다', 상자쓸까({ tui: null }) === true);
  check('--no-tui 면 안 켠다', 상자쓸까({ tui: false }) === false);

  흉내({ out: false });
  check('출력이 파이프면 안 켠다', 상자쓸까({ tui: null }) === false);
  // 여기가 핵심이다 — 사람이 --tui 를 줘도 파이프면 안 켠다.
  // 상자는 커서를 위로 올려 가며 자기가 그린 줄을 지운다. 그 앞자리가
  // 터미널이 아니면 제어문자가 그대로 글에 섞인다.
  check('파이프면 --tui 를 줘도 안 켠다', 상자쓸까({ tui: true }) === false);

  흉내({ in: false });
  check('입력이 파이프면 안 켠다 (검사·데모)', 상자쓸까({ tui: null }) === false);

  흉내({ cols: 30 });
  check('너무 좁으면 안 켠다', 상자쓸까({ tui: null }) === false);
  // 대체 화면을 안 쓰니 높이는 안 본다. 세 줄만 있으면 그릴 수 있다.
  흉내({ rows: 8 });
  check('낮은 창에서도 켠다 (칸을 안 나누니까)', 상자쓸까({ tui: null }) === true);

  흉내({ term: 'dumb' });
  check('옛 콘솔이면 안 켠다', 상자쓸까({ tui: null }) === false);
  흉내({ ci: '1' });
  check('CI 면 안 켠다', 상자쓸까({ tui: null }) === false);

  // 되돌린다. 뒤 검사들이 이 값을 본다.
  흉내({ out: 원래.out, in: 원래.in, cols: 원래.cols, rows: 원래.rows, term: 원래.term, ci: 원래.ci });
  check('줄화면은 언제나 만들어진다', new LineScreen().kind === 'line');
}

trace('2-접어쓰기');

const { 접어쓰기 } = await import('../src/ui/wrap.js');

// ── 색을 유지하면서 폭에 맞춰 접는가 ────────────────────────────────────
{
  check('짧으면 안 건드린다', 접어쓰기('가나다', 20).length === 1);
  check('없는 값도 안 터진다', Array.isArray(접어쓰기(null, 10)));
  check('폭이 말이 안 되면 통째로 돌려준다', 접어쓰기('가나다', 1).length === 1);

  // 한글은 두 칸이다. 이걸 틀리면 접힌 줄이 테두리를 밀어낸다.
  const 한글 = 접어쓰기('가'.repeat(30), 20);
  check('한글을 두 칸으로 세어 접는다', 한글.every((l) => width(l) <= 20),
    한글.map((l) => width(l)).join(','));
  check('접어도 글자를 안 잃는다', 한글.join('').replace(/\x1b\[[0-9;]*m/g, '') === '가'.repeat(30));

  // 색이 켜진 채로 접히면 다음 줄부터 색이 풀린다 — 화면이 얼룩덜룩해진다.
  const 색글 = 접어쓰기('\x1b[31m' + 'a'.repeat(30) + '\x1b[0m', 20);
  check('접힌 줄에도 색을 이어 준다', 색글.length === 2 && 색글[1].startsWith('\x1b[31m'),
    JSON.stringify(색글[1]?.slice(0, 12)));
  check('색 코드는 폭에 안 센다', 색글.every((l) => width(l) <= 20), 색글.map((l) => width(l)).join(','));

  // 들여쓴 글이 접히면 다음 줄도 그만큼 들여야 무엇에 딸린 글인지 안다.
  const 들여 = 접어쓰기('    └ ' + '나'.repeat(40), 24);
  check('접힌 줄이 앞 들여쓰기를 물려받는다', 들여.length > 1 && 들여[1].startsWith('    '),
    JSON.stringify(들여[1]?.slice(0, 8)));
}

trace('3-상자그리기');

const { 프레임, 안쪽최대 } = await import('../src/ui/inputbox.js');

// ── 테두리가 한 칸도 안 어긋나는가 ──────────────────────────────────────
{
  const 테두리폭 = (줄들) => [...new Set(줄들.filter((l) => /[╭╰│]/.test(l)).map((l) => width(l)))];

  for (const 칸 of [40, 60, 80, 100, 120, 200]) {
    const { 줄들 } = 프레임({ 글: '집계 함수 좀 줄여줘', 폭: 칸 });
    const 폭들 = 테두리폭(줄들);
    check(`${칸}칸에서 테두리가 한 벌이다`, 폭들.length === 1, 폭들.join(','));
    check(`${칸}칸을 안 넘는다`, 폭들[0] <= 칸, `${폭들[0]} / ${칸}`);
  }

  // 한글·영문이 섞여도 어긋나면 안 된다. 여기서 폭 계산이 제일 잘 틀린다.
  const 섞임 = 프레임({ 글: 'src/runner.js 의 console.log 를 logger 로 바꿔줘', 폭: 100 });
  check('한글·영문이 섞여도 안 어긋난다', 테두리폭(섞임.줄들).length === 1,
    테두리폭(섞임.줄들).join(','));

  const 빈것 = 프레임({ 글: '', 폭: 80 });
  check('빈 상자도 세 줄이 나온다', 빈것.줄들.length === 3, String(빈것.줄들.length));
  check('빈 상자에 ❯ 가 있다', /❯/.test(벗기기(빈것.줄들[1])), 벗기기(빈것.줄들[1]));

  // 상태줄·경고·곁말은 있을 때만 자리를 먹는다.
  const 다있음 = 프레임({ 글: '', 폭: 80, 상태: ' ▏폴더 ▏ auto', 경고: '⚠ 82%', 곁말: '/help 명령 목록' });
  check('상태줄·경고·곁말이 다 들어간다', 다있음.줄들.length === 6, String(다있음.줄들.length));
  check('상태줄이 상자 위에 온다', /폴더/.test(벗기기(다있음.줄들[0])), 벗기기(다있음.줄들[0]));
  check('곁말이 상자 아래에 온다', /help/.test(벗기기(다있음.줄들.at(-1))), 벗기기(다있음.줄들.at(-1)));
}

trace('4-접히는입력');

// ── 긴 글을 쳐도 안 잘리는가 ────────────────────────────────────────────
//
// 자르면 사람이 친 글이 안 보이는데, 안 보이는 채로 Enter 를 치게 되는 것이
// 제일 나쁘다 — 무엇을 보내는지 모르게 된다.
{
  const 긴글 = '사내 문서를 CP949 로 읽어서 UTF-8 로 되돌려 쓰는 스크립트를 만들어줘. '
    + '폴더 안 파일 전부에 대해서 하고, 원본은 백업 폴더에 남겨줘.';
  const { 줄들 } = 프레임({ 글: 긴글, 폭: 72 });
  const 안쪽 = 줄들.filter((l) => /│/.test(l));
  check('긴 글은 여러 줄로 접힌다', 안쪽.length >= 2, String(안쪽.length));
  check('접혀도 테두리가 안 어긋난다',
    [...new Set(안쪽.map((l) => width(l)))].length === 1,
    안쪽.map((l) => width(l)).join(','));
  const 담긴것 = 안쪽.map((l) => 벗기기(l).replace(/^ │ [❯…]? ?/, '').replace(/ +│$/, '')).join('');
  check('글자를 안 잃는다', 담긴것.replace(/\s/g, '') === 긴글.replace(/\s/g, ''), 담긴것.slice(0, 50));

  // 아주 길면 뒷부분만 보여 준다 — 화면을 다 먹으면 대화가 안 보인다.
  const 아주긴글 = '가나다라마바사아자차'.repeat(80);
  const 넘침 = 프레임({ 글: 아주긴글, 폭: 60 });
  const 넘침안쪽 = 넘침.줄들.filter((l) => /│/.test(l));
  check('아주 길어도 화면을 다 안 먹는다', 넘침안쪽.length <= 안쪽최대, String(넘침안쪽.length));
  check('잘렸으면 표시를 남긴다', /…/.test(벗기기(넘침안쪽[0])), 벗기기(넘침안쪽[0]).slice(0, 12));
}

trace('5-커서자리');

// ── 커서가 정확히 그 자리에 가는가 ──────────────────────────────────────
//
// 한 칸만 밀려도 백스페이스가 엉뚱한 자리를 지우는 것처럼 보인다.
// 글자 수가 아니라 **폭**으로 세야 한다 — 한글은 두 칸이다.
{
  const 빈것 = 프레임({ 글: '', 폭: 80 });
  check('빈 상자의 커서는 ❯ 다음 칸', 빈것.커서.열 === 6, String(빈것.커서.열));
  check('빈 상자의 커서는 마지막 줄 바로 위', 빈것.커서.위 === 1, String(빈것.커서.위));

  // 실제로 그 칸에 무엇이 있는지 확인한다 — 숫자만 맞추면 뜻이 없다.
  const 한줄 = 벗기기(빈것.줄들[1]);
  check('그 칸이 상자 안 첫 글자 자리다', 한줄.slice(0, 5) === ' │ ❯ ', JSON.stringify(한줄.slice(0, 6)));

  const 영문 = 프레임({ 글: 'hello', 커서: 5, 폭: 80 });
  check('영문 5글자면 5칸 간다', 영문.커서.열 === 11, String(영문.커서.열));

  // 한글 세 글자는 여섯 칸이다. 글자 수로 세면 여기서 세 칸이 밀린다.
  const 한글 = 프레임({ 글: '가나다', 커서: 3, 폭: 80 });
  check('한글 3글자면 6칸 간다 (두 칸짜리)', 한글.커서.열 === 12, String(한글.커서.열));

  // 커서가 글 중간에 있을 때 — 왼쪽 방향키를 눌렀을 때다.
  const 가운데 = 프레임({ 글: '가나다라마', 커서: 2, 폭: 80 });
  check('커서가 중간이면 그만큼만 간다', 가운데.커서.열 === 10, String(가운데.커서.열));
  check('커서가 중간이어도 글은 다 보인다', /가나다라마/.test(벗기기(가운데.줄들[1])), 벗기기(가운데.줄들[1]));

  // 접힌 뒤에도 맞아야 한다.
  const 접힘 = 프레임({ 글: '가'.repeat(60), 폭: 60 });
  check('접히면 커서가 마지막 줄에 있다', 접힘.커서.위 === 1, String(접힘.커서.위));
  const 접힘중간 = 프레임({ 글: '가'.repeat(60), 커서: 5, 폭: 60 });
  check('커서가 윗줄이면 위로 더 올라간다', 접힘중간.커서.위 > 1, String(접힘중간.커서.위));

  // 곁말이 있으면 그만큼 더 위로 올라가야 한다.
  const 곁말있음 = 프레임({ 글: '', 폭: 80, 곁말: '/help' });
  check('곁말이 있으면 한 줄 더 위', 곁말있음.커서.위 === 2, String(곁말있음.커서.위));

  // 커서가 테두리 밖으로 나가면 안 된다.
  const 꽉참 = 프레임({ 글: 'a'.repeat(200), 폭: 60 });
  check('커서가 테두리를 안 넘는다', 꽉참.커서.열 <= 59, String(꽉참.커서.열));
}

trace('6-상자화면');

// ── 대화는 줄화면과 한 글자도 다르지 않아야 한다 ────────────────────────
//
// 이게 이 파일에서 제일 중요한 자리다. 다르면 검사가 읽는 화면과 사람이
// 보는 화면이 갈라지고, 그때부터 검사는 아무것도 안 지켜 준다.
{
  const 진짜쓰기 = process.stdout.write.bind(process.stdout);
  const 잡기 = (fn) => {
    let v = '';
    process.stdout.write = (b) => { v += b; return true; };
    try { fn(); } finally { process.stdout.write = 진짜쓰기; }
    return v;
  };

  const 가짜상자 = { 지운횟수: 0, 그린것: null, 지우기() { this.지운횟수++; }, 그리기(s, 글, 커서) { this.그린것 = { 글, 커서 }; } };
  const 상자화면 = new BoxScreen(가짜상자);
  const 줄화면 = new LineScreen();

  check('상자화면임을 밝힌다', 상자화면.kind === 'box');

  const a = 잡기(() => 줄화면.줄('  ◧ Read(src/runner.js)'));
  const b = 잡기(() => 상자화면.줄('  ◧ Read(src/runner.js)'));
  check('대화 한 줄이 줄화면과 같다', a === b, JSON.stringify({ a, b }));

  const c1 = 잡기(() => 줄화면.붙임('이어지는 답'));
  const c2 = 잡기(() => 상자화면.붙임('이어지는 답'));
  check('이어 붙이는 것도 같다', c1 === c2, JSON.stringify({ c1, c2 }));

  // 글이 나가기 전에 상자를 걷어야 한다. 안 걷으면 새 글이 상자 위에 겹쳐
  // 찍히고, 다음에 지울 때 대화까지 같이 지워진다.
  가짜상자.지운횟수 = 0;
  잡기(() => { 상자화면.줄('한 줄'); 상자화면.붙임('조각'); });
  check('글이 나가기 전에 상자를 걷는다', 가짜상자.지운횟수 === 2, String(가짜상자.지운횟수));

  잡기(() => 상자화면.입력갱신(null, '치는 중', 3));
  check('치는 글을 상자에 넘긴다', 가짜상자.그린것?.글 === '치는 중' && 가짜상자.그린것?.커서 === 3,
    JSON.stringify(가짜상자.그린것));

  가짜상자.지운횟수 = 0;
  잡기(() => 상자화면.close());
  check('닫으면 상자를 걷는다', 가짜상자.지운횟수 >= 1, String(가짜상자.지운횟수));
}

trace('7-지우기');

// ── 그린 만큼만 정확히 지우는가 ─────────────────────────────────────────
//
// 여기가 제일 조용히 망가지는 자리다. 한 줄이라도 더 지우면 **위쪽 대화가
// 한 줄씩 갉여 나가고**, 덜 지우면 상자가 화면에 겹겹이 쌓인다. 둘 다
// "화면이 좀 이상한데" 로만 보이고 원인은 안 보인다.
{
  const { InputBox } = await import('../src/ui/inputbox.js');
  const 진짜쓰기 = process.stdout.write.bind(process.stdout);
  const 잡기 = (fn) => {
    let v = '';
    process.stdout.write = (b) => { v += b; return true; };
    try { fn(); } finally { process.stdout.write = 진짜쓰기; }
    return v;
  };
  Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true });

  // 위로 몇 줄, 아래로 몇 줄 움직였는지 센다.
  const 셈 = (글) => ({
    위: [...글.matchAll(/\x1b\[(\d*)A/g)].reduce((n, m) => n + (Number(m[1] || 1)), 0),
    아래: [...글.matchAll(/\x1b\[(\d*)B/g)].reduce((n, m) => n + (Number(m[1] || 1)), 0),
    지움: (글.match(/\x1b\[K/g) ?? []).length,
  });

  {
    const b = new InputBox();
    const 그림 = 잡기(() => b.그리기(null, '', 0));
    check('한 줄 상자는 세 줄이다', b.그린줄 === 3, String(b.그린줄));
    check('커서를 아래에서 한 줄 위에 둔다', b.커서위 === 1, String(b.커서위));
    const 지움 = 잡기(() => b.지우기());
    const s = 셈(지움);
    check('그린 줄만큼만 지운다', s.지움 === 3, JSON.stringify(s));
    // 커서가 아래에서 1줄 위 → 1줄 내려간 뒤 2줄만 올라오면 맨 윗줄에 선다.
    check('내려간 만큼만 올라온다', s.아래 === 1 && s.위 === 2, JSON.stringify(s));
    check('지우고 나면 아무것도 안 남았다고 안다', b.그린줄 === 0 && b.커서위 === 0);
    check('두 번 지워도 아무 일 없다', 잡기(() => b.지우기()) === '');
    void 그림;
  }

  {
    // 곁말이 붙으면 커서가 한 줄 더 위에 선다. 내려가는 수도 같이 늘어야 한다.
    const b = new InputBox();
    b.곁말 = '/help 명령 목록';
    잡기(() => b.그리기(null, '', 0));
    check('곁말이 있으면 네 줄이다', b.그린줄 === 4, String(b.그린줄));
    check('곁말이 있으면 커서가 두 줄 위', b.커서위 === 2, String(b.커서위));
    const s = 셈(잡기(() => b.지우기()));
    check('곁말까지 지운다', s.지움 === 4, JSON.stringify(s));
    check('곁말이 있어도 내려간 만큼만 올라온다', s.아래 === 2 && s.위 === 3, JSON.stringify(s));
  }

  {
    // 긴 글이 접혀 상자가 커진 경우. 고정값으로 내려가면 여기서 어긋난다.
    const b = new InputBox();
    잡기(() => b.그리기(null, '가'.repeat(120), 240));
    const 몇줄 = b.그린줄;          // 지우면 0 이 되므로 미리 들고 있는다
    const 커서위 = b.커서위;
    check('접히면 상자가 커진다', 몇줄 > 3, String(몇줄));
    const s = 셈(잡기(() => b.지우기()));
    check('커진 만큼 다 지운다', s.지움 === 몇줄, `${s.지움} / ${몇줄}`);
    check('접혀도 내려간 만큼만 올라온다', s.아래 === 커서위 && s.위 === 몇줄 - 1,
      `${JSON.stringify(s)} · 커서위 ${커서위} · ${몇줄}줄`);
  }

  Object.defineProperty(process.stdout, 'columns', { value: undefined, configurable: true });
}

trace('8-못세울때');

// ── 상자를 못 세우면 조용히 줄화면으로 가는가 ───────────────────────────
//
// 화면 하나 때문에 프로그램이 안 뜨면 안 된다.
{
  const { 화면고르기 } = await import('../src/ui/screen.js');
  const 원래 = { out: process.stdout.isTTY, in: process.stdin.isTTY, cols: process.stdout.columns };
  const 터미널인척 = (켬) => {
    Object.defineProperty(process.stdout, 'isTTY', { value: 켬, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: 켬, configurable: true });
    Object.defineProperty(process.stdout, 'columns', { value: 100, configurable: true });
    delete process.env.TERM; delete process.env.CI;
  };

  터미널인척(false);
  const 줄 = await 화면고르기({ tui: null });
  check('파이프면 줄화면을 준다', 줄.kind === 'line', 줄.kind);

  터미널인척(true);
  const 상자 = await 화면고르기({ tui: null });
  check('터미널이면 상자화면을 준다', 상자.kind === 'box', 상자.kind);
  check('상자화면도 줄화면의 성질을 그대로 갖는다', 상자 instanceof LineScreen);

  Object.defineProperty(process.stdout, 'isTTY', { value: 원래.out, configurable: true });
  Object.defineProperty(process.stdin, 'isTTY', { value: 원래.in, configurable: true });
  Object.defineProperty(process.stdout, 'columns', { value: 원래.cols, configurable: true });
}

trace('9-줄화면의임시글');

// ── 줄화면도 지울 것은 지우는가 ─────────────────────────────────────────
//
// '생각 중…' 이 안 지워진 채 답이 뒤에 붙는 화면을 없애려고 넣은 자리다.
// 터미널일 때만 지운다 — 파이프에서 지우기 제어문자를 뱉으면 기록이 더러워진다.
{
  const s = new LineScreen();
  const 진짜쓰기 = process.stdout.write.bind(process.stdout);
  const 잡기 = () => { let v = ''; process.stdout.write = (b) => { v += b; return true; }; return () => v; };

  /*
   * 지우기 제어문자를 낼지는 ansi.js 가 **불러올 때** 한 번 정한다
   * (isTTY 이거나 FORCE_COLOR=1). 나중에 isTTY 를 흉내 내도 그건 안 바뀐다.
   *
   * 그래서 여기서는 '늘 지운다' 가 아니라 **'색을 쓰는 자리에서만 지운다'**
   * 를 잰다. 색을 끈 자리에 지우기 문자가 나가면 기록 파일이 더러워지고,
   * 켠 자리에서 안 나가면 '생각 중…' 이 답 앞에 남는다 — 둘 다 실제로 겪었다.
   */
  const 제어켜짐 = c.gray('가') !== '가';

  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  let 본것 = 잡기();
  s.생각('첫 판단·medium 생각 중…');
  const 생각글 = 본것();
  process.stdout.write = 진짜쓰기;
  check('터미널이면 생각 중을 찍는다', /생각 중…/.test(생각글), JSON.stringify(생각글));
  check(제어켜짐 ? '찍기 전에 줄을 지운다' : '색을 껐으면 지우기 문자를 안 낸다',
    제어켜짐 ? 생각글.includes('\x1b[2K\r') : !생각글.includes('\x1b['),
    JSON.stringify(생각글));
  check('지울 것이 있다고 적어 둔다', s.임시중 === true);

  본것 = 잡기();
  s.임시지움();
  process.stdout.write = 진짜쓰기;
  check('지우면 지울 것이 없어진다', s.임시중 === false);

  본것 = 잡기();
  s.입력지움();
  const 입력글 = 본것();
  process.stdout.write = 진짜쓰기;
  check(제어켜짐 ? '치던 입력 줄도 지운다' : '색을 껐으면 입력 줄도 안 건드린다',
    제어켜짐 ? 입력글.includes('\x1b[2K\r') : 입력글 === '',
    JSON.stringify(입력글));

  // 파이프에서는 아무것도 안 나가야 한다.
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  본것 = 잡기();
  s.생각('안 보여야 한다');
  const 파이프글 = 본것();
  process.stdout.write = 진짜쓰기;
  check('파이프면 생각 중을 안 찍는다', 파이프글 === '', JSON.stringify(파이프글));
  check('파이프면 지울 것도 안 남긴다', s.임시중 === false);

  // 줄화면은 사람이 치는 것을 readline 이 되비춘다. 불러도 안 터져야 한다.
  본것 = 잡기();
  s.입력갱신(null, '아무거나', 2);
  const 갱신글 = 본것();
  process.stdout.write = 진짜쓰기;
  check('줄화면은 입력갱신에 아무것도 안 한다', 갱신글 === '', JSON.stringify(갱신글));

  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
}

trace('10-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n입력 상자 검사  ${D}(검사가 파이프로 도니 화면을 값으로 재 본다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
