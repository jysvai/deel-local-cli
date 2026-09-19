/**
 * 슬래시 명령 자동완성.
 *
 * ── 무엇을 푸는가 ───────────────────────────────────────────────────────
 *
 * 명령이 서른 개가 넘는다. 다 외우고 있는 사람은 만든 사람뿐이고, 그마저도
 * `/mem…` 까지 치고 "이게 memory 였나 memo 였나" 하고 멈춘다. 그때 할 수 있는
 * 것이 `/help` 를 쳐서 서른 줄을 받아 눈으로 훑는 것뿐이면, 그건 명령이 아니라
 * 시험이다.
 *
 * 그래서 치는 도중에 보여 준다. 고르는 것이 아니라 **알아보는 것**이 목적이라
 * 위아래 화살표로 고르게 하지 않는다 — 그러면 지난 입력 이력(위 화살표)을
 * 뺏어야 하고, 그건 훨씬 자주 쓰는 기능이다. Tab 한 번이면 채워진다.
 */

// 화면에 한 번에 보여 줄 최대 개수. 더 많으면 목록이 화면을 밀어낸다.
export const 최대추천 = 6;

/*
 * 전각 빗금(／, U+FF0F).
 *
 * 일본어·중국어 입력기를 켠 채로 `/` 를 치면 이 글자가 나온다. 눈으로는 빗금인데 명령 자리는
 * `/` 만 봤다 — 추천은 아무것도 안 뜨고, Enter 를 치면 `／help` 가 말로 모델에게 갔다.
 * 사람은 명령이 없는 줄 안다. 맨 앞 한 글자만 바꾼다(글 가운데의 전각 빗금은 사람 말이다).
 */
const 전각빗금 = String.fromCharCode(0xff0f);

/** 맨 앞의 전각 빗금을 `/` 로. 명령을 가르는 자리(commands.js)도 같은 것을 쓴다. */
export function 빗금펴기(글) {
  const s = String(글 ?? '');
  return s.startsWith(전각빗금) ? `/${s.slice(1)}` : s;
}

/**
 * 지금 치고 있는 글에 맞는 명령들.
 *
 * 슬래시로 시작하고 아직 빈칸을 안 친 동안에만 본다. `/mode auto` 처럼 인자를
 * 치기 시작하면 명령은 이미 정해진 것이라 더 보여 줄 것이 없다.
 *
 * @param {string} 글            사람이 지금까지 친 것
 * @param {object} 명령표         { 이름: { desc, arg } }
 * @param {string[]} 보일것       이 수준에서 보여 줄 이름들 (없으면 전부)
 */
export function 추천(글, 명령표 = {}, 보일것 = null) {
  const s = 빗금펴기(글);
  const m = /^\/([^\s]*)$/.exec(s);
  if (!m) return [];

  const 친것 = m[1].toLowerCase();
  const 이름들 = 보일것 ?? Object.keys(명령표);

  /*
   * 앞에서부터 맞는 것을 먼저, 가운데 맞는 것을 뒤에.
   *
   * `/mo` 를 치면 mode·model 이 먼저 오고, 가운데가 맞는 memory 가 그 뒤에 붙는다.
   * 떨구지 않는 것은 `/emo` 처럼 앞을 틀리게 쳤을 때 memory 가 나오면 고맙기 때문이다 —
   * 오타는 앞글자에서 제일 많이 난다. 순서만으로 충분하고, 지울 이유는 없다.
   */
  const 앞 = [];
  const 안 = [];
  for (const 이름 of 이름들) {
    const 낮 = 이름.toLowerCase();
    if (!친것) { 앞.push(이름); continue; }
    if (낮.startsWith(친것)) 앞.push(이름);
    else if (낮.includes(친것)) 안.push(이름);
  }
  return [...앞, ...안].map((이름) => ({
    이름,
    설명: 명령표[이름]?.desc ?? '',
    인자: 명령표[이름]?.arg ?? '',
  }));
}

/**
 * Tab 을 눌렀을 때 **덧붙일 글자**. 없으면 빈 글자.
 *
 * 하나만 맞으면 끝까지 채우고 빈칸을 하나 붙인다(인자를 받는 명령이면 바로 이어
 * 칠 수 있게). 여럿이면 **다 같이 가진 앞부분까지만** 채운다 — 하나를 골라
 * 넣어 버리면 사람이 원한 것이 아닐 때 지우는 수고가 더 든다.
 */
export function 채울글(글, 후보들) {
  const s = 빗금펴기(글);
  const m = /^\/([^\s]*)$/.exec(s);
  if (!m || !후보들?.length) return '';
  const 친것 = m[1];

  // 앞에서부터 맞는 것만 채운다. 가운데 맞은 것을 채우면 친 글자가 사라진다.
  const 맞는것 = 후보들.filter((x) => x.이름.toLowerCase().startsWith(친것.toLowerCase()));
  if (!맞는것.length) return '';

  if (맞는것.length === 1) {
    const 이름 = 맞는것[0].이름;
    return 이름.slice(친것.length) + (맞는것[0].인자 ? ' ' : '');
  }

  // 다 같이 가진 앞부분.
  let 같은데까지 = 맞는것[0].이름;
  for (const x of 맞는것.slice(1)) {
    let i = 0;
    while (i < 같은데까지.length && i < x.이름.length
      && 같은데까지[i].toLowerCase() === x.이름[i].toLowerCase()) i++;
    같은데까지 = 같은데까지.slice(0, i);
  }
  return 같은데까지.length > 친것.length ? 같은데까지.slice(친것.length) : '';
}

/**
 * readline 에 다는 완성기 — 아무것도 채우지 않되, **붙여넣은 조각 끝의 탭은 살린다.**
 *
 * 빈 완성기를 달아 두는 까닭은 repl.js 에 적어 뒀다(Tab 이 줄에 박히지 않게, 채우기는 우리가
 * rl.write 로). 그런데 readline 은 한 조각(data 한 번)의 **마지막 글자**가 탭이면 그것을 Tab 키로
 * 보고 완성기에 넘긴다. 빈 완성기는 아무것도 안 내놓으니 그 탭이 사라진다 — 엑셀에서 복사한
 * `이름\t부서` 가 조각 경계에 걸리면 `이름부서` 로 붙어 모델에게 간다. 조각 가운데의 탭은
 * readline 이 글자로 넣으니 멀쩡해서, 됐다 안 됐다 한다.
 *
 * 사람이 Tab 을 누르면 조각이 탭 하나다. 그래서 **탭으로 끝나는데 한 글자보다 긴** 조각이면
 * 붙여넣기로 보고 탭을 도로 넣는다. Shift+Tab(ESC [ Z)은 탭으로 안 끝나므로 걸리지 않는다.
 *
 * @param {import('node:stream').Readable} 입력 readline 이 읽는 입력(대개 process.stdin)
 * @returns {(줄: string) => [string[], string]}
 */
export function 붙임탭완성기(입력) {
  let 끝이탭 = false;
  // readline 보다 **먼저** 조각을 봐야 한다 — 완성기는 readline 이 조각을 푸는 도중에 불린다.
  입력?.prependListener?.('data', (조각) => {
    const n = 조각?.length ?? 0;
    const 끝 = typeof 조각 === 'string' ? 조각.charCodeAt(n - 1) : 조각?.[n - 1];
    끝이탭 = n > 1 && 끝 === 9;
  });
  return (줄) => (끝이탭 ? [[`${줄}\t`], 줄] : [[], 줄]);
}
