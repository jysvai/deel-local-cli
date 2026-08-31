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
import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync,
} from 'node:fs';
import { basename, extname, join } from 'node:path';

/** 변환해서 읽어 볼 만한 확장자. 여기 없는 것은 손대지 않는다. */
const 바꿔볼확장자 = new Set([
  '.ppt', '.doc', '.xls',      // 옛 Office (OLE 복합문서)
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
function 부르기(cmd, 인자, opts = {}) {
  const 셸필요 = process.platform === 'win32' && /\.(cmd|bat)$/i.test(String(cmd));
  if (!셸필요) return spawnSync(cmd, 인자, { encoding: 'utf8', windowsHide: true, ...opts });
  const 몰아쓰기 = `""${cmd}" ${인자.map((a) => `"${a}"`).join(' ')}"`;
  return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 몰아쓰기], {
    encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, ...opts,
  });
}

function 돌아가나(cmd, 인자) {
  const r = 부르기(cmd, 인자, { timeout: 15000 });
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
  if (돌아가나('soffice', ['--version'])) soffice = 'soffice';
  else {
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
  const 없다 = !찾은것.soffice && !찾은것.textutil;
  const 길 = 없다
    ? '이 PC 에 LibreOffice(soffice)가 없어서 바꿔 읽을 수도 없습니다.'
    : '이 PC 의 변환기로 바꿔 봤지만 글이 안 나왔습니다.';
  return `${보인이름} 은 deel 이 직접 못 읽는 형식입니다 (.${갈래}).\n`
    + `${길}\n`
    + `해결: 원래 프로그램에서 ${새이름(갈래)} 로 저장한 뒤 다시 주세요.`
    + (없다 ? ' 또는 LibreOffice 를 설치하면 deel 이 빌려 씁니다.' : '')
    + '\n**같은 파일을 다시 Read 하지 마세요. 결과는 같습니다.**';
}

/** 그 갈래를 무엇으로 저장하면 읽히는지. */
function 새이름(갈래) {
  if (갈래 === 'ppt') return 'pptx';
  if (갈래 === 'doc' || 갈래 === 'rtf' || 갈래 === 'odt' || 갈래 === 'wpd') return 'docx';
  if (갈래 === 'xls' || 갈래 === 'ods') return 'xlsx';
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
export function 글로바꾸기(abs, root, { timeout = 90000, 찾은것 = null } = {}) {
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
  if (있는것.textutil && ['.doc', '.rtf', '.odt', '.docx'].includes(확장자)) {
    const 나온것 = join(받을곳, `${basename(abs, 확장자)}.txt`);
    const r = 부르기('textutil', ['-convert', 'txt', '-output', 나온것, abs], { timeout });
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
   */
  const 프로필 = join(받을곳, '.soffice-profile');
  const 전 = new Set(existsSync(받을곳) ? readdirSync(받을곳) : []);
  const r = 부르기(있는것.soffice, [
    `-env:UserInstallation=file:///${프로필.replace(/\\/g, '/').replace(/^\/+/, '')}`,
    '--headless', '--norestore',
    '--convert-to', 'txt:Text',
    '--outdir', 받을곳,
    abs,
  ], { timeout });

  if (r.error) {
    return { ok: false, 왜: `변환기를 못 돌렸습니다: ${r.error.message}` };
  }
  const 새로생긴것 = (existsSync(받을곳) ? readdirSync(받을곳) : [])
    .filter((f) => !전.has(f) && f.toLowerCase().endsWith('.txt'));
  if (!새로생긴것.length) {
    const 끄트머리 = String(r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' ').slice(0, 200);
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
}

/** 떨궈 둔 것을 거둔다. 검사와 세션 끝에서 부른다. */
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
