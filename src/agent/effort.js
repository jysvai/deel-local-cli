// 추론 강도를 '한 값' 이 아니라 '단계별' 로 나눈다.
//
// 왜 나누나:
//   에이전트 한 번의 대답은 모델을 여러 번 부른다. 그런데 부를 때마다 필요한 생각의 양이 다르다.
//   - 처음: 무엇을 할지 정한다. 여기서 틀리면 뒤가 전부 헛돈다. → 세게
//   - 중간: 파일을 읽고 "그래서 다음 한 수" 만 둔다. → 얕아도 된다
//   - 막힘: 도구가 오류를 냈다. 얕게 생각하면 같은 실수를 또 한다. → 세게
//   전부 똑같이 세게 두면 느리고, 전부 얕게 두면 엉뚱한 길로 간다.

export const LEVELS = ['off', 'low', 'medium', 'high', 'max'];

export const STAGES = {
  plan: { label: '첫 판단', why: '무엇을 할지 정하는 자리' },
  work: { label: '이어가기', why: '도구 결과를 읽고 다음 한 수' },
  fix: { label: '막혔을 때', why: '직전 도구가 오류를 냄' },
};

// shift = 기준 강도에서 몇 칸 올리고 내릴지.  cap = 그 단계의 출력 토큰 상한.
export const PROFILES = {
  even: {
    name: '균일',
    desc: '모든 단계 같은 강도 — 예측 가능한 대신 느립니다',
    shift: { plan: 0, work: 0, fix: 0 },
    cap: { plan: 4096, work: 4096, fix: 4096 },
  },
  save: {
    name: '절약',
    desc: '첫 판단만 세게, 이어가기는 얕게 — 대개 이게 낫습니다',
    shift: { plan: 0, work: -1, fix: +1 },
    cap: { plan: 4096, work: 2048, fix: 4096 },
  },
  deep: {
    name: '깊게',
    desc: '전 단계 한 칸씩 위로 — 어려운 일에만',
    shift: { plan: +1, work: 0, fix: +1 },
    cap: { plan: 6144, work: 4096, fix: 6144 },
  },
};

const ALIAS = { 균일: 'even', 절약: 'save', 깊게: 'deep', uniform: 'even', thrifty: 'save' };

export function normalizeProfile(v) {
  const k = String(v ?? '').trim().toLowerCase();
  return PROFILES[k] ? k : (ALIAS[String(v ?? '').trim()] ?? null);
}

// 기준 강도에서 몇 칸 옮긴다. 끝을 넘지 않는다.
export function shiftLevel(level, by) {
  const i = LEVELS.indexOf(level);
  if (i < 0) return level;
  return LEVELS[Math.min(LEVELS.length - 1, Math.max(0, i + by))];
}

/**
 * 이번 호출에 쓸 강도.
 * off 는 사람이 "생각 끄기" 를 고른 것이므로 어떤 단계에서도 켜지 않는다.
 */
export function effortFor(base, profileKey, stage) {
  if (base === 'off') return 'off';
  const p = PROFILES[normalizeProfile(profileKey) ?? 'save'];
  return shiftLevel(base, p.shift[stage] ?? 0);
}

export function tokensFor(profileKey, stage) {
  const p = PROFILES[normalizeProfile(profileKey) ?? 'save'];
  return p.cap[stage] ?? 4096;
}

// 잘린 응답인가. 잘린 채로 넘어가면 도구 호출이 반토막 나서 조용히 실패한다.
export function wasCut(msg) {
  const s = String(msg?.stopped ?? '');
  return s === 'length' || s === 'max_tokens' || s === 'MAX_TOKENS';
}

// 화면에 보여줄 표.
export function table(base, profileKey) {
  const key = normalizeProfile(profileKey) ?? 'save';
  const p = PROFILES[key];
  return {
    key,
    name: p.name,
    desc: p.desc,
    rows: Object.entries(STAGES).map(([stage, s]) => ({
      stage,
      label: s.label,
      why: s.why,
      level: effortFor(base, key, stage),
      cap: p.cap[stage],
      moved: p.shift[stage],
    })),
  };
}
