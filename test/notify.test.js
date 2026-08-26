// 끝났을 때 알리기 — 종소리와 창 제목.
//
// 여기서 제일 무서운 것은 소리가 안 나는 것이 아니라, **파이프에 소리를
// 흘려서 연결을 끊는 것**이다. ACP(에디터 안에서 쓰기)와 `deel run` 은
// stdout 이 파이프고, 거기에 \x07 한 글자가 섞이면 JSON-RPC 한 줄이 깨져
// 에디터가 세션을 통째로 끊는다. 그래서 '파이프면 아무것도 안 쓴다' 를
// 진짜 자식 프로세스를 띄워서 잰다 — 이 검사가 이 파일의 본체다.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 종, 창제목, 제목되돌리기, 알릴까, 제목글, 알릴만한초, 끔 } from '../src/ui/notify.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 원래끔 = process.env.DEEL_NO_BELL;
const 원래노 = process.env.NO_BELL;
delete process.env.DEEL_NO_BELL;
delete process.env.NO_BELL;

trace('1-언제알리나');

// ── 언제 알리나 ─────────────────────────────────────────────────────────
{
  check('짧은 턴은 안 알린다', 알릴까({ 걸린밀리초: 1200 }) === false);
  check('긴 턴은 알린다', 알릴까({ 걸린밀리초: 30_000 }) === true);
  check('문턱 바로 위', 알릴까({ 걸린밀리초: 알릴만한초 * 1000 }) === true);
  check('문턱 바로 아래', 알릴까({ 걸린밀리초: 알릴만한초 * 1000 - 1 }) === false);
  // 물어보는 자리는 시간과 무관하다. 막혀 있는 것이 끝난 것보다 급하다.
  check('물어보는 자리는 0초여도 알린다', 알릴까({ 걸린밀리초: 0, 물어봄: true }) === true);
  check('끄면 물어봐도 안 알린다', 알릴까({ 걸린밀리초: 0, 물어봄: true, 켬: false }) === false);
  check('문턱을 바꿔 줄 수 있다', 알릴까({ 걸린밀리초: 3000, 문턱초: 2 }) === true);
  check('인자 없이 불러도 안 죽는다', 알릴까() === false);
}

trace('2-창제목글');

// ── 제목 글 ─────────────────────────────────────────────────────────────
{
  // 폴더를 **앞**에 둔다. 탭 이름은 짧게 잘리는데 전부 'deel' 로 시작하면
  // 어느 탭이 끝난 건지 알 수가 없다.
  check('폴더가 앞에 온다', 제목글('끝남', { 폴더: 'Local' }).startsWith('Local · '),
    제목글('끝남', { 폴더: 'Local' }));
  check('폴더가 없어도 된다', 제목글('끝남') === 'deel — 다 됐습니다', 제목글('끝남'));
  check('물어보는 중이 드러난다', 제목글('물어봄').includes('물어볼'), 제목글('물어봄'));
  check('멈춘 것도 드러난다', 제목글('탈남').includes('멈췄'), 제목글('탈남'));
  check('도는 중엔 초를 보인다', 제목글('도는중', { 초: 7 }).includes('7초'), 제목글('도는중', { 초: 7 }));
  check('1분 넘으면 분으로', 제목글('도는중', { 초: 135 }).includes('2분'), 제목글('도는중', { 초: 135 }));
  check('모르는 갈래여도 안 죽는다', typeof 제목글('없는것') === 'string');
}

trace('3-제어문자를안흘린다');

// ── 제목에 제어문자가 섞이면 화면이 깨진다 ──────────────────────────────
{
  const 원래 = process.stdout.write.bind(process.stdout);
  let 담긴것 = '';
  process.stdout.write = (s) => { 담긴것 += s; return true; };
  const 원래tty = process.stdout.isTTY;
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

  창제목('앞\x07가운데\n뒤');
  Object.defineProperty(process.stdout, 'isTTY', { value: 원래tty, configurable: true });
  process.stdout.write = 원래;

  // 제목 안에 BEL 이 남으면 제목을 바꿀 때마다 종이 울린다 — 아껴 쓰기로 한 소리가 매초 난다.
  const 속 = 담긴것.split('\x1b]2;')[1]?.split('\x1b\\')[0] ?? '';
  check('제목 안에 BEL 이 안 남는다', !속.includes('\x07'), JSON.stringify(속));
  check('제목 안에 줄바꿈이 안 남는다', !속.includes('\n'), JSON.stringify(속));
  check('글자는 살아 있다', 속.includes('앞') && 속.includes('뒤'), JSON.stringify(속));
  // 끝맺음은 ST(\x1b\\). BEL 로 끝내면 제목 바꿀 때마다 딩 소리가 난다.
  check('끝맺음이 ST 다', 담긴것.includes('\x1b\\') && !담긴것.includes('\x07'), JSON.stringify(담긴것));
  check('OSC 1 도 같이 보낸다 — tmux 는 이쪽을 본다', 담긴것.includes('\x1b]1;'), JSON.stringify(담긴것));
}

trace('4-끄는스위치');

// ── 끄는 스위치 ─────────────────────────────────────────────────────────
{
  check('평소엔 안 꺼져 있다', 끔() === false);
  process.env.DEEL_NO_BELL = '1';
  check('DEEL_NO_BELL 이면 꺼진다', 끔() === true);
  check('꺼지면 종도 안 울린다', 종() === false);
  check('꺼지면 제목도 안 바꾼다', 창제목('아무거나') === false);
  check('꺼지면 되돌리기도 안 한다', 제목되돌리기() === false);
  check('꺼지면 알릴까도 거짓', 알릴까({ 걸린밀리초: 999_999 }) === false);
  delete process.env.DEEL_NO_BELL;
  process.env.NO_BELL = '1';
  check('NO_BELL 도 먹는다 — 남들 쓰는 이름', 끔() === true);
  delete process.env.NO_BELL;
}

trace('5-파이프에는안흘린다');

// ── 여기가 본체: 파이프면 한 글자도 안 나가야 한다 ──────────────────────
//
// ACP·`deel run` 은 stdout 이 파이프다. \x07 한 글자가 섞이면 JSON-RPC 한
// 줄이 깨져 에디터가 세션을 끊는다. 소리 한 번 내려다 연결을 끊는 셈이다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-notify-'));
  const 아이 = join(방, 'child.mjs');
  const 모듈 = pathToFileURL(join(process.cwd(), 'src', 'ui', 'notify.js')).href;
  writeFileSync(아이, [
    `const n = await import(${JSON.stringify(모듈)});`,
    'n.종();',
    "n.창제목('절대 안 나가야 한다');",
    'n.제목되돌리기();',
    // 파이프로 나가는 정상 출력. 이것만 나와야 한다.
    "process.stdout.write('OK\\n');",
  ].join('\n'), 'utf8');

  const 결과 = await new Promise((res) => {
    const p = spawn(process.execPath, [아이], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => res({ out, err, code }));
  });

  check('자식이 정상 종료한다', 결과.code === 0, `code ${결과.code} / ${결과.err}`);
  check('파이프에 BEL 이 안 나간다', !결과.out.includes('\x07'), JSON.stringify(결과.out));
  check('파이프에 OSC 가 안 나간다', !결과.out.includes('\x1b]'), JSON.stringify(결과.out));
  check('보내려던 것만 나온다', 결과.out === 'OK\n', JSON.stringify(결과.out));
  // stderr 도 파이프였으니 이쪽으로도 새면 안 된다.
  check('stderr 로도 안 샌다', !결과.err.includes('\x07') && !결과.err.includes('\x1b]'),
    JSON.stringify(결과.err));

  rmSync(방, { recursive: true, force: true });
}

if (원래끔 !== undefined) process.env.DEEL_NO_BELL = 원래끔;
if (원래노 !== undefined) process.env.NO_BELL = 원래노;

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n알림 검사  ${D}(끝났을 때 종소리와 창 제목)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
