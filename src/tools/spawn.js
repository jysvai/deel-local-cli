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
