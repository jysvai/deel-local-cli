// **아무것도 안 맞는 규칙**을 잡는다.
//
// ── 왜 이 검사가 생겼나 ─────────────────────────────────────────────────
//
// `배울전선` 에 규칙을 하나 더 넣었다. 게이트웨이가 캐시 수명 칸(`ttl`)만
// 튕기면 그 칸만 끄고 캐시는 살리는 규칙이다. 넣고, 화면으로 확인하고,
// 넘어갔다. 그런데 그 규칙은 **한 번도 안 걸렸다.**
//
// 소스를 열어 보면 이렇게 적혀 있었다.
//
//     if (/\bttl\b/i.test(s) && 거절.test(s)) {
//
// 눈으로는 멀쩡하다. 바이트로 보면 아니었다.
//
//     i f ( / \b t t l \b / i .  ← 이 \b 두 개가 **진짜 백스페이스(0x08)**
//
// 코드를 힙독으로 만들다 `'\b'` 가 제어문자로 바뀐 것이다. 정규식 안에서
// 이러면 절대 안 맞는데, 화면·grep·에디터가 전부 `\b` 로 보여 준다.
//
// ── 이게 왜 무서운 종류인가 ─────────────────────────────────────────────
//
// **아무 데서도 안 터진다.** 규칙이 안 걸리면 그냥 다음 규칙으로 넘어가고,
// 다음 규칙이 「캐시를 끈다」 라서 그럴듯한 답이 나온다. 검사도 초록이고
// 화면도 멀쩡하다. 사람은 캐시가 꺼진 채로 몇 달을 쓴다.
//
// 그래서 「규칙이 있다」 가 아니라 **「규칙이 실제로 걸린다」** 를 재야 한다.
// 이 파일이 하는 일이 그것이다.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { 배울전선 } from '../src/backend/wire.js';
import { trace } from './trace.mjs';

const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), '..');
const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 1. 소스에 날 제어문자가 없다 ────────────────────────────────────────
trace('1-제어문자');
{
  /*
   * `tools/check-src.mjs` 가 같은 것을 잰다. 그런데 그건 `npm run check` 라
   * **따로 부르는 명령**이라, 고치고 안 돌리면 그대로 지나간다 — 실제로
   * 그렇게 지나갔다. 검사 안에도 둬서 `npm test` 한 번에 걸리게 한다.
   *
   * 탭·줄바꿈은 글의 일부고, ESC 는 화면 색을 내는 자리에 실제로 쓰인다
   * (ui/ansi.js). 그 셋만 봐준다.
   */
  // C1(0x80~0x9f)도 센다. 이 셈에서 U+009F 한 글자를 놓친 적이 있다 —
  // 정규식 범위의 끝에 앉아 있었고, 눈으로도 grep 으로도 안 보였다.
  const 봐줄것 = new Set([0x09, 0x0a, 0x0d, 0x1b]);
  const 날것코드 = (c) => (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) && !봐줄것.has(c);
  const 훑기 = (d, 모음 = []) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) 훑기(p, 모음);
      else if (/\.(m?js|cjs)$/.test(e.name)) 모음.push(p);
    }
    return 모음;
  };

  const 걸린것 = [];
  for (const 뿌리이름 of ['src', 'tools', 'bin', 'test']) {
    for (const p of 훑기(join(뿌리, 뿌리이름))) {
      // C1 은 UTF-8 에서 두 바이트다. 바이트로 세면 못 본다 — 글자로 읽는다.
      const 글자 = readFileSync(p, 'utf8');
      let 자리 = -1;
      for (let i = 0; i < 글자.length; i += 1) {
        if (날것코드(글자.charCodeAt(i))) { 자리 = i; break; }
      }
      if (자리 === -1) continue;
      const 줄 = 글자.slice(0, 자리).split('\n').length;
      걸린것.push(`${relative(뿌리, p).replace(/\\/g, '/')}:${줄} 0x${글자.charCodeAt(자리).toString(16)}`);
    }
  }
  /*
   * 검사 파일도 본다. 제어문자를 **다루는** 검사가 여기 있는데(commit·fig),
   * 그건 `\u0000` 처럼 이스케이프로 적으면 뜻이 똑같다. 날것으로 적을 까닭이
   * 없고, 날것으로 적힌 순간 진짜 고장과 구별이 안 된다.
   */
  check('★★★ src·tools·bin·test 에 날 제어문자가 없다 — 정규식 안에서는 절대 안 맞는다',
    걸린것.length === 0, 걸린것.join(' · '));
}

// ── 2. 배울전선 의 규칙이 **실제로** 걸린다 ─────────────────────────────
trace('2-실제로걸림');
{
  /*
   * 창구들이 실제로 주는 400 문장이다. 규칙 하나가 죽으면 여기서 빨개진다.
   *
   * 규칙을 새로 넣는 사람은 이 표에 한 줄을 더한다. 표에 없는 규칙은
   * 「넣었지만 걸리는지 아무도 안 본 규칙」 이고, 그건 없는 것과 같다.
   */
  const 유즈케이스 = [
    // [실제로 오는 400 문장, 규격, 기대하는 무엇, 기대하는 값]
    ['Extra inputs are not permitted: cache_control.ttl', 'anthropic', '긴수명', false],
    ['Unrecognized request argument supplied: ttl', 'openai', '긴수명', false],
    ['Extra inputs are not permitted: cache_control', 'anthropic', '캐시', 'none'],
    ['Extra inputs are not permitted: cache_control', 'openai', '표식칸', 'prompt_cache_breakpoint'],
    ['Unrecognized request argument supplied: prompt_cache_breakpoint', 'openai', '캐시', 'none'],
    ['budget_tokens is not supported', 'anthropic', '생각형식', 'adaptive'],
    ['Unrecognized request argument supplied: reasoning_effort', 'openai', '생각형식', 'none'],
    ['output_config is not supported', 'openai', '효력칸', null],
    ['Unsupported parameter: max_completion_tokens', 'openai', '출력칸', '옛것'],
    ['Unrecognized request argument supplied: max_tokens', 'openai', '출력칸', '새것'],
    /*
     * 아래 넷은 앞선 갈래가 먼저 삼켜서 여태 한 번도 안 걸려 본 자리다.
     * 「budget_tokens」 가 든 문장으로 adaptive 갈래를 재려 하면 그 위 갈래가
     * 먼저 잡는다 — 그래서 그 낱말이 **없는** 문장을 골라야 이 줄이 뜻을 갖는다.
     */
    ["Invalid value: thinking.type 'adaptive' is not supported by this model",
      'anthropic', '생각형식', 'budget'],
    ['Extra inputs are not permitted: thinking', 'anthropic', '생각형식', 'none'],
    ['Unrecognized request argument supplied: prompt_cache_key', 'openai', '캐시', 'none'],
    // 이름이 따옴표로 먼저 오고 까닭이 뒤에 오는 창구. 앞의 두 무늬가 못 잡는다.
    ["'user' is unsupported for this model", 'openai', '세션자리', null],
    ['metadata.user_id: unsupported field', 'openai', '세션자리', null],
    ['Unrecognized request argument supplied: stream_options', 'openai', '스트림usage', false],
  ];

  for (const [문장, 규격, 무엇, 값] of 유즈케이스) {
    const 것 = 배울전선(문장, 규격);
    const 맞나 = 것?.무엇 === 무엇 && 것?.값 === 값;
    check(`★★★ "${문장.slice(0, 46)}…" → ${무엇}`, 맞나,
      맞나 ? '' : `받은 것: ${JSON.stringify(것)}`);
  }
}

// ── 3. 넓게 잡아서 엉뚱한 것까지 끄지 않는다 ────────────────────────────
trace('3-오작동');
{
  /*
   * `ttl` 을 낱말 경계 없이 잡으면 **`throttle` 에도 걸린다** (t-t-l). 그러면
   * 한도 이야기를 하는 400 이 캐시 수명을 꺼 버린다 — 고친 것이 아니라 새
   * 고장이다. 실제로 낱말 경계가 제어문자로 깨져 있던 자리라 여기서 못 박는다.
   */
  const 안걸려야 = [
    ['Request was throttled. Please try again later.', 'anthropic'],
    ['Rate limit reached for requests', 'openai'],
    ['The model returned the following errors: throttling', 'anthropic'],
    ['max_tokens must be greater than 0', 'anthropic'],
    ['temperature: must be less than or equal to 2', 'openai'],
    ['', 'openai'],
  ];
  /*
   * 답장의 셈판 이름은 우리가 보낸 칸이 아니다. 이 낱말에 캐시를 끄면, 창구가
   * 오류 문장에 답장 칸 이름을 얹어 준 날 캐시가 통째로 죽고 그 값이 디스크에
   * 남는다 — 화면에는 아무것도 안 뜬다.
   */
  /*
   * 이름 **안에** 든 낱말로는 안 배운다. 아래 셋은 세션 이름과 아무 상관이
   * 없는 칸인데, 낱말 경계가 없던 동안 셋 다 「세션 이름을 안 받는 창구」 로
   * 읽혔다. 그리고 그 값은 디스크에 남아서, 멀쩡히 되던 기능이 그 창구에서
   * 영영 꺼진 채로 굳는다.
   */
  for (const 글 of [
    'Unrecognized request argument supplied: username',
    "Invalid property 'browser_metadata_extra' in request",
    'Unrecognized request argument supplied: user_agent',
    'Unrecognized request argument supplied: metadata_version',
  ]) {
    const 것 = 배울전선(글, 'openai');
    check(`★★★ "${글.slice(0, 46)}…" 로는 세션 이름을 안 끈다`,
      것?.무엇 !== '세션자리', JSON.stringify(것));
  }

  check('★★★ 답장 셈판 이름(cache_creation_input_tokens)으로는 캐시를 안 끈다',
    배울전선('Unrecognized request argument supplied: cache_creation_input_tokens', 'openai') === null,
    JSON.stringify(배울전선('Unrecognized request argument supplied: cache_creation_input_tokens', 'openai')));
  for (const [문장, 규격] of 안걸려야) {
    const 것 = 배울전선(문장, 규격);
    check(`★★★ "${(문장 || '(빈 글)').slice(0, 42)}…" 에는 아무것도 안 배운다`,
      것 === null || 것?.무엇 !== '긴수명', JSON.stringify(것));
  }
  // 값이 틀린 것은 칸을 끄는 일이 아니다 — 여태 규칙이고 안 바뀌었다.
  check('★★ 값이 틀린 것은 아무 칸도 안 끈다',
    배울전선('max_tokens must be greater than 0', 'anthropic') === null, '');
}

// ── 4. 정규식 리터럴에 제어문자가 숨어 있지 않다 ────────────────────────
trace('4-정규식');
{
  /*
   * 1번이 파일 전체를 보므로 겹치는 검사다. 그래도 따로 두는 까닭이 있다 —
   * 정규식 안의 제어문자는 **틀렸다고 말해 주지 않는다.** 문자열 안에 있으면
   * 언젠가 화면에 이상하게 찍혀서 들키지만, 정규식 안에서는 그냥 안 맞을 뿐이다.
   * 그게 이 고장이 몇 달을 살 수 있는 까닭이다.
   *
   * 여기서 **정규식으로** 제어문자를 찾으면 안 된다. 그러려면 리터럴 안에
   * 제어문자를 적어야 하고, 그러면 이 검사가 잡으려는 고장을 이 검사가 갖는다.
   * (처음에 실제로 그렇게 썼고, 위 1번이 그걸 잡았다.) 코드 값으로 센다.
   */
  // C1(0x80~0x9f)도 센다. 이 셈에서 U+009F 한 글자를 놓친 적이 있다 —
  // 정규식 범위의 끝에 앉아 있었고, 눈으로도 grep 으로도 안 보였다.
  const 봐줄것 = new Set([0x09, 0x0a, 0x0d, 0x1b]);
  const 날것코드 = (c) => (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) && !봐줄것.has(c);
  const 날것인가 = (줄) => {
    for (let i = 0; i < 줄.length; i += 1) {
      if (날것코드(줄.charCodeAt(i))) return true;
    }
    return false;
  };
  const 정규식든줄 = /\/(?:[^/\\\n]|\\.)+\/[gimsuy]*/;

  const 훑기 = (d, 모음 = []) => {
    for (const it of readdirSync(d, { withFileTypes: true })) {
      const q = join(d, it.name);
      if (statSync(q).isDirectory()) 훑기(q, 모음);
      else if (/\.m?js$/.test(it.name)) 모음.push(q);
    }
    return 모음;
  };
  const 걸린것 = [];
  for (const q of 훑기(join(뿌리, 'src'))) {
    const 글 = readFileSync(q, 'utf8');
    글.split('\n').forEach((줄, i) => {
      if (!정규식든줄.test(줄)) return;
      if (날것인가(줄)) 걸린것.push(`${relative(뿌리, q).replace(/\\/g, '/')}:${i + 1}`);
    });
  }
  check('★★★ 정규식이 든 줄에 제어문자가 없다', 걸린것.length === 0, 걸린것.join(' · '));
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n죽은 규칙 검사  ${D}(있는 것과 걸리는 것은 다르다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
