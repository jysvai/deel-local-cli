// 주소만 받아서 "이 서버가 무슨 규격이고 인증을 어떻게 받는지" 알아낸다.
import { req, headersFor, AUTH_STYLES, serverMessage } from './http.js';
import { 맨틀호스트인가 } from './toolfit.js';
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
  // 200 인데 JSON 이 아닌 답 — 사내 로그인 페이지·프록시 안내면이 가로챈 것 (아래 끝 머리말).
  let 글로답함 = false;

  for (const style of 차례) {
    if (style.id !== 'none' && !key) continue;
    const r = await req(푼것.목록주소, { headers: headersFor(style.id, key), timeout: 12000 });
    if (r.status) 닿음 = true;
    else 마지막오류 = r.error ?? 마지막오류;
    // 아무도 답한 적 없이 시간이 다 됐으면 머리를 바꿔 12초씩 더 기다리지 않는다 (시간다됨 머리말).
    if (!닿음 && 시간다됨(r)) break;

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
    /*
     * 거절당한 것은 **코드를 가리지 않고** 적어 둔다.
     *
     * 여태는 401·403·404 만 담았다. 그래서 앞단이 아파서 낸 500·502 는 담기는
     * 자리가 없었고, 아래에서 「무엇을 봤는지」 를 말할 때 그 자리가 통째로
     * 비어 있었다 — 서버가 아픈 것이 주소를 잘못 적은 것으로 읽혔다.
     *
     * 200 인데 JSON 이 아닌 것(사내 로그인 페이지)은 여기 안 들어온다. 그건
     * 거절이 아니라 **다른 서버가 답한 것**이라, 인증 방식을 고르는 표에
     * 섞이면 안 된다.
     */
    if (r.status && !r.ok) 막힌것.push({ auth: style.id, status: r.status, ms: r.ms });
    // 그래도 **본 것**이다. 아래 끝에서 이 한 가지만은 말해 준다 (사냥6 막판-뒷단).
    else if (r.ok && !r.json) 글로답함 = true;
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
        /*
         * 열쇠 없이 두드려 401·403 을 받았으면 그렇다고 말한다. 「목록을 못 봤다」 만 적으면 첫
         * 한마디의 401 을 사람이 짐작해야 한다 — 서버는 이미 열쇠가 없다고 말했다 (6회차 Gemini 알아내기6 D1).
         */
        : !key && (고른것.status === 401 || 고른것.status === 403)
          ? `열쇠 없이 두드렸더니 배포 목록이 HTTP ${고른것.status} 입니다 — 주소에 적힌 배포로 그냥 씁니다.`
            + ' 첫 한마디에서도 막히면 열쇠(api-key)를 넣으세요.'
          : `배포 목록을 못 봤습니다 (HTTP ${고른것.status}) — 주소에 적힌 배포로 그냥 씁니다.`,
    };
  }

  /*
   * ── 여기까지 왔다는 것은 **배포를 못 집었다**는 뜻이다 ──────────────────
   *
   * 사람이 본 것: 포털에서 자원 주소만(배포 이름 없이) 복사해 넣고 열쇠가
   * 틀렸을 때, 화면은 「Azure 주소로 보이는데 배포를 못 찾았습니다 — 주소에
   * /openai/deployments/<배포이름> 까지 넣어 보세요」 였다. 시키는 대로 주소를
   * 고쳐 넣어도 아무것도 안 바뀐다. 서버는 세 방식 모두에 401 을 냈고, 그건
   * 주소 이야기가 아니라 **열쇠 이야기**였다.
   *
   * 왜 그랬나: 배포를 못 집으면(푼것.base 가 없으면) 위 갈래에 못 들어가고
   * 여기서 그냥 `null` 이 나갔다. 세 번 두드려 받아 온 상태 코드를 **통째로
   * 버린 것**이다. 부르는 쪽(detect)은 받은 것이 없으니 제가 아는 짐작 한
   * 줄을 적었고, 그 짐작이 틀리는 자리가 바로 여기다.
   *
   * 이제 지키는 규칙: **본 것을 그대로 들고 나간다.** 상태 코드로 말하고,
   * 주소를 고치라는 말은 그 말이 들을 만한 자리(404)에서만 한다. 상태 코드도
   * 함께 넘겨서 부르는 쪽이 제 표로 옮길 수 있게 한다 (providers 의 막힌까닭).
   */
  const 본상태 = 막힌것.map((x) => x.status);
  /*
   * ── 200 으로 답한 자리에 「주소를 고쳐 보세요」 라고 하지 않는다 (사냥6 막판-뒷단) ──
   *
   * 사내 SSO·프록시가 배포 목록 요청을 가로채 **200 으로 로그인 페이지**를 준다. 그건
   * 거절이 아니라 위 막힌것 에 안 담기고(그건 맞다 — 인증 방식 표에 섞이면 안 된다),
   * 그래서 여기서 `null` 이 나갔다. 부르는 쪽(detect)은 받은 것이 없으니 제 짐작 —
   * 「주소에 /openai/deployments/<배포이름> 까지 넣어 보세요」— 를 적었는데, 주소에는
   * 이미 그 길이 적혀 있고 서버는 200 으로 또박또박 답했다. 시키는 대로 고쳐도 아무것도
   * 안 바뀐다. 바로 위 머리말이 「주소를 고치라는 말은 404 에서만」 이라고 못 박은 그 자리다.
   *
   * 본 것을 그대로 말한다. 여기서 사람이 할 일은 주소를 고치는 것이 아니라 **브라우저로
   * 같은 주소를 열어 무엇이 뜨는지 보는 것**이다.
   */
  if (!본상태.length) {
    if (!글로답함) return null;
    return {
      kind: null,
      status: 200,
      why: '배포 목록 자리가 HTTP 200 으로 답했는데 JSON 이 아닙니다 — Azure 가 아니라'
        + ' 사내 로그인 페이지나 프록시 안내면이 가로챈 것으로 보입니다.'
        + ' 브라우저로 같은 주소를 열어 무엇이 뜨는지 보세요 — 주소를 고쳐도 이 답은 안 바뀝니다.',
    };
  }
  const 대표 = 본상태.find((s) => s >= 500)
    ?? 본상태.find((s) => s === 401 || s === 403)
    ?? 본상태[0];
  return { kind: null, status: 대표, why: 애저막힌말(대표, 본상태) };
}

/** 배포를 못 집은 채 끝났을 때 무슨 말을 하나. 본 것만 말한다 — 짐작을 안 보탠다. */
function 애저막힌말(대표, 본상태) {
  const 본것 = 본상태.length > 1
    ? `해 본 방식마다 HTTP ${본상태.join('·')}`
    : `HTTP ${대표}`;
  if (대표 >= 500) {
    return `자원에는 닿았는데 배포 목록에서 서버가 오류를 냈습니다 (${본것})`
      + ' — 주소가 아니라 서버 쪽입니다. 잠시 뒤 다시 해 보세요.';
  }
  if (대표 === 401 || 대표 === 403) {
    return `자원에는 닿았는데 열쇠를 안 받아 줍니다 (${본것})`
      + ' — 주소가 아니라 열쇠를 보세요. 배포 이름을 붙여도 이 답은 안 바뀝니다.';
  }
  if (대표 === 404) {
    return `배포 목록을 못 봤습니다 (${본것})`
      + ' — 주소에 /openai/deployments/<배포이름> 까지 넣어 보세요.';
  }
  /*
   * 404 가 아니면 **주소 이야기가 아니다.**
   *
   * 429 는 앞단이 지금 못 받는다는 말이고 400 은 우리가 보낸 것을 못 읽었다는
   * 말이다. 둘 다 배포 이름을 붙여도 답이 안 바뀐다. 그런데도 이 자리는 코드를
   * 가리지 않고 「주소에 배포 이름을 넣어 보세요」 로 끝났다 — 바로 위 머리말이
   * 「그 말은 들을 만한 자리(404)에서만 한다」 고 적어 둔 그 약속을 깬 것이다.
   * 시키는 대로 주소를 고쳐 넣어도 아무것도 안 바뀐다.
   */
  return `배포 목록을 못 봤습니다 (${본것})`
    + ' — 404 가 아니라 주소 이야기가 아닙니다. 서버가 낸 코드를 그대로 보세요.';
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
export function 막은것적기(막힌것, r) {
  if (!막힌것) return;
  const 말 = (r.status ? serverMessage(r) : r.error) ?? '';
  /*
   * ── 404 는 약한 단서다 ────────────────────────────────────────────────
   *
   * 사람이 본 것: `/v1/models` 는 404(길 없음), `/models` 는 401(열쇠 틀림)인 게이트웨이에서
   * 화면이 「no route」 · HTTP 404 — 주소 탓 — 로 끝났다. 서버는 열쇠를 안 받는다고 분명히
   * 말했는데, 후보 차례상 404 를 먼저 받았고 여기가 **처음 받은 것만** 적었다
   * (6회차 Gemini 알아내기6 D4). 사람은 주소를 고치러 가고 열쇠는 안 본다.
   *
   * 이제 지키는 규칙: 404·405 와 2xx·3xx(다른 무엇이 답함)는 「이 길이 아니다」 일 뿐이라,
   * 뒤에 401·403·5xx 같은 **그 서버가 제 말로 거절한 것**이 오면 그걸로 바꿔 적는다.
   * 그 밖에는 여전히 처음 것이 이긴다.
   */
  const 약한것 = (s) => s === 404 || s === 405 || (s > 0 && s < 400);
  if (r.status && (!막힌것.status || (약한것(막힌것.status) && !약한것(r.status)))) { 막힌것.status = r.status; 막힌것.why = 말; }
  else if (!막힌것.status && !막힌것.why) 막힌것.why = 말;
  // 아무도 답한 적 없는데 시간이 다 됐다 — 이 주소는 먹통이다(시간다됨 머리말). 한 번 답한 곳은 먹통이 아니다.
  if (시간다됨(r) && !막힌것.status) 막힌것.먹통 = true;
  /*
   * ...그리고 뒤늦게라도 서버가 제 말로 답하면 그 표시는 **내린다.**
   *
   * 먹통의 뜻은 「아무도 답한 적 없는데 시간이 다 됐다」 이다. 그 뒤에 401 이
   * 와서 status 가 채워져도 표시는 그대로 남아 있었다. 남은 표시 하나로 부르는
   * 쪽(detect)은 나머지 후보를 통째로 건너뛰고 먹통끝() 으로 나간다 — 서버가
   * 거기 있다고 방금 말했는데 화면은 「닿지도 못했다」 로 끝난다.
   */
  else if (r.status && 막힌것.먹통) 막힌것.먹통 = false;
}

/*
 * ── 안 답하는 곳을 인증 방식마다 또 기다리지 않는다 ─────────────────────
 *
 * 사람이 본 것: 방화벽이 삼키는 주소(VPN 이 반쯤 올라온 자리)를 넣었더니 설치 화면이 3분 넘게
 * 멈췄다가 「시간 초과」 한 줄로 끝났다.
 *
 * 실제로 있었던 일: 후보 주소 셋 × 인증 방식 넷을 하나씩 12초씩 기다렸다 — 일반 주소 188초(16번),
 * Azure 36초(3번) (6회차 Gemini 알아내기6 D3). 후보들은 **같은 호스트·포트**에 길만 다르고, 머리
 * 하나 · 길 하나 바꾼다고 안 답하던 곳이 답하지 않는다.
 *
 * 이제 지키는 규칙: 아무도 답한 적 없는 채 **시간이 다 되면** 그 주소는 거기서 끝. 곧장 오는 실패
 * (연결 거절 · DNS)는 시간이 안 드니 그대로 둔다 — 고칠 것은 기다림이지 차례가 아니다.
 */
const 시간코드 = new Set(['TimeoutError', 'CONNECT_TIMEOUT', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
function 시간다됨(r) {
  return !r?.status && 시간코드.has(r?.code);
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
 * ── 인증은 주소를 보고 고른다 ──────────────────────────────────────────
 *
 * 이 규격은 오랫동안 x-api-key 하나뿐이었다. 지금은 한 자리가 더 있다 —
 * AWS 의 mantle 창구가 같은 Anthropic Messages 규격을 **Bedrock API 키를
 * Bearer 로 받아서** 내어 준다.
 *
 *   bedrock-mantle.<리전>.api.aws/anthropic/v1
 *
 * 그렇다고 아무 데나 두 방식을 다 두드리지는 않는다. 안 되는 방식으로
 * 두드릴 때마다 401 이 하나씩 늘고 사람이 기다리는 시간도 그만큼 는다.
 * 그래서 **그 주소에서만** Bearer 를 먼저 본다.
 *
 * 여기서 고른 값이 그대로 프로필에 남아 매 요청에 실린다. 틀리면 열쇠가
 * 맞는데도 매번 401 이고, 화면에서는 열쇠가 틀린 것과 구별이 안 된다.
 */
function 맨틀인가(base) {
  // 호스트를 알아보는 규칙은 backend/toolfit.js 한 곳에 둔다. 여기에 사본을
  // 두면 AWS 가 이름을 하나 더 낼 때 한쪽만 고쳐진다.
  try { return 맨틀호스트인가(new URL(String(base)).hostname); }
  catch { return false; }
}

async function tryAnthropic(base, key, 막힌것 = null) {
  if (!key) return null;
  const 볼것 = 맨틀인가(base) ? ['bearer', 'x-api-key'] : ['x-api-key'];
  for (const auth of 볼것) {
    const r = await req(`${base}/models`, {
      headers: headersFor(auth, key, { 'anthropic-version': ANTHROPIC_VERSION }),
      timeout: 12000,
    });
    막은것적기(막힌것, r);
    if (막힌것?.먹통) return null;   // 안 답하는 곳을 인증 방식마다 또 기다리지 않는다 (시간다됨 머리말)
    /*
     * 목록 **모양**을 본다 — tryOpenAI 와 같은 잣대(모델목록모양 머리말). `data` 가 배열이기만
     * 보면 모든 길에 `{"data":[{"status":"ok"}]}` 를 주는 개발 서버가, OpenAI 쪽에서는 걸러지고
     * 여기로 넘어와 「anthropic · 모델 0개」 로 붙었다 (6회차 Gemini 알아내기6 E3). 사냥5 B5-08 이
     * 막은 고장이 뒷문으로 다시 들어온 것이다.
     */
    const 목록 = r.ok ? 모델목록모양(r.json) : null;
    if (목록) return { kind: 'anthropic', base, auth, models: normalizeModels(목록), ms: r.ms };
  }
  return null;
}

/** 이 규격을 먼저 볼 만한 단서가 있나. 열쇠 앞머리나 주소로만 본다. */
export function 앤트로픽같나(input, key) {
  if (/^sk-ant-/.test(String(key ?? '').trim())) return true;
  try {
    /*
     * 주소는 **candidates() 와 똑같이** 다듬고 본다.
     *
     * detect 는 origin 만 trim 하고 원본 input 은 그대로 여기로 넘긴다. 그래서
     * 앞뒤에 빈칸이 붙은 ` api.anthropic.com ` 은 여기서 URL 이 안 만들어져
     * false 가 됐다 — 정작 실제로 두드릴 주소는 candidates() 가 빈칸을 털어
     * 제대로 만든다. 단서를 잃으면 Anthropic 규격을 먼저 볼 기회를 놓치고,
     * OpenAI 쪽이 `{data:[...]}` 를 내주면 규격이 거기서 굳는다.
     * setup --url 은 사람이 붙여 넣은 글을 trim 도 안 하고 준다.
     */
    const 주소 = String(input ?? '').trim().replace(/\s+/g, '');
    const u = new URL(/^https?:\/\//i.test(주소) ? 주소 : 'https://' + 주소);
    if (/(^|\.)anthropic\.com$/i.test(u.hostname)) return true;
    /*
     * AWS mantle 의 Anthropic 창구. 길에 규격 이름이 적혀 있다.
     *
     *   bedrock-mantle.<리전>.api.aws/anthropic/v1
     *
     * 같은 호스트가 `/openai/v1` 도 함께 연다. 그래서 호스트만 보면 안 되고
     * **길까지** 봐야 한다 — 안 그러면 OpenAI 창구로 붙이려는 사람이
     * Anthropic 쪽으로 끌려간다.
     *
     * 이 단서가 없으면 OpenAI 규격으로 먼저 두드리게 되는데, 그쪽 서버가
     * 모르는 머리를 무시하고 `{data:[...]}` 를 내주면 규격이 openai 로
     * 굳어 버린다. 그러면 캐시 표식을 붙일 자리가 사라진다 — 이 창구를
     * 후보에 넣은 이유가 바로 그 표식이라, 순서 하나로 뜻이 없어진다.
     */
    if (맨틀인가(u.origin) && /(^|\/)anthropic(\/|$)/i.test(u.pathname)) return true;
    return false;
  } catch { return false; }
}

/**
 * 받은 JSON 이 **모델 목록 모양**인가. 맞으면 그 목록, 아니면 null (사냥5 B5-08).
 *
 * `r.json.data ?? r.json.models ?? []` 로 읽었더니 없는 칸이 곧 빈 목록이 됐다. 그래서
 * 모든 길에 `{"status":"ok"}` 나 `[]` 를 주는 개발 서버가 「openai · 모델 0개」 로 붙었고,
 * 사람은 모델이 안 올라온 줄 알고 엉뚱한 서버를 뒤졌다.
 *
 * 빈 목록은 받는다 — 모델을 아직 안 올린 LM Studio 가 실제로 `{"data":[]}` 를 준다.
 * 그러나 **칸은 있어야** 하고, 원소가 있으면 적어도 하나는 이름(id·name·model)을 가져야
 * 한다. scan.js 도 같은 잣대를 쓴다 — 설치와 훑기가 서로 다른 서버를 LLM 이라 부르면 안 된다.
 */
export function 모델목록모양(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const list = Array.isArray(json.data) ? json.data : (Array.isArray(json.models) ? json.models : null);
  if (!list) return null;
  const 이름있나 = (m) => (typeof m === 'string' && m.length > 0)
    || (!!m && typeof m === 'object' && !!(m.id ?? m.name ?? m.model));
  if (list.length && !list.some(이름있나)) return null;
  return list;
}

// OpenAI 호환인지 확인 (GET {base}/models). 막힌것은 막은것적기 머리말 참고.
async function tryOpenAI(base, key, 막힌것 = null) {
  const 적기 = (r) => 막은것적기(막힌것, r);
  for (const style of AUTH_STYLES) {
    if (style.id !== 'none' && !key) continue;
    if (style.id === 'none' && key) { /* 키를 줬어도 인증 없는 서버일 수 있으니 마지막에 본다 */ }
    const r = await req(`${base}/models`, { headers: headersFor(style.id, key), timeout: 12000 });
    적기(r);
    if (막힌것?.먹통) return null;   // 안 답하는 곳을 인증 방식마다 또 기다리지 않는다 (시간다됨 머리말)
    const 목록 = r.ok ? 모델목록모양(r.json) : null;
    if (목록) return { kind: 'openai', base, auth: style.id, models: normalizeModels(목록), ms: r.ms };
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
    /*
     * 2xx 인데 위에서 목록 모양이 아니었으면(JSON 이든 아니든) 이 규격이 아니다. 3xx 도
     * 같다 — 되돌림을 안 따라가므로, 모든 길을 `/login` 으로 보내는 관리 화면이 「HTTP 302」
     * 경고를 단 openai 로 굳었다. 둘 다 서버가 **다른 무엇**이라는 말이지 화가 난 것이
     * 아니다 (사냥5 B5-08).
     */
    /*
     * 405 도 같다. `/models` 가 GET 을 안 받는다는 말이라 모델 목록 문이 아니다 — 404 처럼 「이 길이
     * 아니다」 로 보고 다음으로 간다. 여태는 LLM 이 아닌 서버가 「openai · 인증 bearer」 초록색으로
     * 붙었고 짐작 표시도 없었다 (6회차 Gemini 알아내기6 E1). 400·402 는 그대로 둔다 — 서버가 요청을
     * 읽고 제 말로 답한 것이다(아래 머리말과 detect.test 의 402 검사).
     */
    const 이규격아님 = (r.status >= 200 && r.status < 400) || r.status === 405;
    if (r.status && !이규격아님 && ![401, 403, 0, 404].includes(r.status)) {
      /*
       * ── 답을 했다는 것과 **이 규격이라는 것**은 다른 말이다 ──────────────
       *
       * 사람이 본 것: 설치 화면이 초록색 「연결됨 · 인증 bearer」 로 끝나고,
       * 그 값이 프로필에 그대로 저장됐다. 그런데 첫 한마디부터 401 이다.
       * 열쇠를 다시 발급받고, 다시 넣고, 또 401 이다 — 화면 어디에도 인증
       * 방식을 우리가 **찍었다**는 말이 없으니 열쇠만 의심하게 된다.
       *
       * 실제로 있었던 일: `/models` 에 503 이 왔다. 5xx·429 는 앞단 프록시나
       * 로드밸런서도 낸다. 그 한 마디로 알 수 있는 것은 「거기 무언가가 있다」
       * 뿐인데, 우리는 규격을 openai 로 못 박고 **그때 쓰던 인증 방식**을
       * 같이 적어 뒀다. 차례상 맨 앞이라 대개 bearer 였다. 서버가 그 방식을
       * 받는다고 말한 적은 한 번도 없다.
       *
       * 이제 지키는 규칙: 서버가 한 말은 그대로 싣되, **짐작은 짐작이라고
       * 적는다.** 5xx·429 는 규격도 인증도 확인된 것이 아니다 — 그 한 줄이
       * 있으면 사람은 첫 401 에서 열쇠 대신 인증 방식을 먼저 본다.
       */
      const 서버말 = serverMessage(r);
      const 짐작 = r.status >= 500 || r.status === 429;
      return {
        kind: 'openai',
        base,
        auth: style.id,
        models: [],
        ms: r.ms,
        짐작,
        warn: 짐작
          ? `${서버말}\n서버가 HTTP ${r.status} 만 돌려줘서 규격도 인증도 확인 못 했습니다`
            + ` — 인증은 '${style.id}' 로 짐작해 적어 둡니다. 첫 한마디에서 401 이 나면`
            + ' 열쇠보다 /model 의 인증 방식을 먼저 보세요.'
          : 서버말,
      };
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
    // 상태 코드도 같이 넘긴다 — 401 을 받은 자리에 「주소를 고쳐 보세요」 라고
    // 적던 것이 이 자리의 고장이었다 (tryAzure 끝의 머리말).
    return {
      kind: null,
      tried,
      status: hit?.status ?? 0,
      why: hit?.why ?? 'Azure 주소로 보이는데 배포를 못 찾았습니다 — 주소에 /openai/deployments/<배포이름> 까지 넣어 보세요.',
    };
  }

  // 못 붙으면 무엇이 막았는지를 같이 돌려준다 — 부르는 쪽이 사람 말로 옮긴다
  // (providers/index.js 의 막힌까닭). tryOpenAI 머리말 참고.
  const 막힌것 = { status: 0, why: '' };

  // 단서가 있으면 이 규격을 먼저 본다 (tryAnthropic 머리말).
  // 후보들은 같은 호스트·포트에 길만 다르다. 한 번 먹통이면 나머지 후보도 같은 답이다 (시간다됨 머리말).
  const 먹통끝 = () => ({ kind: null, tried, status: 막힌것.status, why: 막힌것.why });

  if (앤트로픽같나(input, key)) {
    for (const base of candidates(input)) {
      tried.push(base);
      const hit = await tryAnthropic(base, key, 막힌것);
      if (hit) return { ...hit, tried };
      if (막힌것.먹통) return 먹통끝();
    }
  }

  // Ollama 를 먼저 본다 — 로컬이면 대개 이쪽이고 확인이 빠르다.
  // 두드린 자리는 여기서도 적는다. 이 갈래만 안 적어서, Ollama 로 붙으면
  // 「어디를 두드렸나」 화면(setup.js)이 이 갈래에서만 빈칸이었다.
  const 올라마주소 = /^https?:\/\//i.test(origin) ? origin : 'http://' + origin;
  if (!tried.includes(올라마주소)) tried.push(올라마주소);
  const oll = await tryOllama(올라마주소);
  if (oll) return { ...oll, tried };

  for (const base of candidates(input)) {
    if (!tried.includes(base)) tried.push(base);
    const hit = await tryOpenAI(base, key, 막힌것);
    if (hit) return { ...hit, tried };
    if (막힌것.먹통) return 먹통끝();
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
