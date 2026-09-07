/**
 * 문서 → 마크다운.
 *
 * ── 왜 글이 아니라 마크다운인가 ─────────────────────────────────────────
 *
 * deel 은 이미 hwpx·docx·pptx·xlsx·pdf 를 제 손으로 읽는다(docs.js · xlsx.js ·
 * pdf.js). 다만 돌려주던 것이 **평평한 글**이었다. 표는 `이름 | 값 | 비고`
 * 한 줄로 펴져 나갔고, 장 구분은 `--- 3장 ---` 이었다.
 *
 * 그게 왜 손해인가 — 읽는 쪽이 사람이 아니라 모델이기 때문이다. 마크다운
 * 표는 모델이 「첫 줄이 머리글이고 셋째 칸이 비고」 라는 것을 그냥 안다.
 * 평평한 줄에서는 그걸 매번 다시 짐작해야 하고, 칸이 빈 행이 하나 섞이면
 * 거기서부터 어긋난다. 같은 바이트로 더 많이 전하는 쪽이 마크다운이다.
 *
 * 그리고 사람도 그대로 쓴다. `.md` 로 떨어뜨려 두면 그게 곧 문서다.
 *
 * ── 무엇을 새로 들이지 않나 ─────────────────────────────────────────────
 *
 * 아무것도. 읽는 일은 이미 있는 세 읽개가 그대로 하고, 이 파일은 그것이
 * 돌려준 것을 **그리기만** 한다. 의존성 0개는 그대로다.
 *
 * ── 표를 언제 표로 안 그리나 ────────────────────────────────────────────
 *
 * 칸이 열두 개를 넘으면 마크다운 표는 읽는 것이 아니라 가로로 흐르는 벽이
 * 된다. 그때는 CSV 울타리로 떨어뜨리고 **왜 그랬는지 적는다.** 조용히
 * 모양을 바꾸면, 표가 안 나오는 것이 파일 탓인지 우리 탓인지 알 길이 없다.
 */
import { basename, extname } from 'node:path';

import { isDocPath, readDoc, summarize as docSummary } from './docs.js';
import { isPdfPath, readPdf, summarize as pdfSummary } from './pdf.js';
import { readXlsx, toCsv } from './xlsx.js';
import { readFileSync } from 'node:fs';

/** 엑셀 확장자. tools/index.js 가 쓰는 것과 같은 목록이다. */
const 엑셀 = new Set(['.xlsx', '.xlsm']);

/** 이 길로 마크다운을 만들 수 있는 파일인가. */
export function 바꿀수있나(경로) {
  const p = String(경로 ?? '');
  return isDocPath(p) || isPdfPath(p) || 엑셀.has(extname(p).toLowerCase());
}

/** 우리가 직접 읽는 갈래 목록 — 화면과 도움말이 같은 곳에서 가져간다. */
export const 읽는갈래 = ['hwpx', 'docx', 'pptx', 'xlsx', 'pdf'];

// 다 실어 봐야 창만 찬다. 글로 낼 때와 같은 상한을 쓴다(docs.js · pdf.js).
const 최대글자 = 60000;
// 이보다 칸이 많으면 마크다운 표로 안 그린다 — 가로로 흐르는 벽이 된다.
const 최대칸 = 12;

/** 마크다운 표 칸 하나. `|` 와 줄바꿈은 표를 부수므로 바꿔 준다. */
function 칸(v) {
  return String(v ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim();
}

/** 이 행들이 다 비었나. 빈 표를 그리면 머리글만 있는 유령 표가 남는다. */
const 다비었나 = (행들) => 행들.every((r) => r.every((c) => !String(c ?? '').trim()));

/**
 * 행 목록을 마크다운 표로. 첫 행이 머리글이다.
 *
 * 칸 수가 행마다 다른 문서가 흔하다(합쳐진 칸). 제일 넓은 행에 맞춰 채운다 —
 * 안 채우면 마크다운이 그 행부터 표로 안 읽는다.
 */
export function 표그리기(행들) {
  const 있는것 = (행들 ?? []).filter((r) => Array.isArray(r) && r.length);
  if (!있는것.length || 다비었나(있는것)) return '';

  const 폭 = Math.max(...있는것.map((r) => r.length));
  if (폭 > 최대칸) {
    return ['```csv', toCsv(있는것.map((r) => [...r, ...Array(폭 - r.length).fill('')])), '```',
      `(칸이 ${폭}개라 마크다운 표 대신 CSV 로 냈습니다 — 표로 그리면 가로로 흘러 못 읽습니다.)`,
    ].join('\n');
  }

  const 채워 = (r) => [...r.map(칸), ...Array(폭 - r.length).fill('')];
  const [머리, ...몸] = 있는것;
  return [
    `| ${채워(머리).join(' | ')} |`,
    `|${' --- |'.repeat(폭)}`,
    ...몸.map((r) => `| ${채워(r).join(' | ')} |`),
  ].join('\n');
}

/**
 * 글자 수를 세면서 조각을 담는 자. 넘치면 **넘쳤다고 말하고** 멈춘다.
 *
 * 조용히 자르면 모델은 그게 전부인 줄 알고 "문서에 그런 내용 없다" 고 답한다.
 * 이 파일이 세 읽개에서 그대로 물려받는 규칙이다.
 */
function 담개(maxChars) {
  const 조각 = [];
  const 말 = [];
  let 셈 = 0;
  let 찼나 = false;
  return {
    담기(글) {
      if (찼나) return false;
      const s = String(글 ?? '');
      if (셈 + s.length > maxChars) {
        찼나 = true;
        말.push(`${maxChars.toLocaleString('en-US')}자에서 잘랐습니다 — 뒷부분은 안 실렸습니다`);
        return false;
      }
      조각.push(s);
      셈 += s.length + 1;
      return true;
    },
    get 찼나() { return 찼나; },
    끝내기: () => ({ md: 조각.join('\n\n'), 말 }),
  };
}

/**
 * 덩이 하나(장·구획·쪽)를 담는다.
 *
 * 표 행({행:[...]})이 잇달아 나오면 한 표로 묶는다. 사이에 글이 끼면 거기서
 * 표가 끊긴 것이다 — 문서에서 표가 두 개로 나뉜 자리가 정확히 그 모양이다.
 */
function 덩이담기(담, 문단들, 머리글) {
  if (머리글 && !담.담기(머리글)) return;
  let 표 = [];
  const 표비우기 = () => {
    if (!표.length) return true;
    const 그림 = 표그리기(표);
    표 = [];
    return 그림 ? 담.담기(그림) : true;
  };
  for (const 문단 of 문단들 ?? []) {
    if (문단 && typeof 문단 === 'object' && Array.isArray(문단.행)) { 표.push(문단.행); continue; }
    if (!표비우기()) return;
    if (!담.담기(String(문단))) return;
  }
  표비우기();
}

/** 마크다운 제목에 파일 이름을 그대로 쓴다 — 어느 파일에서 나온 글인지가 남아야 한다. */
const 제목 = (경로) => `# ${basename(String(경로 ?? ''))}`;

function 문서를마크다운(경로, maxChars) {
  const r = readDoc(경로, { 표를따로: true });
  if (!r.ok) return { ok: false, error: r.error, 끝났다: r.끝났다 };

  const 담 = 담개(maxChars);
  담.담기(제목(경로));
  const 여럿 = r.덩이들.length > 1;
  for (const d of r.덩이들) {
    덩이담기(담, d.문단들, 여럿 ? `## ${d.이름}` : '');
    if (담.찼나) break;
  }
  const { md, 말 } = 담.끝내기();
  return { ok: true, 갈래: r.갈래, md, 말, summary: docSummary(r) };
}

function 엑셀을마크다운(경로, maxChars) {
  let r;
  try {
    r = readXlsx(readFileSync(경로));
  } catch (err) {
    return { ok: false, error: `엑셀을 읽지 못했습니다 — ${err.message}` };
  }
  const 담 = 담개(maxChars);
  담.담기(제목(경로));
  for (const s of r.sheets) {
    // 숨긴 시트도 낸다. 다만 숨겨져 있었다고 적는다 — 그 사실이 값을 읽는
    // 방식을 바꾼다(옛 판·임시 계산용인 일이 많다).
    담.담기(`## ${s.name}${s.hidden ? ' (숨김 시트)' : ''}`);
    const 그림 = 표그리기(s.rows);
    if (!담.담기(그림 || '(빈 시트입니다.)')) break;
  }
  const { md, 말 } = 담.끝내기();
  const 시트말 = `xlsx · 시트 ${r.sheets.length}개`;
  return { ok: true, 갈래: 'xlsx', md, 말: [...말, ...(r.notes ?? [])], summary: 시트말 };
}

function pdf를마크다운(경로, maxChars) {
  const r = readPdf(경로);
  if (!r.ok) return { ok: false, error: r.error, 끝났다: r.끝났다 };

  const 담 = 담개(maxChars);
  담.담기(제목(경로));
  const 왜표 = new Map((r.못읽은쪽 ?? []).map((x) => [x.번호, x]));
  for (const d of r.덩이들) {
    const 번호 = Number((d.이름.match(/^(\d+)/) ?? [])[1]);
    담.담기(`## ${d.이름}`);
    const 못 = 왜표.get(번호);
    // 못 읽은 쪽을 조용히 건너뛰면 **없는 문서**가 된다. 쪽 자리에 왜 비었는지 적는다.
    if (못 && !못.일부) { 담.담기(`> 이 쪽은 글로 못 읽었습니다 — ${못.왜}`); continue; }
    덩이담기(담, d.문단들, '');
    if (못?.일부) 담.담기(`> 이 쪽은 일부만 읽었습니다 — ${못.왜}`);
    if (담.찼나) break;
  }
  const { md, 말 } = 담.끝내기();
  return { ok: true, 갈래: 'pdf', md, 말, summary: pdfSummary(r) };
}

/**
 * 문서 하나를 마크다운으로.
 *
 * 던지지 않는다. 깨진 파일은 도구 실행 한가운데서 만나는 것이라, 예외가 나면
 * 「문서가 깨졌다」 가 「도구가 터졌다」 로 보고된다 — 세 읽개가 다 지키는 규칙이다.
 *
 * @returns {{ok:true, 갈래:string, md:string, 말:string[], summary:string}
 *          |{ok:false, error:string, 끝났다?:boolean}}
 */
export function 마크다운(경로, { maxChars = 최대글자 } = {}) {
  const p = String(경로 ?? '');
  if (엑셀.has(extname(p).toLowerCase())) return 엑셀을마크다운(p, maxChars);
  if (isPdfPath(p)) return pdf를마크다운(p, maxChars);
  if (isDocPath(p)) return 문서를마크다운(p, maxChars);
  return {
    ok: false,
    error: `마크다운으로 바꿀 수 있는 갈래가 아닙니다: ${basename(p) || p}\n`
      + `  직접 읽는 것: ${읽는갈래.join(' · ')}\n`
      + '  옛 형식(.ppt·.doc·.xls·.hwp)은 이 PC 에 LibreOffice 가 있으면 Read 가 빌려 읽습니다.',
  };
}
