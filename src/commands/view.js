// 슬래시 명령 — 보여 주는 것: 도움말 · 화면 수준 · 생각 세기 · 컨텍스트 · 작업 모드 목록.
// commands.js 에서 역할별로 나눠 옮겼다(2.0.0). 명령을 가르는 자리(handle)는 그대로 commands.js 에 있다.
import { c, say, rule, pad, bar, mark, width, clip } from '../ui/ansi.js';
import { load } from '../config.js';
import { 걸음수 } from '../agent/budget.js';
import { 말, 언어 } from '../i18n/index.js';
import { 나가는눈금 } from '../backend/adapter.js';
import { PROFILES, LEVELS as THINK_LEVELS, table as effortTable, 가벼운강도, shiftLevel } from '../agent/effort.js';
import { 전선말 } from '../backend/wire.js';
import { MODES as WORK_MODES, ORDER as WORK_ORDER, DEFAULT as WORK_DEFAULT, normalize as normWork, canWrite, 보일이름, 보일한줄 } from '../agent/modes.js';
import { LEVELS, ORDER as LEVEL_ORDER, DEFAULT as LEVEL_DEFAULT, normalize as normLevel, shows as levelShows } from '../ui/level.js';
import { COMMANDS, 설정남기기 } from './common.js';

export function help(session) {
  const level = session?.level ?? LEVEL_DEFAULT;
  const 쉬움 = !levelShows(level, '__전부__');   // 개발자면 show 가 null 이라 전부 참
  say('');
  rule(말(쉬움 ? 'help.titleCommon' : 'help.title'), 70);
  let 감춘수 = 0;
  for (const [n, m] of Object.entries(COMMANDS)) {
    if (n === 'quit') continue;
    if (!levelShows(level, n)) { 감춘수++; continue; }
    say(`  ${c.cyan(pad('/' + n + (m.arg ? ' ' + m.arg : ''), 22))} ${c.gray(m.desc)}`);
  }
  say('');
  // 감춘 것은 '못 쓰는 것' 이 아니다. 그 말을 분명히 해 둔다.
  if (감춘수) {
    say(`  ${c.gray(말('help.moreHidden', { n: 감춘수 }))}`);
    say(`  ${c.gray(말('help.showAll'))} ${c.cyan('/level developer')}`);
    say('');
  }
  say(`  ${c.gray(말('help.restGoesToModel'))}`);
  say('');
}

// /level — 수준 보기·바꾸기. 설정 파일에 남겨 다음에도 그대로 쓴다.
export function showLevel(session, arg) {
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
  /*
   * 못 남기면 말한다. 바로 아래가 `✓ 개발자` 를 찍는데, 못 남긴 판에서는
   * 그 말이 이번 판에서만 참이다 — 설정남기기() 가 아홉 자리에서 없앤 그
   * 꼴인데 이 자리만 옛 모양으로 남아 있었다.
   */
  try {
    const cfg = load();
    cfg.level = 골라진;
    설정남기기(cfg);
  } catch (e) {
    /*
     * 설정 파일 자체를 못 읽는 경우다(JSON 이 깨졌다). 바로 위 머리글이
     * 「못 남기면 말한다」 라고 적어 놓고 여기만 통째로 삼키고 있었다.
     * 켤 때는 repl 이 말해 주지만 **대화 도중에 깨진 경우는 아무도 안 말한다** —
     * 화면은 `✓ 개발자` 를 찍고 다음에 켜면 그대로 쉬움이다.
     */
    say(`  ${mark.warn} ${c.yellow(말('common.cfgSaveFailed', { 왜: clip(String(e?.message ?? e), 70) }))}`);
  }
  const lv = LEVELS[골라진];
  say('');
  say(`  ${mark.ok} ${c.bold(lv.name)} ${c.gray('— ' + lv.hint)}`);
  say(`  ${c.gray('안전 장치는 그대로입니다.')}`);
  say('');
}

/**
 * 찾은 낱말에 색을 입힌다.
 *
 * 토막만 보여 주면 **왜 이게 걸렸는지** 안 보인다. 특히 조사를 떼고 찾기
 * 때문에("인코딩을" 로 "인코딩" 을 찾는다) 눈으로는 안 맞는 것처럼 보이는
 * 경우가 있다. 맞은 자리를 칠해 주면 그 의심이 사라진다.
 *
 * 낱말들은 **소문자로** 온다 — 유일한 부르는 자리(commands.js 의 /recall)가
 * 낱말쪼개기() 가 소문자로 쪼갠 것을 그대로 넘긴다. 여기서 다시 안 낮춘다.
 */
export function 강조(글, 낱말들) {
  let 조각 = [{ 글, 맞음: false }];
  for (const w of 낱말들) {
    const 다음 = [];
    for (const p of 조각) {
      if (p.맞음) { 다음.push(p); continue; }
      const 낮은 = p.글.toLowerCase();
      let i = 0;
      let 자리 = 낮은.indexOf(w);
      while (자리 >= 0) {
        if (자리 > i) 다음.push({ 글: p.글.slice(i, 자리), 맞음: false });
        다음.push({ 글: p.글.slice(자리, 자리 + w.length), 맞음: true });
        i = 자리 + w.length;
        자리 = 낮은.indexOf(w, i);
      }
      if (i < p.글.length) 다음.push({ 글: p.글.slice(i), 맞음: false });
    }
    조각 = 다음;
  }
  return 조각.map((p) => (p.맞음 ? c.hyellow(p.글) : c.gray(p.글))).join('');
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
export function showThink(session, { 자세히 = false } = {}) {
  const b = session.breakdown();
  const 아는상한 = session.conn.maxTokens ?? session.conn.maxOut ?? null;
  const t = effortTable(session.think, session.effort, { ctx: b.total, used: b.used, max: 아는상한 });
  const 개발자 = session.level === '개발자';
  const 단계 = t.rows.map((r) => `${r.label} ${r.level}`).join(c.gray(' · '));

  /*
   * 이 화면은 여태 통째로 한국어였다.
   *
   * `/lang en` 으로 켠 사람에게 「추론 강도 medium (첫 판단 medium · …)」 이
   * 뜨면 아무것도 안 읽힌다. 명령 이름만 영어고 화면이 한국어인 자리는
   * 「덜 옮겨졌다」 가 아니라 「고장 났다」 로 읽힌다 — i18n/index.js 머리말.
   *
   * 예로 드는 명령도 말을 따라간다. `/think 배분 절약` 은 영어로 켠 사람이
   * 칠 수 없는 글자다. 두 이름 다 진짜로 받는다(위 배분말·자세히 갈래).
   */
  const 한국어 = 언어() === 'ko';
  const 배분예 = 한국어 ? '/think 배분 절약' : '/think profile save';
  const 자세히예 = 한국어 ? '/think 자세히' : '/think detail';
  say('');
  say(`  ${c.gray(말('think.effort'))}  ${c.bold(session.think)}   ${c.gray(`(${단계})`)}`);
  /*
   * ── 정한 값과 **실제로 나가는 값**을 같이 보여 준다 ──────────────────
   *
   * 여기가 여태 비어 있던 자리다. `/think max` 를 쳐도 전선이 max 를 안
   * 받으면 high 가 나갔고, 화면에는 그 사실이 어디에도 없었다. 사람은
   * 세게 생각하라고 시켰다고 믿는다.
   *
   * 자동 조절도 같이 적는다. 정한 값이 천장이 되므로, 「max 라고 했는데 왜
   * medium 인가」 에 답할 수 있어야 한다.
   */
  /*
   * 자동 조절이 **실제로 무언가를 바꿀 때만** 적는다.
   *
   * `/think low` 로 정해 둔 사람에게 「가벼운 말은 low 까지 낮춰 씁니다」 는
   * 아무 말도 아니다 — 이미 low 다. 아무 일도 안 하는 줄을 화면에 남기면
   * 사람은 그 줄을 읽는 데 시간을 쓰고 아무것도 얻지 못한다.
   */
  if (session.autoThink !== false) {
    const 가장낮게 = 가벼운강도(session.think);
    if (가장낮게 !== session.think) {
      say(`  ${c.gray(pad(말('think.auto'), 한국어 ? 8 : 10))}${c.gray(말('think.autoNote', { 천장: session.think, 지금: 가장낮게 }))}`);
    }
  }
  if (session.conn?.전선) {
    const 카드 = session.conn.전선;
    /*
     * **정말로 나가는 것만** 적는다.
     *
     * 여태 여기서 `눈금맞추기()` 를 직접 불렀다. 그 함수는 카드가 아는 눈금으로
     * 낮추는 일만 하고 그 눈금이 실릴 칸이 있는지는 모른다 — 그래서 눈금이
     * 아예 안 나가는 전선(budget·boolean·none)에서도 「지금 나가는 값 high」
     * 가 떴다. 몸을 만드는 자리와 같은 함수를 쓴다(backend/adapter.js).
     */
    const 나가는것 = 나가는눈금(session.conn.kind, 카드, session.think);
    /*
     * ── 「끈다」 가 정말로 꺼지는 창구인가 ────────────────────────────
     *
     * off 인데 나갈 말이 없으면 두 가지 중 하나다.
     *
     *   a. 이 규격에서는 **칸을 안 싣는 것이 곧 끄는 것**이다.
     *      anthropic 은 thinking 을 빼면 안 생각하고, ollama 는 think:false
     *      를 싣는다. 이쪽은 아무 말도 안 해도 된다.
     *   b. 이 규격에서는 칸을 안 실으면 **서버 기본값**으로 돈다. openai 꼴의
     *      추론 모델이 그렇다 — reasoning_effort 를 빼면 서버가 제 기본값
     *      (보통 medium)으로 생각한다. 여기서 아무 말도 안 하면 화면은 off
     *      라고 적어 두고 실제로는 생각이 도는 셈이 된다.
     *
     * b 를 잠자코 두면 화면이 거짓말을 한다. 창구가 끄는 말을 알려 준 적이
     * 없으면 우리는 못 끈다 — 못 끄면 못 끈다고 적는다.
     */
    const 못끄나 = session.think === 'off' && !나가는것 && 카드.생각형식 === 'effort';
    say(`  ${c.gray(pad(말('think.wire'), 한국어 ? 8 : 10))}${c.gray(전선말(카드))}`
      + (나가는것 ? `   ${c.gray(말('think.wireSends', { 값: 나가는것 }))}` : '')
      + (못끄나 ? `   ${c.yellow(말('think.wireNoOff'))}` : ''));
  }
  if (개발자 || 자세히) say(`  ${c.gray(pad(말('think.profile'), 한국어 ? 8 : 10))}${c.bold(t.name)}   ${c.gray(t.desc)}`);

  if (자세히) {
    say('');
    say(`  ${c.gray(pad(말('think.col.stage'), 12) + pad(말('think.col.level'), 10) + pad(말('think.col.cap'), 10) + 말('think.col.when'))}`);
    for (const r of t.rows) {
      const 화살 = r.moved > 0 ? c.yellow('↑') : r.moved < 0 ? c.cyan('↓') : c.gray('·');
      say(`  ${pad(r.label, 12)}${화살} ${pad(r.level, 8)}${pad(r.cap.toLocaleString(), 10, 'right')}  ${c.gray(r.why)}`);
    }
    say('');
    // 상한이 어디서 왔는지 밝힌다. 세 줄이 같은 값일 때 그게 고장인지 아닌지
    // 이 한 줄로 갈린다 — 아는 상한이 낮으면 셋이 같아지는 것이 맞다.
    const 어디서 = session.conn.maxTokens ? 말('think.cap.you')
      : session.conn.maxOut ? 말('think.cap.server') : 말('think.cap.guess');
    say(`  ${c.gray(말('think.cap.head'))} ${c.white((아는상한 ?? 16384).toLocaleString())} ${c.gray(어디서)}${c.gray(말('think.cap.tail'))} ${c.cyan('/out')}`);
    say(`  ${c.gray(말('think.ctx'))} ${c.white(t.ctx.toLocaleString())}${c.gray(말('think.ctx.used'))}${c.white(t.used.toLocaleString())}`);
    say('');
    say(`  ${c.gray(말('think.effort'))}  ${THINK_LEVELS.join(' · ')}   ${c.gray(말('think.eg'))} ${c.cyan('/think high')}`);
    say(`  ${c.gray(말('think.profile'))}  ${Object.entries(PROFILES).map(([k, v]) => { const n = 한국어 ? v.name : (v.en ?? v.name); return n === k ? k : `${k}(${n})`; }).join(' · ')}   ${c.gray(말('think.eg'))} ${c.cyan(배분예)}`);
  } else if (개발자) {
    say(`  ${c.gray(말('think.effort'))} ${c.cyan('/think high')}   ${c.gray(말('think.profile'))} ${c.cyan(배분예)}   ${c.gray(말('think.detail'))} ${c.cyan(자세히예)}`);
  } else {
    /*
     * 다음 칸을 **지금 값에서** 셈한다.
     *
     * 여태 이 두 자리는 high · low 로 박혀 있었다. 눈금이 넷일 때는 그럭저럭
     * 맞았는데 xhigh 가 늘면서 티가 났다 — max 로 쓰고 있는 사람에게
     * 「더 세게 → /think high」 라고 적어 준다. high 는 지금보다 **약하다.**
     *
     * 끝에 서 있으면 그쪽은 아예 안 적는다. 갈 데가 없는 길을 적어 주는 것은
     * 없는 기능을 알려 주는 것과 같다.
     */
    const 위 = shiftLevel(session.think, 1);
    const 아래 = shiftLevel(session.think, -1);
    const 조각 = [];
    if (위 !== session.think) 조각.push(`${c.gray(말('think.harder'))} ${c.cyan(`/think ${위}`)}`);
    if (아래 !== session.think && 아래 !== 'off') 조각.push(`${c.gray(말('think.faster'))} ${c.cyan(`/think ${아래}`)}`);
    if (조각.length) say(`  ${조각.join('   ')}`);
  }

  if (!session.conn.think && session.think !== 'off') {
    say(`  ${c.yellow(말('think.nomodel'))} ${c.gray(말('think.nomodel.note'))}`);
  }
  say('');
}

export function showContext(session) {
  const b = session.breakdown();
  say('');
  rule(말('scr.context'), 70);
  say(`  ${c.bold(session.conn.model)} ${c.gray('·')} ${말('unit.tokens', { n: b.total.toLocaleString() })}`);
  say('');
  say(`  ${bar(b.used, b.total, 32)}  ${b.used.toLocaleString()} / ${b.total.toLocaleString()}  ${c.gray(`${Math.round((b.used / b.total) * 100)}%`)}`);
  say('');
  for (const r of b.rows) {
    if (!r.n) continue;
    say(`  ${c.gray(pad(r.label, 26))} ${pad(r.n.toLocaleString(), 8, 'right')}`);
  }
  say(`  ${c.gray('─'.repeat(35))}`);
  say(`  ${c.gray(pad(말('ctx.left'), 26))} ${pad(b.left.toLocaleString(), 8, 'right')}`);
  say('');
  say(`  ${c.gray(`/compact ${말('ctx.compactHint')}   /clear ${말('ctx.clearHint')}`)}`);
  /*
   * 추정이라고만 적어 두면 사람은 얼마나 믿어야 할지 모른다. 서버가 알려 준
   * 실제값에 맞춰 가고 있으면 그 사실을 적는다 — '추정' 과 '맞춰 본 추정' 은
   * 믿을 만한 정도가 다르다.
   */
  if (b.보정잰것 > 0) {
    const 차이 = Math.round((b.보정 - 1) * 100);
    say(`  ${c.gray(말('ctx.calibrated', { 부호: 차이 >= 0 ? '+' : '', 퍼센트: 차이, 번: b.보정잰것 }))}`);
  } else {
    say(`  ${c.gray(말('ctx.estimate'))}`);
  }
  /*
   * 재 봤는데 **못 믿어서 안 쓴** 것도 말한다.
   *
   * session.배운다() 는 서버가 알려 준 값이 우리 추정의 절반 아래거나 두 배
   * 위면 표본을 버린다. 튄 값 하나에 게이지가 휘둘리면 안 되니 버리는 것은
   * 맞다. 그런데 버린 것을 아무 데도 안 남기면, 「아직 한 번도 못 재 봤다」 와
   * 「재 봤는데 세 배가 나와서 못 믿었다」 가 화면에서 똑같아진다.
   *
   * 뒤엣것은 우리 추정이 크게 틀렸다는 단서다. 그 말을 안 하면 게이지는 영영
   * 짐작인 채로 도는데 사람은 그저 「추정입니다」 만 읽는다.
   */
  if (session?.보정버림 > 0) {
    const 배 = session.보정마지막버린비율;
    say(`  ${c.gray(`서버가 알려 준 값이 우리 추정과 너무 달라 ${session.보정버림}번은 안 썼습니다`
      + (배 ? ` (마지막에 잰 것은 추정의 ${배.toFixed(1)}배)` : ''))}`);
    say(`  ${c.gray('이 창구에서는 위 숫자가 실제와 크게 다를 수 있습니다.')}`);
  }
  say('');
}

// /work 를 인자 없이 부르면 지금 모드와 고를 수 있는 것들을 보여 준다.
export function showWork(session) {
  rule(말('work.title'), 70);
  /*
   * 이름 칸을 **제일 긴 이름에 맞춰** 잡는다.
   *
   * 8칸으로 못 박아 뒀더니 Orchestrator(12자)가 칸을 넘어 다음 칸을 밀었다.
   * 화면에 `OrchestratorOrchestrator` 라고 붙어 나왔다 — 사진을 찍어 보고서야
   * 알았다. 목록의 값은 칸이 맞아야 목록이다.
   */
  const 이름들 = WORK_ORDER.map((k) => 보일이름(WORK_MODES[k].id));
  const 칸너비 = Math.max(...이름들.map((n) => width(n))) + 2;
  // 영어 화면에서는 이름과 영문 이름이 같은 글자다. 같은 것을 두 번 적지 않는다.
  const 영문칸 = 언어() === 'en' ? 0 : 14;

  for (const k of WORK_ORDER) {
    const w = WORK_MODES[k];
    const 지금 = k === (normWork(session.work) ?? WORK_DEFAULT);
    const 표 = 지금 ? c.hgreen('●') : c.gray('·');
    const 보임 = pad(보일이름(w.id), 칸너비);
    const 이름 = 지금 ? c.bold(c.white(보임)) : c.gray(보임);
    say(`  ${표} ${c.hcyan(w.glyph)} ${이름}${영문칸 ? c.gray(pad(w.en, 영문칸)) : ''}${c.gray(보일한줄(w.id))}`);
    const 강도 = `${w.think ?? '—'}·${w.effort}`;
    const 걸음 = 말('work.steps', { n: 걸음수(k, session.conn?.ctx) });
    say(`        ${canWrite(k) ? c.gray(말('work.canEdit')) : c.green(말('work.readOnly'))}`
      + `${c.gray(`  ·  ${말('work.think')} ${강도}  ·  ${걸음}`)}`);
  }
  say('');
  say(`  ${c.gray(말('work.howTo', { a: c.cyan('/plan'), b: c.cyan('/code'), c: c.cyan('/debug'), 키: c.cyan('Ctrl+O') }))}`);
  say(`  ${c.gray(말('work.axis', { 명령: c.cyan('/mode') }))}`);
  say('');
}
