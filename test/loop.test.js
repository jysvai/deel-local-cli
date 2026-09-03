// 에이전트 루프를 모델 없이 검증한다.
// OpenAI 호환 규격을 흉내내는 가짜 게이트웨이를 띄워, 정해진 도구 호출을 돌려준다.
// 사내 게이트웨이와 같은 규격이므로 어댑터·스트리밍 파서·루프가 전부 함께 검증된다.
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
        usage: {
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
const s2 = new Session(conn, { root, mode: 'auto', think: 'off' });
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
  const s5 = new Session(conn, { root, mode: 'auto', think: 'off' });
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
  const s7 = new Session(conn, { root, mode: 'auto', think: 'off' });
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
  const s6 = new Session(conn, { root, mode: 'auto', think: 'off' });
  for await (const ev of run(s6, ctx, '간단한 것')) void ev;
  check('★ 흘려받아도 생각 토큰을 센다', s6.usage.reasoning === 900, String(s6.usage.reasoning));
  check('생각 몫은 답 토큰을 안 건드린다', s6.usage.out === 30, String(s6.usage.out));
}

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
