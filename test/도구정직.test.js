// 도구가 **했다고 말하는 것**과 실제로 한 것이 같은가.
//
// ── 왜 이 파일이 생겼나 ─────────────────────────────────────────────────
//
// 41회차에서 도구가 사는 파일(src/tools/index.js · 2,900줄)을 통째로 두 갈래로
// 훑었다. 나온 것이 전부 한 모양이었다 — **못 한 것이 아니라, 다른 것을 해
// 놓고 아무 말도 안 하는 것.** 실패는 화면에 뜬다. 틀린 값은 안 뜬다.
//
//   rm 로고.png
//     ↩ 로고.png 는 떠 뒀습니다 — /undo 로 되돌아갑니다
//        (그림은 내용을 못 떠서 /undo 가 손도 안 댄다. 파일은 영영 안 돌아온다)
//
//   Glob({pattern:'**/*.tsx', path:'srcs'})    ← 오타
//     찾은 파일 없음
//        (한 군데도 안 찾아봤다. 모델은 「이 프로젝트에 X 가 없다」 로 답을 맺는다)
//
//   Recall({query:'CP949'})
//     ✓ 지난 대화 12건 중 8건
//        (여덟 건의 **내용은 한 글자도 모델에게 안 갔다**)
//
// 그래서 여기서는 화면 문구가 아니라 **도구가 돌려준 것**을 잰다. 화면은
// 그 값을 그리는 것뿐이라, 값이 틀리면 화면도 반드시 틀린다.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from './trace.mjs';
import { TOOLS, runTool, 파일안생김 } from '../src/tools/index.js';
import { History } from '../src/safety/undo.js';
import { makeScope } from '../src/safety/guard.js';
import { 실을글 } from '../src/agent/loop.js';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// 감사기록은 이 검사의 관심 밖이다. 무엇을 불러도 조용히 받아 준다.
const 감사 = new Proxy({}, { get: () => () => {} });
const 새판 = () => {
  const root = mkdtempSync(join(tmpdir(), 'deel-정직-'));
  return {
    root,
    ctx: {
      scope: makeScope(root), history: new History(root), seen: new Set(),
      audit: 감사, 모델컨텍스트: 128000, enc: new Map(),
    },
  };
};
const 치움 = [];
const 판만들기 = () => { const p = 새판(); 치움.push(p.root); return p; };

trace('1-되돌릴수있다고-말하는-것');

// ── 1. 못 떠 둔 것을 「떠 뒀다」 고 하지 않는다 ─────────────────────────
//
// 되돌리기 이력은 파일 **원문**을 담는다. 그림·xlsx·zip 은 safeRead 가 내용을
// 못 떠서 `skipped` 로 들어가고, /undo 는 그런 기록을 만나면 그 파일을 아예
// 안 건드린다. 그런데 Bash 쪽은 snapshot() 의 답을 버리고 무조건 「떴다」
// 목록에 넣고 있었다. 안전망이 있다고 말하는데 없는 것 — 이 저장소에서 제일
// 나쁜 꼴이다.
{
  const { root, ctx } = 판만들기();
  writeFileSync(join(root, '로고.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  writeFileSync(join(root, '글.txt'), '한 줄\n');
  ctx.history.nextTurn();
  const r = await TOOLS.Bash.run({ command: 'del 로고.png 글.txt' }, ctx);
  check('★★ 못 뜬 것을 되돌릴 수 있다고 안 한다',
    !(r.되돌릴것 ?? []).some((x) => /로고\.png/.test(x)),
    `되돌릴것=${JSON.stringify(r.되돌릴것)}`);
  check('★ 못 뜬 것을 따로 적는다',
    (r.못뜬것 ?? []).some((x) => /로고\.png/.test(x)),
    `못뜬것=${JSON.stringify(r.못뜬것)}`);
  check('까닭도 같이 적는다', (r.못뜬것 ?? []).some((x) => /바이너리/.test(x)),
    JSON.stringify(r.못뜬것));
  check('뜬 것은 뜬 것대로 남는다', (r.되돌릴것 ?? []).some((x) => /글\.txt/.test(x)),
    `되돌릴것=${JSON.stringify(r.되돌릴것)}`);
}

// 대상이 상한을 넘으면 뒤엣것은 보지도 못한다 — 그것도 못 뜬 것이다.
{
  const { root, ctx } = 판만들기();
  const 이름들 = [];
  for (let i = 0; i < 40; i++) { 이름들.push(`f${i}.txt`); writeFileSync(join(root, `f${i}.txt`), 'x\n'); }
  ctx.history.nextTurn();
  const r = await TOOLS.Bash.run({ command: `del ${이름들.join(' ')}` }, ctx);
  check('★ 상한에 걸리면 걸렸다고 말한다', r.스냅샷상한걸림 === true,
    `뜬것=${(r.되돌릴것 ?? []).length}개 · 상한걸림=${r.스냅샷상한걸림}`);
  check('상한까지는 떠 둔다', (r.되돌릴것 ?? []).length >= 20,
    `${(r.되돌릴것 ?? []).length}개`);
}

trace('2-여러개-가운데-하나가-던질-때');

// ── 2. 던지는 것도 「하나가 실패한 것」 이다 ────────────────────────────
//
// Move 배열만 try 없이 부르고 있었다. scope.resolve 가 범위 밖에서 던지면 그
// 예외가 통째로 나가, **이미 옮겨진 파일이 결과에서 사라진다.** 디스크는
// 움직였는데 턴 끝 목록도 /commit 도 「아무 일도 없었다」 로 안다.
{
  const { root, ctx } = 판만들기();
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'a.js'), 'a\n');
  writeFileSync(join(root, 'b.js'), 'b\n');
  ctx.history.nextTurn();
  const r = await runTool('Move', {
    moves: [{ from: 'a.js', to: 'src/a.js' }, { from: 'b.js', to: '../밖/b.js' }],
  }, ctx);
  check('a.js 는 실제로 옮겨졌다', existsSync(join(root, 'src', 'a.js')));
  check('★★ 옮겨진 것을 결과가 안 버린다', (r.바뀐것들 ?? []).some((p) => /a\.js$/.test(p)),
    `바뀐것들=${JSON.stringify(r.바뀐것들)}`);
  check('★ 막힌 것도 같이 적는다', /밖\/b\.js/.test(String(r.content ?? r.error)),
    String(r.content ?? r.error).slice(0, 100));
  check('하나라도 됐으면 통째로 오류가 아니다', !r.error, String(r.error ?? '').slice(0, 80));
}

trace('3-안-찾아본-것을-없다고-하지-않는다');

// ── 3. 「없다」 와 「안 찾아봤다」 는 다르다 ─────────────────────────────
//
// walk() 는 readdirSync 실패를 삼킨다. 그래서 오타 난 폴더가 **빈 배열**이
// 되고, 잘림도 건너뜀도 0이라 꼬리말조차 안 붙었다. 이 파일의 다른 자리들이
// 「못 찾은 것과 안 본 것은 다르다」 를 세 번이나 적어 뒀는데, 정작 뿌리
// 경로가 없는 경우만 아무도 안 봤다.
{
  const { root, ctx } = 판만들기();
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.tsx'), 'export const A = 1;\n');

  const g = await runTool('Glob', { pattern: '**/*.tsx', path: 'srcs' }, ctx);
  check('★★ 없는 폴더를 「없음」 이라고 안 한다', !!g.error && !/찾은 파일 없음/.test(String(g.content ?? '')),
    String(g.error ?? g.content).slice(0, 90));
  check('★ 한 글자도 안 찾아봤다고 말한다', /안 찾아봤습니다/.test(String(g.error ?? '')),
    String(g.error ?? '').slice(0, 90));
  check('되풀이해도 소용없다고 표를 단다', g.끝났다 === true);

  const p = await runTool('Grep', { pattern: 'A', path: 'srcs' }, ctx);
  check('★ Grep 도 같다', !!p.error && /안 찾아봤습니다/.test(String(p.error)),
    String(p.error ?? p.content).slice(0, 90));

  // 있는 폴더는 그대로 찾는다 — 문을 너무 세게 닫지 않았나 본다.
  const 제대로 = await runTool('Glob', { pattern: '**/*.tsx', path: 'src' }, ctx);
  check('있는 폴더는 그대로 찾는다', /a\.tsx/.test(String(제대로.content ?? '')),
    String(제대로.content ?? 제대로.error).slice(0, 80));

  // 폴더 자리에 파일을 주면 그것도 말해 준다.
  const 파일을 = await runTool('Glob', { pattern: '*.tsx', path: 'src/a.tsx' }, ctx);
  check('폴더가 아니라 파일이라고 말한다', /폴더가 아니라 파일/.test(String(파일을.error ?? '')),
    String(파일을.error ?? '').slice(0, 80));
}

trace('4-찾아-놓고-안-주는-것');

// ── 4. Recall 이 찾아낸 것을 모델에게 준다 ──────────────────────────────
//
// 대화에 실리는 것은 content 하나다. 못 찾은 갈래는 앞선 회차에서 이미
// 고쳤는데 **찾은** 갈래가 그대로였다. 맞은 것을 `text` 에 담아 돌려주고,
// `text` 를 읽는 자리는 저장소 어디에도 없다.
{
  const { root, ctx } = 판만들기();
  const 대화방 = join(root, '.deel', 'sessions');
  mkdirSync(대화방, { recursive: true });
  const 줄 = (누구, 글) => JSON.stringify({ role: 누구, content: 글, at: new Date().toISOString() });
  writeFileSync(join(대화방, '옛대화.jsonl'), [
    줄('user', '사내 문서가 CP949 인코딩이라 깨집니다'),
    줄('assistant', 'CP949 로 읽고 CP949 로 되돌려 쓰게 고쳤습니다'),
  ].join('\n') + '\n');

  const r = await runTool('Recall', { query: 'CP949' }, ctx);
  const 실린것 = 실을글(r);
  check('맞은 것을 찾기는 한다', (r.hits ?? []).length > 0, `hits=${(r.hits ?? []).length}`);
  check('★★ 찾아낸 **내용**이 모델에게 간다', /CP949/.test(실린것) && 실린것.length > 60,
    실린것.replace(/\s+/g, ' ').slice(0, 110));
  check('★ 요약만 가지 않는다', 실린것.split('\n').length > 1,
    `${실린것.split('\n').length}줄`);
}

trace('5-숫자가-사실인가');

// ── 5. 화면에 뜨는 숫자가 디스크와 같은가 ───────────────────────────────
{
  const { root, ctx } = 판만들기();

  // 0바이트 빈 파일은 0줄이다. 여태 ''.split('\n') 이 1줄로 세어져서,
  // Append 로 큰 파일을 만드는 내내 **하나 더 많은 수**가 모델에게 갔다.
  writeFileSync(join(root, '빈.txt'), '');
  ctx.history.nextTurn();
  const a = await runTool('Append', { file_path: '빈.txt', content: '한 줄\n' }, ctx);
  check('★ 빈 파일에 한 줄 붙이면 1줄이다', /전체 1줄/.test(String(a.content)),
    String(a.content));
  check('디스크와 맞는다', readFileSync(join(root, '빈.txt'), 'utf8').split('\n').filter(Boolean).length === 1);

  // 고친 군데 수를 사람이 읽을 요약 글에서 되뽑고 있었다. 그 글은
  // toLocaleString() 을 타므로 1,000군데를 넘으면 `1` 만 집혔다.
  writeFileSync(join(root, 'big.css'), Array.from({ length: 1200 }, () => 'a{color:#fff}').join('\n'));
  ctx.seen.add(join(root, 'big.css'));
  ctx.history.nextTurn();
  const e = await runTool('Edit', {
    edits: [{ file_path: 'big.css', old_string: '#fff', new_string: '#eee', replace_all: true }],
  }, ctx);
  const 센수 = (e.여럿 ?? [])[0]?.군데;
  check('★★ 1,000군데를 넘어도 수가 안 무너진다', 센수 === 1200, `군데=${센수}`);
  check('디스크와 맞는다', readFileSync(join(root, 'big.css'), 'utf8').split('#eee').length - 1 === 1200);
}

trace('6-확장자만-그것인-파일');

// ── 6. 없는 파일은 검사가 통째로 없었다 ─────────────────────────────────
//
// 바이너리인가() 는 existsSync 가 거짓이면 null 을 준다. 그래서 아직 없는
// `.hwpx`·`.png` 는 아무 검사도 안 거치고 확장자만 그것인 글 파일이 됐다.
// 화면에는 `새로 만듦: 주간보고.hwpx (+40줄)` 이 뜨고, 한글에서는 안 열린다.
{
  const { root, ctx } = 판만들기();
  ctx.history.nextTurn();
  const h = await runTool('Append', { file_path: '주간보고.hwpx', content: '# 이번 주\n' }, ctx);
  check('★ Append 로 hwpx 를 글로 못 만든다', !!h.error, String(h.content ?? '').slice(0, 70));
  check('hwpx 가 안 생겼다', !existsSync(join(root, '주간보고.hwpx')));

  const p = await runTool('Write', { file_path: '로고.png', content: 'x' }, ctx);
  check('★ Write 로 png 를 글로 못 만든다', !!p.error, String(p.content ?? '').slice(0, 70));
  check('png 가 안 생겼다', !existsSync(join(root, '로고.png')));

  // Append 쪽에도 그림 막이가 따로 있다. hwpx 만 재고 넘어갔더니 이 막이가
  // 검사 없이 서 있었다 — 지우는 사람을 아무도 안 막는 상태였다.
  const ap = await runTool('Append', { file_path: '그림/새로고.png', content: '가나다\n' }, ctx);
  // 「그림 이름이라 막았다」 인지까지 본다. 그냥 !!error 로 두면 폴더가 없어서
  // 난 오류로도 초록이 되고, 그러면 이 막이를 지워도 검사가 안 빨개진다.
  check('★ Append 로도 png 를 글로 못 만든다', /그림 파일 이름/.test(String(ap.error)),
    String(ap.content ?? ap.error).slice(0, 70));
  check('Append 가 만든 png 도 없다', !existsSync(join(root, '그림/새로고.png')));

  mkdirSync(join(root, '어떤폴더'), { recursive: true });
  const d = await runTool('Write', { file_path: '어떤폴더', content: 'x' }, ctx);
  check('★ 폴더에 쓰면 사람 말로 거절한다',
    /폴더입니다/.test(String(d.error)) && !/EISDIR/.test(String(d.error)),
    String(d.error).slice(0, 70));
}

trace('7-빈-턴이-되돌리기를-먹는다');

// ── 7. 아무것도 안 바꾼 턴이 /undo 한 번을 먹는다 ───────────────────────
//
// 스냅샷을 먼저 뜨고 그 아래 인코딩 검사에서 거절당하면, 파일은 한 글자도
// 안 바뀌었는데 이력에는 그 턴이 남는다. `/undo` 는 같은 내용을 다시 써
// 놓고 「파일 1개를 되돌렸습니다」 를 찍고, 정작 되돌리려던 앞 턴의 진짜
// 변경은 그대로 남는다.
{
  const { root, ctx } = 판만들기();
  const 파일 = join(root, '사내문서.txt');
  // CP949 로 만든다. 아래에서 그 인코딩에 없는 글자를 넣어 거절당하게 한다.
  writeFileSync(파일, Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x0a]));   // '한글\n'

  // ① 진짜 변경 하나
  ctx.history.nextTurn();
  await runTool('Write', { file_path: '사내문서.txt', content: '바뀐 내용\n' }, ctx);
  const 진짜바뀐뒤 = readFileSync(파일);

  // ② 이모지를 넣어 거절당하는 턴
  ctx.history.nextTurn();
  const 거절 = await runTool('Write', { file_path: '사내문서.txt', content: '이모지 🎉\n' }, ctx);
  check('인코딩에 없는 글자는 거절한다', !!거절.error, String(거절.error ?? '').slice(0, 60));
  check('파일이 안 바뀌었다', Buffer.compare(readFileSync(파일), 진짜바뀐뒤) === 0);

  const 턴수 = ctx.history.turns().length;
  check('★★ 아무것도 안 바꾼 턴은 이력에 안 남는다', 턴수 === 1, `턴 ${턴수}개`);

  // 그래서 /undo 한 번이 **진짜** 변경을 되돌린다.
  const u = ctx.history.undo(1);
  check('★ /undo 한 번이 진짜 변경을 되돌린다',
    u.restored.some((x) => x.ok === true) && Buffer.compare(readFileSync(파일), 진짜바뀐뒤) !== 0,
    `되돌린=${u.restored.length}개`);
}

trace('8-되돌리기가-제-무게로-무너질-때');

// ── 8. 이력 자체가 탈이 났을 때 그 사실이 밖으로 나오나 ─────────────────
//
// safety/undo.js 는 276줄인데 전용 검사가 하나도 없었다. 여기서 세 자리를 쥔다.
{
  const { root, ctx } = 판만들기();
  writeFileSync(join(root, 'a.txt'), '처음\n');
  ctx.history.nextTurn();
  await runTool('Write', { file_path: 'a.txt', content: '나중\n' }, ctx);

  // 깨진 줄 — 쓰다 죽으면 마지막 줄이 반만 적힌다. 그 줄은 곧 한 파일의
  // 원문이라, 깨졌다는 것은 그 파일을 되돌릴 길이 사라졌다는 뜻이다.
  const 이력파일 = join(root, '.deel', 'history', 'edits.jsonl');
  writeFileSync(이력파일, readFileSync(이력파일, 'utf8') + '{"turn":1,"pa\n');
  const 것들 = ctx.history.all();
  check('★★ 깨진 줄을 센다', ctx.history.깨진줄 === 1, `깨진줄=${ctx.history.깨진줄}`);
  check('멀쩡한 줄은 그대로 읽는다', 것들.length >= 1, `${것들.length}줄`);

  const u = ctx.history.undo(1);
  check('★ 되돌린 결과에 깨진 줄 수가 실린다', u.깨진줄 === 1, `깨진줄=${u.깨진줄}`);
  check('되돌리기 자체는 됐다', u.restored.some((x) => x.ok === true));
  check('이력 줄이기가 됐으면 됐다고 한다', u.이력줄임?.ok === true, JSON.stringify(u.이력줄임));
}

// prune 이 실패하면 「0개 버렸다」 와 같은 값으로 돌려주고 있었다. 부르는
// 쪽은 둘을 구별할 길이 없고, 실패는 대개 이어지는 종류라 이력은 32MB 를
// 넘긴 채 끝없이 자라는데 화면에는 영영 안 떴다.
{
  const { root } = 판만들기();
  const h = new History(root);
  for (let t = 0; t < 60; t++) {
    h.nextTurn();
    h.snapshot(join(root, `f${t}.txt`), 'Write');
  }
  check('줄일 것이 있으면 줄인다', h.prune({ keep: 10 }) > 0);
  check('줄이고 나면 못함 표가 지워진다', h.줄이기못함 === null, String(h.줄이기못함));

  // 이력 파일 자리를 폴더로 바꿔 쓰기를 막는다 — 읽기 전용 판과 같은 꼴이다.
  rmSync(h.file);
  mkdirSync(h.file, { recursive: true });
  h.turn = 0;
  const 버린수 = h.prune({ keep: 1 });
  check('★★ 못 줄인 것을 「0개 버렸다」 로 안 넘긴다', h.줄이기못함 !== null,
    `버린수=${버린수} · 줄이기못함=${String(h.줄이기못함).slice(0, 50)}`);
}

/*
 * ── **읽기는 되는데 쓰기가 막힌** 판 ────────────────────────────────────
 *
 * 위 판은 이력 자리를 폴더로 바꿔서 **읽기**부터 막는다. 그러면 prune 의
 * 앞쪽 catch 가 받는데, 실패를 적는 자리는 앞뒤로 둘이다. 뒤쪽(쓰기 실패)은
 * 이 검사가 한 번도 안 지나가서, 어긋내기 판이 그 줄을 지웠을 때 아무도
 * 안 막았다. 읽기 전용 디스크·꽉 찬 디스크가 딱 이 꼴이다.
 */
{
  const { root } = 판만들기();
  const h = new History(root);
  for (let t = 0; t < 60; t++) { h.nextTurn(); h.snapshot(join(root, `g${t}.txt`), 'Write'); }
  h.prune({ keep: 10 });

  chmodSync(h.file, 0o444);            // 읽기는 되고 쓰기만 막힌다
  h.turn = 0;
  const 버린수 = h.prune({ keep: 1 });
  const 못쓰나 = h.줄이기못함 !== null;
  chmodSync(h.file, 0o666);
  check('★★ 읽기는 되는데 못 쓴 것도 못 줄인 것이다', 못쓰나,
    `버린수=${버린수} · 줄이기못함=${String(h.줄이기못함).slice(0, 50)}`);
}

/*
 * ── 되돌린 **뒤** 이력 쓰기가 막히면 ────────────────────────────────────
 *
 * 파일은 이미 되돌아가 있다. 그런데 그 턴이 이력에 그대로 남으므로, 사람이
 * 「실패했으니 다시」 하고 /undo 를 또 치면 같은 턴을 또 되돌린다 — 두 턴을
 * 되돌린 줄 알지만 한 턴이다. 그래서 undo() 가 그 사실을 돌려줘야 한다.
 */
{
  const { root } = 판만들기();
  const h = new History(root);
  const 파일 = join(root, '보고서.txt');
  writeFileSync(파일, '처음\n', 'utf8');
  h.nextTurn();
  h.snapshot(파일, 'Write');
  writeFileSync(파일, '고친 뒤\n', 'utf8');

  chmodSync(h.file, 0o444);
  const u = h.undo(1);
  chmodSync(h.file, 0o666);
  check('되돌리기 자체는 됐다 — 파일이 진짜로 돌아갔다',
    readFileSync(파일, 'utf8') === '처음\n', JSON.stringify(readFileSync(파일, 'utf8')));
  check('★★ 되돌린 뒤 이력 쓰기가 막힌 것을 돌려준다', u.이력줄임?.ok === false,
    JSON.stringify(u.이력줄임));
}

trace('9-오류에-딸려-온-것');

// ── 9. 오류가 첫 줄이되, 알아낸 것은 안 버린다 ──────────────────────────
{
  const { root, ctx } = 판만들기();
  mkdirSync(join(root, '어떤폴더'), { recursive: true });
  ctx.history.nextTurn();
  const r = await runTool('Write', {
    files: [
      { file_path: '로고.png', content: 'x' },
      { file_path: '.deel/config.json', content: 'x' },
      { file_path: '어떤폴더', content: 'x' },
    ],
  }, ctx);
  const 실린것 = 실을글(r);
  check('첫 줄은 오류다', 실린것.split('\n')[0].startsWith('오류:'), 실린것.split('\n')[0].slice(0, 60));
  check('★★ 세 가지 까닭이 다 간다',
    /로고\.png/.test(실린것) && /config\.json/.test(실린것) && /어떤폴더/.test(실린것),
    실린것.replace(/\s+/g, ' ').slice(0, 130));
}

trace('9-2-파일도구가-말하는-것');

/*
 * ── 파일 도구가 **고쳤다고 말한 것**과 디스크가 같은가 ────────────────────
 *
 * 파일 도구를 사냥했더니 나온 것이 전부 이 모양이었다. 오류는 한 줄도 없었다.
 *
 *   Edit({old_string:'world'})                  ← new_string 을 빠뜨림
 *     고침: a.txt (1군데)                        파일에는 「hello undefined」
 *
 *   Edit({old_string:'x = 1;', replace_all})     ← 공백만 달라 느슨하게 맞은 100군데
 *     고침: a.txt (51군데)                       나머지 49군데는 그대로
 *
 *   Read({offset:'abc'})                        본문은 비었는데 요약은 「11줄」
 *
 * 앞의 둘은 파일이 바뀌는 쪽이라 더 나쁘다. 모델은 「고침」 을 믿고 다음으로
 * 가고, 사람은 커밋을 열어 보고서야 `undefined` 를 본다.
 */
{
  const { root, ctx } = 판만들기();
  const 파일 = join(root, 'a.txt');
  const 지금 = () => readFileSync(파일, 'utf8');
  const 새로 = async (글) => { writeFileSync(파일, 글); await TOOLS.Read.run({ file_path: 'a.txt' }, ctx); };

  await 새로('hello world\n');
  const 빠짐 = await TOOLS.Edit.run({ file_path: 'a.txt', old_string: 'world' }, ctx);
  check('★★ new_string 이 빠진 Edit 은 거절한다', !!빠짐.error, String(빠짐.content ?? 빠짐.error));
  check('★★ 거절했으면 파일에 「undefined」 가 안 들어간다', 지금() === 'hello world\n', JSON.stringify(지금()));
  check('지우려면 빈 글을 주라고 알려 준다', /new_string/.test(빠짐.error ?? '') && /""/.test(빠짐.error ?? ''), 빠짐.error ?? '');
  const 널 = await TOOLS.Edit.run({ file_path: 'a.txt', old_string: 'world', new_string: null }, ctx);
  check('★ new_string 이 null 이어도 거절한다', !!널.error && 지금() === 'hello world\n', `${널.content ?? 널.error} → ${JSON.stringify(지금())}`);
  const 숫자 = await TOOLS.Edit.run({ file_path: 'a.txt', old_string: 'world', new_string: 456 }, ctx);
  check('★ new_string 이 글이 아니면 거절한다', !!숫자.error && 지금() === 'hello world\n', `${숫자.content ?? 숫자.error} → ${JSON.stringify(지금())}`);
  await 새로('v123 end\n');
  const 옛숫자 = await TOOLS.Edit.run({ file_path: 'a.txt', old_string: 123, new_string: '456' }, ctx);
  check('★ old_string 이 글이 아니면 거절한다', !!옛숫자.error && 지금() === 'v123 end\n', `${옛숫자.content ?? 옛숫자.error} → ${JSON.stringify(지금())}`);

  await 새로('keep\nDELETE ME\nkeep2\n');
  const 배열 = await TOOLS.Edit.run({ edits: [{ file_path: 'a.txt', old_string: 'DELETE ME\n' }] }, ctx);
  check('★★ edits 배열 안에서 빠져도 거절한다', 지금() === 'keep\nDELETE ME\nkeep2\n',
    `${String(배열.content ?? 배열.error).split('\n')[0]} → ${JSON.stringify(지금())}`);
  const 지우기 = await TOOLS.Edit.run({ file_path: 'a.txt', old_string: 'DELETE ME\n', new_string: '' }, ctx);
  check('빈 new_string 은 지우기로 받는다', !지우기.error && 지금() === 'keep\nkeep2\n', 지우기.error ?? JSON.stringify(지금()));

  // 느슨하게 맞은 자리를 replace_all 로 — 51군데에서 멈추고 「51군데」 라고 했다.
  await 새로('x  =  1;\n'.repeat(100));
  const 다 = await TOOLS.Edit.run({ file_path: 'a.txt', old_string: 'x = 1;', new_string: 'y = 2;', replace_all: true }, ctx);
  const 남은 = (지금().match(/x {2}= {2}1;/g) ?? []).length;
  check('★★ replace_all 이 느슨하게 맞은 자리도 다 바꾼다', 남은 === 0, `남은 ${남은}군데 · ${다.content ?? 다.error}`);
  check('★ 바꾼 군데 수를 사실대로 말한다', 다.군데 === 100, `${다.군데} · ${다.content ?? 다.error}`);
  await 새로('a\r\nb\r\n'.repeat(100));
  const 두줄 = await TOOLS.Edit.run({ file_path: 'a.txt', old_string: 'a\nb', new_string: 'c\nd', replace_all: true }, ctx);
  check('★ CRLF 파일의 두 줄짜리 replace_all 도 다 바꾼다', !/a\r\nb/.test(지금()) && 두줄.군데 === 100, `${두줄.content ?? 두줄.error}`);
  check('★★ 그러고도 줄끝이 CRLF 로 남는다', !/[^\r]\n/.test(지금()), JSON.stringify(지금().slice(0, 40)));

  // CRLF 파일에 LF 로 적은 여러 줄 — 넣은 자리만 LF 가 되어 줄끝이 섞였다.
  await 새로('@echo off\r\nset A=1\r\nset B=2\r\ngoto :end\r\n:end\r\n');
  const 줄끝 = await TOOLS.Edit.run({ file_path: 'a.txt', old_string: 'set A=1\nset B=2', new_string: 'set A=10\nset B=20\nset C=30' }, ctx);
  check('★★ CRLF 파일에 느슨하게 맞춰 넣어도 줄끝이 안 섞인다',
    지금() === '@echo off\r\nset A=10\r\nset B=20\r\nset C=30\r\ngoto :end\r\n:end\r\n', `${줄끝.content ?? 줄끝.error} ${JSON.stringify(지금())}`);
  await 새로('one\ntwo\n');
  await TOOLS.Edit.run({ file_path: 'a.txt', old_string: 'one', new_string: 'uno\ndos' }, ctx);
  check('LF 파일에는 CR 을 안 넣는다', 지금() === 'uno\ndos\ntwo\n', JSON.stringify(지금()));

  // 탭 파일에 공백으로 적은 old/new — `\t    return` 처럼 섞였다.
  await 새로('function f() {\n\tif (x) {\n\t\treturn 1;\n\t}\n}\n');
  const 탭 = await TOOLS.Edit.run({ file_path: 'a.txt',
    old_string: '    if (x) {\n        return 1;\n    }', new_string: '    if (y) {\n        return 2;\n    }' }, ctx);
  check('★★ 탭 파일에 공백으로 고쳐도 들여쓰기가 탭으로 맞춰진다',
    지금() === 'function f() {\n\tif (y) {\n\t\treturn 2;\n\t}\n}\n', `${탭.content ?? 탭.error} ${JSON.stringify(지금())}`);
  await 새로('function f() {\n    if (x) {\n        return 1;\n    }\n}\n');
  await TOOLS.Edit.run({ file_path: 'a.txt',
    old_string: '\tif (x) {\n\t\treturn 1;\n\t}', new_string: '\tif (y) {\n\t\treturn 2;\n\t}' }, ctx);
  check('★ 공백 파일에 탭으로 고쳐도 공백으로 맞춰진다',
    지금() === 'function f() {\n    if (y) {\n        return 2;\n    }\n}\n', JSON.stringify(지금()));

  // NFD(맥에서 온 파일)와 NFC — 눈으로는 같은 「한글」 인데 못 찾았다.
  await 새로('한글 파일\n'.normalize('NFD'));
  const nfd = await TOOLS.Edit.run({ file_path: 'a.txt', old_string: '한글', new_string: '영문' }, ctx);
  check('★★ NFD 파일에서 NFC 로 적은 old_string 을 찾는다', !nfd.error && 지금() === '영문 파일\n'.normalize('NFD'),
    `${nfd.content ?? nfd.error} ${JSON.stringify(지금())}`);
  await 새로('한글 파일\n');
  const nfc = await TOOLS.Edit.run({ file_path: 'a.txt', old_string: '한글'.normalize('NFD'), new_string: '영문'.normalize('NFD') }, ctx);
  check('★★ NFC 파일에서 NFD 로 적은 old_string 도 찾고, 넣는 글은 파일 꼴(NFC)로 맞춘다', !nfc.error && 지금() === '영문 파일\n',
    `${nfc.content ?? nfc.error} ${JSON.stringify(지금())}`);
  await 새로('café menu\ncafé bill\n');
  const 모호 = await TOOLS.Edit.run({ file_path: 'a.txt', old_string: 'café', new_string: 'shop' }, ctx);
  check('★ 정규화로 찾아도 두 군데면 모호하다고 거절한다', !!모호.error && /2군데/.test(모호.error), 모호.error ?? 모호.content);
  const 한곳 = await TOOLS.Edit.run({ file_path: 'a.txt', old_string: 'café bill', new_string: 'shop bill' }, ctx);
  check('★ 결합 문자(e + ◌́)도 정규화해서 한 자리를 찾는다', !한곳.error && 지금() === 'café menu\nshop bill\n', `${한곳.content ?? 한곳.error} ${JSON.stringify(지금())}`);
  // 글자 한가운데서 **시작하는** 자리 — NFD 「아각」 에서 「ㅏ+각」 을 찾으면 「아」 가 쪼개진다.
  await 새로('아각\n'.normalize('NFD'));
  const 반쪽 = await TOOLS.Edit.run({ file_path: 'a.txt', old_string: 'ᅡ각', new_string: 'x' }, ctx);
  check('★ 글자 한가운데서 시작하는 자리는 정규화 길로 고치지 않는다', 지금() === '아각\n'.normalize('NFD') && !!반쪽.error,
    `${반쪽.error ?? 반쪽.content} ${JSON.stringify(지금())}`);
  // 글자 한가운데서 **끝나는** 자리 — NFD 「각」 안에도 「가」(ㄱ+ㅏ)가 있다. 그걸 고치면 받침이 딴 글자에 붙는다.
  await 새로('각 가\n'.normalize('NFD'));
  const 받침 = await TOOLS.Edit.run({ file_path: 'a.txt', old_string: '가', new_string: '나' }, ctx);
  check('★★ 받침 앞에서 끝나는 자리(각 안의 가)는 안 세고, 온전한 「가」 한 곳만 고친다', !받침.error && 지금() === '각 나\n'.normalize('NFD'),
    `${받침.error ?? 받침.content} ${JSON.stringify(지금())}`);

  // Read 의 offset·limit — 글자·소수·끝 넘음.
  writeFileSync(join(root, 'r.txt'), Array.from({ length: 10 }, (_, i) => `L${i + 1}`).join('\n') + '\n');
  const 읽기 = (a) => TOOLS.Read.run({ file_path: 'r.txt', ...a }, ctx);
  const 글offset = await 읽기({ offset: 'abc' });
  check('★ offset 이 숫자가 아니면 빈 본문 대신 그렇다고 말한다', !!글offset.error && /offset/.test(글offset.error),
    `${JSON.stringify(글offset.content)} | ${글offset.summary ?? 글offset.error}`);
  const 글limit = await 읽기({ limit: 'abc' });
  check('★ limit 이 숫자가 아니면 빈 본문 대신 그렇다고 말한다', !!글limit.error && /limit/.test(글limit.error),
    `${JSON.stringify(글limit.content)} | ${글limit.summary ?? 글limit.error}`);
  const 넘음 = await 읽기({ offset: 99 });
  check('★ 파일 끝을 지난 offset 은 빈 본문으로 넘기지 않고 말한다', /끝을 지났/.test(String(넘음.content ?? 넘음.error ?? '')),
    `${JSON.stringify(넘음.content)} | ${넘음.summary}`);
  const 소수 = await 읽기({ offset: 1.5, limit: 2 });
  check('★ 소수 offset 이 「1.5」 같은 줄 번호를 안 만든다', /^\s+1\tL1\n\s+2\tL2/.test(String(소수.content)) && !/\d\.\d+\t/.test(String(소수.content)),
    JSON.stringify(String(소수.content ?? 소수.error).slice(0, 40)));
  const 글숫자 = await 읽기({ offset: '3', limit: '2' });
  check('숫자 글("3")은 그대로 받는다', /^\s+3\tL3\n\s+4\tL4/.test(String(글숫자.content)), JSON.stringify(String(글숫자.content ?? 글숫자.error).slice(0, 40)));

  // 끝의 줄바꿈은 줄을 **닫는** 것이지 새 줄을 여는 것이 아니다 — 10줄 파일이 「11줄」 로 떴다.
  const 열줄 = await 읽기({});
  check('★★ 끝이 줄바꿈인 10줄 파일은 10줄이다', /(^|\D)10줄/.test(String(열줄.summary)) && !/11줄/.test(String(열줄.summary)), String(열줄.summary));
  check('★ 있지도 않은 11번 줄을 안 보여 준다', !/^\s+11\t/m.test(String(열줄.content)) && /^\s+10\tL10$/m.test(String(열줄.content)), JSON.stringify(String(열줄.content).slice(-30)));
  writeFileSync(join(root, 'n.txt'), 'a\n\nb');
  const 끝없음 = await TOOLS.Read.run({ file_path: 'n.txt' }, ctx);
  check('끝에 줄바꿈이 없으면 마지막 줄까지 센다 (빈 줄도 한 줄)', /(^|\D)3줄/.test(String(끝없음.summary)), String(끝없음.summary));

  writeFileSync(join(root, 'e.txt'), '');
  const 빈것 = await TOOLS.Read.run({ file_path: 'e.txt' }, ctx);
  check('★ 0바이트 파일은 0줄이라고 한다', /(^|\D)0줄/.test(String(빈것.summary)) && !/1줄/.test(String(빈것.summary)), String(빈것.summary ?? 빈것.error));
  check('★ 0바이트 파일에 있지도 않은 1번 줄을 안 보여 준다', !/^\s+1\t/m.test(String(빈것.content)), JSON.stringify(빈것.content));
}

trace('11-살림-우회');

// ── 11. 찾기·스트림 꼴로 살림을 비켜 가지 않는다 (사냥6 F6-1 · F6-2) ──────────
//
// Read 는 `.deel/config.json` 을 내부살림() 으로 막는데 Grep·Glob 에는 그 막이 없었다.
// `Grep {path:'.deel', output_mode:'content'}` 한 번이면 게이트웨이 열쇠·MCP 토큰이 줄째로
// 나왔다(rg·자바스크립트 두 엔진 다). 그리고 윈도우는 `config.json::$DATA` 를 본체로 여는데
// 내부살림 은 그 철자를 몰라, Read 가 열쇠를 읽고 Write 는 **본체를 덮어썼다.**
{
  const { root, ctx } = 판만들기();
  mkdirSync(join(root, '.deel', 'history'), { recursive: true });
  mkdirSync(join(root, '.claude'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  const 열쇠글 = '{"apiKey":"sk-SECRET-F6-0001"}\n';
  writeFileSync(join(root, '.deel', 'config.json'), 열쇠글);
  writeFileSync(join(root, '.deel', 'mcp.json'), '{"env":{"TOKEN":"ghp_SECRET-F6"}}\n');
  writeFileSync(join(root, '.deel', 'history', 'h.txt'), 'SECRET-F6-history\n');
  writeFileSync(join(root, '.claude', 'history.jsonl'), '{"note":"SECRET-F6-claude"}\n');
  writeFileSync(join(root, 'src', 'a.txt'), 'SECRET-F6-open\n');
  const 샜나 = (r) => /SECRET-F6-0001|ghp_SECRET-F6|SECRET-F6-history|SECRET-F6-claude/.test(JSON.stringify(r ?? {}));
  const { 엔진잊기 } = await import('../src/tools/fastgrep.js');
  const 옛엔진 = process.env.DEEL_GREP;
  try {
    for (const 엔진 of ['기본', 'js']) {
      if (엔진 === 'js') process.env.DEEL_GREP = 'js'; else if (옛엔진 == null) delete process.env.DEEL_GREP; else process.env.DEEL_GREP = 옛엔진;
      엔진잊기();
      for (const path of ['.deel', '.deel/config.json', '.deel/history', '.claude', '.DEEL', '.deel/config.json::$DATA']) {
        const r = await runTool('Grep', { pattern: 'SECRET|apiKey', path, output_mode: 'content' }, ctx);
        check(`★★ (${엔진}) Grep path=${path} 가 살림을 안 돌려준다`, !샜나(r) && !!r.error && !/config\.json|mcp\.json|h\.txt/.test(String(r.content ?? '')),
          JSON.stringify(r).slice(0, 120));
      }
      const 열린 = await runTool('Grep', { pattern: 'SECRET', path: 'src', output_mode: 'content' }, ctx);
      check(`(${엔진}) 살림이 아닌 폴더는 그대로 찾는다`, /SECRET-F6-open/.test(String(열린.content ?? '')), JSON.stringify(열린).slice(0, 100));
    }
  } finally {
    if (옛엔진 == null) delete process.env.DEEL_GREP; else process.env.DEEL_GREP = 옛엔진;
    엔진잊기();
  }
  for (const path of ['.deel', '.deel/history', '.claude']) {
    const g = await runTool('Glob', { pattern: '**/*', path }, ctx);
    check(`★★ Glob path=${path} 가 살림 목록을 안 낸다`, !!g.error && !/config\.json|mcp\.json|h\.txt|history\.jsonl/.test(String(g.content ?? '')),
      JSON.stringify(g).slice(0, 120));
  }

  const 읽음 = await runTool('Read', { file_path: '.deel/config.json::$DATA' }, ctx);
  check('★★ Read 에 ::$DATA 를 붙여도 열쇠를 안 읽는다', !샜나(읽음) && !!읽음.error, JSON.stringify(읽음).slice(0, 100));
  ctx.history.nextTurn();
  const 씀 = await runTool('Write', { file_path: '.deel/config.json::$DATA', content: 'PWNED' }, ctx);
  check('★★ Write 에 ::$DATA 를 붙여도 설정 본체를 안 덮는다',
    readFileSync(join(root, '.deel', 'config.json'), 'utf8') === 열쇠글 && !!씀.error, JSON.stringify(씀).slice(0, 100));
  const 고침 = await runTool('Edit', { file_path: '.deel/config.json::$DATA', old_string: 'sk-SECRET', new_string: 'sk-PWNED' }, ctx);
  check('★ Edit 에 ::$DATA 를 붙여도 설정을 안 고친다',
    readFileSync(join(root, '.deel', 'config.json'), 'utf8') === 열쇠글 && !!고침.error, JSON.stringify(고침).slice(0, 100));
  writeFileSync(join(root, '.deel', 'audit.jsonl'), 'SECRET-F6-history audit\n');
  const 감사 = await runTool('Read', { file_path: '.deel/audit.jsonl::$DATA' }, ctx);
  check('★ 감사 기록도 ::$DATA 로 안 읽힌다', !샜나(감사) && !!감사.error, JSON.stringify(감사).slice(0, 100));

  /*
   * 이름을 대고 들어오는 문(path) 말고, **훑다가 흘러 들어오는** 살림도 거른다. walk 를 쓰는
   * 도구(Glob · 자바스크립트 Grep · Outline · Verify)가 다 같이 닫혀야 한다.
   */
  const { walk } = await import('../src/tools/fsutil.js');
  // 목록에 이름이 없는 파일도 하나 둔다. 파일 하나하나의 자(config.json·mcp.json·history…)만으로도 위 것들은
  // 걸러져서, 시작 자리를 보는 막이를 꺼도 이 검사가 초록이었다 (6회차 어긋내기).
  writeFileSync(join(root, '.deel', '메모.md'), 'SECRET-F6-memo\n');
  const 살림훑음 = await walk(join(root, '.deel'));
  check('★ walk 를 살림 폴더에서 시작해도 안의 파일을 안 내놓는다', 살림훑음.length === 0, 살림훑음.map((f) => f.rel).join(' '));
  writeFileSync(join(root, '.aider.chat.history.md'), 'SECRET-F6-aider\n');
  const 옛엔진2 = process.env.DEEL_GREP;
  process.env.DEEL_GREP = 'js';
  const { 엔진잊기: 엔진잊기2 } = await import('../src/tools/fastgrep.js');
  엔진잊기2();
  try {
    const 뿌리찾기 = await runTool('Grep', { pattern: 'SECRET-F6', output_mode: 'content' }, ctx);
    check('★ (js) 작업 폴더 전체를 찾아도 남의 도구 기록 파일은 안 연다', !/SECRET-F6-aider/.test(String(뿌리찾기.content ?? '')) && /SECRET-F6-open/.test(String(뿌리찾기.content ?? '')),
      String(뿌리찾기.content ?? 뿌리찾기.error).slice(0, 120));
  } finally {
    if (옛엔진2 == null) delete process.env.DEEL_GREP; else process.env.DEEL_GREP = 옛엔진2;
    엔진잊기2();
  }
  const 뼈 = await runTool('Outline', { path: '.' }, ctx);
  check('★ Outline 도 남의 도구 기록 파일을 안 훑는다', !/aider\.chat/.test(String(뼈.content ?? '')), String(뼈.content ?? 뼈.error).slice(0, 120));

  // (낮음) limit 이 0 이하면 「-3줄까지」 같은 말을 지어내지 않고 거절한다.
  writeFileSync(join(root, 'src', 'ten.txt'), 'L1\nL2\nL3\n');
  for (const limit of [-3, 0]) {
    const r = await runTool('Read', { file_path: 'src/ten.txt', limit }, ctx);
    check(`★ Read limit ${limit} 은 거절하고 무엇을 줘야 하는지 말한다`, !!r.error && /limit/.test(String(r.error)) && !/-3줄까지|0줄까지/.test(JSON.stringify(r)),
      JSON.stringify(r).slice(0, 100));
  }
}

trace('10b-느슨히-찾은-자리');

// ── 느슨하게 찾은 자리가 **다음 줄**을 먹는가 · 겹친 두 자리를 하나로 치는가 (6회차 Gemini 고침맞추기6) ──
//
// 들여쓰기·공백을 흡수하는 단계는 old_string 끝의 줄바꿈 뒤에 `[ \t]*`·`\s+` 가 붙어 **다음 줄 들여쓰기까지**
// 찾은 자리에 넣었다. 그 자리를 new_string 으로 갈면 다음 줄이 들여쓰기를 잃는다 — 파이썬이면 그 줄부터 틀린다.
// 또 정확히 찾기는 겹치지 않게만 세서, `}\n}\n}` 안의 `}\n}` 두 자리를 한 곳으로 치고 첫 자리를 조용히 고쳤다.
{
  const { root, ctx } = 판만들기();
  const 고쳐봐 = async (이름, 글, 인자) => {
    writeFileSync(join(root, 이름), 글);
    ctx.seen.add(join(root, 이름));
    ctx.history.nextTurn();
    const r = await runTool('Edit', { file_path: 이름, ...인자 }, ctx);
    return { r, 뒤: readFileSync(join(root, 이름), 'utf8') };
  };
  const 들여 = await 고쳐봐('들여.py', '  foo\n  bar\n', { old_string: '   foo\n', new_string: '   baz\n' });
  check('★★ 들여쓰기를 흡수해 찾아도 다음 줄 들여쓰기는 안 먹는다', 들여.뒤 === '  baz\n  bar\n', JSON.stringify(들여.뒤));
  const 여러줄 = await 고쳐봐('여러줄.py', 'def f():\n    a = 1\n    b = 2\n    c = 3\n', { old_string: '  a = 1\n  b = 2\n', new_string: '  a = 10\n  b = 20\n' });
  check('★★ 여러 줄을 흡수해 찾아도 뒤 줄(c = 3) 들여쓰기는 그대로다', 여러줄.뒤 === 'def f():\n    a = 10\n    b = 20\n    c = 3\n', JSON.stringify(여러줄.뒤));
  const 빈칸 = await 고쳐봐('빈칸.py', '  foo  x\n  bar\n', { old_string: 'foo x\n', new_string: 'foo y\n' });
  check('★★ 공백을 흡수해 찾아도 다음 줄 들여쓰기는 안 먹는다', 빈칸.뒤 === '  foo y\n  bar\n', JSON.stringify(빈칸.뒤));
  const 빈줄 = await 고쳐봐('빈줄.py', '  foo  x\n\n  bar\n', { old_string: 'foo x\n', new_string: 'foo y\n' });
  check('  공백을 흡수해 찾아도 뒤따르는 빈 줄은 안 먹는다', 빈줄.뒤 === '  foo y\n\n  bar\n', JSON.stringify(빈줄.뒤));
  const 끝빈칸 = await 고쳐봐('끝빈칸.txt', 'foo  x\nnext\n', { old_string: 'foo x ', new_string: 'foo y ' });
  check('  끝이 빈칸인 old_string 은 줄바꿈까지 먹지 않는다', 끝빈칸.뒤.endsWith('\nnext\n'), JSON.stringify(끝빈칸.뒤));

  const 겹침 = await 고쳐봐('겹침.js', 'x\n}\n}\n}\n', { old_string: '}\n}', new_string: ']\n]' });
  check('★★ 겹쳐서 두 곳에 맞는 old_string 은 모호하다고 거절한다 — 첫 자리를 조용히 안 고친다',
    !!겹침.r.error && 겹침.뒤 === 'x\n}\n}\n}\n', JSON.stringify(겹침.r).slice(0, 120));
  const 풀린겹침 = await 고쳐봐('풀린겹침.txt', '한한한'.normalize('NFD'), { old_string: '한한', new_string: '훈' });
  check('★ 정규화(NFD) 단계도 겹친 두 자리를 모호하다고 거절한다', !!풀린겹침.r.error && 풀린겹침.뒤 === '한한한'.normalize('NFD'),
    JSON.stringify(풀린겹침.r).slice(0, 120));
  const 전부 = await 고쳐봐('전부.txt', 'aaaa', { old_string: 'aa', new_string: 'b', replace_all: true });
  check('  replace_all 은 여태처럼 안 겹치게 바꾼다', !전부.r.error && 전부.뒤 === 'bb', JSON.stringify(전부).slice(0, 120));

  /*
   * ── 느슨하게 맞춘 자리도 겹치면 모호하다 (6회차 고침맞추기6dq G2) ────────
   *
   * 위 「겹침」 은 **정확히** 단계다. 그 단계만 겹친 자리를 세고 있었고, 들여쓰기·
   * 공백을 흡수하는 단계는 matchAll 로 걷어서 겹친 자리를 못 봤다. 그래서 같은
   * 글도 들여쓰기가 붙는 순간 — 파이썬·중괄호 닫는 줄처럼 흔한 꼴이다 — 두 곳 중
   * 첫 자리를 **조용히** 고쳤다. 못 찾는 것보다 엉뚱한 곳을 고치는 것이 나쁘다는
   * 이 파일의 원칙이 단계마다 달랐던 자리다.
   */
  const 들여겹침 = await 고쳐봐('들여겹침.js', '  }\n  }\n  }\n', { old_string: '}\n}', new_string: ']\n]' });
  check('★★★ 들여쓰기를 흡수해 맞은 자리도 겹치면 모호하다고 거절한다',
    !!들여겹침.r.error && 들여겹침.뒤 === '  }\n  }\n  }\n', JSON.stringify(들여겹침.r).slice(0, 140));
  const 빈칸겹침 = await 고쳐봐('빈칸겹침.txt', 'a  a  a\n', { old_string: 'a a', new_string: 'b' });
  check('★★ 공백을 흡수해 맞은 자리도 겹치면 거절한다', !!빈칸겹침.r.error && 빈칸겹침.뒤 === 'a  a  a\n',
    JSON.stringify(빈칸겹침.r).slice(0, 140));
  // 겹치지 않는 한 곳은 여전히 그대로 고친다 — 조이기만 하고 쓸모를 없애면 안 된다.
  const 한곳 = await 고쳐봐('한곳.js', 'x\n  }\n  ]\n', { old_string: '}\n]', new_string: '}\n}' });
  check('★ 느슨하게 맞은 자리가 하나면 그대로 고친다', !한곳.r.error && 한곳.뒤 === 'x\n  }\n  }\n',
    JSON.stringify(한곳.뒤));
  const 느슨전부 = await 고쳐봐('느슨전부.txt', 'a  a  a\n', { old_string: 'a a', new_string: 'b', replace_all: true });
  check('★ replace_all 은 느슨한 단계에서도 안 겹치게 바꾼다', !느슨전부.r.error && 느슨전부.뒤 === 'b  a\n',
    JSON.stringify(느슨전부.뒤));
}

trace('10-스키마-약속');

/*
 * ── 스키마 문장이 곧 약속이다 ───────────────────────────────────────────
 *
 * 도구 설명은 모델이 읽는 유일한 설명서다. 거기 「.xls 도 그대로 읽을 수 있다」
 * 고 적혀 있으면 모델은 사용자에게 「그 파일 그대로 주세요」 라고 말한다.
 * 그런데 옛 .xls(OLE)는 이 프로그램이 직접 못 읽는다 — 이 PC 에 엑셀이나
 * LibreOffice 가 있어야 빌려 읽는다(tools/convert.js 직접못읽는확장자).
 * 없는 PC 에서는 읽기 자체가 막히고, 걸음 하나와 사용자의 한 번이 통째로 버려진다.
 *
 * 화면 문구가 아니라 **스키마가 무엇을 약속하는가**를 재는 자리다.
 */
{
  const 설명 = String(TOOLS.Read.schema.description ?? '');
  // `.xls` 를 (xlsx·xlsm 이 아닌 옛 형식으로) 말했으면 조건도 같이 말해야 한다.
  const 옛것말함 = /\.xls(?![xm])/.test(설명);
  // 「엑셀」 이라는 낱말은 .xlsx 를 말할 때도 나온다. 조건을 말했는지는
  // **무엇이 있어야 하는가**를 적었는지로 본다.
  const 조건말함 = /(LibreOffice|설치|있어야)/.test(설명);
  check('★ .xls 를 조건 없이 「그대로 읽는다」 고 약속하지 않는다',
    !옛것말함 || 조건말함, 설명);

  /*
   * 실제로도 그런가. 이 PC 에 빌릴 것이 없으면 읽기가 막히는데, 그때 돌아오는
   * 말과 스키마가 서로 어긋나면 안 된다. 빌릴 것이 있는 PC 에서는 읽히므로
   * 그때는 이 검사가 할 말이 없다 — 어긋남을 재는 자리지 기능을 재는 자리가 아니다.
   */
  const { root, ctx } = 판만들기();
  const 옛 = Buffer.alloc(2048);
  // 옛 Office 파일의 앞머리(OLE 복합문서) — tools/docs.js 가 이 바이트로 가른다.
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(옛, 0);
  writeFileSync(join(root, '옛장부.xls'), 옛);
  const r = await TOOLS.Read.run({ file_path: '옛장부.xls' }, ctx);
  if (r.error) {
    check('★ 못 읽는 PC 에서 막힌다면 스키마가 그 사실을 미리 말해 뒀다',
      조건말함, `${String(r.error).split('\n')[0]} / ${설명.slice(-80)}`);
  }

  // 여태 참이던 약속은 그대로여야 한다 — 없앤 것이 아니라 사실대로 고치는 것이다.
  check('  짝: .xlsx 는 여전히 그대로 읽는다고 말한다', /\.xlsx/.test(설명), 설명);
  check('  짝: 한글·워드·파워포인트 이야기는 그대로 있다', /\.hwpx/.test(설명), 설명);
}

trace('20-장치이름');
/*
 * ── `NUL`·`aux.txt` 에 쓰고 「새로 만듦」 이라 하지 않는다 (2.0.2 · 379) ─────────
 *
 * 윈도 10 까지는 그 이름이 장치라 쓰기는 되고 아무것도 안 남는다. 윈도 11 은 진짜 파일을
 * 만든다 — 그래서 **말과 디스크가 같은가**만 본다(어느 판이든 참이어야 한다). 판정 자체는
 * 폴더(파일이 아닌 것)로 잰다.
 */
{
  const { root, ctx } = 판만들기();
  mkdirSync(join(root, '폴더'));
  writeFileSync(join(root, '글.txt'), 'x');
  const 폴더답 = 파일안생김(ctx, join(root, '폴더'));
  check('★★ 379 쓴 자리가 파일이 아니면 「안 생겼다」 고 말한다', /파일이 안 생겼습니다/.test(폴더답?.error ?? ''), JSON.stringify(폴더답));
  check('  파일이면 아무 말 없다', 파일안생김(ctx, join(root, '글.txt')) === null);
  check('  아예 없으면 「안 생겼다」', /안 생겼습니다/.test(파일안생김(ctx, join(root, '없음.txt'))?.error ?? ''));
  if (process.platform === 'win32') {
    for (const 이름 of ['NUL', 'aux.txt', 'CON']) {
      ctx.history.nextTurn();
      const r = await runTool('Write', { file_path: 이름, content: 'x' }, ctx);
      const 생김 = existsSync(join(root, 이름)) && statSync(join(root, 이름)).isFile();
      check(`★ 379 Write ${이름} — 말과 디스크가 같다`,
        생김 ? /새로 만듦/.test(r.content ?? '') : /안 생겼습니다/.test(r.error ?? ''),
        `${생김 ? '파일 생김' : '안 생김'} · ${r.content ?? r.error}`);
    }
  }
}

trace('10-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n도구 정직 검사  ${D}(했다고 말하는 것과 실제로 한 것이 같은가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
for (const d of 치움) { try { rmSync(d, { recursive: true, force: true }); } catch { /* 임시 폴더다 */ } }
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
