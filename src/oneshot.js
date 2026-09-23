// 한 번만 돌고 끝내는 비대화 모드.  deel run "..."  ·  echo "..." | deel run
//
// 왜 따로 냈는가:
//   사내에 넣고 나면 곧바로 "배치에서 부르고 싶다" 는 말이 나온다. 야간 작업에
//   끼워 검사를 돌리거나, 파일 목록을 훑어 한 건씩 시키는 식이다.
//   그런데 대화 화면(repl.js)은 사람이 앞에 앉아 있다는 것을 전제로 만들었다 —
//   줄을 기다리고, 승인을 물어보고, 엑셀 암호를 물어본다. 그 자리에 사람이
//   없으면 프로그램은 터지지도 않고 그냥 서 있는다. 배치 잡의 시간 제한까지
//   서 있다가 죽고, 로그에는 아무 단서도 안 남는다.
//
//   그래서 '묻는 자리' 를 전부 없앤 길을 따로 낸다. 에이전트 루프는 그대로 쓴다 —
//   여기서 루프를 다시 짜면 두 벌이 되고, 언젠가 한쪽만 고쳐진다.
import { statSync } from 'node:fs';
import { c, mark, clip, 화면글거르기 } from './ui/ansi.js';
import { 규칙모으기, 정책읽기, 승인바닥 } from './safety/policy.js';
import { 훅읽기 } from './safety/hooks.js';
import { 에이전트읽기 } from './agent/agents.js';
import { 스키마읽기, 맞나, 답에서JSON뽑기, 시킬말 as 스키마시킬말 } from './agent/outschema.js';
import { 남길것읽기 } from './safety/shellenv.js';
import { 받기설정 } from './safety/authcmd.js';
import { run } from './agent/loop.js';
import { Session, 요청잘리나, 못박을길이 } from './agent/session.js';
import { 양수크기 } from './agent/models.js';
import { estimateTokens } from './backend/tokens.js';
import { makeScope } from './safety/guard.js';
import { 모두끄기 as 언어서버다끄기 } from './lsp/client.js';
import { 임시치우기 } from './tools/convert.js';
import { History } from './safety/undo.js';
import { Audit, 열쇠묻기 } from './safety/audit.js';
import { activeProfile, load, resolveKey, 소식줄들 } from './config.js';
import { 말 as 옮긴말 } from './i18n/index.js';
import { 알림채움, 알림말 } from './backend/retry.js';
import { 전선붙이기, 세션이름짓기 } from './backend/wire.js';
import { newId } from './agent/store.js';
import { discover, loadCommand } from './skills/discover.js';
import { 다붙이기 } from './backend/mcp.js';
import { 명령들 } from './cmdnames.js';
// 슬래시 명령을 찾는 규칙은 대화 화면과 **같은 것 하나**를 쓴다 (commands.js 의 슬래시명령찾기 머리말).
import { 슬래시명령찾기, 비슷한슬래시명령 } from './commands.js';
import { allowEndpoint, setOffline } from './safety/network.js';
import { 지금모드, 바깥인가, 나갈수있나, 봉인됐나 } from './safety/runmode.js';
import { 주소가리기 } from './safety/secrets.js';
import { probeCtx, 기본값 as CTX_DEFAULT } from './backend/ctxsize.js';
import { 잠잠기본, 무소식기본 } from './backend/http.js';
import { 인증서설정 } from './backend/clientcert.js';
import { route } from './agent/route.js';
import { get as getWork, 보일이름 } from './agent/modes.js';
import { 모두끝내기 as 일감모두끝내기, 일감인자 } from './tools/jobs.js';
import { 첫이름 } from './tools/label.js';
import { 검사설정 } from './agent/donecheck.js';

/**
 * 종료코드.
 *
 * 스크립트는 화면 글이 아니라 이 숫자만 본다. 그래서 '끝났다' 와 '끝난 척했다'
 * 를 반드시 갈라 놔야 한다 — 걸음 수 상한에 걸려 멈춘 것을 0 으로 돌려주면
 * 야간 배치가 아무 일도 안 하고 초록불을 켠다. 그게 제일 나쁜 결말이다.
 */
export const EXIT = {
  done: 0,      // 끝까지 답했다
  error: 1,     // 오류로 끝났다 (연결 없음 · 시킬 말 없음 · 모델 오류)
  limit: 2,     // 도구 호출 걸음 수 상한에 닿았다
  stuck: 3,     // 같은 자리에서 헛돌아 스스로 멈췄다
  aborted: 4,   // 도중에 끊겼다 (Ctrl+C)
  /*
   * 서버가 끝났다는 말을 한 번도 안 주고 답을 멈췄다.
   *
   * 여기에 자기 코드가 있어야 한다. 전에는 이걸 아예 안 보고 `done`(0) 으로
   * 끝냈다. `deel -p` 는 잡·CI 에서 돌고 그 뒤에 스크립트가 붙는데, 반쪽짜리
   * 답이 0 으로 넘어가면 그 스크립트는 온전한 답으로 알고 그대로 쓴다.
   * 사람이 나중에 결과를 보고 왜 반쪽인지 되짚을 방법이 없다.
   */
  cutoff: 5,
  /*
   * 모델이 안 하겠다고 했다 (안전 판정).
   *
   * 이것도 자기 코드가 있어야 한다. 거절한 답은 **아무 일도 안 한 답**인데,
   * 도구 호출이 없다는 것 말고는 짧은 답과 겉모습이 같다. 0 으로 끝내면
   * 뒤에 붙은 스크립트는 일이 된 줄 알고 그 다음 단계로 넘어간다.
   *
   * 오류(1)와도 갈라 둔다. 고칠 자리가 다르기 때문이다 — 오류는 연결이나
   * 열쇠를 보는 일이고, 거절은 **시킨 말을 바꾸는 일**이다.
   */
  refusal: 6,
  /*
   * 답이 --output-schema 에 안 맞았다.
   *
   * 여기에도 자기 코드가 있어야 한다. 「모양을 못 박아 달라」 고 한 사람에게
   * 모양이 안 맞는 것을 0 으로 넘기면, 파이프 뒤 스크립트가 그걸 온전한
   * 것으로 받아 쓴다 — 그게 이 기능이 없애려던 바로 그 상황이다.
   *
   * 오류(1)와도 가른다. 고칠 자리가 다르다 — 오류는 연결을 보는 일이고,
   * 이건 스키마나 시킨 말을 바꾸는 일이다.
   */
  schema: 7,
  /*
   * 완료 검사가 통과하지 않은 채 끝났다 (agent/donecheck.js · 2.1.0).
   *
   * 모델은 「다 됐습니다」 라고 했는데 사람이 정해 둔 검사(`--check` · 설정의 `check`)가
   * 정해 둔 판수를 다 돌고도 빨갛거나, 관문에 막혀 아예 못 돌았다. 0 으로 끝내면 야간
   * 배치가 빨간 검사 위에 초록불을 켠다 — 이 기능이 없애려던 바로 그 결말이다.
   *
   * 오류(1)와 가른다. 고칠 자리가 다르다 — 연결이 아니라 코드나 검사 쪽이다.
   */
  check: 8,
  /*
   * 인자를 잘못 줬다 — 모르는 깃발 · 값 없는 깃발 · 모르는 모드 이름 · 못 읽는 --ctx.
   *
   * 여기에 **따로** 둔다. 처음에는 `--work` 오타를 2 로 끝냈는데, 2 는 이 표에서 이미
   * 「걸음 수 상한」 이다. `deel run --jsn …` 을 CI 에 건 사람은 오타 하나로 「일이 커서
   * 멈췄다」 를 받고 작업을 쪼개러 간다. 고칠 자리가 스크립트 한 줄인데.
   *
   * 64 는 sysexits.h 의 EX_USAGE 다. 1~8 과 안 겹치고, 셸·CI 도구들이 「부른 모양이
   * 틀렸다」 로 이미 알아듣는 수라 새로 지어내지 않았다. 이 경우는 모델을 한 번도 안 부른다.
   */
  usage: 64,
};

/**
 * 모델을 부르기 전에 선 실패 한 덩이 (사냥5 B5-10).
 *
 * 성공한 `--json` 에는 model 과 usage.prompt·cacheRead·cacheWrite·못잰것 이 있는데, 모델을
 * 부르기 전에 선 실패(64 · 7 · 시킬 말 없음 · 없는 뿌리 · 연결 없음 · 대화 화면 전용)에는
 * 그 칸들이 없었다. `jq .usage.prompt` 는 null 을, 모양을 못 박은 파서는 오류를 낸다 —
 * 실패를 제일 잘 다뤄야 할 자리에서 파서가 먼저 죽는다. 칸은 늘 같게 두고 값만 비운다.
 *
 * bin/deel.js 의 인자탈·마지막 catch 도 이걸로 짓는다. 세 벌이면 언젠가 한 벌만 고친다.
 */
export function 실패덩이({ reason, code, why = '', model = null }) {
  return {
    ok: false, reason, code, text: '',
    tools: 0, steps: 0,
    usage: { in: 0, out: 0, prompt: 0, cacheRead: 0, cacheWrite: 0, calls: 0, ms: 0, 못잰것: 0, retries: 0 },
    model,
    ms: 0,
    ...(why ? { why } : {}),
  };
}

/**
 * 표준입력에 실려 온 말을 통째로 읽는다.
 *
 * 터미널이면 안 읽는다. 사람이 앉아 있는 자리에서 읽으려 들면 아무도 안 치는
 * 입력을 영영 기다린다 — 그게 바로 이 모드가 없애려는 상황이다.
 */
async function 표준입력읽기() {
  if (process.stdin.isTTY) return '';
  const 조각 = [];
  try {
    for await (const b of process.stdin) 조각.push(b);
  } catch { /* 파이프가 먼저 닫히면 읽은 데까지만 쓴다 */ }
  return Buffer.concat(조각).toString('utf8');
}

// 도구 한 줄 요약. 화면 그림이 아니라 로그에 남을 글이라 색을 아낀다.
function 도구줄(name, args) {
  const a = args ?? {};
  // 이름 차례는 tools/label.js 한 곳에서 온다 (다섯 벌이던 것을 모았다).
  const 첫 = 첫이름(a) ??
    (a.command ? String(a.command).replace(/\s+/g, ' ') : null) ??
    // 뒤에서 도는 명령. 번호가 곧 그 일감의 이름이라, 이게 없으면 기록에
    // `Jobs()` 만 여러 줄 남아 나중에 무엇을 본 것인지 알 수 없다.
    // 이름 고르기는 jobs.js 한 군데에만 둔다 (영문 이름도 받는다).
    (() => { const g = 일감인자(a); return g.번호 != null ? `${g.번호}번${g.끝내기 ? ' · 끝내기' : ''}` : null; })() ??
    // 한 번에 여러 파일을 쓴 경우. 기록에 빈 괄호만 남으면 나중에 이 줄로는
    // 무엇을 만들었는지 알 수 없다 — `deel run` 의 출력은 곧 근거로 쓰인다.
    (Array.isArray(a.files) && a.files.length
      ? `${a.files[0]?.file_path ?? '?'}${a.files.length > 1 ? ` 외 ${a.files.length - 1}개` : ''}`
      : null) ??
    (Array.isArray(a.edits) && a.edits.length
      ? `${a.edits[0]?.file_path ?? '?'}${a.edits.length > 1 ? ` 외 ${a.edits.length - 1}군데` : ''}`
      : null) ??
    (Array.isArray(a.paths) && a.paths.length ? `${a.paths.length}개` : null) ??
    (Array.isArray(a.todos) ? `${a.todos.length}건` : '');
  const 안 = clip(String(첫 ?? ''), 48);
  return `${name}${안 ? `(${안})` : ''}`;
}

/**
 * 한 턴만 돌린다.
 *
 * @param {object} opts
 *   prompt   시킬 말. 없으면 표준입력에서 읽는다
 *   root/mode/work/think/effort/ctx/offline  대화 시작 옵션과 같은 뜻
 *   yes      승인이 필요한 것도 그냥 실행 (기본은 거부)
 *   json     결과를 JSON 한 덩이로
 *   quiet    도구가 무엇을 했는지를 안 적는다 (오류는 그래도 적는다)
 * @returns {Promise<number>} 종료코드
 */
export async function runOnce(opts = {}) {
  const json = opts.json === true;
  const quiet = opts.quiet === true;

  // 두 갈래로 나눠 쓴다.
  //   표준출력 — 모델의 마지막 답만. 그래야 > 파일 이나 | grep 이 그대로 먹는다.
  //   표준오류 — 도구가 무엇을 했는지. 사람이 볼 것이지 넘겨줄 것이 아니다.
  // 이걸 섞으면 파이프 뒤에 붙은 명령이 도구 기록까지 받아 먹는다.
  // 도구 기록에는 모델이 적은 명령·경로가 실린다. **터미널**이면 들어온 제어 순서를 뗀다(ansi.js 화면글거르기) —
  // 파일·파이프로 받는 쪽은 적힌 그대로가 필요하므로 건드리지 않는다.
  const 삐끗 = (s = '') => process.stderr.write((process.stderr.isTTY ? 화면글거르기(s, { 색남김: true }) : s) + '\n');
  const 곁 = (s = '') => { if (!quiet) 삐끗(s); };

  // 아래 내놓기 가 이걸 본다 — 그래서 읽기 전에 선언해 둔다. 값은 시킬 말을
  // 정하기 전에 채운다 (모델을 부르기 전에 스키마부터 읽는 자리).
  let 출력스키마 = null;
  // 실패덩이에 실을 모델 이름 (사냥5 B5-10). 프로필을 찾기 전에 선 실패는 null 이다.
  let 알려진모델 = null;
  // 붙인 MCP 서버. 아래 내놓기 가 닫는다 — 그래서 여기서 선언한다 (2.0.2 · 문 맞춤).
  let mcp서버들 = [];

  const 내놓기 = (r) => {
    /*
     * 뒤에서 돌던 명령을 반드시 거둔다.
     *
     * 여기가 이 모드의 모든 끝맺음이 지나는 자리다. 배치는 이걸 빠뜨리면
     * 제일 크게 다친다 — 잡이 끝났다고 표시된 뒤에도 dev 서버가 계속 돌고,
     * 다음 잡이 같은 포트를 잡으려다 실패한다. 그 원인은 로그 어디에도 없다.
     */
    const 껐다 = 일감모두끝내기();
    if (껐다) 곁(`  ${mark.ok} ${c.gray(`뒤에서 돌던 명령 ${껐다}개를 껐습니다.`)}`);
    // 고친 뒤 진단 때문에 뒤에서 데워진 언어 서버도 같이 거둔다.
    // 이건 아무 말 없이 한다 — 사용자가 띄우라고 한 적이 없는 것이라,
    // 껐다는 말부터 하면 "그건 또 뭐냐" 가 된다.
    언어서버다끄기().catch(() => {});
    // 붙인 MCP 서버도 거둔다. 안 닫으면 잡이 끝난 뒤에도 남의 프로그램이 폴더를 물고 남는다.
    for (const 서버 of mcp서버들) { try { 서버.닫기(); } catch { /* 닫다 터져도 끝맺음은 간다 */ } }
    /*
     * 문서를 글로 바꾸며 떨군 임시 파일도 거둔다 (tools/convert.js 의 임시치우기).
     *
     * 아래 `root` 를 안 쓰고 같은 식을 다시 쓴다 — 이 자는 설정을 못 읽어 일찍
     * 끝나는 길에서도 지나가는데, 그때는 `root` 가 아직 안 만들어져 있다.
     * 그 자리에서 ReferenceError 가 나면 끝맺음 자체가 무너진다.
     */
    try { 임시치우기(opts.root ? String(opts.root) : process.cwd()); }
    catch { /* 못 거둬도 이 잡을 끝내는 데는 지장 없다 */ }
    if (json) process.stdout.write(JSON.stringify(r) + '\n');
    /*
     * 모양을 못 박았으면 표준출력은 **그 JSON 하나**다.
     *
     * 모델이 낸 글자 그대로가 아니라 우리가 읽어서 다시 적은 것을 낸다.
     * 그래야 ```울타리나 앞뒤 인사말이 절대 안 섞이고, `| jq` 가 첫 판부터
     * 그냥 먹는다. 어차피 맞는지 이미 쟀으므로 다시 적어도 잃는 것이 없다.
     */
    else if (r.schema !== undefined) process.stdout.write(JSON.stringify(r.schema) + '\n');
    /*
     * 모양을 못 박았는데 못 맞췄으면 **표준출력은 비운다.**
     *
     * 여기서 모델이 낸 글을 그대로 흘리면, 파이프 뒤 `jq` 는 모양이 안 맞는
     * JSON 이나 그냥 산문을 받는다. 종료코드는 7 이지만 `cmd | jq` 처럼 쓴
     * 자리에서는 앞 명령의 코드가 안 보인다. 아무것도 안 주는 쪽이 낫다 —
     * 무엇이 왔었는지는 표준오류에 이미 적혀 있다.
     */
    else if (출력스키마) { /* 일부러 아무것도 안 낸다 */ }
    else if (r.text) {
      // 사람 눈 앞의 터미널이면 답에 섞인 제어 순서를 뗀다. 파이프(`| jq` · `> 파일`)는 받은 글 그대로 둔다 —
      // 거기서는 명령으로 읽힐 터미널이 없고, 바이트를 바꾸면 스크립트가 받은 답이 모델이 낸 답과 달라진다.
      const 낼글 = process.stdout.isTTY ? 화면글거르기(r.text) : r.text;
      process.stdout.write(낼글.endsWith('\n') ? 낼글 : 낼글 + '\n');
    }
    return r.code;
  };
  // 시작도 못 한 실패. --quiet 여도 이유는 반드시 적는다 — 스크립트를 고칠 사람이 볼 유일한 글이다.
  const 못함 = (reason, message) => {
    삐끗(`  ${c.red('✗')} ${message}`);
    return 내놓기({
      // 갈래에 제 코드가 있으면 그것으로 끝낸다. 없는 갈래(no-config·no-prompt)는
      // 예전대로 1 이다 — 여기가 EXIT.error 로 못 박혀 있어서, 스키마 파일을
      // 못 읽은 것과 게이트웨이가 없는 것이 같은 1 로 나갔다. 고칠 자리가
      // 서로 완전히 다른 둘이라 스크립트가 갈라 대응할 수 없었다.
      ...실패덩이({ reason, code: EXIT[reason] ?? EXIT.error, why: message, model: 알려진모델 }),
    });
  };

  /*
   * 답의 모양을 못 박았으면 **일을 시작하기 전에** 스키마부터 읽는다.
   *
   * 다 돌리고 나서 「스키마 파일이 없습니다」 라고 하면 모델을 부른 값을
   * 통째로 버리는 셈이다. 그리고 그 실패는 사람이 오타 하나 고치면 되는
   * 것이라, 제일 먼저 알려 줘야 한다.
   */
  if (opts.outputSchema) {
    const r = 스키마읽기(String(opts.outputSchema));
    if (!r.ok) return 못함('schema', r.왜);
    출력스키마 = r.스키마;
    // 우리가 안 보는 열쇠는 안 본다고 말한다. 조용히 넘기면 사람은 잰 줄 안다.
    if (r.모른것.length) {
      곁(`  ${mark.warn} ${c.yellow(`스키마에서 안 재는 열쇠가 있습니다: ${r.모른것.join(' · ')}`)}`);
    }
  }

  /*
   * ── 없는 --root 를 만들어 놓고 그 안에서 일을 했다 ──────────────────
   *
   * 뿌리를 안 봤다. 기록·되돌리기 자리를 만드는 쪽이 `mkdir -p` 로 폴더를 통째로
   * 지어 주니, `deel run --root D:\일감\저장소` 에서 드라이브 글자 하나 틀린 배치가
   * **빈 폴더를 새로 만들고** 그 안에서 「없는 파일은 만든다」 대로 일을 해 0 으로
   * 끝났다. 진짜 저장소는 그대로다. 스크립트는 초록불이다.
   *
   * 시킬 말을 읽기 **전에** 본다. 표준입력이 열린 채면 거기서 먼저 서 버린다.
   */
  if (opts.root != null) {
    const 뿌리 = String(opts.root);
    let 폴더인가 = false;
    try { 폴더인가 = statSync(뿌리).isDirectory(); } catch { 폴더인가 = false; }
    if (!폴더인가) {
      return 못함('no-root', `작업 폴더가 없습니다 (--root): ${뿌리} — 없는 폴더를 만들어 그 안에서 일하지 않습니다`);
    }
  }

  // ── 시킬 말 ───────────────────────────────────────────────────────────
  // 인자로 준 것이 먼저다. 없을 때만 표준입력을 읽는다 —
  // 둘 다 있을 때 무엇이 이기는지가 헷갈리면 스크립트가 조용히 엉뚱한 일을 한다.
  let 시킬말 = String(opts.prompt ?? '').trim();
  if (!시킬말) 시킬말 = (await 표준입력읽기()).trim();
  if (!시킬말) {
    return 못함('no-prompt', '무엇을 시킬지 적어 주세요 — deel run "..." 또는 echo "..." | deel run');
  }

  /*
   * 작업 폴더를 **설정보다 먼저** 정한다.
   *
   * 여기는 `load()` 를 뿌리 없이 부르고 뿌리는 스무 줄 아래에서 정했다. 그러면
   * `deel run --root <폴더>` 에서 설정·신뢰·금지는 켠 자리 것을 보고 도구는 준 폴더를
   * 고친다 — acp/serve.js 의 방만들기가 이미 고친 바로 그 섞임이다.
   */
  const root = opts.root ? String(opts.root) : process.cwd();
  /*
   * 설정을 못 읽어도 **이 문의 끝맺음으로** 끝낸다.
   *
   * 여기서 던지면 bin/deel.js 의 마지막 catch 가 받아 표준출력에 맨 글을 찍었다.
   * `--json` 으로 부른 스크립트는 JSON 대신 「오류 설정 파일을…」 을 받아 파싱에서
   * 죽고, 진짜 까닭은 그 파싱 오류에 묻힌다. 도움말은 「답은 표준출력, 기록은
   * 표준오류」 라고 약속한다 — 못함() 이 그 약속대로 나눠 적는다.
   */
  let cfg;
  try { cfg = load({ root }); }
  catch (err) { return 못함('config', String(err?.message ?? err)); }
  // 모아 둔 소식을 표준오류로 비운다 (아래 conn 을 지은 자리의 머리말).
  const 소식비우기 = () => {
    for (const 줄 of 소식줄들(cfg)) {
      if (!줄) continue;
      try { process.stderr.write(`${줄}\n`); } catch { /* 못 써도 그만 */ }
    }
  };
  const prof = activeProfile(cfg);
  if (!prof) {
    // 연결이 없어 여기서 끝나도 소식은 낸다 — 「이 폴더 설정은 안 믿어서 안 읽었다」 가
    // 바로 연결이 없는 까닭일 수 있다.
    소식비우기();
    return 못함('no-config', '저장된 연결이 없습니다. deel setup 을 먼저 실행하세요.');
  }
  알려진모델 = prof.model ?? null;

  const conn = {
    kind: prof.kind, base: prof.baseUrl, auth: prof.auth,
    key: resolveKey(prof), model: prof.model,
    /*
     * 열쇠를 갖고 있는 대신 **받아 오는** 설정 (safety/authcmd.js).
     *
     * 여기서는 설정만 싣는다. 명령은 요청 직전에 부른다 — 켤 때 한 번
     * 받아 두면 한 시간짜리 토큰이 세 시간짜리 대화 한복판에서 죽고,
     * 그 401 은 화면에서 「열쇠가 틀렸다」 와 구별이 안 된다.
     */
    열쇠받기: 받기설정(prof, { 정책값: 정책읽기().값 }),
    // 0·음수·숫자 아님은 안 적은 것으로 친다 — 창 0 이면 접기가 영영 안 돈다 (사냥5 L5-6, models.js 의 양수크기).
    ctx: 양수크기(opts.ctx) ?? 양수크기(prof.ctx) ?? CTX_DEFAULT,
    // 답 길이 상한 — deel --max-tokens 32k 로 높일 수 있다(대화 화면의 /out 과 같은 값).
    // 0 이면 모든 요청이 바닥값 512 로 묶인다 (사냥5 L5-6).
    maxTokens: 양수크기(opts.maxTokens) ?? 양수크기(prof.maxTokens) ?? null,
    streaming: prof.streaming ?? false,
    tools: prof.tools ?? false, json: prof.json ?? false, think: prof.think ?? false,
    vision: prof.vision ?? false,
    /*
     * 흘려 받다가 이만큼 잠잠하면 끊는다 (밀리초, backend/http.js).
     *
     * 답이 다 오는 데 걸린 시간이 아니라 **아무것도 안 온 시간**이다. 그래서
     * 30분짜리 답은 안 끊기고 30초 멎은 연결은 30초에 끊긴다. 답을 통째로
     * 모았다가 한 번에 주는 사내 게이트웨이면 이 값을 올린다.
     */
    잠잠: prof.잠잠 ?? prof.streamIdleMs ?? 잠잠기본,
    // 바이트는 오는데 내용이 안 올 때의 전체 상한 (backend/http.js 의 무소식기본).
    무소식: prof.무소식 ?? prof.streamNoNewsMs ?? 무소식기본,
    // 게이트웨이가 우리 인증서를 요구하면 (mTLS, backend/clientcert.js).
    // 파일 경로만 싣는다 — 알맹이는 요청 직전에 읽는다.
    인증서: 인증서설정(prof),
  };

  /*
   * 모아 둔 소식을 **한 자리에서** 표준오류로 비운다 (config.js 의 소식줄들).
   *
   * 여기는 잠금·프로젝트설정·열쇠탈 셋을 따로 당겼고, 관리 정책이 깨졌다는
   * 넷째는 안 당겼다. 배치는 사람이 안 보는 자리라, 금지가 통째로 안 걸리는
   * 채로 돌아도 알 길이 없었다. 열쇠탈은 resolveKey 뒤라야 생기므로 conn 을
   * 지은 여기서 비운다. 표준출력은 JSON 을 읽는 쪽이 쓰므로 섞지 않는다.
   */
  소식비우기();

  /*
   * 자물쇠는 대화 화면과 똑같이 건다. 비대화라고 느슨해질 이유가 없다 —
   * 오히려 배치는 아무도 안 보는 자리라 더 단단해야 한다.
   *
   * 다른 것은 딱 하나, **물을 수가 없다**는 것이다. 파이프 뒤에는 답할 사람이
   * 없다. 그래서 여기서는 묻는 대신 멈추고, 무엇을 붙이면 되는지를 말한다.
   * 조용히 나가 버리면 스크립트가 바깥으로 나가고 있는 줄 아무도 모른다.
   */
  const 바깥연결 = 바깥인가(conn.base);
  const 실행모드 = 지금모드({
    online: opts.online === true,
    // 관리 정책이 offline 을 못박아 뒀으면 옵션과 상관없이 켠다 (safety/policy.js).
    // 셋 중 하나라도 켜져 있으면 켜진 것이다 (safety/runmode.js 의 봉인됐나).
    offline: 봉인됐나({ 깃발: opts.offline, prof, cfg }),
  });
  const 나감 = 나갈수있나(실행모드, { 바깥: 바깥연결, 허가: prof.online === true });
  if (나감.물어볼까) {
    const 어디 = (() => { try { return new URL(conn.base).host; } catch { return conn.base; } })();
    return 못함('needs-online',
      `이 연결은 이 컴퓨터 밖으로 나갑니다 (${주소가리기(어디)}). 여기서는 물어볼 수 없습니다.\n`
      + '    나가도 된다면 --online 을 붙이거나, 대화 화면(deel)에서 한 번 허락해 두세요.\n'
      + '    이 컴퓨터 안의 모델을 쓰려면 deel scan --save 로 붙이세요.');
  }
  allowEndpoint(conn.base);
  if (실행모드.허가무시) setOffline(true);

  const session = new Session(conn, {
    root,
    mode: opts.mode ?? 'auto',
    work: opts.work ?? null,
    think: opts.think ?? 'medium',
    effort: opts.effort ?? 'save',
    maxSteps: opts.maxSteps ?? null,   // null 이면 작업 모드가 정한다
  });
  // 지금 어느 실행 모드인가. 화면이 첫 줄에 이걸 그린다(ui/status.js).
  // session 에 실어 두는 까닭은, 대화 도중 /model 로 옮겨도 같은 자리를 보게 하려는 것이다.
  session.실행모드 = 실행모드;

  /*
   * ── 열쇠를 받아 오는 명령 (safety/authcmd.js) ───────────────────────
   *
   * 여기는 두 갈고리를 안 걸었다. backend/adapter.js 는 `물어보기` 가 없으면
   * **아무 말 없이** 명령을 띄우고, 못 받은 까닭은 `onAuth` 로만 알린다. 그래서
   * 배치에서는 사내 로그인 명령이 조용히 돌고, 실패하면 401 한 줄만 남았다.
   *
   * 물을 사람이 없는 문이라 묻지는 않는다 — 무엇을 띄우는지 **먼저 적고** 띄운다.
   * 명령은 이 PC 설정이나 관리 정책에서만 온다(저장소 설정의 열쇠받기는 읽을 때
   * 걷힌다 — safety/trust.js). 적는 곳은 표준오류다.
   */
  if (conn.열쇠받기) {
    const 알림 = (글) => { try { process.stderr.write(`  ${글}\n`); } catch { /* 못 써도 그만 */ } };
    session.열쇠물어보기 = async (설정) => {
      알림(`${mark.warn} ${c.gray('열쇠를 받아 오는 명령을 띄웁니다:')} ${clip(String(설정?.명령 ?? ''), 88)}`);
      return true;
    };
    session.onAuth = (것) => {
      if (것?.type === '시작') return 알림(c.gray(옮긴말('auth.waiting')));
      if (것?.type === '끝') return undefined;
      if (것?.ok) {
        const 분 = 것.만료 ? Math.max(0, Math.round((것.만료 - Date.now()) / 60000)) : '?';
        return 알림(`${mark.ok} ${c.gray(옮긴말('auth.got', { 분 }))}`);
      }
      알림(`${mark.warn} ${c.gray(옮긴말('auth.failed', { 왜: 것?.왜 ?? '?' }))}`);
      if (것?.보인것) 알림(`  ${c.gray(clip(String(것.보인것), 88))}`);
      return undefined;
    };
  }

  /*
   * 전선 카드와 이 실행의 이름 (backend/wire.js).
   *
   * 여기는 배운 것을 읽을 자리가 없다(배치는 대화 이력을 안 들고 돈다).
   * 그래도 짐작만으로 충분하다 — 짐작이 틀리면 첫 400 에서 그 자리 안에
   * 고쳐서 다시 부른다. 이름을 실어 보내는 것은 한 번의 실행이 게이트웨이
   * 대시보드에서 한 줄로 묶이게 하려는 것이다.
   */
  전선붙이기(conn);
  session.세션이름 = 세션이름짓기(newId());
  conn.세션이름 = session.세션이름;

  const found = discover(root);
  session.skills = found.skills;
  /*
   * 밖에서 붙인 도구(MCP) — 대화 화면·에디터와 **같은 규칙으로** 붙인다 (2.0.2 · 문 맞춤).
   *
   * 한 번 실행만 이 자리가 없었다. `.deel/mcp.json` 에 적어 둔 도구가 대화 화면에서는 되고
   * `deel run` 에서는 **말없이 없었다** — 모델은 없는 도구 대신 셸로 돌아가고, 왜 없는지는
   * 어디에도 안 남았다. 기본은 꺼져 있고(사람이 직접 적어야 뜬다) 봉인이면 안 띄우는 것도 같다.
   * 못 붙은 것은 표준오류에 적는다 — 표준출력은 답 자리다.
   */
  const mcp붙임 = await 다붙이기(root, {
    offline: 봉인됐나({ 깃발: opts.offline, prof, cfg }),
    audit: new Audit(root, { 열쇠들: 열쇠묻기(conn) }),
  }).catch((err) => ({ 서버들: [], 못한것: [{ 이름: '(전부)', 왜: String(err?.message ?? err) }] }));
  mcp서버들 = mcp붙임.서버들;
  session.mcp = mcp붙임.서버들;
  for (const m of mcp붙임.못한것 ?? []) 곁(`  ${mark.warn} ${c.yellow(`MCP ${m.이름} 을 못 붙였습니다 — ${m.왜}`)}`);
  session.commands = found.commands;
  session.plugins = found.plugins;

  /*
   * ── `deel run /이름` ──────────────────────────────────────────────────
   *
   * 사람이 대화 화면에서 쓰던 슬래시 명령을 배치에서도 그대로 부르게 한다.
   * `.claude/commands/배포점검.md` 를 만들어 두고 아침마다 손으로 `/배포점검`
   * 을 치고 있었으면, 그걸 야간 잡에 옮기는 데 드는 일이 이것 하나다.
   *
   * 여태는 `/배포점검` 이 **그냥 글자로** 모델에게 갔다. 슬래시가 붙은 낱말
   * 하나를 받은 모델은 대개 "무슨 뜻인지 모르겠다" 고 답하고 0 으로 끝난다 —
   * 아무 일도 안 했는데 배치는 초록불이다. 이 파일이 제일 피하려는 결말이다.
   *
   * 세 갈래로 끝난다.
   *   · 이 PC 에 파일로 있는 명령이면 → 본문을 펴서 그것을 시킨다
   *   · 대화 화면 전용 이름(/help·/undo…)이면 → 여기선 안 된다고 말하고 1
   *   · 아무것도 아니면 → 모르는 명령이라고 말하고 1
   * 두 실패 모두 **종료코드가 0 이 아니다.** 스크립트가 보는 것은 그 숫자다.
   *
   * 첫 낱말에 슬래시·역슬래시가 또 있으면 명령이 아니라 경로다(`/mnt/d/일감`).
   * 그건 건드리지 않고 시킨 말 그대로 둔다 — commands.js 의 경로처럼보이나 와
   * 같은 기준이다.
   */
  if (시킬말.startsWith('/')) {
    const [부른이름 = '', ...나머지] = 시킬말.slice(1).trim().split(/\s+/);
    const 경로인가 = 부른이름.includes('/') || 부른이름.includes('\\');
    /*
     * ── 홑슬래시 `/` 하나 (8회차 그밖 한번쓰기1) ──────────────────────────
     *
     * 이름이 빈 문자열이라 아래 갈래를 통째로 건너뛰었고, `/` 가 **그대로 모델에게**
     * 갔다 — 위 머리말이 막겠다고 적어 둔 바로 그 결말(슬래시 낱말 하나를 받은 모델이
     * "무슨 뜻인지 모르겠다" 고 답하고 0 으로 끝남)이 여기서 되살아나 있었다. 재 보니
     * 모델을 실제로 한 번 부르고 종료코드는 0 이었다.
     *
     * 스크립트가 `deel run "/$CMD"` 를 적어 두고 CMD 가 비면 이 자리로 온다. 그때
     * 초록불이 켜지면 안 돈 일이 돈 것으로 넘어간다. 경로도 아니고 이름도 없으니
     * 다른 두 실패와 같은 자리에서 끝낸다.
     */
    if (!부른이름) {
      return 못함('no-command', '슬래시 뒤에 명령 이름이 없습니다 — `/이름` 처럼 적으세요'
        + ' (.claude/commands · .deel/commands 에 적어 둔 것만 됩니다).');
    }
    if (!경로인가) {
      const 인자 = 나머지.join(' ');
      const 낮춘 = 부른이름.toLowerCase();
      /*
       * 붙박이 이름을 **먼저** 본다 — 대화 화면과 차례가 같아야 한다.
       *
       * commands.js 는 switch 로 붙박이를 먼저 받고, 못 받은 것만 default 에서
       * 찾아 쓴다. 그래서 대화 화면의 `/help` 는 언제나 도움말이다. 여기서
       * 차례를 뒤집으면 이 PC 에 `ralph-loop:help` 같은 플러그인 명령이 깔린
       * 순간 `deel run /help` 만 딴 것을 부른다 — 같은 글자가 창에 따라 다른
       * 일을 하는 것이 제일 나쁘다. 깔린 것에 따라 뜻이 흔들리면 안 된다.
       */
      const 붙박이 = !!명령들[낮춘];
      /*
       * 찾는 차례는 대화 화면과 같다 — 적은 그대로 · 대소문자 무시 · 꼬리 이름.
       *
       * 그 차례를 여기와 commands.js 에 **두 벌로** 적어 두고 있었고, 둘 다 꼬리를
       * 낮추지 않아 `ext:ReviewCode` 가 어느 창에서도 안 걸렸다 (8회차 그밖 한번쓰기·명령2).
       * 두 벌이니 한쪽만 고치면 또 갈린다. 그래서 규칙은 commands.js 한 군데에만 둔다.
       */
      const 찾은 = 붙박이 ? null : 슬래시명령찾기(found.commands, 부른이름);
      if (붙박이) {
        return 못함('repl-only', `/${부른이름} 은 대화 화면에서만 도는 명령입니다.`
          + ' 여기서 되는 것은 파일로 적어 둔 슬래시 명령뿐입니다 (.claude/commands · .deel/commands).');
      } else if (찾은) {
        const { text, error } = loadCommand(찾은, 인자);
        if (error) return 못함('command-read', `/${부른이름} 을 읽지 못했습니다 — ${error}`);
        곁(`  ${c.cyan('⌘')} ${찾은.name} ${c.gray(찾은.source)}`);
        시킬말 = text;
      } else {
        const 비슷 = 비슷한슬래시명령(found.commands, 부른이름).map((x) => '/' + x.name);
        return 못함('no-command', `모르는 명령 /${부른이름}`
          + (비슷.length ? ` — 비슷한 것: ${비슷.join('  ')}` : ' — 이 폴더에서 찾은 슬래시 명령이 없습니다.'));
      }
    }
  }

  // ── 물어보는 자리를 전부 막는다 ────────────────────────────────────────
  //
  // 여기가 이 파일의 핵심이다. 물어보는 함수 하나라도 기다리게 두면 그것 하나로
  // 배치가 선다. 그래서 세 자리 모두 '기다리지 않고 바로 답을 내는' 함수로 채운다.
  //
  // 승인은 기본이 거부다. 반대로 하면 안 된다 — 아무도 안 보는 자리에서
  // 되돌릴 수 없는 명령이 조용히 돌아가는 것이 이 프로그램이 제일 피하려는 일이다.
  // 정말 맡기고 싶은 사람은 --yes 로 그 뜻을 명시한다.
  /*
   * 관리 정책이 승인 바닥을 걸었으면 --yes 는 안 먹는다 (safety/policy.js 의 승인바닥).
   * 바닥은 「바꾸기 전에 사람이 본다」 는 약속인데, --yes 는 바로 그 사람을 빼는 깃발이다.
   * 둘이 같이 오면 정책이 이긴다 — 조용히 무시하지 않고 왜 안 먹는지 적는다.
   */
  const 바닥 = 승인바닥();
  const 자동승인 = opts.yes === true && 바닥.바닥 === 'auto';
  if (opts.yes === true && !자동승인) {
    곁(`  ${c.yellow('⊘')} ${c.gray(`--yes 를 안 씁니다 — ${옮긴말('approve.locked', { 바닥: 바닥.바닥, 곳: 바닥.곳 ?? '' })}`)}`);
  }
  /*
   * 사람이 적어 둔 훅을 읽는다 (safety/hooks.js).
   *
   * 여기서 **한 번만** 읽는다. 도구를 부를 때마다 읽으면 대화 도중에 훅
   * 파일이 바뀌는 것이 곧 「방금 통과한 것이 다음 걸음에 막힌다」 가 되고,
   * 그건 원인을 찾을 길이 없는 화면이다. 설정을 켤 때 한 번 읽는 것과 같다.
   */
  const 훅정보 = 훅읽기(root, { 켜짐: opts.hooks === false ? false : null });
  // 이름 붙인 하위 작업 (agent/agents.js). 스킬처럼 켜질 때 한 번 찾는다.
  const 에이전트정보 = 에이전트읽기(root);

  const ctx = {
    scope: makeScope(root),
    // 도구가 한 번에 돌려줄 양을 이 값에서 뽑는다 (agent/budget.js).
    // /model 로 갈아타면 conn 이 통째로 바뀌므로 그때마다 다시 읽는다.
    get 모델컨텍스트() { return conn.ctx ?? null; },
    // 이 모델이 그림을 볼 수 있나 — Read 가 그림을 만났을 때 무슨 말을 할지가 여기서 갈린다.
    get 눈있나() { return !!conn.vision; },
    // 적어 둔 허락·금지 규칙 (safety/policy.js). 승인 모드보다 먼저 본다.
    규칙들: 규칙모으기(cfg),
    // 사람이 적어 둔 훅 (safety/hooks.js). 프로젝트 파일은 믿는 폴더에서만 읽는다.
    훅들: 훅정보.훅들,
    // 이름 붙인 하위 작업. 목록은 Task 스키마에, 지침은 고른 뒤에만 실린다.
    에이전트들: 에이전트정보.에이전트들,
    // Bash 자식에게 되살려 줄 환경변수 이름 (safety/shellenv.js).
    // 기본은 열쇠처럼 생긴 이름을 다 빼는 것이고, 여기 적은 것만 되살린다 —
    // 사내 저장소를 쓰는 사람은 npm ci 에 NPM_TOKEN 이 실제로 필요하다.
    셸남길것: 남길것읽기(cfg),
    history: new History(root),
    audit: new Audit(root, { 열쇠들: 열쇠묻기(conn) }),
    seen: new Set(),
    // 붙은 MCP 서버. 도구를 부를 때 여기서 찾는다.
    mcp: mcp붙임.서버들,
    skills: found.skills,
    loadedSkills: new Set(),
    // 고친 뒤 진단을 볼지 (lsp/diag.js). 아래 내놓기() 에서 반드시 거둔다 —
    // 안 거두면 배치가 끝나고도 언어 서버가 폴더를 물고 남는다.
    lsp: { 켬: true },
    // 끝내려는 자리에서 돌릴 검사 (agent/donecheck.js). `--check` 가 설정의 check 를 이긴다.
    완료검사: 검사설정(cfg, opts.check),
    // 되물을 사람이 없으니 기본값을 그대로 돌려준다.
    ask: async (_label, o = {}) => o?.def ?? '',
    // 엑셀 암호를 여기서 기다리면 그대로 선다. 없다고 바로 답한다 —
    // 도구는 null 을 받으면 '암호가 걸려 못 읽었다' 고 정확히 말한다.
    askPassword: async () => null,
    confirm: async (name, args) => {
      const 무엇 = 도구줄(name, args);
      if (자동승인) {
        곁(`  ${c.yellow('!')} ${c.gray(`--yes 라서 묻지 않고 실행합니다 — ${무엇}`)}`);
        return true;
      }
      곁(`  ${c.yellow('⊘')} ${c.gray(`승인이 필요해 거부했습니다 (물어볼 사람이 없습니다) — ${무엇}`)}`);
      return false;
    },
  };

  /*
   * 거부당할 것을 모델에게 미리 알려 준다.
   *
   * 거부만 하고 이유를 안 알리면 모델은 같은 호출을 몇 번이고 다시 한다.
   * 사람이 '안 돼요' 라고 한 줄 알고, 다시 물어보면 이번엔 된다고 믿는다.
   * 그러면 걸음 수만 다 쓰고 아무것도 못 한 채 끝난다.
   *
   * 가르는 잣대는 **위 confirm 과 같은 것 하나**여야 한다 (8회차 그밖 한번쓰기2).
   * 여기는 `승인필요 && !자동승인` 이었고 그 `승인필요` 가 `session.mode !== 'auto'`
   * 였는데, `deel run` 의 기본 모드가 바로 auto 다 — 그래서 이 안내가 붙는 판이 하나도
   * 없었다(재 보니 `deel run 아무말` 이 보낸 사람말은 시킨 말 그대로였다). 정작 confirm 은
   * 모드를 안 보고 --yes 가 아니면 무조건 거부한다. 말과 행동이 갈려 있던 자리다.
   */
  const 보낼글바탕 = (!자동승인)
    ? `${시킬말}\n\n(비대화 모드다. 사람이 없어 승인을 물어볼 수 없고, 승인이 필요한 도구 호출은 자동으로 거부된다.`
      + ' 승인 없이 되는 방법을 골라라. 그래도 안 되면 무엇이 막혔는지 말로 알려라.)'
    : 시킬말;
  // 스키마는 시킨 말 **뒤에** 붙인다. 앞에 붙이면 모델이 「무엇을 하라」 보다
  // 「어떻게 적으라」 를 먼저 읽고, 일보다 모양에 힘을 쓴다.
  const 보낼글 = 출력스키마 ? `${보낼글바탕}\n${스키마시킬말(출력스키마)}` : 보낼글바탕;

  // ── 컨텍스트 길이 ─────────────────────────────────────────────────────
  //
  // 대화 화면과 같은 이유로 서버에 물어본다. 저장된 값을 믿으면 조용히 작아진다.
  // 다만 알아낸 값을 설정 파일에 도로 적지는 않는다 — 배치는 같은 명령을 여러 개
  // 동시에 띄우는 자리라, 그때마다 config.json 을 덮어쓰면 서로 밟는다.
  // 이번 한 번만 쓰고 버린다.
  if (opts.ctx == null) {
    try {
      const r = await probeCtx(conn, { timeout: 6000 });
      if (r?.value) {
        const 전 = conn.ctx;
        conn.ctx = r.value;
        if (전 !== r.value) {
          곁(`  ${mark.ok} ${c.gray(`컨텍스트를 ${전.toLocaleString()} → ${r.value.toLocaleString()} 로 맞췄습니다 (${r.source ?? '서버'}에서 읽음)`)}`);
        }
      }
    } catch { /* 못 물어보면 설정값 그대로 간다. 여기서 멈출 일은 아니다 */ }
  }

  /*
   * ── 시킬 말 하나가 창보다 크면 **부르기 전에** 선다 (사냥5 B5-01) ──────────────
   *
   * 162k 자를 표준입력으로 먹인 배치가 ok:true · 0 으로 끝났다. 루프는 창이 넘치자 대화를
   * 비우고 시킨 말을 앞 1,200자만 다시 박았다(session.js 의 못박은요청) — 모델은 그 앞부분만
   * 보고 「다 했다」 고 답했다. 한 방 실행에는 사람이 보고 나눠서 다시 시킬 다음 턴이 없다.
   * 시킬 말만으로 창을 넘으면 어떻게 돌려도 모델은 전부를 못 본다. 값을 쓰기 전에 말한다.
   *
   * 셈은 짐작(backend/tokens.js)이라 **넘친 게 분명할 때만** 선다. 문턱 근처는 돌려 보고,
   * 비우느라 시킨 말이 잘리면 아래 reset 갈래가 선다.
   */
  const 시킬말토큰 = estimateTokens(보낼글);
  if (시킬말토큰 > conn.ctx) {
    return 못함('too-big',
      `시킬 말이 컨텍스트 창보다 큽니다 — 약 ${시킬말토큰.toLocaleString('en-US')} 토큰 · 창 ${Number(conn.ctx).toLocaleString('en-US')} 토큰.`
      + ' 모델은 앞부분만 보게 되므로 부르지 않았습니다. 나눠서 시키거나, 창이 더 큰 모델이면 --ctx 로 알려 주세요.');
  }

  // 종합 모드면 이 한마디를 보고 알맞은 작업 모드로 옮긴다. 대화 화면과 같다.
  //
  // 딱 한 가지가 다르다 — **여기는 물어볼 사람이 없다.** 대화 화면은 겹친
  // 요청을 계획 모드로 보내고 턴 끝에 승인 창을 띄우지만, 여기서는 그 창이
  // 뜰 자리도 이어 갈 턴도 없다. 계획 모드는 파일을 고치는 도구가 없으니
  // 계획 한 장을 찍고 끝난다 — 시킨 일의 절반도 못 준다.
  session.routed = null;
  if (session.work === 'auto') {
    const 골라진 = route(시킬말, { 승인받을수있나: false });
    if (골라진.mode) {
      session.routed = 골라진.mode;
      const w = getWork(골라진.mode);
      곁(`  ${c.hcyan(w.glyph)} ${c.gray(`${w.name} (${w.en}) — 말 속에 ${골라진.why} 가 있어서`)}`);
    } else if (골라진.일부러 && !골라진.겹침) {
      /*
       * 일부러 안 보낸 자리만 말한다. 대화 화면과 같은 규칙이다 (repl.js 참고).
       *
       * 겹친 요청일 때는 여기서 안 찍는다 — 바로 아래가 같은 이야기를 더
       * 온전히 하고 있어서, 둘 다 찍으면 한 사실을 두 줄로 말하게 된다.
       */
      곁(`  ${c.gray(`◇ 종합 그대로 — ${골라진.why}`)}`);
    }
    /*
     * 겹친 요청이었다는 것은 말해 준다.
     *
     * 대화 화면은 「계획부터 냅니다 · 승인하면 그대로 이어서」 라고 적는다.
     * 여기서는 그 절차가 없으니 **다르게 한다** — 그러면 다르게 한다고
     * 적어야 한다. 안 적으면 계획을 먼저 볼 줄 알았던 사람이 파일이 이미
     * 바뀐 것을 나중에 본다.
     */
    if (골라진.겹침) {
      곁(`  ${c.gray('◇ 계획과 실행이 같이 있지만 여기는 승인받을 사람이 없어')}`
        + ` ${c.white('한 번에 끝까지')} ${c.gray('합니다.')}`
        + ` ${c.gray('계획을 먼저 보시려면 대화 화면에서 하세요.')}`);
    }
  }

  // ── 한 턴 ─────────────────────────────────────────────────────────────
  const turn = new AbortController();
  const 끊김 = () => { if (!turn.signal.aborted) turn.abort(); };
  process.on('SIGINT', 끊김);

  const t0 = Date.now();
  let reason = 'done';
  let why = '';
  let tools = 0;
  let steps = 0;
  let 이번단계글 = '';   // 지금 단계에서 모델이 흘린 글. 단계가 바뀌면 비운다
  let 답 = null;
  // 완료 검사의 마지막 결과 (agent/donecheck.js). 안 돌았으면 null 이다.
  let 검사결과 = null;
  // 서버가 끝났다는 말 없이 멈춘 적이 있나. 뒤에 오는 done 이 이걸 못 지운다.
  let 말없이끊겼나 = false;
  // 비우느라 시킨 말 뒤가 잘렸나 (사냥5 B5-01). 무엇으로 끝났든 이것이 까닭이 된다.
  let 시킨말잘림 = false;

  try {
    // 하위 작업 안쪽에서 온 이벤트는 그 겹만큼 들여 쓴다.
    const 안쪽 = (ev) => (ev.depth ? '  '.repeat(ev.depth) : '');

    for await (const ev of run(session, ctx, 보낼글, { signal: turn.signal })) {
      switch (ev.type) {
        case 'stage':
          steps = ev.step;
          이번단계글 = '';
          break;

        // 중간 단계의 말은 표준출력에 안 싣는다. "이제 파일을 읽어보겠습니다" 까지
        // 딸려 나가면 파이프 뒤에서 답만 골라 쓸 수가 없다.
        case 'content':
          이번단계글 += ev.text;
          break;

        case 'tool': {
          tools++;
          /*
           * 실패는 실패로 보여야 한다.
           *
           * 전에는 `error` 만 빨갛게 칠했다. 그런데 탈이 났는데 error 는 없는
           * 도구가 있다 — Bash 는 종료코드 3 을, Verify 는 `탈 2개` 를 요약에
           * 담아 돌려준다. 그것들이 회색으로 찍히면, 나중에 이 기록을 읽는
           * 사람 눈에는 성공과 구별되지 않는다. `deel run` 의 출력은 곧
           * 근거로 쓰이는 물건이라 그 구별이 사라지면 안 된다.
           */
          const 결과 = ev.result?.error
            ? c.red(clip(String(ev.result.error).split('\n')[0], 70))
            : ev.result?.failed
              ? c.yellow(clip(ev.result?.summary ?? '실패', 70))
              : c.gray(clip(ev.result?.summary ?? '완료', 70));
          // 하위 작업 안쪽이면 한 단 들여 그린다. 안 그러면 하위가 만진 파일이
          // 부모가 만진 것과 똑같이 찍혀서, 기록으로 읽을 때 구분이 안 된다.
          곁(`${안쪽(ev)}  ${c.cyan('⏺')} ${c.bold(도구줄(ev.name, ev.args))}  ${결과}`);
          /*
           * 비밀이 지나갔으면 여기서도 적는다.
           *
           * 배치는 아무도 안 보는 자리이고, 이 기록이 나중에 근거가 된다.
           * "열쇠가 대화에 들어갔다" 를 그 기록에서 빼면 안 된다 — 나중에
           * 사고가 났을 때 언제 새어 나갔는지 알 방법이 없어진다.
           */
          if (ev.비밀) {
            삐끗(`${안쪽(ev)}    ${ev.비밀.가렸나 ? c.gray('⊘') : c.yellow('!')} `
              + `${c.gray(`${ev.비밀.말}${ev.비밀.가렸나 ? ' — 모델에 가려서 보냈습니다' : ' — 파일 내용은 가리지 않습니다'}`)}`);
          }
          break;
        }

        /*
         * 하위 작업의 여닫는 줄.
         *
         * `deel run` 은 잡·CI 에서 돌고 그 기록이 나중에 근거가 된다. 하위가
         * 무엇을 맡았고 끝냈는지 안 남으면, 파일 넷이 어디서 나왔는지를
         * 기록만 보고는 알 수 없다.
         */
        case 'task_start':
          곁(`${안쪽(ev)}  ${c.magenta('⌥')} ${c.bold('하위 작업')} ${clip(ev.목적, 60)}`
            + `  ${c.gray(`따로 떨어진 대화 · 최대 ${ev.steps}걸음`)}`);
          break;

        case 'task_done': {
          const 끝 = ev.끝 ?? {};
          const 잘됨 = 끝.type === 'done';
          const 셈 = (끝.files ?? []).filter((f) => !f.dir && !f.missing).length;
          곁(`${안쪽(ev)}  ${잘됨 ? c.green('✓') : c.yellow('⚠')} ${c.gray('하위 작업')} ${clip(ev.목적, 50)}`
            + `  ${c.gray(잘됨 ? `끝냄 · 파일 ${셈}개 · ${끝.steps ?? 0}걸음` : `다 못 했습니다 (${끝.type}) · ${끝.steps ?? 0}걸음`)}`);
          break;
        }

        case 'retry':
          곁(`  ${c.yellow('↻')} ${c.gray(`${ev.why} — 상한을 ${ev.from} → ${ev.to} 로 올려 다시 부릅니다`)}`);
          break;

        // 서버가 잠깐 막아서 기다렸다 다시 부른 자리 (backend/retry.js).
        // 배치 기록에 남아야 "그날 밤 왜 12분이 걸렸나" 를 나중에 읽을 수 있다.
        case 'backoff':
          // 맞고 물러난 것과 맞기 전에 비킨 것은 다른 일이다. 같은 말로 적으면
          // 있지도 않은 429 가 배치 기록에 남는다.
          곁(ev.미리
            ? `  ${c.yellow('⏸')} ${c.gray(옮긴말(알림말(ev), { 초: 알림채움(ev).초 }))}`
            : `  ${c.yellow('↻')} ${c.gray(옮긴말('loop.backoff', 알림채움(ev)))}`);
          break;

        // 서버가 안 받는 칸이 있어 전선 카드를 고쳤다 (backend/wire.js).
        case 'wire':
          곁(`  ${c.cyan('⚙')} ${c.gray(옮긴말('loop.wire', { 무엇: ev.무엇 }))}`);
          break;

        /*
         * 종합 모드가 턴 도중에 단계를 옮겼다 (agent/phase.js).
         *
         * 한 방 실행에서 특히 남겨야 하는 줄이다. `deel -p` 는 잡·CI 에서 돌고
         * 그 기록만 나중에 남는다 — 「계획만 내고 끝날 줄 알았는데 파일이
         * 바뀌어 있다」 를 되짚을 자리가 여기 말고는 없다.
         */
        case '단계옮김':
          곁(`  ${c.hcyan('→')} ${c.gray(옮긴말('ev.phaseMove', {
            왜: 옮긴말(ev.왜 === '바꿈' ? 'ev.phaseWhyEdit' : 'ev.phaseWhyTodo'),
            옛: 보일이름(ev.옛),
            새: 보일이름(ev.새),
          }))}`);
          break;

        // 바이트만 오고 내용이 안 오는 자리. 배치 기록에 남아야 「그날 밤 왜
        // 12분이 걸렸나」 를 나중에 읽을 수 있다.
        case '소식없음':
          곁(`  ${c.yellow('⧗')} ${c.gray(옮긴말('ev.noNews', { 초: ev.초 }))}`);
          break;

        case 'folded':
          곁(`  ${c.cyan('◲')} ${c.gray(`오래된 도구 결과 ${ev.접은것}개를 접었습니다 (${ev.아낀토큰.toLocaleString()} 토큰을 비움)`)}`);
          break;

        case 'images_folded':
          곁(`  ${c.cyan('◲')} ${c.gray(`오래된 그림 ${(ev.뺀것들 ?? []).reduce((a3, x) => a3 + x.장수, 0)}장을 뺐습니다`)}`);
          break;

        case 'compacted':
          // 요약을 못 받고 잘라 낸 것은 그렇게 적는다 (repl.js 의 compacted 머리말).
          곁(ev.fallback
            ? `  ${c.cyan('◱')} ${c.yellow(`요약을 못 받아 옛 대화 ${ev.folded}개를 잘라 냈습니다 (${ev.before.toLocaleString()} → ${ev.after.toLocaleString()} 토큰)`)}`
              + (ev.why ? ` ${c.gray(`— ${clip(String(ev.why), 100)}`)}` : '')
            : `  ${c.cyan('◱')} ${c.gray(`대화 ${ev.folded}개를 요약으로 접었습니다 (${ev.before.toLocaleString()} → ${ev.after.toLocaleString()} 토큰)`)}`);
          break;

        case 'compact_failed':
          곁(`  ${c.gray(`(접지 못했습니다: ${ev.why})`)}`);
          break;

        /*
         * ── 여기 넷은 여태 아예 안 보고 있었다 ────────────────────────
         *
         * 대화창은 넷 다 화면에 적어 준다. 한 방 실행은 안 적었다. 그래서
         * 잘린 답이 **온전한 답인 척** 파이프 뒤로 넘어갔다. `deel -p` 는
         * 잡·CI 에서 돌고 그 기록이 나중에 근거가 되는 물건이라, 여기서
         * 빠지면 왜 반쪽인지 되짚을 자리가 아무 데도 없다.
         */
        case 'capped':
          곁(`  ${c.yellow('⚠')} ${c.gray(옮긴말('ev.capped', { 한계: ev.cap.toLocaleString() }))}`);
          break;

        /*
         * 말없이 끊긴 것은 **종료코드까지** 바꾼다.
         *
         * 뒤에 done 이 따라오므로 그대로 두면 0 으로 끝난다. 잘렸다는 사실을
         * 화면에만 적고 코드로는 성공이라고 하면, 스크립트는 화면을 안 읽으니
         * 아무 일도 없던 것이 된다. 다만 여기서 곧바로 reason 을 바꾸지는
         * 않는다 — 뒤에 오는 done 이 덮어쓰기 때문에 표시만 해 두고
         * 루프가 끝난 뒤에 판정한다.
         */
        case 'cutoff':
          말없이끊겼나 = true;
          곁(`  ${c.yellow('⚠')} ${c.gray(ev.멎은초
            ? 옮긴말('ev.stalled', { n: ev.멎은초 })
            : 옮긴말('ev.cutoff'))}`);
          break;

        case 'hook_note':
          for (const 줄 of String(ev.말).split('\n').slice(0, 8)) 곁(`  ${c.gray(`· ${줄}`)}`);
          break;

        case 'hook_block':
          곁(`  ${c.yellow('✗')} ${c.gray(옮긴말('ev.hookBlock'))}`);
          break;

        case 'check_start':
          곁(`  ${c.cyan('⧗')} ${c.gray(옮긴말('check.start', { 판: ev.판, 최대: ev.최대, 명령: ev.명령 }))}`);
          break;

        case 'check':
          if (ev.ok === true) 곁(`  ${mark.ok} ${c.gray(옮긴말('check.pass', { 명령: ev.명령 }))}`);
          else if (ev.ok === false) {
            곁(`  ${c.red('✗')} ${c.gray(옮긴말('check.fail', { 판: ev.판, 최대: ev.최대, 요약: ev.요약 }))}`);
            // 실패 출력의 끝 몇 줄 — 배치 로그를 보는 사람이 무엇이 틀렸는지 여기서 안다.
            for (const 줄 of String(ev.꼬리 ?? '').trim().split('\n').slice(-8)) if (줄.trim()) 곁(`     ${c.gray(줄)}`);
            곁(`     ${c.gray(ev.판 < ev.최대 ? 옮긴말('check.retry') : 옮긴말('check.gaveUp', { 판: ev.판 }))}`);
          } else 곁(`  ${c.yellow('⊘')} ${c.gray(옮긴말('check.skipped', { 까닭: ev.까닭 }))}`);
          break;

        case 'nudge':
          곁(`  ${c.gray(`↺ ${ev.why === '요청누락'
            ? 옮긴말('ev.nudgeMissed', { n: ev.빠진?.length ?? 0 })
            : 옮긴말('ev.nudgeRead')}`)}`);
          break;

        /*
         * 모델이 안 하겠다고 했다.
         *
         * 화면에만 적고 종료코드는 0 으로 두면, 뒤에 붙은 스크립트가 일이
         * 된 줄 알고 다음 단계로 넘어간다. 거절은 **아무 일도 안 한 것**이라
         * 그렇게 넘어가면 안 된다. 여기서 곧바로 정한다 — 이 뒤에는 done 이
         * 안 온다(루프가 그 자리에서 끝낸다).
         */
        case 'refusal':
          reason = 'refusal';
          why = 옮긴말('run.refusal');
          /*
           * 모델이 **뭐라고 하면서** 거절했는지도 내놓는다.
           *
           * 이 규격도 거절 글을 조각으로 보내기는 하는데, 그 조각을 답
           * 자리로 흘려보내지 않고 맨 끝에 한 번에 모아 준다(backend/adapter.js
           * 의 흡수). 그래서 여기서 안 담으면 화면에도 파이프 뒤에도 아무 글이
           * 안 남고 「거절당했습니다」 한 줄만 보인다 — 무엇을 고쳐 다시
           * 물어야 할지 알 길이 없다.
           */
          if (ev.text) 답 = ev.text;
          곁(`  ${c.yellow('⚠')} ${c.gray(옮긴말('run.refusal'))}`);
          if (ev.왜 && ev.왜 !== 'refusal') 곁(`     ${c.gray(옮긴말('run.refusalWhy', { 왜: ev.왜 }))}`);
          break;

        case 'note':
          곁(`  ${c.gray(`· ${ev.text}`)}`);
          break;

        // 자리가 다 차서 비웠다. 오류가 아니라 이어 가는 중이라, 종료코드는 안 건드린다.
        case 'reset':
          곁(`  ${c.cyan('◱')} ${c.gray((ev.kept?.할일 ?? 0)
            ? 옮긴말('ev.reset', { 버린수: ev.dropped, 할일: ev.kept.할일 })
            : 옮긴말('ev.resetBare', { 버린수: ev.dropped }))}`);
          /*
           * ── 비우면서 **시킨 말 뒤가 잘렸으면** 여기서 선다 (사냥5 B5-01) ────────────
           *
           * 비울 때 시킨 말은 앞 1,200자만 다시 박힌다(session.js 의 못박은요청). 대화
           * 화면은 사람이 보고 나눠서 다시 시키면 되지만, 여기서는 모델이 앞부분만 받아
           * 「다 했다」 고 답했고 배치는 ok:true · 0 으로 끝났다 — 시킨 일의 뒷부분은 한 번도
           * 못 본 채로. 한 방 실행에는 이어 줄 다음 턴이 없다. 잘린 채로 끝까지 가는 것보다
           * 여기서 서서 「시킬 말이 창보다 크다」 고 말하는 편이 뒤의 스크립트에 정직하다.
           * 짧은 시킬 말은 비워도 통째로 다시 박히므로 그대로 이어 간다.
           */
          if (요청잘리나(session)) {
            시킨말잘림 = true;
            끊김();
          }
          break;
        case 'learned':
          곁(`  ${c.cyan('◎')} ${c.gray(ev.what === 'ctx'
            ? 옮긴말('ev.learnedCtx', { 한계: ev.limit.toLocaleString() })
            : 옮긴말('ev.learnedOut', { 한계: ev.limit.toLocaleString() }))}`);
          break;

        case 'limit':
          reason = 'limit';
          why = `도구 호출 ${ev.steps}회에서 멈췄습니다. 한 번에 하기엔 큰 일입니다 — 나눠서 시키세요.`;
          break;

        case 'stuck':
          reason = 'stuck';
          why = String(ev.why ?? '같은 자리에서 헛돌고 있어 멈췄습니다');
          break;

        case 'aborted':
          reason = 'aborted';
          why = '중단했습니다';
          break;

        case 'error':
          reason = 'error';
          why = String(ev.text ?? '알 수 없는 오류');
          break;

        case 'done':
          reason = 'done';
          답 = ev.text ?? 이번단계글;
          검사결과 = ev.검사 ?? null;
          break;
      }
    }
  } catch (err) {
    reason = 'error';
    why = String(err?.message ?? err);
  }
  // SIGINT 손은 여기서 안 뗀다 — 모양 고치기 되물음까지 끝난 뒤에 뗀다 (사냥5 B5-02, 아래 finally).

  // 끝까지 못 갔어도 여기까지 나온 말은 내준다. 빈손으로 돌려보내면
  // 왜 안 됐는지 짐작할 거리조차 없다.
  if (답 == null) 답 = 이번단계글;

  /*
   * 시킨 말이 창에 다 안 들어가 잘렸으면 무엇으로 끝났든 그것이 까닭이다 (사냥5 B5-01).
   * 위 reset 갈래가 턴을 끊었으므로 reason 은 aborted 로 와 있다 — 사람이 끊은 것이 아니다.
   * 모델이 본 것이 앞부분뿐이라고 적고 0 이 아닌 코드로 선다.
   */
  if (시킨말잘림) {
    reason = 'too-big';
    why = `시킬 말이 컨텍스트 창(${Number(conn.ctx).toLocaleString('en-US')} 토큰)에 다 안 들어가 뒷부분이 잘렸습니다`
      + ` — 모델은 앞 ${못박을길이.toLocaleString('en-US')}자만 봤습니다. 나눠서 시키거나, 창이 더 큰 모델이면 --ctx 로 알려 주세요.`;
  }

  /*
   * 말없이 끊긴 답은 '다 됐다' 로 안 넘긴다.
   *
   * done 이 뒤따라오므로 그냥 두면 reason 이 done 으로 덮인다. 그런데 그
   * 답은 중간에서 끊긴 물건이다. 여기서 갈라 주지 않으면 파이프 뒤 스크립트가
   * 반쪽을 온전한 것으로 받아 쓴다 — 그러고도 아무 표시가 안 남는다.
   * 진짜 탈(error·limit·stuck)이 이미 잡혔으면 그쪽이 먼저다.
   */
  if (말없이끊겼나 && reason === 'done') {
    reason = 'cutoff';
    why = 옮긴말('ev.cutoff');
  }

  /*
   * ── 답이 정해진 모양에 맞나 ──────────────────────────────────────────
   *
   * 「JSON 으로 답해 줘」 라고 부탁만 하고 안 재면, 지키는 날과 안 지키는
   * 날이 생긴다. 안 지킨 날에 깨지는 것은 우리가 아니라 **뒤에 붙은 남의
   * 코드**다. 부탁은 계약이 아니다. 계약이라고 부르려면 재야 한다.
   *
   * 안 맞으면 무엇이 어떻게 안 맞는지를 그대로 돌려주고 한 번만 더 시킨다.
   * 두 번 세 번 되풀이하지 않는다 — 한 번에 못 고치는 것은 대개 스키마와
   * 시킨 말이 서로 안 맞는 것이고, 그건 사람이 볼 일이다.
   */
  let 스키마값 = null;
  if (출력스키마 && reason === 'done') {
    const 재보기 = (글) => {
      /*
       * 재다가 던지면 **스키마 실패로** 받는다 (사냥5 L5-3).
       *
       * 여기는 try 바깥이었다. 제자리를 도는 참조 같은 스키마 쪽 탈이 호출 스택을 넘기면
       * runOnce 가 통째로 던졌고, bin/deel.js 가 표준출력에 맨 글 「오류 Maximum call stack…」
       * 을 찍었다 — 모양을 못 박아 달라던 파이프에 산문이 흘렀다. 읽는 자리(스키마읽기)가
       * 고리를 먼저 막지만, 못 막은 탈도 7 이어야 한다.
       */
      try {
        // 스키마를 같이 넘긴다 — 뽑을 것이 여럿이면 스키마에 맞는 쪽을 고른다 (사냥5 B5-06).
        const 뽑은것 = 답에서JSON뽑기(글, { 스키마: 출력스키마 });
        if (!뽑은것.ok) return { ok: false, 탈: [뽑은것.왜] };
        const r = 맞나(뽑은것.값, 출력스키마);
        return r.ok ? { ok: true, 값: 뽑은것.값, 군말: 뽑은것.군말 } : r;
      } catch (err) {
        return { ok: false, 탈: [`스키마로 재다가 멈췄습니다: ${err?.message ?? err}`] };
      }
    };

    let 잰것 = 재보기(답 ?? '');
    if (!잰것.ok) {
      곁(`  ${mark.warn} ${c.yellow(`답이 스키마에 안 맞습니다 — 한 번 더 시킵니다 (${잰것.탈.length}건)`)}`);
      for (const t of 잰것.탈.slice(0, 5)) 곁(`    ${c.gray(t)}`);

      /*
       * 다시 받는 자리는 **글만** 받는다.
       *
       * 이건 새 일이 아니라 이미 낸 답을 모양에 맞춰 다시 적는 일이라,
       * 도구 기록도 걸음 수도 다시 세지 않는다. `고쳐쓰기` 는 그 자리에
       * 되밀기가 안 걸리게 한다 — 안 끄면 되묻기 한 번에 모델을 두 번 부른다
       * (agent/loop.js 의 고쳐쓰기 설명).
       */
      let 다시글 = '';
      // 되물음 도중에 끊겼나 (사냥5 B5-02). 끊긴 것은 「모양이 틀렸다」(7) 가 아니라 끊긴 것(4)이다.
      let 다시끊김 = false;
      // 되물음이 **터졌나** (8회차 그밖 한번쓰기3). 터진 것도 모양 탈이 아니다 — 아래 갈래에서 갈라 낸다.
      let 다시터짐 = '';
      try {
        for await (const ev of run(session, ctx, 스키마시킬말(출력스키마, { 다시: 잰것.탈 }), { signal: turn.signal, 고쳐쓰기: true })) {
          if (ev.type === 'content') 다시글 += ev.text;
          else if (ev.type === 'done') 다시글 = ev.text ?? 다시글;
          else if (ev.type === 'aborted') { 다시끊김 = true; break; }
          else if (ev.type === 'error') { 다시터짐 = String(ev.text ?? why); break; }
        }
      } catch (err) { 다시터짐 = String(err?.message ?? err); }

      if (다시끊김 || turn.signal.aborted) {
        reason = 'aborted';
        why = '중단했습니다';
      } else if (다시터짐) {
        /*
         * ── 되물음이 **HTTP 오류로** 죽은 자리 (8회차 그밖 한번쓰기3) ──────
         *
         * 터진 까닭을 `why` 에만 적고 그대로 아래로 내려보냈다. 그러면 빈 `다시글` 이
         * 재보기를 못 넘어 `reason='schema'` 가 되고 `why` 는 「답이 스키마에 안 맞습니다
         * — 답이 비었습니다」 로 **덮인다.** 재 보니 서버가 낸 500 한 줄이 화면에서 통째로
         * 사라지고 7 만 남았다. 스키마를 아무리 손봐도 안 고쳐지는 자리라, 사람은 엉뚱한
         * 데를 판다. 끊긴 것을 4 로 갈라 둔 것과 같은 까닭으로 여기도 갈라 둔다.
         */
        reason = 'error';
        why = `모양을 고쳐 달라고 한 번 더 시켰는데 그 요청이 실패했습니다 — ${다시터짐}`;
      } else {
        const 두번째 = 재보기(다시글);
        if (두번째.ok) { 잰것 = 두번째; 답 = 다시글; }
        else 잰것 = { ok: false, 탈: 두번째.탈 };
      }
    }

    if (reason === 'aborted' || reason === 'error') { /* 끊겼거나 터졌으면 모양을 판정하지 않는다 — 그 까닭 그대로 끝낸다 */ }
    else if (잰것.ok) {
      스키마값 = 잰것.값;
      // 울타리나 인사말을 걷어내고 뽑았으면 그렇게 말한다. 조용히 걷어내면
      // 사람은 모델이 깨끗하게 냈다고 여기고 시킴말을 안 고친다.
      if (잰것.군말) 곁(`  ${c.gray('· 답에 붙은 군말을 걷어내고 JSON 만 냈습니다.')}`);
    } else {
      reason = 'schema';
      why = `답이 스키마에 안 맞습니다 (${잰것.탈.length}건)\n`
        + 잰것.탈.slice(0, 8).map((x) => `  - ${x}`).join('\n');
    }
  }

  /*
   * 모델은 끝났다고 했는데 완료 검사가 통과하지 않았다 — 종료코드 8 (위 EXIT.check).
   *
   * 모양 판정(7)보다 **뒤에** 본다. 모양도 틀렸으면 그쪽을 먼저 고쳐야 답을 읽을 수 있다.
   * 아무것도 안 바꾼 턴은 검사가 안 돌아 검사결과가 null 이다 — 그건 실패가 아니다.
   */
  if (reason === 'done' && 검사결과 && 검사결과.ok !== true) {
    reason = 'check';
    why = 검사결과.ok === false
      ? 옮긴말('check.gaveUp', { 판: 검사결과.판 }) + ` — ${검사결과.명령}`
      : 옮긴말('check.skipped', { 까닭: 검사결과.까닭 });
  }

  /*
   * SIGINT 손은 **되물음까지 끝난 뒤에** 뗀다 (사냥5 B5-02).
   *
   * 여기는 첫 턴이 끝나자마자 손을 뗐다. 그런데 모양 고치기 되물음도 모델을 한 번 더 부르는
   * 자리다. 그 사이에 Ctrl+C 가 오면 SIGINT 에 남은 손은 언어 서버(lsp/client.js) 것 하나였고,
   * 그 손은 「마지막 손이면 신호를 되쏜다」 는 규칙대로 프로그램째 죽였다 — 윈도우 1, 유닉스
   * 130, 표준출력은 빈 채로. 첫 턴에서 끊긴 것은 4 와 JSON 한 덩이인데.
   */
  process.removeListener('SIGINT', 끊김);

  const code = EXIT[reason] ?? EXIT.error;
  if (why) 삐끗(`  ${reason === 'done' ? c.gray('·') : c.red('✗')} ${why}`);
  if (!json && !quiet) {
    const 조각 = [`${((Date.now() - t0) / 1000).toFixed(1)}초`];
    if (tools) 조각.push(`도구 ${tools}회`);
    조각.push(`↑${(session.usage.prompt || session.usage.in).toLocaleString()} ↓${session.usage.out.toLocaleString()}`);
    곁(`  ${c.gray('── ' + 조각.join(' · '))}`);
  }

  return 내놓기({
    ok: reason === 'done',
    reason,
    code,
    text: String(답 ?? ''),
    tools,
    steps,
    usage: {
      /*
       * `in` 은 여태와 같은 뜻으로 둔다 — 서버가 새로 읽었다고 센 만큼이다.
       * 파이프 뒤 스크립트가 이 이름을 이미 쓰고 있어서 뜻을 바꾸면 안 된다.
       * 보낸 것 전체는 이름을 새로 붙여 **더한다** (backend/adapter.js 의 보낸토큰).
       */
      in: session.usage.in, out: session.usage.out,
      prompt: session.usage.prompt || session.usage.in,
      cacheRead: session.usage.cacheRead ?? 0,
      cacheWrite: session.usage.cacheWrite ?? 0,
      calls: session.usage.calls, ms: session.usage.ms,
      // 창구가 usage 를 안 준 부름 수. 0 이 아니면 위 숫자는 **덜 센 값**이다.
      // 이 칸이 없으면 받는 쪽이 0 을 실측으로 읽는다 (backend/adapter.js 의 잰것).
      못잰것: session.usage.못잰것 ?? 0,
      retries: session.usage.retries ?? 0,
    },
    model: conn.model,
    // 모양을 못 박았을 때만 실린다. --json 으로 받는 쪽은 text 를 다시 파싱할
    // 필요 없이 이 칸을 그대로 쓰면 된다.
    ...(스키마값 !== null ? { schema: 스키마값 } : {}),
    // 완료 검사를 돌렸을 때만 실린다. ok 가 null 이면 못 돌린 것이다(why 에 까닭).
    ...(검사결과 ? {
      check: {
        ok: 검사결과.ok, command: 검사결과.명령, rounds: 검사결과.판, max: 검사결과.최대,
        ...(검사결과.요약 ? { summary: 검사결과.요약 } : {}),
        ...(검사결과.까닭 ? { why: 검사결과.까닭 } : {}),
      },
    } : {}),
    ms: Date.now() - t0,
    ...(why ? { why } : {}),
  });
}
