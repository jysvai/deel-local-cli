/**
 * README 머리 그림을 만든다 — 터미널이 켤 때 그리는 그 글자 그대로.
 *
 * 그림을 손으로 그리지 않는 이유: 배너 글꼴(src/ui/banner.js)이 바뀌면 README
 * 얼굴과 터미널 얼굴이 갈라진다. 여기서 글꼴을 **읽어다** 그리므로, 글자가
 * 바뀌면 이 스크립트를 다시 돌리는 것만으로 두 얼굴이 다시 같아진다.
 *
 *   node tools/make-hero.mjs
 *
 * 밝은 판·어두운 판을 따로 낸다. GitHub 는 <picture> 의 prefers-color-scheme
 * 을 지키므로, 어느 쪽 화면에서 열어도 글자가 배경에 묻히지 않는다.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { 글꼴, 이름 } from '../src/ui/banner.js';

const 칸 = 14;      // 한 칸 크기(px)
const 사이 = 1;     // 글자 사이 칸 수 — banner.js 와 같은 값
const 여백 = 26;

/** 한 줄에서 이어진 `#` 를 사각형 하나로 묶는다. 조각이 적을수록 파일이 작다. */
function 줄묶기(줄, x0, y) {
  const 것들 = [];
  let 시작 = -1;
  for (let i = 0; i <= 줄.length; i += 1) {
    const 참 = 줄[i] === '#';
    if (참 && 시작 < 0) 시작 = i;
    if (!참 && 시작 >= 0) {
      것들.push({ x: x0 + 시작 * 칸, y, w: (i - 시작) * 칸, h: 칸 });
      시작 = -1;
    }
  }
  return 것들;
}

/** 이름 전체를 사각형 목록으로. 글자마다 색이 한 단씩 밝아진다. */
function 글자들(x0, y0) {
  const 것들 = [];
  let x = x0;
  for (const [n, ch] of [...이름].entries()) {
    const 무늬 = 글꼴[ch];
    for (const [r, 줄] of 무늬.entries()) {
      for (const 조각 of 줄묶기(줄, x, y0 + r * 칸)) 것들.push({ ...조각, 단: n });
    }
    x += (무늬[0].length + 사이) * 칸;
  }
  return { 것들, 끝: x - 사이 * 칸 };
}

const 판 = {
  light: {
    // 왼쪽이 어둡고 오른쪽이 밝다 — 이름이 왼쪽부터 자라는 방향과 같다.
    // 한 가지 색의 밝기만 쓴다. 여러 색을 쓰면 그 색이 아무 뜻도 못 갖는다.
    글: ['#166534', '#15803d', '#16a34a', '#22c55e'],
    선: '#16a34a',
    곁: '#57606a',
  },
  dark: {
    글: ['#15803d', '#16a34a', '#22c55e', '#4ade80'],
    선: '#22c55e',
    곁: '#8b949e',
  },
};

const 곁말 = {
  ko: '이 컴퓨터 안에서만',
  en: 'stays on this machine',
};

function 그리기(말, 결) {
  const p = 판[결];
  const y0 = 여백;
  const { 것들, 끝 } = 글자들(여백, y0);
  const 글높이 = 7 * 칸;

  // 경계선. 글자 밑에서 **닫힌다** — 이 선이 곧 경계라는 말이다.
  const 선y = y0 + 글높이 + 22;
  const 틱 = 9;
  const 선 = `M ${여백} ${선y - 틱} L ${여백} ${선y - 4} Q ${여백} ${선y} ${여백 + 4} ${선y} L ${끝 - 4} ${선y} Q ${끝} ${선y} ${끝} ${선y - 4} L ${끝} ${선y - 틱}`;

  const 글자수 = 곁말[말].length;
  const 곁폭 = 말 === 'ko' ? 글자수 * 17 + 30 : 글자수 * 8.6 + 30;
  const W = Math.round(끝 + 18 + 곁폭 + 여백);
  const H = 선y + 여백;

  const 사각 = 것들
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${p.글[r.단] ?? p.글.at(-1)}"/>`)
    .join('\n  ');

  const 글꼴이름 = 말 === 'ko'
    ? "'Pretendard','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif"
    : "'SF Mono','Cascadia Mono','Segoe UI',system-ui,sans-serif";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="deel — ${곁말[말]}">
  <title>deel — ${곁말[말]}</title>
  ${사각}
  <path d="${선}" fill="none" stroke="${p.선}" stroke-width="2.5" stroke-linecap="round"/>
  <text x="${끝 + 18}" y="${선y + 1}" fill="${p.선}" font-family="${글꼴이름}" font-size="17" dominant-baseline="middle">⌂</text>
  <text x="${끝 + 42}" y="${선y + 1}" fill="${p.곁}" font-family="${글꼴이름}" font-size="16" dominant-baseline="middle">${곁말[말]}</text>
</svg>
`;
}

mkdirSync('docs/assets', { recursive: true });
for (const 말 of ['ko', 'en']) {
  for (const 결 of ['light', 'dark']) {
    const 자리 = `docs/assets/hero-${말}-${결}.svg`;
    writeFileSync(자리, 그리기(말, 결), 'utf8');
    console.log(자리);
  }
}
