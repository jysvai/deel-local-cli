// 색을 유지하면서 폭에 맞춰 접기.
//
// 전에는 전체화면(tui.js)에만 쓰던 것이라 거기 있었다. 전체화면을 걷어내면서
// 여기로 옮긴다 — 입력 상자가 긴 입력을 접을 때 같은 것이 필요하다.
import { width } from './ansi.js';

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
 */
function 한덩이(s, i) {
  let 끝 = i + String.fromCodePoint(s.codePointAt(i)).length;
  for (;;) {
    if (끝 >= s.length) return s.slice(i, 끝);
    const cp = s.codePointAt(끝);
    // ZWJ 는 다음 글자까지 끌고 온다 (👨‍👩‍👧 같은 이어붙인 그림글자)
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

/**
 * 색을 유지하면서 폭에 맞춰 접는다.
 *
 * clip 은 잘라 버리지만 사람이 친 글은 잘리면 안 된다 — 뒷부분이 통째로
 * 사라진다. 그래서 접는다. 색 코드는 폭이 0 이므로 세지 않고, 줄을 넘길 때
 * 마지막으로 켜져 있던 색을 다음 줄 앞에 다시 켜 준다. 안 그러면 접힌 줄부터
 * 색이 풀려 화면이 얼룩덜룩해진다.
 */
export function 접어쓰기(글, 폭) {
  const s = String(글 ?? '');
  /*
   * 줄바꿈(\n)이 있으면 그 자리에서 반드시 갈라진다.
   *
   * 안 가르고 그냥 폭만 재면, \n 도 그저 글자 하나로 세여서(너비는
   * width() 가 정하는 대로) 다음 글자와 한 '줄'에 같이 담긴다. 입력 상자를
   * 그리는 쪽(inputbox.js 의 그리기())은 여기서 나온 배열 길이를 그대로
   * "화면에 몇 줄 찍었나" 로 믿고 커서를 되짚어 올라가므로, \n 이 숨어
   * 있으면 터미널이 실제로 그린 줄 수와 어긋나 화면이 깨진다. 문단마다
   * 따로 접어서 이 배열이 실제 화면 줄 수와 늘 같게 만든다.
   */
  if (s.includes('\n')) return s.split('\n').flatMap((줄) => 접어쓰기(줄, 폭));
  if (폭 < 2) return [s];
  if (width(s) <= 폭) return [s];

  /*
   * 접힌 줄에 앞 들여쓰기를 물려 준다.
   *
   * 안 물려 주면 `  ▌ 모델의 답…` 이 접히는 순간 다음 줄이 왼쪽 끝에서
   * 시작한다. 화면에서 세로줄이 끊겨 보이고, 도구 결과의 `    └ …` 도
   * 두 번째 줄부터 갑자기 튀어나온다 — 무엇에 딸린 글인지 알 수 없게 된다.
   * 들여쓴 만큼은 글자 자리에서 빼야 하므로 접는 폭도 같이 줄인다.
   */
  const 들여 = (/^ */.exec(s)[0] ?? '').slice(0, Math.max(0, 폭 - 8));
  const 이어폭 = Math.max(2, 폭 - 들여.length);

  const 줄들 = [];
  let 지금 = '';
  let w = 0;
  let 색 = '';                       // 지금 켜져 있는 SGR

  for (let i = 0; i < s.length;) {
    // 색 코드는 통째로 옮긴다. 폭에는 안 센다.
    if (s[i] === '\x1b') {
      const m = /^\x1b\[[0-9;]*m/.exec(s.slice(i));
      if (m) {
        지금 += m[0];
        색 = /\x1b\[0?m/.test(m[0]) ? '' : 색 + m[0];
        i += m[0].length;
        continue;
      }
    }
    const ch = 한덩이(s, i);
    const cw = width(ch);
    // 첫 줄은 원래 폭, 접힌 줄부터는 들여쓴 만큼 좁아진다.
    const 한도 = 줄들.length === 0 ? 폭 : 이어폭 + 들여.length;
    if (w + cw > 한도) {
      줄들.push(지금 + (색 ? '\x1b[0m' : ''));
      지금 = 들여 + 색;
      w = 들여.length;
    }
    지금 += ch;
    w += cw;
    i += ch.length;
  }
  if (지금.trim() !== '' || 줄들.length === 0) 줄들.push(지금 + (색 ? '\x1b[0m' : ''));
  return 줄들;
}
