// 바깥 프로그램을 부른다 — **기다리는 동안 귀를 열어 둔 채로.**
//
// ── 왜 이 파일이 따로 있나 ─────────────────────────────────────────────
//
// 전에는 찾기(fastgrep.js)도 변환(convert.js)도 각자 spawnSync 를 썼다.
// 쓰기는 편하다. 그런데 그 호출이 도는 동안 Node 는 이벤트 루프를 통째로
// 멈춘다. 그 사이에는 키 입력이 배달되지 않는다 — 사람이 ESC 를 몇 번을
// 눌러도, 그 키는 버퍼에만 쌓여 있다가 **일이 다 끝난 뒤에야** 들어온다.
//
//   rg 로 큰 저장소 찾기      최대 20초
//   soffice 로 문서 바꾸기    최대 90초
//
// 그동안 프로그램은 귀머거리다. "ESC 를 눌러도 안 멈춘다" 는 제보의 뿌리가
// 여기였다. 화면에는 여전히 돌아가는 그림이 보이니 사람은 더 답답하다.
//
// 두 군데에 따로 적어 두면 언젠가 한쪽만 고쳐지고, 그때부터 "검색은 멈추는데
// 문서 변환은 안 멈추는" 프로그램이 된다. 그건 고장보다 설명하기 어렵다.
// 그래서 한 벌만 둔다.
//
// ── 돌려주는 모양 ──────────────────────────────────────────────────────
//
// 일부러 spawnSync 와 **똑같이** 맞췄다 — {error, status, stdout, stderr}.
// 부르는 쪽의 판단 코드(`status === 2 면 실패` 같은 것)를 한 줄도 안 건드리고
// 바꾸려는 것이다. 바꾼 자리가 적을수록 조용히 달라지는 것도 적다.
import { spawn } from 'node:child_process';

/**
 * 자식 프로그램을 부르고, 끝날 때까지 기다린다 — 루프는 계속 돈다.
 *
 * @param {string} 이름 실행할 것
 * @param {string[]} 인자 인자들. 셸을 안 거치므로 여기 든 따옴표·세미콜론은 글자다.
 * @param {object} [옵션]
 * @param {number} [옵션.timeout] 이 시간을 넘기면 죽이고 실패로 돌려준다
 * @param {number} [옵션.maxBuffer] 나온 글이 이보다 커지면 죽인다
 * @param {AbortSignal|null} [옵션.signal] 눌리면 자식을 죽인다
 * @param {string|null} [옵션.넣을것] stdin 으로 흘려 줄 글. 다 쓰면 닫는다.
 * @param {object} [옵션.덤] spawn 에 그대로 넘길 것 (windowsVerbatimArguments 같은)
 * @returns {Promise<{error:Error|null, status:number|null, stdout:string, stderr:string}>}
 */
export function 돌려보기(이름, 인자, {
  timeout = 20000, maxBuffer = 32 * 1024 * 1024, signal = null, 넣을것 = null, 덤 = {},
  /*
   * 넘치면 **자르고 계속 기다린다** — 죽이지 않는다.
   *
   * 기본은 spawnSync 처럼 넘치면 죽이고 실패로 돌려준다(아래 머리말). 그런데 훅은 그러면
   * 안 된다: 0 으로 끝날 훅이 경고를 16KB 넘게 뱉는 순간 「못 돌렸다」 가 되고, 막는 자리는
   * 못 돌린 훅을 막힘으로 친다(safety/hooks.js). 끝난 모양(종료코드)이 판정인 부르개는
   * 이걸 켜고, 잘랐는지는 `잘림` 으로 받는다.
   */
  넘치면자르기 = false,
} = {}) {
  return new Promise((resolve) => {
    // 이미 눌렸으면 띄우지도 않는다. 여럿을 함께 돌릴 때 뒤엣것이 여기로 온다.
    if (signal?.aborted) { resolve({ error: new Error('중단했습니다'), status: null, stdout: '', stderr: '' }); return; }

    let 아이;
    try {
      아이 = spawn(이름, 인자, { windowsHide: true, ...덤 });
    } catch (탈난것) {
      resolve({ error: 탈난것, status: null, stdout: '', stderr: '' });
      return;
    }

    let 밖 = ''; let 탈 = ''; let 끝났나 = false; let 잘림 = false; let 탈잘림 = false;
    /** 탈 글을 담아 두는 한도. 넘으면 자르되 자른 자리를 글에 적는다. */
    const 탈상한 = 65536;
    const 끝내기 = (것) => {
      if (끝났나) return;
      끝났나 = true;
      clearTimeout(시계);
      signal?.removeEventListener?.('abort', 중단하기);
      resolve(것);
    };

    /*
     * 멈추라고 하면 **자식을 죽인다.**
     *
     * 여기가 없으면 반쪽짜리다. 비동기로 바꾼 덕에 ESC 는 들리지만, 정작
     * soffice 는 남은 시간을 마저 돈다 — 사람 눈에는 여전히 "눌렀는데 안
     * 멈춘다". 듣는 것과 멈추는 것은 다른 일이라, 둘 다 해야 한 가지가 끝난다.
     *
     * **여태 받은 것은 버리지 않는다.** 바로 위 시한 갈래는 `stdout: 밖` 으로
     * 실어 주는데 여기만 빈 글이었다. 훅(safety/hooks.js)은 못 돌린 판에도
     * 자식이 뱉은 말을 그대로 보여 주는 자리라, 중단한 판에서만 「어디까지
     * 하다 멈췄는지」 가 통째로 사라졌다. 멈춘 것과 아무 말도 없던 것은 다르다.
     */
    const 중단하기 = () => {
      try { 아이.kill(); } catch { /* 이미 죽었다 */ }
      끝내기({ error: new Error('중단했습니다'), status: null, stdout: 밖, stderr: 탈 });
    };
    signal?.addEventListener?.('abort', 중단하기, { once: true });

    const 시계 = setTimeout(() => {
      try { 아이.kill(); } catch { /* 이미 죽었다 */ }
      끝내기({ error: new Error(`${이름} 가 ${timeout}ms 안에 안 끝났습니다`), status: null, stdout: 밖, stderr: 탈 });
    }, timeout);
    // 이 타이머가 프로그램을 붙들면 안 된다. 자식의 파이프가 이미 루프를 붙들고 있다.
    시계.unref?.();

    /*
     * 넘길 것이 있으면 stdin 으로 흘리고 **닫는다.**
     *
     * 안 닫으면 자식이 stdin 을 끝까지 읽는 모양일 때 영영 안 끝난다 —
     * 시한에 걸려 죽을 때까지 기다리게 되고, 사람 눈에는 '훅이 느리다' 로 보인다.
     *
     * 자식이 다 읽기 전에 죽으면 EPIPE 가 온다. 그건 우리 탈이 아니다 —
     * 자식은 제 할 말을 이미 했고, 그 결과는 status 로 온다. 여기서 던지면
     * 프로그램이 통째로 죽으므로 삼킨다.
     */
    아이.stdin?.on('error', () => { /* 자식이 먼저 닫았다 — 결과는 status 로 온다 */ });
    // 넣을 것이 없어도 **닫는다.** 안 닫으면 위 머리말 그대로 — rg 든 훅이든
    // stdin 을 끝까지 읽는 자식은 시한에 걸려 죽을 때까지 기다린다.
    try { 아이.stdin?.end(넣을것 == null ? undefined : String(넣을것)); } catch { /* 이미 닫혔다 */ }

    아이.stdout?.setEncoding('utf8');
    아이.stderr?.setEncoding('utf8');
    아이.stdout?.on('data', (조각) => {
      // 이미 잘랐으면 흘려 버리기만 한다. 안 읽으면 자식이 가득 찬 파이프에 막혀 안 끝난다.
      if (잘림) return;
      밖 += 조각;
      /*
       * spawnSync 는 이 자리에서 ENOBUFS 를 냈다. 조용히 잘라 버리면 사람
       * 눈에는 '결과가 적다' 로만 보인다 — 오류도 안 나고 아무도 눈치 못 챈다.
       * 같은 자리에서 같은 실패를 내야 부르는 쪽이 예전 길로 내려간다.
       * (넘치면자르기 를 켠 부르개는 자르되 `잘림` 으로 **말한다** — 조용히가 아니다.)
       */
      if (밖.length > maxBuffer && 넘치면자르기) { 밖 = 밖.slice(0, maxBuffer); 잘림 = true; return; }
      if (밖.length > maxBuffer) {
        try { 아이.kill(); } catch { /* 이미 죽었다 */ }
        // `code` 를 단다 — 이 탈에는 그게 없어서 부르는 쪽이 우리말 한 줄을 글자로 맞춰 보는
        // 수밖에 없었다. 말이 바뀌면 조용히 안 걸린다. spawnSync 가 내던 그 코드를 그대로 쓴다.
        끝내기({
          error: Object.assign(new Error('결과가 너무 많습니다'), { code: 'ENOBUFS', killed: true }),
          status: null, stdout: '', stderr: 탈,
        });
      }
    });
    /*
     * 탈 글도 자른다 — 다만 **자른 자리를 글 안에 적어 둔다.**
     *
     * 여태 `if (탈.length < 65536) 탈 += 조각` 한 줄이라 64KB 를 넘는 순간부터 소리 없이
     * 사라졌다. 바로 위 stdout 머리말이 「조용히 잘라 버리면 사람 눈에는 '결과가 적다' 로만
     * 보인다 — 오류도 안 나고 아무도 눈치 못 챈다」 고 못박은 그 자리인데 여기만 안 고쳐졌다.
     * 경고를 stderr 로 쏟는 훅(린터·형 검사 감싸개)이 정확히 이 꼴이다 — 뒤쪽 경고가 통째로
     * 없어지고 종료코드는 0 이라, 안 본 경고가 「경고 없음」 으로 올라간다.
     *
     * 표를 따로 다는 대신 글 끝에 한 줄로 적는다. 그러면 stderr 를 그대로 보여 주는
     * 모든 자리가 고칠 것 없이 잘린 사실을 같이 보여 준다.
     */
    아이.stderr?.on('data', (조각) => {
      if (탈잘림) return;
      탈 += 조각;
      if (탈.length > 탈상한) {
        탈 = `${탈.slice(0, 탈상한)}\n(탈 글이 ${탈상한}자에서 잘렸습니다 — 뒷부분은 안 실렸습니다)`;
        탈잘림 = true;
      }
    });
    아이.on('error', (탈난것) => 끝내기({ error: 탈난것, status: null, stdout: 밖, stderr: 탈 }));
    아이.on('close', (코드) => 끝내기({ error: null, status: 코드, stdout: 밖, stderr: 탈, ...(잘림 ? { 잘림 } : {}) }));
  });
}


/*
 * ── `execFile` 은 `detached` 를 **버린다** ──────────────────────────────
 *
 * Bash 도구가 이렇게 부르고 있었다.
 *
 *   execFile(셸, 인자, { cwd, env, timeout, maxBuffer, detached: true, … })
 *
 * 그리고 그 옆에 「유닉스에서는 무리를 만들어 둔다」 는 머리말이 열두 줄
 * 붙어 있었다. 그 줄은 **아무 일도 안 하고 있었다.** Node 의 execFile 은
 * 받은 옵션을 spawn 에 통째로 넘기지 않는다. 제 소스에 목록이 박혀 있다 —
 *
 *   cwd · env · gid · shell · signal · uid ·
 *   windowsHide · windowsVerbatimArguments
 *
 * `detached` 가 없다. 오타도 아니고 오류도 아니라서, 적어 둔 사람도 읽는
 * 사람도 그게 안 걸린 줄 모른다. 리눅스 CI 가 열 판 넘게 이 자리에서
 * 빨갰는데, 무엇이 살아남았는지를 검사가 적기 시작하고서야 보였다.
 *
 *   pid 6791 · pgid 1938 · ppid 1   node ticker.cjs
 *
 * 무리(pgid)가 제 pid 가 아니라 **검사 프로세스의 무리**였다. 즉 애초에
 * 무리가 안 만들어졌고, `kill(-pid, …)` 는 죽일 것을 못 찾고 있었다.
 * 죽이는 쪽을 아무리 고쳐도 안 고쳐질 자리였다.
 *
 * 그래서 spawn 을 바로 쓴다. execFile 이 해 주던 것(모아 담기·상한·시한·
 * 오류 모양)은 여기서 **같은 모양으로** 해 준다 — 부르는 쪽의 판단 코드를
 * 한 줄도 안 건드리려는 것이다. 이 파일 머리말과 같은 자세다.
 */

/**
 * execFile 과 같은 약속으로 부르되, **무리를 진짜로 만든다.**
 *
 * 콜백은 execFile 의 것과 같다 — `(탈, 밖Buffer, 탈Buffer)`.
 * 탈의 모양도 맞춘다:
 *
 *   못 돌렸다        탈.code = 'ENOENT' 같은 글자
 *   출력이 넘쳤다    탈.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 탈.killed = true
 *   시한을 넘겼다    탈.killed = true, 탈.signal = 보낸 신호
 *   시그널로 죽었다  탈.signal = 그 신호
 *   0 이 아니게 끝남 탈.code = 그 숫자
 *
 * @returns {import('node:child_process').ChildProcess}
 */
export function 무리로돌리기(파일, 인자, 옵션 = {}, 끝나면 = () => {}) {
  const {
    cwd = undefined, env = undefined, timeout = 0, maxBuffer = 32 * 1024 * 1024,
    windowsHide = true, windowsVerbatimArguments = false, detached = false,
    killSignal = 'SIGTERM',
    /*
     * 넘쳤을 때 **나무째** 끊는 법. 부르는 쪽이 준다 (사냥5 M3).
     *
     * 여기는 넘치면 `아이.kill()` 만 했다. 아이는 셸이라 셸만 죽고, 정작 쏟아내는 손자는
     * 살아서 파이프를 계속 물었다. 그러면 'close' 가 안 와서 넘친 즉시가 아니라
     * **시간 초과에** 돌아왔고, 그동안 여기는 넘친 뒤에도 조각을 계속 모아 메모리가
     * 기가 단위로 불었다(검사가 `Array buffer allocation failed` 로 쓰러졌다).
     * 나무를 끊는 판단(taskkill /t · 무리)은 부르는 쪽(tools/jobs.js)에 있으므로 받아 쓴다.
     * 셸이 살아 있을 때 끊어야 한다 — 먼저 셸을 죽이면 나무의 뿌리가 없어진다.
     */
    넘치면 = null,
    /*
     * 뿌리(셸)가 끝난 뒤 'close' 를 얼마나 기다리나. 0 이면 예전처럼 끝까지 (사냥5 M2).
     *
     * `node gc.cjs & echo done` 처럼 셸이 뒤로 띄운 손자가 stdout 을 물면 셸은 끝났는데
     * 'close' 가 영영 안 온다. 그러면 시간 초과까지 섰고, 사람 눈에는 끝난 명령이 멈춘
     * 것으로 보였다. 셸이 끝나면 파이프에 남은 것은 곧바로 읽히므로 짧게만 기다리고,
     * 그래도 안 닫히면 남은 것을 끊으러 가고(남은것끊기) 우리 파이프를 놓고 끝맺는다.
     * 끝맺을 때 넷째 인자로 {파이프남음, 남은것끊음} 을 준다 — 부르는 쪽이 사실대로 적게.
     */
    뿌리끝나면기다림 = 0,
    남은것끊기 = null,
    /*
     * 죽이라고 한 뒤 'close' 를 얼마나 기다리나 (8회차 · 끊긴출력).
     *
     * 여기는 오직 'close' 가 와야 여태 모은 것을 넘겨 줬다. 그런데 셸이 뒤로 띄운
     * 손자가 파이프를 물고 있으면 자식을 죽여도 close 는 **영영 안 온다** — 자식은
     * exit 하는데 파이프가 안 닫혀서다.
     *
     * 부르는 쪽(tools/index.js 의 Bash)은 ESC 를 받으면 자식을 죽이고 400ms 짜리
     * 그물을 두고 「죽기 직전에 뱉은 줄」 을 기다린다. 그 줄은 여기 밖조각 에 이미
     * 들어 있는데, 그물 갈래에는 그것을 실을 길이 없다. 그래서 그물이 먼저 울면
     * 결과가 통째로 빈 채 나갔다 — 여덟 번 재면 절반쯤. 사람도 모델도
     * 「사용자가 중단했습니다」 한 줄만 받고, 서버가 뻗으며 남긴 스택 트레이스는
     * 아무 데도 안 남는다.
     *
     * 그래서 **죽인 뒤에는 오래 안 기다린다.** 이만큼 기다려도 close 가 안 오면
     * 여태 모은 것을 들고 나온다. 그물(400ms)보다 넉넉히 짧게 잡는다 — 여기가
     * 늦으면 그물이 먼저 울어 고친 것이 아무 일도 안 한 것이 된다.
     * 0 이면 예전처럼 close 만 기다린다.
     */
    죽인뒤기다림 = 200,
  } = 옵션;

  const 아이 = spawn(파일, 인자, {
    cwd, env, windowsHide, windowsVerbatimArguments, detached,
    /*
     * 입력은 안 물려 준다 (사냥5 M1).
     *
     * stdio 를 안 적으면 stdin 이 **열린 파이프**가 된다. 아무도 안 쓰고 안 닫는 파이프라,
     * 입력을 끝까지 읽는 명령(`cat` · `sort` · 입력을 기다리는 스크립트)이 그 앞에서
     * 시간 초과까지 섰다. Jobs 는 처음부터 'ignore' 였다(jobs.js 띄우기옵션) — 같은 판단이다.
     */
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const 밖조각 = [];
  const 탈조각 = [];
  let 밖크기 = 0;
  let 탈크기 = 0;
  let 끝났나 = false;
  let 미리잡은탈 = null;
  let 넘침 = false;
  let 뿌리시계 = null;
  let 죽인시계 = null;
  let 죽였나 = false;
  let 죽인신호 = null;
  // 'exit' 에서 본 것. 파이프가 안 닫혀 close 를 못 받고 끝맺을 때 이걸로 탈을 짓는다.
  let 나갔나 = false;
  let 나간코드 = null;
  let 나간신호 = null;

  const 모으기 = (스트림, 조각들, 더할것) => {
    조각들.push(더할것);
    return 스트림 + 더할것.length;
  };

  const 끝내기 = (탈, 덤 = {}) => {
    if (끝났나) return;
    끝났나 = true;
    clearTimeout(시계);
    clearTimeout(뿌리시계);
    clearTimeout(죽인시계);
    끝나면(탈 ?? null, Buffer.concat(밖조각), Buffer.concat(탈조각), 덤);
  };

  /** execFile 이 만드는 것과 같은 모양의 탈. */
  const 탈만들기 = (글, 더할것) => Object.assign(new Error(글), 더할것);

  /**
   * close 를 못 받고 끝맺을 때 쓸 탈. close 갈래가 짓는 것과 **같은 모양**이다.
   *
   * 먼저 잡아 둔 탈(넘침·시한)이 있으면 그것이 이긴다 — 여기서 덮으면 넘침이
   * 시간 초과로 바뀌어 나가던 그 자리로 되돌아간다(시계 머리말).
   */
  const 탈고르기 = () => 미리잡은탈 ?? (나갔나
    ? (나간신호 ? 탈만들기(`${나간신호} 시그널로 죽었습니다`, { killed: true, signal: 나간신호 })
      : 나간코드 !== 0 ? 탈만들기(`종료코드 ${나간코드}`, { code: 나간코드, killed: false }) : null)
    // 나가지도 않았다 — 죽이라고 했는데 안 죽는 판이다. 죽인 것은 사실대로 적는다.
    : 탈만들기(`${죽인신호 ?? killSignal} 로 끊었습니다`,
      { killed: true, signal: 죽인신호 ?? killSignal }));

  /**
   * 'close' 를 그만 기다리고 **여태 모은 것으로** 끝맺는다.
   *
   * 우리 파이프는 놓는다. 안 놓으면 손자가 물고 있는 동안 이 프로세스가 안 끝난다.
   *
   * @param {object} [o]
   * @param {boolean} [o.남은것도] 남은 무리까지 끊어 보고, 끊었는지를 덤 에 적는다.
   */
  const 그만기다리기 = ({ 남은것도 = false } = {}) => {
    if (끝났나) return;
    let 끊음 = false;
    if (남은것도) { try { 끊음 = 남은것끊기?.(아이) === true; } catch { /* 못 끊었다 — 그대로 말한다 */ } }
    try { 아이.stdout?.destroy(); 아이.stderr?.destroy(); } catch { /* 이미 닫힘 */ }
    끝내기(탈고르기(), { 파이프남음: true, 남은것끊음: 끊음 });
  };

  /*
   * ── 죽이라고 한 순간부터 센다 ──────────────────────────────────────────
   *
   * 죽이는 손은 **부르는 쪽에도** 있다. tools/index.js 의 Bash 는 ESC·시간 초과·
   * 넘침에서 taskkill(또는 무리끊기)로 나무를 끊고 나서 `kid.kill()` 을 부른다.
   * 그 부름이 여기 안 걸리면, 정작 사람이 멈춘 그 판에서만 이 기다림이 안 선다 —
   * 고쳐야 할 자리가 딱 거기다. 그래서 kill 을 지나가며 한 번 본다.
   *
   * 우리가 죽이는 자리(시계·넘쳤다)도 같은 문을 지난다. 두 벌로 적어 두면 늘
   * 한쪽만 고쳐진다 — 이 파일이 애초에 한 벌만 두려고 생긴 파일이다.
   */
  const 죽은뒤부터재기 = () => {
    if (죽였나 || 끝났나 || !(죽인뒤기다림 > 0)) return;
    죽였나 = true;
    죽인시계 = setTimeout(() => 그만기다리기(), 죽인뒤기다림);
  };
  const 본래죽이기 = 아이.kill.bind(아이);
  아이.kill = (신호) => {
    죽인신호 = 신호 ?? killSignal;
    const 됐나 = 본래죽이기(신호);
    죽은뒤부터재기();
    return 됐나;
  };

  // 넘친 쪽을 **사실대로** 적는다. 여태 stderr 가 넘쳐도 'stdout' 이라고 적었다 —
  // 어느 관을 좁혀야 하는지가 이 한 낱말에 달렸는데 늘 엉뚱한 쪽을 가리켰다.
  const 넘쳤다 = (어느쪽) => {
    넘침 = true;
    미리잡은탈 = 탈만들기(`${어느쪽} maxBuffer length exceeded`,
      { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true });
    if (넘치면) { try { 넘치면(아이); } catch { /* 끊다 말았다 — 아래 뿌리 기다림이 끝맺는다 */ } }
    else { try { 아이.kill(killSignal); } catch { /* 이미 죽었다 */ } }
  };

  // 넘친 뒤로는 안 모은다 — 받아 봐야 버릴 것이고, 모으면 메모리만 분다(넘치면 머리말).
  아이.stdout?.on('data', (조각) => {
    if (넘침) return;
    밖크기 = 모으기(밖크기, 밖조각, 조각);
    if (밖크기 > maxBuffer && !미리잡은탈) 넘쳤다('stdout');
  });
  아이.stderr?.on('data', (조각) => {
    if (넘침) return;
    탈크기 = 모으기(탈크기, 탈조각, 조각);
    if (탈크기 > maxBuffer && !미리잡은탈) 넘쳤다('stderr');
  });

  /*
   * 시한은 **마지막 그물**이다. 부르는 쪽이 제 시계로 먼저 끊는 것이 보통이고,
   * 이건 그것마저 못 돌았을 때 선다. unref 하지 않는다 — 여기서 놓아 버리면
   * 그물이 아니게 된다.
   *
   * `시한: true` 를 붙인다. 부르는 쪽이 killed 만 보고 「시간 초과」 라고 적어서, 넘침도
   * 시그널 죽음도 전부 시간 초과로 나갔다 (사냥5 M3).
   */
  const 시계 = timeout > 0 ? setTimeout(() => {
    /*
     * **먼저 잡아 둔 탈은 안 덮는다** (8회차 확인). 여기서 그냥 대입해서, 넘쳐서 죽인 자식이
     * 시한 안에 안 닫히면(끊는 손이 못 끊는 판) 넘침이 시간 초과로 바뀌어 나갔다. 부르는 쪽은
     * timeout 을 늘려 같은 명령을 또 부른다 — 바로 위 머리말이 고쳤다던 그 자리로 되돌아간다.
     */
    미리잡은탈 ??= 탈만들기(`명령이 ${timeout}ms 안에 안 끝났습니다`,
      { killed: true, signal: killSignal, 시한: true });
    try { 아이.kill(killSignal); } catch { /* 이미 죽었다 */ }
  }, timeout) : null;

  // 나간 자리를 적어 둔다. close 를 못 받고 끝맺을 때(그만기다리기) 이걸로 같은 모양의 탈을 짓는다.
  아이.on('exit', (코드, 신호) => { 나갔나 = true; 나간코드 = 코드; 나간신호 = 신호; });

  if (뿌리끝나면기다림 > 0) {
    아이.on('exit', () => {
      if (끝났나) return;
      // 셸은 끝났는데 파이프가 안 닫혔다 — 뒤로 띄운 것이 물고 있다(뿌리끝나면기다림 머리말).
      // 여기는 **우리가 죽인 판이 아니라** 셸이 제 발로 끝난 판이라, 남은 무리도 끊으러 간다.
      뿌리시계 = setTimeout(() => 그만기다리기({ 남은것도: true }), 뿌리끝나면기다림);
    });
  }

  아이.on('error', (탈) => 끝내기(탈));
  아이.on('close', (코드, 신호) => {
    if (미리잡은탈) return 끝내기(미리잡은탈);
    if (신호) return 끝내기(탈만들기(`${신호} 시그널로 죽었습니다`, { killed: true, signal: 신호 }));
    if (코드 !== 0) return 끝내기(탈만들기(`종료코드 ${코드}`, { code: 코드, killed: false }));
    끝내기(null);
  });

  return 아이;
}
