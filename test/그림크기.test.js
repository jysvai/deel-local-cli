// 그림의 **한 변**을 잰다.
//
// ── 왜 이 검사가 생겼나 ─────────────────────────────────────────────────
//
// 화면을 세로로 길게 찍은 캡처 한 장이 세션을 통째로 죽였다. 붙이는 순간에는
// 아무 일도 안 났다. 그 그림이 대화 여덟째 자리에 실린 **다음 턴부터**, 무슨
// 말을 걸어도 400 이었다.
//
//     image dimensions exceed max allowed size: 8000 pixels
//
// 고칠 길이 화면에 안 보인다는 것이 이 고장의 핵심이다. 사람은 「방금 뭘
// 잘못했지」 를 되짚는데, 잘못한 것은 여덟 턴 전이고 그건 이미 대화 안에
// 굳어 있다. 새 말을 아무리 조심해서 써도 안 낫는다.
//
// ── 바이트로는 절대 못 잡는다 ───────────────────────────────────────────
//
// 이미 있던 4MB 문지기가 이걸 못 막았다. 못 막는 게 당연하다 — **바이트와
// 픽셀은 따로 논다.** 화면 캡처는 같은 색이 넓게 이어져서 아주 잘 압축된다.
//
//     12000×3000 짜리 페이지 캡처  →  1MB 도 안 됨  →  크기 문지기 통과
//     800×600 짜리 사진           →  3MB           →  크기 문지기 통과
//
// 앞엣것이 세션을 죽이고 뒤엣것은 멀쩡하다. 그러니 픽셀을 따로 재야 한다.
//
// ── 그런데 이 문지기에 검사가 한 줄도 없었다 ────────────────────────────
//
// 문지기를 세우고도 재지를 않았다. 그 안에는 손으로 짠 이진 머리말 해석이
// 들어 있다 — 엔디안, 비트마스크, JPEG 표시 걸어가기. 딱 조용히 틀리는
// 종류의 코드다. 틀리는 쪽은 둘 다 나쁘다.
//
//   못 막으면   세션이 죽는다 (고치려던 바로 그 고장)
//   더 막으면   멀쩡한 그림이 안 붙는다 (그리고 왜 안 붙는지 안 보인다)
//
// 그래서 형식 넷을 다 만들어서, 한도 아래·한도 위·잘린 것을 재 본다.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 치수읽기, 픽셀한도, 그림읽기, 그림종류 } from '../src/backend/vision.js';
import { 잰다 } from '../src/tools/clipboard.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

// ── 형식별로 진짜 머리말을 만든다 ───────────────────────────────────────
/*
 * 가짜가 아니라 **진짜 머리말**이어야 한다. 우리가 읽는 것이 바로 그 바이트라,
 * 대충 만든 것을 넣으면 검사는 초록인데 진짜 파일에서는 안 맞는다.
 */

/** PNG — 서명 8 + 길이 4 + 'IHDR' + 가로·세로 빅엔디안 4바이트씩. */
function png(가로, 세로) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(가로, 16);
  b.writeUInt32BE(세로, 20);
  b[24] = 8; b[25] = 6;
  return b;
}

/** GIF — 머리말 6 뒤에 가로·세로 **리틀**엔디안 2바이트씩. 엔디안이 PNG 와 반대다. */
function gif(가로, 세로) {
  const b = Buffer.alloc(14);
  b.write('GIF89a', 0, 'ascii');
  b.writeUInt16LE(가로, 6);
  b.writeUInt16LE(세로, 8);
  return b;
}

/**
 * JPEG — 치수가 고정된 자리에 없다. 표시를 걸어가며 SOF 를 찾아야 한다.
 *
 * @param 앞에낀것  SOF 앞에 끼울 표시들. 0xC4(허프만표)를 끼우면 그게 SOF 로
 *                  오인되는지 잴 수 있다 — 오인하면 엉뚱한 자리에서 숫자를 읽어
 *                  「3×1 그림」 같은 답이 나오고, 그건 한도를 늘 통과한다.
 */
function jpeg(가로, 세로, 앞에낀것 = []) {
  const 토막들 = [Buffer.from([0xff, 0xd8])];
  for (const 표시 of 앞에낀것) {
    const t = Buffer.alloc(20);
    t[0] = 0xff; t[1] = 표시;
    t.writeUInt16BE(18, 2);                    // 길이는 자기 자신부터 센다
    토막들.push(t);
  }
  const sof = Buffer.alloc(11);
  sof[0] = 0xff; sof[1] = 0xc0;
  sof.writeUInt16BE(9, 2);
  sof[4] = 8;                                  // 한 칸 몇 비트
  sof.writeUInt16BE(세로, 5);                  // 세로가 **먼저**다
  sof.writeUInt16BE(가로, 7);
  토막들.push(sof, Buffer.alloc(8));
  return Buffer.concat(토막들);
}

/** WebP 는 속이 셋이고 치수가 저마다 다른 자리에 다르게 담긴다. */
function webp(갈래, 가로, 세로) {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(32, 4);
  b.write('WEBP', 8, 'ascii');
  b.write(갈래, 12, 'ascii');
  b.writeUInt32LE(20, 16);
  if (갈래 === 'VP8 ') {
    Buffer.from([0x9d, 0x01, 0x2a]).copy(b, 23);   // 맞춤 코드
    b.writeUInt16LE(가로, 26);
    b.writeUInt16LE(세로, 28);
  } else if (갈래 === 'VP8L') {
    b[20] = 0x2f;
    // 14비트씩 이어 붙인다. '한 변 - 1' 이 담긴다.
    b.writeUInt32LE(((세로 - 1) << 14) | (가로 - 1), 21);
  } else if (갈래 === 'VP8X') {
    const 셋 = (v, at) => { b[at] = v & 0xff; b[at + 1] = (v >> 8) & 0xff; b[at + 2] = (v >> 16) & 0xff; };
    셋(가로 - 1, 24);
    셋(세로 - 1, 27);
  }
  return b;
}

// ── 1. 형식 넷을 다 읽는다 ──────────────────────────────────────────────
trace('1-읽기');
{
  /*
   * 한 형식이라도 못 읽으면 그 형식으로 저장한 긴 캡처는 그냥 통과한다.
   * 못 읽는 것은 「막지 않는다」 로 흘러가기 때문이다 — 그게 맞는 설계지만,
   * 그래서 **읽는 것 자체가 문지기의 전부**다.
   */
  const 판 = [
    ['PNG', png(1920, 1080), 1920, 1080],
    ['GIF', gif(640, 480), 640, 480],
    ['JPEG', jpeg(1024, 768), 1024, 768],
    ['WebP VP8', webp('VP8 ', 800, 600), 800, 600],
    ['WebP VP8L', webp('VP8L', 300, 200), 300, 200],
    ['WebP VP8X', webp('VP8X', 5000, 4000), 5000, 4000],
  ];
  for (const [이름, buf, 가로, 세로] of 판) {
    const 것 = 치수읽기(buf);
    check(`★★★ ${이름} 치수를 읽는다 (${가로}×${세로})`,
      것?.가로 === 가로 && 것?.세로 === 세로, JSON.stringify(것));
  }
  check('★★ 종류도 알아본다 — 치수는 종류를 맞게 봤을 때만 뜻이 있다',
    그림종류(png(1, 1)) === 'image/png' && 그림종류(gif(1, 1)) === 'image/gif'
    && 그림종류(jpeg(1, 1)) === 'image/jpeg' && 그림종류(webp('VP8 ', 1, 1)) === 'image/webp', '');
}

// ── 2. 세로·가로를 안 바꿔 읽는다 ───────────────────────────────────────
trace('2-가로세로');
{
  /*
   * 여기가 조용히 틀리기 제일 쉬운 자리다. JPEG 은 **세로가 먼저** 오고 GIF 은
   * 엔디안이 PNG 와 반대다. 뒤집어 읽어도 정사각형 그림에서는 안 들킨다 —
   * 그리고 사람을 죽이는 그림은 언제나 한쪽만 긴 그림이다.
   */
  const 것 = 치수읽기(jpeg(100, 9000));
  check('★★★ JPEG 은 세로가 먼저 담긴다 — 뒤집어 읽지 않는다',
    것?.가로 === 100 && 것?.세로 === 9000, JSON.stringify(것));
  const g = 치수읽기(gif(100, 9000));
  check('★★★ GIF 은 리틀엔디안이다 — 바이트를 뒤집어 읽지 않는다',
    g?.가로 === 100 && g?.세로 === 9000, JSON.stringify(g));
  const p = 치수읽기(png(100, 9000));
  check('★★★ PNG 은 빅엔디안이다', p?.가로 === 100 && p?.세로 === 9000, JSON.stringify(p));
}

// ── 3. 허프만표를 SOF 로 오인하지 않는다 ────────────────────────────────
trace('3-JPEG표시');
{
  /*
   * SOF 는 0xFFC0~0xFFCF 인데 그 안의 C4(허프만표)·C8·CC 는 SOF 가 아니다.
   * 안 빼면 허프만표 안의 아무 숫자나 치수로 읽는다. 그렇게 읽힌 값은 거의
   * 언제나 작아서 **한도를 통과한다** — 문지기가 있는데 아무도 안 막힌다.
   */
  const 것 = 치수읽기(jpeg(200, 9000, [0xc4]));
  check('★★★ 0xC4(허프만표)를 건너뛰고 진짜 SOF 를 찾는다',
    것?.가로 === 200 && 것?.세로 === 9000, JSON.stringify(것));
  const 둘 = 치수읽기(jpeg(200, 9000, [0xe0, 0xdb, 0xc4, 0xc8, 0xcc]));
  check('★★★ 앞에 표시가 여럿 껴 있어도 찾는다 (APP0·DQT·C4·C8·CC)',
    둘?.가로 === 200 && 둘?.세로 === 9000, JSON.stringify(둘));
}

// ── 4. 한도 위아래를 가른다 ─────────────────────────────────────────────
trace('4-한도');
{
  /*
   * 경계에서 한 픽셀 차이로 갈려야 한다. `>` 와 `>=` 를 헷갈리면 딱 8000 인
   * 그림이 막히는데, 그건 서버가 받아 주는 그림이다.
   */
  const 방 = mkdtempSync(join(tmpdir(), 'deel-px-'));
  try {
    const 쓰기 = (이름, buf) => { const p = join(방, 이름); writeFileSync(p, buf); return p; };

    check('★★ 한도는 8000 이다', 픽셀한도 === 8000, String(픽셀한도));

    const 딱 = 그림읽기(쓰기('deng.png', png(픽셀한도, 100)));
    check('★★★ 딱 8000 은 통과한다 — 서버가 받아 주는 그림이다', 딱.ok !== false || !딱.가로,
      JSON.stringify({ ok: 딱.ok, 왜: 딱.왜?.slice(0, 40) }));

    const 하나넘 = 그림읽기(쓰기('over.png', png(픽셀한도 + 1, 100)));
    check('★★★ 8001 은 막는다', 하나넘.ok === false && 하나넘.가로 === 픽셀한도 + 1,
      JSON.stringify({ ok: 하나넘.ok, 가로: 하나넘.가로 }));

    const 세로만 = 그림읽기(쓰기('tall.png', png(1200, 12000)));
    check('★★★ 세로만 길어도 막는다 — 페이지 캡처가 딱 이 꼴이다',
      세로만.ok === false && 세로만.세로 === 12000, JSON.stringify({ ok: 세로만.ok, 세로: 세로만.세로 }));

    /*
     * 막을 때 **숫자를 말해 줘야** 한다. 「그림이 큽니다」 만 뜨면 사람은 파일
     * 크기를 줄이려 들고, 픽셀은 그대로라 다시 막힌다. 두 번째로 막힐 때가
     * 사람이 포기하는 자리다.
     */
    check('★★★ 막으면서 실제 치수와 한도를 말해 준다',
      (세로만.왜 ?? '').includes('12000') && (세로만.왜 ?? '').includes(String(픽셀한도)),
      세로만.왜?.slice(0, 80));
    check('★★ 왜 걸렸는지 사람 말로 짚어 준다 (화면 캡처)',
      /캡처|잘라/.test(세로만.왜 ?? ''), 세로만.왜?.slice(0, 60));

    // 바이트는 작은데 픽셀이 큰 것 — 이 검사 전체의 이유다.
    const 큰것 = png(12000, 3000);
    check('★★★ 12000×3000 인데 바이트는 1KB 도 안 된다 — 크기 문지기로는 절대 못 잡는다',
      큰것.length < 1024, `${큰것.length}바이트`);
  } finally {
    rmSync(방, { recursive: true, force: true });
  }
}

// ── 5. 모르면 막지 않는다 ───────────────────────────────────────────────
trace('5-모를때');
{
  /*
   * 우리가 못 읽는 모양이라고 서버도 못 읽는다는 뜻은 아니다. 모르는 것을
   * 이유로 막으면 멀쩡한 그림이 안 실리고, 그 사람은 까닭을 알 길이 없다.
   * 그리고 무엇보다 **던지면 안 된다** — 잘린 파일 하나가 붙이기를 통째로
   * 무너뜨리면 그게 더 큰 고장이다.
   */
  const 잘린것 = [
    ['빈 것', Buffer.alloc(0)],
    ['너무 짧은 것', Buffer.from([0x89, 0x50])],
    ['머리말만 있고 몸이 없는 PNG', png(100, 100).subarray(0, 15)],
    ['IHDR 이 아닌 PNG', (() => { const b = png(100, 100); b.write('IDAT', 12, 'ascii'); return b; })()],
    ['짧은 WebP', webp('VP8 ', 10, 10).subarray(0, 20)],
    ['SOF 없는 JPEG', Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(30)])],
    ['모르는 WebP 갈래', webp('VP9X', 10, 10)],
    ['그림이 아닌 것', Buffer.from('<!doctype html><html>로그인하세요</html>', 'utf8')],
  ];
  for (const [이름, buf] of 잘린것) {
    let 던졌나 = false;
    let 것;
    try { 것 = 치수읽기(buf); } catch { 던졌나 = true; }
    check(`★★★ ${이름} — 안 던지고 모른다고 한다`, !던졌나 && (것 === null || 것 === undefined),
      던졌나 ? '던졌다' : JSON.stringify(것));
  }
}

// ── 6. 붙여넣기도 같은 자를 쓴다 ────────────────────────────────────────
trace('6-붙여넣기');
{
  /*
   * 이 길로 들어오는 것은 **전부 화면 캡처**다. 즉 긴 그림이 제일 많이 들어오는
   * 문이다. 파일 경로(@)만 막고 여기를 안 막으면, 제일 흔한 길이 그대로 뚫려
   * 있는 셈이다. 두 문이 같은 자를 쓰는지 여기서 못 박는다.
   */
  const 좋은것 = 잰다({ ok: true, buf: png(1200, 800), mime: 'image/png' });
  check('★★★ 알맞은 그림은 그대로 지나간다', 좋은것.ok === true, JSON.stringify(좋은것.왜 ?? ''));

  const 긴것 = 잰다({ ok: true, buf: png(12000, 3000), mime: 'image/png' });
  check('★★★ 붙여넣기에서도 긴 그림을 막는다 — 실려 들어간 뒤는 늦다',
    긴것.ok === false && /12000/.test(긴것.왜 ?? ''), JSON.stringify(긴것.왜 ?? '').slice(0, 90));

  check('★★★ 파일 길과 붙여넣기 길이 같은 한도를 쓴다',
    잰다({ ok: true, buf: png(픽셀한도, 100), mime: 'image/png' }).ok === true
    && 잰다({ ok: true, buf: png(픽셀한도 + 1, 100), mime: 'image/png' }).ok === false, '');

  check('★★ 그림이 없으면 없다고 한다 (못 꺼낸 것과 다르다)',
    잰다({ ok: true, buf: Buffer.alloc(0) }).없음 === true, '');
  check('★★ 앞에서 이미 실패한 것은 그대로 흘려보낸다',
    잰다({ ok: false, 왜: '앞에서 막힘' }).왜 === '앞에서 막힘', '');
  check('★★ 치수를 못 읽는 그림은 안 막는다 — 모르는 것으로 막지 않는다',
    잰다({ ok: true, buf: Buffer.from('PK\u0003\u0004not-an-image'), mime: null }).ok === true, '');
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n그림 한 변 검사  ${D}(바이트가 작다고 작은 그림이 아니다)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
