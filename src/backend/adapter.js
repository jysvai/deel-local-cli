// 규격 차이(OpenAI 호환 / Ollama)를 여기 한 곳에서만 흡수한다.
// 진단(probe)과 에이전트 루프가 같은 함수를 쓴다.
import { req, headersFor, serverMessage, Aborted } from './http.js';
import { 다시부를지, 기다리기, 정책고르기 } from './retry.js';

export function endpoint(shape) {
  return shape === 'ollama' ? '/api/chat' : '/chat/completions';
}

export function buildBody(shape, { model, messages, tools, stream, json, think, maxTokens = 4096, ctx = null }) {
  if (shape === 'ollama') {
    const body = { model, messages, stream: !!stream, options: { num_predict: maxTokens } };
    /*
     * 원하는 컨텍스트를 **지시한다.** 읽기만 하는 게 아니라 정해 준다.
     *
     * Ollama 는 num_ctx 를 안 보내면 제 기본값(대개 4,096 또는 8,192)으로 올린다.
     * 모델이 131,072 까지 되더라도 그렇다. 그런데 /api/show 는 131,072 라고 답한다 —
     * 그 말을 믿고 긴 대화를 보내면 앞부분이 조용히 잘려 나간다. 오류도 안 난다.
     * 모델이 앞을 잊을 뿐이라, 왜 이상한지 알아낼 방법이 없다.
     *
     * 지금까지 이 값을 **한 번도 안 보냈다.** 보내면 그 길이로 올려 준다.
     */
    if (ctx) body.options.num_ctx = ctx;
    /*
     * 모델을 내리지 말라고 말해 둔다.
     *
     * Ollama 는 5분 동안 조용하면 모델을 내린다. 다음 말을 걸면 다시 올리고
     * **대화 전체를 다시 계산한다** — 프리픽스 캐시가 통째로 사라진 것과 같다.
     * 로컬 대화는 사람이 생각하고 다른 창을 보다 돌아오는 것이라, 5분 넘게
     * 조용한 것이 오히려 보통이다. 그 복귀 첫 마디가 제일 오래 걸리는 이유가
     * 바로 이것이었다.
     *
     * -1(영원히)은 안 쓴다. 모델을 갈아탄 뒤에도 이전 모델이 램을 물고 있게
     * 되는데, 8GB 램에서는 다음 모델이 못 올라온다는 뜻이다. 한 시간이면
     * 일하는 호흡은 다 덮고, 퇴근하면 놓아 준다. DEEL_KEEP_ALIVE 로 바꾼다.
     */
    body.keep_alive = process.env.DEEL_KEEP_ALIVE || '60m';
    if (tools?.length) body.tools = tools;
    if (json) body.format = json;
    if (think !== undefined) body.think = think;
    return body;
  }
  // 출력 상한을 **두 이름으로 같이** 보낸다.
  //
  // 옛 규격은 max_tokens 하나였다. 그런데 GPT-5 계열을 붙여 놓은 게이트웨이는
  // 그 이름을 아예 안 본다 — max_completion_tokens 만 본다. 그런 서버에
  // max_tokens 만 보내면 상한이 안 걸린 것처럼 제 기본값으로 답하고, 우리가
  // 셈해 둔 자리와 어긋난다. 사용자 게이트웨이가 바로 그 경우였다.
  //
  // 둘 다 보내도 탈이 없다. 옛 서버는 모르는 이름을 무시하고, 새 서버는
  // 제가 보는 이름을 골라 쓴다. 둘 중 무엇을 보는지 우리가 알 필요가 없어진다.
  const body = { model, messages, stream: !!stream, max_tokens: maxTokens, max_completion_tokens: maxTokens };
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
  // 생각에 쓴 토큰. 이것도 출력 예산에서 나간다 — 상한이 8,000인데 생각에 6,000을
  // 쓰면 실제로 쓸 수 있는 답은 2,000뿐이다. 잘리는 이유가 여기 있을 때가 많은데,
  // 전에는 이 숫자를 읽지도 않아서 화면에도 셈에도 안 나타났다.
  const 생각 = json?.usage?.completion_tokens_details?.reasoning_tokens
    ?? json?.usage?.reasoning_tokens ?? 0;
  return {
    content: m.content ?? '',
    thinking: m.reasoning_content ?? '',
    toolCalls: normalizeCalls(m.tool_calls ?? []),
    usage: { in: json?.usage?.prompt_tokens ?? 0, out: json?.usage?.completion_tokens ?? 0, reasoning: 생각 },
    stopped: json?.choices?.[0]?.finish_reason ?? null,
  };
}

/**
 * 도구 호출을 한 가지 모양으로 맞춘다: { id, name, args(객체) }
 *
 * 인자 JSON 이 안 읽히면 **읽혔다고 치지 않는다.**
 *
 * 예전에는 조용히 { _raw: '...' } 로 바꿔 넘겼다. 그러면 도구는 file_path 가
 * 없다고 "경로가 비었습니다" 라고 답한다 — 원인과 아무 상관 없는 말이다.
 * 모델은 경로를 안 빠뜨렸다. 인자를 쓰다가 출력 한도에서 잘렸을 뿐이다.
 * 그러니 고칠 게 없다고 보고 똑같이 다시 시도하고, 또 잘린다.
 *
 * 실제로 그렇게 됐다 — "Write 경로가 비었습니다" 가 아홉 번 찍히고, 71초 동안
 * 도구를 열세 번 부르고, 컨텍스트가 다 차서 대화를 접었고, 파일은 안 생겼다.
 * 조용히 삼킨 값 하나가 그 전부를 만들었다.
 */
export function normalizeCalls(list) {
  return list.map((tc, i) => {
    const fn = tc.function ?? tc;
    let args = fn.arguments ?? fn.args ?? {};
    let 깨짐 = false;
    let 원문 = null;
    if (typeof args === 'string') {
      const s = args.trim();
      // 인자가 아예 없는 도구도 있다. 빈 것은 깨진 것이 아니다.
      if (!s) args = {};
      else {
        try { args = JSON.parse(s); }
        catch { 깨짐 = true; 원문 = args; args = {}; }
      }
    }
    const call = { id: tc.id ?? `call_${i + 1}`, name: fn.name, args };
    if (깨짐) { call.argsBroken = true; call.rawArgs = 원문; }
    return call;
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
  const body = buildBody(conn.kind, { model: conn.model, ctx: conn.ctx ?? null, ...opts });
  const 정책 = 정책고르기(conn, opts);
  for (let 시도 = 1; ; 시도++) {
    const r = await req(`${conn.base}${endpoint(conn.kind)}`, {
      method: 'POST',
      headers: headersFor(conn.auth, conn.key ?? ''),
      body,
      timeout: opts.timeout ?? 300000,
      signal: opts.signal ?? null,
    });
    if (r.ok) return extractMessage(conn.kind, r.json);
    // 잠깐 막힌 것이면 기다렸다 다시 부른다 (backend/retry.js 머리말).
    // 한 번에 받는 길은 제너레이터가 아니라 화면에 말을 못 걸어서, 부르는 쪽이
    // 준 onBackoff 로 알린다. 안 줬으면 조용히 기다린다.
    const 다시 = 다시부를지(r, 시도, 정책);
    if (!다시) throw 거절오류(r, 시도);
    opts.onBackoff?.(다시);
    await 기다리기(다시.wait, opts.signal ?? null);
  }
}

/*
 * 서버가 한 말을 그대로 달아 둔다. 루프가 이걸 읽고 한계를 배운다(backend/learn.js).
 *
 * 다시 불렀는데도 계속 막힌 것이면 **몇 번 불렀는지**도 적는다. `HTTP 429` 한 줄로는
 * 한 번 막힌 것인지 계속 막히는 것인지 알 수 없고, 그 둘은 사람이 할 일이 다르다 —
 * 앞은 그냥 다시 시키면 되고, 뒤는 할당량을 봐야 한다.
 */
function 거절오류(r, 시도) {
  const 원문 = serverMessage(r);
  let 말 = 원문;
  if (시도 > 1) {
    const 무엇 = r.status ? `HTTP ${r.status}` : (r.code ?? '연결 끊김');
    말 += `\n  ${시도}번 불렀지만 계속 막혔습니다 (${무엇}) — 잠시 뒤 다시 시키세요`;
  }
  const err = new Error(말);
  err.status = r.status;
  err.serverMessage = 원문;
  err.attempts = 시도;
  return err;
}

/*
 * 흘려 받으려다 거절당한 응답을, 한 번에 받은 것과 같은 모양으로 바꾼다.
 *
 * 거절당했으면 **본문을 읽는다.** 전에는 여기서 `HTTP 400` 만 던졌다. 스트리밍이라
 * 본문을 안 읽고 넘어간 것인데, 정작 그 본문에 답이 들어 있다 —
 *   "This model's maximum context length is 8192 tokens, however you requested 41003"
 * 사용자를 구할 수 있었던 문장이 그 자리에서 사라졌다. 화면에는 ✗ HTTP 400 한 줄만
 * 남고, 왜 그런지 알아낼 방법이 없었다.
 *
 * 실패한 응답은 흘려 받을 것도 없으니 통째로 읽어도 된다. 그리고 다시 부르기 전에
 * 반드시 읽어야 한다 — 안 읽은 몸을 두고 다음 요청을 보내면 연결이 남는다.
 */
async function 거절읽기(r) {
  const 것 = {
    ok: false, status: r.status, error: r.error ?? null, code: r.code ?? null,
    json: null, text: '', ms: r.ms, headers: r.res?.headers ?? null,
  };
  if (r.res) {
    try {
      것.text = await r.res.text();
      try { 것.json = JSON.parse(것.text); } catch { /* 글로만 오는 서버도 있다 */ }
    } catch { /* 본문마저 못 읽으면 상태 코드만으로 간다 */ }
  }
  return 것;
}

// 흘려 받기. { type:'thinking'|'content', text } 를 내보내고 마지막에 { type:'done', message } 를 준다.
export async function* chatStream(conn, opts) {
  const body = buildBody(conn.kind, { model: conn.model, ctx: conn.ctx ?? null, ...opts, stream: true });
  const 정책 = 정책고르기(conn, opts);
  let r;
  for (let 시도 = 1; ; 시도++) {
    r = await req(`${conn.base}${endpoint(conn.kind)}`, {
      method: 'POST',
      headers: headersFor(conn.auth, conn.key ?? ''),
      body,
      timeout: opts.timeout ?? 300000,
      stream: true,
      signal: opts.signal ?? null,
    });
    if (r.ok && r.res?.body) break;
    const 거절 = await 거절읽기(r);
    // 잠깐 막힌 것이면 알리고, 기다렸다, 다시 부른다. 머리말도 못 받은 자리라
    // 화면에 흘러간 글이 없다 — 그래서 여기서만 다시 부르고, 아래 읽기 도중에
    // 끊긴 것은 다시 안 부른다 (backend/retry.js 머리말).
    const 다시 = 다시부를지(거절, 시도, 정책);
    if (!다시) throw 거절오류(거절, 시도);
    yield 다시;
    await 기다리기(다시.wait, opts.signal ?? null);
  }

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
  // 인자가 안 읽히면 읽혔다고 치지 않는다 — normalizeCalls 머리말 참고.
  // 스트리밍은 마지막 조각이 안 오면 여기서 늘 깨진 채로 끝난다.
  acc.toolCalls = acc._raw.filter(Boolean).map((c, i) => {
    const call = { id: c.id ?? `call_${i + 1}`, name: c.name, args: {} };
    if (!c.args) return call;
    try { call.args = JSON.parse(c.args); }
    catch { call.argsBroken = true; call.rawArgs = c.args; }
    return call;
  });
}
