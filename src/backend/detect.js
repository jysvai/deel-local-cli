// 주소만 받아서 "이 서버가 무슨 규격이고 인증을 어떻게 받는지" 알아낸다.
import { req, headersFor, AUTH_STYLES, serverMessage } from './http.js';
import { 애저인가, 애저풀기, 애저base, 배포목록 } from './azure.js';

// 사람이 대충 적은 주소를 시도해볼 후보들로 넓힌다.
export function candidates(input) {
  let u = String(input).trim().replace(/\s+/g, '');
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  u = u.replace(/\/+$/, '');
  const out = [];
  const push = (x) => { if (x && !out.includes(x)) out.push(x); };

  /*
   * Azure 는 `/v1` 을 붙이면 안 된다.
   *
   * 배포 주소 뒤에 `/v1/models` 를 두드리면 404 만 돌아오고, 사람은 주소를
   * 제대로 넣고도 "연결 실패" 를 본다. 모양이 다른 것뿐이라 고칠 방법도 없다.
   * Azure 면 그 주소 하나만 후보로 둔다 — 확인은 tryAzure 가 따로 한다.
   */
  if (애저인가(u)) { push(u); return out; }

  if (/\/v\d+$/.test(u)) push(u);                 // .../v1 을 직접 준 경우
  else { push(u + '/v1'); push(u); push(u + '/openai/v1'); }
  return out;
}

/*
 * Azure 확인.
 *
 * 배포 목록(`/openai/deployments?api-version=`)을 먼저 묻는다. 여기서 오는
 * 이름이 곧 주소에 들어갈 이름이라, 목록을 받으면 사람은 고르기만 하면 된다.
 *
 * 목록을 막아 둔 테넌트가 많다(권한이 따로다). 그때도 **연결 실패로 치지
 * 않는다** — 주소에 배포 이름이 이미 있으면 그것으로 그냥 간다. 목록을 못 본
 * 것과 못 쓰는 것은 다르고, 여기서 실패로 처리하면 정작 잘 되는 설정이
 * 설치 화면을 못 넘어간다.
 */
async function tryAzure(input, key) {
  const 푼것 = 애저풀기(input);
  if (!푼것) return null;
  // Azure 는 api-key 헤더가 제 방식이다. 그것부터 본다.
  const 차례 = ['api-key', 'bearer', 'none'].map((id) => AUTH_STYLES.find((s) => s.id === id));

  for (const style of 차례) {
    if (style.id !== 'none' && !key) continue;
    const r = await req(푼것.목록주소, { headers: headersFor(style.id, key), timeout: 12000 });
    if (r.ok && r.json) {
      const models = 배포목록(r.json);
      const base = 푼것.base ?? (models[0] ? 애저base(푼것.origin, models[0].id, 푼것.판) : null);
      if (base) return { kind: 'openai', base, auth: style.id, models, ms: r.ms, azure: true };
    }
    // 목록만 막힌 경우. 주소에 배포가 있으면 그대로 쓴다.
    if ([401, 403, 404].includes(r.status) && 푼것.base) {
      return {
        kind: 'openai', base: 푼것.base, auth: style.id, models: [], ms: r.ms, azure: true,
        warn: `배포 목록을 못 봤습니다 (HTTP ${r.status}) — 주소에 적힌 배포로 그냥 씁니다.`,
      };
    }
  }
  if (푼것.base) {
    return {
      kind: 'openai', base: 푼것.base, auth: key ? 'api-key' : 'none', models: [], ms: 0, azure: true,
      warn: '배포 목록에 못 닿았습니다 — 주소에 적힌 배포로 그냥 씁니다.',
    };
  }
  return null;
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

  // Azure 는 모양이 아예 다르다. 여기서 갈라 놓지 않으면 아래 후보들이
  // 엉뚱한 자리를 두드리다 끝난다.
  if (애저인가(input)) {
    const 푼것 = 애저풀기(input);
    tried.push(푼것?.목록주소 ?? String(input));
    const hit = await tryAzure(input, key);
    if (hit) return { ...hit, tried };
    return { kind: null, tried, why: 'Azure 주소로 보이는데 배포를 못 찾았습니다 — 주소에 /openai/deployments/<배포이름> 까지 넣어 보세요.' };
  }

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
