// 회사별 창구 — 같은 도구·같은 기능이 여덟 자리에서 다 도는가.
//
// ── 왜 이 파일이 따로 있나 ───────────────────────────────────────────────
//
// 지금까지의 검사는 「우리 함수가 이 모양을 내놓는가」 를 쟀다. 그것으로는
// 못 잡는 고장이 하나 있다 — **그 모양을 상대가 받느냐.** 우리가 보기에
// 멀쩡한 몸통이 회사 창구에서는 400 한 줄로 튕긴다. 그리고 400 은 화면에서
// 열쇠가 틀린 것과 구별이 안 된다. 사람은 열쇠를 다시 받으러 간다.
//
// 그래서 여기서는 **거절할 줄 아는 가짜 서버**를 회사마다 하나씩 세운다.
// 진짜 창구가 튕기는 자리에서 똑같이 튕긴다 — 이름이 규격을 어기면, 스키마에
// 못 받는 열쇠가 있으면, 판 머리가 없으면, 생각 예산이 상한을 넘으면, 모르는
// 강도 이름이 오면. 그다음 **같은 시나리오 한 벌**을 여덟 자리에 다 돌린다.
//
// ── 회사는 주소로 정해진다. 그런데 진짜 주소로는 못 보낸다 ──────────────
//
// 다듬기(toolfit)는 **주소의 호스트**로 갈린다(docs/en/releases/1.9.md).
// 그렇다고 검사가 진짜 회사 서버를 두드릴 수는 없다. 그래서 두 걸음으로 나눈다.
//
//   1. 다듬고 몸통 짓기 — 회사 주소를 단 conn 으로. 바깥으로 아무것도 안 나간다.
//   2. 그 몸통을 보내기 — 127.0.0.1 의 가짜 창구로. 포트는 0 이라 남의 것도 안 뺏는다.
//
// 이 두 걸음이 chat()/chatStream() 이 실제로 밟는 그 두 걸음과 같은지는
// 아래 「배선」 절에서 소스로 잰다 — 함수는 멀쩡한데 아무도 안 부르는 고장을
// 그 검사 하나가 막는다.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { toolSchemas } from '../src/tools/index.js';
import { 도구맞추기, 벤더, 이름되돌리기 } from '../src/backend/toolfit.js';
import {
  buildBody, extractMessage, assistantMessage, toolMessage, chatStream,
  endpoint, 더할머리, 말없이끝남, 생각예산, 강도말,
} from '../src/backend/adapter.js';
import { 그림메시지, 한점PNG } from '../src/backend/vision.js';
import { 배울것 } from '../src/backend/learn.js';
import { 할당량읽기, 아슬아슬한가, 할당량잊기 } from '../src/backend/quota.js';
import { req, headersFor } from '../src/backend/http.js';
import { allowEndpoint } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 여덟 자리 ───────────────────────────────────────────────────────────
//
// 주소는 다듬기를 갈리게 하는 데만 쓴다. 보내는 것은 전부 127.0.0.1 이다.
const 자리들 = [
  { 이름: 'L 로컬', base: 'http://127.0.0.1:1234/v1', kind: 'openai', 창구: 'openai로컬' },
  { 이름: 'O Ollama', base: 'http://127.0.0.1:11434', kind: 'ollama', 창구: 'ollama' },
  { 이름: 'A OpenAI', base: 'https://api.openai.com/v1', kind: 'openai', 창구: 'openai' },
  { 이름: 'Z Azure', base: 'https://our.openai.azure.com/openai/deployments/d?api-version=2024-10-21', kind: 'openai', 창구: 'azure' },
  { 이름: 'G Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai/', kind: 'openai', 창구: 'gemini' },
  { 이름: 'C Anthropic', base: 'https://api.anthropic.com/v1', kind: 'anthropic', 창구: 'anthropic' },
  { 이름: 'B Bedrock', base: 'https://bedrock-runtime.ap-northeast-2.amazonaws.com/v1', kind: 'anthropic', 창구: 'anthropic' },
  { 이름: 'W 게이트웨이', base: 'https://ai-gw.corp.example/v1', kind: 'openai', 창구: 'openai로컬' },
];

// ── 창구마다의 검사관 ───────────────────────────────────────────────────
//
// 받은 요청을 보고 **진짜 창구가 튕기는 자리에서 똑같이 튕긴다.** 돌려주는
// 것은 거절 사유 한 줄이고, null 이면 받았다는 뜻이다.

const 이름규칙 = /^[a-zA-Z0-9_-]{1,64}$/;

/** OpenAI 가 문서에 적어 둔 추론 강도. 여기 없는 말은 400 이다. */
const OPENAI강도 = new Set(['minimal', 'low', 'medium', 'high', 'none']);
/** Gemini 호환 창구가 받는 강도. */
const GEMINI강도 = new Set(['none', 'low', 'medium', 'high']);
/** Ollama 가 받는 think. 참·거짓이거나 단계말 셋. */
const OLLAMA생각 = new Set(['low', 'medium', 'high']);

/** Gemini 가 받는 스키마 열쇠 — 허용 목록 밖은 400 이다. */
const 제미니열쇠 = new Set([
  'type', 'format', 'description', 'nullable', 'enum', 'items', 'properties',
  'required', 'minItems', 'maxItems', 'minimum', 'maximum', 'anyOf', 'title',
  'example', 'default', 'propertyOrdering',
]);
const 제미니format = {
  string: new Set(['date-time', 'date', 'time', 'duration', 'enum']),
  number: new Set(['float', 'double']),
  integer: new Set(['int32', 'int64']),
};

function 제미니스키마검사(s, 길) {
  if (Array.isArray(s)) {
    for (const [i, x] of s.entries()) { const w = 제미니스키마검사(x, `${길}[${i}]`); if (w) return w; }
    return null;
  }
  if (!s || typeof s !== 'object') return null;
  for (const k of Object.keys(s)) {
    if (!제미니열쇠.has(k)) return `Invalid JSON payload received. Unknown name "${k}" at '${길}'`;
  }
  if (Array.isArray(s.type)) return `Invalid value at '${길}.type' (TYPE_ENUM), array`;
  if (s.format !== undefined) {
    const 받는것 = 제미니format[String(s.type)];
    if (!받는것 || !받는것.has(String(s.format))) return `Invalid value at '${길}.format' (${s.format})`;
  }
  for (const [n, v] of Object.entries(s.properties ?? {})) {
    const w = 제미니스키마검사(v, `${길}.properties.${n}`); if (w) return w;
  }
  if (s.items) { const w = 제미니스키마검사(s.items, `${길}.items`); if (w) return w; }
  if (s.anyOf) { const w = 제미니스키마검사(s.anyOf, `${길}.anyOf`); if (w) return w; }
  return null;
}

/** OpenAI 호환 창구가 공통으로 보는 자리 — 이름과 「인자는 객체」. */
function 공통도구검사(body) {
  for (const t of body.tools ?? []) {
    const f = t.function ?? t;
    if (!이름규칙.test(String(f?.name ?? ''))) {
      return `Invalid 'tools[].function.name': '${f?.name}'. Expected a string with maximum length 64 that matches '^[a-zA-Z0-9_-]+$'`;
    }
    const p = f?.parameters;
    if (p !== undefined && p?.type !== 'object') {
      return `Invalid schema for function '${f.name}': schema must be an object with 'type': 'object'`;
    }
  }
  return null;
}

const 검사관 = {
  /*
   * OpenAI 직통.
   *
   * 여기만 있는 자리 둘 —
   *   · 추론 모델은 `max_tokens` 를 **거절한다.** 게이트웨이는 모르는 이름을
   *     흘려보내지만 이쪽은 「지원 안 하는 인자」 라고 튕긴다.
   *   · 강도 이름이 제 목록에 없으면 400 이다.
   */
  openai(요청) {
    if (요청.길 !== '/v1/chat/completions') return `Unknown request URL: ${요청.길}`;
    const b = 요청.몸;
    if (b.max_tokens !== undefined) {
      return "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";
    }
    if (b.reasoning_effort !== undefined && !OPENAI강도.has(String(b.reasoning_effort))) {
      return `Invalid value: '${b.reasoning_effort}'. Supported values are: 'minimal', 'low', 'medium' and 'high'.`;
    }
    return 공통도구검사(b);
  },

  /*
   * Azure OpenAI. 옛 판이 아직 많아서 `max_tokens` 를 그대로 받는다.
   * 물음표 뒤(`?api-version=`)가 살아 있어야 하는 것도 여기서 잰다.
   */
  azure(요청) {
    if (!/^\/openai\/deployments\/d\/chat\/completions$/.test(요청.길)) return `Unknown request URL: ${요청.길}`;
    if (!요청.물음.includes('api-version=')) return 'Missing api-version query parameter';
    const b = 요청.몸;
    if (b.reasoning_effort !== undefined && !OPENAI강도.has(String(b.reasoning_effort))) {
      return `Invalid value: '${b.reasoning_effort}'`;
    }
    return 공통도구검사(b);
  },

  /* Gemini 의 OpenAI 호환 창구. 스키마 허용 목록이 좁다. */
  gemini(요청) {
    if (!요청.길.endsWith('/chat/completions')) return `Unknown request URL: ${요청.길}`;
    const b = 요청.몸;
    if (b.reasoning_effort !== undefined && !GEMINI강도.has(String(b.reasoning_effort))) {
      return `Invalid value at 'reasoning_effort' (${b.reasoning_effort})`;
    }
    const 탈 = 공통도구검사(b);
    if (탈) return 탈;
    for (const t of b.tools ?? []) {
      const f = t.function ?? t;
      const w = 제미니스키마검사(f?.parameters, `tools[].function.parameters`);
      if (w) return w;
    }
    return null;
  },

  /*
   * 로컬(llama.cpp · LM Studio · vLLM)과 사내 게이트웨이.
   *
   * 여기는 **관대하다.** 모르는 칸을 흘려보내고 `max_tokens` 도 받는다.
   * **도구 이름 규칙도 안 건다** — 이쪽은 이름을 문법(grammar) 만드는 데
   * 쓸 뿐이라 한글이 섞여도 그대로 받는다. 여기서 OpenAI 의 이름 규칙을
   * 걸면 이 검사는 「모르는 주소는 안 건드린다」 는 설계(1.9)를 어기라고
   * 요구하는 셈이 된다.
   *
   * 대신 「인자는 객체」 는 건다. 로컬 런타임은 그 스키마로 문법을 만들기
   * 때문에 객체가 아니면 도구 부름 자체가 안 만들어진다.
   */
  openai로컬(요청) {
    if (!요청.길.endsWith('/chat/completions')) return `Unknown request URL: ${요청.길}`;
    for (const t of 요청.몸.tools ?? []) {
      const f = t.function ?? t;
      const p = f?.parameters;
      if (p !== undefined && p?.type !== 'object') return `tool '${f?.name}': parameters must be an object schema`;
    }
    return null;
  },

  /*
   * Anthropic · Bedrock 게이트웨이.
   *
   * 튕기는 자리가 제일 많고, 전부 400 한 줄로 보인다. 그래서 여기 다 적어 둔다.
   */
  anthropic(요청) {
    if (요청.길 !== '/v1/messages') return `Unknown request URL: ${요청.길}`;
    if (!요청.머리['anthropic-version']) return 'anthropic-version header is required';
    const b = 요청.몸;
    if (b.max_tokens === undefined) return 'max_tokens: Field required';
    if (b.max_completion_tokens !== undefined) return 'max_completion_tokens: Extra inputs are not permitted';
    if (b.reasoning_effort !== undefined) return 'reasoning_effort: Extra inputs are not permitted';
    if (b.response_format !== undefined) return 'response_format: Extra inputs are not permitted';
    if ((b.messages ?? []).some((m) => m.role === 'system')) {
      return "messages: Unexpected role 'system'. The Messages API accepts a top-level `system` parameter, not \"system\" as an input message role.";
    }
    for (const [i, m] of (b.messages ?? []).entries()) {
      if (i && m.role === b.messages[i - 1].role) {
        return `messages: roles must alternate between "user" and "assistant", but found multiple "${m.role}" roles in a row`;
      }
      for (const blk of Array.isArray(m.content) ? m.content : []) {
        if (blk?.type === 'image_url') return 'messages: Input tag \'image_url\' found using the wrong block type';
        if (blk?.type === 'image') {
          if (blk.source?.type !== 'base64' || !blk.source?.media_type || !blk.source?.data) {
            return 'messages: image.source must be {type:"base64", media_type, data}';
          }
        }
        // 생각 블록은 서명이 없으면 안 받는다. 지어낸 서명도 안 받는다.
        if (blk?.type === 'thinking' && !blk.signature) {
          return 'messages: thinking blocks must be returned with their signature';
        }
      }
    }
    if (b.thinking !== undefined) {
      if (b.thinking?.type !== 'enabled') return 'thinking.type: Input should be \'enabled\'';
      const 예산 = Number(b.thinking.budget_tokens);
      if (!(예산 >= 1024)) return `thinking.budget_tokens: Input should be greater than or equal to 1024`;
      if (!(예산 < Number(b.max_tokens))) return 'thinking.budget_tokens must be less than max_tokens';
    }
    for (const t of b.tools ?? []) {
      if (t.function !== undefined) return 'tools: Extra inputs are not permitted (function)';
      if (!이름규칙.test(String(t?.name ?? ''))) return `tools.name: String should match pattern '^[a-zA-Z0-9_-]{1,64}$'`;
      if (t?.input_schema?.type !== 'object') return `tools.input_schema: type must be "object"`;
    }
    return null;
  },

  /*
   * Ollama 자체 규격.
   *
   * `think` 에 모르는 말이 오면 튕긴다. 그림은 `data:` 머리말을 안 받는다 —
   * 붙여 보내면 base64 로 못 읽고 그림이 통째로 사라진다.
   */
  ollama(요청) {
    if (요청.길 !== '/api/chat') return `404 page not found: ${요청.길}`;
    const b = 요청.몸;
    if (b.think !== undefined && typeof b.think !== 'boolean' && !OLLAMA생각.has(String(b.think))) {
      return `invalid think value: "${b.think}"`;
    }
    if (b.max_tokens !== undefined) return 'unknown field "max_tokens"';
    for (const m of b.messages ?? []) {
      for (const g of m.images ?? []) {
        if (String(g).startsWith('data:')) return 'invalid image data: illegal base64 data';
      }
    }
    for (const t of b.tools ?? []) {
      const f = t.function ?? t;
      if (!f?.name) return 'tools: name required';
    }
    return null;
  },
};

// ── 가짜 창구 하나 세우기 ───────────────────────────────────────────────
//
// 검사관이 통과시킨 것만 답한다. 거절은 그 회사가 쓰는 오류 모양으로 낸다 —
// 우리 쪽 serverMessage() 가 그 모양을 읽을 줄 아는지도 같이 재진다.
function 창구세우기(종류, { 답 = null, 머리 = {} } = {}) {
  const srv = createServer((r, res) => {
    let 글 = '';
    r.on('data', (c) => (글 += c));
    r.on('end', () => {
      const [길, 물음 = ''] = String(r.url).split('?');
      let 몸 = null;
      try { 몸 = JSON.parse(글 || '{}'); } catch { 몸 = null; }
      const 것 = { 길, 물음, 머리: r.headers, 몸: 몸 ?? {} };
      srv.받은것 = 것;
      const 탈 = 몸 === null ? 'invalid JSON body' : 검사관[종류](것);
      if (탈) {
        srv.거절 = 탈;
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 탈 } }));
        return;
      }
      srv.거절 = null;
      const 낼것 = typeof 답 === 'function' ? 답(것) : 답;
      res.writeHead(낼것?.코드 ?? 200, { 'content-type': 낼것?.타입 ?? 'application/json', ...머리 });
      res.end(낼것?.글 ?? JSON.stringify(기본답(종류)));
    });
  });
  return srv;
}

function 기본답(종류) {
  if (종류 === 'ollama') {
    return { message: { role: 'assistant', content: '됐습니다' }, done: true, done_reason: 'stop', prompt_eval_count: 10, eval_count: 3 };
  }
  if (종류 === 'anthropic') {
    return { content: [{ type: 'text', text: '됐습니다' }], usage: { input_tokens: 10, output_tokens: 3 }, stop_reason: 'end_turn' };
  }
  return { choices: [{ message: { role: 'assistant', content: '됐습니다' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3 } };
}

async function 세우고열기(종류, 옵션) {
  const srv = 창구세우기(종류, 옵션);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  srv.주소 = `http://127.0.0.1:${srv.address().port}`;
  return srv;
}

/*
 * chat() 이 몸통을 만드는 두 걸음을 그대로 밟는다.
 *
 * 회사는 **주소**로 갈리므로 다듬기는 회사 주소를 단 conn 으로 하고, 보내기는
 * 127.0.0.1 로 한다. 아래 「배선」 절이 chat()·chatStream() 도 정확히 이 두
 * 걸음을 밟는지를 소스로 재므로, 여기서 통과한 몸통은 실제로 나가는 몸통이다.
 */
function 몸통짓기(자리, opts) {
  const conn = { base: 자리.base, kind: 자리.kind, model: 'm-1' };
  const 맞춘것 = 도구맞추기(opts.tools ?? null, conn);
  const body = buildBody(conn.kind, {
    model: conn.model, ctx: null, ...opts, tools: 맞춘것.tools, 회사: 벤더(conn),
  });
  return { body, 되돌림: 맞춘것.되돌림, conn };
}

async function 보내보기(srv, 자리, opts) {
  const { body, 되돌림 } = 몸통짓기(자리, opts);
  const 길 = 자리.창구 === 'azure'
    ? `/openai/deployments/d${endpoint(자리.kind)}?api-version=2024-10-21`
    : (자리.kind === 'ollama' ? '/api/chat' : `/v1${endpoint(자리.kind)}`);
  const r = await req(`${srv.주소}${길}`, {
    method: 'POST',
    headers: headersFor('bearer', 'k-1', 더할머리(자리.kind)),
    body,
    timeout: 8000,
  });
  return { r, body, 되돌림, 왜: r.ok ? null : (r.json?.error?.message ?? r.text ?? `HTTP ${r.status}`) };
}

// ── 시나리오에 쓸 자료 ──────────────────────────────────────────────────

const 내장도구 = toolSchemas(null, { hasSkills: true, web: true, lsp: true, vision: true });

/*
 * MCP 서버가 실제로 주는 모양. 우리 도구에는 없는 것만 골라 담았다 —
 * 한글 이름, `$schema`, `additionalProperties`, `oneOf`, `$ref`, 모르는 format,
 * 널을 받는 갈래. 이 일곱이 다듬기가 실제로 일하는 자리다.
 */
const MCP도구 = [
  { type: 'function', function: { name: 'mcp__사내문서__검색', description: '[사내문서] 검색', parameters: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object', additionalProperties: false,
    properties: {
      url: { type: 'string', format: 'uri' },
      how: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      when: { type: 'string', format: 'date-time' },
      n: { type: ['integer', 'null'] },
    },
    required: ['url'] } } },
  { type: 'function', function: { name: 'mcp__사내문서__지우기', description: '[사내문서] 지우기', parameters: {
    type: 'object', properties: { a: { $ref: '#/definitions/A' } } } } },
];

const 모든도구 = [...내장도구, ...MCP도구];
const 사람말 = [{ role: 'user', content: '해 주세요' }];
const 시킴말 = [{ role: 'system', content: '너는 도구다' }, ...사람말];

// ═══════════════════════════════════════════════════════════════════════
trace('1-도구스키마');
// ── 1. 내장 도구 20개가 여덟 자리에서 다 받아들여지는가 ─────────────────
//
// 여기가 이 파일의 뼈대다. 도구 목록이 안 받아들여지면 그 연결에서는
// **에이전트가 아예 못 돈다** — 글만 주고받는 채팅이 된다.
{
  check('내장 도구가 스무 개다', 내장도구.length === 20, String(내장도구.length));

  for (const 자리 of 자리들) {
    const srv = await 세우고열기(자리.창구);
    allowEndpoint(srv.주소);
    const { r, 왜 } = await 보내보기(srv, 자리, { messages: 시킴말, tools: 내장도구, maxTokens: 4096 });
    check(`★ ${자리.이름}: 내장 도구 20개를 다 받는다`, r.ok, String(왜));
    srv.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════
trace('2-MCP도구');
// ── 2. MCP 스키마가 다듬어져서 통과하고, 이름이 되돌아오는가 ────────────
{
  for (const 자리 of 자리들) {
    const srv = await 세우고열기(자리.창구);
    allowEndpoint(srv.주소);
    const { r, body, 되돌림, 왜 } = await 보내보기(srv, 자리, { messages: 사람말, tools: 모든도구, maxTokens: 4096 });
    check(`★ ${자리.이름}: MCP 스키마도 받는다 ($ref·oneOf·한글 이름)`, r.ok, String(왜));

    // 이름을 고쳤으면 답에서 되돌아와야 한다. 안 되돌리면 loop.js 가
    // 모르는 도구를 받는다 — 도구가 조용히 안 불리는 고장이다.
    const 보낸이름 = (body.tools ?? []).map((t) => (t.function ?? t).name);
    const 고친것 = 보낸이름.find((n) => 되돌림?.has(n));
    if (되돌림) {
      const 되돌린것 = 이름되돌리기({ toolCalls: [{ id: 'c1', name: 고친것, args: {} }] }, 되돌림);
      check(`${자리.이름}: 고친 이름이 원래대로 돌아온다`,
        되돌린것.toolCalls[0].name === 되돌림.get(고친것), 되돌린것.toolCalls[0].name);
    } else {
      // 모르는 호스트는 안 건드린다 — 한글 이름이 그대로 나가야 맞다.
      check(`★ ${자리.이름}: 모르는 주소면 이름을 안 건드린다`,
        보낸이름.includes('mcp__사내문서__검색'), 보낸이름.slice(-2).join(' · '));
    }
    srv.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════
trace('3-추론강도');
/*
 * ── 3. 추론 강도 다섯 칸이 여덟 자리에서 다 통하는가 ────────────────────
 *
 * 우리 눈금은 다섯이다 — off·low·medium·high·max (agent/effort.js).
 * 남의 눈금은 넷이다. `max` 를 받는 창구는 하나도 없다. 그런데 `깊게` 배분을
 * 쓰면 `high` 가 첫 판단에서 한 칸 올라가 `max` 가 된다 — 사람이 `/think max`
 * 를 안 쳐도 이 자리에 닿는다는 뜻이다.
 */
{
  for (const 자리 of 자리들) {
    for (const 강도 of ['low', 'medium', 'high', 'max']) {
      const srv = await 세우고열기(자리.창구);
      allowEndpoint(srv.주소);
      const { r, 왜 } = await 보내보기(srv, 자리, { messages: 사람말, maxTokens: 8000, think: 강도 });
      check(`★ ${자리.이름}: 추론 강도 ${강도} 를 받는다`, r.ok, String(왜));
      srv.close();
    }
    // 끈 것은 아무것도 안 실어야 한다. 끄기를 실어 보내면 그것대로 400 이다.
    const srv2 = await 세우고열기(자리.창구);
    allowEndpoint(srv2.주소);
    const { r: r2, body } = await 보내보기(srv2, 자리, { messages: 사람말, maxTokens: 8000, think: undefined });
    check(`${자리.이름}: 강도를 안 정하면 칸 자체가 없다`,
      r2.ok && body.reasoning_effort === undefined && body.thinking === undefined && body.think === undefined,
      JSON.stringify({ e: body.reasoning_effort, t: body.thinking, k: body.think }));
    srv2.close();
  }

  /*
   * 옮긴 값이 무엇인지도 못 박아 둔다.
   *
   * 「받아 준다」 만 재면, 언젠가 `max` 를 통째로 빼먹는 고쳐도 그대로 초록이다.
   * 우리 눈금 다섯 중 넷은 이름이 그대로 가고, `max` 만 그 규격이 낼 수 있는
   * 제일 센 말로 선다.
   */
  check('★ max 는 그 규격의 제일 센 말이 된다', 강도말('max') === 'high', String(강도말('max')));
  check('나머지 셋은 이름이 그대로 간다',
    강도말('low') === 'low' && 강도말('medium') === 'medium' && 강도말('high') === 'high');
  check('★ 모르는 말은 아예 안 싣는다', 강도말('off') === null && 강도말('아무말') === null,
    `${강도말('off')} / ${강도말('아무말')}`);
  // Anthropic 규격은 말이 아니라 숫자 예산이라, 거기서는 max 가 진짜 max 다.
  check('★ Anthropic 규격에서는 max 가 제일 큰 예산이다',
    생각예산('max', 99999) > 생각예산('high', 99999), `${생각예산('max', 99999)} / ${생각예산('high', 99999)}`);
  // 생각을 끈 채로 Ollama 에 보내면 참·거짓이 그대로 가야 한다 (loop.js thinkFor).
  {
    const b = buildBody('ollama', { model: 'm', messages: 사람말, maxTokens: 512, think: false });
    check('★ Ollama 에 끄기(거짓)는 그대로 간다', b.think === false, JSON.stringify(b.think));
  }
}

// ═══════════════════════════════════════════════════════════════════════
trace('4-출력상한이름');
/*
 * ── 4. 출력 상한을 뭐라고 부르나 ────────────────────────────────────────
 *
 * 옛 규격은 `max_tokens` 하나였고, GPT-5 계열을 붙인 게이트웨이는
 * `max_completion_tokens` 만 본다. 그래서 게이트웨이에는 둘 다 보낸다.
 *
 * **OpenAI 직통은 다르다.** 추론 모델은 `max_tokens` 를 「지원 안 하는 인자」
 * 라고 튕긴다. 둘 다 보내면 첫 요청부터 400 이다.
 */
{
  for (const 자리 of 자리들) {
    const srv = await 세우고열기(자리.창구);
    allowEndpoint(srv.주소);
    const { r, body, 왜 } = await 보내보기(srv, 자리, { messages: 사람말, maxTokens: 4096 });
    check(`★ ${자리.이름}: 출력 상한 이름을 받아들인다`, r.ok, String(왜));
    if (자리.이름 === 'A OpenAI') {
      check('★ A OpenAI: 옛 이름을 안 싣는다', body.max_tokens === undefined, JSON.stringify(body.max_tokens));
      check('A OpenAI: 새 이름은 싣는다', body.max_completion_tokens === 4096, String(body.max_completion_tokens));
    }
    if (자리.이름 === 'W 게이트웨이') {
      // 게이트웨이는 어느 쪽을 보는지 우리가 모른다. 둘 다 보내는 것이 맞다.
      check('★ W 게이트웨이: 두 이름을 같이 싣는다',
        body.max_tokens === 4096 && body.max_completion_tokens === 4096,
        `${body.max_tokens} / ${body.max_completion_tokens}`);
    }
    srv.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════
trace('5-그림');
/*
 * ── 5. 그림 한 장이 여덟 자리에서 다 실리는가 ───────────────────────────
 *
 * `Read shot.png` 가 여기로 온다. 규격마다 모양이 다르고, 틀리면 글까지 같이
 * 안 간다 — 눈이 없는 것과 달리 대화가 아예 안 이어진다.
 */
{
  for (const 자리 of 자리들) {
    const srv = await 세우고열기(자리.창구);
    allowEndpoint(srv.주소);
    const 그림 = 그림메시지(자리.kind, { 글: '이 화면 좀 보세요', 그림들: [{ b64: 한점PNG, mime: 'image/png' }] });
    const { r, 왜 } = await 보내보기(srv, 자리, { messages: [그림], maxTokens: 512 });
    check(`★ ${자리.이름}: 그림 한 장을 받는다`, r.ok, String(왜));
    srv.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════
trace('6-도구왕복');
/*
 * ── 6. 도구 부름과 결과가 한 바퀴 도는가 ────────────────────────────────
 *
 * 도구를 **둘** 부른다. 하나만 부를 때는 되고 둘 부를 때만 안 되는 것이
 * 제일 알아내기 어려운 고장이라, 처음부터 둘로 잰다(Anthropic 은 결과 둘이
 * 연달아 사람 차례가 되어 안 합치면 통째로 거절된다).
 */
{
  const 큰결과 = 'x'.repeat(40 * 1024);   // 40KB — Bash·Grep 이 실제로 내는 크기
  for (const 자리 of 자리들) {
    const srv = await 세우고열기(자리.창구);
    allowEndpoint(srv.주소);
    const 부름 = [
      { id: 'call_1', name: 'Read', args: { file_path: 'a.txt' } },
      { id: 'call_2', name: 'Grep', args: { pattern: 'x' } },
    ];
    const messages = [
      ...사람말,
      assistantMessage(자리.kind, { content: '', toolCalls: 부름 }),
      toolMessage(자리.kind, { callId: 'call_1', name: 'Read', content: '내용' }),
      toolMessage(자리.kind, { callId: 'call_2', name: 'Grep', content: 큰결과 }),
      { role: 'user', content: '그래서요?' },
    ];
    const { r, 왜 } = await 보내보기(srv, 자리, { messages, tools: 내장도구, maxTokens: 2048 });
    check(`★ ${자리.이름}: 도구 둘을 부르고 결과 둘을 되돌려도 받는다`, r.ok, String(왜));
    srv.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════
trace('7-남은할당량');
/*
 * ── 7. 남은 할당량을 읽는가 ─────────────────────────────────────────────
 *
 * 429 를 맞고 나서 아는 것과 맞기 전에 아는 것은 사람이 할 일이 다르다.
 * 이름이 회사마다 다른데, 하나라도 못 읽으면 그 회사에서는 화면이 **언제나
 * 비어 있다** — 없는 것과 구별이 안 된다.
 */
{
  const 표 = [
    ['OpenAI·게이트웨이', {
      'x-ratelimit-remaining-requests': '9', 'x-ratelimit-limit-requests': '500',
      'x-ratelimit-remaining-tokens': '1200', 'x-ratelimit-limit-tokens': '90000',
    }],
  ];
  for (const [회사, 머리] of 표) {
    const 것 = 할당량읽기(머리);
    check(`★ ${회사}: 남은 요청 수를 읽는다`, 것.요청 === 9, String(것.요청));
    check(`${회사}: 요청 한도를 읽는다`, 것.요청한도 === 500, String(것.요청한도));
    check(`${회사}: 남은 토큰을 읽는다`, 것.토큰 === 1200, String(것.토큰));
    check(`★ ${회사}: 바닥에 가까우면 화면에 띄운다`, 아슬아슬한가(것) === true, JSON.stringify(것));
  }
  // 못 읽은 것을 0 으로 치면 안 된다 — 멀쩡한데 다 썼다고 믿게 된다.
  check('아무 머리도 없으면 「없다」 고 한다', 할당량읽기({}).있나 === false);
  할당량잊기();
}

// ═══════════════════════════════════════════════════════════════════════
trace('8-거절에서배우기');
/*
 * ── 8. 회사마다 다른 거절 문장에서 진짜 한계를 배우는가 ─────────────────
 *
 * 서버는 거절할 때 정답을 그대로 말해 준다. 그 문장이 회사마다 다르다.
 * 하나라도 잘못 읽으면 **틀린 값을 배워 프로필에 적어 두고**, 다음에 켤 때도
 * 똑같이 죽는다 (loop.js 가 배운 값을 연결저장 으로 남긴다).
 */
{
  const 표 = [
    ['OpenAI', "This model's maximum context length is 8192 tokens, however you requested 41003 tokens", 'ctx', 8192],
    ['Azure', "This model's maximum context length is 8192 tokens. However, you requested 9000 tokens.", 'ctx', 8192],
    ['Gemini', 'The input token count (1050000) exceeds the maximum number of tokens allowed (1048576).', 'ctx', 1048576],
    ['Anthropic', 'prompt is too long: 205000 tokens > 200000 maximum', 'ctx', 200000],
    ['vLLM', 'Requested tokens (41003) exceed context window of 8192', 'ctx', 8192],
    ['llama.cpp', 'input is too large to process. increase the physical batch size / n_ctx (8192)', 'ctx', 8192],
    ['LM Studio', 'Trying to keep the first 12345 tokens when context the overflows. However, the model is loaded with context length of only 8192 tokens', 'ctx', 8192],
    ['사내(한국어)', '최대 컨텍스트 8192 토큰을 넘었습니다 (요청 41003)', 'ctx', 8192],
    ['OpenAI 출력 상한', 'max_tokens is too large: 200000. This model supports at most 16384 completion tokens', 'out', 16384],
  ];
  for (const [회사, 문장, 갈래, 값] of 표) {
    const r = 배울것(문장);
    check(`★ ${회사} 의 말에서 한계를 배운다`, r?.kind === 갈래 && r?.limit === 값,
      r ? `${r.kind} ${r.limit}` : 'null');
  }

  /*
   * ★ Anthropic 의 출력 상한 문장.
   *
   *   "max_tokens: 100000 > 64000, which is the maximum allowed number of
   *    output tokens for claude-x"
   *
   * 앞 숫자는 **우리가 요청한 값**이고 뒤 숫자가 서버의 한계다. 앞을 집으면
   * 방금 거절당한 그 값을 한계로 배우고, 그대로 다시 불러 또 거절당한다.
   * 그때는 이미 배운 뒤라 두 번은 못 배우고 턴이 죽는다 — 그리고 그 값이
   * 프로필에 남아서 **다음에 켤 때도 똑같이 죽는다.**
   */
  const a = 배울것('max_tokens: 100000 > 64000, which is the maximum allowed number of output tokens for claude-x');
  check('★ Anthropic 출력 상한을 거꾸로 안 읽는다', a?.kind === 'out' && a?.limit === 64000,
    a ? `${a.kind} ${a.limit}` : 'null');
  check('★ 우리가 요청했던 값도 같이 적는다', a?.asked === 100000, String(a?.asked));

  // 이름이 새 쪽(max_completion_tokens)인 게이트웨이도 같은 모양으로 말한다.
  const b = 배울것('max_completion_tokens: 32768 > 16384 is the maximum for this deployment');
  check('새 이름으로 말해도 뒤 숫자를 집는다', b?.kind === 'out' && b?.limit === 16384,
    b ? `${b.kind} ${b.limit}` : 'null');

  /*
   * 한계를 따로 말해 주는 문장(OpenAI)은 그쪽을 집어야 한다. 앞 숫자는 여기서도
   * 우리가 요청한 값이라, 그걸 배우면 같은 죽음이 OpenAI 쪽에서도 난다.
   */
  const c = 배울것('max_tokens is too large: 200000. This model supports at most 16384 completion tokens');
  check('★ 한계를 따로 말해 준 문장은 그쪽을 집는다', c?.kind === 'out' && c?.limit === 16384,
    c ? `${c.kind} ${c.limit}` : 'null');
}

// ═══════════════════════════════════════════════════════════════════════
trace('9-흘려받기');
/*
 * ── 9. 흘려받기 — 규격 셋이 각각 끝을 알리는 방식이 다르다 ──────────────
 *
 * 여기는 진짜로 돌린다. 조각을 손으로 만들어 넣는 검사로는 「이 순서로 진짜
 * 오나」 를 못 잰다. 끝을 안 알리고 끊긴 것을 '정상 종료' 로 읽으면, 중간에서
 * 잘린 답이 온전한 답으로 지나간다.
 */
{
  const 흘리기 = (줄들, 타입) => async (req2, res) => {
    res.writeHead(200, { 'content-type': 타입 });
    for (const l of 줄들) res.write(l);
    res.end();
  };

  // OpenAI 호환 — SSE, 마지막에 [DONE].
  {
    const srv = createServer(흘리기([
      `data: ${JSON.stringify({ choices: [{ delta: { content: '이렇' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: '게' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 2 } })}\n\n`,
      'data: [DONE]\n\n',
    ], 'text/event-stream'));
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}/v1`;
    allowEndpoint(base);
    let 끝 = null;
    const 흘린것 = [];
    for await (const ev of chatStream({ kind: 'openai', base, auth: 'bearer', key: 'k', model: 'm' }, { messages: 사람말, maxTokens: 128 })) {
      if (ev.type === 'done') 끝 = ev.message; else 흘린것.push(ev);
    }
    check('★ openai 규격: 글이 흘러나오고 끝을 안다', 끝?.content === '이렇게' && 끝?.stopped === 'stop',
      `${끝?.content} / ${끝?.stopped}`);
    check('openai 규격: 토큰 수를 읽는다', 끝?.usage?.in === 7 && 끝?.usage?.out === 2, JSON.stringify(끝?.usage));
    srv.close();
  }

  // Ollama — 줄바꿈 JSON, done:true.
  {
    const srv = createServer(흘리기([
      `${JSON.stringify({ message: { content: '이렇' } })}\n`,
      `${JSON.stringify({ message: { content: '게' } })}\n`,
      `${JSON.stringify({ message: { content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 7, eval_count: 2 })}\n`,
    ], 'application/x-ndjson'));
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    allowEndpoint(base);
    let 끝 = null;
    for await (const ev of chatStream({ kind: 'ollama', base, auth: 'none', key: '', model: 'm' }, { messages: 사람말, maxTokens: 128 })) {
      if (ev.type === 'done') 끝 = ev.message;
    }
    check('★ ollama 규격: 줄바꿈 JSON 을 읽고 끝을 안다', 끝?.content === '이렇게' && 끝?.stopped === 'stop',
      `${끝?.content} / ${끝?.stopped}`);
    check('ollama 규격: 토큰 이름이 다른 것을 안다', 끝?.usage?.in === 7 && 끝?.usage?.out === 2, JSON.stringify(끝?.usage));
    srv.close();
  }

  /*
   * ★ 말없이 끊긴 것.
   *
   * 중계 프록시가 몸통을 자르고 연결을 곱게 닫으면 이 모양이 된다. 끝을 알리는
   * 조각이 하나도 안 왔는데 흘러오던 것이 그냥 멎었으면 **왜 끝났는지 모르는
   * 것**이다. 로컬 llama.cpp 앞에 nginx 를 둔 자리에서 실제로 이렇게 온다.
   */
  {
    const srv = createServer(흘리기([
      `data: ${JSON.stringify({ choices: [{ delta: { content: '하다 만' } }] })}\n\n`,
    ], 'text/event-stream'));
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}/v1`;
    allowEndpoint(base);
    let 끝 = null;
    for await (const ev of chatStream({ kind: 'openai', base, auth: 'none', key: '', model: 'm' }, { messages: 사람말, maxTokens: 128 })) {
      if (ev.type === 'done') 끝 = ev.message;
    }
    check('★ 끝을 안 알리고 끊긴 것을 정상 종료로 안 친다', 끝?.stopped === 말없이끝남, String(끝?.stopped));
    check('그래도 여태 온 글은 안 버린다', 끝?.content === '하다 만', String(끝?.content));
    srv.close();
  }

  /*
   * ★ 429 + retry-after → 한 번 기다렸다 다시.
   *
   * 사내 게이트웨이는 사람마다 할당량을 걸어서 이걸 자주 준다. 다시 안 부르면
   * 그 턴이 통째로 죽고, 읽어 둔 도구 결과가 날아간다.
   */
  {
    let 몇번 = 0;
    const srv = createServer((r2, res) => {
      r2.on('data', () => {});
      r2.on('end', () => {
        몇번++;
        if (몇번 === 1) {
          res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0', 'x-ratelimit-remaining-requests': '0' });
          res.end(JSON.stringify({ error: { message: 'Rate limit reached' } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '됐' } }, ] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.end();
      });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}/v1`;
    allowEndpoint(base);
    let 끝 = null;
    let 물러선것 = null;
    for await (const ev of chatStream(
      { kind: 'openai', base, auth: 'none', key: '', model: 'm', retry: { 최대: 3, base: [1, 1, 1], 흔들림: 0, 상한: 50 } },
      { messages: 사람말, maxTokens: 128 },
    )) {
      if (ev.type === 'done') 끝 = ev.message;
      else if (ev.type === 'backoff') 물러선것 = ev;
    }
    check('★ 429 를 맞으면 기다렸다 한 번 더 부른다', 몇번 === 2 && 끝?.content === '됐', `${몇번}번 · ${끝?.content}`);
    check('물러섰다는 것을 화면에 알린다', 물러선것?.status === 429, JSON.stringify(물러선것?.status));
    srv.close();
    할당량잊기();
  }
}

// ═══════════════════════════════════════════════════════════════════════
trace('10-배선');
/*
 * ── 10. 위에서 잰 두 걸음이 실제로 나가는 길인가 ────────────────────────
 *
 * 위 시나리오들은 도구맞추기() → buildBody() 를 손으로 밟았다. 그것만으로는
 * 「함수는 멀쩡한데 chat() 이 안 부른다」 를 못 잡는다. 그 고장은 오류를 안
 * 내고 도구만 조용히 안 불리는, 제일 알아내기 어려운 종류다. 그래서 소스로 잰다.
 */
{
  const ad = readFileSync(new URL('../src/backend/adapter.js', import.meta.url), 'utf8');
  const 다듬는자리 = [...ad.matchAll(/도구맞추기\(opts\.tools, conn\)/g)];
  check('★ 보내는 길 둘이 다 도구맞추기() 를 지난다', 다듬는자리.length === 2, `${다듬는자리.length}자리`);

  const 몸통자리 = [...ad.matchAll(/buildBody\(conn\.kind, \{([\s\S]*?)\}\)/g)].map((m) => m[1]);
  check('★ 몸통 짓는 자리 둘이 다 다듬은 목록을 쓴다',
    몸통자리.length === 2 && 몸통자리.every((x) => /tools: 맞춘것\.tools/.test(x)),
    `${몸통자리.length}자리`);
  check('★ 몸통 짓는 자리 둘이 다 회사를 같이 넘긴다',
    몸통자리.length === 2 && 몸통자리.every((x) => /회사: 벤더\(conn\)/.test(x)),
    몸통자리.map((x) => (/회사:/.test(x) ? 'o' : 'x')).join(''));

  const 되돌리는자리 = [...ad.matchAll(/이름되돌리기\(/g)];
  check('★ 받는 길 둘이 다 이름을 되돌린다', 되돌리는자리.length === 2, `${되돌리는자리.length}자리`);
}

// ═══════════════════════════════════════════════════════════════════════
trace('11-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n회사별 창구 검사  ${D}(같은 도구·같은 기능이 여덟 자리에서 다 도는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
