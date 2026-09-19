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
    /*
     * 인자가 **잘린 채** 끝난 도구 호출 (finish_reason: 'length').
     *
     * 게이트웨이가 출력 상한에 걸리면 JSON 한가운데서 끊긴다. 루프는 그걸
     * 버리지 않고 건져 쓰는 길을 두고 있다(살린쓰기) — 그 길이 모드 관문
     * 앞에 있으면 읽기 전용 모드에서도 파일이 만들어진다.
     */
    if (step.잘린부름) {
      const argStr = JSON.stringify(step.잘린부름.args);
      const 자른것 = argStr.slice(0, argStr.length - (step.잘린부름.남길것 ?? 6));
      return sse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c7', function: { name: step.잘린부름.name, arguments: 자른것 } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20 } },
      ]);
    }
    /*
     * 안 하겠다고 하는 응답. 이 규격은 거절을 `content` 가 아니라 `refusal`
     * 로 흘려보낸다 — 화면에서는 **빈 답과 겉모습이 같다.**
     */
    /*
     * 도구를 부르다가 앞단 필터에 걸린 응답.
     *
     * 거절에는 도구 호출이 **대개** 없다. 대개지 늘이 아니다 — 흘려받기는
     * tool_calls 조각을 먼저 보내 놓고 맨 끝의 finish_reason 에서 거절을
     * 알려 줄 수 있다. 그러면 부름만 있고 결과가 없는 채로 대화가 끝난다.
     */
    if (step.부르다거절) {
      const argStr = JSON.stringify(step.부르다거절.args);
      return sse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c9', function: { name: step.부르다거절.name, arguments: argStr } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'content_filter' }], usage: { prompt_tokens: 130, completion_tokens: 10 } },
      ]);
    }
    // 자리가 다 찼다고 거절한다 — 루프가 턴 안에서 비우고 이어 가는 자리를 잰다.
    if (step.자리없음) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: "This model's maximum context length is 8192 tokens, however you requested 41003 tokens." } }));
    }
    // 앞단 필터가 잘라서 글도 도구도 없이 끝난 응답 (사냥5 L5-2).
    if (step.필터됨) {
      return sse(res, [{ choices: [{ delta: {}, finish_reason: 'content_filter' }], usage: { prompt_tokens: 110, completion_tokens: 0 } }]);
    }
    // 글도 도구도 없이 곱게 끝난 응답 — 규격이 안 맞는 프록시가 몸통을 바꿔 놓으면 이 모양이다.
    if (step.빈답) {
      return sse(res, [{ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 0 } }]);
    }
    // 한 답에 도구를 여럿 부른다 — 읽기 전용이 이어지면 루프가 한 덩어리로 묶어 같이 돌린다.
    if (step.여럿부름) {
      return sse(res, [
        ...step.여럿부름.map((c, i) => ({
          choices: [{ delta: { tool_calls: [{ index: i, id: `m${i}`, function: { name: c.name, arguments: JSON.stringify(c.args) } }] } }],
        })),
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20 } },
      ]);
    }
    /*
     * 상한에서 잘린 답. 생각 토큰을 **서버가 세어 준다** — 낸 토큰은 크고 보이는 글은 짧다.
     * 루프가 「생각이 자리를 얼마나 먹었나」 를 무엇으로 재는지 가르는 자리다.
     */
    if (step.잘림) {
      const 조각 = String(step.잘림.글).match(/.{1,8}/gs) ?? [''];
      return sse(res, [
        ...조각.map((p) => ({ choices: [{ delta: { content: p } }] })),
        {
          choices: [{ delta: {}, finish_reason: 'length' }],
          usage: {
            prompt_tokens: 120,
            completion_tokens: step.잘림.낸것,
            completion_tokens_details: { reasoning_tokens: step.잘림.생각 },
          },
        },
      ]);
    }
    /*
     * 「남은 토큰 0 · 1초 뒤 풀림」 을 머리로 알려 주는 응답 (backend/quota.js).
     * 이 머리를 받은 다음 부름은 보내기 **전에** 스스로 비킨다(미리비키기) —
     * 서버가 막은 것이 아니므로 「다시 부른 횟수」 에 들어가면 안 된다.
     */
    if (step.바닥) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'x-ratelimit-remaining-tokens': '0',
        'x-ratelimit-reset-tokens': '1',
      });
      return res.end(JSON.stringify({
        choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'cq1', type: 'function', function: { name: 'Glob', arguments: JSON.stringify({ pattern: '**/*' }) } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }));
    }
    // 다시 부른 것이 서버에서 터진다. 400 이라 사다리(retry.js)를 안 태우고 곧바로 던진다.
    if (step.그냥터짐) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: '업스트림이 모델을 찾지 못했습니다.' } }));
    }
    // 한 번에 받는 연결을 위한 차례. 몸을 통째로 적어 준다.
    if (step.json) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(step.json));
    }
    // 분당 토큰 한도(TPM)에 걸린 429 (사냥5 B5-03). 곧바로 다시 부를 수 있게 retry-after 0.
    if (step.분당한도) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'retry-after': '0' });
      return res.end(JSON.stringify({ error: {
        message: 'Request too large for gpt-4o in organization org-abc on tokens per min (TPM): Limit 30000, Requested 45000. The input or output tokens must be reduced in order to run successfully.',
        type: 'tokens', code: 'rate_limit_exceeded',
      } }));
    }
    // 한도 낱말 없이 숫자만 적힌 429 (6회차 어긋내기). 문장만 보면 창 이야기로 읽힌다.
    if (step.맨말한도) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'retry-after': '0' });
      return res.end(JSON.stringify({ error: { message: 'Request too large: Limit 30000, Requested 45000. Please reduce the input.' } }));
    }
    if (step.refusal) {
      const 조각 = String(step.refusal).match(/.{1,8}/gs) ?? [''];
      return sse(res, [
        ...조각.map((p) => ({ choices: [{ delta: { refusal: p } }] })),
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 30 } },
      ]);
    }
    // 본문은 여러 조각으로 흘려보낸다.
    const parts = String(step.text).match(/.{1,8}/gs) ?? [''];
    return sse(res, [
      ...parts.map((p) => ({ choices: [{ delta: { content: p } }] })),
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        // 글자로 숫자를 싣는 게이트웨이를 흉내 낸다 (사냥5 B5-07).
        usage: step.글자usage ? { prompt_tokens: '120', completion_tokens: '30' } : {
          prompt_tokens: 120,
          completion_tokens: 30,
          ...(step.생각토큰 ? { completion_tokens_details: { reasoning_tokens: step.생각토큰 } } : {}),
        },
      },
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
const session = new Session(conn, { root, work: 'auto', think: 'off' });

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
// 파일 도구 8종(옮기기 포함) + 웹 읽기 + 되묻기 + 지난 대화 찾기 + 기억하기
// + 할 일 목록 + 확인하기 + 뼈대 보기 + 하위 작업 + 뒤에서 도는 명령.
// 스킬이 없는 세션이라 Skill 은 빠진다.
check('도구 정의 17종을 보냈다', first?.tools?.length === 17, `${first?.tools?.length}개`);
/*
 * Claude Code 의 이름을 그대로 쓰되 **아홉 개만** 더 있다. 늘릴 때마다 여기가 걸리게
 * 해 둔 이유: 도구 하나가 스키마로 150토큰쯤 먹는다. 매 요청마다 나가는 값이라
 * 슬그머니 늘면 컨텍스트가 조용히 줄어든다. 더할 값어치가 있는지 여기서 한 번 멈춘다.
 *
 *   Append    출력 상한이 작은 로컬 모델이 큰 파일을 나눠 쓰는 유일한 길.
 *             Edit 으로 잇는 방법은 앵커가 겹쳐 막힌다(HTML 의 </div> 가 그렇다).
 *   Move      파일·폴더를 옮긴다 (test/move.test.js). 이게 없어서 "구조를
 *             역할에 맞게 바꿔 줘" 가 계속 헛돌았다 — 남는 길이 `Bash mv`
 *             하나뿐인데, mv 는 위험 명령이라 **파일마다** 승인을 묻고
 *             되돌리기에도 안 잡힌다. /undo 를 눌러도 구조가 안 돌아온다.
 *             도구로 주면 한 번에 스무 개를 옮기고 되돌리기에 잡힌다.
 *   Ask       갈림길에서 사람에게 하나 묻는다 (test/ask.test.js). 이게 없을 때
 *             모델은 파일 스무 개를 읽고 나서 "수행할 구체적인 작업 요청이
 *             없습니다" 라고 적고 턴을 끝냈다. 글로 물으면 **그 턴이 끝나서**
 *             여태 읽은 것이 다 버려지고, 사람은 아무것도 안 된 화면을 본다.
 *             도구로 물으면 답이 도구 결과로 돌아와 하던 자리에서 이어진다.
 *             스키마가 작다(문자열 하나 + 짧은 배열).
 *   Recall    지난 대화를 모델이 **스스로** 뒤진다. 사람만 쓰는 명령으로 두면
 *             "저번에 정한 대로" 에 모델이 할 수 있는 게 되묻는 것뿐이다.
 *   Remember  대화가 끝나도 남길 것. 지금 막 정한 것을 남길지 판단할 수 있는 것은
 *             그 자리에 있는 모델뿐이다 — 사람에게 맡기면 아무도 안 적는다.
 *   Outline   폴더의 뼈대만 뽑아 본다 (tools/outline.js). src/ui 폴더 하나가
 *             Read 로는 25,612토큰인데 Outline 으로는 857토큰이다 — 30배다.
 *             이게 없으면 작은 모델은 프로젝트 모양을 볼 방법 자체가 없다.
 *   Verify    만든 것이 실제로 되는지 본다 (tools/verify.js). 파일이 있다는 것과
 *             된다는 것은 다르다 — 안 닫힌 태그, 없는 파일을 가리키는 src 는
 *             파일 목록만 봐서는 안 보인다.
 *   Task      큰 일의 한 덩이를 **따로 떨어진 창**에서 돌린다 (tools/task.js).
 *             이건 값이 비싸다 — 스키마만 395토큰으로, 이 표에서 제일 크다.
 *             그런데도 넣은 이유는, 이게 없으면 파일 여덟 개짜리 일이 8k·32k
 *             모델에서 **아예 안 끝나기** 때문이다. 파일 내용이 한 창에 다
 *             쌓여서 서너 개째에 앞엣말이 접혀 나간다. 자리를 아끼려고 안 주면
 *             아낀 자리로 할 수 있는 일이 없어진다.
 *
 *   Jobs      뒤에서 도는 명령을 보고 끝낸다 (tools/jobs.js). Bash 와 짝이라
 *             따로 떼어 놓을 수 없다 — background 로 띄워 놓고 읽을 길이 없으면
 *             띄운 것이 유령이 된다. 대신 스키마를 최대한 작게 잡았다.
 *             이게 없으면 `npm run dev` 가 120초 뒤 죽는 것으로 끝나서,
 *             **만든 것을 띄워서 확인하는 길이 아예 없다.**
 *
 * 밖에서 붙인 도구(MCP)는 여기 안 나온다. 붙인 서버가 있을 때만 뒤에 더해진다.
 */
check('도구 이름이 Claude Code 와 같다 (Append · Move · Ask · Recall · Remember · Verify · Outline · Task · Jobs 만 더 있다)',
  JSON.stringify(first?.tools?.map((t) => t.function.name))
    === JSON.stringify(['Read', 'Write', 'Append', 'Edit', 'Move', 'Glob', 'Grep', 'Bash', 'WebFetch',
      'Ask', 'Recall', 'Remember', 'TodoWrite', 'Verify', 'Outline', 'Task', 'Jobs']),
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
const s2 = new Session(conn, { root, work: 'auto', think: 'off' });
const ev2 = [];
for await (const ev of run(s2, ctx, '바깥 파일 읽어줘')) ev2.push(ev);
const outside = ev2.find((e) => e.type === 'tool');
check('모델이 시켜도 범위 밖은 거부', /작업 범위 밖/.test(outside?.result?.error ?? ''), outside?.result?.error ?? '');

// 도구 호출 상한
//
// 매번 '다른' 것을 부르게 한다. 똑같은 것을 되풀이하면 걸음 수 상한에 닿기 전에
// 반복 감지가 먼저 잡기 때문이다 — 그게 옳지만, 여기서 재려는 것은 그게 아니다.
// 잘 되고 있는 긴 작업이 상한에서 멈추는지를 본다.
turn = 0;
script = Array.from({ length: 30 }, (_, i) => ({ toolCall: { name: 'Glob', args: { pattern: `**/*${i}*` } } }));
const s3 = new Session(conn, { root, mode: 'auto', think: 'off', maxSteps: 4 });
const ev3 = [];
for await (const ev of run(s3, ctx, '계속 찾아줘')) ev3.push(ev);
check('도구 호출 상한에서 멈춘다', ev3.some((e) => e.type === 'limit'), `${ev3.filter((e) => e.type === 'tool').length}회 실행`);

// 반대쪽: 똑같은 것만 되풀이하면 상한을 기다리지 않고 먼저 끊는다.
turn = 0;
script = Array.from({ length: 30 }, () => ({ toolCall: { name: 'Glob', args: { pattern: '**/*' } } }));
const s4 = new Session(conn, { root, mode: 'auto', think: 'off', maxSteps: 24 });
const ev4 = [];
for await (const ev of run(s4, ctx, '계속 같은 것만 찾아줘')) ev4.push(ev);
check('같은 것만 되풀이하면 먼저 끊는다', ev4.some((e) => e.type === 'stuck'),
  `${ev4.filter((e) => e.type === 'tool').length}회 실행 · ${ev4.map((e) => e.type).at(-1)}`);
check('상한(24회)까지 안 간다', ev4.filter((e) => e.type === 'tool').length <= 6,
  `${ev4.filter((e) => e.type === 'tool').length}회`);

/*
 * ── 안 하겠다고 하면 되밀지 않고 멈춘다 ──────────────────────────────────
 *
 * 이 자리가 「호출 한도 초과」 를 만들던 곳이다.
 *
 * 거절한 답에는 대개 도구 호출이 없다. 그래서 루프가 「읽기만 하고 끝내려
 * 한다」 로 읽고 한 번 더 밀었다. 밀어도 판정은 같으니 또 거절이고, 그게
 * 남은 걸음 수만큼 되풀이됐다 — 한 번 거절당할 요청 하나가 열 번 나가고,
 * 그 열 번이 분당 한도를 밀어 올려 **그 다음 진짜 요청**이 429 를 받는다.
 */
{
  turn = 0;
  const 부른수앞 = seenBodies.length;
  script = [
    { refusal: '그 일은 도와드릴 수 없습니다.' },
    { text: '(여기까지 오면 안 된다)' },
    { text: '(여기도 안 된다)' },
  ];
  const s5 = new Session(conn, { root, work: 'auto', think: 'off' });
  const ev5 = [];
  for await (const ev of run(s5, ctx, '안 되는 것 해줘')) ev5.push(ev);

  const 종류 = ev5.map((e) => e.type);
  check('★ 거절을 거절이라고 말한다', 종류.includes('refusal'), 종류.join(','));
  check('★ 거절한 뒤에는 안 밀었다', !종류.includes('nudge'), 종류.join(','));
  check('★ 딱 한 번만 불렀다', seenBodies.length - 부른수앞 === 1,
    `${seenBodies.length - 부른수앞}번`);
  // 거절 글이 화면에 남아야 사람이 무슨 일인지 안다. 안 남으면 빈 답과 같다.
  const 거절것 = ev5.find((e) => e.type === 'refusal');
  check('★ 거절한 말이 화면에 남는다', /도와드릴 수 없습니다/.test(String(거절것?.text ?? '')),
    String(거절것?.text ?? '').slice(0, 30));
}

/*
 * ── 부르다 거절당해도 대화를 성한 상태로 남긴다 ─────────────────────────
 *
 * 도구를 부르겠다고 해 놓고 결과가 안 들어간 채로 끝나면, 그 다음 말을 보낼
 * 때 서버가 **대화 전체를** 400 으로 돌려보낸다 ("tool_calls must be followed
 * by tool messages"). 거절 한 번이 그 뒤의 세션을 통째로 못 쓰게 만드는 것이다.
 *
 * 중단·오류에서는 짝을 맞추고 있었는데 거절에서만 빠져 있었다. 나가는 문이
 * 셋인데 둘만 잠근 셈이라, 화면에는 아무 표시 없이 다음 턴에서 터진다.
 */
{
  turn = 0;
  script = [
    { 부르다거절: { name: 'Read', args: { file_path: 'app.js' } } },
    { text: '(여기까지 오면 안 된다)' },
  ];
  const s7 = new Session(conn, { root, work: 'auto', think: 'off' });
  const ev7 = [];
  for await (const ev of run(s7, ctx, '안 되는 것 해줘')) ev7.push(ev);

  check('★ 부르다 거절당한 것도 거절로 읽는다', ev7.some((e) => e.type === 'refusal'),
    ev7.map((e) => e.type).join(','));

  // 마지막 assistant 가 부른 만큼 도구 결과가 뒤따라야 한다.
  const 마지막부름 = [...s7.messages].reverse().find((m) => m.role === 'assistant' && m.tool_calls?.length);
  const 부른수 = 마지막부름?.tool_calls?.length ?? 0;
  const 부름뒤 = s7.messages.slice(s7.messages.indexOf(마지막부름) + 1).filter((m) => m.role === 'tool');
  check('★★ 부른 도구에 결과가 짝지어져 남는다', 부른수 > 0 && 부름뒤.length === 부른수,
    `부름 ${부른수} · 결과 ${부름뒤.length}`);
  check('★ 짝은 부름 id 로 맞춘다',
    부름뒤[0]?.tool_call_id === 마지막부름?.tool_calls?.[0]?.id,
    `${부름뒤[0]?.tool_call_id} vs ${마지막부름?.tool_calls?.[0]?.id}`);
  check('실행은 안 했다고 적는다', /실행하지 않았습니다/.test(부름뒤[0]?.content ?? ''),
    String(부름뒤[0]?.content ?? '').slice(0, 30));
}

/*
 * ── 생각에 쓴 토큰을 센다 ───────────────────────────────────────────────
 *
 * 답 토큰 중 생각 몫이 `/think` 를 높게 잡아 둔 대가다. 흘려받는 길에서
 * 이 값을 안 읽으면 늘 0 으로 보이는데, 0 은 「생각을 안 했다」 로 읽힌다 —
 * 그건 우리가 모른다는 사실과 다르다. 흘려받기가 기본값이라, 여기가 빠지면
 * 사실상 아무에게도 안 보인다.
 */
{
  turn = 0;
  script = [{ text: '다 했습니다.', 생각토큰: 900 }];
  const s6 = new Session(conn, { root, work: 'auto', think: 'off' });
  for await (const ev of run(s6, ctx, '간단한 것')) void ev;
  check('★ 흘려받아도 생각 토큰을 센다', s6.usage.reasoning === 900, String(s6.usage.reasoning));
  check('생각 몫은 답 토큰을 안 건드린다', s6.usage.out === 30, String(s6.usage.out));
}

/*
 * ── 훅이 루프에 정말 걸려 있나 (safety/hooks.js) ────────────────────────
 *
 * 훅 자체는 test/hooks.test.js 가 잰다. 여기서 재는 것은 **배선**이다 —
 * ctx.훅들 이 실제로 도구 실행 앞을 지나는가, 막으면 도구가 정말 안 도는가.
 *
 * 이 배선은 조용히 끊긴다. 훅 모듈은 멀쩡하고 검사도 전부 초록인데, 루프가
 * ctx.훅들 을 안 보면 아무것도 안 막힌다. 그리고 그건 「막았다」 는 화면이
 * 아니라 **아무 화면도 없는 것**으로 나타나서, 사람은 훅이 도는 줄 안다.
 * 사내에 「걸어 뒀습니다」 라고 말해 놓고 안 걸린 상태가 여기서 생긴다.
 */
{
  const { 훅펴기 } = await import('../src/safety/hooks.js');
  const 노드 = (글) => `node -e "${글.replace(/[\\"]/g, '\\$&')}"`;
  const 파일 = join(root, '훅검사.txt');
  writeFileSync(파일, '원래대로\n', 'utf8');

  turn = 0;
  script = [
    { toolCall: { name: 'Write', args: { file_path: '훅검사.txt', content: '고쳐졌다\n' } } },
    { text: '막혔습니다.' },
  ];
  const 훅ctx = {
    ...ctx,
    훅들: 훅펴기({
      hooks: [{ 때: '도구전', 도구: 'Write', 명령: 노드('process.stdout.write("반입 금지 파일입니다");process.exit(2)') }],
    }, '검사').훅들,
  };
  const s7 = new Session(conn, { root, work: 'auto', think: 'off' });
  const 훅이벤트 = [];
  for await (const ev of run(s7, 훅ctx, '파일 하나 써 줘')) 훅이벤트.push(ev);

  const 쓰기 = 훅이벤트.find((e) => e.type === 'tool' && e.name === 'Write');
  check('★★ 도구전 훅이 루프에서 도구를 막는다', /훅이 막았습니다/.test(쓰기?.result?.error ?? ''),
    쓰기?.result?.error ?? '(Write 이벤트가 없음)');
  // 화면 말고 **디스크**로 확인한다. 「막혔다고 적혀 있다」 와 「안 바뀌었다」 는 다른 사실이다.
  check('★★ 그리고 파일이 실제로 안 바뀐다', readFileSync(파일, 'utf8') === '원래대로\n',
    readFileSync(파일, 'utf8').trim());
  // 까닭이 모델에게 가야 한다. 안 가면 모델은 같은 것을 그대로 다시 부른다.
  const 실은것 = s7.messages.find((m) => m.role === 'tool' && /반입 금지 파일입니다/.test(String(m.content ?? '')));
  check('★ 훅이 한 말이 그대로 모델에게 간다', !!실은것,
    JSON.stringify(s7.messages.filter((m) => m.role === 'tool').map((m) => String(m.content).slice(0, 40))));

  /*
   * ── 8회차 판정 · 훅이 뱉은 열쇠가 화면으로 날것으로 나갔다 ─────────────
   *
   * 2202–2205 주석은 「훅이 뱉은 글은 명령 출력이라 열쇠가 섞여 나오기 쉽다 …
   * 그래서 여기서 한 번 가린다」 고 적어 뒀다. 가리기는 했는데, 가린 것을
   * **모델에게만** 주고 화면 이벤트(`hook_note.말`)에는 원래 줄을 그대로 보냈다.
   *
   * 화면은 대화 기록으로 남고 어깨 너머로도 보이는 자리다. 둘 중 하나만 가려야
   * 한다면 화면 쪽이다. 한 번 가린 것을 두 번 쓰면 되는 일이었다.
   */
  {
    const 열쇠 = 'sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLL';
    turn = 0;
    script = [
      { toolCall: { name: 'Write', args: { file_path: '훅열쇠.txt', content: 'x\n' } } },
      { text: '했습니다.' },
    ];
    const 열쇠ctx = {
      ...ctx,
      훅들: 훅펴기({
        hooks: [{ 때: '도구후', 도구: 'Write', 명령: 노드(`process.stdout.write("열쇠는 ${열쇠} 입니다")`) }],
      }, '검사').훅들,
    };
    const s열 = new Session(conn, { root, work: 'auto', think: 'off' });
    const 열쇠이벤트 = [];
    for await (const ev of run(s열, 열쇠ctx, '파일 하나 써 줘')) 열쇠이벤트.push(ev);

    const 화면말 = 열쇠이벤트.filter((e) => e.type === 'hook_note').map((e) => e.말).join('\n');
    check('먼저: 도구후 훅이 실제로 돌아 말을 남겼다 (이 검사의 밑천)',
      화면말.length > 0, JSON.stringify(화면말.slice(0, 80)));
    check('★★★ 훅이 뱉은 열쇠가 화면 이벤트로 날것으로 안 나간다',
      !화면말.includes(열쇠), JSON.stringify(화면말.slice(0, 140)));
    const 모델말 = s열.messages.filter((m) => m.role === 'tool').map((m) => String(m.content ?? '')).join('\n');
    check('  모델에게 가는 쪽도 그대로 가려져 있다',
      !모델말.includes(열쇠), JSON.stringify(모델말.slice(-140)));
  }


  /*
   * 말전 훅은 **사람 말이 대화에 들어가기 전에** 막아야 한다. 넣고 나서
   * 막으면 그 말이 대화에 남아 다음 요청에 실려 나간다 — 막은 것이 아니라
   * 늦춘 것뿐이고, 사내 DLP 를 여기 거는 사람이 원하는 것의 정반대다.
   */
  turn = 0;
  script = [{ text: '여기까지 오면 안 된다' }];
  const 말ctx = {
    ...ctx,
    훅들: 훅펴기({ hooks: [{ 때: '말전', 명령: 노드('process.stdout.write("주민번호가 섞여 있습니다");process.exit(2)') }] }, '검사').훅들,
  };
  const s8 = new Session(conn, { root, work: 'auto', think: 'off' });
  const 앞선요청수 = seenBodies.length;
  const 말이벤트 = [];
  for await (const ev of run(s8, 말ctx, '이건 나가면 안 되는 말')) 말이벤트.push(ev);

  check('★★ 말전 훅이 막으면 모델을 아예 안 부른다', seenBodies.length === 앞선요청수,
    `${seenBodies.length - 앞선요청수}건 나감`);
  check('★★ 막힌 말은 대화에 안 남는다',
    !s8.messages.some((m) => String(m.content ?? '').includes('이건 나가면 안 되는 말')),
    JSON.stringify(s8.messages.map((m) => m.role)));
  check('★ 왜 막혔는지는 화면에 뜬다',
    말이벤트.some((e) => e.type === 'hook_block' && /주민번호/.test(e.말 ?? '')), '');
}

/*
 * ── 이름 붙인 하위 작업이 루프에 걸려 있나 (agent/agents.js) ────────────
 *
 * 정의를 읽는 것 자체는 test/agents.test.js 가 잰다. 여기서 재는 것은 배선이다 —
 * 정의가 실제로 하위의 모드·도구·지침을 갈아 끼우는가.
 *
 * 특히 **도구를 줄이는 쪽**이 중요하다. 안 걸려 있으면 정의에 적은 도구 제한이
 * 아무 일도 안 하는데, 화면에는 「리뷰어가 본다」 고 떠 있는 채로 하위가 파일을
 * 고칠 수 있다. 그건 결과를 읽어도 안 보인다.
 */
{
  const { 한정의 } = await import('../src/agent/agents.js');
  const 리뷰어 = 한정의('리뷰어', {
    설명: '고친 데만 본다',
    모드: 'inspect',
    도구: ['Read', 'Grep'],
    지침: '되돌릴 수 없는 것부터 본다.',
    걸음: 5,
  }, '검사');

  turn = 0;
  script = [
    { toolCall: { name: 'Task', args: { agent: '리뷰어', purpose: '훑기', task: 'app.js 를 봐 줘' } } },
    { text: '하위를 시켰습니다.' },   // 하위의 첫 걸음
    { text: '다 봤습니다.' },          // 부모의 마무리
  ];
  const 에ctx = { ...ctx, 에이전트들: [리뷰어] };
  const s9 = new Session(conn, { root, work: 'auto', think: 'off' });
  const 에이벤트 = [];
  for await (const ev of run(s9, 에ctx, '리뷰 좀')) 에이벤트.push(ev);

  const 시작 = 에이벤트.find((e) => e.type === 'task_start');
  check('★★ 정의가 하위 모드를 정한다', 시작?.모드 === 'inspect', String(시작?.모드));
  check('★★ 정의가 걸음 수를 정한다', 시작?.steps === 5, String(시작?.steps));
  check('★ 어느 정의가 한 일인지 화면에 뜬다', 시작?.에이전트 === '리뷰어', String(시작?.에이전트));

  /*
   * 하위에게 나간 요청을 직접 본다. 이벤트만 보면 「모드를 바꿨다」 까지만
   * 알 수 있고, 지침이 실제로 실렸는지·도구가 정말 줄었는지는 못 잰다.
   */
  const 하위요청 = seenBodies[seenBodies.length - 2];
  const 하위도구 = (하위요청?.tools ?? []).map((t) => t.function.name);
  check('★★ 정의에 적은 도구만 쥐여 준다',
    하위도구.includes('Read') && 하위도구.includes('Grep') && !하위도구.includes('Write'),
    하위도구.join(' '));
  const 하위말 = JSON.stringify(하위요청?.messages ?? []);
  check('★★ 지침이 하위에게 간다', 하위말.includes('되돌릴 수 없는 것부터 본다'), '');
  check('★ 시킨 일도 같이 간다', 하위말.includes('app.js 를 봐 줘'), '');

  /*
   * 없는 이름은 **조용히 그냥 돌지 않는다.** 시킨 쪽은 「리뷰어가 본다」 고
   * 알고 있는데 평범한 하위가 도는 셈이 되면, 그 어긋남은 어디에도 안 뜬다.
   */
  turn = 0;
  script = [
    { toolCall: { name: 'Task', args: { agent: '없는이름', purpose: 'x', task: 'y' } } },
    { text: '없다고 합니다.' },
  ];
  const s10 = new Session(conn, { root, work: 'auto', think: 'off' });
  const 없는이벤트 = [];
  for await (const ev of run(s10, 에ctx, '없는 것 시켜봐')) 없는이벤트.push(ev);
  const 튕김 = 없는이벤트.find((e) => e.type === 'tool' && e.name === 'Task');
  check('★★ 없는 이름은 거절한다', /없는 하위 작업 이름/.test(튕김?.result?.error ?? ''),
    튕김?.result?.error ?? '(Task 이벤트가 없음)');
  check('★ 쓸 수 있는 이름을 알려 준다',
    s10.messages.some((m) => m.role === 'tool' && String(m.content).includes('리뷰어')), '');
}

/*
 * ── ★★ 자리가 다 차 비운 턴을 되감으면 비운 자리의 「이번에 시킨 말」 도 빠진다 ──
 *
 * 서버가 「자리가 없다」 고 두 번 거절하면 루프가 턴 안에서 앞선 대화를 비우고
 * 시킨 말 원문을 「빠짐없이 하세요」 와 함께 박은 한 마디만 남긴다(loop.js 의 비우기).
 * 그 한 마디가 이 턴의 자리표(사람 말)까지 비워서, 이 턴을 /undo 하면 되감기가
 * 자리표를 못 찾고 **아무것도 안 했다** — 파일은 되돌아갔는데 쪽지는 남아 다음 턴이
 * 되돌린 일을 다시 시켰다. 박은 쪽지에 턴 표가 붙어 있어야 자리표 없이도 뺄 수 있다.
 */
{
  const 비운root = mkdtempSync(join(tmpdir(), 'deel-loop-reset-'));
  const 비운ctx = { scope: makeScope(비운root), history: new History(비운root), audit: new Audit(비운root), seen: new Set() };
  turn = 0;
  script = [{ 자리없음: true }, { 자리없음: true }, { text: '비우고 이어서 했습니다.' }];
  const s11 = new Session(conn, { root: 비운root, mode: 'auto', think: 'off' });
  const 시킨말 = '결제 모듈 payments.js 를 새로 만들어줘';
  const 비운이벤트 = [];
  for await (const ev of run(s11, 비운ctx, 시킨말)) 비운이벤트.push(ev);
  check('먼저: 자리가 차서 턴 안에서 비웠고 비운 자리에 시킨 말이 박혔다',
    비운이벤트.some((e) => e.type === 'reset') && String(s11.messages[0]?.content ?? '').includes(시킨말),
    `${비운이벤트.map((e) => e.type).join(',')} · ${String(s11.messages[0]?.content ?? '').slice(0, 60)}`);
  const 되감음 = s11.되감기([비운ctx.history.turn]);
  check('★★ 그 턴을 되감으면 비운 자리의 시킨 말 쪽지도 빠진다 — 자리표가 없어도',
    !JSON.stringify(s11.messages).includes(시킨말), JSON.stringify({ 되감음, 첫말: String(s11.messages[0]?.content ?? '').slice(0, 120) }));
  check('★ 뺀 쪽지 수를 돌려준다 — 화면이 말할 수 있게', 되감음.뺀쪽지 === 1, JSON.stringify(되감음));
  check('비웠다는 말 자체는 남는다', /자리가 모자라/.test(String(s11.messages[0]?.content ?? '')), String(s11.messages[0]?.content ?? '').slice(0, 60));
  rmSync(비운root, { recursive: true, force: true });
}

/*
 * ── ★★ 앞단 필터에 걸려 **빈 채로** 온 답은 빈 답이 아니라 거절이다 (사냥5 L5-2) ──
 *
 * finish_reason 이 content_filter 인데 글도 도구 호출도 없으면, 어댑터는 거절로 적어
 * 두는데 루프의 「빈 답」 갈래가 그보다 먼저 받았다. 걸린 말을 스트리밍만 끄고 한 번
 * 더 보내고(같은 판정에 같은 요금), refusal 대신 「서버가 빈 답을 보냈습니다」 오류로
 * 끝나서 deel run 은 거절 코드가 아니라 1 로 나가고, 모델 카드에는 빈답 표가 붙었다.
 */
{
  for (const 흘려받기 of [true, false]) {
    turn = 0;
    const 앞 = seenBodies.length;
    const 걸림 = 흘려받기
      ? { 필터됨: true }
      : { json: { choices: [{ index: 0, finish_reason: 'content_filter', message: { role: 'assistant', content: '' } }], usage: { prompt_tokens: 110, completion_tokens: 0 } } };
    script = [걸림, 걸림, 걸림];
    const 필터s = new Session({ ...conn, streaming: 흘려받기 }, { root, mode: 'auto', think: 'off' });
    const 필터ev = [];
    for await (const ev of run(필터s, ctx, '이 파일을 고쳐줘 app.js')) 필터ev.push(ev);
    const 길 = 흘려받기 ? '흘려받기' : '한 번에';
    const 종류 = 필터ev.map((e) => e.type);
    check(`★★ 필터에 걸린 빈 답을 거절로 읽는다 (${길})`, 종류.includes('refusal') && !종류.includes('error'), 종류.join(','));
    check(`★★ 걸린 말을 다시 보내지 않는다 (${길})`, seenBodies.length - 앞 === 1, `${seenBodies.length - 앞}번`);
  }
}

/*
 * ── ★★ 도중에 끼어든 요구는 「빠뜨린 것」 대조에 안 들어갔다 (8회차 판정) ────
 *
 * 턴이 도는 중에 사람이 한 마디 더 얹으면(끼어들기) 루프는 그 말을 대화에도,
 * 시킨 말 원문(session.이번요청·ctx.요청)에도 덧붙인다. 그런데 빠뜨린것() 은
 * `userText` — **턴이 시작할 때 친 말**만 들고 대조했다. 그래서 도중에 얹은
 * 요구는 모델이 통째로 잊어도 아무 데도 안 걸리고 done 으로 끝났다.
 * 사람 쪽에서 보면 방금 한 말이 제일 잘 잊히는 셈이다.
 */
{
  const 시킨것 = ['1. app.js 의 포트 번호를 바꿔줘', '2. README 문서를 갱신해줘'].join(String.fromCharCode(10));
  const 얹은것 = '3. 라이선스 파일도 만들어줘';
  turn = 0;
  script = [
    { toolCall: { name: 'Write', args: { file_path: '끼어들기.txt', content: 'x\n' } } },
    { text: '포트 번호를 바꾸고 README 문서를 갱신했습니다.' },
    { text: '라이선스까지 다 만들었습니다.' },
  ];
  let 준적 = false;
  const 끼어들기 = () => { if (준적) return null; 준적 = true; return 얹은것; };
  const s끼 = new Session(conn, { root, work: 'auto', think: 'off' });
  const ev끼 = [];
  for await (const ev of run(s끼, ctx, 시킨것, { 끼어들기 })) ev끼.push(ev);

  check('먼저: 끼어든 말이 실제로 턴 안에 들어갔다 (이 검사의 밑천)',
    ev끼.some((e) => e.type === 'steer' && e.text === 얹은것), ev끼.map((e) => e.type).join(','));
  const 누락 = ev끼.find((e) => e.type === 'nudge' && e.why === '요청누락');
  check('★★ 도중에 얹은 요구도 빠뜨린 것으로 잡는다',
    !!누락 && 누락.빠진.some((x) => /라이선스/.test(x.글)),
    JSON.stringify(누락?.빠진 ?? ev끼.map((e) => e.type)));
}

/*
 * ── ★★★ 빈 답을 다시 부르다 터지면 그 빈 답이 대화에 실렸다 (8회차 판정) ────
 *
 * loop.js 의 「빈 답을 성공으로 넘기지 않는다」 머리말 바로 아래가 이 자리다.
 * 스트리밍을 끄고 한 번 더 부르는데, 그 부름이 서버에서 터지면 catch 가
 * `if (msg)` 하나만 보고 **앞서 받은 빈 답을** 대화에 밀어 넣고 `kept: true` 라고
 * 말했다. 화면에는 「여기까지는 대화에 남아 있으니 이어서 말씀하세요」 가 뜨는데
 * 실제로 남은 것은 빈 assistant 한 줄이다 — 「이어서 해줘」 를 받은 모델은
 * 제가 한 말이 없다는 것만 본다. 안내가 거짓이면 안 하느니만 못하다.
 */
{
  turn = 0;
  script = [{ 빈답: true }, { 그냥터짐: true }];
  const s빈 = new Session(conn, { root, work: 'auto', think: 'off' });
  const ev빈 = [];
  for await (const ev of run(s빈, ctx, '빈 답이 오는 일')) ev빈.push(ev);
  const 빈오류 = ev빈.find((e) => e.type === 'error');
  check('먼저: 빈 답을 받고 다시 부른 것이 터졌다 (이 검사의 밑천)',
    ev빈.some((e) => e.type === 'retry') && !!빈오류, ev빈.map((e) => e.type).join(','));
  const 빈자리 = s빈.messages.filter((m) => m.role === 'assistant'
    && !String(m.content ?? '').trim() && !(m.tool_calls?.length));
  check('★★★ 빈 답은 대화에 안 실린다', 빈자리.length === 0,
    JSON.stringify(s빈.messages.map((m) => [m.role, String(m.content ?? '').slice(0, 20)])));
  check('★★ 남긴 것이 없으면 kept 도 거짓이다', 빈오류?.kept === false, JSON.stringify({ kept: 빈오류?.kept }));
}

/*
 * ── ★★ usage 숫자가 글자로 와도 숫자로 더한다 (사냥5 B5-07) ─────────────────
 *
 * `prompt_tokens: "120"` 을 주는 게이트웨이에서 `session.usage.in += "120"` 이 글자
 * 잇기가 되어 deel run --json 의 usage.in 이 "0120" 으로 나갔다. 그 JSON 을 받아
 * 더하는 스크립트는 조용히 틀린 합을 낸다.
 */
{
  turn = 0;
  script = [{ text: '다 했습니다.', 글자usage: true }];
  const 글자s = new Session(conn, { root, work: 'auto', think: 'off' });
  for await (const ev of run(글자s, ctx, '간단한 것')) void ev;
  check('★★ 흘려받은 usage 가 글자여도 숫자로 더한다', 글자s.usage.in === 120 && 글자s.usage.out === 30,
    JSON.stringify({ in: 글자s.usage.in, out: 글자s.usage.out }));

  turn = 0;
  script = [{ json: { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '다 했습니다.' } }], usage: { prompt_tokens: '120', completion_tokens: '12' } } }];
  const 글자s2 = new Session({ ...conn, streaming: false }, { root, mode: 'auto', think: 'off' });
  for await (const ev of run(글자s2, ctx, '간단한 것')) void ev;
  check('★★ 한 번에 받은 usage 가 글자여도 숫자로 더한다', 글자s2.usage.in === 120 && 글자s2.usage.out === 12,
    JSON.stringify({ in: 글자s2.usage.in, out: 글자s2.usage.out }));

  const { extractMessage } = await import('../src/backend/adapter.js');
  const 못읽음 = extractMessage('openai', { choices: [{ message: { content: '답' } }], usage: { prompt_tokens: 'abc', completion_tokens: null } });
  check('★ 못 읽는 usage 숫자는 0 으로 두고 안 잰 것으로 적는다',
    못읽음.usage.in === 0 && 못읽음.usage.out === 0 && 못읽음.usage.잰것 === false, JSON.stringify(못읽음.usage));
  const 클로드 = extractMessage('anthropic', { content: [{ type: 'text', text: '답' }], usage: { input_tokens: '11', output_tokens: '22' } });
  check('★ anthropic usage 도 글자면 숫자로 읽는다', 클로드.usage.in === 11 && 클로드.usage.out === 22, JSON.stringify(클로드.usage));
  const 올라마 = extractMessage('ollama', { message: { content: '답' }, prompt_eval_count: '7', eval_count: '8' });
  check('★ ollama usage 도 글자면 숫자로 읽는다', 올라마.usage.in === 7 && 올라마.usage.out === 8, JSON.stringify(올라마.usage));
}

/*
 * ── ★★ 분당 한도(429)는 창 크기를 가르쳐 주지 않는다 (사냥5 B5-03) ─────────
 *
 * 「Request too large … tokens per min (TPM): Limit 30000, Requested 45000」 은 **분당
 * 한도**의 말인데, 숫자 둘에 「too large」 가 붙어 learn.js 의 마지막 수(작은 쪽이 한계)에
 * 걸렸다. 루프가 창을 30,000 으로 배워 프로필에 적고, 또 막히자 대화를 통째로 비웠다 —
 * 요청은 4번이 아니라 12번 나갔고, 비울 까닭이 없는 대화가 사라졌다.
 *
 * 맨 끝에 둔다. 한도에 걸린 자리는 다음 부름을 몇 초 미리 띄우므로(quota.js), 뒤에 같은
 * 연결을 쓰는 검사가 있으면 그만큼 느려진다. 모델 이름도 따로 줘서 자리를 가른다.
 */
{
  turn = 0;
  script = Array.from({ length: 16 }, () => ({ 분당한도: true }));
  const 앞 = seenBodies.length;
  const 저장된 = [];
  const 한도ctx = { ...ctx, 연결저장: (값) => 저장된.push(값) };
  // 창을 32k 로 못 박는다. 앞 검사(자리없음)가 같은 conn 에 8192 를 배워 뒀고, 8192 이하에서는
  // 「길어서인 듯하니 절반으로」 짐작 갈래가 아예 안 걸려 그 갈래를 못 잰다.
  const s12 = new Session({ ...conn, ctx: 32768, model: 'fake-llm-tpm' }, { root, mode: 'auto', think: 'off' });
  const 한도ev = [];
  for await (const ev of run(s12, 한도ctx, '분당 한도에 걸리는 일')) 한도ev.push(ev);
  const 종류 = 한도ev.map((e) => e.type);
  check('★★ 분당 한도(429)를 창 크기로 배우지 않는다',
    !종류.includes('learned') && s12.conn.ctx === 32768 && 저장된.length === 0,
    `${종류.join(',')} · ctx ${s12.conn.ctx} · 저장 ${JSON.stringify(저장된)}`);
  check('★★ 분당 한도(429)로 대화를 비우지 않는다', !종류.includes('reset'), 종류.join(','));
  check('★ 다시 부르기 한 묶음(4번)으로 끝낸다', seenBodies.length - 앞 === 4, `${seenBodies.length - 앞}번`);
  check('사람에게는 오류로 말한다', 종류.at(-1) === 'error', String(종류.at(-1)));
}

/*
 * ── ★★ 한도 낱말이 없어도 429 는 창 이야기가 아니다 (6회차 어긋내기) ────────
 *
 * 위 검사의 문장에는 「tokens per min」 이 있어 learn.js 의 속도한도인가 가 먼저 거른다. 그래서
 * loop.js 의 `status === 429` 막이를 꺼도 그 검사는 초록이었다. 숫자만 적은 429 는 learn.js 로는
 * 창 30,000 으로 읽힌다 — 이 자리를 막는 것은 부르는 쪽의 상태 코드뿐이다.
 */
{
  turn = 0;
  script = Array.from({ length: 16 }, () => ({ 맨말한도: true }));
  const 앞 = seenBodies.length;
  const 저장된 = [];
  const 한도ctx = { ...ctx, 연결저장: (값) => 저장된.push(값) };
  const s13 = new Session({ ...conn, ctx: 32768, model: 'fake-llm-tpm-bare' }, { root, mode: 'auto', think: 'off' });
  const 한도ev = [];
  for await (const ev of run(s13, 한도ctx, '숫자만 적힌 한도에 걸리는 일')) 한도ev.push(ev);
  const 종류 = 한도ev.map((e) => e.type);
  check('★★ 숫자만 적힌 429 도 창 크기로 배우지 않는다 · 짐작으로 줄이지도 않는다',
    !종류.includes('learned') && s13.conn.ctx === 32768 && 저장된.length === 0,
    `${종류.join(',')} · ctx ${s13.conn.ctx} · 저장 ${JSON.stringify(저장된)}`);
  check('★★ 숫자만 적힌 429 로 대화를 비우지 않는다', !종류.includes('reset'), 종류.join(','));
  check('  숫자만 적힌 429 도 다시 부르기 한 묶음(4번)으로 끝낸다', seenBodies.length - 앞 === 4, `${seenBodies.length - 앞}번`);
}

/*
 * ── ★★ 결과가 달라졌는데 되풀이 셈을 안 지웠다 (8회차 판정) ─────────────────
 *
 * 같은 부름을 같은 결과로 되풀이하면 세고, 세 번째에 끊는다. 그런데 **결과가 달라진**
 * 갈래(아래 else)는 부른것 표만 갈아 끼우고 `반복|서명` 셈은 그대로 뒀다. 그래서 한 번
 * 되풀이한 적이 있는 부름은, 그 사이에 결과가 바뀌어 일이 나아갔는데도 **되풀이 한
 * 번만에** 「같은 자리에서 헛돌고 있어 멈췄습니다」 가 됐다. 파일을 지켜보며 같은
 * 자리를 다시 읽는 일(빌드 로그·검사 결과)이 딱 이 모양이다.
 *
 * 재는 법: 같은 Read 를 되풀이하되, 도중에 **루프 밖에서** 파일을 바꿔 결과만 달라지게
 * 한다(손댄파일 은 안 늘어나므로 「그새 일했다」 갈래로 새지 않는다). 처음부터 다시
 * 센다면 결과가 바뀐 뒤로도 되풀이 두 번을 기다려야 한다.
 */
{
  const 변하는것 = join(root, '변하는것.txt');
  writeFileSync(변하는것, '처음\n', 'utf8');
  turn = 0;
  script = Array.from({ length: 8 }, () => ({ toolCall: { name: 'Read', args: { file_path: '변하는것.txt' } } }));
  let 걸음 = 0;
  const 끼어들기 = () => {
    걸음 += 1;
    // 세 번째 부름 **전에** 파일을 바꾼다 — 그 부름부터 결과가 달라진다.
    if (걸음 === 2) writeFileSync(변하는것, '바뀜\n', 'utf8');
    return null;
  };
  const s되 = new Session(conn, { root, work: 'auto', think: 'off', maxSteps: 24 });
  const ev되 = [];
  for await (const ev of run(s되, ctx, '같은 파일을 지켜봐줘', { 끼어들기 })) ev되.push(ev);
  const 읽은수 = ev되.filter((e) => e.type === 'tool').length;
  check('먼저: 헛돌기로 끊기는 자리까지 갔다 (이 검사의 밑천)',
    ev되.some((e) => e.type === 'stuck'), ev되.map((e) => e.type).join(','));
  check('★★ 결과가 달라지면 되풀이 셈을 처음부터 다시 센다', 읽은수 === 5, `${읽은수}번 읽고 끊겼다`);
}

/*
 * ── ★ 여럿을 같이 돌릴 때 '시작' 을 알리는가 (8회차 판정 · 주석이 코드와 다른 말) ──
 *
 * loop.js 의 주석은 「여럿을 같이 돌릴 때는 '시작' 을 따로 알리지 않는다」 였는데
 * 코드는 `tools_start` 를 먼저 뿌린다. 어느 쪽이 맞는지는 **화면이 정한다** —
 * repl.js 와 acp/serve.js 가 둘 다 그 이벤트를 받아 「N개를 함께 돌립니다」 를 그리고
 * 자리 수(함께갱신)를 채운다. 그러니 코드가 맞고 주석이 옛말이다. 주석을 고치고,
 * 화면이 기대는 칸(count·names)을 여기서 못 박는다.
 */
{
  turn = 0;
  script = [
    { 여럿부름: [{ name: 'Read', args: { file_path: 'app.js' } }, { name: 'Glob', args: { pattern: '**/*.js' } }] },
    { text: '다 봤습니다.' },
  ];
  const s여 = new Session(conn, { root, work: 'auto', think: 'off' });
  const ev여 = [];
  for await (const ev of run(s여, ctx, '둘을 한꺼번에 봐줘')) ev여.push(ev);
  const 함께 = ev여.find((e) => e.type === 'tools_start');
  check('★ 여럿을 같이 돌릴 때 시작을 한 줄로 알린다', !!함께, ev여.map((e) => e.type).join(','));
  check('  화면이 쓰는 칸을 채운다 (count · names)',
    함께?.count === 2 && JSON.stringify(함께?.names) === JSON.stringify(['Read', 'Glob']),
    JSON.stringify(함께 ?? null));
  // 하나만 부를 때는 여전히 이름과 인자를 붙여 알린다 — 이쪽이 tool_start 다.
  check('  하나짜리는 tools_start 가 아니다', !ev여.some((e) => e.type === 'tool_start'),
    ev여.map((e) => e.type).join(','));
}

/*
 * ── ★★ 서버가 세어 준 생각 토큰을 어림값이 덮었다 (8회차 판정) ──────────────
 *
 * loop.js 의 머리말은 재는 차례를 이렇게 적어 뒀다 —
 *   1. 서버가 세어 준 추론 토큰  2. 흘러온 생각 글  3. **위 둘이 다 없을 때** 낸 토큰 − 보이는 글.
 * 그런데 코드는 `Math.max` 라 셋 중 제일 큰 것이 이겼다. 3번은 estimateTokens 어림이라
 * 한국어처럼 글자당 토큰이 달라지는 자리에서는 쉽게 부풀고, 그 부푼 값이 서버가 세어 준
 * 900 을 덮어서 「생각이 자리를 먹었다」 가 됐다 — 상한도 못 올리는 자리에서 같은 상한으로
 * 한 번 더 부른다. 앞머리 전액이 다시 나가고 같은 자리에서 또 잘린다.
 */
{
  turn = 0;
  script = [
    { 잘림: { 글: '짧은 답', 낸것: 4000, 생각: 900 } },
    { text: '다 했습니다.' },
  ];
  // 상한을 못 올리게 못 박는다(maxTokens). 그래야 다시 부를지가 **생각 눈금 하나**에 달린다.
  const s생 = new Session({ ...conn, ctx: 32768, maxTokens: 2048, model: 'fake-llm-생각' },
    { root, work: 'auto', think: 'medium' });
  const ev생 = [];
  for await (const ev of run(s생, ctx, 'app.js 를 고쳐줘')) ev생.push(ev);
  const 단계 = ev생.find((e) => e.type === 'stage');
  check('먼저: 상한은 못 올리고 생각 눈금만 남았다 (이 검사의 밑천)',
    단계?.level !== 'off' && 단계?.cap === 2048,
    JSON.stringify({ level: 단계?.level, cap: 단계?.cap, 종류: ev생.map((e) => e.type).join(',') }));
  check('★★ 서버가 900 이라고 세어 줬으면 어림값이 그것을 못 덮는다',
    !ev생.some((e) => e.type === 'retry'), ev생.map((e) => e.type).join(','));
  // 다시 안 부르는 대신 **잘렸다고 말한다.** 입을 다물면 사람은 모델이 게으른 줄 안다.
  check('  다시 안 부른 대신 잘렸다고 말한다', ev생.some((e) => e.type === 'capped'),
    ev생.map((e) => e.type).join(','));
}

/*
 * ── ★★ 생각 눈금을 몰래 깎고 사유는 상한 얘기만 했다 (8회차 판정) ───────────
 *
 * 잘린 답을 다시 부를 때 상한을 올릴 수 있으면 **상한도 올리고 생각 눈금도 한 칸
 * 깎아서** 보낸다. 그런데 화면에 나가는 사유는 「대답이 상한에서 잘렸습니다」 하나뿐이라,
 * 사람은 `/think medium` 으로 정해 둔 것이 그 턴에 low 로 내려간 줄을 모른다. 답이
 * 얕아진 까닭을 모르는 채로 모델을 의심하게 된다. 깎았으면 깎았다고 적는다.
 */
{
  turn = 0;
  script = [{ 잘림: { 글: '짧은 답', 낸것: 4000, 생각: 900 } }, { text: '다 했습니다.' }];
  const s깎 = new Session({ ...conn, ctx: 32768, model: 'fake-llm-깎' }, { root, work: 'auto', think: 'medium' });
  const ev깎 = [];
  for await (const ev of run(s깎, ctx, 'app.js 를 고쳐줘')) ev깎.push(ev);
  const 단계깎 = ev깎.find((e) => e.type === 'stage');
  const 다시 = ev깎.find((e) => e.type === 'retry');
  check('먼저: 상한을 올리면서 생각 눈금도 같이 깎았다 (이 검사의 밑천)',
    !!다시 && 다시.to > 다시.from && 다시.think !== 단계깎?.level,
    JSON.stringify({ level: 단계깎?.level, 다시 }));
  check('★★ 생각을 깎았으면 사유에도 적는다',
    /생각/.test(String(다시?.why ?? '')), String(다시?.why ?? ''));
}

/*
 * ── ★★ 미리 비킨 것은 「서버가 막았다」 가 아니다 · 한 번에 받는 길 (8회차 판정) ──
 *
 * 흘려받는 길은 `if (ev.type === 'backoff' && !ev.미리) 미룬셈 = 1` 로 **맞기 전에
 * 스스로 비킨 것**을 셈에서 뺀다. 한 번에 받는 길에는 그 물음이 없어서 알림이 오기만
 * 하면 셌다 — 서버는 한 번도 안 막았는데 `/cost` 와 `deel run --json` 의 retries 가
 * 「서버가 1번 막았다」 고 말한다. 반쪽만 고쳐진 자리였다.
 *
 * 맨 끝 가까이 둔다 — 이 검사는 스스로 1초를 비킨다. 모델 이름을 따로 줘서 할당량
 * 자리(backend/quota.js 의 할당량자리)를 가른다.
 */
{
  turn = 0;
  script = [{ 바닥: true }, { json: { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '다 했습니다.' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } }];
  const s미 = new Session({ ...conn, streaming: false, model: 'fake-llm-바닥' }, { root, mode: 'auto', think: 'off' });
  const ev미 = [];
  for await (const ev of run(s미, ctx, '할당량이 바닥난 뒤에 이어 하는 일')) ev미.push(ev);
  const 비킴 = ev미.find((e) => e.type === 'backoff');
  check('먼저: 맞기 전에 스스로 비켰다 (이 검사의 밑천)', 비킴?.미리 === true,
    JSON.stringify(비킴 ?? ev미.map((e) => e.type)));
  check('★★ 미리 비킨 것은 다시 부른 횟수로 안 센다 (한 번에 받는 길)',
    (s미.usage.retries ?? 0) === 0, `retries ${s미.usage.retries}`);
}

/*
 * ── 8회차 판정 · 잘린 Write 만 모드 관문을 앞질렀다 ────────────────────
 *
 * 묻기(ask)·계획(plan) 모드는 「아무것도 바꾸지 않는다」 고 화면에 적어 둔다.
 * 멀쩡한 Write 는 그 관문에서 막힌다. 그런데 **인자가 잘린** Write 는 관문보다
 * 앞에 있는 건져 쓰기 길로 새서 `TOOLS.Write.run` 이 그대로 돌았다 —
 * 자물쇠가 걸린 화면에서 파일이 진짜로 만들어졌다.
 *
 * 이 검사는 두 가지를 같이 못 박는다.
 *   1) ask 모드에서는 잘린 Write 도 파일을 안 만든다.
 *   2) auto 모드에서는 건져 쓰기가 **여전히 돈다** — 관문을 핑계로 이 길을
 *      통째로 막아 버리면 71초와 파일 0개가 돌아온다.
 */
{
  const 본문 = ['첫 줄', '둘째 줄', ''].join(String.fromCharCode(10));
  const 잘린인자 = { file_path: '살릴것.txt', content: 본문 };

  // 1) 읽기 전용 모드 — 파일이 생기면 안 된다.
  turn = 0;
  // 상한을 올려 다시 부르는 길을 먼저 태운다 — 두 번째도 잘려 오면 그제야 건져 쓰기로 내려간다.
  script = [{ 잘린부름: { name: 'Write', args: 잘린인자 } }, { 잘린부름: { name: 'Write', args: 잘린인자 } }, { text: '여기까지 보았습니다.' }];
  const s동 = new Session(conn, { root, work: 'ask', think: 'off' });
  const ev동 = [];
  for await (const ev of run(s동, ctx, '이 파일을 만들어 줘')) ev동.push(ev);
  const 생겼나 = existsSync(join(root, '살릴것.txt'));
  check('★★★ 읽기 전용 모드에서는 잘린 Write 도 파일을 안 만든다',
    생겼나 === false, `생겼나=${생겼나}`);
  const 막은말 = JSON.stringify(ev동.map((e) => ({ t: e.type, n: e.name, e: e.result?.error ?? e.말 ?? e.text })));
  check('  막혔다고 말한다', /못 씁니다|모드/.test(막은말), 막은말.slice(0, 300));

  // 2) auto 모드 — 건져 쓰기는 그대로 살아 있어야 한다.
  turn = 0;
  script = [{ 잘린부름: { name: 'Write', args: 잘린인자 } }, { 잘린부름: { name: 'Write', args: 잘린인자 } }, { text: '썼습니다.' }];
  const s자 = new Session(conn, { root, work: 'auto', think: 'off' });
  for await (const ev of run(s자, ctx, '이 파일을 만들어 줘')) ev동.push(ev);
  const 만들어짐 = existsSync(join(root, '살릴것.txt'));
  check('★★ auto 모드에서는 건져 쓰기가 그대로 돈다',
    만들어짐 === true, `생겼나=${만들어짐}`);
}

// ── 결과 ───────────────────────────────────────────────────────────
const W =(s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, ch) => a + (ch.codePointAt(0) > 0x1100 ? 2 : 1), 0)));

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
