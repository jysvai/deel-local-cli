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
  check('/think 기본이 짧다', 글.trim().split('\n').length <= 3, String(글.trim().split('\n').length));

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
