// 이미 깔린 변환기를 빌려 쓰는가 (tools/convert.js).
//
// ── 왜 이걸 재나 ────────────────────────────────────────────────────────
//
// 사내 자료는 형식이 제각각이다. 이름은 .pptx 인데 속은 옛 .ppt 이고, .doc 이고,
// .rtf 다. 그때 여태 이렇게 끝났다 —
//
//   ◧ Read(보고서.pptx)
//     └ pptx 모양이 아닙니다 — 깨졌거나 다른 형식입니다.
//
// 길이 없으니 모델은 같은 파일을 몇 번씩 다시 열었다. 그런데 정작 그 PC 에는
// LibreOffice 가 깔려 있었다 — 사람이 그 파일을 열어 보는 바로 그 프로그램이다.
//
// ── 진짜 LibreOffice 를 깔고 재지 않는다 ────────────────────────────────
//
// 깔아야만 도는 검사는 아무도 안 돌린다. CI 에도 없다. 그래서 **가짜 변환기**를
// 그 자리에 세운다 — 가짜 게이트웨이를 포트 0 으로 띄우는 것과 같은 방식이다.
// 여기서 재려는 것은 LibreOffice 가 잘 도는지가 아니라, **우리가 그것을 어떻게
// 부르고 무엇을 돌려주는가** 다. 그건 가짜로 정확히 잴 수 있다.
import { mkdtempSync, writeFileSync, existsSync, chmodSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOLS } from '../src/tools/index.js';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import {
  바꿔볼까, 변환기찾기, 변환기잊기, 변환기말, 글로바꾸기, 임시자리, 임시치우기,
} from '../src/tools/convert.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

const 윈도우 = process.platform === 'win32';

/**
 * 가짜 soffice 를 만든다.
 *
 * 진짜와 같은 방식으로 답한다 — `--outdir` 자리에 `<이름>.txt` 를 떨군다.
 * 그래야 우리가 "나온 파일을 어떻게 찾는가" 를 진짜와 같은 조건에서 잰다.
 *
 * @param {string} 방  스크립트를 놓을 폴더
 * @param {object} o
 * @param {boolean} o.아무것도안함  글을 안 뽑는 변환기 (실패하는 길을 재려고)
 */
function 가짜변환기(방, { 아무것도안함 = false } = {}) {
  /*
   * 스크립트를 **줄 배열로** 짓는다. 템플릿 안에 템플릿을 넣으면 역슬래시가
   * 몇 겹인지 사람이 못 센다 — 처음에 그렇게 썼다가 생성된 파일에 진짜 줄바꿈이
   * 박혀서 SyntaxError 가 났다. 검사 도우미가 조용히 안 도는 것이 제일 나쁘다.
   */
  // 파일 이름은 ASCII 로. cmd.exe 는 .cmd 파일 **내용**을 CP949 로 읽어서,
  // 한글이 든 경로를 적어 두면 그 줄이 통째로 깨진다(?щ?由?cjs). 인자로
  // 넘어가는 한글은 멀쩡하다 — 깨지는 것은 배치 파일에 적힌 글자다.
  const 심부름 = join(방, 'stub-converter.cjs');
  const 뽑을글 = ['분기 실적 보고', '', '1. 매출 120억', '2. 영업이익 8억'].join('\n');
  writeFileSync(심부름, [
    "const fs = require('fs'); const path = require('path');",
    'const argv = process.argv.slice(2);',
    "if (argv.includes('--version')) { console.log('가짜 LibreOffice 7.0'); process.exit(0); }",
    "const i = argv.indexOf('--outdir');",
    'const outdir = i >= 0 ? argv[i + 1] : null;',
    'const src = argv[argv.length - 1];',
    'if (!outdir || !src) process.exit(1);',
    ...(아무것도안함 ? ['process.exit(0);'] : [
      "const 이름 = path.basename(src).replace(/[.][^.]*$/, '') + '.txt';",
      `fs.writeFileSync(path.join(outdir, 이름), ${JSON.stringify(뽑을글)}, 'utf8');`,
    ]),
  ].join('\n'), 'utf8');

  const 자리 = join(방, 윈도우 ? 'soffice.cmd' : 'soffice');
  if (윈도우) {
    writeFileSync(자리, `@echo off\r\n"${process.execPath}" "${심부름}" %*\r\n`, 'utf8');
  } else {
    writeFileSync(자리, `#!/bin/sh\nexec "${process.execPath}" "${심부름}" "$@"\n`, 'utf8');
    chmodSync(자리, 0o755);
  }
  return 자리;
}

const 옛ppt = () => Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(600, 0),
]);

trace('1-고르기');

// ── 1. 무엇을 바꿔 볼까 ────────────────────────────────────────────────
{
  check('옛 Office 는 바꿔 본다', 바꿔볼까('a.ppt') && 바꿔볼까('b.doc') && 바꿔볼까('c.xls'));
  check('겉만 그 이름인 것도 바꿔 본다', 바꿔볼까('보고서.pptx'), 'pptx');
  check('글 파일은 안 건드린다', !바꿔볼까('a.txt') && !바꿔볼까('b.md'));
  check('그림·압축은 안 건드린다', !바꿔볼까('a.png') && !바꿔볼까('b.zip'));
  check('확장자가 없어도 안 죽는다', !바꿔볼까('README') && !바꿔볼까(null));
}

trace('2-끄기');

// ── 2. 끌 수 있다 ──────────────────────────────────────────────────────
//
// rg 를 끄는 자리(DEEL_GREP=js)와 같은 이유다. 결과가 의심될 때 같은 자리에서
// 견줄 수 있어야 한다. 끄면 **왜 껐는지**도 말해야 한다.
{
  const 껐을때 = 변환기찾기({ 다시: true, env: { DEEL_CONVERT: 'off' } });
  check('★ DEEL_CONVERT=off 면 안 찾는다', !껐을때.soffice && !껐을때.textutil, JSON.stringify(껐을때));
  check('왜 껐는지 말한다', /꺼 두었습니다/.test(변환기말(껐을때)), 변환기말(껐을때));
  변환기잊기();

  // 맥이 아니면 textutil 은 없다. 있는 척하면 안 되는 명령을 부르게 된다.
  const 리눅스 = 변환기찾기({ 다시: true, env: {}, platform: 'linux' });
  check('맥이 아니면 textutil 을 안 쓴다', 리눅스.textutil === false, JSON.stringify(리눅스.textutil));
  변환기잊기();
}

trace('3-바꾸기');

// ── 3. 실제로 글을 뽑아 오는가 ─────────────────────────────────────────
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-conv-'));
  const soffice = 가짜변환기(방);
  const 파일 = join(방, '보고서.ppt');
  writeFileSync(파일, 옛ppt());

  const r = 글로바꾸기(파일, 방, { 찾은것: { soffice, textutil: false, 왜: null } });
  check('★ 글을 뽑아 온다', r.ok === true, JSON.stringify(r).slice(0, 120));
  check('뽑은 글이 진짜 내용이다', /분기 실적 보고/.test(r.text ?? ''), (r.text ?? '').slice(0, 40));
  check('무엇으로 뽑았는지 말한다', r.쓴것 === 'soffice', String(r.쓴것));

  /*
   * ★ 떨군 자리가 작업 폴더 안이어야 한다.
   *
   * /tmp 에 쓰면 울타리를 우리 손으로 넘는 셈이고, 남긴 것을 거둘 자리도 없다.
   * 모델에게는 .deel/tmp 를 쓰라고 해 놓고 우리가 밖에 쓰면 말이 안 맞는다.
   */
  check('★ 바꾼 것을 작업 폴더 안에 떨군다',
    String(r.파일 ?? '').startsWith(임시자리(방)), `${r.파일} · ${임시자리(방)}`);
  check('원본은 그대로다', existsSync(파일) && Buffer.compare(옛ppt(), readFileSync(파일)) === 0, '');

  /*
   * ★ 읽고 나면 사본을 남기지 않는다.
   *
   * 뽑은 글은 **사람 문서의 알맹이**다. 그것이 작업 폴더에 파일로 남으면
   * 그대로 커밋되거나 압축되어 나갈 수 있다. 「나중에 거두겠다」는 약속은
   * 세션이 중간에 죽으면 안 지켜지므로, 읽는 그 자리에서 지운다.
   */
  check('★ 읽고 나면 사본을 안 남긴다', !existsSync(r.파일), r.파일);
  check('.deel/tmp 에 글이 안 쌓인다',
    !readdirSync(임시자리(방)).some((f) => f.toLowerCase().endsWith('.txt')),
    readdirSync(임시자리(방)).join(','));

  // 그래도 쓸어담는 손은 남겨 둔다 — 지우다 실패한 것(파일 잠김 등)이 있을 수 있다.
  writeFileSync(join(임시자리(방), '남은것.txt'), '지난번에 못 지운 것');
  const 거둔것 = 임시치우기(방);
  check('못 지우고 남은 것도 나중에 거둔다', 거둔것 >= 1, `${거둔것}개`);
  check('거두고 나면 남지 않는다',
    !readdirSync(임시자리(방)).some((f) => f.endsWith('.txt')), readdirSync(임시자리(방)).join(','));

  rmSync(방, { recursive: true, force: true });
}


trace('4-못뽑았을때');

// ── 4. 변환기가 있어도 못 뽑으면 그렇다고 한다 ─────────────────────────
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-conv2-'));
  const soffice = 가짜변환기(방, { 아무것도안함: true });
  const 파일 = join(방, '빈것.ppt');
  writeFileSync(파일, 옛ppt());

  const r = 글로바꾸기(파일, 방, { 찾은것: { soffice, textutil: false, 왜: null } });
  check('★ 못 뽑았으면 성공이라고 안 한다', r.ok === false, JSON.stringify(r).slice(0, 120));
  check('왜 못 했는지 말한다', /글을 못 뽑았습니다/.test(r.왜 ?? ''), r.왜 ?? '');

  // 변환기가 아예 없을 때와 못 뽑았을 때는 사람이 할 일이 다르다.
  const 없을때 = 글로바꾸기(파일, 방, { 찾은것: { soffice: null, textutil: false, 왜: null } });
  check('변환기가 없는 것과 못 뽑은 것을 가른다', 없을때.없음 === true && r.없음 !== true,
    `${없을때.없음} / ${r.없음}`);

  rmSync(방, { recursive: true, force: true });
}

trace('5-Read로');

// ── 5. Read 가 실제로 빌려 쓰는가 ──────────────────────────────────────
//
// 여기가 사람이 겪는 자리다. 위 조각들이 다 맞아도 Read 가 안 부르면 아무 일도
// 안 일어난다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-conv3-'));
  const soffice = 가짜변환기(방);
  // 겉은 pptx, 속은 옛 ppt — 사장님이 실제로 만난 그 파일이다.
  writeFileSync(join(방, '보고서.pptx'), 옛ppt());

  const 판 = (변환기) => ({
    scope: makeScope(방), history: new History(방), audit: new Audit(방),
    seen: new Set(), 모델컨텍스트: 200000, enc: new Map(), 변환기,
  });

  // ① 변환기가 없으면 — 까닭과 길을 준다 (빌리지는 못한다).
  const 없이 = await TOOLS.Read.run({ file_path: '보고서.pptx' }, 판({ soffice: null, textutil: false, 왜: null }));
  check('변환기가 없으면 정체와 길을 말한다',
    /옛 Office/.test(없이.error ?? '') && /soffice/.test(없이.error ?? ''),
    (없이.error ?? '').split('\n')[0]);
  // docs.js 가 '다시 열어도 같다' 고 판정한 것을 Read 가 그대로 넘겨야 한다.
  // 여기서 떨구면 되풀이 억제가 안 걸려서, 모델이 같은 파일을 계속 연다.
  check('★ 끝난 실패라는 표시를 떨구지 않는다', 없이.끝났다 === true, String(없이.끝났다));

  // ② 변환기가 있으면 — 그냥 읽어 준다.
  const 있이 = await TOOLS.Read.run({ file_path: '보고서.pptx' }, 판({ soffice, textutil: false, 왜: null }));
  check('★ 변환기가 있으면 Read 가 빌려서 읽어 준다', !있이.error && /분기 실적 보고/.test(있이.content ?? ''),
    있이.error ?? (있이.content ?? '').slice(0, 50));
  check('빌려 읽었다는 것을 화면에 말한다', /바꿔 읽음/.test(있이.summary ?? ''), 있이.summary);
  check('원본이 안 바뀐다고 못 박는다', /원본은 한 글자도 안 바뀌었습니다/.test(있이.content ?? ''), '');
  check('고칠 수 없는 파일이라는 것도 같이 말한다', /Edit\/Write 로 고칠 수 없습니다/.test(있이.content ?? ''), '');
  // 왜 직접 못 읽었는지가 남아야 한다 — 다음에 같은 파일을 만났을 때 판단 근거다.
  check('원래 못 읽은 까닭도 남긴다', /원래 못 읽은 까닭/.test(있이.content ?? ''), '');

  임시치우기(방);
  rmSync(방, { recursive: true, force: true });
}

trace('6-옛확장자');

// ── 6. 확장자가 진짜 옛 형식일 때 (.ppt · .doc · .xls) ─────────────────
//
// 5번은 겉이 .pptx 라서 문서 갈래로 흘러갔다. 진짜 .ppt 는 그 길로 안 간다 —
// 여태 맨 아래 일반 읽기까지 떨어져 `바이너리 파일입니다 — 텍스트로 읽을 수
// 없습니다` 로 끝났다. 까닭도 길도 없는 거절이라 모델이 같은 문을 또 두드린다.
// 사내 자료에 제일 흔한 갈래가 하필 이것들이라 여기가 제일 아팠다.
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-conv4-'));
  const soffice = 가짜변환기(방);
  for (const 이름 of ['보고서.ppt', '기안.doc', '집계.xls']) writeFileSync(join(방, 이름), 옛ppt());

  const 판 = (변환기) => ({
    scope: makeScope(방), history: new History(방), audit: new Audit(방),
    seen: new Set(), 모델컨텍스트: 200000, enc: new Map(), 변환기,
  });

  const 없음 = { soffice: null, textutil: false, 왜: null };

  /*
   * 터지는 것도 실패로 세려고 감싼다.
   *
   * 고치기 전 이 자리는 오류를 **던졌다**(`바이너리 파일입니다`). 안 감싸면
   * 검사가 통째로 죽어서 「0개 실패」 로 보이고, 되돌려 보는 검사가 아무것도
   * 못 잡는다. 실제로 그렇게 한 번 속았다.
   */
  const 읽어보기 = async (이름, 변환기) => {
    try { return await TOOLS.Read.run({ file_path: 이름 }, 판(변환기)); }
    catch (e) { return { error: `던졌습니다: ${e.message}` }; }
  };

  // ① 변환기가 없을 때 — '바이너리' 로 끝내지 않는다.
  const 맨ppt = await 읽어보기('보고서.ppt', 없음);
  check('★ 오류를 던지지 않고 돌려준다', !/던졌습니다/.test(맨ppt.error ?? ''), 맨ppt.error ?? '');
  check('★ .ppt 를 바이너리라고 끝내지 않는다', !/바이너리/.test(맨ppt.error ?? ''), 맨ppt.error ?? '(오류없음)');
  check('무엇이라서 못 읽는지 말한다', /\.ppt/.test(맨ppt.error ?? ''), (맨ppt.error ?? '').split('\n')[0]);
  check('무엇이 없어서 못 바꾸는지 말한다', /LibreOffice/.test(맨ppt.error ?? ''), '');
  check('사람이 할 일을 말한다', /pptx 로 저장/.test(맨ppt.error ?? ''), '');
  // 여기가 토큰을 아끼는 자리다. 다시 열어도 결과가 같은 것은 우리가 안다.
  check('★ 다시 열지 말라고 못 박는다', /다시 Read 하지 마세요/.test(맨ppt.error ?? ''), '');
  check('★ 끝난 실패라고 표시한다 (되풀이 억제)', 맨ppt.끝났다 === true, String(맨ppt.끝났다));

  // 갈래마다 갈 길이 다르다. .doc 을 pptx 로 저장하라고 하면 아무 도움이 안 된다.
  const 맨doc = await 읽어보기('기안.doc', 없음);
  check('.doc 에는 docx 로 저장하라고 한다', /docx 로 저장/.test(맨doc.error ?? ''), (맨doc.error ?? '').split('\n')[2] ?? '');
  const 맨xls = await 읽어보기('집계.xls', 없음);
  check('.xls 에는 xlsx 로 저장하라고 한다', /xlsx 로 저장/.test(맨xls.error ?? ''), (맨xls.error ?? '').split('\n')[2] ?? '');

  // ② 변환기가 있을 때 — 말만 하지 말고 실제로 읽어 준다.
  const 빌림 = await 읽어보기('보고서.ppt', { soffice, textutil: false, 왜: null });
  check('★ 변환기가 있으면 .ppt 도 읽어 준다', !빌림.error && /분기 실적 보고/.test(빌림.content ?? ''),
    빌림.error ?? (빌림.content ?? '').slice(0, 50));
  check('빌려 읽었다고 화면에 말한다', /바꿔 읽음/.test(빌림.summary ?? ''), 빌림.summary);

  // 빌려 읽은 파일은 고치는 물건이 아니다. seen 에 들어가면 Edit 이 열린다.
  check('★ 빌려 읽어도 Edit 이 열리지 않는다', !판(soffice).seen.has(join(방, '보고서.ppt')), '');

  // 원본은 한 바이트도 안 바뀐다. 변환은 읽기의 곁길이다.
  check('원본이 바이트까지 그대로다',
    Buffer.compare(옛ppt(), readFileSync(join(방, '보고서.ppt'))) === 0, '');

  // 우리가 읽을 수 있는 형식까지 이 길로 새면 안 된다 — 느려지고, 원본 대신
  // 변환기가 뽑은 요약본을 보게 된다.
  writeFileSync(join(방, '메모.txt'), '그냥 글입니다\n');
  const 글 = await 읽어보기('메모.txt', { soffice, textutil: false, 왜: null });
  check('평범한 글 파일은 이 길로 안 샌다', !글.error && /그냥 글입니다/.test(글.content ?? ''), 글.error ?? '');

  /*
   * 반대쪽 울타리. 우리가 **직접 읽을 줄 아는** 갈래(.xlsx·.docx·.pptx)가
   * 안 읽힐 때는 이 일반 안내가 아니라 그 갈래의 제 오류가 나가야 한다.
   * 「.xlsx 를 pdf 로 저장하세요」 같은 엉뚱한 길을 주면, 사람은 멀쩡한
   * 파일을 두고 헛수고를 한다. 여기를 안 재면 넓게 잡아 놓고도 초록이 된다.
   */
  const OLE = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)]);
  writeFileSync(join(방, '깨진.xlsx'), OLE);
  const 깨진 = await 읽어보기('깨진.xlsx', 없음);
  check('★ 우리가 읽을 줄 아는 갈래는 제 오류를 낸다',
    /엑셀/.test(깨진.error ?? '') && !/다시 Read 하지 마세요/.test(깨진.error ?? ''),
    (깨진.error ?? '').split('\n')[0]);
  // 그래도 변환기가 있으면 빌려서 읽어 준다 — 안내와 빌리기는 다른 이야기다.
  const 깨진빌림 = await 읽어보기('깨진.xlsx', { soffice, textutil: false, 왜: null });
  check('그래도 변환기가 있으면 빌려는 본다', /분기 실적 보고/.test(깨진빌림.content ?? ''),
    깨진빌림.error ?? '');

  임시치우기(방);
  rmSync(방, { recursive: true, force: true });
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n변환기 빌려쓰기 검사  ${D}(깔린 것이 있으면 쓰고, 없으면 없다고 말하는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
