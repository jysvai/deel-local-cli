/**
 * `deel run` 의 대화 남기기 · 이어 하기 · 바뀐 파일 · 사건 흘리기 (2.1.3 · src/oneshot.js).
 *
 * ── 왜 이 파일이 있나 ──────────────────────────────────────────────────
 *
 * 대화 화면은 오간 말을 `.deel/sessions/` 에 바로 적고 `--continue` · `--resume` 으로 잇는다.
 * `deel run` 만 그 자리가 없었다 — 한 번 돌고 나면 무슨 말이 오갔는지 아무 데도 안 남았고,
 * 스크립트가 「방금 그 일에 이어서 테스트도 고쳐」 를 시킬 길이 없었다. 매번 처음부터 다시
 * 설명해야 했고, 그 설명은 모델이 방금 읽은 파일을 다시 읽게 했다.
 *
 * 배치에서 제일 먼저 묻는 것 둘도 없었다.
 *   · 무엇이 바뀌었나 — `--json` 에 도구 횟수는 있는데 **어느 파일**인지는 없었다.
 *     스크립트는 `git status` 를 다시 돌려 짐작했다.
 *   · 지금 무엇을 하고 있나 — 끝날 때 한 덩이만 나와서, 오래 도는 잡을 지켜볼 수 없었다.
 *
 * 그래서 진짜로 띄워서 본다 (test/oneshot.test.js 와 같은 까닭 — 이 기능의 값은 프로세스 바깥에 있다).
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const 진입점 = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'deel.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 스텁 모델 ───────────────────────────────────────────────────────────
// 받은 사람 말을 그대로 되읊는다 — 이어 받았는지는 모델이 **앞선 말을 받았나**로 잰다.
let 받은요청 = [];
const 긴글 = '가'.repeat(60000);
const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let json = null;
    try { json = body ? JSON.parse(body) : null; } catch { /* 없을 수 있다 */ }
    const 보냄 = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url === '/v1/models') return 보냄({ data: [{ id: '스텁모델', object: 'model' }] });
    if (url !== '/v1/chat/completions') return 보냄({}, 404);
    받은요청.push(json);
    // 흘려받기로 답한다 — 글자 조각(content) 사건이 실제로 나야 「사건 파일에 안 싣는다」 를 잴 수 있다.
    const 답 = (msg) => {
      const 끝 = msg.tool_calls ? 'tool_calls' : 'stop';
      if (json?.stream !== true) {
        return 보냄({ id: 'x', object: 'chat.completion', model: '스텁모델', choices: [{ index: 0, finish_reason: 끝, message: msg }], usage: { prompt_tokens: 50, completion_tokens: 5 } });
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const 조각 = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (msg.content) for (const 토막 of [msg.content.slice(0, 5), msg.content.slice(5)]) 조각({ choices: [{ index: 0, delta: { content: 토막 } }] });
      if (msg.tool_calls) 조각({ choices: [{ index: 0, delta: { tool_calls: msg.tool_calls.map((t, i) => ({ index: i, ...t })) } }] });
      조각({ choices: [{ index: 0, delta: {}, finish_reason: 끝 }], usage: { prompt_tokens: 50, completion_tokens: 5 } });
      res.write('data: [DONE]\n\n');
      return res.end();
    };
    const 도구답 = (name, args) => 답({
      role: 'assistant', content: null,
      tool_calls: [{ id: `c${받은요청.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    });
    const 말들 = (json?.messages ?? []);
    const 사람말들 = 말들.filter((m) => m.role === 'user').map((m) => String(m.content ?? ''));
    const 마지막 = 사람말들.at(-1) ?? '';
    const 도구결과있나 = 말들.some((m) => m.role === 'tool');
    if (/일부러_쓰기/.test(마지막) && !도구결과있나) return 도구답('Write', { file_path: 'sub/새파일.txt', content: '스텁이 쓴 것\n' });
    if (/일부러_읽기/.test(마지막) && !도구결과있나) return 도구답('Read', { file_path: '큰파일.txt' });
    return 답({ role: 'assistant', content: `본말 ${사람말들.length}개: ${사람말들.map((s) => s.slice(0, 40)).join(' | ')}` });
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/v1`;

const home = mkdtempSync(join(tmpdir(), 'deel-runs-home-'));
writeFileSync(join(home, 'config.json'), JSON.stringify({
  version: 1, active: 'stub', level: '개발자',
  profiles: [{ id: 'stub', name: '스텁', kind: 'openai', baseUrl: base, auth: 'none', apiKey: '', model: '스텁모델', ctx: 32768, streaming: true, tools: true, json: true, think: false }],
}), 'utf8');

function 띄우기(인자, 폴더) {
  return new Promise((done) => {
    const kid = spawn(process.execPath, [진입점, ...인자], {
      cwd: 폴더, env: { ...process.env, DEEL_HOME: home, NO_COLOR: '1', COLUMNS: '100' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = ''; let err = '';
    kid.stdout.on('data', (b) => { out += b; });
    kid.stderr.on('data', (b) => { err += b; });
    const 시계 = setTimeout(() => kid.kill('SIGKILL'), 60000);
    kid.on('close', (code) => { clearTimeout(시계); done({ code, out, err }); });
  });
}
const 한덩이 = (글) => { try { return JSON.parse(String(글).trim().split('\n').at(-1)); } catch { return null; } };
const 대화들 = (폴더) => { try { return readdirSync(join(폴더, '.deel', 'sessions')).filter((f) => f.endsWith('.jsonl')); } catch { return []; } };

const work = mkdtempSync(join(tmpdir(), 'deel-runs-work-'));

trace('1-남기기');
let 첫id = null;
{
  const r = await 띄우기(['run', '--json', '첫말 기억해 두세요: 바나나'], work);
  const o = 한덩이(r.out);
  첫id = o?.session ?? null;
  check('★★ deel run --json 이 대화 이름(session)을 싣는다', r.code === 0 && typeof 첫id === 'string' && 첫id.length > 0,
    `code=${r.code} session=${JSON.stringify(o?.session)} err=${r.err.slice(0, 200)}`);
  const 파일 = 첫id ? join(work, '.deel', 'sessions', `${첫id}.jsonl`) : '';
  const 글 = 파일 && existsSync(파일) ? readFileSync(파일, 'utf8') : '';
  check('★★ 그 이름의 파일이 .deel/sessions 에 있고 오간 말이 적혀 있다',
    /"t":"meta"/.test(글) && /바나나/.test(글) && /본말 1개/.test(글), 글.slice(0, 200));
  check('  아무것도 안 바꾼 실행은 files 가 빈 목록이다', Array.isArray(o?.files) && o.files.length === 0, JSON.stringify(o?.files));
}

trace('2-resume');
{
  받은요청 = [];
  const r = await 띄우기(['run', '--json', '--resume', 첫id ?? '없음', '아까 뭐라고 했죠'], work);
  const o = 한덩이(r.out);
  const 보낸사람말 = (받은요청[0]?.messages ?? []).filter((m) => m.role === 'user').map((m) => String(m.content));
  check('★★★ --resume <id> 는 앞선 대화를 모델에게 다시 싣는다', 보낸사람말.some((s) => /바나나/.test(s)) && 보낸사람말.length >= 2,
    JSON.stringify(보낸사람말).slice(0, 200));
  check('★★ 이어 한 실행은 같은 대화 이름에 이어 적는다', o?.session === 첫id && 대화들(work).length === 1,
    `session=${o?.session} 파일=${대화들(work).join(',')}`);
  check('  이어 받았다고 표준오류에 적는다', /이어 받았습니다|continued/i.test(r.err), r.err.slice(0, 200));
}

trace('3-continue');
{
  받은요청 = [];
  const r = await 띄우기(['run', '--json', '--continue', '세번째 말'], work);
  const o = 한덩이(r.out);
  const 보낸사람말 = (받은요청[0]?.messages ?? []).filter((m) => m.role === 'user').map((m) => String(m.content));
  check('★★ --continue 는 이 폴더의 가장 최근 대화를 잇는다', r.code === 0 && o?.session === 첫id && 보낸사람말.length >= 3,
    `code=${r.code} session=${o?.session} 사람말=${보낸사람말.length}`);
}

trace('3b-핀');
{
  // 못 박아 둔 것도 같이 돌아와야 한다 — 오간 말만 돌아오면 대화 화면에서 막아 둔 「껐다 켜면 까먹는다」 가 여기서 되살아난다.
  const 파일 = join(work, '.deel', 'sessions', `${첫id}.jsonl`);
  writeFileSync(파일, readFileSync(파일, 'utf8') + JSON.stringify({ t: 'pins', at: new Date().toISOString(), 목록: ['운영_디비는_건드리지_않는다_핀'] }) + '\n', 'utf8');
  받은요청 = [];
  const r = await 띄우기(['run', '--json', '--resume', 첫id ?? '없음', '네번째 말'], work);
  const 보낸글 = JSON.stringify(받은요청[0]?.messages ?? []);
  check('★★ --resume 은 못 박아 둔 것도 되살려 싣는다', r.code === 0 && 보낸글.includes('운영_디비는_건드리지_않는다_핀'), `code=${r.code}`);
}

trace('4-없는대화');
{
  받은요청 = [];
  const 전 = 대화들(work).length;
  const r = await 띄우기(['run', '--json', '--resume', '20990101-000000-없음', '이어서'], work);
  const o = 한덩이(r.out);
  check('★★★ 없는 대화를 --resume 하면 새로 시작하지 않고 1 로 선다 — 모델도 안 부른다',
    r.code === 1 && o?.ok === false && o?.reason === 'no-session' && 받은요청.length === 0,
    `code=${r.code} reason=${o?.reason} 부름=${받은요청.length}`);
  check('★★ 그 이름으로 빈 파일을 만들지 않는다', 대화들(work).length === 전 && !대화들(work).some((f) => f.includes('없음')), 대화들(work).join(','));
  const r2 = await 띄우기(['run', '--json', '--resume', '../../밖', '이어서'], work);
  check('  대화 이름이 아닌 것(경로)도 같은 자리에서 선다', r2.code === 1 && 한덩이(r2.out)?.reason === 'no-session', `code=${r2.code}`);
  const r3 = await 띄우기(['run', '--json', '이어서', '--resume'], work);
  check('★★ 여기는 고를 사람이 없다 — 값 없는 --resume 은 64', r3.code === 64 && 한덩이(r3.out)?.reason === 'usage',
    `code=${r3.code} out=${r3.out.slice(0, 120)}`);
}

trace('5-처음continue');
{
  const 빈곳 = mkdtempSync(join(tmpdir(), 'deel-runs-empty-'));
  const r = await 띄우기(['run', '--json', '--continue', '처음입니다'], 빈곳);
  const o = 한덩이(r.out);
  check('★ 이어 할 대화가 없는 --continue 는 새로 시작한다 (스크립트의 첫 판)', r.code === 0 && typeof o?.session === 'string',
    `code=${r.code} session=${o?.session} err=${r.err.slice(0, 160)}`);
  rmSync(빈곳, { recursive: true, force: true, maxRetries: 3 });
}

trace('5b-못적음');
{
  // 대화 폴더 자리에 파일이 있어 못 적는다. 일은 해야 하고, 이을 수 없는 이름을 내주면 안 된다.
  const 막힌곳 = mkdtempSync(join(tmpdir(), 'deel-runs-ro-'));
  mkdirSync(join(막힌곳, '.deel'), { recursive: true });
  writeFileSync(join(막힌곳, '.deel', 'sessions'), '폴더가 아니라 파일', 'utf8');
  const r = await 띄우기(['run', '--json', '저장 못 해도 해 주세요'], 막힌곳);
  const o = 한덩이(r.out);
  check('★★ 대화를 못 적어도 일은 하고, session 은 비워 이을 수 없다고 알린다', r.code === 0 && o?.ok === true && o?.session === null && /못 적었습니다|Could not write/.test(r.err),
    `code=${r.code} session=${JSON.stringify(o?.session)} err=${r.err.slice(0, 200)}`);
  rmSync(막힌곳, { recursive: true, force: true, maxRetries: 3 });
}

trace('6-files');
{
  const r = await 띄우기(['run', '--json', '일부러_쓰기 해 주세요'], work);
  const o = 한덩이(r.out);
  check('★★★ --json 의 files 에 바뀐 파일이 작업 폴더 기준 경로로 실린다',
    r.code === 0 && JSON.stringify(o?.files) === JSON.stringify(['sub/새파일.txt']) && existsSync(join(work, 'sub', '새파일.txt')),
    `code=${r.code} files=${JSON.stringify(o?.files)} err=${r.err.slice(0, 200)}`);
}

trace('7-events');
{
  writeFileSync(join(work, '큰파일.txt'), 긴글, 'utf8');
  const 사건파일 = join(work, '사건.jsonl');
  const r = await 띄우기(['run', '--json', '--events', 사건파일, '일부러_읽기 해 주세요'], work);
  const o = 한덩이(r.out);
  const 줄들 = existsSync(사건파일) ? readFileSync(사건파일, 'utf8').split('\n').filter(Boolean) : [];
  const 읽은것 = 줄들.map((l) => { try { return JSON.parse(l); } catch { return null; } });
  check('★★ --events 는 사건을 한 줄에 하나씩 JSON 으로 흘린다', 줄들.length >= 3 && 읽은것.every(Boolean),
    `줄=${줄들.length} 못읽음=${읽은것.filter((x) => !x).length}`);
  check('★★ 도구 사건과 걸음 사건이 실린다', 읽은것.some((e) => e?.type === 'tool' && e.name === 'Read') && 읽은것.some((e) => e?.type === 'stage'),
    읽은것.map((e) => e?.type).join(','));
  check('★★ 마지막 줄은 --json 과 같은 결과 한 덩이다', 읽은것.at(-1)?.type === 'result' && 읽은것.at(-1)?.code === o?.code && 읽은것.at(-1)?.session === o?.session,
    String(JSON.stringify(읽은것.at(-1))).slice(0, 160));
  check('★ 글자 조각(content · thinking)은 안 싣는다 — 결과 줄에 답이 이미 있다', 읽은것.length > 0 && !읽은것.some((e) => e?.type === 'content' || e?.type === 'thinking'));
  check('★★ 큰 도구 결과는 잘라 싣는다 — 한 줄이 파일 하나만 해지지 않는다', 줄들.length > 0 && 줄들.every((l) => l.length < 20000),
    `가장 긴 줄=${Math.max(...줄들.map((l) => l.length))}`);
  // 읽기 도구가 제 몫으로 이미 줄여 주는 판이 많아 위 끝-끝 검사만으로는 자르기가 빠져도 초록일 수 있다. 직접 잰다.
  const { 사건줄, 사건글한도 } = await import('../src/runlog.js');
  const 긴줄 = 사건줄({ type: 'tool', name: 'Read', result: { content: 긴글 } }, 5);
  check('★★ 사건 한 줄의 긴 글은 한도에서 잘리고, 잘렸다고 적힌다', 긴줄.length < 사건글한도 + 200 && /…\(\+56000\)/.test(긴줄),
    `길이=${긴줄.length}`);
  // 결과 줄은 자르지 않는다 — 「답은 마지막 줄에 통째로 있다」 가 약속이다 (2차 눈).
  const { 사건적기열기 } = await import('../src/runlog.js');
  const 결과파일 = join(work, '결과줄.jsonl');
  const 적개 = 사건적기열기(결과파일);
  적개.결과({ code: 0, text: '답'.repeat(9000) });
  적개.닫기();
  const 결과줄 = JSON.parse(readFileSync(결과파일, 'utf8').trim().split('\n').at(-1));
  check('★★ 마지막 결과 줄의 답은 한도를 넘어도 통째로 실린다', 결과줄.type === 'result' && 결과줄.text?.length === 9000, `길이=${결과줄.text?.length}`);
  check('  사건마다 시작부터 흐른 시간(ms)이 붙는다', 읽은것.length > 0 && 읽은것.every((e) => Number.isFinite(e?.elapsed)));
  const r2 = await 띄우기(['run', '--json', '--events', join(work, '없는폴더', '깊이', 'e.jsonl'), '안녕'], work);
  check('★★ 사건 파일을 못 열면 일을 시작하기 전에 선다', r2.code === 1 && 한덩이(r2.out)?.reason === 'events',
    `code=${r2.code} out=${r2.out.slice(0, 160)}`);
}

trace('8-mcp프롬프트');
{
  // `deel run /mcp__<서버>__<프롬프트>` — HTTP 로 붙는 MCP 서버의 프롬프트를 배치에서도 부른다 (2.1.3 · commands.js 의 MCP프롬프트펴기).
  const 엠씨피 = createServer((req, res) => {
    let 글 = '';
    req.on('data', (d) => { 글 += d; });
    req.on('end', () => {
      if (req.method !== 'POST') { res.writeHead(200).end(); return; }
      const j = JSON.parse(글 || '{}');
      if (j.id == null) { res.writeHead(202).end(); return; }
      const 답 = (result) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'run-1' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result })); };
      if (j.method === 'initialize') return 답({ protocolVersion: '2025-06-18', capabilities: { prompts: {} }, serverInfo: { name: '배치스텁', version: '1' } });
      if (j.method === 'prompts/list') return 답({ prompts: [{ name: 'review', arguments: [{ name: 'file', required: true }] }] });
      if (j.method === 'prompts/get') return 답({ messages: [{ role: 'user', content: { type: 'text', text: `${j.params?.arguments?.file} 파일을 검토하는 프롬프트` } }] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, error: { code: -32601, message: 'no' } }));
    });
  });
  await new Promise((r) => 엠씨피.listen(0, '127.0.0.1', r));
  const 폴더 = mkdtempSync(join(tmpdir(), 'deel-runs-mcp-'));
  mkdirSync(join(폴더, '.deel'), { recursive: true });
  writeFileSync(join(폴더, '.deel', 'mcp.json'), JSON.stringify({ mcpServers: { 위키: { type: 'http', url: `http://127.0.0.1:${엠씨피.address().port}/mcp` } } }), 'utf8');
  받은요청 = [];
  const 믿고띄우기 = (인자) => new Promise((done) => {
    const kid = spawn(process.execPath, [진입점, ...인자], {
      cwd: 폴더, env: { ...process.env, DEEL_HOME: home, NO_COLOR: '1', COLUMNS: '100', DEEL_TRUST_ALL: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = ''; let err = '';
    kid.stdout.on('data', (b) => { out += b; });
    kid.stderr.on('data', (b) => { err += b; });
    const 시계 = setTimeout(() => kid.kill('SIGKILL'), 60000);
    kid.on('close', (code) => { clearTimeout(시계); done({ code, out, err }); });
  });
  const r = await 믿고띄우기(['run', '--json', '/mcp__위키__review', 'src/app.js']);
  const 보낸사람말 = (받은요청[0]?.messages ?? []).filter((m) => m.role === 'user').map((m) => String(m.content));
  check('★★★ deel run /mcp__<서버>__<프롬프트> 가 서버의 프롬프트를 받아 모델에게 시킨다', r.code === 0 && 보낸사람말.some((s) => /src\/app\.js 파일을 검토하는 프롬프트/.test(s)),
    `code=${r.code} 사람말=${JSON.stringify(보낸사람말).slice(0, 160)} err=${r.err.slice(0, 200)}`);
  const r2 = await 믿고띄우기(['run', '--json', '/mcp__위키__review']);
  check('★★ 꼭 필요한 인자가 없으면 모델을 안 부르고 까닭을 말한다', r2.code === 1 && /인자가 모자랍니다/.test(한덩이(r2.out)?.error ?? r2.out + r2.err),
    `code=${r2.code} out=${r2.out.slice(0, 200)}`);
  엠씨피.closeAllConnections?.();
  엠씨피.close();
  rmSync(폴더, { recursive: true, force: true, maxRetries: 3 });
}

trace('9-가볍게');
{
  // 슬래시 명령 찾기는 src/slash.js 에 있다 — deel run 이 대화 화면의 명령 전부(commands.js)를 읽지 않게 (2.1.3).
  const 한번 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'oneshot.js'), 'utf8');
  check('★ deel run 은 대화 화면 명령 모음(commands.js)을 불러오지 않는다', !/from '\.\/commands\.js'/.test(한번) && /from '\.\/slash\.js'/.test(한번));
}

srv.close();
rmSync(home, { recursive: true, force: true, maxRetries: 3 });
rmSync(work, { recursive: true, force: true, maxRetries: 3 });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\ndeel run 대화 남기기 · 이어 하기  ${D}(--continue · --resume · files · --events)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
