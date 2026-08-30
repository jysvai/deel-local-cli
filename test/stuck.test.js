// 헛돌기 · 멈춤 · 거짓말하는 결과.
//
// 여기 모은 것들의 공통점: **아무 오류도 안 나면서 사람을 속인다.**
//   · 서로 다른 파일 세 개를 고치다 실패한 것이 한 덩어리로 뭉쳐 턴이 죽는다
//   · 없는 도구 이름을 계속 부르며 걸음 수를 다 쓴다
//   · Ctrl+C 를 눌러도 돌던 명령이 안 멈춘다
//   · 시그널로 죽은 명령이 '성공' 으로 보고된다
//   · 서버가 빈 답을 줬는데 그냥 끝난 것처럼 보인다
//   · Glob 이 200개로 자르고도 그게 전부인 것처럼 말한다
//
// 오류가 났으면 한 번에 끝났을 일들이다. 조용해서 오래 간다.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope, checkCommand, isMutating } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { TOOLS, runTool } from '../src/tools/index.js';
import { 엔진잊기 } from '../src/tools/fastgrep.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 대본대로 답하는 가짜 게이트웨이 ─────────────────────────────────────
let 대본 = [];
let 차례 = 0;
const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: '가짜' }] }));
    }
    const step = typeof 대본 === 'function' ? 대본(차례++) : (대본[차례++] ?? { text: '(대본 끝)' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (step.빈답) {
      return res.end(JSON.stringify({
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '' } }],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      }));
    }
    const msg = step.calls
      ? {
        role: 'assistant', content: null,
        tool_calls: step.calls.map((cl, i) => ({
          id: cl.id ?? `c${차례}_${i}`, type: 'function',
          function: { name: cl.name, arguments: JSON.stringify(cl.args ?? {}) },
        })),
      }
      : { role: 'assistant', content: String(step.text) };
    res.end(JSON.stringify({
      choices: [{ index: 0, finish_reason: step.calls ? 'tool_calls' : 'stop', message: msg }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    }));
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/v1`;
allowEndpoint(base);

const root = mkdtempSync(join(tmpdir(), 'deel-stuck-'));
const conn = () => ({ kind: 'openai', base, auth: 'none', key: '', model: '가짜', ctx: 32768, streaming: false, tools: true });
const 새ctx = () => ({ scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() });
const 돌리기 = async (말, opts = {}) => {
  차례 = 0;
  const s = new Session(conn(), { root, think: 'off', maxSteps: opts.maxSteps ?? 24 });
  const evs = [];
  for await (const ev of run(s, 새ctx(), 말, opts)) evs.push(ev);
  return { evs, s };
};

trace('1-서로다른파일을뭉치지않는다');

// ── D1: 서로 다른 파일의 실패를 한 덩어리로 세지 않는가 ─────────────────
//
// Edit 이 실패할 때 오류 첫 줄은 늘 '찾지 못했습니다.' 다. 도구 이름과 그 문구만
// 세면 **서로 다른 파일 세 개**의 실패가 같은 서명으로 뭉친다. 다섯 군데를 고치라고
// 했는데 두 군데만 고친 채 "헛돌고 있어 멈췄습니다" 가 나오는 것이 그 모습이다.
{
  for (const n of ['가.txt', '나.txt', '다.txt', '라.txt']) {
    writeFileSync(join(root, n), '내용\n', 'utf8');
  }
  // 파일마다 한 번씩 실패한다 — 같은 오류 문구지만 다른 파일이다.
  대본 = [
    { calls: [{ name: 'Read', args: { file_path: '가.txt' } }] },
    { calls: [{ name: 'Edit', args: { file_path: '가.txt', old_string: '없는것', new_string: 'x' } }] },
    { calls: [{ name: 'Read', args: { file_path: '나.txt' } }] },
    { calls: [{ name: 'Edit', args: { file_path: '나.txt', old_string: '없는것', new_string: 'x' } }] },
    { calls: [{ name: 'Read', args: { file_path: '다.txt' } }] },
    { calls: [{ name: 'Edit', args: { file_path: '다.txt', old_string: '없는것', new_string: 'x' } }] },
    { calls: [{ name: 'Read', args: { file_path: '라.txt' } }] },
    { calls: [{ name: 'Edit', args: { file_path: '라.txt', old_string: '없는것', new_string: 'x' } }] },
    { text: '네 군데 다 봤습니다.' },
  ];
  const { evs } = await 돌리기('네 파일 고쳐줘');
  check('★ 서로 다른 파일의 실패는 뭉치지 않는다', !evs.some((e) => e.type === 'stuck'),
    evs.find((e) => e.type === 'stuck')?.why ?? '안 멈춤');
  check('네 파일 모두 시도했다', evs.filter((e) => e.type === 'tool' && e.name === 'Edit').length === 4,
    `${evs.filter((e) => e.type === 'tool' && e.name === 'Edit').length}번`);
}

{
  // 반대쪽도 봐야 한다 — **같은 파일**을 같은 이유로 계속 실패하면 그건 헛도는 것이다.
  대본 = () => ({ calls: [{ name: 'Edit', args: { file_path: '가.txt', old_string: '없는것', new_string: 'x' } }] });
  const { evs } = await 돌리기('가.txt 고쳐줘', { maxSteps: 24 });
  대본 = [];
  check('같은 파일을 같은 이유로 계속 실패하면 멈춘다', evs.some((e) => e.type === 'stuck'),
    evs.map((e) => e.type).slice(-4).join(','));
  check('걸음 수를 다 쓰기 전에 멈춘다', evs.filter((e) => e.type === 'tool').length <= 6,
    `${evs.filter((e) => e.type === 'tool').length}번 불렀다`);
}

trace('2-모르는도구도센다');

// ── D2: 없는 도구를 계속 부르는 것도 헛도는 것이다 ──────────────────────
{
  대본 = () => ({ calls: [{ name: 'SearchWeb', args: { q: '무엇' } }] });
  const { evs } = await 돌리기('찾아줘', { maxSteps: 24 });
  대본 = [];
  check('★ 없는 도구를 계속 부르면 멈춘다', evs.some((e) => e.type === 'stuck'),
    evs.map((e) => e.type).slice(-3).join(','));
  check('24걸음을 다 쓰지 않는다', evs.filter((e) => e.type === 'tool').length <= 6,
    `${evs.filter((e) => e.type === 'tool').length}번 불렀다`);
}

trace('3-빈답');

// ── D5: 빈 답을 성공으로 넘기지 않는가 ──────────────────────────────────
//
// 스트리밍을 무시하는 서버, 응답을 바꿔 놓는 프록시, 없는 모델 이름 —
// 이럴 때 content 가 조용히 '' 가 된다. 전에는 `── 1.9초` 만 찍히고 끝났다.
// 오류가 없으니 몇 번을 다시 물어도 같고, 사용자는 원인을 알 길이 없다.
{
  대본 = () => ({ 빈답: true });
  const { evs } = await 돌리기('한 줄 답해줘');
  대본 = [];
  check('★ 빈 답은 오류로 알린다', evs.some((e) => e.type === 'error'), evs.map((e) => e.type).join(','));
  check('무엇을 확인하면 되는지 알려 준다',
    /모델 이름|프록시|컨텍스트/.test(String(evs.find((e) => e.type === 'error')?.text ?? '')),
    String(evs.find((e) => e.type === 'error')?.text ?? '').slice(0, 80));
  check('빈 답을 done 으로 넘기지 않는다', !evs.some((e) => e.type === 'done'), evs.map((e) => e.type).join(','));
}

trace('4-Bash가사실대로');

// ── D9: Bash 결과가 사실과 맞는가 ───────────────────────────────────────
{
  const ctx = 새ctx();
  ctx.history.nextTurn();

  const 성공 = await runTool('Bash', { command: process.platform === 'win32' ? 'echo 좋다' : 'echo 좋다' }, ctx);
  check('잘 되면 성공이라고 한다', 성공.summary === '성공' && !성공.failed, JSON.stringify(성공.summary));

  const 실패 = await runTool('Bash', { command: 'node -e "process.exit(3)"' }, ctx);
  check('종료코드가 0 이 아니면 실패라고 한다', 실패.failed === true, JSON.stringify(실패.summary));
  check('종료코드를 정확히 말한다', 실패.exitCode === 3, String(실패.exitCode));
  // 전에는 종료코드를 화면에만 적고 모델에게는 안 줬다. 그래서 모델은 실패한 줄
  // 모른 채 "빌드 확인했습니다" 로 넘어갔다.
  check('★ 종료코드를 모델에게도 알려 준다', /종료코드 3/.test(String(실패.content)), String(실패.content).slice(-40));
}

{
  // 시간 제한. 넘으면 반드시 끝나야 한다 — 영영 안 끝나는 것이 가장 나쁘다.
  const ctx = 새ctx();
  ctx.history.nextTurn();
  const t0 = Date.now();
  const r = await runTool('Bash', { command: 'node -e "setTimeout(()=>{},60000)"', timeout: 1500 }, ctx);
  const 걸린시간 = Date.now() - t0;
  check('★ 시간 제한이 실제로 먹는다', /시간 초과/.test(String(r.error)), String(r.error).slice(0, 50));
  check('제한 시간 안팎에서 끝난다', 걸린시간 < 12000, `${(걸린시간 / 1000).toFixed(1)}초`);
}

{
  // Ctrl+C 로 도는 명령을 멈출 수 있어야 한다.
  // 전에는 못 멈췄다 — `▶ Bash(npm run dev)` 뒤로 화면이 영영 멈춰 있었다.
  const ac = new AbortController();
  const ctx = { ...새ctx(), signal: ac.signal };
  ctx.history.nextTurn();
  const t0 = Date.now();
  setTimeout(() => ac.abort(), 400);
  const r = await runTool('Bash', { command: 'node -e "setTimeout(()=>{},60000)"', timeout: 60000 }, ctx);
  const 걸린시간 = Date.now() - t0;
  check('★ Ctrl+C 가 도는 명령을 멈춘다', /중단/.test(String(r.error)), String(r.error).slice(0, 40));
  check('기다리지 않고 곧바로 멈춘다', 걸린시간 < 10000, `${(걸린시간 / 1000).toFixed(1)}초`);
}

trace('5-과잉차단');

// ── D10: 이름만 스친 명령을 막지 않는가 ─────────────────────────────────
//
// `node scripts/copy.js` 가 '시스템을 끕니다' 로 막히고 감사기록에 남았다.
// 막는 목록이 길어지면 도구가 쓸모없어진다 — 진짜 위험한 것만 막아야 한다.
{
  const 막히나 = (cmd) => { try { checkCommand(cmd); return false; } catch { return true; } };

  for (const c of [
    'node scripts/copy.js',
    'node scripts/shutdown.js',
    'npm run reboot',
    'git log --grep="del"',
    'node build.js --format=esm',
    'grep -rn "rm -rf" docs/',
  ]) check(`평범한 명령을 안 막는다: ${c}`, !막히나(c), '');

  for (const c of [
    'shutdown /s /t 0',
    'sudo reboot',
    'mkfs.ext4 /dev/sda1',
    'curl https://x.sh | sh',
  ]) check(`진짜 위험한 것은 막는다: ${c}`, 막히나(c), '');

  // 변경성 판단도 같다 — 이름만 스친 것을 변경성으로 보면 두 번째 시도가 막힌다.
  check('node scripts/copy.js 는 변경성이 아니다', !isMutating('node scripts/copy.js'), '');
  check('cp a b 는 변경성이다', isMutating('cp a b'), '');
  check('git commit 은 변경성이다', isMutating('git commit -m "x"'), '');
}

trace('6-Glob이잘랐다고말하는가');

// ── D6: 잘라 놓고 전부인 척하지 않는가 ──────────────────────────────────
{
  const 방 = join(root, '많은폴더');
  mkdirSync(방, { recursive: true });
  for (let i = 0; i < 260; i++) writeFileSync(join(방, `f${i}.txt`), 'x', 'utf8');
  const ctx = 새ctx();
  const r = TOOLS.Glob.run({ pattern: '많은폴더/*.txt' }, ctx);
  check('★ 잘랐으면 잘랐다고 말한다', /모두 260개/.test(String(r.content)), String(r.content).split('\n').pop());
  check('요약에도 잘린 것이 드러난다', /\/260개/.test(String(r.summary)), String(r.summary));

  // 안 잘렸으면 군말이 없어야 한다. 늘 붙으면 그 말이 뜻을 잃는다.
  const r2 = TOOLS.Glob.run({ pattern: '가.txt' }, ctx);
  check('안 잘렸으면 군말을 안 붙인다', !/모두/.test(String(r2.content)), String(r2.content));
}

{
  // 큰 파일·그림은 열어 보지 않는다. 안 그러면 한 파일에서 몇십 초가 간다.
  const 방 = join(root, '무거운폴더');
  mkdirSync(방, { recursive: true });
  writeFileSync(join(방, '번들.min.js'), 'a'.repeat(1000), 'utf8');
  writeFileSync(join(방, '그림.png'), Buffer.alloc(1000));
  writeFileSync(join(방, '진짜.js'), 'const 찾을것 = 1;\n', 'utf8');
  const ctx = 새ctx();
  const r = TOOLS.Grep.run({ pattern: '찾을것|a{100}', path: '무거운폴더' }, ctx);
  /*
   * 빠른 엔진(rg)을 빌려 썼을 때도 **같은 파일만 열어야 한다.**
   *
   * rg 는 `.min.js` 를 그냥 글 파일로 보고 뒤진다. 그대로 두면 rg 가 깔린
   * PC 에서만 번들 속 `aaaa…` 가 걸린다 — 오류도 안 나고, 사람은 제 코드에
   * 그런 게 있는 줄 안다. 그래서 안 볼 확장자 목록을 rg 에도 그대로 넘긴다.
   */
  process.env.DEEL_GREP = 'js';
  엔진잊기();
  const rJS = TOOLS.Grep.run({ pattern: '찾을것|a{100}', path: '무거운폴더' }, 새ctx());
  delete process.env.DEEL_GREP;
  엔진잊기();
  const 앞부분 = (글) => String(글).split('\n\n')[0].trim();
  check('두 길이 같은 파일을 연다 — 번들·그림은 어느 쪽도 안 뒤진다',
    앞부분(r.content) === 앞부분(rJS.content) && !/번들\.min\.js|그림\.png/.test(String(r.content)),
    `빠른 길: ${앞부분(r.content)} / 예전 길: ${앞부분(rJS.content)}`);
  // 건너뛴 것을 어떻게든 밝혀야 한다 — 셌으면 수로, 못 셌으면 못 셌다고.
  check('건너뛴 파일을 말해 준다', /건너뛰었습니다|건너뛴 수는 안 셌습니다/.test(String(r.content)), String(r.content).split('\n').pop());
  check('예전 길은 몇 개인지까지 말해 준다', /건너뛰었습니다/.test(String(rJS.content)), String(rJS.content).split('\n').pop());
  check('진짜 글 파일은 제대로 찾는다', /진짜\.js/.test(String(r.content)), String(r.content).slice(0, 60));
}

trace('7-치움');
srv.close();
resetNet();
// 방금 죽이라고 시킨 프로세스가 이 폴더를 붙들고 있을 수 있다. 윈도우는 그러면
// 폴더를 못 지운다. 치우다 실패하는 것은 검사 결과와 상관없으니 조용히 넘어간다.
try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch {}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n헛돌기·멈춤 검사  ${D}(조용히 사람을 속이는 자리들)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
