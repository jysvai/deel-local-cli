// 배포 묶음에 남의 것이 한 톨도 섞이지 않았음을 증명한다.
//
// 이 파일이 있는 이유:
//  npm install 로그에 다른 패키지 이름이 뜨면 "얘가 딸려왔나?" 하고 놀라게 된다.
//  실제로 한 번 그랬다. 그래서 사람 기억 대신 테스트가 지키게 한다.
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { discover } from '../src/skills/discover.js';
import { importSpecs } from '../src/pack/selfpack.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));

// 1) 남의 코드에 기대지 않는다 — 반입 심사에 내는 증거가 이것이다.
const deps = Object.keys(pkg.dependencies ?? {});
const devs = Object.keys(pkg.devDependencies ?? {});
check('dependencies 0개', deps.length === 0, deps.join(', '));
check('devDependencies 0개', devs.length === 0, devs.join(', '));
check('optional/peer 없음',
  !pkg.optionalDependencies && !pkg.peerDependencies && !pkg.bundleDependencies);

// 2) 설치만 해도 저절로 돌아가는 코드가 없다.
const LIFECYCLE = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'preuninstall'];
const live = LIFECYCLE.filter((k) => pkg.scripts?.[k]);
check('설치 때 자동 실행 스크립트 없음', live.length === 0, live.join(', '));

// 3) npm 이 실제로 담는 파일 목록을 받아 본다. 짐작이 아니라 npm 이 부는 답이다.
let shipped = [];
try {
  // 윈도우에서 npm 은 npm.cmd 라 셸을 거쳐야 한다. 그런데 셸을 쓰면서 인자를
  // 따로 넘기면 Node 22 부터 경고한다 — 인자를 escape 없이 이어 붙이기 때문이다.
  // 여기서는 명령이 통째로 상수라 붙일 것이 없다. 그래서 처음부터 한 문장으로 준다.
  const out = execSync('npm pack --dry-run --json',
    { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  shipped = JSON.parse(out)[0].files.map((f) => f.path.replaceAll('\\', '/'));
} catch (err) {
  check('npm pack 목록 확보', false, String(err.message).slice(0, 80));
}

if (shipped.length) {
  /*
   * 스킬은 '설치된 PC' 에서 찾아 쓰는 것이지 담아 가는 것이 아니다.
   *
   * 딱 하나 예외를 뒀다 — src/skills/builtin/ 의 일하는 방법 몇 가지.
   * 사내에서 새로 받은 PC 에는 ~/.claude/skills 도 플러그인도 없어서 방법론이
   * 0개였고, 거기서 얄팍한 결과가 나왔다. 그래서 그것만 품고 다닌다.
   *
   * 여기서 지키는 것은 그대로다 — **그 PC 의 스킬이 실려 나가면 안 된다.**
   * 이 저장소에서 npm pack 을 하는 사람의 ~/.claude 나 남의 플러그인이
   * 딸려 나가는 것이 원래 무서웠던 일이고, 그건 여전히 0개여야 한다.
   */
  const 내것 = (p) => /^src\/skills\/builtin\//.test(p);
  const 이물질 = shipped.filter((p) => !내것(p) && (
    /SKILL\.md$/i.test(p) ||
    /\.claude-plugin\//.test(p) ||
    // src/skills · src/plugins 는 '찾아 읽는 코드' 라서 통과. 담긴 '내용물'만 잡는다.
    /(^|\/)(skills|commands|agents|plugins|marketplaces)\/.*\.(md|ya?ml|json)$/i.test(p) ||
    /(^|\/)node_modules\//.test(p) ||
    /\.(zip|tgz|tar\.gz)$/i.test(p)));
  check('남의 스킬·플러그인은 0개', 이물질.length === 0, 이물질.slice(0, 5).join(', '));

  // 품고 가는 것은 실제로 실려야 한다. 안 실리면 설치한 PC 에서 방법론이 0개가 된다 —
  // package.json 의 files 에서 src 를 빼거나 .npmignore 를 잘못 쓰면 조용히 그렇게 된다.
  const 내장들 = shipped.filter((p) => /^src\/skills\/builtin\/.+\/SKILL\.md$/.test(p));
  check('내 방법론은 제대로 실린다', 내장들.length >= 5,
    `${내장들.length}개 · ${내장들.map((p) => p.split('/')[3]).slice(0, 8).join(', ')}`);

  const 비밀 = shipped.filter((p) => /(^|\/)\.(env|npmrc|credentials)/i.test(p) || /\.deel\//.test(p));
  check('설정·자격 파일 0개', 비밀.length === 0, 비밀.join(', '));

  check('bin·src·문서만 담김',
    shipped.every((p) => /^(bin|src)\//.test(p) || ['package.json', 'LICENSE', 'README.md', 'README.ko.md'].includes(p)),
    shipped.filter((p) => !/^(bin|src)\//.test(p) && !['package.json', 'LICENSE', 'README.md', 'README.ko.md'].includes(p)).join(', '));
}

/*
 * 3-b) `npm run check` 가 src 를 하나도 빠뜨리지 않는가.
 *
 * prepublishOnly 가 check 를 돌려서 배포 전에 잡는다. 그 목록이 **손으로 적는
 * 것**이던 때가 있었고, 파일을 새로 만들면서 안 적으면 그 파일만 아무도 안
 * 봤다. 실제로 13개가 그렇게 빠져 있었다 — 몇 달 동안 조용히. 그리고 자바
 * 스크립트가 아닌 파일(`SKILL.md` 일곱 개)은 애초에 목록에 못 들어갔다.
 *
 * 그래서 목록을 짓지 않고 **훑는 자**로 바꿨다(tools/check-src.mjs). 이
 * 검사는 그 자가 정말로 다 훑는지를 잰다 — 훑는 자가 생겼다고 검사가 없어도
 * 되는 것은 아니다. 훑는 자도 폴더 하나를 빠뜨릴 수 있다.
 */
{
  const chk = String(pkg.scripts?.check ?? '');
  check('check 는 목록이 아니라 훑는 자다', /check-src\.mjs/.test(chk), chk.slice(0, 80));

  const 훑기 = (d, 모음 = []) => {
    for (const e of readdirSync(join(repo, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) 훑기(p, 모음);
      else 모음.push(p);
    }
    return 모음;
  };
  const 다 = 훑기('src');
  const 봤다는것 = (() => {
    try {
      const 글 = execFileSync(process.execPath, [join(repo, 'tools', 'check-src.mjs')],
        { cwd: repo, encoding: 'utf8' });
      return Number(/OK\s+(\d+)개/.exec(글)?.[1] ?? 0);
    } catch { return 0; }
  })();
  // bin/deel.js 도 같이 본다 — 그래서 +1.
  check('★★ npm run check 가 src 의 모든 파일을 본다', 봤다는것 === 다.length + 1,
    `훑은것 ${봤다는것} · 실제 ${다.length + 1}`);
  check('★★ 자바스크립트가 아닌 파일도 본다', 다.some((p) => p.endsWith('.md')) && 봤다는것 > 다.filter((p) => p.endsWith('.js')).length,
    `md ${다.filter((p) => p.endsWith('.md')).length}개`);
}

// 4) 소스가 바깥 패키지를 부르지 않는다 (node: 내장과 상대경로만).
const srcFiles = shipped.length ? shipped.filter((p) => /\.js$/.test(p))
  : ['bin/deel.js'];
const 바깥 = [];
for (const f of srcFiles) {
  for (const spec of importSpecs(readFileSync(join(repo, f), 'utf8'))) {
    if (spec.startsWith('node:') || spec.startsWith('.') || spec.startsWith('/')) continue;
    바깥.push(`${f} → ${spec}`);
  }
}
check('바깥 패키지 import 0개', 바깥.length === 0, 바깥.slice(0, 5).join(' · '));

// 5) 아무것도 안 깔린 PC 에서 무엇이 나오나.
//
//    내 방법론만 나와야 하고, 그 밖의 것은 하나도 없어야 한다.
//    내장을 끄면 0개 — 이게 '남의 것을 품고 다니지 않는다' 의 진짜 증명이다.
const 빈PC = join(tmpdir(), 'deel-nobundle-home');
rmSync(빈PC, { recursive: true, force: true });
mkdirSync(join(빈PC, 'proj'), { recursive: true });
const r = discover(join(빈PC, 'proj'), { home: 빈PC });
check('빈 PC 에서도 방법론은 있다', r.skills.length >= 5,
  `${r.skills.length}개 · ${r.skills.map((s) => s.name).join(', ')}`);
check('빈 PC 에서 나온 것은 전부 내가 품은 것', r.skills.every((s) => s.source === 'builtin'),
  [...new Set(r.skills.map((s) => s.source))].join(', '));
check('내장을 빼면 0개 — 남의 것은 하나도 안 품는다',
  discover(join(빈PC, 'proj'), { home: 빈PC, 내장: false }).skills.length === 0);
check('빈 PC 에서 플러그인·명령은 그대로 0개',
  r.plugins.length === 0 && r.commands.length === 0,
  `플러그인 ${r.plugins.length} · 명령 ${r.commands.length}`);
check('빈 PC 에서 플러그인 0개', r.plugins.length === 0, `${r.plugins.length}개 나옴`);
check('빈 PC 에서 명령 0개', r.commands.length === 0, `${r.commands.length}개 나옴`);
rmSync(빈PC, { recursive: true, force: true });

// --- 검사 파일 자체의 위생 ------------------------------------------------
//
// 검사 파일은 process.exit() 를 쓰지 않는다. process.exitCode 만 정하고
// 자연스럽게 끝나게 둔다. 이유가 둘이다.
//
//  1) 아직 닫히는 중인 핸들이 남은 채로 프로세스를 끊으면 윈도우 libuv 가
//     abort() 로 죽는다. 종료코드 3221226505(0xC0000409) 가 그것이다.
//     서버뿐 아니라 execFileSync 같은 자식 프로세스도 핸들을 남긴다.
//     처음엔 서버를 띄운 파일만 막았다가 plugins.test.js 를 놓쳤다.
//
//  2) 윈도우에서 표준출력이 파이프면 쓰기가 비동기다. process.exit() 는
//     아직 안 나간 것을 버린다 — 38개를 다 통과해 찍었는데 화면에는 한 줄도
//     안 남는다. 실제로 그래서 어느 파일이 죽었는지 한참 못 찾았다.
//
// 검사는 전부 통과했는데 종료코드만 1 이 되면 화면은 초록으로 보이고 CI 만
// 빨간불이 된다. 사람 기억으로 지킬 수 있는 규칙이 아니라서 구조로 막는다.
{
  // 줄 맨 앞에 오는 것만 호출로 본다.
  //
  // 이 검사는 자기 자신도 훑는다. 그래서 '어디든 나오면 걸린다' 로 하면
  // 규칙을 설명하는 주석, 규칙을 어겼다고 알려주는 안내 문구, 심지어 찾는 데
  // 쓰는 정규식까지 전부 자기가 자기를 잡는다. 셋 다 실제로 걸렸다.
  //
  // 진짜 호출은 언제나 줄 맨 앞에 오는 문장이다. 주석·문구·정규식은 줄
  // 가운데에 있다. 그 차이로 가른다.
  // (`if (x) process.exit(1)` 처럼 한 줄에 붙여 쓰면 못 잡는다. 이 저장소는
  //  그렇게 쓰지 않으므로 그 값은 안 치른다.)
  const 호출 = /^[ \t]*process\.exit[ \t]*\(/m;

  const 걸린것 = [];
  for (const f of readdirSync(join(repo, 'test')).filter((x) => /\.m?js$/.test(x))) {
    if (호출.test(readFileSync(join(repo, 'test', f), 'utf8'))) 걸린것.push(f);
  }
  check('검사 파일은 process.exit() 를 안 쓴다', 걸린것.length === 0,
    걸린것.length ? `${걸린것.join(', ')} — process.exitCode 로 바꾸세요` : '');
}


// --- 안 쓰는 들여오기 -----------------------------------------------------
//
// GitHub 의 CodeQL 이 `import { join } from 'node:path'` 하나를 잡아 왔다.
// 안 터지고 검사도 다 통과하는 종류라, 아무도 안 보면 계속 쌓인다.
//
// 밖에서 잡아 주기를 기다릴 일이 아니다. 여기서 훑으면 밀기 전에 걸린다.
// 정규식으로 낱말 경계를 짜는 대신 **낱말로 쪼개서** 본다 — 이스케이프로
// 씨름하다 정작 규칙이 틀리는 것보다 이편이 확실하다.
{
  /*
   * 점 **바로** 뒤에 오는 이름은 쓰임이 아니다 — 그건 속성이다.
   *
   * 두 번 틀린 자리라 둘 다 적어 둔다.
   *
   *  1) 처음엔 점을 아예 안 봤다. 그래서 `node:path` 의 join 을 안 쓰는
   *     파일인데 `짝없음.join(', ')` 이 있어서 '쓰고 있다' 로 셌다 — 검사가
   *     아무것도 못 잡았다.
   *  2) 고치면서 `\.\s*[\w$]+` 로 썼다. `\s*` 가 **줄바꿈까지** 먹는 바람에,
   *     마침표로 끝난 주석 다음 줄의 식별자가 통째로 지워졌다. 한국어 주석은
   *     거의 다 마침표로 끝나므로 멀쩡한 호출 셋이 '안 쓴다' 로 걸렸다.
   *
   * 둘 다 **일부러 어겨 보고** 나서야 알았다. 검사를 넣었으면 넣은 검사가
   * 진짜 잡는지도 한 번은 재 봐야 한다.
   *
   *  3) 세 번째도 그렇게 나왔다. 파일을 **통째로** 낱말로 쪼갰더니 주석과
   *     문자열 속 낱말까지 '쓰임' 으로 셌다. test/memory.test.js 가
   *     `쓰기` 를 들여오고 한 번도 안 부르는데, 같은 파일의
   *     `check('계획 모드에 쓰기 도구는 여전히 없다', …)` 안에 든 「쓰기」
   *     때문에 통과했다. 짧고 흔한 한글 이름일수록 잘 빠져나간다.
   *     그래서 이제 주석과 문자열을 먼저 지우고 본다.
   */

  /**
   * 주석·문자열·정규식을 공백으로 지운다. **길이는 그대로** 둔다 —
   * 아래에서 들여오기 문장 자리를 원본 위치로 도려내야 하기 때문이다.
   *
   * 정규식으로 안 짠다. 위 2)번이 정규식으로 짜다 난 탈이고, 문자열 안의
   * 따옴표·이스케이프는 정규식이 제일 못 하는 일이다. 한 글자씩 걸어가면
   * 길어도 틀릴 자리가 없다.
   *
   * 헷갈리면 **안 지우는 쪽**으로 기운다. 안 지우면 기껏해야 못 잡을 뿐이고
   * (지금까지와 같다), 잘못 지우면 멀쩡한 쓰임이 가려져 없는 탈을 만든다.
   */
  const 코드만 = (s) => {
    const 칸 = s.split('');
    const n = s.length;
    const 비우기 = (a, b) => { for (let k = a; k < b && k < n; k++) if (칸[k] !== '\n') 칸[k] = ' '; };
    let i = 0;
    let 앞 = '';        // 코드에서 마지막으로 본, 공백 아닌 글자
    let 앞낱말 = '';
    // `/` 가 나눗셈이 아니라 정규식 시작인 자리. 애매하면 뺀다(나눗셈으로 본다).
    const 날자리 = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '+', '*', '%', '^', '~', '<', '>']);
    const 날키워드 = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'yield', 'await']);

    const 따옴표먹기 = (q) => {
      const a = i; i++;
      while (i < n) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === q) { i++; break; }
        if (s[i] === '\n') break;   // 안 닫힌 문자열 — 줄을 넘어가며 먹지 않는다
        i++;
      }
      비우기(a, i);
    };
    const 주석먹기 = () => {
      const a = i;
      if (s[i + 1] === '/') { while (i < n && s[i] !== '\n') i++; }
      else { i += 2; while (i < n && !(s[i] === '*' && s[i + 1] === '/')) i++; i = Math.min(i + 2, n); }
      비우기(a, i);
    };
    const 정규식먹기 = () => {
      const a = i; i++;
      let 묶음 = false;
      while (i < n) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === '\n') break;
        if (s[i] === '[') 묶음 = true;
        else if (s[i] === ']') 묶음 = false;
        else if (s[i] === '/' && !묶음) { i++; break; }
        i++;
      }
      while (i < n && /[a-z]/.test(s[i])) i++;   // 깃발(g·i·m…)
      비우기(a, i);
    };
    /*
     * 템플릿은 **한 줄기 반복문**으로 본다. `${}` 안은 코드라 통째로 살려야
     * 하고, 그 안에 또 문자열·정규식·템플릿이 온다.
     *
     * 처음엔 템플릿만 따로 떼어 재귀로 훑었다. 그 안쪽 `${}` 에서 정규식을
     * 안 봤더니 `${파일.replace(/'/g, "''")}` 의 따옴표가 문자열을 열어
     * 버렸고, 거기서부터 예순 줄이 통째로 지워져 멀쩡한 쓰임 하나가
     * '안 쓴다' 로 걸렸다. 한 줄기로 두면 어디에 있든 같은 규칙이 걸린다.
     */
    const 틀 = [];        // 템플릿마다 `${` 안의 중괄호 깊이. 0 이면 글 부분.
    let 틀글 = false;     // 지금 템플릿의 '글' 을 지나는 중인가

    while (i < n) {
      if (틀글) {
        if (s[i] === '\\') { 비우기(i, i + 2); i += 2; continue; }
        if (s[i] === '`') { 비우기(i, i + 1); i++; 틀.pop(); 틀글 = false; 앞 = '`'; 앞낱말 = ''; continue; }
        if (s[i] === '$' && s[i + 1] === '{') {
          비우기(i, i + 2); i += 2;
          틀[틀.length - 1].깊이 = 1; 틀글 = false; 앞 = '('; 앞낱말 = '';
          continue;
        }
        비우기(i, i + 1); i++;
        continue;
      }

      const c = s[i];
      if (c === '/' && (s[i + 1] === '/' || s[i + 1] === '*')) { 주석먹기(); continue; }
      if (c === '"' || c === "'") { 따옴표먹기(c); 앞 = c; 앞낱말 = ''; continue; }
      if (c === '`') { 비우기(i, i + 1); i++; 틀.push({ 깊이: 0 }); 틀글 = true; continue; }
      if (c === '/' && (날자리.has(앞) || 날키워드.has(앞낱말))) { 정규식먹기(); 앞 = '/'; 앞낱말 = ''; continue; }
      if (틀.length) {
        const 위 = 틀[틀.length - 1];
        if (c === '{') 위.깊이++;
        else if (c === '}') {
          위.깊이--;
          if (위.깊이 === 0) { 비우기(i, i + 1); i++; 틀글 = true; continue; }
        }
      }
      if (!/\s/.test(c)) 앞 = c;
      앞낱말 = /[\w$]/.test(c) ? 앞낱말 + c : '';
      i++;
    }
    return 칸.join('');
  };

  const 낱말 = (s) => new Set(
    s.replace(/\.[\w$]+/g, '.').split(/[^\w$가-힣]+/).filter(Boolean));
  const 들여오기 = /^import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([\w$]+)|([\w$]+))\s+from/gm;

  const 훑을것 = [];
  for (const d of ['src', 'test', 'bin', 'tools']) {
    const 재귀 = (밑) => {
      for (const e of readdirSync(join(repo, 밑), { withFileTypes: true })) {
        const 속 = `${밑}/${e.name}`;
        if (e.isDirectory()) 재귀(속);
        else if (/\.m?js$/.test(e.name)) 훑을것.push(속);
      }
    };
    재귀(d);
  }

  const 놀고있는것 = [];
  for (const f of 훑을것) {
    const 원본 = readFileSync(join(repo, f), 'utf8');
    const s = 코드만(원본);
    들여오기.lastIndex = 0;
    let m;
    while ((m = 들여오기.exec(s))) {
      const 이름들 = [];
      if (m[1]) 이름들.push(m[1]);
      if (m[2]) {
        for (const p of m[2].split(',')) {
          const t = p.trim();
          if (t) 이름들.push(t.split(/\s+as\s+/).pop().trim());
        }
      }
      if (m[3]) 이름들.push(m[3]);
      if (m[4]) 이름들.push(m[4]);
      // 이 import 문 자체는 빼고 본다 — 안 빼면 자기 이름을 자기가 찾는다.
      const 있는것 = 낱말(s.slice(0, m.index) + s.slice(m.index + m[0].length));
      for (const n of 이름들) if (n && !있는것.has(n)) 놀고있는것.push(`${f} → ${n}`);
    }
  }
  check('들여와 놓고 안 쓰는 것이 없다', 놀고있는것.length === 0,
    놀고있는것.slice(0, 5).join(' · '));
}

/*
 * ── 써 놓고 안 돌리는 검사가 없는가 ────────────────────────────────────
 *
 * test/run.mjs 는 파일을 **손으로 적은 목록**으로 돌린다(자동으로 찾지 않는다).
 * 그래서 새 검사 파일을 만들고 목록에 안 넣으면, 그 파일은 조용히 한 번도 안
 * 돌아간다. 실제로 그랬다 — ask.test.js 18항목이 만들어진 채로 목록에 없어서,
 * 전체 검사는 초록인데 그 18항목은 아무것도 안 지키고 있었다.
 *
 * 안 돌아가는 검사는 없느니만 못하다. 없으면 없는 줄이라도 아는데, 있으면
 * 지켜지고 있다고 **믿게** 된다.
 */
{
  const 목록 = readFileSync(join(here, 'run.mjs'), 'utf8');
  const 빠진것 = readdirSync(here)
    .filter((f) => f.endsWith('.test.js'))
    .filter((f) => !목록.includes(`'${f}'`));
  check('만들어 놓고 안 돌리는 검사가 없다', 빠진것.length === 0, 빠진것.join(' · '));
}

// --- 결과 ---------------------------------------------------------------
const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n반입 묶음 검사 — 남의 것이 섞이지 않았는가\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패`);
if (shipped.length) console.log(`  ${D}담긴 파일 ${shipped.length}개 — 전부 bin/ · src/ · 문서${X}`);
console.log('');
process.exitCode = fail.length ? 1 : 0;
