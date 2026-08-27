/**
 * 나눈 뒤 손보기 — 옮기고 나면 어긋나는 것들만 고친다.
 *
 *   · 릴리스 노트: 판 번호가 제목이 되어야 링크가 걸린다(`#140`).
 *   · "위 ⋯ 를 보세요" 는 옮긴 뒤 거짓말이 된다 — 그 절이 이제 위에 없다.
 *     쪽 이름으로 바꿔 준다.
 *
 * split-docs.mjs 를 다시 돌렸으면 이것도 다시 돌린다.
 */
import { readFileSync, writeFileSync } from 'node:fs';

function 고치기(자리, 바꿈) {
  let s = readFileSync(자리, 'utf8');
  for (const [a, b] of 바꿈) {
    if (a instanceof RegExp) { s = s.replace(a, b); continue; }
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${자리} 못 찾음(${n}): ${String(a).slice(0, 50)}`);
    s = s.replace(a, b);
  }
  writeFileSync(자리, s, 'utf8');
  console.log(`  ${자리}`);
}

// ── 릴리스 노트: 판 번호를 제목으로 ─────────────────────────────────────
for (const [자리, 머리] of [['docs/ko/releases.md', '릴리스 노트'], ['docs/en/releases.md', 'Release notes']]) {
  let s = readFileSync(자리, 'utf8');
  s = s.replace(`## ${머리}\n\n`, '');
  // `### ▸ 1.4.0 — 제목 · 곁말` → `## 1.4.0` + 제목 줄
  s = s.replace(/^### ▸ (\d+\.\d+\.\d+) — (.+)$/gm, (_, 판, 나머지) => `## ${판}\n\n**${나머지.replace(/\s·\s[^·]*$/, '')}**`);
  writeFileSync(자리, s, 'utf8');
  console.log(`  ${자리}`);
}

// ── 옮기고 나면 거짓이 되는 안내 ────────────────────────────────────────
고치기('docs/ko/releases.md', [
  ['위 "언어 서버가 있으면 뜻까지 봅니다" 를 보세요.', '[도구 자세히](tools.md) 의 "언어 서버가 있으면 뜻까지 봅니다" 를 보세요.'],
  ['위 "한글·워드·파워포인트 — 글로 읽습니다" 를 보세요.', '[한글 문서와 엑셀](documents.md) 을 보세요.'],
  ['위 "로컬 모델의 숨은 지연 — 프리픽스 캐시를 지킵니다" 를 보세요.', '[속도와 씀씀이](tuning.md) 의 "로컬 모델의 숨은 지연" 을 보세요.'],
  ['위 "국산 모델은 겪기 전에 압니다" 를 보세요.', '[모델 다루기](models.md) 의 "국산 모델은 겪기 전에 압니다" 를 보세요.'],
]);

고치기('docs/en/releases.md', [
  ['See "With a language server, it sees meaning" above.', 'See "With a language server, it sees meaning" in [Tools in depth](tools.md).'],
  ['See "HWP, Word, PowerPoint — read as text" above.', 'See [Korean documents and Excel](documents.md).'],
  ['See "The hidden latency of local models" above.', 'See "The hidden latency of local models" in [Speed and spend](tuning.md).'],
  ['See "Korean models are known before they are experienced" above.', 'See "Korean models are known before they are experienced" in [Models](models.md).'],
]);
