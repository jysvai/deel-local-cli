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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { 접힘표, KEEP_RECENT } from '../src/agent/compact.js';
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

trace('2-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n컨텍스트가 다 찼을 때  ${D}(턴이 죽지 않고 이어 가는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
server.close();
rmSync(root, { recursive: true, force: true });
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
