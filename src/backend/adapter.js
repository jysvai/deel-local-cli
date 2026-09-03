// 규격 차이(OpenAI 호환 / Ollama / Anthropic)를 여기 한 곳에서만 흡수한다.
// 진단(probe)과 에이전트 루프가 같은 함수를 쓴다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { req, headersFor, serverMessage, Aborted } from './http.js';
import { 할당량기억, 미리기다릴까 } from './quota.js';
import { 열쇠 as 열쇠받아오기, 쓸수있나 } from '../safety/authcmd.js';
import { 말 } from '../i18n/index.js';
import { 다시부를지, 기다리기, 정책고르기 } from './retry.js';
import { 도구맞추기, 이름되돌리기, 벤더 } from './toolfit.js';
import { 눈금맞추기 } from './wire.js';
import { 시스템블록, 메시지표식, 잡힐만한가, 조각표 } from './cachemark.js';

/*
 * Anthropic 규격의 판 이름.
 *
 * 이 머리 하나가 없으면 400 이다. 열쇠가 멀쩡해도 그렇다. 날짜처럼 생겼지만
 * 「오늘 날짜」 가 아니라 **규격 판 이름**이라, 새 날짜를 넣는다고 새 기능이
 * 켜지지 않는다. 회사가 새 판을 내놓기 전에는 이 값이 바뀔 일이 없다.
 */
export const ANTHROPIC_VERSION = '2023-06-01';

export function endpoint(shape) {
  if (shape === 'ollama') return '/api/chat';
  if (shape === 'anthropic') return '/messages';
  return '/chat/completions';
}

/** 이 규격이 더 요구하는 머리. 없으면 빈 것. */
export function 더할머리(shape) {
  return shape === 'anthropic' ? { 'anthropic-version': ANTHROPIC_VERSION } : {};
}

/**
 * 이 규격을 사람에게 뭐라고 부를까.
 *
 * 한 곳에 모아 둔다. 화면 여러 자리가 각자 `kind === 'ollama' ? … : 'OpenAI
 * 호환'` 로 갈라 놓고 있었는데, 규격이 셋이 되는 순간 그 자리들이 전부
 * Anthropic 연결을 **「OpenAI 호환」 이라고 잘못 적는다.** 붙는 데는 아무
 * 지장이 없어서 아무도 안 고치고, 그 화면을 믿고 남에게 설명하게 된다.
 */
export function 규격이름(shape) {
  if (shape === 'ollama') return 말('head.spec.ollama');
  if (shape === 'anthropic') return 말('head.spec.anthropic');
  return 말('head.spec.openai');
}

/**
 * 실제로 두드릴 주소. 물음표 뒤는 **끝에 그대로 남긴다.**
 *
 * Azure 주소에는 `?api-version=2024-10-21` 이 붙어 있고, 그게 없으면 400 이다.
 * 예전처럼 `base + '/chat/completions'` 로 이으면
 * `.../deployments/gpt-4o?api-version=2024-10-21/chat/completions` 가 되어
 * 경로도 판도 다 망가진다. 물음표가 없는 보통 주소는 하던 그대로다.
 */
export function 주소붙이기(base, 길) {
  const b2 = String(base ?? '');
  const i = b2.indexOf('?');
  if (i < 0) return b2 + 길;
  return b2.slice(0, i).replace(/\/+$/, '') + 길 + b2.slice(i);
}

export function 요청주소(conn) {
  return 주소붙이기(conn?.base, endpoint(conn?.kind));
}

export function buildBody(shape, { model, messages, tools, stream, json, think, maxTokens = 4096, ctx = null, 회사 = null, 카드 = null, 세션이름 = null }) {
  if (shape === 'ollama') {
    const body = { model, messages, stream: !!stream, options: { num_predict: maxTokens } };
    /*
     * 원하는 컨텍스트를 **지시한다.** 읽기만 하는 게 아니라 정해 준다.
     *
     * Ollama 는 num_ctx 를 안 보내면 제 기본값(대개 4,096 또는 8,192)으로 올린다.
     * 모델이 131,072 까지 되더라도 그렇다. 그런데 /api/show 는 131,072 라고 답한다 —
     * 그 말을 믿고 긴 대화를 보내면 앞부분이 조용히 잘려 나간다. 오류도 안 난다.
     * 모델이 앞을 잊을 뿐이라, 왜 이상한지 알아낼 방법이 없다.
     *
     * 지금까지 이 값을 **한 번도 안 보냈다.** 보내면 그 길이로 올려 준다.
     */
    if (ctx) body.options.num_ctx = ctx;
    /*
     * 모델을 내리지 말라고 말해 둔다.
     *
     * Ollama 는 5분 동안 조용하면 모델을 내린다. 다음 말을 걸면 다시 올리고
     * **대화 전체를 다시 계산한다** — 프리픽스 캐시가 통째로 사라진 것과 같다.
     * 로컬 대화는 사람이 생각하고 다른 창을 보다 돌아오는 것이라, 5분 넘게
     * 조용한 것이 오히려 보통이다. 그 복귀 첫 마디가 제일 오래 걸리는 이유가
     * 바로 이것이었다.
     *
     * -1(영원히)은 안 쓴다. 모델을 갈아탄 뒤에도 이전 모델이 램을 물고 있게
     * 되는데, 8GB 램에서는 다음 모델이 못 올라온다는 뜻이다. 한 시간이면
     * 일하는 호흡은 다 덮고, 퇴근하면 놓아 준다. DEEL_KEEP_ALIVE 로 바꾼다.
     */
    body.keep_alive = process.env.DEEL_KEEP_ALIVE || '60m';
    if (tools?.length) body.tools = tools;
    if (json) body.format = json;
    // 참·거짓은 그대로(생각을 켜고 끄는 말이다). 단계말은 이 규격이 아는
    // 말로 옮긴다 — 아래 강도말() 머리말 참고.
    if (typeof think === 'boolean') body.think = think;
    else if (think !== undefined) {
      const 눈금 = 강도말(think);
      if (눈금) body.think = 눈금;
    }
    return body;
  }
  if (shape === 'anthropic') return anthropic몸(
    { model, messages, tools, stream, json, think, maxTokens, 카드, 세션이름 },
  );
  // 출력 상한을 **두 이름으로 같이** 보낸다.
  //
  // 옛 규격은 max_tokens 하나였다. 그런데 GPT-5 계열을 붙여 놓은 게이트웨이는
  // 그 이름을 아예 안 본다 — max_completion_tokens 만 본다. 그런 서버에
  // max_tokens 만 보내면 상한이 안 걸린 것처럼 제 기본값으로 답하고, 우리가
  // 셈해 둔 자리와 어긋난다. 사용자 게이트웨이가 바로 그 경우였다.
  //
  // 둘 다 보내도 탈이 없다 — **한 곳만 빼고.** 옛 서버는 모르는 이름을 무시하고,
  // 새 서버는 제가 보는 이름을 골라 쓴다. 둘 중 무엇을 보는지 우리가 알 필요가
  // 없어진다.
  //
  // ── 그 한 곳: OpenAI 직통 ──────────────────────────────────────────────
  //
  // 여기 추론 모델(o 계열·GPT-5 계열)은 옛 이름을 **무시하지 않고 튕긴다** —
  // "Unsupported parameter: 'max_tokens' is not supported with this model."
  // 그러면 첫 요청부터 400 이고, 화면에서는 열쇠가 틀린 것과 구별이 안 된다.
  // 모델 이름으로 가르지 않는다(게이트웨이 뒤에 무엇이 있는지 우리는 모른다).
  // **주소로** 가른다 — 그 규칙은 toolfit.js 의 벤더() 한 곳에서만 정한다.
  //
  // Azure 는 여기 안 넣는다. 옛 판(api-version)이 아직 많고 그쪽은 옛 이름만
  // 본다 — 같이 묶으면 멀쩡히 쓰던 사내 Azure 연결이 이 줄 하나로 끊긴다.
  const 옛이름도 = 회사 !== 'openai';
  const body = { model, messages, stream: !!stream, max_completion_tokens: maxTokens };
  if (옛이름도) body.max_tokens = maxTokens;
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }
  if (json) {
    body.response_format = { type: 'json_schema', json_schema: { name: 'out', schema: json, strict: true } };
  }
  if (think !== undefined && think !== false) {
    /*
     * 눈금은 **이 전선이 받는 말**로 옮긴다 (backend/wire.js).
     *
     * 여태 여기는 max 를 high 로 뭉갰다. 우리 눈금이 다섯인데 받는 곳이 넷뿐인
     * 자리가 있어서였다. 그런데 그러면 Claude 처럼 xhigh·max 를 진짜로 받는
     * 전선에서도 high 밖에 못 나간다 — 화면에는 max 라고 떠 있는 채로.
     * 카드가 있으면 카드가 아는 눈금으로, 없으면 여태처럼 좁은 쪽으로 맞춘다.
     */
    const 눈금 = 카드 ? (카드.생각형식 === 'effort' ? 눈금맞추기(카드, think) : null) : 강도말(think);
    if (눈금) body.reasoning_effort = 눈금;
  }
  /*
   * 이 대화가 한 덩어리라고 알려 준다.
   *
   * 안 보내면 게이트웨이는 요청마다 새 세션을 연다 — 대시보드에 한 대화가
   * 열 줄로 흩어지고, 세션에 묶어 두는 캐시가 있다면 그것도 매번 새로 엮인다.
   * 아는 칸에만 싣고, 서버가 거절하면 카드가 그것을 배워 다음부터 안 싣는다.
   */
  if (세션이름 && 카드?.세션자리 === 'user') body.user = 세션이름;
  if (세션이름 && 카드?.캐시 === 'key') body.prompt_cache_key = 세션이름;
  /*
   * 흘려받을 때도 usage 를 달라고 한다.
   *
   * 이 칸이 없으면 흘려받기에서는 usage 가 **아예 안 온다.** 그러면 캐시가
   * 얼마나 맞았는지도, 우리 추정이 얼마나 틀렸는지도(session.배운다) 영영
   * 못 배운다. 아는 창구에만 보낸다 — 모르는 게이트웨이에 지어낸 칸을
   * 실어 보내면 그 400 이 열쇠 문제처럼 보인다.
   */
  if (stream && 카드?.스트림usage) body.stream_options = { include_usage: true };
  return body;
}

/*
 * ── Anthropic 규격은 어디가 다른가 ─────────────────────────────────────
 *
 * OpenAI 호환 서버는 문 이름(/chat/completions)만 같으면 대충 통했다. 이쪽은
 * 통하지 않는 자리가 넷이다. 그래서 여기 한 곳에 몰아 둔다.
 *
 *   1. 시킴말(system)이 messages 안에 못 들어간다. 몸의 딴 칸이다.
 *   2. 차례가 사람·모델로 **번갈아** 와야 한다. 도구를 한 턴에 둘 부르면
 *      결과가 둘인데, 그대로 보내면 거절당한다.
 *   3. 도구 모양이 { name, description, input_schema } 다.
 *      OpenAI 의 { type:'function', function:{...} } 가 아니다.
 *   4. 답이 글 한 덩어리가 아니라 **블록 배열**이다.
 *
 * 안 보내는 것도 적어 둔다. 확인 못 한 것은 안 보낸다는 뜻이지, 없다는 뜻이
 * 아니다 — 짐작으로 보낸 칸 하나가 400 을 만들면 열쇠가 틀린 줄 알게 된다.
 *
 *   · think — 생각 칸의 값 모양을 문서에서 확인하지 못했다.
 *   · json  — 이 규격에는 답 모양을 강제하는 칸이 없다. 도구로 하는 방법뿐이다.
 */
/*
 * ── 이 규격의 추론 강도 ────────────────────────────────────────────────
 *
 * OpenAI 호환 쪽은 `reasoning_effort: 'high'` 처럼 **말**로 준다. 이쪽은
 * **토큰 수**로 준다 — `thinking: { type:'enabled', budget_tokens: 12000 }`.
 * 그래서 우리 단계말(low·medium·high·max)을 숫자로 옮겨야 한다.
 *
 * 여태 이 자리가 비어 있었다. anthropic몸() 이 think 를 인자로 받아 놓고 한
 * 번도 안 썼다. 그래서 Claude 를 직접 붙이면 상태줄에는 `◇ medium` 이 뜨는데
 * 요청에는 아무것도 안 실렸다 — **화면과 전선이 다른 말을 하고 있었다.**
 * 아무 일도 안 하는 것보다 나쁘다. 사람은 조절했다고 믿기 때문이다.
 *
 * 지키는 선 둘(둘 다 서버가 거절하는 자리다):
 *   · 최소 1,024. 그보다 작게 주면 요청이 통째로 튕긴다.
 *   · max_tokens 보다 작아야 한다. 생각도 그 예산에서 나가기 때문이다.
 *     그래서 답이 설 자리를 남겨 두고 깎는다. 그러고도 1,024 가 안 되면
 *     생각을 아예 안 켠다 — 켤 수 없는 자리에서 켜면 그 턴이 죽는다.
 */
const 생각최소 = 1024;
const 답에남길것 = 1024;
const 강도별예산 = { low: 2048, medium: 6144, high: 16384, xhigh: 24576, max: 32768 };

/*
 * ── 우리 눈금은 다섯, 전선 위의 눈금은 넷 ──────────────────────────────
 *
 * agent/effort.js 의 눈금은 off·low·medium·high·**max** 다. 그런데 `max` 를
 * 받는 창구는 하나도 없다 — OpenAI 는 minimal·low·medium·high, Gemini 의
 * OpenAI 호환 창구는 none·low·medium·high, Ollama 는 참·거짓이거나
 * low·medium·high 다. 그 말을 그대로 실어 보내면 400 이고, 그 400 은 화면에서
 * 열쇠가 틀린 것과 구별이 안 된다.
 *
 * 여태 그대로 흘려보내고 있었다. 그리고 이 자리는 `/think max` 를 친
 * 사람만 밟는 것이 아니다 — `깊게` 배분은 첫 판단과 막혔을 때를 한 칸씩
 * 올리므로, `/think high` 만 해도 그 두 자리가 `max` 가 된다. 즉 **가장
 * 세게 생각하라고 시킨 턴만 골라서 죽는다.**
 *
 * 그래서 여기서 전선이 아는 말로 옮긴다. `max` 는 그 규격이 낼 수 있는 제일
 * 센 말(high)이 된다 — 없는 칸을 지어내지 않고, 있는 칸 중 가장 위에 선다.
 *
 * Anthropic 규격은 여기 안 온다. 거기는 말이 아니라 **숫자 예산**으로 주므로
 * (아래 생각예산) `max` 가 32,768 이라는 진짜 값이 된다. 눈금이 모자라지 않는다.
 *
 * 모르는 말은 **안 보낸다.** 짐작으로 실은 칸 하나가 그 턴을 죽인다.
 *
 * 받은 값을 담는 자리를 `말` 이라고 부르지 않는다. 이 파일에서 `말` 은
 * i18n 의 그 함수라, 같은 이름으로 가리면 그 블록 안에서는 화면에 말을 걸
 * 수가 없어진다 — 나중에 한 줄 더 적으려는 사람이 거기서 넘어진다.
 */
const 전선눈금 = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' };

export function 강도말(강도) {
  return 전선눈금[String(강도)] ?? null;
}

export function 생각예산(강도, maxTokens) {
  const 바라는것 = 강도별예산[String(강도)];
  if (!바라는것) return 0;
  const 쓸수있는 = Math.floor(Number(maxTokens) || 0) - 답에남길것;
  const 예산 = Math.min(바라는것, 쓸수있는);
  return 예산 >= 생각최소 ? 예산 : 0;
}

function anthropic몸({ model, messages, tools, stream, json, think, maxTokens, 카드 = null, 세션이름 = null }) {
  const 머리말 = [];
  // 시스템 글을 「굳은 부분 / 매 턴 바뀌는 부분」 으로 나눠 받았으면 그대로 쓴다.
  // 나눠 받은 조각은 이어 붙이면 원래 글과 **한 글자도 안 다르다**(agent/session.js).
  let 조각들 = null;
  const 나머지 = [];
  for (const m of messages ?? []) {
    if (m?.role === 'system') {
      const 나눔 = m[조각표];
      if (Array.isArray(나눔) && 나눔.length > 1) 조각들 = 나눔;
      머리말.push(typeof m.content === 'string' ? m.content : String(m.content ?? ''));
    } else 나머지.push(m);
  }

  const 표식쓰나 = 카드?.캐시 === 'explicit';
  let 대화 = 차례합치기(나머지);
  /*
   * 자라는 대화에 옮겨 가는 표식을 박는다 (backend/cachemark.js).
   *
   * 이것이 없으면 캐시는 정적 앞머리에서 멈춘다 — 대화가 60k 로 자라도
   * 읽히는 것은 5.9k 뿐이고, 나머지는 걸음마다 전액 다시 나간다.
   */
  if (표식쓰나 && 잡힐만한가(대화, 카드?.캐시최소 ?? 1024)) 대화 = 메시지표식(대화);

  const body = { model, messages: 대화, stream: !!stream, max_tokens: maxTokens };
  if (머리말.length) {
    body.system = 표식쓰나
      ? 시스템블록(조각들 ?? 머리말, true)
      : 머리말.join('\n\n');
  }

  /*
   * ── 생각을 어떻게 켜나 ────────────────────────────────────────────────
   *
   * 판마다 다르다. 4.6 판부터는 `adaptive` 하나로 켜고 세기는 output_config
   * 로 준다. 그 전 판은 토큰 예산(budget_tokens)이다. **섞으면 400 이다** —
   * Opus 5 에 budget_tokens 를 보내면 거절당하고, 그 400 은 화면에서 열쇠가
   * 틀린 것과 구별이 안 된다. 어느 쪽인지는 카드가 안다(backend/wire.js).
   *
   * 카드가 없으면 여태 하던 대로 예산으로 간다 — 이 파일을 직접 부르는
   * 자리(검사·진단)가 있어서, 없다고 모양이 달라지면 안 된다.
   */
  const 형식 = 카드?.생각형식 ?? 'budget';
  if (형식 === 'adaptive') {
    if (think !== undefined && think !== false && think !== 'off') {
      body.thinking = { type: 'adaptive' };
      const 눈금 = 눈금맞추기(카드, think);
      if (눈금 && 카드?.효력칸 === 'output_config') body.output_config = { effort: 눈금 };
    }
  } else if (형식 === 'budget' || 형식 === undefined) {
    const 예산 = 생각예산(think, maxTokens);
    if (예산) body.thinking = { type: 'enabled', budget_tokens: 예산 };
  }

  // 이 대화가 한 덩어리라고 알려 준다. 규격이 정한 칸이다.
  if (세션이름 && 카드?.세션자리 === 'metadata') body.metadata = { user_id: 세션이름 };

  if (tools?.length) {
    body.tools = tools.map((t) => {
      const f = t.function ?? t;
      return {
        name: f.name,
        description: f.description ?? '',
        input_schema: f.parameters ?? f.input_schema ?? { type: 'object', properties: {} },
      };
    });
    body.tool_choice = { type: 'auto' };
  }
  return body;
}

/**
 * 같은 차례가 연달아 오면 하나로 합친다.
 *
 * 도구를 한 턴에 둘 부르면 결과 메시지가 둘이고, 이 규격에서 그 둘은 다
 * 사람 차례다. 번갈아 오지 않으면 서버가 통째로 거절한다 — 그러면 도구를
 * 하나만 부를 때는 되고 둘 부를 때만 안 되는, 제일 알아내기 어려운 고장이 된다.
 */
export function 차례합치기(messages) {
  const 덩이 = (c) => (Array.isArray(c) ? c : [{ type: 'text', text: String(c ?? '') }]);
  const out = [];
  for (const m of messages ?? []) {
    const 앞 = out[out.length - 1];
    if (앞 && 앞.role === m?.role) {
      앞.content = [...덩이(앞.content), ...덩이(m.content)];
      continue;
    }
    out.push({ ...m });
  }
  return out;
}

/*
 * ── 캐시가 얼마나 맞았나 ────────────────────────────────────────────────
 *
 * 여태 이 프로그램은 **캐시에 눈이 없었다.** usage 에서 들어온 토큰과 나간
 * 토큰만 읽었다. 그래서 캐시가 통째로 안 맞고 있어도 화면에는 아무 표시가
 * 없었고, 고쳐도 나아졌는지 스스로 확인할 방법이 없었다.
 *
 * 이름이 규격마다 다르다. 아는 이름을 다 훑고, 없으면 0 이다 —
 * 응답에 더 있는 칸을 읽는 것은 아무 위험이 없다(보내는 것과 다르다).
 *
 *   Anthropic  cache_read_input_tokens · cache_creation_input_tokens
 *   OpenAI     prompt_tokens_details.cached_tokens
 *   Bedrock    input_tokens_details.cached_tokens · .cache_write_tokens
 *
 * @returns {{읽음:number, 씀:number}}
 */
export function 캐시읽기(u) {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
  const 자세히 = u?.prompt_tokens_details ?? u?.input_tokens_details ?? null;
  return {
    읽음: n(u?.cache_read_input_tokens) || n(자세히?.cached_tokens) || n(u?.cached_tokens),
    씀: n(u?.cache_creation_input_tokens) || n(자세히?.cache_write_tokens) || n(u?.cache_write_tokens),
  };
}

export function extractMessage(shape, json) {
  if (shape === 'anthropic') {
    // 답이 블록 배열이다. 글·생각·도구 부름이 한 배열에 섞여 온다.
    let content = '';
    let thinking = '';
    /*
     * 생각 블록은 **받은 그대로** 따로 챙긴다.
     *
     * 글자만 이어 붙이면 안 된다. 이 규격의 생각 블록에는 서명(signature)이
     * 딸려 있고, 도구를 쓰는 턴에서는 그 블록을 서명째 돌려보내야 서버가
     * 받는다. 서명 없이 지어서 보내면 그 턴이 통째로 거절된다.
     * redacted_thinking 은 속을 우리가 못 읽는 블록인데, 그것도 그대로
     * 돌려보내야 한다 — 읽지 말고 나르라는 뜻이다.
     */
    const 생각블록 = [];
    const 부름들 = [];
    for (const b of Array.isArray(json?.content) ? json.content : []) {
      if (b?.type === 'text') content += b.text ?? '';
      else if (b?.type === 'thinking') {
        thinking += b.thinking ?? '';
        생각블록.push({ type: 'thinking', thinking: b.thinking ?? '', signature: b.signature ?? '' });
      } else if (b?.type === 'redacted_thinking') 생각블록.push({ type: 'redacted_thinking', data: b.data });
      else if (b?.type === 'tool_use') 부름들.push({ id: b.id, name: b.name, args: b.input ?? {} });
    }
    return {
      content,
      thinking,
      생각블록,
      toolCalls: normalizeCalls(부름들),
      // 이름이 다르다. prompt_tokens 를 찾으면 늘 0 이 나오고, 화면에는
      // 「토큰을 하나도 안 썼다」 로 뜬다.
      usage: {
        in: json?.usage?.input_tokens ?? 0,
        out: json?.usage?.output_tokens ?? 0,
        ...(() => { const c = 캐시읽기(json?.usage); return { cacheRead: c.읽음, cacheWrite: c.씀 }; })(),
      },
      stopped: json?.stop_reason ?? null,
      // 안전 판정으로 거절당한 것. 빈 답과 섞으면 엉뚱한 곳을 고치게 된다.
      거절: json?.stop_reason === 'refusal' ? (json?.stop_details ?? { type: 'refusal' }) : null,
    };
  }
  if (shape === 'ollama') {
    const m = json?.message ?? {};
    return {
      content: m.content ?? '',
      thinking: m.thinking ?? '',
      toolCalls: normalizeCalls(m.tool_calls ?? []),
      usage: { in: json?.prompt_eval_count ?? 0, out: json?.eval_count ?? 0 },
      stopped: json?.done_reason ?? null,
    };
  }
  const m = json?.choices?.[0]?.message ?? {};
  // 생각에 쓴 토큰. 이것도 출력 예산에서 나간다 — 상한이 8,000인데 생각에 6,000을
  // 쓰면 실제로 쓸 수 있는 답은 2,000뿐이다. 잘리는 이유가 여기 있을 때가 많은데,
  // 전에는 이 숫자를 읽지도 않아서 화면에도 셈에도 안 나타났다.
  const 생각 = json?.usage?.completion_tokens_details?.reasoning_tokens
    ?? json?.usage?.reasoning_tokens ?? 0;
  /*
   * ── 안 하겠다고 한 것인가 ────────────────────────────────────────────
   *
   * 이 규격은 두 가지 모양으로 말한다.
   *
   *   message.refusal              모델이 스스로 거절한 글
   *   finish_reason 'content_filter'  앞단 필터가 잘라낸 것 (Azure 가 이쪽이다)
   *
   * 둘 다 **빈 답과 겉모습이 같다.** 그래서 예전에는 「읽기만 하고 끝내려
   * 한다」 로 읽고 한 번 더 밀었다. 밀어도 판정은 같아서 또 거절이고, 그게
   * 걸음 수만큼 되풀이됐다 — 한 번 거절당할 요청이 열 번 나갔다.
   */
  const 끝난까닭 = json?.choices?.[0]?.finish_reason ?? null;
  const 거절글 = typeof m.refusal === 'string' && m.refusal.trim() ? m.refusal.trim() : null;
  const 거절 = 거절글
    ? { type: 'refusal', message: 거절글 }
    : (끝난까닭 === 'content_filter' ? { type: 'content_filter' } : null);

  return {
    // 거절 글은 답이 비어 있을 때만 답 자리에 넣는다. 사람이 화면에서
    // 무슨 일이 있었는지 읽을 수 있어야 한다.
    content: m.content ?? 거절글 ?? '',
    thinking: m.reasoning_content ?? '',
    toolCalls: normalizeCalls(m.tool_calls ?? []),
    usage: {
      in: json?.usage?.prompt_tokens ?? 0,
      out: json?.usage?.completion_tokens ?? 0,
      reasoning: 생각,
      ...(() => { const c = 캐시읽기(json?.usage); return { cacheRead: c.읽음, cacheWrite: c.씀 }; })(),
    },
    stopped: 끝난까닭,
    거절,
  };
}

/**
 * 도구 호출을 한 가지 모양으로 맞춘다: { id, name, args(객체) }
 *
 * 인자 JSON 이 안 읽히면 **읽혔다고 치지 않는다.**
 *
 * 예전에는 조용히 { _raw: '...' } 로 바꿔 넘겼다. 그러면 도구는 file_path 가
 * 없다고 "경로가 비었습니다" 라고 답한다 — 원인과 아무 상관 없는 말이다.
 * 모델은 경로를 안 빠뜨렸다. 인자를 쓰다가 출력 한도에서 잘렸을 뿐이다.
 * 그러니 고칠 게 없다고 보고 똑같이 다시 시도하고, 또 잘린다.
 *
 * 실제로 그렇게 됐다 — "Write 경로가 비었습니다" 가 아홉 번 찍히고, 71초 동안
 * 도구를 열세 번 부르고, 컨텍스트가 다 차서 대화를 접었고, 파일은 안 생겼다.
 * 조용히 삼킨 값 하나가 그 전부를 만들었다.
 */
export function normalizeCalls(list) {
  return list.map((tc, i) => {
    const fn = tc.function ?? tc;
    let args = fn.arguments ?? fn.args ?? {};
    let 깨짐 = false;
    let 원문 = null;
    if (typeof args === 'string') {
      const s = args.trim();
      // 인자가 아예 없는 도구도 있다. 빈 것은 깨진 것이 아니다.
      if (!s) args = {};
      else {
        try { args = JSON.parse(s); }
        catch { 깨짐 = true; 원문 = args; args = {}; }
      }
    }
    const call = { id: tc.id ?? `call_${i + 1}`, name: fn.name, args };
    if (깨짐) { call.argsBroken = true; call.rawArgs = 원문; }
    return call;
  });
}

// 대화 이력에 되돌려 넣을 메시지 만들기 — 규격마다 모양이 다르다.
export function assistantMessage(shape, { content = '', thinking = '', toolCalls = [], 생각블록 = null }) {
  if (shape === 'anthropic') {
    /*
     * ── 생각 블록을 **맨 앞에, 받은 그대로** 돌려보낸다 ──────────────────
     *
     * 여기는 오래 비어 있던 자리다. 예전 주석은 「서명 조각을 제대로 모으는
     * 것까지 확인하지 못했으므로 뺀다」 였다. 이제 모은다(흘려받기의
     * signature_delta). 그래서 실을 수 있다.
     *
     * 왜 실어야 하나 — 생각을 켜고 도구를 쓰면, 서버는 그 도구 부름을 낳은
     * 생각 블록이 **같이 돌아오기를** 요구한다. 안 보내면 그 턴이 거절된다.
     * 즉 생각을 켜는 것과 이 블록을 나르는 것은 한 몸이다.
     *
     * 서명은 우리가 읽거나 고칠 것이 아니다. 받은 문자열 그대로 나른다.
     * 서명이 빈 블록은 아예 안 싣는다 — 지어낸 서명은 거절당하고, 그러면
     * 왜 안 되는지가 화면에서 안 보인다.
     */
    const 블록 = [];
    for (const b of 생각블록 ?? []) {
      if (b?.type === 'thinking' && b.signature) {
        블록.push({ type: 'thinking', thinking: b.thinking ?? '', signature: b.signature });
      } else if (b?.type === 'redacted_thinking' && b.data) {
        블록.push({ type: 'redacted_thinking', data: b.data });
      }
    }
    if (content) 블록.push({ type: 'text', text: content });
    for (const t of toolCalls) 블록.push({ type: 'tool_use', id: t.id, name: t.name, input: t.args ?? {} });
    /*
     * 블록이 하나도 없으면 이 규격은 거절한다. 빈 답이 오는 일은 드물지만
     * 그때 대화 전체가 죽으면 안 되니 자리표시를 하나 넣는다.
     *
     * 생각 블록**만** 있는 경우도 여기 걸리지 않게 한다 — 생각만 하고 아무
     * 말도 안 한 턴은 실제로 있고, 그때 생각 블록은 살아 있어야 한다.
     */
    if (!블록.length) 블록.push({ type: 'text', text: '(빈 답)' });
    return { role: 'assistant', content: 블록 };
  }
  if (shape === 'ollama') {
    const m = { role: 'assistant', content };
    if (thinking) m.thinking = thinking;
    if (toolCalls.length) m.tool_calls = toolCalls.map((t) => ({ function: { name: t.name, arguments: t.args } }));
    return m;
  }
  const m = { role: 'assistant', content: content || null };
  if (toolCalls.length) {
    m.tool_calls = toolCalls.map((t) => ({
      id: t.id, type: 'function',
      function: { name: t.name, arguments: JSON.stringify(t.args) },
    }));
  }
  return m;
}

export function toolMessage(shape, { callId, name, content }) {
  // 이 규격에는 도구 차례가 없다. 도구 결과도 **사람 차례**로 돌려준다.
  // role:'tool' 로 보내면 「모르는 역할」 이라고 거절당한다.
  if (shape === 'anthropic') {
    return { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content: String(content) }] };
  }
  return shape === 'ollama'
    ? { role: 'tool', tool_name: name, content: String(content) }
    : { role: 'tool', tool_call_id: callId, content: String(content) };
}

/*
 * 이번 요청에 실을 머리말.
 *
 * 열쇠받기가 걸려 있으면 여기서 받아 온다. 요청 **직전**에 받는 것이
 * 중요하다 — 판을 켤 때 한 번 받아 두면 세 시간짜리 대화의 두 시간째에
 * 죽어 있고, 그 401 은 「열쇠가 틀렸다」 와 화면에서 구별이 안 된다.
 *
 * 못 받으면 **던지지 않는다.** 원래 열쇠(있으면)로 그냥 간다. 여기서
 * 막아 버리면 열쇠받기 설정 한 줄이 잘못된 것으로 멀쩡히 붙던 연결까지
 * 안 붙는다. 못 받았다는 것은 부르는 쪽이 onAuth 로 듣고 화면에 적는다.
 */
async function 머리말짓기(conn, opts, { 다시 = false } = {}) {
  const 설정 = conn.열쇠받기 ?? null;
  const 판단 = 쓸수있나(설정, { auth: conn.auth });
  if (!설정 || !판단.된다) {
    if (설정 && 판단.왜) opts.onAuth?.({ ok: false, 왜: 판단.왜, 안부름: true });
    return headersFor(conn.auth, conn.key ?? '', 더할머리(conn.kind));
  }
  const r = await 열쇠받아오기(설정, {
    다시, signal: opts.signal ?? null,
    물어보기: opts.열쇠물어보기 ?? null,
    알림: opts.onAuth ? (것) => opts.onAuth(것) : null,
  });
  if (!r.ok) {
    opts.onAuth?.({ ...r, ok: false });
    return headersFor(conn.auth, conn.key ?? '', 더할머리(conn.kind));
  }
  if (!r.그대로) opts.onAuth?.({ ok: true, 만료: r.만료, ms: r.ms });
  return headersFor(conn.auth, r.token, { ...더할머리(conn.kind), ...r.headers });
}

/*
 * 401 을 맞았을 때 열쇠를 새로 받고 한 번만 다시 부를까.
 *
 * retry.js 는 401 을 안 다시 부른다 — 열쇠가 틀린 것은 백 번 불러도
 * 같기 때문이다. 그 말은 지금도 맞다. 다른 것은 **열쇠를 바꿀 수 있을
 * 때**뿐이다. 그때는 같은 열쇠로 다시 부르는 것이 아니라 새 열쇠로
 * 부르는 것이라, 「불러 봐야 같다」 에 해당하지 않는다.
 *
 * 한 번만이다. 두 번째 401 은 진짜로 권한이 없는 것이고, 그때 더 부르면
 * 로그인 명령만 되풀이해서 띄우게 된다.
 */
function 열쇠다시받을까(conn, status, 이미) {
  return !이미 && Number(status) === 401 && !!conn.열쇠받기;
}

/**
 * 이번에 실제로 보낼 몸통을 만든다. chat 과 chatStream 이 같은 것을 쓴다.
 *
 * 전선 카드와 세션 이름은 **연결에 붙어 있다.** 부르는 자리마다 손으로
 * 넘기게 두면 언젠가 한 곳이 빠지고, 그 한 곳만 캐시가 안 걸린다 —
 * 요약을 만드는 부름(agent/compact.js)이 딱 그런 자리다.
 */
function 몸만들기(conn, opts, 맞춘것, 더할것 = {}) {
  return buildBody(conn.kind, {
    model: conn.model,
    ctx: conn.ctx ?? null,
    ...opts,
    tools: 맞춘것.tools,
    회사: 벤더(conn),
    카드: opts.카드 ?? conn.전선 ?? null,
    세션이름: opts.세션이름 ?? conn.세션이름 ?? null,
    ...더할것,
  });
}

/*
 * ── 보낸 몸통을 파일로 떨어뜨린다 (DEEL_TRACE_BODY) ─────────────────────
 *
 * 캐시가 왜 안 맞는지는 **인접한 두 요청을 견줘야만** 알 수 있다. 자라는
 * 대화에서 두 요청은 끝부분만 달라야 정상이고, 그보다 앞에서 갈리는 자리가
 * 있으면 거기가 캐시를 깨는 자리다. 화면으로는 절대 안 보인다.
 *
 * 열쇠는 머리말에 있고 여기서는 몸통만 적으므로 열쇠가 새지 않는다. 그래도
 * 대화 내용은 그대로 적히므로 **사람이 환경변수로 켤 때만** 돈다.
 */
let 덤프번호 = 0;
function 몸덤프(body) {
  const 폴더 = process.env.DEEL_TRACE_BODY;
  if (!폴더) return;
  try {
    mkdirSync(폴더, { recursive: true });
    덤프번호 += 1;
    const 이름 = `${String(덤프번호).padStart(4, '0')}.json`;
    writeFileSync(join(폴더, 이름), JSON.stringify(body, null, 2), 'utf8');
  } catch { /* 못 적어도 요청은 간다 — 이건 곁다리다 */ }
}

/**
 * 보내기 **전에** 할당량을 보고 비킨다 (backend/quota.js).
 *
 * 서버가 「남은 것 0, 몇 초 뒤 풀림」 이라고 알려 줬는데도 그대로 보내면
 * 429 를 맞고 사다리를 태우고 턴이 죽는다. 알고 있으면 그냥 기다리면 된다.
 */
async function 미리비키기(opts) {
  const ms = 미리기다릴까();
  if (!ms) return 0;
  opts.onBackoff?.({ type: 'backoff', status: 429, code: null, wait: ms, attempt: 0, max: 0, 미리: true });
  await 기다리기(ms, opts.signal ?? null);
  return ms;
}

// 한 번에 받기.
export async function chat(conn, opts) {
  // 이 회사가 받는 모양으로 도구를 다듬는다 (backend/toolfit.js).
  // 모르는 주소면 아무것도 안 바뀐다 — 지금까지와 똑같이 돈다.
  const 맞춘것 = 도구맞추기(opts.tools, conn);
  const body = 몸만들기(conn, opts, 맞춘것);
  몸덤프(body);
  const 정책 = 정책고르기(conn, opts);
  let 열쇠다시받음 = false;
  let 쌓인대기 = await 미리비키기(opts);
  for (let 시도 = 1; ; 시도++) {
    const r = await req(요청주소(conn), {
      method: 'POST',
      headers: await 머리말짓기(conn, opts),
      body,
      timeout: opts.timeout ?? 300000,
      signal: opts.signal ?? null,
    });
    // 서버가 남았다고 말해 준 할당량을 적어 둔다 (backend/quota.js).
    // 429 를 맞고 나서야 아는 것과, 맞기 전에 아는 것은 사람이 할 일이 다르다.
    할당량기억(r.headers);
    // 다듬느라 이름을 고쳤으면 여기서 되돌린다. 밖에서는 그런 일이 있었는지
    // 모른 채로 원래 이름을 받는다.
    if (r.ok) return 이름되돌리기(extractMessage(conn.kind, r.json), 맞춘것.되돌림);
    // 열쇠가 늙어서 막힌 것이면 새로 받고 한 번만 다시. 시도 수는 안 올린다 —
    // 서버가 막은 것이 아니라 우리 열쇠가 낡았던 것이라 물러설 까닭이 없다.
    if (열쇠다시받을까(conn, r.status, 열쇠다시받음)) {
      열쇠다시받음 = true;
      await 머리말짓기(conn, opts, { 다시: true });
      시도 -= 1;
      continue;
    }
    // 잠깐 막힌 것이면 기다렸다 다시 부른다 (backend/retry.js 머리말).
    // 한 번에 받는 길은 제너레이터가 아니라 화면에 말을 못 걸어서, 부르는 쪽이
    // 준 onBackoff 로 알린다. 안 줬으면 조용히 기다린다.
    const 다시 = 다시부를지(r, 시도, 정책, 쌓인대기);
    if (!다시) throw 거절오류(r, 시도);
    opts.onBackoff?.(다시);
    쌓인대기 += 다시.wait;
    await 기다리기(다시.wait, opts.signal ?? null);
  }
}

/*
 * 서버가 한 말을 그대로 달아 둔다. 루프가 이걸 읽고 한계를 배운다(backend/learn.js).
 *
 * 다시 불렀는데도 계속 막힌 것이면 **몇 번 불렀는지**도 적는다. `HTTP 429` 한 줄로는
 * 한 번 막힌 것인지 계속 막히는 것인지 알 수 없고, 그 둘은 사람이 할 일이 다르다 —
 * 앞은 그냥 다시 시키면 되고, 뒤는 할당량을 봐야 한다.
 */
function 거절오류(r, 시도) {
  const 원문 = serverMessage(r);
  let 말 = 원문;
  if (시도 > 1) {
    const 무엇 = r.status ? `HTTP ${r.status}` : (r.code ?? '연결 끊김');
    말 += `\n  ${시도}번 불렀지만 계속 막혔습니다 (${무엇}) — 잠시 뒤 다시 시키세요`;
  }
  const err = new Error(말);
  err.status = r.status;
  err.serverMessage = 원문;
  err.attempts = 시도;
  return err;
}

/*
 * 흘려 받으려다 거절당한 응답을, 한 번에 받은 것과 같은 모양으로 바꾼다.
 *
 * 거절당했으면 **본문을 읽는다.** 전에는 여기서 `HTTP 400` 만 던졌다. 스트리밍이라
 * 본문을 안 읽고 넘어간 것인데, 정작 그 본문에 답이 들어 있다 —
 *   "This model's maximum context length is 8192 tokens, however you requested 41003"
 * 사용자를 구할 수 있었던 문장이 그 자리에서 사라졌다. 화면에는 ✗ HTTP 400 한 줄만
 * 남고, 왜 그런지 알아낼 방법이 없었다.
 *
 * 실패한 응답은 흘려 받을 것도 없으니 통째로 읽어도 된다. 그리고 다시 부르기 전에
 * 반드시 읽어야 한다 — 안 읽은 몸을 두고 다음 요청을 보내면 연결이 남는다.
 */
async function 거절읽기(r) {
  const 것 = {
    ok: false, status: r.status, error: r.error ?? null, code: r.code ?? null,
    json: null, text: '', ms: r.ms, headers: r.res?.headers ?? null,
  };
  if (r.res) {
    try {
      것.text = await r.res.text();
      try { 것.json = JSON.parse(것.text); } catch { /* 글로만 오는 서버도 있다 */ }
    } catch { /* 본문마저 못 읽으면 상태 코드만으로 간다 */ }
  }
  return 것;
}

// 흘려 받기. { type:'thinking'|'content', text } 를 내보내고 마지막에 { type:'done', message } 를 준다.
export async function* chatStream(conn, opts) {
  const 맞춘것 = 도구맞추기(opts.tools, conn);
  const body = 몸만들기(conn, opts, 맞춘것, { stream: true });
  몸덤프(body);
  const 정책 = 정책고르기(conn, opts);
  let r;
  let 열쇠다시받음 = false;
  let 쌓인대기 = 0;
  {
    const 미리 = 미리기다릴까();
    if (미리) {
      yield { type: 'backoff', status: 429, code: null, wait: 미리, attempt: 0, max: 0, 미리: true };
      await 기다리기(미리, opts.signal ?? null);
      쌓인대기 += 미리;
    }
  }
  for (let 시도 = 1; ; 시도++) {
    r = await req(요청주소(conn), {
      method: 'POST',
      headers: await 머리말짓기(conn, opts),
      body,
      timeout: opts.timeout ?? 300000,
      stream: true,
      signal: opts.signal ?? null,
    });
    할당량기억(r.headers ?? r.res?.headers);
    if (r.ok && r.res?.body) break;
    const 거절 = await 거절읽기(r);
    // 위 chat() 과 같은 규칙. 몸을 먼저 읽고(거절읽기) 나서 다시 부른다 —
    // 안 읽은 몸을 두고 다음 요청을 보내면 연결이 남는다.
    if (열쇠다시받을까(conn, 거절.status, 열쇠다시받음)) {
      열쇠다시받음 = true;
      await 머리말짓기(conn, opts, { 다시: true });
      시도 -= 1;
      continue;
    }
    // 잠깐 막힌 것이면 알리고, 기다렸다, 다시 부른다. 머리말도 못 받은 자리라
    // 화면에 흘러간 글이 없다 — 그래서 여기서만 다시 부르고, 아래 읽기 도중에
    // 끊긴 것은 다시 안 부른다 (backend/retry.js 머리말).
    const 다시 = 다시부를지(거절, 시도, 정책, 쌓인대기);
    if (!다시) throw 거절오류(거절, 시도);
    yield 다시;
    쌓인대기 += 다시.wait;
    await 기다리기(다시.wait, opts.signal ?? null);
  }

  const acc = {
    content: '', thinking: '', toolCalls: [],
    usage: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
    stopped: null,
  };
  const reader = r.res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    // 사용자가 끊었으면 흘러오는 것을 더 받지 않는다. 읽던 연결도 닫는다.
    if (opts.signal?.aborted) {
      try { await reader.cancel(); } catch {}
      throw new Aborted();
    }
    let done;
    let value;
    try { ({ done, value } = await reader.read()); }
    catch (err) { if (opts.signal?.aborted) throw new Aborted(); throw err; }
    if (done) break;
    buf += dec.decode(value, { stream: true });

    // OpenAI 는 SSE(data: ...), Ollama 는 줄바꿈 JSON. 둘 다 줄 단위로 처리된다.
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
      if (payload === '[DONE]') continue;
      let obj;
      try { obj = JSON.parse(payload); } catch { continue; }
      for (const ev of absorb(conn.kind, obj, acc)) yield ev;
    }
  }
  /*
   * ── 끝을 안 알려 주고 끊긴 것은 '끝난 것' 이 아니다 ──────────────────────
   *
   * 규격대로면 끝을 알리는 조각이 반드시 하나 온다 —
   * OpenAI 는 finish_reason, Anthropic 은 message_delta.stop_reason,
   * Ollama 는 done:true. 그게 하나도 안 왔는데 흘러오던 것이 그냥 멎었으면
   * **왜 끝났는지 모르는 것**이다. 중계 프록시가 몸통을 자르고 연결을 곱게
   * 닫으면 이 모양이 된다(끊긴 티가 안 나서 read 가 던지지도 않는다).
   *
   * 여태 stopped 를 null 로 뒀는데, 위에서는 null 을 '정상 종료' 와 구별하지
   * 못했다. 그래서 중간에서 잘린 답이 온전한 답으로 지나갔다 — 사람 눈에는
   * 모델이 말을 하다 만 것으로 보이니 같은 것을 다시 시킨다.
   *
   * 다만 '상한에서 잘림(length)' 과 같이 취급하지는 않는다. 까닭이 다르므로
   * 상한을 올려 다시 부르는 것은 답이 아니다. 이름만 따로 붙여서, 화면이
   * 사실대로 말할 수 있게 한다. 아무것도 안 온 경우는 여기서 안 다룬다 —
   * 그건 '빈 답' 쪽이 받는다.
   */
  if (acc.stopped == null && (acc.content || acc.thinking || acc.toolCalls.length)) {
    acc.stopped = 말없이끝남;
  }
  /*
   * 거절 글밖에 안 온 경우, 그 글을 답 자리에 놓는다.
   *
   * 이 규격은 거절을 `content` 가 아니라 `refusal` 로 흘려보낸다. 그대로 두면
   * 화면에는 **아무 글도 안 나오고**, 사람은 답이 비었다고 읽고 같은 말을 또
   * 친다. 판정은 같으니 또 거절이고, 값만 두 배가 된다.
   */
  if (!acc.content && acc.거절글?.trim()) acc.content = acc.거절글.trim();
  delete acc.거절글;
  yield { type: 'done', message: 이름되돌리기(acc, 맞춘것.되돌림) };
}

/** 서버가 끝난 까닭을 안 주고 흘려보내기를 멈춘 것. 'stop' 과 구별해야 한다. */
export const 말없이끝남 = '말없이끝남';

// 조각 하나를 누적하고, 화면에 흘릴 것만 내보낸다.
function absorb(shape, obj, acc) {
  const out = [];
  if (shape === 'anthropic') return anthropic흡수(obj, acc, out);
  if (shape === 'ollama') {
    const m = obj.message ?? {};
    if (m.thinking) { acc.thinking += m.thinking; out.push({ type: 'thinking', text: m.thinking }); }
    if (m.content) { acc.content += m.content; out.push({ type: 'content', text: m.content }); }
    if (m.tool_calls?.length) acc.toolCalls.push(...normalizeCalls(m.tool_calls));
    if (obj.done) {
      acc.usage = { in: obj.prompt_eval_count ?? 0, out: obj.eval_count ?? 0 };
      acc.stopped = obj.done_reason ?? 'stop';
    }
    return out;
  }
  const d = obj.choices?.[0]?.delta ?? {};
  if (d.reasoning_content) { acc.thinking += d.reasoning_content; out.push({ type: 'thinking', text: d.reasoning_content }); }
  if (d.content) { acc.content += d.content; out.push({ type: 'content', text: d.content }); }
  if (d.tool_calls?.length) mergeDeltaCalls(acc, d.tool_calls);
  /*
   * 거절 글도 조각으로 흘러온다. 이어 붙여 둔다 — 한 조각만 보고 판단하면
   * 「Sorry」 한 마디로 끝난 답과 구별이 안 된다.
   */
  if (typeof d.refusal === 'string' && d.refusal) acc.거절글 = (acc.거절글 ?? '') + d.refusal;
  if (obj.usage) {
    const c = 캐시읽기(obj.usage);
    acc.usage = {
      in: obj.usage.prompt_tokens ?? 0,
      out: obj.usage.completion_tokens ?? 0,
      // 한 번에 받는 길과 같은 자리를 본다. 여기만 빠지면 흘려받을 때
      // 생각 토큰이 늘 0 으로 보이는데, 그건 「생각을 안 했다」 로 읽힌다.
      reasoning: obj.usage.completion_tokens_details?.reasoning_tokens
        ?? obj.usage.reasoning_tokens ?? 0,
      cacheRead: c.읽음,
      cacheWrite: c.씀,
    };
  }
  const fin = obj.choices?.[0]?.finish_reason;
  if (fin) acc.stopped = fin;
  // 흘려받는 길도 거절을 알아본다. 여기가 빠지면 흘려받기를 켠 사람에게만
  // 예전 그대로 되밀기가 남는다 — 그게 기본값이라 사실상 아무도 안 고쳐진다.
  if (acc.거절글?.trim()) acc.거절 = { type: 'refusal', message: acc.거절글.trim() };
  else if (fin === 'content_filter') acc.거절 = { type: 'content_filter' };
  return out;
}

/*
 * Anthropic 흘려받기.
 *
 * OpenAI 는 조각마다 같은 모양(choices[0].delta)이 오는데, 이쪽은 **사건 이름**
 * 으로 나뉜다. 하나씩 다르게 읽어야 한다.
 *
 *   message_start        — 시작. 여기 입력 토큰 수가 들어 있다.
 *   content_block_start  — 블록 하나 시작. 도구 부름이면 이름과 번호가 여기 있다.
 *   content_block_delta  — 알맹이 조각. 글·생각·도구 인자가 각각 딴 이름으로 온다.
 *   message_delta        — 끝난 까닭과 출력 토큰 수.
 *   message_stop         — 끝.
 *
 * 도구 인자는 글자 단위로 쪼개져 오므로 번호별로 이어 붙인다. 이 자리는
 * OpenAI 쪽과 같아서 마무리(도구마무리)를 같이 쓴다.
 */
function anthropic흡수(obj, acc, out) {
  const 종류 = obj?.type;
  const 번호 = obj?.index ?? 0;
  if (종류 === 'message_start') {
    const u = obj.message?.usage;
    if (u) {
      // 캐시 수치는 여기 한 번만 온다. message_delta 에는 안 실린다 —
      // 여기서 안 챙기면 흘려받기에서는 캐시가 영영 0 으로 보인다.
      const c = 캐시읽기(u);
      acc.usage = { in: u.input_tokens ?? 0, out: u.output_tokens ?? 0, cacheRead: c.읽음, cacheWrite: c.씀 };
    }
    return out;
  }
  if (종류 === 'content_block_start') {
    const b = obj.content_block ?? {};
    if (b.type === 'tool_use') {
      acc._raw ??= [];
      acc._raw[번호] = { id: b.id, name: b.name ?? '', args: '' };
    } else if (b.type === 'thinking') {
      /*
       * 생각 블록이 열렸다. 여기서는 속이 비어 있고(`thinking:''`,
       * `signature:''`), 글은 thinking_delta 로, 서명은 **블록이 닫히기
       * 직전** signature_delta 로 따로 온다. 그래서 자리를 먼저 잡아 두고
       * 번호로 찾아 채운다 — 한 답에 생각 블록이 여럿일 수 있다.
       */
      acc.생각블록 ??= [];
      acc.생각블록[번호] = { type: 'thinking', thinking: b.thinking ?? '', signature: b.signature ?? '' };
    } else if (b.type === 'redacted_thinking') {
      // 속을 우리가 못 읽는 블록. 읽지 말고 그대로 나르라는 뜻이다.
      acc.생각블록 ??= [];
      acc.생각블록[번호] = { type: 'redacted_thinking', data: b.data };
    }
    return out;
  }
  if (종류 === 'content_block_delta') {
    const d = obj.delta ?? {};
    if (d.type === 'text_delta' && d.text) {
      acc.content += d.text;
      out.push({ type: 'content', text: d.text });
    } else if (d.type === 'thinking_delta' && d.thinking) {
      acc.thinking += d.thinking;
      // 화면으로 흘려보내는 것과 별개로, 돌려보낼 블록에도 그대로 쌓는다.
      acc.생각블록 ??= [];
      acc.생각블록[번호] ??= { type: 'thinking', thinking: '', signature: '' };
      acc.생각블록[번호].thinking += d.thinking;
      out.push({ type: 'thinking', text: d.thinking });
    } else if (d.type === 'signature_delta' && d.signature) {
      /*
       * 서명. 이것 하나가 없으면 그 생각 블록은 못 돌려보낸다 — 서버가
       * 서명 없는 생각 블록을 거절하기 때문이다. 여기를 빠뜨리면 생각을
       * 켠 채 도구를 쓰는 순간 그 턴이 죽고, 화면에는 왜인지 안 나온다.
       *
       * 조각으로 나뉘어 올 수 있으므로 이어 붙인다.
       */
      acc.생각블록 ??= [];
      acc.생각블록[번호] ??= { type: 'thinking', thinking: '', signature: '' };
      acc.생각블록[번호].signature += d.signature;
    } else if (d.type === 'input_json_delta' && d.partial_json != null) {
      acc._raw ??= [];
      acc._raw[번호] ??= { id: null, name: '', args: '' };
      acc._raw[번호].args += d.partial_json;
    }
    return out;
  }
  if (종류 === 'message_delta') {
    /*
     * 출력 토큰은 **덮어쓴다.** 조각마다의 양이 아니라 여태 누적 총계라서,
     * 더하면 조각 수만큼 부풀어 오른다. 입력 쪽은 해당 없으면 아예 안 오므로
     * 왔을 때만 덮는다 — 없는 것을 0 으로 덮으면 message_start 에서 받아 둔
     * 진짜 값이 지워진다.
     */
    if (obj.usage?.output_tokens != null) acc.usage.out = obj.usage.output_tokens;
    if (obj.usage?.input_tokens != null) acc.usage.in = obj.usage.input_tokens;
    // 캐시 수치는 대개 message_start 에 실리지만, 여기 싣는 판도 있다.
    const c = 캐시읽기(obj.usage);
    if (c.읽음) acc.usage.cacheRead = c.읽음;
    if (c.씀) acc.usage.cacheWrite = c.씀;
    if (obj.delta?.stop_reason) acc.stopped = obj.delta.stop_reason;
    if (obj.delta?.stop_reason === 'refusal') acc.거절 = obj.delta.stop_details ?? { type: 'refusal' };
    return out;
  }
  if (종류 === 'content_block_stop' || 종류 === 'message_stop') 도구마무리(acc);
  return out;
}

// OpenAI 스트리밍은 도구 호출 인자를 글자 단위로 쪼개 보낸다. 인덱스별로 이어 붙인다.
function mergeDeltaCalls(acc, deltas) {
  acc._raw ??= [];
  for (const d of deltas) {
    const i = d.index ?? 0;
    acc._raw[i] ??= { id: d.id, name: '', args: '' };
    if (d.id) acc._raw[i].id = d.id;
    if (d.function?.name) acc._raw[i].name += d.function.name;
    if (d.function?.arguments) acc._raw[i].args += d.function.arguments;
  }
  도구마무리(acc);
}

// 글자로 쪼개져 온 도구 인자를 하나로 읽는다. 두 규격이 같이 쓴다.
function 도구마무리(acc) {
  if (!acc._raw) return;
  // 인자가 안 읽히면 읽혔다고 치지 않는다 — normalizeCalls 머리말 참고.
  // 스트리밍은 마지막 조각이 안 오면 여기서 늘 깨진 채로 끝난다.
  acc.toolCalls = acc._raw.filter(Boolean).map((c, i) => {
    const call = { id: c.id ?? `call_${i + 1}`, name: c.name, args: {} };
    if (!c.args) return call;
    try { call.args = JSON.parse(c.args); }
    catch { call.argsBroken = true; call.rawArgs = c.args; }
    return call;
  });
}
