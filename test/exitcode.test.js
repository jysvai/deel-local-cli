// `deel --help` 가 적어 놓은 종료코드 표와 진짜 EXIT 이 같은가.
//
// ── 왜 이 검사가 생겼나 ─────────────────────────────────────────────────
//
// `bin/deel.js` 의 도움말은 「0 끝냄 · 1 오류 · 2 걸음수상한 · 3 헛돎 ·
// 4 중단 · 5 말없이끊김」 여섯 개를 적어 두었다. 그런데 `src/oneshot.js` 의
// `EXIT` 에는 **일곱 개**가 있다 — `refusal: 6` 이 빠져 있었다.
//
// 이게 왜 나쁜가. `deel run` 은 스크립트와 CI 에서 쓰라고 만든 길이고, 그
// 길에서 종료코드는 **유일한 계약**이다. 6 을 받은 파이프라인은 도움말에도
// 없는 수를 받고 「알 수 없는 실패」 로 처리한다. 그런데 6 은 실패가 아니라
// **거절**이다 — 고칠 자리가 연결이 아니라 시킨 말이다(oneshot.js:66-68).
// 계약을 적어 둔 유일한 자리가 계약과 달랐고, 아무도 안 세고 있었다.
//
// ── 왜 tools/check-docs.mjs 가 아니라 여기인가 ──────────────────────────
//
// `package.json` 의 `prepublishOnly` 는 `npm run check && npm test` 다.
// `docs` 는 거기 없다. 문서 검사에 넣으면 배포 길에서 안 돌고, 그러면 이
// 못은 심사서의 「123항목」 이 낡던 것과 똑같은 방식으로 낡는다.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../src/oneshot.js';
import { trace } from './trace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });

trace('1-표와-EXIT');

const 도움말 = readFileSync(join(here, '..', 'bin', 'deel.js'), 'utf8');

// 「끝난 까닭이 종료코드에 담깁니다:」 뒤에 오는 그 줄 하나를 뽑는다.
const m = /끝난 까닭이 종료코드에 담깁니다:[^']*'\)} \$\{c\.gray\('([^']+)'\)}/.exec(도움말);
check('★ 도움말에서 종료코드 줄을 찾는다', !!m, m ? m[1] : '(못 찾음)');

if (m) {
  const 적힌수 = [...m[1].matchAll(/(\d+)\s/g)].map((x) => Number(x[1]));
  const 진짜수 = Object.values(EXIT).slice().sort((a, b) => a - b);

  check('★★ 도움말이 적은 종료코드 개수가 EXIT 과 같다',
    적힌수.length === 진짜수.length,
    `도움말 ${적힌수.length}개(${적힌수.join(',')}) vs EXIT ${진짜수.length}개(${진짜수.join(',')})`);

  check('★★ 값도 하나하나 같다',
    적힌수.join(',') === 진짜수.join(','),
    `${적힌수.join(',')} vs ${진짜수.join(',')}`);

  // 빠진 것을 이름으로 짚어 준다 — 「개수가 다르다」 만으로는 무엇을 더할지 모른다.
  const 빠진것 = Object.entries(EXIT).filter(([, v]) => !적힌수.includes(v));
  check('★ 빠진 까닭이 없다', 빠진것.length === 0,
    빠진것.map(([k, v]) => `${k}=${v}`).join(' · '));
}

trace('2-EXIT-자체');

/*
 * 값이 겹치면 종료코드로 까닭을 가릴 수가 없다. `deel run` 을 CI 에서 쓰는
 * 사람에게는 그것이 계약 위반이다.
 */
const 값들 = Object.values(EXIT);
check('★ 종료코드 값이 겹치지 않는다', new Set(값들).size === 값들.length,
  값들.join(','));
check('★ 성공은 0 이다', EXIT.done === 0, String(EXIT.done));
check('★ 나머지는 전부 0 이 아니다',
  Object.entries(EXIT).filter(([k]) => k !== 'done').every(([, v]) => v !== 0),
  Object.entries(EXIT).map(([k, v]) => `${k}=${v}`).join(' · '));

const G = '\x1b[32m'; const R = '\x1b[31m'; const D = '\x1b[90m'; const X = '\x1b[0m';
console.log('\n종료코드 표 검사\n');
for (const p of pass) console.log(`  ${G}✓${X} ${p.name}${p.note ? `${D}  ${p.note}${X}` : ''}`);
for (const f of fail) console.log(`  ${R}✗${X} ${f.name}  ${D}${f.note}${X}`);
console.log(`\n  ${pass.length}개 통과 · ${fail.length}개 실패\n`);
process.exitCode = fail.length ? 1 : 0;
