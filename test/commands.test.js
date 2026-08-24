// 슬래시 명령을 하나씩 실제로 눌러 본다.
//
// 왜 만들었나:
//   /code 를 넣는 case 안에서 없는 변수(cmd)를 쓰고 있었다. `node --check` 는
//   문법만 보므로 못 잡는다. modes.js 를 직접 부르는 검사도 못 잡는다 —
//   그 파일은 멀쩡했기 때문이다. 명령을 눌러 봐야만 나오는 고장이었다.
//
//   그래서 '이 파일은 파싱된다' 가 아니라 '이 명령은 눌리면 끝까지 간다' 를 본다.
//   case 하나를 새로 넣을 때마다 여기 목록에 한 줄 늘리면 된다.
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 진짜 설정 파일을 건드리지 않게 먼저 못을 박는다.
//
// 처음 이 검사를 돌렸을 때 /level 이 사용자의 ~/.deel/config.json 에 값을 써 버렸다.
// 검사가 사람 설정을 바꾸면 안 된다. config.js 가 이 값을 쓸 때마다 보므로
// import 보다 늦게 정해도 먹는다.
const 설정집 = mkdtempSync(join(tmpdir(), 'deel-cmd-home-'));
process.env.DEEL_HOME = 설정집;
import { handle, COMMANDS } from '../src/commands.js';
import { Session } from '../src/agent/session.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

trace('1-준비');

const root = mkdtempSync(join(tmpdir(), 'deel-cmd-'));
const conn = {
  kind: 'openai', base: 'http://127.0.0.1:1/v1', auth: 'none', key: null,
  model: '검사용', ctx: 32768, streaming: false, tools: false, json: false, think: false,
};
const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
ctx.history.nextTurn();

function 새세션() {
  const s = new Session(conn, { root, mode: 'auto', think: 'medium', effort: 'save' });
  s.messages.push({ role: 'user', content: '안녕' });
  s.messages.push({ role: 'assistant', content: '네' });
  return s;
}

// 화면 출력은 삼킨다. 검사 결과만 보이게.
function 조용히(fn) {
  const 원래 = process.stdout.write.bind(process.stdout);
  let 모인것 = '';
  process.stdout.write = (chunk, ...r) => { 모인것 += chunk; return true; };
  return fn().then(
    (v) => { process.stdout.write = 원래; return { ok: true, v, out: 모인것 }; },
    (e) => { process.stdout.write = 원래; return { ok: false, e, out: 모인것 }; },
  );
}

// 눌러 볼 것들. 인자가 있는 것은 대표값을 같이 넣는다.
const 누를것 = [
  '/help', '/level', '/level 개발자', '/level 쉬움', '/level 없는수준',
  '/context', '/compact',
  '/think', '/think high', '/think 없는값',
  '/mode', '/mode strict', '/mode auto', '/mode 없는값',
  '/work', '/code', '/plan', '/architect', '/debug', '/ask', '/orchestrator',
  '/work 설계', '/work 없는모드',
  '/tools', '/cost', '/status', '/sessions', '/skills', '/skills 없을만한검색어',
  '/undo 0',
  '/init',
  '/clear',
  '/없는명령',
];

// 일부러 안 누르는 것과 그 이유. 조용히 빼면 '다 됐다' 로 읽힌다.
const 건너뜀 = [
  ['/model', '골라 넣는 화면이라 stdin 을 붙잡는다'],
  ['/scan', '이 PC 포트를 훑는다 — scan.test.js 가 따로 본다'],
  ['/plugin', '설치·삭제라 파일을 만든다 — plugins.test.js 가 따로 본다'],
  ['/exit', '끝내라는 뜻이라 누를 수 없다'],
  ['/quit', '/exit 과 같다'],
];

trace('2-명령누르기');

for (const line of 누를것) {
  const s = 새세션();
  const r = await 조용히(() => handle(line, s, ctx));
  if (!r.ok) {
    check(`${line} 이 끝까지 간다`, false, `${r.e?.name}: ${r.e?.message}`);
    continue;
  }
  // 모르는 명령도 여기서 끝난다 — 모델에게 흘려보내지 않고 모른다고 말한다.
  check(`${line} 이 끝까지 간다`, r.v?.handled === true, `handled=${r.v?.handled}`);
}

// 모르는 명령을 조용히 삼키면 오타를 눈치 못 챈다.
{
  const s = 새세션();
  const r = await 조용히(() => handle('/없는명령', s, ctx));
  check('모르는 명령은 모른다고 말한다', /모르는 명령/.test(r.out), r.out.trim().split('\n')[0] ?? '');
  check('모르는 명령을 모델에게 안 보낸다', r.v?.handled === true && !r.v?.text, JSON.stringify(r.v));
}

trace('3-효과확인');

// 눌러서 끝까지 가는 것과, 눌린 대로 바뀌는 것은 다르다. 바뀌는 쪽도 본다.
{
  const s = 새세션();
  await 조용히(() => handle('/plan', s, ctx));
  check('/plan 이 작업 모드를 바꾼다', s.work === 'plan', s.work);
  await 조용히(() => handle('/debug', s, ctx));
  check('/debug 가 작업 모드를 바꾼다', s.work === 'debug', s.work);
  await 조용히(() => handle('/work 설계', s, ctx));
  check('/work 설계 가 한국어 이름으로 먹는다', s.work === 'architect', s.work);
  await 조용히(() => handle('/work 없는모드', s, ctx));
  check('없는 모드는 안 바꾼다', s.work === 'architect', s.work);
}

{
  const s = 새세션();
  await 조용히(() => handle('/level 개발자', s, ctx));
  check('/level 이 수준을 바꾼다', s.level === '개발자', s.level);
  await 조용히(() => handle('/level 없는수준', s, ctx));
  check('없는 수준은 안 바꾼다', s.level === '개발자', s.level);
  check('세션은 수준을 기본값으로 갖고 태어난다', 새세션().level === '쉬움', 새세션().level);
}

{
  const s = 새세션();
  await 조용히(() => handle('/think high', s, ctx));
  check('/think 가 강도를 바꾼다', s.think === 'high', s.think);
  check('/think 를 직접 골랐다고 표시한다', s.thinkSet === true, String(s.thinkSet));
  const s2 = 새세션();
  check('안 고르면 표시가 안 붙는다', !s2.thinkSet, String(s2.thinkSet));
}

{
  const s = 새세션();
  await 조용히(() => handle('/mode strict', s, ctx));
  check('/mode 가 승인 정책을 바꾼다', s.mode === 'strict', s.mode);
  await 조용히(() => handle('/plan', s, ctx));
  check('작업 모드를 바꿔도 승인 정책은 그대로', s.mode === 'strict', s.mode);
}

{
  const s = 새세션();
  await 조용히(() => handle('/clear', s, ctx));
  check('/clear 가 대화를 비운다', s.messages.length === 0, String(s.messages.length));
}

// 초보 수준에서는 목록이 짧아야 한다 — 그게 이 기능의 전부다.
{
  const 쉬움 = 새세션(); 쉬움.level = '쉬움';
  const 개발자 = 새세션(); 개발자.level = '개발자';
  const a = await 조용히(() => handle('/help', 쉬움, ctx));
  const b = await 조용히(() => handle('/help', 개발자, ctx));
  const 줄 = (s) => s.split('\n').filter((x) => x.includes('/')).length;
  check('쉬움 목록이 개발자 목록보다 짧다', 줄(a.out) < 줄(b.out), `${줄(a.out)} vs ${줄(b.out)}`);
  check('감춘 게 있으면 몇 개인지 말한다', /더 있습니다/.test(a.out), a.out.split('\n').slice(-4).join(' / '));
  // 감췄다고 못 쓰는 건 아니다. 그게 이 설계의 약속이다.
  const c2 = await 조용히(() => handle('/think high', 쉬움, ctx));
  check('쉬움에서도 감춘 명령이 그대로 먹는다', c2.ok && 쉬움.think === 'high', 쉬움.think);
}

// /init 은 파일을 만든다. 만들어졌는지 본다.
check('/init 이 DEEL.md 를 만든다', existsSync(join(root, 'DEEL.md')));

// 고른 수준은 다음에 켤 때도 남아야 한다 — 그리고 남는 자리가 임시 폴더여야 한다.
{
  const p = join(설정집, 'config.json');
  check('/level 이 설정에 남는다', existsSync(p), p);
  if (existsSync(p)) {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    check('설정에 남은 값이 마지막에 고른 것', j.level === '개발자', JSON.stringify(j.level));
  }
  check('진짜 설정 폴더가 아니라 임시 폴더에 남았다',
    process.env.DEEL_HOME === 설정집 && 설정집.includes('deel-cmd-home-'), process.env.DEEL_HOME ?? '');
}

// 모든 명령이 목록에 설명을 갖고 있나 — 새로 넣고 빠뜨리기 쉬운 자리다.
for (const [n, v] of Object.entries(COMMANDS)) {
  check(`/${n} 에 설명이 있다`, typeof v.desc === 'string' && v.desc.length > 0, JSON.stringify(v));
}

trace('4-치움');
rmSync(root, { recursive: true, force: true });
rmSync(설정집, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n슬래시 명령 검사  ${D}(문법이 아니라 실제로 눌러 본다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log('');
for (const [n, why] of 건너뜀) console.log(`  ${D}· ${n} 는 안 눌렀습니다 — ${why}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
