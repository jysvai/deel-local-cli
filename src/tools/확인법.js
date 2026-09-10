/**
 * 이 프로젝트가 스스로 정해 둔 **확인 방법들**을 찾는다.
 *
 * ── 왜 따로 나왔나 ─────────────────────────────────────────────────────
 *
 * 벤치마크에서 진 자리다(`docs/ko/benchmark.md`).
 *
 * 같은 프로젝트에 같은 일을 시킨 비교에서, 품질은 거의 동급이었는데 **전체
 * 회귀 범위**만 우리가 낮았다(85% 대 100%). 까닭은 단순했다 — 그 프로젝트의
 * 검사는 `scripts/` 밑의 독립 실행 파일 셋이었는데, 우리는 `package.json` 의
 * `test` 하나만 보고 있었다. 못 본 검사는 안 돌고, 안 돈 검사는 회귀를 못 잡는다.
 *
 * 고칠 자리가 「더 열심히 하라」 가 아니라 **「무엇이 있는지 알려 주기」** 였다.
 * 시킴말에 "확인해라" 는 이미 있었다. 확인할 **길**의 목록이 없었을 뿐이다.
 *
 * ── 여기서도 안 돌린다 ──────────────────────────────────────────────────
 *
 * 찾기만 하고 **실행은 안 한다.** 검사 스크립트는 무슨 짓이든 할 수 있어서,
 * 그걸 돌리는 길은 Bash 하나여야 한다 — 승인 관문과 안전 검사가 거기에만
 * 걸려 있다. 이 파일이 몰래 돌리면 strict 모드의 약속이 여기서만 깨진다.
 *
 * ── 없는 것은 지어내지 않는다 ───────────────────────────────────────────
 *
 * 있을 법한 이름을 추측해서 채우지 않는다. **파일이나 스크립트로 실재하는
 * 것만** 담는다. 없는 명령을 알려 주면 모델이 그걸 부르고, 실패를 받고, 또
 * 부른다 — 걸음만 태우고 사람은 왜 헤매는지 모른다.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 한 판에 몇 개까지 알려 줄까. 스무 개를 늘어놓으면 그건 목록이 아니라 소음이다. */
export const 최대 = 8;

/*
 * package.json 의 스크립트 가운데 **확인에 해당하는 것**.
 *
 * `test` 만 보던 것을 넓힌다. 요즘 저장소는 확인을 여러 칸에 나눠 둔다 —
 * 형 검사와 린트와 e2e 가 따로 있고, 그 중 하나만 돌리면 나머지는 안 돈다.
 *
 * `build` 는 확인이 아니지만 **깨지면 아무것도 안 되는 것**이라 맨 뒤에 붙인다.
 */
const 확인스크립트 = /^(test|tests|check|checks|lint|typecheck|types?|verify|qa|e2e|spec|coverage)(:|$)/i;
const 뒤에붙일것 = /^build(:|$)/i;

/*
 * 독립 실행 검사 파일이 사는 자리와 이름.
 *
 * `package.json` 에 안 걸리는 검사가 여기 산다. 벤치마크에서 놓친 것이 정확히
 * 이 모양이었다 — `scripts/qa-collaboration.js` 처럼 npm 스크립트로 등록되지
 * 않은 채 `node` 로 직접 도는 파일들.
 */
const 볼폴더 = ['scripts', 'script', 'test', 'tests', 'qa', 'tools', 'bin'];
/*
 * 이름이 **앞에 붙든 뒤에 붙든** 검사다.
 *
 * 예전엔 앞머리만 봤다(`^(qa|test|…)[-_.]`). 그래서
 * `test-approval.mjs` 는 찾고 `approval.test.js` 는 못 찾았다 — 그런데
 * 자바스크립트 쪽에서 흔한 것은 **뒤에 붙는 쪽**이다.
 * Jest · Vitest · node:test 가 전부 `*.test.js` · `*.spec.ts` 를 기본값으로
 * 쓴다. deel 자기 저장소도 `test/guard.test.js` 꼴이다 — 제 검사를
 * 제가 못 찾고 있었다(package.json 의 `test` 칸이 가려 줘서 안 보였다).
 *
 * 넓히되 **검사라고 적힌 것만** 담는다. 마디를 가르는 자리를 점·밑줄·
 * 붙임표로 못박아서, `latest.js` 가 `test` 로 읽히거나 `helpers.js` 가
 * 딸려오지 않게 한다 — 없는 것을 지어내면 모델이 그걸 부르고 걸음만 태운다.
 */
const 검사말 = '(?:qa|tests?|check|verify|e2e|spec|bench)';
/*
 * 점은 두 겹으로 적는다. 템플릿 글 안에서 `\.` 은 자바스크립트가
 * 먼저 먹어서 정규식에 닿는 것은 그냥 `.` 이다 — 아무 글자나 맞는 점.
 * 그러면 `a.testZjs` 같은 것이 검사 파일로 읽힌다. 실제로 그러썼고,
 * 자동모드.test.js 의 이스케이프 검사가 잡는 부류가 바로 이것이다.
 */
const 검사파일 = new RegExp(
  `^(?:${검사말}[-_.].+|.+[-_.]${검사말})\\.(m?js|cjs|ts|tsx|py|sh)$`, 'i');
const 부르는법 = { '.js': 'node', '.mjs': 'node', '.cjs': 'node', '.ts': 'node', '.py': 'python', '.sh': 'sh' };

/*
 * 다른 생태계의 관례.
 *
 * 자리(표식 파일)가 실재할 때만 담는다. Makefile 은 `test:` 칸이 진짜로
 * 있을 때만 — 없는데 `make test` 를 알려 주면 그건 지어낸 것이다.
 */
function 생태계(뿌리, 담기) {
  const 있나 = (f) => existsSync(join(뿌리, f));
  if (있나('Cargo.toml')) 담기('cargo test', 'Cargo.toml');
  if (있나('go.mod')) 담기('go test ./...', 'go.mod');
  if (있나('pytest.ini') || 있나('tox.ini')) 담기('pytest', 'pytest 설정');
  else if ((있나('pyproject.toml') || 있나('setup.cfg')) && (있나('tests') || 있나('test'))) 담기('pytest', 'pyproject + tests/');
  if (있나('go.work')) 담기('go test ./...', 'go.work');
  for (const 이름 of ['Makefile', 'makefile']) {
    if (!있나(이름)) continue;
    try {
      // 진짜로 `test:` 칸이 있을 때만. 있을 법하다고 넣지 않는다.
      if (/^\.?test\s*:/m.test(readFileSync(join(뿌리, 이름), 'utf8'))) 담기('make test', 이름);
    } catch { /* 못 읽으면 없는 것으로 둔다 */ }
    break;
  }
}

/**
 * 확인 방법들을 찾아 돌려준다.
 *
 * @param {string} 뿌리 프로젝트 뿌리 경로
 * @returns {{명령: string, 어디서: string}[]} 실재하는 것만. 없으면 빈 배열.
 */
export function 확인법들(뿌리) {
  const 나온것 = [];
  const 본명령 = new Set();
  const 담기 = (명령, 어디서) => {
    if (본명령.has(명령) || 나온것.length >= 최대) return;
    본명령.add(명령);
    나온것.push({ 명령, 어디서 });
  };
  const 나중에 = [];

  const pkg = join(뿌리, 'package.json');
  if (existsSync(pkg)) {
    try {
      const j = JSON.parse(readFileSync(pkg, 'utf8'));
      for (const 이름 of Object.keys(j.scripts ?? {})) {
        // `npm test` 는 관례가 있고 나머지는 `npm run` 을 붙여야 돈다.
        const 명령 = 이름 === 'test' ? 'npm test' : `npm run ${이름}`;
        if (확인스크립트.test(이름)) 담기(명령, 'package.json');
        else if (뒤에붙일것.test(이름)) 나중에.push([명령, 'package.json']);
      }
    } catch { /* 망가진 package.json 은 파일별 확인에서 잡힌다 */ }
  }

  for (const 폴더 of 볼폴더) {
    const 곳 = join(뿌리, 폴더);
    let 목록;
    try {
      if (!statSync(곳).isDirectory()) continue;
      목록 = readdirSync(곳);
    } catch { continue; }
    for (const 이름 of 목록.sort()) {
      if (!검사파일.test(이름)) continue;
      const 끝 = 이름.slice(이름.lastIndexOf('.')).toLowerCase();
      const 앞 = 부르는법[끝];
      if (!앞) continue;
      담기(`${앞} ${폴더}/${이름}`, `${폴더}/`);
    }
  }

  생태계(뿌리, 담기);
  for (const [명령, 어디서] of 나중에) 담기(명령, 어디서);
  return 나온것;
}
