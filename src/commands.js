// 슬래시 명령. 이름은 Claude Code / Codex 관례에 맞춘다.
import { writeFileSync, existsSync } from 'node:fs';
import { 마지막할당량, 할당량말, 아슬아슬한가 } from './backend/quota.js';
import { 세션요금, 돈셈, 돈말, 어디서온값, 요금적는법 } from './backend/price.js';
import { join } from 'node:path';
import { c, say, rule, pad, mark, width, clip } from './ui/ansi.js';
import { compact } from './agent/compact.js';
import { 바깥인가 } from './safety/runmode.js';
import { load, upsert, 열쇠보관, configPath } from './config.js';
import { 지금상태 as 지금열쇠상태 } from './safety/authcmd.js';
import { 걸음수 } from './agent/budget.js';
import { 제공자고르기 } from './providers/index.js';
import { 종, 알릴만한초 } from './ui/notify.js';
/*
 * 화면 말 표.
 *
 * `옮긴말` 이라는 이름을 하나 더 둔다. `/think` 처리 자리에서 지역 변수
 * `말`(사람이 친 인자)이 이 함수를 가리기 때문이다 — 그 블록 안에서는
 * 화면에 말을 걸 수가 없어서, 여태 그 자리만 한국어가 소스에 박혀 있었다.
 */
import { 말, 말 as 옮긴말, 언어, 언어들, 언어정하기, 언어고르기, 옮긴만큼, 지시말, 지시말정하기, 지시말따로정했나 } from './i18n/index.js';
import { 프로필찾기, 쓸수있나, 연결만들기, 알릴말, 목록보기 } from './agent/models.js';
import { allowTemporarily } from './safety/network.js';
import { chat, 규격이름 } from './backend/adapter.js';
import { 인증서말 } from './backend/clientcert.js';
import { 알림채움, 알림말 } from './backend/retry.js';
import { 프록시고르기, 프록시설정, 프록시비켜가나 } from './backend/proxy.js';
import { 정한셸 } from './tools/shell.js';
import { TOOLS, 영어설명 } from './tools/index.js';
import { 둘러보기, 프로젝트갈래 } from './lsp/servers.js';
import { 지금것들 } from './lsp/client.js';
import { 보고서적기 } from './ui/export.js';
import { loadCommand } from './skills/discover.js';
import { spin } from './ui/spinner.js';
import { 빗금펴기 } from './ui/complete.js';
import { 그림고르기설정, 끔설정, 환경그림, 환경으로껐나 } from './ui/motion.js';
import { 사무실설정, 최소높이, 최소폭 } from './ui/office.js';

/**
 * 설정에 적힌 그림을 화면 쪽에 물린다.
 *
 * 켤 때(repl·oneshot)와 `/motion` 으로 바꿀 때가 **같은 길을 타야** 한다.
 * 갈라 두면 명령으로 바꾼 것이 다음에 켤 때 안 살아나거나 그 반대가 된다.
 *
 * 사무실은 그림 하나가 아니라 화면 아래를 통째로 쓰는 것이라 따로 켠다.
 * '사무실' 을 골랐으면 상자 안 그림은 조용한 돌림표로 돌아간다 — 둘 다
 * 같은 것을 말하므로 나란히 두면 같은 소리를 두 번 하는 셈이다.
 */
export function 적용하기(고른것) {
  const 값 = String(고른것 ?? '기본');
  사무실설정(값 === '사무실');
  그림고르기설정(값 === '사무실' ? '기본' : 값);
  // 환경변수(DEEL_NO_MOTION)는 안 건드린다 — 사람이 직접 넣어 둔 것을 명령이
  // 지워 버리면, 껐다고 믿는 자리에서 그림이 다시 돈다. 설정용 값은 따로 둔다.
  끔설정(값 === '끔');
}

/**
 * `/motion` 이 환경변수에 대해 해야 하는 말. 없으면 빈 배열.
 *
 * 여태 이 자리는 「DEEL_MOTION·DEEL_OFFICE 가 켜져 있으면 그쪽이 이깁니다」
 * 한 줄이 전부였다. 그래서 두 가지를 틀리게 말했다.
 *
 *   · **DEEL_NO_MOTION 을 통째로 안 봤다.** 그게 켜져 있으면 무엇을 골라도
 *     한 칸짜리 돌림표가 도는데, 화면은 「기사로 바꿨습니다 · 그 자리에서
 *     바뀝니다」 라고 말한다. 아무것도 안 바뀐다.
 *   · **모르는 값도 이긴다고 말했다.** `DEEL_MOTION=cat` 은 무시되고 설정
 *     파일이 그대로 쓰이는데, 「환경변수가 이깁니다」 라고 적혔다. 사람은
 *     설정을 바꿔도 소용없다고 믿는다 — 사실은 그 설정이 이기고 있는데.
 */
function 환경이하는말() {
  const 말들 = [];
  const 그림 = 환경그림();
  if (그림?.이김 || process.env.DEEL_OFFICE) 말들.push(c.gray(말('motion.envWins')));
  if (그림 && !그림.이김) 말들.push(c.gray(말('motion.envUnknown', { 값: 그림.값 })));
  if (환경으로껐나()) 말들.push(c.gray(말('motion.envOff')));
  return 말들;
}
import { PROFILES, LEVELS as THINK_LEVELS, normalizeProfile } from './agent/effort.js';
import { 전선붙이기, 전선말 } from './backend/wire.js';
import { scanLocal, toProfiles } from './backend/scan.js';
import { list as listSessions } from './agent/store.js';
import { MODES as WORK_MODES, ORDER as WORK_ORDER, normalize as normWork, get as getWork, canWrite, 보일이름, 보일한줄 } from './agent/modes.js';
import { COMMANDS, 설정남기기 } from './commands/common.js';
import { 딴이름들 } from './cmdnames.js';
import { doPlugin, 미리보기, showSkills, 미리보기끄기 } from './commands/extend.js';
import { help, showLevel, 강조, showThink, showContext, showWork } from './commands/view.js';
import { 갈래명령, 증거명령, 붙여넣기명령, 리뷰명령, 커밋명령, 카드명령, 못박기명령, 배움명령, 바뀐것보기 } from './commands/work.js';
import { 출력상한, 모델급, ctxLength, switchModel } from './commands/model.js';
// 나눠 옮긴 조각의 이름 중 바깥이 이 파일에서 찾는 것 — repl.js 와 검사들이 여기서 가져간다.
export { COMMANDS, 미리보기끄기, 붙여넣기명령 };
const MODES = {
  auto: '자율 — 전부 알아서. 되돌리기가 안전망',
  confirm: '확인 — 되돌릴 수 없는 것만 물어봄',
  strict: '엄격 — 파일 변경·명령 전부 물어봄',
};


/**
 * 이 줄이 명령이 아니라 '경로' 인가.
 *
 * 슬래시로 시작한다고 다 명령은 아니다. `/usr/local/bin` 이나 `/mnt/d/일감`
 * 같은 것을 치면 그동안은 통째로 명령으로 먹혀서 "모르는 명령" 만 나오고
 * 모델에게 닿지도 않았다. 경로를 아예 못 적는 셈이었다.
 *
 * 가르는 기준은 간단하다 — 명령 이름에는 슬래시가 없다.
 * 플러그인 명령도 `/플러그인:이름` 이라 콜론을 쓰지 슬래시를 안 쓴다.
 * 그러니 첫 낱말 안에 슬래시가 또 있으면 그건 경로다.
 */
function 경로처럼보이나(line) {
  const 첫낱말 = line.slice(1).split(/\s+/)[0] ?? '';
  if (첫낱말.includes('/') || 첫낱말.includes('\\')) return true;
  // `/tmp` 처럼 슬래시가 하나뿐이어도, 실제로 있는 자리면 경로로 본다.
  // 딴이름(`/serve` · `/plugins`)도 이름이다. 이 줄이 표 하나만 보던 동안에는
  // `plugins/` 폴더가 있는 저장소에서 `/plugins` 가 경로로 읽혀 명령이 안 돌고
  // 모델에게 그대로 넘어갔다.
  if (첫낱말 && !COMMANDS[첫낱말.toLowerCase()] && !딴이름들[첫낱말.toLowerCase()]) {
    /*
     * **적힌 그대로**도 보고, 앞 슬래시를 뗀 것도 본다.
     *
     * 앞서는 뗀 것만 봤다. 그러면 `/tmp` 가 지금 폴더의 `tmp` 를 찾다 못 찾아,
     * 바로 위 머리글이 적어 둔 그 자리가 한 번도 안 먹었다. 둘 다 보면 여태
     * 되던 것(지금 폴더의 이름)도 그대로 된다.
     */
    const 통째 = line.trim();
    try { if (existsSync(통째) || existsSync(통째.slice(1))) return true; } catch { /* 못 보면 아닌 걸로 */ }
  }
  return false;
}

// 반환: { handled, exit? }  handled=false 면 모델에게 보낸다.

/** /mode 아래에 규칙을 늘어놓는다. 아무것도 안 걸려 있으면 아무 말도 안 한다. */
function 규칙보이기(규칙들) {
  if (!규칙들) return;
  const 있나 = (규칙들.allow?.length ?? 0) + (규칙들.deny?.length ?? 0);
  if (!있나 && !규칙들.정책곳 && !규칙들.탈) return;
  say('');
  say(`  ${c.gray('적어 둔 규칙 — 이건 모드보다 셉니다')}`);
  for (const r of 규칙들.deny ?? []) say(`    ${c.red('✗')} ${c.white(r.원문)}  ${c.gray(r.출처)}`);
  for (const r of 규칙들.allow ?? []) say(`    ${c.green('✓')} ${c.white(r.원문)}  ${c.gray(r.출처)}`);
  if (규칙들.정책곳) say(`    ${c.gray(`관리 정책 ${규칙들.정책곳} — 이 파일은 고칠 수 없습니다`)}`);
  if (규칙들.baseUrl) say(`    ${c.gray(`주소가 정책으로 못박혀 있습니다: ${규칙들.baseUrl}`)}`);
  if (규칙들.offline) say(`    ${c.gray('정책으로 오프라인이 켜져 있습니다 — 끌 수 없습니다')}`);
  if (규칙들.탈) say(`    ${mark.warn} ${c.yellow(규칙들.탈)}`);
}

/*
 * ── 오타에 「혹시 이것」 ─────────────────────────────────────────────────
 *
 * `/hepl` · `/modle` 에는 「모르는 명령」 만 나왔다. 비슷한 것은 이 PC 에서 찾은 명령(스킬·플러그인)
 * 에서만 찾았고 **내장 명령은 안 봤다** — 제일 흔한 오타는 내장 명령에서 난다.
 *
 * 넣기·빼기·바꾸기와 **이웃 두 글자 뒤바꾸기**를 한 번으로 친다. 손가락이 틀리는 모양이 대개
 * 그 넷이다(hepl · modle). 짧은 이름은 한 번까지만 봐준다 — 넷 글자에 두 번을 봐주면 아무
 * 명령이나 비슷해진다.
 */
function 오타거리(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const 다름 = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + 다름);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function 비슷한이름(친것, 이름들) {
  if (!친것) return [];
  const 한도 = 친것.length <= 4 ? 1 : 2;
  return 이름들.map((n) => [n, 오타거리(친것, n.toLowerCase())])
    .filter(([, 거리]) => 거리 <= 한도)
    .sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0]))
    .map(([n]) => n);
}

/** `ext:ReviewCode` 의 꼬리 — 언제나 낮춰서 돌려준다. 찾기와 「비슷한 것」 이 같은 잣대를 쓰게 한다. */
const 꼬리이름 = (이름) => String(이름 ?? '').split(':').pop().toLowerCase();

/*
 * ── 이 PC 에서 찾은 슬래시 명령을 이름으로 찾는다 ───────────────────────
 *
 * 대화 화면(아래 default 갈래)과 배치(oneshot.js)가 **같은 규칙**을 써야 한다. 같은 글자를
 * 쳤는데 창에 따라 되고 안 되면 사람은 어느 쪽을 믿을지 정할 수 없다. 그래서 두 벌로 적지
 * 않고 여기 한 군데에 둔다.
 *
 * 찾는 차례는 셋이다 — 적은 그대로 · 대소문자 무시 · 꼬리 이름.
 * 마지막 칸이 `x.name.split(':').pop() === 낮춘` 이었다 (8회차 그밖 명령2). 왼쪽은 파일에
 * 적힌 그대로고 오른쪽은 낮춘 말이라 둘이 만날 수가 없다. `ext:ReviewCode` 는 `/ReviewCode`
 * 로도 `/reviewcode` 로도 「모르는 명령」 이었고, 「비슷한 것」 에도 안 떴다 — 깔려 있는
 * 명령이 어느 길로도 안 보이는 자리다. 배치에서는 그대로 1 로 선다.
 */
export function 슬래시명령찾기(목록, 부른이름) {
  const 것들 = 목록 ?? [];
  const 낮춘 = String(부른이름 ?? '').toLowerCase();
  return 것들.find((x) => x.name === 부른이름)
    ?? 것들.find((x) => x.name.toLowerCase() === 낮춘)
    ?? 것들.find((x) => 꼬리이름(x.name) === 낮춘)
    ?? null;
}

/** 못 찾았을 때 「비슷한 것」 으로 늘어놓을 것. 찾기와 같은 잣대(낮춘 꼬리)를 쓴다. */
export function 비슷한슬래시명령(목록, 부른이름, 몇 = 5) {
  const 낮춘 = String(부른이름 ?? '').toLowerCase();
  if (!낮춘) return [];
  return (목록 ?? [])
    .filter((x) => x.name.toLowerCase().includes(낮춘) || 낮춘.includes(꼬리이름(x.name)))
    .slice(0, 몇);
}

export async function handle(line, session, ctx) {
  // 일본어·중국어 입력기의 전각 빗금(／help). 그대로 두면 명령이 말이 되어 모델에게 간다(ui/complete.js).
  line = 빗금펴기(line);
  if (!line.startsWith('/')) return { handled: false };
  if (경로처럼보이나(line)) return { handled: false };
  const [raw, ...rest] = line.slice(1).trim().split(/\s+/);
  const name = raw.toLowerCase();
  const arg = rest.join(' ');

  switch (name) {
    case 'help': return help(session), { handled: true };
    // 슬래시만 치고 Enter. 「모르는 명령 /」 은 무엇을 모르는지 알 수 없는 말이다 — 목록을 보인다.
    case '': return help(session), { handled: true };
    case 'level': return showLevel(session, arg), { handled: true };

    /*
     * 종소리 · 창 제목.
     *
     * 끄는 길을 굳이 명령으로 둔 이유가 있다. 사무실에서 소리가 나면 곤란한
     * 사람이 있고, 그런 사람은 알림 자체를 못 쓰게 되는 것이 아니라 **그 자리에서
     * 껐다 켤 수 있어야** 한다. 환경변수만 두면 프로그램을 껐다 켜야 한다.
     */
    /*
     * 화면 말 — 한국어 / English.
     *
     * 코드는 한국어로 둔다. 함수 이름도 변수 이름도 한글이고 그게 이 저장소의
     * 뜻이다. 바꾸는 것은 **화면에 나가는 말**뿐이다.
     *
     * 얼마나 옮겼는지를 숨기지 않고 그대로 적는다. 다 된 척하는 것보다
     * "298개 중 47개는 아직 한국어" 가 낫다 — 그래야 안 옮긴 자리를 봤을 때
     * 사람이 고장으로 안 읽고, 도와줄 사람도 어디를 도울지 안다.
     */
    /*
     * 다른 모델에게 한 번 물어보기.
     *
     * ── 왜 따로 두나 ────────────────────────────────────────────────────
     *
     * 로컬에서는 모델 하나를 골라도 늘 어딘가 아쉽다. 7B 는 계획을 잘 세우는데
     * 파일 열 개를 고치다 창이 차고, 1.5B 는 창은 넉넉한데 무엇을 할지를 못
     * 정한다. 그런데 지금까지는 다른 것에게 물어보려면 /model 로 **갈아타야**
     * 했고, 갈아타면 하던 대화가 그 모델의 것이 된다 — 한마디 물어보자고
     * 판을 통째로 옮기는 셈이었다.
     *
     * ── 무엇을 보내나 ───────────────────────────────────────────────────
     *
     * **친 질문만** 보낸다. 지금 대화를 통째로 딸려 보내지 않는다.
     *
     * 이건 편의가 아니라 경계선 문제다. 대화에는 이 폴더의 소스가 통째로
     * 들어 있는데, 그것이 어느 서버로 가는지는 사람이 정할 일이지 명령 하나가
     * 조용히 정할 일이 아니다. 필요한 배경은 질문에 적으면 된다.
     *
     * 답은 화면에 보여 주고 **대화에도 넣는다.** 안 넣으면 사람이 그 답을
     * 손으로 옮겨 적어야 하는데, 그러면 이건 다른 창에서 물어보는 것과 다를
     * 것이 없다. 다만 누가 한 말인지 표를 달아 넣는다 — 지금 쓰는 모델이
     * 제가 한 말로 착각하면 안 된다.
     */
    case 'consult': {
      const 조각 = String(arg ?? '').trim().split(/\s+/);
      const 이름 = 조각.shift() ?? '';
      const 질문 = 조각.join(' ').trim();
      const 목록 = 목록보기();

      if (!이름) {
        say('');
        rule(말('consult.title'), 70);
        if (!목록.length) {
          say(`  ${c.gray(말('consult.noProfiles'))}`);
        } else {
          for (const p of 목록) {
            const 표 = p.로컬 ? c.hgreen('⌂') : c.hyellow('↗');
            say(`  ${표} ${c.cyan(pad(p.id, 16))} ${c.white(pad(p.model, 26))} ${c.gray(p.어디)}${p.지금 ? c.gray(` ${말('consult.current')}`) : ''}`);
          }
        }
        say('');
        say(`  ${c.gray(말('consult.usage'))}`);
        say(`  ${c.gray(말('consult.questionOnly'))}`);
        say('');
        return { handled: true };
      }

      const 찾음 = 프로필찾기(이름);
      if (!찾음.ok) {
        say(`  ${c.gray(찾음.why)}`);
        if (찾음.후보.length) say(`  ${c.gray(말('consult.candidates'))} ${찾음.후보.map((p) => c.cyan(p.id)).join(c.gray(' · '))}`);
        else if (목록.length) say(`  ${c.gray(말('consult.have'))} ${목록.map((p) => c.cyan(p.id)).join(c.gray(' · '))}`);
        say('');
        return { handled: true };
      }
      const 되나 = 쓸수있나(찾음.prof);
      if (!되나.ok) { say(`  ${c.yellow('!')} ${c.gray(되나.why)}`); say(''); return { handled: true }; }
      if (!질문) {
        say(`  ${c.gray(말('consult.needQuestion', { 이름: 찾음.prof.id }))}`);
        say('');
        return { handled: true };
      }

      const 새conn = 연결만들기(찾음.prof);
      // 물어보러 가는 자리에도 전선 카드를 달아 준다 (backend/wire.js) —
      // 없으면 이 한 번만 생각 칸이 짐작으로 나가고, Opus 5 계열에서는 400 이다.
      전선붙이기(새conn, ctx?.배움);
      /*
       * 대화 이름도 이어받는다.
       *
       * 이건 남에게 한 번 물어보는 것이지 **다른 대화가 아니다.** 안 옮기면
       * 게이트웨이가 이 한 번을 새 대화로 열고, 대시보드에서는 진행 중인
       * 대화와 아무 관계 없는 줄로 떨어져 나간다 — 나중에 「이 답이 어디서
       * 나왔나」 를 따라갈 실이 끊긴다.
       *
       * conn 을 새로 짓는 자리는 언제나 이걸 빠뜨린다. 열쇠받기·vision 을
       * 연결적용()에서 빠뜨렸던 것과 같은 자리다.
       */
      새conn.세션이름 = session.세션이름 ?? null;
      const 알림 = 알릴말(session.conn, 새conn);
      say('');
      say(알림.밖으로
        ? `  ${c.hyellow('↗')} ${c.hyellow(알림.말)} ${c.gray(말('consult.goesOut'))}`
        : `  ${c.hgreen('⌂')} ${c.gray(알림.말)}`);

      // 그 한 번 동안만 연다. 끝나면 반드시 닫는다.
      const 닫기 = 알림.다른자리 ? allowTemporarily(새conn.base) : null;
      let 돌림 = spin(말('consult.asking', { 모델: 새conn.model }));
      let 답 = null;
      let 탈 = null;
      const 잰때 = Date.now();
      try {
        const m = await chat(새conn, {
          messages: [
            { role: 'system', content: 말('consult.system') },
            { role: 'user', content: 질문 },
          ],
          temperature: 0.3,
          // 서버가 잠깐 막으면 돌림표 뒤에 숨기지 않고 말한다 — 왜 오래 걸리는지 보여야 한다.
          onBackoff: (알림) => {
            돌림.stop((알림.미리
              ? `  ${c.yellow('⏸')} ${c.gray(말(알림말(알림), { 초: 알림채움(알림).초 }))}`
              : `  ${c.yellow('↻')} ${c.gray(말('loop.backoff', 알림채움(알림)))}`));
            돌림 = spin(말('consult.asking', { 모델: 새conn.model }));
          },
        });
        답 = String(m?.content ?? '').trim();
      } catch (err) {
        탈 = String(err?.message ?? err);
      } finally {
        돌림.stop();
        try { 닫기?.(); } catch { /* 닫다 터져도 이번 대화는 이어간다 */ }
      }

      if (탈) {
        say(`  ${c.yellow('!')} ${c.gray(말('consult.failed', { 왜: clip(탈, 120) }))}`);
        say('');
        return { handled: true };
      }
      if (!답) {
        say(`  ${c.gray(말('consult.empty'))}`);
        say('');
        return { handled: true };
      }

      const 초 = ((Date.now() - 잰때) / 1000).toFixed(1);
      say(`  ${c.gray('─'.repeat(2))} ${c.gray(`${찾음.prof.id} · ${초}초`)}`);
      say('');
      for (const l of 답.split('\n')) say(`  ${l}`);
      say('');

      /*
       * 대화에 넣을 때 **누가 한 말인지 표를 단다.**
       *
       * 안 달면 지금 쓰는 모델이 제가 아까 한 말로 읽는다. 작은 모델이 대충
       * 답한 것을 제 판단으로 삼아 그 위에 쌓으면, 틀린 자리가 어디서 왔는지
       * 아무도 못 찾는다.
       */
      session.push({
        role: 'user',
        content: `[${찾음.prof.id} (${새conn.model}) 에게 따로 물어본 결과다. 네가 한 말이 아니다.]\n`
          + `물음: ${질문}\n답: ${답}`,
      });
      ctx.audit.tool('Consult', { 프로필: 찾음.prof.id, 모델: 새conn.model, 질문: clip(질문, 200) },
        { summary: `${알림.말} · ${답.length}자` });
      say(`  ${c.gray(말('consult.added'))}`);
      say('');
      return { handled: true };
    }

    case 'lang': {
      /*
       * 두 축이다 — 화면 말, 그리고 **모델에게 시키는 말**.
       *
       *   /lang en       둘 다 영어
       *   /lang ko en    화면은 한국어, 시키는 말만 영어  ← "영어로 시키고 한국어로 받기"
       *   /lang ko auto  다시 하나로 (시키는 말이 화면 말을 따라간다)
       *
       * 굳이 나눈 이유는 값이다. 한글은 글자당 약 1토큰이고 영문은 약 3.6자당
       * 1토큰이라(session.js 의 estimateTokens), 시키는 말만 영어로 돌려도
       * 고정 몫이 눈에 띄게 준다. 작은 창일수록 그 차이가 크다.
       * 답은 그대로 한국어로 온다 — 기본규칙() 이 그 한 줄을 따로 못 박는다.
       */
      const 쪼갠것 = String(arg ?? '').trim().split(/\s+/).filter(Boolean);
      const 값 = 쪼갠것[0] ?? '';
      const 시킬말 = 쪼갠것[1] ?? null;
      const 이름 = (l) => 말(`lang.${l}`);
      if (!값) {
        const p = 옮긴만큼();
        say('');
        say(`  ${c.gray(말('lang.now', { 이름: 이름(언어()) }))}`);
        say(`  ${c.gray(말('lang.promptNow', {
          이름: 지시말따로정했나() ? 이름(지시말()) : 말('lang.follows'),
        }))}`);
        say(`  ${c.gray(말('lang.progress', { 언어: 언어(), 옮김: p.옮김, 전체: p.전체 }))}`);
        if (p.남음) say(`  ${c.gray(말('lang.partial'))}`);
        say(`  ${c.gray(말('lang.codeStays'))}`);
        // 고를 수 있는 말은 언어들 에서 그대로 만든다 — 손으로 적으면 새 말을
        // 넣고 여기를 안 고쳐서, 있는 말이 없는 것처럼 보인다.
        say(`  ${c.gray(말('lang.howto'))} ${언어들.map((l) => c.cyan(`/lang ${l}`)).join(c.gray(' · '))}`);
        /*
         * 예시는 **지금 쓰는 말**로 만든다.
         *
         * 못 박아 두면 일본어 화면에서 "/lang ko en" 을 치라고 하게 되는데,
         * 그대로 치면 화면이 한국어로 바뀐다. 알려 준 대로 했더니 엉뚱한
         * 데로 가는 안내는 없느니만 못하다.
         */
        // 화면이 이미 영어면 「영어로 시키고 …로 받기」가 뜻이 없다.
        // 그때 이 줄을 그대로 내면 "/lang en en" 이라는 헛말이 나온다.
        if (언어() !== 'en') say(`  ${c.gray(말('lang.splitHowto'))} ${c.cyan(`/lang ${언어()} en`)}`);
        say(`  ${c.gray(말('lang.envHint'))}`);
        say('');
        return { handled: true };
      }
      if (!언어고르기(값)) {
        say(`  ${c.gray(말('lang.unknown'))}`);
        say('');
        return { handled: true };
      }
      // 시킬 말을 같이 줬으면 그것부터 본다 — 화면 말만 바꿔 놓고 거절하면
      // 사람이 시킨 것의 절반만 먹은 채로 끝난다.
      if (시킬말 !== null && !지시말정하기(시킬말)) {
        say(`  ${c.gray(말('lang.unknown'))}`);
        say('');
        return { handled: true };
      }
      언어정하기(값);
      const cfg = load();
      cfg.lang = 언어();
      // 따로 안 정했으면 설정에서도 지운다. 남겨 두면 다음에 켤 때
      // 「화면 말을 따라간다」 가 아니라 옛 값이 되살아난다.
      if (지시말따로정했나()) cfg.promptLang = 지시말();
      else delete cfg.promptLang;
      설정남기기(cfg);
      const p = 옮긴만큼();
      say('');
      say(`  ${mark.ok} ${말('lang.changed', { 이름: 이름(언어()) })}`);
      if (지시말() !== 언어()) {
        say(`     ${c.gray(말('lang.promptChanged', { 이름: 이름(지시말()), 답: 이름(언어()) }))}`);
      }
      say(`     ${c.gray(말('lang.progress', { 언어: 언어(), 옮김: p.옮김, 전체: p.전체 }))}`);
      if (p.남음) say(`     ${c.gray(말('lang.partial'))}`);
      say('');
      return { handled: true };
    }

    /*
     * 언어 서버 — 무엇이 깔려 있고, 지금 무엇이 떠 있나.
     *
     * 이 화면이 필요한 이유는 하나다. Def·Refs 는 서버가 없으면 **목록에 아예
     * 안 나온다.** 그러면 사용자 눈에는 "왜 어떤 프로젝트에서는 되고 어떤
     * 데서는 안 되지" 로 보인다. 여기서 그 까닭과 깔 방법을 대신 말해 준다.
     *
     * 대신 **여기서도 안 깔아 준다.** 깔 명령을 글자로 보여 줄 뿐이고,
     * 칠지 말지는 사람이 정한다 (lsp/servers.js 머리말).
     */
    /*
     * 대화 → 보고서 한 장 (ui/export.js).
     *
     * 폐쇄망에는 세션 공유 링크가 없다. 이 자리의 공유는 파일이다 —
     * 결재는 첨부로 돌고, 보고는 한 장으로 한다.
     */
    case 'export': {
      // 못 남긴 까닭을 받아 온다 — 디스크가 찼는지, 폴더가 읽기 전용인지는
      // 화면에 적혀야 손을 쓸 수 있다.
      const 탈 = {};
      // 도움말이 `[파일이름]` 이라고 적어 둔 그 인자. 여기서 안 넘기던 동안에는
      // 무엇을 적어 주든 늘 시각으로 지은 이름이 됐다.
      const 자리 = 보고서적기(ctx.scope.root, session,
        { scope: ctx.scope, audit: ctx.audit, 이름: arg }, 탈);
      say('');
      if (자리) {
        say(`  ${mark.ok} ${말('export.saved')} ${c.white(ctx.scope.show(자리))}`);
        say(`     ${c.gray(말('export.openHint'))}`);
      } else {
        say(`  ${c.red('✗')} ${말('export.failed')}`);
        if (탈.왜) say(`     ${c.gray(clip(탈.왜, 90))}`);
      }
      say('');
      return { handled: true };
    }

    case 'lsp': {
      const 값 = String(arg ?? '').trim().toLowerCase();
      if (값 === 'off' || 값 === '끔' || 값 === '꺼') {
        if (ctx?.lsp) ctx.lsp.켬 = false;
        say('');
        say(`  ${mark.ok} ${말('lsp.diagOff')}`);
        say('');
        return { handled: true };
      }
      if (값 === 'on' || 값 === '켬' || 값 === '켜') {
        if (ctx?.lsp) ctx.lsp.켬 = true;
        say('');
        say(`  ${mark.ok} ${말('lsp.diagOn')}`);
        say('');
        return { handled: true };
      }

      const { 있는것, 없는것 } = 둘러보기();
      const 뿌리것 = ctx?.scope?.root ? await 프로젝트갈래(ctx.scope.root) : null;
      const 떠있는것 = 지금것들();
      say('');
      if (있는것.length) {
        say(`  ${c.hcyan('◈')} ${c.white(말('lsp.found', { 수: 있는것.length }))}`);
        for (const it of 있는것) say(`     ${c.hgreen('✓')} ${c.white(it.갈래.padEnd(5))} ${c.gray(it.이름)}`);
      } else {
        say(`  ${c.gray(말('lsp.none'))}`);
      }
      say('');
      say(`  ${c.gray(말('lsp.thisFolder'))} ${뿌리것 ? c.hcyan(뿌리것.갈래) + c.gray(` · ${말('lsp.fileCount', { 수: 뿌리것.개수 })}`) : c.gray(말('lsp.noneHere'))}`);
      say(`  ${c.gray(말('lsp.tools'))} ${session.lsp ? c.hgreen('Def · Refs') : c.gray(말('lsp.toolsHidden'))}`);
      say(`  ${c.gray(말('lsp.diag'))} ${ctx?.lsp?.켬 === false ? c.gray(말('lsp.stateOff')) : c.hgreen(말('lsp.stateOn'))}`);
      if (떠있는것.length) {
        for (const it of 떠있는것) {
          const 꼴 = it.죽음 ? c.yellow(it.죽음) : (it.준비 ? c.hgreen(말('lsp.ready')) : c.gray(말('lsp.starting')));
          say(`     ${c.gray('·')} ${c.white(it.이름 ?? it.갈래)} ${꼴}`);
        }
      }
      if (없는것.length && !있는것.length) {
        say('');
        say(`  ${c.gray(말('lsp.installHint'))}`);
        for (const it of 없는것.slice(0, 4)) say(`     ${c.gray(`${it.갈래.padEnd(5)} ${it.깔기}`)}`);
        say(`  ${c.gray(말('lsp.neverInstalls'))}`);
      }
      say(`  ${c.gray(말('lsp.howto'))} ${c.cyan('/lsp on')} ${c.gray('·')} ${c.cyan('/lsp off')}`);
      say('');
      return { handled: true };
    }

    /*
     * 이 터미널이 무슨 바이트를 보내나 (repl.js 의 키확인).
     *
     * 줄바꿈이 안 된다는 말은 여러 판째 나왔는데, 그때마다 문서에 "터미널
     * 설정을 바꾸세요" 라고만 적었다. 그건 고친 것이 아니다 — 사람은 제
     * 터미널에서 무엇이 오는지 볼 길이 없었다. 여기서는 짐작 대신 눌러 본다.
     */
    case 'keys': {
      if (typeof ctx?.키확인 !== 'function') {
        say('');
        say(`  ${c.gray('키 확인은 상자 화면에서만 됩니다 (--no-tui 나 파이프에서는 못 씁니다).')}`);
        say('');
        return { handled: true };
      }
      await ctx.키확인();
      return { handled: true };
    }

    case 'bell': {
      const cfg = load();
      const 켜는말 = ['on', '켬', '켜', '켜기', 'y', 'yes', 'ㅇ'];
      const 끄는말 = ['off', '끔', '꺼', '끄기', 'n', 'no', 'ㄴ'];
      const 값 = String(arg ?? '').trim().toLowerCase();
      if (!값) {
        // 지금 세션이 참이다. 설정 파일은 '다음에 켤 때' 값일 뿐이다.
        const 켜져있나 = ctx?.종알림 ? ctx.종알림.켬 !== false : cfg.bell !== false;
        const 상태 = 켜져있나 ? c.hgreen(말('bell.stateOn')) : c.gray(말('bell.stateOff'));
        say('');
        say(`  ${c.gray(말('bell.now', { 상태 }))}`);
        say(`  ${c.gray(말('bell.when', { 초: 알릴만한초 }))}`);
        say(`  ${c.gray(말('bell.title'))}`);
        say(`  ${c.gray(말('bell.howto'))} ${c.cyan('/bell on')} ${c.gray('·')} ${c.cyan('/bell off')}`);
        if (!process.stdout.isTTY && !process.stderr.isTTY) say(`  ${c.gray(말('bell.notATty'))}`);
        say('');
        return { handled: true };
      }
      if (!켜는말.includes(값) && !끄는말.includes(값)) {
        say(`  ${c.gray(말('bell.needOnOff'))}`);
        say('');
        return { handled: true };
      }
      cfg.bell = 켜는말.includes(값);
      설정남기기(cfg);
      // 이 세션에도 바로 먹여야 한다 — 아래 줄이 그렇게 적는다.
      // repl 은 켤 때 읽어 둔 그릇으로 울릴지 말지를 정한다(repl.js 의 알림).
      if (ctx?.종알림) ctx.종알림.켬 = cfg.bell;
      say('');
      say(`  ${mark.ok} ${말(cfg.bell ? 'bell.turnedOn' : 'bell.turnedOff')}`);
      // 켤 때는 한 번 울려 준다. "켰다는데 소리가 나나?" 를 그 자리에서 확인하게.
      if (cfg.bell) { 종(); say(`     ${c.gray(말('bell.justRang'))}`); }
      say(`     ${c.gray(말('bell.appliesNow'))}`);
      say('');
      return { handled: true };
    }
    /*
     * 일하는 동안 뭐가 도나.
     *
     * 예전에는 DEEL_MOTION 과 DEEL_OFFICE 두 환경변수였다. 켜 보려면 터미널을
     * 껐다 켜야 했고, 이름도 둘을 따로 외워야 했다 — 재미로 넣은 것을 켜는 데
     * 그만한 품이 들면 아무도 안 켠다. 명령 하나로 합치고 그 자리에서 바뀐다.
     */
    case 'motion': {
      const cfg = load();
      const 고를것 = [
        { 값: '기본',   별명: ['기본', 'default', 'plain', '돌림표'], 설명: 말('motion.plain') },
        { 값: '기사',   별명: ['기사', 'knight'],                     설명: 말('motion.knight') },
        { 값: '동물',   별명: ['동물', 'animal', 'animals'],          설명: 말('motion.animal') },
        { 값: '사무실', 별명: ['사무실', 'office'],                   설명: 말('motion.office') },
        { 값: '끔',     별명: ['끔', 'off', '꺼', '끄기', 'none'],    설명: 말('motion.off') },
      ];
      const 지금값 = cfg.motion ?? '기본';
      const 값 = String(arg ?? '').trim().toLowerCase();

      if (!값) {
        say('');
        say(`  ${c.gray(말('motion.now'))} ${c.hcyan(지금값)}`);
        say('');
        for (const 것 of 고를것) {
          const 표 = 것.값 === 지금값 ? c.hgreen('●') : c.gray('○');
          // padEnd 가 아니라 pad — 한글은 한 글자가 두 칸이라
          // 글자 수로 채우면 '사무실' 줄만 두 칸 밀린다.
          say(`  ${표} ${c.cyan(pad(`/motion ${것.값}`, 18))} ${c.gray(것.설명)}`);
        }
        say('');
        // 사무실은 화면이 좁거나 낮으면 안 뜬다. 켜 놓고 안 보이면 고장으로
        // 보이므로, 지금 이 터미널이 되는지를 여기서 미리 말해 준다.
        const 줄 = process.stdout.rows ?? 0;
        const 칸 = process.stdout.columns ?? 0;
        if (줄 && 칸 && (줄 < 최소높이 || 칸 < 최소폭)) {
          say(`  ${c.yellow(mark.warn)} ${c.gray(말('motion.tooSmall', { 줄, 칸, 최소줄: 최소높이, 최소칸: 최소폭 }))}`);
          say('');
        }
        const 환경말 = 환경이하는말();
        if (환경말.length) { for (const 줄 of 환경말) say(`  ${줄}`); say(''); }
        return { handled: true };
      }

      const 고른것 = 고를것.find((것) => 것.별명.includes(값));
      if (!고른것) {
        say('');
        say(`  ${c.gray(말('motion.unknown', { 값: arg }))}`);
        say(`  ${c.gray(말('motion.pickOne'))} ${고를것.map((것) => c.cyan(것.값)).join(c.gray(' · '))}`);
        say('');
        return { handled: true };
      }

      cfg.motion = 고른것.값;
      설정남기기(cfg);
      적용하기(cfg.motion);

      say('');
      say(`  ${mark.ok} ${말('motion.set', { 것: 고른것.값 })} ${c.gray('— ' + 고른것.설명)}`);
      // 사무실을 골랐는데 이 터미널이 작으면 아무 일도 안 일어난 것처럼 보인다.
      // 켰다고 말해 놓고 안 보이면 그게 고장이다. 그래서 그 자리에서 말한다.
      if (고른것.값 === '사무실') {
        const 줄 = process.stdout.rows ?? 0;
        const 칸 = process.stdout.columns ?? 0;
        if (줄 && 칸 && (줄 < 최소높이 || 칸 < 최소폭)) {
          say(`     ${c.yellow(mark.warn)} ${c.gray(말('motion.tooSmall', { 줄, 칸, 최소줄: 최소높이, 최소칸: 최소폭 }))}`);
        }
        /*
         * 맥 기본 터미널에서 방이 갈라져 보이는 것은 우리가 못 고친다.
         *
         * 방은 한 칸에 픽셀 둘을 넣는다 — 위는 글자색, 아래는 배경색, 글자는
         * 반칸(▀). 그런데 기본 터미널은 줄 간격이 1.0 보다 넓게 잡혀 있어서
         * 칸과 칸 사이에 빈 띠가 남는다. 색이 꽉 차야 할 자리에 가로줄이
         * 그어지는 것이 그 모습이다. 우리가 무엇을 보내든 그 틈은 안 메워진다.
         *
         * 그래서 고치는 자리를 알려 준다. iTerm2 에서 멀쩡한 것도 같은 이유다 —
         * 거기는 줄 간격이 기본 1.0 이다.
         */
        if (process.env.TERM_PROGRAM === 'Apple_Terminal') {
          say(`     ${c.yellow(mark.warn)} ${c.gray(말('motion.appleTerminal'))}`);
        }
      }
      for (const 줄 of 환경이하는말()) say(`     ${c.yellow(mark.warn)} ${줄}`);
      /*
       * 「그 자리에서 바뀝니다」 는 **정말로 바뀔 때만** 적는다.
       *
       * DEEL_NO_MOTION 이 켜져 있으면 무엇을 골라도 한 칸짜리 돌림표가 돈다.
       * 그런데 이 자리는 그걸 안 보고 늘 「바뀝니다」 를 적고 있었다. 바로
       * 위에서 사무실이 작은 터미널에 안 뜬다고 굳이 말해 주는 것과 같은
       * 까닭인데(「켰다고 말해 놓고 안 보이면 그게 고장이다」), 정작 같은
       * 일이 환경변수로 일어날 때는 아무 말도 안 했다.
       */
      if (!환경으로껐나()) say(`     ${c.gray(말('motion.appliesNow'))}`);
      say('');
      return { handled: true };
    }

    case 'exit':
    case 'quit': return { handled: true, exit: true };

    case 'clear':
      session.clear();
      say(`  ${mark.ok} 대화를 비웠습니다. 규칙과 연결은 그대로입니다.`);
      say('');
      return { handled: true };

    case 'context': return showContext(session), { handled: true };

    case 'ctx': return await ctxLength(session, arg), { handled: true };

    // 모델 급. /ctx 와 헷갈리기 쉬워 설명에서 못을 박는다 —
    // /ctx 는 '얼마나 담나', /grade 는 '얼마나 알아서 하나' 다.
    case 'grade': case '급': return 모델급(session, arg), { handled: true };

    // 한 번에 받을 답 길이. 컨텍스트(/ctx)와는 다른 축이라 명령을 따로 둔다 —
    // /ctx out 안에 숨겨 두니 아무도 못 찾았고, 정작 큰 파일이 안 만들어지는 원인이었다.
    case 'out': case '출력': return await 출력상한(session, arg), { handled: true };

    case 'compact': {
      let s = spin('앞선 대화를 요약해 접는 중…');
      const r = await compact(session, {
        onBackoff: (알림) => {
          s.stop((알림.미리
              ? `  ${c.yellow('⏸')} ${c.gray(말(알림말(알림), { 초: 알림채움(알림).초 }))}`
              : `  ${c.yellow('↻')} ${c.gray(말('loop.backoff', 알림채움(알림)))}`));
          s = spin('앞선 대화를 요약해 접는 중…');
        },
      });
      if (!r.ok) {
        s.stop(`  ${c.gray(r.why ?? '접지 못했습니다.')}`);
        say('');
        return { handled: true };
      }
      const 줄인 = r.before - r.after;
      // 요약을 못 받고 잘라 낸 것을 「✓ 요약으로 접었습니다」 로 먼저 적지 않는다 (repl.js 의 compacted).
      s.stop(r.fallback
        ? `  ${mark.warn} 요약을 못 받아 옛 대화 ${r.folded}개를 잘라 냈습니다.`
        : `  ${mark.ok} 대화 ${r.folded}개를 요약으로 접었습니다.`);
      say(`     ${c.gray(r.before.toLocaleString())} ${c.gray('→')} ${c.white(r.after.toLocaleString())} ${c.gray('토큰')}  ${c.green(`${Math.round((줄인 / Math.max(1, r.before)) * 100)}% 줄어듦`)}`);
      if (r.fallback) say(`     ${c.yellow(clip(String(r.why ?? '요약을 못 받아 그냥 줄였습니다.'), 100))}`);
      else if (r.summary) {
        say('');
        for (const line of r.summary.split('\n').slice(0, 14)) say(`     ${c.gray(clip(line, 76))}`);
      }
      say('');
      return { handled: true };
    }

    case 'model':
      // `/model 카드` 는 모델을 바꾸는 게 아니라 이 모델을 겪어 본 결과를 본다.
      if (/^(카드|card)$/i.test(String(arg ?? '').trim())) return 카드명령(session, ctx), { handled: true };
      return await switchModel(session, ctx, arg), { handled: true };

    /*
     * /think — '얼마나 생각하나' 하나만 정한다.
     *
     * 전에는 한 명령이 두 축을 맡았다. `/think high` 는 강도(5단계)를 정하고
     * `/think save` 는 배분(3가지)을 정했다 — 같은 이름으로 다른 것을 정하니
     * 화면을 봐도 지금 무엇이 무엇인지 읽히지 않았다. 게다가 부를 때마다
     * 단계표가 통째로 펼쳐졌고, 그 표의 '출력상한' 칸 세 줄은 늘 같은 값이었다.
     *
     * 그래서 갈랐다.
     *   /think high      강도
     *   /think 배분 절약  단계별 배분
     *   /think 자세히     단계표
     *   /out             출력 상한 (아예 다른 축이라 명령을 따로 뺐다)
     *
     * 옛 이름(/think save)도 그대로 받는다. 쓰던 사람의 손버릇을 깨지 않는다.
     */
    case 'think': {
      const 말 = String(arg ?? '').trim();
      // 낱말 끝을 \b 로 잡으면 안 된다. \b 는 \w(=[A-Za-z0-9_])를 기준으로 하는데
      // 한글은 \w 가 아니다 — '배분 절약' 의 '분' 과 공백은 **둘 다 비낱말**이라
      // 그 사이에 경계가 없다. 그래서 `/^배분\b/` 는 영영 안 맞았고,
      // /think 배분 … 은 통째로 죽은 명령이었다(영어 prof 만 먹혔다).
      // 공백이나 줄 끝으로 직접 끊는다.
      const 배분말 = /^(배분|profile|prof)(\s|$)/.test(말) ? 말.replace(/^(배분|profile|prof)\s*/, '') : null;

      if (배분말 !== null) {
        const p = normalizeProfile(배분말);
        if (!p) {
          say(`  ${c.gray('배분')}  ${Object.entries(PROFILES).map(([k, v]) => `${k}(${v.name})`).join(' · ')}`);
          say(`  ${c.gray('예')} ${c.cyan('/think 배분 절약')}`);
          say('');
          return { handled: true };
        }
        session.effort = p;
        session.effortSet = true;   // 사용자가 직접 정했다 — 작업 모드보다 우선한다
        say(`  ${mark.ok} 배분 ${c.bold(PROFILES[p].name)} ${c.gray('— ' + PROFILES[p].desc)}`);
        showThink(session);
        return { handled: true };
      }

      if (/^(자세히|detail|-v)$/.test(말)) { showThink(session, { 자세히: true }); return { handled: true }; }

      /*
       * ── /think auto — 시킨 말에 맞춰 강도를 고를까 ──────────────────
       *
       * 켜면 사람이 정한 값은 **천장**이 된다. 「안녕」 한 마디에 max 로
       * 생각하지 않고, 진짜 일에는 천장까지 쓴다. 대화가 쌓인 뒤에는
       * 안 움직인다 — 그때는 강도를 바꾸는 값(캐시가 깨진다)이 아끼는
       * 값보다 크기 때문이다 (agent/effort.js).
       */
      if (/^(auto|자동)(\s|$)/.test(말)) {
        const 값 = 말.replace(/^(auto|자동)\s*/, '').trim().toLowerCase();
        // `켬` 도 켜는 말이다. /bell 은 받는데 여기만 빠져 있어서, `/think auto 켬`
        // 이 **끄는** 명령이 됐다 — 켜려고 친 말로 꺼지고 화면은 「껐습니다」 였다.
        const 켤까 = 값 === '' ? session.autoThink === false : /^(on|켬|켜|켜기|true|y|yes|ㅇ)$/.test(값);
        session.autoThink = 켤까;
        say(`  ${mark.ok} ${옮긴말(켤까 ? 'think.autoOn' : 'think.autoOff')}`);
        showThink(session);
        return { handled: true };
      }

      // 옛 이름 — /think save 처럼 배분 이름을 바로 친 경우.
      const asProfile = normalizeProfile(말);
      if (asProfile) {
        session.effort = asProfile;
        session.effortSet = true;
        say(`  ${mark.ok} 배분 ${c.bold(PROFILES[asProfile].name)} ${c.gray('— ' + PROFILES[asProfile].desc)}`);
        say(`     ${c.gray('이제')} ${c.cyan('/think 배분 ' + PROFILES[asProfile].name)} ${c.gray('로도 됩니다 — 강도와 헷갈리지 않게 갈랐습니다.')}`);
        showThink(session);
        return { handled: true };
      }

      if (!THINK_LEVELS.includes(말)) {
        // 못 알아들은 값은 못 알아들었다고 먼저 말한다. 안 그러면 `/think hgih`
        // 가 오류 없이 표만 띄워서, 강도를 올린 줄 알고 그대로 쓰게 된다.
        if (말) {
          say('');
          say(`  ${mark.no} ${c.gray(옮긴말('think.unknown', { 값: 말 }))}`);
        }
        showThink(session);
        return { handled: true };
      }
      session.think = 말;
      session.thinkSet = true;      // 사용자가 직접 정했다 — 작업 모드보다 우선한다
      // 여기는 지역 변수 `말`(사람이 친 인자)이 i18n 의 말() 을 가리는 자리라,
      // 여태 이 두 줄만 한국어가 소스에 박혀 있었다. 옮긴말 로 부른다.
      say(`  ${mark.ok} ${옮긴말('think.effort')} ${c.bold(말)}`);
      if (!session.conn.think && 말 !== 'off') {
        say(`     ${c.yellow(옮긴말('think.nomodel'))} ${c.gray(옮긴말('think.nomodel.note'))}`);
      }
      showThink(session);
      return { handled: true };
    }

    /*
     * /mode — 무엇을 물어보고 무엇을 그냥 할지.
     *
     * 목록을 그릴 때 **지금 것을 표시로 찍는다.** 전에는 '지금 auto' 라고 한 줄
     * 적고 아래에 셋을 나란히 늘어놨는데, 그러면 어느 것이 켜져 있는지 두 군데를
     * 견줘 봐야 안다. 내 파일이 물어보고 바뀌는지 아닌지는 흘깃 봐서 알아야 한다.
     */
    case 'mode': {
      const { 승인, 차례: 승인차례, 표시: 승인표시 } = await import('./ui/approve.js');
      /*
       * 표에 **제 것으로 있는** 이름만 받는다.
       *
       * `MODES[arg]` 는 물려받은 열쇠에도 참이다. `/mode constructor` 를
       * 치면 목록으로 안 빠지고 그대로 session.mode 에 들어가는데, 그 값은
       * strict 도 confirm 도 아니라 **아무것도 안 물어보는** 상태가 된다
       * (agent/loop.js 의 needsOk). 화면에는 `엄격 → undefined` 가 찍힌다.
       * `--work` 오타가 가장 센 모드로 돌던 것과 같은 자리다.
       */
      // 대소문자는 안 가린다. `/mode AUTO` 가 목록만 보이고 안 바뀌면 사람은 먹은 줄 안다.
      const 승인이름 = arg.trim().toLowerCase();
      if (!Object.hasOwn(MODES, 승인이름)) {
        rule('승인 방식 — 무엇을 물어볼까', 70);
        for (const k of 승인차례) {
          const 지금 = k === session.mode;
          const m = 승인[k];
          say(`  ${지금 ? c.hgreen('●') : c.gray('○')} ${승인표시(k)}${c.gray(pad('', Math.max(1, 14 - width(m.이름))))}`
            + `${c.gray(pad('/mode ' + k, 15))} ${지금 ? c.white(m.한줄) : c.gray(m.한줄)}`);
        }
        say('');
        say(`  ${c.gray('지금은')} ${승인표시(session.mode)} ${c.gray('입니다. 상태줄 오른쪽에도 늘 떠 있습니다.')}`);
        say(`  ${c.gray('치지 않고 바꾸려면')} ${c.cyan('Shift+Tab')} ${c.gray('— 누를 때마다 차례로 돕니다.')}`);
        /*
         * 적어 둔 규칙은 모드보다 세다. 그러니 모드만 보여 주고 규칙을 안 보여
         * 주면 화면이 거짓말을 하는 셈이다 — "안 묻습니다" 라고 적힌 모드에서
         * 무언가 막히면 사람은 고장으로 읽는다.
         *
         * 어디에 적힌 규칙인지까지 적는다. 설정이면 제가 고치면 되고, 관리
         * 정책이면 고칠 수 없다는 것을 알아야 관리자에게 말할 수 있다.
         */
        규칙보이기(ctx.규칙들);
        say('');
        return { handled: true };
      }
      const 앞 = session.mode;
      session.mode = 승인이름;
      const m = 승인[승인이름];
      say('');
      say(`  ${mark.ok} ${승인표시(앞)} ${c.gray('→')} ${승인표시(승인이름)}`);
      say(`     ${c.gray(m.한줄)}`);
      // 안 묻는 쪽으로 옮길 때만 안전망을 짚어 준다. 반대로 갈 때는 안 짚는다 —
      // 조심하는 쪽으로 가는 사람에게 경고를 붙일 이유가 없다.
      if (승인이름 === 'auto' && 앞 !== 'auto') {
        say(`     ${c.gray('되돌리려면')} ${c.cyan('/undo')}${c.gray(', 무엇이 바뀌었는지는')} ${c.cyan('/diff')}`);
      }
      say('');
      return { handled: true };
    }

    /*
     * 되돌리기 — 파일과 **대화를 같이** 되감는다.
     *
     * 전에는 파일만 되돌렸다. 대화에는 "src/runner.js 를 고쳤습니다" 가 그대로
     * 남아 있어서, 그다음 턴에 모델은 이미 고쳐 놓은 줄 알고 그 위에 이어
     * 일했다 — 없는 코드를 고치려 들고, 없는 함수를 부른다. 사람 눈에는 모델이
     * 헛소리하는 것으로 보이지만, 사실은 우리가 모델에게 거짓말을 남겨 둔 것이다.
     *
     * 세 군데를 같이 맞춰야 한 벌이 된다 — 오간 말, 적어 둔 파일(--resume 이
     * 이어 여는 자리), 그리고 /diff 가 세는 '바뀐 파일'. 하나라도 빠지면
     * 되돌린 것이 다음 순간 되살아난다.
     */
    case 'undo': {
      /*
       * 못 읽는 인자로 **말없이 한 턴을 되돌리지 않는다.**
       *
       * parseInt 는 `다섯`·`abc` 를 NaN, `-2` 를 음수로 준다. 앞서는 둘 다
       * 1 로 깎아서, 다섯 턴을 되돌리려던 사람이 한 턴만 되돌아간 화면을
       * 봤다. 되돌리기는 **파일을 실제로 되돌리는** 명령이라 잘못 읽은 수로
       * 도는 값이 다른 명령보다 비싸다. /work 가 오타를 먼저 말하는 것과
       * 같은 잣대다.
       */
      // 전각 숫자(３)는 보통 숫자로 편다 — 일본어·중국어 입력기는 번호를 이렇게 낸다. 목록 번호(pick)는
      // 이미 펴서 읽는데 여기만 「숫자로 적어 주세요」 로 돌려보냈다(4회차 이월).
      const 준말 = String(arg ?? '').trim().replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
      if (준말 && !/^[0-9]+$/.test(준말)) {
        say(`  ${mark.no} ${c.gray('몇 턴을 되돌릴지 숫자로 적어 주세요.')} ${c.cyan('/undo 3')}`);
        say(`  ${c.gray('그냥')} ${c.cyan('/undo')} ${c.gray('만 치면 한 턴을 되돌립니다.')}`);
        say('');
        return { handled: true };
      }
      /*
       * `/undo 0` 은 되돌릴 것이 없다는 말이다. 여태 아래 `|| 1` 에 걸려 **한 턴을 말없이 되돌렸다** —
       * 파일을 실제로 되돌리는 명령이라, 친 수보다 많이 도는 것이 가장 비싸다(위 머리말과 같은 잣대).
       */
      if (준말 && parseInt(준말, 10) === 0) {
        say(`  ${c.gray('0 턴이라 아무것도 되돌리지 않았습니다.')} ${c.cyan('/undo 1')} ${c.gray('처럼 1 이상을 적어 주세요.')}`);
        say('');
        return { handled: true };
      }
      const n = Math.max(1, parseInt(준말, 10) || 1);
      const r = ctx.history.undo(n);
      /*
       * 세는 수는 **진짜로 되돌아간 것**이다.
       *
       * 전에는 restored.length 를 그대로 썼다. 그 배열에는 못 되돌린 것과
       * 손대지 않은 것(바이너리처럼 내용을 못 떠 둔 파일)까지 들어 있어서,
       * 하나도 못 되돌린 판에도 「파일 2개를 되돌렸습니다」 가 나올 수 있었다.
       * 감사기록에도 그 부풀린 수가 그대로 남았다.
       */
      const 되돌린수 = r.되돌린수 ?? r.restored.length;
      ctx.audit.undo({ turns: r.turns, files: 되돌린수 });
      /*
       * **하나도 안 되돌아갔으면** 되돌렸다고 하지 않는다.
       *
       * restored 에는 못 되돌린 것과 손대지 않은 것(바이너리처럼 내용을 못
       * 떠 둔 파일)도 들어 있다. 그 길이만 보면, 되돌아간 파일이 0개인
       * 판에도 `✓ … 파일 0개를 되돌렸습니다` 를 찍고 그 밑에 못 되돌린
       * 파일 목록을 성공 목록처럼 늘어놓았다.
       */
      if (!되돌린수) {
        /*
         * ── 턴이 있었는데 **하나도 안 돌아간** 것과 되돌릴 턴이 없는 것은 다른 말이다 (6회차 Gemini 되돌림명령6q R2·R3) ──
         *
         * 여기는 「되돌릴 것이 없습니다.」 한 줄과 실패 수만 찍고 돌아갔다. 옮긴 그림만 있던 턴처럼 기록은 있었는데
         * 전부 그대로 두었거나 실패한 판에서, 사람은 턴이 없었던 줄 알았고 왜 안 돌아왔는지(그대로 둔 까닭 · 실패 까닭)도
         * 못 봤다. 아래 이력 줄임 경고도 이 갈래를 못 지나갔다.
         */
        const 남긴것 = r.restored ?? [];
        if (!r.turns) say(`  ${c.gray(말('undo.nothing'))}`);
        else if (!남긴것.length) {
          /*
           * ── 턴을 **먹고도** 「되돌릴 것이 없습니다」 라고 하지 않는다 (8회차 그밖 한번더) ──
           *
           * 만들어 둔 파일을 사람이 손으로 지운 턴이 이 자리로 온다. undo() 는 되돌릴 것을
           * 하나도 못 찾지만 그 턴을 **이력에서는 지운다.** 그런데 화면은 턴이 아예 없을 때와
           * 똑같이 「되돌릴 것이 없습니다.」 한 줄이었다. 사람은 아무 일도 안 난 줄 알고 /undo
           * 를 한 번 더 치고, 그러면 그 **앞 턴**이 되돌아간다 — 두 번 쳐서 한 턴만 돌아가고
           * 사이의 턴은 말없이 사라진 것이다. 재 보니 그대로였다(첫 /undo 뒤 turns 가 둘에서
           * 하나로 줄고, 둘째 /undo 가 그 앞 턴의 파일을 되돌렸다).
           */
          say(`  ${mark.warn} ${c.gray(`${r.turns}개 턴을 봤지만 되돌릴 것이 하나도 없었습니다.`)}`);
          if (r.이력줄임?.ok !== false) {
            say(`    ${c.gray('그 턴은 되돌리기 기록에서 빠졌습니다 — 여기서')} ${c.cyan('/undo')} ${c.gray('를 또 치면 그 앞 턴이 되돌아갑니다.')}`);
          }
        } else {
          say(`  ${mark.warn} ${c.gray(`${r.turns}개 턴을 봤지만 되돌아간 파일은 없습니다 — 아래는 그대로 두었거나 못 되돌린 것입니다.`)}`);
          for (const f of 남긴것) say(`    ${c.gray(ctx.scope.show(f.path))}  ${c.gray(f.how)}`);
        }
        if (r.못한것?.length) say(`  ${mark.warn} ${말('undo.failed', { n: r.못한것.length })}`);
        if (r.이력줄임 && r.이력줄임.ok === false) say(`  ${mark.warn} ${c.gray('되돌리기 기록을 못 지웠습니다')} ${c.gray(`— ${r.이력줄임.왜}`)}`);
        say('');
        return { handled: true };
      }
      say(`  ${mark.ok} ${말('undo.done', { turns: r.turns, files: 되돌린수 })}`);
      for (const f of r.restored) say(`    ${c.gray(ctx.scope.show(f.path))}  ${c.gray(f.how)}`);
      // 못 되돌린 것이 있으면 그것만 따로 못 박는다. 위 목록에 섞여 있으면 안 읽힌다.
      if (r.못한것?.length) {
        say(`  ${mark.warn} ${말('undo.failed', { n: r.못한것.length })}`);
      }

      // /diff 가 세던 것에서도 뺀다. 되돌린 파일이 '바뀐 파일' 로 남아 있으면
      // 사람도 되돌아간 줄 모른다. **되돌아간 것만** 뺀다 — 못 되돌린 파일을
      // 여기서 빼면 진짜로 바뀌어 있는 파일이 /diff 에서도 사라진다.
      for (const f of r.restored) if (f.ok === true) session.changes.delete(f.path);
      /*
       * ── 되돌리기는 됐는데 **이력을 못 지웠으면** 그것도 말한다 ──────────
       *
       * 파일은 이미 되돌아가 있다. 그런데 그 턴이 이력에 그대로 남으면,
       * 사람이 /undo 를 한 번 더 쳤을 때 **같은 턴**이 또 되돌아간다.
       * 두 턴을 되돌린 줄 알지만 한 턴이다 (safety/undo.js 의 이력줄임).
       */
      if (r.이력줄임 && r.이력줄임.ok === false) {
        say(`  ${mark.warn} ${c.gray('파일은 되돌렸지만 되돌리기 기록을 못 지웠습니다')} ${c.gray(`— ${r.이력줄임.왜}`)}`);
        say(`    ${c.gray('그래서 이 턴이 기록에 그대로 남아 있습니다. 여기서')} ${c.cyan('/undo')} ${c.gray('를 또 치면 같은 턴을 또 되돌립니다.')}`);
      }
      /*
       * 깨진 줄은 **되돌릴 수 없는 파일**이다.
       *
       * 이력 한 줄이 곧 한 파일의 원문이라, 줄이 깨졌다는 것은 그 파일을
       * 되돌릴 길이 사라졌다는 뜻이다. 안 말하면 「파일 3개를 되돌렸습니다」
       * 만 남고 넷째가 왜 안 돌아왔는지는 아무 데도 안 적힌다.
       */
      if (r.깨진줄) {
        say(`  ${mark.warn} ${c.gray(`되돌리기 기록에서 ${r.깨진줄}줄을 못 읽었습니다 — 그 줄에 걸린 파일은 되돌릴 길이 없습니다.`)}`);
      }

      // 상태줄의 '되돌릴 턴' 도 여기서 줄여 준다. 안 줄이면 방금 되돌린 것을
      // 아직 되돌릴 수 있는 것처럼 세고 있게 된다.
      /*
       * 못 세면 **모른다고 말한다.** 그냥 두면 방금 되돌린 턴이 상태줄에
       * 그대로 남아, 아직 되돌릴 수 있는 것처럼 보인다 (repl.js 에서 같은
       * 자리를 이미 고쳤다 — 안전망 숫자가 조용히 틀리면 안 된다).
       */
      try { session.되돌릴턴 = ctx.history.turns().length; }
      catch (e) {
        session.되돌릴턴 = null;
        say(`  ${mark.warn} ${c.gray(`되돌릴 턴이 몇 개 남았는지 못 셌습니다 — ${e?.message ?? e}`)}`);
      }

      const 되감음 = session.되감기(r.turnIds ?? []);
      if (되감음.걷은것) {
        say(`    ${c.gray(말('undo.alsoTalk', { n: 되감음.걷은것 }))}`);
        if (되감음.고친것) say(`    ${c.gray(말('undo.repaired', { n: 되감음.고친것 }))}`);
        try { ctx?.갈래?.현재store?.()?.replace(session.messages, `되돌리기 — ${r.turns}개 턴`); }
        catch { /* 적어 두지 못해도 이번 대화는 이어진다 */ }
        if (되감음.사람말) {
          const 한줄 = 되감음.사람말.replace(/\s+/g, ' ').trim();
          say(`    ${c.gray(말('undo.saidWas'))} ${c.cyan(한줄.length > 60 ? `${한줄.slice(0, 60)}…` : 한줄)}`);
        }
        /*
         * ── 걷은 턴과 **못 걷은** 턴이 섞이면 둘 다 말한다 ──────────────────
         *
         * `/undo 2` 에서 앞 턴은 요약에 접혀 자리표가 없고 뒤 턴만 살아 있으면,
         * 파일은 둘 다 되돌아가도 말은 뒤 턴 것만 걷힌다. 여태 이 갈래는
         * 「대화도 걷어냈습니다」 만 적어서, 사람은 앞 턴 이야기도 없어진 줄
         * 알았다 — 아래 else 갈래가 통째로 못 걷었을 때 하는 말을 반만 못
         * 걷었을 때는 안 했다. session.js 의 되감기() 머리말대로 「못 찾으면
         * 그 턴은 되감을 수 없다고 정직하게 말한다」.
         */
        if (되감음.못걷은턴?.length) {
          say(`    ${c.gray(말('undo.talkPartial', { n: 되감음.못걷은턴.length }))}`);
          say(`    ${c.gray(말('undo.talkKeptWhy'))}`);
        }
      } else {
        // 접기·요약이 그 자리를 이미 가져갔을 때다. 파일은 되돌아갔지만 대화는
        // 못 걷었다는 것을 숨기지 않는다 — 숨기면 위의 사고가 그대로 난다.
        say(`    ${c.gray(말('undo.talkKept'))}`);
        say(`    ${c.gray(말('undo.talkKeptWhy'))}`);
        /*
         * 대화는 못 걷었어도 **그 턴이 박은 쪽지**는 뺐다(session.js 의 되감기).
         * 뺀 것을 안 말하면 「그대로 둡니다」 가 반만 맞는 말이 된다.
         */
        if (되감음.뺀쪽지) say(`    ${c.gray(말('undo.notesDropped', { n: 되감음.뺀쪽지 }))}`);
      }
      say('');
      return { handled: true };
    }

    case 'diff': return 바뀐것보기(session, ctx, arg), { handled: true };

    case 'preview':
    case 'serve': return await 미리보기(session, ctx, arg), { handled: true };

    case 'tools': {
      rule(말('scr.tools'), 70);
      /*
       * 원본 schema.description 을 그대로 찍으면 안 된다.
       *
       * 그 글은 한국어다. 영어 표(tools/desc.en.js)는 **모델에게 줄 때만**
       * 갈아 끼우고 있어서, 영어로 켠 사람의 `/tools` 는 스물한 줄이 통째로
       * 한국어로 나왔다. `/lang` 은 그 사이에도 100% 라고 답했다 — 이 글들은
       * 애초에 말 표에 들어간 적이 없어서 셈에 안 잡혔기 때문이다.
       *
       * 여기서는 **화면 말**(언어())로 고른다. 모델에게 주는 글의 말과는
       * 다른 축이다 — 영어로 시키고 한국어로 보는 조합이 실제로 쓰인다.
       */
      for (const [n, t] of Object.entries(TOOLS)) {
        say(`  ${c.cyan(pad(n, 8))} ${c.gray(영어설명(t.schema, n, 언어()).description)}`);
      }
      say('');
      return { handled: true };
    }

    case 'cost': {
      const mins = ((Date.now() - session.startedAt) / 60000).toFixed(1);
      rule(말('scr.session'), 70);
      say(`  ${c.gray(pad(말('cost.calls'), 14))} ${말('unit.calls', { n: session.usage.calls })}`);
      /*
       * 「들어간 토큰」 은 **보낸 것 전체**를 적는다. 캐시에 맞은 몫도 보낸 것이다.
       * 서버가 새로 읽은 몫만 적으면 캐시가 잘 맞을수록 숫자가 줄어서, 일이
       * 줄어든 것처럼 읽힌다. 새로 읽은 몫과의 차이는 바로 아래 캐시 줄이 적는다.
       */
      const 보낸것 = session.usage.prompt || session.usage.in;
      /*
       * 창구가 usage 를 안 준 부름이 있었으면 **그렇다고 적는다.**
       *
       * 안 적으면 그 몫이 0 으로 합쳐져서, 유료로 부르고도 화면이 「입력 0 ·
       * $0.00」 이라고 말한다. 이 프로그램에서 제일 나쁜 고장이 화면이
       * 거짓말하는 것이고, 0 은 「모른다」 를 숫자로 지어낸 것이다.
       */
      const 못잰것 = session.usage.못잰것 ?? 0;
      const 덧말 = 못잰것 ? c.yellow(`  (${못잰것}번은 창구가 안 알려 줘서 안 들어감)`) : '';
      say(`  ${c.gray(pad(말('cost.tokIn'), 14))} ${보낸것.toLocaleString()}${덧말}`);
      say(`  ${c.gray(pad(말('cost.tokOut'), 14))} ${session.usage.out.toLocaleString()}`);
      /*
       * ── 캐시가 얼마나 맞았나 ────────────────────────────────────────
       *
       * 읽기와 쓰기를 **따로** 적는다. 하나로 뭉치면 「잘 읽고 있다」 와
       * 「매번 쓰기만 하고 한 번도 못 읽는다」 가 같아 보이는데, 그 둘은
       * 정반대 상태다. 뒤쪽은 캐시를 켜 놓고 값만 더 내는 것이다.
       *
       * 서버가 캐시 수치를 안 주는 자리도 많다. 그때는 줄 자체를 안 적는다 —
       * 모르는 것을 0 으로 적으면 「캐시가 하나도 안 맞는다」 로 읽힌다.
       */
      const 읽힘 = session.usage.cacheRead ?? 0;
      const 쓰임 = session.usage.cacheWrite ?? 0;
      if (읽힘 || 쓰임) {
        // 분모는 보낸 것 전체다. 읽힘은 이미 그 안에 들어 있으므로 또 더하면 안 된다.
        const 몫 = 보낸것 > 0 ? Math.round((읽힘 / 보낸것) * 100) : 0;
        say(`  ${c.gray(pad(말('cost.cache'), 14))} ${말('cost.cacheLine', {
          읽음: 읽힘.toLocaleString(), 씀: 쓰임.toLocaleString(), 몫: String(몫),
        })}`);
        // 쓰기만 있고 읽기가 없으면 표식이 매번 새로 엮이는 것이다. 그건 손해다.
        if (쓰임 > 0 && 읽힘 === 0) say(`  ${c.gray(pad('', 14))} ${c.yellow(말('cost.cacheColdWarn'))}`);
      }
      /*
       * 답 토큰 중 생각에 쓴 몫. `/think` 를 높게 잡아 둔 대가가 여기 보인다.
       *
       * 안 알려 주는 창구가 많다. 0 이면 줄을 안 적는다 — 모르는 것을 0 으로
       * 적으면 「생각을 안 했다」 로 읽히고, 그건 우리가 모른다는 사실과 다르다.
       */
      const 생각몫 = session.usage.reasoning ?? 0;
      if (생각몫 > 0) {
        const 비율 = session.usage.out > 0 ? Math.round((생각몫 / session.usage.out) * 100) : 0;
        say(`  ${c.gray(pad(말('cost.think'), 14))} ${말('cost.thinkLine', {
          토큰: 생각몫.toLocaleString(), 몫: String(비율),
        })}`);
      }
      say(`  ${c.gray(pad(말('cost.toolMs'), 14))} ${말('unit.sec', { n: (session.usage.ms / 1000).toFixed(1) })}`);
      // 서버가 잠깐 막아 다시 부른 횟수. 0 이면 안 적는다 — 없는 일을 줄로 남기면 표만 길어진다.
      if (session.usage.retries) say(`  ${c.gray(pad(말('cost.retries'), 14))} ${말('unit.calls', { n: session.usage.retries })}`);
      say(`  ${c.gray(pad(말('cost.elapsed'), 14))} ${말('unit.min', { n: mins })}`);
      /*
       * ── 갈래를 쓰면 이 위의 숫자는 **한 갈래 것**이다 ────────────────
       *
       * session.usage 는 지금 갈래의 셈이다. 갈래를 셋 굴리면 화면의
       * 금액은 그중 하나 몫이고, 갈래를 바꾸는 것만으로 숫자가 내려간다 —
       * 돈은 그대로 나가는데. 닫은 갈래 것은 아예 안 보였다.
       *
       * 위 줄들을 갈래 합으로 바꾸지는 않는다. 「이 갈래에서 뭘 했나」 도
       * 봐야 하는 값이라서다. 대신 **다를 때만** 한 줄을 더 붙인다.
       */
      const 갈래셈 = ctx?.갈래?.갈래여럿인가?.() ? ctx.갈래.전체usage() : null;
      if (갈래셈) {
        const 갈래수 = (ctx.갈래.개수?.() ?? 1) + (ctx.갈래.닫힌수 ?? 0);
        say(`  ${c.gray(pad('갈래 전부', 14))} ${c.gray(`${갈래수}갈래 · 호출 ${갈래셈.calls.toLocaleString()} · 입력 ${갈래셈.in.toLocaleString()} · 출력 ${갈래셈.out.toLocaleString()}`)}`);
        say(`  ${c.gray(pad('', 14))} ${c.gray('위 숫자는 지금 갈래 것입니다.')}`);
      }
      /*
       * 돈.
       *
       * 이 도구에는 값이 박힌 요금표가 없다(backend/price.js). 지어낸 요금을
       * 자신 있게 찍는 것보다 모른다고 말하는 편이 낫다고 봤다.
       *
       * 그래서 두 갈래다 — 아는 값이 있으면 금액과 **어디서 온 값인지**를
       * 같이 적고, 모르면 어디에 무엇을 적으면 되는지를 적는다. 「모릅니다」
       * 한 줄로 끝내면 사람이 할 수 있는 일이 없다.
       *
       * 로컬로만 쓰는 사람에게는 아예 안 띄운다. 로컬은 공짜라 그 자리가
       * 영영 안 채워지고, 그러면 매번 쓸모없는 안내만 보게 된다.
       */
      const 요금값 = 세션요금(session);
      const 쓴돈 = 돈셈(session.usage, 요금값);
      if (쓴돈) {
        /*
         * 캐시 요금을 모르면 캐시 토큰도 정가로 셌다는 뜻이다. 그 금액은
         * 실제보다 **크다**. 그냥 찍으면 사람은 그 숫자를 예산으로 잡는데,
         * 캐시가 잘 걸리는 대화일수록 몇 배씩 부풀어 있다. 숫자를 감추지
         * 말고 「위쪽 값」 이라고 말한다 — 그리고 어디에 적으면 정확해지는지
         * 같이 알려 준다.
         */
        const 위쪽 = 쓴돈.캐시모름;
        say(`  ${c.gray(pad(말('cost.money'), 14))} ${c.bold(돈말(쓴돈.달러))}`
          + (위쪽 ? ` ${c.gray('이하')}` : '')
          + ` ${c.gray(`(${어디서온값(요금값)})`)}`);
        if (위쪽) {
          say(`  ${c.gray(' '.repeat(14))} ${c.gray('캐시 요금을 몰라 캐시 토큰도 정가로 셌습니다 — 실제로는 이보다 쌉니다.')}`);
          say(`  ${c.gray(' '.repeat(14))} ${c.gray('요금표에 `캐시읽기`·`캐시쓰기` 를 적으면 정확해집니다.')}`);
        }
      } else if (바깥인가(session.conn.base) && (session.usage.in || session.usage.out)) {
        const 붙은곳 = session.제공자 ? 제공자고르기(session.제공자) : null;
        for (const 줄 of 요금적는법(session.conn.model, { 제공자: 붙은곳, 설정파일: configPath() })) {
          say(`  ${c.gray(줄)}`);
        }
      }
      // 설정에 적어는 뒀는데 숫자가 아니면 조용히 넘어가면 안 된다. 사람은
      // 적었다고 믿고 있으므로, 안 나오는 까닭을 화면에서 알 수 있어야 한다.
      for (const 탈 of 요금값?.탈들 ?? []) say(`  ${c.yellow(mark.no)} ${c.gray(탈)}`);
      /*
       * 서버가 남았다고 말해 준 할당량 (backend/quota.js).
       *
       * 안 알려주는 서버가 많다. 그러면 줄 자체를 안 적는다 — 모르는 것을
       * 0 으로 적으면 멀쩡한데 다 썼다고 믿게 된다.
       */
      const 남은것 = 마지막할당량();
      if (남은것) {
        const 말줄 = 할당량말(남은것);
        say(`  ${c.gray(pad(말('cost.quota'), 14))} ${아슬아슬한가(남은것) ? c.yellow(말줄) : 말줄}`
          + ` ${c.gray(`(${말('cost.quotaAge', { 초: Math.round((Date.now() - 남은것.때) / 1000) })})`)}`);
      }
      say('');
      return { handled: true };
    }

    case 'status': {
      const k = session.conn;
      rule(말('scr.conn'), 70);
      say(`  ${c.gray(pad(말('status.kind'), 10))} ${규격이름(k.kind)}`);
      say(`  ${c.gray(pad(말('status.url'), 10))} ${k.base}`);
      // 프록시를 거치면 어느 것을, 어디서 읽었는지(env · config)까지. 안 거치면 줄 자체가 없다.
      // 적어 놨는데 못 쓰는 것(socks5 등)이면 그 까닭을 — 조용히 직접 가면 사람은 프록시를 탄 줄 안다.
      const 프록시 = 프록시고르기(k.base);
      if (프록시) say(`  ${c.gray(pad(말('status.proxy'), 10))} ${프록시.url} ${c.gray(`(${프록시.출처})`)}`);
      // 어차피 안 거칠 주소(이 PC · NO_PROXY)면 그 줄도 없다 — 상관없는 프록시를 탓하게 된다 (2.0.0 6회차 RP1b).
      else if (프록시설정().탈 && !프록시비켜가나(k.base)) say(`  ${c.gray(pad(말('status.proxy'), 10))} ${c.yellow(말('status.proxyOff'))} ${c.gray(`— ${프록시설정().탈}`)}`);
      say(`  ${c.gray(pad(말('status.model'), 10))} ${k.model}`);
      /*
       * 이 모델이 이 주소에서 **실제로 받는 것** (backend/wire.js).
       *
       * 여태 화면과 전선이 다른 말을 할 수 있었다 — `/think max` 를 쳐도
       * 전선에는 high 가 나가는 식이다. 무엇이 나가는지는 사람이 볼 수
       * 있어야 한다. 안 보이면 조절이 먹었는지 안 먹었는지 알 길이 없다.
       */
      if (k.전선) say(`  ${c.gray(pad(말('status.wire'), 10))} ${c.gray(전선말(k.전선))}`);
      say(`  ${c.gray(pad(말('status.root'), 10))} ${session.root}`);
      // 명령이 어느 셸에서 도는지. "ls 가 왜 안 되지" 의 답이 이 줄에 있다.
      say(`  ${c.gray(pad(말('status.shell'), 10))} ${정한셸().표시}`);
      // 열쇠를 어디에 두고 있나. 사내 심사에서 제일 먼저 묻는 것이라
      // 「어딘가 잠겨 있겠지」 로 두지 않고 지금 상태를 그대로 적는다.
      /*
       * 열쇠를 어디에 두고 있나 — 또는 **어디서 받아 오나.**
       *
       * 받아 오는 연결에서는 「보관」 을 적으면 거짓말이 된다. 우리는 그
       * 열쇠를 갖고 있지 않다. 사내 심사에서 제일 먼저 묻는 자리라
       * 있는 그대로 적는다 (safety/authcmd.js).
       */
      if (session.conn.열쇠받기) {
        const 상태 = 지금열쇠상태();
        const 남은말 = 상태
          ? 말('auth.leftMin', { 분: Math.round(상태.남은초 / 60) })
          : 말('auth.notYet');
        say(`  ${c.gray(pad(말('status.keyStore'), 10))} `
          + `${말(session.conn.열쇠받기.곳 === '정책' ? 'auth.fromPolicy' : 'auth.from')} ${c.gray(`· ${남은말}`)}`);
        say(`  ${c.gray(pad('', 10))} ${c.gray(clip(session.conn.열쇠받기.명령, 56))}`);
      } else if (k.auth !== 'none') {
        say(`  ${c.gray(pad(말('status.keyStore'), 10))} ${열쇠보관(load())}`);
      }
      /*
       * 우리 인증서로 붙고 있으면 그렇다고 적는다.
       *
       * 인증서를 둘 이상 가진 사람은 어느 것이 먹었는지 알 길이 없다 — 붙으면
       * 조용하고 안 붙으면 TLS 악수 실패 한 줄만 온다. **암호는 절대 안 적는다**
       * (backend/clientcert.js 의 인증서말).
       */
      if (session.conn.인증서) {
        say(`  ${c.gray(pad(말('status.clientCert'), 10))} ${c.gray(인증서말(session.conn.인증서))}`);
      }
      say(`  ${c.gray(pad(말('status.rules'), 10))} ${session.rules ? session.rules.name : 말('status.noRules')}`);
      // 파일이 있는데 못 읽은 것을 '없음' 으로 적으면, 규칙을 적어 둔 사람은
      // 걸려 있다고 믿는다. 안 걸린 채로 도는 것이 여기서 제일 나쁜 모양이다.
      if (session.규칙못읽음) {
        say(`  ${c.gray(pad('', 10))} ${mark.warn} ${c.yellow(말('status.rulesUnread', {
          이름: session.규칙못읽음.이름, 까닭: session.규칙못읽음.까닭,
        }))}`);
      }
      /*
       * 반만 실린 것도 같은 자리에서 말한다.
       *
       * 이름만 적으면 사람은 규칙이 통째로 걸려 있다고 믿는다. 2만 자를
       * 넘긴 규칙 파일의 뒷부분은 모델에게 한 글자도 안 간다 — 「운영 DB 는
       * 건드리지 마라」 가 하필 그 뒤에 있으면 그게 제일 나쁜 모양이다.
       */
      if (session.규칙잘림) {
        const j = session.규칙잘림;
        say(`  ${c.gray(pad('', 10))} ${mark.warn} ${c.yellow(`${j.이름} 은 ${j.원본.toLocaleString()}자라 앞 ${j.실린.toLocaleString()}자만 실렸습니다`)}`);
        say(`  ${c.gray(pad('', 10))} ${c.gray('그 뒤에 적은 규칙은 모델에게 안 갑니다. 중요한 것을 앞으로 옮기세요.')}`);
      }
      /*
       * 도구 정의를 못 쟀으면 그것도 적는다.
       *
       * 도구 정의는 매 요청에 통째로 실려 나간다. 못 재면 /context 는 그만큼
       * 빈자리가 있다고 말하고, 그 값으로 출력 상한이 잡혀 답이 이유 없이
       * 짧아진다. MCP 서버가 이상한 스키마를 주면 실제로 나는 일이다.
       */
      if (session.도구못쟀나) {
        say(`  ${c.gray(pad('', 10))} ${mark.warn} ${c.yellow(`도구 정의 크기를 못 쟀습니다 — ${String(session.도구못쟀나).slice(0, 60)}`)}`);
        say(`  ${c.gray(pad('', 10))} ${c.gray('/context 의 도구 칸이 0 으로 나오고, 답이 이유 없이 짧아질 수 있습니다.')}`);
      }
      const caps = [
        k.tools ? c.green(말('status.capTools')) : c.red(말('status.capTools')),
        k.streaming ? c.green(말('status.capStream')) : c.gray(말('status.capStream')),
        k.json ? c.green(말('status.capSchema')) : c.gray(말('status.capSchema')),
        k.think ? c.green(말('status.capThink')) : c.gray(말('status.capThink')),
      ].join(c.gray(' · '));
      say(`  ${c.gray(pad(말('status.caps'), 10))} ${caps}`);
      say('');
      return { handled: true };
    }

    case 'work':
    case 'auto':
    case 'code': case 'plan': case 'architect':
    case 'debug': case 'ask': case 'inspect': case 'orchestrator': {
      // 인자 없이 /work 만 치면 지금 모드와 고를 수 있는 것을 보여 준다.
      if (name === 'work' && !arg.trim()) { showWork(session); return { handled: true }; }

      const 골라진 = normWork(name === 'work' ? arg : name);
      if (!골라진) {
        // 오타에는 목록만 보여 주면 안 된다.
        //
        // 예전에는 /work 오타 가 조용히 목록으로 빠졌다. 그러면 사람은 자기가
        // 친 말이 틀렸다는 걸 모른 채 '왜 안 바뀌지' 만 하게 된다. 못 알아들었다는
        // 말을 먼저 하고, 그 다음에 쓸 수 있는 것을 보여 준다.
        say(`  ${mark.warn} 그런 모드는 없습니다: ${c.white(arg)}`);
        say(`  ${c.gray('쓸 수 있는 것:')} ${WORK_ORDER.map((k) => c.cyan(WORK_MODES[k].name)).join(c.gray(' · '))}`);
        say('');
        showWork(session);
        return { handled: true };
      }
      session.work = 골라진;
      // 사람이 직접 골랐다. 저절로 골라 둔 것이 있으면 지운다 —
      // 안 지우면 이번 한마디는 여전히 옛 모드로 돌아 "왜 안 바뀌지" 가 된다.
      session.routed = null;
      const w = getWork(골라진);
      say('');
      // 영어 화면에서 이름과 영문 이름은 같은 글자다 — 「Inspect (Inspect)」 를 안 만든다.
      const 곁이름 = 언어() === 'en' ? '' : ` ${c.gray(`(${w.en})`)}`;
      say(`  ${c.hcyan(w.glyph)} ${c.bold(보일이름(w.id))}${곁이름}  ${c.gray(보일한줄(w.id))}`);
      say(`  ${c.gray(pad(말('work.tools'), 6))}  ${canWrite(골라진) ? c.yellow(말('work.toolsWrite')) : c.green(말('work.toolsRead'))}`);
      say(`  ${c.gray(pad(말('work.think'), 6))}  ${c.white(w.think ?? session.think)}${c.gray('·')}${c.magenta(w.effort)}   ${c.gray(말('work.steps', { n: 걸음수(w.id, session.conn?.ctx) }))}`);
      if (골라진 === 'auto') {
        say(`  ${c.gray(말('work.autoOn'))}`);
      } else {
        say(`  ${c.gray(말('work.pinned'))} ${c.cyan(`/work ${보일이름('auto')}`)}`);
      }
      say('');
      return { handled: true };
    }

    case 'scan': {
      const s2 = spin('이 PC 의 로컬 서버를 찾는 중…');
      const found = await scanLocal({ timeout: 1500 });
      s2.stop(`  ${found.length ? mark.ok : mark.warn} ${found.length}곳 찾음`);
      if (!found.length) {
        say(`  ${c.gray('떠 있는 로컬 서버가 없습니다. 다른 포트라면')} ${c.cyan('deel scan --ports ...')}`);
        say('');
        return { handled: true };
      }
      for (const f of found) {
        say(`  ${c.hcyan('◆')} ${c.bold(pad(f.runtime, 12))}${c.gray(pad(`${f.host}:${f.port}`, 22))}${c.gray(`모델 ${f.models.length}개`)}`);
        for (const m of f.models.slice(0, 6)) say(`      ${c.gray('·')} ${clip(m.id, 44)}`);
        if (f.models.length > 6) say(`      ${c.gray(`… 그 밖에 ${f.models.length - 6}개`)}`);
      }
      say('');
      if (arg === 'save') {
        const cfg2 = load();
        const ps = toProfiles(found, cfg2.profiles);
        for (const x of ps) upsert(cfg2, x);
        // 설정남기기() 를 안 쓰고 있었다 — 못 남기면 명령이 그 자리에서 죽고,
        // 남겼는데도 뭐가 틀리면 「등록했습니다」 만 보고 다음에 없는 것을 본다.
        if (!설정남기기(cfg2)) return { handled: true };
        say(`  ${mark.ok} ${ps.length}개 등록했습니다. ${c.cyan('/model')} 로 고르세요.`);
      } else {
        say(`  ${c.gray('등록하려면')} ${c.cyan('/scan save')}   ${c.gray('고르려면')} ${c.cyan('/model')}`);
      }
      say('');
      return { handled: true };
    }

    /*
     * /recall — 지난 대화에서 **내용으로** 찾는다.
     *
     * /sessions 는 목록만 보여 준다. 언제 무슨 모델로 몇 턴 했는지는 알겠는데
     * "저번에 그 인코딩 문제 어떻게 풀었더라" 는 못 찾는다. 기록이 있는데
     * 못 찾으면 없는 것과 같다.
     */
    case 'recall': {
      const 말 = String(arg ?? '').trim();
      if (!말) {
        say(`  ${c.gray('찾을 말을 적어 주세요 —')} ${c.cyan('/recall CP949 인코딩')}`);
        say(`  ${c.gray('낱말 두세 개가 가장 잘 맞습니다. 조사는 붙어 있어도 됩니다.')}`);
        say('');
        return { handled: true };
      }
      const { 찾기 } = await import('./agent/recall.js');
      const r = 찾기(session.root, 말, { limit: 10 });

      rule(`지난 대화에서 "${clip(말, 30)}"`, 70);
      if (!r.낱말.length) {
        say(`  ${mark.no} 찾을 낱말이 없습니다 ${c.gray('— 두 글자 이상으로 적어 주세요.')}`);
        say('');
        return { handled: true };
      }
      if (!r.맞은것.length) {
        // 못 찾은 것과 안 찾아본 것을 구분해서 말한다.
        say(r.예산초과
          ? `  ${mark.warn} 지난 대화 ${r.전체파일}개 중 ${r.본파일}개까지만 뒤졌습니다 ${c.gray('(양이 많아 멈췄습니다)')}`
          : `  ${c.gray(`지난 대화 ${r.본파일}개를 다 뒤졌지만 없습니다.`)}`);
        say(`  ${c.gray('찾은 낱말:')} ${c.white(r.낱말.join(' · '))}`);
        say('');
        return { handled: true };
      }

      for (const h of r.맞은것) {
        const 날 = h.언제 instanceof Date ? h.언제.toISOString().slice(0, 16).replace('T', ' ') : '';
        const 색 = h.role === 'user' ? c.hcyan : h.role === 'assistant' ? c.white : c.gray;
        say(`  ${c.gray(pad(날, 17))} ${색(pad(h.누구, 7))} ${c.gray(h.세션)}`);
        say(`      ${강조(h.토막, r.낱말)}`);
      }
      say('');
      say(`  ${c.gray(`${r.전체맞음}건 중 ${r.맞은것.length}건 · 대화 ${r.본파일}개를 뒤졌습니다`)}`
        + (r.예산초과 ? `  ${c.yellow(`(${r.전체파일}개 중 ${r.본파일}개까지만)`)}` : ''));
      say(`  ${c.gray('그 대화를 이어하려면')} ${c.cyan('deel --resume ' + r.맞은것[0].세션)}`);
      say('');
      return { handled: true };
    }

    /*
     * /mcp — 밖에서 붙인 도구 서버.
     *
     * 여기서 제일 중요한 줄은 도구 목록이 아니라 **경고**다. MCP 서버는 남의
     * 프로그램이고 우리 작업 범위를 안 지킨다. 화면 어디에도 그 말이 없으면
     * 사람은 우리 도구와 똑같이 안전한 줄 안다.
     */
    /*
     * /memory — 대화가 끝나도 남는 것.
     *
     * 사람이 반드시 **볼 수 있고 지울 수 있어야** 한다. 모델이 잘못 적은 줄은
     * 매 요청마다 실려 나가면서 계속 틀리게 만든다. 틀린 기억은 없느니만 못하다.
     */
    case 'memory': {
      const M = await import('./agent/memory.js');
      const 말 = String(arg ?? '').trim();

      /*
       * 무늬 둘에 `i` 가 빠져 있었다 (8회차 그밖 명령1). 아래 「번호를 적어 주세요」 쪽만
       * `i` 가 붙어 있어서, `/memory RM 1` 은 안 지우고 `/memory CLEAR` 는 어느 무늬에도
       * 안 걸린 채 맨 아래 「이걸 기억해라」 로 떨어졌다 — **지우려던 낱말이 기억으로 적혔다.**
       * 그 줄은 그 뒤로 매 요청마다 모델에게 같이 나간다. 아래 주석이 막으려던 바로 그 결말이,
       * 대문자로 친 사람에게만 그대로 일어나고 있었다.
       */
      if (/^(비우기|clear|지우기전부)$/i.test(말)) {
        M.비우기(session.root);
        session.memory = M.프롬프트토막(session.root);
        say(`  ${mark.ok} 기억을 비웠습니다.`);
        say('');
        return { handled: true };
      }

      const 지움 = /^(지우기|잊어|forget|rm)\s+(\d+)$/i.exec(말);
      if (지움) {
        const r = M.지우기(session.root, 지움[2]);
        if (!r.ok) say(`  ${mark.no} ${r.why}`);
        else {
          session.memory = M.프롬프트토막(session.root);
          say(`  ${mark.ok} 잊었습니다: ${c.gray(clip(r.뺀것, 60))}`);
        }
        say('');
        return { handled: true };
      }

      /*
       * 지우려다 **적고 마는** 자리를 막는다.
       *
       * `/memory 지우기` 처럼 번호를 안 붙이면 위 무늬에 안 걸리고 아래
       * 「이걸 기억해라」 로 떨어졌다. 그래서 `지우기` 라는 낱말이 기억 파일에
       * **영영 적히고**, 화면에는 「기억했습니다」 라고 떴다. 그 줄은 그 뒤로
       * 매 요청마다 모델에게 같이 나간다. 지우려던 사람이 쓰레기를 하나 더
       * 심는 꼴이고, 그것도 성공 표시를 보면서 그렇게 된다.
       */
      // 낱말 끝은 `\\b` 로 못 잡는다 — 한글은 \\w 가 아니라 `지우기` 뒤에 낱말
      // 경계가 안 생긴다. 실제로 이 무늬로 고쳤다가 한글만 그대로 새 나갔다.
      if (/^(지우기|잊어|forget|rm)(\s|$)/i.test(말)) {
        const 있는것 = M.읽기(session.root).줄들;
        say(`  ${mark.no} ${c.gray('몇 번째 줄을 지울지 번호를 적어 주세요.')}`);
        if (있는것.length) {
          for (const [i, l] of 있는것.entries()) {
            say(`  ${c.gray(String(i + 1).padStart(2))}  ${c.white(clip(l, 82))}`);
          }
          say('');
          say(`  ${c.cyan('/memory 지우기 1')}   ${c.gray('한 줄만')}      ${c.cyan('/memory 비우기')}   ${c.gray('전부')}`);
        } else {
          say(`  ${c.gray('지금은 기억해 둔 것이 없습니다.')}`);
        }
        say('');
        return { handled: true };
      }

      // 그 밖의 말은 '이걸 기억해라' 로 본다. 모델을 안 거치고 바로 적는 길이다.
      if (말) {
        const r = M.더하기(session.root, 말);
        if (!r.ok) say(`  ${mark.warn} ${r.why}`);
        else {
          session.memory = M.프롬프트토막(session.root);
          say(`  ${mark.ok} 기억했습니다 ${c.gray(`(${r.줄수}줄)`)}`);
          if (r.넘침) say(`     ${c.gray('자리가 차서 오래된 것을 뺐습니다.')}`);
          // 적기는 했지만 안 실리는 판을 말한다 (6회차 Gemini 기억6z-b Z2′). 여태 memory.js 가
          // 돌려주는 안실림 을 아무도 안 읽어, 「기억했습니다」 뒤로 한 번도 안 실렸다.
          if (r.안실림) {
            say(`     ${c.yellow('적었지만 다음 요청부터 안 실립니다')} ${c.gray('— 믿는 폴더가 아니고, 이 PC 가 적지 않은 줄이 섞여 있습니다. 실으려면')} ${c.cyan('deel trust')}${c.gray(', 남의 줄을 빼려면')} ${c.cyan('/memory 지우기 N')}`);
          }
        }
        say('');
        return { handled: true };
      }

      const 기억 = M.읽기(session.root);
      rule('기억 — 대화가 끝나도 남는 것', 70);
      if (!기억.줄들.length) {
        say(`  ${c.gray('아직 없습니다.')}`);
        say('');
        say(`  ${c.gray('모델이 스스로 적기도 하고, 직접 적으셔도 됩니다 —')}`);
        say(`  ${c.cyan('/memory 사내 문서는 CP949 로 읽고 CP949 로 되돌려 쓴다')}`);
        say('');
        return { handled: true };
      }
      for (const [i, l] of 기억.줄들.entries()) {
        say(`  ${c.gray(String(i + 1).padStart(2))}  ${c.white(clip(l, 82))}`);
      }
      const 글자 = 기억.줄들.join('\n').length;
      say('');
      say(`  ${c.gray(`${기억.줄들.length}줄 · 약 ${Math.round(글자 / 3).toLocaleString()}토큰이 매 요청마다 함께 나갑니다`)}`);
      say(`  ${c.gray('파일')} ${c.white(기억.자리)} ${c.gray('— 직접 고치셔도 됩니다')}`);
      say(`  ${c.cyan('/memory 지우기 3')}   ${c.cyan('/memory 비우기')}`);
      say('');
      return { handled: true };
    }

    case 'mcp': {
      const { 설정읽기, 설정자리, 도구최대, 되살리기최대 } = await import('./backend/mcp.js');
      const 붙은것 = session.mcp ?? [];
      rule('밖에서 붙인 도구 (MCP)', 70);

      if (!붙은것.length) {
        const 설정 = 설정읽기(session.root);
        if (설정.오류) say(`  ${mark.no} ${설정.오류}`);
        else if (!설정.있음) {
          say(`  ${c.gray('붙인 것이 없습니다.')} ${c.gray('설정 파일이 없습니다 —')} ${c.white(설정자리(session.root))}`);
        } else if (!설정.서버들.length) {
          say(`  ${c.gray('설정은 있는데 띄울 서버가 없습니다.')} ${c.gray(설정자리(session.root))}`);
        } else {
          say(`  ${mark.warn} 설정에 ${설정.서버들.length}대가 적혀 있는데 하나도 안 붙었습니다.`);
          say(`     ${c.gray('오프라인 잠금 중이거나, 켤 때 못 떴습니다. 머리말의 경고를 보세요.')}`);
        }
        say('');
        say(`  ${c.gray('붙이려면')} ${c.white('.deel/mcp.json')} ${c.gray('에 이렇게 적습니다 —')}`);
        say(`  ${c.gray('{ "mcpServers": { "사내위키": { "command": "node", "args": ["wiki-mcp.js"] } } }')}`);
        say('');
        say(`  ${c.yellow('※')} ${c.gray('MCP 서버는 남의 프로그램입니다. 사내 반입 심사를 따로 받으셔야 합니다.')}`);
        say('');
        return { handled: true };
      }

      for (const s of 붙은것) {
        /*
         * 세 가지 상태를 **갈라서** 적는다 (backend/mcp.js 의 지연 로딩).
         *
         *   ● 떠 있다      지금 프로세스가 돌고 있다
         *   ◐ 대기         적어 둔 목록으로 서 있다 — 그 도구를 부르면 뜬다
         *   ○ 죽었다       띄웠는데 안 됐거나 도중에 죽었다 (도중에 저 혼자 죽은 것은 다음 부름에 되살린다)
         *
         * 대기를 죽음으로 뭉개면 사람은 없는 탈을 고치러 간다. 반대로 대기를
         * 초록으로 적으면 「띄워 봤다」 는 말이 거짓이 된다.
         */
        const 상태 = s.살아있나() ? c.green('●') : (s.대기 ? c.yellow('◐') : c.red('○'));
        const 이름들 = s.도구.map((t) => t.name);
        say(`  ${상태} ${c.bold(s.이름)}  ${c.gray(s.정보?.name ? `${s.정보.name} ${s.정보.version ?? ''}` : s.설정.command)}`);
        say(`      ${c.gray('도구 ' + s.도구.length + '개')}  ${c.gray(clip(이름들.join(' · '), 60))}`);
        if (s.대기) say(`      ${c.gray('아직 안 띄웠습니다 — 적어 둔 목록입니다. 이 도구를 부르면 그때 뜹니다.')}`);
        if (s.잘림) say(`      ${mark.warn} ${c.gray(`${s.잘림}개는 뺐습니다 — 한 서버에 ${도구최대}개까지만 받습니다(컨텍스트가 줄어듭니다)`)}`);
        if (s.달라짐) {
          const 것 = [
            s.달라짐.늘어난것?.length ? `늘어남 ${s.달라짐.늘어난것.join(' ')}` : null,
            s.달라짐.없어진것?.length ? `없어짐 ${s.달라짐.없어진것.join(' ')}` : null,
          ].filter(Boolean).join(' · ');
          say(`      ${mark.warn} ${c.gray(`띄워 보니 목록이 달랐습니다 — ${것}`)}`);
        }
        if (!s.살아있나() && !s.대기) say(`      ${c.red(s.죽음 ?? '죽었습니다')}`);
        // 저 혼자 죽은 것은 다음 부름에 되살린다(backend/mcp.js 깨우기 · 2.0.2 M1). 안 말하면 사람은 세션을 다시 켠다.
        if (s.되살릴수있나?.()) say(`      ${c.gray(`다음에 이 서버 도구를 부르면 다시 띄웁니다 — 이번 세션에 ${되살리기최대 - s.되살린수}번 남았습니다.`)}`);
      }
      say('');
      say(`  ${c.gray('모델에게는')} ${c.white('mcp__<서버>__<도구>')} ${c.gray('라는 이름으로 보입니다.')}`);
      say(`  ${c.yellow('※')} ${c.gray('이 도구들은 남의 프로그램이 돌립니다 —')} ${c.white('작업 범위(' + session.root + ') 를 안 지킵니다.')}`);
      say(`  ${c.gray('  무엇을 불렀는지는')} ${c.white('.deel/audit.jsonl')} ${c.gray('에 남습니다.')}`);
      // 바로 위 줄이 약속이다. 못 지키고 있으면 여기서 말해야 한다.
      if (ctx?.audit?.못쓴것?.()) {
        say(`  ${mark.warn} ${c.yellow('지금 그 파일에 못 적고 있습니다')} ${c.gray('— /증거 에서 까닭을 보세요.')}`);
      }
      say('');
      return { handled: true };
    }

    /*
     * 적어 둔 훅을 보여 준다 (safety/hooks.js).
     *
     * /mcp 와 같은 자리다. 남의 프로그램을 돌리는 것을 켜 놓았으면, 무엇이
     * 켜져 있는지 볼 화면이 있어야 한다. 없으면 사람은 제가 무엇을 켜 뒀는지
     * 모른 채로 쓰게 되고, 그건 켠 적 없는 것과 똑같이 위험하다.
     *
     * **이번 판이 실제로 들고 있는 것**을 보여 준다. 파일을 다시 읽지 않는다 —
     * 파일은 대화 도중에 바뀔 수 있고, 그러면 이 화면과 실제로 도는 것이
     * 달라진다. 화면이 거짓말을 하느니 옛것을 보여 주는 편이 낫다.
     */
    case 'hooks':
    case '훅': {
      const { 자리들: 훅자리들, 프로젝트자리: 훅프로젝트자리, 이PC자리: 훅이PC자리 } = await import('./safety/hooks.js');
      const 것들 = ctx?.훅들 ?? [];
      rule('적어 둔 훅', 70);

      if (!것들.length) {
        say(`  ${c.gray('걸린 훅이 없습니다.')}`);
        say('');
        say(`  ${c.gray('적는 자리 —')} ${c.white(훅프로젝트자리(session.root))} ${c.gray('(이 프로젝트)')}`);
        say(`  ${c.gray('           ')} ${c.white(훅이PC자리())} ${c.gray('(이 PC 전체)')}`);
        say(`  ${c.gray('{ "hooks": [ { "때": "도구전", "도구": "Bash", "명령": "python .deel/gate.py" } ] }')}`);
        say('');
        say(`  ${c.gray('걸 수 있는 자리 —')} ${c.white(훅자리들.join(' · '))}`);
        say(`  ${c.yellow('※')} ${c.gray('프로젝트 파일은 믿는 폴더에서만 읽습니다 (deel trust).')}`);
        say('');
        return { handled: true };
      }

      for (const h of 것들) {
        const 막나 = h.자리 === '도구전' || h.자리 === '말전';
        say(`  ${c.bold(h.자리)}  ${c.gray(h.무늬글 === '*' ? '(모든 도구)' : h.무늬글)}  ${c.gray(`· ${h.출처}`)}`);
        say(`      ${c.white(clip(h.명령, 62))}`);
        say(`      ${c.gray(`${Math.round(h.제한 / 1000)}초 안에 · `)}${막나
          ? c.gray(h.지나갈까 ? '고장나면 지나감 (적어 두셨습니다)' : '고장나면 막음')
          : c.gray('여기서는 못 막습니다 — 말만 전합니다')}`);
      }
      say('');
      say(`  ${c.yellow('※')} ${c.gray('훅은 남의 프로그램을 돌립니다 —')} ${c.white(`작업 범위(${session.root}) 를 안 지킵니다.`)}`);
      say(`  ${c.gray('  무엇이 돌았고 무엇을 막았는지는')} ${c.white('.deel/audit.jsonl')} ${c.gray('에 남습니다.')}`);
      say(`  ${c.gray('  이번 판만 끄려면')} ${c.white('deel --no-hooks')} ${c.gray('· 아예 끄려면')} ${c.white('DEEL_HOOKS=off')}`);
      say('');
      return { handled: true };
    }

    /*
     * 이름 붙인 하위 작업을 보여 준다 (agent/agents.js).
     *
     * 모델이 보는 것은 이름과 한 줄 설명뿐이다. 사람은 그 아래 — 어느 모드로,
     * 어느 모델에게, 어떤 도구만 쥐여 주는지 — 를 볼 수 있어야 한다. 그게
     * 안 보이면 「리뷰어를 시켰는데 왜 파일을 고쳤지」 를 알아낼 길이 없다.
     */
    case 'agents':
    case '에이전트': {
      const { 자리들: 에자리들 } = await import('./agent/agents.js');
      const 것들 = ctx?.에이전트들 ?? [];
      rule('이름 붙인 하위 작업', 70);

      if (!것들.length) {
        say(`  ${c.gray('정의해 둔 것이 없습니다.')}`);
        say('');
        say(`  ${c.gray('적는 자리 —')} ${c.white(에자리들(session.root)[0])} ${c.gray('(이 프로젝트)')}`);
        say(`  ${c.gray('파일 하나가 이름 하나입니다.')} ${c.white('리뷰어.json')}`);
        say(`  ${c.gray('{ "설명": "고친 코드를 훑고 위험한 데만 짚는다",')}`);
        say(`  ${c.gray('  "모드": "inspect", "도구": ["Read", "Grep", "Glob"] }')}`);
        say('');
        say(`  ${c.gray('부를 때는')} ${c.white('Task({ agent: "리뷰어", … })')} ${c.gray('— 모델이 이름으로 고릅니다.')}`);
        say('');
        return { handled: true };
      }

      for (const a of 것들) {
        say(`  ${c.bold(a.이름)}  ${c.gray(`· ${a.출처}`)}`);
        say(`      ${c.white(clip(a.설명, 62))}`);
        const 곁들 = [
          a.모드 ? `모드 ${a.모드}` : null,
          a.모델 ? `모델 ${a.모델}` : null,
          a.걸음 ? `${a.걸음}걸음` : null,
          a.도구?.length ? `도구 ${a.도구.join(' ')}` : null,
          a.지침 ? `지침 ${a.지침.length}자` : null,
        ].filter(Boolean);
        if (곁들.length) say(`      ${c.gray(곁들.join('  ·  '))}`);
      }
      say('');
      say(`  ${c.gray('모델에게는')} ${c.white('Task({ agent: "<이름>", … })')} ${c.gray('로 보입니다 — 이름과 설명만 실립니다.')}`);
      say(`  ${c.gray('도구는')} ${c.white('줄이기만')} ${c.gray('합니다. 지금 모드가 안 주는 것을 적어 두면 그것만 빠집니다.')}`);
      say('');
      return { handled: true };
    }

    case 'thread':
    case '갈래': return 갈래명령(session, ctx, arg), { handled: true };

    case 'learned':
    case '배움': return 배움명령(session, ctx, arg), { handled: true };

    case 'pin':
    case '못박기': return 못박기명령(session, ctx, arg), { handled: true };

    case 'evidence':
    case '증거': return 증거명령(session, ctx, arg), { handled: true };

    case 'commit':
    case '커밋': return await 커밋명령(session, ctx, arg), { handled: true };

    case 'review':
    case '리뷰': return await 리뷰명령(session, ctx), { handled: true };

    /*
     * 클립보드에 든 화면 캡처를 그대로 붙인다.
     *
     * 파일로 앉힌 뒤 `@경로` 한 줄로 바꿔서 돌려준다. 붙이는 일은 이미
     * 검증된 @-붙이기 길(agent/mention.js)이 하게 두는 것이다 — 여기서
     * 따로 그림을 만들어 넣으면 예산 셈·눈 없는 모델 처리가 두 벌이 된다.
     *
     * 사람에게 **경로를 보여 준다.** 무엇이 나가는지 안 보이면, 실수로
     * 다른 캡처가 나가도 알아차릴 자리가 없다.
     */
    case 'paste':
    case '붙여넣기': return 붙여넣기명령(session, ctx);

    case 'sessions': {
      const rows = listSessions(session.root, { limit: 12 });
      rule('이 폴더의 지난 대화', 70);
      if (!rows.length) {
        say(`  ${c.gray('아직 없습니다. 지금 이 대화가 첫 번째입니다.')}`);
        say('');
        return { handled: true };
      }
      for (const [i, r] of rows.entries()) {
        // 못 읽은 것도 올린다 (agent/store.js 의 list). 없는 것과 못 여는 것은 다르다.
        const 앞 = r.못읽음 ? c.yellow(mark.warn) : i === 0 ? c.hgreen('●') : c.gray('·');
        say(`  ${앞} ${c.bold(pad(r.id, 17))}${c.gray(pad(r.못읽음 ? '' : `${r.turns}턴`, 6, 'right'))}  ${c.gray(clip(r.model, 22))}`);
        say(`      ${r.못읽음 ? c.yellow(clip(r.first, 66)) : c.gray(clip(r.first, 66))}`);
      }
      say('');
      const 읽히는것 = rows.filter((r) => !r.못읽음);
      if (읽히는것.length) {
        say(`  ${c.gray('이어하려면 나갔다가')} ${c.cyan('deel --continue')} ${c.gray('또는')} ${c.cyan(`deel --resume ${읽히는것[0].id}`)}`);
      } else {
        say(`  ${mark.warn} ${c.yellow('여기 있는 대화를 하나도 못 열었습니다 — 이어할 수 없습니다.')}`);
      }
      /*
       * 바로 아래 줄이 약속이다. 못 지키고 있으면 약속을 되풀이하면 안 된다.
       *
       * /mcp 화면에서 감사기록을 두고 한 것과 같은 자리다 — 「남습니다」 라고
       * 적어 놓고 실제로는 안 남는 것이 제일 나쁘다. 이 화면은 이어하기를
       * 보러 온 화면이라, 여기서 안 말하면 사람이 알 자리가 없다.
       */
      const 저장샘 = ctx?.갈래?.현재store?.()?.못쓴것?.();
      if (저장샘) {
        say(`  ${mark.warn} ${c.yellow(말('store.notSaving', { n: 저장샘.수, 까닭: 저장샘.까닭 }))}`);
      } else {
        say(`  ${c.gray('지금 대화는 나가지 않아도 계속 저장되고 있습니다.')}`);
      }
      say('');
      return { handled: true };
    }

    case 'init': {
      const p = join(session.root, 'DEEL.md');
      if (existsSync(p)) {
        say(`  ${mark.warn} 이미 있습니다: ${c.cyan('DEEL.md')}`);
        say('');
        return { handled: true };
      }
      writeFileSync(p, INIT_TEMPLATE, 'utf8');
      session.rules = { name: 'DEEL.md', text: INIT_TEMPLATE };
      say(`  ${mark.ok} ${c.cyan('DEEL.md')} 를 만들었습니다. 이 폴더의 규칙을 여기에 적으면 매번 읽습니다.`);
      say('');
      return { handled: true };
    }

    case 'skills': return showSkills(session, arg), { handled: true };

    case 'plugin':
    case 'plugins': return await doPlugin(session, arg), { handled: true };

    default: {
      // 이 PC 에서 찾은 슬래시 명령인지 본다. 있으면 그 내용을 모델에게 보낸다.
      // 찾는 규칙은 배치(oneshot.js)와 한 군데에서 같이 쓴다 — 위 슬래시명령찾기.
      const found = 슬래시명령찾기(session.commands, raw);
      if (found) {
        const { text, error } = loadCommand(found, arg);
        if (error) { say(`  ${c.red('명령을 읽지 못했습니다')} ${error}`); say(''); return { handled: true }; }
        say(`  ${c.cyan('⌘')} ${found.name} ${c.gray(found.source)}`);
        return { handled: false, text };
      }
      // 내장 명령의 오타가 먼저, 이 PC 에서 찾은 명령이 그 뒤다(위 비슷한이름 머리말).
      const near = [...new Set([
        ...비슷한이름(name, Object.keys(COMMANDS)).map((x) => '/' + x),
        ...비슷한슬래시명령(session.commands, raw).map((x) => '/' + x.name),
      ])].slice(0, 5);
      say(`  ${c.red('모르는 명령')} /${name}`);
      if (near.length) say(`  ${c.gray('비슷한 것:')} ${near.join('  ')}`);
      say(`  ${c.gray('/help 로 목록을,  /skills 로 스킬을 봅니다.')}`);
      say('');
      return { handled: true };
    }
  }
}

const INIT_TEMPLATE = `# DEEL.md

이 폴더에서 일할 때 지킬 규칙을 적습니다. deel 가 매번 읽습니다.

## 이 프로젝트

- 무엇을 하는 프로젝트인지 두세 줄

## 명령

- 빌드:
- 시험:
- 실행:

## 규칙

- 고치기 전에 관련 파일을 먼저 읽는다
- (프로젝트에 맞는 규칙을 적으세요)
`;
