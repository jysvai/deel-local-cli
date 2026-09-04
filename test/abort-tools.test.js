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
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOLS, runTool } from '../src/tools/index.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { 엔진찾기, 저장소인가 } from '../src/tools/fastgrep.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 건너뜀 = [];

/**
 * 이벤트 루프가 막혀 있던 시간을 잰다.
 *
 * 16ms 뒤에 불리라고 타이머를 걸고 일을 시킨다. 일이 끝난 뒤 타이머가 실제로
 * 언제 불렸는지 보면, 그 차이가 곧 **귀를 닫고 있던 시간**이다.
 */
/**
 * 일이 도는 **내내** 심장을 뛰게 하고, 제일 크게 벌어진 틈을 돌려준다.
 *
 * 전에는 16ms 짜리 타이머를 하나만 걸어 두고 잤다. 그러면 도구가 막히기 **전에**
 * 한 번이라도 양보하는 순간 그 타이머가 울어 버려서, 그 뒤에 300ms 를 통째로
 * 막아도 0ms 로 잰다. 실제로 spawn 앞에 300ms 를 심어 보니 검사가 안 빨개졌다 —
 * ESC 가 들리는지를 지킨다고 적혀 있는 자리가 아무것도 안 지키고 있었다.
 *
 * 심장을 계속 뛰게 하면 막힌 자리가 어디든 그 틈으로 드러난다.
 */
async function 귀막힌시간(일) {
  let 제일큰틈 = 0;
  let 마지막 = Date.now();
  const 심장 = setInterval(() => {
    const 지금 = Date.now();
    제일큰틈 = Math.max(제일큰틈, 지금 - 마지막 - 16);
    마지막 = 지금;
  }, 16);
  마지막 = Date.now();
  try {
    await 일();
  } finally {
    /*
     * 끝나고 한 번 더 잰다. 이걸 빠뜨리면 **끝까지 막고 끝난 것**을 0 으로 읽는다.
     * `await` 뒤는 마이크로태스크라 타이머보다 먼저 도는데, 거기서 심장을 바로
     * 멈추면 막힌 동안 못 뛴 그 틈이 아무 데도 안 적힌 채 사라진다.
     * 1번 단(spawnSync)이 정확히 그래서 0ms 로 나왔다.
     */
    제일큰틈 = Math.max(제일큰틈, Date.now() - 마지막 - 16);
    clearInterval(심장);
  }
  return Math.max(0, 제일큰틈);
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

  /*
   * 세 번 재고 **제일 짧은 것**을 쓴다.
   *
   * 한 번만 재면 세 가지가 한 숫자로 뭉개진다. ① 도구가 진짜로 귀를 막은 것,
   * ② 첫 부름의 몸풀기(모듈 읽기·JIT — 여기서 250ms 씩 나온다), ③ 그 순간 OS 가
   * 우리를 안 깨워 준 것. 전체 판에서 이 자리가 748ms 로 빨개진 적이 있는데
   * 단독으로 재면 19·27·22ms 였다 — ①이 아니었다.
   *
   * 최솟값이면 그 구별이 선다. spawnSync 로 진짜 막히면 **세 번 다** 자식이 사는
   * 만큼(300ms) 막히므로 최솟값도 그대로 크다. 어쩌다 한 번 밀린 것만 걸러진다.
   */
  const 잰것들 = [];
  for (let i = 0; i < 3; i++) {
    잰것들.push(await 귀막힌시간(async () => {
      await runTool('Bash', { command: `"${process.execPath}" "${느린것}"`, timeout: 5000 }, 판(방));
    }));
  }
  const 막힌시간 = Math.min(...잰것들);
  check('★ 오래 도는 도구가 도는 동안에도 귀가 열려 있다',
    막힌시간 < 150,
    `${막힌시간}ms 동안 귀가 막혔다 · 세 번 잼 ${잰것들.join('·')} (Bash 는 원래 비동기다 — 기준선)`);

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
   * "요즘 deel 이 느리다" 로만 보인다.
   *
   * ── 이 검사가 스스로 아무것도 안 지키던 자리 ─────────────────────────
   *
   * 여기 머리말에 「이 PC 에 rg 가 없으면 양쪽 다 예전 길이라 그대로 통과한다」
   * 고 적혀 있었다. 그건 곧 **rg 없는 기계에서는 이 초록이 아무 뜻도 없다**는
   * 뜻이다. 그런데 초록은 똑같이 초록으로 보인다 — 재고 있는 줄 알고 넘어간다.
   *
   * 두 가지로 가른다.
   *   빠른 길이 있는 기계 → 결과가 같기만 한 게 아니라 **그 길을 정말 썼는지**
   *                        까지 본다 (꼬리에 무엇으로 찾았는지 적힌다).
   *   없는 기계           → 초록으로 세지 않고 「못 쟀다」 로 적는다.
   */
  const 산신호 = new AbortController();
  const 신호달고 = await TOOLS.Grep.run({ pattern: '바늘' }, 판(방, { signal: 산신호.signal }));
  /*
   * ── 「이 기계에 있나」 와 「여기서 쓸 수 있나」 는 다른 물음이다 ──────
   *
   * 처음에 `엔진.rg || 엔진.gitgrep` 으로 갈랐다가 리눅스 CI 에서 빨개졌다.
   * `git grep` 은 **저장소 안에서만** 도는데(fastgrep.js 의 저장소인가), 이
   * 검사가 쓰는 자리는 임시 폴더라 저장소가 아니다. 그래서 git 만 있는
   * 기계에서는 「빠른 길이 있다」 고 해 놓고 실제로는 예전 길로 갔고,
   * 「빠른 길을 정말 쓴다」 가 있지도 않은 것을 찾았다.
   *
   * 있나 없나가 아니라 **여기서 쓰이나**를 묻는다.
   */
  const 엔진 = 엔진찾기();
  const 빠른길있나 = !!엔진.rg || (!!엔진.gitgrep && 저장소인가(방));
  if (!빠른길있나) {
    건너뜀.push('rg 가 없고 이 자리는 git 저장소도 아니라 '
      + `「신호가 붙어도 빠른 길을 쓴다」 를 못 쟀다 (${엔진.왜 ?? 'rg 없음'})`);
  } else {
    const 길이름 = /rg 으로 찾았습니다|git 으로 찾았습니다|rg|git/;
    check('★★ 신호가 붙어 있어도 빠른 길을 **정말로** 쓴다',
      길이름.test(String(찾은것.content ?? '') + String(찾은것.summary ?? '')),
      String(찾은것.summary ?? '').slice(0, 80));
    check('★ 신호가 붙어 있어도 답이 달라지지 않는다',
      신호달고.summary === 찾은것.summary, `${신호달고.summary} ↔ ${찾은것.summary}`);
  }

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

/*
 * ── 이미 바꿔 놓은 것은 사실대로 말한다 ─────────────────────────────────
 *
 * 도구가 일을 다 마친 **직후**에 ESC 가 눌리는 자리가 있다. 그때 「중단했습니다」
 * 만 돌려주면 모델은 안 고쳐진 줄 알고 또 고친다 — 같은 편집이 두 번 들어가거나
 * 되돌리기 기록과 어긋난다. 그래서 runTool 은 그 경우 결과를 그대로 실어 준다.
 *
 * 적어 놓기만 하고 안 되고 있었다. 판단을 `isMutating(name)` 으로 했는데,
 * isMutating 은 **셸 명령줄**을 받아 mv·cp·rm 같은 낱말을 찾는 함수다. 거기에
 * 도구 이름을 넣었으니 `Move` 만 우연히 참이고 Write·Edit·Append 는 전부
 * 거짓이었다 — 저 주석이 지키겠다던 도구들이 통째로 빠져 있었다.
 *
 * 그러면 디스크는 바뀌었는데 changed 가 떨어져 나가서, 턴 끝의 파일 목록에도
 * /diff 에도 안 잡힌다. 검사는 내내 초록이었다. 아무도 이 자리를 안 쟀기 때문이다.
 */
trace('7-끊겨도-바꾼-것은-말한다');
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-abort7-'));
  /*
   * 재려는 것은 「이미 끊긴 뒤」 가 아니라 **「일을 다 하고 난 뒤에 끊긴 것」** 이다.
   *
   * runTool 은 시작 전에도 signal 을 본다. 처음부터 끊긴 신호를 주면 거기서
   * 「실행하지 않았습니다」 로 끝나 버려서, 정작 재려던 아래쪽 자리에 닿지도
   * 못한다. 그래서 **처음 한 번만 안 끊긴 척**하는 신호를 만든다 — 도구가
   * 도는 사이에 사람이 ESC 를 누른 것과 같은 모양이다.
   */
  // seen 은 나눠 쓴다 — Edit 은 **먼저 읽은 파일**만 고친다.
  const 본것 = new Set();
  const 성한ctx = () => 판(방, { seen: 본것 });
  const 끊긴ctx = () => {
    let 본횟수 = 0;
    return 판(방, { seen: 본것, signal: { get aborted() { return 본횟수++ > 0; } } });
  };
  const 파일 = (이름) => join(방, 이름);

  // (1) 쓰기 — 다 쓰고 나서 끊긴 자리
  writeFileSync(파일('w.js'), '옛 내용\n', 'utf8');
  const 쓴것 = await runTool('Write', { file_path: 파일('w.js'), content: '새 내용\n' }, 끊긴ctx());
  check('★ 끊겨도 Write 가 바꾼 파일을 말해 준다', !!쓴것.changed,
    JSON.stringify({ changed: 쓴것.changed ?? null, error: 쓴것.error ?? null }).slice(0, 90));
  check('디스크는 실제로 바뀌어 있다', readFileSync(파일('w.js'), 'utf8') === '새 내용\n',
    JSON.stringify(readFileSync(파일('w.js'), 'utf8')));
  check('그러면서 끊겼다는 표시는 남는다', 쓴것.중단됨 === true, String(쓴것.중단됨));

  // (2) 고치기 — 같은 자리. 먼저 읽어 둬야 고칠 수 있다.
  writeFileSync(파일('e.js'), 'const a = 1;\n', 'utf8');
  await runTool('Read', { file_path: 파일('e.js') }, 성한ctx());
  const 고친것 = await runTool('Edit',
    { file_path: 파일('e.js'), old_string: 'const a = 1;', new_string: 'const a = 2;' }, 끊긴ctx());
  check('★ 끊겨도 Edit 이 바꾼 파일을 말해 준다', !!고친것.changed,
    JSON.stringify({ changed: 고친것.changed ?? null, error: 고친것.error ?? null }).slice(0, 90));
  check('그 파일도 실제로 바뀌어 있다', readFileSync(파일('e.js'), 'utf8') === 'const a = 2;\n',
    JSON.stringify(readFileSync(파일('e.js'), 'utf8')));

  // (3) 읽기만 한 것은 버려도 잃을 것이 없다 — 그건 중단으로 끝나야 한다.
  const 읽은것 = await runTool('Read', { file_path: 파일('w.js') }, 끊긴ctx());
  check('읽기만 한 것은 그냥 중단으로 끝난다', !!읽은것.error && 읽은것.끝났다 === true,
    JSON.stringify({ error: 읽은것.error ?? null }).slice(0, 60));

  // (4) 실패한 것도 중단으로 끝난다 — 바꿔 놓은 것이 없다.
  const 실패한것 = await runTool('Edit',
    { file_path: 파일('e.js'), old_string: '없는 글', new_string: 'x' }, 끊긴ctx());
  check('바꾸다 실패한 것은 중단으로 끝난다', !!실패한것.error, (실패한것.error ?? '').slice(0, 50));
}

trace('8-남을-기다리는-자리');
/*
 * ── 남을 기다리는 동안 ESC 가 먹히는가 ──────────────────────────────────
 *
 * 위 일곱 단은 **우리가 도는 동안**을 잰다. 여기는 그 반대다 — 우리는 아무것도
 * 안 하고 남이 답하기를 기다리는 자리. 웹 서버 하나, 남의 프로그램(MCP) 하나.
 *
 * 이 두 자리에는 시한만 있었다. 웹 30초, MCP 60초. 그 사이 ESC 를 누르면
 * 화면에는 「멈추는 중…」 이 뜨는데, 실제로는 시한이 다 찰 때까지 그대로
 * 기다렸다. 사람 눈에는 「ESC 가 또 안 먹는다」 로 보인다 — 제보의 그 갈래다.
 *
 * 그래서 **시간을 잰다.** "멈췄다" 는 말만 보면 시한이 다 차서 끝난 것과
 * 구별이 안 된다. 시한보다 훨씬 짧게 끝나야 사람이 누른 그 키로 끝난 것이다.
 * 시한은 검사에서 짧게 줄여 잡는다 — 30초를 진짜로 기다리는 검사는 아무도
 * 안 돌린다.
 */
{
  const { createServer } = await import('node:http');
  const { webFetch } = await import('../src/tools/webfetch.js');

  // 붙기는 받아 주고 **답은 영영 안 하는** 서버. 안 답하는 상대를 문 상태를 만든다.
  const 벙어리 = createServer(() => { /* 일부러 아무것도 안 한다 */ });
  await new Promise((r) => 벙어리.listen(0, '127.0.0.1', r));
  const 주소 = `http://127.0.0.1:${벙어리.address().port}/`;

  const 끊개 = new AbortController();
  setTimeout(() => 끊개.abort(), 120);
  const 잰다 = Date.now();
  const 웹결과 = await webFetch({ url: 주소 }, { allowPrivate: true, signal: 끊개.signal });
  const 웹걸린시간 = Date.now() - 잰다;

  check('★ ESC 를 누르면 WebFetch 가 곧바로 멈춘다', 웹걸린시간 < 3000, `${웹걸린시간}ms (시한은 30000ms)`);
  check('멈췄다고 말한다 — 남의 서버 잘못으로 안 적는다',
    웹결과?.중단됨 === true && /중단/.test(웹결과?.error ?? ''), JSON.stringify(웹결과).slice(0, 80));

  // 이미 끊긴 신호면 두드리지도 않는다. 멈춘 뒤에 남의 서버에 남기는 발자국은 설명할 길이 없다.
  let 두드린횟수 = 0;
  const 세는서버 = createServer((_, res) => { 두드린횟수++; res.end('ok'); });
  await new Promise((r) => 세는서버.listen(0, '127.0.0.1', r));
  const 세는주소 = `http://127.0.0.1:${세는서버.address().port}/`;
  await webFetch({ url: 세는주소 }, { allowPrivate: true, signal: AbortSignal.abort() });
  check('이미 끊긴 뒤에는 아예 안 나간다', 두드린횟수 === 0, `${두드린횟수}번 두드림`);

  벙어리.close(); 세는서버.close();
}

{
  const { MCP서버 } = await import('../src/backend/mcp.js');
  const 방 = mkdtempSync(join(tmpdir(), 'deel-abort8-'));

  // 인사와 도구 목록에는 답하고, **도구를 부르면 영영 안 답하는** 스텁.
  // 이름은 ASCII 로 둔다 — 자식 프로세스에 넘기는 경로라 인코딩을 안 탄다.
  const 스텁 = join(방, 'silent-mcp.mjs');
  writeFileSync(스텁, [
    "let 남은글 = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (d) => {",
    '  남은글 += d; let i;',
    "  while ((i = 남은글.indexOf('\\n')) >= 0) {",
    '    const 줄 = 남은글.slice(0, i); 남은글 = 남은글.slice(i + 1);',
    '    let j; try { j = JSON.parse(줄); } catch { continue; }',
    "    if (j.method === 'initialize') 답(j.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: '벙어리', version: '1' } });",
    "    else if (j.method === 'tools/list') 답(j.id, { tools: [{ name: '느린것', description: '답 안 함', inputSchema: { type: 'object', properties: {} } }] });",
    '    // tools/call 은 일부러 안 답한다.',
    '  }',
    '});',
    "function 답(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }",
  ].join('\n'), 'utf8');

  const 서버 = new MCP서버({ 이름: '벙어리', command: process.execPath, args: [스텁] });
  const 붙었나 = await 서버.붙기({ timeout: 5000 });
  check('스텁 MCP 서버가 붙는다 (아래 검사의 전제)', 붙었나 === true, String(서버.죽음 ?? ''));

  if (붙었나) {
    const 끊개 = new AbortController();
    setTimeout(() => 끊개.abort(), 120);
    const 잰다 = Date.now();
    let 왜 = '';
    try { await 서버.부르기('느린것', {}, { timeout: 20000, signal: 끊개.signal }); }
    catch (e) { 왜 = e.message; }
    const 걸린시간 = Date.now() - 잰다;

    check('★ ESC 를 누르면 MCP 도구도 곧바로 멈춘다', 걸린시간 < 3000, `${걸린시간}ms (시한은 20000ms)`);
    check('멈춤과 시한 초과를 구별해서 말한다', /중단/.test(왜), 왜.slice(0, 40));
    // 답을 기다리던 자리를 안 치우면, 뒤늦게 온 답이 죽은 약속을 또 푼다.
    check('기다리던 자리를 치운다', 서버.기다리는것.size === 0, `${서버.기다리는것.size}개 남음`);
  }
  서버.닫기();
  rmSync(방, { recursive: true, force: true });
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const Y = '\x1b[33m'; const X = '\x1b[0m';
console.log(`\n멈춤 검사  ${D}(멈추라면 멈추는가 · 멈추는 동안 귀가 열려 있는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
// 못 잰 것은 못 쟀다고 적는다. 조용히 초록으로 세면 이 파일이 무엇을 지키는지
// 아무도 다시 안 본다.
for (const 글 of 건너뜀) console.log(`  ${Y}⚠${X} ${글}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패`
  + (건너뜀.length ? ` · ${Y}${건너뜀.length}개 건너뜀${X}` : '') + '\n');
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
