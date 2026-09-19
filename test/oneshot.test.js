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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const 진입점 = join(here, '..', 'bin', 'deel.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
// 이 기계에서 못 재는 것. 초록으로 세지 않고 못 쟀다고 적는다.
const 건너뜀 = [];

// ── 스텁 모델 ───────────────────────────────────────────────────────────
let 받은요청 = [];
let 도구한번 = false;
let 쓰기한번 = false;
let 도구번호 = 1;
let 한계알린적 = false;
let 자리없다한횟수 = 0;
let 되물은적 = false;
const 대본초기화 = () => {
  도구한번 = 쓰기한번 = 한계알린적 = 되물은적 = false;
  도구번호 = 1; 받은요청 = [];
};

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
        /*
         * 캐시 수치를 **실제로** 실어 준다.
         *
         * 안 실으면 cacheRead·cacheWrite 가 늘 0 이고, `typeof 0 === 'number'`
         * 는 언제나 참이라 아래 검사가 **캐시 셈을 통째로 지워도 통과한다.**
         * 1.12 의 간판 기능을 지키는 유일한 끝-끝 검사가 그런 모양이면
         * 없는 것과 같다.
         */
        usage: {
          prompt_tokens: 120,
          completion_tokens: 12,
          prompt_tokens_details: { cached_tokens: 90 },
          cache_creation_input_tokens: 20,
        },
      });
      const 도구답 = (name, args) => 답({
        role: 'assistant', content: null,
        tool_calls: [{ id: `c${도구번호++}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
      });

      const 사람말 = String([...(json?.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '');

      if (/일부러_터뜨려/.test(사람말)) return 보냄({ error: { message: '스텁이 일부러 낸 오류입니다' } }, 500);

      /*
       * 답을 붙들고 있는 창구. Ctrl+C 를 재려면 **끊을 것이 돌고 있어야** 한다.
       * 5초는 넉넉히 길고, 검사는 그보다 훨씬 먼저 끊으므로 실제로 5초를
       * 기다리는 일은 없다.
       */
      if (/일부러_느리게/.test(사람말)) {
        const 늦게 = setTimeout(() => { try { 답({ role: 'assistant', content: '늦게 왔습니다' }); } catch { /* 이미 끊겼다 */ } }, 5000);
        res.on('close', () => clearTimeout(늦게));
        return undefined;
      }

      /*
       * 안 하겠다고 하는 답. 이 규격은 거절을 `content` 가 아니라 `refusal`
       * 로 준다 — 도구 호출도 없어서, **빈 답과 겉모습이 같다.**
       */
      if (/일부러_거절/.test(사람말)) {
        return 답({ role: 'assistant', content: null, refusal: '그 일은 도와드릴 수 없습니다.' });
      }

      /*
       * ── 화면이 사실대로 말해야 하는 네 자리 ──────────────────────────
       *
       * 대화창은 넷 다 적어 주는데 `deel run` 은 아무 말도 안 했다.
       * 특히 첫째 것은 **종료코드까지** 0 이었다 — 반쪽짜리 답이 파이프
       * 뒤 스크립트로 온전한 답인 척 넘어갔다.
       */
      // 알맹이는 주고 끝났다는 조각은 한 번도 안 준 채 곱게 닫는다.
      if (/일부러_말없이끊김/.test(사람말)) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"여기까지 쓰다가 "}}]}\n\n');
        res.write('data: {"choices":[{"delta":{"content":"끊"}}]}\n\n');
        return res.end();
      }
      // 언제나 상한에서 잘린다. 루프가 상한을 올려 다시 불러도 마찬가지다.
      if (/일부러_길이잘림/.test(사람말)) {
        return 답({ role: 'assistant', content: '여기까지 쓰다가 끊' }, 'length');
      }
      // 서버가 제 한계를 말투로 알려 준다. 그걸 읽고 맞춰 다시 부르는 자리.
      if (/일부러_한계알림/.test(사람말)) {
        if (!한계알린적) {
          한계알린적 = true;
          return 보냄({ error: { message: "This model's maximum context length is 8192 tokens, however you requested 41003 tokens." } }, 400);
        }
        return 답({ role: 'assistant', content: 답글 });
      }
      /*
       * 자리가 다 차서 두 번 거절한다.
       *
       * 한 번만 거절하면 배우기(learned)로 끝난다 — 그건 위에서 이미 잰다.
       * 두 번째 거절이 있어야 「접어도 안 들어간다」 가 되고, 그때 비우기가
       * 돈다. 비운 뒤에도 시킨 말은 못 박혀 그대로 실려 오므로 이 갈래는
       * 그 다음 부름에서도 맞는다 — 맞아야 맞는 것이다.
       */
      if (/일부러_자리없음/.test(사람말)) {
        if (자리없다한횟수 < 2) {
          자리없다한횟수++;
          return 보냄({ error: { message: "This model's maximum context length is 8192 tokens, however you requested 41003 tokens." } }, 400);
        }
        return 답({ role: 'assistant', content: 답글 });
      }
      // 시킨 일을 안 하고 되묻고 끝내려 한다. 루프가 한 번 되민다.
      if (/일부러_되물음/.test(사람말)) {
        if (!되물은적) {
          되물은적 = true;
          return 답({ role: 'assistant', content: '어떤 작업을 원하시는지 말씀해 주세요.' });
        }
        return 답({ role: 'assistant', content: 답글 });
      }
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
      // 뒤에서 도는 명령을 들여다보는 자리. 없는 번호라 결과는 오류로 오지만,
      // 여기서 재려는 것은 화면에 찍히는 **이름표**라 상관없다.
      if (!도구한번 && /일부러_일감/.test(사람말)) {
        도구한번 = true;
        return 도구답('Jobs', { 번호: 7 });
      }
      // 인자 이름을 영어로 보내는 모델. 화면 이름표가 그것도 읽어야 한다 —
      // 안 읽으면 도구는 제대로 도는데 기록에는 `Jobs()` 만 남는다.
      if (!도구한번 && /일부러_영문일감/.test(사람말)) {
        도구한번 = true;
        return 도구답('Jobs', { job: 5 });
      }
      /*
       * ── 답의 모양을 못 박은 자리 ─────────────────────────────────────
       *
       * 다시 시키는 쪽을 알아보는 것이 요점이다. 우리가 붙이는 되물음 글에는
       * 「방금 낸 답이 아래에서 안 맞았습니다」 가 들어 있다. 그걸 보고 스텁이
       * 두 번째 답을 낸다 — 실제로 되묻고 있는지를 그렇게 잰다.
       */
      const 다시시킴 = /방금 낸 답이 아래에서 안 맞았습니다/.test(사람말);
      // 되물을 때는 마지막 사람 말이 되물음 글로 바뀐다. 원래 시킨 말은 그
      // 앞에 그대로 남아 있으므로, 어떤 갈래인지는 대화 전체에서 찾는다.
      const 시킨말들 = (json?.messages ?? []).filter((m) => m.role === 'user').map((m) => String(m.content ?? '')).join('\n');

      // 깨끗한 JSON 하나. 이게 되는 것이 기본이다.
      if (/일부러_스키마깨끗/.test(시킨말들)) {
        return 답({ role: 'assistant', content: '{"이름":"홍길동","나이":33,"표":["가","나"]}' });
      }
      // 울타리와 인사말을 두르고 낸다. 멀쩡한 답을 버리면 안 된다.
      if (/일부러_스키마울타리/.test(시킨말들)) {
        return 답({
          role: 'assistant',
          content: '네, 아래와 같습니다.\n\n\u0060\u0060\u0060json\n{"이름":"김","나이":1,"표":[]}\n\u0060\u0060\u0060\n\n확인해 주세요.',
        });
      }
      // 처음엔 틀리고, 되물으면 맞게 낸다. 되묻는 길이 진짜로 도는지 재는 자리.
      if (/일부러_스키마한번틀림/.test(시킨말들)) {
        if (다시시킴) return 답({ role: 'assistant', content: '{"이름":"둘째","나이":2,"표":[]}' });
        return 답({ role: 'assistant', content: '{"이름":123,"나이":"둘"}' });
      }
      // 되물어도 계속 틀린다. 여기서 0 으로 끝내면 안 된다.
      if (/일부러_스키마계속틀림/.test(시킨말들)) {
        return 답({ role: 'assistant', content: '{"나이":-5}' });
      }
      /*
       * 첫 답은 모양이 틀리고, **되물음은 HTTP 오류로 죽는다.**
       *
       * 이 갈래가 없으면 되물음이 터지는 자리를 아무도 안 잰다 — 터진 까닭이
       * 「모양이 안 맞는다」 로 덮여 사라져도 검사는 초록이다.
       */
      if (/일부러_되물음터짐/.test(시킨말들)) {
        if (다시시킴) return 보냄({ error: { message: '스텁이 되물음에서 낸 500 입니다' } }, 500);
        return 답({ role: 'assistant', content: '{"나이":-5}' });
      }
      // JSON 이 아예 아니다.
      if (/일부러_스키마JSON아님/.test(시킨말들)) {
        return 답({ role: 'assistant', content: '죄송합니다, 그 정보는 문서에 없습니다.' });
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

/**
 * 띄운 뒤 **돌고 있는 중에** 신호를 보내고, 그 프로그램이 몇으로 끝나는지 본다.
 *
 * 정해 둔 만큼 자고 보내면 느린 판에서는 아직 서버에 닿지도 않은 프로그램을
 * 끊게 된다 — 그건 이 검사가 재려던 자리가 아니다. 그래서 「모델을 부르기
 * 시작했다」 는 증거(스텁이 그 한마디를 받은 것)를 보고 나서 보낸다.
 */
function 끊어보기(인자, { 보낼신호 = 'SIGINT', 제한 = 30000, 닿았나 } = {}) {
  return new Promise((done) => {
    const kid = spawn(process.execPath, [진입점, ...인자], {
      cwd: work,
      env: { ...process.env, DEEL_HOME: home, NO_COLOR: '1', COLUMNS: '100' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = ''; let err = ''; let 끝남 = false; let 보냈나 = false;
    kid.stdout.on('data', (b) => { out += b; });
    kid.stderr.on('data', (b) => { err += b; });
    kid.stdin.on('error', () => {});
    kid.stdin.end();

    const 시계 = setTimeout(() => {
      if (끝남) return;
      kid.kill('SIGKILL');
      done({ code: null, out, err, 시간초과: true, 보냈나 });
    }, 제한);

    // 도는 중인지 20ms 마다 본다 — 자는 대신 본다.
    const 지켜보기 = setInterval(() => {
      if (끝남 || 보냈나) return;
      if (!닿았나()) return;
      보냈나 = true;
      clearInterval(지켜보기);
      try { kid.kill(보낼신호); } catch { /* 이미 죽었다 */ }
    }, 20);
    지켜보기.unref?.();

    kid.on('close', (code) => {
      끝남 = true;
      clearTimeout(시계);
      clearInterval(지켜보기);
      done({ code, out, err, 시간초과: false, 보냈나 });
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

{
  /*
   * 일감 번호가 이름표에 남는가.
   *
   * `deel run` 의 출력은 곧 근거로 쓰인다 — 야간 배치가 무엇을 했는지 나중에
   * 이 줄로 되짚는다. 그런데 Jobs 는 보여줄 경로도 명령도 없어서 그냥 두면
   * `Jobs()` 만 여러 줄 남는다. 서버를 서넛 띄워 놓은 뒤에는 그 줄들로
   * 무엇을 본 것인지 가릴 방법이 없다. 번호가 곧 그 일감의 이름이다.
   */
  대본초기화();
  const r = await 띄우기(['run', '일부러_일감 을 좀 봐줘']);
  check('일감 번호가 이름표에 남는다', /Jobs\(7번\)/.test(r.err),
    (r.err.match(/Jobs\([^)]*\)|Jobs/) ?? ['(안 나옴)'])[0]);

  // 모델이 영문 이름으로 보내도 마찬가지다. 이름 고르기가 jobs.js 한 군데에만
  // 있으므로, 도구가 알아듣는 이름은 화면도 알아듣는다.
  대본초기화();
  const r2 = await 띄우기(['run', '일부러_영문일감 을 좀 봐줘']);
  check('영문 이름으로 와도 이름표에 번호가 남는다', /Jobs\(5번\)/.test(r2.err),
    (r2.err.match(/Jobs\([^)]*\)|Jobs/) ?? ['(안 나옴)'])[0]);
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

trace('5-3-끊김');

/*
 * ── 도중에 끊긴 것도 제 번호로 끝나야 한다 (4) ─────────────────────────
 *
 * EXIT 표에 여섯 자리가 있는데 4(aborted)만 아무 검사도 안 밟고 있었다.
 * 이 자리가 왜 값진가: `deel -p` 는 배치·CI 안에서 돌고, 그 위에서 사람이나
 * 상위 잡이 Ctrl+C 를 보내는 일이 실제로 있다. 그때 0 으로 끝나면 뒤따르는
 * 스크립트는 「다 됐다」 로 읽는다. 아무 답도 안 받았는데.
 *
 * 신호는 유닉스 이야기다. 윈도우에는 진짜 신호가 없어서 Node 의 kill 은
 * 그냥 프로세스를 없앤다 — 우리 SIGINT 처리기가 아예 안 돌아서 4 가 나올
 * 수가 없다. 못 재는 자리는 **못 쟀다고 적는다.**
 */
if (process.platform === 'win32') {
  건너뜀.push('윈도우에는 진짜 SIGINT 가 없어 「끊기면 4 로 끝난다」 를 못 쟀다');
} else {
  대본초기화();
  const 받기시작 = () => 받은요청.some((x) => x.url === '/v1/chat/completions');
  const r = await 끊어보기(['run', '일부러_느리게 답해줘'], { 닿았나: 받기시작, 제한: 30000 });
  check('끊을 것이 정말 돌고 있을 때 보냈다', r.보냈나 === true, JSON.stringify({ 보냈나: r.보냈나 }));
  check('★★ 도중에 끊기면 4 로 끝난다', r.code === 4,
    `code=${r.code}${r.시간초과 ? ' 시간초과 — 신호를 듣고도 안 끝났다' : ''}`);
  check('★ 0 으로는 절대 안 끝난다 — 뒤 스크립트가 다 된 줄 안다', r.code !== 0, `code=${r.code}`);
}

/*
 * ── ★★ 모델이 안 하겠다고 하면 0 으로 끝내지 않는다 ────────────────────
 *
 * 거절한 답은 **아무 일도 안 한 답**이다. 그런데 도구 호출이 없다는 것 말고는
 * 짧은 답과 겉모습이 같아서, 여태 그냥 0 으로 끝났다 — 야간 배치가 헛초록불을
 * 켜고 그 다음 단계로 넘어갔다.
 *
 * 오류(1)와도 갈라 둔다. 고칠 자리가 다르다 — 오류는 연결이나 열쇠를 보는
 * 일이고, 거절은 시킨 말을 바꾸는 일이다.
 *
 * 그리고 **되밀지 않는다.** 거절한 답에는 도구 호출이 없어서 루프가
 * 「읽기만 하고 끝내려 한다」 로 읽고 한 번 더 밀었고, 그게 걸음 수만큼
 * 되풀이됐다. 한 번 거절당할 요청 하나가 열 번 나갔다 — 그 열 번이 분당
 * 한도를 밀어 올려 그 다음 진짜 요청이 429 를 받는다.
 */
{
  대본초기화();
  const r = await 띄우기(['run', '일부러_거절 해줘'], { 제한: 60000 });
  check('★★ 거절은 6 으로 끝난다', r.code === 6, `code=${r.code}${r.시간초과 ? ' 시간초과' : ''}`);
  check('★★ 거절이라고 말해 준다', /거절|declined/i.test(r.err + r.out), (r.err + r.out).slice(-240));

  /*
   * ★ 딱 한 번만 부른다.
   *
   * 여기가 이 검사의 요점이다. 화면 말은 고쳤는데 되밀기가 남아 있으면
   * 사람이 보는 것은 그대로인데 요금만 몇 배가 된다.
   */
  const 부른수 = 받은요청.filter((x) => x.url === '/v1/chat/completions').length;
  check('★★ 되밀지 않는다 — 딱 한 번만 부른다', 부른수 === 1, `${부른수}번`);
}

{
  // --json 으로도 같은 것을 말해야 한다. 스크립트는 화면이 아니라 이걸 읽는다.
  대본초기화();
  const r = await 띄우기(['run', '--json', '일부러_거절 해줘'], { 제한: 60000 });
  const j = (() => { try { return JSON.parse(r.out.trim().split('\n').pop()); } catch { return null; } })();
  check('★ JSON 에도 거절이 담긴다', j?.reason === 'refusal' && j?.code === 6,
    JSON.stringify({ reason: j?.reason, code: j?.code }));
  check('★ JSON 이 종료코드와 안 어긋난다', j?.code === r.code, `json=${j?.code} 실제=${r.code}`);

  /*
   * ★★ 모델이 **뭐라고 하면서** 거절했는지도 담아야 한다.
   *
   * 이 규격은 거절 글을 조각으로 안 흘리고 맨 끝에 한 번에 준다. 그래서
   * 담지 않으면 화면에도 파이프 뒤에도 아무 글이 안 남고 「거절당했습니다」
   * 한 줄뿐이다 — 무엇을 고쳐 다시 물어야 할지 알 길이 없고, 사람은 같은
   * 말을 그대로 다시 친다. 요금은 두 배가 되고 결과는 똑같다.
   */
  check('★★ 거절한 말도 같이 담는다', /도와드릴 수 없습니다/.test(String(j?.text ?? '')),
    String(j?.text ?? '').slice(0, 40));

  /*
   * 그리고 캐시 수치도 같이 내놓는다. `in` 은 이름을 그대로 두고 (파이프 뒤
   * 스크립트가 이미 쓰고 있다) **보낸 것 전체**는 이름을 새로 붙여 더한다.
   */
  /*
   * ★★ 값을 **숫자로** 본다. `typeof === 'number'` 는 0 도 통과시키는데,
   * 서버가 아무것도 안 줘도 0 이 나오므로 그 검사는 아무것도 안 지킨다.
   */
  check('★★ 캐시에 맞은 몫을 서버 값 그대로 내놓는다', j?.usage?.cacheRead === 90,
    JSON.stringify(j?.usage));
  check('★★ 캐시에 쓴 몫도 따로 내놓는다', j?.usage?.cacheWrite === 20,
    JSON.stringify(j?.usage));
  /*
   * 이 규격은 prompt_tokens 가 **이미 합계**다. 캐시 몫을 또 더하면 두 벌로
   * 센다 — 규격마다 갈라야 하는 자리다(backend/adapter.js 의 보낸토큰).
   */
  check('★★ OpenAI 꼴에서는 캐시 몫을 또 더하지 않는다', j?.usage?.prompt === 120,
    JSON.stringify(j?.usage));
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

{
  /*
   * ── 거부 안내는 **기본 모드에서도** 붙어야 한다 (8회차 그밖 한번쓰기2) ──
   *
   * 안내를 붙일지를 `session.mode !== 'auto'` 로 골랐는데 `deel run` 의 기본
   * 모드가 바로 auto 다. 그래서 이 안내가 붙는 판이 하나도 없었다 — confirm 은
   * 모드를 안 보고 `--yes` 가 아니면 무조건 거부하는데, 모델은 왜 거부됐는지
   * 모른 채 같은 호출을 되풀이하고 걸음 수만 태운다.
   */
  대본초기화();
  const r = await 띄우기(['run', '아무 말이나']);
  const 보낸사람말 = JSON.stringify((받은요청.find((x) => x.url === '/v1/chat/completions')?.json?.messages ?? [])
    .filter((m) => m.role === 'user').map((m) => m.content));
  check('★★ 기본 모드에서도 거부 안내를 모델에게 미리 알린다', /비대화 모드다/.test(보낸사람말),
    보낸사람말.slice(0, 160));
  check('★ 안내를 붙여도 평범하게 끝난다', r.code === 0, `code=${r.code}`);

  대본초기화();
  const y = await 띄우기(['run', '--yes', '아무 말이나']);
  const 보낸사람말2 = JSON.stringify((받은요청.find((x) => x.url === '/v1/chat/completions')?.json?.messages ?? [])
    .filter((m) => m.role === 'user').map((m) => m.content));
  check('★ --yes 면 거부 안내를 안 붙인다 — 거부하지 않으니까', !/비대화 모드다/.test(보낸사람말2),
    보낸사람말2.slice(0, 160));
  check('--yes 로도 평범하게 끝난다', y.code === 0, `code=${y.code}`);
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

trace('8.5-사실대로-말하는가');

/*
 * ── 잘린 답이 온전한 답인 척 파이프 뒤로 넘어가던 것 ────────────────────
 *
 * 한 방 실행은 대화창과 다른 자리다. 사람이 안 보고, 그 출력이 곧바로
 * 다음 스크립트의 입력이 된다. 그런데 여기서 네 가지 소식을 **아예 안
 * 보고 있었다** — 잘림(capped) · 말없이 끊김(cutoff) · 되밀기(nudge) ·
 * 서버 한계 배움(learned).
 *
 * 제일 나쁜 것은 cutoff 다. 반쪽짜리 답이 종료코드 0 으로 나가면, 뒤에
 * 붙은 스크립트는 그것을 온전한 답으로 알고 그대로 쓴다. 나중에 결과가
 * 이상해도 왜 반쪽인지 되짚을 자리가 아무 데도 없다.
 */
{
  // 말없이 끊기는 것은 흘려보내는 연결에서만 난다(끝났다는 조각이 안 오는 것이므로).
  // 그래서 이 절만 흘려보내기를 켠 살림을 따로 쓴다.
  const 흐름집 = mkdtempSync(join(tmpdir(), 'deel-one-stream-'));
  writeFileSync(join(흐름집, 'config.json'), JSON.stringify({
    version: 1, active: 'stub', level: '개발자',
    profiles: [{
      id: 'stub', name: '스텁 연결', kind: 'openai',
      baseUrl: base, auth: 'none', apiKey: '', model: '스텁모델',
      ctx: 32768, streaming: true, tools: true, json: true, think: false,
    }],
  }, null, 2), 'utf8');

  대본초기화();
  const r = await 띄우기(['run', '일부러_말없이끊김'], { env: { DEEL_HOME: 흐름집 } });
  check('말없이 끊겨도 스스로 끝난다', !r.시간초과, `code=${r.code}`);
  /*
   * ★ 이 절의 핵심. 여기가 0 이면 파이프 뒤 스크립트가 반쪽을 온전한
   * 것으로 받아 쓴다 — 그러고도 아무 표시가 안 남는다.
   */
  check('★ 말없이 끊긴 답은 0 으로 안 끝난다', r.code === 5, `code=${r.code}`);
  check('★ 왜 그랬는지 곁으로 말해 준다', /끝났다는 말 없이/.test(r.err),
    r.err.split('\n').find((l) => /끝났다는 말 없이/.test(l))?.trim().slice(0, 90) ?? '그런 줄이 없다');
  check('받은 데까지는 그대로 내준다', /끊/.test(r.out), JSON.stringify(r.out.slice(0, 80)));

  // --json 으로 받는 쪽도 같은 판정을 봐야 한다.
  대본초기화();
  const j = await 띄우기(['run', '일부러_말없이끊김', '--json'], { env: { DEEL_HOME: 흐름집 } });
  let 몸 = null;
  try { 몸 = JSON.parse(j.out); } catch { /* 아래 검사에서 잡힌다 */ }
  check('★ --json 에도 까닭이 실린다', 몸?.reason === 'cutoff' && 몸?.ok === false,
    JSON.stringify({ reason: 몸?.reason, ok: 몸?.ok, code: 몸?.code }));

  rmSync(흐름집, { recursive: true, force: true });
}

{
  대본초기화();
  const r = await 띄우기(['run', '일부러_길이잘림']);
  check('★ 상한에서 잘렸다고 곁으로 말해 준다', /토큰에서 잘렸습니다/.test(r.err),
    r.err.split('\n').find((l) => /토큰에서 잘렸습니다/.test(l))?.trim().slice(0, 90) ?? '그런 줄이 없다');
  check('어디를 손보면 되는지도 적는다', /\/out/.test(r.err));
}

{
  대본초기화();
  const r = await 띄우기(['run', '일부러_한계알림']);
  check('서버가 한계를 알려 주면 맞춰 다시 부른다', r.code === 0, `code=${r.code}`);
  check('★ 무엇을 배웠는지 곁으로 말해 준다', /컨텍스트 한계 8,192/.test(r.err),
    r.err.split('\n').find((l) => /한계/.test(l))?.trim().slice(0, 90) ?? '그런 줄이 없다');
}

{
  대본초기화();
  const r = await 띄우기(['run', '일부러_되물음']);
  check('되물어도 끝까지 간다', r.code === 0, `code=${r.code}`);
  check('★ 한 번 되밀었다고 곁으로 말해 준다', /되밀었습니다/.test(r.err),
    r.err.split('\n').find((l) => /되밀었습니다/.test(l))?.trim().slice(0, 90) ?? '그런 줄이 없다');
}

/*
 * ── 자리가 다 차도 그 자리에서 이어 가는가 ──────────────────────────────
 *
 * 사람 말: 「current 가 다 차서 막힐 경우, 초기화되고 난 후에 다시 바로
 * 작업할 수 있게」. 대화창에서는 이걸 ctxfull 검사가 잰다. 여기서 재는 것은
 * `deel run` 이 **그 사실을 화면에 적고, 종료코드로는 성공이라고 하는가** 다.
 *
 * 종료코드가 중요하다. 비우기는 오류가 아니라 이어 가는 길이라 0 이어야
 * 한다. 여기서 1 을 주면 잡·CI 가 멀쩡히 끝난 일을 실패로 적는다.
 */
{
  대본초기화();
  const r = await 띄우기(['run', '일부러_자리없음 을 해줘']);
  check('★ 자리가 다 차도 끝까지 간다', r.code === 0, `code=${r.code}`);
  check('★ 비우고 이어간다고 곁으로 말해 준다', /비우고 이어갑니다/.test(r.err),
    r.err.split('\n').find((l) => /비우고 이어갑니다/.test(l))?.trim().slice(0, 90) ?? '그런 줄이 없다');
  check('오류라고는 안 한다', !/^\s*✗/m.test(r.err) && r.code === 0, `code=${r.code}`);
}
trace('8.8-슬래시-명령을-배치에서도');

/*
 * ── `deel run /이름` ────────────────────────────────────────────────────
 *
 * 대화 화면에서 쓰던 슬래시 명령을 야간 잡에 그대로 옮길 수 있어야 한다.
 * 여태는 `/배포점검` 이 **글자 그대로** 모델에게 갔다. 슬래시 낱말 하나를
 * 받은 모델은 "무슨 말인지 모르겠다" 고 답하고 그 턴은 0 으로 끝난다 —
 * 아무 일도 안 했는데 배치는 초록불이다. 이 파일이 제일 싫어하는 결말이다.
 */
{
  mkdirSync(join(work, '.deel', 'commands'), { recursive: true });
  writeFileSync(join(work, '.deel', 'commands', '배포점검.md'),
    '---\ndescription: 배포 전에 볼 것\n---\n\n배포 전 점검표를 훑어라. 대상은 $ARGUMENTS 다.\n', 'utf8');

  대본초기화();
  const r = await 띄우기(['run', '/배포점검']);
  const 보낸글 = JSON.stringify(받은요청.map((x) => x.json ?? null));
  check('★ 파일로 적어 둔 슬래시 명령이 배치에서도 펴진다', 보낸글.includes('배포 전 점검표를 훑어라'),
    `code=${r.code} · 요청 ${받은요청.length}건`);
  check('★ 명령 이름을 글자 그대로 보내지 않는다', !/"content":"\/배포점검"/.test(보낸글),
    보낸글.slice(0, 80));
  check('편 뒤에는 평범하게 끝난다', r.code === 0, `code=${r.code}`);
  check('무엇을 폈는지 곁에 적는다', /배포점검/.test(r.err), r.err.split('\n').find((l) => l.includes('배포점검')) ?? '(안 나옴)');

  대본초기화();
  const r2 = await 띄우기(['run', '/배포점검 서버3']);
  const 보낸글2 = JSON.stringify(받은요청.map((x) => x.json ?? null));
  check('★ 뒤에 붙인 말이 $ARGUMENTS 자리로 들어간다', 보낸글2.includes('대상은 서버3 다'),
    `code=${r2.code}`);
}

{
  /*
   * 대화 화면 전용 이름은 **0 으로 끝내면 안 된다.**
   *
   * `deel run /undo` 를 배치에 적어 두면 사람은 되돌리기가 돈 줄로 안다.
   * 여기에 그 명령이 없다는 것을 종료코드로 말해야, 잡이 그 자리에서 선다.
   */
  대본초기화();
  const r = await 띄우기(['run', '/help']);
  check('★ 대화 화면 전용 명령은 0 으로 안 끝난다', r.code !== 0, `code=${r.code}`);
  check('무엇이 문제인지 곁에 적는다', /대화 화면에서만/.test(r.err), r.err.trim().split('\n').pop() ?? '');
  check('모델을 부르지도 않는다', !받은요청.some((x) => x.url === '/v1/chat/completions'),
    `요청 ${받은요청.length}건`);

  대본초기화();
  const r2 = await 띄우기(['run', '/이런건없습니다']);
  check('★ 모르는 슬래시 이름도 0 으로 안 끝난다', r2.code !== 0, `code=${r2.code}`);
  check('모르는 명령이라고 말한다', /모르는 명령/.test(r2.err), r2.err.trim().split('\n').pop() ?? '');
}

{
  /*
   * ── 홑슬래시 `/` 하나는 **모델에게 날것으로 가면 안 된다** (8회차 그밖 한번쓰기1) ──
   *
   * `부른이름` 이 빈 문자열이면 갈래를 통째로 건너뛰어, 위 머리말이 막겠다고
   * 적어 둔 바로 그 결말(슬래시 낱말이 그냥 글자로 모델에게 가고 0 으로 끝남)이
   * 그대로 났다. 스크립트가 `/$CMD` 를 만들다 CMD 가 비면 이 자리로 온다.
   */
  대본초기화();
  const r = await 띄우기(['run', '/']);
  check('★★ 홑슬래시는 모델을 아예 안 부른다',
    !받은요청.some((x) => x.url === '/v1/chat/completions'), `요청 ${받은요청.length}건`);
  check('★★ 홑슬래시는 0 으로 안 끝난다', r.code !== 0, `code=${r.code}`);
  check('무엇이 문제인지 곁에 적는다', /명령/.test(r.err), r.err.replace(/\s+/g, ' ').slice(-120));

  대본초기화();
  const r2 = await 띄우기(['run', '/   ']);
  check('★ 뒤에 빈 칸만 붙어도 마찬가지다',
    r2.code !== 0 && !받은요청.some((x) => x.url === '/v1/chat/completions'),
    `code=${r2.code} · 요청 ${받은요청.length}건`);
}

{
  /*
   * ── 꼬리 이름에 대문자가 들어도 찾아진다 (commands.js:1757 과 쌍둥이) ──
   *
   * 찾는 마지막 칸이 `x.name.split(':').pop() === 낮춘` 이라, 왼쪽은 파일에
   * 적힌 그대로고 오른쪽은 낮춘 말이었다. `ext:ReviewCode` 는 어느 쪽으로 쳐도
   * 「모르는 명령」 이고 배치는 1 로 선다 — 있는 명령이 없는 것이 된다.
   */
  const 플러그인 = join(home, 'plugins', 'ext');
  mkdirSync(join(플러그인, 'commands'), { recursive: true });
  mkdirSync(join(플러그인, '.claude-plugin'), { recursive: true });
  writeFileSync(join(플러그인, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'ext', version: '1.0.0' }), 'utf8');
  writeFileSync(join(플러그인, 'commands', 'ReviewCode.md'), '코드를 검토해라.\n', 'utf8');

  for (const 친것 of ['/ReviewCode', '/reviewcode', '/ext:ReviewCode']) {
    대본초기화();
    const r = await 띄우기(['run', 친것]);
    const 보낸글 = JSON.stringify(받은요청.map((x) => x.json ?? null));
    check(`★★ 꼬리에 대문자가 든 명령을 ${친것} 로 편다`,
      r.code === 0 && 보낸글.includes('코드를 검토해라'), `code=${r.code} · ${r.err.replace(/\s+/g, ' ').slice(-120)}`);
  }

  rmSync(join(home, 'plugins'), { recursive: true, force: true });
}

{
  // 슬래시로 시작한다고 다 명령은 아니다. 경로는 시킨 말 그대로 둔다.
  대본초기화();
  const r = await 띄우기(['run', '/mnt/d/일감 을 봐줘']);
  const 보낸글 = JSON.stringify(받은요청.map((x) => x.json ?? null));
  check('★ 경로처럼 생긴 것은 명령으로 안 먹는다', r.code === 0 && 보낸글.includes('/mnt/d/일감'),
    `code=${r.code}`);
}

trace('9-답의모양');

/*
 * ── 답을 정해진 모양으로 받는다 (`--output-schema`) ─────────────────────
 *
 * 이 기능의 값은 전부 **파이프 뒤**에 있다. `| jq -r .이름` 이 첫 판부터 그냥
 * 먹어야 하고, 안 맞으면 0 이 아닌 값으로 서야 한다. 모양이 안 맞는 JSON 이
 * 0 으로 흘러 나가는 것이 이 기능이 없애려던 바로 그 상황이다.
 */
{
  const 스키마자리 = join(work, '뽑기.schema.json');
  writeFileSync(스키마자리, JSON.stringify({
    type: 'object',
    required: ['이름', '나이'],
    properties: {
      이름: { type: 'string', minLength: 1 },
      나이: { type: 'integer', minimum: 0 },
      표: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: false,
  }, null, 2), 'utf8');

  대본초기화();
  {
    const r = await 띄우기(['run', '--output-schema', 스키마자리, '일부러_스키마깨끗']);
    let 읽힘 = null;
    try { 읽힘 = JSON.parse(r.out.trim()); } catch { /* 아래 검사가 잡는다 */ }
    check('★★ 표준출력이 JSON 하나다 — 파이프 뒤에서 바로 읽힌다',
      r.code === 0 && 읽힘?.이름 === '홍길동' && 읽힘?.나이 === 33,
      `code=${r.code} out=${r.out.trim().slice(0, 60)}`);
    // 도구 기록·진행 글이 표준출력에 섞이면 jq 가 첫 줄에서 죽는다.
    check('★★ 표준출력에 군말이 한 줄도 안 섞인다',
      r.out.trim().split('\n').length === 1, JSON.stringify(r.out.slice(0, 80)));
    check('스키마를 시킴말에 실어 보낸다', (() => {
      const 보낸것 = JSON.stringify(받은요청.map((x) => x.json ?? null));
      return 보낸것.includes('답의 모양이 정해져 있습니다') && 보낸것.includes('additionalProperties');
    })(), '');
  }

  대본초기화();
  {
    // 울타리와 인사말을 두르고 온 답. 멀쩡한 답을 버리면 안 된다.
    const r = await 띄우기(['run', '--output-schema', 스키마자리, '일부러_스키마울타리']);
    let 읽힘 = null;
    try { 읽힘 = JSON.parse(r.out.trim()); } catch { /* 아래 검사가 잡는다 */ }
    check('★ 울타리와 인사말을 걷어내고 JSON 만 낸다',
      r.code === 0 && 읽힘?.이름 === '김', `code=${r.code} out=${r.out.trim().slice(0, 60)}`);
    // 조용히 걷어내면 사람은 모델이 깨끗하게 냈다고 여기고 시킴말을 안 고친다.
    check('걷어냈다고 말은 해 준다', /군말을 걷어내고/.test(r.err), '');
  }

  대본초기화();
  {
    // 처음엔 틀리고 되물으면 맞게 낸다. 되묻는 길이 진짜로 도는지 재는 자리.
    const r = await 띄우기(['run', '--output-schema', 스키마자리, '일부러_스키마한번틀림']);
    let 읽힘 = null;
    try { 읽힘 = JSON.parse(r.out.trim()); } catch { /* 아래 검사가 잡는다 */ }
    check('★★ 안 맞으면 한 번 더 시켜서 받아 낸다',
      r.code === 0 && 읽힘?.이름 === '둘째', `code=${r.code} out=${r.out.trim().slice(0, 60)}`);
    check('★ 무엇이 안 맞았는지 화면에 적는다',
      /스키마에 안 맞습니다/.test(r.err) && /string 이어야 하는데/.test(r.err),
      r.err.split('\n').filter((l) => /맞/.test(l)).slice(0, 2).join(' / '));
    check('되물을 때 틀린 자리를 그대로 실어 보낸다',
      JSON.stringify(받은요청.map((x) => x.json ?? null)).includes('방금 낸 답이 아래에서 안 맞았습니다'), '');
  }

  대본초기화();
  {
    // 되물어도 계속 틀린다. 여기서 0 으로 끝내면 이 기능은 없느니만 못하다.
    const r = await 띄우기(['run', '--output-schema', 스키마자리, '일부러_스키마계속틀림']);
    const 부른수 = 받은요청.filter((x) => x.url === '/v1/chat/completions').length;
    check('★★ 끝내 안 맞으면 0 이 아닌 값으로 끝낸다', r.code === 7, `code=${r.code}`);
    check('★★ 안 맞는 JSON 을 표준출력으로 안 흘린다', r.out.trim() === '', JSON.stringify(r.out.slice(0, 80)));
    check('★ 무엇이 안 맞는지 표준오류에 남긴다',
      /이름 칸이 없습니다/.test(r.err), r.err.split('\n').filter((l) => /칸이 없/.test(l))[0] ?? '');
    // 두 번만 부른다. 세 번 네 번 되풀이하면 못 고치는 자리에서 값만 태운다.
    check('되묻기는 한 번뿐이다', 부른수 === 2, String(부른수));
  }

  대본초기화();
  {
    /*
     * ── 되물음이 **HTTP 오류로 죽으면** 그 까닭이 남아야 한다 (8회차 그밖 한번쓰기3) ──
     *
     * 되물음이 500 으로 죽어도 `다시글` 이 빈 채로 아래 재보기에 들어가, 끝맺음이
     * 「답이 스키마에 안 맞습니다 — 답이 비었습니다」 로 덮이고 7 로 끝났다. 진짜
     * 까닭(서버가 500 을 냈다)이 화면에서 통째로 사라진다 — 스키마를 아무리 손봐도
     * 안 고쳐지는 자리라, 사람은 엉뚱한 데를 몇 시간 판다.
     */
    const r = await 띄우기(['run', '--output-schema', 스키마자리, '일부러_되물음터짐']);
    check('★★ 되물음이 터진 까닭을 화면에 남긴다', /500|스텁이 되물음에서 낸/.test(r.err),
      r.err.replace(/\s+/g, ' ').slice(0, 220));
    check('★★ 터진 것을 「모양이 안 맞는다」 로 덮지 않는다',
      !/답이 비었습니다/.test(r.err), r.err.replace(/\s+/g, ' ').slice(0, 220));
    check('★ 0 으로는 끝내지 않는다', r.code !== 0, `code=${r.code}`);
    check('안 맞는 답을 표준출력으로 안 흘린다', r.out.trim() === '', JSON.stringify(r.out.slice(0, 80)));
  }

  대본초기화();
  {
    // 아예 JSON 이 아닌 답. 「문서에 없습니다」 도 사람에겐 쓸모 있는 답이지만,
    // 모양을 못 박은 자리에서는 그것도 계약 위반이다.
    const r = await 띄우기(['run', '--output-schema', 스키마자리, '일부러_스키마JSON아님']);
    check('★ JSON 이 아니면 그렇다고 말하고 실패로 끝낸다',
      r.code === 7 && /JSON 을 못 찾았습니다/.test(r.err), `code=${r.code}`);
    check('산문도 표준출력으로 안 흘린다', r.out.trim() === '', JSON.stringify(r.out.slice(0, 80)));
  }

  대본초기화();
  {
    // 스키마 파일이 없으면 **일을 시작하기 전에** 선다. 다 돌리고 나서 말하면
    // 모델을 부른 값을 통째로 버리는 셈이고, 그건 오타 하나짜리 실수다.
    const r = await 띄우기(['run', '--output-schema', join(work, '없는스키마.json'), '아무말']);
    const 부른수 = 받은요청.filter((x) => x.url === '/v1/chat/completions').length;
    check('★★ 스키마 파일이 없으면 모델을 아예 안 부른다',
      r.code === 7 && 부른수 === 0, `code=${r.code} 부른수=${부른수}`);
    check('무엇을 못 읽었는지 말한다', /스키마 파일을 못 읽었습니다/.test(r.err), '');
  }

  대본초기화();
  {
    /*
     * 스키마가 바깥을 가리키면 안 받는다.
     *
     * JSON Schema 는 참조 자리에 주소를 적을 수 있고 검사기 대부분이 그걸
     * 받아 온다. 우리가 그러면 스키마 파일 하나가 「나가는 주소는 사람이
     * 정한 하나뿐」 을 깨뜨리는 길이 된다.
     */
    const 바깥 = join(work, '바깥.schema.json');
    writeFileSync(바깥, '{"type":"object","properties":{"a":{"' + '$ref' + '":"https://example.com/x.json"}}}', 'utf8');
    const r = await 띄우기(['run', '--output-schema', 바깥, '아무말']);
    const 부른수 = 받은요청.filter((x) => x.url === '/v1/chat/completions').length;
    check('★★ 바깥을 가리키는 스키마는 안 받는다',
      r.code === 7 && /바깥을 가리킵니다/.test(r.err), `code=${r.code}`);
    check('바깥으로 한 번도 안 나갔다', 부른수 === 0, String(부른수));
  }

  대본초기화();
  {
    // 우리가 안 재는 열쇠는 안 잰다고 말한다. 조용히 넘기면 사람은 잰 줄 안다.
    const 모르는것 = join(work, '모르는것.schema.json');
    writeFileSync(모르는것, JSON.stringify({
      type: 'object',
      properties: { 이름: { type: 'string', format: 'email', deprecated: true } },
    }), 'utf8');
    const r = await 띄우기(['run', '--output-schema', 모르는것, '일부러_스키마깨끗']);
    check('★ 안 재는 열쇠가 있으면 그렇다고 말한다',
      /안 재는 열쇠가 있습니다/.test(r.err) && /format/.test(r.err),
      r.err.split('\n').filter((l) => /안 재는/.test(l))[0] ?? '');
    check('그래도 나머지는 재고 통과시킨다', r.code === 0, `code=${r.code}`);
  }
}

trace('9.1-사냥5');

/*
 * ── 사냥5 — 답의 모양 · 실패의 모양 · 되물음 중 끊기 · 창보다 큰 시킬 말 ────
 *
 * 스키마 알맹이(outschema.js)는 여기서 곧장 부른다. 검사판 목록(run.mjs)에 새 파일을
 * 올리지 않고, --output-schema 를 끝-끝으로 재는 이 파일 곁에 둔다.
 */
{
  const { 스키마읽기: 읽기, 맞나: 재기, 답에서JSON뽑기: 뽑기 } = await import('../src/agent/outschema.js');
  const 챗수 = () => 받은요청.filter((x) => x.url === '/v1/chat/completions').length;
  const 한덩이 = (out) => {
    const 줄 = String(out).trim().split('\n').filter(Boolean);
    try { return 줄.length === 1 ? JSON.parse(줄[0]) : null; } catch { return null; }
  };

  // B5-05 — 메모장은 UTF-8 에 BOM 을 붙여 저장한다.
  {
    const BOM = String.fromCharCode(0xfeff);
    const 자리 = join(work, '봄.schema.json');
    writeFileSync(자리, BOM + JSON.stringify({ type: 'object', required: ['이름'] }), 'utf8');
    const 읽힘 = 읽기(자리);
    check('★★ BOM 이 붙은 스키마 파일도 읽는다 (사냥5 B5-05)', 읽힘.ok === true && 읽힘.스키마?.required?.[0] === '이름',
      JSON.stringify(읽힘).slice(0, 120));
    대본초기화();
    const r = await 띄우기(['run', '--output-schema', 자리, '일부러_스키마깨끗']);
    check('  BOM 붙은 스키마로 끝까지 돈다', r.code === 0, `code=${r.code} · ${r.err.replace(/\s+/g, ' ').slice(0, 120)}`);
  }

  // B5-06 · L5-4 — 앞에 헛괄호가 있거나 울타리가 둘인 답.
  {
    for (const 글 of ['See [docs] below. {"a":"x"}', '- [x] done\n{"a":"x"}', 'Use {placeholder} syntax. {"a":"x"}', 'Result [final]:\n{"a":"x"}']) {
      const r = 뽑기(글);
      check(`★★ 앞에 JSON 아닌 괄호가 있어도 뒤의 JSON 을 찾는다 — ${JSON.stringify(글.slice(0, 18))} (사냥5 B5-06)`,
        r.ok === true && r.값?.a === 'x', JSON.stringify(r));
    }
    const 두 = 뽑기('Example:\n```json\n{"a":"example"}\n```\nAnswer:\n```json\n{"a":"real"}\n```');
    check('★★ 울타리가 둘이면 앞의 예시가 아니라 마지막 답을 고른다 (사냥5 L5-4)', 두.ok === true && 두.값?.a === 'real', JSON.stringify(두));
    const 스키마로 = 뽑기('```json\n{"a":1}\n```\n목록으로는:\n```json\n[1]\n```', { 스키마: { type: 'object', required: ['a'] } });
    check('★ 스키마가 있으면 스키마에 맞는 쪽을 고른다', 스키마로.ok === true && 스키마로.값?.a === 1, JSON.stringify(스키마로));
    const 겹 = 뽑기('답: {"a":{"b":[1,2]},"c":"}"} 끝');
    check('  겹친 JSON 은 안쪽이 아니라 통째로 뽑는다', 겹.ok === true && 겹.값?.a?.b?.[1] === 2 && 겹.값?.c === '}', JSON.stringify(겹));
    check('  JSON 이 없으면 여전히 못 찾았다고 한다', 뽑기('괄호 [하나] {둘} 뿐').ok === false, JSON.stringify(뽑기('괄호 [하나] {둘} 뿐')));
  }

  // L5-3 — 제자리를 도는 참조.
  {
    const 도는것들 = [
      ['#', { $ref: '#' }],
      ['a→b→a', { $defs: { a: { $ref: '#/$defs/b' }, b: { $ref: '#/$defs/a' } }, $ref: '#/$defs/a' }],
      ['allOf 안에서 #', { allOf: [{ $ref: '#' }] }],
    ];
    도는것들.forEach(([이름, s], i) => {
      let 잰것;
      try { 잰것 = 재기(1, s); } catch (e) { 잰것 = { 던짐: `${e?.name}: ${e?.message}` }; }
      check(`★★ 제자리를 도는 참조에 안 터진다 — ${이름} (사냥5 L5-3)`, 잰것?.ok === false && Array.isArray(잰것.탈),
        JSON.stringify(잰것).slice(0, 120));
      const 자리 = join(work, `도는것-${i}.schema.json`);
      writeFileSync(자리, JSON.stringify(s), 'utf8');
      const 읽힘 = 읽기(자리);
      check(`★ 읽는 자리에서 막는다 — ${이름}`, 읽힘.ok === false && /제자리/.test(읽힘.왜 ?? ''), JSON.stringify(읽힘).slice(0, 120));
    });
    const 나무 = { type: 'object', properties: { 아이: { type: 'array', items: { $ref: '#' } } } };
    check('★ 값을 파고드는 재귀 스키마는 그대로 잰다',
      재기({ 아이: [{ 아이: [] }] }, 나무).ok === true && 재기({ 아이: [{ 아이: 3 }] }, 나무).ok === false,
      JSON.stringify(재기({ 아이: [{ 아이: 3 }] }, 나무)));
    const 나무자리 = join(work, '나무.schema.json');
    writeFileSync(나무자리, JSON.stringify(나무), 'utf8');
    check('  재귀 스키마 파일은 읽을 때 안 막는다', 읽기(나무자리).ok === true, JSON.stringify(읽기(나무자리)).slice(0, 120));

    const 도는자리 = join(work, '도는것-0.schema.json');
    대본초기화();
    const r = await 띄우기(['run', '--json', '--output-schema', 도는자리, '일부러_스키마깨끗']);
    const o = 한덩이(r.out);
    check('★★ 제자리를 도는 스키마면 7 로 서고 표준출력은 JSON 한 덩이다',
      r.code === 7 && o?.reason === 'schema' && 챗수() === 0 && !/Maximum call stack/.test(r.out + r.err),
      `code=${r.code} out=${JSON.stringify(r.out.slice(0, 100))}`);
    대본초기화();
    const r2 = await 띄우기(['run', '--output-schema', 도는자리, '일부러_스키마깨끗']);
    check('  --json 이 아니어도 표준출력에 맨 오류를 안 찍는다', r2.code === 7 && r2.out.trim() === '',
      `code=${r2.code} out=${JSON.stringify(r2.out.slice(0, 100))}`);
  }

  // B5-10 — 모델을 부르기 전에 선 실패도 성공과 같은 모양.
  {
    대본초기화();
    const 된것 = 한덩이((await 띄우기(['run', '--json', '안녕'])).out);
    const 열쇠들 = (o) => [
      ...Object.keys(o ?? {}).filter((k) => k !== 'why' && k !== 'schema'),
      ...Object.keys(o?.usage ?? {}).map((k) => `usage.${k}`),
    ].sort().join(',');
    const 기준 = 열쇠들(된것);
    const 빈집 = mkdtempSync(join(tmpdir(), 'deel-one-nocfg-'));
    const 판들 = [
      ['64 · 모르는 깃발', ['run', '--json', '--jsn', '안녕'], {}],
      ['7 · 스키마 못 읽음', ['run', '--json', '--output-schema', join(work, '없는스키마.json'), '안녕'], {}],
      ['시킬 말 없음', ['run', '--json'], {}],
      ['없는 --root', ['run', '--json', '--root', join(work, '없는폴더-모양'), '안녕'], {}],
      ['대화 화면 전용 명령', ['run', '--json', '/help'], {}],
      ['연결 없음', ['run', '--json', '안녕'], { env: { DEEL_HOME: 빈집 } }],
    ];
    for (const [이름, 인자, 옵션] of 판들) {
      const r = await 띄우기(인자, 옵션);
      const o = 한덩이(r.out);
      check(`★★ 실패해도 --json 모양이 성공과 같다 — ${이름} (사냥5 B5-10)`,
        !!된것 && o?.ok === false && 열쇠들(o) === 기준,
        o ? `${열쇠들(o)} ≠ ${기준}` : JSON.stringify(r.out.slice(0, 100)));
    }
    rmSync(빈집, { recursive: true, force: true });
  }

  // B5-02 — 「모양을 고쳐 다시 내라」 되물음 도중의 Ctrl+C.
  {
    /*
     * 윈도우에는 진짜 SIGINT 를 보낼 수 없어서, 아이 안에서 process.emit('SIGINT') 로
     * 같은 손들을 부른다. 재는 것은 「그 순간 누가 SIGINT 를 쥐고 있나」 다 — 한 방
     * 실행이 손을 먼저 떼면 언어 서버 쪽 손이 신호를 되쏘아 프로그램째 죽는다.
     */
    const 자식 = join(work, '스키마끊기-자식.mjs');
    const 한방 = new URL('../src/oneshot.js', import.meta.url).href;
    writeFileSync(자식, [
      "import { createServer } from 'node:http';",
      "import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';",
      "import { tmpdir } from 'node:os';",
      "import { join } from 'node:path';",
      'let n = 0;',
      'const srv = createServer((req, res) => {',
      '  req.resume();',
      "  req.on('end', () => {",
      "    if (req.url.split('?')[0] !== '/v1/chat/completions') { res.writeHead(404); return res.end('{}'); }",
      '    n += 1;',
      "    const content = n === 1 ? 'not json at all' : JSON.stringify({ a: 'x' });",
      "    const 답 = () => { try { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 5, completion_tokens: 2 } })); } catch {} };",
      "    if (n === 2) { process.emit('SIGINT'); setTimeout(답, 1500); } else 답();",
      '  });',
      '});',
      "await new Promise((r) => srv.listen(0, '127.0.0.1', r));",
      "const home = mkdtempSync(join(tmpdir(), 'deel-one-sig-'));",
      "writeFileSync(join(home, 'config.json'), JSON.stringify({ version: 1, active: 's', profiles: [{ id: 's', name: 's', kind: 'openai', baseUrl: 'http://127.0.0.1:' + srv.address().port + '/v1', auth: 'none', model: 'm', ctx: 32768, streaming: false, tools: false }] }));",
      "writeFileSync(join(home, 's.json'), JSON.stringify({ type: 'object', required: ['a'] }));",
      'process.env.DEEL_HOME = home;',
      `const { runOnce } = await import(${JSON.stringify(한방)});`,
      "const code = await runOnce({ prompt: 'give json', outputSchema: join(home, 's.json'), json: true, quiet: true, ctx: 32768 });",
      'srv.close();',
      'setTimeout(() => { try { rmSync(home, { recursive: true, force: true }); } catch {} process.exit(code); }, 50);',
    ].join('\n'), 'utf8');
    const r = await new Promise((done) => {
      const kid = spawn(process.execPath, [자식], { cwd: work, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; let err = '';
      kid.stdout.on('data', (b) => { out += b; });
      kid.stderr.on('data', (b) => { err += b; });
      const 시계 = setTimeout(() => kid.kill('SIGKILL'), 30000);
      kid.on('close', (code) => { clearTimeout(시계); done({ code, out, err }); });
    });
    const o = 한덩이(r.out);
    check('★★ 모양 고치기 되물음 도중에 끊겨도 4 와 JSON 한 덩이로 끝난다 (사냥5 B5-02)',
      r.code === 4 && o?.reason === 'aborted',
      `code=${r.code} out=${JSON.stringify(r.out.slice(0, 120))} err=${JSON.stringify(r.err.slice(-160))}`);
    rmSync(자식, { force: true });
  }

  // B5-01 — 창보다 큰 시킬 말.
  {
    대본초기화();
    const 큰말 = 'TASK-START 줄을 세어라\n' + 'lorem ipsum dolor sit amet\n'.repeat(6000) + 'TASK-END';
    const r = await 띄우기(['run', '--json', '--ctx', '32768'], { 입력: 큰말, 제한: 60000 });
    const o = 한덩이(r.out);
    check('★★★ 창에 안 들어가는 시킬 말은 ok:true 로 안 끝낸다 (사냥5 B5-01)', r.code !== 0 && o?.ok === false,
      `code=${r.code} reason=${o?.reason}`);
    check('★★ 앞 1,200자만 잘라 모델에 보내지 않는다 — 부르기 전에 선다', 챗수() === 0, `부름 ${챗수()}번`);
    // 루프도 부르기 전에 잘림을 알아채고 서지만, 그쪽 말은 「대화를 비우고 이어갑니다 … 앞 1,200자만 봤습니다」 다 —
    // 부르지도 않았는데 본 것처럼 말한다. 부르기 전에 선 자리의 말(창보다 큽니다 · 토큰 수)이어야 한다 (6회차 어긋내기).
    check('  무엇이 모자랐는지 표준오류에 적는다 — 비우는 척 없이 창보다 크다고',
      /컨텍스트 창보다 큽니다/.test(r.err) && !/비우고 이어갑니다|앞 1,200자만 봤습니다/.test(r.err), r.err.replace(/\s+/g, ' ').slice(0, 160));

    대본초기화();
    const 빠듯 = 'TASK-START 줄을 세어라\n' + 'lorem ipsum dolor sit amet\n'.repeat(4100) + 'TASK-END';
    const r2 = await 띄우기(['run', '--json', '--ctx', '32768'], { 입력: 빠듯, 제한: 60000 });
    const o2 = 한덩이(r2.out);
    check('★★ 창 문턱에서 비우느라 시킬 말 뒤가 잘렸으면 ok:true 로 안 끝낸다', r2.code !== 0 && o2?.ok === false,
      `code=${r2.code} reason=${o2?.reason} 부름=${챗수()} · ${r2.err.replace(/\s+/g, ' ').slice(0, 120)}`);
  }

  // L5-6 — 프로필에 maxTokens: 0 이면 모든 요청이 바닥값 512 로 묶였다.
  {
    const 영집 = mkdtempSync(join(tmpdir(), 'deel-one-max0-'));
    writeFileSync(join(영집, 'config.json'), JSON.stringify({
      version: 1, active: 'stub',
      profiles: [{ id: 'stub', name: '스텁', kind: 'openai', baseUrl: base, auth: 'none', model: '스텁모델', ctx: 32768, maxTokens: 0, tools: true }],
    }), 'utf8');
    대본초기화();
    const r = await 띄우기(['run', '--ctx', '32768', '안녕'], { env: { DEEL_HOME: 영집 } });
    const 첫 = 받은요청.find((x) => x.url === '/v1/chat/completions')?.json ?? {};
    const 상한 = 첫.max_tokens ?? 첫.max_completion_tokens ?? null;
    check('★★ 프로필 maxTokens: 0 은 안 적은 것으로 친다 — 답 상한이 512 로 안 묶인다 (사냥5 L5-6)',
      r.code === 0 && (상한 === null || 상한 > 512), `code=${r.code} 상한=${상한}`);
    rmSync(영집, { recursive: true, force: true });
  }

  /*
   * 2.0.0 6회차 · Gemini 모양6 — 값 칸(default·const·examples·enum)은 **스키마가 아니라 데이터**다.
   * 그 속의 `$ref` 를 바깥 스키마로 보고 읽기를 거절했고, 그 속의 이름(host·port)을 「안 재는 열쇠」
   * 로 셌다. `$ref` 에 날 `%` 가 있으면 decodeURIComponent 가 던져 --output-schema 가 통째로 죽었다.
   */
  {
    const { 모르는열쇠: 모른것들 } = await import('../src/agent/outschema.js');
    const 값칸스키마 = join(work, '값칸.schema.json');
    writeFileSync(값칸스키마, JSON.stringify({
      type: 'object',
      properties: { 주소: { type: 'object', default: { $ref: 'http://example.com/x', host: 'localhost' }, examples: [{ port: 1 }] } },
    }), 'utf8');
    const 읽힘 = 읽기(값칸스키마);
    check('★ default 값 속 $ref 를 바깥 스키마로 보고 거절하지 않는다 (6회차 모양6)', 읽힘.ok === true, JSON.stringify(읽힘).slice(0, 120));
    const 이름default = join(work, '이름default.schema.json');
    writeFileSync(이름default, JSON.stringify({ type: 'object', properties: { default: { $ref: 'http://example.com/x' } } }), 'utf8');
    const 이름읽힘 = 읽기(이름default);
    check('  그래도 칸 이름이 default 인 스키마 속 바깥 $ref 는 거절한다', 이름읽힘.ok === false && /바깥/.test(이름읽힘.왜), JSON.stringify(이름읽힘).slice(0, 120));
    const 모른 = 모른것들({ type: 'object', properties: { a: { type: 'object', default: { host: 'localhost' }, examples: [{ port: 1 }] } } });
    check('★ default·examples 속 데이터 이름을 안 재는 열쇠로 안 센다 (6회차 모양6)', 모른.length === 0, JSON.stringify(모른));
    const 퍼센트 = { $defs: { 'rate%': { type: 'string' } }, type: 'object', properties: { a: { $ref: '#/$defs/rate%' } } };
    let 던짐 = null;
    let 잰것 = null;
    try { 잰것 = 재기({ a: 1 }, 퍼센트); } catch (e) { 던짐 = e; }
    check('★ $ref 에 날 % 가 있어도 안 던지고 그 자리를 따라가 잰다 (6회차 모양6)',
      던짐 === null && 잰것?.ok === false, 던짐 ? 던짐.message : JSON.stringify(잰것));
    const 퍼센트자리 = join(work, '퍼센트.schema.json');
    writeFileSync(퍼센트자리, JSON.stringify(퍼센트), 'utf8');
    let 읽기던짐 = null;
    try { 읽기(퍼센트자리); } catch (e) { 읽기던짐 = e; }
    check('★ 날 % 든 $ref 스키마 파일을 읽어도 안 던진다 (6회차 모양6)', 읽기던짐 === null, 읽기던짐?.message ?? '');

    // 6회차 모양6 뒤 절반 — 규격대로 맞는 값을 거절하던 넷(키 순서 · patternProperties · \p{…} · prefixItems).
    const 키순서 = 재기({ b: 2, a: 1 }, { const: { a: 1, b: 2 } });
    check('★ const 객체는 키 순서가 달라도 같으면 맞다 (6회차 모양6뒤)', 키순서.ok === true, JSON.stringify(키순서));
    check('  enum 도 키 순서를 안 본다', 재기({ b: 2, a: 1 }, { enum: [{ a: 1, b: 2 }] }).ok === true);
    check('  값이 다르면 여전히 틀리다', 재기({ a: 1, b: 3 }, { const: { a: 1, b: 2 } }).ok === false && 재기({ a: 1 }, { const: { a: 1, b: 2 } }).ok === false);
    const 무늬칸 = { type: 'object', patternProperties: { '^x_': { type: 'integer' } }, additionalProperties: false };
    const 무늬맞음 = 재기({ x_1: 1 }, 무늬칸);
    check('★ patternProperties 에 맞는 칸은 additionalProperties:false 에 안 걸린다 (6회차 모양6뒤)', 무늬맞음.ok === true, JSON.stringify(무늬맞음));
    check('  무늬에 맞는 칸의 값도 잰다', 재기({ x_1: 'a' }, 무늬칸).ok === false);
    check('  무늬에도 안 맞는 칸은 여전히 거절한다', 재기({ y: 1 }, 무늬칸).ok === false);
    check('  무늬 이름을 안 재는 열쇠로 안 센다', JSON.stringify(모른것들(무늬칸)) === '[]', JSON.stringify(모른것들(무늬칸)));
    const 글자무늬 = { type: 'string', pattern: '^\\p{L}+$' };
    check('★ pattern 의 \\p{L} 을 유니코드 무늬로 잰다 (6회차 모양6뒤)', 재기('가나', 글자무늬).ok === true && 재기('1', 글자무늬).ok === false, JSON.stringify(재기('가나', 글자무늬)));
    const 앞칸 = { type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'number' } };
    check('★ prefixItems 는 앞자리를, items 는 그 뒤를 잰다 (6회차 모양6뒤)',
      재기(['a', 1], 앞칸).ok === true && 재기([1, 1], 앞칸).ok === false && 재기(['a', 'b'], 앞칸).ok === false, JSON.stringify(재기(['a', 1], 앞칸)));
    check('  prefixItems 를 안 재는 열쇠로 안 센다', JSON.stringify(모른것들(앞칸)) === '[]', JSON.stringify(모른것들(앞칸)));

    // 6회차 모양6좁 — 울타리 속 예시가 스키마 갈래와도 다르면 맨글의 같은 갈래 답을 골라야 되묻는 탈이 진짜 답 이야기가 된다.
    const { 답에서JSON뽑기: 뽑기6뒤 } = await import('../src/agent/outschema.js');
    const 두꼴스키마 = { 스키마: { type: 'object', required: ['a', 'b'] } };
    const 예시와답 = 뽑기6뒤('예시:\n```json\n[1, 2]\n```\n답: {"a": 1}', 두꼴스키마);
    check('★ 울타리 속 예시가 갈래도 다르면 맨글의 같은 갈래 답을 고른다 (6회차 모양6좁)', JSON.stringify(예시와답.값) === '{"a":1}', JSON.stringify(예시와답));
    const 울타리먼저 = 뽑기6뒤('```json\n{"a": 1}\n```\n그리고 {"b": 2}', 두꼴스키마);
    check('  울타리 속 같은 갈래가 있으면 여전히 울타리 것을 고른다', JSON.stringify(울타리먼저.값) === '{"a":1}', JSON.stringify(울타리먼저));
    // 앞 산문의 `item[0]` … 하나하나가 멀쩡한 JSON 배열이라 시작 자리 256번 상한을 다 써 버리고 끝의 답에 못 닿았다.
    const 괄호많은산문 = `${Array.from({ length: 300 }, (_, k) => `item[${k}]`).join(' ')} 최종 답: {"a": 1}`;
    const 끝답 = 뽑기6뒤(괄호많은산문, { 스키마: { type: 'object' } });
    check('★ 앞 산문에 괄호가 수백 개여도 끝의 답까지 훑는다 (6회차 모양6좁)', JSON.stringify(끝답.값) === '{"a":1}', JSON.stringify(끝답));
    // 묶음을 시작 자리 수에서 훑은 글자 수로 바꿨으니, 묶음이 여전히 있는지도 본다. 짝 없는 `{` 20만 개는
    // 묶음이 없으면 자리마다 글 끝까지 훑어 수십 초가 걸리고, 있으면 순식간에 멈춘다.
    const 짝없는시작 = Date.now();
    뽑기6뒤(`${'{'.repeat(200000)} 끝`, { 스키마: { type: 'object' } });
    const 짝없는시간 = Date.now() - 짝없는시작;
    check('  짝 없는 괄호 20만 개도 훑기 묶음에서 멈춘다', 짝없는시간 < 5000, `${짝없는시간}ms`);

    /*
     * 2.0.0 8회차 스키마 — JSON 포인터의 **빈 조각**과 참/거짓 스키마를 가리키는 `$ref`.
     *
     * `#/` 는 뿌리가 아니라 「이름이 빈 칸」 이다 (RFC 6901 §3 — 포인터 `/` 의 조각은 `""` 하나).
     * 빈 조각을 지우면 `#/` 가 뿌리로 돌아가 엉뚱한 자리를 재고, 그 탈이 사람에게는
     * 「스키마가 틀렸다」 로 보인다. 그리고 `$defs` 아래가 `false` 면 규격이 「무엇도
     * 안 된다」 고 못 박은 자리인데, 없는 자리로 보고 「스키마 안에 … 가 없습니다」 로 끝냈다.
     */
    const 빈이름 = { type: 'object', properties: { a: { $ref: '#/' } }, '': { type: 'integer' } };
    check('★★ #/ 는 뿌리가 아니라 이름이 빈 칸을 가리킨다 (8회차 스키마)',
      재기({ a: 5 }, 빈이름).ok === true && 재기({ a: '다섯' }, 빈이름).ok === false,
      JSON.stringify(재기({ a: 5 }, 빈이름)));
    const 빈조각 = { type: 'object', properties: { a: { $ref: '#/$defs/' } }, $defs: { '': { type: 'string' } } };
    check('  가운데·끝의 빈 조각도 이름이 빈 칸으로 따라간다', 재기({ a: 5 }, 빈조각).ok === false, JSON.stringify(재기({ a: 5 }, 빈조각)));
    const 뿌리가리킴 = { type: 'object', properties: { 아이: { $ref: '#' } } };
    check('  뿌리를 가리키는 # 하나는 그대로 뿌리다',
      재기({ 아이: {} }, 뿌리가리킴).ok === true && 재기({ 아이: 3 }, 뿌리가리킴).ok === false,
      JSON.stringify(재기({ 아이: {} }, 뿌리가리킴)));

    const 거짓ref = { type: 'object', properties: { a: { $ref: '#/$defs/없음' } }, $defs: { 없음: false } };
    const 거짓잰것 = 재기({ a: 5 }, 거짓ref);
    check('★★ $ref 가 false 스키마를 가리키면 없는 자리로 치지 않는다 (8회차 스키마)',
      거짓잰것.ok === false && 거짓잰것.탈.some((t) => /아무 값도 올 수 없습니다/.test(t)) && !거짓잰것.탈.some((t) => /스키마 안에/.test(t)),
      JSON.stringify(거짓잰것));
    const 참ref = { type: 'object', properties: { a: { $ref: '#/$defs/아무' } }, $defs: { 아무: true } };
    check('  true 를 가리키면 무엇이든 통과한다', 재기({ a: 5 }, 참ref).ok === true, JSON.stringify(재기({ a: 5 }, 참ref)));
    const 진짜없음 = 재기({ a: 5 }, { type: 'object', properties: { a: { $ref: '#/$defs/진짜없음' } } });
    check('  진짜로 없는 자리는 여전히 없다고 한다', 진짜없음.ok === false && 진짜없음.탈.some((t) => /스키마 안에/.test(t)), JSON.stringify(진짜없음));
    const 참거짓자리 = join(work, '참거짓.schema.json');
    writeFileSync(참거짓자리, JSON.stringify(거짓ref), 'utf8');
    check('  참·거짓 스키마가 든 파일도 그냥 읽힌다', 읽기(참거짓자리).ok === true, JSON.stringify(읽기(참거짓자리)).slice(0, 120));
  }
}


// ── 9.5 일부러 안 고른 까닭이 **화면에 실제로 뜨는가** ──────────────────
//
// 2차 리뷰가 짚었다. 자동모드.test.js 의 배선 검사는 `골라진.일부러` 라는
// 글자가 소스에 있는지만 봤다 — 출력 한 줄을 지워도 초록이었다. 「화면에
// 그 이유가 같이 뜬다」 는 route.js 의 약속을, 소스 훑기로는 못 지킨다.
//
// 여기서는 진짜로 띄운다. 자동 모드로 두고, 「고치라는 말이라 설계로 안
// 보냈다」 가 나오는 한마디를 준다. 그 까닭이 곁(stderr)에 떠야 한다.
trace('9.5-안고른까닭이화면에');
{
  const r = await 띄우기(['run', '--work', 'auto', '폴더 구조 개선해줘']);
  const 곁 = String(r.err);
  check('★★★ 안 고른 까닭이 화면에 뜬다',
    /종합 그대로/.test(곁), 곁.split('\n').filter((l) => l.trim()).slice(0, 3).join(' / '));
  check('★★★ 무엇 때문에 안 골랐는지까지 적는다',
    /고치라는 말이라/.test(곁), 곁.split('\n').filter((l) => /종합 그대로/.test(l))[0] ?? '(없음)');
  check('★★ 그래도 정상 종료한다', r.code === 0, `code=${r.code}`);

  /*
   * 반대쪽 — 보통 한마디에는 이 줄이 뜨면 안 된다. 대부분의 턴이
   * mode === null 이라, 다 찍으면 그건 안내가 아니라 소음이다.
   */
  const r2 = await 띄우기(['run', '--work', 'auto', 'ㅇㅇ 고마워']);
  /*
   * 3차 리뷰가 짚었다 — 이 아래 「안 뜬다」 는 **죽어서 조용한 것**과
   * **안 찍어서 조용한 것**을 구별하지 못한다. 옵션 하나가 틀려 곧장
   * 죽어도 stderr 에 그 줄이 없으니 초록이다. 그래서 살아서 끝났는지를
   * 먼저 못박는다.
   */
  check('★★ 반대쪽도 정상 종료한다',
    r2.code === 0, `code=${r2.code} · ${String(r2.err).slice(0, 200)}`);
  check('★★★ 그냥 모르겠는 한마디에는 안 뜬다',
    !/종합 그대로/.test(String(r2.err)), String(r2.err).split('\n').filter((l) => l.trim())[0] ?? '');
}

// ── 9.6 물어볼 사람이 없는데 「계획부터 내고 승인받는」 자리로 가지 않는가 ──
//
// ★★★ 이 파일의 머리글이 그대로 걸리는 자리다 — 「물어볼 사람이 없는
// 자리에서 서지 않고 끝나는가」.
//
// 겹친 요청(계획과 실행이 한 말에 같이 든 것)의 값은 「계획을 보여 주고
// **승인을 받아** 그대로 잇는다」 다. 그 값은 승인할 사람이 있어야 생긴다.
// 여기서는 승인 창이 뜰 자리도, 이어 갈 턴도 없다. 그런데도 계획 모드로
// 보내면 계획 한 장을 찍고 끝난다 — 계획 모드는 파일을 고치는 도구가 없다.
//
// 오류는 안 난다. 종료코드도 0이다. 사용자는 시킨 일의 절반도 못 받는다.
trace('9.6-물어볼사람없는자리');
{
  const r = await 띄우기(['run', '--work', 'auto', '이 폴더 정리해서 만들어줘']);
  const 곁 = String(r.err);
  check('★★★ 계획 모드로 안 보낸다 — 물어볼 사람이 없다',
    !/계획 \(plan\)/.test(곁), 곁.split('\n').filter((l) => l.trim()).slice(0, 3).join(' / '));
  check('★★★ 파일을 고칠 수 있는 모드로 간다',
    /코드 \(Code\)/i.test(곁), 곁.split('\n').filter((l) => /—/.test(l))[0] ?? '(모드 줄 없음)');
  /*
   * 다르게 했으면 다르게 했다고 적어야 한다. 안 적으면 계획을 먼저 볼 줄
   * 알았던 사람이 파일이 이미 바뀐 것을 나중에 본다.
   */
  check('★★★ 다르게 한다는 것을 말해 준다',
    /승인받을 사람이 없어/.test(곁), 곁.split('\n').filter((l) => /◇/.test(l))[0] ?? '(안내 없음)');
  check('★★ 정상 종료한다', r.code === 0, `code=${r.code}`);

  // 반대쪽 — 겹치지 않은 한마디에는 이 안내가 뜨면 안 된다.
  const r2 = await 띄우기(['run', '--work', 'auto', '이 파일 고쳐줘']);
  check('★★ 반대쪽도 정상 종료한다', r2.code === 0, `code=${r2.code}`);
  check('★★ 안 겹친 한마디에는 안 뜬다',
    !/승인받을 사람이 없어/.test(String(r2.err)),
    String(r2.err).split('\n').filter((l) => /◇/.test(l))[0] ?? '');
}

trace('8z-연결이-없어도-소식은-낸다');

{
  /*
   * 연결이 없으면 「deel setup 을 먼저」 한 줄로 끝났다. 모아 둔 소식은 그보다 아래에서
   * 비우니 한 줄도 안 나왔다 — 설정을 해 뒀는데 왜 없다고 하는지 찾는 사람에게는
   * 「이 폴더 설정은 안 믿어서 안 읽었다」 가 바로 그 까닭일 수 있다.
   */
  const 빈집 = mkdtempSync(join(tmpdir(), 'deel-one-noconf-'));
  const 방 = mkdtempSync(join(tmpdir(), 'deel-one-noconf-work-'));
  mkdirSync(join(방, '.deel'), { recursive: true });
  writeFileSync(join(방, '.deel', 'config.json'),
    JSON.stringify({ profiles: [{ id: 'r', baseUrl: 'http://127.0.0.1:1', model: 'm' }] }), 'utf8');
  const r = await 띄우기(['run', '안녕'], { 폴더: 방, env: { DEEL_HOME: 빈집 } });
  check('연결이 없으면 실패로 끝난다', r.code !== 0 && !r.시간초과, `code=${r.code}`);
  check('★★ 연결이 없어도 모아 둔 소식(안 믿는 폴더 설정)을 낸다', /deel trust/.test(String(r.err)),
    String(r.err).replace(/\s+/g, ' ').slice(0, 120));
  rmSync(빈집, { recursive: true, force: true });
  rmSync(방, { recursive: true, force: true });
}

trace('9.7-인자와-설정의-끝자락');

/*
 * ── 인자 한 칸·설정 한 줄이 배치를 딴 길로 보내던 자리들 ───────────────
 *
 * 사냥에서 전부 재현했다. 공통점은 **틀렸는데 0 으로 끝나거나, 틀린 까닭을
 * 엉뚱한 말로 적는 것**이다. 배치는 사람이 안 보는 자리라 둘 다 오래 간다.
 */
{
  const 부른수 = () => 받은요청.filter((x) => x.url === '/v1/chat/completions').length;
  const 쓴것 = join(work, '한번만쓴것.txt');

  // `--mode Strict` 는 대문자 하나로 승인이 통째로 꺼져 있었다 — Write 가 묻지 않고 돌았다.
  대본초기화();
  rmSync(쓴것, { force: true });
  {
    const r = await 띄우기(['run', '--mode', 'Strict', '일부러_고쳐 줘'], { 제한: 25000 });
    check('★★★ --mode Strict 도 엄격으로 돈다 — 승인 없이 안 고친다',
      !existsSync(쓴것) && /거부/.test(r.err), `code=${r.code} · ${r.err.slice(0, 160)}`);
  }
  rmSync(쓴것, { force: true });
  for (const 이름 of ['stirct', '엄격']) {
    대본초기화();
    const r = await 띄우기(['run', '--mode', 이름, '일부러_고쳐 줘'], { 제한: 25000 });
    check(`★★★ --mode ${이름} 은 모르는 이름이라 64 로 멈춘다`,
      r.code === 64 && !existsSync(쓴것) && 부른수() === 0, `code=${r.code} · 부름 ${부른수()} · ${(r.out + r.err).slice(0, 120)}`);
    check(`  --mode ${이름} — 있는 이름을 같이 보여 준다`, /strict/.test(r.err), r.err.slice(0, 160));
    rmSync(쓴것, { force: true });
  }

  // `--` 뒤는 시킬 말이다. 여태는 `--` 가 깃발 이름 없는 깃발이 되어 뒤의 말을 삼켰다.
  대본초기화();
  {
    const r = await 띄우기(['run', '--', '--json 은 깃발이 아니라 말입니다']);
    const 간말 = JSON.stringify(받은요청.map((x) => x.json?.messages ?? []));
    check('★★ -- 뒤는 전부 시킬 말로 받는다', r.code === 0 && 간말.includes('--json 은 깃발이 아니라 말입니다'),
      `code=${r.code} · ${r.err.slice(0, 120)}`);
  }

  // 모르는 깃발은 뒤의 낱말을 값으로 삼키고 「무엇을 시킬지」 로 끝났다.
  대본초기화();
  {
    const r = await 띄우기(['run', '--jsn', '안녕']);
    check('★★ 모르는 깃발은 64 로 멈추고 그 이름을 적는다',
      r.code === 64 && /--jsn/.test(r.err) && !/무엇을 시킬지/.test(r.err) && 부른수() === 0,
      `code=${r.code} · ${r.err.slice(0, 160)}`);
    check('★ 가까운 깃발 이름을 짚어 준다', /--json/.test(r.err), r.err.replace(/\s+/g, ' ').slice(0, 160));
    const j = await 띄우기(['run', '--json', '--jsn', '안녕']);
    let o = null;
    try { o = JSON.parse(j.out.trim()); } catch { /* 아래에서 잰다 */ }
    check('★★ --json 이면 인자 탈도 표준출력은 JSON 한 덩이다',
      !!o && o.ok === false && o.code === 64 && j.code === 64, JSON.stringify(j.out.slice(0, 160)));
  }

  /*
   * 대시 하나짜리 낱말(`-x` · `-jq`)은 시킬 말에 조용히 섞였다 (4회차 직접 사냥).
   * `deel run -n 5 고쳐` 를 치면 모델은 「-n 5 고쳐」 를 받는다. 긴 깃발과 같은 문을 지난다.
   * `-p` 는 명령 이름이라 맨 앞에서는 된다.
   */
  대본초기화();
  {
    const r = await 띄우기(['run', '-x', '안녕']);
    check('★★ 모르는 한 대시 깃발도 64 로 멈추고 이름을 적는다',
      r.code === 64 && /-x/.test(r.err) && 부른수() === 0, `code=${r.code} · 부름 ${부른수()} · ${r.err.slice(0, 120)}`);
    대본초기화();
    const p = await 띄우기(['-p', '안녕']);
    check('  맨 앞의 -p 는 명령 이름이라 그대로 돈다', p.code === 0 && 부른수() === 1, `code=${p.code} · 부름 ${부른수()}`);
  }

  // 켜고 끄는 깃발에 `=값` 을 붙이면 그 글자가 그대로 값이 됐다 — `--json=yes` 는 JSON 을 안 냈고 0 으로 끝났다.
  대본초기화();
  {
    const y = await 띄우기(['run', '--json=yes', '안녕']);
    check('★★ --json=yes 는 64 로 멈춘다 (켜진 줄 알고 JSON 을 기다리지 않게)',
      y.code === 64 && /--json/.test(y.err) && 부른수() === 0, `code=${y.code} · 부름 ${부른수()} · ${y.err.slice(0, 120)}`);
    대본초기화();
    const t = await 띄우기(['run', '--json=true', '안녕']);
    let o = null;
    try { o = JSON.parse(t.out.trim()); } catch { /* 아래에서 잰다 */ }
    check('  --json=true 는 켠 것이다', t.code === 0 && o?.ok === true, JSON.stringify(t.out.slice(0, 120)));
    대본초기화();
    const f = await 띄우기(['run', '--json=false', '안녕']);
    check('  --json=false 는 끈 것이다 — 표준출력이 JSON 이 아니다', f.code === 0 && !/^\s*\{/.test(f.out),
      `code=${f.code} · ${JSON.stringify(f.out.slice(0, 80))}`);
  }

  // 값 깃발이 맨 끝에 값 없이 오면 "true" 가 값이 됐다 — ./true 폴더가 생겼다.
  대본초기화();
  {
    const r = await 띄우기(['run', '안녕', '--root']);
    check('★★ 값 없는 --root 는 64 로 멈춘다', r.code === 64 && /--root/.test(r.err), `code=${r.code} · ${r.err.slice(0, 120)}`);
    check('★★ ./true 폴더를 안 만든다', !existsSync(join(work, 'true')), '');
    // `--root=` 는 64 인데 `--root ""` 는 빈 값을 받아 조용히 지금 폴더에서 돌았다 (4회차 Gemini #9).
    대본초기화();
    const e = await 띄우기(['run', '--root', '', '안녕']);
    check('★ --root "" 도 --root= 처럼 64 로 멈춘다', e.code === 64 && 부른수() === 0, `code=${e.code} · 부름 ${부른수()}`);
    rmSync(join(work, 'true'), { recursive: true, force: true });
    대본초기화();
    const w = await 띄우기(['run', '--work', '--json', '안녕']);
    check('★★ 값 없는 --work 도 오타 막이를 건너뛰지 않는다', w.code === 64 && 부른수() === 0, `code=${w.code}`);
  }

  // 없는 --root 를 만들어 놓고 그 안에서 일을 했다.
  대본초기화();
  {
    const 없는곳 = join(work, '없는폴더', '더깊이');
    const r = await 띄우기(['run', '--root', 없는곳, '안녕']);
    check('★★ 없는 --root 는 거절한다', r.code === 1 && !existsSync(join(work, '없는폴더')) && 부른수() === 0,
      `code=${r.code} · ${r.err.slice(0, 120)}`);
    check('  어느 폴더인지 적는다', r.err.includes('더깊이'), r.err.slice(0, 160));
    rmSync(join(work, '없는폴더'), { recursive: true, force: true });
  }

  // `--ctx junk` 는 조용히 버려졌다. 대화 중 `/ctx junk` 는 거절하는데.
  대본초기화();
  {
    const r = await 띄우기(['run', '--ctx', 'junk', '안녕']);
    check('★ 못 읽는 --ctx 는 64 로 멈춘다', r.code === 64 && /junk/.test(r.err) && 부른수() === 0, `code=${r.code} · ${r.err.slice(0, 120)}`);
  }

  /*
   * 이 PC 설정의 `mode` 를 `deel run` 이 안 읽었다 (사냥 T11).
   *
   * `"mode": "strict"` 라고 적어 둔 사람의 배치가 Write 를 묻지 않고 돌렸다. 적은
   * 사람은 막힌 줄 안다. 차례는 깃발 > 이 PC 설정 > auto 이고, 모르는 이름이면
   * 가장 헐거운 auto 로 떨어지지 않고 켜지 않는다.
   */
  {
    const 모드집 = mkdtempSync(join(tmpdir(), 'deel-one-modehome-'));
    const 설정적기 = (mode) => writeFileSync(join(모드집, 'config.json'), JSON.stringify({
      version: 1, active: 'stub', mode,
      profiles: [{ id: 'stub', name: '스텁', kind: 'openai', baseUrl: base, auth: 'none', model: '스텁모델', ctx: 32768, tools: true }],
    }), 'utf8');
    설정적기('strict');
    대본초기화();
    rmSync(쓴것, { force: true });
    const r = await 띄우기(['run', '일부러_고쳐 줘'], { env: { DEEL_HOME: 모드집 } });
    check('★★★ 이 PC 설정의 mode:strict 를 run 이 따른다', !existsSync(쓴것) && /거부/.test(r.err),
      `code=${r.code} · ${r.err.replace(/\s+/g, ' ').slice(0, 160)}`);
    대본초기화();
    rmSync(쓴것, { force: true });
    const r2 = await 띄우기(['run', '--mode', 'auto', '일부러_고쳐 줘'], { env: { DEEL_HOME: 모드집 } });
    check('★★ 깃발이 설정의 mode 를 이긴다', existsSync(쓴것) && r2.code === 0, `code=${r2.code}`);
    rmSync(쓴것, { force: true });
    설정적기('stirct');
    대본초기화();
    const r3 = await 띄우기(['run', '일부러_고쳐 줘'], { env: { DEEL_HOME: 모드집 } });
    check('★★ 설정의 mode 가 모르는 이름이면 켜지 않는다',
      r3.code === 1 && !existsSync(쓴것) && 부른수() === 0 && /stirct/.test(r3.err),
      `code=${r3.code} · ${r3.err.replace(/\s+/g, ' ').slice(0, 160)}`);
    rmSync(쓴것, { force: true });
    rmSync(모드집, { recursive: true, force: true });
  }

  // 깨진 설정 + --json — 표준출력에 맨 글이 섞여 JSON 을 읽는 쪽이 통째로 깨졌다.
  {
    const 깨진집 = mkdtempSync(join(tmpdir(), 'deel-one-broken-'));
    writeFileSync(join(깨진집, 'config.json'), '{ "profiles": [ ,', 'utf8');
    const r = await 띄우기(['run', '--json', '안녕'], { env: { DEEL_HOME: 깨진집 } });
    let o = null;
    try { o = JSON.parse(r.out.trim()); } catch { /* 아래에서 잰다 */ }
    // reason 까지 잰다 — 이 문이 못 받고 던지면 bin/deel.js 의 마지막 catch 가 같은 모양을 `error` 로
    // 내서 여태 검사가 초록이었다(전수 어긋내기 #384 생존). 스크립트는 reason 으로 갈라 대응한다.
    check('★★ 깨진 설정이어도 --json 표준출력은 JSON 한 덩이다', !!o && o.ok === false && r.code === 1 && o.reason === 'config',
      JSON.stringify(r.out.slice(0, 160)));
    check('  까닭은 표준오류에 적는다', /설정 파일/.test(r.err), r.err.slice(0, 160));

    // {"profiles":null} — 「Cannot read properties of null」 로 죽었다.
    writeFileSync(join(깨진집, 'config.json'), '{"version":1,"profiles":null}', 'utf8');
    const n = await 띄우기(['run', '안녕'], { env: { DEEL_HOME: 깨진집 } });
    check('★ profiles 가 null 이면 연결이 없는 것으로 친다',
      n.code === 1 && /저장된 연결이 없습니다/.test(n.err) && !/Cannot read/.test(n.out + n.err),
      (n.out + n.err).replace(/\s+/g, ' ').slice(0, 160));
    rmSync(깨진집, { recursive: true, force: true });
  }

  /*
   * 관리 정책에 `"offline": "true"` 라고 따옴표를 붙여 적으면 봉인이 안 걸렸다.
   * 깃발은 글자 'true' 를 받는데 정책을 덮는 자리(config.js)는 true 만 봤다.
   * 바깥 주소는 .invalid 라 막이 없어도 실제로는 못 나간다 — 막은 것이 봉인인지만 잰다.
   */
  {
    const 정책집 = mkdtempSync(join(tmpdir(), 'deel-one-policy-'));
    writeFileSync(join(정책집, 'config.json'), JSON.stringify({
      version: 1, active: 'out',
      profiles: [{ id: 'out', name: '바깥', kind: 'openai', baseUrl: 'https://no-such-host-deel-test.invalid/v1', auth: 'none', model: 'm', ctx: 32768, online: true }],
    }), 'utf8');
    const 정책파일 = join(정책집, 'policy.json');
    writeFileSync(정책파일, '{"offline":"true"}', 'utf8');
    const r = await 띄우기(['run', '--online', '--ctx', '32768', '안녕'], { env: { DEEL_HOME: 정책집, DEEL_POLICY: 정책파일 } });
    check('★★ 정책의 offline:"true" 도 봉인으로 걸린다', r.code !== 0 && /오프라인|봉인/.test(r.err),
      `code=${r.code} · ${r.err.replace(/\s+/g, ' ').slice(0, 160)}`);
    rmSync(정책집, { recursive: true, force: true });
  }

  /*
   * 집 폴더에서 켜면 `<집>/.deel/config.json` 이 곧 이 PC 설정이다. 그걸 「안 믿는
   * 프로젝트 설정」 으로 읽어 `deel trust` 를 권했고, 권한 대로 하면 집 아래
   * 저장소가 전부 믿기게 됐다.
   */
  {
    const 방 = mkdtempSync(join(tmpdir(), 'deel-one-homecwd-'));
    const 집 = join(방, '.deel');
    mkdirSync(집, { recursive: true });
    writeFileSync(join(집, 'config.json'), JSON.stringify({
      version: 1, active: 'stub',
      permissions: { allow: ['Bash(git status*)'] },
      profiles: [{ id: 'stub', name: '스텁', kind: 'openai', baseUrl: base, auth: 'none', model: '스텁모델', ctx: 32768, tools: true }],
    }), 'utf8');
    대본초기화();
    const r = await 띄우기(['run', '안녕'], { 폴더: 방, env: { DEEL_HOME: 집 } });
    check('★★ 집 폴더에서 켜면 제 설정을 「안 믿는 프로젝트 설정」 이라 안 한다',
      r.code === 0 && !/deel trust/.test(r.err), `code=${r.code} · ${r.err.replace(/\s+/g, ' ').slice(0, 160)}`);
    writeFileSync(join(집, 'trusted.json'), JSON.stringify({ version: 1, trusted: [방] }), 'utf8');
    const r2 = await 띄우기(['run', '안녕'], { 폴더: 방, env: { DEEL_HOME: 집 } });
    check('★★ 믿어 둬도 제 설정의 allow 를 걷어냈다고 거짓말하지 않는다',
      r2.code === 0 && !/걷어냈습니다/.test(r2.err), `code=${r2.code} · ${r2.err.replace(/\s+/g, ' ').slice(0, 160)}`);
    rmSync(방, { recursive: true, force: true });
  }
}

trace('9-치움');
srv.close();
rmSync(home, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const Y = '\x1b[33m'; const X = '\x1b[0m';
console.log(`\n한 번만 돌리기  ${D}(물어볼 사람이 없는 자리에서 서지 않고 끝나는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
for (const 글 of 건너뜀) console.log(`  ${Y}⚠${X} ${글}`);
{
  // 6회차 Gemini 백엔드5역 — 울타리 안에 예시, 울타리 밖에 스키마에 맞는 답. 울타리 것만 봐서 예시를 답으로 냈다.
  const { 답에서JSON뽑기: 뽑기6 } = await import('../src/agent/outschema.js');
  const 스키마6 = { type: 'object', required: ['target'], properties: { target: { type: 'number' } } };
  const 울 = '```';
  const r6 = 뽑기6(`예시는 이렇습니다:\n${울}json\n{"example":true}\n${울}\n실제 답: {"target":123}`, { 스키마: 스키마6 });
  check('★ 울타리 안 예시가 스키마에 안 맞으면 울타리 밖의 맞는 답을 고른다', r6.ok && r6.값?.target === 123, JSON.stringify(r6));
  const r7 = 뽑기6(`${울}json\n{"target":1}\n${울}\n그리고 {"target":2}`, { 스키마: 스키마6 });
  check('  울타리 안 것이 맞으면 여전히 울타리 것', r7.ok && r7.값?.target === 1, JSON.stringify(r7));
}

console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패`
  + (건너뜀.length ? ` · ${Y}${건너뜀.length}개 건너뜀${X}` : '') + '\n');
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
