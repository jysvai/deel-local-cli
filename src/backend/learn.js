// 서버가 거절할 때 하는 말에서 진짜 한계를 배운다.
//
// 왜 이게 핵심인가:
//
//   서버 규격을 하나하나 아는 방식으로는 영영 못 따라간다. LM Studio · llama.cpp ·
//   vLLM · TGI · KoboldCpp · LocalAI · LiteLLM · OpenRouter · 사내 게이트웨이,
//   그리고 아직 나오지 않은 것들. 새 서버가 나올 때마다 코드를 고쳐야 한다면
//   그 코드는 늘 한 발 늦는다.
//
//   그런데 서버는 거절할 때 **정답을 그대로 말해 준다.**
//
//     "This model's maximum context length is 8192 tokens, however you
//      requested 41003 tokens (33003 in the messages, 8000 in the completion)."
//
//   숫자가 둘 다 들어 있다 — 한계도, 우리가 얼마나 넘겼는지도. 규격을 몰라도
//   되고, 이름이 무엇인지도 알 필요가 없다. **처음 보는 서버에서도 통한다.**
//
//   그런데 지금까지 그 문장을 버리고 있었다. 스트리밍이면 본문을 안 읽고
//   HTTP 400 만 던졌다. 화면에는 `✗ HTTP 400` 한 줄만 남았다.
//   사용자를 구할 수 있었던 문장이 그 자리에서 사라진 것이다.
//
// 여기서는 문장에서 숫자만 뽑는다. 뽑은 값으로 무엇을 할지는 loop.js 가 정한다.

const 최소 = 512;
const 최대허용 = 10_000_000;

const 성한수 = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 최소 && n <= 최대허용 ? n : null;
};

/**
 * 거절 문장에서 배울 것이 있나.
 *
 * 여러 규격의 문장을 받는다. 영어가 대부분이지만 사내 게이트웨이가 한국어로
 * 옮겨 놓은 것도 있어서 그쪽도 같이 본다.
 *
 * @returns {{kind:'ctx'|'out', limit:number, asked:number|null, text:string}|null}
 *   kind  'ctx' 는 컨텍스트 전체, 'out' 은 한 번에 낼 답 길이
 *   limit 서버가 말한 한계
 *   asked 우리가 요청했던 값 (알 수 있으면)
 */
export function 배울것(message) {
  const s = String(message ?? '');
  if (!s) return null;

  // ── 1) 컨텍스트 한계 ──────────────────────────────────────────────────
  // OpenAI·vLLM·LiteLLM·대부분의 게이트웨이가 이 모양으로 말한다.
  const ctx표 = [
    // OpenAI·대부분의 게이트웨이
    // "maximum context length is 8192 tokens, however you requested 41003"
    // "…is 4096 tokens. However, you requested 5000 tokens."  ← 마침표가 중간에 낀다.
    // 그래서 [^.] 로 막으면 안 된다. 대신 사이를 80자로만 묶어 엉뚱한 숫자를 안 집게 한다.
    /maximum context length is\s+(\d+)\s*tokens?(?:[\s\S]{0,80}?requested\s+(\d+))?/i,
    /context length[^.\d]{0,40}(\d{3,})[\s\S]{0,80}?requested\s+(\d+)/i,
    // vLLM: "Requested tokens (41003) exceed context window of 8192"
    /context window of\s+(\d{3,})/i,
    // llama.cpp: "n_ctx = 8192" · "greater than n_ctx (8192)"  ← 괄호가 붙는다
    /n_ctx\s*[:=]?\s*\(?\s*(\d{3,})/i,
    // 한국어로 옮겨 놓은 사내 게이트웨이
    /(?:최대\s*)?컨텍스트[^\d]{0,20}(\d{3,})/,
  ];
  for (const re of ctx표) {
    const m = re.exec(s);
    if (!m) continue;
    const limit = 성한수(m[1]);
    if (!limit) continue;
    return { kind: 'ctx', limit, asked: 성한수(m[2]) ?? null, text: 짧게(s) };
  }

  // ── 2) 답 길이 한계 ───────────────────────────────────────────────────
  const out표 = [
    // "max_tokens is too large: 200000. This model supports at most 16384 completion tokens"
    /supports? at most\s+(\d+)\s*(?:completion\s*)?tokens?/i,
    // "max_tokens must be less than or equal to 8192"
    /max_(?:completion_)?tokens[^\d]{0,40}(\d{3,})/i,
    /num_predict[^\d]{0,20}(\d{3,})/i,
    /(?:최대\s*)?(?:출력|답)[^\d]{0,20}(\d{3,})/,
  ];
  for (const re of out표) {
    const m = re.exec(s);
    if (!m) continue;
    const limit = 성한수(m[1]);
    if (!limit) continue;
    return { kind: 'out', limit, asked: null, text: 짧게(s) };
  }

  /*
   * ── 모르는 서버를 위한 마지막 수 ──────────────────────────────────────
   *
   * 위의 표들은 '이미 본 문장' 만 읽는다. 그런데 이 파일이 존재하는 이유는
   * **처음 보는 서버에서도 통하게** 하려는 것이다. 표를 늘리는 방식으로는
   * 영영 못 따라간다 — 서버는 계속 새로 나오고, 문장은 저마다 다르다.
   *
   *   TGI        "input length 41003 exceeds maximum 8192"
   *   llama.cpp  "context the overflows: 41003 > 8192"
   *   KoboldCpp  "Prompt is too long: 41003 > 8192"
   *
   * 문장은 다 다른데 **모양은 하나**다 — 숫자가 둘 나오고, 우리가 보낸 큰
   * 값과 서버가 받는 작은 값이다. 그러면 규칙은 간단하다: 길이가 문제라고
   * 말하는 문장에서 숫자를 다 뽑아, **작은 쪽이 한계**다.
   *
   * 틀려도 안전한 쪽으로 틀린다 — 한계를 실제보다 작게 잡으면 조금 손해 보고
   * 돌아갈 뿐이지만, 크게 잡으면 조용히 잘린다. 그리고 다음 요청에서 서버가
   * 또 알려 주므로 스스로 고쳐진다.
   *
   * **표를 먼저 다 본 뒤에** 온다. 순서가 중요하다 — 앞에 두면
   * `max_tokens is too large: 200000 … at most 16384` 같은 **출력** 한계가
   * 컨텍스트 한계로 잘못 배워진다. 그러면 창을 16,384 로 줄여 버린다.
   */
  if (길이문제인가(s)) {
    const 숫자들 = [...s.matchAll(/\d[\d,]*/g)]
      .map((m) => 성한수(m[0].replace(/,/g, '')))
      .filter(Boolean);
    if (숫자들.length >= 2) {
      const 작은것 = Math.min(...숫자들);
      const 큰것 = Math.max(...숫자들);
      // 둘이 같으면 뭘 뽑은 건지 알 수 없다. 그때는 배웠다고 하지 않는다.
      if (작은것 < 큰것) return { kind: 'ctx', limit: 작은것, asked: 큰것, text: 짧게(s), 짐작: true };
    }
  }

  return null;
}

/**
 * 이 오류가 '너무 길어서' 인가.
 *
 * 숫자를 못 뽑았어도 이건 알 수 있을 때가 있다. 그러면 값을 배우지는 못해도
 * **줄여서 다시 해 볼 수는 있다.** 사용자에게는 실패가 안 보이는 편이 낫다.
 */
export function 길이문제인가(message) {
  const s = String(message ?? '');
  return /context (?:length|size|window)|too (?:long|large|many tokens)|exceeds?[^.]{0,30}(?:context|limit|token)|max_tokens|token limit|컨텍스트|너무 (?:깁|많|큽)/i.test(s)
    // 아래는 서버마다 말이 달라 위 표에 안 잡히던 것들이다. 전부 실제 문장이다.
    //   TGI        "input length 41003 exceeds maximum 8192"
    //   llama.cpp  "context the overflows: 41003 > 8192"
    //   여러 곳     "prompt is too long" · "n_ctx" · "n_predict"
    || /overflow|input length|prompt (?:is )?too|exceeds?\s+maximum|n_ctx|n_predict|입력이 (?:너무|깁)/i.test(s);
}

function 짧게(s) {
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 200);
}
