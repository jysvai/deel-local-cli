// ESC 를 누르면 진짜로 멈추는가 — **도구 쪽**.
//
// 짝이 되는 파일이 하나 더 있다. abort.test.js 는 모델이 답을 흘려보내는
// 도중에 끊는 것을 잰다(대화가 성한가, 안 돈 도구 자리가 채워지는가).
// 여기는 그 아래층이다 — 도구가 도는 동안 프로그램이 **귀를 열고 있는가**.
// 위층이 아무리 잘 만들어져 있어도 키가 배달이 안 되면 소용이 없다.
//
// ── 왜 이걸 재나 ────────────────────────────────────────────────────────
//
// "ESC 를 눌러도 작업이 안 멈춘다" 는 제보를 받고 코드를 따라가 보니, ESC 가
// 안 먹는 것이 아니라 **ESC 를 받지 못하고 있었다.**
//
//   ▶ Grep(결제)           rg 를 spawnSync 로 부른다 — 최대 20초
//   ◧ Read(보고서.ppt)      soffice 를 spawnSync 로 부른다 — 최대 90초
//   ❋ Glob(**/*.js)        walk() 가 readdirSync 로 20,000개까지 훑는다
//
// 셋 다 **동기**다. 동기 호출이 도는 동안 Node 는 이벤트 루프를 못 돌린다.
// 그러면 `process.stdin` 의 keypress 도 안 불린다 — 사람이 ESC 를 몇 번을
// 눌러도 그 키는 버퍼에만 쌓여 있다가, 동기 호출이 끝난 **뒤에야** 배달된다.
//
// 사람 눈에는 "ESC 가 고장 났다" 로 보인다. 실제로는 프로그램이 그 순간
// 아무 소리도 못 듣는 상태다.
//
// ── 무엇을 어떻게 재나 ──────────────────────────────────────────────────
//
// 진짜 터미널이 없으면 keypress 를 못 만든다. 그래서 **더 아래를** 잰다 —
// 이벤트 루프가 살아 있나. 타이머를 하나 걸어 놓고 도구를 돌린 뒤, 그 타이머가
// 제때 불렸는지 본다. 늦게 불렸으면 그 시간만큼 프로그램이 귀를 닫고 있었다는
// 뜻이고, ESC 도 딱 그만큼 안 들린다.
//
// 실제 rg 나 LibreOffice 를 깔고 재지 않는다. 깔아야만 도는 검사는 아무도 안
// 돌린다. 대신 **일부러 오래 자는 가짜 프로그램**을 세운다 — 재려는 것은
// 검색이 잘 되는지가 아니라 그동안 우리가 귀를 열고 있는가다.
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOLS, runTool } from '../src/tools/index.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

/**
 * 이벤트 루프가 막혀 있던 시간을 잰다.
 *
 * 16ms 뒤에 불리라고 타이머를 걸고 일을 시킨다. 일이 끝난 뒤 타이머가 실제로
 * 언제 불렸는지 보면, 그 차이가 곧 **귀를 닫고 있던 시간**이다.
 */
async function 귀막힌시간(일) {
  let 불린때 = 0;
  const t0 = Date.now();
  const 타이머 = new Promise((r) => setTimeout(() => { 불린때 = Date.now(); r(); }, 16));
  await 일();
  await 타이머;
  return Math.max(0, 불린때 - t0 - 16);
}

/** 일부러 ms 만큼 자는 가짜 프로그램. 이름은 ASCII 로 — cmd.exe 가 내용을 CP949 로 읽는다. */
function 느린프로그램(방, ms) {
  const p = join(방, 'slow-stub.cjs');
  writeFileSync(p, [
    'const end = Date.now() + ' + ms + ';',
    // 일부러 바쁘게 돈다. 자식이 사는 동안 부모가 spawnSync 로 붙들려 있는지가 요점이다.
    'while (Date.now() < end) {}',
    'process.exit(0);',
  ].join('\n'));
  return p;
}

const 판 = (방, extra = {}) => ({
  scope: makeScope(방), history: new History(방), audit: new Audit(방),
  seen: new Set(), 모델컨텍스트: 200000, enc: new Map(), ...extra,
});

trace('1-루프살아있나');

// ── 1. 동기 자식 프로세스가 귀를 막는다 (이 검사가 병의 증거다) ───────
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-abort1-'));
  const 느린것 = 느린프로그램(방, 300);

  const { spawnSync } = await import('node:child_process');
  const 막힌시간 = await 귀막힌시간(async () => {
    spawnSync(process.execPath, [느린것], { encoding: 'utf8', windowsHide: true });
  });

  // 여기는 **일부러 빨개지지 않는다.** 동기 호출이 귀를 막는 것은 Node 의 성질이지
  // 우리 버그가 아니다. 우리 버그는 그 성질을 도구 안에서 쓰고 있던 것이다.
  check('★ 동기 자식 프로세스는 이벤트 루프를 막는다 (병의 뿌리)',
    막힌시간 >= 200, `${막힌시간}ms 동안 아무 소리도 못 들었다`);

  rmSync(방, { recursive: true, force: true });
}

trace('2-멈춘뒤');

// ── 2. 이미 멈췄으면 도구를 시작조차 안 한다 ───────────────────────────
//
// 여럿을 함께 돌릴 때(Promise.all) 앞의 것이 도는 사이 사람이 ESC 를 누르면,
// 뒤의 것들은 **아직 시작도 안 했는데** 그대로 돈다. 시작 전에 한 번 보면 막힌다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-abort2-'));
  writeFileSync(join(방, '가.txt'), '한 줄\n');

  const ac = new AbortController();
  ac.abort();
  const ctx = 판(방, { signal: ac.signal });

  const r = await runTool('Read', { file_path: '가.txt' }, ctx);
  check('★ 멈춘 뒤에는 도구를 시작하지 않는다', !!r.error && /중단/.test(r.error), r.error ?? '(그냥 읽었다)');
  check('중단은 끝난 실패로 표시한다 (되풀이 억제)', r.끝났다 === true, String(r.끝났다));
  // 중단은 실패가 아니다. 감사기록에 실패로 쌓이면 되풀이 감지가 엉뚱하게 걸린다.
  check('중단이라는 것을 결과에 남긴다', r.중단됨 === true, String(r.중단됨));

  rmSync(방, { recursive: true, force: true });
}

trace('3-도는중');

// ── 3. 도는 중에 멈추면 결과를 안 쓴다 ─────────────────────────────────
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-abort3-'));
  writeFileSync(join(방, '나.txt'), '두 줄\n또 한 줄\n');

  const ac = new AbortController();
  const ctx = 판(방, { signal: ac.signal });
  // 도구가 도는 사이에 멈춘다.
  const 일 = runTool('Read', { file_path: '나.txt' }, ctx);
  ac.abort();
  const r = await 일;

  check('★ 도는 중에 멈추면 결과를 안 돌려준다', !!r.error && /중단/.test(r.error),
    r.error ?? (r.content ?? '').slice(0, 40));

  rmSync(방, { recursive: true, force: true });
}

trace('4-훑기');

// ── 4. 파일 훑기도 멈춘다 ──────────────────────────────────────────────
//
// walk() 는 20,000개까지 동기로 훑는다. 사내망 드라이브에서는 이게 몇 초다.
// 중간에 그만두게 하지 않으면, 멈추라고 한 뒤에도 끝까지 다 훑고 나서 멈춘다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-abort4-'));
  for (let i = 0; i < 40; i++) {
    const d = join(방, `d${i}`);
    mkdirSync(d);
    for (let j = 0; j < 20; j++) writeFileSync(join(d, `f${j}.txt`), 'x\n');
  }

  const 다본것 = await TOOLS.Glob.run({ pattern: '**/*.txt' }, 판(방));
  const 다본수 = Number(String(다본것.summary ?? '').match(/(\d+)/)?.[1] ?? 0);
  check('멈추지 않으면 다 훑는다', 다본수 >= 800, `${다본수}개`);

  const ac = new AbortController();
  ac.abort();
  const 끊은것 = await TOOLS.Glob.run({ pattern: '**/*.txt' }, 판(방, { signal: ac.signal }));
  check('★ 멈추라면 훑기도 그만둔다', !!끊은것.error && /중단/.test(끊은것.error),
    끊은것.error ?? 끊은것.summary ?? '');

  rmSync(방, { recursive: true, force: true });
}

trace('5-비동기');

// ── 5. 오래 걸리는 도구가 귀를 막지 않는다 ─────────────────────────────
//
// 여기가 이 검사의 핵심이다. 1번에서 본 대로 spawnSync 는 귀를 막는다.
// 우리 도구는 그걸 쓰면 안 된다 — 오래 도는 동안에도 ESC 가 들려야 한다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-abort5-'));
  const 느린것 = 느린프로그램(방, 300);

  const 막힌시간 = await 귀막힌시간(async () => {
    await runTool('Bash', { command: `"${process.execPath}" "${느린것}"`, timeout: 5000 }, 판(방));
  });
  check('★ 오래 도는 도구가 도는 동안에도 귀가 열려 있다',
    막힌시간 < 150, `${막힌시간}ms 동안 귀가 막혔다 (Bash 는 원래 비동기다 — 기준선)`);

  rmSync(방, { recursive: true, force: true });
}

trace('6-찾기');

// ── 6. Grep 이 도는 동안에도 심장이 뛴다 ───────────────────────────────
//
// 여기가 이번에 고친 자리다. Grep 은 rg(또는 git grep)를 빌려 쓰는데, 전에는
// 그걸 spawnSync 로 불렀다. 큰 저장소에서 20초가 걸리면 그 20초 내내 위 1번과
// 똑같은 상태가 된다 — 프로그램이 귀머거리가 된다.
//
// **시간이 아니라 횟수를 잰다.** "몇 ms 안에 끝나야 한다" 는 검사는 PC 가
// 느린 날 애먼 빨간불을 켠다. 대신 찾기가 도는 **동안** 타이머가 몇 번
// 불렸는지를 센다. 동기로 부르면 이 수는 언제나 0이다 — Node 는 막힌 사이
// 밀린 타이머를 한 번으로 몰아서 나중에 부르기 때문이다. 비동기면 1보다 크다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-abort6-'));
  // rg 가 한 번에 끝내기엔 조금 성가실 만큼은 만든다.
  for (let i = 0; i < 40; i++) {
    const d = join(방, `d${i}`);
    mkdirSync(d);
    for (let j = 0; j < 30; j++) writeFileSync(join(d, `f${j}.js`), `const 바늘 = ${j};\n`.repeat(4));
  }

  let 심장 = 0;
  const 맥 = setInterval(() => { 심장 += 1; }, 4);
  const t0 = Date.now();
  const 찾은것 = await TOOLS.Grep.run({ pattern: '바늘' }, 판(방));
  const 걸린시간 = Date.now() - t0;
  clearInterval(맥);

  // 자릿점을 넣어 준다 — `1,200개 파일`. 세는 말이 i18n/index.js 의 세말()
  // 을 거치면서 toLocaleString() 이 한 자리에서 붙게 됐다. 여기서 `1200`
  // 만 찾으면 화면이 더 읽기 좋아진 것 때문에 검사가 빨개진다.
  check('찾기는 제대로 찾는다 (고치느라 망가뜨리지 않았다)',
    /1,?200|바늘/.test(String(찾은것.summary ?? '') + String(찾은것.content ?? '')) && !찾은것.error,
    찾은것.summary ?? 찾은것.error ?? '');
  check('★ 찾는 동안에도 심장이 뛴다 (동기로 부르면 0이다)',
    심장 >= 2, `${걸린시간}ms 도는 사이 ${심장}번 뛰었다`);

  /*
   * 신호가 **붙어 있는 것**과 **눌린 것**은 다르다.
   *
   * 평소 턴에는 언제나 signal 이 붙어 있다. 여기를 '신호가 있으면 그만둔다' 로
   * 잘못 적으면 오류는 하나도 안 나고, 대신 rg 를 영영 안 쓰게 된다 — 사람 눈에는
   * "요즘 deel 이 느리다" 로만 보인다. 그래서 안 눌린 신호로도 같은 답이
   * 나오는지 본다. 이 PC 에 rg 가 없으면 양쪽 다 예전 길이라 그대로 통과한다.
   */
  const 산신호 = new AbortController();
  const 신호달고 = await TOOLS.Grep.run({ pattern: '바늘' }, 판(방, { signal: 산신호.signal }));
  check('★ 신호가 붙어 있어도 안 눌렀으면 빠른 길을 그대로 쓴다',
    신호달고.summary === 찾은것.summary, `${신호달고.summary} ↔ ${찾은것.summary}`);

  // 멈추라고 하면 자식(rg)을 죽이고 곧바로 돌아온다.
  const ac = new AbortController();
  const t1 = Date.now();
  const 일 = TOOLS.Grep.run({ pattern: '바늘' }, 판(방, { signal: ac.signal }));
  ac.abort();
  const 끊은것 = await 일;
  const 멈추는데 = Date.now() - t1;
  check('★ 찾는 도중에 멈추라면 멈춘다', !!끊은것.error && /중단/.test(끊은것.error),
    `${멈추는데}ms 만에 「${끊은것.error ?? 끊은것.summary}」`);

  rmSync(방, { recursive: true, force: true });
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n멈춤 검사  ${D}(멈추라면 멈추는가 · 멈추는 동안 귀가 열려 있는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
