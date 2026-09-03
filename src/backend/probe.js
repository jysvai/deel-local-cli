// 게이트웨이/로컬서버가 "에이전트를 돌릴 수 있는지"를 실제 요청으로 확인한다.
// 각 검사는 { id, label, status, detail, ms } 를 돌려준다.
//   ok   되는 것을 확인함
//   no   안 됨 (기능에 직접 영향)
//   warn 되긴 하는데 조건이 붙음
//   skip 앞 검사가 실패해 확인 불가
import { req, headersFor, serverMessage } from './http.js';
import { probeCtx } from './ctxsize.js';
import { 눈검사메시지 } from './vision.js';
import {
  주소붙이기, endpoint, 더할머리, buildBody, extractMessage,
  assistantMessage, toolMessage,
} from './adapter.js';
import { 벤더 } from './toolfit.js';

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

/*
 * ── 규격 차이는 여기서 흡수하지 않는다 ──────────────────────────────────
 *
 * 여기에 build() 와 extract() 가 따로 있었다. 그 둘이 아는 규격은 `ollama` 와
 * 「나머지 = OpenAI」 **둘뿐**이었고, `anthropic` 은 「나머지」 로 떨어졌다.
 * 그래서 Claude 를 직접 붙이면 진단이 이렇게 갔다 —
 *
 *   · 판 머리(anthropic-version)를 안 얹는다 → 그 하나로 400
 *   · 문 이름이 /chat/completions (있어야 할 것은 /messages)
 *   · 시킴말이 messages 안으로 들어간다 → 「모르는 역할」
 *   · 도구가 {type:'function', function:{…}} 모양으로 간다
 *   · 답을 choices[0].message 에서 찾는다 (실제로는 content 블록 배열)
 *
 * 첫 칸(기본 대화)이 400 으로 죽으면 나머지 일곱 칸은 전부 「확인 불가」 로
 * 건너뛴다. 그 결과 `deel setup` 이 저장하는 프로필에 streaming·tools·json·
 * vision 이 **다 false** 로 적힌다 — Claude 를 붙였는데 도구를 아예 안 쓰는
 * 연결이 만들어진다. 붙기는 붙으니 아무도 고장이라고 생각하지 않는다.
 *
 * adapter.js 첫 줄은 처음부터 "진단(probe)과 에이전트 루프가 같은 함수를
 * 쓴다" 고 적어 두었다. 실제로는 안 썼다. 이제 쓴다 — 규격이 넷째가 되어도
 * 이 파일은 안 고쳐도 된다.
 */

/** 이 회사가 무엇을 받는지까지 봐야 몸통이 맞다 (toolfit.js 의 벤더). */
function 몸통(conn, opts) {
  return buildBody(conn.kind, { model: conn.model, 회사: 벤더(conn), maxTokens: 128, ...opts });
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
  /*
   * 판 머리를 여기서도 얹는다 (adapter.js 의 더할머리).
   *
   * Anthropic 규격은 `anthropic-version` 하나가 없으면 400 이다. 열쇠가
   * 멀쩡해도 그렇다. 진단 화면은 그 400 을 「연결 실패」 로 적고, 사람은
   * 열쇠를 다시 받으러 간다 — 여덟 칸이 전부 그 한 줄 때문에 빨개진다.
   */
  const H = () => headersFor(auth, key, 더할머리(shape));
  /*
   * 물음표 뒤를 끝에 남겨야 한다 (adapter.js 의 주소붙이기).
   *
   * 이 한 줄이 예전에 `${base}${p}` 였다. Azure base 에는 `?api-version=` 이
   * 붙어 있어서, 그대로 이으면
   * `.../deployments/gpt-4o?api-version=2024-10-21/chat/completions` 가 된다.
   * 그러면 **설치 화면이 제 검사에 통째로 실패한다** — 기본 대화가 안 되니
   * 나머지 일곱 칸이 다 '확인 불가' 로 건너뛰어지고, 프로필에는 스트리밍도
   * 도구 호출도 안 된다고 적힌다. 붙기는 붙는데 반쪽짜리로 붙는다.
   */
  const url = (p) => 주소붙이기(base, p);
  const results = [];
  const facts = { shape, base, auth, model };

  const add = (r) => { results.push(r); onStep(r); return r; };
  const call = (opts) => req(url(endpoint(shape)), {
    method: 'POST',
    headers: H(),
    body: 몸통(conn, opts),
    timeout: opts.timeout ?? 60000,
    stream: opts.stream,
  });
  // 답 읽기도 루프와 같은 함수를 쓴다. 도구 부름은 { id, name, args } 로
  // 고르게 나온다 — 규격마다 다른 자리를 여기서 또 헤아리지 않는다.
  const 읽기 = (r) => extractMessage(shape, r?.json);

  // 1. 기본 대화 — 이게 안 되면 나머지는 볼 필요가 없다.
  //    추론 모델은 본문이 전부 thinking 으로 가고 토큰 상한에 잘린다.
  //    그걸 "안됨"으로 볼 수 없으므로, 사고를 끄고 넉넉히 한 번 더 물어본다.
  const ASK = { messages: [{ role: 'user', content: '1+1은? 숫자만 답하세요.' }] };
  let basic = await call({ ...ASK, maxTokens: 256 });
  let got = basic.ok ? 읽기(basic) : { content: '', thinking: '' };
  let thinkingModel = false;
  let retried = false;

  if (basic.ok && !got.content && got.thinking) {
    thinkingModel = true;
    retried = true;
    const second = await call({ ...ASK, maxTokens: 1024, think: false, timeout: 90000 });
    if (second.ok) {
      const e2 = 읽기(second);
      if (e2.content) { basic = second; got = e2; }
      else {
        // 사고를 못 끄는 서버 — 상한만 크게 올려 한 번 더.
        const third = await call({ ...ASK, maxTokens: 2048, timeout: 120000 });
        if (third.ok && 읽기(third).content) { basic = third; got = 읽기(third); }
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
  const sysHit = sys.ok && /DEEL/i.test(읽기(sys).content);
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
  const tcalls = tl.ok ? 읽기(tl).toolCalls : [];
  const gotCall = tcalls.length > 0;
  // 부름은 이미 { id, name, args } 로 고르게 나온다 (extractMessage).
  // 예전에는 여기서 OpenAI 날모양(function.arguments)을 직접 팠다 —
  // 그러면 Anthropic 은 도구를 제대로 불러도 「안 불렀다」 로 읽힌다.
  const argOk = gotCall && JSON.stringify(tcalls[0]?.args ?? '').includes('config');
  add({
    id: 'tools',
    label: '도구 호출',
    status: gotCall ? (argOk ? 'ok' : 'warn') : 'no',
    detail: gotCall
      ? `${tcalls[0]?.name} 호출됨${argOk ? '' : ' — 인자가 부정확, 편집 신뢰성 작업이 더 필요합니다'}`
      : tl.ok ? '도구를 안 부르고 글로만 답합니다' : serverMessage(tl),
    ms: tl.ms,
  });
  facts.tools = gotCall;

  // 5. 도구 결과 되돌리기 — 여러 턴이 이어지느냐. 에이전트 루프의 전제다.
  if (gotCall) {
    const tc = tcalls[0];
    const callId = tc.id ?? 'call_1';
    /*
     * 되돌려 넣는 모양도 루프와 같은 함수로 짓는다 (adapter.js).
     *
     * 여기에 규격별 갈래를 손으로 적어 두면 규격이 하나 늘 때마다 이 자리가
     * 조용히 틀린다 — Anthropic 에서는 도구 결과가 사람 차례로 가야 하는데
     * `role:'tool'` 로 보내 「모르는 역할」 을 받고 있었다.
     */
    const assistantMsg = assistantMessage(shape, { content: '', toolCalls: [tc] });
    const toolMsg = toolMessage(shape, { callId, name: tc.name, content: '{"port": 7099}' });
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
    const said = rt.ok ? 읽기(rt).content : '';
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
    raw = 읽기(js).content ?? '';
    /*
     * **객체일 때만** 읽었다고 한다.
     *
     * 답 모양을 강제하는 칸이 없는 규격(Anthropic)에서는 이 물음에 그냥
     * `21` 이라고 답한다. `JSON.parse('21')` 은 오류 없이 숫자 21 을 준다.
     * 그런데 그다음 줄이 `'answer' in parsed` 라, 숫자에 `in` 을 써서
     * **TypeError 로 진단 전체가 통째로 죽었다.** 스키마를 안 지킨 것은
     * 「구조적 출력 안 됨」 이라고 적을 일이지 프로그램이 끝날 일이 아니다.
     */
    try {
      const 읽힌것 = JSON.parse(raw);
      if (읽힌것 && typeof 읽힌것 === 'object' && !Array.isArray(읽힌것)) parsed = 읽힌것;
    } catch { /* 글로만 답하는 서버 — 아래에서 '스키마를 안 지킴' 으로 적는다 */ }
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
  const 눈있음 = !!(눈.ok && 읽기(눈).content);
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

  /*
   * 7. 추론 강도 조절 — 낮음/높음이 실제로 다른 결과를 내느냐.
   *
   * 상한에 걸리면 둘 다 같은 숫자가 나와 비교가 무의미해진다. 넉넉히 준다.
   *
   * Anthropic 규격은 여기서 상한을 더 크게 잡아야 한다. 그쪽은 강도를 말이
   * 아니라 **출력 상한 안에서 나가는 예산**으로 주는데(adapter.js 의
   * 생각예산), 1,500 으로는 답에 남길 자리를 빼고 나면 최소 예산 1,024 를
   * 못 만든다. 그러면 생각이 아예 안 켜진 채로 두 번을 부르고, 이 칸은
   * 「차이 없음」 이라고 적는다 — 켤 수 있는 모델에 대고 못 켠다고 적는 셈이다.
   */
  const THINK_CAP = shape === 'anthropic' ? 8000 : 1500;
  const seen = [];
  for (const lv of ['low', 'high']) {
    const r = await call({
      messages: [{ role: 'user', content: '17 곱하기 23은? 계산 과정을 보이세요.' }],
      think: lv,
      maxTokens: THINK_CAP,
      timeout: 120000,
    });
    if (r.ok) {
      const e = 읽기(r);
      seen.push({
        lv,
        ms: r.ms,
        thought: (e.thinking ?? '').length,
        // 토큰 수와 끝난 까닭도 규격마다 이름이 다르다. 읽는 자리를 하나로 모은다 —
        // 여기서 OpenAI 이름만 보면 Anthropic 은 늘 0 이고 늘 '안 잘림' 이 된다.
        out: e.usage?.out ?? 0,
        capped: e.stopped === 'length' || e.stopped === 'max_tokens',
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
