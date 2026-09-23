// ACP 에이전트. 에디터 안에서 deel 을 쓰는 길이다.
//
// ── 무엇인가 ────────────────────────────────────────────────────────────
//
// ACP(Agent Client Protocol)는 에디터와 코딩 에이전트 사이의 말이다. 이걸
// 지키면 Zed·JetBrains·Neovim·Emacs 가 **자기 쪽을 안 고치고** deel 을 붙인다.
// 에디터가 deel 을 자식 프로세스로 띄우고, 표준입출력으로 JSON 줄을 주고받는다.
//
// ── 왜 이게 이 프로그램에 중요한가 ──────────────────────────────────────
//
// 사내에 반입한 도구는 "터미널을 하나 더 띄우세요" 를 못 넘는다. 개발자는
// 하루 종일 IDE 안에 있고, 창을 옮겨 다녀야 하는 도구는 두 주쯤 뒤에 안 쓴다.
// 반입 심사를 통과한 판이 아무도 안 쓰는 판이 되는 것이 제일 아까운 결말이다.
//
// 그리고 이 프로토콜은 deel 이 이미 가진 것과 잘 맞는다 — 로컬 모델을 쓰므로
// 코드가 밖으로 안 나가는데, 그 성질은 IDE 안에서 쓸 때 비로소 값이 붙는다.
//
// ── 딱 하나 지켜야 하는 것 ──────────────────────────────────────────────
//
// **표준출력에는 ACP 메시지 말고 아무것도 나가면 안 된다.**
//
// 규격이 그렇게 못 박아 두었고, 어기면 조용히 안 깨진다 — 에디터가 그 줄을
// 파싱하다 실패하고, 화면에는 "에이전트가 응답하지 않습니다" 만 뜬다. 원인이
// 어디에도 안 남는다. deel 안에는 say() 로 화면에 적는 자리가 수십 군데다.
// 그 중 하나라도 이 모드에서 불리면 관이 깨진다.
//
// 그래서 여기서 process.stdout.write 를 통째로 바꿔 끼운다. 부르는 자리를
// 하나하나 찾아 막는 방법도 있지만, 그건 앞으로 새로 쓰는 코드까지 계속
// 조심해야 한다는 뜻이다 — 언젠가 반드시 한 군데를 빠뜨린다.
import { existsSync, statSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { VERSION } from '../version.js';
import { 규칙모으기, 늘허락, 정책읽기, 승인바닥 } from '../safety/policy.js';
import { 검사설정 } from '../agent/donecheck.js';
import { 훅읽기 } from '../safety/hooks.js';
import { 에이전트읽기 } from '../agent/agents.js';
import { 남길것읽기 } from '../safety/shellenv.js';
import { 받기설정 } from '../safety/authcmd.js';
import { run } from '../agent/loop.js';
import { Session, repairToolPairs, 규격맞추기 } from '../agent/session.js';
import { Store, sessionsDir, prune, 대화이름인가 } from '../agent/store.js';
import { makeScope } from '../safety/guard.js';
import { History } from '../safety/undo.js';
import { Audit, 열쇠묻기 } from '../safety/audit.js';
import { activeProfile, load, resolveKey, homeDir, save as saveCfg, 소식줄들 } from '../config.js';
import { 말 as 옮긴말 } from '../i18n/index.js';
import { 알림채움, 알림말 } from '../backend/retry.js';
import { 전선붙이기, 세션이름짓기 } from '../backend/wire.js';
import { discover } from '../skills/discover.js';
import { allowEndpoint, setOffline } from '../safety/network.js';
import { 지금모드, 바깥인가, 나갈수있나, 봉인됐나 } from '../safety/runmode.js';
import { 주소가리기 } from '../safety/secrets.js';
import { probeCtx, 기본값 as CTX_DEFAULT } from '../backend/ctxsize.js';
import { 잠잠기본, 무소식기본 } from '../backend/http.js';
import { 인증서설정 } from '../backend/clientcert.js';
import { 다붙이기 } from '../backend/mcp.js';
import { 배움 } from '../agent/evolve.js';
import { 카드 } from '../agent/card.js';
import { 못박기 } from '../agent/pins.js';
import { route } from '../agent/route.js';
import { ORDER as 모드순서, get as getWork, normalize as 모드정리, 보일이름 } from '../agent/modes.js';
import { 모두끝내기 as 일감모두끝내기 } from '../tools/jobs.js';
import { 연결, 줄나누기, 모르는방법오류, 잘못된인자오류, 인증필요오류 } from './jsonrpc.js';
import { 도구시작, 도구끝남, 도구이름표, 도구갈래, 도구자리, 멈춘까닭, 프롬프트글, 되살린것 } from './map.js';

/** 우리가 말하는 규격 판. 정수 하나이고, 깨지는 변경에서만 올라간다. */
const 규격판 = 1;

/**
 * 이 모드에서 표준출력을 잠근다.
 *
 * 잠그고 나면 say() 로 적힌 것은 전부 표준오류로 간다. 규격이 에이전트의
 * 표준오류에는 무엇을 적어도 좋다고 허락하므로, 버리지 않고 그리로 돌린다 —
 * 무언가 잘못됐을 때 그 글이 유일한 단서다.
 *
 * @returns {(줄: string) => void} 진짜 표준출력으로 쓰는 함수. ACP 만 이걸 쓴다
 */
/**
 * 두 폴더 글이 **같은 자리**인가를 가르는 열쇠 (2.0.2 · 508).
 *
 * 글자로 견줬다(윈도에서만 소문자로). 그래서 한 폴더가 두 벌로 셌다 —
 * 맥(대소문자를 안 가리는 APFS)의 `/Users/me/Proj` 와 `/users/me/proj`, 정션·심링크로 들어온 길,
 * 8.3 짧은 이름. 같은 폴더인데 MCP 서버를 한 벌 더 띄우고, 같은 대화를 「다른 폴더로 열려
 * 있다」 며 거절했다. 실제 자리(realpath)로 편 뒤에 견준다 — 맥·윈도의 realpath 는 디스크에
 * 적힌 대소문자로 돌려준다. 윈도는 드라이브 글자(`C:` · `c:`)까지 맞추려고 소문자로 한 번 더 편다.
 * 없는 자리면 글자 그대로 편다(견줄 것은 견준다).
 */
export function 자리열쇠(p) {
  let r = resolve(String(p ?? ''));
  try { r = realpathSync.native(r); } catch { /* 없거나 못 읽는 자리 — 글자로 견준다 */ }
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

export function 표준출력잠그기() {
  const 진짜 = process.stdout.write.bind(process.stdout);
  process.stdout.write = function (덩이, enc, cb) {
    return process.stderr.write(덩이, enc, cb);
  };
  return (줄) => 진짜(줄);
}

/**
 * ACP 에이전트를 띄운다. 표준입력이 닫힐 때까지 산다.
 *
 * @param {object} opts  root/mode/work/think/effort/ctx/offline — 대화 시작 옵션과 같은 뜻
 * @returns {Promise<number>} 종료코드
 */
export async function acp(opts = {}) {
  const 내보내기 = 표준출력잠그기();
  const 로그 = (s) => { try { process.stderr.write(`[acp] ${s}\n`); } catch { /* 여기서 또 터지면 할 게 없다 */ } };

  /*
   * ── 우리가 어떻게 인증받는지 ────────────────────────────────────────────
   *
   * ACP 의 `initialize` 응답에는 authMethods 자리가 있다. 여기를 비워 두면
   * 에디터는 「이 에이전트는 인증이 필요 없다」 로 읽는다. 그런데 deel 은
   * 연결 정보가 없으면 아무 일도 못 한다.
   *
   * 그래서 처음 붙인 사람은 이렇게 됐다 — 에디터에서 deel 을 고르고, 대화를
   * 열고, 「저장된 연결이 없습니다」 를 받는다. 화면만 봐서는 이게 인증
   * 문제인지 버그인지 모른다.
   *
   * 규격에는 그 자리가 있다. **Terminal Auth** — 「터미널에서 이 인자로 나를
   * 다시 띄우면 설정이 끝난다」 고 말하는 방법이다. 그리고 deel 은 그 명령이
   * 이미 있다: `deel setup`. 없는 것을 만드는 게 아니라 **있는 것을 말하는**
   * 일이었다.
   *
   * args 가 진짜 도는 명령인지는 검사가 지킨다(test/acp.test.js 의 5-11).
   * 여기가 틀리면 에디터가 사람에게 없는 명령을 치라고 시킨다.
   */
  const 인증방법들 = [
    {
      id: 'terminal-setup',
      name: 'Run `deel setup` in a terminal',
      description: '로컬 런타임(Ollama · LM Studio · llama.cpp)을 고르거나 게이트웨이 주소와 열쇠를 넣습니다.',
      type: 'terminal',
      args: ['setup'],
    },
  ];

  /** 세션 하나. 에디터의 탭 하나에 해당한다. */
  const 방들 = new Map();

  /*
   * ── 이 프로세스가 연 연결 주소 전부 (6회차 N9) ──────────────────────────
   *
   * 문지기(safety/network.js)의 allowEndpoint 는 「이전에 올린 것은 지운다」 — 부르는
   * 쪽이 **지금 열려 있어야 할 것 전부**를 한 번에 말하라는 약속이다. 여기는 방마다
   * 제 주소 하나만 말했다. 에디터에서 연결이 다른 프로젝트 둘을 열면 둘째 탭을 여는
   * 순간 첫 탭의 주소가 지워져, 첫 탭의 다음 한마디가 「허용되지 않은 주소입니다」 로
   * 막혔다.
   *
   * 방들 에서 모으지 않는 까닭: 방은 **다 만들어진 뒤에야** 방들 에 들어간다(아래 열린자리
   * 머리말). 겹쳐 온 session/new 둘이 서로 상대 주소를 못 보고 지운다. 그래서 허락을
   * 통과한 그 자리에서 바로 적는다. 넓어지는 것이 아니다 — 여기 오르는 주소는 저마다
   * 이 프로세스의 봉인·허락 검사를 지난 것뿐이다.
   */
  const 열린주소 = new Set();

  /*
   * ── 이 프로세스가 내준 대화 이름 → 그 폴더 (사냥5 H5-1) ──────────────────
   *
   * 대화 이름은 초 단위이고, 빈 이름인지는 **그 폴더의 대화 파일**로만 봤다. 그런데
   * 에디터 하나가 이 프로세스로 여러 프로젝트를 연다. 두 프로젝트를 같은 초에 열면
   * 두 폴더 다 그 이름의 파일이 없어서 두 방이 같은 sessionId 를 받았고, 방들 에는
   * 뒤엣것만 남았다. 그 뒤로 A 탭에 한 말이 B 폴더의 대화 파일에 적히고, 모델은 B 를
   * 작업 폴더로 알았다 — 파일을 고치면 **남의 프로젝트**를 고친다.
   *
   * sessionId 는 에디터가 방을 찾는 유일한 열쇠이고, 껐다 켤 때 파일을 찾는 이름이기도
   * 해서 폴더를 섞어 지을 수 없다. 그래서 이 프로세스 안에서는 **안 겹치게** 짓고,
   * 이미 다른 폴더로 연 이름을 또 다른 폴더로 되살리라면 거절한다.
   * 방들 에는 방이 **다 만들어진 뒤에야** 들어가므로(그 사이 MCP 를 붙이느라 기다린다)
   * 겹쳐 온 session/new 둘을 가르려면 이름을 짓는 그 자리에서 바로 적어 둬야 한다.
   */
  const 열린자리 = new Map();
  const 같은자리 = (가, 나) => 자리열쇠(가) === 자리열쇠(나);

  /*
   * 폴더 → MCP 붙임. **폴더 하나에 한 벌**이다.
   *
   * 에디터에서 `session/new` 는 탭 하나다. 사람은 한 프로젝트를 열어 놓고 탭을
   * 서너 개 띄운다 — 그게 에디터를 쓰는 이유다. 그런데 방마다 다붙이기() 를
   * 새로 부르면 같은 `.deel/mcp.json` 을 보고 같은 서버를 탭 수만큼 띄운다.
   *
   * MCP 서버는 남의 프로그램이라 무엇을 들고 뜨는지 우리는 모른다 — 인덱스를
   * 통째로 메모리에 올리는 것도 있고, 뜰 때마다 원격에 붙는 것도 있다. 탭
   * 하나 여는 값도 두 번 치른다: 붙기는 왕복 두 번(initialize + tools/list)이고
   * 그동안 그 탭은 멈춰 있다.
   *
   * 값으로 **약속(Promise)** 을 넣는다. 에디터가 탭 셋을 한꺼번에 열면
   * session/new 셋이 겹쳐 도는데, 다 붙은 뒤에 넣으면 셋 다 빈 칸을 보고
   * 셋 다 띄운다 — 고치려던 것이 그대로 남는다.
   *
   * 폴더가 다르면 따로 띄운다. 옆 프로젝트의 도구가 딸려 오면 안 된다.
   */
  const mcp캐시 = new Map();
  let 클라이언트 = null;      // initialize 로 받은 저쪽 소개
  let 시작했나 = false;

  const 관 = new 연결({
    보내기: 내보내기,
    다루기: (방법, 인자) => 다루기(방법, 인자),
  });

  // ── 방 만들기 ─────────────────────────────────────────────────────────
  /**
   * @param {object} 요청  session/new 또는 session/load 로 온 인자
   * @param {object} o
   * @param {string|null} o.아이디  이어할 대화 이름. 주면 그 파일에 이어 쓴다
   */
  /*
   * 방을 짓다 넘어지면 **잡아 둔 이름을 푼다** (2.0.2 · 508).
   *
   * 이름은 짓자마자 열린자리 에 적는다(겹쳐 온 session/new 가 피하게). 그런데 그 뒤에서
   * 넘어지면(훅·에이전트·감사기록을 여는 자리) 방은 없는데 이름만 남아, 이 창이 끝날 때까지
   * 그 이름을 「다른 폴더로 열려 있다」 며 되살리기를 거절하고 정리(prune)에서도 뺐다.
   */
  async function 방만들기(요청, 옵션 = {}) {
    const 잡은이름 = [];
    try {
      return await 방짓기(요청, 옵션, 잡은이름);
    } catch (err) {
      for (const id of 잡은이름) if (!방들.has(id)) 열린자리.delete(id);
      throw err;
    }
  }

  async function 방짓기(요청, { 아이디 = null } = {}, 잡은이름 = []) {
    /*
     * 작업 폴더를 **설정보다 먼저** 정한다.
     *
     * 여기는 `load()` 가 위에 있었다. 그러면 설정·신뢰·승인 규칙은 이
     * 프로세스를 띄운 자리(process.cwd())를 기준으로 읽히고, 파일을 고치는
     * 쪽만 아래에서 정한 `root` 를 쓴다 — 한 세션 안에서 두 폴더가 섞인다.
     * 자세한 것은 config.js 의 projectDir 머리말에 적어 뒀다.
     */
    /*
     * 에디터가 준 cwd 는 **있는 절대 경로**여야 한다 — 아래 「작업 폴더는 에디터가 정한다」.
     *
     * 여기가 받은 글을 그대로 썼다. 상대 경로(`rel/dir`)면 에디터가 연 프로젝트가 아니라
     * **이 프로세스를 띄운 자리** 기준으로 풀려서, 그 아래 머리말이 「제일 무서운 종류의
     * 실수」 라고 적은 그대로 엉뚱한 폴더를 고친다. 없는 절대 경로면 대화 폴더를 만들다
     * 그 경로를 통째로 새로 만들었다. 둘 다 에디터가 잘못 준 것이니 잘못된 인자로 답한다.
     * 안 주면 예전처럼 --root(없으면 띄운 자리)를 쓴다 — 그건 사람이 띄울 때 정한 것이다.
     */
    /*
     * **빈 글도 준 것이다** (2.0.2 · 508). 빈 글을 안 준 것으로 쳐서 --root 로 갔다 — 규격 위반 입력을
     * 사람이 띄울 때 정한 자리로 조용히 바꿔 여는 것이다. 에디터가 cwd 를 못 채웠다는 뜻이니 거절한다.
     */
    const 준자리 = typeof 요청?.cwd === 'string' ? 요청.cwd : null;
    if (준자리 != null) {
      if (!isAbsolute(준자리)) throw 잘못된인자오류(`cwd 는 절대 경로여야 합니다: ${준자리 || '(빈 글)'}`);
      let 폴더인가 = false;
      try { 폴더인가 = statSync(준자리).isDirectory(); } catch { /* 없다 */ }
      if (!폴더인가) throw 잘못된인자오류(`cwd 가 있는 폴더가 아닙니다: ${준자리}`);
    }
    const root = 준자리 ?? (opts.root ?? process.cwd());
    const cfg = load({ root });
    // 모아 둔 소식을 로그로 비운다 (아래 conn 을 지은 자리의 머리말). 색 제어문자는 뺀다.
    const 소식로그 = () => {
      for (const 줄 of 소식줄들(cfg)) {
        const 맨글 = String(줄).replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (맨글) 로그(맨글);
      }
    };
    const prof = activeProfile(cfg);
    if (!prof) {
      // 연결이 없어 여기서 끝나도 소식은 로그에 남긴다 — 「이 폴더 설정은 안 믿어서
      // 안 읽었다」 가 바로 연결이 없는 까닭일 수 있다.
      소식로그();
      /*
       * 잘못된인자가 아니라 **인증필요**다.
       *
       * 사람이 인자를 잘못 준 것이 아니라 아직 설정을 안 한 것이다. 그 둘은
       * 에디터에서 하는 일이 다르다 — 인증필요(-32000)를 받으면 위 initialize
       * 에서 받아 둔 authMethods 를 꺼내 「터미널에서 설정하기」 를 띄우고,
       * 잘못된인자면 그냥 빨간 글씨만 뜬다. 고칠 방법이 있는데 안 알려 주는
       * 것이 제일 나쁘다.
       */
      throw 인증필요오류('저장된 연결이 없습니다. 터미널에서 `deel setup` 을 먼저 실행하세요.');
    }

    /*
     * 작업 폴더는 에디터가 정한다.
     *
     * 규격은 cwd 를 절대 경로로 주라고 한다. 그 말을 믿고 그대로 쓴다 —
     * 여기서 process.cwd() 로 대신하면 에디터가 연 프로젝트가 아니라 에디터를
     * 띄운 자리를 기준으로 파일을 찾게 된다. 그러면 도구는 멀쩡히 도는데
     * 엉뚱한 폴더를 고친다. 그게 제일 무서운 종류의 실수다.
     */

    /*
     * 대화는 폴더 안(.deel/sessions/)에 남는다 — 터미널에서 하던 것과 같은 자리다.
     *
     * 세션 이름을 그 파일 이름으로 삼는 데는 까닭이 있다. ACP 의 sessionId 는
     * 에디터가 적어 뒀다가 **다음에 켤 때 session/load 로 도로 들고 오는** 이름이다.
     * 'deel-1' 처럼 이 프로세스 안에서만 뜻이 있는 번호를 주면, 껐다 켠 순간 그
     * 이름이 가리키는 것이 아무 데도 없다. 그러면 loadSession 은 못 지킬 약속이 된다.
     */
    if (아이디 && !existsSync(join(sessionsDir(root), `${아이디}.jsonl`))) {
      throw 잘못된인자오류(`그런 대화가 없습니다: ${아이디} (${root})`);
    }
    // 이 이름이 이 프로세스에서 이미 다른 폴더로 열려 있으면 되살리지 않는다 (위 열린자리 머리말).
    const 먼저연곳 = 아이디 ? 열린자리.get(아이디) : undefined;
    if (먼저연곳 !== undefined && !같은자리(먼저연곳, root)) {
      throw 잘못된인자오류(`이 대화 이름은 이 창에서 이미 다른 폴더로 열려 있습니다: ${아이디} (${먼저연곳}) — 폴더가 다른 두 대화를 한 이름으로 섞지 않습니다.`);
    }
    const store = new Store(root, 아이디, { 피할것: (id) => 열린자리.has(id) });

    const conn = {
      kind: prof.kind, base: prof.baseUrl, auth: prof.auth,
      key: resolveKey(prof), model: prof.model,
      ctx: opts.ctx ?? prof.ctx ?? CTX_DEFAULT,
      maxTokens: opts.maxTokens ?? prof.maxTokens ?? null,
      streaming: prof.streaming ?? false,
      tools: prof.tools ?? false, json: prof.json ?? false, think: prof.think ?? false,
      /*
       * ── 문이 셋인데 둘만 이걸 넣고 있었다 ──────────────────────────
       *
       * repl.js 와 oneshot.js 는 이 두 열쇠를 넣는데 여기만 안 넣고 있었다.
       * 같은 프로필로 같은 게이트웨이에 붙는데 **들어온 문에 따라 다른
       * 프로그램**이 되던 자리다.
       *
       *   vision   : 없으면 아래 눈있나 게터가 늘 거짓이 되어, 그림을 볼 수
       *              있는 모델에 붙어 있어도 「이 모델은 그림을 못 봅니다」
       *              라고 답한다. 모델 얘기인데 우리 쪽 사실이 틀렸다.
       *   열쇠받기 : 없으면 401 을 받고 열쇠를 다시 받아 오는 길이 잠긴다
       *              (backend/adapter.js 가 !!conn.열쇠받기 로 잠근다).
       *              한 시간짜리 토큰을 쓰는 사내 게이트웨이가 그 꼴이다 —
       *              터미널에서는 되고 에디터에서는 한 시간 뒤에 죽는다.
       *
       * test/doorparity.test.js 가 세 문의 열쇠 집합을 맞춰 본다.
       */
      vision: prof.vision ?? false,
    /*
       * 흘려 받다가 이만큼 잠잠하면 끊는다 (밀리초, backend/http.js).
       *
       * 답이 다 오는 데 걸린 시간이 아니라 **아무것도 안 온 시간**이다. 그래서
       * 30분짜리 답은 안 끊기고 30초 멎은 연결은 30초에 끊긴다. 답을 통째로
       * 모았다가 한 번에 주는 사내 게이트웨이면 이 값을 올린다.
       */
        잠잠: prof.잠잠 ?? prof.streamIdleMs ?? 잠잠기본,
        // 바이트는 오는데 내용이 안 올 때의 전체 상한 (backend/http.js 의 무소식기본).
        무소식: prof.무소식 ?? prof.streamNoNewsMs ?? 무소식기본,
    // 게이트웨이가 우리 인증서를 요구하면 (mTLS, backend/clientcert.js).
      // 파일 경로만 싣는다 — 알맹이는 요청 직전에 읽는다.
        인증서: 인증서설정(prof),
      열쇠받기: 받기설정(prof, { 정책값: 정책읽기().값 }),
    };
    /*
     * 모아 둔 소식을 로그로 비운다 (config.js 의 소식줄들).
     *
     * 이 문은 넷 중 하나도 안 당겼다. 에디터 화면에는 안 뜨지만 에디터의 로그
     * 창에는 남는다 — 안 비우면 관리 정책이 깨지거나 이 폴더 설정을 걷어내도
     * 어디에도 흔적이 없다. 열쇠탈은 resolveKey 뒤라야 생기므로 conn 을 지은 여기서.
     * 로그에는 색 제어문자를 뺀다.
     */
    소식로그();

    /*
     * 바깥으로 나가는 연결은 허가가 있어야 연다 (safety/runmode.js).
     *
     * 에디터에는 승인 창이 있지만 그건 **도구 실행**을 묻는 창이고, 「이 대화가
     * 통째로 바깥으로 나갑니다」 를 물을 자리는 규격에 없다. 그래서 여기서는
     * 묻지 않고 또렷하게 거절한다 — 에디터 화면에 이 글이 그대로 뜬다.
     */
    const 바깥연결 = 바깥인가(conn.base);
    const 실행모드 = 지금모드({
      online: opts.online === true,
      // 관리 정책이 offline 을 못박아 뒀으면 옵션과 상관없이 켠다 (safety/policy.js).
      // 셋 중 하나라도 켜져 있으면 켜진 것이다 (safety/runmode.js 의 봉인됐나).
      offline: 봉인됐나({ 깃발: opts.offline, prof, cfg }),
    });
    const 나감 = 나갈수있나(실행모드, { 바깥: 바깥연결, 허가: prof.online === true });
    if (나감.물어볼까) {
      const 어디 = (() => { try { return new URL(conn.base).host; } catch { return conn.base; } })();
      throw 잘못된인자오류(
        `이 연결은 이 컴퓨터 밖으로 나갑니다 (${주소가리기(어디)}).`
        + ' 터미널에서 deel 을 한 번 켜서 허락하거나, deel acp --online 으로 띄우세요.');
    }
    // 제 주소만 말하면 옆 탭의 주소가 지워진다 — 연 주소 전부를 한 번에 (위 열린주소 머리말).
    열린주소.add(conn.base);
    allowEndpoint([...열린주소]);
    if (실행모드.허가무시) setOffline(true);

    const session = new Session(conn, {
      root,
      // 에디터에는 승인 창이 있다. 그러니 대화 화면과 같은 기본값을 쓴다 —
      // 비대화 모드처럼 무조건 거부할 이유가 없다. 물어볼 데가 있기 때문이다.
      mode: opts.mode ?? 'auto',
      work: opts.work ?? null,
      think: opts.think ?? 'medium',
      effort: opts.effort ?? 'save',
    });
    // 지금 어느 실행 모드인가. 화면이 첫 줄에 이걸 그린다(ui/status.js).
    // session 에 실어 두는 까닭은, 대화 도중 /model 로 옮겨도 같은 자리를 보게 하려는 것이다.
    session.실행모드 = 실행모드;

    /*
     * 열쇠를 받아 오는 명령 (safety/authcmd.js). oneshot.js 와 같은 까닭으로 건다 —
     * 안 걸면 명령이 아무 말 없이 돌고 못 받은 까닭이 사라진다.
     *
     * 에디터의 승인 창은 **도구 호출**을 묻는 자리라 여기 쓰지 않는다. 무엇을
     * 띄우는지 로그에 먼저 적고 띄운다. 명령은 이 PC 설정·관리 정책에서만 온다.
     */
    if (conn.열쇠받기) {
      session.열쇠물어보기 = async (설정) => {
        로그(`열쇠를 받아 오는 명령을 띄웁니다: ${String(설정?.명령 ?? '').slice(0, 160)}`);
        return true;
      };
      session.onAuth = (것) => {
        if (것?.type === '시작') return 로그(옮긴말('auth.waiting'));
        if (것?.type === '끝') return undefined;
        if (것?.ok) {
          const 분 = 것.만료 ? Math.max(0, Math.round((것.만료 - Date.now()) / 60000)) : '?';
          return 로그(옮긴말('auth.got', { 분 }));
        }
        로그(`${옮긴말('auth.failed', { 왜: 것?.왜 ?? '?' })}${것?.보인것 ? ` — ${String(것.보인것).slice(0, 160)}` : ''}`);
        return undefined;
      };
    }

    const found = discover(root);
    session.skills = found.skills;
    session.commands = found.commands;
    session.plugins = found.plugins;
    session.못박은것 = new 못박기();

    /*
     * 이어하기라면 적힌 것을 도로 채워 넣는다.
     *
     * repairToolPairs 를 반드시 거친다. 도구가 도는 중에 프로그램이 끊겼으면
     * 부름만 적히고 답이 없는데, 그대로 보내면 규격 서버가 400 을 준다 —
     * 되살리자마자 첫 마디에서 죽는다. 터미널의 --resume 과 같은 손질이다.
     */
    if (아이디) {
      const { messages: 적힌것 } = store.load();
      const { messages: 짝맞춘것, 고친것 } = repairToolPairs(적힌것);
      /*
       * 다른 규격으로 적힌 대화면 지금 규격으로 옮겨 적는다 (agent/session.js 의 규격맞추기).
       * 저장 파일 머리글에는 규격이 없어서, 어제 Anthropic 으로 한 대화를 오늘 OpenAI
       * 호환 프로필로 열면 tool_use 블록이 그대로 나가 첫 마디가 400 이었다.
       * 터미널은 threads.js 가 같은 것을 한다.
       */
      const 옮김 = 규격맞추기(짝맞춘것, conn.kind);
      const messages = 옮김.messages;
      session.messages = messages;
      if (옮김.바꾼것) 로그(`${store.id} — 다른 규격으로 적힌 메시지 ${옮김.바꾼것}개를 ${conn.kind} 모양으로 옮겨 적었습니다.`);
      // 못 박아 둔 것도 같이 되살린다 (agent/pins.js). 이걸 빠뜨리면 '접어도
      // 안 지워진다' 가 에디터를 닫았다 여는 한 번에 거짓이 된다.
      const 박힌것 = store.못박은것읽기();
      if (박힌것.length) {
        session.못박은것 = new 못박기(박힌것);
        // 다 안 실리면 적는다 (6회차 못박기6u W4 — repl.js 되살리기와 같은 까닭).
        const 실림 = session.못박은것.실린것();
        if (실림.개수 < 박힌것.length) 로그(`${store.id} — 못 박아 둔 것 ${박힌것.length}개 가운데 ${실림.개수}개만 프롬프트에 실립니다 (개수·자리 상한). /pin 으로 줄이세요.`);
      }
      로그(`${store.id} — 메시지 ${messages.length}개를 이어 받았습니다${고친것 ? ` (끊긴 도구 호출 ${고친것}개는 걷어냈습니다)` : ''}.`);
    }
    // 주소는 가려서 적는다. 열쇠가 주소에 박혀 오는 게이트웨이가 있어서,
    // 그대로 적으면 대화 기록 파일에 열쇠가 남는다 (safety/secrets.js).
    store.begin({ model: conn.model, base: 주소가리기(conn.base), root });
    // begin() 이 이름을 옮겼을 수 있으니 그 뒤에 적는다. Store 를 지은 자리부터 여기까지
    // 기다림이 없어서, 겹쳐 온 session/new 도 이 적힌 것을 보고 이름을 피한다.
    열린자리.set(store.id, root);
    잡은이름.push(store.id);
    /*
     * 남은 할 일과 시킨 말 원문도 이 파일과 묶는다 (agent/store.js 의 살림따라가기).
     *
     * 이걸 거는 자리가 터미널(agent/threads.js)에만 있었다. 그래서 에디터로 연 대화는
     * todo·request 줄을 한 번도 안 적었고, session/load 로 되살려도 할 일이 안 돌아왔다 —
     * store.js 가 「따로 부르는 자리를 만들면 그 길로 들어온 사람만 이어하기가 반쪽이
     * 된다」 고 적어 둔 바로 그 모양이다. 이어하기면 여기서 할 일·시킨 말을 되살리고,
     * 그 뒤로는 적기() 의 append 마다 바뀐 만큼 적힌다. 첫 한마디 전인 여기여야 한다.
     */
    store.살림따라가기(session);
    /*
     * 열어 둔 대화는 정리에서 뺀다 (사냥5 H5-2, agent/store.js 의 prune 머리말).
     *
     * 한 달 넘은 대화를 session/load 로 되살리면 그 파일은 시각이 옛날 그대로라, 바로
     * 여기서 지워지고 다음 한 줄이 머리글도 옛 대화도 없는 새 파일에 적혔다. 같은
     * 폴더에 탭을 하나 더 열어도 이 정리가 또 도므로, 이 방 하나가 아니라 **이
     * 프로세스가 연 대화 전부**를 넘긴다. 다른 폴더의 이름이 섞여도 잃는 것은 없다.
     */
    try { prune(root, { 남길것: [...열린자리.keys()] }); } catch { /* 정리는 못 해도 대화는 된다 */ }

    /*
     * 밖에서 붙인 도구(MCP).
     *
     * 규격에는 클라이언트가 mcpServers 를 넘겨 주는 자리가 있다. 그런데 그걸
     * 그대로 띄우면 **에디터 설정에 적힌 프로세스를 deel 이 대신 띄우는** 셈이
     * 된다. 사내 반입 심사에서 "이 도구가 무엇을 띄우는가" 는 제일 먼저 묻는
     * 것이라, 그 답이 '에디터가 시키는 대로' 가 되면 안 된다.
     *
     * 그래서 deel 은 늘 제 폴더의 .deel/mcp.json 만 본다. 사람이 직접 적은 것만
     * 띄운다는 규칙이 대화 화면과 여기서 똑같이 유지된다.
     */
    // 같은 폴더면 한 벌 — 글자가 달라도 (자리열쇠 머리말 · 2.0.2 · 508). `C:` · `c:` 로 두 벌 띄웠었다.
    const 캐시열쇠 = 자리열쇠(root);
    if (!mcp캐시.has(캐시열쇠)) {
      mcp캐시.set(캐시열쇠, 다붙이기(root, {
        // 봉인은 MCP 를 붙이는 자리에도 그대로 걸린다 (safety/runmode.js 의 봉인됐나).
        offline: 봉인됐나({ 깃발: opts.offline, prof, cfg }),
        audit: null,
      }).then((붙임) => {
        /*
         * 못 붙은 것은 **못 붙었다고 말한다.**
         *
         * 대화 화면은 이걸 적어 준다(repl.js 의 경고 줄). 여기만 안 적고
         * 있었다. 그러면 에디터 안에서는 도구가 그냥 없다 — 왜 없는지는
         * 어디에도 안 남는다. 사람은 모델이 게을러진 줄 안다.
         */
        for (const m of 붙임.못한것 ?? []) 로그(`MCP ${m.이름} 을 못 붙였습니다 — ${m.왜}`);
        if (붙임.서버들.length) 로그(`MCP ${붙임.서버들.length}대에 붙었습니다 (${캐시열쇠}) — 이 폴더의 다른 탭도 같이 씁니다.`);
        return 붙임;
      }).catch((err) => {
        // 붙이다 터져도 탭은 열려야 한다. 도구가 없는 채로 대화는 된다.
        로그(`MCP 를 붙이다 실패했습니다 — ${err?.message ?? err}`);
        return { 서버들: [], 못한것: [], 설정: null };
      }));
    }
    const mcp붙임 = await mcp캐시.get(캐시열쇠);
    session.mcp = mcp붙임.서버들;
    if (Array.isArray(요청?.mcpServers) && 요청.mcpServers.length) {
      로그(`에디터가 MCP 서버 ${요청.mcpServers.length}대를 넘겼지만 띄우지 않습니다 — deel 은 .deel/mcp.json 에 적힌 것만 띄웁니다.`);
    }

    const 방 = {
      id: store.id,
      root, conn, session, store,
      턴: null,
      늘허락: new Set(),        // 이 세션에서 "앞으로 묻지 않기" 를 고른 도구들
      mcp: mcp붙임.서버들,
      도구번호: 0,
      메시지번호: 0,
      돌던도구: new Map(),      // 도구 이름 → 아직 안 끝난 호출 아이디들
    };

    // 훅은 방마다 새로 읽는다 — 에디터는 폴더마다 방을 하나씩 여니까 (safety/hooks.js).
    const 훅정보 = 훅읽기(root, { 켜짐: opts.hooks === false ? false : null });
    const 에이전트정보 = 에이전트읽기(root);

    방.ctx = {
      scope: makeScope(root),
      get 모델컨텍스트() { return conn.ctx ?? null; },
      // 이 모델이 그림을 볼 수 있나 — Read 가 그림을 만났을 때 무슨 말을 할지가 여기서 갈린다.
      get 눈있나() { return !!conn.vision; },
      // 적어 둔 허락·금지 규칙 (safety/policy.js). 승인 모드보다 먼저 본다.
      규칙들: 규칙모으기(cfg),
      // 끝내려는 자리에서 돌릴 검사 (agent/donecheck.js). 터미널과 같은 설정을 읽는다.
      완료검사: 검사설정(cfg),
      // 사람이 적어 둔 훅 (safety/hooks.js). 에디터 안에서도 같은 것이 돌아야 한다 —
      // 여기만 빠지면 「터미널에서는 막히고 에디터에서는 안 막힌다」 가 된다.
      훅들: 훅정보.훅들,
      에이전트들: 에이전트정보.에이전트들,
      // Bash 자식에게 되살려 줄 환경변수 이름 (safety/shellenv.js).
      // 에디터 안에서도 같은 값이어야 한다 — 여기만 빠지면 「에디터에서만
      // 빌드가 된다·안 된다」 가 되고, 그건 원인을 찾을 길이 없다.
      셸남길것: 남길것읽기(cfg),
      history: new History(root),
      audit: new Audit(root, { 열쇠들: 열쇠묻기(conn) }),
      seen: new Set(),
      mcp: mcp붙임.서버들,
      skills: found.skills,
      loadedSkills: new Set(),
      /*
       * 되묻는 자리.
       *
       * ACP 1판에는 '아무거나 물어보기' 가 없다. 승인은 있어도 자유 질문은
       * 없다. 그러니 기다리면 안 된다 — 기다리면 에디터는 아무 창도 안 띄우고
       * deel 은 영영 서 있는다. 기본값을 바로 돌려준다.
       */
      ask: async (_라벨, o = {}) => o?.def ?? '',
      askPassword: async () => null,
      confirm: (이름, 인자, 곁것 = {}) => 승인묻기(방, 이름, 인자, 곁것?.미리보기),
    };

    방.ctx.배움 = new 배움(root, homeDir());
    /*
     * 전선 카드와 이 대화의 이름 (backend/wire.js).
     *
     * 에디터에서 붙어도 나가는 전선은 같다. 여기만 빼 두면 Zed 로 쓰는
     * 사람만 캐시가 안 걸리고, 그건 화면 어디에도 안 나타난다.
     */
    전선붙이기(conn, 방.ctx.배움);
    session.세션이름 = 세션이름짓기(store.id);
    conn.세션이름 = session.세션이름;
    session.배움요약 = 방.ctx.배움.요약(conn.model);
    const 아는배수 = 방.ctx.배움.아는보정(conn.model);
    if (아는배수) { session.보정 = 아는배수; session.보정잰것 = 1; }

    방.ctx.카드다시 = () => {
      방.ctx.카드 = 카드(conn.model, session.본것, 방.ctx.배움?.현황(conn.model)?.모델);
      return 방.ctx.카드;
    };
    방.ctx.카드다시();

    // 컨텍스트 길이는 서버에 물어본다. 저장된 값을 믿으면 조용히 작아진다.
    // 못 물어봐도 여기서 멈출 일은 아니다.
    if (opts.ctx == null) {
      try {
        const r = await probeCtx(conn, { timeout: 6000 });
        if (r?.value) conn.ctx = r.value;
      } catch { /* 설정값 그대로 간다 */ }
    }

    방들.set(방.id, 방);
    return 방;
  }

  function 방찾기(id) {
    const 방 = 방들.get(String(id ?? ''));
    if (!방) throw 잘못된인자오류(`그런 세션이 없습니다: ${id}`);
    return 방;
  }

  // ── 승인 ──────────────────────────────────────────────────────────────
  //
  // deel 의 안전장치를 에디터의 승인 창으로 그대로 내보낸다. 이게 붙는 것과
  // 안 붙는 것의 차이가 크다 — 안 붙으면 위험한 명령을 물어볼 데가 없어서
  // 무조건 거부하게 되고, 그러면 에디터 안에서는 아무 일도 못 하는 도구가 된다.
  async function 승인묻기(방, 이름, 인자, 미리보기 = []) {
    /*
     * ── 끊긴 턴의 승인은 없다 (사냥5 H5-3) ─────────────────────────────────
     *
     * 승인 창을 띄워 두고 사람이 안 누른 채 취소했다. 여기 기다림이 턴의 끊기 신호를
     * 안 봐서, 그 턴은 취소된 뒤에도 **답이 올 때까지** 서 있었다. 한참 뒤 옛 창의
     * 「이번만 실행」 이 닿자 취소한 턴이 그대로 파일을 썼다. 사람은 취소를 눌렀는데.
     *
     * 그래서 기다림을 지금 도는 턴의 신호에 묶고(끊기면 거둔다), 답이 온 **뒤에도**
     * 한 번 더 본다 — 답과 취소가 엇갈려 닿으면 허락이 이긴 채로 돌아갈 수 있다.
     * 신호는 방.도는신호 에서 읽는다. 한 방의 턴은 앞 턴이 끝나야 도므로(한턴 머리말)
     * 이 물음을 부른 턴이 곧 그 신호의 턴이다.
     */
    const 신호 = 방.도는신호 ?? null;
    if (신호?.aborted) return false;
    /*
     * 관리 정책이 승인 바닥을 걸었으면 「앞으로 묻지 않기」 는 없다 (safety/policy.js 의 승인바닥).
     * 바닥은 바꾸기 전에 사람이 본다는 약속이라, 버튼 한 번으로 그 사람을 빼는 길을 주면
     * 안 된다. 전에 눌러 둔 늘 허락도 이 판에서는 안 먹는다.
     */
    const 바닥걸림 = 승인바닥().바닥 !== 'auto';
    if (방.늘허락.has(이름) && !바닥걸림) return true;

    const 아이디 = `t${++방.도구번호}`;
    try {
      const 답 = await 관.요청('session/request_permission', {
        sessionId: 방.id,
        toolCall: {
          toolCallId: 아이디,
          title: 도구이름표(이름, 인자),
          kind: 도구갈래(이름),
          status: 'pending',
          locations: 도구자리(이름, 인자, null, { 뿌리: 방.root }),
          rawInput: 인자 ?? {},
          /*
           * 무엇이 바뀌는지를 같이 보낸다 (tools/index.js 의 바뀔내용). 편집기는 이걸 승인 창에
           * diff 로 그린다. 여태는 제목 한 줄과 날것 인자만 보내서, 사람은 old_string·new_string
           * JSON 을 읽고 허락해야 했다. 새 파일이면 oldText 가 null 이다 (ACP 의 Diff 꼴).
           */
          ...(Array.isArray(미리보기) && 미리보기.length
            ? { content: 미리보기.map((것) => ({ type: 'diff', path: 것.경로, oldText: 것.전, newText: 것.후 })) }
            : {}),
        },
        options: [
          { optionId: 'allow_once', name: '이번만 실행', kind: 'allow_once' },
          ...(바닥걸림 ? [] : [{ optionId: 'allow_always', name: `${이름} 은 앞으로 묻지 않기`, kind: 'allow_always' }]),
          { optionId: 'reject_once', name: '하지 않기', kind: 'reject_once' },
        ],
      }, { signal: 신호 });

      // 답을 기다리는 사이에 턴이 끊겼으면 허락이 와도 안 한다 (위 머리말).
      if (신호?.aborted) return false;
      const 결과 = 답?.outcome ?? {};
      if (결과.outcome !== 'selected') return false;   // cancelled 도 여기로 온다
      if (결과.optionId === 'allow_always' && 바닥걸림) return true;
      if (결과.optionId === 'allow_always') {
        방.늘허락.add(이름);
        /*
         * '앞으로 묻지 않기' 는 **다음에 켤 때도** 안 물어야 한다.
         *
         * 이 켠 동안만 기억하면 사람은 편집기를 닫았다 열 때마다 같은 것을
         * 다시 허락한다. 그러면 그 버튼은 '앞으로' 가 아니라 '이번 켠 동안' 이다.
         * 설정에 적어 두고, 다음부터는 규칙이 먼저 통과시킨다 (safety/policy.js).
         *
         * 금지에 걸리는 것은 안 적는다 — 적어 봐야 금지가 이기는데 목록에는
         * 허락으로 보여서, 사람이 풀린 줄 안다.
         */
        try {
          // 이 방의 폴더로 읽는다. 그냥 load() 는 에디터를 띄운 자리의 설정과
          // 금지를 봐서, 열어 둔 프로젝트의 deny 와 부딪치는지를 엉뚱하게 갈랐다.
          const cfg = load({ root: 방.root });
          const r = 늘허락(cfg, 이름, 규칙모으기(cfg));
          if (r.ok) saveCfg(cfg);
        } catch { /* 못 적어도 이번 켠 동안은 먹는다 */ }
        return true;
      }
      return 결과.optionId === 'allow_once';
    } catch (err) {
      // 턴이 끊겨 기다림을 거둔 것이면 「못 물어봤다」 가 아니다. 그렇게 적으면 로그를 읽는 사람이 에디터 탓을 한다.
      if (신호?.aborted || err?.거둠) {
        로그(`턴이 끊겨 승인 기다림을 거뒀습니다 (${이름}) — 하지 않습니다.`);
        return false;
      }
      /*
       * 못 물어봤으면 안 한다.
       *
       * 여기서 true 를 돌려주고 싶은 유혹이 있다 — 안 그러면 승인 창을 아직
       * 안 만든 클라이언트에서 아무것도 안 돌아가니까. 그런데 그건 "물어볼 수
       * 없으면 마음대로 한다" 는 뜻이다. 사람이 안 보는 자리에서 되돌릴 수 없는
       * 명령이 도는 것이 이 프로그램이 제일 피하려는 일이다.
       */
      로그(`승인을 못 물어봐서 거부했습니다 (${이름}) — ${err?.message ?? err}`);
      return false;
    }
  }

  // ── 한 턴 ─────────────────────────────────────────────────────────────
  async function 한턴(방, 덩이들) {
    const 글 = 프롬프트글(덩이들);
    if (!글) throw 잘못된인자오류('보낸 말이 비었습니다.');

    // 앞 턴이 아직 돌고 있으면 끊고 시작한다. 규격은 턴을 겹쳐 보내지 말라고
    // 하지만, 안 지키는 클라이언트가 있을 때 두 턴이 같은 세션을 같이 밟으면
    // 오간 말이 뒤엉킨다. 그건 나중에 원인을 찾을 수 없는 종류의 고장이다.
    /*
     * ── 끊기만 하고 안 기다렸다 (사냥5 H5-3) ───────────────────────────────
     *
     * abort() 는 「그만하라」 는 말이지 「그만뒀다」 가 아니다. 앞 턴은 승인 답이나
     * 도구가 끝나기를 기다리는 중일 수 있고, 그 사이에 새 턴을 바로 시작하면 두 턴이
     * 한 대화를 같이 밟았다 — 대화 파일에 새 턴의 말이 두 번 적히고, 앞 턴의 도구
     * 결과가 제 부름에서 떨어진 자리에 적혔다(되살리면 규격 서버가 400 을 준다).
     *
     * 그래서 끊은 뒤 **앞 턴이 적기까지 마치고 물러날 때까지** 기다린다. 앞 턴의
     * 기다림(승인·모델)은 끊기 신호에 묶여 있어 곧 끝난다. 기다리는 사이에 또 새
     * 말이 오면 이 턴도 끊기므로, 끊는 줄(방.턴)은 여기서 바로 넘기고 차례(방.턴끝)는
     * 사슬로 잇는다 — 마지막에 온 말만 돈다.
     */
    const 턴 = new AbortController();
    const 앞턴 = 방.턴;
    방.턴 = 턴;
    if (앞턴 && !앞턴.signal.aborted) 앞턴.abort();
    const 앞끝 = 방.턴끝;
    let 끝알림 = () => {};
    const 이번끝 = new Promise((풀기) => { 끝알림 = 풀기; });
    방.턴끝 = 이번끝;
    try {
      if (앞끝) await 앞끝;
      if (턴.signal.aborted) return { stopReason: 멈춘까닭('aborted') };
      return await 턴돌리기(방, 글, 턴);
    } finally {
      if (방.턴 === 턴) 방.턴 = null;
      if (방.턴끝 === 이번끝) 방.턴끝 = null;
      끝알림();
    }
  }

  /** 한 턴의 몸통. 차례를 받은 뒤에만 부른다 (위 한턴). */
  async function 턴돌리기(방, 글, 턴) {
    // 승인 물음이 이 턴의 끊기 신호를 보게 한다 (승인묻기 머리말, 사냥5 H5-3).
    방.도는신호 = 턴.signal;
    방.ctx.카드다시();

    const 보내기 = (update) => 관.알림('session/update', { sessionId: 방.id, update });
    const 말하기 = (글, 갈래 = 'agent_message_chunk') => 보내기({
      sessionUpdate: 갈래,
      content: { type: 'text', text: 글 },
      messageId: `m${방.메시지번호}`,
    });

    /*
     * 종합 모드면 이 한마디를 보고 알맞은 작업 모드로 옮긴다.
     *
     * ── 옮기고 아무 말도 안 했다 ──────────────────────────────────────
     *
     * 대화 화면과 `deel run` 은 어느 모드로 갔는지, 무슨 말 때문인지 찍는다.
     * 여기만 조용히 옮겼다. 에디터 쪽 사람은 **파일을 못 고치는 모드**로
     * 바뀐 것을 모른 채 「왜 안 고쳐?」 를 본다. 모드는 이 턴에 파일이
     * 바뀌는지를 정하는 값이라, 안 말하면 안 되는 값이다.
     *
     * ── 여기서도 승인받을 자리가 없다 ─────────────────────────────────
     *
     * 겹친 요청을 계획 모드로 보내는 값은 「계획을 보여 주고 승인을 받아
     * 그대로 잇는다」 인데, 이어 가는 길(`이어갈모드`)은 repl.js 에만 있다.
     * 에디터에서 사람이 제일 자연스럽게 쓰는 승인말이 되레 갇힌다 —
     * 「위 계획대로 진행해줘」 에는 '계획' 이 들어 있어서 route 가 또 계획
     * 모드를 고른다. 계획을 두 장 받고 파일은 그대로다.
     *
     * 이을 수 없으면 계획부터 내지 않는다. 그리고 그렇게 한다고 말한다.
     */
    방.session.routed = null;
    if (방.session.work === 'auto') {
      const 골라진 = route(글, { 승인받을수있나: false });
      if (골라진.mode) {
        방.session.routed = 골라진.mode;
        말하기(`◆ ${보일이름(골라진.mode)} — 말 속에 ${골라진.why} 가 있어서\n`);
      } else if (골라진.일부러 && !골라진.겹침) {
        // 겹쳤을 때는 안 찍는다 — 바로 아래가 같은 이야기를 더 온전히 한다.
        말하기(`◇ 종합 그대로 — ${골라진.why}\n`);
      }
      if (골라진.겹침) {
        말하기('◇ 계획과 실행이 같이 있지만 에디터에서는 승인받고 이어 갈 길이 없어'
          + ' 한 번에 끝까지 합니다. 계획을 먼저 보시려면 터미널 대화 화면에서 하세요.\n');
      }
    }

    let 까닭 = 'done';
    let 왜 = '';
    방.메시지번호++;

    /*
     * 어디까지 적었나. 자주 흘려 보낸다.
     *
     * 턴이 다 끝나고 한 번에 적으면, 도구를 열 번 돌린 뒤에 에디터가 닫힌 순간
     * 그 열 번이 통째로 사라진다. 되살릴 때 제일 아쉬운 것이 바로 그 부분이라
     * (무엇을 이미 확인했는지) 걸음마다 적는다.
     */
    let 적은데까지 = 방.session.messages.length;
    const 적기 = () => {
      for (const m of 방.session.messages.slice(적은데까지)) 방.store.append(m);
      적은데까지 = 방.session.messages.length;
      저장샘알리기();
    };
    /*
     * ── 못 적은 것을 아무에게도 안 말했다 (사냥5 H5-6) ───────────────────────
     *
     * 에디터 창 둘이 같은 대화를 되살리면, 뒤에 적는 쪽은 두 대화를 섞지 않으려고
     * **안 적고 센다**(agent/store.js 의 OTHER_WINDOW). 디스크가 차거나 권한이 막혀도
     * 같은 셈에 오른다. 대화 화면은 그 셈을 한 번 말해 주는데(repl.js 의 저장샘) 여기는
     * store.못쓴것 을 한 번도 안 봤다. 둘째 창에서 한 말은 조용히 버려졌고, 사람은
     * 다음에 되살릴 때에야 그 말이 없다는 것을 알았다 — 이미 늦은 자리다.
     * 처음 한 번만 말한다(처음못쓴것). 로그와 에디터 화면 둘 다에.
     */
    const 저장샘알리기 = () => {
      const 샘 = 방.store.처음못쓴것?.();
      if (!샘) return;
      const 알림글 = 옮긴말('store.notSaving', { n: 샘.수, 까닭: 샘.까닭 });
      로그(`${방.id} — ${알림글}`);
      try { 말하기(`\n\n_(${알림글})_\n\n`); } catch { /* 관이 닫혔으면 로그만 남는다 */ }
    };

    try {
      // 이번 걸음에 글이 흘러 나갔나. 거절 자리에서 같은 글을 두 벌 싣지 않으려고 센다.
      let 흘렸나 = false;
      for await (const ev of run(방.session, 방.ctx, 글, { signal: 턴.signal })) {
        switch (ev.type) {
          case 'stage':
            방.메시지번호++;
            흘렸나 = false;
            break;

          case 'thinking':
            if (ev.text) 말하기(ev.text, 'agent_thought_chunk');
            break;

          case 'content':
            if (ev.text) { 말하기(ev.text); 흘렸나 = true; }
            break;

          /*
           * 다시 부르는 자리.
           *
           * 답이 상한에서 잘리면 루프가 상한을 올려 처음부터 다시 부른다.
           * 그러면 방금 흘려보낸 글이 통째로 다시 온다. 아무 말 없이 두 번
           * 보내면 에디터에는 같은 답이 두 벌 붙어 보인다 — 모델이 헛소리를
           * 하는 것처럼 보이지만 사실은 우리가 안 알려 준 탓이다.
           */
          case 'retry':
            방.메시지번호++;
            말하기(`\n\n_(${ev.why} — 다시 답을 받습니다)_\n\n`);
            break;

          // 답이 천장에서 잘렸고 더 못 올린다. 조용히 끝내면 에디터에는 중간에서
          // 끊긴 답만 남아서, 사람은 모델이 대충 답한 줄 안다.
          //
          // 한국어를 박아 두고 있었다 — `/lang en` 으로 켠 사람이 이 자리에서만
          // 한글을 본다. 말 표를 거친다.
          case 'capped':
            말하기(`\n\n_(${옮긴말('ev.capped', { 한계: ev.cap.toLocaleString() })})_\n\n`);
            break;

          /*
           * ── 여기 셋은 에디터에 아무 말도 안 가고 있었다 ──────────────
           *
           * 특히 cutoff 가 나쁘다. 서버가 끝났다는 말도 없이 멈춘 반쪽 답이
           * 에디터에는 **온전한 답**으로 뜬다. 사람은 그걸 읽고 다음 일로
           * 넘어가는데, 정작 답의 뒷부분은 오지도 않았다.
           */
          case 'cutoff':
            말하기(`\n\n_(${ev.멎은초 ? 옮긴말('ev.stalled', { n: ev.멎은초 }) : 옮긴말('ev.cutoff')})_\n\n`);
            break;

          // 훅이 무슨 말을 했다 (safety/hooks.js). 에디터에도 적어 둔다 —
          // 안 적으면 「터미널에서는 뭐라고 하는데 에디터에서는 조용하다」 가 된다.
          case 'hook_note':
            말하기(`\n\n_(${옮긴말('ev.hookNote', { 말: String(ev.말).split('\n')[0] })})_\n\n`);
            break;

          case 'hook_block':
            말하기(`\n\n_(${옮긴말('ev.hookBlock')})_\n\n`);
            break;

          // 완료 검사 (agent/donecheck.js). 에디터에도 무엇을 돌렸고 어떻게 됐는지 적는다.
          case 'check_start':
            말하기(`\n\n_(${옮긴말('check.start', { 판: ev.판, 최대: ev.최대, 명령: ev.명령 })})_\n\n`);
            break;

          case 'check':
            말하기(`\n\n_(${ev.ok === true ? 옮긴말('check.pass', { 명령: ev.명령 })
              : ev.ok === false ? `${옮긴말('check.fail', { 판: ev.판, 최대: ev.최대, 요약: ev.요약 })} — ${ev.판 < ev.최대 ? 옮긴말('check.retry') : 옮긴말('check.gaveUp', { 판: ev.판 })}`
                : 옮긴말('check.skipped', { 까닭: ev.까닭 })})_\n\n`);
            break;

          case 'nudge':
            말하기(`\n\n_(${ev.why === '요청누락'
              ? 옮긴말('ev.nudgeMissed', { n: ev.빠진?.length ?? 0 })
              : 옮긴말('ev.nudgeRead')})_\n\n`);
            break;

          // 모델이 안 하겠다고 했다. 에디터 쪽에도 그렇게 적어 둔다 —
          // 안 적으면 반쪽 답과 구별이 안 되고, 사람은 같은 말을 또 친다.
          case 'refusal':
            /*
             * 흘러 나온 것이 없으면 거절 글을 여기서 싣는다.
             *
             * OpenAI 꼴은 거절 글 조각을 답 자리로 안 흘려보내고 맨 끝에 한
             * 번에 모아 준다(backend/adapter.js 의 흡수). 그래서 이 자리가
             * 없으면 에디터에는
             * 「거절당했습니다」 한 줄만 남고, 무엇을 고쳐 다시 물어야 할지
             * 알 길이 없다. 이미 흘러 나온 창구에서는 두 벌이 되니 안 싣는다.
             */
            if (!흘렸나 && ev.text) 말하기(String(ev.text));
            말하기(`\n\n_(${옮긴말('run.refusal')}${
              ev.왜 && ev.왜 !== 'refusal' ? ` · ${옮긴말('run.refusalWhy', { 왜: ev.왜 })}` : ''})_\n\n`);
            break;

          case 'note':
            말하기(`\n\n_(${ev.text})_\n\n`);
            break;

          case 'learned':
            말하기(`\n\n_(${ev.what === 'ctx'
              ? 옮긴말('ev.learnedCtx', { 한계: ev.limit.toLocaleString() })
              : 옮긴말('ev.learnedOut', { 한계: ev.limit.toLocaleString() })})_\n\n`);
            break;

          // 서버가 잠깐 막아 기다리는 중. 아직 흘러간 글이 없으니 답을 새로 시작하지는 않는다.
          case 'backoff':
            말하기(`\n\n_(${ev.미리
              ? 옮긴말(알림말(ev), { 초: 알림채움(ev).초 })
              : 옮긴말('loop.backoff', 알림채움(ev))})_\n\n`);
            break;

          // 서버가 안 받는 칸이 있어 전선 카드를 고쳤다 (backend/wire.js).
          case 'wire':
            말하기(`\n\n_(${옮긴말('loop.wire', { 무엇: ev.무엇 })})_\n\n`);
            break;

          case 'tool_start':
            보내기(도구시작(도구맡기기(방, ev.name), ev.name, ev.args, { 뿌리: 방.root }));
            break;

          case 'tools_start':
            for (const 이름 of ev.names ?? []) {
              보내기(도구시작(도구맡기기(방, 이름), 이름, null, { 뿌리: 방.root }));
            }
            break;

          case 'tool':
            보내기(도구끝남(도구찾기(방, ev.name), ev, { 뿌리: 방.root }));
            적기();
            break;

          /*
           * 접히면 이력이 통째로 바뀐다.
           *
           * 덧붙이기로는 못 맞춘다 — 앞의 것 여러 개가 요약 하나로 바뀌었으니,
           * 이어 붙이면 파일에는 접히기 전과 접힌 뒤가 겹쳐 남는다. 새로 적는다.
           */
          /*
           * 자리가 다 차서 비웠다. 에디터에는 오류가 아니라 알림으로 간다 —
           * 붉게 보내면 편집기가 턴이 끝난 줄 알고 되물음을 닫아 버린다.
           */
          case 'reset':
            말하기(`\n\n_(${(ev.kept?.할일 ?? 0)
              ? 옮긴말('ev.reset', { 버린수: ev.dropped, 할일: ev.kept.할일 })
              : 옮긴말('ev.resetBare', { 버린수: ev.dropped })})_\n\n`);
            방.store.replace(방.session.messages, `자리부족 — 앞선 대화 ${ev.dropped}개를 비움`);
            적은데까지 = 방.session.messages.length;
            저장샘알리기();
            break;
          case 'compacted':
            방.store.replace(방.session.messages,
              ev.fallback ? `압축 못 함 — 옛 대화 ${ev.folded}개를 잘라 냄` : `압축 — ${ev.folded}개를 요약으로`);
            적은데까지 = 방.session.messages.length;
            저장샘알리기();
            break;

          /*
           * 하위 작업.
           *
           * ACP 에는 '작업 안의 작업' 이 없다. 그래서 도구 호출 하나로 보이게
           * 둔다 — 없는 척하면 하위가 만진 파일 넷이 어디서 나왔는지 화면만
           * 보고는 알 수 없다.
           */
          case 'task_start':
            보내기({
              sessionUpdate: 'tool_call',
              toolCallId: 도구맡기기(방, 'Task'),
              title: `하위 작업: ${ev.목적 ?? ''}`,
              kind: 'think',
              status: 'in_progress',
            });
            break;

          case 'task_done':
            보내기({
              sessionUpdate: 'tool_call_update',
              toolCallId: 도구찾기(방, 'Task'),
              status: ev.끝?.type === 'done' ? 'completed' : 'failed',
              content: [{
                type: 'content',
                content: {
                  type: 'text',
                  text: ev.끝?.type === 'done'
                    ? `끝냄 · ${ev.끝?.steps ?? 0}걸음`
                    : `다 못 했습니다 (${ev.끝?.type}) · ${ev.끝?.steps ?? 0}걸음`,
                },
              }],
            });
            break;

          case 'limit':
            까닭 = 'limit';
            왜 = `도구 호출 ${ev.steps}회에서 멈췄습니다. 한 번에 하기엔 큰 일입니다 — 나눠서 시키세요.`;
            break;

          case 'stuck':
            까닭 = 'stuck';
            왜 = String(ev.why ?? '같은 자리에서 헛돌고 있어 멈췄습니다.');
            break;

          case 'aborted':
            까닭 = 'aborted';
            break;

          case 'error':
            까닭 = 'error';
            왜 = String(ev.text ?? '알 수 없는 오류');
            break;

          case 'done':
            까닭 = 'done';
            break;

          default:
            break;
        }
      }
    } catch (err) {
      까닭 = 'error';
      왜 = String(err?.message ?? err);
    } finally {
      if (방.턴 === 턴) 방.턴 = null;
      if (방.도는신호 === 턴.signal) 방.도는신호 = null;
      방.돌던도구.clear();
      // 끊겼든 터졌든 여기까지 오간 것은 남긴다. 끊긴 턴이야말로 다음에
      // 되살려서 이어가고 싶은 자리다.
      try { 적기(); } catch { /* 못 적어도 답은 돌려줘야 한다 */ }
    }

    /*
     * 규격에 없는 까닭은 말로 준다.
     *
     * '헛돌아서 멈췄다' 는 stopReason 다섯 낱말 중 어디에도 없다. 억지로
     * refusal 에 밀어 넣으면 에디터가 이 대화를 버려야 하는 것으로 읽는다.
     * 그러니 낱말은 end_turn 으로 두고, 왜 멈췄는지는 사람이 읽게 적어 준다.
     */
    if (왜 && 까닭 !== 'aborted') {
      방.메시지번호++;
      말하기(`\n\n---\n**${까닭 === 'error' ? '오류' : '멈춤'}** — ${왜}\n`);
    }

    return { stopReason: 멈춘까닭(까닭) };
  }

  /*
   * 도구 호출 하나에 번호를 매기고, 끝날 때 그 번호를 도로 찾는다.
   *
   * loop.js 는 시작 이벤트에 번호를 안 붙인다 — 화면에 그릴 때는 필요 없었다.
   * ACP 는 시작과 끝을 같은 번호로 이어야 하나로 그린다. 그래서 이름별로
   * 줄을 세워 두고 먼저 시작한 것부터 짝을 짓는다. 같은 이름을 나란히 여러 개
   * 부르는 경우(도구를 한꺼번에 부를 때)에도 순서가 어긋나지 않는다.
   */
  function 도구맡기기(방, 이름) {
    const 아이디 = `t${++방.도구번호}`;
    const 줄 = 방.돌던도구.get(이름) ?? [];
    줄.push(아이디);
    방.돌던도구.set(이름, 줄);
    return 아이디;
  }

  function 도구찾기(방, 이름) {
    const 줄 = 방.돌던도구.get(이름);
    if (줄?.length) return 줄.shift();
    // 시작을 못 본 도구. 거부당한 호출처럼 시작 이벤트 없이 끝만 오는 자리가
    // 있다. 새 번호를 준다 — 짝이 없다고 버리면 그 호출이 화면에서 사라진다.
    return `t${++방.도구번호}`;
  }

  // ── 방법표 ────────────────────────────────────────────────────────────
  async function 다루기(방법, 인자) {
    switch (방법) {
      case 'initialize': {
        시작했나 = true;
        클라이언트 = 인자?.clientInfo ?? null;
        const 저쪽판 = Number(인자?.protocolVersion);
        로그(`붙었습니다 — ${클라이언트?.name ?? '이름 없는 클라이언트'} (규격 ${Number.isFinite(저쪽판) ? 저쪽판 : '?'}판)`);
        return {
          // 저쪽이 우리보다 새 판을 말하면 우리 판을 답한다. 규격이 그렇게 정했다.
          protocolVersion: Number.isFinite(저쪽판) && 저쪽판 < 규격판 ? 저쪽판 : 규격판,
          agentCapabilities: {
            // 지난 대화를 되살릴 수 있다. 이 값이 false 면 에디터는 아예 안
            // 물어보고 빈 대화를 연다 — 붙여 놓고 안 켜면 없는 것과 같다.
            loadSession: true,
            promptCapabilities: { image: false, audio: false, embeddedContext: true },
            mcpCapabilities: { http: false, sse: false },
          },
          agentInfo: { name: 'deel', title: 'deel (로컬 모델 코딩 에이전트)', version: 판번호() },
          authMethods: 인증방법들,
        };
      }

      /*
       * 에디터가 「인증」 을 눌렀다.
       *
       * 우리 인증은 터미널에서 도는 것이라(위 인증방법들 머리말), 여기서
       * 우리가 할 일은 없다 — 에디터가 우리를 `deel setup` 으로 다시 띄우고,
       * 사람이 거기서 마치고, 그 다음에 이 프로세스가 다시 연결된다.
       *
       * 그래도 **끝났는지는 확인해 준다.** 사람이 설정을 안 마치고 창을
       * 닫았는데 여기서 성공이라고 답하면, 에디터는 인증이 끝난 줄 알고 대화를
       * 열고, 그 다음 한마디에서야 같은 오류가 난다. 한 번 더 돌아가는 셈이다.
       */
      case 'authenticate': {
        /*
         * 빈 methodId 도 **모르는 방법**이다 (8회차 ACP-5).
         *
         * `골라온것 &&` 로 시작하던 때는 빈 글이 검사 자체를 건너뛰어 그냥 성공으로
         * 돌아갔다 — jsonrpc.js 의 빈 method 와 같은 꼴이다. methodId 는 규격이 반드시
         * 주라고 한 칸이고, 빈 글은 위 인증방법들 중 어느 것도 아니다. 성공이라 답하면
         * 에디터는 있지도 않은 방법으로 인증이 끝난 줄 알고 그 뒤를 잇는다.
         */
        const 골라온것 = String(인자?.methodId ?? '');
        if (!인증방법들.some((m) => m.id === 골라온것)) {
          throw 잘못된인자오류(`모르는 인증 방법입니다: ${골라온것 || '(빈 칸)'} (쓸 수 있는 것: ${인증방법들.map((m) => m.id).join(', ')})`);
        }
        if (!activeProfile(load())) {
          throw 인증필요오류('아직 설정이 안 끝났습니다. 터미널에서 `deel setup` 을 마치고 다시 시도하세요.');
        }
        로그('설정이 확인됐습니다.');
        return {};
      }

      case 'session/new': {
        const 방 = await 방만들기(인자);
        return {
          sessionId: 방.id,
          modes: 모드상태(방),
        };
      }

      /*
       * 지난 대화 되살리기.
       *
       * ── 답에 대화를 실어 주는 자리가 없다 ────────────────────────────
       *
       * 규격은 오간 말을 **session/update 로 전부 다시 흘리라**고 한다. 답으로
       * 한 번에 주는 자리가 아예 없다. 그래서 여기서 흘린 것이 에디터에 그려지는
       * 지난 대화의 전부다.
       *
       * 흘리기 전에 방을 다 만들어야 한다. 반쯤 만들어 두고 흘리다가 설정이
       * 없어서 터지면, 에디터에는 지난 대화가 절반만 그려진 채로 남는다.
       */
      case 'session/load': {
        const 아이디 = String(인자?.sessionId ?? '').trim();
        if (!아이디) throw 잘못된인자오류('sessionId 가 없습니다.');
        /*
         * 이름이 곧 파일 경로의 한 조각이다. `../../evil/x` 를 그대로 받으면 대화 폴더
         * 밖의 파일을 대화로 읽고, 한 턴이 돌면 거기에 대화를 적었다. Store 도 막지만
         * 그건 조용히 빈 대화로 여는 것이라, 에디터에는 **잘못된 인자**로 또렷하게 답한다.
         */
        if (!대화이름인가(아이디)) throw 잘못된인자오류(`대화 이름이 아닙니다: ${아이디}`);

        // 이 프로세스가 이미 열어 둔 방이면 그대로 쓴다. 다시 만들면 같은
        // 대화를 두 곳에서 밟게 되고, 그때부터 어느 쪽이 참인지 알 수 없다.
        //
        // 단 **같은 폴더**일 때만이다 (사냥5 H5-1). 이름만 보고 돌려주면 B 폴더의 그
        // 이름 대화를 되살리라는데 A 폴더 방이 나가서, 그 뒤 한 말이 A 에 적히고 A 를
        // 고친다. 폴더가 다르면 방만들기 로 보내고, 거기서 또렷하게 거절한다.
        const 있던방 = 방들.get(아이디);
        // 빈 cwd 는 방만들기 가 거절한다 — 여기서 --root 로 바꿔 있던 방을 내주지 않는다 (2.0.2 · 508).
        const 바란자리 = typeof 인자?.cwd === 'string' ? 인자.cwd : (opts.root ?? process.cwd());
        const 방 = 있던방 && 바란자리 && 같은자리(있던방.root, 바란자리) ? 있던방 : await 방만들기(인자, { 아이디 });

        /*
         * 화면에 그릴 것과 모델에게 줄 것이 다르다.
         *
         * 모델에게는 손질한 것이 간다 — 답 없는 도구 부름이 섞이면 규격 서버가
         * 400 을 준다. 그런데 **사람에게는 그 자리를 보여 줘야 한다.** 어제
         * 무엇을 하다 끊겼는지가 오늘 무엇을 시킬지를 정하기 때문이다. 그래서
         * 그리는 것은 적힌 그대로(손질 전)를 쓴다.
         *
         * 파일을 다시 읽는 까닭도 같다. 걸음마다 적어 두므로 파일이 늘 최신이고,
         * 손질로 걷어낸 것까지 그대로 남아 있는 유일한 자리다.
         */
        let 그릴것 = 방.session.messages;
        try {
          const 적힌것 = 방.store.load().messages;
          if (적힌것.length) 그릴것 = 적힌것;
        } catch { /* 못 읽으면 기억하고 있는 것으로 그린다 */ }

        let 흘린것 = 0;
        for (const update of 되살린것(그릴것, { 뿌리: 방.root })) {
          관.알림('session/update', { sessionId: 방.id, update });
          흘린것++;
        }
        로그(`${방.id} — 지난 대화 ${흘린것}덩이를 되살렸습니다.`);
        return { modes: 모드상태(방) };
      }

      case 'session/prompt': {
        const 방 = 방찾기(인자?.sessionId);
        return await 한턴(방, 인자?.prompt);
      }

      case 'session/cancel': {
        // 알림이다. 답하지 않는다 — 답하면 저쪽이 짝 없는 답을 받는다.
        const 방 = 방들.get(String(인자?.sessionId ?? ''));
        if (방?.턴 && !방.턴.signal.aborted) 방.턴.abort();
        return undefined;
      }

      case 'session/set_mode': {
        const 방 = 방찾기(인자?.sessionId);
        const 준것 = String(인자?.modeId ?? '');
        const 고른것 = 모드정리(준것);
        /*
         * 모르는 이름은 **잘못된 인자**다.
         *
         * 정리하면 null 이 나오는 이름을 그대로 넣었다. 답은 `{}` (성공), 모드는
         * null(종합으로 떨어짐), 로그는 「작업 모드를 null 로 바꿨습니다」. 에디터는
         * 누른 단추가 먹힌 줄 알고 그 모드로 칠해 둔다 — 화면과 실제가 어긋난다.
         */
        if (!고른것) throw 잘못된인자오류(`그런 작업 모드가 없습니다: ${준것} (쓸 수 있는 것: ${모드순서.join(', ')})`);
        방.session.work = 고른것;
        방.session.routed = null;
        로그(`작업 모드를 ${고른것} 로 바꿨습니다.`);
        return {};
      }

      default:
        throw 모르는방법오류(방법);
    }
  }

  /*
   * deel 의 작업 모드를 에디터의 모드 고르개로 내보낸다.
   *
   * 이게 붙으면 Zed 의 모드 단추가 deel 의 '계획 / 코드 / 설계' 를 그대로
   * 고르게 된다. 프로토콜에 이미 있는 자리에 우리 것을 얹는 것이라 저쪽은
   * 한 줄도 안 고쳐도 된다.
   */
  function 모드상태(방) {
    return {
      currentModeId: 방.session.work ?? 'auto',
      availableModes: 모드순서.map((id) => {
        const w = getWork(id);
        return { id, name: `${w.glyph} ${w.name} (${w.en})`, description: w.hint ?? null };
      }),
    };
  }

  // ── 관 열기 ───────────────────────────────────────────────────────────
  const 먹이기 = 줄나누기((줄) => 관.받았다(줄));
  process.stdin.on('data', 먹이기);
  process.stdin.resume();

  await new Promise((끝) => {
    const 마무리 = () => {
      /*
       * ── 돌던 턴부터 끊는다 (사냥5 H5-8) ─────────────────────────────────
       *
       * 여기는 관만 닫았다. 느린 모델을 기다리던 턴은 끊는 줄을 못 받아 **답이 올
       * 때까지** 살아 있었고, 프로세스도 그만큼 안 끝났다(재 보니 모델이 15초
       * 걸리면 13초 넘게). 에디터는 이미 닫혔는데 그 뒤에 온 답이 대화 파일에
       * 적혔다 — 아무도 못 본 답이다. 관을 닫기 전에 끊어야 기다리던 승인 물음도
       * 「끊겨서 거뒀다」 로 정리된다.
       */
      for (const 방 of 방들.values()) {
        if (방.턴 && !방.턴.signal.aborted) 방.턴.abort();
      }
      관.닫기('에디터와의 관이 닫혔습니다');
      끝();
    };
    process.stdin.on('end', 마무리);
    process.stdin.on('close', 마무리);
    process.stdin.on('error', 마무리);
  });

  /*
   * 끊은 턴이 여기까지 오간 것을 적고 물러날 때까지 **잠깐만** 기다린다. 끊긴 턴이야말로
   * 다음에 되살려 잇고 싶은 자리라(한턴 의 적기) 안 기다리고 나가면 그게 빠진다.
   * 끊기 신호를 안 듣는 도구가 붙들고 있으면 3초에서 그만둔다 — 닫힌 에디터 앞에서
   * 서 있는 것이 고치려던 고장이다.
   */
  const 끝날턴들 = [...방들.values()].map((방) => 방.턴끝).filter(Boolean);
  if (끝날턴들.length) {
    await Promise.race([
      Promise.allSettled(끝날턴들),
      new Promise((풀기) => { setTimeout(풀기, 3000).unref?.(); }),
    ]);
  }

  /*
   * 뒤에서 돌던 명령을 반드시 거둔다.
   *
   * 에디터를 닫으면 우리 프로세스는 죽는데, 우리가 띄운 dev 서버는 안 죽는다.
   * 다음에 열었을 때 포트가 잡혀 있고, 그 원인은 어디에도 안 남는다.
   */
  const 껐다 = 일감모두끝내기();
  if (껐다) 로그(`뒤에서 돌던 명령 ${껐다}개를 껐습니다.`);
  // 방이 아니라 **캐시**를 돈다. 방 여럿이 한 벌을 나눠 쓰므로 방을 돌면
  // 같은 서버에 닫기() 를 여러 번 부르게 된다.
  for (const 약속 of mcp캐시.values()) {
    let 붙임 = null;
    try { 붙임 = await 약속; } catch { /* 붙다 만 것은 닫을 것도 없다 */ }
    for (const s of 붙임?.서버들 ?? []) { try { s.닫기(); } catch { /* 이미 죽은 것 */ } }
  }
  if (!시작했나) 로그('initialize 를 못 받고 끝났습니다 — 이 명령은 에디터가 자식 프로세스로 띄우는 자리입니다.');
  return 0;
}

// 판 번호는 version.js 한 곳에서만 읽는다. 여기서 또 읽으면 두 벌이 되고,
// 두 벌이 되면 언젠가 한쪽만 고쳐진다 — 그 파일이 존재하는 이유가 그것이다.
const 판번호 = () => VERSION;
