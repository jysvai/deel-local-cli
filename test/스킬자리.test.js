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

const G = '[32m'; const R = '[31m'; const D = '[90m'; const X = '[0m';
console.log(`${String.fromCharCode(10)}스킬 자리 검사  ${D}(남의 플러그인이 deel 의 방법을 밀어내지 않는다)${X}${String.fromCharCode(10)}`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`${String.fromCharCode(10)}  ${pass.length}개 통과 · ${fail.length}개 실패${String.fromCharCode(10)}`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
