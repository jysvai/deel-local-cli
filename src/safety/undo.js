// 되돌리기. 승인 프롬프트를 안 쓰는 대신 이게 안전망이다.
// 파일을 고치기 전에 항상 이전 내용을 떠 놓고, /undo 로 턴 단위로 되돌린다.
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, appendFileSync, readdirSync } from 'node:fs';

export class History {
  constructor(root) {
    this.dir = join(root, '.deel', 'history');
    mkdirSync(this.dir, { recursive: true });
    this.file = join(this.dir, 'edits.jsonl');
    this.turn = 0;
  }

  // 새 턴 시작 — /undo 는 턴 하나를 통째로 되돌린다.
  nextTurn() {
    this.turn = Date.now();
    return this.turn;
  }

  // 파일을 고치기 직전에 부른다. 없던 파일이면 before 는 null.
  snapshot(absPath, label) {
    const before = existsSync(absPath) ? safeRead(absPath) : null;
    const rec = { turn: this.turn, at: new Date().toISOString(), path: absPath, before, label };
    appendFileSync(this.file, JSON.stringify(rec) + '\n', 'utf8');
    return rec;
  }

  all() {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8')
      .split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  }

  turns() {
    const seen = [];
    for (const r of this.all()) if (!seen.includes(r.turn)) seen.push(r.turn);
    return seen;
  }

  // 최근 n 개 턴을 되돌린다. 되돌린 파일 목록을 반환.
  undo(n = 1) {
    const recs = this.all();
    const turns = this.turns().slice(-n);
    if (!turns.length) return { restored: [], turns: 0 };

    const target = recs.filter((r) => turns.includes(r.turn));
    // 같은 파일이 여러 번 바뀌었으면 가장 이른 상태로 되돌려야 한다.
    const first = new Map();
    for (const r of target) if (!first.has(r.path)) first.set(r.path, r);

    const restored = [];
    for (const [path, rec] of first) {
      try {
        if (rec.before === null) {
          if (existsSync(path)) { rmSync(path, { force: true }); restored.push({ path, how: '삭제됨(원래 없던 파일)' }); }
        } else {
          writeFileSync(path, rec.before, 'utf8');
          restored.push({ path, how: '되돌림' });
        }
      } catch (err) {
        restored.push({ path, how: `실패: ${err.message}` });
      }
    }
    // 되돌린 기록은 잘라낸다.
    const keep = recs.filter((r) => !turns.includes(r.turn));
    writeFileSync(this.file, keep.map((r) => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : ''), 'utf8');
    return { restored, turns: turns.length };
  }
}

function safeRead(p) {
  const buf = readFileSync(p);
  // 바이너리는 되돌리기 대상에서 뺀다 — 텍스트만 다룬다.
  if (buf.includes(0)) return null;
  return buf.toString('utf8');
}
