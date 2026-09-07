/**
 * 앞머리는 자라기만 해야 한다 — 턴이 넘어가도.
 *
 * ── cache.test.js 와 무엇이 다른가 ──────────────────────────────────────
 *
 * 저쪽은 **시스템 프롬프트 한 장**이 흔들리지 않는지를 잰다. 여기서 재는 것은
 * 한 겹 위다 — 게이트웨이로 나가는 **요청 몸통 전체**가, 턴이 넘어갈 때
 * 「앞은 그대로 두고 뒤에만 붙는」 모양인가.
 *
 * 프리픽스 캐시(로컬 모델)도, 표식 캐시(Claude 계열)도, 이 한 가지 성질 위에
 * 서 있다. 두 번째 요청의 앞부분이 첫 요청과 **바이트로 같아야** 재쓴다.
 * 한 글자만 달라도 그 지점부터 끝까지 전부 다시 계산한다.
 *
 * ── 왜 회귀 검사가 필요한가 ─────────────────────────────────────────────
 *
 * 이 성질은 깨져도 **아무 데도 안 찍힌다.** 오류가 아니고, 답도 멀쩡히 온다.
 * 달라지는 것은 값과 시간뿐이다 — 로컬에서는 매 턴 몇 초, 게이트웨이에서는
 * 매 턴 몇 천 토큰. 사람 눈에는 "원래 좀 느리다" 로 보인다.
 *
 * 그리고 깨뜨리는 방법이 아주 많다. 시스템 프롬프트에 시각 한 줄, 도구 목록
 * 차례가 판마다 다른 것, 지난 메시지를 다시 손질해 보내는 것, 대화 이름이
 * 부를 때마다 달라지는 것 — 어느 것도 나쁜 코드처럼 안 생겼다. 그래서
 * 사람 눈이 아니라 검사가 지켜야 한다.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/agent/session.js';
import { buildBody } from '../src/backend/adapter.js';
import { toolSchemas } from '../src/tools/index.js';
import { 세션이름짓기 } from '../src/backend/wire.js';
import { 언어정하기 } from '../src/i18n/index.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

언어정하기('ko');
const root = mkdtempSync(join(tmpdir(), 'deel-prefix-'));
writeFileSync(join(root, 'DEEL.md'), '- 사용자 규칙 한 줄\n', 'utf8');

const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', model: '검사용', ctx: 32768 };
const 몸 = (s, 옵션 = {}) => buildBody('openai', {
  model: conn.model,
  messages: [{ role: 'system', content: s.systemPrompt() }, ...s.messages],
  tools: 옵션.tools ?? null,
  maxTokens: 4096,
  ...옵션,
});

/** 두 배열의 공통 앞부분 길이 (요소를 JSON 으로 견준다). */
const 공통앞 = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && JSON.stringify(a[i]) === JSON.stringify(b[i])) i++;
  return i;
};

// ══ 1. 턴이 넘어가도 앞은 그대로다 ═════════════════════════════════════
trace('1-턴넘김');
{
  const s = new Session(conn, { root, work: 'code' });

  s.push({ role: 'user', content: '첫 턴입니다' });
  const b1 = 몸(s);

  s.push({ role: 'assistant', content: '네, 했습니다' });
  s.push({ role: 'user', content: '둘째 턴입니다' });
  const b2 = 몸(s);

  s.push({ role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"a.js"}' } }] });
  s.push({ role: 'tool', tool_call_id: 't1', content: '파일 내용' });
  const b3 = 몸(s);

  /*
   * 이 셋이 이 파일의 전부다.
   *
   * 두 번째·세 번째 요청의 앞부분이 첫 요청과 **통째로 같아야** 한다. 하나라도
   * 어긋나면 그 자리부터 끝까지 캐시가 안 먹는다.
   */
  check('★★ 둘째 요청은 첫 요청을 그대로 담고 뒤에만 붙는다',
    공통앞(b1.messages, b2.messages) === b1.messages.length,
    `${공통앞(b1.messages, b2.messages)} / ${b1.messages.length}`);
  check('★★ 도구를 돈 뒤에도 앞은 안 흔들린다',
    공통앞(b2.messages, b3.messages) === b2.messages.length,
    `${공통앞(b2.messages, b3.messages)} / ${b2.messages.length}`);
  check('★★ 시스템 메시지는 턴이 넘어가도 한 글자도 안 다르다',
    b1.messages[0].content === b3.messages[0].content, '');
  // 자라기는 해야 한다. 안 자라면 위 검사는 아무것도 안 재는 것이다.
  check('그러면서 실제로 자란다', b3.messages.length > b1.messages.length,
    `${b1.messages.length} → ${b3.messages.length}`);
}

// ══ 2. 시각·난수가 안 섞인다 ═══════════════════════════════════════════
trace('2-시각난수');
{
  /*
   * 요청 몸에 시각이 한 줄 들어가면 캐시는 **영영** 안 맞는다. 그리고 그건
   * 「지금 시각을 알려 주면 모델이 더 잘 답한다」 는 아주 그럴듯한 이유로
   * 들어온다. 두 번 지어서 견주는 것이 이 문을 잠그는 유일한 방법이다.
   */
  const s = new Session(conn, { root, work: 'code' });
  s.push({ role: 'user', content: '같은 상태' });
  const a = JSON.stringify(몸(s));
  await new Promise((r) => setTimeout(r, 30));
  const b = JSON.stringify(몸(s));
  check('★★ 같은 상태로 두 번 지으면 바이트로 같다', a === b,
    a === b ? '' : `${a.length} vs ${b.length}`);

  // 새로 만든 세션도 같아야 한다 — 세션마다 다른 값(난수 id 같은 것)이 몸에
  // 실리면, 대화를 이어받은 다음 첫 턴에서 캐시가 통째로 날아간다.
  const s2 = new Session(conn, { root, work: 'code' });
  s2.push({ role: 'user', content: '같은 상태' });
  check('★★ 새 세션으로 지어도 같다', JSON.stringify(몸(s2)) === a, '');
}

// ══ 3. 도구 목록도 앞머리다 ════════════════════════════════════════════
trace('3-도구목록');
{
  /*
   * 도구 설명은 시스템 프롬프트만큼 길고, 규격상 **시스템보다도 앞**에 놓이는
   * 창구가 있다. 그 차례가 판마다 흔들리면 시스템 프롬프트를 아무리 굳혀도
   * 소용이 없다.
   *
   * 차례가 흔들리는 것은 상상이 아니다 — 목록을 Set 이나 객체 열쇠로 만들면
   * 어느 날 하나를 더하는 순간 순서가 통째로 바뀐다.
   */
  const 한번 = JSON.stringify(toolSchemas(null, { work: 'code' }));
  const 두번 = JSON.stringify(toolSchemas(null, { work: 'code' }));
  check('★★ 같은 조건이면 도구 목록이 바이트로 같다', 한번 === 두번, '');

  const s = new Session(conn, { root, work: 'code' });
  s.push({ role: 'user', content: '첫 턴' });
  const tools = toolSchemas(null, { work: 'code' });
  const b1 = 몸(s, { tools });
  s.push({ role: 'assistant', content: '했습니다' });
  s.push({ role: 'user', content: '둘째 턴' });
  const b2 = 몸(s, { tools: toolSchemas(null, { work: 'code' }) });
  check('★★ 턴이 넘어가도 도구 목록이 그대로다',
    JSON.stringify(b1.tools) === JSON.stringify(b2.tools), '');
}

// ══ 4. 대화 이름은 대화마다 하나다 ═════════════════════════════════════
trace('4-대화이름');
{
  /*
   * 이 값은 게이트웨이가 캐시를 가르는 열쇠로 쓴다(`prompt_cache_key` ·
   * `user`). 부를 때마다 달라지면 서버 쪽 캐시는 매번 새 칸에 들어간다 —
   * 우리 앞머리가 아무리 굳어 있어도 소용이 없다.
   */
  const a = 세션이름짓기('abc123');
  const b = 세션이름짓기('abc123');
  check('★★ 같은 대화면 같은 이름', a === b && !!a, `${a} / ${b}`);
  check('★ 다른 대화면 다른 이름', 세션이름짓기('xyz789') !== a, '');

  const s = new Session(conn, { root, work: 'code' });
  s.push({ role: 'user', content: '첫 턴' });
  const 카드 = { 캐시: 'key', 세션자리: 'user' };
  const b1 = 몸(s, { 카드, 세션이름: a });
  s.push({ role: 'assistant', content: '했습니다' });
  s.push({ role: 'user', content: '둘째 턴' });
  const b2 = 몸(s, { 카드, 세션이름: a });
  check('★ 턴이 넘어가도 몸에 실리는 이름이 같다',
    b1.prompt_cache_key === b2.prompt_cache_key && b1.user === b2.user,
    `${b1.prompt_cache_key ?? b1.user} / ${b2.prompt_cache_key ?? b2.user}`);
}

// ══ 5. 모드를 갈아타도 굳은 앞은 그대로 ════════════════════════════════
trace('5-모드전환');
{
  /*
   * 말을 던질 때마다 모드가 저절로 옮겨 간다(agent/route.js). 그때 시스템
   * 프롬프트가 바뀌는 것은 맞는데, **바뀌는 자리가 끝쪽이어야** 앞머리가
   * 산다. cache.test.js 가 글 한 장에서 그것을 재고, 여기서는 요청 몸에서
   * 같은 것이 지켜지는지를 본다 — 사이에 낀 층이 그걸 무너뜨릴 수 있다.
   */
  const s = new Session(conn, { root, work: 'code' });
  s.push({ role: 'user', content: '첫 턴' });
  const 앞 = 몸(s).messages[0].content;
  s.work = 'debug';
  const 뒤 = 몸(s).messages[0].content;

  const 표식 = '--- 지금 모드';
  const i = 앞.indexOf(표식);
  check('모드 표식이 있다', i > 0, String(i));
  check('★★ 모드를 갈아타도 표식 앞은 바이트로 같다',
    i > 0 && 앞.slice(0, i) === 뒤.slice(0, i), '');
  // 굳은 앞이 전체의 절반은 넘어야 이 성질이 값어치가 있다.
  check('★ 굳은 앞이 절반은 넘는다', i / 앞.length > 0.5, `${((i / 앞.length) * 100).toFixed(1)}%`);
}

// ══ 6. 지난 메시지를 다시 손질하지 않는다 ══════════════════════════════
trace('6-지난것-그대로');
{
  /*
   * 여기가 제일 놓치기 쉬운 자리다.
   *
   * 「보낼 때 한 번 더 훑어서 비밀을 가리자」 같은 손질을 **보내는 자리**에
   * 넣으면, 그 손질이 지난 메시지까지 매번 다시 만든다. 결과가 같으면
   * 괜찮아 보이는데, 한 글자라도 달라지는 날 앞머리가 통째로 무효가 된다.
   *
   * 그래서 이미 쌓인 메시지 객체가 **그대로** 실려 나가는지를 본다.
   */
  const s = new Session(conn, { root, work: 'code' });
  s.push({ role: 'user', content: '비밀 같은 것: sk-1234567890abcdef' });
  const b1 = 몸(s);
  s.push({ role: 'assistant', content: '네' });
  s.push({ role: 'user', content: '둘째' });
  const b2 = 몸(s);
  check('★★ 지난 메시지는 손대지 않고 그대로 실린다',
    JSON.stringify(b1.messages[1]) === JSON.stringify(b2.messages[1]),
    `${JSON.stringify(b1.messages[1]).slice(0, 50)} vs ${JSON.stringify(b2.messages[1]).slice(0, 50)}`);
}

// ══ 7. 표식은 옮겨 다녀도 글은 안 건드린다 ═════════════════════════════
trace('7-표식-옮김');
{
  /*
   * 표식 캐시(Claude 계열)는 마지막 자리에 닻을 박고, 다음 턴에는 그 닻을
   * 더 뒤로 옮긴다. 그러니 **표식 칸만은** 턴마다 달라지는 것이 맞다.
   *
   * 표식을 붙이면 `content` 가 글 하나에서 조각 배열로 바뀌고, 닻이 떠나면
   * 다시 글 하나로 돌아온다. 겉모양은 턴마다 달라 보이지만 이 둘은 규격이
   * 같은 것이라고 못박아 둔 짝이라(글 하나는 조각 하나짜리의 줄임말이다),
   * 토큰으로 풀면 한 글자도 안 다르다 — 캐시는 그 토큰을 본다.
   *
   * 정작 지켜야 할 것은 그 아래다. 옮기는 김에 **글까지 다시 쓰면** 안 된다.
   * 손이 한 번 더 가는 자리라 실제로 여기서 `[object Object]` 가 나온 적이
   * 있다(adapter.js 주석). 그래서 겉옷을 벗겨 글만 꺼내 견준다.
   */
  const 카드 = { 캐시: 'explicit', 표식칸: 'cache_control', 캐시최소: 0 };
  /** 표식과 조각 겉옷을 벗기고 실제로 나가는 글만 남긴다. */
  const 알맹이 = (m) => {
    const c = m?.content;
    const 글 = Array.isArray(c) ? c.map((조각) => 조각?.text ?? '').join('') : (c ?? '');
    return JSON.stringify({ role: m?.role, 글, id: m?.tool_call_id ?? null, 부름: m?.tool_calls ?? null });
  };

  const s = new Session(conn, { root, work: 'code' });
  s.push({ role: 'user', content: '첫 턴입니다' });
  const b1 = 몸(s, { 카드 });
  s.push({ role: 'assistant', content: '했습니다' });
  s.push({ role: 'user', content: '둘째 턴입니다' });
  const b2 = 몸(s, { 카드 });

  // 표식이 정말 붙긴 했나 — 안 붙었으면 아래 검사는 아무것도 안 재는 것이다.
  check('표식이 붙는다', JSON.stringify(b1).includes('cache_control'), '');

  let 같나 = true;
  for (let i = 0; i < b1.messages.length; i++) {
    if (알맹이(b1.messages[i]) !== 알맹이(b2.messages[i])) { 같나 = false; break; }
  }
  check('★★ 표식을 벗기면 지난 자리는 글자까지 같다', 같나, '');
  check('★ 글이 [object Object] 로 뭉개지지 않는다',
    !JSON.stringify(b2).includes('[object Object]'), '');
}

rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n앞머리는 자라기만 한다  ${D}(턴이 넘어가도 앞은 바이트로 같아야 한다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
