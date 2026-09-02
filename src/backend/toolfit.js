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
 * @returns {'anthropic'|'gemini'|'bedrock'|'openai'|null}  모르면 null —
 *   그때는 **아무것도 안 건드린다**.
 */
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
    if (호스트 === 'api.openai.com' || 호스트.endsWith('.openai.azure.com')) return 'openai';
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
  if (새것 !== 원본) 새것 = `${새것.replace(/_+$/, '')}_${지문(원본)}`;
  if (!새것 || !/[a-zA-Z0-9]/.test(새것)) 새것 = `tool_${지문(원본)}`;
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
function 제미니스키마(값) {
  if (Array.isArray(값)) return 값.map(제미니스키마);
  if (!값 || typeof 값 !== 'object') return 값;

  const 새것 = {};
  for (const [k, v] of Object.entries(값)) {
    if (!제미니열쇠.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      const 속성 = {};
      for (const [n, s] of Object.entries(v)) 속성[n] = 제미니스키마(s);
      새것.properties = 속성;
      continue;
    }
    if (k === 'items' || k === 'anyOf') { 새것[k] = 제미니스키마(v); continue; }
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
    새것.type = 진짜[0] ?? 'string';
  }

  if (새것.format !== undefined) {
    const 받는것 = 제미니format[String(새것.type)];
    if (!받는것 || !받는것.has(String(새것.format))) delete 새것.format;
  }

  if (새것.type === undefined) {
    if (새것.properties) 새것.type = 'object';
    else if (새것.items) 새것.type = 'array';
    else if (새것.anyOf) { /* anyOf 는 갈래를 안 적어도 된다 */ }
    else 새것.type = 'string';
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
  let 이름손봄 = 0;
  let 스키마손봄 = 0;

  const 새목록 = tools.map((t) => {
    const f = t?.function ?? t;
    const 원래이름 = String(f?.name ?? '');
    let 이름 = 원래이름;
    if (!이름규칙.test(이름)) {
      이름 = 이름다듬기(원래이름, 쓴것);
      되돌림.set(이름, 원래이름);
      이름손봄++;
    }
    쓴것.add(이름);

    let 인자 = f?.parameters ?? f?.input_schema ?? null;
    if (v === 'gemini') {
      const 다듬은것 = 객체로(제미니스키마(인자));
      if (JSON.stringify(다듬은것) !== JSON.stringify(인자)) 스키마손봄++;
      인자 = 다듬은것;
    } else if (v === 'anthropic' || v === 'bedrock') {
      // 이 둘은 「인자는 객체」 를 규격으로 못 박는다. 나머지 열쇠는 안 건드린다 —
      // 확인 못 한 것을 깎으면, 멀쩡히 쓰던 MCP 도구의 뜻이 조용히 얕아진다.
      const 다듬은것 = 객체로(인자);
      if (다듬은것 !== 인자) 스키마손봄++;
      인자 = 다듬은것;
    }

    if (이름 === 원래이름 && 인자 === (f?.parameters ?? f?.input_schema ?? null)) return t;
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
