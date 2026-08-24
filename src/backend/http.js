// HTTP 한 겹. 시간 제한과 오류 정규화, 그리고 나가도 되는 곳인지 확인한다.
//
// 이 파일이 프로그램에서 바깥으로 나가는 유일한 문이다.
// 나가기 전에 반드시 safety/network.js 의 문지기에게 물어본다.
import { checkUrl, NetBlocked } from '../safety/network.js';

export const AUTH_STYLES = [
  { id: 'bearer', label: 'Authorization: Bearer', apply: (h, k) => { h['Authorization'] = `Bearer ${k}`; } },
  { id: 'x-api-key', label: 'x-api-key', apply: (h, k) => { h['x-api-key'] = k; } },
  { id: 'api-key', label: 'api-key (Azure 계열)', apply: (h, k) => { h['api-key'] = k; } },
  { id: 'none', label: '인증 없음', apply: () => {} },
];

/**
 * 열어 둔 연결을 닫는다. 프로그램을 끝내기 직전에 부른다.
 *
 * fetch 는 연결을 재사용하려고 소켓을 살려 둔다(keep-alive). 그래서 할 일이
 * 끝나도 프로세스가 저절로 안 끝난다. 예전에는 그걸 process.exit() 으로
 * 잘라 냈는데, 윈도우에서 닫는 중인 핸들을 두고 끊으면 libuv 가 abort 한다.
 *
 *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c
 *
 * 실제로 `deel scan` 이 결과를 다 찍고 나서 이렇게 죽었다. 화면에는 정상으로
 * 보이는데 종료코드는 3221226505(0xC0000409) 였다.
 *
 * 그래서 잘라 내는 대신 닫는다. 이 자리는 Node 내부 이름이라 없을 수도 있으므로,
 * 없으면 조용히 넘어간다 — 그때는 부르는 쪽의 시간제한이 받아 준다.
 */
export function closeConnections() {
  try {
    const d = globalThis[Symbol.for('undici.globalDispatcher.1')];
    if (d && typeof d.close === 'function') return d.close().catch(() => {});
  } catch { /* 없으면 그만 */ }
  return Promise.resolve();
}

export function headersFor(authStyle, key, extra = {}) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json', ...extra };
  const style = AUTH_STYLES.find((s) => s.id === authStyle) ?? AUTH_STYLES[0];
  if (key) style.apply(h, key);
  return h;
}

export async function req(url, { method = 'GET', headers = {}, body, timeout = 20000, stream = false, signal = null } = {}) {
  const started = Date.now();
  try {
    checkUrl(url);   // 허용된 자리가 아니면 여기서 끝난다. 본문은 만들어지지도 않는다.
    // 시간 초과와 '사용자가 Ctrl+C' 를 둘 다 듣는다. 둘 중 먼저 오는 쪽이 끊는다.
    const sig = signal
      ? (AbortSignal.any ? AbortSignal.any([AbortSignal.timeout(timeout), signal]) : signal)
      : AbortSignal.timeout(timeout);
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: sig,
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
    // 막힌 것은 통신 실패와 다르다. 조용히 넘기면 자물쇠가 있는지도 모른다.
    if (err instanceof NetBlocked) throw err;
    // 사용자가 끊은 것도 실패가 아니다. 오류 화면을 띄우면 안 된다.
    if (signal?.aborted) throw new Aborted();
    return { ok: false, status: 0, error: normalizeError(err), ms };
  }
}

// 사용자가 Ctrl+C 로 끊었다는 뜻. 통신 오류와 구분하려고 따로 둔다.
export class Aborted extends Error {
  constructor() { super('사용자가 중단했습니다'); this.name = 'Aborted'; }
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
