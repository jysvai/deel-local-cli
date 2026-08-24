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
  }

  write(kind, data) {
    const rec = { at: new Date().toISOString(), session: this.session, kind, ...data };
    try { appendFileSync(this.file, JSON.stringify(rec) + '\n', 'utf8'); } catch {}
    return rec;
  }

  tool(name, args, result) {
    return this.write('tool', {
      tool: name,
      target: args?.file_path ?? args?.path ?? args?.pattern ?? args?.command ?? null,
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
