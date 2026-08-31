// 걸음을 다 써서 끊겼을 때, ⏎ 하나로 이어지는가.
//
// ── 무슨 일이 났었나 ────────────────────────────────────────────────────
//
// 「roo code 나 다른 cli 어플을 사용하다가 deel cli 쓰면 너무 기능적이나
//  그런 부분에서 부족하거나 중간에 끊기는 이슈가 생기는거 같은데 해당
//  문제점들이 극복되면 좋겠어」
//
// 한 턴에 도는 걸음 수에는 상한이 있다. 없앨 수 없는 안전장치다 — 그게
// 없으면 헛도는 턴이 컨텍스트를 다 먹을 때까지 안 멈춘다. 문제는 상한이
// 아니라 **거기서 길이 끊겼다는 것**이었다. 화면에는 남은 할 일이 다
// 적혀 있는데, 이으려면 사람이 그걸 손으로 다시 옮겨 적거나 "이어서
// 해줘" 라고만 쳐야 했다. 그러면 모델은 무엇을 잇는지 몰라서 처음부터
// 다시 뒤진다.
//
// ── 여기서 지키는 것 ────────────────────────────────────────────────────
//
//   1. 끊기면 이어서 할지 **그 자리에서** 묻는다. ⏎ 하나면 된다.
//   2. 이어갈 말에 남은 단계가 **글자 그대로** 실린다. 가리키기만 하는
//      말("아까 하던 것 이어서")은 작은 모델을 지난 대화 뒤지기로 보낸다.
//   3. 이미 끝낸 것은 다시 하지 말라고 못 박는다.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 벗기기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
const 여기 = dirname(fileURLToPath(import.meta.url));
const 뿌리 = join(여기, '..');
const 소스 = readFileSync(join(뿌리, 'src', 'repl.js'), 'utf8');

// 걸음을 다 쓰게 하려면 도구를 계속 부르게 해야 하는데, 같은 것을 되풀이하면
// 헛돈다고 먼저 잡힌다(그게 맞다). 그래서 무늬를 매번 바꾼다.
const 할일들 = [
  { text: '첫째 부문 표 만들기', state: 'done' },
  { text: '둘째 부문 그래프 붙이기', state: 'todo' },
  { text: '셋째 부문 요약 쓰기', state: 'todo' },
];

trace('1-스텁띄우기');

let 도구번호 = 1;
let 이은말 = null;   // 이어서 하기로 했을 때 모델에게 **실제로 간 말**
const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (b) => (body += b));
  req.on('end', () => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const 보냄 = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url === '/v1/models') return 보냄({ data: [{ id: '스텁모델', object: 'model' }] });
    if (url !== '/v1/chat/completions') return 보냄({});
    let json = null;
    try { json = body ? JSON.parse(body) : null; } catch { /* 없을 수 있다 */ }

    const 답 = (msg) => 보냄({
      id: 'x', object: 'chat.completion', model: '스텁모델',
      choices: [{ index: 0, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop', message: msg }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    });
    const 도구답 = (name, args) => 답({
      role: 'assistant', content: null,
      tool_calls: [{ id: `c${도구번호++}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    });

    const 메시지들 = json?.messages ?? [];
    /*
     * 이어서 하기로 한 턴. 여기가 이 파일의 핵심이다.
     *
     * 마지막 사람 말이 아니라 **처음 간 그 말**을 본다. deel 은 읽기만
     * 하고 안 고치는 턴에 「시킨 것은 이것입니다: …」 로 한 번 되민다.
     * 그 되미는 말은 요청을 160자로 잘라 담으므로, 마지막 것만 보면
     * 뒷부분이 없는 것을 두고 "안 실렸다" 고 잘못 재게 된다.
     */
    const 이은것 = 메시지들
      .filter((m) => m.role === 'user')
      .map((m) => String(m.content ?? ''))
      .find((s) => s.startsWith('걸음 수를 다 써서'));
    if (이은것) {
      이은말 = 이은것;
      return 답({ role: 'assistant', content: '이어서 다 했습니다.' });
    }
    // 첫 턴 — 할 일을 적는다(하나는 이미 끝난 것으로).
    if (도구번호 === 1) return 도구답('TodoWrite', { todos: 할일들 });
    // 그 뒤로는 끝없이 도구를 부른다. 걸음 상한에 걸릴 때까지.
    return 도구답('Glob', { pattern: `${'abcdefghijklmnopqrstuvwxyz'[도구번호 % 26]}*.none` });
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const 주소 = `http://127.0.0.1:${srv.address().port}/v1`;

/** deel 을 띄우고 줄을 하나씩 넣는다. 기다리는 법은 planapprove 와 같다. */
async function 띄우기(줄들) {
  도구번호 = 1;
  이은말 = null;
  const root = mkdtempSync(join(tmpdir(), 'deel-resume-'));
  const home = mkdtempSync(join(tmpdir(), 'deel-resume-home-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 'stub', level: '개발자',
    profiles: [{
      id: 'stub', name: '스텁 연결', kind: 'openai', baseUrl: 주소,
      auth: 'none', apiKey: '', model: '스텁모델', ctx: 8192, streaming: false, tools: true,
    }],
  }), 'utf8');

  // ctx 를 8k 로 잡으면 code 모드의 걸음 상한이 16이다 — 검사가 몇 초로 끝난다.
  const kid = spawn(process.execPath,
    [join(뿌리, 'bin', 'deel.js'), '--root', root, '--offline', '--ctx', '8192', '--no-tui'],
    { cwd: 뿌리, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DEEL_HOME: home } });

  let out = '';
  kid.stdout.setEncoding('utf8');
  kid.stderr.setEncoding('utf8');
  kid.stdout.on('data', (b) => { out += b; });
  kid.stderr.on('data', (b) => { out += b; });
  let 끝남 = false;
  const 닫힘 = new Promise((r) => kid.on('close', () => { 끝남 = true; r(); }));
  const 자기 = (ms) => new Promise((r) => setTimeout(r, ms));

  // 시간이 아니라 '받을 자리' 를 기다린다 — 까닭은 planapprove.test.js 에.
  let 쓴자리 = 0;
  const 받을때까지 = async (최대 = 30000) => {
    const 끝 = Date.now() + 최대;
    while (Date.now() < 끝 && !끝남) {
      const 글 = 벗기기(out);
      if (글.length > 쓴자리 && /(?:❯|\[y\])[ \t]*$/.test(글)) return true;
      await 자기(30);
    }
    return false;
  };
  const 밀어넣기 = (l) => {
    if (끝남) return;
    쓴자리 = 벗기기(out).length;
    try { kid.stdin.write((l ?? '') + '\n'); } catch { /* 이미 닫혔다 */ }
  };

  for (const l of 줄들) {
    await 받을때까지();
    밀어넣기(l);
  }
  await 받을때까지();
  밀어넣기('/exit');
  await Promise.race([닫힘, 자기(8000).then(() => kid.kill())]);
  return { out: 벗기기(out), root, home };
}

trace('2-끊기면-묻는다');

{
  const r = await 띄우기(['/code', '부문별로 다 만들어줘', '']);

  check('걸음을 다 쓰면 멈췄다고 말한다', /도구 호출 \d+회에서 멈췄습니다/.test(r.out),
    r.out.split('\n').find((l) => /멈췄습니다/.test(l))?.trim().slice(0, 60) ?? '못 찾음');
  check('안 끝난 것을 목록으로 보여 준다',
    /안 끝난 것/.test(r.out) && /둘째 부문 그래프 붙이기/.test(r.out));
  // 끝낸 것을 다시 보여 주면 사람은 다 안 된 줄 알고 처음부터 다시 시킨다.
  check('끝난 것은 안 끝난 목록에 안 넣는다',
    !new RegExp('안 끝난 것[\\s\\S]{0,200}첫째 부문 표 만들기').test(r.out));

  check('이어서 할지 그 자리에서 묻는다', /이어서 할까요\?/.test(r.out),
    r.out.split('\n').find((l) => /이어서 할까요/.test(l))?.trim().slice(0, 70) ?? '못 찾음');
  check('무엇을 누르면 되는지 알려 준다', /⏎ 이어서/.test(r.out) && /n 그만/.test(r.out));
  check('이어간다고 화면에 남긴다', /끊긴 자리에서 이어서 합니다/.test(r.out),
    r.out.split('\n').find((l) => /이어서 합니다/.test(l))?.trim().slice(0, 70) ?? '못 찾음');
  check('남은 것이 몇 가지인지 세어 준다', /남은 2가지/.test(r.out),
    r.out.split('\n').find((l) => /남은 \d가지/.test(l))?.trim().slice(0, 60) ?? '못 셌다');

  // 사람이 다시 치지 않았는데 이어진 것이다. 그걸 ❯ 로 찍으면 거짓말이 된다.
  check('이어가는 말을 사람이 친 것처럼 안 찍는다', !/❯.*이어서 하라고 했다/.test(r.out));

  /*
   * ── 여기가 이 파일의 핵심이다 ────────────────────────────────────────
   *
   * 말이 아니라, **다음 턴이 실제로 왔는가.** 안 오면 여태 하던 것과
   * 똑같다 — 화면에만 친절하고 길은 그대로 끊겨 있다.
   */
  check('★ ⏎ 한 번에 다음 턴이 실제로 온다', !!이은말,
    이은말 ? '' : '이어지는 턴이 안 왔다');

  /*
   * ★ 남은 단계를 **실어서** 보내는가.
   *
   * "아까 하던 것 이어서 해라" 는 가리키기만 하고 안 주는 말이다. 계획
   * 승인에서 같은 실수를 한 적이 있고, 그때 작은 모델은 그 '아까' 를
   * 찾으러 지난 대화를 세 번 뒤지고 정작 시킨 일은 시작도 안 했다.
   */
  check('★ 남은 단계가 글자 그대로 실려 간다',
    !!이은말 && 이은말.includes('둘째 부문 그래프 붙이기') && 이은말.includes('셋째 부문 요약 쓰기'),
    이은말 ? 이은말.replace(/\n/g, ' ⏎ ').slice(0, 90) : '(안 옴)');
  check('★ 이미 끝낸 것은 안 싣는다', !!이은말 && !이은말.includes('첫째 부문 표 만들기'),
    이은말 && 이은말.includes('첫째 부문') ? '끝난 것도 실렸다' : '');
  check('★ 이미 끝낸 것을 다시 하지 말라고 못 박는다',
    !!이은말 && /이미 끝낸 것은 다시 하지 마라/.test(이은말));
  check('지난 대화를 뒤지지 말라고 못 박는다', !!이은말 && /지난 대화를 뒤지지 마라/.test(이은말));
  check('처음부터 다시 하지 말라고 한다', !!이은말 && /처음부터 다시 시작하지도 마라/.test(이은말));

  rmSync(r.root, { recursive: true, force: true });
  rmSync(r.home, { recursive: true, force: true });
}

trace('3-그만');

{
  const r = await 띄우기(['/code', '부문별로 다 만들어줘', 'n']);
  check('그만이라고 하면 안 잇는다', 이은말 === null,
    이은말 ? 이은말.slice(0, 60) : '');
  check('그만뒀다고 말해 준다', /여기서 멈췄습니다/.test(r.out),
    r.out.split('\n').find((l) => /멈췄습니다/.test(l) && !/도구 호출/.test(l))?.trim().slice(0, 70) ?? '못 찾음');
  check('나중에 이어도 된다고 알려 준다', /이어서 해줘/.test(r.out));
  rmSync(r.root, { recursive: true, force: true });
  rmSync(r.home, { recursive: true, force: true });
}

trace('4-배선');

{
  check('끊긴 할 일을 담아 둔다', /끊긴할일 = ev\.남은할일 \?\? \[\]/.test(소스));
  /*
   * ★ 계획 승인 창과 같은 자리를 쓰면 안 된다. 둘 다 뜨면 사람은 두 번
   * 답해야 하고, 계획이 반만 나온 것을 두고 "이대로 진행할까요?" 를
   * 묻는 꼴이 난다.
   */
  check('★ 계획 승인과 한 자리에서 갈린다', /\} else if \(끊긴할일\) \{/.test(소스));
  /*
   * 끝난 것을 빼는 자리가 **둘**이다 — loop.js 가 남은할일 을 만들 때 한 번,
   * repl.js 가 이을 말을 지을 때 한 번. 겹쳐 보이지만 재는 것이 다르다.
   * 앞엣것은 화면에 무엇을 보여 줄지, 뒤엣것은 모델에게 무엇을 시킬지다.
   * 뒤엣것이 없으면 저쪽이 언젠가 바뀔 때 **끝난 일을 다시 시키는 말**이
   * 조용히 나간다. 화면 검사로는 둘을 못 가르므로 여기서 둘 다 못 박는다.
   */
  const 룹 = readFileSync(join(뿌리, 'src', 'agent', 'loop.js'), 'utf8');
  check('loop 이 남은 것만 넘긴다', /남은할일 = \(ctx\.todos \?\? \[\]\)\.filter\(\(x\) => x\.state !== 'done'\)/.test(룹));
  check('repl 도 이을 말에서 끝난 것을 뺀다',
    /끊긴할일\.filter\(\(t\) => t && t\.state !== 'done'\)/.test(소스));
  // 모드를 다시 고르면 "해라" 가 들어 있어 엉뚱한 데로 간다.
  check('이을 때 모드를 다시 안 고른다', /이어갈모드 = session\.routed \?\?/.test(소스));
}

trace('5-끝');

srv.close();

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n끊긴 자리 잇기 검사  ${D}(걸음을 다 써도 ⏎ 하나로 이어지는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
