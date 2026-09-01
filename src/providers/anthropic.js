/*
 * Anthropic 직접 (Claude).
 *
 * ── 여기만 규격이 하나 더 필요하다 ─────────────────────────────────────
 *
 * 다섯 중에 유일하게 **몸통 모양이 다르다.** OpenAI 호환 창구가 없어서,
 * backend/adapter.js 에 `anthropic` 갈래를 하나 더해야 실제로 말이 통한다
 * (계획표 4단계). 그 전까지 이 파일은 「주소와 열쇠는 아는데 아직 말은 못
 * 한다」 는 상태다 — 그 사실을 숨기지 않는다.
 *
 * 숨기면 이렇게 된다: 목록에 Claude 가 보이고, 골라서 열쇠를 넣고, 연결도
 * 되고, 첫 한마디에서 400 이 난다. 그 화면으로는 무엇이 잘못됐는지 알 길이
 * 없다. 그래서 `규격됐나` 를 두고, 화면이 이걸 보고 말한다.
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

  /*
   * 이 규격을 deel 이 아직 말할 줄 아나.
   *
   * adapter.js 가 `anthropic` 갈래를 갖게 되면 true 로 바꾼다. 그때까지는
   * 화면이 「아직」 이라고 또렷하게 말하고, 골라도 저장까지 안 간다.
   */
  규격됐나: false,

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
