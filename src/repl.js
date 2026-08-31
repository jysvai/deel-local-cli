// 대화 화면. 루프가 보내는 이벤트를 Claude Code 풍으로 그린다.
import { createInterface, emitKeypressEvents } from 'node:readline';
import { 규칙모으기 } from './safety/policy.js';
import { 주소가리기 } from './safety/secrets.js';
import { homedir } from 'node:os';
import { resolve, basename } from 'node:path';
import { c, say as 바로쓰기, mark, clip } from './ui/ansi.js';
import { headerLines } from './ui/status.js';
import { 종, 창제목, 제목되돌리기, 알릴까, 제목글 } from './ui/notify.js';
import { 보이기 as 인트로, 기본곁말 } from './ui/intro.js';
import { 언어잡기, 말 as 옮긴말 } from './i18n/index.js';
import { 알림채움 } from './backend/retry.js';
import { 화면고르기 } from './ui/screen.js';
import { STAGES } from './agent/effort.js';
import { handle, COMMANDS, 미리보기끄기, 적용하기 as 그림적용 } from './commands.js';
import { next as nextWork, get as getWork, canWrite, 보일이름, 보일한줄 } from './agent/modes.js';
import { route } from './agent/route.js';
import { run } from './agent/loop.js';
import { Session, repairToolPairs } from './agent/session.js';
import { makeScope } from './safety/guard.js';
import { 언어서버있나 } from './tools/index.js';
import { 모두끄기 as 언어서버다끄기 } from './lsp/client.js';
import { History } from './safety/undo.js';
import { Audit } from './safety/audit.js';
import { activeProfile, load, resolveKey, save as saveCfg, homeDir, 잠금소식 } from './config.js';
import { discover } from './skills/discover.js';
import { allowEndpoint, setOffline, isOffline, isLocalHost } from './safety/network.js';
import { Store, latest, prune } from './agent/store.js';
import { Threads } from './agent/threads.js';
import { 못박기 } from './agent/pins.js';
import { 카드 } from './agent/card.js';
import { 배움 } from './agent/evolve.js';
import { 마크다운 } from './ui/md.js';
import { askHidden } from './ui/prompt.js';
import { explain, shows as levelShows } from './ui/level.js';
import { 고르기 as 승인고르기, 다음 as 승인다음 } from './ui/approve.js';
import { 추천, 채울글 } from './ui/complete.js';
import { 접어쓰기 } from './ui/wrap.js';
import { 접을까 as 붙임접을까, 표만들기 as 붙임표, 펼치기 as 붙임펼치기, 쓴번호들 as 붙임쓴번호들 } from './ui/pastechip.js';
import { probeCtx, 기본값 as CTX_DEFAULT } from './backend/ctxsize.js';
import { renderDiff, shortStat } from './ui/diff.js';
import { expand as expandMentions } from './agent/mention.js';
import { 크기말 } from './backend/vision.js';
import { 다붙이기 } from './backend/mcp.js';
import { 읽기 as 기억읽기 } from './agent/memory.js';
import { 갈래고르기 } from './ui/working.js';
import { 모두끝내기 as 일감모두끝내기, 일감인자 } from './tools/jobs.js';

// 도구마다 눈에 띄는 글자를 다르게 준다. 훑을 때 종류가 먼저 보인다.
const TOOL_GLYPH = {
  Read: c.blue('◧'),
  Write: c.green('◆'),
  Edit: c.yellow('◈'),
  Glob: c.magenta('❋'),
  Grep: c.magenta('❊'),
  Bash: c.hcyan('▶'),
  Skill: c.hmagenta('✦'),
  WebFetch: c.hblue('◍'),
  TodoWrite: c.hyellow('☰'),
  Outline: c.hmagenta('❉'),   // 뼈대 — 찾기(❋❊)와 한 무리라 비슷한 글자로
  Verify: c.hgreen('✓'),      // 확인 — 결과가 초록·빨강으로 갈리는 유일한 도구
  Task: c.hmagenta('⌥'),      // 하위 작업 — 여닫는 줄과 같은 글자를 쓴다
  Jobs: c.hcyan('◐'),         // 뒤에서 도는 것 — Bash(▶)와 한 무리라 같은 색으로
};

// 도구 호출을 한 줄로 요약 — Read(src/a.js) 처럼.
function toolLabel(name, args) {
  const a = args ?? {};
  const first =
    a.file_path ?? a.pattern ?? a.path ?? a.url ?? a.name ?? a.목적 ??
    (a.command ? String(a.command).replace(/\s+/g, ' ').slice(0, 52) : null) ??
    // 뒤에서 도는 명령. 번호가 곧 그 일감의 이름이다 — 빈 괄호를 띄우면
    // 어느 것을 보고 있는지가 화면에서 사라진다. 서너 개를 띄워 놓고 나면
    // `Jobs` 줄이 여러 개 겹치는데, 그때 구별할 것이 번호뿐이다.
    // 번호 없이 부르는 것(목록 보기)은 그대로 괄호가 없다.
    //
    // 이름 고르기는 jobs.js 에 맡긴다. 모델이 `job` 으로 보낼 수도 있는데,
    // 여기서 `a.번호` 만 보면 도구는 제대로 도는데 화면만 빈 괄호가 된다.
    (() => { const g = 일감인자(a); return g.번호 != null ? `${g.번호}번${g.끝내기 ? ' · 끝내기' : ''}` : null; })() ??
    // 한 번에 여러 파일을 쓸 때. 빈 괄호를 띄우면 화면만 보고는 무엇을
    // 만들었는지 알 수 없다 — 첫 파일과 개수를 적는다.
    (Array.isArray(a.files) && a.files.length
      ? `${a.files[0]?.file_path ?? '?'}${a.files.length > 1 ? ` 외 ${a.files.length - 1}개` : ''}`
      : null) ??
    // 한 번에 여러 군데를 고칠 때. 파일 수와 군데 수는 다르다 — 한 파일을
    // 여섯 군데 고치는 것이 보통이라 '외 5개' 라고 적으면 거짓이 된다.
    (Array.isArray(a.edits) && a.edits.length
      ? `${a.edits[0]?.file_path ?? '?'}${a.edits.length > 1 ? ` 외 ${a.edits.length - 1}군데` : ''}`
      : null) ??
    (Array.isArray(a.paths) && a.paths.length ? `${a.paths.length}개` : null) ??
    // 할 일 목록은 보여줄 경로가 없다. 빈 괄호를 띄우느니 개수를 적는다.
    (Array.isArray(a.todos) ? `${a.todos.length}건` : null) ?? '';
  const g = TOOL_GLYPH[name] ?? c.cyan('⏺');
  const 안 = clip(String(first ?? ''), 56);
  return `${g} ${c.bold(name)}${안 ? `${c.gray('(')}${c.gray(안)}${c.gray(')')}` : ''}`;
}

function toolResultLine(result, ms) {
  const t = ms > 700 ? c.gray(`  ${(ms / 1000).toFixed(1)}초`) : '';
  if (result?.error) return `${c.red('└')} ${c.red(clip(String(result.error).split('\n')[0], 80))}${t}`;

  /*
   * 확인 결과는 색으로 갈라 준다.
   *
   * `확인 3개 · 못 확인 2개` 를 회색 한 줄로 적으면 탈이 났는지가 눈에 안 들어온다.
   * 결과가 초록/빨강으로 갈리는 도구는 이것뿐이라 여기서만 따로 그린다 —
   * 그 갈림이 이 도구를 넣은 이유이기도 하다.
   */
  if (typeof result?.탈 === 'number') {
    const 조각 = [];
    if (result.탈) 조각.push(c.red(`탈 ${result.탈}개`));
    if (result.확인됨) 조각.push(c.green(`확인 ${result.확인됨}개`));
    if (result.못확인) 조각.push(c.yellow(`못 확인 ${result.못확인}개`));
    return `${result.탈 ? c.red('└') : c.gray('└')} `
      + `${조각.join(c.gray(' · ')) || c.gray('확인할 것이 없었습니다')}${t}`;
  }

  // 고친 자리는 몇 줄이 늘고 줄었는지를 요약 옆에 붙인다.
  const 셈 = result?.diff ? ` ${shortStat(result.diff)}` : '';
  return `${c.gray('└')} ${c.gray(clip(result?.summary ?? '완료', 80))}${셈}${t}`;
}

// 수준별로 몇 줄까지 펼칠지. 초보에게 60줄을 쏟으면 아무것도 안 읽는다.
const DIFF_LINES = { 쉬움: 14, 개발자: 40 };

// 모델의 말 앞에 세우는 세로줄. 도구 줄과 눈으로 갈리게 하는 유일한 표시다.
const 답표시 = c.hcyan('▌');

/**
 * 줄 끝 백틱이 "이어쓰기" 표시인가.
 *
 * 예전에는 백틱 하나로 끝나기만 하면 표시로 봤다. 그런데 코딩 도구에서
 * "read `config.json`" · "echo `date`" 처럼 **인라인 코드로 끝나는 줄**은
 * 아주 흔하다. 그 줄들이 전부 안 보내지고, 닫는 백틱까지 뜯긴 채 이어쓰기
 * 모드에 갇혔다 — 사람 눈에는 Enter 가 그냥 안 먹는 것으로 보인다.
 *
 * 그래서 조건을 둘로 좁혔다. 백틱 앞이 **빈칸**이고(또는 백틱만 있는 줄이고),
 * 그 줄에 백틱이 **그것 하나뿐**일 때만 표시로 본다. 인라인 코드는 백틱이
 * 둘이라 안 걸리고, ``` 울타리는 앞이 백틱이라 안 걸린다.
 *
 * 검사에서 표를 만들어 재려고 밖으로 뺐다.
 */
export const 이어쓰기표시 = (l) =>
  /(^|\s)`$/.test(l) && (String(l).match(/`/g) ?? []).length === 1;

export async function chatLoop(opts = {}) {
  const cfg = load();
  const prof = activeProfile(cfg);
  // 연결이 없으면 화면을 세우기 전에 끝난다. 세운 뒤에 나가면 상자를
  // 그렸다 지우는 제어문자가 이 안내 사이에 끼어 화면이 지저분해진다.
  if (!prof) {
    바로쓰기('');
    바로쓰기(`  ${mark.warn} 저장된 연결이 없습니다. ${c.cyan('deel setup')} 을 먼저 실행하세요.`);
    바로쓰기('');
    return 1;
  }

  // 평문으로 있던 열쇠를 방금 잠갔으면 그렇다고 한 줄. 조용히 바꾸면
  // 나중에 설정 파일을 열어 본 사람이 제 열쇠가 사라진 줄 안다.
  const 잠금 = 잠금소식();
  if (잠금) {
    바로쓰기('');
    바로쓰기(`  ${mark.ok} ${잠금}`);
  }

  /*
   * 여기서부터 화면에 나가는 것은 전부 `화면` 을 거친다.
   *
   * `say` 를 지역 이름으로 다시 묶은 이유: 이 함수 안에 출력이 79군데 있었다.
   * 이름을 60번 바꿔 적으면 그중 한둘은 반드시 어긋나고, 어긋난 자리는
   * 화면에서만 티가 난다. 이름은 그대로 두고 **가는 곳만** 바꾼다.
   * 그러면 갈라내기가 옳은지를 지금 있는 검사들이 그대로 재 준다 —
   * 글자 하나라도 달라지면 검사가 잡는다.
   *
   * 이 파일 밖으로 나가는 이름이 아니다. 화면을 세우기 전에 쓰는 자리는
   * 위처럼 `바로쓰기` 를 쓴다.
   */
  const 화면 = await 화면고르기({ tui: opts.tui });
  const say = (s = '') => 화면.줄(s);

  const root = opts.root ? opts.root : process.cwd();
  const conn = {
    kind: prof.kind, base: prof.baseUrl, auth: prof.auth,
    key: resolveKey(prof), model: prof.model,
    // 컨텍스트 길이. 순서가 곧 우선순위다 —
    //   deel --ctx 655360  >  프로필에 저장된 값  >  기본값
    // 기본값으로 떨어졌다는 것은 '아직 못 쟀다' 는 뜻이다. 아래에서 그렇다고 말해 준다.
    ctx: opts.ctx ?? prof.ctx ?? CTX_DEFAULT,
    // 답 길이 상한. 컨텍스트와 다른 축이다 — 없으면 effort.js 의 울타리를 쓴다.
    //   deel --max-tokens 32k  >  프로필에 저장된 값  >  서버에서 알아낸 값  >  기본값
    maxTokens: opts.maxTokens ?? prof.maxTokens ?? null,
    streaming: prof.streaming ?? false,
    tools: prof.tools ?? false, json: prof.json ?? false, think: prof.think ?? false,
    // 그림을 볼 수 있는 모델인지. 못 보면 바이트를 아예 안 싣는다 (backend/vision.js).
    vision: prof.vision ?? false,
  };

  // 이 자리 하나만 연다. 다른 어디로도 나가지 못한다.
  allowEndpoint(conn.base);
  // 관리 정책이 offline 을 못박아 뒀으면 옵션과 상관없이 켠다 (safety/policy.js).
  if (opts.offline ?? prof.offline ?? cfg?.offline) setOffline(true);

  /*
   * ── 끝났을 때 알리기 ─────────────────────────────────────────────────
   *
   * 로컬 모델은 느리다. 7B 를 CPU 로 돌리면 한 턴에 2~3분이 예사고, 그동안
   * 사람은 다른 창으로 간다. 돌아와 보면 5분 전에 끝나 있거나, 더 나쁘게는
   * "실행할까요?" 에서 3분째 멈춰 서 있다 — 물어본 줄을 몰라서.
   *
   * 폴더 이름을 같이 들고 있는다. 창을 여럿 띄워 놓고 쓰는 사람이 많은데
   * 전부 'deel' 이면 어느 탭이 끝난 건지 알 수가 없다. (ui/notify.js)
   */
  const 알림 = { 켬: cfg.bell !== false, 폴더: basename(root) };

  // 지난번에 /motion 으로 골라 둔 그림을 되살린다. 화면을 세우기 **전에**
  // 해야 첫 판부터 맞다 — 뒤에 하면 켜자마자 한 번은 기본 그림이 스친다.
  그림적용(cfg.motion);

  /*
   * 화면 말을 여기서 한 번 정한다.
   *
   * 켤 때 딱 한 번이면 된다 — 그 뒤로는 /lang 이 바꾼다. 환경변수가 설정을
   * 이긴다. 한 번만 영어로 켜 보려는 사람이 설정을 건드리지 않고
   * `DEEL_LANG=en deel` 로 할 수 있어야 하기 때문이다. (i18n/index.js)
   */
  언어잡기({ cfg });

  const session = new Session(conn, {
    root,
    mode: opts.mode ?? 'auto',
    // 처음부터 원하는 모드로 시작할 수 있다 — deel --work plan
    work: opts.work ?? null,
    // 수준은 설정에 남는다. 한 번 고르면 다음에 켤 때도 그대로다.
    level: opts.level ?? cfg.level ?? null,
    think: opts.think ?? 'medium',
    effort: opts.effort ?? 'save',
    maxSteps: opts.maxSteps ?? null,   // null 이면 작업 모드가 정한다
  });

  // ── 대화 이어하기 ─────────────────────────────────────────────────────
  // 껐다 켜도 이어지도록, 메시지가 오갈 때마다 .deel/sessions/ 에 바로 적는다.
  let store = null;
  if (opts.sessionId || opts.continue) {
    const target = opts.sessionId ?? latest(root)?.id;
    if (!target) {
      say('');
      say(`  ${c.gray('이어할 대화가 없습니다. 새로 시작합니다.')}`);
    } else {
      store = new Store(root, target);
      const { messages: 적힌것 } = store.load();
      /*
       * 도구가 도는 중에 죽었으면 호출만 적히고 결과가 없다. 그대로 보내면
       * 규격 서버가 400 을 내서 이어받자마자 첫 마디에서 죽는다. 손봐서 받는다.
       */
      const { messages, 고친것 } = repairToolPairs(적힌것);
      if (messages.length) {
        session.messages = messages;
        say('');
        say(`  ${mark.ok} ${c.bold(target)} ${c.gray(`— 메시지 ${messages.length}개를 이어 받았습니다.`)}`);
        if (고친것) {
          say(`  ${c.gray(`중단된 도구 호출 ${고친것}개를 걷어냈습니다 — 그때 하던 일은 다시 시켜 주세요.`)}`);
        }
      }
      /*
       * 못 박아 둔 것도 같이 되살린다 (agent/pins.js).
       *
       * 이걸 안 되살리면 '접어도 요약해도 안 지워진다' 가 **껐다 켜는 한 번에**
       * 거짓이 된다. 사람은 이미 말했다고 믿고 있으니 다시 말하지 않는다.
       */
      const 박힌것 = store.못박은것읽기();
      if (박힌것.length) {
        session.못박은것 = new 못박기(박힌것);
        say(`  ${c.gray(`못 박아 둔 것 ${session.못박은것.개수()}개도 그대로 이어 받았습니다 —`)} ${c.cyan('/pin')}`);
      }
    }
  }
  if (!store) store = new Store(root);
  store.begin({ model: conn.model, base: 주소가리기(conn.base), root });
  try { prune(root); } catch {}

  /*
   * 밖에서 붙인 도구(MCP) 서버를 띄운다.
   *
   * 기본은 꺼져 있다 — .deel/mcp.json 에 사람이 직접 적어야만 뜬다. 남의
   * 프로그램을 띄우는 일이라, 이 프로젝트가 존재하는 이유('미승인 SW 반입 금지')
   * 와 정면으로 부딪히기 때문이다. 자물쇠(--offline)가 걸려 있으면 아예 안 띄운다.
   */
  const mcp붙임 = await 다붙이기(root, {
    offline: isOffline(),
    audit: new Audit(root),
  });

  // 이 PC 에 있는 스킬·명령·플러그인을 찾아 붙인다. 품고 다니지 않는다.
  const found = discover(root);
  session.skills = found.skills;
  session.commands = found.commands;
  session.plugins = found.plugins;
  // 세션도 알아야 한다 — 밖에서 붙인 도구도 스키마가 매 요청에 실린다.
  // 안 세면 컨텍스트가 그만큼 조용히 줄어든다.
  session.mcp = mcp붙임.서버들;
  /*
   * 이 자리에 언어 서버가 깔려 있나 (Def·Refs 를 목록에 넣을지).
   *
   * 여기서 한 번만 잰다. PATH 훑기와 폴더 훑기라 값이 있고, 세션 도중에
   * 답이 바뀌지 않는다. 아무것도 안 깔아 준다 — 있으면 쓰고 없으면 없는 대로
   * Grep·Outline 으로 간다 (lsp/servers.js 머리말).
   */
  session.lsp = 언어서버있나(root);
  // 지난 대화에서 정해 둔 것을 들고 시작한다.
  // 기억은 Session 이 켤 때 직접 읽는다 (session.js 생성자) — deel run 도 같은 것을 들고 시작하게.

  /*
   * 입력 상자를 쓸 때는 readline 이 스스로 되비추지 못하게 한다.
   *
   * readline 은 자기가 아는 커서 자리를 기준으로 지우고 다시 그린다. 그런데
   * 그 자리는 우리가 그린 상자 테두리 안이 아니라 줄 맨 앞이다. 그대로 두면
   * 백스페이스가 테두리를 갉아먹고, 긴 글이 접힐 때 상자가 무너진다.
   *
   * 그래서 되비추는 일만 뺏는다. 어디까지나 **되비추기만** 이다 — 한글 조합,
   * 붙여넣기, 위아래 이력, Ctrl+A/E, 백스페이스는 전부 readline 이 그대로
   * 맡는다. 우리는 readline 이 들고 있는 글(rl.line)을 상자 안에 그릴 뿐이다.
   * 줄 편집을 직접 짜기 시작하면 한글 입력기부터 깨진다.
   */
  const 상자쓰나 = 화면.kind === 'box';
  // 사람이 지금 입력을 기다리는 중인가. 도구가 도는 동안 키를 눌러도
  // 상자를 다시 그리면 안 된다 — 그 자리는 이미 대화가 흘러가고 있다.
  let 입력기다림 = false;
  // 되묻는 중이면 그 앞머리. 상자 대신 한 줄로 되비춘다.
  let 묻는중 = null;
  // 이번 틱에 다시 그리기로 이미 잡아 뒀나 (붙여넣기로 키가 쏟아질 때)
  let 그릴예정 = false;
  const 먹통 = { write() { return true; }, end() {}, on() {}, once() {}, emit() {}, removeListener() {} };
  const rl = createInterface({
    input: process.stdin,
    output: 상자쓰나 ? 먹통 : process.stdout,
    terminal: 상자쓰나 ? true : undefined,
    historySize: 200,
    /*
     * 빈 완성기. 아무것도 안 내놓지만 **달아 둬야** 한다.
     *
     * 네 가지를 실제로 눌러 보고 정했다.
     *
     *   완성기 없음   Tab → 줄에 리터럴 탭이 박힌다 (`/hel` + Tab → `/hel\t`).
     *                 그 글이 그대로 모델에게 간다. 검사 6개가 여기서 빨개진다.
     *   진짜 완성기   readline 이 자기 방식으로 줄을 고쳐 버린다. 우리가 그린
     *                 상자와 어긋나고, 후보가 있는 줄에서 Shift+Tab 을 누르면
     *                 승인 방식만 바뀌어야 하는데 글까지 바뀐다.
     *   빈 완성기     Tab 도 Shift+Tab 도 줄을 안 건드린다. ← 이것
     *
     * 그래서 readline 에게서는 '줄을 안 건드림' 만 받고, 무엇을 채울지는 우리가
     * rl.write 로 직접 정한다. rl.write 는 공개 API 라 한글도 안 깨진다.
     */
    completer: 상자쓰나 ? (line) => [[], line] : undefined,
  });

  // 입력을 큐로 받는다. rl.question 을 겹쳐 쓰면 파이프로 넣을 때 닫혀 버린다.
  const queue = [];
  let waiter = null;
  let closed = false;
  const echo = !process.stdin.isTTY;   // 파이프·기록용일 때는 입력을 되비춘다

  /*
   * 줄 끝에 ` (백틱) 을 붙이면 "아직 안 끝났다" 는 뜻이다 — 여러 줄을 한
   * 메시지로 묶어 보낼 때 쓴다. 확정된 줄은 여기 쌓아 두다가, ` 없이 끝나는
   * 줄이 오면 그때 \n 으로 이어붙여 한 메시지로 내보낸다.
   *
   * 실제 개행을 상자(rl.line) 안에 넣어서는 **안 된다**. 화면은 멀쩡히
   * 그려지지만, Enter 로 보낼 때 readline 의 history 가 그 줄을 \n 에서
   * 쪼개 거꾸로 쌓고 \r 로 다시 붙여 돌려준다. "안녕\n반가워" 를 보내면
   * 'line' 이벤트에 오는 값은 "반가워\r안녕" 이다 — 사람이 쓴 순서가
   * 뒤집혀서 모델에게 간다. historySize 를 0 으로 두면 안 그러니 history 가
   * 하는 짓이 맞다. 그래서 개행은 rl.line 밖, 여기서만 다룬다.
   *
   * 백슬래시(\) 가 아니라 백틱을 고른 것은 일부러다 — 이 프로그램은 윈도우
   * 경로(`C:\Users\...`)를 늘 다루는데, 그 끝은 흔히 백슬래시로 끝난다.
   * 백슬래시를 표로 쓰면 평범한 경로를 붙여넣기만 해도 계속 이어 치는 것으로
   * 잘못 읽힌다. 백틱은 그럴 일이 없다.
   */
  let 이어쓰기줄들 = null;
  /*
   * 쌓인 줄을 이미 화면에 찍어 두었나.
   *
   * 줄 끝 백틱으로 이어 쓸 때는 줄쌓기() 가 치는 족족 찍는다. 붙여넣기는
   * 일부러 안 찍는다(스무 줄이 주르륵 지나가지 않게). 보낼 때 무엇을 다시
   * 찍을지가 그것으로 갈린다 — 이걸 안 가르면 같은 줄이 두 번 보이거나
   * 붙여넣은 앞부분이 통째로 안 보인다.
   */
  let 이어쓴것 = false;

  /*
   * ── 상자 안에서 줄을 바꾼다 ────────────────────────────────────────────
   *
   * 전에는 Option+Enter 를 누르면 그때까지 친 줄을 상자 **위로** 올려 찍고
   * 빈 상자를 다시 내줬다. 화면에는 이렇게 남는다 —
   *
   *   ❯ 첫째 줄
   *     … 다음 줄. 그냥 Enter 로 보냅니다
   *   ╭──────────────────╮
   *   │ ❯                │
   *   ╰──────────────────╯
   *
   * 보낼 글이 두 군데로 쪼개져 있으니 고칠 수가 없다. 위로 올라간 줄은 이미
   * 찍힌 글자라 백스페이스가 안 닿는다. "한 번에 보낼 거면 위로 올릴 이유가
   * 뭐냐" 는 말이 맞다 — 사람이 원하는 것은 상자가 두 줄로 늘어나는 것이다.
   *
   * 못 하고 있었던 진짜 이유는 readline 의 이력이다. rl.line 에 \n 을 넣고
   * Enter 를 치면 이력이 그 줄을 \n 에서 쪼개 거꾸로 쌓고 \r 로 도로 붙인다.
   * 지금 이 자리에서 다시 재 봤다(node 24.19) —
   *
   *   rl.line = 'a\nb'  → 'line' 이벤트가 주는 값: "b\ra"
   *   historySize: 0    → "a\nb"          (이력을 끄면 멀쩡하다)
   *
   * 이력을 끌 수는 없다. 위 화살표로 지난 입력을 부르는 것은 훨씬 자주 쓴다.
   *
   * 그래서 **줄바꿈을 \n 이 아닌 글자로 들고 있는다.** 이력에게는 그냥 평범한
   * 글자 하나라 쪼갤 거리가 없고, 화면에 그리기 직전과 보내기 직전에만 \n 으로
   * 바꾼다. 길이가 1:1 이라 rl.cursor 값도 그대로 쓸 수 있다.
   *
   * 사용자 영역(U+E000)에서 골랐다. 어느 글꼴에도 뜻이 없고 어느 문서에도
   * 안 들어 있는 자리라, 붙여넣기로 우연히 섞여 들어올 일이 없다.
   */
  const 줄표 = '\uE000';
  const 펴기 = (s) => String(s ?? '').replaceAll(줄표, '\n');

  /*
   * 지금 도는 턴의 AbortController. 아래 SIGINT 와 키 처리(ESC)가 같이 본다.
   *
   * **여기 선언한 이유가 있다.** 키 처리는 이 아래에서 바로 걸리는데, 그
   * 사이에 인트로를 기다리는 await 가 있다. 선언을 아래에 두면 인트로가
   * 도는 동안 키를 누르는 순간 아직 만들어지지 않은 이름을 읽어 터진다
   * (TDZ). 켜자마자 아무 키나 누르면 죽는 프로그램이 되는 셈이다.
   */
  let turn = null;

  /*
   * 멈추라는 것이 닿았다고 **곧바로** 화면에 적는다.
   *
   * 멈추기는 즉시가 아니다. 돌던 자식 프로그램(rg·soffice)을 죽이고, 안 돈
   * 도구 자리를 채우고, 대화를 성하게 닫는 데 잠깐이 걸린다. 그 잠깐 동안
   * 화면이 아까 하던 말을 그대로 하고 있으면 사람은 안 먹었다고 판단한다.
   * 그러면 또 누르고, 그러다 Ctrl+C 로 손이 가고, 두 번 누르면 대화가 닫힌다.
   *
   * "ESC 를 눌러도 안 멈춘다" 는 제보의 절반은 진짜로 안 멈춘 것이었고
   * (동기 호출이 키를 안 배달했다), 나머지 절반이 이것이다 — 멈추고는
   * 있는데 그렇게 보이지 않았다.
   */
  const 멈추는중 = () => { try { 화면.일바꿈('멈춤'); } catch { /* 상자가 없는 화면도 있다 */ } };

  // 붙여넣는 중인가 (bracketed paste). 키 처리와 'line' 이 같이 본다.
  let 붙여넣는중 = false;

  /*
   * ── 붙여넣은 덩이를 접어 둔다 ────────────────────────────────────────
   *
   * 상자에 남는 것은 `[붙여넣기 #1 · 47줄 · 2.1KB]` 한 줄이고, 원문은
   * 여기 그대로 있다가 보낼 때 되돌아간다. 왜 접는지는 pastechip.js 에.
   *
   * 접기 전 화면이 어디까지였는지도 같이 적어 둔다. 붙여넣기는 커서
   * 자리에 끼어 들어오므로, 무엇이 새로 온 것인지는 시작 표를 받은
   * 순간을 기억해 두어야만 안다.
   */
  const 붙인것들 = new Map();
  let 붙임번호 = 0;
  let 붙임앞줄수 = 0;
  let 붙임앞입력 = '';

  /** 줄을 쌓아 두고 "다음 줄" 이라고 알린다. 백틱 표시와 Alt+Enter 가 같이 쓴다. */
  const 줄쌓기 = (줄) => {
    const 첫줄 = 이어쓰기줄들 === null;
    이어쓴것 = true;   // 아래에서 바로 찍는다
    (이어쓰기줄들 ??= []).push(줄);
    화면.입력지움();
    say(`${첫줄 ? ` ${c.hcyan('❯')} ` : '   '}${c.white(줄)}`);
    say(`   ${c.gray('… 다음 줄. 그냥 Enter 로 보냅니다 · Ctrl+C 로 취소')}`);
  };

  rl.on('line', (원래줄) => {
    // 상자 안에서 바꾼 줄을 여기서 진짜 줄바꿈으로 되돌린다. 아래 코드는
    // 전부 평범한 \n 만 본다 — 줄표가 이 아래로는 한 글자도 안 새어 나간다.
    const l = 펴기(원래줄);
    if (echo) say(c.gray(l));
    /*
     * 붙여넣는 도중의 줄바꿈은 **사람이 Enter 를 친 것이 아니다.**
     *
     * 안 가려내면 스무 줄짜리를 붙였을 때 스무 번 물어본 것이 된다. 쌓아
     * 두었다가 사람이 진짜로 Enter 를 칠 때 한 덩이로 나간다 — 줄 끝 백틱과
     * 같은 자리에 쌓으므로, 아래 잇는 코드가 그대로 처리한다.
     *
     * 화면에는 아직 안 그린다. 붙이는 동안 줄마다 그리면 스무 줄이 주르륵
     * 지나가고, 정작 무엇을 보낼지는 안 보인다. 끝날 때 몇 줄인지만 알린다.
     */
    if (붙여넣는중) { (이어쓰기줄들 ??= []).push(l); return; }
    let 보낼것 = l;
    if (상자쓰나) {
      if (묻는중 !== null) {
        // 되묻는 자리: 답을 그 줄에 남긴 채 줄만 넘긴다.
        process.stdout.write(`\r\x1b[2K${묻는중}${c.white(l)}\n`);
      } else if (입력기다림) {
        // 표시 자체와 그 앞 빈칸은 사람이 친 글이 아니라 문법이다. 같이 뗀다.
        if (이어쓰기표시(l)) {
          줄쌓기(l.slice(0, -1).replace(/\s+$/, ''));
          return;
        }
        // 상자를 걷어내고, 사람이 보낸 글을 대화에 남긴다. 안 남기면 스크롤을
        // 올렸을 때 답만 있고 무엇을 물었는지가 없다.
        const 이었나 = 이어쓰기줄들 !== null;
        보낼것 = 이었나 ? [...이어쓰기줄들, l].join('\n') : l;
        이어쓰기줄들 = null; 이어쓴것 = false;
        화면.입력지움();
        /*
         * ── 보낸 것을 **보낸 그대로** 남긴다 ──────────────────────────────
         *
         * 여기서 `l` 만 찍고 있었다. 그런데 `l` 은 **마지막 줄**뿐이다 —
         * 앞줄들은 이어쓰기줄들 에 쌓여 있다. 줄 끝 백틱으로 이어 쓸 때는
         * 줄쌓기() 가 치는 족족 화면에 찍어 두었으니 그걸로 맞았는데,
         * 붙여넣기는 일부러 안 찍는다(스무 줄이 주르륵 지나가지 않게).
         *
         * 그래서 붙여넣고 Enter 를 치면 **보낸 것의 마지막 조각만** 화면에
         * 남았다. 사람은 앞부분이 안 갔다고 생각하고 다시 붙여넣는다.
         *
         * 찍을 것은 보낼것 이다. 화면에 남는 것과 모델에게 가는 것이 같아야
         * 나중에 스크롤을 올려서 무엇을 시켰는지 알아볼 수 있다.
         *
         * 백틱으로 이어 쓴 경우에는 앞줄이 이미 찍혀 있으므로 마지막 줄만
         * 이어 찍는다 — 안 그러면 같은 줄이 두 번 보인다.
         */
        const 찍을것 = 이어쓴것 ? l : 보낼것;
        if (찍을것.trim() || 이었나) {
          for (const [i, 한줄] of String(찍을것).split('\n').entries()) {
            say(`${i === 0 && !이어쓴것 ? ` ${c.hcyan('❯')} ` : '   '}${c.white(한줄)}`);
          }
        }
      } else if (l.trim() || 이어쓰기줄들 !== null) {
        /*
         * 일하는 도중에 미리 쳐 둔 것.
         *
         * ── 여기서도 줄 끝 백틱이 먹어야 한다 ────────────────────────────
         *
         * 예전에는 이 갈래에 이어쓰기가 아예 없었다. 그래서 **일하는 도중에**
         * 여러 줄을 치면 백틱이 그냥 글자로 나갔다 — 첫 줄이 백틱을 단 채로
         * 혼자 보내지고, 다음 줄은 따로 또 보내진다. 사람 눈에는 줄바꿈이
         * 안 먹는 것으로 보인다. 기다릴 때는 되고 일할 때는 안 되니, 되는
         * 자리를 찾기도 어렵다.
         *
         * 미리 치는 것은 일하는 중에 하는 짓이라 오히려 여기가 더 흔하다.
         *
         * 그리는 것은 다르게 한다. 줄쌓기() 는 대화에 줄을 찍는데, 일하는
         * 도중에 찍으면 이미 보낸 것처럼 보인다. 여기서는 조용히 쌓고
         * 상자에 몇 건이 밀려 있는지만 세어 준다.
         */
        if (이어쓰기표시(l)) {
          (이어쓰기줄들 ??= []).push(l.slice(0, -1).replace(/\s+$/, ''));
          화면.대기갱신('', queue.length + 1);
          return;
        }
        if (이어쓰기줄들 !== null) {
          보낼것 = [...이어쓰기줄들, l].join('\n');
          이어쓰기줄들 = null; 이어쓴것 = false;
        }
        화면.대기갱신('', queue.length + 1);
      }
    }
    /*
     * ── 접어 둔 붙여넣기를 여기서 편다 ──────────────────────────────────
     *
     * 화면에 남는 것과 모델에게 가는 것이 여기서만 일부러 다르다. 화면에는
     * `[붙여넣기 #1 · 47줄 · 2.1KB]` 이 남고, 모델에게는 그 47줄이 그대로
     * 간다. 표가 무엇을 담고 있었는지를 말해 주므로 나중에 스크롤을 올려도
     * 무엇을 시켰는지 알아볼 수 있다.
     *
     * 펴는 자리는 여기 한 군데다. 미리 쳐 둔 것이든 기다리다 보낸 것이든
     * 결국 이 줄을 지나가므로, 여기서 펴면 어느 길로 와도 원문이 간다.
     */
    const 펴진것 = 붙임펼치기(보낼것, 붙인것들);
    // 다 쓴 것은 치운다. 안 치우면 대화가 길어질수록 붙인 원문이 계속 쌓인다.
    for (const 번호 of 붙임쓴번호들(보낼것)) 붙인것들.delete(번호);
    if (waiter) { const w = waiter; waiter = null; w(펴진것); }
    else queue.push(펴진것);
  });
  rl.on('close', () => {
    closed = true;
    if (waiter) { const w = waiter; waiter = null; w(null); }
  });

  /*
   * 지금 치고 있는 글에 맞는 명령들.
   *
   * 수준에 따라 감춘 명령이 있다(쉬움에서는 자주 쓰는 것만 보인다). 그런데
   * **감춘 것이 못 쓰는 것은 아니다** — 치면 그대로 돌아간다. 그래서 보이는
   * 것 중에 맞는 게 없으면 감춘 것까지 뒤진다. `/recall` 을 아는 사람이
   * 쉬움 수준이라는 이유로 "그런 명령 없다" 는 화면을 보면 안 된다.
   */
  const 지금추천 = (글) => {
    const 보이는것 = Object.keys(COMMANDS).filter((n) => n !== 'quit' && levelShows(session.level, n));
    const 것 = 추천(글, COMMANDS, 보이는것);
    if (것.length) return 것;
    return 추천(글, COMMANDS, Object.keys(COMMANDS).filter((n) => n !== 'quit'));
  };

  /*
   * 키를 가로챈다 — 터미널일 때만.
   *
   * 파이프로 넣을 때 가로채면 입력이 깨진다. 검사와 데모가 그렇게 돌아간다.
   *
   * ── Shift+Tab 은 무엇을 돌려야 하나 ──────────────────────────────────
   *
   * 전에는 **작업 모드**(종합/코드/계획…)를 돌렸다. 바꾼다. Shift+Tab 은
   * **승인 방식**을 돌린다 — 안 묻고 고칠지, 매번 물을지.
   *
   * 두 가지가 이 자리를 놓고 다퉜는데, 자주 눌러야 하는 쪽이 이겨야 한다.
   * 작업 모드는 요청을 보고 저절로 옮겨 가므로 사람이 손댈 일이 드물다.
   * 반면 승인 방식은 "이번 건 좀 봐야겠다" 싶을 때 **일하는 도중에** 바꾸고
   * 싶어진다. 그리고 이건 안전 설정이라, 손이 기억하는 자리에 있어야 한다.
   * 다른 도구(Claude Code)도 같은 키에 같은 것을 둔다.
   *
   * 작업 모드는 Ctrl+O 로 옮겼다. `/work` 도 그대로 된다.
   */
  if (process.stdin.isTTY) {
    emitKeypressEvents(process.stdin, rl);
    /*
     * ── 붙여넣기를 한 덩이로 받는다 ──────────────────────────────────────
     *
     * 여러 줄을 복사해 붙이면 터미널은 그것을 그냥 **타자로** 흘려보낸다.
     * 줄바꿈마다 readline 이 'line' 을 하나씩 쏘므로, 스무 줄을 붙이면
     * **스무 번 물어본 것**이 된다. 한 덩이로 보내려던 글이 스무 조각으로
     * 쪼개져 나가고, 그만큼 요청도 스무 번 나간다.
     *
     * `\x1b[?2004h` 를 보내면 터미널이 붙여넣기를 표로 감싸 준다
     * (bracketed paste). 시작에 `\x1b[200~`, 끝에 `\x1b[201~` 가 온다.
     * 그 사이에 오는 줄은 **사람이 Enter 를 친 것이 아니므로** 안 보내고
     * 쌓아 두었다가, 붙여넣기가 끝나고 사람이 Enter 를 칠 때 한 덩이로 낸다.
     * 쌓는 자리는 줄 끝 백틱이 쓰는 것과 같다(이어쓰기줄들).
     *
     * 모르는 터미널은 이 글자를 그냥 무시한다 — 그러면 예전 그대로 돈다.
     */
    process.stdout.write('\x1b[?2004h');
    process.on('exit', () => { try { process.stdout.write('\x1b[?2004l'); } catch { /* 이미 닫혔다 */ } });

    process.stdin.on('keypress', (_ch, key) => {
      if (key?.sequence === '\x1b[200~') {
        붙여넣는중 = true;
        붙임앞줄수 = 이어쓰기줄들?.length ?? 0;
        붙임앞입력 = rl.line ?? '';
        return;
      }
      if (key?.sequence === '\x1b[201~') {
        붙여넣는중 = false;
        /*
         * 이번에 들어온 것만 골라낸다.
         *
         * 붙여넣기에 줄바꿈이 있었으면 readline 이 줄마다 'line' 을 쐈고,
         * 그 줄들은 붙임앞줄수 뒤에 쌓여 있다. 마지막 조각은 아직 입력칸에
         * 남아 있다. 그리고 붙이기 전에 치고 있던 글(앞머리)은 **첫 줄
         * 앞에 붙어서** 같이 나갔으므로 떼어 내야 한다.
         *
         * 커서를 글 가운데 두고 붙이면 어디까지가 붙인 것인지 가릴 수
         * 없다. 그때는 접지 않는다 — 접기는 되돌릴 수 있어야 하고, 잘못
         * 가른 접기는 못 되돌린다.
         */
        const 새줄들 = (이어쓰기줄들 ?? []).slice(붙임앞줄수);
        const 지금입력 = rl.line ?? '';
        const 앞머리 = 붙임앞입력;
        let 붙인줄들 = null;
        if (새줄들.length) {
          if (!앞머리 || 새줄들[0].startsWith(앞머리)) {
            붙인줄들 = [새줄들[0].slice(앞머리.length), ...새줄들.slice(1), 지금입력];
          }
        } else if (지금입력.startsWith(앞머리)) {
          붙인줄들 = [지금입력.slice(앞머리.length)];
        }
        const 붙인것 = 붙인줄들 ? 펴기(붙인줄들.join('\n')) : '';
        const 폭 = Math.max(20, (process.stdout.columns ?? 80) - 8);

        if (붙인줄들 && 입력기다림 && 묻는중 === null && 붙임접을까(붙인것, { 폭 })) {
          const 번호 = ++붙임번호;
          붙인것들.set(번호, 붙인것);
          이어쓰기줄들 = 붙임앞줄수 ? (이어쓰기줄들 ?? []).slice(0, 붙임앞줄수) : null;
          if (이어쓰기줄들 === null) 이어쓴것 = false;
          const 표 = 붙임표(번호, 붙인것);
          rl.line = 앞머리 + 표;
          rl.cursor = rl.line.length;
          화면.입력지움();
          say(`  ${c.gray(`${표} — 접어 뒀습니다. 보낼 때 그대로 펴집니다.`)}`);
        } else if (이어쓰기줄들?.length && 입력기다림) {
          // 접지 않은 덩이는 몇 줄인지라도 알려 준다. 안 보이면 사라진 줄
          // 알고 다시 붙인다.
          화면.입력지움();
          say(`  ${c.gray(`${이어쓰기줄들.length + 1}줄을 붙여넣었습니다 — Enter 로 한 번에 보냅니다`)}`);
        }
        화면.입력갱신?.(session, 펴기(rl.line), rl.cursor ?? 0);
        return;
      }
      /*
       * ── ESC 로 하던 일을 멈춘다 ────────────────────────────────────────
       *
       * 여태 멈추는 길은 Ctrl+C 뿐이었다. 그런데 Ctrl+C 는 **한 번 더 누르면
       * 프로그램을 끝낸다.** 급히 멈추려고 두 번 누르면 대화가 통째로 닫힌다.
       * (Ctrl+Z 는 더 나쁘다 — 셸이 프로세스를 재워 버려서 대화가 끊긴다.)
       *
       * ESC 는 **멈추기만** 한다. 끝내지 않는다. 그래서 마음 놓고 누를 수 있다.
       * 도는 중이 아닐 때는 아무것도 안 한다 — 입력칸에서 ESC 를 눌렀다고
       * 치던 글이 날아가면 그게 더 놀랍다.
       */
      if (key?.name === 'escape' && !key.ctrl && !key.meta && !key.shift) {
        if (turn && !turn.signal.aborted) { turn.abort(); 멈추는중(); return; }
        return;
      }
      // Shift+Tab — 승인 방식 (자동 → 위험만 → 모두)
      if (key && key.name === 'tab' && key.shift) {
        const 앞 = 승인고르기(session.mode);
        session.mode = 승인다음(session.mode);
        const 뒤 = 승인고르기(session.mode);
        화면.입력지움();
        say(`  ${뒤.색(뒤.글자)} ${c.bold(뒤.색(뒤.이름))}  ${c.gray(뒤.한줄)}`);
        say(`  ${c.gray(`${앞.이름} → ${뒤.이름} · Shift+Tab 으로 계속 바꿉니다`)}`);
        prompt();
        return;
      }
      // Ctrl+O — 작업 모드 (종합/코드/계획/설계/디버그/묻기/총괄)
      if (key && key.ctrl && key.name === 'o') {
        session.work = nextWork(session.work);
        const w = getWork(session.work);
        화면.입력지움();
        say(`  ${c.hcyan(w.glyph)} ${c.bold(보일이름(w.id))} ${c.gray('(' + w.en + ')')}  ${c.gray(보일한줄(w.id))}`
          + (canWrite(session.work) ? '' : `  ${c.green('· 파일을 못 바꿉니다')}`));
        prompt();
        return;
      }
      /*
       * Tab — 치던 슬래시 명령을 채운다.
       *
       * 하나만 맞으면 끝까지, 여럿이면 다 같이 가진 앞부분까지. 목록에서
       * 위아래로 고르게 하지 않는다 — 그러면 지난 입력 이력(위 화살표)을
       * 뺏어야 하는데, 그건 훨씬 자주 쓰는 기능이다.
       */
      if (key && key.name === 'tab' && !key.shift && 상자쓰나 && 입력기다림 && 묻는중 === null) {
        const 채울 = 채울글(펴기(rl.line), 지금추천(펴기(rl.line)));
        if (채울) rl.write(채울);
        // 채울 게 없어도 그리기는 한다 — 후보 목록이 그대로 남아 있어야 한다.
        화면.입력갱신(session, 펴기(rl.line), rl.cursor ?? 0, 지금추천(펴기(rl.line)));
        return;
      }
      /*
       * 친 것을 상자 안에 그린다.
       *
       * readline 이 이 키를 처리하고 rl.line 을 고친 **뒤에** 그려야 하는데,
       * keypress 는 그 전에 온다. 그래서 한 틱 미룬다. 안 미루면 늘 한 글자
       * 뒤처진 글이 보인다 — 치는 사람 눈에는 마지막 글자가 안 찍히는 것으로
       * 보이고, 그게 제일 못 미더운 화면이다.
       */
      if (!상자쓰나) return;
      if (key && key.name === 'return') {
        /*
         * Alt+Enter(맥은 Option+Enter) 만 여기서 잡을 수 있다 — 나머지는 못 잡는다.
         *
         * 평범한 Enter 도, 대부분 터미널에서의 Shift+Enter·Ctrl+Enter 도 여기
         * 닿기 전에 이미 끝나 있다. readline 도 우리와 같은 keypress 를 듣고
         * 있는데(이 리스너보다 먼저 등록됐다), 터미널이 그 조합들을 평범한
         * Enter 와 **똑같은 바이트**(\r, 드물게 \n)로 보내는 한 readline 이
         * 우리보다 먼저 줄을 끝내 버린다 — 그 뒤에 우리가 뭘 해도 늦다.
         * (readline 코드를 흉내 내서 직접 확인했다: \r·\n 은 keypress 가
         * 이 리스너에 닿기도 전에 'line' 이벤트부터 쏜다.)
         *
         * ESC 로 시작하는 조합(Alt/Option+Enter)은 다르다 — readline 이 ESC
         * 뒤에 더 올 것을 기다리는 동안 우리 keypress 가 먼저 온다. 그래서
         * key.meta 로 여기서 골라낼 수 있다. rl.write('\n') 은 못 쓴다 —
         * 그것도 내부적으로 줄을 끝내는 처리를 그대로 타 버린다(직접 확인).
         *
         * 커서 자리에 줄바꿈을 **끼워 넣는다.** 상자가 그만큼 늘어나고, 위로
         * 올라간 줄이 없으니 백스페이스로 지우는 것도 그대로 된다. \n 이
         * 아니라 줄표를 넣는 이유는 위 선언부에 적어 두었다.
         */
        if (key.meta && 입력기다림 && 묻는중 === null) {
          const 글 = rl.line ?? '';
          const 자리 = Math.min(rl.cursor ?? 글.length, 글.length);
          rl.line = 글.slice(0, 자리) + 줄표 + 글.slice(자리);
          rl.cursor = 자리 + 1;
        } else {
          return;   // 줄이 끝나는 것은 'line' 이 맡는다
        }
      }
      if (묻는중 !== null) {
        const 앞 = 묻는중;
        setImmediate(() => {
          if (묻는중 === null) return;
          process.stdout.write(`\r\x1b[2K${앞}${c.white(펴기(rl.line))}`);
        });
        return;
      }
      /*
       * 여러 키가 한꺼번에 들어와도 **한 번만** 그린다.
       *
       * 붙여넣기는 글자 수만큼 키가 쏟아진다. 스무 줄짜리를 붙이면 상자를
       * 수백 번 다시 그리게 되고, 화면이 눈에 띄게 떨린다. 어차피 마지막
       * 한 번이 지금 상태이므로, 이번 틱에 이미 잡아 뒀으면 그냥 넘긴다.
       */
      if (그릴예정) return;
      그릴예정 = true;
      setImmediate(() => {
        그릴예정 = false;
        if (입력기다림) {
          화면.입력갱신(session, 펴기(rl.line), rl.cursor ?? 0, 지금추천(펴기(rl.line)));
        } else {
          /*
           * 일하는 도중에 치고 있는 글.
           *
           * readline 은 이미 이걸 받아 두고 있었다 — 화면에 안 보였을 뿐이다.
           * 그래서 사람은 "작업 중에는 못 친다" 고 생각하고 끝나기를 지켜본다.
           * 몇 분짜리 턴에서 그 시간이 통째로 버려진다. 새로 받는 게 아니라
           * **이미 받고 있던 것을 보여 주기만** 한다.
           *
           * 답이 흘러나오는 동안(줄 중간)에는 그려도 답 줄을 덮으므로,
           * 상자 쪽에서 알아서 넘긴다. 글은 그대로 살아 있다.
           */
          화면.대기갱신(펴기(rl.line), queue.length);
        }
      });
    });
  }

  const nextLine = () => {
    if (queue.length) return Promise.resolve(queue.shift());
    if (closed) return Promise.resolve(null);
    return new Promise((res) => { waiter = res; });
  };

  const ask = async (label, o = {}) => {
    const 앞 = `  ${c.gray('›')} ${label} ${o.def ? c.gray(`[${o.def}] `) : ''}`;
    화면.붙임(앞);
    /*
     * 되묻는 자리는 상자를 안 쓴다 — '실행할까요? (y/n)' 에 테두리를 두르면
     * 대화의 흐름이 끊긴다. 대신 되비추는 일은 우리가 맡아야 한다.
     * 상자 모드에서는 readline 의 되비추기를 꺼 놨기 때문이다. 안 해 주면
     * y 를 쳐도 화면에 아무것도 안 나타난다 — 먹은 건지 안 먹은 건지 모른다.
     */
    묻는중 = 상자쓰나 ? 앞 : null;
    이어쓰기줄들 = null; 이어쓴것 = false;   // 되묻는 사이에 걸쳐 있던 미완성 이어쓰기는 버린다
    try {
      const a = await nextLine();
      if (a === null) return o.def ?? '';
      return a.trim() || o.def || '';
    } finally { 묻는중 = null; }
  };

  /**
   * 오류를 이 사람 수준에 맞게 보여준다.
   *
   * 쉬움 수준에서는 무엇을 하면 되는지를 앞에 놓고, 원래 문구는 회색으로 뒤에 남긴다.
   * 원인을 지우지 않는 것이 중요하다 — 지우면 물어볼 수도 없게 된다.
   * 개발자 수준에서는 원래 문구 그대로다.
   */
  const 오류보이기 = (message) => {
    const r = explain(session.level, message);
    if (!r.plain) { say(`  ${c.red('✗')} ${String(message)}`); return; }
    const [머리, ...나머지] = r.text.split('\n');
    say(`  ${c.red('✗')} ${머리}`);
    for (const l of 나머지) say(`  ${l}`);
    if (r.detail) say(`  ${c.gray(`(원래 문구: ${clip(String(r.detail).split('\n')[0], 90)})`)}`);
  };

  /**
   * 이번 턴에 만들어진 파일을 **디스크를 보고** 말해 준다.
   *
   * 모델이 "만들었습니다" 라고 답을 맺어도 그건 모델의 말이다. 도구가 실패했는데
   * 그렇게 맺는 경우가 실제로 있다. 사용자는 그 말을 믿고 다음 일로 넘어가고,
   * 한참 뒤에야 파일이 없다는 걸 안다. 그때는 대화가 이미 흘러가 있다.
   *
   * 그래서 말 대신 파일을 본다. 몇 줄인지 · 몇 KB 인지까지 적는다 —
   * '만들어지긴 했는데 반쪽' 인 경우를 그 숫자로 바로 알아볼 수 있다.
   */
  const 만든파일보이기 = (files) => {
    if (!Array.isArray(files) || !files.length) return;
    say('');
    for (const f of files) {
      const 이름 = ctx?.scope ? ctx.scope.show(f.path) : f.path;
      if (f.missing) {
        say(`  ${c.yellow('⚠')} ${c.white(이름)} ${c.gray('— 만들어지지 않았습니다')}`);
        continue;
      }
      if (f.dir) continue;
      const kb = f.bytes >= 1024 ? `${(f.bytes / 1024).toFixed(1)}KB` : `${f.bytes}B`;
      say(`  ${c.green('✓')} ${c.white(이름)} ${c.gray(`· ${f.lines.toLocaleString()}줄 · ${kb}`)}`);
    }
  };

  const ctx = {
    scope: makeScope(root),
    // 도구가 한 번에 돌려줄 양을 이 값에서 뽑는다 (agent/budget.js).
    // /model 로 갈아타면 conn 이 통째로 바뀌므로 그때마다 다시 읽는다.
    get 모델컨텍스트() { return conn.ctx ?? null; },
    // 이 모델이 그림을 볼 수 있나 — Read 가 그림을 만났을 때 무슨 말을 할지가 여기서 갈린다.
    get 눈있나() { return !!conn.vision; },
    // 적어 둔 허락·금지 규칙 (safety/policy.js). 승인 모드보다 먼저 본다.
    규칙들: 규칙모으기(cfg),
    history: new History(root),
    audit: new Audit(root),
    seen: new Set(),
    // 붙은 MCP 서버. 도구를 부를 때 여기서 찾는다.
    mcp: mcp붙임.서버들,
    skills: found.skills,
    loadedSkills: new Set(),
    // 고친 뒤 진단을 볼지. /lsp off 로 끈다 (lsp/diag.js).
    lsp: { 켬: true },
    ask,
    // 암호는 여기서만 받는다. 받은 값은 도구가 쓰고 버린다 —
    // 설정에도, 세션 기록에도, 감사기록에도, 명령줄에도 안 남는다.
    askPassword: async (label) => {
      if (closed) return null;
      const pw = await askHidden(rl, label, nextLine);
      return pw === null || pw === '' ? null : pw;
    },
    /*
     * ── 모델이 사람에게 되묻는 자리 (Ask 도구) ──────────────────────────
     *
     * 계획 승인 상자와 같은 꼴로 그린다. 사람이 이미 아는 모양이라 새로 배울
     * 것이 없고, 무엇보다 **숫자 하나로 끝난다.**
     *
     * 자유롭게 쳐도 그대로 간다. 고를 것이 늘 맞지는 않아서, 넷 다 아닐 때
     * 다시 물어보게 하면 그게 제일 답답하다.
     */
    /*
     * ── 이 터미널이 무슨 바이트를 보내는지 본다 (/keys) ──────────────────
     *
     * 맥에서 줄바꿈이 안 된다는 말을 몇 판째 듣고도 못 고쳤다. 고칠 데를
     * 못 찾은 게 아니라 **무슨 일이 나는지를 몰랐다.**
     *
     * Alt+Enter 는 앞에 ESC 가 붙어 올 때만 잡을 수 있는데(위 keypress 참고),
     * macOS 터미널은 기본값이 Option 을 그렇게 안 보낸다. Shift+Enter·
     * Ctrl+Enter 는 대부분 터미널에서 평범한 Enter 와 **바이트가 똑같다.**
     * 즉 여기서는 셋을 구분할 길이 아예 없다 — 안 오는 것을 잡을 수는 없다.
     *
     * 그래서 문서에 "터미널 설정을 이렇게 바꾸세요" 라고만 적어 뒀는데, 그건
     * 고친 것이 아니다. 사람이 제 터미널에서 **눌러 보고 바로 알 수 있어야**
     * 한다. 여기서 보여 주는 것은 짐작이 아니라 실제로 온 바이트다.
     */
    키확인: async () => {
      if (!process.stdin.isTTY) {
        say('');
        say(`  ${c.gray('키 확인은 터미널에서만 됩니다 (지금은 파이프로 들어와 있습니다).')}`);
        say('');
        return;
      }
      say('');
      say(`  ${c.hcyan('┌')} ${c.bold('키 확인')}`);
      say(`  ${c.hcyan('│')} ${c.gray('아무 키나 눌러 보세요. 이 터미널이 실제로 보낸 바이트를 그대로 보여 줍니다.')}`);
      say(`  ${c.hcyan('│')} ${c.gray('줄바꿈에 쓰려던 것을 눌러 보세요 — Alt+Enter · Option+Enter · Shift+Enter.')}`);
      say(`  ${c.hcyan('└')} ${c.gray('끝내려면 Ctrl+C 또는 q')}`);
      say('');

      const 본것 = [];
      await new Promise((끝) => {
        const 듣기 = (ch, key) => {
          const 이름 = key?.name ?? (ch ? JSON.stringify(ch) : '?');
          if (이름 === 'q' || (key?.ctrl && key?.name === 'c')) {
            process.stdin.off('keypress', 듣기);
            return 끝();
        }
          // 실제로 온 바이트. 이것이 이 화면의 전부다.
          const 날것 = JSON.stringify(String(key?.sequence ?? ch ?? ''))
            .replace(/\\u001b/g, '\\e');
          const 꾸밈 = [key?.ctrl && 'ctrl', key?.meta && 'meta', key?.shift && 'shift']
            .filter(Boolean).join('+');
          본것.push({ 이름, 날것, 꾸밈 });
          say(`  ${c.hcyan('·')} ${c.white(이름.padEnd(10))} ${c.gray(날것.padEnd(14))}`
            + `${꾸밈 ? c.hgreen(꾸밈) : c.gray('꾸밈 없음')}`);
        };
        process.stdin.on('keypress', 듣기);
      });

      /*
       * 눌러 본 것을 놓고 **이 터미널에서 되는 길**을 알려 준다.
       *
       * Enter 를 여러 번 눌렀는데 meta 가 한 번도 안 붙었으면, 그 터미널은
       * Option/Alt 를 ESC 로 안 보내는 것이다. 그 자리에서는 아무리 눌러도
       * 안 되므로, 백틱 쪽을 알려 주는 것이 맞다.
       */
      const 엔터들 = 본것.filter((k) => k.이름 === 'return' || k.이름 === 'enter');
      const 메타본적있나 = 엔터들.some((k) => /meta/.test(k.꾸밈));
      say('');
      if (!엔터들.length) {
        say(`  ${c.gray('Enter 를 안 눌러 봤습니다. 줄바꿈을 보려면 Alt/Option+Enter 를 눌러 보세요.')}`);
      } else if (메타본적있나) {
        say(`  ${mark.ok} ${c.white('이 터미널은 Alt/Option+Enter 를 보냅니다')} ${c.gray('— 그대로 쓰시면 됩니다.')}`);
      } else {
        say(`  ${mark.warn} ${c.white('이 터미널은 Alt/Option+Enter 를 안 보냅니다.')}`);
        say(`  ${c.gray('  누른 Enter 가 평범한 Enter 와 바이트가 같아서, 프로그램 쪽에서 가려낼 길이 없습니다.')}`);
        say('');
        say(`  ${c.white('줄바꿈은 이렇게 하세요')} ${c.gray('— 어느 터미널에서나 됩니다')}`);
        say(`  ${c.gray('  줄 끝에')} ${c.cyan('빈칸 + `')} ${c.gray('를 붙이고 Enter. 마지막 줄은 그냥 Enter.')}`);
        say('');
        say(`  ${c.gray('  Option 을 굳이 쓰시려면 터미널 설정을 바꿔야 합니다:')}`);
        say(`  ${c.gray('    Terminal.app  설정 → 프로파일 → 키보드 → ')}${c.cyan('Option을 Meta 키로 사용')}`);
        say(`  ${c.gray('    iTerm2        Settings → Profiles → Keys → Left Option → ')}${c.cyan('Esc+')}`);
        say(`  ${c.gray('    VS Code       ')}${c.cyan('terminal.integrated.macOptionIsMeta')}${c.gray(' 를 true 로')}`);
      }
      say('');
    },

    ask물음: async (물음, 고를것 = [], 이해 = '') => {
      if (closed) return null;
      const 폭 = Math.max(40, Math.min(88, (process.stdout.columns || 80) - 6)) - 4;
      say('');
      say(`  ${c.hcyan('┌')} ${c.bold(옮긴말('ask.title'))}`);
      /*
       * 물음보다 **이해를 먼저** 보여 준다.
       *
       * 사람이 이 상자에서 제일 먼저 알고 싶은 것은 "얘가 내 말을 알아듣긴
       * 했나" 이다. 그걸 모르는 채 선택지부터 보면, 답을 고르는 것이 아니라
       * 딴소리를 하는지 아닌지를 먼저 가늠해야 한다. 순서가 뒤바뀌면
       * 물음 자체가 짐이 된다.
       */
      if (String(이해 ?? '').trim()) {
        for (const 줄 of 접어쓰기(`알아들은 것: ${String(이해).trim()}`, 폭)) {
          say(`  ${c.hcyan('│')} ${c.gray(줄)}`);
        }
        say(`  ${c.hcyan('│')}`);
      }
      for (const 줄 of 접어쓰기(물음, 폭)) {
        say(`  ${c.hcyan('│')} ${c.white(줄)}`);
      }
      if (고를것.length) {
        say(`  ${c.hcyan('│')}`);
        고를것.forEach((것, i) => {
          say(`  ${c.hcyan('│')} ${c.hcyan(String(i + 1))} ${c.white(것)}`);
        });
      }
      say(`  ${c.hcyan('└')} ${c.gray(옮긴말(고를것.length ? 'ask.pickHint' : 'ask.freeHint'))}`);
      say('');

      // 막혀 있는 것은 기다린 만큼 그대로 손해다. confirm 과 같은 이유로 알린다.
      if (알릴까({ 물어봄: true, 켬: 알림.켬 })) 종();
      창제목(제목글('물어봄', { 폴더: 알림.폴더 }));
      const 답 = String(await ask(
        고를것.length ? 옮긴말('ask.pickPrompt', { 끝: 고를것.length }) : 옮긴말('ask.freePrompt'),
        { def: 고를것.length ? '1' : '' },
      )).trim();
      창제목(제목글('도는중', { 폴더: 알림.폴더 }));

      if (!답) return null;
      // 숫자로 골랐으면 그 줄의 글을 그대로 돌려준다 — 모델에게 "2" 만 가면
      // 무엇을 고른 것인지 모른다.
      const n = Number(답);
      const 고른것 = Number.isInteger(n) && n >= 1 && n <= 고를것.length ? 고를것[n - 1] : 답;
      say(`  ${c.hgreen('▶')} ${c.gray(clip(고른것, 70))}`);
      say('');
      return 고른것;
    },
    confirm: async (name, args) => {
      say('');
      say(`  ${c.yellow('?')} ${toolLabel(name, args)}`);
      /*
       * 여기서 종을 울린다. 끝난 것은 늦게 알아도 되지만 **막혀 있는 것은**
       * 기다린 만큼 그대로 손해다 — 다른 창에 가 있는 사이 3분째 이 줄에서
       * 멈춰 서 있는 일이 실제로 잦다. 시간 문턱도 안 본다, 0초여도 알린다.
       */
      if (알릴까({ 물어봄: true, 켬: 알림.켬 })) 종();
      창제목(제목글('물어봄', { 폴더: 알림.폴더 }));
      const a = (await ask('실행할까요? (y/n)', { def: 'y' })).toLowerCase();
      창제목(제목글('도는중', { 폴더: 알림.폴더 }));
      return a === 'y' || a === 'yes' || a === 'ㅇ';
    },
  };

  /*
   * 겪어 본 것 (agent/evolve.js). 쓸수록 이 PC 에 맞춰 나아지는 자리다.
   *
   * 켤 때 두 가지를 받아 온다.
   *   · 프롬프트에 실을 몇 줄 — 여기서 되는 명령, 이 모델의 버릇
   *   · 지난번에 알아낸 토큰 배수 — 첫 턴부터 제대로 셈한다
   *
   * 둘 다 없으면 아무 일도 안 일어난다. 처음 켠 PC 는 지금과 똑같이 돈다.
   */
  ctx.배움 = new 배움(root, homeDir());
  session.배움요약 = ctx.배움.요약(conn.model);
  const 아는배수 = ctx.배움.아는보정(conn.model);
  if (아는배수) { session.보정 = 아는배수; session.보정잰것 = 1; }

  /*
   * 모델 카드 (agent/card.js).
   *
   * 겪어 본 버릇을 **하네스 설정으로** 바꾼다. 프롬프트에 "이렇게 해라" 고 적는
   * 것과 다르다 — 작은 모델은 그 말을 잘 안 듣는다. 여기서 바꾸는 것은 deel 의
   * 행동이라 모델의 협조가 필요 없다.
   *
   * 턴마다 다시 만든다. 이번 대화에서 겪는 것이 계속 쌓이므로, 켤 때 한 번
   * 만들어 두면 그 뒤에 알아낸 것이 이번 대화에서는 안 쓰인다.
   */
  ctx.카드다시 = () => {
    ctx.카드 = 카드(conn.model, session.본것, ctx.배움?.현황(conn.model)?.모델);
    return ctx.카드;
  };
  ctx.카드다시();

  /*
   * 대화 갈래. 연결·도구·되돌리기는 같이 쓰고 오간 말만 여러 벌 갖는다.
   * 갈래마다 저장 파일을 따로 열어서, 나중에 `/sessions` 로 각각 찾아갈 수 있다.
   */
  ctx.갈래 = new Threads(session, ctx, () => new Store(root).begin({ model: conn.model, base: 주소가리기(conn.base), root }), store);

  // ── 컨텍스트 길이를 모델에서 긁어온다 ─────────────────────────────────
  //
  // 켤 때마다 서버에 물어본다. 저장된 값을 그대로 믿지 않는다 —
  // 같은 이름의 모델이라도 서버에서 몇 k 로 올렸는지가 그때그때 다르고,
  // 그 차이를 화면에 못 보면 조용히 작아진 채로 쓰게 된다.
  //
  // --ctx 로 직접 주신 값이 있으면 안 건드린다. 사람이 고른 것을 뒤집지 않는다.
  const 길이알림 = [];   // 잘 된 소식
  const 길이경고 = [];   // 손을 봐야 하는 것
  if (opts.ctx == null) {
    // 이 컴퓨터 안의 서버면 눈 깜짝할 새다. 사내 게이트웨이는 몇 초 걸릴 수 있어
    // 무슨 일이 일어나는 중인지 알려 준다 — 멈춘 것처럼 보이면 안 된다.
    화면.돌리기('모델에 걸린 컨텍스트 길이를 확인하는 중…');
    let r = null;
    try { r = await probeCtx(conn, { timeout: 6000 }); } catch { /* 못 물어보면 아래에서 처리 */ }
    화면.돌림멈춤('');
    if (r?.value) {
      const 전 = conn.ctx;
      conn.ctx = r.value;
      // 알아낸 값은 프로필에 남긴다. 다음에 켤 때 화면이 곧바로 맞게 뜬다.
      if (prof.ctx !== r.value) {
        prof.ctx = r.value;
        try { const cfg2 = load(); const t = cfg2.profiles.find((p) => p.id === prof.id); if (t) { t.ctx = r.value; saveCfg(cfg2); } } catch { /* 못 남겨도 이번 세션에는 먹는다 */ }
      }
      if (전 !== r.value) 길이알림.push(`컨텍스트를 ${전.toLocaleString()} ${c.gray('→')} ${c.white(r.value.toLocaleString())} 로 맞췄습니다 ${c.gray('(' + (r.source ?? '서버') + '에서 읽음)')}`);
      if (r.max && r.loaded && r.max > r.loaded) {
        길이경고.push(`이 모델은 ${c.white(r.max.toLocaleString())} 까지 됩니다 — 서버에서 더 올린 뒤 ${c.cyan('/ctx auto')}`);
      }
      /*
       * '모델이 낼 수 있는 최대' 와 '서버가 실제로 올려 둔 길이' 는 다르다.
       *
       * 모델 카드에는 131,072 라고 적혀 있는데 서버는 8,192 만 올려 둔 경우가
       * 흔하다. 그런데 우리는 둘 중 아는 것을 그냥 썼다. 그러면 16배를 보내고
       * **조용히 잘린다** — 오류도 안 나고, 모델이 앞부분을 잊을 뿐이라
       * 사람은 "모델이 멍청해졌다" 고만 느낀다. 확신에 찬 오답이 제일 나쁘다.
       *
       * 이제는 거절당하면 그 문장에서 배워 스스로 맞춘다(backend/learn.js).
       * 그래도 처음부터 그렇다고 말해 두는 편이 낫다.
       */
      if (!r.loaded && r.max) {
        길이경고.push(`${c.white(r.max.toLocaleString())} 은 ${c.bold('모델이 낼 수 있는 최대')}입니다 — 서버가 실제로 올린 길이는 안 알려 줍니다.`
          + `\n     너무 길면 서버가 알려 주는 값으로 저절로 맞춥니다. 아는 값이 있으면 ${c.cyan('/ctx 8192')} 처럼 직접 정하세요`);
      }
    } else if (prof.ctx == null) {
      길이경고.push(`컨텍스트를 서버가 안 알려줍니다 — 우선 ${CTX_DEFAULT.toLocaleString()} 으로 잡았습니다. ${c.cyan('/ctx 655360')} 처럼 직접 지정하세요`);
    }
  }

  /*
   * ── 켤 때 도는 글자 모션 ──────────────────────────────────────────────
   *
   * 사람은 `deel` 이라고 치고 들어온다. 그 글자가 그 자리에서 deel-local 로
   * 자라고, 아래로 선이 그어지며 닫힌다. 꾸미기만은 아니다 — 이 프로그램이
   * 하는 말이 딱 하나인데(소스가 이 컴퓨터 밖으로 안 나간다) 그 말을 켜는
   * 첫 1초에 그림으로 한 번 하는 것이다. 바깥 게이트웨이면 같은 선이 노랗게
   * 그어진다. 그러면 사람이 그 자리에서 안다.
   *
   * 여기서 도는 이유는 **연결이 정해진 다음**이라야 색을 제대로 칠하기
   * 때문이다. 더 일찍 돌면 초록으로 그려 놓고 나중에 바깥이었다고 정정하는
   * 꼴이 되는데, 그건 안 보여 주느니만 못하다.
   */
  {
    let 바깥 = false;
    try { 바깥 = !isLocalHost(new URL(conn.base).hostname); } catch { 바깥 = false; }
    say('');
    await 인트로({ 바깥, 곁말: 기본곁말(바깥), 쓰기: (t) => process.stdout.write(t) });
  }

  // ── 머리말 ────────────────────────────────────────────────────────────
  화면.머리말(headerLines(session, found, 상자쓰나));
  const warn = [];
  // 홈 폴더에서 켠 경우. 작업 범위가 집 전체가 된다.
  //
  // 실제로 이렇게 켠 화면을 봤다. 그러면 Glob 이 홈 전체를 훑어 느려지고,
  // 모델이 ~/.deel, ~/.claude, ~/package.json 같은 상관없는 것부터 읽는다.
  // 막혀 있어서 안전하긴 하지만, 애초에 여기서 켤 일이 아니다.
  // 윈도우는 같은 폴더라도 대소문자가 다르게 올 수 있다. 맞춰서 견준다.
  const 같은폴더 = (a, b) => {
    const n = (p) => resolve(String(p ?? '')).replace(/[\\/]+$/, '');
    return process.platform === 'win32'
      ? n(a).toLowerCase() === n(b).toLowerCase()
      : n(a) === n(b);
  };
  if (같은폴더(root, homedir())) {
    warn.push('홈 폴더에서 켰습니다 — 작업 범위가 집 전체입니다. 일할 폴더로 옮겨 다시 켜는 편이 빠르고 안전합니다');
  }
  // 밖에서 붙인 도구는 **붙었다고 반드시 말한다.** 남의 프로그램이 이 컴퓨터에서
  // 돌고 있다는 사실을 조용히 넘기면 안 된다 — 그게 이 도구가 심사를 통과한 근거다.
  // 기억을 들고 시작한다는 것을 반드시 말한다. 조용히 실으면 사람은 왜 모델이
  // 안 알려준 것을 아는지 모른다 — 그게 불안하다.
  {
    const 기억 = 기억읽기(root);
    if (기억.줄들.length) 길이알림.push(`지난 대화에서 정한 것 ${기억.줄들.length}개를 들고 시작합니다 — ${c.cyan('/memory')}`);
  }
  if (mcp붙임.서버들.length) {
    const 도구수 = mcp붙임.서버들.reduce((n, s) => n + s.도구.length, 0);
    길이알림.push(`밖에서 붙인 도구 ${도구수}개 ${c.gray(`(서버 ${mcp붙임.서버들.length}대: ${mcp붙임.서버들.map((s) => s.이름).join(' · ')})`)} — ${c.cyan('/mcp')}`);
  }
  // 안 뜬 것은 조용히 빠지면 안 된다. "왜 그 도구가 없지" 를 영영 알 수 없다.
  for (const m of mcp붙임.못한것) warn.push(`MCP ${c.white(m.이름)} 을 못 붙였습니다 — ${m.왜}`);
  if (!conn.tools) warn.push('도구 호출이 확인되지 않았습니다 — deel diagnose 로 점검하세요');
  if (!conn.streaming) warn.push('스트리밍이 없어 응답이 한 번에 나옵니다');
  warn.push(...길이경고);
  // 잘 된 것은 경고 표시를 달지 않는다. ⚠ 가 붙으면 뭘 고쳐야 하나 싶어진다.
  for (const l of 길이알림) say(`  ${mark.ok} ${c.gray(l)}`);
  for (const w of warn) say(`  ${mark.warn} ${c.gray(w)}`);
  // ESC 를 앞에 둔다 — 멈추는 길로는 이것이 먼저다. Ctrl+C 는 두 번 누르면
  // 끝나 버려서, 급히 멈추려던 사람이 대화를 통째로 닫는 일이 실제로 있었다.
  say(`  ${c.gray('/help 명령 목록')}   ${c.gray('ESC 중단')}   ${c.gray('Ctrl+C 중단·끝내기')}`);

  /*
   * 입력 자리. 어떻게 생겼는지는 화면 쪽이 정한다 —
   * 줄화면은 상태줄을 깔고 그 아래 ❯ 를, 상자화면은 테두리를 두른 칸을 그린다.
   *
   * 치던 글은 되살린다. Shift+Tab 이나 Ctrl+C 처럼 **입력 도중에** 한 줄을
   * 끼워 넣고 다시 그리는 자리가 있는데, 그때 빈 칸을 그리면 치던 글이
   * 사라진 것처럼 보인다. 실제로는 readline 이 그대로 들고 있어서 Enter 를
   * 치면 멀쩡히 보내진다 — 화면만 거짓말을 하는 셈이라 더 나쁘다.
   */
  const prompt = () => {
    const 글 = 상자쓰나 && 입력기다림 ? 펴기(rl.line) : '';
    화면.입력자리(session, 글, 글 ? (rl.cursor ?? 0) : 0, 글 ? 지금추천(글) : []);
  };

  // Ctrl+C 는 상황에 따라 뜻이 다르다.
  //   모델이 답하는 중  → 그 답을 끊는다 (프로그램은 살아 있다)
  //   입력을 기다리는 중 → 한 번은 경고, 두 번이면 끝낸다
  // 느린 로컬 모델이 엉뚱한 답을 길게 뽑기 시작했을 때 끝까지 기다리지 않아도 된다.
  let interrupted = false;
  rl.on('SIGINT', () => {
    /*
     * 쌓아 둔 줄이 있으면 먼저 버린다. 이게 없으면 이어쓰기를 **취소할 길이
     * 없다** — 표를 하나 붙여 놓고 마음이 바뀌어도, 다음에 치는 것이 무엇이든
     * 앞줄에 붙어서 나간다. `/help` 같은 슬래시 명령까지 앞줄에 붙는 순간
     * 더는 '/' 로 시작하지 않아 명령으로 안 읽히고 모델에게 넘어간다.
     */
    if (이어쓰기줄들 !== null) {
      이어쓰기줄들 = null; 이어쓴것 = false;
      say('');
      say(`  ${c.gray('이어쓰던 것을 버렸습니다.')}`);
    }
    if (turn && !turn.signal.aborted) {
      turn.abort();
      멈추는중();
      return;                   // 화면 정리는 루프 쪽 'aborted' 이벤트가 한다
    }
    if (interrupted) { rl.close(); return; }
    interrupted = true;
    say('');
    say(`  ${c.gray('한 번 더 Ctrl+C 를 누르면 끝냅니다.')}`);
    prompt();
  });

  /*
   * 계획을 승인받은 뒤 **사람이 다시 치지 않아도** 이어서 할 말.
   *
   * 전에는 계획 모드가 모델에게 "승인을 받으면 /code 로 바꿔 실행한다" 고
   * 시켜 놓고, 정작 승인받는 자리도 이어가는 길도 없었다. 사람이 /code 를
   * 알아서 쳐야 이어졌다 — 모드 설명에는 '승인 뒤 실행' 이라고 적혀 있었는데.
   * 코드가 안 하는 것을 화면이 약속하고 있었던 셈이다.
   */
  let 이어갈것 = null;    // 이어서 보낼 말 (null 이면 사람 입력을 기다린다)
  // 지금 도는 하위 작업 수. 사무실이 자리를 이만큼 채운다.
  let 도는하위 = 0;
  let 이어갈모드 = null;  // 그때 쓸 작업 모드. 다시 고르지 않는다.

  /*
   * 계획을 한 눈에 보여 준다.
   *
   * 오른쪽 테두리를 안 그린다. 한글은 두 칸을 먹는데 이모지·기호는 아니어서
   * 폭을 맞추려다 어긋나면 상자가 깨져 보인다 — 안 그리면 어긋날 것이 없다.
   */
  const 계획상자 = (할일) => {
    const 폭 = Math.max(40, Math.min(88, (process.stdout.columns || 80) - 6));
    say(`  ${c.hcyan('┌')} ${c.bold('계획')}`);
    if (!할일.length) {
      // TodoWrite 를 안 쓴 계획도 있다. 그때 빈 상자를 그리면 계획이 없는 줄 안다.
      say(`  ${c.hcyan('│')} ${c.gray('단계가 따로 적히지 않았습니다 — 위에 적힌 계획을 봐 주세요.')}`);
    } else {
      할일.forEach((t, i) => {
        const 줄들 = 접어쓰기(String(t.text ?? ''), 폭 - 6);
        줄들.forEach((줄, j) => {
          const 앞 = j === 0 ? c.gray(String(i + 1).padStart(2) + '.') : '   ';
          say(`  ${c.hcyan('│')} ${앞} ${c.white(줄)}`);
        });
      });
    }
    say(`  ${c.hcyan('└')} ${c.gray(`${할일.length}단계 · ${session.root}`)}`);
  };

  for (;;) {
    let text;
    if (이어갈것 !== null) {
      // 승인받아 이어가는 자리. 사람이 친 것이 아니므로 ❯ 로 찍지 않는다.
      text = 이어갈것;
      이어갈것 = null;
    } else {
      prompt();
      입력기다림 = true;
      // 줄이 이미 쌓여 있으면 그건 **일하는 동안 미리 쳐 둔 것**이다.
      // 그때는 대화에 안 찍었으니(찍으면 이미 보낸 것처럼 보인다) 지금 찍는다.
      const 예약이었나 = queue.length > 0;
      const line = await nextLine();
      입력기다림 = false;
      if (line === null) break;        // 입력이 끝났다 (파이프 종료 / Ctrl+D)
      interrupted = false;
      text = line.trim();
      if (!text) continue;
      if (예약이었나 && 상자쓰나) {
        화면.입력지움();
        say(` ${c.hcyan('❯')} ${c.white(text)}  ${c.gray('(미리 쳐 둔 것)')}`);
      }
    }

    const cmd = await handle(text, session, ctx);
    if (cmd.exit) break;
    if (cmd.handled) continue;
    const toSend = cmd.text ?? text;   // 슬래시 명령이면 펼쳐진 내용을 보낸다

    // @파일 을 지목했으면 그 파일을 바로 붙여 보낸다.
    //
    // 붙인 것은 화면에 반드시 알린다. 사람이 안 보낸 줄 아는 글이 대화에
    // 들어가 있으면 안 된다 — 컨텍스트가 왜 줄었는지도 모르게 된다.
    let 보낼글 = toSend;
    let 보낼그림 = null;
    if (toSend.includes('@')) {
      const 예산 = Math.min(20000, Math.floor((session.conn.ctx ?? CTX_DEFAULT) * 0.25));
      const r = expandMentions(toSend, {
        scope: ctx.scope, budget: 예산, seen: ctx.seen,
        onRead: (p, t) => session.noteRead(p, t),
        눈있나: !!session.conn.vision,
      });
      보낼글 = r.text;
      보낼그림 = r.그림들?.length ? r.그림들 : null;
      for (const a of r.attached) {
        const 꼬리 = a.그림 ? c.gray(` (그림 · ${크기말(a.bytes)})`) : (a.full ? '' : c.gray(' (앞부분만)'));
        say(`  ${c.blue('◧')} ${c.gray('붙임')} ${c.white(a.show)}${꼬리}`);
      }
      for (const b of r.blocked) {
        say(`  ${mark.warn} ${c.gray(`${b.path} 는 작업 범위 밖이라 안 붙였습니다.`)}`);
      }
    }

    // 종합 모드면 이 한마디가 무슨 일인지 보고 알맞은 모드로 옮긴다.
    //
    // 기본 모드는 안 건드린다 — 다음 한마디는 다시 처음부터 고른다.
    // 사용자가 직접 고른 모드가 있으면 여기 안 들어온다. 사람이 고른 것을 뒤집지 않는다.
    session.routed = null;
    // 계획을 내고 승인을 받아야 하는 턴인가. 턴이 끝난 뒤 승인 창을 띄운다.
    let 계획승인받나 = false;
    if (이어갈모드) {
      // 방금 승인받은 계획을 그대로 잇는 자리. 여기서 다시 고르면 안 된다 —
      // "위 계획대로 진행해라" 에는 '계획' 이 들어 있어서 또 계획 모드로 간다.
      session.routed = 이어갈모드;
      이어갈모드 = null;
    } else if (session.work === 'auto') {
      const 골라진 = route(toSend);
      if (골라진.mode) {
        session.routed = 골라진.mode;
        계획승인받나 = 골라진.겹침 === true;
        const w = getWork(골라진.mode);
        say('');
        say(`  ${c.hcyan(w.glyph)} ${c.bold(보일이름(w.id))} ${c.gray('(' + w.en + ')')}`
          + `  ${c.gray('말 속에 ' + 골라진.why + ' 가 있어서')}`
          + (canWrite(골라진.mode) ? '' : `  ${c.green('· 파일은 안 바꿉니다')}`));
        // 겹친 요청은 '파일을 안 바꾼다' 로 끝나면 안 된다. 시킨 일의 절반만 한 것이다.
        // 그래서 여기서 뒷 절반이 온다는 것을 미리 말해 준다.
        if (계획승인받나) {
          say(`  ${c.gray('계획과 실행이 같이 있어')} ${c.white('계획부터')} ${c.gray('냅니다.')}`
            + ` ${c.gray('보시고 승인하면')} ${c.white('그대로 이어서')} ${c.gray('합니다.')}`);
        } else {
          say(`  ${c.gray('다르면')} ${c.cyan('/code')} ${c.gray('처럼 직접 고르세요. 그때부터는 안 바뀝니다.')}`);
        }
      }
    }

    say('');
    const started = Date.now();
    const before = { in: session.usage.in, out: session.usage.out };

    /*
     * 창 제목에 흐른 시간을 띄운다. 탭 이름만 봐도 도는 중인지 알게 하려는 것이다.
     *
     * 화면에 보이는 글자를 건드리지 않는다 — OSC 는 커서를 안 옮기고 아무것도
     * 안 찍으므로, 한창 그리는 중에 끼어들어도 화면이 깨지지 않는다.
     * unref 를 거는 이유는, 이 시계 하나 때문에 프로그램이 안 꺼지면 안 되기 때문이다.
     */
    창제목(제목글('도는중', { 폴더: 알림.폴더, 초: 0 }));
    const 제목시계 = setInterval(
      () => 창제목(제목글('도는중', { 폴더: 알림.폴더, 초: (Date.now() - started) / 1000 })),
      1000,
    );
    제목시계.unref?.();

    // 어디까지 적었는지. 도중에 죽어도 여기까지는 남아 있게 자주 흘려 보낸다.
    let saved = session.messages.length;
    const flush = () => {
      for (const m of session.messages.slice(saved)) ctx.갈래.현재store().append(m);
      saved = session.messages.length;
    };
    let tools = 0;
    // 이 턴이 탈 없이 끝났나. 끊겼거나 터진 뒤에 승인 창을 띄우면 안 된다 —
    // 계획이 반만 나온 것을 두고 "이대로 진행할까요?" 를 묻는 꼴이 된다.
    let 턴탈났나 = false;
    /*
     * 걸음을 다 써서 중간에 끊긴 턴인가. 끊겼을 때 남은 할 일을 여기 담는다.
     *
     * 「중간에 끊기는 이슈가 생기는거 같은데」 — 여기가 그 자리다. 여태는
     * "이어서 하려면 다시 말씀하세요" 라고만 하고 끝났다. 사람은 방금 화면에
     * 다 적혀 있는 남은 할 일을 손으로 다시 옮겨 적거나, "이어서 해줘" 라고만
     * 쳤다. 그러면 모델은 무엇을 잇는지 몰라서 처음부터 다시 뒤진다.
     */
    let 끊긴할일 = null;
    let thinkChars = 0;
    let streamed = false;
    /*
     * 답을 그리는 자리. 턴마다 새로 만든다 — 앞 턴의 코드 울타리 상태가
     * 다음 턴으로 새면 멀쩡한 답이 통째로 코드 블록으로 그려진다.
     */
    const 답그림 = new 마크다운({ 폭: (process.stdout.columns || 80) - 6 });
    // 답 흐름이 끊기는 자리마다 남은 반 줄을 비운다. 안 비우면 마지막 줄이 사라진다.
    const 답비우기 = () => {
      for (const 조각 of 답그림.끝()) {
        if (typeof 조각 === 'string') 화면.붙임(`  ${답표시} ${조각}\n`);
        else 화면.붙임(조각.이어붙임 + (조각.끝났나 ? '\n' : ''));
      }
    };
    let thinkingShown = false;
    let stage = null;
    // 접는 중 표시. 끝나거나 다른 글을 찍기 전에 반드시 멈춰야 한다.
    let 접는중 = false;
    const 접기멈춤 = () => { if (접는중) { 화면.돌림멈춤(); 접는중 = false; } };

    const clearThinking = () => { 화면.임시지움(); thinkingShown = false; };
    // 단계 꼬리표 — 붙을 때만 뒤에 한 칸을 같이 붙인다. 쉬움 수준에서는 빈 글자라
    // '생각 중…' 앞에 빈칸 두 개가 뜨는 일이 없다.
    const 꼬리표 = (ev) => { const t = stageTag(ev, session.level); return t ? t + ' ' : ''; };

    turn = new AbortController();
    /*
     * 상자를 '일하는 중' 으로 바꾼다.
     *
     * 로컬 모델은 느리다 — 한 걸음에 수십 초가 걸린다. 그 동안 화면 아래가
     * 텅 비어 있으면 사람은 멈춘 줄 알고 Ctrl+C 를 누른다. 다 되어 가던 일이
     * 그렇게 날아간다. 테두리를 그대로 두고 안엣것만 바꾸는 이유다.
     */
    화면.일시작(session, '생각');
    // 이번 턴에 쓸 카드를 지금 만든다. 앞 턴에서 겪은 것까지 반영돼야
    // '겪을수록 나아진다' 가 이번 대화 안에서도 참이 된다.
    ctx.카드다시?.();
    try {
      /*
       * 일하는 중에 친 말을 걸음마다 건네준다 (agent/loop.js 의 끼어들기).
       *
       * **슬래시 명령은 안 건넨다.** /mode 나 /undo 는 설정과 파일을 건드리는
       * 것이라, 도는 턴 한가운데서 먹으면 무엇이 어느 설정으로 돌았는지가
       * 흐려진다. 그건 큐에 그대로 두고 턴이 끝난 뒤에 평소대로 처리한다.
       *
       * 큐에서 **빼서** 넘긴다 — 넘기고 큐에도 남기면 같은 말이 두 번 나간다.
       */
      const 끼어들기 = () => {
        const i = queue.findIndex((x) => !String(x ?? '').trimStart().startsWith('/'));
        if (i < 0) return null;
        const [것] = queue.splice(i, 1);
        화면.대기갱신('', queue.length);
        return String(것).trim() || null;
      };
      for await (const ev of run(session, ctx, 보낼글, { signal: turn.signal, 그림들: 보낼그림, 끼어들기 })) {
        /*
         * 하위 작업 안쪽에서 온 것이면 한 단 들여 그린다.
         *
         * 여기 한 줄이 아래 switch 의 say() 예순 곳을 다 덮는다. 각 자리마다
         * 들여쓰기를 붙이면 새 이벤트를 더할 때마다 하나씩 빠뜨리게 된다.
         */
        화면.들여쓰기(ev.depth ?? 0);
        switch (ev.type) {
          /*
           * 도중에 낀 말. **화면에 그대로 보여 준다.**
           *
           * 안 보여 주면 사람은 제가 친 말이 먹혔는지 모른 채 기다린다.
           * 그러면 한 번 더 치게 되고, 같은 말이 두 번 나간다.
           */
          case 'steer':
            say(` ${c.hcyan('❯')} ${c.white(ev.text)}  ${c.gray('(도중에 낀 말 — 다음 걸음부터 반영됩니다)')}`);
            break;
          // 어느 단계를 어떤 강도로 도는지 — 추론 강도 조절이 실제로 먹는지 눈으로 보인다.
          case 'stage':
            stage = ev;
            thinkChars = 0;
            break;

          // 다시 부르는 이유. 쉬움 수준에서는 토큰 숫자를 안 꺼낸다 —
          // 9984 → 16384 가 무슨 뜻인지 설명할 자리가 여기가 아니다.
          case 'retry':
            clearThinking();
            say(session.level === '쉬움'
              ? `  ${c.yellow('↻')} ${c.gray('답이 잘려서 더 길게 다시 받습니다')}`
              : `  ${c.yellow('↻')} ${c.gray(`${ev.why} — 상한을 ${ev.from} → ${ev.to} 로 올려 다시 부릅니다`)}`);
            break;

          // 서버가 잠깐 막아서 기다렸다 다시 부르는 자리 (backend/retry.js).
          // 상태 코드·몇 초·몇 번째를 그대로 적는다 — 왜 느린지가 여기서만 읽힌다.
          // 쉬움 수준에서도 숫자를 뺀 채 내지 않는다. 429 는 설명이 필요한 숫자가 아니다.
          case 'backoff':
            clearThinking();
            say(`  ${c.yellow('↻')} ${c.gray(옮긴말('loop.backoff', 알림채움(ev)))}`);
            break;

          case 'waiting':
            화면.기다림(c.gray(꼬리표(stage) + '생각 중…'));
            // 지워야 할 줄이 화면에 있다고 표시해 둔다.
            //
            // 전에는 이 표시를 안 세웠다. \r 로 커서만 앞으로 보내 놓고 지우지는
            // 않으니, 다음에 오는 짧은 글이 그 줄 위에 겹쳐 찍혔다 —
            //   "이어가기·low 생각 중…  합계를 sum 으로…" 처럼 앞말이 남았다.
            if (process.stdout.isTTY) thinkingShown = true;
            break;

          case 'thinking':
            thinkChars += ev.text.length;
            화면.생각(`${mark.think} ${c.gray(꼬리표(stage))}${c.gray(`생각 중… ${thinkChars.toLocaleString()}자`)}`);
            if (process.stdout.isTTY) thinkingShown = true;
            break;

          /*
           * 모델이 사람에게 하는 말.
           *
           * 왼쪽에 세로줄을 세워 도구 줄과 가른다. 전에는 들여쓰기도 색도 도구와
           * 같아서, 화면을 훑을 때 '모델이 뭐라고 했는지' 를 눈으로 못 찾았다.
           * 도구 이름·결과·바뀐 자리가 줄줄이 지나간 끝에 답이 섞여 있었다.
           *
           * 세로줄 하나면 된다. 칸을 나눠 그리는 화면으로 갈 이유가 없다 —
           * 파이프로 넘기거나 기록으로 남길 때도 그대로 읽힌다.
           */
          /*
           * 답을 마크다운으로 그린다 (ui/md.js).
           *
           * 줄이 끝나야 그릴 수 있다 — `**굵` 까지 왔을 때는 그게 굵은 글씨가
           * 될지 알 수 없고, 한 번 찍은 글자는 되돌릴 수 없다. 그래서 md 가
           * 줄 단위로 모았다가 내놓는다. 줄이 화면 폭보다 길어지면 거기까지를
           * 날것으로 흘려보낸다(md 가 알아서 한다) — 긴 문단에서 몇 초씩
           * 아무것도 안 나오면 멈춘 것처럼 보이기 때문이다.
           */
          case 'content':
            clearThinking();
            if (!streamed) { streamed = true; 화면.일바꿈('답'); }
            for (const 조각 of 답그림.넣기(ev.text)) {
              if (typeof 조각 === 'string') { 화면.붙임(`  ${답표시} ${조각}\n`); continue; }
              // 아직 안 끝난 긴 줄. 그 줄이 처음 나가는 것이면 세로줄을 앞에 세운다.
              화면.붙임((조각.첫조각 ? `  ${답표시} ` : '') + 조각.이어붙임 + (조각.끝났나 ? '\n' : ''));
            }
            break;

          case 'tool_start':
            clearThinking();
            if (streamed) { 답비우기(); say(''); streamed = false; }
            // 문구를 지금 하는 일에 맞춘다. 아무 말이나 돌려 대면 두 번째부터
            // 아무도 안 읽고, 그때부터는 화면이 조용한 것과 같아진다.
            화면.일바꿈(갈래고르기(ev.name));
            say('');
            say(`  ${toolLabel(ev.name, ev.args)}`);
            break;

          // 여럿을 같이 돌린다 — 한 줄로 알리고, 이름은 결과와 붙여서 그린다.
          case 'tools_start':
            clearThinking();
            if (streamed) { 답비우기(); say(''); streamed = false; }
            화면.일바꿈(갈래고르기(ev.names?.[0]));
            // 사무실은 이만큼 자리를 채운다 — 이것이 진짜로 동시에 도는 수다.
            화면.함께갱신(ev.count);
            say('');
            say(`  ${c.gray(`${ev.count}개를 함께 돌립니다`)} ${c.gray('·')} ${c.gray(ev.names.join(' '))}`);
            break;

          case 'tool':
            tools++;
            // 결과가 오면 그 묶음은 끝난 것이다. 안 지우면 다음 한 개짜리
            // 도구까지 여럿이 도는 것처럼 보인다 — 자리 수가 거짓이 된다.
            화면.함께갱신(0);
            // 걸러져 나온 것(인자가 잘렸거나, 모르는 도구거나, 거부된 것)은
            // '시작' 을 안 거쳤다. 그래서 '생각 중…' 줄이 안 지워진 채로 결과가
            // 그 줄 뒤에 가서 붙고, 이름도 없이 "└ 인자가 잘렸습니다" 만 남는다.
            // 무슨 도구가 왜 그랬는지 알 수 없는 화면이 된다.
            if (ev.showLabel) { clearThinking(); if (streamed) { 답비우기(); say(''); streamed = false; } say(''); }
            // 같이 돈 것은 이름을 다시 적어 준다. 안 그러면 어느 결과인지 모른다.
            if (ev.parallel || ev.showLabel) say(`  ${toolLabel(ev.name, ev.args)}`);
            if (ev.name === 'TodoWrite' && ev.result?.todos) {
              // 사무실 화이트보드도 이걸 본다. 할 일은 세션이 아니라 턴 문맥에
              // 있어서 상자가 스스로 못 읽는다 — 아는 자리에서 넣어 준다.
              화면.할일갱신(ev.result.todos);
              for (const t of ev.result.todos) {
                const 표 = t.state === 'done' ? c.green('☑') : t.state === 'doing' ? c.hyellow('▶') : c.gray('☐');
                const 글 = t.state === 'done' ? c.gray(t.text) : t.state === 'doing' ? c.white(t.text) : c.gray(t.text);
                say(`    ${표} ${clip(글, 74)}`);
              }
            } else {
              say(`    ${toolResultLine(ev.result, ev.ms ?? 0)}`);
              /*
               * 비밀이 지나갔으면 반드시 말한다.
               *
               * 가렸으면 가렸다고, 못 가렸으면 못 가렸다고 적는다. 파일에서
               * 읽어 온 글은 일부러 안 가린다 — 가리면 모델이 그 가린 글을
               * 되돌려 써서 진짜 열쇠가 지워진다. 대신 사람에게 알린다.
               * 조용히 넘어가면 사람은 제 열쇠가 대화에 들어간 줄을 모른다.
               */
              if (ev.비밀) {
                say(ev.비밀.가렸나
                  ? `      ${c.gray(`⊘ ${ev.비밀.말} — 모델에 가려서 보냈습니다`)}`
                  : `      ${c.yellow('!')} ${c.yellow(ev.비밀.말)} ${c.gray('— 파일 내용은 가리지 않습니다 (가리면 되돌려 쓸 때 지워집니다)')}`);
              }
              /*
               * 파일을 바꾸는 명령이었으면, 무엇을 떠 뒀는지 적는다.
               *
               * `mv`·`rm` 은 화면에 '성공' 한 줄만 남는다. 그 줄만 보면 되돌릴
               * 수 있는지 없는지 알 길이 없어서, 사람은 되돌릴 수 있는 줄 알고
               * 넘어가거나 반대로 못 되돌리는 줄 알고 겁을 낸다. 사실을 적는다.
               */
              /*
               * 확인한 것을 센다. 상태줄이 이 숫자를 본다.
               *
               * 모델이 "다 됐습니다" 로 답을 맺는 것과 **실제로 돌려 본 것**은
               * 다른 일이다. 화면에 초록 ✓ 가 없으면 아직 아무도 안 돌려 본
               * 것이고, 그 구분이 상태줄에 있어야 사람이 속지 않는다.
               */
              if (ev.name === 'Verify' && ev.result) {
                session.검증.돈횟수 += 1;
                session.검증.확인 += ev.result.확인됨 ?? 0;
                session.검증.탈 += ev.result.탈 ?? 0;
              }
              if (ev.result?.되돌릴것?.length) {
                const 것들 = ev.result.되돌릴것;
                say(`      ${c.gray(`↩ ${것들.slice(0, 3).join(' · ')}${것들.length > 3 ? ` 외 ${것들.length - 3}개` : ''} 는 떠 뒀습니다 — /undo 로 되돌아갑니다`)}`);
              }
              // 파일을 고쳤으면 무엇이 바뀌었는지 바로 보여 준다.
              //
              // auto 모드는 안 물어보고 고친다. 여기서 안 보여주면 사람이
              // 무엇이 바뀐지 볼 방법이 아예 없다 — 되돌릴지 말지도 못 정한다.
              if (ev.result?.diff) {
                // 도구가 돌려준 절대경로를 쓴다. 인자로 온 file_path 는 'a.py' 처럼
                // 상대경로일 수 있고, 그러면 나중에 지금 폴더 기준으로 풀려서
                // 엉뚱한 자리를 가리킨다 — 목록에 ../../.. 가 찍힌다.
                session.noteChange(ev.result.changed ?? ev.args?.file_path, ev.result.diff);
                for (const l of renderDiff(ev.result.diff, { maxLines: DIFF_LINES[session.level] ?? 20 })) say(l);
              } else if (ev.result?.여럿?.length) {
                /*
                 * 한 번에 여러 개를 만들거나 고쳤다.
                 *
                 * Write 는 바뀐 자리를 안 그린다. 새 파일 다섯 개의 diff 는
                 * 곧 그 파일 전체라, 화면이 수백 줄로 밀려 올라간다 —
                 * 그러면 무엇이 만들어졌는지가 오히려 안 보인다.
                 *
                 * Edit 은 그린다. 고친 자리는 몇 줄뿐이고, 그 몇 줄이야말로
                 * 사람이 봐야 하는 것이다 — auto 모드는 안 물어보고 고치니까.
                 * 다만 전체 몫을 한 번 정해 두고 그 안에서만 그린다. 스무 군데를
                 * 고치면 화면이 밀려 올라가고, 그러면 안 그리느니만 못하다.
                 */
                let 남은diff = DIFF_LINES[session.level] ?? 20;
                for (const f of ev.result.여럿) {
                  if (f.ok) {
                    session.noteChange(f.path, f.diff);
                    // Write 는 줄 수, Edit 은 군데 수. 없는 쪽을 '· undefined줄' 로 적으면 안 된다.
                    const 몫 = f.lines != null ? `· ${f.lines}줄` : f.군데 != null ? `· ${f.군데}군데` : '';
                    say(`      ${c.green('✓')} ${c.white(f.보인이름)} ${c.gray(몫)}`);
                    if (f.군데 != null && f.diff && 남은diff > 0) {
                      const 줄들 = renderDiff(f.diff, { maxLines: 남은diff });
                      for (const l of 줄들) say(l);
                      남은diff -= 줄들.length;
                    }
                  } else {
                    say(`      ${c.red('✗')} ${c.white(f.보인이름 ?? '(경로 없음)')} ${c.gray(`— ${clip(String(f.error), 60)}`)}`);
                  }
                }
              } else if (ev.result?.바뀐것들?.length) {
                /*
                 * 폴더를 옮겼다. 옮겨진 파일을 **하나씩** 적어 둔다.
                 *
                 * 「이 폴더가 바뀌었다」 로 적으면 나중에 /commit 이 그 폴더를
                 * 통째로 담고, 같은 폴더에 있던 남의 변경까지 실린다.
                 * 줄 수는 0 이다 — 옮긴 것이지 고친 것이 아니다.
                 */
                for (const f of ev.result.바뀐것들) session.noteChange(f, { added: 0, removed: 0 });
              }
            }
            flush();   // 도구가 하나 끝날 때마다 적어 둔다
            break;

          /*
           * 하위 작업을 떼어 냈다.
           *
           * 이 줄이 없으면 하위가 부른 도구들이 부모 것과 뒤섞여 찍힌다 —
           * 사람은 부모가 파일 열두 개를 읽은 줄로 본다. 여기와 아래 task_done
           * 이 그 구간의 여닫는 괄호다.
           */
          case 'task_start':
            clearThinking();
            if (streamed) { 답비우기(); say(''); streamed = false; }
            화면.일바꿈('하위', clip(ev.목적, 24));
            // 사무실은 도는 하위 작업 수만큼 자리를 채운다.
            도는하위 += 1;
            화면.하위갱신(도는하위);
            say('');
            say(`  ${c.hmagenta('⌥')} ${c.bold('하위 작업')} ${c.white(clip(ev.목적, 60))}`
              + ` ${c.gray(`· ${보일이름(ev.모드)} · 최대 ${ev.steps}걸음`)}`);
            say(`  ${c.gray('여기서부터는 따로 떨어진 대화입니다 — 결과 요약만 위로 올라옵니다.')}`);
            /*
             * 다른 모델에게 떼어 줬으면 여기서 말한다.
             *
             * 상태줄의 ⌂ 는 이 세션의 연결을 보고 있어서 하위가 딴 데로
             * 나가는 것을 모른다. 이 줄이 그 사실을 남기는 유일한 자리다.
             * 바깥으로 나가면 노랗게 — 그냥 지나칠 수 없게.
             */
            if (ev.모델) {
              say(ev.밖으로
                ? `  ${c.hyellow('↗')} ${c.hyellow(ev.모델)} ${c.gray('— 이 덩이는 바깥으로 나갑니다')}`
                : `  ${c.hgreen('⌂')} ${c.gray(`${ev.모델} — 이 컴퓨터 안입니다`)}`);
            }
            break;

          case 'task_done': {
            clearThinking();
            if (streamed) { 답비우기(); say(''); streamed = false; }
            도는하위 = Math.max(0, 도는하위 - 1);
            화면.하위갱신(도는하위);
            const 끝 = ev.끝 ?? {};
            const 잘됨 = 끝.type === 'done';
            const 왜 = { done: '끝냈습니다', limit: '걸음 수를 다 써서 멈췄습니다 — 다 못 했습니다',
              stuck: '헛돌아서 스스로 멈췄습니다 — 다 못 했습니다',
              aborted: '중단했습니다' }[끝.type] ?? '끝난 이유를 알 수 없습니다';
            say('');
            say(`  ${잘됨 ? c.green('✓') : c.yellow('⚠')} ${c.gray('하위 작업')} ${c.white(clip(ev.목적, 50))}`
              + ` ${c.gray(`— ${왜}`)} ${c.gray(`(${끝.steps ?? 0}걸음${ev.모델 ? ` · ${ev.모델}` : ''})`)}`);
            // 무엇이 실제로 생겼는지는 하위가 한 말이 아니라 디스크가 말한다.
            만든파일보이기(끝.files);
            if (끝.why) say(`  ${c.gray(`막힌 데: ${clip(끝.why, 80)}`)}`);
            break;
          }

          case 'trimmed':
            say(`  ${c.gray(`(컨텍스트가 차서 오래된 대화 ${ev.dropped}개를 줄였습니다)`)}`);
            break;

          /*
           * 접는 중.
           *
           * 여기는 모델을 한 번 더 부르는 자리라 최대 1분이 걸린다. 전에는 글자
           * 한 줄을 \r 로 찍어 놓고 끝이었다 — 움직이는 것이 없으니 답 도중에
           * 화면이 멈춘 것처럼 보였다. 실제로 그렇게 보고 강제 종료한 적이 있다.
           * 돌아가는 표시를 세워 두면 '기다리면 되는 것' 임을 알 수 있다.
           * (Ctrl+C 로 멈출 수도 있다 — 그건 compact.js 쪽에서 받는다.)
           */
          case 'compacting':
            화면.일바꿈('접기');
            clearThinking();
            화면.돌리기('컨텍스트가 찼습니다 — 앞선 대화를 요약해 접는 중…');
            접는중 = true;
            break;

          /*
           * 요약 압축보다 먼저 오는 것. 대화는 안 건드리고 옛 도구 결과만 접었다.
           * 조용히 하면 사람은 어느 파일 내용이 왜 사라졌는지 모른다 — 한 줄로 알린다.
           */
          case 'folded': {
            clearThinking();
            say(`  ${c.cyan('◲')} ${c.gray(`오래된 도구 결과 ${ev.접은것}개를 접었습니다 — `)}`
              + `${c.white(ev.아낀토큰.toLocaleString())} ${c.gray('토큰을 비웠습니다. 대화는 그대로입니다.')}`);
            /*
             * 무엇을 접었는지 이름으로 보여 준다.
             *
             * 조용히 버리면 "아까 그 파일 내용 어디 갔지" 를 사람이 스스로 답할 수
             * 없다. 개발자 수준에서만 편다 — 쉬움 수준에서는 숫자 한 줄이면 된다.
             */
            const 접은것들 = ev.접은것들 ?? [];
            if (접은것들.length && session.level !== '쉬움') {
              const 보일것 = 접은것들.slice(0, 4)
                .map((x) => `${x.도구}${x.곳 ? `(${x.곳})` : ''}`).join(' · ');
              const 남은수 = 접은것들.length - Math.min(4, 접은것들.length);
              say(`    ${c.gray(`${보일것}${남은수 > 0 ? ` 외 ${남은수}개` : ''}`)}`);
            }
            break;
          }

          case 'images_folded': {
            clearThinking();
            const 장수 = (ev.뺀것들 ?? []).reduce((a2, x) => a2 + x.장수, 0);
            say(`  ${c.cyan('◲')} ${c.gray(`오래된 그림 ${장수}장을 뺐습니다 — 사람이 쓴 말은 그대로입니다.`)}`);
            break;
          }

          case 'compacted': {
            접기멈춤();
            const 줄인 = ev.before - ev.after;
            say(`  ${c.cyan('◱')} ${c.gray(`대화 ${ev.folded}개를 요약으로 접었습니다 — `)}` +
                `${c.gray(ev.before.toLocaleString())} ${c.gray('→')} ${c.white(ev.after.toLocaleString())} ${c.gray('토큰')} ` +
                `${c.green(`(${Math.round((줄인 / Math.max(1, ev.before)) * 100)}% 줄어듦)`)}`);
            if (ev.fallback) say(`     ${c.yellow('요약을 못 받아 그냥 줄였습니다.')}`);
            // 접히면 이력이 통째로 바뀐다. 덧붙이기로는 못 맞추니 새로 적는다.
            ctx.갈래.현재store().replace(session.messages, `압축 — ${ev.folded}개를 요약으로`);
            saved = session.messages.length;
            break;
          }

          // 서버가 거절하면서 알려 준 한계를 받아 적었다. 실패로 보이면 안 된다 —
          // 사용자 눈에는 잠깐 멈췄다가 그냥 잘 되는 것으로 보여야 맞다.
          case 'learned':
            clearThinking();
            say(`  ${c.cyan('◎')} ${c.gray(
              ev.what === 'ctx'
                ? `서버가 알려 준 컨텍스트 한계 ${ev.limit.toLocaleString()} 으로 맞추고 다시 부릅니다`
                + (ev.asked ? c.gray(` (${ev.asked.toLocaleString()} 을 보냈었습니다)`) : '')
                + (ev.guessed ? c.gray(' — 숫자를 안 알려 줘서 절반으로 줄여 봅니다') : '')
                : `서버가 알려 준 답 길이 한계 ${ev.limit.toLocaleString()} 으로 맞추고 다시 부릅니다`,
            )}`);
            if (session.level === '개발자' && ev.from) say(`     ${c.gray(clip(ev.from, 110))}`);
            break;

          /*
           * 답이 천장에서 잘렸고 우리가 더 해 줄 것이 없다.
           *
           * 조용히 넘기면 화면에는 중간에서 끊긴 답만 남는다 — 사람은 모델이
           * 대충 답한 줄 알고 같은 것을 다시 시키고, 같은 자리에서 또 잘린다.
           * 손댈 자리를 그 자리에서 알려 준다.
           */
          case 'capped':
            clearThinking();
            say(`  ${mark.warn} ${c.gray(`답이 ${c.white(ev.cap.toLocaleString())} 토큰에서 잘렸습니다`)}`
              + `${ev.정한값 ? c.gray(' (직접 정하신 상한입니다)') : c.gray(' — 더 못 올리는 천장입니다')}`);
            say(`     ${c.gray('한 번에 더 길게 받으려면')} ${c.cyan('/out 32k')}${c.gray('. 파일을 쓰는 중이었다면 Append 로 나눠 쓰게 하세요.')}`);
            break;

          case 'compact_failed':
            접기멈춤();
            say(`  ${c.gray(`(접지 못했습니다: ${ev.why})`)}`);
            break;

          case 'limit':
            끊긴할일 = ev.남은할일 ?? [];
            say('');
            say(`  ${mark.warn} 도구 호출 ${ev.steps}회에서 멈췄습니다.`);
            // 무엇이 안 끝났는지 그 자리에 적는다. 위로 스크롤해 도구 줄을
            // 세어 보게 하면, 이어서 시킬 때 무엇을 시켜야 할지 알 수 없다.
            if (ev.남은할일?.length) {
              say('');
              say(`  ${c.gray('안 끝난 것')}`);
              for (const t of ev.남은할일.slice(0, 8)) {
                say(`    ${t.state === 'doing' ? c.hyellow('▶') : c.gray('☐')} ${c.white(clip(t.text, 70))}`);
              }
              if (ev.남은할일.length > 8) say(`    ${c.gray(`… 그 밖에 ${ev.남은할일.length - 8}개`)}`);
            }
            만든파일보이기(ev.files);
            break;

          // 같은 자리를 계속 반복하고 있다. 두면 컨텍스트만 차고 아무것도 안 나온다.
          case 'stuck':
            턴탈났나 = true;
            clearThinking();
            if (streamed) { 답비우기(); say(''); streamed = false; }
            say('');
            say(`  ${c.yellow('⊘')} ${c.bold('같은 자리에서 헛돌고 있어 멈췄습니다.')}`);
            say(`  ${c.gray(ev.why)}`);
            if (/잘렸|잘립니다|잘려/.test(String(ev.why))) {
              say(`  ${c.gray('한 번에 만들 내용이 모델의 출력 한도보다 큽니다.')}`);
              // 여기서 /think 를 권한 적이 있다. 틀린 안내였다 — /think 는 '얼마나 생각하나'
              // 이지 '얼마나 길게 답하나' 가 아니다. 오히려 같은 예산에서 생각을 더 하게
              // 만들어 답을 더 잘리게 한다. 출력 상한은 /out 이다.
              say(`  ${c.gray('출력 한도를 올리려면')} ${c.cyan('/out')}${c.gray(' 로 지금 값을 보고 올려 보세요.')}`);
              say(`  ${c.gray('그래도 안 되면 나눠서 시키셔도 됩니다 — 예: "뼈대만 먼저" → "표 추가" → "그래프 추가"')}`);
            } else {
              say(`  ${c.gray('같은 방법으로는 안 됩니다. 다르게 시켜 보시거나, 무엇을 하려는지 한 줄로 알려 주세요.')}`);
            }
            // 멈췄어도 여기까지 만든 것은 있다. 그것부터 알려 준다 —
            // 없는 줄 알고 다시 시키면 앞서 만든 것을 덮어쓴다.
            만든파일보이기(ev.files);
            break;

          case 'aborted':
            턴탈났나 = true;
            clearThinking();
            if (streamed) { 답비우기(); say(''); streamed = false; }
            say('');
            // 남았는지 아닌지를 **사실대로** 말한다. 전에는 무조건 '남아 있다' 고 했는데
            // 실제로는 아무것도 안 남는 경우가 있었다. 그러면 "이어서 해줘" 라고 했을 때
            // 모델이 방금 제가 한 말을 모른다. 안내가 거짓이면 안 하느니만 못하다.
            say(`  ${c.yellow('⊘')} ${c.gray(ev.kept
              ? '중단했습니다. 여기까지는 대화에 남아 있으니 이어서 말씀하세요.'
              : '중단했습니다. 아직 받은 것이 없어 대화에는 아무것도 안 남았습니다 — 다시 말씀하셔야 합니다.')}`);
            break;

          case 'error':
            턴탈났나 = true;
            clearThinking();
            say('');
            오류보이기(ev.text);
            break;

          /*
           * 조사만 하고 되물어서 한 번 밀어 봤다 (agent/loop.js).
           *
           * 조용히 밀면 모델이 말을 들은 것인지 우연히 다시 생각한 것인지
           * 구분이 안 된다. 한 줄 적어 둠다 — 또 이러면 사람이 알아볼 수 있어야 한다.
           */
          case 'nudge':
            clearThinking();
            if (streamed) { 답비우기(); say(''); streamed = false; }
            say('');
            say(ev.why === '요청누락'
              ? `  ${c.gray(`↺ 시킨 것 ${ev.빠진?.length ?? 0}가지를 빼놓고 끝내려고 해서 되밀었습니다`)}`
              : `  ${c.gray('↺ 읽기만 하고 끝내려고 해서 한 번 되밀었습니다')}`);
            break;

          case 'done':
            clearThinking();
            if (streamed) { 답비우기(); say(''); }
            만든파일보이기(ev.files);
            /*
             * 되밀고도 그대로면 사람에게 말한다.
             *
             * 조용히 넘어가면 사람은 다 된 줄 알고 그 위에 다음 것을 쌓는다.
             * 나중에 발견했을 때는 이미 늦다. 「몇 번 까먹거나 누락되거나」라는
             * 제보가 정확히 그 모양이었다 — 빠진 것 자체보다, 빠졌다는 말을
             * 안 한 것이 문제다.
             */
            if (ev.빠진?.length) {
              say('');
              say(`  ${c.yellow('!')} ${c.white(`시킨 것 중 ${ev.빠진.length}가지가 안 다뤄졌습니다`)}`);
              for (const x of ev.빠진) say(`    ${c.gray(`${x.번호}. ${clip(x.글, 68)}`)}`);
            }
            break;
        }
      }
    } catch (err) {
      턴탈났나 = true;
      접기멈춤();
      clearThinking();
      say('');
      오류보이기(err.message);
    }
    접기멈춤();
    // 어떻게 끝났든 일하는 표시는 반드시 걷는다. 오류로 빠져나온 길에서
    // 안 걷으면 돌아가는 표시가 화면에 붙박이로 남고, 시계도 계속 돈다.
    화면.일끝();
    // 중간에 끊겨도 자리는 비운다. 안 비우면 다음 턴이 시작될 때까지
    // 아무도 안 도는 방에 사람이 앉아 있다.
    화면.함께갱신(0);
    화면.하위갱신(0);
    clearInterval(제목시계);
    /*
     * 오래 걸린 턴만 알린다. "안녕" 에 1초 만에 답할 때마다 딩 소리가 나면
     * 사람은 이틀 만에 알림을 꺼 버리고, 그러면 정작 3분짜리 턴도 못 듣는다.
     * 알림은 아껴 써야 알림이다. (문턱은 ui/notify.js 의 알릴만한초)
     */
    /*
     * 되돌릴 수 있는 턴 수를 여기서 한 번 센다.
     *
     * 상태줄이 직접 세게 하면 안 된다 — 상태줄은 사람이 글자 하나 칠 때마다
     * 다시 그려지고, 거기서 이력 파일을 열면 타이핑이 끊긴다. 턴 경계에서
     * 한 번 세어 두면 화면은 그 숫자만 읽으면 된다.
     */
    try { session.되돌릴턴 = ctx.history.turns().length; } catch { /* 못 세면 그냥 둔다 */ }
    if (알릴까({ 걸린밀리초: Date.now() - started, 켬: 알림.켬 })) 종();
    창제목(제목글(턴탈났나 ? '탈남' : '끝남', { 폴더: 알림.폴더 }));
    turn = null;
    interrupted = false;   // 중단은 '끝내기' 의사가 아니다. 종료 카운트를 되돌린다.
    flush();               // 오류로 끝났어도 여기까지는 남긴다

    // ── 꼬리말 — 이번 턴만의 숫자 ────────────────────────────────────────
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const bits = [`${secs}초`];
    if (tools) bits.push(`도구 ${tools}회`);
    const dIn = session.usage.in - before.in;
    const dOut = session.usage.out - before.out;
    if (dIn || dOut) bits.push(`↑${dIn.toLocaleString()} ↓${dOut.toLocaleString()}`);
    say('');
    say(`  ${c.gray('─'.repeat(2))} ${c.gray(bits.join(c.gray(' · ')))}`);

    /*
     * ── 계획 승인 ──────────────────────────────────────────────────────
     *
     * 겹친 요청("계획해주고 만들어줘")일 때만 온다. 그냥 "고쳐줘" 에는 안 뜬다 —
     * 이 프로젝트는 승인 게이트 대신 되돌리기로 가기로 했고, 그 결정을
     * 아무 때나 뜨는 창으로 갉아먹으면 안 된다.
     *
     * ⏎ 하나로 진행되는 것이 중요하다. 여기서 뭘 더 치게 하면 사람은
     * 애초에 계획 같은 걸 안 보려 든다.
     */
    if (계획승인받나 && !턴탈났나) {
      const 할일 = (ctx.todos ?? []).filter((t) => t.state !== 'done');
      say('');
      계획상자(할일);
      say('');
      // 계획을 다 내놓고 사람 답을 기다리는 자리다. 위 confirm 과 같은 이유로 알린다.
      if (알릴까({ 물어봄: true, 켬: 알림.켬 })) 종();
      창제목(제목글('물어봄', { 폴더: 알림.폴더 }));
      const 답 = String(await ask(
        `이대로 진행할까요? ${c.gray('⏎ 진행 · n 취소 · 그 밖엔 고칠 점')}`,
        { def: 'y' },
      )).trim();
      const 낮춘 = 답.toLowerCase();

      if (['n', 'no', 'ㄴ', '취소', '아니', '아니요', '아니오'].includes(낮춘)) {
        say(`  ${c.gray('그만뒀습니다. 계획은 위에 남아 있으니 이어서 말씀하셔도 됩니다.')}`);
      } else if (['y', 'yes', 'ㅇ', 'ㅇㅇ', 'ㄱ', 'ㄱㄱ', '네', '응', '진행', 'ok'].includes(낮춘)) {
        /*
         * 승인한 계획을 **글자 그대로 실어 보낸다.**
         *
         * 예전에는 "위 계획을 승인받았다 · 적어 둔 단계를 하나씩 끝내라" 라고만
         * 보냈다. 사람 눈에는 계획이 바로 위에 있으니 말이 되는데, 모델에게
         * 이건 **가리키기만 하고 안 주는 말**이다. 그래서 작은 모델은 "적어 둔"
         * 것을 찾으러 Recall 로 지난 대화를 뒤지기 시작했다 — 세 번 뒤지고
         * 세 번 못 찾고, 정작 시킨 일은 시작도 안 했다.
         *
         * 계획은 이미 손에 있다(ctx.todos). 가리키지 말고 준다. 두 번 적는
         * 것이 아까워서 안 준 것이었는데, 아낀 토큰보다 헛도는 값이 훨씬 컸다.
         */
        const 단계글 = 할일.map((t, i) => `${i + 1}. ${String(t.text ?? '')}`).join('\n');
        이어갈것 = (할일.length
          ? `방금 낸 계획을 사람이 승인했다. 계획은 아래 그대로다.\n\n${단계글}\n\n`
            + '지금부터 이 단계를 하나씩 실제로 해라.'
          : '바로 위에 네가 적은 계획을 사람이 승인했다.'
            + ' 그 계획을 다시 적지 말고 지금부터 그대로 해라.')
          + ' 계획을 다시 적지 마라. **지난 대화를 뒤지지 마라** — 필요한 것은'
          + ' 이 대화 안에 다 있다. 다 끝나면 무엇을 만들었는지만 짧게 알려라.';
        이어갈모드 = 'code';
        say('');
        say(`  ${c.hgreen('▶')} ${c.gray('계획대로 진행합니다.')}`);
      } else {
        // 'e' 를 따로 두지 않는다 — 고칠 점을 바로 치는 것이 한 걸음 짧다.
        이어갈것 = `계획에서 이걸 고쳐서 **계획만** 다시 내라 (아직 실행하지 마라): ${답}`;
        이어갈모드 = 'plan';
        say('');
        say(`  ${c.hcyan('☰')} ${c.gray('그 점을 반영해 계획을 다시 냅니다.')}`);
      }
    } else if (끊긴할일) {
      /*
       * ── 끊긴 자리에서 ⏎ 하나로 잇는다 ────────────────────────────────
       *
       * 「중간에 끊기는 이슈가 생기는거 같은데 해당 문제점들이 극복되면 좋겠어」
       *
       * 걸음 상한은 안전장치라 없앨 수 없다 — 그게 없으면 헛도는 턴이
       * 컨텍스트를 다 먹을 때까지 안 멈춘다. 없앨 게 아니라 **잇는 길**을
       * 놔야 한다.
       *
       * 이어갈 말에는 남은 단계를 **글자 그대로 싣는다.** 계획 승인에서
       * 배운 것과 같은 이유다 — "아까 하던 것 이어서 해라" 는 가리키기만
       * 하고 안 주는 말이라, 작은 모델은 그 '아까' 를 찾으러 지난 대화를
       * 뒤지기 시작한다.
       */
      // 끝난 것을 빼는 것은 loop.js 가 이미 한 번 한다. 여기서 또 하는 것은
      // 이 말이 **끝난 일을 다시 시키는 말**이 되면 안 되기 때문이다 —
      // 저쪽 걸러내기가 언젠가 바뀌어도 이 자리는 안 흔들려야 한다.
      const 남은 = 끊긴할일.filter((t) => t && t.state !== 'done');
      say('');
      if (알릴까({ 물어봄: true, 켬: 알림.켬 })) 종();
      창제목(제목글('물어봄', { 폴더: 알림.폴더 }));
      const 답 = String(await ask(
        `이어서 할까요? ${c.gray('⏎ 이어서 · n 그만')}`,
        { def: 'y' },
      )).trim().toLowerCase();

      if (['n', 'no', 'ㄴ', '취소', '그만', '아니', '아니요', '아니오'].includes(답)) {
        say(`  ${c.gray('여기서 멈췄습니다. 나중에 「이어서 해줘」 라고 하셔도 됩니다.')}`);
      } else {
        const 단계글 = 남은.map((t, i) => `${i + 1}. ${String(t.text ?? '')}`).join('\n');
        이어갈것 = (남은.length
          ? '걸음 수를 다 써서 중간에 멈췄다. 사람이 이어서 하라고 했다.\n\n'
            + `아직 안 끝난 것은 아래 그대로다.\n\n${단계글}\n\n`
            + '이것부터 이어서 실제로 해라.'
          : '걸음 수를 다 써서 중간에 멈췄다. 사람이 이어서 하라고 했다.'
            + ' 하던 자리에서 이어서 해라.')
          + ' **이미 끝낸 것은 다시 하지 마라.** 지난 대화를 뒤지지 마라 —'
          + ' 필요한 것은 이 대화 안에 다 있다. 처음부터 다시 시작하지도 마라.';
        // 모드를 다시 고르지 않는다. 이 말에는 '해라' 가 들어 있어서 다시
        // 고르면 엉뚱한 데로 가고, 애초에 하던 일을 잇는 것이라 바뀔 이유가 없다.
        이어갈모드 = session.routed ?? (session.work === 'auto' ? 'code' : session.work);
        say('');
        say(`  ${c.hgreen('▶')} ${c.gray(`끊긴 자리에서 이어서 합니다${남은.length ? ` (남은 ${남은.length}가지)` : ''}.`)}`);
      }
    }
  }

  rl.close();
  // 남의 터미널을 우리 이름으로 두고 나가지 않는다. 켤 때 있던 제목으로 돌려놓는다.
  제목되돌리기();
  // 띄운 남의 프로세스는 반드시 거둔다. 안 거두면 deel 을 껐는데도
  // 그 서버가 계속 돌고 있게 된다 — 사람 눈에는 안 보이는 채로.
  for (const s of mcp붙임.서버들) s.닫기();
  // 언어 서버도 같이 거둔다. 이건 사람 눈에 안 보이는 채로 메모리를 몇백 MB
  // 물고 있는 종류라, 남겨 두면 나중에 작업 관리자를 열기 전에는 모른다.
  언어서버다끄기().catch(() => {});
  // 뒤에서 돌던 명령도 같이 거둔다. 이걸 조용히 하면 안 된다 —
  // 사람은 dev 서버가 아직 떠 있다고 여기고 브라우저를 새로 고치다가
  // "왜 안 되지" 로 시간을 쓴다. 몇 개를 껐는지 말해 준다.
  {
    const 껐다 = 일감모두끝내기();
    if (껐다) say(`  ${mark.ok} ${c.gray(`뒤에서 돌던 명령 ${껐다}개를 같이 껐습니다.`)}`);
  }
  // 미리보기 서버도 같은 이유로 거둔다. 안 거두면 포트를 물고 있는 채로 남아,
  // 다음에 띄운 것과 두 개가 뜬다 — 어느 쪽을 보고 있는지 알 수 없게 된다.
  {
    const 껐다 = await 미리보기끄기();
    if (껐다) say(`  ${mark.ok} ${c.gray(`미리보기를 껐습니다 (${껐다.서버.url}).`)}`);
  }
  // 끝맺음은 화면을 접기 **전에** 그린다. close() 가 상자를 걷어내므로,
  // 그 뒤에 찍으면 걷어낸 자리에 뜬금없이 한 줄이 남는다.
  say('');
  say(`  ${c.gray('끝냅니다.')} ${c.gray(`모델 호출 ${session.usage.calls}회 · 도구 시간 ${(session.usage.ms / 1000).toFixed(1)}초 · ↑${session.usage.in.toLocaleString()} ↓${session.usage.out.toLocaleString()}`)}`);
  say('');
  화면.close();
  return 0;
}

/**
 * "첫 판단·high" 처럼 지금 도는 단계를 짧게.
 *
 * 쉬움 수준에서는 아무것도 안 붙인다. '이어가기·low' 는 우리 내부 단계 이름과
 * 추론 강도이지 사람이 시킨 것이 아니다 — 고를 일이 없는 사람에게 보여 주면
 * 그것부터 무슨 뜻인지 걱정하게 된다. 그냥 '생각 중…' 이면 된다.
 */
function stageTag(ev, level) {
  if (!ev || level === '쉬움') return '';
  const label = STAGES[ev.stage]?.label ?? ev.stage;
  return `${label}·${ev.level}`;
}
