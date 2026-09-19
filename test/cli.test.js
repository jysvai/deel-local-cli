// 진짜 `deel` 을 띄워서 확인한다.
//
// 왜 필요한가:
//   나머지 검사들은 함수를 직접 부른다. 그것만으로는 못 잡는 게 있다 —
//   진입점의 인자 처리, 화면 그리기, 대화 화면이 명령을 받아 넘기는 배선,
//   그리고 '프로그램이 실제로 끝나는가'. 마지막 것은 실제로 사고가 났었다:
//   `deel scan` 이 결과를 다 찍고도 종료코드 3221226505 로 죽었다. 화면만
//   보면 멀쩡해서, 함수 단위 검사로는 영영 못 잡는 종류다.
//
// 어디에 붙는가:
//   모델 자리는 이 컴퓨터 안(127.0.0.1)의 임시 스텁이다. 바깥으로는 한 바이트도
//   안 나간다. 설정도 임시 폴더(DEEL_HOME)라 사람의 ~/.deel 을 못 건드린다.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse as 경로쪼개기 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const 진입점 = join(here, '..', 'bin', 'deel.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 스텁 모델 ───────────────────────────────────────────────────────────
//
// 도구 호출까지 흉내 낸다. 그래야 대화 화면의 도구 그리기 자리가 실제로 돈다.
let 받은요청 = [];
let 도구한번 = false;
let 잘림한번 = false;
let 할일한번 = false;
let 쓰기한번 = false;
let 여럿한번 = false;
let 도구번호 = 1;
// 생각 없이 잘린 답을 **몇 번 부탁받았나.** 헛되이 다시 부르면 이 수가 는다.
let 헛잘림셈 = 0;
// 생각 블록이 지워진 채 잘린 답을 몇 번 부탁받았나.
let 숨은생각셈 = 0;
const 대본초기화 = () => { 도구한번 = 잘림한번 = 할일한번 = 쓰기한번 = 여럿한번 = false; 도구번호 = 1; 헛잘림셈 = 0; 숨은생각셈 = 0; 받은요청 = []; };

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
      const 답 = (msg, why, 낸것) => 보냄({
        id: 'x', object: 'chat.completion', model: '스텁모델',
        choices: [{ index: 0, finish_reason: why ?? (msg.tool_calls ? 'tool_calls' : 'stop'), message: msg }],
        usage: { prompt_tokens: 120, completion_tokens: 낸것 ?? 12 },
      });
      const 도구답 = (name, args) => 답({
        role: 'assistant', content: null,
        tool_calls: [{ id: `c${도구번호++}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
      });

      // 사람이 처음에 뭐라고 했는지를 보고 대본을 고른다.
      // 이 한 대사가 대화 화면의 어느 갈래를 밟을지 정한다.
      const 사람말 = String([...(json?.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '');

      if (/일부러_터뜨려/.test(사람말)) return 보냄({ error: { message: '스텁이 일부러 낸 오류입니다' } }, 500);
      if (/일부러_생각/.test(사람말)) return 답({ role: 'assistant', content: '다 생각했습니다', reasoning_content: '속으로 이렇게 생각했다' });
      if (/일부러_잘림/.test(사람말)) {
        /*
         * 첫 번째만 잘린 척한다. 루프가 상한을 풀고 한 번 더 부르는 자리를 밟는다.
         *
         * **생각을 같이 실어 준다.** 상한을 못 올리는 자리(작은 창에서는 아껴
         * 잡은 값과 풀어 준 값이 둘 다 바닥값 512 에 걸린다)에서 루프가 다시
         * 부르는 유일한 길은 「생각을 줄여 자리를 낸다」 인데, 그 길은 생각이
         * 실제로 자리를 먹었을 때만 열린다(agent/loop.js 의 생각몫문턱).
         * 생각이 0인 답을 같은 상한으로 다시 받는 것은 같은 자리에서 또
         * 잘리는 일이라, 이제 안 한다.
         */
        if (!잘림한번) {
          잘림한번 = true;
          return 답({
            role: 'assistant', content: '여기서 잘',
            reasoning_content: '속으로 길게 생각했다. '.repeat(400),
          }, 'length');
        }
        return 답({ role: 'assistant', content: '이번엔 끝까지 썼습니다' });
      }
      /*
       * 생각을 **안 한** 채로 잘린 답. 이때는 다시 부르지 않는다.
       *
       * 상한도 못 올리고 생각도 안 했으면, 다시 불러 봐야 바뀌는 것이 없어
       * 같은 자리에서 또 잘린다 — 그 한 번이 프리픽스 전체와 출력 상한 전체를
       * 다시 낸다. 실제 청구서에서 그날 제일 비싼 줄이 그것이었다.
       */
      if (/일부러_맨잘림/.test(사람말)) {
        헛잘림셈 += 1;
        return 답({ role: 'assistant', content: `헛되이 잘린 답 ${헛잘림셈}번째` }, 'length');
      }
      /*
       * 게이트웨이가 **생각 블록을 지워서** 넘긴 경우.
       *
       * 생각 글도 없고 추론 토큰 셈도 없다. 그것만 보면 「생각을 안 했다」 인데,
       * 실제로는 예산을 다 생각에 쓰다 잘린 것일 수 있다. 관측이 없는 것과
       * 사건이 없는 것은 다르다.
       *
       * 가를 방법이 하나 남아 있다 — **낸 토큰은 안 지워진다.** 보이는 글이
       * 짧은데 낸 토큰이 많으면 그 차이가 곧 안 보이는 생각이다.
       */
      if (/일부러_숨은생각/.test(사람말)) {
        숨은생각셈 += 1;
        if (숨은생각셈 === 1) return 답({ role: 'assistant', content: '짧게 잘림' }, 'length', 4000);
        return 답({ role: 'assistant', content: '생각을 줄이니 끝까지 썼습니다' });
      }
      if (/일부러_할일/.test(사람말) && !할일한번) {
        할일한번 = true;
        return 도구답('TodoWrite', { todos: [
          { content: '첫째 할 일', status: 'in_progress', activeForm: '첫째 하는 중' },
          { content: '둘째 할 일', status: 'pending', activeForm: '둘째 하는 중' },
        ] });
      }
      if (/일부러_끝없이/.test(사람말)) {
        // 걸음 수 상한에 걸릴 때까지 계속 도구를 부른다.
        return 도구답('Read', { file_path: '읽을것.txt' });
      }
      if (/일부러_여럿/.test(사람말) && !여럿한번) {
        // 한 번에 여러 도구. 읽기끼리는 같이 돌리므로 '여러 개 동시' 그리기가 돈다.
        여럿한번 = true;
        return 답({
          role: 'assistant', content: null,
          tool_calls: [
            { id: 'm1', type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: '읽을것.txt' }) } },
            { id: 'm2', type: 'function', function: { name: 'Glob', arguments: JSON.stringify({ pattern: '*.txt' }) } },
            { id: 'm3', type: 'function', function: { name: 'Grep', arguments: JSON.stringify({ pattern: '줄' }) } },
          ],
        });
      }
      if (/일부러_길게/.test(사람말)) {
        // 컨텍스트를 빨리 채워 접기(compact)를 부른다.
        return 답({ role: 'assistant', content: '아주 긴 답입니다. '.repeat(2000) });
      }
      if (/일부러_요약/.test(사람말)) {
        // 접을 때 부르는 요약 요청에 답한다.
        return 답({ role: 'assistant', content: '- 앞선 대화를 이렇게 요약합니다' });
      }
      if (/일부러_고쳐/.test(사람말) && !쓰기한번) {
        쓰기한번 = true;
        return 도구답('Write', { file_path: '새로쓴것.txt', content: '스텁이 쓴 내용' });
      }

      // 그 밖에는 한 번만 도구를 부르고 그다음부터는 그냥 답한다.
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
const home = mkdtempSync(join(tmpdir(), 'deel-cli-home-'));
const work = mkdtempSync(join(tmpdir(), 'deel-cli-work-'));
writeFileSync(join(work, '읽을것.txt'), '한 줄짜리 파일입니다.\n두 번째 줄.\n', 'utf8');
writeFileSync(join(work, 'DEEL.md'), '# 규칙\n\n- 이 폴더에서는 조심한다\n', 'utf8');

function 설정쓰기(추가 = {}) {
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: 'stub', level: '개발자',
    profiles: [{
      id: 'stub', name: '스텁 연결', kind: 'openai',
      baseUrl: base, auth: 'none', apiKey: '', model: '스텁모델',
      ctx: 32768, streaming: false, tools: true, json: true, think: false,
      ...추가,
    }],
  }, null, 2), 'utf8');
}
설정쓰기();

/**
 * deel 을 띄우고, 줄을 하나씩 넣고, 끝날 때까지 기다린다.
 *
 * 시간 제한을 반드시 둔다. 안 끝나면 검사가 멈춘 채로 CI 를 물고 있다 —
 * 그건 실패보다 나쁘다. 무엇을 넣다가 안 끝났는지도 같이 남긴다.
 */
function 띄우기(인자 = [], { 입력 = [], 제한 = 25000, 폴더 = work, env = {} } = {}) {
  return new Promise((done) => {
    const kid = spawn(process.execPath, [진입점, ...인자], {
      cwd: 폴더,
      env: { ...process.env, DEEL_HOME: home, NO_COLOR: '1', COLUMNS: '100', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = ''; let err = ''; let 끝남 = false;
    let 마지막출력 = Date.now();
    kid.stdout.on('data', (b) => { out += b; 마지막출력 = Date.now(); });
    kid.stderr.on('data', (b) => { err += b; 마지막출력 = Date.now(); });

    const 시계 = setTimeout(() => {
      if (끝남) return;
      kid.kill('SIGKILL');
      done({ code: null, out, err, 시간초과: true });
    }, 제한);

    // 한 줄씩 넣되, '시간' 이 아니라 '저쪽이 입력을 기다리는지' 를 보고 넣는다.
    //
    // 처음에는 550ms 씩 쉬며 밀어 넣었다. 그랬더니 CI 여섯 자리 중 넷이
    // 빨간불이 났다 — 느린 기계에서는 아직 준비되기 전에 줄이 들어가고,
    // 두 줄이 한 덩어리로 붙는다. 기계가 바뀔 때마다 됐다 안 됐다 하는
    // 검사는 실패보다 나쁘다.
    //
    // '❯ 가 몇 개 떴나' 로도 세어 봤는데 그것도 틀렸다. 승인을 물어보는 자리
    // ("실행할까요? (y/n)") 는 ❯ 를 안 찍는다. 그래서 y/n 을 넣을 차례에
    // 오지 않을 ❯ 를 기다리며 서 있었다 — 검사가 13초에서 93초로 늘었다.
    //
    // 프롬프트 모양을 맞히려 들지 말고, 출력이 멎었는지만 본다.
    // 무엇을 물어보든 물어본 뒤에는 조용해진다.
    const 조용해질때까지 = async () => {
      for (let t = 0; t < 400 && !끝남; t++) {
        if (out.length && Date.now() - 마지막출력 > 180) return;
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    (async () => {
      for (const 줄 of 입력) {
        if (끝남) break;
        await 조용해질때까지();
        if (끝남) break;
        kid.stdin.write(줄 + '\n');
        마지막출력 = Date.now();   // 방금 넣었으니 잠깐은 시끄러운 것으로 친다
      }
      if (!끝남) kid.stdin.end();
    })();

    kid.on('close', (code) => {
      끝남 = true;
      clearTimeout(시계);
      done({ code, out, err, 시간초과: false });
    });
  });
}

trace('1-도움말');

// ── 인자 처리와 끝맺음 ──────────────────────────────────────────────────
{
  const r = await 띄우기(['--help']);
  check('--help 가 종료코드 0 으로 끝난다', r.code === 0, `code=${r.code}${r.시간초과 ? ' 시간초과' : ''}`);
  check('--help 에 사용법이 있다', /사용법/.test(r.out), r.out.slice(0, 60));
  check('--help 에 하위 명령이 다 있다',
    ['scan', 'sessions', 'setup', 'status', 'diagnose'].every((x) => r.out.includes('deel ' + x)),
    '');

  /*
   * ── 「위 전부」 가 위에 없는 것까지 지웠다 (막판-바깥) ──────────────────
   *
   * 도움말의 `deel reset all` 줄은 「위 전부 — 플러그인·되돌리기·감사기록은
   * 빼고」 라고 적는다. 그런데 all 이 지우는 갈래가 하나 더 있다 — reset.js 의
   * `숨은것` (이름 「증거·내보낸 것·임시」, 자리는 `.deel/증거` · `.deel/export` ·
   * **`.deel/tmp`** · `.deel/붙인그림`). 따로 고를 수 없는 갈래라 이름을 미리 볼
   * 자리가 도움말 말고는 없다.
   *
   * 이 판을 재던 중에 `deel reset --hard all --yes` 한 줄이 저장소의 `.deel/tmp`
   * 를 통째로 지웠다. 도움말만 읽은 사람은 그 폴더가 지워진다는 것을 알 길이
   * 없었다. 지우는 목록과 적는 목록을 여기서 맞대 둔다 — 갈래가 하나 늘면
   * 도움말을 안 고친 판이 여기서 빨개진다.
   */
  {
    const { 살펴보기 } = await import('../src/reset.js');
    const 지울것 = 살펴보기({ home, root: work }).항목.filter((x) => x.all).map((x) => x.이름);
    const 안적힌것 = 지울것.filter((이름) => !r.out.includes(이름));
    check('★ --help 가 reset all 로 지워지는 갈래를 다 적는다', 안적힌것.length === 0,
      `안 적힘: ${안적힌것.join(' · ') || '없음'}  (지우는 것: ${지울것.join(' · ')})`);
  }

  const h2 = await 띄우기(['help']);
  check('help 도 --help 와 같다', h2.code === 0 && /사용법/.test(h2.out), `code=${h2.code}`);

  const h3 = await 띄우기(['-h']);
  check('-h 도 같다', h3.code === 0 && /사용법/.test(h3.out), `code=${h3.code}`);

  /*
   * 판 번호는 **연결이 없어도** 나와야 한다.
   *
   * `deel --version` 은 "이게 깔려 있나, 무슨 판인가" 를 묻는 것이지 일을 시키는
   * 것이 아니다. 전에는 설정이 없다는 말이 먼저 나와서, 깔린 것 자체가 아닌 줄
   * 알았다. 사내에 반입한 판을 확인할 때 제일 먼저 치는 명령이라 그러면 안 된다.
   * (이 검사는 설정이 빈 임시 폴더에서 돈다 — 그래서 이 자리가 실제로 재진다.)
   */
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
  for (const 꼴 of [['--version'], ['-v'], ['version']]) {
    const v = await 띄우기(꼴);
    check(`${꼴[0]} 가 판 번호를 말한다`,
      v.code === 0 && v.out.includes(pkg.version), `code=${v.code} · ${v.out.trim().slice(0, 40)}`);
  }
  const v1 = await 띄우기(['--version']);
  check('--version 에 Node 판과 OS 도 같이 적는다', /Node \d+\./.test(v1.out) && /win32|darwin|linux/.test(v1.out),
    v1.out.trim());
  check('--version 이 연결 없다는 말을 먼저 내지 않는다', !/저장된 연결이 없습니다/.test(v1.out),
    v1.out.trim().slice(0, 60));
}

{
  const r = await 띄우기(['그런명령없음']);
  // 모르는 명령도 인자를 잘못 준 것이다 — 모르는 깃발과 같은 64(사용법 틀림). 1 이면 「돌다가 오류」 와 못 가른다.
  check('★ 모르는 명령은 64(사용법 틀림)로 끝난다', r.code === 64, `code=${r.code}`);
  check('모르는 명령이라고 말해 준다', /모르는 명령/.test(r.out), '');
  check('그러면서 사용법도 보여 준다', /사용법/.test(r.out), '');
}

trace('2-상태와진단');

{
  const r = await 띄우기(['status']);
  check('status 가 끝난다', r.code === 0 && !r.시간초과, `code=${r.code}`);
  check('status 가 모델 이름을 보여 준다', /스텁모델/.test(r.out), r.out.slice(0, 80));
  check('status 가 주소를 보여 준다', r.out.includes(String(port)), '');
}

{
  // 진단은 스텁 서버를 상대로 실제 요청을 여러 번 보낸다.
  // 여기서 backend/probe.js 와 report.js 가 돈다.
  받은요청 = [];
  const 보고서 = join(work, 'report.txt');
  const r = await 띄우기(['diagnose', '--out', 보고서], { 제한: 60000 });
  check('diagnose 가 끝난다', !r.시간초과, `code=${r.code}`);
  check('diagnose 가 모델과 이야기했다', 받은요청.some((x) => x.url === '/v1/chat/completions'), `요청 ${받은요청.length}건`);
  check('diagnose 가 컨텍스트 길이를 읽는다', /262,144|262144/.test(r.out), '');
  check('diagnose 가 보고서 파일을 쓴다', existsSync(보고서), 보고서);
  if (existsSync(보고서)) {
    const 글 = readFileSync(보고서, 'utf8');
    check('보고서에 색 코드가 안 들어간다', !/\x1b\[/.test(글), '평문이어야 사내로 전달할 수 있다');
    check('보고서에 판정이 들어간다', /준비됨|제한적|막힘|연결실패/.test(글), 글.slice(0, 60));
  }

  /*
   * doctor 는 이제 diagnose 의 다른 이름이 아니다 (1.17.0).
   *
   * diagnose 는 「모델이 일을 할 수 있나」 를 재고, doctor 는 그 **앞자락** —
   * 프록시·인증서·열쇠·모델 목록 — 을 하나씩 본다. 사내에서 막히는 자리가
   * 대부분 그 앞이라 화면을 따로 냈다 (src/doctor.js).
   */
  const d2 = await 띄우기(['doctor'], { 제한: 60000 });
  check('★ doctor 는 붙기 전 조건을 하나씩 본다',
    !d2.시간초과 && /프로필/.test(d2.out) && /주소/.test(d2.out) && /도달/.test(d2.out),
    `code=${d2.code} ${d2.out.split('\n').filter(Boolean).slice(-3).join(' / ')}`);
}

/*
 * ── `deel config explain` 의 끝값 ──────────────────────────────────────
 *
 * 찾았나 못 찾았나가 `return r.이긴층 ? 0 : 0` 이었다 — 두 갈래를 적어 놓고 같은
 * 수를 냈다. 그래서 오타를 친 칸도, 아무 데도 안 적힌 칸도 **성공**으로 끝났다.
 * 이 명령은 스크립트에서 값의 출처를 캐묻는 데 쓰라고 만든 것이고, 그 길에서
 * 끝값은 유일한 계약이다. 화면 글자를 grep 하게 만들면 계약이 아니다.
 *
 * 끝값은 CLI 로만 잴 수 있다 — 설명() 을 직접 불러서는 안 보인다.
 */
{
  const 있는것 = await 띄우기(['config', 'explain', 'profiles.stub.model']);
  check('★ 적힌 자리를 찾으면 0 으로 끝난다', 있는것.code === 0 && /스텁모델/.test(있는것.out),
    `code=${있는것.code}`);
  const 없는것 = await 띄우기(['config', 'explain', '아무데도없는칸']);
  check('★★ 아무 데도 안 적힌 칸은 0 으로 끝내지 않는다',
    없는것.code === 1 && /아무 데도 안 적혀/.test(없는것.out), `code=${없는것.code}`);
  const 제이슨 = await 띄우기(['config', 'explain', '아무데도없는칸', '--json']);
  check('★ --json 도 같은 끝값을 낸다 (기계가 읽는 쪽만 다르면 계약이 둘이 된다)',
    제이슨.code === 1 && /"이긴층":null/.test(제이슨.out.replace(/\s/g, '')), `code=${제이슨.code}`);

  /*
   * 금지·허락은 **합쳐지는** 칸이라 이긴 층이 없다 (configexplain 의 합치는칸).
   * 이긴 층만 보고 끝값을 정하면, 분명히 걸려 있는 규칙을 물었는데 「못 찾았다」 가 된다.
   */
  const 원래설정 = readFileSync(join(home, 'config.json'), 'utf8');
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    ...JSON.parse(원래설정), permissions: { deny: ['Bash(curl*)'] },
  }, null, 2), 'utf8');
  const 합침 = await 띄우기(['config', 'explain', 'permissions.deny']);
  check('★★ 합쳐져 걸리는 칸은 이긴 층이 없어도 찾은 것이다',
    합침.code === 0 && /합쳐져 다 걸립니다/.test(합침.out), `code=${합침.code}`);
  writeFileSync(join(home, 'config.json'), 원래설정, 'utf8');
}

trace('3-대화화면');

{
  // 대화 화면을 실제로 돌린다. 여기서 repl.js·status.js·ui/* 가 돈다.
  받은요청 = [];
  도구한번 = false;
  const r = await 띄우기([], {
    입력: [
      '안녕',                       // 종합 → 안 옮김
      '이 파일 좀 읽어줘',           // 도구 호출까지
      '/context',
      '/ctx',
      '/status',
      '/tools',
      '/cost',
      '/work',
      '/plan',                      // 사람이 직접 고름
      '/auto',
      '로그인이 왜 안 되지?',        // 저절로 디버그로
      '/think high',
      '/mode confirm',
      '/level 쉬움',
      '/help',
      '/clear',
      '/exit',
    ],
    제한: 60000,
  });
  check('대화 화면이 스스로 끝난다', r.code === 0 && !r.시간초과, `code=${r.code}${r.시간초과 ? ' 시간초과' : ''}`);
  check('머리말에 모델이 뜬다', /스텁모델/.test(r.out), '');
  check('컨텍스트를 모델에서 긁어왔다', /262,144|256k/.test(r.out), '설정값 32768 이 아니라 서버 값이어야 한다');
  check('모델이 답한 것이 화면에 뜬다', /스텁 모델이 답했습니다/.test(r.out), '');
  // 답에 왼쪽 세로줄을 세운다. 전에는 들여쓰기도 색도 도구 줄과 같아서,
  // 도구 이름·결과·바뀐 자리가 줄줄이 지나간 끝에 답이 섞여 있었다 —
  // 화면을 훑어서는 '모델이 뭐라고 했는지' 를 눈으로 찾을 수가 없었다.
  check('모델 답에 표시가 붙는다', /▌ .*스텁 모델이 답했습니다/.test(r.out),
    (r.out.split('\n').find((l) => /스텁 모델이 답했습니다/.test(l)) ?? '').slice(0, 80));
  // 상태줄은 세 덩이. 여섯 칸으로 되돌아가면 여기서 잡힌다.
  {
    const 상태 = r.out.split('\n').find((l) => /▏/.test(l) && /스텁모델/.test(l)) ?? '';
    check('상태줄이 세 덩이로 나온다', 상태.split('▏').slice(1).length === 3, 상태.trim());
  }
  check('도구를 부르면 화면에 그린다', /Read/.test(r.out), '');
  check('종합에서 디버그로 저절로 옮긴다', /디버그/.test(r.out), '');
  check('직접 고르면 안 바뀐다고 알려 준다', /저절로 바뀌지 않습니다/.test(r.out), '');
  check('/help 가 명령 목록을 낸다', /명령 목록|clear|compact/.test(r.out), '');
  check('/tools 가 도구를 보여 준다', /Write|Edit/.test(r.out), '');
  check('/exit 로 끝맺음 인사를 한다', /끝냅니다/.test(r.out), '');
  check('오류 없이 끝났다', !/에러|Error|Traceback/.test(r.err), r.err.slice(0, 120));
}

trace('4-깃발');

{
  // 시작할 때 주는 깃발들이 실제로 먹는가.
  const r = await 띄우기(['--work', 'plan', '--think', 'high', '--effort', 'deep', '--ctx', '128k', '--level', '개발자'], {
    입력: ['/work', '/ctx', '안녕', '/exit'],
    제한: 40000,
  });
  check('--work plan 으로 시작한다', /계획/.test(r.out), '');
  check('--ctx 가 서버 값을 이긴다', /131,072|128k/.test(r.out), '사람이 준 값을 저절로 뒤집으면 안 된다');
  check('--ctx 를 줬으면 서버에 안 묻는다', !/컨텍스트를 .* 로 맞췄습니다/.test(r.out), '');
  check('깃발을 줘도 끝난다', r.code === 0 && !r.시간초과, `code=${r.code}`);

  // 수준에 따라 화면이 얼마나 시끄러운가.
  //
  // '이어가기·low 생각 중…' 은 우리 내부 단계 이름과 추론 강도다. 개발자에게는
  // 강도 조절이 실제로 먹는지 보여 주는 유일한 창이지만, 쉬움 수준에서는
  // 고를 일도 없는 것을 먼저 걱정하게 만드는 글자일 뿐이다.
  check('개발자 수준에는 단계·강도를 붙인다', /(첫 판단|이어가기|막혔을 때)·\w+ 생각 중/.test(r.out),
    (r.out.split('\n').find((l) => /생각 중/.test(l)) ?? '').trim().slice(0, 60));

  const 쉬 = await 띄우기(['--level', '쉬움'], { 입력: ['안녕', '/exit'], 제한: 40000 });
  check('쉬움 수준에는 그냥 생각 중이라고만 한다',
    /생각 중/.test(쉬.out) && !/(첫 판단|이어가기|막혔을 때)·/.test(쉬.out),
    (쉬.out.split('\n').find((l) => /생각 중/.test(l)) ?? '').trim().slice(0, 60));
}

{
  // 오프라인 자물쇠. 이 프로젝트에서 가장 중요한 약속이다.
  const r = await 띄우기(['--offline'], { 입력: ['/status', '/exit'], 제한: 40000 });
  check('--offline 이 화면에 표시된다', /오프라인/.test(r.out), '');
  check('오프라인이어도 이 컴퓨터 안 서버와는 이야기한다', r.code === 0 && !r.시간초과, `code=${r.code}`);
}

trace('4-2-대화화면의나머지갈래');

// ── 화면이 그려야 하는 나머지 상황들 ────────────────────────────────────
//
// 모델이 늘 곱게 답하지 않는다. 오류·잘림·생각·할 일·걸음 수 초과가 실제로 온다.
// 이 자리들은 손으로 만들기 어려워 그동안 한 번도 안 돌아 봤다.
{
  대본초기화();
  const r = await 띄우기([], {
    입력: [
      '일부러_터뜨려 주세요',      // 모델이 500 을 준다
      '일부러_생각 해봐',          // reasoning_content 가 온다
      '일부러_할일 목록 좀',       // TodoWrite
      '/exit',
    ],
    제한: 60000,
  });
  const 글 = r.out;
  check('모델 오류를 화면에 보여 준다', /오류|일부러 낸 오류|실패/.test(글), 글.slice(-300));
  check('오류가 나도 대화가 안 끝난다', r.code === 0 && !r.시간초과, `code=${r.code}`);
  // 앞 판의 /생각/ 은 흉내 모델의 **답**(「다 생각했습니다」)에 걸려서, 생각 줄이 안 그려져도 초록이었다.
  // 도는 동안의 「생각 중…」 줄은 임시라 파이프에서는 안 남는다. 끝나고 남는 「생각 N자」 줄을 본다.
  check('모델의 생각을 따로 그린다', /생각 [\d,]+자/.test(글), 글.slice(-300));
  check('할 일 목록을 그린다', /첫째 할 일/.test(글) && /둘째 할 일/.test(글), 글.slice(-300));
}

{
  // 잘린 답을 다시 받아 오는 자리.
  //
  // 이 갈래는 '아껴 잡은 상한' 이 '풀었을 때의 상한' 보다 작을 때만 돈다.
  // 컨텍스트가 크면 둘 다 울타리(16,384)에 걸려 같아지므로 아예 안 밟힌다.
  // 그래서 일부러 작은 컨텍스트로 띄운다 — 작은 로컬 모델에서 실제로 이렇다.
  대본초기화();
  const r = await 띄우기(['--ctx', '4096'], { 입력: ['일부러_잘림 답을 줘', '/exit'], 제한: 60000 });
  check('잘린 답은 상한을 풀어 다시 받는다', /이번엔 끝까지 썼습니다/.test(r.out),
    '잘린 채로 두면 도구 호출이 반토막 나서 조용히 실패한다');
}

{
  /*
   * ── 바뀌는 것이 없으면 **다시 안 부른다** ──────────────────────────────
   *
   * 상한을 못 올리는 자리에서 생각까지 0이면, 다시 부른 요청은 앞엣것과
   * 똑같다. 똑같은 요청은 똑같은 자리에서 또 잘린다 — 그런데 그 한 번에
   * 프리픽스 전체와 출력 상한 전체를 다시 낸다. 실제 게이트웨이 청구서에서
   * 그날 제일 비싼 줄이 그 헛부름이었다 (프리픽스 122K · 출력 16K).
   *
   * 그래서 **부른 횟수를 센다.** 화면 글로 재면 문구를 바꿀 때마다 검사가
   * 깨지고, 무엇보다 「안 불렀다」 는 화면에 안 나타난다. 서버가 몇 번
   * 불렸는지가 이 약속의 유일한 진짜 증거다.
   */
  대본초기화();
  const r = await 띄우기(['--ctx', '4096'], { 입력: ['일부러_맨잘림 답을 줘', '/exit'], 제한: 60000 });
  /*
   * 머리말이 「부른 횟수를 센다」 라고 적어 놓고 **화면 글을 재고 있었다**
   * (16회차). 그 글은 「생각 중…」 줄에 잠깐 실렸다 지워지는 임시 줄이라,
   * 기계가 빠르면 그 한 번을 아예 안 그린다 — 리눅스 CI 에서 이 줄만
   * 빨개졌다. 약속(「다시 안 부른다」)은 화면이 아니라 **스텁이 몇 번
   * 불렸나**에 있다. 적어 둔 대로 그것을 잰다.
   */
  check('생각이 0인데 잘린 답은 다시 안 부른다', 헛잘림셈 === 1, `스텁이 ${헛잘림셈}번 불렸습니다`);
  // 그래도 사람에게는 말해 줘야 한다 — 잘린 채로 조용히 지나가면 안 된다.
  check('대신 잘렸다는 것과 손댈 자리를 알려 준다', /잘렸습니다/.test(r.out) && /\/out/.test(r.out),
    r.out.slice(-300));
}

{
  /*
   * ── 생각이 **안 보여도** 잰다 ─────────────────────────────────────────
   *
   * 게이트웨이가 생각 블록을 지워서 넘기면 생각 글도 추론 토큰 셈도 0 이다.
   * 그것만 보고 「생각을 안 했다」 로 읽으면, 정말로 예산을 다 생각에 쓰다
   * 잘린 턴에서 다시 부르기를 그만둔다 — 관측이 없는 것을 사건이 없는 것으로
   * 읽는 것이다.
   *
   * 낸 토큰은 안 지워진다. 보이는 글이 짧은데 낸 토큰이 상한에 닿았다면
   * 그 차이가 곧 안 보이는 생각이고, 그때는 눈금을 내리면 자리가 난다.
   */
  대본초기화();
  const r숨 = await 띄우기(['--ctx', '4096'], { 입력: ['일부러_숨은생각 답을 줘', '/exit'], 제한: 60000 });
  check('생각이 안 보여도 낸 토큰으로 재어 다시 부른다',
    /생각을 줄이니 끝까지 썼습니다/.test(r숨.out), r숨.out.slice(-300));
}

{
  // 걸음 수 상한. 모델이 도구만 계속 부르면 어딘가에서 멈춰 세워야 한다 —
  // 안 멈추면 사내 게이트웨이 할당량을 혼자 다 쓴다.
  대본초기화();
  const r = await 띄우기(['--work', 'ask'], { 입력: ['/code', '일부러_끝없이 읽어줘', '/exit'], 제한: 90000 });
  check('도구만 계속 불러도 멈춰 세운다', r.code === 0 && !r.시간초과, `code=${r.code}${r.시간초과 ? ' 시간초과 — 안 멈췄다' : ''}`);
  check('왜 멈췄는지 알려 준다', /걸음|상한|한도|멈췄|그만/.test(r.out), r.out.slice(-260));
}

{
  // 컨텍스트가 차면 접는다. 작게 잡아 두면 몇 마디 만에 그 자리에 닿는다.
  //
  // 작은 로컬 모델(2k·4k)에서는 이게 몇 마디 만에 실제로 벌어진다.
  // 여기서 안 접히면 그다음 요청이 통째로 거절되면서 대화가 끝난다.
  대본초기화();
  const r = await 띄우기(['--ctx', '2048'], {
    입력: ['일부러_길게 써줘', '일부러_길게 또 써줘', '일부러_길게 계속', '일부러_길게 더', '/context', '/exit'],
    제한: 90000,
  });
  // 앞 판의 /접|줄|요약|오래된/ 은 상태줄·도움말의 「줄」 한 글자에도 걸렸다 — 안 접혀도 초록이었다.
  // 실제로 접거나 비웠다고 알리는 줄만 받는다.
  check('컨텍스트가 차면 접거나 줄인다',
    /오래된 도구 결과 \d+개를 접었습니다|대화 \d+개를 요약으로 접었습니다|옛 대화 \d+개를 잘라 냈습니다|앞선 대화 \d+개를 비우고/.test(r.out),
    r.out.slice(-400));
  check('접는 중에도 끝까지 돈다', r.code === 0 && !r.시간초과, `code=${r.code}`);
}

{
  // 한 번에 여러 도구를 부를 때. 읽기끼리는 같이 돌린다 —
  // 그 자리를 화면이 제대로 그리는지 본다.
  대본초기화();
  const r = await 띄우기([], { 입력: ['일부러_여럿 해줘', '/exit'], 제한: 60000 });
  check('여러 도구를 한 번에 그린다', /Read/.test(r.out) && /Glob/.test(r.out) && /Grep/.test(r.out), r.out.slice(-400));
  check('여러 개를 돌려도 끝까지 간다', r.code === 0 && !r.시간초과, `code=${r.code}`);
}

{
  // 엄격 모드에서 물어보는 자리. 사람이 답해야 넘어간다.
  대본초기화();
  const r = await 띄우기([], { 입력: ['/mode strict', '일부러_고쳐 줘', 'n', '/exit'], 제한: 60000 });
  check('엄격 모드는 고치기 전에 물어본다', /실행할까요/.test(r.out), r.out.slice(-300));
  check('아니오라고 하면 안 고친다', !existsSync(join(work, '새로쓴것.txt')), '');
  check('거부해도 대화가 이어진다', r.code === 0 && !r.시간초과, `code=${r.code}`);
}

{
  대본초기화();
  const r = await 띄우기([], { 입력: ['/mode strict', '일부러_고쳐 줘', 'y', '/exit'], 제한: 60000 });
  check('예라고 하면 실제로 고친다', existsSync(join(work, '새로쓴것.txt')), '');
  rmSync(join(work, '새로쓴것.txt'), { force: true });
}

{
  /*
   * ── ★★ 아무도 안 답했는데 저절로 승인되던 자리 (8회차 화면1526) ──────────
   *
   * 「실행할까요? (y/n)」 만 `끝나면` 이 없었다. repl 의 ask 는 입력이 **끝난**
   * 경우(파이프·Ctrl+D)에 `끝나면 ?? def` 를 답으로 삼는데, 여기 def 가 'y' 다.
   * 그래서 `echo '/mode strict' | deel` 처럼 앞자리에 사람이 없는 판에서,
   * 물음이 뜨자마자 EOF 로 **승인**이 되고 파일이 고쳐졌다. 같은 파일의
   * 「띄울까요?」·「나가도 될까요?」 는 이미 `끝나면: 'n'` 이다.
   *
   * 여기서는 답을 **한 줄도 안 넣는다.** 물음이 뜬 자리에서 stdin 이 닫힌다.
   */
  대본초기화();
  rmSync(join(work, '새로쓴것.txt'), { force: true });
  const r = await 띄우기([], { 입력: ['/mode strict', '일부러_고쳐 줘'], 제한: 60000 });
  check('엄격 모드에서 EOF 로 물음이 끝나도 물어보긴 했다', /실행할까요/.test(r.out), r.out.slice(-300));
  check('★★ 아무도 안 답하고 입력이 끝나면 실행을 거절한다 — 저절로 승인 안 된다',
    !existsSync(join(work, '새로쓴것.txt')),
    existsSync(join(work, '새로쓴것.txt')) ? 'EOF 가 y 로 읽혀 파일이 만들어졌다' : '');
  check('EOF 로 거절해도 멀쩡히 끝난다', r.code === 0 && !r.시간초과, `code=${r.code}`);
  rmSync(join(work, '새로쓴것.txt'), { force: true });
}

trace('4-3-이어하기');

{
  // 대화를 남긴 다음 --continue 로 이어한다. 이어지는지가 이 기능의 전부다.
  대본초기화();
  await 띄우기([], { 입력: ['첫 대화에서 한 말입니다', '/exit'], 제한: 40000 });

  대본초기화();
  const r = await 띄우기(['--continue'], { 입력: ['/context', '/exit'], 제한: 40000 });
  check('--continue 가 지난 대화를 이어한다', /이어|계속|지난/.test(r.out) || (받은요청.some((x) => JSON.stringify(x.json ?? {}).includes('첫 대화에서 한 말입니다'))),
    r.out.slice(0, 300));
  check('--continue 도 정상 종료한다', r.code === 0 && !r.시간초과, `code=${r.code}`);

  // 없는 이름으로 이어하려 하면 안내가 나와야 한다.
  대본초기화();
  const r2 = await 띄우기(['--resume', '그런대화없음'], { 입력: ['/exit'], 제한: 30000 });
  check('없는 대화를 이어하려 하면 알려 준다', /없|찾/.test(r2.out), r2.out.slice(0, 200));
}

trace('5-훑기와대화목록');

{
  // 훑기는 예전에 결과를 다 찍고도 abort 로 죽었다(3221226505).
  // 종료코드를 보는 것이 이 검사의 핵심이다.
  const r = await 띄우기(['scan', '--ports', String(port)], { 제한: 60000 });
  check('scan 이 정상 종료코드로 끝난다', r.code === 0, `code=${r.code} — 3221226505 면 libuv abort`);
  check('scan 이 스텁 서버를 찾는다', r.out.includes(String(port)), r.out.slice(-200));

  // 훑기가 마주치는 다른 모양의 서버들.
  //
  // 로컬 서버라고 다 같지 않다 — 키를 요구하는 것도, 런타임만 떠 있고 모델을
  // 하나도 안 받아 둔 것도 있다. 그 둘을 '그냥 못 찾음' 으로 뭉뚱그리면
  // 사람은 무엇을 고쳐야 하는지 모른다.
  const 키필요 = createServer((q, s) => { s.writeHead(401, { 'content-type': 'application/json' }); s.end('{"error":"unauthorized"}'); });
  const 모델없음 = createServer((q, s) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end('{"data":[]}'); });
  const 좋은모델 = createServer((q, s) => {
    s.writeHead(200, { 'content-type': 'application/json' });
    s.end(JSON.stringify({ data: [{ id: 'qwen2.5-coder-7b-instruct' }] }));
  });
  await new Promise((z) => 키필요.listen(0, '127.0.0.1', z));
  await new Promise((z) => 모델없음.listen(0, '127.0.0.1', z));
  await new Promise((z) => 좋은모델.listen(0, '127.0.0.1', z));
  const p2 = 키필요.address().port;
  const p3 = 모델없음.address().port;
  const p4 = 좋은모델.address().port;

  const 여러가지 = await 띄우기(['scan', '--ports', [p2, p3, p4].join(',')], { 제한: 90000 });
  check('키가 필요한 서버라고 짚어 준다', /키가 필요합니다/.test(여러가지.out), 여러가지.out.slice(0, 700));
  check('모델이 하나도 없는 서버도 짚어 준다', /모델이 하나도 없습니다/.test(여러가지.out), 여러가지.out.slice(0, 700));
  check('쓸 만한 모델을 추천해 준다', /추천/.test(여러가지.out) && /qwen2\.5-coder/.test(여러가지.out), 여러가지.out.slice(-400));
  check('왜 추천하는지 이유를 댄다', /코딩용 모델|도구 호출/.test(여러가지.out), 여러가지.out.slice(-300));
  check('여러 모양이 섞여도 정상 종료한다', 여러가지.code === 0, `code=${여러가지.code}`);

  키필요.close(); 모델없음.close(); 좋은모델.close();

  // 훑고 나면 다음에 무엇을 할지 알려 줘야 한다.
  //
  // '아무것도 못 찾았을 때' 는 여기서 단정하지 않는다. --ports 는 기본 자리에
  // '더하는' 것이라 비울 수가 없고, 검사를 돌리는 PC 에 진짜 로컬 서버가
  // 떠 있을 수도 있다. 그런 단정은 사람에 따라 됐다 안 됐다 하는 검사가 된다.
  check('훑은 뒤 다음에 할 것을 알려 준다', /--save|--pick|\/model|없습니다/.test(r.out), r.out.slice(-240));

  // --save 는 찾은 것을 설정에 등록한다. '이 PC 에 여러 로컬' 을 쓰는 길이다.
  //
  // 이미 등록된 것은 다시 안 넣는다(그게 맞다). 그래서 등록되지 않은 상태에서
  // 시작해야 '실제로 늘었는가' 를 볼 수 있다.
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, active: '다른것', level: '개발자',
    profiles: [{ id: '다른것', name: '상관없는 연결', kind: 'openai', baseUrl: 'http://127.0.0.1:1/v1', auth: 'none', apiKey: '', model: 'x' }],
  }, null, 2), 'utf8');

  const 저장 = await 띄우기(['scan', '--ports', String(port), '--save'], { 제한: 60000 });
  check('scan --save 가 정상 종료한다', 저장.code === 0, `code=${저장.code}`);
  check('등록했다고 말해 준다', /등록/.test(저장.out), 저장.out.slice(-220));
  const cfg = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'));
  check('찾은 서버가 설정에 들어간다', cfg.profiles.some((p) => String(p.baseUrl).includes(String(port))),
    cfg.profiles.map((p) => p.baseUrl).join(' · '));
  check('원래 있던 연결은 안 지운다', cfg.profiles.some((p) => p.id === '다른것'),
    '등록이 덮어쓰기가 되면 사람이 적어 둔 연결이 날아간다');

  // 뒤에 오는 검사들이 쓰는 설정을 원래대로 돌려놓는다.
  설정쓰기();
}

{
  const r = await 띄우기(['sessions']);
  check('sessions 가 끝난다', r.code === 0 && !r.시간초과, `code=${r.code}`);
  check('sessions 가 이 폴더의 대화를 센다', /대화|없습니다|개/.test(r.out), r.out.slice(0, 80));
}

trace('6-설정이없을때');

{
  // 처음 켠 사람의 자리. 안내가 안 나오면 아무것도 못 한다.
  const 빈집 = mkdtempSync(join(tmpdir(), 'deel-cli-empty-'));
  const r = await 띄우기([], { env: { DEEL_HOME: 빈집 }, 제한: 20000 });
  check('연결이 없으면 1 로 끝난다', r.code === 1, `code=${r.code}`);
  check('무엇을 하라고 알려 준다', /deel setup/.test(r.out), r.out.slice(0, 120));
  rmSync(빈집, { recursive: true, force: true });
}

{
  // 연결이 없어 끝나도 모아 둔 소식은 낸다. 안 믿는 폴더의 설정을 안 읽은 것이 바로
  // 연결이 없는 까닭일 수 있다 — 소식을 비우는 자리가 이 끝남보다 아래였다.
  const 빈집 = mkdtempSync(join(tmpdir(), 'deel-cli-empty2-'));
  const 방 = mkdtempSync(join(tmpdir(), 'deel-cli-empty2-work-'));
  mkdirSync(join(방, '.deel'), { recursive: true });
  writeFileSync(join(방, '.deel', 'config.json'),
    JSON.stringify({ profiles: [{ id: 'r', baseUrl: 'http://127.0.0.1:1', model: 'm' }] }), 'utf8');
  const r = await 띄우기([], { 폴더: 방, env: { DEEL_HOME: 빈집 }, 제한: 20000 });
  check('안 믿는 폴더에서도 연결이 없으면 1 로 끝난다', r.code === 1, `code=${r.code}`);
  check('★★ 연결이 없어도 모아 둔 소식(안 믿는 폴더 설정)을 낸다', /deel trust/.test(`${r.out}${r.err ?? ''}`),
    `${r.out}${r.err ?? ''}`.replace(/\s+/g, ' ').slice(0, 120));
  rmSync(빈집, { recursive: true, force: true });
  rmSync(방, { recursive: true, force: true });
}

trace('7-반입묶음');

{
  const 묶음 = join(work, '반입.zip');
  const r = await 띄우기(['pack', '--out', 묶음], { 제한: 60000 });
  check('pack 이 끝난다', r.code === 0 && !r.시간초과, `code=${r.code}`);
  check('pack 이 zip 을 만든다', existsSync(묶음), 묶음);
  if (existsSync(묶음)) {
    const buf = readFileSync(묶음);
    check('만든 것이 진짜 zip 이다', buf[0] === 0x50 && buf[1] === 0x4b, [...buf.slice(0, 4)].join(','));
    check('빈 파일이 아니다', buf.length > 10000, `${buf.length}바이트`);
  }

  const a = await 띄우기(['audit'], { 제한: 40000 });
  check('audit 이 끝난다', a.code === 0 && !a.시간초과, `code=${a.code}`);
  check('audit 이 의존성 0개를 못 박는다', /의존성|0개|없음/.test(a.out), a.out.slice(0, 100));
}

// ── 9. ★ `--work` 에 오타를 치면 ───────────────────────────────────────
/*
 * 모르는 모드 이름은 조용히 기본값(종합)으로 떨어진다. 종합은 Write·Edit·
 * Bash 를 다 가진 모드다 — 「파일은 안 건드리는」 모드로 켠 줄 알고 고칠 수
 * 있는 상태로 도는 것이, 안 켜지는 것보다 훨씬 나쁘다.
 *
 * 판 번호·도움말은 무엇을 잘못 쳤든 답해야 한다. 그 둘도 같이 잰다.
 */
trace('9-모드오타');
{
  const 오타 = await 띄우기(['--work', 'architcet', '-p', '안녕'], { 제한: 25000 });
  check('★ 모드 이름 오타에 멈춘다 (사용법 틀림 64)', 오타.code === 64, `code=${오타.code}`);
  check('★ 무엇을 잘못 쳤는지 적는다', /architcet/.test(오타.out + 오타.err), (오타.out + 오타.err).slice(0, 120));
  check('★ 있는 모드를 같이 보여 준다', /설계\(architect\)/.test(오타.out + 오타.err), (오타.out + 오타.err).slice(0, 200));
  check('★ 그냥 켜면 고칠 수 있는 모드라고 알려 준다',
    /파일을 고칠 수 있는 모드/.test(오타.out + 오타.err), (오타.out + 오타.err).slice(0, 240));

  const 판 = await 띄우기(['--work', 'architcet', '--version'], { 제한: 25000 });
  check('판 번호는 오타에도 답한다', 판.code === 0 && /deel \d+\.\d+\.\d+/.test(판.out), `code=${판.code} · ${판.out.slice(0, 60)}`);

  const 맞는것 = await 띄우기(['--work', '설계', '--version'], { 제한: 25000 });
  check('맞는 이름은 그대로 지나간다', 맞는것.code === 0, `code=${맞는것.code}`);

  /*
   * ── `--days` 만 옛 규칙에 남아 있었다 (막판-바깥) ──────────────────────
   *
   * 이 판이 `--ctx` · `--max-tokens` 를 「못 읽는 숫자면 멈춘다」 로 고쳤다.
   * 같은 줄에 있던 `--days` 는 안 고쳤다 — `parseInt(…) || 30` 이라 `abc` 도
   * `0` 도 조용히 30일이 된다. 화면은 물어본 적 없는 「최근 30일」 을 찍고
   * 종료코드는 0 이다. 감사 기간을 인자로 받는 배치가 엉뚱한 기간을 세어 놓고
   * 초록불로 넘어간다.
   */
  const 날수오타 = await 띄우기(['stats', '--days', 'abc'], { 제한: 25000 });
  check('★ --days 를 못 읽으면 멈춘다 (64)', 날수오타.code === 64,
    `code=${날수오타.code} · ${(날수오타.out + 날수오타.err).replace(/\s+/g, ' ').slice(0, 120)}`);
  check('  무엇을 잘못 쳤는지 적는다', /--days/.test(날수오타.out + 날수오타.err) && /abc/.test(날수오타.out + 날수오타.err), '');
  const 날수영 = await 띄우기(['stats', '--days', '0'], { 제한: 25000 });
  check('★ --days 0 도 멈춘다 — 조용히 30일로 안 돈다', 날수영.code === 64, `code=${날수영.code}`);
  const 날수성함 = await 띄우기(['stats', '--days', '7'], { 제한: 25000 });
  check('  성한 --days 는 그대로 돈다', 날수성함.code === 0 && /최근 7일/.test(날수성함.out),
    `code=${날수성함.code} · ${(날수성함.out.match(/최근 [^\n]*/) ?? ['(없음)'])[0]}`);

  // `--url=http://x/v1?api-version=2024-10-21` 이 두 번째 `=` 에서 잘렸다. 첫 `=` 에서만 가른다.
  const 등호 = await 띄우기(['--work=architect=x', '-p', '안녕'], { 제한: 25000 });
  check('★ --이름=값 은 첫 = 에서만 가른다', 등호.code === 64 && /architect=x/.test(등호.out + 등호.err),
    `code=${등호.code} · ${(등호.out + 등호.err).replace(/\s+/g, ' ').slice(0, 120)}`);
}

trace('9b-승인모드-깃발');
{
  // 대화 화면도 같은 문을 지난다. 대문자로 적은 이름은 엄격으로 켜지고, 모르는 이름은 멈춘다.
  const 모름 = await 띄우기(['--mode', '엄격'], { 제한: 20000 });
  check('★★ 대화 화면도 모르는 승인 모드면 64 로 멈춘다', 모름.code === 64, `code=${모름.code}`);
  const 대문자 = await 띄우기(['--mode', 'STRICT', '--no-tui'], { 입력: ['/mode', '/exit'], 제한: 40000 });
  check('★★ --mode STRICT 로 켜면 정말 엄격이다', /● ⏸/.test(대문자.out),
    (대문자.out.match(/[●○] ⏸[^\n]*/) ?? ['(목록 없음)'])[0]);
}

trace('9d-설정의-승인모드와-없는-뿌리');
{
  // 이 PC 설정에 적은 mode 는 대화 화면도 따른다. run 과 같은 차례다 (깃발 > 이 PC 설정 > auto).
  const 모드집 = mkdtempSync(join(tmpdir(), 'deel-cli-modehome-'));
  writeFileSync(join(모드집, 'config.json'), JSON.stringify({
    version: 1, active: 'stub', mode: 'strict',
    profiles: [{ id: 'stub', name: '스텁 연결', kind: 'openai', baseUrl: base, auth: 'none', model: '스텁모델', ctx: 32768, tools: true }],
  }), 'utf8');
  const r = await 띄우기(['--no-tui'], { 입력: ['/mode', '/exit'], env: { DEEL_HOME: 모드집 }, 제한: 40000 });
  check('★★ 대화 화면도 이 PC 설정의 mode 를 따른다', /● ⏸/.test(r.out),
    (r.out.match(/● [^\n]*/) ?? ['(목록 없음)'])[0]);
  rmSync(모드집, { recursive: true, force: true });

  // 없는 --root 를 대화·에디터 문도 run 처럼 거절한다. 만들어 놓고 그 안에서 일하지 않는다.
  const 없는곳 = join(work, '없는뿌리', '안쪽');
  const c1 = await 띄우기(['--root', 없는곳], { 제한: 20000 });
  check('★★ 대화 화면도 없는 --root 는 거절한다', c1.code === 1 && !existsSync(join(work, '없는뿌리')),
    `code=${c1.code} · ${(c1.out + c1.err).replace(/\s+/g, ' ').slice(0, 120)}`);
  check('  어느 폴더인지 적는다', (c1.out + c1.err).includes('안쪽'), '');
  const a1 = await 띄우기(['acp', '--root', 없는곳], { 제한: 20000 });
  check('★★ acp 도 없는 --root 는 거절한다', a1.code === 1 && !existsSync(join(work, '없는뿌리')),
    `code=${a1.code} · ${a1.err.replace(/\s+/g, ' ').slice(0, 120)}`);
  check('  acp 는 표준출력을 안 더럽힌다', !a1.out.trim(), JSON.stringify(a1.out.slice(0, 80)));
  rmSync(join(work, '없는뿌리'), { recursive: true, force: true });
}

trace('9e-집-폴더를-믿지-않는다');
{
  /*
   * `deel trust` 는 그 폴더와 **그 아래 전부**를 믿는다. 집 폴더에서 치면 거기 받아 둔
   * 남의 저장소가 다 믿긴다 — 열쇠받기 명령을 도구 승인보다 앞에서 돌릴 수 있는 그 설정이.
   */
  const 살림 = mkdtempSync(join(tmpdir(), 'deel-cli-trust-살림-'));
  const 목록 = () => (existsSync(join(살림, 'trusted.json')) ? readFileSync(join(살림, 'trusted.json'), 'utf8') : '');

  const 집방 = mkdtempSync(join(tmpdir(), 'deel-cli-trusthome-'));
  mkdirSync(join(집방, '.deel'), { recursive: true });
  const t1 = await 띄우기(['trust'], { 폴더: 집방, env: { DEEL_HOME: join(집방, '.deel') } });
  check('★★ 설정 폴더를 품은 집 폴더에서는 믿기를 거절한다',
    t1.code === 1 && !existsSync(join(집방, '.deel', 'trusted.json')), `code=${t1.code}`);
  check('  왜 거절하는지 말한다 — 아래 저장소가 다 믿긴다', /아래/.test(t1.out + t1.err), (t1.out + t1.err).replace(/\s+/g, ' ').slice(0, 160));

  const 가짜집 = mkdtempSync(join(tmpdir(), 'deel-cli-userhome-'));
  const t2 = await 띄우기(['trust'], { 폴더: 가짜집, env: { DEEL_HOME: 살림, USERPROFILE: 가짜집, HOME: 가짜집 } });
  check('★★ 사용자 집 폴더에서도 거절한다', t2.code === 1 && !목록().length, `code=${t2.code}`);

  const 뿌리 = 경로쪼개기(tmpdir()).root;
  const t3 = await 띄우기(['trust'], { 폴더: 뿌리, env: { DEEL_HOME: 살림 } });
  check('★★ 드라이브 뿌리에서도 거절한다', t3.code === 1 && !목록().length, `code=${t3.code} · ${뿌리}`);

  /*
   * 집 폴더를 가리키는 정션(심볼릭 링크) 안에서 치면 지나갔다. resolve 는 링크를 안
   * 따라가서 `…\고리` 는 집 폴더와 다른 글자였다 — 믿긴 것은 그 고리 아래 전부,
   * 곧 집 폴더 전부다. 고리는 **가짜 집**을 가리킨다. 진짜 집은 안 건드린다.
   * 치울 때는 고리만 뗀다 — 고리를 통째로 지우면 가리키는 쪽이 지워질 수 있다.
   */
  const { symlinkSync, unlinkSync, rmdirSync } = await import('node:fs');
  const 고리방 = mkdtempSync(join(tmpdir(), 'deel-cli-trustlink-'));
  const 고리 = join(고리방, '집고리');
  let 고리됨 = false;
  try { symlinkSync(가짜집, 고리, 'junction'); 고리됨 = true; } catch (err) { check('  (고리를 못 만들어 건너뜀)', true, String(err?.code)); }
  if (고리됨) {
    try {
      const t5 = await 띄우기(['trust'], { 폴더: 고리, env: { DEEL_HOME: 살림, USERPROFILE: 가짜집, HOME: 가짜집 } });
      // 거절이 **넓은 자리라서**인지까지 본다 — 믿기() 가 뒤에서 막아 「못 적었습니다」 로
      // 1 이 나와도 사람은 왜인지, 어디로 가서 쳐야 하는지 모른다.
      check('★★ 집 폴더를 가리키는 고리 안에서도 거절한다', t5.code === 1 && !목록().length && /믿을 저장소 폴더로 들어가서/.test(t5.out + t5.err),
        `code=${t5.code} · ${(t5.out + t5.err).replace(/\s+/g, ' ').slice(0, 160)} · ${목록().slice(0, 80)}`);
    } finally {
      try { unlinkSync(고리); } catch { try { rmdirSync(고리); } catch { /* 아래에서 확인한다 */ } }
    }
    check('  고리만 떼고 가리키던 폴더는 그대로다', !existsSync(고리) && existsSync(가짜집), '');
  }

  const t4 = await 띄우기(['trust'], { 폴더: work, env: { DEEL_HOME: 살림 } });
  check('  평범한 작업 폴더는 그대로 믿는다', t4.code === 0 && 목록().length > 0, `code=${t4.code}`);

  for (const x of [살림, 집방, 가짜집, 고리방]) rmSync(x, { recursive: true, force: true });
}

trace('9f-검사할-폴더를-깃발로-받는가');
/*
 * ── `--root` 를 받는 문과 삼키는 문이 갈려 있었다 (막판-바깥) ────────────
 *
 * 이 판이 `load({ root })` 를 만들어 run · chat · acp 를 다 고쳤다. doctor ·
 * stats · config explain · reset 도 `flags.root` 를 본다. 그런데 `rules` 와
 * `trust` 두 문만 옛 길에 남아 `process.cwd()` 를 박아 놓고 있었다.
 *
 * `--root` 는 아는 깃발이라 「모르는 깃발」 문에서도 안 걸린다. 그래서 값은
 * 받아 놓고 아무 일도 안 한다 — 이번 판이 깃발 읽기를 통째로 다시 짠 까닭이
 * 바로 「깃발이 조용히 아무 일도 안 하는 것」 을 없애려는 것이었다.
 *
 *   deel rules check --root $REPO   ← CI 가 딴 저장소 규칙을 재고 초록을 낸다
 *   deel trust --root $REPO         ← 믿으려던 곳 말고 켠 자리가 믿는 목록에 적힌다
 */
{
  const 살림 = mkdtempSync(join(tmpdir(), 'deel-cli-root살림-'));
  const 갑 = mkdtempSync(join(tmpdir(), 'deel-cli-root갑-'));
  const 을 = mkdtempSync(join(tmpdir(), 'deel-cli-root을-'));
  mkdirSync(join(갑, '.deel'), { recursive: true });
  mkdirSync(join(을, '.deel'), { recursive: true });
  writeFileSync(join(갑, '.deel', 'config.json'), JSON.stringify({ permissions: { deny: ['Bash(갑것*)'] } }), 'utf8');
  writeFileSync(join(을, '.deel', 'config.json'), JSON.stringify({ permissions: { deny: ['Bash(을것*)'] } }), 'utf8');
  await 띄우기(['trust'], { 폴더: 갑, env: { DEEL_HOME: 살림 } });
  await 띄우기(['trust'], { 폴더: 을, env: { DEEL_HOME: 살림 } });

  const r1 = await 띄우기(['rules'], { 폴더: 갑, env: { DEEL_HOME: 살림 } });
  check('  rules 는 켠 자리의 규칙을 보여 준다', /갑것/.test(r1.out), (r1.out.match(/Bash\([^\n]*/) ?? ['(없음)'])[0]);
  const r2 = await 띄우기(['rules', '--root', 을], { 폴더: 갑, env: { DEEL_HOME: 살림 } });
  check('★ rules 가 --root 로 준 폴더의 규칙을 본다', /을것/.test(r2.out) && !/갑것/.test(r2.out),
    (r2.out.match(/Bash\([^\n]*/) ?? ['(없음)'])[0]);

  const 살림2 = mkdtempSync(join(tmpdir(), 'deel-cli-root살림2-'));
  const t1 = await 띄우기(['trust', '--root', 을], { 폴더: 갑, env: { DEEL_HOME: 살림2 } });
  const 적힌것 = await 띄우기(['trust', '--list'], { 폴더: 갑, env: { DEEL_HOME: 살림2 } });
  check('★ trust 가 --root 로 준 폴더를 믿는다 — 켠 자리가 아니라',
    t1.code === 0 && 적힌것.out.includes(을) && !적힌것.out.includes(갑),
    `code=${t1.code} · ${적힌것.out.replace(/\s+/g, ' ').slice(0, 200)}`);

  // 없는 폴더를 믿는 목록에 적지 않는다. 적어 두면 그 이름으로 폴더가 생기는 날 바로 믿긴다.
  const 없는곳 = join(을, '없는저장소');
  const t2 = await 띄우기(['trust', '--root', 없는곳], { 폴더: 갑, env: { DEEL_HOME: 살림2 } });
  const 적힌것2 = await 띄우기(['trust', '--list'], { 폴더: 갑, env: { DEEL_HOME: 살림2 } });
  check('★ 없는 --root 는 믿는 목록에 안 적는다', t2.code !== 0 && !적힌것2.out.includes('없는저장소'),
    `code=${t2.code} · ${(t2.out + t2.err).replace(/\s+/g, ' ').slice(0, 140)}`);

  for (const x of [살림, 살림2, 갑, 을]) rmSync(x, { recursive: true, force: true });
}

trace('9c-설정이-깨졌을때');
{
  // doctor 가 깨진 설정을 「✓ 설정 파일」 로 적고 까닭은 한 줄도 안 냈다.
  const 깨진집 = mkdtempSync(join(tmpdir(), 'deel-cli-broken-'));
  writeFileSync(join(깨진집, 'config.json'), '{ "profiles": [ ,', 'utf8');
  const d = await 띄우기(['doctor'], { env: { DEEL_HOME: 깨진집 }, 제한: 20000 });
  check('★★ doctor 가 깨진 설정을 ✗ 로 적는다', d.code === 1 && /✗ 설정 파일/.test(d.out), d.out.replace(/\s+/g, ' ').slice(0, 200));
  check('★★ doctor 가 왜 못 읽었는지 적는다', /JSON/.test(d.out), d.out.replace(/\s+/g, ' ').slice(0, 200));
  check('  ✓ 설정 파일 이라고 하지 않는다', !/✓ 설정 파일/.test(d.out), '');
  rmSync(깨진집, { recursive: true, force: true });

  // 표준입력이 닫힌 채 setup — 목록 한가운데서 0 으로 끝나고 설정도 없었다.
  const 빈집 = mkdtempSync(join(tmpdir(), 'deel-cli-setup-'));
  const s = await 띄우기(['setup'], { env: { DEEL_HOME: 빈집 }, 제한: 20000 });
  check('★★ 답할 수 없는 setup 은 1 로 끝난다', s.code === 1 && !s.시간초과, `code=${s.code}`);
  check('  설정을 안 남긴다', !existsSync(join(빈집, 'config.json')), '');
  check('  왜 끝났는지 적는다', /표준입력/.test(s.out + s.err), (s.out + s.err).replace(/\s+/g, ' ').slice(-160));
  rmSync(빈집, { recursive: true, force: true });

  // `sbom --only bogus` 는 두 장을 다 내고 0 이었다.
  const b = await 띄우기(['sbom', '--only', 'bogus'], { 제한: 40000 });
  check('★ sbom --only 에 모르는 이름이면 64 로 멈춘다', b.code === 64 && !b.out.trim(), `code=${b.code} · ${b.out.slice(0, 60)}`);
}

trace('8-치움');
srv.close();
rmSync(home, { recursive: true, force: true });
rmSync(work, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n실제 실행 검사  ${D}(진짜 deel 을 띄워 끝까지 돌려 본다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
