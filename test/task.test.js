/**
 * 하위 작업(Task) 검사.
 *
 * ── 여기서 재는 것 ────────────────────────────────────────────────────
 *
 * 하위 작업의 값어치는 "돌아간다" 가 아니다. **부모 창에 안 쌓인다** 는 것이다.
 * 그게 안 되면 도구 하나가 395토큰만 더 먹고 아무것도 안 바뀐 것과 같다.
 * 그래서 첫 절이 부모 대화의 크기를 직접 잰다.
 *
 * 나머지는 전부 **울타리**다. 하위 작업은 새 Session 을 만들어 루프를 통째로
 * 한 번 더 도는 일이라, 안전 축을 하나라도 빠뜨리면 그 축이 하위에서만
 * 조용히 사라진다 — 화면에는 아무 표시도 안 난다. 그래서 넷을 다 못으로 박는다.
 *   작업 범위(scope) · 되돌리기(undo) · 감사기록(audit) · 승인 방식(mode)
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { allowEndpoint } from '../src/safety/network.js';
import { 하위모드, 하위요약, 최대깊이 } from '../src/tools/task.js';
import { toolSchemas } from '../src/tools/index.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 가짜 게이트웨이 ────────────────────────────────────────────────────
//
// 대본을 **순서대로** 내준다. 부모와 하위가 같은 서버를 쓰므로, 대본 한 줄이
// 부모 차례인지 하위 차례인지는 순서가 정한다 — 실제로도 그렇게 돈다.
let script = [];
let turn = 0;
const seenBodies = [];

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'fake-llm' }] }));
    }
    seenBodies.push(JSON.parse(body || '{}'));
    const step = script[turn++] ?? { text: '(대본 끝)' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (step.toolCall) {
      return res.end(JSON.stringify({
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: `c${turn}`, type: 'function',
              function: { name: step.toolCall.name, arguments: JSON.stringify(step.toolCall.args) },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }));
    }
    return res.end(JSON.stringify({
      choices: [{ message: { content: String(step.text) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 30 },
    }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/v1`;
allowEndpoint(base);

const 새연결 = (ctx = 32768) => ({
  kind: 'openai', base, auth: 'none', key: '', model: 'fake-llm',
  ctx, streaming: false, tools: true, json: true, think: false,
});

function 새터 () {
  const root = mkdtempSync(join(tmpdir(), 'deel-task-'));
  const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
  return { root, ctx };
}

const 큰글 = (n) => '가'.repeat(n);

// ═══ 1. 하위가 읽은 것이 부모 창에 안 쌓인다 ══════════════════════════
//
// 이게 이 도구의 존재 이유다. 하위에게 큰 파일 두 개를 읽리고, 부모 대화가
// 그만큼 커졌는지 본다. 커졌으면 창을 나눈 뜻이 없다.
{
  const { root, ctx } = 새터();
  const 파일1 = join(root, 'big1.txt');
  const 파일2 = join(root, 'big2.txt');
  const fs = await import('node:fs');
  fs.writeFileSync(파일1, 큰글(4000), 'utf8');
  fs.writeFileSync(파일2, 큰글(4000), 'utf8');

  turn = 0;
  script = [
    // 부모: 하위에게 떼어 준다
    { toolCall: { name: 'Task', args: { 목적: '큰 파일 둘 훑기', 할일: 'big1.txt 와 big2.txt 를 읽고 무엇이 들었는지 한 줄로 말해라', 모드: 'ask' } } },
    // 하위: 두 파일을 읽는다
    { toolCall: { name: 'Read', args: { file_path: 'big1.txt' } } },
    { toolCall: { name: 'Read', args: { file_path: 'big2.txt' } } },
    { text: '둘 다 같은 글자만 4,000자씩 들어 있습니다.' },
    // 부모: 마무리
    { text: '확인했습니다.' },
  ];

  const session = new Session(새연결(), { root, mode: 'auto', think: 'off', work: 'code' });
  const events = [];
  for await (const ev of run(session, ctx, '큰 파일 둘을 훑어봐')) events.push(ev);

  const 부모글자 = session.messages
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('').length;

  check('하위 작업이 돌았다', events.some((e) => e.type === 'task_start'));
  check('하위가 끝났다고 알렸다', events.some((e) => e.type === 'task_done'));
  check('부모 루프도 끝까지 갔다', events.at(-1)?.type === 'done', events.at(-1)?.type);

  // 파일 두 개 8,000자가 부모 대화에 없다. 요약만 들어 있어야 한다.
  check('하위가 읽은 8,000자가 부모 창에 안 쌓였다', 부모글자 < 3000, `${부모글자}자`);
  check('부모에게는 요약이 들어갔다',
    session.messages.some((m) => m.role === 'tool' && String(m.content).includes('하위 작업 "큰 파일 둘 훑기"')),
    session.messages.filter((m) => m.role === 'tool').map((m) => String(m.content).slice(0, 40)).join(' | '));

  // 하위의 Read 는 화면에는 보였어야 한다 — 안 보이면 몇 분 동안 화면이 죽는다.
  const 하위읽기 = events.filter((e) => e.type === 'tool' && e.name === 'Read');
  check('하위가 부른 도구가 화면 이벤트로 올라왔다', 하위읽기.length === 2, `${하위읽기.length}개`);
  check('하위 이벤트에 깊이가 붙었다', 하위읽기.every((e) => e.depth === 1),
    하위읽기.map((e) => e.depth).join(','));
  // 부모가 그린 이벤트에는 깊이가 없다. 있으면 부모 줄까지 들여쓰기된다.
  check('부모 이벤트에는 깊이가 없다', (events.find((e) => e.type === 'done')?.depth ?? 0) === 0);

  rmSync(root, { recursive: true, force: true });
}

// ═══ 2. 하위가 만든 파일이 부모 것으로 잡힌다 ═════════════════════════
//
// 하위가 만들어 놓고 부모가 모르면, 턴 끝 파일 목록에도 /diff 에도 안 나온다.
// 사람 눈에는 "아무것도 안 만들었다" 로 보인다.
{
  const { root, ctx } = 새터();
  turn = 0;
  script = [
    { toolCall: { name: 'Task', args: { 목적: '뼈대 만들기', 할일: 'index.html 을 만들어라' } } },
    { toolCall: { name: 'Write', args: { file_path: 'index.html', content: '<!doctype html>\n<h1>안녕</h1>\n' } } },
    { text: 'index.html 을 만들었습니다.' },
    { text: '뼈대를 세웠습니다.' },
  ];

  const session = new Session(새연결(), { root, mode: 'auto', think: 'off', work: 'code' });
  const events = [];
  for await (const ev of run(session, ctx, '뼈대 만들어줘')) events.push(ev);

  check('하위가 만든 파일이 디스크에 있다', existsSync(join(root, 'index.html')));

  const 끝 = events.find((e) => e.type === 'done');
  const 이름들 = (끝?.files ?? []).map((f) => f.path);
  check('턴 끝 파일 목록에 하위가 만든 것이 들어 있다',
    이름들.some((p) => p.endsWith('index.html')), 이름들.join(','));
  /*
   * `/diff` 는 loop 이 아니라 repl.js 가 적는다 — 도구 이벤트의 changed·diff 를
   * 보고 부모 세션에 넣는다. 그러니 여기서 재야 할 것은 "하위의 도구 이벤트가
   * 그 두 가지를 달고 위로 올라왔는가" 다. 올라오면 화면 쪽 코드는 부모 것이든
   * 하위 것이든 구분 없이 그대로 처리한다.
   */
  const 쓰기이벤트 = events.find((e) => e.type === 'tool' && e.name === 'Write');
  check('하위의 쓰기 이벤트가 위로 올라왔다', !!쓰기이벤트, '(없음)');
  check('그 이벤트가 바뀐 파일을 달고 왔다 (/diff 가 이걸 본다)',
    String(쓰기이벤트?.result?.changed ?? '').endsWith('index.html'),
    String(쓰기이벤트?.result?.changed ?? '(없음)'));
  check('그 이벤트가 견준 결과도 달고 왔다', !!쓰기이벤트?.result?.diff);

  // 요약은 **디스크를 보고** 적힌다. 하위가 "만들었습니다" 라고 한 말이 아니다.
  const 요약 = session.messages.find((m) => m.role === 'tool' && String(m.content).includes('하위 작업'));
  check('요약이 파일을 사실로 적었다', /✓ index\.html · 2줄/.test(String(요약?.content)),
    String(요약?.content).split('\n').find((l) => l.includes('index.html')) ?? '(없음)');

  rmSync(root, { recursive: true, force: true });
}

// ═══ 3. 안전 축이 하위에서도 그대로 걸린다 ═══════════════════════════

// 3.1 작업 범위 — 하위가 폴더 밖으로 못 나간다
{
  const { root, ctx } = 새터();
  turn = 0;
  script = [
    { toolCall: { name: 'Task', args: { 목적: '밖으로 나가기', 할일: '../밖.txt 를 만들어라' } } },
    { toolCall: { name: 'Write', args: { file_path: '../밖에다쓰기.txt', content: '나감' } } },
    { text: '못 했습니다.' },
    { text: '범위 밖이라 못 했습니다.' },
  ];
  const session = new Session(새연결(), { root, mode: 'auto', think: 'off', work: 'code' });
  for await (const ev of run(session, ctx, '밖에 파일 만들어봐')) void ev;

  check('하위도 작업 폴더 밖으로 못 나간다',
    !existsSync(join(root, '..', '밖에다쓰기.txt')));
  rmSync(root, { recursive: true, force: true });
}

// 3.2 되돌리기 — 부모·하위가 만든 것이 **한 번에** 되돌아간다
//
// 하위가 제 되돌리기 턴을 열면 /undo 한 번이 반쪽만 되돌린다. 그게 제일 나쁘다 —
// 되돌렸다고 알고 있는데 폴더는 섞인 상태로 남는다.
{
  const { root, ctx } = 새터();
  turn = 0;
  script = [
    { toolCall: { name: 'Write', args: { file_path: '부모.txt', content: '부모가 만듦' } } },
    { toolCall: { name: 'Task', args: { 목적: '하위 파일', 할일: '하위.txt 를 만들어라' } } },
    { toolCall: { name: 'Write', args: { file_path: '하위.txt', content: '하위가 만듦' } } },
    { text: '만들었습니다.' },
    { text: '둘 다 만들었습니다.' },
  ];
  const session = new Session(새연결(), { root, mode: 'auto', think: 'off', work: 'code' });
  for await (const ev of run(session, ctx, '파일 두 개 만들어줘')) void ev;

  check('부모가 만든 파일이 있다', existsSync(join(root, '부모.txt')));
  check('하위가 만든 파일이 있다', existsSync(join(root, '하위.txt')));

  // 되돌리기 턴이 하나여야 한다. 둘이면 하위가 제 턴을 연 것이고,
  // 그러면 /undo 한 번이 반쪽만 되돌린다.
  check('되돌리기 턴이 하나로 묶였다', ctx.history.turns().length === 1,
    `${ctx.history.turns().length}개`);

  const r = ctx.history.undo(1);
  check('되돌리기가 두 파일을 다뤘다', r.restored.length === 2,
    r.restored.map((x) => `${x.path.split(/[\/]/).pop()}:${x.how}`).join(' · '));
  check('되돌리기 한 번에 부모 것이 사라졌다', !existsSync(join(root, '부모.txt')));
  check('되돌리기 한 번에 하위 것도 사라졌다 (턴이 안 쪼개졌다)', !existsSync(join(root, '하위.txt')));

  rmSync(root, { recursive: true, force: true });
}

// 3.3 감사기록 — 하위가 한 일이 기록에 남는다
{
  const { root, ctx } = 새터();
  turn = 0;
  script = [
    { toolCall: { name: 'Task', args: { 목적: '기록 남기기', 할일: '기록.txt 를 만들어라' } } },
    { toolCall: { name: 'Write', args: { file_path: '기록.txt', content: '기록' } } },
    { text: '만들었습니다.' },
    { text: '됐습니다.' },
  ];
  const session = new Session(새연결(), { root, mode: 'auto', think: 'off', work: 'code' });
  for await (const ev of run(session, ctx, '기록 남겨줘')) void ev;

  const 기록길 = join(root, '.deel', 'audit.jsonl');
  const 기록 = existsSync(기록길) ? readFileSync(기록길, 'utf8') : '';
  check('감사기록에 하위 작업 시작이 남았다', 기록.includes('하위 작업 시작'), 기록 ? '(기록 있음)' : '(파일 없음)');
  // 무엇을 떼어 줬는지가 안 남으면 '하위를 돌렸다' 만 남는다. 근거가 못 된다.
  check('감사기록에 무슨 하위 작업이었는지도 남았다', /"target":"기록 남기기"/.test(기록));
  check('감사기록에 하위가 부른 Write 가 남았다', /"tool"[\s\S]*기록\.txt/.test(기록));
  check('감사기록에 하위 턴이 겹수와 함께 남았다', 기록.includes('[하위작업 1겹]'));
  rmSync(root, { recursive: true, force: true });
}

// 3.4 승인 방식 — 하위도 물어본다
{
  const { root, ctx } = 새터();
  const 물어본것 = [];
  ctx.confirm = async (name, args) => { 물어본것.push(name); return false; };   // 전부 거절

  turn = 0;
  script = [
    { toolCall: { name: 'Task', args: { 목적: '몰래 쓰기', 할일: '몰래.txt 를 만들어라' } } },
    { toolCall: { name: 'Write', args: { file_path: '몰래.txt', content: '몰래' } } },
    { text: '거부당했습니다.' },
    { text: '못 했습니다.' },
  ];
  // strict = Write·Edit·Bash 를 전부 물어본다
  const session = new Session(새연결(), { root, mode: 'strict', think: 'off', work: 'code' });
  for await (const ev of run(session, ctx, '몰래 만들어봐')) void ev;

  check('하위의 Write 도 승인을 물었다', 물어본것.includes('Write'), 물어본것.join(',') || '(안 물음)');
  check('거절하면 하위도 못 쓴다', !existsSync(join(root, '몰래.txt')));
  rmSync(root, { recursive: true, force: true });
}

// ═══ 4. 깊이 상한 ════════════════════════════════════════════════════
//
// 하위가 하위를 끝없이 낳으면 한 번 시킨 일이 안 끝난다. 부탁으로 막지 않고
// 도구 목록에서 빼서 막는다 — 목록에 없으면 잊을 것이 없다.
{
  const { root, ctx } = 새터();
  turn = 0;
  script = [
    { toolCall: { name: 'Task', args: { 목적: '1겹', 할일: '더 쪼개라' } } },       // 부모 → 1겹
    { toolCall: { name: 'Task', args: { 목적: '2겹', 할일: '더 쪼개라' } } },       // 1겹 → 2겹
    { text: '2겹에서 끝냅니다.' },                                                  // 2겹의 답
    { text: '1겹 끝.' },
    { text: '다 됐습니다.' },
  ];
  const session = new Session(새연결(), { root, mode: 'auto', think: 'off', work: 'code' });
  const events = [];
  for await (const ev of run(session, ctx, '쪼개봐')) events.push(ev);

  /*
   * 여닫는 줄은 **떼어 주는 쪽** 자리에 찍힌다. 그래서 맨 바깥 것은 0,
   * 한 겹 안에서 또 떼어 낸 것은 1 이다. 이게 어긋나면 화면에서 경계선이
   * 엉뚱한 칸에 그어져 어디부터가 하위인지 안 보인다.
   */
  const 깊이들 = events.filter((e) => e.type === 'task_start').map((e) => e.depth ?? 0);
  check('두 겹까지 갔다', 깊이들.join(',') === '0,1', 깊이들.join(','));
  check('두 겹 다 끝맺음을 알렸다',
    events.filter((e) => e.type === 'task_done').map((e) => e.depth ?? 0).join(',') === '1,0',
    events.filter((e) => e.type === 'task_done').map((e) => e.depth ?? 0).join(','));

  // 2겹이 받은 도구 목록에는 Task 가 없어야 한다. 요청 본문을 직접 본다.
  const 요청별도구 = seenBodies
    .map((b) => (b.tools ?? []).map((t) => t.function.name))
    .filter((names) => names.length);
  const Task있는요청 = 요청별도구.filter((n) => n.includes('Task')).length;
  check('세 겹째에는 Task 를 안 준다',
    요청별도구.some((n) => !n.includes('Task')), `${Task있는요청}/${요청별도구.length} 요청에 Task 있음`);
  check('최대깊이가 2다', 최대깊이 === 2, String(최대깊이));

  rmSync(root, { recursive: true, force: true });
}

// ═══ 5. 하위가 부모보다 셀 수 없다 ═══════════════════════════════════
//
// 설계·계획·묻기 모드는 "파일을 안 바꾼다" 는 약속이다. 하위가 제 모드를 code 로
// 골라 그 약속을 넘어가면, 화면에는 설계 모드라고 떠 있는 채로 파일이 바뀐다.
{
  check('읽기 전용 부모 밑에서 code 를 부탁해도 안 준다', 하위모드('code', 'architect') === 'ask',
    하위모드('code', 'architect'));
  check('읽기 전용 부모 밑에서 ask 는 그대로', 하위모드('ask', 'plan') === 'ask');
  check('쓰는 부모 밑에서는 부탁한 대로', 하위모드('debug', 'code') === 'debug');
  check('모드를 안 적으면 code', 하위모드(undefined, 'code') === 'code');
  check('엉뚱한 이름도 code 로 떨어진다', 하위모드('없는모드', 'auto') === 'code');

  // 도구 쪽으로도 한 겹 더 막혀 있다 — 부모가 가졌던 것의 부분집합만 나간다.
  const 부모가진것 = toolSchemas(null, { hasSkills: false, web: true, work: 'architect' })
    .map((t) => t.function.name);
  const 자식것 = toolSchemas(부모가진것, { hasSkills: false, web: true, work: 'code' })
    .map((t) => t.function.name);
  check('설계 모드 부모가 물려준 목록에는 Write 가 없다', !부모가진것.includes('Write'), 부모가진것.join(','));
  check('그 목록을 code 모드로 걸러도 Write 가 안 생긴다', !자식것.includes('Write'), 자식것.join(','));
  check('설계 모드에는 Task 자체가 없다', !부모가진것.includes('Task'));
}

// ═══ 6. 하위가 다 못 끝내면 그렇다고 말한다 ══════════════════════════
//
// 못 한 것을 빼고 요약하면 부모는 다 된 줄 알고 그 위에 다음 일을 쌓는다.
{
  const 요약 = 하위요약({
    목적: '대시보드',
    모드: 'code',
    글자수: 400,
    끝: {
      type: 'limit', steps: 12,
      files: [{ path: '/r/a.js', bytes: 2048, lines: 80 }, { path: '/r/b.css', missing: true }],
      남은할일: [{ text: 'app.js 붙이기', state: 'doing' }],
      text: '두 개는 만들었습니다.',
    },
    보인이름: (p) => p.split('/').pop(),
  });
  check('덜 끝났다는 것을 숨기지 않는다', 요약.includes('다 못 했습니다'), 요약.split('\n')[0]);
  check('만들어진 것은 ✓ 로', 요약.includes('✓ a.js · 80줄 · 2.0KB'));
  check('안 만들어진 것은 ✗ 로', 요약.includes('✗ b.css — 만들어지지 않았습니다'));
  check('남은 할 일을 그대로 올린다', 요약.includes('app.js 붙이기'));

  // 하위가 길게 말해도 부모 창에 들어가는 양은 정해져 있다. 이게 이 도구의 값이다.
  const 긴것 = 하위요약({
    목적: '긴 말', 모드: 'code', 글자수: 400,
    끝: { type: 'done', steps: 3, files: [], text: 큰글(5000) },
  });
  check('긴 말은 창 크기에 맞춰 자른다', 긴것.length < 900, `${긴것.length}자`);
  check('자른 것을 자랐다고 말한다', 긴것.includes('길어서 여기까지만'));

  // 아무것도 안 만들었으면 그렇다고 말한다. 빈 목록을 조용히 빼면 안 된다.
  const 빈것 = 하위요약({ 목적: '빈손', 모드: 'ask', 글자수: 400, 끝: { type: 'done', steps: 1, files: [], text: '읽기만 했습니다.' } });
  check('건드린 파일이 없으면 없다고 말한다', 빈것.includes('건드린 파일: 없음'));
}

// ═══ 7. 할 일이 비면 돌리지 않는다 ═══════════════════════════════════
//
// 하위는 부모 대화를 못 본다. 할 일이 비면 아무것도 모르는 채로 시작해
// 걸음만 태우고 빈손으로 돌아온다.
{
  const { root, ctx } = 새터();
  turn = 0;
  script = [
    { toolCall: { name: 'Task', args: { 목적: '빈 것', 할일: '' } } },
    { text: '할 일을 적겠습니다.' },
  ];
  const session = new Session(새연결(), { root, mode: 'auto', think: 'off', work: 'code' });
  const events = [];
  for await (const ev of run(session, ctx, '아무거나')) events.push(ev);

  check('할 일이 비면 하위를 안 돌린다', !events.some((e) => e.type === 'task_start'));
  const 거절 = events.find((e) => e.type === 'tool' && e.name === 'Task');
  check('왜 안 돌렸는지 말해 준다', /할일/.test(거절?.result?.error ?? ''), 거절?.result?.error ?? '(없음)');
  check('무엇을 적어야 하는지도 알려 준다',
    session.messages.some((m) => m.role === 'tool' && m.content.includes('지금 대화를 볼 수 없')),
    '');
  rmSync(root, { recursive: true, force: true });
}

// ═══ 8. 하위 걸음 수도 모델 창에서 뽑는다 ════════════════════════════
{
  const { 하위걸음수, 걸음수, 요약길이 } = await import('../src/agent/budget.js');
  check('하위는 부모보다 적게 돈다', 하위걸음수('code', 131072) < 걸음수('code', 131072),
    `${하위걸음수('code', 131072)} < ${걸음수('code', 131072)}`);
  check('작은 모델에서도 8걸음은 준다', 하위걸음수('ask', 8192) >= 8, String(하위걸음수('ask', 8192)));
  check('요약 길이가 창을 따라간다', 요약길이(8192) < 요약길이(655360),
    `8k: ${요약길이(8192)}자 · 655k: ${요약길이(655360)}자`);
  check('8k 요약은 창의 5% 를 안 넘는다', 요약길이(8192) <= 8192 * 0.05 + 1, `${요약길이(8192)}자`);
}

// ── 결과 ───────────────────────────────────────────────────────────────
const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n하위 작업 검사  ' + D + '(큰 일을 떼어 따로 돌리고 요약만 돌려주는가)' + X + '\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  통과 ${pass.length} · 실패 ${fail.length}\n`);

server.closeAllConnections?.();
server.close();
await new Promise((r) => setImmediate(r));
process.exitCode = fail.length ? 1 : 0;
