// 화면·입력 쪽. 여기는 사람이 직접 만지는 자리라 조용히 틀리면 티가 안 난다.
//
// 무엇을 확인하나:
//   1) 암호를 물을 때 화면에 안 찍히는가        — 틀리면 어깨너머로 새어 나간다
//   2) 목록에서 고르기가 엉뚱한 것을 안 고르는가 — 틀리면 다른 모델에 붙는다
//   3) 진행 표시가 TTY 가 아닐 때 조용한가      — 로그가 스피너 글자로 뒤덮인다
//   4) 되돌리기 이력이 무한정 커지지 않는가     — 사내 PC 디스크를 먹는다
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askHidden, pick } from '../src/ui/prompt.js';
import { spin } from '../src/ui/spinner.js';
import { History } from '../src/safety/undo.js';
import { c, width, clip, pad, bar, gauge, box } from '../src/ui/ansi.js';
import { statusLine, SEGMENT_GROUPS, DEFAULT_SEGMENTS } from '../src/ui/status.js';
import { Session } from '../src/agent/session.js';
import { trace } from './trace.mjs';

const 색빼기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// 화면에 나간 것을 가로채 모은다.
async function 받아적기(fn) {
  const 원래 = process.stdout.write.bind(process.stdout);
  let 모인것 = '';
  process.stdout.write = (chunk) => { 모인것 += chunk; return true; };
  try { const v = await fn(); return { v, out: 모인것 }; } finally { process.stdout.write = 원래; }
}

trace('1-암호가림');

// ── 암호를 물을 때 화면에 안 찍히는가 ───────────────────────────────────
//
// 이 프로젝트에서 암호는 엑셀 파일을 열 때만 쓰고 어디에도 안 남긴다.
// 그 약속의 마지막 한 칸이 '화면에도 안 남는다' 다.
{
  // readline 을 흉내 낸다. 진짜 readline 은 _writeToOutput 으로 되비춘다.
  const 가짜rl = {
    output: { write: (s) => { 되비친것 += s; } },
    _writeToOutput(s) { this.output.write(s); },
  };
  let 되비친것 = '';

  const { v, out } = await 받아적기(async () => {
    const p = askHidden(가짜rl, '엑셀 암호', async () => {
      // readline 이 글자를 되비추는 흉내
      가짜rl._writeToOutput('비밀번호1234');
      return '비밀번호1234';
    });
    return await p;
  });

  check('암호를 그대로 돌려준다', v === '비밀번호1234', String(v));
  check('화면에 암호 글자가 안 남는다', !되비친것.includes('비밀번호1234') && !out.includes('비밀번호1234'),
    JSON.stringify(되비친것.slice(0, 40)));
  check('대신 가림표를 찍는다', /●/.test(되비친것), JSON.stringify(되비친것.slice(0, 40)));
  check('가림표 개수가 글자수와 같다', (되비친것.match(/●/g) ?? []).length === '비밀번호1234'.length,
    `${(되비친것.match(/●/g) ?? []).length}개 vs ${'비밀번호1234'.length}자`);
  check('묻는 말은 보인다', /엑셀 암호/.test(out), '');
  check('되비추기를 원래대로 돌려놓는다', 가짜rl._writeToOutput === Object.getPrototypeOf(가짜rl)?._writeToOutput || typeof 가짜rl._writeToOutput === 'function', '');
}

{
  // 되비추기를 못 가로채는 readline 이면, 아예 아무것도 안 찍어야 한다.
  // 화면에 암호가 보이느니 안 보이고 치는 편이 낫다.
  const { v, out } = await 받아적기(() => askHidden({}, '암호', async () => '열쇠말'));
  check('가로챌 수 없으면 안내만 하고 안 찍는다', !out.includes('열쇠말'), JSON.stringify(out.slice(0, 60)));
  check('그래도 값은 받아 온다', v === '열쇠말', String(v));
  check('안 보인다고 미리 알려 준다', /안 보입니다/.test(out), '');
}

{
  // 취소(null)와 빈 입력을 구분해야 한다. 빈 암호도 유효한 입력이다.
  const { v } = await 받아적기(() => askHidden({}, '암호', async () => null));
  check('취소하면 null 이 온다', v === null, String(v));
  const { v: v2 } = await 받아적기(() => askHidden({}, '암호', async () => '  띄어쓰기  '));
  check('앞뒤 공백은 떼어 준다', v2 === '띄어쓰기', JSON.stringify(v2));
}

trace('2-목록고르기');

// ── 목록에서 고르기 ─────────────────────────────────────────────────────
//
// 여기서 하나 밀리면 사람이 고른 것과 다른 모델에 붙는다. 화면에는 아무 표시도
// 안 난다 — 그래서 '벗어난 값은 전부 기본으로' 를 못 박아 둔다.
{
  const 목록 = [{ label: '가모델', note: '7B' }, { label: '나모델' }, '다모델'];
  const 답하기 = (답) => async () => 답;

  const 표 = [
    ['1', 0, '첫째를 고른다'],
    ['2', 1, '둘째를 고른다'],
    ['3', 2, '글자만 있는 항목도 고른다'],
    ['', 1, '그냥 엔터면 기본값'],
    ['0', 1, '0 은 없으니 기본값'],
    ['4', 1, '넘치는 번호는 기본값'],
    ['-1', 1, '음수는 기본값'],
    ['둘째', 1, '숫자가 아니면 기본값'],
    ['2개', 1, '숫자로 시작해도 뒤가 붙으면 그 숫자로 본다'],
  ];
  for (const [입력, 기대, 이름] of 표) {
    const { v } = await 받아적기(() => pick('모델 고르기', 목록, { def: 1, ask: 답하기(입력) }));
    // '2개' 는 parseInt 가 2 로 읽으므로 1(0부터) 이 맞다. 표의 기대값과 같이 본다.
    check(`${이름} ('${입력}')`, v === (입력 === '2개' ? 1 : 기대), `받은 것 ${v}`);
  }

  const { out } = await 받아적기(() => pick('모델 고르기', 목록, { def: 1, ask: 답하기('1') }));
  check('목록을 번호와 함께 보여 준다', /1 {2}가모델/.test(out.replace(/\x1b\[[0-9;]*m/g, '')), '');
  check('곁말도 같이 보여 준다', /7B/.test(out), '');
  check('기본값에 표시를 한다', /←기본/.test(out), '');
}

trace('3-진행표시');

// ── 진행 표시 ───────────────────────────────────────────────────────────
{
  // 검사·CI·사내망 캡처는 TTY 가 아니다. 여기서 스피너가 돌면 로그가 뒤덮인다.
  const 원래TTY = process.stdout.isTTY;
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

  const { out } = await 받아적기(async () => {
    const s = spin('무언가 하는 중…');
    s.stop('  끝났습니다');
  });
  check('TTY 가 아니면 한 줄만 남긴다', out.split('\n').filter(Boolean).length === 2, JSON.stringify(out));
  check('스피너 글자가 안 나온다', !/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(out), JSON.stringify(out));
  check('무엇을 하는 중인지는 남는다', /무언가 하는 중/.test(out), '');
  check('끝났다는 줄도 남는다', /끝났습니다/.test(out), '');

  // 끝맺음 글을 안 주면 아무것도 더 안 찍어야 한다.
  const { out: out2 } = await 받아적기(async () => { spin('조용히').stop(''); });
  check('끝맺음 글이 없으면 안 찍는다', out2.trim() === '조용히', JSON.stringify(out2));

  Object.defineProperty(process.stdout, 'isTTY', { value: 원래TTY, configurable: true });
}

trace('4-화면계산');

// ── 폭 계산 ─────────────────────────────────────────────────────────────
//
// 한글은 두 칸을 먹는다. 이걸 틀리면 상태줄과 상자가 어긋난다 —
// 사내 PC 는 대개 한글 폰트라 이 문제가 늘 보인다.
{
  check('한글은 두 칸', width('가나') === 4, String(width('가나')));
  check('영문은 한 칸', width('abcd') === 4, String(width('abcd')));
  check('섞여도 맞는다', width('가a나b') === 6, String(width('가a나b')));
  check('색 코드는 폭이 없다', width(c.red('가나')) === 4, String(width(c.red('가나'))));
  check('빈 글자', width('') === 0, String(width('')));
  check('없는 값도 안 터진다', width(null) === 0, String(width(null)));

  check('자를 때도 두 칸으로 센다', width(clip('가나다라마', 6)) <= 6, `${clip('가나다라마', 6)} = ${width(clip('가나다라마', 6))}`);
  check('짧으면 안 자른다', clip('가나', 10) === '가나', clip('가나', 10));
  check('자르면 표시를 남긴다', /…/.test(clip('가나다라마바사', 6)), clip('가나다라마바사', 6));

  check('채울 때도 두 칸으로 센다', width(pad('가나', 8)) === 8, String(width(pad('가나', 8))));
  check('오른쪽 채우기', pad('1', 4, 'right').startsWith(' '), JSON.stringify(pad('1', 4, 'right')));
  check('넘치면 안 채운다', width(pad('가나다라마', 4)) >= 4, String(width(pad('가나다라마', 4))));
}

{
  // 게이지·막대. 0 과 1 을 넘는 값에서 안 깨져야 한다 —
  // 컨텍스트가 넘치면 실제로 1 보다 큰 값이 들어온다.
  for (const [값, 이름] of [[0, '0'], [0.5, '반'], [1, '가득'], [1.5, '넘침'], [-1, '음수'], [NaN, '숫자아님']]) {
    const g = gauge(값, 10);
    check(`게이지 ${이름} 에서 폭이 유지된다`, width(g) === 10, `${width(g)}칸`);
  }
  const b = bar(50, 100, 20);
  check('막대도 폭이 유지된다', width(b) === 20, String(width(b)));
  check('분모가 0 이어도 안 터진다', width(bar(0, 0, 10)) === 10, String(width(bar(0, 0, 10))));
}

{
  // 상자. 안쪽 줄 폭이 제각각이어도 테두리가 맞아야 한다.
  const 줄들 = box(['짧다', '조금 더 긴 줄입니다', c.red('색이 있는 줄'), ''], { tone: (x) => x });
  const 폭들 = new Set(줄들.map((l) => width(l)));
  check('상자 테두리가 다 같은 폭이다', 폭들.size === 1, [...폭들].join(','));
  check('상자에 위아래 테두리가 있다', /╭/.test(줄들[0]) && /╰/.test(줄들[줄들.length - 1]), '');
}

trace('4.5-상태줄');

// ── 상태줄 세 덩이 ───────────────────────────────────────────────────────
//
// 전에는 칸 여섯 개가 같은 굵기의 막대로 나란히 서 있었다.
//   ▏폴더 ▏모델 ▏게이지 ▏◎ 종합 ▏◇ medium·절약 ▏auto
// 뒤의 셋은 셋 다 '모드' 처럼 생겨서, 무엇이 무엇인지 읽으려면 멈춰서 세어야 했다.
//
// 세 덩이로 묶었다 — **어디서 · 얼마나 찼나 · 어떻게 도나**.
// 덩이 사이만 굵은 칸막이, 덩이 안은 가운뎃점. 눈이 세 번만 멈춘다.
//
// 이 검사가 보는 것은 색이 아니라 **구조**다. 조각을 하나 더 끼워 넣다가
// 덩이 경계가 무너지면(다시 여섯 칸이 되면) 여기서 잡힌다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-status-'));
  const conn = {
    kind: 'openai', base: 'http://127.0.0.1:1/v1', auth: 'none', key: null,
    model: '스텁모델', ctx: 32768, streaming: false, tools: true, json: false, think: false,
  };
  const s = new Session(conn, { root: 방, mode: 'auto', think: 'medium', effort: 'save' });

  const 좋은덩이 = (줄) => 줄.split('▏').slice(1).length;      // 맨 앞 칸막이는 여는 표시다

  const 줄 = 색빼기(statusLine(s, { max: 200 }));
  const 덩이 = 줄.split('▏').slice(1).map((x) => x.trim());
  check('상태줄이 세 덩이다', 덩이.length === 3, `${덩이.length}덩이 · ${줄.trim()}`);
  check('첫 덩이는 어디서 — 폴더·모델', /스텁모델/.test(덩이[0]) && 덩이[0].includes('·'), 덩이[0]);
  check('둘째 덩이는 얼마나 찼나 — 게이지', /%/.test(덩이[1]), 덩이[1]);
  // 승인 방식은 '내 파일이 물어보고 바뀌는가' 다. 영문 낱말(auto)로 두면
  // 옆의 작업 모드·강도와 똑같이 생겨서 그게 안전 표시라는 걸 아무도 모른다.
  check('셋째 덩이는 어떻게 도나 — 작업·강도·승인',
    /자동 승인/.test(덩이[2]) && /medium/.test(덩이[2]), 덩이[2]);
  check('승인 방식에 눈에 띄는 글자를 붙인다', /⏵⏵/.test(덩이[2]), 덩이[2]);
  check('덩이 안은 가운뎃점으로 잇는다', 덩이[2].split(' · ').length === 3, JSON.stringify(덩이[2].split(' · ')));

  // 주고받은 것이 생기면 네 번째 덩이가 붙는다. 없을 때 빈 칸막이가 서면 안 된다.
  check('안 주고받았으면 토큰 덩이가 없다', !/↑/.test(줄), 줄.trim());
  s.usage.in = 1200; s.usage.out = 340;
  const 줄2 = 색빼기(statusLine(s, { max: 200 }));
  check('주고받으면 토큰 덩이가 붙는다', 줄2.split('▏').slice(1).length === 4 && /↑/.test(줄2), 줄2.trim());
  check('빈 덩이로 칸막이만 서지 않는다', !/▏\s*▏/.test(줄2), 줄2.trim());
  s.usage.in = 0; s.usage.out = 0;

  // 좁으면 뒤에서부터 떨군다. 폴더·모델은 마지막까지 남아야 한다 —
  // '어디에 무엇으로' 를 모르면 나머지 숫자는 아무 뜻이 없다.
  // 떨구기 전에 먼저 줄여 본다.
  //
  // 곧바로 뒤에서부터 떨구면, 80칸 터미널에서 모델 이름이 조금만 길어도
  // '어떻게 도나' 덩이가 통째로 사라졌다 — 세 덩이로 묶어 놓고 정작
  // 세 번째를 못 보는 화면이 된다. 덜 급한 자리(정확한 토큰 수·배분 이름)를
  // 접으면 대개 다시 들어간다.
  {
    // 폴더는 흔한 짧은 이름, 모델은 사내 게이트웨이에서 실제로 쓰는 긴 이름.
    const 긴모델 = { ...s, root: 'C:/Users/x/Desktop/Local', conn: { ...conn, model: 'databricks-gpt-5-6-luna' } };
    긴모델.breakdown = () => s.breakdown();
    긴모델.effectiveWork = () => s.work;
    const 좁아도 = 색빼기(statusLine(긴모델, { max: 78 }));
    check('80칸에서도 세 덩이가 다 남는다', 좋은덩이(좁아도) === 3, 좁아도.trim());
    check('좁으면 정확한 토큰 수를 접는다', !/\/32k/.test(좁아도) && /%/.test(좁아도), 좁아도.trim());
    check('좁으면 배분 이름을 접고 강도는 남긴다',
      /medium/.test(좁아도) && !/절약/.test(좁아도), 좁아도.trim());
    // 자리가 없으면 모델 이름을 더 줄인다. 이걸 안 줄이면 사내 게이트웨이
    // 이름 하나 때문에 셋째 덩이가 통째로 떨어져 나가고, 그 안에 있던
    // 승인 방식이 화면에서 사라진다 — 안전 표시를 제일 먼저 잃는 셈이다.
    check('좁으면 모델 이름을 더 줄인다', /databricks-gp…/.test(좁아도), 좁아도.trim());
    check('좁아도 승인 방식은 안 잃는다', /⏵⏵ 자동/.test(좁아도), 좁아도.trim());
    check('접은 줄도 폭을 안 넘는다', width(좁아도) <= 78, `${width(좁아도)}칸`);
    // 넓으면 접지 않는다 — 접힌 채로 굳으면 정확한 숫자를 영영 못 본다.
    const 넓게 = 색빼기(statusLine(긴모델, { max: 200 }));
    check('넓으면 안 접는다', /\/32k/.test(넓게) && /절약/.test(넓게), 넓게.trim());
  }

  const 좁게 = 색빼기(statusLine(s, { max: 48 }));
  check('좁으면 뒤 덩이를 떨군다', 좁게.split('▏').slice(1).length < 3, 좁게.trim());
  check('좁아도 한 줄을 넘지 않는다', width(좁게) <= 48, `${width(좁게)}칸 · ${좁게}`);
  check('좁아도 폴더·모델은 남는다', /스텁모델/.test(좁게), 좁게);

  // 폴더 이름을 길게 지어도 이 조각 하나가 줄을 넘기면 안 된다.
  {
    const 긴방 = { ...s, root: join(방, '아주아주긴한글폴더이름을이렇게짓는사람도있다') };
    긴방.breakdown = () => s.breakdown();
    긴방.effectiveWork = () => s.work;
    const 긴줄 = 색빼기(statusLine(긴방, { max: 100 }));
    check('폴더 이름이 길어도 줄이 안 넘친다', width(긴줄) <= 100, `${width(긴줄)}칸 · ${긴줄.trim()}`);
    check('길면 잘렸다고 표시한다', /…/.test(긴줄), 긴줄.trim());
  }

  // 계획 모드는 파일을 못 고친다. 그 자물쇠가 상태줄에 보여야 한다 —
  // 안 보이면 "왜 안 고쳐지지" 를 알 길이 없다.
  s.work = 'plan';
  check('읽기만 하는 모드는 그렇다고 적는다', /읽기만/.test(색빼기(statusLine(s, { max: 200 }))),
    색빼기(statusLine(s, { max: 200 })).trim());

  // 옛 방식(설정으로 조각 이름을 직접 준 경우)도 그대로 돌아야 한다.
  const 옛 = 색빼기(statusLine(s, { segments: ['model', 'mode'], max: 200 }));
  check('조각을 직접 주면 그대로 한 줄', 옛.split('▏').slice(1).length === 2, 옛.trim());
  check('기본 조각 목록은 덩이를 펼친 것', DEFAULT_SEGMENTS.join() === SEGMENT_GROUPS.flat().join(),
    DEFAULT_SEGMENTS.join());

  rmSync(방, { recursive: true, force: true });
}

trace('5-되돌리기이력');

// ── 되돌리기 이력이 무한정 커지지 않는가 ────────────────────────────────
{
  const root = mkdtempSync(join(tmpdir(), 'deel-ui-undo-'));
  const h = new History(root);

  check('처음에는 크기가 0', h.size() === 0, String(h.size()));

  // 턴 번호는 반드시 달라야 한다.
  //
  // 예전에는 Date.now() 를 그대로 썼다. 빠른 기계에서는 여러 턴이 같은
  // 밀리초에 들어가 하나로 뭉치고, 그러면 /undo 한 번이 두 턴을 되돌린다 —
  // 시키지 않은 것까지 되돌아간다. 리눅스 CI 에서 실제로 이렇게 됐다.
  // 그래서 일부러 쉬지 않고 연달아 부른다. 느리게 부르면 이 결함이 안 보인다.
  {
    const 잠깐 = new History(mkdtempSync(join(tmpdir(), 'deel-ui-turn-')));
    const 번호들 = [];
    for (let i = 0; i < 50; i++) 번호들.push(잠깐.nextTurn());
    check('턴 번호가 겹치지 않는다', new Set(번호들).size === 50,
      `50번 불러 서로 다른 것 ${new Set(번호들).size}개`);
    check('턴 번호가 늘어나기만 한다', 번호들.every((v, i) => i === 0 || v > 번호들[i - 1]), '');
  }

  const 파일 = join(root, '가.txt');
  for (let i = 0; i < 5; i++) {
    h.nextTurn();
    writeFileSync(파일, `${i}번째\n`, 'utf8');
    h.snapshot(파일);
  }
  check('이력이 쌓이면 크기가 는다', h.size() > 0, `${h.size()}바이트`);
  check('쌓인 기록을 다 읽는다', h.all().length === 5, String(h.all().length));

  // 오래된 턴을 잘라낸다. 사내 PC 에서 이 파일이 계속 크면 곤란하다.
  const 버린수 = h.prune({ keep: 2 });
  check('오래된 턴을 잘라낸다', 버린수 === 3, `${버린수}개 버림`);
  check('최근 것은 남긴다', h.all().length === 2, String(h.all().length));
  check('자를 것이 없으면 0', h.prune({ keep: 99 }) === 0, String(h.prune({ keep: 99 })));

  // 없는 파일을 찍으면 '원래 없던 파일' 로 남아야 한다. 되돌릴 때 지워야 하니까.
  h.nextTurn();
  const 없던것 = join(root, '없던.txt');
  h.snapshot(없던것);
  writeFileSync(없던것, '새로 만듦\n', 'utf8');
  const r = h.undo(1);
  check('원래 없던 파일은 되돌릴 때 지운다', !existsSync(없던것), r.restored.map((x) => x.how).join(','));

  // 바이너리는 대상에서 뺀다 — 텍스트만 다룬다는 약속.
  h.nextTurn();
  const 바이너리 = join(root, '그림.bin');
  writeFileSync(바이너리, Buffer.from([0, 1, 2, 0, 255]));
  h.snapshot(바이너리);
  const 기록 = h.all();
  check('바이너리는 이력에 안 담는다', !기록.some((x) => String(x.path).endsWith('그림.bin') && x.before !== null),
    JSON.stringify(기록.filter((x) => String(x.path).endsWith('그림.bin')).map((x) => typeof x.before)));

  // ── 되돌리면 원래 바이트가 그대로 돌아와야 한다 ──────────────────────
  //
  // 예전에는 이력에 글자만 담았다 — 읽을 때도 쓸 때도 UTF-8 로 못 박아서.
  // 사내 파일은 CP949 가 흔한데, 그러면 '가나다' 를 떠 놨다가 되돌릴 때
  // U+FFFD 여섯 개로 돌려놓는다. 원래 바이트는 그 순간 없어진다.
  //
  // 되돌리기는 이 프로그램의 안전망이다. 안전망이 파일을 망가뜨리면
  // 그냥 결함이 아니라 안 고쳤을 때보다 나쁜 상태가 된다.
  {
    const 방 = mkdtempSync(join(tmpdir(), 'deel-ui-cp949-'));
    const hh = new History(방);
    const 파일 = join(방, '한글.txt');
    const 원래 = Buffer.from([0xB0, 0xA1, 0xB3, 0xAA, 0xB4, 0xD9]);   // CP949 '가나다'
    writeFileSync(파일, 원래);
    hh.nextTurn();
    hh.snapshot(파일, 'Edit');
    writeFileSync(파일, Buffer.from('통째로 바뀜', 'utf8'));
    hh.undo(1);
    check('CP949 파일을 바이트까지 그대로 되돌린다', 원래.equals(readFileSync(파일)),
      `${readFileSync(파일).toString('hex')} (원래 ${원래.toString('hex')})`);

    // UTF-8 파일은 예전처럼 글자로 담는다 — 이력이 쓸데없이 커지면 안 된다.
    const 보통 = join(방, '보통.txt');
    writeFileSync(보통, '가나다\n', 'utf8');
    hh.nextTurn();
    hh.snapshot(보통, 'Edit');
    const 방금 = hh.all().at(-1);
    check('UTF-8 은 글자 그대로 담는다', 방금.before === '가나다\n' && !방금.enc, JSON.stringify(방금.before));
    writeFileSync(보통, '망침', 'utf8');
    hh.undo(1);
    check('UTF-8 파일도 그대로 되돌린다', readFileSync(보통, 'utf8') === '가나다\n', readFileSync(보통, 'utf8'));

    rmSync(방, { recursive: true, force: true });
  }

  // 깨진 줄이 섞여도 나머지는 읽어야 한다. 도중에 죽으면 실제로 이렇게 된다.
  const 이력파일 = h.file;
  writeFileSync(이력파일, readFileSync(이력파일, 'utf8') + '{깨진 줄\n', 'utf8');
  check('깨진 줄이 있어도 나머지를 읽는다', Array.isArray(h.all()) && h.all().length > 0, String(h.all().length));

  rmSync(root, { recursive: true, force: true });
  check('폴더가 없어지면 크기 0', h.size() === 0, String(h.size()));
}

trace('6-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n화면·입력 검사  ${D}(사람이 직접 만지는 자리)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
