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
import { 파일기억 } from './filemem.js';
import { 규격맞추기 } from './session.js';

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
    /*
     * 이어받은 대화를 **지금 규격으로** 옮겨 적는다 (agent/session.js 의 규격맞추기).
     *
     * 저장 파일 머리글에는 규격이 없다. 어제 Anthropic 으로 한 대화를 오늘 OpenAI
     * 호환 연결로 --resume 하면 tool_use·tool_result 블록이 그대로 나가서 첫 마디가
     * 400 이었다. 이어받은 대화가 들어오는 자리가 여기(첫 한마디 전, 갈래 표에
     * 담기 전)다. 턴마다 적는 자리(repl 의 saved)가 메시지 **수**로 세므로, 수가
     * 바뀔 수 있는 이 손질은 턴이 돌기 전에 끝나야 한다 — 그래서 여기다.
     * 이미 맞는 대화면 아무것도 안 바뀐다.
     */
    const 옮김 = 규격맞추기(session?.messages, session?.conn?.kind);
    if (옮김.바꾼것) session.messages = 옮김.messages;
    /** 이어받을 때 옮겨 적은 것. 화면이 말할 수 있게 남긴다. */
    this.옮긴것 = 옮김.바꾼것 ? { 바꾼것: 옮김.바꾼것, 뺀것: 옮김.뺀것 } : null;
    /*
     * 남은 할 일과 시킨 말 원문을 저장 파일과 묶는다 (agent/store.js 의 살림따라가기).
     *
     * **첫 한마디가 오기 전**인 여기여야 한다. 턴이 시작되면 loop.js 가
     * 이번요청을 새 말로 덮으므로, 그 뒤에 되살리면 방금 시킨 말이 어제 시킨
     * 말로 되돌아간다. 여태 이 둘만 메모리에 있어서, 이어받아도 오간 말은
     * 돌아오는데 남은 할 일은 안 돌아왔다.
     */
    첫store?.살림따라가기?.(session);
    /*
     * 파일기억·filesRead 도 **갈래 것**이다.
     *
     * 이 둘은 「messages 안에 무엇이 살아 있나」 의 그림자다. messages 를
     * 갈래마다 따로 두면서 이것만 세션에 하나로 두면 반드시 어긋나고, 어긋나면
     * 「앞에서 읽은 그대로입니다」 가 **그 글이 없는 갈래에서** 나온다 —
     * 모델은 대화 어디에도 없는 글을 가리키는 쪽지를 받고, 다시 읽어도 파일이
     * 안 바뀌었으니 같은 쪽지를 받는다. 세 번째에 헛돈다고 턴이 죽는다.
     * (agent/filemem.js 머리말의 「통째로 다시 싣는 것보다 훨씬 나쁘다」)
     */
    this.갈래들 = [{
      이름: '본줄기', messages: session.messages, usage: session.usage, todos: ctx?.todos ?? null,
      할일: session.할일, 이번요청: session.이번요청, store: 첫store,
      파일기억: session.파일기억, filesRead: session.filesRead,
    }];
    this.자리 = 0;
    this.센것 = 1;
    /*
     * ── 닫은 갈래가 **쓴 돈**은 어디로 가나 ────────────────────────
     *
     * 여태 아무 데도 안 갔다. 닫기() 는 갈래를 splice 로 빼기만 했고,
     * 그 갈래가 태운 토큰·호출·시간은 그 자리에서 사라졌다. 곁가지에서
     * 오래 헤매다 닫고 본줄기로 돌아오면 `/cost` 는 그 값을 못 본다 —
     * **실제로 낸 돈보다 적은 금액**이 화면에 뜬다.
     *
     * 갈래를 지운다고 청구서가 지워지지는 않는다. 그래서 여기에 쌓는다.
     */
    this.닫힌셈 = { in: 0, out: 0, prompt: 0, calls: 0, ms: 0, retries: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, 못잰것: 0 };
    this.닫힌수 = 0;
  }

  /**
   * **모든 갈래**가 지금까지 쓴 것을 합친다. 닫은 갈래 것까지 센다.
   *
   * `/cost` 가 session.usage 하나만 보고 있었다. 그건 지금 갈래 것이다.
   * 갈래를 셋 굴리면 화면의 금액은 그중 하나 몫이고, 갈래를 바꾸는
   * 것만으로 숫자가 내려간다 — 돈은 그대로 나가는데.
   *
   * 지금 갈래 값은 **session 쪽**에서 가져온다.
   *
   * 처음에 여기 「갈래 표에 담긴 것은 마지막으로 옮길 때 담아 둔 값이라
   * 이번 턴 것이 빠져 있다」 라고 적어 뒀는데, **그건 사실이 아니다.**
   * #꺼내기() 가 `session.usage = g.usage` 로 **같은 객체를 물려** 주고,
   * session 쪽에서 그 객체를 갈아 끼우는 자리는 생성자 말고는 없다.
   * 그러니 지금은 둘이 늘 같은 값이다 — 어긋내기 판이 이 줄을 표 쪽으로
   * 바꿔도 검사가 안 빨개져서 그걸로 알았다.
   *
   * 그래도 session 쪽을 읽는다. 언젠가 누가 usage 를 통째로 갈아 끼우면
   * (되감기·이어받기가 그럴 만한 자리다) 표 쪽만 읽는 코드는 그 순간부터
   * 조용히 적은 금액을 적는다. 값을 두 군데서 들고 있을 때는 **살아 있는
   * 쪽**을 읽는 것이 맞다.
   */
  전체usage() {
    const 합 = { ...this.닫힌셈 };
    for (let i = 0; i < this.갈래들.length; i++) {
      const u = (i === this.자리 ? this.session.usage : this.갈래들[i].usage) ?? {};
      for (const k of Object.keys(합)) 합[k] += Number(u[k] ?? 0);
    }
    return 합;
  }

  /** 지금 갈래 것과 전부의 것이 다른가. 다를 때만 화면에 두 줄이 필요하다. */
  갈래여럿인가() { return this.갈래들.length > 1 || this.닫힌수 > 0; }

  현재() { return this.갈래들[this.자리]; }
  현재store() { return this.현재().store; }
  개수() { return this.갈래들.length; }

  /** 지금 화면에서 오가던 것을 갈래에 넣어 둔다. 옮기기 전에 반드시 부른다. */
  #담아두기() {
    const g = this.현재();
    g.messages = this.session.messages;
    g.usage = this.session.usage;
    g.todos = this.ctx?.todos ?? null;
    // 남은 할 일·시킨 말도 갈래 것이다. 저장 파일이 갈래마다 따로라, 이걸 안
    // 담아 두면 곁가지에서 적은 할 일을 들고 본줄기로 돌아와 본줄기 파일에
    // 적어 버린다 — 이어받을 때 하지도 않은 일이 본줄기에 남는다.
    g.할일 = this.session.할일;
    g.이번요청 = this.session.이번요청;
    // 읽은 파일 기억도 같이 — 까닭은 생성자에 적어 뒀다.
    g.파일기억 = this.session.파일기억;
    g.filesRead = this.session.filesRead;
  }

  /** 갈래 하나를 화면으로 꺼낸다. */
  #꺼내기(i) {
    this.자리 = i;
    const g = this.현재();
    this.session.messages = g.messages;
    this.session.usage = g.usage;
    if (this.ctx) this.ctx.todos = g.todos;
    this.session.할일 = g.할일 ?? [];
    this.session.이번요청 = g.이번요청 ?? '';
    /*
     * 여기서 session.파일기억 을 통째로 갈아 끼운다.
     *
     * 이미 잊기() 를 부르는 자리들(compact.js · loop.js · session.js)은 전부
     * session.파일기억 을 거치므로 손댈 것이 없다 — 그때그때 지금 갈래의 것을
     * 잊는다. 문이 하나로 남는다.
     */
    if (g.파일기억) this.session.파일기억 = g.파일기억;
    if (g.filesRead) this.session.filesRead = g.filesRead;
    // 적는 자리도 지금 갈래의 파일로 옮긴다 (agent/store.js 의 살림따라가기).
    g.store?.살림따라가기?.(this.session);
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
      이름: this.#새이름(이름),
      messages: 물려줄것 ? [...물려줄것] : [],
      // session.usage 와 **같은 모양**이어야 한다. 여태 다섯 칸만 있어서
      // 갈래에서는 캐시·생각·못잰것 칸이 아예 없었다. 더하는 자리들이 전부
      // `?? 0` 을 써서 터지지는 않았지만, 모양이 둘인 것 자체가 다음 사람의 함정이다.
      usage: { in: 0, out: 0, prompt: 0, calls: 0, ms: 0, retries: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, 못잰것: 0 },
      todos: null,
      // 할 일도 todos 와 같이 비워서 시작한다. 곁가지는 다른 일을 하러 나가는
      // 것이고, 물려받으면 본줄기의 남은 일을 곁가지 파일에도 적게 된다.
      할일: [],
      이번요청: '',
      store,
      /*
       * 갈라낸 것이면 지금 기억을 **베껴** 물려준다. 같이 쓰면 한쪽에서 파일을
       * 다시 읽은 것이 다른 쪽 답을 바꾼다 — 갈라낸 쪽에서 v3 을 읽으면
       * 본줄기가 「안 바뀌었다」 고 답하기 시작한다. 본줄기에 실린 것은 v1 인데도.
       * 빈 갈래면 빈 기억이다. 대화가 비었으니 기억할 것도 없다.
       */
      파일기억: 물려줄것 ? (this.session.파일기억?.베끼기?.() ?? new 파일기억()) : new 파일기억(),
      filesRead: 물려줄것 ? new Map(this.session.filesRead ?? []) : new Map(),
    };
    this.갈래들.push(g);
    // 갈라낸 것은 지금까지 오간 말을 새 파일에도 적어 둔다. 안 적으면 그 갈래를
    // 나중에 이어할 때 앞부분이 없어서 무슨 얘기였는지 알 수 없다.
    if (물려줄것?.length) { for (const m of 물려줄것) store.append(m); }
    return this.#꺼내기(this.갈래들.length - 1);
  }

  /*
   * ── 이름이 번호와도, 다른 갈래 이름과도 안 겹치게 (2.0.0 6회차 · Gemini 스레드6) ──
   *
   * 찾기() 는 숫자뿐인 말을 **번호로 먼저** 읽는다. 그래서 「2」 라는 이름의 갈래는 이름으로는
   * 영영 못 갔고, `/thread 2` 는 둘째 갈래로 갔다. 같은 이름을 두 번 주면 찾기가 늘 첫째를
   * 집어 둘째는 번호로만 갈 수 있었다. 찾기 규칙을 바꾸면 이미 쓰는 번호 길이 흔들리므로,
   * 만드는 자리에서 겹치지 않는 이름을 준다 — 숫자뿐이면 앞에 `#`, 겹치면 뒤에 ` (2)`.
   * 새로() 가 돌려주는 갈래의 이름을 화면이 그대로 보여 주므로 사람은 바뀐 이름을 본다.
   */
  #새이름(이름) {
    let s = String(이름 ?? '').trim() || 기본이름(this.센것);
    if (/^\d+$/.test(s)) s = `#${s}`;
    const 겹치나 = (x) => this.갈래들.some((g) => g.이름.toLowerCase() === x.toLowerCase());
    if (!겹치나(s)) return s;
    let k = 2;
    while (겹치나(`${s} (${k})`)) k++;
    return `${s} (${k})`;
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
    /*
     * 범위 밖 숫자는 **번호가 아니라 이름**이다 (2.0.0 8회차 스키마). 여기서 -1 로 끝냈더니
     * 위 #새이름() 이 `#404` 로 바꿔 준 갈래를, 목록에 보이는 그 숫자로는 영영 못 갔다.
     * 범위 안 번호는 그대로 번호가 이긴다 — 6회차 스레드6 이 정한 차례를 안 흔든다.
     */
    if (/^\d+$/.test(s)) {
      const i = Number(s) - 1;
      if (i >= 0 && i < this.갈래들.length) return i;
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
    /*
     * **어느 갈래를 닫든** 먼저 담아 둔다.
     *
     * 여기가 `if (i === this.자리)` 로 지금 갈래를 닫을 때만 담았다. 다른 갈래를
     * 닫으면 아래 #꺼내기() 가 지금 갈래를 **표에 담긴 옛 모습**으로 다시 꺼낸다 —
     * 옮겨 온 뒤에 쌓인 말(접기가 messages 를 갈아 끼웠으면 통째로), 할 일,
     * 시킨 말이 그 자리에서 없어지고, 다음에 적을 때 파일에 빈 할 일이 적힌다.
     * #담아두기() 머리말이 「옮기기 전에 반드시 부른다」 인데, 닫기도 옮기기다.
     */
    this.#담아두기();   // 닫는 것이 지금 갈래가 아니어도

    const [닫은것] = this.갈래들.splice(i, 1);
    // 갈래는 지워도 그 갈래가 낸 돈은 안 지워진다 (생성자의 닫힌셈).
    for (const k of Object.keys(this.닫힌셈)) this.닫힌셈[k] += Number(닫은것.usage?.[k] ?? 0);
    this.닫힌수 += 1;
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
