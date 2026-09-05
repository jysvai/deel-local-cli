// 어긋내기 — 검사가 정말로 무언가를 지키고 있는지 재는 판.
//
// ── 왜 필요한가 ─────────────────────────────────────────────────────────
//
// `npm test` 가 초록이라는 것은 「아무도 안 깨졌다」 는 뜻이다. 「깨면 잡힌다」
// 는 뜻이 아니다. 이 둘은 겉으로 구별이 안 되는데, 값어치는 정반대다.
//
// 실제로 이 저장소에서 그런 줄을 여러 번 찾았다. 커버리지 문턱(`--min`)은
// 열두 판 동안 색깔만 칠하고 아무것도 안 막고 있었고, 「무리를 만들어 둔다」
// 는 줄은 아무 일도 안 했다. 둘 다 검사는 내내 초록이었다.
//
// 그래서 반대로 잰다 — 지켜야 할 줄을 **일부러 어긋내 놓고**, 짝지어 적은
// 검사가 빨개지는지 본다. 안 빨개지면 그 검사는 그 자리를 안 지키고 있다.
// 무엇을 어긋낼지는 `test/mutants.json` 에 있다. 까닭도 거기 적었다.
//
// ── 일하는 폴더를 따로 쓴다 ──────────────────────────────────────────────
//
// 소스를 제자리에서 고쳤다가 되돌리는 방식은 안 쓴다. 도중에 Ctrl+C 를 맞거나
// 검사가 프로세스를 물고 죽으면 **어긋난 소스가 그대로 남는다.** 그걸 모르고
// 커밋하면 이 판이 막으려던 것보다 나쁜 일이 된다.
//
// 그래서 임시 폴더로 한 벌 베껴 놓고 거기서만 고친다. 이 저장소는 딸린 꾸러미가
// 없어서(집안 규칙) src·test·bin·package.json 넷이면 그대로 돌아간다.
//
// ── 재기 전에 먼저 초록인지 본다 ─────────────────────────────────────────
//
// 어긋내고 빨개진 것을 「잡았다」 로 세려면, 어긋내기 **전에** 초록이어야 한다.
// 원래 빨간 검사는 무엇을 해도 빨개서 전부 잡은 것처럼 보인다 — 그러면 이 판이
// 스스로 거짓말을 하는 셈이다. 그래서 짝지어진 검사마다 맨 것을 한 번 먼저 돌린다.
//
//   node tools/mutate.mjs           사람이 읽는 표
//   node tools/mutate.mjs --json    기계가 읽는 한 덩이
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const 뿌리 = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const 인자 = process.argv.slice(2);
const json = 인자.includes('--json');

const G = '\x1b[32m'; const R = '\x1b[31m'; const Y = '\x1b[33m'; const D = '\x1b[90m'; const X = '\x1b[0m';
const 색없나 = process.env.NO_COLOR || !process.stdout.isTTY;
const 색 = (c, s) => (색없나 ? s : `${c}${s}${X}`);
const 말 = (s = '') => { if (!json) console.log(s); };

const { 어긋들 } = JSON.parse(readFileSync(join(뿌리, 'test', 'mutants.json'), 'utf8'));

// ── 일할 폴더 한 벌 ─────────────────────────────────────────────────────
const 일터 = mkdtempSync(join(tmpdir(), 'deel-mutate-'));
for (const 것 of ['src', 'test', 'bin']) cpSync(join(뿌리, 것), join(일터, 것), { recursive: true });
cpSync(join(뿌리, 'package.json'), join(일터, 'package.json'));

/** 검사 하나를 돌리고 종료코드를 돌려준다. 화면 글은 안 흘린다. */
function 돌리기(검사) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(일터, 검사)], {
    cwd: 일터,
    encoding: 'utf8',
    // 검사가 사람을 기다리는 일이 없어야 한다. 서면 여기서 끊고 그대로 말한다.
    timeout: 180000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { code: r.status, 걸린: Date.now() - t0, 섰나: r.error?.code === 'ETIMEDOUT' };
}

const 결과 = [];
let 못잰것 = 0;

try {
  // ── 1) 맨 것부터. 원래 빨간 검사로는 아무것도 못 잰다 ─────────────────
  말('');
  말(`  어긋내기  ${색(D, `(${어긋들.length}개를 일부러 어긋내고 검사가 잡는지 봅니다)`)}`);
  말('');
  const 맨것 = new Map();
  for (const 검사 of [...new Set(어긋들.map((x) => x.검사))]) {
    const r = 돌리기(검사);
    맨것.set(검사, r.code === 0);
    말(`  ${r.code === 0 ? 색(G, '·') : 색(R, '✗')} ${색(D, `맨 ${검사} → ${r.code === 0 ? '초록' : `종료코드 ${r.code}${r.섰나 ? ' (서 버림)' : ''}`} · ${(r.걸린 / 1000).toFixed(1)}초`)}`);
  }
  말('');

  // ── 2) 하나씩 어긋내고 돌린다 ──────────────────────────────────────────
  for (const 어긋 of 어긋들) {
    const 파일 = join(일터, 어긋.곳);
    const 원본 = readFileSync(파일, 'utf8');
    const 몇번 = 원본.split(어긋.찾을것).length - 1;

    if (몇번 !== 1) {
      // 찾을 것이 없거나 여럿이면 **소리 내어 실패한다.** 조용히 건너뛰면
      // 목록이 낡은 것을 아무도 모르고, 이 판은 통과 도장만 찍는 기계가 된다.
      결과.push({ 곳: 어긋.곳, 무엇: 어긋.무엇, 판정: '못잼', 까닭: `찾을것이 ${몇번}군데 (하나여야 합니다)` });
      못잰것++;
      continue;
    }
    if (!맨것.get(어긋.검사)) {
      결과.push({ 곳: 어긋.곳, 무엇: 어긋.무엇, 판정: '못잼', 까닭: `${어긋.검사} 가 어긋내기 전부터 빨갛습니다` });
      못잰것++;
      continue;
    }

    writeFileSync(파일, 원본.replace(어긋.찾을것, 어긋.바꿀것), 'utf8');
    let r;
    try { r = 돌리기(어긋.검사); } finally { writeFileSync(파일, 원본, 'utf8'); }

    결과.push({
      곳: 어긋.곳, 무엇: 어긋.무엇, 그러면: 어긋.그러면, 검사: 어긋.검사,
      판정: r.code === 0 ? '샜음' : '잡음',
      걸린: r.걸린,
    });
  }
} finally {
  try { rmSync(일터, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch { /* 못 치워도 결과는 낸다 */ }
}

// ── 내놓기 ──────────────────────────────────────────────────────────────
const 샌것 = 결과.filter((x) => x.판정 === '샜음');
const 잡은것 = 결과.filter((x) => x.판정 === '잡음');

for (const x of 결과) {
  if (x.판정 === '잡음') {
    말(`  ${색(G, '✓')} ${x.무엇}  ${색(D, `${x.곳} → ${x.검사} 가 잡았습니다 · ${(x.걸린 / 1000).toFixed(1)}초`)}`);
  } else if (x.판정 === '샜음') {
    말(`  ${색(R, '✗')} ${x.무엇}  ${색(D, x.곳)}`);
    말(`      ${색(R, `${x.검사} 가 그대로 초록입니다 — 이 줄을 지우는 사람을 아무도 안 막습니다.`)}`);
    말(`      ${색(D, x.그러면)}`);
  } else {
    말(`  ${색(Y, '⚠')} ${x.무엇}  ${색(D, `${x.곳} — ${x.까닭}`)}`);
  }
}

말('');
말(`  ${잡은것.length}개 잡음 · ${샌것.length}개 샜음${못잰것 ? ` · ${못잰것}개 못 잼` : ''}`);
말('');

if (json) {
  console.log(JSON.stringify({ 잡음: 잡은것.length, 샜음: 샌것.length, 못잼: 못잰것, 결과 }, null, 2));
}

// 샌 것도 못 잰 것도 실패다. 못 잰 것을 통과로 넘기면 목록이 낡아도 초록이 뜬다.
process.exitCode = (샌것.length || 못잰것) ? 1 : 0;
