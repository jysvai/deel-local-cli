/**
 * 사내 문서 읽기 — hwpx · docx · pptx → 글.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 *
 * 사내망의 스펙·공문·회의록이 이 세 형식이다. 지금까지는 Read 가 "바이너리라
 * 못 읽음" 으로 끝났고, 그 끝이 사고를 낳았다 — hwp 를 정리해 달라고 했더니
 * Read 가 실패하자 모델이 Write 로 새로 써서 원본이 죽었다. 덮어쓰기는 이제
 * 막혀 있지만, **읽기가 되면 그 길 자체가 없어진다.** 문서를 주고 "이대로
 * 만들어" 라고 시키는 일이 비로소 된다.
 *
 * 해외 CLI 어느 것도 hwp 계열을 못 읽는다. 이 파일이 있는 자리(한국 사내망)가
 * 이 프로그램이 도는 자리다.
 *
 * ── 왜 의존성 없이 되나 ─────────────────────────────────────────────────
 *
 * 셋 다 속은 ZIP + XML 이다(hwpx 는 한컴의 공개 규격 OWPML).
 * ZIP 은 우리 zip 읽개(pack/zip.js)로, XML 은 xlsx 가 쓰는 작은 읽기(tags)로
 * 푼다. 새로 들이는 것이 없다.
 *
 *   hwpx  Contents/section*.xml   글은 <hp:t>, 문단은 <hp:p>, 표는 <hp:tbl>
 *   docx  word/document.xml       글은 <w:t>,  문단은 <w:p>,  표는 <w:tbl>
 *   pptx  ppt/slides/slide*.xml   글은 <a:t>,  문단은 <a:p>,  장이 구획
 *
 * ── 읽기만 한다 ─────────────────────────────────────────────────────────
 *
 * 엑셀과 같은 이유로 고치기는 안 한다. 서식·그림·양식이 든 문서를 글로
 * 왕복시키면 반드시 뭔가 잃는다. 잃은 채로 저장된 문서는 겉보기에 멀쩡해서,
 * 잃은 것을 알아차렸을 때는 원본이 없다.
 *
 * 구형 hwp(OLE 복합문서)는 아예 다른 물건이라 여기서 안 다룬다. 대신 못
 * 읽는다고 말할 때 **어떻게 하면 되는지**(한글에서 hwpx 로 저장)를 같이 준다 —
 * 길 없는 거절은 모델을 우회로(새로 쓰기)로 몬다.
 */
import { readFileSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { readZip, looksZip } from '../pack/zip.js';
import { tags, unescapeXml } from './xlsx.js';

const 확장자 = { '.hwpx': 'hwpx', '.docx': 'docx', '.pptx': 'pptx' };

/** 이 길로 읽는 파일인가. 구형 .hwp 는 아니다 — 그건 별도 안내 대상이다. */
export function isDocPath(p) {
  if (typeof p !== 'string' || !p) return false;
  return extname(p).toLowerCase() in 확장자;
}

/** 어떤 문서인가. */
export function 종류(p) {
  return 확장자[extname(String(p ?? '')).toLowerCase()] ?? null;
}

/** 구형 hwp 인가 (OLE 복합문서 서명). Read 가 안내문을 고를 때 쓴다. */
export function looksOldHwp(경로, buf) {
  if (extname(String(경로 ?? '')).toLowerCase() !== '.hwp') return false;
  return buf.length >= 8 && buf.readUInt32LE(0) === 0xe011cfd0 && buf.readUInt32LE(4) === 0xe11ab1a1;
}

/*
 * ── 겉과 속이 다를 때, 속이 무엇인지 말한다 ─────────────────────────────
 *
 * 여태는 이랬다 —
 *
 *   ◧ Read(보고서.pptx)
 *     └ pptx 모양이 아닙니다 — 겉은 pptx 인데 속이 zip 꾸러미가 아닙니다.
 *       깨졌거나 다른 형식입니다.
 *
 * 「깨졌거나 다른 형식」 은 **아무것도 안 알려 준다.** 깨진 것이면 할 일이
 * 없고, 다른 형식이면 바꾸면 되는데 둘을 안 갈라 줬다. 그래서 모델은 같은
 * 파일을 몇 번씩 다시 열어 봤다 — 답이 매번 같은데도.
 *
 * 앞 몇 바이트만 보면 무엇인지 거의 다 안다. 알면 길도 같이 줄 수 있다.
 * 옛 hwp 안내(아래)가 이미 그렇게 하고 있었는데, 이쪽만 안 하고 있었다.
 */
const 서명들 = [
  { 이름: '옛 Office 파일 (.ppt · .doc · .xls)', 바이트: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  { 이름: 'PDF', 바이트: [0x25, 0x50, 0x44, 0x46] },                     // %PDF
  { 이름: 'RTF 문서', 바이트: [0x7b, 0x5c, 0x72, 0x74, 0x66] },           // {\rtf
  { 이름: 'PNG 그림', 바이트: [0x89, 0x50, 0x4e, 0x47] },
  { 이름: 'JPEG 그림', 바이트: [0xff, 0xd8, 0xff] },
  { 이름: 'gzip 압축', 바이트: [0x1f, 0x8b] },
  { 이름: '7z 압축', 바이트: [0x37, 0x7a, 0xbc, 0xaf] },
  { 이름: 'RAR 압축', 바이트: [0x52, 0x61, 0x72, 0x21] },
];

/** 앞 몇 바이트로 정체를 짚는다. 모르면 null. */
export function 속내용(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 2) return null;
  for (const s of 서명들) {
    if (s.바이트.every((b, i) => buf[i] === b)) return s.이름;
  }
  const 앞 = buf.subarray(0, 200).toString('latin1').trim().toLowerCase();
  if (/^<(!doctype html|html|\?xml)/.test(앞)) return 앞.startsWith('<?xml') ? 'XML 글' : 'HTML 글';
  // 남은 것이 전부 읽을 수 있는 글자면 그냥 글 파일이다.
  const 이상한바이트 = buf.subarray(0, 512).filter((b) => b < 9 || (b > 13 && b < 32)).length;
  if (!이상한바이트) return '그냥 글 파일';
  return null;
}

/**
 * 겉과 속이 다를 때 하는 말. **길을 같이 준다.**
 *
 * @param {string} 갈래  겉으로 본 갈래 (pptx · docx · hwpx)
 * @param {string|null} 속  속내용() 이 짚은 것
 */
export function 겉속다름말(갈래, 속) {
  const 머리 = `겉은 ${갈래} 인데 속이 다릅니다`;
  if (!속) {
    return `${머리} — 무엇인지 알아보지 못했습니다 (zip 꾸러미가 아닙니다).\n`
      + '  파일이 깨졌을 수 있습니다. 이 파일로는 더 해 볼 것이 없으니 사용자에게 알리세요.';
  }
  if (속.startsWith('옛 Office')) {
    return `${머리} — 실제로는 ${속} 입니다.\n`
      + `  이름만 ${갈래} 로 바뀐 옛 형식이라 이 도구로는 못 읽습니다.\n`
      + `  PowerPoint·Word 에서 열어 ${갈래} 로 다시 저장하거나,\n`
      + `  soffice 가 깔려 있으면 soffice --headless --convert-to ${갈래} <파일> 로 바꾸세요.`;
  }
  if (속 === 'PDF') {
    return `${머리} — 실제로는 PDF 입니다.\n`
      + `  확장자만 ${갈래} 입니다. 파일 이름을 .pdf 로 바꿔서 Read 하면 그대로 읽힙니다.`;
  }
  if (속 === 'HTML 글' || 속 === 'XML 글' || 속 === '그냥 글 파일') {
    return `${머리} — 실제로는 ${속} 입니다.\n`
      + '  글 파일이라 확장자를 .txt 로 바꾸거나 그대로 Bash 로 읽을 수 있습니다.';
  }
  return `${머리} — 실제로는 ${속} 입니다.\n`
    + `  ${갈래} 로 읽을 수 있는 파일이 아닙니다. 이 파일로는 더 해 볼 것이 없으니 사용자에게 알리세요.`;
}

/** 구형 hwp 를 만났을 때 하는 말. 길을 같이 준다. */
export function 옛hwp안내(보인이름) {
  return `구형 hwp 형식이라 읽지 못합니다: ${보인이름}\n`
    + '  한글(한컴오피스)에서 이 파일을 열어 **hwpx 로 저장**하면 그대로 읽을 수 있습니다.\n'
    + '  (다른 이름으로 저장 → 파일 형식에서 hwpx 선택)\n'
    + '  이 파일을 Write 로 새로 만들면 안 됩니다 — 원본이 사라집니다.';
}

/*
 * ── XML → 문단들 ────────────────────────────────────────────────────────
 *
 * 형식마다 태그 이름만 다르고 뼈대는 같다: 문단 태그 사이의 글 태그를 모으고,
 * 표 칸은 | 로 잇는다. 그래서 이름표만 형식별로 두고 걷는 것은 하나다.
 *
 * 이름 앞머리(hp: · w: · a:)는 문서마다 접두어가 다를 수 있어 **끝 이름**으로
 * 견준다. 접두어는 XML 선언부가 정하는 별명일 뿐이라 값이 고정이 아니다.
 */
const 이름표 = {
  hwpx: { 글: 't', 문단: 'p', 표: 'tbl', 행: 'tr', 칸: 'tc', 줄바꿈: null, 탭: null },
  docx: { 글: 't', 문단: 'p', 표: 'tbl', 행: 'tr', 칸: 'tc', 줄바꿈: 'br', 탭: 'tab' },
  pptx: { 글: 't', 문단: 'p', 표: 'tbl', 행: 'tr', 칸: 'tc', 줄바꿈: 'br', 탭: null },
};

const 끝이름 = (name) => {
  const i = name.indexOf(':');
  return i < 0 ? name : name.slice(i + 1);
};

/**
 * XML 한 장을 문단 목록으로.
 *
 * 표는 행마다 한 줄로 펴고 칸을 ` | ` 로 잇는다. 칸을 그냥 이어 붙이면
 * "이름값가1" 같은 덩어리가 되는데, 그건 뜻이 사라진 글이라 안 읽은 것보다
 * 나쁘다 — 모델이 그걸 근거로 답한다.
 */
export function 문단뽑기(xml, 갈래) {
  const 표기 = 이름표[갈래];
  const 문단들 = [];

  let 글모음 = [];        // 지금 문단의 글 조각들
  let 표깊이 = 0;
  let 행칸들 = null;      // 표 행 안일 때: 칸 글들
  let 칸글 = null;        // 표 칸 안일 때: 그 칸의 글 조각들
  let 글안 = false;       // <t> 안인가 — 글 태그 밖의 지시문·수식 글을 안 줍기 위해

  const 문단닫기 = () => {
    const 글 = 글모음.join('').trimEnd();
    글모음 = [];
    if (글.trim()) 문단들.push(글);
  };

  for (const t of tags(xml)) {
    if (t.text !== undefined) {
      if (!글안 || t.blank) continue;
      const 글 = unescapeXml(t.text);
      if (칸글) 칸글.push(글);
      else 글모음.push(글);
      continue;
    }
    const 이름 = 끝이름(t.name);

    if (이름 === 표기.글) { 글안 = !t.closing && !t.selfClosing; continue; }
    if (표기.탭 && 이름 === 표기.탭 && !t.closing) { (칸글 ?? 글모음).push('\t'); continue; }
    if (표기.줄바꿈 && 이름 === 표기.줄바꿈 && !t.closing) { (칸글 ?? 글모음).push('\n'); continue; }

    if (이름 === 표기.표) { 표깊이 += t.closing ? -1 : (t.selfClosing ? 0 : 1); continue; }
    if (표깊이 > 0 && 이름 === 표기.행) {
      if (t.closing) {
        if (행칸들) 문단들.push(행칸들.map((x) => x.trim()).join(' | '));
        행칸들 = null;
      } else {
        행칸들 = [];
      }
      continue;
    }
    if (표깊이 > 0 && 이름 === 표기.칸) {
      if (t.closing) {
        if (행칸들 && 칸글) 행칸들.push(칸글.join(''));
        칸글 = null;
      } else {
        칸글 = [];
      }
      continue;
    }

    if (이름 === 표기.문단 && t.closing && !칸글) 문단닫기();
  }
  문단닫기();   // 안 닫힌 채 끝나는 문서도 있다. 마지막 글을 버리지 않는다.
  return 문단들;
}

/*
 * 형식별로 어느 파일이 알맹이인가.
 *
 * 이름을 **숫자로** 세운다. 글자로 세우면 slide10 이 slide2 앞에 온다 —
 * 장 차례가 뒤섞인 발표 자료는 안 읽은 것보다 나쁘다.
 */
const 알맹이 = {
  hwpx: { 골라 : /^Contents\/section(\d+)\.xml$/i, 구획이름: (n) => `구획 ${n + 1}` },
  docx: { 골라 : /^word\/document\.xml$/i, 구획이름: () => '본문' },
  pptx: { 골라 : /^ppt\/slides\/slide(\d+)\.xml$/i, 구획이름: (n, 번호) => `${번호}장` },
};

/**
 * 문서 하나를 읽는다.
 *
 * @returns {{ok:true, 갈래, 덩이들:[{이름, 문단들}]} | {ok:false, error}}
 * 던지지 않는다 — 깨진 파일은 도구 실행 한가운데서 만나는 것이라,
 * 예외가 나면 "문서가 깨졌다" 가 "도구가 터졌다" 로 보고된다.
 */
export function readDoc(경로또는버퍼) {
  const 갈래 = Buffer.isBuffer(경로또는버퍼) ? null : 종류(경로또는버퍼);
  let buf;
  try {
    buf = Buffer.isBuffer(경로또는버퍼) ? 경로또는버퍼 : readFileSync(경로또는버퍼);
  } catch (err) {
    return { ok: false, error: `못 읽었습니다: ${err.message}` };
  }
  if (!갈래) return { ok: false, error: '어떤 문서인지 모르는 경로입니다' };
  if (!looksZip(buf)) {
    return { ok: false, error: 겉속다름말(갈래, 속내용(buf)), 끝났다: true };
  }

  let 꾸러미;
  try {
    꾸러미 = readZip(buf);
  } catch (err) {
    return { ok: false, error: `꾸러미를 풀지 못했습니다 — ${err.message}` };
  }

  const { 골라, 구획이름 } = 알맹이[갈래];
  const 찾은 = [];
  for (const [이름, 몸] of 꾸러미.files) {
    const m = 골라.exec(이름.replace(/\\/g, '/'));
    if (m) 찾은.push({ 번호: m[1] ? Number(m[1]) : 0, 몸 });
  }
  if (!찾은.length) {
    return { ok: false, error: `${갈래} 꾸러미인데 본문을 찾지 못했습니다. 깨졌거나 비정상 파일입니다.` };
  }
  찾은.sort((a, b) => a.번호 - b.번호);

  const 덩이들 = 찾은.map((s, i) => ({
    이름: 구획이름(i, s.번호),
    문단들: 문단뽑기(s.몸.toString('utf8'), 갈래),
  }));
  return { ok: true, 갈래, 덩이들 };
}

// 다 실어 봐야 창만 찬다. 엑셀(toText)과 같은 상한을 쓴다.
const 최대글자 = 60000;

/**
 * 덩이들을 한 장의 글로.
 *
 * 자르면 잘랐다고 말한다 — 조용히 자르면 모델은 그게 전부인 줄 알고
 * "문서에 그런 내용 없다" 고 답한다.
 */
export function toText(덩이들, { maxChars = 최대글자 } = {}) {
  const 잘림 = [];
  const 조각 = [];
  let 셈 = 0;
  let 여럿 = (덩이들?.length ?? 0) > 1;

  for (const d of 덩이들 ?? []) {
    if (여럿) 조각.push(`--- ${d.이름} ---`);
    for (const 문단 of d.문단들) {
      if (셈 + 문단.length > maxChars) {
        잘림.push(`${maxChars.toLocaleString()}자에서 잘랐습니다 — 뒷부분은 안 실렸습니다`);
        return { text: 조각.join('\n'), 잘림 };
      }
      조각.push(문단);
      셈 += 문단.length + 1;
    }
  }
  return { text: 조각.join('\n'), 잘림 };
}

/** 한 줄 요약. Read 의 summary 자리로 간다. */
export function summarize(r) {
  if (!r?.ok) return '';
  const 문단수 = r.덩이들.reduce((n, d) => n + d.문단들.length, 0);
  const 구획 = r.덩이들.length > 1 ? ` · ${r.갈래 === 'pptx' ? `${r.덩이들.length}장` : `구획 ${r.덩이들.length}개`}` : '';
  return `${r.갈래}${구획} · ${문단수}문단`;
}

/** 고치려 들 때 하는 말. 엑셀과 같은 꼴 — 왜 안 되는지와 그럼 어떻게 하는지. */
export function 문서는못고침(보인이름) {
  const 갈 = 종류(보인이름) ?? '문서';
  return `${갈} 문서는 이 도구로 고칠 수 없습니다: ${보인이름}\n`
    + '  읽기만 됩니다 (글로 바꿔서 보여줍니다). 서식·그림·양식이 든 문서를\n'
    + '  글로 왕복시키면 반드시 뭔가 잃기 때문입니다.\n'
    + `  내용을 바꿔야 한다면 ${basename(String(보인이름))} 은 그대로 두고, 바뀐 내용을\n`
    + '  글 파일(.md 등)로 따로 만들어 사용자에게 건네세요.';
}
