// 화면과 모델이 받는 **숫자**가 실제와 같은가.
//
// ── 왜 이 파일이 생겼나 ─────────────────────────────────────────────────
//
// 42회차에서 대화 상태를 들고 있는 두 파일(agent/session.js 1,300줄 ·
// agent/threads.js 220줄)을 통째로 훑었다. session.js 에는 전용 어긋내기가
// 하나, threads.js 에는 하나도 없었다.
//
// 나온 것이 전부 한 모양이다 — **못 한 것이 아니라, 다른 것을 해 놓고 아무
// 말도 안 하는 것.** 여기서는 그게 전부 「숫자」 로 나타난다.
//
//   /context  시스템 1,607          ← 실제로는 1,704. 셸 안내·급말·못 박은 글이
//                                     세어지지 않았다. 남은 자리가 그만큼
//                                     뻥튀기되고, 그 값으로 출력 상한이 잡힌다.
//   /context  도구 결과 (파일 0개)  2,150토큰
//   /cost     $0.00                 ← 갈래를 바꿨을 뿐이다. 돈은 그대로 나갔다.
//   /status   규칙  DEEL.md         ← 2만 자를 넘겨 뒷부분은 안 실렸는데
//                                     이름만 적혀 있다
//
// 그리고 짝이 깨지는 두 자리. 이쪽은 숫자가 아니라 **다음 요청이 통째로 400**
// 이 되는 자리인데, 원인이 두 화면 전이라 사람이 이어 붙일 수 없다.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from './trace.mjs';
import { Session, repairToolPairs, safeHead } from '../src/agent/session.js';
import { Threads } from '../src/agent/threads.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 치움 = [];
const 새뿌리 = () => { const d = mkdtempSync(join(tmpdir(), 'deel-셈-')); 치움.push(d); return d; };
const 새세션 = (opts = {}) => new Session({ ctx: 128000, ...opts.conn }, { root: opts.root ?? 새뿌리() });

trace('1-짝이-깨지는-자리');

// ── 1. id 가 아예 없는 규격 (Ollama) ───────────────────────────────────
//
// 짝지을 때는 순서로 봤는데, 남길 것을 고를 때는 id 로만 걸렀다. id 가 없으니
// 남길id 는 늘 비었고, 필터가 전부 떨어져 **부름 0개짜리 assistant 뒤에 결과만**
// 남았다. 짝 깨짐을 없애겠다는 함수가 짝 깨짐을 만들어 냈다.
{
  const r = repairToolPairs([
    { role: 'user', content: '두 개 해줘' },
    { role: 'assistant', tool_calls: [{ function: { name: 'bash' } }, { function: { name: 'read' } }] },
    { role: 'tool', tool_name: 'bash', content: 'ok' },
  ]);
  const a = r.messages.find((m) => m.role === 'assistant');
  const 부름 = (a?.tool_calls ?? []).length;
  const 결과 = r.messages.filter((m) => m.role === 'tool').length;
  check('★★ id 없는 규격에서 짝이 맞는다', 부름 === 결과 && 부름 === 1, `부름 ${부름} · 결과 ${결과}`);
  check('★ 결과 없는 부름만 걷어낸다', r.고친것 === 1, `고친것 ${r.고친것}`);

  // id 가 있는 규격은 여태대로여야 한다 — 문을 너무 세게 닫지 않았나 본다.
  const r2 = repairToolPairs([
    { role: 'user', content: '해줘' },
    { role: 'assistant', tool_calls: [{ id: 'A', function: { name: 'a' } }, { id: 'B', function: { name: 'b' } }] },
    { role: 'tool', tool_call_id: 'B', content: 'b결과' },
  ]);
  const a2 = r2.messages.find((m) => m.role === 'assistant');
  check('id 가 있으면 id 로 고른다', (a2?.tool_calls ?? []).length === 1 && a2.tool_calls[0].id === 'B',
    JSON.stringify(a2?.tool_calls));
}

// ── 2. 나란한 도구 결과를 반으로 가르지 않는다 ─────────────────────────
//
// 한 번에 여러 도구를 부르면 결과도 여러 줄이다. 그 사이에서 머리를 끊으면
// 부름 둘에 결과 하나가 남고, 그 뒤 요청은 통째로 400 이다.
{
  const messages = [
    { role: 'user', content: '해줘' },
    { role: 'assistant', tool_calls: [{ id: 'A', function: { name: 'a' } }, { id: 'B', function: { name: 'b' } }] },
    { role: 'tool', tool_call_id: 'A', content: 'a결과' },
    { role: 'tool', tool_call_id: 'B', content: 'b결과' },
    { role: 'assistant', content: '끝' },
  ];
  for (const k of [1, 2, 3, 4, 5]) {
    const 머리 = messages.slice(0, safeHead(messages, k));
    const 부름 = 머리.filter((m) => m.role === 'assistant').flatMap((m) => m.tool_calls ?? []).length;
    const 결과 = 머리.filter((m) => m.role === 'tool').length;
    check(`★ safeHead(${k}) 가 짝을 안 가른다`, 부름 === 결과, `부름 ${부름} · 결과 ${결과}`);
  }
}

trace('2-되감으면-없어지는-것들');

// ── 3. /undo 뒤에 남으면 안 되는 것들 ──────────────────────────────────
//
// clear() 는 「접거나 줄일 때 다시 박히는 것들이라, 지운 뒤에도 들고 있으면
// 지운 대화의 할 일이 되살아나 붙는다」 고 적어 두고 그것을 비운다. 되감기는
// 파일기억만 비우고 나머지는 그대로였다.
{
  const s = 새세션();
  s.턴시작(1);
  s.push({ role: 'user', content: 'A 해줘' });
  s.push({ role: 'assistant', content: 'A 했습니다' });
  s.턴시작(2);
  s.push({ role: 'user', content: 'B 해줘' });
  s.push({ role: 'assistant', content: 'B 했습니다' });
  s.이번요청 = 'B 해줘';
  s.할일 = [{ text: 'B 의 남은 일', state: 'todo' }];
  s.검증 = { 돈횟수: 2, 확인: 5, 탈: 0, 못확인: 0 };
  s.filesRead.set('/a/b.js', '내용');

  const r = s.되감기([2]);
  check('두 번째 턴이 걷혔다', s.messages.length === 2, `${s.messages.length}개 남음`);
  check('사람이 쳤던 말은 돌려준다', r.사람말 === 'B 해줘', String(r.사람말));
  check('★★ 되돌린 턴의 할 일이 안 남는다', (s.할일 ?? []).length === 0, `${(s.할일 ?? []).length}개`);
  check('★★ 되돌린 턴의 시킨 말이 안 남는다', s.이번요청 === '', JSON.stringify(s.이번요청));
  check('★ 없어진 코드에 초록 ✓ 가 안 남는다', s.검증.확인 === 0 && s.검증.돈횟수 === 0,
    JSON.stringify(s.검증));
  check('★ 읽은 파일 표도 턴다', s.filesRead.size === 0, `${s.filesRead.size}개`);
}

// /clear 도 같은 잣대다 — 새로 시작한 일의 화면에 앞 일의 초록이 서 있으면 안 된다.
{
  const s = 새세션();
  s.검증 = { 돈횟수: 3, 확인: 7, 탈: 0, 못확인: 0 };
  s.usage.in = 1234;
  s.changes.set('/a/b.js', { added: 3, removed: 1, times: 1 });
  s.clear();
  check('★ /clear 가 확인 표시를 지운다', s.검증.확인 === 0, JSON.stringify(s.검증));
  check('돈은 안 지운다 — 실제로 썼다', s.usage.in === 1234, String(s.usage.in));
  check('바뀐 파일도 안 지운다 — 실제로 바뀐 채다', s.changes.size === 1, `${s.changes.size}개`);
}

trace('3-화면의-숫자가-사실인가');

// ── 4. 시스템 칸이 실제로 나가는 글과 같은가 ───────────────────────────
//
// 조각을 손으로 나열하다 셋을 빠뜨렸다 — 셸 안내, 급말, 그리고 사람이 못 박은
// 글. 못 박은 글은 사람이 얼마든지 길게 쓸 수 있는 자리다.
{
  const s = 새세션();
  const 칸 = (b) => b.rows.find((r) => /system|시스템/i.test(r.label))?.n ?? 0;
  const 전 = 칸(s.breakdown());
  s.못박은것.더하기?.('사내 문서는 반드시 CP949 로 되돌려 쓴다. '.repeat(40));
  const 후 = 칸(s.breakdown());
  check('★★ 못 박은 글이 시스템 칸에 세어진다', 후 > 전 + 100, `${전} → ${후}`);
  check('★ 셸 안내가 시스템 글에 실려 있다', /셸|shell|cmd|bash|PowerShell/i.test(s.systemPrompt()));

  // 표의 합이 실제 글보다 작으면 '남은 자리' 가 그만큼 뻥튀기된다.
  const b = s.breakdown();
  const 합 = b.rows.reduce((a, r) => a + r.n, 0);
  check('표의 줄을 더한 값이 합계와 같다', 합 === b.used, `${합} vs ${b.used}`);
}

// ── 5. 「도구 결과 (N개)」 의 N 이 무엇을 세나 ──────────────────────────
{
  const s = 새세션();
  for (let i = 0; i < 10; i++) {
    s.push({ role: 'assistant', tool_calls: [{ id: `t${i}`, function: { name: 'Bash' } }] });
    s.push({ role: 'tool', tool_call_id: `t${i}`, content: '명령 출력'.repeat(50) });
  }
  const 줄 = s.breakdown().rows.find((r) => /도구 결과|Tool results/i.test(r.label));
  check('★★ 센 것과 적은 것이 같다', /10/.test(String(줄?.label)) && 줄.n > 0,
    `${줄?.label} = ${줄?.n} 토큰`);
  check('파일을 안 읽었어도 도구 결과는 센다', s.filesRead.size === 0, `filesRead ${s.filesRead.size}`);
}

// ── 6. 사람이 적은 규칙을 반만 싣고 아무 말도 안 했다 ──────────────────
//
// 「운영 DB 는 절대 건드리지 마라」 가 2만 자 뒤에 있으면 모델에게 한 글자도
// 안 간다. 그런데 /status 는 파일 이름만 적었고 규칙못읽음 은 null 이었다.
{
  const 뿌리 = 새뿌리();
  writeFileSync(join(뿌리, 'DEEL.md'), 'x'.repeat(21000) + '\n- 운영 DB 는 절대 건드리지 마라.\n');
  const s = 새세션({ root: 뿌리 });
  check('★★ 잘랐다는 사실이 남는다', !!s.규칙잘림, JSON.stringify(s.규칙잘림));
  check('★ 얼마를 잘랐는지 적는다', s.규칙잘림?.원본 > s.규칙잘림?.실린,
    `${s.규칙잘림?.원본}자 중 ${s.규칙잘림?.실린}자`);
  check('★ 모델도 반쪽인 것을 안다', /앞 20,000자만 실렸다/.test(s.systemPrompt()));
  check('짧은 규칙은 그대로다', (() => {
    const 뿌2 = 새뿌리();
    writeFileSync(join(뿌2, 'DEEL.md'), '- 짧은 규칙\n');
    const s2 = 새세션({ root: 뿌2 });
    return s2.규칙잘림 === null && s2.rules.text === '- 짧은 규칙\n';
  })());
}

// ── 7. 셈을 모르는 변경을 「안 바뀌었다」 로 뭉갠다 ─────────────────────
//
// Move(파일 하나)와 hwpx Write 는 바뀐 경로는 주는데 몇 줄인지는 안 준다.
// 그 둘이 /diff·상태줄 ✎·/commit 목록에서 통째로 빠졌다.
{
  const s = 새세션();
  s.noteChange('/a/moved.txt', undefined);
  s.noteChange('/a/edited.txt', { added: 3, removed: 1 });
  check('★★ 셈 없는 변경도 목록에 든다', s.changes.has('/a/moved.txt'),
    JSON.stringify([...s.changes.keys()]));
  check('셈이 있는 것은 그대로 센다', s.changes.get('/a/edited.txt')?.added === 3,
    JSON.stringify(s.changes.get('/a/edited.txt')));
  check('셈을 모르면 0줄로 적는다 — 안 바뀐 것이 아니다',
    s.changes.get('/a/moved.txt')?.added === 0 && s.changes.get('/a/moved.txt')?.times === 1,
    JSON.stringify(s.changes.get('/a/moved.txt')));
  s.noteChange('', { added: 1 });
  check('경로가 없으면 안 센다', s.changes.size === 2, `${s.changes.size}개`);
}

// ── 8. 못 믿을 표본을 세지도 않고 버렸다 ───────────────────────────────
{
  const s = 새세션();
  for (let i = 0; i < 6; i++) s.push({ role: 'user', content: '자리를 채운다. '.repeat(40) });
  const 추정 = s.breakdown().used;
  check('잴 만큼은 쌓였다', 추정 >= 200, `${추정} 토큰`);
  check('말이 되는 값은 받는다', s.배운다(Math.round(추정 * 1.2)) !== null);
  const 전 = s.보정버림 ?? 0;
  check('★ 못 믿을 값은 안 쓴다', s.배운다(추정 * 9) === null);
  check('★★ 버린 것도 센다', (s.보정버림 ?? 0) === 전 + 1, `버림 ${s.보정버림}`);
  check('마지막에 뭘 봤는지 남긴다', s.보정마지막버린비율 > 2, String(s.보정마지막버린비율));
}

trace('4-갈래마다-따로-세는-것');

// ── 9. 갈래를 바꾸면 쓴 돈이 줄어든다 ──────────────────────────────────
//
// /cost 는 session.usage 하나만 봤다. 그건 **지금 갈래** 것이다. 갈래를 셋
// 굴리면 화면의 금액은 그중 하나 몫이고, 닫은 갈래 것은 아예 안 보였다.
{
  const 뿌리 = 새뿌리();
  const s = 새세션({ root: 뿌리 });
  let n = 0;
  const 새store = () => ({ id: `s${++n}`, append() {}, 살림따라가기() {} });
  const 갈래 = new Threads(s, {}, 새store, { id: 's0', append() {}, 살림따라가기() {} });

  s.usage.in = 1000; s.usage.out = 100; s.usage.calls = 5;
  갈래.새로('곁가지');
  s.usage.in = 300; s.usage.out = 30; s.usage.calls = 2;

  const 합 = 갈래.전체usage();
  check('★★ 갈래 전부를 합쳐서 센다', 합.in === 1300 && 합.calls === 7,
    `in ${합.in} · calls ${합.calls}`);
  check('지금 갈래 것은 여전히 지금 갈래 것', s.usage.in === 300, String(s.usage.in));

  갈래.닫기();   // 곁가지를 닫고 본줄기로 돌아온다
  const 합2 = 갈래.전체usage();
  check('★★ 닫은 갈래가 쓴 돈이 안 사라진다', 합2.in === 1300 && 합2.calls === 7,
    `in ${합2.in} · calls ${합2.calls}`);
  check('닫은 수를 안다', 갈래.닫힌수 === 1, String(갈래.닫힌수));
  check('닫고 나서도 두 줄이 필요하다고 안다', 갈래.갈래여럿인가() === true);

  // 갈래를 안 쓰는 사람 화면은 그대로여야 한다.
  const s2 = 새세션();
  const 갈래2 = new Threads(s2, {}, 새store, { id: 'x', append() {}, 살림따라가기() {} });
  check('갈래가 하나뿐이면 두 줄을 안 그린다', 갈래2.갈래여럿인가() === false);
}

// ── 10. 새 갈래의 셈 그릇이 본줄기와 같은 모양인가 ─────────────────────
{
  const s = 새세션();
  const 새store = () => ({ id: 'z', append() {}, 살림따라가기() {} });
  const 갈래 = new Threads(s, {}, 새store, { id: 'y', append() {}, 살림따라가기() {} });
  갈래.새로('둘째');
  const 빠진것 = Object.keys(s.usage).filter((k) => !(k in 갈래.현재().usage));
  check('★ 새 갈래의 셈 그릇이 본줄기와 같은 칸을 갖는다', 빠진것.length === 0,
    `빠진 칸: ${빠진것.join(', ') || '없음'}`);
}

trace('5-끝');

for (const d of 치움) { try { rmSync(d, { recursive: true, force: true }); } catch { /* 임시 폴더다 */ } }

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n대화 셈 검사  ${D}(화면과 모델이 받는 숫자가 실제와 같은가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
