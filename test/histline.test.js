// 위/아래 화살표 — 이력을 뒤져도 치던 글이 안 사라지는가.
//
// ── 무슨 일이 났었나 ────────────────────────────────────────────────────
//
// 「채팅치다가 윗키 누르면 기존에 쓰던 내용 사라지고, 아랫키 눌러도 복구
//  안 되는 오류? 이슈가 있어」
//
// 반쯤 쓰던 글이 통째로 없어진다. 되돌릴 길도 없다.
//
// ── 왜 이게 판마다 다른가 ───────────────────────────────────────────────
//
// 위/아래는 readline 이 처리하는데, 그 동작이 **Node 판마다 다르다.**
//
//   새 판: 치던 글을 앞글자 삼아 찾고, 다 내려오면 그 앞글자를 돌려준다.
//   옛 판: 그냥 이력으로 갈아끼우고, 다 내려오면 **빈 줄**을 준다.
//
// deel 은 Node 20 부터 돈다. 그래서 이 검사는 **두 판을 다 흉내 내서** 돌린다.
// 지금 이 컴퓨터의 Node 가 어느 쪽이든, 양쪽 다 글이 살아 있어야 통과한다.
// (이 검사가 지금 Node 에서만 도는 것이었다면, 정작 사람이 겪은 옛 판을
//  한 번도 안 밟아 보고 「고쳤다」 고 말하게 된다.)
//
// ── 여기서 무엇을 지키나 ────────────────────────────────────────────────
//
//   1. 이력을 뒤지고 돌아오면 치던 글이 **그대로** 돌아온다 (옛 판·새 판 둘 다).
//   2. 이력을 뒤지는 동안 올라온 이력은 「치던 글」로 둔갑하지 않는다.
//   3. 화살표가 아닌 키는 치고 있는 글을 안 건드린다.
//   4. 줄을 보내고 나면 아까 글이 되살아나지 않는다.
//   5. repl.js 가 이걸 실제로 그 자리에 붙여 쓴다.
import { readFileSync } from 'node:fs';
import { 이력지킴이 } from '../src/ui/histline.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 소스 = readFileSync(new URL('../src/repl.js', import.meta.url), 'utf8');

/*
 * ── readline 흉내 둘 ──────────────────────────────────────────────────
 *
 * 진짜 readline 을 쓰면 이 컴퓨터의 Node 한 판만 밟는다. 사람이 겪은 판을
 * 밟아 보려면 흉내가 필요하다. 아래 둘은 각 판의 화살표 동작을 그대로 옮긴
 * 것이고, 우리 층은 이 둘 위에 똑같이 얹힌다.
 */

// 옛 판 — 이력으로 갈아끼우고, 아래로 다 내려오면 빈 줄.
function 옛판(이력) {
  return {
    이름: '옛 Node',
    line: '', historyIndex: -1, history: 이력.slice(),
    치기(글) { this.line += 글; },
    위() {
      if (this.historyIndex + 1 < this.history.length) {
        this.historyIndex += 1;
        this.line = this.history[this.historyIndex];
      }
    },
    아래() {
      if (this.historyIndex > 0) {
        this.historyIndex -= 1;
        this.line = this.history[this.historyIndex];
      } else if (this.historyIndex === 0) {
        this.historyIndex = -1;
        this.line = '';           // ★ 여기서 치던 글이 사라진다
      }
    },
  };
}

// 새 판 — 치던 글을 앞글자 삼아 찾고, 다 내려오면 그 앞글자를 돌려준다.
function 새판(이력) {
  return {
    이름: '새 Node',
    line: '', historyIndex: -1, history: 이력.slice(), 앞글자: '',
    치기(글) { this.line += 글; if (this.historyIndex === -1) this.앞글자 = this.line; },
    위() {
      for (let i = this.historyIndex + 1; i < this.history.length; i += 1) {
        if (this.history[i].startsWith(this.앞글자)) {
          this.historyIndex = i; this.line = this.history[i]; return;
        }
      }
    },
    아래() {
      for (let i = this.historyIndex - 1; i >= 0; i -= 1) {
        if (this.history[i].startsWith(this.앞글자)) {
          this.historyIndex = i; this.line = this.history[i]; return;
        }
      }
      this.historyIndex = -1; this.line = this.앞글자;
    },
  };
}

/*
 * repl.js 가 붙인 것과 **같은 순서**로 몬다.
 *
 *   - 글자를 치면: readline 이 먼저 처리하고, 그 뒤에 적어 둔다(그리기 틱).
 *   - 화살표를 누르면: readline 이 먼저 처리하고, 그 뒤에 되돌릴 것을 묻고,
 *     이어서 적기가 돈다.
 *
 * 순서가 틀리면 여기서도 틀린 답이 나온다 — 그래서 이 순서 자체가 검사다.
 */
function 몰기(rl, 지킴) {
  return {
    치기(글) { rl.치기(글); 지킴.적기(rl.line, rl.historyIndex); },
    누르기(이름) {
      if (이름 === 'up') rl.위(); else rl.아래();
      const 되돌릴 = 지킴.되돌릴것(이름, rl.historyIndex);
      if (되돌릴 !== null && rl.line !== 되돌릴) rl.line = 되돌릴;
      지킴.적기(rl.line, rl.historyIndex);
    },
    보내기() { rl.line = ''; rl.historyIndex = -1; rl.앞글자 = ''; 지킴.비우기(); },
  };
}

trace('1-붙잡기');

{
  const 지킴 = 이력지킴이();
  지킴.적기('치던 글', -1);
  check('이력 밖(-1)에서 친 글은 적어 둔다', 지킴.지금() === '치던 글', JSON.stringify(지킴.지금()));

  /*
   * 뒤지는 동안 적으면 이력이 「치던 글」로 둔갑한다.
   *
   * 위를 눌러 올라온 이력을 그대로 적어 버리면, 아래로 내려왔을 때 되돌아오는
   * 것이 치던 글이 아니라 그 이력이다. 사람 눈에는 「아래를 눌렀는데 엉뚱한
   * 게 들어왔다」 로 보인다 — 사라진 것만큼이나 못 미더운 화면이다.
   */
  지킴.적기('지난 요청입니다', 0);
  check('이력을 뒤지는 동안(0 이상)은 안 적는다', 지킴.지금() === '치던 글', JSON.stringify(지킴.지금()));

  지킴.비우기();
  check('보내고 나면 놓는다', 지킴.지금() === '');
}

trace('2-되돌릴것을-가려내나');

{
  const 지킴 = 이력지킴이();
  지킴.적기('치던 글', -1);

  check('아래로 이력 밖에 나오면 돌려준다', 지킴.되돌릴것('down', -1) === '치던 글');
  check('위로 이력 밖에 남아 있어도 돌려준다', 지킴.되돌릴것('up', -1) === '치던 글');

  // 이력 안(0 이상)에서 돌려주면 위를 누른 순간 이력이 안 보인다.
  check('이력 안에 있으면 안 돌려준다', 지킴.되돌릴것('down', 0) === null);
  check('이력 안(위)에서도 안 돌려준다', 지킴.되돌릴것('up', 2) === null);

  /*
   * 화살표가 아닌 키에까지 돌려주면 **치고 있는 글을 계속 덮어쓴다.**
   * 한 글자 칠 때마다 직전 글자로 되돌아가서, 아예 타자가 안 먹는다.
   */
  for (const 키 of ['a', 'backspace', 'left', 'right', 'return', 'tab', undefined]) {
    check(`「${키 ?? '(이름 없음)'}」 키에는 안 돌려준다`, 지킴.되돌릴것(키, -1) === null);
  }
}

trace('3-두-판을-다-밟는다');

/*
 * 두 가지 자리를 다 밟는다.
 *
 *  (가) 치던 글이 지난 것의 **앞부분**일 때 — 두 판 다 이력을 보여 준다.
 *  (나) 아주 **다른 글**을 치고 있을 때 — 옛 판은 이력으로 갈아끼우고, 새 판은
 *       (앞글자가 안 맞으니) 꿈쩍도 안 한다. 사람이 겪은 것은 이 (나) 다.
 *
 * 어느 자리든, 어느 판이든, **치던 글은 살아 있어야 한다.** 그게 전부다.
 */
for (const 만들기 of [옛판, 새판]) {
  for (const [자리, 치던, 지난것, 이력보이나] of [
    ['가 · 앞부분이 겹칠 때', '지난 요', '지난 요청입니다', true],
    ['나 · 아주 다른 글일 때', '전혀 다른 글을 쓰는 중', '지난 요청입니다', 만들기 === 옛판],
  ]) {
    const rl = 만들기([지난것]);
    const 손 = 몰기(rl, 이력지킴이());
    const 이름 = `${rl.이름} / ${자리}`;

    손.치기(치던);
    check(`[${이름}] 치는 중에는 친 그대로다`, rl.line === 치던, JSON.stringify(rl.line));

    손.누르기('up');
    check(`[${이름}] 위를 누른 결과가 그 판다운가`,
      rl.line === (이력보이나 ? 지난것 : 치던), JSON.stringify(rl.line));

    손.누르기('down');
    check(`★ [${이름}] 아래를 누르면 치던 글이 그대로 돌아온다`,
      rl.line === 치던, JSON.stringify(rl.line));

    /*
     * 이력 안에서 글을 고쳐 놓고 내려와도, 돌아오는 것은 **치던 글**이다.
     * 이력을 고친 것은 보내려던 것이 아니라 훑어본 것이므로.
     */
    손.누르기('up');
    rl.line += ' 여기 손댔다';
    손.누르기('down');
    check(`[${이름}] 이력을 고쳐 놓고 내려와도 치던 글이 온다`,
      rl.line === 치던, JSON.stringify(rl.line));

    // 보내고 새로 치기 시작하면, 아까 글은 되살아나지 않는다.
    손.보내기();
    손.누르기('up');
    손.누르기('down');
    check(`[${이름}] 보낸 뒤에는 아까 글이 안 되살아난다`,
      rl.line === '', JSON.stringify(rl.line));
  }
}

trace('4-빈-줄에서도-멀쩡한가');

{
  // 아무것도 안 치고 위/아래만 누르는 것이 제일 흔한 쓰임이다. 여기서 이력이
  // 안 보이면 화살표 기능 자체를 부순 것이 된다.
  for (const 만들기 of [옛판, 새판]) {
    const rl = 만들기(['첫째 지난 것', '둘째 지난 것']);
    const 손 = 몰기(rl, 이력지킴이());
    손.누르기('up');
    check(`[${rl.이름}] 빈 줄에서 위 — 지난 것이 보인다`,
      rl.line === '첫째 지난 것', JSON.stringify(rl.line));
    손.누르기('up');
    check(`[${rl.이름}] 위를 또 — 그 앞것까지 간다`,
      rl.line === '둘째 지난 것', JSON.stringify(rl.line));
    손.누르기('down');
    손.누르기('down');
    check(`[${rl.이름}] 다 내려오면 빈 줄이다`, rl.line === '', JSON.stringify(rl.line));
  }
}

trace('5-repl-이-실제로-쓰나');

{
  // 위 검사가 다 통과해도 repl.js 가 안 부르면 사람에게는 하나도 안 고쳐졌다.
  check('repl 이 이력지킴이를 들여온다', /import \{ 이력지킴이 \} from '\.\/ui\/histline\.js'/.test(소스));
  check('repl 이 하나 만들어 둔다', /const 이력지킴 = 이력지킴이\(\)/.test(소스));

  // 화살표를 눌렀을 때 되돌린다.
  check('위/아래 키에서 되돌릴것을 묻는다',
    /key\.name === 'up' \|\| key\.name === 'down'[\s\S]{0,400}?이력지킴\.되돌릴것/.test(소스));
  check('되돌린 것을 rl.line 에 넣는다',
    /이력지킴\.되돌릴것[\s\S]{0,300}?rl\.line = 되돌릴/.test(소스));

  /*
   * readline 이 이 키를 처리하기 전에 자리를 보면 늘 한 박자 어긋난 답이
   * 나온다. 반드시 한 틱 미룬 뒤에 봐야 한다.
   */
  check('readline 이 처리한 뒤(한 틱 미뤄) 본다',
    /key\.name === 'up' \|\| key\.name === 'down'\)[\s\S]{0,120}?setImmediate/.test(소스));

  check('그리기 틱에서 적어 둔다', /이력지킴\.적기\(rl\.line/.test(소스));
  check('줄을 보내면 놓는다', /rl\.on\('line'[\s\S]{0,400}?이력지킴\.비우기\(\)/.test(소스));
}

trace('6-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n위/아래 화살표 검사  ${D}(이력을 뒤져도 치던 글이 안 사라지는가 · Node 판을 안 탄다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
