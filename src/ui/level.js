// 사용자 수준. 화면에 무엇을 내놓을지만 정한다.
//
// 무엇을 바꾸는가:  보이는 명령의 개수, 설명의 말투, 첫 실행에서 물어보는 것
// 무엇을 안 바꾸는가: 안전 장치. 하나도 안 바꾼다.
//
// 초보라고 승인을 덜 받거나 작업 범위를 넓히지 않는다. 그건 배려가 아니라
// 위험을 떠넘기는 것이다. 초보일수록 되돌릴 수 있어야 한다.
//
// 감추는 것도 '못 쓰게' 가 아니라 '안 보이게' 다. 초보 수준에서도 /think 를
// 치면 그대로 먹는다. 목록에 안 띄울 뿐이다 — 처음 켠 사람에게 명령 열여덟
// 개를 들이밀면 아무것도 못 고른다.

export const LEVELS = {
  쉬움: {
    id: '쉬움',
    en: 'beginner',
    name: '쉬움',
    hint: '권장값으로 바로 시작',
    // 목록에 띄울 것. 나머지는 쳐도 먹지만 안 보인다.
    show: [
      'help', 'work', 'auto', 'code', 'plan', 'ask',
      // ctx 를 초보 목록에 넣는다. 컨텍스트가 작게 잡히면 "왜 파일을 조금만 읽지"
      // 가 되는데, 초보일수록 그 원인을 못 찾는다. 명령 하나로 끝나는 문제다.
      'model', 'ctx', 'scan', 'undo', 'clear', 'sessions', 'cost', 'level', 'exit',
    ],
    // 첫 실행에서 훑어 추천까지 해 준다
    autoScan: true,
    // 오류를 무엇을 하라는 말로 바꿔 준다
    plainErrors: true,
  },

  개발자: {
    id: '개발자',
    en: 'developer',
    name: '개발자',
    hint: '전부 직접 만짐',
    show: null,        // null = 전부
    autoScan: false,
    plainErrors: false,
  },
};

export const DEFAULT = '쉬움';
export const ORDER = ['쉬움', '개발자'];

export function normalize(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  const 별명 = {
    '쉬움': '쉬움', '초보': '쉬움', '초보자': '쉬움', 'beginner': '쉬움', 'easy': '쉬움', 'b': '쉬움',
    '개발자': '개발자', '고급': '개발자', 'developer': '개발자', 'dev': '개발자', 'advanced': '개발자', 'd': '개발자',
  };
  return 별명[s] ?? (LEVELS[v] ? v : null);
}

export function get(id) {
  return LEVELS[normalize(id) ?? DEFAULT];
}

/** 이 수준에서 목록에 띄울 명령인가. 안 띄운다고 못 쓰는 것은 아니다. */
export function shows(levelId, cmd) {
  const lv = get(levelId);
  return lv.show === null || lv.show.includes(cmd);
}

/**
 * 오류를 초보에게 맞는 말로 바꾼다.
 *
 * 원인을 숨기지 않는다 — 무엇을 하면 되는지를 앞에 놓고, 원래 문구는 뒤에 남긴다.
 * 원인을 지우면 물어볼 수도 없게 된다.
 */
const 풀이 = [
  {
    when: /ECONNREFUSED|연결할 수 없|connect|fetch failed/i,
    say: '모델이 안 켜져 있는 것 같습니다.\n  LM Studio 나 Ollama 를 켜고 모델을 하나 올린 다음 다시 해보세요.\n  어떤 것이 떠 있는지 보려면 /scan',
  },
  {
    when: /허용되지 않은 주소/,
    say: '지금 연결된 곳이 아닌 데로 나가려 했습니다. 막힌 게 정상입니다.\n  다른 모델을 쓰시려면 /model 로 고르세요.',
  },
  {
    when: /작업 범위 밖/,
    say: '시작한 폴더 바깥의 파일은 건드리지 않습니다.\n  그 파일이 꼭 필요하면, 그 폴더에서 deel 을 다시 켜세요.',
  },
  {
    when: /먼저 Read 로 읽어야/,
    say: '고치기 전에 파일을 먼저 읽게 되어 있습니다. 잠시 후 다시 시도합니다.',
  },
  {
    when: /401|403|인증|unauthorized/i,
    say: '열쇠(API 키)가 없거나 맞지 않습니다.\n  deel setup 으로 다시 넣어 주세요.',
  },
  {
    when: /timeout|시간 초과/i,
    say: '모델이 제때 답하지 않았습니다.\n  큰 모델이면 원래 느립니다. 잠시 뒤 다시 하거나 더 작은 모델을 골라 보세요.',
  },
];

export function explain(levelId, message) {
  const lv = get(levelId);
  const raw = String(message ?? '');
  if (!lv.plainErrors) return { text: raw, plain: false };
  const hit = 풀이.find((r) => r.when.test(raw));
  if (!hit) return { text: raw, plain: false };
  return { text: hit.say, detail: raw, plain: true };
}
