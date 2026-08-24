// abort() 를 견디는 진행 기록.
//
// 윈도우에서 프로세스가 abort 로 죽으면 화면에 아직 안 나간 글이 전부 사라진다.
// 표준출력도 표준오류도 파이프면 마찬가지다. 그래서 어디까지 갔는지 알 수가 없다.
//
// 디스크에 동기로 적으면 살아남는다. appendFileSync 는 돌아오기 전에 파일에
// 닿아 있다. 러너가 자식이 죽은 뒤 그 파일을 읽어 마지막 자리를 알려준다.
//
// 평소에는 아무 일도 안 한다 — DEEL_TRACE 가 있을 때만 적는다.
import { appendFileSync } from 'node:fs';

const 파일 = process.env.DEEL_TRACE || '';

export function trace(mark) {
  if (!파일) return;
  try { appendFileSync(파일, `${mark}\n`); } catch { /* 기록 못 해도 검사는 계속 */ }
}
