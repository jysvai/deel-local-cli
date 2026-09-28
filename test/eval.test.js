/**
 * `deel eval` — 과제 모음(골든셋)을 돌려 몇 개를 해내나 재는가 (2.1.0 · src/eval/run.js).
 *
 * ── 왜 이 파일이 있나 ──────────────────────────────────────────────────
 *
 * 사내 검토: 「작업마다 골든셋이 필요하다. 정적 검사에 기대면 한계가 있다.」 채점이 틀리면 숫자가
 * 거짓말을 한다. 그래서 세 가지를 **실제로 돌려** 본다.
 *
 *   1. 예제 과제 다섯의 정답 검사가 맞게 가르나 — 손대기 전 폴더는 **실패**, 맞게 고친 폴더는 **통과**
 *   2. 정답이 모델에게 **안 보이나** — 일하는 동안 작업 폴더에 golden/ 이 없나
 *   3. deel eval 이 통과·실패를 세고, 결과를 남기고, 지난번과 견주나
 *
 * 모델 자리는 127.0.0.1 의 스텁이다. 스텁은 시킨 말의 표시를 보고 맞게 쓰거나 틀리게 쓴다.
 */
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const { 설정탈, 과제읽기, 예제만들기, 폴더복사, 결과덩이, 과제별, 견주기, 지난결과, 시각이름, 과제고르기, 판돌리기, 제한초고르기, 실행인자, 같음범위 } = await import('../src/eval/run.js');
const { 예제과제 } = await import('../src/eval/starter.js');

const here = dirname(fileURLToPath(import.meta.url));
const 진입점 = join(here, '..', 'bin', 'deel.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 임시 = (이름) => mkdtempSync(join(tmpdir(), `deel-eval-${이름}-`));
const 지우기 = (d) => rmSync(d, { recursive: true, force: true, maxRetries: 3 });

// ── 1. task.json 모양 ──────────────────────────────────────────────────
trace('1-모양');
{
  check('★ 맞는 모양은 탈이 없다', 설정탈({ prompt: '고쳐', check: 'node c.mjs' }) === null);
  check('★★ prompt 가 없으면 탈', /prompt/.test(설정탈({ check: 'x' }) ?? ''));
  check('★★ check 가 없으면 탈 — 채점할 길이 없다', /check/.test(설정탈({ prompt: 'x' }) ?? ''));
  check('  시간은 0 보다 큰 수', /timeout/.test(설정탈({ prompt: 'x', check: 'y', timeout: -1 }) ?? '') && 설정탈({ prompt: 'x', check: 'y', timeout: 30 }) === null);
  check('  doneCheck 는 글', /doneCheck/.test(설정탈({ prompt: 'x', check: 'y', doneCheck: 3 }) ?? ''));
  check('  배열·null 은 탈', !!설정탈([]) && !!설정탈(null));
  /*
   * 과제마다 완료 검사 판수·시간을 적을 자리가 없었다 (2.1.2). deel run 의 --check-rounds · --check-timeout 으로 넘긴다.
   * 판수는 1 ~ 10 의 정수, 시간은 0 보다 큰 초.
   */
  check('★ doneCheckRounds 는 1 이상의 정수', /doneCheckRounds/.test(설정탈({ prompt: 'x', check: 'y', doneCheck: 'z', doneCheckRounds: 0 }) ?? '')
    && /doneCheckRounds/.test(설정탈({ prompt: 'x', check: 'y', doneCheck: 'z', doneCheckRounds: 1.5 }) ?? '')
    && 설정탈({ prompt: 'x', check: 'y', doneCheck: 'z', doneCheckRounds: 2 }) === null);
  check('★ doneCheckTimeout 은 0 보다 큰 초', /doneCheckTimeout/.test(설정탈({ prompt: 'x', check: 'y', doneCheck: 'z', doneCheckTimeout: 'soon' }) ?? '')
    && 설정탈({ prompt: 'x', check: 'y', doneCheck: 'z', doneCheckTimeout: 90 }) === null);
  check('★ doneCheck 없이 판수·시간만 적으면 탈 — 돌 검사가 없다', /doneCheck/.test(설정탈({ prompt: 'x', check: 'y', doneCheckRounds: 2 }) ?? ''));
  // 2차 눈(Gemini): `true` 는 Number(true) = 1 이라 수 칸을 다 통과했다 — timeout 1초 · `--check-rounds true` 로 과제가 죽는다.
  for (const 칸 of ['timeout', 'checkTimeout', 'doneCheckRounds', 'doneCheckTimeout']) {
    check(`★ ${칸}: true 는 수가 아니다`, new RegExp(칸).test(설정탈({ prompt: 'x', check: 'y', doneCheck: 'z', [칸]: true }) ?? ''));
  }
  check('  글로 적은 수는 읽는다', 설정탈({ prompt: 'x', check: 'y', doneCheck: 'z', timeout: '30', doneCheckRounds: '2' }) === null);
  const 인자 = 실행인자({ prompt: '고쳐', check: 'c', doneCheck: 'npm test', doneCheckRounds: 5, doneCheckTimeout: 90 }, '/w', ['--online']);
  const 뒤 = (깃발) => 인자[인자.indexOf(깃발) + 1];
  check('★★ 과제의 판수·시간이 deel run 깃발로 넘어간다', 뒤('--check') === 'npm test' && 뒤('--check-rounds') === '5' && 뒤('--check-timeout') === '90',
    JSON.stringify(인자));
  check('  시킬 말은 -- 뒤 맨 끝이다 (깃발로 안 읽힌다)', 인자.at(-2) === '--' && 인자.at(-1) === '고쳐' && 인자.includes('--online'));
  check('  안 적었으면 안 넘긴다', !실행인자({ prompt: 'p', check: 'c', doneCheck: 'npm test' }, '/w').includes('--check-rounds'));
}

// ── 2. 예제 과제의 채점이 맞게 가르나 ───────────────────────────────────
//
// 채점이 늘 통과면 성공률은 100% 라는 거짓말이 되고, 늘 실패면 0% 라는 거짓말이 된다. 과제마다
// 손대기 전 폴더와 맞게 고친 폴더 둘 다 재 본다.
trace('2-예제채점');
const 고친것 = {
  '01-버그고치기': (d) => { const p = join(d, 'src/sum.js'); writeFileSync(p, readFileSync(p, 'utf8').replace('list.length - 1', 'list.length')); },
  '02-기능더하기': (d) => {
    const p = join(d, 'src/text.js');
    writeFileSync(p, readFileSync(p, 'utf8') + "\nexport function slugify(t) {\n  return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');\n}\n");
  },
  '03-이름바꾸기': (d) => { for (const f of readdirSync(join(d, 'src'))) { const p = join(d, 'src', f); writeFileSync(p, readFileSync(p, 'utf8').replaceAll('getUser', 'fetchUser')); } },
  '04-빨간검사고치기': (d) => writeFileSync(join(d, 'src/date.js'),
    "export function ymd(d) {\n  const p = (n) => String(n).padStart(2, '0');\n  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;\n}\n"),
  '05-CRLF파일': (d) => writeFileSync(join(d, 'config.ini'), '[server]\r\nport=9090\r\nhost=localhost\r\n'),
};
const 모음 = 임시('모음');
{
  const { 만든, 건너뜀 } = 예제만들기(모음);
  check('★ --init 은 예제 과제 다섯을 만든다', 만든.length === 5 && !건너뜀.length, 만든.join(' · '));
  writeFileSync(join(모음, '01-버그고치기', 'task.json'), JSON.stringify({ prompt: '사람이 고친 과제', check: 'node golden-check.mjs' }));
  const 다시 = 예제만들기(모음);
  check('★★ 이미 있는 과제는 안 덮는다 — 사람이 고쳐 둔 과제가 지워지면 안 된다', 다시.만든.length === 0 && 다시.건너뜀.length === 5
    && /사람이 고친 과제/.test(readFileSync(join(모음, '01-버그고치기', 'task.json'), 'utf8')));
  const 읽은 = 과제읽기(모음);
  check('★ 과제읽기가 다섯을 탈 없이 읽는다', 읽은.length === 5 && 읽은.every((x) => !x.탈 && x.설정), 읽은.map((x) => `${x.이름}:${x.탈 ?? 'ok'}`).join(' '));
  check('  예제 넷째는 완료 검사 고리(doneCheck)를 탄다', 예제과제['04-빨간검사고치기'].task.doneCheck === 'npm test');

  for (const [이름, 과제] of Object.entries(예제과제)) {
    const 채점 = (고치기) => {
      const d = 임시('채점');
      폴더복사(join(모음, 이름, 'start'), d);
      if (고치기) 고치기(d);
      폴더복사(join(모음, 이름, 'golden'), d);
      const r = spawnSync(process.execPath, [join(d, 'golden-check.mjs')], { cwd: d, encoding: 'utf8' });
      지우기(d);
      return r.status;
    };
    check(`★★ ${이름}: 손대기 전 폴더는 정답 검사에서 떨어진다`, 채점(null) !== 0);
    check(`★★ ${이름}: 맞게 고친 폴더는 통과한다`, 채점(고친것[이름]) === 0);
    check(`  ${이름}: 정답 검사 명령은 한 명령이다 (PowerShell 5.1 에서도 돈다)`, !/&&|\|\|/.test(과제.task.check), 과제.task.check);
  }
  {
    // 모델이 고치다 src/ 밑에 폴더(백업 따위)를 만들면 03 의 정답 검사가 readFileSync 에서 EISDIR 로 터졌다 —
    // 맞게 고쳐 놓고 떨어진다 (2.1.1 검수).
    const d = 임시('채점폴더');
    폴더복사(join(모음, '03-이름바꾸기', 'start'), d);
    고친것['03-이름바꾸기'](d);
    mkdirSync(join(d, 'src', 'backup'), { recursive: true });
    폴더복사(join(모음, '03-이름바꾸기', 'golden'), d);
    const r = spawnSync(process.execPath, [join(d, 'golden-check.mjs')], { cwd: d, encoding: 'utf8' });
    지우기(d);
    check('★ 03: src 밑에 폴더가 생겨도 맞게 고친 것은 통과한다', r.status === 0, r.stderr.slice(-200));
    // 거꾸로 — 하위 폴더에 옛 이름이 남았으면 떨어져야 한다. 맨 위만 보면 src/lib/ 의 getUser 를 못 본다 (2.1.1 2차 눈).
    const e = 임시('채점하위');
    폴더복사(join(모음, '03-이름바꾸기', 'start'), e);
    고친것['03-이름바꾸기'](e);
    mkdirSync(join(e, 'src', 'lib'), { recursive: true });
    writeFileSync(join(e, 'src', 'lib', 'old.js'), "export { getUser } from '../user.js';\n");
    폴더복사(join(모음, '03-이름바꾸기', 'golden'), e);
    const r2 = spawnSync(process.execPath, [join(e, 'golden-check.mjs')], { cwd: e, encoding: 'utf8' });
    지우기(e);
    check('★ 03: 하위 폴더에 옛 이름이 남으면 떨어진다', r2.status !== 0, `status=${r2.status}`);
  }
  // 예제의 CRLF 가 실제 파일에 CRLF 로 남았나 — 글로 들고 있다가 LF 로 바뀌면 과제가 무의미하다.
  check('★ 05 의 시작 파일은 실제로 CRLF 다', readFileSync(join(모음, '05-CRLF파일', 'start', 'config.ini'), 'utf8').includes('\r\n'));
}

// ── 3. 작은 조각들 ────────────────────────────────────────────────────
trace('3-조각');
{
  check('★ 결과덩이: 마지막 JSON 줄을 읽는다', 결과덩이('앞말\n{"ok":false}\n{"ok":true,"steps":3}\n')?.steps === 3);
  check('  결과덩이: 없으면 null', 결과덩이('그냥 글') === null && 결과덩이('') === null);
  const 묶음 = 과제별([{ 과제: 'a', 통과: true }, { 과제: 'a', 통과: false }, { 과제: 'b', 통과: true }]);
  check('★ 과제별로 몇 판 중 몇 판', 묶음.find((x) => x.과제 === 'a')?.통과 === 1 && 묶음.find((x) => x.과제 === 'a')?.판 === 2);
  const 견줌 = 견주기([{ 과제: 'a', 판: 1, 통과: 1 }, { 과제: 'b', 판: 1, 통과: 0 }, { 과제: 'c', 판: 1, 통과: 1 }],
    [{ 과제: 'a', 판: 1, 통과: 0 }, { 과제: 'b', 판: 1, 통과: 1 }, { 과제: 'c', 판: 1, 통과: 1 }, { 과제: '새것', 판: 1, 통과: 0 }]);
  check('★★ 지난번과 견줘 나빠진 것 · 나아진 것을 가른다', 견줌.나빠짐.join() === 'a' && 견줌.나아짐.join() === 'b', JSON.stringify(견줌));
  check('  지난번에 없던 과제는 견주지 않는다', !견줌.나빠짐.includes('새것'));
  /*
   * 지난번에 있던 과제가 이번에 없으면 말없이 넘어갔다 (2.1.2). 과제 폴더를 지웠거나 이름을 바꿨는데
   * 남은 과제끼리만 견줘 「지난번과 같습니다」 가 나왔다 — 떨어지던 과제를 지워 통과율을 올려도 모른다.
   */
  const 빠짐 = 견주기([{ 과제: 'a', 판: 1, 통과: 1 }, { 과제: '지운것', 판: 1, 통과: 0 }], [{ 과제: 'a', 판: 1, 통과: 1 }, { 과제: '새것', 판: 1, 통과: 1 }]);
  check('★★ 지난번에 있던 과제가 이번에 없으면 사라짐으로 적는다', 빠짐.사라짐?.join() === '지운것', JSON.stringify(빠짐));
  check('★ 처음 재는 과제는 새것으로 적는다', 빠짐.새것?.join() === '새것', JSON.stringify(빠짐));
  const 일부 = 견주기([{ 과제: 'a', 판: 1, 통과: 1 }, { 과제: 'b', 판: 1, 통과: 1 }], [{ 과제: 'a', 판: 1, 통과: 1 }], { 일부만: true });
  check('  --only 로 일부만 돈 판은 안 고른 과제를 사라짐으로 안 친다', 일부.사라짐.length === 0, JSON.stringify(일부));
  /*
   * 2차 눈(Gemini): 처음 재는 과제가 떨어져도 견준 과제끼리 같으면 「지난번과 같습니다」 가 나왔다 — 새 과제의
   * 실패가 그 말에 묻힌다. --only 판도 고른 과제만 견줬는데 전체가 같다는 말로 읽혔다. 견주지 않은 과제가
   * 있으면 「견준 과제 N개는 같습니다」 로 적는다.
   */
  const 같음 = (지난것, 지금것, 일부만 = false) => 같음범위(견주기(지난것, 지금것, { 일부만 }), { 일부만 });
  const 하나 = [{ 과제: 'a', 판: 1, 통과: 1 }];
  check('★ 다 견줬고 다 같으면 전부 같다', 같음(하나, 하나) === '전부');
  check('★★ 처음 재는 과제가 있으면 견준 만큼만 같다', 같음(하나, [...하나, { 과제: '새것', 판: 1, 통과: 0 }]) === '견준만큼');
  check('★ 사라진 과제가 있으면 견준 만큼만 같다', 같음([...하나, { 과제: '지운것', 판: 1, 통과: 1 }], 하나) === '견준만큼');
  check('★ --only 판은 견준 만큼만 같다', 같음([...하나, { 과제: 'b', 판: 1, 통과: 1 }], 하나, true) === '견준만큼');
  check('  달라진 것이 있으면 같다고 안 한다', 같음(하나, [{ 과제: 'a', 판: 1, 통과: 0 }]) === null);
  check('  견준 것이 없으면 같다고 안 한다', 같음(하나, [{ 과제: 'b', 판: 1, 통과: 1 }]) === null);
}
{
  /*
   * 과제의 제한 시간 — task.json 에 적힌 것이 --timeout 을 이긴다 (pytest-timeout 의 표시·jest 의 과제별 시간과
   * 같은 차례). --timeout 은 제 시간을 안 적은 과제의 기본값이다. 여태 이 차례가 어디에도 안 적혀 있었다.
   */
  check('★ task.json 의 timeout 이 --timeout 을 이긴다', 제한초고르기({ timeout: 30 }, 900) === 30);
  check('★ 안 적은 과제는 --timeout 을 쓴다', 제한초고르기({}, 900) === 900);
  check('  둘 다 없으면 600초', 제한초고르기({}, null) === 600);
}
{
  // 2차 눈(Gemini) 판정: 모델이 `sub` 를 파일로 만들었는데 정답에 `sub/` 폴더가 있으면 복사가 터져 평가 전체가 죽었다.
  const d = 임시('겹침');
  const 정답 = 임시('겹침정답');
  writeFileSync(join(d, 'sub'), '모델이 만든 파일');
  mkdirSync(join(d, 'x.js'), { recursive: true });
  mkdirSync(join(정답, 'sub'), { recursive: true });
  writeFileSync(join(정답, 'sub', 't.js'), 'ok');
  writeFileSync(join(정답, 'x.js'), 'ok');
  let 터짐 = null;
  try { 폴더복사(정답, d, { 덮기: true }); } catch (e) { 터짐 = e.code ?? String(e); }
  check('★★ 정답을 넣을 때 모델이 만든 것과 꼴(파일·폴더)이 달라도 안 터지고 정답이 이긴다', !터짐
    && readFileSync(join(d, 'sub', 't.js'), 'utf8') === 'ok' && readFileSync(join(d, 'x.js'), 'utf8') === 'ok', String(터짐));
  지우기(d); 지우기(정답);
}
{
  // 2차 눈(Gemini) 판정: 손으로 적은 `{}` 가 제일 새 결과면 견줄 것이 없는데도 「지난번과 같습니다」 가 나왔다.
  const d = 임시('지난');
  mkdirSync(join(d, '.results'), { recursive: true });
  writeFileSync(join(d, '.results', '20260101-000000Z.json'), JSON.stringify({ 과제별: [{ 과제: 'a', 판: 1, 통과: 1 }] }));
  writeFileSync(join(d, '.results', '20260102-000000Z.json'), '{}');
  const 지난 = 지난결과(d);
  check('★ 과제별이 없는 결과 파일은 지난번으로 안 친다', 지난?.파일 === '20260101-000000Z.json', JSON.stringify(지난));
  지우기(d);
}
{
  /*
   * ── --only 로 일부만 돌린 결과가 다음 전체 판의 「지난번」 이 됐다 (2.1.1 검수) ──
   *
   * 제일 새 파일을 그대로 집어서, `--only a` 한 번 뒤의 전체 판은 과제 a 하나만 견줬다. 나머지
   * 열아홉이 떨어져도 「지난번과 같습니다」 가 나왔다. 전체 판은 전체 판과 견준다.
   */
  const d = 임시('부분');
  mkdirSync(join(d, '.results'), { recursive: true });
  writeFileSync(join(d, '.results', '20260101-000000Z.json'), JSON.stringify({ 과제별: [{ 과제: 'a', 판: 1, 통과: 1 }, { 과제: 'b', 판: 1, 통과: 1 }] }));
  writeFileSync(join(d, '.results', '20260102-000000Z.json'), JSON.stringify({ only: 'a', 과제별: [{ 과제: 'a', 판: 1, 통과: 1 }] }));
  check('★★ 전체 판은 --only 로 돈 결과를 지난번으로 안 친다', 지난결과(d, { 전체만: true })?.파일 === '20260101-000000Z.json', JSON.stringify(지난결과(d, { 전체만: true })));
  check('  일부만 도는 판은 제일 새 것과 견준다 (그 과제들만 견준다)', 지난결과(d)?.파일 === '20260102-000000Z.json');
  // 일부만 도는 판끼리 겹치는 과제가 없으면(`--only a` 뒤 `--only b`) 견줄 것이 없는데 「지난번과 같습니다」 가 나왔다 (2.1.1 2차 눈).
  check('★ 일부만 도는 판은 지금 과제가 든 결과까지 거슬러 찾는다', 지난결과(d, { 이름들: ['b'] })?.파일 === '20260101-000000Z.json',
    JSON.stringify(지난결과(d, { 이름들: ['b'] })));
  check('  지금 과제가 든 결과가 하나도 없으면 null', 지난결과(d, { 이름들: ['없는과제'] }) === null);
  const 안겹침 = 견주기([{ 과제: 'a', 판: 1, 통과: 1 }], [{ 과제: 'b', 판: 1, 통과: 1 }]);
  check('★ 견주기가 몇 과제를 견줬는지 센다 (0 이면 「같습니다」 라 말할 근거가 없다)', 안겹침.견준 === 0
    && 견주기([{ 과제: 'a', 판: 1, 통과: 1 }], [{ 과제: 'a', 판: 1, 통과: 1 }]).견준 === 1, JSON.stringify(안겹침));
  지우기(d);
  // .results 가 폴더가 아니라 파일이면(손으로 만든 것) 지난번을 찾다 죽지 않는다.
  const e = 임시('파일');
  writeFileSync(join(e, '.results'), 'x');
  let 터짐 = null;
  try { 지난결과(e); } catch (err) { 터짐 = err.code ?? String(err); }
  check('★ .results 가 파일이어도 안 터진다', 터짐 === null, String(터짐));
  지우기(e);
}
{
  // --only 는 이름이 딱 맞는 것이 있으면 그것만 고른다. `task-1` 이 `task-10` 까지 부르면 안 된다.
  const 목록 = ['task-1', 'task-10', 'task-2', '03-이름바꾸기'].map((이름) => ({ 이름 }));
  const 이름들 = (only) => 과제고르기(목록, only).map((x) => x.이름).join(',');
  check('★ --only 는 딱 맞는 이름이 있으면 그것만', 이름들('task-1') === 'task-1', 이름들('task-1'));
  check('  딱 맞는 것이 없으면 이름 일부로 고른다 (예전처럼)', 이름들('task') === 'task-1,task-10,task-2' && 이름들('이름') === '03-이름바꾸기', 이름들('task'));
  check('  쉼표로 여럿 — 딱 맞는 것과 일부 맞는 것을 섞어도 된다', 이름들('task-1, 03') === 'task-1,03-이름바꾸기', 이름들('task-1, 03'));
}
{
  /*
   * ── 과제 하나에서 터지면 평가 전체가 죽었다 (2.1.1 검수) ─────────────
   *
   * 한번돌리기 에 finally 만 있고 catch 가 없어서, 정답 복사가 권한·자리 부족으로 터지면 그
   * 예외가 runEval 까지 올라가 남은 과제를 다 버리고 결과 파일도 안 남겼다. 그 과제만 실패로 센다.
   */
  const r = await 판돌리기({ 이름: 'x' }, { 판: 2 }, { 돌리개: async () => { throw Object.assign(new Error('EACCES 흉내'), { code: 'EACCES' }); } });
  check('★★ 과제 하나가 터지면 그 과제만 실패로 센다', r.통과 === false && r.과제 === 'x' && r.판 === 2, JSON.stringify(r));
  check('★ 무엇이 터졌는지 적는다', /EACCES 흉내/.test(r.검사?.꼬리 ?? '') && r.deel?.reason === 'error', JSON.stringify(r));
  const 멀쩡 = await 판돌리기({ 이름: 'y' }, {}, { 돌리개: async () => ({ 과제: 'y', 통과: true }) });
  check('  안 터지면 결과를 그대로 준다', 멀쩡.통과 === true && 멀쩡.과제 === 'y');
}
{
  // 2차 눈(Gemini) 판정: 파일 이름이 지역 시각이라 시차가 다른 PC 의 결과가 섞이면 순서가 뒤집혔다.
  // 러너의 시간대가 UTC 면 지역 시각과 UTC 가 같아 이 검사가 갈리지 않는다 — UTC 가 아닌 곳으로 잠깐 옮겨 잰다.
  const 원래TZ = process.env.TZ;
  process.env.TZ = 'Etc/GMT-9';
  const 이름 = 시각이름(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)));
  if (원래TZ === undefined) delete process.env.TZ; else process.env.TZ = 원래TZ;
  check('★ 결과 파일 이름은 UTC 다 (시차가 달라도 이름 순서 = 시각 순서)', 이름 === '20260102-030405Z', 이름);
}

// ── 4. deel eval 을 진짜로 돌린다 ───────────────────────────────────────
trace('4-돌리기');
let 본목록 = [];
const 서버 = createServer((q, res) => {
  let body = '';
  q.on('data', (d) => (body += d));
  q.on('end', () => {
    let json = null;
    try { json = JSON.parse(body); } catch { /* 목록 */ }
    const 보냄 = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (!json?.messages) return 보냄({ data: [{ id: 'fake', object: 'model' }] });
    const 말들 = json.messages;
    const 시킨말 = 말들.filter((m) => m.role === 'user').map((m) => String(m.content ?? '')).join('\n');
    const 도구결과 = 말들.filter((m) => m.role === 'tool').map((m) => String(m.content ?? ''));
    const 부름 = (name, args) => 보냄({
      choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: `t${도구결과.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    });
    // 첫 걸음: 폴더에 무엇이 있나 본다 — 정답 파일이 보이면 안 된다.
    if (도구결과.length === 0) return 부름('Bash', { command: 'node -e "console.log(require(\'fs\').readdirSync(\'.\').join(\',\'))"' });
    if (도구결과.length === 1) {
      본목록.push(도구결과[0]);
      return 부름('Write', { file_path: 'answer.txt', content: /일부러_맞게/.test(시킨말) ? '42' : '41' });
    }
    return 보냄({ choices: [{ message: { role: 'assistant', content: '다 했습니다.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3 } });
  });
});
await new Promise((r) => 서버.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${서버.address().port}/v1`;
const home = 임시('home');
writeFileSync(join(home, 'config.json'), JSON.stringify({
  version: 1, active: 'stub', level: '개발자',
  profiles: [{ id: 'stub', name: '스텁', kind: 'openai', baseUrl: base, auth: 'none', apiKey: '', model: 'fake', ctx: 32768, streaming: false, tools: true, json: true, think: false }],
}, null, 2));

function 띄우기(인자, 폴더) {
  return new Promise((done) => {
    const kid = spawn(process.execPath, [진입점, ...인자], {
      cwd: 폴더, env: { ...process.env, DEEL_HOME: home, NO_COLOR: '1', DEEL_LANG: 'ko' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = ''; let err = '';
    kid.stdout.on('data', (b) => { out += b; });
    kid.stderr.on('data', (b) => { err += b; });
    const 시계 = setTimeout(() => kid.kill('SIGKILL'), 120_000);
    kid.on('close', (code) => { clearTimeout(시계); done({ code, out, err }); });
  });
}

const 일터 = 임시('일터');
const 과제만들기 = (이름, 시킬말) => {
  const d = join(일터, 'golden', 이름);
  mkdirSync(join(d, 'start'), { recursive: true });
  mkdirSync(join(d, 'golden'), { recursive: true });
  writeFileSync(join(d, 'task.json'), JSON.stringify({ prompt: 시킬말, check: 'node golden-check.cjs' }));
  writeFileSync(join(d, 'start', 'readme.txt'), '42 를 answer.txt 에 적어라\n');
  writeFileSync(join(d, 'golden', 'golden-check.cjs'),
    "const s=require('fs').readFileSync('answer.txt','utf8').trim();if(s!=='42'){console.log('기대 42 · 실제 '+s);process.exit(1)}");
};
과제만들기('a-맞음', '일부러_맞게 해 줘');
과제만들기('b-틀림', '일부러_틀리게 해 줘');
mkdirSync(join(일터, 'golden', 'c-모양틀림'), { recursive: true });
writeFileSync(join(일터, 'golden', 'c-모양틀림', 'task.json'), '{ "prompt": "check 가 없다" }');
{
  const r = await 띄우기(['eval', '--json'], 일터);
  const j = (() => { try { return JSON.parse(r.out.trim().split('\n').pop()); } catch { return null; } })();
  check('★★★ 맞게 한 과제는 통과, 틀리게 한 과제는 실패로 센다', j?.과제별?.find((x) => x.과제 === 'a-맞음')?.통과 === 1
    && j?.과제별?.find((x) => x.과제 === 'b-틀림')?.통과 === 0, JSON.stringify(j?.과제별) + ' ' + r.err.slice(-300));
  check('★★ 모양이 틀린 과제는 빼지 않고 실패로 센다 — 조용히 빼면 「다 통과」 가 된다', j?.runs === 3 && j?.passed === 1, `runs=${j?.runs} passed=${j?.passed}`);
  check('★★ 하나라도 떨어지면 종료코드 1', r.code === 1, `code=${r.code}`);
  check('★★★ 일하는 동안 정답 파일은 폴더에 없다 (모델이 못 본다)', 본목록.length === 2 && 본목록.every((x) => /readme\.txt/.test(x) && !/golden-check/.test(x)), JSON.stringify(본목록));
  const 남은 = existsSync(join(일터, 'golden', '.results')) ? readdirSync(join(일터, 'golden', '.results')) : [];
  check('★ 결과를 .results 에 남긴다', 남은.length === 1 && /^\d{8}-\d{6}Z\.json$/.test(남은[0]), 남은.join());
  check('  실패한 과제에 정답 검사의 말이 붙는다', /기대 42 · 실제 41/.test(JSON.stringify(j?.결과 ?? [])));
  check('  모델 이름과 토큰이 실린다', j?.model === 'fake' && j?.tokens?.in > 0);
  check('  첫 판에는 견줄 지난번이 없다', !j?.견줌);
}
{
  // 한 초 쉬어 결과 파일 이름(초 단위)이 겹치지 않게 한다.
  await new Promise((r) => setTimeout(r, 1100));
  writeFileSync(join(일터, 'golden', 'b-틀림', 'task.json'), JSON.stringify({ prompt: '일부러_맞게 해 줘', check: 'node golden-check.cjs' }));
  const r = await 띄우기(['eval', '--only', 'a-,b-'], 일터);
  check('★★ --only 로 고른 과제만 돌고, 다 통과하면 0', r.code === 0, `code=${r.code} ${r.out.slice(-300)}`);
  check('★★ 지난번보다 나아진 과제를 짚는다', /나아짐:.*b-틀림/.test(r.out), r.out.slice(-400));
  check('  화면에 통과 수가 나온다', /통과 2\/2/.test(r.out));
}
{
  // 2차 눈(Gemini) 판정: 모양 틀린 과제가 --repeat 에서 한 판으로만 세어져 분모가 줄고 통과율이 부풀었다.
  // task.json 이 없는 과제 폴더(start/·golden/ 은 있음)도 조용히 빠지고 있었다.
  await new Promise((r) => setTimeout(r, 1100));
  mkdirSync(join(일터, 'golden', 'd-task없음', 'start'), { recursive: true });
  writeFileSync(join(일터, 'golden', 'd-task없음', 'start', 'x.txt'), 'x');
  mkdirSync(join(일터, 'golden', 'e-과제아님'), { recursive: true });
  writeFileSync(join(일터, 'golden', 'e-과제아님', 'helper.cjs'), '// 과제들이 같이 쓰는 도우미 — 과제가 아니다');
  const r = await 띄우기(['eval', '--json', '--repeat', '2', '--only', 'a-,c-,d-,e-'], 일터);
  const j = (() => { try { return JSON.parse(r.out.trim().split('\n').pop()); } catch { return null; } })();
  check('★★ 모양 틀린 과제도 되풀이 수만큼 판을 센다 — 분모가 안 줄어든다', j?.runs === 6 && j?.passed === 2 && j?.과제별?.find((x) => x.과제 === 'c-모양틀림')?.판 === 2,
    `runs=${j?.runs} passed=${j?.passed} ${JSON.stringify(j?.과제별)}`);
  check('★★ task.json 이 없는 과제 폴더(start/·golden/ 이 있음)는 빼지 않고 실패로 센다', /task\.json/.test(JSON.stringify(j?.결과?.find((x) => x.과제 === 'd-task없음')?.과제탈 ?? '')),
    JSON.stringify(j?.과제별));
  check('  start/·golden/ 도 task.json 도 없는 폴더는 과제가 아니다 (도우미 폴더)', !j?.과제별?.some((x) => x.과제 === 'e-과제아님'));
  check('★ 일부만 돈 결과에는 무엇을 골랐는지 적는다 (다음 전체 판이 이걸 지난번으로 안 치게)', j?.only === 'a-,c-,d-,e-', JSON.stringify(j?.only));
  지우기(join(일터, 'golden', 'd-task없음'));
  지우기(join(일터, 'golden', 'e-과제아님'));
}
{
  const r = await 띄우기(['eval', '--repeat', '0'], 일터);
  check('★ --repeat 0 은 사용법 틀림(64)', r.code === 64, `code=${r.code}`);
  // --timeout 0 · abc 가 그대로 넘어가 setTimeout(0) · NaN 으로 과제마다 deel 을 곧바로 죽였다 — 전부 「시간 초과」 실패 (2.1.2).
  for (const 값 of ['0', 'abc', '-5']) {
    const t = await 띄우기(['eval', '--timeout', 값], 일터);
    check(`★★ --timeout ${값} 은 사용법 틀림(64) — 과제를 곧바로 죽이지 않는다`, t.code === 64 && /--timeout/.test(t.out + t.err), `code=${t.code} ${(t.out + t.err).slice(-160)}`);
  }
  // 2차 눈이 「값 없는 --only 가 글자 'true' 로 넘어간다」 고 짚었다 — 깃발 풀이가 이미 64 로 막고 있었다. 그 막을 지킨다.
  const 빈only = await 띄우기(['eval', '--only'], 일터);
  check('  값 없는 --only 는 사용법 틀림(64)', 빈only.code === 64 && /--only/.test(빈only.err), `code=${빈only.code} ${빈only.err.slice(-160)}`);
  // 2차 눈(Gemini) 판정: --json 인데 오류는 색 입힌 글로 표준출력에 나가 받는 쪽의 JSON.parse 가 깨졌다.
  const rj = await 띄우기(['eval', '--json', '--repeat', '0'], 일터);
  const jj = (() => { try { return JSON.parse(rj.out.trim()); } catch { return null; } })();
  check('★ --json 이면 오류도 JSON 한 줄이다', rj.code === 64 && jj?.ok === false && jj?.code === 64 && /repeat/.test(jj?.error ?? ''), JSON.stringify(rj.out.slice(0, 200)));
  const 빈 = 임시('빈');
  const r2 = await 띄우기(['eval'], 빈);
  check('★ 과제 모음이 없으면 1 과 함께 --init 을 알려 준다', r2.code === 1 && /deel eval --init/.test(r2.out), r2.out.slice(-200));
  const r3 = await 띄우기(['eval', '--init'], 빈);
  check('★ deel eval --init 이 golden/ 에 예제를 만든다', r3.code === 0 && readdirSync(join(빈, 'golden')).length === 5, r3.out.slice(-200));
  지우기(빈);
}
{
  // 결과 파일을 못 남기면 말한다 — 조용히 삼키면 사람은 다음 판에 견줄 것이 있는 줄 안다 (2.1.1 검수).
  지우기(join(일터, 'golden', '.results'));
  writeFileSync(join(일터, 'golden', '.results'), '폴더가 아니라 파일');
  const r = await 띄우기(['eval', '--only', 'a-'], 일터);
  check('★ 결과 파일을 못 남기면 그렇다고 말한다', /못 남겼습니다/.test(r.out), r.out.slice(-300));
  check('  그래도 채점은 끝까지 한다 (종료코드는 통과 여부 그대로)', r.code === 0, `code=${r.code}`);
}

서버.close();
지우기(모음);
지우기(일터);
지우기(home);

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n골든셋  ${D}(정답은 모델이 끝낸 뒤에 넣는다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
