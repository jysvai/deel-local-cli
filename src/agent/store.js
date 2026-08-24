// 대화를 파일에 남겨 두고, 껐다 켜도 이어서 하게 한다.
//
// 왜 필요한가:
//   터미널을 실수로 닫거나, 컴퓨터가 재부팅되거나, 긴 작업 중 자리를 뜨는 일은 늘 있다.
//   그때 대화가 통째로 날아가면 모델이 알아낸 것·정한 것이 전부 사라진다.
//   다시 설명하는 비용이 실제 작업보다 큰 경우도 많다.
//
// 어디에 두나:
//   작업 폴더의 .deel/sessions/<id>.jsonl — 그 폴더의 일은 그 폴더에 남긴다.
//   .gitignore 에 .deel/ 이 들어 있어 깃에 올라가지 않는다.
//
// 왜 jsonl 인가:
//   한 줄에 한 메시지씩 이어 붙이기만 하면 된다. 도중에 프로그램이 죽어도
//   마지막 줄까지는 성하다. 통째로 다시 쓰는 방식이면 그 순간 파일이 깨진다.
import {
  existsSync, mkdirSync, readdirSync, readFileSync,
  appendFileSync, writeFileSync, statSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';

export const sessionsDir = (root) => join(root, '.deel', 'sessions');

// 사람이 읽을 수 있고 정렬하면 시간순인 id.
export function newId(at = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}`
    + `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
}

/**
 * 아직 안 쓰인 id 를 고른다.
 *
 * id 가 초 단위라서, 창을 두 개 거의 동시에 열면 같은 id 가 나온다.
 * 그러면 서로 다른 두 대화가 한 파일에 섞여 들어가고 되살릴 때 뒤엉킨다.
 * 이미 있는 이름이면 뒤에 번호를 붙여 피한다.
 */
export function freeId(dir, at = new Date()) {
  const base = newId(at);
  if (!existsSync(join(dir, `${base}.jsonl`))) return base;
  for (let n = 2; n < 1000; n++) {
    const id = `${base}-${n}`;
    if (!existsSync(join(dir, `${id}.jsonl`))) return id;
  }
  return `${base}-${process.pid}`;
}

export class Store {
  constructor(root, id = null) {
    this.root = root;
    this.dir = sessionsDir(root);
    this.auto = id == null;      // 우리가 지은 이름인가 (그러면 겹칠 때 바꿔도 된다)
    this.#use(id ?? freeId(this.dir));
    this.opened = false;
  }

  #use(id) {
    this.id = id;
    this.file = join(this.dir, `${id}.jsonl`);
  }

  #open() {
    if (this.opened) return;
    mkdirSync(this.dir, { recursive: true });
    this.opened = true;
  }

  /**
   * 첫 줄은 머리글 — 어떤 모델·어떤 폴더에서 한 대화인지.
   *
   * 'wx' 로 만든다: 이미 있으면 실패한다. 이름을 확인하고 만드는 사이에
   * 다른 창이 같은 이름을 채 갔을 수 있어서, 그때는 다른 이름으로 옮겨 간다.
   * 사용자가 --resume 으로 이름을 준 경우에는 옮기지 않고 그 파일에 이어 쓴다.
   */
  begin(meta) {
    this.#open();
    const head = JSON.stringify({ t: 'meta', at: new Date().toISOString(), ...meta }) + '\n';
    for (let tries = 0; tries < 50; tries++) {
      try {
        writeFileSync(this.file, head, { encoding: 'utf8', flag: 'wx' });
        return this;
      } catch (err) {
        if (err?.code !== 'EEXIST') return this;   // 못 적어도 대화는 계속돼야 한다
        if (!this.auto) return this;               // 이어쓰기 — 이미 있는 게 맞다
        this.#use(freeId(this.dir));               // 누가 채 갔다. 옆자리로.
      }
    }
    return this;
  }

  #write(obj) {
    try { appendFileSync(this.file, JSON.stringify(obj) + '\n', 'utf8'); }
    catch { /* 기록에 실패해도 대화는 계속돼야 한다 */ }
  }

  // 메시지 하나를 덧붙인다. 대화가 진행되는 대로 즉시 남긴다.
  append(msg) {
    this.#open();
    this.#write({ t: 'msg', m: msg });
  }

  // 압축이 일어나면 이력이 통째로 바뀐다. 그때는 새로 적는다.
  replace(messages, note = '압축') {
    this.#open();
    const meta = this.readMeta() ?? {};
    const lines = [JSON.stringify({ t: 'meta', at: new Date().toISOString(), ...meta })];
    lines.push(JSON.stringify({ t: 'note', at: new Date().toISOString(), note }));
    for (const m of messages) lines.push(JSON.stringify({ t: 'msg', m }));
    try { writeFileSync(this.file, lines.join('\n') + '\n', 'utf8'); } catch {}
  }

  readMeta() {
    if (!existsSync(this.file)) return null;
    try {
      const first = readFileSync(this.file, 'utf8').split('\n', 1)[0];
      const j = JSON.parse(first);
      return j.t === 'meta' ? j : null;
    } catch { return null; }
  }

  // 저장된 대화를 읽어 온다. 깨진 줄은 건너뛴다 — 도중에 죽었을 수 있다.
  load() {
    if (!existsSync(this.file)) return { meta: null, messages: [] };
    let meta = null;
    const messages = [];
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.t === 'meta') meta = j;
      else if (j.t === 'msg' && j.m) messages.push(j.m);
    }
    return { meta, messages };
  }
}

// 사람에게 보여줄 첫 마디. 이게 목록에서 대화를 알아보는 유일한 단서다.
function firstAsk(messages) {
  const m = messages.find((x) => x.role === 'user' && typeof x.content === 'string'
    && x.content.trim() && !x.content.startsWith('['));
  return m ? m.content.replace(/\s+/g, ' ').trim() : '(빈 대화)';
}

/**
 * 이 폴더에 남아 있는 대화 목록. 최근 것이 위로.
 */
export function list(root, { limit = 20 } = {}) {
  const dir = sessionsDir(root);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const id = name.slice(0, -6);
    const file = join(dir, name);
    let st;
    try { st = statSync(file); } catch { continue; }
    const { meta, messages } = new Store(root, id).load();
    if (!messages.length) continue;
    out.push({
      id,
      file,
      at: st.mtime,
      bytes: st.size,
      model: meta?.model ?? '?',
      turns: messages.filter((m) => m.role === 'user').length,
      messages: messages.length,
      first: firstAsk(messages),
    });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

export function remove(root, id) {
  const f = join(sessionsDir(root), `${id}.jsonl`);
  if (!existsSync(f)) return { error: `그런 대화가 없습니다: ${id}` };
  rmSync(f, { force: true });
  return { removed: id };
}

/** 가장 최근 대화. --continue 가 집어 오는 것. */
export function latest(root) {
  return list(root, { limit: 1 })[0] ?? null;
}

/**
 * 오래된 것은 정리한다. 안 그러면 폴더가 끝없이 자란다.
 * 최근 keep 개는 무조건 남기고, 그보다 오래되고 days 를 넘긴 것만 지운다.
 */
export function prune(root, { keep = 30, days = 30 } = {}) {
  const all = list(root, { limit: 1000 });
  const 자를것 = all.slice(keep).filter((s) => (Date.now() - s.at.getTime()) > days * 86400000);
  for (const s of 자를것) { try { rmSync(s.file, { force: true }); } catch {} }
  return 자를것.length;
}
