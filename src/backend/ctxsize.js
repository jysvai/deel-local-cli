// 모델이 한 번에 받아 줄 수 있는 길이(컨텍스트)를 서버에서 알아낸다.
//
// 왜 파일을 따로 뒀는가:
//
// 이 숫자 하나가 프로그램 전체를 좌우한다. 이게 작으면 파일을 몇 개 못 읽히고,
// 대화가 금방 접히고, 한 번에 쓸 수 있는 답 길이도 같이 줄어든다(effort.js 가
// 이 값에서 상한을 계산한다). 예전에는 못 알아내면 32768 로 뒀는데, 요즘
// 로컬 모델은 262,144 · 655,360 처럼 훨씬 크다. 32k 로 깔고 앉으면 모델이
// 가진 것의 5% 만 쓰는 셈이다.
//
// 문제는 서버마다 이 숫자를 다른 이름, 다른 자리에 둔다는 것이다. 그래서
// 한 군데만 보지 않고 아는 자리를 전부 훑는다. 한 번에 다 못 찾아도
// 부분만 찾으면 그걸 쓴다.
//
//   OpenAI 호환    /v1/models/{id}  또는 /v1/models 목록 안의 그 항목
//   LM Studio      /api/v0/models   (max_context_length · loaded_context_length)
//   llama.cpp      /props           (n_ctx)
//   vLLM           /v1/models       (max_model_len)
//   Ollama         /api/show        (…​.context_length)
//
// '올린 길이' 와 '모델 최대' 를 구분한다. LM Studio 는 모델이 655,360 까지
// 되더라도 8,192 로 올려 둘 수 있다. 그 상태에서 655,360 을 믿고 보내면
// 서버가 거절한다. 그래서 실제로 쓸 값은 '올린 길이' 로 잡고, '모델 최대' 는
// 따로 알려 준다 — 사용자가 서버에서 더 올린 다음 /ctx 로 맞출 수 있게.
import { req, headersFor } from './http.js';

// 이 이름들 중 하나면 컨텍스트 길이다. 순서가 곧 우선순위다.
const 최대이름 = [
  'max_context_length',      // LM Studio
  'context_window',          // 일부 게이트웨이
  'context_length',          // llama.cpp·HF 계열
  'max_model_len',           // vLLM
  'max_input_tokens',        // LiteLLM·OpenRouter 계열
  'n_ctx',                   // llama.cpp
  'max_position_embeddings', // 모델 config 원본
  'max_sequence_length',
  'max_seq_len',
];
const 올린이름 = ['loaded_context_length', 'n_ctx', 'context_length'];

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
 * 객체 어디에 박혀 있어도 찾는다.
 *
 * 서버가 { data: { meta: { config: { max_position_embeddings: 655360 } } } } 처럼
 * 깊이 넣어 두는 일이 흔하다. 그래서 이름으로 훑는다. 다만 아무 데나 파고들면
 * 엉뚱한 숫자를 집으므로 깊이를 5 로 막는다.
 */
function 파보기(obj, 이름들, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  for (const key of 이름들) {
    const v = 성한수(obj[key]);
    if (v) return v;
  }
  // 이름이 정확히 안 맞으면 '…context_length' 처럼 끝나는 것도 본다 (Ollama).
  for (const [k, v] of Object.entries(obj)) {
    if (/(^|[._])(context_length|context_window|n_ctx)$/i.test(k)) {
      const n = 성한수(v);
      if (n) return n;
    }
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = 파보기(v, 이름들, depth + 1);
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
 * 서버에 물어 컨텍스트 길이를 알아낸다.
 *
 * @param {{kind:string, base:string, auth:string, key:string, model:string}} conn
 * @returns {Promise<{value:number|null, max:number|null, loaded:number|null, source:string|null, tried:Array}>}
 */
export async function probeCtx(conn, { timeout = 12000 } = {}) {
  const H = () => headersFor(conn.auth, conn.key);
  const base = String(conn.base ?? '').replace(/\/+$/, '');
  const origin = base.replace(/\/v\d+$/, '').replace(/\/api$/, '');
  const model = conn.model;
  const tried = [];
  let max = null;
  let loaded = null;
  let source = null;

  const 본다 = async (label, url, opts = {}) => {
    if (max && loaded) return null;
    try {
      const r = await req(url, { headers: H(), timeout, ...opts });
      tried.push({ label, url, status: r.status ?? 0, ok: !!r.ok });
      return r.ok ? r.json : null;
    } catch (err) {
      tried.push({ label, url, status: 0, ok: false, why: String(err?.message ?? err) });
      return null;
    }
  };

  const 담기 = (json, label, { 목록 = false } = {}) => {
    if (!json) return;
    const 대상 = 목록 ? 목록에서찾기(json, model) : json;
    if (!대상) return;
    const m = 파보기(대상, 최대이름);
    const l = 파보기(대상, 올린이름);
    if (m && !max) { max = m; source = label; }
    if (l && !loaded) loaded = l;
  };

  if (conn.kind === 'ollama') {
    담기(await 본다('Ollama /api/show', `${origin}/api/show`, { method: 'POST', body: { model } }), 'Ollama 모델 정보');
  } else {
    // 1) 이 모델만 콕 집어 묻는다. 있으면 가장 정확하다.
    담기(await 본다('모델 상세', `${base}/models/${encodeURIComponent(model)}`), '모델 상세');

    // 2) LM Studio 는 자기 규격에만 '올린 길이' 를 준다. 이게 실제로 쓸 값이다.
    담기(await 본다('LM Studio 상세', `${origin}/api/v0/models/${encodeURIComponent(model)}`), 'LM Studio');
    담기(await 본다('LM Studio 목록', `${origin}/api/v0/models`), 'LM Studio', { 목록: true });

    // 3) 목록 응답 안에 들어 있는 경우 (vLLM 의 max_model_len 이 여기 있다)
    담기(await 본다('모델 목록', `${base}/models`), '모델 목록', { 목록: true });

    // 4) llama.cpp 서버는 /props 로만 알려 준다.
    const props = await 본다('llama.cpp /props', `${origin}/props`);
    if (props) {
      const n = 파보기(props, ['n_ctx', 'context_length']);
      if (n) { if (!max) { max = n; source = 'llama.cpp'; } if (!loaded) loaded = n; }
    }
  }

  // 실제로 쓸 값: 올려 둔 길이가 있으면 그것. 없으면 모델 최대.
  const value = loaded ?? max ?? null;
  return { value, max, loaded, source, tried };
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

/** 33k · 655k · 1.0M — 화면에 넣을 짧은 표기 */
export function fmtSize(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 1024 * 1024) return Math.round(v / 1024) + 'k';
  return (v / (1024 * 1024)).toFixed(1) + 'M';
}

/** 서버가 끝내 안 알려 줄 때 쓰는 값. 옛날 32768 보다는 요즘 기본에 가깝다. */
export const 기본값 = 32768;
