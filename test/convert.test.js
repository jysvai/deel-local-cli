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
  바꿔볼까, 변환기찾기, 변환기잊기, 변환기말, 글로바꾸기, 임시자리, 임시치우기, soffice이름들,
} from '../src/tools/convert.js';
import { 돌려보기, 무리로돌리기 } from '../src/tools/spawn.js';
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
 * @param {number}  o.종료코드      이 코드로 끝난다 (0 이 아니면 반쪽만 남기고 죽는 길)
 * @param {boolean} o.프로필만들기  -env:UserInstallation 자리에 프로필을 판다 (진짜가 하는 짓)
 */
function 가짜변환기(방, { 아무것도안함 = false, 종료코드 = 0, 프로필만들기 = false } = {}) {
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
    // 진짜 soffice 는 -env:UserInstallation 자리에 제 프로필을 판다. 그 안에 **사람 문서의
    // 캐시**가 남으므로, 우리가 그것까지 거두는지 재려면 가짜도 똑같이 파야 한다.
    ...(프로필만들기 ? [
      "const 프 = argv.find((a) => a.startsWith('-env:UserInstallation='));",
      "if (프) { const d = 프.slice('-env:UserInstallation=file:///'.length);",
      "  fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'user.rdb'), '사람 문서 캐시'); }",
    ] : []),
    ...(아무것도안함 ? [] : [
      "const 이름 = path.basename(src).replace(/[.][^.]*$/, '') + '.txt';",
      `fs.writeFileSync(path.join(outdir, 이름), ${JSON.stringify(뽑을글)}, 'utf8');`,
    ]),
    `process.exit(${종료코드});`,
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

  const r = await 글로바꾸기(파일, 방, { 찾은것: { soffice, textutil: false, 왜: null } });
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

  const r = await 글로바꾸기(파일, 방, { 찾은것: { soffice, textutil: false, 왜: null } });
  check('★ 못 뽑았으면 성공이라고 안 한다', r.ok === false, JSON.stringify(r).slice(0, 120));
  check('왜 못 했는지 말한다', /글을 못 뽑았습니다/.test(r.왜 ?? ''), r.왜 ?? '');

  // 변환기가 아예 없을 때와 못 뽑았을 때는 사람이 할 일이 다르다.
  const 없을때 = await 글로바꾸기(파일, 방, { 찾은것: { soffice: null, textutil: false, 왜: null } });
  check('변환기가 없는 것과 못 뽑은 것을 가른다', 없을때.없음 === true && r.없음 !== true,
    `${없을때.없음} / ${r.없음}`);

  rmSync(방, { recursive: true, force: true });
}

trace('4b-성공실패가르기');

/*
 * ── 4b. 성공과 실패를 무엇으로 가르나 (8회차) ───────────────────────────
 *
 * 규칙은 하나다 — **종료코드 0 과 결과 파일, 둘 다** 있어야 성공이다.
 * 한쪽만 보던 때 두 자리가 서로 **반대 방향**으로 틀려 있었다.
 *
 *   · 종료코드 1 로 죽으면서 반쪽 txt 를 남긴 것을 `ok:true` 로 돌려줬다.
 *     그 깨진 글이 그대로 모델에게 갔고, 모델은 그것이 문서 전부인 줄 안다.
 *   · 멀쩡히 끝냈는데 받을곳에 지난번 같은 이름 txt 가 남아 있으면
 *     「변환기가 글을 못 뽑았습니다」 로 돌려줬다 — 성공을 실패로 뒤집었다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-conv5-'));
  const 파일 = join(방, '보고서.ppt');
  writeFileSync(파일, 옛ppt());

  // ① 죽으면서 남긴 반쪽 글을 성공이라 하지 않는다.
  const 죽는놈 = 가짜변환기(방, { 종료코드: 1 });
  const 죽음 = await 글로바꾸기(파일, 방, { 찾은것: { soffice: 죽는놈, textutil: false, 왜: null } });
  check('★★ 종료코드가 0 이 아니면 성공이라 하지 않는다', 죽음.ok === false,
    JSON.stringify({ ok: 죽음.ok, text: (죽음.text ?? '').slice(0, 30) }));
  check('★ 몇 번으로 죽었는지 말한다', /종료 1/.test(죽음.왜 ?? ''), 죽음.왜 ?? '');
  // 반쪽 글도 사람 문서의 조각이다. 실패한 자리에 남기면 그대로 커밋에 딸려 나간다.
  check('★ 죽으면서 남긴 반쪽 글을 안 남긴다',
    !readdirSync(임시자리(방)).some((f) => f.toLowerCase().endsWith('.txt')),
    readdirSync(임시자리(방)).join(','));

  // ② 지난번 사본이 같은 이름으로 남아 있어도 이번 성공은 성공이다.
  변환기잊기();
  const 되는놈 = 가짜변환기(방);
  writeFileSync(join(임시자리(방), '보고서.txt'), '지난번에 못 지운 사본');
  const 다시 = await 글로바꾸기(파일, 방, { 찾은것: { soffice: 되는놈, textutil: false, 왜: null } });
  check('★★ 같은 이름 사본이 남아 있어도 성공을 실패로 뒤집지 않는다', 다시.ok === true,
    JSON.stringify({ ok: 다시.ok, 왜: 다시.왜 }));
  check('  이번에 뽑은 글이 나온다 (지난번 사본이 아니라)', /분기 실적 보고/.test(다시.text ?? ''),
    (다시.text ?? '').slice(0, 40));

  /*
   * ③ ★ 사람 문서 캐시가 든 프로필을 작업 폴더에 남기지 않는다.
   *
   * `-env:UserInstallation` 으로 우리 몫의 프로필을 주는데, soffice 는 그 안에
   * 방금 연 문서의 캐시를 남긴다. txt 만 지우고 프로필을 두면 「읽었으면 곧바로
   * 지운다」 는 약속이 반만 지켜진 것이고, 남은 절반이 그대로 커밋되거나
   * 압축되어 나간다. 세션이 죽어도 지켜지려면 여기서 지워야 한다.
   */
  const 프로필파는놈 = 가짜변환기(방, { 프로필만들기: true });
  const 프r = await 글로바꾸기(파일, 방, { 찾은것: { soffice: 프로필파는놈, textutil: false, 왜: null } });
  check('  프로필을 파는 변환기여도 글은 읽어 온다', 프r.ok === true, JSON.stringify(프r.왜 ?? ''));
  check('★★ 사람 문서 캐시가 든 프로필을 작업 폴더에 안 남긴다',
    !existsSync(join(임시자리(방), '.soffice-profile')),
    readdirSync(임시자리(방)).join(','));

  rmSync(방, { recursive: true, force: true });
}

trace('4c-윈도우껍데기');

/*
 * ── 4c. scoop·choco 로 깐 `soffice.cmd` 도 찾는다 (8회차) ───────────────
 *
 * 명령짓기 머리말은 그 껍데기를 다룬다고 적어 두었는데, 정작 **찾을 때**는
 * `soffice` 한 이름만 물어봤다. Node 의 spawn 은 PATHEXT 를 안 보므로
 * `soffice` 는 ENOENT 고(`soffice.cmd` 를 그냥 부르면 EINVAL), 그래서
 * 사람이 눈앞에서 쓰고 있는 LibreOffice 를 두고 「없습니다」 라고 했다.
 */
{
  check('★★ 윈도우에서는 껍데기 이름까지 물어본다',
    soffice이름들('win32').includes('soffice.cmd') && soffice이름들('win32').includes('soffice.bat'),
    soffice이름들('win32').join(' '));
  check('  윈도우가 아니면 이름 하나뿐이다 (없는 것을 다섯 번 부르지 않는다)',
    JSON.stringify(soffice이름들('linux')) === JSON.stringify(['soffice']), soffice이름들('linux').join(' '));

  // 진짜로 PATH 에 껍데기만 놓고 찾아본다. `.cmd` 는 윈도우 것이라 거기서만 잰다.
  if (윈도우) {
    const 방 = mkdtempSync(join(tmpdir(), 'deel-conv6-'));
    가짜변환기(방);   // 윈도우에서는 soffice.cmd 로 떨어진다
    const 본래PATH = process.env.PATH;
    process.env.PATH = `${방};${본래PATH}`;
    try {
      const 찾은 = 변환기찾기({ 다시: true, env: {}, platform: 'win32' });
      check('★★ PATH 에 soffice.cmd 만 있어도 찾아낸다', !!찾은.soffice, JSON.stringify(찾은));
      check('  찾았으면 없다고 말하지 않는다', !/변환기가 없습니다/.test(변환기말(찾은)), 변환기말(찾은));
    } finally {
      process.env.PATH = 본래PATH;
      변환기잊기();
      rmSync(방, { recursive: true, force: true });
    }
  }
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

  /*
   * ★★★ ③ 변환기가 **있는데 진** 경우 (막판 훑기).
   *
   * 여태 이 자리가 조용했다. 글로바꾸기 는 「변환기가 종료 77 로 끝났습니다
   * (…)」 까지 적어 돌려주는데 빌려읽기 가 그걸 `null` 로 뭉개서, 화면에는
   * 「이 PC 의 변환기로 바꿔 봤지만 글이 안 나왔습니다」 한 줄만 남았다.
   * 자바가 없어 진 것인지 파일이 진짜 깨진 것인지 가릴 길이 없다 —
   * 사람이 할 일이 정반대인 두 경우가 같은 말로 끝났다.
   */
  const 지는것 = 가짜변환기(방, { 아무것도안함: true, 종료코드: 77 });
  const 졌이 = await TOOLS.Read.run({ file_path: '보고서.pptx' }, 판({ soffice: 지는것, textutil: false, 왜: null }));
  check('★★★ 변환기가 졌으면 왜 졌는지를 화면에 올린다',
    /변환기로도 해 봤지만 실패했습니다/.test(졌이.error ?? ''), (졌이.error ?? '').split('\n').pop());
  check('★★★ 종료코드까지 그대로 싣는다', /종료 77/.test(졌이.error ?? ''), (졌이.error ?? '').split('\n').pop());
  // 길을 알려 주는 원래 안내는 그대로 남아야 한다 — 까닭만 남고 길이 사라지면 반쪽이다.
  check('  원래 안내도 그대로 남는다', /옛 Office|해결:/.test(졌이.error ?? ''), (졌이.error ?? '').split('\n')[0]);
  // (짝) 성공한 판에는 이 말이 안 붙는다 — 거짓 경고도 결함이다.
  check('  (짝) 빌려 읽은 판에는 안 붙는다',
    !/변환기로도 해 봤지만/.test(있이.content ?? ''), '');

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

  /*
   * ── 해 보지도 않고 「해 봤다」 고 하지 않는다 (2.0.0 6회차 CV1·CV3·CV4) ─────
   *
   * CV1 `.xlt` 는 「직접 못 읽는 갈래」 에는 있고 「바꿔 볼 갈래」 에는 없었다. 엑셀이 없는 PC 에서
   *     변환기를 부르지도 않고 「이 PC 의 변환기로 바꿔 봤지만 글이 안 나왔습니다」 · 「pdf 나 txt 로
   *     저장하세요」 · 「다시 Read 하지 마세요」 로 끝냈다.
   * CV3 `DEEL_CONVERT=off` 로 일부러 껐는데 「LibreOffice 를 설치하면 빌려 씁니다」 라고 했다.
   * CV4 맥은 textutil 이 늘 있다. textutil 은 doc·rtf·odt·docx 만 받는데, 그것 하나로 「변환기가 있다」
   *     쳐서 .ppt·.xls·.hwp 에 「바꿔 봤지만」 이라 하고 LibreOffice 안내를 뺐다.
   */
  // 엑셀 앞머리(zip·OLE)가 아닌 글자라 엑셀(COM)을 안 부르고 곧장 실패한다 — 이 PC 에 엑셀이 있어도 안 뜬다.
  writeFileSync(join(방, '서식.xlt'), '엑셀 서식이 아닌 글자');
  const 서식빌림 = await 읽어보기('서식.xlt', { soffice, textutil: false, 왜: null });
  check('★★ .xlt 도 변환기가 있으면 빌려 읽는다', /분기 실적 보고/.test(서식빌림.content ?? ''),
    (서식빌림.error ?? '').split('\n').slice(0, 2).join(' | '));
  const { 못바꿈말 } = await import('../src/tools/convert.js');
  check('★ .xlt 는 xlsx 로 저장하라고 한다 (pdf 나 txt 가 아니다)',
    /xlsx 로 저장/.test(못바꿈말('서식.xlt', '.xlt', { soffice: null, textutil: false, 왜: null })), '');
  const 끈말 = 못바꿈말('옛발표.ppt', '.ppt', { soffice: null, textutil: false, 왜: 'DEEL_CONVERT=off 로 꺼 두었습니다' });
  check('★★ DEEL_CONVERT=off 면 꺼 두었다고 말하고 설치하라고 안 한다',
    /DEEL_CONVERT=off/.test(끈말) && !/설치/.test(끈말), 끈말.split('\n').slice(1, 3).join(' | '));
  const 맥ppt = 못바꿈말('옛발표.ppt', '.ppt', { soffice: null, textutil: true, 왜: null });
  check('★★ textutil 만 있는 맥에서 .ppt 를 「바꿔 봤지만」 이라 하지 않는다',
    !/바꿔 봤지만/.test(맥ppt) && /LibreOffice/.test(맥ppt), 맥ppt.split('\n').slice(1, 3).join(' | '));
  const 맥doc = 못바꿈말('옛글.doc', '.doc', { soffice: null, textutil: true, 왜: null });
  check('  textutil 이 받는 .doc 은 정말 해 본 것이라 「바꿔 봤지만」 이 맞다', /바꿔 봤지만/.test(맥doc), 맥doc.split('\n')[1]);
  const 오피스있음 = 못바꿈말('옛발표.ppt', '.ppt', { soffice: 'C:/어딘가/soffice.exe', textutil: false, 왜: null });
  check('  soffice 가 있으면 「바꿔 봤지만」 이 맞다', /바꿔 봤지만/.test(오피스있음), 오피스있음.split('\n')[1]);

  임시치우기(방);
  rmSync(방, { recursive: true, force: true });
}

trace('9-stdin-은-늘-닫는다');

// ── 넣을 것이 없어도 stdin 은 닫아야 한다 ───────────────────────────────
//
// 돌려보기() 의 머리말이 「안 닫으면 자식이 stdin 을 끝까지 읽는 모양일 때
// **영영 안 끝난다** — 시한에 걸려 죽을 때까지 기다리게 되고, 사람 눈에는
// '훅이 느리다' 로 보인다」 라고 적어 두고, 정작 `넣을것 != null` 일 때만
// 닫았다. 넣을 것이 없는 부름(fastgrep 의 rg · convert 의 soffice)은
// **열린 파이프**를 물려받는다.
{
  const 읽는놈 = ['-e', 'let n=0;process.stdin.on("data",(c)=>{n+=c.length});'
    + 'process.stdin.on("end",()=>{console.log("읽은바이트 "+n);process.exit(0)});'];
  const t0 = Date.now();
  const r = await 돌려보기(process.execPath, 읽는놈, { timeout: 5000 });
  const 걸린 = Date.now() - t0;
  check('★★ 넣을 것이 없어도 자식이 EOF 를 받는다', r.status === 0 && !r.error,
    `${걸린}ms · ${r.error?.message ?? r.stdout.trim()}`);
  check('★ 시한까지 안 기다린다', 걸린 < 3000, `${걸린}ms`);
  check('빈 stdin 이라고 알려 준다', /읽은바이트 0/.test(r.stdout), r.stdout.trim());

  // 넣을 것이 있으면 여태처럼 흘려 주고 닫는다.
  const r2 = await 돌려보기(process.execPath, 읽는놈, { timeout: 5000, 넣을것: '열두글자입니다' });
  check('넣을 것이 있으면 그대로 흘려 준다', r2.status === 0 && /읽은바이트 (1[0-9]|2[0-9])/.test(r2.stdout),
    r2.stdout.trim() || String(r2.error?.message));
}

trace('10-무리로돌리기-탈의-모양');

// ── 머리말이 적어 둔 탈의 모양과 실제가 맞나 ────────────────────────────
//
// 부르는 쪽(tools/index.js 의 Bash)이 이 모양을 보고 「시간 초과」 와 「넘침」 과
// 「시그널로 죽음」 을 가른다. 여기가 어긋나면 모델은 timeout 을 늘려 같은 명령을
// 다시 부른다 — 사냥5 M3 이 그 자리다.
{
  // 1) 넘친 쪽이 stderr 면 stderr 라고 말해야 한다. 여태 늘 stdout 이라고 적었다.
  const 넘침 = await new Promise((r) => 무리로돌리기(
    process.execPath, ['-e', 'process.stderr.write("x".repeat(200000))'],
    { maxBuffer: 1000 }, (탈) => r(탈),
  ));
  check('★ 넘친 쪽을 사실대로 적는다', /stderr maxBuffer/.test(넘침?.message ?? ''), 넘침?.message);
  check('넘침은 코드로도 알린다', 넘침?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', String(넘침?.code));

  const 넘침2 = await new Promise((r) => 무리로돌리기(
    process.execPath, ['-e', 'process.stdout.write("x".repeat(200000))'],
    { maxBuffer: 1000 }, (탈) => r(탈),
  ));
  check('stdout 이 넘치면 stdout 이라고 적는다', /stdout maxBuffer/.test(넘침2?.message ?? ''), 넘침2?.message);

  // 2) 우리가 죽인 것은 killed 로 말한다 (밖에서 죽인 판은 윈도에서 못 잰다 —
  //    TerminateProcess 는 신호가 아니라 종료코드 1 로 온다).
  const 죽임 = await new Promise((r) => {
    const kid = 무리로돌리기(process.execPath, ['-e', 'setTimeout(() => {}, 9000)'], {}, (탈) => r(탈));
    setTimeout(() => { try { kid.kill('SIGTERM'); } catch { /* 이미 죽었다 */ } }, 300);
  });
  check('★ 시그널로 죽으면 그 신호를 적는다', 죽임?.signal === 'SIGTERM', String(죽임?.signal));
  check('★ 우리가 죽인 것이면 killed 다', 죽임?.killed === true, String(죽임?.killed));
  check('시그널 죽음은 시한이 아니다', 죽임?.시한 !== true, String(죽임?.시한));

  /*
   * ── 3) 넘침은 시한에 **안 덮인다** (8회차 확인) ───────────────────────────
   *
   * 269-270 머리말은 「넘침도 시그널 죽음도 전부 시간 초과로 나갔다」 를 고쳤다고 적어
   * 뒀는데, 시한 타이머는 미리 잡아 둔 탈을 보지도 않고 덮어썼다. 넘쳐서 죽인 자식이
   * 시한 안에 안 닫히면(끊는 손이 못 끊는 판) 부르는 쪽은 넘침을 시간 초과로 읽고,
   * timeout 을 늘려 같은 명령을 또 부른다 — 고쳤다던 그 자리로 되돌아간다.
   */
  const 넘치고시한 = await new Promise((r) => 무리로돌리기(
    process.execPath, ['-e', 'process.stdout.write("x".repeat(400000)); setTimeout(() => {}, 5000)'],
    { maxBuffer: 1000, timeout: 400, 넘치면: () => { /* 못 끊는 판을 흉내 낸다 */ } }, (탈) => r(탈),
  ));
  check('★ 먼저 잡은 넘침을 시한이 덮어쓰지 않는다 (8회차 확인)',
    넘치고시한?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && 넘치고시한?.시한 !== true,
    `${넘치고시한?.message} · code=${넘치고시한?.code} · 시한=${넘치고시한?.시한}`);

  // 넘친 적이 없으면 시한은 여태처럼 시한이라고 말한다.
  const 시한만 = await new Promise((r) => 무리로돌리기(
    process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeout: 400 }, (탈) => r(탈),
  ));
  check('  넘친 적이 없으면 시한은 시한이라고 말한다', 시한만?.시한 === true, `${시한만?.message} · 시한=${시한만?.시한}`);
}

/*
 * ── 돌려보기 의 넘침도 **코드로** 말한다 (8회차 확인) ─────────────────────────
 *
 * 돌려보기 는 spawnSync 와 돌려주는 모양을 일부러 똑같이 맞춘 것이고(머리말),
 * spawnSync 는 이 자리에서 `ENOBUFS` 를 냈다. 그런데 여기서 만든 탈에는 code 가
 * 아예 없어서, 부르는 쪽은 「결과가 너무 많습니다」 라는 우리말 한 줄을 글자로
 * 맞춰 보는 수밖에 없었다 — 말이 바뀌면 조용히 안 걸린다.
 */
{
  const 넘침3 = await 돌려보기(process.execPath, ['-e', 'process.stdout.write("x".repeat(400000))'],
    { maxBuffer: 1000, timeout: 5000 });
  check('★ 돌려보기 의 넘침은 ENOBUFS 로 가른다 (8회차 확인)',
    넘침3.error?.code === 'ENOBUFS', `${넘침3.error?.message} · code=${넘침3.error?.code}`);

  // 자르기를 켠 부르개는 여전히 탈이 아니라 `잘림` 으로 받는다 — 거기까지 오류로 만들면 훅이 막힌다.
  const 자름 = await 돌려보기(process.execPath, ['-e', 'process.stdout.write("x".repeat(400000)); process.exit(0)'],
    { maxBuffer: 1000, timeout: 5000, 넘치면자르기: true });
  check('  자르기를 켠 쪽은 오류가 아니라 잘림으로 받는다', !자름.error && 자름.잘림 === true && 자름.status === 0,
    `${자름.error?.message ?? ''} 잘림=${자름.잘림} status=${자름.status}`);

  /*
   * ★★ 탈 글 쪽은 **소리 없이** 잘리고 있었다 (막판 훑기).
   *
   * 나온말은 위처럼 표를 달아 말하는데, 탈 글은 `if (탈.length < 65536) 탈 += 조각` 한 줄이라
   * 넘는 순간부터 그냥 사라졌다. 종료코드는 0 이고 오류도 없다 — 경고를 stderr 로 쏟는
   * 훅(린터·형 검사 감싸개)에서 뒤쪽 경고가 통째로 없어지고, 그게 「경고 없음」 으로 올라간다.
   * 바로 위 머리말이 「조용히 잘라 버리면 … 아무도 눈치 못 챈다」 고 적어 둔 그 자리다.
   */
  const 탈넘침 = await 돌려보기(process.execPath,
    ['-e', 'process.stderr.write("E".repeat(200000)); process.stdout.write("ok"); process.exit(0)'],
    { maxBuffer: 1000000, timeout: 5000, 넘치면자르기: true });
  check('★★ 탈 글을 자르면 잘랐다고 글 안에 적는다',
    /잘렸습니다/.test(String(탈넘침.stderr)), JSON.stringify(String(탈넘침.stderr).slice(-60)));
  check('  (짝) 짧은 탈 글에는 군말이 안 붙는다',
    !/잘렸습니다/.test(String((await 돌려보기(process.execPath,
      ['-e', 'process.stderr.write("작다"); process.exit(0)'], { timeout: 5000 })).stderr)));
}

trace('11-죽인-자식이-여태-뱉은-말');

/*
 * ── 죽이라고 하면 **여태 모은 글을 들고 나온다** ────────────────────────
 *
 * Bash 도구의 ESC 갈래는 자식을 죽인 뒤 400ms 짜리 그물을 두고 「죽기 직전에
 * 뱉은 줄」 을 기다린다. 그런데 그 글은 여기(무리로돌리기)의 버퍼에 들어 있고,
 * 여기는 **'close' 가 와야만** 그것을 넘겨 줬다. 셸이 뒤로 띄운 손자가 파이프를
 * 물고 있으면 close 는 영영 안 온다 — 그러면 그물이 먼저 울고, 그물 갈래에는
 * 그 글을 실을 길이 없어서 결과가 통째로 빈 채 나간다. 사람도 모델도
 * 「사용자가 중단했습니다」 한 줄만 받는다. 제일 중요한 몇 줄이 거기 있는데.
 *
 * ── 왜 시계로 안 재나 ───────────────────────────────────────────────────
 *
 * 이 판은 시계로 가르면 안 된다(abort-tools 5-2 단 머리말과 같은 이유 — 그 자리는
 * 여덟 번 재서 6/8·4/8 로 흔들렸다). 여기서 가르는 것은 **몇 ms 인가**가 아니라
 * 「오나 · 영영 안 오나」 다. 손자에게 파이프를 물려 close 를 아예 못 오게 해 두면,
 * 안 고친 코드에서는 결과가 **영영** 안 오고 고친 코드에서는 곧 온다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-cut-'));
  const 손자표 = join(방, 'holder.pid');
  const 말표 = join(방, 'said.txt');
  const 무는놈 = join(방, 'holder.cjs');
  const 뱉는놈 = join(방, 'talker.cjs');
  writeFileSync(무는놈, [
    "require('fs').writeFileSync(process.argv[2], String(process.pid));",
    'setTimeout(() => process.exit(0), 30000);',
  ].join('\n'));
  writeFileSync(뱉는놈, [
    "const fs = require('fs');",
    "const { spawn } = require('child_process');",
    // 손자에게 우리 stdout 을 그대로 물린다 — 우리가 죽어도 파이프가 안 닫힌다.
    "spawn(process.execPath, [process.argv[2], process.argv[3]],",
    "  { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });",
    'let n = 0;',
    "setInterval(() => { n++; console.log('죽기전에한말' + n);",
    "  fs.appendFileSync(process.argv[4], 'x'); }, 40);",
    'setTimeout(() => process.exit(0), 30000);',
  ].join('\n'));

  const 쉬기 = (ms) => new Promise((r) => setTimeout(r, ms));
  let 온것 = null;
  const 아이 = 무리로돌리기(process.execPath, [뱉는놈, 무는놈, 손자표, 말표], {},
    (탈, 밖) => { 온것 = { 탈, 밖: 밖.toString() }; });

  // **시계가 아니라 「뱉었는가」 로** 기다린다. 자식이 아직 한 글자도 안 뱉었으면
  // 잴 것이 없다 — 빈 결과가 고장인지 아직 아무 말도 안 한 것인지 안 갈린다.
  let 뱉었나 = false;
  for (let i = 0; i < 300 && !뱉었나; i++) {
    뱉었나 = existsSync(말표) && readFileSync(말표, 'utf8').length >= 3;
    if (!뱉었나) await 쉬기(20);
  }
  아이.kill();
  for (let i = 0; i < 150 && !온것; i++) await 쉬기(20);

  check('★ 자식이 죽기 전에 말을 뱉었다 (아래 검사의 전제)', 뱉었나,
    `말표=${existsSync(말표)}`);
  check('★★ 죽이면 결과가 돌아온다 — 손자가 파이프를 물어 close 가 안 와도',
    !!온것, 온것 ? '왔다' : '3초를 기다려도 안 왔다 (close 만 기다리고 있다)');
  check('★★ 그 결과에 죽기 전에 뱉은 말이 실려 있다',
    /죽기전에한말/.test(온것?.밖 ?? ''), JSON.stringify((온것?.밖 ?? '').slice(0, 40)));
  check('  우리가 죽인 것이라고 탈에 적는다', 온것?.탈?.killed === true,
    `${온것?.탈?.message ?? '(탈 없음)'} · killed=${온것?.탈?.killed}`);

  // 손자를 남기지 않는다. 살려 두면 이 폴더를 못 지우고, 파이프도 계속 물고 있다.
  const 손자 = existsSync(손자표) ? Number(readFileSync(손자표, 'utf8')) : null;
  if (손자) { try { process.kill(손자); } catch { /* 이미 죽었다 */ } }
  await 쉬기(200);
  rmSync(방, { recursive: true, force: true });
}

trace('12-중단해도-받은-글은-준다');

/*
 * ── 돌려보기 도 중단할 때 **받은 글을 버렸다** ──────────────────────────
 *
 * 시한에 걸려 끝날 때는 여태 받은 것을 그대로 실어 준다(stdout: 밖). 그런데 바로
 * 위 중단 갈래만 `stdout: ''` 였다. 훅(safety/hooks.js)은 못 돌린 판에도 자식이
 * 뱉은 말을 그대로 보여 주는 자리인데, 중단한 판에서만 그 말이 빈 글이 됐다 —
 * 어디까지 하다 멈춘 것인지가 아무 데도 안 남는다.
 */
{
  const 방 = mkdtempSync(join(tmpdir(), 'deel-cut2-'));
  const 표 = join(방, 'said.txt');
  const 쉬기 = (ms) => new Promise((r) => setTimeout(r, ms));
  const ac = new AbortController();
  const 일 = 돌려보기(process.execPath, ['-e',
    "console.log('중단전에한말');"
    + " require('fs').writeFileSync(process.argv[1], '1'); setTimeout(() => {}, 9000);", 표],
  { timeout: 9000, signal: ac.signal });
  for (let i = 0; i < 300 && !existsSync(표); i++) await 쉬기(20);
  // 뱉은 것이 우리 손에 들어올 틈. 자식은 stdout 을 **먼저** 쓰고 표를 나중에 쓴다.
  await 쉬기(50);
  ac.abort();
  const 끊긴것 = await 일;
  check('★★ 중단해도 여태 받은 글을 준다', /중단전에한말/.test(끊긴것.stdout ?? ''),
    JSON.stringify({ stdout: (끊긴것.stdout ?? '').slice(0, 30), error: 끊긴것.error?.message }));
  check('  중단이라고 말하는 것은 그대로다', /중단/.test(끊긴것.error?.message ?? ''),
    끊긴것.error?.message);
  rmSync(방, { recursive: true, force: true });
}

trace('거두는자리');

/*
 * ── 거두는 자를 **부르는 데가 있나** ───────────────────────────────────
 *
 * 위 검사들은 임시치우기() 를 직접 불러서 「부르면 거둔다」 만 재고 있었다.
 * 그런데 저장소에서 그 자를 부르는 곳이 **검사뿐**이었다. convert.js 안의
 * rmSync 들은 실패할 때마다 「못 지우면 임시치우기가 거둔다」 고 적어 두는데,
 * 거두는 자를 아무도 안 부르니 그 말이 빈말이었다 — 윈도우에서 soffice 가
 * 파일을 물고 있으면 사람 문서의 알맹이가 든 `.txt` 가 `.deel/tmp` 에 쌓인다.
 *
 * 그래서 「함수가 도나」 가 아니라 **「부르는 자리가 있나」** 를 잰다. 두 모드가
 * 다 있어야 한다 — 대화(repl)와 배치(oneshot)는 끝맺는 자리가 서로 다르다.
 */
{
  const 뿌리 = new URL('..', import.meta.url);
  const 볼것 = [['src/repl.js', '대화'], ['src/oneshot.js', '배치']];
  const 안부르는것 = [];
  for (const [f, 뭐] of 볼것) {
    const s = readFileSync(new URL(f, 뿌리), 'utf8');
    const 들여옴 = /import\s*\{[^}]*임시치우기[^}]*\}\s*from\s*'[^']*convert\.js'/.test(s);
    const 부름 = /임시치우기\s*\(/.test(s.replace(/^\s*\*.*$/gm, ''));
    if (!들여옴 || !부름) 안부르는것.push(`${뭐}(${f})`);
  }
  check('★★★ 세션 끝에서 임시치우기 를 부르는 자리가 있다',
    안부르는것.length === 0, 안부르는것.join(' · ') || '대화 · 배치 둘 다');
}

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log(`\n변환기 빌려쓰기 검사  ${D}(깔린 것이 있으면 쓰고, 없으면 없다고 말하는가)${X}\n`);
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
