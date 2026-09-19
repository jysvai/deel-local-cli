// 겪어 본 버릇이 **하네스를 실제로 바꾸는가.**
//
// ── 왜 이걸 재나 ────────────────────────────────────────────────────────
//
// 다른 도구들은 프론티어 모델을 전제한다. 이 자리 로컬 모델은 사정이 다르다 —
// 2026년 재기들이 문서로 남긴 것만 봐도 이렇다.
//
//   · 도구를 불러야 할 때와 아닐 때를 26.5~54% 헷갈린다 (3B~8B)
//   · 7B 는 2~3걸음 뒤 일관성이 무너진다
//   · 오류에서 회복할 때 같은 호출을 되풀이하거나 퇴행 루프에 빠진다
//
// deel 은 이미 이런 것을 지켜보고 있었다(grade.js). 그런데 지켜보기만 하고
// **말로만** 넘겼다 — "인자를 자주 잘라 먹었으니 Append 를 써라" 하고 프롬프트에
// 적는 것이 전부였다. 작은 모델은 그 말을 잘 안 듣는다. 그게 작은 모델이다.
//
// 카드는 다르다. 겪은 것을 **하네스 설정으로** 바꾼다. 모델에게 부탁하는 대신
// deel 이 제 행동을 바꾼다. 여기서 재는 것은 그 한 가지다 —
// **겪은 것이 숫자로 바뀌어 실제 동작을 움직이는가.**
import { 카드, 기본조정 } from '../src/agent/card.js';
import { 지켜본것 } from '../src/agent/grade.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 본것만들기 = (걸음, 무엇 = {}) => {
  const v = new 지켜본것();
  v.걸음 = 걸음;
  for (const [k, n] of Object.entries(무엇)) v[k] = n;
  return v;
};

trace('1-겪은게없으면');

// ── 겪은 것이 없으면 아무것도 안 바꾼다 ─────────────────────────────────
//
// 이게 제일 중요하다. 몇 걸음 안 걸어 보고 하네스를 바꾸면, 우연히 한 번
// 잘린 것 때문에 멀쩡한 모델을 붙들어 매게 된다. 안 배우느니만 못하다.
{
  const c = 카드('어떤모델', null, null);
  check('겪은 것이 없으면 기본값 그대로', JSON.stringify(c.조정) === JSON.stringify(기본조정()),
    JSON.stringify(c.조정));
  check('바꾼 이유도 없다', c.왜.length === 0, JSON.stringify(c.왜));
  check('그래도 안 죽는다', typeof c.모델 === 'string' && c.걸음 === 0);

  const 조금 = 카드('m', 본것만들기(4, { 잘린인자: 3 }), null);
  check('걸음이 적으면 아직 안 바꾼다', JSON.stringify(조금.조정) === JSON.stringify(기본조정()),
    `걸음 4 · 잘림 3 → ${JSON.stringify(조금.조정)}`);
}

trace('2-인자가잘리면');

// ── 인자가 자주 잘리면 상한을 먼저 올린다 ───────────────────────────────
//
// 인자 JSON 이 중간에서 끊긴다는 것은 답이 출력 상한에 닿았다는 뜻이다.
// 지금은 잘린 뒤에야 상한을 올려 다시 부른다 — 한 번은 반드시 버린다.
// 잘리는 것이 이 모델의 버릇이라면, 처음부터 넉넉히 주는 편이 싸다.
{
  const c = 카드('m', 본것만들기(40, { 잘린인자: 9 }), null);
  check('잘림이 잦으면 상한을 먼저 올린다', c.조정.상한먼저올리기 === true,
    `잘림 ${9}/40 = ${(9 / 40 * 100).toFixed(0)}%`);
  check('왜 바꿨는지 남긴다', c.왜.some((w) => /잘/.test(w)), JSON.stringify(c.왜));

  const 가끔 = 카드('m', 본것만들기(40, { 잘린인자: 2 }), null);
  check('가끔 잘리는 것으로는 안 바꾼다', 가끔.조정.상한먼저올리기 === false,
    `${2}/40 = 5%`);
}

trace('3-되풀이하면');

// ── 같은 것을 되풀이하면 더 일찍 끊는다 ─────────────────────────────────
//
// 되풀이는 걸음만 태우는 것이 아니다. 되풀이한 만큼 컨텍스트가 차고, 그만큼
// 요약이 빨리 온다. 되풀이가 버릇인 모델에서는 세 번까지 봐 줄 이유가 없다.
{
  const c = 카드('m', 본것만들기(30, { 되풀이: 8 }), null);
  check('되풀이가 잦으면 한계를 좁힌다', c.조정.같은것한계 < 기본조정().같은것한계,
    `${기본조정().같은것한계} → ${c.조정.같은것한계}`);
  check('그래도 두 번은 봐 준다 — 한 번에 끊으면 정상 재시도가 막힌다',
    c.조정.같은것한계 >= 2, String(c.조정.같은것한계));
  check('왜 바꿨는지 남긴다', c.왜.some((w) => /되풀이|반복/.test(w)), JSON.stringify(c.왜));
}

trace('4-편집이빗나가면');

// ── Edit 이 자주 빗나가면 더 넓게 보여 준다 ─────────────────────────────
{
  const c = 카드('m', 본것만들기(30, { 편집실패: 7 }), null);
  check('편집이 잦게 빗나가면 더 넓게 보여 준다', c.조정.빗나갔을때보일줄 > 기본조정().빗나갔을때보일줄,
    `${기본조정().빗나갔을때보일줄} → ${c.조정.빗나갔을때보일줄}`);
  check('왜 바꿨는지 남긴다', c.왜.some((w) => /Edit|편집/.test(w)), JSON.stringify(c.왜));
}

trace('5-지난세션것을이어받는다');

// ── 지난번에 알아낸 것도 같이 본다 ──────────────────────────────────────
//
// 이번 대화에서 세 걸음 걸었는데 지난 대화에서 백 걸음을 걸었다면, 그 백 걸음이
// 더 믿을 만하다. 켤 때마다 처음부터 다시 겪지 않는 것이 이 기능의 값이다.
{
  const 겪은것 = { 걸음: 120, 잘린인자: 30, 되풀이: 4, 편집실패: 3, 보정: 1.15 };
  const c = 카드('m', 본것만들기(2, {}), 겪은것);
  check('지난 세션 걸음도 함께 센다', c.걸음 >= 120, `${c.걸음}걸음`);
  check('지난 세션 버릇으로도 하네스를 바꾼다', c.조정.상한먼저올리기 === true,
    `잘림 30/122`);
  check('토큰 배수도 카드에 실린다', Math.abs(c.보정 - 1.15) < 0.01, String(c.보정));

  // 이번 대화가 지난번과 다르면 이번 것이 더 무겁다 — 모델을 바꿨을 수 있다.
  const 이번엔멀쩡 = 카드('m', 본것만들기(60, {}), 겪은것);
  check('겪은 것을 합쳐서 본다', 이번엔멀쩡.걸음 === 180, `${이번엔멀쩡.걸음}걸음`);
}

trace('6-사람이보는것');

// ── 화면에 뿌릴 수 있는 모양인가 ────────────────────────────────────────
{
  const c = 카드('qwen2.5-coder:7b', 본것만들기(50, { 잘린인자: 12, 되풀이: 9 }), { 걸음: 0, 보정: 1.2 });
  check('무슨 모델인지 적힌다', c.모델 === 'qwen2.5-coder:7b');
  check('버릇을 비율로 알려 준다', c.버릇.잘린인자.율 > 0 && c.버릇.잘린인자.n === 12,
    JSON.stringify(c.버릇.잘린인자));
  check('바꾼 것이 둘 이상이면 이유도 둘 이상', c.왜.length >= 2, JSON.stringify(c.왜));
  check('이유는 사람 말로 적힌다', c.왜.every((w) => typeof w === 'string' && w.length > 5));
}

trace('6b-바꿔놓고-안바꿨다고-말하지-않는다');

/*
 * ── ★★ 이미 바꿔 놓고 「아직 판단하지 않습니다」 라고 하면 안 된다 ──────
 *
 * 내장 카드(agent/preset.js)는 최소걸음 관문 **앞**에 선다 — 겪어서 아는 것이
 * 아니라 공개 문서로 아는 것이라 걸음 수와 무관하게 참이기 때문이다. 그래서
 * 추론형 모델은 한 걸음도 안 걸은 채로 이미 상한먼저올리기 가 켜져 있다.
 *
 * 그런데 `아직모름` 이 걸음 수만 보고 참이었다. /card 화면은 아직모름 이면
 * 「그래서 바꾼 것」 자리에 왜 를 통째로 감추고 「아직 판단하지 않습니다」 만
 * 찍는다(commands/work.js). **바꿔 놓고 안 바꿨다고 말하는 화면**이다 —
 * 그 화면 하나 보자고 만든 값이 거짓말을 하면 안 보여 주느니만 못하다.
 *
 * `아직모름` 이 답할 물음은 「지금 판단을 미루고 있나」 다. 이미 바꾼 것이
 * 있으면 미루고 있는 것이 아니다.
 */
{
  const 추론형 = 카드('exaone-deep:7.8b', null, null);
  check('먼저: 걸음 없이도 하네스가 이미 바뀌어 있다', 추론형.조정.상한먼저올리기 === true,
    JSON.stringify(추론형.조정));
  check('먼저: 사유도 이미 적혀 있다', 추론형.왜.length >= 1, JSON.stringify(추론형.왜));
  check('★★ 바꾼 것이 있으면 「아직 모름」 이 아니다', 추론형.아직모름 === false,
    `걸음 ${추론형.걸음} · 왜 ${추론형.왜.length}개 · 아직모름 ${추론형.아직모름}`);

  // 정말로 아무것도 안 바꾼 자리는 여태 그대로 「아직 모름」 이다.
  const 모르는것 = 카드('mystery-model', 본것만들기(3, { 잘린인자: 2 }), null);
  check('★ 바꾼 것이 없으면 그대로 「아직 모름」', 모르는것.아직모름 === true
    && 모르는것.왜.length === 0, `왜 ${JSON.stringify(모르는것.왜)}`);

  // 걸음이 찬 뒤에는 바꾼 것이 없어도 「아직 모름」 이 아니다 — '바꾼 것 없음' 과는 다른 말이다.
  const 멀쩡 = 카드('mystery-model', 본것만들기(30, {}), null);
  check('★ 걸음이 차면 바꾼 것이 없어도 판단은 한 것이다',
    멀쩡.아직모름 === false && 멀쩡.왜.length === 0, `아직모름 ${멀쩡.아직모름}`);
}

trace('6c-걸음관문은-하한이다');

/*
 * 최소걸음(12)은 **하한**이다 — 그 아래면 안 움직이고, 넘으면 움직인다.
 *
 * 머리말 주석이 한동안 「걸음 상한을 넘어야」 로 적혀 있었다. 읽는 사람은
 * 「걸음이 너무 많으면 멈춘다」 로 읽게 되는데, 그러면 '많이 겪을수록 더
 * 잘 맞춘다' 는 이 파일의 전제가 거꾸로 읽힌다. 어느 쪽이 맞는지 여기서
 * 못 박아 둔다.
 */
{
  const 적게 = 카드('m', 본것만들기(11, { 잘린인자: 11 }), null);
  const 많이 = 카드('m', 본것만들기(1200, { 잘린인자: 1200 }), null);
  check('★ 걸음이 하한 아래면 안 움직인다', 적게.조정.상한먼저올리기 === false, `걸음 11`);
  check('★ 걸음이 많을수록 더 움직인다 — 상한이 아니라 하한이다',
    많이.조정.상한먼저올리기 === true, `걸음 1200`);
}

trace('7-실제로동작이바뀌나');

// ── 숫자만 바뀌고 끝나면 뜻이 없다 ──────────────────────────────────────
//
// 카드가 `상한먼저올리기: true` 를 내놓는 것과, 실제로 **더 큰 상한으로 요청이
// 나가는 것**은 다른 일이다. 여기서는 진짜 서버를 세우고 오간 요청을 들여다본다.
{
  const { createServer } = await import('node:http');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Session } = await import('../src/agent/session.js');
  const { run } = await import('../src/agent/loop.js');
  const { makeScope } = await import('../src/safety/guard.js');
  const { History } = await import('../src/safety/undo.js');
  const { Audit } = await import('../src/safety/audit.js');
  const { allowEndpoint, resetNet } = await import('../src/safety/network.js');

  const 방 = mkdtempSync(join(tmpdir(), 'deel-card-'));
  const 받은것 = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try { 받은것.push(JSON.parse(body)); } catch { /* 못 읽으면 그만 */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '했습니다' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 5 },
      }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  allowEndpoint(base);

  const 돌리기 = async (카드값) => {
    받은것.length = 0;
    const conn = {
      kind: 'openai', base, auth: 'none', key: null, model: '검사용',
      ctx: 32768, streaming: false, tools: true, json: false, think: false,
    };
    const s = new Session(conn, { root: 방, mode: 'auto', think: 'medium', effort: 'save' });
    const ctx = {
      scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set(),
      카드: 카드값,
    };
    ctx.history.nextTurn();
    for await (const _ of run(s, ctx, '한 줄만 해줘', {})) { /* 끝까지 돌린다 */ }
    return 받은것[0]?.max_tokens ?? null;
  };

  const 그냥 = await 돌리기(null);
  const 올린것 = await 돌리기(카드('m', 본것만들기(40, { 잘린인자: 12 }), null));
  check('카드가 붙으면 실제 요청 상한이 커진다', 올린것 > 그냥,
    `${그냥} → ${올린것}`);

  const 안바뀜 = await 돌리기(카드('m', 본것만들기(40, { 잘린인자: 1 }), null));
  check('버릇이 아니면 상한은 그대로', 안바뀜 === 그냥, `${그냥} vs ${안바뀜}`);

  srv.close();
  resetNet();
  rmSync(방, { recursive: true, force: true });
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n모델 카드 검사  ${D}(겪은 버릇이 하네스를 실제로 바꾸는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
