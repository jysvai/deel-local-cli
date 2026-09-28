/*
 * OpenRouter — 열쇠 하나로 여러 회사 모델 (Claude · GPT · Grok · Kimi …) (2.1.4).
 *
 * 규격은 OpenAI 호환이라 여기도 데이터 한 장이다. 다른 제공자와 다른 칸은 하나 —
 * **`링크로그인`** 이다.
 *
 * ── 열쇠를 안 넣고 계정으로 받는다 ─────────────────────────────────────
 *
 * 「API 키 말고, 링크 타고 로그인하면 바로 쓰게」 가 사람들이 오래 바란 것이다. Claude·Codex 의
 * 구독 로그인을 가져다 쓰는 길은 **안 간다** — 그 로그인은 그 회사 도구용이고, 남의 도구가 쓰면
 * 약관에 걸리거나 어느 날 막힌다. 그러면 사람은 이유도 모르고 못 쓰게 된다.
 *
 * OpenRouter 는 제 계정으로 **열쇠를 내주는 로그인**(OAuth PKCE)을 공식으로 연다
 * (https://openrouter.ai/docs/use-cases/oauth-pkce). 브라우저에서 로그인하면 그 계정에 열쇠가
 * 하나 생기고, 우리는 그것을 받아 사람이 붙여 넣은 열쇠와 똑같이 잠가 둔다. 쓴 만큼 그 계정에서
 * 빠진다. 받은 열쇠는 https://openrouter.ai/keys 에 「deel」 이름으로 보이고 거기서 지울 수 있다.
 *
 * 로그인 흐름은 src/login.js 가 한다. 여기에는 **주소만** 적는다 — 이 칸이 있는 제공자는
 * 누구든 같은 흐름을 탄다. 코드 분기가 아니라 데이터다(providers/index.js 머리말).
 */
export const 제공자 = {
  id: 'openrouter',
  이름: 'OpenRouter (Claude · GPT · Grok · Kimi …)',
  한줄: '열쇠 하나로 여러 회사 모델. 브라우저로 로그인하면 열쇠를 안 넣어도 됩니다.',

  규격: 'openai',
  인증: 'bearer',
  주소들: () => ['https://openrouter.ai/api/v1'],
  리전들: null,

  규격됐나: true,
  빈칸: ['열쇠 또는 로그인'],
  열쇠받는곳: 'https://openrouter.ai/keys',

  /*
   * `sk-or-v1-…`. openai 의 `sk-` 보다 길어서 이긴다(index.js 의 어디것일까) — 짧은 쪽이 먼저
   * 집으면 OpenRouter 열쇠가 api.openai.com 으로 간다.
   */
  키앞머리: [/^sk-or-v1-/, /^sk-or-/],

  // 로그인 창구. 1단계는 브라우저가 열고, 2단계(코드 → 열쇠)는 우리가 한 번 POST 한다.
  링크로그인: {
    여는곳: 'https://openrouter.ai/auth',
    바꾸는곳: 'https://openrouter.ai/api/v1/auth/keys',
    열쇠이름: 'deel',
  },

  // 단가는 모델마다 다르고 자주 바뀐다. 아는 척하지 않는다(openai.js 의 요금 머리말).
  요금: {},
  요금기준: null,
  요금표주소: 'https://openrouter.ai/models',

  오류읽기({ status, 서버말 }) {
    if (status === 402) {
      return '이 계정에 크레딧이 없습니다 — https://openrouter.ai/settings/credits 에서 채우거나, 이름이 :free 로 끝나는 모델을 고르세요.';
    }
    if (status === 404 && /no endpoints|not a valid model|model/i.test(서버말)) {
      return '그 모델을 지금 받아 주는 곳이 없습니다 — 이름이 틀렸거나 내려간 모델입니다. https://openrouter.ai/models 에서 보세요.';
    }
    return null;
  },
};
