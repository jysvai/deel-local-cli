// 화면이 어떻게 보이는지 실제로 돌려서 보여준다. 모델은 가짜 게이트웨이가 대신한다.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let turn = 0;
const script = [
  { toolCall: { name: 'Grep', args: { pattern: 'console\.log', output_mode: 'files_with_matches' } } },
  { toolCall: { name: 'Read', args: { file_path: 'src/runner.js' } } },
  { toolCall: { name: 'Edit', args: { file_path: 'src/runner.js', old_string: 'console.log("start " + id)', new_string: 'log.info("start", { id })' } } },
  { text: '로그 호출을 logger 형식으로 통일했습니다. runner.js 한 군데를 고쳤습니다.' },
];

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
      return res.end(JSON.stringify({ data: [{ id: 'sec-llm-01' }] }));
    }
    const step = script[turn++] ?? { text: '끝났습니다.' };
    if (step.toolCall) {
      const a = JSON.stringify(step.toolCall.args);
      return sse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c' + turn, function: { name: step.toolCall.name, arguments: a } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 900, completion_tokens: 40 } },
      ]);
    }
    const parts = String(step.text).match(/.{1,6}/gs) ?? [''];
    return sse(res, [
      ...parts.map((p) => ({ choices: [{ delta: { content: p } }] })),
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1200, completion_tokens: 60 } },
    ]);
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const work = mkdtempSync(join(tmpdir(), 'deel-demo-'));
mkdirSync(join(work, 'src'), { recursive: true });
writeFileSync(join(work, 'src', 'runner.js'), 'function run(id) {\n  console.log("start " + id)\n  return go(id)\n}\n', 'utf8');
writeFileSync(join(work, 'src', 'util.js'), 'export const noop = () => {}\n', 'utf8');
mkdirSync(join(work, '.deel'), { recursive: true });
writeFileSync(join(work, '.deel', 'config.json'), JSON.stringify({
  version: 1, active: 'gw',
  profiles: [{
    id: 'gw', name: '사내게이트웨이', kind: 'openai',
    baseUrl: `http://127.0.0.1:${port}/v1`, auth: 'bearer', apiKey: 'demo-key',
    model: 'sec-llm-01', ctx: 128000, streaming: true, tools: true, json: true, think: true,
  }],
}, null, 2), 'utf8');

const input = [
  '이 폴더에서 로그 형식 통일해줘',
  '/context',
  '/undo',
  '/cost',
  '/exit',
].join('\n') + '\n';

const child = spawn(process.execPath, [join(process.cwd(), 'bin', 'deel.js')], {
  cwd: work,
  env: { ...process.env, FORCE_COLOR: '1' },
  stdio: ['pipe', 'inherit', 'inherit'],
});
child.stdin.write(input);
child.stdin.end();
await new Promise((r) => child.on('close', r));

server.close();
rmSync(work, { recursive: true, force: true });
