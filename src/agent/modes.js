// 작업 모드. 지금 무슨 일을 하는 중인지에 따라 도구·추론·말투를 한꺼번에 바꾼다.
//
// 승인 정책(auto/confirm/strict)과는 다른 축이다. 헷갈리면 안 된다.
//   승인 정책 = 얼마나 물어보나
//   작업 모드 = 무슨 일을 하는 중인가
// 둘은 곱해진다. '설계 모드 + strict' 도, '코드 모드 + auto' 도 말이 된다.
//
// 왜 도구를 아예 빼는가:
//   설계 모드에서 파일을 고치면 안 된다고 프롬프트로 부탁할 수도 있다.
//   그런데 모델은 부탁을 잊는다. 아예 목록에서 빼면 잊을 것이 없다.
//   오프라인일 때 웹 도구를 숨기는 것과 같은 방식이다.

// 읽기만 하는 도구. 무엇을 바꾸지 않는다.
const 읽기 = ['Read', 'Glob', 'Grep', 'WebFetch', 'Skill'];
// 계획을 적는 도구. 파일을 안 건드리므로 읽기 전용 모드에서도 준다.
const 계획 = ['TodoWrite'];
// 바꾸는 도구.
const 쓰기 = ['Write', 'Edit', 'Bash'];

export const MODES = {
  code: {
    id: 'code',
    name: '코드',
    en: 'Code',
    glyph: '◆',
    hint: '고치고 만든다',
    tools: [...읽기, ...계획, ...쓰기],
    effort: 'save',            // 첫 판단만 세게, 이어가기는 얕게
    think: null,               // 사용자가 정한 값을 그대로 쓴다
    steps: 24,
    say: '코드를 읽고 고칩니다. 고치기 전에 반드시 먼저 읽으세요.',
  },

  architect: {
    id: 'architect',
    name: '설계',
    en: 'Architect',
    glyph: '◈',
    hint: '구조를 짠다 · 파일은 안 건드림',
    tools: [...읽기, ...계획],
    effort: 'deep',
    think: 'high',
    steps: 20,
    say: '구조와 설계를 다룹니다. 파일을 바꾸는 도구는 주어지지 않았습니다. '
       + '지금 코드를 충분히 읽고, 어디를 어떻게 바꿀지 근거와 함께 제안하세요. '
       + '고르는 이유와 버리는 이유를 같이 적으세요.',
  },

  ask: {
    id: 'ask',
    name: '묻기',
    en: 'Ask',
    glyph: '◇',
    hint: '설명만 · 아무것도 안 바꿈',
    tools: [...읽기],
    effort: 'even',
    think: 'low',
    steps: 8,
    say: '질문에 답하고 설명합니다. 시키지 않은 일을 벌이지 마세요. '
       + '코드를 읽어 근거를 대되, 고치라는 말이 없으면 고칠 것을 제안하지 마세요.',
  },

  debug: {
    id: 'debug',
    name: '디버그',
    en: 'Debug',
    glyph: '◉',
    hint: '원인을 찾는다',
    tools: [...읽기, ...계획, ...쓰기],
    effort: 'deep',
    think: 'high',
    steps: 32,               // 원인 찾기는 왔다 갔다 하므로 여유를 준다
    say: '무엇이 잘못됐는지 찾습니다. 고치기 전에 원인을 먼저 밝히세요. '
       + '짐작으로 고치지 말고, 확인할 수 있는 것을 확인하세요 — 로그를 보고, '
       + '작은 것을 실제로 돌려 보고, 무엇이 사실인지 말한 다음 고치세요.',
  },

  plan: {
    id: 'plan',
    name: '계획',
    en: 'Plan',
    glyph: '☰',
    hint: '먼저 계획 · 승인 뒤 실행',
    tools: [...읽기, ...계획],
    effort: 'deep',
    think: 'high',
    steps: 16,
    say: '먼저 계획만 세웁니다. 파일을 바꾸는 도구는 주어지지 않았습니다. '
       + '무엇을 어떤 순서로 할지, 위험이 무엇인지 적고 멈추세요. '
       + '사용자가 승인하면 그때 코드 모드로 바뀝니다.',
  },

  orchestrator: {
    id: 'orchestrator',
    name: '총괄',
    en: 'Orchestrator',
    glyph: '❋',
    hint: '큰 일을 쪼개서 끝까지',
    tools: [...읽기, ...계획, ...쓰기],
    effort: 'save',
    think: null,
    steps: 40,               // 여러 갈래를 끝까지 끌고 가야 한다
    say: '여러 단계가 걸리는 일을 끝까지 끌고 갑니다. '
       + '먼저 TodoWrite 로 할 일을 쪼개 적고, 하나씩 끝낼 때마다 갱신하세요. '
       + '한 번에 하나만 진행 중으로 두세요. 다 끝나면 무엇을 했는지 요약하세요.',
  },
};

export const ORDER = ['code', 'plan', 'architect', 'debug', 'ask', 'orchestrator'];
export const DEFAULT = 'code';

/** 이름을 관대하게 받는다. 한글·영문·줄임말 다 통한다. */
export function normalize(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (MODES[s]) return s;
  const 별명 = {
    '코드': 'code', 'c': 'code',
    '계획': 'plan', '플랜': 'plan', 'p': 'plan',
    '설계': 'architect', '아키': 'architect', 'arch': 'architect', 'a': 'architect',
    '디버그': 'debug', '버그': 'debug', 'd': 'debug',
    '묻기': 'ask', '질문': 'ask', '일상': 'ask', 'q': 'ask',
    '총괄': 'orchestrator', '오케': 'orchestrator', 'orch': 'orchestrator', 'o': 'orchestrator',
  };
  return 별명[s] ?? null;
}

export function get(id) {
  return MODES[normalize(id) ?? DEFAULT];
}

/** Shift+Tab 으로 돌릴 때 다음 모드. */
export function next(id) {
  const i = ORDER.indexOf(normalize(id) ?? DEFAULT);
  return ORDER[(i + 1) % ORDER.length];
}

/** 이 모드가 파일을 바꿀 수 있나. 화면에 자물쇠를 그릴지 정하는 데 쓴다. */
export function canWrite(id) {
  return get(id).tools.some((t) => 쓰기.includes(t));
}

/**
 * 이 모드에서 모델에게 보여 줄 도구 이름들.
 *
 * 있는 것 중에서 고르는 것이지, 없는 것을 만들어 주지 않는다.
 * 스킬이 없으면 Skill 은 애초에 없고, 오프라인이면 WebFetch 가 없다.
 * 그 판단은 부르는 쪽이 이미 했다.
 */
export function allow(id, 있는것) {
  const 허용 = new Set(get(id).tools);
  return 있는것.filter((name) => 허용.has(name));
}
