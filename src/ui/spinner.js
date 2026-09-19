// 진행 중 표시. TTY가 아니면 돌리지 않고 줄로만 남긴다.
//
// 「한 줄만」 이 아니다. 시작할 때 무엇을 하는 중인지 한 줄, 끝맺음 글을 받으면 그때 한 줄 —
// 부르는 열아홉 자리 중 열넷이 끝맺음 글을 준다(찾음 개수·연결됨·못 물어봤습니다…). 시작 줄을
// 빼면 로그에 결과만 남아 무엇을 하다 그리 됐는지가 사라지고, 끝맺음 줄을 빼면 그 열넷이
// 통째로 말을 잃는다. 끝맺음 글을 안 주는 다섯 자리에서만 한 줄로 끝난다.
import { c, cursor } from './ansi.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function spin(label) {
  // TTY가 아니면(로그로 넘길 때, 사내망 캡처용) 움직이지 않고 줄만 남긴다.
  if (!process.stdout.isTTY) {
    process.stdout.write(`  ${label}\n`);
    return {
      stop(finalLine) {
        if (finalLine) process.stdout.write(finalLine + '\n');
      },
    };
  }
  let i = 0;
  cursor.hide();
  const tick = () => {
    cursor.clearLine();
    process.stdout.write(`  ${c.cyan(FRAMES[i++ % FRAMES.length])} ${c.gray(label)}`);
  };
  tick();
  const timer = setInterval(tick, 80);
  return {
    stop(finalLine) {
      clearInterval(timer);
      cursor.clearLine();
      cursor.show();
      if (finalLine) process.stdout.write(finalLine + '\n');
    },
  };
}
