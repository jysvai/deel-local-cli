/**
 * 이 자리에 깔려 있는 언어 서버 찾기.
 *
 * ── 절대 안 깔아 준다 ───────────────────────────────────────────────────
 *
 * 이 프로그램이 쓰이는 자리는 대개 밖으로 못 나간다. 그런 자리에서 도구가
 * `npm i -g typescript-language-server` 를 제 마음대로 부르면, 잘 되면 미승인
 * SW 를 들인 것이고 안 되면 몇십 초를 기다리다 실패한다. 둘 다 나쁘다.
 *
 * 그래서 여기서 하는 일은 **PATH 를 훑어보는 것뿐**이다. 있으면 쓰고, 없으면
 * 없다고 말하고 Grep·Outline 으로 보내면 끝이다. 깔라는 말은 사용자에게만
 * 한 번 하고(/lsp), 모델에게는 아예 그 도구를 안 보여 준다 — 못 쓰는 도구를
 * 목록에 세워 두면 모델은 그걸 부르고, 실패를 받고, 다시 부른다.
 *
 * ── 왜 spawn 으로 안 재나 ───────────────────────────────────────────────
 *
 * `--version` 을 불러 보면 확실하지만, 후보가 열댓 개라 켤 때마다 프로세스를
 * 열댓 개 띄우게 된다. 게다가 언어 서버 중에는 인자 없이 부르면 stdio 를 잡고
 * 안 끝나는 것이 있다(rust-analyzer 가 그렇다). 켜자마자 유령이 하나 생긴다.
 * PATH 훑기는 파일 있나 보는 것이라 값이 거의 0 이고, 틀릴 때는 '있다고 했는데
 * 안 도는' 쪽으로만 틀린다 — 그건 켤 때 한 번 걸러진다.
 */
import { existsSync, statSync } from 'node:fs';
import { join, delimiter, extname } from 'node:path';
import { walk } from '../tools/fsutil.js';

/**
 * 언어별 후보. 앞에 있는 것부터 찾는다.
 *
 * 순서는 '가벼운 것 먼저' 가 아니라 **정확한 것 먼저**다. 여기서 나오는 답은
 * 모델이 다음에 무엇을 고칠지 정하는 데 쓰인다. 틀린 자리를 짚어 주면 Grep
 * 보다 나쁘다 — Grep 은 못 찾으면 못 찾았다고 하지, 엉뚱한 데를 안 짚는다.
 */
export const 후보 = {
  ts: [
    { cmd: 'typescript-language-server', args: ['--stdio'], 깔기: 'npm i -g typescript-language-server typescript' },
    { cmd: 'deno', args: ['lsp'], 깔기: 'deno 는 제 lsp 를 갖고 있다' },
  ],
  py: [
    { cmd: 'pyright-langserver', args: ['--stdio'], 깔기: 'npm i -g pyright' },
    { cmd: 'basedpyright-langserver', args: ['--stdio'], 깔기: 'pip install basedpyright' },
    { cmd: 'pylsp', args: [], 깔기: 'pip install python-lsp-server' },
    { cmd: 'jedi-language-server', args: [], 깔기: 'pip install jedi-language-server' },
  ],
  go: [{ cmd: 'gopls', args: [], 깔기: 'go install golang.org/x/tools/gopls@latest' }],
  rs: [{ cmd: 'rust-analyzer', args: [], 깔기: 'rustup component add rust-analyzer' }],
  java: [{ cmd: 'jdtls', args: [], 깔기: 'eclipse.jdt.ls' }],
  cs: [{ cmd: 'omnisharp', args: ['-lsp'], 깔기: 'dotnet tool install -g omnisharp' }],
  cpp: [{ cmd: 'clangd', args: [], 깔기: 'LLVM 에 들어 있다' }],
  rb: [{ cmd: 'ruby-lsp', args: [], 깔기: 'gem install ruby-lsp' }],
  php: [{ cmd: 'intelephense', args: ['--stdio'], 깔기: 'npm i -g intelephense' }],
  lua: [{ cmd: 'lua-language-server', args: [], 깔기: 'lua-language-server' }],
};

/** 확장자 → 언어 열쇠. 여기 없는 확장자는 언어 서버를 안 찾는다. */
const 확장자갈래 = {
  '.ts': 'ts', '.tsx': 'ts', '.mts': 'ts', '.cts': 'ts',
  '.js': 'ts', '.jsx': 'ts', '.mjs': 'ts', '.cjs': 'ts',
  '.py': 'py', '.pyi': 'py',
  '.go': 'go',
  '.rs': 'rs',
  '.java': 'java',
  '.cs': 'cs',
  '.c': 'cpp', '.h': 'cpp', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp',
  '.rb': 'rb',
  '.php': 'php',
  '.lua': 'lua',
};

/**
 * 이 파일은 어느 언어인가.
 * @returns {string|null} 모르는 확장자면 null — 모르는 것은 모른다고 한다.
 */
export function 갈래(경로) {
  if (typeof 경로 !== 'string' || !경로) return null;
  return 확장자갈래[extname(경로).toLowerCase()] ?? null;
}

/** LSP 가 쓰는 languageId. 열쇠와 다른 것만 적어 둔다. */
const 아이디 = { ts: 'typescript', py: 'python', go: 'go', rs: 'rust', java: 'java', cs: 'csharp', cpp: 'cpp', rb: 'ruby', php: 'php', lua: 'lua' };

/**
 * 이 파일을 서버에게 뭐라고 소개할지.
 *
 * 확장자를 그대로 다시 본다. `.js` 를 typescript 라고 소개하면 서버가 그 파일에
 * 타입 규칙을 걸어 없는 오류를 만들어 낸다 — 편집 뒤 진단에서 바로 티가 난다.
 */
export function 언어아이디(경로) {
  const e = extname(String(경로 ?? '')).toLowerCase();
  if (e === '.js' || e === '.mjs' || e === '.cjs') return 'javascript';
  if (e === '.jsx') return 'javascriptreact';
  if (e === '.tsx') return 'typescriptreact';
  if (e === '.pyi') return 'python';
  return 아이디[갈래(경로)] ?? 'plaintext';
}

/**
 * PATH 에 이 이름이 있나.
 *
 * 윈도우에서는 확장자를 붙여 봐야 한다. npm 이 전역으로 깐 것은 `.cmd` 라서,
 * 이름 그대로 찾으면 깔려 있는데도 없다고 나온다. 실제로 이 자리(윈도우 + npm)가
 * 이 프로그램이 제일 많이 도는 자리다.
 *
 * @param env 시험에서 갈아 끼우려고 받는다. 안 주면 지금 프로세스 것.
 * @returns {string|null} 찾은 실제 경로
 */
export function 어디있나(이름, env = process.env) {
  if (!이름) return null;
  const 길들 = String(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  /*
   * 윈도우에서는 **확장자 붙은 것을 먼저** 본다. 이 순서가 중요하다.
   *
   * npm 이 전역으로 깔면 한 폴더에 둘을 같이 만든다 —
   *   typescript-language-server       (sh 스크립트. WSL·git-bash 용)
   *   typescript-language-server.cmd   (윈도우가 실제로 돌릴 수 있는 것)
   *
   * 이름 그대로를 먼저 찾으면 앞엣것이 잡히고, 그걸 띄우면 윈도우는 못 돌린다.
   * 그런데 파일은 분명히 있으니 '깔려 있다' 고 나온다. 그래서 도구는 목록에
   * 서고, 부르면 6ms 만에 "서버가 없습니다" 가 돌아온다 — 있다고 해 놓고
   * 안 되는, 제일 알아채기 어려운 꼴이다.
   */
  const 확장 = process.platform === 'win32'
    ? [...String(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean), '']
    : [''];
  for (const 길 of 길들) {
    for (const e of 확장) {
      const p = join(길, 이름 + e);
      try {
        // 폴더가 이름만 같은 경우가 있다. 파일인지까지 본다.
        if (existsSync(p) && statSync(p).isFile()) return p;
      } catch { /* 못 읽는 자리는 없는 것으로 친다 */ }
    }
  }
  return null;
}

/*
 * 시험이 서버 하나를 박아 넣는 자리.
 *
 * 이게 없으면 이 파일 아래쪽(켜기·물어보기·진단·도구·정리)은 **언어 서버가
 * 깔린 컴퓨터에서만** 시험이 돈다. 그런데 이 프로그램을 쓰는 자리는 대개
 * 안 깔려 있다 — 하필 시험이 제일 필요한 자리에서 시험이 안 도는 셈이다.
 *
 * 그래서 후보 표를 갈아 끼울 수 있게 열어 두고, 시험은 LSP 를 흉내 내는
 * 작은 node 스크립트를 박아 넣는다. 오가는 말은 진짜 규약 그대로라(길이 머리말,
 * initialize 악수, publishDiagnostics) 흉내가 아니라 실제로 그 길을 다 밟는다.
 */
const _박은것 = new Map();
// 뿌리마다 한 번만 센 결과. 아래 프로젝트갈래() 가 채운다.
const _센것 = new Map();

export function 서버박기(갈래열쇠, 고른것) {
  if (고른것) _박은것.set(갈래열쇠, 고른것);
  else _박은것.delete(갈래열쇠);
  _센것.clear();   // 박고 나면 폴더를 다시 세야 한다
}

/**
 * 이 언어에 쓸 수 있는 서버를 고른다.
 * @returns {{cmd,args,이름,경로}|null}
 */
export function 고르기(갈래열쇠, env = process.env) {
  if (_박은것.has(갈래열쇠)) return _박은것.get(갈래열쇠);
  for (const c of 후보[갈래열쇠] ?? []) {
    const 경로 = 어디있나(c.cmd, env);
    if (경로) return { cmd: c.cmd, args: c.args, 이름: c.cmd, 경로 };
  }
  return null;
}

/** 이 자리에서 쓸 수 있는 것들을 한눈에. /lsp 화면과 시험이 쓴다. */
export function 둘러보기(env = process.env) {
  const 있는것 = [];
  const 없는것 = [];
  for (const 열쇠 of Object.keys(후보)) {
    const 찾음 = 고르기(열쇠, env);
    if (찾음) 있는것.push({ 갈래: 열쇠, 이름: 찾음.이름, 경로: 찾음.경로 });
    else 없는것.push({ 갈래: 열쇠, 깔기: 후보[열쇠][0]?.깔기 ?? '' });
  }
  return { 있는것, 없는것 };
}

/**
 * 이 폴더는 무슨 언어로 되어 있나.
 *
 * Def·Refs 를 file_path 없이 부를 때 어느 서버에게 물을지 정하는 데 쓴다.
 * 파일이 제일 많은 갈래로 고른다 — 설정 파일 몇 개 때문에 엉뚱한 서버를
 * 켜면 켜는 값만 물고 아무 답도 못 받는다.
 *
 * **쓸 수 있는 서버가 있는 갈래만** 센다. ts 파일이 제일 많아도 서버가 없으면
 * 두 번째로 많은 py 를 고르는 것이 맞다. 없는 것을 고르고 실패하는 것보다,
 * 있는 것을 고르고 그것만이라도 답하는 편이 낫다.
 *
 * 뿌리마다 한 번만 센다. 폴더 훑기는 값이 있고, 세션 중에 언어가 바뀌지 않는다.
 */
export async function 프로젝트갈래(뿌리, env = process.env) {
  // 센 것이 아니라 **세는 약속**을 담아 둔다. 훑기가 비동기라, 다 세고 나서
  // 담으면 겹쳐 부른 쪽이 둘 다 빈 칸을 보고 둘 다 훑는다 — 에디터에서 탭을
  // 한꺼번에 열면 실제로 그렇게 된다.
  if (_센것.has(뿌리)) return _센것.get(뿌리);
  const 약속 = (async () => {
  let 답 = null;
  try {
    const 셈 = new Map();
    const 첫파일 = new Map();
    for (const f of await walk(뿌리, { limit: 4000 })) {
      const g = 갈래(f.path);
      if (!g) continue;
      셈.set(g, (셈.get(g) ?? 0) + 1);
      if (!첫파일.has(g)) 첫파일.set(g, f.path);
    }
    const 차례 = [...셈.entries()].sort((a, b) => b[1] - a[1]);
    for (const [g] of 차례) {
      if (고르기(g, env)) { 답 = { 갈래: g, 대표파일: 첫파일.get(g), 개수: 셈.get(g) }; break; }
    }
  } catch { 답 = null; }
  return 답;
  })();
  _센것.set(뿌리, 약속);
  return 약속;
}

/** 시험이 쓴다 — 폴더를 새로 만들고 다시 셀 때. */
export function 셈지우기() { _센것.clear(); }
