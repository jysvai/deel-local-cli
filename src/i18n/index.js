/**
 * 화면 말 고르기 — 한국어 / 영어.
 *
 * ── 왜 이제 와서 ────────────────────────────────────────────────────────
 *
 * deel 은 한국어로 쓴 도구다. 함수 이름도 변수 이름도 한글이고, 그게 이
 * 저장소의 뜻이다. 그건 안 바꾼다.
 *
 * 바꾸는 것은 **화면에 나가는 말**뿐이다. GitHub 에 올려 두고 보니, 처음
 * 켠 사람이 `/help` 한 번 치고 나가 버린다. 명령 이름은 이미 영어인데
 * (help·model·undo…) 그 옆의 설명이 전부 한글이라, 무엇을 하는 명령인지
 * 알 길이 없어서다. 코드는 한국어로 두고 화면만 갈아 끼운다.
 *
 * ── 지키는 선 ───────────────────────────────────────────────────────────
 *
 * 1) **빈칸을 절대 안 낸다.** 영어 말이 없으면 한국어를 그대로 낸다.
 *    반쯤 번역된 화면에서 제일 나쁜 것이 '아무것도 안 적힌 자리' 다 —
 *    사람은 그걸 고장으로 읽지, 번역이 덜 됐다고 읽지 않는다.
 * 2) **없는 열쇠도 안 죽는다.** 열쇠를 그대로 돌려준다. 화면이 좀 이상해도
 *    프로그램은 돈다. 화면 말 하나 때문에 대화가 끊기면 안 된다.
 * 3) **얼마나 됐는지 숨기지 않는다.** 검사가 안 옮긴 열쇠를 세어 적는다.
 *    다 된 척하는 것보다 "298개 중 47개는 아직 한국어" 가 낫다.
 * 4) 기본은 **한국어**다. 시스템 로캘을 안 본다 — 윈도우·WSL 에서
 *    LANG=en_US 인 한국 사람이 많아서, 그걸 보면 멀쩡히 쓰던 사람 화면이
 *    어느 날 영어로 바뀐다. 영어는 **고른 사람만** 본다.
 */
import { ko } from './ko.js';
import { en } from './en.js';

export const 언어들 = ['ko', 'en'];
export const 기본언어 = 'ko';

const 표 = { ko, en };

let 지금 = 기본언어;

/** 넘어온 값을 아는 언어로. 모르면 null. */
export function 언어고르기(값) {
  const v = String(값 ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'ko' || v === 'kr' || v === 'korean' || v === '한국어' || v === '한글') return 'ko';
  if (v === 'en' || v === 'eng' || v === 'english' || v === '영어') return 'en';
  // ko_KR.UTF-8 · en-US 같은 것도 받는다.
  const 앞 = v.split(/[-_.]/)[0];
  return 언어들.includes(앞) ? 앞 : null;
}

/** 지금 언어. */
export function 언어() { return 지금; }

/**
 * 언어를 정한다. 모르는 값이면 안 바꾸고 false.
 * @returns {boolean} 바꿨나
 */
export function 언어정하기(값) {
  const v = 언어고르기(값);
  if (!v) return false;
  지금 = v;
  return true;
}

/**
 * 켤 때 한 번. 환경변수 → 설정 순으로 본다.
 *
 * 환경변수가 이긴다. 한 번만 영어로 켜 보고 싶은 사람이 설정을 건드리지
 * 않고 `DEEL_LANG=en deel` 로 할 수 있어야 한다.
 */
export function 언어잡기({ env = process.env, cfg = null } = {}) {
  지금 = 언어고르기(env.DEEL_LANG) ?? 언어고르기(cfg?.lang) ?? 기본언어;
  return 지금;
}

/**
 * 말 한 마디.
 *
 * @param {string} 열쇠
 * @param {Record<string, string|number>} [채움]  `{이름}` 자리에 끼워 넣을 것
 * @returns {string}
 */
export function 말(열쇠, 채움 = null) {
  const k = String(열쇠 ?? '');
  // 있는 것 → 한국어 → 열쇠. 어느 자리에서도 빈칸이 안 나오게 세 겹으로 받친다.
  const 글 = 표[지금]?.[k] ?? ko[k] ?? k;
  if (!채움) return 글;
  /*
   * 자리 이름에 \w 를 쓰면 안 된다.
   *
   * 한글은 \w 가 아니다. `{안}` 은 영영 안 맞아서 화면에 중괄호째로 찍힌다 —
   * 이 저장소에서 같은 함정을 이미 한 번 밟았다 — commands.js 의 배분 낱말 경계.
   * 자리 이름은 한글로 짓는 편이 읽기 좋으니, 규칙을 글자 종류가 아니라
   * **중괄호와 빈칸이 아닌 것**으로 잡는다.
   *
   * 안 준 자리는 그대로 둔다. 지워 버리면 "0개 턴" 처럼 틀린 말이 되고,
   * 틀린 숫자는 안 적힌 것보다 나쁘다.
   */
  return String(글).replace(/\{([^{}\s]+)\}/g, (통째, 이름) =>
    (Object.prototype.hasOwnProperty.call(채움, 이름) ? String(채움[이름]) : 통째));
}

/** 이 열쇠가 지금 언어로 옮겨져 있나. 검사와 /lang 이 본다. */
export function 옮겨졌나(열쇠, 언어이름 = 지금) {
  return Object.prototype.hasOwnProperty.call(표[언어이름] ?? {}, String(열쇠));
}

/**
 * 얼마나 옮겨졌나.
 *
 * 숨기지 않으려고 둔다. 다 된 척하는 화면보다 "298개 중 47개는 아직
 * 한국어입니다" 가 낫다 — 그래야 도와줄 사람이 어디를 도울지 안다.
 */
export function 옮긴만큼(언어이름 = 지금) {
  const 전부 = Object.keys(ko);
  const 있는것 = 전부.filter((k) => 옮겨졌나(k, 언어이름));
  return {
    언어: 언어이름,
    전체: 전부.length,
    옮김: 있는것.length,
    남음: 전부.length - 있는것.length,
    안옮긴열쇠: 전부.filter((k) => !옮겨졌나(k, 언어이름)),
  };
}

/** 한국어 쪽에 없는 열쇠가 영어 쪽에 있으면 그건 죽은 말이다. 검사가 본다. */
export function 짝없는열쇠(언어이름) {
  return Object.keys(표[언어이름] ?? {}).filter((k) => !Object.prototype.hasOwnProperty.call(ko, k));
}
