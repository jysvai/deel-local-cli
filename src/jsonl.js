/**
 * 한 줄씩 덧붙여 가는 기록 파일(대화 · 감사기록 · 되돌리기 이력)이 같이 쓰는 두 손질.
 *
 * agent/store.js · safety/audit.js · safety/undo.js 에 바이트까지 같은 사본이 세 벌 있었다
 * (2.0.0 7회차에 적어 둠). 한 벌을 고치고 두 벌을 잊는 날이 오므로 여기 한 벌만 둔다 (2.0.2).
 *
 * node:fs 말고는 아무것도 안 들여온다 — 되돌리기는 설정이 깨져도 돌아야 한다(undo.js 머리말).
 * 그래서 `진짜자리()` 쌍둥이(guard · undo)는 여기로 안 모은다.
 */
import { statSync, openSync, readSync, closeSync, chmodSync } from 'node:fs';

/**
 * 파일이 개행으로 끝나나. 없거나 비었거나 못 읽으면 참 — 붙일 반쪽이 없다.
 *
 * 앞 판이 한 줄을 반만 적고 죽으면, 이어 적는 첫 줄이 그 반쪽 **뒤에 그대로 붙어** 한 줄이
 * 되고, 그 줄은 JSON 이 아니라 다음에 읽을 때 통째로 건너뛴다. 부르는 쪽은 파일마다 처음
 * 적을 때 한 번 이것을 보고, 아니면 개행부터 붙인다.
 */
export function 줄로끝나나(file) {
  let fd = null;
  try {
    const 크기 = statSync(file).size;
    if (!크기) return true;
    fd = openSync(file, 'r');
    const 한바이트 = Buffer.alloc(1);
    readSync(fd, 한바이트, 0, 1, 크기 - 1);
    return 한바이트[0] === 0x0a;
  } catch { return true; }         // 없거나 못 읽으면 붙일 반쪽도 없다
  finally { if (fd != null) { try { closeSync(fd); } catch { /* 닫다 터져도 적기는 한다 */ } } }
}

/**
 * 본인만 읽게 잠근다. 건 결과를 돌려준다 — `{모드}` 면 걸었고, `{못함}` 이면 못 걸었다.
 *
 * 윈도우에서 chmod 는 **아무 일도 안 하고 성공한다.** 그 성공을 그대로 적으면 「잠근 척」
 * 이 된다 — 같은 PC 를 여럿이 쓰는 사람이 화면만 보고 안심한다. 안 걸었으면 안 걸었다고 적는다.
 */
export function 본인만잠그기(file) {
  if (process.platform === 'win32') return { 못함: 'windows' };
  try { chmodSync(file, 0o600); return { 모드: 0o600 }; }
  catch (err) { return { 못함: err?.code ?? String(err) }; }
}
