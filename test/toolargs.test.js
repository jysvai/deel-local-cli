// 도구 인자 이름 — 서버가 받아 주는 이름인가.
//
// ── 무엇이 문제였나 ─────────────────────────────────────────────────────
//
// 사내 게이트웨이(LiteLLM → Bedrock)에 붙자마자 첫 한마디가 통째로 튕겼다.
//
//   ✗ BedrockException — tools.10.custom.input_schema.properties:
//     Property keys should match pattern '^[a-zA-Z0-9_.-]{1,64}$'
//
// 도구 설명서의 **인자 이름**이 한글이었다. 세 도구, 여덟 군데.
// `tools.10` 은 정확히 `Ask` 였고 그 인자 이름이 `이해` 였다.
//
// 이 이름은 우리끼리 쓰는 것이 아니라 **설명서에 실려 서버로 나간다.**
// 로컬 모델도 OpenAI 호환 서버도 이 검사를 안 해서, 바깥에 붙어 보기
// 전까지는 아무 데서도 안 걸렸다.
//
// ── 무엇을 지키나 ───────────────────────────────────────────────────────
//
//   1. 모든 도구의 인자 이름이 서버가 받는 꼴이다 (중첩된 것까지).
//   2. 도구 이름 자체도 그렇다.
//   3. 옛 한글 이름으로 불러도 그대로 돈다 — 이름을 바꾼 것은 서버가
//      검사하기 때문이지 뜻이 달라져서가 아니다.
//   4. 화면 이름표가 영문 이름으로 와도 안 빈다. ★ 이게 조용히 깨지는 자리다.
//   5. 영어 화면에서 인자 설명이 빠지지 않는다 — 설명 표가 이름으로 걸린다.
import { readFileSync } from 'node:fs';
import { TOOLS, 영어설명 } from '../src/tools/index.js';
import { 도구설명EN } from '../src/tools/desc.en.js';
import { 일감인자 } from '../src/tools/jobs.js';
import { 이름칸들, 첫이름 } from '../src/tools/label.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// Bedrock 이 실제로 쓰는 무늬. 여기 적힌 그대로다 — 우리가 좁혀 잡은 것이 아니다.
const 인자무늬 = /^[a-zA-Z0-9_.-]{1,64}$/;
// 도구 이름은 점이 빠진다.
const 이름무늬 = /^[a-zA-Z0-9_-]{1,64}$/;

trace('1-인자-이름');

// ── 서버가 받는 꼴인가 ──────────────────────────────────────────────────
{
  const 걸린것 = [];
  function 훑기(node, 길, 도구) {
    if (!node || typeof node !== 'object') return;
    if (node.properties && typeof node.properties === 'object') {
      for (const k of Object.keys(node.properties)) {
        if (!인자무늬.test(k)) 걸린것.push(`${도구}${길}.${k}`);
        훑기(node.properties[k], `${길}.${k}`, 도구);
      }
    }
    // 배열 안쪽·갈래 안쪽도 본다. Write 의 files, Edit 의 edits 가 그렇다 —
    // 겉만 보면 통과하는데 서버는 안까지 본다.
    if (node.items) 훑기(node.items, `${길}[]`, 도구);
    for (const k of ['anyOf', 'oneOf', 'allOf']) {
      if (Array.isArray(node[k])) node[k].forEach((x, i) => 훑기(x, `${길}.${k}${i}`, 도구));
    }
  }
  for (const [n, t] of Object.entries(TOOLS)) 훑기(t.schema?.parameters ?? {}, '', n);

  check('★ 모든 도구의 인자 이름이 서버가 받는 꼴이다', 걸린것.length === 0, 걸린것.join(' '));
  check('★ 도구 이름도 그렇다',
    Object.keys(TOOLS).every((n) => 이름무늬.test(n)),
    Object.keys(TOOLS).filter((n) => !이름무늬.test(n)).join(' '));

  // 필수 인자 목록도 인자 이름을 가리킨다. 여기만 옛 이름이 남으면 서버는
  // "없는 인자를 필수라고 한다" 고 거절한다.
  const 헛것 = [];
  for (const [n, t] of Object.entries(TOOLS)) {
    const p = t.schema?.parameters?.properties ?? {};
    for (const r of t.schema?.parameters?.required ?? []) if (!(r in p)) 헛것.push(`${n}.${r}`);
  }
  check('★ 필수 목록이 있는 인자를 가리킨다', 헛것.length === 0, 헛것.join(' '));

  // 재 보는 무늬가 진짜 그 무늬인지. 여기서 느슨하게 잡아 두면 위 검사가
  // 통과해도 서버는 튕긴다.
  check('무늬가 한글을 거른다', !인자무늬.test('이해') && !인자무늬.test('목적'));
  check('무늬가 보통 이름은 받는다',
    ['file_path', 'from_start', 'head_limit', 'a.b', 'x-1'].every((k) => 인자무늬.test(k)));
  check('무늬가 빈 것과 64자 넘는 것을 거른다',
    !인자무늬.test('') && !인자무늬.test('a'.repeat(65)) && 인자무늬.test('a'.repeat(64)));
}

trace('2-바뀐-이름');

// ── 바뀐 자리가 실제로 바뀌었나 ─────────────────────────────────────────
{
  const 있나 = (도구, 키) => 키 in (TOOLS[도구]?.schema?.parameters?.properties ?? {});
  check('Ask 가 understanding 을 쓴다', 있나('Ask', 'understanding') && !있나('Ask', '이해'));
  check('Task 가 purpose·task·mode·model 을 쓴다',
    ['purpose', 'task', 'mode', 'model'].every((k) => 있나('Task', k)));
  check('Jobs 가 job·stop·from_start 를 쓴다',
    ['job', 'stop', 'from_start'].every((k) => 있나('Jobs', k)));

  /*
   * 설명글이 인자를 이름으로 부르는 자리.
   *
   * "먼저 `이해` 에 적어라" 라고 적어 놓고 인자 이름은 understanding 이면,
   * 모델은 설명대로 `이해` 를 채우고 그 인자는 버려진다. 도구는 도는데
   * 하라는 일을 안 한 것처럼 보인다.
   */
  const 글 = [TOOLS.Ask, TOOLS.Task, TOOLS.Jobs]
    .map((t) => t.schema.description + JSON.stringify(t.schema.parameters)).join('\n');
  check('★ 설명글이 옛 이름을 안 부른다',
    !/`이해`|할일 안에|번호 없이|끝내기로/.test(글),
    (글.match(/`이해`|할일 안에|번호 없이|끝내기로/) ?? [''])[0]);
}

trace('3-옛-이름도-돈다');

// ── 옛 이름으로 불러도 그대로 도나 ──────────────────────────────────────
//
// 이름을 바꾼 것은 서버가 검사하기 때문이지 뜻이 달라져서가 아니다.
// 옛 이름으로 부르던 검사·스크립트·모델이 조용히 멈추면 안 된다.
{
  check('Jobs 가 옛 이름을 받는다', 일감인자({ 번호: 3, 끝내기: true }).번호 === 3
    && 일감인자({ 번호: 3, 끝내기: true }).끝내기 === true);
  check('Jobs 가 새 이름을 받는다', 일감인자({ job: 7, stop: true, from_start: true }).번호 === 7
    && 일감인자({ job: 7, from_start: true }).처음부터 === true);
  check('둘 다 오면 새 이름이 이긴다 — 설명서에 실리는 것이 그쪽이다',
    일감인자({ job: 9, 번호: 1 }).번호 === 9, String(일감인자({ job: 9, 번호: 1 }).번호));

  const src = readFileSync(new URL('../src/tools/index.js', import.meta.url), 'utf8');
  check('★ Ask 가 옛 이름도 읽는다', /args\.understanding \?\? args\.이해/.test(src));

  const loop = readFileSync(new URL('../src/agent/loop.js', import.meta.url), 'utf8');
  for (const [새, 옛] of [['purpose', '목적'], ['task', '할일'], ['mode', '모드'], ['model', '모델']]) {
    check(`Task 의 ${새} 가 옛 이름보다 먼저`,
      new RegExp(`call\\.args\\?\\.${새} \\?\\? call\\.args\\?\\.${옛}`).test(loop));
  }
}

trace('4-화면-이름표');

/*
 * ── 조용히 깨지는 자리 ──────────────────────────────────────────────────
 *
 * 화면에 도구 이름표를 그릴 때 인자 하나를 골라 괄호에 적는다. 그 자리가
 * 옛 이름만 보면 **도구는 제대로 도는데 화면만 빈 괄호**가 된다. 오류도
 * 안 나고 검사도 안 걸린다 — 사람이 화면을 보다가 이상하다고 느껴야 안다.
 *
 * 같은 함정을 Jobs 에서 이미 한 번 겪어서 repl.js 주석에 적혀 있다.
 * 그때는 별칭 표(일감인자)로 막았다.
 *
 * ── 이 검사가 어떻게 바뀌었나 ───────────────────────────────────────────
 *
 * 여기는 여섯 파일을 열어 `a.name ?? a.purpose ?? a.목적` 라는 **글자**를
 * 찾고 있었다. 그 글자가 다섯 벌이었다는 것 자체가 고칠 거리였고(어떤 벌에는
 * url 이 있고 어떤 벌에는 없었다), 지금은 tools/label.js 한 곳에 모여 있다.
 *
 * 그러니 여기서도 **글자 대신 뜻**을 잰다 — 「그 자리가 새 이름을 보는가」.
 * 소스 글자를 못 박으면, 고쳐서 나아진 코드 앞에서 검사가 빨개진다. 그러면
 * 사람은 코드를 되돌리거나 검사를 지우는데, 둘 다 손해다.
 */
{
  // 목록이 새 이름과 옛 이름을 **둘 다** 알고, 새 이름이 앞이다.
  const p = 이름칸들.indexOf('purpose');
  const k = 이름칸들.indexOf('목적');
  check('★ 이름표 목록이 새 이름을 안다', p >= 0, 이름칸들.join(' '));
  check('★ 옛 이름도 여전히 안다 — 옛 이름으로 부르는 모델이 있다', k >= 0, 이름칸들.join(' '));
  check('★ 둘 다 오면 새 이름이 이긴다 — 설명서에 실리는 것이 그쪽이다',
    p >= 0 && k >= 0 && p < k && 첫이름({ 목적: '옛', purpose: '새' }) === '새', `${p} < ${k}`);

  // 그리고 그 자리들이 정말 이 목록을 쓰는가. 파일 하나가 제 목록을 다시
  // 적으면 그 파일만 낡는다 — 그것을 막는 검사는 test/label.test.js 에 있고,
  // 여기서는 「그 자리가 이 자를 쥐고 있나」 만 본다.
  const 자리들 = [
    'src/repl.js', 'src/oneshot.js', 'src/acp/map.js', 'src/ui/export.js', 'src/safety/audit.js',
  ];
  const 못본곳 = [];
  for (const f of 자리들) {
    const t = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    if (!/from '[^']*tools\/label\.js'/.test(t)) 못본곳.push(f);
  }
  /*
   * loop.js 는 목록을 안 쓴다 — 여기는 **이름표를 그리는** 자리가 아니라
   * Task 도구의 인자를 실제로 읽어 쓰는 자리다. 읽는 이름이 다르면 화면이
   * 아니라 일 자체가 안 돈다. 그래서 이쪽은 글자로 못 박는 것이 맞다.
   */
  const loop2 = readFileSync(new URL('../src/agent/loop.js', import.meta.url), 'utf8');
  if (!/call\.args\?\.purpose \?\? call\.args\?\.목적/.test(loop2)) 못본곳.push('src/agent/loop.js');
  check('★ 이름표 그리는 자리가 새 이름을 본다', 못본곳.length === 0, 못본곳.join(' '));
  /*
   * 자리 수를 세는 까닭: 새 화면(예를 들어 웹 붙임)이 생기면서 제 이름표를
   * 따로 그리기 시작하면, 위 검사는 그 새 자리를 아예 안 본다. 초록인데
   * 안 재는 자리가 하나 늘어난 셈이다. 여기서 수가 어긋나면 사람이 목록을
   * 다시 본다.
   *
   * 다섯 + loop.js 하나. 여섯이 다섯이 된 것은 자리가 줄어서가 아니라
   * 다섯 자리가 **같은 자를 쥐게 되어** 한 줄로 세지기 때문이다.
   */
  check('이름표를 그리는 자리를 빠짐없이 센다', 자리들.length === 5, String(자리들.length));
}

trace('5-영어-설명');

// ── 영어 화면에서 설명이 조용히 빠지지 않나 ─────────────────────────────
//
// 영어 설명 표는 **인자 이름으로 걸린다**. 이름을 바꾸면서 표를 안 고치면
// 그 인자만 설명이 빈 채로 나간다. 오류가 아니라 그냥 덜 나가는 것이라,
// 영어로 쓰는 사람만 조용히 손해를 본다.
{
  const 빠진것 = [];
  const 남는것 = [];
  for (const [n, t] of Object.entries(TOOLS)) {
    const en = 도구설명EN[n];
    if (!en) continue;
    const 실제 = Object.keys(t.schema?.parameters?.properties ?? {});
    const 적힌 = Object.keys(en.params ?? {});
    for (const k of 실제) if (!적힌.includes(k)) 빠진것.push(`${n}.${k}`);
    for (const k of 적힌) if (!실제.includes(k)) 남는것.push(`${n}.${k}`);
  }
  check('★ 영어 설명이 빠진 인자가 없다', 빠진것.length === 0, 빠진것.join(' '));
  check('★ 없는 인자에 붙은 설명도 없다', 남는것.length === 0, 남는것.join(' '));
  check('영어 설명글도 옛 이름을 안 부른다',
    !/`이해`|into 할일/.test(도구설명EN.Ask.desc + 도구설명EN.Task.desc));

  /*
   * ★ 도구 설명은 모델이 읽는 **계약**이다 — 두 말이 같은 규칙을 담아야 한다 (8회차).
   *
   * desc.en.js 머리말이 「글자 그대로 옮겼다」 고 못 박아 둔 줄 가운데
   * Append 의 「앞부분을 다시 보내지 마라」 가 한글 description 에도 영문 desc 에도
   * 없었다. 그 한 줄이 빠지면 모델은 Append 마다 앞부분을 통째로 다시 보낸다 —
   * 잘려서 다시 쓰던 그 자리로 돌아가고, 토큰은 파일 길이만큼 곱절로 든다.
   */
  const 붙이기한 = TOOLS.Append.schema.description;
  const 붙이기영 = 도구설명EN.Append.desc;
  check('★★ Append 설명(한)이 앞부분을 다시 보내지 말라고 못 박는다',
    /다시 보내지 (마|않)/.test(붙이기한), 붙이기한.slice(-70));
  check('★★ Append 설명(영)에도 같은 규칙이 있다',
    /resend|send .* again/i.test(붙이기영), 붙이기영.slice(-70));

  /*
   * ★ 옛 `.xls` 는 **빌려 읽는다** — 영문 설명만 옛 약속을 들고 있었다 (8회차).
   *
   * 한글 쪽은 「옛 형식(.xls)은 이 PC 에 엑셀이나 LibreOffice 가 있어야 읽힌다」 로
   * 고쳐졌는데, 영문은 `.xlsx/.xlsm/.xls` 를 한 묶음으로 「그대로 읽힌다」 고 적고
   * 있었다. 지시말이 영어인 사람은 LibreOffice 가 없는 PC 에서 **되지도 않는 것을
   * 된다고** 듣는다 — 모델은 사용자에게 그 .xls 를 달라고 해 놓고 못 읽어서
   * 걸음 하나를 버린다. 스키마 문장이 곧 약속이라, 두 말이 같은 약속이어야 한다.
   */
  const 읽기한 = TOOLS.Read.schema.description;
  const 읽기영 = 도구설명EN.Read.desc;
  check('★ 설명(한)이 옛 .xls 는 빌려 읽는 것이라고 적는다 (아래 검사의 전제)',
    /LibreOffice/.test(읽기한) && /\(\.xlsx\/\.xlsm\)/.test(읽기한), 읽기한.slice(-160));
  check('★★ 설명(영)도 그대로 읽히는 것에 옛 .xls 를 안 끼워 넣는다',
    /\(\.xlsx\/\.xlsm\)/.test(읽기영) && !/\.xlsm\/\.xls\b/.test(읽기영), 읽기영.slice(0, 200));
  check('★★ 설명(영)이 옛 .xls 에는 엑셀이나 LibreOffice 가 있어야 한다고 적는다',
    /\.xls\b[\s\S]{0,80}LibreOffice/i.test(읽기영), 읽기영.slice(0, 260));

  /*
   * ★ `.hwpx` 로 **새로 만드는 길**이 영문 설명에서만 통째로 빠져 있었다 (막판 훑기).
   *
   * 영어설명() 은 description 을 **통째로 갈아 끼운다**. 그래서 이 표에 없는 줄은
   * 「아직 안 옮긴 것」 이 아니라 **지워진 것**이다 — 지시말이 ko 가 아닌 사람에게는
   * Write 로 한글 문서를 만들 수 있다는 사실이 아예 안 나간다. 사내에 낼 보고서를
   * 달라고 하면 모델은 .md 를 쓰고 끝내고, 사람은 그 길이 있는 줄도 모른다.
   * 이 판에서 손본 tools/hwpxwrite.js 가 통째로 안 닿는 자리였다.
   */
  const 쓰기한 = TOOLS.Write.schema.description;
  const 쓰기영 = 도구설명EN.Write.desc;
  check('★ 설명(한)이 .hwpx 로 끝내면 한글 문서를 만든다고 적는다 (아래 검사의 전제)',
    /hwpx/i.test(쓰기한), 쓰기한.slice(-140));
  check('★★ 설명(영)에도 .hwpx 로 만드는 길이 있다', /hwpx/i.test(쓰기영), 쓰기영.slice(-140));
  check('★★ 설명(영)도 새로 만들 때만 된다고 못 박는다',
    /hwpx[\s\S]{0,300}(only when creating|new file|cannot be edited)/i.test(쓰기영), 쓰기영.slice(-180));

  /*
   * ★ 배열 **속** 칸에 한국어가 그대로 실려 나갔다 (막판 훑기).
   *
   * 영어설명() 은 겉의 properties 만 갈아 끼웠다. 그런데 이 도구들이 제일 세게
   * 미는 길은 배열 쪽이다 — 「여러 군데는 edits 로 한 번에」 「스무 개를 옮기려고
   * 스무 번 부르지 마라」. 정작 그 길의 인자 설명이 `old_string: 바꿀 대상` 처럼
   * 한국어로 나갔다. 영어로 켠 사람에게는 제일 비싼 길의 설명서만 안 읽히는 셈이다.
   *
   * 화면이 아니라 **모델에게 나가는 정의**를 잰다 — langleak 은 화면만 본다.
   */
  const 한글 = /[가-힣]/;
  const 샌곳 = [];
  for (const [n, t] of Object.entries(TOOLS)) {
    if (!도구설명EN[n]) continue;
    (function 훑(node, 길) {
      if (!node || typeof node !== 'object') return;
      if (typeof node.description === 'string' && 한글.test(node.description)) 샌곳.push(길);
      for (const [k, v] of Object.entries(node.properties ?? {})) 훑(v, `${길}.${k}`);
      if (node.items) 훑(node.items, `${길}[]`);
    })(영어설명(t.schema, n, 'en').parameters ?? {}, n);
  }
  check('★★★ 영어 도구 정의에 한국어가 한 줄도 안 남는다', 샌곳.length === 0, 샌곳.join(' '));

  /*
   * 속 표가 **실재하는 칸**만 가리키나. 겉 표와 같은 이유다 — 이름이 어긋나면
   * 그 칸만 조용히 한국어로 돌아간다.
   */
  const 헛것 = [];
  for (const [n, en] of Object.entries(도구설명EN)) {
    for (const [배열, 속 ] of Object.entries(en.items ?? {})) {
      const 실제 = TOOLS[n]?.schema?.parameters?.properties?.[배열]?.items?.properties;
      if (!실제) { 헛것.push(`${n}.${배열}[]`); continue; }
      for (const k of Object.keys(속)) if (!(k in 실제)) 헛것.push(`${n}.${배열}[].${k}`);
    }
  }
  check('★★ 속 표가 없는 칸을 가리키지 않는다', 헛것.length === 0, 헛것.join(' '));
}

trace('6-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n도구 인자 이름 검사  ${D}(서버가 받아 주는 이름인가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
