// 되돌리기. 승인 프롬프트를 안 쓰는 대신 이게 안전망이다.
// 파일을 고치기 전에 항상 이전 내용을 떠 놓고, /undo 로 턴 단위로 되돌린다.
import { join, dirname, basename, resolve, relative, isAbsolute, sep } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, rmdirSync, appendFileSync, statSync, chmodSync, renameSync, realpathSync, openSync, readSync, closeSync } from 'node:fs';
import { looksBinary } from '../tools/encoding.js';
import { 살림폴더만들기 } from './audit.js';
import { 말 } from '../i18n/index.js';

// 되돌리기 이력은 파일 내용을 통째로 담는다. 이만큼 커지면 오래된 턴을 버린다.
const MAX_BYTES = 32 * 1024 * 1024;
const KEEP_TURNS = 50;

/*
 * ── 이력이 가리키는 곳을 그대로 믿지 않는다 ─────────────────────────────
 *
 * edits.jsonl 의 한 줄은 「이 경로의 원래 내용」 이고, /undo 는 그 경로에 쓰고 지운다.
 * 그런데 그 파일은 `.deel/history` 에 있다 — 저장소에 딸려 올 수 있고(누가 올렸든
 * 일부러 넣었든), 폴더째 복사될 수도 있다. 여태 적힌 절대 경로를 그대로 써서:
 *
 *   · 받은 저장소의 이력 한 줄로 **작업 폴더 밖** 파일을 덮고, 지우고, 폴더를 만들었다
 *   · 복사한 폴더에서 /undo 하면 **원본 폴더**를 되돌렸다 (복사본은 그대로)
 *
 * 둘 다 「되돌렸습니다」 가 찍혔다. 안전망이 울타리 밖으로 손을 뻗는 꼴이다.
 *
 * 그래서 새 기록에는 작업 폴더 기준 **상대 경로(rel)** 를 같이 적고, 읽을 때는 그것을
 * 지금 폴더에 붙여 쓴다. 옛 기록(rel 없음)의 절대 경로는 지금 폴더 **안**일 때만 받는다.
 * 어느 쪽이든 밖으로 나가면 건드리지 않고 그렇다고 적는다. 글자로는 안인데 고리
 * (정션·심볼릭 링크)를 따라가면 밖인 자리도 건드리기 직전에 따로 본다 — 저장소는
 * 링크를 실어 나를 수 있다.
 *
 * `path`(절대 경로)는 계속 적는다. 이 칸만 읽는 옛 deel 이 같은 폴더에서 이력을 열어도
 * 여태처럼 되돌리게 하려는 것이다. 이 판은 rel 이 있으면 rel 만 믿는다.
 *
 * 믿는 폴더에서만 이력을 읽게 막는 길은 안 골랐다. 폴더는 기본이 「안 믿음」 이라 그러면
 * 거의 모든 폴더에서 /undo 가 꺼진다 — 안전망을 끄는 것으로 안전망을 지키는 셈이다.
 * 밖으로 못 나가게 막으면, 딸려 온 이력이 할 수 있는 일은 저장소가 제 파일을 제 내용으로
 * 되돌리는 것뿐이고 그건 저장소가 이미 할 수 있는 일이다.
 */

/** abs 가 뿌리 안(뿌리 자신은 빼고)인가. 글자로만 본다. */
function 안인가(뿌리, abs) {
  const rel = relative(뿌리, abs);
  return !!rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

/*
 * 링크를 따라간 진짜 자리. 아직 없는 파일은 있는 자리까지 올라가서 푼다.
 * safety/guard.js 의 진짜자리와 같은 방법이다(8.3 단축명 때문에 native 를 먼저 부른다).
 * 그쪽을 불러오지 않는 까닭은 guard.js 가 설정까지 끌고 오기 때문이다 — 되돌리기는
 * 설정이 깨져도 돌아야 하는 자리다.
 */
function 진짜자리(p) {
  const 남은 = [];
  let cur = p;
  for (let i = 0; i < 64; i++) {
    try {
      let r;
      try { r = realpathSync.native(cur); } catch { r = realpathSync(cur); }
      return 남은.length ? resolve(r, ...남은) : r;
    } catch { /* 아직 없는 자리 — 한 칸 위로 */ }
    const 위 = dirname(cur);
    if (위 === cur) return p;
    남은.unshift(basename(cur));
    cur = 위;
  }
  return p;
}

/** 파일에 적는 모양. 읽을 때 붙인 표(바깥)는 안 적는다 — 적힌 원래 줄을 그대로 둔다. */
function 적을줄(r) {
  const { 바깥: _바깥, ...나머지 } = r;
  return JSON.stringify(나머지);
}

export class History {
  constructor(root) {
    /** 이 이력이 되돌려도 되는 울타리. 이 밖은 적혀 있어도 안 건드린다. */
    this.root = resolve(String(root));
    this.dir = join(this.root, '.deel', 'history');
    // 폴더부터 본인 것으로. 파일만 잠그고 폴더가 0755 면 이름은 다 보인다.
    // 못 만들면 까닭과 길을 사람 말로 던진다 (audit.js 의 살림폴더만들기 · 6회차 C3).
    살림폴더만들기(this.dir, { mode: 0o700 });
    this.file = join(this.dir, 'edits.jsonl');
    this.turn = 0;
    /** 잠근 결과. 밖에서 볼 수 있어야 「잠갔다」 는 말이 뜻을 갖는다. */
    this.잠금 = null;
  }

  /** 이 경로의 조상 가운데 **아직 없는** 폴더들(뿌리 기준 상대 경로, 깊은 것부터). 뿌리 밖으로는 안 올라간다. */
  #없는폴더들(abs) {
    const 들 = [];
    let d = dirname(resolve(String(abs)));
    for (let i = 0; i < 64 && !existsSync(d); i++) {
      const 상대 = this.#상대(d);
      if (상대 === null) break;
      들.push(상대);
      d = dirname(d);
    }
    return 들;
  }

  /** 새 기록에 적을 상대 경로. 뿌리 밖이면 null — 그런 기록은 되돌릴 때 안 받는다. */
  #상대(abs) {
    const a = resolve(String(abs));
    return 안인가(this.root, a) ? relative(this.root, a).split(sep).join('/') : null;
  }

  /*
   * 적힌 칸을 지금 폴더의 절대 경로로. 밖을 가리키면 null.
   * rel 이 있으면 rel 만 믿는다 — 절대 경로 칸이 안이라고 적혀 있어도 rel 이 밖이면 밖이다.
   */
  #자리풀기(적힌절대, 적힌상대) {
    let abs = null;
    if (typeof 적힌상대 === 'string') abs = isAbsolute(적힌상대) ? null : resolve(this.root, 적힌상대);
    else if (typeof 적힌절대 === 'string' && isAbsolute(적힌절대)) abs = resolve(적힌절대);
    return abs && 안인가(this.root, abs) ? abs : null;
  }

  /** 링크를 따라가도 뿌리 안인가. 건드리기 직전에만 본다 — 줄마다 디스크를 묻지 않게. */
  #링크도안인가(abs) {
    const 뿌리 = 진짜자리(this.root);
    return 안인가(뿌리, 진짜자리(abs));
  }

  /*
   * ── 반쪽 줄 뒤에 이어 적지 않는다 ─────────────────────────────────────
   *
   * 적다가 죽으면 마지막 줄이 개행 없이 남는다. 다음 판의 첫 기록이 그 뒤에 붙어 한 줄이
   * 되고, 그 줄은 JSON 이 아니라 all() 이 버린다. 그러면 **이번 판의 턴이 이력에 없어서**
   * /undo 한 번이 앞 판의 턴을 되돌리고 「되돌렸습니다」 라고 했다 — 시키지 않은 되돌리기다.
   * agent/store.js · safety/audit.js 와 같은 방법이다. 이 이력으로 처음 적을 때 한 번 파일 끝을
   * 보고, 개행이 아니면 개행부터 붙인다. 통째로 다시 쓰는 자리(prune·undo·버리기)는 언제나
   * 개행으로 끝내므로 한 번 본 것이 계속 맞다.
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

  #덧붙이기(rec) {
    let 줄 = 적을줄(rec) + '\n';
    if (!this.#줄끝봤나) {
      if (!this.#줄로끝나나()) 줄 = '\n' + 줄;
      this.#줄끝봤나 = true;
    }
    appendFileSync(this.file, 줄, 'utf8');
  }

  /*
   * ── 이 파일은 남의 파일 **원문**을 담는다 ───────────────────────────────
   *
   * 되돌리려면 고치기 전 내용을 그대로 들고 있어야 한다. 그래서 여기에는
   * `.env` · `id_rsa` · `.npmrc` · kubeconfig 가 **평문으로** 들어온다.
   * 가리지도 않는다 — 가리면 되돌릴 때 사람의 진짜 열쇠가 표로 덮여 없어진다.
   * 즉 이 자리에서 지키는 방법은 파일 권한 하나뿐인데, 그것이 없었다.
   *
   * umask 022 인 리눅스·맥에서 이 파일은 0644 로 만들어진다. 같은 PC 의 다른
   * 계정, 데몬, 공유 홈(NFS)의 아무나가 deel 이 손댄 모든 파일의 원문을 읽는다
   * — 주인이 일부러 0600 으로 잠가 둔 파일까지. `.deel` 아래 다른 기록
   * (agent/store.js · safety/audit.js)은 전부 잠그는데 여기만 안 잠갔다.
   *
   * 1.14.0 에서 셸 쓰기(`sed -i` · `echo >` · `tee`)까지 스냅샷을 뜨게 하면서
   * 들어오는 파일이 더 늘었다. 고친 것이 이 구멍을 넓힌 셈이라 같이 막는다.
   *
   * 윈도우(NTFS)에서는 chmod 가 아무 일도 안 한다. 거기서는 못 잠근 것이지
   * 잠근 척하지 않는다 — 그래서 결과를 `잠금` 에 있는 그대로 남긴다.
   * (safety/audit.js · agent/store.js 와 같은 모양이다)
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
    this.#낮춘이름 = new Map();
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
    const 이미 = this.#이번턴.get(absPath) ?? this.#같은파일기록(absPath);
    if (이미) return 이미;

    const 없던 = !existsSync(absPath);
    const 뜬것 = 없던 ? { before: null } : safeRead(absPath);
    const rec = { turn: this.turn, at: new Date().toISOString(), path: absPath, before: 뜬것.before, label };
    /*
     * 「원래 없던 자리」 라는 **표**를 따로 단다 (6회차 Gemini 되돌리기6).
     *
     * before:null 만으로는 옛 이력(skipped 이전)의 「못 뜬 파일」 과 안 갈려서, undo() 는 지금 바이너리면
     * 안 지운다. 그 갈래가 새 기록에도 걸려 `cp img.png copy.png` · hwpx 만들기처럼 이번 턴에 **새로 만든**
     * 그림·문서가 /undo 뒤에도 남았다. 이 표가 있으면 정말 없던 자리라 바이너리여도 지운다.
     */
    if (없던) rec.없던 = true;
    /*
     * ── 이 파일과 **같이 생길 폴더**도 적는다 (2.0.2 · B3) ─────────────────────
     *
     * 폴더를 통째로 옮긴 판(`dirA` → `dirB`)을 되돌리면 파일은 `dirA` 로 돌아오고
     * `dirB/f.txt` 는 「원래 없던 파일」 로 지워지는데, **빈 `dirB` 가 남았다.** 되돌린
     * 뒤의 폴더가 되돌리기 전과 다르다. 그 폴더가 이번에 생겼다는 것을 아무 데도
     * 안 적어서 지울 근거가 없었다.
     *
     * 원래 있던 빈 폴더에 파일을 만든 판과 가르려면 **뜰 때** 봐야 한다 — 되돌릴 때는
     * 둘 다 「빈 폴더」 라 구별이 안 된다. 그래서 여기서 아직 없는 조상 폴더를 깊은
     * 것부터 적어 두고, 되돌릴 때 그 폴더가 **비었을 때만** 지운다.
     */
    if (없던) {
      const 새폴더 = this.#없는폴더들(absPath);
      if (새폴더.length) rec.새폴더 = 새폴더;
    }
    // 작업 폴더 기준 자리. 폴더를 옮기거나 복사해도 이 이력은 **그 폴더**를 되돌린다 (위 머리말).
    const 상대 = this.#상대(absPath);
    if (상대 !== null) rec.rel = 상대;
    if (뜬것.enc) rec.enc = 뜬것.enc;
    if (뜬것.skipped) rec.skipped = 뜬것.skipped;
    /*
     * 못 뜬 파일은 **크기**를 적어 둔다 (6회차 Gemini 도구6j).
     *
     * 옮기기(Move · 셸 mv)는 떠난 자리를 뜨고 닿은 자리를 없던 자리로 뜬다. 그림은 떠난 자리를 못 떠서 되돌릴 수
     * 없는데, undo() 가 없던 자리를 바이너리여도 지우면 그림이 **한 벌도 안 남았다.** 크기가 같은 새 바이너리는
     * 옮겨 온 마지막 한 벌일 수 있어 undo() 가 안 지운다(undo 의 사라진못뜬크기).
     */
    if (뜬것.skipped) { try { rec.크기 = statSync(absPath).size; } catch { /* 못 재면 크기 모르는 기록 — undo() 가 옮겨 왔을 수 있다고 본다 */ } }
    this.#덧붙이기(rec);
    this.#잠그기();
    this.#이번턴.set(absPath, rec);
    const 낮춘 = absPath.toLowerCase();
    this.#낮춘이름.set(낮춘, [...(this.#낮춘이름.get(낮춘) ?? []), absPath]);
    this.#maybePrune();
    return rec;
  }

  /*
   * ── 대소문자만 다른 이름으로 **같은 파일**을 또 뜨지 않는다 ────────────
   *
   * 윈도우·맥은 `a.txt` 와 `A.txt` 를 한 파일로 친다. 위 #이번턴 은 글자로
   * 견주어서, 한 턴에 `Write a.txt` 뒤 `Edit A.txt` 를 하면 기록이 둘 생겼다
   * — 둘째는 첫 쓰기가 끝난 **뒤의** 내용이다. /undo 는 두 기록을 차례로
   * 써서, 턴 처음이 아니라 **중간 상태**로 되돌려 놓고 「되돌렸습니다」 를 찍었다.
   *
   * 글자가 대소문자만 다를 때 디스크의 같은 물건인지(dev·ino)를 본다.
   * 가리는 판(리눅스)에서는 서로 다른 파일이라 번호가 달라 안 걸린다.
   */
  #낮춘이름 = new Map();
  #같은파일기록(absPath) {
    const 뭉치 = this.#낮춘이름.get(absPath.toLowerCase());
    if (!뭉치) return null;
    for (const p of 뭉치) {
      if (p !== absPath && 같은물건(p, absPath)) return this.#이번턴.get(p) ?? null;
    }
    return null;
  }

  /**
   * 이번 턴에 이 파일을 이미 떴나.
   *
   * 쓰기가 깨졌을 때 **이번에 뜬 기록만** 거두려고, 부르는 쪽이 뜨기 전에 본다.
   * 같은 턴에 앞서 성공한 고치기의 기록은 턴 처음 모습이라 거두면 안 된다.
   */
  떴나(absPath) {
    return this.#이번턴.has(absPath) || !!this.#같은파일기록(absPath);
  }

  /*
   * ── **명령 뒤에** 새로 생긴 파일을 「없던 자리」 로 적는다 (6회차 — 셸 cp·mv 의 새 이름) ──────
   *
   * `cp a b` · `mv a b` · `mv a sub` 의 새 이름은 명령 **뒤에야** 생긴다. 셸 스냅샷은 지금 있는 이름만
   * 떴다 — 없는 이름을 미리 뜨면 `rm *.tmp` 류에 헛기록이 쌓여서다(tools/index.js 바꾸기전스냅샷).
   * 그래서 /undo 뒤에 사본이 남았고, mv 는 원래 자리가 살아난 채 새 이름도 남아 두 벌이 됐다.
   *
   * 없던 자리의 앞 모습은 뜨지 않아도 안다 — 없었다. 그래서 생긴 것을 본 **뒤에** 적는다.
   * 이번 턴에 이미 뜬 자리면 그 기록이 턴 처음 모습이라 안 적는다.
   */
  없던자리기록(absPath, label) {
    if (this.떴나(absPath)) return null;
    const rec = { turn: this.turn, at: new Date().toISOString(), path: absPath, before: null, 없던: true, label };
    const 상대 = this.#상대(absPath);
    if (상대 !== null) rec.rel = 상대;
    this.#덧붙이기(rec);
    this.#잠그기();
    this.#이번턴.set(absPath, rec);
    const 낮춘 = absPath.toLowerCase();
    this.#낮춘이름.set(낮춘, [...(this.#낮춘이름.get(낮춘) ?? []), absPath]);
    this.#maybePrune();
    return rec;
  }

  /*
   * ── 떠 놓고 **못 쓴** 기록을 거둔다 ───────────────────────────────────
   *
   * Write·Edit·Append·Move 는 정말 쓰기 직전에 뜬다. 그런데 그 쓰기 자체가
   * 깨지는 판이 있다 — 읽기 전용 파일(EPERM·EACCES), 엑셀·한글이 잡고 있는
   * 파일(EBUSY). 파일은 한 글자도 안 바뀌었는데 기록은 남아서, turns() 가
   * 그 턴을 세고 /undo 한 번이 그 헛턴에 먹혔다. 사람이 되돌리려던 **앞 턴**의
   * 진짜 변경은 그대로 남는다. 여태 기록을 지울 길이 여기에 없었다.
   *
   * 파일이 정말 그대로인지는 부르는 쪽이 본다(쓰다 반쯤 깨졌으면 기록이 있어야
   * 되돌린다). 이 함수는 이번 턴의 그 기록 한 줄만 지운다.
   *
   * @param {string} absPath
   * @param {object} [그기록]  지울 기록. 없으면 이번 턴에 그 파일을 뜬 기록.
   * @returns {boolean} 지웠나
   */
  버리기(absPath, 그기록 = null) {
    const rec = 그기록 ?? this.#이번턴.get(absPath);
    if (!rec || rec.turn !== this.turn) return false;
    // 읽은 기록의 path 는 지금 폴더에 붙여 편 것이다(all). 적을 때 쓴 rel 이 있으면 그걸로 견준다 —
    // 절대 경로 글자는 대소문자·꼴이 조금만 달라도 남남이 된다.
    const 같은자리 = (r) => (rec.rel != null ? r.rel === rec.rel : r.path === rec.path);
    const 그것인가 = (r) => r.turn === rec.turn && 같은자리(r) && r.at === rec.at
      && (r.이름되돌림rel ?? r.이름되돌림 ?? null) === (rec.이름되돌림rel ?? rec.이름되돌림 ?? null);
    let recs;
    try { recs = this.all(); } catch { return false; }
    const 남길것 = recs.filter((r) => !그것인가(r));
    if (남길것.length !== recs.length) {
      try {
        writeFileSync(this.file, 남길것.map(적을줄).join('\n') + (남길것.length ? '\n' : ''), 'utf8');
        this.#잠갔나 = false; this.#잠그기();
      } catch { return false; }
    }
    if (this.#이번턴.get(rec.path) === rec) {
      this.#이번턴.delete(rec.path);
      const 낮춘 = rec.path.toLowerCase();
      const 남은 = (this.#낮춘이름.get(낮춘) ?? []).filter((p) => p !== rec.path);
      if (남은.length) this.#낮춘이름.set(낮춘, 남은); else this.#낮춘이름.delete(낮춘);
    }
    return true;
  }

  /*
   * ── 대소문자만 바꾸는 이름 바꾸기는 **이름 바꾸기로** 적는다 ──────────────
   *
   * 내용은 안 바뀌니 내용을 뜰 것이 없다. 되돌릴 것은 이름 하나다. 그런데
   * 기록 모양이 「이 경로의 원래 내용」 하나뿐이라, tools/index.js 는 뜨는
   * **순서**로 이름을 되돌리려 했다 — [A.txt: 없던 파일] 을 먼저, [a.txt: 내용]
   * 을 뒤에 남겨 지우고 다시 만들게. 그 수는 세 곳에서 샜다:
   *
   *   · 이 턴에 이미 뜬 파일 — 앞 기록이 먼저라 순서를 못 바꾼다 (이름 못 되돌림)
   *   · 폴더 — 안의 파일만 떠서 폴더 이름은 안 돌아온다
   *   · 그림처럼 내용을 못 뜨는 파일 — 지우지도 만들지도 못해 이름이 남는다
   *
   * 그래서 { path: 새이름, 이름되돌림: 옛이름 } 을 따로 적고, undo() 가 내용을
   * 다 되돌린 **뒤에** 적은 반대 순서로 이름을 되돌린다. 내용 기록과 순서가
   * 얽히지 않으니 위 셋이 다 된다.
   *
   * `before: null` 과 `skipped` 를 같이 적는 것은 **옛 deel 이 읽을 때**를 위해서다.
   * 이 필드를 모르는 판은 skipped 를 보고 건드리지 않는다 — before:null 만
   * 있으면 「없던 파일」 로 읽어 지운다.
   */
  이름바꿈기록(앞, 뒤, label) {
    const rec = { turn: this.turn, at: new Date().toISOString(), path: 뒤, before: null, skipped: '이름바꿈', 이름되돌림: 앞, label };
    // 두 이름 다 작업 폴더 기준으로도 적는다. 되돌릴 때 둘 중 하나라도 밖이면 이름을 안 바꾼다.
    const 뒤상대 = this.#상대(뒤);
    const 앞상대 = this.#상대(앞);
    if (뒤상대 !== null) rec.rel = 뒤상대;
    if (앞상대 !== null) rec.이름되돌림rel = 앞상대;
    this.#덧붙이기(rec);
    this.#잠그기();
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
    // 앞서 못 줄였으면 한참 쉬었다가 다시 본다 (prune 의 주석).
    if (this.#writes < this.#다음줄이기) return;
    try {
      if (statSync(this.file).size < MAX_BYTES) return;
    } catch { return; }
    /*
     * 줄이다 터져도 **고치던 파일까지 말려들면 안 된다.**
     *
     * 이 함수는 snapshot() 안에서 돈다 — 즉 Write·Edit 이 파일을 쓰기
     * 직전이다. prune() 이 이력을 읽다 던지면(EACCES·EBUSY) 그 예외가
     * 도구 밖으로 새어 나가, 사람은 고치려던 파일과 아무 상관 없는
     * 「EACCES: …/edits.jsonl」 을 보게 된다. 이력을 못 줄인 것은
     * 위쪽(줄이기못함)에 남기고, 고치는 일은 그대로 이어 간다.
     */
    try { this.prune(); }
    catch (err) {
      this.줄이기못함 = err?.message ?? String(err);
      this.#다음줄이기 = this.#writes + 500;
    }
  }

  #다음줄이기 = 0;
  /** 이력을 못 줄였으면 그 까닭. 못 줄이면 안전망이 제 무게로 무너진다. */
  줄이기못함 = null;

  #writes = 0;

  /** 최근 keep 개 턴만 남기고 자른다. 버린 줄 수를 돌려준다. */
  prune({ keep = KEEP_TURNS } = {}) {
    /*
     * ── **읽다 터지는 것**도 못 줄인 것이다 ────────────────────────────
     *
     * 아래 쓰기만 감싸 두고 여기 읽기는 맨몸이었다. 그런데 이력을 못 읽는
     * 판(권한·잠김·자리가 폴더로 바뀜)은 못 쓰는 판만큼이나 흔하고, 그때
     * 예외가 여기를 뚫고 나가면 부르는 쪽 — 파일을 쓰던 Write·Edit — 이
     * 고치려던 파일과 아무 상관 없는 오류를 뒤집어쓴다.
     *
     * 못 줄인 것은 못 줄였다고 위쪽(줄이기못함)에 남기고 0을 돌려준다.
     * 그게 이 함수가 실패를 말하는 유일한 방식이라 여기서도 같아야 한다.
     */
    let recs;
    let turns;
    try { recs = this.all(); turns = this.turns(); }
    catch (err) {
      this.줄이기못함 = err?.message ?? String(err);
      this.#다음줄이기 = (this.#writes ?? 0) + 500;
      return 0;
    }
    if (turns.length <= keep) return 0;
    // keep 0 은 「남길 턴이 없다」 는 말이다. `slice(-0)` 은 `slice(0)` 이라 **전부** 남겨
    // 한 줄도 안 버렸다 — 이력을 비우라고 부른 쪽은 비운 줄 알고 32MB 를 이고 간다.
    // 지금 실호출부는 기본값(KEEP_TURNS)만 쓰지만, 0 을 「전부 남김」 으로 읽는 셈은 이름과 반대다.
    const 남길턴 = new Set(keep > 0 ? turns.slice(-keep) : []);
    const 남길것 = recs.filter((r) => 남길턴.has(r.turn));
    const 버린수 = recs.length - 남길것.length;
    if (!버린수) return 0;
    try {
      writeFileSync(this.file, 남길것.map(적을줄).join('\n') + (남길것.length ? '\n' : ''), 'utf8');
      // 통째로 다시 쓰면 새 파일일 수 있다 — 빗장을 다시 건다 (agent/store.js 도 같다).
      this.#잠갔나 = false; this.#잠그기();
      this.줄이기못함 = null;
    } catch (err) {
      /*
       * 못 줄인 것을 **0개 버렸다**와 같은 값으로 돌려주고 있었다.
       *
       * 부르는 쪽은 둘을 구별할 길이 없다. 그리고 실패는 대개 이어진다 —
       * 읽기 전용이거나 디스크가 찬 것이라 다음 번에도 같다. 그러면 이력은
       * 32MB 를 넘긴 채 끝없이 자라는데 화면에는 영영 안 뜬다.
       *
       * 곧바로 또 시도하지도 않는다. 32MB 짜리 파일을 스무 번 쓸 때마다
       * 통째로 다시 읽는 셈이라, 실패가 이어지면 그 자체가 느려지는 원인이 된다.
       */
      this.줄이기못함 = err?.message ?? String(err);
      this.#다음줄이기 = (this.#writes ?? 0) + 500;
      return 0;
    }
    return 버린수;
  }

  /** 지금 이력이 얼마나 되나. /status 에서 보여 준다. */
  size() {
    try { return statSync(this.file).size; } catch { return 0; }
  }

  /*
   * ── 깨진 줄은 **되돌릴 수 없는 파일**이다 ────────────────────────────
   *
   * 여태 `catch { return null }` 로 조용히 버렸다. 그런데 이 파일의 한 줄은
   * 곧 한 파일의 원문이다 — 줄이 깨졌다는 것은 그 파일을 되돌릴 길이
   * 사라졌다는 뜻이다. 그걸 안 세면 `/undo` 는 「파일 3개를 되돌렸습니다」
   * 라고만 하고, 넷째 파일이 왜 안 돌아왔는지는 아무 데도 안 남는다.
   *
   * 줄은 실제로 깨진다. 쓰다 죽으면 마지막 줄이 반만 적히고, 같은 폴더에서
   * 창을 둘 띄워 놓으면 큰 줄 둘이 서로 끼어든다(appendFileSync 는 긴 줄을
   * 통째로 보장하지 않는다).
   */
  /** 마지막으로 읽을 때 깨져 있던 줄 수. 0 이 아니면 그만큼 못 되돌린다. */
  깨진줄 = 0;

  /*
   * 읽은 기록의 path 는 **지금 폴더**의 절대 경로로 펴서 준다 (위 「이력이 가리키는 곳」).
   * /diff·/rewind 같은 부르는 쪽은 지금 폴더의 절대 경로로 기록을 찾는다 — 복사한 폴더에서
   * 원본 폴더 경로가 나오면 그 파일을 「안 바꾼 파일」 로 본다.
   * 밖을 가리키는 기록은 path 를 적힌 그대로 두고 `바깥` 표를 붙인다. 표는 파일에 안 적힌다.
   */
  all() {
    if (!existsSync(this.file)) return [];
    let 깨진 = 0;
    const 것들 = readFileSync(this.file, 'utf8')
      .split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { 깨진 += 1; return null; } })
      .filter((r) => {
        if (r && typeof r === 'object' && !Array.isArray(r)) return true;
        if (r !== null) 깨진 += 1;          // JSON 이긴 한데 기록 꼴이 아니다
        return false;
      })
      .map((r) => {
        const 자리 = this.#자리풀기(r.path, r.rel);
        const 이름자리 = r.이름되돌림 == null && r.이름되돌림rel == null ? undefined : this.#자리풀기(r.이름되돌림, r.이름되돌림rel);
        if (!자리 || 이름자리 === null) return { ...r, 바깥: true };
        return 이름자리 === undefined ? { ...r, path: 자리 } : { ...r, path: 자리, 이름되돌림: 이름자리 };
      });
    this.깨진줄 = 깨진;
    return 것들;
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
    /*
     * 0 · 음수는 「되돌릴 것이 없다」 는 말이다.
     *
     * `slice(-0)` 은 `slice(0)` 이라 **전부** 되돌아갔다. 지금 유일한 호출부(commands.js)가
     * `/undo 0` 을 먼저 막고 있어 화면에는 안 나왔지만, 그건 부르는 쪽 한 자리가 지키는
     * 것이지 이 함수가 지키는 것이 아니다 — 파일을 실제로 되돌리는 자리는 친 수보다 많이
     * 도는 것이 제일 비싸다(commands.js 의 같은 잣대). 그래서 여기서도 막는다.
     */
    const 몇 = Math.floor(Number(n));
    const turns = Number.isFinite(몇) && 몇 > 0 ? this.turns().slice(-몇) : [];
    if (!turns.length) return { restored: [], turns: 0, turnIds: [] };

    const target = recs.filter((r) => turns.includes(r.turn));
    const restored = [];
    /*
     * 밖을 가리키는 기록은 **건드리지 않고 그렇다고 적는다** (파일 머리말 「이력이 가리키는 곳」).
     * 되돌린 수에는 안 넣는다. 조용히 버리면 사람은 다 돌아온 줄 알고, 되돌린 척하면 더 나쁘다.
     */
    for (const r of target.filter((x) => x.바깥)) {
      restored.push({ path: r.path, how: '그대로 둠 (작업 폴더 밖을 가리키는 기록이라 건드리지 않았습니다)', skipped: true, 바깥: true });
    }
    const 안것 = target.filter((x) => !x.바깥);
    // 같은 파일이 여러 번 바뀌었으면 가장 이른 상태로 되돌려야 한다.
    // 이름 바꾸기 기록은 내용 기록이 아니다 — 따로 모아 맨 뒤에 되돌린다 (이름바꿈기록 머리말).
    const first = new Map();
    for (const r of 안것) if (!r.이름되돌림 && !first.has(r.path)) first.set(r.path, r);
    const 이름바꿈들 = 안것.filter((r) => r.이름되돌림);
    // 글자로는 안이어도 고리를 따라가면 밖일 수 있다. 뿌리는 한 번만 푼다.
    const 진짜뿌리 = 진짜자리(this.root);
    const 링크밖 = (p) => !안인가(진짜뿌리, 진짜자리(p));
    const 링크밖이라둠 = (p) => ({ path: p, how: '그대로 둠 (링크를 따라가면 작업 폴더 밖이라 건드리지 않았습니다)', skipped: true, 바깥: true });
    /*
     * ── 못 뜬 채 **사라진** 파일이 있으면, 크기가 같은 새 바이너리는 지우지 않는다 (6회차 Gemini 도구6j) ──
     *
     * 옮기기는 떠난 자리를 뜨는데 그림은 못 떠서(skipped) 되돌릴 수 없고, 닿은 자리는 없던 자리라 아래에서 지운다 —
     * 둘이 한 파일이면 그림이 한 벌도 안 남았다(Move · 셸 mv · 폴더째 옮기기 모두). 되돌릴 수 없는 쪽이 사라졌으면
     * 남은 쪽이 그 파일의 마지막 한 벌일 수 있다. 크기를 안 적은 옛 기록이면 크기를 모르니 옮겨 왔을 수 있다고 본다.
     * `cp img.png copy.png` 처럼 원본이 그대로 있으면 여기 안 걸려 사본은 4b 대로 지워진다.
     */
    const 사라진못뜬크기 = [...first.values()].filter((r) => r.skipped && !existsSync(r.path)).map((r) => r.크기 ?? null);
    const 옮겨왔을수있나 = (p) => {
      if (!사라진못뜬크기.length) return false;
      if (사라진못뜬크기.includes(null)) return true;
      try { return 사라진못뜬크기.includes(statSync(p).size); } catch { return false; }
    };

    for (const [path, rec] of first) {
      try {
        if (링크밖(path)) {
          restored.push(링크밖이라둠(path));
        } else if (rec.skipped) {
          // 내용을 못 떠 놓은 파일이다. 되돌릴 것이 없으니 손대지 않는다.
          // 조용히 넘기지는 않는다 — 되돌아간 줄 알면 사용자가 그 위에 계속 일한다.
          restored.push({ path, how: `그대로 둠 (${rec.skipped} — 내용을 떠 두지 못했습니다)`, skipped: true });
        } else if (rec.before === null) {
          // 옛 이력에는 skipped 표시가 없다. 그때 못 뜬 파일도 여기로 온다.
          // 지금 디스크에 있는 것이 바이너리면 우리가 만든 파일일 리 없으니 안 지운다.
          if (!existsSync(path)) continue;
          let 바이너리 = false;
          let 옮겨온것 = false;
          // 「없던 자리」 표가 있는 파일은 이번 턴에 우리가 만든 것이라 바이너리여도 지운다 (snapshot 머리말).
          // 폴더는 표가 있어도 옛 갈래로 둔다 — 안에 무엇이 들었는지 모르니 통째로 안 지운다.
          if (rec.없던 && !statSync(path).isDirectory()) {
            // 다만 못 뜬 채 사라진 파일을 옮겨 온 것일 수 있으면 안 지운다 (위 사라진못뜬크기).
            if (옮겨왔을수있나(path)) { try { 옮겨온것 = looksBinary(readFileSync(path)); } catch { 옮겨온것 = true; } }
          } else { try { 바이너리 = looksBinary(readFileSync(path)); } catch { 바이너리 = true; } }
          if (옮겨온것) {
            restored.push({ path, how: '그대로 둠 (바이너리 — 같은 턴에 못 뜬 채 사라진 파일과 크기가 같아, 옮겨 온 마지막 한 벌일 수 있어 지우지 않았습니다)', skipped: true });
            continue;
          }
          if (바이너리) {
            restored.push({ path, how: '그대로 둠 (바이너리 — 내용을 떠 두지 못했습니다)', skipped: true });
            continue;
          }
          rmSync(path, { force: true });
          restored.push({ path, how: 말('undo.wayDeleted'), ok: true });
          // 그 파일과 같이 생긴 폴더가 이제 비었으면 거둔다 (snapshot 의 새폴더 머리말). rmdirSync 는 **빈
          // 폴더만** 지운다 — 그 뒤에 누가 넣은 것이 있으면 ENOTEMPTY 로 멈추고, 폴더가 아니면 ENOTDIR 다.
          // 이력은 저장소에 딸려 올 수 있으니(파일 머리말) 폴더 자리도 밖·링크 너머면 안 건드린다.
          // 파일이 아니라서 되돌린 수에는 안 센다.
          for (const 상대 of rec.새폴더 ?? []) {
            const d = this.#자리풀기(null, 상대);
            if (!d || 링크밖(d)) break;
            try { rmdirSync(d); } catch { break; }
            restored.push({ path: d, how: '빈 폴더 지움 (이번에 새로 생긴 폴더)', ok: true, 폴더: true });
          }
        } else {
          /*
           * 담고 있던 폴더가 없어졌을 수 있다 — Move 로 폴더째 옮긴 경우다.
           * 그러면 writeFileSync 가 ENOENT 로 죽고, 되돌리기는 "실패" 만 남긴 채
           * 파일을 못 되살린다. 되돌릴 내용은 손에 있는데 담을 자리가 없어서
           * 못 넣는 것이라, 자리를 다시 만들어 준다.
           */
          mkdirSync(dirname(path), { recursive: true });
          // enc 가 붙어 있으면 UTF-8 로 담을 수 없던 파일이다 — 바이트를 그대로 되돌린다.
          writeFileSync(path, rec.enc === 'b64' ? Buffer.from(rec.before, 'base64') : Buffer.from(rec.before, 'utf8'));
          restored.push({ path, how: 말('undo.wayRestored'), ok: true });
        }
      } catch (err) {
        restored.push({ path, how: `실패: ${err.message}`, ok: false, 못했나: true });
      }
    }
    /*
     * 이름은 내용을 다 되돌린 **뒤에**, 적은 반대 순서로 되돌린다.
     *
     * 대소문자만 다른 이름은 파일 시스템에게 같은 파일이라, 위에서 `b.txt` 로
     * 쓴 내용은 지금 이름(`B.txt`)인 파일에 들어간다 — 그다음 이름만 바꾸면 된다.
     * 이 턴에 만든 파일이면 위에서 이미 지워져 바꿀 것이 없다. 한 턴에 여러 번
     * 바꿨으면(a → A → a) 늦게 바꾼 것부터 풀어야 처음 이름에 닿는다.
     */
    /*
     * ── 이름이 부딪쳐 못 되돌린 것도 「못한 것」 이다 ──────────────────────
     *
     * 아래 셈(못한것)은 `ok === false` 만 셌다. 원래 이름 자리에 다른 파일이 있어 이름을
     * 못 되돌린 갈래는 `skipped` 로만 적혀 그 셈에 안 들었고, 그 턴의 기록이 통째로 잘려
     * 나갔다 — 부딪친 파일을 치우고 /undo 를 다시 쳐도 되돌릴 기록이 없다. 그건 **다시
     * 해 보면 되는** 것이라 남긴다(내용을 애초에 못 뜬 갈래는 남겨도 영영 못 되돌리니
     * 그대로 잘라낸다 — 되돌릴 것이 없는 줄을 남기면 그 턴이 영영 안 사라진다).
     *
     * 지금 이름을 따로 모으는 까닭: 이 갈래는 restored 에 **원래 이름**으로 적히는데
     * 이력의 그 줄은 **지금 이름**으로 찾는다. 같은 칸에 넣으면 셈이 또 빗나간다.
     */
    const 다시할것 = new Set();
    for (const rec of [...이름바꿈들].reverse()) {
      try {
        // 두 이름 중 하나라도 고리 너머 밖이면 이름을 안 바꾼다 — 바꾸면 밖의 파일이 옮겨진다.
        if (링크밖(rec.path) || 링크밖(rec.이름되돌림)) { restored.push(링크밖이라둠(rec.이름되돌림)); continue; }
        if (!existsSync(rec.path)) continue;
        if (existsSync(rec.이름되돌림) && !같은물건(rec.path, rec.이름되돌림)) {
          restored.push({ path: rec.이름되돌림, how: `그대로 둠 (원래 이름 자리에 다른 파일이 있어 ${basename(rec.path)} 의 이름을 못 되돌렸습니다)`, skipped: true });
          다시할것.add(rec.path);        // 부딪친 것을 치우면 다시 된다 — 기록을 남긴다 (위 머리말)
          continue;
        }
        renameSync(rec.path, rec.이름되돌림);
        restored.push({ path: rec.이름되돌림, how: `이름 되돌림 (${basename(rec.path)} → ${basename(rec.이름되돌림)})`, ok: true });
      } catch (err) {
        restored.push({ path: rec.path, how: `실패: ${err.message}`, ok: false, 못했나: true });
      }
    }
    /*
     * ── 못 되돌린 것의 기록은 **남긴다** ──────────────────────────────
     *
     * 전에는 성패를 안 가리고 그 턴의 기록을 통째로 잘라냈다. 그러면 한 번
     * 실패한 파일은 스냅샷이 사라져서 **다시 시도할 길이 없다.** 화면은
     * 「파일 N개를 되돌렸습니다」 라고 하고(실패한 것까지 셌다), 감사기록에도
     * 그 부풀린 수가 남고, 부르는 쪽은 /diff 목록에서까지 그 파일을 지운다.
     * 파일만 고쳐진 채로 남고 아무도 그걸 모른다.
     *
     * 되돌린 것만 잘라낸다. 못한 것은 그대로 두어 한 번 더 시도할 수 있게 한다.
     */
    const 못한것 = new Set(restored.filter((x) => x.ok === false).map((x) => x.path));
    const keep = recs.filter((r) => !turns.includes(r.turn) || 못한것.has(r.path) || 다시할것.has(r.path));
    /*
     * ── 여기가 터지면 **파일은 이미 되돌아가 있다** ────────────────────
     *
     * 감싸지 않은 쓰기였다. 던지면 위에서 받아 「명령을 처리하다 막혔습니다」
     * 한 줄만 남는다 — 그런데 디스크의 파일들은 방금 되돌아갔다. 화면이
     * 실패라고 말하는데 실제로는 성공한, 이 저장소가 계속 잡아 온 어긋남이
     * 방향만 뒤집힌 꼴이다.
     *
     * 게다가 이력을 못 줄였으니 그 턴이 그대로 남는다. 사람이 「실패했으니
     * 다시」 하고 /undo 를 또 치면 **같은 턴**을 또 되돌린다 — 두 턴을
     * 되돌린 줄 알지만 한 턴이다.
     */
    let 이력줄임 = { ok: true };
    try {
      writeFileSync(this.file, keep.map(적을줄).join('\n') + (keep.length ? '\n' : ''), 'utf8');
      this.#잠갔나 = false; this.#잠그기();
    } catch (err) {
      이력줄임 = { ok: false, 왜: err?.message ?? String(err) };
    }
    return {
      restored,
      // 이력에서 그 턴을 지웠나. 못 지웠으면 같은 턴이 그대로 남아 있다.
      이력줄임,
      // 이력에서 못 읽은 줄 수. 그만큼은 되돌릴 길이 애초에 없었다.
      깨진줄: this.깨진줄,
      // 화면·감사기록이 쓰는 수. **진짜로 되돌아간 것만** 센다.
      되돌린수: restored.filter((x) => x.ok === true && !x.폴더).length,
      못한것: restored.filter((x) => x.ok === false),
      turns: turns.length,
      turnIds: turns.slice(),
    };
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
/** 두 경로가 디스크의 같은 물건인가 (dev·ino). 없거나 못 읽으면 아니다. */
function 같은물건(p, q) {
  try {
    const a = statSync(p, { bigint: true });
    const b = statSync(q, { bigint: true });
    return a.ino !== 0n && a.ino === b.ino && a.dev === b.dev;
  } catch { return false; }
}

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
