// 슬래시 명령을 하나씩 실제로 눌러 본다.
//
// 왜 만들었나:
//   /code 를 넣는 case 안에서 없는 변수(cmd)를 쓰고 있었다. `node --check` 는
//   문법만 보므로 못 잡는다. modes.js 를 직접 부르는 검사도 못 잡는다 —
//   그 파일은 멀쩡했기 때문이다. 명령을 눌러 봐야만 나오는 고장이었다.
//
//   그래서 '이 파일은 파싱된다' 가 아니라 '이 명령은 눌리면 끝까지 간다' 를 본다.
//   case 하나를 새로 넣을 때마다 여기 목록에 한 줄 늘리면 된다.
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { 명령들, 딴이름들 } from '../src/cmdnames.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 진짜 설정 파일을 건드리지 않게 먼저 못을 박는다.
//
// 처음 이 검사를 돌렸을 때 /level 이 사용자의 ~/.deel/config.json 에 값을 써 버렸다.
// 검사가 사람 설정을 바꾸면 안 된다. config.js 가 이 값을 쓸 때마다 보므로
// import 보다 늦게 정해도 먹는다.
const 설정집 = mkdtempSync(join(tmpdir(), 'deel-cmd-home-'));
process.env.DEEL_HOME = 설정집;
import { handle, COMMANDS, 미리보기끄기 } from '../src/commands.js';
import { 받기설정, 지금상태 as 지금열쇠상태 } from '../src/safety/authcmd.js';
import { Session } from '../src/agent/session.js';
import { 프록시정하기, 프록시지우기 } from '../src/backend/proxy.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { Store, sessionsDir } from '../src/agent/store.js';
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
  '/think 자세히', '/think 배분', '/think 배분 절약', '/think 배분 없는배분', '/think save',
  '/out', '/out 32k', '/out auto', '/out 숫자아님',
  '/mode', '/mode strict', '/mode auto', '/mode 없는값',
  '/work', '/code', '/plan', '/architect', '/debug', '/ask', '/orchestrator',
  '/work 설계', '/work 없는모드',
  '/tools', '/cost', '/status', '/sessions', '/skills', '/skills 없을만한검색어',
  '/model', '/model list',
  '/undo 0',
  '/init',
  '/clear',
  '/없는명령',
];

// 일부러 안 누르는 것과 그 이유. 조용히 빼면 '다 됐다' 로 읽힌다.
const 건너뜀 = [
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

// 슬래시로 시작한다고 다 명령은 아니다.
//
// `/usr/local/bin` 같은 경로를 치면 통째로 명령으로 먹혀서 모델에게 닿지도
// 않았다. 경로를 아예 못 적는 셈이었다. 이제는 그냥 말로 넘긴다.
{
  const 경로들 = [
    '/usr/local/bin/node 이거 봐줘',
    '/mnt/d/일감/보고서.txt 읽어줘',
    '/c/Users/공용/문서',
    '/home/user/.config',
    '/var/log/app.log 마지막 20줄',
    '/작업/한글 폴더/파일.md',
  ];
  for (const line of 경로들) {
    const s = 새세션();
    const r = await 조용히(() => handle(line, s, ctx));
    check(`경로를 명령으로 안 먹는다: ${line.split(' ')[0]}`,
      r.ok && r.v?.handled === false, `handled=${r.v?.handled} · ${r.out.trim().split('\n')[0] ?? ''}`);
  }

  // 그렇다고 진짜 명령이 안 먹으면 안 된다.
  for (const line of ['/help', '/plan', '/level 개발자', '/think high']) {
    const s = 새세션();
    const r = await 조용히(() => handle(line, s, ctx));
    check(`명령은 그대로 명령: ${line}`, r.ok && r.v?.handled === true, `handled=${r.v?.handled}`);
  }

  // 플러그인 명령은 콜론을 쓴다. 슬래시가 없으니 경로로 오해하면 안 된다.
  {
    const 명령파일 = join(root, 'hello.md');
    writeFileSync(명령파일, '---\nname: hello\n---\n안녕이라고 답하세요: $ARGUMENTS\n', 'utf8');
    const s = 새세션();
    s.commands = [{ name: 'myplug:hello', source: '(검사)', path: 명령파일 }];
    const r = await 조용히(() => handle('/myplug:hello 반가워', s, ctx));
    check('플러그인 명령은 경로로 안 본다', r.ok && r.v?.handled === false, `handled=${r.v?.handled}`);
    check('플러그인 명령 본문이 모델로 간다', /안녕이라고 답하세요/.test(r.v?.text ?? ''), r.v?.text ?? '없음');
    check('$ARGUMENTS 가 채워진다', /반가워/.test(r.v?.text ?? ''), r.v?.text ?? '');
  }
}

// 모르는 명령을 조용히 삼키면 오타를 눈치 못 챈다.
{
  const s = 새세션();
  const r = await 조용히(() => handle('/없는명령', s, ctx));
  check('모르는 명령은 모른다고 말한다', /모르는 명령/.test(r.out), r.out.trim().split('\n')[0] ?? '');
  check('모르는 명령을 모델에게 안 보낸다', r.v?.handled === true && !r.v?.text, JSON.stringify(r.v));
}

/*
 * ── 오타에 「혹시 이것」 을 안 알려 줬다 ────────────────────────────────
 *
 * `/hepl` · `/modle` 에는 「모르는 명령」 만 나왔다. 비슷한 것은 이 PC 에서 찾은 명령(스킬·플러그인)
 * 에서만 찾고 **내장 명령은 안 봤다** — 제일 흔한 오타는 내장 명령에서 난다. 슬래시만 치고 Enter
 * 를 치면 「모르는 명령 /」 이라는, 무엇을 모르는지 알 수 없는 말이 나왔다.
 */
{
  const 벗김 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(0, 3).join(' | ');
  for (const [친것, 있어야] of [['/hepl', '/help'], ['/modle', '/model'], ['/cleer', '/clear']]) {
    const r = await 조용히(() => handle(친것, 새세션(), ctx));
    // 「/help 로 목록을」 줄에도 /help 가 있다 — 「비슷한 것」 줄에서 찾아야 권한 것이다.
    const 비슷줄 = r.out.split('\n').find((l) => l.includes('비슷한 것')) ?? '';
    check(`★ ${친것} 에 ${있어야} 를 권한다`, 비슷줄.includes(있어야), 벗김(r.out));
  }
  const 빈 = await 조용히(() => handle('/', 새세션(), ctx));
  check('★ 슬래시만 치면 「모르는 명령 /」 이 아니라 목록을 보인다', !빈.out.includes('모르는 명령') && 빈.out.includes('/help'), 벗김(빈.out));

  // 일본어·중국어 입력기는 전각 슬래시(U+FF0F)를 낸다. 그대로 모델에게 가면 명령이 말이 된다.
  const 전각 = await 조용히(() => handle(`${String.fromCodePoint(0xff0f)}help`, 새세션(), ctx));
  check('★ 전각 슬래시(／help)도 명령이다', 전각.v?.handled === true, JSON.stringify(전각.v));

  const s = 새세션();
  await 조용히(() => handle('/mode STRICT', s, ctx));
  check('★ /mode STRICT 도 바꾼다 — 대문자라고 목록만 보이지 않는다', s.mode === 'strict', s.mode);
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

/*
 * ★★ 화면에 `undefined` 를 찍지 않는다.
 *
 * 걸음 수가 모드 표에서 budget.js 로 옮겨 간 뒤에도 이 두 화면은 옛 자리
 * (`w.steps`)를 읽고 있었다. 그래서 「최대 undefined걸음」 이 떠 있었다.
 *
 * 검사가 이걸 못 잡은 이유가 중요하다 — 여태 **명령이 안 터지는지**만 봤다.
 * 안 터지는 것과 맞는 것을 보여 주는 것은 다르다. 화면에 나온 글자를 실제로
 * 읽는 검사가 하나도 없으면, 이런 것은 사진을 찍어 보고서야 안다(실제로 그랬다).
 */
{
  const s = 새세션();
  const 목록 = await 조용히(() => handle('/work', s, ctx));
  check('★★ 모드 목록에 undefined 가 안 뜬다', !/undefined/.test(목록.out),
    (목록.out.match(/.{0,30}undefined.{0,10}/) ?? [''])[0].trim());
  check('★ 모드마다 걸음 수가 숫자로 뜬다',
    (목록.out.match(/최대 \d+걸음/g) ?? []).length === 8,
    `${(목록.out.match(/최대 \d+걸음/g) ?? []).length}개`);
  check('여덟 모드가 다 뜬다', ['종합', '코드', '계획', '설계', '디버그', '점검', '묻기', '총괄']
    .every((n) => 목록.out.includes(n)));

  const 하나 = await 조용히(() => handle('/work 점검', s, ctx));
  check('★★ 모드를 고른 뒤 알림에도 undefined 가 안 뜬다', !/undefined/.test(하나.out),
    (하나.out.match(/.{0,30}undefined.{0,10}/) ?? [''])[0].trim());
  check('★ 고른 모드의 걸음 수도 숫자다', /최대 \d+걸음/.test(하나.out),
    (하나.out.match(/최대 .{0,12}/) ?? [''])[0]);
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

// ── /think 교통정리 ─────────────────────────────────────────────────────
//
// 전에는 한 명령이 두 축을 맡았다. `/think high` 는 강도(5단계)를,
// `/think save` 는 배분(3가지)을 정했다 — 같은 이름으로 다른 것을 정한다.
// 게다가 부를 때마다 단계표가 통째로 펼쳐졌고, 그 표의 '출력상한' 세 줄은
// 늘 같은 값이었다. 읽는 화면이 아니라 세어야 하는 화면이었다.
//
// 그래서 여기서 보는 것은 '무엇이 보이나' 보다 **'무엇이 안 보이나'** 다.
// 기본 화면에 표가 다시 기어들어오면 이 검사가 잡는다.
{
  const 색빼기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

  // 1) 기본은 한 줄
  const s = 새세션();
  const 글 = 색빼기((await 조용히(() => handle('/think', s, ctx))).out);
  check('/think 기본이 강도를 한 줄로 말한다', /추론 강도\s+medium/.test(글), 글.trim().split('\n')[0] ?? '');
  check('/think 기본이 단계별 배분을 괄호로 붙인다',
    /\(첫 판단 \w+ · 이어가기 \w+ · 막혔을 때 \w+\)/.test(글), 글.trim());
  check('/think 기본은 단계표를 안 펼친다', !/출력상한/.test(글), 글.trim());
  check('쉬움 수준에는 배분 이야기를 안 꺼낸다', !/배분/.test(글), 글.trim());
  /*
   * 짧게 유지한다 — 다만 자동 조절 줄 하나는 센다.
   *
   * 그 줄이 답하는 질문이 있다. 「max 라고 정했는데 왜 medium 으로 도나」 —
   * 자동 조절을 켜 두면 정한 값이 천장이 되므로, 그 사실이 이 화면에 없으면
   * 사람은 조절이 고장 난 줄 안다. 없앨 줄이 아니라 **있어야 하는 줄**이다.
   *
   * 여기가 지키는 것은 줄 수 자체가 아니라 **단계표가 다시 안 기어들어오는
   * 것**이다. 표가 돌아오면 위 '출력상한' 검사가 먼저 잡고, 이 줄은 그 표가
   * 다른 이름으로 슬그머니 붙는 것을 잡는다.
   */
  check('/think 기본이 짧다', 글.trim().split('\n').length <= 4, String(글.trim().split('\n').length));

  // 2) 개발자 수준에서는 배분이 한 줄 더 붙는다 — 그래도 표는 아니다
  const 개 = new Session(conn, { root, level: '개발자', think: 'medium', effort: 'save' });
  const 글개 = 색빼기((await 조용히(() => handle('/think', 개, ctx))).out);
  check('개발자 수준에는 배분을 같이 보여 준다', /배분\s+절약/.test(글개), 글개.trim());
  check('개발자 수준에서도 단계표는 안 펼친다', !/출력상한/.test(글개), 글개.trim());

  // 3) 자세히 — 여기서만 표가 나온다
  const s2 = 새세션();
  const 글2 = 색빼기((await 조용히(() => handle('/think 자세히', s2, ctx))).out);
  check('/think 자세히 가 단계표를 펼친다', /단계\s+강도\s+출력상한\s+언제/.test(글2), 글2.trim().slice(0, 90));
  check('/think 자세히 가 세 단계를 다 그린다',
    /첫 판단/.test(글2) && /이어가기/.test(글2) && /막혔을 때/.test(글2), '');
  // 세 줄이 같은 값일 때 그게 고장인지 아닌지는 이 한 줄로 갈린다.
  // (아는 상한이 낮으면 셋이 같아지는 것이 **맞다** — 그걸 말해 줘야 한다.)
  check('/think 자세히 가 상한이 어디서 왔는지 밝힌다',
    /출력 상한은\s+[\d,]+\s+\(.+?\) 안에서 나눕니다/.test(글2), 글2.trim().slice(-300));
  check('/think 자세히 가 출력 상한은 /out 으로 넘긴다', /\/out/.test(글2), '');

  // 4) 배분은 따로 — 강도와 헷갈리지 않게
  const s3 = 새세션();
  await 조용히(() => handle('/think 배분 절약', s3, ctx));
  check('/think 배분 이 배분을 바꾼다', s3.effort === 'save', s3.effort);
  await 조용히(() => handle('/think 배분 깊게', s3, ctx));
  check('/think 배분 이 한글 이름을 받는다', s3.effort === 'deep', s3.effort);
  check('/think 배분 을 직접 골랐다고 표시한다', s3.effortSet === true, String(s3.effortSet));
  const 강도전 = s3.think;
  await 조용히(() => handle('/think 배분 even', s3, ctx));
  check('배분을 바꿔도 강도는 그대로', s3.think === 강도전, `${강도전} → ${s3.think}`);

  const s4 = 새세션();
  const 글4 = 색빼기((await 조용히(() => handle('/think 배분 없는배분', s4, ctx))).out);
  check('모르는 배분이면 고를 것을 보여 준다', /균일|절약|깊게/.test(글4), 글4.trim());
  check('모르는 배분은 안 바꾼다', s4.effort === 'save', s4.effort);

  // 5) 강도를 바꿔도 배분은 그대로 — 두 축이 진짜로 갈렸는지
  const s5 = 새세션();
  await 조용히(() => handle('/think 배분 깊게', s5, ctx));
  await 조용히(() => handle('/think low', s5, ctx));
  check('강도를 바꿔도 배분은 그대로', s5.effort === 'deep' && s5.think === 'low', `${s5.effort}/${s5.think}`);

  // 6) 옛 이름도 그대로 받는다 — 쓰던 사람의 손버릇을 깨지 않는다
  const s6 = 새세션();
  const 글6 = 색빼기((await 조용히(() => handle('/think deep', s6, ctx))).out);
  check('옛 이름 /think deep 도 배분으로 받는다', s6.effort === 'deep', s6.effort);
  check('옛 이름을 받으면 새 이름을 알려 준다', /\/think 배분/.test(글6), 글6.trim().slice(0, 200));
}

// ── /out — 출력 상한은 아예 다른 축이라 명령을 따로 뺐다 ─────────────────
//
// 컨텍스트(한 번에 담아 둘 수 있는 양)와 출력 상한(한 번에 낼 수 있는 양)은
// 다른 숫자다. 그 둘이 하나인 줄 알면 큰 파일이 왜 안 만들어지는지 영영 모른다.
//
// 그리고 전에는 이 값이 **먹지도 않았다** — effort.js 의 세 번째 클램프가
// 다시 조여서 올릴 수가 없었다. 있는데 안 먹는 것이 가장 나쁘다.
{
  const 색빼기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

  const s = 새세션();
  const 글 = 색빼기((await 조용히(() => handle('/out', s, ctx))).out);
  check('/out 이 지금 상한을 보여 준다', /지금 상한\s+[\d,]+/.test(글), 글.trim().slice(0, 120));
  check('/out 이 컨텍스트와 다른 축이라고 말한다', /다른 축/.test(글), '');
  check('/out 이 어디서 온 값인지 밝힌다', /직접 정하신 값|서버에서 알아낸 값|기본값/.test(글), '');

  const s2 = 새세션();
  await 조용히(() => handle('/out 32k', s2, ctx));
  check('/out 32k 가 실제로 값을 바꾼다', s2.conn.maxTokens === 32768, String(s2.conn.maxTokens));

  // 진짜로 먹는가 — 화면 글자가 아니라 요청에 실리는 숫자를 본다.
  {
    const { tokensFor } = await import('../src/agent/effort.js');
    const 방 = { ctx: 262144, used: 4000, max: s2.conn.maxTokens };
    const 준값 = tokensFor('save', 'plan', 방);
    const 기본 = tokensFor('save', 'plan', { ...방, max: null });
    check('/out 으로 올린 값이 상한 계산까지 간다', 준값 > 기본, `${준값} vs ${기본}`);
  }

  await 조용히(() => handle('/out auto', s2, ctx));
  check('/out auto 가 직접 정한 값을 지운다', s2.conn.maxTokens == null, String(s2.conn.maxTokens));

  // 옛 자리(/ctx out)도 그대로 통해야 한다 — 문서·안내에 적혀 있던 이름이다.
  // 한글 별칭('답'·'출력')은 \b 함정 때문에 안 통하고 있었다: '출력 32k' 가
  // 컨텍스트 길이로 넘어가 "숫자를 못 읽었습니다" 로 끝났다.
  for (const 줄 of ['/ctx out 32k', '/ctx 출력 32k', '/ctx 답 32k']) {
    const s = 새세션();
    const r = await 조용히(() => handle(줄, s, ctx));
    check(`${줄} 가 출력 상한으로 간다`, s.conn.maxTokens === 32768,
      `${s.conn.maxTokens} · ${색빼기(r.out).trim().split('\n')[0] ?? ''}`);
  }

  // conn 은 한 프로세스에 하나뿐이라 세션끼리 같은 것을 본다(그게 맞다).
  // 앞 검사가 올려 둔 값을 지우고 시작해야 '안 바꾼다' 를 볼 수 있다.
  conn.maxTokens = null;
  const s3 = 새세션();
  const 글3 = 색빼기((await 조용히(() => handle('/out 숫자아님', s3, ctx))).out);
  check('/out 이 못 읽는 값을 말해 준다', /못 읽었습니다/.test(글3), 글3.trim());
  check('못 읽으면 안 바꾼다', s3.conn.maxTokens == null, String(s3.conn.maxTokens));

  // 고른 값은 프로필에 남아야 한다 — 다음에 켤 때도 그대로여야 한다.
  {
    // 프로필이 하나도 없으면 남길 자리가 없다(그게 맞다). 하나 만들어 놓고 본다.
    const p = join(설정집, 'config.json');
    const 밑 = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { version: 1, profiles: [] };
    밑.profiles = [{ id: '검사프로필', name: '검사', kind: 'openai', baseUrl: conn.base, model: conn.model }];
    밑.active = '검사프로필';
    writeFileSync(p, JSON.stringify(밑, null, 2), 'utf8');

    const s4 = 새세션();
    await 조용히(() => handle('/out 65536', s4, ctx));
    const j = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
    const prof = j?.profiles?.find((x) => x.id === j.active) ?? j?.profiles?.[0] ?? null;
    check('/out 이 프로필에 남는다', prof?.maxTokens === 65536, JSON.stringify(prof?.maxTokens));
    await 조용히(() => handle('/out auto', s4, ctx));
    const j2 = JSON.parse(readFileSync(p, 'utf8'));
    const prof2 = j2?.profiles?.find((x) => x.id === j2.active) ?? j2?.profiles?.[0] ?? null;
    check('/out auto 가 프로필에서도 지운다', prof2 && prof2.maxTokens === undefined, JSON.stringify(prof2?.maxTokens));
  }
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

// 오류를 수준에 맞게 바꿔 주는 부분.
//
// 가장 중요한 것은 '원인을 지우지 않는다' 다. 쉽게 바꿔 주는 것까지는 좋은데
// 원래 문구를 없애면, 막혔을 때 물어볼 것조차 없어진다.
{
  const { explain } = await import('../src/ui/level.js');

  const 사례 = [
    ['connect ECONNREFUSED 127.0.0.1:11434', /모델이 안 켜져/],
    ['허용되지 않은 주소입니다: https://example.com', /막힌 게 정상/],
    ['작업 범위 밖입니다: C:\\other\\x.txt', /시작한 폴더 바깥/],
    ['먼저 Read 로 읽어야 합니다: a.js', /먼저 읽게 되어 있습니다/],
    ['401 Unauthorized', /열쇠|API 키/],
    ['request timeout after 120000ms', /제때 답하지 않았습니다/],
    /*
     * Node 가 내는 시간 초과는 「timeout」 이라고 안 적는다. `ETIMEDOUT` 이다 — 그 안에
     * timeout 이라는 글자가 없어서(TIMEDOUT) 어느 풀이에도 안 걸리고 날것으로 나갔고,
     * `connect ETIMEDOUT` 은 넓은 `connect` 에 먼저 걸려 「모델이 안 켜져 있다」 는 **틀린**
     * 풀이가 나갔다. 모델은 떠 있는데 느린 것이라, 그 말대로 하면 고쳐지지 않는다
     * (2.0.0 8회차 uimisc LV1).
     */
    ['read ETIMEDOUT', /제때 답하지 않았습니다/],
    ['connect ETIMEDOUT 127.0.0.1:11434', /제때 답하지 않았습니다/],
    /*
     * LV1 이 반만 고쳐져 있었다 (2.0.0 10회차 막판-화면 LV3).
     *
     * `connect` 는 **글자 넉 자**다. 오류 문구에 실리는 것은 대개 경로와 주소인데, 거기에
     * `connect` 가 들어간 이름은 흔하다 — `connect-api/`, `connector.js`, 사내 게이트웨이
     * `connect.…`. 그래서 딱 그 말로 적어 둔 좁은 풀이 셋이 넓은 `connect` 아래에 있는 동안,
     * 범위 밖·막힌 주소·먼저 읽기가 전부 「모델이 안 켜져 있습니다 — LM Studio 를 켜세요」 로
     * 나갔다. 모델은 켜져 있고, 그 말대로 해도 안 고쳐진다.
     *
     * 이 파일이 아니라 level.js 머리말이 이미 규칙을 적어 두었다 — 「좁은 것을 넓은 것 위에」.
     * ETIMEDOUT 만 위로 올리고 나머지 셋은 그대로 두었던 자리다.
     */
    ['작업 범위 밖입니다: C:\\work\\connect-api\\db.js', /시작한 폴더 바깥/],
    ['허용되지 않은 주소입니다: https://connect.example.com/v1', /막힌 게 정상/],
    ['먼저 Read 로 읽어야 합니다: src/connector.js', /먼저 읽게 되어 있습니다/],
  ];
  for (const [원래, 기대] of 사례) {
    const r = explain('쉬움', 원래);
    check(`쉬움: ${원래.slice(0, 24)}… 를 쉬운 말로`, r.plain && 기대.test(r.text), r.text.split('\n')[0]);
    check(`쉬움: 원래 문구를 안 지운다`, r.detail === 원래, r.detail ?? '없음');
  }

  // 모르는 오류는 손대지 않는다. 아무 말이나 지어내는 것보다 낫다.
  {
    const r = explain('쉬움', '알 수 없는 무언가가 터졌습니다 XYZ');
    check('모르는 오류는 그대로 둔다', !r.plain && r.text === '알 수 없는 무언가가 터졌습니다 XYZ', r.text);
  }

  // 개발자 수준은 손대지 않는다.
  for (const [원래] of 사례) {
    const r = explain('개발자', 원래);
    check(`개발자: ${원래.slice(0, 20)}… 는 그대로`, !r.plain && r.text === 원래, r.text);
  }
}

/*
 * ── 감추는 까닭을 적은 숫자가 실제와 맞는가 (2.0.0 8회차 uimisc LV2) ────────
 *
 * `src/ui/level.js` 머리말은 「처음 켠 사람에게 명령 열여덟 개를 들이밀면 아무것도 못 고른다」
 * 라고 적어 두고, 정작 초보 목록이 **정확히 열여덟 개**였다. 머리말이 제 목록을 나무라는 꼴이라,
 * 읽는 사람은 목록을 줄여야 하는 줄 안다. 파 보면 그 줄을 쓸 때는 명령이 통틀어 열여덟 개였고
 * (4bc8c1e · 초보 목록은 열두 개) 그 뒤 쉰 개가 넘게 늘도록 숫자만 그대로였다.
 *
 * 숫자만 고쳐 두면 또 낡는다. 그래서 「많다」 고 적은 수를 실제와 대 본다 —
 * 초보 목록보다는 크고(안 그러면 제 목록을 나무란다), 전체 명령 수보다는 크지 않아야 한다.
 */
{
  const 머리말 = readFileSync(new URL('../src/ui/level.js', import.meta.url), 'utf8')
    .split('\nimport ')[0].replace(/^\s*\/\/ ?/gm, '').replace(/\s+/g, ' ');
  const 한글수 = { 열둘: 12, 열여덟: 18, 스물: 20, 서른: 30, 마흔: 40, 쉰: 50, 예순: 60, 일흔: 70, 여든: 80, 아흔: 90, 백: 100 };
  const 전체 = Object.keys(COMMANDS).filter((n) => n !== 'quit').length;
  const { LEVELS: 수준들 } = await import('../src/ui/level.js');
  const 초보 = 수준들['쉬움'].show.length;
  const 든것 = new RegExp(`(${Object.keys(한글수).join('|')}) 개를? (?:통째로 )?들이밀면`).exec(머리말);

  check('머리말이 「몇 개를 들이밀면」 을 적어 둔다', Boolean(든것), 머리말.slice(-140));
  check('★ 많다고 적은 수가 초보 목록보다 크다', 든것 ? 한글수[든것[1]] > 초보 : false,
    `머리말 ${든것?.[1] ?? '없음'}(${한글수[든것?.[1]] ?? '?'}) · 초보 목록 ${초보}개`);
  check('★ 많다고 적은 수가 전체 명령 수를 안 넘는다', 든것 ? 한글수[든것[1]] <= 전체 : false,
    `머리말 ${한글수[든것?.[1]] ?? '?'} · 전체 ${전체}개`);
  check('초보 목록은 전체의 절반도 안 된다', 초보 * 2 <= 전체, `초보 ${초보} · 전체 ${전체}`);
}

// ── /model 로 연결·모델 바꾸기 ──────────────────────────────────────────
//
// 저장된 연결 하나에는 모델도 하나만 적혀 있다. 그런데 서버 한 대가 모델을
// 여럿 내주는 경우가 대부분이다 — 프록시나 게이트웨이가 특히 그렇다.
// 그동안은 서버는 그대로 두고 모델만 바꿀 방법이 없었다.
{
  const { createServer } = await import('node:http');
  const { save, load } = await import('../src/config.js');
  const { resetAll } = await import('../src/safety/network.js').catch(() => ({}));

  const srv = createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'gw-qwen-32b' }, { id: 'gw-llama-70b' }, { id: 'gw-small-3b' }] }));
    }
    res.writeHead(404); res.end('{}');
  });
  const port = await new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
  const base = `http://127.0.0.1:${port}/v1`;

  const 프로필 = (id, name, model) => ({
    id, name, kind: 'openai', baseUrl: base, auth: 'none', model,
    apiKey: '', ctx: 32768, streaming: false, tools: false, json: false, think: false, local: true,
  });
  // 통째로 덮어쓰지 않는다. 앞에서 /level 이 남긴 값까지 날아간다 —
  // 실제 설정 파일도 연결 말고 다른 것을 같이 담고 있기 때문이다.
  save({
    ...load(),
    active: 'gw-a',
    profiles: [프로필('gw-a', '사내 프록시 · gw-qwen-32b', 'gw-qwen-32b'), 프로필('local-b', '로컬 · small', 'gw-small-3b')],
  });

  const 세션 = () => {
    const s = 새세션();
    const cfg = load();
    const p = cfg.profiles[0];
    Object.assign(s.conn, { kind: p.kind, base: p.baseUrl, auth: p.auth, key: null, model: p.model, ctx: p.ctx });
    return s;
  };

  {
    const s = 세션();
    const r = await 조용히(() => handle('/model list', s, ctx));
    check('/model list 가 등록된 것을 보여준다', r.ok && /사내 프록시/.test(r.out) && /로컬 · small/.test(r.out), r.out.trim().split('\n')[1] ?? '');
    check('/model list 는 아무것도 안 바꾼다', s.conn.model === 'gw-qwen-32b', s.conn.model);
  }


  /*
   * ── `/model` 이 회사 토큰을 남의 창구로 들고 가지 않는가 ────────────────
   *
   * conn 을 짓는 자리가 넷인데(repl · oneshot · acp · 여기) 여기만 열쇠받기·
   * vision 을 안 옮기고 있었다. 그래서 회사 프로필에서 남의 프로필로 갈아타면
   * **옛 프로필의 살아 있는 SSO 토큰이 새 창구로 그대로 나갔다** — 새 프로필의
   * 제 열쇠는 쓰이지도 않은 채로(adapter.js 의 머리말짓기 는 열쇠받기가 있으면
   * 그쪽을 쓴다). 화면에는 「바꿨습니다. 대화는 이어집니다.」 한 줄뿐이었다.
   *
   * test/doorparity.test.js 가 글자로 잡고, 여기서는 값으로 잡는다.
   */
  {
    const 회사 = {
      ...프로필('corp-key', '회사 게이트웨이', 'gw-corp'),
      auth: 'bearer', apiKey: '',
      열쇠받기: { 명령: 'node -e "console.log(1)"', 수명: 3600 },
    };
    const 남의곳 = { ...프로필('vendor-key', '남의 창구', 'gw-vendor'), auth: 'bearer', apiKey: 'sk-vendor-BBBB' };
    save({ ...load(), active: 'corp-key', profiles: [회사, 남의곳] });

    const s = 새세션();
    // 회사 프로필로 시작한 모양을 만든다 — 다른 세 문이 하는 그대로.
    Object.assign(s.conn, {
      kind: 회사.kind, base: 회사.baseUrl, auth: 회사.auth, key: '', model: 회사.model,
      열쇠받기: 받기설정(회사, { 정책값: null }), vision: true,
    });
    check('먼저: 회사 프로필은 열쇠를 받아 오는 설정이다', !!s.conn.열쇠받기, String(!!s.conn.열쇠받기));

    await 조용히(() => handle('/model 남의', s, ctx));
    check('★★ /model 뒤에 주소가 새 창구다', s.conn.base === 남의곳.baseUrl, s.conn.base);
    check('★★ 옛 프로필의 열쇠받기가 안 따라온다', !s.conn.열쇠받기,
      JSON.stringify(s.conn.열쇠받기 ?? null));
    check('★★ 새 프로필의 제 열쇠를 쓴다', s.conn.key === 'sk-vendor-BBBB', String(s.conn.key));
    check('★★ vision 도 새 프로필 것이다', s.conn.vision === false, String(s.conn.vision));
    check('들고 있던 토큰도 버렸다', 지금열쇠상태() === null, JSON.stringify(지금열쇠상태()));

    // 반대쪽 — 맨 프로필에서 회사 프로필로 가면 받아오는 길이 열려야 한다.
    const s2 = 새세션();
    Object.assign(s2.conn, {
      kind: 남의곳.kind, base: 남의곳.baseUrl, auth: 남의곳.auth, key: 'sk-vendor-BBBB',
      model: 남의곳.model, 열쇠받기: null, vision: false,
    });
    await 조용히(() => handle('/model 회사', s2, ctx));
    check('★★ 반대쪽도 따라온다 — 열쇠받기가 열린다', !!s2.conn.열쇠받기,
      JSON.stringify(s2.conn.열쇠받기 ?? null));

    save({ ...load(), active: 'gw-a', profiles: [프로필('gw-a', '사내 프록시 · gw-qwen-32b', 'gw-qwen-32b'), 프로필('local-b', '로컬 · small', 'gw-small-3b')] });
  }

  {
    // 이름 일부만 쳐도 바뀌어야 한다. 매번 메뉴를 거치면 쓰기 번거롭다.
    const s = 세션();
    const r = await 조용히(() => handle('/model 로컬', s, ctx));
    check('/model <이름 일부> 로 바로 바꾼다', r.ok && s.conn.model === 'gw-small-3b', `${s.conn.model} · ${r.out.trim().split('\n')[0] ?? ''}`);
  }

  {
    // 등록 안 된 모델이라도, 서버가 내주면 쓸 수 있어야 한다.
    const s = 세션();
    const r = await 조용히(() => handle('/model gw-llama-70b', s, ctx));
    check('등록 안 된 모델도 서버에 있으면 바꾼다', r.ok && s.conn.model === 'gw-llama-70b', `${s.conn.model} · ${r.out.trim().split('\n')[0] ?? ''}`);
    check('서버 주소는 그대로다', s.conn.base === base, s.conn.base);
    const cfg2 = load();
    check('다음에도 쓰도록 남겨 둔다', cfg2.profiles.some((p) => p.model === 'gw-llama-70b'), cfg2.profiles.map((p) => p.model).join(', '));
    /*
     * ★ 남겨 두는 것만으로는 모자란다 — **지금 쓰는 것**으로도 못 박아야 한다.
     *
     * upsert 는 active 가 비었을 때만 채운다. 그래서 새 프로필을 넣기만 하고
     * active 는 옛 모델에 그대로 남았다. 화면은 「바꿨습니다」 인데 다음에 켜면
     * 옛 모델로 열리고, /model list 의 ● 도 옛것에 붙어 있다. 그 사이에 친
     * /ctx·/out 은 active 를 보고 **엉뚱한 프로필**에 값을 적는다.
     */
    const 지금것 = cfg2.profiles.find((p) => p.id === cfg2.active);
    check('★ 바꾼 모델이 다음에 켤 때의 것이 된다', 지금것?.model === 'gw-llama-70b',
      `active=${cfg2.active} → ${지금것?.model}`);
    const r2 = await 조용히(() => handle('/model list', s, ctx));
    const 지금줄 = r2.out.split('\n').find((l) => l.includes('●')) ?? '';
    check('★ 목록의 ● 도 바꾼 것에 붙는다', 지금줄.includes('gw-llama-70b'), 지금줄.trim());
  }

  {
    // 없는 것을 조용히 넘기면 오타를 눈치 못 챈다.
    const s = 세션();
    const r = await 조용히(() => handle('/model 없는모델이름xyz', s, ctx));
    check('없는 것은 없다고 말한다', /맞는 연결도 모델도 없습니다/.test(r.out), r.out.trim().split('\n')[0] ?? '');
    check('없으면 안 바꾼다', s.conn.model === 'gw-qwen-32b', s.conn.model);
  }

  {
    // 여럿에 걸리면 골라 달라고 해야 한다. 마음대로 하나를 고르면 안 된다.
    const s = 세션();
    const r = await 조용히(() => handle('/model gw-', s, ctx));
    check('여럿에 걸리면 골라 달라고 한다', /여럿입니다/.test(r.out), r.out.trim().split('\n')[0] ?? '');
    check('고르기 전에는 안 바꾼다', s.conn.model === 'gw-qwen-32b', s.conn.model);
  }

  {
    // 서버가 내주는 목록을 물어보는 길
    const s = 세션();
    const r = await 조용히(() => handle('/model models', s, ctx));
    check('/model models 가 서버에 물어본다', /gw-llama-70b/.test(r.out) || /모델 목록을 내주지 않습니다/.test(r.out), r.out.trim().split('\n').slice(0, 3).join(' / '));
  }

  /*
   * ── ★★ 규격이 다른 창구로 갈아타면 **대화도 그 규격으로** 옮겨 적는다 ──────
   *
   * 연결적용() 은 「대화는 그대로 둔다」 였다. 규격이 같을 때는 맞는 말이다.
   * 다르면 옛 모양이 그대로 나간다 — OpenAI 이력을 Anthropic 창구로 보내면
   * `role:'tool'`·`content:null` 이, 그 반대면 tool_use·tool_result 블록이,
   * Ollama 이력을 OpenAI 로 보내면 id 없는 부름이 나가서 첫 마디가 400 이다.
   * 화면에는 「대화는 이어집니다」 가 적힌 채로.
   */
  {
    const 빼기 = (x) => String(x).replace(/\x1b\[[0-9;]*m/g, '');
    const 앤 = { ...프로필('anth-c', '앤트로픽 창구', 'claude-x'), kind: 'anthropic', baseUrl: base.replace(/\/v1$/, '') };
    save({ ...load(), active: 'gw-a', profiles: [프로필('gw-a', '사내 프록시 · gw-qwen-32b', 'gw-qwen-32b'), 앤] });

    const s = 세션();
    s.messages = [
      { role: 'user', content: '읽어줘' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"a.txt"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'hello' },
      { role: 'assistant', content: '다 읽었습니다' },
    ];
    const r = await 조용히(() => handle('/model 앤트로픽', s, ctx));
    check('먼저: 앤트로픽 창구로 바뀌었다', s.conn.kind === 'anthropic', s.conn.kind);
    const 옛모양 = s.messages.filter((m) => !['user', 'assistant'].includes(m.role) || m.content == null || m.tool_calls);
    check('★★ OpenAI → Anthropic: tool 역할·null content·tool_calls 가 안 남는다', 옛모양.length === 0, JSON.stringify(옛모양).slice(0, 200));
    const 부름 = s.messages.find((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_use'));
    const 결과 = s.messages.find((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'));
    check('★★ 부름과 결과가 새 규격에서도 짝이다',
      부름?.content.find((b) => b.type === 'tool_use')?.id === 'c1' && 결과?.content[0]?.tool_use_id === 'c1' && 결과?.content[0]?.content === 'hello',
      JSON.stringify([부름, 결과]).slice(0, 240));
    check('★ 옮겨 적었다고 화면에 말한다', /새 규격으로 옮겨 적었습니다/.test(빼기(r.out)), 빼기(r.out).trim().split('\n').slice(0, 3).join(' / '));

    const r2 = await 조용히(() => handle('/model 사내', s, ctx));
    check('먼저: 다시 OpenAI 호환으로 바뀌었다', s.conn.kind === 'openai', s.conn.kind);
    const 블록 = s.messages.filter((m) => Array.isArray(m.content));
    const 부름2 = s.messages.find((m) => m.tool_calls?.length);
    check('★★ Anthropic → OpenAI: 블록이 안 남고 id·문자열 인자로 돌아온다',
      블록.length === 0 && 부름2?.tool_calls[0].id === 'c1' && typeof 부름2?.tool_calls[0].function.arguments === 'string'
      && s.messages.some((m) => m.role === 'tool' && m.tool_call_id === 'c1'),
      JSON.stringify(s.messages).slice(0, 300));
    check('같은 말이 두 번 옮겨도 그대로다', s.messages.at(-1)?.content === '다 읽었습니다' && s.messages[0].content === '읽어줘',
      빼기(r2.out).trim().split('\n')[0]);

    // Ollama 이력은 부름에 id 가 없다. OpenAI 로 가면 id 를 지어 결과와 짝지어야 한다.
    const s3 = 세션();
    s3.conn.kind = 'ollama';
    s3.messages = [
      { role: 'user', content: '읽어줘' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'Read', arguments: { file_path: 'a.txt' } } }, { function: { name: 'Grep', arguments: { pattern: 'x' } } }] },
      { role: 'tool', tool_name: 'Read', content: 'hi' },
      { role: 'tool', tool_name: 'Grep', content: 'g' },
    ];
    await 조용히(() => handle('/model 사내', s3, ctx));
    const 부름3 = s3.messages.find((m) => m.tool_calls?.length);
    const 결과3 = s3.messages.filter((m) => m.role === 'tool');
    check('★★ Ollama → OpenAI: 부름마다 id 가 붙고 결과가 차례대로 그 id 를 가리킨다',
      부름3?.tool_calls.length === 2 && 부름3.tool_calls.every((t) => t.id && typeof t.function.arguments === 'string')
      && 결과3.length === 2 && 결과3[0].tool_call_id === 부름3.tool_calls[0].id && 결과3[1].tool_call_id === 부름3.tool_calls[1].id
      && 결과3[1].content === 'g',
      JSON.stringify(s3.messages).slice(0, 300));

    save({ ...load(), active: 'gw-a', profiles: [프로필('gw-a', '사내 프록시 · gw-qwen-32b', 'gw-qwen-32b'), 프로필('local-b', '로컬 · small', 'gw-small-3b')] });
  }

  srv.closeAllConnections?.();
  srv.close();
  await new Promise((r) => setImmediate(r));
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

trace('3.5-못박기를실제로눌러본다');

// ── /pin 을 실제로 눌러 본다 ────────────────────────────────────────────
//
// pins.test.js 는 부품을 잰다. 여기서는 **사람이 치는 그대로** 눌러 본다 —
// 명령이 세션에 실제로 닿는지, 화면에 무엇이 뜨는지.
{
  const s = 새세션();

  const 박기 = await 조용히(() => handle('/pin 운영 DB 는 건드리지 마라', s, ctx));
  check('/pin 으로 못 박힌다', s.못박은것.개수() === 1, `${s.못박은것.개수()}개`);
  check('박은 것을 화면에 보여 준다', /운영 DB/.test(박기.out), 박기.out.trim().slice(0, 60));
  check('빼는 방법을 같이 알려 준다', /\/pin 지우기/.test(박기.out));

  const 프롬프트 = s.systemPrompt();
  check('박자마자 프롬프트에 실린다', 프롬프트.includes('운영 DB 는 건드리지 마라'));
  check('프롬프트 맨 끝에 온다 — 가운데는 흘려 읽힌다',
    프롬프트.lastIndexOf('운영 DB') > 프롬프트.length - 400,
    `끝에서 ${프롬프트.length - 프롬프트.lastIndexOf('운영 DB')}자`);

  const 목록 = await 조용히(() => handle('/pin', s, ctx));
  check('인자 없이 치면 목록이 뜬다', /운영 DB/.test(목록.out) && /1\./.test(목록.out));
  check('자리를 얼마나 먹는지 알려 준다', /토큰/.test(목록.out), 목록.out.trim().slice(-80));
  check('실리는 개수를 정확히 센다', /지금 1개/.test(목록.out),
    (목록.out.match(/지금 \d+개/) ?? ['못 찾음'])[0]);

  // /clear 는 대화를 비운다. 못 박은 것까지 비우면 안 된다.
  await 조용히(() => handle('/clear', s, ctx));
  check('/clear 로 대화를 비워도 못 박은 것은 남는다', s.못박은것.개수() === 1,
    `${s.못박은것.개수()}개`);
  check('비운 뒤에도 프롬프트에 실린다', s.systemPrompt().includes('운영 DB'));

  const 빼기 = await 조용히(() => handle('/pin 지우기 1', s, ctx));
  check('/pin 지우기 로 뺀다', s.못박은것.개수() === 0, 빼기.out.trim().slice(0, 60));
  check('뺀 뒤엔 프롬프트에서도 사라진다', !s.systemPrompt().includes('운영 DB'));
}

// ── 설정을 못 남기면 ✓ 옆에 그 말도 같이 뜬다 ──────────────────────────
//
// 여태 아홉 자리가 전부 `try { save(cfg) } catch {}` 였다. 못 남겨도 이번 판에는
// 먹으니 대화는 계속되는데, 바로 다음 줄에서 화면은 「✓ 바꿨습니다」 를 찍는다.
// 사람은 정해진 줄 알고 창을 닫았다가 다음에 옛 값을 보고, 그때는 무엇 때문인지
// 알 길이 없다.
{
  const 원래집 = process.env.DEEL_HOME;
  // 설정 폴더 자리에 파일을 놓아 쓰기를 막는다 — 홈이 읽기 전용인 것과 같은 모양.
  const 막힌집 = mkdtempSync(join(tmpdir(), 'deel-cmd-설정막힘-'));
  writeFileSync(join(막힌집, '여기는파일'), '폴더가 아니다', 'utf8');
  process.env.DEEL_HOME = join(막힌집, '여기는파일', '안쪽');
  const 막혔을때 = await 조용히(() => handle('/bell off', 새세션(), ctx));
  process.env.DEEL_HOME = 원래집;

  check('설정을 못 남기면 화면이 그렇게 말한다', 막혔을때.out.includes('남기지 못했습니다'),
    막혔을때.out.trim().split('\n').join(' / ') || '한 줄도 없음');
  check('이번 판에는 먹는다는 것도 같이 말한다', 막혔을때.out.includes('이번 판에는 먹지만'));

  const 멀쩡할때 = await 조용히(() => handle('/bell on', 새세션(), ctx));
  check('잘 남기면 아무 말도 안 한다', !멀쩡할때.out.includes('남기지 못했습니다'),
    멀쩡할때.out.trim().split('\n')[0] ?? '');
  rmSync(막힌집, { recursive: true, force: true });
}

// ── /status 는 규칙 파일을 못 읽었으면 '없음' 이라고 하지 않는다 ─────────
//
// 있는데 못 읽는 것을 없는 것과 같이 적으면, 규칙을 적어 둔 사람은 걸려 있다고
// 믿는다. 「운영 DB 는 건드리지 마라」 를 적어 놓고 안 걸린 채로 도는 것이
// 여기서 나올 수 있는 제일 나쁜 모양이다.
{
  const 막힌방 = mkdtempSync(join(tmpdir(), 'deel-cmd-규칙-'));
  mkdirSync(join(막힌방, 'DEEL.md'), { recursive: true });   // 이름만 같은 폴더 → EISDIR
  const s = new Session(conn, { root: 막힌방, mode: 'auto', think: 'medium', effort: 'save' });
  const r = await 조용히(() => handle('/status', s, ctx));
  check('/status 가 못 읽은 규칙 파일을 말한다', r.out.includes('못 읽었습니다'),
    r.out.split('\n').find((l) => l.includes('DEEL.md')) ?? '한 줄도 없음');
  check('까닭도 같이 적는다', r.out.includes('EISDIR'));

  const 멀쩡 = await 조용히(() => handle('/status', 새세션(), ctx));
  check('규칙이 없을 뿐이면 경고는 안 뜬다', !멀쩡.out.includes('못 읽었습니다'));
  rmSync(막힌방, { recursive: true, force: true });
}

// ── /status 는 어차피 안 거칠 주소에 못 쓰는 프록시를 말하지 않는다 ─────
//
// 루프백 모델에 붙어 있는데 「프록시 못 씀 — socks5…」 가 뜨면, 안 붙는 까닭을 찾는 사람이
// 상관없는 프록시를 고치러 간다. 바깥 주소에는 그대로 떠야 한다 (2.0.0 6회차 RP1b).
{
  const 못쓰는 = { env: { HTTPS_PROXY: 'socks5://127.0.0.1:1080' } };
  프록시정하기(못쓰는);
  const 로컬판 = await 조용히(() => handle('/status', new Session({ ...conn, base: 'http://127.0.0.1:11434/v1' }, { root, mode: 'auto', think: 'medium', effort: 'save' }), ctx));
  프록시정하기(못쓰는);
  const 바깥판 = await 조용히(() => handle('/status', new Session({ ...conn, base: 'https://gw.example.net/v1' }, { root, mode: 'auto', think: 'medium', effort: 'save' }), ctx));
  프록시지우기();
  check('/status 는 루프백 주소에 못 쓰는 프록시 줄을 안 낸다', !/socks5/.test(로컬판.out), 로컬판.out.split('\n').find((l) => /socks5/.test(l)) ?? '');
  check('/status 는 바깥 주소에는 못 쓰는 프록시 줄을 낸다', /socks5/.test(바깥판.out), 바깥판.ok ? '줄 없음' : String(바깥판.e));
}

// ── /sessions 는 저장이 새고 있으면 약속을 되풀이하지 않는다 ────────────
//
// 이 화면 마지막 줄이 「지금 대화는 나가지 않아도 계속 저장되고 있습니다」 다.
// 디스크가 차거나 홈이 읽기 전용이면 그 줄이 거짓이 되는데, 여태 그래도 똑같이
// 찍혔다. 이어하기를 보러 온 화면이라 여기서 안 말하면 알 자리가 없다.
{
  const 성한 = new Store(root, '멀쩡');
  성한.begin({ model: 'm', root });
  성한.append({ role: 'user', content: '뭐 하나 고쳐줘' });

  const s = 새세션();
  const 잘될때 = await 조용히(() => handle('/sessions', s, { ...ctx, 갈래: { 현재store: () => 성한 } }));
  check('저장이 멀쩡하면 계속 저장된다고 말한다', 잘될때.out.includes('계속 저장되고 있습니다'),
    잘될때.out.trim().split('\n').at(-1) ?? '');
  check('멀쩡할 때는 경고를 안 띄운다', !잘될때.out.includes('안 적히고 있습니다'));

  // 대화 파일 자리에 폴더를 놓아 쓰기를 막는다 — 어느 OS 에서나 EISDIR 이 난다.
  mkdirSync(join(sessionsDir(root), '막힘.jsonl'), { recursive: true });
  const 막힌 = new Store(root, '막힘');
  막힌.begin({ model: 'm', root });
  막힌.append({ role: 'user', content: '이건 안 적힌다' });

  const 샐때 = await 조용히(() => handle('/sessions', s, { ...ctx, 갈래: { 현재store: () => 막힌 } }));
  check('저장이 새면 화면이 그렇게 말한다', 샐때.out.includes('안 적히고 있습니다'),
    샐때.out.trim().split('\n').at(-1) ?? '');
  check('까닭도 같이 적는다', 샐때.out.includes('EISDIR'));
  check('샐 때는 저장된다는 약속을 되풀이하지 않는다', !샐때.out.includes('계속 저장되고 있습니다'));
}

trace('3.8-8회차-명령갈래');

// ── /memory 는 **대문자로 쳐도** 같은 일을 해야 한다 (8회차 그밖 명령1) ──
//
// 지우는 무늬 둘만 `i` 가 빠져 있었다. 그래서 `/memory RM 1` 은 안 지우고,
// `/memory CLEAR` 는 **지우려던 말이 기억으로 적혔다.** 목록에 `3 CLEAR` 가
// 남는다. 지우려던 사람이 쓰레기를 하나 더 심는 꼴이고, 그것도 성공 표시를
// 보면서 그렇게 된다 — 이 case 가 제일 피하려던 결말 그대로다.
{
  const M = await import('../src/agent/memory.js');
  const s = 새세션();
  M.비우기(root);
  M.더하기(root, '가나다');
  M.더하기(root, '라마바');

  const 큰지움 = await 조용히(() => handle('/memory RM 1', s, ctx));
  check('★ /memory RM 1 이 소문자와 똑같이 지운다',
    JSON.stringify(M.읽기(root).줄들) === JSON.stringify(['라마바']),
    JSON.stringify(M.읽기(root).줄들) + ' · ' + (큰지움.out.trim().split('\n')[0] ?? ''));

  const 큰비움 = await 조용히(() => handle('/memory CLEAR', s, ctx));
  check('★★ /memory CLEAR 가 기억으로 적히지 않는다',
    !M.읽기(root).줄들.includes('CLEAR'), JSON.stringify(M.읽기(root).줄들));
  check('★ /memory CLEAR 가 실제로 비운다', M.읽기(root).줄들.length === 0,
    JSON.stringify(M.읽기(root).줄들) + ' · ' + (큰비움.out.trim().split('\n')[0] ?? ''));

  M.비우기(root);
}

// ── 꼬리 이름에 대문자가 들어도 찾아진다 (8회차 그밖 명령2 · oneshot.js:495 와 쌍둥이) ──
//
// 찾는 마지막 칸이 `x.name.split(':').pop() === name` 이었다. 왼쪽은 파일에
// 적힌 그대로고 오른쪽은 낮춘 말이라 둘이 만날 수가 없다. `ext:ReviewCode` 는
// `/ReviewCode` 로도 `/reviewcode` 로도 「모르는 명령」 이었고, 「비슷한 것」
// 에도 안 떴다 — 있는 명령을 어디에도 안 보여 주는 자리다.
{
  const 명령파일 = join(root, 'ReviewCode.md');
  writeFileSync(명령파일, '코드를 검토해라.\n', 'utf8');
  const 목록 = [{ name: 'ext:ReviewCode', description: '', path: 명령파일, source: 'plugin', enabled: true }];

  for (const 친것 of ['/ReviewCode', '/reviewcode']) {
    const s = 새세션();
    s.commands = 목록;
    const r = await 조용히(() => handle(친것, s, ctx));
    check(`★★ 꼬리에 대문자가 든 명령을 ${친것} 로 편다`,
      r.v?.handled === false && /코드를 검토해라/.test(r.v?.text ?? ''),
      `handled=${r.v?.handled} · ${r.out.trim().split('\n')[0] ?? ''}`);
  }

  // 여태 되던 두 가지는 그대로 돼야 한다.
  for (const 친것 of ['/ext:ReviewCode', '/ext:reviewcode']) {
    const s = 새세션();
    s.commands = 목록;
    const r = await 조용히(() => handle(친것, s, ctx));
    check(`${친것} 는 그대로 펴진다`, r.v?.handled === false && /코드를 검토해라/.test(r.v?.text ?? ''),
      `handled=${r.v?.handled}`);
  }

  // 붙박이가 먼저다 — 꼬리를 낮춰 견주게 됐다고 `/help` 가 남의 것이 되면 안 된다.
  {
    const s = 새세션();
    s.commands = [{ name: 'ext:HELP', description: '', path: 명령파일, source: 'plugin', enabled: true }];
    const r = await 조용히(() => handle('/help', s, ctx));
    check('★ 꼬리가 붙박이 이름과 같아도 붙박이가 이긴다', r.v?.handled === true,
      `handled=${r.v?.handled}`);
  }
}

// ── `/pin 지우기 전에 백업 필수` 는 **규칙**이지 지우기가 아니다 (8회차 그밖 명령5) ──
//
// 머리 낱말만 보고 지우기로 샜다. 「지우기」 로 시작하는 규칙은 못이 안 박히고,
// 화면에는 「번호를 적거나 `전부` 라고 하세요」 가 떴다. 사람은 박힌 줄 알고
// 넘어가거나, 왜 안 박혔는지 모른 채 다시 친다.
{
  const s = 새세션();
  const r = await 조용히(() => handle('/pin 지우기 전에 백업 필수', s, ctx));
  check('★★ 「지우기」 로 시작하는 규칙이 못으로 박힌다',
    s.못박은것.목록().some((x) => x.말 === '지우기 전에 백업 필수'),
    JSON.stringify(s.못박은것.목록()) + ' · ' + (r.out.trim().split('\n')[0] ?? ''));

  // 진짜 지우기는 그대로 돼야 한다.
  await 조용히(() => handle('/pin 지우기 1', s, ctx));
  check('번호를 준 지우기는 그대로 지운다', s.못박은것.개수() === 0, `${s.못박은것.개수()}개`);

  await 조용히(() => handle('/pin 가', s, ctx));
  await 조용히(() => handle('/pin 나', s, ctx));
  await 조용히(() => handle('/pin 지우기', s, ctx));
  check('번호 없는 지우기는 그대로 전부 지운다', s.못박은것.개수() === 0, `${s.못박은것.개수()}개`);

  await 조용히(() => handle('/pin 다', s, ctx));
  await 조용히(() => handle('/pin 지우기 전부', s, ctx));
  check('「지우기 전부」 도 그대로 전부 지운다', s.못박은것.개수() === 0, `${s.못박은것.개수()}개`);
}

// ── 이미 띄운 미리보기를 다시 불러도 **같은 주소**를 준다 (8회차 그밖 명령4) ──
//
// 파일 하나를 주고 띄우면 주소 끝에 그 파일이 붙는다. 그런데 그 뒤 `/preview`
// 를 그냥 치면 파일이 빠진 폴더 주소를 알려 주고 브라우저도 그리로 열었다.
// 사람은 방금 보던 것을 다시 못 찾는다.
{
  const 곳 = mkdtempSync(join(tmpdir(), 'deel-cmd-미리보기-'));
  writeFileSync(join(곳, '보고서.html'), '<h1>보고서</h1>', 'utf8');
  const ctx2 = { ...ctx, scope: makeScope(곳) };
  const s = 새세션();

  const 처음 = await 조용히(() => handle('/preview 보고서.html', s, ctx2));
  const 첫주소 = (처음.out.match(/http:\/\/127\.0\.0\.1:\d+\/\S*/) ?? [''])[0];
  check('파일을 주면 그 파일까지 가리키는 주소가 나온다', /%/.test(첫주소), 첫주소 || '(주소 없음)');

  const 다시 = await 조용히(() => handle('/preview', s, ctx2));
  const 둘째주소 = (다시.out.match(/http:\/\/127\.0\.0\.1:\d+\/\S*/) ?? [''])[0];
  check('★★ 다시 불러도 같은 주소를 준다', 둘째주소 === 첫주소,
    `처음 ${첫주소} · 다시 ${둘째주소}`);

  await 미리보기끄기();
  rmSync(곳, { recursive: true, force: true });
}

// ── 턴을 **먹고도** 「되돌릴 것이 없습니다」 라고 하지 않는다 (8회차 그밖 한번더) ──
//
// 만든 파일을 사람이 손으로 지운 턴은 되돌릴 것이 하나도 없다. 그런데 undo() 는
// 그 턴을 이력에서 **지운다.** 화면은 「되돌릴 것이 없습니다.」 한 줄이라 사람은
// 아무 일도 안 난 줄 안다 — 다음 /undo 는 그 앞 턴을 되돌린다. 두 번 쳐서 한 턴만
// 되돌아간다.
{
  const 되돌림뿌리 = mkdtempSync(join(tmpdir(), 'deel-cmd-되돌림-'));
  const h = new History(되돌림뿌리);
  const ctx3 = { scope: makeScope(되돌림뿌리), history: h, audit: new Audit(되돌림뿌리), seen: new Set() };
  const s = 새세션();

  const 가 = join(되돌림뿌리, '가.txt');
  writeFileSync(가, '처음\n', 'utf8');
  h.nextTurn();
  h.snapshot(가, 'Edit');
  writeFileSync(가, '고쳐짐\n', 'utf8');

  const 나 = join(되돌림뿌리, '나.txt');
  h.nextTurn();
  h.없던자리기록(나, 'Write');
  writeFileSync(나, '새것\n', 'utf8');
  rmSync(나, { force: true });

  const 첫 = await 조용히(() => handle('/undo', s, ctx3));
  check('★★ 턴을 봤으면 「되돌릴 것이 없습니다」 라고 하지 않는다',
    !/되돌릴 것이 없습니다/.test(첫.out), 첫.out.trim().split('\n')[0] ?? '(빈 화면)');
  check('★ 그 턴이 이력에서 빠졌다고 말한다',
    /이력|기록/.test(첫.out) && /1개 턴|턴 1개/.test(첫.out), 첫.out.trim().replace(/\s+/g, ' ').slice(0, 140));
  check('파일은 그대로 둔 채다', readFileSync(가, 'utf8') === '고쳐짐\n', JSON.stringify(readFileSync(가, 'utf8')));

  rmSync(되돌림뿌리, { recursive: true, force: true });
}

// 모든 명령이 목록에 설명을 갖고 있나 — 새로 넣고 빠뜨리기 쉬운 자리다.
for (const [n, v] of Object.entries(COMMANDS)) {
  check(`/${n} 에 설명이 있다`, typeof v.desc === 'string' && v.desc.length > 0, JSON.stringify(v));
}

trace('4-치움');
trace('딴이름표');

/*
 * `commands.js` 가 받아 주는 이름이 전부 표에 적혀 있나.
 *
 * 「이게 명령 이름인가」 를 묻는 자리(`경로처럼보이나`)는 표만 본다. 표에 없는
 * 딴이름을 스위치에만 적어 두면, 그 이름과 같은 **폴더가 있는 저장소**에서
 * 그 명령이 경로로 읽혀 안 돌고 모델에게 그대로 넘어간다. 실제로 `/serve` 와
 * `/plugins` 가 그랬다.
 */
{
  const 소스 = readFileSync(new URL('../src/commands.js', import.meta.url), 'utf8');
  const 이름 = [...new Set([...소스.matchAll(/^\s*case '([a-z0-9-]+)':/gm)].map((m) => m[1]))];
  const 빠진것 = 이름.filter((n) => !명령들[n] && !딴이름들[n]);
  check('★★★ commands.js 가 받는 이름이 전부 이름표나 딴이름표에 있다',
    빠진것.length === 0, 빠진것.length ? 빠진것.join(' · ') : `${이름.length}개`);

  // 딴이름은 실제로 있는 정식 이름을 가리켜야 한다 — 오타를 잡는다.
  const 엉뚱 = Object.entries(딴이름들).filter(([, 정식]) => !명령들[정식]);
  check('★★ 딴이름이 가리키는 정식 이름이 전부 이름표에 있다',
    엉뚱.length === 0, 엉뚱.map(([a, b]) => `${a}→${b}`).join(' · '));
}

/*
 * 딴이름을 **실제로 눌러** 본다.
 *
 * 위 두 검사는 표끼리 맞춰 볼 뿐이라, `경로처럼보이나` 가 딴이름표를 다시
 * 안 보게 고쳐도 초록으로 남는다. 그래서 같은 이름의 폴더가 있는 자리에서
 * 눌러 본다 — `plugins/` 를 둔 곳에서 `/plugins` 가 경로로 읽히면 명령이
 * 안 돌고 모델에게 그대로 넘어간다.
 */
{
  const 딴이름터 = mkdtempSync(join(tmpdir(), 'deel-cmd-딴이름-'));
  mkdirSync(join(딴이름터, 'plugins'));
  const 원래폴더 = process.cwd();
  try {
    process.chdir(딴이름터);
    const r = await 조용히(() => handle('/plugins', 새세션(), { ...ctx, scope: makeScope(딴이름터) }));
    check('★★★ `plugins/` 폴더가 있어도 `/plugins` 는 명령으로 돈다',
      r.ok && r.v?.handled === true, r.ok ? `handled=${r.v?.handled}` : String(r.e));
  } finally {
    process.chdir(원래폴더);
    rmSync(딴이름터, { recursive: true, force: true });
  }
}

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
