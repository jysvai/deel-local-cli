/**
 * Outline · Verify · 모델 급 검사.
 *
 * 셋을 한 파일에 묶은 이유: 셋 다 "코딩을 얼마나 잘하느냐" 를 올리려고 넣은
 * 것들이고, 재는 자도 같다 — **작은 모델에서도 되는가.**
 *
 * ── 여기서 재는 것 ────────────────────────────────────────────────────
 *
 * Outline  Read 대비 몇 분의 일인가. 이게 크지 않으면 넣은 뜻이 없다.
 *          그리고 못 읽는 것을 **못 읽는다고 말하는가.** 조용히 빼면 모델은
 *          그 파일이 없는 줄 알고, 있는 설정을 다시 만든다.
 *
 * Verify   진짜로 탈난 것을 잡는가. 그리고 멀쩡한 것을 탈났다고 하지 않는가 —
 *          잘못된 경고는 확인 안 하는 것보다 나쁘다. 모델이 멀쩡한 파일을
 *          고치기 시작한다.
 *
 * 급       이름으로 짐작하고, **실제로 본 것**으로 고쳐 잡는가.
 *          그리고 안전에는 손을 안 대는가.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { TOOLS, 설명줄이기, toolSchemas } from '../src/tools/index.js';
import { 뼈대뽑기 } from '../src/tools/outline.js';
import { html보기, css보기, json보기 } from '../src/tools/verify.js';
import { 이름에서크기, 이름으로짐작, 첫짐작, 매김, 값 as 급값, 급말, 지켜본것 } from '../src/agent/grade.js';
import { estimateTokens } from '../src/agent/session.js';
import { 뼈대줄수, 설명길이 } from '../src/agent/budget.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-outline-'));
const ctx = {
  scope: makeScope(root), history: new History(root), audit: new Audit(root),
  seen: new Set(), 모델컨텍스트: 32768,
};
const 쓰기 = (이름, 글) => {
  const p = join(root, 이름);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, 글, 'utf8');
  return p;
};

// ═══ 1. 뼈대뽑기 — 언어별 ════════════════════════════════════════════
{
  const js = 뼈대뽑기(`
import x from 'y';
export function 접어쓰기(글, 폭) { return 글; }
export const 짧게 = (s) => s.slice(0, 10);
class InputBox {
  constructor() {}
  그리기(a, b) { if (a) { return 1; } }
}
export interface 모양 { a: number }
// function 주석안의것() {}
`, '.js');
  const 이름들 = js.항목.map((x) => x.이름);
  check('js: function 을 잡는다', 이름들.includes('접어쓰기'), 이름들.join(','));
  check('js: 화살표 함수도 잡는다', 이름들.includes('짧게'));
  check('js: class 를 잡는다', 이름들.includes('InputBox'));
  check('js: 메서드를 잡는다', 이름들.includes('그리기'));
  check('js: interface 를 잡는다', 이름들.includes('모양'));
  check('js: 주석 안엣것은 안 잡는다', !이름들.includes('주석안의것'), 이름들.join(','));
  // if·for 는 `이름(...) {` 과 생김새가 똑같다. 안 거르면 뼈대가 이것들로 찬다.
  check('js: if/for 를 이름으로 안 센다', !이름들.some((n) => ['if', 'for', 'while'].includes(n)),
    이름들.join(','));
  check('js: 줄 번호가 맞다', js.항목.find((x) => x.이름 === 'InputBox')?.줄 === 5,
    String(js.항목.find((x) => x.이름 === 'InputBox')?.줄));

  const py = 뼈대뽑기('class 가게:\n    def 열다(self):\n        pass\n\nasync def 닫다():\n    pass\n', '.py');
  check('py: class 와 def', py.항목.map((x) => x.이름).join(',') === '가게,열다,닫다',
    py.항목.map((x) => x.이름).join(','));

  const go = 뼈대뽑기('package main\nfunc 열다() {}\nfunc (s *가게) 닫다() {}\ntype 가게 struct{}\n', '.go');
  check('go: func 와 type', ['열다', '닫다', '가게'].every((n) => go.항목.some((x) => x.이름 === n)),
    go.항목.map((x) => x.이름).join(','));

  const rs = 뼈대뽑기('pub fn 열다() {}\nstruct 가게;\nimpl 가게 {}\n', '.rs');
  check('rust: fn·struct·impl', rs.항목.length >= 3, rs.항목.map((x) => x.이름).join(','));

  const java = 뼈대뽑기('public class 가게 {\n  public void 열다() {}\n}\n', '.java');
  check('java: class 와 method', ['가게', '열다'].every((n) => java.항목.some((x) => x.이름 === n)),
    java.항목.map((x) => x.이름).join(','));

  const cs = 뼈대뽑기('public sealed class 가게 {\n  public async Task 열다() {}\n}\n', '.cs');
  check('c#: class 와 method', cs.항목.length >= 2, cs.항목.map((x) => x.이름).join(','));

  const md = 뼈대뽑기('# 제목\n본문\n## 작은제목\n### 더작은것\n', '.md');
  check('md: 헤딩을 깊이대로', md.항목.length === 3 && md.항목[1].갈래 === 'h2',
    md.항목.map((x) => `${x.갈래}:${x.이름.trim()}`).join(','));

  const css = 뼈대뽑기('.차트칸 { color: red; }\n#표 { margin: 0; }\n@media print {\n', '.css');
  check('css: 선택자를 잡는다', css.항목.length >= 2, css.항목.map((x) => x.이름).join(','));

  const json = 뼈대뽑기('{\n  "name": "x",\n  "scripts": { "test": "y" }\n}\n', '.json');
  check('json: 맨 위 열쇠를 잡는다', json.항목.some((x) => x.이름 === 'name'),
    json.항목.map((x) => x.이름).join(','));

  const 모름 = 뼈대뽑기('아무거나', '.hwp');
  check('모르는 확장자는 못 읽는다고 말한다', 모름.왜못읽나 != null, String(모름.왜못읽나));
}

// ═══ 2. Outline 도구 — 값어치와 정직함 ═══════════════════════════════
{
  쓰기('src/a.js', 'export function 하나() {}\nexport function 둘() {}\n' + '// 채움\n'.repeat(300));
  쓰기('src/b.js', 'export class 셋 {}\n' + 'const x = 1;\n'.repeat(300));
  쓰기('설정.yml', 'key: value\n');
  쓰기('그림.svg', '<svg></svg>');
  쓰기('README.md', '# 제목\n## 둘째\n');

  const r = await TOOLS.Outline.run({ path: 'src' }, ctx);
  check('Outline 이 폴더를 본다', !r.error, r.error ?? '');
  check('두 파일의 뼈대가 다 나온다', /a\.js/.test(r.content) && /b\.js/.test(r.content));
  check('이름과 줄 번호가 같이 나온다', /\d+\s+fn\s+하나/.test(r.content),
    (r.content.match(/.*하나.*/) ?? [''])[0]);

  // 값어치 — 이게 크지 않으면 도구를 넣은 뜻이 없다.
  const 뼈대토큰 = estimateTokens(r.content);
  const 통째로 = ['src/a.js', 'src/b.js']
    .reduce((a, f) => a + estimateTokens(readFileSync(join(root, f), 'utf8')), 0);
  check('Read 로 통째로 읽는 것보다 10배 넘게 싸다', 통째로 / 뼈대토큰 > 10,
    `${통째로.toLocaleString()} → ${뼈대토큰.toLocaleString()}토큰 (${(통째로 / 뼈대토큰).toFixed(1)}배)`);

  // 정직함 — 못 읽은 것을 조용히 빼면 모델은 그 파일이 없는 줄 안다.
  const 전체 = await TOOLS.Outline.run({}, ctx);
  check('못 읽은 것을 그렇다고 말한다', /뼈대는 못 뽑은 것/.test(전체.content),
    전체.summary);
  check('그 파일 이름도 적어 준다', /설정\.yml/.test(전체.content));
  check('무엇인지 아는 것은 무엇인지도 말한다', /YAML 설정/.test(전체.content),
    (전체.content.match(/.*YAML.*/) ?? [''])[0]);
  check('마크다운 헤딩도 뼈대로 나온다', /README\.md/.test(전체.content));

  // 좁히기는 Glob 과 같은 뜻이어야 한다.
  const 좁힌것 = await TOOLS.Outline.run({ pattern: '**/a.js' }, ctx);
  check('pattern 으로 좁힐 수 있다', /a\.js/.test(좁힌것.content) && !/b\.js/.test(좁힌것.content),
    좁힌것.summary);

  const 없는것 = await TOOLS.Outline.run({ path: '없는폴더' }, ctx);
  check('없는 경로는 오류로 말한다', !!없는것.error, 없는것.error ?? '');

  // 상한이 창을 따라간다
  check('뼈대 줄 수가 창을 따라간다', 뼈대줄수(8192) < 뼈대줄수(131072),
    `8k ${뼈대줄수(8192)}줄 · 131k ${뼈대줄수(131072)}줄`);
}

// ═══ 3. Verify — 탈난 것을 잡고, 멀쩡한 것은 안 건드린다 ═════════════
{
  // 읽어서 보는 것들 (순수 함수라 따로 잰다)
  check('html: 안 닫은 태그를 잡는다', html보기('<div><p>글</div>').length > 0,
    html보기('<div><p>글</div>').join(' / '));
  check('html: 멀쩡한 것은 안 건드린다', html보기('<div><p>글</p></div>').length === 0,
    html보기('<div><p>글</p></div>').join(' / '));
  check('html: img·br 은 안 닫아도 된다', html보기('<div><br><img src="x.png"></div>',
    { 있는파일: () => true }).length === 0);
  check('html: 스스로 닫은 태그도 안다', html보기('<div><hr /></div>').length === 0);
  check('html: script 안엣 부등호는 태그가 아니다',
    html보기('<div><script>if (a < b) {}</script></div>').length === 0,
    html보기('<div><script>if (a < b) {}</script></div>').join(' / '));
  check('html: 주석 안엣것도 태그가 아니다', html보기('<div><!-- <p> --></div>').length === 0);
  check('html: 없는 파일을 가리키면 잡는다',
    html보기('<link href="없다.css">', { 있는파일: () => false }).some((t) => /없다\.css/.test(t)));
  check('html: 바깥 주소는 못 보니 안 건드린다',
    html보기('<script src="https://x/y.js"></script>', { 있는파일: () => false }).length === 0);

  check('css: 안 닫은 중괄호를 잡는다', css보기('.a { color: red;').length > 0,
    css보기('.a { color: red;').join(''));
  check('css: 멀쩡한 것은 안 건드린다', css보기('.a { color: red; }\n.b { margin: 0 }').length === 0);
  check('css: 주석 안엣 중괄호는 안 센다', css보기('/* { */ .a { color: red; }').length === 0);

  check('json: 망가진 것을 잡는다', json보기('{"a":}').length > 0);
  check('json: 멀쩡한 것은 안 건드린다', json보기('{"a":1}').length === 0);

  // 도구로 통째로
  const 터 = mkdtempSync(join(tmpdir(), 'deel-verify-'));
  const vctx = {
    scope: makeScope(터), history: new History(터), audit: new Audit(터),
    seen: new Set(), 모델컨텍스트: 32768,
  };
  writeFileSync(join(터, 'index.html'),
    '<!doctype html>\n<html><head><link rel="stylesheet" href="style.css"></head>\n'
    + '<body><div><h1>제목</h1></body></html>\n', 'utf8');   // </div> 없음 + style.css 없음
  writeFileSync(join(터, 'ok.js'), 'const a = 1;\nconsole.log(a);\n', 'utf8');
  writeFileSync(join(터, '깨진것.js'), 'function x( {\n', 'utf8');
  writeFileSync(join(터, '자료.json'), '{"a": 1}\n', 'utf8');

  const v = await TOOLS.Verify.run({}, vctx);
  check('Verify: 안 닫힌 태그를 잡았다', /index\.html/.test(v.content) && /안 닫았습니다/.test(v.content),
    v.summary);
  check('Verify: 없는 css 참조도 잡았다', /style\.css/.test(v.content));
  check('Verify: 문법이 깨진 JS 를 잡았다', /깨진것\.js/.test(v.content), v.summary);
  check('Verify: 멀쩡한 JS 는 확인됨으로', /✓[^\n]*ok\.js/.test(v.content),
    (v.content.match(/.*ok\.js.*/) ?? [''])[0]);
  check('Verify: 멀쩡한 JSON 도 확인됨으로', /✓[^\n]*자료\.json/.test(v.content));
  check('Verify: 탈이 있으면 실패로 알린다', v.failed === true, JSON.stringify(v.summary));
  check('Verify: 몇 개가 탈났는지 센다', v.탈 === 2, `탈 ${v.탈}개`);

  // 다 멀쩡하면 실패가 아니어야 한다. 이게 틀리면 모델이 끝없이 고치려 든다.
  writeFileSync(join(터, 'index.html'), '<!doctype html>\n<html><body><div><h1>제목</h1></div></body></html>\n', 'utf8');
  rmSync(join(터, '깨진것.js'));
  const v2 = await TOOLS.Verify.run({}, vctx);
  check('Verify: 다 멀쩡하면 실패가 아니다', v2.failed === false, v2.summary);

  // 못 확인한 것을 반드시 말한다 — 이게 이 도구의 값을 지킨다.
  writeFileSync(join(터, '문서.hwp'), '아무거나', 'utf8');
  const v3 = await TOOLS.Verify.run({ paths: ['문서.hwp'] }, vctx);
  check('Verify: 확인 못 한 것을 못 했다고 말한다', /확인 못 한 것/.test(v3.content), v3.content.slice(0, 80));
  check('Verify: 됐다고 말하면 안 된다고 못 박는다', /됐다고 말하면 안 된다/.test(v3.content));

  // 없는 파일을 주면 그렇게 말한다
  const v4 = await TOOLS.Verify.run({ paths: ['없는것.js'] }, vctx);
  check('Verify: 없는 파일은 탈로 잡는다', /없는것\.js/.test(v4.content) && v4.failed === true);

  // Verify 는 아무것도 안 바꾼다 — 확인하는 물건이 파일을 건드리면 안 된다.
  const 전 = readdirSync(터).sort().join(',');
  await TOOLS.Verify.run({}, vctx);
  check('Verify 는 파일을 안 건드린다', readdirSync(터).sort().join(',') === 전);

  rmSync(터, { recursive: true, force: true });
}

// ═══ 4. 한 번에 여러 파일 쓰기 ═══════════════════════════════════════
{
  const 터 = mkdtempSync(join(tmpdir(), 'deel-multi-'));
  const wctx = {
    scope: makeScope(터), history: new History(터), audit: new Audit(터),
    seen: new Set(), 모델컨텍스트: 32768,
  };
  wctx.history.nextTurn();

  const r = TOOLS.Write.run({
    files: [
      { file_path: 'index.html', content: '<!doctype html>\n<html></html>\n' },
      { file_path: 'src/app.js', content: 'const a = 1;\n' },
      { file_path: 'style.css', content: '.a { color: red; }\n' },
    ],
  }, wctx);

  check('여러 개를 한 번에 만든다', r.여럿?.length === 3, `${r.여럿?.length}개`);
  check('셋 다 됐다', r.여럿.every((x) => x.ok), r.여럿.map((x) => `${x.보인이름}:${x.ok}`).join(' '));
  check('없는 폴더도 만들어 준다', readFileSync(join(터, 'src', 'app.js'), 'utf8') === 'const a = 1;\n');
  check('몇 개 몇 줄인지 요약한다', /3개/.test(r.summary), r.summary);
  check('파일마다 한 줄씩 적어 준다', (r.content.match(/✓/g) ?? []).length === 3, r.content);

  /*
   * 되돌리기가 파일마다 따로 떠 있어야 한다.
   *
   * 한 덩이로 뜨면 `/undo` 가 전부-아니면-전무가 된다. 넷 중 하나만 잘못
   * 만들었을 때 나머지 셋까지 날려야 한다는 뜻이다.
   */
  check('되돌리기 스냅샷이 파일마다 떠 있다',
    wctx.history.all().filter((x) => x.turn === wctx.history.turn).length === 3,
    `${wctx.history.all().length}개`);

  // 하나가 실패해도 나머지는 간다. 첫 실패에서 멈추면 왕복을 줄이려던 것이 도로 는다.
  const r2 = TOOLS.Write.run({
    files: [
      { file_path: 'good.txt', content: '됨' },
      { file_path: '', content: '안 됨' },
      { file_path: 'good2.txt', content: '됨' },
    ],
  }, wctx);
  check('하나가 실패해도 나머지는 간다', r2.여럿.filter((x) => x.ok).length === 2,
    r2.여럿.map((x) => `${x.보인이름 ?? '?'}:${x.ok}`).join(' '));
  check('무엇이 실패했는지 말한다', /✗/.test(r2.content), r2.content);
  check('된 것은 다시 안 보내도 된다고 알려 준다', /실패한 것만 다시 보내세요/.test(r2.content));
  check('된 것이 있으면 통째 실패로 안 만든다', !r2.error, String(r2.error));

  // 한 개일 때의 결과 모양은 한 글자도 안 바뀌어야 한다 —
  // 그 모양을 보고 있는 자리가 여럿이다 (살려쓰기·바뀐 자리 그리기·되돌리기).
  const r3 = TOOLS.Write.run({ file_path: '하나.txt', content: '한 줄\n' }, wctx);
  check('한 개일 때는 예전 모양 그대로', !!r3.changed && !!r3.diff && !r3.여럿,
    Object.keys(r3).join(','));
  check('한 개일 때 요약도 그대로', /줄/.test(r3.summary), r3.summary);

  const r4 = TOOLS.Write.run({ content: '경로 없음' }, wctx);
  check('경로가 없으면 무엇을 줘야 하는지 알려 준다', /files 배열/.test(r4.error ?? ''), r4.error ?? '');

  rmSync(터, { recursive: true, force: true });
}

// ═══ 4-2. 한 번에 여러 군데 고치기 ═══════════════════════════════════
//
// Write 의 files 와 같은 이유로 넣었다. 다만 Edit 쪽이 더 값이 크다 —
// 파일을 새로 만드는 일은 한 번이지만, **고치는 일은 계속 있다.**
// 여섯 군데짜리 손질에 왕복이 여섯 번이면 로컬 모델에서 몇 분이 그냥 간다.
//
// 여기서 재는 것은 셋이다.
//   1. 차례로 적용되는가 — 같은 파일을 두 번 고치는 것이 아주 흔하다
//   2. 하나가 실패해도 나머지가 가는가
//   3. 한 개일 때의 결과 모양이 한 글자도 안 바뀌었는가
{
  const 터 = mkdtempSync(join(tmpdir(), 'deel-edits-'));
  const ectx = {
    scope: makeScope(터), history: new History(터), audit: new Audit(터),
    seen: new Set(), 모델컨텍스트: 32768,
  };
  ectx.history.nextTurn();

  const 갑 = join(터, '갑.js');
  const 을 = join(터, '을.css');
  writeFileSync(갑, 'const 값 = 1;\nconst 다른값 = 2;\nexport { 값, 다른값 };\n', 'utf8');
  writeFileSync(을, '.a { color: red; }\n', 'utf8');
  ectx.seen.add(갑);
  ectx.seen.add(을);

  const r = TOOLS.Edit.run({
    edits: [
      { file_path: '갑.js', old_string: 'const 값 = 1;', new_string: 'const 값 = 10;' },
      { file_path: '갑.js', old_string: 'const 다른값 = 2;', new_string: 'const 다른값 = 20;' },
      { file_path: '을.css', old_string: 'color: red', new_string: 'color: blue' },
    ],
  }, ectx);

  check('여러 군데를 한 번에 고친다', r.여럿?.length === 3, `${r.여럿?.length}군데`);
  check('셋 다 됐다', r.여럿.every((x) => x.ok), r.여럿.map((x) => `${x.보인이름}:${x.ok}`).join(' '));
  check('실제로 내용이 바뀌었다', /값 = 10/.test(readFileSync(갑, 'utf8')) && /다른값 = 20/.test(readFileSync(갑, 'utf8')),
    readFileSync(갑, 'utf8').split('\n')[0]);
  check('다른 파일도 같이 고친다', /color: blue/.test(readFileSync(을, 'utf8')), readFileSync(을, 'utf8').trim());
  /*
   * 파일 수와 군데 수는 다르다.
   *
   * 한 파일을 여섯 군데 고치는 것이 보통이라, '3개 파일' 이라고 적으면
   * 거짓이 된다. 사람이 화면에서 세는 것과 말이 어긋나기 시작하면
   * 그때부터는 화면을 안 믿게 된다.
   */
  check('파일 수와 군데 수를 갈라 적는다', /2개 파일 · 3군데/.test(r.summary), r.summary);

  /*
   * 차례로 적용된다.
   *
   * 같은 파일의 두 자리를 한꺼번에 계산해서 붙이면 자리가 겹칠 때 조용히
   * 어긋난다. 매번 디스크에서 다시 읽어 뒤엣것이 앞엣것의 결과를 보게 한다.
   * 여기서 그걸 재려고 **앞의 고침이 만들어 낸 글**을 뒤에서 찾는다.
   */
  const 차례 = TOOLS.Edit.run({
    edits: [
      { file_path: '갑.js', old_string: 'const 값 = 10;', new_string: 'const 값 = 100; // 한 번' },
      { file_path: '갑.js', old_string: '// 한 번', new_string: '// 두 번' },
    ],
  }, ectx);
  check('앞엣것을 뒤엣것이 볼 수 있다 (차례로 적용)', 차례.여럿.every((x) => x.ok),
    차례.여럿.map((x) => x.error ?? 'ok').join(' | '));
  check('마지막 것이 남는다', /\/\/ 두 번/.test(readFileSync(갑, 'utf8')), readFileSync(갑, 'utf8').split('\n')[0]);

  /*
   * 되돌리기는 그대로 한 턴이다.
   *
   * 스냅샷은 파일마다 그 턴의 첫 번만 뜬다. 같은 파일을 여섯 군데 고쳐도
   * /undo 한 번이면 여섯 군데가 다 손대기 전으로 돌아간다 — 사람이 기대하는
   * 그 모양이다. 군데마다 한 칸씩 쌓이면 /undo 를 여섯 번 눌러야 한다.
   */
  ectx.history.nextTurn();
  TOOLS.Edit.run({
    edits: [
      { file_path: '갑.js', old_string: '값 = 100', new_string: '값 = 1000' },
      { file_path: '갑.js', old_string: '다른값 = 20', new_string: '다른값 = 200' },
    ],
  }, ectx);
  const 이번턴 = ectx.history.all().filter((x) => x.turn === ectx.history.turn);
  check('같은 파일을 여러 번 고쳐도 되돌리기는 한 칸', 이번턴.length === 1, `${이번턴.length}칸`);
  const 되돌림 = ectx.history.undo(1);
  check('한 번 되돌리면 그 턴이 통째로 돌아간다',
    /값 = 100;/.test(readFileSync(갑, 'utf8')) && /다른값 = 20;/.test(readFileSync(갑, 'utf8')),
    readFileSync(갑, 'utf8').split('\n').slice(0, 2).join(' / '));
  check('무엇을 되돌렸는지 말해 준다', (되돌림.restored ?? []).length === 1, JSON.stringify(되돌림.restored?.[0])?.slice(0, 60));

  // 하나가 실패해도 나머지는 간다. 첫 실패에서 멈추면 왕복을 줄이려던 것이 도로 는다.
  const 섞임 = TOOLS.Edit.run({
    edits: [
      { file_path: '갑.js', old_string: '다른값 = 20;', new_string: '다른값 = 21;' },
      { file_path: '갑.js', old_string: '이런 줄은 파일에 없다', new_string: '아무거나' },
      { file_path: '을.css', old_string: 'color: blue', new_string: 'color: green' },
    ],
  }, ectx);
  check('하나가 실패해도 나머지는 간다', 섞임.여럿.filter((x) => x.ok).length === 2,
    섞임.여럿.map((x) => (x.ok ? 'ok' : '✗')).join(' '));
  check('된 것이 있으면 통째 실패로 안 만든다', !섞임.error, String(섞임.error));
  check('무엇이 실패했는지 적는다', /✗/.test(섞임.content), 섞임.content.split('\n').find((l) => /✗/.test(l)) ?? '');
  /*
   * 실패한 것만 다시 보내라고, 그리고 **다시 Read 하라고** 알려 준다.
   *
   * 앞엣것이 이미 파일에 들어갔다. 그 사실을 안 알려 주면 모델은 원래
   * 들고 있던 글로 old_string 을 다시 잡고, 또 못 찾고, 같은 자리를 맴돈다.
   */
  check('실패한 것만 다시 보내라고 한다', /실패한 것만 다시 보내세요/.test(섞임.content), '');
  check('다시 Read 하라고 알려 준다', /파일을 다시 Read/.test(섞임.content), '');

  const 다실패 = TOOLS.Edit.run({
    edits: [{ file_path: '갑.js', old_string: '없는 글', new_string: 'x' }],
  }, ectx);
  check('하나도 못 고쳤으면 실패로 말한다', !!다실패.error, String(다실패.error).slice(0, 40));

  /*
   * 한 개일 때의 결과 모양은 한 글자도 안 바뀌어야 한다.
   * 그 모양을 보고 있는 자리가 셋이다 — loop.js 의 잘린 인자 살려쓰기,
   * repl.js 의 바뀐 자리 그리기, 되돌리기 스냅샷.
   */
  const 하나만 = TOOLS.Edit.run({ file_path: '을.css', old_string: 'color: green', new_string: 'color: black' }, ectx);
  check('한 개일 때는 예전 모양 그대로', !!하나만.changed && !!하나만.diff && !하나만.여럿,
    Object.keys(하나만).join(','));
  check('한 개일 때 요약도 그대로', /1군데/.test(하나만.summary), 하나만.summary);
  check('한 개일 때 완화 단계도 그대로 붙는다', 'tier' in 하나만, String(하나만.tier));

  const 빈것 = TOOLS.Edit.run({ old_string: 'a', new_string: 'b' }, ectx);
  check('경로가 없으면 무엇을 줘야 하는지 알려 준다', /edits 배열/.test(빈것.error ?? ''), 빈것.error ?? '');

  // 여럿으로 보내도 안전 규칙은 그대로다. 안 읽은 파일은 못 고친다.
  const 안읽음 = join(터, '안읽은것.txt');
  writeFileSync(안읽음, '아무 글\n', 'utf8');
  const 몰래 = TOOLS.Edit.run({
    edits: [{ file_path: '안읽은것.txt', old_string: '아무 글', new_string: '바꾼 글' }],
  }, ectx);
  check('여럿으로 보내도 안 읽은 파일은 못 고친다', /먼저 Read/.test(몰래.여럿?.[0]?.error ?? ''),
    몰래.여럿?.[0]?.error ?? '');
  check('막힌 뒤에도 파일은 그대로', readFileSync(안읽음, 'utf8') === '아무 글\n', readFileSync(안읽음, 'utf8'));

  rmSync(터, { recursive: true, force: true });
}

// ═══ 5. 모델 급 ══════════════════════════════════════════════════════
{
  check('이름에서 7b 를 읽는다', 이름에서크기('qwen2.5-coder-7b-instruct') === 7);
  check('판 번호(2.5)를 크기로 오해하지 않는다', 이름에서크기('qwen2.5-coder-7b') === 7,
    String(이름에서크기('qwen2.5-coder-7b')));
  check('양자화 표시(q4)를 크기로 안 읽는다', 이름에서크기('llama-3.3-70b-q4_k_m') === 70,
    String(이름에서크기('llama-3.3-70b-q4_k_m')));
  check('여러 개면 큰 쪽 (moe)', 이름에서크기('qwen3-30b-a3b') === 30,
    String(이름에서크기('qwen3-30b-a3b')));
  check('모르면 모른다고 한다', 이름에서크기('gpt-oss') === null);

  check('7B 는 작음', 이름으로짐작('qwen-7b').급 === '작음');
  check('30B 는 보통', 이름으로짐작('qwen3-30b-a3b').급 === '보통');
  check('70B 는 큼', 이름으로짐작('llama-70b').급 === '큼');
  /*
   * 이름을 못 읽으면 '보통' 이다. '작음' 이 아니다.
   *
   * 사내 게이트웨이가 정확히 이 자리다 — 이름이 아무것도 안 알려 주는데
   * 붙는 모델은 대개 크다. 작다고 잡으면 좋은 모델을 붙들어 매게 된다.
   */
  check('이름을 못 읽으면 보통 (작음이 아니다)', 이름으로짐작('gpt-oss').급 === '보통');
  check('짐작이라고 표시한다', 이름으로짐작('gpt-oss').짐작 === true);

  /*
   * ★ 이름에 크기가 없으면 **서버가 알려 준 창 크기**로 잡는다.
   *
   * 벤더 모델은 이름에 파라미터 수를 안 적는다. `anthropic.claude-opus-4-1`
   * 에는 B 가 없어서 여태 '보통' 으로 떨어졌고, 그래서 Bedrock 의 Opus 가
   * 「한 번에 파일 3개 · 400줄 넘으면 나눠 쓰기」 를 받았다 — 제일 큰 모델에
   * 중급용 보조바퀴를 달아 준 셈이다.
   *
   * 이름표(`opus` 면 큼)를 두는 쪽은 일부러 안 갔다. 새 모델이 나올 때마다
   * 어긋나고 어긋난 줄도 모른다. 창 크기는 완벽한 잣대는 아니지만 **우리가
   * 실제로 아는 것** 중 제일 가깝다.
   */
  check('★ 이름에 크기가 없으면 창 크기로 잡는다',
    첫짐작({ model: 'anthropic.claude-opus-4-1', ctx: 200000 }).급 === '큼',
    JSON.stringify(첫짐작({ model: 'anthropic.claude-opus-4-1', ctx: 200000 })));
  check('★ 창이 좁으면 작음', 첫짐작({ model: 'unknown-thing', ctx: 8192 }).급 === '작음',
    첫짐작({ model: 'unknown-thing', ctx: 8192 }).왜);
  check('중간 창은 보통', 첫짐작({ model: 'unknown-thing', ctx: 32768 }).급 === '보통');
  /*
   * ★ 그런데 이름에서 파라미터 수를 읽었으면 **그게 이긴다.**
   * 8B 는 창이 128k 여도 8B 다 — 창이 넓다고 머리가 커지지 않는다.
   */
  check('★ 이름의 파라미터 수가 창 크기를 이긴다',
    첫짐작({ model: 'llama-3.1-8b', ctx: 128000 }).급 === '작음',
    JSON.stringify(첫짐작({ model: 'llama-3.1-8b', ctx: 128000 })));
  check('창도 이름도 모르면 보통', 첫짐작({ model: 'gpt-oss', ctx: null }).급 === '보통');
  check('왜 그렇게 봤는지 창 크기를 적어 준다',
    /200k/.test(첫짐작({ model: 'x', ctx: 200000 }).왜), 첫짐작({ model: 'x', ctx: 200000 }).왜);

  // 실제로 본 것이 이름을 이긴다
  const 나쁨 = new 지켜본것();
  for (let i = 0; i < 5; i++) { 나쁨.걸음셈(); 나쁨.본것('잘린인자'); }
  const g1 = 매김({ model: 'llama-70b' }, 나쁨);
  check('70B 라도 계속 잘리면 작음으로 내린다', g1.급 === '작음', `${g1.급} — ${g1.왜}`);
  check('왜 그렇게 봤는지 말한다', /인자 잘림/.test(g1.왜), g1.왜);
  check('짐작이 아니라고 표시한다', g1.짐작 === false);

  const 좋음 = new 지켜본것();
  for (let i = 0; i < 10; i++) { 좋음.걸음셈(); 좋음.본것('도구성공'); }
  const g2 = 매김({ model: 'qwen-7b' }, 좋음);
  check('7B 라도 사고 없이 돌면 한 단 올린다', g2.급 === '보통', `${g2.급} — ${g2.왜}`);

  const 적음 = new 지켜본것();
  적음.걸음셈();
  check('두어 걸음으로는 판단 안 한다', 매김({ model: 'qwen-7b' }, 적음).급 === '작음');
  check('걸음이 적으면 짐작 그대로', 적음.사고율() === null);

  check('사람이 정하면 그것이 이긴다', 매김({ model: 'qwen-7b' }, 나쁨, '큼').급 === '큼');
  check('사람이 정했다고 말해 준다', /직접 정했/.test(매김({ model: 'x' }, null, '큼').왜));

  // 급마다 값이 달라진다 — 이게 "좋은 모델은 좋은 만큼" 이다
  check('큰 급이 한 번에 더 많이 만든다', 급값('큼').한번에쓸파일 > 급값('작음').한번에쓸파일,
    `작음 ${급값('작음').한번에쓸파일} → 큼 ${급값('큼').한번에쓸파일}`);
  check('작은 급은 더 잘게 나눠 쓴다', 급값('작음').나눠쓰기줄 < 급값('큼').나눠쓰기줄);
  check('큰 급에는 절차를 안 못 박는다', 급값('큼').절차를못박나 === false);
  /*
   * 확인은 급과 상관없이 언제나 시킨다.
   *
   * "좋은 모델이니 확인 안 해도 된다" 는 없다. 확인을 건너뛰면 잘하는 모델이
   * 잘못 만들었을 때 아무도 모른다 — 오히려 더 나쁘다.
   */
  for (const 급 of ['작음', '보통', '큼']) {
    check(`${급}: 확인은 언제나 시킨다`, 급값(급).확인을시키나 === true);
  }

  // 프롬프트에 붙는 글
  check('작은 급에는 짧게 못 박은 글이 붙는다', /한 걸음에 한 가지만/.test(급말('작음')), 급말('작음'));
  check('큰 급에는 아무것도 안 붙는다', 급말('큼') === '', 급말('큼'));
  check('작은 급 글이 짧다 (10줄 안쪽)', 급말('작음').split('\n').length <= 10,
    `${급말('작음').split('\n').length}줄`);
}

// ═══ 6. 도구 설명 줄이기 — 작은 창을 위한 다이어트 ═══════════════════
{
  const 원본 = TOOLS.Outline.schema;
  const 줄인것 = 설명줄이기(원본, 90);
  check('줄여도 첫 문장은 남는다', 줄인것.description.startsWith('폴더나 파일의'),
    줄인것.description);
  check('문장 중간에서 안 자른다', /[.다]$/.test(줄인것.description.trim()),
    JSON.stringify(줄인것.description.slice(-20)));
  check('실제로 짧아진다', 줄인것.description.length < 원본.description.length,
    `${원본.description.length} → 줄인것.description.length`.replace('줄인것.description.length', String(줄인것.description.length)));
  check('도구 이름은 안 바뀐다', 줄인것.name === 원본.name);
  check('인자 이름도 그대로 남는다',
    Object.keys(줄인것.parameters.properties).join(',') === Object.keys(원본.parameters.properties).join(','),
    Object.keys(줄인것.parameters.properties).join(','));

  check('큰 창에서는 안 줄인다', 설명줄이기(원본, Infinity) === 원본);
  check('설명 길이가 창을 따라간다', 설명길이(8192) < 설명길이(32768),
    `8k ${설명길이(8192)} · 32k ${설명길이(32768)}`);
  check('64k 넘으면 통째로 준다', 설명길이(131072) === Infinity);

  // 제일 중요한 것 — **도구를 빼지는 않는다.**
  // 빼면 작은 모델만 할 수 있는 일이 달라져서, 환경마다 다르게 동작하게 된다.
  const 작은창 = toolSchemas(null, { hasSkills: false, web: true, work: 'code', ctx: 8192 })
    .map((t) => t.function.name);
  const 큰창 = toolSchemas(null, { hasSkills: false, web: true, work: 'code', ctx: 655360 })
    .map((t) => t.function.name);
  check('작은 창에서도 도구는 다 준다', 작은창.join(',') === 큰창.join(','),
    `작은창 ${작은창.length}종 · 큰창 ${큰창.length}종`);

  const 작은토큰 = estimateTokens(JSON.stringify(toolSchemas(null, { hasSkills: false, web: true, work: 'code', ctx: 8192 })));
  const 큰토큰 = estimateTokens(JSON.stringify(toolSchemas(null, { hasSkills: false, web: true, work: 'code', ctx: 655360 })));
  check('그런데 자리는 실제로 줄어든다', 작은토큰 < 큰토큰 * 0.75,
    `8k ${작은토큰.toLocaleString()} · 655k ${큰토큰.toLocaleString()}토큰 (${Math.round((1 - 작은토큰 / 큰토큰) * 100)}% 줄어듦)`);
}

rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n뼈대·확인·모델 급 검사  ' + D + '(작은 모델에서도 되는가)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  통과 ${pass.length} · 실패 ${fail.length}\n`);
process.exitCode = fail.length ? 1 : 0;
