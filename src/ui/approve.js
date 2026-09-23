/**
 * 승인 방식을 사람 말로.
 *
 * ── 왜 따로 두나 ────────────────────────────────────────────────────────
 *
 * 상태줄에 `auto` 라고만 떠 있었다. 그 옆에는 `종합` 과 `medium·절약` 이 나란히
 * 있어서, 셋 다 그냥 '모드' 처럼 보였다. 그중 하나가 **묻지 않고 파일을 고친다**
 * 는 뜻이라는 것은 화면 어디에도 없었다.
 *
 * 이건 꾸미기가 아니라 안전 표시다. 지금 이 순간 내 파일이 물어보고 바뀌는지
 * 안 물어보고 바뀌는지는, 화면을 흘깃 봐서 **바로** 알아야 하는 한 가지다.
 *
 * 그래서 세 가지를 준다 — 눈에 띄는 글자, 사람 말 이름, 무엇을 묻는지 한 줄.
 */
import { c } from './ansi.js';
import { diffLines, renderDiff, shortStat } from './diff.js';
import { 말 } from '../i18n/index.js';

/*
 * 이름과 한 줄 설명은 화면 말(i18n)에서 읽는다. 글자와 색은 여기 남긴다 —
 * ⏵⏵ 는 어느 말로도 ⏵⏵ 이고, 노랑은 어느 말로도 노랑이다.
 *
 * 게터로 둔다. 켤 때 한 번 읽어 굳히면 /lang 으로 바꿔도 상태줄의 승인
 * 표시만 옛 말로 남는데, 하필 그게 안전 표시라 제일 안 어긋나야 할 자리다.
 */
/*
 * 펼치기(...)로 붙이면 **그 자리에서 값이 굳는다.** 게터를 펼치면 게터가
 * 아니라 그때 읽은 글자가 복사되기 때문이다. 그러면 /lang 으로 바꿔도
 * 승인 표시만 옛 말로 남는데, 하필 그게 안전 표시라 제일 안 어긋나야 할
 * 자리다. defineProperty 로 게터인 채로 붙인다.
 */
function 마디(키, 바탕) {
  const 것 = { ...바탕 };
  for (const [자리, 뒤] of [['이름', 'name'], ['짧은이름', 'short'], ['한줄', 'line']]) {
    Object.defineProperty(것, 자리, { get: () => 말(`approve.${키}.${뒤}`), enumerable: true });
  }
  return 것;
}

export const 승인 = {
  auto: 마디('auto', { 글자: '⏵⏵', 색: c.hyellow }),
  confirm: 마디('confirm', { 글자: '⏵', 색: c.white }),
  strict: 마디('strict', { 글자: '⏸', 색: c.hgreen }),
};

export const 차례 = ['auto', 'confirm', 'strict'];
export const 기본 = 'auto';

export function 고르기(이름) {
  return 승인[이름] ?? 승인[기본];
}

/**
 * 다음 승인 방식. Shift+Tab 이 이걸로 돈다.
 *
 * 자동 → 위험만 → 모두 → 자동. **느슨한 쪽에서 조이는 쪽으로** 도는 차례다 —
 * 한 번 누를 때마다 더 많이 물어보게 되니, 잘못 눌러도 위험해지지 않는다.
 * 반대로 돌면 Shift+Tab 한 번에 '안 묻고 고침' 으로 떨어진다.
 */
export function 다음(이름, 바닥 = 'auto') {
  // 관리 정책이 바닥을 걸었으면 그 위에서만 돈다 (safety/policy.js 의 승인바닥).
  // 전부 돌게 두면 바닥 아래 칸에 들어갔다가 다시 끌어올려져, 눌러도 안 바뀐 것처럼 보인다.
  const 돌칸 = 차례.slice(Math.max(0, 차례.indexOf(바닥)));
  // 모르는 값이면 화면에 떠 있는 것(고르기가 내주는 기본)을 기준으로 삼는다.
  // 안 그러면 보이는 것과 한 칸 어긋나서, 눌러도 안 바뀐 것처럼 보인다.
  const i = 돌칸.indexOf(승인[이름] ? 이름 : 기본);
  return 돌칸[(i + 1) % 돌칸.length];
}

/**
 * 자율(auto) 모드에서 사람 답을 **얼마나** 기다리나 — 초. 설정의 `askWait`, 기본 60.
 *
 * auto 는 「다 맡긴다」 는 모드다. 그런데 그 안에서도 사람 답을 끝없이 기다리는 자리가
 * 둘 남아 있었다 — 모델이 되묻는 것(Ask 도구)과, 「계획하고 만들어줘」 에 뜨는 계획 승인.
 * 맡겨 두고 자리를 뜬 사람에게 그건 멈춘 것과 같다. 그래서 auto 에서만 시한을 둔다.
 * 시한이 지나면 되묻기는 「스스로 판단하라」 로, 계획은 「그대로 진행」 으로 간다.
 *
 * 0 이면 아예 안 묻고 간다. 도구 승인(confirm·strict 의 「실행할까요?」)에는 **안 건다** —
 * 그 모드를 고른 사람은 답을 기다리라고 고른 것이다. 관리 정책이 승인 바닥을 걸면 모드가
 * auto 가 아니므로 여기도 안 걸린다.
 */
export const 자율대기기본 = 60;
export function 자율대기(cfg) {
  /*
   * 숫자와 숫자 글만 받는다. Number() 에 통째로 넘기면 true 가 1초, false 와 빈칸(' ')이
   * 0 — 「안 묻고 간다」 — 가 된다. 그렇게 적은 사람이 바란 것이 무엇이든 그건 아니다 (2차 눈 판정).
   */
  const v = cfg?.askWait;
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return 자율대기기본;
  return Math.min(3600, Math.floor(n));
}

/**
 * 승인 물음 밑에 그릴 「바뀔 내용」 (tools/index.js 의 바뀔내용).
 *
 * 무엇이 바뀌는지 모르고 누르는 y 는 확인이 아니라 습관이다. 그래서 물음 밑에 파일마다
 * 머리 한 줄과 바뀐 자리를 그린다. 여러 파일이면 줄 수를 나눠 쓴다 — 한 파일이 다 먹으면
 * 뒤 파일은 이름조차 안 보이고, 사람은 한 파일만 바뀌는 줄 알고 허락한다.
 */
export function 미리보기줄들(미리보기, { 줄수 = 40 } = {}) {
  if (!Array.isArray(미리보기) || !미리보기.length) return [];
  /*
   * 파일 이름 줄은 **다 그린다**(위 머리말). 바뀐 줄은 한도를 나눠 쓰되, 한 파일 몫이 3줄도 안
   * 되면 이름 줄과 셈(+3 -1)만 그린다. 여태 몫에 하한 6 을 두어 파일 50개면 400줄이 나왔다 —
   * 물음이 화면 밖으로 밀려 사람은 무엇에 y 를 치는지 못 본다 (2차 눈 판정).
   */
  const 몫 = Math.floor(줄수 / 미리보기.length);
  const out = [];
  for (const 것 of 미리보기) {
    let d = null;
    try { d = diffLines(것.전, 것.후); } catch { d = null; }
    const 셈 = d ? shortStat(d) : '';
    out.push(`    ${c.white(것.보일경로)}${것.전 === null ? c.gray(` (${말('approve.newFile')})`) : ''}${셈 ? `  ${셈}` : ''}`);
    if (d && 몫 >= 3) out.push(...renderDiff(d, { maxLines: 몫, indent: '      ' }));
  }
  return out;
}

/** 상태줄에 넣을 조각. 짧게=true 면 좁은 창용. */
export function 표시(이름, { 짧게 = false } = {}) {
  const m = 고르기(이름);
  return `${m.색(m.글자)} ${m.색(짧게 ? m.짧은이름 : m.이름)}`;
}
