// 도구 목록을 **보내기 직전에** 그 회사 규격에 맞춘다.
//
// ── 왜 여기서 하나 ──────────────────────────────────────────────────────
//
// 도구 목록을 만드는 자리(tools/index.js)는 어디로 보낼지 모른다. 같은 목록이
// 로컬 llama.cpp 로도 가고 Anthropic 으로도 간다. 그래서 만드는 자리에서
// 「Gemini 가 싫어하는 열쇠」 를 빼면, 그것을 아무렇지 않게 받는 서버에서도
// 값을 잃는다.
//
// 반대로 보내는 자리(adapter.js 의 chat·chatStream)는 conn 을 쥐고 있다.
// 주소를 보면 어디로 가는지 안다. 그러니 **거기서 한 번** 다듬는 것이 맞다.
//
// ── 어디로 가는지는 주소로 안다 ─────────────────────────────────────────
//
// 모델 이름으로 짐작하지 않는다. LiteLLM 같은 사내 게이트웨이 뒤에 Claude 가
// 있어도, 우리가 말을 거는 상대는 게이트웨이다. 그 게이트웨이가 제 나름대로
// 이미 다듬어서 넘긴다 — 우리가 모델 이름만 보고 「Anthropic 이니까」 하고
// 깎으면, 게이트웨이는 멀쩡히 받던 것을 못 받게 된다.
//
// 그래서 **주소의 호스트**만 본다. 모르는 주소면 아무것도 안 건드린다.
// 이 프로그램의 주된 자리(로컬 모델·사내 게이트웨이)가 바로 그 「모르는
// 주소」 라, 기본은 지금까지와 똑같이 도는 쪽이어야 한다.
//
// ── 이름을 바꾸면 되돌려야 한다 ─────────────────────────────────────────
//
// 이름이 규격에 안 맞아 고쳐 보내면, 모델은 **고친 이름**으로 부른다.
// 그대로 위로 올리면 loop.js 가 모르는 도구를 받는다 — 도구가 조용히
// 안 불리는, 제일 알아내기 어려운 고장이다. 그래서 다듬은 자리에서
// 되돌림 표를 같이 내놓고, 답이 오면 adapter.js 가 그 표로 되돌린다.
// 밖에서는 이 일이 있었는지조차 모른다.
import { 애저인가 } from './azure.js';

/**
 * 이름 규칙.
 *
 * OpenAI 문서에 적힌 그대로다 — "alphanumeric characters, underscores, or
 * dashes, with a maximum length of 64 characters". Anthropic·Bedrock 도 같은
 * 모양을 쓰고, Gemini 는 여기에 점을 더 받는다. 제일 좁은 것 하나로 맞추면
 * 어디로 보내도 통한다 — 회사마다 다르게 깎을 까닭이 없다.
 */
const 이름규칙 = /^[a-zA-Z0-9_-]{1,64}$/;
const 이름최대 = 64;

/**
 * Gemini 가 받는 스키마 열쇠.
 *
 * 문서가 "function calling supports only a subset of the OpenAPI schema" 라고
 * 말한다. 무엇이 되는지를 적어 둔 목록은 있어도 **무엇이 안 되는지**를 적어
 * 둔 목록은 없다. 그러니 허용 목록으로 간다 — 모르는 열쇠를 실어 보내는 쪽이
 * 위험하다. 안 되는 열쇠 하나가 400 을 만들고, 그러면 그 턴이 통째로 죽는다.
 *
 * 우리 도구는 이 목록 안에서만 쓴다(type·description·properties·required·
 * items·enum). 그래서 이 거르개에 걸리는 것은 사실상 **MCP 서버가 준 스키마**
 * 뿐이다. 남이 만든 스키마에는 $schema·$ref·oneOf·additionalProperties 가
 * 흔하다.
 */
const 제미니열쇠 = new Set([
  'type', 'format', 'description', 'nullable', 'enum', 'items', 'properties',
  'required', 'minItems', 'maxItems', 'minimum', 'maximum', 'anyOf', 'title',
  'example', 'default', 'propertyOrdering',
]);

/**
 * format 은 값까지 본다.
 *
 * 열쇠는 받는데 모르는 **값**이면 거절하는 자리다. `format: 'uri'` ·
 * `'uuid'` 같은 것이 MCP 스키마에 자주 있다. 지우면 뜻이 조금 얕아질 뿐이고,
 * 실어 보내면 요청이 죽는다 — 어느 쪽이 나은지는 분명하다.
 */
const 제미니format = {
  string: new Set(['date-time', 'date', 'time', 'duration', 'enum']),
  number: new Set(['float', 'double']),
  integer: new Set(['int32', 'int64']),
};

/**
 * 이 주소는 어느 회사인가.
 *
 * @returns {'anthropic'|'gemini'|'bedrock'|'openai'|'azure'|null}  모르면 null —
 *   그때는 **아무것도 안 건드린다**.
 *
 * ── Azure 를 왜 따로 부르나 ─────────────────────────────────────────────
 *
 * 도구를 다듬는 데는 둘이 똑같다(아래 도구맞추기 에서 둘 다 이름만 손본다).
 * 갈리는 자리는 **몸통**이다 — OpenAI 직통의 추론 모델은 출력 상한을 옛 이름
 * (`max_tokens`)으로 주면 「지원 안 하는 인자」 라고 튕기는데, Azure 는 옛 판이
 * 아직 많아서 그 이름을 그대로 받는다. 둘을 한 이름으로 묶어 두면 한쪽을
 * 고치는 순간 다른 쪽이 깨진다.
 *
 * Azure 인지는 **azure.js 에게 묻는다.** 여기서 글자 조각으로 따로 판단하면
 * detect 와 답이 갈리고, 갈리는 순간 한쪽만 맞는 자리가 생긴다.
 */
/**
 * mantle 창구의 호스트인가.
 *
 * 이 규칙이 여기와 backend/detect.js 두 군데에 똑같이 적혀 있었다. AWS 가
 * 이름을 하나 더 내면 한쪽만 고쳐지고, 그러면 「연결은 되는데 전선 카드가
 * 모르는 주소로 선다」 는 반쯤 되는 상태가 된다 — 화면에 아무 말도 안 뜨는
 * 종류다. 주소를 알아보는 규칙은 이 파일이 갖는다고 이미 정해 두었으므로
 * (아래 벤더 머리말) 여기에 두고 detect 가 가져다 쓴다.
 *
 * @param {string} 호스트 소문자로 맞춘 hostname
 */
export function 맨틀호스트인가(호스트) {
  const h = String(호스트 ?? '').toLowerCase();
  return h.startsWith('bedrock') && h.endsWith('.api.aws');
}

export function 벤더(conn) {
  let 호스트 = '';
  try { 호스트 = new URL(String(conn?.base ?? '')).hostname.toLowerCase(); }
  catch { 호스트 = ''; }

  if (호스트) {
    if (호스트 === 'anthropic.com' || 호스트.endsWith('.anthropic.com')) return 'anthropic';
    if (호스트.endsWith('.googleapis.com')) return 'gemini';
    // bedrock-runtime.<리전>.amazonaws.com. amazonaws 아래에는 남의 것도 많아서
    // 앞머리까지 본다 — S3 주소를 Bedrock 으로 읽으면 안 된다.
    if (호스트.startsWith('bedrock') && 호스트.endsWith('.amazonaws.com')) return 'bedrock';
    /*
     * mantle 은 amazonaws.com 이 아니라 **api.aws** 아래에 있다.
     *
     *   bedrock-mantle.us-east-1.api.aws
     *
     * 위 줄만 있으면 이 주소가 Bedrock 으로 안 읽힌다. 그러면 전선 카드가
     * 회사를 못 정하고(backend/wire.js), 눈금도 캐시 최소 크기도 전부
     * 「모르는 주소」 취급이 된다 — 즉 mantle 로 붙인 사람만 조용히 손해를
     * 본다. 여기서도 앞머리를 같이 보는 이유는 위와 같다.
     */
    if (맨틀호스트인가(호스트)) return 'bedrock';
    if (애저인가(conn?.base)) return 'azure';
    if (호스트 === 'api.openai.com') return 'openai';
  }
  /*
   * 주소를 못 읽었을 때만 규격을 본다.
   *
   * 규격이 'anthropic' 이라는 것은 우리가 Anthropic **말투**로 말한다는 뜻이라,
   * 상대가 그 규칙을 볼 확률이 높다. 주소가 있는데도 규격을 앞세우면, 사내
   * 게이트웨이를 Anthropic 말투로 붙여 쓰는 사람이 손해를 본다.
   */
  if (!호스트 && conn?.kind === 'anthropic') return 'anthropic';
  return null;
}

/** 규격에 맞는 이름으로. 못 쓰는 글자는 밑줄, 너무 길면 가운데를 지문으로 접는다. */
function 이름다듬기(원래, 쓴것) {
  /*
   * 못 쓰는 글자는 **덩어리째** 밑줄 하나로 바꾸고, 지문을 붙인다.
   *
   * 글자마다 밑줄로 바꾸면 이렇게 된다 —
   *
   *   mcp__사내문서__검색   →  mcp__________
   *   mcp__사내문서__열기   →  mcp__________
   *   mcp__사내문서__지우기 →  mcp___________
   *
   * 겹치는 것은 뒤에 번호를 붙여 면할 수 있다. 그런데 **모델이 보는 이름이
   * 서로 구별이 안 된다.** 「검색해 줘」 라고 했는데 지우기가 불릴 수 있고,
   * 그건 오류도 안 난다 — 이 파일이 없애려던 바로 그 고장이다.
   *
   * 그래서 지문을 붙인다. 읽히지는 않아도 **서로 다르고, 판마다 같다.**
   * 무엇을 하는 도구인지는 설명이 그대로 지고 간다(`[사내문서] 검색`) —
   * 이름이 못 읽히는 자리에서 뜻을 지는 것은 설명 쪽이다.
   */
  const 원본 = String(원래 ?? '');
  let 새것 = 원본.replace(/[^a-zA-Z0-9_-]+/g, '_');
  /*
   * 영숫자가 하나도 안 남는 이름(`검색` → `_`)은 `tool_지문` 으로. 여태 지문을 먼저 붙인 **뒤에** 영숫자를
   * 봐서, 지문 자체가 영숫자라 늘 통과했고 `_fxrcde` 처럼 밑줄로 시작하는 이름이 나갔다 — 이 줄이
   * 하려던 것과 거꾸로다 (6회차 Gemini 도구맞춤6 T4).
   */
  if (!/[a-zA-Z0-9]/.test(새것)) 새것 = `tool_${지문(원본)}`;
  else if (새것 !== 원본) 새것 = `${새것.replace(/_+$/, '')}_${지문(원본)}`;
  if (새것.length > 이름최대) {
    /*
     * 앞뒤를 남기고 가운데를 지문으로 접는다.
     *
     * 앞만 남기고 자르면 안 된다. `mcp__아주긴서버이름__read` 와 `..__write`
     * 가 앞 64자에서 **똑같아진다**. 우리 쪽은 뒤에 번호를 붙여 겹침을 면할
     * 수 있지만, 모델이 보는 이름은 둘 다 `mcp__아주긴서버이름…` 이라
     * 무엇이 읽기고 무엇이 쓰기인지 알 길이 없다. 그러면 모델은 아무거나
     * 고르고, 우리는 그것을 오류로도 못 잡는다.
     *
     * 도구 이름에서 뜻을 지고 있는 자리는 **뒤쪽**(도구 이름)이고, 앞쪽은
     * 어느 서버인지를 말한다. 둘 다 남겨야 이름이 이름 노릇을 한다.
     * 가운데를 지문으로 채우는 것은 그러고도 겹치지 않게 하려는 것이다.
     */
    const 지문6 = 지문(원래);
    const 앞몫 = 26;
    const 뒷몫 = 이름최대 - 앞몫 - 지문6.length - 2;   // 밑줄 둘
    새것 = `${새것.slice(0, 앞몫)}_${지문6}_${새것.slice(-뒷몫)}`;
  }
  // 그래도 겹치면 뒤에 숫자를 붙인다. 겹치는 일은 드물지만, 나면 조용하다.
  if (쓴것.has(새것)) {
    let n = 2;
    let 후보 = '';
    do { 후보 = 새것.slice(0, 이름최대 - String(n).length - 1) + '_' + n; n++; } while (쓴것.has(후보));
    새것 = 후보;
  }
  return 새것;
}

/**
 * 짧은 지문. 암호용이 아니라 이름이 안 겹치게 하려는 것뿐이다.
 *
 * **뒷자리를 남긴다.** 앞자리를 남기면 안 된다 — 32비트 값을 36진수로 적으면
 * 길어야 일곱 자라, 여덟 자로 맞추려고 앞을 0 으로 채우게 된다. 그 상태에서
 * 앞 여섯 자를 떼면 채워 넣은 0 을 세고 있는 셈이고, 정작 제일 자주 바뀌는
 * 뒷자리 둘이 통째로 날아간다. 21억 가지로 갈리라고 만든 것이 330만 가지로
 * 줄었다(이름 20만 개로 재 보니 겹침이 4건에서 5,825건으로 늘었다).
 *
 * 겹치면 아래에서 뒤에 번호를 붙여 면하는데, 그 번호는 **목록 차례를 탄다.**
 * 그러니 지문이 겹치는 순간 이 파일이 없애려던 고장이 그대로 돌아온다 —
 * MCP 서버가 다시 붙어 도구 차례가 바뀌면 검색과 지우기가 이름을 맞바꾼다.
 */
function 지문(글, 자릿수 = 6) {
  let h = 2166136261;
  const s = String(글);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).padStart(자릿수, '0').slice(-자릿수);
}

/**
 * Gemini 가 받는 모양으로 스키마를 다시 짓는다.
 *
 * 못 받는 열쇠를 빼고 나면 `type` 이 없어지는 마디가 생긴다($ref 만 있던 곳).
 * 그대로 두면 그 마디가 뜻 없는 빈 것이 되므로, 남은 것을 보고 갈래를
 * 되짚어 준다. 되짚을 것조차 없으면 string 으로 둔다 — 없는 것보다 낫다.
 */
/*
 * ── $ref 는 가리키는 정의로 풀어 적는다 ─────────────────────────────────
 *
 * pydantic 같은 도구가 만든 MCP 스키마는 중첩 모델을 `$defs` + `$ref` 로 적는다.
 * Gemini 스키마는 $ref 를 모른다. 여태 그 열쇠를 빼기만 해서 마디가 비었고, 빈
 * 마디는 아래에서 **string** 으로 떨어졌다 — 객체를 받는 인자에 모델이 글을
 * 넣어 부르고, 도구는 인자가 틀렸다고만 한다. 뜻이 얕아지는 것이 아니라 뒤집힌다.
 *
 * 같은 스키마 안(`#/…`)만 푼다. 바깥 파일·주소는 따라가지 않는다 — 읽을 길도
 * 없고, 보내기 직전에 남의 주소를 두드리면 안 된다.
 *
 * 자기를 가리키는 정의(나무 모양)는 끝이 없으므로 **몇 겹까지만** 푼다. 그 뒤로는
 * 정의의 갈래(type)만 남긴다. 속까지는 못 적어도 「객체다」 는 안 뒤집힌다.
 * 다섯 겹이면 가지가 셋인 나무도 수백 마디에서 멎는다 — 너무 큰 스키마는 그것대로
 * 거절당한다.
 */
const 참조최대 = 5;

function 참조찾기(뿌리, 참조) {
  if (typeof 참조 !== 'string' || !참조.startsWith('#/')) return null;
  let 곳 = 뿌리;
  for (const 조각 of 참조.slice(2).split('/')) {
    let 이름;
    try { 이름 = decodeURIComponent(조각).replace(/~1/g, '/').replace(/~0/g, '~'); } catch { return null; }
    if (!곳 || typeof 곳 !== 'object' || !Object.hasOwn(곳, 이름)) return null;
    곳 = 곳[이름];
  }
  return 곳 && typeof 곳 === 'object' && !Array.isArray(곳) ? 곳 : null;
}

function 제미니스키마(값, 뿌리 = 값, 풀린수 = 0) {
  if (Array.isArray(값)) return 값.map((v) => 제미니스키마(v, 뿌리, 풀린수));
  if (!값 || typeof 값 !== 'object') return 값;

  if (typeof 값.$ref === 'string') {
    const 정의 = 참조찾기(뿌리, 값.$ref);
    // 곁에 적힌 열쇠(설명 등)가 정의보다 앞선다 — 그 자리에 맞춰 적은 말이다.
    const 곁 = { ...값 };
    delete 곁.$ref;
    if (정의 && 풀린수 < 참조최대) return 제미니스키마({ ...정의, ...곁 }, 뿌리, 풀린수 + 1);
    if (정의?.type) return 제미니스키마({ type: 정의.type, ...곁 }, 뿌리, 풀린수);
  }
  const 안쪽 = (v) => 제미니스키마(v, 뿌리, 풀린수);

  /*
   * allOf 는 버리기 전에 **객체 갈래의 속성을 펼쳐 싣는다.**
   *
   * Gemini 스키마는 allOf 를 모른다(제미니열쇠). 그냥 거르면 그 안에 적힌 속성이 통째로
   * 사라지고 바깥 `required` 만 남는다 — 그러면 Gemini 는 「없는 속성을 required 에 적었다」
   * 로 스키마째 거절하고, 모델은 그 인자가 있는 줄도 모른다(4회차 Gemini 리뷰 · 실행 확인).
   * 바깥에 적힌 속성이 이긴다. 갈래끼리 겹치면 앞 갈래가 이긴다. 객체가 아닌 갈래는 못 합친다.
   */
  if (Array.isArray(값.allOf)) {
    const 펼친 = { ...값, properties: { ...(값.properties ?? {}) }, required: [...(Array.isArray(값.required) ? 값.required : [])] };
    delete 펼친.allOf;
    /*
     * 갈래는 **끝까지** 푼다. 한 번만 풀었더니 `$ref → $ref` 로 이어진 갈래(`A` 가 `B` 를 가리킴)는 `{ $ref }`
     * 만 남고, 갈래 안에 또 `allOf` 가 든 것(상속을 두 겹 받은 모델)은 그 안쪽을 안 봐서 속성이 통째로
     * 사라졌다 — 바깥 `{type:'object'}` 만 나가 모델은 인자가 있는 줄도 모른다 (6회차 Gemini 도구맞춤6 G3).
     * 앞 갈래가 이기는 차례는 그대로다(깊이 먼저). 참조가 돌거나 너무 깊으면 8겹에서 멈춘다.
     */
    const 갈래풀기 = (갈래, 깊이 = 0) => {
      let g = 갈래;
      for (let i = 0; i < 8 && g && typeof g.$ref === 'string'; i++) g = 참조찾기(뿌리, g.$ref) ?? null;
      if (!g || typeof g !== 'object' || Array.isArray(g) || typeof g.$ref === 'string') return [];
      return [g, ...(Array.isArray(g.allOf) && 깊이 < 8 ? g.allOf.flatMap((x) => 갈래풀기(x, 깊이 + 1)) : [])];
    };
    for (const 풀린갈래 of 값.allOf.flatMap((x) => 갈래풀기(x))) {
      for (const [n, s] of Object.entries(풀린갈래.properties ?? {})) if (!Object.hasOwn(펼친.properties, n)) 펼친.properties[n] = s;
      if (Array.isArray(풀린갈래.required)) 펼친.required.push(...풀린갈래.required);
    }
    if (!Object.keys(펼친.properties).length && 값.properties === undefined) delete 펼친.properties;
    펼친.required = [...new Set(펼친.required)];
    if (!펼친.required.length && 값.required === undefined) delete 펼친.required;
    return 제미니스키마(펼친, 뿌리, 풀린수);
  }

  const 새것 = {};
  for (const [k, v] of Object.entries(값)) {
    /*
     * oneOf 는 버리지 않고 anyOf 로 옮겨 적는다.
     *
     * 이 스키마는 oneOf 를 모르고 anyOf 는 안다. 그런데 oneOf 를 그냥 빼면 그
     * 자리가 빈 마디가 되어 아래에서 **string** 으로 떨어졌다. 갈래가 객체 둘이면
     * 뜻이 뒤집힌다 — 모델은 객체 대신 글을 넣어 부르고, 도구는 인자가 틀렸다고만
     * 한다. 「정확히 하나」 가 「하나 이상」 으로 느슨해질 뿐 받는 모양은 남는다.
     * anyOf 가 이미 있으면 그쪽을 믿고 oneOf 는 버린다 — 둘을 섞으면 뜻이 바뀐다.
     */
    if (k === 'oneOf' && Array.isArray(v) && 값.anyOf === undefined) { 새것.anyOf = 안쪽(v); continue; }
    if (!제미니열쇠.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      const 속성 = {};
      for (const [n, s] of Object.entries(v)) 속성[n] = 안쪽(s);
      새것.properties = 속성;
      continue;
    }
    if (k === 'items' || k === 'anyOf') { 새것[k] = 안쪽(v); continue; }
    새것[k] = v;
  }

  /*
   * `type: ['string','null']` 은 JSON Schema 의 말이지 OpenAPI 의 말이 아니다.
   * 널을 받는다는 뜻이었으니 nullable 로 옮겨 적는다 — 그냥 버리면 "널을
   * 줘도 된다" 는 정보가 사라진다.
   */
  if (Array.isArray(새것.type)) {
    const 진짜 = 새것.type.filter((t) => t !== 'null');
    if (새것.type.length !== 진짜.length) 새것.nullable = true;
    /*
     * 갈래가 둘 이상 남으면(`['string','number']`) 첫 갈래로 좁히지 않고 anyOf 로 옮긴다. 좁히면 수도 받는
     * 칸에 모델이 늘 글자만 넣는다 (6회차 Gemini 도구맞춤6 G1). 속성·항목이 붙은 칸은 갈래마다 나눌 수
     * 없어 전처럼 첫 갈래로 둔다. anyOf 만 있는 마디는 아래에서 갈래를 안 채운다.
     */
    if (진짜.length > 1 && 새것.anyOf === undefined && !새것.properties && !새것.items) {
      새것.anyOf = 진짜.map((t) => ({ type: t }));
      delete 새것.type;
    } else 새것.type = 진짜[0] ?? 'string';
  }

  /*
   * ── enum 은 **글자 목록**뿐이다 ─────────────────────────────────────────
   *
   * API 참조의 Schema 가 `"enum": [ string ]` 이라고 못 박는다. MCP 스키마에는
   * `{ type:'integer', enum:[1,2,3] }` 이 흔한데, 그대로 실으면 그 목록이 거절되고
   * 그 턴이 통째로 죽는다 — 화면에서는 열쇠가 틀린 것과 구별이 안 되는 400 이다.
   *
   * 글자 칸의 글자 목록은 그대로 둔다. 그 밖의 목록은 enum 을 빼고 **받는 값을
   * 설명에 옮겨 적는다.** 칸의 갈래(integer·number)는 그대로라 값이 숫자로 나가고,
   * 그러니 되돌릴 것이 없다. 모델은 설명을 읽고 여전히 무엇을 넣을지 안다.
   *
   * 목록 속 null 은 「비워도 된다」 는 뜻이니 nullable 로 옮긴다. const 는 값 하나짜리
   * 목록이다 — 빼기만 하면 「이 값만」 이라는 뜻이 사라진다. 갈래 없이 숫자 목록만
   * 적힌 자리는 아래에서 string 으로 떨어지므로, 여기서 숫자 갈래를 먼저 되짚는다.
   */
  /*
   * `required` 에는 `properties` 에 **있는 이름만** 남긴다.
   *
   * Gemini 는 없는 속성을 required 에 적은 스키마를 「property is not defined」 로 통째로
   * 거절한다 — 그 도구 하나가 아니라 그 요청이 죽는다. MCP 서버가 적은 스키마가 원래
   * 어긋나 있기도 하고, 위에서 모르는 열쇠를 거르다 속성이 빠지기도 한다. 이름이 없는
   * 필수 칸은 모델이 채울 길도 없으니, 빼도 잃는 뜻이 없다.
   */
  if (Array.isArray(새것.required)) {
    const 있는속성 = 새것.properties && typeof 새것.properties === 'object' ? 새것.properties : {};
    const 남길이름 = [...new Set(새것.required.filter((n) => typeof n === 'string' && Object.hasOwn(있는속성, n)))];
    // 원래 빈 목록(`required: []`)은 그대로 둔다 — 우리 도구가 그렇게 적고, 건드리면 「안 깎는다」 약속이 깨진다.
    if (남길이름.length || !새것.required.length) 새것.required = 남길이름;
    else delete 새것.required;
  }

  if (값.const !== undefined && 새것.enum === undefined) 새것.enum = [값.const];
  if (Array.isArray(새것.enum)) {
    const 널뺀것 = 새것.enum.filter((v) => v !== null);
    if (널뺀것.length !== 새것.enum.length) 새것.nullable = true;
    if (새것.type === undefined && 널뺀것.length && 널뺀것.every((v) => typeof v === 'number')) {
      새것.type = 널뺀것.every(Number.isInteger) ? 'integer' : 'number';
    }
    if (널뺀것.length && 널뺀것.every((v) => typeof v === 'string') && (새것.type === undefined || 새것.type === 'string')) {
      새것.enum = 널뺀것;
    } else {
      delete 새것.enum;
      if (널뺀것.length) {
        const 받는값 = `allowed values: ${널뺀것.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ')}`;
        새것.description = 새것.description ? `${새것.description} (${받는값})` : 받는값;
      }
    }
  }

  if (새것.type === undefined) {
    // 속성 없이 additionalProperties 만 적은 자리는 「아무 키나 받는 객체」 다. string 으로
    // 떨어뜨리면 모델이 객체 대신 글을 넣어 부르고, 그 도구는 인자가 틀렸다고만 한다.
    if (새것.properties || 값.additionalProperties !== undefined || 값.patternProperties !== undefined) 새것.type = 'object';
    else if (새것.items) 새것.type = 'array';
    else if (새것.anyOf) { /* anyOf 는 갈래를 안 적어도 된다 */ }
    else 새것.type = 'string';
  }

  /*
   * format 은 **갈래가 정해진 뒤에** 본다.
   *
   * 앞에서 보고 있었더니 `{format:'date-time'}` 처럼 갈래를 안 적은 칸이
   * `제미니format[undefined]` 에 걸려 format 을 잃었다 — 바로 다음 줄에서
   * string 으로 정해지는 자리라, 제미니가 받는 조합(string + date-time)을
   * 우리가 먼저 깎은 셈이다. 차례만 바꾸면 된다.
   */
  if (새것.format !== undefined) {
    const 받는것 = 제미니format[String(새것.type)];
    if (!받는것 || !받는것.has(String(새것.format))) delete 새것.format;
  }
  return 새것;
}

/** 규격이 요구하는 「인자는 객체」 를 지킨다. 빈 것도 객체여야 한다. */
function 객체로(p) {
  if (p && typeof p === 'object' && !Array.isArray(p) && p.type === 'object') return p;
  if (p && typeof p === 'object' && !Array.isArray(p) && p.properties) return { ...p, type: 'object' };
  return { type: 'object', properties: {} };
}

/**
 * 보내기 직전 다듬기.
 *
 * @param {Array|null} tools  toolSchemas() 가 낸 OpenAI 모양 목록
 * @param {object} conn
 * @returns {{tools: Array|null, 되돌림: Map<string,string>|null, 손본것: {이름: number, 스키마: number}}}
 *
 * **되돌림이 null 이면 이름을 하나도 안 바꿨다는 뜻이다.** 부르는 쪽이 그
 * 경우에 아무 일도 안 하도록, 빈 Map 대신 null 을 준다.
 */
export function 도구맞추기(tools, conn) {
  const 그대로 = { tools, 되돌림: null, 손본것: { 이름: 0, 스키마: 0 } };
  if (!Array.isArray(tools) || !tools.length) return 그대로;
  const v = 벤더(conn);
  if (!v) return 그대로;

  const 되돌림 = new Map();
  const 쓴것 = new Set();
  /*
   * 규칙에 맞아 **그대로 나갈** 이름을 먼저 모은다.
   *
   * 고친 이름은 앞에서 쓴 이름(쓴것)만 피하고 있었다. 그래서 고칠 도구가 앞에 오고
   * 그 고친 이름(`a_b_4m7u2a`)을 제 이름으로 쓰는 도구가 뒤에 오면, 둘이 같은
   * 이름으로 나갔다. 이름이 겹친 목록은 창구가 통째로 거절하거나, 되돌림이 모델이
   * 부른 것을 엉뚱한 도구로 돌려준다. 그대로 나갈 이름은 차례와 상관없이 처음부터
   * 비워 둔다 — 고친 쪽이 뒤에 번호를 달고 비킨다(이름다듬기).
   */
  const 그대로나갈것 = new Set(tools.map((t) => String((t?.function ?? t)?.name ?? '')).filter((n) => 이름규칙.test(n)));
  const 못쓸것 = { has: (n) => 쓴것.has(n) || 그대로나갈것.has(n) };
  let 이름손봄 = 0;
  let 스키마손봄 = 0;

  const 새목록 = tools.map((t) => {
    const f = t?.function ?? t;
    const 원래이름 = String(f?.name ?? '');
    let 이름 = 원래이름;
    if (!이름규칙.test(이름)) {
      이름 = 이름다듬기(원래이름, 못쓸것);
      되돌림.set(이름, 원래이름);
      이름손봄++;
    }
    쓴것.add(이름);

    const 원래인자 = f?.parameters ?? f?.input_schema ?? null;
    let 인자 = 원래인자;
    /*
     * 인자 칸이 **원래 없던** 도구는 손대지 않는다.
     *
     * 아래 「원래 없던 인자 칸을 만들어 두지 않는다」 는 약속을 `객체로(null)`
     * 이 어기고 있었다 — 빈 객체를 지어 놓으니, 인자를 아예 안 받는 MCP 도구가
     * 「인자 없는 객체를 받는 도구」 로 바뀌어 나갔고 스키마손봄 도 1 로 세어졌다.
     * 깎을 것이 없던 자리인데 깎았다고 적은 숫자다.
     */
    if (인자 != null) {
      let 다듬은것 = null;
      if (v === 'gemini') 다듬은것 = 객체로(제미니스키마(인자));
      // 이 둘은 「인자는 객체」 를 규격으로 못 박는다. 나머지 열쇠는 안 건드린다 —
      // 확인 못 한 것을 깎으면, 멀쩡히 쓰던 MCP 도구의 뜻이 조용히 얕아진다.
      else if (v === 'anthropic' || v === 'bedrock') 다듬은것 = 객체로(인자);
      /*
       * 값이 같으면 **원래 객체를 그대로 둔다.**
       *
       * 아래 「안 바뀌었으면 그대로 돌려준다」 가 참조 동일성이라, 제미니 갈래
       * 처럼 값이 같아도 새 객체를 지으면 요청마다 도구 목록 전체가 통째로
       * 복제된다. 값은 같으니 어느 검사도 안 울리고, 스키마손봄 만 0 으로 남는다.
       */
      if (다듬은것 !== null && JSON.stringify(다듬은것) !== JSON.stringify(인자)) {
        스키마손봄++;
        인자 = 다듬은것;
      }
    }

    if (이름 === 원래이름 && 인자 === 원래인자) return t;
    // 원래 없던 인자 칸을 만들어 두지 않는다. 이름만 고친 도구에 빈 칸이
    // 새로 생기면, 그 자리가 무엇이었는지 밖에서 알 길이 없어진다.
    const 새함수 = { ...f, name: 이름 };
    if (인자 != null) 새함수.parameters = 인자;
    return { ...t, function: 새함수 };
  });

  return {
    tools: 새목록,
    되돌림: 되돌림.size ? 되돌림 : null,
    손본것: { 이름: 이름손봄, 스키마: 스키마손봄 },
  };
}

/**
 * 답에 실린 도구 이름을 원래 것으로 되돌린다.
 *
 * 안 바꾼 이름은 표에 없다 — 그때는 그대로 둔다. 표에 없다고 지우거나
 * 비우면, 다듬을 일이 없던 도구까지 못 부르게 된다.
 */
export function 이름되돌리기(message, 되돌림) {
  if (!되돌림 || !message?.toolCalls?.length) return message;
  let 바꾼적있나 = false;
  const 새것 = message.toolCalls.map((tc) => {
    const 이름 = tc?.function?.name ?? tc?.name;
    const 원래 = 되돌림.get(String(이름 ?? ''));
    if (원래 === undefined) return tc;
    바꾼적있나 = true;
    return tc.function
      ? { ...tc, function: { ...tc.function, name: 원래 } }
      : { ...tc, name: 원래 };
  });
  return 바꾼적있나 ? { ...message, toolCalls: 새것 } : message;
}
