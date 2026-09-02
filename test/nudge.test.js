// 조사만 하고 "무엇을 도와드릴까요" 로 끝내는 턴을 한 번 되민다 (agent/loop.js).
//
// 이 검사가 있는 이유는 실제로 이렇게 끝난 턴 때문이다 —
//   ☰ TodoWrite(3건) → ◧ Read × 27 → ▌ 무엇을 도와드릴까요?
//   ── 30.9초 · 도구 27회
// 오류는 하나도 없다. 걸음 수 상한에도 안 닿았다. 반복 감지에도 안 걸린다.
// 그런데 사람이 시킨 일은 시작도 안 됐고, 다시 시키면 스물일곱 개를 또 읽는다.
//
// 그래서 여기서 보는 것은 "밀었나" 하나가 아니라 **안 밀어야 할 때 안 미나** 다.
// 잘못 밀면 다 끝낸 모델을 붙잡고 한 번 더 돌리는 셈이라, 느린 로컬 모델에서는
// 그것만으로 몇십 초다.
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { allowEndpoint } from '../src/safety/network.js';
import { 못박을것 } from '../src/agent/session.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 가짜 게이트웨이 ────────────────────────────────────────────────
let script = [];
let turn = 0;
const 보낸것 = [];

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
    보낸것.push(JSON.parse(body || '{}'));
    const step = script[turn++] ?? { text: '(대본 끝)' };
    if (step.toolCall) {
      const argStr = JSON.stringify(step.toolCall.args);
      return sse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: `c${turn}`, function: { name: step.toolCall.name, arguments: argStr } } ] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20 } },
      ]);
    }
    return sse(res, [
      { choices: [{ delta: { content: String(step.text) } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 30 } },
    ]);
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/v1`;
allowEndpoint(base);

const conn = () => ({
  kind: 'openai', base, auth: 'bearer', key: 'test-key', model: 'fake-llm',
  ctx: 32768, streaming: true, tools: true, json: true, think: false,
});

/**
 * 한 판 돌린다. 폴더도 대본도 판마다 새로 만든다 — 판끼리 안 섞이게.
 * `todos` 는 ctx 에 그대로 얹는다. TodoWrite 를 대본에 넣으면 걸음만 늘고,
 * 여기서 보는 것은 "할 일이 남아 있을 때 어떻게 하나" 이지 그 도구가 아니다.
 */
async function 돌리기(대본, { work = 'auto', todos = [], 시킨말 = '문서 정리해줘' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'deel-nudge-'));
  writeFileSync(join(root, 'README.md'), '# 제목\n\n낡은 설명.\n', 'utf8');
  script = 대본;
  turn = 0;
  보낸것.length = 0;
  const ctx = {
    scope: makeScope(root), history: new History(root), audit: new Audit(root),
    seen: new Set(), todos,
  };
  const session = new Session(conn(), { root, work, think: 'off' });
  const events = [];
  for await (const ev of run(session, ctx, 시킨말)) events.push(ev);
  return { events, root, ctx, session, 종류: events.map((e) => e.type) };
}

const 되묻기 = '무엇을 도와드릴까요? 프로젝트 구조와 실행 방식은 확인했습니다.';
const 할일 = [{ text: 'README 를 정리한다', state: 'doing' }];

// ── 1. 되묻고 끝내려 하면 민다 ──────────────────────────────────────
{
  const { events, root, 종류 } = await 돌리기([
    { toolCall: { name: 'Read', args: { file_path: 'README.md' } } },
    { text: 되묻기 },
    { toolCall: { name: 'Edit', args: { file_path: 'README.md', old_string: '낡은 설명.', new_string: '새 설명.' } } },
    { text: 'README 를 정리했습니다.' },
  ], { todos: 할일 });

  check('되물으면 nudge 가 나온다', 종류.includes('nudge'), 종류.join(','));
  check('밀고 나서 done 까지 갔다', 종류.indexOf('nudge') < 종류.lastIndexOf('done') && 종류.includes('done'), 종류.join(','));
  check('민 이유가 되물음이다', events.find((e) => e.type === 'nudge')?.why === '되물음');
  check('민 뒤에 파일이 실제로 바뀌었다', readFileSync(join(root, 'README.md'), 'utf8').includes('새 설명.'));
  check('민 턴의 done 은 파일을 들고 온다', (events.at(-1)?.files ?? []).length === 1, JSON.stringify(events.at(-1)?.files ?? []));

  // 되민 말이 모델에게 실제로 갔나. 이벤트만 보면 화면에만 찍히고 안 갔을 수 있다.
  const 마지막요청 = 보낸것.at(-1);
  const 사람말 = (마지막요청?.messages ?? []).filter((m) => m.role === 'user').map((m) => String(m.content));
  check('되민 말이 요청에 실려 나갔다', 사람말.some((t) => t.includes('되묻지 말고')), 사람말.join(' | ').slice(0, 200));
  check('되민 말에 원래 시킨 말이 들어 있다', 사람말.some((t) => t.includes('문서 정리해줘')));
}

// ── 2. 할 일이 남았는데 한 줄로 끝내면 민다 ─────────────────────────
{
  const { events, 종류 } = await 돌리기([
    { toolCall: { name: 'Read', args: { file_path: 'README.md' } } },
    { text: '프로젝트 구조는 확인했습니다.' },
    { text: '정리를 마쳤습니다.' },
  ], { todos: 할일 });
  check('할 일이 남았는데 한 줄로 끝내면 민다', 종류.includes('nudge'), 종류.join(','));
  check('그 이유는 할일남음이다', events.find((e) => e.type === 'nudge')?.why === '할일남음');
}

// ── 3. 두 번은 안 민다 ──────────────────────────────────────────────
//
// 한 번 밀었는데도 또 되물으면 그건 진짜 막힌 것이다. 거기서 또 밀면 못 하는
// 일을 두고 실랑이가 되고, 사람은 그 사이 아무 소식도 못 듣는다.
{
  const { 종류 } = await 돌리기([
    { toolCall: { name: 'Read', args: { file_path: 'README.md' } } },
    { text: 되묻기 },
    { text: '무엇을 도와드릴까요?' },
  ], { todos: 할일 });
  check('밀기는 턴에 한 번뿐이다', 종류.filter((t) => t === 'nudge').length === 1, 종류.join(','));
  check('두 번째 되물음은 그대로 사람에게 간다', 종류.at(-1) === 'done', 종류.join(','));
}

// ── 4. 뭐라도 바꿨으면 안 민다 ──────────────────────────────────────
//
// 고쳐 놓고 "더 필요한 것 있으면 말씀해 주세요" 로 맺는 것은 정상이다.
// 여기서 밀면 다 한 일을 한 번 더 돌리는 셈이다.
{
  const { 종류 } = await 돌리기([
    { toolCall: { name: 'Read', args: { file_path: 'README.md' } } },
    { toolCall: { name: 'Edit', args: { file_path: 'README.md', old_string: '낡은 설명.', new_string: '새 설명.' } } },
    { text: '정리했습니다. 더 필요한 것이 있으면 말씀해 주세요.' },
  ], { todos: 할일 });
  check('바꾼 것이 있으면 안 민다', !종류.includes('nudge'), 종류.join(','));
}

// ── 5. 안 바꾸는 모드에서는 안 민다 ─────────────────────────────────
//
// 묻기 모드는 파일을 못 바꾼다. 거기서 "아직 아무것도 안 바꿨다" 고 밀면
// 있지도 않은 도구를 찾게 만든다.
{
  const { 종류 } = await 돌리기([
    { toolCall: { name: 'Read', args: { file_path: 'README.md' } } },
    { text: 되묻기 },
  ], { work: 'ask', todos: 할일 });
  check('묻기 모드에서는 안 민다', !종류.includes('nudge'), 종류.join(','));
}

// ── 6. 제대로 보고하면 안 민다 ──────────────────────────────────────
//
// 할 일이 남아 있어도 답이 길면 그건 보고다. 길이로 가른다 — 되묻는 말은
// 짧고, 조사 결과를 적은 답은 길다.
{
  const 보고 = '구조를 살펴봤습니다. src 아래에 모듈이 열둘 있고 그중 넷이 문서와 어긋납니다. '
    + 'README 는 옛 경로를 가리키고 있고, PDF 안내 문서는 사라진 스크립트를 부릅니다. '
    + '고칠 곳은 세 군데인데, 그중 하나는 사람이 정해야 할 것이 있습니다 — 옛 경로를 지울지 남겨 둘지입니다. '
    + '나머지 두 곳은 그대로 고쳐도 되는 자리라 다음 걸음에서 손대겠습니다.';
  const { 종류 } = await 돌리기([
    { toolCall: { name: 'Read', args: { file_path: 'README.md' } } },
    { text: 보고 },
  ], { todos: 할일 });
  check('긴 보고는 안 민다', !종류.includes('nudge'), `${보고.length}자 · ${종류.join(',')}`);
}

// ── 7. 할 일이 없고 되묻지도 않으면 안 민다 ─────────────────────────
{
  const { 종류 } = await 돌리기([
    { toolCall: { name: 'Read', args: { file_path: 'README.md' } } },
    { text: '고칠 것이 없습니다.' },
  ], { todos: [] });
  check('할 일도 없고 되묻지도 않으면 안 민다', !종류.includes('nudge'), 종류.join(','));
}

// ── 8. 다 끝낸 할 일은 남은 것이 아니다 ─────────────────────────────
{
  const { 종류 } = await 돌리기([
    { toolCall: { name: 'Read', args: { file_path: 'README.md' } } },
    { text: '다 했습니다.' },
  ], { todos: [{ text: 'README 를 정리한다', state: 'done' }] });
  check('끝난 할 일만 있으면 안 민다', !종류.includes('nudge'), 종류.join(','));
}

// ── 9. 되묻는 말투 여러 가지 ────────────────────────────────────────
//
// 실제로 화면에 찍힌 말들이다. 하나만 잡으면 나머지로 새어 나간다.
{
  const 말들 = [
    '원하시는 작업을 말씀해 주세요. 프로젝트 코드 수정·실행 오류 점검 등을 처리하겠습니다.',
    '무엇을 도와드릴까요?',
    '어떤 작업부터 할까요?',
    '어떻게 할까요?',
    'What would you like me to do next?',
    'Let me know what you want changed.',
  ];
  for (const 말 of 말들) {
    const { 종류 } = await 돌리기([
      { toolCall: { name: 'Read', args: { file_path: 'README.md' } } },
      { text: 말 },
      { text: '했습니다.' },
    ], { todos: [] });
    check(`되묻는 말투를 잡는다: ${말.slice(0, 24)}`, 종류.includes('nudge'), 종류.join(','));
  }
}

// ── 10. 앞에서 부른 것과 같은지 볼 때 글자 모양을 맞춘다 ─────────────
//
// 맥은 한글 파일 이름을 자모로 쪼개서 돌려준다(NFD). 모델이 쓰는 한글은 합쳐진
// 모양(NFC)이다. 눈에는 같은데 글자로는 다르다. 그래서 같은 것을 두 번 불러도
// 서명이 달라 되풀이로 안 잡혔고, 결과가 두 번 실렸다 — 실제 화면에서는
// 3,250줄짜리 파일이 그렇게 두 번 들어갔다.
//
// 여기서 파일이 아니라 Glob 을 쓰는 이유: 맥은 파일을 찾을 때 이름을 알아서
// 맞춰 주지만 윈도우·리눅스는 안 그런다. 파일로 검사하면 이 검사가 맥에서만
// 통과한다. 아무것도 안 걸리는 패턴이면 어느 자리에서나 결과가 똑같으므로,
// 남는 차이는 **서명뿐**이다 — 그게 여기서 보려는 것이다.
{
  const 패턴 = '없는문서*.md';
  const root = mkdtempSync(join(tmpdir(), 'deel-nudge-nfc-'));
  script = [
    { toolCall: { name: 'Glob', args: { pattern: 패턴.normalize('NFC') } } },
    { toolCall: { name: 'Glob', args: { pattern: 패턴.normalize('NFD') } } },
    { text: '없습니다.' },
  ];
  turn = 0;
  보낸것.length = 0;
  const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set(), todos: [] };
  const session = new Session(conn(), { root, work: 'auto', think: 'off' });
  const events = [];
  for await (const ev of run(session, ctx, '문서 찾아줘')) events.push(ev);

  check('두 번 다 오류 없이 돌았다',
    events.filter((e) => e.type === 'tool' && !e.result?.error).length === 2,
    JSON.stringify(events.filter((e) => e.type === 'tool').map((e) => e.result?.error ?? 'ok')));

  const 도구답 = (보낸것.at(-1)?.messages ?? []).filter((m) => m.role === 'tool').map((m) => String(m.content));
  check('자모가 쪼개진 같은 인자를 되풀이로 잡는다',
    도구답.some((t) => t.includes('앞에서 부른')), 도구답.join(' | ').slice(0, 200));
}

// ── 인사에는 안 민다 ────────────────────────────────────────────────
//
// 진짜로 이렇게 났다 —
//
//   ❯ 안녕
//     ▌ 안녕하세요! 무엇을 도와드릴까요?
//     ↺ 읽기만 하고 끝내려고 해서 한 번 되밀었습니다
//     ▌ 안녕하세요! 반갑습니다.
//     ── 6.8초
//
// 「안녕」 한 마디에 모델을 두 번 부른다. 되밀기는 **시킨 일을 안 하고 되돌려준**
// 자리를 잡으라고 만든 것인데, 인사는 시킨 일이 없다. 시킨 것이 없으면 안 한
// 것도 없다. 로컬 모델에서 이 헛왕복이 6.8초다.
{
  for (const 인사 of ['안녕', '안녕하세요', 'hi', 'Hello!', '반갑습니다', '고마워요', 'ㅎㅇ', '감사합니다']) {
    const { 종류 } = await 돌리기([{ text: '안녕하세요! 무엇을 도와드릴까요?' }], { 시킨말: 인사 });
    check(`★ 「${인사}」 에는 안 민다`, !종류.includes('nudge'), 종류.join(','));
  }

  // 한 번만 부르고 끝나야 한다. 되밀면 두 번 부른다 — 그게 6.8초의 정체다.
  const { 종류 } = await 돌리기([{ text: '안녕하세요! 무엇을 도와드릴까요?' }], { 시킨말: '안녕' });
  check('★ 인사는 모델을 한 번만 부른다', 보낸것.length === 1, `${보낸것.length}번 부름`);
  check('인사도 답은 그대로 나온다', 종류.includes('content'), 종류.join(','));

  /*
   * ★ 반대쪽. 인사말이 아닌 진짜 지시에는 그대로 밀어야 한다.
   *
   * 이걸 같이 안 재면 되밀기를 통째로 꺼 놓고도 위 여덟 줄이 초록이 된다.
   */
  const 시킨것 = await 돌리기([
    { text: '무엇을 도와드릴까요?' },
    { toolCall: { name: 'Edit', args: { file_path: 'README.md', old_string: '낡은 설명.', new_string: '새 설명.' } } },
    { text: '고쳤습니다.' },
  ], { todos: 할일, 시킨말: 'README 정리해줘' });
  check('★ 진짜 지시에는 그대로 민다', 시킨것.종류.includes('nudge'), 시킨것.종류.join(','));

  // 인사로 시작해도 뒤에 일이 붙어 있으면 지시다.
  const 섞인것 = await 돌리기([
    { text: '무엇을 도와드릴까요?' },
    { toolCall: { name: 'Edit', args: { file_path: 'README.md', old_string: '낡은 설명.', new_string: '새 설명.' } } },
    { text: '고쳤습니다.' },
  ], { todos: 할일, 시킨말: '안녕, README 정리해줘' });
  check('★ 인사 뒤에 일이 붙으면 지시로 본다', 섞인것.종류.includes('nudge'), 섞인것.종류.join(','));
}

/*
 * ── ★ 할 일 목록을 세션에도 넘겨 준다 ──────────────────────────────
 *
 * 여태 목록이 사는 자리는 도구 결과 하나뿐이었다. 그런데 도구 결과는
 * 55%에서 한 줄로 접히고 80%에서 요약에 뭉개진다. 접힘 문구는 「필요하면
 * 다시 읽으세요」인데 **할 일 목록은 다시 읽을 파일이 없다.**
 *
 * 접거나 줄일 때 다시 실어 주려면 session 이 목록을 들고 있어야 한다
 * (session.js 의 못박은할일). ctx.todos 는 우리 코드만 보는 것이라
 * 모델에게는 아무 소용이 없다.
 *
 * 이 검사가 여기 있는 까닭은 진짜 루프를 돌리는 판이 이 파일에만 있어서다.
 * compact.test.js 는 박아 넣는 쪽을 재고, 여기서는 **넣어 주는 쪽**을 잰다 —
 * 둘 중 하나만 있으면 나머지 한 줄을 지워도 안 빨개진다.
 */
{
  const 목록 = [
    { text: 'README 를 정리한다', state: 'done' },
    { text: '설정 파일을 손본다', state: 'doing' },
    { text: '검사를 돌린다', state: 'todo' },
  ];
  const { session, ctx } = await 돌리기([
    { toolCall: { name: 'TodoWrite', args: { todos: 목록 } } },
    { toolCall: { name: 'Edit', args: { file_path: 'README.md', old_string: '낡은 설명.', new_string: '새 설명.' } } },
    { text: 'README 를 정리했습니다. 설정 파일은 아직 남았습니다.' },
  ]);

  check('★ 할 일 목록이 세션에 남는다', (session.할일 ?? []).length === 3,
    JSON.stringify(session.할일 ?? null));
  check('★ 상태까지 그대로 남는다',
    session.할일?.find((x) => x.text === '설정 파일을 손본다')?.state === 'doing',
    JSON.stringify(session.할일));
  // ctx 쪽도 그대로여야 한다 — 되밀기 판단이 그걸 본다.
  check('ctx.todos 도 같이 선다', (ctx.todos ?? []).length === 3);

  // 접혀도 안 끝난 것이 살아남는지는 여기서 바로 확인한다. 이게 이 줄의 목적이다.
  const 박은것 = 못박을것(session);
  check('★ 접힐 때 박을 글에 안 끝난 것이 들어간다',
    박은것.includes('설정 파일을 손본다') && 박은것.includes('검사를 돌린다'), 박은것.slice(0, 160));
  check('끝난 것은 안 들어간다', !박은것.includes('README 를 정리한다'));
}

// ── 결과 ───────────────────────────────────────────────────────────
server.close();
for (const f of fail) console.log(`  ✗ ${f.name}${f.note ? ` — ${f.note}` : ''}`);
console.log(`${pass.length}개 통과 · ${fail.length}개 실패`);
process.exitCode = fail.length ? 1 : 0;
