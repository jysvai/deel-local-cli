// 출력 상한이 실제로 먹는가.
//
// 여기서 재는 것은 '숫자가 맞나' 가 아니라 **문서에 적힌 대로 동작하나** 다.
//
// 안 맞던 자리들:
//   1. /ctx out 200k 를 해도 16,384 였다. tokensFor 의 마지막 줄이
//      Math.min(cap, max ?? MAX_CAP, MAX_CAP) 였다 — 세 번째 인자가 무조건
//      다시 조여서, 사용자가 정한 값은 **낮출 수만 있고 올릴 수 없었다.**
//      그런데 주석도 README 도 /ctx 안내도 셋 다 '올릴 수 있다' 고 말했다.
//      기능이 없는 것보다 나쁘다 — 있다고 적혀 있으니 사람이 그걸 믿고 쓴다.
//
//   2. 잘렸을 때 다시 부르는 안전망이 큰 모델에서 꺼져 있었다. 아낀 상한과
//      풀어 준 상한이 둘 다 천장(16,384)에 닿으면 cap < full 이 거짓이 된다.
//      **큰 파일을 쓰는 바로 그 기계에서만** 안 걸렸다.
import { MAX_CAP, MIN_CAP, tokensFor, fullCap, wasCut } from '../src/agent/effort.js';
import { 배울것, 길이문제인가 } from '../src/backend/learn.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

trace('1-사용자가정한상한');

// ── 사용자가 정한 상한이 실제로 올라가는가 ──────────────────────────────
{
  const 방 = { ctx: 655360, used: 5000 };
  const 그냥 = tokensFor('save', 'work', 방);
  const 올린것 = tokensFor('save', 'work', { ...방, max: 200000 });
  check('상한을 안 정하면 모르는 값이라 MAX_CAP 에 선다', 그냥 === MAX_CAP, String(그냥));
  check('★ 상한을 올리면 실제로 올라간다', 올린것 > MAX_CAP, `${그냥} → ${올린것}`);
  check('올려도 남은 자리의 절반은 안 넘는다', 올린것 <= Math.floor((655360 - 5000) / 2), String(올린것));

  const 내린것 = tokensFor('save', 'work', { ...방, max: 2048 });
  check('상한을 내리면 내려간다', 내린것 === 2048, String(내린것));

  // 잘렸을 때 풀어 주는 쪽도 같아야 한다. 한쪽만 고치면 재시도가 무의미해진다.
  check('잘렸을 때 풀어 주는 값도 올라간다', fullCap({ ...방, max: 200000 }) > MAX_CAP, String(fullCap({ ...방, max: 200000 })));
}

trace('2-작은모델');

// ── 작은 모델에서 입력 자리를 안 뺏는가 ─────────────────────────────────
{
  // 컨텍스트가 4k 뿐인 모델. 여기에 4096 을 주면 입력이 하나도 안 들어간다.
  const 좁은곳 = tokensFor('save', 'work', { ctx: 4096, used: 3000 });
  check('좁으면 남은 자리의 절반을 넘지 않는다', 좁은곳 <= Math.floor((4096 - 3000) / 2) || 좁은곳 === MIN_CAP, String(좁은곳));
  check('그래도 도구 호출 하나는 낼 만큼 준다', 좁은곳 >= MIN_CAP, String(좁은곳));

  // 자리가 아예 없으면 최소값이라도.
  check('자리가 다 찼어도 0 을 주지 않는다', tokensFor('save', 'work', { ctx: 1000, used: 1000 }) === MIN_CAP, '');

  /*
   * ── ★★ 남은 자리보다 큰 상한을 부르면 안 된다 ────────────────────────
   *
   * 마지막 줄이 `Math.min(cap, Math.max(MIN_CAP, room))` 이었다. 울타리
   * 아래끝(512)을 한 번 더 깔고 있어서, 남은 자리가 100 이어도 512 가 나갔다.
   * 그런데 바로 그 줄에 붙은 주석은 「남은 자리 자체가 바닥이면 울타리
   * 아래라도 남은 만큼만 준다」 였다 — 주석만 고쳐진 자리다.
   *
   * 남은 자리보다 큰 max_tokens 를 받으면 게이트웨이는 답을 내는 대신
   * 400 을 낸다. 그러면 「자리가 모자란다」 가 「요청이 틀렸다」 로 보이고,
   * 접기로 풀 수 있던 자리에서 사람이 설정을 뒤진다.
   */
  const 바닥 = tokensFor('save', 'work', { ctx: 1000, used: 900 });
  check('★★ 남은 자리가 울타리보다 좁으면 남은 만큼만 준다', 바닥 <= 100, `남은 100 → ${바닥}`);
  check('★ 그래도 0 은 안 준다', 바닥 > 0, String(바닥));
  const 조금넓음 = tokensFor('save', 'work', { ctx: 1000, used: 700 });
  check('★ 남은 자리가 300 이면 300 을 안 넘는다', 조금넓음 <= 300, `남은 300 → ${조금넓음}`);
  // 넉넉한 자리에서는 여태처럼 울타리 아래끝을 지킨다 — 도구 호출 하나는 낼 수 있어야 한다.
  check('★ 넉넉하면 울타리 아래끝은 지킨다', tokensFor('save', 'work', { ctx: 8000, used: 0 }) >= MIN_CAP,
    String(tokensFor('save', 'work', { ctx: 8000, used: 0 })));

  /*
   * ★ 0 이나 숫자 아닌 상한은 「모른다」 로 읽는다 (사냥5 L5-6).
   *
   * 설정에서 maxTokens 0 이 흘러오면 여태 `max ?? MAX_CAP` 가 0 을 그대로 받아 상한이
   * 바닥(MIN_CAP)에 붙었고, NaN 이면 셈 전체가 NaN 이 되어 요청의 max_tokens 가
   * 비었다. 값을 거르는 것은 설정 쪽 몫이지만, 여기서도 모르는 값으로 물러선다.
   */
  const 넉넉 = { ctx: 655360, used: 5000 };
  check('★ 상한 0 은 안 정한 것과 같다', tokensFor('save', 'work', { ...넉넉, max: 0 }) === tokensFor('save', 'work', 넉넉)
    && fullCap({ ...넉넉, max: 0 }) === fullCap(넉넉), String(tokensFor('save', 'work', { ...넉넉, max: 0 })));
  check('★ 숫자 아닌 상한도 안 정한 것과 같다', tokensFor('save', 'work', { ...넉넉, max: Number.NaN }) === tokensFor('save', 'work', 넉넉)
    && fullCap({ ...넉넉, max: Number.NaN }) === fullCap(넉넉), String(tokensFor('save', 'work', { ...넉넉, max: Number.NaN })));
}

trace('3-단계별로다른가');

// ── 단계마다 상한이 실제로 다른가 ───────────────────────────────────────
//
// /think 표에 단계별 출력상한 칸이 있는데 세 줄이 전부 같은 값이었다.
// 천장에 다 같이 닿아 있어서였다. 상한을 알면 그 칸이 비로소 뜻을 갖는다.
{
  // 아는 상한이 넉넉할 때라야 단계별 차이가 드러난다. 상한이 낮으면 셋 다 거기 닿는다 —
  // 그때 표의 세 줄이 같아 보이는 것은 잘못이 아니라 사실이다.
  const 방 = { ctx: 200000, used: 4000, max: 200000 };
  const p = tokensFor('save', 'plan', 방);
  const w = tokensFor('save', 'work', 방);
  const f = tokensFor('save', 'fix', 방);
  check('첫 판단과 이어가기의 상한이 다르다', p !== w, `첫 판단 ${p} · 이어가기 ${w}`);
  check('막혔을 때가 가장 넉넉하다', f >= p && f >= w, `막혔을 때 ${f}`);
  // 상한이 낮으면 셋이 같아지는 것이 맞다. 그걸 '고장' 으로 읽지 않게 같이 못 박는다.
  const 좁을때 = { ctx: 200000, used: 4000, max: 8192 };
  check('상한이 낮으면 세 단계가 같아지는 것이 맞다',
    tokensFor('save', 'plan', 좁을때) === 8192 && tokensFor('save', 'work', 좁을때) === 8192, '셋 다 8192');

  // 이어가기가 파일을 쓰는 자리다. 여기가 좁으면 큰 파일이 안 만들어진다.
  // 32k 모델에서 1,000줄 HTML(약 12,000토큰)을 한 번에 담을 수 있어야 한다.
  const 좁은모델 = tokensFor('save', 'work', { ctx: 32768, used: 2500 });
  check('★ 32k 모델에서도 이어가기에 1만 토큰은 준다', 좁은모델 >= 10000, `${좁은모델} 토큰`);
}

trace('4-잘림알아채기');

// ── 잘린 것을 알아채는가 ────────────────────────────────────────────────
{
  check('length 는 잘린 것이다', wasCut({ stopped: 'length' }), '');
  check('MAX_TOKENS 도 잘린 것이다', wasCut({ stopped: 'MAX_TOKENS' }), '');
  // 게이트웨이가 잘라 놓고 stop 이라고 말하는 경우. 인자 JSON 이 깨진 것 자체가 증거다.
  check('★ stop 이라고 해도 인자가 깨졌으면 잘린 것이다',
    wasCut({ stopped: 'stop', toolCalls: [{ argsBroken: true }] }), '');
  check('멀쩡한 답은 잘린 게 아니다', !wasCut({ stopped: 'stop', toolCalls: [{ name: 'Read' }] }), '');
  check('도구를 안 부른 답도 잘린 게 아니다', !wasCut({ stopped: 'stop' }), '');
}

trace('5-큰모델에서재시도');

// ── 큰 모델에서도 재시도가 걸리는가 ─────────────────────────────────────
//
// 이건 loop.js 의 조건을 그대로 옮겨 재는 것이다.
// 전에는 full > cap 하나뿐이었고, 천장에 닿으면 그게 거짓이라 안 걸렸다.
{
  const 재시도하나 = (room, level) => {
    const cap = tokensFor('save', 'work', room);
    const full = Math.max(cap, fullCap(room));
    const 낮춘 = level === 'off' || level === 'low' ? level : 'low';
    return { 건다: full > cap || 낮춘 !== level, cap, full };
  };

  const 큰모델 = 재시도하나({ ctx: 655360, used: 5000 }, 'medium');
  check('★ 655k 모델에서도 잘리면 다시 부른다', 큰모델.건다, `상한 ${큰모델.cap} → ${큰모델.full}`);

  const 작은모델 = 재시도하나({ ctx: 32768, used: 2000 }, 'medium');
  check('32k 모델에서도 다시 부른다', 작은모델.건다, `상한 ${작은모델.cap} → ${작은모델.full}`);

  // 생각이 이미 꺼져 있고 상한도 천장이면 다시 부를 이유가 없다 — 같은 결과가 나온다.
  const 더할게없음 = 재시도하나({ ctx: 655360, used: 5000 }, 'off');
  check('더 할 수 있는 게 없으면 헛되이 다시 부르지 않는다', !더할게없음.건다,
    `상한 ${더할게없음.cap} → ${더할게없음.full}`);
}

trace('6-서버에게배우기');

// ── 거절 문장에서 숫자를 뽑아내는가 ─────────────────────────────────────
//
// 이게 이번 작업에서 가장 넓게 통하는 방법이다. 규격을 하나하나 아는 방식으로는
// 새 서버를 영영 못 따라가지만, **거절할 때 하는 말**은 어느 서버나 한다.
{
  const 표 = [
    ["This model's maximum context length is 8192 tokens, however you requested 41003 tokens (33003 in the messages, 8000 in the completion).",
      { kind: 'ctx', limit: 8192, asked: 41003 }],
    ["This model's maximum context length is 4096 tokens. However, you requested 5000 tokens.",
      { kind: 'ctx', limit: 4096, asked: 5000 }],
    ['max_tokens is too large: 200000. This model supports at most 16384 completion tokens',
      { kind: 'out', limit: 16384 }],
    ['`max_tokens` must be less than or equal to 8192',
      { kind: 'out', limit: 8192 }],
    ['요청이 최대 컨텍스트 32768 을 넘었습니다',
      { kind: 'ctx', limit: 32768 }],

    /*
     * ── 로컬 호스팅 서버들 ─────────────────────────────────────────────
     *
     * 여기가 실제로 아팠던 자리다. 위의 OpenAI 문장만 읽을 줄 알았고,
     * 정작 로컬에서 많이 쓰는 서버들은 **하나도 못 읽었다.**
     *
     *   TGI · llama.cpp   → 아무것도 못 배우고 답도 못 받음
     *   vLLM · KoboldCpp  → 8,192 인데 20,501(그냥 절반)로 틀리게 배움
     *
     * 서버가 정답을 그대로 말해 주는데 그걸 못 읽고 있었던 것이다.
     */
    ['Requested tokens (41003) exceed context window of 8192',
      { kind: 'ctx', limit: 8192 }],                                  // vLLM
    ['input length 41003 exceeds maximum 8192',
      { kind: 'ctx', limit: 8192, asked: 41003 }],                    // TGI
    ['the number of tokens to keep from the initial prompt is greater than n_ctx (8192)',
      { kind: 'ctx', limit: 8192 }],                                  // llama.cpp
    ['context the overflows: 41003 > 8192',
      { kind: 'ctx', limit: 8192, asked: 41003 }],                    // llama.cpp
    ['Prompt is too long: 41003 > 8192 tokens',
      { kind: 'ctx', limit: 8192, asked: 41003 }],                    // KoboldCpp
  ];
  for (const [문장, 나올것] of 표) {
    const r = 배울것(문장);
    const 맞나 = r && r.kind === 나올것.kind && r.limit === 나올것.limit
      && (나올것.asked === undefined || r.asked === 나올것.asked);
    check(`배운다: ${문장.slice(0, 46)}…`, 맞나, JSON.stringify(r));
  }

  // 엉뚱한 오류에서 숫자를 지어내면 안 된다. 그게 더 나쁘다.
  for (const 아닌것 of [
    'Invalid API key provided',
    'model not found: qwen3',
    'Internal server error',
    // 숫자가 둘 이상 들어 있는데 길이와 상관없는 것들. 모르는 서버용 마지막 수가
    // 여기서 숫자를 집어 오면, 멀쩡한 컨텍스트를 엉뚱한 값으로 줄여 버린다.
    'CUDA out of memory. Tried to allocate 2048 MiB (GPU 0; 24576 MiB total)',
    'rate limited, retry after 30 seconds (limit 60 per minute)',
    'HTTP 503 upstream connect error, 2 of 3 backends unhealthy',
    '',
    null,
  ]) {
    check(`안 배운다: ${String(아닌것).slice(0, 30) || '(빈 문장)'}`, 배울것(아닌것) === null, JSON.stringify(배울것(아닌것)));
  }

  /*
   * 출력 한계를 컨텍스트 한계로 잘못 배우면 안 된다.
   *
   * 모르는 서버용 마지막 수(숫자 둘 중 작은 쪽)를 표보다 **먼저** 두면 이게
   * 깨진다. `max_tokens is too large: 200000 … at most 16384` 에서 16384 를
   * 집어 컨텍스트를 16,384 로 줄여 버린다. 창은 멀쩡한데 창을 줄이는 것이다.
   */
  for (const [문장, 갈래] of [
    ['max_tokens is too large: 200000. This model supports at most 16384 completion tokens', 'out'],
    ['max_completion_tokens must be less than or equal to 8192, got 32000', 'out'],
    ['Requested tokens (41003) exceed context window of 8192', 'ctx'],
  ]) {
    check(`갈래를 안 헷갈린다 (${갈래}): ${문장.slice(0, 34)}…`,
      배울것(문장)?.kind === 갈래, JSON.stringify(배울것(문장)));
  }

  // 한계와 요청이 같으면 무엇을 집은 건지 알 수 없다. 그때는 안 배운다.
  check('숫자가 하나뿐이면 짐작 안 한다', 배울것('too long: 8192 > 8192') === null,
    JSON.stringify(배울것('too long: 8192 > 8192')));

  // 숫자를 못 뽑아도 '길어서' 인 것은 알아야 한다. 그때는 줄여서 다시 해 본다.
  check('숫자가 없어도 길이 문제인 줄은 안다',
    길이문제인가('the request exceeds the available context size, try increasing the context size'), '');
  check('길이와 상관없는 오류는 아니라고 한다', !길이문제인가('Invalid API key provided'), '');
}

trace('7-루프가배워서다시부르기');

// ── 실제로 배워서 다시 부르는가 (사용자는 실패를 안 본다) ───────────────
{
  const { createServer } = await import('node:http');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { makeScope } = await import('../src/safety/guard.js');
  const { History } = await import('../src/safety/undo.js');
  const { Audit } = await import('../src/safety/audit.js');
  const { Session } = await import('../src/agent/session.js');
  const { run } = await import('../src/agent/loop.js');
  const { allowEndpoint, resetNet } = await import('../src/safety/network.js');

  const 방 = mkdtempSync(join(tmpdir(), 'deel-learn-'));
  const 진짜한계 = 8192;
  let 부른횟수 = 0;
  const 받은것 = [];

  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: '가짜' }] }));
      }
      부른횟수++;
      const 요청 = JSON.parse(body || '{}');
      받은것.push(요청.max_tokens);
      // 서버가 실제로 하는 일: 컨텍스트를 넘겼으면 400 과 함께 정답을 알려 준다.
      // (여기서는 상한만 봐도 넘겼는지 알 수 있게 꾸민다)
      if ((요청.max_tokens ?? 0) > 진짜한계 / 2) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          error: {
            message: `This model's maximum context length is ${진짜한계} tokens, however you requested 41003 tokens.`,
            type: 'invalid_request_error',
          },
        }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '했습니다.' } }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  allowEndpoint(base);

  // 컨텍스트를 655,360 이라고 잘못 알고 시작한다 — 서버는 8,192 만 받는다.
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: '가짜', ctx: 655360, streaming: false, tools: true };
  const ctx = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set() };
  const session = new Session(conn, { root: 방, think: 'off' });

  const evs = [];
  for await (const e of run(session, ctx, '한 줄만 답해줘')) evs.push(e);

  const 배움 = evs.find((e) => e.type === 'learned');
  check('★ 거절당하면 그 말에서 한계를 배운다', 배움?.limit === 진짜한계, JSON.stringify(배움));
  check('★ 배운 값을 곧바로 반영한다', conn.ctx === 진짜한계, String(conn.ctx));
  check('★ 사용자는 실패를 안 본다', !evs.some((e) => e.type === 'error') && evs.some((e) => e.type === 'done'),
    evs.map((e) => e.type).join(','));
  check('다시 부를 때는 줄어든 상한으로 보낸다', 받은것.at(-1) < 받은것[0], `${받은것[0]} → ${받은것.at(-1)}`);

  srv.close();
  rmSync(방, { recursive: true, force: true });
  resetNet();
}

/*
 * ── 「답」 은 응답·답변 안에도 있다 (사냥5 B5-04) ──────────────────────
 *
 * 한국어 출력 한계 표가 `답` 한 글자에 걸렸다. 그래서 「답변 생성 실패: 요청 ID
 * 123456」 에서 출력 상한 123,456 을, 「응답 대기 시간이 초과되었습니다 (60000ms)」
 * 에서 60,000 을 배웠다. 요청 번호와 밀리초는 한계가 아니다.
 */
{
  const 요청번호 = 배울것('답변 생성 실패: 요청 ID 123456');
  check('★★ 「답변 … 요청 ID 123456」 에서 출력 한계를 배우지 않는다', 요청번호 === null, JSON.stringify(요청번호));
  const 밀리초 = 배울것('응답 대기 시간이 초과되었습니다 (60000ms)');
  check('★★ 「응답 대기 … (60000ms)」 에서 출력 한계를 배우지 않는다', 밀리초 === null, JSON.stringify(밀리초));
  const 진짜 = 배울것('최대 출력 토큰은 4096 입니다');
  check('★ 한국어로 적은 진짜 출력 한계는 여전히 배운다', 진짜?.kind === 'out' && 진짜?.limit === 4096, JSON.stringify(진짜));
  const 답길이 = 배울것('답 길이는 최대 8192 토큰까지입니다');
  check('  「답 길이」 로 적은 것도 배운다', 답길이?.kind === 'out' && 답길이?.limit === 8192, JSON.stringify(답길이));
}

/*
 * ── 분당·하루 한도는 창 크기가 아니다 (사냥5 B5-03) ────────────────────────
 *
 * 「Request too large for gpt-4o … on tokens per min (TPM): Limit 30000, Requested 45000」 은
 * **요청 한 번이 분당 토큰 한도보다 크다**는 말이다. 여기서 숫자 둘을 뽑아 작은 쪽을 창
 * 크기로 배우면, 128k 창이 30,000 으로 줄고 대화가 까닭 없이 접힌다. 부르는 자리(loop.js)가
 * 막아도, 배우는 함수 자체가 이 문장을 창 이야기로 읽지 않아야 새 부르는 자리에서도 안전하다.
 */
{
  const 분당 = 'Request too large for gpt-4o in organization org-abc on tokens per min (TPM): Limit 30000, Requested 45000. The input or output tokens must be reduced in order to run successfully.';
  check('★★ 「tokens per min (TPM): Limit 30000, Requested 45000」 을 창 크기로 배우지 않는다', 배울것(분당) === null, JSON.stringify(배울것(분당)));
  check('★★ 그 문장을 「창이 길어서」 로 치지 않는다 — 창을 반으로 줄이는 길로 안 보낸다', 길이문제인가(분당) === false, String(길이문제인가(분당)));
  const 요청수 = 'Rate limit reached for gpt-4o on requests per min (RPM): Limit 500, Used 500, Requested 1. Please try again in 120ms.';
  check('★ 요청 수 한도(RPM)도 배우지 않는다', 배울것(요청수) === null && 길이문제인가(요청수) === false, JSON.stringify(배울것(요청수)));
  const 하루 = 'Request too large: tokens per day (TPD): Limit 2000000, Used 1999000, Requested 40960';
  check('★ 하루 한도(TPD)도 배우지 않는다', 배울것(하루) === null && 길이문제인가(하루) === false, JSON.stringify(배울것(하루)));
  const 창 = "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.";
  check('  진짜 창 한계는 여전히 배운다', 배울것(창)?.kind === 'ctx' && 배울것(창)?.limit === 128000, JSON.stringify(배울것(창)));
  const 짐작 = 'input length 41003 exceeds maximum 8192';
  check('  모르는 서버의 길이 문장도 여전히 짐작해 배운다', 배울것(짐작)?.limit === 8192 && 길이문제인가(짐작) === true, JSON.stringify(배울것(짐작)));
  // 표에 걸리는 낱말(max_tokens)이 섞여도 속도 한도 문장이면 배우지 않는다 — 표보다 먼저 거른다.
  const 섞임 = 'rate_limit_error: max_tokens 8192 exceeds your tokens per minute budget';
  check('★ 속도 한도 문장에 max_tokens 가 섞여도 출력 상한으로 배우지 않는다', 배울것(섞임) === null, JSON.stringify(배울것(섞임)));
}

// ── 6회차 Gemini 애저배움6 — 숫자를 엉뚱한 자리에서 집던 문장들 ─────────
trace('8-애저배움6');
{
  // L1 · 천 단위 쉼표. 표에 안 걸리고 맨 끝 「작은 쪽」 으로 떨어져 괄호 속 30,000 을 창으로 배웠다.
  const 쉼표 = "This model's maximum context length is 128,000 tokens, however you requested 130,000 tokens (100,000 in the messages, 30,000 in the completion).";
  const 쉼표것 = 배울것(쉼표);
  check('★ 천 단위 쉼표가 든 창 한계도 128000 으로 배운다 (30,000 이 아니라)',
    쉼표것?.kind === 'ctx' && 쉼표것?.limit === 128000 && 쉼표것?.asked === 130000 && !쉼표것?.짐작, JSON.stringify(쉼표것));
  check('  화면에 보일 글은 원문 그대로다', String(쉼표것?.text ?? '').includes('128,000'), String(쉼표것?.text));

  // L2 · 「max_tokens N exceeds … limit of M」 — 앞이 요청한 값이다. 이름 뒤 첫 수를 한계로 배우면 같은 값으로 또 거절당한다.
  const 넘음말 = 'max_tokens 16384 exceeds the model limit of 4096';
  const 넘음것 = 배울것(넘음말);
  check('★ 「max_tokens 16384 exceeds the model limit of 4096」 은 4096 을 출력 한계로 배운다',
    넘음것?.kind === 'out' && 넘음것?.limit === 4096 && 넘음것?.asked === 16384, JSON.stringify(넘음것));
  const 이하 = 배울것('max_tokens must be less than or equal to 8192');
  check('  수가 하나뿐인 「less than or equal to 8192」 는 그대로 8192', 이하?.kind === 'out' && 이하?.limit === 8192, JSON.stringify(이하));

  // L5 · 요청 수가 「요청」 앞에 온다. 뒤만 보면 「최대 8192」 를 집어 asked 가 limit 과 같아졌다.
  const 앞요청 = 배울것('컨텍스트 길이를 초과했습니다: 15000 토큰 요청, 최대 8192 토큰');
  check('★ 요청 수가 「요청」 앞에 와도 asked 는 15000', 앞요청?.limit === 8192 && 앞요청?.asked === 15000, JSON.stringify(앞요청));
  const 뒤요청 = 배울것('컨텍스트 길이를 초과했습니다: 요청 15000 토큰, 최대 8192 토큰');
  check('  「요청 15000 토큰」 꼴도 그대로', 뒤요청?.limit === 8192 && 뒤요청?.asked === 15000, JSON.stringify(뒤요청));
}

// ═══════════════════════════════════════════════════════════════════════
// 8회차 뒷단-배우기 — 거절 문장에서 **무엇을** 배우느냐
trace('9-뒷단배우기');
{
  /*
   * ── 「한도」 가 한계를 가리키는 말이 아닐 때 ──────────────────────────
   *
   *   컨텍스트 한도 초과: 요청 15000 토큰, 최대 8192 토큰
   *
   * 여기서 「한도」 는 **무엇을 넘겼는지**를 적은 말이고, 그 뒤에 오는 숫자는
   * 한계가 아니라 우리가 요청한 값이다. 그런데 「최대·한도·한계·제한 뒤 첫
   * 숫자」 규칙이 그 15000 을 한계로 집었다. 한계를 실제보다 크게 배우면
   * 줄여서 다시 부르지 않고 **같은 거절을 되풀이한다** — 못 배운 것보다 나쁘다.
   * 대조군(「길이를 초과했습니다」)은 처음부터 8192 로 옳았다.
   */
  for (const 문장 of [
    '컨텍스트 한도 초과: 요청 15000 토큰, 최대 8192 토큰',
    '컨텍스트 제한 초과: 요청 15000 토큰, 최대 8192 토큰',
    '컨텍스트 한계 초과 — 요청 15000 토큰, 최대 8192 토큰',
  ]) {
    const r = 배울것(문장);
    check(`★★ 「${문장.slice(0, 12)}…」 에서 한계는 8192 (요청값 15000 이 아니라)`,
      r?.kind === 'ctx' && r.limit === 8192 && r.asked === 15000, JSON.stringify(r));
  }
  // 대조군 — 「최대·한도」 가 진짜로 한계를 가리키는 자리는 그대로 배운다.
  for (const [문장, 한계] of [
    ['컨텍스트 길이를 초과했습니다: 요청 15000 토큰, 최대 8192 토큰', 8192],
    ['최대 컨텍스트 8192 토큰을 넘었습니다', 8192],
    ['요청이 최대 컨텍스트 32768 을 넘었습니다', 32768],
    ['컨텍스트 한도는 8192 토큰입니다', 8192],
  ]) {
    const r = 배울것(문장);
    check(`  대조군 「${문장.slice(0, 14)}…」 → ${한계}`, r?.kind === 'ctx' && r.limit === 한계, JSON.stringify(r));
  }

  /*
   * ── llama.cpp 의 `n_predict` 는 **답 길이**다 ─────────────────────────
   *
   * out표에 `num_predict`(Ollama)만 있고 `n_predict`(llama.cpp)가 없었다.
   * 그러면 이 문장이 표를 다 지나쳐 맨 끝 「길이 문제면 작은 쪽이 한계」 로
   * 떨어지고, 답 길이 한계를 **창 크기**로 배운다 — 멀쩡한 창을 4,096 으로
   * 줄인다. 219줄의 `길이문제인가` 는 이미 `n_predict` 를 안다.
   */
  const np1 = 배울것('n_predict 16384 exceeds maximum allowed 4096');
  check('★★ 「n_predict 16384 exceeds maximum allowed 4096」 은 출력 한계 4096 으로 배운다',
    np1?.kind === 'out' && np1.limit === 4096 && np1.asked === 16384, JSON.stringify(np1));
  const np2 = 배울것('n_predict must be at most 4096');
  check('★ 수가 하나뿐인 n_predict 문장도 출력 한계로 배운다',
    np2?.kind === 'out' && np2.limit === 4096, JSON.stringify(np2));
  const np3 = 배울것('num_predict 4096 is the maximum');
  check('  Ollama 이름(num_predict)은 하던 그대로', np3?.kind === 'out' && np3.limit === 4096, JSON.stringify(np3));
  // 창 이야기는 여전히 창이다 — 이름 하나 늘렸다고 갈래가 뒤집히면 안 된다.
  const nc = 배울것('the number of tokens to keep from the initial prompt is greater than n_ctx (8192)');
  check('  n_ctx 는 그대로 창 한계', nc?.kind === 'ctx' && nc.limit === 8192, JSON.stringify(nc));
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n출력 상한 검사  ${D}(문서에 적힌 대로 실제로 먹는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
{
  // 6회차 Gemini 백엔드5역 — 한국어 문장에 요청 수가 한계보다 먼저 오면 요청 수를 한계로 배웠다.
  const { 배울것: 배움 } = await import('../src/backend/learn.js');
  const a = 배움('컨텍스트 길이를 초과했습니다: 요청 15000 토큰, 최대 8192 토큰');
  check('★ 한국어 — 요청 수가 앞에 와도 한계는 최대 뒤 숫자', a?.kind === 'ctx' && a.limit === 8192 && a.asked === 15000, JSON.stringify(a));
  const b = 배움('최대 컨텍스트 8192 토큰을 넘었습니다');
  check('  한국어 옛 꼴은 그대로', b?.kind === 'ctx' && b.limit === 8192, JSON.stringify(b));
}

console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
