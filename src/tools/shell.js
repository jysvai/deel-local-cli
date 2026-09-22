// 명령을 어느 셸에서 돌리나. Bash 도구와 Jobs 가 **같은 답**을 봐야 한다 — 두 벌이면 한쪽만 고쳐진다.
//
// 윈도우에서는 지금까지 cmd.exe 였고, 프롬프트는 그 말을 한 번도 안 했다. 그래서 모델은
// ls · cat · grep · rm -rf 를 쳤고, 하나마다 실패 한 번 — 로컬 모델이면 20~40초 — 를 치렀다.
// 개발자 PC 에는 대개 Git for Windows 가 있고, 그 안의 bash 는 모델이 이미 아는 셸이다.
//
// 고르는 차례 (윈도우):
//   1) DEEL_SHELL 환경변수 · 설정 파일의 shell — auto · bash · powershell · cmd
//   2) Git Bash — %ProgramFiles%\Git\bin\bash.exe, usr\bin\bash.exe, 또는 PATH 의 bash.exe.
//      단 System32\bash.exe 는 아니다 — 그건 WSL 을 띄우는 것이라 리눅스로 가 버린다.
//   3) cmd.exe
//   파워셸은 시켜야만 쓴다. Windows PowerShell 5.1 은 && 를 모르므로 모델이 자주 넘어진다.
// 윈도우가 아니면 /bin/sh 그대로다.
//
// 고른 것은 세션 안에서 안 바뀐다 — 프롬프트의 `Shell:` 줄이 앞머리(캐시되는 자리)에 있어서다.
import { existsSync } from 'node:fs';
import { win32, posix } from 'node:path';

const 값들 = ['auto', 'bash', 'powershell', 'cmd'];

/** Git Bash 자리 후보. 있는 것 중 첫 것을 쓴다. System32 는 뺀다(WSL 띄우개). */
export function 배시후보(env = process.env, platform = process.platform) {
  const P = platform === 'win32' ? win32 : posix;
  const 후보 = [];
  for (const k of ['ProgramFiles', 'ProgramW6432', 'ProgramFiles(x86)']) {
    if (!env[k]) continue;
    후보.push(P.join(env[k], 'Git', 'bin', 'bash.exe'));
    후보.push(P.join(env[k], 'Git', 'usr', 'bin', 'bash.exe'));
  }
  if (env.LOCALAPPDATA) 후보.push(P.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
  const 구분 = platform === 'win32' ? ';' : ':';
  for (const 칸 of String(env.PATH ?? env.Path ?? '').split(구분)) {
    // PATH 칸은 따옴표로 쌀 수 있다(cmd 가 그렇게 읽는다). 안 벗기면 `.\"C:\…\bin"\bash.exe` 가 되어 Git Bash 를
    // 놓쳤고, 싼 System32 는 아래 거르기도 비켰다 (6회차 Gemini 셸고르기6).
    const dir = 칸.trim().replace(/^"(.*)"$/, '$1').trim();
    // 상대 칸(`.` · `bin` · 안 풀린 `%CD%`)은 **지금 폴더**, 곧 받아 온 저장소를 가리킨다.
    // 남겨 두면 후보가 `bash.exe` 라는 맨 이름이 되고, existsSync 가 그것을 작업 폴더에서
    // 찾아 준다 — 저장소가 심어 둔 bash.exe 가 Bash 도구와 Jobs 의 모든 명령을 받는다.
    // tools/verify.js 의 경로에서찾기 가 같은 위협을 같은 자로 이미 막고 있다.
    if (!dir || !P.isAbsolute(dir) || /[\\/]system32[\\/]?$/i.test(dir)) continue;
    후보.push(P.join(dir, 'bash.exe'));
  }
  return [...new Set(후보)];
}

/**
 * 셸을 고른다. 순수 함수 — 검사에서 env · platform · exists 를 바꿔 끼운다.
 * @returns {{ id: 'bash'|'cmd'|'powershell'|'sh', file: string, 명령: (cmd: string) => string[], verbatim: boolean, 표시: string, 경고: string|null }}
 */
export function 셸고르기({ env = process.env, platform = process.platform, config = null, exists = existsSync } = {}) {
  if (platform !== 'win32') {
    return { id: 'sh', file: '/bin/sh', 명령: (cmd) => ['-c', cmd], verbatim: false, 표시: '/bin/sh', 경고: null };
  }
  let 원하는 = String(env.DEEL_SHELL || config?.shell || 'auto').trim().toLowerCase();
  let 경고 = null;
  if (!값들.includes(원하는)) {
    경고 = `셸 설정 '${원하는}' 은 모르는 값입니다 — auto 로 갑니다 (auto · bash · powershell · cmd)`;
    원하는 = 'auto';
  }
  if (원하는 === 'auto' || 원하는 === 'bash') {
    const bash = 배시후보(env, platform).find((p) => { try { return exists(p); } catch { return false; } });
    if (bash) {
      return { id: 'bash', file: bash, 명령: (cmd) => ['-c', cmd], verbatim: false, 표시: `bash (Git for Windows) · ${bash}`, 경고 };
    }
    if (원하는 === 'bash') 경고 = 'bash 를 시켰지만 Git Bash 를 못 찾았습니다 — cmd.exe 로 갑니다';
  }
  if (원하는 === 'powershell') {
    return {
      id: 'powershell', file: 'powershell.exe',
      명령: (cmd) => ['-NoProfile', '-NonInteractive', '-Command', cmd],
      verbatim: false, 표시: 'Windows PowerShell · powershell.exe', 경고,
    };
  }
  /*
   * cmd.exe 는 명령을 통째로 따옴표로 감싸고, 인자를 손대지 말라고(verbatim) 일러 준다.
   *
   * Node 는 인자를 넘길 때 따옴표를 \" 로 바꿔 주는데 cmd.exe 는 \" 를 모른다. 그래서
   * 따옴표가 든 명령이 통째로 뭉개졌다 — `node -e "console.log(1)"` 이 아무것도 안 하고
   * **종료코드 0** 이었다. 출력도 오류도 없이 '성공' 이라 모델은 잘된 줄 알고 넘어갔다.
   * Node 의 exec() 가 안에서 하는 것과 똑같이 맞춘다. /s 는 그 감싼 따옴표 한 쌍을
   * 벗기라는 뜻이라 짝이 맞는다.
   */
  // 빈 COMSPEC 은 안 정한 것과 같다 — `??` 는 빈 글을 지나보내 명령마다 ENOENT 였다 (6회차 Gemini 셸고르기6).
  const file = env.COMSPEC || 'cmd.exe';
  return { id: 'cmd', file, 명령: (cmd) => ['/d', '/s', '/c', `"${cmd}"`], verbatim: true, 표시: `cmd.exe · ${file}`, 경고 };
}

let 지금 = null;

/** 설정을 읽는 자리(config.load)에서 부른다. 그 뒤로는 정한셸() 이 이것을 준다. */
export function 셸정하기({ env = process.env, config = null } = {}) {
  지금 = 셸고르기({ env, config });
  return 지금;
}

export function 정한셸() {
  return 지금 ?? (지금 = 셸고르기());
}

/** 검사용 — 다음 정한셸() 이 다시 고르게. */
export function 셸지우기() { 지금 = null; }

/*
 * ── cmd.exe 는 한 줄에 8,191자까지다 (2.0.2 · S6) ─────────────────────────────
 *
 * cmd 자체의 한계라 우리가 늘릴 수 없다. 넘기면 cmd 가 「The command line is too long.」 한 줄을
 * 내고 **아무것도 안 돌린다** — 그런데 한국어 윈도에서는 그 줄이 코드페이지째 깨져 오고, 모델은
 * 제 명령이 왜 안 돌았는지 모른 채 같은 긴 명령을 또 낸다. 넘길 것이면 넘기기 전에 사람 말로
 * 멈추고, 어떻게 하면 되는지(파일로 써서 돌리기)를 같이 말한다. Git Bash·파워셸은 이 한계가 없다.
 *
 * 8,191자는 명령만이 아니라 **cmd 가 받은 한 줄 전체**다 — `"C:\WINDOWS\system32\cmd.exe" /d /s /c "…"`.
 * 재 보니 이 PC 에서 명령에 쓸 수 있는 것은 8,152자였다(cmd 자리 27자 + 앞뒤 붙이는 것). 그래서 cmd 자리와
 * 붙이는 글자만큼 빼고 잰다. 붙이는 것은 ` /d /s /c ` 10자 · 명령을 싸는 따옴표 2자에 2자를 더 둔다.
 */
const cmd한줄최대 = 8191;

/** 이 cmd 로 명령에 쓸 수 있는 글자 수. */
export function cmd명령최대(file = 'cmd.exe') { return cmd한줄최대 - (String(file).length + 14); }

/** cmd 로 넘기면 한 줄 한계를 넘나. 넘으면 모델에게 줄 말, 아니면 null. */
export function 셸한계넘나(cmd, { id, file } = 정한셸()) {
  if (id !== 'cmd') return null;
  const n = String(cmd ?? '').length;
  const 최대 = cmd명령최대(file);
  if (n <= 최대) return null;
  return `명령이 ${n.toLocaleString('en-US')}자입니다 — cmd.exe 는 한 줄에 ${cmd한줄최대.toLocaleString('en-US')}자까지만 받습니다(cmd 자리를 빼면 명령에는 ${최대.toLocaleString('en-US')}자 · cmd 자체 한계라 돌리지 않았습니다).`
    + ' 긴 내용은 Write 로 파일(.bat · .ps1 · .js 등)에 쓰고 그 파일을 돌리세요. Git Bash 를 깔면 이 한계가 없습니다.';
}

/** 명령 하나를 셸에 넘길 모양. Bash 도구와 Jobs 가 둘 다 이걸 쓴다. */
export function 셸명령(cmd) {
  const s = 정한셸();
  return { file: s.file, args: s.명령(cmd), verbatim: s.verbatim, id: s.id };
}

/**
 * 모델에게 주는 한 줄. 프롬프트의 굳은 앞머리에 들어간다 — 세션 안에서 변하지 않는다.
 * 모델이 ls 를 칠지 dir 를 칠지가 이 줄에서 갈린다.
 */
export function 셸안내(영 = false, 셸 = 정한셸()) {
  const os = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
  switch (셸.id) {
    case 'bash':
      return 영
        ? '\nShell: bash (Git for Windows) on Windows — Unix commands work (ls, cat, grep, sed, find); Windows tools on PATH (node, git, python) work too. Paths: /c/… or C:\\… are both fine.'
        : '\nShell: bash (Git for Windows), 윈도우 위 — 유닉스 명령(ls · cat · grep · sed · find)이 되고, PATH 의 윈도우 도구(node · git · python)도 그대로 부른다. 경로는 /c/… 꼴과 C:\\… 둘 다 된다.';
    case 'cmd':
      return 영
        ? '\nShell: cmd.exe on Windows — there is no ls/cat/grep/rm. Use dir, type, findstr, del, or wrap with powershell -NoProfile -Command "…". Chain with &&.'
        : '\nShell: cmd.exe, 윈도우 — ls · cat · grep · rm 은 없다. dir · type · findstr · del 을 쓰거나 powershell -NoProfile -Command "…" 로 감싸라. && 로 이을 수 있다.';
    case 'powershell':
      return 영
        ? '\nShell: Windows PowerShell on Windows — use Get-ChildItem, Get-Content, Select-String. There is no && (5.1); chain with ;.'
        : '\nShell: Windows PowerShell, 윈도우 — Get-ChildItem · Get-Content · Select-String 을 쓴다. && 는 없다(5.1) — ; 로 잇는다.';
    default:
      return 영 ? `\nShell: /bin/sh (POSIX) on ${os}.` : `\nShell: /bin/sh (POSIX), ${os}.`;
  }
}
