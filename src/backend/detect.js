// 주소만 받아서 "이 서버가 무슨 규격이고 인증을 어떻게 받는지" 알아낸다.
import { req, headersFor, AUTH_STYLES, serverMessage } from './http.js';

// 사람이 대충 적은 주소를 시도해볼 후보들로 넓힌다.
export function candidates(input) {
  let u = String(input).trim().replace(/\s+/g, '');
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  u = u.replace(/\/+$/, '');
  const out = [];
  const push = (x) => { if (x && !out.includes(x)) out.push(x); };

  if (/\/v\d+$/.test(u)) push(u);                 // .../v1 을 직접 준 경우
  else { push(u + '/v1'); push(u); push(u + '/openai/v1'); }
  return out;
}

// OpenAI 호환인지 확인 (GET {base}/models)
async function tryOpenAI(base, key) {
  for (const style of AUTH_STYLES) {
    if (style.id !== 'none' && !key) continue;
    if (style.id === 'none' && key) { /* 키를 줬어도 인증 없는 서버일 수 있으니 마지막에 본다 */ }
    const r = await req(`${base}/models`, { headers: headersFor(style.id, key), timeout: 12000 });
    if (r.ok && r.json) {
      const list = r.json.data ?? r.json.models ?? [];
      if (Array.isArray(list)) {
        return { kind: 'openai', base, auth: style.id, models: normalizeModels(list), ms: r.ms };
      }
    }
    // 401/403 이면 규격은 맞고 인증만 틀린 것 — 다음 방식으로 계속.
    //
    // 그 밖의 오류(500 등)는 '규격은 맞는데 서버가 지금 화가 난 것' 으로 본다.
    // 그래야 서버가 한 말을 사람에게 그대로 보여 줄 수 있다.
    //
    // 단, **200 인데 JSON 이 아니면 여기 해당하지 않는다.** 사내 프록시가
    // 로그인 페이지를 200 으로 내주는 일이 흔한데, 예전에는 그걸 "OpenAI 호환
    // 서버 · 모델 0개" 로 잡았다. 그러면 사람은 모델이 안 올라온 줄 알고
    // 엉뚱한 데를 파게 된다 — 실제로는 인증 페이지에 막힌 것이다.
    const 성공인데JSON아님 = r.status >= 200 && r.status < 300 && !r.json;
    if (r.status && !성공인데JSON아님 && ![401, 403, 0, 404].includes(r.status)) {
      return { kind: 'openai', base, auth: style.id, models: [], ms: r.ms, warn: serverMessage(r) };
    }
  }
  return null;
}

// Ollama 자체 규격인지 확인
async function tryOllama(origin) {
  const v = await req(`${origin}/api/version`, { timeout: 8000 });
  if (!v.ok || !v.json?.version) return null;
  const tags = await req(`${origin}/api/tags`, { timeout: 12000 });
  const models = (tags.json?.models ?? []).map((m) => ({
    id: m.name ?? m.model,
    note: m.details?.parameter_size ? `${m.details.parameter_size} · ${fmtSize(m.size)}` : fmtSize(m.size),
  }));
  return { kind: 'ollama', base: origin, auth: 'none', models, version: v.json.version, ms: v.ms };
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)}GB` : `${Math.round(bytes / 1024 ** 2)}MB`;
}

function normalizeModels(list) {
  return list
    .map((m) => (typeof m === 'string' ? { id: m } : { id: m.id ?? m.name ?? m.model, note: m.owned_by ?? '' }))
    .filter((m) => m.id);
}

export async function detect(input, key) {
  const tried = [];
  const origin = String(input).trim().replace(/\/+$/, '').replace(/\/v\d+$/, '');

  // Ollama 를 먼저 본다 — 로컬이면 대개 이쪽이고 확인이 빠르다.
  const oll = await tryOllama(/^https?:\/\//i.test(origin) ? origin : 'http://' + origin);
  if (oll) return { ...oll, tried };

  for (const base of candidates(input)) {
    tried.push(base);
    const hit = await tryOpenAI(base, key);
    if (hit) return { ...hit, tried };
  }
  return { kind: null, tried };
}
