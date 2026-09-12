// 바깥으로 나가도 되는지 **사람에게** 묻는가.
//
// ── 왜 이 파일이 생겼나 ─────────────────────────────────────────────────
//
// 이 프로그램이 파는 말은 하나다 — 「모르고 나가는 것을 없앤다」. 그 말을
// 지키는 코드는 repl.js 의 물음 한 자리뿐인데, 그 자리에 검사가 없었다.
// 그래서 이런 판이 아무도 모르게 지나갔다:
//
//   echo "이 폴더 요약해줘" | deel
//     ↗ 이 연결은 이 컴퓨터 밖으로 나갑니다.
//        보낼 곳 api.example.invalid
//     › 나가도 될까요? ⏎ 허락하고 기억 · n 그만 [y] 이 폴더 요약해줘
//     허락을 적어 뒀습니다 — 이 프로필은 다음부터 안 묻습니다.
//
// 사람은 한 글자도 답하지 않았다. 셋이 한꺼번에 일어난다.
//   1. 시킨 말이 **답으로 먹혔다** — 그래서 모델에게 가지도 않았다
//   2. `online: true` 가 설정 파일에 **영구 저장**됐다 — 다음부터 안 묻는다
//   3. 빈 파이프여도 같다 — 입력 끝(EOF)이 기본값 'y' 로 잡혔다
//
// 여기서 재는 것은 화면 문구가 아니라 **설정 파일에 무엇이 남았는가**다.
// 화면은 고칠 수 있지만 저 파일에 박힌 허락은 다음 판을 바꾼다.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 벗기기 = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

const 여기 = dirname(fileURLToPath(import.meta.url));
const 뿌리 = join(여기, '..');

/*
 * 진짜로 안 나가는 바깥 주소.
 *
 * `.invalid` 는 RFC 2606 이 못 박아 둔 이름이라 어디서도 안 풀린다. 그러면서
 * `바깥인가()` 에는 바깥으로 읽힌다 — 물음이 뜨는 자리를 밟으면서 실제로는
 * 한 바이트도 안 나간다. 127.0.0.1 로는 이 자리를 못 밟는다(로컬은 안 묻는다).
 */
const 바깥주소 = 'https://api.example.invalid/v1';

trace('1-띄우기');

/** deel 을 파이프로 띄우고, 끝난 뒤 화면과 설정 파일을 함께 돌려준다. */
async function 띄우기(넣을말, { 허락해둘까 = false, 더줄인자 = [], 터미널인척 = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'deel-out-'));
  const home = mkdtempSync(join(tmpdir(), 'deel-out-home-'));
  const 설정자리 = join(home, 'config.json');
  writeFileSync(설정자리, JSON.stringify({
    version: 1,
    active: '바깥',
    level: '개발자',
    profiles: [{
      id: '바깥', name: '바깥 게이트웨이', kind: 'openai', baseUrl: 바깥주소,
      auth: 'none', apiKey: '', model: '가짜모델', ctx: 8192, streaming: false, tools: true,
      ...(허락해둘까 ? { online: true } : {}),
    }],
  }), 'utf8');

  /*
   * 터미널인 척할 수도 있어야 한다.
   *
   * 파이프 관문이 앞에서 걸리면 그 뒤의 자리들을 영영 못 밟는다 — Ctrl+D
   * (입력 끝)가 딱 그 자리다. tty-preload 는 isTTY 만 거짓말하고 출력은
   * 그대로 파이프라, 물음이 실제로 뜨는 길을 지나면서 화면은 읽을 수 있다.
   */
  const 앞선것 = join(뿌리, 'test', 'tty-preload.mjs').replace(/\\/g, '/');
  const kid = spawn(process.execPath,
    [...(터미널인척 ? ['--import', `file:///${앞선것}`] : []),
      join(뿌리, 'bin', 'deel.js'), '--root', root, '--no-tui', ...더줄인자],
    { cwd: 뿌리, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, DEEL_HOME: home } });

  let out = '';
  kid.stdout.setEncoding('utf8');
  kid.stderr.setEncoding('utf8');
  kid.stdout.on('data', (b) => { out += b; });
  kid.stderr.on('data', (b) => { out += b; });

  if (넣을말 !== null) kid.stdin.write(넣을말);
  kid.stdin.end();

  // 안 끝나면 검사가 통째로 멈춘다. 못 끝냈다는 것도 결과다.
  const 끝났나 = await Promise.race([
    new Promise((r) => kid.on('close', () => r(true))),
    new Promise((r) => setTimeout(() => r(false), 20000)),
  ]);
  if (!끝났나) kid.kill('SIGKILL');

  let 설정 = null;
  try { 설정 = JSON.parse(readFileSync(설정자리, 'utf8')); } catch { /* 못 읽으면 null */ }
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  return { 글: 벗기기(out), 설정, 끝났나 };
}

trace('2-파이프로-한마디');

// ── 파이프로 넣은 시킨 말이 「나가도 될까요?」 의 답이 되면 안 된다 ─────────
{
  const r = await 띄우기('이 폴더 요약해줘\n');
  const prof = r.설정?.profiles?.[0] ?? {};

  check('끝나기는 한다 (물음 앞에서 안 멈춘다)', r.끝났나 === true, '');
  check('★★ 파이프로 온 말을 허락으로 안 읽는다', prof.online === undefined,
    `online=${JSON.stringify(prof.online)}`);
  check('★★ 허락을 적어 뒀다고 안 한다', !/허락을 적어 뒀습니다/.test(r.글),
    r.글.split('\n').filter((l) => /허락/.test(l)).join(' | ').slice(0, 120));
  check('★ 왜 안 물었는지 말한다', /파이프로 들어와 있어/.test(r.글),
    r.글.split('\n').filter((l) => /파이프/.test(l)).join(' | ').slice(0, 120));
  check('★ 나가는 길을 알려 준다', /--online/.test(r.글), '');
  check('어디로 나갈 뻔했는지는 보여 준다', /api\.example\.invalid/.test(r.글), '');

  /*
   * 컨텍스트 길이를 **허락 전에** 두드리던 자리도 여기서 같이 잡힌다.
   *
   * 문지기가 막아 놓고 화면에는 「서버가 안 알려줍니다」 를 찍었다. 바깥
   * 프로필을 처음 붙이는 사람이 보는 첫 문장이 그것이었고, 서버는 그 물음을
   * 받아 본 적도 없다.
   */
  check('★ 서버 탓으로 안 돌린다', !/서버가 안 알려줍니다/.test(r.글),
    r.글.split('\n').filter((l) => /안 알려/.test(l)).join(' | ').slice(0, 120));
}

trace('3-빈-파이프');

// ── 아무것도 안 넣어도(EOF) 허락이 되면 안 된다 ─────────────────────────
//
// 여기가 `def: 'y'` 가 물던 자리다. 입력이 끝난 것과 사람이 Enter 를 친 것을
// 안 가르면, 빈 파이프 하나로 바깥 연결이 열린다.
{
  const r = await 띄우기('');
  const prof = r.설정?.profiles?.[0] ?? {};
  check('끝난다', r.끝났나 === true, '');
  check('★★ 빈 파이프도 허락이 아니다', prof.online === undefined,
    `online=${JSON.stringify(prof.online)}`);
  check('★ 안 나갔다고 말한다', /나가지 않았습니다/.test(r.글),
    r.글.split('\n').filter((l) => /나가지/.test(l)).join(' | ').slice(0, 120));
}

trace('4-이미-허락한-프로필');

// ── 이미 허락해 둔 프로필은 안 묻는다. 막느라 쓰던 길을 끊으면 안 된다 ─────
{
  const r = await 띄우기('', { 허락해둘까: true });
  const prof = r.설정?.profiles?.[0] ?? {};
  check('끝난다', r.끝났나 === true, '');
  check('★ 허락해 둔 프로필에는 파이프 얘기를 안 한다', !/파이프로 들어와 있어/.test(r.글), '');
  check('허락은 그대로 남아 있다', prof.online === true, `online=${JSON.stringify(prof.online)}`);
}

trace('4b-터미널에서-Ctrl+D');

// ── 손으로 켠 판에서 Ctrl+D 를 눌러도 허락이 되면 안 된다 ────────────────
//
// 위 절들은 파이프 관문(`!process.stdin.isTTY`)에서 먼저 걸린다. 그 관문
// **뒤**에도 같은 함정이 하나 더 있다 — repl 의 ask() 는 입력이 끝나면
//
//   if (a === null) return o.def ?? '';
//
// 로 물러났고, 이 물음의 def 는 'y' 다. 터미널 앞에 앉은 사람이 Ctrl+D 를
// 눌러 나가려 한 것이 **허락**으로 읽히고, 그 허락은 설정 파일에 박힌다.
// 그래서 여기서는 터미널인 척하고 아무것도 안 친 채 입력을 닫는다.
{
  const r = await 띄우기('', { 터미널인척: true });
  const prof = r.설정?.profiles?.[0] ?? {};
  check('끝난다', r.끝났나 === true, '');
  check('★ 물음까지는 간다 (관문에서 안 걸린다)', /나가도 될까요/.test(r.글),
    r.글.split('\n').filter((l) => /나가도/.test(l)).join(' | ').slice(0, 90));
  check('★★ 입력 끝을 허락으로 안 읽는다', prof.online === undefined,
    `online=${JSON.stringify(prof.online)}`);
  check('★ 허락을 적어 뒀다고 안 한다', !/허락을 적어 뒀습니다/.test(r.글),
    r.글.split('\n').filter((l) => /허락/.test(l)).join(' | ').slice(0, 120));
}

trace('4c-못-물어본-판에서-옛-값을-쓴다고-말한다');

// ── 프로필에 값이 있으면 **아무 말도 안 하던** 자리 ──────────────────────
//
// repl 의 그 블록은 스스로 「켤 때마다 서버에 물어본다. 저장된 값을 그대로
// 믿지 않는다」 고 적어 두었다. 그런데 못 물어본 판에서는 그 약속이 그냥
// 거짓이 된다 — 머리말에는 저장된 숫자가 **방금 서버에서 확인한 값**처럼
// 뜬다. 서버에서 창을 줄여 놨어도 알 길이 없다.
//
// 여기서는 허락이 이미 있는(online: true) 바깥 프로필로 켠다. 주소가
// 안 풀리므로 두드린 자리에서 아무 대답도 못 받는다 — 딱 그 판이다.
{
  const r = await 띄우기('', { 허락해둘까: true });
  check('★★ 못 물어봤다고 말한다', /못 물어봤습니다/.test(r.글),
    r.글.split('\n').filter((l) => /컨텍스트/.test(l)).join(' | ').slice(0, 140));
  check('★ 그래서 무슨 값을 쓰는지 적는다', /프로필에 적힌 8,192 을 그대로 씁니다/.test(r.글),
    r.글.split('\n').filter((l) => /프로필에 적힌/.test(l)).join(' | ').slice(0, 140));
  check('★ 고치는 길을 알려 준다', /\/ctx auto/.test(r.글), '');
  check('서버 탓으로 안 돌린다', !/서버가 안 알려줍니다/.test(r.글), '');
}

trace('5-끝');

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n바깥 허락 검사  ${D}(사람이 답하지 않았는데 나가지는 않는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
