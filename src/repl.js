// 대화 화면. 루프가 보내는 이벤트를 Claude Code 풍으로 그린다.
import { createInterface } from 'node:readline';
import { c, say, mark, cursor, width } from './ui/ansi.js';
import { handle, COMMANDS } from './commands.js';
import { run } from './agent/loop.js';
import { Session } from './agent/session.js';
import { makeScope } from './safety/guard.js';
import { History } from './safety/undo.js';
import { Audit } from './safety/audit.js';
import { activeProfile, load, resolveKey } from './config.js';
import { discover } from './skills/discover.js';

// 도구 호출을 한 줄로 요약 — Read(src/a.js) 처럼.
function toolLabel(name, args) {
  const a = args ?? {};
  const first =
    a.file_path ?? a.pattern ?? a.path ??
    (a.command ? String(a.command).slice(0, 48) : '') ?? '';
  return `${name}(${c.gray(String(first))})`;
}

function toolResultLine(result, ms) {
  if (result?.error) return `${c.red('└')} ${c.red(String(result.error).split('\n')[0])}`;
  const s = result?.summary ?? '완료';
  const t = ms > 1000 ? c.gray(` ${(ms / 1000).toFixed(1)}초`) : '';
  return `${c.gray('└')} ${c.gray(s)}${t}`;
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

  const session = new Session(conn, {
    root,
    mode: opts.mode ?? 'auto',
    think: opts.think ?? 'medium',
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
    if (echo) say(l);
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

  // 머리말
  say('');
  say(`  ${c.cyan('deel')}  ${c.gray(prof.model)}  ${c.gray('·')}  ${c.gray(ctx.scope.root)}`);
  const warn = [];
  if (!conn.tools) warn.push('도구 호출 미확인');
  if (!conn.streaming) warn.push('스트리밍 없음');
  if (warn.length) say(`  ${c.yellow('⚠')} ${c.gray(warn.join(' · '))}`);
  if (found.skills.length || found.commands.length) {
    say(`  ${c.gray(`스킬 ${found.skills.length}개 · 명령 ${found.commands.length}개 찾음`)}${found.plugins.length ? c.gray(` (플러그인 ${found.plugins.length}개)`) : ''}`);
  }
  say(`  ${c.gray('/help 로 명령 목록.  Ctrl+C 로 끝냅니다.')}`);
  say('');

  let interrupted = false;
  rl.on('SIGINT', () => {
    if (interrupted) { rl.close(); return; }
    interrupted = true;
    say('');
    say(`  ${c.gray('한 번 더 Ctrl+C 를 누르면 끝냅니다.')}`);
    process.stdout.write(`\n${c.cyan('›')} `);
  });

  for (;;) {
    process.stdout.write(`\n${c.cyan('›')} `);
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
    let tools = 0;
    let thinkChars = 0;
    let streamed = false;
    let thinkingShown = false;

    try {
      for await (const ev of run(session, ctx, toSend)) {
        switch (ev.type) {
          case 'waiting':
            process.stdout.write(`  ${c.gray('생각 중…')}\r`);
            break;

          case 'thinking':
            thinkChars += ev.text.length;
            if (process.stdout.isTTY) {
              cursor.clearLine();
              process.stdout.write(`  ${c.magenta('✻')} ${c.gray(`생각 중… ${thinkChars}자`)}`);
              thinkingShown = true;
            }
            break;

          case 'content':
            if (thinkingShown) { cursor.clearLine(); thinkingShown = false; }
            if (!streamed) { streamed = true; process.stdout.write('  '); }
            process.stdout.write(ev.text.replace(/\n/g, '\n  '));
            break;

          case 'tool_start':
            if (thinkingShown) { cursor.clearLine(); thinkingShown = false; }
            if (streamed) { say(''); streamed = false; }
            say('');
            say(`  ${c.cyan('⏺')} ${toolLabel(ev.name, ev.args)}`);
            break;

          case 'tool':
            tools++;
            say(`    ${toolResultLine(ev.result, ev.ms ?? 0)}`);
            break;

          case 'trimmed':
            say(`  ${c.gray(`(컨텍스트가 차서 오래된 대화 ${ev.dropped}개를 줄였습니다)`)}`);
            break;

          case 'limit':
            say('');
            say(`  ${c.yellow('⚠')} 도구 호출 ${ev.steps}회에서 멈췄습니다. ${c.gray('이어서 하려면 다시 말씀하세요.')}`);
            break;

          case 'error':
            if (thinkingShown) cursor.clearLine();
            say('');
            say(`  ${c.red('✗')} ${ev.text}`);
            break;

          case 'done':
            if (streamed) say('');
            break;
        }
      }
    } catch (err) {
      say('');
      say(`  ${c.red('✗')} ${err.message}`);
    }

    // 꼬리말 — 이번 턴 요약
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const bits = [`${secs}초`];
    if (tools) bits.push(`도구 ${tools}회`);
    if (session.usage.out) bits.push(`${session.usage.out.toLocaleString()}토큰`);
    say('');
    say(`  ${c.gray('─ ' + bits.join(' · '))}`);
  }

  rl.close();
  say('');
  say(`  ${c.gray('끝냅니다.')} ${c.gray(`도구 시간 ${(session.usage.ms / 1000).toFixed(1)}초 · 모델 호출 ${session.usage.calls}회`)}`);
  say('');
  return 0;
}
