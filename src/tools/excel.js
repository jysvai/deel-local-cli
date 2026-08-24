// 엑셀 파일을 읽어 표로 돌려준다. 두 갈래를 여기서 고른다.
//
//   보통 xlsx/xlsm  → 직접 푼다. 의존성도 엑셀도 필요 없다. 빠르다.
//   암호 걸린 것·옛 xls → 엑셀을 시킨다. 그것 말고는 방법이 없다.
//
// 부르는 쪽은 어느 갈래인지 몰라도 된다. 다만 암호가 필요할 때는 물어볼 수
// 있어야 하므로, 물어보는 방법을 받아 온다(askPassword).
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { readXlsx, toCsv, looksXlsx, looksOle } from './xlsx.js';
import { excelToTables, canUseExcel } from './excel-com.js';

const 엑셀확장자 = new Set(['.xlsx', '.xlsm', '.xltx', '.xltm', '.xls', '.xlt']);

/** 이 경로가 엑셀 파일인가. 확장자로만 본다 — 내용은 열어 봐야 안다. */
export function isExcelPath(p) {
  return 엑셀확장자.has(extname(String(p ?? '')).toLowerCase());
}

/**
 * 엑셀 파일을 시트별 표로 읽는다.
 *
 * @param {string} abs 절대 경로
 * @param {{ askPassword?: (안내:string)=>Promise<string|null>, maxTries?: number }} opt
 *        askPassword 는 사용자에게 암호를 물어보는 함수다. 안 주면 못 묻는다.
 *        받은 암호는 이 함수 안에서만 산다 — 어디에도 안 적고, 돌려주지도 않는다.
 * @returns {Promise<{ ok:boolean, sheets?:Array, how?:string, notes?:string[], error?:string }>}
 */
export async function readExcel(abs, { askPassword = null, maxTries = 3 } = {}) {
  const buf = readFileSync(abs);

  if (looksXlsx(buf)) {
    try {
      const { sheets, notes } = readXlsx(buf);
      return { ok: true, sheets, notes, how: '직접 풀었습니다' };
    } catch (err) {
      // zip 이긴 한데 엑셀이 아니거나 모양이 다르다. 엑셀이 있으면 맡겨 본다.
      if (!canUseExcel()) return { ok: false, error: `${err.message}` };
      const r = await excelToTables(abs, { password: '' });
      if (r.ok) return { ok: true, sheets: r.sheets, notes: [], how: '엑셀에게 맡겼습니다' };
      return { ok: false, error: `${err.message} (엑셀에게도 맡겨 봤지만: ${r.message})` };
    }
  }

  if (!looksOle(buf)) {
    return { ok: false, error: '엑셀 파일이 아닙니다 — 앞머리가 xlsx(zip) 도 xls(OLE) 도 아닙니다' };
  }

  // 여기부터는 엑셀이 있어야 한다.
  if (!canUseExcel()) {
    return {
      ok: false,
      error: '암호가 걸렸거나 옛 형식(.xls) 인 엑셀 파일입니다. 이건 엑셀이 설치된 윈도우에서만 읽을 수 있습니다.',
    };
  }

  // 암호 없이 먼저 해 본다. 옛 .xls 는 암호가 없는 경우가 대부분이다.
  let r = await excelToTables(abs, { password: '' });
  if (r.ok) return { ok: true, sheets: r.sheets, notes: [], how: '엑셀에게 맡겼습니다' };

  if (r.reason !== 'password') {
    return { ok: false, error: 붙임(r) };
  }

  if (!askPassword) {
    return { ok: false, error: '암호가 걸린 엑셀 파일입니다. 암호를 물어볼 수 없는 자리라 못 엽니다 — 대화창에서 다시 시도해 주세요.' };
  }

  for (let i = 1; i <= maxTries; i++) {
    const 안내 = i === 1
      ? '이 엑셀 파일은 암호가 걸려 있습니다. 암호를 넣어 주세요'
      : `암호가 맞지 않습니다. 다시 넣어 주세요 (${i}/${maxTries})`;
    // 받은 즉시 쓰고 버린다. 변수 밖으로 안 나간다.
    const pw = await askPassword(안내);
    if (pw === null || pw === '') return { ok: false, error: '암호를 넣지 않아 열지 않았습니다.' };
    r = await excelToTables(abs, { password: pw });
    if (r.ok) return { ok: true, sheets: r.sheets, notes: [], how: '엑셀에게 맡겼습니다 (암호 씀)' };
    if (r.reason !== 'password') return { ok: false, error: 붙임(r) };
  }
  return { ok: false, error: `암호가 ${maxTries}번 다 맞지 않았습니다.` };
}

function 붙임(r) {
  if (r.reason === 'busy') return `${r.message}`;
  if (r.reason === 'timeout') return `${r.message}`;
  if (r.reason === 'no-excel') return `${r.message}`;
  return r.message ?? '엑셀 파일을 읽지 못했습니다';
}

/**
 * 읽은 표를 모델에게 줄 글로 만든다.
 *
 * CSV 로 준다. 표를 그리는 것보다 글자를 덜 먹고, 모델이 이미 잘 아는 모양이다.
 * 시트가 여럿이면 어디서 어디까지가 어느 시트인지 표시를 넣는다.
 */
export function toText(sheets, { maxRows = 500, maxChars = 60000 } = {}) {
  const 조각 = [];
  const 잘림 = [];
  for (const s of sheets) {
    const 넘침 = s.rows.length > maxRows;
    const rows = 넘침 ? s.rows.slice(0, maxRows) : s.rows;
    if (넘침) 잘림.push(`${s.name}: ${s.rows.length}줄 중 ${maxRows}줄`);
    const 머리 = `### 시트: ${s.name}${s.hidden ? ' (숨김)' : ''} — ${s.rows.length}줄 × ${s.rows[0]?.length ?? 0}칸`;
    조각.push(`${머리}\n${toCsv(rows)}`);
  }
  let text = 조각.join('\n\n');
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n… (너무 길어 여기서 자릅니다)`;
    잘림.push(`전체 길이 ${maxChars}자에서 자름`);
  }
  return { text, 잘림 };
}

/** 사람에게 보여줄 한 줄 요약. */
export function summarize(sheets, how) {
  const 줄 = sheets.reduce((a, s) => a + s.rows.length, 0);
  return `시트 ${sheets.length}개 · ${줄}줄 · ${how}`;
}
