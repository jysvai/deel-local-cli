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
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Session } from '../src/agent/session.js';
import { makeScope } from '../src/safety/guard.js';
import { Audit } from '../src/safety/audit.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import {
  깃, 깃있나, 저장소뿌리, 이번에바꾼것, 담긴것, 최근제목들,
  답가르기, 제목다듬기, 메시지꾸리기, 사실로만, 커밋준비, 커밋실행, 제목상한,
} from '../src/agent/commit.js';
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
  check(`꼬리표가 붙었다 (deel ${VERSION} · fake-7b)`, new RegExp(`Generated-by: deel ${VERSION.replace(/\./g, '\\.')} · fake-7b`).test(몸), 몸.trim().split('\n').pop());
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
  check('제목에서 터미널 제어문자를 뺀다', !/[ --]/.test(다듬.제목), JSON.stringify(다듬.제목));
  const 메시지 = 메시지꾸리기({
    제목: '제목',
    본문: `왜 고쳤나\nSigned-off-by: 없는사람 <x@y.z>\nCo-authored-by: 아무개 <a@b.c>\n진짜 몸통${''}[31m`,
    모델: 'm',
  });
  check('모델이 지어낸 서명 꼬리표를 지운다', !/Signed-off-by|Co-authored-by/i.test(메시지), 메시지.replace(/\n/g, ' | '));
  check('우리 꼬리표는 그대로 붙는다', /Generated-by: deel /.test(메시지));
  check('본문 알맹이는 안 지운다', /왜 고쳤나/.test(메시지) && /진짜 몸통/.test(메시지));
  check('본문에서도 제어문자를 뺀다', !/[ ---]/.test(메시지), JSON.stringify(메시지.slice(-40)));
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
  check('담긴 것을 읽는다', typeof 담긴것(root).diff === 'string');
  rmSync(빈저장소, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}

server.close();
}

끝내기();
