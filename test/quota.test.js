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
  check('언제 본 값인지도 안다', typeof 본것?.때 === 'number');
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

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n할당량 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
