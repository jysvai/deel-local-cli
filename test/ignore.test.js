// git 이 안 보는 것을 도구도 안 보는가 — .gitignore · .deelignore.
//
// ── 왜 이걸 재나 ────────────────────────────────────────────────────────
//
// walk() 는 정해진 폴더 몇 개만 건너뛰었다. 실제 저장소는 build/ · coverage/ · *.min.js ·
// 자료 덤프를 .gitignore 에 적어 두는데, 그걸 다 훑으면 32k 창에서 Grep 한 번이 빌드
// 산출물로 예산을 다 쓴다. 규칙 읽기가 git 과 다르면 더 나쁘다 — 사람은 git 을 믿고
// 적었는데 도구가 엉뚱한 것을 빼거나 넣는다.
//
// 여기서 재는 것:
//   1) 규칙 표 — git 이 하는 대로 읽는가 (부정 · 고정 · ** · 폴더만 · 이스케이프 · CRLF)
//   2) 아래 폴더의 .gitignore 는 그 아래에만 듣는다
//   3) Glob · Grep · Outline · @폴더 가 같은 규칙으로 거르고, 건너뛴 수를 말한다
//   4) Read 로 짚어 주면 그대로 읽힌다 (목록만 거른다)
//   5) .gitignore 가 없으면 전과 똑같다 (회귀)
//   6) 5,000개 파일을 규칙 켜고 훑는 시간 (잰다 · 찍는다)
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { 규칙읽기, 무시하나, 걸리나, 건너뜀말 } from '../src/tools/ignore.js';
import { walk } from '../src/tools/fsutil.js';
import { 엔진잊기 } from '../src/tools/fastgrep.js';
import { TOOLS } from '../src/tools/index.js';
import { expand } from '../src/agent/mention.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 1. 규칙 표 ──────────────────────────────────────────────────────────
trace('1-규칙표');
{
  // [규칙 글, 경로, 폴더인가, 기대]
  const 표 = [
    ['*.log', 'a.log', false, true],
    ['*.log', 'x/y/z.log', false, true],
    ['*.log', 'a.logs', false, false],
    ['*.log\n!keep.log', 'keep.log', false, false],
    ['*.log\n!keep.log', 'x/keep.log', false, false],
    ['*.log\n!keep.log', 'x/other.log', false, true],
    ['build/', 'build', true, true],
    ['build/', 'build', false, false],
    ['build/', 'build/x.js', false, true],          // 부모 폴더가 걸린다
    ['build/', 'x/build', true, true],
    ['/build', 'build', true, true],
    ['/build', 'x/build', true, false],
    ['doc/frotz', 'doc/frotz', true, true],
    ['doc/frotz', 'a/doc/frotz', true, false],
    ['**/foo', 'foo', false, true],
    ['**/foo', 'a/b/foo', false, true],
    ['abc/**', 'abc/x', false, true],
    ['abc/**', 'abc/x/y', false, true],
    ['abc/**', 'abc', true, false],
    ['a/**/b', 'a/b', false, true],
    ['a/**/b', 'a/x/b', false, true],
    ['a/**/b', 'a/x/y/b', false, true],
    ['?.txt', 'a.txt', false, true],
    ['?.txt', 'ab.txt', false, false],
    ['[abc].txt', 'a.txt', false, true],
    ['[abc].txt', 'd.txt', false, false],
    ['[!a].txt', 'b.txt', false, true],
    ['[!a].txt', 'a.txt', false, false],
    ['# 주석\n\n  \n', 'anything', false, false],
    ['\\#notes', '#notes', false, true],
    ['foo\\ ', 'foo ', false, true],
    ['bar   ', 'bar', false, true],
    ['*.tmp\r\n!keep.tmp\r\n', 'x.tmp', false, true],
    ['*.tmp\r\n!keep.tmp\r\n', 'keep.tmp', false, false],
    ['*.min.js', 'a/b.min.js', false, true],
    ['node_modules', 'x/node_modules', true, true],
    ['/*.cfg', 'a.cfg', false, true],
    ['/*.cfg', 'x/a.cfg', false, false],
    ['dir/*', 'dir/a', false, true],
    ['dir/*', 'dir/a/b', false, true],              // dir/a 가 폴더로 걸린다
    ['build/\n!build/keep.txt', 'build/keep.txt', false, true],   // 건너뛴 폴더 안은 못 살린다 (git 도)
    ['\\!important', '!important', false, true],
    ['a\\*b', 'a*b', false, true],
    ['a\\*b', 'axb', false, false],
    // 제자리가 아닌 별둘은 git 이 그냥 별 하나로 읽는다 — 슬래시를 안 넘는다.
    // (아래 여섯 줄은 진짜 git check-ignore 와 하나씩 맞춰 본 것이다)
    ['a**b', 'axxb', false, true],
    ['a**b', 'ab', false, true],
    ['a**b', 'a/dir/b', false, false],
    ['a**b', 'a/dir/b/f.txt', false, false],
    ['x/**y', 'x/zzy', false, true],
    ['x/**y', 'x/d/y', false, false],
    ['**a', 'x/ya', false, true],
  ];
  for (const [글, 경로, 폴더, 기대] of 표) {
    const 규칙 = 규칙읽기(글, '');
    const 답 = 무시하나(경로, 폴더, 규칙);
    check(`${JSON.stringify(글)} → ${경로}${폴더 ? '/' : ''} ${기대 ? '건너뜀' : '남음'}`, 답 === 기대, `답 ${답}`);
  }
  /*
   * 대소문자는 **판마다 다르다.** 그러면 양쪽 다 못을 박아야 한다.
   *
   * 여기가 윈도우 쪽만 재고 있었다. 리눅스 쪽에는 아무 못도 없어서
   * `ignore.js` 의 `'i'` 를 무조건 켜도 리눅스 CI 는 초록이다 — 그러면
   * 리눅스 사용자의 `*.log` 가 갑자기 `A.LOG` 까지 가리고, 에이전트가 보는
   * 파일 목록이 조용히 바뀐다. 판을 묻는 검사는 **묻지 않은 판**을 안 잰다.
   */
  const 대문자로그 = 무시하나('A.LOG', false, 규칙읽기('*.log'));
  if (process.platform === 'win32') {
    check('★ 윈도우는 대소문자를 안 가린다', 대문자로그 === true, `답 ${대문자로그}`);
  } else {
    check('★ 윈도우가 아니면 대소문자를 가린다', 대문자로그 === false, `답 ${대문자로그}`);
  }

  // 아래 폴더의 규칙은 그 아래에만.
  const 아래 = 규칙읽기('*.txt\n/x', 'sub');
  check('아래 폴더 규칙: 그 아래 파일은 걸린다', 무시하나('sub/a.txt', false, 아래) === true);
  check('아래 폴더 규칙: 위의 파일은 안 걸린다', 무시하나('a.txt', false, 아래) === false);
  check('아래 폴더 규칙: 폴더 자신은 안 걸린다', 무시하나('sub', true, 아래) === false);
  check('아래 폴더 규칙: /x 는 그 폴더 바로 아래만', 무시하나('sub/x', false, 아래) === true && 무시하나('sub/y/x', false, 아래) === false);
  // 뒤의 규칙이 이긴다 — 위 .gitignore 가 빼고 아래 .gitignore 가 되살리는 것도 된다 (폴더째 빠진 것만 빼고).
  const 겹침 = [...규칙읽기('*.txt', ''), ...규칙읽기('!keep.txt', 'sub')];
  check('아래 폴더가 위의 규칙을 뒤집는다', 무시하나('sub/keep.txt', false, 겹침) === false && 무시하나('sub/a.txt', false, 겹침) === true);
  check('빈 규칙이면 아무것도 안 건너뛴다', 무시하나('build/x', false, []) === false && 걸리나('a', false, []) === false);
  check('건너뜀 말: 없으면 빈 글, 있으면 수를 센다', 건너뜀말({ 폴더: 0, 파일: 0 }) === '' && /폴더 2개 · 파일 3개/.test(건너뜀말({ 폴더: 2, 파일: 3 })) && /파일 1개/.test(건너뜀말({ 폴더: 0, 파일: 1 })));
}

// ── 준비: 본보기 폴더 ──────────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'deel-ignore-'));
const 쓰기 = (rel, 글 = 'needle\n') => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, 글, 'utf8'); };
// out/ 을 쓴다 — build/ · dist/ 는 SKIP_DIRS 가 이미 건너뛰어서 규칙이 듣는지 안 듣는지 안 보인다.
쓰기('.gitignore', 'out/\n*.log\n!important.log\nsecret.txt\n');
쓰기('.deelignore', 'data/\n');
쓰기('src/a.js', 'const needle = 1;\n');
쓰기('out/b.js', 'const needle = 2;\n');
쓰기('out/c.log');
쓰기('x.log');
쓰기('important.log');
쓰기('secret.txt');
쓰기('sub/.gitignore', 'gen/\n');
쓰기('sub/gen/g.js', 'needle\n');
쓰기('sub/keep.js', 'needle\n');
쓰기('data/big.csv', 'needle\n');
const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
const rels = (list) => list.map((f) => f.rel).sort();

// ── 2. walk ────────────────────────────────────────────────────────────
trace('2-walk');
{
  const 본것 = await walk(root);
  const r = rels(본것);
  check('out/ 안은 안 나온다', !r.some((x) => x.startsWith('out/')), r.join(' '));
  check('*.log 는 빠지고 !important.log 는 남는다', !r.includes('x.log') && r.includes('important.log'), r.join(' '));
  check('secret.txt 는 빠진다', !r.includes('secret.txt'));
  check('아래 폴더의 .gitignore(gen/)도 듣는다', !r.includes('sub/gen/g.js') && r.includes('sub/keep.js'), r.join(' '));
  check('.deelignore(data/)도 듣는다', !r.includes('data/big.csv'));
  check('남는 것은 남는다', r.includes('src/a.js') && r.includes('.gitignore'));
  check('건너뛴 수를 센다 — 폴더 3 (out · sub/gen · data) · 파일 2 (x.log · secret.txt)', 본것.건너뜀?.폴더 === 3 && 본것.건너뜀?.파일 === 2, JSON.stringify(본것.건너뜀));
  check('건너뜀은 열거되지 않는다 (JSON 에 안 섞인다)', !Object.keys(본것).includes('건너뜀') && !('건너뜀' in JSON.parse(JSON.stringify(본것))));
  const 전부 = await walk(root, { ignore: false });
  check('ignore: false 면 전부 나온다', rels(전부).includes('out/b.js') && rels(전부).includes('secret.txt') && 전부.건너뜀.폴더 === 0, rels(전부).join(' '));
}

// ── 3. 도구들 — 같은 규칙, 그리고 수를 말한다 ─────────────────────────
trace('3-도구');
{
  const g = await TOOLS.Glob.run({ pattern: '**/*.js' }, ctx);
  check('Glob 은 out/ 를 안 낸다', !/out\//.test(g.content) && /src\/a\.js/.test(g.content), g.content);
  check('Glob 이 건너뛴 수를 말한다', /\.gitignore 로 폴더 3개 · 파일 2개 건너뜀/.test(g.content), g.content.split('\n').pop());
  const g0 = await TOOLS.Glob.run({ pattern: '**/*.nothing' }, ctx);
  check('못 찾았을 때도 건너뛴 수는 말한다', /찾은 파일 없음/.test(g0.content) && /건너뜀/.test(g0.content), g0.content);

  /*
   * Grep 은 두 길로 간다 — 이 PC 에 rg 나 git 이 있으면 그걸 빌려 쓰고,
   * 없으면 자바스크립트로 하나씩 연다. **두 길이 같은 파일을 봐야 한다.**
   * 엔진에 따라 out/ · secret.txt 가 보였다 안 보였다 하면, 빠른 것이
   * 문제가 아니라 같은 명령이 PC 마다 다른 답을 내는 것이 문제다.
   *
   * 그래서 여기서는 이 PC 가 고른 길과 자바스크립트 길을 **둘 다** 돌린다.
   * (`DEEL_GREP=js` 로 예전 길을 강제할 수 있다 — 그러라고 만든 스위치다.)
   */
  // 꼬리말(빈 줄 뒤)은 빼고 파일 이름만 뽑는다 — 꼬리는 길마다 다른 게 맞다.
  const 뽑기 = (글) => String(글).split('\n\n')[0].split('\n')
    .map((l) => l.trim()).filter((l) => /\.[A-Za-z0-9]+$/.test(l)).sort().join(' ');

  const gr = await TOOLS.Grep.run({ pattern: 'needle' }, ctx);
  check('Grep 도 out/ · secret.txt 를 안 본다', !/out\/|secret\.txt|data\/big|sub\/gen/.test(gr.content) && /src\/a\.js/.test(gr.content), gr.content);

  process.env.DEEL_GREP = 'js';
  엔진잊기();
  const grJS = await TOOLS.Grep.run({ pattern: 'needle' }, ctx);
  delete process.env.DEEL_GREP;
  엔진잊기();

  check('예전 길도 out/ · secret.txt 를 안 본다', !/out\/|secret\.txt|data\/big|sub\/gen/.test(grJS.content) && /src\/a\.js/.test(grJS.content), grJS.content);
  check('두 길이 같은 파일을 본다', 뽑기(gr.content) === 뽑기(grJS.content), `빠른 길: ${뽑기(gr.content)} / 예전 길: ${뽑기(grJS.content)}`);
  check('예전 길은 건너뛴 수를 말한다', /\.gitignore 로 폴더 3개 · 파일 2개 건너뜀/.test(grJS.content), grJS.content.split('\n').pop());
  // 빠른 엔진은 그 수를 안 알려준다. 지어내느니 안 셌다고 말한다.
  const 빠른길인가 = !/건너뜀/.test(gr.content);
  check(빠른길인가 ? '빠른 길은 무엇으로 찾았는지 밝히고, 안 센 것은 안 셌다고 한다' : '이 PC 에는 빠른 엔진이 없어 예전 길로 갔다',
    빠른길인가
      ? /(rg|git grep) 으로 찾았습니다/.test(gr.content) && /건너뛴 수는 안 셌습니다/.test(gr.content)
      : gr.content === grJS.content,
    gr.content.split('\n').pop());

  const gr1 = await TOOLS.Grep.run({ pattern: 'needle', path: 'out/b.js' }, ctx);
  check('파일을 짚어 준 Grep 은 그대로 본다', /out\/b\.js/.test(gr1.content) && !/건너뜀/.test(gr1.content), gr1.content);

  const o = await TOOLS.Outline.run({}, ctx);
  check('Outline 도 out/ 를 안 낸다', !/out\//.test(o.content ?? '') && /src\/a\.js/.test(o.content ?? ''), (o.content ?? o.error ?? '').slice(0, 120));
  check('Outline 도 건너뛴 수를 말한다', /건너뜀/.test(o.content ?? ''), (o.content ?? '').split('\n').pop());

  const v = await TOOLS.Verify.run({}, ctx);
  const v글 = v?.content ?? '';
  check('Verify 도 out/ 을 안 본다', !/out\//.test(v글), v글.slice(0, 80).replace(/\n/g, ' | '));
  check('Verify 도 건너뛴 수를 말한다', /\.gitignore 로 폴더 3개 · 파일 2개 건너뜀/.test(v글), v글.split('\n').pop());

  const rd = await TOOLS.Read.run({ file_path: 'out/b.js' }, ctx);
  check('Read 로 짚어 주면 그대로 읽힌다', /needle = 2/.test(rd.content ?? ''), rd.error ?? '');

  const at = expand('@sub 여기 뭐 있어', { scope: ctx.scope });
  check('@폴더 목록도 gen/ 을 빼고 그렇다고 말한다', !/gen\//.test(at.text) && /keep\.js/.test(at.text) && /\.gitignore 로 1개 건너뜀/.test(at.text), at.text.split('\n').slice(-3).join(' | '));
}

/*
 * ── Verify 는 **상한에 걸려 안 본 것도** 말해야 한다 ────────────────────
 *
 * verify.js 머리말이 스스로 못 박아 둔 것 — 「못 확인한 것은 못 확인했다고
 * 말한다. 확인 못 한 것을 확인했다고 하는 것이 제일 나쁘다.」
 *
 * .gitignore 로 건너뛴 것(바로 위 검사)과 훑기 상한은 그렇게 하고 있었는데,
 * 「한 번에 마흔 개」 라는 상한만 아무 데도 안 적혔다. 그래서 파일이 마흔 개를
 * 넘으면 마흔한 번째가 깨져 있어도 「확인했습니다」 로 끝났고, failed 도 거짓이라
 * 루프까지 성공으로 넘어갔다. 상한이 있는 것 자체는 옳다 — **말을 안 한 것**이 탈이다.
 */
trace('7-확인상한');
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-verify-cap-'));
  const ctx = {
    scope: makeScope(방), history: new History(방), audit: new Audit(방),
    seen: new Set(), 모델컨텍스트: 200000, enc: new Map(),
  };
  // 멀쩡한 것 44개 + 진짜로 깨진 것 1개. 상한(40)을 확실히 넘긴다.
  for (let i = 0; i < 44; i++) writeFileSync(join(방, `ok${String(i).padStart(2, '0')}.js`, ), `const x${i} = ${i};\n`, 'utf8');
  writeFileSync(join(방, 'zzz-broken.js'), 'function 깨짐( {\n', 'utf8');

  const v = await TOOLS.Verify.run({}, ctx);
  const v글 = v?.content ?? '';
  check('★ 상한에 걸려 안 본 것이 있다고 말한다', /한 번에 \d+개까지만 봅니다/.test(v글),
    v글.split('\n').filter((l) => /못 한 것|한 번에/.test(l)).join(' | ') || v글.slice(0, 80));
  check('★ 그것을 「확인 못 한 것」 으로 센다', /확인 못 한 것/.test(v글),
    v글.split('\n').find((l) => /확인 못 한 것/.test(l)) ?? '(그런 줄 없음)');
  check('paths 로 짚어 주면 그 파일은 본다',
    /zzz-broken/.test((await TOOLS.Verify.run({ paths: ['zzz-broken.js'] }, ctx))?.content ?? ''),
    '');

  rmSync(방, { recursive: true, force: true });
}

// ── 4. .gitignore 가 없으면 전과 같다 ──────────────────────────────────
trace('4-회귀');
{
  const 맨 = mkdtempSync(join(tmpdir(), 'deel-ignore-plain-'));
  for (const f of ['a.js', 'out/b.js', 'x.log', 'node_modules/m.js', 'build/z.js']) { const p = join(맨, f); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, 'x'); }
  const 켬 = await walk(맨);
  const 끔 = await walk(맨, { ignore: false });
  check('규칙 파일이 없으면 켜고 끄고가 같다', JSON.stringify(rels(켬)) === JSON.stringify(rels(끔)) && 켬.건너뜀.폴더 === 0 && 켬.건너뜀.파일 === 0, rels(켬).join(' '));
  check('바닥(node_modules · build)은 규칙과 무관하게 여전히 건너뛴다', !rels(켬).some((x) => x.startsWith('node_modules/') || x.startsWith('build/')), rels(켬).join(' '));
  rmSync(맨, { recursive: true, force: true });
}

// ── 5. 5,000개 파일 — 규칙 켜고 훑는 시간 ──────────────────────────────
trace('5-시간');
{
  const 큰 = mkdtempSync(join(tmpdir(), 'deel-ignore-big-'));
  writeFileSync(join(큰, '.gitignore'), ['*.log', 'build/', '!keep.log', '**/gen/', '*.min.js', 'tmp/*', '/out', 'coverage/', '*.map', '.cache/'].join('\n'));
  for (let d = 0; d < 50; d++) {
    const dir = join(큰, `pkg${d}`, 'src');
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 100; i++) writeFileSync(join(dir, `f${i}.${i % 10 === 0 ? 'log' : 'js'}`), 'x');
  }
  await walk(큰, { ignore: false });   // 먼저 한 번 — 안 데우고 재면 첫 훑기가 OS 캐시 값을 혼자 뒤집어쓴다
  const t0 = process.hrtime.bigint();
  const 본것 = await walk(큰);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const t1 = process.hrtime.bigint();
  await walk(큰, { ignore: false });
  const ms0 = Number(process.hrtime.bigint() - t1) / 1e6;
  check(`5,000개를 규칙 켜고 훑는 데 ${ms.toFixed(0)}ms (끄면 ${ms0.toFixed(0)}ms) — 1.5초 안`, ms < 1500, `${ms.toFixed(0)}ms`);
  check('그중 *.log 500개를 건너뛰었다 (남는 것 4,500 + .gitignore 자신)', 본것.건너뜀.파일 === 500 && 본것.length === 4501, JSON.stringify({ 남음: 본것.length, ...본것.건너뜀 }));
  rmSync(큰, { recursive: true, force: true });
}

// ── 결과 ────────────────────────────────────────────────────────────────
const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n.gitignore 걷기 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? D + '  ' + p.note + X : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
rmSync(root, { recursive: true, force: true });
process.exitCode = fail.length ? 1 : 0;
