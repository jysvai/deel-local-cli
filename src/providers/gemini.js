/*
 * Google Gemini.
 *
 * ── 규격을 안 늘려도 된다 ──────────────────────────────────────────────
 *
 * 구글이 OpenAI 호환 창구를 낸다. 문서로 확인한 것 (ai.google.dev/gemini-api/docs/openai):
 *
 *   base_url  https://generativelanguage.googleapis.com/v1beta/openai/
 *   목록      GET  {base}/models        Authorization: Bearer <열쇠>
 *   대화      POST {base}/chat/completions  · tools · tool_choice 그대로
 *
 * 그래서 Gemini 는 **주소 한 줄**이면 끝난다. deel 의 기본 규격이 이미 이
 * 모양이라 adapter 를 안 건드린다.
 *
 * ── 다만 도구 스키마에 걸릴 수 있다 ────────────────────────────────────
 *
 * 구글 문서가 「함수 호출은 OpenAPI 스키마의 일부만 지원하고, 크거나 깊이
 * 중첩된 스키마는 거절될 수 있다」 고 적어 두었다. deel 의 Write(files[]) ·
 * Edit(edits[]) · Move(moves[]) 는 객체 배열이라 여기 걸릴 수 있다.
 *
 * 추측하지 않는다 — `deel diagnose` 가 그 자리에서 진짜로 찔러 본다. 걸리면
 * 그때 배열 도구를 한 개씩 쓰도록 낮춘다. 미리 낮춰 두면 멀쩡한 자리에서까지
 * 한 번에 한 파일씩 고치게 되고, 그건 몇 분을 그냥 버리는 일이다.
 */
export const 제공자 = {
  id: 'gemini',
  이름: 'Google Gemini',
  한줄: 'OpenAI 호환 창구가 있어 주소 한 줄이면 됩니다.',

  규격: 'openai',
  인증: 'bearer',
  주소들: () => ['https://generativelanguage.googleapis.com/v1beta/openai/'],
  리전들: null,

  빈칸: ['열쇠'],
  열쇠받는곳: 'https://aistudio.google.com/apikey',
  키앞머리: [/^AIza/],

  // 왜 비워 두는지는 providers/openai.js 의 같은 자리에 적어 두었다.
  요금: {},
  요금기준: null,
  요금표주소: 'https://ai.google.dev/gemini-api/docs/pricing',

  /*
   * 도구 스키마가 걸릴 수 있는 곳이라고 표를 달아 둔다. 화면이 이걸 보고
   * 「걸리면 deel diagnose 로 확인하세요」 한 줄을 붙인다.
   */
  도구스키마조심: '함수 호출이 OpenAPI 스키마의 일부만 지원됩니다 — 깊이 중첩된 스키마는 거절될 수 있습니다.',

  오류읽기({ status, 서버말 }) {
    if (status === 400 && /API key not valid/i.test(서버말)) {
      return '열쇠를 못 알아봅니다 — AI Studio 에서 받은 열쇠(AIza…)가 맞는지 보세요.';
    }
    if (status === 400 && /schema|function|tool/i.test(서버말)) {
      return '도구 스키마를 거절했습니다 — Gemini 는 스키마의 일부만 받습니다.'
        + ' deel diagnose 로 어느 도구가 걸리는지 확인하세요.';
    }
    if (status === 403 && /SERVICE_DISABLED|PERMISSION_DENIED/i.test(서버말)) {
      return '이 프로젝트에서 Generative Language API 가 꺼져 있습니다 — 콘솔에서 켜세요.';
    }
    return null;
  },
};
