/**
 * 대화 → 보고서 한 장 (/export).
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 *
 * 폐쇄망에는 세션 공유 링크가 없다 — 링크는 서버가 있어야 산다. 대신 **파일
 * 한 장**이다: 무엇을 시켰고, 무엇이 바뀌었고, 무엇으로 확인했나. 결재·보고
 * 문화에서 에이전트가 한 일을 남기는 물건은 링크가 아니라 첨부다.
 *
 * ── 여기서 재는 것 ──────────────────────────────────────────────────────
 *
 *   · 자기완결이다 — 바깥 주소가 하나도 없다. 폐쇄망에서 여는 파일이다.
 *   · 대화 글이 HTML 로 **안전하게** 실린다. <script> 가 든 대화를 내보내면
 *     보고서를 여는 순간 그 스크립트가 돈다 — 보고서가 공격 통로가 된다.
 *   · 증거의 정직함이 그대로 온다 — 증명 안 된 것이 빈칸이 아니라 글자로.
 *   · 화면 말을 따라간다 — /lang en 이면 보고서도 영어다.
 */
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/agent/session.js';
import { 보고서짓기, 보고서적기 } from '../src/ui/export.js';
import { 언어정하기 } from '../src/i18n/index.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 적어둘것 = [];

언어정하기('ko');
const root = mkdtempSync(join(tmpdir(), 'deel-export-'));
const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', model: '검사모델', ctx: 32768 };

/** 일 좀 한 세션 하나를 꾸민다. */
function 세션꾸미기() {
  const s = new Session(conn, { root, work: 'code' });
  s.push({ role: 'user', content: '대시보드 페이지를 만들어 줘' });
  s.push({
    role: 'assistant',
    content: '',
    tool_calls: [{ id: 't1', type: 'function', function: { name: 'Write', arguments: JSON.stringify({ file_path: 'src/dash.js' }) } }],
  });
  s.push({ role: 'tool', tool_call_id: 't1', content: '새로 만듦: src/dash.js (120줄)' });
  s.push({ role: 'assistant', content: 'src/dash.js 를 만들었습니다. Verify 로 확인했습니다.' });
  s.push({ role: 'user', content: '<script>alert(1)</script> 이 글자도 넣어 줘' });
  s.push({ role: 'assistant', content: '넣었습니다 & 확인했습니다.' });
  s.changes.set(join(root, 'src/dash.js'), { added: 120, removed: 0, times: 1 });
  s.changes.set(join(root, 'src/util.js'), { added: 8, removed: 3, times: 2 });
  s.usage = { in: 12345, out: 2345, calls: 6, ms: 8000 };
  return s;
}

// ══ 1. 보고서 몸 ═══════════════════════════════════════════════════════
trace('1-몸');
{
  const s = 세션꾸미기();
  const html = 보고서짓기(s, { scope: { show: (p) => String(p).replace(root, '').replace(/^[\\/]+/, '') } });

  check('HTML 문서다', /<!doctype html>/i.test(html) && /<title>/.test(html), html.slice(0, 60));
  check('시킨 말이 실린다', html.includes('대시보드 페이지를 만들어 줘'), '');
  check('답이 실린다', html.includes('만들었습니다'), '');
  check('바뀐 파일 표가 있다', /dash\.js/.test(html) && /120/.test(html), '');
  check('몇 번 고쳤는지도 있다', /util\.js/.test(html) && /2/.test(html), '');
  check('모델 이름이 있다', html.includes('검사모델'), '');
  check('사용량이 있다', /12,345|12345/.test(html), '');

  // 도구 호출은 한 줄로 접힌다 — 보고서는 기록이지 재현이 아니다.
  check('도구 호출이 한 줄로 보인다', /Write/.test(html) && /dash\.js/.test(html), '');
}

// ══ 2. 안전 — 대화가 코드가 되지 않는다 ═════════════════════════════════
trace('2-안전');
{
  const s = 세션꾸미기();
  const html = 보고서짓기(s, {});
  check('script 태그가 그대로 실리지 않는다', !html.includes('<script>alert(1)</script>'), '');
  check('글자로는 보인다 (이스케이프)', html.includes('&lt;script&gt;'), '');
  // 우리가 넣는 <style> 하나 말고 스크립트 자체가 없다.
  check('보고서에 스크립트가 아예 없다', !/<script[\s>]/i.test(html), '');
}

// ══ 3. 자기완결 — 폐쇄망에서 여는 파일 ══════════════════════════════════
trace('3-자기완결');
{
  const html = 보고서짓기(세션꾸미기(), {});
  check('바깥 주소가 없다', !/src\s*=\s*["']https?:|href\s*=\s*["']https?:/i.test(html), '');
  check('글꼴도 안 불러온다', !/fonts\.googleapis|@import/i.test(html), '');
  check('ANSI 제어문자가 안 샌다', !/\x1b\[/.test(html), '');
}

// ══ 4. 증거의 정직함 ════════════════════════════════════════════════════
trace('4-증거');
{
  // 확인 없이 바꾸기만 한 세션 — '증명 안 된 것' 이 글자로 나와야 한다.
  const s = 세션꾸미기();
  const html = 보고서짓기(s, {});
  check('증명 안 된 것 절이 있다', /증명 안 된|확인 안 된/.test(html), '');
  // 이 절이 이 보고서의 요점이다. 없애고 초록만 남기면 그건 홍보물이다.
}

// ══ 5. 화면 말을 따라간다 ═══════════════════════════════════════════════
trace('5-영어');
{
  언어정하기('en');
  const html = 보고서짓기(세션꾸미기(), {});
  check('영어로 켜면 보고서도 영어', /Changed files|What was asked/i.test(html), html.slice(0, 200));
  check('한글 제목이 안 남는다', !/바뀐 파일|시킨 것/.test(html), '');
  언어정하기('ko');
}

// ══ 6. 파일로 남기기 ════════════════════════════════════════════════════
trace('6-파일');
{
  const s = 세션꾸미기();
  const 자리1 = 보고서적기(root, s, {});
  check('파일이 생긴다', !!자리1 && existsSync(자리1), String(자리1));
  check('내용이 그 보고서다', readFileSync(자리1, 'utf8').includes('대시보드'), '');
  const 자리2 = 보고서적기(root, s, {});
  check('두 번 적어도 앞엣것을 안 덮는다', 자리1 !== 자리2 && existsSync(자리1) && existsSync(자리2), `${자리1} vs ${자리2}`);
  적어둘것.push(`보고서 자리: ${String(자리1).replace(root, '…')}`);

  // 빈 세션도 깨지지 않는다 — "없습니다" 가 있는 문서가 나온다.
  const 빈 = new Session(conn, { root, work: 'code' });
  const 빈글 = 보고서짓기(빈, {});
  check('빈 세션도 문서가 된다', /<!doctype html>/i.test(빈글), '');
}

rmSync(root, { recursive: true, force: true });

// ── 마무리 ──────────────────────────────────────────────────────────────
const C = (n, s) => (process.stdout.isTTY || process.env.FORCE_COLOR ? `\x1b[${n}m${s}\x1b[0m` : s);
console.log('');
for (const f of fail) console.log(`  ${C(31, '✗')} ${f.name}${f.note ? C(90, `  ${f.note}`) : ''}`);
for (const 글 of 적어둘것) console.log(`  ${C(90, `· ${글}`)}`);
console.log('');
console.log(`  ${pass.length}개 통과 · ${fail.length}개 실패`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
