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
import { VERSION } from '../version.js';
import { run } from '../agent/loop.js';
import { Session } from '../agent/session.js';
import { makeScope } from '../safety/guard.js';
import { History } from '../safety/undo.js';
import { Audit } from '../safety/audit.js';
import { activeProfile, load, resolveKey, homeDir } from '../config.js';
import { 말 as 옮긴말 } from '../i18n/index.js';
import { 알림채움 } from '../backend/retry.js';
import { discover } from '../skills/discover.js';
import { allowEndpoint, setOffline } from '../safety/network.js';
import { probeCtx, 기본값 as CTX_DEFAULT } from '../backend/ctxsize.js';
import { 다붙이기 } from '../backend/mcp.js';
import { 배움 } from '../agent/evolve.js';
import { 카드 } from '../agent/card.js';
import { 못박기 } from '../agent/pins.js';
import { route } from '../agent/route.js';
import { ORDER as 모드순서, get as getWork, normalize as 모드정리 } from '../agent/modes.js';
import { 모두끝내기 as 일감모두끝내기 } from '../tools/jobs.js';
import { 연결, 줄나누기, 모르는방법오류, 잘못된인자오류 } from './jsonrpc.js';
import { 도구시작, 도구끝남, 도구이름표, 도구갈래, 도구자리, 멈춘까닭, 프롬프트글 } from './map.js';

/** 우리가 말하는 규격 판. 정수 하나이고, 깨지는 변경에서만 올라간다. */
export const 규격판 = 1;

/**
 * 이 모드에서 표준출력을 잠근다.
 *
 * 잠그고 나면 say() 로 적힌 것은 전부 표준오류로 간다. 규격이 에이전트의
 * 표준오류에는 무엇을 적어도 좋다고 허락하므로, 버리지 않고 그리로 돌린다 —
 * 무언가 잘못됐을 때 그 글이 유일한 단서다.
 *
 * @returns {(줄: string) => void} 진짜 표준출력으로 쓰는 함수. ACP 만 이걸 쓴다
 */
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

  /** 세션 하나. 에디터의 탭 하나에 해당한다. */
  const 방들 = new Map();
  let 다음방번호 = 1;
  let 클라이언트 = null;      // initialize 로 받은 저쪽 소개
  let 시작했나 = false;

  const 관 = new 연결({
    보내기: 내보내기,
    다루기: (방법, 인자) => 다루기(방법, 인자),
  });

  // ── 방 만들기 ─────────────────────────────────────────────────────────
  async function 방만들기(요청) {
    const cfg = load();
    const prof = activeProfile(cfg);
    if (!prof) {
      throw 잘못된인자오류('저장된 연결이 없습니다. 터미널에서 `deel setup` 을 먼저 실행하세요.');
    }

    /*
     * 작업 폴더는 에디터가 정한다.
     *
     * 규격은 cwd 를 절대 경로로 주라고 한다. 그 말을 믿고 그대로 쓴다 —
     * 여기서 process.cwd() 로 대신하면 에디터가 연 프로젝트가 아니라 에디터를
     * 띄운 자리를 기준으로 파일을 찾게 된다. 그러면 도구는 멀쩡히 도는데
     * 엉뚱한 폴더를 고친다. 그게 제일 무서운 종류의 실수다.
     */
    const root = typeof 요청?.cwd === 'string' && 요청.cwd ? 요청.cwd : (opts.root ?? process.cwd());

    const conn = {
      kind: prof.kind, base: prof.baseUrl, auth: prof.auth,
      key: resolveKey(prof), model: prof.model,
      ctx: opts.ctx ?? prof.ctx ?? CTX_DEFAULT,
      maxTokens: opts.maxTokens ?? prof.maxTokens ?? null,
      streaming: prof.streaming ?? false,
      tools: prof.tools ?? false, json: prof.json ?? false, think: prof.think ?? false,
    };
    allowEndpoint(conn.base);
    if (opts.offline ?? prof.offline) setOffline(true);

    const session = new Session(conn, {
      root,
      // 에디터에는 승인 창이 있다. 그러니 대화 화면과 같은 기본값을 쓴다 —
      // 비대화 모드처럼 무조건 거부할 이유가 없다. 물어볼 데가 있기 때문이다.
      mode: opts.mode ?? 'auto',
      work: opts.work ?? null,
      think: opts.think ?? 'medium',
      effort: opts.effort ?? 'save',
    });

    const found = discover(root);
    session.skills = found.skills;
    session.commands = found.commands;
    session.plugins = found.plugins;
    session.못박은것 = new 못박기();

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
    const mcp붙임 = await 다붙이기(root, {
      offline: !!(opts.offline ?? prof.offline),
      audit: null,
    });
    session.mcp = mcp붙임.서버들;
    if (Array.isArray(요청?.mcpServers) && 요청.mcpServers.length) {
      로그(`에디터가 MCP 서버 ${요청.mcpServers.length}대를 넘겼지만 띄우지 않습니다 — deel 은 .deel/mcp.json 에 적힌 것만 띄웁니다.`);
    }

    const 방 = {
      id: `deel-${다음방번호++}`,
      root, conn, session,
      턴: null,
      늘허락: new Set(),        // 이 세션에서 "앞으로 묻지 않기" 를 고른 도구들
      mcp: mcp붙임.서버들,
      도구번호: 0,
      메시지번호: 0,
      돌던도구: new Map(),      // 도구 이름 → 아직 안 끝난 호출 아이디들
    };

    방.ctx = {
      scope: makeScope(root),
      get 모델컨텍스트() { return conn.ctx ?? null; },
      history: new History(root),
      audit: new Audit(root),
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
      confirm: (이름, 인자) => 승인묻기(방, 이름, 인자),
    };

    방.ctx.배움 = new 배움(root, homeDir());
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
  async function 승인묻기(방, 이름, 인자) {
    if (방.늘허락.has(이름)) return true;

    const 아이디 = `t${++방.도구번호}`;
    try {
      const 답 = await 관.요청('session/request_permission', {
        sessionId: 방.id,
        toolCall: {
          toolCallId: 아이디,
          title: 도구이름표(이름, 인자),
          kind: 도구갈래(이름),
          status: 'pending',
          locations: 도구자리(이름, 인자, null),
          rawInput: 인자 ?? {},
        },
        options: [
          { optionId: 'allow_once', name: '이번만 실행', kind: 'allow_once' },
          { optionId: 'allow_always', name: `${이름} 은 앞으로 묻지 않기`, kind: 'allow_always' },
          { optionId: 'reject_once', name: '하지 않기', kind: 'reject_once' },
        ],
      });

      const 결과 = 답?.outcome ?? {};
      if (결과.outcome !== 'selected') return false;   // cancelled 도 여기로 온다
      if (결과.optionId === 'allow_always') { 방.늘허락.add(이름); return true; }
      return 결과.optionId === 'allow_once';
    } catch (err) {
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
    if (방.턴 && !방.턴.signal.aborted) 방.턴.abort();

    const 턴 = new AbortController();
    방.턴 = 턴;
    방.ctx.카드다시();

    const 보내기 = (update) => 관.알림('session/update', { sessionId: 방.id, update });
    const 말하기 = (글, 갈래 = 'agent_message_chunk') => 보내기({
      sessionUpdate: 갈래,
      content: { type: 'text', text: 글 },
      messageId: `m${방.메시지번호}`,
    });

    // 종합 모드면 이 한마디를 보고 알맞은 작업 모드로 옮긴다. 대화 화면과 같다.
    방.session.routed = null;
    if (방.session.work === 'auto') {
      const 골라진 = route(글);
      if (골라진.mode) 방.session.routed = 골라진.mode;
    }

    let 까닭 = 'done';
    let 왜 = '';
    방.메시지번호++;

    try {
      for await (const ev of run(방.session, 방.ctx, 글, { signal: 턴.signal })) {
        switch (ev.type) {
          case 'stage':
            방.메시지번호++;
            break;

          case 'thinking':
            if (ev.text) 말하기(ev.text, 'agent_thought_chunk');
            break;

          case 'content':
            if (ev.text) 말하기(ev.text);
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

          // 서버가 잠깐 막아 기다리는 중. 아직 흘러간 글이 없으니 답을 새로 시작하지는 않는다.
          case 'backoff':
            말하기(`\n\n_(${옮긴말(ev.지남 ? 'loop.backoffDone' : 'loop.backoff', 알림채움(ev))})_\n\n`);
            break;

          case 'tool_start':
            보내기(도구시작(도구맡기기(방, ev.name), ev.name, ev.args));
            break;

          case 'tools_start':
            for (const 이름 of ev.names ?? []) {
              보내기(도구시작(도구맡기기(방, 이름), 이름, null));
            }
            break;

          case 'tool':
            보내기(도구끝남(도구찾기(방, ev.name), ev));
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
      방.돌던도구.clear();
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
            // session/load 는 아직 안 한다. 지난 대화를 되살리려면 오간 말을
            // 전부 session/update 로 다시 흘려야 하는데, 그 자리를 반쯤 만들어
            // 두면 에디터가 빈 대화를 열고 사용자는 기록이 날아간 줄 안다.
            loadSession: false,
            promptCapabilities: { image: false, audio: false, embeddedContext: true },
            mcpCapabilities: { http: false, sse: false },
          },
          agentInfo: { name: 'deel', title: 'deel (로컬 모델 코딩 에이전트)', version: 판번호() },
          authMethods: [],   // 연결 설정은 `deel setup` 이 맡는다
        };
      }

      case 'authenticate':
        // 인증 방법을 하나도 안 걸었으니 여기 올 일이 없다. 와도 조용히 넘긴다.
        return {};

      case 'session/new': {
        const 방 = await 방만들기(인자);
        return {
          sessionId: 방.id,
          modes: 모드상태(방),
        };
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
        const 고른것 = 모드정리(String(인자?.modeId ?? ''));
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
      관.닫기('에디터와의 관이 닫혔습니다');
      끝();
    };
    process.stdin.on('end', 마무리);
    process.stdin.on('close', 마무리);
    process.stdin.on('error', 마무리);
  });

  /*
   * 뒤에서 돌던 명령을 반드시 거둔다.
   *
   * 에디터를 닫으면 우리 프로세스는 죽는데, 우리가 띄운 dev 서버는 안 죽는다.
   * 다음에 열었을 때 포트가 잡혀 있고, 그 원인은 어디에도 안 남는다.
   */
  const 껐다 = 일감모두끝내기();
  if (껐다) 로그(`뒤에서 돌던 명령 ${껐다}개를 껐습니다.`);
  for (const 방 of 방들.values()) {
    for (const s of 방.mcp ?? []) { try { s.닫기(); } catch { /* 이미 죽은 것 */ } }
  }
  if (!시작했나) 로그('initialize 를 못 받고 끝났습니다 — 이 명령은 에디터가 자식 프로세스로 띄우는 자리입니다.');
  return 0;
}

// 판 번호는 version.js 한 곳에서만 읽는다. 여기서 또 읽으면 두 벌이 되고,
// 두 벌이 되면 언젠가 한쪽만 고쳐진다 — 그 파일이 존재하는 이유가 그것이다.
const 판번호 = () => VERSION;
