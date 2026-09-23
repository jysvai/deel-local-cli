// 완료 검사 — 「다 됐습니다」 를 모델의 말이 아니라 **검사 결과**로 가른다 (2.1.0).
//
// ── 왜 만드나 ───────────────────────────────────────────────────────────
//
// 사내 검토에서 나온 말이 둘이었다. 「검증을 정적 검사에 기대면 한계가 있다」 와
// 「루프를 더 다듬어야 한다」. 재 보니 맞았다. 턴이 끝나는 자리는 **모델이 도구를
// 안 부르고 말만 한 걸음** 하나였다. 모델이 「고쳤습니다」 라고 하면 그걸로 끝이었다.
//
// 확인할 길은 있었다. Verify 는 문법·짝을 읽어서 보고(tools/verify.js), checkmethods 는
// 이 프로젝트의 검사 명령을 찾아 알려 주고(tools/checkmethods.js), 증거는 「고친 뒤에
// 돌려서 통과한 검사가 있나」 를 사람에게 보여 준다(agent/evidence.js). 셋 다 **권하거나
// 보여 주기만** 한다. 돌릴지는 모델이 정했고, 안 돌리고 끝내도 막는 자리가 없었다.
//
// 그래서 사람이 검사 명령 하나를 정해 두면(`"check": "npm test"`), 모델이 끝내려는
// 자리에서 **deel 이 직접** 그 명령을 돌린다.
//
//   통과      그대로 끝낸다. 끝맺음에 「완료 검사 통과」 가 붙는다
//   실패      실패 출력을 모델에게 돌려주고 이어서 고치게 한다 — 정해 둔 판수까지
//   다 써도 실패   끝내되 **실패로** 끝낸다. `deel run` 은 종료코드 8 을 낸다
//
// ── 안 하는 것 ──────────────────────────────────────────────────────────
//
// 명령을 **지어내지 않는다.** 정해 둔 것이 없으면 이 고리는 아예 안 돈다. 있을 법한
// 검사(npm test)를 짐작해 돌리면, 그 프로젝트에서 그게 20분짜리이거나 DB 를 비우는
// 스크립트일 때 사람이 모르는 채로 돈다.
//
// 따로 도는 길도 **안 만든다.** 이 명령은 모델이 부른 Bash 와 똑같은 관문을 지난다 —
// 적어 둔 금지 규칙, 사람이 건 훅, 승인 모드(strict 면 묻는다), 위험 명령 막이, 열쇠 뺀
// 환경. 설정에 적힌 명령이라고 관문을 건너뛰면 저장소 설정 한 줄이 strict 를 뚫는다.
//
// 아무것도 안 바꾼 턴에는 안 돈다. 물어본 것에 답만 한 턴에 테스트가 도는 것은 소음이다.
// 고친 뒤 실패를 받고 **다시 아무것도 안 바꾼 채** 끝내려 하면 다시 돌리지 않는다 —
// 같은 결과가 나올 것을 또 기다리게 하지 않고, 실패로 끝낸다.

/** 한 턴에 몇 번까지 「고치고 → 다시 검사」 를 돌까. 기본과 상한. */
export const 기본판수 = 3;
export const 최대판수 = 10;
/** 검사 한 번의 제한 시간(ms). Bash 도구의 상한(10분)과 같다 — 넘겨 봐야 거기서 잘린다. */
export const 기본시간 = 600_000;
const 최소시간 = 1_000;

/**
 * 설정과 실행 깃발에서 완료 검사를 읽는다. 정해 둔 명령이 없으면 null — 고리를 안 돈다.
 *
 * @param {object} cfg        설정 (`check` · `checkRounds` · `checkTimeout`)
 * @param {string} [덮을명령]   `deel run --check` 로 준 명령. 설정보다 이긴다
 * @returns {{명령:string, 판수:number, 시간:number} | null}
 */
export function 검사설정(cfg = {}, 덮을명령 = undefined) {
  const 날것 = 덮을명령 !== undefined && 덮을명령 !== null ? 덮을명령 : cfg?.check;
  if (typeof 날것 !== 'string') return null;
  const 명령 = 날것.trim();
  if (!명령) return null;
  /*
   * 판수는 1 ~ 10 에서만 받는다. 0 이나 음수를 「끈다」 로 읽으면 명령을 적어 둔 사람이
   * 왜 안 도는지 모른다. 끄려면 check 를 지운다. 숫자가 아니면 기본값이다.
   */
  const n = Number(cfg?.checkRounds);
  const 판수 = Number.isInteger(n) && n >= 1 ? Math.min(n, 최대판수) : 기본판수;
  const 초 = Number(cfg?.checkTimeout);
  const 시간 = Number.isFinite(초) && 초 > 0 ? Math.min(기본시간, Math.max(최소시간, Math.round(초 * 1000))) : 기본시간;
  return { 명령, 판수, 시간 };
}

/**
 * 긴 출력에서 **뒤를** 남긴다. 테스트가 무엇이 틀렸는지 말하는 자리는 대개 끝이다 —
 * 앞을 남기면 모델은 「테스트 시작」 줄만 받고 무엇이 틀렸는지 모른다.
 */
export function 출력꼬리(글, 한도 = 6000) {
  const s = String(글 ?? '');
  if (s.length <= 한도) return s;
  return `…(앞 ${s.length - 한도}자 줄임)\n${s.slice(s.length - 한도)}`;
}

/**
 * 도구 결과 하나를 통과·실패로 가른다. 종료코드 0 으로 끝난 것만 통과다 —
 * 시그널로 죽은 것·시간 초과·못 돌린 것은 다 실패다 (tools/index.js 의 Bash 결과 머리말).
 */
export function 통과했나(result) {
  return !!result && !result.error && result.failed !== true;
}

/** 실패한 검사를 모델에게 돌려줄 말. 무엇을 돌렸고, 몇 번째이고, 무엇이 나왔는지. */
export function 실패말({ 명령, 출력, 판, 최대 }, { 영어 = false } = {}) {
  const 남은 = Math.max(0, 최대 - 판);
  const 꼬리 = 출력꼬리(출력);
  if (영어) {
    return `The completion check \`${명령}\` failed (${판}/${최대}). You said the work was done, but the check does not pass.\n\n`
      + `${꼬리}\n\n`
      + 'Read the failure, fix the cause in the code, and finish again. Do not edit or delete the check itself to make it pass.'
      + (남은 ? ` The check runs again when you finish (${남은} more ${남은 === 1 ? 'try' : 'tries'}).` : '');
  }
  return `완료 검사 \`${명령}\` 가 실패했습니다 (${판}/${최대}). 다 됐다고 했는데 검사가 통과하지 않습니다.\n\n`
    + `${꼬리}\n\n`
    + '실패 내용을 읽고 코드에서 원인을 고친 뒤 다시 끝내세요. 검사를 통과시키려고 검사 자체를 고치거나 지우지 마세요.'
    + (남은 ? ` 끝내면 검사가 다시 돕니다 (${남은}번 남음).` : '');
}
