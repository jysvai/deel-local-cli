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
import { allow as 모드허용 } from '../src/agent/modes.js';
import { makeScope } from '../src/safety/guard.js';
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

  const r = await runTool('Refs', { name: '셈하기' }, ctx);
  check('Refs: 쓰는 자리를 다 준다', r.found === 3, JSON.stringify(r).slice(0, 160));
  check('Refs: 파일별로 묶는다', r.files === 2, String(r.files));
  check('Refs: 몇 파일인지 먼저 말한다', /파일 2개/.test(r.summary ?? ''), r.summary);
  check('Refs: 줄 번호와 글이 같이 온다', /5: .*셈하기/.test(r.content ?? ''), r.content);

  // 파일·줄로 짚어 주는 길. 모델이 Grep 으로 좁혀 온 다음에 오는 자리다.
  const 짚은것 = await runTool('Refs', { name: '셈하기', file_path: 'src/쓰는곳.js', line: 5 }, ctx);
  check('Refs: 파일·줄로 짚어도 된다', 짚은것.found === 3, JSON.stringify(짚은것).slice(0, 120));

  // 이름이 그 줄에 없으면 없다고 해야 한다. 엉뚱한 자리를 짚으면 안 된다.
  const 엉뚱 = await runTool('Refs', { name: '셈하기', file_path: 'src/쓰는곳.js', line: 3 }, ctx);
  check('Refs: 그 줄에 없으면 없다고 한다', !!엉뚱.error && /못 찾/.test(엉뚱.error), JSON.stringify(엉뚱));

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

서버박기('ts', null);
셈지우기();
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
