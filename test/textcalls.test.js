/**
 * 글 속 도구 부름 · 모양이 조금 틀린 JSON (2.1.3 · backend/textcalls.js · backend/loosejson.js).
 *
 * ── 왜 이 파일이 있나 ──────────────────────────────────────────────────
 *
 * 작은 모델은 도구를 **글로** 부르는 일이 잦다 — 서버가 그 모델의 부름 꼴을 몰라 `tool_calls` 가
 * 비어 오고, 답 글에 `<tool_call>{…}</tool_call>` 이 실린다. 여태 deel 은 그것을 「말로만 답했다」 로
 * 읽고 턴을 끝냈다. 인자 JSON 이 홑따옴표 · 끝 쉼표 같은 **모양만** 틀려도 깨진 부름으로 돌려보냈다.
 *
 * 여기서는 건질 것은 건지고, **건지면 안 되는 것**(예시 · 모르는 이름 · 설명 글 속 JSON)은 안
 * 건지는지를 잰다. 건진 부름은 승인 관문을 그대로 지나므로, 잘못 건지는 쪽이 더 비싸다.
 */
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/agent/loop.js';
import { Session } from '../src/agent/session.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const { 느슨한JSON, 읽어보기 } = await import('../src/backend/loosejson.js');
const { 글속부름 } = await import('../src/backend/textcalls.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 던지나 = (f) => { try { f(); return false; } catch { return true; } };
const 도구 = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'mcp__git__status'];
const 모양 = (r) => JSON.stringify(r?.부름 ?? r);

// ── 1. 느슨한 JSON ─────────────────────────────────────────────────────
trace('1-느슨한JSON');
{
  const v = 느슨한JSON("{file_path: 'a.js', content: 'x\ny', flag: True, n: None, off: False, list: [1, 2,],}");
  check('★★ 홑따옴표 · 따옴표 없는 열쇠 · 끝 쉼표 · 글 속 날 줄바꿈 · True/False/None', v.file_path === 'a.js' && v.content === 'x\ny'
    && v.flag === true && v.n === null && v.off === false && JSON.stringify(v.list) === '[1,2]', JSON.stringify(v));
  const 주석 = 느슨한JSON('{\n  // 읽을 파일\n  "file_path": "a.js", /* 끝 */\n}');
  check('★ // · /* */ 설명을 건너뛴다', 주석.file_path === 'a.js', JSON.stringify(주석));
  check('★ 모르는 되받이(\\d)는 글자 그대로 둔다 — 정규식을 옮겨 적은 것', 느슨한JSON('{"p": "\\d+"}').p === '\\d+', 느슨한JSON('{"p": "\\d+"}').p);
  check('  \\u 되받이는 읽는다', 느슨한JSON("{'a': '\\u00e9'}").a === 'é');
  check('  수 · 음수 · 지수', JSON.stringify(느슨한JSON('[1, -2.5, 3e2, .5]')) === '[1,-2.5,300,0.5]');
  check('★★★ 잘린 앞토막은 못 읽는다 — 반쪽 내용이 온전한 척 도구로 가면 안 된다', 던지나(() => 느슨한JSON('{"content": "abc')) && 던지나(() => 느슨한JSON('{"a": [1, 2')));
  check('★★ 안 닫힌 글 하나도 못 읽는다', 던지나(() => 느슨한JSON("'반쪽")) && 던지나(() => 느슨한JSON('"반쪽')));
  check('★★ 뒤에 남은 것이 있으면 못 읽는다', 던지나(() => 느슨한JSON('{"a": 1} 그리고')));
  check('  맨 낱말 값은 못 읽는다 (따옴표 없는 글)', 던지나(() => 느슨한JSON('{a: b.js}')));
  check('★ 읽어보기: 맞는 JSON 은 곧이곧대로', JSON.stringify(읽어보기('{"a":"b"}')) === '{"a":"b"}');
  check('★ 읽어보기: 못 읽으면 undefined', 읽어보기('{"a": ') === undefined && 읽어보기('그냥 글') === undefined);
}

// ── 2. 표가 붙은 꼴 ────────────────────────────────────────────────────
trace('2-표');
{
  const r = 글속부름('파일을 읽겠습니다.\n<tool_call>\n{"name": "Read", "arguments": {"file_path": "a.js"}}\n</tool_call>', 도구);
  check('★★★ Hermes · Qwen 의 <tool_call> 을 부름으로 건진다', r?.부름?.length === 1 && r.부름[0].name === 'Read' && r.부름[0].args.file_path === 'a.js', 모양(r));
  check('★★ 건진 자리는 글에서 뗀다 — 앞말만 남는다', r?.남은글 === '파일을 읽겠습니다.', JSON.stringify(r?.남은글));
  const 작은 = 글속부름('<tool_call>{"name": "read", "arguments": {"file_path": "a.js"}}</tool_call>', 도구);
  check('★ 이름은 대소문자를 안 가리고 우리 이름으로 돌려준다 (read → Read)', 작은?.부름?.[0]?.name === 'Read', 모양(작은));
  const 둘 = 글속부름('<tool_call>{"name":"Read","arguments":{"file_path":"a.js"}}</tool_call>\n<tool_call>{"name":"Grep","arguments":{"pattern":"x"}}</tool_call>', 도구);
  check('★★ 여럿이면 적힌 차례대로 다 건진다', 둘?.부름?.map((x) => x.name).join() === 'Read,Grep', 모양(둘));
  const 큐웬 = 글속부름('<tool_call>\n<function=Write>\n<parameter=file_path>\nout.txt\n</parameter>\n<parameter=content>\n첫줄\n둘째줄\n</parameter>\n</function>\n</tool_call>', 도구);
  check('★★ Qwen3-Coder 의 <function=…><parameter=…> 꼴', 큐웬?.부름?.[0]?.name === 'Write' && 큐웬.부름[0].args.file_path === 'out.txt'
    && 큐웬.부름[0].args.content === '첫줄\n둘째줄', 모양(큐웬));
  const 수칸 = 글속부름('<tool_call><function=Read><parameter=file_path>a.js</parameter><parameter=offset>10</parameter></function></tool_call>', 도구);
  check('  칸 값이 수면 수로 읽는다', 수칸?.부름?.[0]?.args?.offset === 10, 모양(수칸));
  const 안닫힘 = 글속부름('<tool_call>{"name": "Bash", "arguments": {"command": "ls"}}', 도구);
  check('★ 끝 표 없이 글이 끝나도 받는다 — 서버가 멈춤 낱말로 끝 표를 떼는 일이 있다', 안닫힘?.부름?.[0]?.args?.command === 'ls', 모양(안닫힘));
  const 라마 = 글속부름('<function=Bash>{"command": "npm test"}</function>', 도구);
  check('★ Llama 3.1 의 <function=이름>{…}</function>', 라마?.부름?.[0]?.name === 'Bash' && 라마.부름[0].args.command === 'npm test', 모양(라마));
  const 미스트랄 = 글속부름('[TOOL_CALLS] [{"name": "Read", "arguments": {"file_path": "a.js"}}]', 도구);
  check('★ Mistral 의 [TOOL_CALLS] [...]', 미스트랄?.부름?.[0]?.name === 'Read', 모양(미스트랄));
  const 싼것 = 글속부름('<tool_call>{"type": "function", "function": {"name": "Read", "arguments": "{\\"file_path\\": \\"a.js\\"}"}}</tool_call>', 도구);
  check('  function 으로 한 겹 싸고 인자를 글로 적은 꼴', 싼것?.부름?.[0]?.args?.file_path === 'a.js', 모양(싼것));
  const 틀린인자 = 글속부름("<tool_call>{'name': 'Read', 'arguments': {'file_path': 'a.js',}}</tool_call>", 도구);
  check('★ 표 속 JSON 모양이 조금 틀려도 읽는다', 틀린인자?.부름?.[0]?.args?.file_path === 'a.js', 모양(틀린인자));
  const mcp = 글속부름('<tool_call>{"name": "mcp__git__status", "arguments": {}}</tool_call>', 도구);
  check('  MCP 도구 이름도 내준 것이면 건진다', mcp?.부름?.[0]?.name === 'mcp__git__status', 모양(mcp));
}

// ── 3. 건지면 안 되는 것 ───────────────────────────────────────────────
trace('3-안건짐');
{
  check('★★★ 내준 적 없는 이름은 안 건진다', 글속부름('<tool_call>{"name": "search", "arguments": {"q": "x"}}</tool_call>', 도구) === null);
  const 섞임 = 글속부름('<tool_call>[{"name": "Read", "arguments": {"file_path": "a"}}, {"name": "rm_all", "arguments": {}}]</tool_call>', 도구);
  check('★★ 한 덩이에 모르는 이름이 섞이면 그 덩이는 통째로 안 건진다', 섞임 === null, 모양(섞임));
  check('★★ 그냥 글은 안 건진다', 글속부름('다 고쳤습니다. 테스트도 통과합니다.', 도구) === null);
  check('  도구를 안 내준 걸음이면 안 건진다', 글속부름('<tool_call>{"name": "Read", "arguments": {}}</tool_call>', []) === null);
  const 예시 = '이 형식은 이렇게 생겼습니다.\n\n```\n<tool_call>{"name": "Bash", "arguments": {"command": "rm -rf build"}}</tool_call>\n```\n\n이렇게 적으면 됩니다.';
  check('★★★ 울타리(```) 안에 든 표는 예시다 — 안 건진다 (auto 는 Bash 를 안 묻는다)', 글속부름(예시, 도구) === null, 모양(글속부름(예시, 도구)));
  const 예시둘 = '읽기는 이렇게:\n```json\n{"name": "Read", "arguments": {"file_path": "a.js"}}\n```\n쓰기는 이렇게:\n```json\n{"name": "Write", "arguments": {"file_path": "b.js", "content": ""}}\n```';
  check('★★ 울타리가 둘 이상이면 예시를 늘어놓은 글이다', 글속부름(예시둘, 도구) === null, 모양(글속부름(예시둘, 도구)));
  const 긴설명 = `${'설명이 깁니다. '.repeat(30)}\n\`\`\`json\n{"name": "Read", "arguments": {"file_path": "a.js"}}\n\`\`\``;
  check('★★ 울타리 곁 글이 길면 설명 속 예시다', 글속부름(긴설명, 도구) === null);
  const 글속JSON = '설정은 {"name": "Read", "arguments": {}} 처럼 적습니다.';
  check('★ 글 가운데 박힌 JSON 은 안 건진다', 글속부름(글속JSON, 도구) === null);
  check('  이름 없는 JSON 은 안 건진다', 글속부름('{"file_path": "a.js"}', 도구) === null);
}

// ── 4. 울타리 · 맨 JSON — 답이 거의 그것뿐일 때 ─────────────────────────
trace('4-울타리');
{
  const 울 = 글속부름('읽어 보겠습니다.\n```json\n{"name": "Read", "arguments": {"file_path": "a.js"}}\n```', 도구);
  check('★★ 짧은 앞말 + 울타리 하나는 건진다', 울?.부름?.[0]?.name === 'Read' && 울.남은글 === '읽어 보겠습니다.', 모양(울));
  const 맨 = 글속부름('{"name": "Bash", "parameters": {"command": "ls"}}', 도구);
  check('★ 답 전체가 부름 JSON 이면 건진다 (Llama 의 parameters 칸)', 맨?.부름?.[0]?.args?.command === 'ls' && 맨.남은글 === '', 모양(맨));
  const 배열 = 글속부름('[{"name": "Read", "arguments": {"file_path": "a"}}, {"name": "Read", "arguments": {"file_path": "b"}}]', 도구);
  check('  부름 여럿의 배열', 배열?.부름?.length === 2, 모양(배열));
  const 큰울 = 글속부름('```JSON\n{"name": "Read", "arguments": {"file_path": "a.js"}}\n```', 도구);
  check('  울타리 이름이 대문자(```JSON)여도 건진다', 큰울?.부름?.[0]?.args?.file_path === 'a.js', 모양(큰울));
}

// ── 4b. 2차 눈(제미니)이 짚어 재 보니 참이던 것 ────────────────────────────
trace('4b-2차눈');
{
  const 안닫힌울 = '도구 호출 예시:\n```xml\n<tool_call>{"name": "Read", "arguments": {"file_path": "secret.txt"}}</tool_call>';
  check('★★★ 안 닫힌 울타리(길이 제한으로 잘린 답) 속 표도 예시다 — 안 건진다', 글속부름(안닫힌울, 도구) === null, 모양(글속부름(안닫힌울, 도구)));
  const 두함수 = 글속부름('<tool_call>\n<function=Read><parameter=file_path>a.js</parameter></function>\n<function=Read><parameter=file_path>b.js</parameter></function>\n</tool_call>', 도구);
  check('★★ <tool_call> 하나에 <function=…> 이 둘이면 둘 다 건진다 — 뒤 것 인자로 하나만 만들지 않는다',
    두함수?.부름?.map((x) => x.args.file_path).join() === 'a.js,b.js', 모양(두함수));
  const 말속표 = 글속부름('주의: <tool_call> 표는 이렇게 씁니다.\n<tool_call>{"name": "Read", "arguments": {"file_path": "a.js"}}</tool_call>', 도구);
  check('★★ 글 속에서 <tool_call> 을 말로 꺼내도 뒤따르는 진짜 부름은 건진다', 말속표?.부름?.[0]?.args?.file_path === 'a.js', 모양(말속표));
  const 영 = 글속부름('<tool_call><function=Read><parameter=file_path>a.js</parameter><parameter=code>01234</parameter><parameter=ver>1.50</parameter><parameter=n>-5</parameter></function></tool_call>', 도구);
  check('★★ 칸 값은 글자 그대로 되돌아오는 수만 수로 — 01234 · 1.50 은 글로 둔다',
    영?.부름?.[0]?.args?.code === '01234' && 영.부름[0].args.ver === '1.50' && 영.부름[0].args.n === -5, 모양(영));
  const 파이썬 = 글속부름('<tool_call><function=Read><parameter=file_path>a.js</parameter><parameter=force>True</parameter><parameter=x>None</parameter></function></tool_call>', 도구);
  check('  파이썬 꼴 True · None 칸도 참 · 없음으로', 파이썬?.부름?.[0]?.args?.force === true && 파이썬.부름[0].args.x === null, 모양(파이썬));
  const 뒷말 = 글속부름('[TOOL_CALLS] [{"name": "Read", "arguments": {"file_path": "a.js"}}] 파일을 확인해 주세요 [참고].', 도구);
  check('★ Mistral 부름 뒤에 말(괄호가 든)이 붙어도 건진다', 뒷말?.부름?.[0]?.args?.file_path === 'a.js' && 뒷말.남은글 === '파일을 확인해 주세요 [참고].', 모양(뒷말));
}

// ── 5. 루프를 지나서 — 건진 부름이 실제로 돌고, 다음 요청에 제 꼴로 실리나 ─────────
trace('5-루프');
const 서버들 = [];
/** 걸음마다 준비한 답을 차례로 돌려주는 가짜 게이트웨이. */
async function 띄우기(답들) {
  const 받은몸통 = [];
  const s = createServer((q, res) => {
    let body = '';
    q.on('data', (d) => (body += d));
    q.on('end', () => {
      받은몸통.push(body);
      const 답 = 답들[Math.min(받은몸통.length - 1, 답들.length - 1)];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: 답, finish_reason: 답.tool_calls ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      }));
    });
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  서버들.push(s);
  return { base: `http://127.0.0.1:${s.address().port}/v1`, 받은몸통 };
}
async function 돌리기(답들) {
  const { base, 받은몸통 } = await 띄우기(답들);
  resetNet(); allowEndpoint(base);
  const root = mkdtempSync(join(tmpdir(), 'deel-textcalls-'));
  writeFileSync(join(root, 'app.js'), 'const port = 7080;\n', 'utf8');
  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'fake', ctx: 16000 };
  const session = new Session(conn, { root, work: 'code' });
  const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set(), 모드: 'auto' };
  const 사건 = [];
  for await (const ev of run(session, ctx, 'app.js 를 읽어 줘', { 끼어들기: () => null })) 사건.push(ev);
  const 결과 = session.messages.filter((m) => m.role === 'tool').map((m) => String(m.content ?? '')).join('\n');
  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  return { 받은몸통, 사건, 결과, session };
}
const 끝 = { content: '끝냈습니다.' };
{
  const r = await 돌리기([{ content: '파일을 읽겠습니다.\n<tool_call>\n{"name": "Read", "arguments": {"file_path": "app.js"}}\n</tool_call>' }, 끝]);
  check('★★★ 글로 적은 부름에서 턴이 끝나지 않고 도구가 돈다', r.받은몸통.length === 2 && /7080/.test(r.결과),
    `요청 ${r.받은몸통.length}번 · ${r.결과.slice(0, 80)}`);
  const 둘째 = JSON.parse(r.받은몸통[1] ?? '{}').messages ?? [];
  const 답 = 둘째.find((m) => m.role === 'assistant');
  check('★★ 다음 요청에는 제 꼴의 도구 부름과 결과로 실린다 (글 속 표는 뗀다)', 답?.tool_calls?.[0]?.function?.name === 'Read'
    && 둘째.some((m) => m.role === 'tool' && m.tool_call_id === 답.tool_calls[0].id) && 답.content === '파일을 읽겠습니다.', JSON.stringify(답)?.slice(0, 200));
  check('★ 건졌다고 알린다 (화면이 한 줄 적는다)', r.사건.some((e) => e.type === 'textcalls' && e.names?.join() === 'Read'),
    JSON.stringify(r.사건.map((e) => e.type)));
}
{
  const 예시 = '형식은 이렇습니다.\n```\n<tool_call>{"name": "Read", "arguments": {"file_path": "app.js"}}</tool_call>\n```';
  const r = await 돌리기([{ content: 예시 }, 끝]);
  check('★★★ 울타리 속 예시는 부르지 않고 턴을 끝낸다', r.받은몸통.length === 1 && !r.결과, `요청 ${r.받은몸통.length}번`);
}
{
  const 틀린 = { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: "{'file_path': 'app.js',}" } }] };
  const r = await 돌리기([틀린, 끝]);
  check('★★ 모양만 틀린 인자(홑따옴표 · 끝 쉼표)는 읽어서 돌린다 — 되돌려 보내지 않는다', /7080/.test(r.결과), r.결과.slice(0, 120));
  const 잘린 = { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: '{"file_path": "app' } }] };
  const r2 = await 돌리기([잘린, 끝]);
  check('★★★ 잘린 인자는 여전히 안 돌린다', !/7080/.test(r2.결과), r2.결과.slice(0, 120));
}
for (const s of 서버들) s.close();

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n글 속 도구 부름  ${D}(작은 모델이 글로 부른 것을 건지고, 예시는 안 건진다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
