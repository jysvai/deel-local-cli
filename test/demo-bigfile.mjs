// 눈으로 보는 검증 — 진짜 deel 을 띄워 "AX 대시보드 만들어줘" 를 시킨다.
//
// 검사(bigfile.test.js)는 함수를 부르지만, 이건 실제 명령을 그대로 돌린다.
// 사용자가 겪은 그 장면을 그대로 재현해서, 지금은 어떻게 되는지 화면으로 본다.
//
// 가짜 게이트웨이가 하는 일:
//   1. max_tokens 를 **진짜로 지킨다** — 상한보다 긴 답은 그 자리에서 자른다.
//   2. 약한 모델처럼 군다 — 남은 것을 매번 통째로 보내려 든다.
//   그러니 잘리는 것은 우리가 꾸민 게 아니라 조건에서 저절로 나온다.
//
// 돌리는 법:  node test/demo-bigfile.mjs
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const 방 = mkdtempSync(join(tmpdir(), 'deel-demo-'));
const 설정집 = mkdtempSync(join(tmpdir(), 'deel-demo-home-'));

// ── 만들어야 할 파일: 1,200줄 대시보드 ──────────────────────────────────
const 목표줄 = ['<!DOCTYPE html>', '<html lang="ko">', '<head>', '<meta charset="utf-8">',
  '<title>AX 대시보드</title>', '</head>', '<body>', '<h1>업무 자동화 현황</h1>'];
for (let i = 1; i <= 1189; i++) {
  목표줄.push(`  <div class="row" data-no="${i}"><span>반복 업무 ${i}</span><b>${i * 7}건</b></div>`);
}
목표줄.push('</body>', '</html>');

let 보낸데까지 = 0;
const 기록 = [];

const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'databricks-gpt-5-6-luna' }] }));
    }
    const 요청 = JSON.parse(body || '{}');
    const 상한 = 요청.max_tokens ?? 4096;

    const 마지막결과 = [...(요청.messages ?? [])].reverse().find((m) => m.role === 'tool');
    const m = String(마지막결과?.content ?? '').match(/(\d+)줄(?:까지 저장됨|, 지금 전체 (\d+)줄)/);
    if (m) 보낸데까지 = Number(m[2] ?? m[1]);

    if (보낸데까지 >= 목표줄.length) {
      기록.push({ 상한, 한일: '끝났다고 답함' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'AX 대시보드를 만들었습니다. 반복 업무 1,189건을 표로 담았습니다.' } }],
        usage: { prompt_tokens: 2000, completion_tokens: 30 },
      }));
    }

    const 처음 = 보낸데까지 === 0;
    const 남은것 = 목표줄.slice(보낸데까지).join('\n') + '\n';
    const 인자 = JSON.stringify({ file_path: 'dashboard.html', content: 남은것 });
    const 글자상한 = 상한 * 3;
    const 잘린인자 = 인자.length > 글자상한 ? 인자.slice(0, 글자상한) : 인자;
    const 잘렸나 = 잘린인자.length < 인자.length;
    기록.push({ 상한, 한일: `${처음 ? 'Write' : 'Append'} ${잘렸나 ? '(잘림)' : '(온전)'}` });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{
        index: 0,
        // 게이트웨이가 잘라 놓고 stop 이라고 말하는 경우까지 그대로 흉내 낸다.
        finish_reason: 잘렸나 ? 'stop' : 'tool_calls',
        message: {
          role: 'assistant', content: null,
          tool_calls: [{ id: `c${기록.length}`, type: 'function',
            function: { name: 처음 ? 'Write' : 'Append', arguments: 잘린인자 } }],
        },
      }],
      usage: { prompt_tokens: 2000, completion_tokens: 상한 },
    }));
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

// 사용자 설정과 똑같은 모양의 프로필. 컨텍스트 32,768 — 겪으신 그 조건이다.
mkdirSync(설정집, { recursive: true });
writeFileSync(join(설정집, 'config.json'), JSON.stringify({
  active: 'demo', level: '개발자',
  profiles: [{
    id: 'demo', name: '사내 게이트웨이', kind: 'openai',
    baseUrl: `http://127.0.0.1:${port}/v1`, auth: 'none',
    model: 'databricks-gpt-5-6-luna', ctx: 32768,
    streaming: false, tools: true, json: true, think: false,
  }],
}, null, 2), 'utf8');

console.log(`\n\x1b[90m─── 실제 화면 ─────────────────────────────────────────────────\x1b[0m\n`);

const kid = spawn(process.execPath, [join(here, '..', 'bin', 'deel.js'), 'chat'], {
  cwd: 방,
  env: { ...process.env, DEEL_HOME: 설정집, FORCE_COLOR: '1', DEEL_NET_ALLOW: `http://127.0.0.1:${port}/v1` },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let 화면 = '';
kid.stdout.on('data', (d) => { const s = d.toString('utf8'); 화면 += s; process.stdout.write(s); });
kid.stderr.on('data', (d) => process.stderr.write(d.toString('utf8')));

// 화면이 조용해지면 다음 줄을 넣는다. 고정 시간으로 기다리면 느린 컴퓨터에서 어긋난다.
const 조용해지면 = (ms = 2500, 최대 = 120000) => new Promise((done) => {
  let 마지막 = 화면.length;
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (화면.length === 마지막 || Date.now() - t0 > 최대) { clearInterval(iv); done(); }
    마지막 = 화면.length;
  }, ms);
});

await 조용해지면();
kid.stdin.write('AX 대시보드 만들어줘\n');
await 조용해지면();
kid.stdin.write('/exit\n');
await new Promise((done) => { kid.on('close', done); setTimeout(done, 8000); });
try { kid.kill(); } catch {}
srv.close();

console.log(`\n\x1b[90m─── 결과 ──────────────────────────────────────────────────────\x1b[0m\n`);
const 만든것 = join(방, 'dashboard.html');
if (existsSync(만든것)) {
  const 내용 = readFileSync(만든것, 'utf8');
  const 줄수 = 내용.split('\n').length - 1;
  const 온전 = 내용 === 목표줄.join('\n') + '\n';
  console.log(`  파일          ${만든것}`);
  console.log(`  크기          ${줄수.toLocaleString()}줄 · ${(Buffer.byteLength(내용) / 1024).toFixed(1)}KB`);
  console.log(`  내용          ${온전 ? '\x1b[32m목표와 한 글자도 다르지 않음\x1b[0m' : '\x1b[31m다름\x1b[0m'}`);
  console.log(`  끝맺음        ${내용.trimEnd().endsWith('</html>') ? '\x1b[32m</html> 까지 있음\x1b[0m' : '\x1b[31m끊김\x1b[0m'}`);
} else {
  console.log(`  \x1b[31m파일이 없습니다\x1b[0m`);
}
console.log('');
console.log('  모델을 부른 내역');
for (const [i, r] of 기록.entries()) {
  console.log(`    ${String(i + 1).padStart(2)}. 상한 ${String(r.상한).padStart(6)} 토큰 → ${r.한일}`);
}
console.log('');
rmSync(방, { recursive: true, force: true });
rmSync(설정집, { recursive: true, force: true });
