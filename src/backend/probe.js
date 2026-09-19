// 게이트웨이/로컬서버가 "에이전트를 돌릴 수 있는지"를 실제 요청으로 확인한다.
// 각 검사는 { id, label, status, detail, ms } 를 돌려준다.
//   ok   되는 것을 확인함
//   no   안 됨 (기능에 직접 영향)
//   warn 되긴 하는데 조건이 붙음
//   skip 앞 검사가 실패해 확인 불가
import { req, headersFor, serverMessage } from './http.js';
import { 언제풀리나 } from './quota.js';
import { probeCtx } from './ctxsize.js';
import { 눈검사메시지 } from './vision.js';
import {
  주소붙이기, endpoint, 더할머리, buildBody, extractMessage,
  assistantMessage, toolMessage,
} from './adapter.js';
import { 벤더 } from './toolfit.js';
import { 세션이름짓기, 기본카드 } from './wire.js';
import { 말 } from '../i18n/index.js';

const READ_TOOL = {
  type: 'function',
  function: {
    name: 'read_file',
    description: '파일 하나의 내용을 읽는다',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '읽을 파일 경로' } },
      required: ['path'],
    },
  },
};

/*
 * ── 규격 차이는 여기서 흡수하지 않는다 ──────────────────────────────────
 *
 * 여기에 build() 와 extract() 가 따로 있었다. 그 둘이 아는 규격은 `ollama` 와
 * 「나머지 = OpenAI」 **둘뿐**이었고, `anthropic` 은 「나머지」 로 떨어졌다.
 * 그래서 Claude 를 직접 붙이면 진단이 이렇게 갔다 —
 *
 *   · 판 머리(anthropic-version)를 안 얹는다 → 그 하나로 400
 *   · 문 이름이 /chat/completions (있어야 할 것은 /messages)
 *   · 시킴말이 messages 안으로 들어간다 → 「모르는 역할」
 *   · 도구가 {type:'function', function:{…}} 모양으로 간다
 *   · 답을 choices[0].message 에서 찾는다 (실제로는 content 블록 배열)
 *
 * 첫 칸(기본 대화)이 400 으로 죽으면 나머지 여덟 칸은 전부 「확인 불가」 로
 * 건너뛴다. 그 결과 `deel setup` 이 저장하는 프로필에 streaming·tools·json·
 * vision 이 **다 false** 로 적힌다 — Claude 를 붙였는데 도구를 아예 안 쓰는
 * 연결이 만들어진다. 붙기는 붙으니 아무도 고장이라고 생각하지 않는다.
 *
 * adapter.js 첫 줄은 처음부터 "진단(probe)과 에이전트 루프가 같은 함수를
 * 쓴다" 고 적어 두었다. 실제로는 안 썼다. 이제 쓴다 — 규격이 넷째가 되어도
 * 이 파일은 안 고쳐도 된다.
 */

/** 이 회사가 무엇을 받는지까지 봐야 몸통이 맞다 (toolfit.js 의 벤더). */
function 몸통(conn, opts) {
  /*
   * 출력 상한의 **이름**만은 카드에서 받는다. 안 주면 buildBody 가 옛 이름·새 이름을 둘 다
   * 싣는데, 추론 모델(gpt-5·o 계열)은 옛 이름을 튕긴다. 그러면 첫 칸이 400 으로 죽고 나머지가
   * 「확인 불가」 로 건너뛰어져, setup 이 streaming·tools·json 을 전부 false 로 **저장**했다.
   *
   * 그래서 **새 이름만 받는 모델**(카드의 출력칸 '새것')일 때만 카드를 준다. 그 카드는
   * 추론 눈금 형식(effort)도 같이 들고 있어 짝이 맞는다. 나머지는 여태처럼 카드 없이 —
   * 카드를 주면 캐시 표식·생각 형식이 얹혀, 진단이 재려는 「맨 몸통에 어떻게 답하나」 가
   * 우리 짐작이 섞인 몸통의 답이 된다. 조각 카드도 안 된다: 카드가 있으면 눈금을 짐작하지
   * 않아서(adapter.js 의 나가는눈금) 추론 강도 칸이 통째로 빠진다.
   */
  const 카드 = conn.전선 ?? 기본카드(conn);
  return buildBody(conn.kind, {
    model: conn.model, 회사: 벤더(conn), maxTokens: 128, 카드: 카드?.출력칸 === '새것' ? 카드 : null, ...opts,
  });
}

// 추론 모델일 때 기본 대화 칸에 덧붙일 설명.
function c_note(retried) {
  return retried ? ' (추론 모델 — 사고를 끄고 다시 물어 확인)' : ' (추론 모델)';
}

/*
 * ── 이 문으로는 안 나오는 모델 (Codex 계열) ─────────────────────────────
 *
 * `gpt-5-codex` 계열은 OpenAI 가 **Responses API(/responses)로만** 내준다.
 * `/chat/completions` 로 물으면 404 나 400 이 오는데, 그 화면에는 상태 코드
 * 한 줄만 남는다. 그러면 사람은 열쇠를 의심하거나 모델 이름을 잘못 적은 줄
 * 알고, 맞는 이름을 몇 번씩 다시 넣어 본다 — 이름은 처음부터 맞았다.
 *
 * ── 왜 이름을 보나. 이 파일에서만 본다 ─────────────────────────────────
 *
 * 어디로 보낼지는 **주소로만** 정한다(1.9). 그 규칙은 여기서도 안 깬다 —
 * 여기서 이름을 보는 것은 보낼 곳을 고르려는 것이 아니라, **이미 실패한
 * 요청에 까닭을 붙이려는** 것뿐이다. 그래서 미리 막지 않는다. 요청은 그대로
 * 나가고, 실패했을 때만 한 줄이 붙는다. 언젠가 OpenAI 가 이 문으로도 내주면
 * 요청이 그냥 성공하고 이 줄은 저절로 안 나온다.
 *
 * 게이트웨이는 해당 없다. 그 뒤에 무엇이 걸려 있는지 우리는 모르고, 사내
 * 게이트웨이가 제 나름대로 이 계열을 chat 창구로 내주는 일도 있다.
 */
const CODEX계열 = /^(?:gpt-5-codex|codex-)/i;

export function 코덱스인가(conn) {
  return 벤더(conn) === 'openai' && CODEX계열.test(String(conn?.model ?? ''));
}

const SKIPPED = [
  ['system', '시스템 메시지'],
  ['stream', '스트리밍'],
  ['tools', '도구 호출'],
  ['toolresult', '도구 결과 되돌리기'],
  ['json', '구조적 출력'],
  ['vision', '그림 보기'],
  ['think', '추론 강도 조절'],
  ['ctx', '컨텍스트 길이'],
];

/**
 * 이 진단 한 번을 가리키는 번호.
 *
 * agent/store.js 의 대화 번호와 **같은 모양**으로 짓는다(YYYYMMDD-HHMMSS).
 * 모양이 다르면 세션이름짓기 가 안전한 꼴이 아니라고 보고 지문으로 바꾸는데,
 * 지문은 사람이 대시보드에서 「아까 그 진단」 을 못 찾게 만든다.
 */
function 진단번호(at = new Date()) {
  const 두 = (n) => String(n).padStart(2, '0');
  return `${at.getFullYear()}${두(at.getMonth() + 1)}${두(at.getDate())}`
    + `-${두(at.getHours())}${두(at.getMinutes())}${두(at.getSeconds())}`;
}

export async function probe(conn, onStep = () => {}) {
  const { kind: shape, base, auth, model } = conn;
  const key = conn.key ?? '';
  /*
   * 판 머리를 여기서도 얹는다 (adapter.js 의 더할머리).
   *
   * Anthropic 규격은 `anthropic-version` 하나가 없으면 400 이다. 열쇠가
   * 멀쩡해도 그렇다. 진단 화면은 그 400 을 「연결 실패」 로 적고, 사람은
   * 열쇠를 다시 받으러 간다 — 여덟 칸이 전부 그 한 줄 때문에 빨개진다.
   */
  /*
   * 진단도 **제 이름을 달고 나간다.**
   *
   * 여기서 나가는 것은 여덟아홉 번의 진짜 채팅 완성이다. 이름이 없으면
   * 게이트웨이가 그 하나하나를 새 대화로 연다 — 대시보드에는 정체 모를
   * 단발 요청이 아홉 줄 쌓이고, 그 줄들은 무엇을 하다 생긴 것인지 아무도
   * 모른다. 「붙는지 봤다」 와 「누가 몰래 두드렸다」 가 화면에서 같아진다.
   *
   * 대화가 아니므로 이어받을 이름이 없다. 이 진단 한 번을 한 대화로 묶는
   * 이름을 여기서 짓는다 — 담기는 것은 여전히 번호 하나뿐이다.
   */
  const 진단이름 = 세션이름짓기(진단번호());
  const H = () => headersFor(auth, key, 더할머리(shape, 진단이름));
  /*
   * 물음표 뒤를 끝에 남겨야 한다 (adapter.js 의 주소붙이기).
   *
   * 이 한 줄이 예전에 `${base}${p}` 였다. Azure base 에는 `?api-version=` 이
   * 붙어 있어서, 그대로 이으면
   * `.../deployments/gpt-4o?api-version=2024-10-21/chat/completions` 가 된다.
   * 그러면 **설치 화면이 제 검사에 통째로 실패한다** — 기본 대화가 안 되니
   * 나머지 여덟 칸이 다 '확인 불가' 로 건너뛰어지고, 프로필에는 스트리밍도
   * 도구 호출도 안 된다고 적힌다. 붙기는 붙는데 반쪽짜리로 붙는다.
   */
  const url = (p) => 주소붙이기(base, p);
  const results = [];
  const facts = { shape, base, auth, model };

  const add = (r) => { results.push(r); onStep(r); return r; };
  /*
   * ── 잠깐 막힌 것을 「못 한다」 로 저장하지 않는다 ────────────────────────
   *
   * 사람이 본 것: 설치하는 순간 게이트웨이가 429 를 한 번 냈다. 화면은 「기본 대화 ✗ Rate limit
   * reached」 와 여덟 칸의 「확인 불가」 였고, 프로필에는 streaming·tools·json·think·vision 이 전부
   * false 로 저장됐다(setup.js 가 `facts.x ?? false` 로 적는다). 도구를 아예 안 쓰는 연결이 됐다.
   *
   * 실제로 있었던 일: 각 칸이 요청 **한 번**의 성패로 능력을 정했다. 429·502·503·504 는 모델이 무엇을
   * 할 수 있는지에 대해 아무 말도 안 한다 — 지금 바쁘다는 말이다 (6회차 Gemini 더듬6 P5·B3·B4·B5).
   *
   * 이제 지키는 규칙: 그런 답이면 한 번 쉬었다(Retry-After, 없으면 2초 · 10초 넘게는 안 기다림)
   * 다시 묻는다. 시간 초과는 다시 안 묻는다 — 이미 60~120초를 기다린 뒤라 설치 화면이 곱절로 멈춘다.
   */
  const 잠깐막힘 = (r) => [429, 502, 503, 504].includes(r?.status);
  const 한번부르기 = (opts) => req(url(endpoint(shape)), {
    method: 'POST',
    headers: H(),
    body: 몸통(conn, opts),
    timeout: opts.timeout ?? 60000,
    stream: opts.stream,
  });
  const call = async (opts) => {
    const r = await 한번부르기(opts);
    if (!잠깐막힘(r)) return r;
    const 초 = 언제풀리나(r.headers?.get?.('retry-after') ?? null);
    await new Promise((ok) => setTimeout(ok, Math.min(Math.max((초 ?? 2) * 1000, 500), 10000)));
    return 한번부르기(opts);
  };
  // 답 읽기도 루프와 같은 함수를 쓴다. 도구 부름은 { id, name, args } 로
  // 고르게 나온다 — 규격마다 다른 자리를 여기서 또 헤아리지 않는다.
  const 읽기 = (r) => extractMessage(shape, r?.json);

  // 1. 기본 대화 — 이게 안 되면 나머지는 볼 필요가 없다.
  //    추론 모델은 본문이 전부 thinking 으로 가고 토큰 상한에 잘린다.
  //    그걸 "안됨"으로 볼 수 없으므로, 사고를 끄고 넉넉히 한 번 더 물어본다.
  const ASK = { messages: [{ role: 'user', content: '1+1은? 숫자만 답하세요.' }] };
  let basic = await call({ ...ASK, maxTokens: 256 });
  let got = basic.ok ? 읽기(basic) : { content: '', thinking: '' };
  let thinkingModel = false;
  let retried = false;
  // 사고를 **끌 수 있다고 확인한** 모델인가. 짐작이 아니라 실제로 끄고 본문을 받아 봤을 때만 선다.
  let 사고끌수있나 = false;
  let 넉넉 = 256;   // 기본 대화가 본문을 낸 상한 — 추론 모델이면 뒤 칸도 이 아래로 안 준다 (아래 상한)

  /*
   * ── 사고를 **글로 안 내주는** 모델도 여기로 온다 ──────────────────────
   *
   * 갈래가 `got.thinking` — 즉 사고가 글로 보일 때만 열렸다. 그런데 요즘
   * 추론 모델 중에는 사고를 아예 안 내주는 쪽이 더 흔하다(게이트웨이 뒤
   * OpenAI 계열). 그쪽은 본문도 비고 사고도 비어서 이 갈래에 못 들어오고,
   * 바로 아래에서 **「응답이 비어 있습니다 — 모델 이름을 확인하세요」** 가 된다.
   * 그러고는 남은 여덟 줄이 전부 「기본 대화가 안 되어 확인 불가」 로 건너뛰고,
   * 그 판정이 프로필에 `streaming·tools·json·think·vision` 전부 false 로 남는다.
   *
   * 주소·열쇠·모델 이름은 처음부터 다 맞았다. 256토큰이 생각에 다 쓰인 것뿐이다.
   * 사람은 맞는 이름을 몇 번씩 다시 넣어 본다 — 이 파일 머리말이 「붙기는
   * 붙으니 아무도 고장이라고 생각하지 않는다」 고 적어 둔 그 모양이다.
   *
   * 손에 이미 증거가 있다. **상한에 걸려 끝났다**(stopped)거나 **생각 토큰을
   * 썼다**(usage.reasoning)면 빈 답의 까닭이 이름이 아니다.
   */
  const 상한에걸렸나 = (e) => e?.stopped === 'length' || e?.stopped === 'max_tokens';
  const 생각만했나 = (e) => !!e?.thinking || 상한에걸렸나(e) || (e?.usage?.reasoning ?? 0) > 0;
  /*
   * ── 본문이 **왔어도** 추론 모델일 수 있다 ──────────────────────────────
   *
   * 아래 갈래가 `!got.content` 안에만 있었다. 그런데 1+1 은 쉬운 물음이라,
   * 256 안에서 생각도 하고 답도 내는 추론 모델이 많다. 그 모델은 여기를 안
   * 지나가고 **보통 모델로 적혔다.** 그러면 아래 `상한()` 이 아무 일도 안 해서
   * 뒤 칸을 128·32 로 묻고, 그 상한은 생각에 다 나가 본문이 빈다 —
   * 시스템·스트리밍·그림이 「못 한다」 로 적히고 프로필에 false 로 남는다.
   * 이 파일이 아래 248–261줄에서 없애려던 바로 그 고장이다 (8회차 뒷단-배우기).
   *
   * 다만 **상한에 걸렸다**는 것만으로는 안 친다. 본문이 온 판에서 그것은 보통
   * 모델이 길게 답하다 잘린 것과 구별이 안 된다. 본문이 있을 때는 사고 글이나
   * 생각 토큰 — 즉 **생각했다는 증거**가 있어야 추론 모델로 본다.
   */
  const 생각한흔적 = (e) => !!e?.thinking || (e?.usage?.reasoning ?? 0) > 0;
  if (basic.ok && (생각한흔적(got) || (!got.content && 생각만했나(got)))) thinkingModel = true;

  if (basic.ok && !got.content && 생각만했나(got)) {
    retried = true;
    const second = await call({ ...ASK, maxTokens: 1024, think: false, timeout: 90000 });
    const e2 = second.ok ? 읽기(second) : null;
    if (e2?.content) { basic = second; got = e2; 넉넉 = 1024; 사고끌수있나 = true; }
    else {
      /*
       * 사고를 못 끄는 서버 — 상한만 크게 올려 한 번 더.
       *
       * 이 걸음이 `if (second.ok)` **안에** 있었다. 그래서 `think:false` 를
       * 400 으로 **거절하는** 서버는 여기에 영영 못 닿았다 — 상한만 올리면
       * 답하는 모델인데 기본 대화가 ✗ 로 끝나고 나머지 여덟 칸이 전부
       * 「확인 불가」 가 됐다. 그 판정이 프로필에 전부 false 로 남는다.
       * 칸 하나를 거절한 것과 모델이 못 하는 것은 다른 말이다.
       */
      const third = await call({ ...ASK, maxTokens: 2048, timeout: 120000 });
      const e3 = third.ok ? 읽기(third) : null;
      if (e3?.content) { basic = third; got = e3; 넉넉 = 2048; }
    }
  }

  const basicText = got.content;
  const basicOk = basic.ok && !!basicText;
  facts.thinkingModel = thinkingModel;
  /*
   * 사고를 끌 수 있는 모델이면 이후 검사에서 꺼서 토큰과 시간을 아낀다.
   *
   * 여기가 `thinkingModel` 만 봤다. 그런데 추론 모델이라고 다 끌 수 있는 것은
   * 아니다 — 위에서 `think:false` 를 **400 으로 거절한** 서버도 추론 모델이다.
   * 그 창구에 이 칸을 다시 실으면 뒤 여덟 번이 전부 400 이고, 프로필에는
   * 도구·JSON·스트리밍이 다 false 로 남는다. 서버가 안 받는다고 말한 칸은
   * 그 뒤로 안 보낸다 — 끌 수 있다고 **확인한** 모델에만 붙인다.
   */
  const quiet = shape === 'ollama' && 사고끌수있나 ? { think: false } : {};
  /*
   * ── 기본 대화를 넉넉히 받은 모델은 뒤 칸도 그만큼 준다 ───────────────────
   *
   * 사람이 본 것: 추론 모델을 붙였더니 기본 대화는 ✓(추론 모델)인데 도구 호출 ✗ 「도구를 안 부르고 글로만
   * 답합니다」 · 구조적 출력 「스키마를 안 지킴 — 받은 값 ""」 · 스트리밍 「한 번에 옵니다」 였고, 프로필에
   * tools·json·streaming 이 false 로 저장됐다. 도구를 못 쓰는 에이전트가 됐다.
   *
   * 실제로 있었던 일: 기본 대화는 256 → 1024 → 2048 로 올려서야 본문을 받았는데, 뒤 칸들은 다시 128
   * (시스템·스트리밍) · 256(도구 결과) · 512(도구·JSON) 로 물었다. 사고를 끌 수 있는 Ollama 만 quiet 로
   * 넉넉히 줬고, 사고를 못 끄는 창구(OpenAI 계열 추론 모델)는 그 상한을 생각에 다 쓰고 빈 본문을 냈다
   * (6회차 Gemini 더듬6 P2). 모델이 못 한 것이 아니라 우리가 말할 자리를 안 준 것이다.
   *
   * 이제 지키는 규칙: 추론 모델이면 뒤 칸의 상한을 **기본 대화가 본문을 낸 상한** 아래로 내리지 않는다.
   */
  const 상한 = (n) => (thinkingModel ? Math.max(n, 넉넉) : n);

  add({
    id: 'chat',
    label: '기본 대화',
    status: basicOk ? 'ok' : 'no',
    detail: basicOk
      ? `응답 "${basicText.trim().slice(0, 24)}"` + (thinkingModel ? c_note(retried) : '')
      : basic.ok
        ? got.thinking || 생각만했나(got)
          ? '사고만 나오고 본문이 안 나옵니다 — 토큰 상한을 크게 올려야 합니다'
          : '응답이 비어 있습니다 — 모델 이름을 확인하세요'
        // 못 붙은 까닭을 아는 자리가 하나 있다. 상태 코드만 남기면 사람은
        // 열쇠를 의심하는데, 열쇠도 이름도 처음부터 맞았다 (코덱스인가 머리말).
        : 코덱스인가(conn)
          ? `${serverMessage(basic)}\n${말('probe.codexOnly', { 모델: model })}`
          : serverMessage(basic),
    ms: basic.ms,
  });
  if (!basicOk) {
    for (const [id, label] of SKIPPED) {
      add({ id, label, status: 'skip', detail: '기본 대화가 안 되어 확인 불가', ms: 0 });
    }
    return { facts, results };
  }

  // 2. 시스템 메시지 — 규칙과 스킬이 먹느냐가 여기 달렸다.
  const sys = await call({
    ...quiet,
    maxTokens: 상한(128),
    messages: [
      { role: 'system', content: '너는 무슨 질문을 받든 정확히 DEEL 한 단어만 답한다.' },
      { role: 'user', content: '안녕하세요' },
    ],
  });
  const sysHit = sys.ok && /DEEL/i.test(읽기(sys).content);
  add({
    id: 'system',
    label: '시스템 메시지',
    status: sys.ok ? (sysHit ? 'ok' : 'warn') : 'no',
    detail: sys.ok
      ? sysHit ? '지시를 따름' : '전달은 되나 모델이 잘 안 따름 — 규칙·스킬이 약하게 적용됩니다'
      : serverMessage(sys),
    ms: sys.ms,
  });

  // 3. 스트리밍 — 화면이 한 글자씩 흐르느냐.
  const st = await call({
    ...quiet,
    messages: [{ role: 'user', content: '1부터 20까지 세어보세요.' }],
    maxTokens: 상한(128),
    stream: true,
    timeout: 45000,
  });
  let chunks = 0;
  let firstMs = 0;
  let 읽다실패 = null;
  if (st.ok && st.res?.body) {
    const t0 = Date.now();
    try {
      const reader = st.res.body.getReader();
      const dec = new TextDecoder();
      while (chunks < 400) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = dec.decode(value, { stream: true });
        const hits = (text.match(/(^|\n)data:|"done"\s*:/g) ?? []).length;
        /*
         * 조각으로 셀 것을 먼저 정하고, **그것으로** 첫 응답 시각을 잰다.
         *
         * 여기가 `hits` 만 보고 시각을 쟀다. 그런데 바로 아랫줄은 `data:` 도
         * `"done":` 도 안 쓰는 평문 청크도 조각으로 센다 — 그런 창구에서는
         * 조각이 다섯인데 첫 응답만 `0ms` 로 나갔다. 잰 값이 아니라 지어낸
         * 값이고, 사람은 그걸 「번개같이 빠른 창구」 로 읽는다.
         */
        const 센것 = hits || (text.trim() ? 1 : 0);
        if (센것 && !firstMs) firstMs = Date.now() - t0;
        chunks += 센것;
      }
      reader.cancel().catch(() => {});
    } catch (e) {
      /*
       * 여기가 빈 catch 였다.
       *
       * 그러면 `getReader()` 가 던진 TypeError(본문이 우리가 기대한 꼴이
       * 아니다)도 삼켜지고, 조각이 0개인 채로 아래에서 **「한 번에 옵니다」**
       * 라고 적힌다. 우리 잘못이 서버 진단으로 둔갑하는 것이다 — 사람은
       * 멀쩡한 창구를 스트리밍 안 되는 창구로 알고 쓴다.
       *
       * 끊긴 것(Abort)은 진짜로 예상한 일이라 그대로 넘긴다. 그 밖은 적는다.
       */
      if (e?.name !== 'AbortError') 읽다실패 = String(e?.message ?? e).slice(0, 120);
    }
  }
  add({
    id: 'stream',
    label: '스트리밍',
    // 못 읽은 것은 ✗ 가 아니다 — 「안 된다」 가 아니라 「못 쟀다」 다 (아래 머리말, 그림 칸과 같은 자세).
    status: chunks > 2 ? 'ok' : st.ok ? 'warn' : 'no',
    detail: chunks > 2
      ? `조각 ${chunks}개, 첫 응답 ${firstMs}ms`
      : 읽다실패 ? `흘러오는 것을 읽지 못했습니다 — ${읽다실패} (못 쟀습니다 — 켠 채로 둡니다)`
        : st.ok ? '한 번에 옵니다 — 화면은 스피너로 대체합니다' : serverMessage(st),
    ms: st.ms,
  });
  /*
   * 못 쟀으면 **켠 채로** 둔다 — 되돌아올 수 있는 쪽으로 틀린다 (아래 그림 칸 머리말).
   *
   * 여기가 `chunks > 2` 하나였다. 바로 위 catch 는 「우리 잘못이 서버 진단으로 둔갑하는
   * 것이다 — 사람은 멀쩡한 창구를 스트리밍 안 되는 창구로 알고 쓴다」 고 적어 놓고 화면
   * 글자만 고쳤고, **프로필에 남는 값**은 옛것 그대로 false 였다 (사냥6 막판-뒷단).
   * setup.js 가 `facts.streaming ?? false` 로 적으므로 그 false 는 그 연결의 스트리밍을
   * 영영 끈다 — 화면은 답을 한 번에 통째로 띄우고, 왜 그런지는 어디에도 안 남는다.
   * 그림 칸·추론 칸은 같은 판에서 이 규칙을 적용했는데 이 칸만 빠져 있었다.
   */
  facts.streaming = chunks > 2 || !!읽다실패;

  // 4. 도구 호출 — 에이전트의 생사가 걸린 검사.
  //
  // 실제로 준 상한을 **한 번만 셈해서** 아래 화면 글에도 그대로 쓴다. 두 자리에
  // 따로 적어 두면 추론 모델에서 어긋난다 — 1024 로 물어 놓고 화면에는 512 라고
  // 적었고, 그 줄을 읽은 사람은 엉뚱한 자리를 올린다 (8회차 뒷단-배우기).
  const 도구상한 = 상한(512);
  const tl = await call({
    ...quiet,
    messages: [{ role: 'user', content: 'config.json 파일을 읽어 주세요.' }],
    tools: [READ_TOOL],
    maxTokens: 도구상한,
    timeout: 90000,
  });
  const tcalls = tl.ok ? 읽기(tl).toolCalls : [];
  const gotCall = tcalls.length > 0;
  // 부름은 이미 { id, name, args } 로 고르게 나온다 (extractMessage).
  // 예전에는 여기서 OpenAI 날모양(function.arguments)을 직접 팠다 —
  // 그러면 Anthropic 은 도구를 제대로 불러도 「안 불렀다」 로 읽힌다.
  const argOk = gotCall && JSON.stringify(tcalls[0]?.args ?? '').includes('config');
  /*
   * ── 우리 상한에 잘린 것을 모델 탓으로 적었다 ──────────────────────────
   *
   * 인자 JSON 이 위 `maxTokens: 512` 안에서 잘리면 normalizeCalls 가
   * `args = {}` 로 두고 **`argsBroken` 을 세운다.** 그러면 여기서 `config` 를
   * 못 찾아 「인자가 부정확, 편집 신뢰성 작업이 더 필요합니다」 가 된다 —
   * 모델은 경로를 제대로 쓰고 있었고 원문은 `rawArgs` 에 그대로 있다.
   *
   * 그 한 줄이 이 모델의 인자 품질 판정으로 보고서에 남는다. 우리가 만든
   * 잘림을 남의 흠으로 적지 않는다 (34차 리뷰).
   */
  const 잘린인자 = gotCall && tcalls[0]?.argsBroken === true;
  /*
   * argsBroken 은 이제 「잘림」 과 「끝까지 온 틀린 JSON」 둘 다다 — 어댑터가 argsCut 으로 가른다
   * (사냥5 L5-5 · adapter.js 잘린모양인가). argsCut 이 false 면 우리 상한 탓이 아니다. 여기서 원문에
   * config 가 있다고 「잘렸을 뿐」 · ok 로 적으면 홑따옴표로 적는 모델을 우리 탓으로 덮고 좋은 모델로
   * 판정한다 — 위 머리말과 거꾸로 된 틀림이다.
   */
  const 모양틀림 = 잘린인자 && tcalls[0]?.argsCut === false;
  const 원문에있나 = 잘린인자 && !모양틀림 && String(tcalls[0]?.rawArgs ?? '').includes('config');
  add({
    id: 'tools',
    label: '도구 호출',
    status: gotCall ? (argOk || 원문에있나 ? 'ok' : 'warn') : 'no',
    detail: gotCall
      ? `${tcalls[0]?.name} 호출됨${argOk ? ''
        : 원문에있나 ? ` — 인자가 우리 상한(${도구상한}토큰)에 잘렸을 뿐, 값은 제대로 왔습니다`
          : 모양틀림 ? ' — 인자 JSON 모양이 틀렸습니다 (홑따옴표·끝 쉼표 같은 것 — 편집 도구가 자주 거절당합니다)'
          : 잘린인자 ? ' — 인자 JSON 이 잘려 왔습니다 (상한을 올려 다시 보세요)'
            : ' — 인자가 부정확, 편집 신뢰성 작업이 더 필요합니다'}`
      : tl.ok ? '도구를 안 부르고 글로만 답합니다' : serverMessage(tl),
    ms: tl.ms,
  });
  facts.tools = gotCall;

  // 5. 도구 결과 되돌리기 — 여러 턴이 이어지느냐. 에이전트 루프의 전제다.
  if (gotCall) {
    const tc = tcalls[0];
    const callId = tc.id ?? 'call_1';
    /*
     * 되돌려 넣는 모양도 루프와 같은 함수로 짓는다 (adapter.js).
     *
     * 여기에 규격별 갈래를 손으로 적어 두면 규격이 하나 늘 때마다 이 자리가
     * 조용히 틀린다 — Anthropic 에서는 도구 결과가 사람 차례로 가야 하는데
     * `role:'tool'` 로 보내 「모르는 역할」 을 받고 있었다.
     */
    const assistantMsg = assistantMessage(shape, { content: '', toolCalls: [tc] });
    const toolMsg = toolMessage(shape, { callId, name: tc.name, content: '{"port": 7099}' });
    const rt = await call({
      ...quiet,
      timeout: 90000,
      messages: [
        { role: 'user', content: 'config.json 파일을 읽어 주세요.' },
        assistantMsg,
        toolMsg,
        { role: 'user', content: 'port 값이 몇인가요? 숫자만 답하세요.' },
      ],
      tools: [READ_TOOL],
      maxTokens: 상한(256),
    });
    const said = rt.ok ? 읽기(rt).content : '';
    add({
      id: 'toolresult',
      label: '도구 결과 되돌리기',
      status: rt.ok ? (/7099/.test(said) ? 'ok' : 'warn') : 'no',
      detail: rt.ok
        ? /7099/.test(said) ? '결과를 읽고 이어서 답함' : `받긴 하나 활용이 약함 ("${said.trim().slice(0, 20)}")`
        : serverMessage(rt),
      ms: rt.ms,
    });
  } else {
    add({ id: 'toolresult', label: '도구 결과 되돌리기', status: 'skip', detail: '도구 호출이 안 되어 확인 불가', ms: 0 });
  }

  // 6. 구조적 출력 — 편집 형식을 강제할 수 있느냐.
  const schema = {
    type: 'object',
    properties: { answer: { type: 'number' } },
    required: ['answer'],
    additionalProperties: false,
  };
  /*
   * 한 번은 흔들릴 수 있으므로 실패하면 한 번만 더 본다.
   *
   * 그 「실패」 를 `!parsed` 로 적어 뒀다. 그러면 **스키마를 어겨도 JSON 으로만
   * 읽히면** 다시 안 물었다 — `{"result":21}` 한 번에 `warn` 이 되고, 그 판정이
   * 프로필에 `json:false` 로 남는다. 한 번 흔들린 것과 못 하는 것을 가르자고 둔
   * 되풀이인데, 정작 제일 흔한 흔들림(칸 이름을 한 번 잘못 적는 것)에서 안 돌았다.
   * 여기서 보려는 것은 「읽히나」 가 아니라 **「스키마를 지키나」** 다.
   */
  const 스키마맞나 = (x) => !!(x && 'answer' in x);
  let js = null;
  let parsed = null;
  let raw = '';
  for (let attempt = 0; attempt < 2 && !스키마맞나(parsed); attempt++) {
    js = await call({
      ...quiet,
      messages: [{ role: 'user', content: '3 곱하기 7은?' }],
      json: schema,
      maxTokens: 상한(512),
      timeout: 90000,
    });
    if (!js.ok) break;
    raw = 읽기(js).content ?? '';
    /*
     * **객체일 때만** 읽었다고 한다.
     *
     * 답 모양을 강제하는 칸이 없는 규격(Anthropic)에서는 이 물음에 그냥
     * `21` 이라고 답한다. `JSON.parse('21')` 은 오류 없이 숫자 21 을 준다.
     * 그런데 그다음 줄이 `'answer' in parsed` 라, 숫자에 `in` 을 써서
     * **TypeError 로 진단 전체가 통째로 죽었다.** 스키마를 안 지킨 것은
     * 「구조적 출력 안 됨」 이라고 적을 일이지 프로그램이 끝날 일이 아니다.
     */
    try {
      const 읽힌것 = JSON.parse(raw);
      if (읽힌것 && typeof 읽힌것 === 'object' && !Array.isArray(읽힌것)) parsed = 읽힌것;
    } catch { /* 글로만 답하는 서버 — 아래에서 '스키마를 안 지킴' 으로 적는다 */ }
  }
  const jsonOk = 스키마맞나(parsed);
  add({
    id: 'json',
    label: '구조적 출력',
    status: jsonOk ? 'ok' : js?.ok ? 'warn' : 'no',
    detail: jsonOk
      ? `스키마대로 반환 (answer=${parsed.answer})`
      : js?.ok
        ? `스키마를 안 지킴 — 받은 값 ${JSON.stringify(raw.slice(0, 60))} · 편집 형식을 프롬프트로 강제합니다`
        : serverMessage(js ?? {}),
    ms: js?.ms ?? 0,
  });
  facts.json = jsonOk;

  /*
   * 6.5 그림 — 이 모델이 그림을 볼 수 있느냐.
   *
   * 이름으로 짐작하지 않는다. 사내 게이트웨이는 `gpt-4o` 라는 이름 뒤에
   * 무엇이든 걸어 둘 수 있고, 로컬에 받아 둔 llava 계열은 이름이 제각각이다.
   * 한 번 물어보면 확실해지는 것을 짐작할 이유가 없다.
   *
   * 흰 점 하나짜리 1×1 PNG 로 묻는다 (vision.js). 무엇이 찍혀 있을지 모르는
   * 진짜 화면을 확인하자고 바깥으로 내보낼 수는 없다.
   *
   * 답의 내용은 안 본다. 흰 점 하나를 보고 무슨 말을 하든 상관없고, 우리가
   * 알고 싶은 것은 **서버가 그림이 든 메시지를 받아 주느냐** 하나다.
   * 못 받는 서버는 400 이나 415 로 거절한다.
   */
  let 눈 = await call({
    ...quiet,
    messages: [눈검사메시지(shape)],
    maxTokens: 상한(32),
    timeout: 60000,
  });
  /*
   * ── 32토큰 상한에 걸린 것을 「안 보인다」 로 적었다 ────────────────────
   *
   * 위 머리말이 「답의 내용은 안 본다 — 알고 싶은 것은 서버가 그림이 든
   * 메시지를 받아 주느냐 하나다」 라고 적어 놓고, 아래에서 **본문이 비면 못
   * 보는 것**으로 단정했다. 추론 모델은 그 32토큰을 생각에 다 쓰므로 본문이
   * 빈다 — 400 도 415 도 안 났는데, 즉 **받아 준 것인데** 안 보인다고 적혔다.
   *
   * 그 판정은 프로필에 `vision: false` 로 남고, 그 뒤로 화면 사진을 영영 안
   * 보낸다(agent/loop.js 가 Read 설명에서 그림 이야기를 뺀다). 노란 경고 한
   * 줄이라 고장으로 안 읽힌다.
   *
   * 상한에 걸린 것이면 한 번 더 넉넉히 묻는다 — 기본 대화 칸이 이미 그렇게
   * 한다. 그래도 비면 그때는 못 쟀다고 적는다(아래).
   */
  let 눈읽은것 = 읽기(눈);
  if (눈.ok && !눈읽은것.content && 상한에걸렸나(눈읽은것)) {
    const 다시 = await call({
      ...quiet, messages: [눈검사메시지(shape)], maxTokens: 상한(512), think: false, timeout: 90000,
    });
    if (다시.ok) { 눈 = 다시; 눈읽은것 = 읽기(다시); }
  }
  const 눈있음 = !!(눈.ok && 눈읽은것.content);
  // 받아 주긴 했는데 본문을 못 본 판 — 「안 보인다」 와 다르다.
  const 눈못쟀나 = !눈있음 && 눈.ok && 상한에걸렸나(눈읽은것);
  add({
    id: 'vision',
    label: '그림 보기',
    status: 눈있음 ? 'ok' : 눈.ok ? 'warn' : 'no',
    detail: 눈있음
      ? `1×1 PNG 를 받아서 답함 — Read·@ 로 화면 사진을 보여 줄 수 있습니다`
      : 눈못쟀나
        ? '그림이 든 메시지는 받아 줬는데 답이 토큰 상한에 걸려 못 쟀습니다 — 켠 채로 둡니다'
        : 눈.ok
          ? '그림을 받긴 했는데 답이 비었습니다 — 안 보이는 것으로 칩니다'
          : `${serverMessage(눈)} — 그림은 안 보냅니다`,
    ms: 눈.ms ?? 0,
  });
  /*
   * 못 쟀으면 **켠 채로** 둔다.
   *
   * 둘 중 하나는 틀릴 수밖에 없는 자리다. 틀리는 값이 다르다 —
   *
   *   false 로 적으면  볼 수 있는 모델에 그림을 영영 안 보낸다. 사람은 왜
   *                    화면 사진이 안 먹는지 알 길이 없다(되돌릴 길도 없다).
   *   true 로 적으면   못 보는 서버가 400·415 로 말해 주고, 그 한 번으로
   *                    화면에 까닭이 뜬다.
   *
   * 되돌아올 수 있는 쪽으로 틀린다.
   */
  facts.vision = 눈있음 || 눈못쟀나;

  /*
   * 7. 추론 강도 조절 — 낮음/높음이 실제로 다른 결과를 내느냐.
   *
   * 상한에 걸리면 둘 다 같은 숫자가 나와 비교가 무의미해진다. 넉넉히 준다.
   *
   * Anthropic 규격은 여기서 상한을 더 크게 잡아야 한다. 그쪽은 강도를 말이
   * 아니라 **출력 상한 안에서 나가는 예산**으로 주는데(adapter.js 의
   * 생각예산), 1,500 으로는 답에 남길 자리를 빼고 나면 최소 예산 1,024 를
   * 못 만든다. 그러면 생각이 아예 안 켜진 채로 두 번을 부르고, 이 칸은
   * 「차이 없음」 이라고 적는다 — 켤 수 있는 모델에 대고 못 켠다고 적는 셈이다.
   */
  const THINK_CAP = shape === 'anthropic' ? 8000 : 1500;
  const seen = [];
  for (const lv of ['low', 'high']) {
    const r = await call({
      messages: [{ role: 'user', content: '17 곱하기 23은? 계산 과정을 보이세요.' }],
      think: lv,
      maxTokens: THINK_CAP,
      timeout: 120000,
    });
    if (r.ok) {
      const e = 읽기(r);
      seen.push({
        lv,
        ms: r.ms,
        thought: (e.thinking ?? '').length,
        // 토큰 수와 끝난 까닭도 규격마다 이름이 다르다. 읽는 자리를 하나로 모은다 —
        // 여기서 OpenAI 이름만 보면 Anthropic 은 늘 0 이고 늘 '안 잘림' 이 된다.
        out: e.usage?.out ?? 0,
        // 「안 왔다」 와 「0」 을 가른다 (adapter.js 의 잰것). 이걸 안 보면
        // usage 를 안 주는 창구에서 못 잰 것을 「차이 없음」 으로 적는다.
        잰것: e.usage?.잰것 === true,
        capped: 상한에걸렸나(e),
      });
    } else {
      seen.push({ lv, ms: r.ms, err: serverMessage(r), status: r.status });
    }
  }
  const bothOk = seen.every((s) => !s.err);
  /*
   * ── 거절과 못 잰 것을 가른다 ────────────────────────────────────────────
   *
   * 사람이 본 것: 이 칸이 ✗ 「파라미터 거부됨 — Unrecognized request argument supplied: reasoning_effort」
   * 인데 프로필에는 think: true 가 저장됐다. 그 뒤로 매 요청에 서버가 거절한 그 칸을 실어 보냈다.
   *
   * 실제로 있었던 일: 아래 `facts.think = differs || !잴것이있었나` 에서 잴것이있었나 가 bothOk 를 품고
   * 있어, 요청이 **실패하기만 하면** 「못 쟀다 → 켠 채로」 가 됐다. 서버가 분명히 거절한 것까지 (6회차
   * Gemini 더듬6 B1).
   *
   * 이제 지키는 규칙: 4xx(시간 초과 408·속도 429 빼고)는 서버가 **이 칸을 안 받는다고 말한 것** — false.
   * 429·5xx·끊김은 아무 말도 안 한 것이라 위 그림 칸 머리말대로 켠 채로 둔다.
   */
  const 거절됨 = seen.some((s) => s.err && s.status >= 400 && s.status < 500 && s.status !== 408 && s.status !== 429);
  const capped = bothOk && seen.every((s) => s.capped);
  // 사고 길이가 눈에 띄게 다르거나, 출력량이 20% 넘게 차이나야 "먹는다"고 본다.
  const thoughtGap = bothOk ? Math.abs(seen[0].thought - seen[1].thought) : 0;
  const outGap = bothOk ? Math.abs(seen[0].out - seen[1].out) : 0;
  const differs = bothOk && !capped &&
    (thoughtGap > Math.max(80, seen[0].thought * 0.2) || outGap > Math.max(20, seen[0].out * 0.2));
  /*
   * ── 잴 칸이 없었던 판 ──────────────────────────────────────────────────
   *
   * 사고도 글로 안 오고 usage 도 안 오는 창구가 있다(호환 게이트웨이·프록시).
   * 그러면 `thought` 와 `out` 이 넷 다 0 이고 `thoughtGap = outGap = 0` 이라
   * **「차이 없음」** 이 된다 — 두 요청의 걸린 시간이 세 배로 벌어져 있어도
   * 그렇다. 강도는 먹고 있었고 우리가 잴 칸이 없었을 뿐이다.
   *
   * 그 판정이 프로필에 `think: false` 로 남으면 `/think` 가 「이 모델은 조절
   * 안 됩니다」 라고 하고 상태줄도 회색으로 굳는다. 안 되는 것을 안 된다고
   * 적는 것과, **못 쟀는데 안 된다고 적는 것**은 다르다.
   */
  const 잴것이있었나 = bothOk && seen.every((s) => s.잰것 || s.thought > 0);
  const fmt = (s) => `${s.lv === 'low' ? '낮음' : '높음'} 사고 ${s.thought}자/출력 ${s.잰것 ? `${s.out}토큰` : '토큰 안 옴'}/${s.ms}ms`;
  add({
    id: 'think',
    label: '추론 강도 조절',
    status: !bothOk ? (거절됨 ? 'no' : 'warn') : capped ? 'warn' : differs ? 'ok' : 'warn',
    detail: !bothOk
      ? 거절됨
        ? `파라미터 거부됨 — ${seen.find((s) => s.err)?.err}`
        : `못 쟀습니다 — 서버가 지금 답을 못 했습니다 (${seen.find((s) => s.err)?.err}). 조절은 켠 채로 둡니다.`
      : capped
        ? `둘 다 토큰 상한(${THINK_CAP})에 걸려 비교 불가 — 못 쟀습니다. 조절은 켠 채로 둡니다.`
        : differs
          ? `${fmt(seen[0])} · ${fmt(seen[1])}`
          : 잴것이있었나
            ? `차이 없음 (${fmt(seen[0])} · ${fmt(seen[1])}) — 강도를 바꿔도 답이 안 바뀝니다`
            : `못 쟀습니다 — 사고도 usage 도 안 주는 창구입니다 (${fmt(seen[0])} · ${fmt(seen[1])}).`
              + ' 조절은 켠 채로 둡니다 — 안 받는 창구면 서버가 거절하면서 말해 주고, 그때 배웁니다.',
    ms: seen.reduce((a, s) => a + (s.ms ?? 0), 0),
  });
  /*
   * 못 쟀으면 켠 채로 둔다 — 되돌아올 수 있는 쪽으로 틀린다 (위 그림 칸 머리말).
   *
   * `capped` 가 이 셈에서 빠져 있었다. 그래서 화면에는 「비교 불가」 라고 적고
   * 같은 줄에서 조절을 껐다 — **못 쟀는데 안 된다고 적는** 바로 그 자리다
   * (아래 「잴 칸이 없었던 판」 머리말이 말하는 것과 같은 틀림). 둘 다 상한에
   * 걸린 것은 이 모델이 강도를 안 받는다는 말이 아니라 우리가 자리를 좁게 준
   * 것이다 (8회차 뒷단-배우기).
   */
  facts.think = differs || (bothOk ? (capped || !잴것이있었나) : !거절됨);

  // 8. 컨텍스트 길이 — 파일을 몇 개까지 한 번에 읽힐 수 있느냐.
  //
  // 한 자리만 보지 않는다. 서버마다 이름도 자리도 다르다 (ctxsize.js 참고).
  // 여기서 작게 잡으면 프로그램 전체가 작아진다 — 답 길이 상한까지 이 값에서 나온다.
  const 길이 = await probeCtx({ kind: shape, base, auth, key, model });
  const ctx = 길이.value;
  add({
    id: 'ctx',
    label: '컨텍스트 길이',
    status: ctx ? 'ok' : 'warn',
    detail: ctx
      ? `${ctx.toLocaleString()} 토큰 (${길이.source ?? '모델 정보'}에서 읽음)`
        + (길이.max && 길이.loaded && 길이.max > 길이.loaded
          ? ` · 이 모델은 ${길이.max.toLocaleString()} 까지 되는데 지금 ${길이.loaded.toLocaleString()} 로 올려 두셨습니다`
          : '')
      : '서버가 알려주지 않음 — /ctx 로 직접 지정하세요',
    ms: 0,
  });
  facts.ctx = ctx;
  facts.ctxMax = 길이.max ?? null;
  facts.ctxLoaded = 길이.loaded ?? null;

  return { facts, results };
}
