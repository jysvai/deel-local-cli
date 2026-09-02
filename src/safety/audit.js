// 감사 로그. 무엇을 언제 어떻게 했는지 전부 남긴다.
// 자율 실행을 사내에 설득할 때 이 파일이 근거가 된다.
import { join } from 'node:path';
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

export class Audit {
  constructor(root) {
    const dir = join(root, '.deel');
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'audit.jsonl');
    this.session = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;
    /** 적으려다 못 적은 건수와 첫 까닭. 0 이 아니면 이 세션의 기록은 불완전하다. */
    this.못쓴수 = 0;
    this.못쓴까닭 = null;
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
      target: args?.file_path ?? args?.path ?? args?.pattern ?? args?.command
        ?? args?.purpose ?? args?.목적 ?? null,
      ok: !result?.error,
      note: result?.error ?? result?.summary ?? null,
    });
  }

  turn(text) { return this.write('turn', { text: String(text).slice(0, 500) }); }
  blocked(why, what) { return this.write('blocked', { why, what: String(what).slice(0, 300) }); }
  undo(info) { return this.write('undo', info); }

  recent(n = 20) {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8')
      .split('\n').filter(Boolean).slice(-n)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  }
}
