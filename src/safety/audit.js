// 감사 로그. 무엇을 언제 어떻게 했는지 전부 남긴다.
// 자율 실행을 사내에 설득할 때 이 파일이 근거가 된다.
import { join } from 'node:path';
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { 가리기 } from './secrets.js';

/**
 * 감사기록에 넘길 '아는 열쇠' 를 묻는 길. loop.js 가 대화 쪽에서 쓰는 것과 같은 값이다.
 * 값이 아니라 길로 주는 까닭은 Audit 만들기 머리말에 적어 뒀다.
 */
export const 열쇠묻기 = (conn) => () => [conn?.key, process.env.DEEL_API_KEY].filter(Boolean);

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
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'audit.jsonl');
    this.session = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;
    /** 적으려다 못 적은 건수와 첫 까닭. 0 이 아니면 이 세션의 기록은 불완전하다. */
    this.못쓴수 = 0;
    this.못쓴까닭 = null;
    this.열쇠들 = 열쇠들;
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
  write(kind, data) {
    const rec = { at: new Date().toISOString(), session: this.session, kind, ...data };
    try {
      appendFileSync(this.file, JSON.stringify(rec) + '\n', 'utf8');
    } catch (err) {
      this.못쓴수 += 1;
      if (!this.못쓴까닭) this.못쓴까닭 = err?.message ?? String(err);
    }
    return rec;
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
      target: this.#가린것(args?.file_path ?? args?.path ?? args?.pattern ?? args?.command
        ?? args?.purpose ?? args?.목적 ?? null),
      ok: !result?.error,
      note: this.#가린것(result?.error ?? result?.summary ?? null),
    });
  }

  turn(text) { return this.write('turn', { text: this.#가린것(String(text).slice(0, 500)) }); }
  blocked(why, what) { return this.write('blocked', { why, what: this.#가린것(String(what).slice(0, 300)) }); }
  undo(info) { return this.write('undo', info); }

  recent(n = 20) {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8')
      .split('\n').filter(Boolean).slice(-n)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  }
}
