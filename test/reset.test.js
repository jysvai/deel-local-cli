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
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 살펴보기, 지우기, 울타리안인가, 설정살피기, 갈래들 } from '../src/reset.js';
import { pluginsDir } from '../src/plugins/manage.js';
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

  /*
   * ── 키체인 열쇠가 둘이면 첫 것만 지웠다 ─────────────────────────────
   *
   * 프로필마다 제 자리를 쓰니 잠긴 열쇠가 여럿일 수 있다. 여기가 `열쇠[0]` 하나만
   * 지워서, 화면은 「초기화했습니다」 인데 두 번째 프로필의 열쇠는 키체인에 남았다.
   *
   * 이름은 이 검사만의 것이다 — 맥에서 돌아도 사람의 열쇠를 안 건드린다
   * (없는 것을 지우면 「이미 없습니다」 로 끝난다). 맥이 아니면 지우러 가지도 않는다.
   */
  const 둘 = 차리기();
  const 이름1 = `deel-검사-reset-${process.pid}-하나`;
  const 이름2 = `deel-검사-reset-${process.pid}-둘`;
  writeFileSync(join(둘.home, 'config.json'), JSON.stringify({
    version: 1,
    profiles: [{ id: 'a', apiKey: `keychain:${이름1}` }, { id: 'b', apiKey: `keychain:${이름2}` }, { id: 'c', apiKey: `keychain:${이름2}` }],
  }), 'utf8');
  const r3 = 지우기('model', { home: 둘.home, root: 둘.work });
  const 본이름들 = (r3.열쇠들 ?? []).map((x) => x.이름);
  check('★★ 잠긴 열쇠가 여럿이면 하나하나 다 손댄다', 본이름들.includes(이름1) && 본이름들.includes(이름2),
    JSON.stringify(r3.열쇠들));
  check('  같은 자리를 두 번 지우러 가지 않는다', 본이름들.length === 2, JSON.stringify(본이름들));
  check('  열쇠마다 무엇을 했는지 말한다', (r3.열쇠들 ?? []).every((x) => typeof x.방식 === 'string' && (x.지움 || x.왜.length > 3)),
    JSON.stringify(r3.열쇠들));
  check('  모아 본 답도 남는다 — 하나라도 못 지웠으면 다 지웠다고 안 한다',
    r3.열쇠 !== null && r3.열쇠.지움 === (r3.열쇠들 ?? []).every((x) => x.지움), JSON.stringify(r3.열쇠));
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


trace('7b-깃발이-뒤-낱말을-삼키나');

/*
 * ── `deel reset --hard all --yes` 가 아무것도 안 지우고 0 으로 끝났다 ──
 *
 * 값을 안 받는 깃발은 bin/deel.js 의 BOOL 목록에 적어 둬야 한다. 거기에
 * `hard` 가 빠져 있었다. 그래서 `--hard` 가 뒤의 `all` 을 제 값으로 삼켰고,
 * 지울 갈래가 사라졌다 — 화면은 「무엇을 지울지 같이 주세요」 를 찍고
 * **종료코드 0** 으로 끝났다.
 *
 * 사람이 손으로 칠 때는 갈래를 다시 물어 주니까 잘 안 걸린다. 스크립트에서만
 * 걸리고, 스크립트는 0 을 보고 「전체 초기화됐다」 로 알고 다음 줄로 간다.
 */
{
  const { home, work, 집, 일 } = 차리기();
  const r = await 띄우기(['reset', '--hard', 'all', '--yes'], { home, work });
  check('★★ 깃발을 앞에 둬도 갈래를 안 삼킨다',
    !있나(집('config.json')) && !있나(일('sessions')), `${r.code} ${한줄(r.out)}`);
  check('★★ --hard 가 앞에 있어도 굳은 것까지 지운다',
    !있나(일('history')) && !있나(일('audit.jsonl')), 한줄(r.out));
  check('  그리고 0 으로 끝난다', r.code === 0, String(r.code));
  check('★ 그래도 사람이 적은 것은 남는다', 있나(일('mcp.json')));
}

trace('7c-못-읽은-것을-0-으로-적나');

{
  /*
   * 못 읽은 것을 `0` 으로 적으면, 지우기 **전** 확인 화면이 「기억 0줄 →
   * 돌아오지 않습니다」 라고 말한다. 사람은 잃을 것이 없다고 읽고 넘기는데,
   * 바로 다음 줄에서 그 자리가 통째로 사라진다.
   */
  const { home, work, 일 } = 차리기();
  rmSync(일('memory.md'), { force: true });
  mkdirSync(일('memory.md'), { recursive: true });        // 파일 자리에 폴더 — 못 읽는 판
  writeFileSync(join(일('memory.md'), '안엣것.md'), '지워지면 안 되는 글\n', 'utf8');

  const 본것 = 살펴보기({ home, root: work });
  check('★★ 못 읽은 것을 0 이라고 안 한다',
    본것.항목.find((x) => x.키 === 'memory').몇 === null,
    String(본것.항목.find((x) => x.키 === 'memory').몇));

  // 폴더를 세는 자리도 같다 — 폴더 자리에 파일이 있으면 못 센 것이다.
  rmSync(일('sessions'), { recursive: true, force: true });
  writeFileSync(일('sessions'), '여기는 폴더가 아니다', 'utf8');
  // 증거 폴더도 하나 막아 둔다 — 여러 자리를 합쳐 세는 칸이 따로 있다.
  rmSync(일('증거'), { recursive: true, force: true });
  writeFileSync(일('증거'), '여기도 폴더가 아니다', 'utf8');
  const 본것2 = 살펴보기({ home, root: work });
  check('★ 폴더를 못 세도 0 이라고 안 한다',
    본것2.항목.find((x) => x.키 === 'sessions').몇 === null,
    String(본것2.항목.find((x) => x.키 === 'sessions').몇));
  check('★ 여러 자리를 합쳐 셀 때 한 자리만 못 세도 못 센 것이다',
    본것2.항목.find((x) => x.키 === '만든것').몇 === null,
    String(본것2.항목.find((x) => x.키 === '만든것').몇));

  const r = await 띄우기(['reset', 'memory', '--yes'], { home, work });
  check('★ 화면에 「알 수 없음」 으로 뜬다', /알 수 없음/.test(r.out), 한줄(r.out));
  check('  없는 것은 그대로 0 이다',
    살펴보기({ home: mkdtempSync(join(tmpdir(), 'deel-빈-')), root: work }).항목
      .find((x) => x.키 === 'learned').몇 !== null);
}

trace('7d-저장소에-손으로-적은-설정');

{
  /*
   * 저장소의 `.deel/config.json` 에는 프로필 대신 `mode` 나
   * `permissions.deny` 만 적어 두는 쓰임이 있다 — config.js 가 권하는 쓰임이다.
   * 그 파일을 `deel reset model` 이 통째로 지우면, 사람이 손으로 적어 둔
   * **금지 규칙**이 초기화 한 번에 없어진다.
   */
  const { home, work, 일 } = 차리기();
  writeFileSync(일('config.json'), JSON.stringify({
    mode: 'code', permissions: { deny: ['Bash(curl*)'] },
  }), 'utf8');
  const r = await 띄우기(['reset', 'model', '--yes'], { home, work });
  check('★★ 손으로 적은 저장소 설정은 안 지운다', 있나(일('config.json')), 한줄(r.out));
  check('★ 안 지운다고 화면에 적는다', /config\.json/.test(r.out), 한줄(r.out));
  check('  집 설정은 그대로 지운다', !있나(join(home, 'config.json')));

  // 프로필만 적힌 저장소 설정은 연결이 맞으니 그대로 지운다.
  const 둘째 = 차리기();
  writeFileSync(둘째.일('config.json'), JSON.stringify({
    profiles: [{ id: 'repo', baseUrl: 'http://127.0.0.1:1' }],
  }), 'utf8');
  await 띄우기(['reset', 'model', '--yes'], { home: 둘째.home, work: 둘째.work });
  check('★ 연결만 적힌 저장소 설정은 지운다', !있나(둘째.일('config.json')));
}

trace('7f-집-설정에-사람이-적은-칸');

{
  /*
   * 집 설정(`~/.deel/config.json`)에도 연결 말고 **사람이 적은 칸**이 산다 —
   * permissions.deny · offline · shell. 저장소 설정은 그런 칸이 있으면 통째로
   * 남기는데(7d), 집 설정은 `deel reset model` 한 번에 통째로 지웠다. 사람이 건
   * 금지와 봉인이 「연결 초기화」 에 딸려 사라졌다 — 이 파일 머리말이 「사람이
   * 손으로 적은 것은 어떤 길로도 안 지운다」 고 적어 둔 약속이다.
   */
  const 사람칸설정 = JSON.stringify({
    version: 1, active: 'a', offline: true, shell: 'bash',
    permissions: { deny: ['Bash(curl*)'] },
    profiles: [{ id: 'a', apiKey: '' }],
  });
  const { home, work, 집 } = 차리기();
  writeFileSync(집('config.json'), 사람칸설정, 'utf8');
  const r = 지우기('model', { home, root: work });
  const 남은 = 있나(집('config.json')) ? JSON.parse(readFileSync(집('config.json'), 'utf8')) : null;
  check('★★ 집 설정에 사람이 적은 칸이 있으면 파일을 남긴다', !!남은, '');
  check('★★ 금지·봉인·셸은 그대로 남는다',
    남은?.offline === true && 남은?.shell === 'bash' && (남은?.permissions?.deny ?? []).includes('Bash(curl*)'),
    JSON.stringify(남은));
  check('★★ 연결 칸은 걷는다', !!남은 && 남은.profiles === undefined && 남은.active === undefined, JSON.stringify(남은));
  check('  지웠다고 적는다', r.지운것.some((x) => x.키 === 'model'), JSON.stringify(r.지운것.map((x) => x.키)));

  const 둘째 = 차리기();
  writeFileSync(둘째.집('config.json'), 사람칸설정, 'utf8');
  const 화면 = await 띄우기(['reset', 'model', '--yes'], { home: 둘째.home, work: 둘째.work });
  check('★ 연결 칸만 걷었다고 화면에 적는다', /연결 칸만/.test(화면.out), 한줄(화면.out));
  check('  CLI 로도 금지가 남는다',
    있나(둘째.집('config.json')) && readFileSync(둘째.집('config.json'), 'utf8').includes('Bash(curl*)'), '');
}

{
  // 안 지우고 남기는 저장소 설정의 프로필까지 세면, 「연결·프로필 3개 → 지웁니다」 라고
  // 적어 놓고 실제로는 2개만 지운다. 셈과 지우는 것이 같은 목록이어야 한다.
  const { home, work, 일 } = 차리기();
  writeFileSync(일('config.json'), JSON.stringify({ mode: 'code', profiles: [{ id: 'repo' }] }), 'utf8');
  const 몇 = 살펴보기({ home, root: work }).항목.find((x) => x.키 === 'model').몇;
  check('★★ 안 지우는 저장소 설정의 프로필은 세지 않는다', 몇 === 2, String(몇));
}

{
  // Azure 판 번호는 설정에서 `apiVersion` 으로 읽힌다(backend/azure.js). 연결 칸
  // 목록에 `api-version` 만 있어서 이 칸이 「사람이 적은 다른 것」 으로 잡혔다.
  const d = mkdtempSync(join(tmpdir(), 'deel-reset-판-'));
  치울것.push(d);
  writeFileSync(join(d, 'c.json'), JSON.stringify({ version: 1, apiVersion: '2024-10-21', profiles: [] }), 'utf8');
  const s = 설정살피기(join(d, 'c.json'));
  check('★ apiVersion · version 은 사람이 적은 다른 칸으로 안 친다', (s.다른것 ?? []).length === 0, JSON.stringify(s.다른것));
}

{
  // DEEL_HOME 이 곧 이 폴더의 .deel 이면(홈 폴더에서 돌린 것과 같다) 두 설정은 **한 파일**이다.
  // 따로 세면 「연결·프로필 2개」 라고 적어 놓고 1개를 지운다.
  const d = mkdtempSync(join(tmpdir(), 'deel-reset-한파일-'));
  치울것.push(d);
  mkdirSync(join(d, '.deel'), { recursive: true });
  writeFileSync(join(d, '.deel', 'config.json'), JSON.stringify({ version: 1, active: 'a', profiles: [{ id: 'a' }] }), 'utf8');
  const 모델 = 살펴보기({ home: join(d, '.deel'), root: d }).항목.find((x) => x.키 === 'model');
  check('★★ 집과 저장소 설정이 한 파일이면 한 번만 센다', 모델.몇 === 1, String(모델.몇));
  check('★ 지울 자리도 한 번만 적는다', 모델.자리.length === 1, JSON.stringify(모델.자리));
}

{
  // 깨진 저장소 설정은 안 지우고 남긴다(저장소에 딸린 파일이다). 그런데 화면에는
  // 「연결 말고 다른 것이 적혀 있습니다」 가 떴다 — 읽지도 못한 파일에 대해 한 말이다.
  const { home, work, 일 } = 차리기();
  writeFileSync(일('config.json'), '{ "profiles": [ <<<<<<< HEAD', 'utf8');
  const 남김 = 살펴보기({ home, root: work }).안건드림.filter((x) => x.있나).map((x) => x.이름);
  const 그줄 = 남김.find((x) => x.startsWith('.deel/config.json')) ?? '';
  check('★ 깨진 저장소 설정은 읽을 수 없어서 남긴다고 적는다',
    /읽을 수 없/.test(그줄) && !/다른 것이 적혀/.test(그줄), 그줄 || JSON.stringify(남김));
}

{
  // 남기는 저장소 설정에 잠긴 열쇠가 적혀 있으면 잠금장치를 손대지 않는다 —
  // 파일은 그대로 두고 그 파일이 가리키는 열쇠만 없애게 된다.
  const { home, work, 집, 일 } = 차리기();
  writeFileSync(집('config.json'), JSON.stringify({ version: 1, profiles: [{ id: 'a', apiKey: '' }] }), 'utf8');
  writeFileSync(일('config.json'), JSON.stringify({ mode: 'code', profiles: [{ id: 'r', apiKey: 'keychain:repo-key' }] }), 'utf8');
  const 모델 = 살펴보기({ home, root: work }).항목.find((x) => x.키 === 'model');
  check('★★ 남기는 저장소 설정의 잠긴 열쇠는 안 지운다', (모델.열쇠 ?? []).length === 0, JSON.stringify(모델.열쇠));
}

{
  // 집 설정에 연결 칸이 하나도 없고 사람이 적은 칸만 있으면 걷을 것이 없다.
  // 그런데도 파일을 되써 놓고 「연결·프로필 0개 지웠습니다 (연결 칸만)」 이라고 적었다.
  const { home, work, 집 } = 차리기();
  const 원래 = JSON.stringify({ permissions: { deny: ['Bash(rm*)'] } }, null, 2);
  writeFileSync(집('config.json'), 원래, 'utf8');
  const r = 지우기('model', { home, root: work });
  const 지금 = 있나(집('config.json')) ? readFileSync(집('config.json'), 'utf8') : '(파일이 지워졌다)';
  check('★ 연결 칸이 없는 집 설정은 손대지 않는다', 지금 === 원래, 한줄(지금));
  check('★ 지웠다고 적지 않는다', !r.지운것.some((x) => x.키 === 'model'), JSON.stringify(r.지운것.map((x) => x.키)));
}

trace('7e-플러그인이-깔리는-자리와-지우는-자리');

{
  /*
   * `DEEL_HOME` 을 쓰는 휴대용 설치(USB·공유폴더)에서 두 자리가 갈려 있었다.
   * 깔리는 쪽은 OS 집 폴더를 보고, 지우는 쪽은 `DEEL_HOME` 을 봤다. 그래서
   * `deel reset plugins` 는 「플러그인 0개 · 이미 비어 있습니다」 를 찍고
   * 종료코드 0 으로 끝나는데 플러그인은 그대로 살아 있었다.
   */
  const 살림 = mkdtempSync(join(tmpdir(), 'deel-살림-'));
  치울것.push(살림);
  const 옛DEEL = process.env.DEEL_HOME;
  process.env.DEEL_HOME = 살림;
  try {
    check('★★ 깔리는 자리와 지우는 자리가 같다',
      pluginsDir() === 살펴보기({ root: process.cwd() }).항목.find((x) => x.키 === 'plugins').자리[0],
      `${pluginsDir()}`);
    check('  그 자리가 살림 폴더 안이다', pluginsDir().startsWith(살림), pluginsDir());
  } finally {
    if (옛DEEL === undefined) delete process.env.DEEL_HOME;
    else process.env.DEEL_HOME = 옛DEEL;
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

trace('9b-링크너머');

// ── 작업 폴더 .deel 이 링크면 그 너머를 지웠다 (6회차 Gemini 되돌림6ab-b R4) ──────
//
// 울타리안인가 가 resolve 만 해서, `.deel` 이 다른 폴더로 가는 링크(리눅스·맥 git 은 받은
// 저장소의 링크를 그대로 푼다)면 그 너머의 memory.md · tmp · export 가 「작업 폴더 안」 으로
// 읽혀 통째로 지워졌다. 화면은 작업 폴더 경로만 적어 사람이 못 알아챈다.
{
  const { symlinkSync, unlinkSync } = await import('node:fs');
  const 집곳 = mkdtempSync(join(tmpdir(), 'deel-reset-link-home-'));
  const 일곳 = mkdtempSync(join(tmpdir(), 'deel-reset-link-work-'));
  const 남곳 = mkdtempSync(join(tmpdir(), 'deel-reset-link-victim-'));
  mkdirSync(join(남곳, 'tmp'), { recursive: true });
  writeFileSync(join(남곳, 'tmp', 'keep.txt'), '남의 파일', 'utf8');
  writeFileSync(join(남곳, 'memory.md'), '남의 기억', 'utf8');
  let 링크됨 = false;
  try { symlinkSync(남곳, join(일곳, '.deel'), 'junction'); 링크됨 = true; } catch { /* 링크를 못 만드는 환경 */ }
  if (링크됨) {
    const r = 지우기('all', { home: 집곳, root: 일곳 });
    check('★ (6회차 R4) 작업 폴더 .deel 이 링크면 그 너머의 파일을 안 지운다',
      existsSync(join(남곳, 'tmp', 'keep.txt')) && existsSync(join(남곳, 'memory.md')), JSON.stringify(r.지운것.map((x) => x.자리들)));
    check('  안 건드렸다고 말한다', r.못한것.some((x) => /밖/.test(x.왜)), JSON.stringify(r.못한것).slice(0, 160));
    unlinkSync(join(일곳, '.deel'));
  } else {
    console.log('  (R4 판은 링크를 못 만드는 환경이라 건너뜀)');
  }

  // 짝: 진짜 .deel 안의 한 자리(tmp)가 링크면 그 링크만 지우고 너머는 그대로 둔다.
  const 남곳2 = mkdtempSync(join(tmpdir(), 'deel-reset-link-victim2-'));
  writeFileSync(join(남곳2, 'keep.txt'), '남의 파일 둘', 'utf8');
  mkdirSync(join(일곳, '.deel'), { recursive: true });
  writeFileSync(join(일곳, '.deel', 'memory.md'), '- 내 기억\n', 'utf8');
  let 링크됨2 = false;
  try { symlinkSync(남곳2, join(일곳, '.deel', 'tmp'), 'junction'); 링크됨2 = true; } catch { /* 링크를 못 만드는 환경 */ }
  const r2 = 지우기('all', { home: 집곳, root: 일곳 });
  check('짝: 진짜 .deel 안의 것은 그대로 지운다', !existsSync(join(일곳, '.deel', 'memory.md')), JSON.stringify(r2.못한것).slice(0, 160));
  if (링크됨2) {
    check('짝: .deel 안의 링크는 링크만 지우고 너머는 그대로 둔다', existsSync(join(남곳2, 'keep.txt')), JSON.stringify(r2.지운것.map((x) => x.자리들)));
    if (existsSync(join(일곳, '.deel', 'tmp'))) unlinkSync(join(일곳, '.deel', 'tmp'));
  }
  rmSync(집곳, { recursive: true, force: true });
  rmSync(남곳, { recursive: true, force: true });
  rmSync(남곳2, { recursive: true, force: true });
  rmSync(일곳, { recursive: true, force: true });
}

trace('9c-못지운판');

// ── 못 지운 판에 「이미 비어 있습니다」 를 같이 찍었다 ────────────────────
//
// 지운 것이 하나도 없으면 「지울 것이 없었습니다 — 이미 비어 있습니다」 를 찍는데,
// 그 줄이 **못 지운 것이 있는 판**에서도 그대로 나왔다. 화면에는 두 말이 나란히 붙는다:
//
//   ⚠ 지울 것이 없었습니다 — 이미 비어 있습니다.
//   ✗ 대화 기록 …/.deel/sessions
//      작업 폴더 밖이라 안 건드렸습니다
//
// 앞줄을 믿은 사람은 지워진 줄 알고 그 PC 를 넘긴다 — 지우려던 대화 기록은 그대로다.
// 「없어서 안 지웠다」 와 「있는데 못 지웠다」 는 사람이 할 일이 정반대인 두 말이다.
{
  const { symlinkSync } = await import('node:fs');
  const 집곳 = mkdtempSync(join(tmpdir(), 'deel-reset-못지움-집-'));
  const 일곳 = mkdtempSync(join(tmpdir(), 'deel-reset-못지움-일-'));
  const 남곳 = mkdtempSync(join(tmpdir(), 'deel-reset-못지움-남-'));
  치울것.push(집곳, 일곳, 남곳);
  mkdirSync(join(남곳, 'sessions'), { recursive: true });
  writeFileSync(join(남곳, 'sessions', 's1.jsonl'), '{}\n', 'utf8');

  // 작업 폴더의 `.deel` 이 링크면 그 너머는 「작업 폴더 밖」 이라 안 건드린다 (위 9b).
  // 그러면 지운 것은 0, 못 지운 것은 1 인 판이 된다 — 이 두 말이 부딪치는 자리다.
  let 링크됨 = false;
  try { symlinkSync(남곳, join(일곳, '.deel'), 'junction'); 링크됨 = true; } catch { /* 링크를 못 만드는 환경 */ }
  if (링크됨) {
    const r = await 띄우기(['reset', 'sessions', '--yes'], { home: 집곳, work: 일곳 });
    const 글 = r.out.replace(/\x1b\[[0-9;]*m/g, '');
    check('★★ 못 지운 것이 있으면 「이미 비어 있습니다」 를 안 찍는다',
      !/이미 비어 있습니다/.test(글), 한줄(글.split('\n').filter((l) => /비어|안 건드/.test(l)).join(' / ')));
    check('  못 지웠다는 말은 그대로 찍는다', /안 건드렸습니다/.test(글), 한줄(글.slice(-200)));
    check('  못 지웠으면 1 로 끝난다', r.code === 1, String(r.code));
    check('  진짜로 안 지워졌다', existsSync(join(남곳, 'sessions', 's1.jsonl')), 남곳);
  } else {
    console.log('  (못 지운 판은 링크를 못 만드는 환경이라 건너뜀)');
  }

  // 짝: 진짜로 아무것도 없을 때는 여태처럼 「이미 비어 있습니다」 를 말해야 한다.
  // 「없다」 를 안 말하면 이번에는 반대쪽이 안 보인다.
  const 빈집 = mkdtempSync(join(tmpdir(), 'deel-reset-진짜빈-집-'));
  const 빈일 = mkdtempSync(join(tmpdir(), 'deel-reset-진짜빈-일-'));
  치울것.push(빈집, 빈일);
  const r2 = await 띄우기(['reset', 'sessions', '--yes'], { home: 빈집, work: 빈일 });
  check('짝: 진짜로 비었으면 비었다고 말한다', /이미 비어 있습니다/.test(r2.out), 한줄(r2.out.slice(-200)));
  check('짝: 그때는 0 으로 끝난다', r2.code === 0, String(r2.code));
}

// ── 홈 폴더에서 켜면 배운 것 한 파일을 「2곳」 으로 셌다 (6회차 Gemini 되돌림6ab-a R2) ──
{
  const 일곳 = mkdtempSync(join(tmpdir(), 'deel-reset-samehome-'));
  const 집곳 = join(일곳, '.deel');
  mkdirSync(집곳, { recursive: true });
  writeFileSync(join(집곳, '배운것.json'), '{}', 'utf8');
  const 배움 = 살펴보기({ home: 집곳, root: 일곳 }).항목.find((x) => x.키 === 'learned');
  check('★ (6회차 R2) DEEL_HOME 이 곧 이 폴더 .deel 이면 배운 것은 한 곳으로 센다', 배움?.몇 === 1 && 배움?.자리.length === 1, `몇 ${배움?.몇} · 자리 ${배움?.자리.length}`);
  rmSync(일곳, { recursive: true, force: true });
}

trace('10-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\ndeel reset 검사  ${D}(무엇을 안 지우나)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
