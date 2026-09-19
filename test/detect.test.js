// 주소만 받아서 무슨 서버인지 알아내는 부분.
//
// 왜 중요한가: 사람이 넣는 것은 주소 한 줄뿐이다. 여기서 규격과 인증 방식을
// 잘못 짚으면 그 뒤가 전부 어긋나는데, 화면에는 "연결 실패" 한 줄만 나온다.
// 그래서 서버 모양을 종류별로 만들어 놓고 하나씩 확인한다.
//
// 전부 이 컴퓨터 안(127.0.0.1)에서 돈다. 바깥으로 나가는 연결은 없다.
import { createServer } from 'node:http';
import { candidates, detect, 앤트로픽같나, 막은것적기 } from '../src/backend/detect.js';
import { endpoint, buildBody, extractMessage, assistantMessage, toolMessage } from '../src/backend/adapter.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { serverMessage, 프록시힌트 } from '../src/backend/http.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 짧게 = (s) => String(s).replace(/\s+/g, ' ').slice(0, 80);

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

/*
 * ── ★★★ 답을 했다는 것과 이 규격이라는 것은 다른 말이다 ─────────────────
 *
 * 사람이 본 것: 설치 화면이 초록색 「연결됨 · 인증 bearer」 로 끝났다. 그 값이
 * 프로필에 저장되고, 첫 한마디부터 401 이 난다. 열쇠를 새로 받아 넣어도 또
 * 401 이다 — 화면 어디에도 인증 방식을 **우리가 찍었다**는 말이 없으니 사람은
 * 열쇠만 의심한다.
 *
 * 실제로는 `/models` 가 503 이었다. 5xx·429 는 앞단 프록시도 낸다. 그 한 마디로
 * 아는 것은 「거기 무언가 있다」 뿐인데, 규격을 openai 로 못 박고 그때 쓰던
 * 인증 방식(차례상 맨 앞이라 대개 bearer)까지 확정해 적어 뒀다.
 */
{
  const { srv, port } = await 띄우기((url) => (url === '/v1/models'
    ? { code: 503, body: { error: { message: 'upstream connect error' } } } : null));
  const r = await detect(`127.0.0.1:${port}`, 'key-1');
  check('★★★ 5xx 로 정한 것은 짐작이라고 적어 둔다', r.짐작 === true, JSON.stringify(r.짐작));
  check('★★★ 화면에도 확인 못 했다고 말한다', /확인 못 했습니다/.test(r.warn ?? ''), 짧게(r.warn));
  check('★★★ 인증 방식이 짐작이라는 것까지 말한다',
    /인증은 '(bearer|x-api-key|api-key|none)' 로 짐작/.test(r.warn ?? ''), 짧게(r.warn));
  check('★★ 서버가 한 말은 그대로 남긴다', /upstream connect error/.test(r.warn ?? ''), 짧게(r.warn));
  srv.close();
}

{
  // 429 도 마찬가지다 — 한도에 걸린 앞단은 규격에 대해 아무것도 안 말해 준다.
  const { srv, port } = await 띄우기((url) => (url === '/v1/models'
    ? { code: 429, body: { error: { message: 'rate limited' } } } : null));
  const r = await detect(`127.0.0.1:${port}`, 'key-1');
  check('★★★ 429 도 짐작이다', r.kind === 'openai' && r.짐작 === true, JSON.stringify({ kind: r.kind, 짐작: r.짐작 }));
  srv.close();
}

{
  /*
   * ★★ 반대로 넘치면 안 된다. 400·402 처럼 **서버가 요청을 읽고 답한** 것까지
   * 짐작으로 적으면, 이 표시가 아무 뜻도 없는 표시가 된다.
   */
  const { srv, port } = await 띄우기((url) => (url === '/v1/models'
    ? { code: 402, body: { error: { message: '잔액이 모자랍니다' } } } : null));
  const r = await detect(`127.0.0.1:${port}`, 'key-1');
  check('★★ 5xx·429 가 아니면 짐작으로 안 적는다', r.kind === 'openai' && r.짐작 === false,
    JSON.stringify({ kind: r.kind, 짐작: r.짐작 }));
  check('★★ 그때는 서버 말만 적는다 — 없는 말을 안 보탠다', r.warn === '잔액이 모자랍니다', 짧게(r.warn));
  srv.close();
}

/*
 * ── ★★★ Azure: 401 을 주소 탓으로 돌리지 않는다 ─────────────────────────
 *
 * 사람이 본 것: 포털에서 자원 주소만(배포 이름 없이) 복사해 넣고 열쇠가 틀렸을
 * 때, 화면은 「배포를 못 찾았습니다 — 주소에 /openai/deployments/<배포이름>
 * 까지 넣어 보세요」 였다. 시키는 대로 고쳐도 아무것도 안 바뀐다. 서버는 세
 * 방식 모두에 401 을 냈고, 그건 주소가 아니라 **열쇠** 이야기였다.
 *
 * 두드려서 받아 온 상태 코드를 tryAzure 가 통째로 버리고 null 만 돌려줬기
 * 때문이다. 부르는 쪽은 받은 것이 없으니 제가 아는 짐작 한 줄을 적었다.
 */
{
  const { srv, port } = await 띄우기(() => ({ code: 401, body: { error: { message: '열쇠가 틀렸습니다' } } }));
  const r = await detect(`http://127.0.0.1:${port}/openai/deployments`, 'bad-key');
  check('★★★ Azure 401 은 401 이라고 말한다', r.status === 401, JSON.stringify({ status: r.status, why: 짧게(r.why) }));
  check('★★★ 열쇠를 보라고 한다', /열쇠/.test(r.why ?? ''), 짧게(r.why));
  check('★★★ 주소를 고치라는 헛말을 안 한다', !/deployments\/<배포이름>/.test(r.why ?? ''), 짧게(r.why));
  srv.close();
}

{
  // 500·502 는 아예 담기지도 않아서 더 나빴다 — 서버가 아픈 것이 주소 탓이 됐다.
  const { srv, port } = await 띄우기(() => ({ code: 502, body: { error: { message: '앞단이 죽었습니다' } } }));
  const r = await detect(`http://127.0.0.1:${port}/openai/deployments`, 'key-1');
  check('★★★ Azure 5xx 도 상태 코드를 들고 나온다', r.status === 502, String(r.status));
  check('★★★ 서버 쪽 문제라고 말한다', /서버 쪽/.test(r.why ?? ''), 짧게(r.why));
  check('★★★ 여기서도 주소를 고치라고 안 한다', !/deployments\/<배포이름>/.test(r.why ?? ''), 짧게(r.why));
  srv.close();
}

{
  /*
   * ★★★ 그 말이 맞는 자리에서는 그대로 해야 한다. 404 는 「그 자리가 없다」 라,
   * 배포 이름을 넣어 보라는 말이 실제로 듣는 유일한 자리다.
   */
  const { srv, port } = await 띄우기(() => ({ code: 404, body: { error: { message: '없습니다' } } }));
  const r = await detect(`http://127.0.0.1:${port}/openai/deployments`, 'key-1');
  check('★★★ 404 에는 배포 이름을 넣어 보라고 한다', /deployments\/<배포이름>/.test(r.why ?? ''), 짧게(r.why));
  check('★★ 404 도 상태 코드를 들고 나온다', r.status === 404, String(r.status));
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

  /*
   * ── ★ 「0 을 썼다」 와 「얼마 썼는지 모른다」 는 다른 말이다 ────────────
   *
   * usage 를 아예 안 주는 창구가 있다. 그때 우리가 만드는 usage 는 전부 0 이라,
   * 합계에 0 을 더하고 나면 화면에 **아무 표도 안 난다.** 그 판은 유료로
   * 불렀는데 화면은 「0 원」 이라고 적어 두는 셈이다 — 사람이 그 숫자를 보고
   * 하는 판단이 달라진다.
   *
   * 그래서 `잰것` 을 같이 싣는다. 이 값이 없으면 loop.js 는 「안 준 판」 을
   * 셀 수가 없고, /cost 의 「n번은 창구가 안 알려 줘서 안 들어감」 줄이
   * 영영 안 뜬다. 그 줄이 안 뜨는 것과 0 인 것은 화면에서 똑같이 보인다.
   */
  const 안준것 = extractMessage('openai', { choices: [{ message: { content: '답' } }] });
  check('★★ usage 를 안 주면 안 쟀다고 적는다', 안준것.usage?.잰것 === false,
    JSON.stringify(안준것.usage));
  check('★ 안 쟀어도 숫자 자리는 0 으로 채운다 (더하기가 안 깨진다)',
    안준것.usage?.in === 0 && 안준것.usage?.out === 0, JSON.stringify(안준것.usage));
  check('★ 준 판은 쟀다고 적는다', o.usage?.잰것 === true, JSON.stringify(o.usage));

  /*
   * ★ 진짜 0 과 「안 줌」 이 갈리는가.
   *
   * 서버가 `usage: { prompt_tokens: 0, completion_tokens: 0 }` 을 **주는** 일이
   * 있다(캐시가 전부 맞은 판 등). 그건 잰 값이라 합계에 그대로 들어가야 하고,
   * 「안 알려 줌」 으로 세면 안 된다. 숫자만 보면 두 자리가 똑같아서, 이걸
   * 가르는 것은 잰것 하나뿐이다.
   */
  const 진짜0 = extractMessage('openai', {
    choices: [{ message: { content: '답' } }],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  });
  check('★★ 서버가 준 0 은 잰 값이다 (안 준 것과 안 헷갈린다)',
    진짜0.usage?.잰것 === true && 진짜0.usage.in === 0, JSON.stringify(진짜0.usage));

  // 세 규격이 다 같은 말을 해야 한다. 한 규격만 이 값을 안 실으면 그 창구를
  // 쓰는 사람에게만 화면이 조용히 틀린 말을 한다.
  const 올라마안줌 = extractMessage('ollama', { message: { role: 'assistant', content: '답' } });
  check('★ ollama 도 안 준 판을 안 쟀다고 적는다', 올라마안줌.usage?.잰것 === false,
    JSON.stringify(올라마안줌.usage));
  check('★ ollama 가 준 판은 쟀다고 적는다', l.usage?.잰것 === true, JSON.stringify(l.usage));

  const 클로드안줌 = extractMessage('anthropic', { content: [{ type: 'text', text: '답' }] });
  check('★ anthropic 도 안 준 판을 안 쟀다고 적는다', 클로드안줌.usage?.잰것 === false,
    JSON.stringify(클로드안줌.usage));
  const 클로드줌 = extractMessage('anthropic', {
    content: [{ type: 'text', text: '답' }],
    usage: { input_tokens: 11, output_tokens: 22 },
  });
  check('★ anthropic 이 준 판은 쟀다고 적는다',
    클로드줌.usage?.잰것 === true && 클로드줌.usage.in === 11, JSON.stringify(클로드줌.usage));

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

trace('5-프록시오류');
// ── 프록시가 자격증명을 못 받았을 때 ────────────────────────────────────
//
// 사내 게이트웨이는 앞에 프록시를 두고 매번 바깥 명령으로 토큰을 받아 온다.
// 그 명령이 실패하면 원문이 그대로 화면에 뜨는데, 그걸로는 무엇을 해야 할지 알 수가 없다.
// 실제로 겪었다 — 모델도 deel 도 아니고 그 PC 의 Databricks 로그인이 만료된 것이었다.
{
  const 진짜 = "[PROXY ERROR] Command '['databricks', 'auth', 'token', '--host', "
    + "'dbc-1234abcd.cloud.databricks.com', '--profile', 'someone@example.com', "
    + "'-o', 'json']' returned non-zero exit status 1.";

  const 말 = serverMessage({ status: 500, json: { error: { message: 진짜 } } });
  check('원인을 사람 말로 바꾼다', 말.includes('로그인이 만료된 것입니다'), 짧게(말));
  check('칠 명령까지 만들어 준다',
    말.includes('databricks auth login --host https://dbc-1234abcd.cloud.databricks.com'
      + ' --profile someone@example.com'), 짧게(말));
  check('원문도 남긴다 (사내 담당자에게 보여 줘야 한다)', 말.includes('원문: [PROXY ERROR]'));

  // `[PROXY ERROR]` 도 대괄호다. 그게 먼저 걸리면 도구 이름을 '외부 명령' 으로 놓친다.
  check('앞머리 대괄호에 안 속는다', !말.includes("'외부 명령'"), 짧게(말));

  const 본문만 = serverMessage({ status: 502, text: 진짜 });
  check('본문이 그냥 글이어도 알아본다', 본문만.includes('로그인이 만료된 것입니다'));

  const 모르는것 = serverMessage({ status: 500,
    text: "[PROXY ERROR] Command '['gcloud', 'auth', 'print-access-token']' returned non-zero exit status 2." });
  check('모르는 도구는 이름만 짚고 넘어간다',
    모르는것.includes("'gcloud'") && 모르는것.includes('프록시 쪽 문제'), 짧게(모르는것));

  // 여기서 멀쩡한 오류까지 건드리면 loop 의 '길이를 배우는' 길이 막힌다.
  const 평범 = serverMessage({ status: 400, json: { error: { message: 'model not found: x' } } });
  check('평범한 오류는 그대로 둔다', 평범 === 'model not found: x', 평범);
  const 길이 = "This model's maximum context length is 8192 tokens";
  check('길이 초과 문장을 안 건드린다 (배우는 길)',
    serverMessage({ status: 400, json: { error: { message: 길이 } } }) === 길이);

  check('짝 안 맞는 글에도 안 터진다',
    프록시힌트("Command '[' returned non-zero exit status 1.") != null
    && 프록시힌트('그냥 오류') === null);
}

// ── 이 규격이 아닌 서버를 openai 로 굳히지 않는다 (사냥5 B5-08) ──────────
trace('3.9-이규격아님');
{
  /*
   * 모든 길에 `{"status":"ok"}` 나 `[]` 를 주는 개발 서버, 모든 길을 /login 으로
   * 되돌리는 관리 화면이 전부 「openai · 인증 none · 모델 0개」 로 붙었다. 사람은
   * 모델이 안 올라온 줄 알고 엉뚱한 데를 판다. 목록 **모양**이 와야 이 규격이다.
   */
  const 띄움 = (손) => new Promise((ok) => { const s = createServer(손); s.listen(0, '127.0.0.1', () => ok(s)); });
  const 모든길 = (code, body, head) => (q, s) => { q.resume(); s.writeHead(code, head); s.end(body); };
  const 판들 = [
    ['모든 길에 {"status":"ok"}', 모든길(200, '{"status":"ok"}', { 'content-type': 'application/json' }), false],
    ['모든 길에 []', 모든길(200, '[]', { 'content-type': 'application/json' }), false],
    ['모든 길을 /login 으로 302', 모든길(302, '', { location: '/login' }), false],
    ['빈 목록 {"object":"list","data":[]}', (q, s) => {
      q.resume();
      if (q.url.startsWith('/v1/models')) { s.writeHead(200, { 'content-type': 'application/json' }); return s.end('{"object":"list","data":[]}'); }
      s.writeHead(404); return s.end();
    }, true],
  ];
  for (const [이름, 손, 붙어야] of 판들) {
    const s = await 띄움(손);
    const base = `http://127.0.0.1:${s.address().port}`;
    allowEndpoint(base);
    let r;
    try { r = await detect(base, ''); } catch (e) { r = { 던짐: String(e?.message ?? e) }; }
    check(`${붙어야 ? '★' : '★★'} ${이름} → ${붙어야 ? 'openai 로 붙는다 (모델이 없는 것도 목록이다)' : 'openai 로 안 굳힌다'}`,
      붙어야 ? r?.kind === 'openai' : r?.kind !== 'openai',
      JSON.stringify({ kind: r?.kind, warn: r?.warn, why: r?.why, 던짐: r?.던짐 }).slice(0, 160));
    s.closeAllConnections?.();
    s.close();
  }
}

// ── 6회차 Gemini 알아내기6 ─────────────────────────────────────────────
trace('3.95-알아내기6');
{
  const 띄움 = (손) => new Promise((ok) => { const s = createServer(손); s.listen(0, '127.0.0.1', () => ok(s)); });
  const 답 = (s, code, o) => { s.writeHead(code, { 'content-type': 'application/json' }); s.end(JSON.stringify(o)); };
  const 재기 = async (손, 주소뒤, 열쇠) => {
    const s = await 띄움(손);
    const base = `http://127.0.0.1:${s.address().port}`;
    allowEndpoint(base);
    let r;
    try { r = await detect(base + 주소뒤, 열쇠); } catch (e) { r = { 던짐: String(e?.message ?? e) }; }
    s.closeAllConnections?.(); s.close();
    return r;
  };
  const 보기 = (r) => JSON.stringify({ kind: r?.kind, auth: r?.auth, status: r?.status, why: r?.why, warn: r?.warn, 던짐: r?.던짐 }).slice(0, 180);

  /*
   * D4 · `/v1/models` 는 404(길 없음), `/models` 는 401(열쇠 틀림). 후보 차례상 404 를 먼저 받는데,
   * 처음 받은 것만 적어서 화면이 「no route · 404」 — 주소 탓 — 로 끝났다.
   */
  const 길없고열쇠틀림 = await 재기((q, s) => {
    q.resume();
    if (q.url.startsWith('/v1/')) return 답(s, 404, { error: { message: 'no route' } });
    if (q.url === '/models') return 답(s, 401, { error: { message: 'invalid api key' } });
    return 답(s, 404, { error: { message: 'nothing' } });
  }, '', 'key-1');
  check('★ 404 를 먼저 받아도 뒤에 온 401 로 말한다 — 주소가 아니라 열쇠', 길없고열쇠틀림.kind === null
    && 길없고열쇠틀림.status === 401 && 길없고열쇠틀림.why === 'invalid api key', 보기(길없고열쇠틀림));
  const 열쇠틀리고길없음 = await 재기((q, s) => {
    q.resume();
    if (q.url === '/v1/models') return 답(s, 401, { error: { message: 'invalid api key' } });
    return 답(s, 404, { error: { message: 'no route' } });
  }, '', 'key-1');
  check('  401 을 먼저 받으면 뒤의 404 로 안 덮는다', 열쇠틀리고길없음.status === 401 && 열쇠틀리고길없음.why === 'invalid api key',
    보기(열쇠틀리고길없음));
  const 방법없고열쇠틀림 = await 재기((q, s) => {
    q.resume();
    if (q.url.startsWith('/v1/')) return 답(s, 405, { error: { message: 'Method Not Allowed' } });
    if (q.url === '/models') return 답(s, 401, { error: { message: 'invalid api key' } });
    return 답(s, 404, { error: { message: 'nothing' } });
  }, '', 'key-1');
  check('  405 도 약한 단서다 — 뒤에 온 401 로 말한다', 방법없고열쇠틀림.status === 401, 보기(방법없고열쇠틀림));
  const 다없음 = await 재기((q, s) => { q.resume(); 답(s, 404, { error: { message: 'no route' } }); }, '', 'key-1');
  check('  다 404 면 404 다', 다없음.status === 404, 보기(다없음));

  /*
   * E1 · LLM 이 아닌 서버가 `/models` 에 405 를 준다. 그 길이 GET 을 안 받는다는 말이라 모델 목록이
   * 아닌데, 「openai · 인증 bearer」 로 초록색이 됐다. 404 와 같이 「이 길이 아니다」 로 본다.
   */
  const 방법안됨 = await 재기((q, s) => { q.resume(); 답(s, 405, { error: { message: 'Method Not Allowed' } }); }, '', 'key-1');
  check('★ /models 에 405 인 서버를 openai 로 안 굳힌다', 방법안됨.kind === null && 방법안됨.status === 405, 보기(방법안됨));

  /*
   * E3 · 모든 길에 `{"data":[{"status":"ok"}]}` 를 주는 개발 서버. OpenAI 쪽은 목록 모양으로 거르는데
   * Anthropic 쪽은 `data` 가 배열이기만 보고 「anthropic · 모델 0개」 로 붙었다.
   */
  const 가짜목록 = await 재기((q, s) => { q.resume(); 답(s, 200, { data: [{ status: 'ok' }] }); }, '', 'key-1');
  check('★ 이름 없는 data 배열을 anthropic 으로 안 굳힌다', 가짜목록.kind !== 'anthropic' && 가짜목록.kind !== 'openai', 보기(가짜목록));
  const 진짜앤트로픽 = await 재기((q, s) => {
    q.resume();
    if (q.url === '/v1/models' && q.headers['anthropic-version']) return 답(s, 200, { data: [{ id: 'claude-x', display_name: 'X' }] });
    return 답(s, 400, { error: { message: 'anthropic-version header is required' } });
  }, '', 'key-1');
  check('  진짜 Anthropic 목록은 그대로 붙는다', 진짜앤트로픽.kind === 'anthropic' && 진짜앤트로픽.models?.[0]?.id === 'claude-x', 보기(진짜앤트로픽));

  /*
   * D1 · 배포 이름이 든 Azure 주소를 열쇠 없이 넣었고 목록이 401. 주소에 적힌 배포로 붙이는 것은
   * 그대로 두되(목록 권한이 따로인 테넌트), 화면이 「목록을 못 봤다」 만 말하고 **열쇠가 없다**는 말을
   * 안 해서 첫 한마디의 401 을 사람이 짐작해야 했다.
   */
  const 열쇠없는애저 = await 재기((q, s) => { q.resume(); 답(s, 401, { error: { message: 'missing subscription key' } }); }, '/openai/deployments/dep1', '');
  check('★ 열쇠 없이 Azure 목록이 401 이면 열쇠를 넣으라고 말한다', 열쇠없는애저.kind === 'openai' && /열쇠/.test(열쇠없는애저.warn ?? ''), 보기(열쇠없는애저));

  /*
   * D3 · 받기만 하고 영영 답을 안 하는 주소(방화벽이 삼키는 자리 · VPN 이 반쯤 올라온 자리).
   * 인증 방식마다, 후보 주소마다 12초씩 기다려서 설치 화면이 일반 주소 188초(16번) · Azure 36초(3번)
   * 멈췄다. 머리 하나 · 길 하나 바꾼다고 안 답하던 곳이 답하지 않는다 — 한 번 시간이 다 되면 거기서 끝.
   * (allowEndpoint 는 허용 목록을 **바꿔 끼우므로** 두 판을 함께 못 돌린다 — 차례로 잰다.)
   */
  const 먹통재기 = async (주소뒤) => {
    const 받은 = []; const 잡힌 = [];
    const s = await 띄움((q, res) => { 받은.push(q.url); 잡힌.push(res); });
    const base = `http://127.0.0.1:${s.address().port}`;
    allowEndpoint(base);
    const t0 = Date.now();
    let r;
    try { r = await detect(base + 주소뒤, 'key-1'); } catch (e) { r = { 던짐: String(e?.message ?? e) }; }
    const 초 = Math.round((Date.now() - t0) / 1000);
    for (const x of 잡힌) x.destroy();
    s.closeAllConnections?.(); s.close();
    return { r, 초, 받은 };
  };
  const 먹통일반 = await 먹통재기('');
  const 먹통애저 = await 먹통재기('/openai/deployments/dep1');
  check('★ 안 답하는 주소에서 한 번 시간이 다 되면 더 안 두드린다 (188초 · 16번이던 것)',
    먹통일반.r.kind === null && 먹통일반.초 <= 30 && 먹통일반.받은.length <= 2 && /시간 초과/.test(먹통일반.r.why ?? ''),
    `${먹통일반.초}초 · ${먹통일반.받은.length}번 · ${보기(먹통일반.r)}`);
  check('★ Azure 도 같다 — 인증 방식을 바꿔 가며 12초씩 더 안 기다린다 (36초 · 3번이던 것)',
    먹통애저.r.kind === null && 먹통애저.초 <= 20 && 먹통애저.받은.length === 1 && /시간 초과/.test(먹통애저.r.why ?? ''),
    `${먹통애저.초}초 · ${먹통애저.받은.length}번 · ${보기(먹통애저.r)}`);
}

// ── 창구 찾기 (8회차 뒷단) ──────────────────────────────────────────────
trace('3.97-창구찾기');
{
  const 띄움 = (손) => new Promise((ok) => { const s = createServer(손); s.listen(0, '127.0.0.1', () => ok(s)); });
  const 답 = (s, code, o) => { s.writeHead(code, { 'content-type': 'application/json' }); s.end(JSON.stringify(o)); };

  /*
   * 배포 목록이 404 가 아닌 코드로 막혔을 때.
   *
   * 「주소에 /openai/deployments/<배포이름> 까지 넣어 보세요」 는 **404 에서만**
   * 할 말이다 — 머리말도 그렇게 적어 두었다. 그런데 400·429 에도 같은 말이
   * 나갔다. 429 는 앞단이 지금 받아 줄 수 없다는 뜻이고 주소는 멀쩡하다.
   * 시키는 대로 주소를 고쳐 넣어도 아무것도 안 바뀐다.
   */
  const 애저막힘재기 = async (code) => {
    const s = await 띄움((q, res) => { q.resume(); 답(res, code, { error: { message: 'nope' } }); });
    const base = `http://127.0.0.1:${s.address().port}`;
    allowEndpoint(base);
    let r;
    try { r = await detect(`${base}/openai/deployments`, 'key-1'); } catch (e) { r = { 던짐: String(e?.message ?? e) }; }
    s.closeAllConnections?.(); s.close();
    return r;
  };
  for (const code of [429, 400]) {
    const r = await 애저막힘재기(code);
    check(`★ 배포 목록이 ${code} 면 주소를 고치라고 하지 않는다`,
      !/deployments\/<배포이름>/.test(r.why ?? '') && new RegExp(String(code)).test(r.why ?? ''), 짧게(r.why));
  }
  const 사백사 = await 애저막힘재기(404);
  check('  404 에서는 예전대로 주소에 배포를 붙여 보라고 한다', /deployments\/<배포이름>/.test(사백사.why ?? ''), 짧게(사백사.why));

  /*
   * ── 200 으로 답한 자리에 「주소를 고쳐 보세요」 (사냥6 막판-뒷단) ────────
   *
   * 사내 SSO·프록시가 배포 목록 요청을 가로채 **200 으로 로그인 페이지**를 준다.
   * 그건 거절이 아니라서 위 `막힌것` 목록에 안 담긴다(그건 맞다 — 인증 방식 표에
   * 섞이면 안 된다). 그런데 목록이 비면 tryAzure 가 `null` 을 내고, 부르는 쪽은
   * 제가 아는 짐작 한 줄 —「주소에 /openai/deployments/<배포이름> 까지 넣어
   * 보세요」— 를 적었다. 주소에는 이미 그 길이 적혀 있고, 서버는 200 으로
   * 또박또박 답했다. 시키는 대로 고쳐도 아무것도 안 바뀐다. `status` 도 0 이라
   * providers 의 막힌까닭 도 아무 말을 못 한다.
   *
   * 바로 위 429·400 검사가 막으려던 것과 같은 틀림인데, 그쪽은 거절 코드로 와서
   * 잡혔고 이쪽은 200 이라 그 그물을 빠져나갔다.
   */
  {
    const s2 = await 띄움((q, res) => {
      q.resume();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body>Sign in to your account</body></html>');
    });
    const base = `http://127.0.0.1:${s2.address().port}`;
    allowEndpoint(base);
    let r;
    try { r = await detect(`${base}/openai/deployments`, 'key-1'); } catch (e) { r = { 던짐: String(e?.message ?? e) }; }
    s2.closeAllConnections?.(); s2.close();
    check('★★★ 200 으로 답한 자리에는 주소를 고치라고 하지 않는다',
      r.kind === null && !/deployments\/<배포이름>/.test(r.why ?? ''), 짧게(r.why));
    check('★★ 200 인데 JSON 이 아니라는 것을 말해 준다 — 브라우저로 열어 보게',
      /200/.test(r.why ?? '') && /JSON|로그인|가로/.test(r.why ?? ''), 짧게(r.why));
  }

  /*
   * 한 번 선 `먹통` 은 서버가 제 말로 답하면 내려가야 한다.
   *
   * 「아무도 답한 적 없는데 시간이 다 됐다」 가 먹통의 뜻이다(시간다됨 머리말).
   * 그런데 그 뒤에 401 이 와서 status 를 채워도 표시는 그대로 남았다. 남은
   * 표시 하나로 부르는 쪽은 나머지 후보를 통째로 건너뛴다 — 서버가 거기
   * 있다고 말한 뒤에 「닿지도 못했다」 로 끝난다.
   */
  {
    const 막힌것 = { status: 0, why: '' };
    막은것적기(막힌것, { status: 0, code: 'TimeoutError', error: '시간 초과' });
    check('  시간이 다 되면 먹통이 선다', 막힌것.먹통 === true, JSON.stringify(막힌것));
    막은것적기(막힌것, { status: 401, json: { error: { message: 'bad key' } } });
    check('★ 뒤에 서버가 401 로 답하면 먹통이 내려간다', !막힌것.먹통 && 막힌것.status === 401, JSON.stringify(막힌것));
  }

  /*
   * 앞뒤 빈칸이 붙은 주소.
   *
   * detect 는 origin 만 trim 하고 **원본 input** 은 그대로 넘긴다. 그래서
   * ` api.anthropic.com ` 을 넣으면 앤트로픽같나 가 false 가 되고, Anthropic
   * 규격을 먼저 볼 단서를 통째로 잃는다. setup --url 은 trim 을 안 한다.
   */
  check('★ 앞뒤 빈칸이 붙어도 Anthropic 주소로 본다', 앤트로픽같나(' api.anthropic.com ', '') === true);
  check('  빈칸 없는 것은 예전 그대로', 앤트로픽같나('api.anthropic.com', '') === true);
  check('  남의 도메인은 여전히 아니다', 앤트로픽같나(' api.anthropic.com.evil.example ', '') === false);

  /*
   * Ollama 로 붙었을 때만 tried 가 빈 배열이었다. 다른 갈래는 다 적는다.
   * 「어디를 두드렸나」 를 보여 주는 화면이 이 갈래에서만 빈칸이 된다.
   */
  {
    const s = await 띄움((q, res) => {
      q.resume();
      if (q.url === '/api/version') return 답(res, 200, { version: '0.5.0' });
      if (q.url === '/api/tags') return 답(res, 200, { models: [{ name: 'qwen3', size: 5e9 }] });
      return 답(res, 404, {});
    });
    const base = `http://127.0.0.1:${s.address().port}`;
    allowEndpoint(base);
    const r = await detect(base, '');
    s.closeAllConnections?.(); s.close();
    check('★ Ollama 로 붙어도 두드린 자리를 적는다', r.kind === 'ollama' && (r.tried?.length ?? 0) > 0,
      `${r.kind} · ${JSON.stringify(r.tried)}`);
  }
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
