// 한 세션 안에서 여러 모델.
//
// ── 여기서 제일 무서운 것 ───────────────────────────────────────────────
//
// 둘째 모델을 쓴다는 것은 **나갈 수 있는 자리를 하나 더 연다**는 뜻이다.
// deel 이 하는 약속이 "이 자리 하나만 연다" 라서, 여기가 그 약속을 깰 수 있는
// 유일한 새 구멍이다. 그래서 세 가지를 진짜로 잰다.
//
//   1) 모델이 지어낸 주소로는 못 나간다 — 사람이 설정에 적어 둔 프로필만.
//   2) 그 일이 도는 동안만 열리고, 끝나면 **닫힌다.**
//   3) 오프라인 잠금이면 이 컴퓨터 밖 프로필은 아예 못 쓴다.
//
// 나머지(요약에 모델 이름이 실리나, 화면에 뜨나)는 그다음이다.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import {
  프로필찾기, 쓸수있나, 연결만들기, 알릴말, 같은자리, 목록보기, 프로필들, CTX_DEFAULT,
} from '../src/agent/models.js';
import { allowed, allowEndpoint, setOffline, resetNet } from '../src/safety/network.js';
import { 하위요약 } from '../src/tools/task.js';
import { run } from '../src/agent/loop.js';
import { Session } from '../src/agent/session.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { makeScope } from '../src/safety/guard.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-models-'));

const 설정 = {
  active: 'big',
  profiles: [
    { id: 'big', name: '큰 것', kind: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', auth: 'none', model: 'qwen2.5-coder:7b', ctx: 32768, streaming: true, tools: true },
    { id: 'small', name: '작은 것', kind: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', auth: 'none', model: 'qwen2.5:1.5b', ctx: 32768, tools: true },
    { id: 'gw', name: '사내 게이트웨이', kind: 'openai', baseUrl: 'https://gw.example.invalid/v1', auth: 'bearer', apiKey: '', model: 'gpt-x', ctx: 128000, tools: true },
  ],
};

trace('1-프로필찾기');

// ── 이름으로 찾기 ───────────────────────────────────────────────────────
{
  check('id 로 찾는다', 프로필찾기('small', 설정).prof?.id === 'small');
  check('대소문자를 안 가린다', 프로필찾기('SMALL', 설정).prof?.id === 'small');
  check('이름으로도 찾는다', 프로필찾기('작은 것', 설정).prof?.id === 'small');
  check('모델 이름으로도', 프로필찾기('qwen2.5:1.5b', 설정).prof?.id === 'small');
  check('앞부분만 쳐도 하나면 찾는다', 프로필찾기('gw', 설정).prof?.id === 'gw');

  // 둘 이상 걸리면 **고르지 않는다.** 아무거나 골라 주면 물어본 사람은 어느
  // 모델이 답했는지 모른 채로 그 답을 믿게 된다.
  const 여럿 = 프로필찾기('qwen', 설정);
  check('여럿 걸리면 안 고른다', 여럿.ok === false, JSON.stringify(여럿.후보?.map((p) => p.id)));
  check('걸린 것들을 알려 준다', 여럿.후보.length === 2, JSON.stringify(여럿.후보.map((p) => p.id)));

  check('없으면 없다고 한다', 프로필찾기('없는것', 설정).ok === false);
  check('빈 이름도 안 죽는다', 프로필찾기('', 설정).ok === false && 프로필찾기(null, 설정).ok === false);
  check('프로필이 없으면 그렇다고 한다',
    프로필찾기('아무거나', { profiles: [] }).why.includes('하나도 없'),
    프로필찾기('아무거나', { profiles: [] }).why);
  check('설정이 이상해도 안 죽는다', 프로필들(null).length === 0 && 프로필들({}).length === 0);
}

trace('2-연결만들기');

// ── 프로필 → 연결 ───────────────────────────────────────────────────────
{
  const c1 = 연결만들기(프로필찾기('small', 설정).prof);
  check('모델 이름이 옮겨진다', c1.model === 'qwen2.5:1.5b', c1.model);
  check('주소가 옮겨진다', c1.base === 'http://127.0.0.1:11434/v1', c1.base);
  check('컨텍스트도', c1.ctx === 32768, String(c1.ctx));
  check('안 적힌 것은 기본값', 연결만들기({ kind: 'openai', baseUrl: 'http://x/v1' }).ctx === CTX_DEFAULT);
  check('직접 준 값이 이긴다', 연결만들기(프로필찾기('small', 설정).prof, { ctx: 8192 }).ctx === 8192);
  check('없는 프로필이면 null', 연결만들기(null) === null);
}

trace('3-오프라인잠금');

// ── 오프라인 잠금은 하위 작업에서도 지켜져야 한다 ───────────────────────
//
// 잠갔는데 하위 작업만 밖으로 나가면, 잠금은 화면에만 있고 실제로는 안 잠긴
// 것이 된다. 그게 제일 나쁜 종류의 안전 기능이다.
{
  const 작은것 = 프로필찾기('small', 설정).prof;
  const 게이트 = 프로필찾기('gw', 설정).prof;

  setOffline(false);
  check('안 잠갔으면 이 컴퓨터 안은 된다', 쓸수있나(작은것).ok === true);
  check('안 잠갔으면 바깥도 된다', 쓸수있나(게이트).ok === true);

  setOffline(true);
  check('잠가도 이 컴퓨터 안은 된다', 쓸수있나(작은것).ok === true);
  const 막힘 = 쓸수있나(게이트);
  check('잠그면 바깥은 막힌다', 막힘.ok === false, JSON.stringify(막힘));
  check('왜 막혔는지 말해 준다', 막힘.why.includes('오프라인'), 막힘.why);
  setOffline(false);

  check('주소가 없으면 못 쓴다', 쓸수있나({ id: 'x' }).ok === false);
  check('주소가 이상해도 안 죽는다', 쓸수있나({ baseUrl: '주소아님' }).ok === false);
}

trace('4-알릴말');

// ── 다른 자리로 나가면 그렇게 적어야 한다 ───────────────────────────────
{
  const 지금 = 연결만들기(프로필찾기('big', 설정).prof);
  const 같은쪽 = 연결만들기(프로필찾기('small', 설정).prof);
  const 딴쪽 = 연결만들기(프로필찾기('gw', 설정).prof);

  const a = 알릴말(지금, 같은쪽);
  check('같은 자리면 모델 이름만', a.다른자리 === false && a.말 === '모델 qwen2.5:1.5b', a.말);
  check('같은 자리면 밖으로가 아니다', a.밖으로 === false);

  const b = 알릴말(지금, 딴쪽);
  check('다른 자리면 어디로 가는지 적는다', b.다른자리 === true && b.말.includes('gw.example.invalid'), b.말);
  check('바깥이라고 적는다', b.밖으로 === true && b.말.includes('바깥'), b.말);

  check('같은자리 견주기', 같은자리('http://a.com/v1', 'http://a.com/other') === true);
  check('포트가 다르면 다른 자리', 같은자리('http://a.com:1/v1', 'http://a.com:2/v1') === false);
  check('못 읽는 주소는 다른 자리로 본다', 같은자리('주소아님', 'http://a.com/v1') === false);
}

trace('5-목록보기');

// ── 화면에 낼 목록 ──────────────────────────────────────────────────────
{
  const 목 = 목록보기(설정);
  check('세 개가 나온다', 목.length === 3, String(목.length));
  check('이 컴퓨터 안인지 표시한다', 목.find((x) => x.id === 'small').로컬 === true);
  check('바깥도 표시한다', 목.find((x) => x.id === 'gw').로컬 === false);
  check('지금 쓰는 것을 표시한다', 목.find((x) => x.id === 'big').지금 === true);
  check('나머지는 지금이 아니다', 목.filter((x) => x.지금).length === 1);
  check('호스트만 남긴다', 목.find((x) => x.id === 'gw').어디 === 'gw.example.invalid');
}

trace('6-요약에모델이실리나');

// ── 요약에 누가 했는지 실려야 한다 ──────────────────────────────────────
//
// 부모 모델이 이 요약만 보고 이어서 일한다. 누가 한 것인지 모르면 작은 모델이
// 대충 해 놓은 것을 제가 한 것처럼 믿는다.
{
  const 끝 = { type: 'done', steps: 3, files: [] };
  const 없이 = 하위요약({ 목적: '표 만들기', 모드: 'code', 끝, 글자수: 2000 });
  const 함께 = 하위요약({ 목적: '표 만들기', 모드: 'code', 끝, 글자수: 2000, 모델: '모델 qwen2.5:1.5b' });
  check('안 주면 안 적는다', !없이.includes('qwen'), 없이.split('\n')[0]);
  check('주면 첫 줄에 적는다', 함께.split('\n')[0].includes('qwen2.5:1.5b'), 함께.split('\n')[0]);
  check('나머지는 그대로', 없이.split('\n').slice(1).join('\n') === 함께.split('\n').slice(1).join('\n'));
}

trace('7-진짜로열고닫는가');

// ── 여기가 본체: 자리를 열었다가 진짜로 닫는가 ──────────────────────────
//
// 하위 작업이 끝난 뒤에도 그 주소가 열린 채로 남으면, 그 세션이 끝날 때까지
// 열려 있다. '한 자리만 연다' 가 그 순간 거짓이 된다.
{
  // 스텁 서버 둘. 부모용과 하위용을 **다른 포트**로 띄워 '다른 자리' 를 만든다.
  const 만들기 = (답) => new Promise((res) => {
    const srv = createServer((req, r) => {
      let b = '';
      req.on('data', (d) => { b += d; });
      req.on('end', () => {
        r.writeHead(200, { 'content-type': 'application/json' });
        r.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 답(b) } }] }));
      });
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });

  const 하위srv = await 만들기(() => '하위가 끝냈습니다.');
  const 하위포트 = 하위srv.address().port;

  // 부모는 첫 걸음에 Task 를 부르고, 요약을 받으면 끝낸다. 도구 호출을 내야
  // 하므로 위 만들기(글만 내는 것)를 못 쓰고 따로 세운다.
  let 걸음 = 0;
  const 부모srv = await new Promise((res) => {
    const srv = createServer((req, r) => {
      req.on('data', () => {});
      req.on('end', () => {
        걸음++;
        const msg = 걸음 === 1
          ? {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'c1',
              type: 'function',
              function: {
                name: 'Task',
                arguments: JSON.stringify({ 목적: '잔일', 할일: '표만 맞춰라', 모드: 'ask', 모델: '작은것' }),
              },
            }],
          }
          : { role: 'assistant', content: '다 됐습니다.' };
        r.writeHead(200, { 'content-type': 'application/json' });
        r.end(JSON.stringify({ choices: [{ message: msg }] }));
      });
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
  const 부모포트 = 부모srv.address().port;

  const 방 = join(root, '일터');
  const 설정2 = {
    active: 'main',
    profiles: [
      { id: 'main', kind: 'openai', baseUrl: `http://127.0.0.1:${부모포트}/v1`, auth: 'none', model: '큰모델', ctx: 32768, tools: true },
      { id: '작은것', kind: 'openai', baseUrl: `http://127.0.0.1:${하위포트}/v1`, auth: 'none', model: '작은모델', ctx: 8192, tools: true },
    ],
  };
  // models.js 는 설정 파일을 읽는다. 검사용 설정집을 쓰게 한다.
  const 설정집 = mkdtempSync(join(tmpdir(), 'deel-models-home-'));
  const 앞home = process.env.DEEL_HOME;
  process.env.DEEL_HOME = 설정집;
  writeFileSync(join(설정집, 'config.json'), JSON.stringify(설정2), 'utf8');

  resetNet();
  const 부모conn = 연결만들기(설정2.profiles[0]);
  allowEndpoint(부모conn.base);
  const 열린것앞 = allowed();
  check('처음엔 한 자리만 열려 있다', 열린것앞.length === 1, JSON.stringify(열린것앞));

  const s = new Session(부모conn, { root: 방, mode: 'auto', work: 'code' });
  const ctx = {
    scope: makeScope(방),
    history: new History(방),
    audit: new Audit(방),
    seen: new Set(),
    mcp: [],
    skills: [],
    loadedSkills: new Set(),
    모델컨텍스트: 32768,
    ask: async () => 'y',
    confirm: async () => true,
  };

  const 본것 = [];
  for await (const ev of run(s, ctx, '표 좀 맞춰줘')) 본것.push(ev);

  const 시작 = 본것.find((e) => e.type === 'task_start');
  check('하위 작업이 돌았다', !!시작, JSON.stringify(본것.map((e) => e.type)));
  check('다른 모델이라고 알린다', !!시작?.모델 && 시작.모델.includes('작은모델'), String(시작?.모델));
  check('다른 자리라고 알린다', 시작.모델.includes(String(하위포트)), 시작.모델);
  check('바깥은 아니라고 한다 — 둘 다 127.0.0.1 이다', 시작.밖으로 === false, String(시작?.밖으로));

  const 끝남 = 본것.find((e) => e.type === 'task_done');
  check('하위가 끝났다', !!끝남, JSON.stringify(본것.map((e) => e.type)));
  check('끝난 줄에도 모델이 실린다', String(끝남?.모델).includes('작은모델'), String(끝남?.모델));

  // ★ 여기가 본체 ★
  const 열린것뒤 = allowed();
  check('끝나고 나면 다시 한 자리만 열려 있다', 열린것뒤.length === 1, JSON.stringify(열린것뒤));
  check('열린 자리가 원래 그 자리다', 열린것뒤[0] === 열린것앞[0], `${열린것뒤[0]} / ${열린것앞[0]}`);

  // 하위 서버가 실제로 불렸나 — 이름만 바꾸고 부모에게 보낸 것이 아닌지.
  check('하위 서버가 실제로 불렸다', 걸음 >= 2, `부모 ${걸음}걸음`);

  부모srv.close();
  하위srv.close();
  if (앞home === undefined) delete process.env.DEEL_HOME; else process.env.DEEL_HOME = 앞home;
  rmSync(설정집, { recursive: true, force: true });
  resetNet();
}

trace('8-지어낸주소는못쓴다');

// ── 모델이 지어낸 이름으로는 못 나간다 ──────────────────────────────────
{
  const 없는것 = 프로필찾기('http://evil.example.invalid/v1', 설정);
  check('주소를 통째로 줘도 프로필로는 안 잡힌다', 없는것.ok === false, JSON.stringify(없는것));
  check('그럴듯한 이름을 지어내도 안 잡힌다', 프로필찾기('gpt-4o', 설정).ok === false);
  // 걸리는 것이 있어도 그건 사람이 적어 둔 프로필이다 — 지어낸 주소가 아니다.
  check('걸리는 것은 언제나 설정에 적힌 것', (프로필찾기('big', 설정).prof
    && 프로필들(설정).some((p) => p.id === 프로필찾기('big', 설정).prof.id)) === true);
}

rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n여러 모델 검사  ${D}(자리를 하나 더 열었다가 반드시 닫는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
