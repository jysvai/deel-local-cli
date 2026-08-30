// `/review` — 바꾼 것을 새 창에서 한 번 더 본다.
//
// ── 무엇을 재나 ────────────────────────────────────────────────────────
//
// 두 가지가 핵심이다.
//   1) 지금 대화가 **한 줄도 안 나가야 한다.** 나가면 모델은 제가 한 말을
//      근거로 제 코드를 변호한다. 그래서 가짜 게이트웨이가 받은 몸통에
//      대화 글자가 없다는 것으로 잰다.
//   2) **아무것도 안 고쳐야 한다.** 파일 내용이 그대로인 것으로 잰다.
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 볼것, 보낼것, 리뷰받기, 찾은것가르기, 자리찾기, 검사표 } from '../src/agent/review.js';
import { 깃 } from '../src/agent/commit.js';
import { Session } from '../src/agent/session.js';
import { makeScope } from '../src/safety/guard.js';
import { allowEndpoint, resetNet } from '../src/safety/network.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 0. 저장소 하나 만들기 ──────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'deel-review-'));
깃(root, ['init', '-q'], {});
깃(root, ['config', 'user.email', 'a@b.c'], {});
깃(root, ['config', 'user.name', '검사'], {});
writeFileSync(join(root, 'a.js'), 'export const a = 1;\n', 'utf8');
writeFileSync(join(root, '남의것.js'), '// 남이 고친 것\n', 'utf8');
깃(root, ['add', '-A'], {});
깃(root, ['commit', '-m', '첫 커밋'], {});

// ── 1. 답 가르기 ───────────────────────────────────────────────────────
trace('1-가르기');
{
  const 글 = [
    '심각  src/a.js:42',
    '      열쇠가 오류 문구에 그대로 실린다.',
    '',
    '보통 src/b.js:7 — 빈 배열이면 undefined 가 넘어간다',
    'nit: 이름이 헷갈린다',
  ].join('\n');
  const 것들 = 찾은것가르기(글);
  check('세 개로 가른다', 것들.length === 3, JSON.stringify(것들.map((x) => x.급)));
  check('급을 읽는다', 것들.map((x) => x.급).join(',') === '심각,보통,사소', 것들.map((x) => x.급).join(','));
  check('아래 줄에서 자리를 찾는다', 것들[0].자리?.파일 === 'src/a.js' && 것들[0].자리?.줄 === 42,
    JSON.stringify(것들[0].자리));
  check('같은 줄에 있어도 찾는다', 것들[1].자리?.줄 === 7, JSON.stringify(것들[1].자리));
  check('자리가 없으면 null — 지어내지 않는다', 것들[2].자리 === null, JSON.stringify(것들[2].자리));

  check('한글 경로도 찾는다', 자리찾기('보통 src/한글파일.js:3 …')?.파일 === 'src/한글파일.js');
  check('윈도우 경로도 찾는다', 자리찾기('심각 src\\a.js:9')?.줄 === 9, JSON.stringify(자리찾기('심각 src\\a.js:9')));
  check('아무 숫자나 자리로 안 본다', 자리찾기('심각 3:14 는 원주율') === null, JSON.stringify(자리찾기('심각 3:14 는 원주율')));
  check('빈 답은 빈 목록', 찾은것가르기('').length === 0);
  check('형식을 안 지키면 아무것도 안 가른다', 찾은것가르기('그냥 줄글입니다').length === 0);
}

// ── 2. 무엇을 볼지 ─────────────────────────────────────────────────────
trace('2-볼것');
{
  const scope = makeScope(root);
  const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', auth: 'none', key: '', model: 'm', ctx: 8000 };

  // 아무것도 안 바꿨으면 볼 것이 없다.
  const 빈세션 = new Session(conn, { root });
  const 없을때 = 볼것(빈세션, { scope });
  check('안 바꿨으면 볼 것이 없다', 없을때.ok === false && /바뀐 것이 없습니다/.test(없을때.왜), 없을때.왜);

  // 이번 대화가 바꾼 것만 본다 — 남이 고친 것은 안 딸려 온다.
  writeFileSync(join(root, 'a.js'), 'export const a = 2;\n', 'utf8');
  writeFileSync(join(root, '남의것.js'), '// 남이 또 고침\n', 'utf8');
  const s = new Session(conn, { root });
  s.noteChange(join(root, 'a.js'), { added: 1, removed: 1 });
  const 것 = 볼것(s, { scope });
  check('바뀐 것을 찾는다', 것.ok === true, 것.왜);
  check('이번 대화가 바꾼 것만 본다', 것.파일들.join(',') === 'a.js', 것.파일들.join(','));
  check('어디를 보는지 말해 준다', 것.어디 === '이번 대화가 바꾼 것', 것.어디);
  check('diff 에 남의 것이 안 섞인다', !것.diff.includes('남이 또 고침'), 것.diff.slice(0, 60));

  // 아무것도 안 적힌 세션이면 저장소 전체를 본다 — 사람이 직접 고친 것도 봐 준다.
  const 전체 = 볼것(new Session(conn, { root }), { scope });
  check('적힌 게 없으면 저장소 전체', 전체.ok && 전체.파일들.length === 2, 전체.파일들.join(','));
  check('그때는 그렇다고 말해 준다', 전체.어디 === '저장소의 바뀐 것 전부', 전체.어디);

  // git 이 아닌 곳.
  const 맨폴더 = mkdtempSync(join(tmpdir(), 'deel-nogit-'));
  const 아님 = 볼것(new Session(conn, { root: 맨폴더 }), { scope: makeScope(맨폴더) });
  check('git 이 아니면 그렇다고 말한다', 아님.ok === false && /git 저장소가 아닙니다/.test(아님.왜), 아님.왜);
}

// ── 3. 보낼 덩이 ───────────────────────────────────────────────────────
trace('3-보낼것');
{
  const 몫 = 보낼것({ diff: 'diff --git a/a.js\n+const a = 2;', 통계: ' a.js | 2 +-', 파일들: ['a.js'] });
  check('검사표가 들어 있다', 검사표.every(([이름]) => 몫.includes(이름)), 검사표.map((x) => x[0]).join(','));
  check('고치지 말라고 못박는다', /고치지 마라/.test(몫));
  check('자리를 못 짚으면 쓰지 말라고 한다', /자리를 못 짚겠으면/.test(몫));
  check('못 찾았으면 못 찾았다고 하라고 한다', /지어내지 마라/.test(몫));
  check('diff 가 들어 있다', 몫.includes('+const a = 2;'));

  // 긴 diff 는 자르되 잘랐다고 적는다 — 조용히 자르면 모델이 다 본 줄 안다.
  const 긴것 = 보낼것({ diff: 'x'.repeat(70000), 통계: '', 파일들: ['a.js'] });
  check('긴 diff 는 자른다', 긴것.length < 70000, String(긴것.length));
  check('잘랐다고 적는다', /여기서 잘랐습니다/.test(긴것));
}

// ── 4. 진짜로 부른다 — 대화는 안 나가고, 파일은 안 바뀐다 ──────────────
trace('4-진짜');
{
  const 받은몸통 = [];
  const server = createServer((q, res) => {
    let body = '';
    q.on('data', (d) => (body += d));
    q.on('end', () => {
      받은몸통.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{
          message: { content: '심각  a.js:1\n      상수를 바꿨는데 쓰는 자리를 안 고쳤다.\n\n사소 이름이 짧다' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 10 },
      }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  resetNet();
  allowEndpoint(base);

  const conn = { kind: 'openai', base, auth: 'none', key: '', model: 'm', ctx: 8000 };
  const s = new Session(conn, { root });
  // 대화를 잔뜩 채워 둔다. 이게 새어 나가면 안 된다.
  s.push({ role: 'user', content: '비밀스러운부탁 이 파일 좀 고쳐줘' });
  s.push({ role: 'assistant', content: '제가스스로변호하는말 잘 고쳤습니다.' });
  s.noteChange(join(root, 'a.js'), { added: 1, removed: 1 });

  const 앞내용 = readFileSync(join(root, 'a.js'), 'utf8');
  const 것 = 볼것(s, { scope: makeScope(root) });
  const r = await 리뷰받기(s, 것);

  check('리뷰를 받아 온다', r.ok === true, r.왜);
  check('찾은 것을 가른다', r.찾은것.length === 2, JSON.stringify(r.찾은것.map((x) => x.급)));
  check('자리를 짚는다', r.찾은것[0].자리?.파일 === 'a.js', JSON.stringify(r.찾은것[0].자리));

  const 나간것 = 받은몸통.join('');
  check('지금 대화는 한 줄도 안 나간다', !나간것.includes('비밀스러운부탁'), '대화가 새어 나갔습니다');
  check('모델이 한 말도 안 나간다', !나간것.includes('제가스스로변호하는말'));
  check('바뀐 코드는 나간다', 나간것.includes('const a = 2'), 나간것.slice(0, 80));
  check('한 번만 부른다', 받은몸통.length === 1, `${받은몸통.length}번`);
  // 도구를 안 준다 — 리뷰는 손이 없어야 한다.
  check('도구를 안 준다', !/"tools"/.test(나간것), 나간것.slice(0, 200));

  check('파일을 안 고친다', readFileSync(join(root, 'a.js'), 'utf8') === 앞내용, '파일이 바뀌었습니다');

  // 모델이 빈 답을 주면 지어내지 않는다.
  받은몸통.length = 0;
  server.close();
  const 빈server = createServer((q, res) => {
    let body = '';
    q.on('data', (d) => (body += d));
    q.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'stop' }], usage: {} }));
    });
  });
  await new Promise((r2) => 빈server.listen(0, '127.0.0.1', r2));
  const base2 = `http://127.0.0.1:${빈server.address().port}/v1`;
  allowEndpoint([base, base2]);
  const s2 = new Session({ ...conn, base: base2 }, { root });
  s2.noteChange(join(root, 'a.js'), { added: 1, removed: 1 });
  const r2 = await 리뷰받기(s2, 볼것(s2, { scope: makeScope(root) }));
  check('빈 답은 못 봤다고 한다', r2.ok === false && /빈 답/.test(r2.왜), r2.왜);
  빈server.close();
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n리뷰 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
