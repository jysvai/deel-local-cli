// 작업 모드 검증.
//
// 확인해야 할 것은 '모드가 바뀌었다' 가 아니다. 바꿔 봐야 실제로 달라지지
// 않으면 아무 의미가 없다. 그래서 세 가지를 본다.
//
//   1) 읽기만 하는 모드에서는 파일을 바꾸는 도구가 모델에게 아예 안 간다
//   2) 모드에 따라 생각의 배분과 걸음 수가 실제로 달라진다
//   3) 사용자가 직접 정한 값은 모드가 덮지 않는다
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODES, ORDER, normalize, get, next, canWrite, allow } from '../src/agent/modes.js';
import { 걸음수 } from '../src/agent/budget.js';
import { toolSchemas } from '../src/tools/index.js';
import { TODO_TOOL } from '../src/tools/todo.js';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { effortFor } from '../src/agent/effort.js';
import { 강도말 } from '../src/backend/adapter.js';
import { 기본카드, 눈금맞추기 } from '../src/backend/wire.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 1. 이름 알아듣기 ────────────────────────────────────────────────────
check('영문 이름', normalize('architect') === 'architect');
check('한글 이름', normalize('계획') === 'plan');
check('다른 한글 이름', normalize('플랜') === 'plan');
check('줄임말', normalize('d') === 'debug');
check('대소문자 무시', normalize('CODE') === 'code');
check('모르는 이름은 null', normalize('없는모드') === null);
check('빈 값도 null', normalize('') === null);

// ── 2. 차례로 돌리기 (Shift+Tab) ────────────────────────────────────────
{
  const 돈것 = [];
  let cur = 'code';
  for (let i = 0; i < ORDER.length; i++) { 돈것.push(cur); cur = next(cur); }
  check('여섯 모드를 다 거침', new Set(돈것).size === ORDER.length, 돈것.join('→'));
  check('한 바퀴 돌면 제자리', cur === 'code', cur);
}

// ── 3. 읽기 전용 모드에는 바꾸는 도구가 없다 ────────────────────────────
const 바꾸는것 = ['Write', 'Edit', 'Bash'];
for (const id of ORDER) {
  const 이름들 = toolSchemas(null, { hasSkills: true, web: true, work: id })
    .map((t) => t.function.name);
  const 있는바꾸는것 = 이름들.filter((n) => 바꾸는것.includes(n));

  if (canWrite(id)) {
    check(`${MODES[id].name}: 바꾸는 도구가 있다`, 있는바꾸는것.length === 3, 있는바꾸는것.join(','));
  } else {
    check(`${MODES[id].name}: 바꾸는 도구가 없다`, 있는바꾸는것.length === 0,
      있는바꾸는것.length ? `새어 나감: ${있는바꾸는것.join(',')}` : '');
  }
  check(`${MODES[id].name}: Read 는 언제나 있다`, 이름들.includes('Read'), 이름들.join(','));
}

check('계획 모드에 TodoWrite 는 있다',
  toolSchemas(null, { work: 'plan' }).map((t) => t.function.name).includes('TodoWrite'));
check('묻기 모드에는 TodoWrite 도 없다',
  !toolSchemas(null, { work: 'ask' }).map((t) => t.function.name).includes('TodoWrite'));

/*
 * ── 계획이 늘 세 단계로 나오던 것 ───────────────────────────────────────
 *
 * 도구 설명이 이랬다: "세 단계 이상 걸리는 일이면 먼저 목록을 만들고".
 * 모델은 이걸 **세 개를 적으라는 말**로 읽는다. 그래서 열 단계짜리 일도
 * 세 줄로 뭉쳐 나왔다 — 코드가 자른 게 아니라 그렇게 적어 온 것이다.
 *
 * 개수는 일의 크기가 정하는 것이고 상한이 없다. 설명에 그렇게 적혀 있는지
 * 본다. 화면 쪽은 몇 개가 오든 그대로 다 그린다(아래 render 검사).
 */
{
  const 쓴것 = toolSchemas(null, { work: 'plan' }).find((t) => t.function.name === 'TodoWrite').function;
  const 설명 = 쓴것.description ?? '';
  check('개수는 일의 크기가 정한다고 적혀 있다', /일의 크기가 정한다/.test(설명), `${설명.length}자`);
  check('상한이 없다고 말해 준다', /상한도 없다/.test(설명));
  check('개수 맞추려 뭉치지 말라고 못 박는다', /뭉치지 마라/.test(설명));
  // 옛 문장이 남아 있으면 모델이 다시 세 개로 읽는다.
  check('"세 단계 이상" 이라는 말이 남아 있지 않다', !/세 단계 이상/.test(설명));
  /*
   * 설명은 창이 좁으면 **뒤에서부터 문장째로 잘린다**. 그래서 규격이 뒤에
   * 있으면 조용히 사라진다 — 실제로 개수 이야기를 앞에 넣었다가 doing 규칙이
   * 통째로 밀려 나갔다. 규격이 살아 있는지를 같이 잰다.
   */
  check('설명이 늘어도 doing 규칙이 안 밀려난다', /doing 은 한 번에 하나만/.test(설명));
  // 바깥 설명이 다 잘려 나가는 좁은 창에서도 개수 이야기는 인자 쪽에 남는다.
  check('인자 설명에도 개수 제한이 없다고 적혀 있다',
    /개수 제한 없음/.test(쓴것.parameters?.properties?.todos?.description ?? ''),
    쓴것.parameters?.properties?.todos?.description ?? '');
}

// 많이 와도 도구가 안 자른다. 자르면 계획의 뒷부분이 조용히 사라진다.
{
  const 많은것 = Array.from({ length: 17 }, (_, i) => ({ text: `${i + 1}번째 단계`, state: 'todo' }));
  const r = TODO_TOOL.run({ todos: 많은것 }, {});
  const 줄수 = String(r.content ?? '').split('\n').filter((l) => /번째 단계/.test(l)).length;
  check('17개를 주면 17개가 다 들어간다', r.todos?.length === 17, `${r.todos?.length}개`);
  check('17개가 다 그려진다', 줄수 === 17, `${줄수}개`);
  check('마지막 것도 안 잘린다', /17번째 단계/.test(String(r.content ?? '')));
}

/*
 * ── 똑같은 목록을 또 보내면 그렇다고 말하는가 ───────────────────────────
 *
 * 「폴더 정리 해줘」 에서 이 자리가 걸렸다. 파일을 옮긴 뒤 모델이 목록을
 * 갱신하려 했는데, 끝난 줄을 done 으로 안 바꾸고 **글자 하나 안 틀린 같은
 * 목록**을 다시 보냈다. 그러면 성공으로 돌려주고 앞과 똑같은 글이 나간다 —
 * 모델 쪽에서는 갱신이 된 것이라, 다음 걸음에 또 같은 것을 보낸다.
 */
{
  const 목록 = {
    todos: [
      { text: '구조를 확인한다', state: 'done' },
      { text: '유형별로 옮긴다', state: 'doing' },
      { text: '검증하고 요약한다', state: 'todo' },
    ],
  };
  const ctx = {};
  const 처음 = TODO_TOOL.run(목록, ctx);
  const 다시 = TODO_TOOL.run(목록, ctx);

  check('★ 같은 목록을 또 보내면 앞과 다른 말을 돌려준다', 처음.content !== 다시.content,
    처음.content === 다시.content ? '글자까지 같다 — 모델이 아무것도 못 배운다' : '');
  check('★ 바뀐 것이 없다고 말해 준다', /바뀐 것이 없습니다/.test(다시.content ?? ''),
    String(다시.content ?? '').split('\n').at(-2) ?? '');
  check('★ 그럴 때 무엇을 하라고 알려 준다',
    /done 으로 바꿔서/.test(다시.content ?? '') && /다음 일을 하세요/.test(다시.content ?? ''));
  // 오류로 만들면 안 된다 — 목록은 실제로 저장됐고 틀린 것을 한 것도 아니다.
  check('오류로 만들지는 않는다', !다시.error && 다시.todos?.length === 3, String(다시.error ?? ''));
  check('요약도 그대로라고 말한다', /그대로/.test(다시.summary ?? ''), 다시.summary ?? '');

  // 한 줄이라도 달라지면 평범한 갱신이다.
  const 바꾼것 = { todos: 목록.todos.map((t, i) => (i === 1 ? { ...t, state: 'done' } : t)) };
  const 셋째 = TODO_TOOL.run(바꾼것, ctx);
  check('★ 한 줄이라도 바뀌면 평범하게 돌려준다', !/바뀐 것이 없습니다/.test(셋째.content ?? ''),
    셋째.summary ?? '');
  check('무엇이 방금 끝났는지 센다', /방금 1개/.test(셋째.summary ?? ''), 셋째.summary ?? '');
}

// 없는 것을 만들어 주지는 않는다 — 오프라인이면 웹 도구는 모드와 무관하게 없다
check('오프라인이면 모드와 무관하게 웹 도구 없음',
  !toolSchemas(null, { web: false, work: 'ask' }).map((t) => t.function.name).includes('WebFetch'));

check('allow 는 있는 것 중에서만 고른다',
  allow('code', ['Read', '없는도구']).join(',') === 'Read',
  allow('code', ['Read', '없는도구']).join(','));

// ── 4. 모드가 생각의 배분과 걸음 수를 실제로 바꾼다 ─────────────────────
check('계획은 깊게', get('plan').effort === 'deep');
check('코드는 아껴서', get('code').effort === 'save');
/*
 * 걸음 수는 모드에 안 박혀 있다 — **모델 크기에서 나온다** (agent/budget.js).
 *
 * 전에는 모드마다 숫자가 있었다(코드 24회). 그 값이 맞는 모델은 하나도 없다.
 * 8k 짜리에는 너무 크고, 655k 짜리는 여유가 96% 남았는데도 만들다 만 채로
 * 끊겼다. 그래서 모드는 '성격' 만 갖고, 실제 숫자는 컨텍스트에서 뽑는다.
 */
check('모드에 걸음 수를 박아 두지 않는다', ORDER.every((k) => MODES[k].steps === undefined),
  ORDER.filter((k) => MODES[k].steps !== undefined).join(','));

for (const ctx of [8192, 32768, 655360]) {
  check(`${ctx} — 디버그가 묻기보다 넉넉`, 걸음수('debug', ctx) > 걸음수('ask', ctx),
    `${걸음수('debug', ctx)} vs ${걸음수('ask', ctx)}`);
  check(`${ctx} — 총괄이 가장 넉넉`,
    걸음수('orchestrator', ctx) === Math.max(...ORDER.map((k) => 걸음수(k, ctx))),
    String(걸음수('orchestrator', ctx)));
}

// 큰 모델이면 더 오래 돈다. 이게 이 절의 핵심이다.
check('컨텍스트가 크면 걸음도 는다', 걸음수('code', 655360) > 걸음수('code', 8192) * 5,
  `8k ${걸음수('code', 8192)}걸음 → 655k ${걸음수('code', 655360)}걸음`);
// 그래도 끝없이 늘지는 않는다 — 마지막 울타리는 있어야 한다.
check('아무리 커도 울타리는 있다', 걸음수('code', 100_000_000) <= 200,
  String(걸음수('code', 100_000_000)));
// 컨텍스트를 못 알아냈어도 돌기는 돌아야 한다.
check('컨텍스트를 몰라도 값이 나온다', 걸음수('code', null) >= 16, String(걸음수('code', null)));

// ── 5. 진짜 루프에서 확인 ───────────────────────────────────────────────
// 가짜 게이트웨이가 받은 요청을 그대로 들여다본다. 프롬프트가 아니라
// 실제로 보낸 도구 목록을 본다 — 부탁이 아니라 사실이어야 한다.
const 받은것 = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    받은것.push(JSON.parse(body || '{}'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: '알겠습니다.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/v1`;
resetNet();
allowEndpoint(base);

const root = mkdtempSync(join(tmpdir(), 'deel-mode-'));
const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 32768, streaming: false, tools: true };
const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
ctx.history.nextTurn();

async function 한턴(work, opts = {}) {
  받은것.length = 0;
  const s = new Session(conn, { root, work, ...opts });
  for await (const _ of run(s, ctx, '해줘')) { /* 흘려보낸다 */ }
  return { body: 받은것[0], s };
}

{
  const { body } = await 한턴('plan');
  const 이름들 = (body?.tools ?? []).map((t) => t.function.name);
  check('계획 모드로 실제 보낸 요청에 Write 없음', !이름들.includes('Write'), 이름들.join(','));
  check('계획 모드로 실제 보낸 요청에 Bash 없음', !이름들.includes('Bash'), 이름들.join(','));
  const sys = body?.messages?.[0]?.content ?? '';
  check('시스템 프롬프트에 지금 모드가 적힘', sys.includes('계획'), sys.slice(0, 60));
}

{
  const { body } = await 한턴('code');
  const 이름들 = (body?.tools ?? []).map((t) => t.function.name);
  check('코드 모드로 실제 보낸 요청에 Write 있음', 이름들.includes('Write'), 이름들.join(','));
}

// ── 6. 사용자가 직접 정한 값은 모드가 안 덮는다 ─────────────────────────
// 보낸 값은 원래 강도가 아니라 '단계별로 보정된' 값이다. effort.js 가 첫 판단을
// 한 칸 올리기도 하기 때문이다. 그래서 기대값도 같은 셈으로 구한다 —
// 여기서 숫자를 손으로 적으면 배분 규칙이 바뀔 때마다 검사가 거짓말을 한다.
const 보낸강도 = (b) => b?.reasoning_effort ?? b?.think;
/*
 * 셈이 한 걸음 늘었다. effort.js 로 보정한 뒤, 그 값을 **그 규격이 아는 말**로
 * 옮겨서 싣는다 (adapter.js 의 강도말).
 *
 * 이 검사가 그 걸음을 실제로 만났다. 계획 모드는 high 인데 첫 판단에서 한 칸
 * 올라 `max` 가 되고, `max` 를 받는 창구는 하나도 없다 — 즉 `/plan` 한 번이면
 * 그 턴이 400 으로 죽고 있었다. 사람이 `/think max` 를 칠 필요도 없었다.
 *
 * 여기서 기대값을 손으로 'max' 라고 적으면 안 된다. 그러면 전선에 못 나가는
 * 값을 「맞다」 고 지키는 검사가 된다. 제품이 밟는 그 두 걸음을 그대로 밟는다.
 */
const 기대강도 = (강도, 배분, 단계) => 강도말(effortFor(강도, 배분, 단계));

{
  // 계획 모드는 think 를 high 로 올리려 한다. 사용자가 low 로 정해 뒀으면 그게 이긴다.
  const s = new Session(conn, { root, work: 'plan', think: 'low' });
  s.thinkSet = true;
  받은것.length = 0;
  for await (const _ of run(s, ctx, '해줘')) { /* */ }
  const 기대 = 기대강도('low', get('plan').effort, 'plan');
  check('사용자가 정한 think 가 이긴다', 보낸강도(받은것[0]) === 기대,
    `보냄 ${보낸강도(받은것[0])} · 기대 ${기대}`);
}

{
  // 안 정해 뒀으면 모드가 정한 값이 쓰인다
  const s = new Session(conn, { root, work: 'plan', think: 'low' });
  받은것.length = 0;
  for await (const _ of run(s, ctx, '해줘')) { /* */ }
  const 기대 = 기대강도(get('plan').think, get('plan').effort, 'plan');
  check('안 정했으면 모드 값이 쓰인다', 보낸강도(받은것[0]) === 기대,
    `보냄 ${보낸강도(받은것[0])} · 기대 ${기대}`);
}

{
  // 위 둘이 실제로 다른 값이어야 의미가 있다. 같으면 검사가 아무것도 안 지킨 것이다.
  // 위에서 잰 것이 **전선에 실린 값**이므로 여기서도 전선 값으로 잰다.
  const 정한것 = 기대강도('low', get('plan').effort, 'plan');
  const 모드것 = 기대강도(get('plan').think, get('plan').effort, 'plan');
  check('두 경우가 실제로 다르다', 정한것 !== 모드것, `${정한것} vs ${모드것}`);
}

/*
 * ★ 이 모드가 혼자서 우리 눈금의 위쪽 칸을 밟는다.
 *
 * 계획 모드는 high 인데 「깊게」 배분이 첫 판단을 한 칸 올려 `xhigh` 가 된다.
 * 사람이 `/think` 를 아예 안 건드려도 그렇다 — 그래서 이 자리가 중요하다.
 *
 * `xhigh` 는 Claude 창구에만 있는 칸이다. 예전에는 이 값이 그대로 전선에
 * 나가서 다른 창구에서 400 으로 죽었다. 지금은 두 겹으로 막는다.
 *
 *   전선 카드를 모를 때  강도말() 이 규격이 늘 아는 말로 낮춘다
 *   전선 카드를 알 때    눈금맞추기() 가 그 회사 눈금으로 낮춘다
 *
 * 아래 넷은 그 두 겹이 각각 살아 있는지를 본다. 하나라도 빠지면 `/plan` 한
 * 번에 그 턴이 죽는다.
 */
{
  const 셈한것 = effortFor(get('plan').think, get('plan').effort, 'plan');
  check('★ 계획 모드는 혼자서 xhigh 까지 올라간다', 셈한것 === 'xhigh', 셈한것);
  check('★ 카드를 모르면 규격이 아는 말로 낮춘다', 강도말(셈한것) === 'high', String(강도말(셈한것)));

  const 클로드 = 기본카드({ base: 'https://api.anthropic.com/v1', kind: 'anthropic', model: 'claude-opus-5' });
  check(
    '★ Claude 창구에서는 xhigh 가 그대로 간다',
    눈금맞추기(클로드, 셈한것) === 'xhigh',
    String(눈금맞추기(클로드, 셈한것)),
  );

  const 오픈AI = 기본카드({ base: 'https://api.openai.com/v1', kind: 'openai', model: 'gpt-5' });
  check(
    '★ OpenAI 창구에서는 그 눈금 안으로 낮춘다',
    눈금맞추기(오픈AI, 셈한것) === 'high',
    String(눈금맞추기(오픈AI, 셈한것)),
  );
}

server.closeAllConnections?.();
server.close();
await new Promise((r) => setImmediate(r));
// ── 모드가 '이름표' 가 아니라 '일하는 방식' 인가 ────────────────────────
//
// 도구를 빼고 추론을 올리는 것만으로는 모드가 아니다. 그건 설정이다.
// 계획 모드로 바꾸면 계획하는 절차가, 디버그 모드로 바꾸면 원인 찾는 절차가
// 실제로 모델에게 가야 한다. 안 가면 모드를 바꾼 보람이 없다.
{
  const { MODES, ORDER } = await import('../src/agent/modes.js');

  for (const k of ORDER) {
    const m = MODES[k];
    const 줄수 = m.say.split('\n').length;
    check(`${m.name}: 한 줄 안내가 아니라 절차다`, 줄수 >= 5, `${줄수}줄`);
    // 첫 줄이 '지금 무슨 일을 하는 중인지' 를 못 박아야 한다.
    // 모델은 프롬프트 앞머리를 가장 잘 따른다 — 여기서 흐리면 뒤가 다 흐려진다.
    check(`${m.name}: 무슨 일인지 먼저 못 박는다`, /^지금/.test(m.say), m.say.split('\n')[0]);
  }

  // 모드마다 절차가 실제로 달라야 한다. 같은 말을 여러 번 쓰면 모드가 아니다.
  const 말들 = ORDER.map((k) => MODES[k].say);
  check('모든 모드의 절차가 서로 다르다', new Set(말들).size === ORDER.length,
    `모드 ${ORDER.length}개 중 서로 다른 것 ${new Set(말들).size}개`);

  // 각 모드가 그 일에 필요한 것을 실제로 말하는가
  const 있어야할것 = {
    plan: [/TodoWrite/, /이대로 진행할까요/, /위험/],
    architect: [/선택지/, /의존/, /관례/],
    debug: [/재현/, /가설/, /증거/],
    // 구현 모드는 도구 넷을 제 자리에서 쓰게 시켜야 한다. 하나라도 빠지면
    // 그 자리에서 예전 방식으로 돌아간다 — 통째로 Read 하거나, 한 파일씩
    // 만들거나, 확인 없이 "다 됐습니다" 로 끝맺는다.
    code: [/먼저 Read/, /관례/, /확인 못 했/, /Outline/, /Verify/, /files 배열/],
    ask: [/줄 번호/, /모르면 모른다/],
    orchestrator: [/TodoWrite/, /하나만 진행 중/, /못 한 것/],
  };
  for (const [k, 규칙들] of Object.entries(있어야할것)) {
    for (const re of 규칙들) {
      check(`${MODES[k].name}: ${re.source} 를 말한다`, re.test(MODES[k].say), '');
    }
  }

  // 읽기만 하는 모드는 '못 바꾼다' 는 사실을 말로도 알려 줘야 한다.
  // 도구를 빼는 것만으로는 모델이 왜 안 되는지 몰라 헛되이 시도한다.
  for (const k of ['plan', 'architect']) {
    check(`${MODES[k].name}: 파일을 못 바꾼다고 말해 준다`,
      /파일을 바꾸는 도구는 주어지지 않았다/.test(MODES[k].say), '');
  }

  // 실제로 시스템 프롬프트에 실리는가 — 여기까지 와야 모델이 본다.
  const { Session } = await import('../src/agent/session.js');
  const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', auth: 'none', key: null, model: 'x', ctx: 32768 };
  for (const k of ORDER) {
    const s = new Session(conn, { root, work: k });
    const sys = s.systemPrompt();
    const 첫줄 = MODES[k].say.split('\n')[0];
    check(`${MODES[k].name}: 절차가 시스템 프롬프트에 실린다`, sys.includes(첫줄), 첫줄.slice(0, 30));
    check(`${MODES[k].name}: 어느 모드인지도 같이 실린다`, sys.includes(`지금 모드: ${MODES[k].name}`), '');
  }

  // 모드를 바꾸면 다음 요청부터 바로 달라져야 한다. 세션을 새로 만들 필요가 없다.
  {
    const s = new Session(conn, { root, work: 'code' });
    const 전 = s.systemPrompt();
    s.work = 'debug';
    const 후 = s.systemPrompt();
    check('모드를 바꾸면 프롬프트가 즉시 바뀐다', 전 !== 후 && 후.includes('원인 찾기'), '');
    check('바꾸기 전 모드의 절차는 빠진다', !후.includes(MODES.code.say.split('\n')[0]), '');
  }

  // 절차가 길어지면 컨텍스트를 먹는다. 얼마나 먹는지 눈에 보이게 둔다.
  const 가장긴것 = Math.max(...말들.map((x) => x.length));
  check('절차가 지나치게 길지 않다', 가장긴것 < 1500, `가장 긴 것 ${가장긴것}자`);
}

rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n작업 모드 검사  ${D}(바꾸면 실제로 달라지는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
