/**
 * 생성 속도 (tok/s) — 모델이 한 초에 몇 토큰을 뽑나 (2.1.3 · agent/loop.js · agent/session.js 의 생성속도).
 *
 * ── 왜 이 파일이 있나 ──────────────────────────────────────────────────
 *
 * 로컬 모델을 고를 때 제일 먼저 묻는 것이 「이 기계에서 얼마나 빠른가」 다. 여태 deel 은 토큰 수와
 * 도구 시간만 적고 생성 속도는 어디에도 안 적었다 — 사람은 초시계를 들고 재야 했다.
 *
 * 재는 자리가 중요하다. 요청을 보낸 때부터 재면 앞머리 읽기(prefill)가 섞여, 긴 대화일수록 모델이
 * 느려진 것처럼 보인다. 그래서 **흘려받은 첫 글자부터 끝까지**만 잰다. 한 번에 받는 부름은 그 둘을
 * 못 가르므로 안 잰다 — 느린 값을 지어내느니 모른다고 둔다.
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { trace } from './trace.mjs';

const 설정집 = mkdtempSync(join(tmpdir(), 'deel-speed-home-'));
process.env.DEEL_HOME = 설정집;
const { run } = await import('../src/agent/loop.js');
const { Session, 생성속도 } = await import('../src/agent/session.js');
const { makeScope } = await import('../src/safety/guard.js');
const { History } = await import('../src/safety/undo.js');
const { Audit } = await import('../src/safety/audit.js');
const { allowEndpoint, resetNet } = await import('../src/safety/network.js');
const { handle } = await import('../src/commands.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 쉬기 = (ms) => new Promise((r) => { setTimeout(r, ms); });

const 앞머리 = 250;   // 첫 글자 전에 서버가 쉬는 시간 (prefill 흉내)
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', async () => {
    const 흘림 = JSON.parse(body || '{}').stream === true;
    await 쉬기(앞머리);
    if (!흘림) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { content: '다 됐습니다.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 40 } }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (let i = 0; i < 5; i++) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `조각${i} ` } }] })}\n\n`);
      await 쉬기(40);
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 40 } })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/v1`;

async function 돌리기(streaming) {
  resetNet(); allowEndpoint(base);
  const root = mkdtempSync(join(tmpdir(), 'deel-speed-'));
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 16000, streaming };
  const session = new Session(conn, { root, work: 'code' });
  const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set(), 모드: 'auto' };
  const 시작 = Date.now();
  for await (const ev of run(session, ctx, '인사해 줘', { 끼어들기: () => null })) void ev;
  const 전체 = Date.now() - 시작;
  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  return { session, ctx, 전체 };
}

trace('1-흘려받기');
{
  const { session, 전체 } = await 돌리기(true);
  const u = session.usage;
  check('★★ 흘려받은 부름은 생성 시간과 토큰을 잰다', u.genOut === 40 && u.genMs > 0, `genOut=${u.genOut} genMs=${u.genMs}`);
  check('★★★ 앞머리 읽기(첫 글자 전 기다림)는 생성 시간에 안 넣는다', u.genMs <= 전체 - 앞머리 + 20, `genMs=${u.genMs} 전체=${전체}`);
  const 속도 = 생성속도(u);
  check('★ 생성속도 = 토큰 ÷ 초, 소수 한 자리', 속도 === Math.round((40 / u.genMs) * 10000) / 10 && 속도 > 0, String(속도));

  // /cost 가 그 줄을 적는다
  const 원래 = process.stdout.write.bind(process.stdout);
  let 모인것 = '';
  process.stdout.write = (chunk) => { 모인것 += chunk; return true; };
  try { await handle('/cost', session, { history: new History(설정집), seen: new Set() }); } catch { /* 줄만 본다 */ } finally { process.stdout.write = 원래; }
  check('★ /cost 에 생성 속도가 뜬다', /tok\/s/.test(모인것), 모인것.split('\n').filter((l) => /tok|속도|speed/i.test(l)).join(' | ').slice(0, 200));
}

trace('2-한번에');
{
  const { session } = await 돌리기(false);
  check('★★ 한 번에 받은 부름은 안 잰다 — 앞머리와 생성을 못 가른다', (session.usage.genMs ?? 0) === 0 && 생성속도(session.usage) === null,
    `genMs=${session.usage.genMs} 속도=${생성속도(session.usage)}`);
}
check('  잰 것이 없으면 null', 생성속도({}) === null && 생성속도(null) === null && 생성속도({ genMs: 0, genOut: 5 }) === null);

trace('3-deel-run');
{
  // deel run --json 이 그 값을 싣는다 — CI 가 모델 · 기계를 견줄 때 쓰는 칸이다.
  const 집 = mkdtempSync(join(tmpdir(), 'deel-speed-run-'));
  const 일터 = mkdtempSync(join(tmpdir(), 'deel-speed-work-'));
  writeFileSync(join(집, 'config.json'), JSON.stringify({
    version: 1, active: 'stub', level: '개발자',
    profiles: [{ id: 'stub', name: '스텁', kind: 'openai', baseUrl: base, auth: 'none', apiKey: '', model: '스텁모델', ctx: 32768, streaming: true, tools: true, json: true, think: false }],
  }), 'utf8');
  const 진입점 = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'deel.js');
  // 가짜 서버가 이 프로세스 안에 있으니 기다리는 동안 막으면 안 된다 — spawnSync 는 서로를 기다리다 멈춘다.
  const r = await new Promise((done) => {
    const kid = spawn(process.execPath, [진입점, 'run', '--json', '인사해 줘'], {
      cwd: 일터, env: { ...process.env, DEEL_HOME: 집, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    kid.stdout.on('data', (b) => { stdout += b; });
    kid.stderr.on('data', (b) => { stderr += b; });
    const 시계 = setTimeout(() => kid.kill('SIGKILL'), 60000);
    kid.on('close', () => { clearTimeout(시계); done({ stdout, stderr }); });
  });
  let o = null;
  try { o = JSON.parse(r.stdout.trim().split('\n').at(-1)); } catch { /* 아래에서 잡힌다 */ }
  check('★★ deel run --json 의 usage 에 생성 속도가 실린다', o?.usage?.tokPerSec > 0 && o?.usage?.genMs > 0,
    JSON.stringify(o?.usage ?? r.stderr.slice(0, 200)));
  rmSync(집, { recursive: true, force: true, maxRetries: 3 });
  rmSync(일터, { recursive: true, force: true, maxRetries: 3 });
}

server.close();
rmSync(설정집, { recursive: true, force: true, maxRetries: 3 });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n생성 속도  ${D}(흘려받은 첫 글자부터 끝까지 · 한 번에 받은 것은 안 잰다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
