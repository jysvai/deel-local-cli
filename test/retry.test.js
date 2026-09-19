// 게이트웨이가 잠깐 막았을 때 턴이 죽지 않고 다시 부르는가.
//
// ── 왜 이걸 재나 ────────────────────────────────────────────────────────
//
// 사내 게이트웨이는 사람마다 할당량이 있어서 429 를 자주 준다. 뒤에 붙은
// 모델이 재시작하면 502·503 이 잠깐 온다. 연결이 그냥 끊길 때도 있다.
// 전에는 이 셋이 전부 **턴 하나를 통째로** 죽였다 — adapter 가 !ok 면 던지고,
// 루프는 잘린 답과 빈 답만 다시 불렀지 상태 코드는 안 봤다.
//
// 여기서 재는 것:
//   1) 429·5xx·끊김이면 잠깐 기다렸다 다시 부르고, 턴은 그대로 이어진다
//   2) Retry-After 가 오면 그 시간을 지킨다 (실제로 잰다)
//   3) 세 번 다시 불러도 안 되면 그때는 사실대로 말하고 곱게 끝난다
//   4) 흘러온 글이 있은 **뒤에** 끊긴 것은 다시 안 부른다 — 반쯤 온 답이 두 벌 되면 안 된다
//   5) 기다리는 중에 Ctrl+C 를 누르면 바로 멈춘다
//   6) 400·401 같은 것은 다시 불러 봐야 같으니 한 번만 부른다
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { chat, chatStream } from '../src/backend/adapter.js';
import { allowEndpoint } from '../src/safety/network.js';
import {
  다시부를까, 기다릴시간, 기다리기, 기본정책, 다시부를지, 못부른까닭, 못부른말,
} from '../src/backend/retry.js';
import { 할당량잊기 } from '../src/backend/quota.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 정책 자체 (순수 함수) ────────────────────────────────────────────────
trace('1-정책');
{
  const 정책 = 기본정책();
  check('세 번까지 다시 부른다', 정책.최대 === 3, String(정책.최대));
  for (const s of [408, 429, 500, 502, 503, 504, 529]) {
    check(`${s} 는 다시 부른다`, 다시부를까({ status: s, attempt: 1 }, 정책));
  }
  for (const s of [400, 401, 403, 404, 422]) {
    check(`${s} 는 다시 안 부른다`, !다시부를까({ status: s, attempt: 1 }, 정책));
  }
  check('연결이 끊긴 것(ECONNRESET)은 다시 부른다', 다시부를까({ status: 0, code: 'ECONNRESET', attempt: 1 }, 정책));
  check('상대가 닫은 것(UND_ERR_SOCKET)도 다시 부른다', 다시부를까({ status: 0, code: 'UND_ERR_SOCKET', attempt: 1 }, 정책));
  check('거부된 것(ECONNREFUSED)은 다시 안 부른다 — 서버가 꺼진 것이다', !다시부를까({ status: 0, code: 'ECONNREFUSED', attempt: 1 }, 정책));
  check('시간 초과는 다시 안 부른다 — 5분을 또 기다릴 일이 아니다', !다시부를까({ status: 0, code: 'TimeoutError', attempt: 1 }, 정책));
  check('상한에 닿으면 안 부른다', !다시부를까({ status: 429, attempt: 4 }, 정책));
  check('상한 안이면 부른다', 다시부를까({ status: 429, attempt: 3 }, 정책));

  // 기다릴 시간. 흔들림(jitter) 이 있으니 범위로 본다.
  const 사다리 = [1, 2, 3].map((n) => 기다릴시간({ attempt: n }, 정책));
  check('머리글이 없으면 1초 → 2초 → 4초 사다리 (흔들림 30% 안)',
    사다리[0] >= 1000 && 사다리[0] <= 1300 && 사다리[1] >= 2000 && 사다리[1] <= 2600 && 사다리[2] >= 4000 && 사다리[2] <= 5200,
    사다리.join(' / '));
  check('Retry-After 초는 그대로', 기다릴시간({ attempt: 1, retryAfter: '2' }, 정책) === 2000);
  check('Retry-After 0 은 바로', 기다릴시간({ attempt: 1, retryAfter: '0' }, 정책) === 0);
  /*
   * 재는 성질: **앞으로의 시각은 진짜 기다림으로 읽힌다** — 0초로 뭉개지지 않고,
   * 그 시각을 넘겨 잡지도 않는다.
   *
   * 벽시계가 끼는 자리라 창을 좁게 잡으면 안 된다. HTTP 날짜는 초 단위라
   * 만드는 순간 이미 최대 1초가 깎이고, 이 두 줄 사이에 컴퓨터가 멎으면 더
   * 깎인다. 그래서 절대값 대신 시킨 시간(3초)에 대한 비율로 본다 —
   * 느린 컴퓨터에서 2초가 지나가도 「0초로 읽었다」 와는 여전히 구별된다.
   */
  const 시킨것 = 3000;
  const 뒤 = new Date(Date.now() + 시킨것).toUTCString();
  const 날짜로 = 기다릴시간({ attempt: 1, retryAfter: 뒤 }, 정책);
  check('Retry-After 가 날짜면 0초가 아니라 그 시각까지 (시킨 것의 1/3 이상, 넘지 않음)',
    날짜로 > 시킨것 / 3 && 날짜로 <= 시킨것, `${날짜로}ms / ${시킨것}ms`);
  check('지난 날짜면 바로', 기다릴시간({ attempt: 1, retryAfter: new Date(Date.now() - 5000).toUTCString() }, 정책) === 0);
  check('Retry-After 가 이상하면 사다리로', 기다릴시간({ attempt: 1, retryAfter: '잠깐만' }, 정책) >= 1000);
  check('60초를 넘게 시키면 60초에서 자른다', 기다릴시간({ attempt: 1, retryAfter: '600' }, 정책) === 60000);
  // 규격 밖의 값들. 전에는 Date.parse 가 '1,5' 를 2001년으로 읽어 0초가 됐다 — 세 번을 연달아 두드렸다.
  check('Retry-After 1.5 는 1.5초', 기다릴시간({ attempt: 1, retryAfter: '1.5' }, 정책) === 1500);
  check('Retry-After 0.5 는 0.5초', 기다릴시간({ attempt: 1, retryAfter: '0.5' }, 정책) === 500);
  for (const 값 of ['-1', '+5', '5;', '1,5', '1 5', '']) {
    const ms = 기다릴시간({ attempt: 1, retryAfter: 값 }, 정책);
    check(`Retry-After '${값}' 은 0초가 아니라 사다리로`, ms >= 1000 && ms <= 1300, `${ms}ms`);
  }
  check('사다리가 비어 있으면 기본 사다리로 (NaN 초가 아니다)',
    (() => { const ms = 기다릴시간({ attempt: 1 }, { ...정책, base: [] }); return Number.isFinite(ms) && ms >= 1000; })());

  /*
   * 기다리는 중 끊기.
   *
   * 재는 성질: **시킨 시간을 다 안 기다린다.** 「몇 ms 안에 돌아온다」 가 아니다.
   * 500ms 같은 절대값으로 잡으면 검사가 재는 것이 코드가 아니라 그날 컴퓨터가
   * 얼마나 바쁜가가 된다 — 빨개져도 아무도 안 고치는 빨강이 제일 나쁘다.
   * 시킨 시간의 절반을 넘지 않으면 「안 기다리고 돌아왔다」 는 성립한다.
   */
  const 기다릴것 = 5000;
  const ac = new AbortController();
  const t0 = Date.now();
  setTimeout(() => ac.abort(), 30);
  let 끊김 = null;
  try { await 기다리기(기다릴것, ac.signal); } catch (e) { 끊김 = e; }
  check('기다리다 끊으면 Aborted 로 나오고 시킨 시간의 절반도 안 붙든다',
    끊김?.name === 'Aborted' && Date.now() - t0 < 기다릴것 / 2, `${끊김?.name} · ${Date.now() - t0}ms / ${기다릴것}ms`);
  const 이미 = new AbortController(); 이미.abort();
  let 미리 = null;
  try { await 기다리기(기다릴것, 이미.signal); } catch (e) { 미리 = e; }
  check('이미 끊긴 채로 오면 기다리지 않는다', 미리?.name === 'Aborted');
  // 재는 성질: 0 이면 **사다리를 안 탄다.** 사다리의 첫 칸이 1초라, 그보다
  // 빨리 돌아오면 안 기다린 것이다. 50ms 로 잡으면 GC 한 번에 빨개진다.
  const t1 = Date.now();
  await 기다리기(0, null);
  check('0 이면 사다리 첫 칸(1초)보다 훨씬 빨리 돌아온다', Date.now() - t1 < 정책.base[0],
    `${Date.now() - t1}ms / ${정책.base[0]}ms`);
}

// ── 가짜 게이트웨이 ────────────────────────────────────────────────────
// 대본대로 응답한다. { status, retryAfter } 는 거절, { reset } 은 머리말도 없이
// 끊기, { resetAfter } 는 글을 조금 흘린 뒤 끊기, { text } 는 정상 답.
let script = [];
let turn = 0;
const hits = [];

function sse(res, chunks) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const ch of chunks) res.write(`data: ${JSON.stringify(ch)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'fake-llm' }] }));
    }
    const step = script[turn++] ?? { text: '(대본 끝)' };
    hits.push(step);
    const 스트림 = /"stream":true/.test(body);

    if (step.status) {
      const h = { 'Content-Type': 'application/json' };
      if (step.retryAfter != null) h['Retry-After'] = String(step.retryAfter);
      res.writeHead(step.status, h);
      return res.end(JSON.stringify({ error: { message: step.message ?? `가짜 오류 ${step.status}` } }));
    }
    // 사내 프록시가 로그인 페이지를 200 으로 준다. 흘려받든 한 번에 받든 똑같이 준다.
    if (step.html) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(step.html);
    }
    // 200 으로 받아 놓고 흐름 **안에서** 오류 조각 하나를 준다 (LiteLLM·OpenRouter 꼴).
    if (step.흐름오류) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify(step.흐름오류)}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    // 한 번에 받는 길에서 200 몸에 error 만 싣는 게이트웨이.
    if (step.몸오류) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(step.몸오류));
    }
    if (step.reset) return req.socket.destroy();
    if (step.resetAfter) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x'.repeat(step.resetAfter) } }] })}\n\n`);
      return setTimeout(() => res.destroy(), 30);
    }
    if (!스트림) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        choices: [{
          message: { role: 'assistant', content: String(step.text), ...(step.생각 ? { reasoning: step.생각 } : {}) },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      }));
    }
    const parts = String(step.text).match(/.{1,8}/gs) ?? [''];
    return sse(res, [
      ...parts.map((p) => ({ choices: [{ delta: { content: p } }] })),
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 30 } },
    ]);
  });
});

// 포트 0 = 비어 있는 포트를 커널이 골라준다.
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/v1`;
allowEndpoint(base);

const root = mkdtempSync(join(tmpdir(), 'deel-retry-'));
const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };

function 새연결(추가 = {}) {
  return {
    kind: 'openai', base, auth: 'bearer', key: 'test-key', model: 'fake-llm',
    ctx: 32768, streaming: true, tools: true, json: true, think: false,
    /*
     * 검사가 7초를 기다릴 일은 아니다. 사다리를 짧게 준다 — 모양은 같다.
     *
     * 429 사다리(막힘base)도 같이 줄인다. 진짜 값은 5초·15초·30초라서, 안 줄이면
     * 이 파일 하나가 1분을 넘게 쓴다. **비율은 그대로 둔다** — 429 쪽이 여전히
     * 딸꾹질 쪽보다 확실히 느리다. 그 차이가 이 사다리가 둘인 이유다.
     */
    retry: { base: [40, 80, 160], 막힘base: [60, 120, 240] },
    ...추가,
  };
}

async function 돌리기(대본, { conn = 새연결(), signal = null, 중간에 = null } = {}) {
  script = 대본; turn = 0; hits.length = 0;
  /*
   * 창구별 할당량 기억을 비운다 (backend/quota.js).
   *
   * 그 표는 모듈 하나에 살아서 검사 칸막이를 넘는다. 앞 칸에서 429 를 맞으면
   * 「방금 막혔다」 가 적히고, 다음 칸의 첫 부름이 그걸 보고 **띄운다** — 제품에서는
   * 그게 맞는 동작이지만(그러라고 넣은 것이다), 여기서는 앞 칸이 뒤 칸을 흔드는 것이다.
   * 한 칸이 한 가지만 재게 비우고 시작한다.
   */
  할당량잊기();
  const session = new Session(conn, { root, mode: 'auto', think: 'off' });
  const events = [];
  /*
   * 걸린 시간은 **멎지 않는 시계**(performance.now)로 잰다. 벽시계(Date.now)는 시각
   * 맞추기가 끼면 앞뒤로 뛰어서, 부하가 걸린 날 「1초를 안 기다렸다」 를 거짓으로 만든다.
   */
  const t0 = performance.now();
  for await (const ev of run(session, ctx, '안녕', { signal })) {
    events.push(ev);
    중간에?.(ev);
  }
  return { events, session, ms: performance.now() - t0, kinds: events.map((e) => e.type) };
}

// ── 1. 429 한 번 → 이어서 된다 ───────────────────────────────────────────
trace('2-429한번');
{
  const r = await 돌리기([{ status: 429, retryAfter: 0 }, { text: '됐습니다' }]);
  check('턴이 끝까지 간다', r.kinds.includes('done'), r.kinds.join(','));
  check('두 번 불렀다', hits.length === 2, `${hits.length}번`);
  const b = r.events.find((e) => e.type === 'backoff');
  check('기다렸다 다시 부른다고 알린다', !!b, r.kinds.join(','));
  check('알림에 상태 코드·몇 번째인지가 있다', b?.status === 429 && b?.attempt === 1 && b?.max === 3, JSON.stringify(b));
  check('다시 부른 횟수를 센다', r.session.usage.retries === 1, String(r.session.usage.retries));
  check('답은 두 번째 것이다', r.events.find((e) => e.type === 'done')?.text === '됐습니다');
}

// ── 2. Retry-After 를 지킨다 (실제로 잰다) ──────────────────────────────
trace('3-RetryAfter');
{
  const r = await 돌리기([{ status: 503, retryAfter: 1 }, { text: '됐습니다' }]);
  check('503 뒤에도 끝까지 간다', r.kinds.includes('done'), r.kinds.join(','));
  /*
   * 재는 성질: **서버가 1초 뒤에 오라면 1초는 기다린다.**
   *
   * 아래쪽만 잰다. 위쪽을 5초로 막아 두면 그 5초가 재는 것은 코드가 아니라
   * 그날 이 컴퓨터가 얼마나 바쁜가다 — 검사가 늦었다고 빨개지는 날이 오고,
   * 그러면 다들 재검사를 눌러 넘긴다. 「사다리를 안 타고 서버 말을 따랐나」 는
   * 바로 아래 줄이 벽시계 없이 딱 떨어지는 값으로 대신 잰다.
   */
  check('Retry-After: 1 이면 1초는 기다린다 (아래쪽만 잰다)', r.ms >= 1000, `${r.ms}ms`);
  const b = r.events.find((e) => e.type === 'backoff');
  check('기다린 시간을 알림에 딱 1초로 적는다 (사다리가 아니라 서버 말)',
    b?.wait === 1000, JSON.stringify(b));
}

// ── 3. 계속 막으면 사실대로 말하고 곱게 끝난다 ──────────────────────────
trace('4-계속429');
{
  // 서버가 한 말에 숫자를 안 넣는다 — 그래야 '429' 가 우리 글에서 나온 것임이 확실하다.
  const 막힘 = { status: 429, retryAfter: 0, message: '할당량을 넘었습니다' };
  const r = await 돌리기([막힘, 막힘, 막힘, 막힘, { text: '여기까지 오면 안 된다' }]);
  check('네 번(처음 + 세 번) 부르고 멈춘다', hits.length === 4, `${hits.length}번`);
  const err = r.events.find((e) => e.type === 'error');
  check('오류로 끝난다', !!err && !r.kinds.includes('done'), r.kinds.join(','));
  check('오류 글에 상태 코드가 있다 (서버 글이 아니라 우리가 적은 것)', /HTTP 429/.test(err?.text ?? ''), err?.text);
  check('오류 글에 몇 번 불렀는지가 있다', /4번 불렀지만/.test(err?.text ?? ''), err?.text);
  check('서버가 한 말도 그대로 있다', /할당량을 넘었습니다/.test(err?.text ?? ''), err?.text);
  check('세 번 알렸다', r.events.filter((e) => e.type === 'backoff').length === 3);
  check('다시 부른 횟수 3', r.session.usage.retries === 3, String(r.session.usage.retries));

  // 어댑터가 던진 것 자체도 본다 — 루프가 화면에 내기 전의 모양.
  script = [막힘, 막힘, 막힘, 막힘]; turn = 0; hits.length = 0;
  let 던진것 = null;
  try { await chat(새연결(), { messages: [{ role: 'user', content: '안녕' }] }); } catch (e) { 던진것 = e; }
  check('어댑터 오류에 몇 번 불렀는지가 숫자로 있다', 던진것?.attempts === 4, String(던진것?.attempts));
  check('어댑터 오류에 서버가 한 말이 원문 그대로 있다', 던진것?.serverMessage === '할당량을 넘었습니다', String(던진것?.serverMessage));
  check('어댑터 오류 글에도 HTTP 429 와 4번이 있다', /HTTP 429/.test(던진것?.message ?? '') && /4번/.test(던진것?.message ?? ''), 던진것?.message);
  // 대화는 멀쩡해야 한다 — 다음 말을 걸 수 있어야 한다.
  check('대화에 반쪽짜리 assistant 가 안 남는다', !r.session.messages.some((m) => m.role === 'assistant' && !m.content && !m.tool_calls));
}

// ── 4. 머리말도 없이 끊기면 다시 부른다 ─────────────────────────────────
trace('5-끊김');
{
  const r = await 돌리기([{ reset: true }, { text: '됐습니다' }]);
  check('끊긴 뒤 다시 불러 끝까지 간다', r.kinds.includes('done'), r.kinds.join(','));
  check('두 번 불렀다', hits.length === 2, `${hits.length}번`);
  const b = r.events.find((e) => e.type === 'backoff');
  check('끊김은 코드 이름으로 알린다', b && b.status === 0 && /ECONNRESET|UND_ERR_SOCKET|EPIPE/.test(b.code ?? ''), JSON.stringify(b));
}

// ── 5. 글을 흘린 뒤에 끊긴 것은 다시 안 부른다 ──────────────────────────
trace('6-흘린뒤끊김');
{
  const r = await 돌리기([{ resetAfter: 30 }, { text: '여기까지 오면 안 된다' }]);
  check('한 번만 불렀다 — 반쯤 온 답을 두 벌 만들지 않는다', hits.length === 1, `${hits.length}번`);
  check('기다렸다 다시 부른다는 알림이 없다', !r.kinds.includes('backoff'), r.kinds.join(','));
  check('턴은 어쨌든 끝난다 (멈추지 않는다)', r.kinds.includes('error') || r.kinds.includes('done'), r.kinds.join(','));
  const 흘린 = r.events.filter((e) => e.type === 'content').map((e) => e.text).join('');
  check('끊기기 전에 흘러온 글은 화면에 남는다', 흘린 === 'x'.repeat(30), `${흘린.length}자`);
  check('다시 부른 횟수 0', (r.session.usage.retries ?? 0) === 0, String(r.session.usage.retries));
}

// ── 6. 기다리는 중에 Ctrl+C ─────────────────────────────────────────────
trace('7-기다리다끊기');
{
  const ac = new AbortController();
  let 끊은때 = 0;
  const r = await 돌리기([{ status: 429, retryAfter: 5 }, { text: '여기까지 오면 안 된다' }], {
    signal: ac.signal,
    중간에: (ev) => { if (ev.type === 'backoff') { 끊은때 = Date.now(); setTimeout(() => ac.abort(), 50); } },
  });
  check('중단으로 끝난다', r.kinds.includes('aborted'), r.kinds.join(','));
  // 재는 성질: 시킨 5초를 다 안 기다린다. 절대값(400ms)으로 잡으면 바쁜
  // 컴퓨터에서 빨개지는데, 그때 빨개지는 것은 코드가 아니라 그 컴퓨터다.
  check('끊자마자 멈춘다 (시킨 5초의 절반도 안 붙든다)',
    끊은때 && Date.now() - 끊은때 < 5000 / 2, `${Date.now() - 끊은때}ms / 5000ms`);
  check('두 번째는 안 불렀다', hits.length === 1, `${hits.length}번`);
  check('안 부른 것은 세지 않는다', (r.session.usage.retries ?? 0) === 0, String(r.session.usage.retries));
}

// ── 7. 스트리밍을 끈 길도 같다 — 알림은 기다리기 **전에** 나와야 한다 ───────
trace('8-비스트리밍');
{
  const 때 = {};
  const r = await 돌리기([{ status: 429, retryAfter: 1 }, { text: '됐습니다' }], {
    conn: 새연결({ streaming: false }),
    중간에: (ev) => { 때[ev.type] ??= performance.now(); },
  });
  check('스트리밍 없이도 다시 불러 끝까지 간다', r.kinds.includes('done'), r.kinds.join(','));
  check('두 번 불렀다', hits.length === 2, `${hits.length}번`);
  check('알림도 온다', r.kinds.includes('backoff'), r.kinds.join(','));
  check('Retry-After: 1 을 한 번에 받는 길에서도 지킨다 (아래쪽만 잰다)', r.ms >= 1000, `${r.ms}ms`);
  // 전에는 답을 다 받은 뒤에야 알림이 나왔다 — 60초 동안 '생각 중' 만 떠 있었다.
  check('알림이 답보다 먼저, 기다리기 전에 나온다', 때.backoff && 때.done && 때.done - 때.backoff >= 900, `${때.done - 때.backoff}ms 차이`);
  check('횟수도 센다', r.session.usage.retries === 1, String(r.session.usage.retries));

  // 한 번에 받는 길에서 기다리다 끊기 — 알림은 나왔고, 다시 부른 것은 아니다.
  const ac = new AbortController();
  const r2 = await 돌리기([{ status: 429, retryAfter: 5 }, { text: '여기까지 오면 안 된다' }], {
    conn: 새연결({ streaming: false }), signal: ac.signal,
    중간에: (ev) => { if (ev.type === 'backoff') setTimeout(() => ac.abort(), 50); },
  });
  // 여기도 재는 성질은 「시킨 5초를 다 안 기다린다」 다. 1500ms 로 잡으면
  // 절반이 넘게 여유가 있는데도 바쁜 컴퓨터에서 빨개진다.
  check('한 번에 받는 길에서도 기다리다 끊으면 시킨 5초의 절반도 안 붙든다',
    r2.kinds.includes('aborted') && r2.ms < 5000 / 2, `${r2.ms}ms / 5000ms · ${r2.kinds.join(',')}`);
  check('그때는 안 센다', (r2.session.usage.retries ?? 0) === 0, String(r2.session.usage.retries));
}

// ── 8. 400 은 한 번만 ────────────────────────────────────────────────────
trace('9-400');
{
  const r = await 돌리기([{ status: 400, message: '잘못된 요청' }, { text: '여기까지 오면 안 된다' }]);
  check('400 은 다시 안 부른다', hits.length === 1, `${hits.length}번`);
  check('서버가 한 말이 그대로 나온다', /잘못된 요청/.test(r.events.find((e) => e.type === 'error')?.text ?? ''));
  check('알림이 없다', !r.kinds.includes('backoff'));
}

// ── 9. 200 으로 받아 놓고 흐름 **안에서** 온 오류 ───────────────────────
trace('10-흐름속오류');
{
  /*
   * 게이트웨이(LiteLLM·OpenRouter)는 머리말을 200 으로 내보낸 뒤에 위층이
   * 막히면, 그 사실을 **흐름 안의 조각 하나**로 알린다 — `{"error":{...}}`.
   *
   * 여태 이 조각은 choices 가 없어서 조용히 버려졌다. 답이 비었으니 루프는
   * 「스트리밍이 안 맞는 서버」 로 읽고 **세션 내내 흘려받기를 껐다.** 서버가
   * 한 말(429 · 예산 초과)은 어디에도 안 남았다. 잠깐 막힌 것 하나로 그 뒤
   * 모든 턴이 한 번에 받기로 떨어지고, 사람은 끝내 까닭을 못 본다.
   */
  const conn = 새연결();
  const r = await 돌리기([
    { 흐름오류: { error: { message: 'litellm.RateLimitError: upstream 429', code: '429' }, choices: [{ index: 0, delta: {}, finish_reason: 'error' }] } },
    { text: '됐습니다' },
  ], { conn });
  check('★★★ 흐름 속 429 조각은 HTTP 429 처럼 기다렸다 다시 부른다',
    hits.length === 2 && r.kinds.includes('done'), `${hits.length}번 · ${r.kinds.join(',')}`);
  const b = r.events.find((e) => e.type === 'backoff');
  check('★★ 알림에 서버가 말한 상태가 적힌다', b?.status === 429, JSON.stringify(b));
  check('★★★ 그 한 번으로 세션의 흘려받기를 끄지 않는다', conn.streaming === true, String(conn.streaming));
  check('★★ 「스트리밍이 비어서」 라는 거짓 까닭을 안 적는다',
    !r.events.some((e) => /스트리밍/.test(String(e.text ?? e.why ?? ''))),
    JSON.stringify(r.events.filter((e) => e.type === 'note' || e.type === 'retry')));

  // 상태를 모르는 것 — 다시 불러 봐야 같다. 서버가 한 말을 그대로 보여 준다.
  const conn2 = 새연결();
  const r2 = await 돌리기([
    { 흐름오류: { error: { message: 'Budget has been exceeded for key' } } },
    { text: '여기까지 오면 안 된다' },
  ], { conn: conn2 });
  const 오류 = r2.events.find((e) => e.type === 'error');
  check('★★★ 상태를 모르는 흐름 속 오류는 서버 말 그대로 오류가 된다',
    /Budget has been exceeded/.test(오류?.text ?? ''), `${오류?.text} · ${r2.kinds.join(',')}`);
  check('★★ 그런 것은 다시 안 부른다', hits.length === 1, `${hits.length}번`);
  check('★★ 그래도 흘려받기는 켜 둔다', conn2.streaming === true, String(conn2.streaming));

  /*
   * 한 번에 받는 길도 같다. 200 몸에 `{"error":{...}}` 만 온 것을 extractMessage
   * 가 빈 답으로 읽고 있었다 — 「서버가 빈 답을 보냈습니다」 가 뜨고 예산이
   * 떨어졌다는 한 줄은 사라졌다.
   */
  script = [{ 몸오류: { error: { message: 'Budget exceeded for key', type: 'budget_exceeded' } } }]; turn = 0; hits.length = 0;
  let 던진 = null;
  let 받은 = null;
  try { 받은 = await chat(새연결(), { messages: [{ role: 'user', content: '안녕' }] }); } catch (e) { 던진 = e; }
  check('★★★ 한 번에 받는 길도 200 몸의 error 를 빈 답으로 삼키지 않는다',
    /Budget exceeded for key/.test(던진?.message ?? ''), JSON.stringify({ 받은, 말: 던진?.message }));
  check('★ 서버 말이 원문 그대로 달린다', 던진?.serverMessage === 'Budget exceeded for key', String(던진?.serverMessage));

  script = [{ 몸오류: { error: { message: 'Overloaded', type: 'overloaded_error' } } }, { text: '됐습니다' }]; turn = 0; hits.length = 0;
  할당량잊기();
  let 받은2 = null;
  try { 받은2 = await chat(새연결(), { messages: [{ role: 'user', content: '안녕' }] }); } catch (e) { 받은2 = { 탈: e.message }; }
  check('★★ 200 몸의 과부하도 529 처럼 다시 부른다',
    hits.length === 2 && 받은2?.content === '됐습니다', `${hits.length}번 · ${JSON.stringify(받은2)}`);

  /*
   * 까닭을 `message` 가 아니라 `detail` 에 싣는 창구 (FastAPI 로 앞을 세운 게이트웨이의
   * 기본 모양이다). 글을 읽는 자리는 진작 `detail` 을 보는데, **실패인지 가르는** 자리에
   * 그 이름이 없어서 그 몸이 통째로 「뜻 없는 error」 로 버려졌다 — 답이 비고, 서버가
   * 적어 준 한 줄은 어디에도 안 남는다. 빈 답은 이 파일에서 제일 비싼 고장이다.
   */
  script = [{ 몸오류: { error: { detail: 'upstream refused: deployment not found' } } }]; turn = 0; hits.length = 0;
  할당량잊기();
  let 디테일탈 = null;
  let 받은3 = null;
  try { 받은3 = await chat(새연결(), { messages: [{ role: 'user', content: '안녕' }] }); } catch (e) { 디테일탈 = e; }
  check('★★★ 200 몸의 error.detail 도 빈 답으로 삼키지 않는다',
    /deployment not found/.test(디테일탈?.message ?? ''), JSON.stringify({ 받은3, 말: 디테일탈?.message }));
}

// ── 10. 생각 글 칸 이름이 `reasoning` 인 창구 ────────────────────────────
trace('11-reasoning');
{
  /*
   * OpenRouter · Ollama 의 /v1 · vLLM 새 판은 생각 글을 `reasoning` 에 싣는다.
   * 여태 `reasoning_content` 만 읽어서 한 번에 받는 길에서 생각이 통째로 사라졌다.
   */
  script = [{ text: '답', 생각: '생각글' }]; turn = 0; hits.length = 0;
  const 것 = await chat(새연결(), { messages: [{ role: 'user', content: '안녕' }] });
  check('★★ 한 번에 받는 길이 message.reasoning 을 생각으로 읽는다', 것.thinking === '생각글', JSON.stringify(것.thinking));
}

// ── 11. 200 으로 HTML 페이지를 주는 프록시 ──────────────────────────────
trace('12-HTML200');
{
  /*
   * 사내 프록시는 로그인 페이지를 **200 으로** 준다. 흘려받기로 읽으면 JSON 이 한
   * 줄도 없어 빈 답이다. 루프는 이 자리를 이미 받는다 — 스트리밍을 끄고 한 번 더
   * 부르고, 그래도 비면 「서버가 빈 답을 보냈습니다」 와 짚을 자리(프록시)를 적는다.
   *
   * 흘려읽기가 몸 속 오류를 읽고 SSE 를 규격대로 읽게 되면서 이 길이 **안 바뀌었는지**
   * 못 박는다. HTML 은 오류 조각이 아니라서 빈 답 길로 가야 한다. 그리고 한 번에
   * 받기로도 안 됐으면 흘려받기를 끄지 않는다 — 탓이 흘려받기가 아니었다.
   */
  const 페이지 = '<!doctype html>\n<html><body>\n<h1>Sign in to corp proxy</h1>\n</body></html>\n';
  const conn = 새연결();
  const r = await 돌리기([{ html: 페이지 }, { html: 페이지 }, { text: '여기까지 오면 안 된다' }], { conn });
  check('★★ HTML 200 이 빈 답이면 스트리밍을 끄고 한 번 더 부른다',
    hits.length === 2 && r.events.some((e) => e.type === 'retry' && /스트리밍을 끄고/.test(e.why ?? '')),
    `${hits.length}번 · ${JSON.stringify(r.events.filter((e) => e.type === 'retry'))}`);
  const 오류 = r.events.find((e) => e.type === 'error');
  check('★★ 그래도 비면 빈 답이라고 말하고 프록시를 짚는다',
    /빈 답/.test(오류?.text ?? '') && /프록시/.test(오류?.text ?? ''), String(오류?.text));
  check('★ 빈 답을 끝난 답으로 넘기지 않는다', !r.kinds.includes('done'), r.kinds.join(','));
  check('★ 한 번에 받기로도 안 됐으면 흘려받기를 끄지 않는다', conn.streaming === true, String(conn.streaming));
}

/*
 * ── 울타리가 둘이다: 횟수와 총 시간 ─────────────────────────────────────
 *
 * 429 는 「틀렸다」 가 아니라 「지금은 안 된다」 라, 참을 횟수를 따로 올릴 수
 * 있어야 한다(사내 게이트웨이는 할당량이 자주 찬다). 그런데 횟수만 올리면
 * 사다리가 길어져 사람이 **왜 멈춰 있는지 모르는 채로** 몇 분을 본다.
 *
 * 그래서 시간 울타리를 같이 둔다. 둘은 서로를 대신하지 못한다 —
 * 횟수만 있으면 한 번이 아주 길 때 못 막고, 시간만 있으면 짧게 여러 번을
 * 못 막는다.
 */
{
  const 정책 = 기본정책();
  check('기본은 여태와 같다 (429 도 최대 를 쓴다)',
    정책.막힘최대 === null && 다시부를까({ status: 429, attempt: 3 }, 정책) === true
      && 다시부를까({ status: 429, attempt: 4 }, 정책) === false);

  const 참는정책 = { ...정책, 막힘최대: 8 };
  check('★ 429 만 따로 더 참게 할 수 있다',
    다시부를까({ status: 429, attempt: 6 }, 참는정책) === true,
    '429 6번째');
  check('★ 다른 코드는 안 늘어난다',
    다시부를까({ status: 503, attempt: 6 }, 참는정책) === false,
    '503 6번째');

  /*
   * ★ 쌓인 기다림이 총상한을 넘으면 더 안 부른다.
   *
   * 여기서 null 을 돌려주는 것이 곧 「사실대로 말하고 끝낸다」 다. 조용히
   * 계속 기다리면 화면이 멈춘 것과 구별이 안 된다.
   */
  // 재는 것은 총상한 울타리다. 429 로 재고 있으니 429 쪽 사다리(막힘base)를 줘야
  // 한다 — 안 주면 진짜 사다리(5초)가 울타리(2.5초)를 첫 칸에서 넘어, 울타리가
  // 아니라 사다리를 재는 검사가 된다.
  const 짧은정책 = { ...정책, base: [1000, 1000, 1000], 막힘base: [1000, 1000, 1000], 흔들림: 0, 총상한: 2500 };
  check('★ 아직 여유가 있으면 부른다',
    다시부를지({ status: 429 }, 1, 짧은정책, 0) !== null);
  check('★ 총상한을 넘으면 안 부른다',
    다시부를지({ status: 429 }, 2, 짧은정책, 2000) === null,
    JSON.stringify(다시부를지({ status: 429 }, 2, 짧은정책, 2000)));
  check('★ 쌓인 것이 없으면 같은 시도도 부른다',
    다시부를지({ status: 429 }, 2, 짧은정책, 0) !== null);
  check('★ 총상한이 없으면 시간으로는 안 막는다',
    다시부를지({ status: 429 }, 2, { ...짧은정책, 총상한: null }, 999999) !== null);

  // 알림에 적히는 최대치도 429 쪽 값을 따라간다 — 화면이 "2/3" 라고
  // 적는데 실제로는 여덟 번 참는다면, 그 화면은 거짓말이다.
  const 알림 = 다시부를지({ status: 429 }, 1, 참는정책, 0);
  check('★ 화면에 적히는 횟수도 429 것을 쓴다', 알림?.max === 8, String(알림?.max));

  /*
   * ── ★★★ 안 부르는 까닭이 둘인데 화면은 한 가지로 말했다 ────────────────
   *
   * 사람이 본 것: `retry.막힘최대` 를 8 로 올려 뒀는데 화면은 여전히
   * 「5번 불렀지만 계속 막혔습니다 (HTTP 429)」 에서 멎었다. 자기가 올린
   * 값이 아무 일도 안 하는 것처럼 보인다.
   *
   * 실제로는 여덟 번을 채우기 전에 **우리 쪽 시간 울타리**(총상한)가 먼저
   * 닫힌 것이다. `Retry-After` 가 실려 오면 한 번에 60초까지 기다리니
   * 대여섯 번이면 5분이 찬다.
   *
   * 그런데 이 함수는 「다시 부를 것이 아니다」 와 「우리 예산을 다 썼다」 에
   * 똑같이 null 을 돌려줬다. 부르는 쪽은 가를 길이 없어 둘 다 서버 탓으로
   * 적었다 — 앞은 서버를 볼 일이고 뒤는 우리 설정을 올리면 되는 일인데도.
   */
  const 예산끝 = {};
  check('★★★ 총상한에 걸린 것은 「예산」 이라고 적어 준다',
    다시부를지({ status: 429 }, 2, 짧은정책, 2000, 예산끝) === null && 예산끝.까닭 === 못부른까닭.예산,
    JSON.stringify(예산끝));
  check('★★ 얼마짜리 울타리였는지도 적어 준다',
    예산끝.총상한 === 2500 && 예산끝.쌓인 === 2000 && 예산끝.다음대기 === 1000,
    JSON.stringify(예산끝));

  const 안될것 = {};
  check('★★★ 다시 불러 봐야 같은 것은 다른 까닭이다',
    다시부를지({ status: 400 }, 1, 짧은정책, 0, 안될것) === null && 안될것.까닭 === 못부른까닭.안될것,
    JSON.stringify(안될것));
  const 횟수끝 = {};
  다시부를지({ status: 429 }, 9, 짧은정책, 0, 횟수끝);
  check('★★★ 횟수를 다 쓴 것도 예산 탓이 아니다', 횟수끝.까닭 === 못부른까닭.안될것,
    JSON.stringify(횟수끝));

  check('★★★ 예산이면 사람이 올릴 설정 이름을 말해 준다',
    /retry\.총상한/.test(못부른말(예산끝) ?? ''), String(못부른말(예산끝)));
  check('★★★ 그리고 서버가 막은 것이 아니라고 못 박는다',
    /여기서 그만둔 것/.test(못부른말(예산끝) ?? ''), String(못부른말(예산끝)));
  check('★★ 예산이 아닌 것에는 그 말을 안 붙인다 — 있는 말만 한다',
    못부른말(안될것) === null && 못부른말(null) === null, String(못부른말(안될것)));

  // 적을 자리를 안 줘도 여태와 똑같이 돈다. 부르는 데가 여럿이라 모양을 안 바꾼다.
  check('★★ 자리를 안 주면 여태 그대로다',
    다시부를지({ status: 429 }, 1, 짧은정책, 0) !== null
    && 다시부를지({ status: 429 }, 2, 짧은정책, 2000) === null, '');
}

/*
 * ── ★★★ 그 까닭이 **화면까지** 와야 한다 ──────────────────────────────
 *
 * 위 칸은 retry.js 가 까닭을 적어 준다는 것만 잰다. 그런데 그 새 자리를
 * 어댑터가 한 군데도 안 썼다 — 두 부르는 자리가 `적을곳` 을 안 넘겼다.
 * 그래서 `retry.막힘최대` 를 8 로 올려 둔 사람이 보는 글은 여전히
 * 「n번 불렀지만 계속 막혔습니다 (HTTP 429)」 다. 고친 쪽은 아무도 안 쓰고
 * 사람 이야기는 그대로 남아 있는, 반쪽만 한 고침이다.
 *
 * 재는 것: 우리 예산이 먼저 닫혔으면 **우리 설정 이름**을 말하고, 서버가
 * 계속 막았다는 말은 **안 한다.** 두 길(한 번에 받기·흘려 받기)이 같아야 한다.
 */
trace('11-예산이끝난것을화면까지');
{
  // 흔들림을 끄고 사다리를 짧게 줘서 몇 번째에 울타리가 닫히는지 딱 떨어지게 한다.
  const 울타리 = { 막힘최대: 8, 최대: 8, 흔들림: 0, base: [40, 80, 160], 막힘base: [40, 80, 160], 총상한: 100 };
  const 막힘 = { status: 429, message: '할당량을 넘었습니다' };
  const 재기 = async (흘려) => {
    script = [막힘, 막힘, 막힘, 막힘, 막힘, 막힘, 막힘, 막힘, 막힘]; turn = 0; hits.length = 0;
    할당량잊기();
    const conn = 새연결({ retry: 울타리 });
    let 탈 = null;
    try {
      if (흘려) { for await (const _ of chatStream(conn, { messages: [{ role: 'user', content: '안녕' }] })) { /* 알림만 흘러온다 */ } }
      else await chat(conn, { messages: [{ role: 'user', content: '안녕' }] });
    } catch (e) { 탈 = e; }
    return { 글: 탈?.message ?? '', 부름: hits.length };
  };

  for (const [이름, 흘려] of [['한 번에 받는 길', false], ['흘려 받는 길', true]]) {
    const r = await 재기(흘려);
    check(`★★★ ${이름}: 예산이 먼저 닫히면 올릴 설정 이름(retry.총상한)을 말한다`,
      /retry.총상한/.test(r.글), r.글);
    check(`★★★ ${이름}: 그때 「계속 막혔습니다」 라고 서버 탓을 하지 않는다`,
      !/계속 막혔습니다/.test(r.글), r.글);
    check(`★★ ${이름}: 서버가 한 말은 그대로 남는다`,
      /할당량을 넘었습니다/.test(r.글), r.글);
    check(`★★ ${이름}: 막힘최대(8)를 다 쓰기 전에 멎은 것이 맞다`,
      r.부름 > 1 && r.부름 < 8, `${r.부름}번`);
  }

  /*
   * 반대쪽. 예산이 아니라 **횟수**를 다 썼으면 여태 하던 말이 맞는 말이다 —
   * 새 말이 옛 말을 밀어내면 그건 고친 게 아니라 자리만 바꾼 것이다.
   */
  script = [막힘, 막힘, 막힘, 막힘]; turn = 0; hits.length = 0;
  할당량잊기();
  let 횟수탈 = null;
  try {
    await chat(새연결({ retry: { 흔들림: 0, base: [10, 10, 10], 막힘base: [10, 10, 10] } }),
      { messages: [{ role: 'user', content: '안녕' }] });
  } catch (e) { 횟수탈 = e; }
  check('★★★ 횟수를 다 쓴 것에는 여태 하던 말 그대로다',
    /계속 막혔습니다/.test(횟수탈?.message ?? '') && !/retry.총상한/.test(횟수탈?.message ?? ''),
    횟수탈?.message);
}

// ── 결과 ────────────────────────────────────────────────────────────────
const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n잠깐 막혔을 때 다시 부르기 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);

server.closeAllConnections?.();
server.close();
await new Promise((r) => setImmediate(r));
rmSync(root, { recursive: true, force: true });
process.exitCode = fail.length ? 1 : 0;
