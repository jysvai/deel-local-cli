// 감사 로그. 무엇을 언제 어떻게 했는지 전부 남긴다.
// 자율 실행을 사내에 설득할 때 이 파일이 근거가 된다.
import { join } from 'node:path';
import { appendFileSync, mkdirSync, existsSync, readFileSync, chmodSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { 가리기 } from './secrets.js';
import { 첫이름 } from '../tools/label.js';

/*
 * 살림 폴더(.deel · .deel/history)를 만든다. 못 만들면 **사람 말로** 던진다 (6회차 C3).
 *
 * 앞서는 mkdirSync 의 원시 오류가 그대로 올라가, 대화 화면·deel -p·에디터 셋 다
 * 「EEXIST: file already exists, mkdir '…\.deel'」 한 줄만 보였다. 안 죽기는 했지만
 * 무엇이 막혔고 어떻게 하면 되는지가 없었다. 작업 폴더에 같은 이름의 파일이 있거나
 * 읽기 전용 자리면 여기서 막힌다.
 *
 * 던지는 것은 그대로 둔다 — 감사기록·되돌리기 이력 없이 조용히 켜지면 안 된다.
 * 되돌리기 이력(undo.js)도 같은 말을 쓰게 여기서 내준다.
 */
export function 살림폴더만들기(dir, 덧 = {}) {
  try {
    mkdirSync(dir, { recursive: true, ...덧 });
  } catch (err) {
    const 까닭 = {
      EEXIST: '같은 이름의 파일이 있습니다', ENOTDIR: '같은 이름의 파일이 있습니다',
      EACCES: '쓸 권한이 없습니다', EPERM: '쓸 권한이 없습니다', EROFS: '읽기 전용 자리입니다',
    }[err?.code] ?? String(err?.message ?? err);
    const e = new Error(`작업 폴더에 deel 살림 폴더를 만들지 못했습니다 (${dir}) — ${까닭}.`
      + ' 같은 이름의 파일이면 옮기거나 지우고, 쓸 수 없는 폴더면 쓸 수 있는 곳에서 켜세요.');
    e.code = err?.code;
    e.cause = err;
    throw e;
  }
}
import { 환경속열쇠들 } from '../config.js';

/**
 * 감사기록에 넘길 '아는 열쇠' 를 묻는 길. loop.js 가 대화 쪽에서 쓰는 것과 같은 값이다.
 * 값이 아니라 길로 주는 까닭은 Audit 만들기 머리말에 적어 뒀다.
 *
 * ── 왜 `DEEL_API_KEY` 하나가 아닌가 ──────────────────────────────────
 *
 * 여기가 `[conn?.key, process.env.DEEL_API_KEY]` 였다. 그런데 열쇠는 한
 * 이름이 아니다 — `DEEL_KEY_WORK` 처럼 이름을 붙여 여러 개를 둘 수 있고,
 * 그게 이 프로그램이 스스로 권하는 방식이다.
 *
 * 그 열쇠들이 이 목록에 없으면, 모델이 `DEEL_KEY_WORK=… curl …` 같은
 * 명령을 부른 그 줄이 감사기록에 **그대로** 적힌다. 감사기록은 사내에
 * 자율 실행을 설득하려고 남기는 것이라 사람이 읽고 남에게도 보인다.
 * 가려 주는 자리에서 새면 안 가린 것보다 나쁘다 — 가려졌다고 믿기 때문이다.
 *
 * 「무엇이 열쇠인가」 는 config.js 한 곳에서 온다. 대화 쪽(loop.js)과 같은
 * 자를 쓴다 — 두 벌이면 한쪽만 새는 날이 온다.
 */
export const 열쇠묻기 = (conn) => () => [conn?.key, ...환경속열쇠들()].filter(Boolean);

export class Audit {
  /**
   * @param {string} root 작업 폴더
   * @param {object} o
   * @param {string[]|(() => string[])} o.열쇠들 정확히 아는 비밀 (설정에 든 게이트웨이 열쇠).
   *   값이 아니라 **묻는 길**로 받아도 된다 — /model 로 갈아타면 conn 이 통째로
   *   바뀌므로, 만들 때 붙잡아 둔 값은 그 판이 끝나기 전에 옛것이 된다.
   */
  constructor(root, { 열쇠들 = [] } = {}) {
    const dir = join(root, '.deel');
    살림폴더만들기(dir);
    this.file = join(dir, 'audit.jsonl');
    /*
     * 세션 이름은 시각으로 시작하되 그것만으로 끝내지 않는다.
     *
     * 초 단위 시각 하나였더니 같은 초에 띄운 창 두 개(또는 한 판 안의 하위 작업)가
     * 같은 이름을 나눠 가졌다. `deel stats` 는 세션을 이름으로 세고 증거모으기는
     * 이 이름으로 「이번 세션」 을 가르므로, 남의 기록이 내 것으로 섞였다.
     * agent/store.js 의 freeId 처럼 밀리초·프로세스 번호·난수를 덧붙인다.
     */
    const 지금 = new Date();
    this.session = `${지금.toISOString().slice(0, 19).replace(/[:T]/g, '')}`
      + `-${String(지금.getMilliseconds()).padStart(3, '0')}-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
    /** 적으려다 못 적은 건수와 첫 까닭. 0 이 아니면 이 세션의 기록은 불완전하다. */
    this.못쓴수 = 0;
    this.못쓴까닭 = null;
    this.열쇠들 = 열쇠들;
    /** 파일 권한을 건 결과. `{모드}` 면 걸었고, `{못함}` 이면 못 걸었다. */
    this.잠금 = null;
  }

  /*
   * ── 적기 전에 가린다 ────────────────────────────────────────────────
   *
   * 여기 적히는 target 은 Bash 명령줄 그 자체다. 모델은 열쇠를 헤더로
   * (`-H "Authorization: Bearer …"`), 환경변수로(`DEEL_API_KEY=… node x`),
   * 주소 안에 박아서(`https://사람:토큰@github.com/…`) 넘긴다.
   *
   * 도구 **결과**는 loop.js 가 secrets.js 로 가려서 대화에 싣는데, 감사기록은
   * 그 길을 안 지난다. 그래서 대화에서는 지운 값이 디스크에는 평문으로 남았다 —
   * 그것도 `deel audit` 로 사내 심사 자료에 딸려 나가는 파일에.
   *
   * 가리는 것은 자유롭게 적히는 글뿐이다. 도구 이름·성패 같은 정해진 값은
   * 안 건드린다 — 넓게 잡으면 「무엇을 했는지」 가 «가림» 으로 뭉개진다.
   */
  #가린것(값) {
    if (값 == null) return 값;
    const 것들 = typeof this.열쇠들 === 'function' ? this.열쇠들() : this.열쇠들;
    return 가리기(String(값), { 열쇠들: 것들 ?? [] }).글;
  }

  /*
   * 못 적어도 던지지 않는다 — 기록을 남기려다 작업을 죽이면 본말이 뒤집힌다.
   *
   * 다만 **조용히 삼키면 안 된다.** 이 파일의 첫 줄이 파는 문장이
   * 「무엇을 언제 어떻게 했는지 전부 남는다」 이고, /mcp 화면은 대놓고
   * `.deel/audit.jsonl 에 남습니다` 라고 적어 준다. 디스크가 차거나 폴더가
   * 읽기 전용이면 그 두 문장이 거짓이 되는데, 그때도 화면은 아무 말이 없었다.
   * 더 나쁜 건 증거모으기다 — 기록이 안 적히면 「고쳤는데 확인 안 됨」이
   * 아니라 아예 **안 고친 것처럼** 보고서가 짧아진다.
   * 그래서 못 적은 건수를 세어 두고, 보고서와 화면이 그걸 말하게 한다.
   */
  /*
   * ── 반쪽 줄 뒤에 이어 적지 않는다 ─────────────────────────────────────────
   *
   * 적는 도중에 죽으면 마지막 줄이 개행 없이 반만 남는다. 다음 판이 그 뒤에 그대로
   * 이어 적으면 새 기록이 반쪽에 **붙어** 한 줄이 되고, 그 줄은 JSON 이 아니라
   * recent()·deel stats·증거모으기가 통째로 버린다 — 다음 판이 한 첫 일이, 그것도
   * 막힌 명령이나 되돌리기 같은 것이 기록에서 사라진다.
   * agent/store.js 와 같은 방법이다. 이 기록으로 처음 적을 때 한 번만 파일 끝을 보고,
   * 개행이 아니면 개행부터 붙인다. 줄마다 재지 않는다 — 그 뒤로는 우리가 적은 줄이다.
   */
  #줄끝봤나 = false;
  #줄로끝나나() {
    let fd = null;
    try {
      const 크기 = statSync(this.file).size;
      if (!크기) return true;
      fd = openSync(this.file, 'r');
      const 한바이트 = Buffer.alloc(1);
      readSync(fd, 한바이트, 0, 1, 크기 - 1);
      return 한바이트[0] === 0x0a;
    } catch { return true; }         // 없거나 못 읽으면 붙일 반쪽도 없다
    finally { if (fd != null) { try { closeSync(fd); } catch { /* 닫다 터져도 적기는 한다 */ } } }
  }

  write(kind, data) {
    const rec = { at: new Date().toISOString(), session: this.session, kind, ...data };
    try {
      let 줄 = JSON.stringify(rec) + '\n';
      if (!this.#줄끝봤나) {
        if (!this.#줄로끝나나()) 줄 = '\n' + 줄;
        this.#줄끝봤나 = true;
      }
      appendFileSync(this.file, 줄, 'utf8');
      this.#잠그기();
    } catch (err) {
      /*
       * 막혔으면 끝을 다시 보게 되돌린다 (2.0.0 6회차 · Gemini 감사6aa C2 — agent/store.js 저장6w X1 과
       * 같은 까닭). 본 표시를 적기 전에 세워서, 첫 적기가 막히면 다음 기록이 반쪽 줄 뒤에 붙었다 —
       * 못쓴수 에는 막힌 한 건만 오르고, 붙은 기록은 적었다고 친 채 deel audit · 증거모으기에서 사라진다.
       */
      this.#줄끝봤나 = false;   // 막혔으니 다음 적기에서 끝을 다시 본다
      this.못쓴수 += 1;
      if (!this.못쓴까닭) this.못쓴까닭 = err?.message ?? String(err);
    }
    return rec;
  }

  /*
   * 만들자마자 본인만 읽게 잠근다 (config.js 가 설정 파일에 하는 것과 같다).
   *
   * 가리기를 지나도 여기에는 무엇을 언제 어디서 했는지가 남는다 — 파일 경로,
   * 돌린 명령, 사람이 친 말. 같은 PC 를 여럿이 쓰거나 홈이 공유 폴더에 있으면
   * 그게 그대로 남에게 읽힌다. 한 번만 건다 — 줄마다 걸 일이 아니다.
   * 윈도우(NTFS)에서는 chmod 가 아무 일도 안 한다. 거기서는 못 잠근 것이지
   * 잠근 척하지 않는다 — 보관방식 화면이 그 사실을 따로 말한다.
   *
   * 건 결과를 `잠금` 에 남긴다. "본인만 읽게 잠근다" 는 말은 지켜지는지
   * **밖에서 볼 수 있어야** 뜻이 있다 (keystore.js 의 마지막명령줄 과 같은
   * 까닭). 윈도우에서 값이 남는다고 실제로 잠겼다는 뜻은 아니다 —
   * 우리가 걸어는 봤다는 뜻이다.
   */
  #잠갔나 = false;
  #잠그기() {
    if (this.#잠갔나) return;
    this.#잠갔나 = true;
    // 윈도우에서 chmod 는 아무 일도 안 하고 **성공한다.** 그 성공을 적으면 위 머리말이 금지한
    // 「잠근 척」 이다 — agent/store.js 와 같이 안 걸었다고 적는다.
    if (process.platform === 'win32') { this.잠금 = { 못함: 'windows' }; return; }
    try { chmodSync(this.file, 0o600); this.잠금 = { 모드: 0o600 }; }
    catch (err) { this.잠금 = { 못함: err?.code ?? String(err) }; }
  }

  /** 기록이 새고 있나. 새고 있으면 `{수, 까닭}`, 멀쩡하면 null. */
  못쓴것() {
    return this.못쓴수 ? { 수: this.못쓴수, 까닭: this.못쓴까닭 } : null;
  }

  tool(name, args, result) {
    return this.write('tool', {
      tool: name,
      // purpose 는 하위 작업(Task)이 쓰는 이름이다. 이게 없으면 감사기록에
      // '하위 작업을 돌렸다' 만 남고 **무엇을** 돌렸는지가 안 남는다.
      // 옛 이름(목적)도 같이 본다 — 이름을 바꾼 판 이전의 기록이 남아 있고,
      // 옛 이름으로 부르는 모델도 있다.
      //
      // 이름 차례는 tools/label.js 한 곳에서 온다. 여기 목록에는 url 과 name
      // 이 빠져 있어서, 웹을 읽은 줄과 스킬을 부른 줄이 감사기록에서만
      // 무엇을 향한 것인지 없이 남았다.
      target: this.#가린것(첫이름(args) ?? args?.command ?? null),
      // 실패는 error 로만 오지 않는다. Bash 는 종료 코드가 0 이 아니면 `failed: true`(tools/index.js),
      // Verify 는 탈이 나면 `failed: true` 를 싣고 error 는 비운다. error 만 보면 빨간 검사가
      // ok 로 남고, 증거(agent/evidence.js)가 그걸 「확인한 것」 으로 내민다 (6회차 근거6at EV4).
      ok: !result?.error && result?.failed !== true,
      note: this.#가린것(result?.error ?? result?.summary ?? null),
    });
  }

  /*
   * ── 가린 뒤에 자른다 ────────────────────────────────────────────────
   *
   * 자르기가 먼저였다. 열쇠가 500자(300자) 선에 걸치면 앞 조각만 남는데, 조각은
   * 정확히 아는 열쇠라도 **통째가 아니라서** 못 알아본다 — 게이트웨이 열쇠 앞
   * 스무 글자가 그대로 적혔다. 가리기가 글을 짧게 만들 뿐 길게 만들지는 않으니
   * 자르는 선은 그대로 지켜진다.
   *
   * 막힌 까닭(why)도 가린다. guard.js 가 던지는 말은 막은 명령 앞 120자를 그대로
   * 담아서, what 은 가렸는데 why 칸에 `Authorization: Bearer …` 가 평문으로 남았다.
   */
  turn(text) { return this.write('turn', { text: this.#가린것(String(text)).slice(0, 500) }); }
  blocked(why, what) {
    return this.write('blocked', { why: this.#가린것(why), what: this.#가린것(String(what)).slice(0, 300) });
  }
  undo(info) { return this.write('undo', info); }

  /*
   * 최근 n 줄. 0 이하는 「내줄 줄이 없다」 는 말이다.
   *
   * `slice(-0)` 은 `slice(0)` 이라 **전부** 나왔다. 0 을 넘기는 호출부는 지금 없지만,
   * 여기서 나온 줄은 `deel audit` 화면·증거모으기·`deel stats` 로 곧장 간다 —
   * 「최근 0줄만」 이 기록 전체를 읽어 오는 것은 부르는 쪽이 못 알아챈다.
   */
  recent(n = 20) {
    const 몇 = Math.floor(Number(n));
    if (!Number.isFinite(몇) || 몇 <= 0) return [];
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8')
      .split('\n').filter(Boolean).slice(-몇)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  }
}
