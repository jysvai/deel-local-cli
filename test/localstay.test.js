// 로컬 모델로 일하다가 턴이 헛끊기지 않는가.
//
// 가짜 서버로만 잰다. 재는 것은 둘이다. 서버가 잠깐 탈이 나도, 모델이 조금 헤매도 일이 이어지는가.
// 그리고 **진짜 헛돌면 결국 멈추는가** — 안 끊는 것과 영영 도는 것은 다르다.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { allowEndpoint } from '../src/safety/network.js';
import { 걸음수 } from '../src/agent/budget.js';
import { 정책고르기, 다시부를까, 다시부를지, 기다릴시간 } from '../src/backend/retry.js';
import { 읽을자리 } from '../src/agent/compact.js';
import { 말 as 모드말, 로컬읽기로, ORDER } from '../src/agent/modes.js';
import { 지시말정하기 } from '../src/i18n/index.js';
import { toolSchemas } from '../src/tools/index.js';
import { 급말 } from '../src/agent/grade.js';
import { 잇단사람말합치기 } from '../src/backend/adapter.js';
import { handle } from '../src/commands.js';

let 통과 = 0;
let 실패 = 0;
const check = (이름, 됐나, 덧 = '') => {
  if (됐나) { 통과 += 1; console.log(`  ✓ ${이름}`); }
  else { 실패 += 1; console.log(`  ✗ ${이름}  ${덧}`); }
};

let script = [];
let turn = 0;
const 받은 = [];
const 쓰임 = { prompt_tokens: 100, completion_tokens: 20 };

function sse(res, 조각들) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const 조각 of 조각들) res.write(`data: ${JSON.stringify(조각)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'fake' }] }));
    }
    const 몸 = JSON.parse(body || '{}');
    받은.push(몸);
    const step = script[turn++] ?? { text: '(대본 끝)' };
    if (step.끊김) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '반쪽 답' } }] })}\n\n`);
      return void setTimeout(() => res.destroy(), 30);
    }
    if (step.닫힘글 || step.멎음글) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: step.닫힘글 ?? step.멎음글 } }] })}\n\n`);
      if (step.닫힘글) return void res.end();   // 끝 표시 없이 곱게 닫는다
      return void setTimeout(() => res.destroy(), 3000);   // 연결은 산 채로 멎는다
    }
    if (step.끝표시만) return sse(res, [{ choices: [{ delta: { content: step.끝표시만 } }] }]);   // finish_reason 없이 [DONE]
    if (step.너무김) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'the request exceeds the available context size (n_ctx = 4096)' } }));
    }
    if (step.빈답) {
      if (!몸.stream) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }], usage: 쓰임 }));
      }
      return sse(res, [{ choices: [{ delta: {}, finish_reason: 'stop' }] }]);
    }
    if (step.toolCall || step.toolCalls) {
      const 부름들 = step.toolCalls ?? [step.toolCall];
      return sse(res, [
        { choices: [{ delta: { tool_calls: 부름들.map((x, i) => ({ index: i, id: step.같은id ? 'same' : `c${turn}${i ? `_${i}` : ''}`, function: { name: x.name, arguments: JSON.stringify(x.args) } })) } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: 쓰임 },
      ]);
    }
    return sse(res, [
      { choices: [{ delta: { content: step.text } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: 쓰임 },
    ]);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/v1`;
allowEndpoint(base);

const root = mkdtempSync(join(tmpdir(), 'deel-localstay-'));
writeFileSync(join(root, 'big.txt'), Array.from({ length: 2000 }, (_, i) => `줄 ${i + 1}`).join('\n'), 'utf8');
const 문맥 = () => ({ scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set(), 로컬: true });
const 돌리기 = async (대본, { 창 = 32768, 먼저 = null, work = 'code', 연결 = {} } = {}) => {
  script = 대본;
  turn = 0;
  받은.length = 0;
  const conn = { kind: 'openai', base, auth: 'bearer', key: 'k', model: 'fake', ctx: 창, streaming: true, tools: true, json: true, think: false, ...연결 };
  const s = new Session(conn, { root, work, think: 'off' });
  if (먼저) s.push(먼저);
  const 사건 = [];
  for await (const ev of run(s, 문맥(), '이 일을 해줘')) 사건.push(ev);
  return { s, 사건, 종류: 사건.map((e) => e.type), 요청수: 받은.length };
};
const 끝 = (r) => r.종류[r.종류.length - 1];
const 읽기 = (n) => ({ toolCall: { name: 'Read', args: { file_path: 'big.txt', offset: (n + 1) * 10 + 1, limit: 10 } } });
const 고치기 = (옛, 새 = 'x') => ({ toolCall: { name: 'Edit', args: { file_path: 'a.txt', old_string: 옛, new_string: 새 } } });

console.log('서버 탈');
{
  const r = await 돌리기([{ 끊김: true }, { 끊김: true }, { text: '다 됐습니다' }]);
  check('★★★ 답하다 끊겨도 다시 물어 끝낸다', 끝(r) === 'done' && !r.종류.includes('error'), r.종류.join());
  check('★★★ 끊긴 반쪽 답은 대화에 안 남는다', !JSON.stringify(r.s.messages).includes('반쪽 답'));
  const 넷 = await 돌리기([{ 끊김: true }, { 끊김: true }, { 끊김: true }, { 끊김: true }, { text: '안 와야 함' }]);
  check('★★ 계속 끊기면 결국 오류로 말한다', 넷.종류.includes('error') && 넷.요청수 === 4, `${넷.종류.join()} · 요청 ${넷.요청수}`);
  const 앞 = await 돌리기([{ 끊김: true }, { 끊김: true }, { 끊김: true }, { toolCall: { name: 'Glob', args: { pattern: '*.txt' } } }, { 끊김: true }, { 끊김: true }, { 끊김: true }, { text: '끝' }]);
  check('★★ 답을 받으면 끊김 셈이 처음부터다', 끝(앞) === 'done', 앞.종류.join());

  script = [{ 끊김: true }, { text: '안 와야 함' }];
  turn = 0;
  받은.length = 0;
  const 멈춤 = new AbortController();
  const 멈춤conn = { kind: 'openai', base, auth: 'bearer', key: 'k', model: 'fake', ctx: 32768, streaming: true, tools: true, json: true, think: false };
  const 멈춤사건 = [];
  for await (const ev of run(new Session(멈춤conn, { root, work: 'code', think: 'off' }), 문맥(), '이 일을 해줘', { signal: 멈춤.signal })) {
    멈춤사건.push(ev.type);
    if (ev.type === 'note') 멈춤.abort();
  }
  check('★★★ 다시 묻기를 기다리는 중에도 ESC 가 먹는다', 멈춤사건.includes('aborted') && 받은.length === 1, `${멈춤사건.join()} · 요청 ${받은.length}`);

  const 로컬 = 정책고르기({ base }, {});
  check('★★★ 로컬 503 은 오래 기다린다', 다시부를까({ status: 503, attempt: 20 }, 로컬) && !다시부를까({ status: 503, attempt: 21 }, 로컬));
  check('★★ 503 을 기다리는 동안 알림 횟수가 맞다', 다시부를지({ status: 503 }, 4, 로컬)?.max === 20, String(다시부를지({ status: 503 }, 4, 로컬)?.max));
  check('★★★ 큰 모델을 올리는 동안 총상한에 먼저 걸리지 않는다', 로컬.총상한 >= 720000, String(로컬.총상한));
  const 붙었던 = 정책고르기({ base, 응답받음: base }, {});
  check('★★★ 응답한 적 있는 로컬 서버가 꺼지면 돌아오길 기다린다', 다시부를까({ code: 'ECONNREFUSED', attempt: 8 }, 붙었던));
  check('★★ 꺼진 동안의 알림 횟수가 맞다', 다시부를지({ code: 'ECONNREFUSED' }, 4, 붙었던)?.max === 20, String(다시부를지({ code: 'ECONNREFUSED' }, 4, 붙었던)?.max));
  check('★★ 꺼진 동안의 사다리도 뒤로 갈수록 길다', 기다릴시간({ attempt: 6, code: 'ECONNREFUSED' }, 붙었던) >= 30000 && 다시부를지({ code: 'ECONNREFUSED' }, 6, 붙었던)?.wait >= 30000);
  check('★★ 재시작 중 소켓이 끊겨도 같은 사다리로 기다린다', 다시부를까({ code: 'ECONNRESET', attempt: 8 }, 붙었던) && !다시부를까({ code: 'ECONNRESET', attempt: 8 }, 로컬));
  check('★★ 다른 주소에서 받은 응답은 안 친다', !다시부를까({ code: 'ECONNREFUSED', attempt: 1 }, 정책고르기({ base, 응답받음: 'http://127.0.0.1:1/v1' }, {})));
  check('★★★ 한 번도 응답 안 한 주소는 바로 말한다', !다시부를까({ code: 'ECONNREFUSED', attempt: 1 }, 로컬));
  check('★★★ 바깥 연결은 꺼져도 안 기다린다', !다시부를까({ code: 'ECONNREFUSED', attempt: 1 }, 정책고르기({ base: 'https://api.example.com/v1', 응답받음: 'https://api.example.com/v1' }, {})));
  check('★★ 재시도를 직접 정했으면 꺼져도 안 기다린다', !다시부를까({ code: 'ECONNREFUSED', attempt: 1 }, 정책고르기({ base, 응답받음: base, retry: { 최대: 1 } }, {})));
  check('★★ 로컬 500 은 여전히 빨리 말한다', !다시부를까({ status: 500, attempt: 4 }, 로컬));
  check('★★ 503 사다리가 뒤로 갈수록 길다', 기다릴시간({ attempt: 6, status: 503 }, 로컬) >= 30000);
  const 바깥 = 정책고르기({ base: 'https://api.example.com/v1' }, {});
  check('★★★ 바깥 연결은 그대로다', !다시부를까({ status: 503, attempt: 4 }, 바깥));
  check('★★ 설정으로 준 재시도가 먼저다', !다시부를까({ status: 503, attempt: 2 }, 정책고르기({ base, retry: { 최대: 1 } }, {})));
  check('★★ 재시도 설정 일부만 줘도 로컬 대기는 남는다', 다시부를까({ status: 503, attempt: 8 }, 정책고르기({ base, retry: { 막힘최대: 5 } }, {})));
}

console.log('빈 답');
{
  const r = await 돌리기([{ 빈답: true }, { 빈답: true }, { 빈답: true }, { 빈답: true }, { text: '이제 답합니다' }]);
  check('★★★ 빈 답이 이어져도 재촉해서 끝낸다', 끝(r) === 'done' && !r.종류.includes('error'), r.종류.join());
  check('★★ 재촉이 모델에게 갔다', /\[deel\]/.test(JSON.stringify(받은[받은.length - 1].messages)));
  const 끝없음 = await 돌리기(Array.from({ length: 12 }, () => ({ 빈답: true })));
  check('★★ 끝까지 비면 오류로 말한다', 끝없음.종류.includes('error') && 끝없음.요청수 === 6, `${끝없음.종류.join()} · 요청 ${끝없음.요청수}`);
}

console.log('Edit');
{
  writeFileSync(join(root, 'a.txt'), 'hello world\n', 'utf8');
  const 읽음 = { toolCall: { name: 'Read', args: { file_path: 'a.txt' } } };
  const r = await 돌리기([읽음, 고치기('hello wor1'), 고치기('hello wor2'), 고치기('hello wor3'), 고치기('hello wor4'), 고치기('hello world', 'hello deel'), { text: '고쳤습니다' }]);
  check('★★★ 다른 글로 고쳐 보는 것은 안 끊는다', 끝(r) === 'done' && !r.종류.includes('stuck'), r.종류.join());
  check('★★★ 맞으면 파일이 바뀐다', readFileSync(join(root, 'a.txt'), 'utf8') === 'hello deel\n');

  writeFileSync(join(root, 'a.txt'), 'hello world\n', 'utf8');
  const 같은것 = await 돌리기([읽음, ...Array.from({ length: 30 }, () => 고치기('없는 글'))]);
  check('★★★ 똑같이 틀리면 결국 멈춘다', 같은것.종류.includes('stuck') && 같은것.요청수 < 12, `요청 ${같은것.요청수}`);
  const 온갖 = await 돌리기([읽음, ...Array.from({ length: 30 }, (_, i) => 고치기(`없는 글 ${i}`))]);
  check('★★★ 끝없이 헛짚으면 결국 멈춘다', 온갖.종류.includes('stuck') && 온갖.요청수 < 20, `요청 ${온갖.요청수}`);
}

console.log('변경성 명령');
{
  writeFileSync(join(root, 'a.txt'), 'hello world\n', 'utf8');
  const 명령 = { toolCall: { name: 'Bash', args: { command: 'rm -f 없는것1.txt' } } };
  const r = await 돌리기([명령, { toolCall: { name: 'Read', args: { file_path: 'a.txt' } } }, 고치기('hello world', 'hello deel'), 명령, 명령, { text: '끝' }], { work: 'auto' });
  const 거절 = r.사건.filter((e) => e.type === 'tool' && /다시 실행하지 않습니다/.test(String(e.result?.error ?? '')));
  check('★★★ 파일을 고친 뒤에는 같은 명령을 다시 돌릴 수 있다', 거절.length === 1, `거절 ${거절.length}번`);
  check('★★★ 그 사이 고친 것이 없으면 여전히 안 돌린다', 끝(r) === 'done', r.종류.slice(-3).join());
}

console.log('긴 일');
{
  const 긴 = await 돌리기([...Array.from({ length: 60 }, (_, i) => 읽기(i)), { text: '다 읽었습니다' }], { 창: 8192 });
  check('★★★ 작은 창에서도 새 줄을 읽는 긴 일을 안 끊는다', 끝(긴) === 'done' && !긴.종류.includes('limit'), 긴.종류.slice(-3).join());
  check('★★ 로컬 일 모드는 걸음이 넉넉하다', 걸음수('code', 8192, true) === 300 && 걸음수('auto', 8192, true) === 300);
  check('★★ 로컬 묻기도 넉넉하다', 걸음수('ask', 8192, true) === 40);
  check('★★★ 바깥 연결의 걸음은 그대로다', 걸음수('code', 8192) === 16 && 걸음수('ask', 8192) === 4);

  const 돌아섬 = await 돌리기([...Array.from({ length: 12 }, () => 읽기(1)), { toolCall: { name: 'Glob', args: { pattern: '*.txt' } } }, { toolCall: { name: 'Glob', args: { pattern: '*.md' } } }, { text: '다른 길로 끝냈습니다' }]);
  check('★★★ 재촉을 듣고 다른 일을 하면 턴이 안 끊긴다', 끝(돌아섬) === 'done' && !돌아섬.종류.includes('stuck'), 돌아섬.종류.slice(-4).join());

  const 헛 = await 돌리기(Array.from({ length: 30 }, () => 읽기(1)));
  check('★★★ 같은 줄만 읽으면 결국 멈춘다', 헛.종류.includes('stuck') && 헛.요청수 <= 14, `요청 ${헛.요청수}`);
  check('★★★ 멈추기 전에 다른 방법을 쓰라고 말한다', /되풀이하고|repeating/.test(JSON.stringify(받은[받은.length - 1].messages)));
}

console.log('크게 읽기');
{
  writeFileSync(join(root, 'whole.txt'), Array.from({ length: 1200 }, (_, i) => `const value${i} = compute(${i}); // 줄 ${i + 1}`).join('\n'), 'utf8');
  const r = await 돌리기([{ toolCall: { name: 'Read', args: { file_path: 'whole.txt' } } }, { text: '읽었습니다' }], { 창: 48000 });
  const 받은글 = String(r.s.messages.find((m) => m.role === 'tool')?.content ?? '');
  check('★★★ 창에 들어가면 큰 파일을 한 번에 다 읽는다', 받은글.includes('줄 1200') && !/Next: offset/.test(받은글), `${받은글.length}자`);
  check('★★★ 다 읽어도 바로 안 비운다', !r.종류.includes('reset') && !r.종류.includes('compacted'), r.종류.join());

  writeFileSync(join(root, 'huge.txt'), Array.from({ length: 30000 }, (_, i) => `const value${i} = compute(${i}); // 줄 ${i + 1}`).join('\n'), 'utf8');
  const 큰 = await 돌리기([{ toolCall: { name: 'Read', args: { file_path: 'huge.txt' } } }, { text: '읽었습니다' }], { 창: 48000 });
  const 큰글 = String(큰.s.messages.find((m) => m.role === 'tool')?.content ?? '');
  check('★★★ 안 들어가면 들어가는 만큼 읽고 이어 읽을 자리를 준다', /Next: offset=\d+/.test(큰글), 큰글.slice(-120));
  check('★★★ 넘치게 읽어 곧바로 비우지 않는다', !큰.종류.includes('reset'), 큰.종류.join());
  writeFileSync(join(root, 'small.txt'), Array.from({ length: 300 }, (_, i) => `줄 ${i + 1}`).join('\n'), 'utf8');
  const 앞만 = await 돌리기([{ toolCall: { name: 'Read', args: { file_path: 'small.txt', offset: 1, limit: 20 } } }, { text: '끝' }], { 창: 48000 });
  check('★★★ 처음부터 읽으면 limit 을 줘도 다 들어가는 파일은 통째로 준다', String(앞만.s.messages.find((m) => m.role === 'tool')?.content ?? '').includes('줄 300'));
  const 찾기 = await 돌리기([{ toolCall: { name: 'Grep', args: { pattern: 'compute', path: 'whole.txt', output_mode: 'content' } } }, { text: '끝' }], { 창: 48000 });
  const 찾은글 = String(찾기.s.messages.find((m) => m.role === 'tool')?.content ?? '');
  check('★★ Grep 결과도 남은 창을 보고 더 싣는다 (옛 상한 7,680자)', 찾은글.length > 8000, `${찾은글.length}자`);
  const 첫길이 = 큰글.length;
  check('★★ 예전 상한(약 22,500자)보다 많이 싣는다', 첫길이 > 40000, `${첫길이}자`);

  const 대본 = [...Array.from({ length: 9 }, (_, i) => ({ toolCall: { name: 'Read', args: { file_path: 'big.txt', offset: i * 200 + 1, limit: 200 } } })), { text: '끝' }];
  const 좁은 = await 돌리기(대본, { 창: 6000 });
  check('먼저: 자리가 모자라 비우는 자리까지 갔다 (이 검사의 밑천)', 좁은.종류.includes('reset') || 좁은.종류.includes('compacted'), 좁은.종류.join());
  const 못본 = 받은.map((몸, i) => (i === 0 || 몸.messages.some((m) => m.role === 'tool' && m.tool_call_id === `c${i}`) ? null : i)).filter((x) => x !== null);
  check('★★★ 모델은 제가 부른 도구의 결과를 언제나 본다', 못본.length === 0, `못 본 요청 ${못본.join()}`);

  for (const 말 of ['ko', 'en']) {
    지시말정하기(말);
    const 글들 = ORDER.flatMap((일) => [로컬읽기로(모드말(일, 6000), 일), 로컬읽기로(모드말(일, 64000), 일)]).join('\n');
    const 남은것 = /only\s+around|Never whole|Do not read whole|Read whole\s+files and|짚은 자리|통째로 읽지|통째로 읽으면/.exec(글들)?.[0];
    check(`★★★ 로컬 지시문에 조각으로 읽으라는 말이 없다 (${말})`, !남은것, 남은것);
    check(`★★★ 로컬 지시문은 통째로 읽으라고 한다 (${말})`, 말 === 'en' ? /whole file at once/.test(글들) : /통째로 한 번/.test(글들));
    const 코드글 = 로컬읽기로(모드말('code', 64000), 'code');
    check(`★★ 로컬에서는 일을 하위로 떼지 말라고 한다 (${말})`, /Use Task only if|사람이 시킬 때만 Task/.test(코드글));
    check(`★★ 아는 파일까지 Outline 을 거치게 하지 않는다 (${말})`, !/Outline\s*(?:→|->)/.test(로컬읽기로(모드말('code', 6000), 'code')));
    check(`★★ 총괄 모드의 Task 는 그대로다 (${말})`, !/Use Task only if|사람이 시킬 때만 Task/.test(로컬읽기로(모드말('orchestrator', 64000), 'orchestrator')));
    const 도구 = toolSchemas(null, { 핵심남김: true }).map((x) => x.function);
    const 읽기정의 = 도구.find((x) => x.name === 'Read');
    check(`★★★ 로컬 Read 설명이 offset·limit 을 쓰지 말라고 한다 (${말})`, /Leave out|있을 때만/.test(읽기정의.parameters.properties.offset.description) && /whole file|파일 전체/.test(읽기정의.parameters.properties.limit.description));
    for (const 읽기만 of ['ask', 'plan', 'architect', 'inspect']) {
      const 글 = 로컬읽기로(모드말(읽기만, 6000), 읽기만);
      check(`★★★ 읽기만 하는 ${읽기만} 모드에 고치라는 말이 안 붙는다 (${말})`, !/then make the change|바로 고친다/.test(글), 글.slice(0, 80));
    }
    check(`★★ 고치는 모드는 읽고 바로 고치라고 한다 (${말})`, /then make the change|바로 고친다/.test(로컬읽기로(모드말('code', 6000), 'code')));
    const 일묶음 = 로컬읽기로(모드말('code', 64000), 'code') + 로컬읽기로(모드말('auto', 6000), 'auto');
    check(`★★ 파일을 안 고친 턴까지 Verify 를 시키지 않는다 (${말})`, !/(?<!files, call )Verify before you finish|(?<!고쳤으면 )끝(?:내기|맺기) 전에 Verify/.test(일묶음));
    check(`★★ 급 안내도 지시말을 따른다 (${말})`, 말 === 'en' ? /Sized to this model/.test(급말('작음')) && !/끝맺기/.test(급말('작음')) : /이 모델에 맞춘 것/.test(급말('작음')));
    await 돌리기([{ text: '끝' }]);
    const 머리글 = JSON.stringify(받은[0].messages.filter((m) => m.role === 'system'));
    check(`★★★ 실제 요청의 시킴말 머리가 지시말을 따른다 (${말})`, 말 === 'en' ? /Working folder:/.test(머리글) && !/작업 폴더:/.test(머리글) : /작업 폴더:/.test(머리글));
    check(`★★ 실제 요청의 기본 규칙도 Verify 를 조건으로 건다 (${말})`, /If you changed files|파일을 고쳤으면/.test(머리글) && !/(?<!files, call )Verify before you finish|(?<!고쳤으면 )끝(?:내기|맺기) 전에 Verify/.test(머리글));
    check(`★★ 로컬 Verify 설명이 언제나 부르라고 하지 않는다 (${말})`, !/반드시|must/i.test(도구.find((x) => x.name === 'Verify').description));
    check(`★★ 로컬 Task 설명이 일을 나누라고 하지 않는다 (${말})`, /only when the person|사람이 시킬 때만/.test(도구.find((x) => x.name === 'Task').description));
    const 총괄도구 = toolSchemas(null, { 핵심남김: true, work: 'orchestrator' }).map((x) => x.function);
    check(`★★ 총괄 모드의 Task 설명은 그대로다 (${말})`, !/only when the person|사람이 시킬 때만/.test(총괄도구.find((x) => x.name === 'Task').description));
    check(`★★ 로컬 Outline 설명이 Read 를 말리지 않는다 (${말})`, !/수십 분의 일|fraction/.test(도구.find((x) => x.name === 'Outline').description));
  }
  지시말정하기('auto');

  const 실제시킴 = await 돌리기([{ text: '끝' }]);
  const 시킴글 = JSON.stringify(받은[0].messages.filter((m) => m.role === 'system'));
  check('★★★ 로컬 요청의 시킴말이 통째로 읽으라고 한다', /whole file at once|통째로 한 번/.test(시킴글) && 끝(실제시킴) === 'done', 시킴글.slice(0, 80));
  check('★★★ 로컬 요청의 시킴말에 조각으로 읽으라는 말이 없다', !/only\s*around|Never whole|통째로 읽지/.test(시킴글.replace(/\n/g, ' ')));
}

console.log('서버 재시작');
{
  let 부른수 = 0;
  const 재시작 = createServer((req, res) => {
    let 몸 = '';
    req.on('data', (d) => (몸 += d));
    req.on('end', () => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'fake' }] }));
      }
      부른수 += 1;
      if (부른수 > 1) return sse(res, [{ choices: [{ delta: { content: '돌아와서 끝냈습니다' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: 쓰임 }]);
      // 첫 답을 다 준 뒤 서버를 내리고, 조금 뒤 같은 포트로 다시 연다. 그 사이의 부름은 ECONNREFUSED 다.
      res.shouldKeepAlive = false;
      res.on('finish', () => { 재시작.close(); setTimeout(() => 재시작.listen(포트, '127.0.0.1'), 1500); });
      sse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'Glob', arguments: JSON.stringify({ pattern: '*.txt' }) } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: 쓰임 },
      ]);
    });
  });
  await new Promise((r) => 재시작.listen(0, '127.0.0.1', r));
  const 포트 = 재시작.address().port;
  const 주소 = `http://127.0.0.1:${포트}/v1`;
  allowEndpoint(주소);
  const s = new Session({ kind: 'openai', base: 주소, auth: 'bearer', key: 'k', model: 'fake', ctx: 32768, streaming: true, tools: true, json: true, think: false }, { root, work: 'code', think: 'off' });
  const 사건 = [];
  for await (const ev of run(s, 문맥(), '이 일을 해줘')) 사건.push(ev);
  const 종류 = 사건.map((e) => e.type);
  check('★★★ 서버가 꺼졌다 돌아오면 그 턴이 이어진다', 종류[종류.length - 1] === 'done' && 부른수 === 2, 종류.join());
  check('★★ 꺼진 동안 기다린다고 알린다', 사건.some((e) => e.type === 'backoff' && e.code === 'ECONNREFUSED'), 종류.join());
  재시작.close();
  allowEndpoint(base);
}

console.log('끝까지 못 온 답');
{
  const 닫힘 = await 돌리기([{ 닫힘글: '읽어 보겠습니' }, { text: '다 했습니다' }]);
  check('★★★ 답하다 곱게 닫히면 다시 묻는다', 끝(닫힘) === 'done' && 닫힘.요청수 === 2, `${닫힘.종류.join()} · 요청 ${닫힘.요청수}`);
  check('★★★ 반쪽 답은 대화에 안 남는다', !JSON.stringify(닫힘.s.messages).includes('읽어 보겠습니'));
  const 멎음 = await 돌리기([{ 멎음글: '읽어 보겠습니' }, { text: '다 했습니다' }], { 연결: { 첫잠잠: 2000, 잠잠: 300 } });
  check('★★★ 답하다 멎으면 다시 묻는다', 끝(멎음) === 'done' && 멎음.요청수 === 2 && !JSON.stringify(멎음.s.messages).includes('읽어 보겠습니'), `${멎음.종류.join()} · 요청 ${멎음.요청수}`);
  const 계속멎음 = await 돌리기(Array(6).fill({ 멎음글: '반쪽' }), { 연결: { 첫잠잠: 2000, 잠잠: 200 } });
  check('★★ 계속 멎어도 영영 돌지 않는다', 끝(계속멎음) === 'done' && 계속멎음.요청수 === 4, `${계속멎음.종류.join()} · 요청 ${계속멎음.요청수}`);
  const 번갈아멎음 = await 돌리기([{ 멎음글: '앞' }, { 닫힘글: '뒤' }, { text: '다 했습니다' }], { 연결: { 첫잠잠: 2000, 잠잠: 300 } });
  check('★★★ 멎음 뒤의 첫 곱게 닫힘은 서버 버릇으로 안 친다', 끝(번갈아멎음) === 'done' && 번갈아멎음.요청수 === 3 && !번갈아멎음.s.conn.끝말없음, `${번갈아멎음.종류.join()} · 요청 ${번갈아멎음.요청수}`);
  const 버릇 = await 돌리기(Array(6).fill({ 닫힘글: '끝 표시 없는 서버' }));
  check('★★★ 끝 표시를 안 하는 서버는 한 번만 더 묻고 받아들인다', 끝(버릇) === 'done' && 버릇.요청수 === 2, `${버릇.종류.join()} · 요청 ${버릇.요청수}`);
  const 끝표시 = await 돌리기([{ 끝표시만: '다 했습니다' }, { text: '안 와야 함' }]);
  check('★★★ [DONE] 까지 왔으면 끝난 답이다', 끝(끝표시) === 'done' && 끝표시.요청수 === 1, `${끝표시.종류.join()} · 요청 ${끝표시.요청수}`);

  const 안닫힘 = await 돌리기([{ text: '<think>음, 이제 파일을 읽어' }, { text: '다 했습니다' }]);
  check('★★★ 안 닫힌 생각으로 끝나면 답으로 안 친다', 끝(안닫힘) === 'done' && 안닫힘.요청수 === 2 && !JSON.stringify(안닫힘.s.messages).includes('<think>'), `${안닫힘.종류.join()} · 요청 ${안닫힘.요청수}`);
  const 닫힌생각 = await 돌리기([{ text: '<think>생각</think>\n\n답입니다' }]);
  const 답 = 닫힌생각.s.messages.filter((m) => m.role === 'assistant').pop();
  check('★★★ 닫힌 생각은 대화에 안 남기고 답만 남긴다', 끝(닫힌생각) === 'done' && 답?.content === '답입니다', JSON.stringify(답?.content));
  const 글속 = await 돌리기([{ text: '태그는 <think> 라고 씁니다' }]);
  check('★★ 답 중간의 태그 글자는 안 건드린다', 글속.s.messages.filter((m) => m.role === 'assistant').pop()?.content === '태그는 <think> 라고 씁니다');
  const 계속안닫힘 = await 돌리기(Array(8).fill({ text: '<think>생각만' }));
  check('★★ 안 닫힌 생각만 계속 와도 영영 돌지 않는다', 계속안닫힘.요청수 < 8 && ['done', 'error'].includes(끝(계속안닫힘)), `${계속안닫힘.종류.join()} · 요청 ${계속안닫힘.요청수}`);

  const 작은창 = await 돌리기(Array(8).fill({ 너무김: true }), { 창: 4096 });
  const 오류 = 작은창.사건.find((e) => e.type === 'error');
  check('★★ 창이 작아 못 보내면 서버를 어떻게 띄울지 말한다', /16384/.test(String(오류?.text)), String(오류?.text).slice(0, 120));
}

console.log('말만 하고 끝내기');
{
  const 읽기a = { toolCall: { name: 'Read', args: { file_path: 'a.txt' } } };
  const 새로 = () => writeFileSync(join(root, 'a.txt'), 'hello world\n', 'utf8');
  새로();
  const 다짐 = await 돌리기([읽기a, { text: '파일을 읽었습니다. 이제 고치겠습니다.' }, 고치기('hello world', 'hello deel'), { text: '고쳤습니다' }]);
  check('★★★ 읽고 「이제 고치겠습니다」 로 끝내면 한 번 민다', 끝(다짐) === 'done' && readFileSync(join(root, 'a.txt'), 'utf8').includes('hello deel'), 다짐.종류.join());
  새로();
  const 두번 = await 돌리기([읽기a, { text: '이제 고치겠습니다.' }, { text: '이제 고치겠습니다.' }, { text: '안 와야 함' }]);
  check('★★ 다짐은 한 번만 민다', 끝(두번) === 'done' && 두번.요청수 === 3, `요청 ${두번.요청수}`);
  const 영어 = await 돌리기([{ text: "I'll fix it now." }, { text: '끝' }]);
  check('★★ 영어 다짐도 민다', 끝(영어) === 'done' && 영어.요청수 === 2, `요청 ${영어.요청수}`);
  새로();
  const 고친뒤 = await 돌리기([읽기a, 고치기('hello world', 'hello deel'), { text: '이제 마무리하겠습니다.' }, { text: '안 와야 함' }]);
  check('★★ 뭐라도 고쳤으면 안 민다', 고친뒤.요청수 === 3, `요청 ${고친뒤.요청수}`);
  새로();
  const 읽기모드 = await 돌리기([읽기a, { text: '읽어 보겠습니다.' }, { text: '안 와야 함' }], { work: 'ask' });
  check('★★ 안 고치는 모드는 안 민다', 읽기모드.요청수 === 2, `요청 ${읽기모드.요청수}`);
  for (const 끝말 of ['수정할 곳이 없습니다. 이상으로 보고를 마치겠습니다.', 'Everything is up to date. Let me know if you need anything else.', '알겠습니다.', '이 설정이면 충분하겠어요.']) {
    const 인사 = await 돌리기([읽기a, { text: 끝말 }, { text: '안 와야 함' }]);
    check(`★★ 맺음말은 다짐으로 안 친다: ${끝말.slice(0, 14)}`, 인사.요청수 === 2, `요청 ${인사.요청수}`);
  }
  const 보고 = await 돌리기([읽기a, { text: '파일 끝에 hello 가 있습니다.' }, { text: '안 와야 함' }]);
  check('★★ 보고로 끝난 답은 안 민다', 보고.요청수 === 2, `요청 ${보고.요청수}`);
}

console.log('연속 실패');
{
  const 없는파일 = (i) => ({ toolCall: { name: 'Read', args: { file_path: `없음${i}.txt` } } });
  const 계속 = await 돌리기(Array.from({ length: 80 }, (_, i) => 없는파일(i)));
  check('★★★ 대상이 매번 달라도 성공 없이 계속 실패하면 멈춘다', 끝(계속) === 'stuck' && 계속.요청수 < 40, `${끝(계속)} · 요청 ${계속.요청수}`);
  const 없는도구 = await 돌리기(Array.from({ length: 80 }, (_, i) => ({ toolCall: { name: `tool_${i}`, args: {} } })));
  check('★★★ 없는 도구 이름이 매번 달라도 멈춘다', 끝(없는도구) === 'stuck' && 없는도구.요청수 < 40, `${끝(없는도구)} · 요청 ${없는도구.요청수}`);
  const 묶음성공 = await 돌리기([...Array.from({ length: 24 }, (_, i) => 없는파일(i)), { toolCalls: [{ name: 'Read', args: { file_path: '없음끝.txt' } }, { name: 'Read', args: { file_path: 'big.txt', limit: 3 } }] }, { text: '끝' }]);
  check('★★★ 같은 묶음에서 성공이 뒤따르면 연속 실패로 안 멈춘다', 끝(묶음성공) === 'done' && !묶음성공.사건.some((e) => e.type === 'note' && /되풀이/.test(String(e.text))), `${묶음성공.종류.slice(-3).join()} · 요청 ${묶음성공.요청수}`);
  const 섞임 = await 돌리기([...Array.from({ length: 18 }, (_, i) => 없는파일(i)), { toolCall: { name: 'Read', args: { file_path: 'big.txt', limit: 5 } } }, ...Array.from({ length: 18 }, (_, i) => 없는파일(i + 18)), { text: '끝' }]);
  check('★★★ 사이에 성공이 있으면 안 끊는다', 끝(섞임) === 'done', `${끝(섞임)} · 요청 ${섞임.요청수}`);
}

console.log('고치고 다시 돌리기');
{
  const 읽기a = { toolCall: { name: 'Read', args: { file_path: 'a.txt' } } };
  const 바퀴 = (n) => Array.from({ length: n }, (_, i) => [고치기(`v${i}`, `v${i + 1}`), { toolCall: { name: 'Bash', args: { command: 'echo same' } } }]).flat();
  writeFileSync(join(root, 'a.txt'), 'v0\n', 'utf8');
  const 여덟 = await 돌리기([읽기a, ...바퀴(8), { text: '끝' }]);
  check('★★★ 같은 파일을 고치며 출력이 같은 시험을 여덟 번 돌려도 안 끊는다', 끝(여덟) === 'done', `${끝(여덟)} · 요청 ${여덟.요청수}`);
  writeFileSync(join(root, 'a.txt'), 'v0\n', 'utf8');
  const 끝없음 = await 돌리기([읽기a, ...바퀴(40)]);
  check('★★ 고치기를 끝없이 되풀이하면 결국 멈춘다', 끝(끝없음) === 'stuck', `${끝(끝없음)} · 요청 ${끝없음.요청수}`);
  writeFileSync(join(root, 'a.txt'), 'hello world\n', 'utf8');
}

console.log('비운 대화와 하위 작업');
{
  const 받은것 = [];
  const s = new Session({ kind: 'openai', base, auth: 'bearer', key: 'k', model: 'fake', ctx: 32768, streaming: true, tools: true, json: true, think: false }, { root, work: 'code', think: 'off' });
  s.push({ role: 'user', content: '비울 말' });
  await handle('/clear', s, { 갈래: { 현재store: () => ({ replace: (말들, 쪽지) => 받은것.push([말들.length, 쪽지]) }) } });
  check('★★★ /clear 는 저장된 대화도 비운다', 받은것.length === 1 && 받은것[0][0] === 0, JSON.stringify(받은것));

  const 하위 = await 돌리기([{ toolCall: { name: 'Task', args: { purpose: '훑기', task: 'a.txt 를 봐 줘' } } }, ...Array(6).fill({ 빈답: true }), { text: '끝' }]);
  const 하위결과 = 하위.s.messages.filter((m) => m.role === 'tool').map((m) => String(m.content)).join(' ');
  check('★★ 하위 작업이 오류로 죽으면 까닭을 부모에게 돌려준다', /빈 답/.test(하위결과) && !/끝난 이유를 알 수 없음/.test(하위결과), 하위결과.slice(0, 160));
}

console.log('글로 적은 부름');
{
  const 틀린이름 = '<tool_call>{"name":"read_file","arguments":{"path":"a.txt"}}</tool_call>';
  const 읽기a = { toolCall: { name: 'Read', args: { file_path: 'a.txt' } } };
  const 한번 = await 돌리기([{ text: 틀린이름 }, 읽기a, { text: '끝' }]);
  check('★★★ 없는 도구를 글로 부르면 쓸 수 있는 도구를 알려 주고 다시 묻는다', 끝(한번) === 'done' && 한번.요청수 === 3 && /Read/.test(JSON.stringify(받은[1].messages.slice(-1))), `${한번.종류.join()} · 요청 ${한번.요청수}`);
  const 두번 = await 돌리기([{ text: 틀린이름 }, { text: 틀린이름 }, { text: '안 와야 함' }]);
  check('★★ 글 부름 재촉은 한 번만 한다', 끝(두번) === 'done' && 두번.요청수 === 2, `요청 ${두번.요청수}`);
  const 보통글 = await 돌리기([{ text: '도구 이름은 Read 입니다.' }, { text: '안 와야 함' }]);
  check('★★ 도구 이름을 말하는 보통 글은 안 막는다', 보통글.요청수 === 1, `요청 ${보통글.요청수}`);
  const 같은id = await 돌리기([{ 같은id: true, toolCalls: [{ name: 'Read', args: { file_path: 'a.txt' } }, { name: 'Read', args: { file_path: 'big.txt', limit: 3 } }] }, { text: '끝' }]);
  const 보낸 = 받은[1].messages;
  const 부름id = 보낸.find((m) => m.tool_calls)?.tool_calls.map((x) => x.id) ?? [];
  check('★★ 한 응답의 id 가 겹쳐도 요청에는 안 겹친다', 끝(같은id) === 'done' && 부름id.length === 2 && new Set(부름id).size === 2 && 보낸.filter((m) => m.role === 'tool').every((m) => 부름id.includes(m.tool_call_id)), 부름id.join());
}

console.log('다시 돌리기 판정');
{
  writeFileSync(join(root, 'a.txt'), 'hello world\n', 'utf8');
  const 명령 = { toolCall: { name: 'Bash', args: { command: 'rm -f 없는것1.txt' } } };
  const 다른명령 = { toolCall: { name: 'Bash', args: { command: 'rm -f 없는것2.txt' } } };
  const 거절수 = (r) => r.사건.filter((e) => e.type === 'tool' && /다시 실행하지 않습니다/.test(String(e.result?.error ?? ''))).length;
  const 사이 = await 돌리기([명령, 다른명령, 명령, { text: '끝' }]);
  check('★★ 사이에 다른 변경성 명령이 돌면 같은 명령을 다시 돌린다', 거절수(사이) === 0, `거절 ${거절수(사이)}`);
  const 번갈아 = await 돌리기([명령, 다른명령, 명령, 다른명령, { text: '끝' }]);
  const 실패명령 = { toolCall: { name: 'Bash', args: { command: 'git rm --dry-run nope.txt' } } };
  const 실패재시도 = await 돌리기([실패명령, 실패명령, { text: '끝' }]);
  check('★★★ 실패한 변경성 명령은 다시 해 볼 수 있다', 끝(실패재시도) === 'done' && 거절수(실패재시도) === 0, `거절 ${거절수(실패재시도)}`);
  check('★★★ 이미 돌린 두 명령만 번갈아 부르면 막는다', 거절수(번갈아) === 1, `거절 ${거절수(번갈아)}`);
  const 묶음 = await 돌리기([
    { toolCall: { name: 'Read', args: { file_path: 'a.txt' } } },
    명령,
    { toolCalls: [{ name: 'Edit', args: { file_path: 'a.txt', old_string: 'hello world', new_string: 'hello deel' } }, 명령.toolCall] },
    { text: '끝' },
  ]);
  check('★★ 같은 묶음에서 파일을 고치면 같은 명령을 다시 돌린다', 거절수(묶음) === 0, `거절 ${거절수(묶음)}`);
  writeFileSync(join(root, 'a.txt'), 'hello world\n', 'utf8');
  const 긴앞 = 'y'.repeat(250);
  const 긴 = await 돌리기([{ toolCall: { name: 'Read', args: { file_path: 'a.txt' } } }, 고치기(`${긴앞}A`), 고치기(`${긴앞}B`), 고치기(`${긴앞}C`), 고치기(`${긴앞}D`), { text: '끝' }]);
  check('★★ 200자 뒤만 다른 Edit 도 다른 시도로 센다', 끝(긴) === 'done' && !JSON.stringify(긴.s.messages).includes('[deel]'), 긴.종류.join());
  check('★★★ 창을 모르면 남은 자리로 재지 않는다', 읽을자리({ breakdown: () => ({ total: 32768, used: 1000, 총잰것: false }) }) === null);
  check('★★ 재지 못한 값이면 남은 자리도 없는 셈이다', 읽을자리({ breakdown: () => ({ total: 32768, used: NaN, 총잰것: true }) }) === null);
}

console.log('요청 모양');
{
  await 돌리기([{ text: '끝' }], { 먼저: { role: 'user', content: '앞말' } });
  const 차례 = 받은[0].messages.map((m) => m.role);
  check('★★★ 사람 말이 잇따르면 한 말로 합쳐 보낸다', !차례.some((x, i) => x === 'user' && 차례[i - 1] === 'user'), 차례.join());
  check('★★★ 합쳐도 내용은 다 간다', /앞말[\s\S]*이 일을 해줘/.test(JSON.stringify(받은[0].messages)));
  await 돌리기([{ text: '끝' }], { 먼저: { role: 'user', content: [{ type: 'text', text: '그림앞말' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] } });
  const 그림차례 = 받은[0].messages.map((m) => m.role);
  check('★★★ 그림이 든 사람 말도 뒤따르는 말과 합쳐 보낸다', !그림차례.some((x, i) => x === 'user' && 그림차례[i - 1] === 'user'), 그림차례.join());
  check('★★ 합쳐도 글이 다 간다', /그림앞말[\s\S]*이 일을 해줘/.test(JSON.stringify(받은[0].messages)));
  const 합침 = (앞, 뒤) => 잇단사람말합치기([{ role: 'user', content: 앞 }, { role: 'user', content: 뒤 }]);
  const 글조각 = [{ type: 'text', text: '글' }];
  const 터지나 = (f) => { try { return f(); } catch (e) { return `터짐: ${e.message}`; } };
  check('★★★ 내용이 빈 사람 말이 끼어도 합치다 터지지 않는다', 터지나(() => 합침(글조각, null)[0].content.length) === 1 && 터지나(() => 합침(null, 글조각)[0].content.length) === 1, 터지나(() => 합침(글조각, null)[0].content.length));
  check('★★ 빈 글은 빈 조각을 안 만든다', 터지나(() => 합침(글조각, '')[0].content.length) === 1);
  check('★★ 배열이 아닌 내용 객체도 잃지 않는다', 터지나(() => 합침(글조각, { type: 'text', text: '뒤' })[0].content.length) === 2);
}

server.closeAllConnections?.();
server.close();
rmSync(root, { recursive: true, force: true });
console.log(`\n  통과 ${통과} · 실패 ${실패}`);
process.exitCode = 실패 ? 1 : 0;
