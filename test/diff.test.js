// 바뀐 자리 보여주기 — 줄 단위 비교.
//
// 왜 중요한가: auto 모드는 안 물어보고 고친다. 화면에 "3군데" 만 남으면
// 사람은 무엇이 바뀐지 모른 채 넘어간다. 되돌리기가 안전망이라지만,
// 뭐가 바뀐지 모르면 되돌릴지 말지도 못 정한다.
//
// 여기서 조심할 것 두 가지:
//   1) 큰 파일. LCS 를 그대로 돌리면 줄 수의 곱만큼 메모리를 먹는다.
//      1만 줄짜리 두 개면 1억 칸이다. 앞뒤 공통 부분을 먼저 잘라내야 한다.
//   2) 줄 끝 표시(CRLF/LF). 눈에는 똑같은 줄이 전부 바뀐 것으로 나오면
//      사람이 진짜 바뀐 곳을 못 찾는다.
import { diffLines, renderDiff, shortStat } from '../src/ui/diff.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 색빼기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
const 줄글 = (arr) => arr.map(색빼기).join('\n');

trace('1-기본');

// ── 안 바뀐 경우 ────────────────────────────────────────────────────────
{
  const d = diffLines('가\n나\n다\n', '가\n나\n다\n');
  check('같은 글은 더한 줄이 없다', d.added === 0, String(d.added));
  check('같은 글은 지운 줄이 없다', d.removed === 0, String(d.removed));
  check('같은 글은 덩어리가 없다', d.hunks.length === 0, String(d.hunks.length));
  check('안 바뀌었다고 표시한다', d.changed === false, String(d.changed));
}

// ── 한 줄 고치기 ────────────────────────────────────────────────────────
{
  const d = diffLines('가\n나\n다\n', '가\n라\n다\n');
  check('한 줄 고치면 +1', d.added === 1, String(d.added));
  check('한 줄 고치면 -1', d.removed === 1, String(d.removed));
  check('덩어리는 하나', d.hunks.length === 1, String(d.hunks.length));
  check('바뀌었다고 표시한다', d.changed === true, String(d.changed));

  const 글 = 줄글(renderDiff(d));
  check('없어진 줄이 - 로 보인다', /^\s*-.*나/m.test(글), 글);
  check('새 줄이 + 로 보인다', /^\s*\+.*라/m.test(글), 글);
  check('곁줄도 같이 보인다', /가/.test(글) && /다/.test(글), 글);
}

// ── 줄 번호 ─────────────────────────────────────────────────────────────
{
  const 전 = Array.from({ length: 10 }, (_, i) => `줄${i + 1}`).join('\n');
  const 후 = 전.replace('줄5', '줄다섯');
  const d = diffLines(전, 후);
  const 줄들 = renderDiff(d).map(색빼기);
  const 바뀐줄 = 줄들.find((l) => l.includes('줄다섯'));
  check('바뀐 줄에 번호가 붙는다', /\b5\b/.test(바뀐줄 ?? ''), 바뀐줄 ?? '(없음)');
  const 앞줄 = 줄들.find((l) => l.includes('줄4'));
  check('곁줄에도 번호가 붙는다', /\b4\b/.test(앞줄 ?? ''), 앞줄 ?? '(없음)');

  // 없어진 줄에는 번호를 안 단다.
  //
  // 옛 번호를 달면 바로 위 곁줄의 새 번호와 같은 숫자가 나란히 찍혀서,
  // 서로 다른 파일의 번호가 한 줄에 섞여 보인다. 실제로 그 화면이 나왔다.
  const 없어진줄 = 줄들.find((l) => l.trimStart().startsWith('-'));
  check('없어진 줄에는 번호를 안 단다', !/\d/.test((없어진줄 ?? '').split('줄')[0]), JSON.stringify(없어진줄));
}

// ── 지운 줄과 곁줄의 번호가 겹쳐 보이지 않는가 ─────────────────────────
{
  // 곁줄(새 파일 8번)과 지운 줄(옛 파일 8번)이 잇달아 나오는 모양.
  const 전 = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', '없앨것', 'ㅇ', 'ㅈ'].join('\n');
  const 후 = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ'].join('\n');
  const 줄들 = renderDiff(diffLines(전, 후)).map(색빼기);
  const 번호들 = 줄들.map((l) => (l.match(/^\s*[-+ ]\s*(\d+)/) ?? [])[1]).filter(Boolean);
  check('한 화면에 같은 번호가 두 번 안 나온다', new Set(번호들).size === 번호들.length, 번호들.join(','));
}

trace('2-새파일-빈파일');

// ── 새로 만든 파일 ──────────────────────────────────────────────────────
{
  const d = diffLines(null, '한\n두\n세\n');
  check('새 파일은 전부 더한 것', d.added === 3, String(d.added));
  check('새 파일은 지운 게 없다', d.removed === 0, String(d.removed));
  check('새 파일이라고 알려 준다', d.isNew === true, String(d.isNew));
}

{
  const d = diffLines('한\n두\n', null);
  check('지운 파일은 전부 없어진 것', d.removed === 2, String(d.removed));
  check('지운 파일은 더한 게 없다', d.added === 0, String(d.added));
}

{
  const d = diffLines('', '');
  check('빈 파일끼리는 안 바뀐 것', d.changed === false, String(d.changed));
}

{
  const d = diffLines('', '새 줄\n');
  check('빈 파일에 쓰면 더한 것으로 센다', d.added === 1, String(d.added));
}

trace('3-덩어리');

// ── 떨어진 두 곳 ────────────────────────────────────────────────────────
{
  const 전 = Array.from({ length: 60 }, (_, i) => `줄${i + 1}`).join('\n');
  const 후 = 전.replace('줄3', '삼').replace('줄50', '오십');
  const d = diffLines(전, 후);
  check('멀리 떨어지면 덩어리가 둘', d.hunks.length === 2, String(d.hunks.length));
  check('가운데 안 바뀐 줄은 안 그린다', !줄글(renderDiff(d)).includes('줄30'), '');
  check('덩어리 사이를 표시한다', /⋯|\.\.\./.test(줄글(renderDiff(d))), 줄글(renderDiff(d)).slice(0, 200));
}

// ── 붙어 있는 두 곳 ─────────────────────────────────────────────────────
{
  const 전 = Array.from({ length: 30 }, (_, i) => `줄${i + 1}`).join('\n');
  const 후 = 전.replace('줄10', '십').replace('줄12', '십이');
  const d = diffLines(전, 후);
  check('가까우면 한 덩어리로 합친다', d.hunks.length === 1, String(d.hunks.length));
  check('사이 줄도 곁줄로 남는다', 줄글(renderDiff(d)).includes('줄11'), '');
}

// ── 곁줄 개수 ───────────────────────────────────────────────────────────
{
  const 전 = Array.from({ length: 40 }, (_, i) => `줄${i + 1}`).join('\n');
  const 후 = 전.replace('줄20', '스물');
  const d = diffLines(전, 후, { context: 2 });
  const 글 = 줄글(renderDiff(d));
  check('곁줄 2 면 위로 2줄까지', 글.includes('줄18') && !글.includes('줄17'), 글);
  check('곁줄 2 면 아래로 2줄까지', 글.includes('줄22') && !글.includes('줄23'), 글);
}

trace('4-큰파일');

// ── 큰 파일에서 한 줄 ───────────────────────────────────────────────────
{
  const N = 20000;
  const 전 = Array.from({ length: N }, (_, i) => `줄 ${i}`).join('\n');
  const 후 = 전.replace('\n줄 10000\n', '\n줄 만\n');
  const t0 = Date.now();
  const d = diffLines(전, 후);
  const 걸린 = Date.now() - t0;
  check('2만 줄에서 한 줄만 고쳐도 빠르다', 걸린 < 1500, `${걸린}ms`);
  check('2만 줄에서도 정확히 +1', d.added === 1, String(d.added));
  check('2만 줄에서도 정확히 -1', d.removed === 1, String(d.removed));
  check('그때도 덩어리는 하나', d.hunks.length === 1, String(d.hunks.length));
  check('LCS 를 포기하지 않았다', d.tooBig !== true, String(d.tooBig));
}

// ── 통째로 다른 큰 파일 ─────────────────────────────────────────────────
{
  // 앞뒤로 같은 데가 하나도 없다. 이때 LCS 를 그대로 돌리면 곱만큼 메모리를 먹는다.
  const 전 = Array.from({ length: 6000 }, (_, i) => `가 ${i}`).join('\n');
  const 후 = Array.from({ length: 6000 }, (_, i) => `나 ${i}`).join('\n');
  const t0 = Date.now();
  const d = diffLines(전, 후);
  const 걸린 = Date.now() - t0;
  check('통째로 다른 큰 파일도 안 멈춘다', 걸린 < 2000, `${걸린}ms`);
  check('그럴 땐 대충이라고 말해 준다', d.tooBig === true, String(d.tooBig));
  check('대충이어도 줄 수는 맞다', d.added === 6000 && d.removed === 6000, `+${d.added} -${d.removed}`);
  check('대충이어도 그릴 것은 준다', renderDiff(d).length > 0, '');
}

trace('5-줄끝');

// ── 줄 끝 표시만 다를 때 ────────────────────────────────────────────────
{
  const d = diffLines('가\r\n나\r\n', '가\n나\n');
  check('줄 끝만 바뀐 것을 알아챈다', d.eolOnly === true, String(d.eolOnly));
  check('줄 끝만 바뀌면 바뀐 걸로는 친다', d.changed === true, String(d.changed));
  const 글 = 줄글(renderDiff(d));
  check('줄 끝 얘기를 화면에 적는다', /줄 끝|CRLF/.test(글), 글.slice(0, 200));
}

{
  // 줄 끝도 바뀌고 내용도 바뀌면 '줄 끝만' 이 아니다.
  const d = diffLines('가\r\n나\r\n', '가\n다\n');
  check('내용까지 바뀌면 줄끝만이 아니다', d.eolOnly === false, String(d.eolOnly));
}

trace('6-상한');

// ── 그리는 줄 상한 ──────────────────────────────────────────────────────
{
  const 전 = Array.from({ length: 500 }, (_, i) => `옛 ${i}`).join('\n');
  const 후 = Array.from({ length: 500 }, (_, i) => `새 ${i}`).join('\n');
  const d = diffLines(전, 후);
  const 줄들 = renderDiff(d, { maxLines: 12 });
  check('상한을 넘겨 그리지 않는다', 줄들.length <= 14, String(줄들.length));
  check('나머지가 몇 줄인지 말해 준다', /줄 더|외 \d+/.test(줄글(줄들)), 줄글(줄들).slice(-120));
}

{
  // 아주 긴 한 줄. 그대로 찍으면 화면이 밀린다.
  const d = diffLines('짧다\n', 'ㄱ'.repeat(500) + '\n');
  const 줄들 = renderDiff(d, { width: 60 });
  const 제일긴 = Math.max(...줄들.map((l) => 색빼기(l).length));
  check('긴 줄은 잘라서 그린다', 제일긴 <= 70, String(제일긴));
}

trace('7-요약');

// ── 한 줄 요약 ──────────────────────────────────────────────────────────
{
  const d = diffLines('가\n나\n다\n', '가\n라\n마\n바\n');
  const s = 색빼기(shortStat(d));
  check('요약에 더한 수가 있다', /\+3/.test(s), s);
  check('요약에 지운 수가 있다', /[-−]2/.test(s), s);
}

{
  const s = 색빼기(shortStat(diffLines('가\n', '가\n')));
  check('안 바뀌면 요약이 비어 있다', s.trim() === '' || /없/.test(s), JSON.stringify(s));
}

trace('8-까다로운것');

// ── 마지막 줄 개행 ──────────────────────────────────────────────────────
{
  const d = diffLines('가\n나', '가\n나\n');
  check('마지막 개행만 붙어도 알아챈다', d.changed === true, String(d.changed));
  check('마지막 개행 하나에 한 줄만 센다', d.added <= 1 && d.removed <= 1, `+${d.added} -${d.removed}`);
}

// ── 같은 줄이 여러 번 나올 때 ───────────────────────────────────────────
{
  const 전 = '가\n가\n가\n나\n';
  const 후 = '가\n가\n나\n';
  const d = diffLines(전, 후);
  check('같은 줄이 반복돼도 하나만 지운다', d.removed === 1 && d.added === 0, `+${d.added} -${d.removed}`);
}

// ── 들여쓰기만 바뀌었을 때 ──────────────────────────────────────────────
{
  const d = diffLines('foo()\n', '  foo()\n');
  check('들여쓰기만 바뀌어도 잡는다', d.changed === true, String(d.changed));
  const 글 = renderDiff(d).map(색빼기).find((l) => l.includes('+'));
  check('들여쓰기를 지우지 않고 그린다', /\+\s.*\s\s+foo\(\)/.test(글 ?? '') || (글 ?? '').includes('  foo()'), JSON.stringify(글));
}

// ── 탭 ──────────────────────────────────────────────────────────────────
{
  const 글 = renderDiff(diffLines('a\n', '\tb\n')).map(색빼기).join('\n');
  check('탭을 그대로 안 찍는다', !글.includes('\t'), JSON.stringify(글.slice(0, 80)));
}

// ── 이상한 값 ───────────────────────────────────────────────────────────
{
  check('둘 다 없으면 안 죽는다', diffLines(null, null).changed === false, '');
  check('숫자를 줘도 안 죽는다', typeof diffLines(1, 2).added === 'number', '');
  check('render 에 이상한 걸 줘도 안 죽는다', Array.isArray(renderDiff(null)), '');
  check('shortStat 에 이상한 걸 줘도 안 죽는다', typeof shortStat(null) === 'string', '');
}

trace('9-도구에붙었나');

// ── Edit / Write 가 실제로 바뀐 자리를 들고 오는가 ──────────────────────
//
// 여기가 끊기면 diff.js 가 아무리 맞아도 화면에는 아무것도 안 나온다.
// 실제로 도구를 돌려서 결과에 붙어 오는지 본다.
{
  const { runTool } = await import('../src/tools/index.js');
  const { makeScope } = await import('../src/safety/guard.js');
  const { History } = await import('../src/safety/undo.js');
  const { Audit } = await import('../src/safety/audit.js');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { handle } = await import('../src/commands.js');
  const { Session } = await import('../src/agent/session.js');

  const root = mkdtempSync(join(tmpdir(), 'deel-diff-root-'));
  const ctx = {
    scope: makeScope(root), history: new History(root), audit: new Audit(root),
    seen: new Set(), skills: [], loadedSkills: new Set(), enc: new Map(),
  };
  ctx.history.nextTurn();

  const 파일 = join(root, '가.txt');
  writeFileSync(파일, '하나\n둘\n셋\n', 'utf8');
  ctx.seen.add(파일);

  const e = await runTool('Edit', { file_path: 파일, old_string: '둘', new_string: '이' }, ctx);
  check('Edit 결과에 바뀐 자리가 붙어 온다', !!e.diff, JSON.stringify(e.error ?? Object.keys(e)));
  check('Edit 이 센 것과 줄 수가 맞는다', e.diff?.added === 1 && e.diff?.removed === 1, `+${e.diff?.added} -${e.diff?.removed}`);

  const w = await runTool('Write', { file_path: 파일, content: '하나\n이\n셋\n넷\n' }, ctx);
  check('Write 결과에도 바뀐 자리가 붙는다', !!w.diff, JSON.stringify(w.error ?? Object.keys(w)));
  check('Write 는 늘어난 줄만 센다', w.diff?.added === 1 && w.diff?.removed === 0, `+${w.diff?.added} -${w.diff?.removed}`);

  const n = await runTool('Write', { file_path: join(root, '새것.txt'), content: '가\n나\n' }, ctx);
  check('새로 만든 파일도 전부 더한 것으로', n.diff?.isNew === true && n.diff?.added === 2, `${n.diff?.isNew} +${n.diff?.added}`);

  // 안 바뀌면 붙이지 않는다 — 화면에 빈 상자가 뜨면 안 된다.
  const 같게 = await runTool('Write', { file_path: 파일, content: '하나\n이\n셋\n넷\n' }, ctx);
  check('내용이 같으면 아무것도 안 붙인다', !같게.diff, JSON.stringify(같게.diff));

  // 모델에게 가는 글에는 안 섞여야 한다 — 컨텍스트를 통째로 잡아먹는다.
  check('모델에게 보내는 글에는 안 섞인다', !/linesA|opAt/.test(String(e.content)), String(e.content));

  trace('10-diff명령');

  // ── /diff ─────────────────────────────────────────────────────────────
  const s = new Session({ kind: 'openai', base: 'http://x/v1', model: 'ㅁ', ctx: 8192 }, { root, level: '개발자' });
  const 조용히 = async (fn) => {
    const 원래 = process.stdout.write.bind(process.stdout);
    let 모인것 = '';
    process.stdout.write = (chunk) => { 모인것 += chunk; return true; };
    try { const v = await fn(); return { v, out: 색빼기(모인것) }; } finally { process.stdout.write = 원래; }
  };

  const 빔 = await 조용히(() => handle('/diff', s, ctx));
  check('바뀐 게 없으면 없다고 한다', /바뀐 파일이 없습니다/.test(빔.out), 빔.out.trim().slice(0, 60));

  s.noteChange(파일, e.diff);
  s.noteChange(파일, w.diff);
  const 목록 = await 조용히(() => handle('/diff', s, ctx));
  check('바뀐 파일을 목록으로 보여준다', /가\.txt/.test(목록.out), 목록.out.trim().slice(0, 80));
  check('여러 번 고친 것을 합쳐 센다', /\+2/.test(목록.out), 목록.out.trim().slice(0, 120));
  check('몇 번 고쳤는지 적는다', /2번/.test(목록.out), 목록.out.trim().slice(0, 120));

  const 하나 = await 조용히(() => handle('/diff 가.txt', s, ctx));
  check('파일 하나를 자세히 펼친다', /\+.*넷/.test(하나.out), 하나.out.trim().slice(0, 200));
  check('처음 모습과 견준다', /-.*둘/.test(하나.out), 하나.out.trim().slice(0, 200));

  const 없는것 = await 조용히(() => handle('/diff 안건드림.txt', s, ctx));
  check('안 건드린 파일이면 그렇다고 한다', /안 바꾼 파일/.test(없는것.out), 없는것.out.trim().slice(0, 80));

  const 밖 = await 조용히(() => handle('/diff ../../밖.txt', s, ctx));
  check('작업 범위 밖은 막는다', /범위 밖|밖/.test(밖.out), 밖.out.trim().slice(0, 80));

  // 되돌아오면 '같다' 고 해야 한다 — 고쳤다가 원복한 경우.
  writeFileSync(파일, '하나\n둘\n셋\n', 'utf8');
  const 제자리 = await 조용히(() => handle('/diff 가.txt', s, ctx));
  check('되돌아왔으면 같다고 한다', /처음과 지금이 같습니다/.test(제자리.out), 제자리.out.trim().slice(0, 80));

  rmSync(root, { recursive: true, force: true });
}

trace('11-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n바뀐 자리 보여주기  ${D}(auto 모드에서 무엇이 바뀌었는지 보이는 유일한 통로)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
