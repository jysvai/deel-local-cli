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

/*
 * ★★ Anthropic 꼴 대화도 보고서에 실린다.
 *
 * 여기가 `typeof m.content === 'string'` 과 `m.tool_calls` 로 읽고 있었다.
 * 그 규격은 둘 다 안 맞아서, 그 창구로 나눈 대화를 내보내면 **모델 말과
 * 도구가 통째로 빈** 문서가 나왔다. 오류도 경고도 없이.
 */
{
  const conn2 = { kind: 'anthropic', model: 'claude-opus-5', base: 'https://api.anthropic.com' };
  const s2 = new Session(conn2, { root, work: 'code' });
  s2.push({ role: 'user', content: '설정 파일 좀 봐줘' });
  s2.push({
    role: 'assistant',
    content: [
      { type: 'text', text: '설정을 읽어 보겠습니다.' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'package.json' } },
    ],
  });
  s2.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"name":"deel"}' }] });
  s2.push({ role: 'assistant', content: [{ type: 'text', text: '이름은 deel 입니다.' }] });

  const 글2 = 보고서짓기(s2, {});
  check('★★ Anthropic 꼴에서도 사람 말이 실린다', 글2.includes('설정 파일 좀 봐줘'), '');
  check('★★ Anthropic 꼴에서도 모델 말이 실린다', 글2.includes('이름은 deel 입니다'), '');
  check('★★ Anthropic 꼴에서도 도구 부름이 실린다', /Read/.test(글2), '');
  check('★★ 도구 부름의 인자도 실린다', 글2.includes('package.json'), '');
  check('도구 결과 알맹이는 안 싣는다', !글2.includes('"name":"deel"'), '');
  check('★ 제목이 첫 사람 말에서 나온다', /설정 파일 좀 봐줘/.test(글2), '');
}

// ══ 7. 보고서에 열쇠가 안 실린다 ═══════════════════════════════════════
trace('7-가리기');
/*
 * 보고서는 남에게 가는 글이다. 감사기록은 같은 명령줄을 가려서 적는데 보고서는
 * 사람 말·모델 말·도구 줄을 **그대로** 실었다 — 결재 첨부로 토큰이 나간다.
 */
{
  const 토큰 = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const 프로젝트열쇠 = 'sk-proj-' + 'FAKEfakeFAKEfakeFAKEfakeFAKEfake1234';
  const 아는열쇠 = 'DEELGW-사내-9f8e7d6c5b4a3210';
  const s = new Session({ ...conn, key: 아는열쇠 }, { root, work: 'code' });
  s.push({ role: 'user', content: `내 토큰 ${토큰} 로 올려줘` });
  s.push({
    role: 'assistant', content: '확인합니다',
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Bash', arguments: JSON.stringify({ command: `curl -H "Authorization: Bearer ${프로젝트열쇠}" https://api.x/v1` }) } }],
  });
  s.push({ role: 'tool', tool_call_id: 'c1', content: 'ok' });
  s.push({ role: 'assistant', content: `적용했습니다. 게이트웨이 열쇠는 ${아는열쇠} 입니다.` });
  const html = 보고서짓기(s, {});
  const 몸 = html.slice(html.indexOf('<main>'));
  check('★★ 사람 말의 토큰이 보고서에 안 실린다', !html.includes(토큰), '');
  check('★★ 도구 줄의 열쇠가 조각으로도 안 실린다', !html.includes(프로젝트열쇠.slice(0, 16)), (몸.match(/<div class="t">[^\n]*/) ?? [''])[0].slice(0, 160));
  check('★★ 설정에 든 열쇠는 꼴을 몰라도 모델 말에서 지운다', !html.includes(아는열쇠), '');
  check('  가렸다는 표는 남는다', html.includes('«가림:'), '');
  check('  무엇을 했는지는 읽힌다', /curl/.test(몸) && /올려줘/.test(몸), '');
}

// ══ 8. 같은 분에 백 번 넘게 적어도 안 덮는다 ═══════════════════════════
trace('8-안덮기');
{
  const { mkdirSync, writeFileSync, readdirSync } = await import('node:fs');
  const 방 = mkdtempSync(join(tmpdir(), 'deel-export-백-'));
  const 폴더 = join(방, '.deel', 'export');
  mkdirSync(폴더, { recursive: true });
  const 이름 = (t, n) => `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`
    + `-${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}` + (n ? `-${n}` : '') + '.html';
  const 이제 = new Date();
  // 분이 넘어가는 순간에 걸려도 재는 것이 같게, 이번 분과 다음 분을 둘 다 채운다.
  for (const t of [이제, new Date(이제.getTime() + 60000)]) {
    for (let n = 0; n < 100; n++) writeFileSync(join(폴더, 이름(t, n)), `옛 보고서 ${n}`, 'utf8');
  }
  const 앞수 = readdirSync(폴더).length;
  const 자리 = 보고서적기(방, 세션꾸미기(), {});
  const 옛것들 = readdirSync(폴더).filter((f) => f !== String(자리).split(/[\\/]/).pop());
  const 덮인것 = 옛것들.filter((f) => !readFileSync(join(폴더, f), 'utf8').startsWith('옛 보고서'));
  check('★★ 같은 분에 백 번 넘게 적어도 앞엣것을 안 덮는다',
    !!자리 && readdirSync(폴더).length === 앞수 + 1 && 덮인것.length === 0,
    `${String(자리).split(/[\\/]/).pop()} · ${앞수}→${readdirSync(폴더).length} · 덮인것 ${덮인것.length}`);
  check('  새 자리에는 새 보고서가 있다', !!자리 && readFileSync(자리, 'utf8').includes('대시보드'), '');
  rmSync(방, { recursive: true, force: true });
}

rmSync(root, { recursive: true, force: true });

// ── 마무리 ──────────────────────────────────────────────────────────────
trace('이름준자리');

/*
 * 도움말이 `[파일이름]` 이라고 적어 둔 그 인자.
 *
 * 오래도록 `case 'export'` 가 그 인자를 한 번도 안 읽어서, 무엇을 적어 주든
 * 늘 시각으로 지은 이름으로 남았다 — 적힌 대로 안 되는 자리였다.
 * 이름을 받되 **폴더는 안 받는다.** 준 글에서 이름 한 칸만 떼어 쓴다.
 */
{
  const 뿌리 = mkdtempSync(join(tmpdir(), 'deel-내보내기이름-'));
  const 세션 = new Session(conn, { root: 뿌리, work: 'code' });
  세션.push({ role: 'user', content: '안녕' });

  const 준것 = 보고서적기(뿌리, 세션, { 이름: '보고서' });
  check('★★★ 이름을 주면 그 이름으로 남는다',
    !!준것 && /[\\/]보고서\.html$/.test(준것), String(준것));

  const 밖 = 보고서적기(뿌리, 세션, { 이름: '../../밖으로.html' });
  check('★★★ 폴더를 섞어 줘도 내보내는 자리를 못 벗어난다',
    !!밖 && /[\\/]\.deel[\\/]export[\\/]밖으로\.html$/.test(밖)
      && !existsSync(join(뿌리, '..', '밖으로.html')), String(밖));

  const 탈 = {};
  const 또 = 보고서적기(뿌리, 세션, { 이름: '보고서' }, 탈);
  check('★★ 같은 이름을 또 주면 덮지 않고 까닭을 말한다',
    또 === null && String(탈.왜 ?? '').includes('보고서.html'), `${또} · ${탈.왜}`);

  const 없이 = 보고서적기(뿌리, 세션, {});
  check('★★ 이름을 안 주면 여태처럼 시각으로 짓는다',
    !!없이 && /[\\/]\d{8}-\d{4}(-\d+)?\.html$/.test(없이), String(없이));

  rmSync(뿌리, { recursive: true, force: true });
}

const C = (n, s) => (process.stdout.isTTY || process.env.FORCE_COLOR ? `\x1b[${n}m${s}\x1b[0m` : s);
console.log('');
for (const f of fail) console.log(`  ${C(31, '✗')} ${f.name}${f.note ? C(90, `  ${f.note}`) : ''}`);
for (const 글 of 적어둘것) console.log(`  ${C(90, `· ${글}`)}`);
console.log('');
console.log(`  ${pass.length}개 통과 · ${fail.length}개 실패`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
