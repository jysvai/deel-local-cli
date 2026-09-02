// deel reset — 지우려고 다시 깔지 않게.
//
// ── 왜 있나 ────────────────────────────────────────────────────────────
//
// 연결을 바꿔 보다, 배운 것이 꼬여서, 남에게 넘기기 전에 — 되돌아갈 자리가
// 필요할 때가 있다. 지금까지는 그때마다 다시 깔았다. 그런데 다시 깔아도
// `~/.deel` 은 그대로 남으므로, 사실 다시 깔아도 초기화가 안 됐다.
//
// ── 이 파일이 조심하는 것 ──────────────────────────────────────────────
//
// 이건 이 프로그램에서 **사람의 진짜 파일을 잃게 할 수 있는 유일한 기능**이다.
// 그래서 무엇을 지우는지보다 **무엇을 안 지우는지**를 먼저 정해 놓았다.
//
//   되돌리기 스냅샷(.deel/history)  이 도구가 승인 프롬프트 대신 내건 안전망
//                                   그 자체다. 이걸 지우면 여태 고친 파일을
//                                   되돌릴 길이 사라진다.
//   감사기록(.deel/audit.jsonl)     사내 심사에 낼 근거다.
//   .deel/mcp.json · .deelignore    사람이 손으로 적은 것이다. 우리가 만든
//                                   것이 아니면 우리가 지우지 않는다.
//
// 앞의 둘은 `all --hard` 로만 지운다. 뒤의 둘은 **어떤 길로도 안 지운다.**
//
// ── 설정이 깨져 있어도 돌아야 한다 ─────────────────────────────────────
//
// 초기화를 찾는 까닭이 대개 「설정이 깨져서」 다. 그런데 평소에 켜는 길은
// 설정을 먼저 읽는다. 그래서 이 파일은 config.js 의 load() 를 안 쓴다 —
// 파일을 직접 읽고, 못 읽으면 못 읽었다고 적은 채로 계속 간다.
// (`deel --version` 을 연결 없이 답하게 만든 것과 같은 이유다.)
import { join, resolve, sep } from 'node:path';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { c, say, mark, rule, pad } from './ui/ansi.js';
import { ask, confirm } from './ui/prompt.js';
import { homeDir } from './config.js';
import { 잠긴것인가, 잠금지우기, 보관방식 } from './safety/keystore.js';

/** 사람이 칠 수 있는 이름. bin/deel.js 의 도움말·완성 목록과 같아야 한다. */
export const 갈래들 = ['model', 'memory', 'sessions', 'learned', 'plugins', 'all'];

// ── 세는 것들 ───────────────────────────────────────────────────────────
//
// 세다가 나는 탈은 전부 삼킨다. 이건 '무엇이 있나' 를 보여 주려는 것이지
// 검사가 아니다 — 한 줄 못 셌다고 초기화 자체를 못 하게 하면 안 된다.

function 줄수(파일) {
  try { return readFileSync(파일, 'utf8').split('\n').filter((l) => l.trim()).length; }
  catch { return 0; }
}

function 안에것(폴더, 거르기 = () => true) {
  try { return readdirSync(폴더, { withFileTypes: true }).filter(거르기).length; }
  catch { return 0; }
}

/**
 * 설정을 읽어 본다. **깨져 있어도 답한다.**
 *
 * @returns {{있나: boolean, 프로필: number|null, 잠긴열쇠: string[], 왜: string}}
 */
export function 설정살피기(파일) {
  if (!existsSync(파일)) return { 있나: false, 프로필: 0, 잠긴열쇠: [], 왜: '' };
  let j;
  try { j = JSON.parse(readFileSync(파일, 'utf8')); }
  catch (err) {
    // 깨진 설정이야말로 지우려는 것이다. 몇 개인지 모른다고 해서 못 지우면 안 된다.
    // 줄바꿈을 빼고 한 줄로 만든다. JSON 오류에는 깨진 그 줄이 그대로 실려
    // 오는데, 그게 화면에 들어가면 표가 두 줄로 갈라진다.
    const 한줄 = String(err.message).replace(/\s+/g, ' ').trim().slice(0, 60);
    return { 있나: true, 프로필: null, 잠긴열쇠: [], 왜: `읽을 수 없습니다 (${한줄})` };
  }
  const 목록 = Array.isArray(j?.profiles) ? j.profiles : [];
  return {
    있나: true,
    프로필: 목록.length,
    잠긴열쇠: 목록.map((p) => p?.apiKey).filter((k) => 잠긴것인가(k)),
    왜: '',
  };
}

/**
 * 무엇이 어디에 얼마나 있나.
 *
 * 화면과 지우는 자리가 **같은 목록**을 본다. 두 벌이 되면 화면에는 안 뜨는
 * 것이 지워지거나, 뜨는데 안 지워진다. 둘 다 겪으면 이 기능을 못 믿게 된다.
 *
 * @param {{home?: string, root?: string}} 어디
 */
export function 살펴보기({ home = homeDir(), root = process.cwd() } = {}) {
  const 집 = (...n) => join(home, ...n);
  const 일 = (...n) => join(root, '.deel', ...n);

  const 집설정 = 설정살피기(집('config.json'));
  const 일설정 = 설정살피기(일('config.json'));
  const 열쇠들 = [...집설정.잠긴열쇠, ...일설정.잠긴열쇠];

  const 항목 = [
    {
      키: 'model',
      이름: '연결·프로필',
      자리: [집('config.json'), 일('config.json')],
      몇: 집설정.프로필 === null || 일설정.프로필 === null
        ? null : (집설정.프로필 ?? 0) + (일설정.프로필 ?? 0),
      단위: '개',
      탈: 집설정.왜 || 일설정.왜,
      뒤: 'deel setup 을 다시 하게 됩니다',
      all: true,
      // 설정 파일을 지우기 **전에** 잠금장치를 먼저 손봐야 한다. 파일을
      // 지우고 나면 어느 열쇠가 잠겨 있었는지 알 길이 없다.
      열쇠: 열쇠들,
    },
    {
      키: 'memory',
      이름: '기억',
      자리: [일('memory.md')],
      몇: 줄수(일('memory.md')),
      단위: '줄',
      뒤: c.yellow('돌아오지 않습니다'),
      all: true,
    },
    {
      키: 'sessions',
      이름: '대화 기록',
      자리: [일('sessions')],
      몇: 안에것(일('sessions'), (e) => e.isFile() && e.name.endsWith('.jsonl')),
      단위: '개',
      뒤: '이어하기(--continue · --resume)가 안 됩니다',
      all: true,
    },
    {
      키: 'learned',
      이름: '배운 것',
      자리: [집('배운것.json'), 일('배운것.json')],
      몇: [집('배운것.json'), 일('배운것.json')].filter((p) => existsSync(p)).length,
      단위: '곳',
      뒤: '다시 배웁니다',
      all: true,
    },
    {
      // 우리가 만들어 쌓아 둔 것들. 사람이 적은 것이 아니라 안전하다.
      키: '만든것',
      이름: '증거·내보낸 것·임시',
      자리: [일('증거'), 일('export'), 일('tmp'), 일('붙인그림')],
      몇: [일('증거'), 일('export'), 일('tmp'), 일('붙인그림')].reduce((n, p) => n + 안에것(p), 0),
      단위: '개',
      뒤: '안전합니다',
      all: true,
      숨은것: true,   // 따로 고를 수는 없고 all 에만 딸려 간다
    },
    {
      키: 'plugins',
      이름: '플러그인',
      자리: [집('plugins')],
      몇: 안에것(집('plugins'), (e) => e.isDirectory() && !e.name.startsWith('.')),
      단위: '개',
      뒤: c.yellow('다시 설치해야 합니다'),
      // 따로 고를 때만 지운다. 다시 받는 데 시간이 걸리고, 사람이 초기화하려는
      // 것은 대개 플러그인이 아니라 연결 쪽이다.
      all: false,
    },
  ];

  // `--hard` 로만 지우는 것.
  const 굳은것 = [
    {
      키: 'history',
      이름: '되돌리기 스냅샷',
      자리: [일('history')],
      몇: 줄수(일('history', 'edits.jsonl')),
      단위: '자리',
      뒤: c.red('고친 파일을 되돌릴 수 없게 됩니다'),
    },
    {
      키: 'audit',
      이름: '감사기록',
      자리: [일('audit.jsonl')],
      몇: 줄수(일('audit.jsonl')),
      단위: '줄',
      뒤: c.red('사내 심사에 낼 근거가 사라집니다'),
    },
  ];

  // 어떤 길로도 안 지우는 것. 화면에 이름을 적어 둔다 — 「왜 이건 안 지웠지」
  // 를 나중에 묻게 하지 않으려고.
  const 안건드림 = [
    { 이름: '.deel/mcp.json', 있나: existsSync(일('mcp.json')) },
    { 이름: '.deelignore', 있나: existsSync(join(root, '.deelignore')) },
    { 이름: 'DEEL.md', 있나: existsSync(join(root, 'DEEL.md')) },
  ];

  return { home, root, 항목, 굳은것, 안건드림, 열쇠보관: 보관방식(열쇠들[0] ?? null) };
}

/**
 * 이 자리를 건드려도 되나.
 *
 * 작업 폴더와 살림 폴더 **밖은 절대 안 건드린다.** 이 프로그램의 다른
 * 모든 자리가 지키는 규칙이고, 지우는 자리에서 특히 그렇다.
 * 울타리 그 자체(`~/.deel` 이나 작업 폴더 통째로)도 안 준다 — 목록에 없는
 * 것까지 딸려 가면 이 기능을 못 믿게 된다.
 */
export function 울타리안인가(경로, 울타리들) {
  const p = resolve(경로);
  return 울타리들.some((u) => {
    const r = resolve(u);
    return p !== r && p.startsWith(r + sep);
  });
}

/**
 * 고른 것을 지운다.
 *
 * @param {string} 무엇 갈래들 중 하나
 * @param {{home?: string, root?: string, hard?: boolean}} 옵션
 * @returns {{지운것: Array, 못한것: Array, 열쇠: object|null}}
 */
export function 지우기(무엇, { home = homeDir(), root = process.cwd(), hard = false } = {}) {
  const 본것 = 살펴보기({ home, root });
  const 울타리 = [home, join(root, '.deel')];

  const 고른것 = 무엇 === 'all'
    ? [...본것.항목.filter((x) => x.all), ...(hard ? 본것.굳은것 : [])]
    : 본것.항목.filter((x) => x.키 === 무엇);

  const 지운것 = [];
  const 못한것 = [];
  let 열쇠 = null;

  for (const 것 of 고른것) {
    // 설정을 지우기 전에 잠금장치부터. 순서가 반대면 어느 열쇠였는지 잃는다.
    if (것.키 === 'model' && 것.열쇠?.length) {
      열쇠 = 잠금지우기(것.열쇠[0]);
    }
    // 한 갈래가 여러 자리에 걸쳐 있다 (배운 것은 이 PC 와 이 폴더 둘 다).
    // 화면에는 **갈래 하나로** 적는다 — 자리마다 한 줄씩 내면 「배운 것 2곳」
    // 이 두 번 찍혀서, 네 곳을 지운 것처럼 읽힌다.
    const 지운자리 = [];
    for (const 자리 of 것.자리) {
      if (!existsSync(자리)) continue;
      if (!울타리안인가(자리, 울타리)) {
        // 여기 오면 목록을 만드는 자리가 잘못된 것이다. 지우지 말고 말한다.
        못한것.push({ 이름: 것.이름, 자리, 왜: '작업 폴더 밖이라 안 건드렸습니다' });
        continue;
      }
      try {
        rmSync(자리, { recursive: true, force: true });
        지운자리.push(자리);
      } catch (err) {
        못한것.push({ 이름: 것.이름, 자리, 왜: String(err.message).slice(0, 80) });
      }
    }
    if (지운자리.length) {
      지운것.push({ 키: 것.키, 이름: 것.이름, 몇: 것.몇, 단위: 것.단위, 자리들: 지운자리 });
    }
  }
  return { 지운것, 못한것, 열쇠 };
}

// ── 화면 ────────────────────────────────────────────────────────────────

function 몇자(것) {
  if (것.몇 === null) return c.yellow('알 수 없음');
  return 것.몇 ? `${것.몇.toLocaleString()}${것.단위}` : c.gray(`0${것.단위}`);
}

function 보여주기(본것) {
  say('');
  rule('지울 수 있는 것', 74);
  say(`  ${c.gray('살림 자리')}  ${c.gray(본것.home)}`);
  say(`  ${c.gray('작업 폴더')}  ${c.gray(본것.root)}`);
  say('');
  // 이름 칸은 pad() 로 맞춘다. padEnd 는 **글자 수**를 세는데 한글은 터미널에서
  // 두 칸을 먹어서, 한글과 영문이 섞인 줄이 서로 어긋난다.
  for (const 것 of 본것.항목) {
    const 이름 = 것.숨은것 ? c.gray(것.이름) : c.bold(것.이름);
    say(`  ${pad(이름, 26)} ${pad(몇자(것), 10, 'right')}`);
    if (것.탈) say(`     ${c.yellow(것.탈)}`);
  }
  if (본것.항목.some((x) => x.키 === 'model' && x.열쇠?.length)) {
    say(`  ${pad(c.bold('잠긴 열쇠'), 26)} ${pad('', 10)} ${c.gray(본것.열쇠보관)}`);
  }
  say('');
  rule('안 지웁니다', 74);
  for (const 것 of 본것.굳은것) {
    say(`  ${pad(c.bold(것.이름), 26)} ${pad(몇자(것), 10, 'right')}  ${c.gray('all --hard 를 줘야 지웁니다')}`);
  }
  const 남길것 = 본것.안건드림.filter((x) => x.있나).map((x) => x.이름);
  say(`  ${pad(c.bold('사람이 적은 것'), 26)} ${pad('', 10)}  ${남길것.length ? c.gray(남길것.join(' · ')) : c.gray('없음')}`);
  say(`  ${c.gray('   어떤 길로도 안 건드립니다.')}`);
  say('');
}

function 지운뒤적기(결과) {
  say('');
  // 「완료」 한 줄은 확인이 안 된다. 무엇이 몇 개 없어졌는지 적는다.
  if (!결과.지운것.length) {
    say(`  ${mark.warn} ${c.gray('지울 것이 없었습니다 — 이미 비어 있습니다.')}`);
  }
  for (const x of 결과.지운것) {
    const 셈 = x.몇 === null ? '' : c.gray(`  ${x.몇}${x.단위}`);
    say(`  ${mark.ok} ${c.bold(x.이름)}${셈}`);
    for (const 자리 of x.자리들) say(`     ${c.gray(자리)}`);
  }
  if (결과.열쇠) {
    say(결과.열쇠.지움
      ? `  ${mark.ok} ${c.bold('잠금장치의 열쇠')}  ${c.gray(결과.열쇠.방식)}`
      : `  ${mark.warn} ${c.gray(`잠금장치 — ${결과.열쇠.왜}`)}`);
  }
  for (const x of 결과.못한것) {
    say(`  ${mark.no} ${x.이름} ${c.gray(x.자리)}`);
    say(`     ${c.yellow(x.왜)}`);
  }
  say('');
  return 결과.못한것.length ? 1 : 0;
}

/**
 * `deel reset [갈래] [--hard] [--yes]`
 *
 * 인자 없이 부르면 **아무것도 안 지운다.** 보여 주고 묻는다.
 */
export async function runReset(args = [], flags = {}) {
  const home = homeDir();
  const root = flags.root ? String(flags.root) : process.cwd();
  const hard = flags.hard === true || flags.hard === 'true';
  const 묻지마 = flags.yes === true || flags.yes === 'true';

  let 무엇 = String(args[0] ?? '').trim().toLowerCase();
  if (무엇 && !갈래들.includes(무엇)) {
    say('');
    say(`  ${mark.no} ${c.red('모르는 갈래')} ${c.bold(무엇)}`);
    say(`     ${c.gray(갈래들.join(' · '))}`);
    say('');
    return 1;
  }

  const 본것 = 살펴보기({ home, root });
  보여주기(본것);

  if (!무엇) {
    /*
     * 물어볼 사람이 없으면 안 묻는다.
     *
     * 파이프·CI 에서 `deel reset` 은 「무엇이 있나 보여 줘」 로 읽히는 것이
     * 맞다. 여기서 답을 기다리면 스크립트가 그대로 멈춘다. 실제로 검사에서
     * 한 번 멈춰 봤고, 멈춘 검사는 실패보다 나쁘다.
     */
    if (!process.stdin.isTTY) {
      say(`  ${c.gray('무엇을 지울지 같이 주세요:')} ${c.cyan(`deel reset <${갈래들.join('|')}>`)}`);
      say('');
      return 0;
    }
    const 답 = (await ask(`무엇을 지울까요? ${c.gray(갈래들.join(' · '))}`, { def: '' })).trim().toLowerCase();
    if (!답) { say(`  ${c.gray('그만둡니다. 아무것도 안 지웠습니다.')}`); say(''); return 0; }
    if (!갈래들.includes(답)) {
      say(`  ${mark.no} ${c.red('모르는 갈래')} ${c.bold(답)} ${c.gray('— 아무것도 안 지웠습니다.')}`);
      say('');
      return 1;
    }
    무엇 = 답;
  }

  // 되돌릴 수 없다는 것을 **지우기 전에** 적는다.
  const 볼것 = 무엇 === 'all'
    ? [...본것.항목.filter((x) => x.all), ...(hard ? 본것.굳은것 : [])]
    : 본것.항목.filter((x) => x.키 === 무엇);
  say(`  ${c.bold(`지울 것 — ${무엇}${hard ? ' --hard' : ''}`)}`);
  for (const 것 of 볼것) say(`    ${c.gray('·')} ${것.이름} ${몇자(것)}  ${c.gray('→')} ${것.뒤}`);
  if (무엇 === 'all' && !hard) {
    say(`    ${c.gray('되돌리기 스냅샷·감사기록은 그대로 둡니다 (--hard 를 주면 그것도 지웁니다).')}`);
  }
  if (무엇 === 'all') {
    say(`    ${c.gray('플러그인은 안 지웁니다 —')} ${c.cyan('deel reset plugins')}`);
  }
  say(`  ${c.yellow('되돌릴 수 없습니다.')}`);
  say('');

  if (!묻지마) {
    if (!process.stdin.isTTY) {
      say(`  ${mark.no} ${c.yellow('물어볼 자리가 없습니다.')} ${c.gray('스크립트에서는')} ${c.cyan('--yes')} ${c.gray('를 주세요.')}`);
      say('');
      return 1;
    }
    if (!await confirm('정말 지울까요?', false)) {
      say(`  ${c.gray('그만둡니다. 아무것도 안 지웠습니다.')}`);
      say('');
      return 0;
    }
    // 되돌릴 안전망까지 지우는 것은 한 번 더 묻는다. 여기는 실수하면
    // 「고친 파일을 되돌린다」 가 영영 안 된다.
    if (무엇 === 'all' && hard && !await confirm(c.red('되돌리기 스냅샷·감사기록까지 지웁니다. 계속할까요?'), false)) {
      say(`  ${c.gray('그만둡니다. 아무것도 안 지웠습니다.')}`);
      say('');
      return 0;
    }
  }

  return 지운뒤적기(지우기(무엇, { home, root, hard }));
}
