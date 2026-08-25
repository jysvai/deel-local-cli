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
  const s = String(글 ?? '');
  const m = /^\/([^\s]*)$/.exec(s);
  if (!m) return [];

  const 친것 = m[1].toLowerCase();
  const 이름들 = 보일것 ?? Object.keys(명령표);

  /*
   * 앞에서부터 맞는 것을 먼저, 가운데 맞는 것을 뒤에.
   *
   * `/mo` 를 치면 mode·model 이 먼저 오고 memory 는 안 온다. 그런데 `/emo` 처럼
   * 앞을 틀리게 쳤을 때도 memory 가 나오면 고맙다 — 오타는 앞글자에서 제일 많이 난다.
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
  const s = String(글 ?? '');
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
