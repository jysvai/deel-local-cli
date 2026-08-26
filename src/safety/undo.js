// 되돌리기. 승인 프롬프트를 안 쓰는 대신 이게 안전망이다.
// 파일을 고치기 전에 항상 이전 내용을 떠 놓고, /undo 로 턴 단위로 되돌린다.
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, appendFileSync, statSync } from 'node:fs';
import { looksBinary } from '../tools/encoding.js';

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
    this.#이번턴 = new Map();
    return this.turn;
  }

  // 이번 턴에 이미 떠 놓은 파일들. 같은 파일을 또 뜰 이유가 없다 — 아래 참고.
  #이번턴 = new Map();

  /**
   * 파일을 고치기 직전에 부른다.
   *
   * 세 가지 결과가 있고, **셋을 절대 섞으면 안 된다.**
   *   before: '…'         내용을 떴다        → 되돌리면 이 내용으로 되돌아간다
   *   before: null        원래 없던 파일이다  → 되돌리면 지운다
   *   skipped: '…'        못 떴다             → 되돌릴 때 **건드리지 않는다**
   *
   * 셋째가 없어서 사고가 났었다. 못 뜬 파일도 before 가 null 이었고, 되돌리기는
   * 그걸 '원래 없던 파일' 로 읽어 rmSync 했다. 그림·hwp 를 덮어쓴 뒤 /undo 를
   * 누르면 남아 있던 잔해까지 사라졌다 — 안전망이 파일을 지우는 것이다.
   */
  snapshot(absPath, label) {
    /*
     * 한 턴에 같은 파일은 한 번만 뜬다.
     *
     * 되돌리기는 턴 하나를 통째로 되돌린다 — 그 턴에 손대기 **전** 상태로.
     * 그러니 필요한 것은 그 턴의 첫 스냅샷 하나뿐이고, undo() 도 실제로 첫
     * 기록만 본다. 두 번째부터는 쓰이지 않는 파일 사본이 디스크에 쌓일 뿐이다.
     *
     * 그냥 낭비로 끝나지 않는다. 큰 파일을 Append 로 여덟 번 이어 붙이면 그
     * 파일이 여덟 벌 쌓이고, 이력이 32MB 를 넘으면 오래된 턴부터 버려진다 —
     * 즉 **정말 되돌려야 할 옛 기록이 밀려난다.** 안전망이 제 무게로 무너진다.
     */
    const 이미 = this.#이번턴.get(absPath);
    if (이미) return 이미;

    const 뜬것 = existsSync(absPath) ? safeRead(absPath) : { before: null };
    const rec = { turn: this.turn, at: new Date().toISOString(), path: absPath, before: 뜬것.before, label };
    if (뜬것.enc) rec.enc = 뜬것.enc;
    if (뜬것.skipped) rec.skipped = 뜬것.skipped;
    appendFileSync(this.file, JSON.stringify(rec) + '\n', 'utf8');
    this.#이번턴.set(absPath, rec);
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

  /**
   * 최근 n 개 턴을 되돌린다. 되돌린 파일 목록을 반환.
   *
   * turnIds 를 같이 준다 — **어느** 턴을 되돌렸는지 부르는 쪽이 알아야 한다.
   * 파일만 되돌리고 대화는 그대로 두면, 모델은 지워진 코드가 아직 있는 줄 알고
   * 그 위에 이어서 일한다. 그 거짓말을 걷어내려면 개수가 아니라 번호가 필요하다.
   * (session.되감기 를 볼 것.)
   */
  undo(n = 1) {
    const recs = this.all();
    const turns = this.turns().slice(-n);
    if (!turns.length) return { restored: [], turns: 0, turnIds: [] };

    const target = recs.filter((r) => turns.includes(r.turn));
    // 같은 파일이 여러 번 바뀌었으면 가장 이른 상태로 되돌려야 한다.
    const first = new Map();
    for (const r of target) if (!first.has(r.path)) first.set(r.path, r);

    const restored = [];
    for (const [path, rec] of first) {
      try {
        if (rec.skipped) {
          // 내용을 못 떠 놓은 파일이다. 되돌릴 것이 없으니 손대지 않는다.
          // 조용히 넘기지는 않는다 — 되돌아간 줄 알면 사용자가 그 위에 계속 일한다.
          restored.push({ path, how: `그대로 둠 (${rec.skipped} — 내용을 떠 두지 못했습니다)`, skipped: true });
        } else if (rec.before === null) {
          // 옛 이력에는 skipped 표시가 없다. 그때 못 뜬 파일도 여기로 온다.
          // 지금 디스크에 있는 것이 바이너리면 우리가 만든 파일일 리 없으니 안 지운다.
          if (!existsSync(path)) continue;
          let 바이너리 = false;
          try { 바이너리 = looksBinary(readFileSync(path)); } catch { 바이너리 = true; }
          if (바이너리) {
            restored.push({ path, how: '그대로 둠 (바이너리 — 내용을 떠 두지 못했습니다)', skipped: true });
            continue;
          }
          rmSync(path, { force: true });
          restored.push({ path, how: '삭제됨(원래 없던 파일)' });
        } else {
          // enc 가 붙어 있으면 UTF-8 로 담을 수 없던 파일이다 — 바이트를 그대로 되돌린다.
          writeFileSync(path, rec.enc === 'b64' ? Buffer.from(rec.before, 'base64') : Buffer.from(rec.before, 'utf8'));
          restored.push({ path, how: '되돌림' });
        }
      } catch (err) {
        restored.push({ path, how: `실패: ${err.message}` });
      }
    }
    // 되돌린 기록은 잘라낸다.
    const keep = recs.filter((r) => !turns.includes(r.turn));
    writeFileSync(this.file, keep.map((r) => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : ''), 'utf8');
    return { restored, turns: turns.length, turnIds: turns.slice() };
  }
}

/**
 * 되돌릴 내용을 뜬다.
 *
 * UTF-8 로 오갈 수 있는 파일이면 글자 그대로 담는다 — 이력 파일이 사람 눈에도
 * 보이고, 자리도 덜 먹는다.
 *
 * 그럴 수 없는 파일이면 바이트를 base64 로 담는다. 사내 파일은 CP949 가 흔한데,
 * 그걸 UTF-8 로 읽으면 못 옮기는 바이트가 전부 U+FFFD 한 글자로 뭉개진다.
 * 되돌아가는 것은 그 뭉개진 글자다 — 원래 바이트는 그 순간 없어진다.
 * '가나다'(b0a1 b3aa b4d9) 를 되돌리면 efbfbd 가 여섯 번 찍힌다.
 *
 * 되돌리기는 이 프로그램의 안전망이다. 안전망이 파일을 망가뜨리면
 * 아예 없느니만 못하다. 그래서 오갈 수 있는지를 실제로 해 보고 정한다.
 *
 * 바이너리 판정은 **읽기 도구와 똑같은 잣대**를 쓴다(looksBinary — 앞 8,000바이트).
 * 전에는 여기서만 파일 전체를 봤다. 그래서 8,000바이트 뒤에 NUL 이 하나 들어 있는
 * 평범한 소스 파일이 Read·Edit 은 되는데 스냅샷만 비는 상태가 됐다. 그러고 /undo 를
 * 누르면 멀쩡한 파일이 지워졌다. 두 곳의 잣대가 다르면 반드시 이런 틈이 생긴다.
 */
function safeRead(p) {
  const buf = readFileSync(p);
  // 바이너리는 내용을 담지 않는다. '없던 파일' 과는 다른 값으로 알린다 —
  // 이 둘을 같은 null 로 뭉쳐 놨던 것이 /undo 가 파일을 지우던 원인이다.
  if (looksBinary(buf)) return { before: null, skipped: '바이너리' };
  const text = buf.toString('utf8');
  // 되짚어 봐서 바이트가 그대로면 UTF-8 이 맞다.
  if (Buffer.from(text, 'utf8').equals(buf)) return { before: text };
  return { before: buf.toString('base64'), enc: 'b64' };
}
