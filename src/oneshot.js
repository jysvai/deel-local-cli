// 한 번만 돌고 끝내는 비대화 모드.  deel run "..."  ·  echo "..." | deel run
//
// 왜 따로 냈는가:
//   사내에 넣고 나면 곧바로 "배치에서 부르고 싶다" 는 말이 나온다. 야간 작업에
//   끼워 검사를 돌리거나, 파일 목록을 훑어 한 건씩 시키는 식이다.
//   그런데 대화 화면(repl.js)은 사람이 앞에 앉아 있다는 것을 전제로 만들었다 —
//   줄을 기다리고, 승인을 물어보고, 엑셀 암호를 물어본다. 그 자리에 사람이
//   없으면 프로그램은 터지지도 않고 그냥 서 있는다. 배치 잡의 시간 제한까지
//   서 있다가 죽고, 로그에는 아무 단서도 안 남는다.
//
//   그래서 '묻는 자리' 를 전부 없앤 길을 따로 낸다. 에이전트 루프는 그대로 쓴다 —
//   여기서 루프를 다시 짜면 두 벌이 되고, 언젠가 한쪽만 고쳐진다.
import { c, mark, clip } from './ui/ansi.js';
import { run } from './agent/loop.js';
import { Session } from './agent/session.js';
import { makeScope } from './safety/guard.js';
import { History } from './safety/undo.js';
import { Audit } from './safety/audit.js';
import { activeProfile, load, resolveKey } from './config.js';
import { discover } from './skills/discover.js';
import { allowEndpoint, setOffline } from './safety/network.js';
import { probeCtx, 기본값 as CTX_DEFAULT } from './backend/ctxsize.js';
import { route } from './agent/route.js';
import { get as getWork } from './agent/modes.js';
import { 모두끝내기 as 일감모두끝내기, 일감인자 } from './tools/jobs.js';

/**
 * 종료코드.
 *
 * 스크립트는 화면 글이 아니라 이 숫자만 본다. 그래서 '끝났다' 와 '끝난 척했다'
 * 를 반드시 갈라 놔야 한다 — 걸음 수 상한에 걸려 멈춘 것을 0 으로 돌려주면
 * 야간 배치가 아무 일도 안 하고 초록불을 켠다. 그게 제일 나쁜 결말이다.
 */
export const EXIT = {
  done: 0,      // 끝까지 답했다
  error: 1,     // 오류로 끝났다 (연결 없음 · 시킬 말 없음 · 모델 오류)
  limit: 2,     // 도구 호출 걸음 수 상한에 닿았다
  stuck: 3,     // 같은 자리에서 헛돌아 스스로 멈췄다
  aborted: 4,   // 도중에 끊겼다 (Ctrl+C)
};

/**
 * 표준입력에 실려 온 말을 통째로 읽는다.
 *
 * 터미널이면 안 읽는다. 사람이 앉아 있는 자리에서 읽으려 들면 아무도 안 치는
 * 입력을 영영 기다린다 — 그게 바로 이 모드가 없애려는 상황이다.
 */
async function 표준입력읽기() {
  if (process.stdin.isTTY) return '';
  const 조각 = [];
  try {
    for await (const b of process.stdin) 조각.push(b);
  } catch { /* 파이프가 먼저 닫히면 읽은 데까지만 쓴다 */ }
  return Buffer.concat(조각).toString('utf8');
}

// 도구 한 줄 요약. 화면 그림이 아니라 로그에 남을 글이라 색을 아낀다.
function 도구줄(name, args) {
  const a = args ?? {};
  const 첫 = a.file_path ?? a.pattern ?? a.path ?? a.url ?? a.name ?? a.목적 ??
    (a.command ? String(a.command).replace(/\s+/g, ' ') : null) ??
    // 뒤에서 도는 명령. 번호가 곧 그 일감의 이름이라, 이게 없으면 기록에
    // `Jobs()` 만 여러 줄 남아 나중에 무엇을 본 것인지 알 수 없다.
    // 이름 고르기는 jobs.js 한 군데에만 둔다 (영문 이름도 받는다).
    (() => { const g = 일감인자(a); return g.번호 != null ? `${g.번호}번${g.끝내기 ? ' · 끝내기' : ''}` : null; })() ??
    // 한 번에 여러 파일을 쓴 경우. 기록에 빈 괄호만 남으면 나중에 이 줄로는
    // 무엇을 만들었는지 알 수 없다 — `deel run` 의 출력은 곧 근거로 쓰인다.
    (Array.isArray(a.files) && a.files.length
      ? `${a.files[0]?.file_path ?? '?'}${a.files.length > 1 ? ` 외 ${a.files.length - 1}개` : ''}`
      : null) ??
    (Array.isArray(a.edits) && a.edits.length
      ? `${a.edits[0]?.file_path ?? '?'}${a.edits.length > 1 ? ` 외 ${a.edits.length - 1}군데` : ''}`
      : null) ??
    (Array.isArray(a.paths) && a.paths.length ? `${a.paths.length}개` : null) ??
    (Array.isArray(a.todos) ? `${a.todos.length}건` : '');
  const 안 = clip(String(첫 ?? ''), 48);
  return `${name}${안 ? `(${안})` : ''}`;
}

/**
 * 한 턴만 돌린다.
 *
 * @param {object} opts
 *   prompt   시킬 말. 없으면 표준입력에서 읽는다
 *   root/mode/work/think/effort/ctx/offline  대화 시작 옵션과 같은 뜻
 *   yes      승인이 필요한 것도 그냥 실행 (기본은 거부)
 *   json     결과를 JSON 한 덩이로
 *   quiet    도구가 무엇을 했는지를 안 적는다 (오류는 그래도 적는다)
 * @returns {Promise<number>} 종료코드
 */
export async function runOnce(opts = {}) {
  const json = opts.json === true;
  const quiet = opts.quiet === true;

  // 두 갈래로 나눠 쓴다.
  //   표준출력 — 모델의 마지막 답만. 그래야 > 파일 이나 | grep 이 그대로 먹는다.
  //   표준오류 — 도구가 무엇을 했는지. 사람이 볼 것이지 넘겨줄 것이 아니다.
  // 이걸 섞으면 파이프 뒤에 붙은 명령이 도구 기록까지 받아 먹는다.
  const 삐끗 = (s = '') => process.stderr.write(s + '\n');
  const 곁 = (s = '') => { if (!quiet) 삐끗(s); };

  const 내놓기 = (r) => {
    /*
     * 뒤에서 돌던 명령을 반드시 거둔다.
     *
     * 여기가 이 모드의 모든 끝맺음이 지나는 자리다. 배치는 이걸 빠뜨리면
     * 제일 크게 다친다 — 잡이 끝났다고 표시된 뒤에도 dev 서버가 계속 돌고,
     * 다음 잡이 같은 포트를 잡으려다 실패한다. 그 원인은 로그 어디에도 없다.
     */
    const 껐다 = 일감모두끝내기();
    if (껐다) 곁(`  ${mark.ok} ${c.gray(`뒤에서 돌던 명령 ${껐다}개를 껐습니다.`)}`);
    if (json) process.stdout.write(JSON.stringify(r) + '\n');
    else if (r.text) process.stdout.write(r.text.endsWith('\n') ? r.text : r.text + '\n');
    return r.code;
  };
  // 시작도 못 한 실패. --quiet 여도 이유는 반드시 적는다 — 스크립트를 고칠 사람이 볼 유일한 글이다.
  const 못함 = (reason, message) => {
    삐끗(`  ${c.red('✗')} ${message}`);
    return 내놓기({
      ok: false, reason, code: EXIT.error, text: '', why: message,
      tools: 0, steps: 0, usage: { in: 0, out: 0, calls: 0, ms: 0 }, ms: 0,
    });
  };

  // ── 시킬 말 ───────────────────────────────────────────────────────────
  // 인자로 준 것이 먼저다. 없을 때만 표준입력을 읽는다 —
  // 둘 다 있을 때 무엇이 이기는지가 헷갈리면 스크립트가 조용히 엉뚱한 일을 한다.
  let 시킬말 = String(opts.prompt ?? '').trim();
  if (!시킬말) 시킬말 = (await 표준입력읽기()).trim();
  if (!시킬말) {
    return 못함('no-prompt', '무엇을 시킬지 적어 주세요 — deel run "..." 또는 echo "..." | deel run');
  }

  const cfg = load();
  const prof = activeProfile(cfg);
  if (!prof) return 못함('no-config', '저장된 연결이 없습니다. deel setup 을 먼저 실행하세요.');

  const root = opts.root ? String(opts.root) : process.cwd();
  const conn = {
    kind: prof.kind, base: prof.baseUrl, auth: prof.auth,
    key: resolveKey(prof), model: prof.model,
    ctx: opts.ctx ?? prof.ctx ?? CTX_DEFAULT,
    // 답 길이 상한 — deel --max-tokens 32k 로 높일 수 있다(대화 화면의 /out 과 같은 값).
    maxTokens: opts.maxTokens ?? prof.maxTokens ?? null,
    streaming: prof.streaming ?? false,
    tools: prof.tools ?? false, json: prof.json ?? false, think: prof.think ?? false,
  };

  // 자물쇠는 대화 화면과 똑같이 건다. 비대화라고 느슨해질 이유가 없다 —
  // 오히려 배치는 아무도 안 보는 자리라 더 단단해야 한다.
  allowEndpoint(conn.base);
  if (opts.offline ?? prof.offline) setOffline(true);

  const session = new Session(conn, {
    root,
    mode: opts.mode ?? 'auto',
    work: opts.work ?? null,
    think: opts.think ?? 'medium',
    effort: opts.effort ?? 'save',
    maxSteps: opts.maxSteps ?? null,   // null 이면 작업 모드가 정한다
  });

  const found = discover(root);
  session.skills = found.skills;
  session.commands = found.commands;
  session.plugins = found.plugins;

  // ── 물어보는 자리를 전부 막는다 ────────────────────────────────────────
  //
  // 여기가 이 파일의 핵심이다. 물어보는 함수 하나라도 기다리게 두면 그것 하나로
  // 배치가 선다. 그래서 세 자리 모두 '기다리지 않고 바로 답을 내는' 함수로 채운다.
  //
  // 승인은 기본이 거부다. 반대로 하면 안 된다 — 아무도 안 보는 자리에서
  // 되돌릴 수 없는 명령이 조용히 돌아가는 것이 이 프로그램이 제일 피하려는 일이다.
  // 정말 맡기고 싶은 사람은 --yes 로 그 뜻을 명시한다.
  const 승인필요 = session.mode !== 'auto';
  const 자동승인 = opts.yes === true;
  const ctx = {
    scope: makeScope(root),
    // 도구가 한 번에 돌려줄 양을 이 값에서 뽑는다 (agent/budget.js).
    // /model 로 갈아타면 conn 이 통째로 바뀌므로 그때마다 다시 읽는다.
    get 모델컨텍스트() { return conn.ctx ?? null; },
    history: new History(root),
    audit: new Audit(root),
    seen: new Set(),
    skills: found.skills,
    loadedSkills: new Set(),
    // 되물을 사람이 없으니 기본값을 그대로 돌려준다.
    ask: async (_label, o = {}) => o?.def ?? '',
    // 엑셀 암호를 여기서 기다리면 그대로 선다. 없다고 바로 답한다 —
    // 도구는 null 을 받으면 '암호가 걸려 못 읽었다' 고 정확히 말한다.
    askPassword: async () => null,
    confirm: async (name, args) => {
      const 무엇 = 도구줄(name, args);
      if (자동승인) {
        곁(`  ${c.yellow('!')} ${c.gray(`--yes 라서 묻지 않고 실행합니다 — ${무엇}`)}`);
        return true;
      }
      곁(`  ${c.yellow('⊘')} ${c.gray(`승인이 필요해 거부했습니다 (물어볼 사람이 없습니다) — ${무엇}`)}`);
      return false;
    },
  };

  // 거부당할 것을 모델에게 미리 알려 준다.
  //
  // 거부만 하고 이유를 안 알리면 모델은 같은 호출을 몇 번이고 다시 한다.
  // 사람이 '안 돼요' 라고 한 줄 알고, 다시 물어보면 이번엔 된다고 믿는다.
  // 그러면 걸음 수만 다 쓰고 아무것도 못 한 채 끝난다.
  const 보낼글 = (승인필요 && !자동승인)
    ? `${시킬말}\n\n(비대화 모드다. 사람이 없어 승인을 물어볼 수 없고, 승인이 필요한 도구 호출은 자동으로 거부된다.`
      + ' 승인 없이 되는 방법을 골라라. 그래도 안 되면 무엇이 막혔는지 말로 알려라.)'
    : 시킬말;

  // ── 컨텍스트 길이 ─────────────────────────────────────────────────────
  //
  // 대화 화면과 같은 이유로 서버에 물어본다. 저장된 값을 믿으면 조용히 작아진다.
  // 다만 알아낸 값을 설정 파일에 도로 적지는 않는다 — 배치는 같은 명령을 여러 개
  // 동시에 띄우는 자리라, 그때마다 config.json 을 덮어쓰면 서로 밟는다.
  // 이번 한 번만 쓰고 버린다.
  if (opts.ctx == null) {
    try {
      const r = await probeCtx(conn, { timeout: 6000 });
      if (r?.value) {
        const 전 = conn.ctx;
        conn.ctx = r.value;
        if (전 !== r.value) {
          곁(`  ${mark.ok} ${c.gray(`컨텍스트를 ${전.toLocaleString()} → ${r.value.toLocaleString()} 로 맞췄습니다 (${r.source ?? '서버'}에서 읽음)`)}`);
        }
      }
    } catch { /* 못 물어보면 설정값 그대로 간다. 여기서 멈출 일은 아니다 */ }
  }

  // 종합 모드면 이 한마디를 보고 알맞은 작업 모드로 옮긴다. 대화 화면과 같다.
  session.routed = null;
  if (session.work === 'auto') {
    const 골라진 = route(시킬말);
    if (골라진.mode) {
      session.routed = 골라진.mode;
      const w = getWork(골라진.mode);
      곁(`  ${c.hcyan(w.glyph)} ${c.gray(`${w.name} (${w.en}) — 말 속에 ${골라진.why} 가 있어서`)}`);
    }
  }

  // ── 한 턴 ─────────────────────────────────────────────────────────────
  const turn = new AbortController();
  const 끊김 = () => { if (!turn.signal.aborted) turn.abort(); };
  process.on('SIGINT', 끊김);

  const t0 = Date.now();
  let reason = 'done';
  let why = '';
  let tools = 0;
  let steps = 0;
  let 이번단계글 = '';   // 지금 단계에서 모델이 흘린 글. 단계가 바뀌면 비운다
  let 답 = null;

  try {
    // 하위 작업 안쪽에서 온 이벤트는 그 겹만큼 들여 쓴다.
    const 안쪽 = (ev) => (ev.depth ? '  '.repeat(ev.depth) : '');

    for await (const ev of run(session, ctx, 보낼글, { signal: turn.signal })) {
      switch (ev.type) {
        case 'stage':
          steps = ev.step;
          이번단계글 = '';
          break;

        // 중간 단계의 말은 표준출력에 안 싣는다. "이제 파일을 읽어보겠습니다" 까지
        // 딸려 나가면 파이프 뒤에서 답만 골라 쓸 수가 없다.
        case 'content':
          이번단계글 += ev.text;
          break;

        case 'tool': {
          tools++;
          /*
           * 실패는 실패로 보여야 한다.
           *
           * 전에는 `error` 만 빨갛게 칠했다. 그런데 탈이 났는데 error 는 없는
           * 도구가 있다 — Bash 는 종료코드 3 을, Verify 는 `탈 2개` 를 요약에
           * 담아 돌려준다. 그것들이 회색으로 찍히면, 나중에 이 기록을 읽는
           * 사람 눈에는 성공과 구별되지 않는다. `deel run` 의 출력은 곧
           * 근거로 쓰이는 물건이라 그 구별이 사라지면 안 된다.
           */
          const 결과 = ev.result?.error
            ? c.red(clip(String(ev.result.error).split('\n')[0], 70))
            : ev.result?.failed
              ? c.yellow(clip(ev.result?.summary ?? '실패', 70))
              : c.gray(clip(ev.result?.summary ?? '완료', 70));
          // 하위 작업 안쪽이면 한 단 들여 그린다. 안 그러면 하위가 만진 파일이
          // 부모가 만진 것과 똑같이 찍혀서, 기록으로 읽을 때 구분이 안 된다.
          곁(`${안쪽(ev)}  ${c.cyan('⏺')} ${c.bold(도구줄(ev.name, ev.args))}  ${결과}`);
          break;
        }

        /*
         * 하위 작업의 여닫는 줄.
         *
         * `deel run` 은 잡·CI 에서 돌고 그 기록이 나중에 근거가 된다. 하위가
         * 무엇을 맡았고 끝냈는지 안 남으면, 파일 넷이 어디서 나왔는지를
         * 기록만 보고는 알 수 없다.
         */
        case 'task_start':
          곁(`${안쪽(ev)}  ${c.magenta('⌥')} ${c.bold('하위 작업')} ${clip(ev.목적, 60)}`
            + `  ${c.gray(`따로 떨어진 대화 · 최대 ${ev.steps}걸음`)}`);
          break;

        case 'task_done': {
          const 끝 = ev.끝 ?? {};
          const 잘됨 = 끝.type === 'done';
          const 셈 = (끝.files ?? []).filter((f) => !f.dir && !f.missing).length;
          곁(`${안쪽(ev)}  ${잘됨 ? c.green('✓') : c.yellow('⚠')} ${c.gray('하위 작업')} ${clip(ev.목적, 50)}`
            + `  ${c.gray(잘됨 ? `끝냄 · 파일 ${셈}개 · ${끝.steps ?? 0}걸음` : `다 못 했습니다 (${끝.type}) · ${끝.steps ?? 0}걸음`)}`);
          break;
        }

        case 'retry':
          곁(`  ${c.yellow('↻')} ${c.gray(`${ev.why} — 상한을 ${ev.from} → ${ev.to} 로 올려 다시 부릅니다`)}`);
          break;

        case 'folded':
          곁(`  ${c.cyan('◲')} ${c.gray(`오래된 도구 결과 ${ev.접은것}개를 접었습니다 (${ev.아낀토큰.toLocaleString()} 토큰을 비움)`)}`);
          break;

        case 'compacted':
          곁(`  ${c.cyan('◱')} ${c.gray(`대화 ${ev.folded}개를 요약으로 접었습니다 (${ev.before.toLocaleString()} → ${ev.after.toLocaleString()} 토큰)`)}`);
          break;

        case 'compact_failed':
          곁(`  ${c.gray(`(접지 못했습니다: ${ev.why})`)}`);
          break;

        case 'limit':
          reason = 'limit';
          why = `도구 호출 ${ev.steps}회에서 멈췄습니다. 한 번에 하기엔 큰 일입니다 — 나눠서 시키세요.`;
          break;

        case 'stuck':
          reason = 'stuck';
          why = String(ev.why ?? '같은 자리에서 헛돌고 있어 멈췄습니다');
          break;

        case 'aborted':
          reason = 'aborted';
          why = '중단했습니다';
          break;

        case 'error':
          reason = 'error';
          why = String(ev.text ?? '알 수 없는 오류');
          break;

        case 'done':
          reason = 'done';
          답 = ev.text ?? 이번단계글;
          break;
      }
    }
  } catch (err) {
    reason = 'error';
    why = String(err?.message ?? err);
  } finally {
    process.removeListener('SIGINT', 끊김);
  }

  // 끝까지 못 갔어도 여기까지 나온 말은 내준다. 빈손으로 돌려보내면
  // 왜 안 됐는지 짐작할 거리조차 없다.
  if (답 == null) 답 = 이번단계글;

  const code = EXIT[reason] ?? EXIT.error;
  if (why) 삐끗(`  ${reason === 'done' ? c.gray('·') : c.red('✗')} ${why}`);
  if (!json && !quiet) {
    const 조각 = [`${((Date.now() - t0) / 1000).toFixed(1)}초`];
    if (tools) 조각.push(`도구 ${tools}회`);
    조각.push(`↑${session.usage.in.toLocaleString()} ↓${session.usage.out.toLocaleString()}`);
    곁(`  ${c.gray('── ' + 조각.join(' · '))}`);
  }

  return 내놓기({
    ok: reason === 'done',
    reason,
    code,
    text: String(답 ?? ''),
    tools,
    steps,
    usage: {
      in: session.usage.in, out: session.usage.out,
      calls: session.usage.calls, ms: session.usage.ms,
    },
    model: conn.model,
    ms: Date.now() - t0,
    ...(why ? { why } : {}),
  });
}
