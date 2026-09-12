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
import { save } from '../src/config.js';
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

  // 답 길이 상한은 이제 /out 이 본자리다. 컨텍스트와 다른 축이라 명령을 갈랐다.
  // 옛 이름(/ctx out)도 그대로 받는다 — 쓰던 사람의 손버릇을 깨지 않는다.
  const r0 = await 조용히(() => handle('/out', s, ctx));
  check('/out 이 지금 상한을 보여 준다', /한 번에 받을 답 길이/.test(r0.out), 색빼기(r0.out).trim().slice(0, 60));
  check('/out 은 컨텍스트와 다른 축이라고 알려 준다', /다른 축/.test(r0.out), 색빼기(r0.out).slice(0, 200));

  const r1 = await 조용히(() => handle('/ctx out', s, ctx));
  check('옛 이름 /ctx out 도 그대로 받는다', /한 번에 받을 답 길이/.test(r1.out), 색빼기(r1.out).trim().slice(0, 60));
  check('/ctx out 만으로는 안 바뀐다', s.conn.maxTokens == null, String(s.conn.maxTokens));

  // 올린 값이 실제로 남는가. 전에는 저장은 되는데 먹지 않았다(effort.js 의 클램프).
  await 조용히(() => handle('/out 40k', s, ctx));
  check('/out 으로 올리면 실제로 올라간다', s.conn.maxTokens === 40960, String(s.conn.maxTokens));
  await 조용히(() => handle('/out auto', s, ctx));
  check('/out auto 로 직접 정한 값을 지운다', s.conn.maxTokens == null, String(s.conn.maxTokens));

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

trace('11-지난대화찾기');

// ── /recall ─────────────────────────────────────────────────────────────
//
// 여기서 제일 중요한 것은 '찾았다' 가 아니라 **'못 찾은 것과 안 찾아본 것을
// 가르는가'** 다. 둘이 섞이면 사람은 "그런 적 없구나" 로 읽고, 실제로는
// 기록 어딘가에 있는 답을 다시 묻게 된다.
{
  const s = 새세션();
  const ctx = 새ctx();
  const dir = join(root, '.deel', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '20260810-090000.jsonl'), [
    JSON.stringify({ t: 'meta', at: '2026-08-10T09:00:00.000Z', model: '스텁모델' }),
    JSON.stringify({ role: 'user', content: '사내 문서가 한글로 깨져서 열려요' }),
    JSON.stringify({ role: 'assistant', content: 'CP949 인코딩입니다. 읽을 때 재서 그대로 되돌려 쓰면 안 깨집니다.' }),
  ].join('\n') + '\n', 'utf8');

  const r0 = await 조용히(() => handle('/recall', s, ctx));
  check('/recall 만 치면 어떻게 쓰는지 알려 준다', /찾을 말을 적어/.test(색빼기(r0.out)),
    색빼기(r0.out).trim().slice(0, 40));

  // 조사가 붙은 채로 쳐도 찾아야 한다. 한국어로 치면 대개 이렇게 친다.
  const r1 = await 조용히(() => handle('/recall 인코딩을', s, ctx));
  const 본문 = 색빼기(r1.out);
  check('/recall 이 지난 대화를 찾는다', /CP949/.test(본문), 본문.trim().slice(0, 80));
  check('언제·누가 한 말인지 같이 보여 준다', /2026-08-10/.test(본문) && /나|모델/.test(본문),
    본문.trim().slice(0, 120));
  check('그 대화를 이어하는 길도 알려 준다', /--resume 20260810-090000/.test(본문),
    본문.trim().split('\n').at(-1));

  // 없는 것은 없다고 해야 한다 — 몇 개를 뒤졌는지까지 같이.
  const r2 = await 조용히(() => handle('/recall 존재하지않는말뭉치', s, ctx));
  check('없으면 몇 개를 뒤졌는지까지 말한다', /다 뒤졌지만 없습니다/.test(색빼기(r2.out)),
    색빼기(r2.out).trim().slice(0, 60));

  // 한 글자는 아무 데나 걸린다. 찾는 시늉만 하느니 못 찾는다고 하는 편이 낫다.
  const r3 = await 조용히(() => handle('/recall 그', s, ctx));
  check('한 글자면 찾을 낱말이 없다고 한다', /찾을 낱말이 없습니다/.test(색빼기(r3.out)),
    색빼기(r3.out).trim().slice(0, 40));

  rmSync(dir, { recursive: true, force: true });
}

trace('12-기억');

// ── /memory ─────────────────────────────────────────────────────────────
//
// 기억은 매 요청마다 실려 나간다. 그래서 '적히는가' 만큼 **'사람이 보고
// 지울 수 있는가'** 가 중요하다. 틀린 기억은 없느니만 못하다.
{
  const s = 새세션();
  const ctx = 새ctx();
  const M = await import('../src/agent/memory.js');
  M.비우기(root);
  s.memory = M.프롬프트토막(root);

  const r0 = await 조용히(() => handle('/memory', s, ctx));
  check('빈 기억은 비었다고 하고 예를 든다', /아직 없습니다/.test(색빼기(r0.out)) && /CP949/.test(색빼기(r0.out)),
    색빼기(r0.out).trim().slice(0, 60));

  const r1 = await 조용히(() => handle('/memory 사내 문서는 CP949 로 읽고 되돌려 쓴다', s, ctx));
  check('/memory <말> 이 바로 적는다', /기억했습니다/.test(색빼기(r1.out)), 색빼기(r1.out).trim().slice(0, 40));
  check('적은 것이 파일에 남는다', M.읽기(root).줄들.some((l) => /CP949/.test(l)), M.읽기(root).줄들.join('|'));
  // 여기가 핵심이다 — 세션이 그 자리에서 물고 가야 이번 대화부터 먹는다.
  check('이번 대화부터 바로 먹는다', /CP949/.test(s.systemPrompt()), '');

  await 조용히(() => handle('/memory 검증 포트로 7080 은 쓰지 않는다', s, ctx));
  const r2 = await 조용히(() => handle('/memory', s, ctx));
  check('목록에 번호를 붙여 보여 준다', /1 {2}사내 문서/.test(색빼기(r2.out)) && / 2 {2}검증 포트/.test(색빼기(r2.out)),
    색빼기(r2.out).trim().slice(0, 100));
  // 얼마를 무는지 안 보이면 사람은 계속 쌓는다.
  check('매 요청마다 드는 값을 알려 준다', /토큰이 매 요청마다 함께 나갑니다/.test(색빼기(r2.out)),
    색빼기(r2.out).trim().slice(-120));
  check('파일 자리를 알려 준다 (직접 고치라고)', /직접 고치셔도 됩니다/.test(색빼기(r2.out)), '');

  const r3 = await 조용히(() => handle('/memory 지우기 1', s, ctx));
  check('번호로 지운다', /잊었습니다/.test(색빼기(r3.out)), 색빼기(r3.out).trim().slice(0, 50));
  check('지운 것은 프롬프트에서도 빠진다', !/CP949/.test(s.systemPrompt()), '');
  check('나머지는 남는다', /7080/.test(s.systemPrompt()), '');

  const r4 = await 조용히(() => handle('/memory 지우기 99', s, ctx));
  check('없는 번호는 말해 준다', /번호/.test(색빼기(r4.out)), 색빼기(r4.out).trim().slice(0, 50));

  const r5 = await 조용히(() => handle('/memory 비우기', s, ctx));
  check('통째로 비운다', /비웠습니다/.test(색빼기(r5.out)) && M.읽기(root).줄들.length === 0, '');
  check('비우면 프롬프트에서도 사라진다', !/7080/.test(s.systemPrompt()), '');
}

trace('13-밖에서붙인도구');

// ── /mcp ────────────────────────────────────────────────────────────────
//
// 이 화면에서 제일 중요한 줄은 도구 목록이 아니라 **경고**다. MCP 서버는
// 남의 프로그램이고 우리 작업 범위를 안 지킨다. 그 말이 화면에 없으면
// 사람은 우리 도구와 똑같이 안전한 줄 안다.
{
  const s = 새세션();
  const ctx = 새ctx();

  const r0 = await 조용히(() => handle('/mcp', s, ctx));
  const 없을때 = 색빼기(r0.out);
  check('안 붙였으면 없다고 하고 설정 자리를 알려 준다',
    /붙인 것이 없습니다/.test(없을때) && /mcp\.json/.test(없을때), 없을때.trim().slice(0, 100));
  check('안 붙였을 때도 반입 심사를 말한다', /반입 심사/.test(없을때), 없을때.trim().slice(-80));

  // 붙은 것이 있는 화면. 진짜 서버를 띄우는 것은 mcp.test.js 가 하고,
  // 여기서는 **화면에 무엇이 적히는가**만 본다.
  s.mcp = [{
    이름: '사내위키',
    설정: { command: 'node', args: ['wiki-mcp.js'] },
    정보: { name: 'wiki-mcp', version: '1.2.0' },
    도구: [{ name: '문서찾기' }, { name: '문서읽기' }],
    잘림: 3,
    죽음: null,
    살아있나: () => true,
  }];
  const r1 = await 조용히(() => handle('/mcp', s, ctx));
  const 붙었을때 = 색빼기(r1.out);
  check('붙은 서버와 도구를 보여 준다',
    /사내위키/.test(붙었을때) && /문서찾기 · 문서읽기/.test(붙었을때), 붙었을때.trim().slice(0, 120));
  check('뺀 도구가 있으면 몇 개인지 말한다', /3개는 뺐습니다/.test(붙었을때), 붙었을때.trim().slice(0, 200));
  check('모델에게 보이는 이름을 알려 준다', /mcp__<서버>__<도구>/.test(붙었을때), '');
  // 이 두 줄이 이 화면의 존재 이유다.
  check('작업 범위를 안 지킨다고 못 박는다', /작업 범위\(.*\) 를 안 지킵니다/.test(붙었을때),
    붙었을때.trim().split('\n').slice(-3).join(' / '));
  check('무엇을 불렀는지 어디에 남는지 알려 준다', /audit\.jsonl/.test(붙었을때), '');

  s.mcp = [{
    이름: '죽은것', 설정: { command: 'node', args: [] }, 정보: null,
    도구: [], 잘림: 0, 죽음: '켤 때 못 떴습니다 (ENOENT)', 살아있나: () => false,
  }];
  const r2 = await 조용히(() => handle('/mcp', s, ctx));
  check('죽은 서버는 왜 죽었는지 적는다', /ENOENT/.test(색빼기(r2.out)), 색빼기(r2.out).trim().slice(0, 120));
}

trace('13b-지우려다-적고-마는-자리');

// ── 지우려는 명령이 **지우지 않고 다른 일을 하던** 자리들 ─────────────
//
// 여기 모은 것은 전부 한 갈래다: 사람이 무언가를 없애거나 고르려고 쳤는데,
// 명령이 그 말을 못 알아듣고 **다른 일을 한 다음 ✓ 를 찍는다.** 실패가
// 화면에 뜨면 다시 치면 그만이지만, 성공 표시를 보면 아무도 다시 안 친다.
{
  const s = 새세션();
  const ctx = 새ctx();
  const M = await import('../src/agent/memory.js');

  // 1) /memory 지우기 — 번호를 안 붙이면 '지우기' 가 기억으로 적혔다.
  M.비우기(root);
  s.memory = M.프롬프트토막(root);
  await 조용히(() => handle('/memory 사내 문서는 CP949 로 읽는다', s, ctx));
  const 지움 = await 조용히(() => handle('/memory 지우기', s, ctx));
  const 줄들 = M.읽기(root).줄들;
  check('★ /memory 지우기 가 「지우기」 를 기억으로 안 적는다',
    !줄들.some((l) => l.trim() === '지우기'), 줄들.join(' | '));
  check('★ 지우려던 사람에게 번호를 물어본다', /번호/.test(색빼기(지움.out)),
    색빼기(지움.out).trim().slice(0, 60));
  check('★ 지울 것을 고르라고 목록을 같이 보여 준다', /CP949/.test(색빼기(지움.out)), '');
  check('멀쩡한 기억은 그대로 있다', 줄들.length === 1, String(줄들.length));
  for (const 말 of ['rm', '잊어', 'forget']) {
    await 조용히(() => handle(`/memory ${말}`, s, ctx));
  }
  check('★ rm·잊어·forget 도 마찬가지다', M.읽기(root).줄들.length === 1,
    M.읽기(root).줄들.join(' | '));
  M.비우기(root);

  // 2) /undo — 못 읽는 수로 조용히 한 턴을 되돌리지 않는다.
  const u1 = await 조용히(() => handle('/undo 다섯', s, 새ctx()));
  check('★ /undo 다섯 은 숫자를 물어본다', /숫자/.test(색빼기(u1.out)),
    색빼기(u1.out).trim().slice(0, 60));
  check('되돌리지 않는다', !/되돌렸습니다/.test(색빼기(u1.out)), '');
  const u2 = await 조용히(() => handle('/undo -2', s, 새ctx()));
  check('★ 음수도 마찬가지다', /숫자/.test(색빼기(u2.out)), 색빼기(u2.out).trim().slice(0, 40));

  // 3) /skills on <안 걸리는 말> — 가지고 있던 것까지 내리면 안 된다.
  const sk = 새ctx();
  const s2 = 새세션();
  s2.skills = [
    { name: '리뷰하기', description: '코드를 본다', enabled: true },
    { name: '배포하기', description: '올린다', enabled: true },
  ];
  const r만 = await 조용히(() => handle('/skills on 없는말', s2, sk));
  check('★ 안 걸리면 올라간 것을 안 내린다', s2.skills.every((x) => x.enabled === true),
    s2.skills.map((x) => `${x.name}:${x.enabled}`).join(' '));
  check('★ 안 걸린다고 말해 준다', /걸리는 스킬이 없습니다/.test(색빼기(r만.out)),
    색빼기(r만.out).trim().slice(0, 60));
  check('✓ 로 성공한 척하지 않는다', !/개만 올립니다/.test(색빼기(r만.out)), '');
  await 조용히(() => handle('/skills on 리뷰', s2, sk));
  check('걸리면 그것만 올린다',
    s2.skills[0].enabled === true && s2.skills[1].enabled === false,
    s2.skills.map((x) => `${x.name}:${x.enabled}`).join(' '));

  // 4) /learned 전선 — 지우는 말을 적어야 지운다.
  let 지운것 = [];
  const 배움 = {
    지우기: (무엇) => 지운것.push(무엇),
    현황: () => ({ 명령: [], 모델: null, 모델이름: '가모델' }),
  };
  const lc = 새ctx({ 배움 });
  const l1 = await 조용히(() => handle('/learned 전선', s, lc));
  check('★ /learned 전선 만으로는 안 지운다', 지운것.length === 0, 지운것.join(','));
  check('★ 지우는 명령을 알려 준다', /전선 지우기/.test(색빼기(l1.out)),
    색빼기(l1.out).trim().slice(0, 70));
  await 조용히(() => handle('/learned 전선 지우기', s, lc));
  check('적어 주면 지운다', 지운것.includes('전선'), 지운것.join(','));
}

trace('13c-오타가-조용히-먹던-자리');

// ── 못 알아들은 인자를 **못 알아들었다고 말하는가** ────────────────────
//
// /work 는 「그런 모드는 없습니다」 를 먼저 말한다. 같은 저장소 안에서
// /grade·/think 만 오류 없이 지금 상태 표를 띄웠다 — 사람은 정해진 줄로
// 읽고 그대로 쓴다.
//
// 물려받은 열쇠(constructor·__proto__)도 여기서 같이 막는다. 표를 `표[값]`
// 으로 찾으면 그 이름들이 전부 참이라, /mode 는 **아무것도 안 물어보는**
// 상태로 들어가고 /level 은 명령 목록을 그리다 터진다.
{
  const s = 새세션();
  const ctx = 새ctx();

  const g1 = await 조용히(() => handle('/grade 크게', s, ctx));
  check('★ /grade 오타를 못 알아들었다고 말한다', /그런 급은 없습니다/.test(색빼기(g1.out)),
    색빼기(g1.out).trim().slice(0, 60));
  check('오타로는 급이 안 바뀐다', s.급정한것 == null, String(s.급정한것));

  const t1 = await 조용히(() => handle('/think hgih', s, ctx));
  check('★ /think 오타를 못 알아들었다고 말한다', /없습니다/.test(색빼기(t1.out)),
    색빼기(t1.out).trim().slice(0, 60));
  check('오타로는 강도가 안 바뀐다', s.think === 'medium', String(s.think));

  // /think auto 켬 — /bell 은 받는 말인데 여기만 안 받아서 **꺼졌다.**
  s.autoThink = false;
  await 조용히(() => handle('/think auto 켬', s, ctx));
  check('★ /think auto 켬 이 켠다', s.autoThink === true, String(s.autoThink));
  await 조용히(() => handle('/think auto 끔', s, ctx));
  check('/think auto 끔 은 끈다', s.autoThink === false, String(s.autoThink));

  for (const 이름 of ['constructor', '__proto__', 'toString']) {
    const 앞모드 = s.mode;
    const m = await 조용히(() => handle(`/mode ${이름}`, s, ctx));
    check(`★ /mode ${이름} 로는 승인 방식이 안 바뀐다`, s.mode === 앞모드,
      `${앞모드} → ${s.mode}`);
    check(`/mode ${이름} 는 목록을 보여 준다`, /승인 방식/.test(색빼기(m.out)),
      색빼기(m.out).trim().slice(0, 40));

    const 앞급 = s.급정한것;
    await 조용히(() => handle(`/grade ${이름}`, s, ctx));
    check(`★ /grade ${이름} 로는 급이 안 바뀐다`, s.급정한것 === 앞급, String(s.급정한것));

    const 앞수준 = s.level;
    const lv = await 조용히(() => handle(`/level ${이름}`, s, ctx));
    check(`★ /level ${이름} 가 안 터진다`, typeof s.level === 'string' && s.level === 앞수준,
      `${앞수준} → ${String(s.level)}`);
    check(`/level ${이름} 뒤에도 명령 목록이 그려진다`,
      색빼기((await 조용히(() => handle('/help', s, ctx))).out).includes('/model'), '');
  }
}

trace('13f-못한-까닭을-버리지-않나');

// ── 못 했으면 **왜 못 했는지**까지 적는가 ──────────────────────────────
//
// 「못 남겼습니다」 만 뜨면 디스크가 찼는지, 폴더가 읽기 전용인지, 경로가
// 너무 긴지 알 길이 없다. 이 저장소의 저장시도()(config.js)는 이미 까닭을
// 돌려준다 — 파일을 쓰는 다른 두 자리만 옛 모양이었다.
//
// 못 쓰게 만드는 법: **파일**을 하나 만들고 그것을 폴더인 양 준다.
// mkdir 이 ENOTDIR 로 막힌다 — 어느 운영체제에서나 같다.
{
  const { 증거적기 } = await import('../src/agent/evidence.js');
  const { 보고서적기 } = await import('../src/ui/export.js');
  const 막힌자리 = join(root, '이건파일이다');
  writeFileSync(막힌자리, 'x', 'utf8');

  const 탈1 = {};
  const 자리1 = 증거적기(막힌자리, { 바꾼것: [], 돌린것: [], 증명안된것: [] }, 'x', 탈1);
  check('★ 증거를 못 적으면 까닭을 돌려준다', 자리1 === null && !!탈1.왜, JSON.stringify(탈1));

  const 탈2 = {};
  const 자리2 = 보고서적기(막힌자리, 새세션(), {}, 탈2);
  check('★ 보고서를 못 적어도 까닭을 돌려준다', 자리2 === null && !!탈2.왜, JSON.stringify(탈2));

  // 그릇을 안 줘도 여태처럼 조용히 null 이어야 한다 (옛 부르는 자리들).
  check('그릇을 안 주면 여태처럼 null',
    증거적기(막힌자리, { 바꾼것: [], 돌린것: [], 증명안된것: [] }, 'x') === null, '');

  /*
   * 화면에도 그 까닭이 적히나.
   *
   * 증거가 비어 있으면 명령이 일찍 끝나 파일을 쓰지도 않는다 — 그러면 이
   * 검사가 **아무것도 안 재고 통과한다.** 그래서 감사기록을 하나 남겨
   * 증거를 채운 뒤에 부른다.
   */
  const s점 = 새세션();
  s점.root = 막힌자리;
  const ctx점 = 새ctx();
  ctx점.audit.tool('Bash', { command: 'npm test' }, { ok: true, summary: '9,762개 통과' });
  const r = await 조용히(() => handle('/evidence 파일', s점, ctx점));
  const 글 = 색빼기(r.out);
  check('증거가 비어 있지 않다 — 그래야 파일을 쓴다',
    /못 남겼습니다|남겼습니다/.test(글), 글.trim().slice(-60));
  check('★ 화면에도 못 적은 까닭이 뜬다',
    /ENOTDIR|ENOENT|EACCES|EPERM|ENAMETOOLONG/i.test(글), 글.trim().slice(-100));
}

trace('13g-엉뚱한-프로필에-안-적나');

// ── `/ctx` 가 **지금 쓰는 연결**에 적는가 ──────────────────────────────
//
// 여태 `active 로 찾고 없으면 첫 번째` 였다. active 가 어긋나 있으면
// `/ctx 655360` 이 엉뚱한 연결에 박히고 화면은 「프로필에 저장했습니다」 를
// 찍는다. 8k 서버 프로필에 655,360 이 적히면 다음에 켤 때 그 값을 믿고
// 시작해서, 긴 대화에서 서버가 거절한다 — 까닭을 짚을 자리가 화면에 없다.
{
  const { load, save } = await import('../src/config.js');
  const 원래설정 = load();
  const 다른곳 = 'http://127.0.0.1:59999/v1';
  save({
    version: 1, active: '없는아이디',
    profiles: [
      { id: '남의것', name: '남의 것', kind: 'openai', baseUrl: 다른곳, auth: 'none', apiKey: '', model: '남의모델', ctx: 8192 },
      { id: '내것', name: '내 것', kind: 'openai', baseUrl: base, auth: 'none', apiKey: '', model: '가모델', ctx: 32768 },
    ],
  });
  await 조용히(() => handle('/ctx 65536', 새세션(), 새ctx()));
  const 뒤 = load();
  const 남의것 = 뒤.profiles.find((x) => x.id === '남의것');
  const 내것 = 뒤.profiles.find((x) => x.id === '내것');
  check('★ active 가 어긋나도 엉뚱한 연결에 안 적는다', 남의것.ctx === 8192,
    `남의것 ctx=${남의것.ctx}`);
  check('★ 지금 붙어 있는 연결에 적는다', 내것.ctx === 65536, `내것 ctx=${내것.ctx}`);

  /*
   * 어느 프로필도 아닌 연결에 붙어 있으면 — **아무 데도 안 적는다.**
   *
   * 여기가 옛 폴백이 물리던 자리다. 못 찾았으면 첫 번째에 쓰는 것이 아니라,
   * 못 찾았다고 말해야 한다. 안 그러면 남의 연결에 값이 박히고 화면은
   * 「저장했습니다」 를 찍는다.
   */
  const 낯선 = 새세션();
  낯선.conn.base = 'http://127.0.0.1:59998/v1';
  낯선.conn.model = '어디에도-없는-모델';
  const r낯선 = await 조용히(() => handle('/ctx 131072', 낯선, 새ctx()));
  const 뒤2 = load();
  check('★ 모르는 연결이면 어느 프로필에도 안 적는다',
    뒤2.profiles.every((x) => x.ctx !== 131072),
    뒤2.profiles.map((x) => `${x.id}:${x.ctx}`).join(' '));
  check('★ 못 남겼다고 말한다', /못 남겼습니다|못 찾아/.test(색빼기(r낯선.out)),
    색빼기(r낯선.out).trim().slice(-90));
  check('그래도 이번 대화에는 먹는다', 낯선.conn.ctx === 131072, String(낯선.conn.ctx));

  save(원래설정);
}

trace('13e-종소리');

// ── /bell 이 **이 세션에도** 먹나 ───────────────────────────────────────
//
// 명령은 설정 파일만 고쳤다. 울릴지 말지는 repl 이 켤 때 한 번 읽어 둔
// 값이 정하므로, `/bell off` 를 쳐도 그 세션 내내 계속 울렸다 — 화면은
// 「이 세션에도 바로 먹습니다」 라고 적으면서. 회의 중에 끄러 들어온
// 사람이 껐다고 믿고 나간다.
{
  const s = 새세션();
  const 종알림 = { 켬: true, 폴더: 'x' };
  const ctx = 새ctx({ 종알림 });

  const r1 = await 조용히(() => handle('/bell off', s, ctx));
  check('★ /bell off 가 이 세션의 종을 바로 끈다', 종알림.켬 === false, String(종알림.켬));
  check('껐다고 말한다', /껐|off/i.test(색빼기(r1.out)), 색빼기(r1.out).trim().slice(0, 40));

  const r2 = await 조용히(() => handle('/bell', s, ctx));
  check('★ 상태도 이 세션 값을 말한다 — 설정 파일이 아니라',
    !/켜져/.test(색빼기(r2.out)), 색빼기(r2.out).trim().slice(0, 60));

  await 조용히(() => handle('/bell on', s, ctx));
  check('★ /bell on 도 바로 먹는다', 종알림.켬 === true, String(종알림.켬));

  // 그릇이 없는 자리(oneshot 등)에서도 안 터져야 한다.
  const r3 = await 조용히(() => handle('/bell off', s, 새ctx()));
  check('그릇이 없어도 안 터진다', r3.v?.handled === true, JSON.stringify(r3.v));
}

trace('13d-슬래시-경로');

/*
 * `/tmp` 처럼 **슬래시가 하나뿐인 진짜 경로**를 명령으로 오해하면 안 된다.
 *
 * 여러 마디짜리 경로는 낱말 안에 슬래시가 있어서 바로 위 갈래가 잡는다.
 * 여기서 재는 것은 마디가 하나뿐이라 **그 자리가 있나 봐야만** 아는 경우다 —
 * 앞 슬래시를 떼고 보면 지금 폴더의 상대 경로를 찾게 되어 한 번도 안 맞는다.
 */
{
  const s = 새세션();
  const ctx = 새ctx();
  // 이 컴퓨터에 실제로 있는 한 마디짜리 뿌리 폴더를 고른다(윈도는 지금 드라이브 기준).
  const 뿌리한마디 = tmpdir().replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
    .split('/').filter(Boolean)[0] ?? '';
  const 절대 = `/${뿌리한마디}`;
  if (뿌리한마디 && existsSync(절대) && !existsSync(뿌리한마디)) {
    const r = await 조용히(() => handle(절대, s, ctx));
    // 경로로 봤으면 모델에게 넘긴다(handled=false). 명령으로 봤으면 여기서 잡아먹는다.
    check('★ 한 마디짜리 진짜 경로를 명령으로 안 본다', r.v?.handled === false,
      `${절대} → ${JSON.stringify(r.v)}`);
  } else {
    check('한 마디짜리 뿌리 폴더를 못 골라 건너뜀', true, 절대);
  }
  // 여러 마디짜리는 여태처럼 그대로 넘어간다.
  const 여러마디 = root.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');
  const r2 = await 조용히(() => handle(여러마디, s, ctx));
  check('여러 마디짜리 경로도 그대로 경로다', r2.v?.handled === false, 여러마디);
}

trace('13h-물려받은-이름을-있는-것으로-읽지-않나');

// ── `표[값]` 이 **없는 이름에도 참**이 되던 자리 ────────────────────────
//
// 모든 객체는 `constructor` · `toString` · `valueOf` 를 물려받는다. 그래서
// `PROFILES[k] ? k : …` 는 아무도 정한 적 없는 이름에 참을 낸다. 이 저장소는
// 같은 함정을 modes.js · /mode · /grade · ui/level.js 에서 이미 닫았는데
// 배분(effort) 표 하나가 옛 모양으로 남아 있었다.
//
// 고치기 전 화면은 이랬다 — **✓ 를 먼저 찍고 나서** 표를 그리다 터진다:
//   /think 배분 constructor  ->  ✓ 배분 Object — undefined
//                                (그 뒤 p.shift[stage] 에서 TypeError)
//   /think 배분 toString     ->  ALIAS 가 **함수**를 돌려줘 이름 찍다 TypeError
//
// 터지는 것만 문제가 아니다. session.effort 에 그 이름이 박히면 그 판의
// 남은 턴이 전부 걸음 예산 계산에서 터진다 — 사람은 배분을 바꿨다고 믿고 있다.
{
  const { normalizeProfile } = await import('../src/agent/effort.js');

  for (const 나쁜 of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    check(`★ normalizeProfile('${나쁜}') 은 null`, normalizeProfile(나쁜) === null,
      String(typeof normalizeProfile(나쁜)));
  }
  // 멀쩡한 것은 그대로여야 한다. 막느라 있는 이름까지 막으면 안 된다.
  check('제 이름은 그대로', normalizeProfile('save') === 'save' && normalizeProfile('절약') === 'save',
    `${normalizeProfile('save')} · ${normalizeProfile('절약')}`);
  check('대소문자도 그대로', normalizeProfile('DEEP') === 'deep', String(normalizeProfile('DEEP')));

  // 명령까지 와서 무엇이 보이나.
  const s배분 = 새세션();
  const r배분 = await 조용히(() => handle('/think 배분 constructor', s배분, 새ctx()));
  const 글배분 = 색빼기(r배분.out);
  check('★ 모르는 배분이면 값이 안 바뀐다', s배분.effort === 'save', String(s배분.effort));
  check('★ Object 라고 안 찍는다', !/배분 Object|— undefined/.test(글배분), 글배분.trim().slice(0, 80));
  check('★ 고를 수 있는 배분을 보여 준다', /even|save|deep/.test(글배분), 글배분.trim().slice(0, 80));

  const s투 = 새세션();
  await 조용히(() => handle('/think 배분 toString', s투, 새ctx()));
  check('★ toString 도 값이 안 바뀐다', s투.effort === 'save', String(s투.effort));

  // 진짜로 바꾸는 길은 살아 있나.
  const s된것 = 새세션();
  await 조용히(() => handle('/think 배분 깊게', s된것, 새ctx()));
  check('제대로 친 배분은 먹는다', s된것.effort === 'deep', String(s된것.effort));
}

trace('14-치움');
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
