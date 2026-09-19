// 클립보드 그림 붙이기 — `/paste` (src/tools/clipboard.js · src/commands.js).
//
// ── 무엇을 재나 ────────────────────────────────────────────────────────
//
//   1) 세 갈래를 갈라 말하는가. 「그림이 없다」(캡처를 다시 하면 된다) ·
//      「못 꺼냈다」(까닭과 길이 필요하다) · 「눈 없는 모델이다」(붙여도
//      못 본다). 뭉뚱그려 「안 됩니다」로 내면 사람은 뭘 고칠지 모른다.
//
//   2) ★ **살림 파일이 @ 로 새지 않는가.** 붙인 그림을 .deel 안에 두게 되면서
//      그 폴더가 @ 로 닿는 자리가 됐다. 그런데 거기에는 config.json 도 있다 —
//      게이트웨이 열쇠가 든 파일이다. Read 도구는 막고 있었지만 @ 는 안 막고
//      있었고, 실제로 `@.deel/config.json` 한 줄에 열쇠가 대화로 나갔다.
//
// **사람의 진짜 클립보드는 안 건드린다.** 검사가 남의 복사해 둔 것을 지우면
// 안 된다. 그래서 꺼내기를 갈아 끼워 세 갈래를 재고, 진짜 클립보드는 읽기만
// 한 번 해 본다(읽는 것은 아무것도 안 바꾼다).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 클립보드그림, 그림앉히기, 그림한도 } from '../src/tools/clipboard.js';
import { 붙여넣기명령 } from '../src/commands.js';
import { expand } from '../src/agent/mention.js';
import { TOOLS } from '../src/tools/index.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

/** 1x1 짜리 진짜 PNG. */
const 작은PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
  + '0000000a49444154789c6360000002000100ffff03000006000557bfabd4'
  + '0000000049454e44ae426082', 'hex');

// 화면에 나간 말을 잡아 둔다.
function 화면잡기(할일) {
  const 원래 = process.stdout.write;
  let 모은것 = '';
  process.stdout.write = (s) => { 모은것 += s; return true; };
  let r;
  try { r = 할일(); } finally { process.stdout.write = 원래; }
  return { r, 글: 모은것.replace(/\x1b\[[0-9;]*m/g, '') };
}

// ── 1. 파일로 앉히기 ───────────────────────────────────────────────────
trace('1-앉히기');
{
  const root = mkdtempSync(join(tmpdir(), 'deel-clip-'));
  const 살림 = join(root, '.deel');
  const 것 = 그림앉히기(작은PNG, 살림, { 이제: new Date('2026-03-04T05:06:07Z') });
  check('살림 폴더 안에 앉는다', 것.자리.replace(/\\/g, '/').includes('.deel/붙인그림/'), 것.자리);
  check('이름이 시각이다 (겹치지 않게)', 것.이름 === '2026-03-04_05-06-07.png', 것.이름);
  check('진짜로 써진다', existsSync(것.자리) && 것.바이트 === 작은PNG.length, String(것.바이트));
  check('작업 폴더를 안 어지럽힌다', readdirSync(root).join(' ') === '.deel', readdirSync(root).join(' '));

  // 두 번 붙여도 앞의 것을 안 덮는다 (시각이 다르면).
  그림앉히기(작은PNG, 살림, { 이제: new Date('2026-03-04T05:06:08Z') });
  check('두 장이 따로 남는다', readdirSync(join(살림, '붙인그림')).length === 2,
    readdirSync(join(살림, '붙인그림')).join(' '));
}

// ── 2. 못 하는 자리는 못 한다고 ───────────────────────────────────────
trace('2-못하는곳');
{
  const r = 클립보드그림({ platform: 'sunos' });
  check('낯선 OS 면 못 한다고 한다', r.ok === false && !r.없음, JSON.stringify(r));
  check('그때 다른 길을 알려 준다', /@경로 로 붙이세요/.test(r.왜 ?? ''), r.왜);
  check('한도가 정해져 있다', 그림한도 > 0 && 그림한도 <= 32 * 1024 * 1024, String(그림한도));
}

// ── 3. `/paste` 의 세 갈래 ────────────────────────────────────────────
trace('3-세갈래');
{
  const root = mkdtempSync(join(tmpdir(), 'deel-paste-'));
  const scope = makeScope(root);
  const 눈있는세션 = { root, conn: { vision: true } };

  // ① 그림이 있을 때
  const 있을때 = 화면잡기(() => 붙여넣기명령(눈있는세션, { scope }, {
    꺼내기: () => ({ ok: true, buf: 작은PNG, mime: 'image/png' }),
  }));
  check('그림이 있으면 @경로 로 바꿔서 보낸다',
    있을때.r.handled === false && /^@\.deel\/붙인그림\/.*\.png$/.test(있을때.r.text ?? ''), JSON.stringify(있을때.r));
  check('★ 어느 파일이 나가는지 사람에게 보여 준다',
    /클립보드에서 가져와 앉혔습니다/.test(있을때.글) && /\.deel\/붙인그림\//.test(있을때.글), 있을때.글.trim());
  check('크기도 같이 적는다', /\d+B|\dKB|\dMB/.test(있을때.글), 있을때.글.trim());

  // ② 그림이 없을 때 — 이건 고장이 아니다
  const 없을때 = 화면잡기(() => 붙여넣기명령(눈있는세션, { scope }, {
    꺼내기: () => ({ ok: false, 없음: true }),
  }));
  check('★ 그림이 없으면 「없다」고만 한다 (고장이 아니다)',
    없을때.r.handled === true && /클립보드에 그림이 없습니다/.test(없을때.글), 없을때.글.trim());
  check('★ 그때 어떻게 하면 되는지 알려 준다', /캡처/.test(없을때.글) && /Win\+Shift\+S/.test(없을때.글), 없을때.글.trim());
  check('없을 때는 파일을 안 만든다',
    !existsSync(join(root, '.deel', '붙인그림')) || readdirSync(join(root, '.deel', '붙인그림')).length === 1,
    String(existsSync(join(root, '.deel', '붙인그림')) ? readdirSync(join(root, '.deel', '붙인그림')).length : 0));

  // ③ 못 꺼냈을 때 — 이건 우리 탓이고, 길을 줘야 한다
  const 막혔을때 = 화면잡기(() => 붙여넣기명령(눈있는세션, { scope }, {
    꺼내기: () => ({ ok: false, 왜: '클립보드에서 그림을 꺼낼 도구가 없습니다.\n  sudo apt install xclip' }),
  }));
  check('★ 못 꺼냈으면 까닭을 그대로 보여 준다', /꺼낼 도구가 없습니다/.test(막혔을때.글), 막혔을때.글.trim());
  check('★ 여러 줄짜리 까닭도 다 보여 준다', /apt install xclip/.test(막혔을때.글), 막혔을때.글.trim());
  check('못 꺼냈으면 아무것도 안 보낸다', 막혔을때.r.handled === true && !막혔을때.r.text, JSON.stringify(막혔을때.r));

  // ④ 눈이 없는 모델 — 붙여도 못 본다. 보내기 **전에** 말해야 한다.
  const 눈없을때 = 화면잡기(() => 붙여넣기명령({ root, conn: { vision: false } }, { scope }, {
    꺼내기: () => ({ ok: true, buf: 작은PNG, mime: 'image/png' }),
  }));
  check('★ 눈 없는 모델이면 미리 말해 준다', /그림을 못 봅니다/.test(눈없을때.글), 눈없을때.글.trim());
  check('그래도 파일은 남긴다 (사람이 나중에 쓸 수 있게)', /@\.deel\/붙인그림\//.test(눈없을때.r.text ?? ''), 눈없을때.r.text);
}

// ── 4. ★ 붙인 그림은 @ 로 닿고, 열쇠는 안 닿는다 ─────────────────────
trace('4-열쇠');
{
  /*
   * 붙인 그림을 .deel 안에 두면서 그 폴더가 @ 로 닿는 자리가 됐다.
   * 그런데 거기에는 config.json 도 산다 — 게이트웨이 열쇠가 든 파일이다.
   *
   * Read 도구는 막고 있었는데 @ 는 안 막고 있었다. 도구는 막고 @ 는 안 막으면
   * 막은 것이 아니다. 실제로 한 줄에 열쇠가 대화로 나갔다.
   */
  const root = mkdtempSync(join(tmpdir(), 'deel-key-'));
  mkdirSync(join(root, '.deel', '붙인그림'), { recursive: true });
  writeFileSync(join(root, '.deel', 'config.json'), JSON.stringify({ apiKey: 'sk-비밀열쇠-0123456789' }), 'utf8');
  writeFileSync(join(root, '.deel', 'audit.jsonl'), '{"tool":"Bash"}\n', 'utf8');
  writeFileSync(join(root, '.deel', '붙인그림', 'x.png'), 작은PNG);
  const scope = makeScope(root);
  const 붙여보기 = (경로) => expand(`@${경로}`, { scope, budget: 20000, seen: new Set(), 눈있나: true });

  const 열쇠 = 붙여보기('.deel/config.json');
  check('★ @ 로도 열쇠 파일이 안 붙는다', 열쇠.attached.length === 0 && 열쇠.blocked.length === 1, JSON.stringify(열쇠.blocked));
  check('★ 열쇠가 한 글자도 안 샌다', !/비밀열쇠|sk-/.test(열쇠.text), 열쇠.text.slice(0, 120));
  check('★ 왜 안 붙는지 말해 준다', /열쇠가 들어 있어/.test(열쇠.blocked[0]?.why ?? ''), 열쇠.blocked[0]?.why);

  const 기록 = 붙여보기('.deel/audit.jsonl');
  check('감사 기록도 @ 로 안 붙는다', 기록.attached.length === 0 && 기록.blocked.length === 1, JSON.stringify(기록.blocked));

  const 그림 = 붙여보기('.deel/붙인그림/x.png');
  check('★ 붙인 그림은 그대로 붙는다 (막느라 이것까지 막으면 기능이 죽는다)',
    그림.attached.length === 1 && 그림.그림들.length === 1, JSON.stringify(그림.blocked));

  // 도구 쪽도 여전히 막혀 있어야 한다 — 한쪽만 고치고 다른 쪽이 열리면 안 된다.
  const ctx = { scope, history: new History(root), audit: new Audit(root), seen: new Set() };
  const rd = await TOOLS.Read.run({ file_path: '.deel/config.json' }, ctx);
  check('Read 도구도 여전히 막는다', /열쇠가 들어 있어/.test(rd.error ?? ''), rd.error ?? String(rd.content).slice(0, 60));
  const rd2 = await TOOLS.Read.run({ file_path: '.deel/붙인그림/x.png' }, ctx);
  check('붙인 그림은 Read 로도 읽힌다', !rd2.error, rd2.error ?? '(읽힘)');
}

// ── 5. 진짜 클립보드 — 읽기만 해 본다 ─────────────────────────────────
trace('5-진짜');
{
  /*
   * 사람이 복사해 둔 것이 무엇인지는 모른다(그림일 수도, 글일 수도, 빈 것일
   * 수도 있다). 그러니 무엇이 나오는지가 아니라 **모양이 성한지**만 잰다.
   * 읽는 것은 클립보드를 안 바꾼다 — 남의 복사해 둔 것을 지우지 않는다.
   */
  const r = 클립보드그림();
  const 성한가 = r && typeof r.ok === 'boolean'
    && (r.ok ? (Buffer.isBuffer(r.buf) && r.buf.length > 0 && typeof r.mime === 'string')
      : (r.없음 === true || typeof r.왜 === 'string'));
  // 「안 터진다」는 따로 안 적는다 — 터지면 이 줄까지 못 온다.
  check('★ 진짜 클립보드를 읽어도 모양이 성하다', 성한가 === true, JSON.stringify(r?.ok ? { ok: true, bytes: r.buf.length } : r));
  if (r.ok) check('그림이면 진짜 그림 바이트다', r.buf.length > 8, String(r.buf.length));
}

// ── 6. 맥·리눅스 갈래도 계약을 지키는가 ───────────────────────────────
trace('6-갈래별');
{
  /*
   * 세 갈래 중 이 PC 에서 진짜로 도는 것은 하나뿐이다. 나머지 둘은 **한 번도
   * 안 불려 본 채로** 맥·리눅스 사람에게 나간다. 거기서 계약이 깨지면
   * (undefined 를 돌려준다든지) 그 사실은 그 사람 화면에서 처음 드러난다.
   *
   * 계약은 3번 절에서 `붙여넣기명령` 이 기대는 바로 그것이다 —
   * 실패는 「없음」(다시 캡처하면 된다)이거나 「왜」(까닭과 길이 있다)여야
   * 하고, 둘 다 없는 실패는 사람이 뭘 할지 모른다.
   *
   * 무엇이 나오는지는 그 PC 에 무엇이 깔렸느냐에 달렸다(리눅스 러너에
   * xclip 이 있을 수도 없을 수도 있다). 그러니 5번 절과 같은 까닭으로,
   * **나오는 값이 아니라 계약**을 잰다.
   */
  const 계약지킴 = (r) => r && typeof r.ok === 'boolean'
    && (r.ok ? (Buffer.isBuffer(r.buf) && r.buf.length > 0 && typeof r.mime === 'string')
      : (r.없음 === true || (typeof r.왜 === 'string' && r.왜.length > 0)));

  const 맥 = 클립보드그림({ platform: 'darwin' });
  check('★ 맥 갈래가 계약을 지킨다', 계약지킴(맥) === true, JSON.stringify(맥.ok ? { ok: true } : 맥));
  if (process.platform !== 'darwin') {
    check('맥이 아닌 곳에서는 osascript 를 못 불렀다고 한다',
      맥.ok === false && (맥.없음 === true || /osascript/.test(맥.왜 ?? '')), JSON.stringify(맥));
  }

  const 리 = 클립보드그림({ platform: 'linux' });
  check('★ 리눅스 갈래가 계약을 지킨다', 계약지킴(리) === true, JSON.stringify(리.ok ? { ok: true } : 리));
  if (리.ok === false && 리.왜) {
    // 도구가 없어서 막힌 것이라면, 「안 됩니다」로 끝내지 않았어야 한다.
    check('★ 막혔으면 무엇을 하면 되는지 같이 준다',
      /wl-clipboard|xclip|@경로/.test(리.왜), 리.왜);
  }

  // 낯선 OS 는 2번 절에서 이미 쟀다. 여기서는 그 답도 같은 계약인지만 본다.
  check('낯선 OS 의 답도 같은 계약이다', 계약지킴(클립보드그림({ platform: 'sunos' })) === true);
}

// ── 7. 갈래 속 — 부르기를 갈아 끼워 그림을 넘기는 자리까지 ─────────────
trace('7-갈래속');
{
  /*
   * 6번 절은 계약 모양만 잰다. 이 PC 에 없는 명령은 곧장 「못 불렀다」 로
   * 끝나서, 그림을 받아 넘기는 속 갈래는 검사판에서 한 번도 안 돈다. 실제로
   * 그 자리에 세 구멍이 있었다 — 한글 든 임시 경로(윈도우) · 1MB 넘는 캡처(맥) ·
   * 그림을 봤는데 못 꺼낸 것을 「없음」 으로 말하기(리눅스).
   *
   * 그래서 운영체제 명령을 흉내 내는 부르기를 넘긴다. 진짜 클립보드는 안 건드린다.
   */
  const 없는명령 = (이름) => ({ error: Object.assign(new Error(`spawnSync ${이름} ENOENT`), { code: 'ENOENT' }) });

  // ① 윈도우 — 임시 폴더 경로에 한글이 있어도 그 자리에 저장돼야 한다.
  const 한글임시 = mkdtempSync(join(tmpdir(), 'deel-임시폴더-'));
  let 받은스크립트 = null;
  const 윈도우흉내 = (그림있나) => (이름, 인자) => {
    if (이름 !== 'powershell') return 없는명령(이름);
    const 자리 = 인자.indexOf('-File');
    받은스크립트 = readFileSync(인자[자리 + 1]);
    if (!그림있나) return { status: 0, stdout: 'NOIMAGE\r\n', stderr: '' };
    // PowerShell 5.1 이 BOM 없는 .ps1 을 읽듯 바이트 하나를 글자 하나로 읽는다.
    const 글 = 받은스크립트.toString('latin1');
    let 낼곳 = null;
    if (/param\s*\(/i.test(글)) 낼곳 = 인자[자리 + 2];
    else { const m = /\.Save\(("(?:[^"\\]|\\.)*")/.exec(글); if (m) 낼곳 = JSON.parse(m[1]); }
    try { writeFileSync(낼곳, 작은PNG); } catch { return { status: 1, stdout: '', stderr: 'Exception calling "Save"' }; }
    return { status: 0, stdout: 'OK\r\n', stderr: '' };
  };
  const 옛환경 = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  let 윈 = null;
  let 윈없음 = null;
  try {
    process.env.TEMP = 한글임시; process.env.TMP = 한글임시; process.env.TMPDIR = 한글임시;
    윈 = 클립보드그림({ platform: 'win32', 부르기: 윈도우흉내(true) });
    윈없음 = 클립보드그림({ platform: 'win32', 부르기: 윈도우흉내(false) });
  } finally {
    for (const [k, v] of Object.entries(옛환경)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  check('★ (K1) 임시 폴더 경로에 한글이 있어도 윈도우 갈래가 그림을 가져온다',
    윈?.ok === true && Buffer.isBuffer(윈.buf) && 윈.buf.equals(작은PNG), JSON.stringify(윈?.ok ? { ok: true } : 윈));
  check('★ (K1) 파워셸 스크립트는 ASCII 바이트뿐이다 (경로가 스크립트 글에 안 섞인다)',
    !!받은스크립트 && [...받은스크립트].every((b) => b < 0x80), 받은스크립트 ? String(받은스크립트.length) : '(안 불림)');
  check('(K1 짝) 윈도우에서 그림이 없으면 여전히 「없음」', 윈없음?.ok === false && 윈없음.없음 === true, JSON.stringify(윈없음));

  // ② 맥 — osascript 는 16진수로 내니 PNG 512KB 만 넘어도 1MB 를 넘긴다.
  const 큰PNG = Buffer.concat([작은PNG, Buffer.alloc(700 * 1024)]);
  let 맥설정 = null;
  const 맥흉내 = (이름, 인자, 설정 = {}) => {
    if (이름 !== 'osascript') return 없는명령(이름);
    맥설정 = 설정;
    const 낸말 = `«data PNGf${큰PNG.toString('hex')}»\n`;
    if (Buffer.byteLength(낸말) > (설정.maxBuffer ?? 1024 * 1024)) {
      return { error: Object.assign(new Error('spawnSync osascript ENOBUFS'), { code: 'ENOBUFS' }), stdout: 낸말.slice(0, 1024 * 1024) };
    }
    return { status: 0, stdout: 낸말, stderr: '' };
  };
  const 맥 = 클립보드그림({ platform: 'darwin', 부르기: 맥흉내 });
  check('★ (K2) 맥에서 1MB 넘게 나오는 캡처도 받는다',
    맥.ok === true && 맥.buf.equals(큰PNG), JSON.stringify(맥.ok ? { ok: true, n: 맥.buf.length } : 맥));
  check('★ (K2) 받을 자리가 그림 한도의 16진수 길이를 담는다',
    (맥설정?.maxBuffer ?? 0) >= 그림한도 * 2, String(맥설정?.maxBuffer));

  /*
   * ★ 맥에서도 「그림이 없다」 와 「못 꺼냈다」 를 가른다 (8회차).
   *
   * 머리말이 못 박은 규칙이다 — 앞의 것은 사람이 캡처를 다시 하면 되고, 뒤의
   * 것은 우리 탓이다. 그런데 맥 갈래는 두 갈래를 써 놓고 **글자까지 같은 말**을
   * 돌려줬다. osascript 가 0 으로 끝났는데 PNG 가 안 나온 것은 그림이 없는 것이
   * 아니라 우리가 못 읽은 것이다. 「없음」 으로 덮으면 사람은 같은 캡처를
   * 되풀이하고, 될 리가 없다.
   */
  const 맥성공했는데없음 = 클립보드그림({
    platform: 'darwin',
    부르기: (이름) => (이름 === 'osascript'
      ? { status: 0, stdout: '«class PNGf» 가 아닌 무언가', stderr: '' }
      : 없는명령(이름)),
  });
  check('★★ 맥에서 osascript 가 0 으로 끝났는데 PNG 를 못 읽으면 「없음」 이 아니다',
    맥성공했는데없음.ok === false && 맥성공했는데없음.없음 !== true && !!맥성공했는데없음.왜,
    JSON.stringify(맥성공했는데없음));
  const 맥진짜없음 = 클립보드그림({
    platform: 'darwin',
    부르기: (이름) => (이름 === 'osascript'
      ? { status: 1, stdout: '', stderr: 'execution error: 클립보드에 그림이 없습니다' }
      : 없는명령(이름)),
  });
  check('(짝) 오류로 끝나면 여태처럼 「없음」 이다 (사람이 다시 캡처하면 된다)',
    맥진짜없음.ok === false && 맥진짜없음.없음 === true, JSON.stringify(맥진짜없음));

  // ③ 리눅스 — 종류 목록에 image/png 가 있는데 꺼내기가 막히면 그건 「없음」 이 아니다.
  const 리눅스흉내 = (꺼냄) => (이름, 인자) => {
    if (이름 !== 'wl-paste') return 없는명령(이름);
    if (인자.includes('--version')) return { status: 0, stdout: 'wl-clipboard 2.2.1\n', stderr: '' };
    if (인자.includes('--list-types')) return { status: 0, stdout: 꺼냄 === '글만' ? 'text/plain\n' : 'image/png\ntext/html\n', stderr: '' };
    if (꺼냄 === '막힘') return { error: Object.assign(new Error('spawnSync wl-paste ETIMEDOUT'), { code: 'ETIMEDOUT' }), status: null, stdout: Buffer.alloc(0) };
    return { status: 0, stdout: 작은PNG, stderr: Buffer.alloc(0) };
  };
  const 리막힘 = 클립보드그림({ platform: 'linux', 부르기: 리눅스흉내('막힘') });
  check('★ (K3) 리눅스에서 그림은 있는데 못 꺼냈으면 「없음」 이 아니라 까닭을 말한다',
    리막힘.ok === false && 리막힘.없음 !== true && /wl-paste/.test(리막힘.왜 ?? ''), JSON.stringify(리막힘));
  const 리됨 = 클립보드그림({ platform: 'linux', 부르기: 리눅스흉내('됨') });
  check('(K3 짝) 꺼내기가 되면 그림을 준다', 리됨.ok === true && 리됨.buf.equals(작은PNG), JSON.stringify(리됨.ok ? { ok: true } : 리됨));
  const 리글만 = 클립보드그림({ platform: 'linux', 부르기: 리눅스흉내('글만') });
  check('(K3 짝) 그림이 목록에 없으면 여전히 「없음」', 리글만.ok === false && 리글만.없음 === true, JSON.stringify(리글만));
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n클립보드 붙이기 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
