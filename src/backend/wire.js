// 전선 카드 — 이 모델이 이 주소에서 **실제로 받는 것**.
//
// ── 왜 필요한가 ─────────────────────────────────────────────────────────
//
// 여태 규격은 셋이었다(openai · anthropic · ollama). 그런데 같은 규격 안에서도
// 받는 것이 다르다. 실제로 겪은 세 자리다.
//
//   1. `/think max` 를 쳐도 전선에는 `high` 가 나갔다. openai 규격 눈금표가
//      max 를 high 로 뭉개고 있었다. 화면은 max, 전선은 high — 사람은 세게
//      생각하라고 시켰다고 믿는데 아무 일도 안 일어난다.
//
//   2. Anthropic 규격에 생각을 켜면 `budget_tokens` 를 보냈다. Opus 5 ·
//      Opus 4.7 · 4.8 · Fable 5 는 그 칸을 **400 으로 거절한다.** 열쇠가
//      멀쩡한데 400 이니, 화면에서는 인증 실패와 구별이 안 된다.
//
//   3. 캐시 표식을 아무 데도 안 붙였다. 자동 캐시를 하는 서버는 정적 앞머리만
//      잡아 주고, 안 하는 서버(Anthropic 직통)는 **하나도 안 잡는다.**
//
// ── 표를 박지 않는다 ────────────────────────────────────────────────────
//
// 모델 이름과 그 능력을 표로 박으면 그 표는 반드시 낡는다. 이 프로그램에는
// 이미 그 문제를 푸는 방식이 있다 — **짐작하고, 서버가 거절하면 배우고,
// 배운 것을 남긴다** (backend/learn.js · agent/card.js · agent/evolve.js).
// 여기도 같은 세 단계다.
//
//   짐작  주소의 회사와 모델 이름의 세대로 첫 값을 고른다
//   배움  400 문구에서 무엇이 안 되는지 읽는다 (아래 배울전선)
//   남김  모델별로 집 파일에 적어 둔다 (agent/evolve.js)
//
// ── 세션 안에서는 안 바뀐다 ─────────────────────────────────────────────
//
// 카드는 **세션을 열 때 한 번** 정하고 끝까지 그대로 쓴다. 요청마다 값이
// 달라지면 그것이 곧 프리픽스가 흔들린다는 뜻이고, 프리픽스가 흔들리면
// 캐시가 매번 새로 엮인다. 배워서 값이 바뀌는 것은 예외다 — 그건 안 그러면
// 그 턴이 죽는 자리라, 한 번 흔들리는 값을 치른다.
import { 벤더 } from './toolfit.js';
import { 말 } from '../i18n/index.js';

/** 우리 눈금. agent/effort.js 의 LEVELS 와 같은 차례다 (off 는 따로 다룬다). */
export const 눈금차례 = ['low', 'medium', 'high', 'xhigh', 'max'];

/*
 * 회사별로 전선이 받는 눈금.
 *
 * 우리 눈금 다섯이 어디서나 통하지는 않는다. 없는 말을 실어 보내면 400 이고,
 * 그 400 은 화면에서 열쇠가 틀린 것과 구별이 안 된다. 그래서 회사마다 받는
 * 말만 적어 두고, 없는 말은 **있는 말 중 가장 가까운 아래쪽**으로 내린다.
 *
 *   Claude    low · medium · high · xhigh · max   (xhigh 가 코딩에 제일 낫다)
 *   OpenAI    minimal · low · medium · high
 *   Gemini    none · low · medium · high
 *   Ollama    참·거짓, 또는 low · medium · high
 *
 * 모르는 주소면 빈 목록이다 — 그때는 **아무것도 안 보낸다.** 짐작으로 실은
 * 칸 하나가 그 턴을 죽인다.
 */
const 회사눈금 = {
  anthropic: ['low', 'medium', 'high', 'xhigh', 'max'],
  bedrock: ['low', 'medium', 'high', 'xhigh', 'max'],
  openai: ['minimal', 'low', 'medium', 'high'],
  azure: ['low', 'medium', 'high'],
  gemini: ['none', 'low', 'medium', 'high'],
};

/** '생각 끄기' 를 이 회사는 뭐라고 하나. 없으면 칸 자체를 안 보낸다. */
const 끄는말 = { openai: 'minimal', gemini: 'none' };

/**
 * 모델 이름에서 세대를 읽는다.
 *
 * 이름 짓는 법이 두 가지라 둘 다 본다.
 *   새 방식  claude-opus-5 · claude-opus-4-8 · anthropic.claude-sonnet-4-6-v1
 *   옛 방식  claude-3-5-sonnet-20241022
 *
 * @returns {number|null} 4.6 · 5 처럼. 못 읽으면 null
 */
export function 세대(모델) {
  const s = String(모델 ?? '').toLowerCase();
  if (!s) return null;

  /*
   * ── 옛 방식을 먼저 본다 ─────────────────────────────────────────────
   *
   * 옛 이름은 숫자가 갈래 **앞**에 온다 (`claude-3-5-sonnet-20241022`).
   * 새 방식을 먼저 보면 그 이름에서 `sonnet-20241022` 를 읽어 판을
   * **20241022** 로 잡는다. 그 값은 4.6 보다 크니 생각을 adaptive 로
   * 켜고, 그 모델은 그 칸을 400 으로 거절한다 — 옛 모델을 쓰는 사람만
   * 조용히 못 쓰게 되는 자리다. 좁은 규칙을 먼저 보는 이유가 이것이다.
   */
  let m = /claude[-_.]?(\d+)(?:[-_.](\d+))?[-_.](opus|sonnet|haiku)/.exec(s);
  if (m) return 판짜기(m[1], m[2]);

  // 새 방식 — 갈래 이름 **뒤에** 숫자가 온다 (`claude-opus-4-8`).
  m = /(opus|sonnet|haiku|fable|mythos)[-_.]?(\d+)(?:[-_.](\d+))?/.exec(s);
  if (m) return 판짜기(m[2], m[3]);

  // 판 번호 없이 갈래만 적힌 이름. Fable · Mythos 는 최신 갈래라 그렇게 친다.
  if (/fable|mythos/.test(s)) return 5;
  return null;
}

/**
 * 큰 자리와 작은 자리를 판 번호 하나로.
 *
 * 작은 자리는 **한 자리만** 본다. `claude-sonnet-4-6-v1` 의 뒤 `v1` 도,
 * `20241022` 같은 날짜도 판 번호가 아니다. 큰 자리도 마찬가지라 두 자리를
 * 넘으면 판이 아니라 날짜로 보고 안 읽는다 — 모르는 것을 지어내면 그 짐작이
 * 그대로 생각 형식을 정하고, 틀리면 그 턴이 400 이다.
 */
function 판짜기(큰것, 작은것) {
  const 큰 = Number(큰것);
  if (!Number.isFinite(큰) || 큰 > 99) return null;
  const 작은 = 작은것 === undefined ? 0 : Number(작은것);
  return 큰 + (Number.isFinite(작은) && 작은 < 10 ? 작은 / 10 : 0);
}

/** 이 이름이 Claude 갈래로 보이나. */
export function 클로드인가(모델) {
  return /claude|fable|mythos|opus|sonnet|haiku/i.test(String(모델 ?? ''));
}

/**
 * 이 이름이 추론 눈금(reasoning_effort)을 받는 OpenAI 갈래인가.
 *
 * gpt-5 · o1 · o3 · o4 계열이다. gpt-4o 는 아니다 — `o` 가 붙어 있지만
 * 추론 모델이 아니라서, 여기 걸리면 안 되는 값을 실어 보내게 된다.
 */
export function 추론형오픈AI(모델) {
  const s = String(모델 ?? '').toLowerCase();
  if (/gpt-?4o/.test(s)) return false;
  return /(^|[^a-z])o[1-9]([^a-z]|$)|gpt-?5|gpt-?6/.test(s);
}

/**
 * 아무것도 안 겪었을 때의 카드.
 *
 * @param {object} conn  { kind, base, model }
 */
export function 기본카드(conn) {
  const 회사 = 벤더(conn);
  const 규격 = conn?.kind ?? 'openai';
  const 모델 = String(conn?.model ?? '');

  const 카드 = {
    회사,
    규격,
    // 생각을 어떻게 켜나
    생각형식: 'none',
    // 전선이 받는 눈금
    눈금: 회사 ? (회사눈금[회사] ?? []) : [],
    끄는말: 회사 ? (끄는말[회사] ?? null) : null,
    // 눈금을 어느 칸에 싣나 — adaptive 는 output_config.effort 에 싣는다
    효력칸: null,
    // 캐시 표식을 우리가 붙이나
    캐시: 'none',
    // 캐시 표식이 잡히는 최소 크기 (그 아래면 붙여도 안 잡힌다 — 탈은 아니다)
    캐시최소: 1024,
    // 세션 이름을 어느 칸에 싣나
    세션자리: null,
    // 흘려받기에서 usage 를 달라고 할까
    스트림usage: false,
  };

  if (규격 === 'ollama') {
    카드.생각형식 = 'boolean';
    카드.눈금 = ['low', 'medium', 'high'];
    return 카드;
  }

  if (규격 === 'anthropic') {
    /*
     * 이 규격은 캐시 표식을 **정식으로** 받는다. 붙일 수 있는 유일한 자리라
     * 여기서는 망설이지 않는다 — 안 붙이면 Anthropic 직통은 캐시가 0 이다.
     */
    카드.캐시 = 'explicit';
    카드.캐시최소 = 회사 === 'bedrock' ? 4096 : 1024;
    카드.세션자리 = 'metadata';
    /*
     * 4.6 판부터 생각이 adaptive 로 바뀌었다. 그 전 판은 budget_tokens 다.
     * 못 읽으면 adaptive 로 간다 — 지금 쓰이는 것이 그쪽이고, 틀려도 첫 400
     * 에서 바로 배운다(아래 배울전선).
     */
    const v = 세대(모델);
    카드.생각형식 = v === null ? 'adaptive' : (v >= 4.6 ? 'adaptive' : 'budget');
    if (카드.생각형식 === 'adaptive') 카드.효력칸 = 'output_config';
    if (!카드.눈금.length) 카드.눈금 = 회사눈금.anthropic;
    return 카드;
  }

  // ── 여기부터 openai 규격 ────────────────────────────────────────────
  카드.세션자리 = 'user';
  카드.스트림usage = !!회사;   // 모르는 게이트웨이에는 안 보낸다

  if (회사 === 'openai') {
    // 문서에 있는 칸이다. 아는 자리에서만 쓴다.
    카드.캐시 = 'key';
    카드.생각형식 = 추론형오픈AI(모델) ? 'effort' : 'none';
    return 카드;
  }
  if (회사 === 'bedrock' || 회사 === 'gemini' || 회사 === 'azure') {
    /*
     * 이 창구들은 서버가 알아서 앞머리를 캐시한다. 우리가 표식을 지어내
     * 실어 보내는 것보다, **앞머리를 안 흔드는 것**이 여기서 할 일이다
     * (agent/session.js 의 차례 · loop.js 의 전선 고정).
     */
    카드.캐시 = 'auto';
    if (회사 === 'bedrock') {
      카드.생각형식 = 클로드인가(모델) ? 'effort' : 'none';
      /*
       * ── Bedrock 의 OpenAI 창구에서는 Claude 눈금을 안 쓴다 ────────────
       *
       * 회사는 bedrock 이라 위에서 눈금이 `…xhigh · max` 로 잡혔다. 그런데
       * 지금 나가는 몸은 **OpenAI 호환 몸**이고, 그 창구가 `xhigh` 를 받는지는
       * 문서에서 확인하지 못했다. 확인 못 한 말을 실어 보내면 그 턴이 400 이고,
       * 그 400 은 화면에서 열쇠가 틀린 것과 구별이 안 된다 — 이 파일이 없애려던
       * 바로 그 고장이다.
       *
       * 그래서 **몸의 규격을 따른다.** `xhigh` 와 `max` 는 Anthropic Messages
       * 몸으로 나갈 때만 쓴다(위 anthropic 갈래 · mantle 의 /anthropic/v1).
       *
       * 잘못 좁히면 손해가 「생각을 덜 한다」 로 끝나고, 잘못 넓히면 손해가
       * 「그 턴이 죽는다」 다. 확인이 안 되면 죽지 않는 쪽으로 간다.
       */
      카드.눈금 = 회사눈금.openai;
    } else {
      카드.생각형식 = 회사 === 'gemini' ? 'effort' : (추론형오픈AI(모델) ? 'effort' : 'none');
    }
    return 카드;
  }

  /*
   * 모르는 주소 — 사내 게이트웨이가 대개 여기다.
   *
   * 여기서 짐작하면 안 된다. 그런데 **여태 하던 것**은 이어 가야 한다:
   * 예전에도 reasoning_effort 는 보내고 있었다. 그것까지 끊으면 잘 쓰던
   * 사람이 조절을 잃는다. 그래서 형식만 그대로 두고, 눈금은 제일 좁은
   * 것으로 잡는다 — 없는 말을 실어 보내는 쪽이 위험하다.
   */
  카드.생각형식 = 'effort';
  카드.눈금 = ['low', 'medium', 'high'];
  return 카드;
}

/**
 * 이 강도를 이 전선의 말로 옮긴다.
 *
 * 없는 말이면 **있는 것 중 가장 가까운 아래**로 내린다. 위로 올리지 않는다 —
 * 사람이 시킨 것보다 세게 생각하면 값이 사람 모르게 는다.
 *
 * @returns {string|null} 못 옮기면 null (그때는 칸을 아예 안 보낸다)
 */
export function 눈금맞추기(카드, 강도) {
  const s = String(강도 ?? '');
  const 눈금 = 카드?.눈금 ?? [];
  if (s === 'off') return 카드?.끄는말 ?? null;
  if (!눈금.length) return null;
  if (눈금.includes(s)) return s;
  let i = 눈금차례.indexOf(s);
  if (i < 0) return null;
  for (; i >= 0; i--) if (눈금.includes(눈금차례[i])) return 눈금차례[i];
  return null;
}

/*
 * ── 서버가 거절하면서 알려 주는 것 ──────────────────────────────────────
 *
 * backend/learn.js 와 같은 생각이다. 거기는 **숫자**(창 크기·출력 상한)를
 * 읽고, 여기는 **칸**을 읽는다 — 무엇을 보내면 안 되는지.
 *
 * 제일 값진 자리는 「받는 값의 목록」 을 통째로 알려 주는 문장이다.
 *
 *   "reasoning_effort must be one of: minimal, low, medium, high"
 *
 * 이 한 줄이면 짐작을 그만두고 사실로 갈아탈 수 있다.
 *
 * @returns {{무엇:string, 값:any, 왜:string}|null}
 */
export function 배울전선(문구) {
  const s = String(문구 ?? '');
  if (!s) return null;
  /*
   * 「안 받는다」 를 뜻하는 말들. 창구마다 쓰는 낱말이 다르다.
   *
   *   Anthropic  "is deprecated"          (아직 400 은 아닌데 곧 그렇게 된다)
   *   OpenAI     "Unrecognized request argument supplied"
   *   Bedrock    "ValidationException ... not supported"
   *
   * 하나라도 빠지면 그 창구에서만 못 배운다 — 그리고 못 배우면 같은 400 을
   * 세션마다 다시 맞는다. 넓게 잡되, 아래에서 **칸 이름과 함께** 있을 때만
   * 쓴다. 낱말 하나로는 아무 오류 문장에나 걸린다.
   */
  const 거절 = /not supported|unsupported|unrecognized|unknown|unexpected|invalid|must be|is not permitted|not allowed|removed|deprecated|cannot be used|no longer/i;

  // ── 받는 값의 목록을 통째로 알려 주는 자리 ──────────────────────────
  const 목록 = /(?:reasoning_effort|effort)[^\n]{0,60}?(?:must be one of|one of|expected one of)\s*[:\s]*([a-z0-9_,'"\s|-]+)/i.exec(s);
  if (목록) {
    const 값들 = 목록[1]
      .split(/[,|]/)
      .map((x) => x.replace(/['"`.\s]/g, '').toLowerCase())
      .filter((x) => /^[a-z]+$/.test(x) && x.length <= 12);
    if (값들.length >= 2) return { 무엇: '눈금', 값: 값들, 왜: 짧게(s) };
  }

  // ── 생각 칸 ─────────────────────────────────────────────────────────
  if (/budget_tokens/i.test(s) && 거절.test(s)) {
    return { 무엇: '생각형식', 값: 'adaptive', 왜: 짧게(s) };
  }
  if (/adaptive/i.test(s) && 거절.test(s)) {
    return { 무엇: '생각형식', 값: 'budget', 왜: 짧게(s) };
  }
  if (/reasoning_effort/i.test(s) && 거절.test(s)) {
    return { 무엇: '생각형식', 값: 'none', 왜: 짧게(s) };
  }
  if (/output_config/i.test(s) && 거절.test(s)) {
    return { 무엇: '효력칸', 값: null, 왜: 짧게(s) };
  }
  if (/\bthinking\b/i.test(s) && 거절.test(s)) {
    return { 무엇: '생각형식', 값: 'none', 왜: 짧게(s) };
  }

  // ── 캐시 표식 ───────────────────────────────────────────────────────
  if (/cache_control|prompt_cache_key|cache_creation/i.test(s) && 거절.test(s)) {
    return { 무엇: '캐시', 값: 'none', 왜: 짧게(s) };
  }

  // ── 세션 이름 ───────────────────────────────────────────────────────
  // 'user' 는 흔한 낱말이라 **칸 이야기일 때만** 본다. 안 그러면 아무
  // 오류 문장에나 걸려서 멀쩡한 칸을 꺼 버린다.
  if (/(?:parameter|property|field|argument)[^\n]{0,24}['"`]?(?:user|metadata)['"`]?/i.test(s) && 거절.test(s)) {
    return { 무엇: '세션자리', 값: null, 왜: 짧게(s) };
  }
  if (/['"`](?:user|metadata)['"`][^\n]{0,40}(?:not supported|unsupported|unknown|unexpected|invalid)/i.test(s)) {
    return { 무엇: '세션자리', 값: null, 왜: 짧게(s) };
  }

  // 칸 이름을 점으로 이어 적는 창구. `metadata.user_id: unsupported field` 처럼
  // 이름이 먼저 오고 까닭이 뒤에 온다 — 위 두 무늬는 그 차례를 못 잡는다.
  if (/\b(?:metadata\.user_id|user_id)\b/i.test(s) && 거절.test(s)) {
    return { 무엇: '세션자리', 값: null, 왜: 짧게(s) };
  }

  // ── 흘려받기 usage ──────────────────────────────────────────────────
  if (/stream_options/i.test(s) && 거절.test(s)) {
    return { 무엇: '스트림usage', 값: false, 왜: 짧게(s) };
  }

  return null;
}

/**
 * 배운 것을 카드에 적는다. 새 카드를 돌려준다 — 원본은 안 건드린다.
 *
 * 생각형식을 끄면 눈금도 같이 뜻이 없어진다. 그런 딸린 자리는 여기서 한 번에
 * 맞춘다 — 부르는 쪽마다 기억하게 두면 언젠가 한 곳이 빠진다.
 */
export function 카드고치기(카드, 고침) {
  if (!카드 || !고침) return 카드;
  const 새 = { ...카드 };
  새[고침.무엇] = 고침.값;
  if (고침.무엇 === '생각형식') {
    새.효력칸 = 고침.값 === 'adaptive' ? 'output_config' : null;
    if (고침.값 === 'none') 새.눈금 = [];
  }
  if (고침.무엇 === '눈금' && Array.isArray(고침.값)) {
    // 서버가 알려 준 목록에 '끄는 말' 이 있으면 그것도 같이 배운다.
    새.끄는말 = 고침.값.find((x) => x === 'minimal' || x === 'none') ?? null;
  }
  return 새;
}

/** 집 파일에 적을 만한 것만. 주소·모델은 부르는 쪽이 열쇠로 쓴다. */
export function 카드저장꼴(카드) {
  if (!카드) return null;
  return {
    생각형식: 카드.생각형식,
    눈금: 카드.눈금,
    끄는말: 카드.끄는말,
    효력칸: 카드.효력칸,
    캐시: 카드.캐시,
    세션자리: 카드.세션자리,
    스트림usage: 카드.스트림usage,
  };
}

/** 남겨 둔 것을 짐작 위에 얹는다. 없는 칸은 짐작 그대로 둔다. */
export function 카드합치기(기본, 남긴것) {
  if (!남긴것 || typeof 남긴것 !== 'object') return 기본;
  const 새 = { ...기본 };
  for (const k of ['생각형식', '눈금', '끄는말', '효력칸', '캐시', '세션자리', '스트림usage']) {
    if (남긴것[k] !== undefined) 새[k] = 남긴것[k];
  }
  return 새;
}

/**
 * 연결에 전선 카드를 달아 준다. 켤 때 한 번 부른다.
 *
 * 요청마다 짓지 않는다 — 카드가 요청마다 달라지면 그것이 곧 몸통이 매번
 * 달라진다는 뜻이고, 그러면 캐시가 영영 안 걸린다.
 *
 * @param {object} conn
 * @param {object|null} 배움  agent/evolve.js 의 배움 (지난번에 배운 것)
 */
export function 전선붙이기(conn, 배움 = null) {
  if (!conn) return conn;
  const 기본 = 기본카드(conn);
  let 남긴것 = null;
  try { 남긴것 = 배움?.아는전선?.(conn.model, conn.base) ?? null; } catch { 남긴것 = null; }
  conn.전선 = 카드합치기(기본, 남긴것);
  return conn;
}

/**
 * 게이트웨이에 알려 줄 이 대화의 이름.
 *
 * **밖으로 나가는 값이다.** 그래서 담는 것은 대화 번호 하나뿐이다 — 경로도,
 * 주소도, 사용자 이름도, 열쇠도 안 들어간다. 남이 봐도 아무것도 알 수
 * 없어야 하고, 그러면서 같은 대화끼리는 같아야 한다.
 *
 * 글자도 좁게 자른다. 게이트웨이가 이 값을 로그 이름이나 주소에 쓰는 일이
 * 있어서, 이상한 글자가 섞이면 그쪽에서 터진다.
 */
export function 세션이름짓기(id) {
  const 원래 = String(id ?? '');
  if (!원래) return null;

  /*
   * ── 걸러내지 않고, 아니면 통째로 바꾼다 ─────────────────────────────
   *
   * 처음에는 못 쓰는 글자를 지우기만 했다. 그런데 지우기는 **남는 것이
   * 무엇인지 안 보는 방식**이라, 이런 것이 그대로 나갔다.
   *
   *   C:\Users\yunseok\Desktop\비밀폴더  →  deel-CUsersyunseokDesktop
   *
   * 한글만 떨어지고 사람 이름과 폴더 이름은 그대로 남았다. 이 값은 게이트웨이
   * 로그에 적히고 주소에 끼워 쓰이기도 한다 — 즉 밖으로 나간다.
   *
   * 그래서 규칙을 뒤집는다. **이미 안전한 모양일 때만 그대로 쓰고**, 한 글자라도
   * 아니면 원래 글은 버리고 지문으로 바꾼다. 지문은 아무것도 안 알려 주면서
   * 같은 값에는 늘 같다 — 이 자리에 필요한 성질이 정확히 그 둘이다.
   *
   * 대화 번호는 원래 이 모양이라(agent/store.js), 평소에는 지문까지 갈 일이 없다.
   */
  if (/^[A-Za-z0-9_-]{1,48}$/.test(원래)) return `deel-${원래}`;
  return `deel-${지문(원래)}`;
}

/**
 * 되돌릴 수 없는 짧은 지문 (FNV-1a 32비트를 씨앗 둘로, 16진수 16자).
 *
 * 밖으로 나가는 값이라 원래 글을 되찾을 수 없어야 하고, 그러면서 같은 대화는
 * 늘 같은 값이어야 한다. 의존성 0개라 여기서 직접 짠다 — node:crypto 로도
 * 되지만, 이 값은 비밀을 지키는 자물쇠가 아니라 **이름표**라 그만큼이면 된다.
 */
function 지문(글) {
  const 한판 = (씨) => {
    let h = 씨 >>> 0;
    for (let i = 0; i < 글.length; i++) {
      h ^= 글.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return 한판(0x811c9dc5) + 한판(0x9e3779b9);
}

/**
 * 화면 한 줄. `/status` 와 `/think` 가 같은 것을 쓴다.
 *
 * 사람이 `/think max` 를 쳤을 때 **실제로 무엇이 나가는지** 보이는 자리다.
 * 여태 화면과 전선이 다른 말을 하고 있었다.
 *
 * ── 이름표는 옮기고, 전선에 나가는 글자는 안 옮긴다 ────────────────────
 *
 * `adaptive` · `reasoning_effort` · `low·medium·high` 는 **몸에 그대로
 * 실려 나가는 글자**다. 이걸 옮기면 화면에 적힌 말과 실제로 나가는 값이
 * 달라진다 — 이 줄이 존재하는 이유가 바로 그 둘을 맞추는 것이라, 옮기면
 * 줄이 스스로를 배반한다. 그래서 옮기는 것은 이름표(`생각` `눈금` `캐시`)와
 * 우리가 지어낸 말(`표식` `서버자동`) 뿐이다.
 */
export function 전선말(카드) {
  if (!카드) return '';
  const 조각 = [];
  // 전선에 나가는 글자 그대로. 'none' 만 나갈 값이 없다는 뜻이라 옮긴다.
  const 생각 = {
    adaptive: 'adaptive', budget: 'budget_tokens', effort: 'reasoning_effort',
    boolean: 'on/off', none: 말('wire.none'),
  }[카드.생각형식] ?? 카드.생각형식;
  조각.push(`${말('wire.think')} ${생각}`);
  if (카드.눈금?.length) 조각.push(`${말('wire.rungs')} ${카드.눈금.join('·')}`);
  const 캐시 = {
    explicit: 말('wire.cacheMarked'),
    key: 말('wire.cacheKey'),
    auto: 말('wire.cacheAuto'),
    none: 말('wire.none'),
  }[카드.캐시] ?? 카드.캐시;
  조각.push(`${말('wire.cache')} ${캐시}`);
  return 조각.join(' · ');
}

function 짧게(s) {
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 200);
}
