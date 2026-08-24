// 편집 대상 찾기. 모델이 공백·들여쓰기·줄바꿈을 조금 틀려도 찾아낸다.
//
// 원칙: 느슨하게 찾되 **모호하면 무조건 거부**한다.
// 엉뚱한 곳을 조용히 고치는 것이 못 찾는 것보다 훨씬 나쁘다.
// 그래서 각 단계는 "정확히 한 곳"일 때만 통과시킨다.

const TIERS = [
  { id: 'exact',  label: '정확히 일치' },
  { id: 'trail',  label: '줄 끝 공백·줄바꿈 차이 무시' },
  { id: 'indent', label: '들여쓰기 차이 무시' },
  { id: 'space',  label: '모든 공백 차이 무시' },
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function pattern(needle, tier) {
  const lines = needle.split(/\r?\n/);
  switch (tier) {
    case 'trail':
      // 줄 끝 공백과 CRLF/LF 차이를 흡수한다.
      return lines.map((l) => esc(l.replace(/[ \t]+$/, ''))).join('[ \\t]*\\r?\\n');
    case 'indent':
      // 줄 앞 들여쓰기까지 흡수한다.
      return '[ \\t]*' + lines.map((l) => esc(l.trim())).join('[ \\t]*\\r?\\n[ \\t]*');
    case 'space':
      // 공백이라면 종류·개수를 가리지 않는다.
      return esc(needle).replace(/\s+/g, '\\s+');
    default:
      return null;
  }
}

// 찾은 자리들을 모두 돌려준다.
function findAll(text, needle, tier) {
  if (tier === 'exact') {
    const out = [];
    let i = 0;
    while ((i = text.indexOf(needle, i)) >= 0) {
      out.push({ start: i, end: i + needle.length });
      i += needle.length || 1;
    }
    return out;
  }
  const p = pattern(needle, tier);
  if (!p) return [];
  let re;
  try { re = new RegExp(p, 'g'); } catch { return []; }
  const out = [];
  for (const m of text.matchAll(re)) {
    if (m[0].length === 0) continue;
    out.push({ start: m.index, end: m.index + m[0].length });
    if (out.length > 50) break;   // 너무 많으면 어차피 모호하다
  }
  return out;
}

/**
 * @returns {{ok:true, spans, tier, tierLabel}} 또는
 *          {{ok:false, reason, tier?, count?, near?}}
 */
export function findMatch(text, needle, { replaceAll = false } = {}) {
  if (!needle) return { ok: false, reason: 'empty' };

  for (const t of TIERS) {
    const spans = findAll(text, needle, t.id);
    if (!spans.length) continue;
    if (spans.length > 1 && !replaceAll) {
      return { ok: false, reason: 'ambiguous', tier: t.id, count: spans.length };
    }
    return { ok: true, spans, tier: t.id, tierLabel: t.label };
  }
  return { ok: false, reason: 'notfound', near: nearest(text, needle) };
}

// 못 찾았을 때, 모델이 스스로 고칠 수 있게 "가장 비슷한 줄"을 알려준다.
export function nearest(text, needle) {
  const key = String(needle).split(/\r?\n/).find((l) => l.trim()) ?? '';
  const probe = key.trim().replace(/\s+/g, ' ');
  if (probe.length < 4) return null;

  const lines = text.split(/\r?\n/);
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    const cand = lines[i].trim().replace(/\s+/g, ' ');
    if (!cand) continue;
    const s = similarity(probe, cand);
    if (!best || s > best.score) best = { score: s, line: i + 1, text: lines[i] };
  }
  return best && best.score >= 0.5 ? best : null;
}

// 두 글자씩 겹치는 비율. 정확할 필요는 없고 "이 줄인가?" 만 알면 된다.
function similarity(a, b) {
  if (a === b) return 1;
  const pairs = (s) => {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const p = s.slice(i, i + 2);
      out.set(p, (out.get(p) ?? 0) + 1);
    }
    return out;
  };
  const pa = pairs(a);
  const pb = pairs(b);
  let hit = 0;
  let total = 0;
  for (const [p, n] of pa) { total += n; hit += Math.min(n, pb.get(p) ?? 0); }
  for (const [, n] of pb) total += n;
  return total ? (2 * hit) / total : 0;
}

/**
 * 들여쓰기를 흡수해 찾았다면, 넣을 내용의 들여쓰기도 파일에 맞춰 준다.
 * 모델이 준 들여쓰기를 그대로 넣으면 코드가 어긋난다.
 * 다만 확신이 서는 경우에만 손댄다 — 어설피 고치면 더 나쁘다.
 */
export function reindent(newString, matchedText, needle) {
  const fileIndent = /^[ \t]*/.exec(matchedText)?.[0] ?? '';
  const needleIndent = /^[ \t]*/.exec(needle)?.[0] ?? '';
  if (fileIndent === needleIndent) return newString;

  const lines = newString.split('\n');
  // 넣을 내용의 모든 줄이 모델의 들여쓰기로 시작할 때만 갈아끼운다.
  const shiftable = lines.every((l, i) => i === 0 || !l.trim() || l.startsWith(needleIndent));
  if (!shiftable) return newString;

  return lines
    .map((l, i) => {
      if (i === 0) return fileIndent + l.replace(/^[ \t]*/, '');
      if (!l.trim()) return l;
      return fileIndent + l.slice(needleIndent.length);
    })
    .join('\n');
}

// 찾은 자리들을 실제로 바꾼다. 뒤에서부터 바꿔야 앞쪽 위치가 안 밀린다.
export function applySpans(text, spans, makeReplacement) {
  let out = text;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) {
    const matched = text.slice(s.start, s.end);
    out = out.slice(0, s.start) + makeReplacement(matched) + out.slice(s.end);
  }
  return out;
}

export const TIER_LABELS = Object.fromEntries(TIERS.map((t) => [t.id, t.label]));
