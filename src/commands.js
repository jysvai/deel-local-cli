// 슬래시 명령. 이름은 Claude Code / Codex 관례에 맞춘다.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { c, say, rule, pad, bar, mark, width } from './ui/ansi.js';
import { pick } from './ui/prompt.js';
import { load, save, resolveKey } from './config.js';
import { TOOLS } from './tools/index.js';
import { loadCommand } from './skills/discover.js';

const THINK_LEVELS = ['off', 'low', 'medium', 'high', 'max'];
const MODES = {
  auto: '자율 — 전부 알아서. 되돌리기가 안전망',
  confirm: '확인 — 되돌릴 수 없는 것만 물어봄',
  strict: '엄격 — 파일 변경·명령 전부 물어봄',
};

export const COMMANDS = {
  help:    { desc: '명령 목록' },
  clear:   { desc: '대화 비우기' },
  context: { desc: '컨텍스트 사용량 보기' },
  compact: { desc: '오래된 대화 줄이기' },
  model:   { desc: '모델·연결 바꾸기' },
  think:   { desc: '추론 강도 (off/low/medium/high/max)', arg: '<수준>' },
  mode:    { desc: '실행 모드 (auto/confirm/strict)', arg: '<모드>' },
  undo:    { desc: '직전 작업 되돌리기', arg: '[턴수]' },
  tools:   { desc: '쓸 수 있는 도구 보기' },
  skills:  { desc: '스킬 보기·검색·골라 올리기', arg: '[검색어|all|off]' },
  cost:    { desc: '이번 세션 사용량' },
  status:  { desc: '연결 상태' },
  init:    { desc: 'DEEL.md 규칙 파일 만들기' },
  exit:    { desc: '끝내기' },
  quit:    { desc: '끝내기' },
};

// 반환: { handled, exit? }  handled=false 면 모델에게 보낸다.
export async function handle(line, session, ctx) {
  if (!line.startsWith('/')) return { handled: false };
  const [raw, ...rest] = line.slice(1).trim().split(/\s+/);
  const name = raw.toLowerCase();
  const arg = rest.join(' ');

  switch (name) {
    case 'help': return help(), { handled: true };
    case 'exit':
    case 'quit': return { handled: true, exit: true };

    case 'clear':
      session.clear();
      say(`  ${mark.ok} 대화를 비웠습니다. 규칙과 연결은 그대로입니다.`);
      say('');
      return { handled: true };

    case 'context': return showContext(session), { handled: true };

    case 'compact': {
      const n = session.trim();
      say(n
        ? `  ${mark.ok} 오래된 대화 ${n}개를 줄였습니다.`
        : `  ${c.gray('줄일 만큼 쌓이지 않았습니다.')}`);
      say('');
      return { handled: true };
    }

    case 'model': return await switchModel(session, ctx), { handled: true };

    case 'think': {
      if (!THINK_LEVELS.includes(arg)) {
        say(`  ${c.gray('지금')} ${c.bold(session.think)}   ${c.gray('고를 수 있는 값:')} ${THINK_LEVELS.join(' · ')}`);
        say(`  ${c.gray('예')} /think high`);
        say('');
        return { handled: true };
      }
      session.think = arg;
      say(`  ${mark.ok} 추론 강도 ${c.bold(arg)}`);
      if (!session.conn.think && arg !== 'off') {
        say(`     ${c.yellow('이 연결은 모델 층 조절이 안 먹습니다.')} ${c.gray('루프 층(도구 호출 상한)으로만 조절됩니다.')}`);
      }
      say('');
      return { handled: true };
    }

    case 'mode': {
      if (!MODES[arg]) {
        say(`  ${c.gray('지금')} ${c.bold(session.mode)}`);
        for (const [k, v] of Object.entries(MODES)) say(`    ${c.cyan(pad(k, 9))} ${c.gray(v)}`);
        say('');
        return { handled: true };
      }
      session.mode = arg;
      say(`  ${mark.ok} 실행 모드 ${c.bold(arg)} ${c.gray('— ' + MODES[arg])}`);
      say('');
      return { handled: true };
    }

    case 'undo': {
      const n = Math.max(1, parseInt(arg, 10) || 1);
      const r = ctx.history.undo(n);
      ctx.audit.undo({ turns: r.turns, files: r.restored.length });
      if (!r.restored.length) {
        say(`  ${c.gray('되돌릴 것이 없습니다.')}`);
      } else {
        say(`  ${mark.ok} ${r.turns}개 턴, 파일 ${r.restored.length}개를 되돌렸습니다.`);
        for (const f of r.restored) say(`    ${c.gray(ctx.scope.show(f.path))}  ${c.gray(f.how)}`);
      }
      say('');
      return { handled: true };
    }

    case 'tools': {
      rule('도구', 70);
      for (const [n, t] of Object.entries(TOOLS)) {
        say(`  ${c.cyan(pad(n, 8))} ${c.gray(t.schema.description)}`);
      }
      say('');
      return { handled: true };
    }

    case 'cost': {
      const mins = ((Date.now() - session.startedAt) / 60000).toFixed(1);
      rule('이번 세션', 70);
      say(`  ${c.gray(pad('모델 호출', 14))} ${session.usage.calls}회`);
      say(`  ${c.gray(pad('입력 토큰', 14))} ${session.usage.in.toLocaleString()}`);
      say(`  ${c.gray(pad('출력 토큰', 14))} ${session.usage.out.toLocaleString()}`);
      say(`  ${c.gray(pad('도구 시간', 14))} ${(session.usage.ms / 1000).toFixed(1)}초`);
      say(`  ${c.gray(pad('경과', 14))} ${mins}분`);
      say('');
      return { handled: true };
    }

    case 'status': {
      const k = session.conn;
      rule('연결', 70);
      say(`  ${c.gray(pad('규격', 10))} ${k.kind === 'ollama' ? 'Ollama' : 'OpenAI 호환'}`);
      say(`  ${c.gray(pad('주소', 10))} ${k.base}`);
      say(`  ${c.gray(pad('모델', 10))} ${k.model}`);
      say(`  ${c.gray(pad('작업 폴더', 10))} ${session.root}`);
      say(`  ${c.gray(pad('규칙', 10))} ${session.rules ? session.rules.name : '없음 (/init 으로 만들 수 있습니다)'}`);
      const caps = [
        k.tools ? c.green('도구') : c.red('도구'),
        k.streaming ? c.green('스트림') : c.gray('스트림'),
        k.json ? c.green('스키마') : c.gray('스키마'),
        k.think ? c.green('추론') : c.gray('추론'),
      ].join(c.gray(' · '));
      say(`  ${c.gray(pad('지원', 10))} ${caps}`);
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

    default: {
      // 이 PC 에서 찾은 슬래시 명령인지 본다. 있으면 그 내용을 모델에게 보낸다.
      const found = (session.commands ?? []).find((x) => x.name === raw)
        ?? (session.commands ?? []).find((x) => x.name.toLowerCase() === name)
        ?? (session.commands ?? []).find((x) => x.name.split(':').pop() === name);
      if (found) {
        const { text, error } = loadCommand(found, arg);
        if (error) { say(`  ${c.red('명령을 읽지 못했습니다')} ${error}`); say(''); return { handled: true }; }
        say(`  ${c.cyan('⌘')} ${found.name} ${c.gray(found.source)}`);
        return { handled: false, text };
      }
      const near = (session.commands ?? [])
        .filter((x) => x.name.includes(name) || name.includes(x.name.split(':').pop()))
        .slice(0, 5).map((x) => '/' + x.name);
      say(`  ${c.red('모르는 명령')} /${name}`);
      if (near.length) say(`  ${c.gray('비슷한 것:')} ${near.join('  ')}`);
      say(`  ${c.gray('/help 로 목록을,  /skills 로 스킬을 봅니다.')}`);
      say('');
      return { handled: true };
    }
  }
}

function showSkills(session, arg) {
  const all = session.skills ?? [];
  if (!all.length) {
    say('');
    say(`  ${c.gray('이 PC 에서 찾은 스킬이 없습니다.')}`);
    say(`  ${c.gray('찾는 자리: ./.deel/skills  ./.claude/skills  ~/.claude/skills  ~/.claude/plugins')}`);
    say('');
    return;
  }

  const q = arg.trim();
  if (q === 'all') {
    all.forEach((s) => { s.enabled = true; });
    session.maxSkillsListed = Math.min(all.length, 200);
    say(`  ${mark.ok} 전부 올립니다 (${session.listedSkills().length}개). ${c.yellow('컨텍스트를 많이 먹습니다 — /context 로 확인하세요.')}`);
    say('');
    return;
  }
  if (q === 'off') {
    all.forEach((s) => { s.enabled = false; });
    say(`  ${mark.ok} 스킬을 모두 내렸습니다.`);
    say('');
    return;
  }
  if (q.startsWith('on ')) {
    const term = q.slice(3).trim().toLowerCase();
    let n = 0;
    for (const s of all) {
      s.enabled = s.name.toLowerCase().includes(term) || s.description.toLowerCase().includes(term);
      if (s.enabled) n++;
    }
    say(`  ${mark.ok} "${term}" 에 걸리는 ${n}개만 올립니다.`);
    say('');
    return;
  }

  const hits = q
    ? all.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()) || s.description.toLowerCase().includes(q.toLowerCase()))
    : session.listedSkills();

  say('');
  rule(q ? `스킬 검색: ${q}` : '지금 올라간 스킬', 74);
  for (const s of hits.slice(0, 30)) {
    const tag = s.enabled ? c.green('●') : c.gray('○');
    say(`  ${tag} ${c.cyan(pad(s.name, 32))} ${c.gray(s.description.slice(0, 60))}`);
  }
  if (hits.length > 30) say(`  ${c.gray(`… 그 밖에 ${hits.length - 30}개`)}`);
  say('');

  const bySource = { project: 0, user: 0, plugin: 0 };
  for (const s of all) bySource[s.source] = (bySource[s.source] ?? 0) + 1;
  say(`  ${c.gray('전체')} ${all.length}개  ${c.gray('(프로젝트')} ${bySource.project} ${c.gray('· 사용자')} ${bySource.user} ${c.gray('· 플러그인')} ${bySource.plugin}${c.gray(')')}`);
  say(`  ${c.gray('프롬프트에 올라간 것')} ${session.listedSkills().length}개 ${c.gray(`(상한 ${session.maxSkillsListed})`)}`);
  if ((session.plugins ?? []).length) {
    say(`  ${c.gray('플러그인')} ${session.plugins.filter((p) => p.skills > 0).map((p) => p.name).slice(0, 8).join(', ')}`);
  }
  say('');
  say(`  ${c.gray('/skills <검색어>     찾아보기')}`);
  say(`  ${c.gray('/skills on <검색어>  걸리는 것만 올리기')}`);
  say(`  ${c.gray('/skills all | off    전부 올리기 | 내리기')}`);
  say('');
}

function help() {
  say('');
  rule('명령', 70);
  for (const [n, m] of Object.entries(COMMANDS)) {
    if (n === 'quit') continue;
    say(`  ${c.cyan(pad('/' + n + (m.arg ? ' ' + m.arg : ''), 22))} ${c.gray(m.desc)}`);
  }
  say('');
  say(`  ${c.gray('그 밖의 입력은 모델에게 보냅니다. 빈 줄에서 Ctrl+C 로 끝냅니다.')}`);
  say('');
}

function showContext(session) {
  const b = session.breakdown();
  say('');
  rule('컨텍스트', 70);
  say(`  ${c.bold(session.conn.model)} ${c.gray('·')} ${b.total.toLocaleString()} 토큰`);
  say('');
  say(`  ${bar(b.used, b.total, 32)}  ${b.used.toLocaleString()} / ${b.total.toLocaleString()}  ${c.gray(`${Math.round((b.used / b.total) * 100)}%`)}`);
  say('');
  for (const r of b.rows) {
    if (!r.n) continue;
    say(`  ${c.gray(pad(r.label, 26))} ${pad(r.n.toLocaleString(), 8, 'right')}`);
  }
  say(`  ${c.gray('─'.repeat(35))}`);
  say(`  ${c.gray(pad('남음', 26))} ${pad(b.left.toLocaleString(), 8, 'right')}`);
  say('');
  say(`  ${c.gray('/compact 대화 줄이기   /clear 통째로 비우기')}`);
  say(`  ${c.gray('숫자는 추정입니다 — 정확한 토크나이저를 쓰지 않습니다.')}`);
  say('');
}

async function switchModel(session, ctx) {
  const cfg = load();
  if (cfg.profiles.length <= 1 && !cfg.profiles.length) {
    say(`  ${c.gray('저장된 연결이 없습니다.')} ${c.cyan('deel setup')}`);
    say('');
    return;
  }
  const items = cfg.profiles.map((p) => ({
    label: `${pad(p.name, 18)} ${c.gray(p.model)}`,
    note: p.id === cfg.active ? '지금' : '',
  }));
  const i = await pick('연결 고르기', items, {
    def: cfg.profiles.findIndex((p) => p.id === cfg.active),
    ask: ctx?.ask,
  });
  const p = cfg.profiles[i];
  cfg.active = p.id;
  save(cfg);
  Object.assign(session.conn, {
    kind: p.kind, base: p.baseUrl, auth: p.auth, key: resolveKey(p), model: p.model,
    ctx: p.ctx, streaming: p.streaming, tools: p.tools, json: p.json, think: p.think,
  });
  say(`  ${mark.ok} ${c.bold(p.name)} ${c.gray(p.model)} 로 바꿨습니다. 대화는 이어집니다.`);
  say('');
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
