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
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
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

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n클립보드 붙이기 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
