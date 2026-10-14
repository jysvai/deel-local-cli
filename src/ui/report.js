// 세션 보고서 — `/report` 와 끝낼 때.
//
// ── 사람 말 ─────────────────────────────────────────────────────────────
//
//   「exit 하거나 /report 라는 그런 기능 넣어서 세션 동안 도구가 호출한 기록들이랑 비용 컨텍스트
//    정리해서 볼 수 있는 기능」
//   「세션에도 보여주고 md 혹은 js 둘중 하나 더 가벼운걸로 해서 문자/숫자로도 보여주면」
//   「있는 기능들이 있으면 한쪽 슬래시 기능으로 모을 수 있으면 모으는 것도 좋아보여」
//
// 숫자는 이미 여기저기 있었다 — 돈·토큰은 /cost, 자리는 /context, 바뀐 파일은 /diff. 그런데 「이번 세션에
// 무엇을 했나」 를 보려면 셋을 차례로 쳐야 했고, 도구를 몇 번 · 무엇에 · 얼마나 오래 불렀는지는 어디에도
// 안 남았다(감사기록은 폴더 전체가 섞이고 걸린 시간이 없다). 그래서 한 자리에 모은다. 옛 명령은 그대로
// 둔다 — 하나만 보고 싶을 때는 그쪽이 짧다.
//
// 화면과 파일이 **같은 자료**에서 나온다(세션보고서모으기 → 세션보고서줄들 · 세션보고서md). 따로 셈하면 언젠가 둘이
// 다른 숫자를 말한다. 파일은 Markdown 이다 — 글자 그대로 읽히고, 어느 편집기·저장소 화면에서나 표로 보인다.
//
// 지어내지 않는다. 창구가 안 알려 준 토큰은 「≈」 를 붙인 어림이고(ui/tokcount.js), 요금표가 없으면 금액
// 칸은 「모름」 이다(backend/price.js). 디스크에 남는 도구 대상은 감사기록과 같은 자로 가린다.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { c, pad, clip } from './ansi.js';
import { 토큰셈, 토큰글 } from './tokcount.js';
import { 세션요금, 돈셈, 돈말, 어디서온값 } from '../backend/price.js';
import { 생성속도 } from '../agent/session.js';
import { 말 } from '../i18n/index.js';

/** 보고서에 담는 도구 기록의 상한. 넘으면 오래된 것부터 버리고 버린 수를 센다. */
export const 기록상한 = 5000;

/**
 * 도구 한 번을 세션에 적는다. 대화 화면이 도구 결과를 받는 자리(repl.js 의 case 'tool')에서 부른다.
 *
 * @param {object} session
 * @param {{이름: string, 대상?: string|null, ok: boolean, ms?: number, 오류?: string|null, 때?: number}} 것
 */
export function 도구적기(session, 것) {
  if (!session) return;
  const 기록 = (session.도구기록 ??= []);
  기록.push({
    때: 것.때 ?? Date.now(),
    이름: String(것.이름 ?? '?'),
    대상: 것.대상 == null ? null : String(것.대상).replace(/\s+/g, ' ').slice(0, 160),
    ok: 것.ok !== false,
    ms: Math.max(0, Number(것.ms) || 0),
    오류: 것.오류 == null ? null : String(것.오류).replace(/\s+/g, ' ').slice(0, 160),
  });
  if (기록.length > 기록상한) {
    const 넘친 = 기록.length - 기록상한;
    기록.splice(0, 넘친);
    session.도구기록버림 = (session.도구기록버림 ?? 0) + 넘친;
  }
  /*
   * 이름별 셈은 기록과 따로 쌓는다. 기록은 상한에서 오래된 것을 버리는데, 셈까지 남은 기록에서 내면
   * 5,050번 부른 세션이 「5,000번」 으로 적히고 버린 쉰 번의 실패도 사라진다.
   */
  const 셈 = (session.도구셈 ??= {});
  const 칸 = (셈[기록.at(-1).이름] ??= { 수: 0, 실패: 0, ms: 0 });
  칸.수 += 1;
  if (!기록.at(-1).ok) 칸.실패 += 1;
  칸.ms += 기록.at(-1).ms;
}

/** 주소에서 열쇠가 섞일 수 있는 자리(아이디·비밀번호·물음)를 떼고 보인다. */
function 주소만(base) {
  const 글 = String(base ?? '');
  try {
    const u = new URL(글);
    if (u.host) return `${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch { /* 아래에서 손으로 뗀다 */ }
  /*
   * 틀(http://)이 없는 주소도 아이디:비밀번호@ · 물음 · # 은 뗀다. `admin:pw@10.0.0.1:8080` 은 URL 이 「admin:」
   * 을 틀로 읽어 host 없이 통과시킨다 — 그대로 길을 적으면 비밀번호가 보고서에 남는다.
   */
  return 글.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^/@]*@/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
}

/**
 * 보고서에 들어갈 것을 모은다. 화면과 파일이 둘 다 이것을 읽는다.
 *
 * @param {{session: object, ctx?: object, root?: string, 이제?: number}} o
 */
export function 세션보고서모으기({ session, ctx = null, root = '', 이제 = Date.now() }) {
  const u = session?.usage ?? {};
  const 갈래셈 = ctx?.갈래?.갈래여럿인가?.() ? ctx.갈래.전체usage() : null;
  // 갈래를 여럿 굴렸으면 전부의 합이 이 세션의 값이다 (commands.js /cost 의 갈래 머리말).
  const 쓴것 = 갈래셈 ?? u;
  const 셈 = 토큰셈(쓴것);

  let 돈 = null;
  try {
    const 요금값 = 세션요금(session);
    const 쓴돈 = 돈셈(쓴것, 요금값);
    if (쓴돈) 돈 = { 달러: 쓴돈.달러, 위쪽: !!쓴돈.캐시모름, 출처: 어디서온값(요금값) };
  } catch { 돈 = null; }

  let 맥락 = null;
  try {
    const b = session.breakdown();
    맥락 = {
      쓴: b.used, 전체: b.total, 남은: b.left,
      몫: b.total ? Math.round((b.used / b.total) * 100) : 0,
      칸: (b.rows ?? []).filter((r) => r.n > 0).sort((a, b2) => b2.n - a.n).slice(0, 6).map((r) => ({ 이름: r.label, n: r.n })),
      맞춰봄: (b.보정잰것 ?? 0) > 0,
    };
  } catch { 맥락 = null; }

  const 기록 = [...(session?.도구기록 ?? [])];
  // 도구적기 가 따로 쌓은 셈이 있으면 그것이 참이다(기록은 상한에서 잘린다). 없으면(옛 세션) 기록에서 낸다.
  const 이름별 = new Map(Object.entries(session?.도구셈 ?? {}).map(([이름, v]) => [이름, { 이름, ...v }]));
  if (!이름별.size) {
    for (const r of 기록) {
      const 칸 = 이름별.get(r.이름) ?? { 이름: r.이름, 수: 0, 실패: 0, ms: 0 };
      칸.수 += 1;
      if (!r.ok) 칸.실패 += 1;
      칸.ms += r.ms;
      이름별.set(r.이름, 칸);
    }
  }
  const 모두 = [...이름별.values()];

  const 바뀐 = [...(session?.changes?.entries?.() ?? [])].map(([p, v]) => ({
    경로: ctx?.scope?.show?.(p) ?? p, 더함: v?.added ?? 0, 뺌: v?.removed ?? 0, 번: v?.times ?? 1,
  }));

  return {
    시작: session?.startedAt ?? 이제,
    끝: 이제,
    분: Math.max(0, (이제 - (session?.startedAt ?? 이제)) / 60000),
    모델: session?.conn?.model ?? '?',
    주소: 주소만(session?.conn?.base),
    폴더: root,
    토큰: {
      ...셈,
      호출: 쓴것.calls ?? 0,
      못잰것: 쓴것.못잰것 ?? 0,
      다시: 쓴것.retries ?? 0,
      캐시읽기: 쓴것.cacheRead ?? 0,
      캐시쓰기: 쓴것.cacheWrite ?? 0,
      생각: 쓴것.reasoning ?? 0,
      속도: 생성속도(쓴것),
      갈래여럿: !!갈래셈,
    },
    돈,
    맥락,
    도구: {
      수: 모두.reduce((n, k) => n + k.수, 0),
      버림: session?.도구기록버림 ?? 0,
      실패: 모두.reduce((n, k) => n + k.실패, 0),
      ms: 쓴것.ms ?? 0,
      이름별: 모두.sort((a, b) => b.수 - a.수 || b.ms - a.ms),
      기록,
    },
    바뀐: {
      파일: 바뀐,
      더함: 바뀐.reduce((n, f) => n + f.더함, 0),
      뺌: 바뀐.reduce((n, f) => n + f.뺌, 0),
    },
  };
}

const 두자리 = (n) => String(n).padStart(2, '0');
const 시각 = (ms) => { const d = new Date(ms); return `${두자리(d.getHours())}:${두자리(d.getMinutes())}:${두자리(d.getSeconds())}`; };
const 날짜시각 = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${두자리(d.getMonth() + 1)}-${두자리(d.getDate())} ${두자리(d.getHours())}:${두자리(d.getMinutes())}`; };
const 초글 = (ms) => 말('unit.sec', { n: (ms / 1000).toFixed(1) });
const 수글 = (n) => Number(n || 0).toLocaleString();

/**
 * 화면에 찍을 줄들. 색이 들어 있다 — 그대로 say 하면 된다.
 *
 * 도구 기록은 끝의 몇 개만 보인다(`최근`). 전부는 파일에 있다 — 화면에 백 줄을 쏟으면 위의 숫자가 밀려
 * 올라가 안 보인다.
 */
export function 세션보고서줄들(자, { 최근 = 12 } = {}) {
  const 줄 = [];
  const 칸 = (이름, 값) => 줄.push(`  ${c.gray(pad(이름, 14))} ${값}`);
  const 머리 = (글) => { 줄.push(''); 줄.push(`  ${c.bold(글)}`); };

  칸(말('report.model'), `${c.white(자.모델)} ${c.gray(`· ${자.주소}`)}`);
  칸(말('report.when'), `${날짜시각(자.시작)} ${c.gray(`· ${말('unit.min', { n: 자.분.toFixed(1) })}`)}`);

  const t = 자.토큰;
  머리(말('report.tokens'));
  칸(말('cost.calls'), 말('unit.calls', { n: t.호출 }) + (t.다시 ? c.gray(` · ${말('report.retried', { n: t.다시 })}`) : ''));
  칸(말('cost.tokIn'), 토큰글(t.입력, t.추정));
  칸(말('cost.tokOut'), 토큰글(t.출력, t.추정));
  if (t.못잰것) 줄.push(`  ${c.gray(pad('', 14))} ${c.yellow(말('cost.estNote', { n: t.못잰것 }))}`);
  if (t.캐시읽기 || t.캐시쓰기) 칸(말('report.cache'), 말('report.cacheLine', { 읽기: 수글(t.캐시읽기), 쓰기: 수글(t.캐시쓰기) }));
  if (t.생각) 칸(말('cost.think'), 수글(t.생각));
  if (t.속도 !== null && t.속도 !== undefined) 칸(말('cost.speed'), `${t.속도} tok/s`);
  칸(말('cost.money'), 자.돈
    ? `${c.bold(돈말(자.돈.달러))}${자.돈.위쪽 ? c.gray(` ${말('report.atMost')}`) : ''} ${c.gray(`(${자.돈.출처})`)}`
    : c.gray(말('report.moneyUnknown')));
  if (t.갈래여럿) 줄.push(`  ${c.gray(pad('', 14))} ${c.gray(말('report.allThreads'))}`);

  if (자.맥락) {
    const m = 자.맥락;
    머리(말('report.context'));
    칸(말('report.used'), `${m.몫}% ${c.gray(`(${수글(m.쓴)} / ${수글(m.전체)})`)}${m.맞춰봄 ? '' : c.gray(` · ${말('report.ctxEstimate')}`)}`);
    for (const r of m.칸) 줄.push(`  ${c.gray(pad('', 14))} ${c.gray(pad(clip(r.이름, 24), 24))} ${pad(수글(r.n), 9, 'right')}`);
  }

  const d = 자.도구;
  머리(말('report.tools'));
  칸(말('report.toolCalls'), `${말('unit.calls', { n: d.수 })}${d.실패 ? c.yellow(` · ${말('report.failed', { n: d.실패 })}`) : ''} ${c.gray(`· ${초글(d.ms)}`)}`);
  if (!d.수) 줄.push(`  ${c.gray(pad('', 14))} ${c.gray(말('report.noTools'))}`);
  for (const k of d.이름별) {
    줄.push(`  ${c.gray(pad('', 14))} ${c.white(pad(clip(k.이름, 16), 16))} ${pad(말('unit.calls', { n: k.수 }), 7, 'right')}  ${c.gray(pad(초글(k.ms), 8, 'right'))}`
      + (k.실패 ? `  ${c.yellow(말('report.failed', { n: k.실패 }))}` : ''));
  }
  if (d.기록.length) {
    머리(말('report.recent', { n: Math.min(최근, d.기록.length), 전체: d.기록.length }));
    for (const r of d.기록.slice(-최근)) {
      const 표 = r.ok ? c.green('✓') : c.red('✗');
      const 대상 = r.대상 ? c.gray(clip(r.대상, 46)) : '';
      줄.push(`  ${c.gray(시각(r.때))} ${표} ${c.white(pad(clip(r.이름, 12), 12))} ${pad(대상, 46)} ${c.gray(pad(초글(r.ms), 7, 'right'))}`);
    }
  }

  const b = 자.바뀐;
  머리(말('report.changes'));
  if (!b.파일.length) {
    줄.push(`  ${c.gray(말('report.noChanges'))}`);
  } else {
    for (const f of b.파일.slice(0, 10)) {
      줄.push(`  ${pad(clip(f.경로, 46), 46)} ${c.hgreen(pad(`+${f.더함}`, 6, 'right'))} ${c.hred(pad(`−${f.뺌}`, 6, 'right'))}`);
    }
    if (b.파일.length > 10) 줄.push(`  ${c.gray(말('report.moreFiles', { n: b.파일.length - 10 }))}`);
    줄.push(`  ${c.gray(`${말('report.filesTotal', { n: b.파일.length })} · +${b.더함} −${b.뺌}`)}`);
  }
  return 줄;
}

/** Markdown 표 칸에 넣을 글 — 세로줄과 줄바꿈이 표를 깨지 않게. */
/*
 * 표 칸에 넣을 글. 세로줄은 역빗금으로 막는데, 글에 이미 역빗금이 붙어 있으면(`grep "a\|b"`) 그 역빗금이 우리
 * 역빗금을 먹어 세로줄이 다시 살아나 표가 깨진다. 세로줄 앞 역빗금은 겹쳐 적고 하나를 더 붙인다.
 */
const 칸글 = (s) => String(s ?? '')
  .replace(/(\\*)\|/g, (_, 앞) => `${앞}${앞}\\|`)
  .replace(/[\r\n]+/g, ' ').replace(/`/g, 'ˋ');

/**
 * 파일로 남길 Markdown. 도구 기록은 **전부** 싣는다.
 *
 * @param {object} 자 세션보고서모으기 가 낸 것
 * @param {{가리개?: (s: string) => string}} o 디스크에 남기 전에 대상·오류를 가린다 (safety/audit.js 의 가림)
 */
export function 세션보고서md(자, { 가리개 = (s) => s } = {}) {
  const 가려 = (s) => (s == null ? '' : 가리개(String(s)) ?? '');
  const t = 자.토큰;
  const 줄 = [];
  줄.push(`# ${말('report.title')}`);
  줄.push('');
  // 모델 이름 · 주소도 가린다 — 사내 창구는 길에 열쇠를 싣기도 한다(`/keys/sk-…/v1`).
  줄.push(`- ${말('report.model')}: \`${칸글(가려(자.모델))}\` · ${칸글(가려(자.주소))}`);
  줄.push(`- ${말('report.when')}: ${날짜시각(자.시작)} ~ ${날짜시각(자.끝)} (${말('unit.min', { n: 자.분.toFixed(1) })})`);
  if (자.폴더) 줄.push(`- ${말('report.folder')}: \`${칸글(가려(자.폴더))}\``);
  줄.push('');

  줄.push(`## ${말('report.tokens')}`);
  줄.push('');
  줄.push(`| ${말('report.col.item')} | ${말('report.col.value')} |`);
  줄.push('|---|---:|');
  줄.push(`| ${말('cost.calls')} | ${t.호출} |`);
  if (t.다시) 줄.push(`| ${말('cost.retries')} | ${t.다시} |`);
  줄.push(`| ${말('cost.tokIn')} | ${토큰글(t.입력, t.추정)} |`);
  줄.push(`| ${말('cost.tokOut')} | ${토큰글(t.출력, t.추정)} |`);
  if (t.추정) 줄.push(`| ${말('report.measured')} | ↑${수글(t.잰입력)} ↓${수글(t.잰출력)} |`);
  if (t.캐시읽기 || t.캐시쓰기) 줄.push(`| ${말('report.cache')} | ${말('report.cacheLine', { 읽기: 수글(t.캐시읽기), 쓰기: 수글(t.캐시쓰기) })} |`);
  if (t.생각) 줄.push(`| ${말('cost.think')} | ${수글(t.생각)} |`);
  if (t.속도 !== null && t.속도 !== undefined) 줄.push(`| ${말('cost.speed')} | ${t.속도} tok/s |`);
  줄.push(`| ${말('cost.toolMs')} | ${초글(자.도구.ms)} |`);
  줄.push(`| ${말('cost.money')} | ${자.돈 ? `${칸글(돈말(자.돈.달러))}${자.돈.위쪽 ? ` ${말('report.atMost')}` : ''} (${칸글(자.돈.출처)})` : 말('report.moneyUnknown')} |`);
  if (t.못잰것) { 줄.push(''); 줄.push(`> ${말('cost.estNote', { n: t.못잰것 })}`); }
  if (t.갈래여럿) { 줄.push(''); 줄.push(`> ${말('report.allThreads')}`); }
  줄.push('');

  if (자.맥락) {
    const m = 자.맥락;
    줄.push(`## ${말('report.context')}`);
    줄.push('');
    줄.push(`${말('report.used')}: **${m.몫}%** (${수글(m.쓴)} / ${수글(m.전체)})${m.맞춰봄 ? '' : ` — ${말('report.ctxEstimate')}`}`);
    줄.push('');
    if (m.칸.length) {
      줄.push(`| ${말('report.col.part')} | ${말('report.col.tokens')} |`);
      줄.push('|---|---:|');
      for (const r of m.칸) 줄.push(`| ${칸글(r.이름)} | ${수글(r.n)} |`);
      줄.push('');
    }
  }

  const d = 자.도구;
  줄.push(`## ${말('report.tools')}`);
  줄.push('');
  줄.push(`${말('unit.calls', { n: d.수 })}${d.실패 ? ` · ${말('report.failed', { n: d.실패 })}` : ''} · ${초글(d.ms)}`);
  if (d.버림) 줄.push(`\n> ${말('report.dropped', { n: d.버림 })}`);
  줄.push('');
  if (d.이름별.length) {
    줄.push(`| ${말('report.col.tool')} | ${말('report.col.count')} | ${말('report.col.fail')} | ${말('report.col.time')} |`);
    줄.push('|---|---:|---:|---:|');
    for (const k of d.이름별) 줄.push(`| ${칸글(k.이름)} | ${k.수} | ${k.실패} | ${(k.ms / 1000).toFixed(1)}s |`);
    줄.push('');
    줄.push(`### ${말('report.allCalls')}`);
    줄.push('');
    줄.push(`| # | ${말('report.col.when')} | ${말('report.col.tool')} | ${말('report.col.target')} | ${말('report.col.result')} | ${말('report.col.time')} |`);
    줄.push('|---:|---|---|---|---|---:|');
    d.기록.forEach((r, i) => {
      const 결과 = r.ok ? '✓' : `✗ ${칸글(clip(가려(r.오류 ?? ''), 80))}`;
      줄.push(`| ${i + 1 + d.버림} | ${시각(r.때)} | ${칸글(r.이름)} | ${r.대상 ? `\`${칸글(가려(r.대상))}\`` : ''} | ${결과} | ${(r.ms / 1000).toFixed(1)}s |`);
    });
  } else {
    줄.push(말('report.noTools'));
  }
  줄.push('');

  const b = 자.바뀐;
  줄.push(`## ${말('report.changes')}`);
  줄.push('');
  if (!b.파일.length) {
    줄.push(말('report.noChanges'));
  } else {
    줄.push(`| ${말('report.col.file')} | + | − | ${말('report.col.times')} |`);
    줄.push('|---|---:|---:|---:|');
    for (const f of b.파일) 줄.push(`| \`${칸글(가려(f.경로))}\` | ${f.더함} | ${f.뺌} | ${f.번} |`);
    줄.push('');
    줄.push(`${말('report.filesTotal', { n: b.파일.length })} · +${b.더함} −${b.뺌}`);
  }
  줄.push('');
  줄.push(`<sub>deel · ${날짜시각(자.끝)}</sub>`);
  줄.push('');
  return 줄.join('\n');
}

/**
 * `.deel/reports/` 에 남긴다. 감사기록(`.deel/audit.jsonl`)과 같은 집이다 — 작업 폴더를 어지르지 않는다.
 *
 * 이름은 **세션이 시작한 때**다. 한 세션에 파일 하나 — `/report` 를 몇 번 치든, 끝낼 때 또 남기든 같은 파일을
 * 최신 것으로 덮는다. 부를 때마다 새 파일이면 한 세션에 반쯤 찬 보고서가 여러 장 쌓여 정작 마지막 것을 못 찾는다.
 *
 * @param {number} 시작 세션이 시작한 때 (보고서모으기 의 `시작`)
 * @returns {string} 쓴 파일의 절대 경로
 */
export function 세션보고서적기(root, md, 시작 = Date.now()) {
  const d = new Date(시작);
  const 이름 = `deel-report-${d.getFullYear()}${두자리(d.getMonth() + 1)}${두자리(d.getDate())}`
    + `-${두자리(d.getHours())}${두자리(d.getMinutes())}${두자리(d.getSeconds())}.md`;
  const 방 = join(root, '.deel', 'reports');
  mkdirSync(방, { recursive: true });
  const 길 = join(방, 이름);
  writeFileSync(길, md, 'utf8');
  return 길;
}

// 검사가 쓴다 — 표 칸 이스케이프가 표를 안 깨는지.
export const _칸글 = 칸글;
