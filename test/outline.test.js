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
  // ★ (6회차 뼈대6bc-b OL3) 깊이만큼 들여쓴 이름(뼈대뽑기의 헤딩 갈래)을 `짧게` 가 빈칸을 접고 trim 해
  // 들여쓰기가 한 번도 안 나갔다.
  check('★ (6회차 OL3) md 헤딩 이름이 깊이만큼 들여써진다',
    md.항목[0]?.이름 === '제목' && md.항목[1]?.이름 === '  작은제목' && md.항목[2]?.이름 === '    더작은것',
    JSON.stringify(md.항목.map((x) => x.이름)));
  // ★ (6회차 뼈대6bc-b OL4) if·class·new 거르기는 메서드 규칙이 `if (…) {` 를 잡는 것을 막으려는 것인데
  // 헤딩에도 걸려 문서 제목이 뼈대에서 사라졌다.
  const 낱말제목 = 뼈대뽑기('# 안내\n## class\n## new\n## return 값\n', '.md');
  check('★ (6회차 OL4) md 헤딩은 class·new 같은 낱말이어도 남는다', 낱말제목.항목.length === 4,
    JSON.stringify(낱말제목.항목.map((x) => x.이름.trim())));
  const 코드거름 = 뼈대뽑기('class 가게 {\n  if (x) {\n  }\n  열다() {\n  }\n}\n', '.js');
  check('(OL4 짝) 코드의 if (…) { 는 여전히 메서드로 안 잡는다', !코드거름.항목.some((x) => x.이름.trim() === 'if')
    && 코드거름.항목.some((x) => x.이름.trim() === '열다'), JSON.stringify(코드거름.항목.map((x) => x.이름)));

  const css = 뼈대뽑기('.차트칸 { color: red; }\n#표 { margin: 0; }\n@media print {\n', '.css');
  check('css: 선택자를 잡는다', css.항목.length >= 2, css.항목.map((x) => x.이름).join(','));

  const json = 뼈대뽑기('{\n  "name": "x",\n  "scripts": { "test": "y" }\n}\n', '.json');
  check('json: 맨 위 열쇠를 잡는다', json.항목.some((x) => x.이름 === 'name'),
    json.항목.map((x) => x.이름).join(','));

  const 모름 = 뼈대뽑기('아무거나', '.hwp');
  check('모르는 확장자는 못 읽는다고 말한다', 모름.왜못읽나 != null, String(모름.왜못읽나));

  /*
   * ★★ (8회차 파일훑기) 수식어를 **하나만** 먹던 메서드 규칙.
   *
   * `(?:static\s+|async\s+|get\s+|set\s+|#)?` 는 하나까지만 먹는다. 그래서
   * `static async fetchUser()` 는 `static ` 을 먹고 `async` 를 이름으로 잡으려다
   * 뒤의 `(` 를 못 만나 **아예 안 걸렸다.** 재 보니 클래스 하나에서 그 줄만
   * 통째로 빠졌다. 요즘 코드에서 제일 흔한 조합이다.
   */
  const 수식어 = 뼈대뽑기([
    'class 가게 {',
    '  static async 불러오기(id) { return id; }',
    '  static get 이름() { return 1; }',
    '  async #몰래() { return 2; }',
    '  static async *흘리기() {}',
    '  그냥() {}',
    '}',
  ].join('\n'), '.js');
  const 수식어이름 = 수식어.항목.map((x) => x.이름);
  check('★★ (8회차) static async 메서드를 잡는다', 수식어이름.includes('불러오기'), 수식어이름.join(','));
  check('★ (8회차) static get 도 잡는다', 수식어이름.includes('이름'), 수식어이름.join(','));
  check('★ (8회차) async #사사로운 메서드도 잡는다', 수식어이름.includes('몰래'), 수식어이름.join(','));
  check('  수식어가 없는 메서드는 그대로 잡는다', 수식어이름.includes('그냥'), 수식어이름.join(','));
  check('  수식어를 이름으로 잘못 세지 않는다',
    !수식어이름.some((n) => ['static', 'async', 'get', 'set'].includes(n)), 수식어이름.join(','));

  /*
   * ★★★ 그 고침이 **탭으로 들여쓴 파일에는 한 번도 안 닿았다** (막판 훑기).
   *
   * 메서드 규칙이 `^\s{2,}` 라 공백 **둘 이상**을 요구했는데, 탭 들여쓰기는 한 단이
   * 탭 하나다. 그래서 `.editorconfig` 가 `indent_style = tab` 인 저장소에서는
   * 수식어가 무엇이든 클래스 메서드가 **한 개도** 안 걸렸다 — 클래스 이름만 달랑
   * 뜨고, 모델은 그 클래스에 메서드가 없는 줄 안다. 위 검사가 공백만 써서 못 잡았다.
   */
  const 탭 = String.fromCharCode(9);
  const 탭들여씀 = 뼈대뽑기([
    'class 가게 {',
    `${탭}static async 불러오기(id) { return id; }`,
    `${탭}그냥() {}`,
    '}',
  ].join('\n'), '.js');
  const 탭이름 = 탭들여씀.항목.map((x) => x.이름);
  check('★★★ 탭으로 들여쓴 클래스 메서드도 잡는다', 탭이름.includes('불러오기') && 탭이름.includes('그냥'),
    탭이름.join(','));
  // 들여쓰기가 없으면 그건 메서드가 아니라 부름이다 — 넓히되 이쪽은 그대로 막는다.
  const 민줄 = 뼈대뽑기('부르기() {\n}\n', '.js').항목;
  check('  (짝) 들여쓰기 없는 `이름() {` 은 여전히 메서드가 아니다',
    !민줄.some((x) => x.갈래 === 'method'), JSON.stringify(민줄));

  /*
   * ★★★ Outline 설명서는 「kotlin 을 읽는다」 고 적어 두고 `fun` 을 하나도 안 뽑았다.
   *
   * java 규칙에는 「접근지정자 + 반환형 + 이름(」 밖에 없어서 Kotlin 의 `fun`,
   * Scala·Groovy 의 `def` 가 어느 무늬에도 안 걸렸다. 이 파일 머리말이 「모르는 것은
   * 모른다고 말한다 — 못 읽는 확장자를 조용히 빼면 모델은 그 파일이 없는 줄 안다」 고
   * 적어 뒀는데, 여기서는 **읽는다고 해 놓고** 클래스 이름 하나만 내놓았다.
   */
  const kt = 뼈대뽑기([
    'package a',
    '',
    'data class 짐(val n: Int)',
    '',
    'class 곳간 {',
    '    suspend fun 불러오기(): Int = 1',
    '    private fun 감추기() {}',
    '}',
    '',
    'fun 맨위() {}',
    '',
    'object 홀로 {}',
  ].join('\n'), '.kt');
  const kt이름 = kt.항목.map((x) => x.이름);
  check('★★★ kotlin 의 fun 을 뽑는다', ['불러오기', '감추기', '맨위'].every((n) => kt이름.includes(n)), kt이름.join(','));
  check('★★ kotlin 의 data class·object 도 뽑는다',
    ['짐', '곳간', '홀로'].every((n) => kt이름.includes(n)), kt이름.join(','));
  const scala = 뼈대뽑기('class A {\n  def f(x: Int) = x\n}\n', '.scala').항목.map((x) => x.이름);
  check('★★ scala·groovy 의 def 도 뽑는다', scala.includes('f'), scala.join(','));
  // 자바 쪽이 안 흔들리는지 — 넓힌 것이 옛 것을 밀어내면 안 된다.
  const 자바다시 = 뼈대뽑기('public class 가게 {\n  public void 열다() {}\n}\n', '.java').항목.map((x) => x.이름);
  check('  (짝) 자바는 그대로다', ['가게', '열다'].every((n) => 자바다시.includes(n)), 자바다시.join(','));

  /*
   * ★★ (8회차 파일훑기) `본것` 집합이 **파일 전체**였다.
   *
   * 그 자리 주석은 「같은 이름이 여러 번 걸리는 규칙이 있다」 고 적어 두었다 —
   * 한 줄이 규칙 여럿에 걸리는 것을 막겠다는 말이다. 그건 바로 아래 `break` 가
   * 이미 한다. 실제로 이 집합이 한 일은 **둘째부터 조용히 지우기**였다:
   * 클래스가 둘인데 둘 다 `get()` 이면 뒤엣것이 사라지고, 되풀이되는 문서
   * 헤딩도 첫 것만 남는다. 뼈대는 「어디에 있나」 를 보는 것인데 그 자리가
   * 없어진다.
   */
  const 같은이름 = 뼈대뽑기([
    'class 앞 {',
    '  읽기() { return 1; }',
    '}',
    'class 뒤 {',
    '  읽기() { return 2; }',
    '}',
  ].join('\n'), '.js');
  check('★★ (8회차) 클래스가 달라도 같은 이름의 메서드가 둘 다 남는다',
    같은이름.항목.filter((x) => x.이름 === '읽기').length === 2,
    JSON.stringify(같은이름.항목.map((x) => `${x.줄}:${x.이름}`)));
  check('  둘째 것의 줄 번호가 제 자리다',
    같은이름.항목.filter((x) => x.이름 === '읽기').map((x) => x.줄).join(',') === '2,5',
    JSON.stringify(같은이름.항목.map((x) => `${x.줄}:${x.이름}`)));

  const 되풀이헤딩 = 뼈대뽑기('# 안내\n## 보기\n글\n## 딴것\n## 보기\n끝\n', '.md');
  check('★★ (8회차) 되풀이되는 문서 헤딩도 둘 다 남는다',
    되풀이헤딩.항목.filter((x) => x.이름.trim() === '보기').length === 2,
    JSON.stringify(되풀이헤딩.항목.map((x) => `${x.줄}:${x.이름.trim()}`)));
  check('  한 줄은 여전히 한 가지로만 센다',
    되풀이헤딩.항목.length === new Set(되풀이헤딩.항목.map((x) => x.줄)).size,
    JSON.stringify(되풀이헤딩.항목.map((x) => x.줄)));
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
  /*
   * 견본이 `<div><p>글</div>` 였다. 그건 **탈이 아니다** — HTML 은 `</p>` 생략을
   * 허락하고 브라우저도 그대로 그린다. 정말 닫아야 하는 것으로 바꿔 잰다.
   */
  check('html: 안 닫은 태그를 잡는다', html보기('<div><span>글</div>').length > 0,
    html보기('<div><span>글</div>').join(' / '));
  check('html: 멀쩡한 것은 안 건드린다', html보기('<div><p>글</p></div>').length === 0,
    html보기('<div><p>글</p></div>').join(' / '));
  check('html: img·br 은 안 닫아도 된다', html보기('<div><br><img src="x.png"></div>',
    { 있는파일: () => true }).length === 0);
  check('html: 스스로 닫은 태그도 안다', html보기('<div><hr /></div>').length === 0);
  check('html: script 안엣 부등호는 태그가 아니다',
    html보기('<div><script>if (a < b) {}</script></div>').length === 0,
    html보기('<div><script>if (a < b) {}</script></div>').join(' / '));
  check('html: 주석 안엣것도 태그가 아니다', html보기('<div><!-- <p> --></div>').length === 0);
  /*
   * ★ 거짓 탈 둘 (막판 훑기). 둘 다 `failed: true` 를 세워서 걸음이 거기서 안 끝나고,
   * 모델이 멀쩡한 줄을 고치러 간다 — html보기 머리말이 「확인 안 하는 것보다 나쁘다」
   * 고 적어 둔 그 자리다.
   *
   *   · HTML 이 **허락하는** 닫는 태그 생략을 전부 탈로 적었다. 같은 판의
   *     tools/webfetch.js 머리말은 그 꼴이 옛 사내 페이지에 정말로 있다고 적어 뒀다.
   *   · 자바스크립트 속의 `img.src = 'logo.svg'` 를 HTML 참조로 셌다. 이번 판에
   *     홑따옴표를 받기 시작하면서 훨씬 자주 걸린다.
   */
  for (const [무엇, 글] of [
    ['<li>', '<ul><li>하나<li>둘</ul>'],
    ['<p>', '<body><p>첫째<p>둘째</body>'],
    ['<td>·<tr>', '<table><tr><td>a<td>b</table>'],
    ['</body></html>', '<html><body><p>x'],
    ['<option>', '<select><option>가<option>나</select>'],
  ]) {
    check(`★★ html: 규격이 허락하는 ${무엇} 생략은 탈이 아니다`,
      html보기(글, { 있는파일: () => true }).length === 0,
      html보기(글, { 있는파일: () => true }).join(' / '));
  }
  check('★★ html: script 속 .src 대입은 참조가 아니다',
    html보기('<body><script>\nimg.src = "logo.svg";\nel.href = \'docs.html\';\nvar src = "x.png";\n</script></body>',
      { 있는파일: () => false }).length === 0,
    html보기('<body><script>img.src = "logo.svg";</script></body>', { 있는파일: () => false }).join(' / '));
  check('  (짝) script 태그의 src 는 그대로 참조다',
    html보기('<script src="지운.js"></script>', { 있는파일: () => false }).some((t) => /지운\.js/.test(t)));
  check('html: 없는 파일을 가리키면 잡는다',
    html보기('<link href="없다.css">', { 있는파일: () => false }).some((t) => /없다\.css/.test(t)));
  check('html: 바깥 주소는 못 보니 안 건드린다',
    html보기('<script src="https://x/y.js"></script>', { 있는파일: () => false }).length === 0);
  /*
   * 「없다」 와 「우리가 못 본다」 는 다르다.
   *
   * 여기가 참·거짓 둘뿐이던 동안, 못 짚은 참조가 전부 **없는 것**으로 적혔다.
   * 그리고 그 거짓 경보는 failed 를 참으로 세워서 모델을 멀쩡한 줄로 보냈다.
   */
  check('html: 못 짚은 참조(null)는 탈로 안 적는다',
    html보기('<script src="/static/app.js"></script>', { 있는파일: () => null }).length === 0,
    html보기('<script src="/static/app.js"></script>', { 있는파일: () => null }).join(' / '));
  check('html: 없다고 딱 잘라 말한 것(false)은 그대로 탈이다',
    html보기('<script src="/static/app.js"></script>', { 있는파일: () => false }).length === 1);

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

  /*
   * ★ 확인 한 번에 작업 폴더에 **파일이 생겼다** (막판 훑기).
   *
   * py_compile 은 원본 옆 `__pycache__/*.pyc` 에 바이트코드를 쓴다. 이 파일 머리말은
   * 「임의의 명령은 여기서 안 돌린다 … 그걸 돌리는 길은 Bash 하나여야 한다」 고 적어
   * 두었는데, 승인도 감사도 되돌리기도 없이 남의 저장소에 찌꺼기가 남고 git status 에 뜬다.
   * (`-B` 로는 안 막힌다 — py_compile 은 쓰는 것이 제 일이다. 자리를 옮겨야 한다.)
   */
  writeFileSync(join(터, '확인용.py'), 'def f():\n    return 1\n', 'utf8');
  const 파이 = await TOOLS.Verify.run({ paths: ['확인용.py'] }, vctx);
  if (/py_compile/.test(String(파이.content))) {
    check('★★ Verify 가 작업 폴더에 __pycache__ 를 안 남긴다',
      !readdirSync(터).includes('__pycache__'), readdirSync(터).join(' '));
  } else {
    check('(이 PC 에 파이썬이 없어 __pycache__ 자리는 못 쟀습니다)', true, String(파이.summary));
  }

  // 못 확인한 것을 반드시 말한다 — 이게 이 도구의 값을 지킨다.
  writeFileSync(join(터, '문서.hwp'), '아무거나', 'utf8');
  const v3 = await TOOLS.Verify.run({ paths: ['문서.hwp'] }, vctx);
  check('Verify: 확인 못 한 것을 못 했다고 말한다', /확인 못 한 것/.test(v3.content), v3.content.slice(0, 80));
  check('Verify: 됐다고 말하면 안 된다고 못 박는다', /됐다고 말하면 안 된다/.test(v3.content));

  // 없는 파일을 주면 그렇게 말한다
  const v4 = await TOOLS.Verify.run({ paths: ['없는것.js'] }, vctx);
  check('Verify: 없는 파일은 탈로 잡는다', /없는것\.js/.test(v4.content) && v4.failed === true);

  /*
   * ── 짚어 준 경로가 살림 파일이면 **그렇다고 말한다** ────────────────────
   *
   * 여기는 `continue` 한 줄이었다. 그래서 이름을 대서 시킨 경로가 살림
   * 자리면 된것·탈난것·못한것 어디에도 안 들어가고 그냥 사라졌다 —
   *
   *     Verify(paths: ['.deel/config.json'])
   *     → 확인할 수 있는 파일이 없었습니다
   *
   * 준 것은 하나인데 답은 「없다」 다. 안 읽는 것은 그대로 두되(열쇠가 든
   * 파일이다), 안 읽었다는 말은 해야 한다.
   */
  mkdirSync(join(터, '.deel'), { recursive: true });
  writeFileSync(join(터, '.deel', 'config.json'), '{"apiKey":"안-읽힐-것"}\n', 'utf8');
  const v5 = await TOOLS.Verify.run({ paths: ['.deel/config.json'] }, vctx);
  check('★ 살림 파일을 짚어 줘도 조용히 사라지지 않는다',
    /확인 못 한 것/.test(v5.content) && /config\.json/.test(v5.content), v5.content.slice(0, 100));
  check('★ 왜 안 봤는지까지 말해 준다', /열쇠가 들어 있어/.test(v5.content), v5.content.slice(0, 120));
  check('★ 셈에도 넣는다 — 0개라고 하지 않는다', v5.못확인 === 1 && v5.확인됨 === 0,
    JSON.stringify({ 확인됨: v5.확인됨, 못확인: v5.못확인, 탈: v5.탈 }));

  /*
   * ── 앞의 `/` 는 **문서 뿌리**다 ────────────────────────────────────────
   *
   * `src="/static/app.js"` 를 그 HTML 이 있는 폴더 기준으로 이어 붙이고는
   * 「그 파일이 없습니다」 라고 적었다. 멀쩡한 마크업인데 failed 가 참으로
   * 서고, 모델은 그 거짓 경보를 좇아 성한 줄을 고치기 시작한다.
   */
  mkdirSync(join(터, 'static'), { recursive: true });
  mkdirSync(join(터, 'pages'), { recursive: true });
  writeFileSync(join(터, 'static', 'app.js'), 'const a = 1;\n', 'utf8');
  writeFileSync(join(터, 'pages', '뿌리참조.html'),
    '<!doctype html>\n<html><body><script src="/static/app.js"></script></body></html>\n', 'utf8');
  const v6 = await TOOLS.Verify.run({ paths: ['pages/뿌리참조.html'] }, vctx);
  check('★ 뿌리 기준 참조를 「없는 파일」 로 잡지 않는다', v6.failed === false && !/탈난 것/.test(v6.content),
    v6.content.split('\n').slice(0, 3).join(' | '));
  check('★ 프로젝트 뿌리에서 찾아 내고 확인됨으로 센다', /✓[^\n]*뿌리참조\.html/.test(v6.content), v6.content.slice(0, 120));

  // 뿌리에도 없으면 「없다」 가 아니라 「못 봤다」 다 — 문서 뿌리가 딴 데일 수 있다.
  writeFileSync(join(터, 'pages', '모를참조.html'),
    '<!doctype html>\n<html><body><script src="/어딘가/app.js"></script></body></html>\n', 'utf8');
  const v7 = await TOOLS.Verify.run({ paths: ['pages/모를참조.html'] }, vctx);
  check('★ 뿌리에도 없으면 탈이 아니라 확인 못 한 것으로 적는다',
    v7.failed === false && /확인 못 한 것/.test(v7.content) && /문서 뿌리/.test(v7.content),
    v7.content.replace(/\n/g, ' | ').slice(0, 160));

  // 상대 경로는 전과 똑같이 잡아야 한다 — 느슨해지면 이 도구의 값이 없다.
  writeFileSync(join(터, 'pages', '상대참조.html'),
    '<!doctype html>\n<html><body><script src="없는것.js"></script></body></html>\n', 'utf8');
  const v8 = await TOOLS.Verify.run({ paths: ['pages/상대참조.html'] }, vctx);
  check('상대 경로로 없는 것을 가리키면 여전히 탈이다', v8.failed === true && /없는것\.js/.test(v8.content),
    v8.content.replace(/\n/g, ' | ').slice(0, 120));

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
  /*
   * ★ file_path 가 없는 항목을 `undefined` 로 적으면 안 된다.
   *
   * 실패 줄이 `✗ undefined — file_path 가 없습니다` 로 모델에게 나갔다.
   * 모델은 그 줄을 보고 「undefined 라는 파일이 있었나」 를 되짚고, 작은
   * 모델은 실제로 `undefined` 라는 이름으로 다시 보낸다. 여러군데고치기()
   * 는 같은 자리를 이미 「(경로 없음)」 으로 적는다 — 한 프로그램 안에서
   * 같은 실패가 두 모양으로 나가면 안 된다.
   */
  check('★ 경로 없는 항목을 undefined 로 적지 않는다', !/undefined/.test(r2.content), r2.content);
  check('★ 여러군데고치기와 같은 말을 쓴다',
    r2.여럿.some((x) => !x.ok && x.보인이름 === '(경로 없음)'),
    r2.여럿.map((x) => JSON.stringify(x.보인이름)).join(' '));
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

  /*
   * ★★ (8회차 판정) 사유가 제 셈과 어긋나 있었다.
   *
   * 사고율() 은 되풀이도 세는데(잘린인자×2 + 빈답×2 + 편집실패 + 되풀이), 내려 잡은
   * 까닭을 적는 자리는 **되풀이만 빼고** 셋을 적었다. 그래서 되풀이 세 번으로 '작음'
   * 으로 내려간 모델의 사유가 「사고가 잦았습니다 (인자 잘림 0 · 빈 답 0 · 편집 실패 0)」
   * 이 됐다 — 전부 0 이라고 적어 놓고 잦았다고 한다. 이 줄을 읽는 사람은 화면이
   * 고장 났다고 보거나, 더 나쁘게는 이 줄을 그 뒤로 안 읽는다.
   */
  const 되풀이만 = new 지켜본것();
  for (let i = 0; i < 3; i++) { 되풀이만.걸음셈(); 되풀이만.본것('되풀이'); }
  const g되 = 매김({ model: 'llama-70b' }, 되풀이만);
  check('먼저: 되풀이만으로도 작음으로 내려간다 (이 검사의 밑천)', g되.급 === '작음', `${g되.급} — ${g되.왜}`);
  check('★★ (8회차) 내려 잡은 사유에 되풀이도 적는다', /되풀이 3/.test(g되.왜), g되.왜);
  check('  0 인 것만 늘어놓아 「전부 0 인데 잦다」 가 되지 않는다',
    !/^(?=.*인자 잘림 0)(?=.*빈 답 0)(?=.*편집 실패 0)(?!.*되풀이)/.test(g되.왜), g되.왜);

  const 좋음 = new 지켜본것();
  for (let i = 0; i < 10; i++) { 좋음.걸음셈(); 좋음.본것('도구성공'); }
  const g2 = 매김({ model: 'qwen-7b' }, 좋음);
  check('7B 라도 사고 없이 돌면 한 단 올린다', g2.급 === '보통', `${g2.급} — ${g2.왜}`);

  // ★ (6회차 모델급6av-b GR1) 올리는 문턱은 사고 없는 여덟 걸음이다. 위 검사는 열 걸음만 봐서
  // 주석(「열 걸음」)과 코드(8) 가운데 어느 쪽도 못 박지 못했다. 사고율은 세 걸음부터 값이
  // 나오므로 일곱 걸음은 판단 보류가 아니라 문턱 아래다.
  const 걸음만 = (n) => { const x = new 지켜본것(); for (let i = 0; i < n; i++) { x.걸음셈(); x.본것('도구성공'); } return x; };
  const 일곱 = 매김({ model: 'qwen-7b' }, 걸음만(7));
  const 여덟 = 매김({ model: 'qwen-7b' }, 걸음만(8));
  check('★ (6회차 GR1) 사고 없는 일곱 걸음은 아직 안 올린다', 걸음만(7).사고율() === 0 && 일곱.급 === '작음', `${일곱.급} — ${일곱.왜}`);
  check('★ (6회차 GR1) 사고 없는 여덟 걸음이면 한 단 올린다', 여덟.급 === '보통', `${여덟.급} — ${여덟.왜}`);

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

  /*
   * ── 자르기는 **늘 문장째로 끝난다** ────────────────────────────────────
   *
   * 눈붙이기() 가 「줄이기가 문장 한복판을 자르므로 마지막 글자가 정해져 있지
   * 않다」 고 적어 두고 있었는데, 실제로는 문장 단위로만 자른다. 그 말을 믿고
   * 「어차피 한복판이니 아무 글자나 붙여도 된다」 고 고치면 말이 끊긴 채 모델에게
   * 간다. 여기서 못 박아 둔다 — 어느 창 크기에서든 문장 끝으로 끝난다.
   *
   * 가르개에서 `다\.` 갈래를 뺀 것도 이 검사가 받친다. 도구 설명은 죄다
   * 「…한다.」 로 끝나므로, 마침표만 봐도 같은 자리에서 갈린다.
   */
  {
    const 끝 = [];
    let 잘린판 = 0;
    for (const [이름, t] of Object.entries(TOOLS)) {
      const 온것 = String(t.schema.description ?? '');
      for (const 한도 of [40, 60, 90, 150, 300, 600]) {
        const 글 = String(설명줄이기(t.schema, 한도).description ?? '');
        if (!글 || 글 === 온것) continue;   // 안 잘린 것은 잴 것이 없다
        잘린판++;
        if (!/[.!?]$/.test(글.trim())) 끝.push(`${이름}@${한도}: …${글.trim().slice(-24)}`);
      }
    }
    check('준비: 실제로 잘리는 판이 있다', 잘린판 > 0, `${잘린판}판`);
    check('★ 잘린 설명은 늘 문장 끝으로 끝난다 (한복판에서 안 끊긴다)', 끝.length === 0,
      끝.slice(0, 3).join(' | '));
  }
  {
    const 셋 = { name: 'x', description: '첫 문장이다. 둘째 문장이다. 셋째 문장이다.' };
    check('★ 한국어 「…다.」 도 그 자리에서 갈린다',
      설명줄이기(셋, 20).description === '첫 문장이다. 둘째 문장이다.',
      설명줄이기(셋, 20).description);
    check('  더 좁히면 한 문장만 남는다', 설명줄이기(셋, 10).description === '첫 문장이다.',
      설명줄이기(셋, 10).description);
  }

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

/*
 * ═══ Verify 가 저장소가 심어 둔 프로그램을 돌리지 않는다 (사냥5 H1) ═════════
 *
 * `node --check "<파일>"` 을 **셸로** 돌렸다. 윈도우 cmd.exe 는 PATH 보다 지금 폴더를 먼저
 * 찾으므로, 저장소 뿌리에 `node.cmd` 가 있으면 그게 돌았다 — 승인도 없이, strict 모드에서도,
 * 걸러지지 않은 환경(열쇠째)으로. 유닉스에서는 /bin/sh 라 파일 이름의 `$(…)` 가 풀렸다.
 * Verify 머리말이 스스로 못 박은 「임의의 명령은 여기서 안 돌린다」 가 그 자리에서 깨졌다.
 */
{
  const 터 = mkdtempSync(join(tmpdir(), 'deel-verify-hijack-'));
  const 밖 = mkdtempSync(join(tmpdir(), 'deel-verify-preload-'));
  const vctx = { scope: makeScope(터), history: new History(터), audit: new Audit(터), seen: new Set(), 모델컨텍스트: 32768 };
  const 자국 = join(터, 'PWNED.txt');
  writeFileSync(join(터, 'a.js'), 'console.log(1)\n', 'utf8');
  writeFileSync(join(터, 'b.py'), 'x = 1\n', 'utf8');
  const 윈 = process.platform === 'win32';
  if (윈) {
    const 가짜 = ['@echo off', 'echo HIJACKED>> "%~dp0PWNED.txt"', 'exit /b 0'].join(String.fromCharCode(13, 10));
    for (const 이름 of ['node.cmd', 'node.bat', 'python.cmd', 'python.bat', 'python3.cmd']) writeFileSync(join(터, 이름), 가짜, 'utf8');
  } else {
    writeFileSync(join(터, 'x$(touch PWNED.txt).js'), 'console.log(1)\n', 'utf8');
  }
  // 새는지: 자식 node 가 먼저 읽을 preload 가 GITHUB_TOKEN 이 보이는지 적는다 (값은 가짜).
  const 샌곳 = join(밖, 'leak.txt');
  const 미리 = join(밖, 'preload.cjs');
  writeFileSync(미리, `require('fs').appendFileSync(${JSON.stringify(샌곳)}, (process.env.GITHUB_TOKEN ? 'TOKEN_SEEN' : 'no-token') + ' ');\n`, 'utf8');
  const 옛 = { ...process.env };
  // 이 세션의 호스트가 켜 둔 값이다 — 보통 PC 에는 없고, 있으면 cmd 가 지금 폴더를 안 찾아 탈이 가려진다.
  for (const k of Object.keys(process.env)) if (k.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete process.env[k];
  process.env.GITHUB_TOKEN = 'ghp_검사용가짜값0123456789';
  const 빈칸없음 = !/\s/.test(미리);
  if (빈칸없음) process.env.NODE_OPTIONS = `--require ${미리.replace(/\\/g, '/')}`;
  let v1; let v2;
  try {
    v1 = await TOOLS.Verify.run({ paths: ['a.js', 'b.py'] }, vctx);
    v2 = await TOOLS.Verify.run({}, vctx);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in 옛)) delete process.env[k];
    Object.assign(process.env, 옛);
  }
  const 자국글 = (() => { try { return readFileSync(자국, 'utf8'); } catch { return ''; } })();
  check('★ Verify 가 저장소에 심은 node.cmd·python.cmd(윈도우)·$(…) 이름(유닉스)을 돌리지 않는다',
    자국글 === '', JSON.stringify(자국글));
  check('★ 그러고도 JS 는 진짜로 확인한다', /✓[^\n]*a\.js/.test(v1?.content ?? '') && /✓[^\n]*a\.js/.test(v2?.content ?? ''),
    String(v1?.content ?? '').slice(0, 120));
  if (빈칸없음) {
    const 샌글 = (() => { try { return readFileSync(샌곳, 'utf8'); } catch { return ''; } })();
    check('★ Verify 가 띄운 node 는 열쇠꼴 환경변수를 못 본다 (걸러진 환경)',
      /no-token/.test(샌글) && !/TOKEN_SEEN/.test(샌글), JSON.stringify(샌글) || '(preload 가 한 번도 안 돌았다)');
  }
  rmSync(터, { recursive: true, force: true });
  rmSync(밖, { recursive: true, force: true });
}

/*
 * 2.0.0 6회차 · Gemini 검증6 — 도구 길로 돌려 가린 것들.
 *
 *   깨진 JS 의 오류 글(원문 한 줄이 따라 나온다)에 `was not found` 가 들어 있으면 「도구가 없다」
 *   로 적고 failed:false — 깨진 파일이 통과로 넘어갔다.
 *   paths 로 폴더를 주면 상한 40 도 확장자 거름도 없이 다 봤다. 기본 훑기는 .scss·.less 를 안 골랐다.
 *   CSS 문자열 속 `{` · HTML 주석 속 src · `%20` 든 경로를 탈로 적었다 — 멀쩡한 파일을 모델이 고치러 간다.
 *   `../` 로 작업 폴더 밖을 가리키면 있을 때는 조용, 없을 때는 「없습니다」 — 울타리 밖 있음/없음이 샜다.
 */
{
  const { VERIFY_TOOL } = await import('../src/tools/verify.js');
  const 터 = mkdtempSync(join(tmpdir(), 'deel-verify6-'));
  const 일 = join(터, 'work');
  mkdirSync(일);
  const v6 = { scope: makeScope(일), history: new History(일), audit: new Audit(일), seen: new Set(), 모델컨텍스트: 32768 };
  try {
    writeFileSync(join(일, '깨짐.js'), 'const a = "was not found" +;\n');
    const 깨짐 = await VERIFY_TOOL.run({ paths: ['깨짐.js'] }, v6);
    check('★★ 문법 오류 글에 「was not found」 가 들어 있어도 탈로 잡는다 (6회차 검증6 VB4)', 깨짐.failed === true && 깨짐.탈 === 1, 깨짐.content);

    const 폴더 = join(일, 'many');
    mkdirSync(폴더);
    for (let i = 0; i < 45; i++) writeFileSync(join(폴더, `f${i}.json`), '{}');
    for (let i = 0; i < 3; i++) writeFileSync(join(폴더, `p${i}.png`), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    const 많 = await VERIFY_TOOL.run({ paths: ['many'] }, v6);
    check('★ paths 로 준 폴더도 한 번에 보는 수 상한을 지키고 넘친 것을 말한다 (6회차 검증6 VB3)', 많.확인됨 === 40 && /그 밖의 5개/.test(많.content), `${많.확인됨} ${많.content.slice(-200)}`);
    check('  폴더 속 확인 못 하는 종류(png)는 「못 확인」 으로 쏟아내지 않는다', !/p0\.png/.test(많.content), 많.content.slice(-300));

    const 기본터 = join(터, 'scss');
    mkdirSync(기본터);
    writeFileSync(join(기본터, 'a.scss'), '.a { color: red;\n');
    const 기본 = await VERIFY_TOOL.run({}, { ...v6, scope: makeScope(기본터) });
    check('★ 기본 훑기도 .scss 를 고른다 (6회차 검증6 VB2)', 기본.failed === true && /a\.scss/.test(기본.content), 기본.content);

    check('★ CSS 문자열 속 중괄호는 안 센다 (6회차 검증6 VA1)', css보기('.a::before { content: "{"; } .b::after { content: \'{\'; }').length === 0,
      JSON.stringify(css보기('.a::before { content: "{"; } .b::after { content: \'{\'; }')));
    check('  문자열 밖에서 안 닫은 중괄호는 여전히 잡는다', css보기('.a { content: "}";').length === 1, JSON.stringify(css보기('.a { content: "}";')));
    check('★ 주석 속 src 는 없는 파일로 안 적는다 (6회차 검증6 VA3)',
      html보기('<p>a</p><!-- <script src="gone.js"></script> -->', { 있는파일: () => false }).length === 0);
    check('★ %20 든 경로는 풀어서 찾는다 (6회차 검증6 VA5)',
      html보기('<img src="my%20photo.png">', { 있는파일: (p) => p === 'my photo.png' }).length === 0);
    check('  못 푸는 % 는 적힌 그대로 찾는다', html보기('<img src="100%.png">', { 있는파일: (p) => p === '100%.png' }).length === 0);

    writeFileSync(join(터, '밖에있음.txt'), 'x');
    writeFileSync(join(일, '밖.html'), '<p><img src="../밖에있음.txt"><img src="../밖에없음.txt"></p>');
    const 밖6 = await VERIFY_TOOL.run({ paths: ['밖.html'] }, v6);
    check('★ 작업 폴더 밖을 가리키는 참조는 있는지 없는지 안 알려 준다 (6회차 검증6 VA4)',
      밖6.탈 === 0 && 밖6.content.includes('밖에있음') === 밖6.content.includes('밖에없음'), 밖6.content);
  } finally {
    rmSync(터, { recursive: true, force: true });
  }
}

/*
 * 2.0.0 8회차 확인 — 참조 찾기가 **놓친 것**과 **없는 것을 있다고 한 것**.
 *
 * 참조 정규식은 큰따옴표에 소문자에 낱말 경계도 없었다. 그래서 `src='logo.png'` 와
 * `<IMG SRC="logo.png">` 는 아예 안 봤고(놓침), `data-src="avatar.png"` 는 참조로 세어
 * 「그 파일이 없습니다」 를 적었다(거짓 탈). `javascript:` 도 바깥 것으로 안 빼 같은 꼴로
 * 났고, `<a href=/>` 의 따옴표 없는 `/` 는 self-closing 으로 봐 여는 태그를 잃었다.
 *
 * **거짓 탈도 결함이다** — 멀쩡한 줄을 모델이 고치러 간다. 그러니 놓친 쪽과 거짓 탈 쪽을
 * 한 자리에서 같이 못 박는다. 한쪽만 재면 다음에 한쪽으로 기운다.
 */
{
  const 없다 = { 있는파일: () => false };
  const 다있다 = { 있는파일: () => true };
  const 봤나 = (글, 옵션 = 없다) => html보기(글, 옵션);

  // 놓친 쪽 — 진짜 참조는 여전히 잡는다.
  check('★ 작은따옴표로 적은 src 도 본다 (8회차 확인)',
    봤나("<img src='logo.png'>").some((t) => /logo\.png/.test(t)), JSON.stringify(봤나("<img src='logo.png'>")));
  check('★ 대문자 속성도 본다 (8회차 확인)',
    봤나('<IMG SRC="logo.png">').some((t) => /logo\.png/.test(t)), JSON.stringify(봤나('<IMG SRC="logo.png">')));
  check('  작은따옴표 href 도 본다', 봤나("<link href='a.css'>").length === 1, JSON.stringify(봤나("<link href='a.css'>")));

  // 거짓 탈 쪽 — 참조가 아닌 것을 참조로 안 센다.
  check('★ javascript: 는 바깥 것이라 안 본다 (8회차 확인)',
    봤나('<a href="javascript:void(0)">x</a>').length === 0, JSON.stringify(봤나('<a href="javascript:void(0)">x</a>')));
  check('★ data-src 는 참조로 안 센다 (8회차 확인)',
    봤나('<img data-src="avatar.png">').length === 0, JSON.stringify(봤나('<img data-src="avatar.png">')));
  check('  data-src 를 뺐다고 같은 줄의 진짜 src 까지 놓치지는 않는다',
    봤나('<img data-src="avatar.png" src="없다.png">').length === 1,
    JSON.stringify(봤나('<img data-src="avatar.png" src="없다.png">')));
  check('★ <a href=/> 의 슬래시는 self-closing 이 아니다 (8회차 확인)',
    봤나('<a href=/>글</a>', 다있다).length === 0, JSON.stringify(봤나('<a href=/>글</a>', 다있다)));
  check('  진짜 self-closing 은 여전히 스스로 닫은 것으로 본다',
    봤나('<div><hr /><br/><img src="x.png"/></div>', 다있다).length === 0,
    JSON.stringify(봤나('<div><hr /><br/><img src="x.png"/></div>', 다있다)));
  check('  따옴표 없는 속성값 끝의 슬래시로는 여는 태그를 안 버린다',
    봤나('<div class=box/>글', 다있다).some((t) => /<div>/.test(t)), JSON.stringify(봤나('<div class=box/>글', 다있다)));
}

/*
 * 2.0.0 8회차 확인 — **셈이 서로 안 맞던** 자리.
 *
 * 참조를 못 짚은 html 은 「확인 못 한 것」 에 올라가고도 「읽어서 확인」 으로 한 번 더
 * 올라갔다. 한 파일이 된것·못한것 **양쪽에** 섰으니 요약 숫자의 합이 실제 본 파일 수보다
 * 컸고, 사람은 「확인됨」 을 보고 넘어갔다. 요약 쪽도 둘이 어긋났다 — 탈이 하나라도 있으면
 * 「못 확인」 을 통째로 뺐고(481-484 머리말이 「반드시 적는다」 고 해 둔 그 자리),
 * 확인된 것이 0개일 때도 「확인 0개」 를 적었다.
 */
{
  const { VERIFY_TOOL: 확인도구 } = await import('../src/tools/verify.js');
  const 셈터 = mkdtempSync(join(tmpdir(), 'deel-verify8-'));
  const 셈일 = join(셈터, 'work');
  mkdirSync(셈일);
  const v8 = { scope: makeScope(셈일), history: new History(셈일), audit: new Audit(셈일), seen: new Set(), 모델컨텍스트: 32768 };
  const 셈 = (r) => r.확인됨 + r.탈 + r.못확인;
  try {
    writeFileSync(join(셈일, '못짚음.html'), '<p><script src="/static/app.js"></script></p>');
    const 한쪽 = await 확인도구.run({ paths: ['못짚음.html'] }, v8);
    check('★ 참조를 못 짚은 파일이 된것·못한것 양쪽에 오르지 않는다 (8회차 확인)',
      한쪽.확인됨 === 0 && 한쪽.못확인 === 1 && !/✓ 못짚음\.html/.test(한쪽.content), 한쪽.content);
    check('  셈의 합이 실제로 본 파일 수와 같다', 셈(한쪽) === 1, JSON.stringify(한쪽.summary));
    check('★ 확인된 것이 0개면 요약에 「확인 0개」 를 안 적는다 (8회차 확인)',
      !/(^|· )확인 0개/.test(한쪽.summary), 한쪽.summary);

    // 견본은 **정말로 탈이 나야** 한다. `<div><p>글</div>` 는 규격이 `</p>` 생략을
    // 허락해서 이제 탈이 아니고, 그러면 아래 「탈이 있어도」 줄이 탈 0개를 재게 된다.
    writeFileSync(join(셈일, '탈남.html'), '<div><span>글</div>');
    const 섞임 = await 확인도구.run({ paths: ['못짚음.html', '탈남.html'] }, v8);
    check('★ 탈난 것이 있어도 요약에서 「확인 못 한 것」 을 빼지 않는다 (8회차 확인)',
      섞임.탈 === 1 && /못 확인 1개/.test(섞임.summary), `탈 ${섞임.탈} · ${섞임.summary}`);
    check('  섞여 있어도 셈의 합이 본 파일 수와 같다', 셈(섞임) === 2,
      `${섞임.확인됨}+${섞임.탈}+${섞임.못확인} · ${섞임.summary}`);
    check('  요약에 적은 수가 본문 목록의 수와 맞는다',
      섞임.탈 === (섞임.content.match(/^ {2}✗ /gm) ?? []).length
      && 섞임.못확인 === (섞임.content.match(/^ {2}\? /gm) ?? []).length
      && 섞임.확인됨 === (섞임.content.match(/^ {2}✓ /gm) ?? []).length, 섞임.content);
  } finally {
    rmSync(셈터, { recursive: true, force: true });
  }
}

rmSync(root, { recursive: true, force: true });

const G ='\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n뼈대·확인·모델 급 검사  ' + D + '(작은 모델에서도 되는가)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  통과 ${pass.length} · 실패 ${fail.length}\n`);
process.exitCode = fail.length ? 1 : 0;
