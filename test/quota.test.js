// 게이트웨이가 알려 주는 할당량.
//
// ── 무엇을 재나 ────────────────────────────────────────────────────────
//
// 여기서 제일 조심할 것은 **모르는 것을 0 으로 적지 않는 것**이다. 안 알려주는
// 서버가 많은데, 그때 "남은 요청 0" 이 뜨면 멀쩡한 할당량을 다 썼다고 믿는다.
// 그래서 '없음' 과 '0' 을 갈라 재고, 진짜 응답 머리로 잰다.
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  할당량읽기, 할당량말, 아슬아슬한가, 언제풀리나, 마지막할당량, 할당량잊기,
  미리기다릴까, 낡은값, 미리기다림상한, 할당량기억, 할당량자리,
} from '../src/backend/quota.js';
import { chat, chatStream } from '../src/backend/adapter.js';
import { quotaWarning } from '../src/ui/status.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 1. 머리에서 읽기 ───────────────────────────────────────────────────
trace('1-읽기');
{
  const 것 = 할당량읽기({
    'x-ratelimit-remaining-requests': '17',
    'x-ratelimit-limit-requests': '200',
    'x-ratelimit-remaining-tokens': '12,500',
    'x-ratelimit-limit-tokens': '1000000',
  });
  check('요청 남은 수를 읽는다', 것.요청 === 17, String(것.요청));
  check('쉼표가 든 숫자도 읽는다', 것.토큰 === 12500, String(것.토큰));
  check('한도도 같이 읽는다', 것.요청한도 === 200 && 것.토큰한도 === 1000000);
  check('있다고 표시한다', 것.있나 === true);

  // 이름이 제각각이라 다른 꼴도 본다.
  check('앞머리 없는 이름도 읽는다', 할당량읽기({ 'ratelimit-remaining-requests': '5' }).요청 === 5);

  // 여기가 핵심 — 없는 것은 null 이지 0 이 아니다.
  const 없음 = 할당량읽기({ 'content-type': 'application/json' });
  check('안 알려주면 요청은 null', 없음.요청 === null, String(없음.요청));
  check('안 알려주면 토큰도 null', 없음.토큰 === null, String(없음.토큰));
  check('안 알려주면 있나가 false', 없음.있나 === false);
  check('0 과 없음을 가른다', 할당량읽기({ 'x-ratelimit-remaining-requests': '0' }).요청 === 0);
  check('머리가 아예 없어도 안 터진다', 할당량읽기(null).있나 === false);
  check('숫자가 아니면 null', 할당량읽기({ 'x-ratelimit-remaining-requests': '알수없음' }).요청 === null);

  // Headers 객체(get)로 와도 같아야 한다 — fetch 응답이 그 꼴이다.
  const h = new Headers({ 'x-ratelimit-remaining-requests': '9' });
  check('Headers 객체로 와도 읽는다', 할당량읽기(h).요청 === 9, String(할당량읽기(h).요청));
}

// ── 2. 언제 풀리나 ─────────────────────────────────────────────────────
trace('2-풀림');
{
  check('초로 주면 그대로', 언제풀리나('30') === 30);
  check('0 도 0', 언제풀리나('0') === 0);
  check('1m30s 꼴도 읽는다', 언제풀리나('1m30s') === 90, String(언제풀리나('1m30s')));
  check('20s 꼴도 읽는다', 언제풀리나('20s') === 20, String(언제풀리나('20s')));
  // (사냥5 B5-11) OpenAI 는 `20ms` · `1h2m` 도 준다. 못 읽으면 null 이라 시계가 통째로 빠진다.
  check('★ 20ms 꼴도 읽는다 (1초가 안 되면 0)', 언제풀리나('20ms') === 0, String(언제풀리나('20ms')));
  check('★ 1500ms 꼴도 읽는다', 언제풀리나('1500ms') === 2, String(언제풀리나('1500ms')));
  check('★ 1h2m 꼴도 읽는다', 언제풀리나('1h2m') === 3720, String(언제풀리나('1h2m')));
  check('★ 1h 꼴도 읽는다', 언제풀리나('1h') === 3600, String(언제풀리나('1h')));
  check('  2m30.5s 는 그대로', 언제풀리나('2m30.5s') === 151, String(언제풀리나('2m30.5s')));
  check('  단위만 있는 것은 못 읽는다', 언제풀리나('ms') === null && 언제풀리나('h') === null && 언제풀리나('1x') === null,
    `${언제풀리나('ms')} ${언제풀리나('h')} ${언제풀리나('1x')}`);
  const 앞날 = new Date(Date.now() + 60000).toUTCString();
  const d = 언제풀리나(앞날);
  check('날짜로 주면 남은 초로 바꾼다', d !== null && Math.abs(d - 60) <= 2, String(d));
  check('못 읽으면 null', 언제풀리나('언젠가') === null);
  check('없으면 null', 언제풀리나(undefined) === null);
}

// ── 3. 언제 화면에 띄울까 ──────────────────────────────────────────────
trace('3-바닥');
{
  const 넉넉 = 할당량읽기({ 'x-ratelimit-remaining-requests': '900', 'x-ratelimit-limit-requests': '1000' });
  check('넉넉하면 안 띄운다', 아슬아슬한가(넉넉) === false, 할당량말(넉넉));
  const 바닥 = 할당량읽기({ 'x-ratelimit-remaining-requests': '50', 'x-ratelimit-limit-requests': '1000' });
  check('한도의 10% 아래면 띄운다', 아슬아슬한가(바닥) === true, 할당량말(바닥));
  const 한도모름 = 할당량읽기({ 'x-ratelimit-remaining-requests': '7' });
  check('한도를 모르면 남은 수로 본다', 아슬아슬한가(한도모름) === true, 할당량말(한도모름));
  const 한도모름넉넉 = 할당량읽기({ 'x-ratelimit-remaining-requests': '500' });
  check('한도를 몰라도 넉넉하면 안 띄운다', 아슬아슬한가(한도모름넉넉) === false);
  check('아무것도 모르면 안 띄운다', 아슬아슬한가(할당량읽기({})) === false);
  check('풀릴 때를 알려주면 띄운다', 아슬아슬한가(할당량읽기({ 'retry-after': '30' })) === true);

  /*
   * ── ★★★ 「통이 다시 찬다」 는 시계는 남은 양을 말해 주지 않는다 ────────
   *
   * OpenAI 는 `x-ratelimit-reset-*` 를 **성공한 응답마다** 실어 보낸다. 그걸
   * 「곧 막힌다」 로 읽던 동안 이 경고는 요청이 5,000 중 4,999 남았을 때도
   * 떠 있었다. 늘 떠 있는 줄은 사람이 안 읽고, 안 읽는 줄은 정작 진짜로
   * 바닥난 날에도 안 읽힌다 — quota.js 머리말이 하지 말자고 적어 둔 그것이다.
   *
   * 그러면서 아래 10% 검사는 **한 번도 안 돌았다.** 조용히 죽어 있었다.
   */
  const 넉넉한OpenAI = 할당량읽기({
    'x-ratelimit-remaining-requests': '4999', 'x-ratelimit-limit-requests': '5000',
    'x-ratelimit-remaining-tokens': '1999000', 'x-ratelimit-limit-tokens': '2000000',
    'x-ratelimit-reset-requests': '6s', 'x-ratelimit-reset-tokens': '6m0s',
  });
  check('★★★ reset 머리가 실려 와도 넉넉하면 안 띄운다',
    아슬아슬한가(넉넉한OpenAI) === false, 할당량말(넉넉한OpenAI));
  check('★★★ reset 시계 하나만으로는 안 띄운다 — 남은 양은 모르는 것이다',
    아슬아슬한가(할당량읽기({ 'x-ratelimit-reset-tokens': '6m0s' })) === false,
    JSON.stringify(할당량읽기({ 'x-ratelimit-reset-tokens': '6m0s' })));

  /*
   * ★★★ 경고를 통째로 꺼 버린 것이 아니라는 증거. 같은 서버가 진짜로 바닥나면
   * 그때는 떠야 한다 — 위 두 검사만 있으면 「늘 안 뜨게」 고쳐도 통과한다.
   */
  const 바닥난OpenAI = 할당량읽기({
    'x-ratelimit-remaining-requests': '400', 'x-ratelimit-limit-requests': '5000',
    'x-ratelimit-remaining-tokens': '1999000', 'x-ratelimit-limit-tokens': '2000000',
    'x-ratelimit-reset-requests': '6s', 'x-ratelimit-reset-tokens': '6m0s',
  });
  check('★★★ 같은 서버라도 10% 아래로 내려가면 띄운다',
    아슬아슬한가(바닥난OpenAI) === true, 할당량말(바닥난OpenAI));

  // 화면 줄에는 아는 것만 적는다.
  check('아는 것만 적는다', 할당량말(한도모름) === '요청 7', 할당량말(한도모름));
  check('모르면 빈 줄', 할당량말(할당량읽기({})) === '');
  check('한도를 알면 같이 적는다', 할당량말(바닥) === '요청 50/1,000', 할당량말(바닥));
}

// ── 4. 진짜 응답에서 (가짜 게이트웨이) ─────────────────────────────────
trace('4-진짜응답');
{
  const root = mkdtempSync(join(tmpdir(), 'deel-quota-'));
  void root;
  let 머리줄 = { 'x-ratelimit-remaining-requests': '3', 'x-ratelimit-limit-requests': '100' };
  const server = createServer((q, res) => {
    let body = '';
    q.on('data', (d) => (body += d));
    q.on('end', () => {
      if (/"stream":true/.test(body)) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', ...머리줄 });
        res.write('data: {"choices":[{"delta":{"content":"흘림"}}]}\n\n');
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'application/json', ...머리줄 });
      res.end(JSON.stringify({
        choices: [{ message: { content: '답' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  resetNet();
  allowEndpoint(base);
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 8000 };

  할당량잊기();
  check('부르기 전에는 아무것도 모른다', 마지막할당량() === null);

  await chat(conn, { messages: [{ role: 'user', content: 'x' }], maxTokens: 10 });
  const 본것 = 마지막할당량();
  check('한 번 부르면 서버가 말한 값을 안다', 본것?.요청 === 3, JSON.stringify(본것?.요청));
  /*
   * 이 값은 「이 숫자가 얼마나 낡았나」 를 재는 데 쓴다. 숫자이기만 하면
   * 0(1970년)도 통과하는데, 그러면 방금 받은 값이 늘 「아주 낡음」 으로
   * 읽혀서 화면이 조용히 틀린 말을 한다.
   */
  const 잰때 = Date.now();
  check('★ 언제 본 값인지도 안다 — 방금이다',
    Number.isFinite(본것?.때) && 본것.때 <= 잰때 && 잰때 - 본것.때 < 60000,
    `${잰때 - (본것?.때 ?? 0)}ms 전`);
  check('바닥이라 화면에 띄운다', /서버 할당량/.test(quotaWarning() ?? ''), quotaWarning());
  check('화면 말이 서버 숫자 그대로다', /요청 3\/100/.test(quotaWarning() ?? ''), quotaWarning());

  // 흘려 받기도 같아야 한다 — 대화 대부분이 이쪽으로 간다.
  머리줄 = { 'x-ratelimit-remaining-requests': '77', 'x-ratelimit-limit-requests': '100' };
  할당량잊기();
  for await (const ev of chatStream(conn, { messages: [{ role: 'user', content: 'x' }], maxTokens: 10 })) { void ev; }
  check('흘려 받기에서도 읽는다', 마지막할당량()?.요청 === 77, JSON.stringify(마지막할당량()?.요청));
  check('넉넉해지면 화면에서 사라진다', quotaWarning() === null, quotaWarning());

  // 안 알려주는 서버에서는 아무 말도 안 해야 한다. 여기가 제일 흔한 경우다.
  머리줄 = {};
  할당량잊기();
  await chat(conn, { messages: [{ role: 'user', content: 'x' }], maxTokens: 10 });
  check('안 알려주면 아무것도 안 적는다', 마지막할당량() === null, JSON.stringify(마지막할당량()));
  check('안 알려주면 화면에도 안 뜬다', quotaWarning() === null);

  server.close();
  할당량잊기();
}

/*
 * ── 맞기 전에 비킨다 ────────────────────────────────────────────────────
 *
 * 서버가 「남은 것이 없다, 언제 풀린다」 를 알려 줬는데도 그대로 보내면,
 * 429 를 맞고 다시 부르기 사다리를 태우고 그 턴이 죽는다. 사람이 본 것은
 * 「호출 한도 초과」 한 줄이다. 알고 있으면 그냥 기다렸다 보내면 된다.
 *
 * 여기서 제일 조심할 것은 **모르는 것을 0 으로 치지 않는 것**이다. 헤더를
 * 안 주는 서버가 많고, 모르는 것을 바닥난 것으로 읽으면 멀쩡한 연결이 영영
 * 기다린다 — 화면이 멈춘 것과 구별이 안 된다.
 */
{
  const 지금 = 1000000;
  const 것 = (더할것) => ({ 있나: true, 요청: null, 토큰: null, 풀림: null, 때: 지금, ...더할것 });
  const 잰다 = (더할것, 언제 = 지금) => 미리기다릴까(것(더할것), 언제);

  check('★ 바닥났고 풀림 시각을 알면 기다린다', 잰다({ 요청: 0, 풀림: 12 }) === 12000,
    String(잰다({ 요청: 0, 풀림: 12 })));
  check('토큰이 바닥나도 기다린다', 잰다({ 토큰: 0, 풀림: 8 }) === 8000,
    String(잰다({ 토큰: 0, 풀림: 8 })));

  check('★ 남은 것이 있으면 안 기다린다', 잰다({ 요청: 50, 풀림: 12 }) === null,
    String(잰다({ 요청: 50, 풀림: 12 })));
  check('★★ 아무것도 모르면 안 기다린다',
    미리기다릴까(null, 지금) === null && 미리기다릴까({ 있나: false }, 지금) === null);
  check('★★ 풀림 시각을 모르면 안 기다린다', 잰다({ 요청: 0 }) === null,
    String(잰다({ 요청: 0 })));

  /*
   * ★ 오래된 값으로는 안 정한다. 그 사이 풀렸을 수 있고, 풀린 뒤에 기다리는
   *   것은 아무것도 안 막으면서 사람만 붙든다.
   */
  check('★ 낡은 값으로는 안 정한다',
    잰다({ 요청: 0, 풀림: 12, 때: 지금 - (낡은값 + 1000) }) === null,
    String(잰다({ 요청: 0, 풀림: 12, 때: 지금 - (낡은값 + 1000) })));

  // 그 응답을 받은 뒤로 흐른 만큼은 빼 준다. 안 빼면 이미 풀린 뒤에도 기다린다.
  check('★ 흐른 시간만큼 뺀다', 잰다({ 요청: 0, 풀림: 20, 때: 지금 - 5000 }) === 15000,
    String(잰다({ 요청: 0, 풀림: 20, 때: 지금 - 5000 })));
  check('★ 이미 지났으면 안 기다린다', 잰다({ 요청: 0, 풀림: 5, 때: 지금 - 10000 }) === null,
    String(잰다({ 요청: 0, 풀림: 5, 때: 지금 - 10000 })));

  /*
   * ★ 상한을 둔다. 그보다 오래 붙들 일이면 사람이 정할 일이다 — 사실대로
   *   말하고 보내는 편이 낫다.
   */
  check('★ 상한을 넘지 않는다', 잰다({ 요청: 0, 풀림: 3600 }) === 미리기다림상한,
    String(잰다({ 요청: 0, 풀림: 3600 })));
}


/*
 * ── 창구마다 따로 센다 ──────────────────────────────────────────────────
 *
 * 값이 한 벌이면 **누구 것인지**가 없다. 그런데 이 프로그램은 한 번에 여러
 * 창구를 부른다 — 본 모델, 하위 작업이 고른 모델, `/model` 로 물어보는 자리,
 * 요약을 짓는 자리. 사내 게이트웨이가 「남은 것 0, 55초 뒤」 라고 답하면,
 * 그 다음에 **전혀 다른 주소**로 나가는 요청까지 55초를 기다렸다 — 옆에
 * 켜 둔 로컬 모델이 남의 할당량 때문에 멎는 것이다.
 */
{
  할당량잊기();
  const 사내 = { base: 'https://gw.사내.example.com/v1', model: 'gpt-5' };
  const 로컬 = { base: 'http://127.0.0.1:11434/v1', model: 'qwen3' };

  check('자리 이름에 열쇠는 안 들어간다', !/key|sk-/.test(할당량자리({ ...사내, key: 'sk-비밀' })),
    할당량자리({ ...사내, key: 'sk-비밀' }));
  check('호스트와 모델로 가른다', 할당량자리(사내) !== 할당량자리(로컬),
    `${할당량자리(사내)} vs ${할당량자리(로컬)}`);
  check('같은 호스트라도 모델이 다르면 다른 자리',
    할당량자리(사내) !== 할당량자리({ ...사내, model: 'gpt-4' }));

  // 사내 게이트웨이가 바닥났다고 알려 준다.
  할당량기억(new Map([
    ['x-ratelimit-remaining-requests', '0'],
    ['x-ratelimit-reset-requests', '55s'],
  ]), 할당량자리(사내));

  check('★ 바닥난 창구는 보내기 전에 기다린다', 미리기다릴까(마지막할당량(할당량자리(사내))) > 0,
    String(미리기다릴까(마지막할당량(할당량자리(사내)))));
  check('★ 옆 창구는 안 기다린다', 미리기다릴까(마지막할당량(할당량자리(로컬))) === null,
    String(미리기다릴까(마지막할당량(할당량자리(로컬)))));

  // 화면(상태줄·/cost)은 여전히 마지막 것을 쓴다 — 사람이 보는 창구는 하나다.
  check('자리를 안 주면 마지막 것을 준다', 마지막할당량()?.요청 === 0, JSON.stringify(마지막할당량()));

  // 한 자리만 지울 수 있다. 지운 뒤에는 그 자리만 모른다.
  할당량잊기(할당량자리(사내));
  check('한 자리만 지운다', 마지막할당량(할당량자리(사내)) === null && 마지막할당량() !== null);

  할당량잊기();
  check('통째로도 지운다', 마지막할당량() === null && 마지막할당량(할당량자리(사내)) === null);
}

/*
 * ── 창구를 가리는지 **어댑터를 통해** 잰다 ──────────────────────────────
 *
 * 위 검사들은 순수 함수만 본다. 그런데 실제 고장은 `chat()` 이 자리 없이
 * `미리기다릴까()` 를 부르는 것이었다 — 인자 하나 빠뜨리면 옛 동작으로 돌아가고
 * **위 검사는 전부 그대로 초록**이다. 그래서 진짜 요청을 두 번 보내 본다.
 */
{
  할당량잊기();
  let 머리 = {};
  const srv = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json', ...머리 });
      res.end(JSON.stringify({
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '네' } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  resetNet();
  allowEndpoint(base);

  const 바닥난것 = { kind: 'openai', base, auth: 'none', key: '', model: '바닥난모델', ctx: 8000 };
  const 옆것 = { kind: 'openai', base, auth: 'none', key: '', model: '옆모델', ctx: 8000 };

  // 첫 부름에서 서버가 「남은 것 0, 3초 뒤 풀림」 이라고 알려 준다.
  머리 = { 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '3s' };
  await chat(바닥난것, { messages: [{ role: 'user', content: 'x' }], maxTokens: 10 });
  머리 = {};   // 그 뒤로는 아무 말도 안 해 준다

  const 잰다 = async (conn) => {
    const 알림 = [];
    const t0 = Date.now();
    await chat(conn, {
      messages: [{ role: 'user', content: 'x' }], maxTokens: 10,
      onBackoff: (ev) => 알림.push(ev),
    });
    return { 걸린시간: Date.now() - t0, 미리: 알림.filter((x) => x.미리).length };
  };

  const 옆 = await 잰다(옆것);
  check('★★ 옆 창구는 남의 할당량으로 안 기다린다', 옆.미리 === 0 && 옆.걸린시간 < 1000,
    `${옆.걸린시간}ms · 미리 ${옆.미리}`);

  const 바닥 = await 잰다(바닥난것);
  check('★★ 바닥난 창구는 보내기 전에 기다린다', 바닥.미리 === 1,
    `${바닥.걸린시간}ms · 미리 ${바닥.미리}`);

  srv.close();
  할당량잊기();
}

/*
 * ── 6회차 Gemini 할당6 — 진짜 Headers 로 잰다 ────────────────────────────
 *
 * fetch 의 Headers 는 같은 이름이 두 번 오면 「5, 5」 로 이어 붙인다(노드 http 의
 * 머리 객체도 같다). 게이트웨이와 윗단이 같은 머리를 둘 다 실으면 생긴다. 그 줄을
 * 쉼표만 지우고 읽어서 55 가 됐고, 남은 5 가 넉넉한 55 로 읽혀 경고가 안 떴다.
 */
trace('6-할당6');
{
  const 머리 = (쌍들) => { const h = new Headers(); for (const [k, v] of 쌍들) h.append(k, v); return h; };
  const 겹침 = 할당량읽기(머리([['x-ratelimit-remaining-requests', '5'], ['x-ratelimit-remaining-requests', '5']]));
  check('★ 같은 머리가 두 번 와 「5, 5」 가 돼도 55 가 아니라 5', 겹침.요청 === 5, String(겹침.요청));
  const 다른겹침 = 할당량읽기(머리([['x-ratelimit-remaining-requests', '40'], ['x-ratelimit-remaining-requests', '3']]));
  check('★ 둘이 다르면 적은 쪽이고 경고도 뜬다', 다른겹침.요청 === 3 && 아슬아슬한가(다른겹침) === true, 할당량말(다른겹침));
  check('  천 단위 쉼표는 여전히 한 수다', 할당량읽기(머리([['x-ratelimit-remaining-tokens', '12,500']])).토큰 === 12500,
    String(할당량읽기(머리([['x-ratelimit-remaining-tokens', '12,500']])).토큰));
  const 천단위겹침 = 할당량읽기(머리([['x-ratelimit-remaining-tokens', '12,500'], ['x-ratelimit-remaining-tokens', '1,000']]));
  check('  천 단위끼리 겹쳐도 적은 쪽', 천단위겹침.토큰 === 1000, String(천단위겹침.토큰));
  // `Date.parse('5, 5')` 는 2001년 날짜를 낸다 — 겹친 Retry-After 가 「이미 지남 = 0초」 가 됐다.
  check('★ 겹친 Retry-After 「5, 5」 를 날짜로 읽어 0 으로 만들지 않는다', 언제풀리나('5, 5') === 5, String(언제풀리나('5, 5')));
  check('★ 시계가 둘이면 늦은 쪽', 언제풀리나('20ms, 6m0s') === 360, String(언제풀리나('20ms, 6m0s')));
  const 앞날6 = new Date(Date.now() + 60000).toUTCString();
  const 겹친날 = 언제풀리나(`${앞날6}, ${앞날6}`);
  check('  요일 쉼표가 든 HTTP 날짜도 하나로든 겹쳐서든 그대로 읽힌다',
    겹친날 !== null && Math.abs(겹친날 - 60) <= 2 && Math.abs(언제풀리나(앞날6) - 60) <= 2, `${겹친날} · ${언제풀리나(앞날6)}`);

  /*
   * 입력 5,000/200,000 · 출력 2,000/4,000. 수만 견주면 출력 통을 골라 「50% 남음」 이라 하는데,
   * 곧 막히는 쪽은 2.5% 남은 입력 통이다.
   */
  const 입출 = 할당량읽기(머리([
    ['anthropic-ratelimit-input-tokens-remaining', '5000'], ['anthropic-ratelimit-input-tokens-limit', '200000'],
    ['anthropic-ratelimit-output-tokens-remaining', '2000'], ['anthropic-ratelimit-output-tokens-limit', '4000'],
  ]));
  check('★ 한도를 알면 비율로 고른다 — 입력 2.5% 가 출력 50% 보다 빠듯하다',
    입출.토큰 === 5000 && 입출.토큰한도 === 200000 && 아슬아슬한가(입출) === true, 할당량말(입출));
  const 반쪽한도 = 할당량읽기(머리([
    ['anthropic-ratelimit-input-tokens-remaining', '100000'], ['anthropic-ratelimit-input-tokens-limit', '200000'],
    ['anthropic-ratelimit-output-tokens-remaining', '0'],
  ]));
  check('  한도를 한쪽만 알면 수로 견준다 — 바닥(0)이 이긴다', 반쪽한도.토큰 === 0 && 반쪽한도.토큰한도 === null, 할당량말(반쪽한도));

  /*
   * 바닥난 통의 시계를 쓴다. 요청은 4,999 남고 토큰이 0 인데 요청 시계(20ms)를 집어서
   * 「곧 풀림」 으로 곧장 보내 429 를 맞았다. 토큰 통은 6분 뒤에야 찬다.
   */
  const 지금6 = Date.now();
  const 토큰만바닥 = 할당량읽기(머리([
    ['x-ratelimit-remaining-requests', '4999'], ['x-ratelimit-remaining-tokens', '0'],
    ['x-ratelimit-reset-requests', '20ms'], ['x-ratelimit-reset-tokens', '6m0s'],
  ]));
  check('★ 토큰이 바닥이면 토큰 통의 시계(6분)를 쓴다 — 요청 시계(20ms)가 아니라',
    토큰만바닥.풀림 === 360 && 미리기다릴까({ ...토큰만바닥, 때: 지금6 }, 지금6) === 미리기다림상한,
    `풀림 ${토큰만바닥.풀림} · ${미리기다릴까({ ...토큰만바닥, 때: 지금6 }, 지금6)}`);
  const 요청만바닥 = 할당량읽기(머리([
    ['x-ratelimit-remaining-requests', '0'], ['x-ratelimit-remaining-tokens', '1999000'],
    ['x-ratelimit-reset-requests', '6s'], ['x-ratelimit-reset-tokens', '6m0s'],
  ]));
  check('★ 요청이 바닥이면 요청 통의 시계(6초)',
    요청만바닥.풀림 === 6 && 미리기다릴까({ ...요청만바닥, 때: 지금6 }, 지금6) === 6000, `풀림 ${요청만바닥.풀림}`);
  const 둘다바닥 = 할당량읽기(머리([
    ['x-ratelimit-remaining-requests', '0'], ['x-ratelimit-remaining-tokens', '0'],
    ['x-ratelimit-reset-requests', '6s'], ['x-ratelimit-reset-tokens', '6m0s'],
  ]));
  check('  둘 다 바닥이면 늦게 차는 쪽 — 둘 다 차야 보낼 수 있다', 둘다바닥.풀림 === 360, `풀림 ${둘다바닥.풀림}`);
  const 둘다바닥요청늦음 = 할당량읽기(머리([
    ['x-ratelimit-remaining-requests', '0'], ['x-ratelimit-remaining-tokens', '0'],
    ['x-ratelimit-reset-requests', '6m0s'], ['x-ratelimit-reset-tokens', '6s'],
  ]));
  check('  요청 통 시계가 더 늦으면 그쪽 — 요청 바닥도 제 시계를 낸다', 둘다바닥요청늦음.풀림 === 360, `풀림 ${둘다바닥요청늦음.풀림}`);
  const 출력바닥 = 할당량읽기(머리([
    ['anthropic-ratelimit-requests-remaining', '40'], ['anthropic-ratelimit-requests-reset', new Date(지금6 + 20000).toISOString()],
    ['anthropic-ratelimit-output-tokens-remaining', '0'], ['anthropic-ratelimit-output-tokens-reset', new Date(지금6 + 50000).toISOString()],
  ]));
  check('★ Anthropic 출력 통이 바닥이면 그 통의 시계(50초) — 요청 시계(20초)가 아니라',
    Math.abs((출력바닥.풀림 ?? -99) - 50) <= 2, `풀림 ${출력바닥.풀림}`);

  /*
   * 서버가 시킨 때(Retry-After)는 언제나 이긴다 — 0 초라고 시켰든, 시킨 때가 이미 지났든.
   * 여태는 `서버말 > 0` 만 시킨 것으로 쳐서 둘 다 막힘띄움(5초)으로 떨어졌다.
   */
  const 막힌것 = (더할것) => ({ 있나: true, 막힘: true, 요청: null, 토큰: null, 서버말: null, 풀림: null, 때: 지금6, ...더할것 });
  check('★ 429 + Retry-After: 0 — 곧장 오라고 시켰으면 5초를 덧대지 않는다',
    미리기다릴까(막힌것({ 서버말: 0, 풀림: 0 }), 지금6) === null, String(미리기다릴까(막힌것({ 서버말: 0, 풀림: 0 }), 지금6)));
  check('★ 429 + Retry-After: 1 을 1.5초 뒤에 물으면 이미 지났다 — 3.5초를 더 붙들지 않는다',
    미리기다릴까(막힌것({ 서버말: 1, 풀림: 1, 때: 지금6 - 1500 }), 지금6) === null,
    String(미리기다릴까(막힌것({ 서버말: 1, 풀림: 1, 때: 지금6 - 1500 }), 지금6)));
  check('★ 시킨 때가 아직 안 지났으면 남은 밀리초만큼 (2초 · 0.5초 흐름 → 1.5초)',
    미리기다릴까(막힌것({ 서버말: 2, 풀림: 2, 때: 지금6 - 500 }), 지금6) === 1500,
    String(미리기다릴까(막힌것({ 서버말: 2, 풀림: 2, 때: 지금6 - 500 }), 지금6)));
  check('  아무 말 없이 막힌 자리는 여전히 막힘띄움(5초)', 미리기다릴까(막힌것({}), 지금6) === 5000,
    String(미리기다릴까(막힌것({}), 지금6)));
  const 초바닥 = { 있나: true, 막힘: false, 요청: 0, 토큰: null, 서버말: null, 풀림: 1, 때: 지금6 - 900 };
  check('★ 흐른 시간을 밀리초로 뺀다 — 1초 시계를 900ms 뒤에 물으면 100ms (1000ms 가 아니라)',
    미리기다릴까(초바닥, 지금6) === 100, String(미리기다릴까(초바닥, 지금6)));

  /*
   * (8회차 뒷단-전선) 서버가 적어 준 시계가 **이미 지났으면** 기다릴 것이 없다.
   *
   * 시킨 것(Retry-After)이 지났을 때는 위에서 null 로 끝내는데, 서버가 「남은 것 0 ·
   * 1초 뒤 참」 이라고 적어 보낸 시계는 지나도 아래 막힘띄움(5초)으로 떨어졌다. 같은
   * 응답인데 Retry-After 가 있고 없고에 따라 0초와 3.5초로 갈렸다 — 서버가 이미
   * 「찼다」 고 말해 준 자리에서 우리가 3.5초를 더 붙든 것이다.
   */
  const 지난시계 = { 있나: true, 막힘: true, 요청: 0, 토큰: null, 서버말: null, 풀림: 1, 때: 지금6 - 1500 };
  check('★★ 서버가 준 시계가 이미 지났으면 막힘띄움으로 안 떨어진다 (Retry-After 없이도)',
    미리기다릴까(지난시계, 지금6) === null, String(미리기다릴까(지난시계, 지금6)));
  check('  Retry-After 로 같은 말을 들었을 때와 같다',
    미리기다릴까(지난시계, 지금6) === 미리기다릴까({ ...지난시계, 서버말: 1 }, 지금6), '');
  check('  아직 안 지난 시계는 그대로 기다린다', 미리기다릴까({ ...지난시계, 풀림: 3 }, 지금6) === 1500,
    String(미리기다릴까({ ...지난시계, 풀림: 3 }, 지금6)));
  // 시계를 아예 못 받은 429 는 여전히 막힘띄움이다 — 거기서 아는 것은 「방금 막혔다」 뿐이다.
  check('  시계를 못 받은 429 는 여전히 막힘띄움',
    미리기다릴까({ ...지난시계, 요청: null, 풀림: null }, 지금6) === 3500,
    String(미리기다릴까({ ...지난시계, 요청: null, 풀림: null }, 지금6)));
}

// ── 7. 접미사 없는 이름과 빠진 리셋 시계 ───────────────────────────────
trace('7-접미사없는이름');
{
  /*
   * (8회차 뒷단-전선) 접미사 없는 `x-ratelimit-*` 을 **반만** 읽고 있었다.
   *
   * `요청남음` 에는 `x-ratelimit-remaining` 이 진작 들어 있는데 짝인 `x-ratelimit-limit`
   * 과 `x-ratelimit-reset` 은 어느 목록에도 없었다. 그래서 그 이름으로 주는 게이트웨이
   * (Groq·Together 계열)에서는 남은 수만 뜨고 한도도 시계도 영영 null 이었다 — 한도를
   * 모르면 10% 검사가 안 돌고, 시계를 모르면 화면에 「몇 초 뒤 풀림」 이 안 뜬다.
   * 에포크 초를 설명하는 이 파일의 주석 예시(`x-ratelimit-reset: 1773538800`)가 바로
   * 그 이름이었다.
   */
  const 민낯 = 할당량읽기(new Headers({
    'x-ratelimit-remaining': '10', 'x-ratelimit-limit': '100', 'x-ratelimit-reset': '600',
  }));
  const 접미사 = 할당량읽기(new Headers({
    'x-ratelimit-remaining-requests': '10', 'x-ratelimit-limit-requests': '100', 'x-ratelimit-reset-requests': '600',
  }));
  check('★★ 접미사 없는 x-ratelimit-limit 을 한도로 읽는다', 민낯.요청한도 === 100, String(민낯.요청한도));
  check('★★ 접미사 없는 x-ratelimit-reset 을 시계로 읽는다', 민낯.풀림 === 600, String(민낯.풀림));
  check('  접미사 붙은 것과 같은 값이 나온다',
    민낯.요청 === 접미사.요청 && 민낯.요청한도 === 접미사.요청한도 && 민낯.풀림 === 접미사.풀림, 할당량말(민낯));
  // 한도를 알아야 10% 검사가 돈다. 여태는 한도가 null 이라 남은 수 검사(20개)로만 떨어졌다.
  check('★ 한도를 알면 비율 경고가 돈다 — 100 중 10 남음',
    아슬아슬한가(할당량읽기(new Headers({ 'x-ratelimit-remaining': '10', 'x-ratelimit-limit': '100' }))) === true, '');
  check('  넉넉하면 안 뜬다 — 100000 중 50000 남음',
    아슬아슬한가(할당량읽기(new Headers({ 'x-ratelimit-remaining': '50000', 'x-ratelimit-limit': '100000' }))) === false, '');
  // 바닥났을 때도 그 시계를 쓴다.
  const 민낯바닥 = 할당량읽기(new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '45' }));
  check('★ 바닥났을 때도 그 시계를 쓴다', 민낯바닥.풀림 === 45, String(민낯바닥.풀림));

  /*
   * (8회차 뒷단-전선) `통차는때` 에 Anthropic 입력·출력 통의 리셋 이름이 빠져 있었다.
   *
   * 통이 **바닥난 뒤**에는 `가장빠듯한통` 이 그 통의 시계를 따로 챙기니까 떴다. 그런데
   * 바닥나기 **전** — 경고가 뜨는 바로 그 자리(200/100,000) — 에는 시계가 어느 목록에도
   * 없어 「몇 초 뒤 풀림」 이 안 나왔다. 미리 알려 주자고 만든 파일인데, 미리 볼 때만
   * 시계가 없었다.
   */
  for (const 갈래 of ['input', 'output']) {
    const 전 = 할당량읽기(new Headers({
      [`anthropic-ratelimit-${갈래}-tokens-remaining`]: '200',
      [`anthropic-ratelimit-${갈래}-tokens-limit`]: '100000',
      [`anthropic-ratelimit-${갈래}-tokens-reset`]: '300',
    }));
    check(`★★ 바닥나기 전에도 시계가 뜬다 — anthropic ${갈래} 통`, 전.풀림 === 300, `풀림 ${전.풀림} · ${할당량말(전)}`);
    check(`  그 줄에 「풀림」 이 적힌다 — ${갈래}`, /풀림/.test(할당량말(전)), 할당량말(전));
  }

  /*
   * 이름만 보태는 것으로는 **모자랐다** (제미니 2차 눈).
   *
   * 진짜 Anthropic 응답에는 요청 리셋이 **같이** 오고, `골라()` 는 목록에서 처음 있는 것
   * 하나를 집는다. 그래서 새로 보탠 입력·출력 토큰 리셋에는 영영 못 닿고, 화면은
   * 「토큰 200/100,000 · 1초 뒤 풀림」 처럼 **적힌 통과 딴 통의 시계**를 나란히 적었다.
   * 있는데 한 번도 안 걸리는 규칙 — 이 저장소가 제일 자주 밟는 자리다.
   *
   * 바닥난 통이 없을 때도 규칙은 바닥시계 와 같다: **늦게 차는 쪽**이다. 그때가 와야
   * 전부 풀린 것이고, 이른 쪽을 적으면 「풀렸다」 고 해 놓고 또 막힌다.
   */
  // 같은 머리가 여러 개인 응답을 만들려면 append 가 필요하다 (6-할당6 절과 같은 도우미).
  const 머리 = (쌍들) => { const h = new Headers(); for (const [k, v] of 쌍들) h.append(k, v); return h; };
  const 이제 = Date.now();
  const 진짜앤트로픽 = 할당량읽기(머리([
    ['anthropic-ratelimit-requests-remaining', '40'], ['anthropic-ratelimit-requests-limit', '1000'],
    ['anthropic-ratelimit-requests-reset', new Date(이제 + 1000).toISOString()],
    ['anthropic-ratelimit-input-tokens-remaining', '200'], ['anthropic-ratelimit-input-tokens-limit', '100000'],
    ['anthropic-ratelimit-input-tokens-reset', new Date(이제 + 300000).toISOString()],
    ['anthropic-ratelimit-output-tokens-remaining', '4000'], ['anthropic-ratelimit-output-tokens-limit', '16000'],
    ['anthropic-ratelimit-output-tokens-reset', new Date(이제 + 120000).toISOString()],
  ]));
  check('★★ 진짜 Anthropic 응답에서도 새로 보탠 시계에 닿는다 — 요청 시계(1초)에 안 가린다',
    Math.abs((진짜앤트로픽.풀림 ?? -99) - 300) <= 2, `풀림 ${진짜앤트로픽.풀림} · ${할당량말(진짜앤트로픽)}`);
  const 섞인시계 = 할당량읽기(머리([
    ['x-ratelimit-remaining-requests', '4999'], ['x-ratelimit-remaining-tokens', '500'],
    ['x-ratelimit-reset-requests', '20ms'], ['x-ratelimit-reset-tokens', '6m0s'],
  ]));
  check('★ 바닥난 통이 없어도 늦게 차는 쪽을 적는다 — 20ms 가 아니라 6분',
    섞인시계.풀림 === 360, `풀림 ${섞인시계.풀림} · ${할당량말(섞인시계)}`);
  check('  시계가 하나뿐이면 그대로다', 할당량읽기(머리([['x-ratelimit-reset-requests', '45']])).풀림 === 45,
    String(할당량읽기(머리([['x-ratelimit-reset-requests', '45']])).풀림));
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n할당량 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
{
  /*
   * 6회차 Gemini 백엔드5역 — 빈 머리말은 Number('') 가 0 이라 「지금 바로 풀림」 이 됐고, 풀리는 **시각**을
   * 에포크 초로 주는 게이트웨이(`x-ratelimit-reset: 1773538800`)는 그 수를 초로 읽어 56년 뒤에 풀린다고 했다.
   */
  const { 언제풀리나: 풀림 } = await import('../src/backend/quota.js');
  check('★ 빈 머리말은 못 읽은 것(null)', 풀림('') === null && 풀림('   ') === null, `${풀림('')} · ${풀림('   ')}`);
  const 초 = Math.floor(Date.now() / 1000);
  const 에포크초 = 풀림(String(초 + 30));
  check('★ 에포크 초로 준 시각은 지금과의 차이', 에포크초 >= 28 && 에포크초 <= 31, String(에포크초));
  const 에포크밀리 = 풀림(String(Date.now() + 30000));
  check('★ 에포크 밀리초로 준 시각도 차이', 에포크밀리 >= 28 && 에포크밀리 <= 31, String(에포크밀리));
  check('  지난 시각은 0', 풀림(String(초 - 100)) === 0, String(풀림(String(초 - 100))));
  check('  보통 초 수는 그대로', 풀림('45') === 45 && 풀림('86400') === 86400, `${풀림('45')} · ${풀림('86400')}`);
}

console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
