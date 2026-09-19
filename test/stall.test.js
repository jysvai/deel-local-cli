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
// ── 4.9 잠잠 시계를 단 흐름의 res.text() ─────────────────────────────────
// ── 4.8 곧장 가는 길도 거절 몸은 상한까지만 ──────────────────────────────
trace('4.8-거절몸상한');
{
  /*
   * (4회차 이월 · 사냥5) 프록시 길(노드로)은 거절 답의 몸을 1MB 까지만 읽고 끊는데, 곧장 가는
   * 길(fetch)은 끝까지 읽었다 — adapter 의 거절읽기 가 res.text() 로 통째. 300MB 짜리 404·500
   * 을 주는 게이트웨이 하나에 메모리가 튄다. 같은 서버인데 프록시를 켰나에 따라 달랐다.
   * 서버가 실제로 몇 바이트를 내보냈나까지 센다 — 받아 놓고 잘라 버리는 것은 고친 것이 아니다.
   */
  const { 원시요청 } = await import('../src/backend/http.js');
  const 전체 = 64 * 1024 * 1024;
  const 보낸기록 = [];
  const srv = createServer((q, s) => {
    q.resume();
    s.writeHead(404, { 'content-type': 'text/plain' });
    const 조각 = Buffer.alloc(64 * 1024, 97);
    let 보낸 = 0;
    const 붓기 = () => {
      while (보낸 < 전체) {
        보낸 += 조각.length;
        if (!s.write(조각)) { s.once('drain', 붓기); return; }
      }
      s.end();
    };
    s.on('close', () => 보낸기록.push(보낸));
    붓기();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  allowEndpoint(base);
  const 상한 = 1024 * 1024;
  const 재기 = async (이름, 옵션, 읽기) => {
    const 앞 = 보낸기록.length;
    let 길이 = -1;
    let 탈 = '';
    try {
      const r = await 원시요청(`${base}/x`, { timeout: 20000, ...옵션 });
      길이 = String(await 읽기(r)).length;
    } catch (e) { 탈 = String(e?.message ?? e); }
    // 끊긴 소켓의 close 가 서버에 닿을 때까지 잠깐 본다 — 자는 대신 본다.
    for (let i = 0; i < 150 && 보낸기록.length === 앞; i++) await new Promise((r) => setTimeout(r, 20));
    const 보냄 = 보낸기록[앞] ?? 전체;
    check(`★★ 곧장 가는 길의 거절 몸은 상한까지만 — ${이름}`,
      길이 >= 0 && 길이 <= 상한 + 64 * 1024 && 보냄 < 전체 / 2,
      `읽은 글 ${길이}자 · 서버가 보낸 ${Math.round(보냄 / 1048576)}MB ${탈}`);
  };
  await 재기('통째로 받는 부름', {}, async (r) => r.text ?? '');
  await 재기('흘려 받는 부름 (거절읽기 가 res.text())', { stream: true }, async (r) => (r.res ? r.res.text() : ''));
  await 재기('잠잠 시계를 단 흐름', { stream: true, 잠잠: 5000 }, async (r) => (r.res ? r.res.text() : ''));
  srv.closeAllConnections?.();
  srv.close();
}

trace('4.9-몸글');
{
  /*
   * (사냥5 W-text) 잠잠 시계는 만들 때 원래 몸의 읽개를 쥔다. 그런데 돌려준
   * `res.text` 가 **원래** `res.text()` 를 불러서, 부르는 순간 「몸이 잠겼다」
   * 로 터진다. 지금 부르는 자리는 없지만, 처음 부르는 사람이 제일 알기 어려운
   * 곳에서 밟는다.
   */
  const { 원시요청 } = await import('../src/backend/http.js');
  const srv = createServer((q, s) => { q.resume(); s.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); s.end('몸글-그대로'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  allowEndpoint(base);
  let 글;
  try {
    const r = await 원시요청(`${base}/x`, { stream: true, 잠잠: 5000, timeout: 5000 });
    글 = await r.res.text();
  } catch (e) { 글 = `던짐: ${e?.message ?? e}`; }
  check('★ 잠잠 시계를 단 흐름에서도 res.text() 가 몸을 읽는다', 글 === '몸글-그대로', String(글));
  srv.closeAllConnections?.();
  srv.close();
}

trace('4.85-거절몸-시계');
{
  /*
   * ── 거절 몸을 읽는 동안에도 시계가 있어야 한다 (사냥6 막판-뒷단) ────────
   *
   * 흘려 받으려던 요청이 4xx·5xx 로 거절당하면 부르는 쪽(adapter 의 거절읽기)이
   * `res.text()` 로 몸을 읽어 사람 말 한 줄을 뽑는다. 그런데 곧장 가는 길(fetch)은
   * **머리말이 온 순간 시계를 통째로 껐다.** 그래서 머리말만 주고 몸을 안 끊는
   * 게이트웨이 앞에서 그 `text()` 가 **영영 안 돌아왔다** — 화면은 커서만 깜빡이고,
   * Ctrl+C 말고는 끝낼 길이 없다. 프록시 길(노드로)은 거절 몸을 읽는 동안 머리말
   * 시계를 켜 둬서 timeout 에 끝났다. 같은 게이트웨이인데 프록시를 켰나에 따라
   * 한쪽만 영영 매달렸다 — 이 파일이 제일 싫어하는 모양이다.
   *
   * 재는 것은 **몇 초** 가 아니라 **끝나긴 하나** 다. 상한(timeout)보다 한참 넉넉히
   * 기다려 주고, 그 안에 답이든 탈이든 나오면 통과다. 느린 기계에서 흔들리지 않는다.
   */
  const { 원시요청 } = await import('../src/backend/http.js');
  const { 프록시정하기, 프록시지우기 } = await import('../src/backend/proxy.js');
  const { request: 노드요청 } = await import('node:http');

  // 머리말만 내보내고 몸은 한 바이트도 안 준다. 닫지도 않는다 — 그것이 '멎음' 이다.
  const 거절멎기 = createServer((q, s) => {
    q.resume();
    q.on('end', () => { s.writeHead(500, { 'content-type': 'application/json' }); s.flushHeaders(); });
  });
  // 절대 주소를 그대로 넘기는 http 프록시. 이것만 있으면 요청이 노드로 길로 간다.
  const 프록시 = createServer((rq, rs) => {
    const u = new URL(rq.url);
    const 뒤 = 노드요청({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: rq.method, headers: { host: u.host }, agent: false }, (r) => {
      rs.writeHead(r.statusCode, r.headers);
      rs.flushHeaders();
      r.pipe(rs);
    });
    뒤.on('error', () => rs.destroy());
    rq.pipe(뒤);
  });
  for (const s of [거절멎기, 프록시]) await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const 멎는곳 = `http://127.0.0.1:${거절멎기.address().port}`;

  const 상한 = 600;
  const 재기 = async () => {
    const t0 = Date.now();
    let 끝났나 = false;
    let 말 = '';
    const 일 = (async () => {
      const r = await 원시요청(`${멎는곳}/v1/x`, { method: 'POST', body: '{}', stream: true, timeout: 상한, 잠잠: 상한 });
      if (r.ok) return '(거절이 아니다)';
      return `글 ${String(await r.res.text()).length}자`;
    })().then((t) => { 끝났나 = true; 말 = String(t); }, (e) => { 끝났나 = true; 말 = `${e?.name}: ${e?.message}`; });
    // 상한의 열 배를 기다려 준다. 끝나긴 하나만 본다 — 몇 초인지는 안 잰다.
    await Promise.race([일, new Promise((r) => setTimeout(r, 상한 * 10))]);
    return { 끝났나, 걸린: Date.now() - t0, 말 };
  };

  resetNet();
  allowEndpoint(멎는곳);
  const 곧장 = await 재기();
  check('★★★ 거절 몸을 읽는 것도 끝나긴 한다 — 곧장 가는 길',
    곧장.끝났나 === true, `${곧장.걸린}ms · ${곧장.말 || '(영영 안 돌아옴)'}`);

  프록시정하기({ env: { HTTP_PROXY: `http://127.0.0.1:${프록시.address().port}` }, 로컬우회: false });
  resetNet();
  allowEndpoint(멎는곳);
  const 프록시로 = await 재기();
  check('★★★ 프록시 길도 같다 — 한쪽만 영영 매달리면 안 된다',
    프록시로.끝났나 === true, `${프록시로.걸린}ms · ${프록시로.말 || '(영영 안 돌아옴)'}`);
  프록시지우기();

  for (const s of [거절멎기, 프록시]) { s.closeAllConnections?.(); s.close(); }
  resetNet();
}

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

// ── 6. 잠잠을 안 줘도 머리말이 온 뒤에는 전체 시계가 안 끊는다 ──────────
trace('6-잠잠-안주고-흘려받기');
{
  /*
   * (8회차 뒷단-전선) 이 파일 위 머리말은 「머리말까지 재던 시계는 머리말이
   * 오는 순간 **꺼진다**」 고 **무조건으로** 약속한다. 그런데 끄는 자리가
   * `잠잠 > 0` 갈래 안에 있었다. 그래서 잠잠을 안 주고 흘려 받는 자리
   * (probe 의 진단 · WebFetch · 플러그인 받기)에서는 머리말이 온 뒤에도 그
   * 시계가 살아 있었고, 300ms 마다 꼬박꼬박 오는 조각 여섯 개짜리 스트림이
   * timeout(1초)에 세 조각 만에 끊겼다. 서버는 멀쩡했다.
   *
   * 두 가지를 **한 자리에서** 못 박는다.
   *   · 잠잠을 안 줘도 머리말이 온 뒤에는 전체 시계로 안 끊는다.
   *   · 그래도 **머리말이 아예 안 오는** 진짜 먹통은 여전히 timeout 이 받는다.
   * 뒤엣것을 같이 안 재면 「시계를 통째로 떼기」 가 초록으로 지나간다.
   *
   * 두 길을 다 잰다. 곧장 가는 길(fetch)과 프록시 길(노드로)이 다르면, 같은
   * 게이트웨이인데 프록시를 켠 사람만 답이 잘린다 — 이 파일이 제일 싫어하는 모양이다.
   */
  const { 원시요청 } = await import('../src/backend/http.js');
  const { 프록시정하기, 프록시지우기 } = await import('../src/backend/proxy.js');
  const { request: 노드요청 } = await import('node:http');

  // 300ms 마다 조각 하나, 모두 여섯. 다 받는 데 1.8초 — timeout(1초)보다 길다.
  const 흘리개 = createServer((q, s) => {
    q.resume();
    s.writeHead(200, { 'content-type': 'text/event-stream' });
    s.flushHeaders();
    let i = 0;
    const 보내 = () => {
      if (s.destroyed) return;
      if (i >= 6) return s.end();
      s.write(조각(String(i++)));
      setTimeout(보내, 300);
    };
    setTimeout(보내, 300);
  });
  // 절대 주소를 그대로 넘기는 http 프록시. 이것만 있으면 요청이 노드로 길로 간다.
  const 프록시 = createServer((rq, rs) => {
    const u = new URL(rq.url);
    const 뒤 = 노드요청({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: rq.method, headers: { host: u.host }, agent: false }, (r) => {
      rs.writeHead(r.statusCode, r.headers);
      rs.flushHeaders();
      r.pipe(rs);
    });
    뒤.on('error', () => rs.destroy());
    rq.pipe(뒤);
  });
  // 머리말도 안 주고 붙들고 있는 진짜 먹통.
  const 먹통 = createServer((q, res) => { q.resume(); void res; });
  for (const s of [흘리개, 프록시, 먹통]) await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const 흘리는곳 = `http://127.0.0.1:${흘리개.address().port}`;
  const 먹통곳 = `http://127.0.0.1:${먹통.address().port}`;

  // 잠잠 을 **안 준다** — 부르는 자리 셋이 실제로 그렇게 부른다.
  const 받기 = async (주소) => {
    const t0 = Date.now();
    let 글 = '';
    let 탈 = '';
    try {
      const r = await 원시요청(`${주소}/v1/x`, { stream: true, timeout: 1000 });
      const 읽개 = r.res.body.getReader();
      const 풀개 = new TextDecoder();
      while (true) {
        const { done, value } = await 읽개.read();
        if (done) break;
        글 += 풀개.decode(value, { stream: true });
      }
    } catch (e) { 탈 = `${e?.name}: ${e?.message}`; }
    return { 글, 걸린: Date.now() - t0, 탈 };
  };

  resetNet();
  allowEndpoint(흘리는곳);
  const 곧장 = await 받기(흘리는곳);
  check('★★★ 잠잠을 안 줘도 머리말이 온 뒤에는 전체 시계가 안 끊는다 — 곧장 가는 길',
    곧장.탈 === '' && /"5"/.test(곧장.글) && 곧장.걸린 > 1000,
    `${곧장.걸린}ms · ${곧장.탈 || '무오류'}`);

  프록시정하기({ env: { HTTP_PROXY: `http://127.0.0.1:${프록시.address().port}` }, 로컬우회: false });
  resetNet();
  allowEndpoint(흘리는곳);
  const 프록시로 = await 받기(흘리는곳);
  check('★★★ 프록시 길도 같다 — 프록시를 켠 사람만 답이 잘리면 안 된다',
    프록시로.탈 === '' && /"5"/.test(프록시로.글) && 프록시로.걸린 > 1000,
    `${프록시로.걸린}ms · ${프록시로.탈 || '무오류'}`);
  프록시지우기();

  resetNet();
  allowEndpoint(먹통곳);
  const 진짜먹통 = await 받기(먹통곳);
  check('★★★ 그래도 머리말이 아예 안 오면 여전히 timeout 이 받는다',
    진짜먹통.탈 !== '' && 진짜먹통.걸린 < 3000, `${진짜먹통.걸린}ms · ${진짜먹통.탈 || '(안 던짐)'}`);

  /*
   * 잠잠 시계를 단 몸도 **버리기로 진짜 끊긴다.**
   *
   * (8회차 뒷단-전선 · 제미니 2차 눈) 위 고침으로 흘려 받는 몸이 전부 잠잠감시에 싸이게
   * 됐다. 그런데 `버리기` 는 **원래** `res.body.cancel()` 을 부른다 — 잠잠감시가 만들 때
   * 그 몸의 읽개를 쥐었으므로 「잠겼다」 로 터지고, 그 탈은 `catch {}` 가 삼킨다. 겉보기엔
   * 버린 것 같은데 소켓은 살아 있고 서버는 계속 붓는다. WebFetch 가 글이 아닌 답(그림)을
   * 만나면 바로 이 자리다.
   *
   * 여기서 재는 것은 **서버 쪽 소켓이 닫혔나** 다. 「받은 바이트가 적다」 만 재면 밀림
   * (backpressure) 때문에 안 끊어도 초록이 된다 — 그게 이걸 여태 못 잡은 까닭이다.
   */
  {
    let 닫힘 = false;
    const 큰그림 = createServer((q, s) => {
      q.resume();
      s.writeHead(200, { 'content-type': 'image/png' });
      const 덩이 = Buffer.alloc(64 * 1024, 1);
      let 보낸 = 0;
      const 붓기 = () => {
        while (!닫힘 && 보낸 < 64 * 1024 * 1024) {
          보낸 += 덩이.length;
          if (!s.write(덩이)) { s.once('drain', 붓기); return; }
        }
        if (!닫힘) s.end();
      };
      s.on('close', () => { 닫힘 = true; });
      붓기();
    });
    await new Promise((r) => 큰그림.listen(0, '127.0.0.1', r));
    const 그림곳 = `http://127.0.0.1:${큰그림.address().port}`;
    resetNet();
    allowEndpoint(그림곳);
    const r = await 원시요청(`${그림곳}/png-big`, { stream: true, timeout: 20000 });
    await r.버리기?.();
    // 소켓이 닫히는 소식이 서버에 닿을 때까지 잠깐 본다 — 자는 대신 본다.
    for (let i = 0; i < 100 && !닫힘; i++) await new Promise((res) => setTimeout(res, 20));
    check('★★★ 잠잠 시계를 단 몸도 버리기로 진짜 끊긴다 — 소켓이 닫힌다',
      r.ok === true && 닫힘 === true, `ok=${r.ok} · 닫힘=${닫힘}`);
    큰그림.closeAllConnections?.();
    큰그림.close();
  }

  for (const s of [흘리개, 프록시, 먹통]) { s.closeAllConnections?.(); s.close(); }
  resetNet();
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n흐름이 멎었을 때  ${D}(전체 시간이 아니라 잠잠한 시간을 잰다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
