// /commit — 이번 대화가 바꾼 것을 커밋한다.
//
// ── 무엇을 재나 ────────────────────────────────────────────────────────
//
// "커밋이 됐다" 는 재도 별 뜻이 없다. `git commit -m 아무거나` 도 그건 된다.
// 여기서 재는 것은 **Bash 로 치던 것과 무엇이 달라졌나** 다.
//
//   1) 담는 범위 — 이번 대화가 건드린 파일만. 옆 창에서 고치던 남의 파일이
//      묻어 들어가면, 그 사람은 제 변경이 언제 어디로 갔는지 못 찾는다.
//   2) 따옴표 — 제목에 " 와 %PATH% 와 $(…) 를 넣어도 글자 그대로 남는가.
//      `-m "…"` 로는 윈도우에서 이게 안 된다. 그래서 -F 로 넘긴다.
//   3) 정직 — 확인 안 된 것이 있으면 메시지에 그렇게 적히는가.
//   4) 안 되는 자리 — git 이 없거나, 저장소가 아니거나, 담을 것이 없을 때
//      던지지 않고 사람이 읽을 한 줄을 주는가.
//
// 모델은 가짜 게이트웨이로 세운다. 진짜 모델은 안 쓴다.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Session } from '../src/agent/session.js';
import { makeScope } from '../src/safety/guard.js';
import { Audit } from '../src/safety/audit.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import {
  깃, 깃있나, 저장소뿌리, 이번에바꾼것, 담긴것, 담기, 최근제목들,
  답가르기, 제목다듬기, 메시지꾸리기, 사실로만, 커밋준비, 커밋실행, 제목상한,
  꼬리표걸러내기, 메시지짓기,
} from '../src/agent/commit.js';
import { 커밋명령 } from '../src/commands/work.js';
import { VERSION } from '../src/version.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 끝내기 = () => {
  const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
  console.log('\n커밋 명령 검사\n');
  for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? D + '  ' + p.note + X : ''}`);
  for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
  console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
  process.exitCode = fail.length ? 1 : 0;
};

// ── 0. git 이 없으면 여기서 접는다 ─────────────────────────────────────
trace('0-git-있나');
if (!깃있나(process.cwd())) {
  console.log('\n  ⚠ 이 PC 에 git 이 없어 커밋 검사를 건너뜁니다.\n');
  process.exitCode = 0;
} else {

// ── 가짜 게이트웨이 ─────────────────────────────────────────────────────
let 답 = '제목: fix: 로그 형식을 하나로\n본문:\n서로 다른 두 형식이 섞여 있어 필터가 안 걸렸다.';
let 죽었나 = false;
let 마지막요청 = null;
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (죽었나) { res.writeHead(500); return res.end('{}'); }
    try { 마지막요청 = JSON.parse(body || '{}'); } catch { 마지막요청 = null; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: 답 }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 300, completion_tokens: 60 },
    }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/v1`;
resetNet();
allowEndpoint(base);
const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake-7b', ctx: 16000, streaming: false };

// ── 본보기 저장소 ───────────────────────────────────────────────────────
const 저장소만들기 = () => {
  const root = mkdtempSync(join(tmpdir(), 'deel-commit-'));
  깃(root, ['init', '-q', '-b', 'main']);
  깃(root, ['config', 'user.name', '검사']);
  깃(root, ['config', 'user.email', 'test@example.invalid']);
  깃(root, ['config', 'commit.gpgsign', 'false']);
  return root;
};
const 쓰기 = (root, rel, 글) => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, 글, 'utf8'); };
const 판만들기 = (root, 바꾼것 = []) => {
  const s = new Session(conn, { root });
  for (const f of 바꾼것) s.noteChange(join(root, f), { added: 3, removed: 1 });
  return s;
};
const ctx만들기 = (root) => ({ scope: makeScope(root), audit: new Audit(root) });
const 마지막메시지 = (root) => 깃(root, ['log', '-1', '--format=%B']).out;

// ── 1. 담는 범위 — 이번 대화 것만 ──────────────────────────────────────
trace('1-담는범위');
{
  const root = 저장소만들기();
  쓰기(root, 'a.js', 'let a = 1;\n');
  쓰기(root, '남의것.js', 'let b = 1;\n');
  깃(root, ['add', '-A']);
  깃(root, ['commit', '-q', '-m', 'chore: 첫 커밋']);

  쓰기(root, 'a.js', 'let a = 2;\n');            // 대화가 고친 것
  쓰기(root, '남의것.js', 'let b = 2;\n');        // 옆 창에서 고치던 것
  쓰기(root, 'new.js', 'let c = 3;\n');          // 대화가 새로 만든 것

  const s = 판만들기(root, ['a.js', 'new.js']);
  const ctx = ctx만들기(root);
  check('이번에 바꾼 것만 골라낸다', JSON.stringify(이번에바꾼것(s, root)) === JSON.stringify(['a.js', 'new.js']), 이번에바꾼것(s, root).join(' '));

  const r = await 커밋준비(s, ctx, {});
  check('준비가 됐다', r.ok === true, r.why ?? '');
  check('담긴 것은 대화가 건드린 둘뿐', JSON.stringify(r.파일들.sort()) === JSON.stringify(['a.js', 'new.js']), r.파일들.join(' '));
  const 상태 = 깃(root, ['status', '--short']).out;
  check('남의 파일은 안 담긴 채로 남아 있다', / M 남의것\.js/.test(상태), 상태.replace(/\n/g, ' | '));

  const 찍음 = 커밋실행(root, r.메시지, { audit: ctx.audit, 파일들: r.파일들, 제목: r.제목 });
  check('커밋이 찍혔다', 찍음.ok && /^[0-9a-f]{7,}$/.test(찍음.hash), 찍음.hash ?? 찍음.why);
  const 실린것 = 깃(root, ['show', '--name-only', '--format=', 'HEAD']).out.trim().split('\n').filter(Boolean).sort();
  check('커밋에 실린 것도 둘뿐', JSON.stringify(실린것) === JSON.stringify(['a.js', 'new.js']), 실린것.join(' '));
  check('남의 변경은 아직 커밋 안 된 채 남아 있다', / M 남의것\.js/.test(깃(root, ['status', '--short']).out));

  const 몸 = 마지막메시지(root);
  check('모델이 준 제목이 그대로 들어갔다', 몸.startsWith('fix: 로그 형식을 하나로'), 몸.split('\n')[0]);
  check('본문도 들어갔다', /필터가 안 걸렸다/.test(몸));
  check(`꼬리표가 붙었다 (deel ${VERSION} · fake-7b)`, new RegExp(`Generated-by: deel ${VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · fake-7b`).test(몸), 몸.trim().split('\n').pop());
  check('감사기록에 커밋이 남는다', ctx.audit.recent(50).some((x) => x.kind === 'commit' && x.hash === 찍음.hash));

  // 대화를 안 보낸다 — 담긴 diff 와 증거만 간다.
  const 보낸글 = JSON.stringify(마지막요청 ?? {});
  check('요청에 diff 가 들어간다', /diff/.test(보낸글) && /let a = 2/.test(보낸글));
  check('요청에 지금 대화는 안 들어간다', !/노출되면 안 되는 대화/.test(보낸글));
  rmSync(root, { recursive: true, force: true });
}

// ── 2. 따옴표 — -m 으로는 못 하던 것 ───────────────────────────────────
trace('2-따옴표');
{
  const root = 저장소만들기();
  쓰기(root, 'q.js', 'x\n');
  깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);
  쓰기(root, 'q.js', 'y\n');

  const 험한제목 = 'fix: "따옴표" 와 %PATH% 와 $(rm -rf /) 와 `백틱` 을 그대로';
  const s = 판만들기(root, ['q.js']);
  const r = await 커밋준비(s, ctx만들기(root), { 제목: 험한제목 });
  check('사람이 준 제목을 그대로 쓴다', r.제목 === 험한제목, r.제목);
  커밋실행(root, r.메시지, { 파일들: r.파일들, 제목: r.제목 });
  const 몸 = 마지막메시지(root);
  check('험한 글자가 한 글자도 안 상한 채로 남았다', 몸.split('\n')[0] === 험한제목, JSON.stringify(몸.split('\n')[0]));
  check('여러 줄 메시지가 여러 줄로 남았다', 몸.trim().split('\n').length >= 3, `${몸.trim().split('\n').length}줄`);

  // 본문만 달라고 했는데 모델이 형식을 통째로 흉내 낸 경우.
  쓰기(root, 'q.js', 'z\n');
  const s2 = 판만들기(root, ['q.js']);
  const r2 = await 커밋준비(s2, ctx만들기(root), { 제목: 'fix: 내가 정한 제목' });
  check('모델이 형식을 흉내 내도 본문에 "제목:" 이 안 남는다', !/^제목\s*:/m.test(r2.메시지), r2.메시지.split('\n').slice(0, 4).join(' | '));
  check('그래도 본문 알맹이는 살아 있다', /필터가 안 걸렸다/.test(r2.메시지));
  rmSync(root, { recursive: true, force: true });
}

// ── 3. 미리보기 · 전부 ─────────────────────────────────────────────────
trace('3-미리보기-전부');
{
  const root = 저장소만들기();
  쓰기(root, 'a.js', '1\n'); 깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);
  쓰기(root, 'a.js', '2\n');
  쓰기(root, 'b.js', '9\n');       // 대화가 안 건드린 것

  const 앞 = 깃(root, ['rev-parse', 'HEAD']).out.trim();
  const s = 판만들기(root, ['a.js']);
  const r = await 커밋준비(s, ctx만들기(root), {});
  check('미리보기용 준비만으로는 커밋이 안 찍힌다', 깃(root, ['rev-parse', 'HEAD']).out.trim() === 앞);
  check('미리보기에도 메시지와 상태가 다 들어 있다', !!r.메시지 && typeof r.상태 === 'string' && r.상태.includes('b.js'), r.상태.replace(/\n/g, ' | '));

  const s2 = 판만들기(root, ['a.js']);
  const r2 = await 커밋준비(s2, ctx만들기(root), { 전부: true });
  check('전부 는 대화가 안 건드린 것도 담는다', r2.파일들.includes('b.js') && r2.파일들.includes('a.js'), r2.파일들.join(' '));
  rmSync(root, { recursive: true, force: true });
}

// ── 3½. 열쇠가 든 .deel/ 은 '전부' 라고 해도 안 담는다 ─────────────────
trace('3-살림');
{
  const root = 저장소만들기();
  쓰기(root, 'a.js', '1\n'); 깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);
  쓰기(root, 'a.js', '2\n');
  쓰기(root, '.deel/config.json', '{"key":"sk-진짜열쇠-절대커밋금지"}\n');
  쓰기(root, '.deel/audit.jsonl', '{"kind":"tool"}\n');

  const s = 판만들기(root, ['a.js', '.deel/config.json']);   // 도구가 살림도 건드린 셈
  check('이번에 바꾼 것에서 살림은 빠진다', !이번에바꾼것(s, root).some((f) => f.startsWith('.deel')), 이번에바꾼것(s, root).join(' '));

  const r = await 커밋준비(s, ctx만들기(root), { 전부: true });
  check('전부 라고 해도 .deel/ 은 안 담긴다', !r.파일들.some((f) => f.startsWith('.deel')), r.파일들.join(' '));
  check('안 담았다고 말해 준다', r.살림뺌 === true);
  커밋실행(root, r.메시지, { 파일들: r.파일들, 제목: r.제목 });
  const 실린것 = 깃(root, ['show', '--name-only', '--format=', 'HEAD']).out;
  check('커밋에도 열쇠가 안 실렸다', !/\.deel/.test(실린것), 실린것.trim().replace(/\n/g, ' '));
  check('열쇠 글자가 저장소 이력 어디에도 없다', !/sk-진짜열쇠/.test(깃(root, ['log', '-p']).out));
  rmSync(root, { recursive: true, force: true });
}

// ── 3¾. 모노레포 — `전부` 는 작업 폴더까지다 ──────────────────────────
//
// 보안 검토가 잡은 자리다. 저장소 뿌리에 대고 add -A 를 하면, 하위 폴더에서
// 켰을 때 옆 팀 폴더와 그 안의 .env 까지 담기고 그 내용이 모델에게도 나간다.
trace('3-모노레포');
{
  const root = 저장소만들기();
  쓰기(root, 'packages/우리/app.js', '1\n');
  쓰기(root, 'packages/옆팀/.env', 'DB_PASSWORD=처음부터있던것\n');
  깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);

  const 우리 = join(root, 'packages', '우리');
  쓰기(root, 'packages/우리/app.js', '2\n');
  쓰기(root, 'packages/우리/.deel/config.json', '{"key":"sk-여기열쇠"}\n');
  쓰기(root, 'packages/옆팀/.env', 'DB_PASSWORD=옆팀이방금바꾼것\n');

  const s = new Session(conn, { root: 우리 });
  s.noteChange(join(우리, 'app.js'), { added: 1, removed: 1 });
  const r = await 커밋준비(s, { scope: makeScope(우리), audit: new Audit(우리) }, { 전부: true });
  check('전부 라도 작업 폴더 밖은 안 담는다', !r.파일들.some((f) => f.includes('옆팀')), r.파일들.join(' '));
  check('하위 폴더의 .deel 도 안 담는다', !r.파일들.some((f) => f.includes('.deel')), r.파일들.join(' '));
  check('그래도 제 폴더 것은 담는다', r.파일들.includes('packages/우리/app.js'), r.파일들.join(' '));
  const 보낸글 = JSON.stringify(마지막요청 ?? {});
  check('옆 팀 비밀이 모델에게 안 나간다', !/옆팀이방금바꾼것/.test(보낸글) && !/sk-여기열쇠/.test(보낸글));
  rmSync(root, { recursive: true, force: true });
}

// ── 3⅞. 이름이 다른 링크로 살림이 딸려 들어오면 ───────────────────────
trace('3-링크');
{
  const root = 저장소만들기();
  쓰기(root, 'a.js', '1\n'); 깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);
  쓰기(root, 'a.js', '2\n');
  쓰기(root, '.deel/config.json', '{"key":"sk-링크로샐뻔한열쇠"}\n');

  let 링크됨 = false;
  try { symlinkSync(join(root, '.deel'), join(root, '살림별칭'), 'junction'); 링크됨 = true; }
  catch { try { symlinkSync(join(root, '.deel'), join(root, '살림별칭'), 'dir'); 링크됨 = true; } catch { /* 권한이 없으면 건너뛴다 */ } }

  if (!링크됨) {
    check('⚠ 이 PC 에서는 링크를 못 만들어 건너뜀', true, '(관리자 권한·개발자 모드 필요)');
  } else {
    const s = 판만들기(root, ['a.js']);
    const r = await 커밋준비(s, ctx만들기(root), { 전부: true });
    check('링크로 들어온 살림도 안 담긴다', r.ok && !r.파일들.some((f) => /살림별칭|\.deel/.test(f)), (r.파일들 ?? []).join(' ') || r.why);
    if (r.ok) {
      커밋실행(root, r.메시지, { 파일들: r.파일들, 제목: r.제목 });
      check('열쇠 글자가 이력에 안 남는다', !/sk-링크로샐뻔한열쇠/.test(깃(root, ['log', '-p']).out));
    }
  }
  rmSync(root, { recursive: true, force: true });
}

// ── 3⅞+. 대소문자만 바꿔도 안 통한다 ──────────────────────────────────
trace('3-대소문자');
{
  const root = 저장소만들기();
  쓰기(root, 'a.js', '1\n'); 깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);
  쓰기(root, 'a.js', '2\n');
  쓰기(root, '.DEEL/config.json', '{"key":"sk-대소문자로샐뻔"}\n');

  const s = 판만들기(root, ['a.js', '.DEEL/config.json']);
  check('대소문자만 바꾼 살림도 골라내지 않는다', !이번에바꾼것(s, root).some((f) => /deel/i.test(f)), 이번에바꾼것(s, root).join(' '));
  const r = await 커밋준비(s, ctx만들기(root), { 전부: true });
  check('전부 로도 안 담긴다', r.ok && !r.파일들.some((f) => /deel/i.test(f)), (r.파일들 ?? []).join(' ') || r.why);
  rmSync(root, { recursive: true, force: true });
}

// ── 3⅞++. 모델이 쓴 글은 걸러서 넣는다 ────────────────────────────────
trace('3-거르기');
{
  const 험한제목 = `fix: 보이는 것과 ${''}[8m다른 것${''}[0m`;
  const 다듬 = 제목다듬기(험한제목);
  check('제목에서 터미널 제어문자를 뺀다', !/[\u0000-\u001f\u007f-\u009f]/.test(다듬.제목), JSON.stringify(다듬.제목));
  const 메시지 = 메시지꾸리기({
    제목: '제목',
    본문: `왜 고쳤나\nSigned-off-by: 없는사람 <x@y.z>\nCo-authored-by: 아무개 <a@b.c>\n진짜 몸통${''}[31m`,
    모델: 'm',
  });
  check('모델이 지어낸 서명 꼬리표를 지운다', !/Signed-off-by|Co-authored-by/i.test(메시지), 메시지.replace(/\n/g, ' | '));
  check('우리 꼬리표는 그대로 붙는다', /Generated-by: deel /.test(메시지));
  check('본문 알맹이는 안 지운다', /왜 고쳤나/.test(메시지) && /진짜 몸통/.test(메시지));
  check('본문에서도 제어문자를 뺀다', !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(메시지), JSON.stringify(메시지.slice(-40)));
}

// ── 3⅞+++. 폴더가 통째로 적혀 있어도 쓸어 담지 않는다 ────────────────
//
// 평가자가 잡은 자리다. `Move` 로 폴더를 옮기면 닿은 폴더가 '바뀐 것' 으로
// 적히는데, 그 폴더 안에는 남이 고치던 파일도 산다.
trace('3-폴더째');
{
  const root = 저장소만들기();
  쓰기(root, 'src/내것.js', '1\n');
  쓰기(root, 'src/남이고치던것.js', '남의 것 처음\n');
  깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);
  쓰기(root, 'src/내것.js', '2\n');
  쓰기(root, 'src/남이고치던것.js', '남이 방금 고친 것\n');

  const s = new Session(conn, { root });
  s.noteChange(join(root, 'src'), { added: 1, removed: 0 });        // 폴더가 통째로 적힌 경우
  s.noteChange(join(root, 'src/내것.js'), { added: 1, removed: 1 });
  const 고른것 = 이번에바꾼것(s, root);
  check('폴더는 담을 목록에서 빠진다', !고른것.includes('src') && 고른것.includes('src/내것.js'), 고른것.join(' '));
  check('빠진 폴더를 따로 알려 준다', (고른것.폴더 ?? []).includes('src'), JSON.stringify(고른것.폴더));

  const r = await 커밋준비(s, ctx만들기(root), {});
  check('남이 고치던 파일이 안 담긴다', !r.파일들.includes('src/남이고치던것.js'), r.파일들.join(' '));
  check('화면에 알릴 폴더 목록이 온다', (r.폴더통째 ?? []).includes('src'), JSON.stringify(r.폴더통째));
  rmSync(root, { recursive: true, force: true });
}

// ── 3⅞++++. 저장소 뿌리가 링크여도 「바꾼 게 없다」 고 안 한다 ────────
trace('3-링크뿌리');
{
  const 진짜뿌리 = 저장소만들기();
  쓰기(진짜뿌리, 'a.js', '1\n'); 깃(진짜뿌리, ['add', '-A']); 깃(진짜뿌리, ['commit', '-q', '-m', 'init']);
  쓰기(진짜뿌리, 'a.js', '2\n');

  const 링크 = join(mkdtempSync(join(tmpdir(), 'deel-link-')), '저장소');
  let 됐나 = false;
  try { symlinkSync(진짜뿌리, 링크, 'junction'); 됐나 = true; }
  catch { try { symlinkSync(진짜뿌리, 링크, 'dir'); 됐나 = true; } catch { /* 권한 없으면 건너뜀 */ } }

  if (!됐나) {
    check('⚠ 링크를 못 만들어 건너뜀', true, '(관리자 권한·개발자 모드 필요)');
  } else {
    const s = new Session(conn, { root: 링크 });
    s.noteChange(join(링크, 'a.js'), { added: 1, removed: 1 });
    const r = await 커밋준비(s, { scope: makeScope(링크), audit: new Audit(진짜뿌리) }, {});
    check('링크로 연 저장소에서도 바꾼 것을 찾는다', r.ok === true && r.파일들.includes('a.js'), r.why ?? r.파일들.join(' '));

    /*
     * ★★ 링크로 연 저장소에서 **지운 파일**.
     *
     * 링크를 푸는 일은 없는 파일에서 실패한다 — 그러면 적힌 이름이 그대로
     * 돌아온다. 뿌리는 풀려서 진짜 자리가 되는데 파일은 안 풀려서 링크
     * 자리로 남으니, 둘을 견주면 `..` 가 나오고 저장소 밖으로 걸러진다.
     *
     * 걸러지는 게 이 파일 하나가 아니다. 지운 것이 이번에 바꾼 전부이면
     * 목록이 **통째로 비고**, 부르는 쪽은 그걸 「바꾼 게 없다」 로 읽어
     * **작업 폴더 전부**로 물러선다. 옆 창에서 고치던 남의 것까지 담기는,
     * 이 파일이 없애려고 만들어진 바로 그 사고다 — 경고 한 줄 없이.
     *
     * 지운 파일은 `/commit` 이 제일 자주 다루는 것 중 하나다(그래서 담기가
     * `-A` 를 쓴다). 흔한 자리에서 제일 위험한 쪽으로 조용히 넘어가면 안 된다.
     */
    쓰기(진짜뿌리, '지울것.js', 'x\n');
    깃(진짜뿌리, ['add', '-A']); 깃(진짜뿌리, ['commit', '-q', '-m', '둘']);
    rmSync(join(진짜뿌리, '지울것.js'), { force: true });

    const s2 = new Session(conn, { root: 링크 });
    s2.noteChange(join(링크, '지울것.js'), { added: 0, removed: 1 });
    const 것 = 이번에바꾼것(s2, 링크);
    check('★★ 링크로 연 저장소에서 지운 파일도 목록에 남는다',
      것.includes('지울것.js'), 것.join(',') || '(빈 목록 — 저장소 전부로 물러선다)');

    const r2 = await 커밋준비(s2, { scope: makeScope(링크), audit: new Audit(진짜뿌리) }, {});
    check('★★ 그래서 남의 것까지 담지 않는다',
      r2.ok === true && r2.파일들.length === 1 && r2.파일들[0] === '지울것.js',
      r2.why ?? r2.파일들.join(','));
  }
  rmSync(진짜뿌리, { recursive: true, force: true });
}

/*
 * ── 3⅞+++++. 윈도우 8.3 단축명 ─────────────────────────────────────────
 *
 * 윈도우는 여덟 자가 넘는 이름에 `LONGDI~1` 같은 짧은 별명을 같이 만든다.
 * `realpathSync` 는 링크는 풀어도 이 별명은 **안 편다.** 그래서 우리가 짧은
 * 이름으로 들고 있고 git 이 긴 이름으로 답하면, 같은 파일이 서로 남남이 되어
 * 「저장소 밖」 으로 걸러진다 — 하나가 아니라 전부. 목록이 통째로 비고,
 * 부르는 쪽은 그걸 「바꾼 게 없다」 로 읽어 **작업 폴더 전부**로 물러선다.
 *
 * 남 일이 아니다. 윈도우 사용자 이름이 여덟 자만 넘으면 `%TEMP%` 가 통째로
 * 단축명이 된다(`C:\Users\RUNNER~1\AppData\Local\Temp`). CI 의 윈도우 러너가
 * 정확히 그 경우여서, 이 검사 파일은 **열 판 동안 CI 에서 빨간불**이었다.
 * 사람 이름이 여덟 자 이하인 기계에서는 재현이 안 된다 — 그래서 안 잡혔다.
 */
trace('3-단축명');
if (process.platform === 'win32') {
  const 진짜뿌리 = 저장소만들기();
  const 긴이름 = join(진짜뿌리, 'longdirname12345');
  mkdirSync(긴이름);
  쓰기(긴이름, 'a.js', '1\n');
  깃(진짜뿌리, ['add', '-A']); 깃(진짜뿌리, ['commit', '-q', '-m', 'init']);
  쓰기(긴이름, 'a.js', '2\n');

  // 이 볼륨이 8.3 이름을 안 만들 수도 있다(끌 수 있는 설정이다). 그때는 건너뛴다.
  let 짧은이름 = null;
  try {
    const out = execFileSync('cmd', ['/c', 'dir', '/x', '/a:d', 진짜뿌리], { encoding: 'utf8', windowsHide: true });
    const 줄 = out.split(/\r?\n/).find((l) => /longdirname12345/i.test(l));
    const m = 줄 && 줄.match(/\s([A-Z0-9~]{1,8}(?:\.[A-Z0-9]{1,3})?)\s+longdirname12345/i);
    if (m) 짧은이름 = m[1];
  } catch { /* 못 물어보면 건너뛴다 */ }

  if (!짧은이름) {
    check('⚠ 이 볼륨은 8.3 이름을 안 만들어 건너뜀', true, '(NtfsDisable8dot3NameCreation)');
  } else {
    const 짧은길 = join(진짜뿌리, 짧은이름);
    const s = new Session(conn, { root: 짧은길 });
    s.noteChange(join(짧은길, 'a.js'), { added: 1, removed: 1 });

    const 것 = 이번에바꾼것(s, 긴이름);
    check('★★ 단축명으로 적혀 있어도 같은 파일로 본다',
      것.includes('a.js'), 것.join(',') || `(빈 목록 — ${짧은이름} 를 밖으로 걸렀다)`);

    /*
     * 물러섰는지 아닌지를 **가릴 수 있게** 남의 파일을 하나 둔다.
     * 파일이 하나뿐이면 물러서도 개수가 같아서 검사가 아무것도 안 재게 된다.
     */
    쓰기(진짜뿌리, '남의것.js', '옆 창에서 고치던 것\n');
    const r = await 커밋준비(s, { scope: makeScope(긴이름), audit: new Audit(긴이름) }, {});
    check('★★ 그래서 저장소 전부로 안 물러선다',
      r.ok === true && !r.파일들.some((f) => f.includes('남의것')),
      r.why ?? r.파일들.join(','));
    check('바꾼 것은 그대로 담는다',
      (r.파일들 ?? []).some((f) => f.endsWith('a.js')), (r.파일들 ?? []).join(','));
  }
  rmSync(진짜뿌리, { recursive: true, force: true });
}

// ── 4. 안 되는 자리 ────────────────────────────────────────────────────
trace('4-안되는자리');
{
  const 맨땅 = mkdtempSync(join(tmpdir(), 'deel-nogit-'));
  const s = 판만들기(맨땅, ['a.js']);
  const r = await 커밋준비(s, { scope: makeScope(맨땅) }, {});
  check('저장소가 아니면 한 줄로 말하고 끝난다', r.ok === false && /저장소가 아닙니다/.test(r.why), r.why);
  check('던지지 않는다', typeof r === 'object');
  rmSync(맨땅, { recursive: true, force: true });

  const root = 저장소만들기();
  쓰기(root, 'a.js', '1\n'); 깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);
  const 빈판 = 판만들기(root, []);
  const r2 = await 커밋준비(빈판, ctx만들기(root), {});
  check('바꾼 것이 없으면 그렇게 말한다', r2.ok === false && /바꾼 파일이 없습니다/.test(r2.why), r2.why);

  // 고쳤다고 적혀 있지만 실제 내용은 그대로 — 담아도 diff 가 안 나온다.
  const 헛판 = 판만들기(root, ['a.js']);
  const r3 = await 커밋준비(헛판, ctx만들기(root), {});
  check('담을 내용이 없으면 그렇게 말한다', r3.ok === false && /담을 것이 없습니다/.test(r3.why), r3.why);

  const 나쁜메시지 = 커밋실행(join(root, '없는폴더'), '제목\n', {});
  check('없는 폴더에 찍으라 해도 안 던진다', 나쁜메시지.ok === false && typeof 나쁜메시지.why === 'string', 나쁜메시지.why?.slice(0, 40));
  check('git 이 없는 셈 치는 자리도 값으로 답한다', 깃(root, ['이런건없다']).ok === false);
  rmSync(root, { recursive: true, force: true });
}

// ── 5. 제목이 길면 — 자르되 버리지 않는다 ──────────────────────────────
trace('5-긴제목');
{
  const 긴것 = '이 제목은 아주 길어서 일흔두 자를 넘기고도 한참을 더 이어지며 절대로 멈추지 않고 계속 이어지는 아주 긴 제목입니다 정말로 깁니다';
  const 다듬 = 제목다듬기(긴것);
  check('제목은 72자 이내로 줄어든다', [...다듬.제목].length <= 제목상한, `${[...다듬.제목].length}자`);
  check('잘린 뒷부분은 버리지 않는다', 다듬.남은것.length > 0 && 긴것.includes(다듬.남은것.slice(0, 10)), 다듬.남은것.slice(0, 24));
  check('자른 자리를 합치면 원래 글이다', (다듬.제목 + ' ' + 다듬.남은것).replace(/\s+/g, '') === 긴것.replace(/\s+/g, ''));

  const root = 저장소만들기();
  쓰기(root, 'a.js', '1\n'); 깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);
  쓰기(root, 'a.js', '2\n');
  const 옛답 = 답;
  답 = `제목: ${긴것}\n본문:\n왜 고쳤는지.`;
  const s = 판만들기(root, ['a.js']);
  const r = await 커밋준비(s, ctx만들기(root), {});
  커밋실행(root, r.메시지, { 파일들: r.파일들, 제목: r.제목 });
  const 몸 = 마지막메시지(root);
  const 첫줄 = 몸.split('\n')[0];
  check('커밋 제목 줄이 72자를 안 넘는다', [...첫줄].length <= 제목상한, `${[...첫줄].length}자`);
  check('넘친 부분이 본문에 남아 있다', 몸.includes(다듬.남은것.slice(0, 12)), 몸.split('\n').slice(0, 4).join(' | '));
  check('모델이 쓴 본문도 그대로 있다', /왜 고쳤는지/.test(몸));
  답 = 옛답;
  rmSync(root, { recursive: true, force: true });
}

// ── 6. 정직 — 확인 안 된 것은 메시지에 적힌다 ─────────────────────────
trace('6-검증줄');
{
  const 있음 = 메시지꾸리기({ 제목: 'fix: 뭐', 본문: '왜', 확인: 2, 미확인: 3, 모델: 'm' });
  const 없음 = 메시지꾸리기({ 제목: 'fix: 뭐', 본문: '왜', 확인: 5, 미확인: 0, 모델: 'm' });
  check('미확인이 있으면 검증 줄이 붙는다', /검증: 2건 확인 · 3건 미확인/.test(있음), 있음.split('\n').filter(Boolean).join(' | '));
  check('미확인이 없으면 검증 줄을 안 만든다', !/검증:/.test(없음));
  check('꼬리표는 늘 붙는다', /Generated-by: deel /.test(있음) && /Generated-by: deel /.test(없음));
  check('본문이 비어도 꼴이 안 깨진다', 메시지꾸리기({ 제목: 't', 본문: '', 모델: '' }).startsWith('t\n\nGenerated-by:'));

  const root = 저장소만들기();
  쓰기(root, 'a.js', '1\n'); 깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);
  쓰기(root, 'a.js', '2\n');
  const s = 판만들기(root, ['a.js']);      // 고치기만 하고 아무것도 안 돌렸다
  const r = await 커밋준비(s, ctx만들기(root), {});
  check('아무것도 안 돌렸으면 미확인으로 센다', r.미확인 >= 1, `확인 ${r.확인} · 미확인 ${r.미확인}`);
  check('그 사실이 메시지에 적힌다', /검증: \d+건 확인 · \d+건 미확인/.test(r.메시지), r.메시지.split('\n').filter((x) => x.startsWith('검증')).join(''));
  rmSync(root, { recursive: true, force: true });
}

// ── 7. 모델이 못 만들면 — 지어내지 않는다 ──────────────────────────────
trace('7-모델실패');
{
  const root = 저장소만들기();
  쓰기(root, 'a.js', '1\n'); 깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);
  쓰기(root, 'a.js', '2\n');
  죽었나 = true;
  const s = 판만들기(root, ['a.js']);
  const r = await 커밋준비(s, ctx만들기(root), {});
  죽었나 = false;
  check('모델이 죽어도 커밋은 된다', r.ok === true, r.why ?? '');
  check('지어내지 않고 사실만 적었다고 말한다', r.사실로만 === true && /만들지 못해/.test(r.메시지), r.메시지.split('\n')[2] ?? '');
  check('그래도 제목은 쓸 만하다', /a\.js/.test(r.제목), r.제목);
  rmSync(root, { recursive: true, force: true });
}

// ── 8. 모델 답 읽기 — 세 가지 꼴을 다 받는다 ──────────────────────────
trace('8-답읽기');
{
  const 표 = [
    ['제목: fix: 하나\n본문:\n왜 고쳤나', 'fix: 하나', '왜 고쳤나'],
    ['제목 : fix: 띄어쓰기\n본문 :\n몸통', 'fix: 띄어쓰기', '몸통'],
    ['{"제목":"feat: 제이슨","본문":"몸통 줄"}', 'feat: 제이슨', '몸통 줄'],
    ['{"title":"feat: english","body":"why"}', 'feat: english', 'why'],
    ['```\n제목: fix: 울타리\n본문:\n안쪽\n```', 'fix: 울타리', '안쪽'],
    ['그냥 한 줄만 답함', '그냥 한 줄만 답함', ''],
    ['첫 줄이 제목\n\n나머지는 본문', '첫 줄이 제목', '나머지는 본문'],
  ];
  for (const [글, 제목, 본문] of 표) {
    const r = 답가르기(글);
    check(`답 읽기: ${JSON.stringify(글.slice(0, 26))}…`, r?.제목 === 제목 && r?.본문 === 본문, JSON.stringify(r));
  }
  check('빈 답은 못 읽은 것으로 친다', 답가르기('') === null && 답가르기('   \n ') === null);
  check('따옴표로 감싼 제목은 벗긴다', 제목다듬기('"fix: 따옴표"').제목 === 'fix: 따옴표');
  check('끝의 마침표는 뗀다', 제목다듬기('fix: 마침표.').제목 === 'fix: 마침표');
  const 사실 = 사실로만(['a.js', 'b.js'], '');
  check('사실만 적기: 파일 수를 센다', /a\.js 외 1개/.test(사실.제목), 사실.제목);
}

// ── 9. 남이 먼저 담아 둔 것은 풀지 않고 알린다 ────────────────────────
trace('9-남의index');
{
  const root = 저장소만들기();
  쓰기(root, 'a.js', '1\n'); 쓰기(root, '남의것.js', '1\n');
  깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);
  쓰기(root, 'a.js', '2\n');
  쓰기(root, '남의것.js', '2\n');
  깃(root, ['add', '--', '남의것.js']);          // 사람이 먼저 담아 뒀다

  const s = 판만들기(root, ['a.js']);
  const r = await 커밋준비(s, ctx만들기(root), {});
  check('남이 담아 둔 것을 말없이 풀지 않는다', r.파일들.includes('남의것.js'), r.파일들.join(' '));
  check('대신 화면에 알릴 목록으로 준다', r.남의것.includes('남의것.js'), JSON.stringify(r.남의것));
  rmSync(root, { recursive: true, force: true });
}

// ── 10. 저장소 말투 흉내 · 최근 제목 ───────────────────────────────────
trace('10-말투');
{
  const root = 저장소만들기();
  쓰기(root, 'a.js', '1\n'); 깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'feat: 하나']);
  쓰기(root, 'a.js', '2\n'); 깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'fix: 둘']);
  check('최근 제목을 읽어 온다', JSON.stringify(최근제목들(root, 5)) === JSON.stringify(['fix: 둘', 'feat: 하나']), 최근제목들(root, 5).join(' | '));

  쓰기(root, 'a.js', '3\n');
  const s = 판만들기(root, ['a.js']);
  await 커밋준비(s, ctx만들기(root), {});
  const 보낸글 = JSON.stringify(마지막요청 ?? {});
  check('그 제목들을 모델에게 보여 준다', /feat: 하나/.test(보낸글) && /fix: 둘/.test(보낸글));

  const 빈저장소 = 저장소만들기();
  check('커밋이 하나도 없어도 안 터진다', Array.isArray(최근제목들(빈저장소)) && 최근제목들(빈저장소).length === 0);
  mkdirSync(join(root, '깊은/폴더'), { recursive: true });
  check('하위 폴더에서 불러도 저장소 뿌리를 찾는다', 저장소뿌리(root) !== null && 저장소뿌리(join(root, '깊은/폴더')) !== null, String(저장소뿌리(join(root, '깊은/폴더'))));
  /*
    * 「글이 왔다」 로는 **빈 글**도 통과한다. 그런데 담긴 것을 못 읽는 고장은
    * 정확히 빈 글로 나타난다 — 커밋 글을 지을 때 아무것도 못 보고 짓게 된다.
    * 방금 담은 파일 이름이 그 안에 있어야 읽은 것이다.
    */
  깃(root, ['add', '-A']);
  const 담김 = 담긴것(root);
  check('★ 담긴 것을 읽는다 — 방금 담은 것이 그 안에 있다',
    typeof 담김.diff === 'string' && /a\.js/.test(담김.diff) && /\+3/.test(담김.diff),
    String(담김.diff).slice(0, 160));
  rmSync(빈저장소, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}


trace('11-못-읽은-것을-없는-것으로-적지-않나');

/*
 * ── git 이 **답을 못 한 것**과 **답이 없는 것**은 다르다 ────────────────
 *
 * 담긴것() 이 git 을 세 번 부르면서 ok 를 한 번도 안 봤다. 그래서 실패가
 * 전부 빈 값으로 내려갔고, 부르는 쪽이 그것을 「바뀐 것이 없다」 로 읽었다.
 *
 *   · index 가 깨지면 목록부터 죽는다 → 화면에 「담을 것이 없습니다 —
 *     바뀐 내용이 없습니다」. 사람은 제 일이 안 담긴 줄 알고 다시 담으러
 *     가는데, 실제로 할 일은 저장소를 손보는 것이다.
 *   · 담긴 diff 가 64MB 를 넘으면 몸통만 죽는다(spawnSync 의 maxBuffer).
 *     목록은 멀쩡하니 커밋은 그대로 이어지고, **빈 diff 를 받은 모델**이
 *     「무엇을 바꿨는지는 diff 에 이미 있다」 는 지시 아래 메시지를 짓는다.
 */
{
  const root = 저장소만들기();
  쓰기(root, 'a.js', '1' + '\n');
  깃(root, ['add', '-A']);
  const 멀쩡 = 담긴것(root);
  check('멀쩡할 때는 못 읽은 것이 없다', 멀쩡.못읽음.length === 0, JSON.stringify(멀쩡.못읽음));

  // index 를 깨뜨린다 — 읽기 전용 판·잠긴 저장소와 같은 꼴이다.
  writeFileSync(join(root, '.git', 'index'), 'not an index');
  const 깨짐 = 담긴것(root);
  check('★★ 목록을 못 읽으면 못 읽었다고 한다',
    깨짐.못읽음.some((x) => x.무엇 === '목록'), JSON.stringify(깨짐.못읽음).slice(0, 90));

  rmSync(root, { recursive: true, force: true });
}

/*
 * ── 목록은 읽히는데 **몸통만** 못 읽는 판 ───────────────────────────────
 *
 * 실제로 겪는 것은 담긴 diff 가 64MB 를 넘을 때다(spawnSync 의 maxBuffer).
 * 큰 데이터 덤프·묶은 번들은 이 도구가 실제로 만드는 것들이다. 여기서는
 * 70MB 를 쓰는 대신 알맹이 하나를 깨뜨려 같은 꼴을 만든다 — git 은 이름은
 * 대되 내용은 못 편다.
 *
 * 그때 커밋은 그대로 이어진다. 문제는 **빈 diff 를 받은 모델**이
 * 「무엇을 바꿨는지는 diff 에 이미 있다」 는 지시 아래 메시지를 짓는 것이다.
 * 볼 것이 없으니 지어낸다. 그래서 모델에게도 화면에도 못 봤다고 말해야 한다.
 */
{
  const root = 저장소만들기();
  쓰기(root, 'a.js', '한 줄\n');
  깃(root, ['add', '-A']);
  깃(root, ['config', 'diff.external', '안깔린도구xyz']);

  const 담김 = 담긴것(root);
  check('목록은 그대로 읽힌다', 담김.파일들.length === 1, JSON.stringify(담김.파일들));
  check('★ 몸통을 못 읽은 것을 따로 적는다',
    담김.못읽음.some((x) => x.무엇 === 'diff'), JSON.stringify(담김.못읽음).slice(0, 80));

  const s = 판만들기(root, ['a.js']);
  const r = await 커밋준비(s, ctx만들기(root), {});
  check('★★ 커밋은 이어 가되 못 봤다고 돌려준다',
    r.ok === true && !!r.diff못읽음, `ok=${r.ok} · why=${r.why} · 못읽음=${r.diff못읽음}`);
  check('★★ 모델에게도 못 봤다고 말한다',
    /diff 를 못 읽었습니다/.test(JSON.stringify(마지막요청 ?? {})),
    JSON.stringify(마지막요청 ?? {}).slice(0, 120));
  rmSync(root, { recursive: true, force: true });
}

/*
 * 증거를 재는 쪽이 셈 칸을 못 채우고 돌려줄 때가 있다(잰 파일이 하나도
 * 없을 때). 그때 `증거.셈.파일` 로 파고들면 커밋이 TypeError 로 통째로
 * 죽는다 — 사람이 한 일은 다 담긴 채로 남고, 화면에는 무슨 소리인지 모를
 * 오류만 뜬다.
 */
{
  const root = 저장소만들기();
  쓰기(root, 'a.js', 'x\n');
  깃(root, ['add', '-A']);
  let 터짐 = null;
  const r = await 메시지짓기(판만들기(root, ['a.js']), {
    뿌리: root, diff: 'x', 통계: '', 파일들: ['a.js'], 증거: {},
  }).catch((e) => { 터짐 = e; return null; });
  check('★ 증거에 셈 칸이 없어도 안 터진다', 터짐 === null && !!r, String(터짐?.message ?? '').slice(0, 60));
  rmSync(root, { recursive: true, force: true });
}

/*
 * 가지가 커밋이 아닌 것을 가리키게 되면(어긋난 ref) `git add` 는 그대로
 * 되는데 diff 셋이 다 죽는다. 목록이 비어서 내려오므로, 안 보고 그대로
 * 믿으면 「바뀐 내용이 없습니다」 가 뜬다 — 사람은 제 일이 안 담긴 줄 알고
 * 다시 담으러 가는데, 실제로 할 일은 저장소를 손보는 것이다.
 */
{
  const root = 저장소만들기();
  쓰기(root, 'a.js', 'x' + '\n');
  깃(root, ['add', '-A']);
  깃(root, ['commit', '-m', '처음', '--no-gpg-sign']);
  const 가지 = 깃(root, ['symbolic-ref', 'HEAD']).out.trim();
  const 알맹이 = 깃(root, ['rev-parse', ':a.js']).out.trim();
  쓰기(root, 'b.js', 'y' + '\n');
  writeFileSync(join(root, '.git', 가지), 알맹이 + '\n');

  const 담김 = 담긴것(root);
  check('★ 목록을 못 읽은 것을 따로 적는다',
    담김.파일들.length === 0 && 담김.못읽음.some((x) => x.무엇 === '목록'),
    JSON.stringify(담김.못읽음).slice(0, 70));

  const r = await 커밋준비(판만들기(root, ['b.js']), ctx만들기(root), {});
  check('★★ 못 읽은 것을 「바뀐 내용이 없습니다」 로 안 적는다',
    r.ok === false && /못 읽었습니다/.test(String(r.why)) && !/바뀐 내용이 없습니다/.test(String(r.why)),
    String(r.why).slice(0, 70));
  rmSync(root, { recursive: true, force: true });
}

trace('12-다른-드라이브·꼬리표·전각콜론');

{
  /*
   * 저장소 밖 경로가 `git add` 에 실리면 git 이
   * `fatal: … is outside repository` 로 죽고 /commit 이 통째로 안 된다.
   * 담지 말아야 할 것 하나 때문에 담아야 할 것도 다 못 담는 꼴이다.
   */
  const root = 저장소만들기();
  const 밖 = join(tmpdir(), '남의폴더', 'a.txt');
  const s = { changes: new Map([[밖, {}]]) };
  check('★ 저장소 밖에 있는 파일은 안 담는다',
    이번에바꾼것(s, root).length === 0, JSON.stringify(이번에바꾼것(s, root)));

  /*
   * 윈도우에서 **드라이브가 다르면** relative() 가 `..` 를 못 만들고 절대경로를
   * 그대로 돌려준다. 그래서 위의 `..` 검사를 그냥 지나간다. 리눅스·맥에는
   * 드라이브 글자가 없어서 `D:\…` 가 그냥 파일 이름이므로 여기서만 잰다.
   */
  if (process.platform === 'win32') {
    const 딴드라이브 = { changes: new Map([['D:' + '\\' + '남의폴더' + '\\' + 'a.txt', {}]]) };
    check('★ 다른 드라이브에 있는 파일도 안 담는다',
      이번에바꾼것(딴드라이브, root).length === 0, JSON.stringify(이번에바꾼것(딴드라이브, root)));
  }
  rmSync(root, { recursive: true, force: true });
}

{
  /*
   * `Closes #123` 이 기본 가지에 실리면 **깃허브가 그 이슈를 진짜로 닫는다.**
   * 모델이 지어낸 번호면 남의 이슈가 닫히고, 커밋을 되돌려도 안 열린다.
   * 걸러내는 목록에 closes·fixes 가 들어 있었는데 끝에 콜론이 붙어 있어서,
   * 정작 깃허브가 알아보는 꼴만 한 번도 안 걸렸다.
   */
  check('★★ 이슈를 닫는 줄을 걸러낸다',
    꼬리표걸러내기('왜 고쳤나' + '\n' + 'Closes #123' + '\n' + 'Fixes #456' + '\n' + 'Resolves https://x/y/1') === '왜 고쳤나',
    JSON.stringify(꼬리표걸러내기('왜 고쳤나' + '\n' + 'Closes #123' + '\n' + 'Fixes #456')));
  check('★ 본문에 든 진짜 문장은 안 지운다',
    /Fixes the crash/.test(꼬리표걸러내기('Fixes the crash when the index is broken.' + '\n' + '마무리')),
    꼬리표걸러내기('Fixes the crash when the index is broken.' + '\n' + '마무리'));
  check('사람 서명 꼴은 그대로 걸러낸다',
    꼬리표걸러내기('본문' + '\n' + 'Signed-off-by: 아무개 <a@b.c>') === '본문');
}

{
  // 작은 모델이 전각 콜론을 쓴다. `[::]` 는 반각 두 개라 `[:]` 와 같았고,
  // 그래서 라벨이 그대로 제목에 남아 「제목： …」 이라는 커밋이 찍혔다.
  const r = 답가르기('제목： 로그인 고침' + '\n' + '본문： 왜 고쳤나');
  check('★ 전각 콜론으로 적어도 제목·본문을 가른다',
    r?.제목 === '로그인 고침' && r?.본문 === '왜 고쳤나', JSON.stringify(r));
}

{
  /*
   * ── ★★ (사냥5 H5-4) 파일 이름이 git 에게는 글롭이었다 ──────────────────
   *
   * 담을 경로를 `git add -A -- <경로>` 에 그대로 넣었다. git 은 그 자리를 **패스스펙**
   * 으로 읽어서 `[ab].txt` 를 「a.txt 나 b.txt」 로도 푼다. 이번 대화가 만든 것은
   * `[ab].txt` 하나인데 옆 창에서 고치던 a.txt·b.txt 까지 같이 담겨 남의 커밋에 실렸다
   * — 이 명령이 없애려던 `git add -A` 사고가 이름 한 글자로 되돌아온 것이다.
   * `/commit 전부` 의 작업 폴더 이름(`sub[1]`)도 같은 길로 `sub1/` 을 쓸어 담았다.
   */
  const root = 저장소만들기();
  쓰기(root, 'a.txt', 'a1\n');
  쓰기(root, 'b.txt', 'b1\n');
  // 글롭 `sub[1]` 은 **경로 전체**가 `sub1` 인 것에 걸린다 — 그래서 옆에 그 이름의 파일을 둔다.
  쓰기(root, 'sub1', 'y1\n');
  쓰기(root, 'sub[1]/x.txt', 'x1\n');
  깃(root, ['add', '-A']);
  깃(root, ['commit', '-q', '-m', 'chore: 첫 커밋']);

  쓰기(root, 'a.txt', 'a2 남이 고침\n');
  쓰기(root, 'b.txt', 'b2 남이 고침\n');
  쓰기(root, '[ab].txt', '이번 대화가 만든 것\n');
  const 내것 = 이번에바꾼것(판만들기(root, ['[ab].txt']), root);
  담기(root, 내것);
  const 담긴 = 담긴것(root).파일들;
  check('★★ (사냥5 H5-4) 이름에 [ ] 가 든 파일을 담아도 글롭으로 풀려 남의 파일이 딸려 오지 않는다',
    JSON.stringify(담긴) === JSON.stringify(['[ab].txt']), 담긴.join(' '));
  깃(root, ['reset', '-q']);

  쓰기(root, 'sub1', 'y2 남이 고침\n');
  쓰기(root, 'sub[1]/x.txt', 'x2 여기서 고침\n');
  담기(root, [], { 전부: true, 안쪽: 'sub[1]' });
  const 폴더담긴 = 담긴것(root).파일들;
  check('★★ (사냥5 H5-4) 작업 폴더 이름에 [ ] 가 있어도 그 폴더 것만 담는다',
    JSON.stringify(폴더담긴) === JSON.stringify(['sub[1]/x.txt']), 폴더담긴.join(' '));
  rmSync(root, { recursive: true, force: true });
}

{
  /*
   * ── ★ (6회차 커밋 C6) 줄바꿈이 CRLF 인 답의 울타리 ───────────────────────
   *
   * 울타리를 벗기는 무늬가 줄바꿈을 LF 로만 알았다. 윈도에서 도는 게이트웨이나
   * 일부 로컬 모델은 CRLF 로 답하는데, 그러면 울타리가 안 벗겨지고 JSON 인 줄도
   * 모른 채 줄글로 갈라져 **커밋 제목이 ```json** 으로 찍혔다. `제목:` 꼴은
   * 제목은 맞게 갈라도 본문 끝에 울타리 ``` 가 그대로 남았다.
   */
  const 줄끝 = String.fromCharCode(13, 10);
  const r = 답가르기(['```json', '{"제목":"fix: 로그 고침","본문":"왜 고쳤나"}', '```'].join(줄끝));
  check('★ (6회차 C6) CRLF 로 싸인 JSON 울타리도 벗겨서 제목·본문을 가른다',
    r?.제목 === 'fix: 로그 고침' && r?.본문 === '왜 고쳤나', JSON.stringify(r));
  const r2 = 답가르기(['```', '제목: fix: 로그 고침', '본문:', '왜 고쳤나', '```'].join(줄끝));
  check('★ (6회차 C6) CRLF 울타리의 제목: 꼴도 본문 끝에 울타리가 안 남는다',
    r2?.제목 === 'fix: 로그 고침' && r2?.본문 === '왜 고쳤나', JSON.stringify(r2));
}

{
  /*
   * ── ★ (6회차 커밋 C5) 파일 이름의 빈칸을 잘라 적었다 ──────────────────────
   *
   * 담긴 목록을 줄로 받아 줄마다 trim 했다. 이름이 빈칸으로 시작하는 파일은
   * 다른 이름으로 적혔고(` 앞빈칸.txt` → `앞빈칸.txt`), 살림에 닿나를 그 없는
   * 이름으로 봤다. 리눅스에서는 탭·따옴표·줄바꿈이 든 이름이 C 따옴표로 싸여
   * 와서 더 멀리 어긋난다. NUL 로 끊어 받으면 git 이 이름을 손대지 않는다.
   */
  const root = 저장소만들기();
  쓰기(root, ' 앞빈칸.txt', 'x\n');
  깃(root, ['add', '-A']);
  const 담김 = 담긴것(root).파일들;
  check('★ (6회차 C5) 이름이 빈칸으로 시작하는 파일을 잘라서 적지 않는다',
    JSON.stringify(담김) === JSON.stringify([' 앞빈칸.txt']), JSON.stringify(담김));
  rmSync(root, { recursive: true, force: true });
}

{
  /*
   * ── ★★ (6회차 커밋 C2) 서브모듈 안 파일 하나가 커밋을 통째로 막았다 ─────────
   *
   * 이번 대화가 서브모듈 안 파일과 바깥 파일을 같이 고치면, 서브모듈 안 경로가
   * 그대로 `git add` 에 실려 `fatal: Pathspec … is in submodule` 로 죽었다.
   * 담아야 할 바깥 파일까지 못 담고 /commit 이 통째로 안 됐다. 등록 안 된 안쪽
   * 저장소는 거꾸로 조용했다 — add 가 0 으로 끝나고 아무것도 안 담았는데 말이 없었다.
   * 딴 저장소 안의 것은 빼고, 뺐다고 말한다.
   */
  const 남 = 저장소만들기();
  쓰기(남, 'f.txt', '1\n');
  깃(남, ['add', '-A']);
  깃(남, ['commit', '-q', '-m', 'chore: 처음']);
  const root = 저장소만들기();
  쓰기(root, 'top.txt', '1\n');
  깃(root, ['add', '-A']);
  깃(root, ['commit', '-q', '-m', 'chore: 처음']);
  const 붙임 = 깃(root, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', 남, 'sub']);
  깃(root, ['commit', '-q', '-m', 'chore: 서브모듈']);
  쓰기(root, 'sub/f.txt', '2\n');
  쓰기(root, 'top.txt', '2\n');
  쓰기(root, 'inner/g.txt', '1\n');
  깃(join(root, 'inner'), ['init', '-q']);

  const 바꾼것 = ['sub/f.txt', 'top.txt', 'inner/g.txt'];
  const 내것 = 이번에바꾼것(판만들기(root, 바꾼것), root);
  check('★★ (6회차 C2) 서브모듈·안쪽 저장소 안 파일은 담을 거리에서 빼고 따로 돌려준다',
    붙임.ok && JSON.stringify([...내것]) === '["top.txt"]' && JSON.stringify(내것.딴저장소) === '["inner","sub"]',
    `${붙임.err.trim().slice(0, 40)} ${JSON.stringify([...내것])} ${JSON.stringify(내것.딴저장소)}`);
  const r = await 커밋준비(판만들기(root, 바꾼것), ctx만들기(root));
  check('★★ (6회차 C2) 서브모듈 안을 같이 고쳐도 바깥 파일은 담기고, 뺀 자리를 말한다',
    r.ok && JSON.stringify(r.파일들) === '["top.txt"]' && JSON.stringify(r.딴저장소) === '["inner","sub"]',
    r.ok ? JSON.stringify(r.딴저장소) : r.why);
  깃(root, ['reset', '-q']);
  const 안쪽만 = await 커밋준비(판만들기(root, ['sub/f.txt']), ctx만들기(root));
  check('★ (6회차 C2) 딴 저장소 안만 바꿨으면 그렇다고 말한다 (바꾼 파일이 없다고 하지 않는다)',
    !안쪽만.ok && /sub/.test(안쪽만.why) && !/바꾼 파일이 없습니다/.test(안쪽만.why), 안쪽만.why);
  rmSync(root, { recursive: true, force: true });
  rmSync(남, { recursive: true, force: true });
}

{
  /*
   * ── ★ (6회차 커밋 C9) 제목을 줬을 때 `본문:` 표식이 커밋에 남았다 ──────────
   *
   * 제목을 사람이 정하면 모델에게 본문만 달라고 한다. 작은 모델은 그래도
   * `본문:` 표식을 붙여 답하는데, `제목:` 이 없으면 가르지 않고 껍질만 벗겨
   * `본문:` 이라는 줄이 커밋 본문 첫 줄로 찍혔다.
   */
  const root = 저장소만들기();
  쓰기(root, 'a.js', 'x\n');
  깃(root, ['add', '-A']);
  const 옛답 = 답;
  답 = '본문:' + '\n' + '두 형식이 섞여 필터가 안 걸렸다.';
  const r = await 메시지짓기(판만들기(root, ['a.js']), {
    뿌리: root, diff: 'x', 통계: '', 파일들: ['a.js'], 증거: {}, 제목: 'fix: 로그 형식',
  });
  답 = 옛답;
  check('★ (6회차 C9) 제목을 줬는데 모델이 본문: 표식을 붙여 답해도 표식을 안 남긴다',
    r?.제목 === 'fix: 로그 형식' && r?.본문 === '두 형식이 섞여 필터가 안 걸렸다.', JSON.stringify(r));
  rmSync(root, { recursive: true, force: true });
}

trace('커밋6t-실패뒤담긴것');
{
  /*
   * ── ★ (6회차 커밋6t V3) 커밋이 실패하면 담은 것이 남는데 말이 없었다 ──────
   *
   * /commit 은 메시지를 짓기 전에 `git add` 를 한다. 미리보기 · 엄격 모드 무름
   * 갈래는 「담은 것은 그대로 둡니다」 라고 적는데, **git commit 이 실패한**
   * 갈래(훅 거절 등)만 git 오류 한 줄로 끝났다. index 는 바뀐 채이고 사람은
   * 아무 일도 안 난 줄 안다 — 다음 손 커밋에 에이전트가 담은 것이 섞인다.
   */
  const root = 저장소만들기();
  쓰기(root, 'a.js', 'let a = 1;\n');
  깃(root, ['add', '-A']);
  깃(root, ['commit', '-q', '-m', 'init']);
  쓰기(root, 'a.js', 'let a = 2;\n');
  const 훅 = join(root, '.git', 'hooks', 'pre-commit');
  쓰기(root, join('.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho blocked-by-hook >&2\nexit 1\n');
  try { chmodSync(훅, 0o755); } catch { /* 윈도우는 실행 비트가 없어도 git 이 sh 로 돌린다 */ }
  const 원래 = process.stdout.write.bind(process.stdout);
  let 모인것 = '';
  process.stdout.write = (chunk) => { 모인것 += chunk; return true; };
  try { await 커밋명령(판만들기(root, ['a.js']), ctx만들기(root), ''); } finally { process.stdout.write = 원래; }
  const 글 = 모인것.replace(/\x1b\[[0-9;]*m/g, '');
  const 담긴채 = 깃(root, ['diff', '--cached', '--name-only']).out.trim();
  check('훅이 커밋을 막는 판이 섰다', /blocked-by-hook/.test(글) && 깃(root, ['rev-list', '--count', 'HEAD']).out.trim() === '1', 글.slice(-160).replace(/\n/g, ' | '));
  check('★ (6회차 커밋6t V3) 커밋이 실패하면 담은 것이 그대로 남았다고 말한다',
    담긴채 === 'a.js' && /그대로 둡니다/.test(글) && /git reset/.test(글), `담긴 것 ${담긴채} · ${글.slice(-160).replace(/\n/g, ' | ')}`);
  rmSync(root, { recursive: true, force: true });
}

trace('커밋8-지워진폴더');
{
  /*
   * ── ★★ (8회차 커밋 1) 지워진 폴더를 파일로 쳐서 남의 것까지 담았다 ────────
   *
   * 폴더는 담을 목록에서 빼기로 해 놓고(위 3⅞+++), **지워진** 폴더만 그 그물을
   * 빠져나갔다. stat 이 던지면 「지워진 것은 파일로 친다」 쪽으로 갔기 때문이다.
   * 그 이름이 `git add -A -- :(literal)src` 로 나가면 git 은 그 아래 **전부**를
   * 담는다 — 옆 창에서 고치던 남의 파일이 이번 커밋에 실린다. 이 파일이
   * 없애려고 만들어진 바로 그 `git add -A` 사고가 이름만 바꿔 되돌아온 것이다.
   */
  const root = 저장소만들기();
  쓰기(root, 'src/내것.js', '1\n');
  쓰기(root, 'src/남이고치던것.js', '1\n');
  깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);
  rmSync(join(root, 'src'), { recursive: true, force: true });    // 폴더째 지웠다

  const s = new Session(conn, { root });
  s.noteChange(join(root, 'src'), { added: 0, removed: 2 });       // 닿은 폴더가 통째로 적힌다
  s.noteChange(join(root, 'src/내것.js'), { added: 0, removed: 1 });
  const 고른것 = 이번에바꾼것(s, root);
  check('★★ (8회차 커밋 1) 지워진 폴더도 담을 목록에서 뺀다',
    !고른것.includes('src') && 고른것.includes('src/내것.js'), JSON.stringify([...고른것]));
  check('★ (8회차 커밋 1) 지워진 폴더도 빠졌다고 따로 알려 준다',
    (고른것.폴더 ?? []).includes('src'), JSON.stringify(고른것.폴더));
  담기(root, 고른것);
  const 담긴 = 담긴것(root).파일들;
  check('★★ (8회차 커밋 1) 남이 고치던 파일의 삭제가 딸려 담기지 않는다',
    JSON.stringify(담긴) === JSON.stringify(['src/내것.js']), 담긴.join(' '));
  rmSync(root, { recursive: true, force: true });
}

trace('커밋8-제목꼬리표');
{
  /*
   * ── ★★ (8회차 커밋 2) 제목만 꼬리표를 안 걸렀다 ──────────────────────────
   *
   * 본문은 꼬리표걸러내기() 를 거치는데 제목은 맨몸으로 나갔다. 모델이
   * `Fixes #123` 한 줄만 제목으로 주면 그게 커밋 첫 줄이 되고, 그 커밋이 기본
   * 가지에 실리는 순간 **깃허브가 그 이슈를 진짜로 닫는다.** 모델이 지어낸
   * 번호면 남의 이슈가 닫히고, 커밋을 되돌려도 닫힌 이슈는 안 열린다.
   */
  const root = 저장소만들기();
  쓰기(root, 'a.js', '1\n'); 깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);
  쓰기(root, 'a.js', '2\n');
  const 옛답 = 답;
  답 = '제목: Fixes #123\n본문:\n왜 고쳤나';
  const r = await 커밋준비(판만들기(root, ['a.js']), ctx만들기(root), {});
  답 = 옛답;
  const 첫줄 = (r.메시지 ?? '').split('\n')[0];
  check('★★ (8회차 커밋 2) 모델이 지은 제목이 이슈를 닫는 줄이면 커밋에 안 싣는다',
    r.ok === true && !/#123/.test(r.메시지 ?? ''), r.ok ? JSON.stringify(첫줄) : r.why);
  check('★ (8회차 커밋 2) 대신 사실만 적은 제목이 선다',
    !!r.제목 && /a\.js/.test(r.제목 ?? ''), r.제목 ?? '');
  check('★ (8회차 커밋 2) 모델이 쓴 본문은 그대로 남는다', /왜 고쳤나/.test(r.메시지 ?? ''));
  rmSync(root, { recursive: true, force: true });
}

trace('커밋8-온점·라벨·따옴표·자른마침표');
{
  /*
   * ── ★ (8회차 커밋 3) 온점 하나로 이슈 닫는 줄이 통과했다 ─────────────────
   *
   * 무늬가 `#123` 뒤에 곧바로 줄 끝을 요구해서, 모델이 문장처럼 `Fixes #123.`
   * 이라고 쓰면 안 걸렸다. 깃허브는 온점이 있어도 그 이슈를 닫는다.
   */
  check('★ (8회차 커밋 3) 온점이 붙은 이슈 닫는 줄도 걸러낸다',
    꼬리표걸러내기('왜 고쳤나' + '\n' + 'Fixes #123.' + '\n' + 'Closes #456,') === '왜 고쳤나',
    JSON.stringify(꼬리표걸러내기('왜 고쳤나' + '\n' + 'Fixes #123.')));
  check('★ (8회차 커밋 3) 그래도 진짜 문장은 안 지운다',
    /Fixes the crash/.test(꼬리표걸러내기('Fixes the crash when the index is broken.')));

  /*
   * ── ★ (8회차 커밋 4) 앞쪽 사족의 `본문:` 을 찾아 라벨이 남았다 ────────────
   *
   * 본문 표식을 무늬로 찾아 놓고 자리는 indexOf 로 다시 뒤졌다. 같은 글자가
   * 앞줄 사족에 끼어 있으면 그 자리가 먼저 걸려서, 진짜 `본문:` 라벨이 커밋
   * 본문 안에 그대로 남는다.
   */
  const 사족 = 답가르기(['제목: 로그 고침', '설명: 아래 본문:은 이렇습니다', '본문:진짜 몸통'].join('\n'));
  check('★ (8회차 커밋 4) 앞줄에 같은 글자가 있어도 진짜 본문 표식 뒤부터 읽는다',
    사족?.제목 === '로그 고침' && 사족?.본문 === '진짜 몸통', JSON.stringify(사족));

  /*
   * ── ★ (8회차 커밋 5) 따옴표를 벗긴다고 적고 안 벗겼다 ────────────────────
   *
   * 답 전체를 따옴표로 싸서 주는 모델이 있다. 그러면 첫 줄이 `"제목: …` 이라
   * `제목:` 무늬가 안 걸리고, 줄글로 읽혀 **라벨째** 커밋 제목이 된다.
   */
  const 싸인것 = 답가르기('"제목: fix: 로그 고침' + '\n' + '본문: 왜 고쳤나"');
  check('★ (8회차 커밋 5) 답을 통째로 싼 따옴표를 벗기고 제목·본문을 가른다',
    싸인것?.제목 === 'fix: 로그 고침' && 싸인것?.본문 === '왜 고쳤나', JSON.stringify(싸인것));
  check('★ (8회차 커밋 5) 안쪽에 같은 따옴표가 또 있으면 인용문이라 안 벗긴다',
    답가르기('"이렇게" 고쳤다 "정말로"')?.제목 === '"이렇게" 고쳤다 "정말로"',
    JSON.stringify(답가르기('"이렇게" 고쳤다 "정말로"')));

  /*
   * ── ★ (8회차 커밋 6) 자른 제목 끝에 마침표가 남았다 ──────────────────────
   *
   * 마침표는 **자르기 전** 끝에서만 뗐다. 넘쳐서 문장 경계에서 잘리면 그
   * 자리의 마침표가 그대로 남아, 지시문이 못 박은 「마침표 없이」 를 어긴
   * 제목이 찍힌다.
   */
  const 문장둘 = 'fix: 첫 문장은 여기서 끝을 맺습니다 정말로 여기서 끝나는 문장입니다.'
    + ' ' + '그리고두번째문장은띄어쓰기하나없이아주길게계속이어집니다정말끝없이이어져요그러니까잘립니다';
  const 자른것 = 제목다듬기(문장둘);
  check('★ (8회차 커밋 6) 자른 제목 끝에도 마침표를 안 남긴다',
    !/[.。]$/.test(자른것.제목) && [...자른것.제목].length <= 제목상한, JSON.stringify(자른것.제목));
  check('★ (8회차 커밋 6) 잘린 뒷부분은 그대로 본문으로 넘어간다',
    자른것.남은것.startsWith('그리고두번째문장은'), 자른것.남은것.slice(0, 20));
}

trace('커밋2-git이모르는이름');
{
  /*
   * ── ★★ (8회차 커밋2) git 이 모르는 이름 하나가 /commit 을 통째로 막았다 ──
   *
   * 이번 대화가 만들었다가 **지운** 파일은 git 이 한 번도 본 적이 없는 이름이다.
   * 그 이름이 그대로 `git add -A -- :(literal)<이름>` 에 실리면 git 은
   * `fatal: pathspec … did not match any files` 로 죽는다. 그리고 add 는 하나라도
   * 못 맞추면 **아무것도 안 담고** 끝난다 — 같이 실은 a.js 도 안 담긴다.
   * 그러면 커밋준비() 는 「담지 못했습니다」 한 줄만 내고 커밋이 통째로 안 된다.
   * 담을 수 없는 이름 하나 때문에 담을 수 있는 것까지 못 담는 꼴이 제일 나쁘다.
   *
   * 그렇다고 지운 것을 다 빼면 안 된다 — **추적하던** 파일의 삭제는 담아야 한다.
   */
  const root = 저장소만들기();
  쓰기(root, 'a.js', '1\n');
  쓰기(root, '지웠던것.js', '1\n');
  깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);

  쓰기(root, 'a.js', '2\n');                                    // 담아야 할 것
  쓰기(root, '임시.txt', 'tmp\n');
  rmSync(join(root, '임시.txt'), { force: true });               // 만들었다 지운 것 — git 이 모르는 이름
  rmSync(join(root, '지웠던것.js'), { force: true });            // 추적하던 것의 삭제 — 이건 담아야 한다

  const 고른것 = 이번에바꾼것(판만들기(root, ['a.js', '임시.txt', '지웠던것.js']), root);
  check('★★ (8회차 커밋2) git 이 모르는 이름은 담을 목록에서 뺀다',
    !고른것.includes('임시.txt') && 고른것.includes('a.js'), JSON.stringify([...고른것]));
  check('★★ (8회차 커밋2) 추적하던 파일의 삭제는 그대로 담는다',
    고른것.includes('지웠던것.js'), JSON.stringify([...고른것]));
  check('★ (8회차 커밋2) 뺐다는 것을 따로 알려 준다',
    (고른것.모르는이름 ?? []).includes('임시.txt'), JSON.stringify(고른것.모르는이름));

  const 담은결과 = 담기(root, 고른것);
  check('★★ (8회차 커밋2) 못 담을 이름 하나가 나머지를 못 담게 만들지 않는다',
    담은결과.ok === true, (담은결과.err || '').trim());
  check('★★ (8회차 커밋2) 나머지는 하나도 안 빠지고 담겼다',
    JSON.stringify(담긴것(root).파일들) === JSON.stringify(['a.js', '지웠던것.js']), 담긴것(root).파일들.join(' '));

  const r = await 커밋준비(판만들기(root, ['a.js', '임시.txt', '지웠던것.js']), ctx만들기(root), {});
  check('★★ (8회차 커밋2) 통째로 안 되던 /commit 이 선다',
    r.ok === true && JSON.stringify(r.파일들) === JSON.stringify(['a.js', '지웠던것.js']), r.ok ? r.파일들.join(' ') : r.why);
  check('★ (8회차 커밋2) 준비한 것에도 뺀 이름이 실려 화면이 말할 수 있다',
    (r.모르는이름 ?? []).includes('임시.txt'), JSON.stringify(r.모르는이름));
  // 삭제가 먼저 담겨 있던 파일은 index 에서도 이름이 사라져 같은 그물에 걸린다.
  // 그건 이번 커밋에 제대로 실린 것이니 「안 담았습니다」 에 끼면 안 된다.
  check('★ (8회차 커밋2) 커밋에 실린 것은 안 담은 것으로 말하지 않는다',
    !(r.모르는이름 ?? []).includes('지웠던것.js'), JSON.stringify(r.모르는이름));
  rmSync(root, { recursive: true, force: true });

  /*
   * 만들었다 지운 것**뿐**이면 「이번 대화에서 바꾼 파일이 없습니다」 는 거짓이다 —
   * 바꾸긴 했는데 git 이 담을 수 없는 이름인 것이다. 무엇을 뺐는지 그대로 말한다.
   */
  const 뿌리2 = 저장소만들기();
  쓰기(뿌리2, 'a.js', '1\n'); 깃(뿌리2, ['add', '-A']); 깃(뿌리2, ['commit', '-q', '-m', 'init']);
  쓰기(뿌리2, '임시2.txt', 'x\n'); rmSync(join(뿌리2, '임시2.txt'), { force: true });
  const r2 = await 커밋준비(판만들기(뿌리2, ['임시2.txt']), ctx만들기(뿌리2), {});
  check('★ (8회차 커밋2) 만들었다 지운 것뿐이면 그 이름을 대고 까닭을 말한다',
    r2.ok === false && /임시2\.txt/.test(r2.why ?? '') && !/pathspec/.test(r2.why ?? ''), r2.why ?? '');
  rmSync(뿌리2, { recursive: true, force: true });
}

trace('커밋2-화면이-뺀이름을-말하나');
{
  /*
   * ── ★ (8회차 커밋2) 뺀 이름을 **화면이** 말해야 한다 ──────────────────
   *
   * 커밋준비() 는 모르는이름 을 돌려주는데 그것을 찍는 자리는 여기(work.js) 하나뿐이다.
   * 안 찍으면, 담을 것이 **같이 있는** 판에서는 커밋이 그냥 되면서 그 이름들만 조용히
   * 빠진다 — 「만들었다 지운 것뿐」 인 판만 why 로 말하고 있었다. 사람은 제가 만들었다
   * 지운 파일이 왜 커밋에 없는지를 알 자리가 없다. 폴더통째·딴저장소를 찍는 것과 같은
   * 까닭이고 같은 꼴이다.
   */
  const root = 저장소만들기();
  쓰기(root, 'a.js', '1\n');
  깃(root, ['add', '-A']); 깃(root, ['commit', '-q', '-m', 'init']);

  쓰기(root, 'a.js', '2\n');                                    // 담을 것
  쓰기(root, '임시3.txt', 'tmp\n');
  rmSync(join(root, '임시3.txt'), { force: true });              // git 이 모르는 이름

  const 원래 = process.stdout.write.bind(process.stdout);
  let 모인것 = '';
  process.stdout.write = (chunk) => { 모인것 += chunk; return true; };
  try {
    await 커밋명령(판만들기(root, ['a.js', '임시3.txt']), ctx만들기(root), '미리보기');
  } finally { process.stdout.write = 원래; }
  const 글 = 모인것.replace(/\x1b\[[0-9;]*m/g, '');

  check('★ (8회차 커밋2) 담은 것이 같이 있어도 뺀 이름을 화면이 말한다',
    /임시3\.txt/.test(글), 글.replace(/\s+/g, ' ').slice(0, 220));
  check('★ (8회차 커밋2) 왜 못 담았는지도 같이 적는다',
    /git 이 한 번도 본 적 없는 이름/.test(글), 글.replace(/\s+/g, ' ').slice(0, 220));
  check('  담을 것은 그대로 담았다고 말한다', /a\.js/.test(글), 글.replace(/\s+/g, ' ').slice(0, 160));
  rmSync(root, { recursive: true, force: true });
}

server.close();
}

끝내기();
