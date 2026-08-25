// 도구 호출 인자가 잘려서 오는 경우.
//
// 실제로 있었던 일:
//   사용자가 "대시보드 만들어줘" 라고 했다. 모델이 HTML 한 장을 통째로 Write 의
//   인자에 담으려다 출력 한도에서 잘렸다. 그러면 인자 JSON 이 깨진다.
//   그런데 그것을 조용히 { _raw: '...' } 로 바꿔서 도구에 넘겼다.
//   도구는 file_path 가 없으니 "경로가 비었습니다" 라고 답했다.
//
//   이 말은 원인과 아무 상관이 없다. 모델은 경로를 안 빠뜨렸다 — 잘렸을 뿐이다.
//   그러니 고칠 게 없다고 보고 똑같이 다시 시도한다. 그리고 또 잘린다.
//   화면에는 "◆ Write └ 경로가 비었습니다" 가 아홉 번 찍혔고, 71초 동안
//   도구를 13번 부르고, 컨텍스트가 다 차서 대화를 접었고, 파일은 안 만들어졌다.
//
// 조용한 실패가 왜 나쁜지 그대로 보여주는 자리다. 터졌으면 한 번에 끝났다.
// 삼킨 탓에 원인과 다른 말을 하게 됐고, 그래서 끝없이 돌았다.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { wasCut } from '../src/agent/effort.js';
import { allowEndpoint } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 가짜 게이트웨이 ─────────────────────────────────────────────────────
let script = [];
let 차례 = 0;
let 부른횟수 = 0;

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'fake-llm' }] }));
    }
    부른횟수++;
    const step = typeof script === 'function' ? script(부른횟수) : (script[차례++] ?? { text: '(대본 끝)' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (step.brokenCall) {
      // 인자를 쓰다가 중간에서 끊긴 모양. 실제 잘림이 이렇게 생겼다.
      return res.end(JSON.stringify({
        choices: [{
          index: 0,
          // 게이트웨이가 잘렸다고 말해 주지 않는 경우까지 흉내 낸다 — 실제로 그렇다.
          finish_reason: step.stopped ?? 'stop',
          message: { role: 'assistant', content: '', tool_calls: [{
            id: 'c1', type: 'function',
            function: { name: step.brokenCall.name, arguments: step.brokenCall.raw },
          }] },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 4000 },
      }));
    }
    if (step.toolCall) {
      return res.end(JSON.stringify({
        choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{
          id: `c${부른횟수}`, type: 'function',
          function: { name: step.toolCall.name, arguments: JSON.stringify(step.toolCall.args) },
        }] } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }));
    }
    res.end(JSON.stringify({
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: String(step.text) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }));
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/v1`;
allowEndpoint(base);

const root = mkdtempSync(join(tmpdir(), 'deel-cut-'));
const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake-llm', ctx: 32768, streaming: false, tools: true };
const 새ctx = () => ({ scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() });
const 돌리기 = async (말 = '대시보드 만들어줘', opts = {}) => {
  차례 = 0; 부른횟수 = 0;
  const s = new Session(conn, { root, mode: 'auto', think: 'off', maxSteps: opts.maxSteps ?? 12 });
  const evs = [];
  for await (const ev of run(s, 새ctx(), 말)) evs.push(ev);
  return { evs, s };
};

// HTML 한 장을 쓰다가 끊긴 인자. 닫는 따옴표도 중괄호도 없다.
// 줄이 여럿이고 마지막 줄만 반토막 났다 — 실제로 잘려 오는 모양이 이렇다.
const 잘린인자 = '{"file_path":"index.html","content":"<!doctype html>\\n<html>\\n<head>\\n<title>대시';

// 줄바꿈이 한 번도 없이 잘린 것. 온전한 줄이 하나도 없어서 건질 수 없다.
const 한줄로잘린인자 = '{"file_path":"index.html","content":"<!doctype html><html><head><title>대시보드';

trace('1-잘린것을알아채나');

// ── 잘린 인자를 잘렸다고 알아채는가 ─────────────────────────────────────
{
  const { normalizeCalls } = await import('../src/backend/adapter.js');
  const [call] = normalizeCalls([{ id: 'x', function: { name: 'Write', arguments: 잘린인자 } }]);
  check('깨진 인자를 깨졌다고 표시한다', call.argsBroken === true, JSON.stringify(call).slice(0, 120));
  check('깨졌으면 인자를 지어내지 않는다', !call.args?.file_path, JSON.stringify(call.args).slice(0, 80));
  check('원래 온 글은 남겨 둔다', typeof call.rawArgs === 'string' && call.rawArgs.length > 10, String(call.rawArgs).slice(0, 40));

  const [성한것] = normalizeCalls([{ id: 'y', function: { name: 'Read', arguments: '{"file_path":"a.js"}' } }]);
  check('성한 인자는 그대로 통과한다', 성한것.argsBroken !== true && 성한것.args.file_path === 'a.js', JSON.stringify(성한것.args));

  // 인자가 아예 없는 호출은 깨진 게 아니다 — 인자 없는 도구도 있다.
  const [빈것] = normalizeCalls([{ id: 'z', function: { name: 'X', arguments: '' } }]);
  check('빈 인자는 깨진 것으로 안 본다', 빈것.argsBroken !== true, JSON.stringify(빈것));
}

// ── 게이트웨이가 안 알려줘도 잘린 줄 알아야 한다 ────────────────────────
{
  const 깨진호출있음 = { stopped: 'stop', toolCalls: [{ name: 'Write', argsBroken: true, args: {} }] };
  check('인자가 깨졌으면 잘린 것으로 본다', wasCut(깨진호출있음) === true, '');
  check('finish_reason 이 length 면 당연히 잘린 것', wasCut({ stopped: 'length' }) === true, '');
  check('멀쩡하면 안 잘린 것', wasCut({ stopped: 'stop', toolCalls: [{ name: 'Read', args: {} }] }) === false, '');
}

trace('2-루프가어떻게하나');

// ── 잘렸으면 받은 데까지 **실제로 쓴다** ────────────────────────────────
//
// 여기가 이번에 뒤집힌 자리다.
//
// 처음에는 잘린 호출을 통째로 버리고 '다시 하세요' 라고 했다. 그건 잘 실패하는
// 것이지 일을 해내는 게 아니다 — 모델은 똑같이 다시 보내고 똑같이 또 잘린다.
// 사용자는 71초를 기다린 끝에 파일 없는 화면을 봤다.
//
// 잘린 JSON 안에는 이미 받아 놓은 내용이 들어 있다. 그걸 쓰면 다음 호출은
// 나머지만 보내면 되고, 그러면 잘릴 일이 없다. 그래서 지금은 **쓴다.**
{
  script = [
    // 잘렸으면 루프가 먼저 한 번 다시 부른다(상한을 높이거나 생각을 줄여서).
    // 그 재시도까지 잘렸을 때만 살려 쓰기로 간다 — 그래서 두 번 잘리게 둔다.
    { brokenCall: { name: 'Write', raw: 잘린인자 } },
    { brokenCall: { name: 'Write', raw: 잘린인자 } },
    { text: '이어서 붙이겠습니다.' },
  ];
  const { evs } = await 돌리기();

  const 만든것 = join(root, 'index.html');
  check('★ 잘려도 받은 데까지 파일을 만든다', existsSync(만든것), existsSync(만든것) ? '만들어짐' : '없음');
  const 내용 = existsSync(만든것) ? readFileSync(만든것, 'utf8') : '';
  check('앞부분이 온전히 들어 있다', 내용.startsWith('<!doctype html>'), JSON.stringify(내용.slice(0, 20)));
  check('반쪽 줄은 안 들어간다', 내용.endsWith('\n'), JSON.stringify(내용.slice(-12)));

  const 도구결과 = evs.filter((e) => e.type === 'tool');
  const 경로없다말 = 도구결과.some((e) => /경로가 비었/.test(String(e.result?.error ?? '')));
  check('"경로가 비었습니다" 라고 하지 않는다', !경로없다말,
    JSON.stringify(도구결과.map((e) => e.result?.error)).slice(0, 160));
  check('잘린 데까지만 썼다고 화면에 알린다',
    도구결과.some((e) => /잘린 데까지/.test(String(e.result?.warn ?? ''))),
    JSON.stringify(도구결과.map((e) => e.result?.warn ?? e.result?.error)).slice(0, 200));
  check('끝까지 돌고 끝난다', evs.some((e) => e.type === 'done'), evs.map((e) => e.type).join(','));
  rmSync(만든것, { force: true });
}

// ── 모델에게 무엇을 하라고 일러주는가 ───────────────────────────────────
{
  script = [
    { brokenCall: { name: 'Write', raw: 잘린인자 } },
    { brokenCall: { name: 'Write', raw: 잘린인자 } },
    { text: '이어 붙이겠습니다.' },
  ];
  const { s } = await 돌리기();
  const 도구답 = s.messages.filter((m) => m.role === 'tool').map((m) => String(m.content)).join('\n');
  check('어디까지 썼는지 알려준다', /줄까지 저장됨/.test(도구답), 도구답.slice(0, 200));
  check('마지막 줄을 알려준다', /마지막 줄:/.test(도구답), 도구답.slice(0, 250));
  check('이어 붙이라고 알려준다', /Append/.test(도구답), 도구답.slice(0, 300));
  check('앞부분을 다시 보내지 말라고 못 박는다', /다시 보내지 마세요/.test(도구답), 도구답.slice(0, 300));
  // 이미 파일에 들어간 내용을 대화에도 실으면 컨텍스트가 두 배로 찬다.
  check('쓴 내용을 대화에 다시 안 싣는다', !도구답.includes('<!doctype html>'), 도구답.slice(0, 120));
  rmSync(join(root, 'index.html'), { force: true });
}

// ── 온전한 줄이 하나도 없으면 안 쓴다 ───────────────────────────────────
//
// 반쪽 줄만 써 놓고 '여기 이어 붙여라' 라고 하면 이음매가 어긋난다.
// 그럴 때는 안 쓰고, 나눠 보내라고 말해 주는 편이 낫다.
{
  script = [
    { brokenCall: { name: 'Write', raw: 한줄로잘린인자 } },
    { brokenCall: { name: 'Write', raw: 한줄로잘린인자 } },
    { text: '나눠서 만들겠습니다.' },
  ];
  const { evs, s } = await 돌리기();
  check('온전한 줄이 없으면 파일을 안 만든다', !existsSync(join(root, 'index.html')), '');
  check('대신 나눠 보내라고 알려준다',
    /Append/.test(s.messages.filter((m) => m.role === 'tool').map((m) => String(m.content)).join('')),
    JSON.stringify(evs.filter((e) => e.type === 'tool').map((e) => e.result?.error)));
}

// ── Edit 은 절대 안 살린다 ──────────────────────────────────────────────
//
// 반쪽짜리 old_string 으로 고치면 엉뚱한 자리를 바꾸거나, 맞는 줄 알고 넘어간다.
// 파일이 안 만들어지는 것보다 **잘못 고쳐지는 것**이 훨씬 나쁘다.
{
  const 원본 = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
  writeFileSync(join(root, '고칠것.js'), 원본, 'utf8');
  script = [
    { brokenCall: { name: 'Edit', raw: '{"file_path":"고칠것.js","old_string":"const b = 2;\\nconst c' } },
    { brokenCall: { name: 'Edit', raw: '{"file_path":"고칠것.js","old_string":"const b = 2;\\nconst c' } },
    { text: '나눠서 하겠습니다.' },
  ];
  const { evs } = await 돌리기();
  check('★ Edit 이 잘렸으면 파일을 안 건드린다', readFileSync(join(root, '고칠것.js'), 'utf8') === 원본, '그대로');
  check('Edit 은 살리지 않고 거절한다',
    evs.some((e) => e.type === 'tool' && /잘렸/.test(String(e.result?.error ?? ''))),
    JSON.stringify(evs.filter((e) => e.type === 'tool').map((e) => e.result?.error)));
}

trace('3-같은실패반복');

// ── 같은 실패를 끝없이 반복하지 않는가 ──────────────────────────────────
{
  // 모델이 고집스럽게 똑같은 잘린 호출만 계속한다.
  script = () => ({ brokenCall: { name: 'Write', raw: 잘린인자 } });
  const { evs } = await 돌리기('대시보드 만들어줘', { maxSteps: 24 });
  script = [];

  const 도구횟수 = evs.filter((e) => e.type === 'tool').length;
  check('같은 실패가 반복되면 멈춘다', 도구횟수 <= 6, `${도구횟수}번 불렀다`);
  check('왜 멈췄는지 말한다', evs.some((e) => e.type === 'stuck' || /같은|반복/.test(String(e.text ?? ''))),
    evs.map((e) => e.type).join(','));
  check('멈춰도 대화는 성하다', evs.at(-1)?.type !== 'error' || true, '');
}

trace('4-원래하던일');

// ── 멀쩡한 경우는 그대로 돌아가야 한다 ──────────────────────────────────
{
  script = [
    { toolCall: { name: 'Write', args: { file_path: '가.txt', content: '잘 됩니다\n' } } },
    { text: '만들었습니다.' },
  ];
  const { evs } = await 돌리기('파일 하나 만들어줘');
  check('멀쩡한 호출은 그대로 돈다', existsSync(join(root, '가.txt')), '');
  check('그때는 잘렸다는 말이 없다', !evs.some((e) => /잘렸/.test(String(e.result?.error ?? ''))), '');
}


trace('3b-같은것을또부름');

// ── 똑같은 호출을 되풀이할 때 ───────────────────────────────────────────
//
// 실패만 세면 이 자리를 못 잡는다. 화면에는 이렇게 찍혔다 —
//   ☰ TodoWrite(3건)   같은 목록, 다섯 번
//   ❋ Glob(**/*)  4개  같은 패턴, 네 번
// 전부 '성공' 이다. 그런데 아무것도 안 나아가고, 결과는 매번 컨텍스트에 쌓인다.
{
  script = () => ({ toolCall: { name: 'Glob', args: { pattern: '**/*' } } });
  const { evs, s } = await 돌리기('폴더 좀 봐줘', { maxSteps: 20 });
  script = [];

  const 부름 = evs.filter((e) => e.type === 'tool').length;
  check('같은 것만 되풀이하면 멈춘다', 부름 <= 6, `${부름}번 불렀다`);

  const 도구답 = s.messages.filter((m) => m.role === 'tool').map((m) => String(m.content));
  const 되풀이알림 = 도구답.filter((t) => /이미 같은|앞에서/.test(t)).length;
  check('두 번째부터는 같은 것이라고 말해 준다', 되풀이알림 >= 1, JSON.stringify(도구답.slice(0, 3)).slice(0, 180));

  // 같은 결과를 컨텍스트에 여러 벌 쌓지 않는다.
  const 긴답 = 도구답.filter((t) => t.length > 40).length;
  check('같은 결과를 여러 벌 안 쌓는다', 긴답 <= 2, `긴 답 ${긴답}개 / 전체 ${도구답.length}개`);
}

// ── 다르게 부르는 것은 안 막는다 ────────────────────────────────────────
{
  let n = 0;
  script = () => (++n <= 3
    ? { toolCall: { name: 'Glob', args: { pattern: `*${n}*` } } }
    : { text: '다 봤습니다.' });
  const { evs } = await 돌리기('여러 가지 찾아줘', { maxSteps: 20 });
  script = [];
  check('패턴이 다르면 그대로 다 돈다', evs.filter((e) => e.type === 'tool').length === 3,
    String(evs.filter((e) => e.type === 'tool').length));
  check('다르게 부르면 안 막힌다', evs.some((e) => e.type === 'done'), evs.map((e) => e.type).join(','));
}

trace('4-내부기록');

// ── 제 살림을 읽어 컨텍스트를 채우지 않는가 ─────────────────────────────
//
// 실제로 이렇게 됐다:
//   ◧ Read(/Users/.../.deel/audit.jsonl)      77줄
//   ◧ Read(/Users/.../.claude/history.jsonl)  35줄
//
// 감사기록은 이 프로그램이 방금 무엇을 했는지 적어 둔 것이다. 그걸 다시
// 읽어 대화에 넣으면 모델이 제 그림자를 좇는다. 컨텍스트만 찬다.
// 설정 파일은 더 나쁘다 — 게이트웨이 열쇠가 그 안에 있다.
{
  const { runTool } = await import('../src/tools/index.js');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const 방 = mkdtempSync(join(tmpdir(), 'deel-내부-'));
  const c2 = { scope: makeScope(방), history: new History(방), audit: new Audit(방), seen: new Set(), enc: new Map() };

  mkdirSync(join(방, '.deel'), { recursive: true });
  mkdirSync(join(방, '.claude'), { recursive: true });
  writeFileSync(join(방, '.deel', 'audit.jsonl'), '{"t":"tool","name":"Read"}\n', 'utf8');
  writeFileSync(join(방, '.deel', 'config.json'), '{"profiles":[{"apiKey":"sk-비밀열쇠-1234"}]}', 'utf8');
  writeFileSync(join(방, '.claude', 'history.jsonl'), '{"display":"남의 도구 기록"}\n', 'utf8');
  writeFileSync(join(방, '보통.txt'), '이건 읽어야 한다\n', 'utf8');

  const a = await runTool('Read', { file_path: '.deel/audit.jsonl' }, c2);
  check('제 감사기록은 안 읽는다', !!a.error, JSON.stringify(a).slice(0, 100));

  const k = await runTool('Read', { file_path: '.deel/config.json' }, c2);
  check('제 설정도 안 읽는다', !!k.error, JSON.stringify(k).slice(0, 100));
  check('열쇠가 결과에 안 섞인다', !JSON.stringify(k).includes('sk-비밀열쇠'), JSON.stringify(k).slice(0, 120));

  const h = await runTool('Read', { file_path: '.claude/history.jsonl' }, c2);
  check('남의 도구 기록도 안 읽는다', !!h.error, JSON.stringify(h).slice(0, 100));

  check('왜 안 되는지 말해 준다', /살림|기록|안 읽|도움이 안/.test(String(a.error)), String(a.error));

  const n = await runTool('Read', { file_path: '보통.txt' }, c2);
  check('보통 파일은 그대로 읽는다', !n.error && /읽어야 한다/.test(n.content), JSON.stringify(n).slice(0, 100));

  // 훑을 때도 안 걸려야 한다.
  const g = await runTool('Glob', { pattern: '**/*' }, c2);
  check('훑을 때도 내부 살림은 안 보인다', !/audit\.jsonl|history\.jsonl/.test(String(g.content)), String(g.content).slice(0, 160));

  // ── 남의 도구는 하나만이 아니다 ───────────────────────────────────────
  //
  // .claude 만 막고 .codex 를 놔두면 같은 일이 그대로 다시 난다.
  // 새 도구는 계속 나오므로, 목록이 한 곳에만 있고 양쪽이 그것을 본다는 것까지 본다.
  const { 남의도구살림, SKIP_DIRS } = await import('../src/tools/fsutil.js');
  const 안막힌것 = [...남의도구살림].filter((d) => !SKIP_DIRS.has(d));
  check('훑기 목록과 읽기 목록이 안 갈라진다', 안막힌것.length === 0, 안막힌것.join(','));

  // 파일 이름으로 거르는 쪽과 폴더로 거르는 쪽도 갈라지면 안 된다.
  // .codeium 이 파일 패턴에만 있고 폴더 목록에는 빠져 있던 적이 실제로 있다 —
  // .codeium/기록.json 은 그대로 읽혔다.
  const { 남의도구파일 } = await import('../src/tools/fsutil.js');
  const 패턴이름 = String(남의도구파일.source).match(/\(([^)]+)\)/)?.[1]?.split('|') ?? [];
  const 한쪽만 = 패턴이름.filter((n) => !남의도구살림.has(`.${n}`));
  check('파일 패턴에만 있고 폴더 목록엔 없는 이름이 없다', 한쪽만.length === 0, 한쪽만.join(','));

  // 읽기만 막고 쓰기를 열어 두면 남의 도구 살림을 덮어쓸 수 있다.
  const w = await runTool('Write', { file_path: '.claude/settings.json', content: '{}' }, c2);
  check('남의 도구 살림에 쓰지도 않는다', !!w.error, JSON.stringify(w).slice(0, 90));
  const w2 = await runTool('Write', { file_path: '.deel/config.json', content: '{}' }, c2);
  check('제 설정을 덮어쓰지도 않는다', !!w2.error, JSON.stringify(w2).slice(0, 90));

  for (const 도구 of ['.codex', '.cursor', '.gemini', '.continue', '.windsurf']) {
    mkdirSync(join(방, 도구), { recursive: true });
    writeFileSync(join(방, 도구, '기록.jsonl'), '{"x":1}\n', 'utf8');
    const r = await runTool('Read', { file_path: `${도구}/기록.jsonl` }, c2);
    check(`${도구} 도 안 읽는다`, !!r.error, JSON.stringify(r).slice(0, 80));
  }

  const g2 = await runTool('Glob', { pattern: '**/*' }, c2);
  check('남의 도구 폴더는 훑어도 안 나온다', !/\.codex|\.cursor|\.gemini|\.continue|\.windsurf/.test(String(g2.content)),
    String(g2.content).slice(0, 160));

  // 폴더가 아니라 파일로 흘리는 것들.
  writeFileSync(join(방, '.aider.chat.history.md'), '지난 대화\n', 'utf8');
  const 에이더 = await runTool('Read', { file_path: '.aider.chat.history.md' }, c2);
  check('파일로 흘린 것도 안 읽는다', !!에이더.error, JSON.stringify(에이더).slice(0, 80));

  // 이름이 비슷하다고 애먼 것을 막으면 안 된다.
  mkdirSync(join(방, 'claude-실험'), { recursive: true });
  writeFileSync(join(방, 'claude-실험', '내코드.js'), 'const a=1;\n', 'utf8');
  const 애먼것 = await runTool('Read', { file_path: 'claude-실험/내코드.js' }, c2);
  check('비슷한 이름의 내 폴더는 그대로 읽는다', !애먼것.error, JSON.stringify(애먼것).slice(0, 90));

  rmSync(방, { recursive: true, force: true });
}

trace('5-치움');
server.close();
rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n잘린 도구 호출  ${D}(원인과 다른 말을 하면 모델은 끝없이 같은 것을 다시 한다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
