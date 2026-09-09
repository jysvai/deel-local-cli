// 굳은 앞머리를 **한 시간** 살린다.
//
// ── 왜 이 검사가 생겼나 ─────────────────────────────────────────────────
//
// 나란히 재 봤을 때 여기서 졌다(docs/ko/benchmark.md). 같은 일을 시킨 비교에서
//
//   캐시 쓰기   1.5M  대  247.6K   — 여섯 배
//   캐시 적중   94.3% 대  99.3%
//   토큰        26.3M 대  36.9M    — 우리가 28.7% 적게 썼는데
//   비용        $29.91 대 $24.48   — 우리가 22% 더 냈다
//
// 토큰을 적게 쓰고 돈을 더 낸 것이 이 파일의 이유다. 캐시를 **자꾸 다시 써서**
// 그랬다.
//
// 까닭은 수명이었다. 표식에 「기본 수명(5분)을 쓴다 — 한 시간짜리는 쓰기 값이
// 두 배다」 라고 적혀 있었는데, 그 셈이 견줄 상대를 잘못 잡았다.
//
//   5분이 지나 캐시가 죽으면 상대는 「싼 쓰기」 가 아니라 **전액 재전송**이다.
//
//     5분   쓰기 1.25배 → 5분 넘으면 죽음 → 다음 턴에 또 1.25배 → 매 턴 1.25배
//     1시간 쓰기 2배    → 한 시간 삶     → 다음 턴부터 0.1배
//
//   두 턴만 넘어가도 1시간이 이긴다 (2 + 0.1 = 2.1  대  1.25 + 1.25 = 2.5).
//
// 그리고 코딩 에이전트는 5분을 넘기는 것이 예외가 아니라 일상이다. 검사 한 번이
// 6분이고 빌드가 3분이다. 그동안 모델은 안 불린다.
//
// ── 여기서 제일 조심할 것 ───────────────────────────────────────────────
//
// **아무 데나 한 시간을 붙이면 그냥 두 배를 내는 것이다.** 굴러가는 대화 꼬리는
// 다음 턴에 새 메시지가 붙는 순간 어차피 무효가 된다 — 거기에 두 배를 내면
// 고친 게 아니라 더 비싸진다. 그래서 2번(꼬리는 짧게)이 이 파일의 알맹이다.
import { 시스템블록, 메시지표식, 표식, 표식긴것 } from '../src/backend/cachemark.js';
import { buildBody } from '../src/backend/adapter.js';
import { 기본카드, 배울전선, 카드칸들 } from '../src/backend/wire.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 긴글 = '시킴말이 길게 이어집니다. '.repeat(400);
const 몸만들기 = (카드) => buildBody('anthropic', {
  model: 'claude-opus-5',
  messages: [{ role: 'system', content: 긴글 }, { role: 'user', content: '안녕' }],
  maxTokens: 100,
  카드,
});
const 기본 = { 캐시: 'explicit', 표식칸: 'cache_control', 캐시최소: 1, 긴수명: true };

// ── 1. 굳은 앞머리는 한 시간 ────────────────────────────────────────────
trace('1-앞머리');
{
  check('★★★ 한 시간짜리 표식이 규격대로다', 표식긴것.ttl === '1h' && 표식긴것.type === 'ephemeral',
    JSON.stringify(표식긴것));
  const b = 몸만들기(기본);
  check('★★★ 굳은 앞머리에 1시간이 붙는다', b.system?.[0]?.cache_control?.ttl === '1h',
    JSON.stringify(b.system?.[0]?.cache_control));
  check('★★ 그래도 ephemeral 이다 — 다른 종류를 지어내지 않는다',
    b.system?.[0]?.cache_control?.type === 'ephemeral', '');
}

// ── 2. 굴러가는 꼬리에는 안 붙인다 ──────────────────────────────────────
trace('2-꼬리');
{
  /*
   * 여기가 제일 중요하다. 꼬리는 다음 턴에 무효가 되므로 오래 살릴 값이 없다.
   * 붙이면 그냥 두 배를 버리는 것이다.
   */
  check('★★★ 짧은 표식에는 수명 칸이 없다 (기본 5분)', 표식.ttl === undefined, JSON.stringify(표식));
  const 것 = 메시지표식([
    { role: 'user', content: [{ type: 'text', text: '가' }] },
    { role: 'assistant', content: [{ type: 'text', text: '나' }] },
  ], 'cache_control');
  const 붙은것 = 것.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .map((b) => b.cache_control).filter(Boolean);
  check('★★★ 꼬리에도 표식은 붙는다', 붙은것.length >= 1, String(붙은것.length));
  check('★★★ 그런데 꼬리 표식에는 1시간을 안 붙인다',
    붙은것.every((c) => c.ttl === undefined), JSON.stringify(붙은것));
}

// ── 3. 안 받는 창구는 이 칸만 끈다 ──────────────────────────────────────
trace('3-끄기');
{
  /*
   * 순서가 중요하다. `ttl` 거절을 `cache_control` 거절보다 나중에 보면, 수명
   * 칸 하나를 모르는 창구에서 **캐시를 통째로 끈다** — 받을 수 있었던 것까지
   * 잃고, 조용히 비싸지는 쪽이라 화면에 아무 표시도 안 난다.
   */
  const 배운것 = 배울전선('Extra inputs are not permitted: cache_control.ttl', 'anthropic');
  check('★★★ ttl 을 튕기면 긴수명만 끈다', 배운것?.무엇 === '긴수명' && 배운것?.값 === false,
    JSON.stringify(배운것));
  check('★★★ 캐시 자체는 안 끈다 — 그게 이 순서의 이유다',
    배운것?.무엇 !== '캐시', JSON.stringify(배운것));

  // cache_control 자체를 튕기면 여태처럼 캐시를 끈다. 그건 안 바뀌었다.
  const 캐시거절 = 배울전선('Extra inputs are not permitted: cache_control', 'anthropic');
  check('★★ cache_control 을 튕기면 여태처럼 캐시를 끈다',
    캐시거절?.무엇 === '캐시' && 캐시거절?.값 === 'none', JSON.stringify(캐시거절));

  const b = 몸만들기({ ...기본, 긴수명: false });
  check('★★★ 끄면 5분짜리로 돌아간다 (캐시는 그대로 산다)',
    b.system?.[0]?.cache_control?.type === 'ephemeral' && b.system?.[0]?.cache_control?.ttl === undefined,
    JSON.stringify(b.system?.[0]?.cache_control));
}

// ── 4. OpenAI 규격에는 수명 칸이 없다 ───────────────────────────────────
trace('4-오픈AI칸');
{
  /*
   * `prompt_cache_breakpoint` 는 OpenAI 스키마의 칸이고 거기엔 수명이 없다.
   * 없는 칸을 지어내면 400 이고, 그 400 은 화면에서 열쇠가 틀린 것과 구별이
   * 안 된다 — 이 파일이 고치려는 것보다 나쁜 고장이다.
   */
  const 블록 = 시스템블록([긴글], true, 'prompt_cache_breakpoint', { 긴수명: true });
  const 값 = Array.isArray(블록) ? 블록[0]?.prompt_cache_breakpoint : null;
  check('★★★ OpenAI 칸에는 ttl 을 안 붙인다', 값 && 값.ttl === undefined, JSON.stringify(값));
  check('★★ 그 칸의 제 값은 그대로 쓴다', 값?.mode === 'explicit', JSON.stringify(값));
}

// ── 5. 기본으로 켜져 있나 ───────────────────────────────────────────────
trace('5-기본값');
{
  /*
   * 설정을 해야 켜지면 아무도 안 켠다. 그리고 이건 안 켜면 **조용히 비싼**
   * 쪽이라, 안 켠 사람은 자기가 더 내고 있다는 것을 모른다.
   */
  for (const [이름, 카드] of [
    ['Anthropic 직통', 기본카드({ kind: 'anthropic', model: 'claude-opus-5', base: 'https://api.anthropic.com' })],
    ['게이트웨이 뒤 Claude', 기본카드({ kind: 'openai', model: 'claude-opus-5', base: 'https://gw.example/v1' })],
  ]) {
    check(`★★★ ${이름} 에서 기본으로 켜져 있다`, 카드.긴수명 === true, String(카드.긴수명));
  }
  /*
   * 이 줄은 원래 `(import.meta && true) && ...긴수명 !== undefined` 였다.
   * 앞은 언제나 참이고 뒤는 기본값이 있으니 언제나 참이다 — 이름은 「칸 목록에
   * 들어 있다」 인데 목록을 한 번도 안 봤다. `카드칸들` 에서 '긴수명' 을 빼도
   * 초록이었을 것이고, 그러면 배운 값이 저장·복원에서 조용히 빠진다.
   * 그 목록을 직접 본다.
   */
  check('★★★ 카드 칸 목록에 들어 있다 — 배운 것이 저장되고 되살아난다',
    카드칸들.includes('긴수명'), 카드칸들.join(','));
}

// ── 6. 앞머리를 흔들지 않는다 ───────────────────────────────────────────
trace('6-안흔들기');
{
  /*
   * 수명을 늘려 놓고 앞머리가 매 턴 바뀌면 아무 소용이 없다. 같은 입력이면
   * 같은 몸이 나와야 한다 — 캐시는 **글자 하나까지 같아야** 걸린다.
   */
  const a = JSON.stringify(몸만들기(기본).system);
  const b = JSON.stringify(몸만들기(기본).system);
  check('★★★ 같은 입력이면 앞머리가 글자까지 같다', a === b, '');
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n캐시 수명 검사  ${D}(굳은 것은 오래, 굴러가는 것은 짧게)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
