// 화면이 어떻게 보이는지 실제로 돌려서 보여준다. 모델은 가짜 게이트웨이가 대신한다.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let turn = 0;
const todos = (list) => ({ toolCall: { name: 'TodoWrite', args: { todos: list } } });

const script = [
  // 1) 짧은 일 — 찾고, 읽고, 고친다
  { toolCall: { name: 'Grep', args: { pattern: 'console\.log', output_mode: 'files_with_matches' } } },
  { toolCall: { name: 'Read', args: { file_path: 'src/runner.js' } } },
  { toolCall: { name: 'Edit', args: { file_path: 'src/runner.js', old_string: 'console.log("start " + id)', new_string: 'log.info("start", { id })' } } },
  { text: '로그 호출을 logger 형식으로 통일했습니다. runner.js 한 군데를 고쳤습니다.' },

  // 2) 긴 일 — 할 일을 적어 두고, 읽기는 한꺼번에 돌린다
  todos([
    { text: '지금 코드 훑기', state: 'doing' },
    { text: 'logger 로 바꾸기', state: 'todo' },
    { text: '문서 손보기', state: 'todo' },
  ]),
  {
    toolCalls: [
      { name: 'Read', args: { file_path: 'src/runner.js' } },
      { name: 'Read', args: { file_path: 'src/util.js' } },
      { name: 'Read', args: { file_path: 'src/db.js' } },
    ],
  },
  todos([
    { text: '지금 코드 훑기', state: 'done' },
    { text: 'logger 로 바꾸기', state: 'doing' },
    { text: '문서 손보기', state: 'todo' },
  ]),
  { text: '세 파일을 한꺼번에 읽었습니다. 이제 바꾸기로 넘어갑니다.' },
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
    // 한 번에 여러 개를 부르는 경우도 있다 — 읽기 도구는 그걸 동시에 돌린다.
    const calls = step.toolCalls ?? (step.toolCall ? [step.toolCall] : null);
    if (calls) {
      return sse(res, [
        {
          choices: [{
            delta: {
              tool_calls: calls.map((t, i) => ({
                index: i, id: `c${turn}_${i}`,
                function: { name: t.name, arguments: JSON.stringify(t.args) },
              })),
            },
          }],
        },
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
writeFileSync(join(work, 'src', 'db.js'), 'export function open(url) {\n  console.log("db " + url)\n  return connect(url)\n}\n', 'utf8');
/*
 * ── 설정은 **DEEL_HOME** 에 둔다. 폴더 안의 `.deel/` 이 아니다 ──────────
 *
 * 여기가 여태 `<임시폴더>/.deel/config.json` 이었다. 그런데 deel 이 설정을
 * 읽는 자리는 `DEEL_HOME` 아니면 `~/.deel` 이다(src/config.js). 그래서 이
 * 데모는 **한 번도 안 돌았다** — 띄우자마자 「저장된 연결이 없습니다」 한 줄만
 * 찍고 끝났고, 종료코드는 0 이라 아무도 안 물어봤다.
 *
 * 그냥 안 도는 것보다 나쁜 쪽도 있었다. 설정이 있는 PC 에서는 `~/.deel` 이
 * 읽히므로, 데모가 가짜 게이트웨이가 아니라 **진짜 창구**에 말을 건다.
 * 그래서 임시 집을 따로 주고, 나갈 수 있는 주소도 그 가짜 하나로 못 박는다
 * (demo-bigfile.mjs 와 같은 방식).
 */
const 설정집 = join(work, 'home');
mkdirSync(설정집, { recursive: true });
writeFileSync(join(설정집, 'config.json'), JSON.stringify({
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
  'src 전체를 logger 로 바꿔줘',   // 할 일 목록 + 읽기 동시 실행
  '/sessions',
  '/cost',
  '/exit',
].join('\n') + '\n';

const child = spawn(process.execPath, [join(process.cwd(), 'bin', 'deel.js')], {
  cwd: work,
  env: {
    ...process.env,
    FORCE_COLOR: '1',
    DEEL_HOME: 설정집,
    DEEL_NET_ALLOW: `http://127.0.0.1:${port}/v1`,
    DEEL_NO_OPEN: '1',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

/*
 * ── 화면을 흘려보내면서 **동시에 들고 있는다** ──────────────────────────
 *
 * 여태 `inherit` 이라 이쪽에서는 아무것도 못 봤다. 그래서 데모가 「저장된
 * 연결이 없습니다」 한 줄만 찍고 끝난 동안에도 종료코드는 0 이었고, 아무도
 * 안 물어봤다. 눈으로 보는 데모라도 **안 돌았으면 안 돌았다고** 말해야 한다.
 */
let 화면 = '';
child.stdout.on('data', (d) => { 화면 += d.toString('utf8'); process.stdout.write(d); });
child.stderr.on('data', (d) => { 화면 += d.toString('utf8'); process.stderr.write(d); });
child.stdin.write(input);
child.stdin.end();
await new Promise((r) => child.on('close', r));

server.close();
rmSync(work, { recursive: true, force: true });

// ── 정말로 돌았나 ───────────────────────────────────────────────────────
const 탈 = [];
if (turn === 0) 탈.push('가짜 게이트웨이가 한 번도 안 불렸습니다 — 설정을 못 읽었을 때 이렇게 됩니다');
if (!화면.includes('sec-llm-01')) 탈.push('화면에 이 데모의 모델 이름(sec-llm-01)이 없습니다');
if (/저장된 연결이 없습니다|deel setup/.test(화면)) 탈.push('설정을 못 찾아 setup 안내만 나왔습니다');
if (탈.length) {
  console.error(`\n\x1b[31m✗ 데모가 안 돌았습니다\x1b[0m\n  ${탈.join('\n  ')}\n`);
  process.exitCode = 1;
} else {
  console.log(`\n\x1b[32m✓\x1b[0m 데모가 끝까지 돌았습니다 \x1b[90m(모델 호출 ${turn}회)\x1b[0m\n`);
}
