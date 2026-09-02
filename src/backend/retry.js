// 잠깐 막힌 것과 진짜 안 되는 것을 가른다. 그리고 얼마나 기다릴지 정한다.
//
// 왜 필요한가:
//   사내 게이트웨이는 사람마다 할당량이 있어 429 를 자주 준다. 뒤에 붙은 모델이
//   재시작하면 502·503 이 몇 초 온다. 연결이 그냥 끊기기도 한다. 이 셋은
//   **몇 초 뒤에 같은 요청을 다시 보내면 되는** 것들인데, 전에는 전부 턴을
//   통째로 죽였다 — adapter 가 !ok 면 던지고, 루프는 잘린 답과 빈 답만 다시
//   불렀지 상태 코드는 안 봤다. 사람은 같은 말을 다시 치고, 그 사이 읽어 둔
//   도구 결과는 날아갔다. Task 로 여럿을 떼어 주면 그만큼 자주 걸린다.
//
// 어디까지만 다시 부르나:
//   · 같은 요청을 그대로 다시 보내도 탈이 없는 자리에서만. 모델 호출은 서버에
//     아무것도 안 남기니 그렇다. 파일을 바꾸는 도구는 여기 안 온다 — 그쪽은
//     guard.js 가 "한 번 실패한 바꾸는 명령은 다시 안 돌린다" 로 지킨다.
//   · 본문이 한 글자라도 흘러온 **뒤에** 끊긴 것은 안 부른다. 반쯤 온 답을 두 벌
//     만들면 안 된다 — 그건 살려 쓰기(agent/salvage.js) 가 받는다.
//   · 세 번까지. 그 뒤로는 사실대로 말한다. 열 번 두드리는 것은 할당량을 더 빨리
//     태우는 짓이다.
//   · 400·401·403·404 는 다시 불러 봐야 같다. 한 번만 부르고 서버가 한 말을 보여 준다.
//     401 에 딱 하나 예외가 있는데, 그것도 여기가 아니라 backend/adapter.js 가 한다 —
//     열쇠받기(safety/authcmd.js)가 걸려 있으면 **같은 열쇠로 다시 부르는 것이 아니라**
//     새 열쇠를 받아서 부르는 것이라, 「불러 봐야 같다」 에 해당하지 않는다. 딱 한 번이다.
//   · ECONNREFUSED 는 서버가 꺼진 것이고, 시간 초과는 5분을 또 기다릴 일이 아니다.
//     둘 다 안 부른다.
//
// 얼마나 기다리나:
//   서버가 Retry-After 로 말해 주면 그것(60초에서 자른다 — 그 이상은 사람이 결정할
//   일이다). 안 주면 1초 → 2초 → 4초. 여기에 30% 안에서 흔든다 — 같은 게이트웨이를
//   쓰는 사람 여럿이 같은 박자로 다시 두드리면 그게 또 429 를 만든다.
import { Aborted } from './http.js';

/** 기본 정책. 검사는 base 를 짧게 바꿔 준다 — 모양은 같고 시간만 다르다. */
export function 기본정책() {
  return { 최대: 3, base: [1000, 2000, 4000], 흔들림: 0.3, 상한: 60000 };
}

// 잠깐 막힌 것으로 보는 상태 코드. 529 는 Anthropic 계열 게이트웨이의 '과부하' 다.
const 다시부를상태 = new Set([408, 429, 500, 502, 503, 504, 529]);
// 머리말도 못 받고 끊긴 것. undici 는 상대가 닫으면 UND_ERR_SOCKET 으로 온다.
const 다시부를코드 = new Set(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'ECONNABORTED']);

/**
 * 이 실패를 두고 다시 불러도 되나.
 * @param {{status?: number, code?: string|null, attempt?: number}} 실패  attempt 는 방금 실패한 것이 몇 번째였나 (1부터)
 */
export function 다시부를까({ status = 0, code = null, attempt = 1 } = {}, 정책 = 기본정책()) {
  if (attempt > 정책.최대) return false;
  if (status) return 다시부를상태.has(Number(status));
  return !!code && 다시부를코드.has(String(code));
}

/**
 * 몇 ms 기다릴까. 서버가 말해 준 것이 있으면 그것, 없으면 사다리.
 * @param {{attempt?: number, retryAfter?: string|number|null}} 자리
 */
export function 기다릴시간({ attempt = 1, retryAfter = null } = {}, 정책 = 기본정책()) {
  const 서버말 = retryAfter읽기(retryAfter);
  if (서버말 !== null) return Math.min(서버말, 정책.상한);
  // 사다리가 비었으면(설정이 이상하면) 기본 사다리로 — NaN 초를 기다릴 수는 없다.
  const 사다리 = Array.isArray(정책.base) && 정책.base.some(Number.isFinite)
    ? 정책.base.filter(Number.isFinite)
    : 기본정책().base;
  const 칸 = 사다리[Math.min(attempt, 사다리.length) - 1] ?? 사다리[사다리.length - 1];
  return Math.min(정책.상한, Math.round(칸 * (1 + Math.random() * 정책.흔들림)));
}

/*
 * Retry-After 는 초이거나 HTTP 날짜다. 못 읽으면 null — 그때는 사다리로 간다.
 *
 * 규격은 정수 초지만 `1.5` 처럼 소수로 주는 서버가 실제로 있다. 그리고 `1,5` · `5;` ·
 * `-1` 같은 것을 Date.parse 에 그냥 주면 엉뚱한 옛날 날짜로 읽혀 **0초**가 된다 —
 * 그러면 세 번을 연달아 두드린다. 그래서 글자가 든 것만 날짜로 본다.
 */
function retryAfter읽기(값) {
  if (값 == null || 값 === '') return null;
  const s = String(값).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  if (!/[a-z]/i.test(s)) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return Math.max(0, t - Date.now());
}

/**
 * 기다린다. 그 사이 Ctrl+C 가 오면 **바로** Aborted 로 던진다 — 5초를 기다리라고
 * 해 놓고 사람이 끊었는데 5초를 더 붙들면 안 된다.
 */
export function 기다리기(ms, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Aborted());
    if (!(ms > 0)) return resolve();
    const 끊기 = () => { clearTimeout(t); reject(new Aborted()); };
    const t = setTimeout(() => { signal?.removeEventListener?.('abort', 끊기); resolve(); }, ms);
    signal?.addEventListener?.('abort', 끊기, { once: true });
  });
}

/**
 * 실패한 응답 하나를 보고 "기다렸다 다시 부른다" 알림을 만든다. 안 부를 것이면 null.
 * 화면·기록이 이 한 덩이를 그대로 쓴다 — 여기 없는 숫자는 화면에도 없다.
 */
export function 다시부를지(r, attempt, 정책 = 기본정책()) {
  const status = r?.status ?? 0;
  const code = r?.code ?? null;
  if (!다시부를까({ status, code, attempt }, 정책)) return null;
  const retryAfter = r?.headers?.get?.('retry-after') ?? r?.res?.headers?.get?.('retry-after') ?? null;
  return {
    type: 'backoff',
    status,
    code,
    wait: 기다릴시간({ attempt, retryAfter }, 정책),
    attempt,
    max: 정책.최대,
    retryAfter: retryAfter ?? null,
  };
}

/**
 * 알림 한 덩이를 화면 말(i18n 의 loop.backoff)에 끼울 자리로 바꾼다.
 * 세 화면(repl · deel run · acp)이 같은 것을 본다 — 한 군데만 고치면 셋이 어긋난다.
 */
export function 알림채움(ev) {
  const 초 = (ev?.wait ?? 0) / 1000;
  return {
    무엇: ev?.status ? `HTTP ${ev.status}` : (ev?.code ?? 'socket'),
    초: 초 >= 10 ? String(Math.round(초)) : String(Math.round(초 * 10) / 10),
    n: ev?.attempt ?? 1,
    max: ev?.max ?? 기본정책().최대,
  };
}

/** 부르는 쪽(conn·opts)이 준 것을 기본 위에 얹는다. 검사가 사다리를 짧게 줄 때 쓴다. */
export function 정책고르기(conn, opts) {
  return { ...기본정책(), ...(conn?.retry ?? {}), ...(opts?.retry ?? {}) };
}
