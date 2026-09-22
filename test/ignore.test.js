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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, chmodSync, symlinkSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { 규칙읽기, 무시하나, 걸리나, 건너뜀말, 패턴규칙, 뿌리규칙읽기, 끝빈칸떼기 } from '../src/tools/ignore.js';
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
// 이 PC 에서 못 잰 것. 초록불로 덮지 않고 그대로 적는다.
const 못잰것 = [];

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

/*
 * ── 6. 못 연 폴더는 **없는 폴더가 아니다** ──────────────────────────────
 *
 * .gitignore 로 뺀 것은 세고 있었는데 **열다가 실패한 것**은 아무 데도 안
 * 셌다(fsutil.js 의 walk 가 `catch { continue }` 였다). 그래서 ACL 로 막힌
 * 폴더가 하나 섞인 저장소에서 Grep 이 —
 *
 *     일치 없음: 없는말XYZ
 *
 * 이 한 줄만 내놨다. 꼬리말도 없다 — 건너뜀이 0이고 잘림도 거짓이니
 * 건너뜀말() 이 낼 줄이 없어서다. 그 폴더 밑은 한 번도 안 열어 봤는데
 * 화면은 다 뒤져 본 것과 글자 하나 다르지 않았다.
 *
 * 그래서 **진짜로 못 여는 폴더**를 만들어 잰다 — 윈도우는 icacls 로 거절
 * ACE 를 걸고, 그 밖은 chmod 000. 걸었는데도 읽히는 PC(관리자로 도는 자리)
 * 에서는 잰 것이 없으므로 검사를 세우지 않고 못 쟀다고 적는다. 안 막힌
 * 폴더로 초록불을 켜면 그게 제일 나쁘다.
 */
trace('6-못연것');
{
  // 꼬리말 자체는 어느 PC 에서나 잰다 — 순수 함수다.
  check('꼬리말이 못 연 폴더를 말한다',
    /폴더 1개는 안을 한 번도 안 봤습니다/.test(건너뜀말({ 폴더: 0, 파일: 0, 못연폴더: 1 })),
    JSON.stringify(건너뜀말({ 폴더: 0, 파일: 0, 못연폴더: 1 })));
  check('못 연 파일도 같은 줄에 적는다',
    /파일 2개는 안을 한 번도 안 봤습니다/.test(건너뜀말({ 폴더: 0, 파일: 0, 못연파일: 2 })),
    JSON.stringify(건너뜀말({ 폴더: 0, 파일: 0, 못연파일: 2 })));
  check('「없다」 가 아니라고 못 박는다', /「없다」 가 아닙니다/.test(건너뜀말({ 폴더: 0, 파일: 0, 못연폴더: 1 })));
  /*
   * ★ 「못 열었다」 고만 적으면 **거짓 경고**다 (막판 훑기).
   *
   * walk 는 멀쩡한 심볼릭 링크·정션도 **일부러** 안 따라 들어가고 그것을 못 연 것으로
   * 센다(fsutil.js 머리말). 그건 실패가 아니라 정책인데, 꼬리말은 「권한·잠금·끊긴
   * 링크」 만 말해서 사람이 있지도 않은 권한 문제를 찾아 헤맸다. 모노레포의
   * packages/* 링크 하나면 Grep·Glob·Outline 꼬리에 매번 붙는다.
   */
  check('★★ 따라 들어가지 않은 링크도 까닭으로 적는다',
    /링크/.test(건너뜀말({ 폴더: 0, 파일: 0, 못연폴더: 1 }))
    && /따라 들어가지 않/.test(건너뜀말({ 폴더: 0, 파일: 0, 못연폴더: 1 })),
    JSON.stringify(건너뜀말({ 폴더: 0, 파일: 0, 못연폴더: 1 })));
  check('못 연 것이 없으면 그 줄은 안 붙는다', 건너뜀말({ 폴더: 0, 파일: 0, 못연폴더: 0, 못연파일: 0 }) === '');
  check('.gitignore 로 뺀 것과 다른 줄로 적는다',
    건너뜀말({ 폴더: 1, 파일: 0, 못연폴더: 1 }).split('\n').filter(Boolean).length === 2,
    JSON.stringify(건너뜀말({ 폴더: 1, 파일: 0, 못연폴더: 1 })));

  const 방 = mkdtempSync(join(tmpdir(), 'deel-nolook-'));
  mkdirSync(join(방, 'src'), { recursive: true });
  writeFileSync(join(방, 'src', 'a.js'), 'const needle = 1;\n', 'utf8');
  const 막힌방 = join(방, '막힌방');
  mkdirSync(막힌방);
  writeFileSync(join(막힌방, '숨은것.js'), 'const needle = 2;\n', 'utf8');
  const 나 = String(process.env.USERNAME ?? process.env.USER ?? '');
  const 막기 = () => {
    if (process.platform === 'win32') spawnSync('icacls', [막힌방, '/deny', `${나}:(OI)(CI)(RX)`], { encoding: 'utf8' });
    else chmodSync(막힌방, 0o000);
  };
  const 풀기 = () => {
    if (process.platform === 'win32') spawnSync('icacls', [막힌방, '/remove:d', 나], { encoding: 'utf8' });
    else chmodSync(막힌방, 0o700);
  };

  막기();
  let 정말막혔나 = false;
  try { readdirSync(막힌방); } catch { 정말막혔나 = true; }

  if (!정말막혔나) {
    못잰것.push('이 PC 에서는 못 여는 폴더를 못 만들어서, 진짜로 막힌 자리는 못 쟀습니다');
  } else {
    const 본것 = await walk(방);
    check('★ 못 연 폴더를 센다 — 조용히 사라지지 않는다', 본것.건너뜀?.못연폴더 === 1, JSON.stringify(본것.건너뜀));
    check('★ 열리는 것은 그대로 낸다', rels(본것).includes('src/a.js'), rels(본것).join(' '));
    check('★ 꼬리말이 그 사실을 말한다', /안을 한 번도 안 봤습니다/.test(건너뜀말(본것.건너뜀, 본것.잘림, 본것.상한)),
      JSON.stringify(건너뜀말(본것.건너뜀, 본것.잘림, 본것.상한)));

    const ctx2 = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set() };
    process.env.DEEL_GREP = 'js';
    엔진잊기();
    const g = await TOOLS.Grep.run({ pattern: '없는말XYZ' }, ctx2);
    delete process.env.DEEL_GREP;
    엔진잊기();
    check('★ Grep 이 「일치 없음」 넉 자로 끝내지 않는다', /안을 한 번도 안 봤습니다/.test(String(g.content)),
      String(g.content).replace(/\n/g, ' | '));
  }
  풀기();
  rmSync(방, { recursive: true, force: true });
}

/*
 * ── 6½. 끊긴 정션은 **조용히 사라졌다** (2.0.0 8회차 파일훑기) ──────────
 *
 * walk 는 항목을 `isDirectory()` · `isFile()` 두 갈래로만 갈랐다. 그런데
 * readdir 은 lstat 으로 본다 — 심볼릭 링크와 윈도우 정션은 그 둘이 **다
 * false** 다. 그래서 대상이 사라진 정션 하나는 어느 갈래에도 안 들어가고,
 * 걸러지지도 세어지지도 않은 채 그냥 없어졌다. 재 보니 —
 *
 *     건너뜀 {"폴더":0,"파일":0,"못연폴더":0,"못연파일":0}
 *
 * walk 의 건너뜀 선언이 「대상이 사라진 정션」 을 못 본 자리로 꼽아 놓고
 * 정작 그것만 한 번도 안 셌다. 꼬리말이 없으니 화면은 다 뒤져 본 것과 같다.
 *
 * 만들 권한이 없는 PC 에서는 검사를 세우지 않고 못 쟀다고 적는다.
 */
trace('6.5-끊긴정션');
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-junction-'));
  writeFileSync(join(방, 'a.js'), 'const needle = 1;\n', 'utf8');
  const 대상 = join(방, '대상');
  mkdirSync(대상);
  const 링크 = join(방, '끊긴링크');
  let 만들었나 = false;
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('cmd', ['/c', 'mklink', '/J', 링크, 대상], { encoding: 'utf8', windowsHide: true });
      만들었나 = r.status === 0;
    } else {
      symlinkSync(대상, 링크, 'dir');
      만들었나 = true;
    }
  } catch { 만들었나 = false; }
  if (만들었나) {
    // 대상을 지운다 — 이제 링크만 남고 따라가면 없다.
    rmSync(대상, { recursive: true, force: true });
    let 정말끊겼나 = false;
    try { statSync(링크); } catch { 정말끊겼나 = true; }
    if (!정말끊겼나) {
      못잰것.push('이 PC 에서는 대상이 사라진 링크를 못 만들어서, 끊긴 정션 자리는 못 쟀습니다');
    } else {
      const 본것 = await walk(방);
      check('★★ 끊긴 정션을 센다 — 조용히 사라지지 않는다',
        (본것.건너뜀?.못연폴더 ?? 0) + (본것.건너뜀?.못연파일 ?? 0) === 1, JSON.stringify(본것.건너뜀));
      check('★ 옆의 멀쩡한 파일은 그대로 낸다', rels(본것).includes('a.js'), rels(본것).join(' '));
      check('★ 꼬리말이 그 사실을 말한다',
        /안을 한 번도 안 봤습니다/.test(건너뜀말(본것.건너뜀, 본것.잘림, 본것.상한)),
        JSON.stringify(건너뜀말(본것.건너뜀, 본것.잘림, 본것.상한)));
    }
  } else {
    못잰것.push('이 PC 에서는 정션·심볼릭 링크를 못 만들어서, 끊긴 정션 자리는 못 쟀습니다');
  }
  rmSync(방, { recursive: true, force: true });
}

/*
 * ── 6¾. 시작 자리가 살림이면 **그 사실도 남긴다** (2.0.0 8회차 파일훑기) ──
 *
 * walk 는 시작 자리가 살림이면 아무것도 안 훑는다(사냥6 F6-1). 맞다. 그런데
 * 그때 `건너뛴살림` 이 **빈 채로** 나갔다. 그 목록은 Move 가 「안 뜬 것」 을
 * 말할 때 쓰는 근거다(tools/index.js 의 안뜬살림) — 폴더·파일 하나하나는
 * 넣어 주면서 시작 자리에서만 통째로 비어 있었으니, 살림 폴더를 통째로
 * 옮기면 「폴더 0개 파일」 이라 적고 조용히 넘어간다.
 */
trace('6.75-시작이살림');
{
  const 집 = mkdtempSync(join(tmpdir(), 'deel-살림뿌리-'));
  const 살림 = join(집, '.deel');
  mkdirSync(join(살림, 'history'), { recursive: true });
  writeFileSync(join(살림, 'audit.jsonl'), '{"a":1}\n', 'utf8');
  const 본것 = await walk(살림);
  check('★ 살림 폴더에서 시작하면 아무것도 안 낸다', 본것.length === 0, rels(본것).join(' '));
  check('★★ 그래도 건너뛴살림 에 그 사실이 남는다', (본것.건너뛴살림 ?? []).length === 1,
    JSON.stringify(본것.건너뛴살림));
  check('  남긴 이름이 그 폴더를 가리킨다', /\.deel/.test((본것.건너뛴살림 ?? []).join(' ')),
    JSON.stringify(본것.건너뛴살림));
  rmSync(집, { recursive: true, force: true });
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
   * 훑기 상한에 걸렸는데 **찾은 것이 있으면** 요약에도 「다 못 봄」 을 단다 (6회차 Gemini 도구6i I1).
   *
   * 글 끝에는 건너뜀말이 「파일이 너무 많아 N개까지만 봤습니다」 를 붙이는데, 요약(화면 한 줄)은 0개일 때만
   * 표시가 붙었다. 파일 150개 가운데 100개만 보고 `100개` 로 찍혀 다 찾은 것처럼 보였다 — Read 의 「일부만」 과 같은 꼴.
   */
  {
    const 많은방 = mkdtempSync(join(tmpdir(), 'deel-glob-cap-'));
    for (let i = 0; i < 150; i++) writeFileSync(join(많은방, `f${String(i).padStart(3, '0')}.js`), '', 'utf8');
    const ctx3 = { scope: makeScope(많은방), history: new History(많은방), audit: new Audit(많은방), seen: new Set() };
    const 옛상한 = process.env.DEEL_WALK_LIMIT;
    process.env.DEEL_WALK_LIMIT = '100';
    let gc;
    try { gc = await TOOLS.Glob.run({ pattern: '*.js' }, ctx3); }
    finally { if (옛상한 === undefined) delete process.env.DEEL_WALK_LIMIT; else process.env.DEEL_WALK_LIMIT = 옛상한; }
    check('준비: 상한에 걸려 글 끝에 그렇다고 적는다', /너무 많아 100개까지만/.test(String(gc.content)), String(gc.content).split('\n').pop());
    check('★ 상한에 걸려 찾은 것이 있으면 요약도 다 못 봤다고 말한다', /다 못 봄/.test(String(gc.summary)), String(gc.summary));
    const gd = await TOOLS.Glob.run({ pattern: '*.js' }, ctx3);
    check('  짝: 다 봤으면 요약에 표시가 없다', !/다 못 봄/.test(String(gd.summary)) && /150/.test(String(gd.summary)), String(gd.summary));
    rmSync(많은방, { recursive: true, force: true });
  }

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

// ── 6. 한 줄이 망가져도 나머지 규칙은 산다 (사냥5 L3) ────────────────────
trace('6-망가진줄');
{
  /*
   * `file[z-a].tmp` 한 줄이 RegExp 를 던지게 했고, 파일규칙읽기 의 catch 가 그 파일 규칙을
   * **통째로** 버렸다. build/ · *.log 까지 사라져 Glob·Grep 이 빌드 산출물을 다시 훑었다.
   */
  const 방6 = mkdtempSync(join(tmpdir(), 'deel-ignore-bad-'));
  writeFileSync(join(방6, '.gitignore'), 'build/\nsecrets.txt\n*.log\nfile[z-a].tmp\n');
  const 규칙6 = 뿌리규칙읽기(방6);
  check('★ 망가진 글자 묶음 한 줄이 있어도 나머지 규칙은 남는다', 규칙6.length === 3, `${규칙6.length}개`);
  check('★ build/ 는 여전히 건너뛴다', 무시하나('build', true, 규칙6) === true);
  check('★ *.log 도 여전히 건너뛴다', 무시하나('app.log', false, 규칙6) === true);
  let 던졌나 = null;
  try { 패턴규칙('file[z-a].tmp'); } catch (e) { 던졌나 = e.message; }
  check('망가진 한 줄은 던지지 않고 규칙이 없는 것(null)으로 친다', 던졌나 === null && 패턴규칙('file[z-a].tmp') === null, 던졌나 ?? '');
  rmSync(방6, { recursive: true, force: true });
}

// ── 7. 글자 묶음은 git 과 같게 (6회차 Gemini 무시규칙6 · 진짜 git ls-files 와 견줌) ─────
trace('7-글자묶음');
{
  /*
   * git 의 글자 묶음은 **슬래시를 안 맞힌다.** 우리 것은 JS 글자 묶음을 그대로 써서 `a[!b]c` 가 `a/c` 를,
   * `x[a/]y` 가 `x/y` 를 걸었다 — git 은 두는 파일을 deel 만 감춘다. 또 묶음 첫 글자 `]` 는 닫는 괄호가
   * 아니라 글자인데(`[]a]` = `]` 또는 `a`), 첫 `]` 에서 닫아 `]` · `a` 둘 다 놓쳤다.
   */
  const 한줄 = (줄) => 규칙읽기(`${줄}\n`);
  check('★ 부정 묶음이 슬래시를 안 맞힌다 — a[!b]c 는 a/c 를 안 건다', 무시하나('a/c', false, 한줄('a[!b]c')) === false);
  check('  부정 묶음은 여전히 글자를 맞힌다 — a[!b]c 는 axc 를 건다', 무시하나('axc', false, 한줄('a[!b]c')) === true);
  check('★ 슬래시가 든 묶음도 슬래시는 안 맞힌다 — x[a/]y 는 x/y 를 안 건다', 무시하나('x/y', false, 한줄('x[a/]y')) === false);
  check('  x[a/]y 는 xay 를 건다', 무시하나('xay', false, 한줄('x[a/]y')) === true);
  check('★ 묶음 첫 글자 ] 는 글자다 — []a] 는 ] 를 건다', 무시하나(']', false, 한줄('[]a]')) === true);
  check('  []a] 는 a 도 건다', 무시하나('a', false, 한줄('[]a]')) === true);
  check('  []a] 는 b 를 안 건다', 무시하나('b', false, 한줄('[]a]')) === false);
  check('  [!]a] 는 ] · a 말고 다른 글자를 건다', 무시하나('b', false, 한줄('[!]a]')) === true && 무시하나(']', false, 한줄('[!]a]')) === false);
  check('  *.[!o] 는 여전히 d/m.c 를 걸고 m.o 는 안 건다', 무시하나('d/m.c', false, 한줄('*.[!o]')) === true && 무시하나('m.o', false, 한줄('*.[!o]')) === false);
}

trace('20-끝빈칸');
/*
 * ── 끝 빈칸 떼기를 git 과 똑같이 (2.0.2 · G4) ─────────────────────────────────
 *
 * `foo\\ ` 의 `\\` 는 역슬래시 글자 하나이고 끝 빈칸은 안 살린 것이다 — git 은 `foo\` 로 읽는다.
 * 윈도에서는 역슬래시 든 파일 이름을 못 만들어 디스크로는 못 재니, 규칙이 무엇을 찾는지를 잰다.
 */
{
  check('★ G4 `foo\\\\ ` 는 역슬래시 글자로 끝난다 (빈칸은 뗀다)', 끝빈칸떼기('foo\\\\ ') === 'foo\\\\', JSON.stringify(끝빈칸떼기('foo\\\\ ')));
  const r = 패턴규칙('foo\\\\ ');
  check('★ G4 그 규칙은 `foo\\` 를 찾고 `foo\\ ` 는 안 찾는다', !!r && r.re.test('foo\\') && !r.re.test('foo\\ '), r ? String(r.re) : '(규칙 없음)');
  check('  살린 빈칸 하나는 남긴다', 끝빈칸떼기('foo\\ ') === 'foo\\ ' && 끝빈칸떼기('foo\\  ') === 'foo\\ ');
  check('  그냥 끝 빈칸은 다 뗀다', 끝빈칸떼기('build/   ') === 'build/');
  check('  탭은 git 처럼 안 뗀다', 끝빈칸떼기('x\t') === 'x\t');
  check('  역슬래시로 끝나면 그대로', 끝빈칸떼기('x\\') === 'x\\');
}


// ── 결과 ────────────────────────────────────────────────────────────────
const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n.gitignore 걷기 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? D + '  ' + p.note + X : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
for (const 글 of 못잰것) console.log(`  ${D}· ${글}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
rmSync(root, { recursive: true, force: true });
process.exitCode = fail.length ? 1 : 0;
