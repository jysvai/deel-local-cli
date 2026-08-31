// 이미 깔려 있는 빠른 찾기 도구를 빌려 쓴다 (src/tools/fastgrep.js).
//
// ── 무엇을 재나 ────────────────────────────────────────────────────────
//
// 빠른 것은 여기서 제일 덜 중요하다. 재야 하는 것은 **답이 안 갈리는 것**이다.
//
//   1) rg 가 깔린 PC 와 안 깔린 PC 가 **같은 파일을 본다.** 이게 어긋나면
//      같은 명령이 사람마다 다른 답을 낸다 — 그것도 조용히, 오류 없이.
//   2) 못 물어봤을 때 **'없다' 고 하지 않는다.** rg 가 무늬를 못 읽으면
//      결과가 없는 게 아니라 우리가 못 물어본 것이다.
//   3) 무늬가 **명령이 되지 못한다.** 셸을 안 거친다는 것을 실제로 잰다.
//   4) 무엇으로 찾았는지 **밝힌다.**
//
// rg·git 이 없는 PC 에서도 이 검사는 통과해야 한다. 그래서 엔진이 있는지
// 먼저 보고, 없으면 그 자리를 건너뛰되 **건너뛰었다고 화면에 적는다.**
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  엔진찾기, 엔진잊기, 엔진말, 저장소인가, 줄가르기,
  rg로찾기, git로찾기, 빠르게찾기,
  안볼확장자, 안볼정규식, 안볼글로브,
} from '../src/tools/fastgrep.js';
import { TOOLS } from '../src/tools/index.js';
import { walk, 훑기상한, 기본훑기상한 } from '../src/tools/fsutil.js';
import { 건너뜀말 } from '../src/tools/ignore.js';
import { 깃 } from '../src/agent/commit.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const skip = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 건너뜀 = (name, 왜) => skip.push({ name, 왜 });

// ── 0. 본보기 폴더 ─────────────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'deel-fast-'));
const 쓰기 = (rel, 글) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, 글, 'utf8');
};
쓰기('src/a.js', 'const 찾을것 = 1;\n// 두 번째 줄에도 찾을것\n');
쓰기('src/깊은 폴더/b.js', 'const 찾을것 = 2;\n');   // 이름에 빈칸과 한글
쓰기('src/번들.min.js', `x${'a'.repeat(300)}찾을것\n`);
쓰기('src/지도.map', '찾을것\n');
쓰기('없는것.txt', '아무것도\n');

const 엔진 = 엔진찾기({ 다시: true });

// ── 1. 줄 가르기 — 윈도우의 `C:` 함정 ──────────────────────────────────
trace('1-줄가르기');
{
  const a = 줄가르기('C:\\Users\\x\\a.js:42:const x = 1;');
  check('윈도우 드라이브 글자를 파일 이름으로 안 자른다', a?.파일 === 'C:\\Users\\x\\a.js' && a?.줄 === 42, JSON.stringify(a));
  const b = 줄가르기('/home/x/a.js:7:const y = 2;');
  check('유닉스 경로도 가른다', b?.파일 === '/home/x/a.js' && b?.줄 === 7, JSON.stringify(b));
  const c = 줄가르기('a.js:1:const t = { x: 1, y: 2 };');
  check('내용 속 콜론은 안 건드린다', c?.내용 === 'const t = { x: 1, y: 2 };', JSON.stringify(c));
  const d = 줄가르기('src/한글 폴더/파일.js:9:값');
  check('빈칸·한글이 든 경로도 가른다', d?.파일 === 'src/한글 폴더/파일.js' && d?.줄 === 9, JSON.stringify(d));
  check('꼴이 안 맞으면 null — 지어내지 않는다', 줄가르기('그냥 줄글') === null);
  check('빈 줄도 null', 줄가르기('') === null);
}

// ── 2. 안 볼 확장자 목록은 한 벌뿐이다 ─────────────────────────────────
trace('2-한벌');
{
  // 여기가 갈리면 rg 가 깔린 사람만 번들 속 글자를 찾게 된다. 오류는 안 난다.
  check('목록에서 정규식이 나온다', 안볼정규식.test('a.png') && 안볼정규식.test('b.min.js') && !안볼정규식.test('c.js'));
  check('대소문자를 안 가린다', 안볼정규식.test('A.PNG') && 안볼정규식.test('X.Min.Js'));
  const 글로브 = 안볼글로브();
  check('목록에서 rg 옵션이 나온다', 글로브.length === 안볼확장자.length * 2, `${글로브.length} vs ${안볼확장자.length * 2}`);
  check('rg 옵션은 전부 빼기(!)다', 글로브.filter((x) => x !== '--iglob').every((x) => x.startsWith('!*.')), 글로브.slice(0, 4).join(' '));
  check('목록의 모든 확장자가 정규식에도 걸린다', 안볼확장자.every((x) => 안볼정규식.test(`파일.${x}`)),
    안볼확장자.filter((x) => !안볼정규식.test(`파일.${x}`)).join(','));
  check('.js · .ts · .md 는 안 걸린다', !['js', 'ts', 'md', 'py', 'json', 'txt'].some((x) => 안볼정규식.test(`파일.${x}`)));
}

// ── 3. 엔진 고르기 ─────────────────────────────────────────────────────
trace('3-엔진');
{
  const 켠것 = 엔진찾기({ 다시: true, env: {} });
  check('아무 말 없으면 있는 대로 쓴다', 켠것.왜 === null, JSON.stringify(켠것));
  const 끈것 = 엔진찾기({ 다시: true, env: { DEEL_GREP: 'js' } });
  check('DEEL_GREP=js 면 둘 다 끈다', 끈것.rg === false && 끈것.gitgrep === false, JSON.stringify(끈것));
  check('왜 껐는지 말해 준다', /DEEL_GREP/.test(끈것.왜 ?? ''), 끈것.왜);
  check('껐으면 빠르게찾기가 null 을 준다 — 부르는 쪽이 예전 길로 간다',
    await 빠르게찾기({ 무늬: '찾을것', 자리: root }) === null);
  엔진잊기();
  check('엔진잊기 뒤에는 다시 본다', 엔진찾기().rg === 엔진.rg, JSON.stringify(엔진찾기()));

  check('엔진말은 무엇으로 찾았는지 밝힌다', /rg 으로 찾았습니다/.test(엔진말('rg')), 엔진말('rg'));
  check('엔진이 없으면 빈 말', 엔진말(null) === '' && 엔진말('') === '');
}

// ── 4. rg 로 찾기 ──────────────────────────────────────────────────────
trace('4-rg');
if (엔진.rg) {
  const r = await rg로찾기({ 무늬: '찾을것', 자리: root });
  check('rg 가 찾아 온다', r.ok === true, JSON.stringify(r).slice(0, 120));
  const 판 = r.줄들.map(줄가르기).filter(Boolean);
  const 파일들 = [...new Set(판.map((x) => x.파일.replace(/\\/g, '/').replace(root.replace(/\\/g, '/'), '.')))].sort();
  check('한글·빈칸이 든 경로도 온전히 온다', 파일들.includes('./src/깊은 폴더/b.js'), 파일들.join(' '));
  check('번들·지도는 안 뒤진다 (안 볼 확장자)', !파일들.some((f) => /min\.js|\.map$/.test(f)), 파일들.join(' '));
  check('한 파일에 두 줄이면 두 줄로 온다', 판.filter((x) => /a\.js$/.test(x.파일)).length === 2, String(판.length));

  // 못 찾은 것과 못 물어본 것은 다르다.
  const 빈것 = await rg로찾기({ 무늬: '이런글자는없다', 자리: root });
  check('못 찾으면 성공에 빈 목록 (실패가 아니다)', 빈것.ok === true && 빈것.줄들.length === 0, JSON.stringify(빈것));
  const 못읽음 = await rg로찾기({ 무늬: '(?<=foo)bar', 자리: root });
  check('무늬를 못 읽으면 실패로 돌려준다', 못읽음.ok === false, JSON.stringify(못읽음));
  check('빠르게찾기는 그때 null 을 준다 — "없다" 가 아니다',
    await 빠르게찾기({ 무늬: '(?<=foo)bar', 자리: root }) === null);

  // 상한.
  const 잘림 = await rg로찾기({ 무늬: '찾을것', 자리: root, 최대: 1 });
  check('최대를 넘으면 자르고 잘랐다고 한다', 잘림.줄들.length === 1 && 잘림.잘림 === true, JSON.stringify(잘림.잘림));
} else {
  건너뜀('rg 로 찾기', '이 PC 에 rg 가 없습니다');
}

// ── 5. 무늬가 명령이 되지 못한다 ───────────────────────────────────────
trace('5-셸');
{
  const 표 = join(root, '흔적.txt');
  const 위험한무늬 = [
    `찾을것"; echo PWNED > "${표}`,
    '찾을것$(echo PWNED)',
    '찾을것`echo PWNED`',
    '찾을것; echo PWNED',
    '찾을것 && echo PWNED',
    '-찾을것',           // 옵션처럼 생긴 무늬
    '--version',          // 진짜 옵션 이름
  ];
  let 터짐 = null;
  for (const 무늬 of 위험한무늬) {
    try { await 빠르게찾기({ 무늬, 자리: root }); } catch (err) { 터짐 = `${무늬} → ${err.message}`; }
  }
  check('위험하게 생긴 무늬에 안 터진다', 터짐 === null, 터짐 ?? '');
  check('무늬가 명령이 되지 않는다 — 흔적 파일이 안 생겼다', !existsSync(표), 표);

  // 옵션처럼 생긴 무늬는 글자 그대로 찾아야 한다 (`--` 뒤로 넘기니까).
  쓰기('옵션.txt', '이 줄에는 --version 이라는 글자가 있다\n');
  if (엔진.rg) {
    const r = await 빠르게찾기({ 무늬: '--version', 자리: root });
    check('`--version` 은 옵션이 아니라 찾을 글자로 읽힌다',
      r !== null && r.줄들.some((x) => /옵션\.txt/.test(x.파일)), JSON.stringify(r?.줄들?.[0] ?? r));
  } else {
    건너뜀('`--version` 을 글자로 읽는다', '이 PC 에 rg 가 없습니다');
  }
}

// ── 6. git grep ────────────────────────────────────────────────────────
trace('6-git');
if (엔진.gitgrep) {
  const g저장소 = mkdtempSync(join(tmpdir(), 'deel-fastgit-'));
  깃(g저장소, ['init', '-q'], {});
  깃(g저장소, ['config', 'user.email', 'a@b.c'], {});
  깃(g저장소, ['config', 'user.name', '검사'], {});
  writeFileSync(join(g저장소, 'a.js'), 'const 찾을것 = 1;\n', 'utf8');
  writeFileSync(join(g저장소, '번들.min.js'), '찾을것\n', 'utf8');
  깃(g저장소, ['add', '-A'], {});
  깃(g저장소, ['commit', '-m', '첫 커밋'], {});

  check('저장소인지 안다', 저장소인가(g저장소) === true);
  check('저장소가 아니면 아니라고 한다', 저장소인가(root) === false, root);

  const r = await git로찾기({ 무늬: '찾을것', 자리: g저장소 });
  check('git grep 이 찾아 온다', r.ok === true, JSON.stringify(r).slice(0, 120));
  const 판 = r.줄들.map(줄가르기).filter(Boolean);
  check('상대경로가 아니라 절대경로로 맞춰 준다', 판.every((x) => /^([A-Za-z]:|\/)/.test(x.파일)), JSON.stringify(판[0]));
  check('git grep 도 번들은 안 뒤진다', !판.some((x) => /min\.js/.test(x.파일)), 판.map((x) => x.파일).join(' '));
  const 빈것 = await git로찾기({ 무늬: '이런글자는없다', 자리: g저장소 });
  check('git grep 도 못 찾은 것은 성공에 빈 목록', 빈것.ok === true && 빈것.줄들.length === 0, JSON.stringify(빈것));
} else {
  건너뜀('git grep', '이 PC 에 git 이 없습니다');
}

// ── 7. 두 길이 같은 답을 낸다 (제일 중요한 것) ─────────────────────────
trace('7-같은답');
{
  const 큰폴더 = mkdtempSync(join(tmpdir(), 'deel-fastsame-'));
  const 쓰기2 = (rel, 글) => {
    const p = join(큰폴더, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, 글, 'utf8');
  };
  쓰기2('.gitignore', 'out/\n*.log\n');
  쓰기2('src/a.js', 'needle 하나\n');
  쓰기2('src/b.ts', 'needle 둘\nneedle 셋\n');
  쓰기2('src/한글 이름.js', 'needle 넷\n');
  쓰기2('out/숨을것.js', 'needle 다섯\n');
  쓰기2('버릴것.log', 'needle 여섯\n');
  쓰기2('번들.min.js', 'needle 일곱\n');
  쓰기2('사진.png', 'needle 여덟\n');
  for (let i = 0; i < 200; i++) 쓰기2(`많은것/f${i}.js`, i % 7 === 0 ? 'needle 많음\n' : '아무것도\n');

  const ctx = {
    scope: makeScope(큰폴더), history: new History(큰폴더), audit: new Audit(큰폴더), seen: new Set(),
  };
  const 앞부분 = (글) => String(글).split('\n\n')[0].split('\n').map((l) => l.trim()).filter(Boolean).sort();

  엔진잊기();
  const 빠른 = await TOOLS.Grep.run({ pattern: 'needle' }, ctx);
  process.env.DEEL_GREP = 'js';
  엔진잊기();
  const 예전 = await TOOLS.Grep.run({ pattern: 'needle' }, ctx);
  delete process.env.DEEL_GREP;
  엔진잊기();

  const A = 앞부분(빠른.content); const B = 앞부분(예전.content);
  check('두 길이 같은 파일 목록을 낸다', A.join('|') === B.join('|'), `빠른: ${A.length}개 / 예전: ${B.length}개 — 다른 것: ${[...A, ...B].filter((x) => !A.includes(x) || !B.includes(x)).join(' ')}`);
  check('둘 다 .gitignore 를 지킨다', !A.some((f) => /out\/|\.log/.test(f)) && !B.some((f) => /out\/|\.log/.test(f)), A.join(' '));
  check('둘 다 번들·그림은 안 뒤진다', !A.some((f) => /min\.js|\.png/.test(f)) && !B.some((f) => /min\.js|\.png/.test(f)), A.join(' '));
  check('둘 다 한글 이름을 제대로 낸다', A.some((f) => /한글 이름\.js/.test(f)), A.join(' '));

  // 줄까지 같아야 한다 — 파일만 같고 줄이 다르면 사람이 엉뚱한 데로 간다.
  엔진잊기();
  const 빠른줄 = await TOOLS.Grep.run({ pattern: 'needle', output_mode: 'content' }, ctx);
  process.env.DEEL_GREP = 'js';
  엔진잊기();
  const 예전줄 = await TOOLS.Grep.run({ pattern: 'needle', output_mode: 'content' }, ctx);
  delete process.env.DEEL_GREP;
  엔진잊기();
  check('줄 수도 같다', 앞부분(빠른줄.content).length === 앞부분(예전줄.content).length,
    `빠른: ${앞부분(빠른줄.content).length} / 예전: ${앞부분(예전줄.content).length}`);
  check('한 파일에 두 번 있으면 두 줄로 온다', 앞부분(빠른줄.content).filter((l) => /b\.ts/.test(l)).length === 2,
    앞부분(빠른줄.content).filter((l) => /b\.ts/.test(l)).join(' | '));

  // 요약에 엔진 이름이 들어간다 — 결과가 이상할 때 사람이 짚을 수 있어야 한다.
  if (엔진.rg || 엔진.gitgrep) {
    check('요약이 무엇으로 찾았는지 말한다', /rg|git grep/.test(String(빠른.summary)), String(빠른.summary));
  } else {
    건너뜀('요약이 엔진을 말한다', '이 PC 에 빠른 엔진이 없습니다');
  }
  check('예전 길 요약에는 엔진 이름이 없다', !/rg|git grep/.test(String(예전.summary)), String(예전.summary));

  // 파일을 콕 짚어 주면 빠른 엔진을 안 부른다 (한 파일에 프로세스를 띄울 값이 없다).
  const 한파일 = await TOOLS.Grep.run({ pattern: 'needle', path: 'src/a.js' }, ctx);
  check('파일을 짚으면 예전 길로 간다', !/rg|git grep/.test(String(한파일.summary)) && /a\.js/.test(String(한파일.content)),
    `${한파일.summary} / ${한파일.content}`);
}

// ── 8. 자바스크립트만 되는 무늬는 조용히 틀리지 않는다 ─────────────────
trace('8-되돌아보기');
{
  // rg 의 정규식에는 되돌아보기가 없다. 그때 rg 가 "없다" 고 하면 사람은 진짜
  // 없는 줄 안다. 예전 길로 내려가서 **찾아 내야** 한다.
  const 방 = mkdtempSync(join(tmpdir(), 'deel-fastlb-'));
  writeFileSync(join(방, 'a.js'), 'const foobar = 1;\n', 'utf8');
  const ctx = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set() };
  엔진잊기();
  const r = await TOOLS.Grep.run({ pattern: '(?<=foo)bar' }, ctx);
  check('되돌아보기 무늬도 결국 찾아 낸다', /a\.js/.test(String(r.content)), String(r.content).slice(0, 120));
  check('그때는 예전 길로 갔다고 요약이 말해 준다', !/rg|git grep/.test(String(r.summary)), String(r.summary));
  check('원본은 안 건드린다', readFileSync(join(방, 'a.js'), 'utf8') === 'const foobar = 1;\n');
}

// ── 9. 훑기 상한 — 안 본 것을 '없다' 로 말하지 않는다 ──────────────────
trace('9-상한');
{
  /*
   * 여기가 이 파일에서 제일 중요한 자리다.
   *
   * `walk` 는 2만 개에서 멈추는데, 전에는 그 말을 아무 데도 안 했다. 그래서
   * 파일 5만 개짜리 저장소에서 `Grep` 이 **"일치 없음"** 이라고 답했다 —
   * 뒤쪽 3만 개에 100군데가 있는데도. 못 찾은 것과 안 본 것은 다르다.
   *
   * 상한을 300개짜리 폴더에 100 으로 낮춰서 그 자리를 그대로 만든다.
   */
  const 방 = mkdtempSync(join(tmpdir(), 'deel-cap-'));
  mkdirSync(join(방, 'src'), { recursive: true });
  for (let i = 0; i < 300; i++) {
    // 바늘은 맨 뒤에 둔다 — 상한에 걸리면 못 보는 자리에.
    writeFileSync(join(방, 'src', `f${String(i).padStart(3, '0')}.js`), i === 299 ? 'const 바늘 = 1;\n' : 'x\n', 'utf8');
  }
  const ctx = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set() };

  check('상한이 넉넉하면 잘렸다고 안 한다', walk(방).잘림 === false, JSON.stringify(walk(방).length));
  check('기본 상한은 20,000', 기본훑기상한 === 20000, String(기본훑기상한));
  check('터무니없는 값은 안 받는다', 훑기상한({ DEEL_WALK_LIMIT: '3' }) === 20000 && 훑기상한({ DEEL_WALK_LIMIT: '없음' }) === 20000
    && 훑기상한({ DEEL_WALK_LIMIT: '99999999' }) === 20000, String(훑기상한({ DEEL_WALK_LIMIT: '3' })));
  check('제대로 된 값은 받는다', 훑기상한({ DEEL_WALK_LIMIT: '100' }) === 100);

  const 잘린것 = walk(방, { limit: 100 });
  check('상한에서 멈추면 잘렸다고 표시한다', 잘린것.잘림 === true && 잘린것.length === 100, `${잘린것.length}개`);
  check('몇 개까지 봤는지도 붙여 준다', 잘린것.상한 === 100, String(잘린것.상한));
  check('잘림은 열거되지 않는다 (JSON 에 안 섞인다)',
    !Object.keys(잘린것).includes('잘림') && !('잘림' in JSON.parse(JSON.stringify(잘린것))));

  check('건너뜀말이 잘린 것을 말한다', /100개까지만 봤습니다/.test(건너뜀말({ 폴더: 0, 파일: 0 }, true, 100)), 건너뜀말({ 폴더: 0, 파일: 0 }, true, 100));
  check('안 잘렸으면 그 말은 안 붙는다', 건너뜀말({ 폴더: 0, 파일: 0 }, false, 100) === '');
  check('수를 모르면 수 없이 말한다', /앞부분만 봤습니다/.test(건너뜀말({ 폴더: 0, 파일: 0 }, true)), 건너뜀말({ 폴더: 0, 파일: 0 }, true));

  process.env.DEEL_WALK_LIMIT = '100';
  process.env.DEEL_GREP = 'js';
  엔진잊기();
  const 못본것 = await TOOLS.Grep.run({ pattern: '바늘' }, ctx);
  const 못본글로브 = TOOLS.Glob.run({ pattern: '**/f299.js' }, ctx);
  delete process.env.DEEL_WALK_LIMIT;
  delete process.env.DEEL_GREP;
  엔진잊기();

  // ★ 이 세 줄이 이 파일의 전부다.
  check('★ 다 못 봤으면 "일치 없음" 이라고 잘라 말하지 않는다',
    /본 데까지는 일치 없음/.test(String(못본것.content)), String(못본것.content).split('\n')[0]);
  check('★ 몇 개까지 봤는지 말해 준다', /100개까지만 봤습니다/.test(String(못본것.content)), String(못본것.content).split('\n').pop());
  check('★ 요약에도 다 못 봤다고 적는다', /다 못 봄/.test(String(못본것.summary)), String(못본것.summary));
  check('무엇을 하면 되는지도 알려 준다', /폴더를 좁혀서/.test(String(못본것.content)), String(못본것.content).split('\n').pop());
  check('Glob 도 똑같이 말한다', /본 데까지는 찾은 파일 없음/.test(String(못본글로브.content)) && /다 못 봄/.test(String(못본글로브.summary)),
    `${못본글로브.summary} / ${String(못본글로브.content).split('\n')[0]}`);

  // 상한이 넉넉하면 군말이 없어야 한다. 늘 붙으면 그 말이 뜻을 잃는다.
  process.env.DEEL_GREP = 'js';
  엔진잊기();
  const 다본것 = await TOOLS.Grep.run({ pattern: '바늘' }, ctx);
  delete process.env.DEEL_GREP;
  엔진잊기();
  check('다 봤으면 군말을 안 붙인다', !/봤습니다|다 못 봄/.test(`${다본것.content}${다본것.summary}`), String(다본것.content));
  check('다 봤으면 실제로 찾아 낸다', /f299\.js/.test(String(다본것.content)), String(다본것.content));
}

엔진잊기();

const G = '\x1b[32m'; const R = '\x1b[31m'; const Y = '\x1b[33m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n빠른 찾기 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
for (const s of skip) console.log(`  ${Y}－${X} ${s.name}  ${D}${s.왜}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패${skip.length ? ` · ${skip.length}개 건너뜀` : ''}\n`);
process.exitCode = fail.length ? 1 : 0;
