/**
 * 로컬은 앞머리를 짧은 판으로 (2.2.2 · agent/budget.js 의 프롬프트창).
 *
 * 로컬 서버는 토큰값이 없는 대신 앞머리를 읽는 **시간**이 든다. 그런데 프롬프트의 모양은 창 크기로만
 * 정해져서, 65k 창의 맥 서버가 큰 게이트웨이와 똑같이 긴 판(규칙 글·도구 설명·스킬 40개)을 읽었다.
 * 로컬은 창이 얼마든 24k 아래의 판으로 간다. 이 파일이 지키는 것은 넷이다.
 *
 *   1. 로컬의 고정 몫(시스템 + 도구)이 실제로 준다.
 *   2. **바깥 연결은 글자 하나도 안 달라진다** — 창이 커도, 좁아도.
 *   3. 줄이는 것은 설명뿐이다 — 도구 이름·인자·required·enum·타입은 그대로.
 *   4. 모양만 줄고 **예산은 실제 창**을 쓴다 — 읽을 줄 수·걸음 수·/context 의 총량.
 *
 * 그리고 미리 읽기(warm.js)가 먼저 보내는 앞머리·/context 가 재는 값이 실제로 나가는 것과
 * 한 글자도 다르지 않아야 한다. 어긋나도 아무 데도 안 찍히고 느리기만 해서 바이트로 견준다.
 */
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { allowEndpoint } from '../src/safety/network.js';
import { Session, estimateTokens } from '../src/agent/session.js';
import { run, 턴도구 } from '../src/agent/loop.js';
import { route } from '../src/agent/route.js';
import { 미리읽기 } from '../src/agent/warm.js';
import { 프롬프트창, 로컬연결인가, 읽을줄수, 걸음수, 설명길이 } from '../src/agent/budget.js';
import { 말 as 모드말 } from '../src/agent/modes.js';
import { toolSchemas } from '../src/tools/index.js';
import { 언어, 언어정하기, 말 as 옮긴말 } from '../src/i18n/index.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 쉬기 = (ms) => new Promise((r) => setTimeout(r, ms));
async function 될때까지(조건, ms = 3000) {
  const 끝 = Date.now() + ms;
  while (Date.now() < 끝) { if (조건()) return true; await 쉬기(10); }
  return 조건();
}

const 원래말 = 언어();
const root = mkdtempSync(join(tmpdir(), 'deel-lean-'));   // 비어 있는 폴더 — 규칙·스킬·기억이 없는 바닥 값을 잰다
const 일하는곳 = mkdtempSync(join(tmpdir(), 'deel-lean-work-'));
writeFileSync(join(일하는곳, 'app.js'), 'const port = 7080;\nstart(port);\n', 'utf8');
const 큰파일 = Array.from({ length: 3000 }, (_, i) => `줄 ${i + 1}`).join('\n');
writeFileSync(join(일하는곳, 'big.txt'), 큰파일, 'utf8');

const 로컬주소 = 'http://127.0.0.1:8080/v1';
const 바깥주소 = 'https://api.example.com/v1';
const 연결 = (base, ctx, o = {}) => ({ kind: 'openai', base, auth: 'none', model: 'm', ctx, streaming: true, tools: true, ...o });
const 로컬 = (ctx, o) => 연결(로컬주소, ctx, o);
const 바깥 = (ctx, o) => 연결(바깥주소, ctx, o);
const 세션 = (conn, o = {}) => new Session(conn, { root, work: 'auto', ...o });
const 이름 = (t) => t.function.name;

/** 시스템 글과 도구 스키마 — 실제로 나가는 두 가지. */
function 앞머리재기(s) {
  const 글 = s.systemPrompt();
  const 도구 = 턴도구(s, {});
  return { 글, 도구, 시스템토큰: estimateTokens(글), 도구토큰: estimateTokens(JSON.stringify(도구)) };
}
const 행 = (s, 열쇠) => s.breakdown().rows.find((r) => r.label === 옮긴말(열쇠));

// ══ 0. 프롬프트창() 자체 ═════════════════════════════════════════════════════
{
  check('로컬 65k → 23999', 프롬프트창(로컬(65536)) === 23999);
  check('로컬 200k → 23999', 프롬프트창(로컬(200000)) === 23999);
  check('로컬 24000 → 23999 (24k 경계 바로 아래)', 프롬프트창(로컬(24000)) === 23999);
  check('로컬 8k → 8k 그대로 (더 키우지 않는다)', 프롬프트창(로컬(8192)) === 8192);
  check('로컬 창을 모르면 → 23999', 프롬프트창(로컬(undefined)) === 23999 && 프롬프트창(로컬(null)) === 23999
    && 프롬프트창(로컬(0)) === 23999 && 프롬프트창(로컬(-5)) === 23999 && 프롬프트창(로컬('abc')) === 23999);
  check('사내망(192.168.*)도 로컬로 본다', 프롬프트창(연결('http://192.168.0.10:8000/v1', 65536)) === 23999);
  check('★ 바깥 65k → 65536 그대로', 프롬프트창(바깥(65536)) === 65536);
  check('★ 바깥은 모르면 null 그대로 (예전 conn.ctx ?? null)', 프롬프트창(바깥(undefined)) === null && 프롬프트창(바깥(null)) === null);
  check('★ 바깥은 0 도 그대로 (건드리지 않는다)', 프롬프트창(바깥(0)) === 0);
  check('연결이 없으면 바깥으로 친다 (모를 땐 조이는 쪽 — 출력이 안 달라진다)', 프롬프트창(undefined) === null && 로컬연결인가(undefined) === false && 로컬연결인가({}) === false);
}

// ══ 1. 로컬 65k: 고정 몫이 준다 ══════════════════════════════════════════════
for (const 말 of ['ko', 'en']) {
  언어정하기(말);
  const 로 = 앞머리재기(세션(로컬(65536)));
  const 바 = 앞머리재기(세션(바깥(65536)));
  const 합 = 로.시스템토큰 + 로.도구토큰;
  check(`★ ${말}: 로컬 65k 의 시스템+도구 ${합}t ≤ 4,600t`, 합 <= 4600, `시스템 ${로.시스템토큰} + 도구 ${로.도구토큰}`);
  check(`${말}: 시스템 글도 줄고 도구 설명도 준다 (바깥 ${바.시스템토큰}+${바.도구토큰})`,
    로.시스템토큰 < 바.시스템토큰 && 로.도구토큰 < 바.도구토큰);
  // 모델 급(작음·보통·큼)은 실제 창으로 매긴다 — 능력의 짐작이지 프롬프트 모양이 아니다(grade.js). 같은 급인 32k 와 견준다.
  check(`${말}: 로컬 65k 는 로컬 32k 와 같은 판이다 (창이 커도 읽는 앞머리는 같다)`, (() => {
    const 작 = 앞머리재기(세션(로컬(32768)));
    return 작.글 === 로.글 && JSON.stringify(작.도구) === JSON.stringify(로.도구);
  })());
  check(`${말}: 로컬 24000 은 23999 와 같은 판이다 (24k 경계에서 긴 판으로 안 뛴다)`, (() => {
    const 아래 = 앞머리재기(세션(로컬(23999)));
    const 위 = 앞머리재기(세션(로컬(24000)));
    return 아래.글 === 위.글 && JSON.stringify(아래.도구) === JSON.stringify(위.도구);
  })());
}
언어정하기('ko');

// ══ 2. 바깥 연결은 글자 하나도 안 달라진다 ═════════════════════════════════════
{
  // 기준은 이 변경이 없을 때의 모양 = 「실제 창 크기로만 정한다」. 그 기준을 직접 짓는다.
  const 기준도구 = (ctx, work) => toolSchemas(null, { hasSkills: false, web: true, work, mcp: null, lsp: false, vision: false, ctx });
  for (const ctx of [4096, 8192, 16384, 23999, 24000, 32768, 65536, 200000]) {
    const s = 세션(바깥(ctx));
    const 지금 = 턴도구(s, {});
    check(`★ 바깥 ${ctx}: 도구 스키마가 창 크기로만 정한 기준과 바이트로 같다`,
      JSON.stringify(지금) === JSON.stringify(기준도구(ctx, s.effectiveWork())),
      `${JSON.stringify(지금).length} vs ${JSON.stringify(기준도구(ctx, s.effectiveWork())).length}`);
    const 글 = s.systemPrompt();
    const 모드글 = 모드말(s.effectiveWork(), ctx);
    check(`★ 바깥 ${ctx}: 시스템 글 끝의 모드 글이 창 크기로만 정한 것과 같다`, 글.includes(모드글));
  }
  // 큰 창은 설명을 안 줄인 원본 그대로, 작은 창은 줄인 채 — 로컬이 아니니 어느 쪽도 안 움직인다.
  const 원본 = JSON.stringify(toolSchemas(null, { hasSkills: false, web: true, work: 'auto', ctx: 1e9 }));
  check('★ 바깥 65k: 도구 설명을 한 글자도 안 줄인다 (긴 판)', JSON.stringify(턴도구(세션(바깥(65536)), {})) === 원본);
  check('★ 바깥 65k: 기본 규칙이 긴 판이다', (() => {
    const 긴 = 세션(바깥(65536)).systemPrompt();
    const 짧 = 세션(바깥(16384)).systemPrompt();
    return 긴.length > 짧.length + 300;
  })());
  check('바깥 창을 모르면(null) 예전처럼 모를때(32k) 판', JSON.stringify(턴도구(세션(바깥(null)), {})) === JSON.stringify(기준도구(null, 세션(바깥(null)).effectiveWork())));
  check('바깥 설명길이: 64k 이상은 그대로(Infinity), 아래는 유한', 설명길이(65536) === Infinity && Number.isFinite(설명길이(32768)));
  // 핵심 문장·enum 보강(핵심남김)은 로컬 판에서만 — 바깥의 좁은 창은 여태와 같아야 한다.
  const 바깥8k = JSON.stringify(턴도구(세션(바깥(8192)), {}));
  check('★ 바깥 8k 도 기준과 같다 (핵심남김이 새어 들지 않는다)', 바깥8k === JSON.stringify(기준도구(8192, 세션(바깥(8192)).effectiveWork())));
}

// ══ 3. 이름·인자·required·enum·타입은 로컬/바깥이 같다 ═══════════════════════════
{
  /** 설명만 빼고 남은 규격 전부 — 경로째로 펼친다. */
  const 규격 = (o, 길 = '', 밖 = []) => {
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'description') continue;
        밖.push(`${길}/${k}${v && typeof v === 'object' ? '' : `=${JSON.stringify(v)}`}`);
        규격(v, `${길}/${k}`, 밖);
      }
    }
    return 밖;
  };
  const 도구들 = (conn) => {
    const s = 세션(conn);
    s.skills = [{ name: 's', description: 'd', source: 'user', enabled: true }];   // Skill 도구까지 보게 한다
    return toolSchemas(s.도구제한 ?? null, { hasSkills: true, web: true, work: s.effectiveWork(), lsp: true,
      ctx: 프롬프트창(conn), 핵심남김: 로컬연결인가(conn) });
  };
  for (const ctx of [8192, 16384, 65536, 200000]) {
    const 로 = 도구들(로컬(ctx));
    const 바 = 도구들(바깥(200000));   // 설명을 안 줄인 원본이 규격의 기준이다
    check(`로컬 ${ctx}: 도구 이름 목록이 같다`, 로.map(이름).join() === 바.map(이름).join());
    const 어긋남 = [];
    for (let i = 0; i < 바.length; i++) {
      const 가 = 규격(바[i].function.parameters).sort();
      const 나 = new Set(규격(로[i].function.parameters));
      const 빠진 = 가.filter((x) => !나.has(x));
      if (빠진.length) 어긋남.push(`${이름(바[i])}: ${빠진.slice(0, 3).join(' ')}`);
    }
    check(`★ 로컬 ${ctx}: 인자 이름·required·enum·타입이 하나도 안 빠진다`, 어긋남.length === 0, 어긋남.slice(0, 3).join(' | '));
  }
  check('TodoWrite 의 state enum 이 로컬에서 남는다 (배열 속 칸)', (() => {
    const t = toolSchemas(null, { work: 'auto', ctx: 프롬프트창(로컬(65536)), 핵심남김: true }).find((x) => 이름(x) === 'TodoWrite');
    return JSON.stringify(t.function.parameters.properties.todos.items.properties.state.enum) === '["todo","doing","done"]';
  })());
  // 인자 설명도 줄인다 — 80자 넘는 설명이 로컬에 남아 있으면 안 된다.
  {
    const 긴것 = [];
    for (const t of toolSchemas(null, { work: 'auto', ctx: 프롬프트창(로컬(65536)), 핵심남김: true })) {
      for (const [k, v] of Object.entries(t.function.parameters?.properties ?? {})) {
        if (String(v.description ?? '').length > 80) 긴것.push(`${이름(t)}.${k}(${v.description.length})`);
      }
    }
    check('로컬: 80자 넘는 매개변수 설명이 없다', 긴것.length === 0, 긴것.join(' '));
  }
  // 로컬의 Outline 설명은 Read 를 말리지 않고 언제 쓰는지만 적는다. 두 말 모두.
  for (const 말 of ['ko', 'en']) {
    언어정하기(말);
    const o = toolSchemas(null, { work: 'auto', ctx: 프롬프트창(로컬(65536)), 핵심남김: true }).find((x) => 이름(x) === 'Outline');
    check(`★ ${말}: 로컬의 Outline 설명은 언제 쓰는지를 적는다`, /모를 때만|do not know which file/.test(o.function.description), o.function.description);
    const 바 = toolSchemas(null, { work: 'auto', ctx: 8192 }).find((x) => 이름(x) === 'Outline');
    check(`  ${말}: 그 보강은 로컬 판에서만 — 바깥 8k 는 여태처럼 잘린 채다`, 말 === 'ko' || !/Call this before/.test(바.function.description));
  }
  언어정하기('ko');
}

// ══ 4. /context 가 재는 값 = 실제로 나가는 것 ═════════════════════════════════════
{
  const 스킬들 = [
    ...Array.from({ length: 8 }, (_, i) => ({ name: `프로젝트스킬${i}`, description: `프로젝트 스킬 ${i} 설명 `.repeat(30), source: 'project', enabled: true })),
    ...Array.from({ length: 20 }, (_, i) => ({ name: `플러그인${i}`, description: `플러그인 ${i} 설명 `.repeat(30), source: 'plugin', enabled: true })),
  ];
  for (const [이름_, conn] of [['로컬 65k', 로컬(65536)], ['바깥 65k', 바깥(65536)], ['로컬 8k', 로컬(8192)], ['바깥 8k', 바깥(8192)]]) {
    for (const 스킬 of [false, true]) {
      const s = 세션(conn);
      if (스킬) s.skills = 스킬들;
      const 실제 = 앞머리재기(s);
      const bd = s.breakdown();
      check(`★ ${이름_}${스킬 ? ' + 스킬' : ''}: /context 의 도구 칸 = 실제 스키마 토큰`, 행(s, 'ctx.tools').n === 실제.도구토큰,
        `${행(s, 'ctx.tools').n} vs ${실제.도구토큰}`);
      // 시스템 칸 + 규칙·기억·배움·스킬 칸 = 시스템 글 전체 (조각을 손으로 나열하지 않고 한 곳에서 잰다)
      const 시스템칸 = bd.rows.slice(0, 5).reduce((a, r) => a + r.n, 0);   // 시스템·규칙·기억·배움·스킬
      check(`${이름_}${스킬 ? ' + 스킬' : ''}: /context 위쪽 다섯 칸(시스템·규칙·기억·배움·스킬)의 합 = 시스템 글 토큰`,
        시스템칸 === 실제.시스템토큰, `${시스템칸} vs ${실제.시스템토큰}`);
      check(`${이름_}${스킬 ? ' + 스킬' : ''}: /context 총량은 실제 창이다 (모양 창이 아니다)`, bd.total === conn.ctx, `${bd.total}`);
    }
  }
  언어정하기('ko');
}

// ══ 5. 미리 읽기 앞머리 = Enter 뒤 첫 요청 앞머리 (로컬 65k · 진짜 루프 · 가짜 서버) ═══════
const 받은 = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    let 몸 = {};
    try { 몸 = JSON.parse(body); } catch { /* 빈 몸 */ }
    const 미리 = 몸.stream !== true && (몸.options?.num_predict === 1 || 몸.max_tokens === 1);
    받은.push({ 길: req.url, 몸, 미리 });
    if (req.url.endsWith('/api/chat')) {
      if (미리) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ model: 몸.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'length', prompt_eval_count: 900, eval_count: 1 }));
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ model: 몸.model, message: { role: 'assistant', content: '네.' }, done: false }) + '\n');
      return res.end(JSON.stringify({ model: 몸.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 12, eval_count: 5 }) + '\n');
    }
    if (미리) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 900, completion_tokens: 1 } }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // 대본: 요청 번호가 걸음 수 시험의 길이 안이면 계속 다른 줄을 읽게 하고, 아니면 말로 끝낸다.
    const n = 받은.filter((x) => !x.미리).length;
    if (대본.길이 && n <= 대본.길이) {
      const 인자 = JSON.stringify(대본.인자(n));
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${n}`, function: { name: 'Read', arguments: 인자 } }] } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '네.' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5 } })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
const 대본 = { 길이: 0, 인자: () => ({}) };
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const 포트 = server.address().port;

const 문맥 = (conn) => ({
  scope: makeScope(일하는곳), history: new History(일하는곳), audit: new Audit(일하는곳), seen: new Set(),
  // repl 이 문맥에 싣는 그대로 — 예산(읽을 줄 수 등)은 실제 창을 본다.
  get 모델컨텍스트() { return conn.ctx ?? null; },
});
async function 턴(session, ctx, 말) {
  session.routed = null;
  if (session.work === 'auto') session.routed = route(말).mode ?? null;
  const 일 = [];
  for await (const ev of run(session, ctx, 말)) 일.push(ev);
  return 일;
}
const 앞머리 = (몸) => JSON.stringify({ model: 몸.model, messages: 몸.messages, tools: 몸.tools, think: 몸.think, num_ctx: 몸.options?.num_ctx, keep_alive: 몸.keep_alive });
function 어긋난곳(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i >= a.length && a.length === b.length ? '' : `${i}번째 글자에서 갈림: 미리「${a.slice(Math.max(0, i - 40), i + 60)}」 진짜「${b.slice(Math.max(0, i - 40), i + 60)}」`;
}

for (const [갈래, o] of [
  ['Ollama', { kind: 'ollama', base: `http://127.0.0.1:${포트}`, auth: 'none', model: 'qwen2.5-coder:7b', ctx: 65536, streaming: true, tools: true, json: true, think: false }],
  ['OpenAI 호환(llama.cpp)', { kind: 'openai', base: `http://127.0.0.1:${포트}/v1`, auth: 'none', model: 'local-model', ctx: 65536, streaming: true, tools: true }],
]) {
  allowEndpoint(o.base);
  받은.length = 0;
  const conn = { ...o };
  const s = new Session(conn, { root: 일하는곳, work: 'auto', think: 'off' });
  s.skills = Array.from({ length: 30 }, (_, i) => ({ name: `스킬${i}`, description: `설명 ${i} `.repeat(40), source: i < 5 ? 'project' : 'plugin', enabled: true }));
  const ctx = 문맥(conn);
  const 판 = new 미리읽기(s, ctx, { env: {}, 쉼: 10 });
  s.미리읽기 = 판;
  판.풀기();
  await 될때까지(() => !판.상태().도는중 && 판.상태().횟수 === 1);
  const 말 = 'app.js 의 포트를 7099 로 바꿔줘';
  판.쳤다(말);
  await 될때까지(() => !판.상태().도는중 && 판.상태().횟수 === 2);
  판.잠그기();
  await 턴(s, ctx, 말);
  const 미리것 = 받은.filter((x) => x.미리);
  const 진짜 = 받은.find((x) => !x.미리);
  check(`${갈래}: 미리 나간 것이 있고 진짜 요청도 나갔다`, 미리것.length === 2 && !!진짜, `${미리것.length}`);
  check(`★★ ${갈래} 로컬 65k: 미리 보낸 앞머리 = Enter 뒤 첫 요청 앞머리 (시킴말·도구·생각·창)`,
    !!진짜 && 앞머리(미리것[1].몸) === 앞머리(진짜.몸), 진짜 ? 어긋난곳(앞머리(미리것[1].몸), 앞머리(진짜.몸)) : '진짜 요청이 없다');
  const 시킴 = String(진짜?.몸.messages?.[0]?.content ?? '');
  const 스킬줄 = 시킴.split('\n').filter((l) => /^- 스킬\d+: /.test(l));
  check(`${갈래}: 실제 요청의 시킴말도 로컬 판이다 (스킬 12개 이하·설명 80자 이하)`,
    스킬줄.length > 0 && 스킬줄.length <= 12 && 스킬줄.every((l) => l.replace(/^- 스킬\d+: /, '').length <= 80), `${스킬줄.length}줄`);
  check(`${갈래}: 실제 요청의 도구도 로컬 판이다 (설명이 원본보다 짧다)`,
    JSON.stringify(진짜?.몸.tools ?? []).length < JSON.stringify(toolSchemas(null, { work: 'code', hasSkills: true, ctx: 1e9 })).length * 0.85);
  if (o.kind === 'ollama') {
    check('★ Ollama num_ctx 는 실제 창(65536) 그대로다 — 모양만 줄인다', 진짜?.몸.options?.num_ctx === 65536, String(진짜?.몸.options?.num_ctx));
  }
}

// ══ 6. 예산은 로컬에서도 실제 창 65k 기준 그대로 ═══════════════════════════════════
{
  const conn = 로컬(65536);
  const s = 세션(conn);
  check('★ 예산 함수는 실제 창을 본다: 읽을줄수(65536) 가 23999 때보다 크다', 읽을줄수(65536) > 읽을줄수(23999), `${읽을줄수(65536)} vs ${읽을줄수(23999)}`);
  check('★ /context 총량 = 실제 창 65536 (접기 문턱이 보는 값)', s.breakdown().total === 65536 && s.breakdown().left <= 65536);
  check('연결의 ctx 는 건드리지 않는다', s.conn.ctx === 65536 && 프롬프트창(s.conn) === 23999 && s.conn.ctx === 65536);

  // 소스 지킴이: 프롬프트창() 은 모양을 고르는 자리에서만 부르고, 예산 함수에는 안 넘긴다.
  const 소스 = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const 예산함수 = /(읽을줄수|찾을개수|찾을줄수|뼈대줄수|웹글자수|한번에낼글자수|걸음수|하위걸음수|요약길이)\(/;
  const 쓴곳 = [];
  for (const p of ['agent/session.js', 'agent/loop.js', 'agent/warm.js', 'agent/compact.js', 'tools/index.js', 'repl.js', 'oneshot.js', 'commands.js', 'acp/serve.js']) {
    소스(p).split('\n').forEach((줄, i) => {
      if (!줄.includes('프롬프트창(')) return;
      if (/^\s*(\/\/|\*|\/\*)/.test(줄)) return;
      쓴곳.push({ p, 줄: i + 1, 예산: 예산함수.test(줄) });
    });
  }
  check('★ 프롬프트창() 을 부르는 자리는 session.js · loop.js 뿐이다', 쓴곳.every((x) => ['agent/session.js', 'agent/loop.js'].includes(x.p)),
    쓴곳.map((x) => `${x.p}:${x.줄}`).join(' '));
  check('★ 프롬프트창() 을 예산 함수에 넘기는 줄이 없다', 쓴곳.every((x) => !x.예산), 쓴곳.filter((x) => x.예산).map((x) => `${x.p}:${x.줄}`).join(' '));
  check('프롬프트창() 의 정의는 budget.js 한 곳에만 있다', ['agent/session.js', 'agent/loop.js', 'tools/index.js', 'agent/warm.js']
    .every((p) => !/function 프롬프트창/.test(소스(p))) && /export function 프롬프트창/.test(소스('agent/budget.js')));

  // 진짜 루프: 로컬 65k 에서 Read 가 3000줄 파일을 실제 창 기준 줄 수만큼 읽고, 걸음 수가 24k 로 깎이지 않는다.
  allowEndpoint(`http://127.0.0.1:${포트}/v1`);
  const c = { kind: 'openai', base: `http://127.0.0.1:${포트}/v1`, auth: 'none', model: 'local-model', ctx: 65536, streaming: true, tools: true };
  받은.length = 0;
  대본.길이 = 1;
  대본.인자 = () => ({ file_path: 'big.txt' });
  const 일 = new Session(c, { root: 일하는곳, work: 'code', think: 'off' });
  await 턴(일, 문맥(c), 'big.txt 를 읽어줘');
  const 결과 = JSON.stringify(받은.find((x) => !x.미리 && x.몸.messages?.some((m) => m.role === 'tool'))?.몸.messages.filter((m) => m.role === 'tool') ?? []);
  const 읽은줄 = Math.max(0, ...[...결과.matchAll(/줄 (\d+)/g)].map((m) => Number(m[1])));
  check('★ Read 가 읽은 줄 수가 실제 창 기준이다 (23999 기준 281줄에서 안 끊긴다)', 읽은줄 > 읽을줄수(23999) && 읽은줄 <= 읽을줄수(65536), `${읽은줄}줄 · 65k 상한 ${읽을줄수(65536)} · 24k 상한 ${읽을줄수(23999)}`);

  // 걸음 수: code 모드 65k 는 96걸음, 24k 로 깎였다면 35걸음에서 멈춘다. 45 걸음을 도는지 본다.
  받은.length = 0;
  대본.길이 = 45;
  대본.인자 = (n) => ({ file_path: 'big.txt', offset: n * 7 + 1, limit: 5 });
  const 긴 = new Session(c, { root: 일하는곳, work: 'code', think: 'off' });
  await 턴(긴, 문맥(c), '이 파일을 훑어줘');
  const 진짜요청 = 받은.filter((x) => !x.미리).length;
  check('★ 걸음 수 상한이 실제 창 기준이다 (65k 코드 모드는 45걸음을 돈다)',
    걸음수('code', 65536) > 45 && 걸음수('code', 23999) < 45 && 진짜요청 >= 46, `요청 ${진짜요청}회 · 65k ${걸음수('code', 65536)} · 24k ${걸음수('code', 23999)}`);
  대본.길이 = 0;
}

// ══ 7. 스킬 목록: 로컬 12개·80자, 내장 몫·사용자 값 존중, 세 자리 값이 같다 ═════════════
{
  const 긴설명 = (이름_) => `${이름_} 설명 `.repeat(60);
  const 만들기 = (프로젝트, 사용자, 내장, 플러그인) => [
    ...Array.from({ length: 프로젝트 }, (_, i) => ({ name: `p${i}`, description: 긴설명(`p${i}`), source: 'project', enabled: true })),
    ...Array.from({ length: 사용자 }, (_, i) => ({ name: `u${i}`, description: 긴설명(`u${i}`), source: 'user', enabled: true })),
    ...Array.from({ length: 내장 }, (_, i) => ({ name: `b${i}`, description: 긴설명(`b${i}`), source: 'builtin', enabled: true })),
    ...Array.from({ length: 플러그인 }, (_, i) => ({ name: `g${i}`, description: 긴설명(`g${i}`), source: 'plugin', enabled: true })),
  ];
  const 스킬줄들 = (s) => s.systemPrompt().split('\n').filter((l) => /^- [pubg]\d+: /.test(l));
  const 설명길이_ = (l) => l.replace(/^- [pubg]\d+: /, '').length;

  const 로 = 세션(로컬(65536)); 로.skills = 만들기(6, 6, 7, 30);
  const 바 = 세션(바깥(65536)); 바.skills = 만들기(6, 6, 7, 30);
  check('★ 로컬 상한: 12개', 로.listedSkills().length === 12 && 로.스킬한도().개수 === 12, `${로.listedSkills().length}`);
  check('★ 로컬 설명: 80자', 스킬줄들(로).length === 12 && 스킬줄들(로).every((l) => 설명길이_(l) <= 80) && 스킬줄들(로).some((l) => 설명길이_(l) === 80));
  check('★ 내장 몫(상한의 1/4 = 3)은 로컬에서도 지킨다', 로.listedSkills().filter((s) => s.source === 'builtin').length === 3,
    로.listedSkills().map((s) => s.name).join(','));
  check('자리표 차례(프로젝트 > 사용자 > 내장 > 플러그인)는 그대로', 로.listedSkills().map((s) => s.name).join(',') === 'p0,p1,p2,p3,p4,p5,u0,u1,u2,b0,b1,b2',
    로.listedSkills().map((s) => s.name).join(','));
  check('★ 바깥은 여태처럼 40개 · 140자', 바.listedSkills().length === 40 && 바.스킬한도().개수 === 40 && 바.스킬한도().글자 === 140
    && 스킬줄들(바).length === 40 && 스킬줄들(바).every((l) => 설명길이_(l) <= 140) && 스킬줄들(바).some((l) => 설명길이_(l) === 140));
  check('바깥 내장 몫은 상한 40 의 1/4 = 10 → 내장 7개가 다 든다', 바.listedSkills().filter((s) => s.source === 'builtin').length === 7);

  // 세 자리 — listedSkills · 시스템조각 · #원추정(= /context 의 스킬 칸) — 가 같은 값을 본다
  for (const [이름_, s] of [['로컬', 로], ['바깥', 바]]) {
    const 글자 = s.스킬한도().글자;
    const 기대 = s.listedSkills().map((k) => `${k.name}: ${String(k.description).slice(0, 글자)}`);
    const 실림 = 스킬줄들(s).map((l) => l.slice(2));
    check(`★ ${이름_}: 시스템 글의 스킬 줄 = listedSkills × 스킬한도().글자`, JSON.stringify(실림) === JSON.stringify(기대));
    const 칸 = s.breakdown().rows.find((r) => r.label === 옮긴말('ctx.skills', { 실림: s.listedSkills().length, 전체: s.skills.length }));
    check(`★ ${이름_}: /context 의 스킬 칸 = 실제로 나가는 스킬 줄의 토큰`, 칸?.n === estimateTokens(기대.join('\n')), `${칸?.n} vs ${estimateTokens(기대.join('\n'))}`);
  }

  // 사용자가 더 작게 정한 값은 존중한다. 큰 값은 로컬에서 12/80 이 이긴다.
  const 작게 = 세션(로컬(65536)); 작게.skills = 만들기(6, 6, 7, 30); 작게.maxSkillsListed = 5; 작게.maxSkillDesc = 50;
  check('★ 사용자가 정한 더 작은 값(5개·50자)은 로컬에서도 그대로', 작게.listedSkills().length === 5 && 스킬줄들(작게).every((l) => 설명길이_(l) <= 50)
    && 스킬줄들(작게).some((l) => 설명길이_(l) === 50));
  check('  그 상한 5 의 내장 몫은 floor(5/4) = 1', 작게.listedSkills().filter((s) => s.source === 'builtin').length === 1);
  const 크게 = 세션(로컬(65536)); 크게.skills = 만들기(6, 6, 7, 30); 크게.maxSkillsListed = 200; 크게.maxSkillDesc = 500;
  check('로컬은 더 큰 값을 줘도 12개 · 80자', 크게.listedSkills().length === 12 && 스킬줄들(크게).every((l) => 설명길이_(l) <= 80));
  const 문자열 = 세션(로컬(65536)); 문자열.skills = 만들기(6, 6, 7, 30); 문자열.maxSkillsListed = '10';
  check('설정 파일에서 온 글자열 상한("10")도 숫자로 읽는다', 문자열.listedSkills().length === 10);
  const 무한 = 세션(로컬(65536)); 무한.skills = 만들기(6, 6, 7, 30); 무한.maxSkillsListed = Infinity;
  check('상한 없음(Infinity)도 로컬에서는 12', 무한.listedSkills().length === 12);
  const 영 = 세션(로컬(65536)); 영.skills = 만들기(6, 6, 7, 30); 영.maxSkillsListed = 0;
  check('상한 0 은 0개', 영.listedSkills().length === 0);
  const 바깥작게 = 세션(바깥(65536)); 바깥작게.skills = 만들기(6, 6, 7, 30); 바깥작게.maxSkillsListed = 5; 바깥작게.maxSkillDesc = 50;
  check('바깥도 사용자가 정한 값 그대로', 바깥작게.listedSkills().length === 5 && 바깥작게.스킬한도().글자 === 50);

  // 갈아타면 스킬 목록도 따라간다 (conn 을 읽는 메서드라 낡은 값이 안 남는다)
  const 갈 = 세션(로컬(65536)); 갈.skills = 만들기(6, 6, 7, 30);
  const 로컬일때 = 갈.listedSkills().length;
  갈.conn = 바깥(65536);
  const 바깥일때 = 갈.listedSkills().length;
  갈.conn = 로컬(65536);
  check('★ /model 로 로컬 → 바깥 → 로컬: 스킬 12 → 40 → 12', 로컬일때 === 12 && 바깥일때 === 40 && 갈.listedSkills().length === 12, `${로컬일때} ${바깥일때} ${갈.listedSkills().length}`);
}

// ══ 8. 로컬 ↔ 바깥을 갈아타도 도구 토큰 캐시가 낡지 않는다 ═══════════════════════════
{
  const s = 세션(로컬(65536));
  const 처음 = 행(s, 'ctx.tools').n;
  const 로실제 = 앞머리재기(s).도구토큰;
  s.conn = 바깥(65536);                         // 같은 창 숫자, 다른 판
  const 바깥일때 = 행(s, 'ctx.tools').n;
  const 바실제 = 앞머리재기(s).도구토큰;
  s.conn = 로컬(65536);
  const 돌아와 = 행(s, 'ctx.tools').n;
  check('★ 로컬 → 바깥: 도구 토큰이 바깥 값으로 바뀐다 (낡은 로컬 값이 안 남는다)', 처음 === 로실제 && 바깥일때 === 바실제 && 바깥일때 > 처음, `${처음} → ${바깥일때}`);
  check('★ 바깥 → 로컬: 다시 로컬 값으로 돌아온다', 돌아와 === 처음, `${돌아와} vs ${처음}`);
  // 창 숫자가 낮은 쪽에서도: 바깥 8k(90자 판) ↔ 로컬 8k 는 같은 판이지만 핵심 문장 보강(L)이 있어 칸을 따로 쓴다
  const t = 세션(바깥(8192));
  const 바8 = 행(t, 'ctx.tools').n;
  t.conn = 로컬(8192);
  const 로8 = 행(t, 'ctx.tools').n;
  check('★ 8k 에서 바깥 ↔ 로컬: 각자 실제로 나가는 스키마의 토큰과 같다', 바8 === 앞머리재기(세션(바깥(8192))).도구토큰 && 로8 === 앞머리재기(세션(로컬(8192))).도구토큰, `${바8} ${로8}`);
  // 로컬 안에서 창만 바뀌면(/ctx) 모양이 같으니 값도 같다 — 불필요한 재계산·흔들림이 없다
  const u = 세션(로컬(65536));
  const 가 = 행(u, 'ctx.tools').n;
  u.conn = 로컬(200000);
  check('로컬 안에서 창만 65k → 200k: 같은 판이라 도구 토큰이 같다', 행(u, 'ctx.tools').n === 가);
  u.conn = 로컬(8192);
  check('로컬 65k → 8k: 더 좁은 판이라 줄어든다', 행(u, 'ctx.tools').n < 가);
}

// ── 결과 ───────────────────────────────────────────────────────────
언어정하기(원래말);
const W = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, ch) => a + (ch.codePointAt(0) > 0x1100 ? 2 : 1), 0)));
console.log('');
console.log('  로컬은 앞머리를 짧은 판으로 (프롬프트창)');
console.log('  ' + '─'.repeat(64));
for (const p of pass) console.log(`  \x1b[32m✓\x1b[0m ${W(p.name, 36)} \x1b[90m${p.note}\x1b[0m`);
for (const f of fail) console.log(`  \x1b[31m✗\x1b[0m ${W(f.name, 36)} \x1b[31m${f.note}\x1b[0m`);
console.log('  ' + '─'.repeat(64));
console.log(`  통과 ${pass.length} · 실패 ${fail.length}`);
console.log('');

// 서버를 띄운 뒤에는 process.exit() 를 쓰지 않는다 (loop.test.js 끝 머리말 — 윈도우 libuv).
server.closeAllConnections?.();
server.close();
await new Promise((r) => setImmediate(r));
rmSync(root, { recursive: true, force: true });
rmSync(일하는곳, { recursive: true, force: true });
process.exitCode = fail.length ? 1 : 0;
