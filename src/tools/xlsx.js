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
  // 16진 참조의 x 는 대문자도 된다(XML 규격). 소문자만 봐서 `&#X41;` 이 글자째 남았다 (2.0.0 6회차 엑셀6).
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-z]+);/g, (전체, 안) => {
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
    const 닫힘 = 태그끝(xml, 열림);
    if (닫힘 < 0) break;
    let 안 = xml.slice(열림 + 1, 닫힘);
    const closing = 안[0] === '/';
    if (closing) 안 = 안.slice(1);
    const selfClosing = 안.endsWith('/');
    if (selfClosing) 안 = 안.slice(0, -1);
    const 빈칸 = 안.search(/[\s]/);
    const 온이름 = 빈칸 < 0 ? 안 : 안.slice(0, 빈칸);
    /*
     * 이름의 접두사(`x:worksheet`)는 뗀다 (2.0.0 6회차 엑셀6). 기본 이름공간을 접두사로 적는 도구가 있고,
     * 이름을 글자 그대로 견줬더니 `sheet` 를 하나도 못 찾아 「읽을 수 있는 시트가 없습니다」 로 끝났다.
     * 문서 읽기(docs.js)도 이 함수를 쓰는데 거기는 이미 끝이름 으로 떼고 본다. 속성 이름(`r:id`)은 그대로 —
     * 부르는 쪽이 접두사째 찾는다.
     */
    const name = 온이름.slice(온이름.indexOf(':') + 1);
    const attrs = 빈칸 < 0 ? {} : 속성(안.slice(빈칸));
    yield { name, attrs, closing, selfClosing };
    i = 닫힘 + 1;
  }
}

/*
 * 태그를 닫는 `>` 자리. 속성 값 따옴표 안의 `>` 는 건너뛴다 (2.0.0 6회차 엑셀6).
 *
 * XML 은 속성 값에 `>` 를 날로 적어도 되고, 엑셀 밖 도구는 `formatCode="[>100]0.0"` 처럼 적는다.
 * 첫 `>` 에서 끊었더니 서식 문자열이 사라져 날짜 칸이 숫자로 나왔다. 따옴표가 없는 태그는 indexOf
 * 한 번이다. 따옴표가 끝내 안 닫히는 망가진 태그는 옛날처럼 첫 `>` 에서 끊는다 — 뒤를 통째로 삼키지 않게.
 */
function 태그끝(xml, 열림) {
  const 첫 = xml.indexOf('>', 열림);
  if (첫 < 0) return -1;
  const 앞 = xml.slice(열림, 첫);
  if (!앞.includes('"') && !앞.includes("'")) return 첫;
  let 따옴 = null;
  for (let j = 열림 + 1; j < xml.length; j++) {
    const ch = xml[j];
    if (따옴) { if (ch === 따옴) 따옴 = null; continue; }
    if (ch === '>') return j;
    if (ch === '"' || ch === "'") 따옴 = ch;
  }
  return 첫;
}

function 속성(s) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(s))) out[m[1] ?? m[3]] = unescapeXml(m[2] ?? m[4]);
  return out;
}

// ── 셀 주소 ─────────────────────────────────────────────────────────────

/** 'BC12' → { col: 55, row: 12 }  (col 은 1부터. BC = 2×26+3 이다 — 54 는 BB) */
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
      /*
       * 관계 열쇠는 **접두사를 떼고** 찾는다 (막판 훑기).
       *
       * 태그 이름의 접두사는 위에서 뗐는데(tags), 여기만 `r:id` 를 글자 그대로 찾았다.
       * 접두사 이름은 규격이 정해 주는 것이 아니라 그 파일이 정하는 별명이라,
       * `xmlns:rel="…/relationships"` 로 적는 도구가 만든 통합문서는 접두사를 뗀 고침
       * 뒤에도 똑같이 「읽을 수 있는 시트가 없습니다」 로 죽었다. 반쪽만 고쳐져 있었다.
       */
      const rid = n.attrs['r:id']
        ?? Object.entries(n.attrs).find(([k]) => k.includes(':') && k.slice(k.indexOf(':') + 1) === 'id')?.[1]
        ?? n.attrs.id;
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
      //
      // 여기 「그러면서 숫자 서식은 아닌 것」(`!/^[#0.,%\s]*$/`)이 뒤에 붙어 있었다.
      // 앞이 참이면 y·m·d·h·s 중 한 글자가 남아 있다는 뜻이라 뒤는 **늘** 참이다 —
      // 무작정 다 돌려 보니 앞이 참인 1,560,474건 중 걸린 것이 0건이었다. 지키는
      // 척만 하는 조건은 다음 사람이 그것을 믿고 진짜 조건을 빼게 만든다.
      const 순수 = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
      if (/[ymdhs]/i.test(순수)) 날짜Fmt.add(id);
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

/*
 * 엑셀이 담을 수 있는 가장 큰 표 — 2007 판부터 1,048,576행 × 16,384열(XFD).
 * 이 밖을 가리키는 주소는 엑셀이 만든 파일에서 나올 수 없다. 나왔다면 누가
 * 손으로 적은 바이트다.
 */
export const 엑셀최대행 = 1048576;
export const 엑셀최대열 = 16384;
/** 빈 줄·빈 열이 이만큼 넘게 이어지면 자리를 안 지키고 건너뛰었다고 말한다. */
export const 빈틈상한 = 1000;
/** 펼친 표(줄 × 폭)의 칸 수 상한. 넘는 아래쪽 줄은 빼고 뺐다고 말한다. */
export const 칸수상한 = 1_000_000;

const 천단위 = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 1 → 'A', 27 → 'AA', 16384 → 'XFD' */
function 열이름(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 건너뛴 범위 목록을 말로. 너무 많으면 앞의 셋만 적고 나머지는 곳 수만. */
function 범위말(목록, 꼴) {
  const 앞 = 목록.slice(0, 3).map(꼴).join(', ');
  return 목록.length > 3 ? `${앞} 외 ${천단위(목록.length - 3)}곳` : 앞;
}

function 시트읽기(xml, { shared, 날짜여부 }) {
  /*
   * ── 값이 있는 칸만 모으고, 펼치기는 맨 끝에 한 번 ─────────────────────
   *
   * 전에는 읽는 대로 줄 배열을 그 번호까지 빈 줄로, 칸 배열을 그 열까지 빈 칸으로
   * 채웠다. 그러면 메모리가 **파일 크기가 아니라 주소가 우기는 번호**를 따라간다.
   * 1KB 도 안 되는 파일의 `<row r="80000000">` 한 줄에 빈 배열 팔천만 개,
   * `<c r="AAAAAA1">` 한 칸에 빈 칸 천이백만 개 — 힙이 바닥나 프로세스가 죽었다
   * (2.0.0 4회차 사냥). 엑셀 파일은 남이 보낸 바이트다.
   *
   * 그래서 읽는 동안은 **값이 있는 칸만** 담는다 — 메모리가 파일 크기를 따른다.
   * 펼칠 때(표펼치기) 세 가지를 막고, 막은 것은 전부 말로 남긴다. 조용히 줄이면
   * 표가 멀쩡해 보여서 사람은 무엇이 빠졌는지 모른다.
   */
  const 줄들 = [];        // { 번호, 칸: Map<열, 값>, 끝열 } — 번호 오름차순
  let 지금줄 = null;
  let 앞줄번호 = 0;
  let 셀 = null;
  let 안에 = null;      // 'v' | 't' | null
  let 모은글 = '';
  let 읽기표깊이 = 0;   // <rPh> 안 — 인라인 문자열의 읽기(후리가나)라 본문이 아니다
  let 한계밖 = 0;

  const 줄열기 = (r) => {
    const n = Number(r);
    // 엑셀은 줄을 오름차순으로 적는다. 번호가 없거나 뒷걸음치면 앞 줄 바로 다음으로
    // 본다 — 전에도 그런 줄은 뒤에 이어 붙였다.
    const 번호 = Number.isInteger(n) && n > 앞줄번호 ? n : 앞줄번호 + 1;
    지금줄 = { 번호, 칸: new Map(), 끝열: 0, 앞칸열: 0, 밖: 번호 > 엑셀최대행 };
  };
  const 줄닫기 = () => {
    셀마감();
    if (지금줄 && !지금줄.밖) { 줄들.push(지금줄); 앞줄번호 = 지금줄.번호; }
    지금줄 = null;
  };

  const 셀마감 = () => {
    if (!셀) return;
    let 값 = 모은글;
    if (셀.t === 's') {
      // 값 없는 칸(`<c t="s"></c>` · `<v></v>`)은 빈 칸이다. Number('') 가 0 이라 0번 공용 글이 들어갔다 (2.0.0 6회차 엑셀6).
      const i = 값.trim() === '' ? NaN : Number(값);
      값 = Number.isInteger(i) && i >= 0 && i < shared.length ? shared[i] : '';
    } else if (셀.t === 'b') {
      // 규격은 1·0 인데 `true`·`false` 로 적는 도구가 있다. 값 없는 불리언은 FALSE 가 아니라 빈 칸 (2.0.0 6회차 엑셀6).
      const 글 = 값.trim().toLowerCase();
      값 = 글 === '' ? '' : (글 === '1' || 글 === 'true' ? 'TRUE' : 'FALSE');
    } else if (셀.t === 'e') {
      // #REF! 같은 오류값. 지우면 왜 비었는지 알 수 없다.
      값 = 값 || '#오류';
    } else if (셀.t === 'str' || 셀.t === 'inlineStr') {
      // 그대로
    } else if (값 !== '' && 날짜여부[셀.s] && /^-?\d+(\.\d+)?$/.test(값)) {
      값 = 날짜로(Number(값)) ?? 값;
    }
    if (값 !== '') {
      // <row> 밖에 떨어진 칸 — 망가진 파일이다. 죽지 않고 앞 줄 다음 줄로 본다.
      if (!지금줄) 줄열기(null);
      // 엑셀 한계 밖 주소는 담지 않고 센다. 센 것은 말로 남긴다(아래).
      if (지금줄.밖 || 셀.col > 엑셀최대열) 한계밖 += 1;
      else {
        지금줄.칸.set(셀.col, 값);
        if (셀.col > 지금줄.끝열) 지금줄.끝열 = 셀.col;
      }
    }
    셀 = null;
    모은글 = '';
  };

  for (const n of tags(xml)) {
    if (n.text !== undefined) { if (안에 && !읽기표깊이) 모은글 += unescapeXml(n.text); continue; }
    // 인라인 문자열의 <rPh> 는 공용문자열 쪽처럼 본문에 안 붙인다 — 붙였더니 `東京トウキョウ` 가 됐다 (2.0.0 6회차 엑셀6).
    if (n.name === 'rPh') { 읽기표깊이 = Math.max(0, 읽기표깊이 + (n.closing ? -1 : (n.selfClosing ? 0 : 1))); continue; }
    if (n.name === 'row') {
      if (n.closing) 줄닫기();
      else if (!n.selfClosing) { 줄닫기(); 줄열기(n.attrs.r); }
      continue;
    }
    if (n.name === 'c') {
      if (n.closing) { 셀마감(); continue; }
      셀마감();
      /*
       * 주소 없는 칸은 **앞 칸 다음 열**이다 — 앞 칸에 값이 있었든 없었든.
       * 「값이 들어간 마지막 열 + 1」 로 세면 `<c/>` · 값 없는 `<c s="2"></c>` 가 낀 자리가
       * 안 세어져 뒤 칸이 한 칸씩 왼쪽으로 당겨졌다 (4회차 Gemini 리뷰). 끝열은 폭을 재는 데만 쓴다.
       */
      const { col } = n.attrs.r ? cellRef(n.attrs.r) : { col: (지금줄?.앞칸열 ?? 0) + 1 };
      셀 = { col: col || 1, t: n.attrs.t ?? null, s: Number(n.attrs.s ?? 0) };
      if (지금줄) 지금줄.앞칸열 = 셀.col;
      모은글 = '';
      읽기표깊이 = 0;   // 안 닫힌 <rPh> 가 다음 칸까지 삼키지 않게
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
  줄닫기();

  const 말 = [];
  if (한계밖) {
    말.push(`엑셀 한계(${천단위(엑셀최대행)}행 × ${천단위(엑셀최대열)}열) 밖 주소를 가리키는 칸 ${천단위(한계밖)}개는 뺐습니다`
      + ' — 엑셀이 만든 파일에서는 나올 수 없는 주소입니다');
  }
  return { rows: 표펼치기(줄들, 말), 말 };
}

/**
 * 값이 있는 칸만 모은 줄들을 사람이 읽는 네모난 표(string[][])로 편다.
 *
 * 막는 것 셋 — 모두 **주소가 우기는 번호**만큼 메모리를 쓰게 두지 않으려는 것이고,
 * 막은 것은 전부 `말` 에 적는다.
 *
 *   1. 빈 줄이 빈틈상한 넘게 이어지면 자리를 안 지키고 건너뛴다. 백만째 줄의 한 칸
 *      때문에 빈 줄 백만 개를 내놓아 봐야 읽을 사람이 없다. 좁은 틈은 전처럼 지킨다
 *      — 안 그러면 행 번호가 밀린다. 넓은 틈은 몇 행부터 몇 행까지 건너뛰었고
 *      다음 값이 몇 행인지 적는다. 표에서 그 아래 줄이 당겨져 보이기 때문이다.
 *   2. 빈 열도 같다. XFD 열의 한 칸 때문에 줄마다 빈 칸 만육천 개를 붙이지 않는다.
 *   3. 틈이 좁아도 칸이 대각선으로 흩어지면 줄 × 폭 이 곱해서 커진다. 펼친 칸 수가
 *      칸수상한을 넘으면 아래쪽 줄을 빼고, 몇 줄을 몇 행부터 뺐는지 적는다.
 */
function 표펼치기(줄들, 말) {
  // ── 줄: 값 있는 줄 사이의 틈을 재서 좁으면 빈 줄로 채우고, 넓으면 건너뛴다 ──
  const 마디 = [];        // { 번호, 줄 } 또는 { 번호, 빈: 개수 }
  const 건너뛴줄 = [];    // [처음, 끝]
  const 마지막번호 = 줄들.length ? 줄들[줄들.length - 1].번호 : 0;
  let 앞 = 0;
  const 틈 = (다음) => {  // 앞+1 ~ 다음-1
    const k = 다음 - 앞 - 1;
    if (k <= 0) return;
    if (k > 빈틈상한) 건너뛴줄.push([앞 + 1, 다음 - 1]);
    else 마디.push({ 번호: 앞 + 1, 빈: k });
  };
  const 쓰인열 = new Set();
  for (const z of 줄들) {
    // 값 없는 줄(서식만 있는 줄)은 틈으로 센다. 끝자리 계산에만 번호가 쓰인다.
    if (!z.칸.size) continue;
    틈(z.번호);
    마디.push({ 번호: z.번호, 줄: z });
    for (const c of z.칸.keys()) 쓰인열.add(c);
    앞 = z.번호;
  }
  틈(마지막번호 + 1);
  if (건너뛴줄.length) {
    const 합 = 건너뛴줄.reduce((s, [a, b]) => s + (b - a + 1), 0);
    말.push(`빈 줄 ${천단위(합)}개를 건너뛰었습니다 (${범위말(건너뛴줄, ([a, b]) => (b < 마지막번호
      ? `${천단위(a)}~${천단위(b)}행 → ${천단위(b + 1)}행부터 이어짐`
      : `${천단위(a)}~${천단위(b)}행 · 시트 끝`))}) — 표의 아래쪽 줄은 그만큼 당겨져 있습니다`);
  }

  // ── 열: 쓰인 열 사이의 틈도 같은 식으로. 열 번호 → 펼친 표의 칸 자리 ──
  const 자리 = new Map();
  const 건너뛴열 = [];
  let 폭 = 0;
  let 앞열 = 0;
  for (const c of [...쓰인열].sort((a, b) => a - b)) {
    const k = c - 앞열 - 1;
    if (k > 빈틈상한) 건너뛴열.push([앞열 + 1, c - 1]);
    else 폭 += k;
    자리.set(c, 폭);
    폭 += 1;
    앞열 = c;
  }
  if (건너뛴열.length) {
    const 합 = 건너뛴열.reduce((s, [a, b]) => s + (b - a + 1), 0);
    말.push(`빈 열 ${천단위(합)}개를 건너뛰었습니다 (${범위말(건너뛴열, ([a, b]) => `${열이름(a)}~${열이름(b)}열 → ${열이름(b + 1)}열부터 이어짐`)})`
      + ' — 표의 오른쪽 칸은 그만큼 당겨져 있습니다');
  }

  // ── 펼치기. 칸 수 상한에 닿으면 거기서 멈춘다 ──
  const 줄상한 = Math.floor(칸수상한 / Math.max(폭, 1));
  const 총줄 = 마디.reduce((s, m) => s + (m.줄 ? 1 : m.빈), 0);
  const rows = [];
  let 뺀첫번호 = null;
  for (const m of 마디) {
    const 몇 = m.줄 ? 1 : m.빈;
    for (let i = 0; i < 몇; i++) {
      if (rows.length >= 줄상한) { 뺀첫번호 = m.번호 + i; break; }
      const r = new Array(폭).fill('');
      if (m.줄) for (const [c, v] of m.줄.칸) r[자리.get(c)] = v;
      rows.push(r);
    }
    if (뺀첫번호 !== null) break;
  }
  if (뺀첫번호 !== null) {
    말.push(`펼친 표가 칸 수 상한(${천단위(칸수상한)}칸 — 줄 × 폭 ${천단위(폭)})을 넘어 아래쪽 ${천단위(총줄 - rows.length)}줄`
      + `(${천단위(뺀첫번호)}행부터)은 뺐습니다`);
  }
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
    const { rows, 말 } = 시트읽기(xml, { shared, 날짜여부 });
    // 줄이거나 뺀 것은 시트 이름을 붙여 말로 올린다 — Read 와 doc2md 가 이 notes 를 그대로 보여 준다.
    for (const m of 말) notes.push(`시트 '${s.name}': ${m}`);
    sheets.push({ name: s.name, hidden: s.hidden, rows });
  }
  if (!sheets.length) throw new Error('읽을 수 있는 시트가 없습니다');
  return { sheets, notes };
}
