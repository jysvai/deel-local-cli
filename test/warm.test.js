/**
 * 미리 읽기 (2.2.0 · agent/warm.js) — 모델을 미리 올리고, 치는 동안 앞머리를 먼저 읽힌다.
 *
 * 이 기능의 값은 단 하나에 달렸다: **미리 보낸 몸의 앞머리가 Enter 뒤 첫 요청과 같은가.**
 * 한 글자라도 다르면 서버 캐시가 거기서 끊기고 미리 한 계산은 버려진다 — 그런데 그건
 * 오류가 아니라서 아무 데도 안 찍히고, 답도 멀쩡히 온다. 느린 것만 그대로다. 그래서
 * 진짜 루프(run)를 가짜 서버에 붙여 두 몸을 바이트로 견준다 (Ollama · OpenAI 규격 둘 다).
 *
 * 나머지는 돈과 시간 쪽이다 — 바깥·유료 모델에서는 저절로 안 켜지고, 쉼마다 하나만
 * 나가고, Enter 뒤 첫 부름은 돌던 것을 기다렸다 간다(같은 앞머리를 두 자리에서 두 번
 * 읽지 않게).
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { route } from '../src/agent/route.js';
import { allowEndpoint } from '../src/safety/network.js';
import { 미리읽기, 예열판정, 보낼초안 } from '../src/agent/warm.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 쉬기 = (ms) => new Promise((r) => setTimeout(r, ms));
async function 될때까지(조건, ms = 3000) {
  const 끝 = Date.now() + ms;
  while (Date.now() < 끝) { if (조건()) return true; await 쉬기(10); }
  return 조건();
}

const root = mkdtempSync(join(tmpdir(), 'deel-warm-'));
writeFileSync(join(root, 'app.js'), 'const port = 7080;\nstart(port);\n', 'utf8');
const 문맥 = () => ({ scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() });
const 연결 = (o = {}) => ({
  kind: 'ollama', base: 'http://127.0.0.1:11434', auth: 'none', model: 'qwen2.5-coder:7b',
  ctx: 8192, streaming: true, tools: true, json: true, think: false, ...o,
});
const 세션 = (o = {}, s = {}) => new Session(연결(o), { root, work: 'auto', ...s });

// ══ 1. 켤지 말지 ══════════════════════════════════════════════════════════
{
  const 판 = (o, 더 = {}) => 예열판정(세션(o), { env: {}, ...더 });
  check('이 PC 의 Ollama 는 저절로 켠다', 판({}).켬 === true && 판({}).왜 === '로컬', JSON.stringify(판({})));
  check('사내망(192.168.*) OpenAI 호환도 켠다', 판({ kind: 'openai', base: 'http://192.168.0.10:8000/v1' }).켬 === true);
  check('★ 바깥 주소는 저절로 안 켠다', 판({ kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-5' }).왜 === '바깥');
  check('★ Ollama 클라우드 모델(…-cloud)은 127.0.0.1 이어도 안 켠다', 판({ model: 'gpt-oss:120b-cloud' }).왜 === '클라우드모델');
  for (const 이름 of ['glm-4.6:cloud', 'deepseek-v3.1:671b-cloud', 'kimi-k2-cloud:latest', 'qwen3-coder:480b-CLOUD']) {
    check(`★ 클라우드 이름 꼴 ${이름} 도 거른다 (끝에만 걸면 :latest 가 빠진다)`, 판({ model: 이름 }).왜 === '클라우드모델');
  }
  check('이름에 cloud 마디가 없는 이 PC 모델은 그대로 켠다 (cloudy·soundcloud 는 마디가 아니다)',
    ['qwen2.5-coder:7b', 'cloudy-7b', 'soundcloudnet:1b'].every((m) => 판({ model: m }).켬 === true));
  {
    // 127.0.0.1 의 프록시가 유료 모델로 넘기는 판 — 주소만 보면 「로컬」 이다.
    const s = 세션({ kind: 'openai', base: 'http://127.0.0.1:4000/v1', model: 'paid-model' });
    s.요금표 = { 'paid-model': { 입력: 3, 출력: 15 } };
    const r = 예열판정(s, { env: {} });
    check('★ 요금이 매겨진 모델은 127.0.0.1 이어도 안 켠다', r.켬 === false && r.왜 === '요금', JSON.stringify(r));
  }
  check('DEEL_WARMUP=0 이면 끈다', 판({}, { env: { DEEL_WARMUP: '0' } }).왜 === '꺼둠');
  check('설정 "warmup": false 면 끈다', 판({}, { cfg: { warmup: false } }).왜 === '꺼둠');
  check('DEEL_WARMUP=1 은 바깥에서도 켠다 (사람이 고른 것)', 판({ kind: 'openai', base: 'https://api.openai.com/v1' }, { env: { DEEL_WARMUP: '1' } }).켬 === true);
  check('환경변수가 설정을 이긴다', 판({}, { env: { DEEL_WARMUP: '1' }, cfg: { warmup: false } }).켬 === true);
}

// ══ 2. 무엇을 보내나 ══════════════════════════════════════════════════════
check('명령(/…)은 안 보낸다', 보낼초안('/help') === null && 보낼초안('  /model') === null);
check('셸(!…)은 안 보낸다', 보낼초안('!ls') === null);
check('@파일 은 그 앞까지만 (Enter 때 파일로 펼쳐진다)', 보낼초안('  고쳐 @a.js 줘 ') === '고쳐');
check('앞뒤 빈칸은 repl 처럼 다듬는다', 보낼초안('  포트 바꿔줘  ') === '포트 바꿔줘');

// ══ 3. 언제 몇 번 보내나 (가짜 부르기) ═══════════════════════════════════
{
  const 부른것 = [];
  let 풀어줘 = [];
  let 실패시킴 = false;
  const 부르기 = (conn, opts) => new Promise((ok, no) => {
    부른것.push(opts);
    풀어줘.push(() => (실패시킴 ? no(new Error('HTTP 400 bad')) : ok({ usage: { in: 100 } })));
  });
  const 다풀기 = () => { const f = 풀어줘; 풀어줘 = []; for (const x of f) x(); };
  const s = 세션();
  const 판 = new 미리읽기(s, 문맥(), { env: {}, 쉼: 30, 부르기 });
  const 마지막말 = () => 부른것.at(-1)?.messages.at(-1)?.content;

  판.풀기();
  await 될때까지(() => 부른것.length === 1);
  check('입력칸이 뜨면 바로 한 번 (빈 말 — 모델 올리기)', 부른것.length === 1 && 마지막말() === '', `${부른것.length}`);
  check('답은 한 토큰으로 막고 다시 부르지 않는다', 부른것[0].maxTokens === 1 && 부른것[0].retry?.최대 === 0);
  판.쳤다('a'); 판.쳤다('ab'); 판.쳤다('abc');
  await 쉬기(80);
  check('★ 나가 있는 동안에는 더 안 보낸다 (하나만)', 부른것.length === 1, `${부른것.length}`);
  다풀기();
  await 될때까지(() => 부른것.length === 2);
  check('★ 끝나면 그동안 친 마지막 글로 이어 보낸다 (a·ab 는 건너뜀)', 부른것.length === 2 && 마지막말() === 'abc', `${부른것.length} ${마지막말()}`);
  다풀기();
  await 될때까지(() => !판.상태().도는중);
  판.쳤다('abcd'); 판.쳤다('abcde');
  check('★ 친 글이 아직 안 나갔으면 대기중 — 지난 결과로 「↯ 미리 읽음」 을 안 띄운다', 판.상태().대기중 === true && 판.상태().마지막?.ok === true, JSON.stringify(판.상태()));
  await 쉬기(80);
  check('★ 손을 떼고 쉼이 지나야 한 번 — 키마다 안 나간다', 부른것.length === 3 && 마지막말() === 'abcde', `${부른것.length} ${마지막말()}`);
  다풀기();
  await 될때까지(() => !판.상태().도는중);
  판.쳤다('abcde');
  await 쉬기(80);
  check('다 읽힌 것과 같은 몸은 다시 안 보낸다', 부른것.length === 3, `${부른것.length}`);
  check('안 보낸 판도 대기중을 거둔다 (↯ 가 흐린 채 남지 않게)', 판.상태().대기중 === false);

  // Enter — 잠그면 걸어 둔 쉼 시계도 걷힌다.
  판.쳤다('abcdef');
  판.잠그기();
  await 쉬기(80);
  check('★ Enter 뒤에는 새로 안 보낸다 (그 턴의 모델이다)', 부른것.length === 3, `${부른것.length}`);

  // 기다리기 — 나가 있는 것이 끝나야 돌아온다.
  판.풀기();
  await 될때까지(() => 부른것.length === 4);
  판.잠그기();
  let 돌아옴 = false;
  const 기다림 = 판.기다리기().then(() => { 돌아옴 = true; });
  await 쉬기(40);
  check('★ 기다리기는 나가 있는 것이 끝날 때까지 안 돌아온다', 돌아옴 === false);
  다풀기();
  await 기다림;
  check('끝나면 돌아온다', 돌아옴 === true);
  {
    판.풀기();
    판.쳤다('끊을것');
    await 될때까지(() => 판.상태().도는중);
    판.잠그기();
    const 멈춤 = new AbortController();
    const t = Date.now();
    setTimeout(() => 멈춤.abort(), 30);
    await 판.기다리기(멈춤.signal);
    check('Ctrl+C(멈춤 신호)면 기다리지 않고 간다', Date.now() - t < 1000, `${Date.now() - t}ms`);
    다풀기();
    await 될때까지(() => !판.상태().도는중);
  }

  // 상한(기다림)이 먼저 오면 나가 있던 것을 끊는다 — 안 끊으면 진짜 요청과 두 자리에서 같은 앞머리를 읽는다.
  {
    let 받은신호 = null;
    const 안끝남 = (conn, opts) => new Promise((_, no) => {
      받은신호 = opts.signal;
      opts.signal.addEventListener('abort', () => no(Object.assign(new Error('끊김'), { name: 'Aborted' })), { once: true });
    });
    // 상한 시계는 unref 다(그 시계 하나로 프로그램이 안 꺼지면 안 된다). 대화 화면은 stdin 이 붙들지만
    // 이 검사에는 붙든 것이 없어, 그동안만 붙들어 둔다 — 안 그러면 프로세스가 먼저 끝난다.
    const 붙듦 = setInterval(() => {}, 1000);
    const 판2 = new 미리읽기(세션(), 문맥(), { env: {}, 쉼: 10, 기다림: 60, 부르기: 안끝남 });
    판2.풀기();
    await 될때까지(() => 받은신호 !== null);
    판2.잠그기();
    const t = Date.now();
    await 판2.기다리기();
    check('★ 상한이 지나면 돌아오고, 나가 있던 미리 읽기를 끊는다', Date.now() - t < 1000 && 받은신호.aborted === true, `${Date.now() - t}ms aborted=${받은신호.aborted}`);
    await 될때까지(() => !판2.상태().도는중);
    check('끊긴 것은 실패로 안 센다 (서버가 거절한 게 아니다)', 판2.상태().켬 === true && 판2.상태().마지막 === null, JSON.stringify(판2.상태()));
    받은신호 = null;
    판2.풀기();
    await 될때까지(() => 받은신호 !== null);
    판2.잠그기();
    const 멈춤 = new AbortController();
    setTimeout(() => 멈춤.abort(), 20);
    await 판2.기다리기(멈춤.signal);
    check('Ctrl+C(멈춤)로 돌아올 때는 안 끊는다 — 읽던 앞머리는 다음 말에 쓰인다', 받은신호.aborted === false);
    판2.끄기();
    clearInterval(붙듦);
  }

  // 잇달아 거절되면 이 연결에서는 그만.
  실패시킴 = true;
  판.풀기(); 판.쳤다('x1');
  await 될때까지(() => 판.상태().도는중);
  다풀기();
  await 될때까지(() => 부른것.at(-1)?.messages.at(-1)?.content === 'x1' && 판.상태().도는중);
  다풀기();
  await 될때까지(() => !판.상태().도는중);
  check('★ 두 번 잇달아 거절되면 끈다 (안 받는 서버를 쉴 때마다 두드리지 않는다)', 판.상태().켬 === false && 판.상태().왜 === '서버거절', JSON.stringify(판.상태()));
  const 끈뒤 = 부른것.length;
  판.풀기(); 판.쳤다('x2');
  await 쉬기(80);
  check('끈 뒤로는 안 나간다', 부른것.length === 끈뒤);
  실패시킴 = false;
  s.conn.model = 'qwen3:8b';
  판.풀기();
  await 될때까지(() => 부른것.length === 끈뒤 + 1);
  check('★ 모델을 갈아타면 다시 본다 (/model)', 판.상태().켬 === true && 부른것.length === 끈뒤 + 1, `${JSON.stringify(판.상태())} ${부른것.length}`);
  check('★ 갈아타면 셈도 새로 — 앞 모델이 읽은 것을 새 모델의 것처럼 안 보인다', 판.상태().횟수 === 1 && 판.상태().읽은토큰 === 0 && 판.상태().마지막 === null, JSON.stringify(판.상태()));
  다풀기();
}

// ══ 4. 미리 보낸 몸 = Enter 뒤 첫 요청 몸 (진짜 루프 · 가짜 서버) ═════════════
const 받은 = [];
let 미리늦춤 = 0;
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', async () => {
    let 몸 = {};
    try { 몸 = JSON.parse(body); } catch { /* 빈 몸 */ }
    const 미리 = 몸.stream !== true && (몸.options?.num_predict === 1 || 몸.max_tokens === 1);
    받은.push({ 길: req.url, 몸, 미리, 닿음: Date.now() });
    if (미리 && 미리늦춤) await 쉬기(미리늦춤);
    if (req.url.endsWith('/api/chat')) {
      if (미리) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ model: 몸.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'length', prompt_eval_count: 900, eval_count: 1 }));
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ model: 몸.model, message: { role: 'assistant', content: '포트를 바꿨습니다.' }, done: false }) + '\n');
      return res.end(JSON.stringify({ model: 몸.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 12, eval_count: 5 }) + '\n');
    }
    if (미리) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 900, completion_tokens: 1 } }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '포트를 바꿨습니다.' } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5 } })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const 포트 = server.address().port;

/** repl 이 Enter 때 하는 그대로 — 종합 모드면 그 말로 모드를 고르고 턴을 돈다. */
async function 턴(session, ctx, 말) {
  session.routed = null;
  if (session.work === 'auto') session.routed = route(말).mode ?? null;
  for await (const _ of run(session, ctx, 말)) { /* 끝까지 */ }
}
const 앞머리 = (몸) => JSON.stringify({ model: 몸.model, messages: 몸.messages, tools: 몸.tools, think: 몸.think, num_ctx: 몸.options?.num_ctx, keep_alive: 몸.keep_alive });

for (const [이름, o] of [
  ['Ollama', { kind: 'ollama', base: `http://127.0.0.1:${포트}` }],
  ['OpenAI 호환(LM Studio·llama.cpp)', { kind: 'openai', base: `http://127.0.0.1:${포트}/v1`, auth: 'none', model: 'local-model' }],
]) {
  for (const [갈래, 세션덧, 말] of [
    ['첫 턴 · 생각 끔', { think: 'off' }, 'app.js 의 포트를 7099 로 바꿔줘'],
    ['첫 턴 · 생각 기본값', {}, '이 함수가 왜 느린지 설명해줘'],
  ]) {
    allowEndpoint(o.base);
    받은.length = 0;
    const s = 세션(o, 세션덧);
    const ctx = 문맥();
    const 판 = new 미리읽기(s, ctx, { env: {}, 쉼: 10 });
    s.미리읽기 = 판;
    판.풀기();
    await 될때까지(() => !판.상태().도는중 && 판.상태().횟수 === 1);
    판.쳤다(말);
    await 될때까지(() => !판.상태().도는중 && 판.상태().횟수 === 2);
    판.잠그기();
    await 턴(s, ctx, 말);
    const 미리것 = 받은.filter((x) => x.미리);
    const 진짜 = 받은.find((x) => !x.미리);
    check(`${이름} · ${갈래}: 빈 말로 한 번, 친 글로 한 번 미리 나갔다`, 미리것.length === 2 && 미리것[1].몸.messages.at(-1).content === 말, `${미리것.length}`);
    check(`★★ ${이름} · ${갈래}: 미리 보낸 몸 = Enter 뒤 첫 요청 몸 (시킴말·도구·생각·창)`, !!진짜 && 앞머리(미리것[1].몸) === 앞머리(진짜.몸),
      진짜 ? 어긋난곳(앞머리(미리것[1].몸), 앞머리(진짜.몸)) : '진짜 요청이 없다');
    /*
     * 빈 말 예열은 모드를 아직 모른다 — 모드는 친 말이 정한다(route). 그래서 같아야 하는 것은
     * 시킴말의 **굳은 부분**까지다(agent/session.js 의 시스템조각). 모드 꼬리부터는 치다 멈출 때 읽힌다.
     */
    const 굳은 = s.시스템조각()[0];
    const 시킴 = (x) => String(x?.몸.messages?.[0]?.content ?? '');
    check(`${이름} · ${갈래}: 빈 말 예열도 시킴말의 굳은 부분은 같다 (켤 때 모델 올리기 + 앞머리)`,
      !!진짜 && 굳은.length > 1000 && 시킴(미리것[0]).startsWith(굳은) && 시킴(진짜).startsWith(굳은), `굳은 ${굳은.length}자`);
    if (o.kind === 'ollama') {
      check(`${이름} · ${갈래}: 미리 올릴 때도 같은 num_ctx·keep_alive (다시 올리지 않게)`,
        미리것[0].몸.options?.num_ctx === 8192 && 미리것[0].몸.keep_alive === 진짜?.몸.keep_alive);
    }
    check(`${이름} · ${갈래}: 새로 읽은 토큰을 센다`, 판.상태().읽은토큰 === 1800, String(판.상태().읽은토큰));
  }
}

function 어긋난곳(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i >= a.length && a.length === b.length ? '' : `${i}번째 글자에서 갈림: 미리「${a.slice(Math.max(0, i - 40), i + 60)}」 진짜「${b.slice(Math.max(0, i - 40), i + 60)}」`;
}

// ══ 5. Enter 뒤 첫 부름은 돌던 미리 읽기를 기다린다 ═══════════════════════════
{
  const o = { kind: 'ollama', base: `http://127.0.0.1:${포트}` };
  받은.length = 0;
  const s = 세션(o, { think: 'off' });
  const ctx = 문맥();
  const 판 = new 미리읽기(s, ctx, { env: {}, 쉼: 10 });
  s.미리읽기 = 판;
  미리늦춤 = 400;
  판.쳤다('포트 바꿔줘');
  await 될때까지(() => 판.상태().도는중);
  판.잠그기();
  const t = Date.now();
  await 턴(s, ctx, '포트 바꿔줘');
  미리늦춤 = 0;
  const 미리것 = 받은.find((x) => x.미리);
  const 진짜 = 받은.find((x) => !x.미리);
  check('★★ 첫 부름은 나가 있던 미리 읽기가 끝난 뒤에 나간다 (같은 앞머리를 두 자리에서 두 번 안 읽는다)',
    !!미리것 && !!진짜 && 진짜.닿음 - 미리것.닿음 >= 380, `${진짜 && 미리것 ? 진짜.닿음 - 미리것.닿음 : '?'}ms`);
  check('그 턴은 그대로 끝난다', Date.now() - t < 5000 && s.messages.some((m) => m.role === 'assistant'));
}

// ══ 5b. 기다리는 중에 Ctrl+C — 진짜 요청은 안 나간다 ═══════════════════════════
{
  const o = { kind: 'ollama', base: `http://127.0.0.1:${포트}` };
  받은.length = 0;
  const s = 세션(o, { think: 'off' });
  const ctx = 문맥();
  const 판 = new 미리읽기(s, ctx, { env: {}, 쉼: 10 });
  s.미리읽기 = 판;
  미리늦춤 = 400;
  판.쳤다('포트 바꿔줘');
  await 될때까지(() => 판.상태().도는중);
  판.잠그기();
  const 멈춤 = new AbortController();
  setTimeout(() => 멈춤.abort(), 60);
  const t = Date.now();
  try {
    s.routed = route('포트 바꿔줘').mode ?? null;
    for await (const _ of run(s, ctx, '포트 바꿔줘', { signal: 멈춤.signal })) { /* 끝까지 */ }
  } catch { /* 끊긴 턴은 던질 수 있다 */ }
  await 될때까지(() => !판.상태().도는중);
  미리늦춤 = 0;
  check('★ 미리 읽기를 기다리다 Ctrl+C 면 곧장 접히고, 진짜 요청은 안 나간다', Date.now() - t < 1500 && 받은.every((x) => x.미리), `${Date.now() - t}ms · ${받은.map((x) => (x.미리 ? '미리' : '진짜')).join(',')}`);
}

// ══ 6. 하위 작업·미리 읽기 없는 세션은 그대로 ════════════════════════════════
{
  const o = { kind: 'ollama', base: `http://127.0.0.1:${포트}` };
  받은.length = 0;
  const s = 세션(o, { think: 'off' });
  await 턴(s, 문맥(), '안녕');
  check('미리 읽기를 안 단 세션(파이프·ACP·deel run)은 아무것도 더 안 보낸다', 받은.length === 1 && !받은[0].미리, `${받은.length}`);
}

// ── 결과 ───────────────────────────────────────────────────────────
const W = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, ch) => a + (ch.codePointAt(0) > 0x1100 ? 2 : 1), 0)));
console.log('');
console.log('  미리 읽기 (모델 미리 올리기 · 치는 동안 앞머리 읽히기)');
console.log('  ' + '─'.repeat(64));
for (const p of pass) console.log(`  \x1b[32m✓\x1b[0m ${W(p.name, 36)} \x1b[90m${p.note}\x1b[0m`);
for (const f of fail) console.log(`  \x1b[31m✗\x1b[0m ${W(f.name, 36)} \x1b[31m${f.note}\x1b[0m`);
console.log('  ' + '─'.repeat(64));
console.log(`  통과 ${pass.length} · 실패 ${fail.length}`);
console.log('');

// 서버를 띄운 뒤에는 process.exit() 를 쓰지 않는다 (loop.test.js 끝 머리말 — 윈도우 libuv).
server.closeAllConnections?.();
server.close();
await new Promise((r) => setImmediate(r));
rmSync(root, { recursive: true, force: true });
process.exitCode = fail.length ? 1 : 0;
