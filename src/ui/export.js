/**
 * 대화 → 보고서 한 장 (/export).
 *
 * ── 왜 링크가 아니라 파일인가 ───────────────────────────────────────────
 *
 * 요즘 CLI 는 세션을 링크로 공유한다. 링크는 서버가 있어야 산다 — 이 프로그램이
 * 도는 자리(폐쇄망)에는 그 서버가 없고, 있어도 소스가 그리로 나가면 안 된다.
 *
 * 이 자리의 공유는 원래 파일이다. 결재는 첨부로 돌고, 보고는 한 장으로 한다.
 * 그래서 대화를 **자기완결 HTML 한 장**으로 접는다 — 무엇을 시켰고, 무엇이
 * 바뀌었고, 무엇으로 확인했나. 바깥 주소가 하나도 없어서 어느 망에서든 열린다.
 *
 * ── 지키는 선 ───────────────────────────────────────────────────────────
 *
 * 1. **대화가 코드가 되지 않는다.** 대화에는 <script> 같은 글자가 흔히 든다
 *    (코드를 다루는 프로그램이니까). 이스케이프를 한 자리라도 빠뜨리면
 *    보고서를 여는 순간 그 코드가 돈다 — 보고서가 공격 통로가 된다.
 * 2. **증거의 정직함을 그대로 옮긴다.** '증명 안 된 것' 절이 이 보고서의
 *    요점이다. 그 절을 빼고 초록만 남기면 보고서가 아니라 홍보물이다.
 * 3. **화면 말을 따라간다.** /lang en 이면 보고서도 영어로 나간다 —
 *    보고서는 남에게 가는 글이라, 화면보다도 이쪽이 먼저다.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { 증거모으기 } from '../agent/evidence.js';
import { 말, 언어 } from '../i18n/index.js';

/** HTML 로 안전하게. 문서 전체가 이 함수 하나를 지나야 한다. */
function 글자(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** ANSI 제어문자 걷어내기. 도구 결과에는 색이 섞여 있을 수 있다. */
const 민글 = (s) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '');

/** 도구 호출 한 줄 요약. 보고서는 기록이지 재현이 아니다 — 인자 전체를 안 싣는다. */
function 도구줄(tc) {
  const 이름 = tc?.function?.name ?? tc?.name ?? '?';
  let 핵심 = '';
  try {
    const a = JSON.parse(tc?.function?.arguments ?? '{}');
    핵심 = a.file_path ?? a.pattern ?? a.command ?? a.name ?? a.purpose ?? a.목적 ?? '';
  } catch { /* 인자가 잘렸어도 이름은 보여 준다 */ }
  핵심 = String(핵심);
  if (핵심.length > 80) 핵심 = 핵심.slice(0, 80) + '…';
  return 핵심 ? `${이름}(${핵심})` : 이름;
}

/**
 * 보고서 HTML 을 짓는다.
 *
 * @param session Session — messages·changes·usage·conn 을 읽는다. 안 바꾼다.
 * @param {object} o
 * @param {{show:(p:string)=>string}} [o.scope]  경로를 짧게 보일 때
 * @param {object} [o.audit]  증거를 모을 감사기록 (없으면 증거 절이 얕아진다)
 */
export function 보고서짓기(session, { scope = null, audit = null } = {}) {
  const 보임 = (p) => { try { return scope?.show ? scope.show(p) : String(p); } catch { return String(p); } };

  // ── 재료 ──────────────────────────────────────────────────────────────
  const 첫말 = (session.messages ?? []).find((m) => m.role === 'user')?.content;
  const 제목 = String(첫말 ?? 말('export.untitled')).split('\n')[0].slice(0, 80);

  const 흐름 = [];
  for (const m of session.messages ?? []) {
    if (m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
      흐름.push({ 갈래: 'user', 글: m.content });
    } else if (m.role === 'assistant') {
      const 부른것 = (m.tool_calls ?? []).map(도구줄);
      if (부른것.length) 흐름.push({ 갈래: 'tools', 글: 부른것.join(' · ') });
      if (typeof m.content === 'string' && m.content.trim()) 흐름.push({ 갈래: 'assistant', 글: m.content });
    }
    // tool 결과는 안 싣는다 — 길고, 요점은 답과 증거 절에 이미 있다.
  }

  const 바뀐것 = [...(session.changes ?? new Map()).entries()]
    .map(([p, v]) => ({ 파일: 보임(p), 더함: v.added ?? 0, 뺌: v.removed ?? 0, 몇번: v.times ?? 1 }));

  const 증거 = (() => {
    try { return 증거모으기(session, { audit }); } catch { return null; }
  })();

  const u = session.usage ?? {};
  const 쓴것 = [
    session.conn?.model ? `${말('export.model')}: ${session.conn.model}` : '',
    Number.isFinite(u.in) ? `↑${(u.in ?? 0).toLocaleString()} ↓${(u.out ?? 0).toLocaleString()}` : '',
    u.calls ? `${말('export.calls', { 수: u.calls })}` : '',
  ].filter(Boolean);

  // ── 조립 ──────────────────────────────────────────────────────────────
  const 조각 = [];
  const 절 = (이름) => 조각.push(`<h2>${글자(이름)}</h2>`);

  조각.push(`<header><h1>${글자(제목)}</h1><p class="meta">${글자(쓴것.join(' · '))}</p></header>`);

  절(말('export.conversation'));
  조각.push('<div class="flow">');
  for (const x of 흐름) {
    if (x.갈래 === 'user') 조각.push(`<div class="u"><span class="who">${글자(말('export.you'))}</span><pre>${글자(x.글)}</pre></div>`);
    else if (x.갈래 === 'tools') 조각.push(`<div class="t">⏺ ${글자(민글(x.글))}</div>`);
    else 조각.push(`<div class="a"><span class="who">deel</span><pre>${글자(민글(x.글))}</pre></div>`);
  }
  if (!흐름.length) 조각.push(`<p class="none">${글자(말('export.nothing'))}</p>`);
  조각.push('</div>');

  절(말('export.changed'));
  if (바뀐것.length) {
    조각.push(`<table><tr><th>${글자(말('export.file'))}</th><th>+</th><th>−</th><th>${글자(말('export.times'))}</th></tr>`);
    for (const x of 바뀐것) {
      조각.push(`<tr><td>${글자(x.파일)}</td><td class="g">+${x.더함}</td><td class="r">−${x.뺌}</td><td>${x.몇번}</td></tr>`);
    }
    조각.push('</table>');
  } else {
    조각.push(`<p class="none">${글자(말('export.noChanges'))}</p>`);
  }

  /*
   * 증거 절. 여기가 이 보고서의 요점이다.
   *
   * '증명 안 된 것' 은 항상 절로 세운다 — 비어 있을 때도 "없습니다" 라고
   * 적는다. 절 자체를 숨기면, 읽는 사람은 다 확인된 줄 안다.
   */
  절(말('export.evidence'));
  const 돌린 = 증거?.돌린것 ?? [];
  if (돌린.length) {
    조각.push('<ul class="ran">');
    for (const x of 돌린) 조각.push(`<li class="${x.됐나 ? 'ok' : 'bad'}">${x.됐나 ? '✓' : '✗'} <code>${글자(민글(x.무엇))}</code>${x.남긴말 ? ` — ${글자(민글(x.남긴말))}` : ''}</li>`);
    조각.push('</ul>');
  } else {
    조각.push(`<p class="none">${글자(말('export.nothingRan'))}</p>`);
  }

  조각.push(`<h3>${글자(말('export.unproven'))}</h3>`);
  const 미증명 = 증거?.증명안된것 ?? [];
  if (미증명.length) {
    조각.push('<ul class="unproven">');
    for (const x of 미증명) 조각.push(`<li><b>${글자(x.파일)}</b> — ${글자(x.왜 ?? '')}</li>`);
    조각.push('</ul>');
  } else if (바뀐것.length) {
    조각.push(`<p class="none">${글자(말('export.allProven'))}</p>`);
  } else {
    조각.push(`<p class="none">${글자(말('export.noChanges'))}</p>`);
  }

  조각.push(`<footer>${글자(말('export.footer'))}</footer>`);

  /*
   * 겉옷. 바깥 주소는 하나도 없다 — 폐쇄망에서 여는 파일이다.
   * 스크립트도 없다. 보고서는 읽는 물건이지 도는 물건이 아니다.
   */
  return `<!doctype html>
<html lang="${언어()}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${글자(제목)}</title>
<style>
  :root{--bg:#fff;--fg:#1a1a1a;--mut:#667;--line:#e2e2e6;--card:#f7f7f9;--g:#0a7d38;--r:#b3261e}
  @media (prefers-color-scheme:dark){:root{--bg:#131316;--fg:#ececf0;--mut:#9a9aa4;--line:#2a2a30;--card:#1c1c21;--g:#4cc38a;--r:#ef7b73}}
  body{margin:0;padding:2rem 1rem 4rem;background:var(--bg);color:var(--fg);
       font:15px/1.65 system-ui,-apple-system,"Segoe UI","Malgun Gothic",sans-serif}
  main{max-width:820px;margin:0 auto}
  h1{font-size:1.35rem;margin:0 0 .2rem}
  .meta{color:var(--mut);font-size:.85rem;margin:0 0 1.6rem}
  h2{font-size:1.02rem;border-top:1px solid var(--line);padding-top:1.1rem;margin:2rem 0 .6rem}
  h3{font-size:.92rem;margin:1.2rem 0 .4rem}
  .flow .u,.flow .a{border:1px solid var(--line);border-radius:8px;padding:.55rem .8rem;margin:.55rem 0}
  .flow .u{background:var(--card)}
  .flow .who{font-size:.75rem;color:var(--mut);display:block;margin-bottom:.15rem}
  .flow pre{margin:0;white-space:pre-wrap;word-break:break-word;font:inherit}
  .flow .t{color:var(--mut);font-size:.85rem;margin:.3rem .2rem;font-family:Consolas,monospace}
  table{border-collapse:collapse;width:100%;font-size:.9rem}
  th,td{text-align:left;padding:.35rem .6rem;border-bottom:1px solid var(--line)}
  th{color:var(--mut);font-weight:600;font-size:.8rem}
  td.g{color:var(--g)} td.r{color:var(--r)}
  ul{padding-left:1.2rem} li{margin:.25rem 0}
  li.ok{color:var(--fg)} li.bad{color:var(--r)}
  .unproven li{color:var(--r)}
  code{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:.05em .3em;font-size:.85em}
  .none{color:var(--mut)}
  footer{margin-top:2.5rem;color:var(--mut);font-size:.8rem;border-top:1px solid var(--line);padding-top:.8rem}
</style>
<main>
${조각.join('\n')}
</main>
</html>
`;
}

/**
 * 파일로 남긴다.
 *
 * .deel/보고서/ 아래에 시각으로 이름을 짓고, 같은 분(分)에 두 번 적으면
 * 번호를 붙인다 — **앞엣것을 절대 덮지 않는다.** 보고서는 남는 것이 일이다.
 *
 * @returns {string|null} 적은 자리. 못 적었으면 null — 못 적어도 대화는 계속된다.
 */
export function 보고서적기(root, session, opts = {}) {
  try {
    const 폴더 = join(root, '.deel', 'export');
    mkdirSync(폴더, { recursive: true });
    const t = new Date();
    const 판 = (n) => `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`
      + `-${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}`
      + (n ? `-${n}` : '') + '.html';
    let 이름 = 판(0);
    for (let n = 1; existsSync(join(폴더, 이름)) && n < 100; n++) 이름 = 판(n);
    const 자리 = join(폴더, 이름);
    writeFileSync(자리, 보고서짓기(session, opts), 'utf8');
    return 자리;
  } catch {
    return null;
  }
}
