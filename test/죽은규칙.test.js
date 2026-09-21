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
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
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
    /*
     * `prompt_cache_breakpoint` 는 **OpenAI 스키마의 칸**이다. 그러니 바꿔 보는 것도
     * OpenAI 규격일 때만이어야 하는데, 갈래가 「anthropic 만 빼고」 로 적혀 있어서
     * ollama·gemini 창구에도 그 이름을 배워 **디스크에 적었다.** 그 창구는 그때부터
     * 있지도 않은 칸을 싣는다 (8회차 뒷단-배우기).
     */
    ['Extra inputs are not permitted: cache_control', 'ollama', '캐시', 'none'],
    ['Unrecognized request argument supplied: cache_control', 'gemini', '캐시', 'none'],
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
    /*
     * 칸 경로에 **숫자 인덱스**가 낀 창구. `messages.0.content` 는 wire.js 주석이
     * 칸 경로의 보기로 직접 적어 둔 꼴인데, 정작 무늬가 숫자로 시작하는 토막을
     * 안 받아서 이 문장은 칸 이야기로 안 읽혔다 — 정직하게 말해 주는 400 을
     * 한 줄도 못 배웠다 (8회차 뒷단-배우기).
     */
    ['messages.0.content: adaptive is not supported', 'anthropic', '생각형식', 'budget'],
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
  /*
   * `user_id` 갈래에는 **칸 이야기 울타리가 없었다.** 그래서 낱말 하나와 거절
   * 낱말만 있으면 세션자리를 껐다 — 아래 둘은 열쇠·권한 이야기지 칸 이야기가
   * 아니다. 그리고 그 배움은 디스크에 남아 영영 안 돌아온다 (8회차 뒷단-배우기).
   */
  for (const 글 of [
    'Unrecognized request argument supplied: username',
    "Invalid property 'browser_metadata_extra' in request",
    'Unrecognized request argument supplied: user_agent',
    'Unrecognized request argument supplied: metadata_version',
    'Invalid user_id: authentication failed',
    'Unknown user_id — please sign in again',
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


// ── 5. 있는데 아무도 안 돌리는 검사 ────────────────────────────────────
trace('5-안도는검사');
{
  /*
   * 검사 파일이 있는데 **아무도 안 돌리는** 자리.
   *
   * `test/run.mjs` 의 `FILES` 는 손으로 적는 목록이다. 새 검사를 만들고 그 줄을
   * 안 보태면 파일은 남아 있는데 초록도 빨강도 안 뜬다 — 지키는 게 하나도 없는
   * 검사가 된다. 파일이 있으니 아무도 없어진 줄 모른다.
   *
   * 그래서 디스크에 있는 `*.test.js` 가 전부 그 목록에 들어 있는지 본다.
   * 반대로 목록에만 있고 파일이 없는 이름도 잡는다 — 그건 조용히 건너뛴다.
   */
  const 달림 = readFileSync(join(뿌리, 'test', 'run.mjs'), 'utf8');
  const m = 달림.match(/const FILES = \[([\s\S]*?)\n\];/);
  check('★★ run.mjs 에서 검사 목록을 찾는다', !!m, m ? '' : '목록 모양이 바뀌었다');
  if (m) {
    const 적힌 = new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    const 있는 = readdirSync(join(뿌리, 'test')).filter((f) => f.endsWith('.test.js'));
    const 빠진 = 있는.filter((f) => !적힌.has(f));
    check('★★★ 검사 파일이 전부 run.mjs 목록에 들어 있다', 빠진.length === 0,
      빠진.length ? `npm test 가 안 도는 검사: ${빠진.join(' · ')}` : `${있는.length}개`);
    const 이름만 = [...적힌].filter((f) => !existsSync(join(뿌리, 'test', f)));
    check('★★ 목록에 적힌 이름이 전부 실제 파일이다', 이름만.length === 0,
      이름만.join(' · '));
  }
}


// ── 6. 어긋내기가 붙을 자리를 잃은 것 ──────────────────────────────────
trace('6-낡은앵커');
{
  /*
   * 어긋(변이)은 소스에서 글자 그대로 뜬 토막(`찾을것`)을 찾아 바꿔 넣는다.
   * 그 자리를 나중에 누가 고치면 토막이 **안 맞게** 되고, `tools/mutate.mjs` 는
   * 그 어긋을 `못 잼` 으로 건너뛴다. 건너뛰는 것은 실패로 안 세어지니,
   * 전면 주행은 초록인데 **지키던 자리가 하나 줄어 있다.**
   *
   * 어긋 주행은 몇 분씩 걸려 `npm test` 에 넣을 수 없다. 그래서 여기서는
   * 돌리지 않고 **붙을 자리가 남아 있는지만** 센다 — mutate.mjs 와 똑같이
   * 통글자로 갈라 세고, 딱 한 번 나와야 한다.
   */
  const 어긋들 = JSON.parse(readFileSync(join(뿌리, 'test', 'mutants.json'), 'utf8')).어긋들;
  const 원본 = new Map();
  const 잃은것 = [];
  for (const 어긋 of 어긋들) {
    const 길 = join(뿌리, 어긋.곳);
    if (!원본.has(어긋.곳)) {
      원본.set(어긋.곳, existsSync(길) ? readFileSync(길, 'utf8') : null);
    }
    const 글 = 원본.get(어긋.곳);
    if (글 === null) { 잃은것.push(`${어긋.곳} (파일 없음) — ${어긋.무엇}`); continue; }
    const 몇번 = 글.split(어긋.찾을것).length - 1;
    if (몇번 !== 1) 잃은것.push(`${어긋.곳} ${몇번}군데 — ${어긋.무엇}`);
  }
  check('★★★ 어긋내기가 전부 붙을 자리를 갖고 있다', 잃은것.length === 0,
    잃은것.length ? 잃은것.join(' · ') : `${어긋들.length}개`);
}

// ── 7. 나눠 돌리다 통째로 빠지는 것 ──────────────────────────────────
trace('7-조각나눔');

/*
 * 관문은 어긋내기를 **여덟 조각으로 나눠** 돌린다 (.github/workflows/test.yml).
 * 한 줄로 돌리면 몇 시간이라 그렇게 했는데, 나눠 돌리기에는 조용한 고장이 있다.
 *
 * 어떤 어긋이 **어느 조각에도 안 들어가면** 조각마다 초록이라 관문 전체가
 * 초록이다. 지키던 자리가 줄었는데 화면에는 아무 말도 안 난다 — 이 파일이
 * 내내 쫓던 그 모양이다.
 *
 * 그래서 조각들에게 「무엇을 맡았나」 를 물어보고, 합쳐서 전부를 덮는지 본다.
 * 조각 수도 워크플로에서 읽는다 — 거기서 16으로 바꾸고 여기가 8로 남아 있으면
 * 절반을 안 보면서 초록일 테니.
 */
{
  const 워크 = join(뿌리, '.github', 'workflows', 'test.yml');
  const 글 = existsSync(워크) ? readFileSync(워크, 'utf8') : '';
  const m = /--조각 \$\{\{ matrix\.shard \}\}\/(\d+)/.exec(글);
  const 조각목록 = /shard:\s*\[([^\]]*)\]/.exec(글);
  check('★★ 관문이 어긋내기를 조각내어 돌린다', !!m && !!조각목록,
    m ? '' : '`--조각 ${{ matrix.shard }}/N` 을 못 찾음');

  if (m && 조각목록) {
    const 몇 = Number(m[1]);
    const 적힌것 = 조각목록[1].split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
    check('★★ 워크플로의 조각 목록과 나눈 수가 맞는다',
      적힌것.length === 몇 && 적힌것.every((x, i) => x === i + 1),
      `목록 [${적힌것.join(',')}] · 나눔 ${몇}`);

    const 전체 = JSON.parse(readFileSync(join(뿌리, 'test', 'mutants.json'), 'utf8')).어긋들;
    const 본것 = new Set();
    let 합 = 0;
    let 탈 = null;
    for (let i = 1; i <= 몇 && !탈; i++) {
      const r = spawnSync(process.execPath,
        [join(뿌리, 'tools', 'mutate.mjs'), '--세어만', '--조각', `${i}/${몇}`],
        { encoding: 'utf8' });
      if (r.status !== 0) { 탈 = `조각 ${i}/${몇} 가 종료코드 ${r.status}`; break; }
      try {
        const j = JSON.parse(r.stdout);
        합 += j.맡은것;
        for (const n of j.이름들) 본것.add(n);
      } catch { 탈 = `조각 ${i}/${몇} 의 답을 못 읽음`; }
    }
    check('★★★ 조각을 다 합치면 어긋내기 전부를 덮는다',
      !탈 && 합 === 전체.length && 본것.size === 전체.length,
      탈 ?? `합 ${합} · 고유 ${본것.size} · 전체 ${전체.length}`);
  }
}

// ── 8. 어느 관문에서도 안 도는 어긋 ─────────────────────────────────
trace('8-잴곳');

/*
 * 어긋 중에는 **한 운영체제에서만 재지는 것**이 있다 — cmd.exe 감싸기,
 * PATHEXT, 대소문자를 안 가리는 이름, 엑셀 COM, taskkill. 리눅스에서는 그
 * 줄이 안 돌고 짝지은 검사도 그 자리를 건너뛰니, 어긋내도 늘 초록이다.
 * 그래서 `잴곳` 을 적어 딴 곳에서는 건너뛴다 (tools/mutate.mjs).
 *
 * 그런데 건너뛰기만 하고 **그것을 도는 job 이 관문에 없으면**, 그 어긋은
 * 아무 데서도 안 도는데 관문은 초록이다. 이 파일이 내내 쫓던 바로 그 모양 —
 * 있는 것과 걸리는 것은 다르다 — 이 어긋 목록 자신에게 생기는 셈이다.
 *
 * 그래서 `잴곳` 에 적힌 운영체제마다 그 러너에서 `--이곳만` 을 돌리는 job 이
 * 워크플로에 있는지 본다.
 */
{
  const 워크8 = join(뿌리, '.github', 'workflows', 'test.yml');
  const 글8 = existsSync(워크8) ? readFileSync(워크8, 'utf8') : '';
  const 전체8 = JSON.parse(readFileSync(join(뿌리, 'test', 'mutants.json'), 'utf8')).어긋들;

  // 운영체제 이름(process.platform) → 그 러너를 가리키는 말
  const 러너말 = { win32: 'windows', linux: 'ubuntu', darwin: 'macos' };

  const 적힌곳 = new Set();
  const 모르는곳 = [];
  for (const x of 전체8) {
    if (x.잴곳 == null) continue;
    for (const p of Array.isArray(x.잴곳) ? x.잴곳 : [x.잴곳]) {
      적힌곳.add(p);
      if (!러너말[p]) 모르는곳.push(`${x.곳}|${x.무엇} → ${p}`);
    }
  }
  check('★★ 잴곳이 아는 운영체제 이름이다', 모르는곳.length === 0,
    모르는곳.length ? 모르는곳.slice(0, 3).join(' · ') : `${적힌곳.size}곳`);

  /*
   * job 덩이로 쪼개 본다. `--이곳만` 이 워크플로 어딘가에 있기만 한 것으로는
   * 모자란다 — 리눅스 job 에 적혀 있으면 win32 어긋은 여전히 아무 데서도
   * 안 돈다. 그 job 의 `runs-on` 이 그 운영체제여야 한다.
   */
  const 덩이들 = 글8.split(/\n {2}(?=[A-Za-z][\w-]*:\n)/);
  // 러너 이름만 뽑아 견준다. 정규식을 글로 지어 붙이면 템플릿 문자열이
  // 역슬래시를 한 겹 먹어 `\s` 가 `s` 가 되고, 그러면 **아무 job 에도 안
  // 맞으면서 빨갛다** — 검사가 제 손으로 거짓 빨강을 내는 자리였다.
  const 러너들 = (덩이) => (덩이.match(/runs-on:\s*(\S+)/g) || []).join(' ');
  const 안도는곳 = [];
  for (const p of 적힌곳) {
    const 돈다 = 덩이들.some((덩이) => 덩이.includes('--이곳만') && 러너들(덩이).includes(러너말[p]));
    if (!돈다) 안도는곳.push(`${p} (러너 ${러너말[p]})`);
  }
  check('★★★ 잴곳마다 그것을 도는 job 이 관문에 있다', 적힌곳.size > 0 && 안도는곳.length === 0,
    안도는곳.length
      ? `아무 데서도 안 도는 곳: ${안도는곳.join(' · ')}`
      : `${적힌곳.size}곳 · ${전체8.filter((x) => x.잴곳).length}개`);

  /*
   * ── 어긋내는 job 은 검사가 쓰는 연장을 갖고 있어야 한다 (2.0.1) ──────────
   *
   * test/fastgrep.test.js 는 rg 가 없으면 그 단을 **건너뛴다.** 맞는 설계다 —
   * 없는 PC 에서도 검사는 통과해야 한다. 그런데 어긋내는 job 에 rg 가 없으면
   * 그 설계가 통째로 「안 재기」 가 된다. 실제로 두 번 났다:
   *
   *   리눅스 — 처음엔 rg 가 없어 어긋 다섯이 내내 샜다. 깔았더니 이번엔
   *            맨 검사가 빨개졌고(검사 쪽 흠이 드러남), 고치니 다 잡혔다.
   *   윈도   — 같은 까닭으로 어긋 하나가 샜는데, **맨 검사는 초록이었다.**
   *            아무 말도 안 나서 「무엇이 없어서 못 쟀다」 를 알 길이 없었다.
   *
   * 뒤쪽이 더 나쁘다. 그래서 연장을 job 에 못 박는다 — 어긋내기를 돌리는
   * job 이면 rg 를 까는 단이 같이 있어야 한다.
   */
  /*
   * **주석은 빼고 본다.** 처음 이 검사는 덩이 글에서 `ripgrep` 을 찾았는데,
   * 바로 위에 적어 둔 주석에 그 낱말이 있어서 단을 떼어도 초록이었다.
   * 적어 둔 것과 도는 것은 다르다 — 이 파일이 내내 쫓던 그 모양이다.
   */
  const 주석뺀것 = (덩이) => 덩이.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const 어긋도는덩이 = 덩이들.filter((덩이) => /mutate\.mjs/.test(주석뺀것(덩이)));
  const 연장없는것 = 어긋도는덩이
    .filter((덩이) => !/ripgrep/.test(주석뺀것(덩이)))
    .map((덩이) => 덩이.split('\n')[0].trim());
  check('★★★ 어긋내는 job 마다 ripgrep 을 깐다', 어긋도는덩이.length > 0 && 연장없는것.length === 0,
    연장없는것.length ? `연장 없이 도는 job: ${연장없는것.join(' · ')}` : `${어긋도는덩이.length}개 job`);
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n죽은 규칙 검사  ${D}(있는 것과 걸리는 것은 다르다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
