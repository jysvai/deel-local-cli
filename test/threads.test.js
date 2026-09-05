// 한 창에서 대화를 여러 갈래로 굴리는지 검증한다.
//
// 여기서 재야 하는 것은 '갈래가 생겼다' 가 아니다. 그건 배열 하나 더 만들면 된다.
// 실제로 확인할 것은 셋이다.
//
//   1) 갈래끼리 **컨텍스트가 안 섞이는가** — 이게 안 되면 만든 이유가 없다
//   2) 오갔다 와도 하던 말이 그대로 있는가 — 잃어버리면 창을 새로 여는 것만 못하다
//   3) 갈래마다 저장 파일이 따로 남는가 — 한 파일에 섞이면 이어하기가 두 대화를
//      한 줄기로 읽는다
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Threads } from '../src/agent/threads.js';
import { Store } from '../src/agent/store.js';
import { Session } from '../src/agent/session.js';
import { statusLine } from '../src/ui/status.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const root = mkdtempSync(join(tmpdir(), 'deel-thread-'));
const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', model: '스텁모델', ctx: 32768 };

trace('1-갈래만들기');

const session = new Session(conn, { root });
const ctx = { todos: null };
const 첫store = new Store(root, 'thr-001');
첫store.begin({ model: conn.model, root });
session.push({ role: 'user', content: '로그 형식 통일해줘' });
session.push({ role: 'assistant', content: 'runner.js 를 고쳤습니다' });

const 갈래 = new Threads(session, ctx, () => new Store(root).begin({ model: conn.model, root }), 첫store);

check('처음엔 갈래가 하나', 갈래.개수() === 1);
check('그 하나는 본줄기', 갈래.현재().이름 === '본줄기');
check('갈래가 하나면 상태줄에 안 뜬다', !/⑂/.test(statusLine(session)), statusLine(session).slice(0, 40));

trace('2-곁가지로나가기');

// ── 곁가지를 딴 자리에서 ────────────────────────────────────────────────
const 곁 = 갈래.새로('오류확인');
check('새 갈래로 옮겨진다', 갈래.현재().이름 === '오류확인' && 갈래.개수() === 2);
check('새 갈래는 빈 대화', session.messages.length === 0, `${session.messages.length}개`);
check('토큰 셈도 새로 시작', session.usage.in === 0 && session.usage.calls === 0);
check('둘 이상이면 상태줄에 뜬다', /⑂/.test(statusLine(session)), statusLine(session).slice(0, 60));

session.push({ role: 'user', content: 'TypeError 이거 뭐야' });
session.push({ role: 'assistant', content: '널 참조입니다' });
session.usage.in = 500;

trace('3-본줄기로돌아가기');

// ── 돌아왔을 때 하던 말이 그대로인가 ────────────────────────────────────
갈래.옮기기('1');
check('본줄기로 돌아온다', 갈래.현재().이름 === '본줄기');
check('하던 말이 그대로 있다', session.messages.length === 2
  && session.messages[0].content === '로그 형식 통일해줘', `${session.messages.length}개`);
check('곁가지 말이 안 섞였다', !session.messages.some((m) => String(m.content).includes('TypeError')));
check('곁가지 토큰도 안 섞였다', session.usage.in === 0, `${session.usage.in}`);

갈래.옮기기('오류확인');
check('이름 일부로도 찾아간다', 갈래.현재().이름 === '오류확인');
check('곁가지 말도 그대로 남아 있다', session.messages.some((m) => String(m.content).includes('TypeError')));
check('곁가지 토큰도 그대로', session.usage.in === 500, `${session.usage.in}`);

trace('4-할일목록도따로');

// 할 일 목록은 ctx 에 붙어 있다. 이것도 갈래를 따라와야 한다 —
// 곁가지에서 만든 목록이 본줄기 화면에 뜨면 무엇을 하던 중이었는지가 흐려진다.
ctx.todos = [{ id: 1, text: '오류 자리 찾기', state: 'doing' }];
갈래.옮기기(1);
check('본줄기에는 곁가지 할 일이 안 보인다', !ctx.todos?.length, JSON.stringify(ctx.todos));
갈래.옮기기(2);
check('곁가지로 오면 할 일이 돌아온다', ctx.todos?.[0]?.text === '오류 자리 찾기');

trace('5-갈라내기');

// ── 지금까지를 물려받아 갈라 나가기 ─────────────────────────────────────
갈래.옮기기(1);
const 갈라낸것 = 갈래.갈라내기('다른방법');
check('갈라낸 갈래가 생긴다', 갈래.개수() === 3 && 갈래.현재().이름 === '다른방법');
check('앞엣말을 그대로 물려받는다', session.messages.length === 2
  && session.messages[0].content === '로그 형식 통일해줘');
session.push({ role: 'user', content: '이번엔 다르게 가보자' });
갈래.옮기기(1);
check('갈라낸 뒤 본줄기는 안 바뀐다', session.messages.length === 2,
  `${session.messages.length}개 — 물려줄 때 배열을 복사 안 하면 여기서 3개가 된다`);

trace('6-저장파일');

// ── 갈래마다 파일이 따로 ────────────────────────────────────────────────
const ids = 갈래.목록().map((r) => r.id);
check('갈래마다 저장 파일이 따로 열린다', new Set(ids).size === 3, ids.join(' · '));
const 갈라낸파일 = readFileSync(join(root, '.deel', 'sessions', `${갈라낸것.store.id}.jsonl`), 'utf8');
check('갈라낸 갈래 파일에 앞엣말도 적힌다', 갈라낸파일.includes('로그 형식 통일해줘'),
  `${갈라낸파일.split('\n').filter(Boolean).length}줄`);

trace('7-닫기');

// ── 닫기 ────────────────────────────────────────────────────────────────
갈래.옮기기(2);
const 닫은결과 = 갈래.닫기();
check('지금 갈래를 닫으면 옆으로 옮겨 간다', 닫은결과.ok && 갈래.개수() === 2 && 갈래.현재().이름 !== '오류확인',
  갈래.현재().이름);
check('닫아도 적어 둔 파일은 남는다', existsSync(join(root, '.deel', 'sessions', `${곁.store.id}.jsonl`)));
check('닫은 뒤에도 남은 갈래 말은 성하다', session.messages.length > 0, `${session.messages.length}개`);

갈래.닫기();
const 마지막 = 갈래.닫기();
check('마지막 하나는 못 닫는다', 마지막.ok === false && 갈래.개수() === 1, 마지막.why ?? '');
check('하나로 돌아오면 상태줄에서 사라진다', !/⑂/.test(statusLine(session)), statusLine(session).slice(0, 40));

check('없는 갈래로는 안 옮겨진다', 갈래.옮기기('없는이름') === null);
check('빈 말로도 안 옮겨진다', 갈래.옮기기('') === null);

trace('8-할일이껐다켜도살아남나');

// ── 껐다 켜도 남은 할 일과 시킨 말 원문이 살아난다 ──────────────────────
//
// 갈래를 붙이는 자리가 곧 이어하기가 되살아나는 자리다 (agent/store.js 의
// 살림따라가기). 여기서 안 붙이면 오간 말만 돌아오고 「무엇을 하다 말았나」 는
// 안 돌아온다 — 사람이 어제 시킨 것을 다시 다 적어 줘야 한다.
{
  const 살림root = mkdtempSync(join(tmpdir(), 'deel-thread-살림-'));
  const 새파일 = () => new Store(살림root).begin({ model: conn.model, root: 살림root });

  const 어제세션 = new Session(conn, { root: 살림root });
  const 어제store = new Store(살림root, 'thr-살림');
  어제store.begin({ model: conn.model, root: 살림root });
  const 어제갈래 = new Threads(어제세션, { todos: null }, 새파일, 어제store);
  어제세션.이번요청 = '로그·테스트·README 셋 다 고쳐줘';
  어제세션.할일 = [{ text: '로그', state: 'done' }, { text: 'README', state: 'pending' }];
  어제갈래.현재store().append({ role: 'user', content: 어제세션.이번요청 });

  // 창을 닫았다 — 세션도 저장 파일 손잡이도 새로 만든다.
  const 오늘세션 = new Session(conn, { root: 살림root });
  new Threads(오늘세션, { todos: null }, 새파일, new Store(살림root, 'thr-살림'));
  check('이어받으면 남은 할 일이 돌아온다',
    JSON.stringify(오늘세션.할일) === JSON.stringify(어제세션.할일), JSON.stringify(오늘세션.할일));
  check('이어받으면 시킨 말 원문도 돌아온다', 오늘세션.이번요청 === 어제세션.이번요청, 오늘세션.이번요청);

  // 곁가지에서 적은 할 일이 본줄기 파일로 새면 안 된다 — 이어받을 때 본줄기에
  // 하지도 않은 일이 남는다.
  const 곁가지 = 어제갈래.새로('곁');
  어제세션.할일 = [{ text: '곁가지에서만 한 일', state: 'pending' }];
  어제갈래.현재store().append({ role: 'user', content: '곁가지 말' });
  check('곁가지 파일에는 적힌다',
    readFileSync(join(살림root, '.deel', 'sessions', `${곁가지.store.id}.jsonl`), 'utf8')
      .includes('곁가지에서만 한 일'));

  // 갈래를 오가도 각자 것이 그대로여야 한다. 안 그러면 곁가지에서 적은 할 일을
  // 들고 본줄기로 돌아와 본줄기 파일에 적어 버린다 — 이어받을 때 하지도 않은
  // 일이 본줄기에 남는다.
  어제갈래.옮기기(1);
  check('본줄기로 돌아오면 본줄기 할 일이 돌아온다', 어제세션.할일?.[0]?.text === '로그',
    JSON.stringify(어제세션.할일));
  check('본줄기 시킨 말도 그대로', 어제세션.이번요청 === '로그·테스트·README 셋 다 고쳐줘', 어제세션.이번요청);
  어제갈래.현재store().append({ role: 'user', content: '본줄기에서 한마디 더' });
  const 본줄기글 = readFileSync(join(살림root, '.deel', 'sessions', 'thr-살림.jsonl'), 'utf8');
  check('곁가지 할 일이 본줄기 파일에 안 샌다', !본줄기글.includes('곁가지에서만 한 일'),
    본줄기글.split('\n').filter((l) => l.includes('"t":"todo"')).join(' '));

  어제갈래.옮기기(2);
  check('곁가지로 오면 곁가지 할 일이 돌아온다', 어제세션.할일?.[0]?.text === '곁가지에서만 한 일',
    JSON.stringify(어제세션.할일));

  rmSync(살림root, { recursive: true, force: true });
}

trace('7-파일기억도-갈래마다');

/*
 * ── 「앞에서 읽은 그대로입니다」 는 그 갈래에 그 글이 있을 때만 참이다 ────
 *
 * 파일기억은 세션에 딱 하나였다. 그런데 messages 는 갈래마다 따로다. 둘이
 * 어긋나면 이런 일이 난다 —
 *
 *   ① 곁가지로 나가면 대화는 0개인데, 거기서 같은 파일을 읽으면
 *      「앞에서 읽은 그대로입니다 — 앞에 실린 내용을 그대로 쓰세요」 가 온다.
 *      그 갈래에는 그 글이 한 줄도 없다. 모델은 없는 글을 가리키는 쪽지를
 *      받고 다시 읽는데, 파일이 안 바뀌었으니 두 번째도 같은 쪽지다.
 *      세 번째에 loop.js 가 「같은 자리에서 헛돌고 있습니다」 로 턴을 죽인다.
 *
 *   ② 더 나쁜 쪽: 본줄기에서 v1 을 읽고 → 곁가지에서 그 파일을 v2 로 고쳐
 *      읽고 → 본줄기로 돌아와 읽으면, 기억은 v2 를 들고 있어 「안 바뀌었다」
 *      고 답한다. 그런데 본줄기 대화에 실려 있는 것은 v1 이다. 모델은 옛
 *      내용을 지금 파일로 믿고 Edit 을 건다.
 *
 * filemem.js 머리말이 「통째로 다시 싣는 것보다 훨씬 나쁘다」 고 적어 둔 바로
 * 그 상태다. 그래서 기억도 messages 와 **같이** 다닌다.
 */
{
  const 긴글 = (v) => Array.from({ length: 200 }, (_, i) => `${i}: ${v} 줄입니다`).join('\n');
  const s = new Session(conn, { root });
  const c = { todos: null };
  const st = new Store(root, 'thr-mem').begin({ model: conn.model, root });
  const t = new Threads(s, c, () => new Store(root).begin({ model: conn.model, root }), st);

  // 본줄기에서 한 번 읽는다 — 대화에 통째로 실린다.
  const 첫 = s.파일기억.실을것('/p/a.js', 긴글('v1'));
  s.push({ role: 'user', content: 첫.글 });
  check('먼저: 본줄기에서는 통째로 실린다', 첫.어떻게 === 'full', 첫.어떻게);

  // 곁가지로 나간다. 대화는 0개다.
  t.새로('곁가지');
  check('먼저: 곁가지 대화는 비어 있다', s.messages.length === 0, String(s.messages.length));
  const 곁것 = s.파일기억.실을것('/p/a.js', 긴글('v1'));
  check('★★ 빈 갈래에서 읽으면 통째로 실린다',
    곁것.어떻게 === 'full' && !/앞에서 읽은 그대로/.test(곁것.글),
    `${곁것.어떻게} · ${곁것.글.slice(0, 40)}`);

  // 곁가지에서 그 파일이 v2 로 바뀌었다고 치고 읽어 둔다.
  s.파일기억.실을것('/p/a.js', 긴글('v2'));

  // 본줄기로 돌아온다. 여기 실려 있는 것은 v1 이다.
  t.옮기기('본줄기');
  check('먼저: 본줄기 대화가 돌아왔다', s.messages.length === 1, String(s.messages.length));
  const 돌아와서 = s.파일기억.실을것('/p/a.js', 긴글('v1'));
  check('★★ 본줄기로 돌아오면 이 갈래가 실은 것으로 견준다',
    돌아와서.어떻게 === 'same', 돌아와서.어떻게);

  // 갈라내기는 대화를 복사하니 기억도 복사해야 한다 — 공유하면 한쪽이
  // 고친 것이 다른 쪽 답을 바꾼다.
  t.갈라내기('복사본');
  const 복사본것 = s.파일기억.실을것('/p/a.js', 긴글('v1'));
  check('★ 갈라낸 갈래는 물려받은 기억으로 견준다', 복사본것.어떻게 === 'same', 복사본것.어떻게);
  s.파일기억.실을것('/p/a.js', 긴글('v3'));
  t.옮기기('본줄기');
  const 본줄기다시 = s.파일기억.실을것('/p/a.js', 긴글('v1'));
  check('★★ 갈라낸 쪽에서 읽은 것이 본줄기 기억을 안 흔든다',
    본줄기다시.어떻게 === 'same', 본줄기다시.어떻게);

  check('★ /context 가 세는 파일 수도 갈래 것이다',
    s.filesRead instanceof Map, String(s.filesRead?.constructor?.name));
}

rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n대화 갈래 검사  ${D}(한 창에서 여러 갈래를 굴리는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
