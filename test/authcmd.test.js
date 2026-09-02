// 열쇠를 갖고 있지 않고 **받아 온다** — 그 길이 실제로 도는가.
//
// ── 무엇을 지키나 ───────────────────────────────────────────────────────
//
// 사내 게이트웨이는 한 시간짜리 토큰을 준다. 그래서 「열쇠를 적어 둔다」 가
// 아니라 「열쇠를 얻는 방법을 적어 둔다」 로 바꿨다. 그 자리에서 틀리면
// 전부 `HTTP 401` 한 줄로 보이므로, 여기서 하나씩 갈라 본다.
//
//   1. 배너가 섞여 나온 것을 열쇠로 안 쓴다. 통째로 실으면 서버가 400 을
//      주고, 화면에는 열쇠가 틀린 것처럼 보인다.
//   2. 401 을 맞으면 새로 받아 **한 번만** 다시 부른다. 두 번째 401 은
//      진짜로 권한이 없는 것이고, 그때 더 부르면 로그인 명령만 되풀이한다.
//   3. 봉인(offline)에서는 아예 안 부른다 — 그건 우리가 한 약속이다.
//      열쇠를 안 싣는 연결(auth: none)에서도 안 부른다 — 실을 자리가 없다.
//   4. 관리 정책이 준 명령은 안 묻는다. 개인 설정이 준 것은 한 번 묻는다.
//   5. 열쇠는 명령줄에 안 올린다.
//   6. 받은 것을 파일에 안 적는다.
//
// 바깥으로 나가는 연결은 없다. 게이트웨이는 127.0.0.1 의 임시 포트에 우리가
// 띄운 스텁이고, 열쇠를 주는 「사내 로그인」 은 그냥 node 한 줄이다.
import { createServer } from 'node:http';
import { writeFileSync, mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  받기설정, 쓸수있나, 읽기, 한번받기, 열쇠, 잊기, 마지막명령, 지금상태, 가림,
  기본수명, 미리,
} from '../src/safety/authcmd.js';
import { chat } from '../src/backend/adapter.js';
import { setOffline, resetNet, allowEndpoint } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 방 = mkdtempSync(join(tmpdir(), 'deel-auth-'));
// 「사내 로그인 도구」 자리. node 한 줄이라 어느 PC 에서나 돈다.
const 도구 = (몸) => {
  const p = join(방, `tool-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(p, 몸, 'utf8');
  return `"${process.execPath}" "${p}"`;
};

trace('1-설정읽기');

// ── 어디에 적힌 것을 쓰나 ───────────────────────────────────────────────
{
  check('안 적혀 있으면 null', 받기설정({}) === null);
  check('빈 명령은 없는 것으로', 받기설정({ 열쇠받기: { 명령: '   ' } }) === null);

  const 설정 = 받기설정({ 열쇠받기: { 명령: 'a', 수명: 900 } });
  check('설정에 적힌 것을 읽는다', 설정?.명령 === 'a' && 설정.수명 === 900 && 설정.곳 === '설정',
    JSON.stringify(설정));

  const 기본 = 받기설정({ 열쇠받기: { 명령: 'a' } });
  check('수명을 안 적으면 기본값', 기본.수명 === 기본수명, String(기본.수명));
  check('수명이 이상하면 기본값', 받기설정({ 열쇠받기: { 명령: 'a', 수명: -5 } }).수명 === 기본수명);

  /*
   * ★ 영어 이름으로 적어도 된다.
   *
   * 설정 파일은 사람이 손으로 적는다. `열쇠받기`·`명령`·`수명` 은 한글 자판이
   * 없는 사람에게는 옮겨 적을 수조차 없는 글자다. 화면만 영어로 켜지고 설정은
   * 한글이면, 그 사람에게 이 기능은 **없는 것**이다.
   */
  const 영어로 = 받기설정({ authCommand: { command: 'az account get-access-token', ttl: 900 } });
  check('★ authCommand·command·ttl 로도 받는다',
    영어로?.명령 === 'az account get-access-token' && 영어로?.수명 === 900, JSON.stringify(영어로));
  check('★ 영어 이름도 정책이 이긴다',
    받기설정({ authCommand: { command: '개인것' } }, { 정책값: { authCommand: { command: '회사것' } } }).명령 === '회사것');
  check('영어 이름에도 빈 명령은 없는 것', 받기설정({ authCommand: { command: '  ' } }) === null);

  /*
   * ★ 정책이 설정을 이긴다.
   *
   * 회사가 「이 게이트웨이는 이 명령으로만」 이라고 정해 둔 자리다. 설정이
   * 이기면 그 정책은 아무것도 안 지키는 장식이 된다 (safety/policy.js 와
   * 같은 순서다).
   */
  const 둘다 = 받기설정({ 열쇠받기: { 명령: '개인것' } }, { 정책값: { 열쇠받기: { 명령: '회사것' } } });
  check('★ 정책이 설정을 이긴다', 둘다.명령 === '회사것' && 둘다.곳 === '정책', JSON.stringify(둘다));
}

trace('2-언제-안부르나');

// ── 안 부르는 자리 ──────────────────────────────────────────────────────
{
  const 설정 = 받기설정({ 열쇠받기: { 명령: 'a' } });
  check('열쇠를 싣는 연결이면 쓴다', 쓸수있나(설정, { auth: 'bearer', 봉인: false }).된다);
  check('x-api-key 도 마찬가지', 쓸수있나(설정, { auth: 'x-api-key', 봉인: false }).된다);

  /*
   * ★ 봉인 중에는 안 부른다.
   *
   * 「이 컴퓨터 밖으로 안 나갑니다」 라고 해 놓고 사내 포털에 로그인하러
   * 나가면 그건 약속을 깬 것이다. 그리고 조용히 안 부르면 안 된다 —
   * 왜 열쇠가 안 붙는지 화면에서 알 수 있어야 한다.
   */
  const 봉 = 쓸수있나(설정, { auth: 'bearer', 봉인: true });
  check('★ 봉인 중에는 안 부른다', !봉.된다 && /봉인/.test(봉.왜), 봉.왜 ?? '');

  /*
   * ★ 실을 자리가 없으면 안 부른다.
   *
   * 로컬 Ollama 프로필이 `auth: 'none'` 이다. 받아 봐야 실을 머리말이 없고,
   * 명령만 띄우면 브라우저가 뜨고 끝난다.
   *
   * 주소로 가르지 않는 까닭은 따로 적어 두었다 — localhost 로 회사
   * 게이트웨이를 중계하는 구성(사이드카·port-forward)이 실제로 있고,
   * 그때는 주소만 이 안이지 열쇠는 진짜로 필요하다.
   */
  const 없 = 쓸수있나(설정, { auth: 'none', 봉인: false });
  check('★ 열쇠를 안 쓰는 연결에는 안 부른다', !없.된다 && /auth: none/.test(없.왜), 없.왜 ?? '');
  check('★ 주소가 이 안이어도 열쇠를 싣는다면 받는다',
    쓸수있나(설정, { auth: 'bearer', 봉인: false }).된다, '중계 프록시 구성');

  check('설정이 없으면 왜도 없다 (고장이 아니다)',
    쓸수있나(null, { auth: 'bearer' }).된다 === false
    && 쓸수있나(null, { auth: 'bearer' }).왜 === null);
}

trace('3-나온것-읽기');

// ── 나온 것을 읽는다 ────────────────────────────────────────────────────
{
  const 지금 = 1_700_000_000_000;
  const r = 읽기('abcdefghijklmnop', { 수명: 600, 지금 });
  check('토큰 한 줄을 읽는다', r.ok && r.token === 'abcdefghijklmnop', JSON.stringify(r));
  check('수명으로 만료를 잡는다', r.만료 === 지금 + 600_000, String(r.만료 - 지금));
  check('앞뒤 빈 줄은 떼고 읽는다', 읽기('\n  abcdefghijklmnop \n\n').token === 'abcdefghijklmnop');

  /*
   * ★ 배너가 섞인 것을 열쇠로 안 쓴다.
   *
   * 사내 로그인 도구는 토큰만 깔끔하게 뱉지 않는다. 「Logged in as …」 를
   * 찍고 그 다음 줄에 토큰을 찍는다. 그걸 통째로 Authorization 에 실으면
   * 게이트웨이는 400 을 주고, 화면에는 열쇠가 틀린 것처럼 보인다.
   * 여기서 거절하고 무엇이 왔는지 보여 줘야 사람이 --query 를 붙일 줄 안다.
   */
  const 배너 = 읽기('Logged in as kim@example.corp\nabcdefghijklmnop');
  check('★ 배너가 섞이면 거절한다', !배너.ok, JSON.stringify(배너));
  check('★ 무엇이 왔는지 첫 줄을 보여 준다', /Logged in as/.test(배너.보인것), 배너.보인것);
  check('몇 줄이 왔는지도 말해 준다', /2줄/.test(배너.왜), 배너.왜);

  check('빈 것도 거절한다', !읽기('').ok && /아무것도/.test(읽기('').왜));
  check('빈칸이 든 것도 거절한다', !읽기('token here please').ok);
  check('너무 짧은 것도 거절한다', !읽기('abc').ok, JSON.stringify(읽기('abc')));

  // JSON 으로 주는 곳. 머리말을 같이 준다.
  const j = 읽기(JSON.stringify({
    token: 'abcdefghijklmnop', expires_at: 1_700_000_600, headers: { 'X-Tenant': 'acme' },
  }), { 지금 });
  check('JSON 을 읽는다', j.ok && j.token === 'abcdefghijklmnop', JSON.stringify(j));
  check('머리말을 같이 받는다', j.headers['X-Tenant'] === 'acme', JSON.stringify(j.headers));
  check('access_token 이라고 적어도 읽는다', 읽기('{"access_token":"abcdefghijklmnop"}').ok);

  /*
   * ★ expires_at 은 초로 온다 — 밀리초로 주는 곳도 있다.
   *
   * 초를 밀리초로 읽으면 1970년이 나온다. 그러면 늘 만료로 보이고, 결국
   * **한마디마다** 로그인 명령을 띄운다. 브라우저가 계속 뜬다.
   */
  check('★ 초로 온 만료를 밀리초로 바꾼다', j.만료 === 1_700_000_600_000, String(j.만료));
  const ms = 읽기('{"token":"abcdefghijklmnop","expires_at":1700000600000}', { 지금 });
  check('★ 밀리초로 온 것은 그대로 둔다', ms.만료 === 1_700_000_600_000, String(ms.만료));

  // 머리말 이름에 못 쓰는 글자가 들어오면 요청 자체가 안 만들어진다.
  const 못쓸것 = 읽기('{"token":"abcdefghijklmnop","headers":{"안 되는 이름":"x","Ok-Name":"y"}}');
  check('★ 머리말 이름이 이상하면 그것만 버린다',
    못쓸것.headers['Ok-Name'] === 'y' && Object.keys(못쓸것.headers).length === 1,
    JSON.stringify(못쓸것.headers));

  check('JSON 인데 token 이 없으면 거절', !읽기('{"hello":1}').ok, 읽기('{"hello":1}').왜);
  check('망가진 JSON 도 안 죽는다', !읽기('{ oops').ok, 읽기('{ oops').왜);
}

trace('4-띄워서-받기');

// ── 진짜로 띄워서 받는다 ────────────────────────────────────────────────
{
  잊기();
  const 설정 = 받기설정({ 열쇠받기: { 명령: 도구("process.stdout.write('tokAAAAAAAAAAAAAA')"), 수명: 600 } });
  const r = await 한번받기(설정);
  check('★ 명령을 띄워 열쇠를 받는다', r.ok && r.token === 'tokAAAAAAAAAAAAAA', JSON.stringify(r).slice(0, 120));

  /*
   * ★ 열쇠는 명령줄에 안 올린다.
   *
   * 같은 PC 의 다른 사용자가 프로세스 목록으로 본다. (safety/keystore.js 가
   * 같은 규칙을 지킨다 — 거기서는 stdin 으로만 넣는다.)
   * 여기서는 우리가 열쇠를 **주는** 것이 아니라 **받는** 쪽이라, 지킬 것은
   * 「받은 열쇠가 다음 명령줄에 안 실린다」 다.
   */
  const 줄 = 마지막명령().join(' ');
  check('★ 받은 열쇠가 명령줄에 안 실린다', !줄.includes('tokAAAAAAAAAAAAAA'), 줄.slice(0, 80));

  // 실패한 명령. 왜 실패했는지가 화면에 나와야 한다.
  const 탈 = await 한번받기(받기설정({ 열쇠받기: { 명령: 도구("process.stderr.write('no session\\n');process.exit(3)") } }));
  check('실패하면 종료코드를 말한다', !탈.ok && /3/.test(탈.왜), 탈.왜);
  check('stderr 첫 줄을 보여 준다', /no session/.test(탈.보인것 ?? ''), 탈.보인것 ?? '');

  /*
   * ★ 사내 로그인 도구가 stderr 에 토큰을 찍는 일이 드물지 않다.
   *
   * 오류 메시지를 그대로 화면에 올리면 그 자리에서 새어 나간다. 화면 사진과
   * 심사서에 남는다.
   */
  const 샘 = await 한번받기(받기설정({
    열쇠받기: { 명령: 도구("process.stderr.write('failed with sk-ant-AAAAAAAAAAAAAAAAAAAA\\n');process.exit(1)") },
  }));
  check('★ stderr 에 실린 열쇠를 가리고 보여 준다',
    !/sk-ant-AAAAAAAAAAAAAAAAAAAA/.test(샘.보인것 ?? ''), 샘.보인것 ?? '');

  // 안 끝나는 명령을 영영 기다리지 않는다.
  const 늦 = await 한번받기(받기설정({ 열쇠받기: { 명령: 도구('setTimeout(() => {}, 60000)') } }), { 기다림: 700 });
  check('★ 안 끝나면 기다리다 끊는다', !늦.ok && /기다렸는데/.test(늦.왜), 늦.왜);

  // 없는 명령도 안 죽는다.
  const 없 = await 한번받기(받기설정({ 열쇠받기: { 명령: 'deel-there-is-no-such-command-xyz' } }), { 기다림: 8000 });
  check('없는 명령도 안 죽는다', !없.ok, 없.왜);
}

trace('5-들고있기와-묻기');

// ── 들고 있기 · 한 번만 묻기 ────────────────────────────────────────────
{
  잊기();
  let 띄운횟수 = 0;
  const 세는도구 = join(방, 'count.mjs');
  const 셈파일 = join(방, 'count.txt');
  writeFileSync(셈파일, '0', 'utf8');
  writeFileSync(세는도구,
    "import {readFileSync,writeFileSync} from 'node:fs';\n"
    + `const p=${JSON.stringify(셈파일)};\n`
    + "const n=Number(readFileSync(p,'utf8'))+1;writeFileSync(p,String(n));\n"
    + "process.stdout.write('tok'+String(n).padStart(14,'0'));\n", 'utf8');
  const 설정 = 받기설정({ 열쇠받기: { 명령: `"${process.execPath}" "${세는도구}"`, 수명: 600 } });
  const 셈 = () => Number(readFileSync(셈파일, 'utf8'));

  const a = await 열쇠(설정);
  const b = await 열쇠(설정);
  띄운횟수 = 셈();
  check('★ 살아 있는 동안은 다시 안 받는다', a.token === b.token && 띄운횟수 === 1,
    `${a.token} / ${b.token} / ${띄운횟수}번`);
  check('두 번째는 들고 있던 것이라고 말한다', b.그대로 === true);

  const c = await 열쇠(설정, { 다시: true });
  check('★ 다시 받으라면 다시 받는다', c.token !== a.token && 셈() === 2, `${c.token} / ${셈()}번`);

  const 상 = 지금상태();
  check('상태는 토큰 없이 말한다', 상?.있음 === true && !('token' in 상) && 상.남은초 > 0,
    JSON.stringify(상));

  /*
   * ★ 한 판에 한 번만 묻는다.
   *
   * 한 시간짜리 토큰으로 세 시간 일하면 세 번 받아 온다. 세 번 다 물으면
   * 사람은 손이 가는 대로 누른다 — 그건 승인이 아니다.
   */
  잊기();
  writeFileSync(셈파일, '0', 'utf8');
  let 물은횟수 = 0;
  const 묻기 = async () => { 물은횟수 += 1; return true; };
  await 열쇠(설정, { 물어보기: 묻기 });
  await 열쇠(설정, { 물어보기: 묻기, 다시: true });
  check('★ 한 판에 한 번만 묻는다', 물은횟수 === 1 && 셈() === 2, `물음 ${물은횟수} · 띄움 ${셈()}`);

  // 아니라고 하면 안 띄운다. 그리고 그 뒤로도 안 묻고 안 띄운다.
  잊기();
  writeFileSync(셈파일, '0', 'utf8');
  let 물음2 = 0;
  const 싫다 = async () => { 물음2 += 1; return false; };
  const 안됨 = await 열쇠(설정, { 물어보기: 싫다 });
  const 안됨2 = await 열쇠(설정, { 물어보기: 싫다 });
  check('★ 아니라고 하면 안 띄운다', !안됨.ok && !안됨2.ok && 셈() === 0 && 물음2 === 1,
    `띄움 ${셈()} · 물음 ${물음2}`);

  /*
   * ★ 관리 정책이 준 명령은 안 묻는다.
   *
   * 회사가 정한 것을 개인이 승인하는 모양은 뜻이 안 맞는다 — 아니라고
   * 답할 수도 없는 물음이다.
   */
  잊기();
  writeFileSync(셈파일, '0', 'utf8');
  let 물음3 = 0;
  const 정책설정 = 받기설정({}, { 정책값: { 열쇠받기: { 명령: `"${process.execPath}" "${세는도구}"`, 수명: 600 } } });
  await 열쇠(정책설정, { 물어보기: async () => { 물음3 += 1; return true; } });
  check('★ 정책이 준 것은 안 묻는다', 물음3 === 0 && 셈() === 1, `물음 ${물음3} · 띄움 ${셈()}`);

  // 가리기. 받은 토큰이 화면 글에 남으면 안 된다.
  const 글 = 가림(`Authorization: Bearer ${(await 열쇠(정책설정)).token} 였습니다`);
  check('★ 받은 열쇠를 화면 글에서 지운다', !/tok0*1/.test(글), 글);
}

trace('6-401-이면-새로-받는다');

// ── 401 을 맞으면 새 열쇠로 한 번만 다시 ────────────────────────────────
{
  잊기();
  resetNet();
  writeFileSync(join(방, 'n.txt'), '0', 'utf8');
  const 늘리는도구 = join(방, 'bump.mjs');
  writeFileSync(늘리는도구,
    "import {readFileSync,writeFileSync} from 'node:fs';\n"
    + `const p=${JSON.stringify(join(방, 'n.txt'))};\n`
    + "const n=Number(readFileSync(p,'utf8'))+1;writeFileSync(p,String(n));\n"
    + "process.stdout.write('tokKEY'+String(n).padStart(11,'0'));\n", 'utf8');

  const 본머리 = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      본머리.push(req.headers.authorization ?? '');
      // 첫 열쇠는 늙은 것으로 친다. 두 번째 열쇠만 받아 준다.
      if (!/tokKEY00000000002/.test(req.headers.authorization ?? '')) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'token expired' } }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'x', object: 'chat.completion', model: 'm',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '됐다' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const conn = {
    kind: 'openai', base: `http://127.0.0.1:${port}/v1`, auth: 'bearer', key: '', model: 'm',
    열쇠받기: 받기설정({ 열쇠받기: { 명령: `"${process.execPath}" "${늘리는도구}"`, 수명: 600 } }),
  };
  allowEndpoint(conn.base);

  const 소식 = [];
  const msg = await chat(conn, { messages: [{ role: 'user', content: '해줘' }], maxTokens: 50, onAuth: (것) => 소식.push(것) });
  check('★ 401 을 맞으면 새 열쇠로 다시 불러 통한다', msg?.content === '됐다', JSON.stringify(msg));
  check('★ 두 번 불렀고 열쇠가 서로 달랐다',
    본머리.length === 2 && 본머리[0] !== 본머리[1], `${본머리.length}번 · ${본머리[0] === 본머리[1] ? '같음' : '다름'}`);
  check('새로 받았다는 것을 위층에 알린다', 소식.some((x) => x.ok === true), JSON.stringify(소식.slice(0, 2)));

  /*
   * ★ 두 번째 401 에서는 멈춘다.
   *
   * 계속 다시 받으면 로그인 명령만 되풀이해서 띄운다. 브라우저가 계속 뜨고,
   * 정작 「권한이 없다」 는 말은 화면에 안 나온다.
   */
  잊기();
  본머리.length = 0;
  writeFileSync(join(방, 'n.txt'), '100', 'utf8');   // 절대 통과 못 하는 열쇠만 나온다
  let 탈 = null;
  try {
    await chat(conn, { messages: [{ role: 'user', content: '해줘' }], maxTokens: 50 });
  } catch (err) { 탈 = err; }
  check('★ 두 번째 401 에서는 멈춘다', !!탈 && 탈.status === 401, 탈 ? `${탈.status}` : '안 던짐');
  check('★ 딱 두 번만 불렀다 (무한히 안 돈다)', 본머리.length === 2, `${본머리.length}번`);

  srv.close();
  resetNet();
}

trace('7-봉인이면-안-띄운다');

// ── 봉인 중에는 명령 자체를 안 띄운다 ───────────────────────────────────
{
  잊기();
  resetNet();
  writeFileSync(join(방, 'sealed.txt'), '0', 'utf8');
  const 도 = join(방, 'sealed.mjs');
  writeFileSync(도,
    "import {readFileSync,writeFileSync} from 'node:fs';\n"
    + `const p=${JSON.stringify(join(방, 'sealed.txt'))};\n`
    + "writeFileSync(p,String(Number(readFileSync(p,'utf8'))+1));\n"
    + "process.stdout.write('tokSEALEDAAAAAAA');\n", 'utf8');

  const srv = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'x', object: 'chat.completion', model: 'm',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const conn = {
    kind: 'openai', base: `http://10.0.0.1:${port}/v1`, auth: 'bearer', key: '', model: 'm',
    열쇠받기: 받기설정({ 열쇠받기: { 명령: `"${process.execPath}" "${도}"` } }),
  };

  setOffline(true);
  const 소식 = [];
  // 봉인이면 요청 자체가 막힌다. 우리가 보는 것은 **명령을 안 띄웠다** 는 것이다.
  try {
    await chat(conn, { messages: [{ role: 'user', content: 'x' }], maxTokens: 10, onAuth: (것) => 소식.push(것) });
  } catch { /* 자물쇠가 막는다 — 그게 맞다 */ }
  setOffline(false);
  check('★ 봉인 중에는 로그인 명령을 안 띄운다',
    readFileSync(join(방, 'sealed.txt'), 'utf8') === '0', readFileSync(join(방, 'sealed.txt'), 'utf8'));
  check('★ 왜 안 붙였는지 위층에 말한다', 소식.some((x) => x.안부름 && /봉인/.test(x.왜 ?? '')),
    JSON.stringify(소식.slice(0, 2)));

  srv.close();
  resetNet();
}

trace('8-파일에-안-적는다');

/*
 * ★ 받은 열쇠를 디스크에 안 적는다.
 *
 * 파일에 적으면 지금 config.json 에 평문으로 두는 것과 같아진다 — 그러라고
 * 만든 기능이 아니다. 임시 폴더까지 훑어서 본다.
 */
{
  잊기();
  const 집 = mkdtempSync(join(tmpdir(), 'deel-auth-home-'));
  const 설정 = 받기설정({ 열쇠받기: { 명령: 도구("process.stdout.write('tokZZZZZZZZZZZZZZ')"), 수명: 600 } });
  await 열쇠(설정);

  const 훑기 = (뿌리) => {
    const 것들 = [];
    const 걷기 = (d, 깊이) => {
      if (깊이 > 4) return;
      let 목록 = [];
      try { 목록 = readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of 목록) {
        const p = join(d, e.name);
        if (e.isDirectory()) 걷기(p, 깊이 + 1);
        else {
          try { if (readFileSync(p, 'utf8').includes('tokZZZZZZZZZZZZZZ')) 것들.push(p); } catch { /* 바이너리는 넘어간다 */ }
        }
      }
    };
    걷기(뿌리, 0);
    return 것들;
  };
  const 샌곳 = [...훑기(집), ...훑기(join(here, '..', '.deel'))].filter((p) => existsSync(p));
  check('★ 받은 열쇠가 어느 파일에도 안 적힌다', 샌곳.length === 0, 샌곳.slice(0, 3).join(' / '));
  rmSync(집, { recursive: true, force: true });
}

trace('9-미리-받는다');

/*
 * ★ 만료 직전에는 미리 받는다.
 *
 * 딱 만료 시각까지 쓰면, 보내는 순간에는 살아 있던 토큰이 게이트웨이에 닿을
 * 때 죽어 있다. 그 한 번이 401 이고, 사람 눈에는 그냥 실패로 보인다.
 */
{
  잊기();
  writeFileSync(join(방, 'soon.txt'), '0', 'utf8');
  const 도 = join(방, 'soon.mjs');
  writeFileSync(도,
    "import {readFileSync,writeFileSync} from 'node:fs';\n"
    + `const p=${JSON.stringify(join(방, 'soon.txt'))};\n`
    + "const n=Number(readFileSync(p,'utf8'))+1;writeFileSync(p,String(n));\n"
    + "process.stdout.write('tokSOON'+String(n).padStart(10,'0'));\n", 'utf8');
  // 수명을 미리(60초)보다 짧게 준다 — 받자마자 '곧 만료' 인 상태가 된다.
  const 설정 = 받기설정({ 열쇠받기: { 명령: `"${process.execPath}" "${도}"`, 수명: Math.floor(미리 / 1000) - 10 } });
  const a = await 열쇠(설정);
  const b = await 열쇠(설정);
  check('★ 곧 만료될 것은 들고 있지 않고 다시 받는다',
    a.token !== b.token && Number(readFileSync(join(방, 'soon.txt'), 'utf8')) === 2,
    `${a.token} / ${b.token}`);
}

잊기();
rmSync(방, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n열쇠를 갖고 있지 않고 받아 온다  ${D}(사내 로그인 자리는 node 한 줄)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
