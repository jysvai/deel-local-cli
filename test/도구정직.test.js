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
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from './trace.mjs';
import { TOOLS, runTool } from '../src/tools/index.js';
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

trace('10-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n도구 정직 검사  ${D}(했다고 말하는 것과 실제로 한 것이 같은가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
for (const d of 치움) { try { rmSync(d, { recursive: true, force: true }); } catch { /* 임시 폴더다 */ } }
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
