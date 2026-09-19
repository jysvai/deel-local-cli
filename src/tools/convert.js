// 이미 깔려 있는 변환기를 빌려 쓴다. 아무것도 설치하지 않는다.
//
// ── 왜 이걸 만드나 ──────────────────────────────────────────────────────
//
// 사내 자료는 형식이 제각각이다. 이름은 .pptx 인데 속은 옛 .ppt 이고, .doc 이고,
// .rtf 다. deel 은 hwpx·docx·pptx·xlsx·pdf 를 직접 읽지만 그 밖은 못 읽는다.
// 그때 여태 이렇게 끝났다 —
//
//   ◧ Read(보고서.pptx)
//     └ pptx 모양이 아닙니다 — 깨졌거나 다른 형식입니다.
//
// 길이 없으니 모델은 같은 파일을 몇 번씩 다시 열었다. 그런데 정작 그 PC 에는
// LibreOffice 가 깔려 있었다. 사람이 그 파일을 열어 보는 바로 그 프로그램이다.
//
// ── 빌려 쓰기의 규칙 ────────────────────────────────────────────────────
//
// 1.6.0 에서 `rg` 를 빌려 쓴 것과 **같은 원칙**이다 (tools/fastgrep.js).
//
//   · 아무것도 설치하지 않는다. 없으면 없다고 말하고 끝낸다.
//   · 있는지 한 번만 본다. 매번 물으면 없는 PC 에서 그 실패가 계속 쌓인다.
//   · 끌 수 있다 (`DEEL_CONVERT=off`). 결과가 의심될 때 견줄 자리가 있어야 한다.
//   · 셸을 안 거친다. 파일 이름에 빈칸·따옴표·한글이 들어와도 그대로 넘긴다.
//   · 결과는 **작업 폴더 안**(.deel/tmp/)에 떨군다. 밖에 쓰면 울타리를 우리
//     손으로 넘는 셈이고, 남긴 것을 거둘 자리도 없어진다.
//
// 바뀐 글만 쓰고 원본은 한 글자도 안 건드린다. 변환은 읽기의 곁길이다.
import { spawnSync } from 'node:child_process';
import { 돌려보기 } from './spawn.js';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync,
} from 'node:fs';
import { basename, extname, join } from 'node:path';

/** 변환해서 읽어 볼 만한 확장자. 여기 없는 것은 손대지 않는다. */
const 바꿔볼확장자 = new Set([
  // 옛 Office (OLE 복합문서). .xlt 는 .xls 의 서식판 — 아래 직접못읽는확장자 에만 있어서
  // 변환기가 있어도 안 불렀다 (2.0.0 6회차 CV1). 그 표는 이 표의 부분집합이어야 한다.
  '.ppt', '.doc', '.xls', '.xlt',
  '.rtf', '.odt', '.odp', '.ods', '.wpd',
  '.pptx', '.docx', '.xlsx',   // 겉만 그 이름이고 속이 다른 것
  '.hwp',                       // 구형 한글 — soffice 가 읽는 판이 있다
]);

/**
 * 우리가 **영영 직접은 못 읽는** 갈래. 바꿔볼확장자 의 부분집합이다.
 *
 * 둘을 가르는 이유가 있다. `.pptx` 가 안 읽히는 것은 「깨졌거나 속이 다르다」는
 * 뜻이라 docs.js 가 이미 정체를 짚어 준다 — 그 말이 우리 말보다 낫다. 반면
 * `.ppt` 는 정체가 분명하고 우리에게 길이 없다. 그때만 「없다」고 못 박는다.
 */
const 직접못읽는확장자 = new Set([
  '.ppt', '.doc', '.xls', '.xlt', '.rtf', '.odt', '.odp', '.ods', '.wpd', '.hwp',
]);

/** 이 파일을 변환해서 읽어 볼까. */
export function 바꿔볼까(경로) {
  return 바꿔볼확장자.has(extname(String(경로 ?? '')).toLowerCase());
}

/** 바꾸는 것 말고는 길이 없는 갈래인가. */
export function 직접못읽나(경로) {
  return 직접못읽는확장자.has(extname(String(경로 ?? '')).toLowerCase());
}

/*
 * 이 PC 에 깔린 soffice 를 찾는다.
 *
 * PATH 에 없는 자리가 흔하다 — 맥은 앱 꾸러미 안에, 윈도우는 Program Files
 * 밑에 있고 둘 다 PATH 에 안 걸린다. 사람이 쓰는 그 프로그램이 눈앞에 있는데
 * "없습니다" 라고 말하는 것이 제일 아깝다.
 */
const soffice자리 = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  '/usr/bin/soffice', '/usr/local/bin/soffice', '/opt/homebrew/bin/soffice',
  '/snap/bin/libreoffice',
];

/*
 * ── 윈도우에서 `.cmd` 는 그냥 못 띄운다 ─────────────────────────────────
 *
 * scoop·choco 로 깐 것은 `soffice.cmd` 같은 껍데기다. 그걸 spawnSync 로 그냥
 * 부르면 **EINVAL** 이 난다(Node 20 부터 막혔다). 그러면 우리는 "이 PC 에
 * 변환기가 없습니다" 라고 말하게 되는데 — 사람은 눈앞에서 그 프로그램을 쓰고
 * 있다. 있다고 해 놓고 안 되는 것 다음으로 나쁜 것이 이것이다.
 *
 * `shell: true` 로 넘기면 되긴 하지만 node 가 DEP0190 경고를 내고, 그 지적이
 * 맞다 — 경로에 빈칸이 있으면 그대로 깨진다. 사내 PC 의 `C:\Program Files\…`
 * 가 정확히 그 꼴이다.
 *
 * 그래서 언어 서버 쪽에서 쓰는 것과 **같은 방법**을 쓴다 (lsp/client.js).
 * `cmd /s /c` 는 뒤엣것이 따옴표로 시작해 따옴표로 끝나면 바깥 한 쌍을 떼어
 * 내므로, 한 겹 더 둘러서 넘긴다.
 */
function 명령짓기(cmd, 인자) {
  const 셸필요 = process.platform === 'win32' && /\.(cmd|bat)$/i.test(String(cmd));
  if (!셸필요) return { 실행: cmd, 인자, 덤: {} };
  const 몰아쓰기 = `""${cmd}" ${인자.map((a) => `"${a}"`).join(' ')}"`;
  return {
    실행: process.env.ComSpec || 'cmd.exe',
    인자: ['/d', '/s', '/c', 몰아쓰기],
    덤: { windowsVerbatimArguments: true },
  };
}

/*
 * ── 윈도우에서는 이름 하나만 물어봐서는 **못 찾는다** ──────────────────
 *
 * scoop·choco 로 깔면 PATH 에 놓이는 것은 `soffice.cmd` 껍데기다. Node 의
 * spawn 은 PATHEXT 를 안 보므로 `soffice` 로 물으면 ENOENT 가 나고(그 껍데기를
 * 그냥 부르면 EINVAL 이다), 그러면 우리는 사람이 눈앞에서 쓰고 있는 프로그램을
 * 두고 「이 PC 에 변환기가 없습니다」 라고 말한다 — 바로 위 명령짓기 머리말이
 * 다루겠다고 적어 둔 그 껍데기다. 찾을 때도 확장자까지 붙여 물어본다.
 * 부르는 것은 이미 된다 — `.cmd`·`.bat` 는 명령짓기 가 cmd.exe 로 감싼다.
 */
export function soffice이름들(platform = process.platform) {
  return platform === 'win32'
    ? ['soffice.exe', 'soffice.com', 'soffice.cmd', 'soffice.bat', 'soffice']
    : ['soffice'];
}

/*
 * 변환은 **비동기로** 부른다.
 *
 * soffice 는 처음 뜰 때 20초, 큰 문서면 그 이상 걸린다. 전에는 이 자리가
 * spawnSync 였고, 그동안 Node 는 이벤트 루프를 통째로 멈췄다 — 그 90초 내내
 * ESC 가 배달되지 않았다. 화면에는 도는 그림이 보이는데 키가 안 먹으니
 * 사람 눈에는 프로그램이 고장 난 것처럼 보인다.
 *
 * 자식을 띄우고 기다리는 일은 tools/spawn.js 한 벌만 안다. 찾기(fastgrep)와
 * 여기가 같은 것을 쓴다 — 따로 적어 두면 언젠가 한쪽만 고쳐진다.
 */
function 부르기(cmd, 인자, opts = {}) {
  const c = 명령짓기(cmd, 인자);
  return 돌려보기(c.실행, c.인자, { ...opts, 덤: c.덤 });
}

/*
 * 있는지 본다. 여기는 **동기로 둔다.**
 *
 * `--version` 은 곧바로 답하고, 한 세션에 한 번만 부른다(변환기찾기가 기억한다).
 * 이걸 비동기로 만들면 변환기찾기·변환기말·못바꿈말이 줄줄이 비동기가 되고,
 * 그 함수들은 안내문을 만드는 자리라 부르는 데가 많다. 90초를 없애려다
 * 열 군데를 흔드는 것은 값이 안 맞는다.
 */
function 돌아가나(cmd, 인자) {
  const c = 명령짓기(cmd, 인자);
  const r = spawnSync(c.실행, c.인자, { encoding: 'utf8', timeout: 15000, windowsHide: true, ...c.덤 });
  return !r.error && r.status === 0;
}

let 본것 = null;

/**
 * 쓸 수 있는 변환기. 한 번만 찾는다.
 *
 * @returns {{soffice: string|null, textutil: boolean, 왜: string|null}}
 */
export function 변환기찾기({ 다시 = false, env = process.env, platform = process.platform } = {}) {
  if (본것 && !다시) return 본것;
  if (env.DEEL_CONVERT === 'off') {
    본것 = { soffice: null, textutil: false, 왜: 'DEEL_CONVERT=off 로 꺼 두었습니다' };
    return 본것;
  }
  let soffice = null;
  for (const 이름 of soffice이름들(platform)) {
    if (돌아가나(이름, ['--version'])) { soffice = 이름; break; }
  }
  if (!soffice) {
    for (const p of soffice자리) {
      if (existsSync(p) && 돌아가나(p, ['--version'])) { soffice = p; break; }
    }
  }
  // textutil 은 맥에만 있고 .doc·.rtf 를 아주 빨리 바꾼다. soffice 보다 먼저 쓴다.
  const textutil = platform === 'darwin' && 돌아가나('textutil', ['-info', '/dev/null']);
  본것 = { soffice, textutil, 왜: null };
  return 본것;
}

/** 검사가 원래대로 돌려놓을 때. */
export function 변환기잊기() { 본것 = null; return null; }

/** 사람에게 보여줄 한 줄. */
export function 변환기말(찾은것 = 변환기찾기()) {
  if (찾은것.왜) return 찾은것.왜;
  const 것들 = [];
  if (찾은것.soffice) 것들.push('soffice');
  if (찾은것.textutil) 것들.push('textutil');
  return 것들.length ? `${것들.join(' · ')} 를 빌려 씁니다` : '이 PC 에 쓸 수 있는 변환기가 없습니다';
}

/*
 * 못 바꿨을 때 하는 말.
 *
 * 여기가 「안 된다고 확실히 말하는」 자리다. 여태 이 자리에서 나간 말은
 * `바이너리 파일입니다 — 텍스트로 읽을 수 없습니다` 한 줄이었다. 그 말에는
 * 까닭도 길도 없어서, 모델은 같은 파일을 Read 로 또 열거나 Bash 로 우회로를
 * 찾다 울타리에 막히고, 그 왕복으로 컨텍스트만 탔다.
 *
 * 그래서 세 가지를 한꺼번에 말한다 — 무엇이라서 못 읽는지, 이 PC 에 무엇이
 * 없어서 못 바꾸는지, 사람이 무엇을 하면 되는지. 그리고 **다시 열지 말라**고
 * 못 박는다. 다시 열어도 결과가 같은 것은 우리가 아는 사실이다.
 */
export function 못바꿈말(보인이름, 확장자, 찾은것 = 변환기찾기()) {
  const 갈래 = String(확장자 ?? '').replace(/^\./, '').toLowerCase();
  /*
   * 「바꿔 봤다」 는 **이 갈래를 받는 변환기가 있을 때만** 적는다 (2.0.0 6회차 CV3·CV4).
   *
   * 변환기가 하나라도 있으면 해 본 것으로 쳤다. 맥은 textutil 이 늘 있는데 textutil 은
   * doc·rtf·odt·docx 만 받는다 — 그래서 맥의 .ppt·.xls·.hwp 가 전부 **안 해 본 것**을
   * 「바꿔 봤지만 글이 안 나왔습니다」 로 받았고 LibreOffice 안내도 빠졌다. 그리고
   * DEEL_CONVERT=off 로 일부러 끈 사람에게 「설치하면 빌려 씁니다」 라고 했다.
   */
  const 껐나 = !찾은것.soffice && !찾은것.textutil && /DEEL_CONVERT=off/.test(String(찾은것.왜 ?? ''));
  const 받는것있나 = !!찾은것.soffice || (!!찾은것.textutil && textutil갈래.has(`.${갈래}`));
  const 길 = 껐나 ? `${찾은것.왜} — 그래서 바꿔 읽지 않았습니다.`
    : 받는것있나 ? '이 PC 의 변환기로 바꿔 봤지만 글이 안 나왔습니다.'
      : 찾은것.textutil ? '이 PC 의 textutil 은 이 형식을 못 바꾸고, LibreOffice(soffice)는 없습니다.'
        : '이 PC 에 LibreOffice(soffice)가 없어서 바꿔 읽을 수도 없습니다.';
  return `${보인이름} 은 deel 이 직접 못 읽는 형식입니다 (.${갈래}).\n`
    + `${길}\n`
    + `해결: 원래 프로그램에서 ${새이름(갈래)} 로 저장한 뒤 다시 주세요.`
    + (!껐나 && !받는것있나 ? ' 또는 LibreOffice 를 설치하면 deel 이 빌려 씁니다.' : '')
    + '\n**같은 파일을 다시 Read 하지 마세요. 결과는 같습니다.**';
}

/** textutil(맥)이 받는 갈래. 글로바꾸기 와 못바꿈말 이 같은 표를 본다 — 따로 적으면 한쪽만 고쳐진다. */
const textutil갈래 = new Set(['.doc', '.rtf', '.odt', '.docx']);

/** 그 갈래를 무엇으로 저장하면 읽히는지. */
function 새이름(갈래) {
  if (갈래 === 'ppt') return 'pptx';
  if (갈래 === 'doc' || 갈래 === 'rtf' || 갈래 === 'odt' || 갈래 === 'wpd') return 'docx';
  // .xlt 는 .xls 의 서식판이다 — 「pdf 나 txt」 로 떨어지면 표가 사라진다 (CV1).
  if (갈래 === 'xls' || 갈래 === 'xlt' || 갈래 === 'ods') return 'xlsx';
  if (갈래 === 'odp') return 'pptx';
  if (갈래 === 'hwp') return 'hwpx';
  return 'pdf 나 txt';
}

/** 떨굴 자리. 작업 폴더 안이라야 한다. */
export function 임시자리(root) {
  return join(root, '.deel', 'tmp');
}

/**
 * 문서를 글로 바꿔서 읽는다.
 *
 * @param {string} abs   읽을 파일 (절대경로)
 * @param {string} root  작업 폴더 — 바꾼 것을 여기 안에 떨군다
 * @returns {{ok:true, text:string, 쓴것:string} | {ok:false, 왜:string, 없음?:boolean}}
 */
export async function 글로바꾸기(abs, root, { timeout = 90000, 찾은것 = null, signal = null } = {}) {
  const 있는것 = 찾은것 ?? 변환기찾기();
  if (!있는것.soffice && !있는것.textutil) {
    return { ok: false, 없음: true, 왜: 있는것.왜 ?? '이 PC 에 변환기가 없습니다' };
  }
  if (!existsSync(abs)) return { ok: false, 왜: `없는 파일입니다: ${abs}` };

  const 받을곳 = 임시자리(root);
  try { mkdirSync(받을곳, { recursive: true }); } catch (err) {
    return { ok: false, 왜: `바꿔 놓을 자리를 못 만들었습니다: ${err.message}` };
  }

  /*
   * textutil 을 먼저 본다 (맥).
   *
   * soffice 는 처음 뜰 때 몇십 초가 걸린다 — 실제로 20초를 재 봤다. textutil 은
   * OS 에 붙어 있는 것이라 곧바로 답한다. 둘 다 되는 자리면 빠른 쪽이 맞다.
   */
  const 확장자 = extname(abs).toLowerCase();
  if (있는것.textutil && textutil갈래.has(확장자)) {
    const 나온것 = join(받을곳, `${basename(abs, 확장자)}.txt`);
    const r = await 부르기('textutil', ['-convert', 'txt', '-output', 나온것, abs], { timeout, signal });
    if (!r.error && r.status === 0 && existsSync(나온것)) {
      const text = readFileSync(나온것, 'utf8');
      // soffice 쪽과 같은 규칙 — 읽었으면 사본을 남기지 않는다.
      try { rmSync(나온것, { force: true }); } catch { /* 임시치우기가 거둔다 */ }
      return { ok: true, text, 쓴것: 'textutil', 파일: 나온것 };
    }
  }

  if (!있는것.soffice) return { ok: false, 없음: true, 왜: '이 파일을 바꿀 변환기가 없습니다' };

  /*
   * soffice 는 결과 파일 이름을 제가 정한다.
   *
   * 그래서 넣기 전에 폴더에 무엇이 있었는지 적어 두고, 나온 뒤에 늘어난 것을
   * 찾는다. 이름을 미리 짐작하면 확장자가 겹치거나 다른 판에서 어긋난다.
   *
   * -env:UserInstallation 을 따로 주는 까닭: soffice 는 이미 떠 있는 제 인스턴스가
   * 있으면 새 부탁을 그쪽에 넘기고 **곧바로 끝나 버린다.** 사람이 LibreOffice 를
   * 열어 둔 PC 에서 변환이 조용히 아무것도 안 하는 것이 그 모습이다. 우리 몫의
   * 프로필을 따로 주면 그 일이 안 생긴다.
   *
   * ── 성공과 실패를 무엇으로 가르나 ──────────────────────────────────
   *
   * **종료코드 0 과 결과 파일, 둘 다** 있어야 성공이다. textutil 쪽이 이미
   * 그 규칙이고(`status === 0 && existsSync`), 여기만 한쪽씩 봤다가 두 자리가
   * 서로 **반대 방향**으로 틀려 있었다 (8회차) —
   *
   *   · 종료코드 1 로 죽으면서 반쪽 txt 를 남긴 것을 `ok:true` 로 돌려줬다.
   *     그 깨진 글이 그대로 모델에게 갔고, 모델은 그것이 문서 전부인 줄 안다.
   *   · 멀쩡히 끝냈는데 받을곳에 **지난번 같은 이름 txt** 가 남아 있으면
   *     늘어난 것이 없다며 「글을 못 뽑았습니다」 — 성공을 실패로 뒤집었다.
   *
   * 그래서 넣기 전에 우리가 지난번에 남긴 같은 이름 txt 를 먼저 치운다. 결과를
   * 그 이름으로 **찾지는 않는다** — 치우는 것은 우리 사본이고, 나온 것을 찾는
   * 일은 여전히 늘어난 파일로 한다.
   */
  const 프로필 = join(받을곳, '.soffice-profile');
  try { rmSync(join(받을곳, `${basename(abs, 확장자)}.txt`), { force: true }); } catch { /* 못 지우면 아래에서 걸린다 */ }
  const 전 = new Set(existsSync(받을곳) ? readdirSync(받을곳) : []);
  try {
    const r = await 부르기(있는것.soffice, [
      `-env:UserInstallation=file:///${프로필.replace(/\\/g, '/').replace(/^\/+/, '')}`,
      '--headless', '--norestore',
      '--convert-to', 'txt:Text',
      '--outdir', 받을곳,
      abs,
    ], { timeout, signal });

    if (r.error) {
      return { ok: false, 왜: `변환기를 못 돌렸습니다: ${r.error.message}` };
    }
    const 새로생긴것 = (existsSync(받을곳) ? readdirSync(받을곳) : [])
      .filter((f) => !전.has(f) && f.toLowerCase().endsWith('.txt'));
    const 끄트머리 = String(r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' ').slice(0, 200);
    if (r.status !== 0) {
      // 죽으면서 남긴 반쪽 글도 **사람 문서의 조각**이다. 실패한 자리에 남기지 않는다.
      for (const f of 새로생긴것) { try { rmSync(join(받을곳, f), { force: true }); } catch { /* 임시치우기가 거둔다 */ } }
      return { ok: false, 왜: `변환기가 종료 ${r.status ?? '알 수 없음'} 로 끝났습니다${끄트머리 ? ` (${끄트머리})` : ''}` };
    }
    if (!새로생긴것.length) {
      return { ok: false, 왜: `변환기가 글을 못 뽑았습니다${끄트머리 ? ` (${끄트머리})` : ''}` };
    }
    const 나온것 = join(받을곳, 새로생긴것[0]);
    let text = '';
    try { text = readFileSync(나온것, 'utf8'); } catch (err) {
      return { ok: false, 왜: `바꾼 글을 못 읽었습니다: ${err.message}` };
    } finally {
      /*
       * 읽었으면 곧바로 지운다.
       *
       * 글은 이미 손에 있다. 남겨 두면 **사람 문서의 알맹이가 사본으로 작업
       * 폴더에 쌓인다** — 그대로 커밋되거나 압축되어 나갈 수 있는 자리다.
       * 나중에 거두겠다는 약속은 세션이 죽으면 안 지켜진다. 지금 지운다.
       */
      try { rmSync(나온것, { force: true }); } catch { /* 못 지우면 임시치우기가 거둔다 */ }
    }
    return { ok: true, text, 쓴것: 'soffice', 파일: 나온것 };
  } finally {
    /*
     * 프로필도 **여기서** 거둔다. 지우는 것이 txt 하나뿐이던 때, 그 안에는
     * 방금 연 문서의 캐시(user/registrymodifications.xcu·backup 따위)가 그대로
     * 남아 작업 폴더에 쌓였다 — 글은 지워 놓고 그 글의 캐시를 남긴 셈이다.
     * 성공하든 실패하든 중단이든 한 번은 지나가라고 finally 에 둔다.
     */
    try { rmSync(프로필, { recursive: true, force: true }); } catch { /* 못 지우면 임시치우기가 거둔다 */ }
  }
}

/**
 * 떨궈 둔 것을 거둔다.
 *
 * 「검사와 세션 끝에서 부른다」 고 적혀 있었는데 한동안 **부르는 자리가 검사뿐**이었다.
 * 위 rmSync 들에 붙은 「못 지우면 임시치우기가 거둔다」 가 그래서 빈말이었고, 잠겨서
 * 못 지운 임시 파일은 `.deel/tmp` 에 그대로 쌓였다(윈도우에서 soffice 가 물고 있으면
 * 실제로 그렇게 된다). 앞선 판은 그 사실을 주석에만 적고 부르는 자리를 안 세웠다 —
 * 거짓말하는 주석을 고쳐도 파일은 그대로 쌓인다.
 *
 * 이제 두 모드의 끝맺음이 이 자를 부른다: `src/repl.js` 의 정리 블록과
 * `src/oneshot.js` 의 `내놓기`. 둘 다 조용히 부르고, 못 거둬도 끝맺음은 그대로 간다.
 * (검사: test/convert.test.js 의 「거두는자리」)
 *
 * 우리가 떨군 것만 거둔다 — soffice 프로필과 `.txt` 뿐이다. 이 둘이 이 폴더에
 * 우리가 만드는 것의 **전부**라, 사람이 여기 `.txt` 를 손수 넣어 두지 않는 한
 * 남의 것은 안 건드린다. (`.deel/` 는 우리 살림 폴더고 git 도 안 본다.)
 */
export function 임시치우기(root) {
  const 자리 = 임시자리(root);
  if (!existsSync(자리)) return 0;
  let 몇개 = 0;
  for (const f of readdirSync(자리)) {
    const p = join(자리, f);
    try {
      // 사람이 넣어 둔 것은 안 건드린다. 우리가 만든 것만 거둔다.
      if (f === '.soffice-profile' || (statSync(p).isFile() && f.toLowerCase().endsWith('.txt'))) {
        rmSync(p, { recursive: true, force: true });
        몇개++;
      }
    } catch { /* 못 지워도 다음에 지운다 */ }
  }
  return 몇개;
}
