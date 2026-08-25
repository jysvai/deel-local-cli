// 판 번호를 한 곳에서만 읽는다.
//
// 왜 파일 하나를 따로 두나: 전에는 backend/mcp.js 가 '0.9.0' 을 직접 적어
// 들고 있었다. package.json 을 올릴 때 그건 안 올라간다 — 아무 데서도 안
// 터지고, 검사도 안 걸리고, MCP 서버 쪽 기록에만 옛 번호가 남는다.
// 이런 것은 반드시 어긋나므로 애초에 두 벌을 안 만든다.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * 못 읽어도 죽지 않는다.
 *
 * package.json 은 npm 이 언제나 같이 깔아 주지만, 소스만 풀어 쓰는 길도
 * 열어 둔 도구다(README 의 `git clone` 뒤 바로 실행). 판 번호 하나 때문에
 * 프로그램이 안 뜨는 것은 말이 안 된다.
 */
function 읽기() {
  try {
    const 여기 = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(여기, '..', 'package.json'), 'utf8'));
    return String(pkg.version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

export const VERSION = 읽기();
