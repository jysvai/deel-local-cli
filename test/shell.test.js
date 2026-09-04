// 명령이 어느 셸에서 도는가 — 그리고 모델이 그걸 아는가.
//
// ── 왜 이걸 재나 ────────────────────────────────────────────────────────
//
// 윈도우에서 Bash 도구는 cmd.exe 였고, 프롬프트는 그 말을 한 번도 안 했다. 모델은
// ls · cat · grep 을 쳤고 하나마다 실패 한 번 — 로컬 모델이면 20~40초 — 를 치렀다.
// 개발자 PC 에는 대개 Git for Windows 가 있고, 그 bash 는 모델이 아는 셸이다.
//
// 여기서 재는 것:
//   1) 고르는 규칙 — Git Bash 가 있으면 bash, System32 의 bash.exe(WSL)는 건너뛰고,
//      DEEL_SHELL · 설정이 이기고, 모르는 값이면 auto 로 가되 말해 준다
//   2) 이 PC 에서 실제로 돈다 — bash 에서 ls·printf·cat, cmd 에서 %COMSPEC%, 파워셸에서 $PSVersionTable
//   3) Bash 도구와 Jobs 가 같은 답을 본다 (한 군데서만 정한다)
//   4) 프롬프트에 Shell: 줄이 딱 하나, 모드보다 앞(굳은 앞머리)에 있다
//   5) /status 에 셸 줄이 나온다
//   6) bash 에서 mv 를 해도 되돌리기 스냅샷이 뜬다
//   7) /c/Users/… 꼴 경로가 범위 안이면 통과하고, rm -rf /c 는 막힌다
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 셸고르기, 배시후보, 셸정하기, 정한셸, 셸명령, 셸안내, 셸지우기 } from '../src/tools/shell.js';
import { 셸명령 as 일감셸명령, 띄우기, 끝내기 } from '../src/tools/jobs.js';
import { TOOLS } from '../src/tools/index.js';
import { makeScope, checkCommand, MSYS풀기 } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { Session } from '../src/agent/session.js';
import { handle } from '../src/commands.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const here = dirname(fileURLToPath(import.meta.url));

// ── 1. 고르는 규칙 (순수 함수 — env · platform · exists 를 바꿔 끼운다) ────
trace('1-고르기');
{
  const 윈 = 'win32';
  const 있음 = (...p) => (x) => p.includes(x);
  const envA = { ProgramFiles: 'C:\\PF', PATH: 'C:\\Windows\\System32;C:\\tools', COMSPEC: 'C:\\Windows\\System32\\cmd.exe' };

  const s = 셸고르기({ env: envA, platform: 윈, exists: 있음('C:\\PF\\Git\\bin\\bash.exe') });
  check('Git Bash 가 있으면 bash', s.id === 'bash' && s.file === 'C:\\PF\\Git\\bin\\bash.exe', s.file);
  check('bash 는 -c 로 넘긴다', s.명령('ls -la').join('|') === '-c|ls -la' && s.verbatim === false);

  const s2 = 셸고르기({ env: envA, platform: 윈, exists: 있음('C:\\Windows\\System32\\bash.exe') });
  check('System32 의 bash.exe(WSL) 만 있으면 건너뛰고 cmd', s2.id === 'cmd' && /cmd\.exe$/i.test(s2.file), s2.file);
  check('cmd 는 따옴표째 넘긴다(verbatim) — 따옴표 든 명령이 뭉개지지 않게',
    s2.verbatim === true && s2.명령('node -e "1"').at(-1) === '"node -e "1""' && s2.명령('x').slice(0, 3).join(' ') === '/d /s /c');
  check('후보에 System32 가 없다', !배시후보(envA, 윈).some((p) => /system32/i.test(p)), 배시후보(envA, 윈).join(' · '));

  const s3 = 셸고르기({ env: envA, platform: 윈, exists: 있음('C:\\tools\\bash.exe') });
  check('PATH 의 bash.exe 도 찾는다', s3.id === 'bash' && s3.file === 'C:\\tools\\bash.exe', s3.file);
  const s3b = 셸고르기({ env: { ...envA, ProgramFiles: '', LOCALAPPDATA: 'C:\\U\\me\\AppData\\Local', PATH: '' }, platform: 윈, exists: 있음('C:\\U\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe') });
  check('사용자 폴더에 깐 Git 도 찾는다', s3b.id === 'bash', s3b.file);

  const s4 = 셸고르기({ env: { ...envA, DEEL_SHELL: 'cmd' }, platform: 윈, exists: 있음('C:\\PF\\Git\\bin\\bash.exe') });
  check('DEEL_SHELL=cmd 가 이긴다', s4.id === 'cmd');
  const s5 = 셸고르기({ env: { ...envA, DEEL_SHELL: 'PowerShell' }, platform: 윈, exists: () => true });
  check('powershell 은 시켜야만 (대소문자 무관)', s5.id === 'powershell' && s5.명령('$x').at(-1) === '$x' && s5.명령('$x').includes('-NoProfile'));
  const s6 = 셸고르기({ env: { ...envA, DEEL_SHELL: '이상한값' }, platform: 윈, exists: 있음('C:\\PF\\Git\\bin\\bash.exe') });
  check('모르는 값이면 auto 로 가고 말해 준다', s6.id === 'bash' && /이상한값/.test(s6.경고 ?? ''), s6.경고);
  const s7 = 셸고르기({ env: envA, platform: 윈, config: { shell: 'cmd' }, exists: 있음('C:\\PF\\Git\\bin\\bash.exe') });
  check('설정 파일의 shell 도 본다', s7.id === 'cmd');
  const s8 = 셸고르기({ env: { ...envA, DEEL_SHELL: 'bash' }, platform: 윈, config: { shell: 'cmd' }, exists: 있음('C:\\PF\\Git\\bin\\bash.exe') });
  check('환경변수가 설정을 이긴다', s8.id === 'bash');
  const s9 = 셸고르기({ env: { ...envA, DEEL_SHELL: 'bash' }, platform: 윈, exists: () => false });
  check('bash 를 시켰는데 없으면 cmd 로 가고 말해 준다', s9.id === 'cmd' && /못 찾았습니다/.test(s9.경고 ?? ''), s9.경고);
  const s10 = 셸고르기({ env: envA, platform: 'linux', exists: () => true });
  check('윈도우가 아니면 /bin/sh', s10.id === 'sh' && s10.file === '/bin/sh' && s10.명령('ls').join('|') === '-c|ls');
  const s11 = 셸고르기({ env: { ...envA, DEEL_SHELL: '' }, platform: 윈, exists: 있음('C:\\PF\\Git\\bin\\bash.exe') });
  check('빈 DEEL_SHELL 은 안 정한 것과 같다', s11.id === 'bash' && !s11.경고, s11.경고 ?? '');

  // 모델에게 주는 한 줄.
  for (const [이름, 셸] of [['bash', s], ['cmd', s2], ['powershell', s5], ['sh', s10]]) {
    const ko = 셸안내(false, 셸);
    const en = 셸안내(true, 셸);
    check(`${이름}: 안내문에 Shell: 이 딱 한 번 (ko · en)`, (ko.match(/Shell:/g) ?? []).length === 1 && (en.match(/Shell:/g) ?? []).length === 1);
    check(`${이름}: 한 줄이다`, ko.trim().split('\n').length === 1 && en.trim().split('\n').length === 1);
  }
  check('cmd 안내는 ls 가 없다고 하고 dir 를 알려 준다', /ls/.test(셸안내(false, s2)) && /dir/.test(셸안내(false, s2)) && /no ls/.test(셸안내(true, s2)));
  check('bash 안내는 유닉스 명령이 된다고 한다', /ls/.test(셸안내(false, s)) && /Git for Windows/.test(셸안내(true, s)));
  check('파워셸 안내는 && 가 없다고 한다', /&&/.test(셸안내(false, s5)) && /&&/.test(셸안내(true, s5)));
}

// ── 준비: 실제 도구를 돌릴 자리 ──────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'deel-shell-'));
const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
const 윈도우 = process.platform === 'win32';
// 자식 node 가 FORCE_COLOR 를 물려받으면 숫자에 색을 입힌다(run.mjs 가 그렇게 띄운다). 색은 벗기고 본다.
const 맨글 = (r) => String(r.content ?? '').replace(/\x1b\[[0-9;]*m/g, '');
const 결과글 = (r) => (r.error ?? 맨글(r)).replace(/\s+/g, ' ').slice(0, 100);

// ── 2. 이 PC 에서 실제로 돈다 ────────────────────────────────────────────
trace('2-실제');
if (윈도우) {
  const 고른것 = 셸정하기({ env: { ...process.env, DEEL_SHELL: 'auto' } });
  if (고른것.id === 'bash') {
    writeFileSync(join(root, 'a.txt'), '하나\n', 'utf8');
    const r = await TOOLS.Bash.run({ command: 'ls a.txt && printf "%s\\n" "$0" && cat a.txt' }, ctx);
    check('Git Bash 에서 ls · printf · cat 이 된다', !r.error && !r.failed && /a\.txt/.test(맨글(r)) && /하나/.test(맨글(r)), 결과글(r));
    check('$0 이 bash 다', /bash/.test(맨글(r)), 결과글(r));
    const r2 = await TOOLS.Bash.run({ command: 'node -e "console.log(1+1)"' }, ctx);
    check('따옴표 든 명령도 그대로 (node -e)', !r2.failed && /^2\b/m.test(맨글(r2)), 결과글(r2));
    const r3 = await TOOLS.Bash.run({ command: 'echo 한글 출력' }, ctx);
    check('한글이 안 깨진다', /한글 출력/.test(맨글(r3)), 결과글(r3));
  } else {
    check('이 PC 에 Git Bash 가 없어 bash 검사를 건넌다 ⚠', true, 고른것.표시);
  }

  셸정하기({ env: { ...process.env, DEEL_SHELL: 'cmd' } });
  const c1 = await TOOLS.Bash.run({ command: 'echo %COMSPEC%' }, ctx);
  check('DEEL_SHELL=cmd 면 cmd 에서 돈다', !c1.error && /cmd\.exe/i.test(맨글(c1)), 결과글(c1));
  const c2 = await TOOLS.Bash.run({ command: 'node -e "console.log(1+2)"' }, ctx);
  check('cmd 에서도 따옴표 든 명령이 그대로 (회귀)', !c2.failed && /^3\b/m.test(맨글(c2)), 결과글(c2));

  셸정하기({ env: { ...process.env, DEEL_SHELL: 'powershell' } });
  const p1 = await TOOLS.Bash.run({ command: '$PSVersionTable.PSVersion.Major', timeout: 60000 }, ctx);
  if (p1.error && /ENOENT|not found|찾을 수/i.test(p1.error)) check('이 PC 에 powershell 이 없어 건넌다 ⚠', true, p1.error);
  else check('powershell 을 시키면 파워셸에서 돈다', !p1.failed && /^\s*\d+/.test(맨글(p1)), 결과글(p1));
  셸지우기();
} else {
  check('윈도우가 아니라 실제 셸 검사를 건넌다 ⚠ (/bin/sh 그대로)', 정한셸().id === 'sh', 정한셸().표시);
  const r = await TOOLS.Bash.run({ command: 'printf "%s" "$0"' }, ctx);
  check('/bin/sh 에서 돈다', !r.failed, 결과글(r));
}

trace('2b-열쇠안물려줌');

/*
 * ── 자식 셸이 게이트웨이 열쇠를 물려받고 있었다 ─────────────────────────
 *
 * MCP 서버에는 환경을 통째로 씻어서 넘긴다(backend/mcp.js 깨끗한환경).
 * 그런데 Bash 와 Jobs 는 아무것도 안 주고 있었고, 그러면 Node 가 우리 환경을
 * **통째로** 물려준다. 그래서 `env` 한 줄이면 DEEL_API_KEY 가 화면에 찍히고,
 * 그 화면이 대화에 실려 게이트웨이로 나가고 `.deel/sessions/*.jsonl` 로
 * 디스크에도 남는다 — 열쇠를 그 열쇠의 주인에게 보내는 셈이다.
 *
 * 그렇다고 통째로 씻으면 안 된다. Bash 로 도는 것은 **사용자 제 프로젝트**라,
 * PATH·NODE_ENV·DEEL_HOME 이 다 있어야 한다. 그래서 딱 하나만 뺀다 —
 * 이 검사는 **두 방향**으로 잰다.
 */
{
  const 옛열쇠 = process.env.DEEL_API_KEY;
  const 옛프로필열쇠 = process.env.DEEL_KEY_검사프로필;
  const 옛집 = process.env.DEEL_HOME;
  process.env.DEEL_API_KEY = 'sk-가짜검사용-0123456789abcdef';
  /*
   * 열쇠 이름은 **둘**이다 (config.js 의 resolveKey).
   *
   * 이 검사가 `DEEL_API_KEY` 하나만 심어 놓고 「자식은 열쇠를 못 본다」 를
   * 재고 있었다. 실제로 재고 있던 것은 「자식은 그 **이름**의 변수를 못
   * 본다」 였고, `DEEL_KEY_<프로필>` 은 그대로 샜다 — 그리고 그 방법을
   * 우리 사내 심사 명세(pack/sbom.js)가 권장으로 적어 뒀다.
   *
   * 이름 하나를 못 박으면 이름이 하나 늘 때마다 또 샌다. 그래서 **열쇠꼴
   * 값이 하나도 안 보인다**를 잰다.
   */
  process.env.DEEL_KEY_검사프로필 = 'sk-프로필열쇠-fedcba9876543210';
  process.env.DEEL_HOME ??= root;          // 홀로 돌릴 때도 잴 것이 있어야 한다
  const 물음 = (이름) => `node -e "console.log(process.env.${이름} ?? 'none')"`;
  try {
    const k = await TOOLS.Bash.run({ command: 물음('DEEL_API_KEY') }, ctx);
    check('★ Bash 자식은 게이트웨이 열쇠를 못 본다',
      /(^|\n)\s*none\s*(\n|$)/.test(맨글(k)) && !맨글(k).includes('sk-가짜검사용'), 결과글(k));

    const k2 = await TOOLS.Bash.run({ command: 물음('DEEL_KEY_검사프로필') }, ctx);
    check('★★ 프로필 열쇠(DEEL_KEY_*)도 자식이 못 본다',
      /(^|\n)\s*none\s*(\n|$)/.test(맨글(k2)) && !맨글(k2).includes('sk-프로필열쇠'), 결과글(k2));

    /*
     * 이름을 하나씩 묻는 것으로는 모자란다. `env` 한 줄이 전부를 뱉는데,
     * 실제로 새는 길이 그것이다. 그래서 통째로 뱉게 하고 **열쇠꼴 값이
     * 하나도 없다**를 잰다 — 이름이 늘어도 이 줄은 안 낡는다.
     */
    const 전부 = await TOOLS.Bash.run(
      { command: `node -e "for (const [k,v] of Object.entries(process.env)) console.log(k+'='+v)"` }, ctx);
    const 다뱉은것 = 맨글(전부);
    check('★★ env 통째로 뱉어도 열쇠 값이 하나도 없다',
      !/sk-가짜검사용|sk-프로필열쇠/.test(다뱉은것),
      (다뱉은것.match(/DEEL_[A-Z가-힣_]*=.*/g) ?? []).join(' | ').slice(0, 120));

    const h = await TOOLS.Bash.run({ command: 물음('DEEL_HOME') }, ctx);
    check('★ 나머지 환경은 그대로 물려준다 (사용자가 이 셸로 제 검사를 돌린다)',
      !/(^|\n)\s*none\s*(\n|$)/.test(맨글(h)), 결과글(h));

    // Jobs 도 같은 자리다. 한쪽만 고치면 뒤에서 도는 명령으로 그대로 샌다.
    const j = await 띄우기(물음('DEEL_API_KEY'), { cwd: root, 기다림: 4000 });
    const 일감글 = String(j.출력 ?? '').replace(/\x1b\[[0-9;]*m/g, '');
    check('★ Jobs 로 뒤에서 도는 것도 열쇠를 못 본다',
      !일감글.includes('sk-가짜검사용'), 일감글.replace(/\s+/g, ' ').slice(0, 100));
    if (j.떴나) await 끝내기(j.번호);   // 살아 있으면 거둔다 — 검사가 자식을 남기면 안 된다
  } finally {
    if (옛열쇠 == null) delete process.env.DEEL_API_KEY; else process.env.DEEL_API_KEY = 옛열쇠;
    if (옛프로필열쇠 == null) delete process.env.DEEL_KEY_검사프로필; else process.env.DEEL_KEY_검사프로필 = 옛프로필열쇠;
    if (옛집 == null) delete process.env.DEEL_HOME; else process.env.DEEL_HOME = 옛집;
  }
}

// ── 3. Bash 도구와 Jobs 가 같은 답을 본다 ───────────────────────────────
trace('3-한군데');
{
  const a = 셸명령('echo x');
  const b = 일감셸명령('echo x');
  check('Jobs 도 같은 셸이다', a.file === b.file && a.id === b.id && JSON.stringify(a.args) === JSON.stringify(b.args), `${a.file} vs ${b.file}`);
  const 도구소스 = readFileSync(join(here, '..', 'src', 'tools', 'index.js'), 'utf8');
  const 일감소스 = readFileSync(join(here, '..', 'src', 'tools', 'jobs.js'), 'utf8');
  check('셸을 정하는 코드는 shell.js 한 군데뿐이다 (COMSPEC 이 다른 데 없다)', !/COMSPEC/.test(도구소스) && !/COMSPEC/.test(일감소스));
}

// ── 4. 프롬프트 — Shell: 줄이 하나, 모드보다 앞 ─────────────────────────
trace('4-프롬프트');
{
  const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', model: 'm', ctx: 32768, streaming: true, tools: true, json: true, think: false };
  const s = new Session(conn, { root, work: 'code' });
  const 글 = s.systemPrompt();
  const 자리 = (t) => 글.indexOf(t);
  check('Shell: 줄이 딱 하나', (글.match(/^Shell: /gm) ?? []).length === 1, String((글.match(/Shell: /g) ?? []).length));
  check('작업 폴더 다음, 모드보다 앞 — 굳은 앞머리에 있다', 자리('작업 폴더:') < 자리('Shell: ') && 자리('Shell: ') < 자리('--- 지금 모드'), `${자리('작업 폴더:')} < ${자리('Shell: ')} < ${자리('--- 지금 모드')}`);
  check('지금 고른 셸과 같은 말이다', 글.includes(셸안내(false).trim()));
  s.work = 'debug';
  check('모드를 바꿔도 그 줄은 그대로 (캐시가 안 깨진다)', s.systemPrompt().indexOf('Shell: ') === 자리('Shell: '));
}

// ── 5. /status 에 셸 줄 ──────────────────────────────────────────────────
trace('5-status');
{
  const conn = { kind: 'openai', base: 'http://127.0.0.1:1/v1', model: 'm', ctx: 32768, streaming: true, tools: true, json: true, think: false };
  const s = new Session(conn, { root });
  let 잡힌 = '';
  const 원래 = process.stdout.write;
  process.stdout.write = (chunk) => { 잡힌 += String(chunk); return true; };
  try { await handle('/status', s, ctx); } finally { process.stdout.write = 원래; }
  const 줄 = 잡힌.replace(/\x1b\[[0-9;]*m/g, '').split('\n').find((l) => /^\s*셸\s/.test(l)) ?? '';
  check('/status 에 셸 줄이 있다', !!줄, 잡힌.replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(0, 6).join(' | '));
  check('그 줄에 지금 셸이 적혀 있다', 줄.includes(정한셸().표시), 줄.trim());
}

// ── 6. bash 에서 mv 를 해도 되돌리기 스냅샷이 뜬다 ───────────────────────
trace('6-되돌리기');
if (윈도우 && 정한셸().id === 'bash') {
  ctx.history.nextTurn();
  writeFileSync(join(root, 'old.txt'), '옛것\n', 'utf8');
  const r = await TOOLS.Bash.run({ command: 'mv old.txt new.txt' }, ctx);
  check('mv 가 돈다', !r.failed && existsSync(join(root, 'new.txt')) && !existsSync(join(root, 'old.txt')), 결과글(r));
  check('옮기기 전 것을 떠 뒀다', (r.되돌릴것 ?? []).includes('old.txt'), JSON.stringify(r.되돌릴것));
  ctx.history.undo(1);
  check('되돌리면 원래 자리가 돌아온다', existsSync(join(root, 'old.txt')) && readFileSync(join(root, 'old.txt'), 'utf8') === '옛것\n');
} else {
  check('bash 가 아니라 mv 되돌리기 검사를 건넌다 ⚠', true, 정한셸().표시);
}

// ── 7. /c/… 경로와 rm -rf /c ─────────────────────────────────────────────
trace('7-경로');
{
  if (윈도우) {
    const msys = root.replace(/^([A-Za-z]):/, (m, d) => `/${d.toLowerCase()}`).replace(/\\/g, '/');
    check('/c/Users/… 를 C:\\Users\\… 로 푼다', /^[A-Z]:\//.test(MSYS풀기(msys)), MSYS풀기(msys));
    let 안 = null;
    try { 안 = ctx.scope.resolve(`${msys}/a.txt`); } catch (e) { 안 = e; }
    check('범위 안의 /c/… 경로는 통과한다', typeof 안 === 'string' && 안.toLowerCase() === join(root, 'a.txt').toLowerCase(), String(안?.message ?? 안));
    let 밖 = null;
    try { ctx.scope.resolve('/c/Windows/System32/drivers/etc/hosts'); } catch (e) { 밖 = e; }
    check('범위 밖의 /c/… 경로는 막힌다', !!밖 && /범위 밖/.test(밖.message), 밖?.message?.split('\n')[0]);
  } else {
    check('윈도우가 아니면 /c/… 는 그냥 경로다', MSYS풀기('/c/x') === '/c/x');
  }
  const 막히나 = (cmd) => { try { checkCommand(cmd); return null; } catch (e) { return e.message; } };
  check('rm -rf /c 는 막힌다', /뿌리/.test(막히나('rm -rf /c') ?? ''), 막히나('rm -rf /c'));
  check('rm -rf /c/ 도 막힌다', /뿌리/.test(막히나('rm -rf /c/') ?? ''));
  check('rm -rf / 는 여전히 막힌다', /뿌리/.test(막히나('rm -rf /') ?? ''));
  check('rm -rf /c/proj/tmp 는 명령 검사에서는 통과 (범위 검사가 따로 본다)', 막히나('rm -rf /c/proj/tmp') === null, 막히나('rm -rf /c/proj/tmp'));
}

// ── 결과 ────────────────────────────────────────────────────────────────
const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n셸 고르기 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? D + '  ' + p.note + X : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
셸지우기();
rmSync(root, { recursive: true, force: true });
process.exitCode = fail.length ? 1 : 0;
