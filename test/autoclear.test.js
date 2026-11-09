// 요약으로 자리가 안 나면 턴 안에서 스스로 비우는가.
//
// ── 사람 말 ─────────────────────────────────────────────────────────────
//
//   「컨텍스트 압축을 해도 결국 꽉 차서 안 된다, 자동으로 비워 달라.」
//   「계속 압축만 하니까 결국 컨텍스트가 압축된 캐시로 다 차고 문제가 생긴다.」
//
// 맥의 llama-server(65,536 창, 슬롯 1개)에서 나온 제보다. 요약은 1% 만 줄여도 성공으로
// 쳐서 다음 걸음에 또 부르고, 로컬에서는 그 한 번이 수 분이다. 비우기는 요약이 **실패**하고
// 창이 넘쳤을 때만 돌아서 정작 필요한 자리에서는 안 돌았다.
//
// 진짜 모델은 안 띄운다 — 가짜 게이트웨이(루프 전체)와 가짜 부르기(compact 만)로 잰다.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session, estimateTokens, repairToolPairs } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import {
  compact, split, safeCut, shouldCompact, shouldFold, 비울까, 비우면빌까, 실을요약,
  요약세대, 마지막요약, 요약입력상한, 문턱배율, 접힘표, 비워서날몫,
} from '../src/agent/compact.js';
import { Store } from '../src/agent/store.js';
import { assistantMessage, toolMessage, 도구결과인가 } from '../src/backend/adapter.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

/*
 * ── 가짜 게이트웨이 ─────────────────────────────────────────────────────
 *
 * 요약 요청은 시스템 글로 가른다. 그 밖의 요청은 대본 차례대로 답한다.
 * usage 는 일부러 안 싣는다. 실으면 세션이 그 값으로 보정을 배워서, 이 검사가
 * 재는 토큰 수가 대본과 상관없이 흔들린다.
 */
const 요약글 = '## 목표\n로그 형식 통일\n\n## 남은 일\n요약본문표시 src/worker.js';
let 대본 = [];
let 차례 = 0;
let 요약요청수 = 0;
let 턴요청들 = [];
let 요약막기 = false;

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const j = (() => { try { return JSON.parse(body || '{}'); } catch { return {}; } })();
    const ms = j.messages ?? [];
    const 보냄 = (o, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    if (String(ms[0]?.content ?? '').includes('대화를 요약한다')) {
      요약요청수++;
      if (요약막기) return 보냄({ error: { message: '요약 서버가 아픕니다', type: 'invalid_request_error' } }, 400);
      return 보냄({ choices: [{ message: { role: 'assistant', content: 요약글 }, finish_reason: 'stop' }] });
    }
    턴요청들.push(ms);
    const 걸음 = 대본[차례++] ?? { 글: '다 했습니다.' };
    if (걸음.거절) {
      return 보냄({ error: { message: `This model's maximum context length is ${걸음.거절} tokens, however you requested 99999 tokens.`, type: 'invalid_request_error' } }, 400);
    }
    if (걸음.읽기) {
      return 보냄({
        choices: [{
          message: {
            role: 'assistant', content: 걸음.글 ?? '',
            tool_calls: [{ id: `c${차례}`, type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: 걸음.읽기 }) } }],
          },
          finish_reason: 'tool_calls',
        }],
      });
    }
    return 보냄({ choices: [{ message: { role: 'assistant', content: 걸음.글 }, finish_reason: 'stop' }] });
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/v1`;
resetNet();
allowEndpoint(base);

const root = mkdtempSync(join(tmpdir(), 'deel-autoclear-'));
for (let i = 0; i < 12; i++) writeFileSync(join(root, `a${i}.txt`), `파일 ${i}\n`, 'utf8');

const 연결 = (덧 = {}) => ({ kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 16000, streaming: false, ...덧 });
const 세션 = (덧 = {}) => new Session(연결(덧), { root, work: 'auto', think: 'off' });
const 만들기 = () => {
  const c = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
  c.history.nextTurn();
  return c;
};

/** 판을 새로 깐다. */
const 새판 = (새대본 = []) => { 대본 = 새대본; 차례 = 0; 요약요청수 = 0; 턴요청들 = []; 요약막기 = false; };

/** 턴을 끝까지 돌린다. reset 이 일어난 자리는 그때까지 나간 턴 요청 수로 적어 둔다. */
async function 돌리기(s, 말, c = 만들기()) {
  const 본것 = [];
  for await (const ev of run(s, c, 말)) {
    if (ev.type === 'reset') 본것.push({ ...ev, 나간요청: 턴요청들.length });
    else 본것.push(ev);
  }
  return 본것;
}
const 종류들 = (본것) => 본것.map((e) => e.type);
const 줄임 = (본것) => 종류들(본것).filter((t) => !['content', 'thinking', 'phase'].includes(t)).join(',');

/** 말들이 차지하는 토큰. breakdown 과 같은 자로 잰다 — 검사만의 자를 두면 같이 틀린다. */
const 토큰 = (msgs) => {
  const s = 세션();
  const 빈 = s.breakdown().used;
  s.messages = msgs;
  return s.breakdown().used - 빈;
};

/** 도구 없이 말만 오간 대화. 접기가 못 줄이므로 곧장 요약까지 간다. */
function 말많은대화(n, 표 = '') {
  const out = [{ role: 'user', content: `${표}이 폴더에서 로그 형식 통일해줘` }];
  for (let i = 0; i < n; i++) {
    out.push({ role: 'assistant', content: `${표}${i}번 판단입니다. ${'나'.repeat(500)}` });
    out.push({ role: 'user', content: `${표}${i}번 되묻습니다. ${'다'.repeat(400)}` });
  }
  return out;
}

const 부름 = (i, 글 = '') => ({ role: 'assistant', content: 글, tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: `src/f${i}.js` }) } }] });
const 결과 = (i, 글) => ({ role: 'tool', tool_call_id: `c${i}`, name: 'Read', content: 글 });

const 가짜요약 = (글 = 요약글) => async () => ({ content: 글, finish_reason: 'stop' });

const 시킨말 = '로그 형식을 통일해줘. src/worker.js 부터.';
const 할일목록 = [
  { text: 'src/worker.js 의 로그 형식 고치기', state: 'pending' },
  { text: '고친 뒤 검사 돌리기', state: 'pending' },
];
const 할일실은판 = () => {
  const c = 만들기();
  c.todos = 할일목록;
  return c;
};

trace('1-꼬리가-무거운-대화');

// ── 1. 꼬리가 무거워도 요약 뒤에 자리가 난다 ────────────────────────────
{
  const 창 = 16000;
  const s = 세션({ ctx: 창 });
  const ms = [{ role: 'user', content: '로그 형식 통일해줘' }];
  for (let i = 0; i < 14; i++) ms.push(부름(i), 결과(i, '짧은 결과'), { role: 'assistant', content: `${i}번째를 봤습니다.` }, { role: 'user', content: '계속' });
  for (let i = 14; i < 22; i++) ms.push(부름(i), 결과(i, '가'.repeat(1500)));
  s.messages = ms;

  const 개수로만 = split(ms);
  const 크기로도 = split(ms, { 창 });
  check('먼저: 개수로만 자르면 꼬리가 창의 절반을 넘는다', 토큰(개수로만.tail) > 창 * 0.5, `${토큰(개수로만.tail)}`);
  check('★ 창을 주면 꼬리가 25% 안이다', 토큰(크기로도.tail) <= 창 * 0.25, `${토큰(크기로도.tail)}`);

  const r = await compact(s, { 부르기: 가짜요약() });
  const b = s.breakdown();
  check('★★ 꼬리가 무거운 대화도 요약 뒤 70% 아래로 내려간다', r.ok && b.used / b.total < 0.7, `${r.before} → ${b.used} / ${b.total}`);
  check('짝이 안 깨졌다', repairToolPairs(s.messages).고친것 === 0, '');

  // 창을 안 주면 예전과 똑같이 자른다.
  const 예전 = split(ms, { 창: 0 });
  check('창 0 은 예전 동작 그대로다', 예전.tail.length === 개수로만.tail.length && 예전.head.length === 개수로만.head.length,
    `${예전.tail.length} · ${개수로만.tail.length}`);

  // 마지막 교환은 혼자 상한을 넘어도 남는다.
  const 큰끝 = [...말많은대화(6), 부름(90), 결과(90, '가'.repeat(9000))];
  const p = split(큰끝, { 창 });
  check('★ 마지막 교환은 혼자 상한을 넘어도 남긴다', p.tail.length === 2 && 도구결과인가(p.tail[1]), `${p.tail.length}`);

  // 머리가 창의 10% 를 넘으면 접을 구간으로 넘긴다.
  const 큰머리 = [{ role: 'user', content: `큰머리표시 ${'가'.repeat(2000)}` }, ...말많은대화(10).slice(1)];
  const q = split(큰머리, { 창 });
  check('★ 머리가 창의 10% 를 넘으면 안 남긴다', q.head.length === 0 && q.fold[0] === 큰머리[0], `${q.head.length}`);
  const 작은머리 = split(말많은대화(10), { 창 });
  check('짝: 작은 머리는 그대로 남긴다', 작은머리.head.length === 2, `${작은머리.head.length}`);
  const s머리 = 세션({ ctx: 창 });
  s머리.messages = 큰머리;
  s머리.이번요청 = 시킨말;
  await compact(s머리, { 부르기: 가짜요약() });
  check('머리를 접어도 시킨 말은 다시 박힌다', JSON.stringify(s머리.messages).includes(시킨말), '');
}

trace('2-요약이-자리를-못-냄');

// ── 2. 요약이 자리를 못 내면 같은 걸음에 비운다 ─────────────────────────
{
  새판([
    { 글: '가'.repeat(13000), 읽기: 'a0.txt' },       // 마지막 교환 자체가 창을 먹는다
    { 글: '비운 뒤 다 했습니다.' },
  ]);
  const s = 세션({ ctx: 16000 });
  s.messages = 말많은대화(6);
  s.할일 = 할일목록;
  const 본것 = await 돌리기(s, 시킨말, 할일실은판());
  const 종류 = 종류들(본것);
  const 비움 = 본것.find((e) => e.type === 'reset');
  const 비운뒤요청 = 턴요청들.at(-1) ?? [];
  const 글 = JSON.stringify(비운뒤요청);

  check('★★ 요약이 자리를 못 내면 그 자리에서 비운다', 종류.includes('compacted') && 종류.includes('reset'), 줄임(본것));
  check('요약 다음에 비운다', 종류.indexOf('compacted') < 종류.indexOf('reset'), 줄임(본것));
  check('요약은 한 번만 불렀다', 요약요청수 === 1, `${요약요청수}`);
  check('★ 같은 걸음에 비웠다 — 요약과 비우기 사이에 모델을 안 불렀다', 비움?.나간요청 === 1, `${비움?.나간요청}`);
  check('★ 쪽지에 시킨 말이 있다', 글.includes(시킨말), '');
  check('★ 쪽지에 남은 할 일이 있다', 글.includes('src/worker.js 의 로그 형식 고치기') && 글.includes('고친 뒤 검사 돌리기'), '');
  check('★ 쪽지에 요약이 있다', 글.includes('요약본문표시'), '');
  check('reset 에 auto 표시가 있다', 비움?.auto === true, JSON.stringify(비움));
  check('reset 에 요약을 실었다고 적힌다', 비움?.kept?.요약 === true, JSON.stringify(비움?.kept));
  check('옛 대화는 진짜로 없다', !글.includes('나'.repeat(500)) && !글.includes('가'.repeat(13000)), '');
  check('★ 턴은 계속돼 끝까지 갔다', 종류.includes('done') && !종류.includes('error'), 줄임(본것));
  check('읽은 파일 기억도 비웠다', s.filesRead.size === 0, `${s.filesRead.size}`);
}

trace('3-막-요약했는데-또-참');

// ── 3. 요약 후 2걸음 안에 또 차면 요약 없이 비운다 ──────────────────────
{
  새판([
    { 글: '가'.repeat(13600), 읽기: 'a0.txt' },
    { 글: '다 했습니다.' },
  ]);
  const s = 세션({ ctx: 16000 });
  s.messages = 말많은대화(14);
  const 본것 = await 돌리기(s, 시킨말);
  const 종류 = 종류들(본것);
  const 접음 = 본것.find((e) => e.type === 'compacted');
  const 비움 = 본것.find((e) => e.type === 'reset');
  check('먼저: 첫 요약은 70% 아래로 내렸다', 접음 && 접음.after / 16000 < 0.7, `${접음?.after}`);
  check('★★ 요약 요청은 한 번뿐이다', 요약요청수 === 1, `${요약요청수} · ${줄임(본것)}`);
  check('★★ 그리고 비웠다', 종류.filter((t) => t === 'reset').length === 1, 줄임(본것));
  check('요약 다음 걸음에 비웠다', 비움?.나간요청 === 1, `${비움?.나간요청}`);
  check('「접는 중」 도 한 번만 떴다', 종류.filter((t) => t === 'compacting').length === 1, 줄임(본것));
  check('받아 둔 요약을 들고 갔다', JSON.stringify(턴요청들.at(-1)).includes('요약본문표시'), '');
  check('턴이 끝까지 갔다', 종류.includes('done'), 줄임(본것));
}

trace('4-긴-턴의-두-번째-비우기');

// ── 4. 긴 턴에서는 두 번째도 비운다. 연달아 비우지는 않는다 ─────────────
{
  const 무거운걸음 = Array.from({ length: 8 }, (_, i) => ({ 글: '가'.repeat(13600), 읽기: `a${i}.txt` }));
  새판([...무거운걸음, { 글: '다 했습니다.' }]);
  const s = 세션({ ctx: 16000 });
  const 본것 = await 돌리기(s, 시킨말);
  const 비움들 = 본것.filter((e) => e.type === 'reset');
  check('★★ 긴 턴에서 두 번째 비우기가 된다', 비움들.length >= 2, 줄임(본것));
  const 간격들 = 비움들.slice(1).map((e, i) => e.나간요청 - 비움들[i].나간요청);
  check('★★ 연달아 비우지 않는다 — 3걸음 이상 띈다', 간격들.length > 0 && 간격들.every((x) => x >= 3), JSON.stringify(간격들));
  check('턴이 끝까지 갔다', 종류들(본것).includes('done') && !종류들(본것).includes('error'), 줄임(본것));
}
{
  // 서버 거절 길도 긴 턴에서는 다시 비운다.
  새판([
    { 거절: 16000 },                       // 배운다
    { 거절: 16000 },                       // 비운다
    { 글: '하나', 읽기: 'a0.txt' },
    { 글: '둘', 읽기: 'a1.txt' },
    { 거절: 16000 },                       // 한참 뒤의 거절 — 다시 비운다
    { 글: '다 했습니다.' },
  ]);
  const s = 세션({ ctx: 16000 });
  const 본것 = await 돌리기(s, 시킨말);
  check('★★ 서버 거절 길도 2걸음 지나면 다시 비운다',
    종류들(본것).filter((t) => t === 'reset').length === 2 && 종류들(본것).includes('done'), 줄임(본것));
}

trace('5-비운-직후-또-거절');

// ── 5. 비운 직후 또 거절되면 끝없이 안 돌고 오류로 끝난다 ───────────────
{
  새판(Array.from({ length: 40 }, () => ({ 거절: 16000 })));
  const s = 세션({ ctx: 16000 });
  s.messages = 말많은대화(4);
  const 본것 = await 돌리기(s, 시킨말);
  const 종류 = 종류들(본것);
  check('★★ 비운 직후 또 거절되면 오류로 끝난다', 종류.includes('error') && !종류.includes('done'), 줄임(본것));
  check('비우기는 한 번뿐이다', 종류.filter((t) => t === 'reset').length === 1, 줄임(본것));
  check('★ 끝없이 안 돈다', 턴요청들.length <= 4, `${턴요청들.length}회`);
  check('오류가 비우기보다 뒤다', 종류.lastIndexOf('reset') < 종류.indexOf('error'), 줄임(본것));
}

trace('6-요약-요청-크기');

// ── 6. 요약 요청의 크기와 생각 강도 ─────────────────────────────────────
{
  const 창 = 65536;
  const 잡기 = (받은) => async (_conn, o) => { 받은.push(o); return { content: 요약글, finish_reason: 'stop' }; };
  const 요청크기 = (o) => o.messages.reduce((a, m) => a + estimateTokens(m.content), 0);
  const 긴대화 = () => {
    const ms = 말많은대화(60);
    // 머리(앞 둘)는 안 접히므로 그 다음 자리에 표를 둔다. 접을 구간의 맨 앞이다.
    ms[2] = { role: 'user', content: `맨앞표시 ${ms[2].content}` };
    return ms;
  };

  const 받은 = [];
  const s = 세션({ ctx: 창 });
  s.messages = 긴대화();
  const r = await compact(s, { 부르기: 잡기(받은) });
  const 글 = String(받은[0]?.messages?.at(-1)?.content ?? '');
  check('먼저: 접었다', r.ok, r.why ?? '');
  check('★★ 로컬 연결의 요약 요청이 창 12% 안이다', 요청크기(받은[0]) <= 창 * 0.12, `${요청크기(받은[0])} / ${Math.floor(창 * 0.12)}`);
  check('★ 넘치면 앞을 생략했다고 적는다', /앞쪽 대화는 길어서 생략했습니다/.test(글), 글.slice(0, 200));
  check('★ 앞이 빠진다', !글.includes('맨앞표시'), '');
  const 접힌끝 = split(긴대화(), { 창 }).fold.at(-1).content.slice(0, 20);
  check('★ 최근 쪽은 남는다', 글.includes(접힌끝), 접힌끝);
  check('★★ 로컬 요약은 생각을 끈다', 받은[0]?.think === 'off', String(받은[0]?.think));

  const 바깥받은 = [];
  const 바깥 = new Session(연결({ ctx: 창, base: 'https://deel-test.invalid/v1' }), { root, work: 'auto', think: 'off' });
  바깥.messages = 긴대화();
  await compact(바깥, { 부르기: 잡기(바깥받은) });
  check('★ 바깥 연결은 창의 절반까지 싣는다', 요청크기(바깥받은[0]) > 창 * 0.12 && 요청크기(바깥받은[0]) <= 창 * 0.5, `${요청크기(바깥받은[0])}`);
  check('바깥 요약은 예전대로 low', 바깥받은[0]?.think === 'low', String(바깥받은[0]?.think));
  check('상한 셈: 로컬 12% · 바깥 50% · 창 모름 0',
    요약입력상한(연결(), 1000) === 120 && 요약입력상한({ base: 'https://deel-test.invalid' }, 1000) === 500 && 요약입력상한(연결(), 0) === 0, '');

  const ollama받은 = [];
  const 올 = new Session(연결({ ctx: 창, kind: 'ollama' }), { root, work: 'auto', think: 'off' });
  올.messages = 긴대화();
  await compact(올, { 부르기: 잡기(ollama받은) });
  check('Ollama 요약은 false 로 끈다', ollama받은[0]?.think === false, String(ollama받은[0]?.think));

  // 마지막 줄 하나가 혼자 상한을 넘어도 빈 대화록을 안 보낸다.
  const 받은2 = [];
  const s2 = 세션({ ctx: 16000 });
  s2.messages = [
    ...말많은대화(1),
    { role: 'assistant', content: 'ㅋ' },
    { role: 'user', content: 'ㅋ' },
    { role: 'assistant', content: `큰말끝표시${'가'.repeat(6000)}뒤쪽표시` },
    { role: 'user', content: '계속' }, { role: 'assistant', content: '네' },
  ];
  await compact(s2, { 부르기: 잡기(받은2) });
  const 글2 = String(받은2[0]?.messages?.at(-1)?.content ?? '');
  check('★ 한 줄이 혼자 넘치면 그 줄의 뒤쪽을 싣는다', 글2.includes('뒤쪽표시') && !글2.includes('큰말끝표시'), 글2.slice(-60));
}

trace('7-규격-3종의-짝');

// ── 7. 규격 3종에서 짝이 안 깨지고, 인자까지 세어 꼬리를 묶는다 ─────────
{
  const 창 = 16000;
  for (const 규격 of ['openai', 'anthropic', 'ollama']) {
    const 아이디 = (x) => (규격 === 'ollama' ? null : x);
    const 만든것 = [{ role: 'user', content: '해줘' }];
    for (let i = 0; i < 16; i++) {
      // 한 걸음에 도구 둘 — 결과가 여러 줄이라 자르기가 제일 잘 틀리는 모양이다.
      만든것.push(assistantMessage(규격, {
        content: `${i}번째`,
        toolCalls: [
          { id: 아이디(`r${i}`), name: 'Read', args: { file_path: `f${i}.js` } },
          { id: 아이디(`w${i}`), name: 'Write', args: { file_path: `g${i}.js`, content: `인자표시${'가'.repeat(1500)}` } },
        ],
      }));
      만든것.push(toolMessage(규격, { callId: 아이디(`r${i}`), name: 'Read', content: '짧다' }));
      만든것.push(toolMessage(규격, { callId: 아이디(`w${i}`), name: 'Write', content: '적었다' }));
    }

    const p = split(만든것, { 창 });
    check(`★★ ${규격}: 꼬리가 결과로 시작하지 않는다`, !도구결과인가(p.tail[0]), JSON.stringify(p.tail[0])?.slice(0, 60));
    check(`★★ ${규격}: 도구 호출 인자까지 세어 꼬리가 25% 안이다`, 토큰(p.tail) <= 창 * 0.25, `${토큰(p.tail)}`);
    check(`  ${규격}: 그래도 꼬리가 비지 않는다`, p.tail.length >= 3, `${p.tail.length}`);
    check(`  ${규격}: 인자를 뺐다면 더 많이 남겼을 자리다`, p.tail.length < Math.floor(만든것.length * 0.3), `${p.tail.length} / ${만든것.length}`);

    const s = new Session(연결({ ctx: 창, kind: 규격 }), { root, work: 'auto', think: 'off' });
    s.messages = 만든것;
    const r = await compact(s, { 부르기: 가짜요약() });
    check(`★★ ${규격}: 접어도 짝이 안 깨진다`, r.ok && repairToolPairs(s.messages).고친것 === 0, `${r.why ?? ''} 고친것 ${repairToolPairs(s.messages).고친것}`);
    check(`★ ${규격}: 인자를 접힘 표로 바꿔 쓰지 않는다`,
      !JSON.stringify(s.messages).includes(접힘표) && JSON.stringify(s.messages).includes(`인자표시${'가'.repeat(1500)}`), '');
  }
}

trace('8-창-모름-작은-창');

// ── 8. 창을 모를 때, 비워도 소용없는 작은 창 ────────────────────────────
{
  for (const ctx of [0, undefined]) {
    새판([{ 글: '다 했습니다.' }]);
    const s = 세션({ ctx });
    s.messages = 말많은대화(40);
    const b = s.breakdown();
    check(`먼저: 창 ${ctx} 는 짐작값이고 그 위로 찼다`, b.총잰것 === false && b.used / b.total >= 0.8, `${b.used}/${b.total}`);
    check(`★ 창 ${ctx}: 비울까 가 거짓이다`, !비울까(s) && !비우면빌까(s), '');
    const 본것 = await 돌리기(s, 시킨말);
    check(`★★ 창 ${ctx}: 터지지 않고 헛비우지 않는다`, 종류들(본것).includes('done') && !종류들(본것).includes('reset'), 줄임(본것));
  }

  // 창을 모르면 요약 요청에 상한을 안 건다.
  const 받은 = [];
  const s무 = 세션({ ctx: 0 });
  s무.messages = 말많은대화(120);
  s무.messages[2] = { role: 'user', content: `맨앞표시 ${s무.messages[2].content}` };
  await compact(s무, { 부르기: async (_c, o) => { 받은.push(o); return { content: 요약글, finish_reason: 'stop' }; } });
  check('★ 창을 모르면 요약 요청에 상한이 없다', String(받은[0]?.messages?.at(-1)?.content ?? '').includes('맨앞표시'), '');

  // 고정 몫이 창의 대부분인 작은 창을 찾는다. 고정 몫은 창에 맞춰 줄어드므로 재 본다.
  let 작은창 = 0;
  for (let c = 1000; c <= 16000; c += 100) {
    const 잰 = 세션({ ctx: c }).breakdown();
    if (잰.used / c >= 0.74 && 잰.used / c <= 0.9) { 작은창 = c; break; }
  }
  check('먼저: 고정 몫이 창의 대부분인 작은 창이 있다', 작은창 > 0, `${작은창}`);
  if (작은창 > 0) {
    새판([{ 글: '다 했습니다.' }]);
    const s = 세션({ ctx: 작은창 });
    s.messages = [{ role: 'user', content: '짧은 앞말' }, { role: 'assistant', content: '네' }];
    check('★ 작은 창: 비워도 소용없으면 비울까 가 거짓이다', !비울까(s), `${s.breakdown().used}/${작은창}`);
    const 본것 = await 돌리기(s, '짧게');
    check('★★ 작은 창: 터지지 않고 헛비우지 않는다', 종류들(본것).includes('done') && !종류들(본것).includes('reset'), 줄임(본것));
  }

  check('실을요약: 창의 15% 안으로 자른다', estimateTokens(실을요약('가'.repeat(5000), 4000)) <= 4000 * 비워서날몫, `${estimateTokens(실을요약('가'.repeat(5000), 4000))}`);
  check('실을요약: 없으면 빈 글', 실을요약(null, 4000) === '', '');
  check('실을요약: 창 모름도 상한은 있다', estimateTokens(실을요약('가'.repeat(5000), 0)) <= 1200, '');
}

trace('9-세-번째-압축');

// ── 9. 세 번째 압축에서 비우고 세대가 0 으로 돌아간다 ───────────────────
{
  새판([{ 글: '다 했습니다.' }]);
  const s = 세션({ ctx: 16000 });
  s.messages = 말많은대화(14);
  const r1 = await compact(s, { 부르기: 가짜요약() });
  check('먼저: 첫 요약은 1대다', r1.세대 === 1 && 요약세대(s.messages) === 1, `${r1.세대}`);
  check('표식에 세대가 적힌다', s.messages.some((m) => /요약해 접었습니다 · 1번째/.test(String(m.content ?? ''))), '');
  s.messages.push(...말많은대화(14));
  const r2 = await compact(s, { 부르기: 가짜요약() });
  check('먼저: 둘째 요약은 2대다', r2.세대 === 2 && 요약세대(s.messages) === 2, `${r2.세대}`);
  s.messages.push(...말많은대화(14));
  check('먼저: 또 찼다', shouldCompact(s), '');

  const 본것 = await 돌리기(s, 시킨말);
  const 종류 = 종류들(본것);
  const 접음 = 본것.find((e) => e.type === 'compacted');
  const 비움 = 본것.find((e) => e.type === 'reset');
  check('★ 세 번째 압축은 요약을 받는다', 요약요청수 === 1 && 접음?.세대 === 3, `${요약요청수} · ${접음?.세대}`);
  check('먼저: 요약만으로는 70% 아래다 — 0.7 문턱이 아니라 세대가 비운 것이다', 접음 && 접음.after / 16000 < 0.7, `${접음?.after}`);
  check('★★ 세 번째 압축에서 비운다', 종류.includes('reset') && 종류.indexOf('compacted') < 종류.indexOf('reset'), 줄임(본것));
  check('★★ 세대가 0 으로 돌아간다', 요약세대(s.messages) === 0, `${요약세대(s.messages)}`);
  check('★ 방금 받은 요약을 쪽지에 싣는다', 비움?.kept?.요약 === true && JSON.stringify(턴요청들.at(-1)).includes('요약본문표시'), '');
  check('턴이 끝까지 갔다', 종류.includes('done'), 줄임(본것));

  // 짝: 아직 1대면 비우지 않는다.
  새판([{ 글: '다 했습니다.' }]);
  const s둘째 = 세션({ ctx: 16000 });
  s둘째.messages = 말많은대화(14);
  await compact(s둘째, { 부르기: 가짜요약() });
  s둘째.messages.push(...말많은대화(14));
  const 본둘째 = await 돌리기(s둘째, 시킨말);
  check('짝: 두 번째 압축에서는 안 비운다', !종류들(본둘째).includes('reset') && 요약세대(s둘째.messages) === 2, 줄임(본둘째));

  // 비워도 소용없으면 세 번째여도 안 비운다.
  const 작은 = 세션({ ctx: 16000 });
  작은.messages = [{ role: 'user', content: '[앞선 대화 4개를 요약해 접었습니다 · 2번째. 아래가 그 요약입니다.]\n\n요약' }];
  check('짝: 세대가 쌓여도 비워서 안 비면 비우면빌까 가 거짓이다', !비우면빌까(작은), `${작은.breakdown().used}`);
}

trace('10-이어받은-대화의-세대');

// ── 10. --resume 으로 되살린 대화에서도 세대를 이어 읽는다 ──────────────
{
  const s = 세션({ ctx: 16000 });
  s.messages = 말많은대화(14);
  await compact(s, { 부르기: 가짜요약() });
  s.messages.push(...말많은대화(14));
  await compact(s, { 부르기: 가짜요약() });

  const st = new Store(root, 'autoclear-resume');
  st.begin({ model: 'fake', root });
  st.replace(s.messages, '압축');
  const 되살린 = new Store(root, 'autoclear-resume').load().messages;
  check('★★ 되살린 대화에서 세대를 읽는다', 요약세대(되살린) === 2, `${요약세대(되살린)}`);

  const s2 = 세션({ ctx: 16000 });
  s2.messages = [...되살린, ...말많은대화(14)];
  const r = await compact(s2, { 부르기: 가짜요약() });
  check('★★ 되살린 대화의 다음 요약은 세대를 이어 간다', r.세대 === 3 && 요약세대(s2.messages) === 3, `${r.세대}`);

  // 세대를 적기 전에 만든 대화를 이어받아도 1대로 읽는다.
  const 옛표식 = [{ role: 'user', content: '[앞선 대화 7개를 요약해 접었습니다. 아래가 그 요약입니다.]\n\n옛요약본문\n\n[요약 끝. 이어서 진행하세요. 파일 내용이 필요하면 다시 읽으세요.]' }];
  check('★ 세대 없는 옛 표식은 1대다', 요약세대(옛표식) === 1, `${요약세대(옛표식)}`);
  check('옛 표식에서도 본문을 읽는다', 마지막요약(옛표식) === '옛요약본문', String(마지막요약(옛표식)));

  check('사람이 인용한 글은 세대로 안 친다',
    요약세대([{ role: 'user', content: '이 줄 뭐야: [앞선 대화 3개를 요약해 접었습니다 · 9번째. 아래가 그 요약입니다.]\n\n' }]) === 0, '');
  check('도구 결과에 든 글은 세대로 안 친다',
    요약세대([{ role: 'tool', tool_call_id: 'x', content: '[앞선 대화 3개를 요약해 접었습니다 · 9번째. 아래가 그 요약입니다.]\n\n' }]) === 0, '');
  check('대화가 비면 0 이다', 요약세대([]) === 0, '');
}

trace('11-세-번째-요약이-실패');

// ── 11. 세 번째 압축의 요약이 실패해도 마지막 요약을 들고 비운다 ────────
{
  새판([{ 글: '다 했습니다.' }]);
  const 옛시킨말 = '옛날에시킨말표시';
  const s = 세션({ ctx: 16000 });
  s.이번요청 = 옛시킨말;
  s.messages = 말많은대화(14);
  await compact(s, { 부르기: 가짜요약('첫요약본문') });
  s.messages.push(...말많은대화(14));
  await compact(s, { 부르기: 가짜요약('둘째요약본문') });
  s.messages.push(...말많은대화(14));
  check('먼저: 마지막 요약 본문만 읽는다', 마지막요약(s.messages) === '둘째요약본문', String(마지막요약(s.messages)));

  요약막기 = true;
  const 본것 = await 돌리기(s, 시킨말);
  const 종류 = 종류들(본것);
  const 비움 = 본것.find((e) => e.type === 'reset');
  const 비운글 = String((턴요청들.at(-1) ?? []).find((m) => /비웠습니다/.test(String(m.content ?? '')))?.content ?? '');
  check('먼저: 요약을 불렀고 실패했다', 요약요청수 === 1, `${요약요청수}`);
  check('★★ 세 번째 요약이 실패해도 비운다', 종류.includes('reset') && 요약세대(s.messages) === 0, 줄임(본것));
  check('★★ 마지막 요약을 들고 간다', 비운글.includes('둘째요약본문') && 비움?.kept?.요약 === true, 비운글.slice(0, 160));
  check('★ 옛 쪽지는 안 따라온다 — 지금 시킨 말만 박힌다', !비운글.includes(옛시킨말) && 비운글.includes(시킨말), 비운글.slice(0, 200));
  check('턴이 끝까지 갔다', 종류.includes('done'), 줄임(본것));
}

trace('12-로컬-문턱');

// ── 12·13. 큰 창의 로컬은 문턱을 앞당긴다 ───────────────────────────────
{
  const 찬세션 = (덧, 토큰수) => {
    const s = new Session(연결(덧), { root, work: 'auto', think: 'off' });
    const 고정 = s.breakdown().used;
    s.messages = [{ role: 'user', content: '가'.repeat(토큰수 - 고정) }];
    return s;
  };
  const 로컬65 = { ctx: 65536 };
  check('★★ 로컬 65k 는 40k 에서 요약한다', shouldCompact(찬세션(로컬65, 40000)), '');
  check('★★ 로컬 65k 는 39k 에서는 안 한다', !shouldCompact(찬세션(로컬65, 39000)), '');
  check('at 을 직접 주면 배율을 안 건다', !shouldCompact(찬세션(로컬65, 40000), 0.8) && shouldCompact(찬세션(로컬65, 52429), 0.8), '');

  // 접기 문턱. 첫 두 부름 동안은 캐시가 돈다고 치므로 0.72 쪽이다.
  check('★ 로컬 65k 접기(캐시 돎)는 36k 근처', shouldFold(찬세션(로컬65, 36000)) && !shouldFold(찬세션(로컬65, 35500)), '');
  const 캐시없음 = (토큰수) => { const s = 찬세션(로컬65, 토큰수); s.usage.calls = 5; s.usage.cacheRead = 0; return s; };
  check('★ 로컬 65k 접기(캐시 안 돎)도 당긴다', shouldFold(캐시없음(27600)) && !shouldFold(캐시없음(27000)), '');
  check('at 을 직접 주면 접기에도 배율을 안 건다', !shouldFold(찬세션(로컬65, 36000), 0.72), '');

  check('★ 로컬 65k 비우기는 35k 근처', 비울까(찬세션(로컬65, 35100)) && !비울까(찬세션(로컬65, 34500)), '');

  const 바깥65 = { ctx: 65536, base: 'https://deel-test.invalid/v1' };
  check('★★ 바깥 65k 는 배율 1', 문턱배율(찬세션(바깥65, 40000)) === 1, '');
  check('★★ 바깥 65k 는 예전 80% 그대로', !shouldCompact(찬세션(바깥65, 52000)) && shouldCompact(찬세션(바깥65, 52500)), '');
  check('★ 바깥 65k 비우기는 예전 70% 그대로', !비울까(찬세션(바깥65, 45500)) && 비울까(찬세션(바깥65, 46000)), '');

  const 로컬32 = { ctx: 32768 };
  check('★★ 로컬 32k 는 배율 1', 문턱배율(찬세션(로컬32, 20000)) === 1, '');
  check('★★ 로컬 32k 는 예전 80% 그대로', !shouldCompact(찬세션(로컬32, 26000)) && shouldCompact(찬세션(로컬32, 26300)), '');
  check('로컬 50k 는 배율 1 (40,000 경계)', 문턱배율(찬세션({ ctx: 50000 }, 20000)) === 1, '');
}

trace('13-자르는-자리');

// safeCut 이 뒤로만 물러서는 것을 이 검사가 기대고 있다는 표시 — 바뀌면 여기가 먼저 알린다.
{
  const 짝 = [{ role: 'user', content: 'a' }, 부름(1), 결과(1, 'r'), { role: 'assistant', content: 'b' }];
  check('safeCut 은 결과 줄에서 부름까지 물러선다', safeCut(짝, 2) === 1, `${safeCut(짝, 2)}`);
}

trace('14-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n자동 비우기  ${D}(요약으로 자리가 안 나면 턴 안에서 비우는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
server.closeAllConnections?.();
server.close();
rmSync(root, { recursive: true, force: true });
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
