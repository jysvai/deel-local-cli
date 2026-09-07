// 흘려 받다가 흐름이 멎으면.
//
// ── 왜 이 검사가 있나 ───────────────────────────────────────────────────
//
// 흘려 받는 자리의 시계를 `timeout` 하나로 재고 있었다. 그 하나가 두 가지를
// 한꺼번에 틀리게 잰다.
//
//   길게 답하는 모델    5분 상한에 걸려 **답을 잘 하고 있는데** 끊긴다.
//                       화면에는 중간에서 멎은 답과 「시간 초과」 만 남는다.
//                       사람은 모델이 죽은 줄 알고 같은 것을 다시 시킨다.
//   멎어 버린 게이트웨이  10초 만에 멎었는데 5분을 꽉 채우고 나서야 안다.
//                       그 5분 동안 화면은 커서만 깜빡인다.
//
// 흘려 받는 자리에서 재야 하는 것은 **얼마나 걸리나** 가 아니라 **얼마나
// 잠잠한가** 다. 조각이 올 때마다 시계를 되감으면 둘 다 낫는다.
//
// ── 어떻게 재나 ─────────────────────────────────────────────────────────
//
// 진짜 서버(127.0.0.1)를 세우고 진짜로 멎게 한다. 흉내로는 못 잰다 — 여기서
// 잡으려는 것은 소켓이 살아 있는 채로 아무것도 안 오는 상태이고, 그건 함수를
// 직접 불러서는 만들 수가 없다.
//
// 검사가 오래 걸리면 안 되므로 잠잠 상한을 밀리초 단위로 짧게 준다. 재는 것은
// **어느 시계로 재는가** 이지 60초라는 숫자가 아니다.
import { createServer } from 'node:http';
import { chatStream, 흐름멎음, 말없이끝남 } from '../src/backend/adapter.js';
import { 잠잠기본 } from '../src/backend/http.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 조각 = (글) => `data: ${JSON.stringify({ choices: [{ delta: { content: 글 } }] })}\n\n`;

/**
 * 대본대로 흘려보내는 스텁.
 *
 * 대본은 [기다릴ms, 보낼것] 의 줄이다. `null` 을 보내라고 하면 **아무것도 안
 * 보내고 소켓을 열어 둔다** — 그것이 '멎음' 이다. 곱게 닫는 것(end)과는 다르다.
 */
function 스텁(대본) {
  return createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      void body;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      /*
       * 머리말을 **지금** 내보낸다.
       *
       * writeHead 만 하면 Node 는 첫 몸 조각까지 머리말을 들고 있는다. 그러면
       * 「머리말은 왔는데 몸이 안 온다」 를 못 만든다 — 부르는 쪽은 머리말을
       * 기다리는 중이라 잠잠 시계가 아니라 전체 시계에 걸린다. 재려던 것과
       * 다른 것을 재게 된다.
       */
      res.flushHeaders();
      for (const [늦게, 보낼것] of 대본) {
        await new Promise((r) => setTimeout(r, 늦게));
        if (res.destroyed) return;
        if (보낼것 === null) return;              // 여기서 멎는다. 안 닫고 그냥 있는다.
        if (보낼것 === '끝') {
          // 끝난 까닭까지 준다. 안 주면 이 답도 '말없이끝남' 이 되어, 아래
          // 「멀쩡히 끝났다」 를 재는 자리가 사실은 아무것도 못 재게 된다.
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
          return res.end('data: [DONE]\n\n');
        }
        res.write(조각(보낼것));
      }
      res.end();
    });
  });
}

async function 세우기(대본) {
  const srv = 스텁(대본);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  resetNet();
  allowEndpoint(base);
  return { srv, base };
}

const 부르기 = async (base, 옵션 = {}) => {
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 8000, ...(옵션.conn ?? {}) };
  const 글조각 = [];
  let 끝 = null;
  let 탈 = null;
  try {
    for await (const ev of chatStream(conn, {
      messages: [{ role: 'user', content: 'x' }], maxTokens: 10, ...(옵션.opts ?? {}),
    })) {
      if (ev.type === 'content') 글조각.push(ev.text);
      else if (ev.type === 'done') 끝 = ev.message;
    }
  } catch (e) { 탈 = e; }
  return { 글: 글조각.join(''), 끝, 탈 };
};

// ── 1. 멎으면 끊는다. 다만 받은 것은 살린다 ────────────────────────────
trace('1-멎음');
{
  /*
   * 조각 둘을 주고 멎는다.
   *
   * 여기서 제일 중요한 것은 **받아 둔 글자를 안 버리는 것**이다. 3천 자를
   * 받아 놓고 마지막에 멎었다고 통째로 던지면, 사람은 아무것도 못 보고 같은
   * 것을 다시 시킨다 — 같은 게이트웨이면 같은 자리에서 또 멎는다.
   */
  const { srv, base } = await 세우기([[0, '앞'], [10, '뒤'], [10, null]]);
  const t0 = Date.now();
  const r = await 부르기(base, { conn: { 잠잠: 300 } });
  const 걸린 = Date.now() - t0;

  check('★★ 멎으면 잠잠 상한에서 끊는다 — 전체 시계를 기다리지 않는다',
    걸린 < 3000, `${걸린}ms`);
  check('★★ 받아 둔 글자는 버리지 않는다', r.글 === '앞뒤', JSON.stringify(r.글));
  check('★★ 끝난 까닭에 이름을 붙인다', r.끝?.stopped === 흐름멎음, String(r.끝?.stopped));
  // 「0초 동안 안 왔습니다」 는 읽는 사람에게 거짓말이다. 1초 밑도 1 로 적는다.
  check('★ 몇 초 기다렸는지도 같이 준다 — 그게 곧 손댈 자리다',
    r.끝?.멎은초 >= 1, String(r.끝?.멎은초));
  check('오류로 던지지 않는다 — 받은 답을 줘야 한다', r.탈 === null, String(r.탈?.message ?? ''));
  /*
   * 곱게 닫은 것(말없이끝남)과 섞으면 안 된다.
   *
   * 앞은 상대가 연결을 닫은 것이고 이쪽은 연결이 살아 있는 채로 아무것도 안
   * 오는 것이다. 고칠 자리가 다르다 — 앞은 중계 프록시가 몸통을 자르는 것이고,
   * 뒤는 답을 통째로 모았다가 주는 게이트웨이라 잠잠 상한을 올리면 된다.
   */
  check('★ 말없이 닫힌 것과 다른 이름이다', 흐름멎음 !== 말없이끝남, `${흐름멎음} / ${말없이끝남}`);
  srv.close();
}

// ── 2. 한 글자도 못 받고 멎으면 그건 실패다 ────────────────────────────
trace('2-빈-채로-멎음');
{
  /*
   * 빈 답을 '답' 이라고 부르면 안 된다.
   *
   * 조각을 하나도 못 받았으면 살릴 것이 없다. 그걸 done 으로 넘기면 위층은
   * 「답이 비었다」 로 읽고, 사람은 모델이 대답을 안 했다고 생각한다 — 실제로는
   * 연결이 멎은 것이라 고칠 자리가 완전히 다르다.
   */
  const { srv, base } = await 세우기([[10, null]]);
  const r = await 부르기(base, { conn: { 잠잠: 300 } });
  check('★★ 한 글자도 못 받았으면 오류로 던진다', r.탈 !== null, String(r.탈?.message ?? '(안 던짐)'));
  check('★ 무엇 때문인지 말에 남는다', /멎|안 왔습니다|STALL/i.test(String(r.탈?.message ?? '')),
    String(r.탈?.message ?? ''));
  srv.close();
}

// ── 3. 느린 것은 멎은 것이 아니다 ──────────────────────────────────────
trace('3-느린-것은-살린다');
{
  /*
   * 여기가 이 변경의 진짜 값이다.
   *
   * 조각이 꾸준히 오면 **전체 시간이 얼마가 되든** 안 끊는다. 예전에는 전체
   * 시계 하나로 재서, 오래 생각하는 모델의 긴 답이 상한에서 잘렸다. 그 잘림은
   * 화면에서 「모델이 말을 하다 말았다」 와 구별이 안 됐다.
   *
   * 그래서 **전체 시계보다 오래 걸리는 대화**를 만들어 놓고, 그래도 끝까지
   * 오는지를 본다. timeout 을 짧게(120ms) 주고 조각을 60ms 간격으로 다섯 번
   * 보내면 다 받는 데 300ms 가 넘는다 — 전체 시계로 재고 있으면 여기서 잘린다.
   */
  const { srv, base } = await 세우기([[0, '가'], [60, '나'], [60, '다'], [60, '라'], [60, '마'], [60, '끝']]);
  const r = await 부르기(base, { conn: { 잠잠: 500 }, opts: { timeout: 120 } });
  check('★★ 조각이 꾸준히 오면 전체 시간이 길어도 안 끊는다',
    r.글 === '가나다라마', JSON.stringify(r.글));
  check('★ 그런 답은 멀쩡히 끝난 것으로 적는다', r.끝?.stopped === 'stop', String(r.끝?.stopped));
  check('오류도 아니다', r.탈 === null, String(r.탈?.message ?? ''));
  srv.close();
}

// ── 4. 머리말이 안 오면 그건 전체 시계로 잰다 ──────────────────────────
trace('4-머리말-전');
{
  /*
   * 잠잠 시계는 **머리말이 온 뒤**의 이야기다. 답이 시작조차 안 하는 것은
   * 예전 그대로 `timeout` 이 받는다 — 안 그러면 죽은 주소에 60초씩 매달린다.
   */
  const srv = createServer((req, res) => {
    req.resume();
    // 머리말도 안 보내고 붙들고 있는다. 검사가 끝날 때 닫힌다.
    void res;
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  resetNet();
  allowEndpoint(base);

  const t0 = Date.now();
  const r = await 부르기(base, { conn: { 잠잠: 60000 }, opts: { timeout: 200 } });
  const 걸린 = Date.now() - t0;
  check('★★ 머리말이 안 오면 timeout 이 받는다 — 잠잠 상한을 안 기다린다',
    r.탈 !== null && 걸린 < 5000, `${걸린}ms · ${r.탈?.message ?? '(안 던짐)'}`);
  srv.close();
  // 붙들려 있던 소켓을 놓아 준다. 안 그러면 이 파일이 안 끝난다.
  srv.closeAllConnections?.();
}

// ── 5. 기본값 ──────────────────────────────────────────────────────────
trace('5-기본값');
{
  /*
   * 기본값을 검사가 못 박는다.
   *
   * 0 이나 undefined 로 새면 잠잠 시계가 통째로 꺼지고, 그러면 이 파일의 검사
   * 대부분이 여전히 초록인 채로 **기능만 사라진다** (검사는 conn 에 값을
   * 직접 주기 때문이다).
   */
  check('★ 잠잠 기본값이 있다', Number.isFinite(잠잠기본) && 잠잠기본 > 0, String(잠잠기본));
  check('★ 사람이 기다려 줄 만한 값이다 (10초~5분)',
    잠잠기본 >= 10000 && 잠잠기본 <= 300000, `${잠잠기본}ms`);
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n흐름이 멎었을 때  ${D}(전체 시간이 아니라 잠잠한 시간을 잰다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
