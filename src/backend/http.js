// HTTP 한 겹. 시간 제한과 오류 정규화, 그리고 나가도 되는 곳인지 확인한다.
//
// 이 파일이 프로그램에서 바깥으로 나가는 유일한 문이다.
// 나가기 전에 반드시 safety/network.js 의 문지기에게 물어본다.
//
// 길은 둘이고, 둘 다 이 파일 안에만 있다:
//   · 직접 — Node 의 fetch.
//   · node:http(s) 로 손수 — fetch 로 못 하는 두 가지를 여기서 한다.
//     ① 프록시 경유. HTTPS_PROXY 같은 것이 있을 때(backend/proxy.js 가 고른다)
//        Node 의 fetch 는 그 변수를 **안 본다.** 그래서 터널을 직접 뚫는다 —
//        node:http 로 프록시에 CONNECT 를 보내고, 열린 소켓 위에 node:tls 를
//        올리고, 그 위로 node:https 요청을 보낸다. http 대상은 프록시에 절대
//        주소로 그냥 보낸다.
//     ② 우리 인증서를 낼 때(mTLS). fetch 에는 인증서를 실을 자리가 없다
//        (backend/clientcert.js). 프록시와 겹치면 터널 위의 TLS 에 얹는다.
//     소켓을 만지는 코드가 이 파일 밖에 생기면 test/network.test.js 가 잡는다.
//
// 되돌림(redirect)은 어느 길이든 **한 홉마다** 문지기를 다시 지난다. fetch 의
// redirect:'follow' 는 옮겨 간 자리를 안 물어봐서, 서버가 다른 집으로 되돌리면
// 요청이 그리로 갔다. 이제는 그 홉에서 막히고, 다른 집으로 갈 때는 열쇠 머리말을 뗀다.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as tlsConnect } from 'node:tls';
import { Readable } from 'node:stream';
import { checkUrl, NetBlocked } from '../safety/network.js';
import { 프록시고르기 } from './proxy.js';
import { 인증서찾기 } from './clientcert.js';

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
 * 프록시 길은 요청마다 소켓을 새로 열고 끝나면 닫으므로(Connection: close) 여기 안 온다.
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
  // 앞뒤 공백·줄바꿈은 떼고 싣는다. 열쇠를 파일이나 메일에서 복사해 오면
  // 줄바꿈이 딸려 오는 일이 흔한데, 그것 하나로 요청이 아예 안 만들어진다.
  // 가운데 낀 것은 안 건드린다 — 그건 진짜 잘못된 열쇠이고, 조용히 고쳐 주면
  // 무엇이 틀렸는지 영영 모른다.
  const k = typeof key === 'string' ? key.trim() : key;
  if (k) style.apply(h, k);
  return h;
}

// 사용자가 Ctrl+C 로 끊었다는 뜻. 통신 오류와 구분하려고 따로 둔다.
export class Aborted extends Error {
  constructor() { super('사용자가 중단했습니다'); this.name = 'Aborted'; }
}

/**
 * JSON 을 주고받는 요청. 오류는 던지지 않고 { ok:false, error } 로 돌려준다 —
 * 부르는 쪽이 사람 말로 된 한 줄을 그대로 보여 주면 되게.
 * 자물쇠(NetBlocked)와 사용자 중단(Aborted)만 던진다. 둘은 통신 실패가 아니다.
 */
export async function req(url, { method = 'GET', headers = {}, body, timeout = 20000, stream = false, signal = null, 잠잠 = 0 } = {}) {
  const started = Date.now();
  try {
    const r = await 원시요청(url, {
      method, headers, timeout, stream, signal, 잠잠,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // 프록시가 407 로 막은 것은 통신 실패도 서버 답도 아니다. 사람 말 한 줄로 준다.
    if (r.error) return { ok: false, status: r.status, error: r.error, json: r.json ?? null, text: r.text ?? '', headers: r.headers, ms: r.ms };
    if (stream) return { ok: r.ok, status: r.status, res: r.res, ms: r.ms };
    return { ok: r.ok, status: r.status, json: r.json, text: r.text, ms: r.ms, headers: r.headers };
  } catch (err) {
    const ms = Date.now() - started;
    // 막힌 것은 통신 실패와 다르다. 조용히 넘기면 자물쇠가 있는지도 모른다.
    if (err instanceof NetBlocked) throw err;
    // 사용자가 끊은 것도 실패가 아니다. 오류 화면을 띄우면 안 된다.
    if (err instanceof Aborted || signal?.aborted) throw new Aborted();
    // 코드도 같이 준다. 사람 말(error)로는 "끊겼다" 와 "거부됐다" 를 가를 수 있지만
    // 다시 불러도 되는지(backend/retry.js)는 코드로 가르는 것이 정확하다.
    // 프록시가 터널을 거절한 것(407 등)은 상태 코드가 있다. 그 밖의 통신 실패는 0.
    return { ok: false, status: err?.code === 'PROXY_CONNECT' ? (err.status ?? 0) : 0, error: normalizeError(err), code: 오류코드(err), ms };
  }
}

const 되돌림상태 = new Set([301, 302, 303, 307, 308]);

/**
 * 요청 하나, 날것 그대로. 몸은 문자열·버퍼를 그대로 보내고, 오류는 그대로 던진다.
 * req() 와 WebFetch(tools/webfetch.js), 플러그인 받기(plugins/manage.js)가 이걸 쓴다 —
 * fetch 를 직접 부르는 자리는 이 파일 밖에 없어야 한다.
 *
 * @param {object} o
 *   되돌림(다음URL) — 되돌림을 따라가기 **전에** 부른다. 던지면 안 따라간다.
 *                    부르는 쪽이 제 규칙(사내망 거절 등)을 여기서 건다.
 * @returns 흘려 받기면 { ok, status, headers, res: { body(getReader), headers, text() }, ms }
 *          아니면       { ok, status, headers, bytes, text, json, ms }
 *          프록시가 407 로 막으면 { ok:false, status:407, error } (몸은 없다)
 */
export async function 원시요청(url, { method = 'GET', headers = {}, body, timeout = 20000, stream = false, signal = null, 되돌림 = null, 최대홉 = 5, 잠잠 = 0 } = {}) {
  const started = Date.now();
  let 지금 = String(url);
  let 방법 = method;
  let 몸 = body;
  let 머리 = { ...headers };
  for (let 홉 = 0; ; 홉++) {
    const 프록시 = 프록시고르기(지금);
    checkUrl(지금, 프록시?.url ?? null);   // 허용된 자리가 아니면 여기서 끝난다. 본문은 만들어지지도 않는다.
    /*
     * 우리 인증서를 내야 하는 주소인가 (backend/clientcert.js).
     *
     * **홉마다 다시 본다.** 되돌림을 따라 남의 집으로 가면 여기서 null 이 되어
     * 인증서가 안 따라간다 — 열쇠 머리말을 떼는 것과 같은 까닭이다. 신원을
     * 남에게 보여 주는 일이 조용히 일어나면 안 된다.
     */
    const 인증서 = 인증서찾기(지금);
    const r = (프록시 || 인증서)
      ? await 노드로(지금, { method: 방법, headers: 머리, body: 몸, timeout, stream, signal, 프록시, 인증서, 잠잠 })
      : await 직접(지금, { method: 방법, headers: 머리, body: 몸, timeout, stream, signal, 잠잠 });

    const loc = 되돌림상태.has(r.status) ? r.headers?.get?.('location') : null;
    if (loc && 홉 < 최대홉) {
      let 다음;
      try { 다음 = new URL(loc, 지금); } catch { return { ...r, ms: Date.now() - started }; }
      await r.버리기?.();               // 안 읽은 몸을 두고 다음 요청을 보내면 연결이 남는다.
      // 훅이 async 여도 기다린다 — 이름을 실제로 풀어 보는 검사(webfetch.js)가
      // 여기 붙는다. 안 기다리면 그 검사가 끝나기 전에 다음 홉이 나간다.
      await 되돌림?.(다음);
      // fetch 가 하는 대로: 303 은 GET 으로, POST 의 301·302 도 GET 으로, 307·308 은 그대로.
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && 방법 !== 'GET' && 방법 !== 'HEAD')) {
        방법 = 'GET';
        몸 = undefined;
      }
      // 다른 집으로 가면 열쇠 머리말은 뗀다 — 게이트웨이 열쇠가 딴 집으로 가면 안 된다.
      if (다음.origin !== new URL(지금).origin) {
        for (const k of Object.keys(머리)) {
          if (/^(authorization|x-api-key|api-key|proxy-authorization|cookie)$/i.test(k)) delete 머리[k];
        }
      }
      지금 = 다음.href;
      continue;
    }
    return { ...r, ms: Date.now() - started };
  }
}

/**
 * 흘려 받는 몸을 상한까지만 읽는다. 넘으면 끊고 null — 다 받아 놓고 버리지 않는다.
 * WebFetch(2MB)와 플러그인 받기(64MB)가 쓴다. 상한 없는 읽기는 한 자리(어댑터의 JSON 답)만 남긴다.
 */
export async function 몸읽기(body, 상한) {
  const reader = body.getReader();
  const 조각 = [];
  let 크기 = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    크기 += value.length;
    if (크기 > 상한) {
      try { await reader.cancel(); } catch { /* 끊는 중 오류는 그만 */ }
      return null;
    }
    조각.push(Buffer.from(value));
  }
  return Buffer.concat(조각);
}

// 시간 초과와 '사용자가 Ctrl+C' 를 둘 다 듣는다. 둘 중 먼저 오는 쪽이 끊는다.
function 신호(timeout, signal) {
  const 시계 = AbortSignal.timeout(timeout);
  if (!signal) return 시계;
  return AbortSignal.any ? AbortSignal.any([시계, signal]) : signal;
}

/*
 * ── 흘려 받는 동안의 시계는 '다 오는 데 걸린 시간' 이 아니다 ────────────
 *
 * `timeout` 하나로 요청 전체를 재면 두 가지가 한꺼번에 틀린다.
 *
 *   길게 답하는 모델   5분 상한에 걸려 **답을 잘 하고 있는데** 끊긴다.
 *                      생각을 많이 하는 모델이나 큰 파일을 고쳐 쓰는 답은
 *                      5분을 넘긴다. 사람 눈에는 그냥 죽은 것으로 보인다.
 *   멎어 버린 게이트웨이  10초 만에 멎었는데 5분을 꽉 채우고 나서야 안다.
 *                      그 5분 동안 화면은 커서만 깜빡인다.
 *
 * 둘 다 잘못 재고 있어서 생긴 일이다. 흘려 받는 자리에서 재야 하는 것은
 * **얼마나 오래 걸리나** 가 아니라 **얼마나 오래 잠잠한가** 다. 조각이 하나
 * 올 때마다 시계를 되감으면, 30분짜리 답은 안 끊기고 30초 멎은 연결은
 * 30초에 끊긴다.
 *
 * 그래서 시계를 둘로 나눈다.
 *   · 머리말까지 — `timeout`. 답이 시작조차 안 하는 것은 그냥 실패다.
 *   · 그 뒤 — `잠잠`. 조각이 올 때마다 되감는다.
 *
 * `잠잠` 을 안 주면 예전 그대로 하나의 시계로 잰다. 모델과 이야기하는 자리
 * (backend/adapter.js)만 이걸 켠다 — WebFetch·플러그인 받기는 몸 크기에
 * 상한이 있어서 이미 끝이 보장된다.
 */
/**
 * 잠잠 시계의 기본값. 60초 동안 한 글자도 안 오면 멎은 것으로 본다.
 *
 * 생각을 오래 하는 모델도 조각은 흘려보내므로 이 값에 안 걸린다. 답을 통째로
 * 모았다가 한 번에 주는 사내 게이트웨이만 걸리는데, 그건 설정에서 올린다
 * (프로필의 `잠잠`).
 */
export const 잠잠기본 = 60000;

export function 멎음오류(잠잠) {
  return Object.assign(
    new Error(`${초로(잠잠)}초 동안 아무것도 안 왔습니다 — 흐름이 멎었습니다`),
    { name: 'StallError', code: 'STALL', 잠잠 },
  );
}

/**
 * 밀리초를 사람에게 보여 줄 초로.
 *
 * 1초 밑으로 내려가도 **0 이라고는 안 한다.** 「0초 동안 아무것도 안 왔습니다」
 * 는 읽는 사람에게 거짓말이고, 그 한 줄 때문에 사람은 프로그램을 의심한다.
 */
export const 초로 = (ms) => Math.max(1, Math.round(ms / 1000));

/**
 * 흘려 받는 몸에 '잠잠하면 끊는' 시계를 건다.
 *
 * 시계가 이기면 밑에 있는 연결도 같이 끊는다(`끊기`). 안 끊으면 소켓이 열린
 * 채로 남아서, 프로그램이 안 끝나거나 다음 요청이 그 연결을 물려받는다.
 */
function 잠잠감시(몸, 잠잠, 끊기, 끝나면 = () => {}) {
  const reader = 몸.getReader();
  let 시계 = null;
  const 끄기 = () => { if (시계) { clearTimeout(시계); 시계 = null; } };
  return new ReadableStream({
    async pull(ctrl) {
      let 멎음 = null;
      const 읽기 = reader.read();
      // 시계가 이기면 이 약속은 나중에 끊긴 까닭으로 튕긴다. 아무도 안 받으면
      // unhandled rejection 으로 프로세스가 시끄러워진다 — 여기서 미리 받아 둔다.
      읽기.catch(() => {});
      const 잰다 = new Promise((_, 튕겨) => {
        시계 = setTimeout(() => { 멎음 = 멎음오류(잠잠); 끊기(멎음); 튕겨(멎음); }, 잠잠);
      });
      try {
        const { done, value } = await Promise.race([읽기, 잰다]);
        끄기();
        if (done) { 끝나면(); return ctrl.close(); }
        ctrl.enqueue(value);
      } catch (e) {
        끄기();
        const 탈 = 멎음 ?? e;
        끝나면();
        ctrl.error(탈);
        throw 탈;
      }
    },
    async cancel(왜) { 끄기(); 끝나면(); try { await reader.cancel(왜); } catch { /* 이미 닫혔으면 그만 */ } },
  });
}

// ── 직접 가는 길: fetch ─────────────────────────────────────────────────
async function 직접(url, { method, headers, body, timeout, stream, signal, 잠잠 = 0 }) {
  if (stream && 잠잠 > 0) return 직접흘려(url, { method, headers, body, timeout, signal, 잠잠 });
  const res = await fetch(url, { method, headers, body, signal: 신호(timeout, signal), redirect: 'manual' });
  if (stream) {
    return {
      ok: res.ok, status: res.status, headers: res.headers, res,
      버리기: async () => { try { await res.arrayBuffer(); } catch { /* 버리는 중 끊겨도 그만 */ } },
    };
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const text = bytes.toString('utf8');
  let json = null;
  try { json = JSON.parse(text); } catch { /* 글로만 오는 서버도 있다 */ }
  return { ok: res.ok, status: res.status, headers: res.headers, bytes, text, json };
}

/**
 * 직접 가면서 잠잠 시계를 쓰는 길.
 *
 * fetch 에 준 신호는 몸까지 같이 끊으므로 `AbortSignal.timeout` 을 그대로
 * 쓸 수 없다. 손잡이를 직접 쥐고, 머리말이 온 순간 시계를 바꿔 단다.
 */
async function 직접흘려(url, { method, headers, body, timeout, signal, 잠잠 }) {
  const 손 = new AbortController();
  let 까닭 = null;
  const 끊기 = (e) => { 까닭 = e; try { 손.abort(e); } catch { /* 이미 끊겼으면 그만 */ } };
  const 사람이 = () => 끊기(new Aborted());
  if (signal?.aborted) 사람이();
  else signal?.addEventListener('abort', 사람이, { once: true });
  const 귀떼기 = () => signal?.removeEventListener('abort', 사람이);

  const 머리시계 = setTimeout(
    () => 끊기(Object.assign(new Error('시간 초과 — 응답이 없습니다'), { name: 'TimeoutError', code: 'TimeoutError' })),
    timeout,
  );
  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: 손.signal, redirect: 'manual' });
  } catch (e) {
    귀떼기();
    throw 까닭 ?? e;
  } finally {
    clearTimeout(머리시계);
  }

  const 버리기 = async () => { 귀떼기(); try { await res.arrayBuffer(); } catch { /* 그만 */ } };
  // 몸이 없거나(304·되돌림) 거절이면 감시할 것이 없다. 거절 몸은 부르는 쪽이
  // res.text() 로 읽으므로 답을 그대로 넘긴다.
  if (!res.ok || !res.body) return { ok: res.ok, status: res.status, headers: res.headers, res, 버리기 };

  const 몸 = 잠잠감시(res.body, 잠잠, 끊기, 귀떼기);
  return {
    ok: true, status: res.status, headers: res.headers,
    res: { body: 몸, headers: res.headers, text: () => res.text() },
    버리기,
  };
}

/*
 * ── node:http(s) 로 직접 보내는 길 ──────────────────────────────────────
 *
 * 두 자리가 이 길로 온다.
 *   · 프록시를 거칠 때 — Node 의 fetch 는 HTTPS_PROXY 를 안 본다.
 *   · 우리 인증서를 낼 때(mTLS) — fetch 에는 인증서를 실을 자리가 없다.
 *
 * 둘 다 「fetch 로는 못 하는 것」 이라 길이 같다. 여기가 프록시 전용이던 시절
 * 이름이 프록시로 였는데, 인증서를 실으면서 아닌 자리가 생겼다.
 */
function 노드로(url, { method, headers, body, timeout, stream, signal, 프록시 = null, 인증서 = null, 잠잠 = 0 }) {
  const 대상 = new URL(url);
  const 포트 = Number(대상.port || (대상.protocol === 'https:' ? 443 : 80));
  /*
   * 신호를 손으로 쥔다.
   *
   * `AbortSignal.timeout` 을 섞어 버리면 **머리말이 온 뒤에 시계만 떼는** 것을
   * 못 한다. 잠잠 시계를 걸 자리(직접 가는 길의 직접흘려 와 같은 뜻)가 여기도
   * 있어야, 같은 게이트웨이인데 프록시를 켠 사람에게만 5분에서 답이 잘리는
   * — 설명하기 제일 어려운 — 모양이 안 생긴다.
   */
  const 손 = new AbortController();
  const sig = 손.signal;
  let 멎음 = null;
  let 시간초과 = false;
  let 머리시계 = setTimeout(() => { 시간초과 = true; 손.abort(); }, timeout);
  const 시계끄기 = () => { if (머리시계) { clearTimeout(머리시계); 머리시계 = null; } };
  const 사람이 = () => 손.abort();
  if (signal?.aborted) 손.abort();
  else signal?.addEventListener('abort', 사람이, { once: true });
  // 끊긴 까닭은 셋을 가른다 — 사람이 끊은 것 · 시계가 끊은 것 · 흐름이 멎은 것.
  // 화면에서 셋이 다른 말이고, 다시 불러도 되는지도 셋이 다르다.
  const 왜끊겼나 = () => (signal?.aborted ? new Aborted()
    : 멎음 ?? (시간초과
      ? Object.assign(new Error('시간 초과 — 응답이 없습니다'), { name: 'TimeoutError', code: 'TimeoutError' })
      : new Aborted()));

  return new Promise((resolve, reject) => {
    let rq = null;
    let 응답 = null;
    let 끝났나 = false;
    const 정리 = () => {
      시계끄기();
      sig.removeEventListener('abort', 끊기);
      signal?.removeEventListener('abort', 사람이);
    };
    const 실패 = (e, 프록시탓 = false) => {
      if (끝났나) return;
      끝났나 = true;
      정리();
      if (프록시탓 && 프록시) e.프록시 = 프록시.url;
      reject(e);
    };
    const 끊기 = () => {
      const e = 왜끊겼나();
      // 이미 답을 돌려준 뒤(흘려 받는 중)라도 소켓은 끊는다 — 읽는 쪽이 **이 까닭**으로 멈춘다.
      // 요청만 끊으면 읽는 쪽에는 'aborted' 라는 맹숭한 오류가 간다. 답 쪽을 먼저 그 까닭으로 끊는다.
      if (응답) { try { 응답.destroy(e); } catch { /* 이미 닫혔으면 그만 */ } }
      if (rq) { try { rq.destroy(e); } catch { /* 이미 닫혔으면 그만 */ } }
      실패(e);
    };
    sig.addEventListener('abort', 끊기, { once: true });

    const 받기 = (res) => {
      응답 = res;
      const 머리 = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (v != null) 머리.set(k, Array.isArray(v) ? v.join(', ') : String(v));
      }
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      const 마침 = (값) => { if (끝났나) return; 끝났나 = true; 정리(); resolve(값); };
      // 프록시가 인증을 요구한 것은 서버 답이 아니다. 사람 말로 바꿔 준다.
      if (res.statusCode === 407) {
        res.resume();
        return 마침({ ok: false, status: 407, headers: 머리, bytes: Buffer.alloc(0), text: '', json: null, error: 인증말(머리.get('proxy-authenticate'), 프록시) });
      }
      if (stream && ok) {
        /*
         * 흘려 받는 동안에는 끊기 귀를 **계속 열어 둔다.** 머리말이 왔다고 귀를 닫으면
         * 그 뒤의 Ctrl+C 가 소켓을 못 끊어서, 답이 다 올 때까지 화면이 안 멈춘다
         * (평가에서 잡혔다 — 직접 갈 때는 2ms, 프록시로 갈 때는 안 멈췄다).
         * 몸이 다 오거나 끊기면(close) 그때 닫는다.
         */
        let body = Readable.toWeb(res);
        res.once('close', 정리);
        // 잠잠 시계를 쓰면 머리말까지만 재던 시계는 여기서 끈다.
        if (잠잠 > 0) {
          시계끄기();
          body = 잠잠감시(body, 잠잠, (e) => { 멎음 = e; 손.abort(); });
        }
        if (!끝났나) { 끝났나 = true; resolve({
          ok, status: res.statusCode, headers: 머리,
          res: { body, headers: 머리, text: () => 다읽기(res) },
          버리기: async () => { try { res.resume(); await new Promise((r) => res.once('close', r)); } catch { /* 그만 */ } },
        }); }
        return;
      }
      다읽기(res).then((text) => {
        const bytes = Buffer.from(text, 'utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* 글로만 오는 서버도 있다 */ }
        // 흘려 받으려다 거절당한 것도 여기로 온다. adapter 의 거절읽기가 res.text() 를 부른다.
        마침({ ok, status: res.statusCode, headers: 머리, bytes, text, json, res: { headers: 머리, text: async () => text } });
      }, (e) => 실패(e));
    };

    (async () => {
      try {
        if (대상.protocol === 'https:' && 프록시) {
          // 프록시가 뚫어 준 터널 위에 TLS 를 올린다. 우리 인증서도 그 위에서
          // 낸다 — 프록시 뒤라고 mTLS 가 안 되면 사내에서는 아무 쓸모가 없다.
          const socket = await 터널(대상.hostname, 포트, 프록시, sig, 왜끊겼나, 인증서);
          if (sig.aborted) { socket.destroy(); return 끊기(); }
          // agent 를 **주지 않아야** createConnection 을 쓴다. agent: false 를 주면 Node 가
          // 새 Agent 를 만들어 제 소켓으로 직접 나가고, 터널 소켓은 열린 채 버려진다 —
          // 프록시를 거치지 않았는데 답은 오니(대상이 닿는 자리면) 알아채기 어렵다.
          rq = httpsRequest({
            createConnection: () => socket,
            host: 대상.hostname, port: 포트, path: 대상.pathname + 대상.search, method,
            headers: { ...headers, Host: 대상.host },
          }, 받기);
        } else if (대상.protocol === 'https:') {
          /*
           * 프록시 없이 곧장 가면서 우리 인증서를 낸다.
           *
           * `fetch` 로는 이 자리를 못 만든다 — 인증서를 실을 데가 없다. 그래서
           * 인증서를 쓰는 요청만 이 길로 온다 (backend/clientcert.js 머리말).
           */
          rq = httpsRequest({
            host: 대상.hostname, port: 포트, path: 대상.pathname + 대상.search, method,
            headers: { ...headers, Host: 대상.host },
            agent: false,
            ...(인증서 ?? {}),
          }, 받기);
        } else if (프록시) {
          const 머리 = { ...headers, Host: 대상.host };
          if (프록시.auth) 머리['Proxy-Authorization'] = 프록시.auth;
          rq = httpRequest({ host: 프록시.host, port: 프록시.port, agent: false, path: url, method, headers: 머리 }, 받기);
          rq.once('error', (e) => 실패(e, /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ECONNRESET/.test(e?.code ?? '')));
        } else {
          // http 인데 인증서가 등록된 자리. 인증서는 TLS 위에서만 뜻이 있으므로
          // 실을 것이 없다 — 그냥 평범하게 보낸다.
          rq = httpRequest({
            host: 대상.hostname, port: 포트, agent: false,
            path: 대상.pathname + 대상.search, method, headers: { ...headers, Host: 대상.host },
          }, 받기);
        }
        if (sig.aborted) return 끊기();
        rq.once('error', (e) => 실패(e));
        if (body !== undefined) rq.write(body);
        rq.end();
      } catch (e) { 실패(e); }
    })();
  });
}

/*
 * CONNECT 로 터널을 뚫고 그 위에 TLS 를 올린다. 소켓 하나를 돌려준다.
 *
 * SNI 는 이름일 때만 붙인다. IP 에 붙이면 Node 가 경고를 낸다(DEP0123). IP 대상은
 * host 로 넘겨서 인증서의 IP SAN 과 견주게 한다.
 */
function 터널(hostname, port, 프록시, sig, 왜끊겼나, 인증서 = null) {
  return new Promise((resolve, reject) => {
    const 머리 = { Host: `${hostname}:${port}` };
    if (프록시.auth) 머리['Proxy-Authorization'] = 프록시.auth;
    const rq = httpRequest({
      host: 프록시.host, port: 프록시.port, agent: false,
      method: 'CONNECT', path: `${hostname}:${port}`, headers: 머리,
    });
    const 끊기 = () => rq.destroy(왜끊겼나());
    sig.addEventListener('abort', 끊기, { once: true });
    const 정리 = () => sig.removeEventListener('abort', 끊기);

    rq.once('connect', (res, socket, head) => {
      정리();
      if (res.statusCode !== 200) {
        socket.destroy();
        const e = new Error(res.statusCode === 407
          ? 인증말(res.headers['proxy-authenticate'], 프록시)
          : `프록시(${프록시.url})가 터널을 거절했습니다 (HTTP ${res.statusCode})`);
        e.status = res.statusCode;
        e.code = 'PROXY_CONNECT';
        return reject(e);
      }
      if (head?.length) socket.unshift(head);
      const 이름 = /^[\d.]+$|:/.test(hostname) ? undefined : hostname;
      // 우리 인증서도 이 위에서 낸다 — 프록시 뒤에서 mTLS 가 안 되면
      // 사내(프록시 필수 + 인증서 필수)에서는 붙는 방법이 아예 없다.
      const tls = tlsConnect({ socket, host: hostname, servername: 이름, ...(인증서 ?? {}) }, () => resolve(tls));
      tls.once('error', reject);     // 대상 인증서 문제 — 프록시 탓이 아니라 표시를 안 붙인다
      // TLS 층이 닫혀도 밑의 프록시 소켓은 저절로 안 닫힌다. 그대로 두면 요청마다 소켓이
      // 하나씩 남아 프로세스가 안 끝난다 (deel run 이 답을 찍고도 안 나가는 모양이 된다).
      tls.once('close', () => socket.destroy());
    });
    rq.once('error', (e) => { 정리(); e.프록시 = 프록시.url; reject(e); });
    rq.end();
  });
}

function 다읽기(res) {
  return new Promise((resolve, reject) => {
    const 조각 = [];
    res.on('data', (d) => 조각.push(d));
    res.once('end', () => resolve(Buffer.concat(조각).toString('utf8')));
    res.once('error', reject);
  });
}

// 프록시가 407 을 줬을 때 사람이 칠 것까지 적어 준다. NTLM·Negotiate 는 못 하니 그렇다고 말한다.
// 칠 자리는 **지금 그 프록시를 읽어 온 곳**이다 — HTTP_PROXY 로 정한 사람에게 HTTPS_PROXY 를
// 고치라고 하면 고쳐도 안 바뀐다 (평가에서 잡혔다).
function 인증말(도전, 프록시) {
  const s = String(도전 ?? '');
  if (/ntlm|negotiate/i.test(s)) {
    return `프록시(${프록시.url})가 ${/ntlm/i.test(s) ? 'NTLM' : 'Negotiate'} 인증을 요구합니다 — 이 방식은 지원하지 않습니다.`
      + ' 사내 담당자에게 Basic 인증이나 인증 없는 프록시 주소를 문의하세요.';
  }
  const 주소 = `http://user:pw@${프록시.host}:${프록시.port}`;
  const 자리 = 프록시.출처 === 'config'
    ? `설정 파일의 "proxy": "${주소}"`
    : `${프록시.출처 ?? 'HTTPS_PROXY'}=${주소}`;
  return `프록시(${프록시.url})가 인증을 요구합니다 (407${s ? ` · ${s.slice(0, 60)}` : ''})`
    + ` — 프록시 주소에 user:pw@ 를 넣으세요: ${자리}`;
}

// fetch 가 던진 것에서 코드 하나를 뽑는다. undici 는 원인을 cause 에 싸서 준다.
function 오류코드(err) {
  return err?.cause?.code ?? err?.code ?? err?.cause?.name ?? err?.name ?? null;
}

// fetch 는 무슨 일이든 'fetch failed' 라고만 말하고 까닭은 cause 에 숨긴다. 그래서
// 말(m)만 보지 않고 코드도 본다 — 안 그러면 DNS 실패도 "주소·포트·프록시를 확인하세요" 가 된다.
function normalizeError(err) {
  const m = String(err?.message ?? err);
  const 코드 = String(오류코드(err) ?? '');
  const 기본 = (() => {
    if (err?.code === 'PROXY_CONNECT') return m;
    // 우리 인증서 파일을 못 읽은 것. 이건 통신 실패가 아니라 **경로가 틀린**
    // 것이고, 그 말은 이미 사람 말로 지어 두었다 (backend/clientcert.js).
    if (err?.code === 'CERT_READ') return m;
    // 흐름이 멎어서 우리가 끊은 것. 서버가 끊은 것과 다른 말이어야 한다.
    if (err?.code === 'STALL') return `${m} — 답을 통째로 모았다가 주는 게이트웨이면 프로필의 잠잠 을 올려 보세요`;
    if (err?.name === 'TimeoutError' || 코드 === 'TimeoutError' || /timed? ?out/i.test(m)) return '시간 초과 — 응답이 없습니다';
    if (/ENOTFOUND|EAI_AGAIN/.test(코드) || /ENOTFOUND|getaddrinfo/i.test(m)) return '주소를 찾을 수 없습니다 (DNS)';
    if (코드 === 'ECONNREFUSED' || /ECONNREFUSED/i.test(m)) return '연결이 거부되었습니다 (서버가 꺼져 있거나 포트가 다릅니다)';
    // 받아 놓고 끊은 것 — 서버가 꺼진 것과 다르다. "주소를 확인하라" 는 틀린 조언이다.
    if (/ECONNRESET|EPIPE|UND_ERR_SOCKET/.test(코드) || /ECONNRESET|other side closed/i.test(m)) return '서버가 연결을 끊었습니다';
    if (/certificate|SELF_SIGNED|UNABLE_TO_VERIFY|CERT_/i.test(m + ' ' + 코드)) return '인증서 문제 — 사내 인증서라면 NODE_EXTRA_CA_CERTS 가 필요합니다';
    /*
     * 헤더에 한글이 섞였다.
     *
     * HTTP 헤더는 Latin-1 만 실린다. 열쇠에 한글이나 특수문자가 한 글자라도
     * 있으면 요청이 만들어지지도 않고 `ByteString` 소리를 하는 오류가 난다 —
     * 그대로 보여 주면 사람은 서버를 의심하고 방화벽부터 뒤진다. 실제로는
     * 열쇠를 붙여넣다 한글이 섞였거나 따옴표가 딸려 온 것이다.
     */
    /*
     * `invalid header value` 도 같이 잡는 이유 — **여기가 열쇠 유출 자리다.**
     *
     * 헤더 값이 못 실릴 때 런타임이 내는 말이 두 가지다.
     *   한글이 섞였을 때   Cannot convert … ByteString … character at index 23
     *   줄바꿈·NUL 이 섞였을 때  Headers.append: "sk-진짜열쇠…" is an invalid header value.
     *
     * 뒤엣것은 **열쇠를 그대로 따옴표 안에 넣어서** 말한다. 그 문구는 화면에도
     * 뜨고 진단 보고서 파일에도 적히는데, 그 파일은 "사내망에서 돌렸다면 이것만
     * 가져오시면 됩니다" 라고 우리가 권하는 파일이다. 열쇠를 파일에 안 남기려고
     * 잠금장치까지 붙여 놓고, 오류 한 줄로 평문으로 흘리는 셈이었다.
     *
     * 그래서 두 가지를 한 자리에서 잡아 **우리 문장으로 갈아 끼운다.** 원문을
     * 안 보여 주는 것이 여기서는 친절이 아니라 안전이다.
     */
    if (/ByteString|character at index|invalid header (value|name)/i.test(m)) return '열쇠(또는 헤더)에 한글·특수문자가 섞여 있습니다 — API 키는 영문·숫자만 실립니다. 붙여넣을 때 따옴표나 줄바꿈이 딸려 오지 않았는지 보세요';
    if (/fetch failed/i.test(m)) return '연결 실패 — 주소·포트·프록시를 확인하세요';
    return m;
  })();
  // 프록시까지 못 간 것은 게이트웨이 탓이 아니다. 어느 프록시였는지 적어야 사람이 고친다.
  if (err?.프록시 && err?.code !== 'PROXY_CONNECT') return `프록시(${err.프록시})에 닿지 못했습니다 — ${기본}`;
  return 기본;
}

// 게이트웨이 앞단 프록시가 자격증명을 받아오다 실패한 것을 알아본다.
//
// 사내 게이트웨이는 앞에 프록시를 두고, 프록시가 매번 바깥 명령을 돌려 토큰을 받아 온다.
// 그 명령이 실패하면 이런 것이 본문에 실려 온다 —
//
//   [PROXY ERROR] Command '['databricks', 'auth', 'token', '--host', 'dbc-...',
//                 '--profile', 'a@b.com', '-o', 'json']' returned non-zero exit status 1.
//
// 이걸 그대로 뱉으면 쓸모가 없다. 모델도 deel 도 아니고 **그 PC 의 로그인이 만료된 것**인데,
// 화면만 보고는 무엇을 해야 할지 알 수가 없다(실제로 겪었다).
// 그래서 명령·호스트·프로필을 뽑아 칠 것까지 만들어 준다. 못 알아보면 null 이다.
export function 프록시힌트(말) {
  const s = String(말 ?? '');
  if (!/returned non-zero exit status/i.test(s)) return null;
  // 바깥 따옴표가 대괄호까지 감싸고 있어 그냥 따옴표로 끊으면 짝이 어긋난다. 대괄호 안만 본다.
  // 단 앞머리의 `[PROXY ERROR]` 도 대괄호라 먼저 걸린다 — 따옴표로 시작하는 것만 골라야 한다.
  const 인자 = [...(s.match(/\[(\s*'[^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1]);
  const 도구 = 인자[0] || '외부 명령';
  const 뒤 = (이름) => { const i = 인자.indexOf(이름); return i >= 0 ? (인자[i + 1] ?? null) : null; };

  if (도구 === 'databricks') {
    const host = 뒤('--host');
    const profile = 뒤('--profile');
    const 다시 = ['databricks auth login',
      host ? `--host ${/^https?:\/\//.test(host) ? host : `https://${host}`}` : null,
      profile ? `--profile ${profile}` : null].filter(Boolean).join(' ');
    return `게이트웨이가 Databricks 토큰을 못 받았습니다 — 모델이 아니라 로그인이 만료된 것입니다.\n`
      + `그 PC 에서 다시 로그인하세요:  ${다시}`;
  }
  return `게이트웨이 앞단 프록시가 '${도구}' 를 돌리다 실패했습니다 — 모델이 아니라 프록시 쪽 문제입니다.`;
}

// 서버가 준 오류 본문에서 사람이 읽을 문장만 뽑는다.
export function serverMessage(r) {
  if (r.error) return r.error;
  const j = r.json;
  const cand = j?.error?.message ?? j?.error ?? j?.message ?? j?.detail;
  let 말;
  if (typeof cand === 'string') 말 = cand;
  else if (cand) 말 = JSON.stringify(cand).slice(0, 200);
  else if (r.text) 말 = String(r.text).replace(/\s+/g, ' ').slice(0, 200);
  else return `HTTP ${r.status}`;
  // 알아본 것이 있으면 원문 대신 그것을 앞에 세운다. 원문은 뒤에 한 줄로 남긴다 —
  // 사내 담당자에게 그대로 보여 줘야 할 때가 있다.
  const 힌트 = 프록시힌트(말);
  return 힌트 ? `${힌트}\n원문: ${말.slice(0, 160)}` : 말;
}
