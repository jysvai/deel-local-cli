// 게이트웨이/로컬서버가 "에이전트를 돌릴 수 있는지"를 실제 요청으로 확인한다.
// 각 검사는 { id, label, status, detail, ms } 를 돌려준다.
//   ok   되는 것을 확인함
//   no   안 됨 (기능에 직접 영향)
//   warn 되긴 하는데 조건이 붙음
//   skip 앞 검사가 실패해 확인 불가
import { req, headersFor, serverMessage } from './http.js';
import { probeCtx } from './ctxsize.js';
import { 눈검사메시지 } from './vision.js';

const READ_TOOL = {
  type: 'function',
  function: {
    name: 'read_file',
    description: '파일 하나의 내용을 읽는다',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '읽을 파일 경로' } },
      required: ['path'],
    },
  },
};

// 규격별 요청 만들기 — 이 함수 하나가 openai/ollama 차이를 흡수한다.
function build(shape, { model, messages, tools, stream, json, think, maxTokens = 128 }) {
  if (shape === 'ollama') {
    const body = { model, messages, stream: !!stream, options: { num_predict: maxTokens } };
    if (tools) body.tools = tools;
    if (json) body.format = json;
    if (think !== undefined) body.think = think;
    return { path: '/api/chat', body };
  }
  const body = { model, messages, stream: !!stream, max_tokens: maxTokens };
  if (tools) { body.tools = tools; body.tool_choice = 'auto'; }
  if (json) {
    body.response_format = { type: 'json_schema', json_schema: { name: 'probe', schema: json, strict: true } };
  }
  if (think !== undefined) body.reasoning_effort = think;
  return { path: '/chat/completions', body };
}

// 응답에서 본문과 도구호출을 꺼낸다.
function extract(shape, json) {
  if (shape === 'ollama') {
    const m = json?.message ?? {};
    return { content: m.content ?? '', toolCalls: m.tool_calls ?? [], thinking: m.thinking ?? '' };
  }
  const m = json?.choices?.[0]?.message ?? {};
  return { content: m.content ?? '', toolCalls: m.tool_calls ?? [], thinking: m.reasoning_content ?? '' };
}

// 추론 모델일 때 기본 대화 칸에 덧붙일 설명.
function c_note(retried) {
  return retried ? ' (추론 모델 — 사고를 끄고 다시 물어 확인)' : ' (추론 모델)';
}

const SKIPPED = [
  ['system', '시스템 메시지'],
  ['stream', '스트리밍'],
  ['tools', '도구 호출'],
  ['toolresult', '도구 결과 되돌리기'],
  ['json', '구조적 출력'],
  ['vision', '그림 보기'],
  ['think', '추론 강도 조절'],
  ['ctx', '컨텍스트 길이'],
];

export async function probe(conn, onStep = () => {}) {
  const { kind: shape, base, auth, model } = conn;
  const key = conn.key ?? '';
  const H = () => headersFor(auth, key);
  const url = (p) => `${base}${p}`;
  const results = [];
  const facts = { shape, base, auth, model };

  const add = (r) => { results.push(r); onStep(r); return r; };
  const call = (opts) => {
    const { path, body } = build(shape, { model, ...opts });
    return req(url(path), {
      method: 'POST',
      headers: H(),
      body,
      timeout: opts.timeout ?? 60000,
      stream: opts.stream,
    });
  };

  // 1. 기본 대화 — 이게 안 되면 나머지는 볼 필요가 없다.
  //    추론 모델은 본문이 전부 thinking 으로 가고 토큰 상한에 잘린다.
  //    그걸 "안됨"으로 볼 수 없으므로, 사고를 끄고 넉넉히 한 번 더 물어본다.
  const ASK = { messages: [{ role: 'user', content: '1+1은? 숫자만 답하세요.' }] };
  let basic = await call({ ...ASK, maxTokens: 256 });
  let got = basic.ok ? extract(shape, basic.json) : { content: '', thinking: '' };
  let thinkingModel = false;
  let retried = false;

  if (basic.ok && !got.content && got.thinking) {
    thinkingModel = true;
    retried = true;
    const second = await call({ ...ASK, maxTokens: 1024, think: false, timeout: 90000 });
    if (second.ok) {
      const e2 = extract(shape, second.json);
      if (e2.content) { basic = second; got = e2; }
      else {
        // 사고를 못 끄는 서버 — 상한만 크게 올려 한 번 더.
        const third = await call({ ...ASK, maxTokens: 2048, timeout: 120000 });
        if (third.ok && extract(shape, third.json).content) { basic = third; got = extract(shape, third.json); }
      }
    }
  }

  const basicText = got.content;
  const basicOk = basic.ok && !!basicText;
  facts.thinkingModel = thinkingModel;
  // 사고를 끌 수 있는 모델이면 이후 검사에서 꺼서 토큰과 시간을 아낀다.
  const quiet = shape === 'ollama' && thinkingModel ? { think: false, maxTokens: 512 } : {};

  add({
    id: 'chat',
    label: '기본 대화',
    status: basicOk ? 'ok' : 'no',
    detail: basicOk
      ? `응답 "${basicText.trim().slice(0, 24)}"` + (thinkingModel ? c_note(retried) : '')
      : basic.ok
        ? got.thinking
          ? '사고만 나오고 본문이 안 나옵니다 — 토큰 상한을 크게 올려야 합니다'
          : '응답이 비어 있습니다 — 모델 이름을 확인하세요'
        : serverMessage(basic),
    ms: basic.ms,
  });
  if (!basicOk) {
    for (const [id, label] of SKIPPED) {
      add({ id, label, status: 'skip', detail: '기본 대화가 안 되어 확인 불가', ms: 0 });
    }
    return { facts, results };
  }

  // 2. 시스템 메시지 — 규칙과 스킬이 먹느냐가 여기 달렸다.
  const sys = await call({
    ...quiet,
    messages: [
      { role: 'system', content: '너는 무슨 질문을 받든 정확히 DEEL 한 단어만 답한다.' },
      { role: 'user', content: '안녕하세요' },
    ],
  });
  const sysHit = sys.ok && /DEEL/i.test(extract(shape, sys.json).content);
  add({
    id: 'system',
    label: '시스템 메시지',
    status: sys.ok ? (sysHit ? 'ok' : 'warn') : 'no',
    detail: sys.ok
      ? sysHit ? '지시를 따름' : '전달은 되나 모델이 잘 안 따름 — 규칙·스킬이 약하게 적용됩니다'
      : serverMessage(sys),
    ms: sys.ms,
  });

  // 3. 스트리밍 — 화면이 한 글자씩 흐르느냐.
  const st = await call({
    ...quiet,
    messages: [{ role: 'user', content: '1부터 20까지 세어보세요.' }],
    stream: true,
    timeout: 45000,
  });
  let chunks = 0;
  let firstMs = 0;
  if (st.ok && st.res?.body) {
    const t0 = Date.now();
    try {
      const reader = st.res.body.getReader();
      const dec = new TextDecoder();
      while (chunks < 400) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = dec.decode(value, { stream: true });
        const hits = (text.match(/(^|\n)data:|"done"\s*:/g) ?? []).length;
        if (hits && !firstMs) firstMs = Date.now() - t0;
        chunks += hits || (text.trim() ? 1 : 0);
      }
      reader.cancel().catch(() => {});
    } catch {}
  }
  add({
    id: 'stream',
    label: '스트리밍',
    status: chunks > 2 ? 'ok' : st.ok ? 'warn' : 'no',
    detail: chunks > 2
      ? `조각 ${chunks}개, 첫 응답 ${firstMs}ms`
      : st.ok ? '한 번에 옵니다 — 화면은 스피너로 대체합니다' : serverMessage(st),
    ms: st.ms,
  });
  facts.streaming = chunks > 2;

  // 4. 도구 호출 — 에이전트의 생사가 걸린 검사.
  const tl = await call({
    ...quiet,
    messages: [{ role: 'user', content: 'config.json 파일을 읽어 주세요.' }],
    tools: [READ_TOOL],
    maxTokens: 512,
    timeout: 90000,
  });
  const tcalls = tl.ok ? extract(shape, tl.json).toolCalls : [];
  const gotCall = tcalls.length > 0;
  const argOk = gotCall && JSON.stringify(tcalls[0]?.function?.arguments ?? '').includes('config');
  add({
    id: 'tools',
    label: '도구 호출',
    status: gotCall ? (argOk ? 'ok' : 'warn') : 'no',
    detail: gotCall
      ? `${tcalls[0]?.function?.name} 호출됨${argOk ? '' : ' — 인자가 부정확, 편집 신뢰성 작업이 더 필요합니다'}`
      : tl.ok ? '도구를 안 부르고 글로만 답합니다' : serverMessage(tl),
    ms: tl.ms,
  });
  facts.tools = gotCall;

  // 5. 도구 결과 되돌리기 — 여러 턴이 이어지느냐. 에이전트 루프의 전제다.
  if (gotCall) {
    const tc = tcalls[0];
    const callId = tc.id ?? 'call_1';
    const assistantMsg = shape === 'ollama'
      ? { role: 'assistant', content: '', tool_calls: tcalls }
      : { role: 'assistant', content: null, tool_calls: [{ id: callId, type: 'function', function: tc.function }] };
    const toolMsg = shape === 'ollama'
      ? { role: 'tool', tool_name: tc.function?.name, content: '{"port": 7099}' }
      : { role: 'tool', tool_call_id: callId, content: '{"port": 7099}' };
    const rt = await call({
      ...quiet,
      timeout: 90000,
      messages: [
        { role: 'user', content: 'config.json 파일을 읽어 주세요.' },
        assistantMsg,
        toolMsg,
        { role: 'user', content: 'port 값이 몇인가요? 숫자만 답하세요.' },
      ],
      tools: [READ_TOOL],
      maxTokens: 256,
    });
    const said = rt.ok ? extract(shape, rt.json).content : '';
    add({
      id: 'toolresult',
      label: '도구 결과 되돌리기',
      status: rt.ok ? (/7099/.test(said) ? 'ok' : 'warn') : 'no',
      detail: rt.ok
        ? /7099/.test(said) ? '결과를 읽고 이어서 답함' : `받긴 하나 활용이 약함 ("${said.trim().slice(0, 20)}")`
        : serverMessage(rt),
      ms: rt.ms,
    });
  } else {
    add({ id: 'toolresult', label: '도구 결과 되돌리기', status: 'skip', detail: '도구 호출이 안 되어 확인 불가', ms: 0 });
  }

  // 6. 구조적 출력 — 편집 형식을 강제할 수 있느냐.
  const schema = {
    type: 'object',
    properties: { answer: { type: 'number' } },
    required: ['answer'],
    additionalProperties: false,
  };
  // 한 번은 흔들릴 수 있으므로 실패하면 한 번만 더 본다.
  let js = null;
  let parsed = null;
  let raw = '';
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    js = await call({
      ...quiet,
      messages: [{ role: 'user', content: '3 곱하기 7은?' }],
      json: schema,
      maxTokens: 512,
      timeout: 90000,
    });
    if (!js.ok) break;
    raw = extract(shape, js.json).content ?? '';
    try { parsed = JSON.parse(raw); } catch {}
  }
  const jsonOk = !!(parsed && 'answer' in parsed);
  add({
    id: 'json',
    label: '구조적 출력',
    status: jsonOk ? 'ok' : js?.ok ? 'warn' : 'no',
    detail: jsonOk
      ? `스키마대로 반환 (answer=${parsed.answer})`
      : js?.ok
        ? `스키마를 안 지킴 — 받은 값 ${JSON.stringify(raw.slice(0, 60))} · 편집 형식을 프롬프트로 강제합니다`
        : serverMessage(js ?? {}),
    ms: js?.ms ?? 0,
  });
  facts.json = jsonOk;

  /*
   * 6.5 그림 — 이 모델이 그림을 볼 수 있느냐.
   *
   * 이름으로 짐작하지 않는다. 사내 게이트웨이는 `gpt-4o` 라는 이름 뒤에
   * 무엇이든 걸어 둘 수 있고, 로컬에 받아 둔 llava 계열은 이름이 제각각이다.
   * 한 번 물어보면 확실해지는 것을 짐작할 이유가 없다.
   *
   * 흰 점 하나짜리 1×1 PNG 로 묻는다 (vision.js). 무엇이 찍혀 있을지 모르는
   * 진짜 화면을 확인하자고 바깥으로 내보낼 수는 없다.
   *
   * 답의 내용은 안 본다. 흰 점 하나를 보고 무슨 말을 하든 상관없고, 우리가
   * 알고 싶은 것은 **서버가 그림이 든 메시지를 받아 주느냐** 하나다.
   * 못 받는 서버는 400 이나 415 로 거절한다.
   */
  const 눈 = await call({
    ...quiet,
    messages: [눈검사메시지(shape)],
    maxTokens: 32,
    timeout: 60000,
  });
  const 눈있음 = !!(눈.ok && extract(shape, 눈.json).content);
  add({
    id: 'vision',
    label: '그림 보기',
    status: 눈있음 ? 'ok' : 눈.ok ? 'warn' : 'no',
    detail: 눈있음
      ? `1×1 PNG 를 받아서 답함 — Read·@ 로 화면 사진을 보여 줄 수 있습니다`
      : 눈.ok
        ? '그림을 받긴 했는데 답이 비었습니다 — 안 보이는 것으로 칩니다'
        : `${serverMessage(눈)} — 그림은 안 보냅니다`,
    ms: 눈.ms ?? 0,
  });
  facts.vision = 눈있음;

  // 7. 추론 강도 조절 — 낮음/높음이 실제로 다른 결과를 내느냐.
  //    상한에 걸리면 둘 다 같은 숫자가 나와 비교가 무의미해진다. 넉넉히 준다.
  const THINK_CAP = 1500;
  const seen = [];
  for (const lv of ['low', 'high']) {
    const r = await call({
      messages: [{ role: 'user', content: '17 곱하기 23은? 계산 과정을 보이세요.' }],
      think: lv,
      maxTokens: THINK_CAP,
      timeout: 120000,
    });
    if (r.ok) {
      const e = extract(shape, r.json);
      seen.push({
        lv,
        ms: r.ms,
        thought: (e.thinking ?? '').length,
        out: r.json?.usage?.completion_tokens ?? r.json?.eval_count ?? 0,
        capped: (r.json?.done_reason ?? r.json?.choices?.[0]?.finish_reason) === 'length',
      });
    } else {
      seen.push({ lv, ms: r.ms, err: serverMessage(r) });
    }
  }
  const bothOk = seen.every((s) => !s.err);
  const capped = bothOk && seen.every((s) => s.capped);
  // 사고 길이가 눈에 띄게 다르거나, 출력량이 20% 넘게 차이나야 "먹는다"고 본다.
  const thoughtGap = bothOk ? Math.abs(seen[0].thought - seen[1].thought) : 0;
  const outGap = bothOk ? Math.abs(seen[0].out - seen[1].out) : 0;
  const differs = bothOk && !capped &&
    (thoughtGap > Math.max(80, seen[0].thought * 0.2) || outGap > Math.max(20, seen[0].out * 0.2));
  const fmt = (s) => `${s.lv === 'low' ? '낮음' : '높음'} 사고 ${s.thought}자/출력 ${s.out}토큰/${s.ms}ms`;
  add({
    id: 'think',
    label: '추론 강도 조절',
    status: !bothOk ? 'no' : capped ? 'warn' : differs ? 'ok' : 'warn',
    detail: !bothOk
      ? `파라미터 거부됨 — ${seen.find((s) => s.err)?.err}`
      : capped
        ? `둘 다 토큰 상한(${THINK_CAP})에 걸려 비교 불가 — 루프 층에서 조절합니다`
        : differs
          ? `${fmt(seen[0])} · ${fmt(seen[1])}`
          : `차이 없음 (${fmt(seen[0])} · ${fmt(seen[1])}) — 루프 층에서 조절합니다`,
    ms: seen.reduce((a, s) => a + (s.ms ?? 0), 0),
  });
  facts.think = differs;

  // 8. 컨텍스트 길이 — 파일을 몇 개까지 한 번에 읽힐 수 있느냐.
  //
  // 한 자리만 보지 않는다. 서버마다 이름도 자리도 다르다 (ctxsize.js 참고).
  // 여기서 작게 잡으면 프로그램 전체가 작아진다 — 답 길이 상한까지 이 값에서 나온다.
  const 길이 = await probeCtx({ kind: shape, base, auth, key, model });
  const ctx = 길이.value;
  add({
    id: 'ctx',
    label: '컨텍스트 길이',
    status: ctx ? 'ok' : 'warn',
    detail: ctx
      ? `${ctx.toLocaleString()} 토큰 (${길이.source ?? '모델 정보'}에서 읽음)`
        + (길이.max && 길이.loaded && 길이.max > 길이.loaded
          ? ` · 이 모델은 ${길이.max.toLocaleString()} 까지 되는데 지금 ${길이.loaded.toLocaleString()} 로 올려 두셨습니다`
          : '')
      : '서버가 알려주지 않음 — /ctx 로 직접 지정하세요',
    ms: 0,
  });
  facts.ctx = ctx;
  facts.ctxMax = 길이.max ?? null;
  facts.ctxLoaded = 길이.loaded ?? null;

  return { facts, results };
}
