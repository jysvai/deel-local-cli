// 이 프로젝트의 확인 방법을 **전부** 찾나.
//
// ── 왜 이 검사가 생겼나 ─────────────────────────────────────────────────
//
// 벤치마크에서 진 자리다(docs/ko/benchmark.md). 같은 프로젝트에 같은 일을
// 시킨 비교에서 품질은 거의 동급이었는데 **전체 회귀 범위**만 낮았다.
//
// 까닭은 단순했다. 그 프로젝트의 검사는 `scripts/` 밑의 독립 실행 파일 셋
// (`qa-collaboration.js` · `qa-presets.js` · `qa-design-studio.js`)이었는데,
// 우리는 `package.json` 의 `test` 한 칸만 보고 있었다. 못 본 검사는 안 돌고,
// 안 돈 검사는 회귀를 못 잡는다.
//
// ── 여기서 제일 조심할 것 ───────────────────────────────────────────────
//
// **없는 것을 지어내면 안 된다.** 있을 법한 이름을 채워 주면 모델이 그걸
// 부르고, 실패를 받고, 또 부른다 — 걸음만 태우고 사람은 왜 헤매는지 모른다.
// 그래서 3·4번(안 담는 쪽)이 이 파일의 알맹이다.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 확인법들, 최대 } from '../src/tools/확인법.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 뿌리들 = [];
function 판(짓기) {
  const 뿌리 = mkdtempSync(join(tmpdir(), 'deel-확인법-'));
  뿌리들.push(뿌리);
  짓기({
    파일: (이름, 글) => {
      const 곳 = join(뿌리, 이름);
      mkdirSync(join(곳, '..'), { recursive: true });
      writeFileSync(곳, 글, 'utf8');
    },
    pkg: (o) => writeFileSync(join(뿌리, 'package.json'), JSON.stringify(o), 'utf8'),
  });
  return 뿌리;
}
const 명령들 = (뿌리) => 확인법들(뿌리).map((x) => x.명령);

// ── 1. 벤치마크에서 놓친 그 모양 ────────────────────────────────────────
trace('1-독립검사파일');
{
  /*
   * npm 스크립트로 등록되지 않은 채 node 로 직접 도는 검사들. 이걸 못 찾아서
   * 회귀 범위가 좁았다.
   */
  const 뿌리 = 판(({ 파일 }) => {
    파일('scripts/qa-collaboration.js', '// 검사');
    파일('scripts/qa-presets.js', '// 검사');
    파일('scripts/qa-design-studio.js', '// 검사');
    파일('collab-server.js', '// 서버');
  });
  const 것 = 명령들(뿌리);

  check('★★★ scripts/ 밑 독립 검사 셋을 다 찾는다 (벤치마크에서 놓친 자리)',
    것.length === 3, JSON.stringify(것));
  check('★★ node 로 부르는 법까지 적어 준다',
    것.includes('node scripts/qa-collaboration.js'), JSON.stringify(것));
  check('★★★ 검사 아닌 파일은 안 담는다', !것.some((c) => c.includes('collab-server')), JSON.stringify(것));
}

// ── 2. package.json 의 확인 칸을 넓게 본다 ──────────────────────────────
trace('2-npm스크립트');
{
  const 뿌리 = 판(({ pkg }) => pkg({
    scripts: { test: 'x', lint: 'x', typecheck: 'x', 'test:e2e': 'x', build: 'x', dev: 'x', start: 'x' },
  }));
  const 것 = 명령들(뿌리);

  check('★★ test 는 npm test 로 부른다', 것.includes('npm test'), JSON.stringify(것));
  check('★★ 나머지는 npm run 을 붙인다', 것.includes('npm run lint'), JSON.stringify(것));
  check('★★ 형 검사·e2e 도 확인으로 센다',
    것.includes('npm run typecheck') && 것.includes('npm run test:e2e'), JSON.stringify(것));
  check('★★★ dev·start 는 확인이 아니라 안 담는다',
    !것.some((c) => c.includes('dev') || c.includes('start')), JSON.stringify(것));
  // build 는 확인은 아니지만 깨지면 아무것도 안 되므로 **맨 뒤**에 붙인다.
  check('★ build 는 담되 맨 뒤로 민다', 것[것.length - 1] === 'npm run build', JSON.stringify(것));
}

// ── 3. 없는 것은 지어내지 않는다 ────────────────────────────────────────
trace('3-안지어냄');
{
  const 빈곳 = 판(() => {});
  check('★★★ 아무것도 없으면 빈 목록이다', 확인법들(빈곳).length === 0, JSON.stringify(명령들(빈곳)));

  const 스크립트없음 = 판(({ pkg }) => pkg({ name: 'x', version: '1.0.0' }));
  check('★★★ scripts 가 없는 package.json 에 npm test 를 지어내지 않는다',
    확인법들(스크립트없음).length === 0, JSON.stringify(명령들(스크립트없음)));

  const 망가진 = 판(({ 파일 }) => 파일('package.json', '{ 이건 JSON 이 아니다'));
  check('★★ 망가진 package.json 에도 안 죽는다', Array.isArray(확인법들(망가진)), '');

  /*
   * Makefile 은 `test:` 칸이 **진짜로 있을 때만**. 있을 법하다고 넣으면
   * `make test` 가 없는 저장소에서 모델이 그걸 부르고 실패한다.
   */
  const make없음 = 판(({ 파일 }) => 파일('Makefile', 'build:\n\tcc a.c\n'));
  check('★★★ Makefile 에 test 칸이 없으면 make test 를 안 담는다',
    !명령들(make없음).includes('make test'), JSON.stringify(명령들(make없음)));

  const make있음 = 판(({ 파일 }) => 파일('Makefile', 'build:\n\tcc a.c\ntest:\n\t./run\n'));
  check('★★ test 칸이 있으면 담는다', 명령들(make있음).includes('make test'), JSON.stringify(명령들(make있음)));
}

// ── 4. 다른 생태계도 표식이 있을 때만 ───────────────────────────────────
trace('4-생태계');
{
  const rust = 판(({ 파일 }) => 파일('Cargo.toml', '[package]\nname="x"\n'));
  check('★★ Cargo.toml 이 있으면 cargo test', 명령들(rust).includes('cargo test'), JSON.stringify(명령들(rust)));

  const go = 판(({ 파일 }) => 파일('go.mod', 'module x\n'));
  check('★★ go.mod 가 있으면 go test', 명령들(go).includes('go test ./...'), JSON.stringify(명령들(go)));

  const py = 판(({ 파일 }) => 파일('pytest.ini', '[pytest]\n'));
  check('★★ pytest 설정이 있으면 pytest', 명령들(py).includes('pytest'), JSON.stringify(명령들(py)));

  /*
   * 파이썬 프로젝트인데 검사 폴더가 없으면 pytest 를 안 담는다. 파이썬이라는
   * 것과 검사가 있다는 것은 다른 이야기다.
   */
  const py검사없음 = 판(({ 파일 }) => 파일('pyproject.toml', '[project]\nname="x"\n'));
  check('★★★ tests/ 가 없는 파이썬 프로젝트에 pytest 를 지어내지 않는다',
    !명령들(py검사없음).includes('pytest'), JSON.stringify(명령들(py검사없음)));
}

// ── 5. 목록이 소음이 되지 않게 ──────────────────────────────────────────
trace('5-상한');
{
  const 많음 = 판(({ 파일 }) => {
    for (let i = 0; i < 30; i++) 파일(`scripts/qa-${i}.js`, '// 검사');
  });
  const 것 = 확인법들(많음);
  check('★★ 스무 개를 늘어놓지 않는다 — 상한이 있다', 것.length === 최대, String(것.length));
  check('★ 중복은 한 번만 담는다',
    new Set(것.map((x) => x.명령)).size === 것.length, String(것.length));
}

// ── 6. 어디서 찾았는지 같이 준다 ────────────────────────────────────────
trace('6-출처');
{
  const 뿌리 = 판(({ 파일, pkg }) => {
    pkg({ scripts: { test: 'x' } });
    파일('scripts/qa-a.js', '// 검사');
  });
  const 것 = 확인법들(뿌리);
  check('★★ 출처를 적어 준다 — 사람이 목록을 믿을 수 있어야 한다',
    것.every((x) => !!x.어디서), JSON.stringify(것));
  check('★ npm 것과 파일 것이 같이 나온다', 것.length === 2, JSON.stringify(것.map((x) => x.명령)));
}


// ── 8. 이름이 뒤에 붙는 것도 검사다 ──────────────────────────
//
// 벤치마크 지시문을 빈 폴더에 그대로 넣고 재 보다 걸렸다.
//
//     test/approval.test.js · test/roles.test.js 가 있고
//     package.json 에 test 칸은 없는 프로젝트  →  찾은 것 **0개**
//
// 무달가 `^(qa|test|…)[-_.]` 로 **앞머리만** 봤다. 그래서
// `test-approval.mjs` 는 찾고 `approval.test.js` 는 못 찾는다. 그런데
// 자바스크립트 쪽에서 흔한 것은 **뒤에 붙는 쪽**이다 — Jest · Vitest ·
// node:test 가 전부 `*.test.js` · `*.spec.ts` 를 기본값으로 쓴다.
// deel 자기 저장소도 `test/guard.test.js` 꼴이다.
//
// 이 파일 머리말에 적은 그대로다 — 못 본 검사는 안 돌고, 안 돌 검사는
// 회귀를 못 잡는다. 범위를 넓히되 **검사라고 적힌 것만** 담는다.
trace('8-뒤에붙는이름');
{
  const 뿌리 = 판(({ 파일, pkg }) => {
    pkg({ name: 'wr', scripts: { dev: 'node server.js', start: 'node server.js' } });
    파일('test/approval.test.js', '// ...');
    파일('test/roles.test.js', '// ...');
  });
  const 것 = 확인법들(뿌리).map((x) => x.명령);
  check('★★★ approval.test.js 같은 뒤에 붙는 이름도 찾는다',
    것.length === 2 && 것.every((c) => /^node test\//.test(c)), JSON.stringify(것));

  // .spec 도 같은 관례다.
  const 뿌리2 = 판(({ 파일 }) => {
    파일('tests/roles.spec.ts', '// ...');
    파일('tests/audit.spec.js', '// ...');
  });
  check('★★ .spec 꼴도 찾는다',
    확인법들(뿌리2).length === 2, JSON.stringify(확인법들(뿌리2).map((x) => x.명령)));

  // 망가진 package.json 에서도 파일 쪽은 살아야 한다.
  // 확인법.js 의 catch 주석이 실제로 약속하는 것이 이것이다.
  const 뿌리3 = 판(({ 파일 }) => {
    파일('package.json', '{ this is not json');
    파일('test/approval.test.js', '// ...');
  });
  check('★★★ package.json 이 망가져도 파일 검사는 찾는다',
    확인법들(뿌리3).length === 1, JSON.stringify(확인법들(뿌리3).map((x) => x.명령)));

  /*
   * 반대쪽 — 넓히면 아무 소스 파일이나 다 검사가 된다.
   * 없는 것을 지어내는 것이 이 파일이 제일 경계하는 일이다.
   */
  const 뿌리4 = 판(({ 파일 }) => {
    파일('scripts/deploy.mjs', '// ...');
    파일('scripts/latest.js', '// ...');
    파일('test/helpers.js', '// ...');
    파일('test/fixtures.js', '// ...');
  });
  check('★★★ 검사라고 안 적힌 파일은 그대로 안 담는다',
    확인법들(뿌리4).length === 0, JSON.stringify(확인법들(뿌리4).map((x) => x.명령)));
}

// ── 9. 뒤에 붙는 이름은 **검사 파일 관례**만 본다 ───────────────────────
//
// 8번을 넣고 2차 리뷰를 돌렸더니 세 가지가 나왔고, 돌려 보니 다 맞았다.
//
//   ① `test/test.js` · `test/spec.js` 를 못 찾는다
//      무늬가 양쪽 갈래 모두 「구분자 + 뒤에 뭔가」 를 요구해서, 이름이
//      낱말 하나뿐인 파일은 어느 갈래에도 안 걸린다.
//
//   ② `type-check.js` · `health-check.js` · `api-spec.ts` 를 검사로 오인한다
//      뒤에 붙는 갈래를 검사말 전부로 열어 둔 탓이다. 그런데 **앞에 붙는
//      것과 뒤에 붙는 것은 서로 다른 관례**다 —
//        앞: 스크립트 이름   `qa-roles.mjs` · `test-approval.mjs` · `check-src.mjs`
//        뒤: 검사 파일 이름  `approval.test.js` · `roles.spec.ts` · `handler_test.js`
//      뒤쪽 관례에 check·verify·e2e·bench 는 없다. 그리고 붙임표로 이은
//      `api-spec` 은 낱말 합성이지 검사 파일이 아니다 — 점·밑줄만 본다.
//
//   ③ 무늬에 `tsx` 를 넣었는데 부르는법에는 없다
//      명령이 깨지지는 않는다(부르는법에 없으면 건너뛴다). 대신 **아무
//      데도 안 닿는 갈래**가 무늬에 남는다. 두 목록을 맞춰 둔다.
trace('9-뒤에붙는관례');
{
  const 찾아야 = [
    ['test/test.js', 'node test/test.js'],
    ['test/spec.js', 'node test/spec.js'],
    ['test/approval.test.js', 'node test/approval.test.js'],
    ['test/roles.spec.ts', 'node test/roles.spec.ts'],
    ['test/handler_test.js', 'node test/handler_test.js'],
    // 밑줄로 이은 `spec` 도 뒤에 붙는 관례다(루비·파이썬 쪽). 붙임표로 이은
    // `api-spec` 과 헷갈리기 쉬워서, 둘을 나란히 재 둔다.
    ['test/api_spec.mjs', 'node test/api_spec.mjs'],
    // 앞쪽 관례도 밑줄로 잇는다 — 주석에는 그렇게 적어 놓고 붙임표만 재고
    // 있었다(5차 리뷰). `[-_]` 를 `[-]` 로 좁혀도 안 빨개졌다.
    ['scripts/test_helpers.py', 'python scripts/test_helpers.py'],
    ['scripts/qa_roles.mjs', 'node scripts/qa_roles.mjs'],
    // 앞쪽 검사말도 복수형을 받는다.
    ['scripts/specs-roles.mjs', 'node scripts/specs-roles.mjs'],
  ];
  for (const [이름, 나와야] of 찾아야) {
    const 뿌리 = 판(({ 파일 }) => { 파일(이름, '// ...'); });
    const 것 = 확인법들(뿌리).map((x) => x.명령);
    check(`★★★ 찾는다 — ${이름}`, 것.includes(나와야), JSON.stringify(것));
  }

  const 안찾아야 = [
    'scripts/type-check.js',
    'scripts/health-check.js',
    'scripts/api-spec.ts',
    'scripts/build-verify.js',
    'test/latest.js',
    'test/contest.js',
    /*
     * 3차 리뷰가 짚었다 — 단독 이름 갈래에 검사말 전부를 넣어서
     * `scripts/check.js` · `bench.js` · `verify.js` · `e2e.js` 가 검사로
     * 잡혔다. 주석에는 「test.js·spec.js 만 담는다」 고 적어 놓고서다.
     * 단독으로 쓰이는 검사 파일 이름은 test·spec 이지, check·bench 가
     * 아니다 — 그건 앞에 붙는 스크립트 이름 쪽 낱말이다.
     */
    'scripts/check.js',
    'scripts/bench.js',
    'scripts/verify.js',
    'scripts/e2e.js',
    'scripts/qa.js',
    /*
     * 4차 리뷰가 짚었다 — 앞에 붙는 갈래의 구분자에 **점**이 들어 있어서,
     * 검사말로 시작하는 온갖 살림 파일이 검사로 잡혔다.
     *
     *     check.config.js · test.min.js · qa.bundle.js · spec.d.ts
     *
     * 앞쪽 관례는 스크립트 이름이고, 스크립트 이름은 `qa-roles.mjs` ·
     * `test_helpers.py` 처럼 붙임표·밑줄로 잇는다. 점으로 이으면 그건
     * 이름이 아니라 **설정·번들 꼬리표**다. 그래서 점을 뺀다.
     */
    'scripts/check.config.js',
    'scripts/test.min.js',
    'scripts/qa.bundle.js',
    'test/spec.d.ts',
    'scripts/verify.config.mjs',
    /*
     * `.+` 가 점까지 삼켜서, 앞쪽 관례 뒤에 설정·번들 꼬리표가 붙어도
     * 그대로 검사로 잡혔다(5차 리뷰). 점을 뺀 것은 **구분자 자리**였지
     * 뒤에 오는 마디가 아니었다.
     */
    'scripts/qa-roles.d.ts',
    'scripts/test-helper.bundle.js',
    'scripts/check_util.min.js',
    /*
     * `tsx` 는 애초에 검사끝에 없어서 무늬를 되돌려도 안 빨개진다 — 4차
     * 리뷰가 그걸 짚었는데 검사는 그대로 뒀다(5차 리뷰가 다시 짚었다).
     * 지운다. 무늬와 부르는법이 어긋나는지는 이 파일 끝에서 따로 잰다.
     */
  ];
  for (const 이름 of 안찾아야) {
    const 뿌리 = 판(({ 파일 }) => { 파일(이름, '// ...'); });
    const 것 = 확인법들(뿌리).map((x) => x.명령);
    check(`★★★ 안 담는다 — ${이름}`, 것.length === 0, JSON.stringify(것));
  }

  /*
   * 확장자 앞의 점이 **진짜 점**인가. 템플릿 글 안에서 한 겹으로 적으면
   * 자바스크립트가 역빗금을 먼저 먹어서, 정규식에 닿는 것은 아무 글자나
   * 맞는 `.` 이 된다. 두 번 그랬다 — 눈으로는 안 보이고 이 검사만 잡는다.
   */
  /*
   * 세 갈래가 다 있어야 한다 — 4차 리뷰가 짚었다. 뒤에 붙는 갈래만 재고
   * 앞에 붙는 갈래와 단독 갈래는 안 재고 있었다. 갈래마다 확장자 앞의
   * 점을 한 번씩 다른 글자로 바꿔 본다.
   */
  for (const 이름 of [
    'test/roles.specXts', 'test/approval.testZjs', 'test/handler_testZjs',
    'scripts/qa-rolesXmjs', 'test/testZjs', 'test/specXjs',
  ]) {
    const 뿌리 = 판(({ 파일 }) => { 파일(이름, '// ...'); });
    check(`★★★ 점 자리에 아무 글자나 오면 검사가 아니다 — ${이름}`,
      확인법들(뿌리).length === 0, JSON.stringify(확인법들(뿌리).map((x) => x.명령)));
  }

  /*
   * 이름과 검사말 사이의 구분자도 마찬가지다. 뒤에 붙는 갈래는 점·밑줄만
   * 받는다 — 붙임표로 이은 `api-spec` 은 낱말 합성이지 검사 파일이 아니다.
   * 주석에는 그렇게 적어 놓고 재는 자리가 없었다(4차 리뷰).
   */
  for (const 이름 of [
    'test/approvalXtest.js', 'test/api-spec.js', 'test/roles-spec.ts',
    // `test` 갈래는 무관한 글자만 재고 정작 헷갈리는 붙임표를 안 쟀다(5차 리뷰).
    'test/approval-test.js', 'test/handler-tests.js',
  ]) {
    const 뿌리 = 판(({ 파일 }) => { 파일(이름, '// ...'); });
    check(`★★★ 구분자가 점·밑줄이 아니면 검사가 아니다 — ${이름}`,
      확인법들(뿌리).length === 0, JSON.stringify(확인법들(뿌리).map((x) => x.명령)));
  }

  // 앞에 붙는 관례는 그대로 산다. 좁히다 이쪽을 죽이면 8번이 되돌아온다.
  for (const 이름 of ['scripts/qa-roles.mjs', 'scripts/test-approval.mjs', 'scripts/check-src.js']) {
    const 뿌리 = 판(({ 파일 }) => { 파일(이름, '// ...'); });
    check(`★★★ 앞에 붙는 관례는 그대로 — ${이름}`,
      확인법들(뿌리).length === 1, JSON.stringify(확인법들(뿌리).map((x) => x.명령)));
  }

  /*
   * 무늬와 부르는법이 어긋나지 않는다 — 무늬가 아는 확장자는 부르는법도
   * 알아야 한다. 어긋나면 그 갈래는 아무 데도 안 닿는 죽은 규칙이 된다.
   */
  for (const 끝 of ['.js', '.mjs', '.cjs', '.ts', '.py', '.sh']) {
    const 뿌리 = 판(({ 파일 }) => { 파일(`test/roles.spec${끝}`, '// ...'); });
    check(`★★ 무늬가 아는 확장자는 부르는법도 안다 — ${끝}`,
      확인법들(뿌리).length === 1, JSON.stringify(확인법들(뿌리).map((x) => x.명령)));
  }
}

for (const 뿌리 of 뿌리들) { try { rmSync(뿌리, { recursive: true, force: true }); } catch { /* 그만 */ } }

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n확인 방법 찾기 검사  ${D}(전부 찾되, 없는 것은 지어내지 않기)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
