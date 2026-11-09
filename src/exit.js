// 종료코드와 시작도 못 한 실패 한 덩이 — `deel run` 과 진입점(bin/deel.js)이 같이 쓴다.
//
// 진입점이 이 표 하나 때문에 oneshot.js 를 불러오면 대화 화면·도구·게이트웨이까지 딸려 와서 `deel --version`
// 한 줄이 파일 164개를 읽는다. 그래서 따로 뗐다. oneshot.js 는 그대로 내보낸다.

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
   * 자기 코드가 있어야 한다. `deel -p` 는 잡·CI 에서 돌고 스크립트가 뒤에 붙는데, 반쪽짜리
   * 답을 0 으로 넘기면 온전한 답으로 알고 그대로 쓴다.
   */
  cutoff: 5,
  /*
   * 모델이 안 하겠다고 했다 (안전 판정).
   *
   * 거절한 답은 **아무 일도 안 한 답**인데 짧은 답과 겉모습이 같다. 0 으로 끝내면 뒤 스크립트가
   * 일이 된 줄 안다. 오류(1)와도 갈라 둔다 — 오류는 연결이나 열쇠를 보는 일이고, 거절은
   * **시킨 말을 바꾸는 일**이다.
   */
  refusal: 6,
  /*
   * 답이 --output-schema 에 안 맞았다.
   *
   * 「모양을 못 박아 달라」 고 한 사람에게 안 맞는 것을 0 으로 넘기면 파이프 뒤 스크립트가 온전한
   * 것으로 받아 쓴다. 오류(1)와도 가른다 — 이건 스키마나 시킨 말을 바꾸는 일이다.
   */
  schema: 7,
  /*
   * 완료 검사가 통과하지 않은 채 끝났다 (agent/donecheck.js).
   *
   * 모델은 「다 됐습니다」 라고 했는데 사람이 정해 둔 검사(`--check` · 설정의 `check`)가
   * 판수를 다 돌고도 빨갛거나, 관문에 막혀 못 돌았다. 0 이면 야간 배치가 빨간 검사 위에
   * 초록불을 켠다. 오류(1)와 가른다 — 고칠 자리가 연결이 아니라 코드나 검사다.
   */
  check: 8,
  /*
   * 인자를 잘못 줬다 — 모르는 깃발 · 값 없는 깃발 · 모르는 모드 이름 · 못 읽는 --ctx.
   *
   * **따로** 둔다. 2 는 이 표에서 이미 「걸음 수 상한」 이라, 오타를 2 로 끝내면 CI 에 건 사람이
   * 「일이 커서 멈췄다」 를 받고 작업을 쪼개러 간다. 고칠 자리는 스크립트 한 줄인데.
   *
   * 64 는 sysexits.h 의 EX_USAGE 다. 1~8 과 안 겹치고 셸·CI 도구들이 「부른 모양이 틀렸다」 로
   * 이미 알아듣는다. 이 경우는 모델을 한 번도 안 부른다.
   */
  usage: 64,
};

/**
 * 모델을 부르기 전에 선 실패 한 덩이.
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
    usage: { in: 0, out: 0, prompt: 0, cacheRead: 0, cacheWrite: 0, calls: 0, ms: 0, 못잰것: 0, retries: 0, genMs: 0, tokPerSec: null },
    model,
    // 바뀐 파일과 대화 이름 (2.1.3) — 시작도 못 했으니 비었다. 칸은 성공과 같게 둔다.
    files: [], session: null,
    ms: 0,
    ...(why ? { why } : {}),
  };
}

/**
 * 열어 둔 연결을 닫는다. 프로그램을 끝내기 직전에 부른다.
 *
 * fetch 는 연결을 재사용하려고 소켓을 살려 둔다(keep-alive). 그래서 할 일이 끝나도 프로세스가
 * 저절로 안 끝난다. 그걸 process.exit() 으로 자르면, 윈도우에서 닫는 중인 핸들을 두고 끊을 때
 * libuv 가 abort 한다.
 *
 *   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c
 *
 * 화면에는 정상인데 종료코드가 3221226505(0xC0000409) 가 된다. 그래서 자르는 대신 닫는다.
 * 이 자리는 Node 내부 이름이라 없을 수도 있으므로 없으면 조용히 넘어간다 — 그때는 부르는
 * 쪽의 시간제한이 받아 준다. 프록시 길은 요청마다 소켓을 새로 열고 닫으므로(Connection: close)
 * 여기 안 온다.
 */
export function closeConnections() {
  try {
    const d = globalThis[Symbol.for('undici.globalDispatcher.1')];
    if (d && typeof d.close === 'function') return d.close().catch(() => {});
  } catch { /* 없으면 그만 */ }
  return Promise.resolve();
}
