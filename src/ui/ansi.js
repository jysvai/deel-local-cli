// 화면 출력 기본기 — 색, 커서, 폭 계산, 상자. 외부 의존성 없음.

// 파이프로 넘길 때도 색을 보고 싶으면 FORCE_COLOR=1
const ON = (process.stdout.isTTY || process.env.FORCE_COLOR === '1') && process.env.NO_COLOR === undefined;

const E = (n) => (s) => (ON ? `\x1b[${n}m${s}\x1b[0m` : String(s));

// 흐린 글자의 밝기. 256색을 못 쓰는 옛 콘솔이면 90 으로 되돌린다.
function GRAY() {
  const 뜻 = String(process.env.DEEL_CONTRAST ?? '').toLowerCase();
  if (뜻 === 'low') return 90;
  const 옛콘솔 = process.env.TERM === 'dumb';
  if (옛콘솔) return 뜻 === 'high' ? 37 : 90;
  return 뜻 === 'high' ? '38;5;252' : '38;5;245';
}

export const c = {
  dim: E(2),
  bold: E(1),
  italic: E(3),
  under: E(4),
  red: E(31),
  green: E(32),
  yellow: E(33),
  blue: E(34),
  magenta: E(35),
  cyan: E(36),
  white: E(37),
  // 흐린 글자.
  //
  // 예전에는 90(밝은 검정)이었는데, 배경이 어두우면 배경에 묻히고 밝으면
  // 더 안 보인다. 실제로 "연한 글자가 잘 안 보인다" 는 말을 들었다.
  // 그래서 어느 배경에서도 읽히는 중간 회색을 기본으로 쓴다.
  //
  // 눈에 맞게 바꿀 수 있다:
  //   DEEL_CONTRAST=high  더 밝게 (밝은 배경이나 눈이 피로할 때)
  //   DEEL_CONTRAST=low   예전처럼 흐리게
  gray: E(GRAY()),
  // 밝은 계열 — 어두운 배경에서 본문과 구분이 필요할 때
  hred: E(91),
  hgreen: E(92),
  hyellow: E(93),
  hblue: E(94),
  hmagenta: E(95),
  hcyan: E(96),
  bgRed: E(41),
  bgGreen: E(42),
  bgBlue: E(44),
  bgGray: E(100),
};

/**
 * 256색 한 칸. 큰 글자(intro.js)의 깊이를 낼 때 쓴다.
 *
 * 옛 콘솔(TERM=dumb)은 256색을 모른다. 거기서는 번호가 글에 그대로 찍히므로
 * 아무 색도 안 입힌다 — 색이 없는 것보다 숫자가 새는 것이 훨씬 나쁘다.
 */
export const 색256가능 = () => process.env.TERM !== 'dumb';
export const 번호색 = (n) => (s) => (ON && 색256가능() ? `[38;5;${n}m${s}[0m` : String(s));

export const cursor = {
  hide: () => ON && process.stdout.write('\x1b[?25l'),
  show: () => ON && process.stdout.write('\x1b[?25h'),
  up: (n = 1) => ON && process.stdout.write(`\x1b[${n}A`),
  clearLine: () => ON && process.stdout.write('\x1b[2K\r'),
  // 여러 조각을 한 덩이로 묶어 한 번에 내보낼 때 쓰는 글자값.
  //
  // 나눠 쓰면 그 사이가 화면에 그대로 보인다. 커서를 숨기기 전에 지우는 글이
  // 먼저 나가면, 커서가 상자 안을 훑고 지나가는 것이 눈에 띈다.
  숨김: ON ? '\x1b[?25l' : '',
  보임: ON ? '\x1b[?25h' : '',
};

/*
 * 한 판을 다 그린 뒤에 한 번에 보여 달라 (synchronized output, DEC 2026).
 *
 * 한 번의 write 로 보내도 터미널은 받는 대로 그린다. 그래서 열두 줄이 같이
 * 바뀌는 판에서는 고쳐 그리는 중간 모습이 눈에 들어온다 — 잔상·찢김으로 보인다.
 * 이 두 표 사이에 든 것은 다 받은 뒤에 한 번에 바뀐다.
 *
 * 모르는 터미널은 **그냥 무시한다**. 사설 모드라 못 알아들으면 아무 일도
 * 안 일어난다 — 켜지는 데서만 좋아지고 나머지는 그대로다. (맥 기본 터미널은
 * 이걸 모른다. 거기 떨림은 이걸로 안 잡힌다.)
 *
 * 색과 달리 ON 으로 안 막는다. 이걸 쓰는 자리는 입력 상자 하나뿐인데 그
 * 화면은 터미널일 때만 켜진다 — 거기서 한 겹 더 막으면 막힌 것을 모르고
 * 「안 나가는데」를 좋게 겪는다(처음 넣을 때 실제로 그랬다). 색이 아니므로
 * NO_COLOR 과도 상관없다.
 */
export const 판시작 = '\x1b[?2026h';
export const 판끝 = '\x1b[?2026l';

/*
 * ── 바깥에서 온 글에 섞인 터미널 제어 순서를 뗀다 (2.0.0 3회차 사냥) ─────
 *
 * 모델 답은 우리가 쓴 글이 아니다. 모델이 읽은 파일 · 웹 페이지 · 도구 출력에 든 글이 그대로
 * 되풀려 오기도 한다. 그 안에 ESC 로 시작하는 순서가 있으면 터미널은 **글자가 아니라 명령으로**
 * 받는다. 마크다운 그리개가 이것을 그대로 흘려보내고 있었다:
 *
 *     ESC ]52;c;…BEL      클립보드를 몰래 바꾼다 (붙여넣은 명령이 다른 명령이 된다)
 *     ESC ]8;;주소 ESC \  보이는 글과 다른 곳으로 가는 링크
 *     ESC [1A ESC [2K     윗줄 「✗ 실패」 를 「✓ 통과」 로 덮어쓴다
 *     ESC [2J · \b · \r   화면을 지우거나 이미 찍힌 글을 덮는다
 *     ESC ]2;…            창 제목
 *
 * 줄바꿈과 탭만 남기고 제어 글자(C0 · DEL · C1)와 그 순서를 통째로 뗀다. 순서를 통째로 떼야
 * `[2J` 같은 찌꺼기가 안 남는다. 토막 사이에서 순서가 끊겨 와도 ESC 와 BEL 자체는 각 토막에서
 * 빠지므로 터미널에 명령으로 닿지 않는다 — 남는 것은 보이는 글자뿐이다.
 */
// 글자가 놓이는 **방향**을 뒤집는 문자(RLO · LRE · 격리 …). 화면에서 `rm txt.exe` 가 다른 이름으로
// 보이게 만든다(Trojan Source). 이 파일에 보이지 않는 글자를 직접 적지 않으려고 코드값으로 만든다.
const 방향틀기 = new RegExp(`[${String.fromCharCode(0x202a)}-${String.fromCharCode(0x202e)}${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}]`, 'g');

/*
 * 순서를 **끝난 것만** 통째로 뗀다 (Gemini 2차 검토). 마침 글자(BEL · ESC \) 가 없는 OSC 를 끝까지 삼키면
 * 뒤따르는 답과 diff 가 통째로 사라졌다 — 글을 잃는 것이 제일 나쁘다. 끝 안 난 순서는 머리(ESC ])만
 * 떼면 터미널이 명령으로 못 받고, 몸통은 보이는 글자로 남는다.
 */
export function 화면글거르기(글, { 색남김 = false } = {}) {
  /*
   * `색남김` — 우리가 입힌 색(SGR `ESC [ … m`)은 두고 **그 사이**만 거른다. say 처럼 우리 색과 바깥 글이
   * 한 줄에 섞여 나가는 자리에서 쓴다(할 일 목록 · 서버가 준 모델 이름 · 승인 물음). 바깥 글에 든 색 코드도
   * 남지만 색은 명령이 아니라 모양뿐이다.
   */
  if (색남김) {
    return String(글 ?? '').split(/(\x1b\[[0-9;]*m)/).map((조각, i) => (i % 2 ? 조각 : 화면글거르기(조각))).join('');
  }
  return String(글 ?? '')
    .replace(/\x1b\][^\x07\x1b\n]*(?:\x07|\x1b\\)/g, '')   // OSC — 클립보드 · 링크 · 제목 (끝난 것만)
    .replace(/\x1b[PX^_][^\x1b\n]*\x1b\\/g, '')            // DCS · SOS · PM · APC (끝난 것만)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')               // CSI — 커서 · 지우기 · 색
    .replace(/\x9b[0-?]*[ -/]*[@-~]/g, '')                 // 8비트 CSI
    .replace(/\x1b[ -/]*[0-~]?/g, '')                      // ESC 두 글자 꼴(ESC 7 · ESC ( 0 · ESC c) · 끝 안 난 순서의 머리 · 홀 ESC
    .replace(/\r\n/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')         // 남은 제어 글자 (\t · \n 빼고)
    .replace(방향틀기, '');
}

/*
 * ── 칸을 안 먹는 글자 · 두 칸 먹는 그림글자 ────────────────────────────
 *
 * 입력 상자와 접어쓰기가 이 값으로 **화면 줄 수**를 센다. 한 칸이라도 모자라게 세면 줄이
 * 터미널보다 넓어져 터미널은 두 줄로 접고 상자는 한 줄로 센다 — 키를 칠 때마다 위쪽 대화가
 * 갉여 나간다(inputbox.js 머리말). 재 보니 이런 자리가 있었다:
 *
 *   ✅ ❌ ⚡ ⭐ ☕       한 칸으로 셌다. 터미널은 두 칸에 그린다(Emoji_Presentation).
 *   🫠 (U+1FA70~)      그림글자 표를 1F9FF 에서 끊어 한 칸으로 셌다.
 *   𠀀 (한자 확장 B~)   한 칸으로 셌다.
 *   ZWSP·ZWJ·결합 부호  한 칸씩 셌다. 터미널은 칸을 안 준다.
 *   가족 그림(ZWJ 이음) 여덟 칸으로 셌다. 터미널은 두 칸 하나로 겹쳐 그린다.
 *   풀어 쓴 한글(NFD)   ㅎ+ㅏ+ㄴ 을 네 칸으로 셌다. 가운뎃소리·끝소리는 앞 글자에 붙는다.
 *
 * U+2600~27BF 는 섞여 있다. ✅ ⚡ 처럼 그림으로 그리는 것(Emoji_Presentation)만 두 칸이고,
 * ✓ ✗ ⚠ ★ → 같은 글자 꼴은 한 칸이다. deel 이 화면에 그리는 표시가 바로 그쪽이라, 넓게 잡으면
 * 상태줄·표가 한 칸씩 밀린다. 그래서 범위가 아니라 속성으로 가른다.
 */
const 칸없음 = /^[\p{Mn}\p{Me}\p{Cf}]$/u;
const 그림으로그림 = /^\p{Emoji_Presentation}$/u;
const 그림글자 = /^\p{Extended_Pictographic}$/u;

function 넓은가(cp, ch) {
  return (cp >= 0x1100 && cp <= 0x115f)
    || (cp >= 0x2e80 && cp <= 0xa4cf)
    || (cp >= 0xa960 && cp <= 0xa97f)       // 한글 첫소리 확장
    || (cp >= 0xac00 && cp <= 0xd7a3)
    || (cp >= 0xf900 && cp <= 0xfaff)
    || (cp >= 0xfe30 && cp <= 0xfe6f)
    || (cp >= 0xff00 && cp <= 0xff60)
    || (cp >= 0xffe0 && cp <= 0xffe6)
    || (cp >= 0x1f300 && cp <= 0x1f9ff)
    || (cp >= 0x1fa70 && cp <= 0x1faff)     // 그림글자 확장 A
    || (cp >= 0x20000 && cp <= 0x3fffd)     // 한자 확장 B 부터
    || 그림으로그림.test(ch);
}

/*
 * ── 한 칸 바탕을 두 칸 그림으로 바꾸는 꼬리 · 국기 짝 (Gemini 화면4) ─────────
 *
 * U+FE0F 는 「그림으로 그려라」 는 표시다. 윈도 터미널·iTerm2·kitty 는 하트·경고·체크 뒤에 이것이
 * 붙으면 **두 칸**에 그린다. 우리는 바탕 한 칸 + 선택자 0칸 = 한 칸으로 셌다 — 모델 답에 흔한
 * 모양이라 한 줄에 하나만 있어도 입력 상자가 줄 수를 틀려 위쪽 대화가 갉여 나갔다. 키캡(1+FE0F
 * +20E3)과 한 칸 그림(검지 U+261D)에 붙은 살색 조절도 그랬다.
 *
 * 국기는 거꾸로였다. 지역 표시 글자 둘이 두 칸 하나에 겹치는데 둘 다 두 칸으로 세어 넷이 됐다.
 * 짝을 짓는 것은 앞에서부터 둘씩이다(🇺🇸🇰🇷 는 넷 칸, 홀로 남은 반쪽은 두 칸).
 *
 * 선택자가 없는 ⚠ ✔ 는 여전히 한 칸이다 — deel 이 그리는 표시가 그쪽이다(위 머리말). 숫자 뒤
 * FE0F 만으로는 키캡이 아니고(1+FE0F 는 한 칸), 20E3 이 붙어야 두 칸이다.
 */
const 지역표시인가 = (cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const 키캡바탕인가 = (cp) => (cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a;

// 한글·한자·가나는 터미널에서 두 칸을 차지한다. 표 정렬이 이걸 모르면 어긋난다.
export function width(str) {
  let w = 0;
  // 바로 앞 글자가 ZWJ 였나 · 그림글자였나. 이어붙인 그림은 앞 그림과 한 칸에 겹친다.
  let 앞이음 = false;
  let 앞그림 = false;
  // 바로 앞 바탕 글자와 그 글자에 준 칸 수. 칸 안 먹는 글자(ZWJ·결합 부호)는 이 값을 안 바꾼다.
  let 바탕 = -1;
  let 바탕칸 = 0;
  // 짝을 기다리는 지역 표시 글자가 바로 앞에 있나.
  let 반쪽국기 = false;
  // 없는 값은 빈 글자로 본다.
  //
  // String(null) 은 'null' 이라 폭이 4 로 나온다. 그러면 상태줄이 네 칸씩
  // 어긋나고, 화면에는 'null' 이라는 글자가 그대로 찍힌다. 모델 이름이나
  // 곁말은 없을 수 있는 값이라 실제로 여기로 들어온다.
  if (str === null || str === undefined) return 0;
  for (const ch of String(str).replace(/\x1b\[[0-9;]*m/g, '')) {
    const cp = ch.codePointAt(0);
    const 이음뒤 = 앞이음;
    const 그림뒤 = 앞그림;
    앞이음 = cp === 0x200d;
    // 거의 다 여기서 끝난다 — 로마자·숫자·기호. 속성 검사는 비싸고 이 함수는 자주 불린다.
    if (cp < 0x0300) { 앞그림 = false; 반쪽국기 = false; 바탕 = cp; 바탕칸 = 1; w += 1; continue; }
    // 그림으로 그리라는 선택자 · 키캡 꼬리 — 한 칸 바탕을 두 칸으로 넓힌다 (위 머리말).
    if (cp === 0xfe0f || cp === 0x20e3) {
      const 넓힌다 = 바탕칸 === 1
        && (cp === 0xfe0f ? 그림글자.test(String.fromCodePoint(바탕)) : 키캡바탕인가(바탕));
      if (넓힌다) { w += 1; 바탕칸 = 2; }
      앞그림 = cp === 0xfe0f && 그림뒤;
      continue;
    }
    const 그림 = 그림글자.test(ch);
    const 살색 = cp >= 0x1f3fb && cp <= 0x1f3ff;
    // 그림 뒤에 붙는 ZWJ · 변형 선택자 · 살색 조절은 「아직 그 그림」 이다.
    앞그림 = 그림 || (그림뒤 && (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || 살색));
    if (칸없음.test(ch)) continue;
    // 풀어 쓴 한글의 가운뎃소리·끝소리는 앞 첫소리 칸에 겹친다.
    if ((cp >= 0x1160 && cp <= 0x11ff) || (cp >= 0xd7b0 && cp <= 0xd7ff)) continue;
    // ZWJ 뒤의 그림은 앞 그림과 같은 칸이다.
    if (이음뒤 && 그림) continue;
    // 그림 뒤의 살색 조절도 같은 칸이다 — 다만 한 칸 그림이었으면 두 칸으로 넓힌다.
    if (그림뒤 && 살색) { if (바탕칸 === 1) { w += 1; 바탕칸 = 2; } continue; }
    // 국기 반쪽 둘은 두 칸 하나다.
    if (지역표시인가(cp)) {
      if (반쪽국기) { 반쪽국기 = false; continue; }
      반쪽국기 = true;
    } else {
      반쪽국기 = false;
    }
    const 칸 = 넓은가(cp, ch) ? 2 : 1;
    바탕 = cp;
    바탕칸 = 칸;
    w += 칸;
  }
  return w;
}

/*
 * i 자리에서 **눈에 보이는 한 덩이**를 통째로 떼어 온다.
 *
 * 글자를 s[i] 로 한 칸씩 읽으면 UTF-16 코드 단위로 잘린다. 😀 같은 글자는
 * 두 칸을 차지하므로 하필 그 사이에서 줄이 접히면 반쪽짜리 서로게이트가
 * 양쪽 줄에 하나씩 남는다 — 접어쓰기("a😀", 2) 가 ["a\ud83d","\ude00"] 를
 * 내놨다. 화면에는 물음표 두 개로 찍히고, 폭 계산도 그때부터 어긋난다.
 *
 * 그래서 코드 포인트로 읽고, 뒤에 붙는 것들(살색 조절·변형 선택자·결합
 * 부호·ZWJ 로 이어붙인 다음 글자)까지 한 덩이로 본다. 완전한 문자소 분할은
 * 아니지만 — 그건 표가 있어야 한다 — 실제로 깨지던 자리는 이걸로 다 막힌다.
 *
 * 접어쓰기(wrap.js)에만 있던 것을 여기로 옮겼다. clip 은 코드 포인트 하나씩 잘라서 그림과
 * 선택자·ZWJ 사이를 끊었다 — 자른 끝에 ZWJ 가 남으면 뒤에 붙는 말줄임표와 겹쳐 그려지고,
 * 선택자가 떨어지면 두 칸 그림이 한 칸 글 모양으로 바뀐다. 국기 짝도 한 덩이다 — 반쪽 국기
 * 둘은 글자 두 개로 그려진다(위 width 머리말).
 */
export function 한덩이(s, i) {
  const 첫 = s.codePointAt(i);
  let 끝 = i + String.fromCodePoint(첫).length;
  if (지역표시인가(첫) && 끝 < s.length && 지역표시인가(s.codePointAt(끝))) 끝 += 2;
  for (;;) {
    if (끝 >= s.length) return s.slice(i, 끝);
    const cp = s.codePointAt(끝);
    // ZWJ 는 다음 글자까지 끌고 온다 (가족 그림처럼 이어붙인 그림글자)
    if (cp === 0x200d) {
      const 다음 = 끝 + 1;
      if (다음 >= s.length) return s.slice(i, 끝);
      끝 = 다음 + String.fromCodePoint(s.codePointAt(다음)).length;
      continue;
    }
    const 딸린것 = (cp >= 0xfe00 && cp <= 0xfe0f)        // 변형 선택자
      || (cp >= 0x1f3fb && cp <= 0x1f3ff)               // 살색 조절
      || (cp >= 0x0300 && cp <= 0x036f)                 // 결합 부호
      || cp === 0x20e3;                                 // 키캡
    if (!딸린것) return s.slice(i, 끝);
    끝 += String.fromCodePoint(cp).length;
  }
}

export function pad(str, target, align = 'left') {
  const gap = Math.max(0, target - width(str));
  if (align === 'right') return ' '.repeat(gap) + str;
  if (align === 'center') {
    const l = Math.floor(gap / 2);
    return ' '.repeat(l) + str + ' '.repeat(gap - l);
  }
  return str + ' '.repeat(gap);
}

/**
 * 색 코드를 건드리지 않고 보이는 폭 기준으로 자른다.
 *
 * 색 코드는 화면에서 자리를 차지하지 않으므로 폭에서 빼야 하고, 그 가운데를
 * 자르면 안 된다. 한 글자씩 셈에 넣으면 둘 다 어긋난다 — 회색 한 줄
 * `\x1b[38;5;245m…\x1b[0m` 은 색 코드만으로 열두 칸을 먹어서, 폭 12 로
 * 자르면 보이는 글자가 한 칸만 남고 잘린 자리가 `\x1b[38;5;` 라는 토막이
 * 된다. 터미널은 그 토막을 명령의 시작으로 보고 뒤따르는 글자를 먹는다.
 *
 * 그래서 색 코드는 통째로 넘기고 폭 0 으로 센다. 자른 자리에서 색이 켜져
 * 있으면 되돌림을 붙인다 — 안 붙이면 그 색이 뒤에 찍는 모든 줄로 번진다.
 */
export function clip(str, max, tail = '…') {
  if (width(str) <= max) return str;
  /*
   * 꼬리보다 좁은 칸 (Gemini 화면5). 남은 예산이 음수여도 꼬리를 붙여서 `clip('테스트', 0)` 이 「…」
   * 한 칸, 꼬리가 두 칸이면 `max 1` 에 두 칸을 냈다 — 좁은 창에서 줄이 넘친다. 칸이 없으면 빈 글,
   * 꼬리가 안 들어가면 꼬리 없이 자른다.
   */
  if (!(max > 0)) return '';
  if (width(tail) > max) return clip(str, max, '');
  const budget = max - width(tail);
  let out = '';
  let w = 0;
  let 색켜짐 = false;
  let 찼다 = false;
  for (const 조각 of String(str).split(/(\x1b\[[0-9;]*m)/)) {
    if (!조각) continue;
    if (찼다) break;
    if (조각.charCodeAt(0) === 0x1b) {
      out += 조각;
      색켜짐 = !/^\x1b\[0?m$/.test(조각);
      continue;
    }
    // 코드 포인트가 아니라 보이는 덩이로 자른다 — 그림과 선택자·ZWJ 사이를 안 끊는다 (한덩이 머리말).
    for (let i = 0; i < 조각.length;) {
      const ch = 한덩이(조각, i);
      i += ch.length;
      const cw = width(ch);
      if (w + cw > budget) { 찼다 = true; break; }
      out += ch;
      w += cw;
    }
  }
  return out + (색켜짐 ? '\x1b[0m' : '') + tail;
}

// 터미널 가로 폭. 파이프로 넘어가면 알 수 없으니 넉넉히 잡는다.
export const cols = () => process.stdout.columns || 100;

// 줄 하나를 낸다. 여기로 바깥 글(할 일 · 모델 이름 · 플러그인 설명 …)이 곧장 오므로 들어온 제어 순서를 뗀다 —
// 우리 색은 남긴다(화면글거르기 머리말). 커서 옮기기 같은 우리 제어는 이 길을 안 쓴다(cursor · 판시작).
export const say = (s = '') => process.stdout.write(화면글거르기(s, { 색남김: true }) + '\n');

export function rule(label = '', total = 64) {
  if (!label) return say(c.gray('─'.repeat(total)));
  const left = '── ' + label + ' ';
  say(c.gray(left + '─'.repeat(Math.max(0, total - width(left)))));
}

// 채움 막대. 반쪽 칸까지 써서 좁은 폭에서도 눈금이 보인다.
export function bar(used, total, cells = 32) {
  // 말이 안 되는 셈은 0 으로 본다 — 아래 gauge() 와 같은 까닭이다.
  // Math.min 은 NaN 을 그대로 흘려 repeat(NaN) 이 빈 글자가 되고(막대가 통째로
  // 사라진다), 음수는 repeat(-4) 로 **던진다** — 화면 한 칸이 프로그램을 죽인다.
  const 몫 = Number(used) / Number(total);
  const ratio = total > 0 && Number.isFinite(몫) ? Math.min(1, Math.max(0, 몫)) : 0;
  const exact = ratio * cells;
  const full = Math.floor(exact);
  const half = exact - full >= 0.5 && full < cells;
  const tone = ratio > 0.85 ? c.red : ratio > 0.6 ? c.yellow : c.green;
  return tone('█'.repeat(full) + (half ? '▌' : '')) + c.gray('░'.repeat(cells - full - (half ? 1 : 0)));
}

// 상태줄용 얇은 막대.
export function gauge(ratio, cells = 10) {
  // 숫자가 아니면 0 으로 본다.
  //
  // Math.min/max 는 NaN 을 그대로 흘린다. 그러면 repeat(NaN) 이 빈 글자가 되어
  // 막대가 통째로 사라지고, 그만큼 상태줄이 밀린다. 컨텍스트 총량이 0 일 때
  // used/total 이 실제로 NaN 이 된다 — 새 연결에서 드물게 나온다.
  const n = Number(ratio);
  const r = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  const filled = Math.round(r * cells);
  const tone = r > 0.85 ? c.hred : r > 0.6 ? c.hyellow : c.hgreen;
  return tone('▰'.repeat(filled)) + c.gray('▱'.repeat(cells - filled));
}

/**
 * 눈금이 있는 게이지.
 *
 * 게이지가 차는 것은 보이는데 **언제 무슨 일이 나는지**는 안 보였다. 55% 를
 * 넘으면 오래된 도구 결과를 접기 시작하고, 80% 를 넘으면 대화를 요약한다.
 * 둘 다 사람 눈에는 갑자기 일어나는 일이라 — 어느 날 갑자기 "앞선 대화를
 * 줄였습니다" 가 뜨고, 모델이 방금 읽은 파일을 잊는다.
 *
 * 그래서 그 자리에 눈금을 미리 그어 둔다. 막대가 다가가는 것이 보이면
 * 사람이 먼저 손을 쓸 수 있다 — 못 박아 두거나(/pin), 갈래를 새로 파거나.
 * 지나간 눈금은 안 그린다. 이미 일어난 일을 계속 가리킬 이유가 없고,
 * 남겨 두면 막대가 눈금에 가려 어디까지 찼는지가 흐려진다.
 *
 * @param {number} ratio
 * @param {number} cells
 * @param {number[]} 눈금  0~1 사이 자리들
 */
export function 눈금게이지(ratio, cells = 10, 눈금 = []) {
  const n = Number(ratio);
  const r = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  const filled = Math.round(r * cells);
  const tone = r > 0.8 ? c.hred : r > 0.55 ? c.hyellow : c.hgreen;
  const 눈금칸 = new Set(
    (Array.isArray(눈금) ? 눈금 : [])
      .map((v) => Math.min(cells - 1, Math.max(0, Math.floor(Number(v) * cells))))
      .filter((v) => Number.isFinite(v)),
  );
  let out = '';
  for (let i = 0; i < cells; i++) {
    if (i < filled) out += tone('▰');
    else if (눈금칸.has(i)) out += c.white('┆');
    else out += c.gray('▱');
  }
  return out;
}

const BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };

/**
 * 둥근 모서리 상자. 안쪽 폭은 가장 긴 줄에 맞춘다.
 * @param {string[]} lines  색이 들어 있어도 폭 계산은 맞는다.
 */
export function box(lines, { title = '', pad: gap = 1, tone = c.gray, max = cols() - 4 } = {}) {
  const body = lines.map((l) => clip(l, max - gap * 2 - 2));
  const inner = Math.max(
    // 윗줄은 `╭─ 이름 ` 까지가 다섯 칸이고 오른쪽 모서리가 한 칸이다. 안쪽이
    // 이름+3 보다 좁으면 윗줄만 길어져 테두리가 한 칸 어긋난다(여백 0 이면 늘 그렇다).
    //
    // 이름이 없으면 그 바닥도 없다. 빈 이름에 +3 을 하면 안쪽 폭이 3 아래로 못 내려가
    // 한 글자짜리 상자가 세 칸으로 그려진다 — 위 JSDoc 이 적은 「가장 긴 줄에 맞춘다」 와
    // 어긋난다 (8회차 AN1).
    title ? width(title) + 3 : 0,
    ...body.map((l) => width(l)),
  ) + gap * 2;
  const top = title
    ? BOX.tl + BOX.h + ' ' + title + ' ' + BOX.h.repeat(Math.max(0, inner - width(title) - 3)) + BOX.tr
    : BOX.tl + BOX.h.repeat(inner) + BOX.tr;
  const out = [tone(top)];
  for (const l of body) out.push(tone(BOX.v) + ' '.repeat(gap) + pad(l, inner - gap * 2) + ' '.repeat(gap) + tone(BOX.v));
  out.push(tone(BOX.bl + BOX.h.repeat(inner) + BOX.br));
  return out;
}

export const mark = {
  ok: c.green('✓'),
  no: c.red('✗'),
  warn: c.yellow('⚠'),
  dot: c.cyan('⏺'),
  arrow: c.gray('›'),
  think: c.magenta('✻'),
  run: c.hcyan('▶'),
  bar: c.gray('▏'),
  tree: c.gray('└'),
  branch: c.gray('├'),
};
