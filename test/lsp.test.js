/**
 * 언어 서버 붙이기 — Def · Refs · 고친 뒤 진단.
 *
 * ── 여기서 재는 것 ──────────────────────────────────────────────────────
 *
 * 이 기능은 **남의 프로세스**에 기대고 있다. 그래서 잘 될 때가 아니라
 * 안 될 때가 문제다. 안 깔린 자리, 안 답하는 자리, 켜다 죽는 자리 —
 * 그 셋 중 하나에서 대화창이 멎으면 사용자가 할 수 있는 일은 Ctrl+C 뿐이다.
 * 아래 시험 절반은 그 셋을 일부러 만들어 놓고 **그래도 넘어가는지**를 본다.
 *
 * 나머지 절반은 '조용히 틀리는' 쪽을 막는다 —
 *   · 진단이 안 온 것을 '오류 없음' 으로 바꿔 말하지 않는가
 *   · 언어 서버가 없는 자리에서 Def·Refs 가 목록에 안 서는가
 *   · 같은 이름이 여럿일 때 하나를 골라 주고 아닌 척하지 않는가
 *
 * 흉내 서버(lsp-stub.mjs)를 박아 넣고 돈다. 오가는 말은 진짜 규약 그대로라,
 * 언어 서버가 안 깔린 컴퓨터에서도 이 길을 전부 밟는다.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { 틀, 받개 } from '../src/lsp/rpc.js';
import { 갈래, 언어아이디, 어디있나, 고르기, 둘러보기, 프로젝트갈래, 서버박기, 셈지우기 } from '../src/lsp/servers.js';
import { 얻기, 지금것들, 모두끄기, 언어서버, 색인중일까, 열쇠주소, 다시보낼까, 아이들데려가기 } from '../src/lsp/client.js';
import { 편집후진단, 붙이기, 데우기 } from '../src/lsp/diag.js';
import { toolSchemas, runTool, TOOLS, 언어서버있나 } from '../src/tools/index.js';
// 모델이 실제로 받는 글. 사람 화면(summary)과 다른 것이 이 파일에서 재는 것 하나다.
import { 실을글 } from '../src/agent/loop.js';
import { allow as 모드허용 } from '../src/agent/modes.js';
import { makeScope } from '../src/safety/guard.js';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 적어둘것 = [];
const 치울것 = [];

/**
 * 지우기. 몇 번 다시 해 본다.
 *
 * 윈도우는 프로세스가 cwd 로 잡고 있는 폴더를 못 지운다. 다 껐어도 실제로
 * 사라지는 데 몇십 ms 가 걸린다. 여기서 한 번에 안 된다고 시험을 실패로
 * 만들면, 정작 재려던 것과 상관없는 이유로 빨간불이 켜진다.
 */
async function 치우기(p) {
  for (let i = 0; i < 12; i++) {
    try { rmSync(p, { recursive: true, force: true }); return true; }
    catch { await new Promise((r) => setTimeout(r, 120)); }
  }
  return false;
}

const 여기 = resolve(fileURLToPath(import.meta.url), '..');
const 흉내 = join(여기, 'lsp-stub.mjs');
const root = mkdtempSync(join(tmpdir(), 'deel-lsp-'));

// 시험용 소스 몇 개. 흉내 서버가 가리키는 자리와 이름을 맞춰 둔다.
mkdirSync(join(root, 'src'), { recursive: true });
writeFileSync(join(root, 'src', '셈.js'), [
  '// 셈하기 — 시험용',
  'const 몫 = 3;',
  '',
  'export function 셈하기(a, b) {',
  '  return a + b;',
  '}',
].join('\n'), 'utf8');
writeFileSync(join(root, 'src', '쓰는곳.js'), [
  "import { 셈하기 } from './셈.js';",
  '',
  'export function 하나() {',
  '  // 셈하기 를 여기서 부른다',
  '  return 셈하기(1, 2);',
  '}',
  '',
  'export function 둘() {',
  '  const x = 1;',
  '  return 셈하기(x, x);',
  '}',
].join('\n'), 'utf8');
writeFileSync(join(root, 'src', '또다른곳.js'), [
  "import { 셈하기 } from './셈.js';",
  'export const 값 = 셈하기(9, 9);',
].join('\n'), 'utf8');
writeFileSync(join(root, 'src', 'a.js'), ['// a', 'export function run() {}'].join('\n'), 'utf8');
writeFileSync(join(root, 'src', 'b.js'), ['// b', '', 'export function run() {}'].join('\n'), 'utf8');

const scope = makeScope(root);
const 만든ctx = (더 = {}) => ({
  scope,
  history: { snapshot() {} },
  audit: { tool() {} },
  seen: new Set(),
  모델컨텍스트: 32768,
  lsp: { 켬: true },
  ...더,
});

// ══ 1. 말틀 ════════════════════════════════════════════════════════════
trace('1-말틀');
{
  // 길이는 바이트다. 한글이 든 통에서 이걸 글자로 세면 그 순간부터 밀린다.
  const 통 = 틀({ a: '한글이 든 말' });
  const 잰것 = /Content-Length: (\d+)/.exec(통.toString('ascii', 0, 40));
  const 몸 = Buffer.from(JSON.stringify({ a: '한글이 든 말' }), 'utf8');
  check('길이를 바이트로 센다', Number(잰것[1]) === 몸.length, `${잰것[1]} vs ${몸.length}`);
  check('글자 수와 다르다 — 그래서 재는 값이다', 몸.length !== JSON.stringify({ a: '한글이 든 말' }).length);

  // 한 바이트씩 흘려 넣어도 통 하나가 나와야 한다.
  const r = 받개();
  let 나온것 = [];
  for (const b of 통) 나온것 = 나온것.concat(r.넣기(Buffer.from([b])));
  check('한 바이트씩 와도 통 하나가 나온다', 나온것.length === 1 && 나온것[0].a === '한글이 든 말',
    JSON.stringify(나온것));

  // 세 통이 한 덩어리로 붙어 와도 셋 다 나와야 한다.
  const r2 = 받개();
  const 셋 = Buffer.concat([틀({ i: 1 }), 틀({ i: 2 }), 틀({ i: 3 })]);
  const 나온것2 = r2.넣기(셋);
  check('붙어 와도 셋 다 나온다', 나온것2.length === 3 && 나온것2[2].i === 3, `${나온것2.length}개`);
  check('다 쓰고 나면 들고 있는 것이 없다', r2.들고있는것 === 0, String(r2.들고있는것));

  // 깨진 통 하나 때문에 뒤엣것까지 못 받으면 안 된다.
  const r3 = 받개();
  const 깨진몸 = Buffer.from('{이건 JSON 이 아니다', 'utf8');
  const 깨진통 = Buffer.concat([Buffer.from(`Content-Length: ${깨진몸.length}\r\n\r\n`, 'ascii'), 깨진몸]);
  const 나온것3 = r3.넣기(Buffer.concat([깨진통, 틀({ ok: true })]));
  check('깨진 통은 그것만 버린다', 나온것3.length === 1 && 나온것3[0].ok === true, JSON.stringify(나온것3));
  check('버린 것을 센다', r3.버린수 === 1, String(r3.버린수));

  // 머리말이 반만 와도 안 죽는다.
  const r4 = 받개();
  check('머리말이 덜 오면 그냥 들고 있는다', r4.넣기(Buffer.from('Content-Len')).length === 0);

  // 주소 견주기. 같은 파일을 두 가지로 적어도 같은 열쇠가 나와야 한다.
  const 어떤파일 = join(root, 'src', '셈.js');
  const 우리것 = pathToFileURL(어떤파일).href;
  const 서버것 = 우리것.replace(/^file:\/\/\/([A-Za-z]):\//, (_, d) => `file:///${d.toLowerCase()}%3A/`);
  check('같은 파일이면 주소를 다르게 적어도 같은 열쇠', 열쇠주소(우리것) === 열쇠주소(서버것),
    `${열쇠주소(우리것)} vs ${열쇠주소(서버것)}`);
  check('주소가 아닌 것을 줘도 안 죽는다', typeof 열쇠주소('이건 주소가 아니다') === 'string');
}

// ══ 2. 어디 깔렸나 ══════════════════════════════════════════════════════
trace('2-찾기');
{
  check('확장자로 갈래를 안다', 갈래('a/b/c.ts') === 'ts' && 갈래('x.py') === 'py' && 갈래('y.go') === 'go');
  check('모르는 확장자는 null', 갈래('읽어줘.hwp') === null && 갈래('') === null && 갈래(null) === null);

  // .js 를 typescript 라고 소개하면 서버가 없는 오류를 만들어 낸다.
  check('js 는 javascript 로 소개한다', 언어아이디('a.js') === 'javascript', 언어아이디('a.js'));
  check('ts 는 typescript 로 소개한다', 언어아이디('a.ts') === 'typescript', 언어아이디('a.ts'));
  check('tsx 는 따로 있다', 언어아이디('a.tsx') === 'typescriptreact', 언어아이디('a.tsx'));

  // PATH 훑기. 가짜 PATH 를 넣어 이 컴퓨터에 무엇이 깔렸든 답이 같게 한다.
  const 가짜 = mkdtempSync(join(tmpdir(), 'deel-path-'));
  writeFileSync(join(가짜, 'made-up-lsp'), '#!/bin/sh\n', 'utf8');
  writeFileSync(join(가짜, 'made-up-lsp.cmd'), '@echo off\n', 'utf8');
  const env = { PATH: 가짜, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  check('PATH 에 있으면 찾는다', !!어디있나('made-up-lsp', env), String(어디있나('made-up-lsp', env)));
  check('없으면 null', 어디있나('여기없는것', env) === null);
  check('빈 이름은 null', 어디있나('', env) === null);
  // 폴더가 이름만 같은 경우. 이걸 실행 파일로 보면 켜다 죽는다.
  mkdirSync(join(가짜, 'gopls'), { recursive: true });
  check('같은 이름의 폴더는 안 센다', 어디있나('gopls', env) === null);
  check('빈 PATH 여도 안 죽는다', 어디있나('gopls', {}) === null);
  /*
   * 윈도우: 확장자 없는 sh 스크립트를 「깔려 있다」 로 잡지 않는다 (2.0.0 6회차 Gemini 서버6bo LSV1·LSV2).
   *
   * 폴더마다 PATHEXT 를 보고 곧바로 '' 까지 봤다. 그래서 앞 폴더의 sh 가 뒤 폴더의 .cmd 를
   * 이겼고, sh 만 있으면 그걸 돌려줬다 — 어디있나 머리 주석이 막으려던 「있다고 해 놓고
   * 안 되는」 꼴 그대로다(도구는 목록에 서고, 부르면 곧바로 「서버가 없습니다」).
   */
  if (process.platform === 'win32') {
    const 앞 = join(가짜, 'front'); const 뒤 = join(가짜, 'back'); const 쉘만 = join(가짜, 'shonly');
    for (const d of [앞, 뒤, 쉘만]) mkdirSync(d, { recursive: true });
    writeFileSync(join(앞, 'two-lsp'), '#!/bin/sh\n', 'utf8');
    writeFileSync(join(뒤, 'two-lsp.cmd'), '@echo off\n', 'utf8');
    writeFileSync(join(쉘만, 'sh-only-lsp'), '#!/bin/sh\n', 'utf8');
    const 둘 = { PATH: [앞, 뒤].join(';'), PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    check('★★ 윈도우: 앞 폴더의 sh 가 뒤 폴더의 .cmd 를 이기지 않는다',
      /two-lsp\.cmd$/i.test(어디있나('two-lsp', 둘) ?? ''), String(어디있나('two-lsp', 둘)));
    const 쉘만env = { PATH: 쉘만, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    check('★★ 윈도우: 확장자 없는 sh 만 있으면 없는 것이다', 어디있나('sh-only-lsp', 쉘만env) === null,
      String(어디있나('sh-only-lsp', 쉘만env)));
    check('  윈도우: 이름에 확장자를 붙여 주면 그대로 찾는다',
      /two-lsp\.cmd$/i.test(어디있나('two-lsp.cmd', 둘) ?? ''), String(어디있나('two-lsp.cmd', 둘)));
  }
  rmSync(가짜, { recursive: true, force: true });

  const 둘러본것 = 둘러보기({ PATH: '' });
  check('아무것도 없으면 없다고 한다', 둘러본것.있는것.length === 0 && 둘러본것.없는것.length > 5,
    `${둘러본것.있는것.length} / ${둘러본것.없는것.length}`);
  check('없는 것에는 깔 방법이 붙어 있다', 둘러본것.없는것.every((x) => typeof x.깔기 === 'string'));
}

// ══ 3. 흉내 서버를 박고 켠다 ════════════════════════════════════════════
trace('3-켜기');

// 여기서부터 흉내 서버를 ts 자리에 박는다. 이 프로젝트는 .js 파일뿐이라
// 갈래가 ts 로 잡힌다 (servers.js 의 확장자갈래).
서버박기('ts', { cmd: process.execPath, args: [흉내], 이름: '흉내서버', 경로: process.execPath });
셈지우기();

{
  const 것 = await 프로젝트갈래(root);
  check('이 폴더의 언어를 센다', 것?.갈래 === 'ts' && 것.개수 >= 5, JSON.stringify(것));
  check('대표 파일이 이 폴더 안이다', String(것?.대표파일 ?? '').startsWith(root));
  check('언어서버있나 가 true', (await 언어서버있나(root)) === true);

  const 서버 = await 얻기(root, join(root, 'src', '셈.js'));
  check('켜졌다', !!서버 && 서버.살았나(), 서버 ? String(서버.죽음) : 'null');
  check('악수 뒤 능력을 받았다', 서버?.능력?.definitionProvider === true, JSON.stringify(서버?.능력 ?? {}));
  check('같은 언어는 같은 것을 다시 쓴다', (await 얻기(root, join(root, 'src', 'a.js'))) === 서버);

  const 뜬것 = 지금것들();
  check('떠 있는 것을 말해 준다', 뜬것.length === 1 && 뜬것[0].준비 === true, JSON.stringify(뜬것));

  // 흉내 서버는 켜자마자 workspace/configuration 을 되묻는다. 그걸 우리가
  // 답했어야 그 뒤 물음이 온다 — 아래 심볼 물음이 오면 답한 것이다.
  const 답 = await 서버.물어보기('workspace/symbol', { query: '셈하기' });
  check('되물음에 답해서 대화가 이어진다', Array.isArray(답.값) && 답.값.length === 1, JSON.stringify(답).slice(0, 120));
  check('한글 이름이 안 깨져서 온다', 답.값?.[0]?.name === '셈하기', String(답.값?.[0]?.name));

  // 모르는 것을 물으면 오류로 온다. 던지지 않는다 — 이게 중요하다.
  const 모름 = await 서버.물어보기('textDocument/보나마나없는것', {});
  check('모르는 물음은 오류로 온다 (안 던진다)', typeof 모름.오류 === 'string', JSON.stringify(모름));
}

// ══ 4. 안 될 때 ═════════════════════════════════════════════════════════
trace('4-안될때');
{
  // 답 안 하는 서버. 시한이 지나면 오류를 주고 넘어가야 한다.
  const 벙어리 = new 언어서버(root, { cmd: process.execPath, args: [흉내, '--mute'], 이름: '벙어리' });
  const 켜짐 = await 벙어리.켜기();
  check('악수까지는 된다', 켜짐 === true, String(벙어리.죽음));
  const 잰것 = Date.now();
  const 답 = await 벙어리.물어보기('workspace/symbol', { query: '셈하기' }, 700);
  const 걸림 = Date.now() - 잰것;
  check('안 답하면 시한 뒤에 오류를 준다', !!답.오류 && 걸림 < 3000, `${걸림}ms · ${답.오류}`);
  check('그래도 안 던졌다', typeof 답 === 'object');
  // 진단도 마찬가지. 안 왔다를 '없다' 로 바꿔 말하면 안 된다.
  const uri = 벙어리.보여주기(join(root, 'src', '셈.js'));
  const 진 = await 벙어리.진단기다리기(uri, 400);
  check('진단이 안 오면 null 이다 — 빈 배열이 아니다', 진 === null, JSON.stringify(진));
  await 벙어리.끄기();
  check('끄면 죽는다', !벙어리.살았나());

  // 켜다 죽는 서버. 다시 안 켜야 한다 — 부를 때마다 몇 초씩 물면 안 된다.
  const 죽는것 = new 언어서버(root, { cmd: process.execPath, args: [흉내, '--die'], 이름: '죽는것' });
  await 죽는것.켜기();
  /*
   * 시계로 재지 않는다.
   *
   * 여기는 300ms 를 자고 있었다. 흉내 서버가 죽는 것을 node 가 알아채는 데
   * 걸리는 시간은 그 기계가 얼마나 바쁜지에 달렸는데, 검사 백 개가 한꺼번에
   * 돌면 300ms 를 넘긴다 — 그러면 아직 안 죽은 것을 보고 「다시 켰다」 고
   * 빨간불이 켜진다. 재려던 것(죽은 것을 다시 안 켠다)과 아무 상관이 없는
   * 이유다. 죽은 것을 **본 뒤에** 재면 그 흔들림이 사라진다.
   */
  for (let i = 0; i < 100 && 죽는것.살았나(); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const 다시 = await 죽는것.켜기();
  check('죽은 것은 다시 안 켠다', 다시 === false || !죽는것.살았나(), `${다시} · ${죽는것.죽음}`);
  const 죽은뒤 = await 죽는것.물어보기('workspace/symbol', { query: 'x' });
  check('죽은 뒤 물어도 오류만 온다', !!죽은뒤.오류, JSON.stringify(죽은뒤));

  // 아예 없는 명령. 이게 제일 흔한 자리다.
  const 없는것 = new 언어서버(root, { cmd: join(root, '이런건-없다-12345'), args: [], 이름: '없는것' });
  const 안켜짐 = await 없는것.켜기();
  check('없는 명령은 못 켠 것으로 끝난다', 안켜짐 === false && !!없는것.죽음, String(없는것.죽음));
}

// ══ 4b. 진짜 서버가 실제로 하는 두 가지 ═════════════════════════════════
//
// 아래 둘은 흉내로는 안 나오고 pyright 을 붙여 보고서야 나왔다. 둘 다
// **조용히 틀리는** 종류다 — 아무것도 안 터지고, 그냥 아무 말도 안 하게 된다.
trace('4b-진짜서버가하는것');
{
  // (1) 서버는 주소를 우리와 다르게 적는다.
  //     우리: file:///C:/…    pyright: file:///c%3A/…
  //     글자로 견주면 영영 안 맞는다. 진단은 왔는데 표에서 못 찾아
  //     '안 왔다' 가 되고, 아무 말도 안 하는 것은 '성하다' 는 뜻이 된다.
  const 서버 = new 언어서버(root, { cmd: process.execPath, args: [흉내], 이름: '어긋난주소' });
  await 서버.켜기();
  const 우리주소 = 서버.보여주기(join(root, 'src', '셈.js'), 'const a = 틀린것;' + String.fromCharCode(10));
  const 것들 = await 서버.진단기다리기(우리주소, 2500);
  const 받은열쇠 = [...서버.진단.keys()][0] ?? '';
  check('서버가 주소를 다르게 적어도 찾아낸다', Array.isArray(것들) && 것들.length === 1,
    `${JSON.stringify(것들)} · 열쇠 ${받은열쇠}`);
  check('실제로 글자가 달랐다 — 그래서 재는 값이다', 받은열쇠 !== 우리주소, `${받은열쇠} vs ${우리주소}`);
  await 서버.끄기();

  // (2) 방금 켠 서버는 아직 프로젝트를 다 못 훑었다.
  //     없어서가 아니라 못 봐서 빈손으로 답한다. 그걸 '없다' 로 잘라 말하면
  //     모델은 그 말을 믿고 이미 있는 것을 새로 만든다.
  const 늦은것 = new 언어서버(root, { cmd: process.execPath, args: [흉내, '--lateindex'], 이름: '늦은색인' });
  await 늦은것.켜기();
  check('막 켠 서버는 색인 중으로 본다', 색인중일까(늦은것) === true);
  const 한번에 = await 늦은것.물어보기('workspace/symbol', { query: '셈하기' });
  check('첫 물음은 빈손이다 (흉내가 그렇게 답한다)', Array.isArray(한번에.값) && 한번에.값.length === 0,
    JSON.stringify(한번에).slice(0, 80));
  await 늦은것.끄기();

  // 도구를 통해 부르면 다시 물어봐서 찾아내야 한다.
  서버박기('ts', { cmd: process.execPath, args: [흉내, '--lateindex'], 이름: '늦은색인', 경로: process.execPath });
  await 모두끄기();
  const 찾음 = await runTool('Def', { name: '셈하기' }, 만든ctx());
  check('색인 중이면 다시 물어본다', 찾음.found === 1, JSON.stringify(찾음).slice(0, 160));
  await 모두끄기();
  서버박기('ts', { cmd: process.execPath, args: [흉내], 이름: '흉내서버', 경로: process.execPath });
}

// ══ 4c. 서버도 우리처럼 1번부터 센다 ════════════════════════════════════
//
// LSP 는 오가는 번호를 **양쪽이 따로** 센다. vscode-jsonrpc 를 쓰는 서버
// (pyright · rust-analyzer)는 1부터 세고, 우리도 1부터 센다. 번호로 먼저
// 가르면 서버의 물음이 우리 물음의 답으로 소비된다 — 답에는 method 가 없고
// 물음에는 있으니, 그것으로 갈라야 한다.
trace('4c-번호가겹칠때');
{
  const 겹침 = new 언어서버(root, { cmd: process.execPath, args: [흉내, '--collide'], 이름: '번호겹침' });
  const 켜졌나 = await 겹침.켜기();

  /*
   * 악수부터 걸린다. initialize 의 답을 서버의 물음이 가로채면 `{값: undefined}`
   * 로 풀리고, 능력이 통째로 빈 채 **준비됨**으로 표시된다. `/lsp` 는 초록으로
   * 「준비됨」 을 보여 주는데 정작 그 뒤 물음은 전부 빈손으로 돌아온다.
   */
  check('★★ 번호가 겹쳐도 악수가 제대로 끝난다', 켜졌나 === true, String(겹침.죽음 ?? ''));
  check('★★ 서버 능력을 빈손으로 안 적는다', 겹침.능력.referencesProvider === true,
    JSON.stringify(겹침.능력).slice(0, 120));

  /*
   * 진짜 쓰는 자리. 서버는 3곳을 줬는데 화면에는 「쓰는 자리가 없습니다」 가
   * 뜬다 — 모델은 그 말을 믿고 함수를 지운다.
   */
  const r = await 겹침.물어보기('textDocument/references', {
    textDocument: { uri: pathToFileURL(join(root, 'src', '셈.js')).href },
    position: { line: 3, character: 16 },
    context: { includeDeclaration: false },
  });
  check('★★ 서버가 준 답이 서버의 물음에 안 먹힌다', Array.isArray(r.값) && r.값.length === 3,
    JSON.stringify(r).slice(0, 120));
  await 겹침.끄기();
}

// ══ 4d. 한 파일을 잇달아 고칠 때 ════════════════════════════════════════
//
// 서버는 디바운스를 둔다. 1~2초 안에 두 번 고치면 **첫 판** 결과가 둘째 판
// 뒤에 도착한다. 판을 안 보고 받아 적으면, 방금 쓴 파일을 「아무 말 없음」
// 으로 답하게 된다 — 이 프로그램에서 아무 말 없음은 성하다는 뜻이다.
trace('4d-옛판진단');
{
  const 옛판서버 = new 언어서버(root, { cmd: process.execPath, args: [흉내, '--stale'], 이름: '옛판' });
  await 옛판서버.켜기();
  const 자리 = join(root, 'src', '셈.js');
  const uri = 옛판서버.보여주기(자리, 'const a = 1;' + String.fromCharCode(10));   // 1판 — 성하다
  옛판서버.보여주기(자리, 'const a = 틀린것;' + String.fromCharCode(10));          // 2판 — 탈났다
  const 것들 = await 옛판서버.진단기다리기(uri, 2500);
  check('★★ 옛 판 진단을 지금 판의 답으로 안 내준다',
    Array.isArray(것들) && 것들.length === 1, JSON.stringify(것들));
  await 옛판서버.끄기();
}

// ══ 4e. 우리가 끈 것을 「스스로 끝났다」 고 적지 않는다 ═══════════════════
//
// 놀림시계(5분)가 끄면 그 인스턴스는 풀에 그대로 남는다. 끈 것을 무너진 것으로
// 적으면 죽음이 서서 **다시는 안 켜진다** — Def·Refs 는 「언어 서버가 이 자리에
// 없습니다」 라고 하고, 고친 뒤 진단은 세션 끝까지 조용해진다.
trace('4e-끈뒤에도살아난다');
{
  const 다시 = new 언어서버(root, { cmd: process.execPath, args: [흉내], 이름: '다시켤것' });
  await 다시.켜기();
  다시.보여주기(join(root, 'src', '셈.js'), 'const a = 1;' + String.fromCharCode(10));
  await 다시.끄기();
  // exit 은 kill() 뒤에 한 박자 늦게 온다. 그 손이 돌기를 기다렸다가 잰다.
  // (여기서는 unref 를 안 한다 — 위에서 뜬 것이 다 정리돼서 프로세스가 그냥 나간다)
  await new Promise((r) => { setTimeout(r, 250); });
  check('★★ 우리가 끈 것은 죽음으로 안 적는다', 다시.죽음 === null, String(다시.죽음));
  check('★★ 껐다가 다시 켜진다', await 다시.켜기() === true, String(다시.죽음));
  // 다시 켠 서버는 파일을 모른다. 판을 안 지우면 didOpen 없이 2판을 보내서
  // 서버가 조용히 버린다 — 진단이 영영 안 온다.
  const uri2 = 다시.보여주기(join(root, 'src', '셈.js'), 'const a = 틀린것;' + String.fromCharCode(10));
  const 것들2 = await 다시.진단기다리기(uri2, 2500);
  check('★ 다시 켠 뒤에도 진단이 온다', Array.isArray(것들2) && 것들2.length === 1, JSON.stringify(것들2));
  await 다시.끄기();
}

// ══ 4g. 옛 아이가 남긴 바이트가 뒤늦게 올 때 ═════════════════════════════
//
// 받개(통 경계 맞추는 것)는 하나뿐이다. 옛 아이의 stdout 에 남아 있던 바이트가
// 다시 켠 뒤에 도착하면 그것이 **새 서버의 통 경계를 어긋내고**, 그 뒤 답이
// 전부 안 열린다. 물음마다 시한까지 기다리다 빈손으로 돌아오는데, 어디가
// 잘못됐는지는 화면에 안 뜬다.
trace('4g-옛아이의바이트');
{
  const 이어켤것 = new 언어서버(root, { cmd: process.execPath, args: [흉내], 이름: '옛바이트' });
  await 이어켤것.켜기();
  const 옛아이 = 이어켤것.아이;
  await 이어켤것.끄기();
  await 이어켤것.켜기();
  // 길이만 적힌 반쪽 머리말. 이것 하나면 그 뒤 통이 영영 안 열린다.
  옛아이.stdout.emit('data', Buffer.from('Content-Length: 999999\r\n\r\n', 'utf8'));
  const r = await 이어켤것.물어보기('workspace/symbol', { query: '셈하기' }, 2000);
  check('★★ 옛 아이가 남긴 바이트가 새 서버의 답을 안 삼킨다',
    Array.isArray(r.값) && r.값.length === 1, JSON.stringify(r).slice(0, 100));
  await 이어켤것.끄기();
}

// ══ 4f. 언어 서버가 죽는 바로 그 찰나에 쓰면 ════════════════════════════
//
// 그 찰나에는 `stdin.writable` 이 아직 true 라 #보내기 의 검사도, 그 안의
// try/catch 도 못 막는다 — EPIPE 가 한 박자 뒤에 소켓에서 튀어나오기 때문이다.
// 아무도 안 받으면 **deel 이 통째로 죽는다.** 언어 서버가 죽었을 뿐인데 하던
// 답이 그 자리에서 날아간다.
trace('4f-죽는찰나에쓰기');
{
  const 끊길것 = new 언어서버(root, { cmd: process.execPath, args: [흉내], 이름: '끊긴관' });
  await 끊길것.켜기();
  끊길것.아이.kill('SIGKILL');
  // 죽이고 **곧바로** 쓴다. 조금이라도 자면 writable 이 false 로 바뀌어
  // #보내기 가 먼저 막아 버려서, 아무것도 안 재는 검사가 된다.
  const 큰글 = 'x'.repeat(200_000);
  for (let i = 0; i < 3; i += 1) {
    끊길것.알림('textDocument/didOpen', {
      textDocument: { uri: pathToFileURL(join(root, 'src', '셈.js')).href, languageId: 'js', version: 1, text: 큰글 },
    });
  }
  await new Promise((r) => { setTimeout(r, 400); });
  // 여기까지 왔다는 것 자체가 재는 값이다. 손이 없으면 위에서 프로세스가 죽는다.
  check('★★ 언어 서버가 죽는 찰나에 써도 deel 이 안 죽는다', true, '400ms 뒤에도 살아 있습니다');
  await 끊길것.끄기();
}

// ══ 5. Def · Refs ═══════════════════════════════════════════════════════
trace('5-도구');
{
  const ctx = 만든ctx();

  const d = await runTool('Def', { name: '셈하기' }, ctx);
  check('Def: 자리를 준다', d.found === 1 && /셈\.js:4/.test(d.content), JSON.stringify(d).slice(0, 160));
  check('Def: 그 줄의 글까지 준다 — 열어 보지 않아도 안다', /export function 셈하기/.test(d.content), d.content);
  check('Def: 경로는 이 폴더 기준이다', !d.content.includes(root), d.content);

  // 같은 이름이 여럿일 때. 하나를 골라 주고 아닌 척하면 안 된다.
  const 여럿 = await runTool('Def', { name: 'run' }, ctx);
  check('Def: 같은 이름이 여럿이면 그렇다고 말한다', /여러|2곳|2 곳|같은 이름/.test(여럿.summary ?? ''), 여럿.summary);
  check('Def: 어떻게 좁히는지도 말해 준다', /file_path/.test(여럿.summary ?? ''), 여럿.summary);
  /*
   * ── 그 말이 **모델에게** 가나 ─────────────────────────────────────────
   *
   * 이 말은 summary 에만 붙어 있었다. 그런데 모델이 받는 글은 content 다 —
   * loop.js 의 실을글() 은 content 가 비지 않으면 그것만 싣고 summary 는
   * 버린다. 즉 **줄 자리가 있을 때는 이 말이 한 번도 안 갔다.**
   *
   * 사람 화면에는 멀쩡히 찍히니 아무도 눈치를 못 챈다. 모델은 자리 하나만
   * 받고 그게 유일한 정의인 줄 알고, 남의 파일의 같은 이름을 고친다.
   */
  check('★ Def: 여럿이라는 말이 모델이 받는 글에도 있다', /같은 이름이/.test(실을글(여럿)),
    실을글(여럿).replace(/\n/g, ' | '));

  const r = await runTool('Refs', { name: '셈하기' }, ctx);
  check('Refs: 쓰는 자리를 다 준다', r.found === 3, JSON.stringify(r).slice(0, 160));
  check('Refs: 파일별로 묶는다', r.files === 2, String(r.files));
  check('Refs: 몇 파일인지 먼저 말한다', /2개 파일/.test(r.summary ?? ''), r.summary);
  check('Refs: 줄 번호와 글이 같이 온다', /5: .*셈하기/.test(r.content ?? ''), r.content);

  /*
   * ── 자른 것을 **모델에게** 자랐다고 말하나 ────────────────────────────
   *
   * 참조가 창에 안 들어가면 잘라야 한다. 그건 맞다. 그런데 「70곳은 안
   * 실었습니다」 가 summary 에만 붙어 있었고, 모델은 content 만 받는다 —
   * 즉 **자를 것이 있을 때만** 그 말이 빠졌다. 알려야 할 바로 그때.
   *
   * 8k 모델의 한도는 50이다(budget.js 의 찾을개수는 거기서 바닥을 친다).
   * 120곳 중 50곳을 받은 모델은 그 50곳을 고치고 「모든 참조를 고쳤습니다」
   * 로 답을 맺는다. 남은 70곳은 돌려 본 뒤에야 드러난다.
   */
  서버박기('ts', { cmd: process.execPath, args: [흉내, '--manyrefs'], 이름: '참조많음', 경로: process.execPath });
  await 모두끄기();
  const 많은것 = await runTool('Refs', { name: 'run' }, 만든ctx({ 모델컨텍스트: 8192 }));
  await 모두끄기();
  서버박기('ts', { cmd: process.execPath, args: [흉내], 이름: '흉내서버', 경로: process.execPath });

  check('Refs: 창에 안 들어가면 자른다', 많은것.found === 120 && 많은것.locations?.length === 50 && 많은것.truncated === true,
    JSON.stringify({ found: 많은것.found, 실은것: 많은것.locations?.length, truncated: 많은것.truncated }));
  check('★ Refs: 자랐다는 말이 모델이 받는 글에 있다', /70곳은 자리가 모자라 안 실었습니다/.test(실을글(많은것)),
    실을글(많은것).split('\n').slice(-3).join(' | '));
  check('★ Refs: 여럿이라는 말도 모델이 받는 글에 있다', /같은 이름이/.test(실을글(많은것)),
    실을글(많은것).split('\n').slice(-3).join(' | '));
  check('사람이 보는 요약도 그대로다', /70곳은 자리가 모자라 안 실었습니다/.test(많은것.summary ?? ''), 많은것.summary);
  check('안 자른 답에는 그 말이 안 붙는다', !/자리가 모자라/.test(실을글(r)), 실을글(r).split('\n').slice(-2).join(' | '));

  /*
   * ── 이름이 똑같지 않을 때 · 한 파일의 같은 이름 · 어디서 온 자리인지 (2.0.0 6회차 LS1~LS5) ──
   *
   * 다섯 자리가 다 같은 약속을 어겼다 — 「하나를 골라 주고 아닌 척하지 않는다」.
   *   LS1 이름이 똑같은 것이 없으면 아무 부분 일치나(셈 → 셈하기) 짚고 말이 없었다.
   *   LS2 한 파일 안의 서로 다른 둘(A.go · B.go)은 「여럿」 이라 안 했다.
   *   LS3 정의를 못 받아 심볼 검색 자리를 줘도 「정의 1곳」 이라고만 했다.
   *   LS4 자른 뒤 파일 수만 셌다 — 두 파일인데 「파일 1개」.
   *   LS5 참조가 0곳이면 같은 이름이 여럿이라는 말이 빠져 「지워도 된다」 로 읽혔다.
   */
  writeFileSync(join(root, 'src', '같은곳.js'), [
    'class A { go() {} }', 'class B { go() {} }', 'function 겹(a) {}', 'function 겹(a, b) {}',
  ].join('\n'), 'utf8');
  const 한줄로 = (x) => String(x ?? '').replace(/\n/g, ' | ');

  const 부분 = await runTool('Def', { name: '셈' }, ctx);
  check('★★ Def: 이름이 똑같은 것이 없으면 부분 일치(셈하기)를 짚지 않는다',
    !!부분.error && /못 찾/.test(부분.error), JSON.stringify(부분).slice(0, 160));
  const 꾸민 = await runTool('Def', { name: '몫' }, ctx);
  check('  Def: 서버가 꾸민 이름(셈.몫)은 낱말로 들어 있으니 받는다', 꾸민.found >= 1, JSON.stringify(꾸민).slice(0, 160));
  check('★ Def: 꾸민 이름을 짚었으면 무엇을 짚었는지 모델에게 말한다', /셈\.몫/.test(실을글(꾸민)), 한줄로(실을글(꾸민)));
  check('  사람 화면에도 같은 말', /셈\.몫/.test(꾸민.summary ?? ''), 한줄로(꾸민.summary));

  const 한파일 = await runTool('Def', { name: 'go' }, ctx);
  check('★★ Def: 한 파일 안의 서로 다른 go 둘도 여럿이라고 말한다', /같은 이름이/.test(실을글(한파일)), 한줄로(실을글(한파일)));
  const 겹침 = await runTool('Def', { name: '겹' }, ctx);
  check('  Def: 같은 자리의 겹쳐쓰기(컨테이너 같음)는 여럿이라고 떠들지 않는다', !/같은 이름이/.test(실을글(겹침)), 한줄로(실을글(겹침)));

  서버박기('ts', { cmd: process.execPath, args: [흉내, '--nodef'], 이름: '정의없음', 경로: process.execPath });
  await 모두끄기();
  const 심볼로 = await runTool('Def', { name: '셈하기' }, ctx);
  check('★ Def: 정의를 못 받아 심볼 검색 자리를 주면 그렇다고 모델에게 말한다', /심볼 검색/.test(실을글(심볼로)), 한줄로(실을글(심볼로)));
  check('  사람 화면에도 같은 말', /심볼 검색/.test(심볼로.summary ?? ''), 한줄로(심볼로.summary));

  서버박기('ts', { cmd: process.execPath, args: [흉내, '--norefs'], 이름: '참조없음', 경로: process.execPath });
  await 모두끄기();
  const 빈참조 = await runTool('Refs', { name: 'run' }, ctx);
  check('★★ Refs: 참조가 0곳이어도 같은 이름이 여럿이면 그렇다고 말한다', /같은 이름이/.test(실을글(빈참조)), 한줄로(실을글(빈참조)));

  서버박기('ts', { cmd: process.execPath, args: [흉내, '--refs-onefile'], 이름: '한쪽참조', 경로: process.execPath });
  await 모두끄기();
  const 한쪽 = await runTool('Refs', { name: '셈하기' }, 만든ctx({ 모델컨텍스트: 8192 }));
  await 모두끄기();
  서버박기('ts', { cmd: process.execPath, args: [흉내], 이름: '흉내서버', 경로: process.execPath });
  check('★★ Refs: 잘라도 파일 수는 전체로 센다 (보인 것은 a.js 뿐이어도 두 파일)',
    한쪽.files === 2 && /2개 파일/.test(한쪽.summary ?? ''), JSON.stringify({ files: 한쪽.files, summary: 한쪽.summary }));
  check('★ Refs: 말이 안 겹친다 — 「파일 2개 파일」 이 아니다', !/파일 \d+개 파일/.test(한쪽.summary ?? ''), 한쪽.summary);

  // 파일·줄로 짚어 주는 길. 모델이 Grep 으로 좁혀 온 다음에 오는 자리다.
  const 짚은것 = await runTool('Refs', { name: '셈하기', file_path: 'src/쓰는곳.js', line: 5 }, ctx);
  check('Refs: 파일·줄로 짚어도 된다', 짚은것.found === 3, JSON.stringify(짚은것).slice(0, 120));

  // 이름이 그 줄에 없으면 없다고 해야 한다. 엉뚱한 자리를 짚으면 안 된다.
  const 엉뚱 = await runTool('Refs', { name: '셈하기', file_path: 'src/쓰는곳.js', line: 3 }, ctx);
  check('Refs: 그 줄에 없으면 없다고 한다', !!엉뚱.error && /못 찾/.test(엉뚱.error), JSON.stringify(엉뚱));

  /*
   * 줄 번호가 **따옴표에 싸여** 오는 판 (8회차 · 바깥).
   *
   * 스키마에 number 라고 적어 뒀어도 `"line": "3"` 으로 보내는 모델이 있다.
   * `Number.isFinite('3')` 는 false 라 그 줄이 통째로 버려졌고, 도구는 오류도
   * 없이 **파일 처음부터** 이름을 찾아 엉뚱한 줄을 짚어 놓고 찾았다고 답했다.
   * 잘못 짚었다는 신호가 어디에도 없는 것이 이 고장의 값이다.
   */
  const 글자줄 = await runTool('Refs', { name: '셈하기', file_path: 'src/쓰는곳.js', line: '3' }, ctx);
  check('★★ 줄 번호가 문자열로 와도 그 줄을 짚는다 (없으면 없다고 한다)',
    !!글자줄.error && /못 찾/.test(글자줄.error), JSON.stringify(글자줄).slice(0, 140));
  const 글자맞는줄 = await runTool('Refs', { name: '셈하기', file_path: 'src/쓰는곳.js', line: '5' }, ctx);
  check('★ 문자열 줄로도 제대로 짚으면 숫자로 준 것과 같은 답이다',
    글자맞는줄.found === 짚은것.found, JSON.stringify({ 글자: 글자맞는줄.found, 숫자: 짚은것.found }));
  const 빈줄 = await runTool('Refs', { name: '셈하기', file_path: 'src/쓰는곳.js', line: '' }, ctx);
  check('★ 빈 값은 「줄을 안 준 것」 으로 본다 (0번 줄이 아니다)',
    빈줄.found === 3, JSON.stringify(빈줄).slice(0, 120));

  // 낱말 경계. `셈` 으로 `셈하기` 를 짚으면 안 된다.
  const 조각 = await runTool('Def', { name: '몫', file_path: 'src/셈.js', line: 2 }, ctx);
  check('낱말 경계를 본다', !조각.error || !/몫/.test(조각.error ?? ''), JSON.stringify(조각).slice(0, 100));

  // 폴더 밖은 못 본다. 이 약속은 언어 서버가 붙었다고 느슨해지지 않는다.
  const 밖 = await runTool('Def', { name: '셈하기', file_path: '../../밖에것.js' }, ctx);
  check('폴더 밖은 막는다', !!밖.error && /범위/.test(밖.error), JSON.stringify(밖));

  check('이름이 비면 그렇다고 한다', !!(await runTool('Def', { name: '  ' }, ctx)).error);
  check('없는 이름은 못 찾았다고 한다',
    !!(await runTool('Def', { name: '이런건없다' }, ctx)).error, '');
}

// ══ 5b. 참조가 많아도 파일은 파일마다 한 번 (사냥4 W3) ═══════════════════
//
// 한줄() 이 **참조 하나마다** 그 파일을 통째로 다시 읽었다. 4만 줄짜리 파일에
// 참조 5000곳이면 5000번을 읽고, trim() 으로 뗀 줄이 그 큰 글 전체를 붙들어
// 힙이 넘쳤다. 게다가 창에 안 실을 70곳까지 다 읽었다.
//
// 읽은 횟수는 밖에서 안 보인다. node:fs 의 readFileSync 를 잠깐 세는 것으로
// 갈아 끼우고(syncBuiltinESMExports 가 ESM 이름표까지 갱신한다) 센다.
trace('5b-참조많을때읽기');
{
  서버박기('ts', { cmd: process.execPath, args: [흉내, '--manyrefs'], 이름: '참조많음', 경로: process.execPath });
  await 모두끄기();
  const fs모듈 = createRequire(import.meta.url)('node:fs');
  const 원래 = fs모듈.readFileSync;
  let 읽은수 = 0;
  fs모듈.readFileSync = function 세며읽기(...인자) {
    if (/[\\/]src[\\/][ab]\.js$/.test(String(인자[0]))) 읽은수 += 1;
    return 원래.apply(this, 인자);
  };
  syncBuiltinESMExports();
  let 결과 = null;
  try {
    결과 = await runTool('Refs', { name: 'run', file_path: 'src/a.js', line: 2 }, 만든ctx({ 모델컨텍스트: 8192 }));
  } finally {
    fs모듈.readFileSync = 원래;
    syncBuiltinESMExports();
  }
  await 모두끄기();
  서버박기('ts', { cmd: process.execPath, args: [흉내], 이름: '흉내서버', 경로: process.execPath });
  // 6절은 서버가 **이미 떠 있다** 는 전제로 첫 편집부터 진단을 받는다. 껐으니 다시 데워 둔다.
  await 얻기(root, join(root, 'src', '셈.js'));
  check('  참조 120곳을 받았고 50곳을 실었다', 결과?.found === 120 && 결과?.locations?.length === 50,
    JSON.stringify({ found: 결과?.found, 실은것: 결과?.locations?.length, error: 결과?.error }));
  check('★★ 참조가 120곳이어도 파일은 파일마다 한 번만 읽는다', 읽은수 <= 4, `${읽은수}번 읽음`);
  check('  줄 글은 그대로 붙는다', /run/.test(결과?.content ?? ''), (결과?.content ?? '').slice(0, 80));
}

// ══ 6. 고친 뒤 진단 ═════════════════════════════════════════════════════
trace('6-진단');
{
  const ctx = 만든ctx();
  const 성한것 = join(root, 'src', '성한것.js');
  const 탈난것 = join(root, 'src', '탈난것.js');

  // 서버는 이미 떠 있다(5절에서 켰다). 그래서 첫 편집부터 받는다.
  const w1 = await runTool('Write', { file_path: 'src/성한것.js', content: 'export const 하나 = 1;\n' }, ctx);
  check('성할 때는 아무 말도 안 붙인다', !/언어 서버/.test(w1.summary ?? ''), w1.summary);
  check('성할 때 결과 모양은 그대로다', w1.changed === 성한것 && typeof w1.content === 'string', JSON.stringify(w1).slice(0, 120));

  const w2 = await runTool('Write', { file_path: 'src/탈난것.js', content: 'export const x = 틀린것;\n' }, ctx);
  check('탈이 있으면 붙여 준다', /언어 서버/.test(w2.summary ?? ''), w2.summary);
  check('오류 수를 센다', w2.diagnostics?.errors === 1, JSON.stringify(w2.diagnostics));
  check('몇 줄인지 말해 준다', /1줄 오류/.test(w2.summary ?? ''), w2.summary);
  check('원래 요약을 안 지운다', /1줄/.test(w2.summary ?? '') && w2.changed === 탈난것, w2.summary);

  // 고친 뒤에는 진단이 갱신돼야 한다. didChange 를 안 보내면 옛 진단이 남는다.
  const e1 = await runTool('Edit', {
    file_path: 'src/탈난것.js', old_string: '틀린것', new_string: '1',
  }, ctx);
  check('고쳐서 성해지면 말이 사라진다', !/언어 서버/.test(e1.summary ?? ''), e1.summary);

  // 경고만 있을 때도 말해 준다.
  const w3 = await runTool('Write', { file_path: 'src/찜찜.js', content: 'const 찜찜한것 = 1;\n' }, ctx);
  check('경고도 말해 준다', w3.diagnostics?.warnings === 1 && w3.diagnostics?.errors === 0,
    JSON.stringify(w3.diagnostics));

  // 여러 파일을 한 번에 만들 때. 결과 모양(여럿)은 그대로여야 한다.
  const w4 = await runTool('Write', {
    files: [
      { file_path: 'src/여럿1.js', content: 'export const a = 틀린것;\n' },
      { file_path: 'src/여럿2.js', content: 'export const b = 2;\n' },
    ],
  }, ctx);
  check('여러 개 만들어도 여럿 모양 그대로', Array.isArray(w4.여럿) && w4.여럿.length === 2, JSON.stringify(w4).slice(0, 120));
  check('여러 개 중 탈난 것을 말해 준다', /여럿1/.test(w4.summary ?? ''), w4.summary);

  // /lsp off 면 아무것도 안 붙어야 한다.
  const 끈ctx = 만든ctx({ lsp: { 켬: false } });
  const w5 = await runTool('Write', { file_path: 'src/꺼짐.js', content: 'export const y = 틀린것;\n' }, 끈ctx);
  check('꺼 두면 안 붙는다', !/언어 서버/.test(w5.summary ?? '') && !w5.diagnostics, w5.summary);

  // 진단이 안 오는 파일 갈래는 조용히 지나간다.
  const w6 = await runTool('Write', { file_path: '읽을거리.md', content: '# 틀린것\n' }, ctx);
  check('언어 서버가 없는 갈래는 그냥 지나간다', !w6.diagnostics && !/언어 서버/.test(w6.summary ?? ''), w6.summary);

  // 붙이기() 는 진단이 없으면 결과를 안 건드려야 한다 — 같은 객체 그대로.
  const 그대로 = { summary: 'x' };
  check('진단이 없으면 결과를 안 건드린다', 붙이기(그대로, null, 'a.js') === 그대로);
  check('오류·경고가 0이면 안 건드린다', 붙이기(그대로, { 오류: 0, 경고: 0, 글: '' }, 'a.js') === 그대로);

  // 안 떠 있으면 조용히 넘어가고, 대신 뒤에서 데운다.
  const 딴데 = mkdtempSync(join(tmpdir(), 'deel-lsp2-'));
  writeFileSync(join(딴데, 'z.js'), 'const a = 1;\n', 'utf8');
  const 없을때 = await 편집후진단(딴데, join(딴데, 'z.js'), { 시한: 300 });
  check('안 떠 있으면 null 을 준다', 없을때 === null, JSON.stringify(없을때));
  check('데우기는 안 던진다', (() => { try { 데우기(딴데, join(딴데, 'z.js')); 데우기(딴데, 'x.hwp'); return true; } catch { return false; } })());
  // 데운 서버는 그 폴더를 **cwd 로 잡고** 있다. 윈도우는 그 상태의 폴더를 못
  // 지운다 — 그래서 지우는 것은 다 끄고 나서다(8절). 이게 사람 쪽에서도 그대로
  // 문제가 되는 자리다: 안 거두면 프로젝트 폴더가 잠긴 채로 남는다.
  치울것.push(딴데);
}

// ══ 7. 목록에 언제 서나 ═════════════════════════════════════════════════
trace('7-목록');
{
  const 없이 = toolSchemas(null, { work: 'code', ctx: 128000 }).map((t) => t.function.name);
  const 있게 = toolSchemas(null, { work: 'code', ctx: 128000, lsp: true }).map((t) => t.function.name);
  check('언어 서버가 없으면 목록에 안 선다', !없이.includes('Def') && !없이.includes('Refs'), 없이.join());
  check('있으면 선다', 있게.includes('Def') && 있게.includes('Refs'), 있게.join());
  check('그 밖의 도구는 그대로다', 없이.length + 2 === 있게.length, `${없이.length} / ${있게.length}`);

  // 이름을 직접 준 길(하위 작업이 물려받는 길)에서도 같은 규칙이 걸린다.
  const 이름으로 = toolSchemas(['Read', 'Def', 'Refs'], { ctx: 128000 }).map((t) => t.function.name);
  check('이름을 줘도 서버가 없으면 뺀다', 이름으로.join() === 'Read', 이름으로.join());

  // 읽기 전용 모드에서도 쓸 수 있어야 한다 — 아무것도 안 바꾸는 도구다.
  for (const 모드 of ['ask', 'plan', 'architect']) {
    const 목록 = toolSchemas(null, { work: 모드, ctx: 128000, lsp: true }).map((t) => t.function.name);
    check(`${모드} 모드에서도 쓴다`, 목록.includes('Def') && 목록.includes('Refs'), 목록.join());
    check(`${모드} 모드는 여전히 파일을 안 바꾼다`, !목록.includes('Write') && !목록.includes('Edit'), 목록.join());
  }
  check('모드 허용 목록에 들어 있다', 모드허용('ask', ['Def', 'Refs']).length === 2);

  // Grep · Outline 은 그대로 남는다. 이 기능은 더하는 것이지 갈아 끼우는 것이 아니다.
  check('Grep 은 그대로 있다', 있게.includes('Grep') && !!TOOLS.Grep);
  check('Outline 도 그대로 있다', 있게.includes('Outline') && !!TOOLS.Outline);
  check('Verify 도 그대로 있다', 있게.includes('Verify') && !!TOOLS.Verify);

  // 설명이 무엇을 하는 도구인지 말하고 있나.
  const 설명 = (n) => TOOLS[n].schema.description;
  check('Def 설명이 Grep 과 다른 점을 말한다', /Grep/.test(설명('Def')), 설명('Def').slice(0, 60));
  check('Refs 설명이 Grep 도 같이 쓰라고 한다', /Grep/.test(설명('Refs')), 설명('Refs').slice(0, 60));
}

// ══ 8. 정리 ═════════════════════════════════════════════════════════════
trace('8-정리');
{
  const 뜬것 = 지금것들();
  const 살아있던수 = 뜬것.filter((x) => x.살았나).length;
  await 모두끄기();
  await new Promise((r) => setTimeout(r, 200));
  check('다 끄면 하나도 안 남는다', 지금것들().length === 0, JSON.stringify(지금것들()));
  적어둘것.push(`흉내 서버 ${살아있던수}개를 띄웠다가 다 거뒀습니다.`);

  // 끈 뒤에 또 꺼도 안 죽어야 한다. 프로그램이 끝날 때 두 군데서 부를 수 있다.
  let 두번째괜찮 = true;
  try { await 모두끄기(); } catch { 두번째괜찮 = false; }
  check('두 번 꺼도 안 죽는다', 두번째괜찮);
}

// ══ 9. 신호를 받으면 치우고 **원래대로 죽는가** ══════════════════════════
trace('9-신호');

/*
 * ── 무슨 일이 났었나 ────────────────────────────────────────────────────
 *
 * 이 파일은 exit·SIGINT·SIGTERM 세 신호에 손을 달아 놓고 아이만 치웠다.
 * 그런데 Node 는 SIGINT·SIGTERM 에 손이 하나라도 달려 있으면 **기본 동작
 * (끝내기)을 안 한다.** 그래서 lsp/client.js 가 한 번이라도 불려 들어온
 * 프로그램은 유닉스에서 SIGTERM 을 **삼켰다** —
 *
 *     kill <pid>  →  언어 서버는 죽고, deel 은 그대로 산다
 *
 * 잡 관리자·컨테이너 종료·systemd 가 전부 이 신호로 정리한다. 삼키면
 * 그것들이 시간을 다 기다린 뒤 SIGKILL 로 때려잡고, 그때는 정작 아이 정리를
 * 못 하고 죽는다 — 막으려던 것이 그대로 일어난다.
 *
 * 재는 것은 프로세스가 **어떻게 죽는가** 라서, 같은 프로세스 안에서는 잴 수가
 * 없다. 아이를 따로 띄운다(test/signal-child.mjs).
 */
/*
 * 갈림부터 값으로 잰다.
 *
 * 윈도우에서는 아래 e2e 가 SIGTERM 길을 못 밟는다(신호를 보내면 손이 돌기도
 * 전에 Node 가 죽인다). 그런데 갈림이 틀리면 유닉스에서 한 방 실행의 Ctrl+C 가
 * 턴만 끊는 대신 프로그램을 통째로 죽인다 — 어느 판에서든 재어야 하는 자리다.
 */
{
  check('★ 우리 손 하나뿐이면 그 신호로 죽는다', 다시보낼까('SIGTERM', 1) === true);
  check('★ 남이 그 신호를 맡고 있으면 안 건드린다', 다시보낼까('SIGTERM', 2) === false);
  check('손이 아예 없어도 죽는 쪽이다', 다시보낼까('SIGTERM', 0) === true);
  // 끝나는 길에 거둘 그물이 실제로 걸려 있나. 아래 e2e 는 윈도우에서
  // 이걸 못 가린다 — OS 가 프로세스 나무를 통째로 거두기 때문이다.
  check('★ 끝나는 길에 아이들 거두는 그물이 걸려 있다',
    process.listeners('exit').includes(아이들데려가기));
}

{
  const { spawn } = await import('node:child_process');
  const 윈도우 = process.platform === 'win32';

  const 아이 = spawn(process.execPath, [join(여기, 'signal-child.mjs')], {
    cwd: resolve(여기, '..'), stdio: ['pipe', 'pipe', 'pipe'],
  });
  let 나온글 = '';
  아이.stdout.setEncoding('utf8');
  아이.stdout.on('data', (d) => { 나온글 += d; });
  아이.stderr.setEncoding('utf8');
  아이.stderr.on('data', (d) => { 나온글 += d; });

  let 끝난것 = null;
  const 닫힘 = new Promise((r) => 아이.on('close', (code, sig) => { 끝난것 = { code, sig }; r(); }));
  const 자기 = (ms) => new Promise((r) => setTimeout(r, ms));

  // 손자가 실제로 뜰 때까지 기다린다. 안 뜬 채로 재면 무엇을 잰 것인지 모른다.
  let 손자 = null;
  for (let i = 0; i < 300 && 손자 === null; i++) {
    const m = /손자 (\d+)/.exec(나온글);
    if (m) 손자 = Number(m[1]);
    else await 자기(50);
  }
  check('먼저: 손자(언어 서버)가 실제로 떴다', Number.isInteger(손자),
    나온글.trim().slice(0, 120) || '아무 말도 안 했다');

  /** pid 가 아직 살아 있나. 0 신호는 아무 일도 안 하고 있는지만 본다. */
  const 살아있나 = (pid) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };

  if (손자 !== null) {
    check('먼저: 손자가 살아 있다', 살아있나(손자), String(손자));

    if (윈도우) {
      // 윈도우에서는 SIGTERM 을 보내도 손이 안 돈다(Node 가 곧바로 죽인다).
      // 그래서 'exit' 그물 쪽을 잰다 — 여기서 안 거두면 서버가 그대로 남는다.
      아이.stdin.write('exit\n');
    } else {
      아이.kill('SIGTERM');
    }

    await Promise.race([닫힘, 자기(12_000)]);

    // 죽는 데 잠깐 걸린다. 몇 번 다시 본다.
    let 죽었나 = false;
    for (let i = 0; i < 60 && !죽었나; i++) {
      죽었나 = !살아있나(손자);
      if (!죽었나) await 자기(50);
    }
    /*
     * 윈도우에서는 이 줄이 그물을 가리지 못한다.
     *
     * 재어 봤다 — 부모를 SIGKILL 로 죽여(손이 하나도 못 돈다) 봐도 손자가
     * 200ms 안에 같이 사라진다. 윈도우가 프로세스 나무를 통째로 거두기
     * 때문이다. 그러니 여기서 초록이 떠도 **우리 그물이 돌았다는 뜻은
     * 아니다.** 그물 자체는 위에서 값으로 가렸고, 진짜로 도는지는 유닉스에서
     * 이 줄이 가린다. 이름표에 그대로 적어 둔다 — 안 적으면 지키는 것보다
     * 많이 지킨다고 읽힌다.
     */
    check(윈도우
      ? '(윈도우) 부모가 끝나면 언어 서버도 없어진다 — 다만 OS 가 나무째 거둔다'
      : '★ 부모가 끝나면 언어 서버도 같이 데려간다', 죽었나,
    죽었나 ? '' : `${손자} 가 아직 살아 있다`);

    /*
     * ★ 여기가 이 절의 핵심이다. 고치기 전에는 SIGTERM 을 보내면 아이가
     * 치워지기만 하고 프로세스는 **안 죽었다** — 12초를 기다려도 그대로였다.
     */
    check(윈도우
      ? '★ (윈도우) 신호 대신 끝내기로도 프로세스가 끝난다'
      : '★ SIGTERM 을 삼키지 않고 그 자리에서 끝난다',
    끝난것 !== null, 끝난것 ? JSON.stringify(끝난것) : '12초를 기다려도 안 끝났다');

    if (!윈도우 && 끝난것) {
      // 셸이 기대하는 값이다 — 신호로 죽었으면 signal 이 실리거나 128+15 로 온다.
      check('★ 끝난 까닭이 SIGTERM 으로 남는다',
        끝난것.sig === 'SIGTERM' || 끝난것.code === 143, JSON.stringify(끝난것));
    }
  }

  try { 아이.kill('SIGKILL'); } catch { /* 이미 죽었다 */ }
}

// ══ 언어서버6: 되묻기 답 · 끄다 만 물음 · 셸 껍질째 끄기 (2.0.0 6회차 사냥) ═══
trace('언어서버6');
{
  /*
   * 되물은 설정에는 **항목마다 null** 로 답한다.
   *
   * 빈 표 `{}` 는 「설정이 있는데 비었다」 로 읽힌다. 서버는 제 기본값 대신 그 빈 표를
   * 설정으로 받아 켜 두어야 할 검사를 끈 채로 돈다. 규약도 VS Code 도 「모르면 null」 이다.
   */
  const 설정서버 = new 언어서버(root, { cmd: process.execPath, args: [흉내], 이름: '설정답' });
  await 설정서버.켜기();
  await new Promise((r) => setTimeout(r, 150));
  const 받은 = await 설정서버.물어보기('stub/설정답', {});
  check('★ 되물은 설정에는 항목마다 null 로 답한다',
    JSON.stringify(받은?.값?.받은것) === '[null]', JSON.stringify(받은));
  await 설정서버.끄기();

  /*
   * 끄면 기다리던 물음이 **그 자리에서** 풀린다.
   *
   * 끄기는 기다림 표를 비우기만 했다. 부르던 쪽의 약속은 아무도 안 풀어서 제 시한
   * (길면 수십 초)까지 그대로 멎었다 — 서버는 이미 없는데.
   */
  const 끌것 = new 언어서버(root, { cmd: process.execPath, args: [흉내, '--mute'], 이름: '끄다만물음' });
  await 끌것.켜기();
  const 잰때 = Date.now();
  const 물음 = 끌것.물어보기('workspace/symbol', { query: '셈하기' }, 8000);
  await new Promise((r) => setTimeout(r, 50));
  await 끌것.끄기();
  const 풀린것 = await Promise.race([물음, new Promise((r) => { setTimeout(() => r('안 풀림'), 3000); })]);
  const 걸린 = Date.now() - 잰때;
  check('★ 끄면 기다리던 물음이 그 자리에서 오류로 풀린다',
    풀린것 !== '안 풀림' && !!풀린것?.오류 && 걸린 < 2800, `${JSON.stringify(풀린것)} · ${걸린}ms`);

  /*
   * 윈도우에서 `.cmd` 로 띄운 서버는 **껍질째** 끈다.
   *
   * 우리가 쥔 아이는 cmd.exe 다. 그것만 kill() 하면 cmd 는 죽고 그 안에서 뜬 진짜 서버
   * (node·python)는 부모 없이 남는다 — 끌 때마다 하나씩 쌓인다. mcp.js 의 닫기와 같이
   * 나무째 거둔다.
   */
  if (process.platform === 'win32') {
    const { readFileSync } = await import('node:fs');
    const 곳 = mkdtempSync(join(tmpdir(), 'deel-lsp-cmd-'));
    치울것.push(곳);
    const 쉼 = join(곳, 'fake-ls.cmd');
    writeFileSync(쉼, `@echo off\r\n"${process.execPath}" "${흉내}" %*\r\n`);
    const pid파일 = join(곳, 'pid.txt');
    const 껍질 = new 언어서버(root, {
      cmd: 쉼, 경로: 쉼, args: ['--mute', '--sticky', `--pidfile=${pid파일}`], 이름: '셸껍질',
    });
    const 켜짐 = await 껍질.켜기();
    let 속pid = null;
    for (let i = 0; i < 60 && 속pid === null; i++) {
      try { 속pid = Number(readFileSync(pid파일, 'utf8')) || null; } catch { /* 아직 안 적었다 */ }
      if (속pid === null) await new Promise((r) => setTimeout(r, 50));
    }
    check('먼저: .cmd 로 띄운 서버가 켜지고 속 pid 를 적었다',
      켜짐 === true && Number.isInteger(속pid), `${켜짐} · ${속pid} · ${껍질.죽음}`);
    if (Number.isInteger(속pid)) {
      await 껍질.끄기();
      const 살았나 = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
      let 죽었나 = false;
      for (let i = 0; i < 60 && !죽었나; i++) {
        죽었나 = !살았나(속pid);
        if (!죽었나) await new Promise((r) => setTimeout(r, 50));
      }
      check('★ (윈도우) .cmd 껍질째 끄면 안의 서버도 같이 죽는다', 죽었나, 죽었나 ? '' : `${속pid} 가 아직 살아 있다`);
      if (!죽었나) { try { process.kill(속pid); } catch { /* 이미 갔다 */ } }
    }
  }

  /*
   * 남이 SIGINT 를 맡고 있으면 언어 서버도 **안 거둔다.**
   *
   * 신호 손은 「남이 맡고 있으면 그쪽 뜻이 먼저다」 라고 적어 두고, 그 갈림보다 **먼저**
   * 아이들을 거뒀다. 대화 화면의 Ctrl+C 는 턴만 끊고 세션은 사는데, 언어 서버는 전부
   * 죽고 풀도 비었다 — 다음 편집부터 진단이 조용해진다(조용한 것은 성하다는 뜻이다).
   */
  서버박기('ts', { cmd: process.execPath, args: [흉내], 이름: '흉내서버', 경로: process.execPath });
  const 남을서버 = await 얻기(root, join(root, 'src', '셈.js'));
  const 남의손 = () => {};
  process.on('SIGINT', 남의손);
  try { process.emit('SIGINT', 'SIGINT'); } finally { process.removeListener('SIGINT', 남의손); }
  check('★ 남이 SIGINT 를 맡고 있으면 언어 서버를 안 거둔다',
    !!남을서버 && 지금것들().some((x) => x.살았나) && 남을서버.살았나(), JSON.stringify(지금것들()));
}

// ══ 9. 8회차 · 바깥 — 아직 아무도 안 잰 여덟 ═════════════════════════════
trace('9-바깥8회차');
{
  /*
   * ── 살았나() 가 **신호로 죽은 것**을 살았다고 한다 ────────────────────
   *
   * 신호로 죽으면 node 는 `exitCode` 를 null 로 두고 `signalCode` 에 그 신호를 담는다
   * (윈도우는 신호를 흉내만 내서 종료 코드 1 이 되므로, 이 PC 에서는 그 모양을 그대로
   * 만들어 잣대만 잰다). 잣대가 signalCode 를 아예 안 봐서, OOM 킬러나 밖에서 온
   * taskkill 로 죽은 서버가 **살아 있는 것으로 통과한다** — 물음마다 시한까지 기다렸다
   * 빈손으로 오고, 다시 켜지지도 않는다.
   */
  const 잣대 = new 언어서버(root, { cmd: process.execPath, args: [흉내], 이름: '흉내서버', 경로: process.execPath });
  잣대.아이 = { exitCode: null, signalCode: 'SIGKILL', killed: false };
  check('★★ 신호로 죽은 서버를 살았다고 하지 않는다', 잣대.살았나() === false,
    `살았나() → ${잣대.살았나()}`);
  잣대.아이 = { exitCode: null, signalCode: null, killed: false };
  check('  정말 살아 있으면 살았다고 한다', 잣대.살았나() === true, `살았나() → ${잣대.살았나()}`);
  잣대.아이 = null;

  /*
   * ── 진단기다리기 가 **방금 온 지금 판** 진단을 지운다 ────────────────
   *
   * 기다리기 앞에서 그 파일의 진단을 통째로 지운다. 옛 판 것을 지금 판의 답으로 안
   * 내주려는 것인데, **판을 보지 않고** 지워서 이미 도착한 지금 판 답까지 버린다.
   * 그러면 「안 왔다」(=확인 못 했다)로 올라간다 — 서버는 제대로 답했는데도.
   * 옛 판 거르기는 #받음 의 `p.version < 지금판` 이 이미 하고 있다.
   */
  const 진단방 = mkdtempSync(join(tmpdir(), 'deel-lsp9-'));
  치울것.push(진단방);
  writeFileSync(join(진단방, 'a.ts'), 'export const x = 1;\n틀린것\n');
  {
    const s = new 언어서버(진단방, { cmd: process.execPath, args: [흉내], 이름: '흉내서버', 경로: process.execPath });
    await s.켜기();
    const uri = s.보여주기(join(진단방, 'a.ts'));        // didOpen 1판 → 서버가 바로 낸다
    // 그 진단이 도착할 틈을 준다. 여기까지 오면 표에는 **지금 판** 답이 들어 있다.
    for (let i = 0; i < 30 && !s.진단.size; i++) await new Promise((r) => setTimeout(r, 30));
    const 표에든것 = [...s.진단.values()][0] ?? null;
    check('  (먼저) 지금 판 진단이 표에 들어와 있다', Array.isArray(표에든것) && 표에든것.length === 1,
      JSON.stringify(표에든것));
    const 것들 = await s.진단기다리기(uri, 700);
    check('★★ 이미 와 있는 지금 판 진단을 지우고 「안 왔다」 고 하지 않는다',
      Array.isArray(것들) && 것들.length === 1, 것들 === null ? 'null — 지워 버렸다' : JSON.stringify(것들));
    await s.끄기();
  }

  /*
   * ── 끄기() 가 놀림 시계를 **다시 걸어 놓고** 끝난다 ──────────────────
   *
   * 맨 앞에서 시계를 끄는데, 그 뒤에 나가는 `exit` 알림이 알림() 을 거치면서
   * #놀림다시 를 불러 **다시 건다.** 껐는데 껐다 살아나는 시계다.
   *
   * ── 그리고 진단을 기다리던 셈을 안 접는다 ────────────────────────────
   *
   * #무너짐 은 `기다리는진단 = 0` 과 `#놓기()` 를 같이 하는데 끄기() 는 둘 다 안 한다.
   * 셈이 남아 있으면 #놓기 가 맨 앞에서 되돌아 나가서, 다음에 다시 켠 아이를 아무도
   * 놓아 주지 않는다 — 할 일이 없는데 프로그램이 안 끝나는 그 자리다.
   */
  {
    const s = new 언어서버(진단방, { cmd: process.execPath, args: [흉내, '--mute'], 이름: '흉내서버', 경로: process.execPath });
    await s.켜기();
    const 기다리기 = s.진단기다리기(pathToFileURL(join(진단방, 'a.ts')).href, 4000);
    for (let i = 0; i < 20 && !s.기다리는진단; i++) await new Promise((r) => setTimeout(r, 20));
    check('  (먼저) 진단을 기다리는 중이다', s.기다리는진단 === 1, String(s.기다리는진단));
    await s.끄기();
    check('★★ 끄고 나면 놀림 시계가 안 남는다', s.놀림시계 === null,
      s.놀림시계 === null ? '' : '껐는데 다시 걸려 있다');
    check('★★ 끄고 나면 진단 기다리는 셈도 접는다 (#무너짐 과 같이)',
      s.기다리는진단 === 0, String(s.기다리는진단));
    await 기다리기;
  }

  /*
   * ── servers.js 넷 ────────────────────────────────────────────────────
   */
  // `.c` 를 cpp 로 소개하면 서버가 C 파일에 C++ 규칙을 걸어 없는 오류를 만든다 —
  // 바로 이 함수 머리말이 `.js` 를 typescript 라고 소개하면 안 되는 까닭으로 적어 둔 그것이다.
  check('★★ main.c 는 c 로 소개한다 (cpp 가 아니다)', 언어아이디('main.c') === 'c', 언어아이디('main.c'));
  check('  .cpp · .cc · .hpp 는 그대로 cpp',
    언어아이디('a.cpp') === 'cpp' && 언어아이디('b.cc') === 'cpp' && 언어아이디('c.hpp') === 'cpp',
    [언어아이디('a.cpp'), 언어아이디('b.cc'), 언어아이디('c.hpp')].join(' · '));
  check('  갈래는 그대로다 — 서버는 c 도 cpp 도 clangd 하나다', 갈래('main.c') === 'cpp', String(갈래('main.c')));

  // 이름에 이미 PATHEXT 확장자가 붙어 있으면 윈도우는 **그 이름 그대로** PATH 를 훑는다.
  // 붙여 보는 쪽을 먼저 돌면, 뒤 폴더의 `tls.cmd.EXE` 가 앞 폴더의 진짜 `tls.cmd` 를 이긴다.
  {
    const 길방 = mkdtempSync(join(tmpdir(), 'deel-path9-'));
    치울것.push(길방);
    const A = join(길방, 'A');
    const B = join(길방, 'B');
    mkdirSync(A); mkdirSync(B);
    writeFileSync(join(A, 'tls.cmd'), '@echo off\n');
    writeFileSync(join(B, 'tls.cmd.EXE'), 'x');
    writeFileSync(join(B, 'tls2.CMD'), '@echo off\n');
    const env = { PATH: [A, B].join(process.platform === 'win32' ? ';' : ':'), PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    const 찾음 = 어디있나('tls.cmd', env);
    check('★★ 확장자가 이미 붙은 이름은 PATH 차례를 지킨다',
      찾음 === join(A, 'tls.cmd'), String(찾음));
    check('  확장자 없는 이름은 여태처럼 붙여 찾는다',
      process.platform === 'win32' ? 어디있나('tls2', env) === join(B, 'tls2.CMD') : true,
      String(어디있나('tls2', env)));
  }

  /*
   * ── PATHEXT 가 비어 있으면 **아무것도 못 찾았다** (사냥6 막판-뒷단) ─────
   *
   * 위 고침이 붙여 볼 목록 끝의 `''` 를 뺐다. 그런데 `??` 는 **빈 글을 안 막는다** —
   * `PATHEXT=` 로 비워 둔 판(또는 `;;` 만 든 판)에서는 그 목록이 통째로 비고, 그러면
   * 가장 안쪽 되풀이가 **한 번도 안 돌아** 무엇을 물어도 null 이다. `이미붙음` 도 빈
   * 목록에서는 거짓이라, 윈도우가 그대로 돌릴 수 있는 완전한 이름(`tls.cmd`)조차 못
   * 찾는다. 화면에는 언어 서버가 통째로 안 깔린 것으로 보인다 — 이 함수 머리말이
   * 제일 피하려던 「있는데 없다고 하는」 꼴의 반대쪽이다.
   *
   * 빈 PATHEXT 는 **안 적은 것과 같이** 본다. 안 적었을 때 쓰는 그 목록으로 간다.
   */
  {
    const 빈방 = mkdtempSync(join(tmpdir(), 'deel-path10-'));
    치울것.push(빈방);
    const C = join(빈방, 'C');
    mkdirSync(C);
    writeFileSync(join(C, 'tls3.cmd'), 'x');
    const 윈 = process.platform === 'win32';
    const 만들기 = (pathext) => ({ PATH: C, PATHEXT: pathext });
    for (const [이름표, pathext] of [['빈 글', ''], ['세미콜론만', ';;']]) {
      const env = 만들기(pathext);
      // 확장자 글자 크기는 PATHEXT 를 따른다(.CMD) — 찾은 파일이 그 파일이기만 하면 된다.
      const 같나 = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
      check(`★★★ PATHEXT 가 ${이름표}이어도 확장자 붙여 찾는다`,
        윈 ? 같나(어디있나('tls3', env), join(C, 'tls3.cmd')) : true, String(어디있나('tls3', env)));
      check(`★★★ PATHEXT 가 ${이름표}이어도 완전한 이름은 그대로 찾는다`,
        윈 ? 어디있나('tls3.cmd', env) === join(C, 'tls3.cmd') : true, String(어디있나('tls3.cmd', env)));
    }
  }

  // 훑기 한도가 **셀 것이 하나도 없는 파일**로 다 나가면, 코드가 가득한 폴더가
  // 「쓸 수 있는 언어 서버가 없습니다」 가 된다.
  {
    const 큰방 = mkdtempSync(join(tmpdir(), 'deel-walk9-'));
    치울것.push(큰방);
    mkdirSync(join(큰방, 'aaa_src'));
    for (let i = 0; i < 20; i++) writeFileSync(join(큰방, 'aaa_src', `코드${i}.ts`), 'export const x = 1;\n');
    mkdirSync(join(큰방, 'zzz_자료'));
    for (let i = 0; i < 4200; i++) writeFileSync(join(큰방, 'zzz_자료', `문서${i}.md`), '메모\n');
    셈지우기();
    서버박기('ts', { cmd: process.execPath, args: [흉내], 이름: '흉내서버', 경로: process.execPath });
    const 것 = await 프로젝트갈래(큰방);
    check('★★ 문서가 앞에 4천 개 있어도 코드 갈래를 찾아낸다',
      것?.갈래 === 'ts' && 것.개수 === 20, JSON.stringify(것));
    셈지우기();
  }

  // 주석은 「열쇠와 다른 것만 적어 둔다」 인데 표에는 같은 것도 다 들어 있다.
  // 그리고 **들어 있어야 한다** — 빠지면 go·java·php·lua 가 plaintext 로 소개된다.
  check('★ 열쇠와 같은 이름도 표에 있어야 한다 (빠지면 plaintext 가 된다)',
    언어아이디('a.go') === 'go' && 언어아이디('b.java') === 'java'
    && 언어아이디('c.php') === 'php' && 언어아이디('d.lua') === 'lua',
    [언어아이디('a.go'), 언어아이디('b.java'), 언어아이디('c.php'), 언어아이디('d.lua')].join(' · '));
}

서버박기('ts', null);
셈지우기();
await 모두끄기();
for (const p of [...치울것, root]) {
  const 됐나 = await 치우기(p);
  if (!됐나) 적어둘것.push(`임시 폴더를 못 지웠습니다: ${p}`);
}

// ── 마무리 ──────────────────────────────────────────────────────────────
const c = (n, s) => (process.stdout.isTTY || process.env.FORCE_COLOR ? `\x1b[${n}m${s}\x1b[0m` : s);
console.log('');
for (const f of fail) console.log(`  ${c(31, '✗')} ${f.name}${f.note ? c(90, `  ${f.note}`) : ''}`);
for (const 글 of 적어둘것) console.log(`  ${c(90, `· ${글}`)}`);
console.log('');
console.log(`  ${pass.length}개 통과 · ${fail.length}개 실패`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

void pathToFileURL;
void 고르기;
