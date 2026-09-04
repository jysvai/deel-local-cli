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
import { makeScope, checkPaths, 경로낱말, 봐주는자리 } from '../src/safety/guard.js';
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

  /*
   * ── 자료가 아닌 자리까지 막고 있었다 ─────────────────────────────────
   *
   * 울타리는 **사람의 자료**를 지키려고 있다. 그런데 두 가지가 자료가 아닌데도
   * 같이 막혀서, 모델이 할 수 있는 일을 못 하게 만들었다. 진짜로 이렇게 났다 —
   *
   *   ▶ Bash(soffice --convert-to txt 보고서.pptx > /dev/null 2>&1)
   *     └ 막힘 — 작업 범위 밖입니다: /dev/null
   *   ▶ Bash(ls -l /usr/bin/strings)
   *     └ 막힘 — 작업 범위 밖입니다: /usr/bin/strings
   *
   * 문서를 못 읽었고, 변환하려니 막혔고, 남은 길이 없으니 같은 문을 계속
   * 두드렸다. 헛돌던 턴의 원인이 여기였다.
   *
   * ★ 이 검사는 **두 방향**으로 잰다. 푸는 것만 재면 울타리를 통째로 열어 놓고도
   * 초록이 된다. 남의 홈·/etc·/tmp 가 그대로 막히는지가 같은 무게로 중요하다.
   */
  const 풀려야 = [
    ['2>/dev/null 하나로 명령 전체가 죽지 않는다', 'cat a.txt 2>/dev/null'],
    ['버리는 자리로 내보낼 수 있다', 'soffice --headless --convert-to txt a.pptx > /dev/null 2>&1'],
    ['이 PC 에 무엇이 깔렸는지 볼 수 있다', 'ls -l /usr/bin/strings'],
    ['맥 앱 꾸러미 안의 실행파일을 부를 수 있다', '/Applications/LibreOffice.app/Contents/MacOS/soffice --version'],
    ['표준출력으로 받는 것도 된다', 'textutil -convert txt a.doc -output /dev/stdout'],
  ];
  for (const [이름, cmd] of 풀려야) {
    check(`★ ${이름}`, 막히나(cmd) === null, 막히나(cmd)?.split('\n')[0] ?? '');
  }

  const 막혀야 = [
    ['남의 홈은 그대로 막힌다', 'cat /Users/남/비밀.txt'],
    ['/etc 는 그대로 막힌다', 'cat /etc/passwd'],
    ['/tmp 는 그대로 막힌다 (중간 파일은 .deel/tmp 에 쓴다)', 'soffice --convert-to pdf x.pptx > /tmp/log.txt'],
    ['/dev 라고 아무거나 되는 것은 아니다', 'cat /dev/disk0'],
  ];
  for (const [이름, cmd] of 막혀야) {
    check(`★ ${이름}`, /범위 밖/.test(막히나(cmd) ?? ''), 막히나(cmd)?.split('\n')[0] ?? '(통과했습니다)');
  }

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

  /*
   * ── 코드 안의 슬래시를 경로로 읽지 않는가 ─────────────────────────────
   *
   * 여기 오는 것은 셸 명령줄인데, 모델은 그 안에 자바스크립트를 통째로 넣는다.
   * 그러면 코드 안의 슬래시가 전부 경로로 보인다. 실제 화면에서 이렇게 막혔다 —
   *
   *   ▶ Bash(node - <<'NODE' const fs=require('fs'); …)
   *     └ 막힘 — 작업 범위 밖입니다: /data:image\/[\s\S]*?base64,[^"']+/g,'…'
   *   ▶ Bash(node -e "…")
   *     └ 막힘 — 작업 범위 밖입니다: /div
   *
   * 정규식 리터럴과 `</div>` 다. 파일과 아무 상관이 없는데 명령 **전체**가
   * 거절됐고, 모델은 왜 막혔는지 모르니 따옴표만 바꿔 대여섯 번을 다시 했다.
   * 한 요청이 몇 분씩 늘어난 큰 몫이 이것이었다.
   */
  /*
   * 화면에 찍힌 그 명령을 그대로 재현한다.
   *
   * heredoc 이라 코드가 따옴표 **밖**에 있다 — 그래서 줄마다 낱말로 잘리고,
   * 정규식 조각 하나하나가 경로 후보가 된다. `node -e "…"` 는 따옴표 안이라
   * 통째로 한 낱말이 되어 이 결함이 안 드러난다. 그래서 여기는 heredoc 이어야 한다.
   */
  {
    const 진짜명령 = [
      "node - <<'NODE'",
      "const fs = require('fs');",
      `const p = '${join(root, 'a.html').replace(/\\/g, '/')}';`,
      'let s = fs.readFileSync(p, "utf8");',
      `s = s.replace(/data:image\\/[\\s\\S]*?base64,[^"']+/g, 'data:[omitted]');`,
      "s = s.replace(/<\\/div>/g, '');",
      'fs.writeFileSync(p, s);',
      'NODE',
    ].join('\n');
    check('heredoc 안의 정규식·태그로 명령이 안 막힌다', 막히나(진짜명령) === null,
      막히나(진짜명령)?.split('\n')[0] ?? '');
    // 그 안에 든 **진짜** 경로는 여전히 뽑아서 본다. 통째로 안 보는 것이 아니다.
    check('그래도 그 안의 진짜 경로는 본다',
      경로낱말(진짜명령).some((t) => t.includes('a.html')),
      JSON.stringify(경로낱말(진짜명령)));
  }

  const 코드통과 = [
    ["node -e \"s.replace(/data:image\\/[\\s\\S]*?base64,[^x]+/g,'')\"", '정규식 리터럴'],
    ['node -e "const h=t.replace(/<\\/div>/g,\'\')"', '닫는 태그가 든 정규식'],
    ['echo "</div>"', 'HTML 닫는 태그'],
    ['node -e "if(a/b>c/d){}"', '나눗셈'],
    ["awk '{print $1/$2}' data.csv", 'awk 식'],
  ];
  for (const [c, 뭐] of 코드통과) {
    check(`코드 조각을 경로로 안 읽는다 (${뭐})`, 막히나(c) === null, 막히나(c)?.split('\n')[0] ?? '');
  }

  /*
   * 그렇다고 울타리를 열어 두면 안 된다. 넘기는 것은 **정규식처럼 생긴 것**과
   * 디스크에 없는 한 마디짜리뿐이고, 평범하게 생긴 밖 경로는 그대로 걸린다.
   * 글로브도 마찬가지다 — `rm /Users/남/*` 은 진짜 경로다.
   */
  const 여전히막힘 = [
    [`cat ${join(tmpdir(), 'x', 'secret.txt')}`, '평범한 밖 경로'],
    [`rm ${join(tmpdir(), 'x')}/*`, '글로브'],
    ['cat ~/.ssh/id_rsa', '집 폴더'],
    ['cat ../../밖.txt', '위로 올라가기'],
  ];
  for (const [c, 뭐] of 여전히막힘) {
    check(`밖으로 나가는 것은 그대로 막힌다 (${뭐})`, 막히나(c) !== null, c);
  }
}

trace('5c-cd로우회');

/*
 * ── cd 한 줄이면 위 울타리가 통째로 없는 것이 된다 ─────────────────────
 *
 * 바로 위 검사는 `type .deel\config.json` 을 막는다. 그런데 `cd .deel` 을
 * 먼저 하고 나면 뒤에 오는 것은 전부 **맨 이름**이다. `config.json` 에는
 * 빗금이 없으니 경로낱말() 이 낱말 후보로도 안 뽑고, 그래서 아무 검사도
 * 안 받았다. 실제로 이 네 줄이 전부 그냥 지나갔다 —
 *
 *   cd .deel && type config.json
 *   cd .deel; cat config.json
 *   cd .deel && del audit.jsonl
 *   cd .deel ⏎ type config.json
 *
 * 앞 문은 잠그고 옆 문은 열어 두면 잠근 뜻이 없다. 게다가 더 나쁘다 —
 * 사용자와 시스템 프롬프트는 「막혀 있다」 고 믿는데 실제로는 안 막혀 있다.
 *
 * 그래서 **들어가는 것 자체**를 위반으로 본다. 들어가고 난 뒤에는 우리가
 * 볼 수 있는 글자가 남지 않기 때문에, 거기서 막을 방법이 아예 없다.
 */
{
  const { ctx } = 새것();
  const 막히나 = (cmd) => {
    try { checkPaths(cmd, ctx.scope); return null; }
    catch (e) { return e.message; }
  };

  const 넘어갔던것 = [
    ['&& 로 이어 붙인 것', 'cd .deel && type config.json'],
    ['; 로 이어 붙인 것', 'cd .deel; cat config.json'],
    ['들어가서 지우는 것', 'cd .deel && del audit.jsonl'],
    ['줄을 바꿔 적은 것', 'cd .deel\ntype config.json'],
    ['빗금을 붙인 것', 'cd .deel/ && cat config.json'],
    ['pushd 도 같은 일을 한다', 'pushd .deel && type config.json'],
    ['파워셸 꼴', 'Set-Location .deel; Get-Content config.json'],
    ['셸을 한 겹 씌운 것', 'bash -c "cd .deel && cat config.json"'],
    ['남의 도구 살림으로 들어가는 것', 'cd .codex && cat history.jsonl'],
  ];
  for (const [뭐, cmd] of 넘어갔던것) {
    check(`★ cd 로는 못 넘어간다 (${뭐})`, 막히나(cmd) !== null, 막히나(cmd)?.split('\n')[0] ?? '(통과했습니다)');
  }
  check('★ 왜 막혔는지에 열쇠 이야기가 있다', /열쇠/.test(막히나('cd .deel && type config.json') ?? ''),
    막히나('cd .deel && type config.json')?.split('\n')[0] ?? '');

  // 밖으로 나가는 cd 도 같은 무게다. 나가고 나면 뒤 낱말은 다 맨 이름이다.
  const 나가는것 = [
    ['위로 올라가기', 'cd .. && cat 비밀.txt'],
    ['남의 폴더', 'cd /etc && cat passwd'],
    ['집 폴더', 'cd ~/.ssh && cat id_rsa'],
    ['절대경로로 밖', `cd ${join(tmpdir(), '남의방')} && ls`],
  ];
  for (const [뭐, cmd] of 나가는것) {
    check(`★ 밖으로 나가는 cd 는 막힌다 (${뭐})`, /범위 밖/.test(막히나(cmd) ?? ''),
      막히나(cmd)?.split('\n')[0] ?? '(통과했습니다)');
  }

  /*
   * ★ 반대쪽이 같은 무게로 중요하다.
   *
   * cd 를 전부 막아 버리면 초록이 되지만 도구는 못 쓴다 — 모델이 하는 일의
   * 절반이 `cd 하위폴더 && 무엇` 이다. 안에서 도는 것은 전부 그대로 돌아야 한다.
   */
  const 그대로돌것 = [
    ['하위 폴더로 들어가 읽기', 'cd src && cat x.js'],
    ['들어갔다 나오면 제자리다', 'cd src && cd .. && npm test'],
    ['pushd 로 들어갔다 popd 로 나오기', 'pushd src && npm test && popd && npm run build'],
    ['인자 없는 cd', 'cd'],
    ['cd - (직전 자리)', 'cd - && npm test'],
    ['cd . 은 제자리다', 'cd . && node src/cli.js'],
    ['윈도우 드라이브 스위치가 있어도 안 죽는다', `cd /d ${root} && npm test`],
    ['자리표가 남아 있으면 어디로 갈지 모르니 안 막는다', 'cd $BUILD_DIR && make'],
    ['프로그램이 있는 자리로는 갈 수 있다', 'cd /usr/bin && ls'],
    ['글 안의 cd 는 명령이 아니다', 'echo "cd .deel" > note.txt'],
  ];
  for (const [뭐, cmd] of 그대로돌것) {
    check(`★ 평범한 cd 는 그대로 돈다 (${뭐})`, 막히나(cmd) === null, 막히나(cmd)?.split('\n')[0] ?? '');
  }

  // 앞에서 옮긴 자리를 이어서 센다. 안 그러면 `cd src && cd ..` 가 밖으로 읽힌다.
  check('★ 옮긴 자리를 이어서 센다 (cd src && cd .. && cd .deel 은 막힌다)',
    막히나('cd src && cd .. && cd .deel') !== null,
    막히나('cd src && cd .. && cd .deel')?.split('\n')[0] ?? '(통과했습니다)');
  check('★ 두 칸 내려갔다 두 칸 올라오는 것은 제자리다',
    막히나('cd src/a && cd ../.. && npm test') === null,
    막히나('cd src/a && cd ../.. && npm test')?.split('\n')[0] ?? '');
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

/*
 * ── ★ 링크가 밖을 가리키면 막는다 ──────────────────────────────────────
 *
 * 이 프로그램이 파는 두 문장 가운데 하나가 「작업 폴더 밖은 안 만진다」 다.
 * 글자로 밖을 가리키는 것은 재고 있었는데(`../..`), **글자로는 안인데 링크를
 * 따라가면 밖**인 자리는 아무 검사도 안 지나고 있었다. 정션 하나면 울타리가
 * 통째로 열린다 — 사내망 공유 폴더를 그렇게 걸어 두는 사람이 실제로 있다.
 *
 * 막는 코드는 있었다. 다만 저장소 전체에서 밖을 가리키는 링크를 만드는 검사가
 * 하나도 없어서, 그 코드를 `if (false)` 로 바꿔도 어떤 판에서도 안 빨개졌다.
 * 「있다」 와 「돈다」 는 다르다.
 */
trace('9-링크탈출');
{
  const { symlinkSync, mkdirSync } = await import('node:fs');
  const { ScopeError } = await import('../src/safety/guard.js');

  const 판 = mkdtempSync(join(tmpdir(), 'deel-link-'));
  const 뿌리 = join(판, '작업폴더');
  const 바깥 = join(판, '남의폴더');
  mkdirSync(뿌리, { recursive: true });
  mkdirSync(바깥, { recursive: true });
  writeFileSync(join(바깥, '비밀.txt'), '남의 것\n', 'utf8');
  writeFileSync(join(뿌리, '내것.txt'), '내 것\n', 'utf8');

  const 샛문 = join(뿌리, '샛문');
  // 윈도우는 심볼릭 링크에 권한이 필요하다. 정션은 권한 없이도 걸린다.
  let 걸었나 = false;
  for (const 갈래 of process.platform === 'win32' ? ['junction', 'dir'] : ['dir']) {
    try { symlinkSync(바깥, 샛문, 갈래); 걸었나 = true; break; } catch { /* 다음 갈래로 */ }
  }

  if (!걸었나) {
    /*
     * 못 걸었으면 **건너뛰었다고 남긴다.** 조용히 넘기면 「검사 있음」 으로
     * 세어지는데 실제로는 아무것도 안 잰 것이다 — 이 저장소가 이미 여러 번
     * 겪은 모양이다. (리눅스에서는 늘 걸리므로 CI 에서는 반드시 돈다.)
     */
    건너뜀?.push?.('링크를 못 걸어 링크 탈출 검사 3건을 못 쟀다 (윈도우 권한)');
    console.log('\n  ⚠ 링크를 못 걸어 링크 탈출 검사를 건너뜁니다 (윈도우 권한).\n');
  } else {
    const scope = makeScope(뿌리);
    const 막혔나 = (p) => {
      try { scope.resolve(p); return false; } catch (e) { return e instanceof ScopeError; }
    };
    check('★ 링크를 따라가면 밖인 자리를 막는다', 막혔나('샛문/비밀.txt'), 'samun/비밀.txt');
    check('★ 링크 폴더 자체도 막는다', 막혔나('샛문'));
    check('링크가 아닌 안쪽 파일은 그대로 통과한다',
      !막혔나('내것.txt') && scope.resolve('내것.txt') === join(뿌리, '내것.txt'));
  }

  rmSync(판, { recursive: true, force: true });
}

/*
 * ── 울타리를 그냥 지나가던 세 길 ────────────────────────────────────────
 *
 * 셋 다 「경로 낱말」 을 고르는 자리에서 새고 있었다. 낱말로 안 뽑히면
 * checkPaths 는 그것을 **보지도 않는다** — 막힌 것이 아니라 안 본 것이다.
 */
{
  const 낱 = (cmd) => 경로낱말(cmd).map((x) => String(x).replace(/\\/g, '/'));

  // 1) 파워셸의 `$env:이름`
  const ps = 낱('pwsh -Command Get-Content $env:USERPROFILE/.deel/config.json');
  check('★★ $env: 로 적은 경로도 낱말로 뽑힌다',
    ps.some((x) => /[.]deel[/]config[.]json$/i.test(x)), JSON.stringify(ps));

  // 2) 주소 꼴로 적은 이 PC 의 경로
  const f1 = 낱('curl.exe file:///C:/Users/x/.deel/config.json');
  check('★★ file:// 는 주소가 아니라 경로로 본다',
    f1.some((x) => /^C:[/]Users[/]x[/][.]deel[/]config[.]json$/i.test(x)), JSON.stringify(f1));
  const f2 = 낱('curl file:///etc/passwd');
  check('★ file:/// 뒤가 유닉스 경로여도 본다', f2.some((x) => x === '/etc/passwd'), JSON.stringify(f2));

  // 진짜 주소는 여전히 이 울타리가 볼 것이 아니다 (그물은 safety/network.js).
  check('★ http(s) 주소는 경로로 안 본다', 낱('curl https://example.com/a/b').length === 0,
    JSON.stringify(낱('curl https://example.com/a/b')));

  // 3) 윈도우 뿌리를 통째로 봐주던 것
  check('★★ C:/Windows 아래를 통째로 봐주지 않는다',
    봐주는자리('c:/windows/system32/drivers/etc/hosts') === null
    && 봐주는자리('c:/windows/temp/뭔가.exe') === null,
    `${봐주는자리('c:/windows/system32/drivers/etc/hosts')} · ${봐주는자리('c:/windows/temp/뭔가.exe')}`);
  check('★ 그래도 실행파일 폴더는 봐준다',
    !!봐주는자리('c:/windows/system32/cmd.exe') && !!봐주는자리('c:/program files/git/bin/git.exe'),
    `${봐주는자리('c:/windows/system32/cmd.exe')}`);
  check('★ /dev/null 과 /usr/bin 은 그대로 봐준다',
    !!봐주는자리('/dev/null') && !!봐주는자리('/usr/bin/strings'));
}



const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n안 하는 자리 검사  ${D}(못 하는 것보다 하지 말아야 할 것을 하는 게 무섭다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
