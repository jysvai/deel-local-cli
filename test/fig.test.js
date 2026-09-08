/**
 * Figma `.fig` 읽기 (tools/fig.js · tools/kiwi.js).
 *
 * ── 진짜 .fig 없이 어떻게 재나 ──────────────────────────────────────────
 *
 * 저장소에 남의 시안 파일을 넣을 수는 없다. 그래서 **형식대로 하나 만들어서**
 * 읽힌다. 그러면 「우리가 만든 것을 우리가 읽었다」 는 동어반복이 될 수
 * 있으니, 그 아래에 못을 하나 박는다.
 *
 *   Kiwi 명세가 정한 바이트를 **손으로 적어 놓고** 만드는 쪽을 거기에 맞춘다.
 *
 * varuint(300) 은 `AC 02` 여야 하고, varfloat(1.0) 은 `7F 00 00 00` 이어야
 * 한다(Kiwi 는 지수부를 앞으로 돌려 놓는다). 만드는 쪽이 명세와 어긋나면 그
 * 자리에서 걸리므로, 읽는 쪽과 만드는 쪽이 사이좋게 같이 틀릴 수가 없다.
 *
 * ── 여기서 재는 것 ──────────────────────────────────────────────────────
 *
 *   · 스키마를 파일에서 읽어다 그대로 쓰는가 (우리가 표를 안 들고 있는가)
 *   · 쪽 · 틀 · 글상자가 짜임 그대로 나오는가, 차례가 position 대로인가
 *   · 안 쓰는 칸을 **지나가되 자리를 안 잃는가** — 이게 틀리면 뒤가 전부 헛것
 *   · 모르는 칸 번호를 만나면 조용히 계속 읽지 않고 **멈추는가**
 *   · 남이 적어 놓은 개수로 우리 메모리를 정하지 않는가
 *   · zstd 로 눌린 파일에서, 못 풀 때 **파일 탓으로 안 돌리는가**
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as zlib from 'node:zlib';
import { makeZip } from '../src/pack/zip.js';
import { 읽개, 스키마읽기, 알맹이읽기 } from '../src/tools/kiwi.js';
import {
  readFig, isFigPath, summarize, fig는못고침, 통가르기, zstd있나, zstd안내,
} from '../src/tools/fig.js';
import { 마크다운, 읽는갈래, 바꿀수있나 } from '../src/tools/doc2md.js';
import { runTool } from '../src/tools/index.js';
import { makeScope } from '../src/safety/guard.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 적어둘것 = [];

const root = mkdtempSync(join(tmpdir(), 'deel-fig-'));

// ══ 만드는 쪽 — Kiwi 명세대로 ═══════════════════════════════════════════

const 실수판 = new DataView(new ArrayBuffer(4));

class 쓰개 {
  constructor() { this.a = []; }

  byte(v) { this.a.push(v & 255); return this; }

  varuint(v) {
    let x = v >>> 0;
    do {
      let b = x & 127;
      x >>>= 7;
      if (x) b |= 128;
      this.a.push(b);
    } while (x);
    return this;
  }

  /** 지그재그 — 부호를 맨 아래 비트로 접는다. */
  varint(v) { return this.varuint(v < 0 ? ((~v) << 1) | 1 : v << 1); }

  /** Kiwi 는 지수부를 앞 바이트로 돌려 놓는다. 그래야 0 이 한 바이트다. */
  varfloat(v) {
    실수판.setFloat32(0, v, true);
    const bits = ((실수판.getUint32(0, true) >>> 23) | (실수판.getUint32(0, true) << 9)) >>> 0;
    if ((bits & 255) === 0) return this.byte(0);
    this.a.push(bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255);
    return this;
  }

  string(s) {
    for (const b of Buffer.from(String(s), 'utf8')) this.a.push(b);
    this.a.push(0);
    return this;
  }

  buf() { return Buffer.from(this.a); }
}

// ══ 1. 명세가 정한 바이트에 못을 박는다 ═════════════════════════════════
trace('1-바이트');
{
  const 바이트 = (fn) => { const w = new 쓰개(); fn(w); return [...w.buf()]; };
  const 같나 = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  check('★ varuint(300) 은 AC 02', 같나(바이트((w) => w.varuint(300)), [0xac, 0x02]));
  check('varuint(0) 은 한 바이트', 같나(바이트((w) => w.varuint(0)), [0x00]));
  check('★ varint(-1) 은 01 (지그재그)', 같나(바이트((w) => w.varint(-1)), [0x01]));
  check('varint(1) 은 02', 같나(바이트((w) => w.varint(1)), [0x02]));
  check('★ varfloat(1.0) 은 7F 00 00 00 (지수부가 앞으로)',
    같나(바이트((w) => w.varfloat(1)), [0x7f, 0x00, 0x00, 0x00]));
  check('★ varfloat(0) 은 한 바이트', 같나(바이트((w) => w.varfloat(0)), [0x00]));
  check('문자열은 0 으로 끝난다', 같나(바이트((w) => w.string('hi')), [0x68, 0x69, 0x00]));

  // 읽는 쪽이 그 바이트를 그대로 되돌려 놓는가.
  const w = new 쓰개();
  w.varuint(300).varint(-77).varfloat(1.5).varfloat(0).varfloat(-0.25).string('한글 ok').byte(7);
  const r = new 읽개(w.buf());
  check('★ 되돌려 읽으면 같은 값이 나온다',
    r.varuint() === 300 && r.varint() === -77 && r.varfloat() === 1.5
    && r.varfloat() === 0 && r.varfloat() === -0.25 && r.문자열() === '한글 ok' && r.바이트() === 7);
  check('다 읽고 나면 남는 것이 없다', r.남은 === 0, `남은 ${r.남은}`);

  let 넘었나 = false;
  try { new 읽개(Buffer.from([0x80])).varuint(); } catch { 넘었나 = true; }
  check('★ 바이트가 모자라면 0 을 지어내지 않고 던진다', 넘었나);
}

// ══ 2. 스키마 — 파일이 제 읽는 법을 지고 온다 ═══════════════════════════
trace('2-스키마');

const T = { bool: -1, byte: -2, int: -3, uint: -4, float: -5, string: -6 };
const 갈래번호 = { ENUM: 0, STRUCT: 1, MESSAGE: 2 };

/** 정의 목록을 Kiwi 스키마 바이트로. */
function 스키마쓰기(정의들) {
  const w = new 쓰개();
  w.varuint(정의들.length);
  for (const d of 정의들) {
    w.string(d.이름).byte(갈래번호[d.갈래]).varuint(d.칸들.length);
    for (const f of d.칸들) w.string(f.이름).varint(f.형).byte(f.배열 ? 1 : 0).varuint(f.값);
  }
  return w.buf();
}

/* Figma 스키마의 뼈대만 옮겨 놓은 것. 번호가 곧 `형` 값이다. */
const GUID = 0; const PARENTINDEX = 1; const VECTOR = 2; const NODETYPE = 3;
const TEXTDATA = 4; const BLOB = 5; const NODECHANGE = 6;

const 정의들 = [
  { 이름: 'GUID', 갈래: 'STRUCT', 칸들: [
    { 이름: 'sessionID', 형: T.uint, 배열: false, 값: 0 },
    { 이름: 'localID', 형: T.uint, 배열: false, 값: 0 },
  ] },
  { 이름: 'ParentIndex', 갈래: 'STRUCT', 칸들: [
    { 이름: 'guid', 형: GUID, 배열: false, 값: 0 },
    { 이름: 'position', 형: T.string, 배열: false, 값: 0 },
  ] },
  { 이름: 'Vector', 갈래: 'STRUCT', 칸들: [
    { 이름: 'x', 형: T.float, 배열: false, 값: 0 },
    { 이름: 'y', 형: T.float, 배열: false, 값: 0 },
  ] },
  { 이름: 'NodeType', 갈래: 'ENUM', 칸들: [
    { 이름: 'NONE', 형: 0, 배열: false, 값: 0 },
    { 이름: 'DOCUMENT', 형: 0, 배열: false, 값: 1 },
    { 이름: 'CANVAS', 형: 0, 배열: false, 값: 2 },
    { 이름: 'FRAME', 형: 0, 배열: false, 값: 3 },
    { 이름: 'TEXT', 형: 0, 배열: false, 값: 4 },
    { 이름: 'RECTANGLE', 형: 0, 배열: false, 값: 5 },
  ] },
  { 이름: 'TextData', 갈래: 'MESSAGE', 칸들: [
    { 이름: 'characters', 형: T.string, 배열: false, 값: 1 },
    { 이름: 'characterStyleIDs', 형: T.uint, 배열: true, 값: 2 },
  ] },
  { 이름: 'Blob', 갈래: 'MESSAGE', 칸들: [
    { 이름: 'bytes', 형: T.byte, 배열: true, 값: 1 },
  ] },
  { 이름: 'NodeChange', 갈래: 'MESSAGE', 칸들: [
    { 이름: 'guid', 형: GUID, 배열: false, 값: 1 },
    { 이름: 'parentIndex', 형: PARENTINDEX, 배열: false, 값: 2 },
    { 이름: 'type', 형: NODETYPE, 배열: false, 값: 3 },
    { 이름: 'name', 형: T.string, 배열: false, 값: 4 },
    { 이름: 'visible', 형: T.bool, 배열: false, 값: 5 },
    { 이름: 'size', 형: VECTOR, 배열: false, 값: 6 },
    { 이름: 'textData', 형: TEXTDATA, 배열: false, 값: 7 },
    { 이름: 'vectorNetworkBlob', 형: T.float, 배열: true, 값: 8 },
  ] },
  { 이름: 'Message', 갈래: 'MESSAGE', 칸들: [
    { 이름: 'nodeChanges', 형: NODECHANGE, 배열: true, 값: 1 },
    { 이름: 'blobs', 형: BLOB, 배열: true, 값: 2 },
  ] },
];

{
  const s = 스키마읽기(스키마쓰기(정의들));
  check('★ 스키마를 파일에서 읽어 온다 — 우리는 표를 안 들고 있다',
    s.정의들.length === 정의들.length, `정의 ${s.정의들.length}개`);
  check('갈래를 제대로 가른다',
    s.정의들[GUID].갈래 === 'STRUCT' && s.정의들[NODETYPE].갈래 === 'ENUM'
    && s.정의들[TEXTDATA].갈래 === 'MESSAGE');
  check('칸 이름 · 번호 · 배열 여부가 그대로 온다',
    s.정의들[NODECHANGE].칸들[7].이름 === 'vectorNetworkBlob'
    && s.정의들[NODECHANGE].칸들[7].배열 === true
    && s.정의들[NODECHANGE].칸들[7].값 === 8);
  check('이름으로 정의를 찾을 수 있다', s.이름표.get('Message') === 정의들.length - 1);

  let 막았나 = false;
  try { 스키마읽기(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x0f])); } catch { 막았나 = true; }
  check('★ 정의가 수십억 개라고 적혀 있으면 안 만들고 멈춘다', 막았나);
}

// ══ 3. 알맹이 — 짜임 그대로 나오나 ══════════════════════════════════════
trace('3-알맹이');

const 스키마몸 = 스키마쓰기(정의들);
const 스키마 = 스키마읽기(스키마몸);

/** NodeChange 하나를 쓴다. 없는 칸은 안 쓴다 — MESSAGE 는 빠져도 된다. */
function 노드쓰기(w, n) {
  w.varuint(1).varuint(0).varuint(n.id);                       // guid
  if (n.부모 !== undefined) {
    w.varuint(2).varuint(0).varuint(n.부모).string(n.자리);      // parentIndex
  }
  w.varuint(3).varuint(n.형);                                   // type
  if (n.이름 !== undefined) w.varuint(4).string(n.이름);
  if (n.보임 !== undefined) w.varuint(5).byte(n.보임 ? 1 : 0);
  if (n.크기) w.varuint(6).varfloat(n.크기[0]).varfloat(n.크기[1]);
  if (n.글 !== undefined) {
    // 글상자 안에는 우리가 안 쓰는 칸(characterStyleIDs)이 같이 온다.
    // 그것을 지나가면서 자리를 잃지 않아야 뒤 칸이 맞는다.
    w.varuint(7).varuint(1).string(n.글).varuint(2).varuint(3).varuint(9).varuint(9).varuint(9);
    w.varuint(0);
  }
  if (n.도형점) {
    w.varuint(8).varuint(n.도형점);
    for (let i = 0; i < n.도형점; i += 1) w.varfloat(i * 0.5);
  }
  w.varuint(0);
}

const 노드들 = [
  // 일부러 뒤죽박죽으로 넣는다 — 자식이 부모보다 먼저 나와도 엮여야 한다.
  { id: 5, 부모: 4, 자리: 'b', 형: 4, 이름: '이메일 라벨', 글: '이메일\n주소' },
  { id: 4, 부모: 2, 자리: 'a', 형: 3, 이름: '로그인', 크기: [375, 812], 도형점: 4000 },
  { id: 1, 형: 1, 이름: 'Document' },
  { id: 7, 부모: 3, 자리: 'a', 형: 3, 이름: '아이콘 모음' },
  { id: 3, 부모: 1, 자리: 'b', 형: 2, 이름: '아이콘' },
  { id: 6, 부모: 4, 자리: 'c', 형: 5, 이름: '밑줄', 보임: false },
  { id: 2, 부모: 1, 자리: 'a', 형: 2, 이름: 'Page 1' },
  { id: 8, 부모: 4, 자리: 'a', 형: 4, 이름: '제목', 글: '로그인하기' },
];

function 알맹이쓰기() {
  const w = new 쓰개();
  w.varuint(1).varuint(노드들.length);
  for (const n of 노드들) 노드쓰기(w, n);
  // 안 쓰는 큰 덩어리. 지나가는 길이 틀리면 여기서 통째로 어긋난다.
  w.varuint(2).varuint(2);
  for (const 크기 of [50000, 120]) {
    w.varuint(1).varuint(크기);
    for (let i = 0; i < 크기; i += 1) w.byte(i & 255);
    w.varuint(0);
  }
  w.varuint(0);
  return w.buf();
}

const 알맹이몸 = 알맹이쓰기();

{
  const 것 = 알맹이읽기(스키마, 알맹이몸, 'Message',
    (_d, f) => ['nodeChanges', 'guid', 'sessionID', 'localID', 'parentIndex', 'position',
      'type', 'name', 'visible', 'size', 'x', 'y', 'textData', 'characters'].includes(f));

  check('★ 도형을 다 읽는다', 것.nodeChanges?.length === 노드들.length,
    `${것.nodeChanges?.length}개`);
  check('★ ENUM 은 숫자가 아니라 이름으로 온다',
    것.nodeChanges[2].type === 'DOCUMENT' && 것.nodeChanges[0].type === 'TEXT',
    String(것.nodeChanges[2].type));
  check('STRUCT 는 칸 순서대로 읽는다 (번호가 없다)',
    Math.round(것.nodeChanges[1].size.x) === 375 && Math.round(것.nodeChanges[1].size.y) === 812);
  check('MESSAGE 안의 MESSAGE 도 읽는다',
    것.nodeChanges[7].textData.characters === '로그인하기');

  /*
   * ★★ 여기가 이 파일에서 제일 중요한 검사다.
   *
   * 안 담는 칸도 **바이트는 지나가야** 한다. 한 칸이라도 덜 지나가면 그
   * 다음 칸부터 전부 다른 값이 되고, 그런데도 오류는 안 난다 — 숫자가 그냥
   * 다른 숫자로 읽힐 뿐이다. 뒤에 큰 덩어리(blobs)를 일부러 붙여 둔 이유가
   * 이것이다. 자리를 잃었으면 여기서 끝까지 못 간다.
   */
  check('★★ 안 담는 칸을 지나가되 자리를 안 잃는다 (5만 바이트 덩어리 뒤까지)',
    것.nodeChanges.at(-1).textData?.characters === '로그인하기'
    && 것.blobs === undefined);
  check('안 담기로 한 칸은 담기지 않는다', 것.nodeChanges[1].vectorNetworkBlob === undefined);

  let 멈췄나 = false;
  try {
    const w = new 쓰개();
    w.varuint(99).varuint(1).varuint(0);
    알맹이읽기(스키마, w.buf(), 'Message');
  } catch (err) { 멈췄나 = /모르는 칸 번호/.test(err.message); }
  check('★★ 모르는 칸 번호를 만나면 짐작으로 계속 읽지 않고 멈춘다', 멈췄나);

  let 막았나 = false;
  try {
    const w = new 쓰개();
    w.varuint(1).varuint(4000000000);
    알맹이읽기(스키마, w.buf(), 'Message');
  } catch (err) { 막았나 = /개수가 남은 바이트보다/.test(err.message); }
  check('★★ 남이 적어 놓은 개수로 우리 메모리를 정하지 않는다', 막았나);
}

// ══ 4. 통 — fig-kiwi 머리와 덩이들 ══════════════════════════════════════
trace('4-통');

/** canvas.fig 한 통을 만든다. */
function 통짜기(스키마덩이, 알맹이덩이, { 머리 = 'fig-kiwi', 판 = 15 } = {}) {
  const 조각 = [Buffer.from(머리, 'latin1'), Buffer.alloc(4)];
  조각[1].writeUInt32LE(판, 0);
  for (const 덩이 of [스키마덩이, 알맹이덩이]) {
    const 길이 = Buffer.alloc(4);
    길이.writeUInt32LE(덩이.length, 0);
    조각.push(길이, 덩이);
  }
  return Buffer.concat(조각);
}

const 눌러 = (b) => zlib.deflateRawSync(b);

{
  const 통 = 통짜기(눌러(스키마몸), 눌러(알맹이몸));
  const g = 통가르기(통);
  check('★ fig-kiwi 머리를 알아본다', g.판 === 15 && g.덩이들.length === 2);

  const 나쁨 = Buffer.concat([Buffer.from('PKabcd', 'latin1'), Buffer.alloc(8)]);
  let 말 = '';
  try { 통가르기(나쁨); } catch (err) { 말 = err.message; }
  check('★ Figma 알맹이가 아니면 앞머리를 그대로 보여 준다', /앞머리가/.test(말), 말);

  const 잘린것 = 통.subarray(0, 20);
  let 말2 = '';
  try { 통가르기(잘린것); } catch (err) { 말2 = err.message; }
  check('★ 덩이 길이가 파일보다 길면 그 자리에서 멈춘다',
    /파일보다 깁니다|덩이가 \d개뿐/.test(말2), 말2);
}

// ══ 5. .fig 한 장을 통째로 읽는다 ═══════════════════════════════════════
trace('5-읽기');

/*
 * ── zstd 시험감은 안 눌러서 짓는다 ──────────────────────────────────────
 *
 * 여기가 Node 20 에서 이 파일을 통째로 죽이던 자리다. 시험감을
 * `zlib.zstdCompressSync` 로 만들고 있었는데, 그 함수는 **22.15 부터** 있다.
 * 이 프로그램의 바닥은 20 이라 거기서는 없는 함수를 부르고 그 자리에서 죽는다.
 *
 * 하필 죽는 자리가 「zstd 를 못 풀면 그렇게 말한다」 를 재는 검사다. 그
 * 갈래는 제품 코드가 제대로 갈라 놨는데(zstd있나), **재려던 자리에 닿기도
 * 전에** 검사가 죽어서 아무것도 못 쟀다. 20 두 판만 빨갛고 22·24 는 초록이라,
 * 화면만 보면 「어쩌다 한 판이 이상하다」 로 읽힌다.
 *
 * 그래서 틀을 손으로 짠다. zstd 규격(RFC 8878 §3.1)에는 **안 눌린 덩이**
 * (raw block)가 있다 — 매직 넉 자와 머리 뒤에 원문을 그대로 붙인 것도
 * 규격에 맞는 zstd 파일이고, 푸는 쪽은 그것을 여느 zstd 와 똑같이 푼다.
 * 누르는 함수가 없어도 만들 수 있다는 것이 요점이다.
 *
 *   매직        28 B5 2F FD
 *   머리 한 칸  0xA0 — 한 덩이짜리(Single_Segment) · 길이는 넉 자로
 *   길이 넉 자  원문 길이 (리틀엔디언)
 *   덩이 머리   세 자 · 0비트=마지막인가 · 1~2비트=갈래(0=안 눌림) · 나머지=길이
 *
 * 덩이 하나에 128KB 를 넘길 수 없어서 그보다 크면 나눠 담는다.
 */
const zstd한덩이최대 = 128 * 1024;

function zstd틀(글) {
  const 몸 = Buffer.isBuffer(글) ? 글 : Buffer.from(글);
  const 머리 = Buffer.alloc(9);
  머리.writeUInt32LE(0xfd2fb528, 0);   // 매직
  머리[4] = 0xa0;                       // 한 덩이짜리 · 길이 넉 자
  머리.writeUInt32LE(몸.length, 5);     // 원문 길이

  const 조각들 = [머리];
  // 빈 글도 덩이가 하나는 있어야 한다 — 「마지막」 표시를 실을 자리가 없으면
  // 규격에 안 맞는 틀이 된다.
  let 자리 = 0;
  do {
    const 끊을것 = 몸.subarray(자리, 자리 + zstd한덩이최대);
    자리 += 끊을것.length;
    const 마지막 = 자리 >= 몸.length;
    const 덩이머리 = Buffer.alloc(3);
    // 0비트 마지막 · 1~2비트 갈래(0 = 안 눌림) · 3비트부터 길이
    덩이머리.writeUIntLE((마지막 ? 1 : 0) | (끊을것.length << 3), 0, 3);
    조각들.push(덩이머리, 끊을것);
  } while (자리 < 몸.length);

  return Buffer.concat(조각들);
}

function fig만들기(이름, { 눌림 = 'deflate', 메타 = true, 알맹이 = true } = {}) {
  // zstd 가 있는 판에서는 진짜로 누른 것을 쓴다 — 요즘 파일이 그 모양이다.
  // 없는 판에서는 안 눌린 덩이로 짠 틀을 쓴다. 어느 쪽이든 진짜 zstd 파일이다.
  const zstd로 = (b) => (zstd있나() ? zlib.zstdCompressSync(b) : zstd틀(b));
  const 눌리기 = 눌림 === 'zstd' ? zstd로 : 눌러;
  const 항목 = [];
  if (알맹이) {
    항목.push({ name: 'canvas.fig', data: 통짜기(눌리기(스키마몸), 눌리기(알맹이몸)) });
  }
  if (메타) {
    항목.push({ name: 'meta.json', data: Buffer.from(JSON.stringify({ file_name: '로그인 시안', client_meta: {} }), 'utf8') });
  }
  항목.push({ name: 'thumbnail.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
  항목.push({ name: 'images/aabbcc', data: Buffer.from('img') });
  항목.push({ name: 'images/ddeeff', data: Buffer.from('img') });
  const 자리 = join(root, 이름);
  writeFileSync(자리, makeZip(항목));
  return 자리;
}

const 시안 = fig만들기('로그인.fig');

{
  check('★ .fig 를 알아본다', isFigPath('a/b/시안.fig') && !isFigPath('a.figma'));

  const r = readFig(시안);
  check('★★ .fig 를 읽는다', r.ok === true, r.ok ? '' : r.error);

  if (r.ok) {
    const 이름들 = r.덩이들.map((d) => d.이름);
    check('★ 쪽마다 한 덩이로 나온다 — 쪽 이름 그대로',
      이름들.join(' · ') === '개요 · Page 1 · 아이콘', 이름들.join(' · '));

    const 개요 = r.덩이들[0].문단들.join('\n');
    check('meta.json 의 파일 이름을 낸다', /로그인 시안/.test(개요), 개요.split('\n')[0]);
    check('쪽 수 · 도형 수를 낸다', /쪽 2개 · 도형 8개/.test(개요));
    check('★ 쓰인 그림이 몇 개인지 말한다 — 우리가 안 푸는 것도 말한다',
      /그림 2개/.test(개요) && /안 풉니다/.test(개요));
    check('★ 무엇을 안 내는지 미리 말한다', /색·그림자·글꼴은 안 냅니다/.test(개요));

    const 쪽1 = r.덩이들[1].문단들;
    check('★★ 틀 밑에 글상자가 들어간다 — 짜임이 들여쓰기로 남는다',
      쪽1[0] === '- FRAME · 로그인 375×812'
      && 쪽1[1].startsWith('  - TEXT · 제목'), 쪽1.slice(0, 2).join(' / '));
    check('★★ 차례는 position 이 정한다 (제목 → 이메일 → 밑줄)',
      쪽1[1].includes('제목') && 쪽1[2].includes('이메일 라벨') && 쪽1[3].includes('밑줄'),
      쪽1.join(' / '));
    check('★ 글상자 안의 글이 그대로 실린다', 쪽1[1].includes('"로그인하기"'), 쪽1[1]);
    check('★ 여러 줄 글은 한 줄로 접는다 — 나무 그림이 안 부서지게',
      쪽1[2].includes('"이메일 주소"'), 쪽1[2]);
    check('★ 숨긴 것은 숨겼다고 적는다 — 안 보이는 것을 있는 것처럼 안 넘긴다',
      쪽1[3].includes('(숨김)'), 쪽1[3]);
    check('크기가 없는 것에는 크기를 안 적는다', !쪽1[1].includes('×'), 쪽1[1]);

    check('둘째 쪽도 그대로 나온다',
      r.덩이들[2].문단들[0] === '- FRAME · 아이콘 모음', r.덩이들[2].문단들[0]);
    check('한 줄 요약', summarize(r) === 'fig · 쪽 2개 · 도형 8개', summarize(r));
  }
}

// ══ 6. zstd — 못 풀 때 파일 탓으로 안 돌린다 ════════════════════════════
trace('6-zstd');
{
  적어둘것.push(`이 Node(${process.version}) 에 zstd: ${zstd있나() ? '있음' : '없음'}`);

  if (zstd있나()) {
    const z = fig만들기('zstd.fig', { 눌림: 'zstd' });
    const r = readFig(z);
    check('★★ zstd 로 눌린 .fig 도 그대로 읽힌다 (요즘 파일이 이쪽이다)',
      r.ok === true && r.덩이들.length === 3, r.ok ? '' : r.error);
  } else {
    const z = fig만들기('zstd.fig', { 눌림: 'zstd' });
    const r = readFig(z);
    check('★★ zstd 를 못 풀면 그렇게 말한다', r.ok === false && /zstd/.test(r.error), r.error);
  }


  /*
   * 손으로 짠 틀이 **진짜 zstd 인가.**
   *
   * 이 틀은 zstd 가 없는 판에서 쓰는 시험감이다. 그런데 그 판에서는 진짜인지
   * 확인할 방법이 없다 — 풀 함수가 없으니까. 그래서 **있는 판에서 대신 잰다.**
   * 여기가 초록이면 없는 판이 쓰는 시험감도 규격에 맞는 것이다.
   *
   * 이걸 안 재면 「검사가 도는데 시험감이 가짜」 인 상태가 20 에서만 생기고,
   * 그건 아무 화면에도 안 나타난다.
   */
  if (zstd있나()) {
    const 재볼길이 = [0, 1, 100, 5000, 70000, 200000];
    const 어긋난것 = [];
    for (const n of 재볼길이) {
      const 원문 = Buffer.alloc(n, 0x41);
      try {
        const 되돌린것 = zlib.zstdDecompressSync(zstd틀(원문));
        if (!되돌린것.equals(원문)) 어긋난것.push(`${n}바이트 — 내용이 다름`);
      } catch (e) {
        어긋난것.push(`${n}바이트 — ${e.message}`);
      }
    }
    check('★★ 손으로 짠 zstd 틀이 진짜 zstd 다 (없는 판이 쓸 시험감)',
      어긋난것.length === 0, 어긋난것.join(' · ') || `${재볼길이.length}가지 길이`);
    // 128KB 를 넘으면 덩이를 나눈다 — 나눈 것이 실제로 여러 덩이인지도 본다.
    check('  128KB 를 넘으면 덩이를 나눈다',
      zstd틀(Buffer.alloc(200000)).length > zstd틀(Buffer.alloc(100000)).length + 100000, '');
  } else {
    적어둘것.push('손으로 짠 zstd 틀이 진짜인지는 이 판에서 못 잽니다 — 풀 함수가 없습니다');
  }

  const 안내 = zstd안내();
  check('★★ 「깨진 파일」 이라고 안 한다 — 파일은 멀쩡하고 Node 가 못 푸는 것이다',
    /파일이 깨진 것이 아닙니다/.test(안내));
  check('★ 어느 판부터 되는지 적는다', /22\.15/.test(안내));
  check('★ 그럼 무엇을 하면 되는지까지 적는다', /고치는 법/.test(안내));
  check('지금 Node 판을 같이 적는다', 안내.includes(process.version));
}

// ══ 7. 안 되는 것을 안 된다고 말하는가 ══════════════════════════════════
trace('7-못읽을때');
{
  const 빈것 = join(root, '알맹이없음.fig');
  writeFileSync(빈것, makeZip([{ name: 'meta.json', data: Buffer.from('{}') }]));
  const r = readFig(빈것);
  check('★ canvas.fig 가 없으면 안에 무엇이 있었는지 같이 말한다',
    r.ok === false && /canvas\.fig 가 없습니다/.test(r.error) && /meta\.json/.test(r.error), r.error);
  check('다시 열어 봐야 소용없다고 못 박는다', r.끝났다 === true);

  const 남 = join(root, '남의것.fig');
  writeFileSync(남, Buffer.from('이건 그냥 글입니다. zip 도 fig 도 아닙니다.', 'utf8'));
  const r2 = readFig(남);
  check('★ .fig 가 아닌 것을 .fig 라고 부른 경우', r2.ok === false, r2.error);

  const 없 = readFig(join(root, '없는파일.fig'));
  check('없는 파일은 못 읽었다고 한다', 없.ok === false && /못 읽었습니다/.test(없.error));

  const 말 = fig는못고침('시안/로그인.fig');
  check('★ 고치려 들면 왜 안 되는지와 그럼 어떻게 하는지를 말한다',
    /읽기만 됩니다/.test(말) && /Figma 에서 고치고/.test(말), 말.split('\n')[0]);
  check('★ 원본은 안 건드렸다고 못 박는다', /안 건드렸습니다/.test(말));
}

// ══ 8. doc2md 와 이어지나 ═══════════════════════════════════════════════
trace('8-doc2md');
{
  check('★ doc2md 가 .fig 를 맡는다', 바꿀수있나(시안) === true);
  check('직접 읽는 갈래 목록에 fig 가 있다', 읽는갈래.includes('fig'), 읽는갈래.join('·'));

  const r = 마크다운(시안);
  check('★★ .fig 가 마크다운으로 나온다', r.ok === true, r.ok ? '' : r.error);
  if (r.ok) {
    const 줄 = r.md.split('\n');
    check('파일 이름이 제목으로 남는다', 줄[0] === '# 로그인.fig', 줄[0]);
    check('★ 쪽이 `## 쪽이름` 이 된다', r.md.includes('\n## Page 1') && r.md.includes('\n## 아이콘'));
    check('★★ 나무가 한 덩이로 붙어 나온다 — 목록은 사이가 벌어지면 들여쓰기가 뜻을 잃는다',
      r.md.includes([
        '- FRAME · 로그인 375×812',
        '  - TEXT · 제목 "로그인하기"',
      ].join('\n')),
      JSON.stringify(r.md.split('## Page 1')[1]?.slice(0, 70)));
    check('한 줄 요약이 붙는다', /fig · 쪽 2개/.test(r.summary), r.summary);
  }
}

// ══ 9. Read 도구로 열리나 ═══════════════════════════════════════════════
trace('9-Read로');
{
  const c = {
    scope: makeScope(root),
    history: { snapshot() {} },
    audit: { tool() {} },
    seen: new Set(),
    모델컨텍스트: 128000,
  };

  const r = await runTool('Read', { file_path: '로그인.fig' }, c);
  check('★★ Read 가 .fig 를 연다 — 「이진 파일」 로 끝내지 않는다',
    !r.error && r.content.includes('FRAME · 로그인'), r.error ?? String(r.content).slice(0, 60));
  check('★ 무엇을 안 냈는지 본문에 같이 적는다 — 다 봤다고 여기지 않게',
    /그림·색·글꼴은 안 나옵니다/.test(r.content ?? ''));
  check('★ 고칠 수 없다고 같이 말한다', /고칠 수 없/.test(r.content ?? ''));
  check('요약이 갈래를 말한다', /^fig · /.test(r.summary ?? ''), r.summary);
  check('★ seen 에 안 오른다 — 고칠 물건이 아니다', !c.seen.has(join(root, '로그인.fig')));

  /*
   * ★★ 고치려 드는 길을 또렷하게 막는다.
   *
   * 일반 「바이너리라 못 씁니다」 로 넘기면 왜 안 되는지가 안 실린다. 그러면
   * 모델은 우회로를 찾고, 실제로 그 우회로가 원본을 덮어쓴 적이 있다(hwp).
   */
  const w = await runTool('Write', { file_path: '로그인.fig', content: 'x' }, c);
  check('★★ Write 는 시안이라 못 고친다고 말한다',
    !!w.error && /시안은 이 도구로 고칠 수 없습니다/.test(w.error), w.error);
  const e = await runTool('Edit', { file_path: '로그인.fig', old_string: 'a', new_string: 'b' }, c);
  check('★★ Edit 도 같다', !!e.error && /시안은 이 도구로 고칠 수 없습니다/.test(e.error), e.error);
  check('★ 원본이 그대로 있다', readFig(시안).ok === true);
}

// ── 마무리 ──────────────────────────────────────────────────────────────
trace('9-치움');
rmSync(root, { recursive: true, force: true });

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\nFigma .fig 읽기 검사  ${D}(스키마를 파일에서 받아 오는가 · 자리를 안 잃는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
for (const 글 of 적어둘것) console.log(`  ${D}· ${글}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;

