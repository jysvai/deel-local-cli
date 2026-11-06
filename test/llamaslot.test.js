/**
 * 슬롯 하나짜리 하이브리드 llama-server 에서 deel 이 앞머리를 지키는가.
 *
 * 2.2.0 을 맥(M5 Pro 24GB · Qwen3.8-Flash-Next · llama.cpp b12121 · -np 1)에 붙였더니 「엄청 오래
 * 걸리거나 안 된다」 고 왔다. 여태 가짜 서버는 무엇을 보내도 곧바로 답했다 — **다시 읽는 값**이 없으니
 * 앞머리를 깨도 아무 검사도 안 빨개졌다. 그래서 아래 가짜 서버는 그 값을 친다. 규칙은 짐작이 아니라
 * llama.cpp 의 tools/server/server-context.cpp 와 그 모델의 채팅 템플릿에서 옮겼다.
 *
 *   · 템플릿이 강도 문구를 시킴말 **맨 앞**에 넣는다 — medium 은 문구가 없고 low · high(xhigh) 는 있다.
 *     그 다음이 도구 목록이고, 시킴말은 그 뒤다. 그래서 강도가 바뀌면 첫 글자부터 갈린다.
 *   · 슬롯이 하나다. 요청은 차례로 처리하고, 끊긴 요청은 다음 묶음 전에 멎는다. 읽은 데까지는 남는다.
 *   · 재귀 상태(DeltaNet)는 되감지 못한다. 캐시가 새 프롬프트의 **온전한 앞머리**면 그대로 잇고, 아니면
 *     갈린 자리 앞의 체크포인트로 돌아간다. 체크포인트가 없으면 처음부터 다시 읽는다.
 *   · 체크포인트는 첫 묶음 뒤 · 마지막 사람 말의 시작 · 끝에서 4+ub 앞 · 끝에서 4 앞에 찍고, 여덟 개까지 둔다.
 *   · 머리말은 슬롯을 잡아야 나가고, 읽는 동안에는 핑(`:\n\n`)만 흐른다.
 *
 * 토큰은 글자 하나로 친다. 재는 것은 초가 아니라 **다시 읽은 글자 수**다.
 */
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { Session } from '../src/agent/session.js';
import { run } from '../src/agent/loop.js';
import { route } from '../src/agent/route.js';
import { allowEndpoint } from '../src/safety/network.js';
import { 미리읽기, 기다림상한 } from '../src/agent/warm.js';
import { 로컬넉넉, 로컬기다림 } from '../src/backend/http.js';

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
let 통과 = 0; let 실패 = 0;
const check = (이름, 됨, 덧 = '') => {
  if (됨) { 통과 += 1; console.log(`  ${G}✓${X} ${이름}${덧 ? ` ${D}${덧}${X}` : ''}`); return; }
  실패 += 1; console.log(`  ${R}✗${X} ${이름}${덧 ? ` ${R}${덧}${X}` : ''}`);
};
const 쉼 = (ms) => new Promise((r) => setTimeout(r, ms));
const 될때까지 = async (조건, ms = 5000) => {
  const 끝 = Date.now() + ms;
  while (Date.now() < 끝) { if (조건()) return true; await 쉼(5); }
  return 조건();
};

// -ub 1024 를 글자로 친 값 (이 프롬프트는 토큰 하나가 3.5글자 안팎이다).
const UB = 3600;

/** 템플릿이 하는 일 — 강도 문구 · 도구 · 시킴말 · 대화 · 답 머리 차례. */
function 펼치기(몸) {
  const 강도 = 몸.reasoning_effort;
  const 첫줄 = 강도 === 'low' ? 'Reasoning effort is set to low.\n\n'
    : (강도 === 'high' || 강도 === 'xhigh') ? 'Reasoning effort is set to xhigh.\n\n' : '';
  const [머리, ...나머지] = 몸.messages;
  let 글 = `<|im_start|>system\n${첫줄}# Tools\n${JSON.stringify(몸.tools ?? [])}\n\n${머리.content}<|im_end|>\n`;
  let 마지막사람 = -1;
  for (const m of 나머지) {
    if (m.role === 'user') 마지막사람 = 글.length;
    글 += `<|im_start|>${m.role}\n${m.content ?? ''}${m.tool_calls ? JSON.stringify(m.tool_calls) : ''}<|im_end|>\n`;
  }
  return { 글: `${글}<|im_start|>assistant\n<think>\n`, 마지막사람 };
}

const 공통 = (a, b) => { let i = 0; const n = Math.min(a.length, b.length); while (i < n && a[i] === b[i]) i++; return i; };

function 가짜서버({ 묶음ms = 1, 도구걸음 = 0 } = {}) {
  const 판 = {
    캐시: '', 점: [], 줄: [], 기록: [], 묶음ms, 도구걸음, 남은도구: 0, 거절: null,
    비우기() { this.캐시 = ''; this.점 = []; this.기록 = []; this.남은도구 = this.도구걸음; },
  };
  const 찍기 = (n) => {
    if (판.점.includes(n)) return;
    판.점.push(n);
    판.점.sort((a, b) => a - b);
    while (판.점.length > 8) 판.점.shift();
  };

  const 처리 = async (몸, q, a) => {
    const { 글, 마지막사람 } = 펼치기(몸);
    let n = 공통(판.캐시, 글);
    if (n < 판.캐시.length || n === 글.length) {
      // 되감지 못한다 — 갈린 자리 앞의 체크포인트로 돌아간다.
      const 쓸것 = 판.점.filter((p) => p <= n && p < 글.length).pop();
      n = 쓸것 ?? 0;
      판.점 = 판.점.filter((p) => p <= n);
      판.캐시 = 글.slice(0, n);
    }
    const 시작 = n;
    const 줄 = { 강도: 몸.reasoning_effort ?? null, 전체: 글.length, 재씀: 시작, 읽음: 0, 미리: 몸.max_tokens === 1, 끊김: false, 초안: 몸.messages.at(-1)?.content, 글 };
    판.기록.push(줄);

    if (몸.stream) a.writeHead(200, { 'content-type': 'text/event-stream' });
    // q.destroyed 는 못 쓴다 — 몸을 다 읽으면 저절로 참이 된다. 응답이 안 끝났는데 닫힌 것이 끊긴 것이다.
    let 끊김 = a.destroyed;
    a.on('close', () => { if (!a.writableFinished) 끊김 = true; });
    const 끊겼나 = () => 끊김;

    while (판.캐시.length < 글.length) {
      if (끊겼나()) { 줄.끊김 = true; return; }
      let 끝 = Math.min(글.length, 판.캐시.length + UB);
      // 체크포인트 자리에서 묶음을 끊는다.
      for (const 자리 of [마지막사람, 글.length - 4 - UB, 글.length - 4]) {
        if (자리 > 판.캐시.length && 자리 < 끝) 끝 = 자리;
      }
      if (판.캐시.length > 0 && (판.점.length === 0 || [마지막사람, 글.length - 4 - UB, 글.length - 4].includes(판.캐시.length))) 찍기(판.캐시.length);
      판.캐시 += 글.slice(판.캐시.length, 끝);
      if (몸.stream && !a.destroyed) a.write(':\n\n');
      await 쉼(판.묶음ms);
    }
    줄.읽음 = 글.length - 시작;
    const usage = { prompt_tokens: 글.length, completion_tokens: 1, total_tokens: 글.length + 1, prompt_tokens_details: { cached_tokens: 시작 } };
    if (몸.max_tokens === 1) {
      a.writeHead(200, { 'content-type': 'application/json' });
      a.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: '.' }, finish_reason: 'length' }], usage }));
      return;
    }
    const 부름 = 판.남은도구 > 0
      ? [{ index: 0, id: `c${판.남은도구}`, type: 'function', function: { name: 'Read', arguments: JSON.stringify({ file_path: 'a.txt' }) } }]
      : null;
    if (부름) 판.남은도구 -= 1;
    // 만든 것이 캐시에 붙는다 — 생각 글이 들어 있어서 다음 프롬프트와는 여기서 갈린다.
    판.캐시 += `생각한 글 ${판.기록.length}<|im_end|>\n`;
    const 조각 = 부름 ? { tool_calls: 부름 } : { content: '끝났습니다' };
    a.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: 조각 }] })}\n\n`);
    a.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 부름 ? 'tool_calls' : 'stop' }], usage })}\n\n`);
    a.end('data: [DONE]\n\n');
  };

  // 슬롯이 하나다 — 한 번에 하나만 처리한다.
  let 꼬리 = Promise.resolve();
  const 서버 = createServer((q, a) => {
    let b = '';
    q.on('data', (d) => { b += d; });
    q.on('end', () => {
      const 몸 = JSON.parse(b || '{}');
      if (판.거절) { a.writeHead(판.거절, { 'content-type': 'application/json' }); a.end('{"error":{"message":"거절"}}'); return; }
      꼬리 = 꼬리.then(() => (a.destroyed ? null : 처리(몸, q, a))).catch(() => {});
    });
  });
  return new Promise((ok) => 서버.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${서버.address().port}/v1`;
    allowEndpoint(base);
    ok({ 판, base, 닫기: () => new Promise((r) => { 서버.closeAllConnections?.(); 서버.close(r); }) });
  }));
}

const root = mkdtempSync(join(tmpdir(), 'deel-llamaslot-'));
writeFileSync(join(root, 'a.txt'), 'hello\n');
const 문맥 = () => ({ scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() });
const 연결 = (base) => ({ kind: 'openai', base, auth: 'none', model: 'qwen3.8-flash-next', ctx: 65536, streaming: true, tools: true, think: true });
const 턴 = async (s, ctx, 글, 옵션 = {}) => {
  s.routed = s.work === 'auto' ? (route(글).mode ?? null) : null;
  for await (const _ of run(s, ctx, 글, 옵션)) { /* 끝까지 */ }
};

console.log('\n걸음마다 앞머리를 다시 읽지 않는다');
{
  const { 판, base, 닫기 } = await 가짜서버({ 도구걸음: 2 });
  판.비우기();
  const s = new Session(연결(base), { root, work: 'auto' });
  const ctx = 문맥();
  await 턴(s, ctx, 'a.txt 읽고 고쳐줘');
  const 걸음 = 판.기록;
  check('도구를 두 번 부르는 턴은 세 걸음이다', 걸음.length === 3, `${걸음.length}번`);
  check('★★★ 걸음마다 강도가 같다 — 프롬프트 첫 줄이 안 바뀐다',
    new Set(걸음.map((x) => x.강도)).size === 1, JSON.stringify(걸음.map((x) => x.강도)));
  const 뒤걸음 = 걸음.slice(1);
  check('★★★ 뒤 걸음은 앞머리를 다시 안 읽는다 — 재쓴 몫이 프롬프트의 절반을 넘는다',
    뒤걸음.every((x) => x.재씀 > x.전체 / 2), JSON.stringify(뒤걸음.map((x) => `${x.읽음}/${x.전체}`)));
  check('★★★ 뒤 걸음이 다시 읽는 양은 새로 붙은 것 + 묶음 하나 안팎이다',
    뒤걸음.every((x, i) => x.읽음 <= (x.전체 - 걸음[i].전체) + UB + 64), JSON.stringify(뒤걸음.map((x) => x.읽음)));
  await 닫기();
}

console.log('\n턴이 바뀌어도 강도가 안 움직인다');
{
  const { 판, base, 닫기 } = await 가짜서버();
  판.비우기();
  const s = new Session(연결(base), { root, work: 'auto' });
  const ctx = 문맥();
  for (const 글 of ['안녕', 'a.txt 고쳐줘', '왜 안되는지 봐줘', '설명해줘']) await 턴(s, ctx, 글);
  check('★★★ 인사 · 고치기 · 디버그 · 설명이 같은 강도로 나간다 (첫 줄을 안 건드린다)',
    new Set(판.기록.map((x) => x.강도)).size === 1, JSON.stringify(판.기록.map((x) => x.강도)));
  const 앞 = 판.기록[1];
  check('★★ 인사 다음 턴이 처음부터 다시 읽지 않는다', 앞.재씀 > 앞.전체 / 2, `${앞.읽음}/${앞.전체}`);
  await 닫기();

  // 사람이 직접 정한 강도는 그대로 나간다. 안 움직인다는 것은 저절로 안 움직인다는 뜻이다.
  const 둘 = await 가짜서버();
  둘.판.비우기();
  const s2 = new Session(연결(둘.base), { root, work: 'auto' });
  s2.think = 'high'; s2.thinkSet = true;
  await 턴(s2, 문맥(), 'a.txt 고쳐줘');
  check('/think high 는 그대로 나간다', 둘.판.기록[0].강도 === 'high', String(둘.판.기록[0].강도));
  await 둘.닫기();
}

console.log('\n미리 읽기가 슬롯을 붙들지 않는다');
{
  const { 판, base, 닫기 } = await 가짜서버();
  판.비우기();
  const s = new Session(연결(base), { root, work: 'auto' });
  const ctx = 문맥();
  const 판미리 = new 미리읽기(s, ctx, { env: {}, 쉼: 5 });
  s.미리읽기 = 판미리;

  판미리.풀기();
  await 될때까지(() => !판미리.도는것 && 판.기록.length === 1);
  check('첫 입력칸에서 한 번 읽는다', 판.기록.length === 1 && 판.기록[0].미리, `${판.기록.length}번`);

  판미리.잠그기();
  await 턴(s, ctx, 'a.txt 고쳐줘');
  const 턴뒤 = 판.기록.length;
  판미리.풀기();
  await 쉼(60);
  check('★★★ 턴 뒤 입력칸에서는 안 보낸다 — 캐시가 이미 그 대화를 들고 있다',
    판.기록.length === 턴뒤, `${판.기록.length - 턴뒤}번 더`);

  판미리.잠그기();
  판미리.풀기();
  await 쉼(40);
  check('명령만 치고 돌아와도 안 보낸다', 판.기록.length === 턴뒤, `${판.기록.length - 턴뒤}번 더`);

  // 이어받기 · 스레드 바꾸기 — 길이가 그대로거나 늘어도 서버에 없는 대화다.
  판미리.잠그기();
  s.messages = [...s.messages];
  판미리.풀기();
  await 될때까지(() => !판미리.도는것 && 판.기록.length > 턴뒤);
  check('★★ 대화를 갈아 끼우면 길이가 같아도 다시 읽는다', 판.기록.length === 턴뒤 + 1, `${판.기록.length - 턴뒤}번 더`);

  const 갈아낀뒤 = 판.기록.length;
  판미리.잠그기();
  s.messages.length = 0;
  판미리.풀기();
  await 될때까지(() => !판미리.도는것 && 판.기록.length > 갈아낀뒤);
  check('대화를 비운 뒤에는 다시 읽는다 — 앞머리가 달라졌다', 판.기록.length === 갈아낀뒤 + 1, `${판.기록.length - 갈아낀뒤}번 더`);
  판미리.끄기();
  await 닫기();

  // 다시 읽어야 할 때도 지난 턴의 모드로 짓는다 — 모드를 비우면 시킴말 꼬리가 달라져 대화 전체가 거기서 갈린다.
  const 셋 = await 가짜서버();
  셋.판.비우기();
  const s3 = new Session(연결(셋.base), { root, work: 'auto' });
  s3.routed = route('a.txt 고쳐줘').mode;
  const 꼬리 = s3.wire()[0].content;
  const 판3 = new 미리읽기(s3, 문맥(), { env: {}, 쉼: 5 });
  판3.풀기();
  await 될때까지(() => !판3.도는것 && 셋.판.기록.length === 1);
  check('★★ 빈 말은 지난 턴의 모드로 짓는다', !!s3.routed && 셋.판.기록[0].글.includes(꼬리), String(s3.routed));
  check('짓고 나서 모드를 안 바꿔 둔다', s3.routed === route('a.txt 고쳐줘').mode);
  판3.끄기();
  await 셋.닫기();
}

console.log('\n치는 동안 — 느린 서버에서는 물러난다');
{
  const { 판, base, 닫기 } = await 가짜서버({ 묶음ms: 40 });
  판.비우기();
  const s = new Session(연결(base), { root, work: 'auto' });
  const 판미리 = new 미리읽기(s, 문맥(), { env: {}, 쉼: 5, 느림: 30 });
  판미리.풀기();
  await 될때까지(() => !판미리.도는것);
  const 처음 = 판.기록.length;
  판미리.쳤다('이 함수');
  await 될때까지(() => 판.기록.length > 처음 && !판미리.도는것);
  판미리.쳤다('고칠 곳을 코드 리뷰해줘');
  await 될때까지(() => 판.기록.length > 처음 + 1 && !판미리.도는것, 400);
  const 재고 = 판.기록.length;
  판미리.쳤다('고칠 곳을 코드 리뷰해줘 빨리');
  await 쉼(120);
  check('★★ 친 글을 읽히는 데 오래 걸린 서버에는 더 안 보낸다', 판.기록.length === 재고, `${판.기록.length - 재고}번 더`);
  check('왜 안 보내는지 상태가 말한다', 판미리.상태().느림 === true);
  판미리.끄기();
  await 닫기();
}

console.log('\nEnter — 오래 안 기다리고, 읽은 데까지는 쓴다');
{
  check('★★★ 기다림 상한은 몇 초다 — 30초를 얹지 않는다', 기다림상한 <= 5000, `${기다림상한}ms`);
  const { 판, base, 닫기 } = await 가짜서버({ 묶음ms: 30 });
  판.비우기();
  const s = new Session(연결(base), { root, work: 'auto' });
  const ctx = 문맥();
  const 판미리 = new 미리읽기(s, ctx, { env: {}, 쉼: 5, 기다림: 40 });
  s.미리읽기 = 판미리;
  판미리.풀기();
  await 될때까지(() => 판.캐시.length > 0);
  판미리.잠그기();
  const 처음 = Date.now();
  await 턴(s, ctx, 'a.txt 고쳐줘');
  const [미리, 진짜] = 판.기록;
  check('읽던 것을 끊었다', 미리.미리 && 미리.끊김 === true, JSON.stringify(미리).slice(0, 90));
  check('★★ 끊은 것이 읽은 데까지는 진짜 요청이 잇는다', 진짜.재씀 > 0, `${진짜.재씀}자 재씀`);
  check('진짜 요청이 끝까지 답했다', !진짜.끊김 && 진짜.읽음 > 0, `${Date.now() - 처음}ms`);
  판미리.끄기();
  await 닫기();
}

console.log('\n잠깐 막힌 것은 거절이 아니다');
{
  const { 판, base, 닫기 } = await 가짜서버();
  판.비우기();
  const s = new Session(연결(base), { root, work: 'auto' });
  const 판미리 = new 미리읽기(s, 문맥(), { env: {}, 쉼: 5 });
  판.거절 = 503;   // llama-server 는 모델을 올리는 동안 503 이다
  판미리.풀기();
  await 될때까지(() => !판미리.도는것);
  판미리.쳤다('이');
  await 쉼(30);
  await 될때까지(() => !판미리.도는것);
  판미리.쳤다('이 함수');
  await 쉼(30);
  await 될때까지(() => !판미리.도는것);
  check('★★ 모델을 올리는 동안의 503 으로는 안 꺼진다', 판미리.켬, 판미리.판정.왜);
  판.거절 = 400;
  판미리.쳤다('이 함수 고쳐');
  await 쉼(30);
  await 될때까지(() => !판미리.도는것);
  판미리.쳤다('이 함수 고쳐줘');
  await 쉼(30);
  await 될때까지(() => !판미리.도는것);
  check('400 을 잇달아 받으면 꺼진다', !판미리.켬 && 판미리.판정.왜 === '서버거절', 판미리.판정.왜);
  판미리.끄기();
  await 닫기();
}

console.log('\n로컬 서버는 끝까지 기다린다');
{
  const 로컬 = { base: 'http://127.0.0.1:8099/v1' };
  const 사내 = { base: 'http://192.168.0.7:8099/v1' };
  const 바깥 = { base: 'https://api.example.com/v1' };
  check('★★★ 로컬은 30분까지 기다린다 — 새 세션의 첫 요청이 몇 분씩 걸린다', 로컬넉넉(로컬, 60000) === 로컬기다림 && 로컬기다림 >= 1800000, String(로컬넉넉(로컬, 60000)));
  check('사내망 주소도 같다', 로컬넉넉(사내, 300000) === 로컬기다림);
  check('★★ 바깥은 그대로다 — 멎은 게이트웨이를 30분 기다리지 않는다', 로컬넉넉(바깥, 60000) === 60000);
  check('이미 더 긴 값은 줄이지 않는다', 로컬넉넉(로컬, 로컬기다림 * 2) === 로컬기다림 * 2);
  check('주소를 모르면 바깥으로 친다', 로컬넉넉({}, 60000) === 60000);

  // 시계마다 30분을 진짜로 재 볼 수는 없다 — 그 값을 쓰는 자리가 그대로 있는지 소스로 본다.
  const 소스 = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  const 어댑터 = 소스('backend/adapter.js');
  check('★★ 답을 기다리는 시계가 로컬을 안다 — 머리말', /const 머리상한 = opts\.timeout \?\? 로컬넉넉\(conn, 300000\)/.test(어댑터));
  check('★★★ 소식 없음 상한이 로컬을 안다 — 읽는 동안 서버는 핑만 보낸다', /const 무소식 = conn\.무소식 \?\? 로컬넉넉\(conn, 무소식기본\)/.test(어댑터));
  check('★★ 첫 내용 전 잠잠이 로컬을 안다', /conn\.첫잠잠 \?\? Math\.max\(흐를때잠잠, 로컬넉넉\(conn, 첫잠잠기본\)\)/.test(어댑터));
  check('★★★ deel setup 의 진단이 로컬을 안다 — 끊으면 멀쩡한 연결이 false 로 저장된다', /timeout: 로컬넉넉\(conn, opts\.timeout \?\? 60000\)/.test(소스('backend/probe.js')));
  check('접기 · 커밋 · 리뷰가 로컬을 안다', ['agent/compact.js', 'agent/commit.js', 'agent/review.js'].every((p) => /timeout: 로컬넉넉\(session\.conn, [0-9]+\)/.test(소스(p))));
}

rmSync(root, { recursive: true, force: true });
console.log(`\n  통과 ${통과} · 실패 ${실패}\n`);
process.exitCode = 실패 ? 1 : 0;
