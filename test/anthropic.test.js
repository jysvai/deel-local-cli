// Anthropic 규격 — 다섯 제공자 중 유일하게 몸통 모양이 다른 자리.
//
// ── 무엇이 문제였나 ─────────────────────────────────────────────────────
//
// 나머지 넷은 OpenAI 호환 창구가 있어서 문 이름만 맞으면 통했다. 이쪽은
// 통하지 않는 자리가 여럿이고, **틀리면 전부 400 한 줄로 보인다.** 열쇠가
// 틀린 것도 400, 시킴말을 잘못 넣은 것도 400, 도구 모양이 다른 것도 400 이다.
// 사람은 그 화면만 보고 열쇠를 다시 발급받으러 간다.
//
// ── 무엇을 지키나 ───────────────────────────────────────────────────────
//
//   1. 판 머리(anthropic-version). 이거 하나면 열쇠가 멀쩡해도 400 이다.
//   2. 시킴말은 messages 밖으로. 안에 넣으면 「모르는 역할」이다.
//   3. 차례가 번갈아 온다. 도구를 한 턴에 둘 부르면 결과가 둘인데,
//      그대로 보내면 거절당한다 — 하나 부를 때만 되는 고장이 된다.
//   4. 답은 블록 배열이다. 글 한 덩어리로 읽으면 늘 빈 답이 된다.
//   5. 토큰 이름이 다르다. prompt_tokens 를 찾으면 늘 0 이다.
//   6. 흘려받기는 사건 이름으로 나뉜다 — 여기는 진짜로 돌려본다.
//
// 전부 이 컴퓨터 안(127.0.0.1)에서 돈다. 바깥으로 나가는 연결은 없다.
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ANTHROPIC_VERSION, endpoint, 더할머리, buildBody, extractMessage, 생각예산,
  assistantMessage, toolMessage, 차례합치기, chatStream, 요청주소, 규격이름,
} from '../src/backend/adapter.js';
import { headerLines } from '../src/ui/status.js';
import { 언어정하기 } from '../src/i18n/index.js';
import { Session } from '../src/agent/session.js';
import { detect, 앤트로픽같나 } from '../src/backend/detect.js';
import { 그림메시지, 그림장수, 눈검사메시지 } from '../src/backend/vision.js';
import { 제공자고르기 } from '../src/providers/index.js';
import { allowEndpoint } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 벗기기 = (x) => String(x).replace(/\x1b\[[0-9;]*m/g, '');

trace('1-문과-머리');

// ── 문 이름과 판 머리 ───────────────────────────────────────────────────
{
  check('문 이름이 /messages', endpoint('anthropic') === '/messages', endpoint('anthropic'));
  check('나머지는 그대로', endpoint('openai') === '/chat/completions' && endpoint('ollama') === '/api/chat');
  check('요청 주소가 이어 붙는다',
    요청주소({ base: 'https://api.example.corp/v1', kind: 'anthropic' }) === 'https://api.example.corp/v1/messages');

  /*
   * 이 머리 하나가 없으면 400 이다. 열쇠가 멀쩡해도 그렇다.
   * 그러면 화면에는 「인증 실패」 처럼 보이고, 사람은 열쇠를 다시 받으러 간다.
   */
  check('★ 판 머리를 얹는다', 더할머리('anthropic')['anthropic-version'] === ANTHROPIC_VERSION,
    JSON.stringify(더할머리('anthropic')));
  check('판 이름이 그 회사가 쓰는 값', ANTHROPIC_VERSION === '2023-06-01', ANTHROPIC_VERSION);
  check('딴 규격에는 안 얹는다',
    Object.keys(더할머리('openai')).length === 0 && Object.keys(더할머리('ollama')).length === 0);
}

trace('2-몸통');

// ── 보내는 몸통 ─────────────────────────────────────────────────────────
{
  const 도구 = [{
    type: 'function',
    function: { name: 'Read', description: '파일을 읽는다', parameters: { type: 'object', properties: { p: { type: 'string' } } } },
  }];
  const b = buildBody('anthropic', {
    model: 'claude-x',
    messages: [
      { role: 'system', content: '너는 도구다' },
      { role: 'user', content: '안녕' },
    ],
    tools: 도구,
    maxTokens: 4096,
    json: { type: 'object' },
    think: 'high',
  });

  check('모델과 상한이 실린다', b.model === 'claude-x' && b.max_tokens === 4096, JSON.stringify(b.max_tokens));
  /*
   * 시킴말은 messages 밖으로 나가야 한다. 안에 두면 「모르는 역할」 이라고
   * 통째로 거절당한다 — 시킴말이 없는 채로 도는 것이 아니라 아예 안 돈다.
   */
  check('★ 시킴말이 messages 밖으로 나간다', b.system === '너는 도구다', String(b.system));
  check('★ messages 에는 안 남는다', b.messages.every((m) => m.role !== 'system'),
    JSON.stringify(b.messages));
  check('사람 말은 그대로', b.messages[0]?.role === 'user');

  // 도구 모양이 다르다. OpenAI 모양을 그대로 보내면 400 이다.
  check('★ 도구 모양을 바꾼다', b.tools?.[0]?.name === 'Read' && !b.tools[0].function,
    JSON.stringify(b.tools?.[0]));
  check('★ parameters 가 input_schema 로', b.tools[0].input_schema?.properties?.p?.type === 'string',
    JSON.stringify(b.tools[0].input_schema));
  check('설명도 옮긴다', b.tools[0].description === '파일을 읽는다');
  check('고르는 방식이 객체', b.tool_choice?.type === 'auto', JSON.stringify(b.tool_choice));

  /*
   * 확인 못 한 칸은 안 보낸다.
   *
   * 짐작으로 넣은 칸 하나가 400 을 만들면, 화면에서는 열쇠가 틀린 것과
   * 구별이 안 된다. 이 규격에는 답 모양을 강제하는 칸이 아예 없고(도구로만
   * 한다), 생각 칸의 값 모양은 문서에서 확인하지 못했다.
   */
  check('★ 답 모양 강제는 안 보낸다', b.response_format === undefined && b.format === undefined);

  /*
   * ★ 추론 강도는 **이 규격의 말로** 보낸다.
   *
   * 여기는 「안 보낸다」 였다. 그래서 Claude 를 직접 붙이면 /effort 가 아무
   * 일도 안 했다 — 상태줄에는 강도가 뜨는데 요청에는 아무것도 안 실렸다.
   * 안 되는 것보다 나쁜 것이, 사람이 조절했다고 믿는다는 점이다.
   *
   * `reasoning_effort` 는 여전히 안 보낸다. 그건 OpenAI 호환 쪽 이름이고,
   * 여기에 실으면 모르는 칸이라 400 이 온다.
   */
  check('★ 추론 강도를 thinking 으로 보낸다',
    b.thinking?.type === 'enabled' && b.thinking.budget_tokens > 0, JSON.stringify(b.thinking));
  check('★ 남의 규격 이름은 안 섞는다', b.reasoning_effort === undefined);
  /*
   * 생각도 max_tokens 에서 나간다. 예산이 상한을 넘으면 서버가 거절한다 —
   * 그러면 강도를 올렸다는 이유로 그 턴이 통째로 죽는다.
   */
  check('★ 생각 예산이 출력 상한보다 작다', b.thinking.budget_tokens < b.max_tokens,
    `${b.thinking.budget_tokens} / ${b.max_tokens}`);
  check('OpenAI 쪽 이름은 안 섞인다', b.max_completion_tokens === undefined);

  /*
   * ── 예산 셈을 자리째로 잰다 ──────────────────────────────────────────
   *
   * 위 검사는 넉넉한 상한에서만 본다. 진짜 위험한 자리는 **좁을 때**다.
   * 이 규격은 1,024 미만을 거절하고, max_tokens 이상도 거절한다. 둘 중
   * 하나라도 어기면 강도를 올렸다는 이유로 그 턴이 통째로 죽는다 —
   * 그때 화면에 뜨는 것은 400 한 줄이라, 왜인지 알아낼 길이 없다.
   */
  check('★ 상한이 좁으면 생각을 아예 안 켠다', 생각예산('high', 1500) === 0, String(생각예산('high', 1500)));
  check('★ 켠다면 반드시 1,024 이상', 생각예산('high', 3000) >= 1024, String(생각예산('high', 3000)));
  check('★ 켠다면 반드시 상한보다 작다', 생각예산('max', 8000) < 8000, String(생각예산('max', 8000)));
  check('강도가 높을수록 더 준다', 생각예산('low', 99999) < 생각예산('high', 99999));
  check('모르는 강도면 0', 생각예산('off', 99999) === 0 && 생각예산(undefined, 99999) === 0);
  // 좁은 자리에서 켜지는 딱 그 지점. 여기서 한 칸이라도 어긋나면 400 이 온다.
  check('★ 되는 자리와 안 되는 자리가 딱 갈린다',
    생각예산('low', 2047) === 0 && 생각예산('low', 2048) === 1024,
    `${생각예산('low', 2047)} / ${생각예산('low', 2048)}`);

  /*
   * 몸통을 만들 때 **실제로** 차례를 합치는가.
   *
   * 아래 3절이 합치는 함수를 따로 재지만, 그것만으로는 「함수는 멀쩡한데
   * 아무도 안 부른다」 를 못 잡는다. 도구를 둘 부른 턴은 여기를 지나야
   * 하나로 합쳐지고, 안 합쳐지면 서버가 그 요청을 통째로 거절한다.
   */
  const b3 = buildBody('anthropic', {
    model: 'm',
    maxTokens: 100,
    messages: [
      { role: 'user', content: '해줘' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'R', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: '1' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: '2' }] },
    ],
  });
  check('★ 몸통을 만들 때 차례를 합친다', b3.messages.length === 3, String(b3.messages.length));
  check('★ 몸통의 차례가 번갈아 온다',
    b3.messages.every((m, i) => (i === 0 ? true : m.role !== b3.messages[i - 1].role)),
    b3.messages.map((m) => m.role).join(' '));
  check('합치면서 도구 결과를 안 버린다', b3.messages[2].content.length === 2,
    JSON.stringify(b3.messages[2].content));

  // 도구가 없으면 도구 칸 자체가 없다. 빈 배열도 안 보낸다.
  const b2 = buildBody('anthropic', { model: 'm', messages: [{ role: 'user', content: 'ㅎ' }], maxTokens: 100 });
  check('도구가 없으면 칸도 없다', b2.tools === undefined && b2.tool_choice === undefined);
  check('시킴말이 없으면 칸도 없다', b2.system === undefined);
}

trace('3-차례합치기');

// ── 차례가 번갈아 오게 ──────────────────────────────────────────────────
//
// 도구를 한 턴에 둘 부르면 결과 메시지가 둘이고, 이 규격에서 그 둘은 다
// 사람 차례다. 번갈아 오지 않으면 서버가 통째로 거절한다 — 도구를 하나만
// 부를 때는 되고 둘 부를 때만 안 되는, 제일 알아내기 어려운 고장이 된다.
{
  const 합침 = 차례합치기([
    { role: 'user', content: '해줘' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'R', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: '1' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: '2' }] },
  ]);
  check('★ 연달아 온 같은 차례를 합친다', 합침.length === 3, String(합침.length));
  check('★ 합칠 때 알맹이를 안 버린다', 합침[2].content.length === 2,
    JSON.stringify(합침[2].content));
  check('순서가 그대로', 합침[2].content[0].tool_use_id === 'a' && 합침[2].content[1].tool_use_id === 'b');
  check('차례가 번갈아 온다',
    합침.every((m, i) => (i === 0 ? true : m.role !== 합침[i - 1].role)),
    합침.map((m) => m.role).join(' '));

  // 글로 온 것과 배열로 온 것이 섞여도 합친다.
  const 섞임 = 차례합치기([{ role: 'user', content: '가' }, { role: 'user', content: '나' }]);
  check('글끼리도 합친다', 섞임.length === 1 && 섞임[0].content.length === 2, JSON.stringify(섞임));
  check('글이 글 블록이 된다', 섞임[0].content[0].type === 'text' && 섞임[0].content[0].text === '가');

  // 원본을 안 건드린다. 건드리면 대화 이력이 조용히 망가진다.
  const 원본 = [{ role: 'user', content: '가' }, { role: 'user', content: '나' }];
  차례합치기(원본);
  check('★ 원본 이력을 안 건드린다', 원본.length === 2 && 원본[0].content === '가',
    JSON.stringify(원본));

  check('빈 것도 안 죽는다', 차례합치기(null).length === 0 && 차례합치기([]).length === 0);
}

trace('4-답읽기');

// ── 답을 읽는다 ─────────────────────────────────────────────────────────
{
  const m = extractMessage('anthropic', {
    content: [
      { type: 'thinking', thinking: '음…' },
      { type: 'text', text: '이렇게 ' },
      { type: 'text', text: '합니다' },
      { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { p: 'a.txt' } },
    ],
    usage: { input_tokens: 120, output_tokens: 30 },
    stop_reason: 'tool_use',
  });
  check('★ 블록 배열에서 글을 모은다', m.content === '이렇게 합니다', JSON.stringify(m.content));
  check('생각도 모은다', m.thinking === '음…', m.thinking);
  check('도구 부름을 읽는다', m.toolCalls.length === 1 && m.toolCalls[0].name === 'Read',
    JSON.stringify(m.toolCalls));
  check('도구 번호를 그대로 쓴다', m.toolCalls[0].id === 'toolu_1', m.toolCalls[0].id);
  check('★ 인자는 이미 객체다 (글로 다시 읽지 않는다)', m.toolCalls[0].args?.p === 'a.txt',
    JSON.stringify(m.toolCalls[0].args));

  /*
   * 토큰 이름이 다르다. prompt_tokens 를 찾으면 늘 0 이 나오고, 화면에는
   * 「토큰을 하나도 안 썼다」 로 뜬다. 그 상태로 창 크기를 셈하면 대화가
   * 언제 찰지를 못 맞춘다.
   */
  check('★ 토큰 이름이 다른 것을 안다', m.usage.in === 120 && m.usage.out === 30,
    JSON.stringify(m.usage));
  check('끝난 까닭을 읽는다', m.stopped === 'tool_use', String(m.stopped));

  // 아무것도 없어도 안 죽는다.
  const 빈것 = extractMessage('anthropic', {});
  check('빈 답도 안 죽는다', 빈것.content === '' && 빈것.toolCalls.length === 0 && 빈것.usage.in === 0);
}

trace('5-이력-되돌리기');

// ── 대화 이력에 되돌려 넣기 ─────────────────────────────────────────────
{
  const a = assistantMessage('anthropic', {
    content: '했습니다',
    thinking: '속으로 한 말',
    toolCalls: [{ id: 'toolu_1', name: 'Read', args: { p: 'a' } }],
  });
  check('블록 배열로 돌려준다', Array.isArray(a.content), JSON.stringify(a).slice(0, 60));
  check('글 블록이 있다', a.content.some((b) => b.type === 'text' && b.text === '했습니다'));
  check('도구 부름이 tool_use 로', a.content.some((b) => b.type === 'tool_use' && b.id === 'toolu_1'));
  check('인자가 input 으로', a.content.find((b) => b.type === 'tool_use')?.input?.p === 'a');

  /*
   * 생각은 안 돌려보낸다.
   *
   * 이 규격의 생각 블록에는 서명이 딸려 있고, 서명 없이 돌려보내면 거절당한다.
   * 서명 조각을 제대로 모으는 것까지 확인하지 못했으므로 뺀다. 화면에는
   * 그대로 흘러가고 대화 이력에만 안 남는다 — 없는 것을 지어내는 것보다 낫다.
   */
  check('★ 서명 없는 생각은 안 돌려보낸다', !a.content.some((b) => b.type === 'thinking'),
    JSON.stringify(a.content));

  // 블록이 하나도 없으면 이 규격은 거절한다. 빈 답 하나로 대화가 죽으면 안 된다.
  const 빈것 = assistantMessage('anthropic', {});
  check('★ 빈 블록 배열을 안 만든다', 빈것.content.length === 1 && 빈것.content[0].text !== '',
    JSON.stringify(빈것));

  // 도구 결과는 사람 차례로 간다. role:'tool' 은 이 규격에 없다.
  const t = toolMessage('anthropic', { callId: 'toolu_1', name: 'Read', content: '내용' });
  check('★ 도구 결과가 사람 차례로 간다', t.role === 'user', t.role);
  check('tool_result 블록이다', t.content[0]?.type === 'tool_result');
  check('어느 부름의 답인지 붙인다', t.content[0]?.tool_use_id === 'toolu_1');
  check('나머지 규격은 그대로',
    toolMessage('openai', { callId: 'c', name: 'R', content: 'x' }).role === 'tool'
    && toolMessage('ollama', { callId: 'c', name: 'R', content: 'x' }).role === 'tool');
}

trace('6-흘려받기');

/*
 * ── 여기는 진짜로 돌려본다 ──────────────────────────────────────────────
 *
 * 흘려받기는 사건 이름으로 나뉘어서, 조각을 손으로 만들어 넣는 검사로는
 * 「이 순서로 진짜 오나」 를 못 잰다. 그래서 이 컴퓨터 안에 그 회사 규격대로
 * 답하는 가짜 서버를 띄우고, chatStream 을 끝까지 돌린다.
 *
 * 포트는 0 이다 — 남의 포트를 뺏지 않는다. 주소도 127.0.0.1 뿐이라 바깥으로
 * 나가지 않는다.
 */
{
  const 사건들 = [
    { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '생각' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '이렇' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '게' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_9', name: 'Read' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"p":' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"a.txt"}' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 42 } },
    { type: 'message_stop' },
  ];

  let 받은머리 = null;
  let 받은몸 = null;
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      받은머리 = req.headers;
      try { 받은몸 = JSON.parse(body); } catch { 받은몸 = null; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      // 사건 이름 줄과 자료 줄을 둘 다 보낸다. 실제 서버가 그렇게 보낸다 —
      // 사건 이름 줄을 못 넘기고 죽으면 여기서 잡힌다.
      for (const e of 사건들) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  allowEndpoint(base);

  const conn = { kind: 'anthropic', base, auth: 'x-api-key', key: 'k-1', model: 'claude-x' };
  const 나온것 = [];
  let 끝 = null;
  for await (const ev of chatStream(conn, {
    messages: [{ role: 'system', content: '시킴' }, { role: 'user', content: '해줘' }],
    maxTokens: 512,
  })) {
    if (ev.type === 'done') 끝 = ev.message;
    else 나온것.push(ev);
  }

  check('★ 판 머리를 실제로 보낸다', 받은머리?.['anthropic-version'] === ANTHROPIC_VERSION,
    String(받은머리?.['anthropic-version']));
  check('★ 열쇠를 x-api-key 로 보낸다', 받은머리?.['x-api-key'] === 'k-1', String(받은머리?.['x-api-key']));
  check('★ 시킴말이 몸통 밖 칸으로 갔다', 받은몸?.system === '시킴', String(받은몸?.system));
  check('흘려받기를 켜서 보낸다', 받은몸?.stream === true);

  check('★ 글이 흘러나온다', 나온것.filter((e) => e.type === 'content').map((e) => e.text).join('') === '이렇게',
    JSON.stringify(나온것.filter((e) => e.type === 'content')));
  check('생각도 흘러나온다', 나온것.some((e) => e.type === 'thinking' && e.text === '생각'));
  check('★ 다 모은 글이 맞다', 끝?.content === '이렇게', String(끝?.content));
  check('★ 쪼개져 온 도구 인자를 이어 붙인다', 끝?.toolCalls?.[0]?.args?.p === 'a.txt',
    JSON.stringify(끝?.toolCalls));
  check('도구 이름과 번호를 지킨다',
    끝?.toolCalls?.[0]?.name === 'Read' && 끝?.toolCalls?.[0]?.id === 'toolu_9');
  check('입력 토큰은 시작에서 받는다', 끝?.usage?.in === 100, String(끝?.usage?.in));
  /*
   * 출력 토큰은 덮어쓴다. 조각마다의 양이 아니라 여태 누적 총계라서, 더하면
   * 조각 수만큼 부풀어 오른다 — 화면의 돈과 창 크기가 같이 틀어진다.
   */
  check('★ 출력 토큰을 더하지 않고 덮는다', 끝?.usage?.out === 42, String(끝?.usage?.out));
  check('끝난 까닭을 읽는다', 끝?.stopped === 'tool_use', String(끝?.stopped));

  srv.close();
}

trace('7-그림');

// ── 그림 ────────────────────────────────────────────────────────────────
{
  const m = 그림메시지('anthropic', { 글: '이건 뭐죠', 그림들: [{ b64: 'QUJD', mime: 'image/png' }] });
  check('사람 차례로 간다', m.role === 'user');
  check('글 블록이 먼저', m.content[0]?.type === 'text' && m.content[0].text === '이건 뭐죠');
  /*
   * data: 주소로 보내면 「모르는 블록」 이라고 통째로 거절당한다. 글까지 같이
   * 안 간다는 뜻이라, 눈이 없는 모델과 달리 대화가 아예 안 이어진다.
   */
  check('★ data: 주소가 아니라 종류와 알맹이를 따로', m.content[1]?.type === 'image'
    && m.content[1].source?.type === 'base64'
    && m.content[1].source?.media_type === 'image/png'
    && m.content[1].source?.data === 'QUJD', JSON.stringify(m.content[1]));
  check('image_url 을 안 쓴다', !JSON.stringify(m).includes('image_url'));

  // 창 크기 셈이 그림을 세야 한다. 한쪽 이름만 세면 실어 놓고도 안 실은 줄 안다.
  check('★ 그림 장수를 센다', 그림장수(m) === 1, String(그림장수(m)));
  check('OpenAI 쪽도 그대로 센다', 그림장수(그림메시지('openai', { 그림들: [{ b64: 'x', mime: 'image/png' }] })) === 1);
  check('눈 검사 메시지도 이 모양', 눈검사메시지('anthropic').content[1]?.type === 'image');
}

trace('8-알아보기');

/*
 * ── 이 규격인지 알아본다 ────────────────────────────────────────────────
 *
 * 문 이름이 /models 로 OpenAI 쪽과 같다. 그런데 이쪽 서버는 판 머리가 없으면
 * 400 을 준다. 그래서 tryOpenAI 는 여기 못 붙는다 — 그 점을 가짜 서버로 잰다.
 */
{
  const srv = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      const url = req.url.split('?')[0];
      const 보내기 = (code, body) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url !== '/v1/models') return 보내기(404, {});
      if (!req.headers['anthropic-version']) {
        return 보내기(400, { error: { message: 'anthropic-version header is required' } });
      }
      if (req.headers['x-api-key'] !== 'sk-ant-test1') return 보내기(401, { error: { message: 'bad key' } });
      return 보내기(200, { data: [{ id: 'claude-x', display_name: '클로드 X', type: 'model' }] });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  for (const b of [`http://127.0.0.1:${port}`, `http://127.0.0.1:${port}/v1`, `http://127.0.0.1:${port}/openai/v1`]) allowEndpoint(b);

  const r = await detect(`127.0.0.1:${port}`, 'sk-ant-test1');
  check('★ 이 규격을 알아본다', r.kind === 'anthropic', String(r.kind));
  check('인증 방식을 x-api-key 로 잡는다', r.auth === 'x-api-key', String(r.auth));
  check('/v1 을 골랐다', String(r.base).endsWith('/v1'), String(r.base));
  check('모델 목록을 읽는다', r.models?.length === 1 && r.models[0].id === 'claude-x',
    JSON.stringify(r.models));
  check('보여 줄 이름을 곁말로 쓴다', r.models?.[0]?.note === '클로드 X', String(r.models?.[0]?.note));

  /*
   * 판 머리를 안 얹는 길로는 못 붙는다.
   *
   * 이게 성립해야 OpenAI 쪽과 안 헷갈린다. 열쇠 앞머리를 딴 것으로 주면
   * tryOpenAI 만 돌고, 그 길은 이 서버에서 400 을 받는다.
   */
  const r2 = await detect(`127.0.0.1:${port}`, 'sk-other-1');
  check('★ 판 머리 없이는 못 붙는다', r2.kind === null, String(r2.kind));
  check('막힌 상태코드를 남긴다', r2.status === 400 || r2.status === 401, String(r2.status));
  srv.close();
}

trace('9-단서');

// ── 먼저 볼 만한 단서 ───────────────────────────────────────────────────
{
  check('★ 열쇠 앞머리로 짚는다', 앤트로픽같나('http://127.0.0.1:1234', 'sk-ant-abc') === true);
  check('주소로도 짚는다', 앤트로픽같나('https://api.anthropic.com', '') === true);
  check('아랫도메인도 짚는다', 앤트로픽같나('https://gw.anthropic.com/v1', '') === true);
  // 이름만 비슷한 곳을 짚으면 안 된다. 사내 게이트웨이가 그런 이름을 쓴다.
  check('★ 이름만 닮은 곳은 안 짚는다', 앤트로픽같나('https://anthropic.example.corp', '') === false);
  check('보통 주소·열쇠는 안 짚는다', 앤트로픽같나('http://127.0.0.1:1234/v1', 'sk-abc') === false);
  check('이상한 것이 와도 안 죽는다', 앤트로픽같나(null, null) === false);
}

trace('9-2-뭐라고-부르나');

/*
 * ── 화면이 이 연결을 뭐라고 부르나 ──────────────────────────────────────
 *
 * 규격이 둘이던 때 화면 여러 자리가 `kind === 'ollama' ? … : 'OpenAI 호환'`
 * 로 갈라 놓고 있었다. 셋이 되는 순간 그 자리들이 전부 Anthropic 연결을
 * 「OpenAI 호환」 이라고 잘못 적는다.
 *
 * 붙는 데는 아무 지장이 없다. 그래서 아무도 안 고치고, 사람은 그 화면을
 * 믿고 남에게 설명하게 된다 — 틀린 것이 제일 오래 안 들키는 종류다.
 */
{
  check('★ 이 규격을 제 이름으로 부른다', 규격이름('anthropic') === 'Anthropic 규격', 규격이름('anthropic'));
  /*
   * 이 이름은 이제 말 표(head.spec.*)에서 나온다. 그래서 켤 때 머리말과
   * `/status` 가 **같은 말**을 한다 — 여태 앞은 「Ollama 규격」, 뒤는
   * 「Ollama 자체 규격」 이었다. 둘 다 맞는 말이라 아무도 안 고쳤고,
   * 그래서 오래 남았다. 더 정확한 쪽(자체)으로 모았다.
   */
  check('나머지는 하던 대로', 규격이름('ollama') === 'Ollama 자체 규격' && 규격이름('openai') === 'OpenAI 호환 규격',
    `${규격이름('ollama')} / ${규격이름('openai')}`);
  check('모르는 것은 기본 규격으로', 규격이름(undefined) === 'OpenAI 호환 규격', 규격이름(undefined));
  // 영어로 켜면 영어로 부른다. 여기가 화면에 그대로 나가는 자리라서다.
  {
    언어정하기('en');
    const 영 = [규격이름('ollama'), 규격이름('anthropic'), 규격이름('openai')];
    check('★ 영어로 켜면 규격 이름도 영어다', 영.every((x) => !/[가-힣]/.test(x)), 영.join(' / '));
    언어정하기('ko');
  }

  // 켤 때 첫 줄. 여기가 사람이 제일 먼저 보는 자리다.
  const 방 = mkdtempSync(join(tmpdir(), 'deel-anthropic-'));
  const 대화 = new Session(
    { kind: 'anthropic', base: 'https://api.example.corp/v1', model: 'claude-x', ctx: 200000, streaming: true, tools: true },
    { root: 방, mode: 'auto', think: 'medium', effort: 'save' },
  );
  const 첫줄 = 벗기기(headerLines(대화, { skills: [], commands: [], plugins: [] }, false).join('\n'));
  check('★ 첫 줄이 OpenAI 호환이라고 안 적는다', !/OpenAI/.test(첫줄), 첫줄.split('\n')[0]);
  check('첫 줄이 이 규격이라고 적는다', /Anthropic/.test(첫줄), 첫줄.split('\n')[0]);

  // 갈라 놓은 자리가 또 생기지 않았나. 소스로 잰다.
  const 갈래 = [];
  for (const f of ['src/setup.js', 'src/commands.js', 'src/report.js', 'src/backend/scanui.js', 'src/ui/status.js']) {
    const t = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    for (const [i, line] of t.split('\n').entries()) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      if (/'OpenAI 호환'/.test(line)) 갈래.push(`${f}:${i + 1}`);
    }
  }
  check('★ 화면이 규격 이름을 제각기 안 정한다', 갈래.length === 0, 갈래.join(' '));
}

trace('10-배선');

// ── 붙였다고 말한 자리가 실제로 붙었나 ──────────────────────────────────
{
  check('★ 제공자 표가 이제 말할 줄 안다고 적는다', 제공자고르기('anthropic').규격됐나 === true);

  const ctx = readFileSync(new URL('../src/backend/ctxsize.js', import.meta.url), 'utf8');
  check('창 크기 물을 때도 판 머리를 얹는다', /headersFor\(conn\.auth, conn\.key, 더할머리\(conn\.kind\)\)/.test(ctx));
  /*
   * 없는 문은 안 두드린다. llama.cpp 의 /props · TGI 의 /info 는 그 회사
   * 서버에 있을 리가 없고, 켤 때마다 그만큼 기다리게 된다.
   */
  check('★ 없는 문은 안 두드린다', /conn\.kind === 'anthropic'[\s\S]{0,900}?\['모델 목록'/.test(ctx)
    && !/conn\.kind === 'anthropic'[\s\S]{0,900}?llama\.cpp \/props/.test(ctx));

  const ad = readFileSync(new URL('../src/backend/adapter.js', import.meta.url), 'utf8');
  /*
   * ★ 보내는 길이 **전부** 판 머리를 지나간다.
   *
   * 여태 `더할머리(conn.kind)` 가 소스에 몇 번 적혀 있나로 셌다. 그 숫자는
   * 코드 모양을 바꾸면 같이 흔들린다 — 실제로 한 번에 받기와 흘려 받기가
   * 머리말짓기() 한 자리로 모이면서 두 개가 세 개가 됐고, 좋아진 것 때문에
   * 검사가 빨개졌다.
   *
   * 지켜야 하는 것은 개수가 아니라 「보내는 길에 안 지나가는 자리가 없다」 다.
   * 그래서 두 가지를 본다 — 보내는 자리는 머리말짓기() 만 쓰고(headersFor 를
   * 직접 부르지 않고), 머리말짓기() 는 돌려주는 **모든** 자리에서 판 머리를
   * 얹는다.
   */
  const 보내는자리 = [...ad.matchAll(/^\s*headers: (.+?),\s*$/gm)].map((m) => m[1].trim());
  check('★ 보내는 길은 머리말짓기() 만 쓴다',
    보내는자리.length >= 2 && 보내는자리.every((x) => x.startsWith('await 머리말짓기(')),
    보내는자리.join(' / '));

  const 짓기 = ad.match(/async function 머리말짓기[\s\S]*?^}/m)?.[0] ?? '';
  const 돌려주는것 = [...짓기.matchAll(/return (headersFor\([\s\S]*?\));/g)].map((m) => m[1]);
  check('★ 머리말짓기() 는 어느 길로 나가도 판 머리를 얹는다',
    돌려주는것.length >= 3 && 돌려주는것.every((x) => x.includes('더할머리(conn.kind)')),
    `${돌려주는것.length}갈래 · ${돌려주는것.filter((x) => !x.includes('더할머리')).length}개 빠짐`);
}

trace('11-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\nAnthropic 규격 검사  ${D}(몸통 모양이 다른 자리를 다 흡수했는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
