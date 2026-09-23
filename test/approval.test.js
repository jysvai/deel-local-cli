/**
 * 바꾸기 전에 사람이 **보고** 정하는가 (2.1.0).
 *
 * ── 왜 이 파일이 있나 ──────────────────────────────────────────────────
 *
 * 사내 검토에서 물었다: 「파일을 고치거나 지우기 전에 미리보기를 보여 주고 사람이 한 번
 * 확인하는 절차가 기본으로 도는가.」 재 보니 세 군데가 비어 있었다.
 *
 *   1. strict 가 Write·Edit·Bash 만 물었다. Append·Move·Jobs 끝내기·MCP 도구는 안 묻고 돌았다.
 *      물을 곳(confirm)이 없는 부르는 쪽에서는 strict 가 물음 없이 그대로 실행했다.
 *   2. 승인 창은 `Edit src/a.js` 한 줄뿐이었다. 무엇이 바뀌는지 모르고 누르는 y 였다.
 *   3. 관리자가 「이 PC 에서는 늘 묻는다」 를 걸 자리가 없었다. 모드는 쓰는 사람이 골랐다.
 *
 * 여기서는 화면 글이 아니라 **도구가 실제로 돌았나 · 파일이 실제로 바뀌었나** 로 잰다.
 */

import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from './trace.mjs';

// 설정을 건드리는 명령(/mode)을 부르므로 사람의 ~/.deel 대신 임시 폴더를 쓴다.
// 모듈을 불러오기 **전에** 정해야 한다 — 설정 자리는 불러올 때 읽힌다.
const home = mkdtempSync(join(tmpdir(), 'deel-approval-home-'));
process.env.DEEL_HOME = home;
const 원래정책 = process.env.DEEL_POLICY;
const 정책길 = join(home, 'policy.json');

const { 승인바닥, 더센승인, 정책잊기, 규칙모으기 } = await import('../src/safety/policy.js');
const { Session } = await import('../src/agent/session.js');
const { run } = await import('../src/agent/loop.js');
const { 바뀔내용 } = await import('../src/tools/index.js');
const { 미리보기줄들, 다음: 승인다음 } = await import('../src/ui/approve.js');
const { handle } = await import('../src/commands.js');
const { makeScope } = await import('../src/safety/guard.js');
const { History } = await import('../src/safety/undo.js');
const { Audit } = await import('../src/safety/audit.js');
const { allowEndpoint, resetNet } = await import('../src/safety/network.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

/** 정책 파일을 바꿔 끼운다. null 이면 뗀다. 읽은 것을 잊어야 다음 읽기가 새 파일을 본다. */
function 정책걸기(값) {
  if (값 === null) { rmSync(정책길, { force: true }); delete process.env.DEEL_POLICY; }
  else { writeFileSync(정책길, JSON.stringify(값)); process.env.DEEL_POLICY = 정책길; }
  정책잊기();
}

// 이 PC 에 진짜 관리 정책이 있으면 DEEL_POLICY 는 안 읽힌다 (policy.js 의 정책자리). 그러면 아래
// 바닥 검사들은 이 PC 의 정책을 재게 되므로, 있으면 그 판은 건너뛴다고 적는다.
정책걸기({ approval: 'strict' });
const 시험정책먹나 = 승인바닥().곳 === 정책길;
정책걸기(null);

// ── 1. 정책의 승인 바닥 읽기 ───────────────────────────────────────────
trace('1-바닥읽기');
{
  const 판 = (값) => 승인바닥({ 값, 곳: 'P' });
  check('★ approval 이 없으면 바닥은 auto (아무것도 안 건다)', 판({}).바닥 === 'auto' && 판({}).곳 === null);
  check('★★ approval strict → 바닥 strict', 판({ approval: 'strict' }).바닥 === 'strict');
  check('★★ approval confirm → 바닥 confirm', 판({ approval: 'confirm' }).바닥 === 'confirm');
  check('★ 대소문자·빈칸은 안 가린다 (" STRICT ")', 판({ approval: ' STRICT ' }).바닥 === 'strict');
  const 모름 = 판({ approval: 'yolo' });
  check('★★★ 모르는 값이면 제일 좁은 strict 로 치고, 모른다고 들고 있는다', 모름.바닥 === 'strict' && 모름.모름 === 'yolo',
    JSON.stringify(모름));
  check('★ 빈 글은 안 건 것으로 본다', 판({ approval: '' }).바닥 === 'auto');
  // 2차 눈(Gemini) 판정: 모르는 값은 strict 로 치면서, 쉼표 하나 틀려 **파일이 안 읽히면** 바닥이 통째로 auto 로 풀렸다.
  const 깨짐 = 승인바닥({ 값: {}, 곳: 'P', 탈: '정책 파일을 못 읽었습니다 (Unexpected token })' });
  check('★★★ 정책 파일이 깨졌으면 바닥은 strict — 오타 하나로 관리자 바닥이 빠지면 안 된다', 깨짐.바닥 === 'strict' && /못 읽었습니다/.test(깨짐.탈 ?? ''),
    JSON.stringify(깨짐));
  check('  정책 파일이 없는 PC 는 그대로 auto', 승인바닥({ 값: {}, 곳: null, 탈: null }).바닥 === 'auto');

  check('★★ 더센승인: auto · strict → strict', 더센승인('auto', 'strict') === 'strict');
  check('★★ 더센승인: strict · confirm → strict (사람이 더 조인 것은 그대로)', 더센승인('strict', 'confirm') === 'strict');
  check('★ 더센승인: confirm · auto → confirm', 더센승인('confirm', 'auto') === 'confirm');
  check('★ 더센승인: 모르는 이름 · auto → auto (바닥이 따로 막는다)', 더센승인('constructor', 'auto') === 'auto');
}

// ── 2. Session 은 바닥 아래로 못 내려간다 ─────────────────────────────
trace('2-세션바닥');
if (시험정책먹나) {
  const conn = { kind: 'openai', base: 'http://127.0.0.1:9/v1', auth: 'none', key: '', model: 'x', ctx: 8192, tools: true };
  정책걸기({ approval: 'strict' });
  const s = new Session(conn, { root: home, mode: 'auto' });
  check('★★★ 정책 strict 면 auto 로 만든 세션도 strict 로 읽힌다', s.mode === 'strict', s.mode);
  check('★ 사람이 고른 값은 그대로 들고 있다 (화면이 「정책이 덮었다」 를 말하려고)', s.고른승인 === 'auto', s.고른승인);
  s.mode = 'confirm';
  check('★★ 적어 넣어도 바닥 아래로는 안 내려간다', s.mode === 'strict', s.mode);
  정책걸기({ approval: 'confirm' });
  s.mode = 'strict';
  check('★★ 바닥보다 더 조이는 것은 그대로 먹는다 (confirm 바닥에 strict)', s.mode === 'strict', s.mode);
  s.mode = 'auto';
  check('★★ confirm 바닥에 auto 를 넣으면 confirm', s.mode === 'confirm', s.mode);
  정책걸기(null);
  check('★ 정책을 걷으면 사람이 고른 값이 그대로 돌아온다', s.mode === 'auto', s.mode);

  // Shift+Tab 의 차례 — 바닥 위에서만 돈다.
  check('★★ Shift+Tab: strict 바닥이면 strict 에 머문다', 승인다음('strict', 'strict') === 'strict');
  check('★★ Shift+Tab: confirm 바닥이면 confirm → strict → confirm', 승인다음('confirm', 'confirm') === 'strict' && 승인다음('strict', 'confirm') === 'confirm');
  check('★ Shift+Tab: 바닥이 없으면 예전처럼 auto → confirm → strict → auto',
    승인다음('auto') === 'confirm' && 승인다음('confirm') === 'strict' && 승인다음('strict') === 'auto');
} else {
  check('  (이 PC 에 관리 정책이 있어 세션 바닥 검사는 건너뜀)', true);
}

// ── 3. /mode 로 바닥 아래로 못 내린다 ─────────────────────────────────
trace('3-모드명령');
if (시험정책먹나) {
  const root = mkdtempSync(join(tmpdir(), 'deel-approval-cmd-'));
  const conn = { kind: 'openai', base: 'http://127.0.0.1:9/v1', auth: 'none', key: '', model: 'x', ctx: 8192, tools: true };
  const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
  const 조용히 = async (fn) => {
    const 원래 = process.stdout.write.bind(process.stdout);
    let 모인것 = '';
    process.stdout.write = (chunk) => { 모인것 += chunk; return true; };
    try { await fn(); } finally { process.stdout.write = 원래; }
    return 모인것;
  };
  정책걸기({ approval: 'strict' });
  const s = new Session(conn, { root, mode: 'strict' });
  const 화면 = await 조용히(() => handle('/mode auto', s, ctx));
  check('★★★ 정책 strict 면 /mode auto 가 안 먹는다', s.mode === 'strict' && s.고른승인 === 'strict', `${s.mode} · 고른 ${s.고른승인}`);
  check('★★ 누가 막았는지(관리 정책 · 어느 파일) 화면에 적는다', /관리 정책/.test(화면) && 화면.includes(정책길), 화면.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 300));
  const 목록 = await 조용히(() => handle('/mode', s, ctx));
  check('★ /mode 목록에도 바닥이 걸려 있다고 적는다', /관리 정책/.test(목록), 목록.replace(/\x1b\[[0-9;]*m/g, '').slice(-300));
  정책걸기(null);
  await 조용히(() => handle('/mode auto', s, ctx));
  check('  정책이 없으면 /mode auto 는 그대로 먹는다', s.mode === 'auto', s.mode);
  rmSync(root, { recursive: true, force: true });
}

// ── 4. 바뀔 내용 (미리보기) ────────────────────────────────────────────
trace('4-바뀔내용');
const 뿌리 = mkdtempSync(join(tmpdir(), 'deel-approval-work-'));
{
  const ctx = { scope: makeScope(뿌리), seen: new Set() };
  writeFileSync(join(뿌리, 'a.txt'), '하나\n둘\n셋\n');
  writeFileSync(join(뿌리, 'b.txt'), 'x = 1\n');
  writeFileSync(join(뿌리, '안읽음.txt'), '비밀일지도\n');
  mkdirSync(join(뿌리, '.deel'), { recursive: true });
  writeFileSync(join(뿌리, '.deel', 'config.json'), '{"apiKey":"sk-실제열쇠"}');
  // 실제 Edit 은 먼저 Read 한 파일만 고친다. 미리보기도 같은 조건이다.
  for (const f of ['a.txt', 'b.txt']) ctx.seen.add(ctx.scope.resolve(f));

  check('★★ 아직 안 읽은 파일의 Edit 은 미리보기를 안 만든다 (실제 Edit 이 거절한다)',
    바뀔내용('Edit', { file_path: '안읽음.txt', old_string: '비밀', new_string: 'x' }, ctx).length === 0);
  ctx.seen.add(ctx.scope.resolve('.deel/config.json'));
  const 살림 = [
    ...바뀔내용('Write', { file_path: '.deel/config.json', content: '{}' }, ctx),
    ...바뀔내용('Append', { file_path: '.deel/config.json', content: 'x' }, ctx),
    ...바뀔내용('Edit', { file_path: '.deel/config.json', old_string: 'apiKey', new_string: 'k' }, ctx),
  ];
  check('★★★ deel 자신의 설정(열쇠)은 미리보기로도 안 읽는다 — 승인 창·편집기에 열쇠가 찍히지 않는다',
    살림.length === 0 && !JSON.stringify(살림).includes('sk-실제열쇠'), JSON.stringify(살림).slice(0, 120));

  const 한 = 바뀔내용('Edit', { file_path: 'a.txt', old_string: '둘', new_string: '둘둘' }, ctx);
  check('★★ Edit 한 군데 — 전·후를 낸다', 한.length === 1 && 한[0].전 === '하나\n둘\n셋\n' && 한[0].후 === '하나\n둘둘\n셋\n',
    JSON.stringify(한));
  check('★ 보일 경로는 작업 폴더 기준', 한[0]?.보일경로 === 'a.txt', 한[0]?.보일경로);

  const 여럿 = 바뀔내용('Edit', {
    edits: [
      { file_path: 'a.txt', old_string: '하나', new_string: '일' },
      { file_path: 'a.txt', old_string: '없는글', new_string: 'z' },
      { file_path: 'a.txt', old_string: '일', new_string: '첫째' },
      { file_path: 'b.txt', old_string: 'x = 1', new_string: 'x = 2' },
    ],
  }, ctx);
  const a = 여럿.find((x) => x.보일경로 === 'a.txt');
  const b = 여럿.find((x) => x.보일경로 === 'b.txt');
  check('★★★ 여러 군데는 적은 순서대로 차례로 대 본다 (앞 고침 위에 뒤 고침)', a?.후 === '첫째\n둘\n셋\n', JSON.stringify(a?.후));
  check('★★ 못 찾는 것은 건너뛰고 나머지는 보인다 (실제 고치기와 같다)', 여럿.length === 2 && b?.후 === 'x = 2\n', JSON.stringify(여럿.map((x) => x.보일경로)));

  const 새 = 바뀔내용('Write', { file_path: '새.txt', content: '안녕\n' }, ctx);
  check('★★ 새 파일이면 전이 null', 새.length === 1 && 새[0].전 === null && 새[0].후 === '안녕\n', JSON.stringify(새));
  const 덮 = 바뀔내용('Write', { file_path: 'b.txt', content: 'y\n' }, ctx);
  check('★ 있는 파일을 덮으면 전은 지금 내용', 덮[0]?.전 === 'x = 1\n' && 덮[0]?.후 === 'y\n');
  const 붙 = 바뀔내용('Append', { file_path: 'b.txt', content: 'z = 3\n' }, ctx);
  check('★★ Append 는 끝에 붙인 모양', 붙[0]?.후 === 'x = 1\nz = 3\n', JSON.stringify(붙[0]?.후));

  check('★ 작업 폴더 밖이면 빈 배열 (물음은 한 줄로 뜬다)', 바뀔내용('Write', { file_path: join(tmpdir(), '밖.txt'), content: 'x' }, ctx).length === 0);
  check('★ 문서 파일(.docx)은 글로 못 보이니 빈 배열', 바뀔내용('Write', { file_path: 'r.docx', content: 'x' }, ctx).length === 0);
  check('★ 인자가 모자라면 빈 배열', 바뀔내용('Edit', { file_path: 'a.txt' }, ctx).length === 0);
  check('★ 읽는 도구는 빈 배열', 바뀔내용('Read', { file_path: 'a.txt' }, ctx).length === 0);
  check('  아무것도 안 고쳤다 (미리보기는 읽기만)', readFileSync(join(뿌리, 'a.txt'), 'utf8') === '하나\n둘\n셋\n' && !existsSync(join(뿌리, '새.txt')));

  const 줄 = 미리보기줄들(한).join('\n').replace(/\x1b\[[0-9;]*m/g, '');
  check('★★ 승인 물음 밑에 파일 이름과 바뀐 줄을 그린다', 줄.includes('a.txt') && /\+ .*둘둘/.test(줄) && /- .*둘/.test(줄), 줄);
  const 새줄 = 미리보기줄들(새).join('\n').replace(/\x1b\[[0-9;]*m/g, '');
  check('★ 새 파일이면 새 파일이라고 적는다', /새 파일|new file/.test(새줄), 새줄);
  check('★ 미리보기가 없으면 아무것도 안 그린다', 미리보기줄들([]).length === 0 && 미리보기줄들(undefined).length === 0);

  // ── 2차 눈(Gemini) 판정 ──
  // Append 는 CRLF 파일에 붙일 때 조각도 CRLF 로 바꿔 쓴다. 미리보기만 LF 로 이어 붙여 「본 것 ≠ 쓰인 것」 이었다.
  writeFileSync(join(뿌리, 'crlf.txt'), 'a\r\nb\r\n');
  ctx.seen.add(ctx.scope.resolve('crlf.txt'));
  const 붙crlf = 바뀔내용('Append', { file_path: 'crlf.txt', content: 'new\n' }, ctx);
  check('★★ CRLF 파일에 Append — 미리보기도 실제처럼 CRLF 로 붙인다', 붙crlf[0]?.후 === 'a\r\nb\r\nnew\r\n', JSON.stringify(붙crlf[0]?.후));
  // 여러 파일 Edit 에서 상한을 넘는 파일 하나만 빼고 그리면, 사람은 작은 파일만 바뀌는 줄 알고 허락한다.
  writeFileSync(join(뿌리, 'big.txt'), 'a'.repeat(2_000_100));
  ctx.seen.add(ctx.scope.resolve('big.txt'));
  const 큰섞임 = 바뀔내용('Edit', { edits: [
    { file_path: 'big.txt', old_string: 'aaaa', new_string: 'b' },
    { file_path: 'b.txt', old_string: 'x = 1', new_string: 'x = 9' },
  ] }, ctx);
  check('★★ 여러 파일 중 하나라도 너무 커서 못 그리면 미리보기를 통째로 안 낸다 (반쪽 미리보기 금지)', 큰섞임.length === 0, JSON.stringify(큰섞임.map((x) => x.보일경로)));
  // 고친 **뒤**가 커지는 것도 잰다 — replace_all 한 번에 수십 MB 가 동기 diff 로 넘어가면 승인 창이 안 뜬다.
  writeFileSync(join(뿌리, 'many.txt'), 'x\n'.repeat(1000));
  ctx.seen.add(ctx.scope.resolve('many.txt'));
  check('★ 고친 뒤가 상한을 넘으면 미리보기를 안 낸다', 바뀔내용('Edit', { file_path: 'many.txt', old_string: 'x', new_string: 'y'.repeat(3000), replace_all: true }, ctx).length === 0);
  // 실제 도구는 «가림:…» 표를 파일로 되돌리는 쓰기를 거절한다. 미리보기가 그것을 「바뀔 내용」 으로 그리면 본 것과 된 것이 다르다.
  check('★ 가린 표를 되돌리는 쓰기는 미리보기도 안 낸다 (실제 도구가 거절한다)',
    바뀔내용('Write', { file_path: 'b.txt', content: 'key=«가림:github»\n' }, ctx).length === 0
    && 바뀔내용('Edit', { file_path: 'b.txt', old_string: 'x = 1', new_string: 'x = «가림:github»' }, ctx).length === 0);
  // 파일이 많으면 한 파일에 6줄씩 주던 하한 때문에 50개면 400줄이 나와 물음이 화면 밖으로 밀렸다.
  const 쉰 = Array.from({ length: 50 }, (_, i) => ({ 경로: `f${i}`, 보일경로: `f${i}.js`, 전: 'a\nb\nc\nd\n', 후: '1\n2\n3\n4\n' }));
  const 쉰줄 = 미리보기줄들(쉰, { 줄수: 40 });
  const 쉰글 = 쉰줄.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
  check('★ 파일이 많아도 줄 수 한도를 크게 안 넘는다 — 파일 이름은 다 보인다', 쉰줄.length <= 50 + 40 && 쉰.every((x) => 쉰글.includes(x.보일경로)), `줄 ${쉰줄.length}`);
}

// ── 5. 관문 — 가짜 게이트웨이로 실제로 돌려 본다 ───────────────────────
trace('5-관문');
let 대본 = [];
const 서버 = createServer((q, res) => {
  let body = '';
  q.on('data', (d) => (body += d));
  q.on('end', () => {
    const 다음것 = 대본.shift();
    const 답 = 다음것
      ? { choices: [{ message: { content: null, tool_calls: [{ id: `c${대본.length}`, type: 'function', function: { name: 다음것.이름, arguments: JSON.stringify(다음것.인자) } }] }, finish_reason: 'tool_calls' }] }
      : { choices: [{ message: { content: '끝.' }, finish_reason: 'stop' }] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...답, usage: { prompt_tokens: 5, completion_tokens: 5 } }));
  });
});
await new Promise((r) => 서버.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${서버.address().port}/v1`;
resetNet();
allowEndpoint(base);

/** 도구 호출 하나를 시키고 돌린다. confirm 이 불린 것을 모아 돌려준다. */
async function 돌리기(부름, { mode = 'strict', 답 = false, confirm없음 = false, 규칙들 = null, mcp = null } = {}) {
  대본 = [부름];
  const 물음 = [];
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 32768, tools: true };
  const s = new Session(conn, { root: 뿌리, mode, work: 'code' });
  const ctx = {
    scope: makeScope(뿌리), history: new History(뿌리), audit: new Audit(뿌리), seen: new Set(), 규칙들, mcp,
    ...(confirm없음 ? {} : { confirm: async (이름, 인자, 곁것 = {}) => { 물음.push({ 이름, 인자, 미리보기: 곁것.미리보기 }); return 답; } }),
  };
  // Edit 은 먼저 Read 한 파일만 고친다 — 그 조건을 미리 채운다.
  for (const f of ['a.txt', 'b.txt', 'c.txt']) ctx.seen.add(ctx.scope.resolve(f));
  ctx.history.nextTurn();
  const 것들 = [];
  for await (const ev of run(s, ctx, '해 줘')) 것들.push(ev);
  const 결과 = 것들.filter((e) => e.type === 'tool').map((e) => e.result);
  // 모델에게 실제로 간 말 — 거절 까닭은 화면 사건이 아니라 도구 메시지로 간다.
  const 도구말 = s.messages.filter((m) => m.role === 'tool').map((m) => String(m.content ?? '')).join('\n');
  return { 물음, 결과, 도구말 };
}

{
  writeFileSync(join(뿌리, 'a.txt'), '하나\n');
  const 옮김 = await 돌리기({ 이름: 'Move', 인자: { from: 'a.txt', to: 'a2.txt' } });
  check('★★★ strict 는 Move 를 묻는다 (여태 안 묻고 옮겼다)', 옮김.물음.some((x) => x.이름 === 'Move'), JSON.stringify(옮김.물음.map((x) => x.이름)));
  check('★★ 거절하면 실제로 안 옮긴다', existsSync(join(뿌리, 'a.txt')) && !existsSync(join(뿌리, 'a2.txt')));

  writeFileSync(join(뿌리, 'b.txt'), 'x\n');
  const 붙임 = await 돌리기({ 이름: 'Append', 인자: { file_path: 'b.txt', content: 'y\n' } });
  check('★★★ strict 는 Append 를 묻는다', 붙임.물음.some((x) => x.이름 === 'Append'), JSON.stringify(붙임.물음.map((x) => x.이름)));
  check('★★ 물을 때 바뀔 내용을 같이 넘긴다', 붙임.물음[0]?.미리보기?.[0]?.후 === 'x\ny\n', JSON.stringify(붙임.물음[0]?.미리보기));
  check('  거절하면 실제로 안 붙인다', readFileSync(join(뿌리, 'b.txt'), 'utf8') === 'x\n');

  const 읽기 = await 돌리기({ 이름: 'Jobs', 인자: { job: 1 } });
  check('★★ Jobs 로 출력을 읽는 것은 안 묻는다 (읽을 때마다 물으면 y 만 치게 된다)', !읽기.물음.length, JSON.stringify(읽기.물음.map((x) => x.이름)));
  const 끝냄 = await 돌리기({ 이름: 'Jobs', 인자: { job: 1, stop: true } });
  check('★★ Jobs 로 뒤에서 도는 명령을 끝내는 것은 묻는다', 끝냄.물음.some((x) => x.이름 === 'Jobs'), JSON.stringify(끝냄.물음.map((x) => x.이름)));

  // 붙은 MCP 서버가 있어야 그 도구가 이번 목록에 실린다 (loop.js 의 실은mcp). 거절하니 실제로는 안 부른다.
  const 남의것 = await 돌리기({ 이름: 'mcp__srv__delete_all', 인자: {} },
    { mcp: [{ 이름: 'srv', 도구: [{ name: 'delete_all', description: '다 지운다' }] }] });
  check('★★ strict 는 MCP 도구를 묻는다 (무엇을 바꾸는지 우리가 모른다)', 남의것.물음.some((x) => x.이름 === 'mcp__srv__delete_all'),
    JSON.stringify(남의것.물음.map((x) => x.이름)));

  const 사람없음 = await 돌리기({ 이름: 'Write', 인자: { file_path: 'c.txt', content: '써짐\n' } }, { confirm없음: true });
  check('★★★ 물어볼 사람이 없으면 strict 는 실행하지 않는다 (여태 그대로 썼다)', !existsSync(join(뿌리, 'c.txt')));
  check('★ 왜 안 했는지 모델에게 말한다', /물어볼 사람이 없/.test(사람없음.도구말), 사람없음.도구말.slice(0, 200));

  const 자동 = await 돌리기({ 이름: 'Write', 인자: { file_path: 'c.txt', content: '써짐\n' } }, { mode: 'auto', 답: true });
  check('  auto 는 예전처럼 안 묻고 쓴다 (바닥이 없을 때)', !자동.물음.length && existsSync(join(뿌리, 'c.txt')));
  rmSync(join(뿌리, 'c.txt'), { force: true });
}

// 미리보기와 실제로 쓰인 것이 같은가 — 들여쓰기를 맞춰 고치는 판(reindent)으로 잰다.
{
  writeFileSync(join(뿌리, 'a.txt'), 'function f() {\r\n    return 1;\r\n}\r\n');
  const r = await 돌리기({ 이름: 'Edit', 인자: { file_path: 'a.txt', old_string: 'return 1;', new_string: 'return 2;\nreturn 3;' } }, { 답: true });
  const 본것 = r.물음[0]?.미리보기?.[0]?.후;
  const 쓰인것 = readFileSync(join(뿌리, 'a.txt'), 'utf8');
  check('★★★ 승인 창에서 본 내용과 실제로 쓰인 내용이 같다 (CRLF · 들여쓰기 맞춤까지)', !!본것 && 본것 === 쓰인것,
    `${JSON.stringify(본것)} vs ${JSON.stringify(쓰인것)}`);
}

// 관리 정책의 바닥 — auto 세션도 묻고, 사람이 적어 둔 「늘 허락」 도 못 건너뛴다.
if (시험정책먹나) {
  const 늘허락 = 규칙모으기({ permissions: { allow: ['Write'] } });
  const 정책없이 = await 돌리기({ 이름: 'Write', 인자: { file_path: 'c.txt', content: '1\n' } }, { mode: 'strict', 답: false, 규칙들: 늘허락 });
  check('  정책이 없으면 설정의 allow 가 strict 의 물음을 건너뛴다 (예전 그대로)', !정책없이.물음.length);
  rmSync(join(뿌리, 'c.txt'), { force: true });

  정책걸기({ approval: 'strict' });
  const 바닥 = await 돌리기({ 이름: 'Write', 인자: { file_path: 'c.txt', content: '1\n' } }, { mode: 'auto', 답: false });
  check('★★★ 정책 strict 면 auto 세션도 쓰기 전에 묻는다', 바닥.물음.some((x) => x.이름 === 'Write'), JSON.stringify(바닥.물음.map((x) => x.이름)));
  check('★★ 그 물음에 새 파일 미리보기가 실린다', 바닥.물음[0]?.미리보기?.[0]?.전 === null && 바닥.물음[0]?.미리보기?.[0]?.후 === '1\n');
  const 규칙도 = await 돌리기({ 이름: 'Write', 인자: { file_path: 'c.txt', content: '1\n' } }, { mode: 'auto', 답: false, 규칙들: 규칙모으기({ permissions: { allow: ['Write'] } }) });
  check('★★★ 정책 바닥이 있으면 설정의 allow 로도 물음을 못 건너뛴다', 규칙도.물음.some((x) => x.이름 === 'Write'), JSON.stringify(규칙도.물음.map((x) => x.이름)));
  check('  거절했으니 파일은 없다', !existsSync(join(뿌리, 'c.txt')));
  정책걸기(null);
}

서버.close();
rmSync(뿌리, { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });
if (원래정책 === undefined) delete process.env.DEEL_POLICY; else process.env.DEEL_POLICY = 원래정책;

// ── 마무리 ──────────────────────────────────────────────────────────────
const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n바꾸기 전에 사람이 본다  ${D}(모르고 누르는 y 는 확인이 아니다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
