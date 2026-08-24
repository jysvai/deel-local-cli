// 엑셀 파일을 표로 읽는다.
//
// 왜 필요한가:
//   사내 문서 상당수가 엑셀이다. 그런데 엑셀 파일은 글이 아니라 압축 꾸러미라,
//   그냥 읽으면 '바이너리 파일입니다' 로 끝난다. 사람이 손으로 CSV 로 내보내
//   붙여넣어야 했다. 그걸 도구가 알아서 한다.
//
// 무엇을 안 하는가:
//   되돌려 쓰지 않는다. 엑셀 파일은 읽기만 한다. 서식·수식·차트·조건부서식이
//   들어 있는 파일을 CSV 로 왕복시키면 반드시 뭔가 잃는다. 잃는 걸 알면서
//   쓰느니 안 쓰는 편이 낫다. 고칠 일이 있으면 사람이 엑셀에서 한다.
//
// 의존성 0개:
//   xlsx 는 사실 zip 이고, 그 안은 XML 이다. 둘 다 Node 내장으로 된다 —
//   zip 은 zlib, XML 은 여기 아래에 필요한 만큼만 만든 작은 읽기다.
//   범용 XML 파서를 만들지 않았다. 이 형식이 쓰는 모양만 읽는다.
import { readZip, looksZip } from '../pack/zip.js';

// ── 아주 작은 XML 읽기 ──────────────────────────────────────────────────
//
// 엑셀이 내놓는 XML 은 모양이 정해져 있다. 주석도, CDATA 도, DTD 도 안 쓴다.
// 그래서 여는 태그·닫는 태그·글자만 훑으면 된다.

const 되돌림 = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function unescapeXml(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (전체, 안) => {
    if (안[0] === '#') {
      const n = 안[1] === 'x' || 안[1] === 'X' ? parseInt(안.slice(2), 16) : parseInt(안.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : 전체;
    }
    return 되돌림[안] ?? 전체;
  });
}

/** 태그를 앞에서부터 하나씩 내놓는다. { name, attrs, closing, selfClosing, text } */
export function* tags(xml) {
  let i = 0;
  while (i < xml.length) {
    const 열림 = xml.indexOf('<', i);
    if (열림 < 0) break;
    if (열림 > i) {
      const 글 = xml.slice(i, 열림);
      if (글.trim()) yield { text: 글 };
      else if (글) yield { text: 글, blank: true };
    }
    // <?xml ... ?> 와 <!-- --> 는 건너뛴다
    if (xml[열림 + 1] === '?' || xml[열림 + 1] === '!') {
      const 끝 = xml.indexOf('>', 열림);
      i = 끝 < 0 ? xml.length : 끝 + 1;
      continue;
    }
    const 닫힘 = xml.indexOf('>', 열림);
    if (닫힘 < 0) break;
    let 안 = xml.slice(열림 + 1, 닫힘);
    const closing = 안[0] === '/';
    if (closing) 안 = 안.slice(1);
    const selfClosing = 안.endsWith('/');
    if (selfClosing) 안 = 안.slice(0, -1);
    const 빈칸 = 안.search(/[\s]/);
    const name = 빈칸 < 0 ? 안 : 안.slice(0, 빈칸);
    const attrs = 빈칸 < 0 ? {} : 속성(안.slice(빈칸));
    yield { name, attrs, closing, selfClosing };
    i = 닫힘 + 1;
  }
}

function 속성(s) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(s))) out[m[1] ?? m[3]] = unescapeXml(m[2] ?? m[4]);
  return out;
}

// ── 셀 주소 ─────────────────────────────────────────────────────────────

/** 'BC12' → { col: 54, row: 12 }  (col 은 1부터) */
export function cellRef(ref) {
  let col = 0;
  let i = 0;
  while (i < ref.length) {
    const c = ref.charCodeAt(i);
    if (c >= 65 && c <= 90) { col = col * 26 + (c - 64); i++; }
    else if (c >= 97 && c <= 122) { col = col * 26 + (c - 96); i++; }
    else break;
  }
  const row = Number(ref.slice(i)) || 0;
  return { col, row };
}

// ── 조각들 읽기 ─────────────────────────────────────────────────────────

function 공용문자열(xml) {
  // <si> 하나가 문자열 하나다. 안에 <t> 가 여러 개면 이어 붙인다(서식이 섞인 글).
  // <rPh> 는 일본어 읽기(후리가나)라서 본문이 아니다 — 넣으면 글자가 겹쳐 보인다.
  const out = [];
  let 모으는중 = null;
  let 무시깊이 = 0;
  let t = false;
  for (const n of tags(xml)) {
    if (n.text !== undefined) { if (t && !무시깊이 && 모으는중 !== null) 모으는중 += unescapeXml(n.text); continue; }
    if (n.name === 'si') {
      if (n.closing) { out.push(모으는중 ?? ''); 모으는중 = null; }
      else if (n.selfClosing) out.push('');
      else 모으는중 = '';
      continue;
    }
    if (n.name === 'rPh') { 무시깊이 += n.closing ? -1 : (n.selfClosing ? 0 : 1); continue; }
    if (n.name === 't') t = !n.closing && !n.selfClosing;
  }
  return out;
}

function 시트목록(workbookXml, rels) {
  const out = [];
  for (const n of tags(workbookXml)) {
    if (n.name === 'sheet' && !n.closing) {
      const rid = n.attrs['r:id'] ?? n.attrs.id;
      out.push({
        name: n.attrs.name ?? `시트${out.length + 1}`,
        // state="hidden" 인 시트도 담는다. 숨겨진 데 진짜 값이 있는 경우가 있다.
        hidden: n.attrs.state === 'hidden' || n.attrs.state === 'veryHidden',
        path: rels.get(rid) ?? null,
      });
    }
  }
  return out;
}

function 관계(relsXml) {
  const m = new Map();
  for (const n of tags(relsXml)) {
    if (n.name === 'Relationship' && !n.closing && n.attrs.Id) {
      let t = n.attrs.Target ?? '';
      if (t.startsWith('/')) t = t.slice(1);
      else if (!t.startsWith('xl/')) t = `xl/${t}`;
      m.set(n.attrs.Id, t.replace(/^xl\/\.\.\//, ''));
    }
  }
  return m;
}

// 엑셀 기본 서식 중 날짜·시각인 것들. 사용자가 만든 서식은 styles.xml 에서 읽는다.
const 기본날짜서식 = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function 날짜스타일(stylesXml) {
  // numFmtId → 날짜인가
  const 날짜Fmt = new Set(기본날짜서식);
  for (const n of tags(stylesXml)) {
    if (n.name === 'numFmt' && !n.closing) {
      const id = Number(n.attrs.numFmtId);
      const code = n.attrs.formatCode ?? '';
      // 서식 문자열에 연·월·일·시가 들어 있으면 날짜로 본다.
      // 따옴표 안의 글자는 그냥 붙는 말이라 빼고 본다.
      const 순수 = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
      if (/[ymdhs]/i.test(순수) && !/^[#0.,%\s]*$/.test(순수)) 날짜Fmt.add(id);
    }
  }
  // cellXfs 의 순서가 곧 셀의 s= 값이다.
  const 셀서식 = [];
  let cellXfs = false;
  for (const n of tags(stylesXml)) {
    if (n.name === 'cellXfs') { cellXfs = !n.closing; continue; }
    if (cellXfs && n.name === 'xf' && !n.closing) 셀서식.push(Number(n.attrs.numFmtId ?? 0));
  }
  return 셀서식.map((id) => 날짜Fmt.has(id));
}

// 엑셀의 날짜는 1899-12-30 부터 센 날수다. 1900 년 윤년 버그 때문에 30일이 기준이다.
const 기준 = Date.UTC(1899, 11, 30);

function 날짜로(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = 기준 + Math.round(n * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const p = (x, w = 2) => String(x).padStart(w, '0');
  const 날 = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  const 시 = n % 1 === 0 ? '' : ` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  return 날 + 시;
}

function 시트읽기(xml, { shared, 날짜여부 }) {
  const rows = [];
  let 지금줄 = null;
  let 줄번호 = 0;
  let 셀 = null;
  let 안에 = null;      // 'v' | 't' | null
  let 모은글 = '';
  let 최대칸 = 0;

  const 셀마감 = () => {
    if (!셀) return;
    let 값 = 모은글;
    if (셀.t === 's') {
      const i = Number(값);
      값 = Number.isInteger(i) && i >= 0 && i < shared.length ? shared[i] : '';
    } else if (셀.t === 'b') {
      값 = 값 === '1' ? 'TRUE' : 'FALSE';
    } else if (셀.t === 'e') {
      // #REF! 같은 오류값. 지우면 왜 비었는지 알 수 없다.
      값 = 값 || '#오류';
    } else if (셀.t === 'str' || 셀.t === 'inlineStr') {
      // 그대로
    } else if (값 !== '' && 날짜여부[셀.s] && /^-?\d+(\.\d+)?$/.test(값)) {
      값 = 날짜로(Number(값)) ?? 값;
    }
    if (값 !== '') {
      while (지금줄.length < 셀.col - 1) 지금줄.push('');
      지금줄[셀.col - 1] = 값;
      if (셀.col > 최대칸) 최대칸 = 셀.col;
    }
    셀 = null;
    모은글 = '';
  };

  for (const n of tags(xml)) {
    if (n.text !== undefined) { if (안에) 모은글 += unescapeXml(n.text); continue; }
    if (n.name === 'row') {
      if (n.closing) {
        셀마감();
        // 건너뛴 빈 줄도 자리를 지킨다. 안 그러면 행 번호가 밀린다.
        while (rows.length < 줄번호 - 1) rows.push([]);
        rows.push(지금줄 ?? []);
        지금줄 = null;
      } else if (!n.selfClosing) {
        지금줄 = [];
        줄번호 = Number(n.attrs.r) || rows.length + 1;
      }
      continue;
    }
    if (n.name === 'c') {
      if (n.closing) { 셀마감(); continue; }
      셀마감();
      const { col } = n.attrs.r ? cellRef(n.attrs.r) : { col: (지금줄?.length ?? 0) + 1 };
      셀 = { col: col || 1, t: n.attrs.t ?? null, s: Number(n.attrs.s ?? 0) };
      모은글 = '';
      if (n.selfClosing) { 셀 = null; }   // <c r="A1"/> — 빈 칸
      continue;
    }
    if (n.name === 'v' || n.name === 't') {
      안에 = n.closing || n.selfClosing ? null : n.name;
      continue;
    }
    // <f> 는 수식이다. 값은 <v> 에 따로 들어 있으므로 수식 자체는 안 읽는다.
    if (n.name === 'f' && !n.closing) 안에 = null;
  }
  셀마감();
  if (지금줄) rows.push(지금줄);

  // 오른쪽 끝을 고른다
  for (const r of rows) while (r.length < 최대칸) r.push('');
  return rows;
}

// ── CSV ─────────────────────────────────────────────────────────────────

export function toCsv(rows) {
  const 칸 = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(칸).join(',')).join('\n');
}

// ── 바깥에서 쓰는 것 ────────────────────────────────────────────────────

/** 이 바이트들이 xlsx(암호 없는) 인가. */
export function looksXlsx(buf) {
  return looksZip(buf);
}

/**
 * 엑셀이 암호로 잠긴 파일인가.
 *
 * 암호가 걸리면 zip 이 아니라 OLE 복합문서로 감싸인다. 앞머리 여덟 바이트가
 * 그 표식이다. .xls (옛 형식) 도 같은 표식이라, 여기서는 '풀어야 읽는 것' 으로
 * 한데 묶는다. 어느 쪽이든 엑셀을 시켜야 읽을 수 있다.
 */
const OLE = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
export function looksOle(buf) {
  return buf.length >= 8 && buf.subarray(0, 8).equals(OLE);
}

/**
 * xlsx 를 시트별 표로 읽는다.
 * @returns {{ sheets: Array<{name:string, hidden:boolean, rows:string[][]}>, notes: string[] }}
 */
export function readXlsx(buf) {
  const notes = [];
  const { files, skipped } = readZip(buf, {
    only: (n) => n.startsWith('xl/') || n === '[Content_Types].xml',
  });
  for (const s of skipped) notes.push(`${s.name} — ${s.why}`);

  const 글 = (p) => {
    const b = files.get(p);
    return b ? b.toString('utf8') : null;
  };

  const wb = 글('xl/workbook.xml');
  if (!wb) throw new Error('엑셀 파일이 아닙니다 — 안에 workbook.xml 이 없습니다');

  const rels = 관계(글('xl/_rels/workbook.xml.rels') ?? '');
  const shared = 공용문자열(글('xl/sharedStrings.xml') ?? '');
  const 날짜여부 = 날짜스타일(글('xl/styles.xml') ?? '');

  const 목록 = 시트목록(wb, rels);
  const sheets = [];
  for (const s of 목록) {
    const xml = s.path ? 글(s.path) : null;
    if (!xml) { notes.push(`시트 '${s.name}' 의 내용을 못 찾았습니다`); continue; }
    sheets.push({ name: s.name, hidden: s.hidden, rows: 시트읽기(xml, { shared, 날짜여부 }) });
  }
  if (!sheets.length) throw new Error('읽을 수 있는 시트가 없습니다');
  return { sheets, notes };
}
