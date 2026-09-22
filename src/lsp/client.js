/**
 * 언어 서버 하나를 띄워 놓고 물어보는 자리.
 *
 * ── 왜 붙이나 ───────────────────────────────────────────────────────────
 *
 * Grep 은 **글자**를 찾고 언어 서버는 **뜻**을 안다. 이 차이가 어디서 나는지는
 * `handle` 같은 이름을 한 번 고쳐 보면 안다. Grep 은 주석에 든 handle, 남의
 * 라이브러리의 handle, 문자열 안의 handle 을 다 같이 준다. 그중 진짜 그 함수를
 * 부르는 자리가 몇 개인지는 사람이 하나씩 열어 봐야 안다 — 모델은 그 값을 못
 * 치르니까 대충 몇 개만 보고 고치고, 놓친 자리는 돌려 본 뒤에야 드러난다.
 *
 * 그렇다고 Grep 을 밀어내지 않는다. 언어 서버가 없는 자리가 더 많고(사내망이
 * 대개 그렇다), 있어도 못 읽는 파일이 있다. 그래서 Def·Refs 는 **더해 주는**
 * 것이지 갈아 끼우는 것이 아니다. 서버가 없으면 그 두 도구는 목록에 아예 안
 * 나오고, 지금까지 하던 대로 Grep·Outline 으로 간다.
 *
 * ── 여기서 제일 조심한 것: 안 멈추게 하는 것 ────────────────────────────
 *
 * 언어 서버는 남의 프로그램이다. 답을 안 줄 수도 있고, 켜다 죽을 수도 있고,
 * 죽은 척하며 살아 있을 수도 있다. 그런데 이쪽은 사람이 쳐 놓고 기다리는
 * 대화창이다. 여기서 한 번 멎으면 사용자가 할 수 있는 일은 Ctrl+C 뿐이다.
 *
 * 그래서 **모든 물음에 시한이 있다.** 시한이 지나면 답 대신 '못 받았다' 를
 * 내주고 그대로 넘어간다. 켜다 실패하면 그 언어는 이 세션 동안 다시 안 켠다 —
 * 안 그러면 부를 때마다 몇 초씩 까먹는다. 프로세스는 셋 다(정상 종료·시한 초과
 * ·부모 종료) 반드시 정리한다. 유령이 남으면 사용자 컴퓨터에 남는다.
 */
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { 갈래, 고르기, 언어아이디 } from './servers.js';
import { 틀, 받개 } from './rpc.js';
import { 신호에거두기, 다시보낼까 } from '../reap.js';

// 켜는 데 이만큼 넘게 걸리면 포기한다. rust-analyzer 처럼 무거운 것도
// **악수(initialize)** 자체는 빠르다 — 오래 걸리는 것은 그 뒤의 색인이다.
const 켜기시한 = 20_000;
// 물음 하나의 시한. 색인 중이면 늦게 오는데, 그렇다고 대화창을 잡아 둘 수 없다.
const 물음시한 = 15_000;
// 아무도 안 쓰면 이만큼 뒤에 끈다. 언어 서버는 메모리를 꽤 먹는다.
const 놀림시한 = 5 * 60_000;

let _다음번호 = 0;

/**
 * 주소를 견줄 수 있는 하나의 꼴로 만든다.
 *
 * 같은 파일을 서버와 우리가 다르게 적는다. 우리는 `file:///C:/…` 이고
 * pyright 은 `file:///c%3A/…` 다 — 드라이브 글자를 소문자로 쓰고 콜론을
 * 퍼센트로 감싼다. 글자로 견주면 **영영 안 맞는다.**
 *
 * 이게 조용히 아픈 자리였다. 진단은 제대로 오는데 우리 표에서 못 찾으니
 * '안 왔다' 가 되고, 고친 뒤 진단이 아무 말도 안 하게 된다. 아무 말도 안 하는
 * 것이 '성하다' 는 뜻이라 — 틀린 것을 성하다고 말하는 셈이 된다.
 *
 * 그래서 주소가 아니라 **경로**로 견준다. 윈도우는 대소문자를 안 가리므로
 * 거기서만 소문자로 눕힌다.
 */
function 열쇠주소(uri) {
  try {
    const p = fileURLToPath(uri);
    return process.platform === 'win32' ? p.toLowerCase() : p;
  } catch {
    return String(uri ?? '');
  }
}

export class 언어서버 {
  /**
   * @param 뿌리 작업 폴더. 서버의 workspace 가 된다 — 이 밖은 안 본다.
   * @param 고른것 servers.js 의 고르기() 가 준 것
   */
  constructor(뿌리, 고른것) {
    this.뿌리 = 뿌리;
    this.서버 = 고른것;
    this.아이 = null;
    this.받개 = null;
    this.기다림 = new Map();      // id → {풀기, 시계}
    this.진단 = new Map();        // uri → [진단…]
    this.진단판 = new Map();      // uri → 그 진단이 몇 판 것인가 (진단기다리기 참고)
    this.연것 = new Map();        // uri → 판 번호
    this.준비 = null;             // 켜는 중이면 그 약속
    this.죽음 = null;             // 못 켠 이유. 차 있으면 다시 안 켠다
    this.능력 = {};
    this.놀림시계 = null;
    this.끄는중 = false;
    this.켜진때 = 0;             // 색인이 아직 안 끝났을 만한 때인지 재는 데 쓴다
    this.기다리는진단 = 0;       // 진단을 기다리는 중인 파일 수 (#잡기·#놓기 참고)
    this.셸로띄움 = false;       // cmd.exe 를 거쳐 띄웠나 — 그러면 나무째 거둔다 (#거두기)
  }

  /**
   * 이 아이가 아직 살아 있나.
   *
   * `signalCode` 도 같이 본다. 신호로 죽으면 node 는 **exitCode 를 null 로 두고**
   * 신호 이름만 signalCode 에 담는다 — 그러면 종료 코드만 보는 잣대에는 「아직 안
   * 끝났다」 로 보인다. `killed` 도 소용없다. 그건 우리가 `아이.kill()` 을 불렀을
   * 때만 서는 깃발이라, 밖에서 온 것(OOM 킬러 · 남이 보낸 taskkill · 부모 셸이
   * 거둔 것)에는 안 선다.
   *
   * 죽은 서버를 살았다고 하면 다시 안 켜고 그대로 물어본다 — 물음마다 시한까지
   * 기다렸다 빈손으로 오고, 화면에는 「언어 서버가 늦다」 로만 뜬다.
   */
  살았나() {
    return !!this.아이 && this.아이.exitCode === null && this.아이.signalCode == null && !this.아이.killed;
  }

  // ── 켜기 ──────────────────────────────────────────────────────────────

  async 켜기() {
    if (this.죽음) return false;              // 한 번 실패한 것은 다시 안 켠다
    if (this.살았나() && this.능력.ready) return true;
    if (this.준비) return await this.준비;
    this.준비 = this.#켜기실제().finally(() => { this.준비 = null; });
    return await this.준비;
  }

  async #켜기실제() {
    try {
      this.받개 = 받개();

      /*
       * 윈도우에서 npm 이 전역으로 깐 것은 `.cmd` 라 그냥은 안 뜬다.
       *
       * shell: true 로 넘기면 되긴 하는데, node 가 그 조합에 경고를 낸다
       * (DEP0190 — 인자가 안 감싸진 채로 이어 붙는다). 경고가 화면에 섞이는
       * 것도 문제지만, 그 지적이 맞다 — 경로에 빈칸이 있으면 그대로 깨진다.
       * 그래서 셸이 정말 필요한 것(.cmd·.bat)만 골라서 cmd.exe 로 직접 부르고,
       * 나머지는 셸 없이 그대로 띄운다.
       */
      const 실행 = this.서버.경로 ?? this.서버.cmd;
      const 셸필요 = process.platform === 'win32' && /\.(cmd|bat)$/i.test(실행);
      /*
       * `cmd /s /c` 는 뒤에 오는 것이 따옴표로 시작해서 따옴표로 끝나면
       * **그 바깥 한 쌍을 떼어 낸다.** 그래서 한 쌍만 두르면
       *   "C:\...\x.CMD" "--stdio"  →  C:\...\x.CMD" "--stdio
       * 가 되어 통째로 깨진다. 실제로 깨졌다 — cmd 가 "경로가 아닙니다" 하고
       * 코드 1로 죽는데, 겉에서 보이는 것은 "언어 서버가 없습니다" 뿐이다.
       * 있다고 해 놓고 안 되는, 제일 알아채기 어려운 꼴이다.
       *
       * 그래서 한 겹 더 두른다. 바깥 한 쌍을 떼고 나면 원하던 모양이 남는다.
       */
      const 몰아쓰기 = `""${실행}" ${this.서버.args.map((a) => `"${a}"`).join(' ')}"`;
      this.셸로띄움 = 셸필요;
      this.아이 = 셸필요
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 몰아쓰기], {
            cwd: this.뿌리,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsVerbatimArguments: true,
            windowsHide: true,
          })
        : spawn(실행, this.서버.args, {
          cwd: this.뿌리,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });

      /*
       * 이 아이가 **프로그램을 붙잡고 있으면 안 된다.**
       *
       * 서버는 고칠 때 뒤에서 저절로 데워진다(diag.js 의 데우기). 그래서 사용자가
       * 아무것도 안 시켰는데도 떠 있을 수 있는데, node 는 살아 있는 자식과 그
       * 파이프가 있으면 할 일이 없어도 안 끝난다. 그러면 `deel run 한마디` 가
       * 답을 다 내놓고도 프롬프트로 안 돌아온다 — 멎은 것처럼 보인다.
       *
       * unref 는 '이것 때문에 기다리지는 마라' 는 뜻이다. 대화가 도는 동안에는
       * 대화 쪽이 잡고 있으니 아무 차이가 없고, 할 일이 없어졌을 때만 티가 난다.
       * 끄는 것은 따로 한다(모두끄기) — 이건 못 끄고 나갈 때의 그물이다.
       */
      this.#놓기();

      /*
       * 파이프마다 손을 달아 둔다.
       *
       * 아이가 죽는 **바로 그때** 쓰면 EPIPE 가 비동기로 터진다. 그 찰나에는
       * `stdin.writable` 이 아직 true 라 #보내기 의 검사도, 그 안의 try/catch 도
       * 못 막는다 — 오류가 한 박자 뒤에 소켓에서 튀어나오기 때문이다. 손이
       * 없으면 그것을 아무도 안 받아서 **deel 이 통째로 죽는다.** 언어 서버가
       * 죽었을 뿐인데 하던 답이 그 자리에서 날아간다.
       */
      for (const 관 of [this.아이.stdin, this.아이.stdout, this.아이.stderr]) 관?.on('error', () => {});

      /*
       * 이 손은 **이 아이**의 것이다.
       *
       * exit 은 kill() 뒤에 한 박자 늦게 온다. 그 사이에 다시 켜면 옛 아이의
       * exit 이 새 아이를 무너뜨린다 — 「서버가 스스로 끝났습니다」 라고 적고
       * 죽음을 세워서, 멀쩡한 서버를 세션이 끝날 때까지 못 쓰게 만든다.
       * 그러면 Def·Refs 는 「언어 서버가 이 자리에 없습니다」 라고 하고,
       * 고친 뒤 진단은 조용해진다 — 이 프로그램에서 조용한 것은 성하다는 뜻이다.
       */
      const 이아이 = this.아이;
      const 내아이인가 = () => this.아이 === 이아이;
      this.아이.on('error', (e) => { if (내아이인가()) this.#무너짐(`못 띄웠습니다: ${e.message}`); });
      this.아이.on('exit', (code) => {
        // 우리가 끈 것이 아니면 무너진 것이다. 기다리던 물음을 다 풀어 준다 —
        // 안 풀면 그 자리에서 시한까지 통째로 멎는다.
        if (내아이인가() && !this.끄는중) this.#무너짐(`서버가 스스로 끝났습니다 (코드 ${code})`);
      });
      this.아이.stdout.on('data', (d) => {
        // 옛 아이가 죽으면서 남긴 바이트가 뒤늦게 올 수 있다. 받개는 하나뿐이라
        // 그것을 넣으면 **새 서버의 통 경계가 어긋난다** — 길이만 적힌 반쪽
        // 머리말 하나면 그 뒤 답이 전부 안 열려서, 물음마다 시한까지 기다리다
        // 빈손으로 돌아온다. 어디가 잘못됐는지는 화면에 안 뜬다.
        if (내아이인가()) for (const 통 of this.받개.넣기(d)) this.#받음(통);
      });
      // stderr 는 읽되 버린다. 안 읽으면 파이프가 차서 서버가 멎는다 —
      // 언어 서버는 진행 상황을 stderr 로 꽤 많이 쏟는다.
      this.아이.stderr.on('data', () => {});

      const 답 = await this.#물음('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(this.뿌리).href,
        workspaceFolders: [{ uri: pathToFileURL(this.뿌리).href, name: 'root' }],
        capabilities: {
          workspace: { symbol: { dynamicRegistration: false }, workspaceFolders: true, configuration: true },
          textDocument: {
            synchronization: { dynamicRegistration: false, didSave: false },
            definition: { dynamicRegistration: false, linkSupport: true },
            references: { dynamicRegistration: false },
            publishDiagnostics: { relatedInformation: false },
          },
        },
      }, 켜기시한);

      /*
       * 악수가 실패했으면 여기서 끝낸다.
       *
       * 이 줄이 없으면 못 띄운 서버가 **켜진 것으로 통과한다.** #물음 은 던지지
       * 않고 `{오류}` 를 주도록 만들어 놨기 때문이다(그게 맞다 — 도구 한가운데서
       * 던지면 안 된다). 그래서 여기서는 받은 것을 반드시 들여다봐야 한다.
       * 안 보면 그 뒤 물음이 전부 조용히 빈손으로 돌아온다.
       */
      if (답?.오류) throw new Error(답.오류);
      this.능력 = { ...(답?.값?.capabilities ?? {}), ready: true };
      this.켜진때 = Date.now();
      this.알림('initialized', {});
      this.#놀림다시();
      return true;
    } catch (e) {
      this.#무너짐(e?.message ?? String(e));
      return false;
    }
  }

  /*
   * '기다리는 것이 있을 때만' 프로그램을 붙잡는다.
   *
   * 서버는 고칠 때 뒤에서 저절로 데워진다(diag.js 의 데우기). 사용자가 아무것도
   * 안 시켰는데 떠 있을 수 있다는 뜻이다. 그런데 node 는 살아 있는 자식과 그
   * 파이프가 있으면 할 일이 없어도 안 끝난다 — `deel run 한마디` 가 답을 다
   * 내놓고도 프롬프트로 안 돌아온다. 멎은 것처럼 보인다.
   *
   * 그렇다고 늘 놔 버리면 반대로 **답을 기다리는 중에 프로그램이 끝난다.**
   * 그래서 물어보는 동안만 잡고, 다 받으면 놓는다. 이 두 줄이 그 여닫이다.
   */
  #잡기() {
    this.아이?.ref?.();
    for (const 줄 of [this.아이?.stdin, this.아이?.stdout, this.아이?.stderr]) 줄?.ref?.();
  }

  #놓기() {
    if (this.기다림.size || this.기다리는진단) return;
    this.아이?.unref?.();
    for (const 줄 of [this.아이?.stdin, this.아이?.stdout, this.아이?.stderr]) 줄?.unref?.();
  }

  #무너짐(왜) {
    this.죽음 ??= 왜;
    this.능력.ready = false;
    for (const [, 것] of this.기다림) {
      clearTimeout(것.시계);
      것.풀기({ 오류: 왜 });
    }
    this.기다림.clear();
    this.기다리는진단 = 0;
    this.#놓기();
    this.#거두기();
  }

  /*
   * 아이를 거둔다 — `.cmd` 로 띄운 것은 **나무째.**
   *
   * 윈도우에서 셸이 필요한 서버는 cmd.exe 를 거쳐 뜬다(#켜기실제). 우리가 쥔 pid 는 cmd 의
   * 것이라 kill() 은 cmd 만 죽이고, 그 안에서 뜬 진짜 서버(node·python)는 부모 없이 남는다.
   * 놀림시계로 끄고 다시 켤 때마다 하나씩 쌓이고, deel 이 끝날 때까지 작업 관리자에만
   * 보인다(2.0.0 6회차 사냥). backend/mcp.js 의 닫기와 같이 taskkill /T 로 나무째 거둔다.
   */
  #거두기() {
    const 아이 = this.아이;
    if (!아이) return;
    if (this.셸로띄움 && process.platform === 'win32' && 아이.pid && 아이.exitCode === null) {
      const 뒤에 = () => { try { 아이.kill(); } catch { /* 이미 갔다 */ } };
      try {
        const 나무 = spawn('taskkill', ['/pid', String(아이.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        나무.once('error', 뒤에);
        나무.once('exit', 뒤에);
        나무.unref();
      } catch { 뒤에(); }
      return;
    }
    try { 아이.kill(); } catch { /* 이미 갔다 */ }
  }

  // ── 주고받기 ──────────────────────────────────────────────────────────

  #받음(통) {
    /*
     * 답인지 물음인지는 **method 로** 가른다 — 답에는 method 가 없다.
     *
     * 번호로 먼저 가르면 안 된다. 오가는 번호는 양쪽이 **따로** 세고, 서버도
     * 우리처럼 1부터 센다. 번호가 겹치는 순간 서버의 물음(configuration ·
     * registerCapability · workDoneProgress/create)이 우리 물음의 답으로
     * 소비된다. 그 물음은 `{값: undefined}` 로 풀려서 화면에는 「쓰는 자리가
     * 없습니다」 가 뜨고 — 서버는 3곳을 줬는데도 — 서버는 제 물음의 답을 영영
     * 못 받아 그 자리에서 멈춘다.
     */
    if (통.method) {
      // 서버가 우리에게 묻는 것. 안 답하면 서버가 거기서 멈춰 버리는 것이 있어서
      // (configuration 이 그렇다) 빈 답이라도 반드시 돌려준다.
      if (통.id !== undefined) {
        /*
         * configuration 은 항목마다 **null** 이다 — 「그 설정은 모른다」.
         *
         * 빈 표 `{}` 로 답했었다. 그건 「설정이 있는데 비었다」 라서, 서버가 제 기본값 대신
         * 빈 표를 설정으로 받아 켜 두어야 할 검사를 끈 채로 돌 수 있다(2.0.0 6회차 사냥).
         * VS Code 도 모르는 칸은 null 로 준다.
         */
        const 값 = 통.method === 'workspace/configuration'
          ? (통.params?.items ?? []).map(() => null)
          : null;
        this.#보내기({ jsonrpc: '2.0', id: 통.id, result: 값 });
        return;
      }
      if (통.method === 'textDocument/publishDiagnostics') {
        const p = 통.params ?? {};
        if (!p.uri) return;
        /*
         * 옛 판 진단을 지금 판의 답으로 내주면 안 된다.
         *
         * 서버는 디바운스를 두므로, 한 파일을 1~2초 안에 두 번 고치면 첫 판
         * 결과가 둘째 판 뒤에 도착한다. 그것을 받아 적으면 방금 쓴 파일을
         * 「아무 말 없음 = 성하다」 로 말하게 된다 — 확인 안 한 것을 확인했다고
         * 하는 셈이다. 판을 안 주는 서버는 어쩔 수 없이 그대로 받는다.
         */
        const 열쇠 = 열쇠주소(p.uri);
        const 지금판 = this.연것.get(열쇠);
        if (typeof p.version === 'number' && typeof 지금판 === 'number' && p.version < 지금판) return;
        this.진단.set(열쇠, Array.isArray(p.diagnostics) ? p.diagnostics : []);
        // 몇 판 것인지도 적어 둔다. 진단기다리기 가 「이미 온 것이 지금 판 것인가」 를
        // 이것으로 가른다 — 안 적어 두면 옛 판을 지우려다 방금 온 것까지 지운다.
        if (typeof p.version === 'number') this.진단판.set(열쇠, p.version);
        else this.진단판.delete(열쇠);
      }
      return;
    }
    if (통.id !== undefined && this.기다림.has(통.id)) {
      const 것 = this.기다림.get(통.id);
      this.기다림.delete(통.id);
      clearTimeout(것.시계);
      this.#놓기();
      것.풀기(통.error ? { 오류: 통.error.message ?? String(통.error.code) } : { 값: 통.result });
    }
  }

  #보내기(obj) {
    if (!this.아이?.stdin?.writable) return false;
    try { this.아이.stdin.write(틀(obj)); return true; } catch { return false; }
  }

  알림(method, params) {
    this.#놀림다시();
    return this.#보내기({ jsonrpc: '2.0', method, params });
  }

  /**
   * 물어보고 기다린다. **절대 안 던진다** — 시한이 지나면 `{오류}` 를 준다.
   *
   * 던지지 않는 것이 중요하다. 부르는 쪽은 도구 실행 한가운데이고, 거기서
   * 예외가 나면 "언어 서버가 늦었다" 가 "도구가 터졌다" 로 보고된다.
   */
  #물음(method, params, 시한 = 물음시한) {
    const id = ++_다음번호;
    return new Promise((풀기) => {
      const 시계 = setTimeout(() => {
        this.기다림.delete(id);
        this.#놓기();
        풀기({ 오류: `${method} 가 ${Math.round(시한 / 1000)}초 안에 안 왔습니다` });
      }, 시한);
      시계.unref?.();
      this.기다림.set(id, { 풀기, 시계 });
      this.#잡기();
      if (!this.#보내기({ jsonrpc: '2.0', id, method, params })) {
        clearTimeout(시계);
        this.기다림.delete(id);
        this.#놓기();
        풀기({ 오류: '서버에 못 보냈습니다' });
      }
    });
  }

  async 물어보기(method, params, 시한) {
    if (!await this.켜기()) return { 오류: this.죽음 ?? '안 켜졌습니다' };
    this.#놀림다시();
    return await this.#물음(method, params, 시한);
  }

  // ── 파일 알려 주기 ────────────────────────────────────────────────────

  /**
   * 이 파일을 서버에게 보여 준다. 이미 연 것이면 바뀐 내용으로 갈아 준다.
   *
   * 디스크에 있는 것을 서버가 알아서 읽을 거라고 믿으면 안 된다. LSP 는 편집기
   * 안의 **안 저장된 내용**까지 다루려고 만든 규약이라, 열어서 보여 준 파일이
   * 진짜고 그 밖은 디스크 것이다. 우리는 이미 저장한 뒤에 부르지만, 서버가
   * 파일 바뀐 것을 언제 알아채는지는 서버마다 다르다 — 그래서 직접 준다.
   */
  보여주기(abs, 글 = null) {
    const uri = pathToFileURL(abs).href;
    let 내용 = 글;
    if (내용 == null) {
      try { 내용 = readFileSync(abs, 'utf8'); } catch { return null; }
    }
    // 판 번호는 **경로**로 센다. 서버가 주소를 다르게 적어 돌려주므로
    // (pyright 의 `file:///c%3A/…`), 글자 그대로 열쇠를 삼으면 진단이 왔을 때
    // 그 판이 몇 판이었는지 못 찾는다 — 옛 판을 지금 판으로 받아 적게 된다.
    const 열쇠 = 열쇠주소(uri);
    const 판 = (this.연것.get(열쇠) ?? 0) + 1;
    this.연것.set(열쇠, 판);
    if (판 === 1) {
      this.알림('textDocument/didOpen', {
        textDocument: { uri, languageId: 언어아이디(abs), version: 판, text: 내용 },
      });
    } else {
      this.알림('textDocument/didChange', {
        textDocument: { uri, version: 판 },
        contentChanges: [{ text: 내용 }],   // 통째로 보낸다. 조각 계산은 틀릴 자리가 많다
      });
    }
    return uri;
  }

  /**
   * 이 파일의 진단을 기다린다.
   *
   * 안 오면 안 온 대로 null 을 준다 — **없다고 하지 않는다.** 그 차이가 크다.
   * 늦게 오는 것을 '오류 없음' 으로 바꿔 말하면, 이 프로그램이 확인 안 한 것을
   * 확인했다고 하는 셈이 된다. 그건 여기서 제일 하면 안 되는 일이다.
   */
  async 진단기다리기(uri, 시한 = 2500) {
    const 끝 = Date.now() + 시한;
    /*
     * 진단은 '바뀐 뒤' 것을 봐야 한다. 그래서 기다리기에 앞서 옛 진단을 지운다 —
     * 안 지우면 판을 올려 놓고 **옛 판 답을 지금 판의 답으로** 곧장 내준다.
     *
     * 그런데 여기가 판을 안 보고 통째로 지웠다. 서버가 didChange 를 받고 **이미
     * 답해 놓은** 지금 판 진단까지 같이 버려서, 제대로 온 답이 「안 왔다」(= 확인
     * 못 했다)로 올라갔다. 재 봤다 — 1판을 열고 진단이 도착한 뒤에 기다리면 null 이다.
     *
     * 그래서 **판을 보고** 지운다. 이미 온 것이 지금 판 것이면 그것이 답이다.
     * 판을 안 주는 서버는 진단판 에 아무것도 안 남으므로 여태처럼 지운다 — 그쪽은
     * 옛것인지 알 길이 없어서, 새로 받는 편이 맞다.
     */
    const 열쇠 = 열쇠주소(uri);
    const 지금판 = this.연것.get(열쇠);
    const 온판 = this.진단판.get(열쇠);
    const 지금판것이와있다 = typeof 지금판 === 'number' && typeof 온판 === 'number' && 온판 >= 지금판;
    if (!지금판것이와있다) this.진단.delete(열쇠);
    this.기다리는진단++;
    this.#잡기();
    try {
      for (;;) {
        if (this.진단.has(열쇠)) return this.진단.get(열쇠);
        if (Date.now() >= 끝 || !this.살았나()) return null;
        await new Promise((r) => { const t = setTimeout(r, 60); t.unref?.(); });
      }
    } finally {
      this.기다리는진단 = Math.max(0, this.기다리는진단 - 1);
      this.#놓기();
    }
  }

  // ── 끄기 ──────────────────────────────────────────────────────────────

  #놀림다시() {
    /*
     * **끄는 중에는 다시 걸지 않는다.**
     *
     * 끄기() 는 맨 앞에서 이 시계를 끄는데, 그 뒤에 나가는 `exit` 알림이 알림() 을
     * 거치면서 여기를 부른다 — 껐는데 껐다 살아나는 시계다. 그렇게 남은 시계는 다
     * 끝난 서버를 붙들고 놀림시한 뒤에 끄기() 를 한 번 더 부른다.
     */
    if (this.끄는중) return;
    clearTimeout(this.놀림시계);
    this.놀림시계 = setTimeout(() => { this.끄기(); }, 놀림시한);
    this.놀림시계.unref?.();
  }

  async 끄기() {
    clearTimeout(this.놀림시계);
    this.놀림시계 = null;
    if (!this.아이) return;
    this.끄는중 = true;
    this.능력.ready = false;
    try {
      // 예의는 갖추되 오래 기다리지 않는다. 안 나가면 그냥 끊는다.
      const 갔나 = await Promise.race([
        this.#물음('shutdown', null, 1500).then(() => { this.알림('exit', null); return true; }),
        new Promise((r) => { const t = setTimeout(() => r(false), 1600); t.unref?.(); }),
      ]);
      void 갔나;
    } catch { /* 끄다 나는 탈은 삼킨다 */ }
    this.#거두기();
    /*
     * 기다리던 물음은 **풀어 주고** 비운다.
     *
     * 비우기만 했었다. 그러면 부르던 쪽의 약속은 아무도 안 풀어서 제 시한(길면 수십 초)까지
     * 그 자리에서 멎는다 — 서버는 이미 없는데(2.0.0 6회차 사냥). #무너짐 과 같이 푼다.
     */
    for (const [, 것] of this.기다림) {
      clearTimeout(것.시계);
      것.풀기({ 오류: '언어 서버를 껐습니다' });
    }
    this.기다림.clear();
    /*
     * 진단을 기다리던 셈도 여기서 접고 놓아 준다 — #무너짐 이 하는 그대로다.
     *
     * 끄기() 만 이 둘을 안 했다. 그러면 기다리던 진단이 있는 채로 끈 뒤에 셈이 1 로
     * 남고, #놓기 는 맨 앞에서 되돌아 나간다. 다음에 다시 켠 아이를 아무도 놓아 주지
     * 않으니 `deel run 한마디` 가 답을 다 내놓고도 프롬프트로 안 돌아온다.
     *
     * 놓기는 **아이를 지우기 전에** 한다. 지운 뒤에는 놓아 줄 대상이 없다 — 이 줄이
     * 아래에 있던 때는 불러도 아무 일도 안 했다.
     */
    this.기다리는진단 = 0;
    this.#놓기();
    this.아이 = null;
    /*
     * 열어 뒀던 것도 같이 잊는다.
     *
     * 놀림시계로 끈 것은 풀에 그대로 남아서 다음에 다시 켜진다. 판 번호를
     * 안 지우면 새 서버에게 didOpen 없이 `didChange 2판` 을 보내게 되고,
     * 서버는 모르는 파일이라며 조용히 버린다 — 진단이 영영 안 온다.
     */
    this.연것.clear();
    this.진단.clear();
    this.진단판.clear();
    this.끄는중 = false;
  }
}

// ── 여러 언어를 동시에 ────────────────────────────────────────────────────
//
// 한 프로젝트에 ts 와 py 가 같이 있는 것이 드물지 않다. 언어마다 서버가 따로라
// 뿌리+언어를 열쇠로 잡아 둔다. 켤 때 값이 들어서 한 번 켠 것은 계속 쓴다.

const 풀 = new Map();
const 열쇠 = (뿌리, g) => `${뿌리}\0${g}`;

/**
 * 이 파일에 맞는 서버를 얻는다. 못 쓰면 null.
 * @param 켜기까지 false 면 이미 켜진 것만 준다 — 편집 뒤 진단이 이 길로 온다.
 */
export async function 얻기(뿌리, 파일, { 켜기까지 = true, env = process.env } = {}) {
  const g = 갈래(파일);
  if (!g) return null;
  const k = 열쇠(뿌리, g);
  let 것 = 풀.get(k);
  if (!것) {
    if (!켜기까지) return null;
    const 고른 = 고르기(g, env);
    if (!고른) return null;
    것 = new 언어서버(뿌리, 고른);
    풀.set(k, 것);
  }
  if (것.죽음) return null;
  if (!켜기까지) return 것.능력.ready ? 것 : null;
  return await 것.켜기() ? 것 : null;
}

/** 지금 떠 있는 것들. /lsp 화면과 시험이 쓴다. */
export function 지금것들() {
  return [...풀.entries()].map(([k, v]) => {
    const [뿌리, 갈래열쇠] = k.split('\0');
    return { 뿌리, 갈래: 갈래열쇠, 이름: v.서버?.이름, 살았나: v.살았나(), 준비: !!v.능력.ready, 죽음: v.죽음 ?? null };
  });
}

/** 다 끈다. 프로그램이 끝날 때와 시험 뒤에 부른다. */
export async function 모두끄기() {
  const 것들 = [...풀.values()];
  풀.clear();
  await Promise.all(것들.map((v) => v.끄기().catch(() => {})));
}

/**
 * 부모가 죽을 때 아이도 같이 데려간다.
 *
 * 안 그러면 사용자 컴퓨터에 언어 서버가 하나씩 쌓인다. 이건 사용자가 나중에
 * 작업 관리자를 열기 전에는 모르는 종류의 탈이라, 반드시 여기서 막아야 한다.
 */
export const 아이들데려가기 = () => {
  for (const v of 풀.values()) { try { v.아이?.kill(); } catch { /* 이미 갔다 */ } }
  풀.clear();
};

process.on('exit', 아이들데려가기);

/*
 * 신호(SIGINT·SIGTERM)로 끝날 때도 거둔다. 손은 reap.js 에 하나만 단다 — 여기 따로 달면
 * MCP·일감이 거둬지지 않고, 둘이 따로 달면 서로 「남이 맡았다」 고 보고 deel 이 SIGTERM 을
 * 삼킨다(그 머리말). 다시보낼까 는 검사가 여기서 부르던 그대로 내보낸다.
 */
신호에거두기(아이들데려가기);
export { 다시보낼까 };

/**
 * 켠 지 얼마 안 됐나.
 *
 * 언어 서버는 악수를 마친 **뒤에** 프로젝트를 훑는다. 그 사이에 이름을 물으면
 * 빈손으로 온다 — 없어서가 아니라 아직 못 봐서다. 이 둘을 구별 못 하면
 * "그런 이름 없습니다" 라고 잘라 말하게 되고, 모델은 그 말을 믿고 새로 만든다.
 */
export function 색인중일까(서버) {
  return !!서버?.켜진때 && Date.now() - 서버.켜진때 < 30_000;
}

export { fileURLToPath as 경로로, 열쇠주소 };
