// 영어로 켰는데 한국어가 나오나 — **켜서** 본다.
//
// ── 왜 이 검사가 있어야 했나 ────────────────────────────────────────────
//
// `/lang` 은 100% 라고 답했다. 그런데 영어로 켜고 화면을 찍어 보니 한국어가
// 그대로 나오는 줄이 예순두 개였다.
//
//   /help 명령 목록   ESC 중단   Ctrl+C 중단·끝내기
//   첫 판단·medium 생각 중…
//   └ 1개 파일 · 1건 · rg     └ 5줄     └ 1군데 +1 −1
//
// 둘 다 맞는 말이었다. **표에 든 열쇠**는 다 채워져 있었고, 저 글들은 표에
// 들어간 적이 없었다. 세는 자리가 사람이 보는 것을 안 세고 있었던 것이다.
// 옮긴만큼() 은 앞으로도 그것까지는 못 센다 — 없는 열쇠는 셀 수가 없다.
//
// 그래서 소스를 훑지 않고 **진짜로 띄워서 화면을 읽는다.** 조립해서 만드는
// 글은 소스 어디에도 통째로 안 적혀 있어서, 훑는 방식으로는 영영 못 잡는다.
//
// ── 무엇에는 안 붙나 ────────────────────────────────────────────────────
//
// 진짜 모델에는 안 붙는다. 127.0.0.1 의 임시 포트에 우리가 띄운 스텁이고,
// 도구를 부르는 차례만 정해 놓았다. 도구는 진짜 임시 폴더의 파일을 만진다.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const 진입점 = join(here, '..', 'bin', 'deel.js');

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

/*
 * 한글이 나와도 되는 자리.
 *
 * 넉넉히 잡으면 이 검사는 아무것도 안 지킨다. 그래서 **까닭이 있는 것만**
 * 넣고, 왜 봐주는지를 옆에 적는다.
 */
const 봐주는것 = [
  // 언어 이름 자체. 영어 화면에서도 '한국어' 라고 적어야 고를 수 있다.
  /한국어/,
  // 사람이 만든 것 — 폴더 이름, 파일 이름, 사용자가 친 글.
  /leak-work|leak-home/,
];

const 한글있나 = (줄) => /[가-힣]/.test(줄) && !봐주는것.some((무늬) => 무늬.test(줄));

// ── 스텁 게이트웨이 ─────────────────────────────────────────────────────
let 차례 = 0;
const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = req.url.split('?')[0];
    const 보냄 = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url === '/v1/models') return 보냄({ data: [{ id: 'stub-model' }] });
    if (url !== '/v1/chat/completions') { res.writeHead(404); return res.end('{}'); }

    const 답 = (msg, why) => 보냄({
      id: 'x', object: 'chat.completion', model: 'stub-model',
      choices: [{ index: 0, finish_reason: why ?? (msg.tool_calls ? 'tool_calls' : 'stop'), message: msg }],
      usage: { prompt_tokens: 3900, completion_tokens: 180 },
    });
    const 도구 = (name, args) => 답({
      role: 'assistant', content: null,
      tool_calls: [{ id: `c${차례}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    });

    차례 += 1;
    // 도구마다 요약 글을 따로 만든다. 하나만 밟으면 나머지는 안 걸린다.
    if (차례 === 1) return 도구('Grep', { pattern: 'console\\.log', output_mode: 'files_with_matches' });
    if (차례 === 2) return 도구('Glob', { pattern: '**/*.js' });
    if (차례 === 3) return 도구('Read', { file_path: 'src/runner.js' });
    if (차례 === 4) return 도구('Edit', { file_path: 'src/runner.js', old_string: "console.log('a')", new_string: "logger.info('a')" });
    if (차례 === 5) return 도구('Write', { file_path: 'note.txt', content: 'hello\n' });
    if (차례 === 6) return 도구('Append', { file_path: 'note.txt', content: 'more\n' });
    if (차례 === 7) return 도구('Bash', { command: 'echo hi', description: 'say hi' });
    if (차례 === 8) {
      return 도구('TodoWrite', { todos: [
        { content: 'first', status: 'in_progress', activeForm: 'doing first' },
        { content: 'second', status: 'pending', activeForm: 'doing second' },
      ] });
    }
    if (차례 === 9) return 도구('Outline', { file_path: 'src/runner.js' });
    // 실패하는 자리도 밟는다. 오류 글이 제일 잘 빠진다.
    if (차례 === 10) return 도구('Read', { file_path: 'nope-missing.txt' });
    if (차례 === 11) return 도구('Move', { from: 'note.txt', to: 'moved.txt' });
    if (차례 === 12) return 도구('Verify', { text: 'checked the build' });
    return 답({ role: 'assistant', content: 'All done.' });
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

// ── 임시 살림 ───────────────────────────────────────────────────────────
const 방 = mkdtempSync(join(tmpdir(), 'leak-work-'));
const 집 = mkdtempSync(join(tmpdir(), 'leak-home-'));
const 처음글 = "export function run() {\n  console.log('a')\n  return 0\n}\n";
mkdirSync(join(방, 'src'), { recursive: true });
writeFileSync(join(집, 'config.json'), JSON.stringify({
  version: 1, active: 'a', level: '개발자',
  profiles: [{
    id: 'a', name: 'stub', kind: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`,
    auth: 'none', apiKey: '', model: 'stub-model', ctx: 131072, streaming: false, tools: true,
  }],
}, null, 2), 'utf8');

function 띄우기(인자, 입력, env = {}) {
  return new Promise((done) => {
    // FORCE_COLOR 는 **빈 값으로도** 노드가 "NO_COLOR 를 무시한다" 고 경고한다.
    // 그 경고문이 화면에 섞이면 이 검사가 읽는 것이 늘어난다 — 아예 뺀다.
    const 밖 = { ...process.env };
    delete 밖.FORCE_COLOR;
    const kid = spawn(process.execPath, [진입점, ...인자], {
      cwd: 방,
      env: { ...밖, DEEL_HOME: 집, NO_COLOR: '1', COLUMNS: '100', DEEL_NO_OPEN: '1', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = ''; let 마지막 = Date.now(); let 끝 = false;
    kid.stdout.on('data', (b) => { out += b; 마지막 = Date.now(); });
    kid.stderr.on('data', (b) => { out += b; 마지막 = Date.now(); });
    const 시계 = setTimeout(() => kid.kill('SIGKILL'), 90000);
    (async () => {
      for (const 줄 of 입력) {
        for (let i = 0; i < 800 && !끝; i++) {
          if (out.length && Date.now() - 마지막 > 250) break;
          await new Promise((r) => setTimeout(r, 20));
        }
        if (끝) break;
        kid.stdin.write(줄 + '\n');
        마지막 = Date.now();
      }
      if (!끝) kid.stdin.end();
    })();
    kid.on('close', () => { 끝 = true; clearTimeout(시계); done(out); });
  });
}

// ── 화면마다 재기 ───────────────────────────────────────────────────────
const 대본 = [
  ['대화 한 바퀴', ['--no-tui', '--mode', 'auto'], ['unify the logging style', '/exit']],
  ['/tools', ['--no-tui'], ['/tools', '/exit']],
  ['/status', ['--no-tui'], ['/status', '/exit']],
  ['/cost', ['--no-tui'], ['/cost', '/exit']],
  ['/help·/context', ['--no-tui'], ['/help', '/context', '/exit']],
  ['/undo', ['--no-tui', '--mode', 'auto'], ['unify the logging style', '/undo', '/exit']],
];

const 샌것 = new Map();
for (const [이름, 인자, 입력] of 대본) {
  trace(`영어-${이름}`);
  차례 = 0;
  writeFileSync(join(방, 'src', 'runner.js'), 처음글, 'utf8');
  const 글 = await 띄우기(인자, 입력, { DEEL_LANG: 'en' });
  const 줄들 = [...new Set(글.split('\n').map((l) => l.trim()).filter(한글있나))];
  샌것.set(이름, 줄들);
  check(`★ 영어 화면 ${이름} 에 한국어가 없다`, 줄들.length === 0,
    `${줄들.length}줄: ${줄들.slice(0, 3).join(' / ').slice(0, 120)}`);
}

trace('영어다운-영어');

/*
 * ★ 하나일 때 `1 files` 라고 안 쓴다.
 *
 * 한국어는 「1개 파일」 로 끝나서 홑복수를 안 가른다. 그대로 옮기면 영어
 * 화면에 `1 files · 1 hits · 1 lines` 가 뜨는데, 한국어가 안 남았다는 점에서
 * 위 검사는 초록이다. 사람 눈에는 그게 안 옮긴 것만큼이나 대충 만든 것으로
 * 보인다 — 그래서 따로 잰다. (i18n/index.js 의 세말)
 */
{
  const 어색한것 = [];
  // 위에서는 한국어가 든 줄만 남겨 뒀다. 여기서 보는 것은 그 반대라 다시 읽는다.
  차례 = 0;
  writeFileSync(join(방, 'src', 'runner.js'), 처음글, 'utf8');
  const 글 = await 띄우기(['--no-tui', '--mode', 'auto'], ['unify the logging style', '/exit'], { DEEL_LANG: 'en' });
  for (const 줄 of 글.split('\n')) {
    const m = 줄.match(/\b1 (files|hits|lines|spots|places)\b/);
    if (m) 어색한것.push(줄.trim());
  }
  check('★ 하나일 때 복수형을 안 쓴다', 어색한것.length === 0, 어색한것.slice(0, 3).join(' / '));

  /*
   * ★ 가운뎃점이 겹치거나 줄 끝에 남지 않는다.
   *
   * 도구 결과 한 줄은 조각을 ` · ` 로 잇는다. 조건부 조각을 그냥 이어 붙이면
   * 어느 말에서는 `└ 2줄 ·  · utf-8` 이 되거나 줄이 ` ·` 로 끝난다.
   * 안 터지고, 한국어도 안 남아서 이것만 안 재면 영영 안 보인다.
   */
  const 점탈 = 글.split('\n')
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trimEnd())
    .filter((l) => /·\s*·/.test(l) || /·$/.test(l));
  check('★ 가운뎃점이 겹치거나 끝에 남지 않는다', 점탈.length === 0, 점탈.slice(0, 3).join(' / '));
}

trace('화면말과-시킴말은-다른-축');

/*
 * ★ 화면은 영어, 모델에게 주는 글은 한국어.
 *
 * `/tools` 는 **사람이 보는 화면**이라 언어() 를 따라야 한다. 여태 그 자리가
 * 지시말() 만 보는 함수를 안 거치고 원본(한국어)을 그대로 찍고 있었다.
 * 여기서 두 축을 갈라 두지 않으면, 한 축만 보게 되돌려 놔도 검사가 안 잡는다
 * — DEEL_LANG=en 만 주면 지시말도 따라서 en 이 되기 때문이다.
 */
{
  const 글 = await 띄우기(['--no-tui'], ['/tools', '/exit'], { DEEL_LANG: 'en', DEEL_PROMPT_LANG: 'ko' });
  const 도구줄 = 글.split('\n').filter((l) => /^\s*(Read|Write|Edit|Grep|Bash)\s/.test(l.replace(/\x1b\[[0-9;]*m/g, '')));
  check('★ 시킴말이 한국어여도 /tools 화면은 영어다',
    도구줄.length >= 3 && !도구줄.some((l) => /[가-힣]/.test(l)),
    `${도구줄.length}줄 · ${도구줄[0]?.trim().slice(0, 60) ?? ''}`);
}

trace('한국어는-그대로');

/*
 * 반대쪽 — 한국어로 켜면 한국어가 나와야 한다.
 *
 * 옮기다 보면 영어를 못 박아 버리기 쉽다. 그러면 이 검사만 초록이 되고
 * 정작 쓰는 사람 화면이 영어가 된다. 그게 지금 상태보다 나쁘다.
 */
{
  차례 = 0;
  writeFileSync(join(방, 'src', 'runner.js'), 처음글, 'utf8');
  const 글 = await 띄우기(['--no-tui', '--mode', 'auto'], ['로그 형식을 통일해줘', '/exit'], { DEEL_LANG: 'ko' });
  check('★ 한국어로 켜면 한국어가 나온다', /[가-힣]/.test(글), 글.slice(0, 80));
  // 도구 결과 한 줄이 한국어인지를 콕 집어 본다. 화면 어딘가에 한글이
  // 있다는 것만으로는 그 자리가 옮겨졌는지 알 수 없다.
  check('★ 도구 결과 한 줄도 한국어다', /줄|군데|건|개/.test(글),
    (글.match(/└[^\n]*/g) ?? []).slice(0, 2).join(' / '));
}

trace('셈이-사람이-보는-것을-센다');

/*
 * `/lang` 이 말하는 비율이 화면과 안 어긋나나.
 *
 * 여기서 지키는 것은 숫자가 아니라 **말버릇**이다. 100% 라고 못 박아 놓고
 * 화면에 한국어가 나오면 그건 거짓말이다. 위 검사가 초록인 한 100% 는
 * 참말이고, 빨개지면 위에서 먼저 걸린다.
 */
{
  const 글 = await 띄우기(['--no-tui'], ['/lang', '/exit'], { DEEL_LANG: 'en' });
  const 민 = 글.replace(/\x1b\[[0-9;]*m/g, '');
  check('/lang 이 얼마나 옮겨졌는지 말해 준다', /%|\d+\s*\/\s*\d+/.test(민), 민.slice(0, 120));
}

srv.close();
rmSync(방, { recursive: true, force: true });
rmSync(집, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n영어 화면에 한국어가 남았나  ${D}(켜서 읽는다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
if (fail.length) {
  console.log(`\n  ${D}── 샌 줄 전부 ──${X}`);
  for (const [이름, 줄들] of 샌것) {
    if (!줄들.length) continue;
    console.log(`  ${D}${이름} (${줄들.length})${X}`);
    for (const 줄 of 줄들) console.log(`    ${D}${줄.slice(0, 100)}${X}`);
  }
}
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
