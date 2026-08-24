// 되돌리기. 승인 프롬프트를 안 쓰는 대신 이게 안전망이다.
// 파일을 고치기 전에 항상 이전 내용을 떠 놓고, /undo 로 턴 단위로 되돌린다.
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, appendFileSync, readdirSync, statSync } from 'node:fs';

// 되돌리기 이력은 파일 내용을 통째로 담는다. 이만큼 커지면 오래된 턴을 버린다.
const MAX_BYTES = 32 * 1024 * 1024;
const KEEP_TURNS = 50;

export class History {
  constructor(root) {
    this.dir = join(root, '.deel', 'history');
    mkdirSync(this.dir, { recursive: true });
    this.file = join(this.dir, 'edits.jsonl');
    this.turn = 0;
  }

  /**
   * 새 턴 시작 — /undo 는 턴 하나를 통째로 되돌린다.
   *
   * 번호는 시각으로 짓되 **반드시 늘어나게** 한다.
   *
   * 예전에는 그냥 Date.now() 였다. 그러면 같은 밀리초에 두 턴이 시작될 때
   * 번호가 똑같아지고, 두 턴이 하나로 뭉친다. 그 상태에서 /undo 를 한 번 하면
   * 두 턴 어치가 한꺼번에 되돌아간다 — 사용자가 시키지 않은 것까지 되돌린다.
   * 되돌리기는 이 프로그램의 안전망이라, 여기서 조용히 틀리는 것이 가장 나쁘다.
   *
   * 리눅스 CI 에서 실제로 잡혔다. 윈도우는 Date.now() 눈금이 굵어(약 15ms)
   * 우연히 안 겹쳤고, 리눅스에서는 다섯 턴이 같은 밀리초에 들어갔다.
   * '내 기계에서는 되는데' 가 이렇게 생긴다.
   */
  nextTurn() {
    const 지금 = Date.now();
    this.turn = 지금 > this.turn ? 지금 : this.turn + 1;
    return this.turn;
  }

  // 파일을 고치기 직전에 부른다. 없던 파일이면 before 는 null.
  snapshot(absPath, label) {
    const before = existsSync(absPath) ? safeRead(absPath) : null;
    const rec = { turn: this.turn, at: new Date().toISOString(), path: absPath, before, label };
    appendFileSync(this.file, JSON.stringify(rec) + '\n', 'utf8');
    this.#maybePrune();
    return rec;
  }

  /**
   * 이력이 끝없이 자라는 것을 막는다.
   *
   * 스냅샷은 파일 내용을 통째로 담는다. 큰 파일을 여러 번 고치면 금방 수십 MB 가 된다.
   * 그런데 아무 때나 자르면 안 된다 — 방금 한 일을 못 되돌리게 되면 안전망이 아니다.
   * 그래서 최근 KEEP_TURNS 개 턴은 무조건 남기고, 그보다 오래된 것만 버린다.
   *
   * 매번 확인하면 파일을 계속 다시 읽게 되므로, 커졌을 때만 본다.
   */
  #maybePrune() {
    this.#writes = (this.#writes ?? 0) + 1;
    if (this.#writes % 20 !== 0) return;
    try {
      if (statSync(this.file).size < MAX_BYTES) return;
    } catch { return; }
    this.prune();
  }

  #writes = 0;

  /** 최근 keep 개 턴만 남기고 자른다. 버린 줄 수를 돌려준다. */
  prune({ keep = KEEP_TURNS } = {}) {
    const recs = this.all();
    const turns = this.turns();
    if (turns.length <= keep) return 0;
    const 남길턴 = new Set(turns.slice(-keep));
    const 남길것 = recs.filter((r) => 남길턴.has(r.turn));
    const 버린수 = recs.length - 남길것.length;
    if (!버린수) return 0;
    try {
      writeFileSync(this.file, 남길것.map((r) => JSON.stringify(r)).join('\n') + (남길것.length ? '\n' : ''), 'utf8');
    } catch { return 0; }
    return 버린수;
  }

  /** 지금 이력이 얼마나 되나. /status 에서 보여 준다. */
  size() {
    try { return statSync(this.file).size; } catch { return 0; }
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
