// 대화 화면. 루프가 보내는 이벤트를 Claude Code 풍으로 그린다.
import { createInterface, emitKeypressEvents } from 'node:readline';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { c, say as 바로쓰기, mark, clip } from './ui/ansi.js';
import { headerLines } from './ui/status.js';
import { 화면고르기 } from './ui/screen.js';
import { STAGES } from './agent/effort.js';
import { handle, COMMANDS } from './commands.js';
import { next as nextWork, get as getWork, canWrite } from './agent/modes.js';
import { route } from './agent/route.js';
import { run } from './agent/loop.js';
import { Session } from './agent/session.js';
import { makeScope } from './safety/guard.js';
import { History } from './safety/undo.js';
import { Audit } from './safety/audit.js';
import { activeProfile, load, resolveKey, save as saveCfg } from './config.js';
import { discover } from './skills/discover.js';
import { allowEndpoint, setOffline, isOffline, isLocalHost } from './safety/network.js';
import { Store, latest, prune } from './agent/store.js';
import { askHidden } from './ui/prompt.js';
import { explain, shows as levelShows } from './ui/level.js';
import { 고르기 as 승인고르기, 다음 as 승인다음 } from './ui/approve.js';
import { 추천, 채울글 } from './ui/complete.js';
import { probeCtx, 기본값 as CTX_DEFAULT } from './backend/ctxsize.js';
import { renderDiff, shortStat } from './ui/diff.js';
import { expand as expandMentions } from './agent/mention.js';
import { 다붙이기 } from './backend/mcp.js';
import { 프롬프트토막 as 기억토막, 읽기 as 기억읽기 } from './agent/memory.js';
import { 갈래고르기 } from './ui/working.js';

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
};

// 도구 호출을 한 줄로 요약 — Read(src/a.js) 처럼.
function toolLabel(name, args) {
  const a = args ?? {};
  const first =
    a.file_path ?? a.pattern ?? a.path ?? a.url ?? a.name ?? a.목적 ??
    (a.command ? String(a.command).replace(/\s+/g, ' ').slice(0, 52) : null) ??
    // 한 번에 여러 파일을 쓸 때. 빈 괄호를 띄우면 화면만 보고는 무엇을
    // 만들었는지 알 수 없다 — 첫 파일과 개수를 적는다.
    (Array.isArray(a.files) && a.files.length
      ? `${a.files[0]?.file_path ?? '?'}${a.files.length > 1 ? ` 외 ${a.files.length - 1}개` : ''}`
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
  };

  // 이 자리 하나만 연다. 다른 어디로도 나가지 못한다.
  allowEndpoint(conn.base);
  if (opts.offline ?? prof.offline) setOffline(true);

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
      const { messages } = store.load();
      if (messages.length) {
        session.messages = messages;
        say('');
        say(`  ${mark.ok} ${c.bold(target)} ${c.gray(`— 메시지 ${messages.length}개를 이어 받았습니다.`)}`);
      }
    }
  }
  if (!store) store = new Store(root);
  store.begin({ model: conn.model, base: conn.base, root });
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
  // 지난 대화에서 정해 둔 것을 들고 시작한다.
  session.memory = 기억토막(root);

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

  rl.on('line', (l) => {
    if (echo) say(c.gray(l));
    if (상자쓰나) {
      if (묻는중 !== null) {
        // 되묻는 자리: 답을 그 줄에 남긴 채 줄만 넘긴다.
        process.stdout.write(`\r\x1b[2K${묻는중}${c.white(l)}\n`);
      } else if (입력기다림) {
        // 상자를 걷어내고, 사람이 보낸 글을 대화에 남긴다. 안 남기면 스크롤을
        // 올렸을 때 답만 있고 무엇을 물었는지가 없다.
        화면.입력지움();
        if (l.trim()) say(` ${c.hcyan('❯')} ${c.white(l)}`);
      } else if (l.trim()) {
        /*
         * 일하는 도중에 미리 쳐 둔 것.
         *
         * 여기서 대화에 `❯ …` 를 찍으면 **이미 보낸 것처럼** 보인다. 실제로는
         * 지금 일이 끝난 뒤에 나가므로, 그때 가서 찍는다(아래 for 문). 지금은
         * 상자에 몇 건이 밀려 있는지만 세어 준다.
         */
        화면.대기갱신('', queue.length + 1);
      }
    }
    if (waiter) { const w = waiter; waiter = null; w(l); }
    else queue.push(l);
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
    process.stdin.on('keypress', (_ch, key) => {
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
        say(`  ${c.hcyan(w.glyph)} ${c.bold(w.name)} ${c.gray('(' + w.en + ')')}  ${c.gray(w.hint)}`
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
        const 채울 = 채울글(rl.line ?? '', 지금추천(rl.line ?? ''));
        if (채울) rl.write(채울);
        // 채울 게 없어도 그리기는 한다 — 후보 목록이 그대로 남아 있어야 한다.
        화면.입력갱신(session, rl.line ?? '', rl.cursor ?? 0, 지금추천(rl.line ?? ''));
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
      if (key && key.name === 'return') return;   // 줄이 끝나는 것은 'line' 이 맡는다
      if (묻는중 !== null) {
        const 앞 = 묻는중;
        setImmediate(() => {
          if (묻는중 === null) return;
          process.stdout.write(`\r\x1b[2K${앞}${c.white(rl.line ?? '')}`);
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
          화면.입력갱신(session, rl.line ?? '', rl.cursor ?? 0, 지금추천(rl.line ?? ''));
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
          화면.대기갱신(rl.line ?? '', queue.length);
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
    history: new History(root),
    audit: new Audit(root),
    seen: new Set(),
    // 붙은 MCP 서버. 도구를 부를 때 여기서 찾는다.
    mcp: mcp붙임.서버들,
    skills: found.skills,
    loadedSkills: new Set(),
    ask,
    // 암호는 여기서만 받는다. 받은 값은 도구가 쓰고 버린다 —
    // 설정에도, 세션 기록에도, 감사기록에도, 명령줄에도 안 남는다.
    askPassword: async (label) => {
      if (closed) return null;
      const pw = await askHidden(rl, label, nextLine);
      return pw === null || pw === '' ? null : pw;
    },
    confirm: async (name, args) => {
      say('');
      say(`  ${c.yellow('?')} ${toolLabel(name, args)}`);
      const a = (await ask('실행할까요? (y/n)', { def: 'y' })).toLowerCase();
      return a === 'y' || a === 'yes' || a === 'ㅇ';
    },
  };

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

  // ── 머리말 ────────────────────────────────────────────────────────────
  화면.머리말(headerLines(session, found));
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
  say(`  ${c.gray('/help 명령 목록')}   ${c.gray('/think 추론 강도')}   ${c.gray('Ctrl+C 중단·끝내기')}`);

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
    const 글 = 상자쓰나 && 입력기다림 ? (rl.line ?? '') : '';
    화면.입력자리(session, 글, 글 ? (rl.cursor ?? 0) : 0, 글 ? 지금추천(글) : []);
  };

  // Ctrl+C 는 상황에 따라 뜻이 다르다.
  //   모델이 답하는 중  → 그 답을 끊는다 (프로그램은 살아 있다)
  //   입력을 기다리는 중 → 한 번은 경고, 두 번이면 끝낸다
  // 느린 로컬 모델이 엉뚱한 답을 길게 뽑기 시작했을 때 끝까지 기다리지 않아도 된다.
  let interrupted = false;
  let turn = null;              // 지금 도는 턴의 AbortController
  rl.on('SIGINT', () => {
    if (turn && !turn.signal.aborted) {
      turn.abort();
      return;                   // 화면 정리는 루프 쪽 'aborted' 이벤트가 한다
    }
    if (interrupted) { rl.close(); return; }
    interrupted = true;
    say('');
    say(`  ${c.gray('한 번 더 Ctrl+C 를 누르면 끝냅니다.')}`);
    prompt();
  });

  for (;;) {
    prompt();
    입력기다림 = true;
    // 줄이 이미 쌓여 있으면 그건 **일하는 동안 미리 쳐 둔 것**이다.
    // 그때는 대화에 안 찍었으니(찍으면 이미 보낸 것처럼 보인다) 지금 찍는다.
    const 예약이었나 = queue.length > 0;
    const line = await nextLine();
    입력기다림 = false;
    if (line === null) break;          // 입력이 끝났다 (파이프 종료 / Ctrl+D)
    interrupted = false;
    const text = line.trim();
    if (!text) continue;
    if (예약이었나 && 상자쓰나) {
      화면.입력지움();
      say(` ${c.hcyan('❯')} ${c.white(text)}  ${c.gray('(미리 쳐 둔 것)')}`);
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
    if (toSend.includes('@')) {
      const 예산 = Math.min(20000, Math.floor((session.conn.ctx ?? CTX_DEFAULT) * 0.25));
      const r = expandMentions(toSend, {
        scope: ctx.scope, budget: 예산, seen: ctx.seen,
        onRead: (p, t) => session.noteRead(p, t),
      });
      보낼글 = r.text;
      for (const a of r.attached) {
        say(`  ${c.blue('◧')} ${c.gray('붙임')} ${c.white(a.show)}${a.full ? '' : c.gray(' (앞부분만)')}`);
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
    if (session.work === 'auto') {
      const 골라진 = route(toSend);
      if (골라진.mode) {
        session.routed = 골라진.mode;
        const w = getWork(골라진.mode);
        say('');
        say(`  ${c.hcyan(w.glyph)} ${c.bold(w.name)} ${c.gray('(' + w.en + ')')}`
          + `  ${c.gray('말 속에 ' + 골라진.why + ' 가 있어서')}`
          + (canWrite(골라진.mode) ? '' : `  ${c.green('· 파일은 안 바꿉니다')}`));
        say(`  ${c.gray('다르면')} ${c.cyan('/code')} ${c.gray('처럼 직접 고르세요. 그때부터는 안 바뀝니다.')}`);
      }
    }

    say('');
    const started = Date.now();
    const before = { in: session.usage.in, out: session.usage.out };

    // 어디까지 적었는지. 도중에 죽어도 여기까지는 남아 있게 자주 흘려 보낸다.
    let saved = session.messages.length;
    const flush = () => {
      for (const m of session.messages.slice(saved)) store.append(m);
      saved = session.messages.length;
    };
    let tools = 0;
    let thinkChars = 0;
    let streamed = false;
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
    try {
      for await (const ev of run(session, ctx, 보낼글, { signal: turn.signal })) {
        /*
         * 하위 작업 안쪽에서 온 것이면 한 단 들여 그린다.
         *
         * 여기 한 줄이 아래 switch 의 say() 예순 곳을 다 덮는다. 각 자리마다
         * 들여쓰기를 붙이면 새 이벤트를 더할 때마다 하나씩 빠뜨리게 된다.
         */
        화면.들여쓰기(ev.depth ?? 0);
        switch (ev.type) {
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
          case 'content':
            clearThinking();
            if (!streamed) { streamed = true; 화면.일바꿈('답'); 화면.붙임(`  ${답표시} `); }
            화면.붙임(ev.text.replace(/\n/g, `\n  ${답표시} `));
            break;

          case 'tool_start':
            clearThinking();
            if (streamed) { say(''); streamed = false; }
            // 문구를 지금 하는 일에 맞춘다. 아무 말이나 돌려 대면 두 번째부터
            // 아무도 안 읽고, 그때부터는 화면이 조용한 것과 같아진다.
            화면.일바꿈(갈래고르기(ev.name));
            say('');
            say(`  ${toolLabel(ev.name, ev.args)}`);
            break;

          // 여럿을 같이 돌린다 — 한 줄로 알리고, 이름은 결과와 붙여서 그린다.
          case 'tools_start':
            clearThinking();
            if (streamed) { say(''); streamed = false; }
            화면.일바꿈(갈래고르기(ev.names?.[0]));
            say('');
            say(`  ${c.gray(`${ev.count}개를 함께 돌립니다`)} ${c.gray('·')} ${c.gray(ev.names.join(' '))}`);
            break;

          case 'tool':
            tools++;
            // 걸러져 나온 것(인자가 잘렸거나, 모르는 도구거나, 거부된 것)은
            // '시작' 을 안 거쳤다. 그래서 '생각 중…' 줄이 안 지워진 채로 결과가
            // 그 줄 뒤에 가서 붙고, 이름도 없이 "└ 인자가 잘렸습니다" 만 남는다.
            // 무슨 도구가 왜 그랬는지 알 수 없는 화면이 된다.
            if (ev.showLabel) { clearThinking(); if (streamed) { say(''); streamed = false; } say(''); }
            // 같이 돈 것은 이름을 다시 적어 준다. 안 그러면 어느 결과인지 모른다.
            if (ev.parallel || ev.showLabel) say(`  ${toolLabel(ev.name, ev.args)}`);
            if (ev.name === 'TodoWrite' && ev.result?.todos) {
              for (const t of ev.result.todos) {
                const 표 = t.state === 'done' ? c.green('☑') : t.state === 'doing' ? c.hyellow('▶') : c.gray('☐');
                const 글 = t.state === 'done' ? c.gray(t.text) : t.state === 'doing' ? c.white(t.text) : c.gray(t.text);
                say(`    ${표} ${clip(글, 74)}`);
              }
            } else {
              say(`    ${toolResultLine(ev.result, ev.ms ?? 0)}`);
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
                 * 한 번에 여러 개를 만들었다.
                 *
                 * 여기서는 바뀐 자리를 안 그린다. 새 파일 다섯 개의 diff 는
                 * 곧 그 파일 전체라, 화면이 수백 줄로 밀려 올라간다 —
                 * 그러면 무엇이 만들어졌는지가 오히려 안 보인다.
                 * 파일마다 한 줄씩만 적고, 자세한 것은 /diff 가 맡는다.
                 */
                for (const f of ev.result.여럿) {
                  if (f.ok) {
                    session.noteChange(f.path, f.diff);
                    say(`      ${c.green('✓')} ${c.white(f.보인이름)} ${c.gray(`· ${f.lines}줄`)}`);
                  } else {
                    say(`      ${c.red('✗')} ${c.white(f.보인이름 ?? '(경로 없음)')} ${c.gray(`— ${clip(String(f.error), 60)}`)}`);
                  }
                }
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
            if (streamed) { say(''); streamed = false; }
            화면.일바꿈('하위', clip(ev.목적, 24));
            say('');
            say(`  ${c.hmagenta('⌥')} ${c.bold('하위 작업')} ${c.white(clip(ev.목적, 60))}`
              + ` ${c.gray(`· ${getWork(ev.모드).name} · 최대 ${ev.steps}걸음`)}`);
            say(`  ${c.gray('여기서부터는 따로 떨어진 대화입니다 — 결과 요약만 위로 올라옵니다.')}`);
            break;

          case 'task_done': {
            clearThinking();
            if (streamed) { say(''); streamed = false; }
            const 끝 = ev.끝 ?? {};
            const 잘됨 = 끝.type === 'done';
            const 왜 = { done: '끝냈습니다', limit: '걸음 수를 다 써서 멈췄습니다 — 다 못 했습니다',
              stuck: '헛돌아서 스스로 멈췄습니다 — 다 못 했습니다',
              aborted: '중단했습니다' }[끝.type] ?? '끝난 이유를 알 수 없습니다';
            say('');
            say(`  ${잘됨 ? c.green('✓') : c.yellow('⚠')} ${c.gray('하위 작업')} ${c.white(clip(ev.목적, 50))}`
              + ` ${c.gray(`— ${왜}`)} ${c.gray(`(${끝.steps ?? 0}걸음)`)}`);
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

          case 'compacted': {
            접기멈춤();
            const 줄인 = ev.before - ev.after;
            say(`  ${c.cyan('◱')} ${c.gray(`대화 ${ev.folded}개를 요약으로 접었습니다 — `)}` +
                `${c.gray(ev.before.toLocaleString())} ${c.gray('→')} ${c.white(ev.after.toLocaleString())} ${c.gray('토큰')} ` +
                `${c.green(`(${Math.round((줄인 / Math.max(1, ev.before)) * 100)}% 줄어듦)`)}`);
            if (ev.fallback) say(`     ${c.yellow('요약을 못 받아 그냥 줄였습니다.')}`);
            // 접히면 이력이 통째로 바뀐다. 덧붙이기로는 못 맞추니 새로 적는다.
            store.replace(session.messages, `압축 — ${ev.folded}개를 요약으로`);
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

          case 'compact_failed':
            접기멈춤();
            say(`  ${c.gray(`(접지 못했습니다: ${ev.why})`)}`);
            break;

          case 'limit':
            say('');
            say(`  ${mark.warn} 도구 호출 ${ev.steps}회에서 멈췄습니다. ${c.gray('이어서 하려면 다시 말씀하세요.')}`);
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
            clearThinking();
            if (streamed) { say(''); streamed = false; }
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
            clearThinking();
            if (streamed) { say(''); streamed = false; }
            say('');
            // 남았는지 아닌지를 **사실대로** 말한다. 전에는 무조건 '남아 있다' 고 했는데
            // 실제로는 아무것도 안 남는 경우가 있었다. 그러면 "이어서 해줘" 라고 했을 때
            // 모델이 방금 제가 한 말을 모른다. 안내가 거짓이면 안 하느니만 못하다.
            say(`  ${c.yellow('⊘')} ${c.gray(ev.kept
              ? '중단했습니다. 여기까지는 대화에 남아 있으니 이어서 말씀하세요.'
              : '중단했습니다. 아직 받은 것이 없어 대화에는 아무것도 안 남았습니다 — 다시 말씀하셔야 합니다.')}`);
            break;

          case 'error':
            clearThinking();
            say('');
            오류보이기(ev.text);
            break;

          case 'done':
            clearThinking();
            if (streamed) say('');
            만든파일보이기(ev.files);
            break;
        }
      }
    } catch (err) {
      접기멈춤();
      clearThinking();
      say('');
      오류보이기(err.message);
    }
    접기멈춤();
    // 어떻게 끝났든 일하는 표시는 반드시 걷는다. 오류로 빠져나온 길에서
    // 안 걷으면 돌아가는 표시가 화면에 붙박이로 남고, 시계도 계속 돈다.
    화면.일끝();
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
  }

  rl.close();
  // 띄운 남의 프로세스는 반드시 거둔다. 안 거두면 deel 을 껐는데도
  // 그 서버가 계속 돌고 있게 된다 — 사람 눈에는 안 보이는 채로.
  for (const s of mcp붙임.서버들) s.닫기();
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
