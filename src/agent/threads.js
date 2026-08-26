// 한 창에서 대화를 여러 갈래로 굴린다.
//
// ── 왜 만드나 ───────────────────────────────────────────────────────────
//
// 일하다 보면 곁가지가 생긴다. "이 함수 왜 이래?" "이 오류 뭐야?" 같은 것들이다.
// 지금은 그걸 하던 대화에 그냥 던진다. 그러면 두 가지가 같이 나빠진다.
//
//   1) 곁가지가 읽어 온 파일·오류·시행착오가 **본 줄기의 자리를 먹는다.**
//      한 번 물어본 것 때문에 하던 일이 접히는 자리까지 밀려간다.
//   2) 모델이 방금 본 곁가지에 끌려간다. 하던 일로 돌아오라고 다시 말해야 한다.
//
// 창을 하나 더 띄우면 되지 않느냐 — 안 된다. 새 창은 연결도, 스킬도, 폴더 지문도,
// 되돌리기 이력도 처음부터 다시 잡는다. 켜는 데만 몇 초씩 들고, `/undo` 는 창마다
// 따로 놀아서 어느 창이 뭘 되돌리는지 알 수 없게 된다.
//
// 그래서 **대화만** 여러 벌 갖는다.
//
//   같이 쓰는 것   연결·모델·도구·스킬·작업 범위·되돌리기·감사 기록
//   갈래마다 따로   오간 말·토큰 셈·할 일 목록·저장 파일
//
// Task 도구와는 다른 것이다. Task 는 모델이 스스로 떼어 내는 것이고 결과만 돌아온다.
// 갈래는 **사람이** 오가는 것이고, 오간 말이 그대로 남아서 나중에 되돌아올 수 있다.
//
// ── 조심한 것 ───────────────────────────────────────────────────────────
//
// 갈래마다 저장 파일을 따로 준다. 한 파일에 섞어 적으면 이어하기가 두 갈래를
// 한 줄기로 읽어서, 서로 상관없는 대화가 한 덩어리가 된다.

/** 이름이 없을 때 붙여 줄 이름. 사람이 목록에서 알아볼 수 있으면 된다. */
function 기본이름(n) { return `갈래 ${n}`; }

export class Threads {
  /**
   * @param {object} session  지금 도는 대화. 첫 갈래가 된다.
   * @param {object} ctx      할 일 목록이 여기 붙어 있다
   * @param {function} 새store  () => Store — 갈래마다 저장 파일을 새로 연다
   * @param {object} 첫store   지금 대화가 쓰고 있던 저장 파일
   */
  constructor(session, ctx, 새store, 첫store) {
    this.session = session;
    this.ctx = ctx;
    this.새store = 새store;
    this.갈래들 = [{ 이름: '본줄기', messages: session.messages, usage: session.usage, todos: ctx?.todos ?? null, store: 첫store }];
    this.자리 = 0;
    this.센것 = 1;
  }

  현재() { return this.갈래들[this.자리]; }
  현재store() { return this.현재().store; }
  개수() { return this.갈래들.length; }

  /** 지금 화면에서 오가던 것을 갈래에 넣어 둔다. 옮기기 전에 반드시 부른다. */
  #담아두기() {
    const g = this.현재();
    g.messages = this.session.messages;
    g.usage = this.session.usage;
    g.todos = this.ctx?.todos ?? null;
  }

  /** 갈래 하나를 화면으로 꺼낸다. */
  #꺼내기(i) {
    this.자리 = i;
    const g = this.현재();
    this.session.messages = g.messages;
    this.session.usage = g.usage;
    if (this.ctx) this.ctx.todos = g.todos;
    // 상태줄이 지금 어느 갈래인지 보여 줄 수 있게 남긴다.
    // 갈래가 하나뿐이면 안 보인다 — 안 쓰는 사람 화면은 그대로여야 한다.
    this.session.갈래표 = this.갈래들.length > 1 ? g.이름 : null;
    return g;
  }

  /**
   * 새 갈래. 빈 대화로 시작한다.
   * @param {string} 이름
   * @param {object[]} 물려줄것  갈라내기면 지금 대화의 사본
   */
  새로(이름 = '', 물려줄것 = null) {
    this.#담아두기();
    this.센것++;
    const store = this.새store();
    const g = {
      이름: String(이름 ?? '').trim() || 기본이름(this.센것),
      messages: 물려줄것 ? [...물려줄것] : [],
      usage: { in: 0, out: 0, calls: 0, ms: 0 },
      todos: null,
      store,
    };
    this.갈래들.push(g);
    // 갈라낸 것은 지금까지 오간 말을 새 파일에도 적어 둔다. 안 적으면 그 갈래를
    // 나중에 이어할 때 앞부분이 없어서 무슨 얘기였는지 알 수 없다.
    if (물려줄것?.length) { for (const m of 물려줄것) store.append(m); }
    return this.#꺼내기(this.갈래들.length - 1);
  }

  /** 지금 대화를 그대로 복사해 새 갈래로 나간다. */
  갈라내기(이름 = '') {
    return this.새로(이름, this.session.messages);
  }

  /**
   * 갈래를 찾는다. 번호(1부터)도 되고 이름 일부도 된다.
   * @returns {number} 못 찾으면 -1
   */
  찾기(말) {
    const s = String(말 ?? '').trim();
    if (!s) return -1;
    if (/^\d+$/.test(s)) {
      const i = Number(s) - 1;
      return i >= 0 && i < this.갈래들.length ? i : -1;
    }
    const 낮 = s.toLowerCase();
    const 딱 = this.갈래들.findIndex((g) => g.이름.toLowerCase() === 낮);
    if (딱 >= 0) return 딱;
    return this.갈래들.findIndex((g) => g.이름.toLowerCase().includes(낮));
  }

  옮기기(말) {
    const i = this.찾기(말);
    if (i < 0) return null;
    if (i === this.자리) return this.현재();
    this.#담아두기();
    return this.#꺼내기(i);
  }

  /**
   * 갈래를 닫는다. 마지막 하나는 못 닫는다 — 닫으면 대화가 없어진다.
   * 저장 파일은 안 지운다. `/sessions` 로 다시 찾아갈 수 있어야 한다.
   */
  닫기(말 = '') {
    if (this.갈래들.length <= 1) return { ok: false, why: '갈래가 하나뿐입니다.' };
    const i = 말 ? this.찾기(말) : this.자리;
    if (i < 0) return { ok: false, why: '그런 갈래가 없습니다.' };
    if (i === this.자리) this.#담아두기();
    const [닫은것] = this.갈래들.splice(i, 1);
    // 닫힌 자리보다 뒤에 있었으면 번호가 하나 당겨진다.
    const 다음 = i === this.자리 ? Math.max(0, i - 1) : (this.자리 > i ? this.자리 - 1 : this.자리);
    this.자리 = 다음;
    this.#꺼내기(다음);
    return { ok: true, 닫은것, 지금: this.현재() };
  }

  /** 화면에 뿌릴 목록. */
  목록() {
    return this.갈래들.map((g, i) => ({
      번호: i + 1,
      이름: g.이름,
      지금: i === this.자리,
      말수: (i === this.자리 ? this.session.messages : g.messages).length,
      토큰: (i === this.자리 ? this.session.usage : g.usage)?.in ?? 0,
      id: g.store?.id ?? null,
    }));
  }
}
