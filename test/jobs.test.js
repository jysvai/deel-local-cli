/**
 * 뒤에서 도는 명령 (Bash 의 background · Jobs).
 *
 * 왜 이 검사가 따로 있나:
 *   Bash 는 명령이 **끝나야** 결과를 준다. 그래서 끝나지 않는 것 —
 *   `npm run dev`, `vite`, `python -m http.server` — 을 못 돌렸다. 전에는
 *   120초를 기다렸다가 시간 초과로 죽였고, 화면에는 `시간 초과로 중단됨`
 *   한 줄만 남았다. 만든 것을 **띄워서 확인하는 길이 아예 없었다.**
 *
 *   그래서 뒤에서 띄우고 Jobs 로 읽어 가게 했는데, 이 길에는 조용히 어긋날
 *   자리가 셋 있다. 여기서 재는 것이 그 셋이다.
 *
 * ── 여기서 재는 것 ────────────────────────────────────────────────────
 *
 * 1. 안 뜬 것을 떴다고 하지 않는가
 *      제일 흔한 실패가 '포트가 이미 물려 있음' 이다. 그걸 "띄웠습니다" 로
 *      넘기면 모델은 다음 단계로 가고, 사람은 뜨지도 않은 서버를 새로고침하며
 *      찾아다닌다. 띄운 직후 잠깐 지켜보고, 그 사이에 죽으면 실패로 못 박는다.
 *
 * 2. 띄운 것을 반드시 거두는가
 *      안 거두면 사람이 안 띄운 프로세스가 계속 돈다. 다음에 켜서 dev 서버를
 *      띄우면 "포트가 이미 쓰이는 중" 이 뜨는데, **무엇이 물고 있는지 알
 *      길이 없다.** 그래서 진짜로 죽었는지를 자국 파일로 확인한다.
 *
 * 3. 안전 검사의 뒷문이 되지 않는가
 *      background 는 Bash 의 인자 하나일 뿐이다. 여기가 checkCommand·
 *      checkPaths 를 건너뛰면 울타리에 문이 하나 열린 것과 같다.
 *
 * ── 검사 자체가 유령을 안 남기게 ──────────────────────────────────────
 *   여기서 띄우는 아이들은 스스로 안 끝난다. 검사가 죽어도 남지 않도록
 *   jobs.js 가 process exit 에 모두끝내기() 를 걸어 두었고, 여기서도
 *   단마다 비우기() 로 판을 치운다.
 *
 * ── 왜 자식 스크립트 이름이 영문인가 ──────────────────────────────────
 *   명령줄이 cmd.exe 를 거쳐 간다. 콘솔 코드페이지가 949 인 PC 에서 한글
 *   경로를 넘기면 그 자리에서 뭉개진다 — 이 프로젝트가 여기저기서 겪은
 *   그 문제다. 파일 이름만 영문으로 두고, 안에 적는 말은 한국어로 둔다.
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { TOOLS } from '../src/tools/index.js';
import {
  띄우기, 목록, 하나, 읽기, 끝내기, 모두끝내기, 비우기, 셸명령, 띄우기옵션, 최대일감, JOBS_TOOL,
} from '../src/tools/jobs.js';
import { 정한셸 } from '../src/tools/shell.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 쉬기 = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 될 때까지 기다린다. 안 되면 그냥 false 로 돌아온다.
 *
 * 파이프를 건너오는 데 걸리는 시간은 그 컴퓨터가 그때 얼마나 바쁜지에 달렸다.
 * 정해진 시간만 재고 넘어가면 검사가 열 번에 한 번씩 까닭 없이 빨개지는데,
 * **빨개졌다 말았다 하는 검사는 아무도 안 믿는다** — 진짜 고장이 나도 "또
 * 그거겠지" 하고 넘긴다. 그래서 시간이 아니라 일이 끝났는지를 본다.
 */
async function 될때까지(조건, 최대 = 5000) {
  const 끝 = Date.now() + 최대;
  for (;;) {
    if (조건()) return true;
    if (Date.now() > 끝) return false;
    await 쉬기(20);
  }
}

const 방 = mkdtempSync(join(tmpdir(), 'deel-jobs-'));
const 노드 = process.execPath;

// 자식 스크립트들. tmpdir 에는 package.json 이 없어 .js 가 CommonJS 로 읽히지만,
// 헷갈릴 자리를 안 만들려고 .cjs 로 못 박는다.
const 스크립트 = (이름, 글) => {
  const p = join(방, 이름);
  writeFileSync(p, 글, 'utf8');
  return p;
};

// 뜨자마자 한 줄 뱉고 계속 사는 아이. 살아 있는 동안 자국 파일을 늘려 적는다 —
// 정말로 죽었는지를 이 파일이 안 자라는 것으로 확인한다.
const 도는아이 = 스크립트('ticker.cjs', [
  "const fs = require('fs');",
  'const 자국 = process.argv[2];',
  "process.stdout.write('떴습니다 · 3000 포트를 듣습니다\\n');",
  'setInterval(() => { try { fs.appendFileSync(자국, "x"); } catch {} }, 60);',
].join('\n'));

// 뜨자마자 죽는 아이. 포트가 이미 물려 있는 경우를 흉내낸다.
const 죽는아이 = 스크립트('dies.cjs', [
  "process.stderr.write('EADDRINUSE: 3000 포트가 이미 쓰이는 중입니다\\n');",
  'process.exit(1);',
].join('\n'));

// 아무 말도 안 하고 사는 아이. 출력 다루기를 볼 때 쓴다 —
// 진짜 출력이 섞이면 무엇이 어디서 왔는지 못 가른다.
const 조용한아이 = 스크립트('quiet.cjs', 'setInterval(() => {}, 1000);\n');

// 뜨자마자 왕창 뱉고 계속 사는 아이. 죽일 때 그 말이 사라지지 않는지 볼 때 쓴다.
// 300KB 는 OS 파이프 버퍼보다 훨씬 커서, 죽이는 그 순간에도 아직 안 읽힌 것이 남아 있다.
const 왕창뱉는아이 = 스크립트('gusher.cjs', [
  "process.stdout.write('x'.repeat(300 * 1024));",
  "process.stdout.write('\\n[죽기 직전에 남긴 말]\\n');",
  'setInterval(() => {}, 1000);',
].join('\n'));

// 잠깐 살다 실패로 끝나는 아이. '떴다가 나중에 죽은 것' 을 본다.
const 늦게죽는아이 = 스크립트('late.cjs', 'setTimeout(() => process.exit(3), 400);\n');

// 명령줄 한 줄로 만든다. 노드 경로에 빈칸이 있는 게 보통이라(Program Files) 따옴표는 필수다.
const 부르기 = (스크립트경로, ...인자) =>
  [노드, 스크립트경로, ...인자].map((s) => `"${s}"`).join(' ');

trace('1-띄우고바로돌아온다');

// ── 1. 띄우고 바로 돌아온다 ─────────────────────────────────────────────
{
  const 자국 = join(방, 'tick1.txt');
  const 잰때 = Date.now();
  /*
   * 지켜보는 시간을 넉넉히 준다.
   *
   * 이건 기능이 정한 값이 아니라 이 검사가 고른 값이다. 윈도우는 node 가 뜨는
   * 데만 80ms 쯤 걸려서, 컴퓨터가 바쁠 때 250ms 로는 아이가 첫 줄을 쓰기도
   * 전에 시간이 끝난다. 그러면 고친 것도 없이 아래 한 줄이 가끔 빨개진다.
   * 아이는 끝나지 않는 명령이라 '안 기다린다' 는 검사는 그대로 성립한다.
   */
  const r = await 띄우기(부르기(도는아이, 자국), { cwd: 방, 기다림: 800 });
  const 걸림 = Date.now() - 잰때;

  check('띄우면 번호를 준다', r.떴나 === true && r.번호 === 1, JSON.stringify(r).slice(0, 120));
  // 끝나지 않는 명령이다. 끝나기를 기다렸다면 여기까지 오지도 못한다.
  check('끝나기를 안 기다린다', 걸림 < 3000, `${걸림}ms`);
  /*
   * 뜨자마자 나온 몇 줄을 같이 준다.
   *
   * 이게 없으면 모델은 "띄웠습니다" 만 받고 곧바로 Jobs 를 한 번 더 부른다 —
   * 로컬 모델에서 왕복 하나가 20~40초다. 대부분의 답은 그 첫 몇 줄에 있다.
   */
  check('뜨자마자 나온 말을 같이 준다', /3000 포트/.test(r.출력 ?? ''), (r.출력 ?? '').trim());

  const ls = 목록();
  check('목록에 도는중으로 보인다', ls.length === 1 && ls[0].상태 === '도는중', JSON.stringify(ls[0]));
  check('무슨 명령이었는지 남는다', /ticker\.cjs/.test(ls[0].명령), ls[0].명령);

  // 진짜로 돌고 있어야 한다. 자국이 늘어나는 것으로 본다.
  await 될때까지(() => existsSync(자국) && statSync(자국).size > 0);
  check('진짜로 돌고 있다', existsSync(자국) && statSync(자국).size > 0,
    existsSync(자국) ? `${statSync(자국).size}바이트` : '자국 없음');

  비우기();
}

trace('2-뜨자마자죽으면');

// ── 2. 뜨자마자 죽으면 실패로 못 박는다 ────────────────────────────────
//
// 여기가 이 기능에서 제일 값진 자리다. '떴다' 로 넘어가면 그 뒤가 전부 헛돈다.
{
  const r = await 띄우기(부르기(죽는아이), { cwd: 방, 기다림: 2000 });

  check('안 떴다고 말한다', r.떴나 === false, JSON.stringify(r).slice(0, 120));
  check('종료코드를 준다', r.종료코드 === 1, String(r.종료코드));
  check('죽으면서 남긴 말을 준다', /EADDRINUSE/.test(r.출력 ?? ''), (r.출력 ?? '').trim());
  // 죽은 것을 목록에 남기면 모델이 Jobs 로 그걸 또 들여다본다. 그 자리에 답이 없다.
  check('죽은 것은 목록에 안 남는다', 목록().length === 0, `${목록().length}개`);

  비우기();
}

trace('3-읽기');

// ── 3. 읽기 — 지난번 읽은 뒤로 새로 나온 것만 ───────────────────────────
//
// 매번 처음부터 주면 긴 로그가 턴마다 통째로 다시 실린다. 그러면 창이
// 서너 번 만에 찬다. 그래서 커서를 들고 새것만 준다.
//
// 여기서는 **아무 말도 안 하는 아이**를 띄우고 손으로 글을 담는다.
// 진짜 출력이 섞이면 타이밍에 따라 답이 달라져서 검사가 못 미더워진다.
{
  const r = await 띄우기(부르기(조용한아이), { cwd: 방, 기다림: 0 });
  const j = 하나(r.번호);
  check('띄운 것을 번호로 찾는다', !!j, String(r.번호));

  j.담기(Buffer.from('첫째 줄\n', 'utf8'));
  const a = 읽기(r.번호);
  check('처음 읽으면 그때까지 나온 것', a.글 === '첫째 줄\n', JSON.stringify(a.글));

  j.담기(Buffer.from('둘째 줄\n', 'utf8'));
  const b = 읽기(r.번호);
  check('다시 읽으면 새것만', b.글 === '둘째 줄\n', JSON.stringify(b.글));

  const c = 읽기(r.번호);
  check('새 출력이 없으면 빈 글', c.글 === '', JSON.stringify(c.글));
  // 빈 글도 사실이다. 도구 쪽에서 사람 말로 바꿔 준다.
  const d = await JOBS_TOOL.run({ 번호: r.번호 });
  check('빈 글을 사람 말로 바꿔 준다', /새 출력이 없습니다/.test(d.content), d.content.split('\n').pop());

  const e = 읽기(r.번호, { 처음부터: true });
  check('처음부터를 주면 통째로', e.글 === '첫째 줄\n둘째 줄\n', JSON.stringify(e.글));

  // 여러 바이트짜리 글자가 조각 경계에서 쪼개져도 안 깨져야 한다.
  // '가' 는 UTF-8 로 3바이트다. 조각마다 따로 풀면 여기서 물음표가 된다.
  const 글자 = Buffer.from('가나다', 'utf8');
  j.담기(글자.subarray(0, 2));
  j.담기(글자.subarray(2));
  const f = 읽기(r.번호);
  check('조각 경계에서 글자가 안 깨진다', f.글 === '가나다', JSON.stringify(f.글));

  check('없는 번호는 없다고 한다', 읽기(999) === null, String(읽기(999)));

  비우기();
}

trace('4-출력상한');

// ── 4. 출력 상한 — 앞을 버리고 뒤를 남긴다 ─────────────────────────────
//
// watch 하나가 몇 시간 돌면 출력이 몇 GB 가 된다. 상한을 안 두면 deel 이
// 그 메모리를 그대로 들고 있다. 버릴 때는 **앞**을 버린다 — 오래 도는
// 것에서 사람이 찾는 건 언제나 방금 나온 쪽이다.
{
  const r = await 띄우기(부르기(조용한아이), { cwd: 방, 기다림: 0 });
  const j = 하나(r.번호);

  j.담기(Buffer.from('아주 옛날 줄\n', 'utf8'));
  for (let i = 0; i < 40; i++) j.담기(Buffer.alloc(16 * 1024, 0x61));   // 640KB
  j.담기(Buffer.from('\n방금 나온 줄\n', 'utf8'));

  const a = 읽기(r.번호, { 처음부터: true });
  check('상한을 넘으면 앞을 버린다', !/아주 옛날 줄/.test(a.글), `${a.글.length}자`);
  check('방금 것은 남긴다', /방금 나온 줄/.test(a.글), a.글.slice(-20));
  check('잘렸다는 사실을 숨기지 않는다', a.앞잘림 === true, String(a.앞잘림));
  /*
   * 잘렸으면 커서를 0 으로 돌린다.
   *
   * 앞이 사라졌으니 '이미 읽은 글자 수' 가 가리키던 자리가 더는 같은 자리가
   * 아니다. 그걸 그대로 쓰면 조용히 어긋난 토막을 주게 된다 — 겹쳐 보이는
   * 편이 낫다. 도구 쪽에서 앞이 잘렸다고 적어 주므로 모델도 안다.
   */
  const b = await JOBS_TOOL.run({ 번호: r.번호, 처음부터: true });
  check('앞이 잘렸다고 적어 준다', /앞부분은 너무 길어 잘렸습니다/.test(b.content), b.content.slice(0, 60));

  /*
   * 한 번 잘렸다고 **영원히** 잘렸다고 말하면 안 된다.
   *
   * '앞이 잘렸다' 는 지금 건네는 이 토막에 대한 말이다. 한 번 넘친 뒤로 새로
   * 나온 몇 줄은 멀쩡한데, 거기에도 그 말이 붙으면 모델은 자기가 받은 글에
   * 앞이 빠졌다고 믿는다. 그럼 처음부터 다시 읽으러 간다 — 로컬 모델에서
   * 왕복 하나가 20~40초고, 그렇게 받은 것도 똑같이 '잘렸다' 고 적혀 온다.
   * 맴돌기 딱 좋은 자리다.
   */
  /*
   * 판을 새로 깐다.
   *
   * 위 판은 상한에 바짝 붙어 있다 — 몇 줄만 더 넣어도 **진짜로** 또 넘친다.
   * 그러면 '다시 잘렸다' 가 맞는 말이 되어, 이 아래에서 무엇을 재는지가
   * 흐려진다. 여기서는 앞엣것 하나만 버려지게 해서 남는 자리를 넉넉히 둔다.
   */
  const r2 = await 띄우기(부르기(조용한아이), { cwd: 방, 기다림: 0 });
  const j2 = 하나(r2.번호);
  j2.담기(Buffer.alloc(200 * 1024, 0x61));           // 곧 버려질 앞엣것
  j2.담기(Buffer.from('[살아남는 줄]\n', 'utf8'));
  j2.담기(Buffer.alloc(100 * 1024, 0x62));           // 이걸 넣는 순간 앞엣것이 버려진다

  const c = 읽기(r2.번호);
  check('준비: 앞엣것만 버려지고 자리가 남았다', c.앞잘림 === true && /^\[살아남는 줄\]/.test(c.글),
    `${c.앞잘림} · ${c.글.slice(0, 12)}`);

  j2.담기(Buffer.from('서버가 다시 떴습니다\n', 'utf8'));
  const d = 읽기(r2.번호);
  check('그 뒤에 나온 새 출력은 온전하다', d.글 === '서버가 다시 떴습니다\n', JSON.stringify(d.글));
  check('온전한 새 출력에 잘렸다고 안 한다', d.앞잘림 === false, String(d.앞잘림));

  j2.담기(Buffer.from('두 번째 줄\n', 'utf8'));
  const e = await JOBS_TOOL.run({ 번호: r2.번호 });
  check('사람·모델이 보는 글에도 안 붙는다', !/앞부분은 너무 길어 잘렸습니다/.test(e.content),
    e.content.split('\n').slice(2).join(' / '));

  /*
   * 그렇다고 아예 끄면 그것도 거짓이다. 통째로 달라고 하면 **이 일감은 앞을
   * 버린 적이 있다** 가 여전히 사실이라, 그때는 말해 줘야 한다.
   * 지금 주는 글이 처음부터가 아니라는 뜻이니까.
   */
  const f = 읽기(r2.번호, { 처음부터: true });
  check('통째로 읽을 때는 여전히 잘렸다고 말한다', f.앞잘림 === true, String(f.앞잘림));

  // 다시 넘치면 다시 말한다. 한 번 내리고 안 올라가면 그때부터 진짜 잘린 것을 놓친다.
  j2.담기(Buffer.alloc(200 * 1024, 0x63));
  const g = 읽기(r2.번호);
  check('다시 잘리면 다시 말한다', g.앞잘림 === true, String(g.앞잘림));
  const h = 읽기(r2.번호);
  check('그 다음 읽기에서는 또 안 말한다', h.앞잘림 === false, String(h.앞잘림));

  /*
   * 모델에게 넘길 때는 **또 한 번 줄인다.**
   *
   * 여기 쌓아 두는 상한(256KB)은 '들고 있을 양' 이지 '한 번에 건넬 양' 이
   * 아니다. 그 둘을 같은 값으로 두면 watch 하나가 넘칠 때마다 한 번의 Jobs
   * 읽기가 256KB 를 창에 쏟는다 — 8k 모델이면 그 한 번으로 창이 끝난다.
   *
   * 게다가 넘친 직후에는 커서가 0 으로 돌아가 있어서(담기 참고) '새것만'
   * 달라고 해도 통째로 온다. 그러니 이 자리가 반드시 막혀 있어야 한다.
   * Bash 의 background 쪽은 이미 4,000자로 줄이고 있었는데 여기만 뚫려 있었다.
   */
  const 큰것 = await JOBS_TOOL.run({ 번호: r2.번호, 처음부터: true });
  check('한 번 읽기로 창을 날리지 않는다', 큰것.content.length < 8000, `${큰것.content.length}자`);
  check('줄일 때는 뒤를 남긴다', /두 번째 줄|c{50}/.test(큰것.content), 큰것.content.slice(-40));
  check('줄였다는 사실을 적는다', /줄였습니다|잘렸습니다/.test(큰것.content), 큰것.content.slice(0, 80));

  비우기();
}

trace('5-끝내기');

// ── 5. 끝내기 — 진짜로 죽는가 ──────────────────────────────────────────
//
// 목록에서 지우는 것과 프로세스가 죽는 것은 다르다. 여기서 어긋나면
// 사람 눈에 안 보이는 프로세스가 포트를 물고 남는다 — 원인을 못 찾는 종류다.
{
  const 자국 = join(방, 'tick5.txt');
  const r = await 띄우기(부르기(도는아이, 자국), { cwd: 방, 기다림: 250 });
  check('준비: 떴다', r.떴나 === true, JSON.stringify(r).slice(0, 80));

  const k = await 끝내기(r.번호);
  check('끝냈다고 말해 준다', k && k.이미 === false, JSON.stringify(k).slice(0, 80));
  check('몇 초 돌았는지 적는다', typeof k.초 === 'number', String(k.초));
  check('목록에서 빠진다', 목록().length === 0, `${목록().length}개`);

  /*
   * 자국이 안 자라야 진짜 멈춘 것이다.
   *
   * 윈도우에서는 taskkill 이 자식 나무를 훑는 데 잠깐 걸린다. 그 시간을
   * 밀리초로 못박아 두면, 컴퓨터가 바쁠 때 아직 훑는 중인 것을 '안 멈췄다' 로
   * 읽는다. 그래서 **두 번 잰 것이 같아질 때까지** 다시 잰다. 정말로 안
   * 죽었으면 파일은 계속 자라므로 몇 번을 재도 같아지지 않는다 — 그때 빨개진다.
   */
  let 멈췄나 = false;
  let 잰것 = 0;
  let 다시 = 0;
  // 스무 번(≈12초)까지 본다. 멈추면 그 자리에서 빠져나오므로 평소에는 한 번이다.
  // 윈도우의 taskkill 도 프로세스라, 컴퓨터가 아주 바쁘면 그놈이 도는 데만 몇 초 걸린다.
  for (let i = 0; i < 20 && !멈췄나; i++) {
    await 쉬기(300);
    잰것 = existsSync(자국) ? statSync(자국).size : 0;
    await 쉬기(300);
    다시 = existsSync(자국) ? statSync(자국).size : 0;
    멈췄나 = 잰것 === 다시;
  }
  check('프로세스가 진짜 멈춘다', 멈췄나, `${잰것}바이트 → ${다시}바이트`);

  check('없는 번호를 끝내면 없다고 한다', (await 끝내기(999)) === null, String(await 끝내기(999)));
  const 없음 = await JOBS_TOOL.run({ 번호: 999, 끝내기: true });
  check('도구는 목록을 보라고 알려 준다', /목록을 보세요/.test(없음.error ?? ''), 없음.error ?? '');

  /*
   * 번호 없이 "끝내라" 고 하면 **목록으로 얼버무리면 안 된다.**
   *
   * 목록을 돌려주면 그것은 성공한 답으로 보인다. 모델은 정리한 줄 알고
   * "서버를 껐습니다" 라고 말하는데 서버는 그대로 돌고 있다. 도구가
   * 시킨 일을 안 했으면 안 했다고 말해야 그 다음이 이어진다.
   */
  const 번호없이 = await JOBS_TOOL.run({ 끝내기: true });
  check('번호 없이 끝내라고 하면 목록으로 얼버무리지 않는다', !!번호없이.error,
    번호없이.error ?? `(목록을 돌려줬다: ${번호없이.content})`);

  // 숫자가 아닌 번호. 그냥 두면 `NaN번 일감이 없습니다` 라는 말이 나간다.
  const 엉뚱 = await JOBS_TOOL.run({ 번호: '첫번째' });
  check('번호가 숫자가 아니면 그렇게 말한다', /숫자/.test(엉뚱.error ?? ''), 엉뚱.error ?? '');

  비우기();
}

trace('5-2-죽는말');

// ── 5-2. 죽는 순간 뱉은 말이 사라지지 않는가 ───────────────────────────
//
// 죽이라고 말한 그 순간, 파이프에는 아직 안 읽힌 것이 남아 있다. 곧장 파이프를
// 끊으면 그게 통째로 사라진다 — 그런데 **죽기 직전에 나온 몇 줄이 대개 제일
// 중요하다.** 서버가 뻗으면서 남긴 스택 트레이스가 거기 있다.
//
// 그래서 죽인 뒤 잠깐 기다렸다가 거둔다. 무한정 기다리지는 않는다 —
// 안 죽는 놈 하나가 그 턴을 통째로 잡아먹으면 안 된다.
// 여기서 재는 것은 **약속**이지 경합이 아니다.
//
// 파이프 안에서 몇 밀리초 사이에 벌어지는 일을 검사로 잡으려 해 봤는데,
// 잡히지 않았다 — 아이가 첫 글자를 쓰기도 전에 죽어서, 고친 쪽이나 안 고친
// 쪽이나 똑같이 빈손이 나온다. 못 재는 것을 재는 척하면 그 검사는 나중에
// 아무나 지워도 되는 것이 된다. 그래서 확정적으로 잴 수 있는 둘만 못 박는다.
//
//   1. 죽일 때까지 나온 말을 **빠짐없이** 준다
//   2. 끝내기가 돌아왔으면 프로세스는 **이미 죽어 있다**
//
// 2번이 이 고침의 알맹이다. 전에는 죽이라고 말만 하고 곧장 돌아왔다 —
// 그러고 목록에서 지웠으니, 안 죽은 놈이 있어도 다시는 가리킬 수 없었다.
{
  const r = await 띄우기(부르기(왕창뱉는아이), { cwd: 방, 기다림: 0 });
  check('준비: 떴다', r.떴나 === true, JSON.stringify(r).slice(0, 60));
  const kid = 하나(r.번호)?.kid;

  /*
   * 아이가 실컷 뱉을 때까지 기다린다. 띄우기 는 기다림 0 이라 아무것도 안 읽어 갔다.
   *
   * 여기서 `쉬기(300)` 으로 시간을 재고 넘어가면 안 된다. 300KB 가 파이프를
   * 건너오는 데 걸리는 시간은 그때 컴퓨터가 얼마나 바쁜지에 달렸고, 검사를
   * 여럿 한꺼번에 돌리면 300ms 로 모자랄 때가 있다. 그러면 **고친 것도 없이**
   * 이 줄만 가끔 빨개진다.
   */
  const 건너왔나 = await 될때까지(() => /\[죽기 직전에 남긴 말\]/.test(하나(r.번호)?.전체글() ?? ''));
  check('준비: 아이가 뱉은 것이 파이프를 건너왔다', 건너왔나,
    `${(하나(r.번호)?.전체글() ?? '').length}자`);

  const k = await 끝내기(r.번호);
  check('죽일 때까지 나온 말을 준다', /\[죽기 직전에 남긴 말\]/.test(k?.남은 ?? ''),
    `${(k?.남은 ?? '').length}자 · 끝: ${JSON.stringify((k?.남은 ?? '').slice(-24))}`);
  check('끝내기가 돌아왔으면 이미 죽어 있다', kid?.exitCode != null || kid?.signalCode != null,
    `종료코드 ${kid?.exitCode} · 시그널 ${kid?.signalCode}`);
  check('목록에서는 빠진다', 목록().length === 0, `${목록().length}개`);

  비우기();
}

trace('6-이미끝난것');

// ── 6. 저 혼자 끝난 것 ─────────────────────────────────────────────────
//
// 떴다가 나중에 죽는 경우다 (설정이 틀려서, 파일을 못 찾아서). 이때
// 종료코드가 0 이 아니면 **실패로 물들여야** 한다. Bash 와 같은 규칙이다.
{
  const r = await 띄우기(부르기(늦게죽는아이), { cwd: 방, 기다림: 60 });
  check('준비: 일단 떴다', r.떴나 === true, JSON.stringify(r).slice(0, 80));

  await 될때까지(() => 목록()[0]?.상태 === '끝남');
  const ls = 목록();
  check('끝났다고 표시된다', ls[0]?.상태 === '끝남', JSON.stringify(ls[0]));
  check('종료코드가 남는다', ls[0]?.종료코드 === 3, String(ls[0]?.종료코드));

  const t = await JOBS_TOOL.run({ 번호: r.번호 });
  check('종료코드 0 이 아니면 실패로 물들인다', t.failed === true, String(t.failed));
  check('무슨 일이 있었는지 한 줄로', /종료코드 3/.test(t.summary + t.content), t.summary);

  // 이미 끝난 것을 끝내라고 하면 나무라지 않는다. 치우고 사실만 말한다.
  const k = await JOBS_TOOL.run({ 번호: r.번호, 끝내기: true });
  check('이미 끝난 것은 이미 끝났다고만 한다', /이미 끝나 있었습니다/.test(k.content ?? ''), k.content ?? k.error);

  비우기();
}

trace('7-몇개까지');

// ── 7. 한꺼번에 몇 개까지 ──────────────────────────────────────────────
//
// 상한이 없으면 모델이 같은 서버를 여덟 번 띄워 놓고도 모른다.
// 사람이 못 따라가는 수가 되면 그때부터는 안 띄우느니만 못하다.
{
  const 띄운것 = [];
  for (let i = 0; i < 최대일감; i++) {
    띄운것.push(await 띄우기(부르기(조용한아이), { cwd: 방, 기다림: 0 }));
  }
  check(`${최대일감}개까지는 뜬다`, 띄운것.every((x) => x.떴나), 띄운것.map((x) => x.떴나).join(','));

  const 더 = await 띄우기(부르기(조용한아이), { cwd: 방, 기다림: 0 });
  check('넘으면 거절한다', !!더.error, JSON.stringify(더).slice(0, 80));
  // 거절만 하면 모델은 같은 것을 또 부른다. 무엇을 하라고 알려 준다.
  check('무엇을 하라고 알려 준다', /Jobs 로 안 쓰는 것을 끝내고/.test(더.error ?? ''), 더.error ?? '');

  const 껐다 = 모두끝내기();
  check('모두끝내기가 몇 개를 껐는지 돌려준다', 껐다 === 최대일감, `${껐다}개`);
  check('다 끄면 목록이 빈다', 목록().length === 0, `${목록().length}개`);

  비우기();
}

trace('7-2-끝난것치우기');

// ── 7-2. 끝난 일감이 쌓이지 않는가 ─────────────────────────────────────
//
// 끝난 일감을 바로 지우면 안 된다 — 마지막 출력을 읽으라고 남겨 두는 것이다.
// 그런데 안 지우면 짧은 명령 서른 개에 항목 서른 개가 쌓이고, 하나가 최대
// 256KB 를 들고 있으니 몇 MB 가 된다. 목록을 볼 때마다 그걸 전부 다시 푼다.
//
// 그래서 최근 것만 남기고 오래된 것부터 버린다. **버렸으면 버렸다고 적는다** —
// 안 적으면 모델은 목록에 보이는 것이 전부인 줄 안다.
{
  /*
   * **하나씩** 띄우고 끝나기를 기다린다.
   *
   * 한꺼번에 열둘을 띄우면 최대일감(8)에 걸려 넷이 거절당한다 — 그 상한은
   * '도는 것' 만 세기 때문이다. 여기서 보려는 것은 **끝난 것**이 쌓이는
   * 자리라, 도는 것은 언제나 하나뿐이어야 한다.
   *
   * 뜨자마자 죽는 아이는 못 쓴다. 그건 띄우기() 가 그 자리에서 실패로
   * 돌려주고 목록에서 빼기 때문이다(2번 단 참고). 그래서 잠깐 살다 끝나게 한다.
   */
  const 번호들 = [];
  for (let i = 0; i < 12; i++) {
    const 아이 = 스크립트(`late${i}.cjs`, `setTimeout(() => process.exit(0), 60);\n`);
    const r = await 띄우기(부르기(아이), { cwd: 방, 기다림: 0 });
    if (r.떴나) 번호들.push(r.번호);
    // 제 발로 끝날 때까지. 밀리초로 재고 넘어가면 아직 도는 것이 쌓여
    // 최대일감(8)에 걸리고, 그러면 열둘 중 몇은 아예 못 뜬다.
    await 될때까지(() => 목록().every((j) => j.상태 !== '도는중'));
  }
  check('준비: 12개가 떴다 (상한은 도는 것만 센다)', 번호들.length === 12, `${번호들.length}개`);
  /*
   * 마지막 하나가 끝나기를 기다린다.
   *
   * 치우기는 'close' 에서 돈다. 아직 도는 것이 있으면 그놈은 안 치워지고
   * 목록에도 그대로 나와서, 셈이 하나 어긋난 것처럼 보인다.
   *
   * 여기도 시간을 재고 넘어가면 안 된다. 윈도우는 node 기동만 80ms 쯤이라
   * 검사 여럿이 같이 돌면 500ms 로 모자랄 때가 있고, 그러면 **고친 것도 없이**
   * 아래 세 줄이 한꺼번에 빨개진다. 끝났는지를 보고 넘어간다.
   */
  const 다끝났나 = await 될때까지(() => 목록().every((j) => j.상태 !== '도는중'));
  check('준비: 다 끝났다', 다끝났나,
    목록().map((j) => `${j.번호}:${j.상태}`).join(' '));

  const ls = 목록();
  check('끝난 것이 무한정 쌓이지 않는다', ls.length <= 8, `${ls.length}개`);
  // 남는 것은 최근 여덟이다. 오래된 것부터 버려야 방금 띄운 것을 못 읽는 일이 없다.
  check('남는 것은 최근 쪽이다',
    JSON.stringify(ls.map((j) => j.번호).sort((a, b) => a - b)) === JSON.stringify(번호들.slice(-8)),
    `${ls.map((j) => j.번호).join(',')} · 띄운 것 ${번호들.join(',')}`);

  const t = await JOBS_TOOL.run({});
  check('치웠다는 사실을 적는다', /지웠습니다/.test(t.content ?? ''), (t.content ?? '').split('\n').pop());

  비우기();
}

trace('8-Bash와붙였을때');

// ── 8. Bash 와 붙였을 때 ───────────────────────────────────────────────
{
  const ctx = {
    scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set(),
  };
  ctx.history.nextTurn();

  /*
   * 여기서만 짧은 이름으로 부른다.
   *
   * Bash 를 거치면 checkPaths 가 명령줄에 적힌 경로를 전부 훑는다.
   * `C:\Program Files\nodejs\node.exe` 는 작업 범위 밖이라 그 자리에서 막힌다 —
   * 그게 맞는 동작이다. 그래서 울타리 안 상대경로로 부른다.
   */
  const 안에서 = (이름, ...인자) => ['node', 이름, ...인자].join(' ');

  const r = await TOOLS.Bash.run({ command: 안에서('ticker.cjs', 'tick8.txt'), background: true }, ctx);
  check('background 면 일감 번호를 준다', typeof r.일감번호 === 'number', JSON.stringify(r).slice(0, 100));
  check('뒤에서 돈다고 표시한다', r.뒤에서 === true, String(r.뒤에서));
  check('막히지 않았다', !r.error, String(r.error));
  /*
   * 다음에 무엇을 해야 하는지를 결과 안에 적는다.
   *
   * 작은 모델은 도구 설명을 한 번 읽고 잊는다. 띄운 그 자리에서 번호와 함께
   * 다시 적어 주면 Jobs 를 제대로 부른다 — 안 적으면 번호 없이 부르거나
   * 아예 안 부르고 "띄웠습니다" 로 끝낸다.
   */
  check('읽는 법을 번호와 함께 적어 준다', /Jobs\(\{job: \d+\}\)/.test(r.content), r.content.split('\n').pop());
  check('끝내는 법도 적어 준다', /stop: true/.test(r.content), '');
  // 시키는 이름이 설명서에 실린 이름과 같아야 한다. 별칭으로 시키면
  // 엄격한 게이트웨이가 그 호출을 튕긴다 (test/toolargs.test.js).
  check('설명서에 없는 옛 이름으로 시키지 않는다', !/번호:|끝내기:/.test(r.content), r.content.split('\n').pop());

  // 안 끝나는 명령을 그냥 부르면 어떻게 되나 — 짧은 제한 시간으로 확인한다.
  // 자국 이름도 짧게 준다 — 위 안에서() 머리말과 같은 까닭이다. cwd 가 방이라
  // 상대이름이 그대로 방 안에 떨어진다.
  const 시간초과자국 = join(방, 'tick-timeout.txt');
  const 느린것 = await TOOLS.Bash.run({ command: 안에서('ticker.cjs', 'tick-timeout.txt'), timeout: 700 }, ctx);
  check('background 없이 부르면 예전처럼 기다리다 끊는다',
    /시간 초과/.test((느린것.error ?? '') + (느린것.content ?? '')),
    (느린것.error ?? 느린것.content ?? '').slice(0, 60));

  /*
   * ★ 「중단됨」 이라고 말했으면 진짜 멈춰야 한다.
   *
   * execFile 의 timeout 은 바로 아래 자식(윈도우면 cmd.exe)만 죽인다. 손자는
   * 안 건드린다. 그래서 여기까지는 예전에도 초록이었다 — **말은 맞았기
   * 때문이다.** 정작 프로세스는 그대로 돌면서 포트를 물고 있었다.
   *
   *   Bash(npm run dev)  → 시간 초과로 중단됨 (120000ms)
   *   실제로는           → 서버가 살아서 3000 포트를 물고 있다
   *
   * 무엇이 물고 있는지 알 길이 없는, 이 기능이 없애려던 바로 그 상태다.
   * 자국 파일이 안 자라는 것으로 「진짜 멈췄나」 를 잰다 — 위 5절과 같은 방식.
   */
  let 시간초과멈췄나 = false;
  let 잰1 = 0;
  let 잰2 = 0;
  for (let i = 0; i < 20 && !시간초과멈췄나; i++) {
    await 쉬기(300);
    잰1 = existsSync(시간초과자국) ? statSync(시간초과자국).size : 0;
    await 쉬기(300);
    잰2 = existsSync(시간초과자국) ? statSync(시간초과자국).size : 0;
    시간초과멈췄나 = 잰1 === 잰2;
  }
  check('★ 시간 초과여도 진짜 멈춘다', 시간초과멈췄나, `${잰1}바이트 → ${잰2}바이트`);

  모두끝내기();

  /*
   * 뒷문이 아니다.
   *
   * background 는 Bash 의 인자 하나일 뿐이라, 여기가 checkCommand 앞으로
   * 새어 나가면 울타리에 문이 하나 열린 것과 같다. 막히는 명령은 background
   * 로도 똑같이 막혀야 하고, **일감이 생기지도 않아야** 한다.
   */
  const 막힘1 = await TOOLS.Bash.run({ command: 'shutdown /s /t 0', background: true }, ctx);
  check('막히는 명령은 background 로도 막힌다', /막힘/.test(막힘1.error ?? ''), 막힘1.error ?? '');
  check('막힌 것은 일감이 안 생긴다', 목록().length === 0, `${목록().length}개`);

  /*
   * 범위 밖 경로는 **그 판의 말**로 적어야 한다.
   *
   * `..\..\비밀.txt` 는 윈도우에서만 밖으로 나가는 길이다. 리눅스·맥에서
   * 역슬래시는 구분자가 아니라 그냥 글자라, 저건 「..\..\비밀.txt」 라는
   * 이름의 파일 하나이고 범위 안이다 — 안 막히는 것이 맞다.
   * 그래서 검사가 리눅스에서만 졌다(GitHub Actions 의 ubuntu 세 판 전부).
   * 막는 쪽(safety/guard.js)은 path.sep 을 쓰므로 원래부터 옳았다.
   */
  const 밖으로 = process.platform === 'win32' ? 'type ..\\..\\비밀.txt' : 'cat ../../비밀.txt';
  const 막힘2 = await TOOLS.Bash.run({ command: 밖으로, background: true }, ctx);
  check('범위 밖 경로도 background 로 못 나간다', /막힘/.test(막힘2.error ?? ''), 막힘2.error ?? '');
  check('그것도 일감이 안 생긴다', 목록().length === 0, `${목록().length}개`);

  비우기();
}

trace('9-도구모양');

// ── 9. 도구 모양 ───────────────────────────────────────────────────────
//
// 도구 정의는 **매 요청마다** 통째로 나간다. 8k 창에서는 스키마 하나가
// 곧 대화 자리다. Jobs 는 하는 일이 작은 만큼 스키마도 작아야 한다.
{
  const 빈것 = await JOBS_TOOL.run({});
  check('아무것도 없으면 없다고 말한다', /없습니다/.test(빈것.content), 빈것.content);

  const s = JOBS_TOOL.schema;
  check('이름은 Jobs', s.name === 'Jobs', s.name);
  check('필수 인자가 없다 (번호 없이 = 목록)', (s.parameters.required ?? []).length === 0,
    JSON.stringify(s.parameters.required));
  check('인자는 셋뿐', Object.keys(s.parameters.properties).length === 3,
    Object.keys(s.parameters.properties).join(','));
  check('스키마가 작다', JSON.stringify(s).length < 700, `${JSON.stringify(s).length}자`);
  // 서버를 띄워 놓고 안 끄는 것이 제일 흔한 사고다. 설명에 못 박아 둔다.
  // 인자 이름 그대로 적혀 있어야 한다. 예전엔 '끝내기' 였는데, 그 이름이
  // 한글이라 서버가 설명서를 통째로 튕겼다 (test/toolargs.test.js).
  // 이름을 바꿀 때 설명글도 같이 안 고치면, 모델은 없는 인자를 채운다.
  check('정리하라는 말이 설명에 있다', /끝날 때 반드시 stop/.test(s.description), s.description.slice(-40));

  const 목록결과 = await 띄우기(부르기(조용한아이), { cwd: 방, 기다림: 0 });
  const ls = await JOBS_TOOL.run({});
  check('목록에 번호와 명령이 같이 보인다',
    new RegExp(`${목록결과.번호}\\. `).test(ls.content) && /quiet\.cjs/.test(ls.content),
    ls.content);

  비우기();
}

trace('9-2-영문이름도받는다');

// ── 9-2. 인자 이름을 영어로 보내도 알아듣는가 ──────────────────────────
//
// 모델은 한글 인자 이름을 자주 영어로 바꿔 보낸다. 추정이 아니라 이 저장소가
// 겪은 일이다 — Task 는 이미 `목적 ?? purpose`, `할일 ?? task`, `모드 ?? mode`
// 로 둘 다 받고 있다 (agent/loop.js). 누군가 겪고 달아 둔 것이다.
//
// Jobs 에는 그게 없어서 이렇게 됐다.
//
//   Jobs({job: 1})              → 1번 출력이 아니라 **목록**이 돌아온다
//   Jobs({job: 1, stop: true})  → **목록**이 돌아온다. 서버는 그대로 돈다
//
// 두 번째가 나쁘다. 모델은 끄라고 시켰고 **성공처럼 보이는 답**을 받았는데
// 서버는 계속 포트를 문다. 번호 없이 끝내기만 준 경우는 오류로 막아 뒀지만,
// 영문 이름으로 오면 끝내기도 undefined 라 그 그물을 그냥 지나간다.
//
// 이름을 영문으로 **바꾸는** 것으로는 안 된다. 그러면 이번엔 한글로 보내는
// 쪽이 같은 구멍에 빠지고, id·number 처럼 안 맞춘 이름은 여전히 샌다.
// 둘 다 받고, **못 알아들은 것은 못 알아들었다고 말한다.**
{
  const r = await 띄우기(부르기(조용한아이), { cwd: 방, 기다림: 0 });
  const j = 하나(r.번호);
  j.담기(Buffer.from('영문 이름으로 읽은 줄\n', 'utf8'));

  const a = await JOBS_TOOL.run({ job: r.번호 });
  check('job 으로 보내도 그 일감을 읽는다', /영문 이름으로 읽은 줄/.test(a.content ?? ''),
    (a.content ?? '').split('\n').pop());
  check('목록으로 얼버무리지 않는다', !/^\s+\d+\. /.test(a.content ?? ''), (a.content ?? '').split('\n')[0]);

  j.담기(Buffer.from('그 뒤에 나온 줄\n', 'utf8'));
  const b = await JOBS_TOOL.run({ job: r.번호, from_start: true });
  check('from_start 도 알아듣는다', /영문 이름으로 읽은 줄/.test(b.content ?? '') && /그 뒤에 나온 줄/.test(b.content ?? ''),
    (b.content ?? '').split('\n').length + '줄');

  // 여기가 제일 값진 자리다. 안 끄고 성공처럼 답하면 사람이 원인을 못 찾는다.
  const c = await JOBS_TOOL.run({ job: r.번호, stop: true });
  check('stop 으로 보내면 진짜로 끝낸다', /끝냈습니다/.test(c.content ?? ''), c.content ?? c.error);
  check('정말 목록에서 빠졌다', 목록().length === 0, `${목록().length}개`);

  /*
   * 아예 모르는 이름만 왔을 때.
   *
   * 목록을 돌려주면 그것도 성공한 답으로 보인다. 무엇을 받는지 알려 줘야
   * 모델이 다음 걸음에서 고쳐 부른다.
   */
  const d = await JOBS_TOOL.run({ 일감번호: 1, 죽여: true });
  check('모르는 인자만 오면 오류로 말한다', !!d.error, d.error ?? `(목록을 줬다: ${d.content})`);
  check('무엇을 받는지 알려 준다', /번호|job/.test(d.error ?? ''), d.error ?? '');
  check('무엇이 모르는 것이었는지 적는다', /일감번호/.test(d.error ?? ''), d.error ?? '');

  // 인자 없이 부르는 것은 여전히 '목록 보기' 다. 이걸 오류로 만들면 안 된다.
  const e = await JOBS_TOOL.run({});
  check('인자가 아예 없으면 여전히 목록', !e.error, e.error ?? e.content);

  비우기();
}

trace('10-셸명령');

// ── 10. 셸에 넘기는 방법이 Bash 와 같은가 ──────────────────────────────
//
// 윈도우에서 여기가 조용히 틀리면 따옴표가 든 명령이 통째로 뭉개진다 —
// 출력도 오류도 없이 **종료코드 0** 이다. 두 벌로 두면 한쪽만 고쳐진다.
{
  const s = 셸명령('echo 안녕');
  const 고른 = 정한셸();   // 윈도우라도 Git Bash 가 있으면 bash 다 (tools/shell.js) — shell.test.js 가 고르기를 잰다
  if (고른.id === 'cmd') {
    check('윈도우 cmd 는 /d /s /c 로 넘긴다', s.args.slice(0, 3).join(' ') === '/d /s /c', s.args.join(' '));
    check('통째로 따옴표를 씌운다', s.args[3] === '"echo 안녕"', s.args[3]);
    check('그대로 넘긴다고 표시한다', s.verbatim === true, String(s.verbatim));
  } else if (고른.id === 'bash') {
    check('Git Bash 는 bash -c 로 넘긴다', /bash\.exe$/i.test(s.file) && s.args[0] === '-c' && s.args[1] === 'echo 안녕', `${s.file} ${s.args.join(' ')}`);
    check('그대로 넘기기를 안 켠다 (bash 는 \\" 를 안다)', s.verbatim === false, String(s.verbatim));
  } else {
    check('유닉스는 sh -c 로 넘긴다', s.file === '/bin/sh' && s.args[0] === '-c', `${s.file} ${s.args[0]}`);
    check('그대로 넘기기를 안 켠다', s.verbatim === false, String(s.verbatim));
  }

  /*
   * 손자까지 죽일 수 있게 띄우는가.
   *
   * 윈도우는 `taskkill /t` 가 나무를 훑어 준다. 유닉스에는 그런 것이 없어서,
   * **띄울 때 무리(process group)를 만들어 두지 않으면** 나중에 손자를
   * 가리킬 방법이 아예 없다. `npm run dev` 는 npm → node → vite 로 내려가고,
   * 죽여야 하는 것은 맨 아래다. sh 만 죽이면 포트를 문 놈은 그대로 남는다.
   *
   * 이건 띄우는 순간에만 정할 수 있다 — 나중에 고칠 수 없는 종류라 여기서 잰다.
   */
  const o = 띄우기옵션();
  if (process.platform === 'win32') {
    check('윈도우는 무리를 안 만든다 (taskkill /t 가 나무를 훑는다)', o.detached !== true, String(o.detached));
    check('윈도우는 창을 안 띄운다', o.windowsHide === true, String(o.windowsHide));
  } else {
    check('유닉스는 무리로 띄운다 (손자까지 죽이려면 이때뿐)', o.detached === true, String(o.detached));
  }
  check('입력은 안 물려 준다', o.stdio?.[0] === 'ignore', JSON.stringify(o.stdio));
}

trace('11-치움');
모두끝내기();
/*
 * 치우기 전에 아이들이 실제로 죽기를 기다린다.
 *
 * 윈도우는 **도는 프로세스의 작업 폴더**를 못 지운다. 여기 아이들은 cwd 가
 * 이 폴더라, 죽이라고 말한 그 순간에 지우면 EPERM 이 난다. 죽이라고 말하는
 * 것과 죽는 것 사이에 틈이 있다 — taskkill 이 나무를 훑는 그 틈이다.
 *
 * 못 치워도 검사를 실패로 만들지는 않는다. 남는 것은 임시 폴더 하나뿐이고,
 * 그것 때문에 빨간불이 켜지면 진짜 실패가 묻힌다.
 */
for (let i = 0; i < 6; i++) {
  await 쉬기(300);
  try { rmSync(방, { recursive: true, force: true }); break; } catch { /* 아직 물고 있다 */ }
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n뒤에서 도는 명령 검사  ${D}(안 뜬 것을 떴다고 안 하는가 · 띄운 것을 거두는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
