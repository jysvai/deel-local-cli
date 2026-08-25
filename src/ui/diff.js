// 바뀐 자리를 줄 단위로 보여 준다.
//
// 왜 있어야 하나:
//   auto 모드는 안 물어보고 고친다. 그게 이 도구의 속도인데, 화면에 "3군데"
//   만 남으면 사람은 무엇이 바뀐지 모른 채 넘어간다. 되돌리기가 안전망이라도
//   뭐가 바뀐지 모르면 되돌릴지 말지조차 못 정한다. 그래서 고친 자리는
//   반드시 눈에 보여야 한다.
//
// 조심한 것:
//   1) 큰 파일. LCS 표는 줄 수의 곱만큼 자리를 먹는다 — 1만 줄짜리 둘이면
//      1억 칸이다. 그래서 앞뒤로 똑같은 부분을 먼저 잘라낸다. 파일 한 줄만
//      고치는 흔한 경우는 이것만으로 표가 1×1 이 된다.
//      그러고도 크면 LCS 를 포기하고 '이만큼이 통째로 바뀌었다' 로 물러선다.
//      느린 것보다 대충이라도 빨리 보이는 편이 낫다.
//   2) 줄 끝 표시(CRLF/LF). 눈에는 똑같은 줄이 전부 바뀐 것으로 나오면
//      진짜 바뀐 곳을 못 찾는다. 그래서 그 경우를 따로 알아채서 말해 준다.
//   3) 곁줄은 통째로 만들지 않는다. 20,000줄짜리에서 한 줄 고쳤다고 20,000개를
//      늘어놓을 이유가 없다 — 필요한 자리만 그때그때 집어 온다.
import { c, clip, cols } from './ansi.js';

// LCS 표를 여기까지만 만든다. 넘으면 대충으로 물러선다. (4M 칸 = 16MB)
const MAX_CELLS = 4_000_000;
// 대충으로 물러섰을 때 실제로 만들어 둘 줄 수. 나머지는 세기만 한다.
const MAX_COARSE = 2000;
const TAB = '    ';

/** 글을 줄로 나눈다. 마지막 개행이 있었는지는 따로 들고 있는다. */
function 줄나누기(text) {
  if (text === null || text === undefined) return { lines: [], eof: false, none: true };
  const s = String(text);
  if (s === '') return { lines: [], eof: false, none: false };
  const eof = s.endsWith('\n');
  const lines = (eof ? s.slice(0, -1) : s).split('\n');
  return { lines, eof, none: false };
}

const 줄끝뗀것 = (arr) => arr.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
const 같은가 = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * 두 글을 줄 단위로 비교한다.
 *
 * @param {string|null} before  없던 파일이면 null
 * @param {string|null} after   지운 파일이면 null
 * @returns {{
 *   changed: boolean, added: number, removed: number,
 *   isNew: boolean, isGone: boolean, eolOnly: boolean, eofChanged: boolean,
 *   tooBig: boolean, omitted: number, hunks: Array<{from:number,to:number}>,
 *   opAt: (p:number) => {t:string,a:number,b:number}|null, total: number,
 *   linesA: string[], linesB: string[],
 * }}
 */
export function diffLines(before, after, { context = 3, maxCells = MAX_CELLS } = {}) {
  const A = 줄나누기(before);
  const B = 줄나누기(after);
  const linesA = A.lines;
  const linesB = B.lines;

  // 줄 끝 표시만 바뀐 것인가 — 내용은 그대로인데 \r 만 붙거나 떨어진 경우.
  const 뗀A = 줄끝뗀것(linesA);
  const 뗀B = 줄끝뗀것(linesB);
  const eolOnly = !같은가(linesA, linesB) && 같은가(뗀A, 뗀B) && A.eof === B.eof;

  // 앞뒤로 똑같은 부분을 잘라낸다. 여기서 대부분의 일이 끝난다.
  let pre = 0;
  const 짧은쪽 = Math.min(linesA.length, linesB.length);
  while (pre < 짧은쪽 && linesA[pre] === linesB[pre]) pre++;
  let suf = 0;
  while (suf < 짧은쪽 - pre && linesA[linesA.length - 1 - suf] === linesB[linesB.length - 1 - suf]) suf++;

  const midA = linesA.slice(pre, linesA.length - suf);
  const midB = linesB.slice(pre, linesB.length - suf);

  let script = [];
  let added = 0;
  let removed = 0;
  let tooBig = false;
  let omitted = 0;

  if (midA.length === 0 && midB.length === 0) {
    // 줄은 똑같다. 남은 차이는 마지막 개행뿐일 수 있다.
  } else if (midA.length === 0 || midB.length === 0 || midA.length * midB.length > maxCells) {
    // 한쪽이 통째로 비었거나, 표가 너무 크다 — 통째로 바뀐 것으로 본다.
    tooBig = midA.length > 0 && midB.length > 0;
    added = midB.length;
    removed = midA.length;
    const 몫 = tooBig ? Math.max(1, Math.floor(MAX_COARSE / 2)) : Infinity;
    for (let i = 0; i < midA.length && i < 몫; i++) script.push({ t: '-', a: pre + i, b: -1 });
    for (let j = 0; j < midB.length && j < 몫; j++) script.push({ t: '+', a: -1, b: pre + j });
    omitted = Math.max(0, midA.length - 몫) + Math.max(0, midB.length - 몫);
  } else {
    script = LCS대본(midA, midB, pre);
    for (const op of script) {
      if (op.t === '+') added++;
      else if (op.t === '-') removed++;
    }
  }

  // 줄은 다 같은데 마지막 개행만 다른 경우. 마지막 줄이 바뀐 것으로 그린다.
  let eofChanged = false;
  if (added === 0 && removed === 0 && !A.none && !B.none && A.eof !== B.eof && linesA.length) {
    eofChanged = true;
    added = 1;
    removed = 1;
    const 끝 = linesA.length - 1;
    script = [{ t: '-', a: 끝, b: -1 }, { t: '+', a: -1, b: linesB.length - 1 }];
    // 대본이 맨 끝 한 줄을 대신하므로 꼬리 곁줄은 없다.
    suf = 0;
    pre = 끝;
  }

  const aTail = linesA.length - suf;
  const bTail = linesB.length - suf;
  const total = pre + script.length + suf;

  // 자리 하나를 그때그때 집어 온다. 앞뒤 공통 부분은 만들어 두지 않는다.
  const opAt = (p) => {
    if (p < 0 || p >= total) return null;
    if (p < pre) return { t: ' ', a: p, b: p };
    const k = p - pre;
    if (k < script.length) return script[k];
    const t = k - script.length;
    return { t: ' ', a: aTail + t, b: bTail + t };
  };

  // 바뀐 자리들을 곁줄을 붙여 덩어리로 묶는다.
  const 바뀐자리 = [];
  for (let k = 0; k < script.length; k++) if (script[k].t !== ' ') 바뀐자리.push(pre + k);

  const hunks = [];
  for (const p of 바뀐자리) {
    const 마지막 = hunks[hunks.length - 1];
    // 곁줄끼리 겹치거나 맞닿으면 한 덩어리로 합친다.
    if (마지막 && p - 마지막.last <= context * 2 + 1) {
      마지막.last = p;
      마지막.to = Math.min(total - 1, p + context);
    } else {
      hunks.push({ from: Math.max(0, p - context), to: Math.min(total - 1, p + context), last: p });
    }
  }
  for (const h of hunks) delete h.last;

  return {
    changed: added > 0 || removed > 0,
    added, removed,
    isNew: A.none && !B.none,
    isGone: !A.none && B.none,
    eolOnly, eofChanged, tooBig, omitted,
    hunks, opAt, total, linesA, linesB,
  };
}

/**
 * 가장 긴 공통 부분 수열로 대본을 만든다.
 *
 * 표를 통째로 잡는다 — 되짚어 올라가려면 표가 있어야 한다. 크기는 부르는 쪽에서
 * 이미 걸러 놨다. Uint32Array 를 쓰는 이유는 보통 배열보다 자리를 덜 먹고
 * 빈칸 채우기가 빨라서다.
 */
function LCS대본(a, b, base) {
  const n = a.length;
  const m = b.length;
  const W = m + 1;
  const 표 = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    const 줄 = i * W;
    const 다음 = (i + 1) * W;
    const ai = a[i];
    for (let j = m - 1; j >= 0; j--) {
      표[줄 + j] = ai === b[j] ? 표[다음 + j + 1] + 1 : Math.max(표[다음 + j], 표[줄 + j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: ' ', a: base + i, b: base + j }); i++; j++; }
    else if (표[(i + 1) * W + j] >= 표[i * W + j + 1]) { out.push({ t: '-', a: base + i, b: -1 }); i++; }
    else { out.push({ t: '+', a: -1, b: base + j }); j++; }
  }
  while (i < n) { out.push({ t: '-', a: base + i, b: -1 }); i++; }
  while (j < m) { out.push({ t: '+', a: -1, b: base + j }); j++; }
  return out;
}

const 보기좋게 = (s) => String(s ?? '').replace(/\t/g, TAB).replace(/\r/g, '');

/**
 * 화면에 그릴 줄들을 만든다.
 *
 * @param {ReturnType<typeof diffLines>|null} d
 * @param {{maxLines?:number, width?:number, indent?:string}} opts
 */
export function renderDiff(d, { maxLines = 40, width = 0, indent = '    ' } = {}) {
  if (!d || !d.hunks) return [];
  const 폭 = width > 0 ? width : Math.max(30, cols() - 18);
  const out = [];

  if (d.eolOnly) {
    out.push(`${indent}${c.yellow('※')} ${c.gray('줄 끝 표시(CRLF/LF)만 바뀌었습니다 — 글자는 그대로입니다.')}`);
  }
  if (d.eofChanged) {
    out.push(`${indent}${c.gray('※ 마지막 줄의 개행만 바뀌었습니다.')}`);
  }
  if (d.tooBig) {
    out.push(`${indent}${c.gray('※ 너무 많이 바뀌어 자세히는 못 맞춥니다 — 통째로 바뀐 것으로 봅니다.')}`);
  }
  if (!d.hunks.length) return out;

  const 번호폭 = String(Math.max(d.linesA?.length ?? 0, d.linesB?.length ?? 0)).length;
  let 그린줄 = 0;
  let 남은줄 = 0;
  let 끊김 = false;

  for (let h = 0; h < d.hunks.length; h++) {
    const { from, to } = d.hunks[h];
    if (h > 0) {
      if (그린줄 >= maxLines) { 끊김 = true; }
      else { out.push(`${indent}${c.gray('⋯')}`); }
    }
    for (let p = from; p <= to; p++) {
      if (그린줄 >= maxLines) { 끊김 = true; 남은줄 += to - p + 1; break; }
      const op = d.opAt(p);
      if (!op) continue;
      const 글 = clip(보기좋게(op.t === '-' ? d.linesA[op.a] : d.linesB[op.b]), 폭);
      // 번호는 '지금 파일' 의 번호만 적는다.
      //
      // 없어진 줄에 옛 번호를 달면, 바로 위 곁줄의 새 번호와 같은 숫자가 나란히
      // 찍힌다 — 서로 다른 파일의 번호가 한 줄에 섞여 보인다. 실제로 8번이
      // 두 번 찍히는 화면이 나왔다. 없어진 줄은 지금 파일에 없으니 번호도 없다.
      const n = op.t === '-' ? ' '.repeat(번호폭) : String(op.b + 1).padStart(번호폭);
      if (op.t === '+') out.push(`${indent}${c.hgreen('+')} ${c.gray(n)} ${c.green(글)}`);
      else if (op.t === '-') out.push(`${indent}${c.hred('-')} ${c.gray(n)} ${c.red(글)}`);
      else out.push(`${indent}${c.gray(' ')} ${c.gray(n)} ${c.gray(글)}`);
      그린줄++;
    }
    if (끊김) {
      for (let k = h + 1; k < d.hunks.length; k++) 남은줄 += d.hunks[k].to - d.hunks[k].from + 1;
      break;
    }
  }

  남은줄 += d.omitted ?? 0;
  if (남은줄 > 0) out.push(`${indent}${c.gray(`⋯ 외 ${남은줄.toLocaleString()}줄 더`)}`);
  return out;
}

/** `+3 −1` 한 줄 요약. 안 바뀌었으면 빈 글. */
export function shortStat(d) {
  if (!d || !d.changed) return '';
  const 조각 = [];
  if (d.added) 조각.push(c.hgreen(`+${d.added}`));
  if (d.removed) 조각.push(c.hred(`−${d.removed}`));
  return 조각.join(' ');
}
