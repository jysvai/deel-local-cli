// 파일 훑기와 glob 매칭. 외부 패키지 없이 직접 구현한다.
import { readdirSync, statSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, relative as 경로상대, basename as 끝이름, sep as 경로가름, resolve as 경로풀기 } from 'node:path';
import { decode, looksBinary } from './encoding.js';
import { 뿌리규칙읽기, 파일규칙읽기, 걸리나 } from './ignore.js';
// 살림이 **어디** 있는지는 config.js 한 곳만 안다 (DEEL_HOME 으로 옮길 수 있다).
import { homeDir } from '../config.js';

/**
 * 폴더를 통째로 옮겨 담는다.
 *
 * fs.cpSync 를 안 쓰는 이유가 둘이다.
 *
 *  1) Node 가 실험 기능으로 표시한 API 다. 판마다 동작이 다르고, 윈도우에서
 *     프로세스가 통째로 죽는 것을 실제로 겪었다 — 검사가 아무 말도 없이
 *     0xC0000409 로 끝났다. 배포되는 코드가 실험 API 에 매달려 있으면 안 된다.
 *
 *  2) cpSync 는 심볼릭 링크를 따라간다. 남이 준 플러그인 폴더에 바깥을 가리키는
 *     링크가 하나 있으면 그것까지 딸려 들어온다. 여기서는 링크를 건너뛴다 —
 *     플러그인은 제 폴더 안의 글 파일이면 충분하다.
 *
 * 하는 일이 뻔해서 읽으면 다 보인다. 그게 이 프로젝트가 원하는 것이다.
 */
export function copyDir(from, to, { skipped = [] } = {}) {
  /*
   * 담을 곳이 **원본 안**이면 시작도 안 한다.
   *
   * 담을 곳을 먼저 만들고 원본을 훑으니, 담을 곳이 원본 안이면 방금 담은 것을 또 훑어 또
   * 담는다. 끝이 없다. `cd ~` 에서 `/plugin install .` 한 번이면 그렇게 된다 — 임시 자리
   * `~/.deel/plugins/.tmp-local` 이 원본 안이라서다. 재어 보니 2분 만에 3,341단이었고
   * 디스크가 찰 때까지 안 멈춘다(2.0.0 6회차 사냥). 윈도우는 대소문자를 안 가르므로 낮춰 견준다.
   */
  const 견줄꼴 = (p) => { const r = 경로풀기(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
  const 원 = 견줄꼴(from);
  const 곳 = 견줄꼴(to);
  const 원끝 = 원.endsWith(경로가름) ? 원 : 원 + 경로가름;
  if (곳 === 원 || 곳.startsWith(원끝)) {
    throw new Error(`담을 곳이 원본 폴더 안이라 복사하지 않습니다 — 끝없이 제 안으로 복사하게 됩니다: ${to}`);
  }
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const s = join(from, e.name);
    const d = join(to, e.name);
    if (e.isSymbolicLink()) { skipped.push(s); continue; }
    if (e.isDirectory()) copyDir(s, d, { skipped });
    else if (e.isFile()) copyFileSync(s, d);
    // 그 밖(장치·소켓 같은 것)은 건너뛴다. 플러그인에 있을 이유가 없다.
    else skipped.push(s);
  }
  return { skipped };
}

/**
 * 다른 코딩 도구들이 제 살림을 넣어 두는 자리.
 *
 * 프로젝트 파일이 아니라 그 도구의 기록이다 — 지난 대화, 명령 이력, 캐시,
 * 그리고 열쇠. 이 작업과 아무 상관이 없는데 훑을 때 걸려 나오면 모델이
 * 그것부터 읽는다. 실제로 .claude/history.jsonl 을 읽어 컨텍스트를 채운 적이 있다.
 *
 * **목록은 여기 한 곳에만 둔다.** 전에는 훑는 쪽과 읽기 막는 쪽에 따로 적어
 * 놨는데, 그러면 한쪽에만 새 이름을 넣는 날이 반드시 온다. 훑을 때는 안 걸리는데
 * 이름을 대면 읽히는, 설명하기 어려운 상태가 된다.
 *
 * 새 도구는 계속 나온다. 여기 없는 이름이 보이면 그냥 한 줄 더하면 된다.
 */
export const 남의도구살림 = new Set([
  '.claude', '.codex', '.cursor', '.gemini', '.aider', '.continue', '.cline',
  '.roo', '.kilocode', '.windsurf', '.opencode', '.zed', '.trae', '.augment',
  '.qodo', '.tabnine', '.cody', '.sourcegraph', '.copilot', '.amazonq', '.junie',
  '.codeium', '.goose', '.crush', '.gptme', '.openhands', '.devin',
]);

// .aider.chat.history.md 처럼 폴더가 아니라 파일로 흘리는 것들도 있다.
export const 남의도구파일 = /^\.(aider|copilot|continue|cline|codeium|windsurf)[.-]/i;

export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.deel', '.svn', '.hg', 'dist', 'build',
  '.next', '.nuxt', '.cache', '__pycache__', '.venv', 'venv', 'target',
  ...남의도구살림,
]);

/**
 * 이 파일이 '읽어 봐야 도움이 안 되는 살림' 인가.
 *
 * 왜 막나:
 *   실제로 이런 일이 있었다 —
 *     ◧ Read(~/.deel/audit.jsonl)      77줄
 *     ◧ Read(~/.claude/history.jsonl)  35줄
 *   감사기록은 이 프로그램이 방금 무엇을 했는지 적어 둔 것이다. 그걸 다시 읽어
 *   대화에 넣으면 모델이 제 그림자를 좇는다. 사용자가 시킨 일과는 아무 상관이
 *   없고, 컨텍스트만 찬다.
 *
 *   설정 파일은 더 나쁘다. 게이트웨이 열쇠(apiKey)가 그 안에 있다.
 *   읽는 순간 그 열쇠가 대화에 실려 모델로 나가고, 세션 기록으로 디스크에도 남는다.
 *   열쇠를 그 열쇠의 주인에게 보내는 셈이다.
 *
 * 막는 것이지 숨기는 것이 아니다 — 왜 안 되는지 그대로 말해 준다.
 * @returns {string|null} 막을 이유. 막을 것이 아니면 null.
 */
export function 내부살림(abs) {
  const 편 = String(abs ?? '').replace(/\\/g, '/');
  /*
   * ── 조각마다 `:스트림` 꼬리를 벗기고 본다 (사냥6 F6-2) ───────────────────
   *
   * 윈도우(NTFS)는 `config.json::$DATA` 를 config.json **본체**로, `config.json:이름` 을 그
   * 파일에 붙은 딴 스트림으로 연다. 이 자는 조각을 글자 그대로 견줘서 그 철자가 전부 비켜 갔다 —
   *
   *     Read  .deel/config.json::$DATA     열쇠가 그대로 나왔다
   *     Write .deel/config.json::$DATA     **설정 본체를 덮어썼다**
   *     cat   .deel/audit.jsonl::$DATA     checkPaths 통과
   *
   * 드라이브 조각(`C:`)만 빼고 첫 `:` 뒤를 버린다.
   *
   * **윈도에서만** 그렇게 한다 (2.0.2 · 480). 유닉스·맥에서 `:` 는 그냥 글자이고 스트림이 없다 —
   * `.deel/config.json:v2` 는 설정 파일이 아니라 딴 파일이다. 모든 판에서 벗겼더니 리눅스에서 그런
   * 이름을 살림으로 잘못 알고 막았다(안전 쪽이지만 까닭 없는 막힘이다).
   */
  const 스트림꼴 = process.platform === 'win32';
  const 조각 = 편.split('/').map((x, 몇째) => (!스트림꼴 || (몇째 === 0 && /^[A-Za-z]:$/.test(x)) ? x : x.replace(/:.*$/s, '')));
  const 이름 = (조각[조각.length - 1] ?? '').toLowerCase();
  /*
   * 살림 자리를 `.deel` 이라는 **글자**로 찾고 있었다.
   *
   * 그 폴더는 옮길 수 있다 — `DEEL_HOME` 이 정식 설정이고(config.js), 사내
   * 휴대용 설치와 검사가 실제로 그걸 쓴다. 이름에 `.deel` 이 안 들어가는
   * 자리로 옮기면(`DEEL_HOME=D:/agent`) 이 막이 **통째로 풀린다.**
   * `config.json` 은 게이트웨이 열쇠가 든 파일이고, 이 자는 도구 울타리가
   * 부르는 자다(safety/guard.js 의 checkPaths) — 즉 그 순간 모델이
   * `cat D:/agent/config.json` 으로 열쇠를 읽는다.
   *
   * 기본 이름도 계속 본다. 옮겨 쓰다가 되돌린 사람, 프로젝트 안에 둔 `.deel`,
   * 남의 PC 에서 옮겨 온 폴더가 다 그 이름이다.
   */
  /*
   * ── 대소문자를 가려서는 안 된다 ─────────────────────────────────────
   *
   * `조각.lastIndexOf('.deel')` 는 **정확히 소문자**일 때만 찾았다. 그런데
   * 이 프로그램이 주로 도는 윈도우(NTFS)와 맥(APFS 기본)은 파일 이름의
   * 대소문자를 **안 가린다.** 즉 이름은 안 맞는데 파일은 열린다.
   *
   *     .deel/config.json   막힘
   *     .DEEL/config.json   통과 ← 같은 파일이 열린다 (열쇠가 그대로 나온다)
   *
   * 실제로 재 봤다. Read 도 Bash 의 checkPaths 도 둘 다 통과였다. 열쇠는
   * 대화에 실려 게이트웨이로 나가고 세션 기록으로 디스크에도 남는다 —
   * 「나가는 문은 하나」 라는 약속이 그 문으로 열쇠를 내보내는 꼴이다.
   *
   * 리눅스에서는 `.DEEL` 이 진짜 다른 폴더지만, 그 이름을 쓰는 사람은
   * 사실상 없다. 막아서 잃는 것보다 안 막아서 잃는 것이 비교가 안 된다.
   */
  let i = 조각.map((x) => x.toLowerCase()).lastIndexOf('.deel');
  if (i < 0) {
    try {
      const 집 = String(homeDir()).replace(/\\/g, '/').replace(/[/]+$/, '');
      const 낮은 = 조각.join('/').toLowerCase();
      const 집낮은 = 집.toLowerCase();
      if (집 && (낮은 === 집낮은 || 낮은.startsWith(집낮은 + '/'))) {
        i = 집.split('/').length - 1;
      }
    } catch { /* 집을 못 물어봐도 아래 이름 검사는 그대로 돈다 */ }
  }
  if (i >= 0) {
    // 폴더 이름과 같은 까닭으로 **안쪽 이름도** 대소문자를 안 가린다.
    // `.deel/CONFIG.JSON` 은 윈도우·맥에서 같은 파일이다.
    const 안 = 조각.slice(i + 1).map((x) => x.toLowerCase());
    /*
     * ── 폴더 **자체**를 가리키면 그것도 막는다 ──────────────────────────
     *
     * 여태 이 자는 「그 안의 파일」 만 봤다. `안` 이 비면(경로가 살림 뿌리
     * 자체면) 아무 갈래에도 안 걸리고 그대로 null 로 떨어졌다. 그래서
     * `rm -rf .deel/history` 는 막히는데 `rm -rf .deel` 은 통과했다 —
     * 같은 파일을 지우는 두 명령이 서로 다른 답을 받았다.
     *
     * 이 폴더에는 되돌리기 이력과 감사 기록이 산다. 되돌리기는 이 프로그램이
     * 승인 창을 안 띄우는 **근거**다(집안 규칙 3). 그 그물을 걷어 내는
     * 명령을 그냥 통과시키면 근거가 통째로 없어지고, 그 사실은 되돌리려고
     * 할 때에야 드러난다.
     *
     * 「작업 폴더 정리해 줘」 한 마디에 `rm -rf build dist .deel` 이 나오는
     * 것은 드문 일이 아니다.
     */
    if (안.length === 0) {
      return 'deel 자신의 살림 폴더입니다. 되돌리기 이력과 감사 기록이 들어 있어'
        + ' 통째로 건드리지 않습니다 — 지우면 /undo 가 되돌릴 것이 없어집니다.'
        + ' 안의 파일 하나가 필요하면 사용자에게 물어보세요.';
    }
    if (안[0] === 'config.json') {
      return 'deel 자신의 설정 파일입니다. 게이트웨이 열쇠가 들어 있어 읽지 않습니다.'
        + ' 연결 상태가 궁금하면 사용자에게 /status 를 쳐 보라고 하세요.';
    }
    /*
     * mcp.json 도 **열쇠를 담는다.**
     *
     * 붙인 MCP 서버마다 `env` 를 통째로 적어 두는 자리라(backend/mcp.js),
     * 토큰이 그대로 들어 있는 경우가 흔하다. config.json 만 막고 이걸 안
     * 막으면 막은 것이 아니다 — 여기가 config.json 과 **같은 종류의 파일**인데
     * 목록에만 안 올라와 있었다.
     *
     * 목록으로 막는 방식이 늘 이렇게 샌다. 새 살림 파일을 늘릴 때는 여기를
     * 같이 봐야 한다 (검사: test/mention.test.js).
     */
    if (안[0] === 'mcp.json') {
      return 'MCP 서버 설정 파일입니다. 붙여 둔 서버의 환경변수(열쇠·토큰)가 들어 있어 읽지 않습니다.'
        + ' 어떤 서버가 붙어 있는지가 궁금하면 사용자에게 /mcp 를 쳐 보라고 하세요.';
    }
    if (['audit.jsonl', 'sessions', 'history'].includes(안[0])) {
      return 'deel 자신의 기록입니다(무엇을 했는지 적어 둔 것). 지금 하는 일에 도움이 안 되고'
        + ' 컨텍스트만 차서 읽지 않습니다. 필요한 것은 대화에 이미 다 있습니다.';
    }
  }
  // 남의 도구 살림. 목록은 남의도구살림 한 곳에만 있다 — 훑는 쪽과 같은 것을 본다.
  // 여기도 대소문자를 안 가린다 — `.CLAUDE/history.jsonl` 은 윈도우·맥에서 같은 파일이다.
  const 걸린것 = 조각.find((seg) => 남의도구살림.has(String(seg).toLowerCase()))
    ?? (남의도구파일.test(이름) ? 이름 : null);
  if (걸린것) {
    return `${걸린것} 은 다른 코딩 도구가 제 기록을 넣어 두는 자리입니다.`
      + ' 지난 대화·명령 이력·열쇠 같은 것이라 이 작업과 상관이 없고, 읽으면 컨텍스트만 찹니다.'
      + ' 정말 그 안의 내용이 필요하면 사용자에게 직접 물어보세요.';
  }
  /*
   * ── 이름만 보고 막지 않는다 ──────────────────────────────────────────
   *
   * 여기가 `이름 === 'audit.jsonl'` 한 줄이었다. **자리를 안 봤다.** 그래서
   * 프로젝트가 제 감사 기록을 그 이름으로 쓰면 제 파일을 못 읽었다 —
   *
   *     Read src/audit.jsonl   「deel 자신의 기록입니다」
   *
   * 거짓 경고도 결함이다. 모델은 그 파일이 없는 것으로 치고 일하거나, 있지도
   * 않은 권한 문제를 찾아 헤맨다. 막는 것과 숨기는 것이 다르다고 적어 둔
   * 이 자가, 남의 파일을 제 것이라며 숨기고 있었다.
   *
   * deel 이 이 이름을 쓰는 자리는 **제 살림 폴더 안 하나뿐이다**
   * (safety/audit.js 의 join(dir, 'audit.jsonl') · stats.js 의
   * `.deel/audit.jsonl`). 그 자리는 위 `.deel` 갈래와 집 폴더 갈래가 이미
   * 잡는다 — DEEL_HOME 으로 옮겨도 그렇다. 이 줄은 그 둘이 다 빗나간 자리
   * (집을 못 물어본 판)를 위한 마지막 그물이다.
   *
   * 그 그물을 「숨은 폴더 안이면 살림」 으로 쳤더니 **또 남의 파일을 막았다.**
   * 「프로젝트의 소스·로그 폴더는 점으로 시작하지 않는다」 고 적어 뒀는데 그게
   * 틀렸다 — `.github/` · `.ci/` · `.circleci/` 는 프로젝트 제 폴더다.
   *
   *     Read .github/audit.jsonl   「deel 자신의 기록입니다」
   *
   * 이름만 보던 것을 자리까지 보게 고치면서, 자리를 「점으로 시작하나」 로만
   * 봐서 반만 고쳐져 있었다. 그래서 **살림 폴더 이름일 때만** 친다. 집을 못
   * 물어본 판에서도 DEEL_HOME 은 그대로 읽히니 옮긴 살림도 놓치지 않는다.
   */
  const 담긴곳 = (조각[조각.length - 2] ?? '').toLowerCase();
  const 살림꼬리 = String(process.env.DEEL_HOME ?? '').replace(/\\/g, '/').replace(/[/]+$/, '')
    .split('/').pop()?.toLowerCase() || null;
  if (이름 === 'audit.jsonl' && (담긴곳 === '.deel' || (살림꼬리 && 담긴곳 === 살림꼬리))) {
    return 'deel 자신의 기록입니다. 읽어도 지금 하는 일에 도움이 안 됩니다.';
  }
  return null;
}

// glob 을 정규식으로. **  *  ?  {a,b}  [abc] 를 지원한다.
export function globToRegex(pattern) {
  let re = '';
  let i = 0;
  /*
   * 앞머리 `./` 는 뗀다.
   *
   * 맞춰 보는 대상은 `src/a.js` 꼴의 상대경로라 `./src/*.js` 는 한 파일에도
   * 안 맞았다. 사람도 모델도 셸 버릇대로 `./` 를 붙여 적는데, 그러면
   * 「찾은 파일 없음」 이 뜨고 모델은 그 폴더에 파일이 없다고 믿는다.
   */
  const p = pattern.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  while (i < p.length) {
    const ch = p[i];
    if (ch === '*') {
      if (p[i + 1] === '*') {
        // **/ 는 "0개 이상의 폴더", ** 는 "무엇이든"
        if (p[i + 2] === '/') { re += '(?:[^/]*\\/)*'; i += 3; }
        else { re += '.*'; i += 2; }
      } else { re += '[^/]*'; i += 1; }
    } else if (ch === '?') { re += '[^/]'; i += 1; }
    else if (ch === '{') {
      const end = p.indexOf('}', i);
      if (end < 0) { re += '\\{'; i += 1; }
      else {
        /*
         * 갈래 **안쪽도 glob 이다.**
         *
         * 여기가 `escapeLiteral` 한 자였다. 그래서 `{*.js,*.ts}` 가 「`*.js` 라는
         * 이름의 파일」 이 됐다 — 그런 파일은 없으니 **늘 0건**이었다. 밖에 쓴
         * `*.{js,ts}` 는 되고 안에 쓴 것만 안 되니, 사람도 모델도 무늬가 틀렸다고
         * 생각하지 않고 「그 폴더에 그런 파일이 없다」 고 믿었다. 조용히 틀린 답을
         * 주는 자리라 못 찾았다고 말하는 것보다 나쁘다.
         *
         * 그래서 갈래마다 이 자를 다시 태운다. `*` · `?` · `[…]` · 겹친 중괄호가
         * 한 벌로 같이 풀린다. 앞뒤 닻(`^`·`$`)만 떼고 알맹이를 쓴다.
         */
        const parts = p.slice(i + 1, end).split(',')
          .map((조각) => globToRegex(조각).source.replace(/^\^/, '').replace(/\$$/, ''));
        re += `(?:${parts.join('|')})`;
        i = end + 1;
      }
    } else if (ch === '[') {
      const end = p.indexOf(']', i);
      if (end < 0) { re += '\\['; i += 1; }
      else {
        /*
         * glob 의 빼기는 `[!…]` 다. 정규식은 `[^…]` 다.
         *
         * 대괄호를 통째로 옮겨 적고 있어서 `file[!0-9].txt` 가 `[!0-9]` —
         * 「느낌표나 숫자」 — 가 됐다. 빼라고 한 file1.txt 가 걸리고 filea.txt
         * 는 빠졌다. 정반대 답이다. .gitignore 쪽(tools/ignore.js)은 이미
         * 바꿔 적고 있었고, rg 도 `[!…]` 를 빼기로 읽어서 Grep 은 엔진에
         * 따라 답이 뒤집혔다.
         */
        let 안 = p.slice(i + 1, end);
        if (안.startsWith('!')) 안 = `^${안.slice(1)}`;
        re += `[${안}]`;
        i = end + 1;
      }
    } else { re += escapeLiteral(ch); i += 1; }
  }
  return new RegExp(`^${re}$`, process.platform === 'win32' ? 'i' : '');
}

/*
 * ── glob 하나로 파일을 거르는 **한 벌뿐인** 자 ────────────────────────────
 *
 * Grep 의 glob 을 rg 는 제 작업 폴더 기준으로, 자바스크립트 길은 찾는 폴더
 * 기준 상대경로 · 파일 이름으로 맞췄다. 그래서 같은 명령이 이렇게 갈렸다:
 *
 *   glob=src/*.js                rg 가 있는 PC  →  (0건)       없는 PC → src/a.js
 *   path=src glob=src/**\/*.js    두 PC 다        →  (0건)       — 파일은 있다
 *   glob=!src/**                 rg → src 밖 파일들              JS → (0건, `!` 를 글자로)
 *
 * 규칙을 하나로 정한다. rg 쪽도 같은 규칙으로 인자를 만든다(fastgrep.js 의 rg글로브들).
 *
 *   · `!` 로 시작하면 **빼기**다 (rg · .gitignore 와 같다)
 *   · `/` 로 시작하면 작업 폴더(뿌리)에 묶는다 — 뿌리 기준 상대경로와만 견준다
 *   · 그 밖에는 찾는 폴더 기준 상대경로 · 파일 이름 · (빗금이 있으면) 뿌리 기준
 *     상대경로 중 하나라도 맞으면 맞는다
 *
 * @returns {(abs:string) => boolean}
 */
export function glob거르개(glob, { 뿌리 = null, 자리 = null } = {}) {
  if (!glob) return () => true;
  const 빼기 = glob.startsWith('!');
  let 몸 = 빼기 ? glob.slice(1) : glob;
  const 뿌리에묶임 = 몸.startsWith('/');
  if (뿌리에묶임) 몸 = 몸.replace(/^\/+/, '');
  const re = globToRegex(몸);
  const 빗금 = 몸.includes('/');
  const 상대 = (기준, p) => 경로상대(기준, p).split(경로가름).join('/');
  return (abs) => {
    let 맞음;
    if (뿌리에묶임) 맞음 = !!뿌리 && re.test(상대(뿌리, abs));
    else {
      맞음 = re.test(끝이름(abs))
        || (!!자리 && re.test(상대(자리, abs)))
        || (빗금 && !!뿌리 && re.test(상대(뿌리, abs)));
    }
    return 빼기 ? !맞음 : 맞음;
  };
}

function escapeLiteral(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 폴더를 훑어 파일 목록을 낸다. { path(절대), rel(/구분), mtime, size }
 *
 * `ignore` 가 켜져 있으면(기본) .gitignore 가 건너뛰라는 것은 건너뛴다 (tools/ignore.js).
 * skipDirs 는 그 아래의 바닥이다 — .gitignore 가 없어도 node_modules 는 늘 건너뛴다.
 * 돌려주는 배열에는 `건너뜀 = { 폴더, 파일, 못연폴더, 못연파일 }` 이 (열거되지 않게) 붙어 있다.
 * 앞의 둘은 .gitignore 가 빼라고 해서 뺀 수고, 뒤의 둘은 **열려다 실패한** 수다. 부르는 쪽이 그
 * 수를 화면에 적는다 — 조용히 빼면 "그 파일이 없다" 로 읽힌다.
 * 폴더를 통째로 옮기거나 복사할 때는 `ignore: false` 로 — 그때는 다 있어야 한다.
 *
 * `잘림` 도 같이 붙는다 — **상한에서 멈췄다는 뜻이다.**
 *
 * 전에는 이 상한이 조용했다. 파일 5만 개짜리 저장소에서 앞의 2만 개만 훑고
 * 멈추는데, 아무 데도 그 말이 안 나갔다. 그래서 `Grep` 이 "일치 없음" 이라고
 * 답했다 — 실제로는 뒤쪽 3만 개에 100군데가 있는데도. 못 찾은 것과 안 본 것은
 * 다르고, 그걸 안 가르면 사람은 없는 줄 알고 그냥 간다. 조용한 상한은
 * 틀린 답보다 나쁘다.
 */
export const 기본훑기상한 = 20000;

/**
 * 몇 개까지 훑을까.
 *
 * 2만 개는 대부분의 저장소에 넉넉하지만 큰 단일 저장소에는 모자란다. 그래서
 * 올릴 수 있게 열어 둔다 — 못 보는 것을 알려 주기만 하고 손쓸 방법이 없으면
 * 알려 준 뜻이 없다. 터무니없는 값은 안 받는다(100 미만·200만 초과).
 */
export function 훑기상한(env = process.env) {
  const n = Number(env.DEEL_WALK_LIMIT);
  if (!Number.isFinite(n) || n < 100 || n > 2000000) return 기본훑기상한;
  return Math.floor(n);
}

/**
 * 폴더를 훑는다.
 *
/*
 * ── 몇 개마다 한 번 숨을 쉴까 ───────────────────────────────────────────
 *
 * 숨 한 번은 setImmediate 한 번이고, 그 사이에 이벤트 루프가 한 바퀴 돈다.
 * 그 한 바퀴가 이 파일에서 제일 중요한 줄이다 — 그동안에만 키보드가 배달되고,
 * 그동안에만 signal.aborted 가 참으로 바뀔 수 있다.
 *
 * 자주 쉬면 훑기 자체가 느려지고, 드물게 쉬면 그만큼 귀를 닫는다. 200개면
 * 사내망 드라이브에서도 한 숨 사이가 10ms 언저리다.
 */
const 숨쉴간격 = 200;
const 한숨 = () => new Promise((풀기) => setImmediate(풀기));

/**
 * 폴더를 훑는다. **비동기다** — 부르는 쪽은 반드시 await 한다.
 *
 * @param {AbortSignal|null} signal 멈추라면 훑다 말고 나온다.
 *   사내망 드라이브에서는 파일 20,000개 훑기가 몇 초다. 그 사이에
 *   ESC 를 눌렀는데 끝까지 다 훑고 나서 멈추면, 사람 눈에는 멈추지
 *   않는 것으로 보인다. 나온 것에 `끊김` 을 달아 부르는 쪽이 알게 한다 —
 *   조용히 적게 돌려주면 「그런 파일이 없다」가 되어 버린다.
 *
 *   ── 왜 비동기여야 하나 ───────────────────────────────────────────────
 *
 *   여기 `signal?.aborted` 를 보는 줄은 오래 있었다. 그런데 훑기가 동기면
 *   그 줄은 **부르기 전에 이미 켜져 있던 깃발**만 볼 수 있다. 깃발을 켜는
 *   것은 이벤트 루프에 걸린 콜백인데, 동기 반복문이 도는 동안 이벤트 루프는
 *   한 칸도 안 돈다.
 *
 *   그래서 「누르고 나서 시킨」 것은 멈추고 「시켜 놓고 누른」 것은 안 멈췄다.
 *   사람이 실제로 하는 것은 뒤쪽인데. 지키는 것처럼 생겼는데 아무것도 안
 *   지키는 줄이었다 (검사: test/abort-tools.test.js 의 4-2).
 */
export async function walk(root, { limit = 훑기상한(), skipDirs = SKIP_DIRS, ignore = true, signal = null } = {}) {
  const out = [];
  /*
   * ── 안 본 것은 셋이다: 규칙으로 뺀 것 · 살림 폴더 · **못 연 것** ───────
   *
   * `폴더`·`파일` 은 .gitignore 가 빼라고 해서 뺀 수다. 우리가 보고 뺀 것이라
   * 셀 수 있었다. 그런데 **열다가 실패한 것**은 아무 데도 안 셌다 — 아래 두
   * catch 가 그냥 `continue` 였다.
   *
   * 그래서 이런 일이 있었다. 윈도우 ACL 이 막아 놓은 폴더 하나가 섞인
   * 저장소에서 Grep 을 돌리면 —
   *
   *     일치 없음: TODO
   *
   * 꼬리말도 없다. 건너뜀이 0이고 잘림도 거짓이니 `건너뜀말` 이 낼 줄이
   * 하나도 없어서다. 그 폴더 밑의 200개 파일은 **한 번도 안 열어 봤는데**
   * 화면에는 다 찾아본 것과 똑같이 뜬다. 사람도 모델도 "이 프로젝트엔
   * 그런 게 없다" 로 읽는다.
   *
   * 막는 자리는 흔하다 — ACL 로 막힌 폴더, 아직 안 내려받은 OneDrive
   * 자리표, 대상이 사라진 정션, 다른 프로그램이 잡고 있는 폴더.
   *
   * 이제 그 수를 따로 센다. **못 찾은 것과 못 본 것은 다르다**, 이 파일이
   * 잘림에 대고 이미 세 번 적어 둔 그 규칙이 여기에도 그대로 적용된다.
   * 같은 통에 담아 보내는 까닭은 부르는 쪽(Glob·Grep·Outline·Verify)이
   * 전부 이 통 하나를 `건너뜀말` 에 넘기기 때문이다 — 통을 새로 만들면
   * 넘기는 자리를 하나 빠뜨리는 날이 오고, 그날 이 말은 또 조용해진다.
   */
  const 건너뜀 = { 폴더: 0, 파일: 0, 못연폴더: 0, 못연파일: 0 };
  // .gitignore 로 건너뛴 것과 다르다 — 이쪽은 우리가 늘 안 보는 살림 폴더다.
  const 건너뛴살림 = [];
  let 끊김 = false;
  let 본것 = 0;
  /*
   * ── 살림은 **훑다가 흘러 들어와도** 안 내놓는다 (사냥6 F6-1) ──────────────
   *
   * 살림 폴더는 이름(skipDirs)으로만 건너뛰었다. 그래서 훑기를 `.deel` **안에서** 시작하면
   * (Glob·Grep·Outline 의 path) config.json·mcp.json 이 목록과 내용으로 그대로 나왔고,
   * 폴더가 아니라 파일로 흘리는 남의 도구 기록(`.aider.chat.history.md`)은 어디서 시작하든
   * 걸러지지 않았다. Read 는 같은 자리를 내부살림() 으로 막는데 훑는 쪽만 그 자를 안 썼다 —
   * 이 파일 머리말이 「목록은 한 곳에만」 이라고 적어 둔 까닭 그대로다.
   *
   * 그래서 시작 자리와 폴더·파일 하나하나를 **같은 자**로 본다. 건너뛴 것은 건너뛴살림 에
   * 넣는다 — Move 가 「안 뜬 것」 을 말할 때 이 목록을 쓴다.
   *
   * **시작 자리도 그 목록에 넣는다.** 여태 시작 자리만 빼고 있었다 — 안 훑기만 하고
   * 아무것도 안 남겼다. 그러면 살림 폴더를 통째로 옮길 때 Move 는 「안 뜬 것」 을 말할
   * 근거가 하나도 없어서 `폴더 0개 파일` 이라고 적고 넘어간다. 바로 윗줄이 이 목록의
   * 쓰임을 적어 놓고, 정작 제일 큰 한 덩이에서 비어 있었다.
   */
  const stack = 내부살림(root) ? [] : [{ dir: root, rel: '', 규칙: ignore ? 뿌리규칙읽기(root) : [] }];
  // 시작 자리가 살림이라 담을 것이 없으면 **그 사실도 남긴다** (바로 위 머리말).
  if (!stack.length) 건너뛴살림.push(끝이름(root));
  while (stack.length && out.length < limit) {
    if (signal?.aborted) { 끊김 = true; break; }
    const { dir, rel, 규칙 } = stack.pop();
    let entries;
    // 못 열면 그 폴더 밑은 통째로 안 본 것이다. 세어 두지 않으면 그 사실이
    // 아무 데도 안 남는다 — 위 건너뜀 선언에 왜 그게 나쁜지 적어 두었다.
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { 건너뜀.못연폴더 += 1; continue; }
    // 이 폴더에 .gitignore 가 있으면 그 아래에만 더한다 (뿌리 것은 위에서 읽었다).
    let 여기규칙 = 규칙;
    if (ignore && rel && entries.some((e) => e.name === '.gitignore' && e.isFile())) {
      const 추가 = 파일규칙읽기(join(dir, '.gitignore'), rel);
      if (추가.length) 여기규칙 = [...규칙, ...추가];
    }
    for (const e of entries) {
      /*
       * 본 것을 **거르기 앞에서** 센다 — 걸러낸 것도 readdirSync·걸리나 값을 이미 치렀다.
       *
       * 세기가 이 반복의 맨 끝에 있었다. 그런데 .gitignore·살림으로 거른 항목은 그 앞에서
       * continue 로 빠져나가 한 번도 안 셌다. 그래서 로그·빌드 찌꺼기가 수만 개 쌓인 폴더는
       * 숨 한 번 안 쉬고 끝까지 돌았고, 그동안 누른 ESC 는 다 돈 뒤에야 들렸다(2.0.0 6회차 사냥).
       */
      본것 += 1;
      if (본것 % 숨쉴간격 === 0) {
        await 한숨();
        if (signal?.aborted) { 끊김 = true; break; }
      }
      const full = join(dir, e.name);
      const erel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        // 살림 폴더(node_modules·.git·dist…)는 안 훑는다. 다만 **몇 개를
        // 안 봤는지는 센다** — Move 가 폴더를 통째로 옮길 때 이 수를 모르면
        // 「폴더 12개 파일」 이라고 말해 놓고 3만 개를 옮기게 된다.
        if (skipDirs.has(e.name) || 내부살림(full)) { 건너뛴살림.push(erel); continue; }
        if (여기규칙.length && 걸리나(erel, true, 여기규칙)) { 건너뜀.폴더 += 1; continue; }
        stack.push({ dir: full, rel: erel, 규칙: 여기규칙 });
      } else if (e.isFile()) {
        if (내부살림(full)) { 건너뛴살림.push(erel); continue; }
        if (여기규칙.length && 걸리나(erel, false, 여기규칙)) { 건너뜀.파일 += 1; continue; }
        let st;
        // 목록에는 있는데 물어보면 없다고 하는 파일이 있다 — 잠겨 있거나,
        // 아직 안 내려받은 자리표거나, 방금 사라진 것이다. 여기서 조용히
        // 빼면 그 파일은 처음부터 없던 것이 된다.
        try { st = statSync(full); } catch { 건너뜀.못연파일 += 1; continue; }
        out.push({ path: full, rel: erel, mtime: st.mtimeMs, size: st.size });
        if (out.length >= limit) break;
      } else {
        /*
         * ── 폴더도 파일도 아닌 것 — **여기서 조용히 사라지고 있었다** ────────
         *
         * readdir 은 lstat 으로 본다. 그래서 심볼릭 링크와 윈도우 정션은
         * isDirectory·isFile 이 **둘 다 false** 다. 위 두 갈래 어디에도 안 들어가니
         * 걸러지지도 세어지지도 않고 그냥 없어졌다 — 바로 위 건너뜀 선언이
         * 「대상이 사라진 정션」 을 못 본 자리로 꼽아 놓고, 정작 그것만 한 번도
         * 안 셌다. 재 보니 정션 하나가 끊긴 폴더에서도 `{"폴더":0,"파일":0,
         * "못연폴더":0,"못연파일":0}` 이라 꼬리말이 한 줄도 안 붙었다.
         *
         * **따라 들어가지는 않는다.** 바깥을 가리키는 링크 하나가 훑는 범위를
         * 통째로 넓히고, 제 안을 가리키면 끝없이 돈다 (copyDir 머리말과 같은
         * 자세다). 대신 **안 본 것으로 센다** — 못 찾은 것과 못 본 것은 다르다.
         * 무엇으로 셀지만 대상에게 물어본다. 대상이 사라졌으면 폴더 쪽으로 센다
         * (끊긴 정션은 거의 다 폴더를 가리키던 것이다).
         */
        let 딸린것;
        try { 딸린것 = statSync(full); } catch { 딸린것 = null; }
        if (딸린것?.isFile()) 건너뜀.못연파일 += 1;
        else 건너뜀.못연폴더 += 1;
      }
    }
    if (끊김) break;
  }
  Object.defineProperty(out, '건너뜀', { value: 건너뜀, enumerable: false });
  Object.defineProperty(out, '건너뛴살림', { value: 건너뛴살림, enumerable: false });
  // 상한까지 찼으면 "여기서 멈췄다" 고 표시한다. 딱 맞아떨어져 끝난 경우까지
  // 잘렸다고 하게 되지만, 그쪽으로 틀리는 편이 낫다 — 덜 봤다고 말하는 것은
  // 사람을 한 번 더 보게 만들 뿐이고, 다 봤다고 말하는 것은 못 보게 만든다.
  Object.defineProperty(out, '잘림', { value: out.length >= limit, enumerable: false });
  Object.defineProperty(out, '상한', { value: limit, enumerable: false });
  Object.defineProperty(out, '끊김', { value: 끊김, enumerable: false });
  return out;
}

/**
 * 글 파일을 읽는다. 무엇으로 쓰여 있든 알아보고 읽는다.
 *
 * 두 번째 값으로 '무엇으로 읽었는지' 를 같이 준다. 부르는 쪽이 그걸 기억해 뒀다가
 * 되돌려 쓸 때 같은 인코딩으로 넣어야 한다. 안 그러면 사내 CP949 문서를 한 번
 * 고치는 것만으로 UTF-8 로 바뀌어 버린다.
 */
export function readTextFull(path) {
  const buf = readFileSync(path);
  if (looksBinary(buf)) {
    const err = new Error('바이너리 파일입니다 — 텍스트로 읽을 수 없습니다');
    err.binary = true;
    throw err;
  }
  const r = decode(buf);
  // 읽은 바이트도 같이 준다. 되돌려 쓸 때 안 바뀐 자리는 **이 바이트 그대로** 둬야
  // 한다 — 옛 인코딩은 한 글자에 바이트 자리가 둘인 것이 있다 (encoding.js 의 바꾼데만쓰기).
  return { text: r.text, encoding: r.encoding, sure: r.sure, bom: r.bom ?? 0, buf };
}

/** 글만 필요할 때. 예전 부르던 자리를 그대로 두기 위해 남긴다. */
export function readText(path) {
  return readTextFull(path).text;
}
