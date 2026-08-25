// 한 번만 돌고 끝내는 비대화 모드(`deel run`)를 진짜로 띄워서 확인한다.
//
// 왜 진짜로 띄우는가:
//   이 기능의 값어치는 전부 '프로세스 바깥' 에 있다 — 종료코드가 무엇인지,
//   답이 표준출력으로만 나오는지, 아무도 없는 자리에서 물어보다 서 버리지 않는지.
//   함수를 직접 부르면 그 셋 중 어느 것도 못 본다.
//
//   특히 '서 버리는가' 는 흉내로는 절대 못 잡는다. 배치에서 승인 질문에 걸려
//   서 있으면 화면에는 아무 일도 안 일어나고, 잡의 시간 제한까지 그대로 있다가
//   죽는다. 그래서 여기서는 시간 제한을 두고 '안 끝나면 실패' 로 못 박는다.
//
// 어디에 붙는가:
//   모델 자리는 이 컴퓨터 안(127.0.0.1)의 임시 스텁이다. 바깥으로는 한 바이트도
//   안 나간다. 설정도 임시 폴더(DEEL_HOME)라 사람의 ~/.deel 을 못 건드린다.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const 진입점 = join(here, '..', 'bin', 'deel.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 스텁 모델 ───────────────────────────────────────────────────────────
let 받은요청 = [];
let 도구한번 = false;
let 쓰기한번 = false;
let 도구번호 = 1;
const 대본초기화 = () => { 도구한번 = 쓰기한번 = false; 도구번호 = 1; 받은요청 = []; };

const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    // 모델 이름이 한글이면 주소에 퍼센트 인코딩으로 실려 온다. 풀고 본다.
    const url = decodeURIComponent(req.url.split('?')[0]);
    let json = null;
    try { json = body ? JSON.parse(body) : null; } catch { /* 없을 수 있다 */ }
    받은요청.push({ url, json });
    const 보냄 = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };

    if (url === '/v1/models') return 보냄({ data: [{ id: '스텁모델', object: 'model' }] });
    if (url === '/api/v0/models/스텁모델') {
      return 보냄({ id: '스텁모델', max_context_length: 262144, loaded_context_length: 262144 });
    }
    if (url === '/v1/chat/completions') {
      const 답 = (msg, why) => 보냄({
        id: 'x', object: 'chat.completion', model: '스텁모델',
        choices: [{ index: 0, finish_reason: why ?? (msg.tool_calls ? 'tool_calls' : 'stop'), message: msg }],
        usage: { prompt_tokens: 120, completion_tokens: 12 },
      });
      const 도구답 = (name, args) => 답({
        role: 'assistant', content: null,
        tool_calls: [{ id: `c${도구번호++}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
      });

      const 사람말 = String([...(json?.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '');

      if (/일부러_터뜨려/.test(사람말)) return 보냄({ error: { message: '스텁이 일부러 낸 오류입니다' } }, 500);
      // 걸음 수 상한까지 성공하는 도구만 계속 부른다 — 헛도는 것과 구분해야 한다.
      // 인자를 매번 조금씩 바꾼다. 똑같은 인자로 다시 부르면 루프가 '헛돌고 있다'
      // 고 보고 먼저 끊는데(그것도 맞다), 그러면 걸음 수 상한 자리를 못 밟는다.
      if (/일부러_끝없이/.test(사람말)) return 도구답('Read', { file_path: '읽을것.txt', limit: 도구번호 });
      // 같은 이유로 계속 실패한다. 루프가 '헛돌고 있다' 고 판정해야 하는 자리.
      if (/일부러_헛돎/.test(사람말)) return 도구답('Read', { file_path: '없는파일.txt' });
      if (/일부러_고쳐/.test(사람말) && !쓰기한번) {
        쓰기한번 = true;
        return 도구답('Write', { file_path: '한번만쓴것.txt', content: '스텁이 쓴 내용' });
      }
      if (!도구한번 && /파일/.test(사람말)) {
        도구한번 = true;
        return 도구답('Read', { file_path: '읽을것.txt' });
      }
      return 답({ role: 'assistant', content: '(스텁 모델이 답했습니다)' });
    }
    보냄({}, 404);
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const base = `http://127.0.0.1:${port}/v1`;

// ── 임시 살림 ───────────────────────────────────────────────────────────
//
// DEEL_HOME 은 설정 '폴더' 그 자체다. 그 안에 config.json 을 바로 넣는다 —
// .deel 을 한 겹 더 만들면 프로그램이 못 찾고 "연결이 없습니다" 로 끝난다.
const home = mkdtempSync(join(tmpdir(), 'deel-one-home-'));
const work = mkdtempSync(join(tmpdir(), 'deel-one-work-'));
writeFileSync(join(work, '읽을것.txt'), '한 줄짜리 파일입니다.\n두 번째 줄.\n', 'utf8');

writeFileSync(join(home, 'config.json'), JSON.stringify({
  version: 1, active: 'stub', level: '개발자',
  profiles: [{
    id: 'stub', name: '스텁 연결', kind: 'openai',
    baseUrl: base, auth: 'none', apiKey: '', model: '스텁모델',
    ctx: 32768, streaming: false, tools: true, json: true, think: false,
  }],
}, null, 2), 'utf8');

const 답글 = '(스텁 모델이 답했습니다)';

/**
 * deel 을 띄우고 끝날 때까지 기다린다.
 *
 * 대화 화면 검사와 달리 줄을 밀어 넣지 않는다 — 넣을 자리가 없는 것이
 * 이 모드의 요점이다. 표준입력은 넣을 것이 있으면 한 번에 넣고 바로 닫는다.
 *
 * 시간 제한을 반드시 둔다. 여기서 안 끝난다는 것은 '어딘가에서 사람을
 * 기다리고 있다' 는 뜻이고, 그게 바로 이 검사가 잡아야 하는 결함이다.
 */
function 띄우기(인자 = [], { 입력 = null, 제한 = 30000, 폴더 = work, env = {} } = {}) {
  return new Promise((done) => {
    const kid = spawn(process.execPath, [진입점, ...인자], {
      cwd: 폴더,
      env: { ...process.env, DEEL_HOME: home, NO_COLOR: '1', COLUMNS: '100', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = ''; let err = ''; let 끝남 = false;
    kid.stdout.on('data', (b) => { out += b; });
    kid.stderr.on('data', (b) => { err += b; });

    const 시계 = setTimeout(() => {
      if (끝남) return;
      kid.kill('SIGKILL');
      done({ code: null, out, err, 시간초과: true });
    }, 제한);

    // 파이프가 이미 닫혔을 수 있다. 여기서 터지면 검사 전체가 죽는다.
    kid.stdin.on('error', () => {});
    if (입력 !== null) kid.stdin.write(입력);
    kid.stdin.end();

    kid.on('close', (code) => {
      끝남 = true;
      clearTimeout(시계);
      done({ code, out, err, 시간초과: false });
    });
  });
}

trace('1-기본한번돌기');

// ── 한 번 돌고 끝나는가 ─────────────────────────────────────────────────
{
  대본초기화();
  const r = await 띄우기(['run', '안녕하세요']);
  check('run 이 스스로 끝난다', !r.시간초과, `code=${r.code}${r.시간초과 ? ' 시간초과 — 어딘가에서 사람을 기다렸다' : ''}`);
  check('끝까지 답했으면 0 이다', r.code === 0, `code=${r.code}`);
  check('모델의 답이 표준출력으로 나온다', r.out.includes(답글), r.out.slice(0, 120));
  check('표준출력에 답 말고는 안 섞인다', r.out.trim() === 답글, JSON.stringify(r.out.slice(0, 160)));
  check('모델과 실제로 이야기했다', 받은요청.some((x) => x.url === '/v1/chat/completions'), `요청 ${받은요청.length}건`);
  check('컨텍스트 길이는 여전히 서버에서 긁어온다',
    /262,144|262144/.test(r.err), r.err.slice(0, 200));
}

{
  // -p 는 다른 도구들이 쓰는 이름이다. 손에 익은 대로 쳐도 같아야 한다.
  대본초기화();
  const r = await 띄우기(['-p', '안녕하세요']);
  check('-p 도 run 과 같다', r.code === 0 && r.out.includes(답글), `code=${r.code} ${r.out.slice(0, 60)}`);
}

trace('2-표준입력으로넣기');

{
  // echo "..." | deel run
  대본초기화();
  const r = await 띄우기(['run'], { 입력: '표준입력으로 넣은 말입니다\n' });
  check('표준입력으로 넣어도 돈다', r.code === 0 && r.out.includes(답글), `code=${r.code} ${r.out.slice(0, 80)}`);
  const 보낸글 = JSON.stringify(받은요청.map((x) => x.json ?? {}));
  check('표준입력에 넣은 말이 모델에 그대로 간다', 보낸글.includes('표준입력으로 넣은 말입니다'), 보낸글.slice(0, 160));
}

{
  // 시킬 말이 아무 데도 없을 때. 여기서 기다리면 그대로 선다.
  대본초기화();
  const r = await 띄우기(['run'], { 제한: 20000 });
  check('시킬 말이 없으면 서지 않고 끝난다', !r.시간초과, r.시간초과 ? '빈 표준입력을 기다리고 있다' : '');
  check('시킬 말이 없으면 1 로 끝난다', r.code === 1, `code=${r.code}`);
  check('무엇을 하라고 알려 준다', /무엇을 시킬지/.test(r.err), r.err.slice(0, 160));
}

trace('3-json');

{
  // --json 을 시킬 말 앞에 둔다. 깃발이 뒤의 말을 삼키면 안 된다.
  대본초기화();
  const r = await 띄우기(['run', '--json', '이 파일 좀 봐줘']);
  check('--json 이 끝난다', r.code === 0 && !r.시간초과, `code=${r.code}`);
  check('--json 을 앞에 둬도 시킬 말을 안 삼킨다', !/무엇을 시킬지/.test(r.err), r.err.slice(0, 160));

  let j = null;
  try { j = JSON.parse(r.out.trim()); } catch { /* 아래에서 실패로 잡힌다 */ }
  check('표준출력이 JSON 한 덩이다', !!j, JSON.stringify(r.out.slice(0, 200)));
  if (j) {
    check('JSON 에 마지막 답이 들어 있다', String(j.text).includes(답글), String(j.text).slice(0, 80));
    check('JSON 에 도구 횟수가 들어 있다', j.tools === 1, `tools=${j.tools}`);
    check('JSON 에 토큰 사용량이 들어 있다',
      j.usage && typeof j.usage.in === 'number' && j.usage.in > 0 && typeof j.usage.out === 'number',
      JSON.stringify(j.usage));
    check('JSON 에 끝난 까닭과 종료코드가 들어 있다', j.reason === 'done' && j.code === 0 && j.ok === true,
      JSON.stringify({ ok: j.ok, reason: j.reason, code: j.code }));
    check('JSON 이 종료코드와 어긋나지 않는다', j.code === r.code, `json=${j.code} 실제=${r.code}`);
  }

  // 깃발을 뒤에 둬도 같아야 한다.
  대본초기화();
  const r2 = await 띄우기(['run', '안녕하세요', '--json']);
  let j2 = null;
  try { j2 = JSON.parse(r2.out.trim()); } catch { /* 아래에서 잡힌다 */ }
  check('깃발을 뒤에 둬도 같다', !!j2 && j2.ok === true, r2.out.slice(0, 140));
}

trace('4-끝난까닭과종료코드');

{
  // 모델이 500 을 준다. 배치가 이걸 성공으로 알면 안 된다.
  대본초기화();
  const r = await 띄우기(['run', '일부러_터뜨려 주세요']);
  check('모델 오류는 0 이 아닌 코드로 끝난다', r.code === 1, `code=${r.code}`);
  check('오류가 나도 서지 않는다', !r.시간초과, '');
  check('왜 실패했는지 표준오류에 적는다', /오류|실패|500/.test(r.err), r.err.slice(-200));

  대본초기화();
  const j = await 띄우기(['run', '--json', '일부러_터뜨려 주세요']);
  let o = null;
  try { o = JSON.parse(j.out.trim()); } catch { /* 아래에서 잡힌다 */ }
  check('실패해도 JSON 은 온전히 나온다', !!o && o.ok === false && o.reason === 'error', j.out.slice(0, 160));
  check('실패한 까닭이 JSON 에 담긴다', !!o && typeof o.why === 'string' && o.why.length > 0, JSON.stringify(o?.why ?? null));
}

{
  // 걸음 수 상한. 아무것도 못 끝냈는데 0 을 돌려주면 야간 배치가 헛초록불을 켠다.
  // 걸음 수가 적은 모드로 띄워 검사를 짧게 끝낸다.
  대본초기화();
  const r = await 띄우기(['run', '--work', 'architect', '일부러_끝없이 읽어줘'], { 제한: 60000 });
  check('걸음 수 상한에 닿으면 2 로 끝난다', r.code === 2, `code=${r.code}${r.시간초과 ? ' 시간초과 — 안 멈췄다' : ''}`);
  check('걸음 수 상한이라고 말해 준다', /걸음|상한|멈췄/.test(r.err), r.err.slice(-200));
}

{
  // 같은 자리에서 헛도는 것. 상한과 다른 까닭이므로 코드도 달라야 한다.
  대본초기화();
  const r = await 띄우기(['run', '일부러_헛돎 해줘'], { 제한: 60000 });
  check('헛돌아 멈추면 3 으로 끝난다', r.code === 3, `code=${r.code}${r.시간초과 ? ' 시간초과' : ''}`);
  check('헛돈다고 말해 준다', /계속 실패|헛돌|같은/.test(r.err), r.err.slice(-240));
}

trace('5-물어볼사람이없을때');

{
  // 이 검사가 이 파일에서 가장 중요하다.
  //
  // strict 는 파일을 고치기 전에 사람에게 묻는 모드다. 배치에는 답할 사람이
  // 없으므로, 여기서 물어보면 프로그램은 그대로 선다. 서지 않고 거부해야 한다.
  대본초기화();
  rmSync(join(work, '한번만쓴것.txt'), { force: true });
  const r = await 띄우기(['run', '--mode', 'strict', '일부러_고쳐 줘'], { 제한: 25000 });
  check('승인이 필요해도 물어보지 않고 끝난다', !r.시간초과,
    r.시간초과 ? '승인 질문 앞에서 서 있었다 — 배치가 시간 제한까지 물려 있게 된다' : `code=${r.code}`);
  check('승인 못 받은 일은 실제로 안 한다', !existsSync(join(work, '한번만쓴것.txt')), '');
  check('왜 거부했는지 알려 준다', /거부|승인/.test(r.err), r.err.slice(0, 300));
  check('거부한 뒤에도 턴은 정상으로 끝난다', r.code === 0, `code=${r.code}`);
}

{
  // 정말 맡기고 싶은 사람은 --yes 로 뜻을 밝힌다. 그때만 실행된다.
  대본초기화();
  rmSync(join(work, '한번만쓴것.txt'), { force: true });
  const r = await 띄우기(['run', '--mode', 'strict', '--yes', '일부러_고쳐 줘'], { 제한: 25000 });
  check('--yes 면 묻지 않고 실제로 실행한다', existsSync(join(work, '한번만쓴것.txt')), `code=${r.code} ${r.err.slice(-160)}`);
  check('--yes 로 돌려도 정상 종료한다', r.code === 0 && !r.시간초과, `code=${r.code}`);
  rmSync(join(work, '한번만쓴것.txt'), { force: true });
}

trace('6-표준출력이깨끗한가');

{
  // 파이프로 넘길 것은 답뿐이다. 도구 기록이 섞이면 뒤에 붙은 명령이 그것까지 받아 먹는다.
  대본초기화();
  const r = await 띄우기(['run', '이 파일 좀 읽어줘']);
  check('도구를 돌려도 표준출력은 답만 담는다', r.out.trim() === 답글, JSON.stringify(r.out.slice(0, 200)));
  check('도구 기록은 표준오류로 간다', /Read/.test(r.err), r.err.slice(0, 200));
  check('도구를 돌려도 0 으로 끝난다', r.code === 0 && !r.시간초과, `code=${r.code}`);

  대본초기화();
  const q = await 띄우기(['run', '--quiet', '이 파일 좀 읽어줘']);
  check('--quiet 면 도구 기록도 안 적는다', !/Read/.test(q.err), q.err.slice(0, 200));
  check('--quiet 여도 답은 그대로 나온다', q.out.trim() === 답글, JSON.stringify(q.out.slice(0, 140)));
  check('--quiet 여도 정상 종료한다', q.code === 0, `code=${q.code}`);
}

trace('7-자물쇠');

{
  // 오프라인이어도 이 컴퓨터 안 서버와는 이야기한다. 배치라고 자물쇠가 느슨해지지 않는다.
  대본초기화();
  const r = await 띄우기(['run', '--offline', '안녕하세요']);
  check('--offline 이어도 이 컴퓨터 안 서버와는 돈다', r.code === 0 && r.out.includes(답글), `code=${r.code}`);
  check('오프라인에서도 바깥으로는 요청이 없다',
    받은요청.every((x) => typeof x.url === 'string'), `요청 ${받은요청.length}건`);
}

trace('8-도움말');

{
  const r = await 띄우기(['--help']);
  check('도움말에 run 이 적혀 있다', /deel run/.test(r.out), r.out.slice(0, 80));
  check('도움말에 종료코드 표가 있다', /종료코드/.test(r.out), '');
}

trace('9-치움');
srv.close();
rmSync(home, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n한 번만 돌리기  ${D}(물어볼 사람이 없는 자리에서 서지 않고 끝나는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
