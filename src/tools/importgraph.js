/**
 * 파일끼리 누가 누구를 불러 쓰나 — Outline 이 **많이 불리는 파일부터** 싣게 센다 (2.1.3).
 *
 * ── 왜 이게 필요한가 ───────────────────────────────────────────────────
 *
 * Outline 은 폴더의 뼈대를 최근에 손댄 순서로 싣고 창에 맞춰 뒤를 자른다. 그래서 오래 안 건드린 핵심 모듈 —
 * 파일 수십 개가 불러 쓰는 것 — 이 큰 저장소에서 제일 먼저 잘렸다. 모델은 그 모듈이 있는 줄 모르고, 이미
 * 있는 것을 새로 만든다.
 *
 * ── 무엇을 세나 ────────────────────────────────────────────────────────
 *
 *   js · ts   `import … from './x'` · `import './x'` · `import('./x')` · `require('./x')` · `export … from './x'`
 *             — 점으로 시작하는 것만. 꾸러미 이름(`react`)은 이 폴더의 파일이 아니다.
 *             확장자를 빼고 적은 것 · 폴더(index) · `.js` 로 적고 `.ts` 인 것까지 짚는다.
 *   py        `from a.b import c` · `from .b import c` · `import a.b` — 모듈 파일과 `__init__.py`.
 *
 * 한 파일이 같은 곳을 여러 번 불러도 한 번이다. 정규식이라 문자열 속 `require('x')` 를 셀 수도 있다 —
 * Outline 머리말과 같은 까닭으로 괜찮다. 여기 셈은 **무엇을 먼저 보여 줄지**에만 쓰인다.
 * 읽는 양에 상한을 둔다. 넘으면 넘은 파일은 안 세고(불린 수 0), 그 사실은 부르는 쪽이 적는다.
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

export const 셀파일상한 = 3000;
const 한개상한 = 256 * 1024;

const js확장 = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'];
const js꼴 = new Set(js확장);
const js무늬 = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])(\.{1,2}\/[^'"\n]*|\.{1,2})\1/gm;
const py무늬from = /^\s*from\s+(\.*)([\w.]*)\s+import\s+\(?([^\n#)]*)/gm;
const py무늬import = /^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/gm;

/**
 * @param {string} 뿌리  작업 폴더 (파이썬 절대 가져오기의 기준)
 * @param {string[]} 파일들  절대 경로. 이 안에서만 짚고 센다.
 * @returns {Map<string, number>} 절대 경로 → 그 파일을 불러 쓰는 **다른 파일** 수. 넘친 것이 있으면 `.넘침` 에 수.
 */
export function 들여옴세기(뿌리, 파일들, { 상한 = 셀파일상한 } = {}) {
  const 셈 = new Map();
  // 윈도우 · 맥은 대소문자를 안 가린다 — 적힌 글자와 디스크 글자가 달라도 같은 파일로 짚는다.
  const 안가림 = process.platform === 'win32' || process.platform === 'darwin';
  const 열쇠 = (p) => (안가림 ? p.toLowerCase() : p);
  const 있는것 = new Map();
  for (const p of 파일들) 있는것.set(열쇠(resolve(p)), resolve(p));
  const 짚기 = (후보들) => { for (const c of 후보들) { const 찾음 = 있는것.get(열쇠(c)); if (찾음) return 찾음; } return null; };

  const js짚기 = (파일, 적힌) => {
    const t = resolve(dirname(파일), 적힌);
    const 후보 = [t, ...js확장.map((e) => t + e), ...js확장.map((e) => join(t, `index${e}`))];
    // ts 는 `./x.js` 로 적고 `x.ts` 를 둔다 (NodeNext).
    const e = extname(t);
    if (e === '.js' || e === '.mjs' || e === '.cjs') {
      const 몸 = t.slice(0, -e.length);
      후보.push(`${몸}.ts`, `${몸}.tsx`, `${몸}${e === '.mjs' ? '.mts' : e === '.cjs' ? '.cts' : '.ts'}`);
    }
    return 짚기(후보);
  };
  const py모듈 = (기준, 이름) => {
    const 몸 = join(기준, ...이름.split('.').filter(Boolean));
    return 짚기([`${몸}.py`, `${몸}.pyi`, join(몸, '__init__.py')]);
  };

  let 본수 = 0;
  let 넘침 = 0;
  for (const 파일 of 파일들) {
    const e = extname(파일).toLowerCase();
    const js = js꼴.has(e);
    const py = e === '.py' || e === '.pyi';
    if (!js && !py) continue;
    if (본수 >= 상한) { 넘침++; continue; }
    본수++;
    let 글;
    try {
      if (statSync(파일).size > 한개상한) continue;
      글 = readFileSync(파일, 'utf8');
    } catch { continue; }
    const 나 = resolve(파일);
    const 부른것 = new Set();
    if (js) {
      for (const m of 글.matchAll(js무늬)) { const t = js짚기(나, m[2]); if (t) 부른것.add(t); }
    } else {
      for (const m of 글.matchAll(py무늬from)) {
        const 점 = m[1].length;
        const 모듈 = m[2];
        let 기준 = resolve(뿌리);
        if (점) { 기준 = dirname(나); for (let i = 1; i < 점; i++) 기준 = dirname(기준); }
        if (모듈) { const t = py모듈(기준, 모듈); if (t) 부른것.add(t); }
        // `from pkg import util` 의 util 이 하위 모듈일 수 있다.
        for (const 이름 of m[3].split(',').map((x) => x.trim().split(/\s+/)[0]).filter((x) => /^\w+$/.test(x))) {
          const t = py모듈(기준, 모듈 ? `${모듈}.${이름}` : 이름);
          if (t) 부른것.add(t);
        }
      }
      for (const m of 글.matchAll(py무늬import)) {
        for (const 조각 of m[1].split(',')) {
          const 이름 = 조각.trim().split(/\s+/)[0];
          const t = py모듈(resolve(뿌리), 이름);
          if (t) 부른것.add(t);
        }
      }
    }
    부른것.delete(나);
    for (const t of 부른것) 셈.set(t, (셈.get(t) ?? 0) + 1);
  }
  셈.넘침 = 넘침;
  return 셈;
}
