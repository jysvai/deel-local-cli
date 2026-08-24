// 규격 차이(OpenAI 호환 / Ollama)를 여기 한 곳에서만 흡수한다.
// 진단(probe)과 에이전트 루프가 같은 함수를 쓴다.
import { req, headersFor, serverMessage, Aborted } from './http.js';

export function endpoint(shape) {
  return shape === 'ollama' ? '/api/chat' : '/chat/completions';
}

export function buildBody(shape, { model, messages, tools, stream, json, think, maxTokens = 4096 }) {
  if (shape === 'ollama') {
    const body = { model, messages, stream: !!stream, options: { num_predict: maxTokens } };
    if (tools?.length) body.tools = tools;
    if (json) body.format = json;
    if (think !== undefined) body.think = think;
    return body;
  }
  const body = { model, messages, stream: !!stream, max_tokens: maxTokens };
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }
  if (json) {
    body.response_format = { type: 'json_schema', json_schema: { name: 'out', schema: json, strict: true } };
  }
  if (think !== undefined && think !== false) body.reasoning_effort = think;
  return body;
}

export function extractMessage(shape, json) {
  if (shape === 'ollama') {
    const m = json?.message ?? {};
    return {
      content: m.content ?? '',
      thinking: m.thinking ?? '',
      toolCalls: normalizeCalls(m.tool_calls ?? []),
      usage: { in: json?.prompt_eval_count ?? 0, out: json?.eval_count ?? 0 },
      stopped: json?.done_reason ?? null,
    };
  }
  const m = json?.choices?.[0]?.message ?? {};
  return {
    content: m.content ?? '',
    thinking: m.reasoning_content ?? '',
    toolCalls: normalizeCalls(m.tool_calls ?? []),
    usage: { in: json?.usage?.prompt_tokens ?? 0, out: json?.usage?.completion_tokens ?? 0 },
    stopped: json?.choices?.[0]?.finish_reason ?? null,
  };
}

// 도구 호출을 한 가지 모양으로 맞춘다: { id, name, args(객체) }
function normalizeCalls(list) {
  return list.map((tc, i) => {
    const fn = tc.function ?? tc;
    let args = fn.arguments ?? fn.args ?? {};
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { args = { _raw: args }; }
    }
    return { id: tc.id ?? `call_${i + 1}`, name: fn.name, args };
  });
}

// 대화 이력에 되돌려 넣을 메시지 만들기 — 규격마다 모양이 다르다.
export function assistantMessage(shape, { content = '', thinking = '', toolCalls = [] }) {
  if (shape === 'ollama') {
    const m = { role: 'assistant', content };
    if (thinking) m.thinking = thinking;
    if (toolCalls.length) m.tool_calls = toolCalls.map((t) => ({ function: { name: t.name, arguments: t.args } }));
    return m;
  }
  const m = { role: 'assistant', content: content || null };
  if (toolCalls.length) {
    m.tool_calls = toolCalls.map((t) => ({
      id: t.id, type: 'function',
      function: { name: t.name, arguments: JSON.stringify(t.args) },
    }));
  }
  return m;
}

export function toolMessage(shape, { callId, name, content }) {
  return shape === 'ollama'
    ? { role: 'tool', tool_name: name, content: String(content) }
    : { role: 'tool', tool_call_id: callId, content: String(content) };
}

// 한 번에 받기.
export async function chat(conn, opts) {
  const body = buildBody(conn.kind, { model: conn.model, ...opts });
  const r = await req(`${conn.base}${endpoint(conn.kind)}`, {
    method: 'POST',
    headers: headersFor(conn.auth, conn.key ?? ''),
    body,
    timeout: opts.timeout ?? 300000,
    signal: opts.signal ?? null,
  });
  if (!r.ok) throw new Error(serverMessage(r));
  return extractMessage(conn.kind, r.json);
}

// 흘려 받기. { type:'thinking'|'content', text } 를 내보내고 마지막에 { type:'done', message } 를 준다.
export async function* chatStream(conn, opts) {
  const body = buildBody(conn.kind, { model: conn.model, ...opts, stream: true });
  const r = await req(`${conn.base}${endpoint(conn.kind)}`, {
    method: 'POST',
    headers: headersFor(conn.auth, conn.key ?? ''),
    body,
    timeout: opts.timeout ?? 300000,
    stream: true,
    signal: opts.signal ?? null,
  });
  if (!r.ok || !r.res?.body) throw new Error(r.error ?? `HTTP ${r.status}`);

  const acc = { content: '', thinking: '', toolCalls: [], usage: { in: 0, out: 0 }, stopped: null };
  const reader = r.res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    // 사용자가 끊었으면 흘러오는 것을 더 받지 않는다. 읽던 연결도 닫는다.
    if (opts.signal?.aborted) {
      try { await reader.cancel(); } catch {}
      throw new Aborted();
    }
    let done;
    let value;
    try { ({ done, value } = await reader.read()); }
    catch (err) { if (opts.signal?.aborted) throw new Aborted(); throw err; }
    if (done) break;
    buf += dec.decode(value, { stream: true });

    // OpenAI 는 SSE(data: ...), Ollama 는 줄바꿈 JSON. 둘 다 줄 단위로 처리된다.
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
      if (payload === '[DONE]') continue;
      let obj;
      try { obj = JSON.parse(payload); } catch { continue; }
      for (const ev of absorb(conn.kind, obj, acc)) yield ev;
    }
  }
  yield { type: 'done', message: acc };
}

// 조각 하나를 누적하고, 화면에 흘릴 것만 내보낸다.
function absorb(shape, obj, acc) {
  const out = [];
  if (shape === 'ollama') {
    const m = obj.message ?? {};
    if (m.thinking) { acc.thinking += m.thinking; out.push({ type: 'thinking', text: m.thinking }); }
    if (m.content) { acc.content += m.content; out.push({ type: 'content', text: m.content }); }
    if (m.tool_calls?.length) acc.toolCalls.push(...normalizeCalls(m.tool_calls));
    if (obj.done) {
      acc.usage = { in: obj.prompt_eval_count ?? 0, out: obj.eval_count ?? 0 };
      acc.stopped = obj.done_reason ?? 'stop';
    }
    return out;
  }
  const d = obj.choices?.[0]?.delta ?? {};
  if (d.reasoning_content) { acc.thinking += d.reasoning_content; out.push({ type: 'thinking', text: d.reasoning_content }); }
  if (d.content) { acc.content += d.content; out.push({ type: 'content', text: d.content }); }
  if (d.tool_calls?.length) mergeDeltaCalls(acc, d.tool_calls);
  if (obj.usage) acc.usage = { in: obj.usage.prompt_tokens ?? 0, out: obj.usage.completion_tokens ?? 0 };
  const fin = obj.choices?.[0]?.finish_reason;
  if (fin) acc.stopped = fin;
  return out;
}

// OpenAI 스트리밍은 도구 호출 인자를 글자 단위로 쪼개 보낸다. 인덱스별로 이어 붙인다.
function mergeDeltaCalls(acc, deltas) {
  acc._raw ??= [];
  for (const d of deltas) {
    const i = d.index ?? 0;
    acc._raw[i] ??= { id: d.id, name: '', args: '' };
    if (d.id) acc._raw[i].id = d.id;
    if (d.function?.name) acc._raw[i].name += d.function.name;
    if (d.function?.arguments) acc._raw[i].args += d.function.arguments;
  }
  acc.toolCalls = acc._raw.filter(Boolean).map((c, i) => {
    let args = {};
    try { args = c.args ? JSON.parse(c.args) : {}; } catch { args = { _raw: c.args }; }
    return { id: c.id ?? `call_${i + 1}`, name: c.name, args };
  });
}
