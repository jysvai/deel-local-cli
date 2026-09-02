// deel reset — 지우는 기능이라 「무엇을 안 지우나」 를 제일 많이 잰다.
//
// ── 왜 이 검사가 크나 ───────────────────────────────────────────────────
//
// 이건 이 프로그램에서 사람의 진짜 파일을 잃게 할 수 있는 유일한 기능이다.
// 다른 기능은 틀리면 「안 된다」 로 끝나는데, 이건 틀리면 **없어진다.**
// 그래서 지우는 쪽보다 안 지우는 쪽을 더 촘촘히 잰다.
//
// 진짜 `deel` 을 띄워서 확인한다. 함수만 부르면 CLI 배선(인자 → 갈래,
// --yes, --hard, 물어볼 자리가 없을 때)이 안 걸린다.
//
// ── 사람의 진짜 살림을 절대 안 건드린다 ─────────────────────────────────
//
// DEEL_HOME 을 임시 폴더로 주고, 작업 폴더도 임시로 만든다. 이 검사가
// 사람의 ~/.deel 을 건드리면 그건 검사가 아니라 사고다.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 살펴보기, 지우기, 울타리안인가, 설정살피기, 갈래들 } from '../src/reset.js';
import { trace } from './trace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const 진입점 = join(here, '..', 'bin', 'deel.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 치울것 = [];
process.on('exit', () => { for (const d of 치울것) { try { rmSync(d, { recursive: true, force: true }); } catch { /* 임시다 */ } } });

/**
 * 살림 하나를 통째로 차린다. 있을 수 있는 것을 다 넣어 둔다 —
 * 없는 것은 안 지워지는 게 당연해서, 있는 것으로 재야 뜻이 있다.
 */
function 차리기() {
  const home = mkdtempSync(join(tmpdir(), 'deel-reset-home-'));
  const work = mkdtempSync(join(tmpdir(), 'deel-reset-work-'));
  치울것.push(home, work);
  const 집 = (...n) => join(home, ...n);
  const 일 = (...n) => join(work, '.deel', ...n);

  mkdirSync(일('sessions'), { recursive: true });
  mkdirSync(일('history'), { recursive: true });
  mkdirSync(일('증거'), { recursive: true });
  mkdirSync(일('export'), { recursive: true });
  mkdirSync(집('plugins', 'kit-a'), { recursive: true });
  mkdirSync(집('plugins', 'kit-b'), { recursive: true });

  writeFileSync(집('config.json'), JSON.stringify({
    version: 1, active: 'a',
    profiles: [{ id: 'a', apiKey: 'dpapi:QUFB' }, { id: 'b', apiKey: '' }],
  }), 'utf8');
  writeFileSync(집('배운것.json'), '{"모델":{}}', 'utf8');
  writeFileSync(일('배운것.json'), '{"폴더":{}}', 'utf8');
  writeFileSync(일('memory.md'), '- 하나\n- 둘\n- 셋\n', 'utf8');
  for (const n of ['s1', 's2', 's3', 's4']) writeFileSync(일('sessions', `${n}.jsonl`), '{}\n', 'utf8');
  writeFileSync(일('history', 'edits.jsonl'), '{"e":1}\n{"e":2}\n', 'utf8');
  writeFileSync(일('audit.jsonl'), '{"a":1}\n{"a":2}\n{"a":3}\n', 'utf8');
  writeFileSync(일('증거', 'a.md'), '증거\n', 'utf8');
  writeFileSync(일('export', 'a.html'), '<p>x</p>\n', 'utf8');

  // 사람이 손으로 적은 것들. 어떤 길로도 안 지워져야 한다.
  writeFileSync(일('mcp.json'), '{"servers":{}}', 'utf8');
  writeFileSync(join(work, '.deelignore'), 'build/\n', 'utf8');
  writeFileSync(join(work, 'DEEL.md'), '# 규칙\n', 'utf8');
  // 사람의 진짜 일감. .deel 밖이라 아무 갈래로도 안 없어져야 한다.
  writeFileSync(join(work, '내파일.txt'), '이건 사람 것입니다\n', 'utf8');
  mkdirSync(join(work, 'src'), { recursive: true });
  writeFileSync(join(work, 'src', 'app.js'), 'console.log(1)\n', 'utf8');

  return { home, work, 집, 일 };
}

const 있나 = (p) => existsSync(p);
/** 곁말에 화면 출력을 그대로 넣으면 여러 줄이 되어 검사 결과표가 깨진다. */
const 한줄 = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);

function 띄우기(인자, { home, work, 제한 = 20000, 입력 = null } = {}) {
  return new Promise((done) => {
    const kid = spawn(process.execPath, [진입점, ...인자], {
      cwd: work,
      // FORCE_COLOR 를 지운다. 러너가 켜 둔 채로 물려주면 아이가
      // "NO_COLOR 는 무시됩니다" 경고를 표준오류로 뱉고, 그게 곁말에 섞인다.
      env: { ...process.env, FORCE_COLOR: '', DEEL_HOME: home, NO_COLOR: '1', COLUMNS: '100', DEEL_NO_OPEN: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = ''; let err = '';
    kid.stdout.on('data', (b) => (out += b));
    kid.stderr.on('data', (b) => (err += b));
    const 시계 = setTimeout(() => kid.kill('SIGKILL'), 제한);
    if (입력 !== null) kid.stdin.write(입력);
    kid.stdin.end();
    kid.on('close', (code) => { clearTimeout(시계); done({ code, out, err }); });
  });
}

trace('1-살펴보기');

// ── 1. 무엇이 얼마나 있나 ───────────────────────────────────────────────
{
  const { home, work, 집 } = 차리기();
  const r = 살펴보기({ home, root: work });
  const 것 = (k) => r.항목.find((x) => x.키 === k) ?? r.굳은것.find((x) => x.키 === k);

  check('연결·프로필을 센다', 것('model').몇 === 2, String(것('model').몇));
  check('기억 줄을 센다', 것('memory').몇 === 3, String(것('memory').몇));
  check('대화를 센다', 것('sessions').몇 === 4, String(것('sessions').몇));
  check('배운 것은 두 곳', 것('learned').몇 === 2, String(것('learned').몇));
  check('플러그인을 센다', 것('plugins').몇 === 2, String(것('plugins').몇));
  check('되돌리기 자리를 센다', 것('history').몇 === 2, String(것('history').몇));
  check('감사기록 줄을 센다', 것('audit').몇 === 3, String(것('audit').몇));
  check('잠긴 열쇠를 알아본다', 것('model').열쇠.length === 1, String(것('model').열쇠.length));

  // 세는 것과 지우는 것이 **같은 목록**을 봐야 한다. 두 벌이 되면 화면에
  // 안 뜬 것이 지워지거나, 뜨는데 안 지워진다.
  check('★ 갈래 이름이 CLI 가 받는 것과 같다',
    r.항목.filter((x) => !x.숨은것).every((x) => 갈래들.includes(x.키)),
    r.항목.map((x) => x.키).join(','));
  check('all 에 드는 것과 안 드는 것이 갈려 있다',
    r.항목.filter((x) => x.all).length === 5 && 것('plugins').all === false,
    r.항목.filter((x) => x.all).map((x) => x.키).join(','));

  // 자리가 진짜 그 자리인가 — 목록이 엉뚱한 곳을 가리키면 위 숫자는 다 거짓이다.
  check('플러그인 자리가 살림 폴더 안이다',
    resolve(것('plugins').자리[0]) === resolve(집('plugins')), 것('plugins').자리[0]);
}

trace('2-울타리');

// ── 2. 울타리 ───────────────────────────────────────────────────────────
//
// 「작업 폴더 밖은 절대 안 건드린다」 는 이 기능의 뿌리다.
{
  const 집 = 'C:/tmp/집';
  const 일 = 'C:/tmp/일/.deel';
  check('안쪽은 된다', 울타리안인가('C:/tmp/일/.deel/memory.md', [집, 일]));
  check('★ 바깥은 안 된다', !울타리안인가('C:/tmp/일/내파일.txt', [집, 일]));
  check('★ 위로 올라가는 것도 안 된다', !울타리안인가('C:/tmp/일/../../남의것', [집, 일]));
  check('★ 울타리 그 자체도 안 준다', !울타리안인가(일, [집, 일]) && !울타리안인가(집, [집, 일]));
  check('★ 이름만 비슷한 옆 폴더는 안 된다', !울타리안인가('C:/tmp/일/.deel-백업/x', [집, 일]),
    String(울타리안인가('C:/tmp/일/.deel-백업/x', [집, 일])));
  check('상대경로도 풀어서 본다', 울타리안인가('C:/tmp/일/.deel/sessions/../memory.md', [집, 일]));
}

trace('3-깨진설정');

// ── 3. 설정이 깨져 있어도 돈다 ──────────────────────────────────────────
//
// 초기화를 찾는 까닭이 대개 설정이 깨져서다. 여기서 멈추면 이 기능은
// 정작 필요한 자리에서 못 쓴다.
{
  const { home, work } = 차리기();
  writeFileSync(join(home, 'config.json'), '{ 이건 JSON 이 아니다', 'utf8');

  const s = 설정살피기(join(home, 'config.json'));
  check('★ 깨진 설정도 있다고는 안다', s.있나 === true);
  check('★ 몇 개인지는 모른다고 말한다', s.프로필 === null, String(s.프로필));
  check('까닭이 한 줄로 적힌다', /읽을 수 없습니다/.test(s.왜) && !/\n/.test(s.왜), s.왜);

  const r = 살펴보기({ home, root: work });
  check('살펴보기가 안 죽는다', r.항목.length > 0);
  const 지움 = 지우기('model', { home, root: work });
  check('★ 깨져 있어도 지운다', !있나(join(home, 'config.json')));
  check('지웠다고 적는다', 지움.지운것.some((x) => x.키 === 'model'), JSON.stringify(지움.지운것.map((x) => x.키)));
}

trace('3b-잠금장치');

// ── 3-b. 잠금장치까지 손대나 ★ ──────────────────────────────────────────
//
// 설정 파일만 지우면 이 PC 계정의 잠금장치(DPAPI·키체인)에는 열쇠가 그대로
// 남는다. 화면에는 「초기화했습니다」 가 뜨는데 열쇠는 살아 있는 상태다.
// 「초기화」 라고 말하려면 그것까지 손대야 하고, 못 지웠으면 못 지웠다고
// 말해야 한다.
{
  const { home, work } = 차리기();
  const r = 지우기('model', { home, root: work });
  check('★ 잠긴 열쇠가 있으면 잠금장치를 손댄다', r.열쇠 !== null, JSON.stringify(r.열쇠));
  check('★ 무엇을 했는지 말로 답한다',
    typeof r.열쇠?.방식 === 'string' && (r.열쇠.지움 === true || r.열쇠.왜.length > 3),
    JSON.stringify(r.열쇠));

  // 잠긴 열쇠가 없으면 손댈 것도 없다 — 없는 일을 했다고 하면 안 된다.
  const 맨것 = 차리기();
  writeFileSync(join(맨것.home, 'config.json'),
    JSON.stringify({ version: 1, profiles: [{ id: 'a', apiKey: '' }] }), 'utf8');
  const r2 = 지우기('model', { home: 맨것.home, root: 맨것.work });
  check('★ 잠긴 열쇠가 없으면 손댔다고 안 한다', r2.열쇠 === null, JSON.stringify(r2.열쇠));
}

trace('4-무엇을-안-지우나');

// ── 4. all 이 무엇을 남기나 ★ ───────────────────────────────────────────
{
  const { home, work, 집, 일 } = 차리기();
  const r = 지우기('all', { home, root: work });

  check('all 이 설정을 지운다', !있나(집('config.json')));
  check('all 이 기억을 지운다', !있나(일('memory.md')));
  check('all 이 대화를 지운다', !있나(일('sessions')));
  check('all 이 배운 것을 둘 다 지운다', !있나(집('배운것.json')) && !있나(일('배운것.json')));
  check('all 이 증거·내보낸 것을 지운다', !있나(일('증거')) && !있나(일('export')));

  check('★ all 이 되돌리기 스냅샷을 남긴다', 있나(일('history', 'edits.jsonl')));
  check('★ all 이 감사기록을 남긴다', 있나(일('audit.jsonl')));
  check('★ all 이 플러그인을 남긴다', 있나(집('plugins', 'kit-a')));
  check('★ all 이 mcp.json 을 남긴다', 있나(일('mcp.json')));
  check('★ all 이 .deelignore 를 남긴다', 있나(join(work, '.deelignore')));
  check('★ all 이 DEEL.md 를 남긴다', 있나(join(work, 'DEEL.md')));
  check('★ all 이 사람 파일을 안 건드린다',
    있나(join(work, '내파일.txt')) && 있나(join(work, 'src', 'app.js')));
  check('★ 작업 폴더 자체가 남는다', 있나(work));
  check('★ 살림 폴더 자체가 남는다', 있나(home));

  check('배운 것을 한 줄로 적는다',
    r.지운것.filter((x) => x.키 === 'learned').length === 1
    && r.지운것.find((x) => x.키 === 'learned').자리들.length === 2,
    JSON.stringify(r.지운것.map((x) => `${x.키}:${x.자리들.length}`)));
  check('못 지운 것이 없다', r.못한것.length === 0, JSON.stringify(r.못한것));
}

trace('5-hard');

// ── 5. --hard 는 그 둘까지 ──────────────────────────────────────────────
{
  const { home, work, 집, 일 } = 차리기();
  지우기('all', { home, root: work, hard: true });
  check('--hard 가 되돌리기 스냅샷을 지운다', !있나(일('history')));
  check('--hard 가 감사기록을 지운다', !있나(일('audit.jsonl')));
  check('★ --hard 도 mcp.json 은 안 지운다', 있나(일('mcp.json')));
  check('★ --hard 도 .deelignore 는 안 지운다', 있나(join(work, '.deelignore')));
  check('★ --hard 도 플러그인은 안 지운다', 있나(집('plugins', 'kit-a')));
  check('★ --hard 도 사람 파일은 안 건드린다', 있나(join(work, '내파일.txt')));
}

trace('6-갈래마다');

// ── 6. 갈래 하나는 그것만 지운다 ────────────────────────────────────────
{
  for (const [갈래, 없어야, 있어야] of [
    ['model', (집, 일) => [집('config.json')], (집, 일) => [일('memory.md'), 일('sessions'), 집('plugins')]],
    ['memory', (집, 일) => [일('memory.md')], (집, 일) => [집('config.json'), 일('sessions')]],
    ['sessions', (집, 일) => [일('sessions')], (집, 일) => [집('config.json'), 일('memory.md')]],
    ['learned', (집, 일) => [집('배운것.json'), 일('배운것.json')], (집, 일) => [집('config.json'), 일('memory.md')]],
    ['plugins', (집, 일) => [집('plugins')], (집, 일) => [집('config.json'), 일('memory.md'), 일('sessions')]],
  ]) {
    const { home, work, 집, 일 } = 차리기();
    지우기(갈래, { home, root: work });
    check(`${갈래}: 제 것만 지운다`, 없어야(집, 일).every((p) => !있나(p)),
      없어야(집, 일).filter((p) => 있나(p)).join(', '));
    check(`${갈래}: 남의 것은 안 지운다`, 있어야(집, 일).every((p) => 있나(p)),
      있어야(집, 일).filter((p) => !있나(p)).join(', '));
    check(`${갈래}: 되돌리기·감사기록은 그대로`,
      있나(일('history', 'edits.jsonl')) && 있나(일('audit.jsonl')));
  }
}

trace('7-CLI');

// ── 7. 진짜 CLI ─────────────────────────────────────────────────────────
{
  {
    const { home, work, 집, 일 } = 차리기();
    const r = await 띄우기(['reset'], { home, work });
    check('그냥 부르면 0 으로 끝난다', r.code === 0, `${r.code} ${한줄(r.err)}`);
    check('★ 그냥 부르면 아무것도 안 지운다',
      있나(집('config.json')) && 있나(일('memory.md')) && 있나(일('sessions')));
    check('무엇이 얼마나 있는지 보여 준다', /연결·프로필/.test(r.out) && /4개/.test(r.out), 한줄(r.out));
    check('안 지우는 것도 같이 보여 준다', /안 지웁니다/.test(r.out));
    check('사람이 적은 것을 이름으로 적는다', /mcp\.json/.test(r.out) && /\.deelignore/.test(r.out));
    check('★ 살림 자리·작업 폴더를 적는다 — 어디를 지우는지 보이게',
      r.out.includes(home) && r.out.includes(work));
    check('물어볼 자리가 없으면 어떻게 쓰는지 알려 준다', /deel reset </.test(r.out), 한줄(r.out));
  }

  {
    const { home, work, 일 } = 차리기();
    const r = await 띄우기(['reset', 'memory'], { home, work });
    check('★ --yes 없이 파이프면 안 지운다', 있나(일('memory.md')));
    check('★ 그때 종료코드가 1', r.code === 1, String(r.code));
    check('--yes 를 주라고 말한다', /--yes/.test(r.out), 한줄(r.out));
  }

  {
    const { home, work, 집, 일 } = 차리기();
    const r = await 띄우기(['reset', 'all', '--yes'], { home, work });
    check('all --yes 가 0 으로 끝난다', r.code === 0, `${r.code} ${한줄(r.err)}`);
    check('all --yes 가 실제로 지운다', !있나(집('config.json')) && !있나(일('sessions')));
    check('★ all --yes 도 되돌리기·감사기록은 남긴다',
      있나(일('history', 'edits.jsonl')) && 있나(일('audit.jsonl')));
    // 「완료」 한 줄은 확인이 안 된다. 무엇을 몇 개 지웠는지 적혀야 한다.
    check('★ 무엇을 몇 개 지웠는지 적는다', /연결·프로필/.test(r.out) && /4개/.test(r.out), 한줄(r.out));
    // 경고가 **지운 뒤**에 나오면 아무 소용이 없다. 첫 ✓ 보다 앞에 있어야 한다.
    const 경고 = r.out.indexOf('되돌릴 수 없습니다');
    const 첫결과 = r.out.indexOf('✓');
    check('★ 지우기 전에 되돌릴 수 없다고 적는다',
      경고 > 0 && 첫결과 > 0 && 경고 < 첫결과, `경고 ${경고} · 첫 결과 ${첫결과}`);
    check('플러그인은 따로 해야 한다고 알려 준다', /deel reset plugins/.test(r.out));
  }

  {
    const { home, work, 일 } = 차리기();
    const r = await 띄우기(['reset', 'all', '--hard', '--yes'], { home, work });
    check('all --hard --yes 가 0 으로 끝난다', r.code === 0, String(r.code));
    check('--hard 가 되돌리기·감사기록까지 지운다',
      !있나(일('history')) && !있나(일('audit.jsonl')));
    check('★ --hard 여도 mcp.json 은 남는다', 있나(일('mcp.json')));
  }

  {
    const { home, work, 집 } = 차리기();
    const r = await 띄우기(['reset', '엉뚱한것', '--yes'], { home, work });
    check('모르는 갈래는 1 로 끝난다', r.code === 1, String(r.code));
    check('★ 모르는 갈래면 아무것도 안 지운다', 있나(집('config.json')));
    check('그때 쓸 수 있는 갈래를 알려 준다', /model/.test(r.out) && /plugins/.test(r.out));
  }

  {
    // 아무것도 없는 새 PC. 여기서 죽으면 처음 깐 사람이 제일 먼저 만난다.
    const home = mkdtempSync(join(tmpdir(), 'deel-reset-빈집-'));
    const work = mkdtempSync(join(tmpdir(), 'deel-reset-빈일-'));
    치울것.push(home, work);
    const r = await 띄우기(['reset', 'all', '--yes'], { home, work });
    check('★ 빈 PC 에서도 안 죽는다', r.code === 0, `${r.code} ${한줄(r.err)}`);
    check('지울 것이 없다고 말한다', /지울 것이 없었습니다|없습니다/.test(r.out), 한줄(r.out));
    check('빈 PC 에서 폴더를 새로 만들지 않는다',
      readdirSync(home).length === 0, readdirSync(home).join(','));
  }
}

trace('8-도움말-완성');

// ── 8. 도움말·완성 목록이 실제와 같은가 ─────────────────────────────────
{
  const { home, work } = 차리기();
  const r = await 띄우기(['--help'], { home, work });
  check('도움말에 reset 이 있다', /deel reset/.test(r.out));
  for (const 갈래 of 갈래들) {
    check(`도움말이 ${갈래} 를 적어 둔다`, r.out.includes(`deel reset ${갈래}`), '');
  }
  check('도움말이 --hard 를 적어 둔다', /--hard/.test(r.out));
  check('★ 도움말이 안 지우는 것을 적어 둔다',
    /mcp\.json/.test(r.out) && /\.deelignore/.test(r.out), '');
}

trace('9-진짜집');

// ── 9. 사람의 진짜 살림을 안 건드렸나 ★ ─────────────────────────────────
//
// 이 검사가 도는 동안 ~/.deel 은 한 톨도 안 바뀌어야 한다. DEEL_HOME 을
// 주는 것이 실제로 먹는지를 여기서 잰다 — 안 먹으면 이 파일이 사람의
// 진짜 설정을 지우는 셈이 된다.
{
  const 진짜 = join(homedir(), '.deel');
  const 전 = 있나(진짜) ? readdirSync(진짜).sort().join(',') : '(없음)';
  const { home, work } = 차리기();
  await 띄우기(['reset', 'all', '--hard', '--yes'], { home, work });
  await 띄우기(['reset', 'plugins', '--yes'], { home, work });
  const 후 = 있나(진짜) ? readdirSync(진짜).sort().join(',') : '(없음)';
  check('★ 사람의 ~/.deel 이 그대로다', 전 === 후, `${전} → ${후}`);

  // 살펴보기가 부르는 자리가 임시 폴더 안만 가리키는지도 본다.
  const r = 살펴보기({ home, root: work });
  const 밖 = [...r.항목, ...r.굳은것].flatMap((x) => x.자리)
    .filter((p) => !resolve(p).startsWith(resolve(home)) && !resolve(p).startsWith(resolve(work)));
  check('★ 목록의 모든 자리가 준 폴더 안이다', 밖.length === 0, 밖.join(', '));
}

trace('10-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\ndeel reset 검사  ${D}(무엇을 안 지우나)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
