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
  { id: 'nfc',    label: '유니코드 정규화(NFC·NFD) 차이 무시' },
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function pattern(needle, tier) {
  const lines = needle.split(/\r?\n/);
  switch (tier) {
    case 'trail':
      // 줄 끝 공백과 CRLF/LF 차이를 흡수한다.
      return lines.map((l) => esc(l.replace(/[ \t]+$/, ''))).join('[ \\t]*\\r?\\n');
    case 'indent':
      // 줄 앞 들여쓰기까지 흡수한다. 다만 끝이 줄바꿈이면(마지막 조각이 빈 줄) 그 뒤는 **다음 줄**이라
      // 들여쓰기를 안 먹는다 — 먹으면 갈아 끼울 때 다음 줄이 들여쓰기를 잃었다 (6회차 Gemini 고침맞추기6).
      return lines
        .map((l, i) => (i > 0 && i === lines.length - 1 && !l.trim() ? '' : '[ \\t]*') + esc(l.trim()))
        .join('[ \\t]*\\r?\\n');
    case 'space': {
      // 공백이라면 종류·개수를 가리지 않는다. 다만 **끝** 공백은 그 안의 줄바꿈 수만큼만 본다 — `\s+` 가
      // 다음 줄 들여쓰기·빈 줄·줄바꿈까지 먹어 갈아 끼우면 사라졌다 (6회차 Gemini 고침맞추기6).
      const 꼬리 = /\s*$/.exec(needle)[0];
      const 몸 = esc(needle.slice(0, needle.length - 꼬리.length)).replace(/\s+/g, '\\s+');
      const 줄 = (꼬리.match(/\n/g) ?? []).length;
      if (줄) return 몸 + '[ \\t]*\\r?\\n'.repeat(줄);
      return 꼬리 ? `${몸}[ \\t]*(?=\\s|$)` : 몸;
    }
    default:
      return null;
  }
}

// 찾은 자리들을 모두 돌려준다.
//
// `전부` 는 replace_all 일 때다. 그때는 **정말 전부** 모은다 — 아래 상한 머리말.
function findAll(text, needle, tier, { 전부 = false } = {}) {
  if (tier === 'exact') {
    const out = [];
    let i = 0;
    while ((i = text.indexOf(needle, i)) >= 0) {
      out.push({ start: i, end: i + needle.length });
      // 모호한지 볼 때는 **겹친 자리도** 센다. 겹치지 않게만 세면 `}\n}\n}` 안의 `}\n}` 두 자리가 한 곳으로
      // 잡혀 첫 자리를 조용히 고쳤다 (6회차 Gemini 고침맞추기6). replace_all 은 여태처럼 안 겹치게 바꾼다.
      i += 전부 ? needle.length || 1 : 1;
    }
    return out;
  }
  if (tier === 'nfc') return 정규화로찾기(text, needle, 전부);
  const p = pattern(needle, tier);
  if (!p) return [];
  let re;
  try { re = new RegExp(p, 'g'); } catch { return []; }
  const out = [];
  // 만들 때 말고 **돌릴 때** 터지는 것이 있다.
  //
  // 모델은 큰 파일을 고칠 때 덩이를 통째로 old_string 에 담아 보낸다. 4만 자쯤
  // 넘어가면 new RegExp 는 멀쩡히 만들어지는데(패턴만 훑는다) 실제로 돌릴 때
  // 프로그램 크기 한도에 걸려 SyntaxError 가 난다. 위의 try 는 만들 때만 감싸므로
  // 그 오류가 그대로 튀어나가서 "찾지 못했습니다" 대신 도구가 죽었다.
  //
  // 여기서는 못 찾은 것으로 친다. 정확히 일치하는 경우는 위에서 indexOf 로 이미
  // 처리했으니, 느슨하게 맞춰 보는 이 길만 포기하는 것이다.
  try {
    if (전부) {
      // replace_all 은 여태처럼 **안 겹치게** 걷는다 — 바꿀 자리를 고르는 길이다.
      for (const m of text.matchAll(re)) {
        if (m[0].length === 0) continue;
        out.push({ start: m.index, end: m.index + m[0].length });
      }
    } else {
      /*
       * ── 모호한지 볼 때는 **겹친 자리도** 센다 (6회차 고침맞추기6dq G2) ──
       *
       * 위 「정확히」 단계는 `i += 1` 로 겹친 자리까지 세어 `}\n}\n}` 안의
       * `}\n}` 두 자리를 모호로 막는다. 그런데 여기는 `matchAll` 이라 한 번
       * 맞으면 그 끝까지 건너뛴다 — 같은 글에 들여쓰기만 붙으면(`  }` 세 줄,
       * 파이썬·중괄호 닫는 줄에서 흔한 꼴) 두 자리 중 앞엣것 하나만 잡히고
       * **조용히 첫 자리를 고쳤다.** 못 찾는 것보다 엉뚱한 곳을 고치는 것이
       * 나쁘다는 이 파일의 원칙이 단계마다 달랐던 자리다.
       *
       * `exec` 로 한 칸씩 밀며 걷는다. 빈 맞춤은 제자리걸음이 되므로 건너뛴다.
       *
       * 다만 **끝자리가 같은 것은 한 자리다.** 이 단계의 무늬는 `[ \t]*` 로 시작해서
       * `  foo` 의 0·1·2 어디서 시작해도 같은 자리에 닿는다 — 그걸 따로 세면 들여쓴
       * 줄은 죄다 「2군데」 가 되어, 조이려던 것이 **멀쩡한 고치기를 다 막는다.**
       * 먼저 나온 것(가장 이른 시작)을 남긴다 — matchAll 이 주던 자리와 같다.
       */
      const 끝본것 = new Set();
      for (let i = 0; i <= text.length;) {
        re.lastIndex = i;
        const m = re.exec(text);
        if (!m) break;
        const 끝 = m.index + m[0].length;
        if (m[0].length > 0 && !끝본것.has(끝)) { 끝본것.add(끝); out.push({ start: m.index, end: 끝 }); }
        /*
         * ── 이 상한은 **모호한지 볼 때만** 쓴다 ──────────────────────────
         *
         * 「너무 많으면 어차피 모호하다」 는 replace_all 이 아닐 때의 말이다.
         * 그런데 replace_all 에도 똑같이 걸려서, 공백만 조금 달라 느슨하게 맞은
         * 100군데 중 **51군데만** 바꾸고 「고침: (51군데)」 라고 답했다.
         * 나머지 49군데는 그대로인데 모델은 다 바꾼 줄 알고 넘어간다. 정확히
         * 맞은 경우(indexOf 길)는 상한이 없어서 느슨한 길에서만 새던 자리다.
         */
        if (out.length > 50) break;
        i = m.index + 1;
      }
    }
  } catch { return []; }
  return out;
}

/*
 * ── 눈에는 같은 글자인데 **코드가 다른** 글 (NFC · NFD) ──────────────────
 *
 * 맥에서 만든 파일, 맥 파일 이름을 옮겨 적은 글, 일부 PDF 에서 긁은 글은 한글이
 * 자모로 풀린 꼴(NFD — ㅎ+ㅏ+ㄴ)로 들어 있다. 모델은 늘 모아 쓴 꼴(NFC)로
 * 적는다. 화면에는 둘 다 「한글」 인데 indexOf 도 위 느슨한 단계도 못 찾아서,
 * 모델은 「찾지 못했습니다」 를 받고 Read 로 다시 읽고 **같은 글자로** 또 보내며
 * 헛돌았다. `é` 를 e + ◌́ 로 적은 글도 같다. 공백은 흡수하면서 이건 못 했다.
 *
 * 둘 다 NFD 로 풀어 견준다. 풀기는 글자마다 따로 되고 결합 표시의 순서만
 * 제자리에서 바뀌므로, **결합하는 글자가 아닌 자리**에서 시작하고 끝나는 곳은
 * 원래 글의 자리로 되짚을 수 있다. 글자 한가운데(모음 자모 하나 · 결합 표시
 * 하나)에서 시작하거나 끝나는 곳은 버린다 — 그걸 고치면 글자가 쪼개진다.
 * 되짚은 자리는 한 번 더 정규화해 견주어 확인한다. 모호하면 거부하는 것은
 * 다른 단계와 같다.
 */
const 결합하는글자 = /^[\p{M}ᅠ-ᇿힰ-퟿]/u;

function 정규화로찾기(text, needle, 전부) {
  const 풀린글 = text.normalize('NFD');
  const 풀린바늘 = needle.normalize('NFD');
  // 둘 다 이미 풀린 꼴이면 위 「정확히」 단계가 이미 본 것이다.
  if (!풀린바늘 || (풀린글 === text && 풀린바늘 === needle)) return [];
  // 바늘이 결합하는 글자로 시작하면 어느 자리든 글자 한가운데서 시작한다 (「아각」 의 ㅏ+각).
  if (결합하는글자.test(풀린바늘)) return [];

  const 자리들 = [];
  for (let i = 풀린글.indexOf(풀린바늘); i >= 0; i = 풀린글.indexOf(풀린바늘, i + 1)) {
    const 끝 = i + 풀린바늘.length;
    // 바로 뒤가 결합하는 글자면 글자 한가운데서 끝난다 — 「각」 안의 「가」 를 고치면 받침이 딴 글자에 붙는다.
    if (끝 < 풀린글.length && 결합하는글자.test(풀린글.slice(끝, 끝 + 1))) continue;
    자리들.push([i, 끝]);
    // 정확히 단계와 같다 — replace_all 이 아니면 겹친 자리도 세어 모호함을 가린다.
    if (전부) i = 끝 - 1;
    if (!전부 && 자리들.length > 50) break;
  }
  if (!자리들.length) return [];

  // 풀린 글의 자리 → 원래 글의 자리. 글자(코드포인트)마다 풀린 길이를 더해 간다.
  const 필요 = new Set(자리들.flat());
  const 맨끝 = 자리들[자리들.length - 1][1];
  const 되짚기 = new Map();
  const 풀린길이 = new Map();
  let t = 0;
  let k = 0;
  for (;;) {
    if (필요.has(t) && !되짚기.has(t)) 되짚기.set(t, k);
    if (k >= text.length || t >= 맨끝) break;
    const cp = text.codePointAt(k);
    const 폭 = cp > 0xFFFF ? 2 : 1;
    let d = 폭;
    if (cp >= 0xC0) {
      d = 풀린길이.get(cp);
      if (d === undefined) { d = String.fromCodePoint(cp).normalize('NFD').length; 풀린길이.set(cp, d); }
    }
    k += 폭;
    t += d;
  }
  const 모은꼴 = needle.normalize('NFC');
  const out = [];
  for (const [i, 끝] of 자리들) {
    const start = 되짚기.get(i);
    const end = 되짚기.get(끝);
    if (start === undefined || end === undefined || end <= start) continue;
    if (text.slice(start, end).normalize('NFC') !== 모은꼴) continue;
    out.push({ start, end });
  }
  return out;
}

/**
 * 정규화 단계로 찾았으면 넣는 글도 **파일이 쓰는 꼴**로 맞춘다.
 *
 * NFD 파일 한가운데에 NFC 글을 넣으면 같은 파일 안에 두 꼴이 섞인다 — 다음
 * 고치기에서 또 못 찾고, 맥의 파일 비교 도구는 멀쩡한 줄을 바뀌었다고 한다.
 * 찾은 자리가 한 꼴로만 되어 있을 때만 맞춘다. 섞였으면 그대로 둔다.
 */
export function 꼴맞추기(newString, matched) {
  const 풀린 = matched.normalize('NFD');
  const 모은 = matched.normalize('NFC');
  if (풀린 === 모은) return newString;
  if (matched === 풀린) return newString.normalize('NFD');
  if (matched === 모은) return newString.normalize('NFC');
  return newString;
}

/**
 * @returns {{ok:true, spans, tier, tierLabel}} 또는
 *          {{ok:false, reason, tier?, count?, near?}}
 */
export function findMatch(text, needle, { replaceAll = false } = {}) {
  if (!needle) return { ok: false, reason: 'empty' };

  for (const t of TIERS) {
    const spans = findAll(text, needle, t.id, { 전부: replaceAll });
    if (!spans.length) continue;
    if (spans.length > 1 && !replaceAll) {
      return { ok: false, reason: 'ambiguous', tier: t.id, count: spans.length };
    }
    return { ok: true, spans, tier: t.id, tierLabel: t.label };
  }
  return { ok: false, reason: 'notfound', near: nearest(text, needle) };
}

// 못 찾았을 때, 모델이 스스로 고칠 수 있게 "가장 비슷한 줄"을 알려준다.
function nearest(text, needle) {
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

  const 더들여쓰기 = 단위바꾸개(fileIndent, needleIndent);
  return lines
    .map((l, i) => {
      if (i === 0) return fileIndent + l.replace(/^[ \t]*/, '');
      if (!l.trim()) return l;
      const 나머지 = l.slice(needleIndent.length);
      const 더 = /^[ \t]*/.exec(나머지)[0];
      return fileIndent + 더들여쓰기(더) + 나머지.slice(더.length);
    })
    .join('\n');
}

/*
 * ── 바깥 들여쓰기만 갈아 끼우면 **안쪽이 섞인다** ─────────────────────────
 *
 * 위 reindent 는 줄 앞의 「모델 들여쓰기」 를 「파일 들여쓰기」 로 바꾸기만
 * 했다. 탭으로 쓴 파일에 모델이 네 칸 공백으로 적어 보내면 이렇게 됐다:
 *
 *     파일      \tif (x) {\n\t\treturn 1;
 *     모델      ····if (y) {\n········return 2;
 *     넣은 것   \tif (y) {\n\t····return 2;     ← 탭 뒤에 공백 넷
 *
 * 바깥 한 단만 탭이고 그 안쪽 한 단은 모델의 공백이 그대로 남는다. 파이썬이면
 * 그 자리에서 TabError 고, 아니어도 편집기마다 들여쓰기가 달리 보인다.
 *
 * 모델 들여쓰기와 파일 들여쓰기가 **한 종류씩**이고(탭만 · 공백만) 나누어
 * 떨어질 때만 한 단의 폭을 알 수 있다 — 탭 하나를 모델이 몇 칸으로 적었나.
 * 그 폭으로 안쪽 들여쓰기도 옮긴다. 폭을 모르면(바깥이 비었거나 섞였으면)
 * 여태처럼 그대로 둔다. 어설피 고치면 더 나쁘다는 위 머리말과 같은 자세다.
 */
function 단위바꾸개(fileIndent, needleIndent) {
  const 탭만 = (s) => /^\t+$/.test(s);
  const 칸만 = (s) => /^ +$/.test(s);
  if (탭만(fileIndent) && 칸만(needleIndent) && needleIndent.length % fileIndent.length === 0) {
    const 폭 = needleIndent.length / fileIndent.length;
    return (더) => (칸만(더) ? '\t'.repeat(Math.floor(더.length / 폭)) + ' '.repeat(더.length % 폭) : 더);
  }
  if (칸만(fileIndent) && 탭만(needleIndent) && fileIndent.length % needleIndent.length === 0) {
    const 폭 = fileIndent.length / needleIndent.length;
    return (더) => (탭만(더) ? ' '.repeat(더.length * 폭) : 더);
  }
  return (더) => 더;
}

/*
 * ── 넣는 글의 줄끝은 **파일의 줄끝**을 따른다 ────────────────────────────
 *
 * 모델은 줄바꿈을 늘 `\n` 으로 적는다. 느슨하게 찾는 길(trail)은 그 차이를
 * 흡수해서 CRLF 파일에서도 자리를 찾아 주는데, 넣는 쪽은 모델이 준 `\n` 을
 * 그대로 넣었다. 그래서 `.bat` 두 줄을 세 줄로 고치면 —
 *
 *     @echo off\r\n set A=10\n set B=20\n set C=30\r\n goto :end\r\n
 *
 * 고친 자리만 LF 인 파일이 된다. cmd.exe 는 LF 만 있는 줄에서 레이블(goto)을
 * 헛짚고, git 은 줄마다 바뀌었다고 하고, /diff 에는 글자가 같아 안 보인다.
 *
 * CRLF **만** 쓰는 파일일 때만 맞춘다. 이미 섞인 파일은 어느 쪽이 맞는지
 * 모르니 손대지 않는다.
 */
export function CRLF뿐인가(text) {
  const t = String(text ?? '');
  return t.includes('\r\n') && !/(^|[^\r])\n/.test(t);
}

export function CRLF로(s) {
  return String(s).replace(/\r?\n/g, '\r\n');
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
