/*
 * Anthropic 직접 (Claude).
 *
 * ── 여기만 규격이 하나 더 필요했다 ─────────────────────────────────────
 *
 * 다섯 중에 유일하게 **몸통 모양이 다르다.** OpenAI 호환 창구가 없어서,
 * backend/adapter.js 에 `anthropic` 갈래를 하나 더해야 말이 통한다. 그
 * 갈래를 붙였다 — 문 이름 · 몸통 · 답 읽기 · 이력 되돌리기 · 도구 결과 ·
 * 흘려받기 여섯 자리, 그리고 그림과 창 크기.
 *
 * 무엇이 다른지는 backend/adapter.js 의 anthropic몸() 머리말에 있다.
 */
export const 제공자 = {
  id: 'anthropic',
  이름: 'Anthropic (Claude)',
  한줄: '벤더에서 바로. 열쇠 하나만 있으면 됩니다.',

  규격: 'anthropic',
  // 인증 방식이 다르다. Bearer 가 아니라 x-api-key 다 — 축이 갈라져 있다는
  // 것이 여기서 그대로 보인다 (계획표 05절).
  인증: 'x-api-key',
  주소들: () => ['https://api.anthropic.com'],
  리전들: null,

  규격됐나: true,

  빈칸: ['열쇠'],
  열쇠받는곳: 'https://console.anthropic.com/settings/keys',
  키앞머리: [/^sk-ant-/],

  // 왜 비워 두는지는 providers/openai.js 의 같은 자리에 적어 두었다.
  요금: {},
  요금기준: null,
  요금표주소: 'https://www.anthropic.com/pricing',

  오류읽기({ status, 서버말 }) {
    if (status === 400 && /anthropic-version/i.test(서버말)) {
      return 'anthropic-version 헤더가 없거나 틀렸습니다 — deel 의 규격 붙임이 아직 안 끝난 자리입니다.';
    }
    if (status === 404 && /model/i.test(서버말)) {
      return '그 모델 이름을 이 열쇠로는 못 씁니다 — 이름이 틀렸거나, 아직 안 열린 모델입니다.';
    }
    if (status === 400 && /credit|balance/i.test(서버말)) {
      return '잔액이 모자랍니다 — 콘솔에서 결제·크레딧을 확인하세요.';
    }
    return null;
  },
};
