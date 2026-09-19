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
// 도구 부름과 글이 어디 실리는지는 규격마다 다르다 — 읽는 규칙은 한 곳뿐이다.
import { 부른것들, 본문글 } from '../backend/adapter.js';
import { 말, 언어 } from '../i18n/index.js';
import { 첫이름 } from '../tools/label.js';
import { 가리기 } from '../safety/secrets.js';
// 「무엇이 아는 열쇠인가」 는 감사기록과 같은 자를 쓴다 — 두 벌이면 한쪽만 샌다.
import { 열쇠묻기 } from '../safety/audit.js';

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

/**
 * 도구 호출 한 줄 요약. 보고서는 기록이지 재현이 아니다 — 인자 전체를 안 싣는다.
 *
 * 가린 **뒤에** 자른다. 먼저 자르면 열쇠가 80자 선에 걸쳤을 때 앞 조각만 남고,
 * 조각은 정확히 아는 열쇠라도 못 알아본다 (safety/audit.js 의 turn 과 같은 까닭).
 */
function 도구줄(tc, 가림 = (s) => s) {
  // 부른것들() 이 규격을 이미 펴서 { id, name, args } 로 준다.
  const 이름 = tc?.name ?? '?';
  let 핵심 = '';
  try {
    const a = tc?.args ?? {};
    // 이름 차례는 tools/label.js 한 곳에서 온다. 여기 목록에는 url 이 빠져
    // 있어서, 웹을 읽은 줄이 보고서에서만 빈 괄호로 남았다.
    핵심 = 첫이름(a) ?? a.command ?? '';
  } catch { /* 인자가 잘렸어도 이름은 보여 준다 */ }
  핵심 = 가림(String(핵심));
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

  /*
   * ── 보고서에 싣기 전에 가린다 ─────────────────────────────────────────
   *
   * 보고서는 남에게 가는 글이다 — 결재 첨부로 돌고 메일로 나간다. 그런데 사람 말·
   * 모델 말·도구 줄을 **그대로** 실었다. 같은 `curl -H "Authorization: Bearer …"`
   * 가 감사기록에는 가려서 적히는데 보고서에는 평문으로 나갔다. 가리는 자리가
   * 한 곳이라도 빠지면, 가려진 줄 알고 넘긴 사람이 그 한 곳으로 샌다.
   *
   * 아는 열쇠(이 연결의 열쇠·환경변수 열쇠)는 감사기록과 같은 자로 묻는다.
   * 자유롭게 적히는 글만 가린다 — 파일 이름·숫자는 안 건드린다.
   */
  const 아는열쇠 = (() => { try { return 열쇠묻기(session.conn)(); } catch { return []; } })();
  const 가림 = (s) => 가리기(String(s ?? ''), { 열쇠들: 아는열쇠 }).글;

  // ── 재료 ──────────────────────────────────────────────────────────────
  const 첫말 = 가림(본문글((session.messages ?? []).find((m) => m.role === 'user')));
  const 제목 = String(첫말 || 말('export.untitled')).split('\n')[0].slice(0, 80);

  const 흐름 = [];
  for (const m of session.messages ?? []) {
    /*
     * 규격을 안 가린다.
     *
     * 여기가 `typeof m.content === 'string'` 과 `m.tool_calls` 로 읽고 있었다.
     * Anthropic 꼴은 둘 다 안 맞는다 — 모델이 한 말은 블록 배열 안에 있고
     * 부름은 `tool_use` 블록이다. 그래서 그 창구로 나눈 대화를 `/export`
     * 하면 **모델 말과 도구가 통째로 빈** 보고서가 나왔다. 오류는 없다.
     */
    const 글 = 본문글(m);
    if (m.role === 'user') {
      // Anthropic 꼴에서 사람 차례에 도구 결과가 섞여 온다. 그건 글이 아니다.
      if (글.trim()) 흐름.push({ 갈래: 'user', 글: 가림(글) });
    } else if (m.role === 'assistant') {
      const 부른것 = 부른것들(m).map((tc) => 도구줄(tc, 가림));
      if (부른것.length) 흐름.push({ 갈래: 'tools', 글: 부른것.join(' · ') });
      // 색 글자를 먼저 걷고 가린다 — 열쇠 한가운데 색이 끼면 꼴이 안 맞는다.
      if (글.trim()) 흐름.push({ 갈래: 'assistant', 글: 가림(민글(글)) });
    }
    // 도구 결과 알맹이는 안 싣는다 — 길고, 요점은 답과 증거 절에 이미 있다.
  }

  const 바뀐것 = [...(session.changes ?? new Map()).entries()]
    .map(([p, v]) => ({ 파일: 보임(p), 더함: v.added ?? 0, 뺌: v.removed ?? 0, 몇번: v.times ?? 1 }));

  /*
   * 못 모은 것과 모을 것이 없는 것은 **다르다** (8회차 판정).
   *
   * 여기가 `catch { return null; }` 이었다. 그러면 아래에서 `증거?.증명안된것 ?? []`
   * 가 빈 배열이 되고, 바뀐 파일이 있으면 「없습니다 — 바꾼 것마다 뒤에 돌린 확인이
   * 있습니다」 가 찍힌다. 재 보니 감사기록을 못 읽는 자리에서 그 줄이 그대로 나왔다.
   * **증거를 한 줄도 못 봤는데 다 증명됐다고 말한 것이다.** 보고서는 남는 물건이라
   * 그 거짓말이 그대로 남는다. 그래서 까닭을 들고 온다.
   */
  let 증거못모은까닭 = null;
  const 증거 = (() => {
    try { return 증거모으기(session, { audit }); } catch (err) { 증거못모은까닭 = err?.message ?? String(err); return null; }
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
    // 돌린 명령도 도구 줄이다. 감사기록에서 온 것은 이미 가려져 있지만, 대화에서 모은
    // 것은 아니다 — 어디서 왔든 여기서 한 번 더 지난다(이미 가린 표는 그대로 남는다).
    for (const x of 돌린) 조각.push(`<li class="${x.됐나 ? 'ok' : 'bad'}">${x.됐나 ? '✓' : '✗'} <code>${글자(가림(민글(x.무엇)))}</code>${x.남긴말 ? ` — ${글자(가림(민글(x.남긴말)))}` : ''}</li>`);
    조각.push('</ul>');
  } else {
    조각.push(`<p class="none">${글자(말('export.nothingRan'))}</p>`);
  }

  조각.push(`<h3>${글자(말('export.unproven'))}</h3>`);
  const 미증명 = 증거?.증명안된것 ?? [];
  if (증거못모은까닭) {
    조각.push(`<p class="none">${글자(말('export.evidenceFailed', { 왜: 증거못모은까닭 }))}</p>`);
  } else if (미증명.length) {
    조각.push('<ul class="unproven">');
    // 파일 이름은 바뀐것 표와 **같은 자로** 짧게 적는다 (8회차 판정) — 한 보고서
    // 안에 짧은 경로와 날 절대경로가 섞여 있으면 같은 파일인지 사람이 못 가른다.
    for (const x of 미증명) 조각.push(`<li><b>${글자(보임(x.파일))}</b> — ${글자(x.왜 ?? '')}</li>`);
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
 * .deel/export/ 아래에 시각으로 이름을 짓고, 같은 분(分)에 두 번 적으면
 * 번호를 붙인다 — **앞엣것을 절대 덮지 않는다.** 보고서는 남는 것이 일이다.
 *
 * @returns {string|null} 적은 자리. 못 적었으면 null — 못 적어도 대화는 계속된다.
 */
export function 보고서적기(root, session, opts = {}, 탈받을것 = null) {
  try {
    const 폴더 = join(root, '.deel', 'export');
    mkdirSync(폴더, { recursive: true });
    const t = new Date();
    const 판 = (n) => `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`
      + `-${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}`
      + (n ? `-${n}` : '') + '.html';
    /*
     * 사람이 이름을 준 자리(`/export 보고서`). 도움말이 `[파일이름]` 이라고
     * 적어 두고도 여기서 한 번도 안 읽어서, 무엇을 적어 주든 늘 시각 이름으로
     * 남았다 — 적힌 대로 안 되는 자리다.
     *
     * 폴더는 안 받는다. 준 글에서 **이름 한 칸만** 떼어 쓴다 —
     * `../../어디` 로 내보내는 자리를 벗어나는 길을 막는다.
     */
    const 준이름 = String(opts.이름 ?? '').trim().replace(/[\\/]+/g, '/').split('/').pop() ?? '';
    const 손질 = 준이름.replace(/^\.+/, '').trim();
    if (준이름 && !손질) throw new Error(`쓸 수 없는 이름입니다: ${준이름}`);

    let 이름 = 손질 ? (/\.html?$/i.test(손질) ? 손질 : `${손질}.html`) : 판(0);
    // 이름을 준 자리는 번호를 안 붙인다. 있으면 덮지 않고 그대로 말한다.
    if (손질 && existsSync(join(폴더, 이름))) throw new Error(`이미 있습니다: ${이름}`);
    if (!손질) for (let n = 1; existsSync(join(폴더, 이름)) && n < 100; n++) 이름 = 판(n);
    /*
     * ── 백 번째에서 덮고 있었다 ──────────────────────────────────────────
     *
     * 번호는 99 에서 멈추고, 멈춘 자리가 있든 없든 그대로 적었다. 같은 분에 백 번을
     * 넘기면(스크립트로 돌리면 금방이다) `…-99.html` 을 매번 덮었다 — 위 머리말의
     * 「절대 덮지 않는다」 가 거짓이 된다. 두 창이 같은 순간에 같은 번호를 고르는
     * 틈도 있었다.
     * 그래서 `wx`(없을 때만 만들기)로 적고, 이미 있으면 프로세스 번호·시각·난수를
     * 붙인 이름으로 다시 한다. 덮는 길이 아예 없다.
     */
    const 글 = 보고서짓기(session, opts);
    for (let 번 = 0; ; 번++) {
      const 자리 = join(폴더, 이름);
      try {
        writeFileSync(자리, 글, { encoding: 'utf8', flag: 'wx' });
        return 자리;
      } catch (e) {
        // 사람이 이름을 준 자리는 다른 이름으로 바꿔 적지 않는다 — 적어 준 이름이
        // 아닌 데 남으면 찾으러 갈 자리가 달라진다.
        if (손질) throw new Error(`이미 있습니다: ${이름}`);
        if (e?.code !== 'EEXIST' || 번 >= 20) throw e;
        이름 = 판(`${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
      }
    }
  } catch (e) {
    // 못 적은 까닭을 버리지 않는다 — 화면에 「못 남겼습니다」 만 뜨면 디스크가
    // 찼는지 폴더가 읽기 전용인지 알 길이 없다. 받을 그릇을 준 쪽에만 담는다.
    if (탈받을것) 탈받을것.왜 = String(e?.message ?? e);
    return null;
  }
}
