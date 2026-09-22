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
  appendFileSync, writeFileSync, statSync, rmSync, chmodSync, renameSync,
} from 'node:fs';
import { 줄로끝나나, 본인만잠그기 } from '../jsonl.js';
import { join } from 'node:path';
import { 도구결과인가 } from '../backend/adapter.js';
import { BOM떼기 } from '../safety/trust.js';

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
export function freeId(dir, at = new Date(), 피할것 = null) {
  /*
   * ── 파일이 없다고 빈 이름은 아니다 (사냥5 H5-1) ─────────────────────────
   *
   * 여기는 **이 폴더의** 대화 파일만 봤다. 에디터 프로세스 하나가 두 프로젝트를
   * 같은 초에 열면 두 폴더 다 그 이름의 파일이 없어서 둘 다 같은 이름을 받았고,
   * ACP 는 그 이름 하나로 방을 찾으므로 A 탭의 말이 B 방으로 갔다. 부르는 쪽이
   * 「이 프로세스에서 이미 쓴 이름」 을 알려 주면 그것도 피한다.
   */
  const 비었나 = (id) => !existsSync(join(dir, `${id}.jsonl`)) && !(typeof 피할것 === 'function' && 피할것(id));
  const base = newId(at);
  if (비었나(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const id = `${base}-${n}`;
    if (비었나(id)) return id;
  }
  // 여기까지 왔으면 마지막 이름도 비어 있는지 봐야 한다. 안 보고 돌려주면
  // begin() 이 같은 이름으로 쉰 번을 되풀이하다 **아무 파일도 없이** 대화를
  // 시작한다 — 저장한다고 적어 놓고 한 줄도 안 남는 판이 그때 만들어진다.
  for (let n = 0; n < 1000; n++) {
    const id = n ? `${base}-${process.pid}-${n}` : `${base}-${process.pid}`;
    if (비었나(id)) return id;
  }
  return `${base}-${process.pid}-${Date.now().toString(36)}`;
}

/**
 * 대화 이름으로 쓸 수 있나 — 이름이 곧 `.deel/sessions/<이름>.jsonl` 의 한 조각이다.
 *
 * 이름을 경로에 그대로 이어 붙인다. 여태 이름을 본 자리는 remove() 하나였고,
 * 읽기·적기·갈아 끼우기는 안 봤다. 그래서 에디터가 session/load 로 `../../evil/x`
 * 를 주면 대화 폴더 **밖**의 `evil/x.jsonl` 을 대화로 읽었고, 한 턴이 돌면 거기에
 * 대화를 적었다. 이름을 받는 문이 셋(--resume · session/load · /sessions)이라,
 * 검사는 이름이 경로가 되는 한 자리(Store)와 여기 하나에 둔다.
 */
export function 대화이름인가(id) {
  const s = String(id ?? '');
  return /^[^\\/:*?"<>|\x00-\x1f]+$/.test(s) && s.trim() === s && !s.includes('..') && !/^\.+$/.test(s);
}

export class Store {
  /**
   * @param {string} root
   * @param {string|null} id  이어 쓸 대화 이름. 안 주면 빈 이름을 지어 새로 연다
   * @param {object} [o]
   * @param {(id: string) => boolean} [o.피할것]  이름을 지을 때 파일이 없어도 피할 이름
   *        (사냥5 H5-1 — 한 프로세스가 여러 폴더의 대화를 열 때. freeId 머리말)
   */
  constructor(root, id = null, { 피할것 = null } = {}) {
    this.root = root;
    this.dir = sessionsDir(root);
    this.auto = id == null;      // 우리가 지은 이름인가 (그러면 겹칠 때 바꿔도 된다)
    this.피할것 = typeof 피할것 === 'function' ? 피할것 : null;
    this.#use(id ?? freeId(this.dir, new Date(), this.피할것));
    this.opened = false;
    /** 적으려다 못 적은 줄 수와 첫 까닭. 0 이 아니면 이 대화는 반만 남는다. */
    this.못쓴수 = 0;
    this.못쓴까닭 = null;
    this.말한적있나 = false;
    // 이 파일과 묶인 대화, 그리고 그 대화에서 **마지막으로 적어 둔** 할 일·시킨 말.
    // 안 바뀐 것을 다시 적지 않으려고 들고 있는다 (살림적기).
    this.따라갈세션 = null;
    this.적은할일 = null;
    this.적은요청 = null;
  }

  #use(id) {
    this.id = id;
    /*
     * 쓸 수 없는 이름이면 **파일 자리를 안 만든다.** 경로를 지어 두면 그 경로를
     * 쓰는 자리가 하나라도 검사를 빠뜨리는 순간 폴더 밖이 열린다. 없는 자리는
     * 아무도 못 쓴다 — 읽기·적기·갈아 끼우기가 전부 이름틀림 을 보고 물러선다.
     */
    this.이름틀림 = !대화이름인가(id);
    this.file = this.이름틀림 ? null : join(this.dir, `${id}.jsonl`);
    this.#잠갔나 = false;      // 다른 파일로 옮겨 갔으면 그 파일은 아직 안 잠갔다
    this.#끝자리 = null;       // 옮겨 간 파일이 어디까지 적혀 있는지는 아직 모른다
    this.#줄끝봤나 = false;    // 옮겨 간 파일이 줄 끝으로 끝나는지도 아직 안 봤다
  }

  /*
   * ── 같은 대화를 창 두 개가 적고 있나 ────────────────────────────────────
   *
   * `--continue` 로 창을 둘 여는 것은 이상한 짓이 아니다. 한쪽에서 고치는 동안
   * 한쪽에서 물어보려고 흔히 그렇게 한다. 그런데 그때 두 대화가 **한 파일에**
   * 줄줄이 섞여 들어갔다. 섞인 것만도 이어받기가 뒤엉키는데, 한쪽이 접기까지
   * 하면 replace() 가 파일을 통째로 다시 쓰므로 다른 창의 대화는 그 한 번에
   * 없어졌다. 없어진 쪽의 `적은할일`·`적은요청` 은 이미 적었다고 들고 있어서,
   * 남은 할 일과 시킨 말도 두 번 다시 안 적힌다.
   *
   * 그동안 화면은 아무 말이 없었다. 쓰기가 실패한 적이 없으니 못쓴수 가 0 이고,
   * 그래서 「안 적히고 있습니다」 가 한 번도 안 떴다. 사람이 알아차리는 자리는
   * 또 **다음 날 --resume** 이다 — 이 파일 위쪽이 너무 늦다고 적어 둔 그 자리다.
   *
   * 내가 적어 둔 데까지의 바이트 수를 들고 있다가, 적기 전에 파일이 그보다 자라
   * 있으면 남이 쓴 것이다.
   *
   * **우리가 지은 이름의 창도 본다** (2.0.2 · 527). 지은 이름은 freeId 와 'wx' 가
   * 「두 창이 같은 새 이름을 집는 것」 은 막지만, 다른 창이 `--continue` 로 **이 파일을**
   * 집어 오는 것은 못 막는다 — 제일 최근 대화가 바로 이것이다. 그래서 뒤에 연 창만 멈추고
   * 먼저 연 창은 그 창의 줄 사이에 제 줄을 섞어 넣었고, 접으면(replace) 그 창의 줄을
   * 통째로 지웠다. 이제 누가 먼저 적든 **먼저 적은 쪽이 이어 가고 다른 쪽이 멈춘다** —
   * 한 파일에 두 대화가 섞이는 일이 없다. 멈춘 쪽 화면은 「안 적히고 있습니다」 를 말한다.
   *
   * 그러면 **안 적고 센다.** 그냥 이어 붙이는 것은 두 대화를 섞어 놓는 일이고,
   * 섞인 파일은 둘 다 못 쓰게 된다. 대신 잠자코 물러나지는 않는다 — 못쓴 셈에
   * 올려 두면 화면이 바로 다음 줄에 「이 대화가 파일에 안 적히고 있습니다」 를
   * 말한다. 창을 닫기 **전에** 알아야 사람이 손을 쓴다.
   */
  #끝자리 = null;
  /** 지금 파일 크기. 못 재면 null — 모르는 것은 모른다고 둔다(헛경보가 더 나쁘다). */
  #크기() { try { return statSync(this.file).size; } catch { return null; } }
  #남이썼나() {
    if (this.#끝자리 == null) return false;
    const 지금 = this.#크기();
    return 지금 != null && 지금 !== this.#끝자리;
  }

  /*
   * 만든 뒤 본인만 읽게 잠근다 (config.js 가 설정 파일에 하는 것과 같다).
   *
   * 여기 남는 것은 대화 전체다 — 사람이 붙여 넣은 글, 읽은 파일 내용, 모델이
   * 쓴 답. 홈이 공유 폴더에 있거나 같은 PC 를 여럿이 쓰면 그게 그대로 읽힌다.
   * 한 번만 건다. 윈도우(NTFS)에서는 chmod 가 아무 일도 안 한다 — 거기서는
   * 못 잠근 것이지 잠근 척하지 않는다.
   *
   * 건 결과를 `잠금` 에 남긴다. "본인만 읽게 잠근다" 는 말은 지켜지는지
   * **밖에서 볼 수 있어야** 뜻이 있다 (keystore.js 의 마지막명령줄 과 같은
   * 까닭). 윈도우에서 값이 남는다고 실제로 잠겼다는 뜻은 아니다.
   */
  #잠갔나 = false;
  /** 파일 권한을 건 결과. `{모드}` 면 걸었고, `{못함}` 이면 못 걸었다. */
  잠금 = null;
  #잠그기() {
    if (this.#잠갔나) return;
    this.#잠갔나 = true;
    this.잠금 = 본인만잠그기(this.file);
  }

  #open() {
    if (this.opened) return;
    // 폴더를 못 만들어도 여기서 던지지 않는다. 던지면 대화 자체가 그 자리에서
    // 끊긴다 — 기록을 남기려다 작업을 죽이면 본말이 뒤집힌다.
    // 조용히 넘기는 것도 아니다: 폴더가 없으면 바로 아래 쓰기가 깨지고,
    // 그 자리에서 세어 화면에 오른다.
    // 못 만들었으면 **연 것이 아니다.** 연 것으로 적어 두면 잠깐 막혔던 것이
    // 풀린 뒤에도 두 번 다시 안 만들어 본다 — 그 대화는 끝까지 한 줄도 안 남는다.
    try { mkdirSync(this.dir, { recursive: true }); this.opened = true; }
    catch { /* 아래 쓰기가 센다. 다음 줄에서 다시 만들어 본다 */ }
  }

  /*
   * 못 적은 것을 세어 둔다.
   *
   * 이 파일 첫 줄이 파는 문장이 「껐다 켜도 이어서 하게 한다」 이고, /sessions
   * 화면은 대놓고 「지금 대화는 나가지 않아도 계속 저장되고 있습니다」 라고
   * 적어 준다. 디스크가 차거나 홈이 읽기 전용이거나 파일을 누가 잡고 있으면
   * 그 두 문장이 거짓이 되는데, 여태 화면은 아무 말이 없었다.
   *
   * 그 침묵이 비싼 까닭: 사람이 알아차리는 자리가 **다음 날 --resume** 이다.
   * 그때는 이미 대화가 없고, 되돌릴 방법도 없다. 안 적히고 있다는 것만 그때
   * 알았어도 창을 안 닫거나 중요한 것을 따로 적어 뒀을 것이다.
   * 감사기록(safety/audit.js)에서 한 것과 같은 방식으로 세어 둔다.
   */
  #못썼다(err) {
    this.못쓴수 += 1;
    // 까닭은 코드가 먼저다 — EACCES·ENOSPC 한 낱말이 긴 문장보다 알아보기 쉽고,
    // 파일 경로가 섞여 들어가지 않아 화면 한 줄에 들어간다.
    if (!this.못쓴까닭) this.못쓴까닭 = err?.code ?? err?.message ?? String(err);
  }

  /** 저장이 새고 있나. 새고 있으면 `{수, 까닭}`, 멀쩡하면 null. */
  못쓴것() {
    return this.못쓴수 ? { 수: this.못쓴수, 까닭: this.못쓴까닭 } : null;
  }

  /**
   * 화면이 **한 번만** 말하게 하려고 쓴다. 처음 물어볼 때만 알려 주고 그 뒤로는 null.
   *
   * 한 줄 못 적을 때마다 경고를 찍으면 사람은 이틀 만에 그 줄을 안 읽게 되고,
   * 그러면 정작 처음 한 번도 못 읽힌다. 세어 둔 값(못쓴것)은 안 지운다 —
   * /sessions 화면은 언제 열어도 지금 몇 건인지 말해야 한다.
   */
  처음못쓴것() {
    if (!this.못쓴수 || this.말한적있나) return null;
    this.말한적있나 = true;
    return this.못쓴것();
  }

  /**
   * 첫 줄은 머리글 — 어떤 모델·어떤 폴더에서 한 대화인지.
   *
   * 'wx' 로 만든다: 이미 있으면 실패한다. 이름을 확인하고 만드는 사이에
   * 다른 창이 같은 이름을 채 갔을 수 있어서, 그때는 다른 이름으로 옮겨 간다.
   * 사용자가 --resume 으로 이름을 준 경우에는 옮기지 않고 그 파일에 이어 쓴다.
   */
  begin(meta) {
    // 쓸 수 없는 이름이면 머리글도 안 적는다(#use). 저장된다고 말하지 않게 센다.
    if (this.이름틀림) { this.#못썼다({ code: 'BAD_NAME' }); return this; }
    this.#open();
    const head = JSON.stringify({ t: 'meta', at: new Date().toISOString(), ...meta }) + '\n';
    for (let tries = 0; tries < 50; tries++) {
      try {
        writeFileSync(this.file, head, { encoding: 'utf8', flag: 'wx' });
        this.#잠그기();
        this.#끝자리 = this.#크기();
        return this;
      } catch (err) {
        // 못 적어도 대화는 계속돼야 한다. 다만 조용히 넘기지는 않는다 —
        // 머리글을 못 적었으면 그 뒤의 줄도 십중팔구 못 적는다.
        if (err?.code !== 'EEXIST') { this.#못썼다(err); return this; }
        if (!this.auto) {
          // 이어쓰기 — 이미 있는 게 맞다. 다만 **지금 어디까지 적혀 있는지**를
          // 기억해 둔다. 다음에 그보다 자라 있으면 다른 창이 같은 대화를 연 것이다.
          this.#끝자리 = this.#크기();
          return this;
        }
        this.#use(freeId(this.dir, new Date(), this.피할것));   // 누가 채 갔다. 옆자리로.
      }
    }
    // 쉰 번을 다 써도 자리를 못 잡았다. 여기서 잠자코 돌아가면 화면은
    // 「계속 저장되고 있습니다」 라고 말하는데 파일은 하나도 없다.
    this.#못썼다({ code: 'EEXIST' });
    return this;
  }

  /*
   * ── 반쪽 줄 뒤에 이어 적지 않는다 ─────────────────────────────────────────
   *
   * 도중에 죽으면 마지막 줄이 개행 없이 반만 남는다. 읽을 때는 건너뛰니 앞부분은
   * 성하다(이 파일 머리말). 그런데 --resume 으로 그 파일에 이어 적으면 첫 새 줄이
   * 그 반쪽 **뒤에 그대로 붙어** 한 줄이 되고, 그 줄은 JSON 이 아니라 다음에 읽을 때
   * 통째로 건너뛴다 — 이어받은 뒤 사람이 처음 한 말이 조용히 없어졌다.
   * 파일마다 처음 적을 때 한 번, 끝이 개행인지 보고 아니면 개행부터 붙인다.
   */
  #줄끝봤나 = false;

  /** 한 줄 적는다. 적었으면 true. 못 적었으면 false 이고 셈에 오른다. */
  #write(obj) {
    // 쓸 수 없는 이름이면 파일 자리가 없다(#use). 적은 척하지 않고 센다.
    if (this.이름틀림) { this.#못썼다({ code: 'BAD_NAME' }); return false; }
    let 줄 = JSON.stringify(obj) + '\n';
    // 남이 같은 파일을 적고 있으면 여기서 선다 (위 「같은 대화를 창 두 개가」).
    if (this.#남이썼나()) { this.#못썼다({ code: 'OTHER_WINDOW' }); return false; }
    try {
      if (!this.#줄끝봤나) {
        if (!줄로끝나나(this.file)) 줄 = '\n' + 줄;
        this.#줄끝봤나 = true;
      }
      appendFileSync(this.file, 줄, 'utf8');
      this.#잠그기();
      // 적은 만큼만 더한다. 다시 재지 않는 것은 이게 줄마다 도는 자리여서다.
      this.#끝자리 = this.#끝자리 == null ? this.#크기() : this.#끝자리 + Buffer.byteLength(줄, 'utf8');
      return true;
    } catch (err) {
      /*
       * 막혔으면 끝을 다시 보게 되돌린다 (2.0.0 6회차 · Gemini 저장6w-a2 X1). 본 표시를
       * 적기 **전에** 세워서, 첫 적기가 막히면(읽기 전용 · 잠김 · 디스크 가득) 다음 줄이
       * 반쪽 줄 뒤에 그대로 붙었다 — 그 줄은 적었다고 true 를 돌려주고 셈에도 안 오르는데,
       * 다시 읽으면 JSON 이 아니라 사라진다. 반쯤 적히고 막힌 경우도 그 반쪽을 다음에 본다.
       */
      this.#줄끝봤나 = false;   // 막혔으니 다음 적기에서 끝을 다시 본다
      this.#못썼다(err);
      return false;   // 계속은 하되, 몇 줄을 잃었는지는 센다
    }
  }

  // 메시지 하나를 덧붙인다. 대화가 진행되는 대로 즉시 남긴다.
  append(msg) {
    this.#open();
    this.#write({ t: 'msg', m: msg });
    // 남은 할 일과 시킨 말도 이 자리에서 같이 본다 (아래 살림적기).
    // 따로 부르는 자리를 만들면 언젠가 한 길에서만 부르게 되고, 그 길로 들어온
    // 사람만 이어하기가 반쪽이 된다.
    this.살림적기();
  }

  /*
   * ── 남은 할 일과 시킨 말 원문 ──────────────────────────────────────────
   *
   * 1.9.2 는 **한 대화 안에서** 이 둘이 접히거나 줄어들며 사라지던 것을 막았다
   * (session.js 의 못박을것). 그런데 둘 다 세션 객체, 곧 메모리에만 있어서
   * 창을 닫는 한 번에 그 보호가 통째로 없어졌다 — 이어받으면 오간 말은 돌아오고
   * 못 박은 것도 돌아오는데, 남은 할 일과 시킨 말 원문만 안 돌아온다.
   * 「요청사항이 많으면 몇 개 까먹는다」 가 껐다 켜는 자리에서 되풀이된다.
   *
   * 메시지와 따로 한 줄로 두는 이유는 pins 와 같다 — 접기·요약은 메시지를
   * 손보는데 이 둘은 그 손질에 닿으면 안 된다. 마지막 것이 이긴다.
   */

  /**
   * 이 대화의 할 일·시킨 말을 이 저장 파일과 묶는다.
   *
   * 처음 묶을 때 파일에 적힌 것을 세션으로 되살린다 — 이어하기의 빠져 있던
   * 절반이 여기다. 그 뒤로는 append 가 돌 때마다 **바뀐 만큼만** 적는다.
   */
  살림따라가기(session) {
    if (!session) return this;
    const 처음 = this.따라갈세션 !== session;
    this.따라갈세션 = session;
    if (처음) this.#살림되살리기(session);
    return this;
  }

  #살림되살리기(session) {
    const { 할일, 이번요청 } = this.load();
    // 적힌 것이 없으면 세션이 들고 있던 것을 그대로 둔다. 빈 값으로 덮으면
    // 새 갈래를 열자마자 방금 시킨 말이 사라진다 — 갈래마다 파일이 따로다.
    if (할일) session.할일 = 할일;
    // `if (이번요청)` 이었다 — 파일에 적힌 **빈 글**(`''`)을 못 되살렸다 (8회차 판정).
    // 아래 507–508 이 적어 둔 대로 `null` 은 「적힌 적이 없다」 이고 `''` 는 「빈 것으로
    // 적혔다」 다. 그 둘을 가르기로 해 놓고 여기서만 안 갈랐다.
    if (이번요청 != null) session.이번요청 = 이번요청;
    /*
     * 표식은 **파일에 적힌 것**으로 세운다 (8회차 판정).
     *
     * 여기가 `JSON.stringify(session.할일 ?? [])` 였다. 세션 값으로 세우면, 파일에
     * 한 줄도 안 적고 「여기까지 적었다」 고 표시한 것이 된다. 그러면 뒤이은
     * `살림적기` 가 「안 바뀜」 으로 보고 **영영 안 적는다** — 그 갈래의 남은 할 일과
     * 시킨 말이 통째로 사라진다. 바로 아래 살림적기 머리말이 적어 둔 그 길이다.
     *
     * 파일이 빈 것과 세션이 빈 것이 같을 때는 아무것도 안 적는다 — 「안 바뀌었으면
     * 한 줄도 안 늘린다」 는 약속은 그대로 지킨다.
     */
    this.적은할일 = JSON.stringify(할일 ?? []);
    this.적은요청 = String(이번요청 ?? '');
  }

  /**
   * 바뀐 것만 적는다. 안 바뀌었으면 한 줄도 안 늘린다.
   *
   * 메시지마다 목록을 통째로 다시 적으면 긴 대화에서 파일이 몇 배가 되고,
   * 그 값은 매번 사람이 기다리는 시간이다. pins 를 사람이 고칠 때만 적는
   * 것과 같은 뜻이다.
   */
  /*
   * 적은 것으로 치는 것은 **정말 적힌 뒤**다.
   *
   * 못 적었는데 적은 셈으로 표시해 두면, 디스크가 다시 나아져도 그 값은 이미
   * 「안 바뀐 것」 이라 두 번 다시 안 적힌다. 잠깐 막혔던 것이 영영 사라지는
   * 자리다 — 여기가 바로 남은 할 일과 시킨 말이 조용히 없어지던 길이다.
   */
  살림적기(session = this.따라갈세션) {
    if (!session) return;
    const 할일 = JSON.stringify(session.할일 ?? []);
    if (할일 !== this.적은할일
      && this.#write({ t: 'todo', at: new Date().toISOString(), 목록: session.할일 ?? [] })) {
      this.적은할일 = 할일;
    }
    const 요청 = String(session.이번요청 ?? '');
    if (요청 !== this.적은요청
      && this.#write({ t: 'request', at: new Date().toISOString(), 글: 요청 })) {
      this.적은요청 = 요청;
    }
  }

  /**
   * 못 박은 것을 적어 둔다. 통째로 한 줄 — 마지막 것이 이긴다.
   *
   * 메시지와 따로 두는 이유는 pins.js 에 적은 것과 같다. 접기·요약은 메시지를
   * 손보는데, 못 박은 것은 그 손질에 닿으면 안 된다.
   */
  못박기목록(목록) {
    this.#open();
    this.#write({ t: 'pins', at: new Date().toISOString(), 목록: 목록 ?? [] });
  }

  /** 마지막으로 적힌 못 박은 것. 없으면 빈 배열. */
  못박은것읽기() {
    if (!existsSync(this.file)) return [];
    let 마지막 = [];
    try {
      for (const line of readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.includes('"t":"pins"')) continue;
        try {
          const j = JSON.parse(line);
          if (j.t === 'pins' && Array.isArray(j.목록)) 마지막 = j.목록;
        } catch { /* 깨진 줄은 건너뛴다 */ }
      }
    } catch { return []; }
    return 마지막;
  }

  // 압축이 일어나면 이력이 통째로 바뀐다. 그때는 새로 적는다.
  replace(messages, note = '압축') {
    /*
     * 다른 창이 같은 파일을 적고 있으면 **여기가 제일 크게 잃는 자리**다.
     * 아래는 파일을 통째로 갈아 끼우므로, 그 한 번에 남의 대화가 통째로
     * 없어진다. 이어 붙이기와 달리 되돌릴 조각조차 안 남는다. 안 쓰고 센다.
     */
    if (this.이름틀림) { this.#못썼다({ code: 'BAD_NAME' }); return; }   // 파일 자리가 없다(#use)
    if (this.#남이썼나()) { this.#못썼다({ code: 'OTHER_WINDOW' }); return; }
    this.#open();
    const meta = this.readMeta() ?? {};
    // 여기가 놓치기 쉬운 자리다. 파일을 새로 쓰면서 못 박은 것을 안 옮기면,
    // '요약해도 안 지워진다' 는 말이 바로 그 요약에서 거짓이 된다.
    const 못박은것 = this.못박은것읽기();
    // 남은 할 일과 시킨 말 원문도 같은 이유로 옮겨 싣는다. 접힌 자리에서
    // 다시 박으라고 들고 있는 것들인데, 정작 접는 자리에서 파일에서 빠지면
    // 이어받을 때 그 둘만 없는 대화가 된다.
    //
    // 옮겨 싣기 **전에** 아직 안 적은 것을 먼저 적는다. 여기서 파일만 보고
    // 옮기면, 메시지가 한 번도 안 붙은 사이에 할 일이 바뀐 경우 그 바뀐 것이
    // 통째로 사라진다 — 접는 자리는 원래 제일 크게 잃는 자리다.
    this.살림적기();
    const { 할일, 이번요청 } = this.load();
    const lines = [JSON.stringify({ t: 'meta', at: new Date().toISOString(), ...meta })];
    lines.push(JSON.stringify({ t: 'note', at: new Date().toISOString(), note }));
    if (못박은것.length) lines.push(JSON.stringify({ t: 'pins', at: new Date().toISOString(), 목록: 못박은것 }));
    if (할일) lines.push(JSON.stringify({ t: 'todo', at: new Date().toISOString(), 목록: 할일 }));
    // `if (이번요청)` 이었다 — 빈 글(`''`)이 옮겨지지 않아 replace() 를 지나면 null 로 변질됐다 (8회차 판정).
    if (이번요청 != null) lines.push(JSON.stringify({ t: 'request', at: new Date().toISOString(), 글: 이번요청 }));
    for (const m of messages) lines.push(JSON.stringify({ t: 'msg', m }));
    /*
     * 옆에 다 쓰고 나서 **한 번에 갈아 끼운다.**
     *
     * 이 파일 머리말이 jsonl 을 고른 까닭이 「통째로 다시 쓰면 그 순간 파일이
     * 깨진다」 인데, 정작 통째로 다시 쓰는 자리가 여기다. 디스크가 반쯤 쓰다
     * 차면 원본은 이미 잘려 있고 새것은 안 끝났다 — 그 한 번에 대화 전체가
     * 없어진다. 옆에 써 두고 이름만 바꾸면 성한 쪽 아니면 성한 쪽이다.
     *
     * 실패하면 옆에 쓴 것을 치운다. 안 치우면 폴더에 부스러기가 쌓이고,
     * 다음에 볼 사람은 그게 대화인지 찌꺼기인지 모른다.
     */
    const 옆 = `${this.file}.새로`;
    try {
      writeFileSync(옆, lines.join('\n') + '\n', 'utf8');
      // 윈도우에서는 읽기 전용 파일 위로 이름을 못 바꾼다. 우리 파일이니 푼다.
      try { chmodSync(this.file, 0o600); } catch { /* 없거나 이미 쓸 수 있다 */ }
      renameSync(옆, this.file);
      this.#잠갔나 = false;
      this.#잠그기();
      this.#끝자리 = this.#크기();      // 통째로 바뀌었으니 어디까지인지도 다시 잰다
    } catch (err) {
      try { rmSync(옆, { force: true }); } catch { /* 못 치워도 원본은 성하다 */ }
      this.#못썼다(err);
    }
  }

  readMeta() {
    if (!existsSync(this.file)) return null;
    try {
      // 머리글 줄도 BOM 을 떼고 본다 — 까닭은 load() 에.
      const first = BOM떼기(readFileSync(this.file, 'utf8')).split('\n', 1)[0];
      const j = JSON.parse(first);
      return j.t === 'meta' ? j : null;
    } catch { return null; }
  }

  /**
   * 저장된 대화를 읽어 온다. 깨진 줄은 건너뛴다 — 도중에 죽었을 수 있다.
   *
   * 파일을 아예 못 여는 경우(권한, 다른 프로그램이 잡고 있음)에도 던지지 않는다.
   * 이 함수는 list() 가 폴더의 대화를 하나씩 훑으면서 부른다. 한 파일에서
   * 던지면 **목록 화면 전체가 안 뜨고**, 멀쩡히 이어할 수 있는 나머지 대화까지
   * 사람 눈에서 사라진다. 못 읽은 것은 못읽음 에 까닭을 담아 알린다.
   */
  load() {
    if (!existsSync(this.file)) return { meta: null, messages: [] };
    let 글;
    /*
     * BOM 을 떼고 읽는다. 윈도우 메모장이나 파워셸로 대화 파일을 열었다 저장하면 첫 줄 앞에
     * BOM 이 붙고, 그 줄(머리글)이 JSON 으로 안 풀려 목록의 모델이 `?` 가 됐다. 접을 때
     * replace() 는 readMeta() 로 머리글을 옮기므로 모델·폴더가 **없는** 머리글을 새로 썼다.
     */
    try { 글 = BOM떼기(readFileSync(this.file, 'utf8')); }
    catch (err) { return { meta: null, messages: [], 못읽음: err?.code ?? err?.message ?? String(err) }; }
    let meta = null;
    const messages = [];
    // 마지막 것이 이긴다. 없으면 null 이고, null 은 '적힌 적이 없다' 는 뜻이라
    // 빈 목록·빈 글과 구별된다 — 되살릴 때 그 차이로 덮을지 말지를 정한다.
    let 할일 = null;
    let 이번요청 = null;
    for (const line of 글.split('\n')) {
      if (!line.trim()) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.t === 'meta') meta = j;
      else if (j.t === 'msg' && j.m) messages.push(j.m);
      else if (j.t === 'todo' && Array.isArray(j.목록)) 할일 = j.목록;
      else if (j.t === 'request' && typeof j.글 === 'string') 이번요청 = j.글;
    }
    return { meta, messages, 할일, 이번요청 };
  }
}

// 사람에게 보여줄 첫 마디. 이게 목록에서 대화를 알아보는 유일한 단서다.
function firstAsk(messages) {
  const 쓸만한 = messages.filter((x) => x.role === 'user' && typeof x.content === 'string' && x.content.trim());
  /*
   * 대괄호로 여는 것은 우리가 끼워 넣은 글이라 건너뛴다. 그런데 사람도
   * 「[급함] 로그인이 안 됩니다」 처럼 적는다 — 그 대화는 목록에서 「(빈
   * 대화)」 가 됐다. 있는 대화를 없다고 적은 것이다.
   *
   * 그래서 건너뛰되, 남는 것이 하나도 없으면 첫 마디를 그대로 쓴다.
   * 알아보기 어려운 제목이 「빈 대화」 라는 거짓말보다 낫다.
   */
  /*
   * 건너뛰는 자를 **한 줄 통째**로 좁힌다 (2.0.0 8회차 판정).
   *
   * `startsWith('[')` 하나로는 두 가지가 같이 틀렸다.
   *
   *   1. 사람이 「[급함] 로그인이 안 됩니다」 로 열고 한 마디를 더 하면, 첫 마디를
   *      건너뛰고 **둘째 마디**가 제목이 된다 — 처음 물은 것이 목록에서 사라진다.
   *      위 문단이 「남는 것이 없으면」 만 보았지, 남는 것이 있을 때는 그대로였다.
   *   2. 남는 것이 없을 때 `?? 쓸만한[0]` 이 **우리가 끼운 글**을 제목으로 골랐다.
   *      사람이 한 적 없는 말이 그 대화의 이름이 됐다.
   *
   * 가르는 자리는 분명하다 — 우리가 끼우는 글은 **첫 줄이 통째로 대괄호**다.
   * 사람이 적는 「[급함] …」 은 닫는 괄호 뒤에 할 말이 이어진다.
   */
  const 통째괄호 = (글) => /^\[[^\]\n]*\]\s*$/.test(String(글).trim().split(String.fromCharCode(10))[0]);
  /*
   * 우리가 끼우는 글은 이 둘뿐이다 (compact.js 의 접은 요약 · commands.js 의 딴 모델 답).
   * 늘리면 여기도 같이 늘린다 — 안 늘리면 그 글이 대화 이름으로 뜬다.
   */
  const 우리글 = [/^\[앞선 대화 .*요약해 접었습니다/, /^\[.* 에게 따로 물어본 결과다/];
  const 우리가끼운것 = (글) => 우리글.some((r) => r.test(String(글).trim()));
  const m = 쓸만한.find((x) => !통째괄호(x.content))
    ?? 쓸만한.find((x) => !우리가끼운것(x.content))
    ?? null;
  return m ? m.content.replace(/\s+/g, ' ').trim() : '(빈 대화)';
}

/**
 * 이 폴더에 남아 있는 대화 목록. 최근 것이 위로.
 */
/**
 * 지난 대화 목록.
 *
 * **먼저 정렬하고 나서 필요한 것만 읽는다.** 순서가 중요하다.
 *
 * 전에는 폴더에 있는 파일을 **전부 열어서** 한 줄씩 JSON 으로 풀고, 그 다음에
 * 정렬해서 20개만 남겼다. 몇 주 쓰면 수십 MB 를 매번 읽는 셈이다. 그리고 이건
 * 켤 때마다 돈다(repl 이 prune 을 부른다) — 머리글도 안 뜬 채로 몇 초씩 멈춰
 * 있어서, 사용자 눈에는 프로그램이 죽은 것처럼 보인다.
 *
 * 정렬에 필요한 것은 파일 시각뿐이고, 그건 안 열어도 안다.
 *
 * @param {object} o
 * @param {boolean} o.속까지  false 면 파일을 안 열고 시각·크기만 본다 (prune 용)
 */
export function list(root, { limit = 20, 속까지 = true } = {}) {
  const dir = sessionsDir(root);
  if (!existsSync(dir)) return [];

  // 1) 시각만 모은다. 파일을 열지 않는다.
  const 후보 = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const file = join(dir, name);
    let st;
    try { st = statSync(file); } catch { continue; }
    후보.push({ id: name.slice(0, -6), file, at: st.mtime, bytes: st.size });
  }
  후보.sort((a, b) => b.at - a.at);

  if (!속까지) return 후보.slice(0, limit);

  // 2) 앞에서부터 필요한 개수만 실제로 읽는다.
  const out = [];
  for (const c of 후보) {
    if (out.length >= limit) break;
    const 줄 = 한줄(root, c);
    if (줄) out.push(줄);
  }
  return out;
}

/**
 * 후보 하나를 열어 목록 한 줄로 만든다. 빈 파일이면 null.
 *
 * **못 읽은 것은 없는 것이 아니다.**
 *
 * load() 는 까닭을 담아 돌려주는데 부르는 쪽이 그것을 버리고 있었다. 그래서
 * 권한이 막히거나 다른 프로그램이 잡고 있는 대화는 목록에서 통째로 사라졌고,
 * 그런 것뿐이면 화면은 「아직 없습니다. 지금 이 대화가 첫 번째입니다」 라고
 * 말했다 — 어제 한 일이 그대로 있는데 없다고 한 것이다. 이어할 수는 없어도
 * **거기 있다는 것**은 말해야 사람이 손을 쓴다.
 */
function 한줄(root, c) {
  const { meta, messages, 못읽음 } = new Store(root, c.id).load();
  if (못읽음) {
    return { ...c, 못읽음, model: '?', turns: 0, messages: 0, first: `못 읽었습니다 — ${못읽음}` };
  }
  if (!messages.length) return null;      // 빈 파일은 목록에 안 올린다
  return {
    ...c,
    model: meta?.model ?? '?',
    /*
     * 「몇 번 오갔나」 는 **사람이 몇 번 말을 걸었나** 다.
     *
     * 어제 세 가지를 물어본 대화가 목록에 `43번 오감` 으로 떠 있었다. 사람은
     * 그 숫자로 「어느 것이 그 긴 대화였나」 를 고르는데, 도구를 많이 쓴 짧은
     * 대화가 언제나 제일 길어 보였다 — 고르라고 적어 둔 숫자가 거꾸로 가리킨 것이다.
     *
     * 까닭은 `role` 만 본 것이다. Anthropic 규격에는 도구 차례가 따로 없어서
     * 결과가 **사람 차례**에 실려 온다(backend/adapter.js 의 toolMessage).
     * 그래서 도구 결과 한 건이 그대로 사람 한 마디로 세어졌다. 바로 위
     * firstAsk 는 이미 글인지를 보고 있었는데, 여기만 옛 모양으로 남아 있었다.
     *
     * 규격마다 다른 자리를 보는 것은 우리 몫이 아니다 — 그 판단은 adapter.js
     * 한 곳에만 둔다. session.js·compact.js 가 같은 함정을 같은 함수로 닫았다.
     */
    turns: messages.filter((m) => m.role === 'user' && !도구결과인가(m)).length,
    messages: messages.length,
    first: firstAsk(messages),
  };
}

export function remove(root, id) {
  /*
   * 이름에 상위 경로가 섞이면 대화 폴더 **밖**을 지운다.
   * `deel sessions --rm ../../어딘가` 는 화면에 「지웠습니다」 라고 적고
   * 엉뚱한 파일을 없앤다 — 무엇을 지웠는지 사람이 못 알아본다.
   */
  if (!/^[^\\/:*?"<>|]+$/.test(String(id)) || String(id).includes('..')) {
    return { error: `대화 이름이 아닙니다: ${id}` };
  }
  const f = join(sessionsDir(root), `${id}.jsonl`);
  if (!existsSync(f)) return { error: `그런 대화가 없습니다: ${id}` };
  try { rmSync(f, { force: true }); }
  catch (err) { return { error: `못 지웠습니다: ${id} — ${err?.code ?? err?.message ?? String(err)}` }; }
  return { removed: id };
}

/**
 * 가장 최근 대화. --continue 가 집어 오는 것.
 *
 * 못 읽는 것은 건너뛴다. 그것을 집어 오면 --continue 가 **빈 대화**로 열리고,
 * 사람은 어제 하던 것이 이어진 줄 알고 말을 건다.
 */
export function latest(root) {
  /*
   * **한 개씩 열어 보고 첫 성한 것에서 멈춘다.**
   *
   * `list(root, { limit: 20 })` 로 스무 개를 통째로 읽으면 안 된다 — 이 파일이
   * 위에서 경고한 그 자리다. 대화 파일 하나가 수 MB 이고, 이건 켤 때마다 돈다.
   * 보통은 첫 파일 하나만 읽고 끝난다.
   *
   * **개수로는 끊지 않는다** (2.0.0 6회차 · Gemini 저장6w-b2 Y4). 20 에서 끊었더니, 터미널을
   * 켜자마자 · 에디터가 새 대화 창을 열 때마다 적히는 머리글만 있는 파일이 스물 넘게 쌓이면
   * 어제 대화가 그대로 있는데 --continue 가 「이어갈 대화가 없다」 가 됐다. 그런 파일은
   * 몇십 바이트라 끝까지 훑어도 싸고, 성한 것을 만나면 거기서 멈춘다.
   */
  for (const c of list(root, { limit: Infinity, 속까지: false })) {
    const 줄 = 한줄(root, c);
    if (줄 && !줄.못읽음) return 줄;
  }
  return null;
}

/**
 * 오래된 것은 정리한다. 안 그러면 폴더가 끝없이 자란다.
 * 최근 keep 개는 무조건 남기고, 그보다 오래되고 days 를 넘긴 것만 지운다.
 */
export function prune(root, { keep = 30, days = 30, 남길것 = [] } = {}) {
  /*
   * 지울지 말지는 파일 시각만 보면 안다. 내용은 필요 없다 —
   * 여기서 전부 읽던 것이 켤 때 몇 초씩 멈추던 원인이었다.
   *
   * 개수를 1000 으로 끊어 놓으면 정작 **제일 오래된 것들**이 그 뒤에 있어서
   * 영영 안 지워진다. 폴더가 끝없이 자라지 말라고 있는 함수가 딱 그 일을
   * 못 하게 된다. 열지도 않고 시각만 보는 목록이라 전부 봐도 싸다.
   */
  /*
   * ── 지금 쓰는 대화는 시각과 상관없이 남긴다 (사냥5 H5-2) ─────────────────
   *
   * 한 달 넘은 대화를 --resume · session/load 로 이어받으면, 그 파일은 **아직 한 줄도
   * 안 늘어서** 시각이 한 달 전 그대로다. 그리고 두 문 다 이어받기 바로 뒤에 여기를
   * 부른다. 그래서 방금 이어받은 파일이 지워졌고, 다음 한 줄은 머리글도 옛 대화도
   * 없는 새 파일에 적혔다 — 화면에는 「이어 받았습니다」 가 떠 있는데. 부르는 쪽이
   * 열어 둔 대화 이름을 넘기면 그것은 안 지운다.
   */
  const 지킬것 = new Set([...(남길것 ?? [])].map(String));
  const all = list(root, { limit: Infinity, 속까지: false });
  const 자를것 = all.slice(keep)
    .filter((s) => !지킬것.has(s.id))
    .filter((s) => (Date.now() - s.at.getTime()) > days * 86400000);
  // 지웠다고 세는 것은 **정말 지워진 것**만이다.
  let 지운수 = 0;
  for (const s of 자를것) { try { rmSync(s.file, { force: true }); 지운수 += 1; } catch { /* 잡혀 있으면 다음에 */ } }
  return 지운수;
}
