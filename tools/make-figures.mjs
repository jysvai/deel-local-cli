// 설명용 그림 만들기 — 화면 사진이 아니라 「이게 어떻게 돌아가는가」 를 한 장으로.
//
// ── 왜 따로 있나 ───────────────────────────────────────────────────────
//
// docs/assets 에 있던 것은 전부 **화면 사진**(tools/shot.mjs)이다. 사진은
// 「이렇게 보인다」 를 말할 뿐, 「왜 이 순서인가 · 어디서 막히나 · 무엇이
// 선을 안 넘나」 는 한 장도 말하지 않는다. 그 자리를 여기서 채운다.
//
// ── 왜 SVG 인가 ────────────────────────────────────────────────────────
//
// shot.mjs 머리말과 같은 까닭이다. PNG 는 커지고 흐려지고 덩어리로 쌓인다.
// SVG 는 글자가 글자로 남아 선명하고 몇 KB 고 diff 가 읽힌다. 밝은 판·어두운
// 판을 따로 내서 <picture> 로 고르게 한다.
//
// ── 칸을 어떻게 맞추나 ─────────────────────────────────────────────────
//
// 한글은 두 칸이고 라틴은 한 칸인데, 브라우저 글꼴은 그 비를 지켜 주지
// 않는다. 그래서 shot.mjs 와 똑같이 **덩이마다 칸 수를 재서 textLength 로
// 못 박는다**(src/ui/ansi.js 의 width). 한 칸은 글자크기의 0.6배다 —
// shot.mjs 의 14px·8.4px 와 같은 비다. 어떤 글꼴로 그려도 상자 밖으로
// 글이 삐져나가지 않는다.
//
// ── 손으로 적지 않는 것 ────────────────────────────────────────────────
//
// 모드 표의 값(이름 · 표시 · 파일을 바꾸나 · 생각 · 걸음 상한)은 전부
// src/agent/modes.js 와 src/agent/budget.js 에서 **읽어다** 그린다. 손으로
// 적어 두면 표가 바뀐 날 그림만 혼자 옛말을 한다.
//
//   node tools/make-figures.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { width } from '../src/ui/ansi.js';
import { 이름 } from '../src/ui/banner.js';
import { MODES, ORDER, canWrite } from '../src/agent/modes.js';
import { 걸음수 } from '../src/agent/budget.js';

const 여기 = dirname(fileURLToPath(import.meta.url));
const 나갈곳 = join(여기, '..', 'docs', 'assets');

/*
 * 색판.
 *
 * shot.mjs 의 것을 그대로 쓴다. 두 벌이 갈리면 같은 README 안에서 사진과
 * 그림의 초록이 서로 다른 초록이 된다 — 그러면 색이 아무 뜻도 못 갖는다.
 */
const 판 = {
  light: {
    바탕: '#ffffff', 테: '#d0d7de', 글: '#1f2328', 그늘: '#59636e',
    빨강: '#cf222e', 초록: '#1a7f37', 노랑: '#9a6700', 파랑: '#0969da',
    보라: '#8250df', 하늘: '#1b7c83', 흰것: '#1f2328',
    창테: '#d0d7de', 창머리: '#f6f8fa',
  },
  dark: {
    바탕: '#0d1117', 테: '#30363d', 글: '#e6edf3', 그늘: '#8b949e',
    빨강: '#ff7b72', 초록: '#3fb950', 노랑: '#d29922', 파랑: '#58a6ff',
    보라: '#bc8cff', 하늘: '#39c5cf', 흰것: '#f0f6fc',
    창테: '#30363d', 창머리: '#161b22',
  },
};

// 글꼴은 파일에 안 담는다. 담으면 한 장이 수백 KB 가 되고, 담아도 한글은
// 못 담는다. 시스템에 있는 모노스페이스를 차례로 고른다 (shot.mjs 와 같은 목록).
const 글꼴목록 = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

const 칸비 = 0.6;                      // 한 칸 = 글자크기 × 0.6
const 칸 = (크기) => 크기 * 칸비;
const 재기 = (글, 크기) => width(글) * 칸(크기);
const f = (n) => Number(n).toFixed(1);
const 감싸기 = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 글 한 덩이. 칸 수를 재서 textLength 로 못 박는다.
 *
 * @param {number} x   놓을 자리 (가운데·오른쪽이면 그 기준점)
 * @param {number} y   글줄의 바탕선
 */
function 글(x, y, 말, { 색, 크기 = 12, 굵게 = false, 맞춤 = '왼쪽', 흐리게 = null } = {}) {
  if (!String(말).length) return '';
  const 길이 = 재기(말, 크기);
  const 왼 = 맞춤 === '가운데' ? x - 길이 / 2 : 맞춤 === '오른쪽' ? x - 길이 : x;
  const 굵기 = 굵게 ? ' font-weight="600"' : '';
  const 옅기 = 흐리게 == null ? '' : ` opacity="${흐리게}"`;
  return `<text x="${f(왼)}" y="${f(y)}" fill="${색}" font-size="${크기}"${굵기}${옅기} `
    + `textLength="${f(길이)}" lengthAdjust="spacing" xml:space="preserve">${감싸기(말)}</text>`;
}

/** 모서리가 둥근 상자. */
function 상자(x, y, w, h, { 테색, 바탕색 = 'none', 굵기 = 1.4, r = 9, 채움흐림 = null, 점선 = null } = {}) {
  const 채움 = 채움흐림 == null ? '' : ` fill-opacity="${채움흐림}"`;
  const 대시 = 점선 ? ` stroke-dasharray="${점선}"` : '';
  return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${r}" `
    + `fill="${바탕색}"${채움} stroke="${테색}" stroke-width="${굵기}"${대시}/>`;
}

/** 곧은 화살표. 머리는 삼각형으로 직접 그린다 — marker 는 색마다 따로 정의해야 해서 파일이 는다. */
function 화살(x1, y1, x2, y2, 색, { 굵기 = 1.6, 점선 = null } = {}) {
  const dx = x2 - x1; const dy = y2 - y1;
  const 길 = Math.hypot(dx, dy) || 1;
  const ux = dx / 길; const uy = dy / 길;
  const 머리 = 9; const 반 = 4.4;
  const bx = x2 - ux * 머리; const by = y2 - uy * 머리;
  const px = -uy; const py = ux;
  const 대시 = 점선 ? ` stroke-dasharray="${점선}"` : '';
  return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(bx)}" y2="${f(by)}" stroke="${색}" `
    + `stroke-width="${굵기}"${대시} stroke-linecap="round"/>`
    + `<path d="M${f(x2)} ${f(y2)} L${f(bx + px * 반)} ${f(by + py * 반)} `
    + `L${f(bx - px * 반)} ${f(by - py * 반)} Z" fill="${색}"/>`;
}

/** 꺾이는 화살표. 점들을 차례로 잇고 마지막 방향으로 머리를 단다. */
function 꺾은화살(점들, 색, { 굵기 = 1.4 } = {}) {
  const a = 점들[점들.length - 2]; const b = 점들[점들.length - 1];
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const 길 = Math.hypot(dx, dy) || 1;
  const ux = dx / 길; const uy = dy / 길;
  const 머리 = 9; const 반 = 4.4;
  const bx = b[0] - ux * 머리; const by = b[1] - uy * 머리;
  const px = -uy; const py = ux;
  const 점 = [...점들.slice(0, -1), [bx, by]];
  const d = 점.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])} ${f(p[1])}`).join(' ');
  return `<path d="${d}" fill="none" stroke="${색}" stroke-width="${굵기}" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<path d="M${f(b[0])} ${f(b[1])} L${f(bx + px * 반)} ${f(by + py * 반)} `
    + `L${f(bx - px * 반)} ${f(by - py * 반)} Z" fill="${색}"/>`;
}

/**
 * SVG 한 장.
 *
 * role="img" 과 title·desc 를 늘 넣는다 — 화면 낭독기는 이 두 줄만 읽는다.
 * 이름은 src/ui/banner.js 에서 읽어 온다. 여기에 'deel' 이라고 박아 두면
 * 이름이 바뀐 날 그림과 프로그램이 갈리는데, 그 어긋남은 화면을 못 보는
 * 사람에게만 보이므로 눈으로 보는 사람은 영영 모른다 (make-hero.mjs 와 같음).
 */
function 문서({ 결, W, H, 제목, 설명, 몸, 앞 = [] }) {
  const p = 판[결];
  const 이름표 = `${이름} — ${제목}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" `
    + `role="img" aria-label="${감싸기(이름표)}">
  <title>${감싸기(이름표)}</title>
  <desc>${감싸기(설명)}</desc>
${앞.map((l) => `  ${l}`).join('\n')}${앞.length ? '\n' : ''}  <rect width="${W}" height="${H}" rx="10" fill="${p.바탕}" stroke="${p.창테}"/>
  <g font-family="${글꼴목록}">
${몸.filter(Boolean).map((l) => `    ${l}`).join('\n')}
  </g>
</svg>
`;
}

/** 머리글 두 줄. 네 장이 같은 결로 시작한다. */
function 머리(p, x, 제목, 부제) {
  return [
    글(x, 36, 제목, { 색: p.글, 크기: 16, 굵게: true }),
    글(x, 58, 부제, { 색: p.그늘, 크기: 11.5 }),
  ];
}

// ── 1) 한마디가 도는 길 ─────────────────────────────────────────────────

const 흐름말 = {
  ko: {
    제목: '한마디가 도는 길',
    부제: '사람이 친 한 줄이 답이 되기까지 — 관문이 어디 있는지',
    설명: '사람 말을 받아 길고르기가 모드를 정하고, 그 모드가 허락한 도구만 목록에 실려 모델에게 간다. '
      + '도구를 부를 때는 모드 관문과 승인 관문을 지나야 하고, 걸리면 거기서 멈춘다. '
      + '결과는 모델에게 돌아가 걸음 상한까지 되풀이하고, 끝에 Verify 로 확인한 뒤 답한다.',
    칸: [
      { 갈래: '상자', 표: '❯', 색: '파랑', 이름: '사람 말', 곁: '"로그를 logger 로 바꿔 줘"' },
      {
        갈래: '상자', 표: '⇄', 색: '보라', 이름: '길고르기 (route)', 곁: '낱말로 모드를 고른다 · 애매하면 안 바꾼다',
        노트: ['사람이 /code 로 고르면 자동 고르기는 멈춘다.', '사람이 고른 것을 뒤집지 않는다.'],
      },
      {
        갈래: '상자', 표: '◆', 색: '파랑', 이름: '모드 — 도구 목록', 곁: '코드 ◆ · 읽기 · 계획 · 쓰기 · 확인 · 쪼개기',
        노트: ['모드에 없는 도구는 목록에 아예 안 실린다.', '부탁이 아니라 목록이라 모델이 잊을 것이 없다.'],
      },
      {
        갈래: '상자', 표: '◍', 색: '하늘', 이름: '모델', 곁: '이 PC 또는 사내 게이트웨이 한 곳',
        노트: ['나가는 주소는 첫 화면에 늘 적힌다 (⌂ · ↗ · ⛊).'],
      },
      {
        갈래: '관문', 표: '①', 이름: '모드 관문 · 목록에 없는 도구는 거절', 막힘: '✕ 거절',
        노트: ['모델이 이름을 지어 불러도 여기서 안 돈다.'],
      },
      {
        갈래: '관문', 표: '②', 이름: '승인 관문 · auto · confirm · strict', 막힘: '✕ 멈춤',
        노트: ['auto 는 안 묻고(되돌리기가 안전망) · confirm 은', '되돌릴 수 없는 명령만 · strict 는 파일 변경·명령 전부.',
          '금지(deny) 규칙은 물어보지도 않고 막는다.'],
      },
      {
        갈래: '상자', 표: '▣', 색: '보라', 이름: '도구 실행', 곁: 'Read · Grep · Edit · Bash …',
        노트: ['바꾼 것은 되돌리기 기록에 남는다 (/undo).', '도구 부름은 .deel/audit.jsonl 에 적힌다.',
          '결과는 모델에게 돌아가 걸음 상한까지 되풀이한다.'],
      },
      {
        갈래: '상자', 표: '✓', 색: '초록', 이름: '확인 (Verify)', 곁: '만든 것이 실제로 도는지 돌려 본다',
        노트: ['확인 못 한 것을 됐다고 하지 않는다.'],
      },
      { 갈래: '상자', 표: '✦', 색: '초록', 이름: '답', 곁: '무엇을 왜 바꿨는지 한두 줄' },
    ],
    고리제목: '한마디가 도는 길 — 도는 판',
    고리부제: '표시가 한 칸씩 옮겨 갑니다 · 움직임을 끈 화면에서는 멈춰 있습니다',
    고리설명: '위 길을 표시가 한 칸씩 짚어 가며 되풀이해 도는 그림. '
      + '움직임 줄이기를 켠 화면에서는 첫 칸에 멈춘 채로 보인다.',
  },
  en: {
    제목: 'How one message travels',
    부제: 'From the line you type to the answer — and where the gates are',
    설명: 'Routing picks a mode from what you typed, and only the tools that mode allows reach the list sent to the model. '
      + 'A tool call has to pass the mode gate and the approval gate; if it is caught, it stops there. '
      + 'Results go back to the model and repeat up to the step ceiling, and Verify checks the work before the answer.',
    칸: [
      { 갈래: '상자', 표: '❯', 색: '파랑', 이름: 'What you type', 곁: '"switch the logs over to logger"' },
      {
        갈래: '상자', 표: '⇄', 색: '보라', 이름: 'Routing', 곁: 'picks the mode from your words',
        노트: ['Pick a mode yourself with /code and auto-routing stops.', 'It does not overrule what a person chose.'],
      },
      {
        갈래: '상자', 표: '◆', 색: '파랑', 이름: 'Mode — the tool list', 곁: 'Code ◆ · read · plan · write · verify · split',
        노트: ['Tools the mode lacks never reach the list at all.', 'It is a list, not a request — nothing to forget.'],
      },
      {
        갈래: '상자', 표: '◍', 색: '하늘', 이름: 'Model', 곁: 'this machine, or one company gateway',
        노트: ['The address it sends to is printed at the top (⌂ · ↗ · ⛊).'],
      },
      {
        갈래: '관문', 표: '①', 이름: 'Mode gate · a tool off the list', 막힘: '✕ refused',
        노트: ['Even a name the model invents is turned down here.'],
      },
      {
        갈래: '관문', 표: '②', 이름: 'Approval gate · auto·confirm·strict', 막힘: '✕ stopped',
        노트: ['auto never asks (undo is the net) · confirm asks for',
          'irreversible commands · strict for every change and command.',
          'Deny rules block without asking at all.'],
      },
      {
        갈래: '상자', 표: '▣', 색: '보라', 이름: 'The tool runs', 곁: 'Read · Grep · Edit · Bash …',
        노트: ['Every change lands in the undo history (/undo).', 'Every tool call is written to .deel/audit.jsonl.',
          'Results go back to the model, up to the step ceiling.'],
      },
      {
        갈래: '상자', 표: '✓', 색: '초록', 이름: 'Verify', 곁: 'runs what was built to see it works',
        노트: ['It does not call done what it did not check.'],
      },
      { 갈래: '상자', 표: '✦', 색: '초록', 이름: 'Answer', 곁: 'what changed and why, in a line or two' },
    ],
    고리제목: 'How one message travels — in motion',
    고리부제: 'the marker steps one cell at a time · it stands still where motion is turned down',
    고리설명: 'The same path with a marker stepping through it, one cell at a time, over and over. '
      + 'With reduced motion turned on it rests on the first cell.',
  },
};

/** 흐름 그림의 자리 계산. 서는 판과 도는 판이 같은 배치를 쓴다. */
function 흐름배치(말) {
  const 것 = 흐름말[말];
  const x = 44; const w = 380;
  let y = 88;
  const 칸들 = 것.칸.map((c) => {
    const h = c.갈래 === '관문' ? 40 : 56;
    const 자리 = { ...c, x, y, w, h, 가운데y: y + h / 2 };
    y += h + 20;
    return 자리;
  });
  return { 것, 칸들, x, w, W: 930, H: y + 12, 노트x: 456, 고리x: 436, 표시x: 22 };
}

function 흐름그리기(말, 결, { 움직임 = false } = {}) {
  const p = 판[결];
  const { 것, 칸들, x, w, W, H, 노트x, 고리x, 표시x } = 흐름배치(말);
  const 몸 = [...머리(p, x, 움직임 ? 것.고리제목 : 것.제목, 움직임 ? 것.고리부제 : 것.부제)];

  칸들.forEach((c, i) => {
    if (c.갈래 === '관문') {
      몸.push(상자(c.x, c.y, c.w, c.h, { 테색: p.노랑, 바탕색: p.노랑, 채움흐림: 0.1, r: 8 }));
      몸.push(글(c.x + 14, c.y + 25, c.표, { 색: p.노랑, 크기: 13, 굵게: true }));
      몸.push(글(c.x + 36, c.y + 25, c.이름, { 색: p.글, 크기: 12 }));
      몸.push(글(c.x + c.w - 12, c.y + 25, c.막힘, { 색: p.빨강, 크기: 11, 맞춤: '오른쪽' }));
    } else {
      몸.push(상자(c.x, c.y, c.w, c.h, { 테색: p.테, 바탕색: p.창머리 }));
      몸.push(글(c.x + 14, c.y + 34, c.표, { 색: p[c.색], 크기: 15, 굵게: true }));
      몸.push(글(c.x + 42, c.y + 24, c.이름, { 색: p.글, 크기: 12.5, 굵게: true }));
      몸.push(글(c.x + 42, c.y + 42, c.곁, { 색: p.그늘, 크기: 11 }));
    }
    // 다음 칸으로 가는 화살표.
    const 다음 = 칸들[i + 1];
    if (다음) 몸.push(화살(c.x + c.w / 2, c.y + c.h + 2, c.x + c.w / 2, 다음.y - 3, p.그늘, { 굵기: 1.5 }));
    // 곁말은 오른쪽 칸에 같은 높이로 적는다. 잇는 선은 안 긋는다 —
    // 높이가 이미 짝을 말하고 있어서, 선을 더 그으면 고리 화살표와 엉킨다.
    (c.노트 ?? []).forEach((줄, n) => 몸.push(글(노트x, c.y + 16 + n * 15, 줄, { 색: p.그늘, 크기: 11 })));
  });

  // 되풀이 고리 — 도구 결과는 모델에게 돌아간다.
  const 모델 = 칸들[3];
  const 실행 = 칸들[6];
  몸.push(꺾은화살([
    [실행.x + 실행.w + 2, 실행.가운데y],
    [고리x, 실행.가운데y],
    [고리x, 모델.가운데y],
    [모델.x + 모델.w + 2, 모델.가운데y],
  ], p.하늘));
  const 고리y = (모델.가운데y + 실행.가운데y) / 2;
  몸.push(`<circle cx="${고리x}" cy="${f(고리y)}" r="9" fill="${p.바탕}" stroke="${p.하늘}" stroke-width="1.2"/>`);
  몸.push(글(고리x, 고리y + 4, '⟳', { 색: p.하늘, 크기: 11, 맞춤: '가운데' }));

  if (!움직임) return 문서({ 결, W, H, 제목: 것.제목, 설명: 것.설명, 몸 });

  /*
   * 도는 판.
   *
   * GIF 가 아니다. SMIL(<animate>)이 든 SVG 다 — 깃허브 README 에서 그대로
   * 돌고, 글자가 글자로 남고, 몇 KB 다.
   *
   * 움직임을 싫어하는 사람에게는 **멈춘 그림**을 준다. SMIL 은 CSS 로 못
   * 멈추므로, 도는 것을 통째로 감춰 두고 서 있는 것을 대신 보인다.
   */
  const 서는것 = [];
  const 도는것 = [];
  const ys = 칸들.map((c) => c.가운데y);
  const 높이들 = 칸들.map((c) => c.h);
  const n = 칸들.length;
  const 초 = (n * 1.1).toFixed(1);
  // 한 칸에 머무는 동안 짚었다가 다음 칸으로 미끄러진다. 마지막에는 첫 칸으로 돌아온다.
  const 때 = [];
  const 값 = (목록) => {
    const v = [];
    for (let i = 0; i < n; i++) { v.push(목록[i], 목록[i]); }
    v.push(목록[0]);
    return v.join(';');
  };
  for (let i = 0; i < n; i++) { 때.push((i / n).toFixed(4), ((i + 0.72) / n).toFixed(4)); }
  때.push('1');
  const 때글 = 때.join(';');
  const 돌기 = (속성, 목록) => `<animate attributeName="${속성}" values="${값(목록)}" `
    + `keyTimes="${때글}" dur="${초}s" calcMode="linear" repeatCount="indefinite"/>`;

  // 짚는 테두리.
  도는것.push(`<rect x="${f(x - 3)}" y="${f(ys[0] - 높이들[0] / 2 - 3)}" width="${f(w + 6)}" `
    + `height="${f(높이들[0] + 6)}" rx="11" fill="none" stroke="${p.초록}" stroke-width="2.2">`
    + 돌기('y', ys.map((v, i) => f(v - 높이들[i] / 2 - 3)))
    + 돌기('height', 높이들.map((v) => f(v + 6)))
    + '</rect>');
  // 왼쪽에서 따라 내려가는 표시.
  도는것.push(`<circle cx="${표시x}" cy="${f(ys[0])}" r="5" fill="${p.초록}">`
    + 돌기('cy', ys.map((v) => f(v))) + '</circle>');
  서는것.push(`<rect x="${f(x - 3)}" y="${f(ys[0] - 높이들[0] / 2 - 3)}" width="${f(w + 6)}" `
    + `height="${f(높이들[0] + 6)}" rx="11" fill="none" stroke="${p.초록}" stroke-width="2.2"/>`);
  서는것.push(`<circle cx="${표시x}" cy="${f(ys[0])}" r="5" fill="${p.초록}"/>`);
  // 표시가 지나갈 길. 얇게 깔아 두면 어디까지 가는지가 미리 보인다.
  몸.push(`<line x1="${표시x}" y1="${f(ys[0])}" x2="${표시x}" y2="${f(ys[n - 1])}" `
    + `stroke="${p.테}" stroke-width="1.5" stroke-linecap="round"/>`);
  몸.push(`<g class="도는것">${도는것.join('')}</g>`);
  몸.push(`<g class="선것">${서는것.join('')}</g>`);

  const 앞 = [
    '<style>',
    '    .선것 { display: none }',
    '    @media (prefers-reduced-motion: reduce) {',
    '      .도는것 { display: none }',
    '      .선것 { display: inline }',
    '    }',
    '  </style>',
  ];
  return 문서({ 결, W, H, 제목: 것.고리제목, 설명: 것.고리설명, 몸, 앞 });
}

// ── 2) 글이 갈 수 있는 자리 ─────────────────────────────────────────────

const 경계말 = {
  ko: {
    제목: '글이 갈 수 있는 자리',
    부제: '이 컴퓨터 안과 바깥 사이 — 무엇이 선을 넘고, 무엇이 절대 안 넘나',
    설명: '작업 폴더와 .deel/ 은 이 컴퓨터 안에 있고, 선을 넘는 길은 넷뿐이다 — '
      + '모델 게이트웨이 · WebFetch · 플러그인 받기 · MCP 서버. '
      + '열쇠와 감사 기록 · 되돌리기 기록 · 대화는 선을 안 넘고, 수집하는 것도 없다. '
      + '봉인(deel offline)은 뒤의 셋을 잠그고 모델 주소를 이 PC·사내로만 묶는다.',
    안제목: '⌂  이 컴퓨터 안 — 작업 폴더 · .deel/',
    있는것제목: '여기 있는 것',
    있는것: [
      '작업 폴더의 소스',
      '.deel/sessions — 대화 기록',
      '.deel/history — 되돌리기',
      '.deel/audit.jsonl — 감사 기록',
      '.deel/memory.md — 기억',
      'config.json — 열쇠 (DPAPI · 키체인)',
    ],
    안넘는것제목: '⊘  이 선을 안 넘는 것',
    안넘는것: [
      '열쇠 — 붙은 그 주소 인증에만. 말·화면·기록엔 가림',
      '감사 기록 · 되돌리기 · 대화 — .deel/ 안에만',
      '텔레메트리 · 사용 통계 · 오류 보고 — 없음',
    ],
    경계: '경계 — 위는 이 PC, 아래는 바깥',
    밖: [
      { 표: 'A', 이름: '모델 게이트웨이', 줄: ['시킨 말 · 읽은 조각', '도구 결과 · 답', 'setup 의 주소 한 곳'], 표시: '⌂' },
      { 표: 'B', 이름: 'WebFetch', 줄: ['받기만 — GET', '몸 0바이트', '사설 · 루프백 거절'], 표시: '⛊' },
      { 표: 'C', 이름: '플러그인 받기', 줄: ['/plugin install', '도는 동안만'], 표시: '⛊' },
      { 표: 'D', 이름: 'MCP 서버', 줄: ['남의 프로세스', '밖에서 못 본다', 'mcp.json 에 적어야'], 표시: '⛊' },
    ],
    봉인: [
      '⛊  봉인 (deel offline) — B · C · D 를 잠근다. MCP 서버는 아예 안 띄운다.',
      'A 는 이 PC · 사내 주소만 (127.x · 10.x · 192.168.x · 172.16-31.x). ⌂ 는 바깥이면 물어보고, ↗ 는 안 묻는다.',
    ],
  },
  en: {
    제목: 'Where your text can go',
    부제: 'Inside this machine and outside — what crosses the line, and what never does',
    설명: 'Your working folder and .deel/ live on this machine, and only four paths cross the line: '
      + 'the model gateway, WebFetch, plugin downloads and MCP servers. '
      + 'The key, the audit log, the undo history and your conversations never cross, and nothing is collected. '
      + 'Sealed mode (deel offline) locks the last three and keeps the model address on this machine or the intranet.',
    안제목: '⌂  Inside this machine — your folder and .deel/',
    있는것제목: 'What lives here',
    있는것: [
      'the source in your working folder',
      '.deel/sessions — conversations',
      '.deel/history — undo snapshots',
      '.deel/audit.jsonl — the audit log',
      '.deel/memory.md — memory',
      'config.json — the key (DPAPI · Keychain)',
    ],
    안넘는것제목: '⊘  What never crosses this line',
    안넘는것: [
      'the key — auth to that address only; masked elsewhere',
      'audit log · undo history · chats — in .deel/ only',
      'telemetry · usage stats · crash reports — none',
    ],
    경계: 'the line — this machine above, outside below',
    밖: [
      { 표: 'A', 이름: 'Model gateway', 줄: ['your words · file', 'excerpts · results', 'one address, from setup'], 표시: '⌂' },
      { 표: 'B', 이름: 'WebFetch', 줄: ['receive only — GET', 'zero-byte body', 'private · loopback refused'], 표시: '⛊' },
      { 표: 'C', 이름: 'Plugin download', 줄: ['only while', '/plugin install runs'], 표시: '⛊' },
      { 표: 'D', 이름: 'MCP servers', 줄: ["someone else's process", 'we cannot see inside', 'a human writes mcp.json'], 표시: '⛊' },
    ],
    봉인: [
      '⛊  Sealed (deel offline) — B, C and D are locked. An MCP server is never started at all.',
      'A stays on this machine or the intranet (127.x · 10.x · 192.168.x · 172.16-31.x). ⌂ asks first; ↗ does not.',
    ],
  },
};

function 경계그리기(말, 결) {
  const p = 판[결];
  const 것 = 경계말[말];
  const W = 900; const H = 626;
  const 왼 = 36; const 오른 = W - 36;
  const 경계y = 334;
  const 몸 = [...머리(p, 왼, 것.제목, 것.부제)];

  // 위 — 이 컴퓨터 안.
  몸.push(상자(왼, 80, 오른 - 왼, 192, { 테색: p.초록, 바탕색: p.초록, 채움흐림: 0.06 }));
  몸.push(글(왼 + 18, 104, 것.안제목, { 색: p.초록, 크기: 13, 굵게: true }));
  몸.push(글(왼 + 18, 130, 것.있는것제목, { 색: p.그늘, 크기: 11 }));
  것.있는것.forEach((s, i) => 몸.push(글(왼 + 18, 152 + i * 20, s, { 색: p.글, 크기: 11.5 })));
  const 오른칸 = 470;
  몸.push(글(오른칸, 130, 것.안넘는것제목, { 색: p.빨강, 크기: 11, 굵게: true }));
  것.안넘는것.forEach((s, i) => 몸.push(글(오른칸, 156 + i * 22, s, { 색: p.글, 크기: 11.5 })));

  // 선을 넘는 길 넷.
  const 칸너비 = (오른 - 왼 - 3 * 12) / 4;
  것.밖.forEach((b, i) => {
    const bx = 왼 + i * (칸너비 + 12);
    const cx = bx + 칸너비 / 2;
    몸.push(화살(cx, 284, cx, 400, p.파랑, { 굵기: 1.6 }));
    // 경계에 걸리는 표시. A 는 물어보고, 나머지는 봉인이 잠근다.
    몸.push(`<circle cx="${f(cx)}" cy="${경계y}" r="11" fill="${p.바탕}" `
      + `stroke="${b.표시 === '⌂' ? p.초록 : p.빨강}" stroke-width="1.6"/>`);
    몸.push(글(cx, 경계y + 4, b.표시, { 색: b.표시 === '⌂' ? p.초록 : p.빨강, 크기: 11, 맞춤: '가운데' }));
    // 바깥 상자.
    몸.push(상자(bx, 408, 칸너비, 118, { 테색: p.테, 바탕색: p.창머리 }));
    몸.push(글(bx + 14, 430, `[${b.표}]`, { 색: p.파랑, 크기: 12, 굵게: true }));
    몸.push(글(bx + 44, 430, b.이름, { 색: p.글, 크기: 12, 굵게: true }));
    b.줄.forEach((s, n) => 몸.push(글(bx + 14, 454 + n * 17, s, { 색: p.그늘, 크기: 10.5 })));
  });

  // 경계선.
  몸.push(`<line x1="${왼}" y1="${경계y}" x2="${오른}" y2="${경계y}" stroke="${p.초록}" stroke-width="2.5" stroke-linecap="round"/>`);
  몸.push(글(왼, 경계y - 10, 것.경계, { 색: p.초록, 크기: 10.5 }));

  // 봉인.
  몸.push(상자(왼, 544, 오른 - 왼, 58, { 테색: p.빨강, 바탕색: p.빨강, 채움흐림: 0.06, 점선: '5 4' }));
  것.봉인.forEach((s, i) => 몸.push(글(왼 + 18, 566 + i * 20, s, { 색: i ? p.그늘 : p.글, 크기: 11.5, 굵게: i === 0 })));

  return 문서({ 결, W, H, 제목: 것.제목, 설명: 것.설명, 몸 });
}

// ── 3) 여덟 모드 ────────────────────────────────────────────────────────

/*
 * 표에 들어갈 값은 손으로 안 적는다.
 *
 * 이름 · 표시 · 도구 목록은 src/agent/modes.js 가, 걸음 상한은
 * src/agent/budget.js 가 들고 있다. 여기서 읽어다 그리므로, 모드가 하나
 * 늘거나 상한이 바뀌면 이 연장을 다시 돌리는 것만으로 그림이 따라온다.
 */
const 창크기 = 128 * 1024;   // 그림에 적을 기준. 걸음 상한은 모델 창에 따라 달라진다.

const 모드말 = {
  ko: {
    제목: '여덟 가지 작업 모드',
    부제: '무슨 일을 하는 중인가에 따라 도구 · 생각 · 걸음이 한꺼번에 바뀝니다',
    설명: '모드마다 파일을 바꿀 수 있는지, 생각 강도가 얼마인지, 한 턴에 몇 걸음까지 도는지가 다르다. '
      + '읽기 전용 모드에는 파일을 바꾸는 도구가 아예 목록에 없다.',
    머리: ['', '모드', '', '파일', '생각 · 강도', '걸음 상한', '무슨 일일 때'],
    바꿈: '바꿈',
    읽기만: '읽기만',
    꼬리: [
      `걸음 상한은 모델 창 크기에 따라 달라집니다 — 위 값은 ${창크기 / 1024}k 기준입니다.`,
      '이건 승인 정책(/mode — 얼마나 물어보나)과 다른 축입니다. 둘은 곱해집니다.',
      '값은 src/agent/modes.js · src/agent/budget.js 에서 읽어다 그렸습니다.',
    ],
  },
  en: {
    제목: 'The eight work modes',
    부제: 'What kind of job you are on changes the tools, the thinking and the step ceiling at once',
    설명: 'Each mode differs in whether it can change files, how hard it thinks, and how many steps it takes in one turn. '
      + 'A read-only mode simply has no file-changing tools on its list.',
    머리: ['', 'Mode', 'Files', 'Think · effort', 'Step ceiling', 'When you are'],
    바꿈: 'edits',
    읽기만: 'read-only',
    꼬리: [
      `The step ceiling scales with the model's context window — these are for ${창크기 / 1024}k.`,
      'This is a different axis from the approval policy (/mode — how much it asks). The two multiply.',
      'The values are read from src/agent/modes.js and src/agent/budget.js.',
    ],
  },
};

function 모드줄들(말) {
  const 것 = 모드말[말];
  return ORDER.map((id) => {
    const m = MODES[id];
    const 씀 = canWrite(id);
    const 생각 = `${m.think ?? '—'}·${m.effort}`;
    const 걸음 = String(걸음수(id, 창크기));
    const 칸 = 말 === 'ko'
      ? [m.glyph, m.name, m.en, 씀 ? 것.바꿈 : 것.읽기만, 생각, 걸음, m.hint]
      : [m.glyph, m.en, 씀 ? 것.바꿈 : 것.읽기만, 생각, 걸음, m.hintEn];
    return { id, 칸, 씀 };
  });
}

function 모드그리기(말, 결) {
  const p = 판[결];
  const 것 = 모드말[말];
  const 줄들 = 모드줄들(말);
  const 크기 = 11.5;
  const 칸수 = 것.머리.length;
  const 폭 = [];
  for (let i = 0; i < 칸수; i++) {
    폭.push(Math.max(재기(것.머리[i], 크기), ...줄들.map((r) => 재기(r.칸[i], 크기))));
  }
  const 사이 = 18;
  const 왼 = 36;
  const 자리 = [];
  let cur = 왼 + 16;
  for (let i = 0; i < 칸수; i++) { 자리.push(cur); cur += 폭[i] + 사이; }
  const 표너비 = cur - 사이 + 16 - 왼;
  const W = Math.ceil(왼 * 2 + 표너비);
  const 표y = 84;
  const 줄높이 = 30;
  const H = 표y + 30 + 줄들.length * 줄높이 + 24 + 것.꼬리.length * 18 + 12;

  const 몸 = [...머리(p, 왼, 것.제목, 것.부제)];
  몸.push(상자(왼, 표y, 표너비, 30 + 줄들.length * 줄높이, { 테색: p.테 }));
  // 머리줄.
  것.머리.forEach((s, i) => 몸.push(글(자리[i], 표y + 20, s, { 색: p.그늘, 크기: 10.5 })));
  몸.push(`<line x1="${왼}" y1="${표y + 30}" x2="${왼 + 표너비}" y2="${표y + 30}" stroke="${p.테}" stroke-width="1"/>`);

  줄들.forEach((r, n) => {
    const y = 표y + 30 + n * 줄높이;
    if (n % 2) 몸.push(`<rect x="${왼 + 1}" y="${f(y)}" width="${f(표너비 - 2)}" height="${줄높이}" fill="${p.창머리}"/>`);
    const 바탕선 = y + 19;
    r.칸.forEach((s, i) => {
      // 「파일을 바꾸나」 칸만 색으로 갈라 둔다. 한눈에 읽어야 하는 것이 그것이다.
      const 파일칸 = 말 === 'ko' ? 3 : 2;
      const 색 = i === 0 ? p.파랑
        : i === 파일칸 ? (r.씀 ? p.노랑 : p.초록)
          : i === 칸수 - 1 ? p.그늘 : p.글;
      몸.push(글(자리[i], 바탕선, s, { 색, 크기, 굵게: i === 1 }));
    });
  });

  const 꼬리y = 표y + 30 + 줄들.length * 줄높이 + 26;
  것.꼬리.forEach((s, i) => 몸.push(글(왼, 꼬리y + i * 18, s, { 색: p.그늘, 크기: 10.5 })));

  return 문서({ 결, W, H, 제목: 것.제목, 설명: 것.설명, 몸 });
}

// ── 4) CHA — 한 판이 도는 아홉 걸음 ─────────────────────────────────────

/*
 * 이 한 장이 말하려는 것은 **차례가 아니라 되풀이**다.
 *
 * 표로 적으면 아홉 줄이 위에서 아래로 한 번 흐르고 끝난 것처럼 읽힌다. 실제로
 * 이 판에서 한 일은 그 아홉 걸음을 **열다섯 바퀴** 돈 것이고, 「2차 눈 → 판정」
 * 사이에서 세 모델이 서로 다른 자리에 서 있었다는 것이 핵심이다. 그건 글로
 * 적으면 안 읽히고, 표시가 한 칸씩 돌아가는 것을 보면 한눈에 읽힌다.
 *
 * 움직임을 싫어하는 사람에게는 **멈춘 그림**을 준다 (fig-loop 과 같은 방법).
 */
const CHA말 = {
  ko: {
    제목: 'CHA — 한 판이 도는 아홉 걸음',
    부제: '표시가 한 바퀴 돕니다 · 2.0.0 은 이 바퀴를 열다섯 번 돌았습니다',
    설명: '순환형 적대적 하네싱(CHA)의 아홉 걸음이 고리로 놓여 있고, 표시가 한 칸씩 짚으며 되풀이해 돈다. '
      + '사냥 · 브리핑 · 2차 눈 · 판정 · 빨간 검사 먼저 · 고침 · 어긋내기 · 관문 · 기록 순이고, '
      + '9번 기록에서 다시 1번 사냥으로 돌아간다. 2차 눈 자리에는 세 모델이 선다 — '
      + '1차 Claude 는 쓰고, 2차 Gemini 와 3차 codex 는 읽기만 한다. '
      + '움직임 줄이기를 켠 화면에서는 첫 칸에 멈춘 채로 보인다.',
    걸음: [
      { n: '1', 이름: '사냥', 곁: '실제 입력으로 부딪친다' },
      { n: '2', 이름: '브리핑', 곁: '자리·넣은 것·나온 것·기대' },
      { n: '3', 이름: '2차 눈', 곁: '다른 모델이 읽기만 한다' },
      { n: '4', 이름: '판정', 곁: '참 · 거짓 · 못 잼 — 실행으로' },
      { n: '5', 이름: '빨간 검사 먼저', 곁: '고치기 전에 빨개지는 것을 본다' },
      { n: '6', 이름: '고침', 곁: '손은 하나다' },
      { n: '7', 이름: '어긋내기', 곁: '고친 줄을 되돌려 검사를 흔든다' },
      { n: '8', 이름: '관문', 곁: 'test · check · docs 전부' },
      { n: '9', 이름: '기록', 곁: '덧붙여만 적는다' },
    ],
    한바퀴: '한 판',
    눈제목: '3번 자리에 서는 세 눈',
    눈: [
      { 표: '①', 이름: 'Claude', 곁: '사냥하고 고친다 — 쓰는 손은 이 하나뿐' },
      { 표: '②', 이름: 'Gemini', 곁: '읽기만 한다 · 짚은 것은 실행으로 가른다' },
      { 표: '③', 이름: 'codex', 곁: '읽기만 한다 · 같은 자리를 세 번째로 짚는다' },
    ],
    꼬리: [
      '한 바퀴가 한 판. 2.0.0 은 이 바퀴를 열다섯 번 돌았습니다.',
      '4번이 「거짓」 이면 반증을 적고 그 자리는 안 고칩니다.',
      '7번에서 검사가 안 빨개지면 6번으로 돌아갑니다 —',
      '초록은 「지킨다」 가 아니라 「안 걸렸다」 일 수 있으니까요.',
    ],
  },
  en: {
    제목: 'CHA — the nine steps of one round',
    부제: 'The marker walks the ring · 2.0.0 went around it fifteen times',
    설명: 'The nine steps of Cyclic Hostile Harnessing (CHA) are laid out as a ring, and a marker '
      + 'walks them one at a time, over and over: hunt, brief, second eyes, adjudicate, red test first, '
      + 'fix, mutate, gate, record — and step 9 returns to step 1. Three models stand at the second-eyes '
      + 'step: Claude writes, Gemini and codex only read. '
      + 'With reduced motion it falls back to a still frame on the first step.',
    걸음: [
      { n: '1', 이름: 'Hunt', 곁: 'hit it with real input' },
      { n: '2', 이름: 'Brief', 곁: 'place · input · output · expected' },
      { n: '3', 이름: 'Second eyes', 곁: 'another model, read-only' },
      { n: '4', 이름: 'Adjudicate', 곁: 'true · false · cannot tell — by running it' },
      { n: '5', 이름: 'Red test first', 곁: 'watch it fail before the fix' },
      { n: '6', 이름: 'Fix', 곁: 'one writer only' },
      { n: '7', 이름: 'Mutate', 곁: 'undo the fixed line, shake the test' },
      { n: '8', 이름: 'Gate', 곁: 'test · check · docs, all of it' },
      { n: '9', 이름: 'Record', 곁: 'append only' },
    ],
    한바퀴: 'one round',
    눈제목: 'Three eyes on step 3',
    눈: [
      { 표: '①', 이름: 'Claude', 곁: 'hunts and fixes — the only hand that writes' },
      { 표: '②', 이름: 'Gemini', 곁: 'reads only · every claim settled by running it' },
      { 표: '③', 이름: 'codex', 곁: 'reads only · a third pass over the same place' },
    ],
    꼬리: [
      'One lap is one round. 2.0.0 went around it fifteen times.',
      'A "false" verdict at step 4 is written down with its',
      'counter-evidence, and nothing is changed.',
      'If the test stays green at step 7, go back to step 6 —',
      'green can mean "guarded" or just "not caught this time".',
    ],
  },
};

function CHA그리기(말, 결) {
  const 것 = CHA말[말];
  const p = 판[결];
  const W = 930;
  const 줄높이 = 44;
  const n = 것.걸음.length;
  const 왼 = 84;
  const 폭 = 404;
  const 첫y = 92;
  const H = 첫y + n * 줄높이 + 34;
  const 몸 = [...머리(p, 44, 것.제목, 것.부제)];

  /*
   * 아홉 걸음은 **세로로** 세운다.
   *
   * 처음엔 진짜 고리로 그렸는데, 아홉 칸을 원둘레에 놓으면 이름을 걸 자리가
   * 고리 바깥밖에 없고 그 자리는 왼쪽·오른쪽에서 곧바로 그림 밖으로 나간다
   * (재 보니 네 줄이 화폭을 넘었다). 「도는 것」 이라는 말은 고리 모양이 아니라
   * **9번에서 1번으로 돌아가는 화살표 하나**가 한다.
   */
  const 가운데y = (i) => 첫y + i * 줄높이 + 줄높이 / 2;
  const 상자높이 = 줄높이 - 8;

  것.걸음.forEach((걸, i) => {
    const y = 가운데y(i);
    const 색 = i === 2 ? p.보라 : i === 5 ? p.초록 : i === 6 ? p.노랑 : p.파랑;
    몸.push(상자(왼, y - 상자높이 / 2, 폭, 상자높이, { 테색: 색, 바탕색: 색, 채움흐림: 0.05, 굵기: 1.3 }));
    몸.push(`<circle cx="${f(왼 + 24)}" cy="${f(y)}" r="12" fill="${p.바탕}" stroke="${색}" stroke-width="1.4"/>`);
    몸.push(글(왼 + 24, y + 4, 걸.n, { 색, 크기: 11.5, 굵게: true, 맞춤: '가운데' }));
    몸.push(글(왼 + 46, y + 4, 걸.이름, { 색: p.글, 크기: 12.5, 굵게: true }));
    몸.push(글(왼 + 폭 - 14, y + 4, 걸.곁, { 색: p.그늘, 크기: 10, 맞춤: '오른쪽' }));
    if (i < n - 1) {
      몸.push(화살(왼 + 24, y + 상자높이 / 2, 왼 + 24, 가운데y(i + 1) - 상자높이 / 2 - 1, p.테, { 굵기: 1.3 }));
    }
  });

  /*
   * 9번에서 1번으로 돌아가는 길. 이 화살표 하나가 이 그림의 전부다 —
   * 아홉 걸음을 한 번 하고 끝낸 것이 아니라 열다섯 번 돌았다는 말이라서.
   */
  {
    const 바깥 = 왼 - 32;
    몸.push(꺾은화살([
      [왼 - 2, 가운데y(n - 1)],
      [바깥, 가운데y(n - 1)],
      [바깥, 가운데y(0)],
      [왼 - 4, 가운데y(0)],
    ], p.하늘, { 굵기: 1.5 }));
    const 고리y = (가운데y(0) + 가운데y(n - 1)) / 2;
    몸.push(`<circle cx="${f(바깥)}" cy="${f(고리y)}" r="11" fill="${p.바탕}" stroke="${p.하늘}" stroke-width="1.2"/>`);
    몸.push(글(바깥, 고리y + 4, '⟳', { 색: p.하늘, 크기: 12, 맞춤: '가운데' }));
    몸.push(글(바깥, 고리y + 26, 것.한바퀴, { 색: p.하늘, 크기: 9.5, 맞춤: '가운데' }));
  }

  // 세 눈 — 3번 칸에서 갈라져 나온 곁판.
  const 눈x = 542;
  const 눈y = 가운데y(2) - 30;
  const 눈w = 344;
  const 눈h = 32 + 것.눈.length * 46;
  몸.push(상자(눈x, 눈y, 눈w, 눈h, { 테색: p.보라, 바탕색: p.보라, 채움흐림: 0.05, 점선: '5 4' }));
  몸.push(글(눈x + 16, 눈y + 24, 것.눈제목, { 색: p.보라, 크기: 12.5, 굵게: true }));
  것.눈.forEach((눈, i) => {
    const y = 눈y + 54 + i * 46;
    몸.push(글(눈x + 16, y, `${눈.표}  ${눈.이름}`, { 색: p.글, 크기: 12, 굵게: true }));
    몸.push(글(눈x + 16, y + 15, 눈.곁, { 색: p.그늘, 크기: 10 }));
  });
  // 3번 칸에서 곁판으로 잇는 선. 어디서 갈라졌는지가 안 보이면 곁판은 딴 그림이다.
  몸.push(화살(왼 + 폭 + 2, 가운데y(2), 눈x - 4, 가운데y(2), p.보라, { 굵기: 1.3, 점선: '4 4' }));

  const 꼬리y = 눈y + 눈h + 32;
  것.꼬리.forEach((줄, i) => 몸.push(글(눈x, 꼬리y + i * 17, 줄, { 색: p.그늘, 크기: 10.5 })));

  /*
   * 표시가 걸음을 하나씩 짚으며 되풀이해 돈다.
   *
   * fig-loop 과 같은 규칙이다 — SMIL 이라 깃허브에서 그대로 돌고, 움직임을
   * 줄이는 설정이면 첫 칸에 멈춘 그림으로 바뀐다. SMIL 은 CSS 로 못 멈추므로
   * 도는 것을 통째로 감추고 선 것을 대신 보인다.
   */
  const 초 = (n * 0.95).toFixed(1);
  const 때 = [];
  for (let i = 0; i < n; i++) 때.push((i / n).toFixed(4), ((i + 0.7) / n).toFixed(4));
  때.push('1');
  const 때글 = 때.join(';');
  const 돌기 = (속성, 목록) => {
    const v = [];
    for (let i = 0; i < n; i++) v.push(목록[i], 목록[i]);
    v.push(목록[0]);
    return `<animate attributeName="${속성}" values="${v.join(';')}" keyTimes="${때글}" `
      + `dur="${초}s" calcMode="linear" repeatCount="indefinite"/>`;
  };
  const ys = 것.걸음.map((_, i) => f(가운데y(i) - 상자높이 / 2 - 3));
  const 짚기 = (움직이나) => `<rect x="${f(왼 - 3)}" y="${ys[0]}" width="${f(폭 + 6)}" `
    + `height="${f(상자높이 + 6)}" rx="11" fill="none" stroke="${p.초록}" stroke-width="2.2">`
    + (움직이나 ? 돌기('y', ys) : '') + '</rect>';
  몸.push(`<g class="도는것">${짚기(true)}</g>`);
  몸.push(`<g class="선것">${짚기(false)}</g>`);

  const 앞 = [
    '<style>',
    '    .선것 { display: none }',
    '    @media (prefers-reduced-motion: reduce) {',
    '      .도는것 { display: none }',
    '      .선것 { display: inline }',
    '    }',
    '  </style>',
  ];
  return 문서({ 결, W, H, 제목: 것.제목, 설명: 것.설명, 몸, 앞 });
}

// ── 내기 ────────────────────────────────────────────────────────────────

mkdirSync(나갈곳, { recursive: true });

const 낼것 = [];
for (const 말 of ['ko', 'en']) {
  for (const 결 of ['light', 'dark']) {
    낼것.push([`fig-flow-${말}-${결}.svg`, 흐름그리기(말, 결)]);
    낼것.push([`fig-trust-${말}-${결}.svg`, 경계그리기(말, 결)]);
    낼것.push([`fig-modes-${말}-${결}.svg`, 모드그리기(말, 결)]);
    낼것.push([`fig-loop-${말}-${결}.svg`, 흐름그리기(말, 결, { 움직임: true })]);
    낼것.push([`fig-cha-${말}-${결}.svg`, CHA그리기(말, 결)]);
  }
}

let 큰것 = 0;
for (const [이름표, svg] of 낼것) {
  const 크기 = Buffer.byteLength(svg, 'utf8');
  if (크기 > 60 * 1024) 큰것 += 1;
  writeFileSync(join(나갈곳, 이름표), svg, 'utf8');
  console.log(`  ${이름표.padEnd(28)} ${(크기 / 1024).toFixed(1)}KB`);
}
console.log(`\n  ${낼것.length}장`);
if (큰것) {
  console.log(`  ✗ 60KB 를 넘는 것 ${큰것}장 — 한 장에 담은 것이 너무 많습니다`);
  process.exitCode = 1;
}
