/**
 * 내장 모델 카드 — 국산 모델의 알려진 버릇을 겪기 전에 안다.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 *
 * 카드(card.js)는 겪어 본 버릇으로 하네스를 조정한다. 좋은데, **겪어야**
 * 나온다 — 최소걸음(12)을 걷기 전에는 아무것도 안 바꾼다. 그런데 어떤 버릇은
 * 겪기 전에 이미 안다: 추론 모델은 생각이 출력 예산을 먹어 답이 잘린다.
 * 이건 공개 문서에 있는 사실이고, 열두 걸음 걸으며 다시 확인할 일이 아니다.
 *
 * 국산 모델(EXAONE·HyperCLOVA X·Kanana·Midm·Solar)을 표에 품는 이유는 이
 * 프로그램이 도는 자리가 그 모델들이 도는 자리라서다. 해외 도구는 이 이름들을
 * 모른다.
 *
 * ── 지키는 선 ───────────────────────────────────────────────────────────
 *
 *   · 미리 아는 것은 **공개 문서에서 오는 것만** 적는다. 안 겪은 것을 겪은
 *     척하면 카드 전체가 거짓말이 된다.
 *   · 겪어 본 것이 미리 아는 것을 **이긴다** — 실측이 문서보다 낫다.
 *   · 모르는 모델은 아무것도 안 바꾼다.
 */
import { 내장카드 } from '../src/agent/preset.js';
import { 카드, 기본조정 } from '../src/agent/card.js';
import { 언어정하기 } from '../src/i18n/index.js';
import { trace } from './trace.mjs';

const pass = [];
const fail = [];
const check = (name, cond, note = '') => (cond ? pass : fail).push({ name, note });
const 적어둘것 = [];

언어정하기('ko');

// ══ 1. 이름 맞추기 ══════════════════════════════════════════════════════
trace('1-이름');
{
  const 경우 = [
    ['exaone-deep:7.8b', 'EXAONE Deep', true],
    ['exaone3.5:7.8b', 'EXAONE', false],
    ['hf.co/LGAI-EXAONE/EXAONE-4.0-32B-GGUF', 'EXAONE', null],
    ['hyperclovax-seed-text-instruct-1.5b', 'HyperCLOVA', false],
    ['kanana-nano-2.1b-instruct', 'Kanana', false],
    ['midm-2.0-base-instruct', 'Midm', false],
    ['solar-pro', 'Solar', false],
    ['qwen3:8b', 'Qwen3', true],
  ];
  for (const [이름, 표이름, 추론] of 경우) {
    const p = 내장카드(이름);
    check(`${이름} → ${표이름}`, !!p && p.이름.includes(표이름), p?.이름 ?? 'null');
    if (p && 추론 !== null) check(`${이름} 추론형=${추론}`, p.추론형 === 추론, String(p?.추론형));
  }
  // 대소문자와 태그가 달라도 맞춘다 — Ollama 이름은 제각각이다.
  check('대문자도 맞춘다', !!내장카드('EXAONE-Deep-2.4B'), '');
  for (const 모름 of ['llama3.1:8b', 'gpt-4o', 'mistral', '', null]) {
    check(`${모름} 은 모른다`, 내장카드(모름) === null, '');
  }
}

// ══ 2. 카드에 스며든다 ══════════════════════════════════════════════════
trace('2-카드');
{
  // 겪은 것이 하나도 없어도, 미리 아는 것은 바로 적용된다.
  const 장 = 카드('exaone-deep:7.8b');
  check('추론형이면 출력 상한을 처음부터 넉넉히', 장.조정.상한먼저올리기 === true, JSON.stringify(장.조정));
  check('왜에 미리 아는 것이 적힌다', 장.왜.length >= 1 && /추론|생각/.test(장.왜.join(' ')), 장.왜.join(' | '));
  check('내장 카드 이름이 실린다', !!장.내장 && /EXAONE/.test(장.내장.이름), JSON.stringify(장.내장 ?? null));
  check('겪은 걸음 셈은 그대로 0', 장.걸음 === 0 && 장.아직모름 === true, '');

  // 추론형이 아니면 미리 바꿀 것이 없다 — 이름표만 붙는다.
  const 장2 = 카드('kanana-nano-2.1b');
  check('추론형이 아니면 조정은 기본 그대로', JSON.stringify(장2.조정) === JSON.stringify(기본조정()), JSON.stringify(장2.조정));
  check('그래도 이름표는 붙는다', !!장2.내장, '');

  // 모르는 모델: 지금까지와 완전히 같다.
  const 장3 = 카드('mystery-model');
  check('모르는 모델은 내장이 없다', !장3.내장, '');
  check('모르는 모델은 조정도 기본', JSON.stringify(장3.조정) === JSON.stringify(기본조정()), '');
}

// ══ 3. 겪어 본 것이 이긴다 ══════════════════════════════════════════════
trace('3-실측우선');
{
  // 많이 겪은 뒤에는 실측이 문서를 덮는다 — 문서와 실측이 겹쳐도 한 번만 조정된다.
  const 겪은 = { 걸음: 40, 잘린인자: 10, 되풀이: 8 };
  const 장 = 카드('exaone-deep:7.8b', null, 겪은);
  check('실측 조정이 같이 산다', 장.조정.같은것한계 === 2, String(장.조정.같은것한계));
  check('상한 조정은 겹쳐도 한 번', 장.조정.상한먼저올리기 === true, '');
  check('왜에 실측과 문서가 나란히 선다', 장.왜.length >= 2, 장.왜.join(' | '));
}

// ══ 4. 영어로도 말한다 ══════════════════════════════════════════════════
trace('4-영어');
{
  언어정하기('en');
  const 장 = 카드('exaone-deep:7.8b');
  check('영어로 켜면 왜도 영어', /[a-z]/.test(장.왜[0] ?? '') && !/[가-힣]/.test(장.왜[0] ?? ''), 장.왜[0]);
  check('내장 한줄도 영어', !/[가-힣]/.test(장.내장?.한줄 ?? ''), 장.내장?.한줄);
  언어정하기('ko');
  const 다시 = 카드('exaone-deep:7.8b');
  check('한국어로 돌리면 한국어', /[가-힣]/.test(다시.왜[0] ?? ''), 다시.왜[0]);
}

// ── 마무리 ──────────────────────────────────────────────────────────────
const C = (n, s) => (process.stdout.isTTY || process.env.FORCE_COLOR ? `\x1b[${n}m${s}\x1b[0m` : s);
console.log('');
for (const f of fail) console.log(`  ${C(31, '✗')} ${f.name}${f.note ? C(90, `  ${f.note}`) : ''}`);
for (const 글 of 적어둘것) console.log(`  ${C(90, `· ${글}`)}`);
console.log('');
console.log(`  ${pass.length}개 통과 · ${fail.length}개 실패`);
trace('끝-정상종료');
process.exitCode = fail.length ? 1 : 0;
