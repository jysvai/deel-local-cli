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
import { 추천, 채울글 } from '../src/ui/complete.js';
import { 다음 as 승인다음, 차례 as 승인차례, 고르기 as 승인고르기 } from '../src/ui/approve.js';
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

  const 가짜상자 = {
    지운횟수: 0, 그린것: null, 일감: null,
    지우기() { this.지운횟수++; },
    그리기(s, 글, 커서) { this.그린것 = { 글, 커서 }; },
    // 일하는 중이면 글이 나간 뒤에 상자를 다시 세운다. 안 세우면 첫 도구
    // 결과가 찍히는 순간 상자가 사라지고, 일이 끝날 때까지 화면 아래가 빈다.
    일그리기() { this.다시세움 = (this.다시세움 ?? 0) + 1; },
    일시작() { this.일감 = {}; }, 일바꿈() {}, 일끝() { this.일감 = null; },
  };
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

trace('6.5-일하는중');

// ── 일하는 중에도 상자가 살아 있는가 ────────────────────────────────────
//
// 로컬 모델은 느리다. 한 걸음에 수십 초가 걸리는데 그 동안 화면 아래가 텅
// 비어 있으면 사람은 멈춘 줄 알고 Ctrl+C 를 누른다 — 다 되어 가던 일이 날아간다.
{
  const { 갈래고르기, 문구고르기, 문구, 걸린시간 } = await import('../src/ui/working.js');

  // 문구는 지금 진짜로 하는 일을 따라가야 한다. 아무 말이나 돌려 대면
  // 두 번째부터 아무도 안 읽고, 그때부터는 화면이 조용한 것과 같아진다.
  check('파일을 읽으면 읽는다고 한다', 갈래고르기('Read') === '읽기');
  check('찾는 것도 읽기다', 갈래고르기('Grep') === '읽기' && 갈래고르기('Glob') === '읽기');
  check('고치면 쓴다고 한다', 갈래고르기('Edit') === '쓰기' && 갈래고르기('Write') === '쓰기');
  check('명령은 명령이라고 한다', 갈래고르기('Bash') === '명령');
  check('웹 읽기는 따로 본다', 갈래고르기('WebFetch') === '웹');
  // 밖에서 붙인 도구는 무엇을 하는지 우리가 모른다. 아는 척하면 안 된다.
  check('밖에서 붙인 도구는 모른다고 둔다', 갈래고르기('mcp__사내위키__검색') === '기본');
  check('없는 이름도 안 터진다', 갈래고르기(null) === '기본' && 갈래고르기('없는것') === '기본');

  // 같은 글자가 30초 그대로면 그것도 멈춘 것처럼 보인다. 돌려 가며 쓴다.
  const 첫째 = 문구고르기('읽기', 0);
  const 둘째 = 문구고르기('읽기', 1);
  check('회차가 늘면 문구가 바뀐다', 첫째 !== 둘째, `${첫째} → ${둘째}`);
  check('한 바퀴 돌면 처음으로', 문구고르기('읽기', 문구.읽기.length) === 첫째);
  check('없는 갈래는 기본으로 떨어진다', 문구.기본.includes(문구고르기('없는갈래', 0)));
  check('문구가 다 말이 된다', Object.values(문구).flat().every((t) => /중$|더$/.test(t)),
    Object.values(문구).flat().filter((t) => !/중$|더$/.test(t)).join(','));

  check('걸린 시간은 초로', 걸린시간(12_000) === '12초', 걸린시간(12_000));
  // 90초보다 1분 30초가 읽힌다.
  check('1분이 넘으면 분까지', 걸린시간(90_000) === '1분 30초', 걸린시간(90_000));

  // 상자 안엣것만 바뀌고 테두리는 그대로여야 한다.
  const 일감 = { 돌림: '⠹', 말: '파일 들여다보는 중', 곁: '12초 · Ctrl+C 중단' };
  const { 줄들, 커서: 자리 } = 프레임({ 폭: 100, 일감 });
  const 안쪽 = 줄들.filter((l) => /│/.test(l) && !/╭|╰/.test(l));
  check('일하는 중에도 상자는 세 줄', 줄들.length === 3, String(줄들.length));
  check('일하는 중에는 ❯ 가 없다', !/❯/.test(벗기기(안쪽[0])), 벗기기(안쪽[0]));
  check('돌아가는 표시가 들어간다', /⠹/.test(안쪽[0]), 벗기기(안쪽[0]).slice(0, 20));
  check('무슨 일을 하는지 적는다', /파일 들여다보는 중…/.test(벗기기(안쪽[0])), 벗기기(안쪽[0]));
  check('걸린 시간과 중단 안내를 오른쪽에', /12초 · Ctrl\+C 중단/.test(벗기기(안쪽[0])), 벗기기(안쪽[0]));
  check('일하는 중에도 테두리가 안 어긋난다',
    [...new Set(줄들.filter((l) => /[╭╰│]/.test(l)).map((l) => width(l)))].length === 1,
    줄들.map((l) => width(l)).join(','));
  // 칠 자리가 아니므로 커서를 상자 안에 두지 않는다.
  check('일하는 중에는 커서를 안 세운다', 자리.위 === 0, JSON.stringify(자리));

  // 좁은 창에서는 오른쪽(걸린 시간)을 버리고 본문을 지킨다.
  const 좁게 = 프레임({ 폭: 42, 일감 });
  const 좁은안쪽 = 좁게.줄들.filter((l) => /│/.test(l) && !/╭|╰/.test(l));
  check('좁아도 테두리가 안 어긋난다',
    [...new Set(좁게.줄들.filter((l) => /[╭╰│]/.test(l)).map((l) => width(l)))].length === 1,
    좁게.줄들.map((l) => width(l)).join(','));
  check('좁으면 걸린 시간을 버리고 본문을 지킨다',
    /들여다보는/.test(벗기기(좁은안쪽[0])), 벗기기(좁은안쪽[0]));
}

trace('6.6-시계를안남긴다');

// ── 돌아가는 표시가 프로그램을 붙잡으면 안 된다 ─────────────────────────
//
// 시계를 안 거두면 deel 을 껐는데도 안 꺼진다. 사람 눈에는 '끝냅니다' 가
// 찍힌 뒤로 터미널이 안 돌아오는 것으로 보인다.
{
  const { InputBox } = await import('../src/ui/inputbox.js');
  const 진짜쓰기 = process.stdout.write.bind(process.stdout);
  const 삼키고 = (fn) => { process.stdout.write = () => true; try { return fn(); } finally { process.stdout.write = 진짜쓰기; } };

  const b = new InputBox();
  삼키고(() => b.일시작(null, '읽기'));
  check('일을 시작하면 시계가 돈다', b.박자 !== null);
  check('일감을 들고 있다', b.일감?.갈래 === '읽기', JSON.stringify(b.일감));

  삼키고(() => b.일바꿈('쓰기', '생각 1,200자'));
  check('하는 일이 바뀌면 갈래도 바뀐다', b.일감?.갈래 === '쓰기', b.일감?.갈래);
  check('곁정보를 들고 있다', b.일감?.곁정보 === '생각 1,200자', b.일감?.곁정보);

  삼키고(() => b.일끝());
  check('끝나면 시계를 거둔다', b.박자 === null);
  check('끝나면 일감도 없앤다', b.일감 === null);
  check('끝나면 상자도 걷는다', b.그린줄 === 0);
  // 일하는 중이 아닐 때 불러도 아무 일이 없어야 한다.
  check('일감이 없으면 일바꿈은 아무 일도 안 한다', 삼키고(() => { b.일바꿈('읽기'); return b.일감; }) === null);
  check('두 번 끝내도 안 터진다', 삼키고(() => { b.일끝(); return true; }) === true);
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

trace('9.5-자동완성');

// ── 슬래시 명령 자동완성 ────────────────────────────────────────────────
//
// 값으로 잰다. 화면으로 재면 "목록이 떴다" 까지만 알 수 있는데, 정작 중요한
// 것은 **Tab 을 눌렀을 때 무엇이 채워지느냐** 다 — 하나 골라 박아 넣으면
// 사람이 원한 것이 아닐 때 지우는 수고가 더 든다.
{
  const 표 = {
    help: { desc: '명령 목록' },
    mode: { desc: '승인 정책', arg: '<모드>' },
    model: { desc: '연결·모델 바꾸기', arg: '[이름]' },
    memory: { desc: '기억' },
    clear: { desc: '대화 비우기' },
    undo: { desc: '되돌리기', arg: '[턴수]' },
  };
  const 이름들 = (xs) => xs.map((x) => x.이름).join(',');

  check('슬래시가 아니면 아무것도 안 준다', 추천('안녕', 표).length === 0);
  check('빈 줄에서도 안 준다', 추천('', 표).length === 0);
  check('슬래시만 치면 전부 준다', 추천('/', 표).length === 6, 이름들(추천('/', 표)));
  // 인자를 치기 시작하면 명령은 이미 정해진 것이다.
  check('빈칸을 치면 목록을 접는다', 추천('/mode ', 표).length === 0);
  check('경로는 명령이 아니다', 추천('/usr/local', 표).length === 0);

  check('앞에서 맞는 것이 먼저', 이름들(추천('/mo', 표)) === 'mode,model,memory', 이름들(추천('/mo', 표)));
  check('가운데 맞는 것도 준다 (앞글자 오타)', 이름들(추천('/em', 표)) === 'memory', 이름들(추천('/em', 표)));
  check('대소문자를 안 가린다', 이름들(추천('/MO', 표)) === 'mode,model,memory');
  check('설명도 같이 온다', 추천('/help', 표)[0].설명 === '명령 목록');
  check('인자도 같이 온다', 추천('/mode', 표)[0].인자 === '<모드>');

  check('여럿이면 같은 데까지만 채운다', 채울글('/mo', 추천('/mo', 표)) === 'de',
    JSON.stringify(채울글('/mo', 추천('/mo', 표))));
  check('하나면 끝까지 채운다', 채울글('/he', 추천('/he', 표)) === 'lp',
    JSON.stringify(채울글('/he', 추천('/he', 표))));
  // 인자를 받는 명령은 빈칸까지 붙여 준다 — 바로 이어 칠 수 있게.
  check('인자를 받으면 빈칸까지', 채울글('/und', 추천('/und', 표)) === 'o ',
    JSON.stringify(채울글('/und', 추천('/und', 표))));
  // `/mode` 는 다 쳤는데도 `/model` 이 남아 있다. 멋대로 하나를 고르면 안 된다.
  check('더 긴 이름이 남아 있으면 안 고른다', 채울글('/mode', 추천('/mode', 표)) === '',
    JSON.stringify(채울글('/mode', 추천('/mode', 표))));
  check('인자가 없으면 빈칸을 안 붙인다', 채울글('/hel', 추천('/hel', 표)) === 'p');
  check('더 채울 게 없으면 빈 글자', 채울글('/clear', 추천('/clear', 표)) === '');
  // 가운데만 맞은 것을 채우면 이미 친 글자가 사라진다. 안 채운다.
  check('가운데 맞은 것은 안 채운다', 채울글('/em', 추천('/em', 표)) === '',
    JSON.stringify(채울글('/em', 추천('/em', 표))));
  check('후보가 없으면 빈 글자', 채울글('/zzz', []) === '');

  // ── 목록이 상자 아래에 붙고, 커서 자리가 그만큼 밀리는가 ──────────────
  const 목록 = 프레임({ 글: '/mo', 커서: 3, 폭: 80, 추천: 추천('/mo', 표) });
  const 벗긴것 = 목록.줄들.map(벗기기);
  check('추천이 상자 아래에 붙는다', /╰/.test(벗긴것[2]) && /\/mode/.test(벗긴것.slice(3).join('\n')),
    벗긴것.slice(3).join(' | '));
  check('치던 글은 그대로 상자 안에', /❯ \/mo /.test(벗긴것[1]), 벗긴것[1]);
  check('후보 수만큼 줄이 는다', 목록.줄들.length === 3 + 3, String(목록.줄들.length));
  // 이게 이 절의 핵심이다 — 목록만큼 안 올라가면 커서가 목록 위에 얹힌다.
  check('커서가 목록 위로 올라간다', 목록.커서.위 === 1 + 3, String(목록.커서.위));
  check('커서 칸은 목록과 무관하다', 목록.커서.열 === 9, String(목록.커서.열));
  check('이름이 상자 안 글자와 같은 칸에서 시작한다',
    벗긴것[3].indexOf('/mode') === 5, String(벗긴것[3].indexOf('/mode')));

  // 여섯 개가 넘으면 잘라 보여 주되, 몇 개를 감췄는지 말한다.
  const 많음 = 프레임({ 글: '/', 폭: 80, 추천: Array.from({ length: 20 }, (_, i) => ({ 이름: `c${i}`, 설명: '설명' })) });
  const 많은것 = 많음.줄들.map(벗기기);
  check('여섯 개까지만 보인다', 많음.줄들.length === 3 + 6 + 1, String(많음.줄들.length));
  check('감춘 개수를 말해 준다', /그 밖에 14개 더/.test(많은것.at(-1)), 많은것.at(-1));
  check('감춤 줄까지 세어 커서를 올린다', 많음.커서.위 === 1 + 7, String(많음.커서.위));

  // 좁은 창에서 테두리가 무너지면 안 된다.
  for (const 폭 of [40, 60, 100]) {
    const f = 프레임({ 글: '/mo', 폭, 추천: 추천('/mo', 표) });
    const 넘친것 = f.줄들.filter((l) => width(벗기기(l)) > 폭);
    check(`추천을 붙여도 ${폭}칸을 안 넘는다`, 넘친것.length === 0,
      넘친것.map((l) => `${width(벗기기(l))}칸`).join(','));
  }

  // 일하는 중에는 칠 자리가 아니다 — 목록을 띄우지 않는다.
  const 일할때 = 프레임({ 글: '/mo', 폭: 80, 추천: 추천('/mo', 표), 일감: { 말: '읽는 중', 돌림: '⠋' } });
  check('일하는 중에는 추천을 안 띄운다', !/\/model/.test(일할때.줄들.map(벗기기).join('\n')));
}

trace('9.6-승인방식차례');

// ── Shift+Tab 이 도는 차례 ──────────────────────────────────────────────
//
// 느슨한 쪽 → 조이는 쪽으로 돌아야 한다. 반대로 돌면 Shift+Tab 한 번에
// '안 묻고 고침' 으로 떨어진다 — 안전 설정에서 그건 사고다.
{
  check('자동 다음은 위험만', 승인다음('auto') === 'confirm');
  check('위험만 다음은 모두', 승인다음('confirm') === 'strict');
  check('모두 다음은 다시 자동', 승인다음('strict') === 'auto');
  check('모르는 값이면 첫째 것 다음으로', 승인다음('없는것') === 'confirm', 승인다음('없는것'));
  check('세 번 돌면 제자리', 승인다음(승인다음(승인다음('auto'))) === 'auto');

  // 한 번 누를 때마다 더 많이 묻는 쪽으로 가는가 — 되돌아오는 자리만 빼고.
  const 묻는정도 = { auto: 0, confirm: 1, strict: 2 };
  const 조이는쪽 = 승인차례.every((k) => {
    const 다음 = 승인다음(k);
    return 묻는정도[다음] > 묻는정도[k] || 다음 === 승인차례[0];
  });
  check('누를수록 더 물어보는 쪽으로 간다', 조이는쪽);

  for (const k of 승인차례) {
    const m = 승인고르기(k);
    check(`${k} 는 사람 말 이름이 있다`, !!m.이름 && !!m.한줄 && !!m.글자, `${m.글자} ${m.이름}`);
  }
}

trace('10-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n입력 상자 검사  ${D}(검사가 파이프로 도니 화면을 값으로 재 본다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
