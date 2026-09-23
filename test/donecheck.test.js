/**
 * 완료 검사 — 「다 됐습니다」 를 모델의 말이 아니라 검사 결과로 가르는가 (2.1.0 · agent/donecheck.js).
 *
 * ── 왜 이 파일이 있나 ──────────────────────────────────────────────────
 *
 * 사내 검토: 「검증을 정적 검사에 기대면 한계가 있다 · 루프를 더 다듬어야 한다」. 여태 턴은 모델이
 * 도구를 안 부르고 말만 하면 끝났다. 사람이 검사 명령을 정해 두면 이제 deel 이 그걸 돌리고,
 * 실패하면 출력을 돌려주고 이어서 고치게 한다.
 *
 * 화면 글이 아니라 **검사가 실제로 몇 번 돌았나**(runs.log 에 한 글자씩 적힌다) ·
 * **모델에게 무엇이 갔나** · **deel run 이 무슨 종료코드로 끝났나** 로 잰다.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const home = mkdtempSync(join(tmpdir(), 'deel-donecheck-home-'));
process.env.DEEL_HOME = home;
const 원래정책 = process.env.DEEL_POLICY;

const { 검사설정, 실패말, 출력꼬리, 통과했나, 기본판수, 최대판수, 기본시간 } = await import('../src/agent/donecheck.js');
const { Session } = await import('../src/agent/session.js');
const { run } = await import('../src/agent/loop.js');
const { makeScope } = await import('../src/safety/guard.js');
const { History } = await import('../src/safety/undo.js');
const { Audit } = await import('../src/safety/audit.js');
const { allowEndpoint, resetNet } = await import('../src/safety/network.js');
const { 규칙모으기 } = await import('../src/safety/policy.js');

const here = dirname(fileURLToPath(import.meta.url));
const 진입점 = join(here, '..', 'bin', 'deel.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 1. 설정 읽기 ───────────────────────────────────────────────────────
trace('1-설정');
{
  check('★★ check 가 없으면 null — 고리를 안 돈다', 검사설정({}) === null && 검사설정({ check: '  ' }) === null && 검사설정({ check: 3 }) === null);
  const 기본 = 검사설정({ check: ' npm test ' });
  check('★ 명령은 앞뒤 빈칸을 뗀다 · 판수 기본 3 · 시간 기본 10분', 기본?.명령 === 'npm test' && 기본.판수 === 기본판수 && 기본.시간 === 기본시간, JSON.stringify(기본));
  check('★ 판수는 1 ~ 10 에서만 받는다', 검사설정({ check: 'x', checkRounds: 99 }).판수 === 최대판수
    && 검사설정({ check: 'x', checkRounds: 0 }).판수 === 기본판수 && 검사설정({ check: 'x', checkRounds: 1.5 }).판수 === 기본판수
    && 검사설정({ check: 'x', checkRounds: 2 }).판수 === 2);
  check('  시간은 초로 받아 1초 ~ 10분에 가둔다', 검사설정({ check: 'x', checkTimeout: 30 }).시간 === 30_000
    && 검사설정({ check: 'x', checkTimeout: 99999 }).시간 === 기본시간 && 검사설정({ check: 'x', checkTimeout: 0.1 }).시간 === 1000);
  check('★★ --check 로 준 명령이 설정을 이긴다', 검사설정({ check: 'a' }, 'b').명령 === 'b');
  check('  --check 에 빈 글을 주면 안 돈다 (설정으로 되돌아가지 않는다)', 검사설정({ check: 'a' }, '') === null);

  const 긴것 = 'x'.repeat(10_000) + '마지막줄';
  check('★ 출력은 **뒤를** 남긴다 — 무엇이 틀렸는지는 대개 끝에 있다', 출력꼬리(긴것, 100).endsWith('마지막줄') && 출력꼬리(긴것, 100).length < 200);
  check('  통과는 종료코드 0 인 것만', 통과했나({ content: 'ok' }) && !통과했나({ content: 'x', failed: true }) && !통과했나({ error: '시간 초과' }) && !통과했나(null));
  const 말 = 실패말({ 명령: 'npm test', 출력: 'AssertionError: 1 !== 2', 판: 1, 최대: 3 });
  check('★★ 실패말에 명령 · 판수 · 출력이 들어간다', /npm test/.test(말) && /1\/3/.test(말) && /AssertionError/.test(말), 말);
  check('★★ 검사를 고치거나 지워서 통과시키지 말라고 적는다', /검사 자체를 고치거나 지우지/.test(말));
  check('  영어로 켜면 영어로', /Do not edit or delete the check itself/.test(실패말({ 명령: 'x', 출력: '', 판: 1, 최대: 2 }, { 영어: true })));
}

// ── 2. 가짜 게이트웨이 ──────────────────────────────────────────────────
//
// 대본은 **대화를 보고** 정한다. 마지막 말이 도구 결과면 「끝」 을, 사람 말이면 쓰기를 부른다.
// 완료 검사의 실패말이 오면 시킨 말의 표시에 따라 고치거나(일부러_고침) 또 틀리거나(일부러_계속틀림)
// 아무것도 안 바꾸고 끝낸다(일부러_안고침).
trace('2-게이트웨이');
let 받은것 = [];
const 셸 = (명령) => ({ tool_calls: [{ id: `b${Math.random().toString(36).slice(2, 7)}`, type: 'function', function: { name: 'Bash', arguments: JSON.stringify({ command: 명령 }) } }] });
const 쓰기 = (내용) => ({ tool_calls: [{ id: `w${Math.random().toString(36).slice(2, 7)}`, type: 'function', function: { name: 'Write', arguments: JSON.stringify({ file_path: 'out.txt', content: 내용 }) } }] });
const 서버 = createServer((q, res) => {
  let body = '';
  q.on('data', (d) => (body += d));
  q.on('end', () => {
    let json = null;
    try { json = JSON.parse(body); } catch { /* 모델 목록 같은 것 */ }
    const 보냄 = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (!json?.messages) return 보냄({ data: [{ id: 'fake', object: 'model' }] });
    받은것.push(json.messages);
    const 끝말 = json.messages[json.messages.length - 1];
    const 시킨말 = json.messages.filter((m) => m.role === 'user').map((m) => String(m.content ?? '')).join('\n');
    const 끝 = { content: '다 됐습니다.' };
    let 답;
    if (끝말.role === 'tool') 답 = 끝;
    else if (/완료 검사 `/.test(String(끝말.content ?? ''))) {
      답 = /일부러_고침/.test(시킨말) ? 쓰기('good') : /일부러_스크립트/.test(시킨말) ? 셸('node fix') : /일부러_계속틀림/.test(시킨말) ? 쓰기(`bad${받은것.length}`) : 끝;
    } else if (/일부러_답만/.test(시킨말)) 답 = { content: '답만 합니다.' };
    else if (/일부러_스크립트만/.test(시킨말)) 답 = 셸('node fix.cjs');
    else 답 = 쓰기(/일부러_바로맞음/.test(시킨말) ? 'good' : 'bad');
    보냄({
      choices: [{ message: { role: 'assistant', content: 답.content ?? null, ...(답.tool_calls ? { tool_calls: 답.tool_calls } : {}) }, finish_reason: 답.tool_calls ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    });
  });
});
await new Promise((r) => 서버.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${서버.address().port}/v1`;
resetNet();
allowEndpoint(base);

// 검사 명령: out.txt 가 good 이면 통과. 돌 때마다 runs.log 에 한 글자를 남긴다 — 몇 번 돌았나를 센다.
const 검사파일 = "const fs=require('fs');fs.appendFileSync('runs.log','x');const s=fs.existsSync('out.txt')?fs.readFileSync('out.txt','utf8').trim():'(없음)';"
  + "if(s!=='good'){console.log('기대 good · 실제 '+s);process.exit(1)}console.log('pass')";

/** 새 폴더에서 한 턴을 돌린다. */
async function 돌리기(시킬말, { 설정 = { check: 'node check.cjs' }, mode = 'auto', confirm = null, 규칙들 = null, 훅들 = null } = {}) {
  받은것 = [];
  const 뿌리 = mkdtempSync(join(tmpdir(), 'deel-donecheck-'));
  writeFileSync(join(뿌리, 'check.cjs'), 검사파일);
  // 셸로 고치는 판 — Write·Edit 도, 목록에 든 셸 명령(sed -i · mv)도 아니다.
  writeFileSync(join(뿌리, 'fix.cjs'), "require('fs').writeFileSync('out.txt','good')");
  writeFileSync(join(뿌리, 'fix.js'), "require('fs').writeFileSync('out.txt','good')");
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 32768, tools: true };
  const s = new Session(conn, { root: 뿌리, mode, work: 'code' });
  const ctx = {
    scope: makeScope(뿌리), history: new History(뿌리), audit: new Audit(뿌리), seen: new Set(), 규칙들,
    ...(훅들 ? { 훅들 } : {}),
    완료검사: 검사설정(설정),
    ...(confirm ? { confirm } : {}),
  };
  ctx.history.nextTurn();
  const 것들 = [];
  for await (const ev of run(s, ctx, 시킬말)) 것들.push(ev);
  const 돈수 = existsSync(join(뿌리, 'runs.log')) ? readFileSync(join(뿌리, 'runs.log'), 'utf8').length : 0;
  const 최종 = existsSync(join(뿌리, 'out.txt')) ? readFileSync(join(뿌리, 'out.txt'), 'utf8') : null;
  const done = 것들.find((e) => e.type === 'done');
  const 검사들 = 것들.filter((e) => e.type === 'check');
  const 모델에게간말 = s.messages.filter((m) => m.role === 'user').map((m) => String(m.content ?? ''));
  rmSync(뿌리, { recursive: true, force: true, maxRetries: 3 });
  return { 것들, done, 검사들, 돈수, 최종, 모델에게간말 };
}

// ── 3. 고리 ────────────────────────────────────────────────────────────
trace('3-고리');
{
  const r = await 돌리기('일부러_바로맞음 고쳐 줘');
  check('★★ 바꾸고 끝내려 하면 검사를 한 번 돌린다', r.돈수 === 1, `돈 수 ${r.돈수}`);
  check('★★ 통과면 그대로 끝나고 done 에 통과가 실린다', r.done?.검사?.ok === true && r.done.검사.판 === 1, JSON.stringify(r.done?.검사));
  check('  시작 · 결과 사건이 둘 다 나온다', r.것들.some((e) => e.type === 'check_start') && r.검사들[0]?.ok === true);
  check('  done 의 검사에는 모델에게 줄 긴 출력이 안 실린다', r.done?.검사 && !('출력' in r.done.검사));
}
{
  const r = await 돌리기('일부러_고침 고쳐 줘');
  check('★★★ 실패하면 출력을 돌려주고 다시 고치게 한다 — 고친 뒤 다시 돌아 통과', r.돈수 === 2 && r.최종 === 'good' && r.done?.검사?.ok === true && r.done.검사.판 === 2,
    `돈 수 ${r.돈수} · 최종 ${r.최종} · ${JSON.stringify(r.done?.검사)}`);
  const 되돌림 = r.모델에게간말.find((m) => /완료 검사 `node check\.cjs`/.test(m)) ?? '';
  check('★★ 모델에게 간 말에 실패 출력이 그대로 있다', /기대 good · 실제 bad/.test(되돌림), 되돌림.slice(0, 200));
  check('  첫 검사 사건은 실패 · 둘째는 통과', r.검사들[0]?.ok === false && r.검사들[1]?.ok === true);
}
{
  const r = await 돌리기('일부러_계속틀림 고쳐 줘', { 설정: { check: 'node check.cjs', checkRounds: 2 } });
  check('★★★ 정해 둔 판수를 다 쓰면 멈추고 **실패로** 끝낸다', r.돈수 === 2 && r.done?.검사?.ok === false && r.done.검사.판 === 2,
    `돈 수 ${r.돈수} · ${JSON.stringify(r.done?.검사)}`);
  check('  마지막 실패는 모델에게 되돌리지 않는다 (더 고칠 판이 없다)', r.모델에게간말.filter((m) => /완료 검사 `/.test(m)).length === 1);
}
{
  const r = await 돌리기('일부러_안고침 고쳐 줘');
  check('★★ 실패를 받고 아무것도 안 바꾼 채 끝내면 다시 안 돌린다 — 실패로 끝난다', r.돈수 === 1 && r.done?.검사?.ok === false,
    `돈 수 ${r.돈수} · ${JSON.stringify(r.done?.검사)}`);
}
{
  // 2차 눈(Gemini) 판정: `python fix.py` · `make` 로 고치면 바뀜수가 안 올라 검사가 다시 안 돌고,
  // 고쳐 놓고도 실패로 끝났다. 검사가 한 번 돈 뒤의 셸 명령은 무엇이든 「고쳤을 수 있다」 로 센다.
  const r = await 돌리기('일부러_스크립트 고쳐 줘');
  check('★★ 실패를 받고 목록에 없는 셸 꼴(node fix)로 고쳐도 검사가 다시 돌아 통과한다', r.돈수 === 2 && r.done?.검사?.ok === true && r.최종 === 'good',
    `돈 수 ${r.돈수} · ${JSON.stringify(r.done?.검사)} · 파일 ${r.최종}`);
}
{
  const r = await 돌리기('일부러_스크립트만 고쳐 줘');
  check('★★ 스크립트 파일(node fix.cjs)로만 고친 턴도 「바꾼 턴」 이다 — 검사가 돈다', r.돈수 === 1 && r.done?.검사?.ok === true,
    `돈 수 ${r.돈수} · ${JSON.stringify(r.done?.검사)}`);
}
{
  const r = await 돌리기('일부러_답만 알려 줘');
  check('★★ 아무것도 안 바꾼 턴에는 안 돈다', r.돈수 === 0 && !r.검사들.length && r.done?.검사 === null, `돈 수 ${r.돈수}`);
}
{
  const r = await 돌리기('일부러_바로맞음 고쳐 줘', { 설정: {} });
  check('★★ 검사를 안 정해 두면 예전과 똑같다 (돌지도 되밀지도 않는다)', r.돈수 === 0 && !r.검사들.length && r.done?.검사 === null);
}

// ── 4. 관문 — 설정에 적힌 명령이라고 건너뛰지 않는다 ────────────────────
trace('4-관문');
{
  const 물음 = [];
  const r = await 돌리기('일부러_바로맞음 고쳐 줘', {
    mode: 'strict',
    confirm: async (이름, 인자) => { 물음.push({ 이름, 인자 }); return 이름 !== 'Bash'; },
  });
  check('★★★ strict 면 검사 명령도 묻는다', 물음.some((x) => x.이름 === 'Bash' && x.인자?.command === 'node check.cjs'), JSON.stringify(물음.map((x) => x.이름)));
  check('★★ 거절하면 안 돌리고, 「못 돌림」 으로 끝낸다', r.돈수 === 0 && r.done?.검사?.ok === null && /거절/.test(r.done.검사.까닭 ?? ''), JSON.stringify(r.done?.검사));
}
{
  const r = await 돌리기('일부러_바로맞음 고쳐 줘', { mode: 'strict', confirm: null });
  check('★★ 물어볼 사람이 없으면 strict 에서 검사도 안 돈다', r.돈수 === 0 && r.done?.검사?.ok !== true);
}
{
  const r = await 돌리기('일부러_바로맞음 고쳐 줘', { 규칙들: 규칙모으기({ permissions: { deny: ['Bash(node check.cjs)'] } }) });
  check('★★★ 금지 규칙에 걸리면 안 돌린다', r.돈수 === 0 && r.done?.검사?.ok === null && /규칙/.test(r.done.검사.까닭 ?? ''), JSON.stringify(r.done?.검사));
}
{
  const r = await 돌리기('일부러_바로맞음 고쳐 줘', { 설정: { check: 'rm -rf /' } });
  check('★★ 위험 명령 막이도 그대로 걸린다 (Bash 도구를 지난다)', r.돈수 === 0 && /막힘/.test(r.done?.검사?.까닭 ?? r.done?.검사?.요약 ?? ''), JSON.stringify(r.done?.검사));
  // 2차 눈(Gemini) 판정: 막힌 것을 「실패」 로 치면 모델에게 「검사를 통과시키라」 고 되민다. 모델이 고칠 수 있는 일이 아니다.
  check('★★ 막힌 검사는 「못 돌림」 이다 — 모델에게 되밀지 않는다', r.done?.검사?.ok === null && !r.모델에게간말.some((m) => /완료 검사 `/.test(m)),
    JSON.stringify(r.done?.검사));
}
{
  // 2차 눈(Gemini) 판정: 출력은 가렸는데 명령 줄은 날것으로 실패말에 실렸다.
  const 열쇠 = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  const r = await 돌리기('일부러_안고침 고쳐 줘', { 설정: { check: `node check.cjs --token=${열쇠}` } });
  const 되돌림 = r.모델에게간말.find((m) => /완료 검사 `/.test(m)) ?? '';
  check('먼저: 실패말이 모델에게 갔다 (이 검사의 밑천)', 되돌림.length > 0);
  check('★★ 검사 명령에 든 열쇠가 모델에게 날것으로 안 간다', !되돌림.includes(열쇠) && /«가림/.test(되돌림), 되돌림.slice(0, 200));
}
{
  // 2차 눈(Gemini) 판정: 도구전 훅은 지나는데 도구후 훅은 안 지났다. 감사 훅이 앞만 보고 뒤를 못 본다.
  const { 훅펴기 } = await import('../src/safety/hooks.js');
  const 훅들 = 훅펴기({ hooks: [{ 때: '도구후', 도구: 'Bash', 명령: 'node -e "process.stdout.write(String(1+1)+String.fromCharCode(72))"' }] }, '검사').훅들;
  const r = await 돌리기('일부러_바로맞음 고쳐 줘', { 훅들 });
  const 후 = r.것들.filter((e) => e.type === 'hook_note' && e.자리 === '도구후' && e.도구 === 'Bash');
  check('★ 완료 검사도 도구후 훅을 지난다', r.돈수 === 1 && 후.some((e) => /2H/.test(e.말)), JSON.stringify(후));
}

// ── 5. deel run — 종료코드와 --json ─────────────────────────────────────
trace('5-deel-run');
writeFileSync(join(home, 'config.json'), JSON.stringify({
  version: 1, active: 'stub', level: '개발자',
  profiles: [{ id: 'stub', name: '스텁', kind: 'openai', baseUrl: base, auth: 'none', apiKey: '', model: 'fake', ctx: 32768, streaming: false, tools: true, json: true, think: false }],
}, null, 2));

function 띄우기(인자, 폴더, env = {}) {
  return new Promise((done) => {
    const kid = spawn(process.execPath, [진입점, ...인자], {
      cwd: 폴더, env: { ...process.env, DEEL_HOME: home, NO_COLOR: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = ''; let err = '';
    kid.stdout.on('data', (b) => { out += b; });
    kid.stderr.on('data', (b) => { err += b; });
    const 시계 = setTimeout(() => kid.kill('SIGKILL'), 60_000);
    kid.on('close', (code) => { clearTimeout(시계); done({ code, out, err }); });
  });
}
const 한폴더 = () => { const d = mkdtempSync(join(tmpdir(), 'deel-donecheck-run-')); writeFileSync(join(d, 'check.cjs'), 검사파일); return d; };
{
  const d = 한폴더();
  const r = await 띄우기(['run', '--json', '--yes', '--check', 'node check.cjs', '일부러_고침 고쳐 줘'], d);
  const j = (() => { try { return JSON.parse(r.out.trim().split('\n').pop()); } catch { return null; } })();
  check('★★★ deel run --check: 한 번 실패 → 고침 → 통과면 0', r.code === 0 && j?.check?.ok === true && j.check.rounds === 2, `code=${r.code} · ${JSON.stringify(j?.check)} · ${r.err.slice(-300)}`);
  check('  --json 의 check 칸에 명령이 실린다', j?.check?.command === 'node check.cjs');
  rmSync(d, { recursive: true, force: true, maxRetries: 3 });
}
{
  const d = 한폴더();
  const r = await 띄우기(['run', '--json', '--yes', '--check', 'node check.cjs', '일부러_계속틀림 고쳐 줘'], d);
  const j = (() => { try { return JSON.parse(r.out.trim().split('\n').pop()); } catch { return null; } })();
  check('★★★ 끝내 실패면 종료코드 8 · reason check · ok false', r.code === 8 && j?.reason === 'check' && j.ok === false && j.check?.ok === false,
    `code=${r.code} · ${JSON.stringify(j)?.slice(0, 300)}`);
  check('★ 판수를 다 썼다 (기본 3)', j?.check?.rounds === 3 && readFileSync(join(d, 'runs.log'), 'utf8').length === 3);
  check('  화면(표준오류)에 무엇이 틀렸는지 남는다', /기대 good · 실제 bad/.test(r.err), r.err.slice(-300));
  rmSync(d, { recursive: true, force: true, maxRetries: 3 });
}
{
  const d = 한폴더();
  const r = await 띄우기(['run', '--json', '--yes', '일부러_계속틀림 고쳐 줘'], d);
  const j = (() => { try { return JSON.parse(r.out.trim().split('\n').pop()); } catch { return null; } })();
  check('★★ --check 없이 돌리면 예전 그대로 0 · check 칸 없음', r.code === 0 && j && !('check' in j) && !existsSync(join(d, 'runs.log')), `code=${r.code}`);
  rmSync(d, { recursive: true, force: true, maxRetries: 3 });
}

서버.close();
rmSync(home, { recursive: true, force: true, maxRetries: 3 });
if (원래정책 === undefined) delete process.env.DEEL_POLICY; else process.env.DEEL_POLICY = 원래정책;

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n완료 검사  ${D}(다 됐다는 말 대신 검사 결과로)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
