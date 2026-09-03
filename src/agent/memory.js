/**
 * 기억 — 대화가 끝나도 남는 것.
 *
 * 왜 필요한가:
 *   대화는 켤 때마다 처음부터다. 그래서 매번 같은 것을 설명하게 된다 —
 *   "우리 문서는 CP949 다", "검증 포트로 7080 은 쓰지 마라", "빌드는 npm run b".
 *   /compact 로 접히면 그마저 사라진다. 사람은 두 번째부터 짜증이 나고,
 *   세 번째부터는 그냥 안 쓴다.
 *
 *   지난 대화 찾기(recall.js)와는 다른 물건이다. 그쪽은 **찾아야** 나오고,
 *   이쪽은 **처음부터 들어가 있다.** 매번 찾으라고 할 수 없는 것 —
 *   지켜야 하는 규칙, 되풀이하면 안 되는 실수 — 이 여기 온다.
 *
 * 어디에 두나:
 *   .deel/memory.md — 사람이 열어 고칠 수 있는 글이다. 데이터베이스가 아니다.
 *   이게 중요하다. 모델이 잘못 적은 것을 사람이 지울 수 있어야 한다.
 *   틀린 기억은 없느니만 못하다 — 매 요청에 실려 계속 틀리게 만든다.
 *
 * 왜 상한을 두나:
 *   기억은 **매 요청마다** 통째로 나간다. 백 줄이면 백 줄이 매번 나간다.
 *   그래서 자리를 정해 두고, 넘으면 넘었다고 말한다.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// 기억 전체가 차지할 수 있는 최대 글자.
//
// 한글은 **글자당 1토큰**으로 센다(session.js 의 estimateTokens). 그래서 다
// 채우면 2,000 이 아니라 6,000토큰쯤이고, 그게 매 요청마다 통째로 나간다.
// 이 숫자를 낮게 적어 두면 그 차이만큼을 아무도 안 세게 된다.
export const 기억최대 = 6000;
// 한 줄이 이보다 길면 자른다. 모델이 파일을 통째로 기억에 넣으려 드는 일이 있다.
export const 한줄최대 = 400;
// 줄 수 상한. 자리가 남아도 이보다 많으면 사람이 못 읽는다.
export const 줄최대 = 60;

export const 자리 = (root) => join(root, '.deel', 'memory.md');

const 머리말 = `# 기억

이 파일은 deel 이 대화 사이에 들고 다니는 메모입니다.
매 요청마다 모델에게 통째로 실려 나갑니다 — 그러니 짧게, 오래 갈 것만 적습니다.

직접 고치셔도 됩니다. 틀린 줄은 지우세요. 지우면 그걸로 끝입니다.
`;

/** 파일에서 기억 줄을 읽어 온다. 머리말과 빈 줄은 뺀다. */
export function 읽기(root) {
  const p = 자리(root);
  if (!existsSync(p)) return { 줄들: [], 자리: p, 있음: false };
  let 글;
  try { 글 = readFileSync(p, 'utf8'); } catch { return { 줄들: [], 자리: p, 있음: false }; }
  const 줄들 = [];
  for (const raw of 글.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('#')) continue;                 // 머리말
    if (l.startsWith('이 파일은') || l.startsWith('매 요청마다')) continue;
    if (l.startsWith('직접 고치셔도') || l.startsWith('직접 고치')) continue;
    줄들.push(l.replace(/^[-*]\s*/, ''));            // 목록 표시는 떼고 담는다
  }
  return { 줄들, 자리: p, 있음: true };
}

/** 줄들을 파일로 되돌려 쓴다. */
export function 쓰기(root, 줄들) {
  const p = 자리(root);
  mkdirSync(dirname(p), { recursive: true });
  const 몸 = 줄들.map((l) => `- ${l}`).join('\n');
  writeFileSync(p, `${머리말}\n${몸}\n`, 'utf8');
  return p;
}

/**
 * 한 줄을 더한다.
 *
 * 이미 있는 것과 거의 같으면 안 더한다. 안 그러면 같은 말이 조금씩 다른 꼴로
 * 스무 줄 쌓인다 — 모델은 자기가 방금 적은 것을 기억 못 하기 때문이다.
 *
 * @returns {{ok: boolean, why?: string, 줄: string, 줄수: number, 넘침?: boolean}}
 */
export function 더하기(root, 글) {
  const 줄 = 다듬기(글);
  if (!줄) return { ok: false, why: '적을 내용이 비었습니다', 줄: '', 줄수: 0 };

  const { 줄들 } = 읽기(root);
  if (줄들.some((x) => 같은말(x, 줄))) {
    return { ok: false, why: '이미 기억하고 있습니다', 줄, 줄수: 줄들.length };
  }

  const 새것 = [...줄들, 줄];
  // 자리가 넘치면 **오래된 것부터** 뺀다. 최근에 정한 것이 대개 맞다.
  let 넘침 = false;
  while (새것.length > 줄최대 || 새것.join('\n').length > 기억최대) {
    if (새것.length <= 1) break;
    새것.shift();
    넘침 = true;
  }
  쓰기(root, 새것);
  return { ok: true, 줄, 줄수: 새것.length, 넘침 };
}

/** 번호로 지운다(1부터). 사람이 /memory 화면을 보고 고르는 자리다. */
export function 지우기(root, 번호) {
  const { 줄들 } = 읽기(root);
  const i = Number(번호) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= 줄들.length) return { ok: false, why: '그런 번호가 없습니다' };
  const 뺀것 = 줄들[i];
  const 남은것 = 줄들.filter((_, n) => n !== i);
  쓰기(root, 남은것);
  return { ok: true, 뺀것, 줄수: 남은것.length };
}

/** 통째로 비운다. */
export function 비우기(root) {
  쓰기(root, []);
  return { ok: true };
}

/** 한 줄로 다듬는다 — 줄바꿈을 없애고 길이를 자른다. */
function 다듬기(글) {
  let s = String(글 ?? '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[-*]\s*/, '');
  if (s.length > 한줄최대) s = s.slice(0, 한줄최대) + '…';
  return s;
}

/**
 * 두 줄이 사실상 같은 말인가.
 *
 * 글자 그대로 비교하면 "CP949 를 쓴다" 와 "CP949를 쓴다" 가 다른 줄이 된다.
 * 공백·조사·문장부호를 털고 견준다. 완벽할 필요는 없다 —
 * 여기서 하려는 것은 '똑같은 말이 쌓이는 것' 을 막는 것뿐이다.
 */
function 같은말(a, b) {
  const 털기 = (s) => String(s).toLowerCase().replace(/[\s.,!?~·'"()[\]]/g, '');
  const x = 털기(a);
  const y = 털기(b);
  if (x === y) return true;
  // 한쪽이 다른 쪽을 통째로 품고 있고 길이 차가 크지 않으면 같은 말로 본다.
  const [짧, 긴] = x.length <= y.length ? [x, y] : [y, x];
  return 짧.length >= 8 && 긴.includes(짧) && 긴.length - 짧.length <= 짧.length * 0.5;
}

/**
 * 시스템 프롬프트에 넣을 토막.
 *
 * 없으면 빈 글을 돌려준다 — "기억: (없음)" 같은 줄을 넣으면 그 자체가
 * 매 요청마다 나가는 쓰레기가 된다.
 */
export function 프롬프트토막(root) {
  const { 줄들 } = 읽기(root);
  if (!줄들.length) return '';
  return '\n--- 기억 (지난 대화에서 정한 것. 사용자가 다시 말하지 않아도 지킨다) ---\n'
    + 줄들.map((l) => `- ${l}`).join('\n');
}
