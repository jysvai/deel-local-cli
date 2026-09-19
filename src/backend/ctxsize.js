// 모델이 한 번에 받아 줄 수 있는 길이(컨텍스트)와 한 번에 낼 수 있는 답 길이를
// 서버에서 알아낸다.
//
// 왜 파일을 따로 뒀는가:
//
// 이 숫자들이 프로그램 전체를 좌우한다. 컨텍스트가 작으면 파일을 몇 개 못 읽히고
// 대화가 금방 접힌다. 답 길이 상한이 작으면 **큰 파일이 안 만들어진다.**
// 못 알아내면 32,768 로 깔고 앉는데, 요즘 로컬 모델은 262,144 · 655,360 이 흔하다.
// 그 상태로 쓰면 모델이 가진 것의 5% 만 쓰는 셈이다.
//
// 서버 규격을 하나하나 아는 방식으로는 못 따라간다:
//   LM Studio · llama.cpp · vLLM · TGI · KoboldCpp · LocalAI · LiteLLM ·
//   OpenRouter · 사내 게이트웨이, 그리고 아직 나오지 않은 것들.
// 그래서 세 겹으로 간다.
//
//   1겹. 아는 자리를 훑는다            ← 이 파일
//   2겹. 우리가 원하는 값을 지시한다    ← backend/adapter.js 의 num_ctx
//   3겹. 거절당하면 그 말에서 배운다    ← backend/learn.js  ★ 이게 진짜 답
//
// 3겹이 핵심이다. 서버는 거절할 때 정답을 알려 준다 —
//   "This model's maximum context length is 8192 tokens, however you requested 41003"
// 이 방식은 **처음 보는 서버에서도 통한다.** 규격을 몰라도 되고, 새 서버가
// 나와도 코드를 안 고쳐도 된다.
//
// '올린 길이' 와 '모델 최대' 를 구분한다. LM Studio 는 모델이 655,360 까지
// 되더라도 8,192 로 올려 둘 수 있다. 그 상태에서 655,360 을 믿고 보내면
// 서버가 거절한다. 그래서 실제로 쓸 값은 '올린 길이' 로 잡고, '모델 최대' 는
// 따로 알려 준다 — 사용자가 서버에서 더 올린 다음 /ctx 로 맞출 수 있게.
import { req, headersFor } from './http.js';
import { 애저인가 } from './azure.js';
import { 더할머리 } from './adapter.js';

// 이 이름들 중 하나면 '모델이 낼 수 있는 최대 컨텍스트' 다. 순서가 곧 우선순위다.
const 최대이름 = [
  'max_context_length',      // LM Studio
  'context_window',          // 일부 게이트웨이
  'context_length',          // llama.cpp·HF 계열
  'max_model_len',           // vLLM
  'max_input_tokens',        // LiteLLM·OpenRouter 계열
  'n_ctx_train',             // llama.cpp — 학습 때 길이
  'max_position_embeddings', // 모델 config 원본
  'max_sequence_length',
  'max_seq_len',
];

/**
 * '지금 서버에 실제로 올려 둔 길이'.
 *
 * context_length 를 여기서 뺐다. 그건 **모델 최대**이지 올린 길이가 아니다.
 * Ollama /api/show 가 그 이름으로 131,072 를 주는데 서버는 8,192 만 받는다.
 * 그대로 믿으면 확신에 찬 오답이 된다 — 화면에는 "131,072 · 서버에서 읽음" 이
 * 뜨고, 긴 대화에서 조용히 거절당한다. 못 찾았으면 못 찾았다고 해야 한다.
 *
 * 진짜 올린 길이는 대개 parameters 라는 **글자 덩어리** 안에 있다.
 * 그래서 아래 글에서찾기() 가 필요하다.
 */
const 올린이름 = ['loaded_context_length', 'num_ctx', 'n_ctx'];

// 한 번에 낼 수 있는 답 길이. 컨텍스트와 다른 축인데 전에는 아예 안 봤다.
const 출력이름 = [
  'max_output_tokens', 'max_completion_tokens', 'max_tokens',
  'num_predict', 'n_predict', 'max_output_length',
];

/*
 * 이름 **앞에 뭐가 붙어 와도** 같은 뜻으로 본다 (`qwen3.context_length` · `llm.n_ctx`).
 *
 * 잣대를 목록마다 따로 둔다. 전에는 최대 쪽 잣대 하나뿐이라 `llm.n_ctx` 가
 * 「모델 최대」 로만 걸리고 「올린 길이」 에서는 안 걸렸다 — 숫자 하나가
 * 「최대 8,192 · 올린 길이 모름」 이 되고, /ctx 자세히 가 그대로 찍었다.
 * 글자 덩어리 쪽(글에서찾기)은 원래 앞에 붙은 것을 넘기고 읽는다. 두 잣대가
 * 갈리면 '객체로 오면 못 찾고 글로 오면 찾는' 설명 못 할 상태가 된다.
 */
const 꼬리잣대 = new Map([
  [최대이름, /(^|[._])(context_length|context_window|n_ctx)$/i],
  [올린이름, /(^|[._])(loaded_context_length|num_ctx|n_ctx)$/i],
]);

// 사람이 알아볼 수 없는 값은 안 받는다. 512 미만은 오독, 1000만 초과는 단위 착각.
const 최소 = 512;
const 최대허용 = 10_000_000;

function 성한수(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i >= 최소 && i <= 최대허용 ? i : null;
}

/**
 * 글자 덩어리 안에서 값을 찾는다.
 *
 * 서버가 값을 JSON 으로 안 주고 글로 주는 일이 흔하다. Ollama 가 그렇다 —
 *   "parameters": "num_ctx                    8192\nstop  \"<|im_end|>\""
 * 이건 JSON 으로 보면 그냥 긴 문자열 하나다. 파보기() 로는 영영 못 찾는다.
 * 실제로 이것 때문에 8,192 서버에 131,072 를 보내고 있었다.
 *
 * llama.cpp 의 /props 나 일부 게이트웨이의 설명 필드도 같은 모양이다.
 */
export function 글에서찾기(s, 이름들) {
  const 글 = String(s ?? '');
  if (!글 || 글.length > 200000) return null;
  for (const 이름 of 이름들) {
    // 이름 뒤에 : = 공백 무엇이 와도 받는다. 값에 따옴표나 자릿점이 붙어도 받는다.
    const re = new RegExp(`(?:^|[^a-z0-9_])${이름}["']?\\s*[:=]?\\s*["']?(\\d[\\d,_]*)`, 'i');
    const m = re.exec(글);
    if (m) {
      const v = 성한수(m[1].replace(/[,_]/g, ''));
      if (v) return { value: v, key: 이름 };
    }
  }
  return null;
}

/**
 * 객체 어디에 박혀 있어도 찾는다. 글자 덩어리 안까지 본다.
 *
 * 서버가 { data: { meta: { config: { max_position_embeddings: 655360 } } } } 처럼
 * 깊이 넣어 두는 일이 흔하다. 그래서 이름으로 훑는다. 다만 아무 데나 파고들면
 * 엉뚱한 숫자를 집으므로 깊이를 5 로 막는다.
 *
 * 어느 이름에서 찾았는지도 같이 돌려준다 — 값이 이상할 때 사람이 원인을
 * 짚을 수 있어야 한다. /ctx 자세히 가 이걸 보여 준다.
 */
export function 파보기(obj, 이름들, { 글도 = true, depth = 0 } = {}) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  for (const key of 이름들) {
    const v = 성한수(obj[key]);
    if (v) return { value: v, key };
  }
  const 꼬리 = 꼬리잣대.get(이름들);
  for (const [k, v] of Object.entries(obj)) {
    // 이름이 정확히 안 맞으면 '…context_length' 처럼 끝나는 것도 본다 (Ollama · 꼬리잣대 머리말).
    if (꼬리 && 꼬리.test(k)) {
      const n = 성한수(v);
      if (n) return { value: n, key: k };
    }
    // 글자 덩어리 안까지 본다. 여기가 Ollama 의 진짜 num_ctx 가 사는 자리다.
    //
    // 찾는 이름은 객체를 볼 때와 **똑같이** 맞춘다. 위의 특별 취급(…context_length
    // 로 끝나는 이름)까지 글에서도 그대로 본다. 두 잣대가 갈리면 '객체로 오면
    // 찾고 글로 오면 못 찾는' 설명 못 할 상태가 된다.
    if (글도 && typeof v === 'string') {
      const 볼이름 = 이름들 === 최대이름 ? [...이름들, 'n_ctx', 'context_window'] : 이름들;
      const 글것 = 글에서찾기(v, 볼이름);
      if (글것) return { value: 글것.value, key: `${k}.${글것.key}` };
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = 파보기(v, 이름들, { 글도, depth: depth + 1 });
      if (found) return found;
    }
  }
  return null;
}

// 목록 응답에서 이 모델 항목만 골라낸다.
function 목록에서찾기(json, model) {
  const list = json?.data ?? json?.models ?? (Array.isArray(json) ? json : []);
  if (!Array.isArray(list)) return null;
  return list.find((m) => (m?.id ?? m?.name ?? m?.model) === model) ?? null;
}

/**
 * 서버에 물어 길이를 알아낸다.
 *
 * 두드릴 자리를 **한꺼번에** 두드린다. 전에는 차례로 갔다 — 다섯 곳이 각각
 * 시간 제한에 걸리면 켤 때마다 그만큼 멈춰 있었다. 서로 상관없는 요청이라
 * 순서를 지킬 이유가 없다. 우선순위는 결과를 모아 놓고 정하면 된다.
 *
 * @returns {Promise<{value, max, loaded, out, source, outSource, tried, why}>}
 */
export async function probeCtx(conn, { timeout = 6000 } = {}) {
  const H = () => headersFor(conn.auth, conn.key, 더할머리(conn.kind));
  const base = String(conn.base ?? '').replace(/\/+$/, '');
  const origin = base.replace(/\/v\d+$/, '').replace(/\/api$/, '');
  const model = conn.model;
  const tried = [];

  /*
   * Azure 는 컨텍스트 길이를 API 로 안 알려 준다.
   *
   * 그런데 여기서 두드리는 여섯 자리(`/models`, `/props`, `/info` …)는 Azure
   * 배포 주소 밑에 아예 없다. 그대로 두면 켤 때마다 여섯 번 404 를 받으며
   * 기다리고, 진단 화면에는 "아무 응답도 못 받았습니다" 가 뜬다 — 서버가
   * 멀쩡한데 우리가 없는 문을 두드린 것뿐이다.
   */
  // 'Azure 인가' 를 여기서 따로 정하지 않는다. 글자 조각으로 보면 detect 와
  // 답이 갈리고, 갈리는 순간 한쪽만 맞는 자리가 생긴다 (backend/azure.js).
  if (애저인가(conn.base)) {
    return {
      value: null, max: null, loaded: null, out: null, source: null, outSource: null,
      maxKey: null, loadedKey: null, tried: [],
      why: 'Azure 는 컨텍스트 길이를 알려주지 않습니다 — 배포한 모델에 맞게 설정에서 직접 넣으세요',
    };
  }

  const 본다 = async (label, url, opts = {}) => {
    try {
      const r = await req(url, { headers: H(), timeout, ...opts });
      tried.push({ label, url, status: r.status ?? 0, ok: !!r.ok });
      return { label, json: r.ok ? r.json : null };
    } catch (err) {
      // **누가 막았나**를 같이 적는다. 우리 문지기(safety/network.js)가 막은 것과
      // 서버가 죽은 것은 사람이 할 일이 전혀 다르다 — 앞엣것은 허락을 주면 되고
      // 뒤엣것은 서버를 봐야 한다. 아래에서 이 표시로 갈라 말한다.
      tried.push({ label, url, status: 0, ok: false, why: String(err?.message ?? err), 막힘: err?.name === 'NetBlocked' });
      return { label, json: null };
    }
  };

  // 두드릴 자리. 순서가 곧 우선순위다 — 앞엣것이 더 믿을 만하다.
  const 자리 = conn.kind === 'ollama'
    ? [
      ['Ollama 모델 정보', `${origin}/api/show`, { method: 'POST', body: { model } }, {}],
    ]
    : conn.kind === 'anthropic'
      /*
       * Anthropic 은 모델 목록에 **창 크기가 없다.** 이름과 나온 날짜뿐이다.
       *
       * 그래도 두 자리는 두드린다. 값이 없어도 「모델이 있다」 는 것은 확인되고,
       * 못 찾았다는 사실이 tried 에 남아 화면이 짐작을 사실처럼 말하지 않게 된다.
       * llama.cpp 의 /props 나 TGI 의 /info 는 여기 있을 리가 없으므로 안 두드린다 —
       * 없는 문을 두드리면 켤 때마다 그만큼 기다린다.
       */
      ? [
        ['모델 상세', `${base}/models/${encodeURIComponent(model)}`, {}, {}],
        ['모델 목록', `${base}/models`, {}, { 목록: true }],
      ]
      : [
      // 이 모델만 콕 집어 묻는다. 있으면 가장 정확하다.
      ['모델 상세', `${base}/models/${encodeURIComponent(model)}`, {}, {}],
      // LM Studio 는 자기 규격에만 '올린 길이' 를 준다. 이게 실제로 쓸 값이다.
      ['LM Studio', `${origin}/api/v0/models/${encodeURIComponent(model)}`, {}, {}],
      ['LM Studio 목록', `${origin}/api/v0/models`, {}, { 목록: true }],
      // 목록 응답 안에 들어 있는 경우 (vLLM 의 max_model_len 이 여기 있다)
      ['모델 목록', `${base}/models`, {}, { 목록: true }],
      // llama.cpp 는 /props 로만 알려 준다. TGI 는 /info 다.
      ['llama.cpp /props', `${origin}/props`, {}, { 올린것도: true }],
      ['TGI /info', `${origin}/info`, {}, {}],
    ];

  const 답들 = await Promise.all(자리.map(([label, url, opts]) => 본다(label, url, opts)));

  let max = null; let loaded = null; let out = null;
  let outSource = null; let maxKey = null; let loadedKey = null;
  // 값마다 어느 창구에서 왔는지 따로 든다 — 아래에서 **채택한 값**의 창구만 내보낸다.
  let 최대창구 = null; let 올린창구 = null;

  for (const [i, [label]] of 자리.entries()) {
    const json = 답들[i].json;
    if (!json) continue;
    const { 목록 = false, 올린것도 = false } = 자리[i][3] ?? {};
    const 대상 = 목록 ? 목록에서찾기(json, model) : json;
    if (!대상) continue;

    const m = 파보기(대상, 최대이름);
    const l = 파보기(대상, 올린이름);
    const o = 파보기(대상, 출력이름);
    if (m && !max) { max = m.value; maxKey = m.key; 최대창구 = label; }
    if (l && !loaded) { loaded = l.value; loadedKey = l.key; 올린창구 = label; }
    // llama.cpp 의 n_ctx 는 '지금 올린 길이' 다. 그 서버에서는 최대도 그 값으로 본다.
    if (올린것도 && m && !loaded) { loaded = m.value; loadedKey = m.key; 올린창구 = label; }
    if (o && !out) { out = o.value; outSource = label; }
  }

  // 실제로 쓸 값: 올려 둔 길이가 있으면 그것. 없으면 모델 최대.
  const value = loaded ?? max ?? null;
  /*
   * source 는 **채택한 값**이 어디서 왔는지다.
   *
   * 여태는 최대를 준 창구 이름을 적었다. 모델 상세가 655,360(최대)을, LM Studio 가
   * 8,192(올린 길이)를 주면 쓰는 값은 8,192 인데 화면은 「모델 상세에서 읽음」 이라
   * 적었다 (repl.js · commands/model.js 가 이 칸을 그대로 찍는다). 값이 이상할 때
   * 사람이 뒤지러 가는 자리가 바로 이 이름이라, 틀리면 엉뚱한 창구를 판다.
   */
  const source = loaded ? 올린창구 : (max ? 최대창구 : null);
  /*
   * 못 알아낸 까닭. **서버 탓으로 뭉개지 않는다.**
   *
   * 두드린 자리가 전부 우리 문지기에 막혔으면 서버는 이 물음을 **받아 본 적도
   * 없다.** 그런데 여태 이 자리는 그때도 「아무 응답도 못 받았습니다」 였고,
   * repl 은 그걸 「서버가 안 알려줍니다」 로 옮겼다 — 켤 때 바깥 연결을 처음
   * 붙이는 사람이 보는 첫 문장이 이것이다. 허락을 아직 안 준 것뿐인데 서버가
   * 이상한 줄 알고 서버를 뒤진다.
   */
  const 문지기가막음 = tried.length > 0 && tried.every((t) => t.막힘);
  /*
   * 404 로 **답한** 것과 아무 말도 없는 것도 다르다.
   *
   * 여섯 자리가 전부 404 를 돌려줬는데 이 자리는 「아무 응답도 못 받았습니다」 였다.
   * 서버는 또박또박 「그런 문은 없다」 고 말했는데, 사람은 서버가 죽었거나
   * 방화벽이 삼킨 줄 알고 서버를 뒤지러 간다. 받은 코드를 그대로 적으면
   * 「길이를 알려 주는 문이 없는 서버」 라는 것이 한눈에 보인다.
   */
  const 답한코드 = [...new Set(tried.filter((t) => t.status > 0).map((t) => t.status))];
  const why = value ? null
    : 문지기가막음 ? '이 주소로 나갈 허락이 아직 없어서 물어보지도 못했습니다'
      : tried.some((t) => t.ok) ? '서버가 응답은 했지만 길이를 안 알려 줍니다'
        : 답한코드.length ? `서버는 답했지만 길이를 알려 주는 문이 없습니다 (HTTP ${답한코드.join('·')})`
          : '두드린 자리에서 아무 응답도 못 받았습니다';

  return { value, max, loaded, out, source, outSource, maxKey, loadedKey, tried, why };
}

/**
 * "655360" · "655k" · "128K" · "1m" 을 숫자로. 못 읽으면 null.
 *
 * k/m 을 받는 이유는 단순하다 — 655360 을 손으로 치면 자릿수를 틀린다.
 */
export function parseSize(text) {
  const s = String(text ?? '').trim().replace(/[,_\s]/g, '').toLowerCase();
  const m = /^(\d+(?:\.\d+)?)([km])?$/.exec(s);
  if (!m) return null;
  const mult = m[2] === 'm' ? 1024 * 1024 : m[2] === 'k' ? 1024 : 1;
  return 성한수(Number(m[1]) * mult);
}

/** 32k · 640k · 1.0M — 화면에 넣을 짧은 표기 */
export function fmtSize(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 1024 * 1024) return Math.round(v / 1024) + 'k';
  return (v / (1024 * 1024)).toFixed(1) + 'M';
}

/*
 * 서버가 끝내 안 알려 줄 때 쓰는 값.
 *
 * **더 안 올린다.** 요즘 로컬 창구가 실제로 **올려 두는** 길이는 이보다 작다 —
 * Ollama 의 num_ctx, llama.cpp 서버의 --ctx-size, LM Studio 가 처음 올릴 때 잡는
 * 값이 다 4,096 언저리다. 모델이 655,360 까지 된다는 것과 서버가 그만큼 올려
 * 뒀다는 것은 다른 말이다(맨 위 머리말).
 *
 * 여기는 **아무것도 못 알아냈을 때** 쓰는 값이라 큰 쪽으로 틀리면 매 요청이
 * 거절당하고, 작은 쪽으로 틀리면 덜 쓸 뿐이다. 그리고 덜 쓰는 쪽은 3겹
 * (backend/learn.js)이 서버의 거절문에서 곧 배워 올린다 — 반대쪽은 못 배운다.
 */
export const 기본값 = 32768;
