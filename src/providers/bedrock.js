/*
 * AWS Bedrock.
 *
 * ── SigV4 서명이 필요 없다 ─────────────────────────────────────────────
 *
 * 이게 이 파일에서 제일 중요한 사실이고, 계획을 세울 때 내가 틀렸던 자리다.
 * AWS 를 붙인다고 하면 보통 SigV4 서명(해시 체인 · 날짜 키 유도)을 떠올리고,
 * 그건 의존성 0개로는 꽤 큰 일이다. 그런데 문서를 보면 —
 * (docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions-mantle.md)
 *
 *   curl -X POST "https://bedrock-runtime.us-east-1.amazonaws.com/v1/chat/completions" \
 *     -H "Authorization: Bearer $AWS_BEARER_TOKEN_BEDROCK"
 *
 * **Bedrock API 키를 그냥 Bearer 로 받는다.** 그리고 OpenAI Chat Completions
 * 창구로 부를 때는 인증이 API 키 하나로 제한된다고 문서가 못 박아 두었다.
 * 그러면 Bedrock 은 새 규격이 아니라 **이미 있는 축들의 새 조합**일 뿐이다 —
 * 규격 openai · 인증 bearer · 주소가 리전을 탄다.
 *
 * ── 주소가 셋이다 ──────────────────────────────────────────────────────
 *
 *   bedrock-runtime.{리전}.amazonaws.com/v1         API 키를 Bearer 로 (문서)
 *   bedrock-runtime.{리전}.amazonaws.com/openai/v1  Bedrock 위의 OpenAI 모델 (문서)
 *   bedrock-mantle.{리전}.api.aws/v1                mantle 창구 (문서)
 *
 * 셋 다 후보로 주고 **어느 것이 되는지는 물어본다**(backend/detect.js).
 * 표를 믿고 하나만 쓰면 그 표가 낡은 날 사람은 「연결 실패」 만 본다.
 *
 * ── 리전 목록은 짧게, 진실은 엔드포인트에 묻는다 ───────────────────────
 *
 * 리전마다 열려 있는 모델이 다르다. 「서울에 최신 Claude 가 있다」 를 표에
 * 박으면 그 표가 낡는다. 리전을 고르면 그 자리에서 실제로 물어보고, 없으면
 * 없다고 말한다. 그래서 목록에는 「직접 입력」 이 늘 있다 — 목록은 빈칸을
 * 줄여 주는 것이지 울타리가 아니다.
 */
export const 리전들 = [
  { id: 'us-east-1', 어디: '버지니아', 왜: '새 모델이 제일 먼저 열립니다' },
  { id: 'us-west-2', 어디: '오리건', 왜: '두 번째로 넓습니다' },
  { id: 'ap-northeast-2', 어디: '서울', 왜: '자료를 국내에 남깁니다 — 사내 도입엔 이게 관건입니다' },
  { id: 'ap-northeast-1', 어디: '도쿄', 왜: '서울에 없을 때 제일 가까운 대안입니다' },
  { id: 'eu-central-1', 어디: '프랑크푸르트', 왜: 'EU' },
];

export const 제공자 = {
  id: 'bedrock',
  이름: 'AWS Bedrock',
  한줄: '리전과 열쇠 둘만 있으면 됩니다. AWS 서명(SigV4)은 필요 없습니다.',

  규격: 'openai',
  인증: 'bearer',
  기본리전: 'us-east-1',
  리전들,

  주소들: ({ 리전 } = {}) => {
    const r = String(리전 ?? 'us-east-1').trim();
    if (!/^[a-z]{2}-[a-z]+-\d$/.test(r)) return [];
    return [
      `https://bedrock-runtime.${r}.amazonaws.com/v1`,
      `https://bedrock-runtime.${r}.amazonaws.com/openai/v1`,
      `https://bedrock-mantle.${r}.api.aws/v1`,
    ];
  },

  빈칸: ['리전', '열쇠'],
  열쇠받는곳: 'https://console.aws.amazon.com/bedrock/home#/api-keys',

  /*
   * 앞머리를 안 둔다.
   *
   * Bedrock API 키에는 알아볼 만한 고정 앞머리가 없다. 「모르면 뿌리지 말고
   * 물어본다」 가 이 도구의 규칙이라(providers/index.js), 짐작이 안 서면
   * 짐작하지 않는다. 빈 목록이 곧 그 뜻이다.
   */
  키앞머리: [],

  // 왜 비워 두는지는 providers/openai.js 의 같은 자리에 적어 두었다.
  요금: {},
  요금기준: null,
  요금표주소: 'https://aws.amazon.com/bedrock/pricing/',

  오류읽기({ status, 서버말 }) {
    /*
     * Bedrock 에서 제일 흔한 첫 실패는 **모델 접근 신청을 안 한 것**이다.
     * 열쇠도 맞고 주소도 맞는데 그 리전의 그 모델을 아직 안 열어 둔 상태다.
     * 이걸 「연결 실패」로 뭉개면 사람은 주소와 열쇠를 몇 번이고 다시 본다 —
     * 정작 해야 할 일은 콘솔에서 신청 버튼 한 번 누르는 것인데.
     */
    if (/AccessDenied|not authorized|access to the model/i.test(서버말)) {
      return '이 리전에서 그 모델에 접근 권한이 없습니다 — Bedrock 콘솔의 모델 접근(Model access)에서 신청하세요.';
    }
    if (/ValidationException/i.test(서버말) && /model/i.test(서버말)) {
      return '그 모델 이름을 이 리전에서 못 씁니다 — 리전을 바꾸거나 이름을 다시 보세요.';
    }
    if (status === 403 && /security token|ExpiredToken/i.test(서버말)) {
      return '열쇠가 만료됐습니다 — Bedrock 콘솔에서 새로 발급받으세요 (단기 키는 만료됩니다).';
    }
    if (status === 404 && /^$|Not Found/i.test(서버말)) {
      return '그 리전에 이 창구가 없습니다 — 리전 이름을 다시 보세요.';
    }
    return null;
  },
};
