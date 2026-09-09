// 바이트는 오는데 **내용이 안 올 때**.
//
// ── 왜 stall.test.js 와 따로 있나 ───────────────────────────────────────
//
// 옆 파일(stall.test.js)이 재는 것은 **바이트의 침묵**이다. 한 글자도 안 오면
// 끊는다. 그 시계는 잘 돌고 있고, 여기서 재는 것은 그 시계가 **못 잡는 자리**다.
//
// SSE 에는 내용이 없는 조각이 있다 —
//
//   `: ping`                             규격이 정한 주석 줄. keep-alive.
//   `data: {"choices":[{"delta":{}}]}`   빈 delta. 살아 있다는 말만 한다.
//
// 둘 다 바이트다. 그래서 잠잠 시계를 되감는다. 그리고 둘 다 화면에 아무것도
// 안 남긴다 — 앞엣것은 JSON 이 아니라 파싱에서 버려지고, 뒤엣것은 absorb 가
// 낼 이벤트가 없다. 머리말까지 재던 시계는 머리말이 오는 순간 꺼진다.
//
// 그러면 **천장이 하나도 안 남는다.** 실제로 게이트웨이 뒤에서 15분 넘게,
// 오류도 없이, 스피너만 돌았다. 이 파일의 1번이 그 상태를 그대로 만든다.
//
// ── 여기서 제일 조심할 것 ───────────────────────────────────────────────
//
// 성급하게 끊으면 **지금 잘 도는 연결을 우리가 죽인다.** 추론을 감추는
// 게이트웨이는 원래 이 모양으로 정상 동작하고(상위 모델이 생각하는 동안
// keep-alive 만 흘린다), 도구 인자는 글자로 쪼개져 와서 화면 이벤트를 하나도
// 안 내면서 정상 진행한다. 그래서 4·5번이 이 파일의 알맹이다 — 안 끊는 쪽.
import { createServer } from 'node:http';
import { chatStream, 흐름멎음 } from '../src/backend/adapter.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 글조각 = (글) => `data: ${JSON.stringify({ choices: [{ delta: { content: 글 } }] })}\n\n`;
// 도구 인자는 글자로 쪼개져 온다. 화면 이벤트는 하나도 안 나온다(mergeDeltaCalls).
const 도구조각 = (글) => `data: ${JSON.stringify({
  choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'Read', arguments: 글 } }] } }],
})}\n\n`;
const 끝조각 = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`;

/**
 * keep-alive 만 흘리는 스텁.
 *
 * `핑수` 만큼 `사이`ms 간격으로 살아 있다는 신호만 보낸다. 그 뒤에 `뒤에` 를
 * 보낸다 — `null` 이면 계속 핑만 보낸다(끝나지 않는 자리를 그대로 만든다).
 */
function 스텁({ 앞에 = [], 핑수 = 1000, 사이 = 25, 뒤에 = null, 핑꼴 = '주석' }) {
  return createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      void body;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // 머리말을 지금 내보낸다. 안 그러면 머리말 시계에 걸려 재려던 것과
      // 다른 것을 재게 된다 (stall.test.js 의 같은 자리 참고).
      res.flushHeaders();
      for (const 것 of 앞에) {
        await new Promise((r) => setTimeout(r, 사이));
        if (res.destroyed) return;
        res.write(것);
      }
      for (let i = 0; i < 핑수; i++) {
        await new Promise((r) => setTimeout(r, 사이));
        if (res.destroyed) return;
        // 두 가지 모양을 다 낸다. 앞엣것은 JSON 이 아니라서, 뒤엣것은 delta 가
        // 비어서 — 서로 다른 까닭으로 화면에 아무것도 안 남긴다.
        res.write(핑꼴 === '주석' ? ': ping\n\n' : `data: ${JSON.stringify({ choices: [{ delta: {} }] })}\n\n`);
      }
      if (뒤에) { res.write(뒤에); res.write(끝조각); return res.end('data: [DONE]\n\n'); }
    });
  });
}

async function 세우기(설정) {
  const srv = 스텁(설정);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  resetNet();
  allowEndpoint(base);
  return { srv, base };
}

const 부르기 = async (base, conn추가 = {}) => {
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 8000, ...conn추가 };
  const 글 = [];
  const 알림 = [];
  let 끝 = null;
  let 탈 = null;
  try {
    for await (const ev of chatStream(conn, { messages: [{ role: 'user', content: 'x' }], maxTokens: 10 })) {
      if (ev.type === 'content') 글.push(ev.text);
      else if (ev.type === '소식없음') 알림.push(ev);
      else if (ev.type === 'done') 끝 = ev.message;
    }
  } catch (e) { 탈 = e; }
  return { 글: 글.join(''), 알림, 끝, 탈 };
};

// ── 1. 재현 — keep-alive 는 바이트 시계를 무력화한다 ────────────────────
trace('1-바이트시계무력화');
{
  /*
   * 이 검사가 이 파일의 존재 이유다.
   *
   * 잠잠 상한(200ms)보다 **자주** 핑을 보낸다. 그러면 시계가 영원히 되감겨서
   * 잠잠이 절대 안 걸린다. 무소식 상한을 꺼 두면(0) 천장이 하나도 안 남는다 —
   * 그게 사람이 15분을 기다린 상태다.
   *
   * 여기서는 끝이 있어야 검사가 끝나므로 핑을 20번만 보내고 답을 준다.
   * 재는 것은 「잠잠 상한을 한참 넘겨도 안 끊긴다」 이다.
   */
  const { srv, base } = await 세우기({ 핑수: 20, 사이: 25, 뒤에: 글조각('늦게 온 답') });
  const t0 = Date.now();
  const r = await 부르기(base, { 잠잠: 200, 무소식: 0 });
  const 걸린 = Date.now() - t0;
  srv.closeAllConnections(); srv.close();

  check('★★★ 핑만 오는 동안 잠잠 시계가 안 걸린다 (이게 15분을 만든 자리)',
    r.탈 === null && 걸린 > 300, `${걸린}ms · ${String(r.탈?.code ?? '')}`);
  check('★★ 그 뒤에 온 답은 멀쩡히 받는다', r.글 === '늦게 온 답', JSON.stringify(r.글));
  check('★ 상한을 꺼 두면 알림도 안 뜬다 (예전 그대로)', r.알림.length === 0, String(r.알림.length));
}

// ── 2. 고침 — 전체 상한이 천장을 만든다 ─────────────────────────────────
trace('2-전체상한');
{
  const { srv, base } = await 세우기({ 핑수: 100000, 사이: 25 });
  const t0 = Date.now();
  const r = await 부르기(base, { 잠잠: 5000, 무소식: 400 });
  const 걸린 = Date.now() - t0;
  srv.closeAllConnections(); srv.close();

  check('★★★ 내용이 안 오면 전체 상한에서 끊는다', r.탈?.code === 'NONEWS', String(r.탈?.code));
  check('★★ 잠잠 상한(5초)을 안 기다린다', 걸린 < 3000, `${걸린}ms`);
  check('★ 몇 초 기다렸는지 오류에 담는다', r.탈?.무소식 === 400, String(r.탈?.무소식));
}

// ── 3. 끊기 전에 먼저 말한다 ────────────────────────────────────────────
trace('3-알림');
{
  /*
   * 알림이 끊기보다 **먼저** 와야 한다. 순서가 뒤바뀌면 사람은 왜 끊겼는지
   * 모른 채 오류만 본다 — 그건 여태와 다를 게 없다.
   */
  const { srv, base } = await 세우기({ 핑수: 100000, 사이: 25 });
  const r = await 부르기(base, { 잠잠: 5000, 무소식: 2000, 무소식알림: 150 });
  srv.closeAllConnections(); srv.close();

  check('★★★ 끊기 전에 「내용이 안 온다」 를 화면에 알린다', r.알림.length >= 1, String(r.알림.length));
  check('★★ 한 번만 알린다 — 조각마다 도배하지 않는다', r.알림.length === 1, String(r.알림.length));
  check('★ 몇 초째인지 적는다', (r.알림[0]?.초 ?? 0) >= 1, String(r.알림[0]?.초));
  check('★ 언제 끊을지도 같이 적는다', r.알림[0]?.상한초 === 2, String(r.알림[0]?.상한초));
}

// ── 4. 안 끊는 쪽 — 느리지만 진짜로 답하는 중 ───────────────────────────
trace('4-정상느림');
{
  /*
   * 여기가 이 기능의 위험한 자리다. 성급하게 끊으면 잘 도는 연결을 죽인다.
   */
  const 늦은답 = [글조각('한 '), 글조각('글자'), 글조각('씩')];
  const { srv, base } = await 세우기({ 앞에: 늦은답, 핑수: 0, 사이: 80, 뒤에: 글조각(' 옵니다') });
  const r = await 부르기(base, { 잠잠: 5000, 무소식: 300 });
  srv.closeAllConnections(); srv.close();

  check('★★★ 글이 오는 동안은 절대 안 끊는다', r.탈 === null, String(r.탈?.code ?? ''));
  check('★★ 답을 끝까지 받는다', r.글 === '한 글자씩 옵니다', JSON.stringify(r.글));
  check('★★ 헛알림도 안 뜬다', r.알림.length === 0, String(r.알림.length));
}

// ── 5. 안 끊는 쪽 — 도구 인자만 오는 중 ─────────────────────────────────
trace('5-도구인자');
{
  /*
   * 제일 놓치기 쉬운 자리다. 도구 인자는 글자로 쪼개져 오는데 화면 이벤트를
   * **하나도 안 낸다.** 「이벤트가 왔나」 로 살아있음을 재면 여기서 정상 흐름을
   * 끊는다 — 그래서 acc 가 자랐나로 잰다.
   */
  const 인자 = ['{"file', '_path":', '"a.js"}'].map(도구조각);
  const { srv, base } = await 세우기({ 앞에: 인자, 핑수: 0, 사이: 80, 뒤에: 글조각('') });
  const r = await 부르기(base, { 잠잠: 5000, 무소식: 300 });
  srv.closeAllConnections(); srv.close();

  check('★★★ 도구 인자만 오는 동안도 안 끊는다 (이벤트가 0인데 진행 중이다)',
    r.탈 === null, String(r.탈?.code ?? ''));
  check('★★ 도구 호출을 온전히 읽는다',
    r.끝?.toolCalls?.[0]?.args?.file_path === 'a.js', JSON.stringify(r.끝?.toolCalls?.[0]?.args));
  check('★★ 헛알림도 안 뜬다', r.알림.length === 0, String(r.알림.length));
}

// ── 6. 받아 둔 글은 버리지 않는다 ───────────────────────────────────────
trace('6-부분보존');
{
  /*
   * 세 문단을 받아 놓고 그 뒤로 핑만 오는 자리가 있다. 통째로 던지면 사람은
   * 아무것도 못 보고 같은 것을 다시 시킨다 — 잠잠 시계가 하는 것과 같은 규칙.
   */
  const { srv, base } = await 세우기({ 앞에: [글조각('여기까지는 왔다')], 핑수: 100000, 사이: 25 });
  const r = await 부르기(base, { 잠잠: 5000, 무소식: 400 });
  srv.closeAllConnections(); srv.close();

  check('★★★ 받아 둔 글을 살려서 준다', r.글 === '여기까지는 왔다', JSON.stringify(r.글));
  check('★★ 오류로 던지지 않는다', r.탈 === null, String(r.탈?.code ?? ''));
  check('★★ 끝난 까닭에 이름을 붙인다', r.끝?.stopped === 흐름멎음, String(r.끝?.stopped));
}

// ── 7. 빈 delta 도 주석 핑과 똑같이 다룬다 ──────────────────────────────
trace('7-빈delta');
{
  /*
   * `: ping` 은 JSON 파싱에서 버려지고, 빈 delta 는 absorb 가 낼 이벤트가
   * 없어서 버려진다. 까닭은 다른데 결과가 같다 — 둘 다 잡아야 한다.
   */
  const { srv, base } = await 세우기({ 핑수: 100000, 사이: 25, 핑꼴: '빈delta' });
  const r = await 부르기(base, { 잠잠: 5000, 무소식: 400 });
  srv.closeAllConnections(); srv.close();

  check('★★★ 빈 delta 만 오는 것도 끊는다', r.탈?.code === 'NONEWS', String(r.탈?.code));
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n소식 없음 검사  ${D}(바이트는 오는데 내용이 안 올 때)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
