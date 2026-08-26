// 되돌리면 **대화도 같이 되감기는가.**
//
// ── 왜 이걸 재나 ────────────────────────────────────────────────────────
//
// `/undo` 는 파일만 되돌렸다. 대화에는 "src/runner.js 를 고쳤습니다" 가 그대로
// 남아 있었다. 그러니 되돌린 다음 턴에서 모델은 **이미 고쳐 놓은 줄 알고**
// 그 위에 이어서 일한다 — 없는 코드를 고치려 들고, 없는 함수를 부른다.
//
// 사람 눈에는 이게 모델이 헛소리하는 것으로 보인다. 사실은 우리가 파일만
// 되돌리고 기억은 안 되돌려서, **모델에게 거짓말을 남겨 둔 것**이다.
//
// opencode·Cline·Kilo 는 스냅샷을 되감을 때 대화까지 같이 되감는다. 그게 맞다.
//
// ── 제일 조심할 자리 ────────────────────────────────────────────────────
//
// 말을 잘라 내다 **짝이 깨지면** 다음 요청이 서버에서 400 으로 튕긴다 —
// 도구를 부른 assistant 메시지만 남고 그 결과가 없는 상태다. 되돌리기가
// 대화를 아예 못 쓰게 만드는 셈이라, 그것만은 절대 안 된다.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/agent/session.js';
import { History } from '../src/safety/undo.js';
import { Store } from '../src/agent/store.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', model: '검사용', ctx: 32768 };
const root = mkdtempSync(join(tmpdir(), 'deel-rewind-'));

let 방번호 = 0;
const 새것 = () => {
  const 방 = join(root, `방${++방번호}`);
  const s = new Session(conn, { root: 방 });
  const h = new History(방);
  return { s, h, 방 };
};

/** 턴 하나를 흉내 낸다 — 되돌리기 턴을 열고, 자리를 표시하고, 말을 쌓는다. */
const 한턴 = (s, h, 사람말, 말들 = []) => {
  const 턴 = h.nextTurn();
  s.턴시작(턴);
  s.push({ role: 'user', content: 사람말 });
  for (const m of 말들) s.push(m);
  return 턴;
};

trace('1-턴자리표시');

// ── 턴이 어디서 시작했는지 적어 두는가 ──────────────────────────────────
{
  const { s, h } = 새것();
  check('처음엔 표시가 없다', s.턴자리().length === 0, JSON.stringify(s.턴자리()));

  const t1 = 한턴(s, h, '첫 부탁', [{ role: 'assistant', content: '했습니다' }]);
  check('턴을 열면 자리가 하나 생긴다', s.턴자리().length === 1, JSON.stringify(s.턴자리()));
  check('그 자리가 사람 말 바로 앞이다', s.턴자리()[0].자리 === 0, JSON.stringify(s.턴자리()[0]));
  check('턴 번호를 같이 적는다', s.턴자리()[0].턴 === t1, `${s.턴자리()[0].턴} / ${t1}`);

  한턴(s, h, '둘째 부탁', [{ role: 'assistant', content: '또 했습니다' }]);
  check('둘째 턴 자리는 그 앞까지 쌓인 만큼', s.턴자리()[1].자리 === 2,
    JSON.stringify(s.턴자리().map((x) => x.자리)));
}

trace('2-되감기');

// ── 되감으면 그 턴의 말이 사라지는가 ────────────────────────────────────
{
  const { s, h } = 새것();
  한턴(s, h, '첫 부탁', [{ role: 'assistant', content: '첫 답' }]);
  const t2 = 한턴(s, h, '둘째 부탁', [{ role: 'assistant', content: '둘째 답' }]);

  check('되감기 전엔 넷', s.messages.length === 4, String(s.messages.length));

  const r = s.되감기([t2]);
  check('둘째 턴 말이 사라진다', s.messages.length === 2, JSON.stringify(s.messages.map((m) => m.content)));
  check('몇 개를 걷었는지 알려 준다', r.걷은것 === 2, JSON.stringify(r));
  check('걷어낸 사람 말을 돌려준다 — 다시 치기 쉽게', r.사람말 === '둘째 부탁', String(r.사람말));

  check('첫 턴은 그대로 남는다',
    s.messages[0]?.content === '첫 부탁' && s.messages[1]?.content === '첫 답',
    JSON.stringify(s.messages.map((m) => m.content)));
  check('되감은 턴의 자리표도 지운다', s.턴자리().length === 1, JSON.stringify(s.턴자리()));
}

trace('3-여러턴');

// ── 두 턴을 한 번에 ─────────────────────────────────────────────────────
{
  const { s, h } = 새것();
  한턴(s, h, '하나', [{ role: 'assistant', content: 'A' }]);
  const t2 = 한턴(s, h, '둘', [{ role: 'assistant', content: 'B' }]);
  const t3 = 한턴(s, h, '셋', [{ role: 'assistant', content: 'C' }]);

  const r = s.되감기([t2, t3]);
  check('두 턴 어치가 한꺼번에 사라진다', s.messages.length === 2,
    JSON.stringify(s.messages.map((m) => m.content)));
  check('걷은 개수가 맞다', r.걷은것 === 4, JSON.stringify(r));
  // 여러 턴이면 **제일 오래된** 턴이 시작한 자리까지 간다.
  check('사람 말은 제일 오래된 것을 돌려준다', r.사람말 === '둘', String(r.사람말));
}

trace('4-짝이깨지면안된다');

// ── 자르다 도구 짝이 깨지면 안 된다 ─────────────────────────────────────
//
// 여기가 제일 위험하다. 도구를 부른 assistant 메시지만 남고 그 결과가 없으면
// 다음 요청이 서버에서 400 으로 튕긴다 — 되돌리기가 대화를 아예 못 쓰게 만든다.
{
  const { s, h } = 새것();
  한턴(s, h, '읽어줘', [
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'Read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '내용' },
    { role: 'assistant', content: '읽었습니다' },
  ]);
  const t2 = 한턴(s, h, '고쳐줘', [
    { role: 'assistant', content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'Edit', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c2', content: '고침' },
    { role: 'assistant', content: '고쳤습니다' },
  ]);

  s.되감기([t2]);
  const 부른것 = new Set();
  const 답한것 = new Set();
  for (const m of s.messages) {
    for (const tc of m.tool_calls ?? []) 부른것.add(tc.id);
    if (m.role === 'tool' && m.tool_call_id) 답한것.add(m.tool_call_id);
  }
  check('결과 없는 도구 호출이 안 남는다', [...부른것].every((id) => 답한것.has(id)),
    `부름 ${[...부른것]} / 답 ${[...답한것]}`);
  check('부모 없는 도구 결과도 안 남는다', [...답한것].every((id) => 부른것.has(id)),
    `부름 ${[...부른것]} / 답 ${[...답한것]}`);
  check('남은 것은 첫 턴 넷', s.messages.length === 4, String(s.messages.length));
}

trace('5-안건드리는것');

// ── 되감아도 안 건드리는 것 ─────────────────────────────────────────────
//
// 못 박은 말은 오간 말 쪽에 없다(시스템 프롬프트에 붙는다). 되감기가 거기까지
// 손대면 "접어도 요약해도 안 지워진다" 는 약속이 깨진다.
{
  const { s, h } = 새것();
  s.못박은것?.더하기?.('src/legacy 는 건드리지 마세요');
  const 전 = s.systemPrompt();
  const t1 = 한턴(s, h, '뭔가', [{ role: 'assistant', content: '함' }]);
  s.되감기([t1]);
  check('못 박은 말은 그대로', s.systemPrompt() === 전, '시스템 프롬프트가 달라졌습니다');
  check('말은 다 사라졌다', s.messages.length === 0, String(s.messages.length));
}

trace('6-되감을게없으면');

// ── 되감을 것이 없으면 ──────────────────────────────────────────────────
{
  const { s, h } = 새것();
  한턴(s, h, '하나', [{ role: 'assistant', content: 'A' }]);
  const r = s.되감기([]);
  check('빈 목록이면 아무 일도 안 난다', s.messages.length === 2 && r.걷은것 === 0, JSON.stringify(r));
  const r2 = s.되감기([99999]);
  check('모르는 턴이어도 안 죽는다', s.messages.length === 2 && r2.걷은것 === 0, JSON.stringify(r2));
  check('이상한 값이 와도 안 죽는다', s.되감기(null).걷은것 === 0);
}

trace('7-되돌리기가턴번호를준다');

// ── History 가 어느 턴을 되돌렸는지 알려 주는가 ─────────────────────────
//
// 지금은 **개수만** 준다. 개수로는 어느 말을 걷어야 할지 알 수 없다.
{
  const { h, 방 } = 새것();
  const p = join(방, 'a.txt');
  writeFileSync(p, '처음', 'utf8');

  const t1 = h.nextTurn();
  h.snapshot(p, '검사');
  writeFileSync(p, '한 번 고침', 'utf8');

  const t2 = h.nextTurn();
  h.snapshot(p, '검사');
  writeFileSync(p, '두 번 고침', 'utf8');

  const r = h.undo(1);
  check('되돌린 턴 번호를 준다', Array.isArray(r.turnIds) && r.turnIds.length === 1,
    JSON.stringify(r.turnIds));
  check('그 번호가 방금 턴이다', r.turnIds?.[0] === t2, `${r.turnIds?.[0]} / ${t2}`);
  check('개수도 그대로 준다 — 쓰던 자리가 안 깨진다', r.turns === 1, String(r.turns));
  check('파일도 되돌아갔다', readFileSync(p, 'utf8') === '한 번 고침', readFileSync(p, 'utf8'));
  void t1;
}

trace('8-저장파일도줄어든다');

// ── 다음에 이어 열면 되감긴 상태여야 한다 ───────────────────────────────
//
// 화면에서만 걷어내고 적어 둔 것은 그대로면, `--resume` 으로 열 때 되돌린
// 말이 되살아난다. 되돌리기가 다음 번에 무효가 되는 셈이다.
{
  const { s, h, 방 } = 새것();
  const store = new Store(방);
  store.begin({ model: conn.model, base: conn.base, root: 방 });

  const 적으며 = (m) => { s.push(m); store.append(m); };
  const t1 = h.nextTurn(); s.턴시작(t1);
  적으며({ role: 'user', content: '첫' }); 적으며({ role: 'assistant', content: '첫답' });
  const t2 = h.nextTurn(); s.턴시작(t2);
  적으며({ role: 'user', content: '둘' }); 적으며({ role: 'assistant', content: '둘답' });

  check('적어 둔 것이 넷', store.load().messages.length === 4, String(store.load().messages.length));

  s.되감기([t2]);
  store.replace(s.messages, '되감기');
  const 다시 = store.load().messages;
  check('저장 파일도 둘로 줄어든다', 다시.length === 2, JSON.stringify(다시.map((m) => m.content)));
  check('남은 것이 첫 턴이다', 다시[0]?.content === '첫', JSON.stringify(다시.map((m) => m.content)));
  check('파일이 그대로 있다', existsSync(store.file ?? '') || true);
}

rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n되감기 검사  ${D}(되돌리면 대화도 같이 되감기는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
