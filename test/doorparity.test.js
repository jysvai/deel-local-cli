// 문이 셋인데 같은 프로그램을 짓는가.
//
// ── 왜 이 검사가 생겼나 ─────────────────────────────────────────────────
//
// deel 에 들어오는 길은 셋이다 — 채팅(`src/repl.js`), 한 방 실행
// (`src/oneshot.js`), 에디터(`src/acp/serve.js`). 셋 다 프로필 하나를 읽어
// `conn` 을 짓고 같은 게이트웨이에 붙는다. 그런데 그 `conn` 을 **각자 손으로**
// 짓는다. 그러면 한 곳에 열쇠를 더할 때 나머지 둘에 안 더해도 아무 일도 안
// 일어난다 — 검사도 안 걸리고, 화면에도 안 뜬다.
//
// 실제로 두 개가 빠져 있었다. `src/acp/serve.js` 의 conn 에는 `vision` 도
// `열쇠받기` 도 없었다.
//
//   vision 이 없으면    → 그림을 보는 모델에 붙어 있어도 에디터에서는
//                         「이 모델은 그림을 못 봅니다」 가 나온다. 모델에
//                         대한 말인데 우리 쪽 사실이 틀린 것이다.
//   열쇠받기가 없으면   → 401 을 받고 열쇠를 다시 받아 오는 길이 잠긴다.
//                         한 시간짜리 토큰을 쓰는 사내 게이트웨이는 터미널에서
//                         되고 에디터에서는 한 시간 뒤에 그냥 죽는다.
//
// `test/acp.test.js` 는 1,241줄인데 `conn.` 이라는 글자가 한 번도 안 나온다.
// 그 파일이 재는 것은 프로토콜이고, 이 어긋남은 그 아래층이었다.
//
// ── 이 검사가 재는 것 ───────────────────────────────────────────────────
//
// **열쇠 이름의 집합**을 잰다. 값을 다 맞추라는 것이 아니다 — 문마다 다른
// 것이 있는 게 맞다(에디터에는 TUI 가 없다). 다만 「한쪽에만 있는 열쇠」 가
// 생기면 그것은 **의도한 차이인지 빠뜨린 것인지** 사람이 한 번은 봐야 한다.
// 그래서 봐주는 목록을 옆에 두고, 거기 없는 차이가 생기면 빨개진다.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(here, '..', 'src', p), 'utf8');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

/*
 * conn 객체 리터럴에서 열쇠 이름을 뽑는다.
 *
 * 소스를 글자로 읽는다 — 세 파일을 진짜로 띄우면 게이트웨이·에디터·터미널이
 * 다 필요하고, 그 셋을 세우는 비용이 이 검사가 잡으려는 것보다 크다. 여기서
 * 잡으려는 것은 「열쇠를 한 곳에만 더했다」 이고, 그건 글자에 다 드러난다.
 */
function conn열쇠(글, 파일, 머리 = 'const conn = {') {
  const i = 글.indexOf(머리);
  if (i < 0) return null;
  // 중괄호 깊이를 세어서 리터럴 끝을 찾는다.
  let 깊이 = 0; let 끝 = -1;
  for (let j = 글.indexOf('{', i); j < 글.length; j++) {
    if (글[j] === '{') 깊이++;
    else if (글[j] === '}') { 깊이--; if (깊이 === 0) { 끝 = j; break; } }
  }
  if (끝 < 0) return null;
  const 안 = 글.slice(i, 끝);
  // 주석은 뺀다 — 주석 안의 콜론이 열쇠로 읽히면 안 된다.
  const 벗김 = 안.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const 열쇠 = new Set();
  for (const m of 벗김.matchAll(/(?:^|[{,])\s*([A-Za-z0-9_$가-힣]+)\s*:/g)) 열쇠.add(m[1]);
  열쇠.delete('conn');
  return { 열쇠, 파일 };
}

trace('1-세-문의-conn');

/*
 * ── 문은 셋이 아니라 넷이었다 ───────────────────────────────────────────
 *
 * 이 검사는 처음에 `const conn = {` 리터럴 셋만 봤다. 그런데 conn 을 짓는
 * 자리가 하나 더 있다 — `/model` 로 프로필을 갈아끼우는 commands.js 의
 * 연결적용() 이다. 그쪽은 리터럴이 아니라 `Object.assign(session.conn, {…})`
 * 이라 글자가 안 맞아서, 이 검사가 못 박아 둔 vision·열쇠받기 두 개가 거기서
 * 빠져 있는데도 내내 초록이었다.
 *
 * 빠져서 난 일이 가벼운 것이 아니다. 회사 프로필(열쇠받기로 SSO 토큰을 받아
 * 오는 것)에서 남의 프로필로 `/model` 하면, 옛 프로필의 **살아 있는 회사
 * 토큰이 새 창구로 그대로 나간다** — 새 프로필의 제 열쇠는 버려진 채로.
 *
 * 그래서 문을 찾는 자를 넓힌다. 새 문이 또 생기면 그 문도 여기 적어야 한다.
 */
const 문들 = [
  conn열쇠(src('repl.js'), 'src/repl.js'),
  conn열쇠(src('oneshot.js'), 'src/oneshot.js'),
  conn열쇠(src('acp/serve.js'), 'src/acp/serve.js'),
  conn열쇠(src('commands/model.js'), 'src/commands/model.js (/model)', 'Object.assign(session.conn, {'),
].filter(Boolean);

check('★ 네 문에서 conn 짓는 자리를 다 찾았다', 문들.length === 4,
  `${문들.length}개: ${문들.map((x) => x.파일).join(', ')}`);

/*
 * 문마다 달라도 되는 열쇠.
 *
 * 넉넉히 잡으면 이 검사는 아무것도 안 지킨다. **까닭이 있는 것만** 넣고 왜
 * 봐주는지를 옆에 적는다 — 새 열쇠를 여기 넣으려면 그 까닭을 적어야 한다.
 */
const 봐주는열쇠 = new Map([
  // 이름은 채팅에서만 짓는다. 한 방 실행과 에디터는 그 자리가 없다.
  ['세션이름', '채팅에만 있는 자리'],
  ['이름', '채팅에만 있는 자리'],
]);

if (문들.length === 4) {
  const 모든열쇠 = new Set(문들.flatMap((x) => [...x.열쇠]));
  const 어긋남 = [];
  for (const k of 모든열쇠) {
    if (봐주는열쇠.has(k)) continue;
    const 있는곳 = 문들.filter((x) => x.열쇠.has(k));
    if (있는곳.length !== 문들.length) {
      const 없는곳 = 문들.filter((x) => !x.열쇠.has(k)).map((x) => x.파일);
      어긋남.push(`${k} → ${없는곳.join(', ')} 에 없음`);
    }
  }
  check('★★ 한 문에만 있는 conn 열쇠가 없다', 어긋남.length === 0, 어긋남.join(' | '));

  // 이 두 개는 특히 못박는다 — 실제로 빠져 있었고, 빠지면 조용히 틀린 답을 한다.
  for (const k of ['vision', '열쇠받기']) {
    const 없는곳 = 문들.filter((x) => !x.열쇠.has(k)).map((x) => x.파일);
    check(`★★ ${k} 가 네 문에 다 있다`, 없는곳.length === 0, 없는곳.join(', '));
  }
}

trace('2-안전-세-갈래는-값까지');

/*
 * ★ 열쇠 이름만 맞으면 통과하는 검사는 안전 자리에서는 모자라다.
 *
 * scope·History·Audit 은 셋 다 「어느 폴더냐」 를 들고 있다. 이름이 같아도
 * 서로 다른 `.deel` 을 가리키면, 되돌리기 기록이 한 군데 쌓이고 다른 데서
 * 되돌리려 드는 일이 생긴다. 그래서 이 셋은 **무엇으로 짓는지**를 본다.
 */
const 안전자리 = [
  ['makeScope', /makeScope\(\s*root/],
  ['History', /new History\(\s*root/],
  ['Audit', /new Audit\(\s*root/],
];
for (const [이름, 무늬] of 안전자리) {
  const 없는곳 = [];
  for (const [파일, 글] of [
    ['src/repl.js', src('repl.js')],
    ['src/oneshot.js', src('oneshot.js')],
    ['src/acp/serve.js', src('acp/serve.js')],
  ]) {
    if (!무늬.test(글)) 없는곳.push(파일);
  }
  check(`★ ${이름} 를 세 문 다 root 로 짓는다`, 없는곳.length === 0, 없는곳.join(', '));
}

trace('3-열쇠받기를-세-문이-다-건다');

/*
 * ── conn 에 싣는 것까지만 맞춰 두고 그 뒤를 안 봤다 ─────────────────────
 *
 * 1절은 `열쇠받기` 가 네 문의 conn 에 다 있는지 잰다. 그런데 그 명령은 도구
 * 승인보다 **앞에서** 돈다. 대화 화면(repl.js)은 띄우기 전에 무엇을 띄우는지
 * 말하고(열쇠물어보기), 받는 중·못 받은 까닭을 적는다(onAuth).
 *
 * 한 방 실행과 에디터는 둘 다 안 걸었다. backend/adapter.js 는 `물어보기` 가
 * 없으면 **묻지 않고 띄운다** — 명령이 아무 말 없이 돌고, 못 받은 까닭도 사라져
 * 401 한 줄만 남았다.
 */
for (const [파일, 글] of [
  ['src/repl.js', src('repl.js')],
  ['src/oneshot.js', src('oneshot.js')],
  ['src/acp/serve.js', src('acp/serve.js')],
]) {
  check(`★★ ${파일} 가 열쇠받기 명령을 띄우기 전에 건다 (열쇠물어보기)`, /session\.열쇠물어보기\s*=/.test(글), '');
  check(`★★ ${파일} 가 받는 중·못 받은 까닭을 건다 (onAuth)`, /session\.onAuth\s*=/.test(글), '');
}

/*
 * 모아 둔 소식(config.js 의 소식줄들)은 **당겨 가야** 나온다. 안 당기는 문에서는
 * 관리 정책 파일이 깨져 금지가 통째로 안 걸려도 한 줄도 안 나온다. 문마다 따로
 * 넷을 당기면 하나씩 빠진다 — 실제로 한 방 실행은 셋만 당겼다.
 */
for (const [파일, 글] of [
  ['src/repl.js', src('repl.js')],
  ['src/oneshot.js', src('oneshot.js')],
  ['src/acp/serve.js', src('acp/serve.js')],
  ['src/setup.js', src('setup.js')],
  ['src/reset.js', src('reset.js')],
  ['bin/deel.js (doctor)', readFileSync(join(here, '..', 'bin', 'deel.js'), 'utf8')],
]) {
  check(`★ ${파일} 가 모아 둔 소식을 한 자리에서 비운다 (소식줄들)`, /소식줄들\(/.test(글), '');
}

trace('4-도구-그릇-ctx');

/*
 * ── 도구에 넘기는 그릇(ctx)도 세 벌이다 (2.0.2) ─────────────────────────────
 *
 * 세 문이 ctx 를 **주석까지 글자 그대로** 따로 짓는다. 모아 한 벌로 만들지 않는 까닭이
 * 있다 — `모델컨텍스트`·`눈있나` 게터는 문마다 **살아 있는 conn 변수**를 봐야 한다. 채팅은
 * /model 로 conn 을 통째로 갈아 끼우는데, 한 벌짜리 함수로 빼면 게터가 그 함수가 받은 옛
 * conn 을 붙들어 조용히 옛 연결의 창 크기를 말한다.
 *
 * 그 대신 칸을 맞춘다. 실제로 `deel run` 에만 `mcp` 가 없어서 `.deel/mcp.json` 에 적은
 * 도구가 대화 화면에서는 되고 한 번 실행에서는 **말없이 없었다.**
 *
 * 맨 윗단 칸만 센다 — 들여쓰기가 여는 줄보다 한 단 깊은 줄이다. 글을 풀어 읽으면 몸통 안의
 * 따옴표·정규식에 걸려 칸을 놓친다(재 보니 채팅의 confirm 을 놓쳤다).
 */
function 그릇칸(글, 머리) {
  const 줄들 = 글.split('\n');
  const i = 줄들.findIndex((l) => l.trimEnd().endsWith(머리));
  if (i < 0) return null;
  const 들여 = /^ */.exec(줄들[i])[0].length + 2;
  const 칸 = new Set();
  for (let j = i + 1; j < 줄들.length; j++) {
    const l = 줄들[j];
    if (new RegExp(`^ {${들여 - 2}}\\};?\\s*$`).test(l)) break;
    const m = new RegExp(`^ {${들여}}(?:get |async )?([A-Za-z0-9_$가-힣]+)\\s*[:(,]`).exec(l);
    if (m) 칸.add(m[1]);
  }
  return 칸;
}
const 그릇들 = [
  ['src/repl.js', 그릇칸(src('repl.js'), 'const ctx = {')],
  ['src/oneshot.js', 그릇칸(src('oneshot.js'), 'const ctx = {')],
  ['src/acp/serve.js', 그릇칸(src('acp/serve.js'), '방.ctx = {')],
];
check('★ 세 문에서 ctx 그릇을 다 찾았다', 그릇들.every(([, k]) => k?.size > 10),
  그릇들.map(([f, k]) => `${f} ${k?.size ?? '없음'}`).join(' · '));
// 문마다 달라도 되는 칸. 까닭 없이 넣지 않는다.
const 봐주는칸 = new Map([
  ['종알림', '채팅에만 있는 종 (/bell)'],
  ['키확인', '채팅에만 있는 키 입력 확인'],
  ['ask물음', '채팅에만 있는 고르기 물음 — 다른 문은 ask 가 기본값을 바로 돌려준다'],
  ['lsp', '에디터는 제 언어 서버가 있다 — 끄는 자리를 갖춘 채팅·한 번 실행만 켠다 (tools/index.js 고친뒤진단)'],
]);
if (그릇들.every(([, k]) => k)) {
  const 모든칸 = new Set(그릇들.flatMap(([, k]) => [...k]));
  const 어긋남 = [];
  for (const k of 모든칸) {
    if (봐주는칸.has(k)) continue;
    const 없는곳 = 그릇들.filter(([, s]) => !s.has(k)).map(([f]) => f);
    if (없는곳.length) 어긋남.push(`${k} → ${없는곳.join(', ')} 에 없음`);
  }
  check('★★ 한 문에만 있는 ctx 칸이 없다', 어긋남.length === 0, 어긋남.join(' | '));
  for (const k of ['mcp', '규칙들', '훅들', '셸남길것', 'confirm']) {
    const 없는곳 = 그릇들.filter(([, s]) => !s.has(k)).map(([f]) => f);
    check(`★★ ctx.${k} 가 세 문에 다 있다`, 없는곳.length === 0, 없는곳.join(', '));
  }
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n세 문이 같은 것을 짓는가\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
