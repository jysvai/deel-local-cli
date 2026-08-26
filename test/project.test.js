/**
 * 이 폴더가 무슨 프로젝트인가 (agent/project.js).
 *
 * 왜 이 검사가 따로 있나:
 *   남의 코드가 있는 폴더에서 켜면 모델은 아무것도 모르는 채로 시작한다.
 *   그래서 매번 같은 세 걸음을 다시 밟았다 — Glob 으로 위쪽을 훑고,
 *   package.json 을 읽고, 검사를 어떻게 돌리는지 찾는다. 로컬 모델은 한 걸음이
 *   20~40초라 **일을 시작하기도 전에 2분**이 간다.
 *
 *   더 나쁜 쪽은 그 세 걸음을 **안 밟고** 시작하는 경우다. 이 프로젝트가
 *   이미 쓰는 것을 모른 채 제 관례로 파일을 만든다 — npm 프로젝트에
 *   requirements.txt 를 만들어 놓는 식이다.
 *
 * ── 여기서 재는 것 ────────────────────────────────────────────────────
 *
 * 1. 사실만 적는가
 *      없는 명령을 알려 주면 모델이 그걸 부르고, 실패하고, 다시 찾느라
 *      걸음을 더 쓴다. 안 도와주느니만 못하다. package.json 에 적힌 것만 옮긴다.
 *
 * 2. 이게 전부가 아니라고 말하는가
 *      위쪽 한 겹과 package.json 만 본 것이다. 그 사실을 안 적으면 모델은
 *      이걸 프로젝트 전체 지도로 여기고 Outline 을 안 부른다 — 그러면
 *      이 토막이 오히려 손해가 된다.
 *
 * 3. 자리를 얼마나 먹는가
 *      **매 요청에 통째로 나가는 고정 몫**이다. 접히지도 않는다.
 *      8k 창에서 이게 크면 그만큼 대화가 조용히 줄어든다.
 *
 * 4. 켤 때 느려지지 않는가
 *      git 을 안 띄우고 .git/HEAD 를 읽는다. 폴더도 위쪽 한 겹만 읽는다.
 *      여기서 자식 프로세스를 부르거나 하위까지 내려가면, 큰 저장소에서
 *      켜는 순간 화면이 몇 초 멈춘다.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 지문, git가지 } from '../src/agent/project.js';
import { Session, estimateTokens } from '../src/agent/session.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 터 = mkdtempSync(join(tmpdir(), 'deel-proj-'));

// 폴더 하나를 차려 준다. 여러 갈래를 견주려면 판이 여럿 필요하다.
function 방만들기(이름, 차림 = {}) {
  const p = join(터, 이름);
  mkdirSync(p, { recursive: true });
  for (const [상대, 글] of Object.entries(차림.파일 ?? {})) {
    const 자리 = join(p, 상대);
    mkdirSync(join(자리, '..'), { recursive: true });
    writeFileSync(자리, 글, 'utf8');
  }
  for (const d of 차림.폴더 ?? []) mkdirSync(join(p, d), { recursive: true });
  return p;
}

trace('1-node프로젝트');

// ── 1. node 프로젝트 ───────────────────────────────────────────────────
{
  const p = 방만들기('가게', {
    파일: {
      'package.json': JSON.stringify({
        name: '사내-주문판',
        scripts: { test: 'node test/run.mjs', dev: 'vite', build: 'vite build', 잡일: 'node 잡일.js' },
      }),
      'index.html': '<!doctype html>',
      'vite.config.js': 'export default {}',
      '.git/HEAD': 'ref: refs/heads/feature/주문서\n',
      'src/app.js': 'const a = 1;',
    },
    폴더: ['node_modules/좌우간', 'dist'],
  });

  const s = 지문(p, 32768);
  check('무슨 갈래인지 적는다', /node 프로젝트/.test(s), s.split('\n')[2]);
  /*
   * 폴더 이름이 아니라 package.json 의 이름을 쓴다.
   *
   * 이 둘은 자주 다르다. 사람이 부르는 이름은 package.json 쪽이라,
   * 모델이 README 나 커밋 메시지에 이름을 적을 때 이쪽이 맞는다.
   */
  check('package.json 의 이름을 쓴다', /\(사내-주문판\)/.test(s), s.split('\n')[2]);
  check('git 가지를 적는다', /git feature\/주문서/.test(s), s.split('\n')[2]);

  // 명령이 제일 값이 크다 — '이 프로젝트에서 검사를 어떻게 돌리나' 가 여기 다 있다.
  check('npm scripts 를 적는다', /npm test/.test(s) && /npm run dev/.test(s), s);
  check('test·start 는 run 을 안 붙인다', /npm test/.test(s) && !/npm run test/.test(s), s);
  check('그 밖의 것은 run 을 붙인다', /npm run build/.test(s), s);
  // 사람이 실제로 부르는 것부터. 좁은 창에서 잘릴 때 무엇이 남는지가 이 순서로 정해진다.
  check('자주 쓰는 것이 앞에 온다', s.indexOf('npm run dev') < s.indexOf('npm run 잡일'), '');
  /*
   * 이름을 지어내지 않는다.
   *
   * 여기가 이 기능에서 제일 위험한 자리다. 없는 명령을 알려 주면 모델은
   * 그것을 부르고, 실패하고, 다시 찾는다 — 아껴 준다던 걸음을 도로 쓴다.
   */
  check('없는 명령은 안 적는다', !/npm run lint/.test(s) && !/npm start/.test(s), s);

  check('위쪽 한 겹을 적는다', /index\.html/.test(s) && /src\//.test(s), s);
  check('폴더는 뒤에 / 를 붙인다', /src\//.test(s) && !/index\.html\//.test(s), '');
  check('폴더가 파일보다 앞에 온다', s.indexOf('src/') < s.indexOf('index.html'), '');
  // 적어 봐야 사람에게 아무 말도 안 해 주는 것들. 자리만 먹는다.
  check('node_modules 는 안 적는다', !/node_modules/.test(s), '');
  check('dist 같은 만들어진 폴더도 안 적는다', !/dist/.test(s), '');
  check('숨은 것은 안 적는다', !/\.git/.test(s), '');

  /*
   * 하위로 안 내려간다.
   *
   * 내려가면 큰 저장소에서 켜는 순간이 느려지고, 어차피 프롬프트에 넣을 양은
   * 한 줄뿐이다. src/ 안의 app.js 는 여기 안 보여야 맞는다.
   */
  check('하위 폴더 안까지는 안 본다', !/app\.js/.test(s), s);

  // 이게 전부가 아니라고 말해야 모델이 Outline 을 부른다.
  check('이게 전부가 아니라고 말한다', /위쪽 한 겹만 본 것이다/.test(s), s.split('\n').pop());
  check('그럼 무엇을 하라고 알려 준다', /Outline 을 불러라/.test(s), s.split('\n').pop());
}

trace('2-다른갈래');

// ── 2. 다른 갈래들 ─────────────────────────────────────────────────────
{
  const 갈래 = (이름, 파일) => 지문(방만들기(이름, { 파일: { [파일]: '' } }), 32768) ?? '';
  check('python (pyproject)', /python 프로젝트/.test(갈래('파이1', 'pyproject.toml')), '');
  check('python (requirements)', /python 프로젝트/.test(갈래('파이2', 'requirements.txt')), '');
  check('go', /go 프로젝트/.test(갈래('고', 'go.mod')), '');
  check('rust', /rust 프로젝트/.test(갈래('러스트', 'Cargo.toml')), '');
  check('java (maven)', /java \(maven\)/.test(갈래('메이븐', 'pom.xml')), '');
  check('java (gradle)', /java \(gradle\)/.test(갈래('그레이들', 'build.gradle')), '');
  check('c/c++ (cmake)', /c\/c\+\+ \(cmake\)/.test(갈래('씨', 'CMakeLists.txt')), '');

  // package.json 이 있으면 node 다. 파이썬 스크립트가 섞여 있어도 마찬가지다.
  const 섞임 = 지문(방만들기('섞임', {
    파일: { 'package.json': '{"name":"섞인것"}', 'requirements.txt': '', 'build.py': '' },
  }), 32768);
  check('표식이 여럿이면 위에 있는 것이 이긴다', /node 프로젝트/.test(섞임), 섞임.split('\n')[2]);

  /*
   * 갈래를 모르면 명령을 안 적는다.
   *
   * python 폴더에 `npm test` 를 적는 것이 없는 명령을 적는 것보다 나쁘다 —
   * 그럴듯해서 모델이 의심 없이 부른다.
   */
  const 파이 = 지문(방만들기('파이3', { 파일: { 'pyproject.toml': '', 'main.py': '' } }), 32768);
  check('node 가 아니면 명령을 지어내지 않는다', !/돌릴 수 있는 것/.test(파이), 파이);
  check('그래도 위쪽은 적어 준다', /main\.py/.test(파이), 파이);
}

trace('3-git가지');

// ── 3. git 가지 ────────────────────────────────────────────────────────
//
// git 을 **안 띄운다.** .git/HEAD 를 그냥 읽는다. 켤 때 자식 프로세스를
// 부르면 큰 저장소에서 몇 초가 걸리고, 그 몇 초는 화면이 멈춘 채로 간다.
{
  const 보통 = 방만들기('가지1', { 파일: { '.git/HEAD': 'ref: refs/heads/main\n' } });
  check('가지 이름을 읽는다', git가지(보통) === 'main', String(git가지(보통)));

  const 슬래시 = 방만들기('가지2', { 파일: { '.git/HEAD': 'ref: refs/heads/feature/긴/이름\n' } });
  check('가지 이름에 슬래시가 있어도 통째로', git가지(슬래시) === 'feature/긴/이름', String(git가지(슬래시)));

  /*
   * 떨어져 나온 머리(detached HEAD)면 커밋 앞자리가 들어 있다.
   * 그걸 가지 이름처럼 적으면 모델이 그 이름으로 checkout 을 시도한다.
   */
  const 떨어짐 = 방만들기('가지3', { 파일: { '.git/HEAD': 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0\n' } });
  check('detached 면 가지 이름처럼 안 적는다', /detached/.test(git가지(떨어짐) ?? ''), String(git가지(떨어짐)));

  const 없음 = 방만들기('가지4', { 파일: { 'a.txt': '' } });
  check('git 이 아니면 없다고 한다', git가지(없음) === null, String(git가지(없음)));
  check('git 이 아니면 그 줄을 안 적는다', !/git /.test(지문(없음, 32768) ?? ''), 지문(없음, 32768) ?? '');
}

trace('4-창크기');

// ── 4. 창 크기에 맞춘다 ────────────────────────────────────────────────
//
// 이건 접히지 않는 **고정 몫**이다. 창의 몇 %를 쓰느냐가 곧 손해라,
// 좁을수록 적게 적어야 한다.
{
  const 파일 = { 'package.json': JSON.stringify({ name: '큰것', scripts: {} }) };
  for (let i = 0; i < 30; i++) 파일[`파일${String(i).padStart(2, '0')}.txt`] = '';
  const 스크립트 = {};
  for (const n of ['dev', 'start', 'test', 'build', 'lint', 'typecheck', 'bench', 'coverage', 'demo', 'pack']) {
    스크립트[n] = 'node x.js';
  }
  파일['package.json'] = JSON.stringify({ name: '큰것', scripts: 스크립트 });
  const p = 방만들기('큰것', { 파일 });

  const 좁음 = 지문(p, 8000);
  const 보통 = 지문(p, 16000);
  const 넓음 = 지문(p, 128000);

  const 셈 = (s, re) => (s.match(re) ?? []).length;
  check('좁은 창은 위쪽을 덜 적는다', 셈(좁음, /파일\d\d\.txt/g) < 셈(넓음, /파일\d\d\.txt/g),
    `${셈(좁음, /파일\d\d\.txt/g)}개 < ${셈(넓음, /파일\d\d\.txt/g)}개`);
  check('좁은 창은 명령도 덜 적는다', 셈(좁음, /npm /g) < 셈(넓음, /npm /g),
    `${셈(좁음, /npm /g)}개 < ${셈(넓음, /npm /g)}개`);
  check('중간 창은 그 사이', 셈(보통, /파일\d\d\.txt/g) >= 셈(좁음, /파일\d\d\.txt/g)
    && 셈(보통, /파일\d\d\.txt/g) <= 셈(넓음, /파일\d\d\.txt/g), `${셈(보통, /파일\d\d\.txt/g)}개`);

  // 잘랐으면 잘랐다고 말한다. 안 말하면 모델은 이게 폴더의 전부인 줄 안다.
  check('안 적은 것이 몇 개인지 말한다', /그 밖에 \d+개/.test(좁음), 좁음.split('\n').find((l) => /그 밖에/.test(l)) ?? '');

  /*
   * 좁은 창에서 하나만 남긴다면 그건 **명령**이다.
   *
   * 위쪽 생김새는 Glob 한 번이면 다시 알 수 있지만, 'npm test 로 검사를
   * 돌린다' 는 package.json 을 열어야 안다. 그 걸음이 더 비싸다.
   */
  check('좁아도 명령은 남는다', /npm test/.test(좁음), 좁음);

  // 고정 몫이 커지면 test/compact.test.js 가 먼저 빨개진다. 여기서도 못을 박는다.
  const 토큰 = estimateTokens(좁음);
  check('8k 창에서 200토큰을 안 넘는다', 토큰 < 200, `${토큰}토큰`);
  check('큰 창에서도 400토큰을 안 넘는다', estimateTokens(넓음) < 400, `${estimateTokens(넓음)}토큰`);
}

trace('5-적을것이없으면');

// ── 5. 적을 것이 없으면 아무 말도 안 한다 ──────────────────────────────
//
// 빈 폴더에서 "이 폴더: (아무것도 없음)" 이라고 적는 것은 자리만 먹는 짓이다.
{
  const 빈방 = 방만들기('빈방');
  check('빈 폴더면 null', 지문(빈방, 32768) === null, String(지문(빈방, 32768)));

  const 읽을수없음 = join(터, '없는폴더');
  check('없는 폴더에서도 안 터진다', 지문(읽을수없음, 32768) === null, String(지문(읽을수없음, 32768)));

  // package.json 이 깨져 있어도 켜지긴 해야 한다.
  const 깨짐 = 방만들기('깨짐', { 파일: { 'package.json': '{ 이건 JSON 이 아니다', 'a.js': '' } });
  const s = 지문(깨짐, 32768);
  check('깨진 package.json 에도 안 터진다', typeof s === 'string', String(s));
  check('그래도 node 인 것은 안다', /node 프로젝트/.test(s), s.split('\n')[2]);
  check('명령은 못 적는다고 조용히 넘어간다', !/돌릴 수 있는 것/.test(s), s);
}

trace('6-세션에실리는가');

// ── 6. 시스템 프롬프트에 실리는가 ──────────────────────────────────────
{
  const p = 방만들기('세션방', {
    파일: {
      'package.json': JSON.stringify({ name: '세션것', scripts: { test: 'node t.js' } }),
      'DEEL.md': '이 프로젝트에서는 반드시 CP949 로 저장한다.',
    },
  });
  const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', auth: 'none', key: null, model: 'm', ctx: 32768, streaming: false, tools: true };
  const s = new Session(conn, { root: p });

  check('Session 이 켜질 때 스스로 읽는다', !!s.프로젝트, String(s.프로젝트).slice(0, 40));
  const sys = s.systemPrompt();
  check('시스템 프롬프트에 실린다', /세션것/.test(sys) && /npm test/.test(sys), '');

  /*
   * 사용자 규칙보다 **앞에** 온다.
   *
   * 규칙은 "이 프로젝트에서는 이렇게 해라" 는 말이다. 무슨 프로젝트인지를
   * 먼저 읽은 뒤에 와야 말이 이어진다. 순서가 뒤집히면 규칙이 허공에 뜬다.
   */
  check('사용자 규칙보다 앞에 온다', sys.indexOf('--- 이 폴더 ---') < sys.indexOf('DEEL.md'), '');

  /*
   * 컨텍스트 셈에도 들어가야 한다.
   *
   * 안 세면 '남은 자리' 가 그만큼 뻥튀기되고, effort.js 가 그 값으로 출력
   * 상한을 잡는다. 그러면 답이 조용히 잘리기 시작한다 — 원인을 못 찾는 종류다.
   */
  const 빈방 = 방만들기('셈빈방');
  const 없이 = new Session(conn, { root: 빈방 }).breakdown().used;
  check('컨텍스트로도 센다', s.breakdown().used > 없이, `${없이} → ${s.breakdown().used}`);

  /*
   * 창 크기는 연결에서 온다. 8k 모델에 붙으면 저절로 짧아져야 한다 —
   * 여기가 안 이어져 있으면 좁은 창 대응이 코드로만 있고 실제로는 안 도는 셈이다.
   */
  const 좁은연결 = { ...conn, ctx: 8000 };
  const 좁은세션 = new Session(좁은연결, { root: p });
  check('연결의 창 크기를 따라간다',
    (좁은세션.프로젝트?.length ?? 0) <= (s.프로젝트?.length ?? 0),
    `${좁은세션.프로젝트?.length}자 ≤ ${s.프로젝트?.length}자`);
}

trace('7-빠르게');

// ── 7. 켤 때 느려지지 않는가 ───────────────────────────────────────────
//
// 켜는 순간 화면이 멈추면 사람은 그걸 '느린 프로그램' 으로 기억한다.
// 파일이 많은 폴더에서도 눈에 안 띌 만큼 빨라야 한다.
{
  const 파일 = { 'package.json': '{"name":"많은것","scripts":{"test":"x"}}' };
  for (let i = 0; i < 600; i++) 파일[`f${i}.txt`] = '';
  const p = 방만들기('많은것', { 파일 });

  const 잰때 = Date.now();
  const s = 지문(p, 32768);
  const 걸림 = Date.now() - 잰때;
  check('파일 600개 폴더에서도 빠르다', 걸림 < 500, `${걸림}ms`);
  check('그래도 적을 것은 적는다', /npm test/.test(s), '');
  check('다 적지는 않는다', (s.match(/f\d+\.txt/g) ?? []).length <= 24, `${(s.match(/f\d+\.txt/g) ?? []).length}개`);
}

trace('8-치움');
rmSync(터, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n폴더 지문 검사  ${D}(사실만 적는가 · 이게 전부가 아니라고 말하는가 · 자리를 얼마나 먹는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
