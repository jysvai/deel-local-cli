// 계획을 내고 → 승인을 받고 → 그대로 실행까지 잇는가.
//
// ── 왜 이 파일이 따로 있나 ──────────────────────────────────────────────
//
// 계획 모드에는 이런 말이 적혀 있었다.
//
//   hint: '먼저 계획 · 승인 뒤 실행'
//   say : "마지막에 \"이대로 진행할까요?\" 로 끝내라. 승인을 받으면 /code 로 바꿔 실행한다."
//
// 모델에게 물어보라고 시켜 놓고, **승인받는 자리도 이어가는 길도 없었다.**
// 사람이 /code 를 알아서 쳐야 이어졌다. 코드가 안 하는 일을 화면이 약속하고
// 있었던 셈이고, 그래서 계획 모드는 '파일 안 고치는 모드' 로만 보였다.
//
// 여기서 재는 것은 말이 아니라 **결과물**이다 — ⏎ 한 번에 파일이 실제로
// 생겼는가. 안 생겼으면 뒷 절반은 여전히 없는 것이다.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// 색을 벗겨 놓고 본다.
//
// 화면 글에는 색이 섞여 들어온다. `┌ 계획` 처럼 두 글자가 서로 다른 색이면
// 그 사이에 제어문자가 끼어서, 눈에 보이는 그대로 찾으면 못 찾는다.
// 검사가 재려는 것은 색이 아니라 무슨 글이 나왔는가이므로 먼저 벗긴다.
const 벗기기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

const 여기 = dirname(fileURLToPath(import.meta.url));
const 뿌리 = join(여기, '..');
const 만들파일 = '비전선언문.md';
const 만든내용 = '스텁이 계획대로 만든 것';

trace('1-스텁띄우기');

// ── 스텁 모델 ───────────────────────────────────────────────────────────
//
// 규칙은 둘뿐이다.
//   · 도구 결과가 방금 왔으면 → 글로 답하고 끝낸다.
//   · 아니면 → 지금 무슨 턴인지 보고 도구를 하나 부른다.
let 도구번호 = 1;
// 승인 뒤 모델에게 **실제로 간 말**. 계획을 실어 보내는지 여기서 본다.
let 승인말 = null;
const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (b) => (body += b));
  req.on('end', () => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let json = null;
    try { json = body ? JSON.parse(body) : null; } catch { /* 없을 수 있다 */ }
    const 보냄 = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url === '/v1/models') return 보냄({ data: [{ id: '스텁모델', object: 'model' }] });
    if (url !== '/v1/chat/completions') return 보냄({});

    const 답 = (msg, why) => 보냄({
      id: 'x', object: 'chat.completion', model: '스텁모델',
      choices: [{ index: 0, finish_reason: why ?? (msg.tool_calls ? 'tool_calls' : 'stop'), message: msg }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    });
    const 도구답 = (name, args) => 답({
      role: 'assistant', content: null,
      tool_calls: [{ id: `c${도구번호++}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    });

    const 메시지들 = json?.messages ?? [];
    const 마지막 = 메시지들[메시지들.length - 1];
    const 사람말 = String([...메시지들].reverse().find((m) => m.role === 'user')?.content ?? '');
    // 도구 정의에 무엇이 실려 왔는지. 계획 턴에는 쓰기 도구가 없어야 한다.
    const 도구이름들 = (json?.tools ?? []).map((t) => t?.function?.name).filter(Boolean);

    if (마지막?.role === 'tool') {
      return 답({ role: 'assistant', content: 도구이름들.includes('Write')
        ? '다 만들었습니다.'
        : '계획을 적었습니다. 이대로 진행할까요?' });
    }

    // 승인 뒤 이어지는 턴. 여기서 Write 가 되면 뒷 절반이 살아 있는 것이다.
    if (/계획을 사람이 승인했다/.test(사람말)) {
      승인말 = 사람말;
      return 도구답('Write', { file_path: 만들파일, content: 만든내용 });
    }
    // 계획을 고쳐 달라고 한 턴.
    if (/계획에서 이걸 고쳐서/.test(사람말)) {
      return 도구답('TodoWrite', { todos: [{ text: '고친 계획 한 단계', state: 'todo' }] });
    }
    // 첫 턴 — 계획을 적는다.
    return 도구답('TodoWrite', {
      todos: [
        { text: '비전 선언문 한 장 쓰기', state: 'todo' },
        { text: '현황 진단 붙이기', state: 'todo' },
        { text: '3개년 로드맵 표로', state: 'todo' },
      ],
    });
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const 주소 = `http://127.0.0.1:${srv.address().port}/v1`;

/**
 * deel 을 띄우고 줄을 하나씩 넣는다. 상자는 안 쓴다 — 여기서 보는 것은
 * 테두리가 아니라 흐름이다.
 */
async function 띄우기(줄들) {
  도구번호 = 1;
  const root = mkdtempSync(join(tmpdir(), 'deel-plan-'));
  const home = mkdtempSync(join(tmpdir(), 'deel-plan-home-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 'stub', level: '개발자',
    profiles: [{
      id: 'stub', name: '스텁 연결', kind: 'openai', baseUrl: 주소,
      auth: 'none', apiKey: '', model: '스텁모델', ctx: 32768, streaming: false, tools: true,
    }],
  }), 'utf8');

  const kid = spawn(process.execPath,
    [join(뿌리, 'bin', 'deel.js'), '--root', root, '--offline', '--ctx', '32768', '--no-tui'],
    { cwd: 뿌리, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DEEL_HOME: home } });

  let out = '';
  kid.stdout.on('data', (b) => { out += b; });
  kid.stderr.on('data', (b) => { out += b; });
  let 끝남 = false;
  const 닫힘 = new Promise((r) => kid.on('close', () => { 끝남 = true; r(); }));
  const 자기 = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const l of 줄들) {
    await 자기(l === null ? 1500 : 900);
    if (!끝남) { try { kid.stdin.write((l ?? '') + '\n'); } catch { /* 이미 닫혔다 */ } }
  }
  await 자기(1200);
  if (!끝남) { try { kid.stdin.write('/exit\n'); } catch { /* 이미 닫혔다 */ } }
  // 안 끝나면 검사가 통째로 매달린다. 반드시 시한을 둔다.
  await Promise.race([닫힘, 자기(6000).then(() => kid.kill())]);
  return { out: 벗기기(out), root, home };
}

trace('2-승인하고진행');
// ── ⏎ 한 번으로 계획이 실행까지 가는가 ──────────────────────────────────
{
  const r = await 띄우기(['ax비전 선포 내용들 정리해서 만들어줘', '']);

  check('겹친 요청을 계획 모드로 보낸다', /계획/.test(r.out) && /Plan/.test(r.out),
    r.out.split('\n').find((l) => /Plan/.test(l))?.trim().slice(0, 60) ?? '못 찾음');
  check('뒷 절반이 온다고 미리 말해 준다', /승인하면.*이어서/.test(r.out),
    r.out.split('\n').find((l) => /이어서/.test(l))?.trim().slice(0, 70) ?? '못 찾음');
  check('계획 상자를 띄운다', /┌ 계획/.test(r.out));
  check('계획 상자에 단계가 적힌다',
    /비전 선언문 한 장 쓰기/.test(r.out) && /3개년 로드맵/.test(r.out));
  check('몇 단계인지 셈해 준다', /3단계/.test(r.out),
    r.out.split('\n').find((l) => /단계 ·/.test(l))?.trim().slice(0, 60) ?? '못 찾음');
  check('진행할지 묻는다', /이대로 진행할까요\?/.test(r.out));
  check('무엇을 누르면 되는지 알려 준다', /⏎ 진행/.test(r.out) && /n 취소/.test(r.out));

  // 여기가 이 파일의 핵심이다. 말이 아니라 파일이 생겼는가.
  const 만든것 = join(r.root, 만들파일);
  check('⏎ 한 번에 파일이 실제로 만들어진다', existsSync(만든것),
    existsSync(만든것) ? '' : '안 생겼다 — 승인 뒤 실행이 안 이어졌다');
  check('내용까지 제대로 들어간다',
    existsSync(만든것) && readFileSync(만든것, 'utf8').includes(만든내용));
  check('진행한다고 화면에 남긴다', /계획대로 진행합니다/.test(r.out));
  // 사람이 다시 치지 않았는데 이어진 것이다. 그걸 ❯ 로 찍으면 거짓말이 된다.
  check('이어가는 말을 사람이 친 것처럼 안 찍는다', !/❯.*계획을 사람이 승인했다/.test(r.out));

  /*
   * ── 승인한 계획을 **실어서** 보내는가 ─────────────────────────────────
   *
   * 예전에는 "위 계획을 승인받았다 · 적어 둔 단계를 하나씩 끝내라" 라고만
   * 보냈다. 사람 눈에는 계획이 바로 위에 있으니 말이 되는데, 모델에게는
   * **가리키기만 하고 안 주는 말**이다. 작은 모델은 "적어 둔" 것을 찾으러
   * Recall 로 지난 대화를 세 번 뒤지고, 정작 시킨 일은 시작도 안 했다.
   */
  check('승인한 계획의 단계가 그대로 실려 간다',
    !!승인말 && 승인말.includes('비전 선언문 한 장 쓰기') && 승인말.includes('3개년 로드맵 표로'),
    승인말 ? 승인말.slice(0, 80) : '승인 뒤 턴이 안 왔다');
  check('지난 대화를 뒤지지 말라고 못 박는다',
    !!승인말 && /지난 대화를 뒤지지 마라/.test(승인말));

  rmSync(r.root, { recursive: true, force: true });
  rmSync(r.home, { recursive: true, force: true });
}

trace('3-취소');
// ── n 이면 아무것도 안 만든다 ───────────────────────────────────────────
{
  const r = await 띄우기(['ax비전 선포 내용들 정리해서 만들어줘', 'n']);
  check('취소하면 파일을 안 만든다', !existsSync(join(r.root, 만들파일)));
  check('취소했다고 말해 준다', /그만뒀습니다/.test(r.out));
  check('계획은 남아 있다고 알려 준다', /계획은 위에 남아/.test(r.out));
  rmSync(r.root, { recursive: true, force: true });
  rmSync(r.home, { recursive: true, force: true });
}

trace('4-고쳐서다시');
// ── 그 밖의 말은 '고칠 점' 으로 받는다 ──────────────────────────────────
//
// 여기서 'e' 를 따로 두지 않은 이유: 고칠 점을 바로 치는 것이 한 걸음 짧다.
// 대신 **실수로 진행되면 안 된다** — 못 알아들은 말에 파일이 생기는 것이
// 제일 나쁘다.
{
  const r = await 띄우기(['ax비전 선포 내용들 정리해서 만들어줘', '파일을 더 잘게 나눠줘']);
  check('못 알아들은 답에 실행하지 않는다', !existsSync(join(r.root, 만들파일)),
    '이게 깨지면 오타 한 번에 파일이 생긴다');
  check('계획을 다시 낸다고 말해 준다', /계획을 다시 냅니다/.test(r.out));
  check('고친 계획이 다시 나온다', /고친 계획 한 단계/.test(r.out));
  rmSync(r.root, { recursive: true, force: true });
  rmSync(r.home, { recursive: true, force: true });
}

trace('5-안겹친요청');
// ── 겹치지 않은 요청에는 창이 안 뜬다 ───────────────────────────────────
//
// 이 프로젝트는 승인 게이트 대신 되돌리기로 가기로 했다. 창이 아무 때나 뜨면
// 그 결정을 갉아먹는다. 그래서 '안 뜨는 것' 도 같은 무게로 잰다.
{
  const r = await 띄우기(['비전선언문 파일 하나 만들어줘']);
  check('그냥 만들어 달라는 말에는 승인 창이 안 뜬다', !/이대로 진행할까요\?/.test(r.out));
  check('계획 상자도 안 뜬다', !/┌ 계획/.test(r.out));
  rmSync(r.root, { recursive: true, force: true });
  rmSync(r.home, { recursive: true, force: true });
}

srv.close();

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n계획 승인 검사  ${D}(계획 → 승인 → 실행이 ⏎ 하나로 이어지는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
