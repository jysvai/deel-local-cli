/**
 * 셸이 바꾼 파일도 되돌린다 — git 저장소에서 (2.1.3 · safety/gitsnap.js · tools/index.js 의 Bash).
 *
 * ── 왜 이 파일이 있나 ──────────────────────────────────────────────────
 *
 * Bash 의 되돌리기는 **명령줄에 적힌 이름**을 보고 떴다(tools/index.js 의 바꾸기전스냅샷). 그래서 셸이 푸는
 * 와일드카드(`rm *.tmp`), 스크립트 안에서 고치는 것(`npm run format` · `node 고치기.js` · `npx prettier --write .`)
 * 은 떠 둔 것이 없어 /undo 뒤에도 그대로였다 — 모델이 파일을 제일 많이 바꾸는 길이 바로 그 둘이다.
 *
 * git 저장소면 명령 앞뒤의 `git status` 를 견줘 **정말 바뀐 파일**을 알고, 앞 모습은 git 이 들고 있거나(커밋된 것)
 * 명령 전에 떠 둔 사본(안 올린 것 · 고치던 것)에서 가져온다. .git 에는 아무것도 안 쓴다.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trace } from './trace.mjs';

const 집 = mkdtempSync(join(tmpdir(), 'deel-gitsnap-home-'));
process.env.DEEL_HOME = 집;
const { runTool } = await import('../src/tools/index.js');
const { makeScope } = await import('../src/safety/guard.js');
const { History } = await import('../src/safety/undo.js');
const { 깃앞보기, 깃뒤적기 } = await import('../src/safety/gitsnap.js');

const pass = [];
const fail = [];
const 건너뜀 = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 읽기 = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const 깃 = (root, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...a], { cwd: root, encoding: 'utf8', windowsHide: true });

if (깃(process.cwd(), '--version').status !== 0) {
  건너뜀.push('git 이 없는 PC — 이 파일 전체를 못 잼');
} else {
  const root = mkdtempSync(join(tmpdir(), 'deel-gitsnap-'));
  깃(root, 'init', '-q');
  // 이 저장소의 파일은 LF 로 쓴다. deel 이 부르는 git 은 사람의 전역 설정을 따르니(윈도우용 git 은 autocrlf=true)
  // 저장소에 못박는다 — 앞 모습은 git 이 작업 폴더에 꺼내 줄 모습이다(4c 가 CRLF 쪽을 잰다).
  깃(root, 'config', 'core.autocrlf', 'false');
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, '.gitignore'), '*.log\n', 'utf8');
  writeFileSync(join(root, 'a.txt'), '에이 원본\n', 'utf8');
  writeFileSync(join(root, 'b.txt'), '비 원본\n', 'utf8');
  writeFileSync(join(root, 'sub', 'c.txt'), '씨 원본\n', 'utf8');
  writeFileSync(join(root, 'd.txt'), '디 커밋본\n', 'utf8');
  깃(root, 'add', '-A'); 깃(root, 'commit', '-q', '-m', '처음');
  // 명령 전부터 고치던 것 · 안 올린 것 · 무시되는 것
  writeFileSync(join(root, 'd.txt'), '디 고치던 중\n', 'utf8');
  writeFileSync(join(root, 'u.txt'), '유 안 올림\n', 'utf8');
  writeFileSync(join(root, 'x.log'), '로그 원본\n', 'utf8');
  // 명령줄에 이름이 안 나오게 스크립트로 바꾼다 — 낱말 보고 뜨기가 못 보는 자리.
  writeFileSync(join(root, '고치기.cjs'), [
    "const fs = require('fs');",
    "fs.writeFileSync('a.txt', '에이 바뀜\\n');",
    "fs.rmSync('b.txt');",
    "fs.rmSync('sub/c.txt');",
    "fs.writeFileSync('d.txt', '디 스크립트가 덮음\\n');",
    "fs.writeFileSync('u.txt', '유 바뀜\\n');",
    "fs.writeFileSync('새것.txt', '새로 생김\\n');",
    "fs.writeFileSync('x.log', '로그 바뀜\\n');",
    // 스크립트가 deel 제 살림 자리에 쓴 것 — 되돌리기 이력 · 감사 기록이 사는 곳이라 적으면 안 된다.
    "fs.mkdirSync('.deel', { recursive: true }); fs.writeFileSync('.deel/스크립트가씀.txt', 'x');",
  ].join('\n'), 'utf8');
  깃(root, 'add', '고치기.cjs'); 깃(root, 'commit', '-q', '-m', '스크립트');

  const history = new History(root);
  const ctx = { scope: makeScope(root), history, audit: { tool() {}, blocked() {} }, seen: new Set(), 모델컨텍스트: 32768, 모드: 'auto' };

  trace('1-스크립트');
  {
    history.nextTurn();
    const r = await runTool('Bash', { command: 'node 고치기.cjs' }, ctx);
    check('  스크립트가 돌았다', !r.error && 읽기(join(root, 'a.txt')) === '에이 바뀜\n', JSON.stringify(r).slice(0, 200));
    const 이름들 = (r.되돌릴것 ?? []).map(String);
    check('★★★ 명령줄에 이름이 없어도 바뀐 파일을 되돌릴 거리로 적는다',
      ['a.txt', 'b.txt', 'd.txt', 'u.txt', '새것.txt'].every((n) => 이름들.some((x) => x.endsWith(n))) && 이름들.some((x) => /c\.txt$/.test(x)),
      이름들.join(', '));
    check('★ 무시되는 파일(.gitignore)은 되돌린다고 말하지 않는다 — git 이 안 보는 자리다', !이름들.some((x) => x.endsWith('x.log')), 이름들.join(', '));
    check('★★ deel 제 살림(.deel)은 적지 않는다', !이름들.some((x) => /\.deel/.test(x)), 이름들.join(', '));

    const 되돌림 = history.undo(1);
    check('  되돌리기가 돌았다', 되돌림.turns === 1, JSON.stringify(되돌림).slice(0, 200));
    check('★★★ 커밋된 파일은 커밋된 모습으로 돌아온다', 읽기(join(root, 'a.txt')) === '에이 원본\n', 읽기(join(root, 'a.txt')));
    check('★★★ 스크립트가 지운 파일이 돌아온다 (하위 폴더 것도)', 읽기(join(root, 'b.txt')) === '비 원본\n' && 읽기(join(root, 'sub', 'c.txt')) === '씨 원본\n');
    check('★★★ 고치던 파일은 커밋본이 아니라 **명령 직전** 모습으로 돌아온다', 읽기(join(root, 'd.txt')) === '디 고치던 중\n', 읽기(join(root, 'd.txt')));
    check('★★ 안 올린 파일도 명령 직전 모습으로 돌아온다', 읽기(join(root, 'u.txt')) === '유 안 올림\n', 읽기(join(root, 'u.txt')));
    check('★★ 명령이 새로 만든 파일은 지운다', !existsSync(join(root, '새것.txt')));
    check('  무시되는 파일은 그대로 둔다 (못 떴다)', 읽기(join(root, 'x.log')) === '로그 바뀜\n');
  }

  trace('2-안바꾼명령');
  {
    history.nextTurn();
    const 전 = history.turns().length;
    const r = await runTool('Bash', { command: 'git status --short' }, ctx);
    check('★★ 아무것도 안 바꾼 명령은 기록을 안 남긴다 — /undo 한 번이 헛턴에 먹히면 안 된다',
      !r.error && history.turns().length === 전 && !(r.되돌릴것 ?? []).length, `턴 ${전} → ${history.turns().length}`);
  }

  trace('3-낱말과겹침');
  {
    // 명령줄에 이름이 있으면 앞 갈래가 이미 떴다 — 같은 파일을 두 번 적지 않는다.
    history.nextTurn();
    const r = await runTool('Bash', { command: 'node -e "require(\'fs\').writeFileSync(\'a.txt\',\'둘\')" > a.txt' }, ctx);
    const 기록 = history.all().filter((x) => x.turn === history.turn && /a\.txt$/.test(x.path));
    check('★ 같은 파일은 한 턴에 한 번만 적는다', 기록.length === 1, `기록 ${기록.length}개 · ${JSON.stringify(r).slice(0, 120)}`);
    history.undo(1);
    check('  그리고 돌아온다', 읽기(join(root, 'a.txt')) === '에이 원본\n', 읽기(join(root, 'a.txt')));
  }

  trace('4-함수');
  {
    history.nextTurn();
    const 앞 = 깃앞보기(root);
    check('★ 깃앞보기 는 저장소에서 앞 모습을 준다', !!앞 && 앞.앞머리 === '' && 앞.표 instanceof Map, JSON.stringify(Object.keys(앞 ?? {})));
    writeFileSync(join(root, 'a.txt'), '함수로 바꿈\n', 'utf8');
    const 뒤 = 깃뒤적기(앞, { history, scope: ctx.scope });
    check('★ 깃뒤적기 는 바뀐 것을 적고 이름을 준다', 뒤.뜬것.some((p) => p.endsWith('a.txt')), JSON.stringify(뒤));
    history.undo(1);
    check('  그 기록으로 돌아온다', 읽기(join(root, 'a.txt')) === '에이 원본\n');
  }

  trace('4b-하위폴더');
  {
    // 작업 폴더가 저장소의 하위 폴더다. 그 안만 맡는다 — 밖(../a.txt)은 적지도 되돌리지도 않는다.
    const 하위 = join(root, 'sub');
    writeFileSync(join(하위, '고치기2.cjs'), "const fs=require('fs');fs.writeFileSync('c.txt','하위에서 바뀜');fs.writeFileSync('../a.txt','밖에서 바뀜');", 'utf8');
    const h3 = new History(하위);
    h3.nextTurn();
    const r = await runTool('Bash', { command: 'node 고치기2.cjs' }, { ...ctx, scope: makeScope(하위), history: h3 });
    const 이름들 = (r.되돌릴것 ?? []).map(String);
    check('★★ 하위 폴더가 작업 폴더면 그 안의 바뀐 파일만 적는다', 이름들.some((x) => x.endsWith('c.txt')) && !이름들.some((x) => x.endsWith('a.txt')), 이름들.join(', '));
    h3.undo(1);
    check('★★ 그리고 그 안의 것이 돌아온다', 읽기(join(하위, 'c.txt')) === '씨 원본\n', 읽기(join(하위, 'c.txt')));
    깃(root, 'checkout', '--', 'a.txt');
    rmSync(join(하위, '고치기2.cjs'), { force: true });
  }

  trace('4c-2차눈');
  {
    // 2차 눈(제미니)이 짚어 재 보니 참이던 것. 제 저장소를 따로 둔다 — 줄 끝 설정을 이 저장소에만 건다.
    const r2 = mkdtempSync(join(tmpdir(), 'deel-gitsnap2-'));
    깃(r2, 'init', '-q');
    깃(r2, 'config', 'core.autocrlf', 'true');
    writeFileSync(join(r2, 'crlf.txt'), '줄1\n줄2\n', 'utf8');
    writeFileSync(join(r2, 'k.txt'), '케이\n', 'utf8');
    writeFileSync(join(r2, 'm.txt'), '엠\n', 'utf8');
    writeFileSync(join(r2, 'd2.txt'), '디둘 커밋\n', 'utf8');
    for (let i = 0; i < 120; i++) writeFileSync(join(r2, `많음${i}.txt`), `원래 ${i}\n`, 'utf8');
    깃(r2, 'add', '-A'); 깃(r2, 'commit', '-q', '-m', '처음');
    // 윈도우용 git 을 깔면 켜지는 core.autocrlf=true — 꺼내면 작업 폴더의 파일은 CRLF 다(커밋 안의 것은 LF).
    // 받아 온(clone) 저장소처럼 다 지우고 git 이 꺼내게 한다.
    for (const f of ['crlf.txt', 'k.txt', 'm.txt', 'd2.txt', ...Array.from({ length: 120 }, (_, i) => `많음${i}.txt`)]) rmSync(join(r2, f));
    깃(r2, '-c', 'core.autocrlf=true', 'checkout', '--', '.');
    const 꺼낸것 = readFileSync(join(r2, 'crlf.txt'));
    const 꺼낸케이 = readFileSync(join(r2, 'k.txt'));
    const 꺼낸많음 = readFileSync(join(r2, '많음119.txt'));
    writeFileSync(join(r2, 'd2.txt'), '디둘 고치던 중\n', 'utf8');
    const 초 = Math.floor(Date.now() / 1000);
    utimesSync(join(r2, 'd2.txt'), 초, 초);
    const 적은 = new Map();
    const 가짜이력 = { 뒤늦은기록: (abs, 앞) => { 적은.set(abs.replace(/\\/g, '/').split('/').pop(), 앞); return {}; } };

    const 앞 = 깃앞보기(r2);
    writeFileSync(join(r2, 'crlf.txt'), '바뀜\n', 'utf8');
    spawnSync('git', ['rm', '--cached', '-q', 'k.txt'], { cwd: r2, windowsHide: true });
    // 크기가 같은 다른 내용을 쓰고 수정 시각을 되돌린다 — 시각이 굵은 파일 시스템(FAT 2초)에서 한 틈에 두 번 쓴 꼴.
    writeFileSync(join(r2, 'd2.txt'), '디둘 덮었던 중\n', 'utf8');
    utimesSync(join(r2, 'd2.txt'), 초, 초);
    for (let i = 0; i < 120; i++) writeFileSync(join(r2, `많음${i}.txt`), `바뀜 ${i}\n`, 'utf8');
    const 시작 = Date.now();
    const 뒤 = 깃뒤적기(앞, { history: 가짜이력 });
    const 걸림 = Date.now() - 시작;

    const crlf = 적은.get('crlf.txt');
    check('★★★ 되돌릴 앞 모습은 git 이 작업 폴더에 꺼내 준 그대로다 — core.autocrlf 면 CRLF (커밋 안의 LF 가 아니다)',
      Buffer.isBuffer(crlf) && crlf.equals(꺼낸것) && 꺼낸것.includes('\r\n'), JSON.stringify(crlf?.toString()));
    check('★★★ git rm --cached 로 추적만 뗀 파일을 「없던 파일」 로 적지 않는다 — /undo 가 지우면 안 된다',
      Buffer.isBuffer(적은.get('k.txt')) && 적은.get('k.txt').equals(꺼낸케이), JSON.stringify(적은.get('k.txt')?.toString() ?? 적은.get('k.txt')));
    check('★★ 크기 · 수정 시각이 같아도 명령 직전에 고친 파일은 내용을 견준다', 적은.get('d2.txt')?.toString() === '디둘 고치던 중\n', String(적은.get('d2.txt')));
    check('★★ 바뀐 커밋 파일이 많아도 git 을 파일마다 띄우지 않는다 — 120개가 금방이다', 적은.get('많음119.txt')?.equals(꺼낸많음) && 걸림 < 2500,
      `${걸림}ms · ${뒤.뜬것.length}개`);

    // 앞 모습을 git 에서 못 꺼냈다(HEAD 를 못 읽음) — 「원래 없던 자리」 로 적으면 /undo 가 멀쩡한 파일을 지운다.
    const 앞2 = 깃앞보기(r2);
    앞2.머리 = '0'.repeat(40);
    writeFileSync(join(r2, 'm.txt'), '엠 바뀜\n', 'utf8');
    적은.clear();
    const 뒤2 = 깃뒤적기(앞2, { history: 가짜이력 });
    check('★★★ git 에서 앞 모습을 못 꺼내면 「없던 파일」 이 아니라 「못 떴다」 다', !적은.has('m.txt') && 뒤2.못뜬것.some((x) => x.abs.endsWith('m.txt')),
      `적음=${JSON.stringify([...적은.keys()])} 못뜬=${JSON.stringify(뒤2.못뜬것)}`);
    rmSync(r2, { recursive: true, force: true, maxRetries: 3 });
  }

  trace('5-저장소아님');
  {
    const 맨땅 = mkdtempSync(join(tmpdir(), 'deel-gitsnap-plain-'));
    check('★★ 저장소가 아니면 null — 없는 안전망을 있다고 하지 않는다', 깃앞보기(맨땅) === null);
    const h2 = new History(맨땅);
    h2.nextTurn();
    writeFileSync(join(맨땅, '고치기.cjs'), "require('fs').writeFileSync('z.txt','z')", 'utf8');
    const r = await runTool('Bash', { command: 'node 고치기.cjs' }, { ...ctx, scope: makeScope(맨땅), history: h2 });
    check('  저장소가 아니어도 명령은 그대로 돈다', !r.error && existsSync(join(맨땅, 'z.txt')), JSON.stringify(r).slice(0, 160));
    rmSync(맨땅, { recursive: true, force: true, maxRetries: 3 });
  }

  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
}
rmSync(집, { recursive: true, force: true, maxRetries: 3 });

const G = '\x1b[32m'; const R = '\x1b[31m'; const Y = '\x1b[33m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n셸이 바꾼 파일 되돌리기  ${D}(git 저장소 · 명령 앞뒤 git status)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
for (const s of 건너뜀) console.log(`  ${Y}-${X} ${s}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패${건너뜀.length ? ` · ${Y}${건너뜀.length}개 건너뜀${X}` : ''}\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
