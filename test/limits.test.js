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
    '',
    null,
  ]) {
    check(`안 배운다: ${String(아닌것).slice(0, 30) || '(빈 문장)'}`, 배울것(아닌것) === null, JSON.stringify(배울것(아닌것)));
  }

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

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n출력 상한 검사  ${D}(문서에 적힌 대로 실제로 먹는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
