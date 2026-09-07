/**
 * hwpx 만들기 — 글 → 한글 문서.
 *
 * ── 왜 만드나 ───────────────────────────────────────────────────────────
 *
 * 읽기(tools/docs.js)를 넣고 나서 남은 말이 늘 같았다. 「읽어 주는 건 알겠는데,
 * 결과를 그 서식으로 주면 안 되나요.」
 *
 * 사내에서 오가는 것은 md 가 아니다. 주간보고도 회의록도 검토 의견도 한글
 * 문서다. 지금까지는 deel 이 md 를 내놓고 사람이 그걸 한글에 붙여 넣어 서식을
 * 다시 잡았다. 그 붙여넣기가 하루에 몇 번씩이다.
 *
 * ── 고치기는 여전히 안 한다 ────────────────────────────────────────────
 *
 * docs.js 가 「문서는 못 고침」 이라고 못 박은 것은 그대로다. 서식·그림·양식이
 * 든 문서를 글로 왕복시키면 반드시 뭔가 잃고, 잃은 채로 저장된 문서는 겉보기에
 * 멀쩡해서 알아차렸을 때는 원본이 없다.
 *
 * **새로 만드는 것은 다르다.** 잃을 원본이 없다. 그래서 여기서 하는 일은 하나뿐
 * 이다 — 빈 종이에 글을 적어 hwpx 로 내놓는다. 있는 파일을 덮어쓰지도 않는다.
 *
 * ── 무엇을 옮기고 무엇을 안 옮기나 ─────────────────────────────────────
 *
 *   옮긴다    제목 세 단계(#·##·###) · 문단 · 글머리표(-·*·1.) · 빈 줄
 *   안 옮긴다 표 · 그림 · 굵게·기울임 · 링크
 *
 * 표를 안 넣는 것은 **못 해서가 아니라 확인할 수 없어서**다. OWPML 의 표는 칸
 * 크기·여백·병합을 다 적어야 하고, 그 중 하나가 틀리면 한글이 **파일 전체**를
 * 안 연다. 이 자리에는 한글이 없어서 「열린다」 를 잴 방법이 없다. 문단만 있는
 * 문서는 구조가 단순해 어긋날 자리가 거의 없고, 표는 그 반대다. 표는 줄 글로
 * 적어 내보내고 **그렇게 했다고 말한다** — 조용히 빼면 사람은 표가 사라진 것을
 * 나중에야 안다.
 *
 * ── 규격에 대해 ────────────────────────────────────────────────────────
 *
 * hwpx 는 ZIP + XML 이다(한컴 공개 규격 OWPML). 우리 zip 쓰개(pack/zip.js)와
 * 글자 이어붙이기면 되고, 새로 들이는 것이 없다 — 읽기와 같은 자세다.
 *
 * `mimetype` 은 **맨 앞에, 안 눌러서** 담는다. ZIP 을 안 풀고도 앞머리만 보고
 * 무슨 파일인지 알게 하려는 규약이다. pack/zip.js 는 눌러서 커지면 그냥 담으므로
 * (20바이트짜리는 늘 그렇다) 차례만 맞추면 된다.
 */
import { makeZip } from '../pack/zip.js';

/** 1pt = 100 HWPUNIT. 규격이 그렇다. */
const PT = 100;
/** 한 문단이 이보다 길면 자른다. 모델이 통째로 쏟아붓는 것을 막는다. */
export const 문단최대 = 20000;
/** 문단 수 상한. 넘으면 자르고 **잘랐다고 말한다.** */
export const 문단수최대 = 5000;

const 갈래 = { 제목1: 1, 제목2: 2, 제목3: 3, 본문: 0, 글머리: 0 };

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  /*
   * XML 1.0 이 아예 못 담는 제어문자를 걷어낸다.
   *
   * 모델이 낸 글에 이런 것이 섞이는 일이 실제로 있다 — 터미널 출력을 그대로
   * 옮겨 적으면 ESC(0x1B)가 딸려 온다. 남겨 두면 한글이 **파일 전체**를 안 여는데,
   * 화면에는 「손상된 문서」 한 줄만 뜼다. 글자 몇 개를 잃는 쪽이 문서를 통째로
   * 잃는 쪽보다 낫다.
   */
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

/**
 * 글을 문단 목록으로 읽는다.
 *
 * 마크다운을 다 아는 척하지 않는다. 우리가 내놓는 글에 실제로 들어 있는 것만
 * 본다 — 제목, 글머리표, 문단. 굵게·링크 같은 것은 **글자 그대로** 남긴다.
 * 지우면 `**중요**` 가 `중요` 가 되어 강조가 사라지고, 옮기려 들면 서식 조합이
 * 폭발한다. 남기면 적어도 사람이 무엇을 뜻했는지 읽을 수 있다.
 *
 * @returns {{문단들: Array<{갈래:string, 글:string}>, 잘림: number, 표몇개: number}}
 */
export function 글읽기(글) {
  const 줄들 = String(글 ?? '').replace(/\r\n?/g, '\n').split('\n');
  const 문단들 = [];
  let 표몇개 = 0;
  let 이어붙일것 = null;

  const 닫기 = () => {
    if (이어붙일것 && 이어붙일것.글.trim()) 문단들.push(이어붙일것);
    이어붙일것 = null;
  };

  for (const 날것 of 줄들) {
    const 줄 = 날것.replace(/\s+$/, '');
    if (!줄.trim()) { 닫기(); continue; }

    const 제목 = /^(#{1,3})\s+(.*)$/.exec(줄);
    if (제목) {
      닫기();
      문단들.push({ 갈래: `제목${제목[1].length}`, 글: 제목[2].trim() });
      continue;
    }

    /*
     * 표는 줄 글로 내보낸다. 그리고 **몇 개였는지 센다** — 부르는 쪽이
     * 그 수를 사람에게 말한다. 조용히 바꿔치기하면 사람은 표가 글이 된 것을
     * 문서를 열어 보고서야 안다.
     */
    if (/^\s*\|.*\|\s*$/.test(줄)) {
      // 표의 구분선(|---|---|)은 글로 옮길 것이 없다.
      if (/^\s*\|[\s:|-]+\|\s*$/.test(줄)) { 표몇개 += 1; continue; }
      닫기();
      문단들.push({ 갈래: '본문', 글: 줄.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((x) => x.trim()).join('  ·  ') });
      continue;
    }

    const 글머리 = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(줄);
    if (글머리) {
      닫기();
      // 한글의 글머리표 규격을 안 쓴다. 문자 하나로 적으면 어느 한글 판에서도
      // 똑같이 보이고, 서식이 어긋날 자리가 없다.
      const 표시 = /^\d/.test(글머리[1]) ? `${글머리[1]} ` : '· ';
      문단들.push({ 갈래: '글머리', 글: `${표시}${글머리[2].trim()}` });
      continue;
    }

    // 이어지는 줄은 한 문단으로 붙인다. 마크다운의 규칙이고, 한글에서도
    // 줄마다 문단을 끊으면 줄 간격이 통째로 어색해진다.
    if (이어붙일것) 이어붙일것.글 += ` ${줄.trim()}`;
    else 이어붙일것 = { 갈래: '본문', 글: 줄.trim() };
  }
  닫기();

  let 잘림 = 0;
  if (문단들.length > 문단수최대) { 잘림 = 문단들.length - 문단수최대; 문단들.length = 문단수최대; }
  for (const p of 문단들) if (p.글.length > 문단최대) p.글 = `${p.글.slice(0, 문단최대)} …(잘림)`;
  return { 문단들, 잘림, 표몇개 };
}

// ── 이하 규격 조각들 ────────────────────────────────────────────────────

const 머리 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const VERSION_XML = `${머리}
<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1" xmlVersion="1.4" application="deel" appVersion="1.0"/>`;

const CONTAINER_XML = `${머리}
<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf">
<ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles>
</ocf:container>`;

const MANIFEST_XML = `${머리}
<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" odf:version="1.2">
<odf:file-entry odf:full-path="/" odf:media-type="application/hwp+zip"/>
</odf:manifest>`;

const SETTINGS_XML = `${머리}
<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="http://www.hancom.co.kr/hwpml/2011/configuration">
<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/>
</ha:HWPApplicationSetting>`;

const contentHpf = (제목) => `${머리}
<opf:package xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:dc="http://purl.org/dc/elements/1.1/" version="" unique-identifier="" id="">
<opf:metadata>
<opf:title>${esc(제목)}</opf:title>
<opf:language>ko</opf:language>
<opf:meta name="creator" content="deel"/>
</opf:metadata>
<opf:manifest>
<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>
<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
<opf:item id="settings" href="settings.xml" media-type="application/xml"/>
</opf:manifest>
<opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine>
</opf:package>`;

/*
 * 글자·문단 모양표.
 *
 * 네 벌만 둔다 — 본문과 제목 셋. 더 두면 그만큼 어긋날 자리가 늘고, 우리가
 * 내놓는 글에는 그 이상이 없다.
 *
 * 글꼴은 **이름만 적고 안 싣는다.** 사내 PC 에 함초롬바탕이 없는 일은 거의
 * 없고, 없더라도 한글이 알아서 대체한다. 글꼴 파일을 담기 시작하면 그건
 * 저작권을 우리가 지고 가는 일이다.
 */
const HEADER_XML = `${머리}
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" version="1.4" secCnt="1">
<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>
<hh:refList>
<hh:fontfaces itemCnt="1">
<hh:fontface lang="HANGUL" fontCnt="1"><hh:font id="0" face="함초롬바탕" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="0" proportion="0" contrast="0" strokeVariation="0" armStyle="0" letterform="0" midline="0" xHeight="0"/></hh:font></hh:fontface>
</hh:fontfaces>
<hh:borderFills itemCnt="1"><hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/><hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/><hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/><hh:topBorder type="NONE" width="0.1 mm" color="#000000"/><hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/><hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/></hh:borderFill></hh:borderFills>
<hh:charProperties itemCnt="4">
${[[0, 10], [1, 16], [2, 14], [3, 12]].map(([id, pt]) => `<hh:charPr id="${id}" height="${pt * PT}" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>${id === 0 ? '' : '<hh:bold/>'}</hh:charPr>`).join('\n')}
</hh:charProperties>
<hh:paraProperties itemCnt="4">
${[0, 1, 2, 3].map((id) => `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:align horizontal="JUSTIFY" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/><hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="${id === 0 ? '0' : '1'}" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/><hh:margin><hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/><hc:prev value="${id === 0 ? 0 : 800}" unit="HWPUNIT"/><hc:next value="${id === 0 ? 0 : 300}" unit="HWPUNIT"/></hh:margin><hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/><hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/></hh:paraPr>`).join('\n')}
</hh:paraProperties>
<hh:styles itemCnt="4">
${[['바탕글', 'Normal', 0], ['개요 1', 'Outline 1', 1], ['개요 2', 'Outline 2', 2], ['개요 3', 'Outline 3', 3]].map(([이름, 영, id]) => `<hh:style id="${id}" type="PARA" name="${이름}" engName="${영}" paraPrIDRef="${id}" charPrIDRef="${id}" nextStyleIDRef="0" langID="1042" lockForm="0"/>`).join('\n')}
</hh:styles>
</hh:refList>
</hh:head>`;

const 문단XML = (p, 번호) => {
  const id = 갈래[p.갈래] ?? 0;
  return `<hp:p id="${번호}" paraPrIDRef="${id}" styleIDRef="${id}" pageBreak="0" columnBreak="0" merged="0">`
    + `<hp:run charPrIDRef="${id}"><hp:t>${esc(p.글)}</hp:t></hp:run>`
    + `<hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000" baseline="850" spacing="600" horzpos="0" horzsize="42520" flags="393216"/></hp:linesegarray>`
    + '</hp:p>';
};

const sectionXML = (문단들) => `${머리}
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
${(문단들.length ? 문단들 : [{ 갈래: '본문', 글: '' }]).map(문단XML).join('\n')}
</hs:sec>`;

/**
 * 글을 hwpx 한 덩이(Buffer)로 만든다.
 *
 * 파일로 쓰지 않는다 — 쓰는 자리는 울타리(safety/guard.js)를 지나야 하고,
 * 그 판단은 도구 쪽이 한다. 여기는 바이트만 만든다.
 *
 * @param {string} 글       마크다운스러운 글
 * @param {object} [o]
 * @param {string} [o.제목] 문서 속성의 제목. 안 주면 첫 제목 줄, 그것도 없으면 '문서'
 * @returns {{buf: Buffer, 문단수: number, 잘림: number, 표몇개: number, 제목: string}}
 */
export function hwpx만들기(글, { 제목 = null } = {}) {
  const { 문단들, 잘림, 표몇개 } = 글읽기(글);
  const 쓸제목 = String(제목 ?? '').trim()
    || 문단들.find((p) => p.갈래.startsWith('제목'))?.글
    || '문서';

  /*
   * 미리보기 글을 같이 담는다.
   *
   * 한글은 이걸로 파일 목록의 미리보기를 그리고, 윈도우 탐색기의 내용 검색도
   * 이 파일을 본다. 없다고 안 열리지는 않지만, 없으면 **사내 공유폴더에서
   * 검색이 안 걸린다** — 문서를 만들어 주는 값의 절반이 거기 있다.
   */
  const 미리보기 = 문단들.map((p) => p.글).join('\n').slice(0, 3000);

  const 담을것 = [
    // mimetype 은 맨 앞에. 20바이트라 눌러도 커지므로 그냥 담긴다 (pack/zip.js).
    { name: 'mimetype', data: Buffer.from('application/hwp+zip', 'utf8') },
    { name: 'version.xml', data: Buffer.from(VERSION_XML, 'utf8') },
    { name: 'META-INF/container.xml', data: Buffer.from(CONTAINER_XML, 'utf8') },
    { name: 'META-INF/manifest.xml', data: Buffer.from(MANIFEST_XML, 'utf8') },
    { name: 'Contents/content.hpf', data: Buffer.from(contentHpf(쓸제목), 'utf8') },
    { name: 'Contents/header.xml', data: Buffer.from(HEADER_XML, 'utf8') },
    { name: 'Contents/section0.xml', data: Buffer.from(sectionXML(문단들), 'utf8') },
    { name: 'Preview/PrvText.txt', data: Buffer.from(미리보기, 'utf8') },
    { name: 'settings.xml', data: Buffer.from(SETTINGS_XML, 'utf8') },
  ];
  return { buf: makeZip(담을것), 문단수: 문단들.length, 잘림, 표몇개, 제목: 쓸제목 };
}

/**
 * 만들고 나서 사람에게 할 말.
 *
 * **바꿔치기한 것을 반드시 적는다.** 표를 줄 글로 폈으면 그렇다고 적고, 문단을
 * 잘랐으면 몇 개를 잘랐는지 적는다. 조용히 넘기면 사람은 문서를 열어 보고서야
 * 알고, 그때는 이미 그 문서를 남에게 보낸 뒤다.
 */
export function 만든말(r, 보인이름) {
  const 줄 = [`${보인이름} · ${r.문단수}문단`];
  if (r.표몇개) 줄.push(`표 ${r.표몇개}개는 줄 글로 폈습니다 (표 서식은 안 만듭니다)`);
  if (r.잘림) 줄.push(`문단 ${r.잘림}개는 넘쳐서 잘랐습니다`);
  return 줄.join(' · ');
}
