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
import { MODES as WORK_MODES, ORDER as WORK_ORDER, DEFAULT as WORK_DEFAULT, normalize as normWork, get as getWork, canWrite } from './agent/modes.js';
import { LEVELS, ORDER as LEVEL_ORDER, DEFAULT as LEVEL_DEFAULT, normalize as normLevel, shows as levelShows } from './ui/level.js';
import { diffLines, renderDiff, shortStat } from './ui/diff.js';
import { readTextFull } from './tools/fsutil.js';
const MODES = {
  auto: '자율 — 전부 알아서. 되돌리기가 안전망',
  confirm: '확인 — 되돌릴 수 없는 것만 물어봄',
  strict: '엄격 — 파일 변경·명령 전부 물어봄',
};

export const COMMANDS = {
  help:    { desc: '명령 목록' },
  clear:   { desc: '대화 비우기' },
  context: { desc: '컨텍스트 사용량 보기' },
  ctx:     { desc: '컨텍스트 길이 — 모델에 맞춰 다시 재거나 직접 지정', arg: '[auto|숫자|640k]' },
  out:     { desc: '한 번에 받을 답 길이 상한 — 큰 파일이 잘리면 여기를 올린다', arg: '[숫자|32k|auto]' },
  compact: { desc: '오래된 대화 줄이기' },
  model:   { desc: '연결·모델 바꾸기 (이름 일부 · list · models)', arg: '[이름|list|models]' },
  think:   { desc: '추론 강도 (off/low/medium/high/max)', arg: '<수준>' },
  mode:    { desc: '승인 정책 — 얼마나 물어보나 (auto/confirm/strict)', arg: '<모드>' },
  work:    { desc: '작업 모드 — 무슨 일을 하는 중인가 (종합이면 저절로)', arg: '[모드]' },
  // 이름이 /mode auto 와 겹쳐 보이므로 설명에서 못을 박는다.
  // /mode auto 는 '얼마나 물어보나', /auto 는 '무슨 일을 하는 중인가' 다.
  auto:    { desc: '작업 모드 → 종합 (요청에 따라 저절로 옮겨 감. /mode 와 다름)' },
  code:    { desc: '작업 모드 → 코드 (고치고 만든다)' },
  plan:    { desc: '작업 모드 → 계획 (먼저 계획만)' },
  architect:{ desc: '작업 모드 → 설계 (구조를 짠다)' },
  debug:   { desc: '작업 모드 → 디버그 (원인을 찾는다)' },
  ask:     { desc: '작업 모드 → 묻기 (설명만)' },
  orchestrator: { desc: '작업 모드 → 총괄 (큰 일을 쪼개서)' },
  undo:    { desc: '직전 작업 되돌리기', arg: '[턴수]' },
  diff:    { desc: '이번 대화에서 바뀐 파일 · 바뀐 자리 보기', arg: '[파일]' },
  tools:   { desc: '쓸 수 있는 도구 보기' },
  skills:  { desc: '스킬 보기·검색·골라 올리기', arg: '[검색어|all|off]' },
  plugin:  { desc: '플러그인 목록·설치·삭제·반입묶음', arg: '[install|remove|pack]' },
  cost:    { desc: '이번 세션 사용량' },
  status:  { desc: '연결 상태' },
  scan:    { desc: '이 PC 의 로컬 모델 서버 훑기', arg: '[save]' },
  sessions:{ desc: '이 폴더의 지난 대화 목록' },
  level:   { desc: '사용자 수준 (쉬움/개발자)', arg: '[수준]' },
  init:    { desc: 'DEEL.md 규칙 파일 만들기' },
  exit:    { desc: '끝내기' },
  quit:    { desc: '끝내기' },
};

/**
 * 이 줄이 명령이 아니라 '경로' 인가.
 *
 * 슬래시로 시작한다고 다 명령은 아니다. `/usr/local/bin` 이나 `/mnt/d/일감`
 * 같은 것을 치면 그동안은 통째로 명령으로 먹혀서 "모르는 명령" 만 나오고
 * 모델에게 닿지도 않았다. 경로를 아예 못 적는 셈이었다.
 *
 * 가르는 기준은 간단하다 — 명령 이름에는 슬래시가 없다.
 * 플러그인 명령도 `/플러그인:이름` 이라 콜론을 쓰지 슬래시를 안 쓴다.
 * 그러니 첫 낱말 안에 슬래시가 또 있으면 그건 경로다.
 */
function 경로처럼보이나(line) {
  const 첫낱말 = line.slice(1).split(/\s+/)[0] ?? '';
  if (첫낱말.includes('/') || 첫낱말.includes('\\')) return true;
  // `/tmp` 처럼 슬래시가 하나뿐이어도, 실제로 있는 자리면 경로로 본다.
  if (첫낱말 && !COMMANDS[첫낱말.toLowerCase()]) {
    try { if (existsSync(line.slice(1).trim())) return true; } catch { /* 못 보면 아닌 걸로 */ }
  }
  return false;
}

// 반환: { handled, exit? }  handled=false 면 모델에게 보낸다.
export async function handle(line, session, ctx) {
  if (!line.startsWith('/')) return { handled: false };
  if (경로처럼보이나(line)) return { handled: false };
  const [raw, ...rest] = line.slice(1).trim().split(/\s+/);
  const name = raw.toLowerCase();
  const arg = rest.join(' ');

  switch (name) {
    case 'help': return help(session), { handled: true };
    case 'level': return showLevel(session, arg), { handled: true };
    case 'exit':
    case 'quit': return { handled: true, exit: true };

    case 'clear':
      session.clear();
      say(`  ${mark.ok} 대화를 비웠습니다. 규칙과 연결은 그대로입니다.`);
      say('');
      return { handled: true };

    case 'context': return showContext(session), { handled: true };

    case 'ctx': return await ctxLength(session, arg), { handled: true };

    // 한 번에 받을 답 길이. 컨텍스트(/ctx)와는 다른 축이라 명령을 따로 둔다 —
    // /ctx out 안에 숨겨 두니 아무도 못 찾았고, 정작 큰 파일이 안 만들어지는 원인이었다.
    case 'out': case '출력': return await 출력상한(session, arg), { handled: true };

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

    case 'model': return await switchModel(session, ctx, arg), { handled: true };

    /*
     * /think — '얼마나 생각하나' 하나만 정한다.
     *
     * 전에는 한 명령이 두 축을 맡았다. `/think high` 는 강도(5단계)를 정하고
     * `/think save` 는 배분(3가지)을 정했다 — 같은 이름으로 다른 것을 정하니
     * 화면을 봐도 지금 무엇이 무엇인지 읽히지 않았다. 게다가 부를 때마다
     * 단계표가 통째로 펼쳐졌고, 그 표의 '출력상한' 칸 세 줄은 늘 같은 값이었다.
     *
     * 그래서 갈랐다.
     *   /think high      강도
     *   /think 배분 절약  단계별 배분
     *   /think 자세히     단계표
     *   /out             출력 상한 (아예 다른 축이라 명령을 따로 뺐다)
     *
     * 옛 이름(/think save)도 그대로 받는다. 쓰던 사람의 손버릇을 깨지 않는다.
     */
    case 'think': {
      const 말 = String(arg ?? '').trim();
      // 낱말 끝을 \b 로 잡으면 안 된다. \b 는 \w(=[A-Za-z0-9_])를 기준으로 하는데
      // 한글은 \w 가 아니다 — '배분 절약' 의 '분' 과 공백은 **둘 다 비낱말**이라
      // 그 사이에 경계가 없다. 그래서 `/^배분\b/` 는 영영 안 맞았고,
      // /think 배분 … 은 통째로 죽은 명령이었다(영어 prof 만 먹혔다).
      // 공백이나 줄 끝으로 직접 끊는다.
      const 배분말 = /^(배분|profile|prof)(\s|$)/.test(말) ? 말.replace(/^(배분|profile|prof)\s*/, '') : null;

      if (배분말 !== null) {
        const p = normalizeProfile(배분말);
        if (!p) {
          say(`  ${c.gray('배분')}  ${Object.entries(PROFILES).map(([k, v]) => `${k}(${v.name})`).join(' · ')}`);
          say(`  ${c.gray('예')} ${c.cyan('/think 배분 절약')}`);
          say('');
          return { handled: true };
        }
        session.effort = p;
        session.effortSet = true;   // 사용자가 직접 정했다 — 작업 모드보다 우선한다
        say(`  ${mark.ok} 배분 ${c.bold(PROFILES[p].name)} ${c.gray('— ' + PROFILES[p].desc)}`);
        showThink(session);
        return { handled: true };
      }

      if (/^(자세히|detail|-v)$/.test(말)) { showThink(session, { 자세히: true }); return { handled: true }; }

      // 옛 이름 — /think save 처럼 배분 이름을 바로 친 경우.
      const asProfile = normalizeProfile(말);
      if (asProfile) {
        session.effort = asProfile;
        session.effortSet = true;
        say(`  ${mark.ok} 배분 ${c.bold(PROFILES[asProfile].name)} ${c.gray('— ' + PROFILES[asProfile].desc)}`);
        say(`     ${c.gray('이제')} ${c.cyan('/think 배분 ' + PROFILES[asProfile].name)} ${c.gray('로도 됩니다 — 강도와 헷갈리지 않게 갈랐습니다.')}`);
        showThink(session);
        return { handled: true };
      }

      if (!THINK_LEVELS.includes(말)) {
        showThink(session);
        return { handled: true };
      }
      session.think = 말;
      session.thinkSet = true;      // 사용자가 직접 정했다 — 작업 모드보다 우선한다
      say(`  ${mark.ok} 추론 강도 ${c.bold(말)}`);
      if (!session.conn.think && 말 !== 'off') {
        say(`     ${c.yellow('이 연결은 모델 층 조절이 적용되지 않습니다.')} ${c.gray('루프 층(도구 호출 상한)으로만 조절됩니다.')}`);
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

    case 'diff': return 바뀐것보기(session, ctx, arg), { handled: true };

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
    case 'auto':
    case 'code': case 'plan': case 'architect':
    case 'debug': case 'ask': case 'orchestrator': {
      // 인자 없이 /work 만 치면 지금 모드와 고를 수 있는 것을 보여 준다.
      if (name === 'work' && !arg.trim()) { showWork(session); return { handled: true }; }

      const 골라진 = normWork(name === 'work' ? arg : name);
      if (!골라진) {
        // 오타에는 목록만 보여 주면 안 된다.
        //
        // 예전에는 /work 오타 가 조용히 목록으로 빠졌다. 그러면 사람은 자기가
        // 친 말이 틀렸다는 걸 모른 채 '왜 안 바뀌지' 만 하게 된다. 못 알아들었다는
        // 말을 먼저 하고, 그 다음에 쓸 수 있는 것을 보여 준다.
        say(`  ${mark.warn} 그런 모드는 없습니다: ${c.white(arg)}`);
        say(`  ${c.gray('쓸 수 있는 것:')} ${WORK_ORDER.map((k) => c.cyan(WORK_MODES[k].name)).join(c.gray(' · '))}`);
        say('');
        showWork(session);
        return { handled: true };
      }
      session.work = 골라진;
      // 사람이 직접 골랐다. 저절로 골라 둔 것이 있으면 지운다 —
      // 안 지우면 이번 한마디는 여전히 옛 모드로 돌아 "왜 안 바뀌지" 가 된다.
      session.routed = null;
      const w = getWork(골라진);
      say('');
      say(`  ${c.hcyan(w.glyph)} ${c.bold(w.name)} ${c.gray('(' + w.en + ')')}  ${c.gray(w.hint)}`);
      say(`  ${c.gray('도구')}    ${canWrite(골라진) ? c.yellow('읽기 + 파일 바꾸기') : c.green('읽기만 — 파일을 못 바꿉니다')}`);
      say(`  ${c.gray('생각')}    ${c.white(w.think ?? session.think)}${c.gray('·')}${c.magenta(w.effort)}   ${c.gray('최대 ' + w.steps + '걸음')}`);
      if (골라진 === 'auto') {
        say(`  ${c.gray('앞으로는 한마디마다 알맞은 모드로 저절로 옮겨 갑니다.')}`);
      } else {
        say(`  ${c.gray('직접 고르셨으므로 저절로 바뀌지 않습니다. 다시 맡기려면')} ${c.cyan('/work 종합')}`);
      }
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

  // 스킬은 남의 폴더·플러그인에서 온다. 앞머리(frontmatter)가 빠진 파일이 섞이면
  // 이름이나 설명이 없다. 그걸 그대로 만지면 목록 하나 보려다 대화가 끝난다.
  const 낮게 = (v) => String(v ?? '').toLowerCase();

  const q = arg.trim();
  if (q === 'all') {
    all.forEach((s) => { s.enabled = true; });
    session.maxSkillsListed = Math.min(all.length, 200);
    say(`  ${mark.ok} 전부 올립니다 (${session.listedSkills().length}개). ${c.yellow('컨텍스트를 많이 차지합니다 — /context 로 확인하세요.')}`);
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
      s.enabled = 낮게(s.name).includes(term) || 낮게(s.description).includes(term);
      if (s.enabled) n++;
    }
    say(`  ${mark.ok} "${term}" 에 걸리는 ${n}개만 올립니다.`);
    say('');
    return;
  }

  const hits = q
    ? all.filter((s) => 낮게(s.name).includes(q.toLowerCase()) || 낮게(s.description).includes(q.toLowerCase()))
    : session.listedSkills();

  say('');
  rule(q ? `스킬 검색: ${q}` : '지금 올라간 스킬', 74);
  for (const s of hits.slice(0, 30)) {
    const tag = s.enabled ? c.green('●') : c.gray('○');
    // 설명이 없을 수 있다. 스킬은 남의 폴더·플러그인에서 오는 것이라
    // 앞머리(frontmatter)가 빠진 파일이 섞인다. 여기서 터지면 목록 하나 보려다
    // 대화가 통째로 끝난다 — 화면 그리기는 무슨 일이 있어도 안 죽어야 한다.
    say(`  ${tag} ${c.cyan(pad(s.name, 32))} ${c.gray(String(s.description ?? '').slice(0, 60))}`);
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

function help(session) {
  const level = session?.level ?? LEVEL_DEFAULT;
  const 쉬움 = !levelShows(level, '__전부__');   // 개발자면 show 가 null 이라 전부 참
  say('');
  rule(쉬움 ? '명령 (자주 쓰는 것)' : '명령', 70);
  let 감춘수 = 0;
  for (const [n, m] of Object.entries(COMMANDS)) {
    if (n === 'quit') continue;
    if (!levelShows(level, n)) { 감춘수++; continue; }
    say(`  ${c.cyan(pad('/' + n + (m.arg ? ' ' + m.arg : ''), 22))} ${c.gray(m.desc)}`);
  }
  say('');
  // 감춘 것은 '못 쓰는 것' 이 아니다. 그 말을 분명히 해 둔다.
  if (감춘수) {
    say(`  ${c.gray(`이 밖에 ${감춘수}개가 더 있습니다 — 직접 입력하면 그대로 실행됩니다.`)}`);
    say(`  ${c.gray('전부 보려면')} ${c.cyan('/level 개발자')}`);
    say('');
  }
  say(`  ${c.gray('그 밖의 입력은 모델에게 보냅니다. 빈 줄에서 Ctrl+C 로 끝냅니다.')}`);
  say('');
}

// /level — 수준 보기·바꾸기. 설정 파일에 남겨 다음에도 그대로 쓴다.
function showLevel(session, arg) {
  if (!arg) {
    rule('사용자 수준', 70);
    for (const k of LEVEL_ORDER) {
      const lv = LEVELS[k];
      const 지금 = k === (normLevel(session.level) ?? LEVEL_DEFAULT);
      say(`  ${지금 ? c.hgreen('●') : c.gray('·')} ${지금 ? c.bold(c.white(pad(lv.name, 10))) : c.gray(pad(lv.name, 10))}${c.gray(lv.hint)}`);
    }
    say('');
    say(`  ${c.gray('안전 장치는 두 수준이 똑같습니다 — 되돌리기·작업 범위·위험 명령 차단.')}`);
    say(`  ${c.gray('수준은 무엇을 보여줄지만 정합니다.')}`);
    say('');
    say(`  ${c.gray('바꾸려면')} ${c.cyan('/level 쉬움')} ${c.gray('또는')} ${c.cyan('/level 개발자')}`);
    say('');
    return;
  }
  const 골라진 = normLevel(arg);
  if (!골라진) {
    say(`  ${mark.warn} 그런 수준은 없습니다: ${c.white(arg)}  ${c.gray('(쉬움 · 개발자)')}`);
    say('');
    return;
  }
  session.level = 골라진;
  try {
    const cfg = load();
    cfg.level = 골라진;
    save(cfg);
  } catch { /* 못 남겨도 이번 세션에는 먹는다 */ }
  const lv = LEVELS[골라진];
  say('');
  say(`  ${mark.ok} ${c.bold(lv.name)} ${c.gray('— ' + lv.hint)}`);
  say(`  ${c.gray('안전 장치는 그대로입니다.')}`);
  say('');
}

// 추론 강도는 값 하나가 아니라 '단계별 배분' 이다. 그 배분을 눈에 보이게 그린다.
/**
 * 지금 추론 강도가 어떻게 되어 있는지.
 *
 * 기본은 **한 줄**이다. 사람이 알고 싶은 것은 '지금 얼마나 생각하나' 이지
 * 단계별 표가 아니다. 표는 /think 자세히 로 뺐다.
 *
 * 쉬움 수준에서는 배분 이야기를 아예 안 꺼낸다 — 고를 일이 없는 사람에게
 * 고르는 법을 보여 주면 그것부터 걱정하게 된다.
 */
function showThink(session, { 자세히 = false } = {}) {
  const b = session.breakdown();
  const 아는상한 = session.conn.maxTokens ?? session.conn.maxOut ?? null;
  const t = effortTable(session.think, session.effort, { ctx: b.total, used: b.used, max: 아는상한 });
  const 개발자 = session.level === '개발자';
  const 단계 = t.rows.map((r) => `${r.label} ${r.level}`).join(c.gray(' · '));

  say('');
  say(`  ${c.gray('추론 강도')}  ${c.bold(session.think)}   ${c.gray(`(${단계})`)}`);
  if (개발자 || 자세히) say(`  ${c.gray('배분')}      ${c.bold(t.name)}   ${c.gray(t.desc)}`);

  if (자세히) {
    say('');
    say(`  ${c.gray(pad('단계', 12) + pad('강도', 10) + pad('출력상한', 10) + '언제')}`);
    for (const r of t.rows) {
      const 화살 = r.moved > 0 ? c.yellow('↑') : r.moved < 0 ? c.cyan('↓') : c.gray('·');
      say(`  ${pad(r.label, 12)}${화살} ${pad(r.level, 8)}${pad(r.cap.toLocaleString(), 10, 'right')}  ${c.gray(r.why)}`);
    }
    say('');
    // 상한이 어디서 왔는지 밝힌다. 세 줄이 같은 값일 때 그게 고장인지 아닌지
    // 이 한 줄로 갈린다 — 아는 상한이 낮으면 셋이 같아지는 것이 맞다.
    say(`  ${c.gray('출력 상한은')} ${c.white((아는상한 ?? 16384).toLocaleString())} ${c.gray(
      session.conn.maxTokens ? '(직접 정하신 값)' : session.conn.maxOut ? '(서버에서 알아낸 값)' : '(모르는 값이라 기본값)',
    )}${c.gray(' 안에서 나눕니다 —')} ${c.cyan('/out')}`);
    say(`  ${c.gray('컨텍스트')} ${c.white(t.ctx.toLocaleString())}${c.gray(' · 지금 찬 양 ')}${c.white(t.used.toLocaleString())}`);
    say('');
    say(`  ${c.gray('강도')}  ${THINK_LEVELS.join(' · ')}   ${c.gray('예')} ${c.cyan('/think high')}`);
    say(`  ${c.gray('배분')}  ${Object.entries(PROFILES).map(([k, v]) => `${k}(${v.name})`).join(' · ')}   ${c.gray('예')} ${c.cyan('/think 배분 절약')}`);
  } else if (개발자) {
    say(`  ${c.gray('강도')} ${c.cyan('/think high')}   ${c.gray('배분')} ${c.cyan('/think 배분 절약')}   ${c.gray('자세히')} ${c.cyan('/think 자세히')}`);
  } else {
    say(`  ${c.gray('더 세게')} ${c.cyan('/think high')}   ${c.gray('더 빠르게')} ${c.cyan('/think low')}`);
  }

  if (!session.conn.think && session.think !== 'off') {
    say(`  ${c.yellow('이 연결은 모델 층 강도 조절이 적용되지 않습니다.')} ${c.gray('출력 상한만 단계별로 적용됩니다.')}`);
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

/**
 * 이번 대화에서 무엇이 바뀌었는지 보여 준다.
 *
 *   /diff           바뀐 파일 목록과 늘고 준 줄 수
 *   /diff src/a.js  그 파일이 처음과 지금 사이에 어떻게 달라졌는지
 *
 * 파일 하나를 볼 때는 이번 대화의 '맨 처음' 모습과 견준다. 세 번 고쳤어도
 * 사람이 알고 싶은 것은 '내가 시키기 전과 지금이 뭐가 다른가' 이지
 * 마지막 한 번이 아니다. 되돌리기 이력이 그 맨 처음 모습을 들고 있다.
 */
function 바뀐것보기(session, ctx, arg = '') {
  const 말 = String(arg ?? '').trim();
  say('');

  if (!말) {
    const 목록 = [...session.changes.entries()];
    if (!목록.length) {
      say(`  ${c.gray('이번 대화에서 바뀐 파일이 없습니다.')}`);
      say(`  ${c.gray('파일을 고치고 나면 여기에 무엇이 얼마나 바뀌었는지 모입니다.')}`);
      say('');
      return;
    }
    rule('이번 대화에서 바뀐 파일', 70);
    let a = 0;
    let r = 0;
    for (const [p, v] of 목록) {
      a += v.added;
      r += v.removed;
      const 몇번 = v.times > 1 ? c.gray(`  ${v.times}번`) : '';
      say(`  ${pad(clip(ctx.scope.show(p), 46), 46)} ${c.hgreen(pad(`+${v.added}`, 6, 'right'))} ${c.hred(pad(`−${v.removed}`, 6, 'right'))}${몇번}`);
    }
    say(`  ${c.gray('─'.repeat(60))}`);
    say(`  ${pad(`${목록.length}개 파일`, 46)} ${c.hgreen(pad(`+${a}`, 6, 'right'))} ${c.hred(pad(`−${r}`, 6, 'right'))}`);
    say('');
    say(`  ${c.gray('한 파일을 자세히 보려면')} ${c.cyan('/diff <파일>')}${c.gray(', 되돌리려면')} ${c.cyan('/undo')}`);
    say('');
    return;
  }

  let abs;
  try { abs = ctx.scope.resolve(말); }
  catch (err) { say(`  ${mark.warn} ${err.message}`); say(''); return; }

  // 이번 대화에서 이 파일을 처음 건드리기 직전의 모습.
  const 처음 = ctx.history.all().find((x) => x.path === abs);
  if (!처음) {
    say(`  ${c.gray('이번 대화에서 안 바꾼 파일입니다:')} ${ctx.scope.show(abs)}`);
    say(`  ${c.gray('바뀐 것들을 보려면')} ${c.cyan('/diff')}`);
    say('');
    return;
  }

  const 옛것 = 처음.before === null ? null
    : (처음.enc === 'b64' ? Buffer.from(처음.before, 'base64').toString('utf8') : 처음.before);
  let 지금 = null;
  if (existsSync(abs)) {
    try { 지금 = readTextFull(abs).text; }
    catch (err) { say(`  ${mark.warn} 지금 내용을 못 읽습니다: ${err.message}`); say(''); return; }
  }

  const d = diffLines(옛것, 지금);
  rule(ctx.scope.show(abs), 70);
  if (!d.changed) {
    say(`  ${c.gray('고쳤다가 되돌아와서, 처음과 지금이 같습니다.')}`);
    say('');
    return;
  }
  if (d.isNew) say(`  ${c.gray('이번 대화에서 새로 만든 파일입니다.')}`);
  if (d.isGone) say(`  ${c.gray('이번 대화에서 없어진 파일입니다.')}`);
  say(`  ${shortStat(d)}`);
  say('');
  for (const l of renderDiff(d, { maxLines: session.level === '개발자' ? 200 : 60 })) say(l);
  say('');
  say(`  ${c.gray('되돌리려면')} ${c.cyan('/undo')}`);
  say('');
}

/**
 * 한 번에 받을 답 길이 상한.
 *
 *   /out            지금 값과 어디서 나온 값인지
 *   /out 32k        직접 지정
 *   /out auto       모른다고 두고 안전한 기본값으로 (16,384)
 *
 * 왜 따로 있나:
 *   컨텍스트(/ctx)와 다른 축이다. 컨텍스트가 655k 여도 '한 번에 뱉을 수 있는 답'
 *   은 대개 훨씬 작다. 그 두 값이 하나인 줄 알면 큰 파일이 왜 안 만들어지는지
 *   영영 알 수 없다 — 컨텍스트는 넉넉한데 답이 잘리기 때문이다.
 *
 *   전에는 이 기능이 /ctx out 안에 숨어 있었고, 게다가 **먹지도 않았다**
 *   (effort.js 의 클램프가 다시 조였다). 있는데 안 먹는 것이 가장 나쁘다 —
 *   문서에 적혀 있으니 사람이 그걸 믿고 쓴다.
 */
async function 출력상한(session, arg = '') {
  const { parseSize } = await import('./backend/ctxsize.js');
  const 말 = String(arg ?? '').trim().toLowerCase();
  const cfg = load();
  const prof = cfg.profiles.find((p) => p.id === cfg.active) ?? cfg.profiles[0];
  const 알아낸것 = session.conn.maxOut ?? null;

  if (말 === 'auto' || 말 === '자동') {
    session.conn.maxTokens = null;
    if (prof) { delete prof.maxTokens; try { save(cfg); } catch {} }
    say(`  ${mark.ok} 직접 정한 값을 지웠습니다.`);
    say(`     ${c.gray(알아낸것 ? `서버에서 알아낸 ${알아낸것.toLocaleString()} 토큰을 씁니다.` : '모르는 값이라 16,384 토큰으로 갑니다.')}`);
    say('');
    return;
  }

  if (말) {
    const 값 = parseSize(말);
    if (!값) {
      say(`  ${mark.no} 숫자를 못 읽었습니다: ${c.white(arg)}`);
      say(`     ${c.gray('이렇게 쓰세요 —')} ${c.cyan('/out 32k')}  ${c.cyan('/out 65536')}  ${c.cyan('/out auto')}`);
      say('');
      return;
    }
    session.conn.maxTokens = 값;
    if (prof) { prof.maxTokens = 값; try { save(cfg); } catch {} }
    say(`  ${mark.ok} 답 길이 상한 ${c.bold(값.toLocaleString())} 토큰`);
    say(`     ${c.gray('모델이 못 내는 값을 넣으면 서버가 거절합니다. 거절당하면')} ${c.cyan('/out auto')} ${c.gray('로 되돌리세요.')}`);
    say('');
    return;
  }

  const 쓰는값 = session.conn.maxTokens ?? 알아낸것 ?? 16384;
  const 어디서 = session.conn.maxTokens ? '직접 정하신 값'
    : 알아낸것 ? '서버에서 알아낸 값'
      : '모르는 값이라 안전한 기본값';
  say('');
  rule('한 번에 받을 답 길이', 70);
  say(`  ${c.gray('지금 상한')}     ${c.white(쓰는값.toLocaleString())} ${c.gray(`토큰 — ${어디서}`)}`);
  say(`  ${c.gray('컨텍스트')}      ${c.white((session.conn.ctx ?? 0).toLocaleString())} ${c.gray('토큰')} ${c.gray('(다른 축입니다 — /ctx)')}`);
  say('');
  say(`  ${c.gray('이 값이 한 번에 만들 수 있는 파일 크기를 정합니다.')}`);
  say(`  ${c.gray('1,000줄짜리 HTML 이 대략 12,000~18,000 토큰입니다.')}`);
  say(`  ${c.gray('여기서 잘려도 받은 데까지는 파일에 쓰고 이어 붙입니다 — 다만 몇 번 더 오갑니다.')}`);
  say('');
  say(`  ${c.cyan('/out 32k')}      ${c.gray('직접 지정 (k 는 1024)')}`);
  say(`  ${c.cyan('/out auto')}     ${c.gray('직접 정한 값을 지우고 알아낸 값/기본값으로')}`);
  say('');
}

/**
 * 컨텍스트 길이를 보고·다시 재고·직접 지정한다.
 *
 *   /ctx            지금 값과 어디서 나온 값인지
 *   /ctx auto       서버에 다시 물어 모델에 맞춘다
 *   /ctx 655360     직접 지정 (640k · 128k · 1m 도 받는다 — k 는 1024)
 *
 * 왜 필요한가: 이 숫자 하나가 프로그램 전체 크기를 정한다. 서버가 안 알려주면
 * 32,768 로 깔고 앉는데, 요즘 로컬 모델은 262,144 · 655,360 이 흔하다.
 * 그 상태로 쓰면 모델이 가진 것의 5% 만 쓰는 셈이다.
 *
 * 고른 값은 프로필에 남긴다 — 다음에 켤 때도 그대로여야 한다.
 */
async function ctxLength(session, arg = '') {
  const { probeCtx, parseSize, fmtSize } = await import('./backend/ctxsize.js');
  const 말 = String(arg ?? '').trim().toLowerCase();
  const 지금 = session.conn.ctx ?? 0;

  const 남기기 = (값, 어디서) => {
    session.conn.ctx = 값;
    const cfg = load();
    const prof = cfg.profiles.find((p) => p.id === cfg.active) ?? cfg.profiles[0];
    if (prof) { prof.ctx = 값; save(cfg); }
    const b = session.breakdown();
    say(`  ${mark.ok} 컨텍스트 ${c.bold(값.toLocaleString())} 토큰 ${c.gray(`(${fmtSize(값)}) — ${어디서}`)}`);
    say(`     ${c.gray('지금 찬 양')} ${c.white(b.used.toLocaleString())} ${c.gray('· 남음')} ${c.white(b.left.toLocaleString())}`);
    if (prof) say(`     ${c.gray('프로필에 저장했습니다. 다음에 켤 때도 이 값입니다.')}`);
    say('');
  };

  // 0) 답 길이 상한 — 이제 /out 이 본자리다. 여기서는 그리로 넘긴다.
  //    \b 가 아니라 공백·줄 끝으로 끊는다. 한글은 \w 가 아니라서
  //    `/^답\b/` 는 '답 32k' 에도 '답' 에도 안 맞는다(위 '배분' 과 같은 함정).
  if (/^(out|답|출력)(\s|$)/.test(말)) return await 출력상한(session, 말.replace(/^(out|답|출력)\s*/, ''));

  // 1) 직접 지정
  if (말 && !['auto', '자동', '다시', '자세히', 'detail', '-v'].includes(말)) {
    const 값 = parseSize(말);
    if (!값) {
      say(`  ${mark.no} 숫자를 못 읽었습니다: ${c.white(arg)}`);
      say(`     ${c.gray('이렇게 쓰세요 —')} ${c.cyan('/ctx 655360')}  ${c.cyan('/ctx 640k')}  ${c.cyan('/ctx 128k')}  ${c.cyan('/ctx auto')}`);
      say(`     ${c.gray('k 는 1024 입니다. 655,360 은 640k 이지 655k 가 아닙니다 — 헷갈리면 그냥 숫자로 쓰세요.')}`);
      say('');
      return;
    }
    남기기(값, '직접 지정');
    say(`  ${c.gray('서버가 실제로 올려 둔 길이보다 크게 잡으면 긴 대화에서 거절당합니다.')}`);
    say(`  ${c.gray('서버 쪽에서 올린 다음 맞추는 게 안전합니다 —')} ${c.cyan('/ctx auto')} ${c.gray('로 다시 잽니다.')}`);
    say('');
    return;
  }

  // 2) 다시 재기 (auto · 다시 · 자세히)
  if (말) {
    const 자세히 = /자세히|detail|-v/.test(말);
    const s = spin('모델에 걸린 길이를 서버에 묻는 중…');
    let r;
    try { r = await probeCtx(session.conn); }
    catch (err) { s.stop(`  ${mark.no} 못 물어봤습니다 — ${c.gray(String(err?.message ?? err))}`); say(''); return; }
    s.stop('');

    // 어디를 두드렸고 무엇이 나왔는지. 값이 이상할 때 사람이 원인을 짚을 수 있어야 한다.
    if (자세히) {
      say('');
      say(`  ${c.gray('두드린 자리')}`);
      for (const t of r.tried) {
        const 표 = t.ok ? c.green('응답함') : c.gray(`${t.status || '연결 실패'}`);
        say(`     ${c.gray(pad(t.label, 20))} ${표}  ${c.gray(clip(t.url, 60))}`);
      }
      say('');
      say(`  ${c.gray('읽어 낸 값')}`);
      say(`     ${c.gray(pad('모델 최대', 20))} ${r.max ? c.white(r.max.toLocaleString()) : c.gray('못 찾음')}`
        + (r.maxKey ? c.gray(`  ← ${r.maxKey}`) : ''));
      say(`     ${c.gray(pad('지금 올린 길이', 20))} ${r.loaded ? c.white(r.loaded.toLocaleString()) : c.gray('못 찾음')}`
        + (r.loadedKey ? c.gray(`  ← ${r.loadedKey}`) : ''));
      say(`     ${c.gray(pad('답 길이 상한', 20))} ${r.out ? c.white(r.out.toLocaleString()) : c.gray('못 찾음')}`
        + (r.outSource ? c.gray(`  ← ${r.outSource}`) : ''));
      say('');
    }

    // 답 길이 상한도 같이 알아냈으면 받아 둔다. 사람이 정한 값은 안 덮는다.
    if (r.out) session.conn.maxOut = r.out;

    if (!r.value) {
      // 못 알아낸 것을 아는 척하지 않는다. 조용히 32,768 로 깔고 앉으면
      // 655k 모델을 5% 만 쓰거나, 8k 서버에 128k 를 보내 조용히 잘린다.
      say(`  ${mark.warn} 서버가 컨텍스트 길이를 안 알려줍니다. ${c.gray(r.why ?? '')}`);
      if (!자세히) for (const t of r.tried) say(`     ${c.gray(pad(t.label, 20))} ${c.gray(t.ok ? '응답함(값 없음)' : `${t.status || '연결 실패'}`)}`);
      say(`     ${c.gray(`지금은 ${(session.conn.ctx ?? 0).toLocaleString()} 으로 잡혀 있습니다 — 이건 알아낸 값이 아니라 기본값입니다.`)}`);
      say(`     ${c.gray('직접 넣어 주세요 —')} ${c.cyan('/ctx 655360')}   ${c.gray('어디를 두드렸는지 보려면')} ${c.cyan('/ctx 자세히')}`);
      say('');
      return;
    }
    남기기(r.value, `${r.source ?? '서버'}에서 읽음`);
    if (r.max && r.loaded && r.max > r.loaded) {
      say(`  ${c.yellow('이 모델은')} ${c.bold(r.max.toLocaleString())} ${c.yellow('까지 되는데 지금')} ${c.bold(r.loaded.toLocaleString())} ${c.yellow('로 올려 두셨습니다.')}`);
      say(`     ${c.gray('서버(LM Studio 등)에서 컨텍스트를 더 올려 다시 올린 뒤')} ${c.cyan('/ctx auto')} ${c.gray('를 하시면 그만큼 씁니다.')}`);
      say('');
    }
    return;
  }

  // 3) 그냥 보기
  const b = session.breakdown();
  say('');
  rule('컨텍스트 길이', 70);
  say(`  ${c.bold(session.conn.model)}`);
  say(`  ${c.gray('지금 잡은 길이')}   ${c.white(지금.toLocaleString())} ${c.gray('토큰 (' + fmtSize(지금) + ')')}`);
  say(`  ${c.gray('찬 양')}           ${c.white(b.used.toLocaleString())} ${c.gray('· 남음 ' + b.left.toLocaleString())}`);
  say('');
  say(`  ${c.gray('이 값 하나가 프로그램 전체 크기를 정합니다 — 한 번에 읽힐 수 있는 파일 수,')}`);
  say(`  ${c.gray('대화가 접히는 시점, 한 번에 쓸 수 있는 답 길이가 모두 여기서 나옵니다.')}`);
  say('');
  say(`  ${c.cyan('/ctx auto')}      ${c.gray('서버에 다시 물어 모델에 맞춥니다')}`);
  say(`  ${c.cyan('/ctx 655360')}    ${c.gray('직접 지정 (640k · 128k · 1m 도 됩니다 — k 는 1024)')}`);
  say(`  ${c.cyan('/out 32k')}      ${c.gray('한 번에 받을 답 길이 상한 (지금 ' + (session.conn.maxTokens ?? session.conn.maxOut ?? 16384).toLocaleString() + ') — 다른 축입니다')}`);
  say('');
}

/** 지금 연결을 이 프로필로 갈아끼운다. 대화는 그대로 둔다. */
function 연결적용(session, p) {
  Object.assign(session.conn, {
    kind: p.kind, base: p.baseUrl, auth: p.auth, key: resolveKey(p), model: p.model,
    ctx: p.ctx, maxTokens: p.maxTokens ?? null,
    streaming: p.streaming, tools: p.tools, json: p.json, think: p.think,
  });
  // 자물쇠도 같이 옮긴다. 이걸 빼먹으면 옛 주소가 열린 채로 남고 새 주소는 막혀
  // 다음 한마디에서 바로 "허용되지 않은 주소" 가 난다.
  allowEndpoint(p.baseUrl);
}

/**
 * 지금 붙어 있는 서버가 내주는 모델 목록.
 *
 * 저장된 프로필에는 등록할 때 고른 모델 하나만 있다. 그런데 서버 한 대가
 * 모델을 여럿 내주는 경우가 대부분이다 — 특히 프록시나 게이트웨이가 그렇다.
 * 그래서 서버에 직접 물어본다. 자리를 새로 여는 게 아니라 이미 열린 자리다.
 */
async function 서버모델들(conn) {
  const { req, headersFor } = await import('./backend/http.js');
  if (conn.kind === 'ollama') {
    const r = await req(`${conn.base.replace(/\/v1\/?$/, '')}/api/tags`, { timeout: 4000 });
    return (r.json?.models ?? []).map((m) => m.name ?? m.model).filter(Boolean);
  }
  const r = await req(`${conn.base.replace(/\/$/, '')}/models`, {
    headers: headersFor(conn.auth ?? 'none', conn.key), timeout: 4000,
  });
  if (!r.ok) return null;
  const list = r.json?.data ?? r.json?.models ?? [];
  return Array.isArray(list)
    ? list.map((m) => (typeof m === 'string' ? m : m.id ?? m.name ?? m.model)).filter(Boolean)
    : null;
}

/**
 * /model — 연결·모델 바꾸기.
 *
 *   /model            골라 바꾸기 (연결 목록 + '이 서버의 다른 모델')
 *   /model <이름>     바로 바꾸기. 연결 이름이든 모델 이름이든 일부만 쳐도 된다
 *   /model list       무엇이 등록돼 있는지만 보기
 *   /model models     지금 서버가 내주는 모델을 물어보기
 */
async function switchModel(session, ctx, arg = '') {
  const cfg = load();
  if (!cfg.profiles.length) {
    say(`  ${c.gray('저장된 연결이 없습니다.')} ${c.cyan('deel setup')} ${c.gray('또는')} ${c.cyan('deel scan --save')}`);
    say('');
    return;
  }
  const 말 = arg.trim();

  if (말 === 'list' || 말 === '목록') return 연결목록(cfg, session);
  if (말 === 'models' || 말 === '모델') return await 서버모델고르기(session, ctx, cfg);

  // 이름으로 바로 바꾸기 — 메뉴를 안 거친다.
  if (말) {
    const 찾은 = 이름으로찾기(cfg.profiles, 말);
    if (찾은.length === 1) return 골라적용(session, cfg, 찾은[0]);
    if (찾은.length > 1) {
      say(`  ${mark.warn} ${c.white(말)} ${c.gray('에 맞는 것이 여럿입니다.')}`);
      for (const p of 찾은.slice(0, 12)) say(`    ${c.cyan(p.name)}  ${c.gray(p.model)}`);
      say('');
      return;
    }
    // 등록된 것에 없으면, 지금 서버가 내주는 모델 중에 있는지 본다.
    const 있는것 = await 서버모델들(session.conn);
    const 맞는것 = (있는것 ?? []).filter((m) => m.toLowerCase().includes(말.toLowerCase()));
    if (맞는것.length === 1) return await 모델만바꾸기(session, cfg, 맞는것[0]);
    if (맞는것.length > 1) {
      say(`  ${mark.warn} ${c.white(말)} ${c.gray('에 맞는 모델이 여럿입니다.')}`);
      for (const m of 맞는것.slice(0, 12)) say(`    ${c.cyan(m)}`);
      say('');
      return;
    }
    say(`  ${mark.warn} ${c.white(말)} ${c.gray('에 맞는 연결도 모델도 없습니다.')}`);
    say(`  ${c.gray('무엇이 있는지 보려면')} ${c.cyan('/model list')}${c.gray(', 서버에 물어보려면')} ${c.cyan('/model models')}`);
    say('');
    return;
  }

  // 인자 없이 — 골라 바꾸기. 물어볼 수 없는 자리면 목록만 보여준다.
  if (!ctx?.ask) return 연결목록(cfg, session);

  const items = cfg.profiles.map((p) => ({
    label: `${pad(p.name, 22)} ${c.gray(p.model)}`,
    note: p.id === cfg.active ? '지금' : '',
  }));
  items.push({ label: c.cyan('이 서버의 다른 모델 고르기'), note: '서버에 물어봅니다' });

  const i = await pick('연결·모델 고르기', items, {
    def: Math.max(0, cfg.profiles.findIndex((p) => p.id === cfg.active)),
    ask: ctx?.ask,
  });
  if (i === cfg.profiles.length) return await 서버모델고르기(session, ctx, cfg);
  return 골라적용(session, cfg, cfg.profiles[i]);
}

function 이름으로찾기(profiles, 말) {
  const q = 말.toLowerCase();
  const 정확 = profiles.filter((p) => p.name.toLowerCase() === q || p.model.toLowerCase() === q || p.id.toLowerCase() === q);
  if (정확.length) return 정확;
  return profiles.filter((p) => `${p.name} ${p.model} ${p.id}`.toLowerCase().includes(q));
}

function 골라적용(session, cfg, p) {
  cfg.active = p.id;
  try { save(cfg); } catch { /* 못 남겨도 이번 세션에는 바뀐다 */ }
  연결적용(session, p);
  say(`  ${mark.ok} ${c.bold(p.name)} ${c.gray(p.model)} 로 바꿨습니다. 대화는 이어집니다.`);
  say('');
}

/**
 * 같은 서버에서 모델만 바꾼다.
 *
 * 등록된 연결이 아니어도 된다 — 서버가 내준다면 쓸 수 있어야 한다.
 * 다음에도 쓰도록 프로필로 남겨 둔다. 그래야 /model 목록에서 다시 보인다.
 */
async function 모델만바꾸기(session, cfg, 모델) {
  const 지금 = cfg.profiles.find((p) => p.id === cfg.active) ?? cfg.profiles[0];
  const 이미 = cfg.profiles.find((p) => p.baseUrl === session.conn.base && p.model === 모델);
  const p = 이미 ?? {
    ...지금,
    id: `${(지금?.id ?? 'conn').replace(/-[^-]*$/, '')}-${String(모델).replace(/[^a-zA-Z0-9._-]+/g, '-')}`.slice(0, 60).toLowerCase(),
    name: `${(지금?.name ?? '연결').split(' · ')[0]} · ${모델}`,
    baseUrl: session.conn.base,
    model: 모델,
    // 컨텍스트 길이는 물려받지 않는다. 모델마다 다르다 —
    // 32k 짜리에서 655k 짜리로 옮겼는데 32k 로 깔고 앉으면 새 모델의 5% 만 쓴다.
    // 반대로 큰 데서 작은 데로 옮기면 긴 대화에서 서버가 거절한다. 아래에서 다시 잰다.
    ctx: null,
  };
  if (!이미) { try { save(upsert(cfg, p)); } catch { /* 못 남겨도 이번 세션에는 바뀐다 */ } }
  else { cfg.active = p.id; try { save(cfg); } catch {} }
  연결적용(session, p);
  say(`  ${mark.ok} 모델을 ${c.bold(모델)} 로 바꿨습니다. ${c.gray('서버는 그대로입니다.')}`);
  await 길이맞추기(session, cfg, p);
  say('');
}

/**
 * 바뀐 모델에 맞춰 컨텍스트 길이를 다시 잰다.
 *
 * 모델을 바꾸는 순간은 이미 서버와 이야기하는 중이라 한 번 더 물어봐도 티가 안 난다.
 * 여기서 안 재면 새 모델을 옛 모델의 길이로 쓰게 된다 — 화면에는 아무 표시도 안 나고
 * 그냥 조용히 작아진다. 그런 고장이 가장 늦게 발견된다.
 */
async function 길이맞추기(session, cfg, prof) {
  const { probeCtx, fmtSize, 기본값 } = await import('./backend/ctxsize.js');
  let r = null;
  try { r = await probeCtx(session.conn, { timeout: 8000 }); } catch { /* 못 물어보면 아래에서 기본값 */ }
  const 값 = r?.value ?? prof.ctx ?? 기본값;
  session.conn.ctx = 값;
  if (prof) {
    prof.ctx = 값;
    try { save(cfg); } catch { /* 못 남겨도 이번 세션에는 먹는다 */ }
  }
  say(`     ${c.gray('컨텍스트')} ${c.white(값.toLocaleString())} ${c.gray('토큰 (' + fmtSize(값) + ') — ' + (r?.source ? r.source + '에서 읽음' : '서버가 안 알려줘 기본값'))}`);
  if (r?.max && r?.loaded && r.max > r.loaded) {
    say(`     ${c.yellow('이 모델은 ' + r.max.toLocaleString() + ' 까지 됩니다.')} ${c.gray('서버에서 더 올린 뒤')} ${c.cyan('/ctx auto')}`);
  } else if (!r?.value) {
    say(`     ${c.gray('맞지 않으면')} ${c.cyan('/ctx 655360')} ${c.gray('처럼 직접 지정하세요.')}`);
  }
}

function 연결목록(cfg, session) {
  rule('등록된 연결', 70);
  for (const p of cfg.profiles) {
    const 지금 = p.id === cfg.active;
    say(`  ${지금 ? c.hgreen('●') : c.gray('·')} ${지금 ? c.bold(c.white(pad(p.name, 26))) : pad(p.name, 26)}${c.gray(p.model)}`);
    say(`      ${c.gray(p.baseUrl)}`);
  }
  say('');
  say(`  ${c.gray('바꾸려면')} ${c.cyan('/model <이름 일부>')}${c.gray(' — 연결 이름이든 모델 이름이든 됩니다.')}`);
  say(`  ${c.gray('이 서버가 내주는 다른 모델을 보려면')} ${c.cyan('/model models')}`);
  say('');
}

async function 서버모델고르기(session, ctx, cfg) {
  const s = spin('서버에 모델 목록을 물어보는 중…');
  let 있는것;
  try { 있는것 = await 서버모델들(session.conn); } catch { 있는것 = null; }
  s.stop('');
  if (!있는것 || !있는것.length) {
    say(`  ${mark.warn} 이 서버는 모델 목록을 내주지 않습니다.`);
    say(`  ${c.gray('목록이 없는 게이트웨이도 있습니다. 그때는')} ${c.cyan('deel setup')} ${c.gray('에서 모델 이름을 직접 넣으세요.')}`);
    say('');
    return;
  }
  // 물어볼 수 없는 자리면 목록만 보여주고 끝낸다.
  //
  // 여기서 그냥 pick 을 부르면 표준입력을 붙잡고 영영 안 끝난다.
  // 파이프로 넣거나 검사에서 돌릴 때가 그렇다 — 멈춘 것처럼 보이고 끊는 수밖에 없다.
  if (!ctx?.ask) {
    rule(`이 서버의 모델 (${있는것.length}개)`, 70);
    for (const m of 있는것) say(`  ${m === session.conn.model ? c.hgreen('●') : c.gray('·')} ${m === session.conn.model ? c.bold(m) : m}`);
    say('');
    say(`  ${c.gray('바꾸려면')} ${c.cyan('/model <이름 일부>')}`);
    say('');
    return;
  }

  const i = await pick(`이 서버의 모델 (${있는것.length}개)`, 있는것.map((m) => ({
    label: m, note: m === session.conn.model ? '지금' : '',
  })), {
    def: Math.max(0, 있는것.indexOf(session.conn.model)),
    ask: ctx.ask,
  });
  const 고른것 = 있는것[i];
  if (고른것 === session.conn.model) {
    say(`  ${c.gray('그대로 둡니다.')}`);
    say('');
    return;
  }
  await 모델만바꾸기(session, cfg, 고른것);
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
    const 지금 = k === (normWork(session.work) ?? WORK_DEFAULT);
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
