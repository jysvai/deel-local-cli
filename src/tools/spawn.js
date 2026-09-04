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
 * @param {object} [옵션.덤] spawn 에 그대로 넘길 것 (windowsVerbatimArguments 같은)
 * @returns {Promise<{error:Error|null, status:number|null, stdout:string, stderr:string}>}
 */
export function 돌려보기(이름, 인자, { timeout = 20000, maxBuffer = 32 * 1024 * 1024, signal = null, 덤 = {} } = {}) {
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

    let 밖 = ''; let 탈 = ''; let 끝났나 = false;
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
     */
    const 중단하기 = () => {
      try { 아이.kill(); } catch { /* 이미 죽었다 */ }
      끝내기({ error: new Error('중단했습니다'), status: null, stdout: '', stderr: '' });
    };
    signal?.addEventListener?.('abort', 중단하기, { once: true });

    const 시계 = setTimeout(() => {
      try { 아이.kill(); } catch { /* 이미 죽었다 */ }
      끝내기({ error: new Error(`${이름} 가 ${timeout}ms 안에 안 끝났습니다`), status: null, stdout: 밖, stderr: 탈 });
    }, timeout);
    // 이 타이머가 프로그램을 붙들면 안 된다. 자식의 파이프가 이미 루프를 붙들고 있다.
    시계.unref?.();

    아이.stdout?.setEncoding('utf8');
    아이.stderr?.setEncoding('utf8');
    아이.stdout?.on('data', (조각) => {
      밖 += 조각;
      /*
       * spawnSync 는 이 자리에서 ENOBUFS 를 냈다. 조용히 잘라 버리면 사람
       * 눈에는 '결과가 적다' 로만 보인다 — 오류도 안 나고 아무도 눈치 못 챈다.
       * 같은 자리에서 같은 실패를 내야 부르는 쪽이 예전 길로 내려간다.
       */
      if (밖.length > maxBuffer) {
        try { 아이.kill(); } catch { /* 이미 죽었다 */ }
        끝내기({ error: new Error('결과가 너무 많습니다'), status: null, stdout: '', stderr: 탈 });
      }
    });
    아이.stderr?.on('data', (조각) => { if (탈.length < 65536) 탈 += 조각; });
    아이.on('error', (탈난것) => 끝내기({ error: 탈난것, status: null, stdout: 밖, stderr: 탈 }));
    아이.on('close', (코드) => 끝내기({ error: null, status: 코드, stdout: 밖, stderr: 탈 }));
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
  } = 옵션;

  const 아이 = spawn(파일, 인자, {
    cwd, env, windowsHide, windowsVerbatimArguments, detached,
  });

  const 밖조각 = [];
  const 탈조각 = [];
  let 밖크기 = 0;
  let 탈크기 = 0;
  let 끝났나 = false;
  let 미리잡은탈 = null;

  const 모으기 = (스트림, 조각들, 더할것) => {
    조각들.push(더할것);
    return 스트림 + 더할것.length;
  };

  const 끝내기 = (탈) => {
    if (끝났나) return;
    끝났나 = true;
    clearTimeout(시계);
    끝나면(탈 ?? null, Buffer.concat(밖조각), Buffer.concat(탈조각));
  };

  /** execFile 이 만드는 것과 같은 모양의 탈. */
  const 탈만들기 = (글, 더할것) => Object.assign(new Error(글), 더할것);

  const 넘쳤다 = () => {
    미리잡은탈 = 탈만들기('stdout maxBuffer length exceeded',
      { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true });
    try { 아이.kill(killSignal); } catch { /* 이미 죽었다 */ }
  };

  아이.stdout?.on('data', (조각) => {
    밖크기 = 모으기(밖크기, 밖조각, 조각);
    if (밖크기 > maxBuffer && !미리잡은탈) 넘쳤다();
  });
  아이.stderr?.on('data', (조각) => {
    탈크기 = 모으기(탈크기, 탈조각, 조각);
    if (탈크기 > maxBuffer && !미리잡은탈) 넘쳤다();
  });

  /*
   * 시한은 **마지막 그물**이다. 부르는 쪽이 제 시계로 먼저 끊는 것이 보통이고,
   * 이건 그것마저 못 돌았을 때 선다. unref 하지 않는다 — 여기서 놓아 버리면
   * 그물이 아니게 된다.
   */
  const 시계 = timeout > 0 ? setTimeout(() => {
    미리잡은탈 = 탈만들기(`명령이 ${timeout}ms 안에 안 끝났습니다`,
      { killed: true, signal: killSignal });
    try { 아이.kill(killSignal); } catch { /* 이미 죽었다 */ }
  }, timeout) : null;

  아이.on('error', (탈) => 끝내기(탈));
  아이.on('close', (코드, 신호) => {
    if (미리잡은탈) return 끝내기(미리잡은탈);
    if (신호) return 끝내기(탈만들기(`${신호} 시그널로 죽었습니다`, { killed: true, signal: 신호 }));
    if (코드 !== 0) return 끝내기(탈만들기(`종료코드 ${코드}`, { code: 코드, killed: false }));
    끝내기(null);
  });

  return 아이;
}
