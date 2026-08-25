// 주소만 받아서 무슨 서버인지 알아내는 부분.
//
// 왜 중요한가: 사람이 넣는 것은 주소 한 줄뿐이다. 여기서 규격과 인증 방식을
// 잘못 짚으면 그 뒤가 전부 어긋나는데, 화면에는 "연결 실패" 한 줄만 나온다.
// 그래서 서버 모양을 종류별로 만들어 놓고 하나씩 확인한다.
//
// 전부 이 컴퓨터 안(127.0.0.1)에서 돈다. 바깥으로 나가는 연결은 없다.
import { createServer } from 'node:http';
import { candidates, detect } from '../src/backend/detect.js';
import { endpoint, buildBody, extractMessage, assistantMessage, toolMessage } from '../src/backend/adapter.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

trace('1-주소넓히기');

// ── 사람이 대충 적은 주소를 넓히는가 ────────────────────────────────────
{
  const 표 = [
    ['127.0.0.1:1234', ['http://127.0.0.1:1234/v1', 'http://127.0.0.1:1234', 'http://127.0.0.1:1234/openai/v1']],
    ['http://a.b/v1', ['http://a.b/v1']],
    ['http://a.b/v1/', ['http://a.b/v1']],
    ['https://gw.example/api/v2', ['https://gw.example/api/v2']],
    ['  127.0.0.1:9 ', ['http://127.0.0.1:9/v1', 'http://127.0.0.1:9', 'http://127.0.0.1:9/openai/v1']],
  ];
  for (const [넣은것, 나올것] of 표) {
    const got = candidates(넣은것);
    check(`'${넣은것.trim()}' 를 넓힌다`, JSON.stringify(got) === JSON.stringify(나올것), got.join(' · '));
  }
  // /v1 을 직접 준 사람에게 /v1/v1 을 시도하면 안 된다. 흔한 실수다.
  check('/v1 을 준 주소에 /v1 을 또 안 붙인다', !candidates('http://a.b/v1').some((x) => x.includes('/v1/v1')), '');
}

trace('2-서버모양');

async function 띄우기(handler) {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const r = handler(req.url.split('?')[0], req.headers, body);
      if (!r) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}'); }
      res.writeHead(r.code ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body ?? {}));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  // 문지기에게 이 자리만 열어 준다. 검사용 임시 포트라 띄울 때마다 다르다.
  // detect 는 /v1 · 뿌리 · /openai/v1 을 차례로 두드리므로 셋 다 열어 둔다.
  for (const b of [`http://127.0.0.1:${port}`, `http://127.0.0.1:${port}/v1`, `http://127.0.0.1:${port}/openai/v1`]) allowEndpoint(b);
  return { srv, port };
}

{
  // OpenAI 호환, 인증 없음
  const { srv, port } = await 띄우기((url) => (url === '/v1/models'
    ? { body: { object: 'list', data: [{ id: 'aa', owned_by: '나' }, { id: 'bb' }] } } : null));
  const r = await detect(`127.0.0.1:${port}`, '');
  check('OpenAI 호환을 알아본다', r.kind === 'openai', String(r.kind));
  check('인증 없음으로 잡는다', r.auth === 'none', String(r.auth));
  check('/v1 을 골랐다', String(r.base).endsWith('/v1'), String(r.base));
  check('모델 목록을 읽는다', r.models?.length === 2, JSON.stringify(r.models));
  check('owned_by 를 곁말로 쓴다', r.models?.[0]?.note === '나', String(r.models?.[0]?.note));
  srv.close();
}

{
  // 키가 있어야 내주는 서버. Bearer 만 받는다.
  const { srv, port } = await 띄우기((url, h) => {
    if (url !== '/v1/models') return null;
    // 키는 ASCII 로 쓴다. HTTP 헤더 값에 한글을 넣을 수 없다 —
    // 넣으면 보내는 쪽에서 막히거나 깨진다. 실제 키도 ASCII 다.
    if (h.authorization === 'Bearer key-1') return { body: { data: [{ id: 'm' }] } };
    return { code: 401, body: { error: { message: '인증이 필요합니다' } } };
  });
  const r = await detect(`127.0.0.1:${port}`, 'key-1');
  check('Bearer 방식을 찾아낸다', r.kind === 'openai' && r.auth === 'bearer', `${r.kind}/${r.auth}`);
  check('키가 맞으면 모델이 나온다', r.models?.length === 1, JSON.stringify(r.models));

  // 같은 서버에 키 없이 가면 못 붙는다. 401 을 성공으로 세면 안 된다.
  const r2 = await detect(`127.0.0.1:${port}`, '');
  check('키가 없으면 못 붙었다고 한다', r2.kind === null, String(r2.kind));
  check('어디를 시도했는지 남긴다', (r2.tried?.length ?? 0) >= 3, JSON.stringify(r2.tried));
  srv.close();
}

{
  // x-api-key 만 받는 서버 (Azure·일부 사내 게이트웨이)
  const { srv, port } = await 띄우기((url, h) => {
    if (url !== '/v1/models') return null;
    if (h['x-api-key'] === 'k') return { body: { data: [{ id: 'm' }] } };
    return { code: 403, body: {} };
  });
  const r = await detect(`127.0.0.1:${port}`, 'k');
  check('x-api-key 방식도 찾아낸다', r.auth === 'x-api-key', String(r.auth));
  srv.close();
}

{
  // /v1 은 없고 뿌리에 있는 서버
  const { srv, port } = await 띄우기((url) => (url === '/models' ? { body: { data: [{ id: 'm' }] } } : null));
  const r = await detect(`127.0.0.1:${port}`, '');
  check('/v1 이 없으면 뿌리도 본다', r.kind === 'openai' && !String(r.base).endsWith('/v1'), String(r.base));
  srv.close();
}

{
  // /openai/v1 밑에 있는 게이트웨이
  const { srv, port } = await 띄우기((url) => (url === '/openai/v1/models' ? { body: { data: [{ id: 'm' }] } } : null));
  const r = await detect(`127.0.0.1:${port}`, '');
  check('/openai/v1 도 찾는다', String(r.base).endsWith('/openai/v1'), String(r.base));
  srv.close();
}

{
  // Ollama 자체 규격. OpenAI 보다 먼저 봐야 한다.
  const { srv, port } = await 띄우기((url) => {
    if (url === '/api/version') return { body: { version: '0.5.0' } };
    if (url === '/api/tags') {
      return { body: { models: [
        { name: 'qwen3:8b', size: 5_100_000_000, details: { parameter_size: '8B' } },
        { name: '작은거', size: 400_000_000 },
      ] } };
    }
    return null;
  });
  const r = await detect(`127.0.0.1:${port}`, '');
  check('Ollama 규격을 알아본다', r.kind === 'ollama', String(r.kind));
  check('Ollama 판을 읽는다', r.version === '0.5.0', String(r.version));
  check('모델 크기를 GB 로 적는다', /GB/.test(r.models?.[0]?.note ?? ''), String(r.models?.[0]?.note));
  check('1GB 미만은 MB 로 적는다', /MB/.test(r.models?.[1]?.note ?? ''), String(r.models?.[1]?.note));
  srv.close();
}

{
  // 규격은 맞는데 서버가 화를 내는 경우 (500).
  // 이때는 '규격은 openai 인데 경고' 로 잡아야 사람에게 이유를 보여 줄 수 있다.
  const { srv, port } = await 띄우기((url) => (url === '/v1/models'
    ? { code: 500, body: { error: { message: '모델이 안 올라와 있습니다' } } } : null));
  const r = await detect(`127.0.0.1:${port}`, '');
  check('서버 오류는 규격 오인으로 안 넘긴다', r.kind === 'openai', String(r.kind));
  check('서버가 한 말을 그대로 물고 온다', /모델이 안 올라와/.test(r.warn ?? ''), String(r.warn));
  srv.close();
}

{
  // 아무도 안 듣는 자리
  for (const b of ['http://127.0.0.1:1', 'http://127.0.0.1:1/v1', 'http://127.0.0.1:1/openai/v1']) allowEndpoint(b);
  const r = await detect('127.0.0.1:1', '');
  check('아무것도 없으면 kind 가 없다', r.kind === null, String(r.kind));
}

{
  // HTTP 는 되는데 JSON 이 아닌 것을 주는 자리 (엉뚱한 웹서버)
  // 사내 프록시가 로그인 페이지를 200 으로 내주는 상황. 가장 헷갈리는 경우다 —
  // '연결은 됐는데 모델이 0개' 로 보이면 사람은 서버 쪽을 파게 된다.
  const { srv, port } = await 띄우기(() => null);
  srv.removeAllListeners('request');
  srv.on('request', (req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>사내 로그인</html>'); });
  const r = await detect(`127.0.0.1:${port}`, '');
  check('200 인데 JSON 이 아니면 모델 서버로 안 본다', r.kind === null, String(r.kind));
  srv.close();
}

trace('3-요청모양');

// ── 규격별 요청·응답 모양 ───────────────────────────────────────────────
//
// 여기가 틀리면 모델이 도구를 못 부른다. 그런데 화면에는 그냥 '답이 이상하다'
// 로만 보인다 — 원인을 못 찾는 종류의 고장이라 모양을 직접 못 박아 둔다.
{
  const 메시지 = [{ role: 'user', content: '안녕' }];
  const 도구 = [{ type: 'function', function: { name: 'Read', description: 'ㅇ', parameters: { type: 'object', properties: {} } } }];

  check('OpenAI 는 /chat/completions 로 간다', endpoint('openai') === '/chat/completions', endpoint('openai'));
  check('Ollama 는 /api/chat 으로 간다', endpoint('ollama') === '/api/chat', endpoint('ollama'));

  const o = buildBody('openai', { model: 'm', messages: 메시지, tools: 도구, maxTokens: 100 });
  check('OpenAI 몸통에 모델이 실린다', o.model === 'm', JSON.stringify(o.model));
  check('OpenAI 몸통에 도구가 실린다', Array.isArray(o.tools) && o.tools.length === 1, '');
  check('도구를 주면 tool_choice 도 같이 간다', o.tool_choice === 'auto', String(o.tool_choice));
  check('상한을 max_tokens 로 보낸다', o.max_tokens === 100, String(o.max_tokens));

  const l = buildBody('ollama', { model: 'm', messages: 메시지, tools: 도구, maxTokens: 100 });
  check('Ollama 는 상한을 options.num_predict 로 보낸다', l.options?.num_predict === 100, JSON.stringify(l.options));
  check('Ollama 는 stream 을 명시한다', typeof l.stream === 'boolean', String(l.stream));
  check('Ollama 에는 tool_choice 를 안 붙인다', l.tool_choice === undefined, String(l.tool_choice));

  // 도구가 없으면 tools 를 아예 안 보낸다. 빈 배열을 싫어하는 서버가 있다.
  const 빈것 = buildBody('openai', { model: 'm', messages: 메시지, tools: [], maxTokens: 10 });
  check('도구가 없으면 tools 를 안 보낸다', 빈것.tools === undefined, JSON.stringify(빈것.tools));

  // 추론 강도. off(false) 면 아예 안 보낸다 — 모르는 필드에 걸려 튕기는 서버가 있다.
  const 생각 = buildBody('openai', { model: 'm', messages: 메시지, think: 'high', maxTokens: 10 });
  check('추론 강도를 reasoning_effort 로 보낸다', 생각.reasoning_effort === 'high', String(생각.reasoning_effort));
  const 생각끔 = buildBody('openai', { model: 'm', messages: 메시지, think: false, maxTokens: 10 });
  check('추론을 끄면 그 필드를 아예 안 보낸다', 생각끔.reasoning_effort === undefined, String(생각끔.reasoning_effort));

  // 구조적 출력
  const 스키마 = { type: 'object', properties: { a: { type: 'string' } } };
  const j1 = buildBody('openai', { model: 'm', messages: 메시지, json: 스키마, maxTokens: 10 });
  check('OpenAI 는 json_schema 로 감싼다', j1.response_format?.type === 'json_schema', JSON.stringify(j1.response_format?.type));
  const j2 = buildBody('ollama', { model: 'm', messages: 메시지, json: 스키마, maxTokens: 10 });
  check('Ollama 는 format 에 그대로 넣는다', j2.format === 스키마, JSON.stringify(!!j2.format));
}

{
  // 응답에서 답과 도구 호출을 꺼내는 부분
  const o = extractMessage('openai', {
    choices: [{ finish_reason: 'tool_calls', message: {
      role: 'assistant', content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: '{"path":"a.txt"}' } }],
    } }],
    usage: { prompt_tokens: 5, completion_tokens: 7 },
  });
  check('도구 호출을 꺼낸다', o.toolCalls?.length === 1 && o.toolCalls[0].name === 'Read', JSON.stringify(o.toolCalls));
  check('인자를 객체로 푼다', o.toolCalls?.[0]?.args?.path === 'a.txt', JSON.stringify(o.toolCalls?.[0]?.args));
  check('왜 멈췄는지 같이 준다', o.stopped === 'tool_calls', String(o.stopped));
  check('토큰 수를 꺼낸다', o.usage?.in === 5 && o.usage?.out === 7, JSON.stringify(o.usage));

  // 인자가 깨진 JSON 이면 터지지 말고 원문을 들고 넘어가야 한다.
  // 작은 모델은 실제로 반쪽짜리 JSON 을 자주 뱉는다. 여기서 터지면 대화가 끝난다.
  //
  // 다만 원문을 args 안에 넣으면 안 된다. 예전에는 { _raw: '...' } 로 넣어
  // 도구에 그대로 넘겼는데, 도구는 file_path 가 없으니 "경로가 비었습니다" 라고
  // 답했다 — 원인과 상관없는 말이다. 모델은 고칠 게 없다고 보고 똑같이 다시
  // 시도했고, 그렇게 끝없이 돌았다. 그러니 '안 터진다' 로는 모자라고,
  // **깨졌다는 사실이 밖에서 보여야** 한다.
  const 깨짐 = extractMessage('openai', {
    choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'c', function: { name: 'Read', arguments: '{"path":' } }] } }],
  });
  check('깨진 인자에도 안 터진다', 깨짐.toolCalls?.length === 1, JSON.stringify(깨짐.toolCalls));
  check('깨졌다고 표시한다', 깨짐.toolCalls?.[0]?.argsBroken === true, JSON.stringify(깨짐.toolCalls?.[0]));
  check('깨진 인자는 원문을 남긴다', typeof 깨짐.toolCalls?.[0]?.rawArgs === 'string', JSON.stringify(깨짐.toolCalls?.[0]?.rawArgs));
  check('깨진 것을 인자인 척 넘기지 않는다', Object.keys(깨짐.toolCalls?.[0]?.args ?? {}).length === 0,
    JSON.stringify(깨짐.toolCalls?.[0]?.args));

  // id 를 안 주는 서버가 있다. 없으면 지어내야 짝을 맞출 수 있다.
  const 아이디없음 = extractMessage('openai', {
    choices: [{ message: { tool_calls: [{ function: { name: 'Read', arguments: '{}' } }, { function: { name: 'Edit', arguments: '{}' } }] } }],
  });
  check('id 가 없으면 지어낸다', 아이디없음.toolCalls?.[0]?.id && 아이디없음.toolCalls[0].id !== 아이디없음.toolCalls[1].id,
    아이디없음.toolCalls?.map((x) => x.id).join(','));

  const l = extractMessage('ollama', {
    message: { role: 'assistant', content: '답', thinking: '음…', tool_calls: [{ function: { name: 'Edit', arguments: { path: 'b' } } }] },
    prompt_eval_count: 3, eval_count: 4, done_reason: 'stop',
  });
  check('Ollama 응답도 같은 모양으로 꺼낸다', l.toolCalls?.[0]?.name === 'Edit', JSON.stringify(l.toolCalls));
  check('Ollama 는 인자가 이미 객체다', l.toolCalls?.[0]?.args?.path === 'b', JSON.stringify(l.toolCalls?.[0]?.args));
  check('Ollama 토큰 수도 꺼낸다', l.usage?.in === 3 && l.usage?.out === 4, JSON.stringify(l.usage));
  check('Ollama 의 생각도 꺼낸다', l.thinking === '음…', String(l.thinking));

  // OpenAI 계열은 생각을 reasoning_content 에 담는다.
  const 생각 = extractMessage('openai', { choices: [{ message: { content: '답', reasoning_content: '속으로' } }] });
  check('OpenAI 의 생각도 꺼낸다', 생각.thinking === '속으로', String(생각.thinking));

  const 그냥답 = extractMessage('openai', { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '그냥 답' } }] });
  check('도구가 없으면 빈 배열', 그냥답.toolCalls?.length === 0, JSON.stringify(그냥답.toolCalls));
  check('글은 그대로 나온다', 그냥답.content === '그냥 답', String(그냥답.content));

  // 아무것도 없는 응답. 게이트웨이가 이런 걸 줄 때가 있다.
  for (const 이상한것 of [{}, { choices: [] }, { choices: [{}] }, null, undefined]) {
    const r = extractMessage('openai', 이상한것);
    check(`빈 응답 ${JSON.stringify(이상한것) ?? 'undefined'} 에도 안 터진다`,
      r && r.content === '' && Array.isArray(r.toolCalls), JSON.stringify(r?.content));
  }
}

{
  // 대화 기록에 다시 넣을 모양. 이게 틀리면 다음 턴에서 모델이 헷갈린다.
  const 호출 = [{ id: 'c1', name: 'Read', args: { path: 'a' } }];
  const m = assistantMessage('openai', { content: '했습니다', toolCalls: 호출 });
  check('되돌릴 메시지가 assistant 다', m.role === 'assistant', String(m.role));
  check('도구 호출이 원래 모양으로 돌아간다', m.tool_calls?.[0]?.function?.name === 'Read', JSON.stringify(m.tool_calls));
  check('OpenAI 는 인자를 다시 글로 만든다', typeof m.tool_calls?.[0]?.function?.arguments === 'string', typeof m.tool_calls?.[0]?.function?.arguments);

  const l = assistantMessage('ollama', { content: '했습니다', thinking: '음', toolCalls: 호출 });
  check('Ollama 는 인자를 객체로 둔다', typeof l.tool_calls?.[0]?.function?.arguments === 'object', typeof l.tool_calls?.[0]?.function?.arguments);
  check('Ollama 는 생각을 따로 싣는다', l.thinking === '음', String(l.thinking));

  // 도구 결과를 되돌리는 모양. 규격마다 짝을 맞추는 열쇠가 다르다 —
  // OpenAI 는 호출 id, Ollama 는 도구 이름이다. 바꿔 넣으면 짝이 안 맞는다.
  const t1 = toolMessage('openai', { callId: 'c1', name: 'Read', content: '내용' });
  check('OpenAI 도구 결과는 id 로 짝을 맞춘다', t1.tool_call_id === 'c1' && t1.role === 'tool', JSON.stringify(t1));
  const t2 = toolMessage('ollama', { callId: 'c1', name: 'Read', content: '내용' });
  check('Ollama 도구 결과는 이름으로 짝을 맞춘다', t2.tool_name === 'Read', JSON.stringify(t2));
}

trace('4-치움');
resetNet();

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n서버 알아보기 검사  ${D}(주소 한 줄로 규격·인증을 짚어내는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
