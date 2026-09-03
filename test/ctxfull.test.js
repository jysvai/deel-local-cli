// 컨텍스트가 다 찼을 때 턴이 사는가.
//
// ── 사람 말 ─────────────────────────────────────────────────────────────
//
//   「current 가 다 차서 막힐 경우, 초기화되고 난 후에 다시 바로 작업할 수
//    있게」
//
// 여태 이랬다. 컨텍스트가 78% 인 대화에 긴 파일을 하나 붙이면 —
//
//   첫 요청이 창을 넘겨 서버가 거절한다
//     → 거절한 말에서 진짜 창 크기를 배우고 **같은 이력 그대로** 다시 부른다
//     → 또 거절당한다. 이번엔 배운 적이 있으니 오류로 끝난다
//
// 화면에 남는 것은 「턴이 죽었다」 한 줄이다. 사람은 /clear 를 치고 시킨 말을
// 처음부터 다시 쳐야 한다. 붙인 파일도 다시 붙여야 한다.
//
// 접기·요약 검사가 **왜 이걸 못 잡았나** — 접기 검사는 도구를 한 번 돌린
// 뒤를 잰다. 그런데 위 사고는 **첫 부름 전에** 난다. 그 자리를 재는 검사가
// 아예 없었다.
//
// ── 여기서 재는 것 ──────────────────────────────────────────────────────
//
//   1. 꽉 찬 대화에 말을 걸면, **첫 부름 전에** 접고 부르는가
//   2. 접고도 안 들어가면 턴 안에서 기억을 비우고 **이어 가는가**
//   3. 비우고도 또 넘치면 그때는 사실대로 오류인가 (영영 안 도는 것 막기)
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { 접힘표, KEEP_RECENT, foldToolResults, foldImages, compact, 못박을것 } from '../src/agent/compact.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

/*
 * ── 가짜 게이트웨이 ─────────────────────────────────────────────────────
 *
 * 두 가지 일을 한다.
 *   · 요약 요청(시스템 글에 '대화를 요약한다' 가 있다) → 짧은 요약을 준다
 *   · 그 밖의 요청 → 받은 것을 적어 두고 답한다
 *
 * `한계` 를 정해 두면 그보다 큰 요청은 OpenAI 가 쓰는 말투 그대로 거절한다.
 * 진짜 서버가 하는 짓을 그대로 흉내 내는 것이 중요하다 — 이 자리는 그
 * 문구를 읽어서 창 크기를 배우는 코드가 물려 있다.
 */
let 한계 = 0;                 // 0 이면 안 거절한다 (글자 수로 잰다)
let 받은턴요청 = [];          // 요약이 아닌 진짜 요청들
let 받은요약수 = 0;
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const j = (() => { try { return JSON.parse(body || '{}'); } catch { return {}; } })();
    const ms = j.messages ?? [];
    const 요약인가 = String(ms[0]?.content ?? '').includes('대화를 요약한다');
    const 보냄 = (o, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    if (요약인가) {
      받은요약수++;
      return 보냄({
        choices: [{ message: { role: 'assistant', content: '## 목표\n로그 형식 통일\n\n## 남은 일\nsrc/worker.js 가 남음' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      });
    }

    const 잰것 = JSON.stringify(ms).length;
    if (한계 && 잰것 > 한계) {
      return 보냄({
        error: {
          message: `This model's maximum context length is 4096 tokens, however you requested ${Math.round(잰것 / 3)} tokens.`,
          type: 'invalid_request_error',
        },
      }, 400);
    }
    받은턴요청.push(ms);
    return 보냄({
      choices: [{ message: { role: 'assistant', content: '다 했습니다.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    });
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/v1`;
resetNet();
allowEndpoint(base);

const root = mkdtempSync(join(tmpdir(), 'deel-ctxfull-'));
const 만들기 = () => {
  const c = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
  c.history.nextTurn();
  return c;
};

/** 도구 호출 짝이 들어 있는 긴 대화. compact.test.js 의 것과 같은 모양이다. */
function 대화만들기(turns) {
  const out = [{ role: 'user', content: '이 폴더에서 로그 형식 통일해줘' }];
  for (let i = 0; i < turns; i++) {
    out.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: `src/f${i}.js` }) } }] });
    out.push({ role: 'tool', tool_call_id: `c${i}`, name: 'Read', content: '가'.repeat(600) });
    out.push({ role: 'assistant', content: `${i}번째 파일을 봤습니다. ` + '나'.repeat(200) });
    out.push({ role: 'user', content: '계속' });
  }
  return out;
}

trace('1-첫부름전에-접나');

/*
 * ── 부르기 **전에** 재는가 ──────────────────────────────────────────────
 *
 * 여태 접기·요약 검사는 도구를 한 번 돌린 **뒤에만** 했다. 그래서 이미
 * 꽉 찬 대화에 말을 걸면 첫 요청이 그대로 나갔다. 자리가 모자란 것은
 * 부른 뒤가 아니라 부르기 전에 아는 일이다.
 */
{
  한계 = 0;
  받은턴요청 = []; 받은요약수 = 0;
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 16000, streaming: false, tools: false };
  const s = new Session(conn, { root });
  s.messages = 대화만들기(12);
  const 접기전메시지수 = s.messages.length;

  const 날것크기 = JSON.stringify(s.messages).length;

  const 본것 = [];
  for await (const ev of run(s, 만들기(), '이제 마무리해줘')) 본것.push(ev.type);

  const 첫요청 = 받은턴요청[0] ?? [];
  const 첫요청크기 = JSON.stringify(첫요청).length;

  check('턴이 끝까지 갔다', 본것.includes('done'), 본것.join(','));
  check('★ 첫 부름 전에 접었다고 알린다', 본것.indexOf('folded') === 0, 본것.join(','));
  check('★ 첫 요청에 이미 접힌 자국이 있다',
    첫요청.some((m) => String(m.content ?? '').includes(접힘표)),
    `${접기전메시지수}개 중 접힌 것 ${첫요청.filter((m) => String(m.content ?? '').includes(접힘표)).length}개`);
  /*
   * ★ 접힌 자리의 원문이 **정말 안 실려 나갔는가.**
   *
   * 「접었다」 는 표만 붙이고 원문을 그대로 보내면 아무것도 안 고친 것이다.
   * 날것 대비 몇 % 로 재면 문턱을 얼마로 잡든 자의적이라, 접기로 없어졌어야
   * 할 덩이(600자짜리 도구 결과)가 첫 요청에 몇 개 남았는지를 직접 센다.
   * 최근 것 KEEP_RECENT 개는 일부러 남긴다 — 방금 읽은 것을 접으면 그 자리에서
   * 다시 읽게 되고, 그러면 접은 보람이 없다.
   */
  const 남은날것 = 첫요청.filter((m) => String(m.content ?? '').includes('가'.repeat(600))).length;
  check('★ 최근 것만 빼고 도구 결과 원문이 첫 요청에서 빠졌다', 남은날것 === KEEP_RECENT,
    `${날것크기} → ${첫요청크기}자 · 도구 결과 12개 중 ${12 - 남은날것}개가 접힌 채로 나갔다`);
  check('★ 접었어도 시킨 말은 첫 요청에 그대로 실린다',
    JSON.stringify(첫요청).includes('이제 마무리해줘'));
}

trace('1.5-접어도-모자라면-요약까지');

/*
 * 도구 결과가 없는 대화는 접어도 안 준다 — 접기는 도구 결과만 건드린다.
 * 그때는 첫 부름 전에 **요약**까지 가야 한다.
 */
{
  한계 = 0;
  받은턴요청 = []; 받은요약수 = 0;
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 16000, streaming: false, tools: false };
  const s = new Session(conn, { root });
  s.messages = [{ role: 'user', content: '이 폴더에서 로그 형식 통일해줘' }];
  for (let i = 0; i < 14; i++) {
    s.messages.push({ role: 'assistant', content: `${i}번 판단입니다. ` + '나'.repeat(500) });
    s.messages.push({ role: 'user', content: `${i}번 되묻습니다. ` + '다'.repeat(400) });
  }
  const b = s.breakdown();
  check('먼저: 이미 꽉 찬 대화다', b.used / b.total >= 0.8,
    `${Math.round(b.used / b.total * 100)}%`);

  const 본것 = [];
  for await (const ev of run(s, 만들기(), '이제 마무리해줘')) 본것.push(ev.type);

  check('턴이 끝까지 갔다', 본것.includes('done'), 본것.join(','));
  check('★ 첫 부름 전에 요약을 불렀다', 받은요약수 >= 1, `요약 ${받은요약수}회`);
  check('★ 요약이 첫 요청보다 먼저다', 본것.indexOf('compacted') >= 0
    && 본것.indexOf('compacted') < 본것.indexOf('content'), 본것.join(','));
  check('요약한 것이 첫 요청에 실린다',
    JSON.stringify(받은턴요청[0] ?? []).includes('로그 형식 통일'));
  check('시킨 말도 그대로 실린다',
    JSON.stringify(받은턴요청[0] ?? []).includes('이제 마무리해줘'));
}

trace('2-넘치면-접어서-살아난다');

/*
 * ── (가) 첫 부름이 거절당해도, 접어서 그 턴 안에서 살아난다 ──────────────
 *
 * 서버가 「자리가 없다」고 400 을 주면 그 말에서 창 크기를 배운다. 여태는
 * 배우고 **같은 이력 그대로** 다시 불렀다 — 배운 값이 소용이 없었다.
 * 이제는 배운 값으로 걸음의 머리에서 다시 재니, 접기·요약이 그 자리에서 돈다.
 * 사람이 할 일은 없다. 화면에는 잠깐 접었다는 줄이 지나갈 뿐이다.
 *
 * 한계 값을 손으로 박지 않는다. 이 대화를 실제로 접어 보고, 「접기 전보다는
 * 작고 접은 뒤보다는 큰」 자리에 한계를 둔다. 그래야 시스템 글이 길어지거나
 * 문턱이 바뀌어도 검사가 저절로 따라간다 — 박아 둔 숫자는 반드시 어긋난다.
 */
const 시킨말 = '로그 형식을 통일해줘. src/worker.js 부터.';
const 할일목록 = [
  { text: 'src/worker.js 의 로그 형식 고치기', state: 'pending' },
  { text: '고친 뒤 검사 돌리기', state: 'pending' },
];

/** 접고 요약하면 몇 자가 되는지 미리 재 본다. 이 대화로, 진짜 요약을 불러서. */
async function 접은뒤크기재기(만들말) {
  한계 = 0;
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 4096, streaming: false, tools: false };
  const s = new Session(conn, { root });
  s.messages = 만들말();
  s.이번요청 = 시킨말;
  s.할일 = 할일목록;
  const 원래 = JSON.stringify(s.wire()).length;
  foldToolResults(s);
  foldImages(s);
  await compact(s, { auto: true });
  const 접은뒤 = JSON.stringify(s.wire()).length;
  // 기억을 통째로 비웠을 때의 크기 — 못 박은 것만 남는다.
  s.messages = [{ role: 'user', content: `(자리가 모자라 앞선 대화 99개를 비웠습니다.)\n\n${못박을것(s)}` }];
  const 비운뒤 = JSON.stringify(s.wire()).length;
  받은요약수 = 0; 받은턴요청 = [];
  return { 원래, 접은뒤, 비운뒤 };
}

const 잰것 = await 접은뒤크기재기(() => 대화만들기(12));

{
  한계 = Math.floor((잰것.원래 + 잰것.접은뒤) / 2);
  받은턴요청 = []; 받은요약수 = 0;
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 16000, streaming: false, tools: false };
  const s = new Session(conn, { root });
  s.messages = 대화만들기(12);
  s.할일 = 할일목록;

  const c = 만들기();
  c.todos = 할일목록;
  const 본것 = [];
  for await (const ev of run(s, c, 시킨말)) 본것.push(ev.type);

  check('먼저: 접으면 들어가고 안 접으면 안 들어가는 자리다',
    잰것.접은뒤 < 한계 && 한계 < 잰것.원래, `${잰것.접은뒤} < ${한계} < ${잰것.원래}`);
  check('★ 거절당해도 턴이 끝까지 갔다', 본것.includes('done'), 본것.join(','));
  check('★ 거절한 말에서 창 크기를 배웠다', 본것.includes('learned'), 본것.join(','));
  check('★ 배운 뒤 그 자리에서 접었다',
    본것.indexOf('learned') < 본것.indexOf('compacted') && 본것.includes('compacted'), 본것.join(','));
  check('여기서는 비울 것까지 가지 않는다', !본것.includes('reset'), 본것.join(','));
  check('오류는 안 났다', !본것.includes('error'), 본것.join(','));
  check('★ 사람은 아무것도 다시 안 쳤다 — 시킨 말이 그대로 실려 나갔다',
    JSON.stringify(받은턴요청.at(-1) ?? []).includes(시킨말));
}

trace('3-접어도-모자라면-비우고-이어간다');

/*
 * ── (나) 접고도 안 들어가면, 턴 안에서 비우고 이어 간다 ──────────────────
 *
 * 사람이 이름 대어 말한 자리다 — 「다 차서 막힐 경우, 초기화되고 난 후에
 * 다시 바로 작업할 수 있게」.
 *
 * 여태는 여기서 붉은 줄 하나 찍고 턴이 죽었다. 사람은 /clear 를 치고 시킨
 * 말을 처음부터 다시 타이핑했다. 이제는 지나간 대화만 버리고, 시킨 말 원문과
 * 남은 할 일은 그대로 들고 다음 걸음으로 간다.
 *
 * 여기서 꼭 봐야 하는 것은 「비웠다」 가 아니라 **비운 뒤에 나간 요청 안에
 * 시킨 말과 남은 할 일이 들어 있나** 이다. 그게 없으면 비운 것이 아니라
 * 잊은 것이다.
 */
{
  한계 = 잰것.접은뒤 - 100;
  받은턴요청 = []; 받은요약수 = 0;
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 16000, streaming: false, tools: false };
  const s = new Session(conn, { root });
  s.messages = 대화만들기(12);
  s.할일 = 할일목록;

  const c = 만들기();
  c.todos = 할일목록;
  const 본것 = [];
  let 비움 = null;
  for await (const ev of run(s, c, 시킨말)) { 본것.push(ev.type); if (ev.type === 'reset') 비움 = ev; }

  check('먼저: 접어도 안 들어가고 비우면 들어가는 자리다',
    잰것.비운뒤 < 한계 && 한계 < 잰것.접은뒤, `${잰것.비운뒤} < ${한계} < ${잰것.접은뒤}`);
  check('★ 접어도 모자라면 비운다고 알린다', 본것.includes('reset'), 본것.join(','));
  check('★ 비운 것은 오류가 아니다', !본것.includes('error'), 본것.join(','));
  check('★ 비우고도 턴이 끝까지 갔다', 본것.includes('done'), 본것.join(','));
  check('비운 것은 접기 뒤다', 본것.indexOf('compacted') < 본것.indexOf('reset'), 본것.join(','));

  const 마지막요청 = JSON.stringify(받은턴요청.at(-1) ?? []);
  check('★ 비운 뒤 요청에 시킨 말 원문이 그대로 있다', 마지막요청.includes(시킨말),
    `${(받은턴요청.at(-1) ?? []).length}개 메시지`);
  check('★ 비운 뒤 요청에 남은 할 일이 그대로 있다',
    마지막요청.includes('src/worker.js 의 로그 형식 고치기') && 마지막요청.includes('고친 뒤 검사 돌리기'));
  check('★ 비웠으면 옛 대화는 진짜로 없다', !마지막요청.includes('가'.repeat(600)),
    `메시지 ${(받은턴요청.at(-1) ?? []).length}개`);

  check('버린 개수를 사실대로 말한다', (비움?.dropped ?? 0) > 0, String(비움?.dropped));
  check('★ 남은 할 일 수를 화면에 댈 수 있다', 비움?.kept?.할일 === 2, JSON.stringify(비움?.kept));
  check('시킨 말을 들고 간다고 말한다', 비움?.kept?.요청 === true, JSON.stringify(비움?.kept));

  // 읽었다는 표까지 지워야 한다. 내용은 없는데 '읽었다' 만 남으면 모델은
  // 다시 안 읽고 기억에 없는 파일을 고치려 든다.
  check('★ 읽은 파일 기억도 같이 비운다', s.filesRead.size === 0, `${s.filesRead.size}개`);
}

trace('4-비우고도-넘치면-사실대로-오류');

/*
 * ── (다) 비우고도 또 넘치면, 그때는 사실대로 오류다 ─────────────────────
 *
 * 비우기가 자동으로 도는 길이라, 여기에 멈춤쇠가 없으면 **영영 돈다.**
 * 걸음 수도 안 올라가니(steps--) 걸음 상한도 못 잡는다. 화면은 멈춘 채로
 * 있고 사람은 왜 그런지 알 길이 없다 — 붉은 줄 하나보다 훨씬 나쁘다.
 *
 * 한 턴에 한 번만 비운다. 비우고도 또 막히면 자리 문제가 아니라 다른 탈이라,
 * 있는 그대로 말한다.
 */
{
  한계 = 1;                       // 무엇을 보내도 거절한다
  받은턴요청 = []; 받은요약수 = 0;
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 16000, streaming: false, tools: false };
  const s = new Session(conn, { root });
  s.messages = 대화만들기(12);
  s.할일 = 할일목록;

  const c = 만들기();
  c.todos = 할일목록;
  const 본것 = [];
  for await (const ev of run(s, c, 시킨말)) 본것.push(ev.type);

  check('★ 비우고도 넘치면 오류로 말한다', 본것.includes('error'), 본것.join(','));
  check('★ 비우기는 한 턴에 한 번뿐이다',
    본것.filter((t) => t === 'reset').length === 1,
    `reset ${본것.filter((t) => t === 'reset').length}회 · ${본것.join(',')}`);
  check('오류가 비우기보다 뒤다', 본것.lastIndexOf('reset') < 본것.indexOf('error'), 본것.join(','));
  check('턴이 done 으로 끝난 척하지 않는다', !본것.includes('done'), 본것.join(','));
}

한계 = 0;

trace('4.5-대화창에서-진짜-이어지나');

/*
 * ── 여기까지는 루프 안에서만 잰 것이다 ──────────────────────────────────
 *
 * 사람이 보는 것은 대화창이다. 루프가 아무리 옳게 이어 가도 —
 *   · 화면에 붉은 줄이 뜨거나
 *   · 비운 것을 이력에 새로 적다가 대화창이 터지거나
 *   · 그 뒤로 다음 말을 못 받으면
 * 사람에게는 여태와 똑같이 「막혔다」 이다. 그래서 진짜 deel 을 띄워서,
 * 서버가 두 번 거절하게 해 놓고 화면과 그 다음 말까지 본다.
 *
 * 두 번이라야 한다. 한 번은 배우기(learned)로 끝난다 — 접어도 안 들어가는
 * 자리를 만들려면 두 번째 거절이 있어야 한다.
 */
{
  let 거절수 = 0;
  const 대화창서버 = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const 보냄 = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      /*
       * 거절은 **대화 부름에만** 준다.
       *
       * deel 은 켜질 때 서버를 훑는다(/v1/models/<이름>, /api/v0/models, /props …).
       * 아무 데나 거절하면 그 탐색이 거절 몫을 다 써 버려서, 정작 대화는
       * 한 번에 성공한다 — 아무것도 안 재는 검사가 된다.
       */
      if (!String(req.url).includes('/chat/completions')) {
        return 보냄({ data: [{ id: '스텁모델', object: 'model' }] });
      }
      if (거절수 < 2) {
        거절수++;
        return 보냄({ error: { message: "This model's maximum context length is 8192 tokens, however you requested 41003 tokens." } }, 400);
      }
      return 보냄({
        id: 'x', object: 'chat.completion', model: '스텁모델',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '비운 뒤에도 이어서 했습니다.' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    });
  });
  await new Promise((r) => 대화창서버.listen(0, '127.0.0.1', r));
  const 주소 = `http://127.0.0.1:${대화창서버.address().port}/v1`;

  const 집 = mkdtempSync(join(tmpdir(), 'deel-ctxfull-home-'));
  writeFileSync(join(집, 'config.json'), JSON.stringify({
    version: 1, active: 'stub', level: '개발자',
    profiles: [{
      id: 'stub', name: '스텁', kind: 'openai', baseUrl: 주소,
      auth: 'none', apiKey: '', model: '스텁모델', ctx: 32768, streaming: false, tools: false,
    }],
  }), 'utf8');

  const 일터 = mkdtempSync(join(tmpdir(), 'deel-ctxfull-work-'));
  const 뿌리길 = fileURLToPath(new URL('..', import.meta.url));
  const kid = spawn(process.execPath,
    [join(뿌리길, 'bin', 'deel.js'), '--root', 일터, '--offline'],
    { cwd: 뿌리길, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CI: '1', DEEL_HOME: 집 } });

  let 화면 = '';
  kid.stdout.setEncoding('utf8');
  kid.stderr.setEncoding('utf8');
  kid.stdout.on('data', (b) => { 화면 += b; });
  kid.stderr.on('data', (b) => { 화면 += b; });
  let 끝남 = false;
  const 닫힘 = new Promise((r) => kid.on('close', () => { 끝남 = true; r(); }));
  const 민것 = () => 화면.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  const 기다리기 = async (될때까지, 최대 = 30000) => {
    const 끝 = Date.now() + 최대;
    while (Date.now() < 끝 && !끝남) {
      if (될때까지()) return true;
      await new Promise((r) => setTimeout(r, 40));
    }
    return false;
  };

  kid.stdin.write('로그 형식 통일해줘\n');
  const 비웠나 = await 기다리기(() => /비우고 이어갑니다/.test(민것()));
  const 이어졌나 = await 기다리기(() => /비운 뒤에도 이어서 했습니다/.test(민것()));

  // 비운 **뒤에도** 다음 말을 받는가. 못 받으면 사람에게는 여태와 같이 막힌 것이다.
  const 여기까지 = 민것().length;
  kid.stdin.write('/help\n');
  const 다음말받나 = await 기다리기(() => /명령|commands/i.test(민것().slice(여기까지)), 10000);

  if (!끝남) { try { kid.stdin.write('/exit\n'); } catch { /* 이미 닫혔다 */ } }
  await Promise.race([닫힘, new Promise((r) => setTimeout(r, 8000)).then(() => kid.kill())]);
  대화창서버.close();

  const 끝화면 = 민것();
  check('★ 대화창이 「비우고 이어갑니다」 를 적는다', 비웠나,
    끝화면.split('\n').find((l) => /비우고|자리가/.test(l))?.trim().slice(0, 90) ?? 끝화면.slice(-200));
  check('★ 비운 뒤 답이 진짜로 화면에 온다', 이어졌나, 끝화면.slice(-200));
  check('★ 비운 뒤에도 다음 말을 받는다', 다음말받나, 끝화면.slice(-200));
  check('★ 비운 것을 오류로 적지 않는다', !/턴이 죽|오류가 났습니다/.test(끝화면),
    끝화면.split('\n').filter((l) => /오류/.test(l)).join(' | ').slice(0, 120));

  /*
   * 비우면 이력이 통째로 바뀐다. 여기서 새로 안 적으면, 비운 뒤에 죽었을 때
   * /resume 이 **비우기 전 대화**를 되살려 놓는다 — 자리가 없어서 비운 것이
   * 도로 차 있는 셈이다.
   */
  const 이력들 = (() => {
    try {
      const 방 = join(일터, '.deel', 'sessions');
      return readdirSync(방).filter((f) => f.endsWith('.jsonl'))
        .map((f) => readFileSync(join(방, f), 'utf8'));
    } catch { return []; }
  })();
  check('★ 비웠다는 것이 이력에도 남는다',
    이력들.some((t) => /자리부족/.test(t)), `이력 파일 ${이력들.length}개`);

  rmSync(집, { recursive: true, force: true });
  rmSync(일터, { recursive: true, force: true });
}

trace('5-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n컨텍스트가 다 찼을 때  ${D}(턴이 죽지 않고 이어 가는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
server.close();
rmSync(root, { recursive: true, force: true });
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
