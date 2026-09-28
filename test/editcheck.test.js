/**
 * 고친 직후 문법 검사 — 언어 서버가 없을 때 (2.1.3 · tools/verify.js 의 한파일문법 · tools/index.js 의 고친뒤진단).
 *
 * ── 왜 이 파일이 있나 ──────────────────────────────────────────────────
 *
 * 고친 뒤 진단(lsp/diag.js)은 **이미 떠 있는 언어 서버**가 있을 때만 말한다. 로컬 모델을 쓰는 PC 대부분은
 * 언어 서버가 없고, 있어도 첫 파일은 못 받는다. 그 자리에서 모델이 괄호 하나를 빠뜨리면 아무 말이 없다 —
 * 모델은 고친 것으로 치고 다음 파일로 가고, 탈은 몇 걸음 뒤 돌려 볼 때에야 나온다. 되짚는 값이 고치는 값보다 크다.
 *
 * 그래서 언어 서버가 말을 못 줬을 때 **싸게 볼 수 있는 것만** 본다 — JSON 은 읽어 보고, JS 는 `node --check`,
 * 파이썬은 있으면 `py_compile`, CSS 는 중괄호 짝. 성하면 아무 말도 안 한다(창을 안 먹는다). 모르는 것은 안 본다.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from './trace.mjs';

const 집 = mkdtempSync(join(tmpdir(), 'deel-editcheck-home-'));
process.env.DEEL_HOME = 집;
const { runTool } = await import('../src/tools/index.js');
const { 한파일문법 } = await import('../src/tools/verify.js');
const { makeScope } = await import('../src/safety/guard.js');

const pass = [];
const fail = [];
const 건너뜀 = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-editcheck-'));
const 만든ctx = (더 = {}) => ({
  scope: makeScope(root),
  history: { snapshot() {} },
  audit: { tool() {} },
  seen: new Set(),
  모델컨텍스트: 32768,
  lsp: { 켬: true },
  ...더,
});
const ctx = 만든ctx();

trace('1-js');
{
  const 시작 = Date.now();
  const r = await runTool('Write', { file_path: 'src/깨짐.js', content: 'export function 셈(a, b) {\n  return a + b;\n\n' }, ctx);
  const 걸림 = Date.now() - 시작;
  check('★★★ 괄호를 안 닫은 JS 를 쓰면 곧바로 문법 오류를 붙인다', r.diagnostics?.errors === 1 && /node --check/.test(r.summary ?? ''),
    String(r.summary).slice(0, 200));
  check('★ 몇째 줄인지 · 무슨 탈인지가 같이 실린다', /SyntaxError|Unexpected end|missing/i.test(r.summary ?? ''), String(r.summary).slice(0, 300));
  check('  빠르다 — 고칠 때마다 사람이 기다리는 자리다', 걸림 < 5000, `${걸림}ms`);
  check('★★ 파일은 그대로 쓰였다 — 검사는 덤이지 편집의 성패가 아니다', !r.error && r.changed, JSON.stringify(r).slice(0, 120));

  const 성함 = await runTool('Write', { file_path: 'src/성함.mjs', content: 'export const 값 = 1;\n' }, ctx);
  check('★★ 성한 JS 에는 아무것도 안 붙는다 — 조용한 것이 성한 것이다', !성함.diagnostics && !/node --check/.test(성함.summary ?? ''), 성함.summary);

  // 고치기(Edit)로 깨뜨려도 같다.
  const e = await runTool('Edit', { file_path: 'src/성함.mjs', old_string: 'export const 값 = 1;', new_string: 'export const 값 = (1;' }, ctx);
  // 앞 파일이 언어 서버를 데웠으면 그쪽이 답할 수도 있다 — 어느 쪽이든 탈은 붙어야 한다.
  check('★★ Edit 으로 깨뜨려도 붙는다', e.diagnostics?.errors >= 1, String(e.summary).slice(0, 160));
}

trace('1b-esm');
{
  /*
   * package.json 에 "type" 이 없는 자리의 `.js` 에 export 가 있고 괄호가 안 닫혔다. node 24 의 `--check` 는
   * 이것을 0 으로 통과시킨다(모듈 꼴 알아보기로 넘기는 자리) — Verify 가 깨진 파일에 ✓ 를 적어 왔다.
   */
  const esm = await runTool('Write', { file_path: 'lib/모듈.js', content: 'export const a = 1;\nfunction f(x) {\n  return x;\n' }, ctx);
  check('★★★ export 가 있는 깨진 .js 도 잡는다 (node --check 가 놓치는 자리)', esm.diagnostics?.errors >= 1, String(esm.summary).slice(0, 200));
  const 성한esm = await runTool('Write', { file_path: 'lib/성한모듈.js', content: "import { x } from './x.js';\nexport const b = x;\nconst c = import('./y.js');\n" }, ctx);
  check('★★ 성한 ESM .js 에는 아무것도 안 붙는다', !성한esm.diagnostics, String(성한esm.summary).slice(0, 160));
  const 성한cjs = await runTool('Write', { file_path: 'lib/옛것.js', content: "const m = import('./z.js');\nmodule.exports = { m };\n" }, ctx);
  check('★ 동적 import( 만 있는 CommonJS 는 모듈로 다시 안 본다', !성한cjs.diagnostics, String(성한cjs.summary).slice(0, 160));
  const v = await runTool('Verify', { paths: ['lib/모듈.js'] }, ctx);
  check('★★★ Verify 도 그 파일을 탈로 적는다 — 여태 ✓ 였다', v.failed === true && /모듈\.js/.test(v.content ?? ''), String(v.content ?? v.summary).slice(0, 200));

  // 2차 눈이 짚어 재 보니 참이던 것.
  const 틀 = await runTool('Write', { file_path: 'lib/틀.js', content: "const package = require('./p.json');\nconst 틀 = `\nimport React from 'react';\nexport default function App() {}\n`;\nmodule.exports = { 틀, package };\n" }, ctx);
  check('★★ 틀 문자열에 import 줄이 든 CommonJS 는 멀쩡하다 — 모듈로만 보고 탈을 붙이지 않는다', !틀.diagnostics, String(틀.summary).slice(0, 200));
  const 줄가운데 = await runTool('Write', { file_path: 'lib/가운데.js', content: 'const a = 1; export { a };\nfunction f() {\n' }, ctx);
  check('★★ 줄 가운데의 export 도 모듈로 다시 본다 — 깨진 파일을 놓치지 않는다', 줄가운데.diagnostics?.errors >= 1, String(줄가운데.summary).slice(0, 200));
  const 주석뒤 = await runTool('Write', { file_path: 'lib/주석뒤.js', content: 'export /* 값 */ const a = 1;\nfunction f() {\n' }, ctx);
  check('★ export 바로 뒤에 주석이 와도 모듈로 다시 본다', 주석뒤.diagnostics?.errors >= 1, String(주석뒤.summary).slice(0, 200));
  const 달러 = await runTool('Write', { file_path: 'lib/x$&.js', content: 'export const a = 1;\nfunction f() {\n' }, ctx);
  check('★ 파일 이름에 $& 가 있어도 탈 글의 경로가 안 깨진다 (그래서 탈을 놓치지 않는다)', 달러.diagnostics?.errors >= 1 && /x\$&\.js/.test(달러.summary ?? ''), String(달러.summary).slice(0, 200));
}

trace('2-json-css');
{
  const j = await runTool('Write', { file_path: 'package.json', content: '{ "name": "x", }\n' }, ctx);
  check('★★ 깨진 JSON 은 읽어 보고 말한다', j.diagnostics?.errors === 1 && /JSON/.test(j.summary ?? ''), String(j.summary).slice(0, 160));
  const c = await runTool('Write', { file_path: 'a.css', content: 'a { color: red;\n' }, ctx);
  check('★ CSS 중괄호 짝이 안 맞으면 말한다', c.diagnostics?.errors === 1, String(c.summary).slice(0, 160));
  const 성한json = await runTool('Write', { file_path: 'b.json', content: '{"a":1}\n' }, ctx);
  check('  성한 JSON 은 조용하다', !성한json.diagnostics, 성한json.summary);
}

trace('3-모르는것');
{
  const t = await runTool('Write', { file_path: '설정.yaml', content: 'a: [1, 2\n' }, ctx);
  check('★ 볼 줄 모르는 것(yaml)은 안 본다 — 모르는 것을 성하다고도 틀렸다고도 안 한다', !t.diagnostics, t.summary);
  const m = await runTool('Write', { file_path: '메모.md', content: '# (\n' }, ctx);
  check('  글 파일은 안 본다', !m.diagnostics, m.summary);
}

trace('4-꺼짐');
{
  const r = await runTool('Write', { file_path: 'src/꺼짐.js', content: 'function (\n' }, 만든ctx({ lsp: { 켬: false } }));
  check('★★ /lsp off 면 이것도 안 한다 — 고친 뒤 진단을 끈 것이다', !r.diagnostics && !/node --check/.test(r.summary ?? ''), r.summary);
}

trace('5-한파일문법');
{
  // 뿌리의 package.json 은 2절에서 일부러 깨 두었다. node 22 · 24 는 **멀쩡한** 파일도 그것을 읽다 넘어진다 —
  // 그 글을 이 파일에 붙이면 멀쩡한 파일을 고치러 간다. 못 본 것(null)이어야 한다. node 20 은 --check 에서
  // package.json 을 안 읽어 그냥 성하다고 본다(오류 0). 둘 다 맞다 — 틀린 것은 남의 탈을 붙이는 것 하나다.
  writeFileSync(join(root, '곁이깨짐.js'), 'let a = 1;\n', 'utf8');
  const 곁 = await 한파일문법(join(root, '곁이깨짐.js'), { 뿌리: root });
  check('★★ 곁의 package.json 이 깨졌으면 그 탈을 이 파일에 안 붙인다', 곁 === null || 곁.오류 === 0, JSON.stringify(곁)?.slice(0, 200));
  mkdirSync(join(root, '깨끗'), { recursive: true });
  writeFileSync(join(root, '깨끗', 'package.json'), '{}\n', 'utf8');
  writeFileSync(join(root, '깨끗', '직접.js'), 'let a = ;\n', 'utf8');
  const d = await 한파일문법(join(root, '깨끗', '직접.js'), { 뿌리: root });
  check('★ 한파일문법 은 {오류, 경고, 글, 출처} 를 준다', d?.오류 === 1 && d.경고 === 0 && /직접\.js|SyntaxError/.test(d.글) && d.출처 === 'node --check',
    JSON.stringify(d).slice(0, 200));
  writeFileSync(join(root, '모름.rb'), 'def (\n', 'utf8');
  check('  볼 줄 모르면 null', (await 한파일문법(join(root, '모름.rb'), { 뿌리: root })) === null);
  check('  없는 파일도 null — 못 본 것은 못 본 것이다', (await 한파일문법(join(root, '없다.js'), { 뿌리: root })) === null);

  // 파이썬은 있는 PC 에서만 잰다. 없으면 null 이어야 한다(「틀렸다」 가 아니라 「못 봤다」).
  writeFileSync(join(root, '깨짐.py'), 'def f(:\n  pass\n', 'utf8');
  const p = await 한파일문법(join(root, '깨짐.py'), { 뿌리: root });
  if (p === null) 건너뜀.push('파이썬이 없어 py_compile 을 못 잼');
  else check('★ 파이썬이 있으면 py_compile 로 본다', p.오류 === 1 && p.출처 === 'py_compile', JSON.stringify(p).slice(0, 200));
}

// 첫 JS 를 쓸 때 뒤에서 데운 언어 서버가 있으면 거둔다 — 안 거두면 폴더를 물고 남는다 (lsp.test.js 8절).
await (await import('../src/lsp/client.js')).모두끄기();
rmSync(root, { recursive: true, force: true, maxRetries: 3 });
rmSync(집, { recursive: true, force: true, maxRetries: 3 });

const G = '\x1b[32m'; const R = '\x1b[31m'; const Y = '\x1b[33m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n고친 직후 문법 검사  ${D}(언어 서버가 없을 때 · node --check · JSON · CSS · py_compile)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
for (const s of 건너뜀) console.log(`  ${Y}-${X} ${s}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패${건너뜀.length ? ` · ${Y}${건너뜀.length}개 건너뜀${X}` : ''}\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
