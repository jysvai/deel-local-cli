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
  const 원문 = String(message ?? '');
  if (!원문) return null;
  /*
   * 천 단위 쉼표를 먼저 뗀다. 게이트웨이가 숫자를 사람 눈에 맞춰 적으면(`128,000 tokens`) 아래 표의
   * `\d+` 가 첫 조각에서 끊겨 어느 줄에도 안 걸리고, 맨 끝 「작은 쪽이 한계」 로 떨어져 괄호 속
   * `30,000 in the completion` 을 창 크기로 배웠다 — 128,000 창을 30,000 으로 줄였다 (6회차 Gemini
   * 애저배움6 L1). 떼는 것은 「숫자,세 자리」 뿐이다 — `messages, 30,000` 같은 목록 쉼표는 그대로 둔다.
   * 화면에 보일 글(text)은 원문 그대로 둔다.
   */
  const s = 원문.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  // 분당·하루 속도 한도는 창도 답 길이도 아니다 — 거기서 뽑은 숫자는 한계가 아니다 (속도한도인가).
  if (속도한도인가(s)) return null;

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
  /*
   * 한국어 문장은 요청 수가 한계보다 **먼저** 오기도 한다 (2.0.0 6회차 · Gemini 백엔드5역).
   *
   *   컨텍스트 길이를 초과했습니다: 요청 15000 토큰, 최대 8192 토큰
   *
   * 아래 표의 한국어 줄은 「컨텍스트」 뒤 첫 숫자를 집어 15000 을 한계로 배웠다. 한계가 실제보다
   * 크니 줄여 다시 부르지 않고 같은 거절을 되풀이한다. 그래서 「최대·한도·한계·제한」 뒤 숫자를
   * 먼저 보고, 「요청」 뒤 숫자는 asked 로 둔다. 그런 말이 없으면 표의 옛 꼴로 간다.
   *
   * ── 그 낱말이 **넘긴 것의 이름**일 때 ────────────────────────────────
   *
   *   컨텍스트 한도 초과: 요청 15000 토큰, 최대 8192 토큰
   *
   * 여기 「한도」 는 한계를 가리키는 말이 아니라 **무엇을 넘겼는지**를 적은
   * 말이고, 그 뒤 첫 숫자는 한계가 아니라 우리가 요청한 값이다. 그런데 위
   * 규칙이 그 15000 을 한계로 집었다 — 위 문단이 막으려던 바로 그 틀림을
   * 낱말만 바꿔 되풀이한 셈이다 (8회차 뒷단-배우기). 대조군 「길이를
   * 초과했습니다」 는 그 낱말이 뒤에만 있어 처음부터 옳았다.
   *
   * 그래서 낱말과 숫자 **사이에 「요청」 이 끼면** 그 자리는 건너뛴다. 그러면
   * 정규식이 알아서 다음 자리(「최대 8192」)로 가서 옳은 수를 집는다.
   */
  if (/컨텍스트/.test(s)) {
    const 최대 = /(?:최대|한도|한계|제한)(?:(?!요청)[^\d]){0,12}(\d{3,})/.exec(s);
    /*
     * 요청 수는 「요청」 **앞**에 오기도 한다(`15000 토큰 요청, 최대 8192 토큰`). 뒤만 보면 「최대 8192」 의
     * 8192 를 집어 asked 가 limit 과 같아졌다 (6회차 Gemini 애저배움6 L5). 앞에 붙은 수를 먼저 본다.
     */
    const 요청 = /(\d{3,})\s*(?:토큰\s*)?요청|요청[^\d]{0,12}(\d{3,})/.exec(s);
    const limit = 성한수(최대?.[1]);
    if (limit) return { kind: 'ctx', limit, asked: 성한수(요청?.[1] ?? 요청?.[2]) ?? null, text: 짧게(원문) };
  }
  for (const re of ctx표) {
    const m = re.exec(s);
    if (!m) continue;
    const limit = 성한수(m[1]);
    if (!limit) continue;
    return { kind: 'ctx', limit, asked: 성한수(m[2]) ?? null, text: 짧게(원문) };
  }

  // ── 2) 답 길이 한계 ───────────────────────────────────────────────────

  /*
   * 「우리가 준 값 > 서버의 한계」 로 말하는 자리부터 본다.
   *
   * Anthropic 은 출력 상한을 이렇게 말한다 —
   *
   *   "max_tokens: 100000 > 64000, which is the maximum allowed number of
   *    output tokens for claude-x"
   *
   * 숫자가 둘인데 **앞이 우리가 요청한 값**이고 뒤가 한계다. 아래 표는 이름
   * 뒤의 첫 숫자를 집으므로, 그대로 두면 방금 거절당한 바로 그 값을 한계로
   * 배운다. 그러면 같은 값으로 곧장 다시 부르고 또 거절당하는데, 그때는 이미
   * 배운 뒤라 두 번은 못 배우고 턴이 죽는다(loop.js).
   *
   * (사냥5 확인) 여기에는 「배운 값은 연결저장() 으로 프로필에 적혀 다음에 켤 때도 똑같이
   * 죽는다」 고 적혀 있었다. 사실이 아니다 — loop.js 는 ctx.연결저장 이 있을 때만 부르는데
   * src 어디에서도 그 칸을 채우지 않는다. 배운 한계는 **그 연결(conn)이 사는 동안만** 간다.
   * 그러니 잘못 배운 피해는 그 실행 안에서 끝나지만, 맞게 배운 값도 다음 실행에서 다시
   * 거절당하고 다시 배운다. 적어 두려면 conn 을 쥔 쪽(repl.js)이 그 칸을 채워야 한다.
   *
   * 표보다 먼저 본다. 표에 한 번 걸리고 나면 되돌릴 자리가 없다.
   */
  const 넘김 = /max_(?:completion_)?tokens\s*[:=]?\s*(\d{3,})\s*>\s*(\d{3,})/i.exec(s);
  if (넘김) {
    const limit = 성한수(넘김[2]);
    if (limit) return { kind: 'out', limit, asked: 성한수(넘김[1]), text: 짧게(원문) };
  }

  /*
   * 「>」 없이 말로 넘었다고 하는 꼴 — `max_tokens 16384 exceeds the model limit of 4096`.
   * 아래 표의 `max_tokens[^\d]{0,40}(\d{3,})` 가 이름 뒤 첫 수(방금 거절당한 16384)를 한계로 배워, 같은 값으로
   * 곧장 다시 부르고 또 거절당했다 (6회차 Gemini 애저배움6 L2). 이름 뒤 수 다음에 넘음·한계 말과 **더 작은**
   * 수가 오면 그 작은 수가 한계다. 수가 하나뿐인 문장(`less than or equal to 8192`)은 여기 안 걸린다.
   *
   * 답 길이 칸의 이름은 규격마다 다르다 — llama.cpp 는 `n_predict`, Ollama 는 `num_predict`.
   * 이름 하나가 빠지면 그 서버에서만 이 갈래를 못 타고 맨 끝 짐작(작은 쪽이 한계)으로 떨어져
   * **답 길이 한계를 창 크기로** 배운다 (8회차 뒷단-배우기).
   */
  const 넘음말 = /(?:max_(?:completion_)?tokens|n(?:um)?_predict)[^\d]{0,20}(\d{3,})[^\d]{0,80}?(?:exceed|greater than|larger than|more than|above|limit|maximum|at most)[^\d]{0,40}(\d{3,})/i.exec(s);
  if (넘음말) {
    const 요청값 = 성한수(넘음말[1]);
    const limit = 성한수(넘음말[2]);
    if (limit && 요청값 && limit < 요청값) return { kind: 'out', limit, asked: 요청값, text: 짧게(원문) };
  }

  const out표 = [
    // "max_tokens is too large: 200000. This model supports at most 16384 completion tokens"
    /supports? at most\s+(\d+)\s*(?:completion\s*)?tokens?/i,
    // "max_tokens must be less than or equal to 8192"
    /max_(?:completion_)?tokens[^\d]{0,40}(\d{3,})/i,
    // Ollama 는 `num_predict`, llama.cpp 는 `n_predict` — 같은 칸의 두 이름이다.
    // 둘 중 하나만 적어 두면 그 서버에서만 아래 짐작으로 떨어져 창을 줄인다.
    /n(?:um)?_predict[^\d]{0,20}(\d{3,})/i,
    /*
     * 한국어로 옮긴 게이트웨이. `답` 은 **낱말로 설 때만** 본다 (사냥5 B5-04).
     *
     * `답` 한 글자에 걸었더니 「답변 생성 실패: 요청 ID 123456」 의 답변, 「응답 대기
     * 시간이 초과되었습니다 (60000ms)」 의 응답에 걸려 요청 번호와 밀리초를 출력 상한으로
     * 배웠다. 배운 값은 conn 에 적혀 그 대화 내내 답 길이를 엉뚱한 값으로 묶는다.
     * 앞뒤가 한글이면 다른 낱말의 한 조각이고, 숫자 뒤에 ms·초·분이 붙으면 시간이다.
     */
    /(?:최대\s*)?(?:출력|(?<![가-힣])답(?![가-힣]))[^\d]{0,20}(\d{3,})(?!\d|\s*(?:ms|밀리초|초|분|s\b))/,
  ];
  for (const re of out표) {
    const m = re.exec(s);
    if (!m) continue;
    const limit = 성한수(m[1]);
    if (!limit) continue;
    return { kind: 'out', limit, asked: null, text: 짧게(원문) };
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
      if (작은것 < 큰것) return { kind: 'ctx', limit: 작은것, asked: 큰것, text: 짧게(원문), 짐작: true };
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
  // 속도 한도는 창 이야기가 아니다 — 창을 반으로 줄여도 분당 한도는 안 움직인다 (속도한도인가).
  if (속도한도인가(s)) return false;
  return /context (?:length|size|window)|too (?:long|large|many tokens)|exceeds?[^.]{0,30}(?:context|limit|token)|max_tokens|token limit|컨텍스트|너무 (?:깁|많|큽)/i.test(s)
    // 아래는 서버마다 말이 달라 위 표에 안 잡히던 것들이다. 전부 실제 문장이다.
    //   TGI        "input length 41003 exceeds maximum 8192"
    //   llama.cpp  "context the overflows: 41003 > 8192"
    //   여러 곳     "prompt is too long" · "n_ctx" · "n_predict"
    || /overflow|input length|prompt (?:is )?too|exceeds?\s+maximum|n_ctx|n_predict|입력이 (?:너무|깁)/i.test(s);
}

/**
 * 분당·시간당·하루 **속도 한도** 문장인가 (사냥5 B5-03).
 *
 * 「Request too large for gpt-4o … on tokens per min (TPM): Limit 30000, Requested 45000」 은
 * 요청 한 번이 **분당 토큰 한도**보다 크다는 말이다. 「too large」 와 숫자 둘이 들어 있어서
 * 배울것 의 짐작 규칙(작은 쪽이 한계)에 그대로 걸렸고, 30,000 을 **창 크기**로 배워 128k
 * 창을 줄였다. 창을 줄여도 분당 한도는 안 움직이므로 같은 거절이 또 온다. 부르는 자리
 * (loop.js)가 429 를 걸러도, 이 함수가 그 문장을 창 이야기로 안 읽어야 새 부르는 자리에서도
 * 안전하다.
 */
export function 속도한도인가(message) {
  return /(?:tokens?|requests?)\s+per\s+(?:min(?:ute)?|hour|day)|\b(?:TPM|RPM|TPD|RPD|TPH)\b|rate[\s_-]?limit/i
    .test(String(message ?? ''));
}

function 짧게(s) {
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 200);
}
