// 대화 화면. 루프가 보내는 이벤트를 Claude Code 풍으로 그린다.
import { createInterface, emitKeypressEvents } from 'node:readline';
import { c, say, mark, cursor, box, clip, cols } from './ui/ansi.js';
import { statusLine, headerLines, contextWarning } from './ui/status.js';
import { STAGES } from './agent/effort.js';
import { handle } from './commands.js';
import { next as nextWork, get as getWork, canWrite } from './agent/modes.js';
import { run } from './agent/loop.js';
import { Session } from './agent/session.js';
import { makeScope } from './safety/guard.js';
import { History } from './safety/undo.js';
import { Audit } from './safety/audit.js';
import { activeProfile, load, resolveKey } from './config.js';
import { discover } from './skills/discover.js';
import { allowEndpoint, setOffline, isOffline, isLocalHost } from './safety/network.js';
import { Store, latest, prune } from './agent/store.js';
import { askHidden } from './ui/prompt.js';
import { explain } from './ui/level.js';

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
};

// 도구 호출을 한 줄로 요약 — Read(src/a.js) 처럼.
function toolLabel(name, args) {
  const a = args ?? {};
  const first =
    a.file_path ?? a.pattern ?? a.path ?? a.url ?? a.name ??
    (a.command ? String(a.command).replace(/\s+/g, ' ').slice(0, 52) : null) ??
    // 할 일 목록은 보여줄 경로가 없다. 빈 괄호를 띄우느니 개수를 적는다.
    (Array.isArray(a.todos) ? `${a.todos.length}건` : null) ?? '';
  const g = TOOL_GLYPH[name] ?? c.cyan('⏺');
  const 안 = clip(String(first ?? ''), 56);
  return `${g} ${c.bold(name)}${안 ? `${c.gray('(')}${c.gray(안)}${c.gray(')')}` : ''}`;
}

function toolResultLine(result, ms) {
  const t = ms > 700 ? c.gray(`  ${(ms / 1000).toFixed(1)}초`) : '';
  if (result?.error) return `${c.red('└')} ${c.red(clip(String(result.error).split('\n')[0], 80))}${t}`;
  return `${c.gray('└')} ${c.gray(clip(result?.summary ?? '완료', 80))}${t}`;
}

export async function chatLoop(opts = {}) {
  const cfg = load();
  const prof = activeProfile(cfg);
  if (!prof) {
    say('');
    say(`  ${mark.warn} 저장된 연결이 없습니다. ${c.cyan('deel setup')} 을 먼저 실행하세요.`);
    say('');
    return 1;
  }

  const root = opts.root ? opts.root : process.cwd();
  const conn = {
    kind: prof.kind, base: prof.baseUrl, auth: prof.auth,
    key: resolveKey(prof), model: prof.model,
    ctx: prof.ctx ?? 32768, streaming: prof.streaming ?? false,
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
    maxSteps: opts.maxSteps ?? 24,
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

  // 이 PC 에 있는 스킬·명령·플러그인을 찾아 붙인다. 품고 다니지 않는다.
  const found = discover(root);
  session.skills = found.skills;
  session.commands = found.commands;
  session.plugins = found.plugins;

  const rl = createInterface({ input: process.stdin, output: process.stdout, historySize: 200 });

  // 입력을 큐로 받는다. rl.question 을 겹쳐 쓰면 파이프로 넣을 때 닫혀 버린다.
  const queue = [];
  let waiter = null;
  let closed = false;
  const echo = !process.stdin.isTTY;   // 파이프·기록용일 때는 입력을 되비춘다

  rl.on('line', (l) => {
    if (echo) say(c.gray(l));
    if (waiter) { const w = waiter; waiter = null; w(l); }
    else queue.push(l);
  });
  rl.on('close', () => {
    closed = true;
    if (waiter) { const w = waiter; waiter = null; w(null); }
  });

  // Shift+Tab 으로 작업 모드를 차례로 돌린다.
  //
  // 터미널일 때만 한다. 파이프로 넣을 때 키를 가로채면 입력이 깨진다 —
  // 검사와 데모가 그렇게 돌아간다.
  if (process.stdin.isTTY) {
    emitKeypressEvents(process.stdin, rl);
    process.stdin.on('keypress', (_ch, key) => {
      if (!key || key.name !== 'tab' || !key.shift) return;
      session.work = nextWork(session.work);
      const w = getWork(session.work);
      cursor.clearLine();
      say(`  ${c.hcyan(w.glyph)} ${c.bold(w.name)} ${c.gray('(' + w.en + ')')}  ${c.gray(w.hint)}`
        + (canWrite(session.work) ? '' : `  ${c.green('· 파일을 못 바꿉니다')}`));
      prompt();
    });
  }

  const nextLine = () => {
    if (queue.length) return Promise.resolve(queue.shift());
    if (closed) return Promise.resolve(null);
    return new Promise((res) => { waiter = res; });
  };

  const ask = async (label, o = {}) => {
    process.stdout.write(`  ${c.gray('›')} ${label} ${o.def ? c.gray(`[${o.def}] `) : ''}`);
    const a = await nextLine();
    if (a === null) return o.def ?? '';
    return a.trim() || o.def || '';
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

  const ctx = {
    scope: makeScope(root),
    history: new History(root),
    audit: new Audit(root),
    seen: new Set(),
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

  // ── 머리말 ────────────────────────────────────────────────────────────
  say('');
  for (const l of box(headerLines(session, found), { tone: c.gray })) say('  ' + l);
  const warn = [];
  if (!conn.tools) warn.push('도구 호출이 확인되지 않았습니다 — deel diagnose 로 점검하세요');
  if (!conn.streaming) warn.push('스트리밍이 없어 응답이 한 번에 나옵니다');
  for (const w of warn) say(`  ${mark.warn} ${c.gray(w)}`);
  say(`  ${c.gray('/help 명령 목록')}   ${c.gray('/think 추론 강도')}   ${c.gray('Ctrl+C 중단·끝내기')}`);

  // 입력 자리. 위에 상태줄을 한 줄 깔고 그 아래에 커서를 둔다.
  const prompt = () => {
    say('');
    say(statusLine(session));
    const w = contextWarning(session);
    if (w) say(` ${w}`);
    process.stdout.write(` ${c.hcyan('❯')} `);
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
    const line = await nextLine();
    if (line === null) break;          // 입력이 끝났다 (파이프 종료 / Ctrl+D)
    interrupted = false;
    const text = line.trim();
    if (!text) continue;

    const cmd = await handle(text, session, ctx);
    if (cmd.exit) break;
    if (cmd.handled) continue;
    const toSend = cmd.text ?? text;   // 슬래시 명령이면 펼쳐진 내용을 보낸다

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

    const clearThinking = () => { if (thinkingShown) { cursor.clearLine(); thinkingShown = false; } };

    turn = new AbortController();
    try {
      for await (const ev of run(session, ctx, toSend, { signal: turn.signal })) {
        switch (ev.type) {
          // 어느 단계를 어떤 강도로 도는지 — 추론 강도 조절이 실제로 먹는지 눈으로 보인다.
          case 'stage':
            stage = ev;
            thinkChars = 0;
            break;

          case 'retry':
            clearThinking();
            say(`  ${c.yellow('↻')} ${c.gray(`${ev.why} — 상한을 ${ev.from} → ${ev.to} 로 올려 다시 부릅니다`)}`);
            break;

          case 'waiting':
            process.stdout.write(`  ${c.gray(stageTag(stage) + ' 생각 중…')}\r`);
            break;

          case 'thinking':
            thinkChars += ev.text.length;
            if (process.stdout.isTTY) {
              cursor.clearLine();
              process.stdout.write(`  ${mark.think} ${c.gray(stageTag(stage))} ${c.gray(`생각 중… ${thinkChars.toLocaleString()}자`)}`);
              thinkingShown = true;
            }
            break;

          case 'content':
            clearThinking();
            if (!streamed) { streamed = true; process.stdout.write('  '); }
            process.stdout.write(ev.text.replace(/\n/g, '\n  '));
            break;

          case 'tool_start':
            clearThinking();
            if (streamed) { say(''); streamed = false; }
            say('');
            say(`  ${toolLabel(ev.name, ev.args)}`);
            break;

          // 여럿을 같이 돌린다 — 한 줄로 알리고, 이름은 결과와 붙여서 그린다.
          case 'tools_start':
            clearThinking();
            if (streamed) { say(''); streamed = false; }
            say('');
            say(`  ${c.gray(`${ev.count}개를 함께 돌립니다`)} ${c.gray('·')} ${c.gray(ev.names.join(' '))}`);
            break;

          case 'tool':
            tools++;
            // 같이 돈 것은 이름을 다시 적어 준다. 안 그러면 어느 결과인지 모른다.
            if (ev.parallel) say(`  ${toolLabel(ev.name, ev.args)}`);
            if (ev.name === 'TodoWrite' && ev.result?.todos) {
              for (const t of ev.result.todos) {
                const 표 = t.state === 'done' ? c.green('☑') : t.state === 'doing' ? c.hyellow('▶') : c.gray('☐');
                const 글 = t.state === 'done' ? c.gray(t.text) : t.state === 'doing' ? c.white(t.text) : c.gray(t.text);
                say(`    ${표} ${clip(글, 74)}`);
              }
            } else {
              say(`    ${toolResultLine(ev.result, ev.ms ?? 0)}`);
            }
            flush();   // 도구가 하나 끝날 때마다 적어 둔다
            break;

          case 'trimmed':
            say(`  ${c.gray(`(컨텍스트가 차서 오래된 대화 ${ev.dropped}개를 줄였습니다)`)}`);
            break;

          case 'compacting':
            clearThinking();
            process.stdout.write(`  ${c.gray('컨텍스트가 찼습니다 — 앞선 대화를 요약해 접는 중…')}\r`);
            break;

          case 'compacted': {
            if (process.stdout.isTTY) cursor.clearLine();
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

          case 'compact_failed':
            if (process.stdout.isTTY) cursor.clearLine();
            say(`  ${c.gray(`(접지 못했습니다: ${ev.why})`)}`);
            break;

          case 'limit':
            say('');
            say(`  ${mark.warn} 도구 호출 ${ev.steps}회에서 멈췄습니다. ${c.gray('이어서 하려면 다시 말씀하세요.')}`);
            break;

          case 'aborted':
            clearThinking();
            if (streamed) { say(''); streamed = false; }
            say('');
            say(`  ${c.yellow('⊘')} ${c.gray('중단했습니다. 여기까지는 대화에 남아 있으니 이어서 말씀하세요.')}`);
            break;

          case 'error':
            clearThinking();
            say('');
            오류보이기(ev.text);
            break;

          case 'done':
            clearThinking();
            if (streamed) say('');
            break;
        }
      }
    } catch (err) {
      clearThinking();
      say('');
      오류보이기(err.message);
    }
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
  say('');
  say(`  ${c.gray('끝냅니다.')} ${c.gray(`모델 호출 ${session.usage.calls}회 · 도구 시간 ${(session.usage.ms / 1000).toFixed(1)}초 · ↑${session.usage.in.toLocaleString()} ↓${session.usage.out.toLocaleString()}`)}`);
  say('');
  return 0;
}

// "첫 판단·high" 처럼 지금 도는 단계를 짧게.
function stageTag(ev) {
  if (!ev) return '';
  const label = STAGES[ev.stage]?.label ?? ev.stage;
  return `${label}·${ev.level}`;
}
