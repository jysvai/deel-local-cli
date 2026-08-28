// 루프가 '안 하는' 자리들.
//
// 에이전트에서 무서운 것은 못 하는 게 아니라 하지 말아야 할 것을 하는 것이다.
// 여기서는 그 반대쪽만 본다 — 물어보고 거부당했을 때, 모르는 도구를 부를 때,
// 같은 변경성 명령을 두 번 부를 때, 도중에 끊었을 때.
//
// 이 자리들의 공통점: 실패해도 대화가 이어져야 한다. 도구 결과 자리를 비우면
// 짝이 깨져서 다음 턴에 게이트웨이가 통째로 거절한다.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope, checkPaths } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 대본대로 답하는 가짜 게이트웨이 ─────────────────────────────────────
let 대본 = [];
let 차례 = 0;
const 받은몸통 = [];

const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: '가짜' }] }));
    }
    try { 받은몸통.push(JSON.parse(body || '{}')); } catch { 받은몸통.push(null); }
    const step = 대본[차례++] ?? { text: '(대본 끝)' };
    const msg = step.calls
      ? {
        role: 'assistant', content: null,
        tool_calls: step.calls.map((cl, i) => ({
          id: cl.id ?? `c${i + 1}`, type: 'function',
          function: { name: cl.name, arguments: JSON.stringify(cl.args ?? {}) },
        })),
      }
      : { role: 'assistant', content: String(step.text) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ index: 0, finish_reason: step.calls ? 'tool_calls' : 'stop', message: msg }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    }));
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const base = `http://127.0.0.1:${port}/v1`;
allowEndpoint(base);

const root = mkdtempSync(join(tmpdir(), 'deel-guard-'));
writeFileSync(join(root, '지킬것.txt'), '건드리면 안 되는 내용\n', 'utf8');

const conn = { kind: 'openai', base, auth: 'none', key: '', model: '가짜', ctx: 32768, streaming: false, tools: true };

function 새것(opts = {}) {
  차례 = 0;
  받은몸통.length = 0;
  const ctx = {
    scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set(),
    ...opts.ctx,
  };
  const session = new Session({ ...conn }, { root, think: 'off', ...opts.session });
  return { ctx, session };
}
async function 돌리기(session, ctx, 말, opts = {}) {
  const ev = [];
  for await (const e of run(session, ctx, 말, opts)) ev.push(e);
  return ev;
}
// 도구 결과 자리가 다 채워졌는지. 이게 깨지면 다음 턴이 통째로 거절된다.
function 짝이맞나(session) {
  const 부른것 = [];
  const 답한것 = new Set();
  for (const m of session.messages ?? []) {
    if (m.role === 'assistant' && m.tool_calls) for (const t of m.tool_calls) 부른것.push(t.id);
    if (m.role === 'tool' && m.tool_call_id) 답한것.add(m.tool_call_id);
  }
  return 부른것.length > 0 && 부른것.every((id) => 답한것.has(id));
}

trace('1-거부');

// ── 엄격 모드에서 사람이 거부하면 ───────────────────────────────────────
{
  let 물어본것 = null;
  const { ctx, session } = 새것({
    session: { mode: 'strict' },
    ctx: { confirm: async (name, args) => { 물어본것 = { name, args }; return false; } },
  });
  대본 = [
    { calls: [{ name: 'Write', args: { file_path: join(root, '새파일.txt'), content: '새로 쓴 것' } }] },
    { text: '거부하셔서 안 했습니다.' },
  ];
  const ev = await 돌리기(session, ctx, '파일 하나 만들어줘');

  check('엄격 모드는 쓰기 전에 물어본다', 물어본것?.name === 'Write', JSON.stringify(물어본것?.name));
  check('거부하면 파일을 안 만든다', !existsSync(join(root, '새파일.txt')), '');
  check('거부됨을 화면 사건으로 알린다', ev.some((e) => e.type === 'tool' && e.result?.error === '거부됨'),
    ev.filter((e) => e.type === 'tool').map((e) => e.result?.error).join(','));
  check('거부해도 대화는 이어진다', ev.some((e) => e.type === 'done'), ev.map((e) => e.type).join(','));
  check('거부해도 도구 결과 자리를 채운다', 짝이맞나(session), '자리를 비우면 다음 턴이 통째로 거절된다');
  check('거부 사실을 모델에게 알려 준다',
    (session.messages ?? []).some((m) => m.role === 'tool' && /거부/.test(String(m.content))), '');
}

{
  // 승낙하면 실제로 해야 한다. 반대쪽도 같이 봐야 의미가 있다.
  const { ctx, session } = 새것({
    session: { mode: 'strict' },
    ctx: { confirm: async () => true },
  });
  대본 = [
    { calls: [{ name: 'Write', args: { file_path: join(root, '만들것.txt'), content: '좋습니다' } }] },
    { text: '만들었습니다.' },
  ];
  await 돌리기(session, ctx, '파일 하나 만들어줘');
  check('승낙하면 실제로 만든다', existsSync(join(root, '만들것.txt')), '');
  rmSync(join(root, '만들것.txt'), { force: true });
}

{
  // 기본(auto) 모드는 안 묻는다. 되돌리기가 안전망이다.
  let 물었나 = false;
  const { ctx, session } = 새것({
    session: { mode: 'auto' },
    ctx: { confirm: async () => { 물었나 = true; return true; } },
  });
  대본 = [
    { calls: [{ name: 'Write', args: { file_path: join(root, '자동.txt'), content: 'ㅇ' } }] },
    { text: '했습니다.' },
  ];
  await 돌리기(session, ctx, '만들어줘');
  check('기본 모드는 쓰기를 안 묻는다', 물었나 === false, String(물었나));
  check('기본 모드에서는 그냥 만든다', existsSync(join(root, '자동.txt')), '');
  rmSync(join(root, '자동.txt'), { force: true });
}

trace('2-모르는도구');

{
  const { ctx, session } = 새것();
  대본 = [
    { calls: [{ name: '없는도구', args: { 아무거나: 1 } }] },
    { text: '그런 도구가 없다고 하네요.' },
  ];
  const ev = await 돌리기(session, ctx, '이상한 것 좀 해줘');
  check('모르는 도구는 안 돌린다', ev.some((e) => e.type === 'tool' && e.result?.error === '모르는 도구'),
    ev.filter((e) => e.type === 'tool').map((e) => e.result?.error).join(','));
  check('모르는 도구에도 대화가 안 끊긴다', ev.some((e) => e.type === 'done'), '');
  check('모르는 도구도 결과 자리를 채운다', 짝이맞나(session), '');
  check('쓸 수 있는 도구를 알려 준다',
    (session.messages ?? []).some((m) => m.role === 'tool' && /Read/.test(String(m.content))), '');
}

trace('3-두번실행');

// ── 같은 변경성 명령을 두 번 부르면 ─────────────────────────────────────
//
// 모델은 실패하면 똑같은 것을 또 부른다. 읽기라면 상관없지만 지우기·옮기기가
// 두 번 돌면 사고다. 그래서 변경성 명령은 한 번만 시도한다.
{
  const { ctx, session } = 새것();
  // cp 는 변경성 목록에 있는 명령이다 (guard.js 의 MUTATING).
  // mkdir 처럼 다시 돌려도 탈이 없는 것은 일부러 목록에 안 넣었다.
  const 명령 = `cp "${join(root, '지킬것.txt')}" "${join(root, '베낀것.txt')}"`;
  대본 = [
    { calls: [{ name: 'Bash', args: { command: 명령 } }] },
    { calls: [{ name: 'Bash', args: { command: 명령 } }] },   // 모델이 또 부른다
    { text: '두 번째는 막혔군요.' },
  ];
  const ev = await 돌리기(session, ctx, '파일 하나 베껴줘');
  const 밥 = ev.filter((e) => e.type === 'tool' && e.name === 'Bash');
  check('같은 변경성 명령을 두 번 안 돌린다',
    밥.length === 2 && /다시 실행하지 않습니다/.test(String(밥[1]?.result?.error ?? '')),
    밥.map((e) => e.result?.error ?? 'ok').join(' | '));
  check('막아도 대화는 이어진다', ev.some((e) => e.type === 'done'), '');
  check('막은 뒤에도 결과 자리를 채운다', 짝이맞나(session), '');
}

trace('4-도중에끊기');

{
  // 사용자가 Ctrl+C. 남은 도구는 실행하지 않되 자리는 채워야 한다.
  const ac = new AbortController();
  const { ctx, session } = 새것();
  대본 = [
    { calls: [
      { name: 'Read', args: { file_path: '지킬것.txt' } },
      { name: 'Write', args: { file_path: join(root, '끊긴뒤.txt'), content: '이건 쓰이면 안 된다' } },
    ] },
    { text: '중단됐습니다.' },
  ];
  ac.abort();   // 시작하자마자 끊는다
  let 터짐 = null;
  try { await 돌리기(session, ctx, '읽고 쓰고 해줘', { signal: ac.signal }); }
  catch (err) { 터짐 = err?.name ?? String(err); }
  check('끊어도 예외로 터지지 않는다', 터짐 === null || 터짐 === 'Aborted', String(터짐));
  check('끊긴 뒤 파일을 안 만든다', !existsSync(join(root, '끊긴뒤.txt')), '');
}

trace('5-작업범위');

{
  // 작업 폴더 바깥. 모델이 시켜도 못 나간다.
  const { ctx, session } = 새것();
  const 바깥 = join(tmpdir(), 'deel-guard-바깥.txt');
  rmSync(바깥, { force: true });
  대본 = [
    { calls: [{ name: 'Write', args: { file_path: 바깥, content: '나갔다' } }] },
    { text: '못 나가네요.' },
  ];
  const ev = await 돌리기(session, ctx, '바깥에 써줘');
  check('작업 폴더 바깥에는 못 쓴다', !existsSync(바깥), 바깥);
  check('왜 막혔는지 모델에게 알려 준다',
    (session.messages ?? []).some((m) => m.role === 'tool' && /범위|바깥|밖/.test(String(m.content))),
    (session.messages ?? []).filter((m) => m.role === 'tool').map((m) => String(m.content).slice(0, 40)).join(' | '));
  check('막혀도 대화는 이어진다', ev.some((e) => e.type === 'done'), '');
}

trace('5a-한글폴더-이름모양');

/*
 * ── 맥에서 제 폴더가 통째로 「범위 밖」이 되던 것 ────────────────────────
 *
 * 맥은 파일 이름을 **자모 분리형(NFD)** 으로 저장한다. `챗` 이 디스크에는
 * `ᄎ + ᅢ + ᆺ` 으로 들어가 있다. 반면 모델이 글로 쓰는 한글은 합쳐진
 * 모양(NFC)이다. 눈에는 같은데 문자열로는 다르다.
 *
 * 울타리가 이 둘을 글자로만 견줘서, 한글이 든 폴더에서 deel 을 켜면 **제
 * 작업 폴더 안의 파일이 전부 범위 밖으로 튕겼다.** 실제로 이런 화면이 나왔다:
 *
 *   ❉ Outline(**\/*.py)
 *     └ 작업 범위 밖입니다: /Users/me/.Trash/Archive 오후 3.05.41
 *
 * 뿌리 자신을 가리키는데도 밖이라고 한 것이다. 그러고는 같은 호출이 다음
 * 판에 그냥 됐다 — 어느 모양으로 오느냐에 따라 갈렸기 때문이다. 사람 눈에는
 * 「됐다 안 됐다 한다」 로만 보이고, 도구가 절반쯤 실패하니 모델은 결국
 * 아무것도 못 하고 되묻는다.
 *
 * 사내 폴더 이름은 한글이 흔하다. 여기가 깨지면 그 사람은 프로그램 전체를
 * 못 쓴다.
 */
{
  const 한글뿌리 = join(tmpdir(), 'deel-한글-검사 오후 3.05');
  const NFD = 한글뿌리.normalize('NFD');
  const NFC = 한글뿌리.normalize('NFC');
  check('두 모양이 문자열로는 다르다', NFC !== NFD, `${NFC.length}자 vs ${NFD.length}자`);

  // 맥이 준 뿌리(분리형) + 모델이 쓴 경로(합쳐진 모양) — 실제로 나던 짝이다.
  const s = makeScope(NFD);
  let 됐나 = true;
  let 왜 = '';
  try { s.resolve(`${NFC}/main.py`); } catch (e) { 됐나 = false; 왜 = e.message.split('\n')[0]; }
  check('모델이 합쳐진 모양으로 써도 범위 안이다', 됐나, 왜);

  // 반대 짝도 본다. 어느 쪽이 어느 모양으로 올지는 자리마다 다르다.
  const s2 = makeScope(NFC);
  let 됐나2 = true;
  try { s2.resolve(`${NFD}/main.py`); } catch { 됐나2 = false; }
  check('뿌리와 경로의 모양이 뒤바뀌어도 된다', 됐나2);

  // 보일 이름도 맞아야 한다. 안 맞추면 제 폴더 안의 파일이
  // `../../../Users/...` 처럼 보인다.
  check('보일 이름이 폴더 안 경로로 나온다',
    s.show(s.resolve(`${NFC}/src/main.py`)) === 'src/main.py',
    s.show(s.resolve(`${NFC}/src/main.py`)));

  /*
   * 느슨해진 것이 아니어야 한다. 모양만 맞춘 것이지 울타리를 연 것이 아니다.
   */
  for (const [무엇, 경로] of [['절대경로 바깥', join(tmpdir(), 'deel-밖-검사.txt')], ['.. 로 올라가기', '../../밖.py']]) {
    let 막혔나 = false;
    try { s.resolve(경로); } catch { 막혔나 = true; }
    check(`${무엇}은 여전히 막힌다`, 막혔나, 경로);
  }
}

trace('5b-Bash로우회');

// ── Bash 로 울타리를 넘어가지 못하는가 ──────────────────────────────────
//
// Read 는 .deel/config.json 을 막는다. 게이트웨이 열쇠가 그 안에 있어서다.
// 그런데 Bash 로는 `type .deel\config.json` 한 줄이면 그냥 읽혔다.
// 한쪽 문만 잠그면 잠근 뜻이 없다 — 읽힌 열쇠는 대화에 실려 게이트웨이로
// 나가고, 세션 기록으로 디스크에도 남는다.
{
  const { ctx } = 새것();
  const 막히나 = (cmd) => {
    try { checkPaths(cmd, ctx.scope); return null; }
    catch (e) { return e.message; }
  };

  check('Bash 로 제 설정 파일을 못 읽는다', /열쇠/.test(막히나('type .deel\\config.json') ?? ''), 막히나('type .deel\\config.json')?.split('\n')[0]);
  check('빗금 방향이 달라도 막힌다', 막히나('cat .deel/config.json') !== null, 막히나('cat .deel/config.json')?.split('\n')[0]);
  check('감사기록도 Bash 로 못 읽는다', 막히나('cat .deel/audit.jsonl') !== null, 막히나('cat .deel/audit.jsonl')?.split('\n')[0]);
  check('남의 도구 살림도 막힌다', /다른 코딩 도구/.test(막히나('cat .codex/history.jsonl') ?? ''), 막히나('cat .codex/history.jsonl')?.split('\n')[0]);
  check('작업 폴더 밖은 못 읽는다', /범위 밖/.test(막히나('cat ../../비밀.txt') ?? ''), 막히나('cat ../../비밀.txt')?.split('\n')[0]);
  check('절대경로로도 못 나간다', /범위 밖/.test(막히나(`cat ${join(tmpdir(), '남의것.txt')}`) ?? ''), '절대경로');
  check('~ 를 풀어서 본다', /범위 밖/.test(막히나('cat ~/.aws/credentials') ?? ''), 막히나('cat ~/.aws/credentials')?.split('\n')[0]);
  check('내보내는 자리도 본다', /범위 밖/.test(막히나('echo x > ../밖.txt') ?? ''), 막히나('echo x > ../밖.txt')?.split('\n')[0]);

  // 그런데 평범한 명령까지 막으면 도구가 쓸모없어진다. 이쪽이 더 흔하다.
  const 통과 = [
    'npm test',
    'node src/cli.js --help',
    'git log --oneline -5',
    "sed -n '1,5p' src/agent/loop.js",
    "grep -r 'TODO' src/",
    'node scripts/build.js dist/out.js',
    'curl https://example.com/a/b',
    'echo "결과" > out/report.txt',
    'npm run build -- --out ./dist',
  ];
  for (const c of 통과) check(`평범한 명령은 그대로 돈다: ${c}`, 막히나(c) === null, 막히나(c)?.split('\n')[0] ?? '');
}

trace('6-읽기전용모드');

{
  // 계획 모드에서는 쓰기 도구를 아예 안 보낸다.
  // 모델에게 '쓰지 마세요' 라고 부탁하는 게 아니라 손에 안 쥐여 준다.
  const { ctx, session } = 새것({ session: { work: 'plan' } });
  대본 = [{ text: '계획입니다.' }];
  await 돌리기(session, ctx, '계획 세워줘');
  const 보낸도구 = 받은몸통[0]?.tools?.map((t) => t.function?.name) ?? [];
  check('계획 모드에는 Write 를 안 보낸다', !보낸도구.includes('Write'), 보낸도구.join(','));
  check('계획 모드에는 Edit 도 안 보낸다', !보낸도구.includes('Edit'), 보낸도구.join(','));
  check('계획 모드에도 Read 는 보낸다', 보낸도구.includes('Read'), 보낸도구.join(','));
}

trace('7-치움');
srv.close();
resetNet();
rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n안 하는 자리 검사  ${D}(못 하는 것보다 하지 말아야 할 것을 하는 게 무섭다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
