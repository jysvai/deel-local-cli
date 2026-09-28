/**
 * Outline 이 **많이 불려 쓰이는 파일부터** 보여 준다 (2.1.3 · tools/importgraph.js · tools/outline.js).
 *
 * ── 왜 이 파일이 있나 ──────────────────────────────────────────────────
 *
 * Outline 은 폴더의 뼈대를 **최근에 손댄 순서로** 싣고, 창에 맞춰 뒤를 자른다. 그래서 오래 안 건드린 핵심
 * 모듈 — 파일 수십 개가 불러 쓰는 것 — 이 큰 저장소에서 제일 먼저 잘렸다. 모델은 이 프로젝트에 그 모듈이
 * 있는 줄 모르고, 이미 있는 것을 새로 만든다. Outline 머리말이 막겠다고 적어 둔 바로 그 결말이다.
 *
 * 그래서 파일끼리 누가 누구를 불러 쓰는지(import · require · from)를 세어, 많이 불리는 것을 앞에 둔다.
 * 지금 손대고 있는 파일(가장 최근 것들)은 그대로 맨 앞 몇 자리를 지킨다.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from './trace.mjs';

const 집 = mkdtempSync(join(tmpdir(), 'deel-repomap-home-'));
process.env.DEEL_HOME = 집;
const { runTool } = await import('../src/tools/index.js');
const { 들여옴세기 } = await import('../src/tools/importgraph.js');
const { makeScope } = await import('../src/safety/guard.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-repomap-'));
const 쓰기 = (rel, 글, 몇초전 = 0) => {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, 글, 'utf8');
  const t = new Date(Date.now() - 몇초전 * 1000);
  utimesSync(abs, t, t);
  return abs;
};

// 핵심 모듈 — 제일 오래됐다. 잎 파일 70개가 불러 쓴다.
쓰기('src/core/store.js', 'export function 저장(x) {\n  return x;\n}\nexport class 창고 {}\n', 86400 * 30);
쓰기('src/core/index.js', "export { 저장 } from './store.js';\n", 86400 * 29);
for (let i = 0; i < 70; i++) {
  const 누구 = i % 3 === 0 ? "import { 저장 } from '../core/store.js';" : i % 3 === 1 ? "const { 저장 } = require('../core/store');" : "import { 저장 } from '../core';";
  쓰기(`src/leaf/잎${String(i).padStart(2, '0')}.js`, `${누구}\nexport function 일${i}() {\n  return 저장(${i});\n}\n`, 3600 + i * 60);
}
// 파이썬 — 절대 · 상대 가져오기
쓰기('pkg/__init__.py', '', 86400 * 20);
쓰기('pkg/util.py', 'def 도움():\n    return 1\n', 86400 * 20);
쓰기('pkg/a.py', 'from pkg.util import 도움\n\ndef 가():\n    return 도움()\n', 7200);
쓰기('pkg/b.py', 'from .util import 도움\n\ndef 나():\n    return 도움()\n', 7200);
쓰기('pkg/c.py', 'import pkg.util\n\ndef 다():\n    return pkg.util.도움()\n', 7200);
// 지금 손대는 중인 파일 — 아무도 안 부르지만 가장 최근이다.
쓰기('src/지금고치는중.js', 'export function 새기능() {\n  return 1;\n}\n', 0);

const ctx = { scope: makeScope(root), history: { snapshot() {} }, audit: { tool() {} }, seen: new Set(), 모델컨텍스트: 8192 };

trace('1-세기');
{
  const 셈 = 들여옴세기(root, [
    join(root, 'src/core/store.js'), join(root, 'src/core/index.js'),
    ...Array.from({ length: 70 }, (_, i) => join(root, `src/leaf/잎${String(i).padStart(2, '0')}.js`)),
    join(root, 'pkg/util.py'), join(root, 'pkg/a.py'), join(root, 'pkg/b.py'), join(root, 'pkg/c.py'),
  ]);
  const 몇 = (rel) => 셈.get(join(root, rel)) ?? 0;
  check('★★★ import · require · 폴더(index) 가져오기를 다 센다', 몇('src/core/store.js') >= 47 && 몇('src/core/index.js') >= 23,
    `store=${몇('src/core/store.js')} index=${몇('src/core/index.js')}`);
  check('★★ 파이썬의 절대 · 상대 · import 꼴도 센다', 몇('pkg/util.py') === 3, `util=${몇('pkg/util.py')}`);
  check('  아무도 안 부르면 0', 몇('src/leaf/잎00.js') === 0);
}

trace('2-outline');
{
  const r = await runTool('Outline', {}, ctx);
  const 글 = String(r.content ?? '');
  const 첫줄들 = 글.split('\n').filter((l) => /^\S/.test(l) && /\(\d/.test(l));
  const 자리 = (이름) => 첫줄들.findIndex((l) => l.includes(이름));
  check('★★★ 잘리는 창에서도 가장 많이 불리는 핵심 모듈이 실린다 — 오래됐어도', 자리('core/store.js') >= 0,
    첫줄들.slice(0, 8).join(' | '));
  check('★★ 핵심 모듈이 잎 파일들보다 앞에 선다', 자리('core/store.js') >= 0 && 자리('core/store.js') < 자리('leaf/잎'),
    `store=${자리('core/store.js')} 첫 잎=${자리('leaf/잎')}`);
  check('★★ 지금 손대는 파일은 맨 앞을 지킨다', 자리('지금고치는중.js') === 0, 첫줄들.slice(0, 3).join(' | '));
  check('★ 몇 곳에서 불러 쓰는지 머리줄에 적는다', /core\/store\.js .*\d+곳에서 불러 씀/.test(글), 첫줄들.find((l) => l.includes('core/store.js')));
}

trace('3-한파일');
{
  const r = await runTool('Outline', { path: 'src/core/store.js' }, ctx);
  check('  파일 하나를 볼 때는 전과 같다', /저장/.test(r.content ?? '') && !r.error, String(r.content).slice(0, 120));
}

rmSync(root, { recursive: true, force: true, maxRetries: 3 });
rmSync(집, { recursive: true, force: true, maxRetries: 3 });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n많이 불리는 파일부터  ${D}(Outline · import 셈)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
