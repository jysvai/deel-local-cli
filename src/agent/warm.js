/*
 * ── 모델을 미리 올려 두고, 치는 동안 앞머리를 미리 읽힌다 (2.2.0) ───────────
 *
 * 로컬 모델의 첫 답이 느린 까닭은 대개 **생각이 아니라 읽기**다.
 *
 *   1) 올리기 — 첫 요청이 와야 서버가 모델을 디스크에서 램·VRAM 으로 올린다.
 *      7B 도 몇 초, 30B 면 수십 초다. 그동안 화면에는 「생각 중」 만 돈다.
 *   2) 앞머리 읽기(prefill) — 시킴말·도구 스키마·지난 대화를 처음부터 계산한다.
 *      우리 앞머리는 수천 토큰이고, CPU·작은 GPU 에서는 그게 그대로 수십 초다.
 *
 * 둘 다 **사람이 Enter 를 치기 전에** 할 수 있는 일이다. 무엇을 보낼지 대부분
 * 이미 알고 있기 때문이다 — 시킴말·도구·지난 대화는 정해져 있고, 사람 말은
 * 지금 치고 있는 그 글이다. 그래서:
 *
 *   · 입력칸이 뜨면 지금 대화 그대로 한 번 보낸다 — 켤 때는 이것이 모델 올리기다
 *   · 치다가 손을 떼면(쉼) 그때까지 친 글까지 붙여 한 번 더 보낸다
 *   · Enter 를 치면 진짜 요청은 이미 계산된 앞머리를 이어받고, 남은 몇 글자만 읽는다
 *
 * 보내는 것은 진짜 요청과 **같은 몸**이고 답만 한 토큰으로 막는다. 서버의 프리픽스
 * 캐시(Ollama · llama.cpp · LM Studio · vLLM 이 다 갖고 있다)가 나머지를 한다.
 * 그래서 몸은 loop.js 의 셈(턴도구 · 첫걸음강도)으로 짓고, 모드는 repl 이 Enter
 * 때 고르는 그대로(route) 고른다. 한 글자라도 다르면 캐시가 거기서 끊긴다.
 *
 * ── 답을 미리 지어 보여 주지는 않는다 ─────────────────────────────────────
 *
 * 치는 동안 답까지 미리 뽑는 길도 있다. 안 간다. 글자 하나가 바뀔 때마다 지은
 * 답을 버려야 하고, 그동안 같은 GPU 를 붙들어 정작 읽기가 늦어진다. 게다가 이
 * 프로그램의 답은 도구 부름이다 — 사람이 다 치기 전에 파일을 고칠 수는 없다.
 * 읽기는 버릴 것이 없다. 친 글이 바뀌어도 앞부분은 그대로 재쓰인다.
 *
 * ── 품질 쪽 ───────────────────────────────────────────────────────────────
 *
 * 작은 모델이 엉뚱해지는 흔한 까닭은 창이 작게 올라가 앞이 잘리는 것이다
 * (backend/adapter.js 의 num_ctx). 미리 올릴 때도 같은 num_ctx 를 실으므로 모델은
 * **처음부터 제 길이로** 올라간다 — 짧게 올렸다가 첫 요청에 다시 올리는 일이 없다.
 *
 * ── 언제 켜나 ─────────────────────────────────────────────────────────────
 *
 * 공짜인 자리에서만 저절로 켠다. 이 컴퓨터·사내망 주소이고, 요금이 매겨진 모델이
 * 아니고, Ollama 의 클라우드 모델(`…-cloud`)이 아닐 때다. 127.0.0.1 에 선 프록시가
 * 유료 모델로 넘기는 판도 있어서, 주소만 보지 않고 요금표도 본다. 쉴 때마다 한 번씩
 * 나가는 것이라 돈이 드는 곳에서 저절로 켜면 안 된다.
 *   DEEL_WARMUP=0 · 설정 "warmup": false  → 끔
 *   DEEL_WARMUP=1 · 설정 "warmup": true   → 어디서든 켬 (사람이 고른 것)
 */
import { chat } from '../backend/adapter.js';
import { 세션요금 } from '../backend/price.js';
import { 바깥인가 } from '../safety/runmode.js';
import { route } from './route.js';
import { 턴도구, 첫걸음강도 } from './loop.js';

const 끄는말 = new Set(['0', 'off', 'false', 'no', '끔']);
const 켜는말 = new Set(['1', 'on', 'true', 'yes', '켬']);

// 손을 떼고 이만큼 조용하면 그때까지 친 것을 보낸다. 짧으면 한 글자마다 나가고,
// 길면 Enter 를 먼저 쳐 버린다. 사람이 낱말 사이에서 멈추는 길이쯤이다.
export const 쉼기본 = 400;
// Enter 뒤에 돌던 것을 기다려 주는 상한. 서버가 멎었으면 진짜 요청도 어차피 멎는다 —
// 그때는 기다리지 말고 진짜 요청이 제 울타리(무소식)로 말하게 둔다.
export const 기다림상한 = 30000;
// 이만큼 잇달아 거절되면 이 세션에서는 그만 보낸다. 안 받는 서버를 쉴 때마다 두드리지 않는다.
const 연달아한도 = 2;

/**
 * 이 세션에서 미리 읽기를 켤까.
 * @returns {{켬: boolean, 왜: '꺼둠'|'켜둠'|'바깥'|'클라우드모델'|'요금'|'로컬'|'서버거절'}}
 */
export function 예열판정(session, { env = process.env, cfg = null } = {}) {
  const conn = session?.conn ?? {};
  const 환경 = String(env?.DEEL_WARMUP ?? '').trim().toLowerCase();
  const 적은 = String(cfg?.warmup ?? '').trim().toLowerCase();
  if (끄는말.has(환경) || (!환경 && 끄는말.has(적은))) return { 켬: false, 왜: '꺼둠' };
  if (켜는말.has(환경) || (!환경 && 켜는말.has(적은))) return { 켬: true, 왜: '켜둠' };
  if (바깥인가(conn.base)) return { 켬: false, 왜: '바깥' };
  /*
   * Ollama 가 제 이름으로 받아 ollama.com 으로 넘기는 모델(`gpt-oss:120b-cloud` · `glm-4.6:cloud`).
   * 주소는 127.0.0.1 이지만 몫이 깎인다. 끝에만 걸면 `…-cloud:latest` 같은 꼴이 빠진다 — 이름 안의
   * 한 마디로 본다. 이 PC 의 모델 이름에 그 마디가 있으면 꺼지는데, 그쪽은 느릴 뿐이고 반대쪽은 돈이다.
   */
  if (/(^|[-:/_.])cloud($|[-:/_.])/i.test(String(conn.model ?? ''))) return { 켬: false, 왜: '클라우드모델' };
  let 값 = null;
  try { 값 = 세션요금(session); } catch { /* 요금표를 못 읽으면 모르는 것 — 주소로 간다 */ }
  if ((Number(값?.입력) || 0) > 0 || (Number(값?.출력) || 0) > 0) return { 켬: false, 왜: '요금' };
  return { 켬: true, 왜: '로컬' };
}

/**
 * 보낼 만한 글인가. 명령(`/…`)과 셸(`!…`)은 모델에게 안 간다 — null.
 * `@파일` 은 Enter 때 그 자리가 파일로 펼쳐지므로 그 앞까지만 보낸다.
 */
export function 보낼초안(글) {
  // repl 이 보낼 때 앞뒤를 다듬는다(line.trim()). 같은 글자로 맞춘다.
  const s = String(글 ?? '').trim();
  if (s.startsWith('/') || s.startsWith('!')) return null;
  const i = s.indexOf('@');
  return i < 0 ? s : s.slice(0, i).trimEnd();
}

export class 미리읽기 {
  /**
   * @param {object} session
   * @param {object} ctx      턴 문맥 — MCP·에이전트 목록이 도구에 실린다
   * @param {{cfg?, env?, 쉼?, 기다림?, 부르기?, 바뀜?: () => void}} o
   *   부르기 · 기다림 은 검사가 갈아 끼운다(기본 chat · 기다림상한). 바뀜 은 상태가 바뀔 때 화면을 다시 그리게 부른다.
   */
  constructor(session, ctx, { cfg = null, env = process.env, 쉼 = 쉼기본, 기다림 = 기다림상한, 부르기 = chat, 바뀜 = null } = {}) {
    this.session = session;
    this.ctx = ctx;
    this.cfg = cfg;
    this.env = env;
    this.판정 = { 켬: false, 왜: '꺼둠' };
    this.판정열쇠 = null;
    this.#판정보기();
    this.쉼 = 쉼;
    this.기다림 = 기다림;
    this.부르기 = 부르기;
    this.바뀜 = 바뀜;
    this.도는것 = null;      // 지금 나가 있는 요청 (끝나면 null)
    this.멈추개 = null;
    this.시계 = null;        // 쉼 시계
    this.잠김 = false;       // 턴이 도는 동안은 안 보낸다 — 모델은 그 턴의 것이다
    this.다음 = null;        // 도는 동안 새로 친 글. 끝나면 이어서 보낸다
    this.보낸것 = null;      // 마지막으로 다 읽힌 몸의 서명 — 같은 것을 두 번 안 보낸다
    this.실패 = 0;
    this.셈 = { 횟수: 0, 읽은토큰: 0, 마지막: null };
  }

  get 켬() { return this.판정.켬 === true; }

  /** 입력칸이 떴다. 지금 대화 그대로 한 번 — 켤 때는 이것이 모델을 올린다. */
  풀기() {
    this.잠김 = false;
    this.#판정보기();
    this.#보내기('');
  }

  /** 키를 쳤다. 손을 떼고 쉼 만큼 조용하면 그때까지 친 글로 보낸다. */
  쳤다(글) {
    if (!this.켬 || this.잠김) return;
    clearTimeout(this.시계);
    this.시계 = setTimeout(() => {
      this.시계 = null;
      this.#보내기(글);
      // 안 보낸 판(같은 몸 · 명령)이면 아무도 다시 안 그린다 — 대기중 으로 흐려 둔 ↯ 를 되돌린다.
      if (!this.도는것) { try { this.바뀜?.(); } catch { /* 화면 탈로 멈추면 안 된다 */ } }
    }, this.쉼);
    this.시계.unref?.();
  }

  /** Enter 를 쳤다. 새로 보내는 것을 멈춘다 — 이미 나간 것은 그대로 둔다(기다리기). */
  잠그기() {
    this.잠김 = true;
    clearTimeout(this.시계);
    this.시계 = null;
    this.다음 = null;
  }

  /*
   * 나가 있는 것이 있으면 끝나기를 기다린다.
   *
   * 상한이 먼저 오면 **그것을 끊고** 간다. 30초를 읽고도 안 끝난 것은 서버가 바쁘거나 멎은 것이고,
   * 그대로 두면 진짜 요청이 빈 자리에서 같은 앞머리를 또 읽는다 — 기다린 까닭이 바로 그걸 막자는
   * 것이었다. 멈춤 신호(Ctrl+C · ESC)면 끊지 않는다. 턴은 접히지만 읽던 앞머리는 다음 말에 그대로
   * 쓰이고, 진짜 요청은 어차피 안 나간다(http.js 가 끊긴 신호를 보고 보내기 전에 던진다).
   */
  async 기다리기(signal = null) {
    const 그것 = this.도는것;
    if (!그것) return;
    const 멈추개 = this.멈추개;
    let 시계 = null;
    let 끊기 = null;
    await Promise.race([
      그것,
      new Promise((res) => {
        시계 = setTimeout(() => { if (this.멈추개 === 멈추개) 멈추개?.abort(); res(); }, this.기다림);
        시계.unref?.();
      }),
      new Promise((res) => {
        if (!signal) return;
        if (signal.aborted) { res(); return; }
        끊기 = res;
        signal.addEventListener('abort', 끊기, { once: true });
      }),
    ]);
    clearTimeout(시계);
    if (끊기) signal.removeEventListener('abort', 끊기);
  }

  /*
   * 연결이 바뀌었으면(/model) 판정부터 다시 한다.
   *
   * 갈아타는 문이 여럿이라(/model · 이어받기) 문마다 「다시 보라」 를 부탁하면 언젠가 한
   * 군데를 빠뜨린다 — 세션요금 이 같은 까닭으로 모델 이름을 열쇠로 들고 있다(backend/price.js).
   * 서버가 거절해서 끈 것도 같은 연결 동안만이다. 다른 모델로 가면 다시 본다.
   */
  #판정보기() {
    const k = this.session?.conn ?? {};
    const 열쇠 = `${k.kind}|${k.base}|${k.model}`;
    if (열쇠 === this.판정열쇠) return;
    this.판정열쇠 = 열쇠;
    this.멈추개?.abort();
    this.판정 = 예열판정(this.session, { env: this.env, cfg: this.cfg });
    this.보낸것 = null;
    this.실패 = 0;
    // 셈도 이 연결의 것만 — 안 비우면 앞 모델이 읽은 것이 새 모델의 「↯ 미리 읽음」 으로 뜬다.
    this.셈 = { 횟수: 0, 읽은토큰: 0, 마지막: null };
  }

  /** 이 세션에서 그만 보낸다. */
  끄기(왜 = '꺼둠') {
    this.판정 = { 켬: false, 왜 };
    this.잠그기();
    this.멈추개?.abort();
  }

  /** /status 와 상태줄이 본다. */
  상태() {
    this.#판정보기();
    /*
     * 대기중 — 친 글이 아직 안 나갔다(쉼 시계가 걸렸거나, 도는 것 뒤에 줄 서 있다). 그때 「미리 읽음」
     * 을 띄우면 거짓이다. 다 읽힌 것은 **지난** 글이고, 지금 친 글은 아직 아무도 안 읽었다.
     */
    return { ...this.판정, 도는중: !!this.도는것, 대기중: !!this.시계 || this.다음 !== null, ...this.셈 };
  }

  /*
   * 진짜 요청과 같은 몸을 짓는다.
   *
   * 모드는 repl 이 Enter 때 고르는 그대로 고른다(종합 모드면 route). 시킴말 꼬리와
   * 도구 목록이 모드를 따라가서, 여기서 모드가 다르면 앞머리가 거기서 갈린다.
   * session.routed 를 잠깐 바꿨다가 되돌린다 — 사이에 await 가 없어 다른 일이 끼지 못한다.
   */
  #짓기(초안) {
    const s = this.session;
    const 옛 = s.routed;
    try {
      s.routed = s.work === 'auto' ? (route(초안).mode ?? null) : null;
      return {
        messages: [...s.wire(), { role: 'user', content: 초안 }],
        tools: 턴도구(s, this.ctx),
        think: 첫걸음강도(s, 초안, { 대화크기: s.messages.length + 1 }),
      };
    } finally {
      s.routed = 옛;
    }
  }

  #보내기(글) {
    if (!this.켬 || this.잠김) return;
    const 초안 = 보낼초안(글);
    if (초안 === null) return;
    if (this.도는것) { this.다음 = 초안; return; }
    let 몸;
    try { 몸 = this.#짓기(초안); } catch { return; }   // 못 지으면 진짜 요청이 제 탈을 말한다
    const 서명 = JSON.stringify([this.session.conn?.model, this.session.conn?.ctx, 몸]);
    if (서명 === this.보낸것) return;
    const 멈추개 = new AbortController();
    this.멈추개 = 멈추개;
    const 처음 = Date.now();
    this.셈.횟수 += 1;
    this.도는것 = Promise.resolve()
      .then(() => this.부르기(this.session.conn, {
        ...몸,
        maxTokens: 1,
        // 다시 부르지 않는다. 막혔으면 다음 쉼에 또 보내면 되고, 그 사이 사다리를 타면 Enter 뒤의
        // 진짜 요청이 그 대기만큼 늦게 출발한다.
        retry: { 최대: 0, 막힘최대: 0 },
        timeout: 120000,
        signal: 멈추개.signal,
      }))
      .then((r) => {
        this.실패 = 0;
        this.보낸것 = 서명;
        /*
         * 서버가 이번에 **새로 읽은** 토큰. Ollama 의 prompt_eval_count 는 처음부터 그 값이다 — 캐시에서
         * 재쓴 몫은 안 센다. OpenAI 규격의 prompt_tokens 는 총계라 캐시 몫(cached_tokens)을 뺀다.
         * 캐시 몫을 안 알려 주는 서버면 총계가 그대로 남는다 — 그래서 화면 말은 「서버가 읽은」 이다.
         */
        const u = r?.usage ?? {};
        const 들어감 = Number(u.in) || 0;
        const 토큰 = this.session.conn?.kind === 'ollama' ? 들어감 : Math.max(0, 들어감 - (Number(u.cacheRead) || 0));
        this.셈.읽은토큰 += 토큰;
        this.셈.마지막 = { ok: true, ms: Date.now() - 처음, 토큰, 글자: 초안.length };
      }, (e) => {
        if (멈추개.signal.aborted) return;
        this.실패 += 1;
        this.셈.마지막 = { ok: false, ms: Date.now() - 처음, 왜: String(e?.message ?? e).split('\n')[0].slice(0, 120) };
        if (this.실패 >= 연달아한도) this.끄기('서버거절');
      })
      .finally(() => {
        if (this.멈추개 === 멈추개) this.멈추개 = null;
        this.도는것 = null;
        const 다음 = this.다음;
        this.다음 = null;
        try { this.바뀜?.(); } catch { /* 화면 탈로 미리 읽기가 멈추면 안 된다 */ }
        if (다음 !== null) this.#보내기(다음);
      });
    try { this.바뀜?.(); } catch { /* 위와 같다 */ }
  }
}
