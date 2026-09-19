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
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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

  /*
   * ── 8회차 판정 · 자리를 못 짚으면 그 지적은 통째로 버려진다 ────────────
   *
   * 보낼것() 이 리뷰어에게 「자리를 못 짚겠으면 그 지적은 쓰지 마라」 고 시킨다.
   * 그런데 받는 쪽 자리찾기 는 **확장자가 있어야만** 자리로 본다. 그래서
   * 리뷰어가 제대로 짚은 자리도 우리 쪽에서 못 알아보고 `자리: null` 이 된다.
   *
   *   - 확장자가 없는 파일: Makefile · Dockerfile · Jenkinsfile · .env
   *   - 대괄호 라우트: app/[id]/page.tsx — 대괄호가 글자표에 없어 앞이 잘린다
   */
  check("★★ 확장자 없는 파일도 자리로 본다 (Makefile)",
    자리찾기("심각 Makefile:12 에서 탭이 빠졌다")?.파일 === "Makefile",
    JSON.stringify(자리찾기("심각 Makefile:12 에서 탭이 빠졌다")));
  check("  Dockerfile 도",
    자리찾기("보통 build/Dockerfile:3 의 FROM")?.파일 === "build/Dockerfile",
    JSON.stringify(자리찾기("보통 build/Dockerfile:3 의 FROM")));
  check("★★ 대괄호 라우트도 통째로 잡는다",
    자리찾기("심각 app/[id]/page.tsx:42 에서")?.파일 === "app/[id]/page.tsx",
    JSON.stringify(자리찾기("심각 app/[id]/page.tsx:42 에서")));
  // 경로가 붙으면 확장자도 대문자도 없는 이름까지 파일로 본다 — 실행 파일이 그렇다.
  check("★★ 경로가 붙은 확장자 없는 소문자 이름도 자리로 본다 (bin/deel)",
    자리찾기("심각 bin/deel:12 에서 인자를 못 읽는다")?.파일 === "bin/deel",
    JSON.stringify(자리찾기("심각 bin/deel:12 에서 인자를 못 읽는다")));
  check("  scripts/build 도",
    자리찾기("보통 scripts/build:4 의 set -e")?.파일 === "scripts/build",
    JSON.stringify(자리찾기("보통 scripts/build:4 의 set -e")));
  // 반대쪽 — 경로가 없으면 소문자 맨 낱말은 파일이 아니다 (host:port 가 자리로 잡히면 안 된다).
  check("  경로도 점도 없는 소문자 낱말은 자리가 아니다",
    자리찾기("보통 localhost:8080 이 안 열린다") === null,
    JSON.stringify(자리찾기("보통 localhost:8080 이 안 열린다")));
  /*
   * ★★ 주소 속 `host:port` 도 자리가 아니다 (막판 훑기).
   *
   * 바로 위 줄이 「host:port 가 자리로 잡히면 안 된다」 고 적어 두고 점 없는 이름
   * 하나만 쟀다. 점이 든 호스트는 `파일같나` 가 「점이 있으니 파일」 로 통과시켜,
   * 리뷰가 적은 주소 하나가 `example.com` 파일의 8080번째 줄이라는 자리로 굳었다.
   * 사람은 그 자리로 가려다 없는 파일을 만난다 — 그리고 그 지적이 정말 어디를
   * 가리키는지는 영영 모른다. 파일같나 의 머리말도 「호스트 이름을 걸러 낸다」 고
   * 적혀 있었는데 걸러 낸 적이 없었다.
   */
  for (const 줄 of ["보통 https://api.example.com:8080 이 안 열린다",
    "심각 서버가 http://10.0.0.5:3000 에서 죽는다",
    "사소 redis://cache.example.com:6379 로 붙는다"]) {
    check(`  주소 속 host:port 는 자리가 아니다 — "${줄.slice(0, 32)}"`,
      자리찾기(줄) === null, JSON.stringify(자리찾기(줄)));
  }
  check("  주소가 같이 있어도 진짜 자리는 찾는다",
    자리찾기("심각 https://docs.example.com:8080 를 보면 src/a.js:42 가 틀렸다")?.파일 === "src/a.js",
    JSON.stringify(자리찾기("심각 https://docs.example.com:8080 를 보면 src/a.js:42 가 틀렸다")));
  check("  점으로 여는 파일도",
    자리찾기("사소 .env:7 에 열쇠가 있다")?.파일 === ".env",
    JSON.stringify(자리찾기("사소 .env:7 에 열쇠가 있다")));
  // 반대쪽 — 넓혔다고 아무 낱말이나 자리가 되면 안 된다.
  check("  그래도 맨 낱말은 자리가 아니다",
    자리찾기("심각 3:14 는 원주율") === null && 자리찾기("보통 오후 3:14 에") === null
    // 점이 있어도 글자가 없으면 파일이 아니다 — 여기가 「맨 숫자」 관문이 혼자 서는 자리다.
    && 자리찾기("보통 원주율 3.14:15 쯤") === null,
    JSON.stringify([자리찾기("심각 3:14 는 원주율"), 자리찾기("보통 오후 3:14 에"), 자리찾기("보통 원주율 3.14:15 쯤")]));
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

  /*
   * ── 8회차 판정 · 저장소 전체를 볼 때 열쇠가 리뷰로 나갔다 ─────────────
   *
   * 121줄은 **새 파일** 쪽에만 살림 막이를 걸며 「.deel/config.json 이 안 무시된
   * 저장소면 열쇠가 리뷰로 나간다」 고 적어 뒀다. 그런데 이미 추적 중인 살림은
   * 그 막이를 안 지난다 — `git diff` 가 경로 없이 돌기 때문이다.
   *
   * 이번 대화가 바꾼 것이 없으면 `경로` 가 빈 배열이고, `git diff HEAD --` 는
   * **저장소 전체**를 뜬다. 거기에 `.deel/config.json` 이 들어 있으면 게이트웨이
   * 열쇠가 그대로 diff 에 실려 **바깥 리뷰 모델로 나간다.** 리뷰는 남의 서버로
   * 글을 보내는 기능이라, 이건 화면에 안 보이고 되돌릴 수도 없다.
   */
  {
    const 살림방 = mkdtempSync(join(tmpdir(), 'deel-리뷰살림-'));
    const 깃돌리기 = (...인자) => execFileSync('git', 인자, { cwd: 살림방, stdio: 'pipe' });
    깃돌리기('init', '-q');
    깃돌리기('config', 'user.email', 'x@y.z');
    깃돌리기('config', 'user.name', 'x');
    mkdirSync(join(살림방, '.deel'), { recursive: true });
    writeFileSync(join(살림방, '.deel', 'config.json'), '{"key":"sk-OLD-0000"}', 'utf8');
    writeFileSync(join(살림방, 'app.js'), 'const a = 1;\n', 'utf8');
    깃돌리기('add', '-A');
    깃돌리기('commit', '-q', '-m', '첫 커밋');
    // 이제 열쇠를 바꾼다. 추적 중이라 diff 에 뜬다.
    writeFileSync(join(살림방, '.deel', 'config.json'), '{"key":"sk-CHANGED-SECRET-9999"}', 'utf8');
    writeFileSync(join(살림방, 'app.js'), 'const a = 2;\n', 'utf8');

    const 살림것 = 볼것(new Session(conn, { root: 살림방 }), { scope: makeScope(살림방) });
    check('★★★ 저장소 전체를 볼 때도 살림(.deel)은 diff 에 안 싣는다',
      살림것.ok && !살림것.diff.includes('sk-CHANGED-SECRET-9999'),
      살림것.ok ? 살림것.diff.slice(0, 120) : 살림것.왜);
    check('  파일 목록에도 안 뜬다',
      !(살림것.파일들 ?? []).some((f) => f.includes('.deel')), (살림것.파일들 ?? []).join(','));
    check('  그래도 멀쩡한 파일은 그대로 본다',
      (살림것.파일들 ?? []).includes('app.js'), (살림것.파일들 ?? []).join(','));

    const 보낼 = 살림것.ok ? 보낼것(살림것) : '';
    check('★★★ 바깥으로 보낼 글에도 열쇠가 안 실린다',
      !String(보낼?.글 ?? 보낼 ?? '').includes('sk-CHANGED-SECRET-9999'),
      String(보낼?.글 ?? 보낼 ?? '').slice(0, 120));
    rmSync(살림방, { recursive: true, force: true });
  }

  // git 이 아닌 곳.
  const 맨폴더 = mkdtempSync(join(tmpdir(), 'deel-nogit-'));
  const 아님 = 볼것(new Session(conn, { root: 맨폴더 }), { scope: makeScope(맨폴더) });
  check('git 이 아니면 그렇다고 말한다', 아님.ok === false && /git 저장소가 아닙니다/.test(아님.왜), 아님.왜);

  /*
   * 이름이 빈칸으로 시작하는 파일 (6회차 커밋 C5 와 같은 자리).
   * 바뀐 목록을 줄로 받아 줄마다 trim 해서 ` 앞빈칸.js` 가 `앞빈칸.js` 로
   * 적혔다 — 리뷰가 없는 이름을 짚는다. NUL 로 끊어 받는다.
   */
  const 빈칸곳 = mkdtempSync(join(tmpdir(), 'deel-review-sp-'));
  깃(빈칸곳, ['init', '-q'], {});
  깃(빈칸곳, ['config', 'user.email', 'a@b.c'], {});
  깃(빈칸곳, ['config', 'user.name', '검사'], {});
  writeFileSync(join(빈칸곳, ' 앞빈칸.js'), 'export const b = 1;\n', 'utf8');
  깃(빈칸곳, ['add', '-A'], {});
  깃(빈칸곳, ['commit', '-m', '첫 커밋'], {});
  writeFileSync(join(빈칸곳, ' 앞빈칸.js'), 'export const b = 2;\n', 'utf8');
  const 빈칸판 = new Session(conn, { root: 빈칸곳 });
  빈칸판.noteChange(join(빈칸곳, ' 앞빈칸.js'), { added: 1, removed: 1 });
  const 빈칸 = 볼것(빈칸판, { scope: makeScope(빈칸곳) });
  check('★ (6회차 C5) 이름이 빈칸으로 시작하는 파일을 잘라서 적지 않는다',
    빈칸.ok && JSON.stringify(빈칸.파일들) === JSON.stringify([' 앞빈칸.js']), JSON.stringify(빈칸.파일들 ?? 빈칸.왜));
  rmSync(빈칸곳, { recursive: true, force: true });
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

// ── 5. ★★ (사냥5 H5-5) 「볼 것이 없다」 로 잘못 답하던 세 자리 ─────────────
//
// 볼 것을 `git diff HEAD` 한 벌로만 골랐다. 그래서
//   1) 대화가 **새 파일만** 만들었으면 — git 이 아직 모르는 파일이라 diff 에 안 나온다
//   2) **첫 커밋 전** 저장소면 — HEAD 가 없어 git 이 오류로 죽는다
//   3) git 이 **답을 못 했으면**(index 깨짐·64MB 넘는 diff) — 빈 글이 온다
// 셋 다 「바뀐 것이 없습니다」 가 됐다. 새 파일에 eval(받은글) 을 넣어 놓고 리뷰를
// 시켰는데 볼 것이 없다는 답을 받는다 — 리뷰가 제일 봐야 할 자리에서 눈을 감는다.
trace('5-사냥5');
{
  const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', auth: 'none', key: '', model: 'm', ctx: 8000 };
  const 새저장소 = (첫커밋 = true) => {
    const r = mkdtempSync(join(tmpdir(), 'deel-review-h55-'));
    깃(r, ['init', '-q'], {});
    깃(r, ['config', 'user.email', 'a@b.c'], {});
    깃(r, ['config', 'user.name', '검사'], {});
    깃(r, ['config', 'commit.gpgsign', 'false'], {});
    writeFileSync(join(r, 'old.js'), 'let a = 1;\n', 'utf8');
    if (첫커밋) { 깃(r, ['add', '-A'], {}); 깃(r, ['commit', '-q', '-m', '첫'], {}); }
    return r;
  };
  const 세션 = (r, ...파일) => {
    const s = new Session(conn, { root: r });
    for (const f of 파일) s.noteChange(join(r, f), { added: 1, removed: 0 });
    return s;
  };
  const 줄임 = (것) => JSON.stringify({ ok: 것.ok, 왜: 것.왜, 파일들: 것.파일들 });

  {
    const r = 새저장소();
    writeFileSync(join(r, '새것.js'), 'eval(받은글);\n', 'utf8');
    const 것 = 볼것(세션(r, '새것.js'), { scope: makeScope(r) });
    check('★★ (사냥5 H5-5) 대화가 새로 만든 파일만 있어도 볼 것이 있다',
      것.ok === true && (것.파일들 ?? []).includes('새것.js'), 줄임(것));
    check('★★ (사냥5 H5-5) 새 파일의 내용이 diff 에 실린다', 것.ok === true && /eval\(받은글\)/.test(것.diff ?? ''), 줄임(것));

    // 적힌 것이 없는 세션 — 저장소 전체를 볼 때도 새 파일은 바뀐 것이다. 살림은 빼고.
    mkdirSync(join(r, '.deel'), { recursive: true });
    writeFileSync(join(r, '.deel', 'config.json'), '{"apiKey":"열쇠-리뷰로-새면-안됨"}', 'utf8');
    const 전체 = 볼것(세션(r), { scope: makeScope(r) });
    check('★ (사냥5 H5-5) 저장소 전체를 볼 때도 새 파일을 넣는다', 전체.ok === true && (전체.파일들 ?? []).includes('새것.js'), 줄임(전체));
    check('★★ (사냥5 H5-5) 새 파일을 넣어도 살림(.deel) 은 안 싣는다',
      !(전체.diff ?? '').includes('열쇠-리뷰로-새면-안됨') && !(전체.파일들 ?? []).some((f) => /\.deel/i.test(f)), 줄임(전체));
    rmSync(r, { recursive: true, force: true });
  }

  {
    const r = 새저장소(false);
    깃(r, ['add', 'old.js'], {});
    writeFileSync(join(r, 'old.js'), 'let a = 2;\n', 'utf8');
    const 것 = 볼것(세션(r, 'old.js'), { scope: makeScope(r) });
    check('★★ (사냥5 H5-5) 첫 커밋 전 저장소에서도 바꾼 것을 본다', 것.ok === true && /let a = 2/.test(것.diff ?? ''), 줄임(것));
    rmSync(r, { recursive: true, force: true });
  }

  {
    const r = 새저장소();
    writeFileSync(join(r, 'old.js'), 'let a = 3;\n', 'utf8');
    writeFileSync(join(r, '.git', 'index'), 'garbage', 'utf8');
    const 것 = 볼것(세션(r, 'old.js'), { scope: makeScope(r) });
    check('★★ (사냥5 H5-5) git 이 못 읽었으면 「바뀐 것이 없다」 고 하지 않는다',
      것.ok === false && !/볼 것이 없습니다|바뀐 것이 없습니다/.test(것.왜 ?? ''), 줄임(것));
    check('★ (사냥5 H5-5) 못 읽은 까닭을 같이 말한다', /index/i.test(것.왜 ?? ''), 줄임(것));
    rmSync(r, { recursive: true, force: true });
  }
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n리뷰 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
