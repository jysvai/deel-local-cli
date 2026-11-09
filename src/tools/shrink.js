// 명령 출력에서 모델이 안 읽어도 되는 줄을 덜어 낸다 (로컬 연결의 Bash).
//
// 로컬은 창이 작고, 한 번 들어간 글은 뒤의 모든 토큰을 느리게 한다. 받는 자리에서 줄이면
// 앞머리를 안 건드리니 캐시도 그대로다. 오류 줄은 어떤 경우에도 빼지 않는다.
import { 보관 } from '../agent/archive.js';

const 색깔 = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const 통과줄 = /^\s*(✓|✔|√|ok\b|pass(ed)?\b)/i;
const 오류낌새 = /✗|✘|fail|error|오류|실패/i;
const 통과접는문턱 = 20;

export function 출력줄이기(글) {
  const 줄들 = String(글 ?? '').replace(색깔, '').split('\n')
    .map((줄) => { const s = 줄.replace(/\r+$/, ''); return s.slice(s.lastIndexOf('\r') + 1); });
  const 빼도될 = (줄) => 통과줄.test(줄) && !오류낌새.test(줄);
  const 통과수 = 줄들.filter(빼도될).length;
  const 접나 = 통과수 > 통과접는문턱;
  const 남은 = [];
  let 앞 = null; let 겹침 = 0;
  const 겹침적기 = () => { if (겹침 > 0) 남은[남은.length - 1] += ` (위 줄 ${겹침}번 더)`; 겹침 = 0; };
  for (const 줄 of 줄들) {
    if (접나 && 빼도될(줄)) continue;
    if (줄 === 앞 && 줄.trim()) { 겹침 += 1; continue; }
    겹침적기();
    남은.push(줄);
    앞 = 줄;
  }
  겹침적기();
  if (접나) 남은.push(`(통과 줄 ${통과수}개 뺌)`);
  return 남은.join('\n').trim();
}

/** 줄이고, 그래도 넘치면 자르되 원문은 보관해 번호를 붙인다. */
export function 로컬출력(글, 상한, root) {
  const 준것 = 출력줄이기(글);
  if (준것.length <= 상한) return 준것;
  const 번호 = 보관(root, 글);
  return 머리꼬리(준것, 상한) + (번호 !== null ? `\n(원문 전체: Recall id=${번호})` : '');
}

/** 길면 가운데를 자른다. 명령의 오류와 결론은 대개 끝에 있다. */
export function 머리꼬리(글, 상한) {
  if (글.length <= 상한) return 글;
  const 앞 = Math.floor(상한 * 0.3);
  return `${글.slice(0, 앞)}\n… (${글.length - 상한}자 잘림)\n${글.slice(앞 - 상한)}`;
}
