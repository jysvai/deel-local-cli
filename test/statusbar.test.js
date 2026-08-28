// 상태줄에 새로 붙인 것들 — 경계선 · 눈금 게이지 · 바뀐 것 · 되돌릴 턴.
//
// 상태줄은 화면에서 제일 자주 보는 한 줄이고, 그래서 **틀린 것이 제일 오래
// 안 들키는** 자리이기도 하다. 초록 ⌂ 가 떠 있는데 실은 밖으로 나가고 있다면,
// 그건 아무것도 안 띄우는 것보다 나쁘다. 여기서 재는 것은 예쁜가가 아니라
// '보이는 것과 사실이 같은가' 다.
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/agent/session.js';
import { statusLine, SEGMENTS, SEGMENT_GROUPS, headerLines, GITHUB } from '../src/ui/status.js';
import { 눈금게이지, width } from '../src/ui/ansi.js';
import { 프레임 } from '../src/ui/inputbox.js';
import { COMPACT_AT, FOLD_AT } from '../src/agent/compact.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 민글 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

const root = mkdtempSync(join(tmpdir(), 'deel-statusbar-'));
const 연결 = (base) => ({
  kind: 'openai', base, model: '스텁모델', ctx: 32768,
  streaming: false, tools: true, json: false, think: false,
});
const 새것 = (base = 'http://127.0.0.1:11434/v1') =>
  new Session(연결(base), { root, mode: 'auto', think: 'medium', effort: 'save' });

trace('1-경계선');

// ── 경계선: 소스가 어디로 나가나 ────────────────────────────────────────
{
  const 안 = 민글(SEGMENTS.dir.make(새것()));
  check('이 컴퓨터 안이면 집 글자', 안.startsWith('⌂'), JSON.stringify(안));
  check('색이 초록이다', SEGMENTS.dir.make(새것()).includes('\x1b[92m') || !SEGMENTS.dir.make(새것()).includes('\x1b['),
    '색이 켜져 있으면 초록이어야 한다');

  const 밖 = 민글(SEGMENTS.dir.make(새것('https://gateway.example.com/v1')));
  check('바깥이면 화살표', 밖.startsWith('↗'), JSON.stringify(밖));

  // 못 읽는 주소를 초록으로 칠하면 안 된다. 초록은 '안 나간다' 는 약속이고,
  // 확인 못 한 것을 확인한 낯으로 내미는 것이 제일 나쁘다.
  const 모름 = 민글(SEGMENTS.dir.make(새것('이건 주소가 아니다')));
  check('못 읽는 주소는 초록을 안 쓴다', 모름.startsWith('?'), JSON.stringify(모름));

  // 127.0.0.1 말고 다른 로컬 이름들도 안쪽으로 봐야 한다.
  for (const b of ['http://localhost:1234/v1', 'http://[::1]:8080/v1']) {
    check(`${b} 도 안쪽`, 민글(SEGMENTS.dir.make(새것(b))).startsWith('⌂'), b);
  }

  // 한 글자 + 한 칸. 이게 커지면 좁은 터미널에서 승인 방식이 밀려 사라진다.
  const 폴더만 = 민글(SEGMENTS.dir.make(새것())).slice(2);
  check('경계 표시는 두 칸만 먹는다', width(민글(SEGMENTS.dir.make(새것()))) === width(폴더만) + 2,
    JSON.stringify(민글(SEGMENTS.dir.make(새것()))));

  // 상태줄에 실제로 나오는가.
  check('상태줄 맨 앞에 선다', /▏\s*⌂/.test(민글(statusLine(새것(), { max: 200 }))),
    민글(statusLine(새것(), { max: 200 })).slice(0, 30));
}

trace('2-눈금게이지');

// ── 눈금 게이지: 접기·요약 자리가 미리 보이는가 ─────────────────────────
{
  const g = (r) => 민글(눈금게이지(r, 10, [FOLD_AT, COMPACT_AT]));

  check('빈 게이지에 눈금 두 개', (g(0).match(/┆/g) ?? []).length === 2, g(0));
  check('나머지는 빈 칸', (g(0).match(/▱/g) ?? []).length === 8, g(0));
  check('길이는 언제나 열 칸', [0, 0.3, 0.6, 0.9, 1].every((r) => width(g(r)) === 10),
    [0, 0.3, 0.6, 0.9, 1].map((r) => width(g(r))).join(','));

  // 지나간 눈금은 안 그린다 — 이미 일어난 일을 계속 가리킬 이유가 없고,
  // 남겨 두면 막대가 눈금에 가려 어디까지 찼는지가 흐려진다.
  check('접기 자리를 지나면 그 눈금이 사라진다', (g(0.7).match(/┆/g) ?? []).length === 1, g(0.7));
  check('둘 다 지나면 눈금이 없다', (g(1).match(/┆/g) ?? []).length === 0, g(1));
  check('가득 차면 전부 찬 칸', (g(1).match(/▰/g) ?? []).length === 10, g(1));

  // 눈금 자리가 실제 문턱과 같아야 한다. 코드에 두 번 적어 두면 언젠가 갈라지고,
  // 갈라지는 순간 그 눈금은 거짓말이 된다.
  const 접기칸 = Math.floor(FOLD_AT * 10);
  const 빈것 = [...g(0)];
  check('첫 눈금이 접기 자리', 빈것[접기칸] === '┆', `${접기칸}번째 = ${빈것[접기칸]}`);
  check('둘째 눈금이 요약 자리', 빈것[Math.floor(COMPACT_AT * 10)] === '┆', g(0));

  // 숫자가 아니면 0 으로 본다. 새 연결에서 used/total 이 실제로 NaN 이 된다.
  check('NaN 이어도 막대가 안 사라진다', width(g(NaN)) === 10, JSON.stringify(g(NaN)));
  check('1 을 넘겨도 열 칸', width(g(9)) === 10);
  check('음수도 열 칸', width(g(-3)) === 10);
  check('눈금을 안 주면 그냥 게이지', !민글(눈금게이지(0, 10)).includes('┆'), 민글(눈금게이지(0, 10)));
  check('눈금이 이상해도 안 죽는다', width(민글(눈금게이지(0.5, 10, ['x', null, 99]))) === 10);
}

trace('3-내폴더에무슨일이');

// ── 바뀐 것 · 확인한 것 · 되돌릴 턴 ─────────────────────────────────────
{
  const s = 새것();
  // 아무 일도 없으면 아무것도 안 그린다. 갓 켠 화면에 `✎ 0 · ↩ 0` 이 서 있으면
  // 자리만 먹고, 좁은 터미널에서는 그것 때문에 뒤엣것이 떨어져 나간다.
  check('처음엔 바뀐 것이 없다', SEGMENTS.edits.make(s) == null);
  check('처음엔 확인한 것이 없다', SEGMENTS.verify.make(s) == null);
  check('처음엔 되돌릴 것이 없다', SEGMENTS.undoable.make(s) == null);

  const 갓켠줄 = 민글(statusLine(s, { max: 200 }));
  check('갓 켠 상태줄은 세 덩이', 갓켠줄.split('▏').slice(1).length === 3, 갓켠줄.trim());

  s.noteChange(join(root, 'a.js'), { added: 3, removed: 1 });
  s.noteChange(join(root, 'b.js'), { added: 1, removed: 0 });
  check('바뀐 파일 수를 센다', 민글(SEGMENTS.edits.make(s)) === '✎ 2', 민글(SEGMENTS.edits.make(s)));
  // 같은 파일을 두 번 고쳐도 파일 수는 하나다 — '몇 번 고쳤나' 가 아니라 '몇 개 건드렸나'.
  s.noteChange(join(root, 'a.js'), { added: 2, removed: 0 });
  check('같은 파일을 또 고쳐도 하나로 센다', 민글(SEGMENTS.edits.make(s)) === '✎ 2', 민글(SEGMENTS.edits.make(s)));

  s.검증 = { 돈횟수: 1, 확인: 3, 탈: 0 };
  check('확인한 것을 초록으로', 민글(SEGMENTS.verify.make(s)) === '✓3', 민글(SEGMENTS.verify.make(s)));
  check('탈이 없으면 초록', SEGMENTS.verify.make(s).includes('\x1b[92m') || !SEGMENTS.verify.make(s).includes('\x1b['));
  s.검증 = { 돈횟수: 2, 확인: 3, 탈: 1 };
  check('탈이 있으면 같이 적는다', 민글(SEGMENTS.verify.make(s)) === '✓3 ✗1', 민글(SEGMENTS.verify.make(s)));
  check('탈이 있으면 빨강', SEGMENTS.verify.make(s).includes('\x1b[91m') || !SEGMENTS.verify.make(s).includes('\x1b['));
  check('좁으면 탈만 남긴다', 민글(SEGMENTS.verify.short(s)) === '✗1', 민글(SEGMENTS.verify.short(s)));

  s.되돌릴턴 = 4;
  check('되돌릴 턴 수를 보인다', 민글(SEGMENTS.undoable.make(s)) === '↩ 4', 민글(SEGMENTS.undoable.make(s)));
  s.되돌릴턴 = 0;
  check('되돌릴 것이 없으면 안 그린다', SEGMENTS.undoable.make(s) == null);

  s.되돌릴턴 = 2;
  const 일한줄 = 민글(statusLine(s, { max: 200 }));
  check('일이 생기면 덩이가 하나 붙는다', 일한줄.split('▏').slice(1).length === 4, 일한줄.trim());
  check('한 덩이에 같이 들어간다', /✎ 2 · ✓3 ✗1 · ↩ 2/.test(일한줄), 일한줄.trim());
  check('빈 덩이로 칸막이만 서지 않는다', !/▏\s*▏/.test(일한줄), 일한줄.trim());

  // 좁아도 줄을 안 넘긴다.
  for (const 폭 of [48, 60, 78, 100]) {
    const 줄 = 민글(statusLine(s, { max: 폭 }));
    check(`${폭}칸에서 줄이 안 넘친다`, width(줄) <= 폭, `${width(줄)}칸 · ${줄.trim()}`);
  }
  // 좁아도 경계 표시는 안 잃는다 — 밀리면 안 되는 것이다.
  check('48칸에서도 경계 표시는 남는다', /⌂/.test(민글(statusLine(s, { max: 48 }))),
    민글(statusLine(s, { max: 48 })).trim());
}

trace('4-덩이차례');

// ── 덩이 차례 ───────────────────────────────────────────────────────────
{
  const 평평 = SEGMENT_GROUPS.flat();
  check('모든 조각 이름이 실제로 있다', 평평.every((k) => SEGMENTS[k]),
    평평.filter((k) => !SEGMENTS[k]).join(','));
  check('조각 이름이 안 겹친다', new Set(평평).size === 평평.length, 평평.join(','));
  // 토큰 수는 제일 뒤다 — 좁아지면 이것부터 떨어져야 한다.
  check('토큰이 맨 뒤', SEGMENT_GROUPS.at(-1).join() === 'tok', SEGMENT_GROUPS.at(-1).join());
  check('내 폴더 이야기가 토큰보다 앞', SEGMENT_GROUPS.at(-2).includes('edits'),
    SEGMENT_GROUPS.at(-2).join());
}

trace('5-테두리가경계선');

// ── 입력 상자 테두리가 경계선을 말한다 ──────────────────────────────────
//
// 상태줄 한 글자로도 되지 않느냐 싶지만, 그건 좁으면 밀릴 수 있고 무엇보다
// 사람이 안 본다. 테두리는 치는 글을 감싸고 있어서 안 볼 수가 없다.
{
  const 안 = 프레임({ 글: '안녕', 폭: 80, 바깥: false });
  const 밖 = 프레임({ 글: '안녕', 폭: 80, 바깥: true });

  check('글자는 똑같다', 안.줄들.map(민글).join('\n') === 밖.줄들.map(민글).join('\n'));
  check('폭도 똑같다', 안.줄들.map((l) => width(민글(l))).join() === 밖.줄들.map((l) => width(민글(l))).join());
  check('커서 자리도 똑같다', JSON.stringify(안.커서) === JSON.stringify(밖.커서));

  const 색켜짐 = 안.줄들.join('').includes('\x1b[');
  if (색켜짐) {
    check('바깥이면 테두리 색이 바뀐다', 안.줄들.join('') !== 밖.줄들.join(''));
    const 윗줄 = 밖.줄들.find((l) => 민글(l).includes('╭'));
    check('바깥 테두리는 노랑', 윗줄.includes('\x1b[93m'), JSON.stringify(윗줄));
    check('안쪽 테두리는 평소대로', 안.줄들.find((l) => 민글(l).includes('╭')).includes('\x1b[93m') === false);
    // 아래 테두리도 같이 바뀐다. 위만 노랗고 아래는 회색이면 고장난 것으로 보인다.
    check('아래 테두리도 같이 바뀐다', 밖.줄들.find((l) => 민글(l).includes('╰')).includes('\x1b[93m'),
      JSON.stringify(밖.줄들.find((l) => 민글(l).includes('╰'))));
    // 옆 테두리까지. 세 군데가 따로 놀면 상자가 무지개가 된다.
    check('옆 테두리도 같이 바뀐다', 밖.줄들.find((l) => 민글(l).includes('│')).includes('\x1b[93m'));
  } else {
    check('색이 꺼지면 두 상자가 같다', 안.줄들.join('') === 밖.줄들.join(''));
    check('색이 꺼져도 상자는 그려진다', 민글(안.줄들.join('')).includes('╭'));
    check('색이 꺼져도 아래 테두리가 있다', 민글(안.줄들.join('')).includes('╰'));
    check('색이 꺼져도 옆 테두리가 있다', 민글(안.줄들.join('')).includes('│'));
  }

  // 일하는 중에도, 안 준 경우에도 안 죽는다.
  check('일하는 중에도 테두리가 선다',
    프레임({ 폭: 80, 바깥: true, 일감: { 말: '읽는 중', 돌림: '⠋' } }).줄들.some((l) => 민글(l).includes('╰')));
  // 안 주면 안쪽으로 본다. 기본값이 노랑이면 늘 노란 테두리가 되어 뜻이 사라진다.
  check('바깥을 안 주면 평소대로',
    프레임({ 글: '안녕', 폭: 80 }).줄들.join('') === 안.줄들.join(''));
}

trace('머리말-별부탁');

/*
 * ── 켤 때 나가는 별 부탁 ────────────────────────────────────────────────
 *
 * 주소가 틀리면 부탁이 아니라 오안내다. package.json 의 repository 와
 * **같은 값**이어야 하고, 그 둘이 따로 놀지 않게 여기서 못 박는다.
 *
 * 그리고 파이프·CI 로 흘러 들어가는 기록에는 안 나가야 한다. 거기 섞인
 * 부탁 줄은 그냥 잡음이다.
 */
{
  const 벗기기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
  const 없는것 = { skills: [], commands: [], plugins: [] };
  const s = new Session({ kind: 'openai', base: 'http://127.0.0.1:1/v1', model: 'x', ctx: 32768 }, { root });
  const 원래tty = process.stdout.isTTY;
  const tty로 = (v) => Object.defineProperty(process.stdout, 'isTTY', { value: v, configurable: true });

  tty로(true);
  const 상자판 = headerLines(s, 없는것, true).map(벗기기).join('\n');
  check('켤 때 별 부탁이 뜬다', /github\.com\/jysvai\/deel-local-cli/.test(상자판),
    상자판.split('\n').slice(-1)[0]?.trim() ?? '');

  tty로(false);
  const 파이프판 = headerLines(s, 없는것, false).map(벗기기).join('\n');
  check('파이프·CI 기록에는 안 나간다', !/github\.com/.test(파이프판));
  tty로(true);

  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const 적힌주소 = String(pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
  check('package.json 의 저장소와 같은 주소다', 적힌주소 === GITHUB, `${적힌주소} vs ${GITHUB}`);

  // 부탁은 맨 아래다 — 소스가 어디로 나가는지 읽는 줄들을 밀어내면 안 된다.
  const 줄들 = headerLines(s, 없는것, true).map(벗기기);
  const 별줄 = 줄들.findIndex((l) => /github\.com/.test(l));
  const 보냄줄 = 줄들.findIndex((l) => /이 컴퓨터 안|바깥|sends to|this machine/.test(l));
  check('부탁은 「보냄」 줄보다 아래다', 별줄 > 보냄줄 && 보냄줄 >= 0, `별 ${별줄} · 보냄 ${보냄줄}`);
  tty로(원래tty);
}

rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n상태줄 검사  ${D}(경계선 · 눈금 · 내 폴더에 무슨 일이)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
