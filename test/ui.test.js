// 화면·입력 쪽. 여기는 사람이 직접 만지는 자리라 조용히 틀리면 티가 안 난다.
//
// 무엇을 확인하나:
//   1) 암호를 물을 때 화면에 안 찍히는가        — 틀리면 어깨너머로 새어 나간다
//   2) 목록에서 고르기가 엉뚱한 것을 안 고르는가 — 틀리면 다른 모델에 붙는다
//   3) 진행 표시가 TTY 가 아닐 때 조용한가      — 로그가 스피너 글자로 뒤덮인다
//   4) 되돌리기 이력이 무한정 커지지 않는가     — 사내 PC 디스크를 먹는다
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askHidden, pick } from '../src/ui/prompt.js';
import { spin } from '../src/ui/spinner.js';
import { History } from '../src/safety/undo.js';
import { c, width, clip, pad, bar, gauge, box, rule, mark } from '../src/ui/ansi.js';
import { trace } from './trace.mjs';

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

trace('5-되돌리기이력');

// ── 되돌리기 이력이 무한정 커지지 않는가 ────────────────────────────────
{
  const root = mkdtempSync(join(tmpdir(), 'deel-ui-undo-'));
  const h = new History(root);

  check('처음에는 크기가 0', h.size() === 0, String(h.size()));

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
