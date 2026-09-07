/**
 * Figma `.fig` 읽기 — 화면 하나가 어떤 조각으로 짜였는지.
 *
 * ── 왜 읽나 ────────────────────────────────────────────────────────────
 *
 * 「이 시안대로 만들어 줘」 하면서 `.fig` 를 건네는 일이 실제로 잦다. 그런데
 * 지금까지 그 파일은 여기서 끝났다 — 「이진 파일이라 못 읽습니다」. 그러면
 * 사람이 화면을 캡처해서 다시 붙이거나, 글자를 하나씩 옮겨 적는다.
 *
 * 안에 있는 것은 그림만이 아니다. **틀 이름 · 글 · 크기 · 겹친 차례**가 다
 * 글자로 들어 있다. 「로그인」 이라는 틀 밑에 「이메일」 「비밀번호」 라는
 * 글상자가 있고 폭이 375 라는 것 — 코드를 짜는 데 필요한 것은 대부분 그거다.
 *
 * ── 무엇을 안 하나 ─────────────────────────────────────────────────────
 *
 * 그림은 안 그린다. 색·그림자·글꼴 굵기도 안 낸다. 낼 수야 있지만 그걸 다
 * 실으면 창이 그것만으로 찬다. **이름과 글과 짜임**까지가 이 읽개의 몫이다.
 *
 * 쓰기는 아예 없다. 글로 왕복시킨 시안은 시안이 아니다.
 *
 * ── 어떻게 생겼나 ──────────────────────────────────────────────────────
 *
 *   .fig  =  zip
 *            ├ canvas.fig      ← 알맹이. 이게 Kiwi 다
 *            ├ meta.json       ← 파일 이름 · 만든 판
 *            ├ thumbnail.png   ← 미리보기
 *            └ images/…        ← 쓰인 그림들
 *
 *   canvas.fig =  "fig-kiwi"(8바이트)  판:u32
 *                 덩이길이:u32 덩이   ← 스키마
 *                 덩이길이:u32 덩이   ← 알맹이
 *
 * 두 덩이는 눌려 있다. 예전 파일은 deflate, 요즘 파일은 zstd 다. 앞 네
 * 바이트를 보고 가른다 — 확장자나 판 번호로 짐작하지 않는다. 짐작이 틀리면
 * 「파일이 깨졌다」 는 엉뚱한 말이 나간다.
 *
 * ── zstd 와 Node 판 ────────────────────────────────────────────────────
 *
 * Node 가 zstd 를 들고 온 것은 22.15 부터다. 이 프로그램의 바닥은 20 이다.
 * 그래서 zstd 로 눌린 파일을 Node 20 에서 열면 **못 연다.** 그때 「깨진
 * 파일입니다」 라고 하면 사람은 파일을 의심하며 시간을 버린다. 무엇이
 * 없어서 못 하는지, 그럼 무엇을 하면 되는지까지 말한다.
 */
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { inflateRawSync, inflateSync } from 'node:zlib';
import * as zlib from 'node:zlib';

import { readZip, looksZip } from '../pack/zip.js';
import { 스키마읽기, 알맹이읽기 } from './kiwi.js';

const 머리들 = ['fig-kiwi', 'fig-jam.'];

/** 이 파일이 `.fig` 인가. */
export function isFigPath(p) {
  return extname(String(p ?? '')).toLowerCase() === '.fig';
}

/**
 * 우리가 담아 두는 칸 이름.
 *
 * Figma 스키마에는 칸이 수백 개 있고 그중 대부분이 도형 좌표다. 전부
 * 객체로 만들면 큰 파일 하나에 몇백 MB 가 된다. 바이트는 그대로 지나가되
 * **담기는 것만 고른다** — 이름으로 고르므로 새 판이 칸을 늘려도 안 깨진다.
 */
const 담을칸 = new Set([
  'guid', 'sessionID', 'localID',
  'parentIndex', 'position',
  'type', 'name', 'visible',
  'size', 'x', 'y',
  'textData', 'characters',
]);

/**
 * 뿌리에서 「도형 목록」 칸을 찾는다.
 *
 * 이름으로 `nodeChanges` 를 찾되, **못 찾으면 생김새로 찾는다** — 배열이고,
 * 그 알맹이 정의에 `guid` 칸이 있는 것. 이름은 Figma 가 바꿀 수 있지만
 * 「도형마다 고유 번호가 있다」 는 것은 이 형식의 뼈대라 안 바뀐다.
 *
 * 이름만 믿었다가 못 찾으면 「도형이 하나도 없습니다」 라는 거짓말이 나간다.
 */
function 도형칸찾기(스키마, 뿌리이름) {
  const d = 스키마.정의들[스키마.이름표.get(뿌리이름)];
  const 배열칸 = (d?.칸들 ?? []).filter((f) => f.배열 && f.형 >= 0);
  const 이름난것 = 배열칸.find((f) => f.이름 === 'nodeChanges');
  if (이름난것) return 이름난것.이름;
  const 닮은것 = 배열칸.find((f) => 스키마.정의들[f.형]?.칸들?.some((x) => x.이름 === 'guid'));
  return 닮은것?.이름 ?? null;
}

/* 이보다 많으면 그림에 다 못 싣는다. 자르되 잘랐다고 말한다. */
const 노드최대 = 20000;

/** 앞 네 바이트로 무엇에 눌렸는지 본다. 판 번호로 짐작하지 않는다. */
function 눌린방식(buf) {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0xfd2fb528) return 'zstd';
  // zlib 은 첫 바이트가 0x78 이고 두 바이트를 31 로 나누면 떨어진다.
  if (buf.length >= 2 && buf[0] === 0x78 && ((buf[0] << 8) + buf[1]) % 31 === 0) return 'zlib';
  return 'deflate';
}

export const zstd있나 = () => typeof zlib.zstdDecompressSync === 'function';

/**
 * zstd 가 없을 때 하는 말.
 *
 * 「깨진 파일입니다」 라고 하면 사람은 파일을 의심하며 시간을 버린다. 파일은
 * 멀쩡하고 **여기 Node 가 못 푸는 것**이다. 그 둘은 하는 일이 완전히 다르다.
 */
export function zstd안내() {
  return 'zstd 로 눌린 .fig 입니다. 이 Node 에는 zstd 가 없습니다'
    + ` (지금 ${process.version} · Node 22.15 부터 들어왔습니다).\n`
    + '  파일이 깨진 것이 아닙니다 — 여기서 못 푸는 것뿐입니다.\n'
    + '  고치는 법: Node 를 22.15 이상으로 올리면 그대로 읽힙니다.';
}

/**
 * 덩이 하나를 편다.
 *
 * 상한을 **펴기 전에** 건다. 다 펴 놓고 재면 이미 늦다 — 작은 조각이 몇 GB
 * 로 부푸는 파일을 남이 만들어 줄 수 있다(zip.js 가 같은 이유로 같은 일을
 * 한다).
 */
function 펴기(덩이, 상한) {
  const 방식 = 눌린방식(덩이);
  if (방식 === 'zstd') {
    if (!zstd있나()) {
      const err = new Error(zstd안내());
      err.끝났다 = true;
      throw err;
    }
    return zlib.zstdDecompressSync(덩이, { maxOutputLength: 상한 });
  }
  if (방식 === 'zlib') return inflateSync(덩이, { maxOutputLength: 상한 });
  return inflateRawSync(덩이, { maxOutputLength: 상한 });
}

/**
 * `canvas.fig` 를 덩이 목록으로 가른다.
 *
 * @returns {{판:number, 덩이들:Buffer[]}}
 */
export function 통가르기(buf) {
  if (buf.length < 12) throw new Error('canvas.fig 가 너무 짧습니다');
  const 머리 = buf.toString('latin1', 0, 8);
  if (!머리들.includes(머리)) {
    throw new Error(`Figma 알맹이가 아닙니다 — 앞머리가 ${JSON.stringify(머리)} 입니다`);
  }
  const 판 = buf.readUInt32LE(8);

  const 덩이들 = [];
  let p = 12;
  while (p + 4 <= buf.length) {
    const 길이 = buf.readUInt32LE(p);
    p += 4;
    // 남은 것보다 길다고 적혀 있으면 그 자리에서 거짓이다. 그대로 잘라
    // 가면 뒤 덩이가 통째로 헛것이 된다.
    if (길이 > buf.length - p) throw new Error(`덩이 길이가 파일보다 깁니다 (${길이})`);
    덩이들.push(buf.subarray(p, p + 길이));
    p += 길이;
  }
  if (덩이들.length < 2) throw new Error(`덩이가 ${덩이들.length}개뿐입니다 — 스키마와 알맹이가 둘 다 있어야 합니다`);
  return { 판, 덩이들 };
}

/** guid 를 한 줄 열쇠로. 없으면 null — 뿌리 노드는 부모가 없다. */
function 열쇠(g) {
  if (!g || typeof g !== 'object') return null;
  return `${g.sessionID ?? 0}:${g.localID ?? 0}`;
}

/** 크기를 `375×812` 로. 소수점은 버린다 — 시안 치수는 정수로 읽는 게 맞다. */
function 크기말(size) {
  if (!size || typeof size !== 'object') return '';
  const w = Number(size.x);
  const h = Number(size.y);
  if (!Number.isFinite(w) || !Number.isFinite(h) || (!w && !h)) return '';
  return ` ${Math.round(w)}×${Math.round(h)}`;
}

/** 글은 한 줄로 접는다. 시안의 글상자에는 줄바꿈이 흔하다. */
function 글말(node) {
  const s = node?.textData?.characters;
  if (typeof s !== 'string' || !s.trim()) return '';
  const 한줄 = s.replace(/\s+/g, ' ').trim();
  return ` "${한줄.length > 120 ? `${한줄.slice(0, 120)}…` : 한줄}"`;
}

/**
 * 노드 목록을 부모-자식으로 엮는다.
 *
 * 차례는 `position` 이라는 글자열이 정한다 — 사이에 끼워 넣을 수 있게 만든
 * 값이라 **글자 순서가 곧 화면 순서**다. 숫자로 바꾸려 들면 안 된다.
 */
function 나무엮기(노드들) {
  const 자리표 = new Map();
  for (const n of 노드들) {
    const k = 열쇠(n.guid);
    if (k && !자리표.has(k)) 자리표.set(k, n);
  }

  const 자식표 = new Map();
  const 뿌리들 = [];
  for (const n of 노드들) {
    const 부모 = 열쇠(n.parentIndex?.guid);
    if (부모 && 자리표.has(부모)) {
      if (!자식표.has(부모)) 자식표.set(부모, []);
      자식표.get(부모).push(n);
    } else {
      뿌리들.push(n);
    }
  }
  for (const 목록 of 자식표.values()) {
    목록.sort((a, b) => String(a.parentIndex?.position ?? '').localeCompare(String(b.parentIndex?.position ?? '')));
  }
  return { 자리표, 자식표, 뿌리들 };
}

/** 한 갈래를 줄들로 편다. 깊이는 두 칸씩. */
function 가지풀기(뿌리, 자식표, 줄들, 깊이, 셈) {
  if (셈.남은 <= 0) return;
  const 들여 = '  '.repeat(Math.min(깊이, 12));
  const 갈래 = typeof 뿌리.type === 'string' ? 뿌리.type : String(뿌리.type ?? '?');
  const 이름 = String(뿌리.name ?? '').trim();
  const 숨김 = 뿌리.visible === false ? ' (숨김)' : '';
  줄들.push(`${들여}- ${갈래}${이름 ? ` · ${이름}` : ''}${크기말(뿌리.size)}${글말(뿌리)}${숨김}`);
  셈.남은 -= 1;
  for (const 아이 of 자식표.get(열쇠(뿌리.guid)) ?? []) {
    가지풀기(아이, 자식표, 줄들, 깊이 + 1, 셈);
  }
}

/**
 * `.fig` 하나를 읽는다.
 *
 * 던지지 않는다 — 깨진 파일은 도구 실행 한가운데서 만나는 것이라, 예외가
 * 나면 「파일이 깨졌다」 가 「도구가 터졌다」 로 보고된다. 다른 읽개들과
 * 같은 규칙이고, 돌려주는 모양도 같다(`덩이들`).
 *
 * @returns {{ok:true, 갈래:'fig', 덩이들:[{이름,문단들}], 말:string[], 노드수:number}
 *          |{ok:false, error:string, 끝났다?:boolean}}
 */
export function readFig(경로또는버퍼) {
  let buf;
  try {
    buf = Buffer.isBuffer(경로또는버퍼) ? 경로또는버퍼 : readFileSync(경로또는버퍼);
  } catch (err) {
    return { ok: false, error: `못 읽었습니다: ${err.message}` };
  }

  const 말 = [];
  let 알맹이;
  let 메타 = null;
  let 그림수 = 0;
  let 미리보기 = false;

  // 꾸러미로 온 것이 보통이지만, `canvas.fig` 만 따로 떨어져 오기도 한다.
  if (looksZip(buf)) {
    let 꾸러미;
    try {
      꾸러미 = readZip(buf);
    } catch (err) {
      return { ok: false, error: `.fig 꾸러미를 풀지 못했습니다 — ${err.message}` };
    }
    for (const [이름] of 꾸러미.files) {
      if (/^images\//i.test(이름)) 그림수 += 1;
      if (/^thumbnail\.png$/i.test(이름)) 미리보기 = true;
    }
    const 메타몸 = 꾸러미.files.get('meta.json');
    if (메타몸) { try { 메타 = JSON.parse(메타몸.toString('utf8')); } catch { 메타 = null; } }
    알맹이 = 꾸러미.files.get('canvas.fig');
    if (!알맹이) {
      return {
        ok: false,
        끝났다: true,
        error: '.fig 꾸러미 안에 canvas.fig 가 없습니다 — '
          + `든 것: ${[...꾸러미.files.keys()].slice(0, 8).join(' · ') || '(빈 꾸러미)'}`,
      };
    }
  } else {
    알맹이 = buf;
  }

  let 통;
  try {
    통 = 통가르기(알맹이);
  } catch (err) {
    return { ok: false, error: err.message, 끝났다: true };
  }

  const 상한 = 256 * 1024 * 1024;
  let 스키마;
  let 몸;
  try {
    스키마 = 스키마읽기(펴기(통.덩이들[0], 16 * 1024 * 1024));
    몸 = 펴기(통.덩이들[1], 상한);
  } catch (err) {
    return { ok: false, error: `.fig 알맹이를 풀지 못했습니다 — ${err.message}`, 끝났다: !!err.끝났다 };
  }

  const 뿌리이름 = 스키마.이름표.has('Message')
    ? 'Message'
    : 스키마.정의들.find((d) => d.갈래 === 'MESSAGE')?.이름;
  if (!뿌리이름) return { ok: false, error: '.fig 스키마에 읽을 시작점이 없습니다', 끝났다: true };

  const 도형칸 = 도형칸찾기(스키마, 뿌리이름);
  if (!도형칸) {
    const 있는칸 = (스키마.정의들[스키마.이름표.get(뿌리이름)]?.칸들 ?? [])
      .map((f) => f.이름).slice(0, 10).join(' · ');
    return {
      ok: false,
      끝났다: true,
      error: `.fig 를 열었는데 도형 목록 칸을 못 찾았습니다. ${뿌리이름} 에 있는 칸: ${있는칸 || '(없음)'}`,
    };
  }

  let 것;
  try {
    것 = 알맹이읽기(스키마, 몸, 뿌리이름, (_정의, 칸) => 칸 === 도형칸 || 담을칸.has(칸));
  } catch (err) {
    // 여기까지 왔는데 못 읽었으면 스키마와 알맹이가 안 맞는 것이다. 반쯤
    // 읽은 것을 내놓지 않는다 — 반만 맞는 시안은 틀린 시안보다 나쁘다.
    return { ok: false, error: `.fig 를 스키마대로 읽지 못했습니다 — ${err.message}`, 끝났다: true };
  }

  const 노드들 = Array.isArray(것?.[도형칸]) ? 것[도형칸].filter(Boolean) : [];
  if (!노드들.length) {
    return { ok: false, error: '.fig 를 열었는데 안에 도형이 하나도 없습니다', 끝났다: true };
  }

  const { 자식표, 뿌리들 } = 나무엮기(노드들);

  /*
   * 쪽은 CANVAS 다.
   *
   * Figma 에서 「페이지」 라고 부르는 것이 파일 안에서는 CANVAS 이고,
   * 그 위가 DOCUMENT 하나다. 쪽마다 한 덩이로 내면 마크다운에서 `## 쪽이름`
   * 이 되고, 글로 낼 때도 `--- 쪽이름 ---` 으로 갈린다.
   */
  const 문서 = 뿌리들.find((n) => n.type === 'DOCUMENT') ?? 뿌리들[0];
  const 쪽들 = (자식표.get(열쇠(문서?.guid)) ?? []).filter((n) => n.type === 'CANVAS');

  const 셈 = { 남은: 노드최대 };
  const 덩이들 = [];

  const 개요 = [];
  const 파일이름 = 메타?.file_name ?? 메타?.fileName ?? 메타?.name;
  if (파일이름) 개요.push(`파일 이름: ${파일이름}`);
  개요.push(`쪽 ${쪽들.length || 1}개 · 도형 ${노드들.length.toLocaleString('en-US')}개`);
  if (그림수) 개요.push(`쓰인 그림 ${그림수}개 (images/ 안에 있습니다 — 이 읽개는 그림을 안 풉니다)`);
  if (미리보기) 개요.push('미리보기 그림 thumbnail.png 가 들어 있습니다');
  개요.push('색·그림자·글꼴은 안 냅니다. 이름 · 글 · 크기 · 짜임까지입니다.');
  덩이들.push({ 이름: '개요', 문단들: 개요 });

  if (쪽들.length) {
    for (const 쪽 of 쪽들) {
      const 줄들 = [];
      for (const 아이 of 자식표.get(열쇠(쪽.guid)) ?? []) 가지풀기(아이, 자식표, 줄들, 0, 셈);
      덩이들.push({
        이름: String(쪽.name ?? '').trim() || '이름 없는 쪽',
        문단들: 줄들.length ? 줄들 : ['(이 쪽은 비어 있습니다.)'],
      });
    }
  } else {
    // DOCUMENT/CANVAS 짜임이 아닌 파일도 있다 — 그때는 있는 대로 편다.
    const 줄들 = [];
    for (const n of 뿌리들) 가지풀기(n, 자식표, 줄들, 0, 셈);
    덩이들.push({ 이름: '도형', 문단들: 줄들 });
  }

  if (셈.남은 <= 0) {
    말.push(`도형이 ${노드최대.toLocaleString('en-US')}개를 넘어 거기까지만 폈습니다 — 뒷부분은 안 실렸습니다`);
  }

  return { ok: true, 갈래: 'fig', 덩이들, 말, 노드수: 노드들.length };
}

/** 한 줄 요약. Read 의 summary 자리로 간다. */
export function summarize(r) {
  if (!r?.ok) return '';
  const 쪽 = Math.max(0, r.덩이들.length - 1);
  return `fig · 쪽 ${쪽}개 · 도형 ${r.노드수.toLocaleString('en-US')}개`;
}

/** 고치려 들 때 하는 말. 문서·PDF 와 같은 꼴 — 왜 안 되는지와 그럼 어떻게 하는지. */
export function fig는못고침(보인이름) {
  return `.fig 시안은 이 도구로 고칠 수 없습니다: ${보인이름}\n`
    + '  읽기만 됩니다 (이름 · 글 · 크기 · 짜임을 글로 냅니다). 시안을 글로\n'
    + '  왕복시키면 그 자리에서 시안이 아니게 되기 때문입니다.\n'
    + `  고칠 것이 있으면 Figma 에서 고치고 다시 내보내 주세요.\n`
    + `  ${basename(보인이름)} 자체는 안 건드렸습니다.`;
}
