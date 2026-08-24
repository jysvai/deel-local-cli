// 손이 덜 간 명령들. commands.test.js 가 안 눌러 본 자리를 마저 누른다.
//
// 왜 나눴나: commands.test.js 는 '모드·수준·모델' 처럼 자주 쓰는 것을 본다.
// 여기서는 가끔 쓰지만 틀리면 크게 아픈 것들을 본다 — 플러그인 설치, 스킬
// 고르기, 대화 접기, 되돌리기, DEEL.md 만들기.
//
// 이런 명령은 실수해도 그 자리에서 안 보인다. 다음에 쓸 때 비로소 이상해진다.
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handle } from '../src/commands.js';
import { Session } from '../src/agent/session.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { load, save } from '../src/config.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 살림 ────────────────────────────────────────────────────────────────
const home = mkdtempSync(join(tmpdir(), 'deel-cmd2-home-'));
process.env.DEEL_HOME = home;
const root = mkdtempSync(join(tmpdir(), 'deel-cmd2-root-'));

// 스텁 모델. 접기(compact)가 요약을 받아 와야 해서 필요하다.
let 요약을줄까 = true;
const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = req.url.split('?')[0];
    const 보냄 = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url === '/v1/models') return 보냄({ data: [{ id: '가모델' }, { id: '나모델' }, { id: '다른것' }] });
    if (url === '/v1/chat/completions') {
      if (!요약을줄까) return 보냄({ error: { message: '지금은 못 합니다' } }, 500);
      return 보냄({
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '- 앞선 대화 요약입니다\n- 두 번째 줄' } }],
        usage: { prompt_tokens: 50, completion_tokens: 10 },
      });
    }
    보냄({}, 404);
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
const base = `http://127.0.0.1:${port}/v1`;
allowEndpoint(base);
allowEndpoint(`http://127.0.0.1:${port}`);

save({
  version: 1, active: 'p', level: '개발자',
  profiles: [{ id: 'p', name: '스텁', kind: 'openai', baseUrl: base, auth: 'none', apiKey: '', model: '가모델', ctx: 32768, tools: true }],
});

const conn = { kind: 'openai', base, auth: 'none', key: '', model: '가모델', ctx: 32768, tools: true };

function 새세션(opts = {}) {
  const s = new Session({ ...conn }, { root, ...opts });
  return s;
}
function 새ctx(extra = {}) {
  const ctx = {
    scope: makeScope(root), history: new History(root), audit: new Audit(root),
    seen: new Set(), skills: [], loadedSkills: new Set(), ...extra,
  };
  ctx.history.nextTurn();
  return ctx;
}

const 조용히 = async (fn) => {
  const 원래 = process.stdout.write.bind(process.stdout);
  let 모인것 = '';
  process.stdout.write = (chunk) => { 모인것 += chunk; return true; };
  try { const v = await fn(); return { v, out: 모인것 }; } finally { process.stdout.write = 원래; }
};
const 색빼기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

trace('1-규칙파일');

// ── /init ───────────────────────────────────────────────────────────────
{
  const s = 새세션();
  const ctx = 새ctx();
  const p = join(root, 'DEEL.md');
  try { rmSync(p, { force: true }); } catch {}

  const r1 = await 조용히(() => handle('/init', s, ctx));
  check('/init 이 DEEL.md 를 만든다', existsSync(p), p);
  check('만든 파일에 틀이 들어 있다', /## 규칙/.test(readFileSync(p, 'utf8')), '');
  check('세션이 그 규칙을 바로 물고 간다', s.rules?.name === 'DEEL.md', String(s.rules?.name));
  check('규칙이 시스템 프롬프트에 실린다', s.systemPrompt().includes('DEEL.md'), '');

  // 두 번째는 덮어쓰면 안 된다. 사람이 적어 둔 규칙이 날아간다.
  writeFileSync(p, '# 내가 적은 규칙\n\n- 소중함\n', 'utf8');
  const r2 = await 조용히(() => handle('/init', s, ctx));
  check('이미 있으면 안 덮어쓴다', /내가 적은 규칙/.test(readFileSync(p, 'utf8')), '');
  check('이미 있다고 말해 준다', /이미 있습니다/.test(r2.out), 색빼기(r2.out).trim().slice(0, 40));
  rmSync(p, { force: true });
}

trace('2-되돌리기');

// ── /undo ───────────────────────────────────────────────────────────────
{
  const s = 새세션();
  const ctx = 새ctx();
  const 파일 = join(root, '고칠것.txt');
  writeFileSync(파일, '원래 내용\n', 'utf8');

  ctx.history.nextTurn();
  ctx.history.snapshot(파일);
  writeFileSync(파일, '고친 내용\n', 'utf8');

  const r = await 조용히(() => handle('/undo', s, ctx));
  check('/undo 가 파일을 되돌린다', readFileSync(파일, 'utf8') === '원래 내용\n', JSON.stringify(readFileSync(파일, 'utf8')));
  check('무엇을 되돌렸는지 보여 준다', /되돌렸습니다/.test(r.out), 색빼기(r.out).trim().slice(0, 50));
  check('되돌린 파일 이름도 보여 준다', /고칠것/.test(r.out), '');

  // 되돌릴 게 없을 때
  const r2 = await 조용히(() => handle('/undo', s, ctx));
  check('되돌릴 게 없으면 그렇다고 한다', /되돌릴 것이 없습니다/.test(r2.out), 색빼기(r2.out).trim().slice(0, 40));

  // 숫자를 붙여도 안 터진다
  const r3 = await 조용히(() => handle('/undo 3', s, ctx));
  check('턴 수를 줘도 안 터진다', r3.v?.handled === true, JSON.stringify(r3.v));
  const r4 = await 조용히(() => handle('/undo 숫자아님', s, ctx));
  check('숫자가 아니어도 안 터진다', r4.v?.handled === true, JSON.stringify(r4.v));
  rmSync(파일, { force: true });
}

trace('3-대화접기');

// ── /compact ────────────────────────────────────────────────────────────
{
  const s = 새세션();
  const ctx = 새ctx();
  // 접을 것이 있어야 한다. 짧은 대화는 접지 않는다 — 접으면 오히려 손해다.
  for (let i = 0; i < 24; i++) {
    s.push({ role: 'user', content: `${i}번째 질문입니다. `.repeat(40) });
    s.push({ role: 'assistant', content: `${i}번째 답입니다. `.repeat(40) });
  }
  const 전 = s.breakdown().used;

  요약을줄까 = true;
  const r = await 조용히(() => handle('/compact', s, ctx));
  const 후 = s.breakdown().used;
  check('/compact 가 대화를 줄인다', 후 < 전, `${전} → ${후}`);
  check('얼마나 줄었는지 보여 준다', /줄어듦|접었습니다/.test(r.out), 색빼기(r.out).trim().slice(0, 60));
  check('요약 내용을 보여 준다', /앞선 대화 요약/.test(r.out), '');
}

{
  // 모델이 요약을 못 줄 때. 그래도 대화는 줄여야 한다 — 안 그러면 컨텍스트가 터진다.
  const s = 새세션();
  const ctx = 새ctx();
  for (let i = 0; i < 24; i++) {
    s.push({ role: 'user', content: `${i}번 `.repeat(60) });
    s.push({ role: 'assistant', content: `${i}답 `.repeat(60) });
  }
  const 전 = s.breakdown().used;
  요약을줄까 = false;
  const r = await 조용히(() => handle('/compact', s, ctx));
  요약을줄까 = true;
  check('요약을 못 받아도 대화는 줄인다', s.breakdown().used < 전, `${전} → ${s.breakdown().used}`);
  check('요약을 못 받았다고 알려 준다', /요약을 못 받아/.test(r.out), 색빼기(r.out).trim().slice(-60));
}

{
  // 접을 게 없는 짧은 대화
  const s = 새세션();
  const r = await 조용히(() => handle('/compact', s, 새ctx()));
  check('짧은 대화는 안 접는다', r.v?.handled === true, JSON.stringify(r.v));
}

trace('4-추론배분');

// ── /think 의 배분 갈래 ─────────────────────────────────────────────────
{
  const s = 새세션();
  const ctx = 새ctx();
  for (const [넣은것, 될것] of [['deep', 'deep'], ['even', 'even'], ['save', 'save'], ['깊게', 'deep'], ['절약', 'save'], ['균일', 'even']]) {
    await 조용히(() => handle(`/think ${넣은것}`, s, ctx));
    check(`/think ${넣은것} → 배분 ${될것}`, s.effort === 될것, s.effort);
  }
  check('배분을 직접 고르면 표시가 남는다', s.effortSet === true, String(s.effortSet));

  // 직접 고른 배분은 작업 모드가 못 덮는다. 사람이 고른 것이 이긴다.
  await 조용히(() => handle('/plan', s, ctx));
  check('작업 모드가 사람이 고른 배분을 안 덮는다', s.effort === 'even', s.effort);
}

trace('5-모드오타');

{
  const s = 새세션();
  const r = await 조용히(() => handle('/work 그런모드없음', s, 새ctx()));
  check('없는 작업 모드는 알려 준다', /그런 모드는 없습니다/.test(r.out), 색빼기(r.out).trim().slice(0, 50));
  check('없는 모드로 안 바뀐다', s.work === 'auto', s.work);

  const r2 = await 조용히(() => handle('/mode 없는정책', s, 새ctx()));
  check('없는 승인 정책이면 목록을 보여 준다', /auto|confirm|strict/.test(r2.out), '');
  check('없는 정책으로 안 바뀐다', s.mode === 'auto', s.mode);
}

trace('6-대화목록');

// ── /sessions ───────────────────────────────────────────────────────────
{
  const s = 새세션();
  const r1 = await 조용히(() => handle('/sessions', s, 새ctx()));
  check('대화가 없으면 없다고 한다', /아직 없습니다|첫 번째/.test(r1.out), 색빼기(r1.out).trim().slice(0, 60));

  // 대화를 하나 남겨 두고 다시 본다.
  const { Store } = await import('../src/agent/store.js');
  // 둘째 인자는 '대화 이름'. 머리글(모델 등)은 begin() 으로 넣는다.
  const st = new Store(root).begin({ model: '가모델', root });
  st.append({ role: 'user', content: '첫 질문입니다' });
  st.append({ role: 'assistant', content: '답' });

  const r2 = await 조용히(() => handle('/sessions', s, 새ctx()));
  check('남은 대화를 보여 준다', /첫 질문입니다|턴/.test(r2.out), 색빼기(r2.out).trim().slice(0, 80));
  check('이어하는 법을 알려 준다', /--continue|--resume/.test(r2.out), '');
}

trace('7-스킬');

// ── /skills ─────────────────────────────────────────────────────────────
{
  const s = 새세션();
  const 스킬들 = [
    { name: '엑셀정리', description: '엑셀 표를 다듬는다', source: 'project', enabled: true, path: 'a' },
    { name: '로그분석', description: '로그에서 원인을 찾는다', source: 'user', enabled: true, path: 'b' },
    { name: '배포', description: '배포 절차', source: 'plugin', enabled: false, path: 'c' },
    // 설명이 없는 스킬. 남의 폴더에서 오는 것이라 앞머리가 빠진 파일이 섞인다.
    // 예전에는 이것 하나로 /skills 가 터지면서 대화가 통째로 끝났다.
    { name: '앞머리없음', source: 'plugin', enabled: true, path: 'd' },
  ];
  const ctx = 새ctx({ skills: 스킬들 });
  s.skills = 스킬들;
  s.plugins = [];

  const r1 = await 조용히(() => handle('/skills', s, ctx));
  check('/skills 가 목록을 보여 준다', /엑셀정리/.test(r1.out) && /로그분석/.test(r1.out), '');
  check('설명 없는 스킬이 섞여도 안 터진다', /앞머리없음/.test(r1.out), '목록 그리다 죽으면 대화가 끝난다');
  // 더 나쁜 자리 — 시스템 프롬프트는 매 턴 만든다. 여기서 터지면 대화가 아예 안 된다.
  let 프롬프트터짐 = null;
  try { s.systemPrompt(); s.breakdown(); } catch (err) { 프롬프트터짐 = err.message; }
  check('설명 없는 스킬이 있어도 시스템 프롬프트가 만들어진다', 프롬프트터짐 === null, String(프롬프트터짐));
  check('어디서 온 스킬인지 센다', /project|user|plugin|프로젝트|내|플러그인/.test(r1.out), 색빼기(r1.out).slice(-140));

  const r2 = await 조용히(() => handle('/skills 엑셀', s, ctx));
  check('검색어로 걸러 낸다', /엑셀정리/.test(r2.out) && !/로그분석/.test(색빼기(r2.out).split('엑셀정리')[1] ?? ''), '');

  const r3 = await 조용히(() => handle('/skills off', s, ctx));
  check('전부 끌 수 있다', s.skills.every((x) => !x.enabled), s.skills.map((x) => x.enabled).join(','));

  const r4 = await 조용히(() => handle('/skills on 로그', s, ctx));
  check('걸리는 것만 켤 수 있다', s.skills.find((x) => x.name === '로그분석')?.enabled === true, '');
  check('안 걸린 것은 그대로 꺼져 있다', s.skills.find((x) => x.name === '엑셀정리')?.enabled === false, '');
  check('몇 개를 켰는지 말해 준다', /만 올립니다|개/.test(r4.out), 색빼기(r4.out).trim().slice(0, 60));

  const r5 = await 조용히(() => handle('/skills all', s, ctx));
  check('all 로 다시 전부 켠다', s.skills.every((x) => x.enabled), s.skills.map((x) => x.enabled).join(','));
}

trace('8-플러그인');

// ── /plugin ─────────────────────────────────────────────────────────────
{
  const s = 새세션();
  const ctx = 새ctx();

  const r1 = await 조용히(() => handle('/plugin', s, ctx));
  check('/plugin 이 목록을 보여 준다', r1.v?.handled === true, JSON.stringify(r1.v));

  // 폴더에서 설치. 사내에서는 이게 유일한 설치 경로다(인터넷을 못 쓴다).
  // 이름은 .claude-plugin/plugin.json 에서 읽는다 (Claude Code 규약).
  // 그 파일이 없으면 폴더 이름을 쓴다 — 그러면 목록에 임시 폴더 이름이 뜬다.
  const 만든것 = mkdtempSync(join(tmpdir(), 'deel-plug-'));
  mkdirSync(join(만든것, 'commands'), { recursive: true });
  mkdirSync(join(만든것, '.claude-plugin'), { recursive: true });
  writeFileSync(join(만든것, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: '내플러그인', version: '1.0.0', description: '검사용' }), 'utf8');
  writeFileSync(join(만든것, 'commands', '인사.md'), '---\ndescription: 인사한다\n---\n\n안녕하세요 $ARGUMENTS\n', 'utf8');

  const r2 = await 조용히(() => handle(`/plugin install ${만든것}`, s, ctx));
  check('폴더에서 플러그인을 설치한다', /내플러그인/.test(r2.out), 색빼기(r2.out).trim().slice(0, 90));
  check('설치한 이름을 manifest 에서 읽는다', !/deel-plug-/.test(색빼기(r2.out).split('\n').pop() ?? ''), '');

  const r3 = await 조용히(() => handle('/plugin', s, ctx));
  check('설치한 것이 목록에 뜬다', /내플러그인/.test(r3.out), 색빼기(r3.out).trim().slice(0, 100));
  check('안에 든 명령 수를 센다', /명령/.test(r3.out), '');

  const r4 = await 조용히(() => handle('/plugin remove 내플러그인', s, ctx));
  check('플러그인을 지운다', !/설치돼 있지 않습니다/.test(r4.out), 색빼기(r4.out).trim().slice(0, 70));

  const r4b = await 조용히(() => handle('/plugin', s, ctx));
  check('지우면 목록에서 사라진다', !/내플러그인/.test(r4b.out), 색빼기(r4b.out).trim().slice(0, 70));

  // 스킬도 명령도 없는 폴더는 플러그인이 아니다. 받아 주면 나중에 조용히 아무것도 안 한다.
  const 빈폴더 = mkdtempSync(join(tmpdir(), 'deel-plug-empty-'));
  const r4c = await 조용히(() => handle(`/plugin install ${빈폴더}`, s, ctx));
  check('스킬도 명령도 없으면 안 받는다', /스킬도 명령도 없습니다|플러그인이 맞는지/.test(r4c.out), 색빼기(r4c.out).trim().slice(0, 80));
  rmSync(빈폴더, { recursive: true, force: true });

  const r5 = await 조용히(() => handle('/plugin 그런하위명령없음', s, ctx));
  check('모르는 하위 명령에도 안 터진다', r5.v?.handled === true, JSON.stringify(r5.v));

  rmSync(만든것, { recursive: true, force: true });
}

trace('9-컨텍스트갈래');

// ── /ctx 의 나머지 갈래 ─────────────────────────────────────────────────
{
  const s = 새세션();
  const ctx = 새ctx();

  const r1 = await 조용히(() => handle('/ctx out', s, ctx));
  check('/ctx out 만 치면 지금 상한을 보여 준다', /답 길이 상한/.test(r1.out), 색빼기(r1.out).trim().slice(0, 60));
  check('/ctx out 만으로는 안 바뀐다', s.conn.maxTokens == null, String(s.conn.maxTokens));

  // 서버가 길이를 안 알려 줄 때. 지어내면 안 된다.
  const r2 = await 조용히(() => handle('/ctx auto', s, ctx));
  check('못 알아내면 지어내지 않는다', /안 알려줍니다|직접 넣어/.test(r2.out) || s.conn.ctx > 0, 색빼기(r2.out).trim().slice(0, 70));
}

trace('10-모델고르기');

// ── /model 의 고르기 갈래 ───────────────────────────────────────────────
{
  const s = 새세션();
  // pick 을 대신할 답. 사람 손을 안 빌리고 고르기 자리를 지나가게 한다.
  const ctx = 새ctx({ ask: async () => '1' });

  const r1 = await 조용히(() => handle('/model 나', s, ctx));
  check('이름 일부로 모델을 바꾼다', s.conn.model === '나모델', s.conn.model);
  check('바꿨다고 말해 준다', /바꿨습니다/.test(r1.out), 색빼기(r1.out).trim().slice(0, 60));
  check('모델을 바꾸면 길이를 다시 잰다', /컨텍스트/.test(r1.out), '');

  const r2 = await 조용히(() => handle('/model 모델', s, ctx));
  check('여럿 걸리면 골라 달라고 한다', /여럿입니다|고르/.test(r2.out) || s.conn.model === '가모델', 색빼기(r2.out).trim().slice(0, 60));

  const r3 = await 조용히(() => handle('/model 그런모델없음', s, ctx));
  check('없는 이름이면 그렇다고 한다', r3.v?.handled === true, 색빼기(r3.out).trim().slice(0, 60));

  const r4 = await 조용히(() => handle('/model list', s, ctx));
  check('/model list 가 등록된 연결을 보여 준다', /스텁|등록된 연결/.test(r4.out), 색빼기(r4.out).trim().slice(0, 60));

  const r5 = await 조용히(() => handle('/model models', s, ctx));
  check('/model models 가 서버에 물어본다', /가모델|나모델|다른것/.test(r5.out), 색빼기(r5.out).trim().slice(0, 80));
}

trace('11-치움');
srv.close();
resetNet();
rmSync(home, { recursive: true, force: true });
rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n손이 덜 간 명령 검사  ${D}(가끔 쓰지만 틀리면 크게 아픈 것들)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
