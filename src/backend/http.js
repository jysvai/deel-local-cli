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
// 소켓을 만드는 것이 아니다 — 프록시·인증서 길에서 받은 몸의 압축을 푼다 (아래 몸풀기).
import { createUnzip, createBrotliDecompress } from 'node:zlib';
import { checkUrl, NetBlocked } from '../safety/network.js';
import { 프록시고르기 } from './proxy.js';
import { 인증서찾기 } from './clientcert.js';
import { 말 as 옮긴말 } from '../i18n/index.js';

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
export async function req(url, { method = 'GET', headers = {}, body, timeout = 20000, stream = false, signal = null, 잠잠 = 0, 연결 = 연결기본 } = {}) {
  const started = Date.now();
  try {
    const r = await 원시요청(url, {
      method, headers, timeout, stream, signal, 잠잠, 연결,
      /*
       * ── 반쪽 글자는 싣지 않는다 (2.0.0 6회차 직접 사냥) ──────────────────
       *
       * Read · Grep · Bash 가 결과를 상한에서 자를 때 이모지 앞쪽 반이 남는다(홀짝에
       * 따라 — 탐침으로 셋 다 확인). JSON.stringify 는 그것을 `\ud83c` 낱개 이스케이프로
       * 싣고, 짝 없는 서로게이트를 거절하는 서버면 그 결과가 대화에 남는 동안 **모든
       * 턴이** 400 이다. pdf.js 는 제 자르는 자리에서 떼고 있었지만 자르는 자리는 여럿이다.
       * 나가는 문은 여기 하나라 여기서 U+FFFD 로 바꾼다. 온전한 글은 바이트 하나 안
       * 바뀌므로 캐시 앞머리도 그대로다.
       */
      body: body === undefined ? undefined : JSON.stringify(body, (_, v) => (typeof v === 'string' && !v.isWellFormed() ? v.toWellFormed() : v)),
    });
    // 프록시가 407 로 막은 것은 통신 실패도 서버 답도 아니다. 사람 말 한 줄로 준다.
    if (r.error) return { ok: false, status: r.status, error: r.error, json: r.json ?? null, text: r.text ?? '', headers: r.headers, ms: r.ms };
    // 되돌림을 못 따라간 까닭(고리 · 횟수 · 깨진 Location)도 오류 말로 넘긴다. 여기서 버려서 모델 창구가
    // 제자리를 돌면 화면에 「HTTP 302」 만 남았다 (2.0.0 6회차 Gemini 전송6). serverMessage 가 error 를 먼저 쓴다.
    if (r.되돌림탈) return { ok: false, status: r.status, error: r.되돌림탈, 되돌림탈: r.되돌림탈, json: r.json ?? null, text: r.text ?? '', headers: r.headers, ms: r.ms };
    /*
     * 흘려 받아도 **머리말은 같이 준다** (사냥6 막판-뒷단).
     *
     * 여기가 `{ ok, status, res, ms }` 였다. 그래서 흘려 받다 429 를 맞은 자리에서 부르는
     * 쪽의 `r.headers.get('retry-after')` 가 늘 null 이었다 — `?.` 로 읽으니 터지지도 않고,
     * 서버가 적어 보낸 초를 못 읽은 채 제 기본값으로 다시 쐈다(backend/probe.js 의 call).
     * 통째로 받는 갈래는 바로 아랫줄에서 주고 있었으니, 같은 서버인데 흘려 받나에 따라
     * 갈렸다. retry.js 의 다시부를지 만 `r.res.headers` 뒷길로 한 번 더 봐서 살아남았다 —
     * 그 뒷길이 이 구멍을 가리고 있었다. 원시요청 은 두 갈래 다 headers 를 준다.
     */
    if (stream) return { ok: r.ok, status: r.status, res: r.res, headers: r.headers, ms: r.ms };
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
 *          — 다만 **실패한 응답에는 body 가 없다** (읽을 것이 흐름이 아니라 거절 글이다).
 *            부르는 쪽은 `ok` 를 먼저 보고 body 를 만져야 한다 (adapter 의 거절읽기 참고).
 *          아니면       { ok, status, headers, bytes, text, json, ms }
 *          프록시가 407 로 막으면 { ok:false, status:407, error } (몸은 없다)
 */
export async function 원시요청(url, { method = 'GET', headers = {}, body, timeout = 20000, stream = false, signal = null, 되돌림 = null, 최대홉 = 5, 잠잠 = 0, 연결 = 연결기본 } = {}) {
  const started = Date.now();
  let 지금 = String(url);
  let 방법 = method;
  let 몸 = body;
  let 머리 = { ...headers };
  // 지나온 주소들 — 되돌림이 제자리를 도는지 말하려고 든다 (아래 되돌림탈).
  const 지나온 = new Set([지금]);
  let 고리 = false;
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
    /*
     * 잠잠 시계를 안 주면 **머리말에 준 상한과 같은 값**으로 잰다 (위 잠잠기본 머리말).
     *
     * 이게 0 이면 머리말이 온 뒤에도 전체 시계가 살아 있어서, 잘 흐르는 답이 timeout 에
     * 잘린다 — 299줄이 「머리말이 오는 순간 꺼진다」 고 무조건으로 약속한 바로 그 자리다.
     * 머리말이 **아예 안 오는** 진짜 먹통은 그대로 timeout 이 받는다. 이 시계는 머리말이
     * 온 뒤부터 도는 시계라 거기까지는 닿지 않는다.
     */
    const 잰다 = 잠잠 > 0 ? 잠잠 : (timeout > 0 ? timeout : 잠잠기본);
    const r = (프록시 || 인증서)
      ? await 노드로(지금, { method: 방법, headers: 머리, body: 몸, timeout, stream, signal, 프록시, 인증서, 잠잠: 잰다, 연결 })
      : await 직접(지금, { method: 방법, headers: 머리, body: 몸, timeout, stream, signal, 잠잠: 잰다 });

    const loc = 되돌림상태.has(r.status) ? r.headers?.get?.('location') : null;
    if (loc) {
      /*
       * ── 못 따라가는 되돌림은 **왜 못 따라가는지** 붙여 돌려준다 (사냥4 W19) ──
       *
       * 여태는 Location 을 못 읽어도, 다섯 번을 넘겨도 3xx 답을 말없이 그대로 돌려줬다.
       * 부르는 쪽(WebFetch)은 그걸 받아 「HTTP 302 — 주소」 한 줄만 적었다. 그 줄로는
       * 서버가 제자리를 돌고 있다는 것도, 주소가 깨져 있다는 것도 모른다 — 모델은
       * 같은 주소를 또 부르고, 사람은 네트워크를 의심한다. 까닭을 `되돌림탈` 로 붙인다.
       */
      let 다음;
      try { 다음 = new URL(loc, 지금); } catch {
        return { ...r, ms: Date.now() - started, 되돌림탈: `되돌린 곳(Location)을 읽을 수 없습니다: ${String(loc).slice(0, 120)}` };
      }
      if (지나온.has(다음.href)) 고리 = true;
      if (홉 >= 최대홉) {
        return {
          ...r, ms: Date.now() - started,
          되돌림탈: 고리
            ? `되돌림이 제자리를 돕니다 — ${최대홉}번을 따라가도 이미 간 곳으로 돌아옵니다 (되돌림 고리)`
            : `되돌림이 ${최대홉}번을 넘었습니다 — 더 따라가지 않습니다`,
        };
      }
      지나온.add(다음.href);
      await r.버리기?.();               // 안 읽은 몸을 두고 다음 요청을 보내면 연결이 남는다.
      // 훅이 async 여도 기다린다 — 이름을 실제로 풀어 보는 검사(webfetch.js)가
      // 여기 붙는다. 안 기다리면 그 검사가 끝나기 전에 다음 홉이 나간다.
      await 되돌림?.(다음);
      /*
       * fetch 규격대로: 303 은 GET·HEAD 가 아니면 GET 으로, 301·302 는 **POST 만** GET 으로, 307·308 은 그대로.
       *
       * 여기가 「303 은 늘 · 301·302 는 GET·HEAD 가 아니면」 이라 PUT·DELETE 가 몸을 잃고 GET 이 되고
       * HEAD 도 GET 이 됐다 (2.0.0 6회차 Gemini 전송6). 바꿀 때는 몸을 설명하던 머리말도 뗀다 —
       * 안 떼면 몸 없는 GET 에 Content-Type 이 따라갔다.
       */
      const 큰방법 = String(방법).toUpperCase();
      if ((r.status === 303 && 큰방법 !== 'GET' && 큰방법 !== 'HEAD') || ((r.status === 301 || r.status === 302) && 큰방법 === 'POST')) {
        방법 = 'GET';
        몸 = undefined;
        for (const k of Object.keys(머리)) {
          if (/^content-(type|length|encoding|language|location)$/i.test(k)) delete 머리[k];
        }
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
 * `잠잠` 을 안 주면 **머리말에 준 상한과 같은 값**으로 잰다 (원시요청 의 잰다).
 *
 * 여기가 「안 주면 예전 그대로 하나의 시계로」 였다. 그래서 잠잠 없이 흘려 받는
 * 자리(probe 의 진단 · WebFetch · 플러그인 받기)에서는 머리말이 온 뒤에도 전체
 * 시계가 살아 있었고, 300ms 마다 꼬박꼬박 오는 조각 열 개짜리 스트림이 timeout 에
 * 세 조각 만에 잘렸다 — 서버는 멀쩡했다. 「WebFetch·플러그인 받기는 몸 크기에
 * 상한이 있어서 이미 끝이 보장된다」 고 바로 여기 적혀 있었는데, **멎은 소켓은
 * 바이트가 안 오므로 그 상한에 영영 안 닿는다.** 그게 이 시계가 있는 까닭이다.
 *
 * 부르는 쪽이 준 숫자를 그대로 쓰므로 아무도 예전보다 오래 기다리지 않는다 —
 * 재는 자리만 「다 오는 데까지」 에서 「조각 사이」 로 옮긴다. 모델과 이야기하는
 * 자리(backend/adapter.js)는 프로필의 `잠잠`(기본 잠잠기본)을 따로 준다.
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

/*
 * ── 위 시계가 못 잡는 자리 ──────────────────────────────────────────────
 *
 * 잠잠 시계는 **바이트**를 잰다. 조각이 하나 오면 되감긴다(위 잠잠감시).
 * 그런데 SSE 에는 내용이 없는 조각이 있다 —
 *
 *   `: ping`                                 규격이 정한 주석 줄. keep-alive.
 *   `data: {"choices":[{"delta":{}}]}`       빈 delta. 살아 있다는 말만 한다.
 *
 * 둘 다 **바이트**다. 그래서 잠잠 시계를 되감는다. 그리고 둘 다 화면에
 * 아무것도 안 남긴다 — 앞엣것은 JSON 이 아니라 파싱에서 버려지고, 뒤엣것은
 * absorb 가 낼 이벤트가 없다.
 *
 * 머리말까지 재던 시계(timeout)는 머리말이 오는 순간 **꺼진다**(위 노드로·
 * 직접흘려의 시계끄기). 그러면 남는 천장이 하나도 없다.
 *
 * 실제로 그렇게 됐다. 게이트웨이 뒤에서 15분 넘게, 오류도 없이, 스피너만
 * 돌았다. 이벤트 루프는 멀쩡했다 — 기다릴 이유가 없어지는 순간이 영영 안
 * 왔을 뿐이다.
 *
 * 그래서 시계를 하나 더 둔다. 바이트가 아니라 **소식**을 잰다. 흔히
 * Logical Idle Timeout 이라 부르고, 그 위에 전체 상한(Total Timeout)을
 * 같이 씌우는 것이 보통이다. 여기서는 둘을 한 쌍으로 둔다.
 */

/**
 * 소식 없이 얼마나 두고 볼까 — **알리는** 자리.
 *
 * 끊지 않는다. 한 줄 적을 뿐이다. 추론을 감추는 게이트웨이는 원래 이 모양으로
 * 정상 동작한다 — 상위 모델이 생각하는 동안 keep-alive 만 흘린다. 그걸
 * 끊어 버리면 지금 잘 도는 연결을 우리가 죽이는 것이다.
 *
 * 90초로 잡는다. 사람이 「멈춘 건가」 를 의심하기 시작하는 자리다.
 */
export const 무소식알림기본 = 90000;

/**
 * 그래도 이건 넘기지 않는다 — **전체 상한**.
 *
 * 무한은 어떤 경우에도 맞는 답이 아니다. 10분은 어떤 모델의 첫 글자보다도
 * 한참 뒤다. 0 으로 두면 이 상한을 안 쓴다(프로필의 `무소식`).
 */
export const 무소식기본 = 600000;

/**
 * 소켓을 **얻는 데까지** 줄 시간.
 *
 * 위의 두 시계는 붙은 뒤를 잰다. 이건 붙기 전을 잰다 — 셋이 재는 자리가 다르다.
 *
 * ── 왜 따로 있어야 하나 ────────────────────────────────────────────────
 *
 * 곧장 가는 길(fetch)에는 원래 이 시계가 있다. undici 가 10초를 세고
 * `UND_ERR_CONNECT_TIMEOUT` 을 준다. 그런데 **프록시·인증서를 쓰는 길**
 * (노드로)에는 없었다. 거기서는 머리말 시계 하나가 「붙는 시간」 과 「답을
 * 기다리는 시간」 을 같이 재고 있었고, 그 시계는 5분이다.
 *
 * 그래서 같은 게이트웨이인데 프록시를 켠 사람만, 망이 잠깐 끊긴 자리에서
 * **5분을 다 쓰고 나서** 턴이 죽었다. 곧장 가는 사람은 10초 만에 알고
 * 다시 붙는데 말이다. 설명하기 제일 어려운 종류의 차이다.
 *
 * 그래서 10초로 맞춘다. 두 길이 같은 자리에서 같은 말을 하게 하는 것이
 * 이 상수가 있는 이유고, 그러면 다시 부르는 규칙(backend/retry.js)도
 * 두 길에 똑같이 걸린다.
 */
export const 연결기본 = 10000;

/** 붙지도 못한 것. 다시 불러도 되는 자리라 코드를 따로 준다 (backend/retry.js). */
export function 못붙음오류(연결) {
  return Object.assign(
    new Error(`${초로(연결)}초 안에 연결하지 못했습니다`),
    { name: 'ConnectTimeoutError', code: 'CONNECT_TIMEOUT', 연결 },
  );
}

export function 소식없음오류(무소식) {
  return Object.assign(
    new Error(`${초로(무소식)}초 동안 살아 있다는 신호만 오고 내용이 안 왔습니다`),
    { name: 'NoNewsError', code: 'NONEWS', 무소식 },
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
  /*
   * 흘려 받는 것은 **언제나** 직접흘려 로 간다.
   *
   * 여기가 `stream && 잠잠 > 0` 이었고, 그 밑에 잠잠 없이 흘려 받는 갈래가 따로 있었다.
   * 그 갈래는 `AbortSignal.timeout` 하나로 머리말과 몸을 같이 재서 — 그 신호는 몸까지
   * 같이 끊는다 — 잘 흐르는 답이 timeout 에 잘렸다. 이제 잠잠 값은 부르는 쪽이 안 줘도
   * 원시요청 이 정해 주므로(잰다) 그 갈래는 **한 번도 안 걸리는 죽은 갈래**가 됐다.
   * 죽은 채로 두면 아무도 안 도는 코드를 지키는 검사가 늘 초록으로 남는다.
   */
  if (stream) return 직접흘려(url, { method, headers, body, timeout, signal, 잠잠 });
  const res = await fetch(url, { method, headers, body, signal: 신호(timeout, signal), redirect: 'manual' });
  /*
   * 거절 답(2xx 아님)의 몸은 **상한까지만** 읽는다 (4회차 이월 · 사냥5).
   *
   * 프록시 길(노드로)은 사냥4 W2 때 거절몸상한 까지만 읽게 고쳤는데, 곧장 가는 이 길은 그대로
   * 끝까지 받았다. 300MB 짜리 404·500 을 주는 게이트웨이 하나에 메모리가 튀었고, 같은 서버인데
   * 프록시를 켰나에 따라 달랐다. 부르는 쪽은 거절 몸에서 사람 말 한 줄(serverMessage 의 앞
   * 200자)만 쓴다. 2xx 는 그대로 다 읽는다 — 게이트웨이의 JSON 답이다.
   */
  const bytes = res.ok ? Buffer.from(await res.arrayBuffer()) : await 앞만읽기(res.body, 거절몸상한);
  const text = bytes.toString('utf8');
  let json = null;
  try { json = JSON.parse(text); } catch { /* 글로만 오는 서버도 있다 */ }
  return { ok: res.ok, status: res.status, headers: res.headers, bytes, text, json };
}

/*
 * 흐르는 몸을 **앞에서부터 상한까지만** 읽고 나머지는 끊는다. 몸읽기 와 달리 넘어도 버리지
 * 않고 앞부분을 돌려준다 — 거절 몸은 앞머리에 사람 말이 있다.
 */
async function 앞만읽기(흐름, 상한) {
  if (!흐름) return Buffer.alloc(0);
  const reader = 흐름.getReader();
  const 조각 = [];
  let 크기 = 0;
  let 끝났나 = false;
  try {
    while (크기 < 상한) {
      const { done, value } = await reader.read();
      if (done) { 끝났나 = true; break; }
      조각.push(Buffer.from(value));
      크기 += value.length;
    }
  } finally {
    // 다 안 읽었으면 흐름을 끊는다 — 연결째 닫혀 서버가 나머지를 못 붓는다 (사냥4 W2 와 같은 뜻).
    if (!끝났나) { try { await reader.cancel(); } catch { /* 이미 닫혔으면 그만 */ } }
  }
  return Buffer.concat(조각).subarray(0, 상한);
}

/*
 * 거절 답의 res 를 감싼다 — `text()` 가 몸을 상한까지만 읽는다 (4회차 이월 · 사냥5).
 *
 * adapter 의 거절읽기 는 흘려 받던 요청이 거절당하면 `r.res.text()` 로 몸을 읽는다. 곧장 가는
 * 길의 fetch Response 는 그걸 끝까지 받는다. 몸 흐름(body)은 그대로 둔다 — 그걸로 제 상한을
 * 거는 부르는 쪽(몸읽기)이 있다.
 *
 * 이 `text()` 를 읽는 **동안**에도 시계가 돌아야 한다. 그 시계는 여기가 아니라 부르는
 * 쪽이 든다 — 아래 직접흘려 의 머리시계 (사냥6 막판-뒷단).
 */
function 거절몸감싸기(res) {
  return {
    ok: res.ok, status: res.status, headers: res.headers, body: res.body,
    text: async () => (await 앞만읽기(res.body, 거절몸상한)).toString('utf8'),
  };
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
    clearTimeout(머리시계);
    귀떼기();
    throw 까닭 ?? e;
  }

  /*
   * 버린다는 것은 **안 받는다** 는 뜻이다 (사냥4 W2).
   *
   * 여기가 `arrayBuffer()` 였다 — 버리려고 끝까지 받아 메모리에 올렸다. 300MB 짜리 302 몸
   * 하나에 900MB, gzip 255KB 짜리 그림 하나가 풀려서 279MB 가 됐다. 되돌림·그림·404 처럼
   * **읽지 않을 몸**에만 부르는 자리다. 흐름을 끊으면(cancel) 연결째 닫힌다 — 다시 쓸 연결
   * 하나를 잃는 대신 몸을 안 받는다. (곧장 가는 길의 흘려 받기는 전부 여기로 온다.)
   *
   * 끊을 것은 **돌려준 몸**이다. 여기가 `res.body.cancel()` 이었는데, 아래에서 잠잠감시가
   * 원래 몸의 읽개를 쥐고 나면 그 부름은 「잠겼다」 로 터지고 그 탈을 catch 가 삼킨다 —
   * 버린 낯만 하고 소켓은 살아서 서버는 계속 붓는다. 잠잠감시의 cancel 은 쥔 읽개를
   * 그대로 끊어 주므로, 감시를 걸었으면 **그쪽**을 끊는다.
   */
  let 끊을몸 = res.body;
  const 버리기 = async () => { 귀떼기(); try { await 끊을몸?.cancel(); } catch { /* 그만 */ } };
  // 몸이 없거나(304·되돌림) 거절이면 감시할 것이 없다. 거절 몸은 부르는 쪽이 res.text() 로
  // 읽으므로, 상한까지만 읽는 res 로 감싸 넘긴다 (거절몸감싸기).
  if (!res.ok || !res.body) {
    /*
     * ── 거절 몸을 읽는 동안에도 머리시계는 돈다 (사냥6 막판-뒷단) ────────
     *
     * 여기가 머리말이 오자마자 시계를 껐다(예전 `finally`). 그러면 **거절 몸에는 시계가
     * 하나도 안 남는다** — 잠잠감시는 아래 성공 갈래에만 걸린다. 머리말만 주고 몸을 안
     * 끊는 게이트웨이 앞에서 부르는 쪽(adapter 의 거절읽기)의 `res.text()` 가 영영 안
     * 돌아왔다 — 재 봤다. 화면은 커서만 깜빡이고 Ctrl+C 말고는 끝낼 길이 없다. 프록시
     * 길(노드로)은 거절 몸을 읽는 내내 같은 시계를 켜 둬서 timeout 에 끝난다. 같은
     * 게이트웨이인데 프록시를 켰나에 따라 한쪽만 매달렸다 — 이 파일이 제일 싫어하는 모양이다.
     *
     * 그래서 읽을 몸이 있는 거절에서는 **안 끈다.** 대신 unref 해 둔다: 아무도 안 읽고
     * 안 버려도(되돌림은 곧장 버리기 로 간다) 이 시계 하나 때문에 프로그램이 안 끝나면
     * 안 된다. 기다리는 소켓이 있는 동안에는 그 소켓이 판을 붙들고 있으므로 그대로 운다.
     */
    if (res.ok || !res.body) clearTimeout(머리시계);
    else 머리시계.unref?.();
    return { ok: res.ok, status: res.status, headers: res.headers, res: res.ok ? res : 거절몸감싸기(res), 버리기 };
  }
  clearTimeout(머리시계);

  const 몸 = 잠잠감시(res.body, 잠잠, 끊기, 귀떼기);
  끊을몸 = 몸;                       // 이제 버리기는 감시를 건 몸을 끊는다 (위 머리말)
  return {
    ok: true, status: res.status, headers: res.headers,
    /*
     * `text` 는 **감시를 건 몸**에서 읽는다 (사냥5 W-text).
     *
     * 원래 res.text() 를 부르면 「몸을 이미 읽었다」 로 터진다 — 잠잠감시가 만들 때 원래
     * 몸의 읽개를 쥐었기 때문이다. 지금 이걸 부르는 자리는 없다(거절 몸은 위의 !res.ok
     * 갈래가 원래 res 째 넘긴다). 그래서 더 위험하다: 처음 부르는 사람이 성공 응답에서만
     * 터지는 것을 보고, 까닭은 여기서 스무 줄 떨어져 있다.
     */
    res: { body: 몸, headers: res.headers, text: () => new Response(몸).text() },
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
function 노드로(url, { method, headers, body, timeout, stream, signal, 프록시 = null, 인증서 = null, 잠잠 = 0, 연결 = 연결기본 }) {
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
  let 못붙음 = false;
  let 머리시계 = setTimeout(() => { 시간초과 = true; 손.abort(); }, timeout);
  const 시계끄기 = () => { if (머리시계) { clearTimeout(머리시계); 머리시계 = null; } };
  /*
   * ── 붙는 데까지만 재는 시계 ──────────────────────────────────────────
   *
   * 곧장 가는 길에는 undici 가 이걸 갖고 있다(10초). 여기엔 없어서, 프록시를
   * 켠 사람만 망이 끊긴 자리에서 **머리말 시계 5분을 통째로** 쓰고 죽었다.
   * 두 길이 같은 자리에서 같은 말을 하게 맞춘다 (연결기본).
   *
   * 소켓을 얻는 순간 끈다. 그 뒤로 오래 걸리는 것은 「못 붙은 것」 이 아니라
   * 「생각하는 중」 이고, 그건 머리말 시계와 잠잠 시계가 맡는 자리다.
   */
  let 연결시계 = 연결 > 0 ? setTimeout(() => { 못붙음 = true; 손.abort(); }, 연결) : null;
  const 붙었다 = () => { if (연결시계) { clearTimeout(연결시계); 연결시계 = null; } };
  const 사람이 = () => 손.abort();
  if (signal?.aborted) 손.abort();
  else signal?.addEventListener('abort', 사람이, { once: true });
  // 끊긴 까닭을 가른다 — 사람이 끊은 것 · 못 붙은 것 · 시계가 끊은 것 · 흐름이 멎은 것.
  // 화면에서 넷이 다른 말이고, 다시 불러도 되는지도 넷이 다르다.
  const 왜끊겼나 = () => (signal?.aborted ? new Aborted()
    : 멎음 ?? (못붙음
      ? 못붙음오류(연결)
      : 시간초과
        ? Object.assign(new Error('시간 초과 — 응답이 없습니다'), { name: 'TimeoutError', code: 'TimeoutError' })
        : new Aborted()));

  return new Promise((resolve, reject) => {
    let rq = null;
    let 응답 = null;
    let 끝났나 = false;
    const 정리 = () => {
      시계끄기();
      붙었다();
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
    // 이미 끊긴 신호로 불렸으면 abort 는 다시 안 울린다 — 위 귀도 시계의 손.abort() 도 아무것도 못 깨운다.
    // 그대로 가면 CONNECT 에 말이 없는 프록시 앞에서 영영 섰다 (2.0.0 6회차 Gemini 전송6). 떠나기 전에 끊는다.
    if (sig.aborted) { 끊기(); return; }

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
      // 압축돼 왔으면 여기서 푼다 — 곧장 가는 길(fetch)과 같은 것을 받게 (아래 몸풀기, 사냥4 W8).
      const 몸 = 몸풀기(res, method);
      if (stream && ok) {
        /*
         * 흘려 받는 동안에는 끊기 귀를 **계속 열어 둔다.** 머리말이 왔다고 귀를 닫으면
         * 그 뒤의 Ctrl+C 가 소켓을 못 끊어서, 답이 다 올 때까지 화면이 안 멈춘다
         * (평가에서 잡혔다 — 직접 갈 때는 2ms, 프록시로 갈 때는 안 멈췄다).
         * 몸이 다 오거나 끊기면(close) 그때 닫는다.
         */
        let body = Readable.toWeb(몸);
        res.once('close', 정리);
        // 잠잠 시계를 쓰면 머리말까지만 재던 시계는 여기서 끈다.
        if (잠잠 > 0) {
          시계끄기();
          body = 잠잠감시(body, 잠잠, (e) => { 멎음 = e; 손.abort(); });
        }
        if (!끝났나) { 끝났나 = true; resolve({
          ok, status: res.statusCode, headers: 머리,
          res: { body, headers: 머리, text: () => 다읽기(몸) },
          /*
           * 버리기는 **끊기**다 (사냥4 W2). 여기가 `res.resume()` 이었다 — 흘려 버리는
           * 것이지 안 받는 것이 아니라서, 300MB 짜리 그림을 끝까지 받고 나서야 끝났다.
           */
          버리기: async () => { try { 몸.on('error', 그냥둠); res.on('error', 그냥둠); 몸.destroy(); res.destroy(); } catch { /* 그만 */ } },
        }); }
        return;
      }
      /*
       * ── 거절 답의 몸은 **상한까지만** (사냥4 W2) ─────────────────────────
       *
       * 2xx 가 아닌 답(404·500·되돌림)도 여기서 **통째로** 읽고 나서 돌려줬다. 부르는
       * 쪽은 그 몸에서 사람 말 한 줄(serverMessage 의 앞 200자)만 쓰거나 아예 버리는데,
       * 300MB 짜리 404 하나에 800MB 가까이 올라갔다 — 곧장 가는 길은 안 그러는데 프록시를
       * 켠 사람만. 거절 몸은 거절몸상한 까지만 읽고 소켓을 끊는다. 2xx 는 그대로 다 읽는다
       * (게이트웨이의 JSON 답이다).
       */
      다읽기(몸, ok ? Infinity : 거절몸상한, res).then((text) => {
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
        /*
         * 소켓을 얻는 순간 연결 시계는 할 일이 끝났다.
         *
         * 터널로 받은 소켓은 이미 붙어 있다(createConnection) — `connecting` 이
         * 거짓이라 그 자리에서 바로 꺼진다. 새로 붙는 소켓은 TCP 면 `connect`,
         * TLS 면 `secureConnect` 에서 꺼진다. 둘 다 걸어 두면 어느 길로 와도
         * 한 번은 꺼진다.
         */
        rq.once('socket', (sock) => {
          if (!sock || sock.connecting !== true) return 붙었다();
          sock.once('connect', 붙었다);
          sock.once('secureConnect', 붙었다);
        });
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
    /*
     * 중단이 닿아야 할 자리가 판마다 다르다.
     *
     *   · CONNECT 를 기다리는 동안 → 요청
     *   · 그 위에 TLS 를 올리는 동안 → 터널 소켓
     *
     * 예전에는 CONNECT 답을 받은 **그 자리에서** 귀를 떼 버렸다. 그래서 200 만
     * 주고 입을 다무는 프록시를 만나면(뒷단이 죽은 프록시·들여다보는 프록시)
     * 중단도 시계도 그 소켓에 안 닿았다. 부르는 쪽은 제때 깨지는데 소켓이 남아
     * — 답을 찍고도 프로세스가 안 끝나는 모양이 됐다(아래 close 머리말과 같은 탈).
     * 귀는 그대로 두고 **끊을 자리만 바꿔** 쥔다.
     */
    let 끊을것 = () => rq.destroy(왜끊겼나());
    const 끊기 = () => 끊을것();
    sig.addEventListener('abort', 끊기, { once: true });
    const 정리 = () => sig.removeEventListener('abort', 끊기);

    rq.once('connect', (res, socket, head) => {
      // 끊긴 뒤에 답이 도착한 판 — 소켓을 받아 놓고 아무도 안 쥐면 그대로 남는다.
      if (sig.aborted) { 정리(); socket.destroy(); return reject(왜끊겼나()); }
      if (res.statusCode !== 200) {
        정리();
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
      const tls = tlsConnect({ socket, host: hostname, servername: 이름, ...(인증서 ?? {}) }, () => { 정리(); resolve(tls); });
      // 이제부터 중단은 **이 소켓**을 끊어야 한다 (위 머리말).
      끊을것 = () => { const e = 왜끊겼나(); tls.destroy(e); socket.destroy(); reject(e); };
      tls.once('error', (e) => { 정리(); reject(e); });     // 대상 인증서 문제 — 프록시 탓이 아니라 표시를 안 붙인다
      // TLS 층이 닫혀도 밑의 프록시 소켓은 저절로 안 닫힌다. 그대로 두면 요청마다 소켓이
      // 하나씩 남아 프로세스가 안 끝난다 (deel run 이 답을 찍고도 안 나가는 모양이 된다).
      tls.once('close', () => socket.destroy());
    });
    rq.once('error', (e) => { 정리(); e.프록시 = 프록시.url; reject(e); });
    rq.end();
  });
}

/** 거절 답(2xx 아님)의 몸을 이만큼까지만 읽는다. 사람 말 한 줄을 뽑기엔 차고 넘친다. */
const 거절몸상한 = 1024 * 1024;

// 끊은 뒤에 뒤늦게 오는 오류를 받아 두는 빈 귀. 아무도 안 받으면 프로세스가 죽는다.
const 그냥둠 = () => {};

/**
 * 몸을 글로 읽는다. 상한을 넘으면 거기서 **끊는다** — 나머지는 안 받는다 (사냥4 W2).
 *
 * @param 원천 끊을 때 같이 닫을 응답. 몸이 압축 풀개면 풀개만 닫아서는 밑의 소켓이
 *   안 닫혀서, 서버는 계속 보내고 소켓은 열린 채 남는다.
 */
function 다읽기(몸, 상한 = Infinity, 원천 = null) {
  return new Promise((resolve, reject) => {
    const 조각 = [];
    let 크기 = 0;
    let 끝 = false;
    const 마치기 = () => { if (끝) return; 끝 = true; resolve(Buffer.concat(조각).toString('utf8')); };
    몸.on('data', (d) => {
      if (끝) return;
      if (크기 + d.length > 상한) {
        조각.push(d.subarray(0, Math.max(0, 상한 - 크기)));
        마치기();
        /*
         * 끊는 것은 **한 박자 뒤에** 한다. 여기서 바로 끊으면 소켓이 닫히며 나는 소식이
         * 약속이 풀리기(then) 전에 먼저 돌아서, 요청 쪽 오류 귀(실패)가 먼저 잡아 버린다 —
         * 받아 놓은 404 가 「연결이 끊겼습니다」 로 바뀐다. 그 사이 오는 조각은 위에서 버린다.
         */
        몸.pause();
        setImmediate(() => {
          for (const 것 of [몸, 원천]) {
            if (!것) continue;
            try { 것.on('error', 그냥둠); 것.destroy(); } catch { /* 이미 닫혔으면 그만 */ }
          }
        });
        return;
      }
      크기 += d.length;
      조각.push(d);
    });
    몸.once('end', 마치기);
    몸.once('error', (e) => { if (끝) return; 끝 = true; reject(e); });
  });
}

/*
 * ── 압축된 몸을 푼다 (사냥4 W8) ────────────────────────────────────────
 *
 * 곧장 가는 길(fetch)은 Content-Encoding 을 보고 **알아서** 푼다. 이 길(node:http)은
 * 안 풀었다. 그래서 청하지 않아도 gzip 으로 주는 서버(CDN·사내 리버스 프록시에 흔하다)를
 * 만나면, 같은 페이지가 **프록시 뒤에서만** 압축 바이트 그대로 모델에게 갔다. 사람 눈에는
 * 「프록시를 켜면 웹 읽기가 깨진다」 로만 보인다. 두 길이 같은 것을 받게 여기서 푼다.
 *
 * 몸이 없는 답(HEAD · 204 · 304)은 안 건드린다 — 빈 것을 풀면 「덜 끝났다」 로 넘어진다.
 * 밑 흐름이 끊긴 까닭(사람이 끊음 · 멎음)은 풀개로 그대로 넘긴다. 안 넘기면 읽는 쪽이
 * 영영 기다리거나, 끊긴 까닭이 「사용자가 중단」 이 아닌 딴 말로 바뀐다.
 */
function 몸풀기(res, method) {
  if (method === 'HEAD' || res.statusCode === 204 || res.statusCode === 304) return res;
  const 방식 = String(res.headers['content-encoding'] ?? '').trim().toLowerCase();
  const 풀개 = (방식 === 'gzip' || 방식 === 'x-gzip' || 방식 === 'deflate') ? createUnzip()
    : 방식 === 'br' ? createBrotliDecompress() : null;
  if (!풀개) return res;
  res.once('error', (e) => 풀개.destroy(e));
  res.once('close', () => { if (!res.complete && !풀개.destroyed) 풀개.destroy(new Error('서버가 연결을 끊었습니다')); });
  return res.pipe(풀개);
}

// 프록시가 407 을 줬을 때 사람이 칠 것까지 적어 준다. NTLM·Negotiate 는 못 하니 그렇다고 말한다.
// 칠 자리는 **지금 그 프록시를 읽어 온 곳**이다 — HTTP_PROXY 로 정한 사람에게 HTTPS_PROXY 를
// 고치라고 하면 고쳐도 안 바뀐다 (평가에서 잡혔다).
function 인증말(도전, 프록시) {
  const s = String(도전 ?? '');
  /*
   * 사내 프록시는 흔히 **여러 방식을 한꺼번에** 내민다 —
   *   Proxy-Authenticate: Negotiate, Basic realm="corp"
   * 앞엣것만 보고 "이 방식은 지원하지 않습니다, 담당자에게 문의하세요" 로 끝내면,
   * 바로 옆에 우리가 갈 수 있는 Basic 이 열려 있는데도 사람을 돌려보내는 셈이다.
   * 이 파일이 애초에 생긴 까닭이 그거다 — 적힌 탈출구가 막혀 있는 것이 제일 나쁘다.
   *
   * 방식 이름은 쉼표로 나뉜 **앞자리**에만 온다. realm="basic-corp" 같은 글에
   * 걸리면 안 되니 자리까지 본다. 그리고 자리를 보려면 **따옴표 속을 먼저
   * 지워야** 한다 — realm="internal, basic auth" 의 쉼표는 방식을 나누는
   * 쉼표가 아닌데, 안 지우면 그것만으로 「Basic 도 준다」 로 읽힌다.
   */
  const 따옴표뺀것 = s.replace(/"[^"]*"/g, '""');
  const 베이직 = /(?:^|,)\s*basic\b/i.test(따옴표뺀것);
  /*
   * 못 하는 방식도 **베이직과 똑같이** 자리까지 본다.
   *
   * 앞서 따옴표 속을 지우는 것까지만 했다. 그런데 realm 값에 따옴표를 안 두르는 프록시가
   * 있어서(RFC 는 token 이면 허용한다), `Basic realm=ntlm` · `Basic realm=corp-ntlm` 은
   * 지울 따옴표가 없어 그대로 `\bntlm\b` 에 걸렸다. Basic 하나만 내미는 프록시인데 안내문
   * 끝에 「NTLM 도 요구하지만 그건 못 합니다」 가 붙는다 — 사람은 열쇠를 넣어 보기도 전에
   * 「우리 프록시는 안 되는구나」 로 읽고 손을 뗀다. 적힌 탈출구가 막혀 보이는 것이
   * 이 함수가 제일 하면 안 되는 일이다.
   */
  const 못하는것 = /(?:^|,)\s*ntlm\b/i.test(따옴표뺀것) ? 'NTLM' : (/(?:^|,)\s*negotiate\b/i.test(따옴표뺀것) ? 'Negotiate' : null);
  if (못하는것 && !베이직) {
    return `프록시(${프록시.url})가 ${못하는것} 인증을 요구합니다 — 이 방식은 지원하지 않습니다.`
      + ' 사내 담당자에게 Basic 인증이나 인증 없는 프록시 주소를 문의하세요.';
  }
  const 주소 = `http://user:pw@${프록시.host}:${프록시.port}`;
  const 자리 = 프록시.출처 === 'config'
    ? `설정 파일의 "proxy": "${주소}"`
    : `${프록시.출처 ?? 'HTTPS_PROXY'}=${주소}`;
  return `프록시(${프록시.url})가 인증을 요구합니다 (407${s ? ` · ${s.slice(0, 60)}` : ''})`
    + ` — 프록시 주소에 user:pw@ 를 넣으세요: ${자리}`
    + (못하는것 ? ` (${못하는것} 도 같이 요구하지만 그건 못 합니다 — Basic 으로 가세요)` : '');
}

// fetch 가 던진 것에서 코드 하나를 뽑는다. undici 는 원인을 cause 에 싸서 준다.
function 오류코드(err) {
  /*
   * **숫자 code 는 건너뛴다.** 시간 초과로 끊을 때 fetch 가 던지는 DOMException 은 code 가 23 — 옛 DOM
   * 번호(TIMEOUT_ERR)다 — 이라, 여기가 `TimeoutError` 대신 23 을 돌려줬다. 그래서 「시간이 다 됐나」 를
   * 코드로 가르는 자리(detect 의 시간다됨)가 한 번도 안 맞아 안 답하는 주소를 188초 두드렸다 (6회차 Gemini
   * 알아내기6 D3). 그 숫자는 누구에게도 뜻이 없다 — 이름이 뜻이다.
   */
  const 글자 = (c) => (typeof c === 'string' && c ? c : null);
  return 글자(err?.cause?.code) ?? 글자(err?.code) ?? err?.cause?.name ?? err?.name ?? null;
}

// fetch 는 무슨 일이든 'fetch failed' 라고만 말하고 까닭은 cause 에 숨긴다. 그래서
// 말(m)만 보지 않고 코드도 본다 — 안 그러면 DNS 실패도 "주소·포트·프록시를 확인하세요" 가 된다.
/*
 * 내보내는 까닭은 **검사 때문**이다.
 *
 * 이 사다리는 서버가 준 글을 정규식으로 읽어 사람 말로 갈아 끼운다. 그 중
 * 한 줄은 열쇠가 화면과 진단 보고서에 평문으로 흘러나가는 것을 막는 줄이다.
 * 그런 줄이 조용히 죽어도 아무 데서도 안 터진다 — 그냥 원문이 그대로 나가고,
 * 그 원문 안에 열쇠가 들어 있다.
 *
 * 부르는 길이 `req()` 하나뿐이라 검사판에서 갈래마다 재려면 진짜 통신을
 * 실패시켜야 했다. 그래서 안 재고 있었다. 재지는 조각으로 내놓는다.
 */
export function normalizeError(err) {
  const m = String(err?.message ?? err);
  const 코드 = String(오류코드(err) ?? '');
  const 기본 = (() => {
    if (err?.code === 'PROXY_CONNECT') return m;
    // 우리 인증서 파일을 못 읽은 것. 이건 통신 실패가 아니라 **경로가 틀린**
    // 것이고, 그 말은 이미 사람 말로 지어 두었다 (backend/clientcert.js).
    if (err?.code === 'CERT_READ') return m;
    // 흐름이 멎어서 우리가 끊은 것. 서버가 끊은 것과 다른 말이어야 한다.
    if (err?.code === 'STALL') return `${m} — 답을 통째로 모았다가 주는 게이트웨이면 프로필의 잠잠 을 올려 보세요`;
    /*
     * 아직 **붙지도 못한** 것. 아래의 「응답이 없습니다」 와 반드시 갈라야 한다 —
     * 저건 서버가 받아 놓고 답을 안 한 것이고, 이건 서버까지 가지도 못한 것이다.
     * 사람이 볼 자리가 다르고(망·프록시 대 게이트웨이), 다시 불러도 되는지도
     * 다르다 (backend/retry.js 의 못붙은코드).
     */
    /*
     * `ETIMEDOUT` 도 **붙지도 못한** 것이다 — OS 가 TCP 연결에서 손을 뗀 것이고 보낸 것이 없다.
     * 그런데 글이 `connect ETIMEDOUT 10.0.0.1:443` 이라 아래 `/timed? ?out/` 에 걸려 「응답이
     * 없습니다」 가 됐다. 재시도 규칙(backend/retry.js)은 이걸 못 붙음으로 세고 있었으니,
     * 화면과 규칙이 같은 오류를 두고 딴 소리를 한 셈이다.
     */
    /*
     * `ETIMEDOUT` 은 **붙는 중에 난 것만** 못 붙음이다.
     *
     * 같은 코드가 두 자리에서 난다. `connect ETIMEDOUT`(syscall 'connect')은 소켓을 못
     * 얻은 것 — 보낸 것이 없다. `read ETIMEDOUT`(syscall 'read')은 **붙어서 요청까지
     * 보낸 뒤** OS 가 재전송을 포기한 것 — 서버가 받아 놓고 답을 안 한 쪽이다.
     * 코드만 보고 통째로 못 붙음으로 밀면 뒤엣것에 「망이나 프록시를 확인하세요」 라는
     * 엉뚱한 자리를 짚어 준다.
     */
    const 붙다난것 = 코드 === 'ETIMEDOUT'
      && ((err?.syscall ?? err?.cause?.syscall) === 'connect' || /connect ETIMEDOUT/i.test(m));
    if (코드 === 'CONNECT_TIMEOUT' || 코드 === 'UND_ERR_CONNECT_TIMEOUT' || 붙다난것) {
      return '연결하지 못했습니다 — 망이나 프록시를 확인하세요 (잠시 뒤 다시 해 봅니다)';
    }
    if (err?.name === 'TimeoutError' || 코드 === 'TimeoutError' || /timed? ?out/i.test(m)) return '시간 초과 — 응답이 없습니다';
    if (/ENOTFOUND|EAI_AGAIN/.test(코드) || /ENOTFOUND|getaddrinfo/i.test(m)) return '주소를 찾을 수 없습니다 (DNS)';
    if (코드 === 'ECONNREFUSED' || /ECONNREFUSED/i.test(m)) return '연결이 거부되었습니다 (서버가 꺼져 있거나 포트가 다릅니다)';
    // 받아 놓고 끊은 것 — 서버가 꺼진 것과 다르다. "주소를 확인하라" 는 틀린 조언이다.
    if (/ECONNRESET|EPIPE|UND_ERR_SOCKET/.test(코드) || /ECONNRESET|other side closed/i.test(m)) return '서버가 연결을 끊었습니다';
    /*
     * ── 인증서 탈은 고칠 자리가 저마다 다르다 (사냥5 B5-09) ─────────────────
     *
     * 맨 아래 한 줄이 전부를 「사내 인증서라면 NODE_EXTRA_CA_CERTS 가 필요합니다」 로 받았다.
     * 그건 **서버를 믿는** 문제의 답이다. 게이트웨이가 **우리 인증서를 요구**하는데 안 낸 것
     * (TLS 경보 116 certificate required), 우리 개인키의 **암호가 틀린** 것(bad decrypt),
     * 우리 인증서를 **받아 놓고 거절**한 것은 사람이 볼 자리가 프로필의 "인증서" 칸이다.
     * 틀린 안내를 따르면 환경변수만 늘고 붙지는 않는다. 서버를 못 믿는 것은 그대로 둔다.
     */
    if (/CERTIFICATE_REQUIRED/i.test(코드) || /certificate required/i.test(m)) {
      return '게이트웨이가 클라이언트 인증서를 요구합니다 — 프로필의 "인증서" 에 cert·key(또는 pfx)를 적으세요'
        + ' (서버 인증서를 믿게 하는 환경변수로는 안 풀립니다)';
    }
    if (/BAD_DECRYPT/i.test(코드) || /bad decrypt/i.test(m)) {
      return '클라이언트 개인키의 암호가 틀렸거나 없습니다 — DEEL_CERT_PASS 환경변수나 프로필 "인증서" 의 passphrase 를 보세요';
    }
    // 경보는 **코드로 올 때도 글로만 올 때도** 있다. 위 두 갈래는 둘 다 보는데 여기만
    // 코드만 봐서, 글로만 온 경보가 맨 아래 CA 안내로 떨어졌다 — 서버를 믿는 문제의 답이다.
    if (/ALERT_BAD_CERTIFICATE|ALERT_UNKNOWN_CA|ALERT_CERTIFICATE_(?:UNKNOWN|EXPIRED|REVOKED)/i.test(코드)
      || /alert (?:bad certificate|unknown ca|certificate (?:unknown|expired|revoked))/i.test(m)) {
      return '게이트웨이가 우리 클라이언트 인증서를 받지 않았습니다 — 프로필 "인증서" 의 cert·key 가 이 게이트웨이용으로 발급됐는지, 기한이 남았는지 보세요';
    }
    if (/PEM_NO_START_LINE|BAD_BASE64_DECODE/i.test(코드)) {
      return '인증서 파일이 PEM 모양이 아닙니다 — 프로필 "인증서" 가 가리키는 cert·key·ca 파일을 보세요 (pfx 는 "pfx" 칸에 적습니다)';
    }
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
    /*
     * 셋째 말투 — **프록시를 켠 사람만 다른 답을 받고 있었다.**
     *
     * 곧장 가는 길은 fetch(undici)라 위의 두 말투가 나온다. 그런데 프록시를 켜면
     * node:http 로 가고, 거기서는 말투가 아예 다르다:
     *   Invalid character in header content ["Authorization"]   (code ERR_INVALID_CHAR)
     * 열쇠 값은 안 들어 있어 새지는 않는다. 대신 **안내가 안 뜬다** — 같은 열쇠,
     * 같은 실수인데 프록시가 있고 없고에 따라 한 쪽만 한국어 안내를 받았다.
     */
    if (/ByteString|character at index|invalid header (value|name)|invalid character in header|must be a valid HTTP token/i.test(m)
      || /^ERR_INVALID_(CHAR|HTTP_TOKEN)$/.test(코드)) return '열쇠(또는 헤더)에 한글·특수문자가 섞여 있습니다 — API 키는 영문·숫자만 실립니다. 붙여넣을 때 따옴표나 줄바꿈이 딸려 오지 않았는지 보세요';
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

/**
 * 429 본문을 보고 **무슨 한도인지** 알아본다.
 *
 * ── 왜 이게 필요한가 ────────────────────────────────────────────────────
 *
 * 화면에 「서버가 잠시 막았습니다 (HTTP 429)」 만 뜨면, 사람이 할 수 있는 것이
 * 기다리는 것밖에 없다. 그런데 429 는 **한 가지가 아니다.** 어떤 것은 1분 뒤에
 * 저절로 풀리고, 어떤 것은 관리자가 할당량을 올려 주기 전까지 안 풀린다. 그
 * 둘에 같은 말을 하면 사람은 30분을 기다리다 포기한다.
 *
 * 실제로 이런 것이 왔다.
 *
 *   Too many requests sent to ApplyGuardrail: On-demand ApplyGuardrail
 *   sensitive information policy text units per second limit exceeded.
 *
 * 이건 모델 토큰 한도가 아니다. **가드레일이 훑는 글의 양**이고, 단위가 초당
 * text unit(1 TU 는 1,000자쯤)이다. 그래서 대화가 자랄수록 매 요청이 커지고,
 * 어느 순간부터 **매번** 걸린다 — 「잘하다가 갑자기」 가 이 모양이다.
 *
 * 그리고 프리픽스 캐시가 여기서는 하나도 안 듣는다. 캐시는 모델 쪽 이야기고,
 * 가드레일은 캐시와 무관하게 매번 전체 글을 훑는다. 이걸 모르면 「캐시가 걸리는데
 * 왜 한도에 걸리지」 에서 막힌다.
 *
 * 원문은 지우지 않고 뒤에 남긴다 — 사내 담당자에게 그대로 보여 줘야 할 때가
 * 있다. 프록시힌트 와 같은 자세다.
 */
export function 막힘힌트(글) {
  const s = String(글 ?? '');
  // 가드레일: 초당 **글의 양**. 기다린다고 안 풀리고, 프롬프트를 줄이거나 한도를 올려야 한다.
  if (/guardrail/i.test(s) && /text\s*units?/i.test(s)) return 옮긴말('net.limit.guardrail');
  /*
   * 요청 **한 번**이 분당 한도보다 큰 것은 기다려도 안 풀린다 (사냥5 B5-03).
   *
   * 「Request too large … tokens per min (TPM): Limit 30000, Requested 45000 … must be reduced」 에
   * 아래 「창이 새로 열리면 저절로 풀립니다 · 기다리는 것이 맞습니다」 를 붙였다. 창이 새로
   * 열려도 그 한 번은 여전히 한도보다 크다. 사람은 1분 기다리고 같은 거절을 또 받는다.
   * 그때는 말 표에 열쇠가 없어 원문만 두었다. 원문은 영어라 한국어 화면의 사람은 「무엇을
   * 줄이라는 건지」 를 뽑아 읽어야 했다 — 이제 「줄여야 풀린다」 를 말하고 원문도 그대로 둔다.
   */
  if (/request too large|must be reduced/i.test(s)) return 옮긴말('net.limit.oneTooBig');
  // 분당 한도: 창이 새로 열린다. 여기서는 기다리는 것이 맞는 답이다.
  if (/per\s*minute|\bTPM\b|\bRPM\b/i.test(s)) return 옮긴말('net.limit.perMinute');
  return null;
}

// 서버가 준 오류 본문에서 사람이 읽을 문장만 뽑는다.
/*
 * ── 빈 문장은 **문장이 없는 것**이다 ────────────────────────────────────
 *
 * 사람이 본 것: 실패한 줄이 통째로 비어 있었다. `✗` 하나 찍히고 그 옆이 빈
 * 칸이다. 상태 코드조차 없으니 어디를 봐야 하는지도 모른 채 같은 말을 다시
 * 친다.
 *
 * 실제로 온 것:
 *
 *   {"error":{"message":"","code":"content_filter"}}
 *
 * 안전 필터로 막는 게이트웨이 중에 코드만 넣고 문장은 비워 보내는 곳이 있다.
 * 그런데 아래 `??` 사다리는 **빈 글자를 값이 있는 것으로 받는다** — `??` 가
 * 막는 것은 null·undefined 뿐이고 `''` 는 그냥 통과한다. 그래서 마지막
 * 대비책인 `HTTP ${r.status}` 까지 갈 길이 아예 없었다.
 *
 * 그 빈 글자는 여기서 끝나지 않는다. adapter 의 거절오류 · detect · probe 가
 * 이 값을 그대로 `new Error(말)` 에 넣는다. 메시지가 빈 Error 는 화면에도
 * 진단 보고서에도 **빈 줄**로 남는다. 우리가 지우지 않았는데 사라진 것처럼
 * 보이는, 이 저장소가 제일 싫어하는 모양이다.
 *
 * 이제 지키는 규칙: **비었거나 공백뿐이면 없는 것과 똑같이 친다.** 없으면
 * 다음 자리를 보고, 거기도 없으면 최소한 상태 코드는 말한다.
 */
export function serverMessage(r) {
  const 빈글 = (v) => typeof v === 'string' && v.trim() === '';
  if (r.error && !빈글(r.error)) return r.error;
  const j = r.json;
  const cand = j?.error?.message ?? j?.error ?? j?.message ?? j?.detail;
  let 말;
  if (typeof cand === 'string' && !빈글(cand)) 말 = cand;
  else if (cand && typeof cand !== 'string') 말 = JSON.stringify(cand).slice(0, 200);
  else if (r.text && !빈글(r.text)) 말 = String(r.text).replace(/\s+/g, ' ').slice(0, 200);
  else return `HTTP ${r.status}`;
  // 알아본 것이 있으면 원문 대신 그것을 앞에 세운다. 원문은 뒤에 한 줄로 남긴다 —
  // 사내 담당자에게 그대로 보여 줘야 할 때가 있다.
  const 힌트 = 프록시힌트(말) ?? (Number(r.status) === 429 ? 막힘힌트(말) : null);
  return 힌트 ? `${힌트}\n원문: ${말.slice(0, 160)}` : 말;
}
