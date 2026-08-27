/**
 * 내장 모델 카드 — 겪기 전에 이미 아는 버릇.
 *
 * ── 카드(card.js)와 무엇이 다른가 ───────────────────────────────────────
 *
 * 카드는 겪어 본 버릇으로 하네스를 조정한다. 좋은데, **겪어야** 나온다 —
 * 최소걸음(12)을 걷기 전에는 아무것도 안 바꾼다. 그런데 어떤 버릇은 겪기
 * 전에 이미 안다. 추론 모델은 생각(thinking)이 출력 예산을 먹어 답이 잘린다 —
 * 공개 문서에 있는 사실이고, 열두 걸음 걸으며 다시 확인할 일이 아니다.
 * 이 프로그램이 그 함정을 처음 밟은 것도 qwen3 진단 때였다: 토큰 상한이
 * 낮으면 본문이 통째로 비고 전부 thinking 으로 간다.
 *
 * ── 왜 국산 모델인가 ────────────────────────────────────────────────────
 *
 * 이 표의 절반이 국산(EXAONE·HyperCLOVA X·Kanana·Midm·Solar)인 이유는 이
 * 프로그램이 도는 자리가 그 모델들이 도는 자리라서다. 사내망 GPU 에 올라가는
 * 것이 이 이름들이고, 해외 도구는 이 이름들을 모른다.
 *
 * ── 지키는 선 ───────────────────────────────────────────────────────────
 *
 * 미리 아는 것은 **공개 문서에서 오는 것만** 적는다. 안 겪은 것을 겪은
 * 척하면 카드 전체가 거짓말이 된다. 그래서 여기 적는 조정은 문서로 확인
 * 가능한 한 가지 — 추론형 여부 — 뿐이고, 나머지(잘림·되풀이·빗나감)는
 * 지금까지처럼 겪어서만 잡는다. 겪어 본 것이 이 표를 이긴다.
 */
import { 언어 } from '../i18n/index.js';

/*
 * 표. 위에서부터 먼저 맞는 것을 쓴다 — Deep 이 EXAONE 보다 먼저 서는
 * 이유다(이름이 겹친다).
 *
 * 골라 는 Ollama·HuggingFace 의 이름 버릇을 다 받아야 한다:
 * `exaone-deep:7.8b` · `hf.co/LGAI-EXAONE/EXAONE-4.0-32B-GGUF` ·
 * `hyperclovax-seed-text-instruct-1.5b` 처럼 제각각이다.
 */
const 표 = [
  {
    골라: /exaone[-_.\s]?deep|exaone.*r1/i,
    이름: 'EXAONE Deep (LG)',
    추론형: true,
    한줄ko: 'LG 의 추론 모델. 수학·코딩에 생각을 길게 쓴다 — 공개 문서 기준.',
    한줄en: "LG's reasoning model. Thinks long on math and code — per its public docs.",
  },
  {
    골라: /exaone/i,
    이름: 'EXAONE (LG)',
    추론형: false,
    한줄ko: 'LG 의 한국어·영어 모델. 32k 컨텍스트 세대가 흔하다.',
    한줄en: "LG's Korean-English model. The 32k-context generation is common.",
  },
  {
    골라: /hyperclova|clova[-_.\s]?x/i,
    이름: 'HyperCLOVA X SEED (네이버)',
    추론형: false,
    한줄ko: '네이버의 공개 소형 모델(0.5B~3B). 급 조정(grade.js)이 알아서 잡는다.',
    한줄en: "Naver's open small models (0.5B-3B). The grade system already sizes for them.",
  },
  {
    골라: /kanana/i,
    이름: 'Kanana (카카오)',
    추론형: false,
    한줄ko: '카카오의 공개 모델. nano(2.1B)부터 있다 — 작은 판은 급 조정이 잡는다.',
    한줄en: "Kakao's open models, from nano (2.1B) up. Small sizes are handled by the grade system.",
  },
  {
    골라: /mi[-_.:\s]?dm|midm/i,
    이름: 'Midm — 믿음 (KT)',
    추론형: false,
    한줄ko: 'KT 의 공개 한국어 모델.',
    한줄en: "KT's open Korean model.",
  },
  {
    골라: /solar/i,
    이름: 'Solar (업스테이지)',
    추론형: false,
    한줄ko: '업스테이지의 모델. 한국어가 강하다.',
    한줄en: "Upstage's model, strong on Korean.",
  },
  {
    /*
     * 국산은 아니지만 이 자리(로컬 한국어 사용자)에서 제일 흔한 이름이고,
     * deel 이 이 함정을 실제로 밟았다 — 진단 때 답이 통째로 thinking 으로
     * 새서 "기본 대화 안 됨" 으로 오판할 뻔했다.
     */
    골라: /qwen3|qwq/i,
    이름: 'Qwen3 (알리바바)',
    추론형: true,
    한줄ko: '생각을 켜고 끌 수 있는 모델. 켜져 있으면 생각이 출력 예산을 먹는다.',
    한줄en: 'Hybrid thinking model. With thinking on, the thinking eats the output budget.',
  },
];

/**
 * 이 모델을 미리 아는가.
 * @returns {{이름, 추론형, 한줄}|null} 모르면 null — 모르는 것은 모른다고 한다.
 */
export function 내장카드(모델) {
  const 이름 = String(모델 ?? '');
  if (!이름) return null;
  for (const p of 표) {
    if (p.골라.test(이름)) {
      return { 이름: p.이름, 추론형: p.추론형, 한줄: 언어() === 'en' ? p.한줄en : p.한줄ko };
    }
  }
  return null;
}

/** 추론형에 붙는 왜 한 줄. card.js 가 쓴다. */
export function 추론형왜() {
  return 언어() === 'en'
    ? 'A reasoning model (public docs) — thinking eats the output budget and answers get cut, so the cap starts generous.'
    : '추론 모델입니다(공개 문서) — 생각이 출력 예산을 먹어 답이 잘리기 쉬우므로, 출력 상한을 처음부터 넉넉히 줍니다.';
}
