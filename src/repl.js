// 대화 화면. 루프가 보내는 이벤트를 Claude Code 풍으로 그린다.
import { createInterface } from 'node:readline';
import { c, say, mark, cursor, box, clip, cols } from './ui/ansi.js';
import { statusLine, headerLines, contextWarning } from './ui/status.js';
import { STAGES } from './agent/effort.js';
import { handle } from './commands.js';
import { run } from './agent/loop.js';
import { Session } from './agent/session.js';
import { makeScope } from './safety/guard.js';
import { History } from './safety/undo.js';
import { Audit } from './safety/audit.js';
import { activeProfile, load, resolveKey } from './config.js';
import { discover } from './skills/discover.js';
import { allowEndpoint, setOffline, isOffline, isLocalHost } from './safety/network.js';

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
};

// 도구 호출을 한 줄로 요약 — Read(src/a.js) 처럼.
function toolLabel(name, args) {
  const a = args ?? {};
  const first =
    a.file_path ?? a.pattern ?? a.path ?? a.url ?? a.name ??
    (a.command ? String(a.command).replace(/\s+/g, ' ').slice(0, 52) : '') ?? '';
  const g = TOOL_GLYPH[name] ?? c.cyan('⏺');
  return `${g} ${c.bold(name)}${c.gray('(')}${c.gray(clip(String(first), 56))}${c.gray(')')}`;
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
    think: opts.think ?? 'medium',
    effort: opts.effort ?? 'save',
    maxSteps: opts.maxSteps ?? 24,
  });

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

  const ctx = {
    scope: makeScope(root),
    history: new History(root),
    audit: new Audit(root),
    seen: new Set(),
    skills: found.skills,
    loadedSkills: new Set(),
    ask,
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
  say(`  ${c.gray('/help 명령 목록')}   ${c.gray('/think 추론 강도')}   ${c.gray('Ctrl+C 끝내기')}`);

  // 입력 자리. 위에 상태줄을 한 줄 깔고 그 아래에 커서를 둔다.
  const prompt = () => {
    say('');
    say(statusLine(session));
    const w = contextWarning(session);
    if (w) say(` ${w}`);
    process.stdout.write(` ${c.hcyan('❯')} `);
  };

  let interrupted = false;
  rl.on('SIGINT', () => {
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
    let tools = 0;
    let thinkChars = 0;
    let streamed = false;
    let thinkingShown = false;
    let stage = null;

    const clearThinking = () => { if (thinkingShown) { cursor.clearLine(); thinkingShown = false; } };

    try {
      for await (const ev of run(session, ctx, toSend)) {
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

          case 'tool':
            tools++;
            say(`    ${toolResultLine(ev.result, ev.ms ?? 0)}`);
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

          case 'error':
            clearThinking();
            say('');
            say(`  ${c.red('✗')} ${ev.text}`);
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
      say(`  ${c.red('✗')} ${err.message}`);
    }

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
