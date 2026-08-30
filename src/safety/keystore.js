// 게이트웨이 열쇠를 어디에 어떻게 두나.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────
//
// 지금까지 열쇠는 `~/.deel/config.json` 에 **글자 그대로** 있었다. 저장할 때
// `chmod 600` 을 걸긴 하는데, 그건 NTFS 에서 아무 일도 안 한다 — 윈도우 권한은
// ACL 로 정해지고 chmod 는 조용히 무시된다. 그러니까 "본인만 읽게 잠갔다" 는
// 우리 말이 윈도우에서는 사실이 아니었다. 백업 도구·동기화 폴더·화면 공유,
// 아무거나 하나면 열쇠가 그대로 나간다.
//
// 사내 심사에서 제일 먼저 나오는 질문이 "열쇠는 어디에 어떻게 보관됩니까" 다.
// 그 답이 "홈 폴더에 평문" 이면 그 자리에서 끝난다.
//
// ── 무엇을 쓰나 ────────────────────────────────────────────────────────
//
//   윈도우  DPAPI (ProtectedData, CurrentUser). 이 PC 의 **이 계정**만 푼다.
//           다른 계정으로 복사해 가면 못 푼다. 키를 우리가 따로 안 만들어도 된다.
//   맥      로그인 키체인 (security add-generic-password).
//   그 밖   그대로 파일 + 0600. 거짓말은 안 한다 — 화면과 심사서에 그렇게 적는다.
//
// ── 지키는 것 ──────────────────────────────────────────────────────────
//
// **열쇠는 명령줄에 안 올린다.** 언제나 stdin 으로 넣는다. 명령줄은 같은 PC 의
// 다른 사용자도 프로세스 목록으로 볼 수 있고, 셸 기록에도 남는다. (엑셀 암호를
// 다룰 때 정해 둔 규칙과 같다.)
//
// 오갈 때는 base64 로만 주고받는다. 콘솔 인코딩이 무엇이든 글자가 안 상한다 —
// CP949 콘솔에서 UTF-8 열쇠를 그냥 흘려보내면 조용히 다른 글자가 된다.
//
// 못 잠그면 **잠근 척하지 않는다.** 실패를 삼키고 평문으로 두면, 사람은 잠긴
// 줄 알고 그 파일을 아무 데나 둔다. 그게 안 잠그는 것보다 나쁘다.
import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { join } from 'node:path';

/** 잠긴 값의 꼴. `dpapi:<base64>` · `keychain:<이름>` */
const 꼴 = /^(dpapi|keychain):(.*)$/s;

/** 키체인에 넣을 때 쓰는 이름. 사람이 키체인 앱에서 찾아 지울 수 있어야 한다. */
export const 키체인이름 = 'deel-gateway-key';

let 마지막탈 = null;
/** 마지막으로 잠그거나 풀다 난 탈. 화면·심사서가 읽는다. */
export function 열쇠탈() { return 마지막탈; }

/** 이 값이 우리가 잠근 것인가. 평문 열쇠와 헷갈리면 안 된다. */
export function 잠긴것인가(값) { return 꼴.test(String(값 ?? '')); }

/** 윈도우 파워셸의 자리. PATH 를 안 믿는다 — 같은 이름의 다른 것이 앞에 있을 수 있다. */
function 파워셸() {
  const 뿌리 = process.env.SystemRoot || 'C:\\Windows';
  return join(뿌리, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * 파워셸을 부른다. 명령은 -EncodedCommand 로 넣는다.
 *
 * 따옴표를 하나도 안 쓰게 되므로 cmd 가 중간에서 글자를 바꿀 자리가 없다.
 * 열쇠는 여기 안 실린다 — 자료는 stdin 으로만 간다.
 */
let 마지막인자 = null;
/**
 * 마지막으로 바깥 명령에 넘긴 **명령줄**. stdin 은 여기 안 남는다.
 *
 * "열쇠를 명령줄에 안 올린다" 는 말은 지켜야 뜻이 있고, 지켜지는지 밖에서
 * 볼 수 있어야 한다. 그래서 실제로 넘긴 인자를 그대로 남긴다 — 검사가
 * 이걸 읽고 열쇠가 섞였는지 본다.
 */
export function 마지막명령줄() { return 마지막인자; }

function 파워셸실행(스크립트, 입력) {
  const enc = Buffer.from(스크립트, 'utf16le').toString('base64');
  마지막인자 = [파워셸(), '-NoProfile', '-NonInteractive', '-EncodedCommand', enc];
  const r = spawnSync(파워셸(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], {
    input: 입력,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  });
  if (r.error) return { ok: false, out: '', err: r.error.message };
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

const 잠그는스크립트 = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$p = [Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser')
[Console]::Out.Write([Convert]::ToBase64String($p))
`;

const 푸는스크립트 = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$u = [Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser')
[Console]::Out.Write([Convert]::ToBase64String($u))
`;

/** 맥 키체인. 넣을 때도 명령줄에 안 올린다 — `security -i` 는 명령을 stdin 으로 받는다. */
function 키체인넣기(글) {
  const 계정 = userInfo().username;
  // 값 자체는 base64 로 넣는다. 키체인 도구가 줄바꿈·따옴표를 만나면 거기서 끊긴다.
  const 값 = Buffer.from(글, 'utf8').toString('base64');
  const 명령 = `add-generic-password -a ${계정} -s ${키체인이름} -w ${값} -U\n`;
  마지막인자 = ['security', '-i'];
  const r = spawnSync('security', ['-i'], { input: 명령, encoding: 'utf8', timeout: 20000 });
  if (r.error) return { ok: false, err: r.error.message };
  return { ok: r.status === 0, err: (r.stderr ?? '').trim() };
}

function 키체인읽기() {
  const 계정 = userInfo().username;
  마지막인자 = ['security', 'find-generic-password', '-a', 계정, '-s', 키체인이름, '-w'];
  const r = spawnSync('security', ['find-generic-password', '-a', 계정, '-s', 키체인이름, '-w'], {
    encoding: 'utf8', timeout: 20000,
  });
  if (r.error) return { ok: false, text: '', err: r.error.message };
  if (r.status !== 0) return { ok: false, text: '', err: (r.stderr ?? '').trim() || '키체인에 없습니다' };
  try {
    return { ok: true, text: Buffer.from((r.stdout ?? '').trim(), 'base64').toString('utf8') };
  } catch (err) {
    return { ok: false, text: '', err: err.message };
  }
}

/**
 * 이 PC 에서 잠글 수 있나.
 *
 * @returns {{되나: boolean, 방식: 'dpapi'|'keychain'|'파일', 왜: string}}
 */
export function 쓸수있나() {
  // 꺼 뒀으면 켜져 있는 척하지 않는다. 이 값을 화면 문구도 그대로 쓰기 때문에,
  // 여기서 거짓으로 답하면 "다음 저장 때 잠급니다" 라고 해 놓고 안 잠근다.
  if (process.env.DEEL_KEYSTORE === 'off') {
    return { 되나: false, 방식: '파일', 왜: 'DEEL_KEYSTORE=off 로 꺼 두었습니다' };
  }
  if (process.platform === 'win32') {
    const r = 파워셸실행('[Console]::Out.Write("ok")', '');
    if (r.ok && r.out === 'ok') return { 되나: true, 방식: 'dpapi', 왜: '' };
    return { 되나: false, 방식: '파일', 왜: r.err || '파워셸을 못 돌렸습니다 (정책으로 막혔을 수 있습니다)' };
  }
  if (process.platform === 'darwin') {
    const r = spawnSync('security', ['-h'], { encoding: 'utf8', timeout: 10000 });
    if (!r.error) return { 되나: true, 방식: 'keychain', 왜: '' };
    return { 되나: false, 방식: '파일', 왜: 'security 명령을 못 찾았습니다' };
  }
  return { 되나: false, 방식: '파일', 왜: '이 운영체제에서는 파일 권한(0600)으로만 둡니다' };
}

/**
 * 잠근다. 못 잠그면 null 을 준다 — **잠근 척하지 않는다.**
 *
 * @param {string} 글  평문 열쇠
 * @returns {string|null} `dpapi:…` · `keychain:…` 또는 null
 */
export function 잠그기(글) {
  const 값 = String(글 ?? '');
  if (!값) return null;
  마지막탈 = null;

  if (process.platform === 'win32') {
    const r = 파워셸실행(잠그는스크립트, Buffer.from(값, 'utf8').toString('base64'));
    if (r.ok && r.out) return `dpapi:${r.out}`;
    마지막탈 = `열쇠를 못 잠갔습니다 — ${r.err || '파워셸이 답을 안 줬습니다'}`;
    return null;
  }
  if (process.platform === 'darwin') {
    const r = 키체인넣기(값);
    if (r.ok) return `keychain:${키체인이름}`;
    마지막탈 = `열쇠를 키체인에 못 넣었습니다 — ${r.err || 'security 가 실패했습니다'}`;
    return null;
  }
  return null;
}

/**
 * 푼다.
 *
 * 못 풀 때가 진짜 있다 — 설정 파일만 다른 PC 로 옮겼거나, 계정을 바꿨거나,
 * 윈도우 프로필을 다시 만든 경우다. 그때 빈 글자만 돌려주면 사람은 401 만
 * 보고 게이트웨이를 의심한다. 그래서 왜인지를 남긴다.
 *
 * @returns {{ok: boolean, text: string, why: string}}
 */
export function 풀기(태그) {
  const m = 꼴.exec(String(태그 ?? ''));
  if (!m) return { ok: false, text: '', why: '잠긴 열쇠가 아닙니다' };
  const [, 갈래, 값] = m;
  마지막탈 = null;

  if (갈래 === 'dpapi') {
    if (process.platform !== 'win32') {
      마지막탈 = '이 열쇠는 윈도우에서 잠근 것이라 여기서는 못 풉니다 — deel setup 으로 다시 넣으세요.';
      return { ok: false, text: '', why: 마지막탈 };
    }
    const r = 파워셸실행(푸는스크립트, 값);
    if (r.ok && r.out) {
      try { return { ok: true, text: Buffer.from(r.out, 'base64').toString('utf8'), why: '' }; }
      catch { /* 아래로 */ }
    }
    마지막탈 = '잠근 열쇠를 못 풉니다 — 이 PC 의 이 계정에서 잠근 것만 풀립니다. deel setup 으로 다시 넣으세요.';
    return { ok: false, text: '', why: 마지막탈 };
  }

  if (갈래 === 'keychain') {
    if (process.platform !== 'darwin') {
      마지막탈 = '이 열쇠는 맥 키체인에 있습니다 — 여기서는 못 읽습니다. deel setup 으로 다시 넣으세요.';
      return { ok: false, text: '', why: 마지막탈 };
    }
    const r = 키체인읽기();
    if (r.ok) return { ok: true, text: r.text, why: '' };
    마지막탈 = `키체인에서 열쇠를 못 읽었습니다 — ${r.err}`;
    return { ok: false, text: '', why: 마지막탈 };
  }

  return { ok: false, text: '', why: '모르는 잠금 방식입니다' };
}

/** 화면·심사서에 그대로 쓰는 한 줄. 되는 척도 안 되는 척도 안 한다. */
export function 보관방식(값 = null) {
  if (값 && 잠긴것인가(값)) {
    return 값.startsWith('dpapi:')
      ? 'DPAPI — 이 PC 의 이 계정만 풉니다'
      : '맥 키체인 — 이 계정의 로그인 키체인에 있습니다';
  }
  const 쓸수 = 쓸수있나();
  if (값) {
    // 평문인데 잠글 수는 있는 상태. 다음 저장에서 잠긴다.
    return 쓸수.되나
      ? `파일에 평문 — 다음 저장 때 ${쓸수.방식 === 'dpapi' ? 'DPAPI' : '키체인'} 로 잠급니다`
      : `파일에 평문 + 권한 0600 — ${쓸수.왜}`;
  }
  if (process.platform === 'win32') return 'DPAPI (윈도우) · 저장된 열쇠 없음';
  if (process.platform === 'darwin') return '맥 키체인 · 저장된 열쇠 없음';
  return '파일 권한 0600 · 저장된 열쇠 없음';
}
