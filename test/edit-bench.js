// 편집 신뢰성 시험대.
// 모델이 실제로 틀리는 방식(공백·들여쓰기·줄바꿈)을 그대로 재현해
// "정확히 일치만" 쓰던 옛 방식과 지금 방식의 성공률을 나란히 잰다.
//
// 통과 기준은 두 가지다:
//   고쳐야 할 것을 고쳤는가  (성공률)
//   고치면 안 될 것을 거부했는가  (오탐 0건 ← 이쪽이 더 중요)
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScope } from '../src/safety/guard.js';
import { History } from '../src/safety/undo.js';
import { Audit } from '../src/safety/audit.js';
import { runTool } from '../src/tools/index.js';
import { TIER_LABELS } from '../src/tools/edit-match.js';

// ── 시험 항목 ──────────────────────────────────────────────────────
// want: 'fix' 고쳐야 함 · 'refuse' 거부해야 함
const CASES = [
  {
    name: '정확히 일치',
    file: 'const port = 7080;\n',
    old: 'const port = 7080;',
    new: 'const port = 7099;',
    want: 'fix', expect: 'const port = 7099;',
  },
  {
    name: 'CRLF 파일에 LF 로 찾기',
    file: 'function a() {\r\n  return 1;\r\n}\r\n',
    old: 'function a() {\n  return 1;\n}',
    new: 'function a() {\n  return 2;\n}',
    want: 'fix', expect: 'return 2;',
  },
  {
    name: '줄 끝 공백이 다름',
    file: 'let a = 1;   \nlet b = 2;\n',
    old: 'let a = 1;\nlet b = 2;',
    new: 'let a = 9;\nlet b = 8;',
    want: 'fix', expect: 'let a = 9;',
  },
  {
    // 모델이 파일보다 더 깊게 들여썼을 때를 본다.
    // 반대(모델이 더 얕게)는 부분 문자열로 우연히 맞아 진짜 시험이 안 된다.
    name: '들여쓰기 4칸(모델) vs 2칸(파일)',
    file: 'function f() {\n  log("hi");\n}\n',
    old: '    log("hi");',
    new: '    log("bye");',
    want: 'fix', expect: '\n  log("bye");',   // 파일 들여쓰기(2칸)에 맞춰 들어가야 한다
  },
  {
    name: '탭 vs 공백',
    file: 'if (x) {\n\treturn true;\n}\n',
    old: '    return true;',
    new: '    return false;',
    want: 'fix', expect: 'return false;',
  },
  {
    name: '여러 줄 전체 들여쓰기 차이',
    file: 'class A {\n        run() {\n            go();\n        }\n}\n',
    old: '  run() {\n    go();\n  }',
    new: '  run() {\n    stop();\n  }',
    want: 'fix', expect: 'stop();',
  },
  {
    name: '연속 공백 개수 차이',
    file: 'const  x   =    1;\n',
    old: 'const x = 1;',
    new: 'const x = 2;',
    want: 'fix', expect: 'const x = 2;',
  },
  {
    name: '한글 주석 + 들여쓰기 차이',
    file: 'function f() {\n    // 실행을 시작한다\n    start();\n}\n',
    old: '  // 실행을 시작한다\n  start();',
    new: '  // 실행을 멈춘다\n  stop();',
    want: 'fix', expect: '멈춘다',
  },
  {
    name: '빈 줄에 공백이 들어 있음',
    file: 'a();\n   \nb();\n',
    old: 'a();\n\nb();',
    new: 'a();\nc();\nb();',
    want: 'fix', expect: 'c();',
  },
  {
    name: '파일 끝 개행 없음',
    file: 'last = 1;',
    old: 'last = 1;',
    new: 'last = 2;',
    want: 'fix', expect: 'last = 2;',
  },

  // ── 거부해야 하는 것들 (오탐 방지) ──
  {
    name: '두 군데 있음 → 거부',
    file: 'go();\nstop();\ngo();\n',
    old: 'go();',
    new: 'run();',
    want: 'refuse', why: /군데에서 발견/,
  },
  {
    name: '아예 없음 → 거부',
    file: 'const a = 1;\n',
    old: 'const zzz = 99;',
    new: 'x',
    want: 'refuse', why: /찾지 못했습니다/,
  },
  {
    name: '비슷하지만 변수명이 다름 → 거부',
    file: 'send(userId, token);\n',
    old: 'send(userId, secret);',
    new: 'send(userId, null);',
    want: 'refuse', why: /찾지 못했습니다/,
  },
  {
    name: '들여쓰기만 다른 후보가 둘 → 거부',
    file: 'if (a) {\n  ok();\n}\nif (b) {\n    ok();\n}\n',
    old: 'ok();',
    new: 'fine();',
    want: 'refuse', why: /군데에서 발견/,
  },
  {
    name: '빈 old_string → 거부',
    file: 'x = 1;\n',
    old: '',
    new: 'y',
    want: 'refuse', why: /./,
  },
];

// ── 옛 방식: 정확히 일치만 ────────────────────────────────────────
function oldWay(file, old, replaceAll = false) {
  if (!old) return { ok: false };
  let n = 0, i = 0;
  while ((i = file.indexOf(old, i)) >= 0) { n++; i += old.length; }
  if (n === 0) return { ok: false };
  if (n > 1 && !replaceAll) return { ok: false };
  return { ok: true };
}

// ── 실행 ───────────────────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'deel-bench-'));
const ctx = { scope: makeScope(root), history: new History(root), audit: new Audit(root), seen: new Set() };
ctx.history.nextTurn();

const rows = [];
let oldFixed = 0, newFixed = 0, shouldFix = 0;
let falsePositive = 0, refusedRight = 0, shouldRefuse = 0;

for (const [i, cs] of CASES.entries()) {
  const name = `case${i}.txt`;
  const abs = join(root, name);
  writeFileSync(abs, cs.file, 'utf8');
  ctx.seen.add(abs);

  const oldOk = oldWay(cs.file, cs.old).ok;
  const r = await runTool('Edit', { file_path: name, old_string: cs.old, new_string: cs.new }, ctx);
  const text = readFileSync(abs, 'utf8');

  let verdict, tier = '';
  if (cs.want === 'fix') {
    shouldFix++;
    if (oldOk) oldFixed++;
    const fixed = !r.error && text.includes(cs.expect);
    if (fixed) { newFixed++; verdict = 'ok'; tier = r.tier ?? ''; }
    else verdict = 'miss';
  } else {
    shouldRefuse++;
    if (r.error && cs.why.test(r.error)) { refusedRight++; verdict = 'ok'; }
    else if (r.error) { refusedRight++; verdict = 'ok'; tier = '(다른 이유)'; }
    else { falsePositive++; verdict = 'DANGER'; }
  }

  rows.push({
    name: cs.name,
    want: cs.want,
    oldOk,
    verdict,
    tier,
    note: r.error ? String(r.error).split('\n')[0].slice(0, 46) : (r.summary ?? ''),
  });
}

// ── 출력 ───────────────────────────────────────────────────────────
const w = (s, n) => {
  const len = [...String(s)].reduce((a, ch) => a + (ch.codePointAt(0) > 0x1100 ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - len));
};
const G = (s) => `\x1b[32m${s}\x1b[0m`;
const R = (s) => `\x1b[31m${s}\x1b[0m`;
const Y = (s) => `\x1b[33m${s}\x1b[0m`;
const D = (s) => `\x1b[90m${s}\x1b[0m`;

console.log('');
console.log('  편집 신뢰성 시험대');
console.log('  ' + '─'.repeat(76));
console.log(`  ${w('항목', 30)} ${w('옛방식', 8)} ${w('지금', 8)} ${w('통한 단계', 22)}`);
console.log('  ' + '─'.repeat(76));
for (const r of rows) {
  const oldCell = r.want === 'fix' ? (r.oldOk ? G('성공') : R('실패')) : D('—');
  const nowCell = r.verdict === 'ok' ? G(r.want === 'fix' ? '성공' : '거부')
    : r.verdict === 'DANGER' ? R('오탐!') : R('실패');
  const tierCell = r.tier ? D(TIER_LABELS[r.tier] ?? r.tier) : D(r.note);
  console.log(`  ${w(r.name, 30)} ${w(oldCell, 8 + 9)} ${w(nowCell, 8 + 9)} ${tierCell}`);
}
console.log('  ' + '─'.repeat(76));
console.log('');
console.log(`  고쳐야 할 것 ${shouldFix}건`);
console.log(`    옛 방식(정확히 일치만)   ${w(oldFixed + '/' + shouldFix, 8)} ${D(Math.round((oldFixed / shouldFix) * 100) + '%')}`);
console.log(`    지금(단계별 완화)        ${w(newFixed + '/' + shouldFix, 8)} ${G(Math.round((newFixed / shouldFix) * 100) + '%')}`);
console.log('');
console.log(`  거부해야 할 것 ${shouldRefuse}건`);
console.log(`    올바로 거부              ${w(refusedRight + '/' + shouldRefuse, 8)} ${refusedRight === shouldRefuse ? G('100%') : R('구멍 있음')}`);
console.log(`    ${falsePositive ? R('엉뚱한 곳을 고침 ' + falsePositive + '건 ← 반드시 고쳐야 함') : G('엉뚱한 곳을 고친 경우 없음')}`);
console.log('');

rmSync(root, { recursive: true, force: true });
const bad = (newFixed < shouldFix) || falsePositive > 0;
process.exit(bad ? 1 : 0);
