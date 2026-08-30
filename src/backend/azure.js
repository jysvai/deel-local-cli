// Azure OpenAI — 주소 모양이 다르다.
//
// ── 왜 따로 다루나 ─────────────────────────────────────────────────────
//
// 사내에서 OpenAI 를 쓰는 한국 회사는 대개 Azure 를 거친다. 그런데 Azure 는
// OpenAI 호환이라면서 **주소 모양만 다르다.**
//
//   보통      https://gw.example.com/v1/chat/completions
//   Azure     https://<이름>.openai.azure.com/openai/deployments/<배포>/chat/completions?api-version=2024-10-21
//
// 다른 점이 네 군데다.
//
//   1) 모델 이름이 주소 안에 있다 — 몸통의 `model` 이 아니라 **배포 이름**이다.
//   2) `?api-version=` 이 없으면 400 이다. 이건 옵션이 아니라 필수다.
//   3) 모델 목록이 `/models` 가 아니라 `/openai/deployments` 에 있다.
//   4) 열쇠는 `Authorization: Bearer` 가 아니라 `api-key` 헤더다.
//
// 그래서 사람이 포털에서 복사한 주소를 그대로 넣으면 지금까지는
// `.../openai/deployments/gpt-4o/v1/models` 를 두드리다 "연결 실패" 로 끝났다.
// 주소는 맞는데 우리가 모양을 몰랐던 것이라, 사람이 고칠 방법도 없었다.
//
// ── 판 번호를 왜 우리가 정하나 ─────────────────────────────────────────
//
// `api-version` 은 Azure 가 정하는 날짜다. 우리가 아무 값이나 쓰면 안 되고,
// 사람이 모르면 넣을 수도 없다. 그래서 GA 판 하나를 기본으로 두고, 주소에
// 이미 적혀 있으면 **그쪽을 따른다** — 사내 정책으로 판을 고정해 둔 곳이 있다.
// 설정(`apiVersion`)과 환경변수로도 바꾼다.
const 기본판 = '2024-10-21';

let 정한판 = 기본판;

/** 설정·환경변수에서 판 번호를 정한다. config.load() 가 부른다. */
export function 애저정하기({ env = process.env, config = null } = {}) {
  const 값 = String(env.DEEL_AZURE_API_VERSION ?? config?.apiVersion ?? '').trim();
  정한판 = 값 || 기본판;
  return 정한판;
}

/** 지금 쓰는 판 번호. */
export function 지금판() { return 정한판; }

/** 검사가 원래대로 돌려놓을 때. */
export function 판되돌리기() { 정한판 = 기본판; return 정한판; }

// Azure 가 쓰는 호스트들. 포털이 주는 이름이 서비스마다 다르다.
const 애저호스트 = /\.(openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)$/i;

/** 이 주소가 Azure 인가. 호스트로 보고, 아니면 경로 모양으로 본다. */
export function 애저인가(input) {
  const s = String(input ?? '').trim();
  if (!s) return false;
  const u = 뜯기(s);
  if (!u) return /\/openai\/deployments(\/|\?|$)/i.test(s);
  return 애저호스트.test(u.hostname) || /\/openai\/deployments(\/|$)/i.test(u.pathname);
}

function 뜯기(s) {
  try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); }
  catch { return null; }
}

/**
 * 사람이 복사해 온 주소를 우리가 쓸 모양으로 푼다.
 *
 * 포털·문서·curl 예시가 저마다 다른 자리까지 준다. 다 받는다.
 *
 *   https://<이름>.openai.azure.com
 *   https://<이름>.openai.azure.com/
 *   https://<이름>.openai.azure.com/openai/deployments/gpt-4o
 *   https://<이름>.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-06-01
 *
 * @returns {{origin:string, 배포:string|null, 판:string, base:string|null, 목록주소:string}|null}
 */
export function 애저풀기(input) {
  const u = 뜯기(String(input ?? '').trim());
  if (!u) return null;

  // 주소에 판이 적혀 있으면 그 말을 따른다 — 사내에서 판을 고정해 둔 곳이 있다.
  const 판 = (u.searchParams.get('api-version') || '').trim() || 정한판;

  const 조각 = u.pathname.split('/').filter(Boolean);
  const i = 조각.findIndex((x) => x.toLowerCase() === 'deployments');
  // `/openai/deployments/<배포>` 뒤에 붙은 `chat/completions` 같은 것은 버린다 —
  // 우리가 다시 붙일 것이라, 두 번 붙으면 404 가 된다.
  const 배포 = i >= 0 && 조각[i + 1] ? decodeURIComponent(조각[i + 1]) : null;

  const origin = `${u.protocol}//${u.host}`;
  return {
    origin,
    배포,
    판,
    base: 배포 ? `${origin}/openai/deployments/${encodeURIComponent(배포)}?api-version=${encodeURIComponent(판)}` : null,
    목록주소: `${origin}/openai/deployments?api-version=${encodeURIComponent(판)}`,
  };
}

/** 배포 이름 하나로 쓸 주소를 만든다. */
export function 애저base(origin, 배포, 판 = 정한판) {
  return `${String(origin).replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(배포)}?api-version=${encodeURIComponent(판)}`;
}

/**
 * 배포 목록 응답을 모델 목록으로.
 *
 * Azure 는 `{data:[{id, model, status}]}` 로 준다. 사람에게 보여 줄 이름은
 * **배포 이름**(id)이다 — 주소에 들어가는 것이 그것이고, 밑에 깔린 모델
 * 이름(gpt-4o)은 같은 것이 여러 배포에 붙을 수 있어 고를 때 도움이 안 된다.
 */
export function 배포목록(json) {
  const 것들 = json?.data ?? json?.value ?? [];
  if (!Array.isArray(것들)) return [];
  return 것들
    .map((d) => ({
      id: d.id ?? d.name ?? d.deploymentId ?? null,
      note: [d.model, d.status && d.status !== 'succeeded' ? d.status : null].filter(Boolean).join(' · '),
    }))
    .filter((m) => m.id);
}
