// deel 자기 방법론이 남의 플러그인에 밀려 사라지지 않는가.
//
// ── 왜 이 검사가 생겼나 ─────────────────────────────────────────────────
//
// 빈 폴더에서 1.18.0 을 그대로 띄워 재 봤다. 시스템 프롬프트 9,399자 중
// 6,700자가 스킬 목록이었는데, 그 40개 안에 **deel 내장 스킬이 한 개도
// 없었다.** 전부 사용자 것 11개와 남의 플러그인 29개였다 —
// `~/.claude/plugins` 는 deel 것도 아니고 Claude Code 의 캐시다.
//
// 까닭은 한 줄이었다. session.js 의 listedSkills 가 이렇게 줄을 세운다.
//
//     const rank = { project: 0, user: 1, plugin: 2 };
//     ... (rank[a.source] ?? 3) ...
//
// 여기에 `builtin` 이 **아예 없다.** 그래서 `?? 3` 으로 떨어져 맨 뒤로
// 밀리고, 앞이 40칸을 채우면 통째로 잘린다. 규칙이 틀린 게 아니라
// 한 갈래를 적는 것을 잊은 것이다 — 그리고 잊은 것은 아무 데서도 안 터진다.
//
// 잘린 일곱은 하필 deel 이 무엇인지를 적어 둔 것들이다 —
// 검사-먼저 · 끝까지-하기 · 스스로-검토 · 차근차근-디버깅 · 찔러보기 ·
// 깊이있게-만들기 · 코드-줄이기. 플러그인을 많이 깐 PC 일수록 deel 은
// 조용히 제 방법을 잃는다.
//
// 그래서 두 가지를 잰다.
//   1. 갈래마다 자리값이 있다 — `?? 3` 으로 떨어지는 갈래가 없다
//   2. 남의 것이 아무리 많아도 내장은 목록에 남는다
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from '../src/agent/session.js';
import { discover, 내장자리 } from '../src/skills/discover.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), '..');
const 세션만들기 = () => new Session(
  { base: 'http://127.0.0.1:1/v1', model: 'x', ctx: 128000 },
  { root: 뿌리 },
);

// ── 1. 내장 스킬이 실제로 있다 ──────────────────────────────────────────
trace('1-내장있음');
const 내장이름들 = readdirSync(내장자리, { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name).sort();
check('★★ 내장 스킬이 하나 이상 있다', 내장이름들.length > 0, 내장이름들.join(' · '));

// ── 2. discover 가 다는 갈래가 순위표에 전부 있다 ─────────────────
//
// 순위표에 없는 갈래는 `?? 맨뒤` 로 떨어져 **모르는 갈래**와 한 덩어리가 된다.
// 그래서 갈래 이름을 손으로 적어 맞추지 않고, 없는 갈래 하나를 지어내
// 그것과 **똑같이 취급되는지**로 잰다. 똑같이 밀리면 순위표에 빠진 것이다.
trace('2-갈래빠짐');
{
  const found = discover(뿌리);
  const 있는갈래 = [...new Set(found.skills.map((s) => s.source))].sort();
  const 지어낸갈래 = '없는갈래';
  const 빠진갈래 = [];
  for (const g of 있는갈래) {
    const s = 세션만들기();
    // 같은 개수로 나란히 세우고 상한을 반으로 준다. 자리값이 있으면 이기고,
    // 없으면 지어낸 갈래와 같은 값이라 순서가 안 갈린다.
    const 만들기 = (n, source) => Array.from({ length: n }, (_, i) => ({
      name: `${source}-${i}`, description: '', source, enabled: true,
    }));
    s.skills = [...만들기(5, 지어낸갈래), ...만들기(5, g)];
    s.maxSkillsListed = 5;
    const listed = s.listedSkills();
    if (!listed.every((x) => x.source === g)) 빠진갈래.push(g);
  }
  check('★★★ discover 가 다는 갈래가 순위표에 전부 있다',
    빠진갈래.length === 0,
    `빠진 것: ${빠진갈래.join(' · ')} / 있는 것: ${있는갈래.join(' · ')}`);
}

// ── 3. 남의 것이 아무리 많아도 내장은 목록에 남는다 ─────────────────────
trace('3-내장남음');
{
  const s = 세션만들기();
  const 가짜 = (n, source, 앞글자) => Array.from({ length: n }, (_, i) => ({
    name: `${앞글자}${String(i).padStart(3, '0')}`,
    description: '남의 것',
    source,
    enabled: true,
  }));
  const 내장 = 내장이름들.map((n) => ({
    name: n, description: 'deel 방법', source: 'builtin', enabled: true,
  }));
  // 실제로 겪은 모양 그대로 — 사용자 11개 + 플러그인 300개.
  s.skills = [...가짜(11, 'user', 'u'), ...가짜(300, 'plugin', 'p'), ...내장];

  const listed = s.listedSkills();
  const 실린내장 = listed.filter((x) => x.source === 'builtin').map((x) => x.name).sort();
  check('★★★ 플러그인이 300개여도 내장이 전부 실린다',
    실린내장.join(',') === 내장이름들.join(','),
    `실린 내장 ${실린내장.length}/${내장이름들.length} · 목록 ${listed.length}개 중 `
    + JSON.stringify(listed.reduce((a, x) => ({ ...a, [x.source]: (a[x.source] ?? 0) + 1 }), {})));

  check('★★ 상한을 안 넘는다', listed.length <= s.maxSkillsListed, String(listed.length));

  // 내장이 사용자·프로젝트 것을 밀어내지는 않는다 — 가까운 것이 먼저다.
  const 사용자수 = listed.filter((x) => x.source === 'user').length;
  check('★★★ 사용자 스킬 11개는 그대로 다 실린다', 사용자수 === 11, String(사용자수));

  // 프로젝트 것이 있으면 그것이 맨 앞이다.
  const s2 = 세션만들기();
  s2.skills = [...가짜(5, 'project', 'j'), ...내장, ...가짜(300, 'plugin', 'p')];
  const l2 = s2.listedSkills();
  check('★★ 프로젝트 스킬 5개가 다 실린다',
    l2.filter((x) => x.source === 'project').length === 5, '');
  check('★★★ 그래도 내장은 다 실린다',
    l2.filter((x) => x.source === 'builtin').length === 내장이름들.length, '');
}

// ── 3-나. 내장이 가까운 것을 굶기지 않는다 ───────────────────
//
// 2차 리뷰가 짚었고, 돌려 보니 맞았다.
//
//     상한 10 · project 10개 + builtin 7개  →  project 3개 · builtin 7개
//
// 내장을 상한까지 **무조건 먼저** 떼어 둔 탓이다. 그러면 내장을
// 살리려다 가까운 것을 굶기는 꼴이 된다 — 자리표가 말하는 순서
// (프로젝트 > 사용자 > 내장 > 플러그인)와 정반대로 뒤집힌다.
//
// 그리고 그 때문에 위의 2번 검사가 **죽은 검사**였다 — 내장은 자리표를
// 거치지 않고 뿑혀 올라오므로, `rank` 에서 `builtin` 을 지워도 빨개지지
// 않았다. 구멍을 막으려고 넣은 것이 또 다른 구멍을 만들고 있었다.
//
// 몴을 상한의 1/4 로 둔다. 기본 상한 40 에서는 10칸이라 일곱이 다
// 들어가고(지금과 같다), 상한이 좁을 때만 가까운 것에게 자리를 돌려준다.
trace('3나-굶지않기');
{
  const 만들기 = (n, source) => Array.from({ length: n }, (_, i) => ({
    name: `${source}-${i}`, description: '', source, enabled: true,
  }));
  const 내장 = 내장이름들.map((n) => ({ name: n, description: '', source: 'builtin', enabled: true }));

  const s = 세션만들기();
  s.skills = [...만들기(10, 'project'), ...내장];
  s.maxSkillsListed = 10;
  const l = s.listedSkills();
  const 셈 = l.reduce((a, x) => ({ ...a, [x.source]: (a[x.source] ?? 0) + 1 }), {});
  check('★★★ 상한이 좁으면 내장이 프로젝트를 굶기지 않는다',
    (셈.project ?? 0) >= 7, JSON.stringify(셈));
  check('★★★ 그래도 내장이 통째로 사라지지는 않는다',
    (셈.builtin ?? 0) >= 1, JSON.stringify(셈));
  check('★★ 상한은 그대로 지킨다', l.length === 10, String(l.length));

  // 기본 상한(40)에서는 일곱이 전부 들어간다 — 몴이 10칸이다.
  const s2 = 세션만들기();
  s2.skills = [...만들기(11, 'user'), ...만들기(300, 'plugin'), ...내장];
  check('★★★ 기본 상한에서는 내장 일곱이 전부 실린다',
    s2.listedSkills().filter((x) => x.source === 'builtin').length === 내장이름들.length, '');
}

// ── 4. 빈 일터에서도 내장이 프롬프트에 보인다 ───────────────────────────
//
// 위 셋이 다 초록이어도 이어 붙이는 자리에서 어긋날 수 있다.
// 그래서 실제 시스템 프롬프트 글에서 이름을 찾는다.
trace('4-프롬프트');
{
  const found = discover(뿌리);
  const s = 세션만들기();
  s.skills = found.skills;
  s.commands = found.commands;
  s.plugins = found.plugins;
  const 프롬 = s.systemPrompt();
  const 안보이는것 = 내장이름들.filter((n) => !프롬.includes(n));
  check('★★★ 시스템 프롬프트에 내장 스킬 이름이 다 있다',
    안보이는것.length === 0,
    `안 보임: ${안보이는것.join(' · ')} (스킬 ${found.skills.length}개 중 ${s.listedSkills().length}개 실림)`);
}

// ── 5. 몫이 상한을 잡아먹지 않는다 · 차례가 안 뒤집힌다 ─────────────────
//
// 3차 리뷰가 셋을 짚었고 돌려 보니 다 맞았다.
//
//   ① 상한 1 · project 1 + builtin 1  →  ["builtin"]   ← 최우선이 밀렸다
//   ② 상한 0                            →  ["builtin"]   ← 0인데 하나 나왔다
//   ③ 상한 10 · builtin 7               →  b2 b3 b4 b5 b6 **b0 b1**
//
// ①②는 `Math.max(1, …)` 탓이다. 「몫은 상한의 1/4」 이라고 적어 놓고 하한
// 1을 두었으니, 상한이 4보다 작으면 1/4을 넘고 1이면 통째로 차지한다.
// 적은 말과 하는 일이 어긋난 것이고, 어긋난 쪽은 코드였다.
//
// ③은 목록을 둘로 쪼갠 탓이다. 앞 번호 내장을 떼어 뒤에 붙였으니 같은
// 갈래 안에서 차례가 뒤집힌다 — 「안정 정렬이라 원래 차례 그대로」 라고
// 적어 둔 주석이 거짓이 된다.
trace('5-몫과차례');
{
  const 짓기 = (n, source) => Array.from({ length: n }, (_, i) => ({
    name: `${source}${i}`, description: '', source, enabled: true,
  }));
  const 이름들 = (s) => s.listedSkills().map((x) => x.name);

  const s1 = 세션만들기();
  s1.maxSkillsListed = 1;
  s1.skills = [...짓기(1, 'project'), ...짓기(1, 'builtin')];
  check('★★★ 상한이 1이면 최우선(프로젝트)이 그 자리를 갖는다',
    이름들(s1).join(',') === 'project0', JSON.stringify(이름들(s1)));

  const s2 = 세션만들기();
  s2.maxSkillsListed = 0;
  // 갈래를 섞어 둔다. 한 갈래만 넣으면 몫 계산이 죽어도 다른 이유로 0이 된다.
  s2.skills = [...짓기(1, 'project'), ...짓기(1, 'builtin'), ...짓기(1, 'plugin')];
  check('★★★ 상한이 0이면 하나도 안 싣는다', 이름들(s2).length === 0, JSON.stringify(이름들(s2)));

  /*
   * 8차 리뷰. 상한이 **음수**면 `Math.floor(-1/4)` 가 -1 이 되고
   * `slice(0, -1)` 은 「끝 하나만 뺀 전부」 다. 0 개를 실어야 할 자리에서
   * 넷이 실렸다 — 「상한을 지킨다」 는 말이 거짓이 되는 자리다.
   *
   * 숫자가 아닌 값은 원래도 빈 목록이었고, 그게 맞는 답이다. 고장이 아니라
   * **정해 둔 것**이라 여기 못박아 둔다 — 아래 무한대 갈래와 갈리는 자리다.
   */
  for (const 상한 of [-1, -10, NaN, undefined, null, '열개']) {
    const s = 세션만들기();
    s.maxSkillsListed = 상한;
    s.skills = [...짓기(5, 'builtin'), ...짓기(5, 'project')];
    check(`★★★ 상한이 숫자가 아니거나 음수면 하나도 안 싣는다 — ${String(상한)}`,
      이름들(s).length === 0, JSON.stringify(이름들(s)));
  }
  /*
   * 9차 리뷰. 위 울타리를 `Number.isFinite` 로 세웠더니 옮긴 자리에 틈이
   * 났다 — 그 함수는 **숫자꼴 글자열과 무한대를 함께 내친다.**
   *
   *     '10'        → 0개  (앞 판은 10개)
   *     Infinity    → 0개  (앞 판은 전부)
   *
   * 설정에서 온 값은 글자열이기 쉽고, 무한대는 「상한을 두지 마라」 는
   * 뜻이다. 둘 다 스킬을 통째로 지웠다 — 막으려던 것보다 나쁘다.
   */
  for (const [상한, 몇개] of [['10', 10], [10, 10], ['3', 3], [Infinity, 16], ['1e2', 16]]) {
    const s = 세션만들기();
    s.maxSkillsListed = 상한;
    s.skills = [...짓기(8, 'user'), ...짓기(8, 'builtin')];
    check(`★★★ 숫자꼴 글자열과 무한대는 상한으로 받는다 — ${String(상한)}`,
      이름들(s).length === 몇개, `${이름들(s).length}개 · 바람 ${몇개}개`);
  }

  const s3 = 세션만들기();
  s3.maxSkillsListed = 10;
  // 갈래를 섞는다. 한 갈래만 넣으면 정렬이 갈래를 넘나들며 뒤집는 것을 못 잡는다.
  s3.skills = [...짓기(3, 'user'), ...짓기(7, 'builtin')];
  check('★★★ 같은 갈래 안에서 차례가 안 뒤집힌다',
    이름들(s3).join(',') === 'user0,user1,user2,builtin0,builtin1,builtin2,builtin3,builtin4,builtin5,builtin6',
    JSON.stringify(이름들(s3)));

  /*
   * 몫이 실제로 지켜 주는지 — 사용자 것이 상한을 넘길 만큼 많을 때만
   * 알 수 있다. 열한 개로는 40칸에 다 들어가서 몫이 있으나 없으나 같다
   * (3차 리뷰가 「죽은 검사」 라고 짚은 자리).
   */
  const s4 = 세션만들기();
  /*
   * 내장을 **몫보다 많이** 넣는다. 상한 40 의 몫은 10칸인데 앞 판은 내장을
   * 일곱만 넣어서, 몫을 `7` 이나 `상한` 으로 바꿔 놔도 초록이었다(8차 리뷰).
   * 열둘을 넣으면 열만 남는 것이 몫이 하는 유일한 일이다.
   */
  s4.skills = [...짓기(60, 'user'), ...짓기(12, 'builtin')];
  const l4 = s4.listedSkills();
  const 내장것 = l4.filter((x) => x.source === 'builtin');
  check('★★★ 내장 몫은 상한의 1/4 까지다',
    내장것.length === Math.floor(s4.maxSkillsListed / 4),
    `내장 ${내장것.length}개 · 상한 ${s4.maxSkillsListed}`);
  check('★★ 그래도 상한은 지킨다', l4.length === s4.maxSkillsListed, String(l4.length));
  check('★★★ 목록에서 사용자 것이 내장보다 앞선다',
    l4.findIndex((x) => x.source === 'builtin') > l4.findLastIndex((x) => x.source === 'user'),
    `user 끝 ${l4.findLastIndex((x) => x.source === 'user')} · builtin 처음 ${l4.findIndex((x) => x.source === 'builtin')}`);
  check('★★★ 몫으로 뽑힌 내장도 앞 번호부터다',
    내장것.map((x) => x.name).join(',')
      === Array.from({ length: 내장것.length }, (_, i) => `builtin${i}`).join(','),
    JSON.stringify(내장것.map((x) => x.name)));

  /*
   * 자리표가 실제로 차례를 정하는지. 앞 판은 여섯 개를 40칸에 넣고 `new Set`
   * 으로 갈래만 봤다 — 상한에 한참 못 미쳐 몫이 하나도 안 돌고, 갈래가
   * 중간에 뒤섞여도 맨 앞만 내장이면 초록이었다(8차 리뷰).
   * 상한을 넘기고, 늘어선 그대로를 본다.
   */
  const s5 = 세션만들기();
  s5.maxSkillsListed = 8;
  s5.skills = [...짓기(6, 'plugin'), ...짓기(6, 'builtin')];
  const 갈래줄 = s5.listedSkills().map((x) => x.source);
  check('★★★ 자리표대로 내장이 플러그인보다 앞선다 — 중간에 안 섞인다',
    갈래줄.join(',') === [...Array(6).fill('builtin'), ...Array(2).fill('plugin')].join(','),
    갈래줄.join(','));
}

const G = '[32m'; const R = '[31m'; const D = '[90m'; const X = '[0m';
console.log(`${String.fromCharCode(10)}스킬 자리 검사  ${D}(남의 플러그인이 deel 의 방법을 밀어내지 않는다)${X}${String.fromCharCode(10)}`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`${String.fromCharCode(10)}  ${pass.length}개 통과 · ${fail.length}개 실패${String.fromCharCode(10)}`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
