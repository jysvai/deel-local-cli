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
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  엔진찾기, 엔진잊기, 엔진말, 저장소인가, 줄가르기,
  rg로찾기, rg가못준까닭, rg못푸는파일, git후보파일, git못푸는파일, 꼭있는글자, rg글로브들, 빠르게찾기,
  안볼확장자, 안볼정규식, 안볼글로브, 안볼폴더글로브,
} from '../src/tools/fastgrep.js';
import { TOOLS } from '../src/tools/index.js';
import { walk, 훑기상한, 기본훑기상한, SKIP_DIRS } from '../src/tools/fsutil.js';
import { encode } from '../src/tools/encoding.js';
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
  // 리눅스·맥은 파일 이름에 콜론을 쓸 수 있다. `:숫자:` 가 든 이름을 게으른 정규식이 앞에서 잘랐다
  // (2.0.0 6회차 Gemini 빠른찾기6). rg 가 `--null` 로 경로 끝에 NUL 을 찍으니 그 자리로 가른다.
  const NUL = String.fromCharCode(0);
  const e = 줄가르기(`logs/backup-12:30:45.txt${NUL}7:hello`);
  check('★ 경로에 :숫자: 가 들어도 NUL 자리에서 가른다 (6회차 빠른찾기6)',
    e?.파일 === 'logs/backup-12:30:45.txt' && e?.줄 === 7 && e?.내용 === 'hello', JSON.stringify(e));
  check('  NUL 뒤 꼴이 안 맞으면 null', 줄가르기(`a.js${NUL}줄번호없음`) === null);
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

  // 안 볼 **폴더**도 한 벌에서 나와야 한다. 여기가 갈리면 rg 가 깔린 사람만
  // dist/ 속 번들을 뒤지고, 그건 오류도 안 나고 꼬리말도 안 붙는다.
  const 폴더글로브 = 안볼폴더글로브();
  check('안 볼 폴더 목록도 walk 와 같은 한 벌에서 나온다', 폴더글로브.length === SKIP_DIRS.size * 2,
    `${폴더글로브.length} vs ${SKIP_DIRS.size * 2}`);
  check('폴더 옵션도 전부 빼기(!)다', 폴더글로브.filter((x) => x !== '--iglob').every((x) => x.startsWith('!') && x.endsWith('/')),
    폴더글로브.slice(0, 4).join(' '));
  check('node_modules · dist · .git 이 그 안에 있다',
    ['!node_modules/', '!dist/', '!.git/'].every((x) => 폴더글로브.includes(x)), 폴더글로브.join(' ').slice(0, 120));
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
  check('번들·지도는 안 뒤진다 (안 볼 확장자)', !파일들.some((f) => /(?:min\.js)|(?:\.map$)/.test(f)), 파일들.join(' '));
  check('한 파일에 두 줄이면 두 줄로 온다', 판.filter((x) => /a\.js$/.test(x.파일)).length === 2, String(판.length));
  check('★ rg 는 경로 끝을 NUL 로 찍게 부른다 (6회차 빠른찾기6)', r.줄들.length > 0 && r.줄들.every((l) => l.includes(String.fromCharCode(0))),
    JSON.stringify(r.줄들[0] ?? '').slice(0, 80));

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

  // git grep 은 파일만 추린다 — 읽기는 자바스크립트 길과 같은 함수로 (fastgrep.js 의 꼭있는글자 머리말).
  const r = await git후보파일({ 글자: '찾을것', 자리: g저장소 });
  check('git grep 이 파일을 추려 온다', r.ok === true && r.파일들.some((f) => /a\.js$/.test(f)), JSON.stringify(r).slice(0, 160));
  check('상대경로가 아니라 절대경로로 맞춰 준다', r.파일들.every((f) => /^([A-Za-z]:|\/)/.test(f)), JSON.stringify(r.파일들[0]));
  check('git grep 도 번들은 안 뒤진다', !r.파일들.some((f) => /min\.js/.test(f)), r.파일들.join(' '));
  const 빈것 = await git후보파일({ 글자: '이런글자는없다', 자리: g저장소 });
  check('git grep 도 못 찾은 것은 성공에 빈 목록', 빈것.ok === true && 빈것.파일들.length === 0, JSON.stringify(빈것));
  writeFileSync(join(g저장소, 'k.txt'), encode('결재 요청\n', 'euc-kr').buf);
  const 못푼 = await git못푸는파일({ 자리: g저장소 });
  check('★ git 이 UTF-8 로 못 푸는 파일을 로케일과 상관없이 센다', 못푼.ok === true && 못푼.파일들.some((f) => /k\.txt$/.test(f))
    && !못푼.파일들.some((f) => /a\.js$/.test(f)), JSON.stringify(못푼).slice(0, 200));
} else {
  건너뜀('git grep', '이 PC 에 git 이 없습니다');
}

// 맞는 줄이 **반드시** 품는 글자 — 넓게 잡으면 git grep 길이 답을 놓친다.
{
  const 표 = [
    ['결재', {}, '결재'],
    ['foo\\d+', {}, 'foo'],
    ['end\\$$', {}, 'end$'],
    ['a|b', {}, null],
    ['\\p{Hangul}+', {}, null],
    ['function\\s+(\\w+)', {}, 'function'],
    ['colou?r', {}, 'colo'],
    ['(abcde)?fg', {}, 'fg'],
    ['(?:xy|zw)zz', {}, 'zz'],
    ['(?!foofoo)bar', {}, 'bar'],
    ['\\x41BCD', {}, 'BCD'],
    ['\\u0041xyz', {}, 'xyz'],
    ['[abc]def', {}, 'def'],
    ['ab*', {}, 'a'],
    ['mask', { 대소문자무시: true }, 'ma'],
    ['Éclair', { 대소문자무시: true }, 'clair'],
    ['(unclosed', {}, null],
  ];
  const 틀림 = 표.filter(([무늬, 옵, 기대]) => 꼭있는글자(무늬, 옵) !== 기대)
    .map(([무늬, 옵, 기대]) => `${무늬}${옵.대소문자무시 ? '(i)' : ''} → ${JSON.stringify(꼭있는글자(무늬, 옵))} (기대 ${JSON.stringify(기대)})`);
  check('★★ 꼭있는글자 — 모르면 끊고, 갈래·없어도 되는 것·앞뒤 보기는 믿지 않는다', 틀림.length === 0, 틀림.join(' | '));
  const 뜻 = [
    [rg글로브들('src/*.js', { 자리: '/r/src', 뿌리: '/r' }), ['src/*.js', 'src/src/*.js']],
    [rg글로브들('*.js', { 자리: '/r/src', 뿌리: '/r' }), ['*.js']],
    [rg글로브들('!sub/**', { 자리: '/r/src', 뿌리: '/r' }), ['!sub/**', '!src/sub/**']],
    [rg글로브들('/a/*.js', { 자리: '/r/src', 뿌리: '/r' }), ['/a/*.js']],
  ].filter(([받은, 기대]) => 받은.join('|') !== 기대.join('|'));
  check('rg글로브들 — 빗금 든 무늬만 찾는 폴더 기준 무늬를 더한다 (뿌리에 묶인 / 무늬는 안 더한다)', 뜻.length === 0, JSON.stringify(뜻));
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
  /*
   * 점 파일과 살림 폴더 — 두 길이 **여기서** 갈렸다.
   *
   * rg 는 점으로 시작하는 것을 기본으로 안 보고, 자바스크립트 길에는 그런
   * 규칙이 아예 없다. 거꾸로 자바스크립트 길은 SKIP_DIRS(dist·venv…)를
   * 안 훑는데 rg 는 그 목록을 모른다. 그래서 같은 명령이 —
   *
   *   rg 가 있는 PC  →  dist/번들.js · venv/lib.js
   *   rg 가 없는 PC  →  .github/workflows/ci.yml · .env.example
   *
   * 겹치는 답이 src/a.js 하나뿐이었다. 「CI 설정 어디서 고쳐」 를 rg 가 깔린
   * PC 에서 물으면 한 줄도 안 나오고, 모델은 그 침묵을 사실로 받아
   * 「이 저장소에는 워크플로가 없습니다」 로 답을 맺는다.
   */
  쓰기2('.github/workflows/ci.yml', '# needle 아홉\n');
  쓰기2('.env.example', 'KEY=needle 열\n');
  쓰기2('dist/번들.js', 'needle 열하나\n');
  쓰기2('venv/lib.js', 'needle 열둘\n');
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
  const 점것 = (목록) => 목록.filter((f) => f.startsWith('.')).join(' ') || '(없음)';
  const 살림것 = (목록) => 목록.filter((f) => /^(dist|venv)\//.test(f)).join(' ') || '(없음)';
  check('★ 두 길 다 점으로 시작하는 것을 본다 (.github · .env.example)',
    ['.github/workflows/ci.yml', '.env.example'].every((f) => A.includes(f) && B.includes(f)),
    `빠른: ${점것(A)} / 예전: ${점것(B)}`);
  check('★ 두 길 다 살림 폴더(dist · venv)는 안 본다',
    !A.some((f) => /^(dist|venv)\//.test(f)) && !B.some((f) => /^(dist|venv)\//.test(f)),
    `빠른: ${살림것(A)} / 예전: ${살림것(B)}`);

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

  /*
   * 요약에 엔진 이름이 들어간다 — 결과가 이상할 때 사람이 짚을 수 있어야 한다.
   *
   * 물을 때 조심할 것 — `엔진.gitgrep` 은 「git 이 깔렸다」 만 뜻하지
   * 「여기서 쓸 수 있다」 는 아니다. git grep 은 **저장소 안에서만** 돌고
   * (tools/fastgrep.js 의 저장소인가), 이 큰폴더는 저장소가 아니다.
   *
   * 그래서 rg 가 안 깔린 컴퓨터(CI 러너가 그렇다)에서는 빠른 길을 쓸 길이
   * 없는데도 「엔진 이름이 적혀 있어야 한다」 고 재고 있었다. 제품 코드는
   * 제대로 물러서고 있었고, 틀린 것은 이 가릅이다.
   */
  if (엔진.rg || (엔진.gitgrep && 저장소인가(큰폴더))) {
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

  const 안잘린것 = await walk(방);
  check('상한이 넉넉하면 잘렸다고 안 한다', 안잘린것.잘림 === false, JSON.stringify(안잘린것.length));
  check('기본 상한은 20,000', 기본훑기상한 === 20000, String(기본훑기상한));
  check('터무니없는 값은 안 받는다', 훑기상한({ DEEL_WALK_LIMIT: '3' }) === 20000 && 훑기상한({ DEEL_WALK_LIMIT: '없음' }) === 20000
    && 훑기상한({ DEEL_WALK_LIMIT: '99999999' }) === 20000, String(훑기상한({ DEEL_WALK_LIMIT: '3' })));
  check('제대로 된 값은 받는다', 훑기상한({ DEEL_WALK_LIMIT: '100' }) === 100);

  const 잘린것 = await walk(방, { limit: 100 });
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
  const 못본글로브 = await TOOLS.Glob.run({ pattern: '**/f299.js' }, ctx);
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

// ── 10. rg 가 못 푸는 글 파일도 두 길이 같은 답을 낸다 ─────────────────
trace('10-옛인코딩');
{
  /*
   * rg 는 UTF-8 과 **표식 있는** UTF-16 만 글자로 푼다. 그래서 같은 폴더에서
   * 「결재」 를 찾으면 —
   *
   *   rg 가 있는 PC  →  src/a.js
   *   rg 가 없는 PC  →  src/a.js · k949.txt · n16.txt · late.txt
   *
   * 사내 CP949 문서, 파워셸이 표식 없이 흘린 UTF-16, 8KB 뒤에 NUL 이 하나
   * 끼인 로그가 rg 쪽에서만 통째로 사라진다. 오류도 꼬리말도 없으니 사람은
   * 「그런 문서가 없다」 로 읽는다 — 이 파일 머리말이 막으려던 바로 그 고장이다.
   *
   * `\p{Hangul}` 은 거꾸로다. rg 는 알아듣는데 자바스크립트 길은 `u` 없이
   * 정규식을 만들어서 한 줄도 못 찾았다. glob 의 `[!0-9]` 와 앞머리 `./` 는
   * 자바스크립트 길(과 Glob 도구)만 못 알아들었다.
   */
  const 방 = mkdtempSync(join(tmpdir(), 'deel-fastenc-'));
  const 넣기 = (rel, 바이트) => { const p = join(방, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, 바이트); };
  넣기('k949.txt', encode('결재 요청드립니다 금액 확인\n두 번째 줄 결재\n', 'euc-kr').buf);
  넣기('n16.txt', Buffer.from('결재 요청 문서 UTF16 without bom\r\n', 'utf16le'));
  넣기('late.txt', Buffer.concat([Buffer.from('a'.repeat(9000) + '\n'), Buffer.from([0]), Buffer.from('\n결재 늦게 나옴\n')]));
  넣기('src/a.js', '// 한글 주석 결재\nTODO\n');
  넣기('진짜.bin2', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3, 0]), Buffer.from('결재\n')]));
  넣기('file1.txt', 'HIT\n');
  넣기('filea.txt', 'HIT\n');
  const ctx = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set() };
  const 목록 = (r) => String(r.content ?? r.error ?? '').split('\n\n')[0].split('\n').map((l) => l.trim()).filter(Boolean).sort();
  const 두길 = async (args) => {
    엔진잊기();
    const 빠른 = await TOOLS.Grep.run(args, ctx);
    process.env.DEEL_GREP = 'js';
    엔진잊기();
    const 예전 = await TOOLS.Grep.run(args, ctx);
    delete process.env.DEEL_GREP;
    엔진잊기();
    return { A: 목록(빠른), B: 목록(예전), 빠른, 예전 };
  };
  const 둘다 = (x, 이름) => x.A.includes(이름) && x.B.includes(이름);
  const 보임 = (x) => `빠른(${x.빠른.summary}): ${x.A.join(' ')} / 예전: ${x.B.join(' ')}`;

  const 한글 = await 두길({ pattern: '결재' });
  check('★★ 두 길 다 CP949 파일에서 찾는다', 둘다(한글, 'k949.txt'), 보임(한글));
  check('★★ 두 길 다 표식 없는 UTF-16LE 파일에서 찾는다', 둘다(한글, 'n16.txt'), 보임(한글));
  check('★★ 두 길 다 8KB 뒤에 NUL 이 낀 글 파일에서 찾는다', 둘다(한글, 'late.txt'), 보임(한글));
  check('★ 진짜 바이너리는 두 길 다 안 본다', !한글.A.includes('진짜.bin2') && !한글.B.includes('진짜.bin2'), 보임(한글));
  check('★ 파일 목록이 통째로 같다', 한글.A.join('|') === 한글.B.join('|'), 보임(한글));

  const 줄 = await 두길({ pattern: '결재', output_mode: 'content' });
  check('★ 줄 번호와 내용까지 같다 (옛 인코딩도 글자로 풀어서 보여 준다)', 줄.A.join('|') === 줄.B.join('|'), 보임(줄));
  check('CP949 파일의 두 번째 줄도 글자로 온다', 줄.A.includes('k949.txt:2: 두 번째 줄 결재'), 줄.A.join(' | '));

  const 갈래 = await 두길({ pattern: '\\p{Hangul}+', output_mode: 'content' });
  check('★★ \\p{Hangul} 을 두 길 다 알아듣는다', 갈래.A.some((l) => l.startsWith('src/a.js:1:')) && 갈래.B.some((l) => l.startsWith('src/a.js:1:')), 보임(갈래));
  const 옛문법 = await 두길({ pattern: 'a\\-b|\\p{L}' });
  check('`u` 로 못 만드는 옛 문법 무늬도 거절하지 않는다', !옛문법.예전.error, String(옛문법.예전.error ?? ''));

  const 빼기 = await 두길({ pattern: 'HIT', glob: 'file[!0-9].txt' });
  check('★ Grep glob 의 [!0-9] 는 빼기다 — 두 길 다', 빼기.A.join('|') === 'filea.txt' && 빼기.B.join('|') === 'filea.txt', 보임(빼기));
  // 빗금 든 glob(`src/*.js`)은 rg 가 제 작업 폴더 기준으로 맞춰 따로 갈린다 — 여기서는 `./` 떼기만 잰다.
  const 점 = await 두길({ pattern: 'HIT', glob: './file[!0-9].txt' });
  check('★ Grep glob 앞의 ./ 를 떼고 본다 — 두 길 다', 점.A.join('|') === 'filea.txt' && 점.B.join('|') === 'filea.txt', 보임(점));

  const 글로브빼기 = await TOOLS.Glob.run({ pattern: 'file[!0-9].txt' }, ctx);
  check('★★ Glob 의 [!0-9] 는 빼기다', 목록(글로브빼기).join('|') === 'filea.txt', 목록(글로브빼기).join(' '));
  const 글로브점 = await TOOLS.Glob.run({ pattern: './src/*.js' }, ctx);
  check('★★ Glob 앞의 ./ 를 떼고 본다', 목록(글로브점).includes('src/a.js'), 목록(글로브점).join(' '));

  /*
   * 중괄호 **안의** 별표가 글자로 굳었다.
   *
   * 갈래를 escapeLiteral 로만 넘겨서 `{*.js,*.ts}` 가 「`*.js` 라는 이름의 파일」 이
   * 됐다. 그런 파일은 없으니 늘 0건이다. 밖에 쓴 `*.{js,ts}` 는 되고 안에 쓴 것만
   * 안 되니, 「찾은 파일 없음」 을 받은 모델은 그 폴더에 그런 파일이 없다고 믿는다 —
   * 아무 말도 없이 틀린 답을 주는 쪽이라 더 나쁘다.
   */
  const 중괄호 = await TOOLS.Glob.run({ pattern: '{file*.txt,src/*.js}' }, ctx);
  check('★★★ 중괄호 갈래 안의 * 도 무늬로 본다',
    ['file1.txt', 'filea.txt', 'src/a.js'].every((f) => 목록(중괄호).includes(f)), 목록(중괄호).join(' '));
  const 중괄호밖 = await TOOLS.Glob.run({ pattern: 'file*.{txt,js}' }, ctx);
  check('  (짝) 중괄호 밖의 * 는 여태대로', 목록(중괄호밖).join('|') === 'file1.txt|filea.txt', 목록(중괄호밖).join(' '));
  const 중괄호물음 = await TOOLS.Glob.run({ pattern: '{file?.txt}' }, ctx);
  check('  (짝) 중괄호 안의 ? 도 한 글자다', 목록(중괄호물음).join('|') === 'file1.txt|filea.txt', 목록(중괄호물음).join(' '));
}

// ── 11. 빗금 든 glob · 절대경로 무늬 · CRLF 의 $ · git grep 길 ─────────
trace('11-glob-git');
{
  /*
   * rg 는 `--glob src/*.js` 를 **제 작업 폴더** 기준으로 맞춘다. deel 이 rg 를
   * 띄울 때 작업 폴더를 안 정해서, 검사처럼 뿌리와 다른 자리에서 돌면 한 줄도
   * 안 나왔고, path=src 로 좁히면 두 엔진 다 `src/**` 를 못 찾았다. 절대경로로
   * 적은 무늬는 「없음」 이었고, CRLF 줄의 `$` 는 두 엔진 다 줄 끝을 못 봤다.
   * git grep 길(rg 없는 저장소)은 옛 인코딩 파일·새 파일·glob·`\d` 를 전부 놓쳤다.
   */
  const 방 = mkdtempSync(join(tmpdir(), 'deel-fastglob-'));
  const 넣기 = (뿌리, rel, 바이트) => { const p = join(뿌리, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, 바이트); };
  넣기(방, 'src/a.js', 'TODO a\n');
  넣기(방, 'src/sub/b.js', 'TODO b\n');
  넣기(방, 'other/o.js', 'TODO o\n');
  넣기(방, 'crlf.txt', 'end$\r\nfoo7\r\n');
  const ctx = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set() };
  const 목록 = (r) => String(r.content ?? r.error ?? '').split('\n\n')[0].split('\n').map((l) => l.trim()).filter(Boolean).sort();
  const 엔진으로 = async (c, 엔진값, args) => {
    if (엔진값) process.env.DEEL_GREP = 엔진값; else delete process.env.DEEL_GREP;
    엔진잊기();
    try { return await TOOLS.Grep.run(args, c); } finally { delete process.env.DEEL_GREP; 엔진잊기(); }
  };
  const 견주기 = async (c, 빠른엔진, args) => {
    const 빠른 = await 엔진으로(c, 빠른엔진, args);
    const 예전 = await 엔진으로(c, 'js', args);
    return { A: 목록(빠른), B: 목록(예전), 빠른, 예전 };
  };
  const 같게 = (x, 기대) => x.A.join('|') === 기대.join('|') && x.B.join('|') === 기대.join('|');
  const 보임 = (x) => `빠른(${x.빠른.summary}): ${x.A.join(' ')} / 예전: ${x.B.join(' ')}`;

  const g1 = await 견주기(ctx, null, { pattern: 'TODO', glob: 'src/*.js' });
  check('★★ 빗금 든 glob(src/*.js)을 두 길이 같게 본다', 같게(g1, ['src/a.js']), 보임(g1));
  const g2 = await 견주기(ctx, null, { pattern: 'TODO', path: 'src', glob: 'src/**/*.js' });
  check('★★ path=src glob=src/**/*.js — 뿌리 기준 glob 을 두 길 다 찾는다', 같게(g2, ['src/a.js', 'src/sub/b.js']), 보임(g2));
  const g3 = await 견주기(ctx, null, { pattern: 'TODO', path: 'src', glob: 'sub/*.js' });
  check('★ path=src glob=sub/*.js — 찾을 자리 기준 glob 도 두 길 다 찾는다', 같게(g3, ['src/sub/b.js']), 보임(g3));
  const g4 = await 견주기(ctx, null, { pattern: 'TODO', glob: '!src/**' });
  check('★ ! 로 시작하는 glob 은 두 길 다 빼기다', 같게(g4, ['other/o.js']), 보임(g4));

  const 끝달러 = await 견주기(ctx, null, { pattern: 'end\\$$', output_mode: 'content' });
  check('★★ CRLF 줄의 $ 를 두 길 다 줄 끝으로 본다',
    끝달러.A.some((l) => l.startsWith('crlf.txt:1:')) && 끝달러.B.some((l) => l.startsWith('crlf.txt:1:')), 보임(끝달러));

  const 절대 = `${방.replace(/\\/g, '/')}/src/*.js`;
  const 절대글로브 = await TOOLS.Glob.run({ pattern: 절대 }, ctx);
  check('★★ Glob 에 작업 폴더 안의 절대경로 무늬를 주면 찾는다', 목록(절대글로브).includes('src/a.js'), String(절대글로브.content ?? 절대글로브.error));
  const 밖글로브 = await TOOLS.Glob.run({ pattern: `${tmpdir().replace(/\\/g, '/')}/*.js` }, ctx);
  check('★ 작업 폴더 밖 절대경로 무늬는 「없음」 대신 범위 밖이라고 한다', !!밖글로브.error && /범위/.test(밖글로브.error),
    String(밖글로브.content ?? 밖글로브.error).split('\n')[0]);
  const 절대그렙 = await 견주기(ctx, null, { pattern: 'TODO', glob: 절대 });
  check('★ Grep glob 의 절대경로도 두 길 다 뿌리 기준으로 푼다', 같게(절대그렙, ['src/a.js']), 보임(절대그렙));

  if (엔진.gitgrep) {
    const 곳 = mkdtempSync(join(tmpdir(), 'deel-fastgit2-'));
    깃(곳, ['init', '-q'], {});
    깃(곳, ['config', 'user.email', 'a@b.c'], {});
    깃(곳, ['config', 'user.name', '검사'], {});
    넣기(곳, 'a.js', 'const foo12 = 1;\n');
    넣기(곳, 'notes.txt', 'foo 메모\n');
    넣기(곳, 'k949.txt', encode('결재 요청드립니다\n', 'euc-kr').buf);
    넣기(곳, 'n16.txt', Buffer.from('결재 요청 문서 without bom\r\n', 'utf16le'));
    넣기(곳, 'late.txt', Buffer.concat([Buffer.from('a'.repeat(9000) + '\n'), Buffer.from([0]), Buffer.from('\n결재 늦게\n')]));
    넣기(곳, 'crlf.txt', 'end$\r\n');
    넣기(곳, 'dist/d.js', 'const foo3 = "결재";\n');
    깃(곳, ['add', '-A'], {});
    깃(곳, ['commit', '-q', '-m', '첫 커밋'], {});
    넣기(곳, '새것.js', '// 결재 foo99 — 커밋 안 한 새 파일\n');
    const gctx = { scope: makeScope(곳), history: new History(곳), audit: new Audit(곳), seen: new Set() };

    const k = await 견주기(gctx, 'git', { pattern: '결재' });
    check('★ DEEL_GREP=git 이면 git grep 으로 찾는다', /git grep/.test(String(k.빠른.summary)), String(k.빠른.summary));
    check('★★ git grep 길도 CP949·표식 없는 UTF-16·늦은 NUL 파일을 찾는다 (JS 와 같은 목록)',
      k.A.join('|') === k.B.join('|') && ['k949.txt', 'n16.txt', 'late.txt'].every((f) => k.A.includes(f)), 보임(k));
    check('★★ git grep 길도 커밋 안 한 새 파일을 찾는다', k.A.includes('새것.js'), 보임(k));
    check('★ git grep 길도 살림 폴더(dist)는 안 본다', !k.A.includes('dist/d.js'), 보임(k));
    const d = await 견주기(gctx, 'git', { pattern: 'foo\\d+' });
    check('★★ \\d 같은 무늬를 git grep 길도 자바스크립트와 같게 읽는다', d.A.join('|') === d.B.join('|') && d.A.includes('a.js'), 보임(d));
    const e = await 견주기(gctx, 'git', { pattern: 'end\\$$' });
    check('★ git grep 길에서도 CRLF 줄의 $ 가 맞는다', e.A.includes('crlf.txt') && e.B.includes('crlf.txt'), 보임(e));
    const gl = await 견주기(gctx, 'git', { pattern: 'foo', glob: '*.js' });
    check('★★ git grep 길도 glob 을 지킨다', gl.A.join('|') === gl.B.join('|') && !gl.A.includes('notes.txt'), 보임(gl));
  } else {
    건너뜀('git grep 길 견주기', '이 PC 에 git 이 없습니다');
  }
}

// ── 12. rg 가 답을 못 준 것과 「없다」 는 다르다 (2.0.0 8회차 파일훑기) ───
trace('12-rg끝맺음');
{
  /*
   * rg 의 끝맺음은 셋뿐이다 — 0(찾음) · 1(못 찾음) · 2(무늬·자리가 틀림).
   * 그런데 판단하는 자리가 `status === 2` 한 줄이었다. 그래서 **신호로 죽은**
   * rg(status 가 숫자가 아니라 null 이다 — spawn.js 의 'close' 가 코드를 그대로
   * 준다)가 남긴 반 토막 stdout 이 **성공**으로 올라갔다. 화면에는 「일치 없음」.
   *
   * 이 파일 머리말 3번이 「결과가 없는 것이 아니라 우리가 못 물어본 것」 이라고
   * 적어 둔 바로 그 자리에서, 못 물어본 것이 없는 것으로 나갔다. OOM killer 가
   * 걷어가거나 사람이 kill 한 자리가 다 이렇다.
   */
  check('★★ 신호로 죽으면(status null) 실패로 본다 — 「없다」 가 아니다',
    !!rg가못준까닭({ error: null, status: null, stdout: '', stderr: '' }),
    String(rg가못준까닭({ error: null, status: null, stdout: '', stderr: '' })));
  check('★★ 반 토막 stdout 이 남아 있어도 실패로 본다',
    !!rg가못준까닭({ error: null, status: null, stdout: 'a.js\x001:x\n', stderr: '' }),
    String(rg가못준까닭({ error: null, status: null, stdout: 'a.js\x001:x\n', stderr: '' })));
  check('★ 0·1 말고 다른 숫자로 끝나도 실패로 본다',
    !!rg가못준까닭({ error: null, status: 137, stdout: '', stderr: '' }),
    String(rg가못준까닭({ error: null, status: 137, stdout: '', stderr: '' })));
  check('  찾았으면(0) 실패가 아니다', rg가못준까닭({ error: null, status: 0, stdout: 'x', stderr: '' }) === null);
  check('  못 찾았으면(1) 그것도 실패가 아니다', rg가못준까닭({ error: null, status: 1, stdout: '', stderr: '' }) === null);
  check('  무늬를 못 읽으면(2) 여전히 실패다', !!rg가못준까닭({ error: null, status: 2, stdout: '', stderr: 'regex parse error' }));
  check('  띄우지도 못했으면 그 말을 그대로 쓴다',
    rg가못준까닭({ error: new Error('spawn rg ENOENT'), status: null, stdout: '', stderr: '' }) === 'spawn rg ENOENT');

  /*
   * ★★★ 그런데 **못 푸는 파일을 세는 쪽**은 이 자를 안 쓰고 있었다 (막판 훑기).
   *
   * 거기는 `error` 와 `status === 2` 두 줄뿐이라, 신호로 죽거나 2 가 아닌 값으로 끝나면
   * 빈 목록이 `ok:true` 로 올라갔다. 그러면 빠르게찾기 가 「따로 볼 파일 없음」 으로 받아
   * CP949·Shift_JIS·표식 없는 UTF-16 문서를 **한 개도 되읽지 않는다** — rg 가 그 파일에서
   * 낸 답은 버려졌는데 다시 읽지도 않으니, 사내 문서가 조용히 「일치 없음」 이 된다.
   * 그 함수 머리말은 「거르는 규칙은 rg로찾기 와 **같은 것**을 쓴다」 고 적어 두었다.
   */
  const 가짜 = (r) => async () => r;
  for (const [무엇, r] of [
    ['신호로 죽음', { error: null, status: null, stdout: '', stderr: '' }],
    ['0·1·2 아닌 종료코드', { error: null, status: 3221225477, stdout: '', stderr: '' }],
  ]) {
    const 답 = await rg못푸는파일({ 자리: '.', 부르기: 가짜(r) });
    check(`★★★ 못 푸는 파일 세기도 실패를 실패로 본다 — ${무엇}`, 답.ok === false, JSON.stringify(답));
  }
  const 멀쩡 = await rg못푸는파일({ 자리: '.', 부르기: 가짜({ error: null, status: 0, stdout: 'a.txt\nb.txt\n', stderr: '' }) });
  check('  (짝) 멀쩡히 끝나면 목록을 그대로 준다',
    멀쩡.ok === true && 멀쩡.파일들.join(',') === 'a.txt,b.txt', JSON.stringify(멀쩡));
  const 없음 = await rg못푸는파일({ 자리: '.', 부르기: 가짜({ error: null, status: 1, stdout: '', stderr: '' }) });
  check('  (짝) 하나도 없으면(1) 빈 목록이 맞다', 없음.ok === true && 없음.파일들.length === 0, JSON.stringify(없음));
}

// ── 13. .gitignore 의 대소문자도 두 길이 같아야 한다 (2.0.0 8회차 파일훑기) ─
trace('13-무시규칙대소문자');
{
  /*
   * `--glob-case-insensitive` 는 **`--glob` 으로 준 무늬**에만 먹는다.
   * `.gitignore` 규칙에는 안 먹는다. 그래서 윈도우에서 `*.tmpx` 를 적어 두면 —
   *
   *   rg 가 깔린 PC   →  A.TMPX 가 **검색된다**
   *   안 깔린 PC      →  A.TMPX 가 안 검색된다
   *
   * 자바스크립트 길(tools/ignore.js)은 윈도우에서 규칙을 대소문자 없이 본다
   * (git 의 core.ignorecase 기본값과 같은 자세). 같은 명령이 PC 마다 다른 답을
   * 내고, 하필 **가리라고 적은 것을 더 보는 쪽**으로 갈린다. rg 에는 규칙 쪽
   * 대소문자를 따로 알려 주는 자(`--ignore-file-case-insensitive`)가 있다.
   */
  if (엔진.rg) {
    const 방 = mkdtempSync(join(tmpdir(), 'deel-무시대소문자-'));
    writeFileSync(join(방, '.gitignore'), '*.tmpx\n', 'utf8');
    writeFileSync(join(방, 'A.TMPX'), 'const 바늘 = 1;\n', 'utf8');
    writeFileSync(join(방, 'b.js'), 'const 바늘 = 2;\n', 'utf8');
    const ctx13 = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set() };
    const 목록13 = (r) => String(r.content ?? r.error ?? '').split('\n\n')[0].split('\n').map((l) => l.trim()).filter(Boolean).sort();
    const 길 = async (엔진값) => {
      if (엔진값) process.env.DEEL_GREP = 엔진값; else delete process.env.DEEL_GREP;
      엔진잊기();
      try { return 목록13(await TOOLS.Grep.run({ pattern: '바늘' }, ctx13)); } finally { delete process.env.DEEL_GREP; 엔진잊기(); }
    };
    const 빠른 = await 길(null);
    const 예전 = await 길('js');
    check('★★ .gitignore 의 대소문자를 두 길이 같게 본다',
      빠른.join('|') === 예전.join('|'), `빠른: ${빠른.join(' ')} / 예전: ${예전.join(' ')}`);
    /*
     * 가리느냐 마느냐는 **운영체제가 정한다.** ignore.js 는 무늬를 윈도우에서만
     * `i` 로 컴파일하고(ignore.js:64), fastgrep 은 윈도우에서만 rg 에
     * `--ignore-file-case-insensitive` 를 넘긴다(fastgrep.js:361) — git 의
     * core.ignorecase 기본값과 같은 자세다. 리눅스에서 `*.tmpx` 가 `A.TMPX` 를
     * **안 가리는 것이 맞다.**
     *
     * 여기가 「안 본다」 를 무조건 박고 있었다. 그래서 리눅스에서는 빨갛다 —
     * 그런데 관문에 rg 가 없어 이 단 전체가 건너뛰어졌고, 그동안 아무도 몰랐다.
     * rg 를 깔자마자 드러났다.
     *
     * 지켜야 할 약속은 바로 위 ★★ — **두 길이 같은 답을 낸다** — 이고 그것은
     * 어느 운영체제에서나 참이어야 한다. 여기서는 그 답이 이 운영체제의 자세와
     * 맞는지를 본다.
     */
    const 가려야하나 = process.platform === 'win32';
    check('★ 가리라고 적은 A.TMPX 를 rg 길도 이 운영체제의 자세대로 본다',
      빠른.includes('A.TMPX') === !가려야하나,
      `${process.platform} · 가려야 하나 ${가려야하나} · 빠른: ${빠른.join(' ')}`);
    check('  안 가린 b.js 는 두 길 다 본다', 빠른.includes('b.js') && 예전.includes('b.js'), `${빠른.join(' ')} / ${예전.join(' ')}`);
    rmSync(방, { recursive: true, force: true });
  } else {
    건너뜀('.gitignore 대소문자 두 길 견주기', '이 PC 에 rg 가 없습니다 — 자바스크립트 길만 돕니다');
  }
}

엔진잊기();

const G = '\x1b[32m'; const R = '\x1b[31m'; const Y = '\x1b[33m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n빠른 찾기 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
for (const s of skip) console.log(`  ${Y}－${X} ${s.name}  ${D}${s.왜}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패${skip.length ? ` · ${skip.length}개 건너뜀` : ''}\n`);
process.exitCode = fail.length ? 1 : 0;
