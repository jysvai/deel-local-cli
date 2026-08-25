// 대화 화면. 루프가 보내는 이벤트를 Claude Code 풍으로 그린다.
import { createInterface, emitKeypressEvents } from 'node:readline';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { c, say, mark, cursor, box, clip, cols } from './ui/ansi.js';
import { statusLine, headerLines, contextWarning } from './ui/status.js';
import { STAGES } from './agent/effort.js';
import { handle } from './commands.js';
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
import { spin } from './ui/spinner.js';
import { explain } from './ui/level.js';
import { probeCtx, 기본값 as CTX_DEFAULT } from './backend/ctxsize.js';
import { renderDiff, shortStat } from './ui/diff.js';
import { expand as expandMentions } from './agent/mention.js';

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
    const s = spin('모델에 걸린 컨텍스트 길이를 확인하는 중…');
    let r = null;
    try { r = await probeCtx(conn, { timeout: 6000 }); } catch { /* 못 물어보면 아래에서 처리 */ }
    s.stop('');
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
    } else if (prof.ctx == null) {
      길이경고.push(`컨텍스트를 서버가 안 알려줍니다 — 우선 ${CTX_DEFAULT.toLocaleString()} 으로 잡았습니다. ${c.cyan('/ctx 655360')} 처럼 직접 지정하세요`);
    }
  }

  // ── 머리말 ────────────────────────────────────────────────────────────
  say('');
  for (const l of box(headerLines(session, found), { tone: c.gray })) say('  ' + l);
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
  if (!conn.tools) warn.push('도구 호출이 확인되지 않았습니다 — deel diagnose 로 점검하세요');
  if (!conn.streaming) warn.push('스트리밍이 없어 응답이 한 번에 나옵니다');
  warn.push(...길이경고);
  // 잘 된 것은 경고 표시를 달지 않는다. ⚠ 가 붙으면 뭘 고쳐야 하나 싶어진다.
  for (const l of 길이알림) say(`  ${mark.ok} ${c.gray(l)}`);
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
    let 접는중 = null;
    const 접기멈춤 = () => { if (접는중) { 접는중.stop(); 접는중 = null; } };

    const clearThinking = () => { if (thinkingShown) { cursor.clearLine(); thinkingShown = false; } };
    // 단계 꼬리표 — 붙을 때만 뒤에 한 칸을 같이 붙인다. 쉬움 수준에서는 빈 글자라
    // '생각 중…' 앞에 빈칸 두 개가 뜨는 일이 없다.
    const 꼬리표 = (ev) => { const t = stageTag(ev, session.level); return t ? t + ' ' : ''; };

    turn = new AbortController();
    try {
      for await (const ev of run(session, ctx, 보낼글, { signal: turn.signal })) {
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
            process.stdout.write(`  ${c.gray(꼬리표(stage) + '생각 중…')}\r`);
            // 지워야 할 줄이 화면에 있다고 표시해 둔다.
            //
            // 전에는 이 표시를 안 세웠다. \r 로 커서만 앞으로 보내 놓고 지우지는
            // 않으니, 다음에 오는 짧은 글이 그 줄 위에 겹쳐 찍혔다 —
            //   "이어가기·low 생각 중…  합계를 sum 으로…" 처럼 앞말이 남았다.
            if (process.stdout.isTTY) thinkingShown = true;
            break;

          case 'thinking':
            thinkChars += ev.text.length;
            if (process.stdout.isTTY) {
              cursor.clearLine();
              process.stdout.write(`  ${mark.think} ${c.gray(꼬리표(stage))}${c.gray(`생각 중… ${thinkChars.toLocaleString()}자`)}`);
              thinkingShown = true;
            }
            break;

          /*
           * 모델이 사람에게 하는 말.
           *
           * 왼쪽에 세로줄을 세워 도구 줄과 가른다. 전에는 들여쓰기도 색도 도구와
           * 같아서, 화면을 훑을 때 '모델이 뭐라고 했는지' 를 눈으로 못 찾았다.
           * 도구 이름·결과·바뀐 자리가 줄줄이 지나간 끝에 답이 섞여 있었다.
           *
           * 세로줄 하나면 된다. 전체화면 UI 로 갈 이유가 없다 —
           * 파이프로 넘기거나 기록으로 남길 때도 그대로 읽힌다.
           */
          case 'content':
            clearThinking();
            if (!streamed) { streamed = true; process.stdout.write(`  ${답표시} `); }
            process.stdout.write(ev.text.replace(/\n/g, `\n  ${답표시} `));
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
              }
            }
            flush();   // 도구가 하나 끝날 때마다 적어 둔다
            break;

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
            clearThinking();
            접는중 = spin('컨텍스트가 찼습니다 — 앞선 대화를 요약해 접는 중…');
            break;

          case 'compacted': {
            접기멈춤();
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

          // 서버가 거절하면서 알려 준 한계를 받아 적었다. 실패로 보이면 안 된다 —
          // 사용자 눈에는 잠깐 멈췄다가 그냥 잘 되는 것으로 보여야 맞다.
          case 'learned':
            if (process.stdout.isTTY) cursor.clearLine();
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
            if (process.stdout.isTTY) cursor.clearLine();
            say(`  ${c.gray(`(접지 못했습니다: ${ev.why})`)}`);
            break;

          case 'limit':
            say('');
            say(`  ${mark.warn} 도구 호출 ${ev.steps}회에서 멈췄습니다. ${c.gray('이어서 하려면 다시 말씀하세요.')}`);
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
