// 슬래시 명령. 이름은 Claude Code / Codex 관례에 맞춘다.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { c, say, rule, pad, bar, mark, width, clip } from './ui/ansi.js';
import { compact } from './agent/compact.js';
import { allowEndpoint } from './safety/network.js';
import { pick } from './ui/prompt.js';
import { load, save, resolveKey, upsert } from './config.js';
import { TOOLS } from './tools/index.js';
import { loadCommand, discover } from './skills/discover.js';
import { install, list, remove, pack } from './plugins/manage.js';
import { spin } from './ui/spinner.js';
import { PROFILES, LEVELS as THINK_LEVELS, normalizeProfile, table as effortTable } from './agent/effort.js';
import { scanLocal, toProfiles } from './backend/scan.js';
import { list as listSessions } from './agent/store.js';
import { MODES as WORK_MODES, ORDER as WORK_ORDER, normalize as normWork, get as getWork, canWrite } from './agent/modes.js';
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
  mode:    { desc: '승인 정책 — 얼마나 물어보나 (auto/confirm/strict)', arg: '<모드>' },
  work:    { desc: '작업 모드 — 무슨 일을 하는 중인가', arg: '[모드]' },
  code:    { desc: '작업 모드 → 코드 (고치고 만든다)' },
  plan:    { desc: '작업 모드 → 계획 (먼저 계획만)' },
  architect:{ desc: '작업 모드 → 설계 (구조를 짠다)' },
  debug:   { desc: '작업 모드 → 디버그 (원인을 찾는다)' },
  ask:     { desc: '작업 모드 → 묻기 (설명만)' },
  orchestrator: { desc: '작업 모드 → 총괄 (큰 일을 쪼개서)' },
  undo:    { desc: '직전 작업 되돌리기', arg: '[턴수]' },
  tools:   { desc: '쓸 수 있는 도구 보기' },
  skills:  { desc: '스킬 보기·검색·골라 올리기', arg: '[검색어|all|off]' },
  plugin:  { desc: '플러그인 목록·설치·삭제·반입묶음', arg: '[install|remove|pack]' },
  cost:    { desc: '이번 세션 사용량' },
  status:  { desc: '연결 상태' },
  scan:    { desc: '이 PC 의 로컬 모델 서버 훑기', arg: '[save]' },
  sessions:{ desc: '이 폴더의 지난 대화 목록' },
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
      const s = spin('앞선 대화를 요약해 접는 중…');
      const r = await compact(session);
      if (!r.ok) {
        s.stop(`  ${c.gray(r.why ?? '접지 못했습니다.')}`);
        say('');
        return { handled: true };
      }
      const 줄인 = r.before - r.after;
      s.stop(`  ${mark.ok} 대화 ${r.folded}개를 요약으로 접었습니다.`);
      say(`     ${c.gray(r.before.toLocaleString())} ${c.gray('→')} ${c.white(r.after.toLocaleString())} ${c.gray('토큰')}  ${c.green(`${Math.round((줄인 / Math.max(1, r.before)) * 100)}% 줄어듦`)}`);
      if (r.fallback) say(`     ${c.yellow('요약을 못 받아 그냥 줄였습니다.')}`);
      else if (r.summary) {
        say('');
        for (const line of r.summary.split('\n').slice(0, 14)) say(`     ${c.gray(clip(line, 76))}`);
      }
      say('');
      return { handled: true };
    }

    case 'model': return await switchModel(session, ctx), { handled: true };

    case 'think': {
      const asProfile = normalizeProfile(arg);
      if (asProfile) {
        session.effort = asProfile;
        session.effortSet = true;   // 사용자가 직접 정했다 — 작업 모드보다 우선한다
        say(`  ${mark.ok} 배분 ${c.bold(PROFILES[asProfile].name)} ${c.gray('— ' + PROFILES[asProfile].desc)}`);
        showThink(session);
        return { handled: true };
      }
      if (!THINK_LEVELS.includes(arg)) {
        showThink(session);
        return { handled: true };
      }
      session.think = arg;
      session.thinkSet = true;      // 사용자가 직접 정했다 — 작업 모드보다 우선한다
      say(`  ${mark.ok} 추론 강도 ${c.bold(arg)}`);
      if (!session.conn.think && arg !== 'off') {
        say(`     ${c.yellow('이 연결은 모델 층 조절이 안 먹습니다.')} ${c.gray('루프 층(도구 호출 상한)으로만 조절됩니다.')}`);
      }
      showThink(session);
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

    case 'work':
    case 'code': case 'plan': case 'architect':
    case 'debug': case 'ask': case 'orchestrator': {
      const 원하는 = cmd === 'work' ? normWork(arg) : cmd;
      if (cmd === 'work' && !원하는) { showWork(session); return { handled: true }; }
      const 골라진 = normWork(원하는);
      if (!골라진) {
        say(`  ${mark.warn} 그런 모드는 없습니다: ${c.white(arg)}`);
        say(`  ${c.gray('쓸 수 있는 것:')} ${WORK_ORDER.map((k) => c.cyan(WORK_MODES[k].name)).join(c.gray(' · '))}`);
        say('');
        return { handled: true };
      }
      session.work = 골라진;
      const w = getWork(골라진);
      say('');
      say(`  ${c.hcyan(w.glyph)} ${c.bold(w.name)} ${c.gray('(' + w.en + ')')}  ${c.gray(w.hint)}`);
      say(`  ${c.gray('도구')}    ${canWrite(골라진) ? c.yellow('읽기 + 파일 바꾸기') : c.green('읽기만 — 파일을 못 바꿉니다')}`);
      say(`  ${c.gray('생각')}    ${c.white(w.think ?? session.think)}${c.gray('·')}${c.magenta(w.effort)}   ${c.gray('최대 ' + w.steps + '걸음')}`);
      say('');
      return { handled: true };
    }

    case 'scan': {
      const s2 = spin('이 PC 의 로컬 서버를 찾는 중…');
      const found = await scanLocal({ timeout: 1500 });
      s2.stop(`  ${found.length ? mark.ok : mark.warn} ${found.length}곳 찾음`);
      if (!found.length) {
        say(`  ${c.gray('떠 있는 로컬 서버가 없습니다. 다른 포트라면')} ${c.cyan('deel scan --ports ...')}`);
        say('');
        return { handled: true };
      }
      for (const f of found) {
        say(`  ${c.hcyan('◆')} ${c.bold(pad(f.runtime, 12))}${c.gray(pad(`${f.host}:${f.port}`, 22))}${c.gray(`모델 ${f.models.length}개`)}`);
        for (const m of f.models.slice(0, 6)) say(`      ${c.gray('·')} ${clip(m.id, 44)}`);
        if (f.models.length > 6) say(`      ${c.gray(`… 그 밖에 ${f.models.length - 6}개`)}`);
      }
      say('');
      if (arg === 'save') {
        const cfg2 = load();
        const ps = toProfiles(found, cfg2.profiles);
        for (const x of ps) upsert(cfg2, x);
        save(cfg2);
        say(`  ${mark.ok} ${ps.length}개 등록했습니다. ${c.cyan('/model')} 로 고르세요.`);
      } else {
        say(`  ${c.gray('등록하려면')} ${c.cyan('/scan save')}   ${c.gray('고르려면')} ${c.cyan('/model')}`);
      }
      say('');
      return { handled: true };
    }

    case 'sessions': {
      const rows = listSessions(session.root, { limit: 12 });
      rule('이 폴더의 지난 대화', 70);
      if (!rows.length) {
        say(`  ${c.gray('아직 없습니다. 지금 이 대화가 첫 번째입니다.')}`);
        say('');
        return { handled: true };
      }
      for (const [i, r] of rows.entries()) {
        say(`  ${i === 0 ? c.hgreen('●') : c.gray('·')} ${c.bold(pad(r.id, 17))}${c.gray(pad(`${r.turns}턴`, 6, 'right'))}  ${c.gray(clip(r.model, 22))}`);
        say(`      ${c.gray(clip(r.first, 66))}`);
      }
      say('');
      say(`  ${c.gray('이어하려면 나갔다가')} ${c.cyan('deel --continue')} ${c.gray('또는')} ${c.cyan(`deel --resume ${rows[0].id}`)}`);
      say(`  ${c.gray('지금 대화는 나가지 않아도 계속 저장되고 있습니다.')}`);
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

    case 'plugin':
    case 'plugins': return await doPlugin(session, arg), { handled: true };

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

async function doPlugin(session, arg) {
  const [sub = '', ...rest] = arg.trim().split(/\s+/);
  const param = rest.join(' ').trim();

  // 설치·삭제 뒤에는 다시 훑어 이번 대화에 바로 반영한다.
  const rescan = () => {
    const f = discover(session.root);
    session.skills = f.skills;
    session.commands = f.commands;
    session.plugins = f.plugins;
    return f;
  };

  if (sub === 'install' || sub === 'add') {
    if (!param) {
      say(`  ${c.gray('예')} /plugin install affaan-m/ECC`);
      say(`  ${c.gray('  ')} /plugin install owner/repo#가지이름`);
      say('');
      return;
    }
    say('');
    const s = spin(`${param} 받는 중...`);
    const r = await install(param, { onStep: (m) => {} });
    if (r.error) {
      s.stop(`  ${mark.no} ${c.red(r.error.split('\n')[0])}`);
      for (const line of r.error.split('\n').slice(1)) say(`     ${c.gray(line.trim())}`);
      say(`     ${c.gray('오프라인이면 zip 을 ~/.deel/plugins/ 에 직접 풀면 됩니다.')}`);
      say('');
      return;
    }
    s.stop(`  ${mark.ok} ${c.bold(r.name)}${r.version ? ' ' + c.gray(r.version) : ''} ${c.gray(`(${r.license ?? '라이선스 미상'})`)}`);
    say(`     ${c.gray('스킬')} ${r.skills}개  ${c.gray('명령')} ${r.commands}개  ${c.gray(`· ${r.how} 로 받음`)}`);
    if (r.hooks) say(`     ${mark.warn} ${c.yellow(`실행 스크립트 ${r.hooks}개는 쓰지 않습니다`)} ${c.gray('(hook 미지원 · 반입 심사 대상)')}`);
    const f = rescan();
    say(`     ${c.gray(`이제 스킬 ${f.skills.length}개 · 명령 ${f.commands.length}개`)}`);
    say('');
    return;
  }

  if (sub === 'remove' || sub === 'rm' || sub === 'uninstall') {
    if (!param) { say(`  ${c.gray('예')} /plugin remove ecc`); say(''); return; }
    const r = remove(param);
    if (r.error) { say(`  ${mark.no} ${c.red(r.error)}`); say(''); return; }
    const f = rescan();
    say(`  ${mark.ok} ${c.bold(r.removed)} 지웠습니다. ${c.gray(`이제 스킬 ${f.skills.length}개`)}`);
    say('');
    return;
  }

  if (sub === 'pack') {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const out = param || join(session.root, `deel-plugins-${stamp}.zip`);
    const r = pack(out, { only: null });
    if (r.error) { say(`  ${mark.no} ${c.red(r.error)}`); say(''); return; }
    say('');
    say(`  ${mark.ok} ${c.cyan(r.out)}`);
    say(`     ${c.gray('플러그인')} ${r.plugins.length}개 ${c.gray('· 파일')} ${r.files}개 ${c.gray('·')} ${(r.bytes / 1024).toFixed(0)}KB`);
    if (r.skipped) say(`     ${c.gray(`실행 스크립트 ${r.skipped}개는 뺐습니다`)}`);
    say('');
    rule('담긴 것', 74);
    for (const p of r.plugins) {
      say(`  ${c.cyan(pad(p.name, 22))} ${c.gray(pad(p.version || '-', 9))} ${c.gray(pad(p.license || '미상', 14))} ${c.gray(`스킬 ${p.skills} · 명령 ${p.commands}`)}`);
    }
    say('');
    say(`  ${c.gray('오프라인 기기의')} ~/.deel/plugins/ ${c.gray('에 풀면 바로 인식됩니다. 설치 명령은 필요 없습니다.')}`);
    say(`  ${c.gray('묶음 안에 라이선스 표가 담긴 사용안내.txt 가 함께 들어 있습니다.')}`);
    say('');
    return;
  }

  // 인자 없으면 목록
  const items = list();
  if (!items.length) {
    say('');
    say(`  ${c.gray('설치된 플러그인이 없습니다.')}`);
    say(`  ${c.gray('받기')}  /plugin install owner/repo`);
    say(`  ${c.gray('직접')}  ~/.deel/plugins/ 에 폴더를 풀어 넣어도 됩니다`);
    say('');
    return;
  }
  say('');
  rule('플러그인', 74);
  for (const p of items) {
    say(`  ${c.cyan(pad(p.name, 22))} ${c.gray(pad(p.version || '-', 9))} ${c.gray(pad(p.license || '미상', 14))} ${c.gray(`스킬 ${p.skills} · 명령 ${p.commands}`)}`);
    say(`    ${c.gray(p.from)}`);
  }
  say('');
  say(`  ${c.gray('/plugin install <owner/repo>   /plugin remove <이름>   /plugin pack [파일]')}`);
  say('');
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

// 추론 강도는 값 하나가 아니라 '단계별 배분' 이다. 그 배분을 눈에 보이게 그린다.
function showThink(session) {
  const b = session.breakdown();
  const t = effortTable(session.think, session.effort, { ctx: b.total, used: b.used, max: session.conn.maxTokens ?? null });
  say('');
  rule('추론 강도', 70);
  say(`  기준 ${c.bold(session.think)}   배분 ${c.bold(t.name)}   ${c.gray(t.desc)}`);
  say(`  ${c.gray('상한은 이 모델 기준으로 계산합니다 — 컨텍스트')} ${c.white(t.ctx.toLocaleString())}${c.gray(', 지금 찬 양')} ${c.white(t.used.toLocaleString())}`);
  say('');
  say(`  ${c.gray(pad('단계', 12) + pad('강도', 10) + pad('출력상한', 10) + '언제')}`);
  for (const r of t.rows) {
    const 화살 = r.moved > 0 ? c.yellow('↑') : r.moved < 0 ? c.cyan('↓') : c.gray('·');
    say(`  ${pad(r.label, 12)}${화살} ${pad(r.level, 8)}${pad(r.cap.toLocaleString(), 10, 'right')}  ${c.gray(r.why)}`);
  }
  say('');
  say(`  ${c.gray('강도')}  ${THINK_LEVELS.join(' · ')}            ${c.gray('예')} ${c.cyan('/think high')}`);
  say(`  ${c.gray('배분')}  ${Object.entries(PROFILES).map(([k, v]) => `${k}(${v.name})`).join(' · ')}   ${c.gray('예')} ${c.cyan('/think save')}`);
  if (!session.conn.think && session.think !== 'off') {
    say('');
    say(`  ${c.yellow('이 연결은 모델 층 강도 조절이 안 먹습니다.')} ${c.gray('출력 상한만 단계별로 적용됩니다.')}`);
  }
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
  // 자물쇠도 같이 옮긴다. 이걸 빼먹으면 옛 주소가 열린 채로 남고 새 주소는 막혀
  // 다음 한마디에서 바로 "허용되지 않은 주소" 가 난다.
  allowEndpoint(p.baseUrl);
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

// /work 를 인자 없이 부르면 지금 모드와 고를 수 있는 것들을 보여 준다.
function showWork(session) {
  rule('작업 모드', 70);
  for (const k of WORK_ORDER) {
    const w = WORK_MODES[k];
    const 지금 = k === (normWork(session.work) ?? 'code');
    const 표 = 지금 ? c.hgreen('●') : c.gray('·');
    const 이름 = 지금 ? c.bold(c.white(pad(w.name, 8))) : c.gray(pad(w.name, 8));
    say(`  ${표} ${c.hcyan(w.glyph)} ${이름}${c.gray(pad(w.en, 14))}${c.gray(w.hint)}`);
    say(`        ${canWrite(k) ? c.gray('파일 바꿈') : c.green('읽기만')}${c.gray('  ·  생각 ' + (w.think ?? '그대로') + '·' + w.effort + '  ·  최대 ' + w.steps + '걸음')}`);
  }
  say('');
  say(`  ${c.gray('바꾸려면')} ${c.cyan('/plan')} ${c.cyan('/code')} ${c.cyan('/debug')} ${c.gray('…  또는')} ${c.cyan('Shift+Tab')} ${c.gray('으로 차례로')}`);
  say(`  ${c.gray('이건 승인 정책(')}${c.cyan('/mode')}${c.gray(')과 다른 축입니다 — 무엇을 하느냐 / 얼마나 물어보냐.')}`);
  say('');
}
