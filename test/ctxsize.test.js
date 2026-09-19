// 컨텍스트 길이를 서버에서 제대로 알아내는가.
//
// 이 숫자 하나가 프로그램 전체 크기를 정한다. 작게 잡히면 파일을 몇 개 못 읽히고,
// 대화가 금방 접히고, 답 길이 상한도 같이 줄어든다. 그런데 화면에는 아무 표시도
// 안 뜬다 — 그냥 조용히 작아진다. 그래서 서버 종류별로 실제 응답 모양을 만들어
// 하나씩 확인한다.
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeCtx, parseSize, fmtSize, 기본값 } from '../src/backend/ctxsize.js';
import { allowEndpoint } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

trace('1-숫자읽기');

// ── 사람이 치는 대로 받는가 ─────────────────────────────────────────────
//
// 655360 을 손으로 치면 자릿수를 틀린다. 그래서 655k 를 받는다.
for (const [넣은것, 나올것] of [
  ['32768', 32768],
  ['655360', 655360],
  // k 는 1024 다. 컨텍스트 길이는 죄다 2의 거듭제곱이라 그래야 아귀가 맞는다 —
  // 655,360 은 '655k' 가 아니라 640k 다. 화면에도 640k 로 적어 그걸 알려 준다.
  ['640k', 655360],
  ['640K', 655360],
  ['128k', 131072],
  ['32k', 32768],
  ['1m', 1048576],
  ['262,144', 262144],
  [' 128k ', 131072],
]) {
  check(`'${넣은것}' → ${나올것}`, parseSize(넣은것) === 나올것, String(parseSize(넣은것)));
}

// 말이 안 되는 값은 안 받는다. 받아 버리면 매 요청이 조용히 실패한다.
for (const 나쁜것 of ['', 'abc', '0', '12', '-500', '99999999999', 'k', '1.2.3', null, undefined]) {
  check(`'${나쁜것}' 은 안 받는다`, parseSize(나쁜것) === null, String(parseSize(나쁜것)));
}

check('32k 로 줄여 적는다', fmtSize(32768) === '32k', fmtSize(32768));
check('640k 로 줄여 적는다', fmtSize(655360) === '640k', fmtSize(655360));
check('1.0M 로 줄여 적는다', fmtSize(1048576) === '1.0M', fmtSize(1048576));
check('기본값은 32768', 기본값 === 32768, String(기본값));

// ── 머리말이 제 코드와 다른 말을 하지 않는가 ────────────────────────────
//
// 이 파일의 머리말 두 줄이 코드와 어긋나 있었다. 사람은 코드보다 머리말을 먼저
// 읽고, 어긋난 머리말은 틀린 문서보다 나쁘다 — 곁에 있어서 맞는 줄 안다.
{
  const 소스 = readFileSync(new URL('../src/backend/ctxsize.js', import.meta.url), 'utf8');

  // fmtSize 머리말의 예시는 fmtSize 가 실제로 내는 글자여야 한다.
  // `33k · 655k` 라고 적혀 있었는데 1024 로 나누므로 실제는 `32k · 640k` 다.
  const 예시 = /\/\*\* *([^\n*]+?) *— *화면에 넣을 짧은 표기 *\*\//.exec(소스)?.[1] ?? '';
  const 낼수있는것 = new Set([fmtSize(32768), fmtSize(655360), fmtSize(1048576), fmtSize(999)]);
  check('★ fmtSize 머리말 예시가 실제로 나오는 글자다',
    예시.length > 0 && 예시.split('·').every((x) => 낼수있는것.has(x.trim())),
    `${예시} (실제 ${fmtSize(32768)} · ${fmtSize(655360)} · ${fmtSize(1048576)})`);

  // 기본값 머리말이 「옛날 32768 보다는」 이라고 적어 두고 값이 32768 이었다 —
  // 제 값과 저를 견주는 말이라 읽는 사람은 값이 바뀐 줄 안다.
  const 머리 = /\/\*\*?((?:[^*]|\*(?!\/))*)\*\/\s*export const 기본값 = (\d+);/.exec(소스);
  check('★ 기본값 머리말이 제 값과 저를 견주지 않는다',
    !!머리 && !new RegExp(`\\b${머리[2]}\\b`).test(머리[1]), 머리?.[1] ?? '(머리말 못 찾음)');
}

trace('2-서버모양별');

// ── 서버 종류별로 실제 응답 모양을 흉내 내 본다 ─────────────────────────
//
// 전부 이 컴퓨터 안(127.0.0.1)에서만 돈다. 밖으로 나가는 연결은 없다.
async function 띄우기(handler) {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (ch) => (body += ch));
    req.on('end', () => {
      let parsed = null;
      try { parsed = body ? JSON.parse(body) : null; } catch {}
      const r = handler(req.url.split('?')[0], parsed);
      if (!r) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, port: srv.address().port };
}

const 상황들 = [
  {
    이름: 'LM Studio — 모델 최대와 올린 길이가 다름',
    handler: (url) => {
      if (url === '/api/v0/models/qwen') {
        return { id: 'qwen', max_context_length: 655360, loaded_context_length: 32768 };
      }
      return null;
    },
    기대: { value: 32768, max: 655360, loaded: 32768 },
    왜: '올려 둔 길이가 실제로 보낼 수 있는 값이다. 최대를 믿고 보내면 거절당한다.',
  },
  {
    이름: 'LM Studio — 최대까지 올려 둠',
    handler: (url) => (url === '/api/v0/models'
      ? { data: [{ id: 'qwen', max_context_length: 655360, loaded_context_length: 655360 }] }
      : null),
    기대: { value: 655360, max: 655360, loaded: 655360 },
  },
  {
    이름: 'vLLM — 목록 안의 max_model_len',
    handler: (url) => (url === '/v1/models'
      ? { object: 'list', data: [{ id: 'qwen', object: 'model', max_model_len: 262144 }] }
      : null),
    기대: { value: 262144, max: 262144 },
  },
  {
    이름: 'llama.cpp — /props 의 n_ctx',
    handler: (url) => (url === '/props'
      ? { default_generation_settings: { n_ctx: 131072 }, total_slots: 1 }
      : null),
    기대: { value: 131072, max: 131072, loaded: 131072 },
  },
  {
    이름: '모델 상세 — context_window',
    handler: (url) => (url === '/v1/models/qwen' ? { id: 'qwen', context_window: 200000 } : null),
    기대: { value: 200000, max: 200000 },
  },
  {
    이름: '깊이 박아 둔 max_position_embeddings',
    handler: (url) => (url === '/v1/models/qwen'
      ? { id: 'qwen', meta: { config: { max_position_embeddings: 655360 } } }
      : null),
    기대: { value: 655360, max: 655360 },
    왜: '게이트웨이가 모델 config 를 그대로 물려 주는 경우가 있다.',
  },
  {
    이름: '아무 데도 안 알려 주는 서버',
    handler: (url) => (url === '/v1/models' ? { data: [{ id: 'qwen', object: 'model' }] } : null),
    기대: { value: null },
    왜: '없으면 없다고 해야 한다. 지어내면 매 요청이 조용히 실패한다.',
  },
  {
    이름: '말이 안 되는 값은 무시',
    handler: (url) => (url === '/v1/models/qwen' ? { id: 'qwen', context_length: 8 } : null),
    기대: { value: null },
    왜: '8 은 토큰 수가 아니라 다른 뜻이다. 그대로 쓰면 아무것도 못 보낸다.',
  },
];

상황들.push(
  {
    이름: '★ 답 길이 상한도 같이 긁는다',
    handler: (url) => (url === '/v1/models/qwen'
      ? { id: 'qwen', context_window: 200000, max_output_tokens: 32768 }
      : null),
    기대: { value: 200000, out: 32768 },
    왜: '컨텍스트만 보고 답 길이를 안 보면, 자리는 넉넉한데 답이 잘린다. 큰 파일이 안 만들어지는 이유가 이것이다.',
  },
  {
    이름: '답 길이를 max_completion_tokens 로 주는 서버',
    handler: (url) => (url === '/v1/models/qwen'
      ? { id: 'qwen', max_input_tokens: 128000, max_completion_tokens: 16384 }
      : null),
    기대: { value: 128000, out: 16384 },
  },
  {
    이름: 'TGI — /info 의 max_total_tokens 계열',
    handler: (url) => (url === '/info'
      ? { model_id: 'qwen', max_input_tokens: 32000, max_total_tokens: 34000 }
      : null),
    기대: { value: 32000, max: 32000 },
  },
  {
    이름: '★ 글자 덩어리 안의 값도 읽는다 (llama.cpp /props)',
    handler: (url) => (url === '/props'
      ? { default_generation_settings: 'n_ctx = 8192\nn_predict = 2048\nmodel = qwen.gguf' }
      : null),
    기대: { value: 8192, max: 8192, loaded: 8192, out: 2048 },
    왜: 'JSON 으로 안 주고 글로 주는 서버가 있다. 객체로 올 때와 똑같이 찾아야 한다.',
  },
);

for (const 상황 of 상황들) {
  const { srv, port } = await 띄우기(상황.handler);
  const base = `http://127.0.0.1:${port}/v1`;
  allowEndpoint(base);
  const r = await probeCtx({ kind: 'openai', base, auth: 'none', key: '', model: 'qwen' }, { timeout: 4000 });
  const 맞나 = Object.entries(상황.기대).every(([k, v]) => r[k] === v);
  check(상황.이름, 맞나, 맞나 ? (상황.왜 ?? '') : `받은 것 value=${r.value} max=${r.max} loaded=${r.loaded} out=${r.out}`);
  srv.close();
}

trace('2b-Ollama글자덩어리');

// ── Ollama: 진짜 올린 길이는 글자 덩어리 안에 있다 ──────────────────────
//
// 실측한 실패 그대로다.
//   /api/show → 모델 최대 131,072 · '올린 길이' 도 131,072
//               그런데 서버는 num_ctx 8192 만 받는다
//               진짜 값은 parameters 라는 글자 덩어리 안에 있어 못 봤다
//
// 그대로 믿으면 **확신에 찬 오답**이 된다 — 화면에는 "131,072 · 서버에서 읽음" 이
// 뜨고, 긴 대화에서 조용히 앞부분이 잘려 나간다. 오류도 안 난다.
{
  const { srv, port } = await 띄우기((url) => (url === '/api/show'
    ? {
      model_info: {
        'general.architecture': 'qwen3',
        'qwen3.context_length': 131072,
        'qwen3.embedding_length': 4096,
      },
      // Ollama 가 실제로 이렇게 준다 — 값이 아니라 글 한 덩어리다.
      parameters: 'num_ctx                        8192\nstop                           "<|im_end|>"\ntemperature                    0.6',
      details: { family: 'qwen3', parameter_size: '8.2B' },
    }
    : null));
  const base = `http://127.0.0.1:${port}`;
  allowEndpoint(base);
  const r = await probeCtx({ kind: 'ollama', base, auth: 'none', key: '', model: 'qwen3' }, { timeout: 4000 });

  check('★ 글자 덩어리 속 num_ctx 를 찾아낸다', r.loaded === 8192, `loaded=${r.loaded}`);
  check('★ 실제로 쓸 값은 올린 길이다', r.value === 8192, `value=${r.value} (131072 이면 조용히 잘린다)`);
  check('모델 최대는 따로 알려 준다', r.max === 131072, `max=${r.max}`);
  check('어디서 찾았는지 남긴다', /num_ctx/.test(String(r.loadedKey)), String(r.loadedKey));
  srv.close();
}

{
  // parameters 에 num_ctx 가 없으면 — 올린 길이를 모르는 것이다.
  // 그때 context_length 를 '올린 길이' 로 둔갑시키면 안 된다.
  const { srv, port } = await 띄우기((url) => (url === '/api/show'
    ? { model_info: { 'qwen3.context_length': 131072 }, parameters: 'temperature 0.6' }
    : null));
  const base = `http://127.0.0.1:${port}`;
  allowEndpoint(base);
  const r = await probeCtx({ kind: 'ollama', base, auth: 'none', key: '', model: 'qwen3' }, { timeout: 4000 });
  check('올린 길이를 모르면 모른다고 한다', r.loaded === null, `loaded=${r.loaded}`);
  check('그래도 모델 최대는 쓴다', r.value === 131072 && r.max === 131072, `value=${r.value}`);
  srv.close();
}

trace('2c-못알아냈을때');

// ── 못 알아냈으면 왜 못 알아냈는지 말해 준다 ────────────────────────────
{
  const { srv, port } = await 띄우기(() => null);
  const base = `http://127.0.0.1:${port}/v1`;
  allowEndpoint(base);
  const r = await probeCtx({ kind: 'openai', base, auth: 'none', key: '', model: 'qwen' }, { timeout: 3000 });
  check('못 알아내면 value 가 null 이다', r.value === null, String(r.value));
  check('왜 못 알아냈는지 말해 준다', typeof r.why === 'string' && r.why.length > 0, String(r.why));
  check('두드린 자리를 남긴다', r.tried.length >= 4, `${r.tried.length}곳`);
  srv.close();
}

trace('2d-누가-막았나');

// ── 「문지기가 막았다」 와 「서버가 안 준다」 는 다른 말이다 ──────────────
//
// 우리 문지기(safety/network.js)는 허락 안 한 주소를 NetBlocked 로 막는다.
// 그 판에서 서버는 이 물음을 **받아 본 적도 없다.** 그런데 여태 why 는
// 「두드린 자리에서 아무 응답도 못 받았습니다」 였고, repl 은 그걸
// 「컨텍스트를 서버가 안 알려줍니다」 로 옮겨 찍었다.
//
// 바깥 연결을 처음 붙이는 사람이 켤 때 보는 첫 문장이 이것이다. 허락을
// 아직 안 준 것뿐인데 멀쩡한 서버를 뒤지러 간다.
{
  const { resetNet } = await import('../src/safety/network.js');
  const { srv, port } = await 띄우기(() => ({ context_length: 131072 }));
  const base = `http://127.0.0.1:${port}/v1`;

  // 열어 두면 알아낸다 — 서버는 멀쩡하다는 것을 먼저 못 박는다.
  allowEndpoint(base);
  const 열렸을때 = await probeCtx({ kind: 'openai', base, auth: 'none', key: '', model: 'qwen' }, { timeout: 3000 });
  check('문을 열면 알아낸다 (서버는 멀쩡하다)', 열렸을때.value === 131072, String(열렸을때.value));

  // 같은 서버, 문만 닫는다.
  resetNet();
  const 막혔을때 = await probeCtx({ kind: 'openai', base, auth: 'none', key: '', model: 'qwen' }, { timeout: 3000 });
  check('★ 막히면 값이 없다', 막혔을때.value === null, String(막혔을때.value));
  check('★ 서버 탓으로 안 돌린다', !/응답/.test(String(막혔을때.why)), String(막혔을때.why));
  check('★ 허락이 없다고 말한다', /허락/.test(String(막혔을때.why)), String(막혔을때.why));
  check('★ 두드린 자리마다 막힘 표시가 붙는다',
    막혔을때.tried.length > 0 && 막혔을때.tried.every((t) => t.막힘 === true),
    막혔을때.tried.map((t) => `${t.label}:${t.막힘}`).join(' '));

  allowEndpoint(base);
  srv.close();
}

trace('2e-창구찾기');

// ── 404 로 **답한** 것과 아무 말도 없는 것은 다르다 ─────────────────────
//
// 여섯 자리가 전부 HTTP 404 를 돌려줬는데 화면은 「두드린 자리에서 아무 응답도
// 못 받았습니다」 였다. 사람은 서버가 죽었거나 방화벽이 삼킨 줄 알고 서버를
// 뒤진다 — 실제로는 서버가 또박또박 「그런 문은 없다」 고 말한 것이다.
{
  const { srv, port } = await 띄우기(() => null);   // 전 경로 404
  const base = `http://127.0.0.1:${port}/v1`;
  allowEndpoint(base);
  const r = await probeCtx({ kind: 'openai', base, auth: 'none', key: '', model: 'qwen' }, { timeout: 3000 });
  check('★ 전부 404 면 「응답을 못 받았다」 고 하지 않는다', !/아무 응답도 못 받았습니다/.test(String(r.why)), String(r.why));
  check('★ 받은 상태 코드를 말해 준다', /404/.test(String(r.why)), String(r.why));
  srv.close();
}

// 진짜로 아무 말도 없는 자리는 예전 그대로 말한다 (되돌아가면 안 되는 자리).
{
  const { srv, port } = await 띄우기(() => null);
  const base = `http://127.0.0.1:${port}/v1`;
  const 죽은주소 = `http://127.0.0.1:${port + 1}/v1`;   // 아무도 안 듣는 포트
  allowEndpoint(죽은주소);
  const r = await probeCtx({ kind: 'openai', base: 죽은주소, auth: 'none', key: '', model: 'qwen' }, { timeout: 3000 });
  check('닿지도 못했으면 응답을 못 받았다고 한다', /아무 응답도 못 받았습니다/.test(String(r.why)), String(r.why));
  allowEndpoint(base);
  srv.close();
}

// ── source 는 **채택한 값**이 어디서 왔는지여야 한다 ────────────────────
//
// 모델 상세가 최대 655,360 을, LM Studio 가 올린 길이 8,192 를 줬다. 쓰는 값은
// 8,192 인데 화면은 「모델 상세에서 읽음」 이라고 적었다 (repl.js · model.js 가
// r.source 를 그대로 찍는다). 값이 이상할 때 사람이 엉뚱한 창구를 뒤진다.
{
  const { srv, port } = await 띄우기((url) => {
    if (url === '/v1/models/qwen') return { id: 'qwen', context_window: 655360 };
    if (url === '/api/v0/models/qwen') return { id: 'qwen', loaded_context_length: 8192 };
    return null;
  });
  const base = `http://127.0.0.1:${port}/v1`;
  allowEndpoint(base);
  const r = await probeCtx({ kind: 'openai', base, auth: 'none', key: '', model: 'qwen' }, { timeout: 3000 });
  check('★ 올린 길이를 쓰면 source 도 그 창구다', r.value === 8192 && r.source === 'LM Studio',
    `value=${r.value} source=${r.source}`);
  srv.close();
}

// 올린 길이가 없으면 예전 그대로 최대를 준 창구를 적는다.
{
  const { srv, port } = await 띄우기((url) => (url === '/v1/models/qwen'
    ? { id: 'qwen', context_window: 655360 } : null));
  const base = `http://127.0.0.1:${port}/v1`;
  allowEndpoint(base);
  const r = await probeCtx({ kind: 'openai', base, auth: 'none', key: '', model: 'qwen' }, { timeout: 3000 });
  check('최대만 있으면 그 창구를 적는다', r.value === 655360 && r.source === '모델 상세', `source=${r.source}`);
  srv.close();
}

// ── 이름 앞에 뭐가 붙어 와도 올린 길이는 올린 길이다 ────────────────────
//
// `llm.n_ctx` 는 최대 쪽에서만 걸리고 올린 길이 쪽에서는 안 걸렸다. 그래서
// 같은 숫자 하나가 「모델 최대 8,192 · 올린 길이 모름」 이 됐고, /ctx 자세히 가
// 그렇게 찍었다. 객체로 오든 앞에 뭐가 붙든 잣대는 하나여야 한다.
{
  const { srv, port } = await 띄우기((url) => (url === '/v1/models/qwen'
    ? { id: 'qwen', 'llm.n_ctx': 8192 } : null));
  const base = `http://127.0.0.1:${port}/v1`;
  allowEndpoint(base);
  const r = await probeCtx({ kind: 'openai', base, auth: 'none', key: '', model: 'qwen' }, { timeout: 3000 });
  check('★ 접두사 붙은 n_ctx 도 올린 길이로 본다', r.loaded === 8192 && r.max === 8192,
    `max=${r.max} loaded=${r.loaded}`);
  check('어디서 찾았는지도 남긴다', /llm\.n_ctx/.test(String(r.loadedKey)), String(r.loadedKey));
  srv.close();
}

// 최대 쪽 이름(…context_length)이 올린 길이로 둔갑하면 안 된다 — 되돌아가면 안 되는 자리.
{
  const { srv, port } = await 띄우기((url) => (url === '/v1/models/qwen'
    ? { id: 'qwen', 'qwen3.context_length': 131072 } : null));
  const base = `http://127.0.0.1:${port}/v1`;
  allowEndpoint(base);
  const r = await probeCtx({ kind: 'openai', base, auth: 'none', key: '', model: 'qwen' }, { timeout: 3000 });
  check('접두사 붙은 context_length 는 올린 길이가 아니다', r.max === 131072 && r.loaded === null,
    `max=${r.max} loaded=${r.loaded}`);
  srv.close();
}

trace('3-Ollama');

{
  const { srv, port } = await 띄우기((url) => (url === '/api/show'
    ? { model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 262144 } }
    : null));
  const base = `http://127.0.0.1:${port}`;
  allowEndpoint(base);
  const r = await probeCtx({ kind: 'ollama', base, auth: 'none', key: '', model: 'qwen3' }, { timeout: 4000 });
  check('Ollama — 이름이 앞에 붙은 context_length 도 찾는다', r.value === 262144, String(r.value));
  srv.close();
}

trace('4-명령');

// ── /ctx 명령이 실제로 값을 바꾸고 남기는가 ─────────────────────────────
{
  const home = mkdtempSync(join(tmpdir(), 'deel-ctx-home-'));
  const root = mkdtempSync(join(tmpdir(), 'deel-ctx-root-'));
  process.env.DEEL_HOME = home;

  const { srv, port } = await 띄우기((url) => (url === '/api/v0/models/qwen'
    ? { id: 'qwen', max_context_length: 655360, loaded_context_length: 655360 }
    : null));
  const base = `http://127.0.0.1:${port}/v1`;
  allowEndpoint(base);

  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 'p',
    profiles: [{ id: 'p', name: 'p', kind: 'openai', baseUrl: base, auth: 'none', apiKey: '', model: 'qwen', ctx: 32768 }],
  }));

  const { handle } = await import('../src/commands.js');
  const { Session } = await import('../src/agent/session.js');
  const { load } = await import('../src/config.js');

  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'qwen', ctx: 32768 };
  const s = new Session(conn, { root });

  const 조용히 = async (fn) => {
    const 원래 = process.stdout.write.bind(process.stdout);
    let 모인것 = '';
    process.stdout.write = (chunk) => { 모인것 += chunk; return true; };
    try { await fn(); return 모인것; } finally { process.stdout.write = 원래; }
  };

  const out1 = await 조용히(() => handle('/ctx', s, {}));
  check('/ctx 는 지금 값을 보여 준다', /32,768/.test(out1), out1.slice(0, 60));
  check('/ctx 는 값을 바꾸지 않는다', s.conn.ctx === 32768, String(s.conn.ctx));

  await 조용히(() => handle('/ctx 655360', s, {}));
  check('/ctx 655360 이 먹는다', s.conn.ctx === 655360, String(s.conn.ctx));
  check('프로필에도 남는다', load().profiles[0].ctx === 655360, String(load().profiles[0].ctx));

  await 조용히(() => handle('/ctx 128k', s, {}));
  check('/ctx 128k 도 먹는다', s.conn.ctx === 131072, String(s.conn.ctx));

  const out2 = await 조용히(() => handle('/ctx 열두개', s, {}));
  check('못 읽는 값은 안 바꾼다', s.conn.ctx === 131072, String(s.conn.ctx));
  check('못 읽었다고 말해 준다', /못 읽었습니다/.test(out2), '');

  s.conn.ctx = 32768;
  await 조용히(() => handle('/ctx auto', s, {}));
  check('/ctx auto 가 서버 값으로 맞춘다', s.conn.ctx === 655360, String(s.conn.ctx));

  // 답 길이는 다른 축이다 — 컨텍스트를 건드리면 안 된다.
  await 조용히(() => handle('/ctx out 32k', s, {}));
  check('/ctx out 은 답 길이만 바꾼다', s.conn.maxTokens === 32768, String(s.conn.maxTokens));
  check('/ctx out 이 컨텍스트를 안 건드린다', s.conn.ctx === 655360, String(s.conn.ctx));

  // 이 값이 실제로 답 길이 상한 계산에 쓰이는가. 안 쓰이면 바꿔 봐야 소용없다.
  const { tokensFor } = await import('../src/agent/effort.js');
  const 좁을때 = tokensFor('save', 'work', { ctx: 8192, used: 0 });
  const 넓을때 = tokensFor('save', 'work', { ctx: 655360, used: 0 });
  check('컨텍스트가 커지면 답 상한도 커진다', 넓을때 > 좁을때, `${좁을때} → ${넓을때}`);

  srv.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
}

trace('5-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n컨텍스트 길이 검사  ${D}(모델에 걸린 값을 제대로 찾아 쓰는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
