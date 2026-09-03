// 웹 읽기. 읽기 전용이고, 나가는 것은 주소뿐이다.
//
// 이 도구가 다른 길로 다니는 이유:
//   모델 게이트웨이로는 소스 코드가 통째로 나간다. 그래서 그 길은 딱 한 자리로 묶어 뒀다.
//   웹 읽기는 성격이 다르다 — 받아 오기만 하고 보내지 않는다. 두 길을 한 목록에
//   같이 두면 "코드가 어디로 갈 수 있나" 를 더 이상 한 줄로 답할 수 없게 된다.
//   그래서 여기서만 잠깐 열고, 끝나면 바로 닫고, 다녀온 곳은 전부 기록에 남긴다.
//
// 지키는 것:
//   · GET 만. 본문을 실어 보내지 않는다.
//   · 사설·로컬 주소는 거절. 사내 서버를 모델이 긁어 오게 두지 않는다.
//   · 오프라인이면 아예 거절.
//   · 받은 것은 글자만 뽑고 길이를 자른다.
import { allowTemporarily, isOffline, isLocalHost } from '../safety/network.js';
import { 원시요청, 몸읽기 } from '../backend/http.js';
import { decode as decodeBytes } from './encoding.js';
import { 웹글자수 } from '../agent/budget.js';
import { 말 } from '../i18n/index.js';

/**
 * 받아 온 바이트를 글로. 머리글에 적힌 인코딩이 있으면 그것부터 믿는다.
 *
 * 파일을 읽을 때 쓰는 것과 같은 판단기(encoding.js)를 쓴다. 두 자리에 서로 다른
 * 잣대를 두면, 같은 CP949 글이 파일로는 읽히고 웹으로는 깨지는 상태가 된다.
 */
function 웹글읽기(buf, 머리글) {
  if (머리글 && !/^utf-?8$/.test(머리글)) {
    try { return new TextDecoder(머리글, { fatal: false }).decode(buf); }
    catch { /* 이 Node 가 모르는 이름이면 아래에서 알아서 본다 */ }
  }
  // euc-kr 인 페이지를 위해 힌트를 준다. 내용이 분명하면 내용이 이긴다.
  return decodeBytes(buf, { fallback: 'euc-kr' }).text;
}

export const 방문기록 = [];

const MAX_BYTES = 2 * 1024 * 1024;   // 2MB 넘게 받지 않는다

/*
 * ── 한 집에는 한 번에 하나씩 ────────────────────────────────────────────
 *
 * 모델은 도구를 **한꺼번에** 부른다. 화면에 `5개를 함께 돌립니다` 가 뜨는
 * 그 자리다. 그런데 그 다섯이 전부 같은 API 면, 상대 쪽에서는 우리가
 * 한순간에 다섯 번 두드린 것으로 보인다. 그래서 이런 게 나왔다:
 *
 *   ◍ WebFetch(api.coingecko.com/…/volume_chart?…)
 *     └ HTTP 429 — api.coingecko.com/…/volume_chart?…
 *
 * 429 는 "틀렸다" 가 아니라 "천천히 해라" 다. 그런데 그냥 오류로 끝내 버리니
 * 모델은 그 자료를 영영 못 받고, 사람은 왜 못 받았는지 모른다.
 *
 * 고치는 방법은 안 두드리는 것이 아니라 **줄을 세우는 것**이다. 집(origin)
 * 마다 줄이 하나씩 있고, 다른 집끼리는 그대로 동시에 간다. 조금 느려지지만
 * 받아 오기는 받아 온다 — 못 받는 것보다 늦게 받는 것이 낫다.
 */
const 집줄 = new Map();          // origin → 그 집의 마지막 차례가 끝나는 약속
const 집간격 = 400;              // 같은 집을 다시 두드리기 전에 쉬는 시간

/**
 * 잠깐 잔다. 멈추라고 하면 자다가도 일어난다.
 *
 * 이 파일에는 사람을 최대 10초까지 붙잡는 잠이 두 군데 있다 — 줄 서는 사이와
 * 429 뒤에 쉬는 사이다. 그냥 setTimeout 이면 ESC 를 눌러도 그 10초는 그대로
 * 흐른다. 화면에는 「멈추는 중…」 이 10초 내내 떠 있고, 사람 눈에는 ESC 가
 * 안 먹은 것과 똑같이 보인다 — 제보받은 그 증상이다.
 */
const 잠깐 = (ms, signal = null) => new Promise((풀기) => {
  const t = setTimeout(풀기, ms);
  signal?.addEventListener?.('abort', () => { clearTimeout(t); 풀기(); }, { once: true });
});

function 한집씩(origin, 일, signal = null) {
  const 앞사람 = 집줄.get(origin);
  const 내차례 = (앞사람 ?? Promise.resolve())
    .then(async () => {
      if (앞사람) await 잠깐(집간격, signal);
      // 줄을 서 있는 사이에 멈췄으면 두드리지 않는다. 안 두드려도 잃을 것이 없다 —
      // 아직 나간 것이 하나도 없는 자리다.
      if (signal?.aborted) throw new Error('중단했습니다');
      return 일();
    });
  // 다음 사람이 기다리는 것은 '내가 끝났다' 뿐이다. 내가 실패해도 줄은 넘어간다.
  집줄.set(origin, 내차례.then(() => {}, () => {}));
  return 내차례;
}

/**
 * 멈췄을 때 돌려줄 모양.
 *
 * 다른 도구들과 **같은 모양**이어야 한다(tools/index.js 의 runTool). 멈춤은
 * 실패가 아니라서 중단됨 을 따로 단다 — 실패로 세면 되풀이 감지가 엉뚱하게
 * 걸려서 다음에 같은 주소를 부르는 것까지 막힌다.
 */
const 중단결과 = () => ({ error: '중단했습니다. 웹을 읽다 말았습니다.', 끝났다: true, 중단됨: true });

/*
 * 잠시 뒤에 다시 하면 되는 것들.
 *
 * 429 는 너무 자주, 502·503·504 는 상대가 잠깐 힘든 것이다. 셋 다 우리가
 * 뭘 잘못한 게 아니라서, 조금 쉬었다 다시 부르면 대개 된다.
 * 400·401·403·404 는 다시 불러도 같은 답이 온다 — 안 다시 한다.
 */
const 다시할것 = new Set([429, 502, 503, 504]);
const 다시횟수 = 2;

/** `Retry-After` 를 초로. 초로 적히기도 하고 날짜로 적히기도 한다. */
function 얼마나쉬라나(머리, 회차) {
  const v = String(머리 ?? '').trim();
  let 초 = null;
  if (/^\d+$/.test(v)) 초 = parseInt(v, 10);
  else if (v) {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) 초 = Math.ceil((t - Date.now()) / 1000);
  }
  // 상대가 안 알려 주면 우리가 정한다 — 1초, 2초.
  if (초 == null || 초 < 0) 초 = 회차 + 1;
  // 너무 오래 붙잡고 있지 않는다. 그건 멈춘 것과 화면상 구분이 안 된다.
  return Math.min(초, 10);
}

function 태그벗기기(html) {
  let 글 = String(html);
  // script·style·주석을 겹쳐 쓰거나 안 닫은 모양으로 흘려 보내는 페이지가
  // 있다 — 정규식 한 번으로는 다 못 걷어 낸다(파서가 아니라서). 더 지울 것이
  // 없어질 때까지 반복한다. 그래도 이 글은 모델에게 주는 참고용 글일 뿐
  // 화면에 그리지 않으니, 여기서 다 못 걸러도 실행되는 것은 아니다.
  for (let i = 0; i < 5; i += 1) {
    const 전 = 글;
    글 = 글
      .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ');
    if (글 === 전) break;
  }
  return 글
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    // 한 번에 찾아서 한 번에 바꾼다 — 차례로 바꾸면(`&amp;` 를 먼저 `&` 로
    // 풀고 나서 `&lt;` 를 다시 찾는 식) `&amp;lt;` 처럼 두 겹 씌운 것이
    // 두 번 풀려서 `<` 로 튀어나온다(글자로 남아야 하는데 태그처럼 보이게 됨).
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, 이름) => ({
      nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'",
    }[이름]))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * @param {object} args  모델이 주는 값 — url, max_chars
 * @param {object} opts  프로그램 내부에서만 주는 값.
 *   allowPrivate 는 검사용이다. 도구 스키마에 없으므로 모델은 이 값을 줄 수 없다.
 *   (환경변수로 열어 두면 실제 사용 중에도 열려 버린다 — 그래서 인자로만 둔다)
 */
/**
 * 되돌림(redirect)을 따라가도 되는 곳인가. 던지면 안 따라간다.
 *
 * ── 왜 이름을 붙여 꺼냈나 ───────────────────────────────────────────────
 *
 * 이 판단이 webFetch 안의 이름 없는 함수로 묻혀 있었다. 그래서 **어떤 검사도
 * 여기를 안 지났다** — 두 줄을 통째로 지워도 검사가 전부 초록이었다.
 * 직접 친 주소가 사내망인 것은 재고 있었는데, **바깥 주소가 302 로 사내망을
 * 가리키는** 길은 아무도 안 지났다. 위험한 쪽은 이쪽이다.
 *
 * 이름을 붙이면 재 볼 수 있다. `플러그인되돌림`(plugins/manage.js)이 같은
 * 까닭으로 먼저 그렇게 되어 있다.
 *
 * ── 무엇을 막나 ─────────────────────────────────────────────────────────
 *
 * 첫째, http·https 가 아닌 곳. `file:///etc/passwd` 로 되돌리면 남의 서버가
 * 우리 디스크를 읽어 제 화면에 실어 보낼 수 있다.
 * 둘째, 이 컴퓨터·사내망 주소. 바깥에서 시작한 요청이 302 한 번으로 사내망
 * 안쪽에 닿으면, 「소스가 어디로도 안 나간다」 와 짝을 이루는 문장이 깨진다.
 */
export function 웹되돌림(다음, { allowPrivate = false } = {}) {
  if (다음.protocol !== 'http:' && 다음.protocol !== 'https:') {
    throw new Error(`${다음.protocol} 로 되돌립니다 — 따라가지 않습니다`);
  }
  if (isLocalHost(다음.hostname) && !allowPrivate) {
    throw new Error(`이 컴퓨터·사내망 주소(${다음.hostname})로 되돌립니다 — 따라가지 않습니다`);
  }
}

export async function webFetch(args, { allowPrivate = false, 모델컨텍스트 = null, signal = null } = {}) {
  const raw = String(args?.url ?? '').trim();
  /*
   * 이미 멈췄으면 아예 안 나간다.
   *
   * 여럿을 함께 부를 때(loop.js 의 Promise.all) 앞엣것이 도는 사이 ESC 를
   * 누르면, 뒤엣것들은 아직 아무 데도 안 두드렸는데 그대로 나갔다. 나가면
   * 상대 서버에는 기록이 남는다 — 멈춘 뒤에 남기는 발자국은 설명할 길이 없다.
   */
  if (signal?.aborted) return 중단결과();
  /*
   * 얼마나 가져올지는 **모델에 맞춰** 정한다 (agent/budget.js).
   *
   * 전에는 누구에게나 20,000자였다. 8k 모델에 20,000자를 부어 넣으면 그 한
   * 번으로 창이 넘치고, 넘치면 접히고, 접히면 앞엣말을 잊는다 — 사람 눈에는
   * "모델이 멍청해졌다" 로 보인다. 655k 모델에는 반대로 턱없이 적다.
   */
  const 기본 = 웹글자수(모델컨텍스트);
  const max = Math.min(Math.max(parseInt(args?.max_chars, 10) || 기본, 1000), 120000);

  if (isOffline()) return { error: '오프라인 모드입니다 — 웹을 읽지 않습니다.' };

  let u;
  try { u = new URL(raw); } catch { return { error: `주소 형식이 아닙니다: ${raw}` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { error: `${u.protocol} 는 읽지 않습니다. http/https 만 됩니다.` };
  }
  // 사내망·로컬을 모델이 훑게 두지 않는다. 웹을 읽는 도구지 내부 정찰 도구가 아니다.
  if (isLocalHost(u.hostname) && !allowPrivate) {
    return { error: `이 컴퓨터·사내망 주소는 이 도구로 읽지 않습니다: ${u.hostname}\n  파일은 Read, 사내 서버는 사람이 직접 확인하세요.` };
  }

  const close = allowTemporarily(u.origin);
  // 되돌림(redirect)으로 옮겨 간 집도 그 한 번만 연다. 한 홉마다 문지기를 지나므로
  // 여기서 열어 주지 않으면 막힌다 — 그리고 사내망으로 되돌리는 것은 열지 않는다.
  const 열어둔 = [];
  try {
    // 같은 집이면 줄을 서고, 잠시 뒤 되는 오류면 쉬었다 다시 부른다.
    let res = null;
    let 쉰시간 = 0;
    for (let 회차 = 0; ; 회차++) {
      res = await 한집씩(u.origin, () => 원시요청(u.href, {
        method: 'GET',                            // 보내는 건 없다
        headers: { 'User-Agent': 'deel/cli', Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
        timeout: 30000,
        /*
         * 사람이 누른 ESC 를 여기까지 데려온다.
         *
         * 여태 이 자리에는 시한(30초)만 있었다. 그래서 안 답하는 서버를 하나
         * 물면 ESC 를 눌러도 30초를 꼬박 기다렸다 — 「ESC 를 눌러도 안 멈춘다」
         * 는 제보의 한 갈래가 정확히 이것이다. http.js 의 신호() 가 시한과
         * 이 신호를 AbortSignal.any 로 묶어 준다.
         */
        signal,
        stream: true,                             // 상한까지만 받는다 — 다 받아 놓고 버리지 않는다
        되돌림: (다음) => {
          웹되돌림(다음, { allowPrivate });
          열어둔.push(allowTemporarily(다음.origin));
        },
      }), signal);
      방문기록.push({ url: u.href, status: res.status, at: new Date().toISOString() });
      if (res.ok || !다시할것.has(res.status) || 회차 >= 다시횟수) break;
      await res.버리기?.();
      const 초 = 얼마나쉬라나(res.headers.get('retry-after'), 회차);
      쉰시간 += 초;
      await 잠깐(초 * 1000, signal);
      if (signal?.aborted) return 중단결과();
    }

    if (!res.ok) {
      await res.버리기?.();
      /*
       * 오류를 그냥 번호로만 던지면 모델은 할 수 있는 게 없다. 실제로 그랬다 —
       * `✗ HTTP 429` 만 보고 그 자료를 포기했다. 무엇을 하면 되는지 같이 준다.
       */
      const 집 = u.hostname;
      if (res.status === 429) {
        return { error: `HTTP 429 — ${집} 가 "너무 자주 부른다" 고 합니다.`
          + `\n  ${다시횟수}번 쉬었다 다시 불러 봤습니다(${쉰시간}초). 그래도 같습니다.`
          + '\n  한꺼번에 여러 개를 부르지 말고 하나씩 부르거나, 잠시 뒤에 다시 해 보세요.'
          + '\n  키가 있는 API 면 키를 붙인 주소를 쓰면 한도가 늘어납니다.' };
      }
      if (res.status === 404) return { error: `HTTP 404 — 그런 쪽이 없습니다: ${u.href}\n  주소를 다시 확인하세요.` };
      if (res.status === 401 || res.status === 403) {
        return { error: `HTTP ${res.status} — ${집} 가 접근을 막았습니다.\n  로그인이나 키가 있어야 하는 쪽입니다. 이 도구로는 못 읽습니다.` };
      }
      if (다시할것.has(res.status)) {
        return { error: `HTTP ${res.status} — ${집} 가 지금 힘들어합니다.`
          + `\n  ${다시횟수}번 다시 불러 봤습니다(${쉰시간}초). 잠시 뒤에 다시 해 보세요.` };
      }
      return { error: `HTTP ${res.status} — ${u.href}` };
    }

    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!/text|json|xml|javascript/.test(type)) {
      await res.버리기?.();
      return { error: `글이 아닌 내용입니다 (${type || '알 수 없음'}). 이 도구는 글만 읽습니다.` };
    }

    const buf = await 몸읽기(res.res.body, MAX_BYTES);
    if (!buf) return { error: `너무 큽니다 (${MAX_BYTES / 1024 / 1024}MB 넘음) — 받다 말았습니다. 범위를 좁힌 주소를 쓰세요.` };

    /*
     * 무엇으로 쓰여 있는지 알아보고 읽는다.
     *
     * 전에는 무조건 UTF-8 이었다. 사내 위키·공공기관 페이지는 아직 EUC-KR 이
     * 흔한데, 그걸 UTF-8 로 읽으면 한글이 통째로 깨진다. 그 깨진 글이 그대로
     * 모델에게 가고, 모델은 깨진 채로 요약한다 — 사용자는 왜 엉뚱한 답이
     * 나오는지 알 수 없다. 파일을 읽을 때는 이미 알아보고 읽는데(encoding.js)
     * 웹만 안 하고 있었다.
     *
     * 머리글(charset)이 있으면 그게 답이다. 없으면 내용을 보고 짐작한다.
     */
    const 머리글 = /charset=["']?([\w-]+)/i.exec(type)?.[1]?.toLowerCase() ?? null;
    let text = 웹글읽기(buf, 머리글);
    if (/html/.test(type)) text = 태그벗기기(text);
    // <meta charset> 이 머리글과 다르게 적혀 있는 페이지가 있다. 깨졌으면 그걸 믿고 다시 읽는다.
    if (!머리글 && text.includes('�')) {
      const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.toString('latin1').slice(0, 2000))?.[1]?.toLowerCase();
      if (meta) {
        text = 웹글읽기(buf, meta);
        if (/html/.test(type)) text = 태그벗기기(text);
      }
    }
    /*
     * ── 자르기 ────────────────────────────────────────────────────────────
     *
     * JSON 을 글자 수로 자르면 **JSON 이 아니게 된다.** 모델은 `{"a":1,"b":[{"c"`
     * 같은 것을 받고, 읽을 수 없으니 아무것도 못 한다. 그런데 화면에는
     * `20,000자 (잘림)` 이라고만 떠서, 사람은 자료를 받은 줄 안다.
     *
     * 그래서 두 가지를 한다.
     *   1) 자르기 전에 **눌러 본다.** API 응답은 대개 보기 좋게 들여쓰기가
     *      돼 있는데, 그 공백이 절반을 먹는 일이 흔하다. 눌러서 들어가면
     *      자를 필요가 아예 없어진다.
     *   2) 그래도 넘치면 **깨진 JSON 이라고 분명히 말한다.** 그리고 무엇을
     *      하면 되는지 — 범위를 좁히거나 max_chars 를 올리거나 — 같이 준다.
     */
    const json쪽 = /json/.test(type);
    let 눌렀나 = false;
    if (json쪽 && text.length > max) {
      try {
        const 눌린것 = JSON.stringify(JSON.parse(text));
        if (눌린것.length < text.length) { text = 눌린것; 눌렀나 = true; }
      } catch { /* JSON 이 아니거나 이미 잘려 온 것이다. 그냥 둔다 */ }
    }

    const 원래길이 = text.length;
    const cut = 원래길이 > max;
    if (cut) text = text.slice(0, max);

    let 꼬리 = '';
    if (cut) {
      const 남은것 = (원래길이 - max).toLocaleString();
      꼬리 = json쪽
        ? `\n\n(여기서 잘렸습니다 — ${남은것}자가 더 있습니다.`
          + '\n 잘린 JSON 은 그대로 읽을 수 없습니다. 다음 중 하나를 하세요:'
          + '\n  · 범위를 좁혀 다시 부른다 (per_page·ids·days 같은 조건을 붙인다)'
          + `\n  · 같은 주소를 max_chars 를 올려 다시 부른다 (지금 ${max.toLocaleString()}, 최대 100,000))`
        : `\n\n(뒤쪽 ${남은것}자는 잘렸습니다. 더 필요하면 max_chars 를 올려 다시 부르세요.)`;
    }

    return {
      content: `${u.href}\n${'─'.repeat(60)}\n${text}${꼬리}`,
      // 요약은 화면에 그대로 뜬다. 잘렸으면 **얼마나** 잘렸는지까지 보여야
      // 사람이 "받은 줄 알았는데 아니었다" 를 안 겪는다.
      summary: 말('unit.chars', { n: text.length.toLocaleString() })
        + (눌렀나 ? ' (눌러 담음)' : '')
        + (cut ? ` (잘림 — ${원래길이.toLocaleString()}자 중)` : ''),
    };
  } catch (err) {
    const m = String(err?.message ?? err);
    /*
     * 멈춤이 먼저다.
     *
     * 신호가 끊으면 fetch 는 AbortError 를 던지는데, 그 말은 「이 작업이
     * 중단되었습니다」 라는 영어 한 줄이다. 그대로 오류로 올리면 화면에는
     * 사람이 누른 ESC 가 남의 서버 잘못처럼 찍힌다. 시한 초과와도 구별해야
     * 한다 — 시한은 상대가 늦은 것이고, 이건 우리가 그만둔 것이다.
     */
    if (signal?.aborted) return 중단결과();
    if (err?.name === 'TimeoutError') return { error: '시간 초과 — 응답이 없습니다.' };
    if (/ENOTFOUND|getaddrinfo/i.test(m)) return { error: '주소를 찾을 수 없습니다 (DNS).' };
    return { error: m };
  } finally {
    close();   // 반드시 닫는다. 열어 둔 채로 두면 자물쇠가 아니게 된다.
    for (const 닫기 of 열어둔) 닫기();
  }
}

export const WEB_FETCH_TOOL = {
  schema: {
    name: 'WebFetch',
    description: '웹 페이지를 읽는다. 읽기만 하고 아무것도 보내지 않는다. 문서·오류 메시지·라이브러리 사용법을 확인할 때 쓴다. 이 컴퓨터·사내망 주소는 읽지 않는다.'
      + ' 같은 사이트를 한 번에 여러 개 부르면 차례로 나가므로 그만큼 느려진다 — 꼭 필요한 것만 부를 것.'
      + ' JSON 이 잘리면 읽을 수 없으니, 잘렸다고 하면 조건을 붙여 범위를 좁히거나 max_chars 를 올려 다시 부를 것.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '읽을 주소 (http/https)' },
        max_chars: { type: 'number', description: '가져올 최대 글자 수. 안 주면 모델 크기에 맞춰 정해진다. 자료가 잘리면 여기를 올린다 (최대 120000)' },
      },
      required: ['url'],
    },
  },
  // signal 을 같이 넘긴다. 안 넘기면 ESC 를 눌러도 이 도구만 최대 30초를 더 산다
  // — 화면은 「멈추는 중…」 인데 실제로는 남의 서버를 계속 붙들고 있는 상태다.
  run: (args, ctx) => webFetch(args, { 모델컨텍스트: ctx?.모델컨텍스트 ?? null, signal: ctx?.signal ?? null }),
};
