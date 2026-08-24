// 진행 중 표시. TTY가 아니면 조용히 한 줄만 남긴다.
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
