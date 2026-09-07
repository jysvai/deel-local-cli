// `deel stats` — 감사기록을 읽어서 사람 말로 돌려준다.
//
// ── 이 검사가 지키는 것 ────────────────────────────────────────────────
//
// 통계 화면의 값어치는 **숫자가 맞는가** 하나다. 틀린 숫자는 없는 것보다
// 나쁘다 — 사람은 이 화면을 보고 「아무도 안 쓰네, 내년에는 빼자」 같은 것을
// 정한다. 그래서 여기서는 줄을 하나하나 지어 넣고 셈을 정확히 맞춰 본다.
//
// 특히 못 박는 세 가지:
//   · 못 읽은 줄을 조용히 넘기지 않는다. 300줄 중 3줄만 읽고 「3회」 라고 하면
//     그 화면은 거짓말이다.
//   · 기간 밖의 줄이 있으면 있다고 말한다. 안 말하면 --days 를 늘려 볼 생각을
//     아무도 안 한다.
//   · 기록이 **없는 것**과 **0회**는 다르다.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { 기록자리, 세기, 도구차례, 막힘차례, 셈JSON } from '../src/stats.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const here = dirname(fileURLToPath(import.meta.url));
const 진입점 = join(here, '..', 'bin', 'deel.js');
const 일터 = mkdtempSync(join(tmpdir(), 'deel-stats-'));
mkdirSync(join(일터, '.deel'), { recursive: true });

const 이제 = new Date('2026-09-07T12:00:00.000Z');
const 날 = (며칠전) => new Date(이제.getTime() - 며칠전 * 86400000).toISOString();

const 줄들 = [
  { at: 날(1), session: 'A', kind: 'turn', text: '고쳐 줘' },
  { at: 날(1), session: 'A', kind: 'tool', tool: 'Read', target: 'a.js', ok: true },
  { at: 날(1), session: 'A', kind: 'tool', tool: 'Read', target: 'b.js', ok: true },
  { at: 날(1), session: 'A', kind: 'tool', tool: 'Edit', target: 'a.js', ok: false, note: '못 찾음' },
  { at: 날(1), session: 'A', kind: 'blocked', why: '규칙으로 금지됨', what: 'Bash(rm -rf*)' },
  { at: 날(2), session: 'B', kind: 'turn', text: '검사 돌려 줘' },
  { at: 날(2), session: 'B', kind: 'tool', tool: 'Bash', target: 'npm test', ok: true },
  { at: 날(2), session: 'B', kind: 'undo', turn: 3 },
  { at: 날(2), session: 'B', kind: 'secret', what: 'Bash 결과에서 가림' },
  // 기간 밖 — 기본 30일에서는 안 세고, --all 에서는 센다.
  { at: 날(90), session: 'C', kind: 'turn', text: '옛날 일' },
  { at: 날(90), session: 'C', kind: 'tool', tool: 'Read', target: 'old.js', ok: true },
];
const 본문 = 줄들.map((x) => JSON.stringify(x)).join('\n')
  + '\n{ 이건 JSON 이 아니다\n'          // 깨진 줄 하나
  + '\n';                                 // 빈 줄은 그냥 넘어가야 한다
writeFileSync(기록자리(일터), 본문, 'utf8');

// ── 1. 셈 ──────────────────────────────────────────────────────────────
trace('1-셈');
{
  const 셈 = 세기(기록자리(일터), { 날수: 30, 이제 });
  check('★ 기록이 있으면 있다고 한다', 셈.있나 === true);
  check('★★ 대화 수를 센다 (기간 밖은 빼고)', 셈.대화 === 2, String(셈.대화));
  check('★★ 도구 수를 센다', 셈.도구 === 4, String(셈.도구));
  check('★★ 실패한 것만 실패로 센다', 셈.도구실패 === 1, String(셈.도구실패));
  check('★ 세션 수를 센다', 셈.세션.size === 2, String(셈.세션.size));
  check('★ 쓴 날 수를 센다', 셈.날.size === 2, String(셈.날.size));
  check('★ 막힌 것을 센다', 셈.막힘 === 1, String(셈.막힘));
  check('★ 되돌린 것을 센다', 셈.되돌림 === 1, String(셈.되돌림));
  check('★ 비밀 가린 것을 센다', 셈.비밀 === 1, String(셈.비밀));

  /*
   * 깨진 줄을 세는 것이 이 검사에서 제일 중요하다.
   *
   * 조용히 버리면 「도구 4회」 가 사실은 400줄 중 4줄만 읽은 결과일 수 있다.
   * 그 화면을 보고 사람은 아무도 안 쓴다고 판단한다.
   */
  check('★★ 못 읽은 줄을 세어 둔다', 셈.깨진줄 === 1, String(셈.깨진줄));
  check('★★ 기간 밖의 줄도 세어 둔다 — 안 말하면 --all 을 아무도 안 쓴다',
    셈.지난줄 === 2, String(셈.지난줄));

  const 표 = 도구차례(셈);
  check('★ 많이 쓴 차례로 준다', 표[0]?.이름 === 'Read' && 표[0]?.수 === 2,
    JSON.stringify(표.map((x) => `${x.이름}:${x.수}`)));
  check('★ 도구별 실패도 따로 센다', 표.find((x) => x.이름 === 'Edit')?.실패 === 1,
    JSON.stringify(표.find((x) => x.이름 === 'Edit')));
  check('★ 막힌 까닭을 모은다', 막힘차례(셈)[0]?.왜 === '규칙으로 금지됨' && 막힘차례(셈)[0]?.수 === 1);
}

// ── 2. 기간을 안 자르면 ────────────────────────────────────────────────
trace('2-전부');
{
  const 셈 = 세기(기록자리(일터), { 날수: null, 이제 });
  check('★ --all 이면 옛날 것도 센다', 셈.도구 === 5 && 셈.대화 === 3,
    `도구 ${셈.도구} · 대화 ${셈.대화}`);
  check('★ 그때는 기간 밖이 0 이다', 셈.지난줄 === 0, String(셈.지난줄));
}

// ── 3. 기록이 없는 것과 0회는 다르다 ───────────────────────────────────
trace('3-없음');
{
  /*
   * 없는 것을 「0회」 로 찍으면 **안 쓴 것**과 **기록이 없는 것**이 같아 보인다.
   * 앞은 도구 이야기이고 뒤는 폴더를 잘못 짚었다는 이야기라, 사람이 할 일이
   * 완전히 다르다.
   */
  const 빈곳 = mkdtempSync(join(tmpdir(), 'deel-stats-none-'));
  const 셈 = 세기(기록자리(빈곳), { 이제 });
  check('★★ 기록이 없으면 0 이 아니라 「없다」 고 한다', 셈.있나 === false, JSON.stringify(셈.있나));
  check('★ 어디를 봤는지 말한다', String(셈.자리).includes('audit.jsonl'), 셈.자리);
  check('★ 기계가 읽는 모양도 실패로 준다', 셈JSON(셈).ok === false);
  rmSync(빈곳, { recursive: true, force: true });
}

// ── 4. 진짜로 띄워 본다 ────────────────────────────────────────────────
trace('4-진짜-띄우기');
{
  const 띄우기 = (인자) => spawnSync(process.execPath, [진입점, ...인자], {
    cwd: 일터, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, NO_COLOR: '1', DEEL_HOME: join(일터, 'home') },
  });

  const r = 띄우기(['stats', '--all']);
  check('★ 그냥 돈다', r.status === 0, `code=${r.status} ${String(r.stderr).slice(0, 120)}`);
  check('★ 도구 이름이 화면에 나온다', /Read/.test(r.stdout) && /Bash/.test(r.stdout),
    r.stdout.split('\n').find((l) => /Read/.test(l)) ?? '');
  /*
   * 사람이 친 말은 **안 보여 준다.**
   *
   * 감사기록에는 시킨 말이 500자까지 남아 있다. 통계를 뽑으려고 연 화면이
   * 옆 사람 어깨너머로 대화 내용을 보여 주는 화면이 되면 안 된다.
   */
  check('★★ 시킨 말은 화면에 안 나온다',
    !/고쳐 줘/.test(r.stdout) && !/검사 돌려 줘/.test(r.stdout), r.stdout.slice(0, 200));
  check('★ 못 읽은 줄이 있으면 말한다', /읽지 못한 줄/.test(r.stdout),
    r.stdout.split('\n').find((l) => /읽지 못한/.test(l)) ?? '(안 나옴)');
  // 없는 값을 지어내지 않는다. 요금표를 소스에 안 박는 것과 같은 규칙이다.
  check('★ 토큰·요금은 없다고 말한다', /토큰과 요금은 이 기록에 없습니다/.test(r.stdout), '');

  const j = 띄우기(['stats', '--all', '--json']);
  let 값 = null;
  try { 값 = JSON.parse(j.stdout.trim()); } catch { /* 아래에서 잡힌다 */ }
  check('★★ --json 은 표준출력에 JSON 하나만 낸다',
    j.status === 0 && 값?.ok === true && j.stdout.trim().split('\n').length === 1,
    j.stdout.trim().slice(0, 100));
  check('★ 숫자가 화면과 같다', 값?.tools === 5 && 값?.turns === 3 && 값?.toolFailures === 1,
    JSON.stringify({ tools: 값?.tools, turns: 값?.turns, fail: 값?.toolFailures }));
  check('★ 도구별도 실린다', 값?.byTool?.[0]?.name === 'Read', JSON.stringify(값?.byTool?.[0]));

  // 기록이 없는 폴더에서는 0 으로 끝내면 안 된다 — 스크립트가 「썼는데 0회」 로 읽는다.
  const 빈곳 = mkdtempSync(join(tmpdir(), 'deel-stats-none2-'));
  const n = spawnSync(process.execPath, [진입점, 'stats'], {
    cwd: 빈곳, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, NO_COLOR: '1', DEEL_HOME: join(빈곳, 'home') },
  });
  check('★★ 기록이 없으면 0 이 아닌 값으로 끝낸다', n.status !== 0, `code=${n.status}`);
  rmSync(빈곳, { recursive: true, force: true });
}

rmSync(일터, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n한 일 요약  ${D}(감사기록을 읽어 주는 자리)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
