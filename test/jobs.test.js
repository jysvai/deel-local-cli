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
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { TOOLS, bash제한시간 } from '../src/tools/index.js';
import { decode as 풀기, consoleCodepage } from '../src/tools/encoding.js';
import {
  띄우기, 목록, 하나, 읽기, 끝내기, 모두끝내기, 비우기, 셸명령, 띄우기옵션, 최대일감, 나무끊기, 잘렸나, JOBS_TOOL, 일감인자, 무리살아있나, 나무죽이기, 나무죽이기기다려, 못재고기다릴최대,
} from '../src/tools/jobs.js';
import { 정한셸 } from '../src/tools/shell.js';
import { 거둘것에있나 } from '../src/reap.js';
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
  const r = await 띄우기(부르기(도는아이, 자국), { cwd: 방, 기다림: 2000 });
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
  const r = await 띄우기(부르기(죽는아이), { cwd: 방, 기다림: 8000 });

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

  /*
   * ── 한 조각이 혼자 상한을 넘으면 ────────────────────────────────────────
   *
   * 앞을 버리는 되풀이는 조각이 **둘 이상**일 때만 버렸다. 그래서 큰 조각이
   * 하나 들어오면 **아무것도 안 버리고도 잘렸다고 적었고**, 바이트가 상한
   * 위에 남았다. 그 사이에 읽으면 멀쩡한 글에 "앞이 잘렸습니다" 가 붙고
   * 읽은 자리도 0 으로 돌아간다 — 모델은 없는 앞을 찾으러 처음부터 다시
   * 읽는다 (34차 리뷰).
   *
   * 상한 위에 남겨 두는 것 자체도 값이 있다. 그대로 두면 그 다음 조각 하나에
   * 256KB 가 통째로 날아간다.
   */
  {
    const r2 = await 띄우기(부르기(조용한아이), { cwd: 방, 기다림: 0 });
    const j2 = 하나(r2.번호);
    j2.담기(Buffer.alloc(300 * 1024, 0x61));       // 한 조각이 혼자 256KB 를 넘는다
    check('★★ 큰 조각 하나도 상한 아래로 줄인다', j2.바이트 <= 256 * 1024, `${j2.바이트}바이트`);
    check('★ 줄였으면 정말로 뒤쪽이 남는다', j2.전체글().length === 256 * 1024, String(j2.전체글().length));
    const 첫읽기 = 읽기(r2.번호);
    check('★ 진짜로 버린 판에서는 잘렸다고 말한다', 첫읽기.앞잘림 === true, JSON.stringify(첫읽기.앞잘림));
    await 끝내기(r2.번호);
  }

  /*
   * 반대쪽 — 상한 아래에서는 **아무 말도 안 한다.** 이 줄이 없으면 위 고침을
   * 「늘 잘렸다고 한다」 로 넓혀도 초록이다.
   */
  {
    const r3 = await 띄우기(부르기(조용한아이), { cwd: 방, 기다림: 0 });
    const j3 = 하나(r3.번호);
    j3.담기(Buffer.from('짧은 줄\n', 'utf8'));
    const 본것 = 읽기(r3.번호);
    check('★★ 안 버렸으면 잘렸다고 안 한다', 본것.앞잘림 === false && 본것.글 === '짧은 줄\n',
      `${본것.앞잘림} · ${JSON.stringify(본것.글)}`);
    await 끝내기(r3.번호);
  }

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
  // 숫자이기만 하면 NaN 도 -1 도 통과한다. 화면에 `NaN초 돌았습니다` 가
  // 뜨는 고장이 정확히 그 틈으로 들어온다.
  check('★ 몇 초 돌았는지 적는다 — 셀 수 있는 값이다',
    Number.isFinite(k.초) && k.초 >= 0 && k.초 < 600, String(k.초));
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

  /*
   * 그 말이 **무엇을 받았는지**도 적나.
   *
   * 이 자리가 `args?.번호` 를 읽고 있었다. 설명서에 실린 이름은 `job` 이라
   * 모델은 거의 늘 `job` 으로 보내는데, 그러면 `(받은 것: undefined)` 가
   * 나갔다 — 무엇을 잘못 보냈는지 알려 주려고 있는 줄이 그것만 안 알려 줬다.
   */
  const 영어이름 = await JOBS_TOOL.run({ job: 'abc' });
  check('★★ 설명서 이름으로 보내도 받은 것을 그대로 적는다',
    /abc/.test(영어이름.error ?? '') && !/undefined/.test(영어이름.error ?? ''),
    영어이름.error ?? '');

  /*
   * ── 띄우기 자체가 실패한 판 ────────────────────────────────────────────
   *
   * 없는 폴더를 cwd 로 주면 spawn 이 'error' 를 낸다. 그때 우리는 종료코드를
   * -1 로 세우는데, 곧바로 오는 'close' 가 code=null 로 그것을 덮었다.
   * null 은 이 자리에서 **「시그널로 죽었다」 와 구별이 안 된다** — 안 뜬
   * 까닭이 종료코드에서 지워진다 (34차 리뷰).
   */
  const 없는데서 = await 띄우기(부르기(조용한아이), { cwd: join(방, '없는폴더'), 기다림: 400 });
  check('안 뜬 것을 떴다고 안 한다', 없는데서.떴나 !== true, JSON.stringify(없는데서).slice(0, 100));
  check('★★ 띄우기 실패를 종료코드에서 안 지운다', 없는데서.종료코드 === -1,
    `${없는데서.종료코드} · ${없는데서.시그널}`);
  check('★ 왜 안 떴는지 나온 말에 남는다', /띄우기 실패/.test(없는데서.출력 ?? ''),
    (없는데서.출력 ?? '').slice(0, 80));

  비우기();
}

trace('5-0-안죽은놈의파이프');

/*
 * ── 안 죽은 놈의 파이프를 끊어 버렸다 ──────────────────────────────────
 *
 * 끝내기 는 TERM·KILL 을 다 보내고도 안 죽은 놈을 **목록에 남긴다** — 「다시
 * 시킬 수 있어야 한다」 는 것이 그 까닭이다. 그런데 남기기 전에 파이프를 이미
 * 끊고 있었다. 그러면 목록에는 `도는중` 으로 뜨는데 그놈이 뱉는 말은 다시는
 * 안 들어오고, 자식은 다음 쓰기에서 EPIPE 를 맞는다. 남겨 두기로 한 까닭이
 * 「다시 볼 수 있게」 인데 정작 볼 길을 끊던 셈이다 (34차 리뷰).
 *
 * ── 어떻게 재나 ────────────────────────────────────────────────────────
 *
 * SIGKILL 을 견디는 프로세스를 검사에서 만들 방법이 없다(있어도 그걸 검사에
 * 띄우면 안 된다). 그래서 **안 죽는 자식 흉내**를 끼워 넣는다 — exitCode 가
 * 영영 null 이라 아직사나() 가 늘 참이고, 파이프는 끊겼는지만 기억한다.
 * pid 를 안 주므로 진짜 신호는 아무 데도 안 나간다.
 */
{
  const r = await 띄우기(부르기(조용한아이), { cwd: 방, 기다림: 0 });
  const j = 하나(r.번호);
  const 진짜 = j.kid;
  let 끊긴수 = 0;
  const 끊기기억 = { destroy() { 끊긴수++; } };
  j.kid = {
    pid: undefined,            // 진짜 신호가 나가지 않게
    exitCode: null,            // 영영 안 죽는다
    signalCode: null,
    kill() { return true; },
    unref() {},
    once() {},                 // 죽는말기다리기 가 걸어 두는 자리
    off() {},
    removeListener() {},
    stdout: 끊기기억,
    stderr: 끊기기억,
  };
  j.담기(Buffer.from('죽기 전에 남긴 말\n', 'utf8'));

  const 끝 = await 끝내기(r.번호);
  check('★★ 안 죽었으면 안 죽었다고 말한다', 끝?.안죽음 === true, JSON.stringify(끝));
  check('★★ 안 죽은 놈의 파이프는 안 끊는다', 끊긴수 === 0, `${끊긴수}번 끊었다`);
  check('★ 목록에 도는중 으로 남긴다', 하나(r.번호)?.상태 === '도는중', String(하나(r.번호)?.상태));
  check('★ 남긴 말은 그래도 준다', /죽기 전에 남긴 말/.test(끝?.남은 ?? ''), 끝?.남은);

  // 진짜 자식을 돌려놓고 거둔다 — 안 그러면 이 아이가 검사 끝까지 남는다.
  j.kid = 진짜;
  j.상태 = '도는중';
  await 끝내기(r.번호);
  비우기();
}

trace('5-1-모르는인자');

/*
 * ── 몇 개만 못 알아들은 부름 ────────────────────────────────────────────
 *
 * 「하나도 못 알아들었으면 얼버무리지 않는다」 는 이미 있었다. 그런데
 * `{job: 1, action: 'stop'}` 처럼 **아는 것과 모르는 것이 섞이면** 그 갈래에
 * 안 걸려서, `action` 을 조용히 버리고 출력만 읽어 성공으로 돌려줬다. 끄라고
 * 시킨 모델은 껐다고 여기고 넘어가는데 서버는 그대로 돈다.
 */
{
  const r = await 띄우기(부르기(조용한아이), { cwd: 방, 기다림: 0 });
  check('계속 도는 아이가 떴다', 하나(r.번호)?.상태 === '도는중', String(하나(r.번호)?.상태));

  const 섞인것 = await JOBS_TOOL.run({ job: r.번호, action: 'stop' });
  check('★★ 버린 인자 이름을 말해 준다', /action/.test(섞인것.content ?? 섞인것.error ?? ''),
    (섞인것.content ?? 섞인것.error ?? '').slice(0, 160));
  check('★★ 끄려던 것이면 어떻게 불러야 하는지 알려 준다',
    /stop/.test(섞인것.content ?? 섞인것.error ?? ''),
    (섞인것.content ?? 섞인것.error ?? '').slice(0, 160));
  // 알아들은 것은 하라고 시킨 것이 맞다 — 오류로 막지 않는다.
  check('★ 아는 인자는 그대로 해 준다', !섞인것.error && /도는중/.test(섞인것.content ?? ''),
    (섞인것.content ?? 섞인것.error ?? '').slice(0, 120));
  // 아직 살아 있어야 한다. 조용히 껐으면 그게 더 나쁘다.
  check('★ 모르는 말로는 끄지 않는다', 하나(r.번호)?.상태 === '도는중', String(하나(r.번호)?.상태));

  // 멀쩡한 부름에는 군말이 안 붙는다.
  const 멀쩡 = await JOBS_TOOL.run({ job: r.번호 });
  check('★ 아는 인자만 주면 군말이 없다', !/못 알아들어/.test(멀쩡.content ?? ''),
    (멀쩡.content ?? '').slice(0, 120));

  비우기();
}

trace('5-1b-참거짓을글자로보낸다');

/*
 * ── `stop: "false"` ─────────────────────────────────────────────────────
 *
 * 규격에는 boolean 이라고 적어 뒀지만, 여기 오는 것은 모델이 지어낸 JSON 이다.
 * 작은 로컬 모델은 참·거짓을 **글자로** 보낸다 — `"false"` · `"no"` · `"0"`.
 * `!!'false'` 는 참이라, **끄지 말라고 적어 보낸 부름이 도는 서버를 껐다.**
 * 바로 위 5-1 이 없애겠다고 적어 둔 「시킨 적 없는 일을 조용히 하는」 고장이
 * 이름이 아니라 **값** 쪽에 그대로 남아 있던 자리다.
 */
{
  const r = await 띄우기(부르기(조용한아이), { cwd: 방, 기다림: 0 });
  check('계속 도는 아이가 떴다', 하나(r.번호)?.상태 === '도는중', String(하나(r.번호)?.상태));

  const 글자거짓 = await JOBS_TOOL.run({ job: r.번호, stop: 'false' });
  check('★★★ stop:"false" 로는 안 끈다', 하나(r.번호)?.상태 === '도는중', String(하나(r.번호)?.상태));
  check('★ 그래도 읽기는 해 준다', !글자거짓.error && /도는중/.test(글자거짓.content ?? ''),
    (글자거짓.content ?? 글자거짓.error ?? '').slice(0, 120));

  await JOBS_TOOL.run({ job: r.번호, stop: '0' });
  check('★★ stop:"0" 으로도 안 끈다', 하나(r.번호)?.상태 === '도는중', String(하나(r.번호)?.상태));

  // 못 알아들은 값으로도 끄지 않는다. 대신 무엇을 받았는지 적는다 —
  // 뜻이 거기 있었으면 다음 걸음에서 고쳐 부르라고.
  const 모름 = await JOBS_TOOL.run({ job: r.번호, stop: '아마도' });
  check('★★★ 모르는 값으로는 안 끈다', 하나(r.번호)?.상태 === '도는중', String(하나(r.번호)?.상태));
  check('★★ 무엇을 받았는지 적는다', /아마도/.test(모름.content ?? 모름.error ?? ''),
    (모름.content ?? 모름.error ?? '').slice(0, 160));
  check('★★ 끄려던 것이면 어떻게 부르는지 알려 준다', /stop: true/.test(모름.content ?? 모름.error ?? ''),
    (모름.content ?? 모름.error ?? '').slice(0, 160));

  // 참인 글자는 그대로 참이다 — 느슨하게 받는 쪽이 이 도구의 약속이다.
  const 글자참 = await JOBS_TOOL.run({ job: r.번호, stop: 'true' });
  check('★★ stop:"true" 는 끈다', await 될때까지(() => 하나(r.번호)?.상태 !== '도는중'),
    String(하나(r.번호)?.상태) + ' · ' + (글자참.content ?? 글자참.error ?? '').slice(0, 80));

  비우기();
}

// 값 읽기 자체도 따로 못 박는다 — 위 판은 끄기 하나만 재고, 여기서 꼴을 다 본다.
{
  const 참으로 = ['true', 'TRUE', ' yes ', 'y', '1', 'on', '참', true, 1];
  const 거짓으로 = ['false', 'FALSE', 'no', 'n', '0', 'off', '거짓', '아니오', false, 0, null, undefined, ''];
  check('★★ 참으로 읽는 꼴', 참으로.every((v) => 일감인자({ job: 1, stop: v }).끝내기 === true),
    JSON.stringify(참으로.filter((v) => 일감인자({ job: 1, stop: v }).끝내기 !== true)));
  check('★★ 거짓으로 읽는 꼴', 거짓으로.every((v) => 일감인자({ job: 1, stop: v }).끝내기 === false),
    JSON.stringify(거짓으로.filter((v) => 일감인자({ job: 1, stop: v }).끝내기 !== false)));
  check('★★ 모르는 값은 거짓으로 두고 못 읽었다고 적는다',
    일감인자({ job: 1, stop: '아마도' }).끝내기 === false
    && (일감인자({ job: 1, stop: '아마도' }).못읽은값 ?? []).some(([칸, 값]) => 칸 === 'stop' && 값 === '아마도'),
    JSON.stringify(일감인자({ job: 1, stop: '아마도' })));
  check('★ 처음부터 도 같은 자로 읽는다',
    일감인자({ job: 1, from_start: 'false' }).처음부터 === false
    && 일감인자({ job: 1, from_start: 'true' }).처음부터 === true,
    JSON.stringify([일감인자({ job: 1, from_start: 'false' }), 일감인자({ job: 1, from_start: 'true' })]));
  // 아는 값만 주면 못읽은값 은 비어 있어야 한다 — 비었을 때 군말이 붙으면 그게 거짓 경고다.
  check('★ 아는 값에는 군말이 없다', (일감인자({ job: 1, stop: true }).못읽은값 ?? []).length === 0,
    JSON.stringify(일감인자({ job: 1, stop: true }).못읽은값 ?? null));

  /*
   * ★★★ 번호 칸만 이 자를 안 거쳤다 (막판 훑기).
   *
   * 바로 위 참거짓() 머리말은 「작은 로컬 모델은 값을 글자·엉뚱한 꼴로 보낸다 … 모르는
   * 값으로 끄는 쪽이 훨씬 나쁘다 — 끈 것은 못 되돌린다」 고 적어 두고 stop·from_start 를
   * 막았는데, 번호는 날 `Number()` 였다. 자바스크립트가 `true` 를 1 로, `[]` 를 0 으로
   * 조용히 바꿔서 `Jobs({job:true, stop:true})` 가 **1번 일감을 끈다** — 모델이 가리킨
   * 적도 없는 서버를. 숫자도 글자도 아닌 것은 숫자로 안 읽고 아래 「번호는 숫자여야
   * 합니다」 갈래로 보낸다.
   */
  for (const 값 of [true, false, [], {}, [3]]) {
    check(`★★★ 숫자가 아닌 job 은 일감 번호가 되지 않는다 — ${JSON.stringify(값)}`,
      !Number.isFinite(일감인자({ job: 값 }).번호), String(일감인자({ job: 값 }).번호));
  }
  check('  (짝) 숫자와 숫자 글자는 그대로 읽는다',
    일감인자({ job: 2 }).번호 === 2 && 일감인자({ job: '3' }).번호 === 3
    && 일감인자({}).번호 === null,
    JSON.stringify([일감인자({ job: 2 }).번호, 일감인자({ job: '3' }).번호, 일감인자({}).번호]));
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
  // 신호로 끝나면 'exit' 이 안 돈다 — 그 길의 그물(reap.js)에도 적혀 있어야 일감이 안 남는다 (2.0.2 · M3).
  check('★ 신호로 끝날 때 거둘 것에 일감 끄기가 적혀 있다', 거둘것에있나(모두끝내기));

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
  // 번호는 사람이 `/jobs 3` 처럼 다시 칠 값이다. 0 이나 소수가 오면 그 자리에서
  // 못 부른다 — 숫자이기만 하면 되는 값이 아니다.
  check('★ background 면 다시 부를 수 있는 일감 번호를 준다',
    Number.isInteger(r.일감번호) && r.일감번호 > 0, JSON.stringify(r).slice(0, 100));
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
  /*
   * ★ **복합 명령**으로 부른다. 이게 이 검사의 값을 정한다.
   *
   * 전에는 `node ticker.cjs …` 하나였다. 유닉스 sh 는 그런 명령을 exec 로
   * **제 자신을 갈아치워** 돌린다 — 그러면 우리 아이가 곧 node 이고 손자가
   * 아예 안 생긴다. 그래서 「손자를 못 죽인다」 는 고장이 있어도 이 검사는
   * 초록이었다. 실제로 유닉스 갈래가 통째로 빠져 있는 동안에도 그랬다.
   *
   * `cd . && node …` 로 부르면 sh 가 exec 를 못 하고 fork 한다. 그러면
   * sh → node 로 나무가 생겨서, 진짜로 재려던 것을 잰다.
   * (윈도우 cmd.exe 도 마찬가지로 한 겹이 더 생긴다.)
   */
  const 복합 = `cd . && ${안에서('ticker.cjs', 'tick-timeout.txt')}`;
  const 느린것 = await TOOLS.Bash.run({ command: 복합, timeout: 700 }, ctx);
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
  /*
   * 안 멈췄으면 **무엇이 살아 있는지** 적는다.
   *
   * 「222바이트 → 227바이트」 만 남으면 그 다음에 할 수 있는 것이 없다.
   * 리눅스에서만 나는 탈이라 손으로 재현할 수도 없어서, 그 판에서 보이는
   * 것을 그 자리에서 적어 두는 것이 유일한 길이다 — 살아남은 프로세스의
   * pid·무리(pgid)·부모(ppid)까지. 무리가 우리가 만든 그 무리면 죽이는
   * 쪽 문제고, 딴 무리면 애초에 무리에 안 들어간 것이다. 그 둘은 고칠
   * 자리가 다르다.
   */
  let 살아남은것 = '';
  if (!시간초과멈췄나 && process.platform !== 'win32') {
    try {
      const { execFileSync } = await import('node:child_process');
      const 목록 = execFileSync('ps', ['-eo', 'pid,pgid,ppid,stat,args'], { encoding: 'utf8', timeout: 5000 });
      살아남은것 = 목록.split('\n').filter((l) => /ticker\.cjs|tick-timeout/.test(l))
        .map((l) => l.trim()).join(' | ').slice(0, 300);
    } catch (err) { 살아남은것 = 'ps 를 못 불렀다 — ' + String(err?.message ?? err).slice(0, 60); }
  }
  check('★ 시간 초과여도 진짜 멈춘다', 시간초과멈췄나,
    `${잰1}바이트 → ${잰2}바이트${살아남은것 ? `  살아남음: ${살아남은것}` : ''}`);

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

  /*
   * 6회차 Gemini 도구6c C2 · 뒤로 띄운 명령이 **뜨자마자 죽으면** 결과에 되돌릴것 이 없었다.
   * 스냅샷은 명령 전에 이미 History 에 들어가 /undo 는 되는데, 화면·모델은 「떠 뒀다」 를 모른다 —
   * `rm keep.txt && npm run dev` 가 곧장 죽으면 파일은 이미 없다. 끊김·시간 초과 갈래는 싣는다.
   */
  {
    const { writeFileSync: 쓰기 } = await import('node:fs');
    쓰기(join(방, 'quit3.cjs'), 'process.exit(3)');
    쓰기(join(방, 'keep6.txt'), 'data');
    const 곧죽음 = await TOOLS.Bash.run({ command: 'rm keep6.txt && node quit3.cjs', background: true }, ctx);
    check('★ 뜨자마자 죽어도 떠 둔 것은 결과에 싣는다 (6회차 도구6c C2)',
      곧죽음.failed === true && Array.isArray(곧죽음.되돌릴것) && 곧죽음.되돌릴것.length >= 1 && !existsSync(join(방, 'keep6.txt')),
      JSON.stringify({ error: 곧죽음.error?.slice(0, 30), 되돌릴것: 곧죽음.되돌릴것 ?? null }).slice(0, 140));
    check('  죽었다는 말은 그대로다', /띄우자마자 끝났습니다/.test(곧죽음.error ?? ''), 곧죽음.error ?? '');
  }

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

trace('10b-사냥5');

// ── 10b. 셸이 끝났는데 파이프가 남은 판 · 넘침 · 입력 · 제한 시간 · 인코딩 (사냥5) ──
{
  const ctx = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set() };
  ctx.history.nextTurn();
  const 살았나 = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
  const 번호읽기 = (이름) => (existsSync(join(방, 이름)) ? Number(readFileSync(join(방, 이름), 'utf8')) : null);

  /*
   * (M1) Bash 가 자식의 stdin 을 **열린 파이프**로 줬다. 그래서 입력을 끝까지 읽는 명령
   * (`cat` · `sort` · 입력을 기다리는 스크립트)이 아무것도 안 오는 파이프 앞에서 시간 초과까지
   * 섰다. Jobs 는 처음부터 'ignore' 였다(jobs.js 띄우기옵션).
   */
  {
    const t0 = Date.now();
    const r = await TOOLS.Bash.run({
      command: `node -e "process.stdin.resume();process.stdin.on('end',()=>console.log('GOT-EOF'))"`, timeout: 15000,
    }, ctx);
    check('★ 입력을 끝까지 읽는 명령이 시간 초과까지 안 선다 (stdin 을 안 열어 둔다)',
      /GOT-EOF/.test(r.content ?? '') && !r.error && Date.now() - t0 < 10000, `${Date.now() - t0}ms · ${r.error ?? ''}`);
  }

  /*
   * (M8) timeout 을 그대로 setTimeout 에 넣었다. 60(초로 알고 보낸 값)이면 60ms 에 죽고,
   * 1e10 은 32비트를 넘어 1ms 로, "abc" 는 NaN 이라 1ms 로 바뀌며 Node 경고까지 났다.
   */
  {
    check('제한 시간: 없거나 숫자가 아니거나 0 이하면 기본값',
      [undefined, null, 0, -1, 'abc', NaN, Infinity].every((x) => bash제한시간(x) === 120000),
      [undefined, null, 0, -1, 'abc', NaN, Infinity].map((x) => bash제한시간(x)).join(' '));
    check('★ 제한 시간: 1초 밑으로는 안 내려간다', bash제한시간(60) === 1000 && bash제한시간(700) === 1000, `${bash제한시간(60)}`);
    check('★ 제한 시간: 너무 크면 상한(10분)에서 멈춘다', bash제한시간(1e10) === 600000, `${bash제한시간(1e10)}`);
    check('제한 시간: 글자로 온 숫자는 숫자로 읽는다', bash제한시간('5000') === 5000 && bash제한시간(120000) === 120000);
    const 경고들 = [];
    const 경고잡이 = (w) => 경고들.push(w.name);
    process.on('warning', 경고잡이);
    for (const timeout of [1e10, 'abc']) {
      const r = await TOOLS.Bash.run({ command: `node -e "console.log('finished')"`, timeout }, ctx);
      check(`★ timeout ${JSON.stringify(timeout)} 이어도 곧바로 안 죽인다`, /finished/.test(r.content ?? '') && !r.error, r.error ?? '');
    }
    await 쉬기(50);
    process.off('warning', 경고잡이);
    check('★ 제한 시간 때문에 Node 경고(TimeoutOverflow·TimeoutNaN)가 안 난다', !경고들.some((n) => /Timeout/.test(n)), 경고들.join(' '));
  }

  /*
   * (M3) 출력이 8MB 를 넘으면 `kid.kill()` 만 했다 — 셸만 죽고 쏟는 손자는 살아 파이프를 문다.
   * 그래서 넘친 즉시가 아니라 **시간 초과에** 돌아왔고, 말도 「시간 초과」 였다.
   */
  {
    // 파이프가 끊겨도 안 죽는 손자다. 끊긴 파이프에 저절로 죽는 손자면 셸만 죽여도 멈춰 보여서,
    // 나무째 끊는지를 못 잰다 (6회차 어긋내기).
    스크립트('flood.cjs', "require('fs').writeFileSync(process.argv[2], String(process.pid)); process.stdout.on('error', () => {}); setInterval(() => {}, 1000); const b = Buffer.alloc(65536, 97); (function w() { while (process.stdout.write(b)); process.stdout.once('drain', w); })();\n");
    const t0 = Date.now();
    const r = await TOOLS.Bash.run({ command: 'cd . && node flood.cjs flood.pid', timeout: 20000 }, ctx);
    const 걸림 = Date.now() - t0;
    const 쏟개 = 번호읽기('flood.pid');
    check('★ 출력이 넘치면 시간 초과까지 안 기다린다', 걸림 < 12000, `${걸림}ms`);
    check('★ 넘쳤다고 말한다 — 시간 초과라고 하지 않는다',
      /MB 를 넘어/.test(r.content ?? '') && !/시간 초과/.test(`${r.error ?? ''}${r.content ?? ''}`),
      r.error ?? String(r.content ?? '').slice(-100));
    const 멈춤 = await 될때까지(() => !살았나(쏟개), 6000);
    check('★ 쏟던 손자도 진짜 멈춘다', 멈춤, String(쏟개));
    if (살았나(쏟개)) { try { process.kill(쏟개); } catch { /* 이미 */ } }
  }

  /*
   * (M2) 셸은 끝났는데 뒤로 띄운 손자가 stdout 을 물고 있으면 'close' 가 안 온다. Bash 는
   * 그걸 기다리다 시간 초과로 돌아왔고, Jobs 는 끝내라고 하면 셸이 이미 없어 나무를 못 찾고도
   * 「끝냈습니다」 라고 했다. `&` 가 뒤로 띄우기인 셸(bash·sh)에서만 잰다.
   */
  const 셸 = 정한셸().id;
  if (셸 === 'bash' || 셸 === 'sh') {
    스크립트('gc.cjs', "require('fs').writeFileSync(process.argv[2], String(process.pid)); console.log('gc up'); setInterval(() => {}, 1000);\n");
    const t0 = Date.now();
    const r = await TOOLS.Bash.run({ command: 'node gc.cjs gc1.pid & echo shell-done', timeout: 20000 }, ctx);
    const 걸림 = Date.now() - t0;
    check('★ 셸이 끝나면 남은 손자가 파이프를 물어도 시간 초과까지 안 기다린다',
      걸림 < 10000 && !/시간 초과/.test(r.error ?? ''), `${걸림}ms · ${r.error ?? ''}`);
    check('셸이 낸 말은 그대로 준다', /shell-done/.test(r.content ?? ''), String(r.content ?? '').slice(0, 80));
    check('★ 뒤에 남은 것이 있었다고 말하고 background 로 띄우라고 알려 준다',
      /background: true/.test(r.content ?? ''), String(r.content ?? '').slice(-160));
    await 될때까지(() => 번호읽기('gc1.pid') != null, 3000);
    const 손자1 = 번호읽기('gc1.pid');
    if (process.platform !== 'win32') {
      check('★ (유닉스) 뒤에 남은 손자도 무리째 끝낸다', await 될때까지(() => !살았나(손자1), 5000), String(손자1));
    } else {
      check('★ (윈도우) 셸이 먼저 끝나 그 아래를 못 찾으면 못 껐다고 말한다', /못 찾/.test(r.content ?? ''), String(r.content ?? '').slice(-160));
    }
    if (살았나(손자1)) { try { process.kill(손자1); } catch { /* 이미 */ } }

    const j = await 띄우기('node gc.cjs gc2.pid & echo shell-done', { cwd: 방, 기다림: 1500 });
    await 될때까지(() => 번호읽기('gc2.pid') != null, 3000);
    const 손자2 = 번호읽기('gc2.pid');
    await 될때까지(() => 하나(j.번호)?.kid?.exitCode != null, 3000);
    const 줄 = (await JOBS_TOOL.run({})).content ?? '';
    check('Jobs 목록: 셸은 끝났는데 남은 것이 출력을 물고 있다고 알린다', /셸은 끝남/.test(줄), 줄);
    const 끝 = await JOBS_TOOL.run({ job: j.번호, stop: true });
    await 쉬기(300);
    const 살아있음 = 살았나(손자2);
    check('★ 남은 손자가 살아 있으면 「끝냈습니다」 라고 안 한다',
      살아있음 ? (!/끝냈습니다/.test(끝.content ?? '') && !!끝.error) : /끝냈습니다/.test(끝.content ?? ''),
      `살아있음=${살아있음} · ${JSON.stringify(끝).slice(0, 160)}`);
    if (process.platform !== 'win32') check('★ (유닉스) Jobs 끝내기가 남은 손자까지 무리째 끝낸다', !살아있음, String(손자2));
    if (살았나(손자2)) { try { process.kill(손자2); } catch { /* 이미 */ } }
    비우기();
  } else {
    check(`${셸} 에서는 & 가 뒤로 띄우기가 아니라 남은 손자 검사를 건넌다 ⚠`, true, 셸);
  }

  /*
   * (L2) 이미 끝난 일감에 stop 을 주면 안 읽은 마지막 출력째 목록에서 지웠다.
   * 죽기 직전 남긴 한 줄이 제일 중요한데 그걸 버렸다.
   */
  {
    // 표시 글은 **돌 때 만든다**(6*7) — 명령줄에 그대로 적혀 있으면 「이미 끝나 있었습니다: <명령>」
    // 한 줄에 그 글이 들어 있어 출력을 버려도 초록이 된다(처음 이 검사가 그렇게 헛돌았다).
    const r = await 띄우기(`node -e "setTimeout(()=>{console.log('LAST-LINE-'+(6*7));process.exit(3)},700)"`, { cwd: 방, 기다림: 100 });
    await 될때까지(() => 하나(r.번호)?.상태 === '끝남', 8000);
    const s = await JOBS_TOOL.run({ job: r.번호, stop: true });
    check('★ 이미 끝난 일감을 끝내라고 해도 안 읽은 마지막 출력을 준다', /LAST-LINE-42/.test(s.content ?? ''), s.content ?? s.error);
    비우기();
  }

  /*
   * (L1) 처음 읽을 때 ASCII 뿐이어도 인코딩을 utf-8 로 못 박았다. 나중에 CP949 한글이
   * 나오면 처음부터 다시 읽어도 영영 깨졌다. 통째로 새로 푼 것과 같아야 한다.
   */
  {
    스크립트('emit.cjs', [
      "process.stdout.write('starting server\\n');",
      'setTimeout(() => { process.stdout.write(Buffer.from([0xC7, 0xD1, 0xB1, 0xDB, 0x20, 0xBF, 0xC0, 0xB7, 0xF9, 0x0A])); }, 1200);',
      'setTimeout(() => {}, 6000);',
    ].join('\n'));
    const e = await 띄우기('node emit.cjs', { cwd: 방, 기다림: 0 });
    await 될때까지(() => (하나(e.번호)?.바이트 ?? 0) >= 16, 5000);
    await JOBS_TOOL.run({ job: e.번호 });        // ASCII 만 있을 때 한 번 읽는다 — 옛 코드는 여기서 못 박았다
    await 될때까지(() => (하나(e.번호)?.바이트 ?? 0) > 16, 6000);
    const 통째 = await JOBS_TOOL.run({ job: e.번호, from_start: true });
    const 새로 = 풀기(Buffer.concat(하나(e.번호).조각들), { fallback: consoleCodepage() === 65001 ? 'utf-8' : null }).text;
    check('★ ASCII 만 나온 뒤 한글 바이트가 와도 통째로 새로 푼 것과 같다',
      String(통째.content ?? '').includes(새로.trim()), `${JSON.stringify(String(통째.content ?? '').slice(-30))} vs ${JSON.stringify(새로.slice(-12))}`);
    비우기();
  }
}


/*
 * ── 「나무를 다 못 끊었다」 를 무엇으로 아나 ─────────────────────────────
 *
 * 이 판의 대표 기능이 여기 걸려 있는데, 판별식이 **늘 참**이었다.
 *
 * 처음엔 `!err?.killed` 로 갈랐다. 비동기 execFile 의 콜백은 상한에 걸리면
 * err.killed 를 true 로 주므로 그럴듯했다. 그런데 여기서 쓰는 것은
 * execFileSync 고, **그건 killed 를 안 준다.** 그래서 「못 끊었다」 가 한 번도
 * 안 나왔고, 뿌리를 살려 두는 분기는 처음부터 닿지 않는 코드였다. 검사는
 * 내내 초록이었다 — 아무도 그 값을 직접 재 보지 않았기 때문이다.
 *
 * 그래서 여기서 **값을 못 박는다.** 실제로 재서 얻은 것이다(윈도우 11 · Node 20):
 *
 *   상한에 걸림      killed=undefined  signal=SIGTERM  code=ETIMEDOUT  status=null
 *   없는 pid 를 죽임  killed=undefined  signal=null     code=undefined  status=128
 *
 * 이 두 줄이 이 기능의 바닥이다. Node 가 이걸 바꾸면 여기가 빨개져야 한다.
 */
trace('12-끊김판별');
{
  const { execFileSync } = await import('node:child_process');

  // (1) 진짜로 상한에 걸려 본다. 오래 걸리는 명령을 아주 짧은 상한으로 부른다.
  let 걸린탈 = null;
  try {
    const 느린것 = process.platform === 'win32'
      ? ['-e', 'const t=Date.now(); while (Date.now()-t < 5000);']
      : ['-e', 'const t=Date.now(); while (Date.now()-t < 5000);'];
    execFileSync(process.execPath, 느린것, { timeout: 150, windowsHide: true, stdio: 'ignore' });
  } catch (err) { 걸린탈 = err; }
  check('상한에 걸리면 탈이 난다', !!걸린탈, 걸린탈 ? '' : '안 났다');
  check('★ execFileSync 는 상한에 걸려도 killed 를 안 준다 — 이걸로 가르면 안 된다',
    걸린탈?.killed !== true, `killed=${String(걸린탈?.killed)}`);
  check('★ 상한에 걸린 것은 signal·code 로 알아본다',
    걸린탈?.code === 'ETIMEDOUT' || 걸린탈?.signal != null,
    `signal=${String(걸린탈?.signal)} code=${String(걸린탈?.code)}`);
  check('★ 잘렸나() 가 상한에 걸린 것을 잘렸다고 한다', 잘렸나(걸린탈) === true);

  // (2) 그냥 0 이 아닌 값으로 끝난 것 — 이건 잘린 것이 아니다.
  let 진탈 = null;
  try {
    execFileSync(process.execPath, ['-e', 'process.exit(3)'], { timeout: 20000, windowsHide: true, stdio: 'ignore' });
  } catch (err) { 진탈 = err; }
  check('0 이 아닌 값으로 끝나면 탈이 난다', !!진탈, String(진탈?.status));
  check('★ 잘렸나() 가 「그냥 실패」 를 잘렸다고 하지 않는다', 잘렸나(진탈) === false,
    `signal=${String(진탈?.signal)} code=${String(진탈?.code)} status=${String(진탈?.status)}`);

  // (3) 없는 프로세스를 끊으라고 해도 「다 끊었다」 로 본다 — 이미 죽은 것이다.
  if (process.platform === 'win32') {
    check('★ 없는 pid 는 이미 죽은 것으로 본다(뿌리를 살려 두면 안 된다)',
      나무끊기(0x7ffffff0, 4000) === true);
  } else {
    check('★ 윈도우가 아니면 나무끊기 는 늘 참 — 무리째 죽이는 길이 따로 있다',
      나무끊기(1234) === true);
  }
}

/*
 * ── 상한에 걸려도 taskkill 은 **끝까지** 나무를 훑어야 한다 (2.0.0 6회차) ─────────
 *
 * 상한에 걸리면 execFileSync 가 taskkill 을 죽였다. 바쁜 컴퓨터에서는 그 순간 taskkill 이
 * 뿌리·가운데 셸만 죽인 반쪽이라, 손자(node · dev 서버)가 부모 없이 남고 다시는 못 가리켰다.
 * 검사를 돌린 하루 동안 이 파일의 아이 74개가 그렇게 살아 있었다. 코어를 다 쓰는 판에서
 * 끝내기 4번 중 1번, 모두끝내기 4번 중 1번이 남겼다(수정기록 6회차).
 *
 * 바쁜 컴퓨터는 검사에서 못 만드니, 상한을 1ms 로 줘서 「잘린 판」 을 만들고 그 뒤로 아무것도
 * 안 불러도 나무가 멈추는지 본다. 잘렸다고 돌려주는 것(뿌리를 살려 두는 신호)은 그대로다.
 */
trace('13-잘려도끝까지');
if (process.platform === 'win32') {
  const 자국 = join(방, 'tick-cut.txt');
  const r = await 띄우기(부르기(도는아이, 자국), { cwd: 방, 기다림: 0 });
  const j = 하나(r.번호);
  await 될때까지(() => existsSync(자국) && statSync(자국).size > 0, 8000);
  check('  잘라 볼 아이가 떠서 자국을 남긴다 (안 떴으면 아래 둘은 뜻이 없다)', existsSync(자국) && statSync(자국).size > 0 && !!j?.kid?.pid, `pid=${j?.kid?.pid}`);
  const 잘림 = 나무끊기(j.kid.pid, 1);
  check('상한 1ms 면 잘렸다고 돌려준다', 잘림 === false, String(잘림));
  // 아무것도 더 안 부른다. 떼어 띄운 taskkill 이 끝까지 가면 자국이 멈춘다.
  let 멈춤 = false;
  for (let i = 0; i < 40 && !멈춤; i++) {
    await 쉬기(300);
    const a = existsSync(자국) ? statSync(자국).size : 0;
    await 쉬기(250);
    멈춤 = (existsSync(자국) ? statSync(자국).size : 0) === a;
  }
  check('★ 상한에 잘려도 taskkill 은 끝까지 가서 손자까지 멈춘다 (6회차)', 멈춤, existsSync(자국) ? `${statSync(자국).size}바이트` : '자국 없음');
  비우기();
}

/*
 * ── 갓 띄운 것을 곧장 끊어도 손자가 안 남는다 (2.0.0 6회차) ─────────────────────
 *
 * Git Bash 는 `bin/bash.exe → usr/bin/bash.exe → 명령` 으로 나무를 **나중에** 만든다. 띄우고
 * 몇 ms 안에 taskkill 을 보내면 그 순간의 나무(발사대뿐)만 죽고, 곧이어 뜬 손자가 부모 없이
 * 남았다. 옛 코드에서도 0ms 에 4번 중 2번 남았다 — 검사 판마다 이 파일의 아이가 남던 까닭이다.
 * 한 번으로는 운에 맡겨지니 네 번 잇달아 띄우고 곧장 끊는다.
 */
trace('14-갓띄운것끊기');
{
  const 자국들 = [];
  const 떴나들 = [];
  for (let k = 0; k < 4; k++) {
    const 자국 = join(방, `tick-young${k}.txt`);
    자국들.push(자국);
    const r = await 띄우기(부르기(도는아이, 자국), { cwd: 방, 기다림: 0 });
    떴나들.push(r.떴나 === true);
    await 끝내기(r.번호);
  }
  // 대조군: 안 끊은 아이는 자국을 늘려야 한다 — 아무것도 안 떠서 「안 남았다」 로 초록이 되는 판을 막는다.
  const 대조 = join(방, 'tick-young-control.txt');
  const 대조r = await 띄우기(부르기(도는아이, 대조), { cwd: 방, 기다림: 0 });
  await 쉬기(1500);
  const 크기 = () => 자국들.map((f) => (existsSync(f) ? statSync(f).size : 0));
  const a = 크기();
  const 대조a = existsSync(대조) ? statSync(대조).size : 0;
  await 쉬기(600);
  const b = 크기();
  const 대조b = existsSync(대조) ? statSync(대조).size : 0;
  /*
   * 대조군이 **어떻게 됐는지**도 적는다 (2.0.1).
   *
   * 윈도 CI 에서 한 번 「대조 9 → 9」 로 빨갰다. 60ms 마다 찍는 아이가 1.5초에 9바이트를
   * 찍고 0.6초 동안 멈췄다 — 얼어 있었나, 죽었나. 앞에서 끊은 네 아이의 taskkill 은 상한에
   * 잘려도 떼어 띄운 채 끝까지 돈다(나무끊기 머리말). 그 사이 죽은 번호를 대조군이 물려받으면
   * 남의 나무를 끊을 수 있다 — 그게 가설이다. 이 노트가 다음 판에서 둘을 가른다.
   */
  const 대조일 = 하나(대조r.번호);
  check('  네 번 다 떴고, 안 끊은 대조군은 자국을 늘린다', 떴나들.every(Boolean) && 대조b > 대조a,
    `떴나 ${떴나들} · 대조 ${대조a} → ${대조b} · 대조군 ${대조일?.상태 ?? '없음'}${대조일?.상태 === '끝남' ? ` (종료 ${대조일.종료코드} · 신호 ${대조일.시그널})` : ''}`);
  const 도는것 = a.filter((x, i) => x !== b[i]).length;
  check('★ 갓 띄운 것을 네 번 곧장 끊어도 하나도 안 남는다 (6회차)', 도는것 === 0, `${도는것}개가 아직 자국을 늘린다 · ${a.join('/')} → ${b.join('/')}`);
  비우기();
}

/*
 * ── 기다린다는 것 자체를 잰다 (6회차 전수 어긋내기에서 둘이 샘) ──────────
 *
 * 14·15절은 **결과**(고아가 남나)를 잰다. 그런데 고아가 남는지는 그 PC 의 셸이
 * 나무를 얼마나 느리게 세우느냐에 달렸다 — Git Bash 는 손주가 한 겹 더 생겨 늦고,
 * cmd 는 바로 선다. 그래서 cmd 로 도는 PC 에서는 **기다림을 통째로 빼도** 14·15절이
 * 초록이었다(어긋내기 「갓 띄운 일감을 … 곧장 끊는다」 · 「모두끝내기 가 …」 둘 다 샘).
 * 그 줄을 지우는 사람을 아무도 안 막고 있었다는 뜻이고, 지우면 Git Bash 쓰는 사람만
 * 고아를 얻는다 — 제일 찾기 어려운 꼴이다.
 *
 * 그래서 여기서는 **약속한 동작**을 곧장 잰다: 갓 띄운 것을 끊으면 그 자리에서
 * 나무설틈 만큼 머문다. 오래된 것에는 안 머문다(늘 기다리는 것과 가르려고 같이 잰다).
 */
trace('14b-갓띄운것은기다렸다끊는다');
{
  const 갓것 = await 띄우기(부르기(조용한아이), { cwd: 방, 기다림: 0 });
  const t0 = Date.now();
  await 끝내기(갓것.번호);
  const 갓걸림 = Date.now() - t0;
  check('★★★ 갓 띄운 것을 끊으면 나무 설 틈만큼 머문다', 갓걸림 >= 500, `${갓걸림}ms`);

  const 묵은것 = await 띄우기(부르기(조용한아이), { cwd: 방, 기다림: 0 });
  await 쉬기(1200);                       // 나무설틈(1000ms)을 넘긴다
  const t1 = Date.now();
  await 끝내기(묵은것.번호);
  const 묵은걸림 = Date.now() - t1;
  check('★★ 오래된 것에는 안 머문다 (늘 기다리는 것이 아니다)', 묵은걸림 < 400,
    `${묵은걸림}ms · 갓 ${갓걸림}ms`);

  // 모두끝내기 도 같은 약속이다. 이쪽은 끝나는 길이라 동기로 머문다.
  await 띄우기(부르기(조용한아이), { cwd: 방, 기다림: 0 });
  const t2 = Date.now();
  모두끝내기();
  const 모두걸림 = Date.now() - t2;
  check('★★★ 모두끝내기 도 갓 띄운 것이 있으면 머문다', 모두걸림 >= 500, `${모두걸림}ms`);

  await 쉬기(1200);
  const t3 = Date.now();
  모두끝내기();
  const 모두빈걸림 = Date.now() - t3;
  check('★ 끝낼 것이 없으면 안 머문다', 모두빈걸림 < 400, `${모두빈걸림}ms`);
  비우기();
}

/*
 * 끝낼 때(모두끝내기)도 같다. 프로그램을 닫는 순간 갓 띄운 일감이 있으면, 셸이 나무를 다 세우기 전에
 * taskkill 이 지나가 손주 node 가 고아로 남는다. 14절은 하나씩 끊는 길(끝내기)만 재서, 모두끝내기 의
 * 기다림을 빼도 초록이었다 (6회차 어긋내기에서 샘).
 */
trace('15-갓띄운것모두끝내기');
{
  const 자국들 = [];
  const 떴나들 = [];
  for (let k = 0; k < 3; k++) {
    const 자국 = join(방, `tick-youngall${k}.txt`);
    자국들.push(자국);
    const r = await 띄우기(부르기(도는아이, 자국), { cwd: 방, 기다림: 0 });
    떴나들.push(r.떴나 === true);
  }
  모두끝내기();
  // 대조군은 모두끝내기 **뒤에** 띄운다 — 스크립트가 정말 자국을 늘리는지 본다(11절 치움이 거둔다).
  const 대조 = join(방, 'tick-youngall-control.txt');
  await 띄우기(부르기(도는아이, 대조), { cwd: 방, 기다림: 0 });
  await 쉬기(1500);
  const 크기 = () => 자국들.map((f) => (existsSync(f) ? statSync(f).size : 0));
  const a = 크기();
  const 대조a = existsSync(대조) ? statSync(대조).size : 0;
  await 쉬기(600);
  const b = 크기();
  const 대조b = existsSync(대조) ? statSync(대조).size : 0;
  check('  셋 다 떴고, 뒤에 띄운 대조군은 자국을 늘린다', 떴나들.every(Boolean) && 대조b > 대조a, `떴나 ${떴나들} · 대조 ${대조a} → ${대조b}`);
  const 도는것 = a.filter((x, i) => x !== b[i]).length;
  check('★ 갓 띄운 것을 모두끝내기 로 곧장 끊어도 하나도 안 남는다 (6회차)', 도는것 === 0, `${도는것}개가 아직 자국을 늘린다 · ${a.join('/')} → ${b.join('/')}`);
}

/*
 * 치우기는 **맨 끝**에 한다. 12절 뒤에 붙인 절들이 이 폴더의 스크립트로 아이를 띄우는데, 치우기가
 * 그 앞에 있어서 폴더가 지워진 뒤에 돌았다. 아이가 남아 폴더를 물고 있던 동안에는 지우기가 실패해
 * 우연히 돌았고, 남는 아이를 없애자 폴더가 지워져 13·14절이 **아무것도 안 띄운 채** 초록이 됐다
 * (2.0.0 6회차에 잡음 — 13절의 「잘렸다」 가 pid 없음으로 참이 되어 드러났다).
 */
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

trace('16-모르는-것을-죽은-것으로-안-센다');

// ── 권한이 없어 못 물어본 것을 「죽었다」 로 세면 안 된다 ────────────────
//
// 무리끊기 의 마지막 머리말이 이미 적어 두었다 — 「그 물음은 틀릴 수 있다 —
// 권한이 없으면(EPERM) 살아 있는데도 「없다」 가 나오고, 그러면 안 죽이고
// 지나간다」. 그래서 **마지막 한 방**은 묻지 않고 보내게 고쳤는데, 정작 그 위
// 지켜보기 고리의 `if (!무리살아있나(pid)) return;` 이 같은 물음에 기대어
// 첫 바퀴에서 빠져나간다 — SIGKILL 까지 통째로 건너뛴다. 고침이 반만 붙어 있었다.
//
// POSIX 에서 EPERM 은 「없다」 가 아니라 **「있는데 못 건드린다」** 이다.
{
  const 원래 = process.kill;
  const 던지기 = (code) => { process.kill = () => { const e = new Error(code); e.code = code; throw e; }; };
  try {
    던지기('EPERM');
    check('★★ 권한이 없으면 살아 있는 것으로 센다', 무리살아있나(999999) === true, '');
    던지기('ESRCH');
    check('★ 없는 것은 죽은 것으로 센다', 무리살아있나(999999) === false, '');
  } finally { process.kill = 원래; }
  check('살아 있는 것은 살아 있다고 한다', 무리살아있나(process.pid) === true, '');
}

trace('17-상한이-무리끊기까지-간다');

/*
 * ── 부르는 쪽이 정한 상한이 **유닉스 갈래에서만 버려졌다** (8회차 파일훑기) ──
 *
 * 나무죽이기 의 윈도우 갈래는 `나무끊기(kid.pid, 상한)` 으로 그 값을 그대로
 * 쓰는데, 유닉스 갈래는 `무리끊기(kid.pid, { 곧장 })` 이라 상한을 안 넘겼다.
 * 그래서 늘 무리끊기의 기본 800ms 만 기다렸다 — 재 보니 상한 5000 을 줘도
 * 100 을 줘도 걸린 시간이 똑같았다. 바로 그 위 머리말이 「상한은 부르는 쪽이
 * 정한다」 고 적어 놓고 한쪽에서만 지키고 있었다.
 *
 * 이 PC 는 윈도우라 유닉스 갈래가 안 돈다. 그래서 platform 과 process.kill 을
 * 잠깐 바꿔 그 갈래를 여기서 돌리고 원래대로 돌려놓는다 — 바로 위 EPERM 단이
 * 쓰는 것과 같은 수다. 죽지 않는 아이를 흉내 내면(늘 살아 있다고 답하면)
 * SIGTERM 과 SIGKILL 사이가 곧 상한이라, 시계로 그 값을 읽을 수 있다.
 */
{
  const 원래판 = process.platform;
  const 원래죽이기 = process.kill;
  const 받은신호 = [];
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  // 무엇을 물어도 탈 없이 돌아온다 = 그 무리는 끝까지 살아 있다.
  process.kill = (pid, 신호) => { 받은신호.push(신호); };
  const 가짜아이 = { pid: 424242, kill() {}, unref() {} };
  /*
   * ── 시계 하나로 재면 리눅스에서 **안 걸린다** (2.0.1) ──────────────────
   *
   * 여기는 `상한: 120` 한 판을 재고 `걸린 < 600` 을 봤다. 그런데 무리끊기의
   * 고리는 `Math.min(늦게, 못재고기다릴최대)` 이고 그 최대가 **400** 이다.
   * 상한을 안 넘기면 기본 800 이 되는데, 800 도 400 으로 깎인다.
   *
   *   안 어긋냄  min(120, 400) = 120ms
   *   어긋냄     min(800, 400) = 400ms   ← 600 아래라 그대로 초록
   *
   * 윈도에서는 걸렸다. 타이머 눈금이 굵어 20ms 조각이 실제로 31ms 쯤 되고,
   * 스무 조각이 621ms 가 되어 우연히 600 을 넘었을 뿐이다. **그 줄을 실제로
   * 돌리는 운영체제에서만 못 잡는 검사**였다 — 초록불이 가장 비싼 모양이다.
   *
   * 그래서 시각 하나를 문턱에 견주는 대신 **두 상한을 재어 서로 견준다.**
   * 상한이 안 넘어가면 둘 다 400 으로 깎여 차이가 사라진다. 눈금이 굵든
   * 가늘든, 기계가 빠르든 느리든 그 차이는 남는다.
   */
  try {
    const 재보기 = (상한) => {
      받은신호.length = 0;
      const t0 = Date.now();
      나무죽이기(가짜아이, { 파이프끊기: false, 상한 });
      return Date.now() - t0;
    };
    const 짧게 = 재보기(60);
    const 길게 = 재보기(못재고기다릴최대);
    check('★★ (8회차) 나무죽이기의 상한이 유닉스 갈래에서도 지켜진다',
      길게 - 짧게 >= 150, `상한 60 → ${짧게}ms · 상한 ${못재고기다릴최대} → ${길게}ms · 차이 ${길게 - 짧게}ms`);
    check('  그래도 곱게 말한 뒤 끊는다 (SIGTERM → SIGKILL)',
      받은신호.includes('SIGTERM') && 받은신호.includes('SIGKILL'), [...new Set(받은신호)].join(','));
  } finally {
    Object.defineProperty(process, 'platform', { value: 원래판, configurable: true });
    process.kill = 원래죽이기;
  }
}

trace('17b-못-재는-기다림은-짧게-못-박는다');

/*
 * ── 「보통은 거의 안 기다린다」 가 유닉스에서 거짓말이었다 (16회차) ──────
 *
 * 무리끊기 의 지켜보기 고리 머리말은 「얌전히 끝나는 무리는 첫 20ms 에
 * 사라지므로 보통은 거의 안 기다린다」 고 적어 뒀다. 유닉스에서는 한 번도
 * 그런 적이 없다 — 우리가 띄운 자식은 죽어도 **우리가 거두기 전까지 좀비**로
 * 남고, 거두는 일은 이벤트 루프에서만 일어난다. 그 고리는 `Atomics.wait` 로
 * 루프를 세워 놓고 물으므로 답이 영영 안 바뀌고, **늘 상한을 다 썼다.**
 * 리눅스 CI 에서 「오래된 것에는 안 머문다」(400ms 아래)가 6,037ms 로 빨개진
 * 것이 이것이다 — 사람이 「끝내」 를 칠 때마다 6초였다.
 *
 * 세 가지를 같이 잰다. 하나만 재면 「전부 짧게 끊으면 초록」 이 되거나
 * 「전부 오래 기다리면 초록」 이 된다.
 *
 * ── 시계가 아니라 **몇 번 물었나**를 잰다 ─────────────────────────────
 *
 * 처음에는 걸린 ms 로 쟀다. 혼자 돌리면 초록인데 검사 156개를 한꺼번에 돌리면
 * 셋 다 빨개졌다 — 20ms 한 조각이 바쁜 기계에서 수백 ms 로 늘어나기 때문이다.
 * 그러면 잣대가 약속이 아니라 **부하**를 재는 셈이다.
 *
 * 우리가 약속한 것은 「몇 조각을 쓰나」 다. 그 수는 부하와 상관없다. 그래서
 * 물어본 횟수를 센다 — 이 파일이 여러 번 배운 것과 같은 수다(화면 글 대신
 * 서버가 몇 번 불렸나를 세는 것).
 */
{
  const 원래판 = process.platform;
  const 원래죽이기 = process.kill;
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  try {
    const 신호들 = [];
    let 물은수 = 0;
    // 무엇을 물어도 탈 없이 돌아온다 = 그 무리는 끝까지 살아 있다(안 죽는 놈).
    const 안죽는놈 = (pid, 신호) => { 신호들.push(신호); if (신호 === 0) 물은수 += 1; };

    // 1) 못 재는 동기 자리(프로그램이 끝나는 길)는 **모두가 내는 값**이라 짧다.
    //    400ms / 20ms = 스무 조각. 고치기 전에는 6,000 / 20 = 삼백 조각이었다.
    process.kill = 안죽는놈;
    const t0 = Date.now();
    나무죽이기({ pid: 424243, kill() {}, unref() {} }, { 파이프끊기: false, 상한: 6000 });
    const 동기걸림 = Date.now() - t0;
    check('★★★ 못 재는 동기 기다림은 6초를 달라 해도 짧게 끊는다', 물은수 > 0 && 물은수 <= 40,
      `${물은수}번 물음 (고치기 전 300번) · ${동기걸림}ms`);

    // 2) 기다릴 수 있는 자리는 부르는 쪽이 정한 상한을 그대로 쓴다 —
    //    700 / 20 = 서른다섯 조각. 위 스무 조각 바닥보다 많아야 「그대로」 다.
    신호들.length = 0;
    const 동기조각 = 물은수;
    물은수 = 0;
    const t1 = Date.now();
    await 나무죽이기기다려({ pid: 424244, kill() {}, unref() {} }, { 파이프끊기: false, 상한: 700 });
    const 비동기걸림 = Date.now() - t1;
    check('★★ 기다릴 수 있는 판은 부르는 쪽 상한을 그대로 쓴다',
      물은수 > 동기조각 && 물은수 >= 30 && 물은수 <= 40,
      `${물은수}번 물음 (시킨 값 700ms = 35조각 · 동기 바닥은 ${동기조각}조각) · ${비동기걸림}ms`);
    check('  거기서도 곱게 말한 뒤 끊는다 (SIGTERM → SIGKILL)',
      신호들.includes('SIGTERM') && 신호들.includes('SIGKILL'), [...new Set(신호들)].join(','));

    // 3) 그런데 **얌전히 끝난 무리는 기다리지 않는다.** 이게 그 고리가 있는 까닭이다.
    //    (2 만 재면 「늘 상한을 다 쓴다」 는 옛 고장이 그대로 초록이 된다.)
    물은수 = 0;
    process.kill = (pid, 신호) => {
      if (신호 !== 0) return;
      물은수 += 1;
      if (물은수 > 2) { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; }
    };
    const t2 = Date.now();
    await 나무죽이기기다려({ pid: 424245, kill() {}, unref() {} }, { 파이프끊기: false, 상한: 5000 });
    const 얌전히 = Date.now() - t2;
    check('★★★ 얌전히 끝난 무리는 상한을 안 쓰고 곧장 돌아온다', 물은수 <= 6,
      `${물은수}번 물음 (상한 5,000ms = 250조각) · ${얌전히}ms`);
  } finally {
    Object.defineProperty(process, 'platform', { value: 원래판, configurable: true });
    process.kill = 원래죽이기;
  }
}

trace('18-빈-목록에서도-버린-인자를-말한다');

/*
 * ── 목록이 비면 **하던 말까지 사라졌다** (8회차 파일훑기) ────────────────
 *
 * 빈 목록 갈래가 그 자리에서 곧장 돌아서느라 `버린말`·`못읽은말` 이 통째로
 * 빠졌다. 바로 위(1017-1018 머리말)가 「몇 개만 못 알아들은 판도 말해 준다 —
 * 오류로 막지는 않되 버린 이름을 적어 보내서 다음 걸음에서 고쳐 부르게 한다」
 * 고 적어 두었는데, 하필 **일감이 하나도 없을 때**만 그 약속이 안 지켜졌다.
 *
 * 값이 큰 자리다. 일감이 없다는 것은 대개 「끄려던 것이 이미 없다」 거나
 * 「아직 안 띄웠다」 인데, 그때 오타를 알려 주지 않으면 모델은 제 인자가
 * 맞는 줄 알고 같은 오타로 다시 부른다.
 */
{
  비우기();
  const 모르는것 = await JOBS_TOOL.run({ from_start: true, 헛것: 1 });
  check('★★ (8회차) 목록이 비어도 못 알아들어 버린 인자를 말한다',
    /못 알아들어 버린 인자: 헛것/.test(String(모르는것.content ?? 모르는것.error)),
    JSON.stringify(모르는것));
  check('  그래도 목록 갈래는 그대로다 (오류로 막지 않는다)',
    !모르는것.error && /뒤에서 도는 명령이 없습니다/.test(String(모르는것.content)), JSON.stringify(모르는것));

  const 못읽은것 = await JOBS_TOOL.run({ from_start: '아마도' });
  check('★★ (8회차) 목록이 비어도 참·거짓으로 못 읽은 값을 말한다',
    /참·거짓으로 못 읽은 값: from_start="아마도"/.test(String(못읽은것.content ?? 못읽은것.error)),
    JSON.stringify(못읽은것));

  const 그냥 = await JOBS_TOOL.run({});
  check('  아무 인자도 없으면 군말이 안 붙는다',
    String(그냥.content) === '뒤에서 도는 명령이 없습니다.', JSON.stringify(그냥));
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n뒤에서 도는 명령 검사  ${D}(안 뜬 것을 떴다고 안 하는가 · 띄운 것을 거두는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
