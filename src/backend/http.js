// HTTP 한 겹. 시간 제한과 오류 정규화만 담당한다.

export const AUTH_STYLES = [
  { id: 'bearer', label: 'Authorization: Bearer', apply: (h, k) => { h['Authorization'] = `Bearer ${k}`; } },
  { id: 'x-api-key', label: 'x-api-key', apply: (h, k) => { h['x-api-key'] = k; } },
  { id: 'api-key', label: 'api-key (Azure 계열)', apply: (h, k) => { h['api-key'] = k; } },
  { id: 'none', label: '인증 없음', apply: () => {} },
];

export function headersFor(authStyle, key, extra = {}) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json', ...extra };
  const style = AUTH_STYLES.find((s) => s.id === authStyle) ?? AUTH_STYLES[0];
  if (key) style.apply(h, key);
  return h;
}

export async function req(url, { method = 'GET', headers = {}, body, timeout = 20000, stream = false } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow',
    });
    const ms = Date.now() - started;
    if (stream) return { ok: res.ok, status: res.status, res, ms };

    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, json, text, ms, headers: res.headers };
  } catch (err) {
    const ms = Date.now() - started;
    return { ok: false, status: 0, error: normalizeError(err), ms };
  }
}

function normalizeError(err) {
  const m = String(err?.message ?? err);
  if (err?.name === 'TimeoutError' || /timed? ?out/i.test(m)) return '시간 초과 — 응답이 없습니다';
  if (/ENOTFOUND|getaddrinfo/i.test(m)) return '주소를 찾을 수 없습니다 (DNS)';
  if (/ECONNREFUSED/i.test(m)) return '연결이 거부되었습니다 (서버가 꺼져 있거나 포트가 다릅니다)';
  if (/ECONNRESET/i.test(m)) return '연결이 끊겼습니다';
  if (/certificate|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(m)) return '인증서 문제 — 사내 인증서라면 NODE_EXTRA_CA_CERTS 가 필요합니다';
  if (/fetch failed/i.test(m)) return '연결 실패 — 주소·포트·프록시를 확인하세요';
  return m;
}

// 서버가 준 오류 본문에서 사람이 읽을 문장만 뽑는다.
export function serverMessage(r) {
  if (r.error) return r.error;
  const j = r.json;
  const cand = j?.error?.message ?? j?.error ?? j?.message ?? j?.detail;
  if (typeof cand === 'string') return cand;
  if (cand) return JSON.stringify(cand).slice(0, 200);
  if (r.text) return String(r.text).replace(/\s+/g, ' ').slice(0, 200);
  return `HTTP ${r.status}`;
}
