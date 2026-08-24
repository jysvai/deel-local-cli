// 에이전트 루프를 모델 없이 검증한다.
// OpenAI 호환 규격을 흉내내는 가짜 게이트웨이를 띄워, 정해진 도구 호출을 돌려준다.
// 사내 게이트웨이와 같은 규격이므로 어댑터·스트리밍 파서·루프가 전부 함께 검증된다.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { allowEndpoint } from '../src/safety/network.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 가짜 게이트웨이 ────────────────────────────────────────────────
// 대본대로 응답한다. 매 호출마다 다음 차례로 넘어간다.
let script = [];
let turn = 0;
const seenBodies = [];

function sse(res, chunks) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const ch of chunks) res.write(`data: ${JSON.stringify(ch)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'fake-llm' }] }));
    }
    const parsed = JSON.parse(body || '{}');
    seenBodies.push(parsed);
    const step = script[turn++] ?? { text: '(대본 끝)' };

    if (step.toolCall) {
      // 도구 호출은 인자를 글자 단위로 쪼개 보낸다 — 실제 게이트웨이가 그렇게 한다.
      const argStr = JSON.stringify(step.toolCall.args);
      const mid = Math.floor(argStr.length / 2);
      return sse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: step.toolCall.name, arguments: argStr.slice(0, mid) } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: argStr.slice(mid) } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20 } },
      ]);
    }
    // 본문은 여러 조각으로 흘려보낸다.
    const parts = String(step.text).match(/.{1,8}/gs) ?? [''];
    return sse(res, [
      ...parts.map((p) => ({ choices: [{ delta: { content: p } }] })),
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 30 } },
    ]);
  });
});

// 포트 0 = 비어 있는 포트를 커널이 골라준다. 쓰고 있는 포트를 뺏지 않는다.
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/v1`;
// 자물쇠에 이 자리를 등록한다. 안 하면 요청이 나가기 전에 막힌다 — 그게 정상 동작이다.
allowEndpoint(base);

// ── 준비 ───────────────────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'deel-loop-'));
writeFileSync(join(root, 'app.js'), 'const port = 7080;\nstart(port);\n', 'utf8');

const conn = {
  kind: 'openai', base, auth: 'bearer', key: 'test-key', model: 'fake-llm',
  ctx: 32768, streaming: true, tools: true, json: true, think: false,
};
const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
const session = new Session(conn, { root, mode: 'auto', think: 'off' });

// 대본: 읽고 → 고치고 → 말한다
script = [
  { toolCall: { name: 'Read', args: { file_path: 'app.js' } } },
  { toolCall: { name: 'Edit', args: { file_path: 'app.js', old_string: 'const port = 7080;', new_string: 'const port = 7099;' } } },
  { text: '포트를 7080에서 7099로 바꿨습니다.' },
];

const events = [];
for await (const ev of run(session, ctx, '포트를 7099로 바꿔줘')) events.push(ev);

// ── 검증 ───────────────────────────────────────────────────────────
const kinds = events.map((e) => e.type);
check('루프가 끝까지 돌았다', kinds.includes('done'), kinds.join(','));
check('도구를 2번 실행했다', events.filter((e) => e.type === 'tool').length === 2);
check('스트리밍 조각을 받았다', events.filter((e) => e.type === 'content').length > 1,
  `${events.filter((e) => e.type === 'content').length}조각`);

const after = readFileSync(join(root, 'app.js'), 'utf8');
check('파일이 실제로 고쳐졌다', after.includes('7099') && !after.includes('7080'), after.trim());

const readEv = events.find((e) => e.type === 'tool' && e.name === 'Read');
check('Read 결과가 줄 번호를 달고 왔다', /1\tconst port/.test(readEv?.result?.content ?? ''));

const editEv = events.find((e) => e.type === 'tool' && e.name === 'Edit');
check('Edit 이 성공했다', !editEv?.result?.error, editEv?.result?.error ?? '');

// 쪼개져 온 도구 인자가 제대로 이어 붙었는지
check('쪼개진 도구 인자를 이어 붙였다', editEv?.args?.new_string === 'const port = 7099;', JSON.stringify(editEv?.args ?? {}));

// 게이트웨이에 보낸 요청 모양
const first = seenBodies[0];
// 파일 도구 6종 + 웹 읽기 + 할 일 목록. 스킬이 없는 세션이라 Skill 은 빠진다.
check('도구 정의 8종을 보냈다', first?.tools?.length === 8, `${first?.tools?.length}개`);
check('도구 이름이 Claude Code 와 같다',
  JSON.stringify(first?.tools?.map((t) => t.function.name))
    === JSON.stringify(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebFetch', 'TodoWrite']),
  JSON.stringify(first?.tools?.map((t) => t.function.name)));
check('시스템 프롬프트를 보냈다', first?.messages?.[0]?.role === 'system');

// 도구 결과를 규격대로 되돌려 넣었는지
const withTool = seenBodies[1];
const toolMsg = withTool?.messages?.find((m) => m.role === 'tool');
check('도구 결과를 tool_call_id 로 돌려보냈다', !!toolMsg?.tool_call_id, JSON.stringify(toolMsg ?? {}).slice(0, 80));

// 사용량 집계
check('토큰 사용량을 셌다', session.usage.in > 0 && session.usage.out > 0,
  `입력 ${session.usage.in} · 출력 ${session.usage.out}`);

// 컨텍스트 내역
const b = session.breakdown();
check('컨텍스트 내역이 계산된다', b.used > 0 && b.total === 32768, `${b.used}/${b.total}`);

// 되돌리기
ctx.history.undo(1);
check('Undo 로 원래대로', readFileSync(join(root, 'app.js'), 'utf8').includes('7080'));

// 범위 밖 거부 (모델이 시켜도 안 된다)
turn = 0;
script = [
  { toolCall: { name: 'Read', args: { file_path: '../../../etc/passwd' } } },
  { text: '읽을 수 없었습니다.' },
];
const s2 = new Session(conn, { root, mode: 'auto', think: 'off' });
const ev2 = [];
for await (const ev of run(s2, ctx, '바깥 파일 읽어줘')) ev2.push(ev);
const outside = ev2.find((e) => e.type === 'tool');
check('모델이 시켜도 범위 밖은 거부', /작업 범위 밖/.test(outside?.result?.error ?? ''), outside?.result?.error ?? '');

// 도구 호출 상한
turn = 0;
script = Array.from({ length: 30 }, () => ({ toolCall: { name: 'Glob', args: { pattern: '**/*' } } }));
const s3 = new Session(conn, { root, mode: 'auto', think: 'off', maxSteps: 4 });
const ev3 = [];
for await (const ev of run(s3, ctx, '계속 찾아줘')) ev3.push(ev);
check('도구 호출 상한에서 멈춘다', ev3.some((e) => e.type === 'limit'), `${ev3.filter((e) => e.type === 'tool').length}회 실행`);

// ── 결과 ───────────────────────────────────────────────────────────
const W = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, ch) => a + (ch.codePointAt(0) > 0x1100 ? 2 : 1), 0)));
console.log('');
console.log('  deel 엔진 검증 (가짜 게이트웨이)');
console.log('  ' + '─'.repeat(64));
for (const p of pass) console.log(`  \x1b[32m✓\x1b[0m ${W(p.name, 36)} \x1b[90m${p.note}\x1b[0m`);
for (const f of fail) console.log(`  \x1b[31m✗\x1b[0m ${W(f.name, 36)} \x1b[31m${f.note}\x1b[0m`);
console.log('  ' + '─'.repeat(64));
console.log(`  통과 ${pass.length} · 실패 ${fail.length}`);
console.log('');

// 서버를 띄운 뒤에는 process.exit() 를 쓰지 않는다.
//
// 아직 닫히는 중인 핸들이 남은 채로 프로세스를 끊으면 윈도우 libuv 가
//   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c
// 로 죽는다. 검사를 다 통과해 놓고도 종료코드가 1 이 되어, npm test 의
// && 사슬이 여기서 끊긴다. 붙어 있던 연결을 먼저 끊고, 닫힘이 한 바퀴
// 돌 틈을 준 다음, 종료코드만 정해 놓고 자연스럽게 끝나게 둔다.
server.closeAllConnections?.();
server.close();
await new Promise((r) => setImmediate(r));
rmSync(root, { recursive: true, force: true });
process.exitCode = fail.length ? 1 : 0;
