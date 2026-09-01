// 주소만 받아서 "이 서버가 무슨 규격이고 인증을 어떻게 받는지" 알아낸다.
import { req, headersFor, AUTH_STYLES, serverMessage } from './http.js';
import { 애저인가, 애저풀기, 애저base, 배포목록 } from './azure.js';
import { ANTHROPIC_VERSION } from './adapter.js';

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
 *
 * ── 다만 두 가지는 성공이 아니다 ──────────────────────────────────────
 *
 *   1) **아무 바이트도 안 왔을 때.** 포트가 닫혀 있거나, VPN 이 안 올라왔거나,
 *      자원 이름을 잘못 적었을 때가 그렇다. 이걸 "목록만 못 봤다" 로 넘기면
 *      설치 화면이 초록색 `연결됨` 을 띄우고, 사람은 권한 문제인 줄 알고
 *      엉뚱한 데를 뒤진다. 서버에 닿지도 못했으면 닿지 못했다고 해야 한다.
 *
 *   2) **첫 번째 401 로 인증 방식을 정해 버리는 것.** Azure 앞단을 Entra ID 로
 *      감싼 곳은 `api-key` 에 401 을 주고 `Bearer` 를 받는다. 첫 401 에서
 *      멈추면 그 곳은 영영 못 붙는다 — 화면은 초록색인데 첫 한마디가 401 이다.
 *      그래서 방식은 **다 해 보고** 고른다.
 */
async function tryAzure(input, key) {
  const 푼것 = 애저풀기(input);
  if (!푼것) return null;
  // Azure 는 api-key 헤더가 제 방식이다. 그것부터 본다.
  const 차례 = ['api-key', 'bearer', 'none'].map((id) => AUTH_STYLES.find((s) => s.id === id));

  let 닿음 = false;              // 서버가 HTTP 로 대답을 하기는 했나
  const 막힌것 = [];             // 거절당한 방식들 — 다 해 보고 고른다
  let 마지막오류 = null;

  for (const style of 차례) {
    if (style.id !== 'none' && !key) continue;
    const r = await req(푼것.목록주소, { headers: headersFor(style.id, key), timeout: 12000 });
    if (r.status) 닿음 = true;
    else 마지막오류 = r.error ?? 마지막오류;

    if (r.ok && r.json) {
      const models = 배포목록(r.json);
      const base = 푼것.base ?? (models[0] ? 애저base(푼것.origin, models[0].id, 푼것.판, 푼것.앞길) : null);
      if (base) return { kind: 'openai', base, auth: style.id, models, ms: r.ms, azure: true };
      // 200 인데 배포가 하나도 없다. 인증은 통했으니 더 두드려 봐야 같은 답이다.
      return {
        kind: null,
        ms: r.ms,
        why: '배포 목록은 받았는데 비어 있습니다 — 이 자원에 배포된 모델이 없습니다.'
          + ' Azure 포털에서 모델을 배포한 뒤 다시 해 보세요.',
      };
    }
    if ([401, 403, 404].includes(r.status)) 막힌것.push({ auth: style.id, status: r.status, ms: r.ms });
  }

  // 아무도 못 닿았다. 이건 목록 권한 문제가 아니라 연결 문제다.
  if (!닿음) return { kind: null, why: 마지막오류 ?? '주소에 닿지 못했습니다' };

  if (푼것.base && 막힌것.length) {
    /*
     * 어느 방식으로 적어 둘까.
     *
     * 401·403 은 "인증이 틀렸다" 는 말이고, 404 는 "인증은 됐는데 그 자리가
     * 없다"에 가깝다. 그러니 404 를 받은 방식이 있으면 그쪽이 맞을 확률이
     * 높다. 아무것도 안 통했으면 Azure 의 제 방식(api-key)으로 적어 두되,
     * **열쇠를 줬는데 '인증 없음' 으로 적지는 않는다** — 그렇게 적으면 그
     * 뒤의 모든 요청이 열쇠 없이 나간다.
     */
    // 열쇠를 줬으면 '인증 없음' 은 아예 후보에서 뺀다. 그것으로 적어 두면
    // 그 뒤의 모든 요청이 맨몸으로 나간다 — 붙은 것처럼 보이는데 다 401 이다.
    const 볼것 = key ? 막힌것.filter((x) => x.auth !== 'none') : 막힌것;
    const 쓸것 = 볼것.length ? 볼것 : [{ auth: key ? 'api-key' : 'none', status: 막힌것[0].status, ms: 막힌것[0].ms }];
    const 나은것 = 쓸것.find((x) => x.status === 404) ?? null;
    const 고른것 = 나은것 ?? 쓸것[0];
    const 다막힘 = !나은것;
    return {
      kind: 'openai',
      base: 푼것.base,
      auth: 고른것.auth,
      models: [],
      ms: 고른것.ms,
      azure: true,
      warn: 다막힘 && key
        ? `배포 목록도 인증도 확인 못 했습니다 (해 본 방식마다 HTTP ${막힌것.map((x) => x.status).join('·')})`
          + ' — 주소에 적힌 배포로 그냥 씁니다. 첫 한마디에서 걸리면 /model 로 인증 방식을 바꾸세요.'
        : `배포 목록을 못 봤습니다 (HTTP ${고른것.status}) — 주소에 적힌 배포로 그냥 씁니다.`,
    };
  }
  return null;
}

/*
 * 못 붙었을 때 **무엇이 막았는지**를 적어 둔다.
 *
 * 여태는 실패한 응답을 그냥 버렸다. 그래서 401(닿았는데 열쇠) · 404(주소가
 * 아님) · Bedrock 의 AccessDenied(모델 신청을 안 함)가 화면에서 전부
 * 「연결 실패」 한 마디가 됐다. 셋은 고칠 자리가 완전히 다른데도.
 *
 * 값을 채워 주는 자리를 인자로 받는 것은, 두드리는 함수들이 돌려주는 모양을
 * 안 바꾸려는 것이다 — 그 반환값(붙었나 아닌가)은 부르는 데가 여럿이다.
 *
 * **진짜 상태코드를 먼저 적는다.** 후보를 여럿 두드리다 보면 하나는 401 이고
 * 하나는 0(닿지도 못함)일 수 있는데, 401 쪽이 훨씬 쓸모 있는 단서다 — 적어도
 * 서버가 거기 있다는 뜻이니까.
 */
function 막은것적기(막힌것, r) {
  if (!막힌것) return;
  const 말 = (r.status ? serverMessage(r) : r.error) ?? '';
  if (!막힌것.status && r.status) { 막힌것.status = r.status; 막힌것.why = 말; }
  else if (!막힌것.status && !막힌것.why) 막힌것.why = 말;
}

/*
 * Anthropic 규격인지 확인 (GET {base}/models · 판 머리를 얹어서).
 *
 * ── 왜 OpenAI 쪽과 안 헷갈리나 ─────────────────────────────────────────
 *
 * 문 이름이 `/models` 로 같다. 그런데 이쪽 서버는 `anthropic-version` 머리가
 * 없으면 400 을 준다. tryOpenAI 는 그 머리를 안 보내므로 여기 붙을 수가 없다.
 *
 * 반대는 성립하지 않는다 — OpenAI 호환 서버는 모르는 머리를 그냥 무시하므로
 * 이 함수로도 붙어 버린다. 그래서 **뒤에 두드린다.** 다만 열쇠가 sk-ant- 로
 * 시작하거나 주소가 그 회사면 먼저 본다. 그때는 헷갈릴 일이 없고, 앞에서
 * 네 가지 인증 방식으로 헛되이 두드리는 시간도 없앤다.
 *
 * 인증 방식을 한 가지만 본다. 이 규격은 x-api-key 하나뿐이라, 나머지로
 * 두드려 봐야 401 만 늘고 사람이 기다리는 시간만 길어진다.
 */
async function tryAnthropic(base, key, 막힌것 = null) {
  if (!key) return null;
  const r = await req(`${base}/models`, {
    headers: headersFor('x-api-key', key, { 'anthropic-version': ANTHROPIC_VERSION }),
    timeout: 12000,
  });
  막은것적기(막힌것, r);
  if (r.ok && Array.isArray(r.json?.data)) {
    return { kind: 'anthropic', base, auth: 'x-api-key', models: normalizeModels(r.json.data), ms: r.ms };
  }
  return null;
}

/** 이 규격을 먼저 볼 만한 단서가 있나. 열쇠 앞머리나 주소로만 본다. */
export function 앤트로픽같나(input, key) {
  if (/^sk-ant-/.test(String(key ?? '').trim())) return true;
  try {
    const u = new URL(/^https?:\/\//i.test(input) ? String(input) : 'https://' + String(input));
    return /(^|\.)anthropic\.com$/i.test(u.hostname);
  } catch { return false; }
}

// OpenAI 호환인지 확인 (GET {base}/models). 막힌것은 막은것적기 머리말 참고.
async function tryOpenAI(base, key, 막힌것 = null) {
  const 적기 = (r) => 막은것적기(막힌것, r);
  for (const style of AUTH_STYLES) {
    if (style.id !== 'none' && !key) continue;
    if (style.id === 'none' && key) { /* 키를 줬어도 인증 없는 서버일 수 있으니 마지막에 본다 */ }
    const r = await req(`${base}/models`, { headers: headersFor(style.id, key), timeout: 12000 });
    적기(r);
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
    /*
     * 400 인데 「anthropic-version 이 필요하다」 고 하면, 그건 서버가 화가 난
     * 것이 아니라 **규격이 다르다**는 말이다. 서버가 제 규격을 말해 줬다.
     *
     * 여기서 openai 로 잡아 버리면 설치는 초록색으로 끝나고 첫 한마디에서
     * 400 이 난다 — 그 화면으로는 원인을 알 길이 없다. 열쇠 앞머리가 sk-ant-
     * 가 아닌 열쇠(사내에서 다시 발급한 것 등)로 그 규격 서버에 붙을 때
     * 실제로 이 길로 온다.
     */
    if (r.status === 400 && /anthropic-version/i.test(serverMessage(r) ?? '')) return null;
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
    .map((m) => (typeof m === 'string' ? { id: m } : { id: m.id ?? m.name ?? m.model, note: m.owned_by ?? m.display_name ?? '' }))
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
    if (hit?.kind) return { ...hit, tried };
    // 못 붙은 이유를 tryAzure 가 알고 있으면 그 말을 쓴다. 우리가 아는 것보다 정확하다.
    return {
      kind: null,
      tried,
      why: hit?.why ?? 'Azure 주소로 보이는데 배포를 못 찾았습니다 — 주소에 /openai/deployments/<배포이름> 까지 넣어 보세요.',
    };
  }

  // 못 붙으면 무엇이 막았는지를 같이 돌려준다 — 부르는 쪽이 사람 말로 옮긴다
  // (providers/index.js 의 막힌까닭). tryOpenAI 머리말 참고.
  const 막힌것 = { status: 0, why: '' };

  // 단서가 있으면 이 규격을 먼저 본다 (tryAnthropic 머리말).
  if (앤트로픽같나(input, key)) {
    for (const base of candidates(input)) {
      tried.push(base);
      const hit = await tryAnthropic(base, key, 막힌것);
      if (hit) return { ...hit, tried };
    }
  }

  // Ollama 를 먼저 본다 — 로컬이면 대개 이쪽이고 확인이 빠르다.
  const oll = await tryOllama(/^https?:\/\//i.test(origin) ? origin : 'http://' + origin);
  if (oll) return { ...oll, tried };

  for (const base of candidates(input)) {
    if (!tried.includes(base)) tried.push(base);
    const hit = await tryOpenAI(base, key, 막힌것);
    if (hit) return { ...hit, tried };
  }

  /*
   * 마지막으로 이 규격도 본다.
   *
   * 사내 게이트웨이가 이 규격만 열어 둔 경우가 있다. 여기까지 왔다는 것은
   * OpenAI 쪽으로는 안 붙었다는 뜻이라, 이제 헷갈릴 일이 없다.
   */
  if (key && !앤트로픽같나(input, key)) {
    for (const base of candidates(input)) {
      const hit = await tryAnthropic(base, key, 막힌것);
      if (hit) return { ...hit, tried };
    }
  }
  return { kind: null, tried, status: 막힌것.status, why: 막힌것.why };
}
