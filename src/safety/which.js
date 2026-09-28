// 실행 파일을 PATH 에서 **우리가** 찾는다 — 셸이나 운영체제가 찾게 두지 않는다.
//
// tools/verify.js 에서 떼어 냈다 (2.1.3). 되돌리기의 git 뜨기(safety/gitsnap.js)도 같은 자로 git 을 찾는다 —
// 두 벌이면 언젠가 한 벌만 고친다. 여기는 fs 와 path 만 부른다(되돌리기는 설정이 깨져도 돌아야 하는 자리다).

import { statSync } from 'node:fs';
import { resolve, join, delimiter, isAbsolute, relative } from 'node:path';

/**
 * 이름으로 실행 파일을 PATH 에서 찾는다.
 *
 * 지금 폴더를 뜻하는 칸(빈 칸·`.`·상대 경로)과 작업 폴더 안의 칸은 건너뛴다. 그 자리의
 * 파일은 저장소가 심을 수 있다. 윈도우에서는 `.exe` 만 본다 — `.cmd`·`.bat` 은 결국
 * cmd.exe 를 부르는 것이라 셸을 안 거친다는 뜻이 없어진다.
 *
 * @returns {string|null} 절대 경로. 못 찾으면 null — 그러면 「도구가 없다」 로 말한다.
 */
export function 경로에서찾기(이름들, { env = process.env, 뿌리 = null } = {}) {
  const 윈 = process.platform === 'win32';
  // 윈도우 환경 이름은 대소문자를 안 가린다(Path · PATH). 거른 환경 객체는 평범한 객체라 직접 찾는다.
  const 칸 = Object.keys(env ?? {}).find((k) => (윈 ? k.toUpperCase() === 'PATH' : k === 'PATH'));
  const 목록 = String((칸 && env[칸]) ?? '').split(delimiter);
  const 뿌리abs = 뿌리 ? resolve(뿌리) : null;
  for (const 이름 of 이름들) {
    for (const 날것 of 목록) {
      const 폴더 = 날것.trim().replace(/^"(.*)"$/, '$1');
      if (!폴더 || !isAbsolute(폴더)) continue;
      if (뿌리abs) {
        const rel = relative(뿌리abs, resolve(폴더));
        if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) continue;
      }
      const 후보 = join(폴더, 윈 ? `${이름}.exe` : 이름);
      try { if (statSync(후보).isFile()) return 후보; } catch { /* 여기엔 없다 */ }
    }
  }
  return null;
}
