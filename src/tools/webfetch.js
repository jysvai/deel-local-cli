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
// isLocalHost 가 아니라 안쪽주소인가 로 막는다 — 봉인이 열어 주는 「이 안」 보다 막을 곳이 넓다
// (100.64/10 의 클라우드 메타데이터 · fec0::/10 · IPv4 를 싼 IPv6). network.js 머리말 참고.
import { allowTemporarily, isOffline, 안쪽주소인가, 사설로풀리나 } from '../safety/network.js';
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
  /*
   * ── utf-8 이라고 **적어 둔** 페이지 (사냥4 W4) ──────────────────────────
   *
   * 여기는 머리글이 utf-8 이면 곧장 내용 짐작(encoding.js)으로 넘겼다. 그런데 짐작은
   * 엄격하다 — UTF-8 로 **한 바이트라도** 어긋나면 UTF-8 이 아니라고 보고 다른
   * 인코딩을 고른다. 멀쩡한 한글 UTF-8 페이지에 깨진 바이트 하나(잘린 광고 조각,
   * 옛 글 붙여넣기)가 섞이면 페이지 **전체가** windows-1252 로 읽혀 `ì•ˆë…•` 이 됐다.
   * 아래 webFetch 의 되읽기(깨진 글자 세기)도 못 잡는다 — 1252 는 � 를 안 내놓는다.
   *
   * 그래서 적힌 utf-8 을 먼저 믿어 본다. 어긋난 바이트는 � 로 바꾸고, 그 수가 제대로
   * 읽힌 UTF-8 글자에 비해 **드물면**(스무 자에 하나 이하) 그대로 쓴다.
   *
   * 「적힌 대로」 만 믿지 않는 까닭 — 머리글만 utf-8 이고 알맹이는 EUC-KR 인 옛 사내
   * 위키가 흔하다(서버 기본값이 붙는다). 거기서는 거의 모든 바이트가 어긋나서 비율로
   * 갈린다. 그때만 여태처럼 내용 짐작으로 넘어간다.
   */
  if (머리글) {
    const 읽은것 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    let 깨진 = 0;
    let 멀쩡한 = 0;
    for (const 글자 of 읽은것) {
      const n = 글자.codePointAt(0);
      if (n === 0xfffd) 깨진 += 1;
      else if (n >= 0x80) 멀쩡한 += 1;
    }
    if (깨진 === 0 || 깨진 * 20 <= 멀쩡한) return 읽은것;
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
  // 이미 멈춘 신호를 들고 오면 abort 는 **다시 안 터진다.** 그 판에서
  // 그냥 잠들면 ESC 를 누른 뒤에도 이 잠을 끝까지 잔다 — 고치려던 그 증상이
  // 그대로 돌아온다.
  if (signal?.aborted) return 풀기();
  const 깨우기 = () => { clearTimeout(t); 풀기(); };
  const t = setTimeout(() => { signal?.removeEventListener?.('abort', 깨우기); 풀기(); }, ms);
  signal?.addEventListener?.('abort', 깨우기, { once: true });
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
  /*
   * 다음 사람이 기다리는 것은 '내가 끝났다' 뿐이다. 내가 실패해도 줄은 넘어간다.
   *
   * 끝나면 **줄에서 뺀다.** 안 빼면 한참 뒤에 혼자 부르는 요청도 앞사람이
   * 있는 것으로 보여 400ms 를 그냥 잔다 — 줄이 비어 있는데 서 있는 셈이다.
   */
  const 끝나면 = 내차례.then(() => {}, () => {});
  집줄.set(origin, 끝나면);
  끝나면.then(() => { if (집줄.get(origin) === 끝나면) 집줄.delete(origin); });
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

/*
 * 이름으로 적힌 글자(&middot; 같은 것). 번호로 둔다 — 글자를 소스에 박으면 보이지 않는
 * 글자(nbsp)가 섞여도 눈으로 못 가린다.
 *
 * 여태는 nbsp·amp·lt·gt·quot·apos 여섯만 풀었다(사냥4 W16). 그래서 흔한 `&middot;`
 * `&hellip;` `&copy;` 가 원문 그대로 모델에게 가서, 목록의 가운뎃점·말줄임표 자리가 전부
 * `&middot;` 로 찍혔다. 모르는 이름은 여전히 **손대지 않는다.**
 *
 * 뿌리 없는 객체다(8회차 · 바깥). 보통 객체면 `&toString;` `&constructor;` `&valueOf;`
 * 같은 이름이 **Object.prototype 의 함수**를 집는다. 그것을 글자 번호로 쓰려다
 * `RangeError: Invalid code point NaN` 이 나고, 그 예외는 태그벗기기 밖으로 새서
 * **페이지 전체가 오류 한 줄**이 됐다 — 남의 페이지에 한 낱말 적혀 있으면 되는 일이다.
 * 뿌리가 없으면 그런 이름도 그냥 없는 이름이라, 위 규칙(손대지 않는다)이 그대로 산다.
 */
const 이름글자 = Object.assign(Object.create(null), {
  nbsp: 0x20, amp: 0x26, lt: 0x3c, gt: 0x3e, quot: 0x22, apos: 0x27,
  middot: 0xb7, hellip: 0x2026, copy: 0xa9, reg: 0xae, trade: 0x2122,
  mdash: 0x2014, ndash: 0x2013, lsquo: 0x2018, rsquo: 0x2019, ldquo: 0x201c, rdquo: 0x201d,
  laquo: 0xab, raquo: 0xbb, bull: 0x2022, euro: 0x20ac, times: 0xd7, divide: 0xf7, deg: 0xb0,
  plusmn: 0xb1, sect: 0xa7, para: 0xb6, cent: 0xa2, pound: 0xa3, yen: 0xa5,
  larr: 0x2190, rarr: 0x2192, uarr: 0x2191, darr: 0x2193,
});

/*
 * 번호로 적혀 와도 **모델에게 넘기지 않을** 글자 (사냥4 W16).
 *
 * 여기는 32 밑만 막았다. 그래서 이런 것이 번호 한 줄로 그대로 풀려 들어갔다:
 *   · C1 제어(0x80–0x9F) · DEL — `&#x9b;31m` 은 터미널에서 CSI 다. 대화 기록을 cat 하면 색이 바뀐다
 *   · 방향 뒤집기(U+202A–202E · U+2066–2069) — 글이 보이는 순서와 읽히는 순서를 갈라놓는다.
 *     「파일을 지우지 마세요」 가 사람 눈에는 반대로 보이게 만드는 데 쓰는 글자다
 *   · 외톨이 대리쌍(D800–DFFF) — 글자가 아니다. JSON 으로 게이트웨이에 실으면 넘어지는 곳이 있다
 * 못 넣을 번호는 여태처럼 원문(`&#x202e;`)을 그대로 둔다 — 보이는 글자로 남으니 안전하다.
 */
const 못넣을번호 = (n) => n < 32 || n > 0x10ffff
  || (n >= 0x7f && n <= 0x9f)
  || (n >= 0xd800 && n <= 0xdfff)
  || (n >= 0x202a && n <= 0x202e)
  || (n >= 0x2066 && n <= 0x2069);

function 태그벗기기(html) {
  let 글 = String(html);
  // script·style·주석을 겹쳐 쓰거나 안 닫은 모양으로 흘려 보내는 페이지가
  // 있다 — 정규식 한 번으로는 다 못 걷어 낸다(파서가 아니라서). 더 지울 것이
  // 없어질 때까지 반복한다. 그래도 이 글은 모델에게 주는 참고용 글일 뿐
  // 화면에 그리지 않으니, 여기서 다 못 걸러도 실행되는 것은 아니다.
  for (let i = 0; i < 5; i += 1) {
    const 전 = 글;
    /*
     * 셋을 **한 무늬로, 왼쪽부터** 지운다 (6회차 Gemini 웹받기 W4).
     *
     * script → style → 주석 차례로 따로 지웠더니, 주석 안에 적힌 `<script>` 가 뒤에 오는
     * 진짜 `</script>` 까지 본문을 통째로 먹고 `<!--` 만 남겼다. 브라우저는 **먼저 열린 쪽**을
     * 따른다 — 한 무늬의 갈래로 두면 정규식도 왼쪽에서 먼저 걸리는 쪽을 따른다.
     */
    /*
     * 닫는 태그는 `</script>` 만이 아니다 (2.0.0 CodeQL js/bad-tag-filter).
     * 브라우저는 `</script foo>` 도, 줄바꿈이 낀 `</script\n>` 도, 빗금으로
     * 바로 닫는 `</script/>` 도 닫는 것으로 본다. `\s*>` 로만 두면 그런 꼴을
     * 못 잡고 **스크립트 속이 글로 새어** 모델에게 그대로 간다.
     *
     * 빗금 갈래를 빼먹었더니 아래 「안 닫힌 것은 끝까지」 가 그 뒤를 통째로
     * 먹어 **본문이 통째로 사라졌다**(2차 눈이 재현해 줬다). 못 걸러 새는
     * 것만 흠이 아니라, 멀쩡한 글을 지우는 것도 같은 무게의 흠이다.
     */
    글 = 글.replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script(?:[\s/][^>]*)?>|<style\b[\s\S]*?<\/style(?:[\s/][^>]*)?>/gi, ' ');
    if (글 === 전) break;
  }
  /*
   * 안 닫힌 script·style·주석은 **끝까지**다 (W3). 브라우저도 닫는 태그가 안 오면 나머지를 전부
   * 그 안으로 읽는다. 상한에서 잘린 페이지가 흔히 이 꼴이라, 안 지우면 스크립트 본문이 글로 간다.
   */
  글 = 글.replace(/<!--[\s\S]*$|<(?:script|style)\b[\s\S]*$/i, ' ');
  return 글
    // 닫는 태그만 줄로 바꾸면, 닫는 태그를 안 적은 페이지가 통째로 한 줄이
    // 된다 — `<p>첫째<p>둘째` 나 `<ul><li>하나<li>둘</ul>` 이 흔하다.
    // HTML 이 그것을 허락하므로 옛 사내 페이지에는 정말로 그렇게 적혀 있다.
    // 여는 태그도 같이 줄로 바꾼다.
    .replace(/<\/?(p|div|section|article|li|tr|h[1-6]|br)\b[^>]*>/gi, '\n')
    // 태그는 `<` 바로 뒤가 글자(·`/`·`!`·`?`)일 때만이다 (W5). `1 < 5 && 10 > 2` 의 `< 5 … >` 는
    // HTML 에서도 글이다 — 태그로 보고 지우면 식이 `1 2` 가 된다.
    .replace(/<\/?[a-z!?][^>]*>/gi, ' ')
    // 한 번에 찾아서 한 번에 바꾼다 — 차례로 바꾸면(`&amp;` 를 먼저 `&` 로
    // 풀고 나서 `&lt;` 를 다시 찾는 식) `&amp;lt;` 처럼 두 겹 씌운 것이
    // 두 번 풀려서 `<` 로 튀어나온다(글자로 남아야 하는데 태그처럼 보이게 됨).
    // 숫자 꼴(`&#48712;` · `&#x27;`)과 `&apos;` 도 같은 한 판에서 푼다.
    // 안 풀면 한글 페이지 하나가 통째로 숫자 나열로 모델에게 간다.
    .replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,7});/gi, (온것, 이름) => {
      const 키 = 이름.toLowerCase();
      if (!키.startsWith('#')) {
        const 번 = 이름글자[이름] ?? 이름글자[키];
        return 번 === undefined ? 온것 : String.fromCodePoint(번);
      }
      const 번호 = 키.startsWith('#x') ? parseInt(키.slice(2), 16) : parseInt(키.slice(1), 10);
      // 못 읽을 번호·못 넣을 번호면 **손대지 않는다.** 지어낸 글자를 넣느니 원문이 낫다.
      if (!Number.isFinite(번호) || 못넣을번호(번호)) return 온것;
      try { return String.fromCodePoint(번호); } catch { return 온것; }
    })
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
  // 안쪽주소인가 — 100.100.100.200(알리바바 메타데이터)·fec0::/10 까지 본다 (사냥4 W9).
  if (안쪽주소인가(다음.hostname) && !allowPrivate) {
    throw new Error(`이 컴퓨터·사내망 주소(${다음.hostname})로 되돌립니다 — 따라가지 않습니다`);
  }
}

/**
 * 되돌림 한 홉을 통째로 본다 — 글자와 **닿는 곳** 둘 다.
 *
 * 첫 주소만 이름을 풀어 보면 소용이 없다. 공개 주소로 시작해 302 한 번으로
 * 사내로 들어가는 것이 가장 흔한 길이라, 홉마다 같은 것을 물어야 한다.
 */
async function 웹되돌림검사(다음, { allowPrivate = false } = {}) {
  웹되돌림(다음, { allowPrivate });
  if (allowPrivate) return;
  const 푼것 = await 사설로풀리나(다음.hostname);
  if (푼것) {
    throw new Error(`되돌린 곳이 사내·로컬로 풀립니다 (${다음.hostname} → ${푼것.걸린것.join(', ')}) — 따라가지 않습니다`);
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
  if (안쪽주소인가(u.hostname) && !allowPrivate) {
    return { error: `이 컴퓨터·사내망 주소는 이 도구로 읽지 않습니다: ${u.hostname}\n  파일은 Read, 사내 서버는 사람이 직접 확인하세요.` };
  }
  /*
   * 이름이 멀쩡해도 **닿는 곳**은 사내일 수 있다 (network.js 의 사설로풀리나).
   * 이름만 보는 검사는 A 레코드 한 줄로 지나간다.
   */
  if (!allowPrivate) {
    const 푼것 = await 사설로풀리나(u.hostname);
    if (푼것) {
      return { error: `이 주소는 사내·로컬로 풀립니다: ${u.hostname} → ${푼것.걸린것.join(', ')}\n  이름은 바깥이지만 닿는 곳이 안입니다. 사내 서버는 사람이 직접 확인하세요.` };
    }
  }

  const close = allowTemporarily(u.origin);
  // 되돌림(redirect)으로 옮겨 간 집도 그 한 번만 연다. 한 홉마다 문지기를 지나므로
  // 여기서 열어 주지 않으면 막힌다 — 그리고 사내망으로 되돌리는 것은 열지 않는다.
  const 열어둔 = [];
  /*
   * 되돌림을 따라가면 **정말 답한 곳**은 처음 주소가 아니다.
   *
   * 여태 기록에도 오류 문구에도 처음 주소만 적혔다. 그래서 짧은주소 하나가
   * 302 로 딴 집에 보내 놓고 429 를 뱉으면, 화면에는 짧은주소가 힘들어한다고
   * 뜬다 — 사람도 모델도 엉뚱한 쪽을 붙잡는다. 심사서에 남는 「어디로 나갔나」
   * 도 마찬가지로 처음 주소만 남아서, 실제로 통신한 집이 빠진다.
   */
  let 닿은곳 = u;
  try {
    // 같은 집이면 줄을 서고, 잠시 뒤 되는 오류면 쉬었다 다시 부른다.
    let res = null;
    let 쉰시간 = 0;
    for (let 회차 = 0; ; 회차++) {
      // 회차마다 처음 주소부터 다시 간다. 여기서 안 되돌리면, 앞 회차에만 되돌림이
      // 있었을 때 되돌림이 **없던** 회차까지 앞 회차의 주소로 기록·보고된다 —
      // 심사서의 「어디로 나갔나」 와 오류 문구가 가 본 적 없는 집을 가리킨다.
      닿은곳 = u;
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
        되돌림: async (다음) => {
          await 웹되돌림검사(다음, { allowPrivate });
          닿은곳 = 다음;
          방문기록.push({ url: 다음.href, status: 0, at: new Date().toISOString(), 되돌림: true });
          열어둔.push(allowTemporarily(다음.origin));
        },
      }), signal);
      방문기록.push({
        url: u.href,
        status: res.status,
        at: new Date().toISOString(),
        // 되돌림을 탔으면 **정말 답한 곳**도 같이 적는다. 처음 주소만 남기면
        // 심사서의 「어디로 나갔나」 에서 실제로 통신한 집이 빠진다.
        ...(닿은곳.href === u.href ? {} : { 닿은곳: 닿은곳.href }),
      });
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
      const 집 = 닿은곳.hostname;
      if (res.status === 429) {
        return { error: `HTTP 429 — ${집} 가 "너무 자주 부른다" 고 합니다.`
          + `\n  ${다시횟수}번 쉬었다 다시 불러 봤습니다(${쉰시간}초). 그래도 같습니다.`
          + '\n  한꺼번에 여러 개를 부르지 말고 하나씩 부르거나, 잠시 뒤에 다시 해 보세요.'
          + '\n  키가 있는 API 면 키를 붙인 주소를 쓰면 한도가 늘어납니다.' };
      }
      if (res.status === 404) return { error: `HTTP 404 — 그런 쪽이 없습니다: ${닿은곳.href}\n  주소를 다시 확인하세요.` };
      if (res.status === 401 || res.status === 403) {
        return { error: `HTTP ${res.status} — ${집} 가 접근을 막았습니다.\n  로그인이나 키가 있어야 하는 쪽입니다. 이 도구로는 못 읽습니다.` };
      }
      if (다시할것.has(res.status)) {
        return { error: `HTTP ${res.status} — ${집} 가 지금 힘들어합니다.`
          + `\n  ${다시횟수}번 다시 불러 봤습니다(${쉰시간}초). 잠시 뒤에 다시 해 보세요.` };
      }
      /*
       * 되돌림을 못 따라간 까닭이 있으면 같이 말한다 (사냥4 W19 · http.js 의 되돌림탈).
       * 「HTTP 302 — 주소」 한 줄로는 제자리를 도는 서버인지, Location 이 깨졌는지 모른다 —
       * 모델은 같은 주소를 또 부른다.
       */
      return { error: `HTTP ${res.status} — ${닿은곳.href}${res.되돌림탈 ? `\n  ${res.되돌림탈}` : ''}` };
    }

    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    /*
     * 갈래는 **낱말로** 본다.
     *
     * 그냥 `/text|json|xml|javascript/` 로 보면 두 쪽에서 틀린다.
     * `application/octet-stream; name="context.bin"` 은 'context' 안의 text 에
     * 걸려 통과하고(내려받은 바이너리가 모델에게 간다), `application/yaml` 이나
     * `application/toml` 같은 멀쩡한 글은 낱말이 없어서 거절당한다.
     */
    const 갈래 = type.split(';')[0].trim();
    const 뒷말 = 갈래.split('/')[1] ?? '';
    const 글인가 = /^text\//.test(갈래)
      || /(^|[-+.])(json|xml|javascript|ecmascript|yaml|toml|csv|ndjson|graphql)$/.test(뒷말);
    // 갈래가 **아예 없는** 답은 여기서 거절하지 않는다 — 아래에서 알맹이를 보고 가른다.
    if (!글인가 && 갈래) {
      await res.버리기?.();
      return { error: `글이 아닌 내용입니다 (${type}). 이 도구는 글만 읽습니다.` };
    }

    const buf = await 몸읽기(res.res.body, MAX_BYTES);
    if (!buf) return { error: `너무 큽니다 (${MAX_BYTES / 1024 / 1024}MB 넘음) — 받다 말았습니다. 범위를 좁힌 주소를 쓰세요.` };

    /*
     * ── Content-Type 이 없는 200 (사냥4 W18) ──────────────────────────────
     *
     * 여태는 「글이 아닌 내용입니다 (알 수 없음)」 으로 거절했다. 옛 사내 서버·정적 파일
     * 서버·짧은 CGI 가 머리글을 안 붙이는 일이 흔해서, 멀쩡한 글 페이지가 통째로 막혔다.
     * 브라우저도 이때는 알맹이를 보고 가른다(MIME sniffing). 앞 8KB 에 NUL 이 있거나
     * PDF 머리면 바이너리로 보고 거절하고, 아니면 글로 읽는다. `<html` 로 시작하면
     * 태그를 벗긴다. 상한(MAX_BYTES)은 위에서 이미 걸렸다 — 보고 나서 버려도 크게 안 받는다.
     */
    /*
     * 볼갈래도 **낱말**이다 (8회차 · 바깥). 여기에 머리글 원문을 담았더니
     * `application/json; name="index.html"` 이 아래 `/html/` 에 걸려서 **JSON
     * 본문의 태그를 벗겼다** — `{"a":"<b>굵게</b>"}` 가 `{"a":" 굵게 "}` 가 되고,
     * 값이 깎였다는 말은 어디에도 안 나온다. 위에서 이미 갈래를 낱말로 갈라 뒀다.
     */
    let 볼갈래 = 갈래;
    if (!갈래) {
      const 앞 = buf.subarray(0, 8192);
      if (앞.includes(0) || 앞.subarray(0, 5).toString('latin1') === '%PDF-') {
        return { error: '글이 아닌 내용입니다 (Content-Type 이 없고 알맹이가 바이너리입니다). 이 도구는 글만 읽습니다.' };
      }
      const 머리떼고 = 앞.subarray(앞[0] === 0xef && 앞[1] === 0xbb && 앞[2] === 0xbf ? 3 : 0).toString('latin1');
      /*
       * 엿보는 목록은 WHATWG MIME Sniffing 표준의 「HTML 서명」 그대로다 (6회차 Gemini 웹받기 W9).
       * doctype·html·head·body 넷만 봐서, 주석이나 `<div>` 로 시작하는 옛 페이지는 태그·스크립트째
       * 글로 넘어갔다. 표준처럼 이름 뒤에 빈칸이나 `>` 가 와야 한다 — `<a` 가 `<abc` 에 걸리지 않게.
       */
      볼갈래 = /^\s*(?:<!--|<(?:!doctype\s+html|html|head|script|iframe|h1|div|font|table|a|style|title|b|body|br|p)[\s>])/i.test(머리떼고)
        ? 'text/html' : 'text/plain';
    }

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
    if (/html/.test(볼갈래)) text = 태그벗기기(text);
    /*
     * `<meta charset>` 이 머리글과 **다르게** 적혀 있는 페이지가 있다.
     *
     * 여기 `!머리글` 이 붙어 있어서, 정작 그 판 — 머리글이 있는데 틀린 판 —
     * 에서는 한 번도 안 돌았다. 서버가 기본값으로 `charset=utf-8` 을 붙이고
     * 본문은 EUC-KR 인 옛 사내 위키가 딱 그렇다. 깨진 글이 그대로 모델에게
     * 가고, 모델은 깨진 채로 요약한다.
     *
     * 다시 읽어서 **덜 깨진 쪽**을 쓴다. 세어 보고 고르니 더 나빠질 일이 없다.
     */
    /*
     * 그런데 문을 여는 조건이 `깨진수(text)` 하나라, **정작 그 판에서 한 번도 안 돌았다**
     * (막판 훑기). 한 바이트짜리 인코딩(`iso-8859-1` · `windows-1252` · `us-ascii`)은
     * 모든 바이트에 글자가 있어서, 아무리 엉뚱하게 읽어도 � 가 0 이다 — 이 파일이 위
     * 웹글읽기 머리말에서 스스로 「1252 는 � 를 안 내놓는다」 고 적어 둔 그것이다.
     * 그리고 서버 기본값으로 제일 흔히 붙는 것이 바로 그 이름들이다.
     *
     * 그러니 머리글이 그 부류면 � 수는 아무것도 안 말해 준다. 그때는 문을 열고,
     * 같은 수로 나와도 **문서가 제 입으로 적어 둔 쪽**을 쓴다. 더 깨지면 안 쓴다 —
     * 세어 보고 고르는 것은 그대로다.
     */
    const 깨진수 = (그것) => (그것.match(/�/g) ?? []).length;
    const 셀수없나 = !!머리글 && /^(iso-?8859-\d+|windows-125\d|cp125\d|us-ascii|ascii|latin1)$/i.test(머리글);
    if (깨진수(text) || 셀수없나) {
      const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.toString('latin1').slice(0, 2000))?.[1]?.toLowerCase();
      if (meta && meta !== 머리글) {
        let 다시 = 웹글읽기(buf, meta);
        if (/html/.test(볼갈래)) 다시 = 태그벗기기(다시);
        if (깨진수(다시) < 깨진수(text) || (셀수없나 && 깨진수(다시) === 깨진수(text))) text = 다시;
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
    const json쪽 = /json/.test(볼갈래);
    let 눌렀나 = false;
    if (json쪽 && text.length > max) {
      try {
        const 눌린것 = JSON.stringify(JSON.parse(text));
        if (눌린것.length < text.length) { text = 눌린것; 눌렀나 = true; }
      } catch { /* JSON 이 아니거나 이미 잘려 온 것이다. 그냥 둔다 */ }
    }

    const 원래길이 = text.length;
    const cut = 원래길이 > max;
    if (cut) {
      /*
       * 자르는 자리가 **대리쌍 한가운데**면 한 칸 앞에서 자른다 (사냥4 W17).
       * `slice` 는 UTF-16 칸으로 자른다. 이모지·옛 한자처럼 두 칸짜리 글자가 경계에
       * 걸리면 앞 반쪽(D800–DBFF)만 남는데, 그건 글자가 아니다 — JSON 으로 게이트웨이에
       * 실으면 넘어지는 곳이 있고, 화면에는 � 로 찍힌다.
       */
      const 앞칸 = text.charCodeAt(max - 1);
      text = text.slice(0, 앞칸 >= 0xd800 && 앞칸 <= 0xdbff ? max - 1 : max);
    }

    let 꼬리 = '';
    if (cut) {
      const 남은것 = (원래길이 - text.length).toLocaleString();
      꼬리 = json쪽
        ? `\n\n(여기서 잘렸습니다 — ${남은것}자가 더 있습니다.`
          + '\n 잘린 JSON 은 그대로 읽을 수 없습니다. 다음 중 하나를 하세요:'
          + '\n  · 범위를 좁혀 다시 부른다 (per_page·ids·days 같은 조건을 붙인다)'
          + `\n  · 같은 주소를 max_chars 를 올려 다시 부른다 (지금 ${max.toLocaleString()}, 최대 120,000)`
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
    /*
     * 넘어진 까닭은 **속에** 있다 (8회차 · 바깥).
     *
     * fetch 는 무엇이 잘못됐든 겉으로는 `TypeError: fetch failed` 한 줄이고, 진짜
     * 까닭(getaddrinfo ENOTFOUND · connect ECONNREFUSED · 인증서)은 `err.cause` 에
     * 들어 있다. 겉만 보던 때는 아래 DNS 갈래가 한 번도 안 걸렸고, 사람과 모델은
     * 「fetch failed」 만 받아 주소가 틀렸는지 문이 닫혔는지 모른 채 같은 주소를 또 불렀다.
     */
    const 까닭들 = [];
    for (let e = err; e && 까닭들.length < 4; e = e.cause) {
      const 한줄 = String(e?.message ?? e);
      if (한줄 && !까닭들.includes(한줄)) 까닭들.push(한줄);
    }
    const m = 까닭들.join(' — ') || String(err);
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
        // 상한은 **첫 문장**에 둔다. 좁은 창에서는 설명을 문장 단위로 줄이는데(tools/index.js 의
        // 설명줄이기) 끝에 붙여 두면 그 수가 먼저 잘려, 모델이 상한을 모른 채 max_chars 를 정했다.
        max_chars: { type: 'number', description: '가져올 최대 글자 수 (최대 120000). 안 주면 모델 크기에 맞춰 정해진다. 자료가 잘리면 여기를 올린다' },
      },
      required: ['url'],
    },
  },
  // signal 을 같이 넘긴다. 안 넘기면 ESC 를 눌러도 이 도구만 최대 30초를 더 산다
  // — 화면은 「멈추는 중…」 인데 실제로는 남의 서버를 계속 붙들고 있는 상태다.
  run: (args, ctx) => webFetch(args, { 모델컨텍스트: ctx?.모델컨텍스트 ?? null, signal: ctx?.signal ?? null }),
};
