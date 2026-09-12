/**
 * MCP(Model Context Protocol) 서버 붙이기 — stdio 규격.
 *
 * 무엇인가:
 *   도구를 **코드를 안 고치고** 밖에서 붙이는 규격이다. 사내 위키 검색기,
 *   사내 이슈 트래커, DB 조회기 같은 것을 각 팀이 MCP 서버로 만들어 두면
 *   deel 은 그걸 그대로 도구로 쓴다. 우리가 매번 도구를 새로 만들지 않아도 된다.
 *
 * 왜 의존성 없이 되나:
 *   stdio 규격은 자식 프로세스의 stdin/stdout 에 **줄 단위 JSON-RPC 2.0** 을
 *   주고받는 것이 전부다. child_process 와 JSON 이면 된다. SDK 가 필요 없다.
 *
 * ── 안전에 대해 ────────────────────────────────────────────────────────
 *
 * MCP 서버는 **남의 프로그램**이다. 이 프로젝트가 존재하는 이유가 '미승인 SW
 * 반입 금지' 인데, MCP 를 아무렇게나 켜면 그 선을 우리 손으로 무너뜨리는 셈이다.
 * 그래서:
 *
 *   1) **기본은 꺼져 있다.** .deel/mcp.json 에 사람이 직접 적어야만 뜬다.
 *   2) **--offline 이면 아예 안 띄운다.** 자식 프로세스가 어디로 나가는지
 *      우리는 못 막는다. 막을 수 없는 것을 막았다고 말하지 않는다.
 *   3) **감사기록에 남긴다.** 무엇을 띄웠고 무엇을 불렀는지.
 *   4) **작업 범위 밖이다.** MCP 서버는 우리 scope 를 안 지킨다 —
 *      제 마음대로 파일을 읽고 쓸 수 있다. /mcp 화면에서 그렇다고 말한다.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { VERSION } from '../version.js';
// 남의 저장소에 딸려 온 mcp.json 으로 남의 프로그램을 띄우지 않는다 (다붙이기 머리말).
import { 믿나 } from '../safety/trust.js';

// 붙는 데 이만큼 넘게 걸리면 포기한다. 시작이 느려지면 안 쓰게 된다.
export const 붙기제한 = 8000;
// 도구 하나 부르고 이만큼 기다린다.
export const 부르기제한 = 60000;
// 한 서버에서 받을 도구 수. 스키마가 통째로 매 요청에 실리므로 무한정 받으면
// 컨텍스트가 조용히 줄어든다. 넘으면 **넘었다고 말하고** 자른다.
export const 도구최대 = 24;
// 한 줄(JSON 한 통)의 최대 크기. 미친 서버가 stdout 을 쏟아부어도 안 죽게.
const 줄최대 = 4 * 1024 * 1024;

export const 설정자리 = (root) => join(root, '.deel', 'mcp.json');

/*
 * ── 도구 목록을 적어 둔다 (지연 로딩) ─────────────────────────────────
 *
 * 여태는 켤 때 적힌 서버를 **전부** 띄웠다. 그래야 모델에게 넘길 도구 목록을
 * 알 수 있으니까. 그런데 그 목록은 **거의 안 바뀐다.** 사내 위키 검색기의
 * 도구 이름은 지난달에도 같았고 다음달에도 같을 것이다.
 *
 * 그 변하지 않는 것을 알자고 매번 서버 네다섯 대를 띄우고, 악수를 두 번씩
 * 하고, 사람은 그동안 빈 화면을 본다. 서버 넷이면 2초가 넘고, 그건 `deel` 을
 * 칠 때마다다.
 *
 * 그래서 목록을 적어 둔다. 다음부터는 **그 도구를 정말 부를 때** 띄운다.
 *
 * 적어 둔 것이 진짜와 어긋나는 자리를 세 겹으로 막는다.
 *
 *   1) **지문**이 다르면 안 쓴다. 명령·인자·폴더·환경이 한 글자라도 바뀌었으면
 *      다른 서버다. 설정을 고치고 「왜 안 바뀌지」 를 겪는 일이 없어야 한다.
 *   2) **일주일**이 지나면 안 쓴다. 도구가 늘어나는 서버도 있고, 영영 안 띄우면
 *      그걸 영영 모른다. 늘어나지 않는 것을 전제로 깔면 안 된다.
 *   3) 정말 띄운 뒤에 **맞춰 본다.** 다르면 그 자리에서 고쳐 적고, 부른 도구가
 *      없어졌으면 그렇다고 말한다 — 「없는 도구」 로 뭉뚱그리지 않는다.
 */
export const 메모자리 = (root) => join(root, '.deel', 'mcp-tools.json');
/** 적어 둔 목록을 이만큼 지나면 다시 띄워 확인한다. */
export const 메모유효 = 7 * 24 * 60 * 60 * 1000;

/** 이 서버가 「같은 서버」 인가를 가르는 값. */
export function 지문(설정) {
  const 재료 = JSON.stringify([
    설정.command, 설정.args ?? [], 설정.cwd ?? '',
    Object.entries(설정.env ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  return createHash('sha256').update(재료).digest('hex').slice(0, 16);
}

/** 적어 둔 목록을 읽는다. 못 읽으면 빈 것으로 본다 — 그러면 그냥 띄운다. */
export function 메모읽기(root) {
  try {
    const j = JSON.parse(readFileSync(메모자리(root), 'utf8'));
    return j?.servers && typeof j.servers === 'object' ? j.servers : {};
  } catch { return {}; }
}

/**
 * 적어 둔다. 못 적어도 던지지 않는다 — 다음번에 다시 띄우면 그만이다.
 *
 * ── 이미 적혀 있던 것을 지우지 않는다 ──────────────────────────────────
 *
 * 여기가 파일을 **통째로 새로** 썼다. 그런데 부르는 쪽은 이번에 정말 띄운
 * 것만 넘긴다(대기 중인 것은 적은때를 새로 찍으면 「일주일이면 다시 본다」
 * 가 영영 안 오므로 일부러 뺀다). 둘이 합쳐지면 **대기 중이던 서버의 메모가
 * 지워진다.**
 *
 * 서버 A·B 를 쓰다가 B 의 설정만 고치면 — 그 판에서 A 는 대기, B 는 새로
 * 뜸 → A 의 메모가 날아간다. 다음 판에는 A 를 띄우고 B 가 대기 → 이번엔
 * B 가 날아간다. 그 뒤로 **매번 서버 하나가 반드시 즉시 뜬다.** 지연 로딩이
 * 없애려던 기동 지연(위 머리말의 「서버 넷이면 2초」)이 영구히 돌아오는데,
 * 화면에는 ● 하나 ◐ 하나가 떠서 설정을 안 고쳤는데 왜 매번 남의 프로세스가
 * 뜨는지 알 길이 없다.
 *
 * 그래서 **겹쳐 쓴다.** 넘긴 것만 갈아 끼우고 나머지는 적힌 그대로 둔다.
 *
 * @param 남길이름 지금 설정에 있는 서버 이름들. 주면 설정에서 빠진 서버의
 *   메모를 걷는다 — 안 걷으면 지운 서버가 파일에 영영 쌓인다.
 */
export function 메모쓰기(root, 서버들, { 남길이름 = null } = {}) {
  const 있던것 = 메모읽기(root);
  const servers = {};
  for (const [이름, 것] of Object.entries(있던것)) {
    if (남길이름 && !남길이름.includes(이름)) continue;
    servers[이름] = 것;
  }
  for (const s of 서버들) {
    if (!s.도구?.length) continue;   // 못 띄운 것은 안 적는다
    servers[s.이름] = {
      지문: 지문(s.설정),
      적은때: Date.now(),
      정보: s.정보 ?? null,
      잘림: s.잘림 ?? 0,
      도구: s.도구,
    };
  }
  if (!Object.keys(servers).length) return false;
  try {
    mkdirSync(join(root, '.deel'), { recursive: true });
    writeFileSync(메모자리(root), JSON.stringify({ version: 1, servers }, null, 2) + '\n', 'utf8');
    return true;
  } catch { return false; }
}

/** 이 설정에 쓸 수 있는 메모인가. 아니면 null — 부르는 쪽은 그러면 띄운다. */
export function 쓸만한메모(메모, 설정, 이제 = Date.now()) {
  if (!메모 || !Array.isArray(메모.도구) || !메모.도구.length) return null;
  if (메모.지문 !== 지문(설정)) return null;
  if (이제 - Number(메모.적은때 ?? 0) >= 메모유효) return null;
  return 메모;
}

/**
 * 설정을 읽는다. Claude Code 의 `mcpServers` 모양을 그대로 받는다 —
 * 이미 쓰던 설정을 복사해 붙일 수 있어야 한다.
 */
export function 설정읽기(root) {
  const p = 설정자리(root);
  if (!existsSync(p)) return { 서버들: [], 자리: p, 있음: false };
  let j;
  try { j = JSON.parse(readFileSync(p, 'utf8')); } catch (e) {
    return { 서버들: [], 자리: p, 있음: true, 오류: `mcp.json 을 못 읽었습니다: ${e.message}` };
  }
  const 표 = j.mcpServers ?? j.servers ?? {};
  const 서버들 = [];
  /*
   * ── 안 받는 항목도 **적어서 내놓는다** ────────────────────────────────
   *
   * 여기서 그냥 `continue` 했다. 그러면 적어 둔 서버가 화면 어디에도 안
   * 나온다 — 켤 때 뜨는 줄은 붙은 것만 세고(repl.js), `/mcp` 목록도 붙은 것만
   * 세운다. 사람 쪽에서는 **목록이 완전해 보인다.**
   *
   * 이 파일이 제일 흔하게 받는 것이 다른 도구의 설정을 그대로 붙여넣은
   * 것이고, 거기에는 `"type": "sse"` 나 `url` 만 있는 항목이 섞여 있다.
   * 그게 조용히 사라지면 「왜 그 도구가 없지」 를 영영 알 수 없다 — 아래
   * 다붙이기 머리말이 스스로 약속한 바로 그 자리다. 못 뜬 다른 갈래들
   * (오프라인·안 믿는 폴더)은 다 적어서 내놓는데 여기만 안 적었다.
   *
   * `disabled` 는 안 적는다. 그건 사람이 스스로 끈 것이라 알려 줄 것이 없다.
   */
  const 못받은것 = [];
  for (const [이름, v] of Object.entries(표)) {
    if (v?.disabled === true) continue;
    // stdio 만 받는다. http/sse 규격은 바깥으로 나가는 것이라 자물쇠와 부딪힌다.
    if (v?.type && v.type !== 'stdio') {
      못받은것.push({ 이름, 왜: `"${v.type}" 규격은 아직 못 붙입니다 — stdio(command 로 띄우는 서버)만 받습니다` });
      continue;
    }
    if (!v?.command) {
      못받은것.push({
        이름,
        왜: v?.url
          ? 'url 로 붙는 서버는 아직 못 붙입니다 — command 로 띄우는 stdio 서버만 받습니다'
          : 'command 가 없습니다 — 무엇을 띄울지 적어야 합니다',
      });
      continue;
    }
    서버들.push({
      이름,
      command: String(v.command),
      args: Array.isArray(v.args) ? v.args.map(String) : [],
      env: v.env && typeof v.env === 'object' ? v.env : null,
      cwd: v.cwd ? String(v.cwd) : root,
    });
  }
  return { 서버들, 못받은것, 자리: p, 있음: true };
}

/*
 * ── 지금 띄워 둔 서버들 ─────────────────────────────────────────────────
 *
 * 여기 왜 명부가 있나. MCP 서버는 붙인 쪽(repl·ACP)이 들고 있을 뿐이라,
 * 프로그램이 어느 길로든 끝나 버리면 **아무도 안 닫는다.** 그러면 사람
 * 컴퓨터에 서버 프로세스가 하나씩 쌓인다 — 작업 관리자를 열기 전에는
 * 모르는 종류의 탈이다.
 *
 * 일감(tools/jobs.js)과 언어 서버(lsp/client.js)에는 이미 이 그물이 있는데
 * 여기만 없었다. 같은 자리, 같은 규칙으로 둔다.
 */
const 띄운것들 = new Set();

/** 검사와 진단이 본다. 지금 살아 있는 서버 수. */
export function 살아있는수() { return 띄운것들.size; }

/**
 * 다 닫는다. 프로그램이 끝날 때와 검사 뒤에 부른다.
 * @returns {number} 닫은 개수
 */
export function 모두닫기() {
  const 것들 = [...띄운것들];
  띄운것들.clear();
  let n = 0;
  for (const s of 것들) { try { s.닫기(); n++; } catch { /* 끝나는 중이라 할 수 있는 게 없다 */ } }
  return n;
}

/*
 * 어떤 길로 끝나든 남기지 않는다. 붙인 쪽이 이미 닫았어도 무해하다.
 *
 * 이름 있는 함수를 그대로 건다 — 이름 없는 화살표로 걸면 그물이 걸려 있는지
 * 검사가 밖에서 확인할 길이 없다. 걷어내도 아무도 모르는 그물은 없는 것과 같다.
 */
process.once('exit', 모두닫기);

/**
 * 서버 하나와의 연결.
 *
 * 규격은 JSON-RPC 2.0 이다. 줄 하나에 통 하나 — 그래서 줄 단위로 자르면 된다.
 */
export class MCP서버 {
  constructor(설정) {
    this.이름 = 설정.이름;
    this.설정 = 설정;
    this.kid = null;
    this.다음번호 = 1;
    this.기다리는것 = new Map();
    this.찌꺼기 = '';
    this.도구 = [];
    this.정보 = null;
    this.죽음 = null;      // 왜 죽었나 (사람에게 보여 줄 말)
    this.잘림 = 0;         // 도구최대 를 넘어 자른 개수
    /*
     * 적어 둔 목록으로 서 있는 상태 — 아직 안 띄웠다.
     *
     * `살아있나()` 와 갈라 둔다. 저건 「지금 프로세스가 떠 있나」 라는 사실이고
     * 이건 「쓸 수 있나」 라는 판단이다. 하나로 뭉개면 화면이 대기 중인 서버를
     * 「죽었다」 고 적게 되는데, 그건 사람을 없는 탈로 보낸다.
     */
    this.대기 = false;
    /** 깨우는 중인 약속. 도구 둘을 한꺼번에 불러도 한 번만 띄우려는 것이다. */
    this.깨우는중 = null;
    /** 깨우고 나서 목록이 달라졌으면 그 사실. 화면이 이걸 말한다. */
    this.달라짐 = null;
    /*
     * 메모를 어디에 적나. 메모로세우기() 가 넣어 준다.
     *
     * 설정.cwd 로 갈음할 수 없다 — 사람이 cwd 를 따로 적어 두면 그것은
     * 폴더 뿌리가 아니고, 그러면 남의 폴더에 메모를 적는다.
     */
    this.뿌리 = null;
  }

  살아있나() { return !!this.kid && this.kid.exitCode === null && !this.죽음; }
  /** 지금 도구를 부를 수 있나. 대기 중이면 부르는 순간 뜬다. */
  쓸수있나() { return this.살아있나() || (this.대기 && !this.죽음); }

  /**
   * 적어 둔 목록으로 세워 둔다. **안 띄운다.**
   *
   * 여기서 하는 일은 「이 서버에 이런 도구가 있다고 지난번에 봤다」 를 들고
   * 있는 것뿐이다. 진짜로 뜨는 것은 그 도구를 처음 부를 때다(깨우기).
   */
  메모로세우기(메모, 뿌리 = null) {
    this.뿌리 = 뿌리;
    this.도구 = 메모.도구 ?? [];
    this.정보 = 메모.정보 ?? null;
    this.잘림 = 메모.잘림 ?? 0;
    this.대기 = true;
    return this;
  }

  /**
   * 대기 중이던 서버를 정말 띄운다.
   *
   * 띄운 뒤 목록을 **맞춰 본다.** 적어 둔 것과 다르면 그 사실을 들고 있다가
   * 화면과 부르는 쪽이 말하게 한다 — 조용히 갈아 끼우면, 모델이 방금 부른
   * 도구가 왜 없어졌는지 아무도 설명 못 한다.
   */
  async 깨우기({ timeout = 붙기제한 } = {}) {
    if (this.살아있나()) return true;
    if (this.죽음) return false;
    if (this.깨우는중) return this.깨우는중;
    const 적어둔것 = this.도구.map((t) => t.name).join('\0');
    // 속까지 견주려면 정의를 그대로 들고 있어야 한다 (아래 바뀐것).
    const 적어둔도구 = this.도구;
    this.깨우는중 = (async () => {
      // 죽음 은 붙기() 가 실패하며 남긴다. 다시 붙으려면 지워 두고 시작한다.
      this.죽음 = null;
      const ok = await this.붙기({ timeout });
      this.대기 = false;
      this.깨우는중 = null;
      if (!ok) return false;
      const 지금것 = this.도구.map((t) => t.name).join('\0');
      if (적어둔것 && 지금것 !== 적어둔것) {
        this.달라짐 = {
          늘어난것: this.도구.map((t) => t.name).filter((n) => !적어둔것.split('\0').includes(n)),
          없어진것: 적어둔것.split('\0').filter((n) => !this.도구.some((t) => t.name === n)),
        };
      }
      /*
       * ── 이름은 같은데 **속이 달라진** 도구 ─────────────────────────────
       *
       * 위 맞춰보기는 이름만 본다. 그런데 제일 조용한 어긋남은 이름이 그대로인
       * 쪽이다 — `wiki_search` 가 필수 인자 `repo` 를 새로 받기 시작하면,
       * 적어 둔 옛 스키마를 그대로 모델에게 실어 보내고 모델은 `repo` 없이
       * 부른다. 서버가 기본값으로 넘어가는 구현이면 **엉뚱한 저장소를 검색한
       * 그럴듯한 결과**가 돌아온다. 400 이 나는 것보다 나쁘다.
       */
      const 옛것 = new Map((적어둔도구 ?? []).map((t) => [t.name, JSON.stringify(t.inputSchema ?? null)]));
      const 바뀐것 = this.도구
        .filter((t) => 옛것.has(t.name) && 옛것.get(t.name) !== JSON.stringify(t.inputSchema ?? null))
        .map((t) => t.name);
      if (바뀐것.length) this.달라짐 = { 늘어난것: [], 없어진것: [], ...(this.달라짐 ?? {}), 바뀐것 };
      /*
       * ── 맞춰 본 것을 **적어 둔다** ─────────────────────────────────────
       *
       * 이 파일 머리말이 「정말 띄운 뒤에 맞춰 본다. 다르면 그 자리에서 고쳐
       * 적고」 라고 약속했는데, 「고쳐 적고」 가 없었다. 그래서 옛 목록이
       * **매 실행마다 다시** 모델에게 나갔다 — 지문이 같고 이레가 안 지났으니
       * 다음 판에도 같은 옛것을 쓰고, 같은 실패를 되풀이한다.
       *
       * 여기서 적은때를 새로 찍는 것은 맞다. 방금 **정말로 띄워서** 확인한
       * 목록이라, 이레 시계는 이 순간부터 세는 것이 옳다.
       */
      if (this.뿌리) { try { 메모쓰기(this.뿌리, [this]); } catch { /* 못 적어도 대화는 계속된다 */ } }
      return true;
    })();
    return this.깨우는중;
  }

  async 붙기({ timeout = 붙기제한 } = {}) {
    try {
      this.kid = spawn(this.설정.command, this.설정.args, {
        cwd: this.설정.cwd,
        // 설정에 적힌 env 만 얹는다. 우리 환경변수를 통째로 넘기면
        // 게이트웨이 열쇠(DEEL_*)까지 남의 프로세스로 넘어간다.
        env: { ...깨끗한환경(), ...(this.설정.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
    } catch (e) {
      this.죽음 = `띄우지 못했습니다: ${e.message}`;
      return false;
    }
    // 띄운 순간부터 명부에 든다. 악수(initialize)를 못 마쳐도 아이는 이미
    // 떠 있으므로, 여기서 안 적으면 그 아이는 아무도 안 거두는 아이가 된다.
    띄운것들.add(this);

    this.kid.on('error', (e) => this.끝냄(`오류: ${e.message}`));
    this.kid.on('exit', (code, sig) => this.끝냄(`끝났습니다 (코드 ${code ?? sig})`));
    this.kid.stdout.setEncoding('utf8');
    this.kid.stdout.on('data', (d) => this.받음(d));
    // 서버가 stderr 에 로그를 쏟는 일이 흔하다. 화면에 흘리면 대화가 뒤덮인다.
    // 마지막 것만 들고 있다가 죽었을 때 원인으로 보여 준다.
    this.kid.stderr.setEncoding('utf8');
    this.kid.stderr.on('data', (d) => { this.마지막말 = String(d).trim().slice(-400); });

    try {
      const r = await this.보내고기다리기('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'deel', version: VERSION },
      }, timeout);
      this.정보 = r?.serverInfo ?? null;
      this.알림('notifications/initialized', {});
    } catch (e) {
      this.끝냄(`규격 인사에 실패했습니다: ${e.message}`);
      return false;
    }

    try {
      const r = await this.보내고기다리기('tools/list', {}, timeout);
      const 다 = Array.isArray(r?.tools) ? r.tools : [];
      this.도구 = 다.slice(0, 도구최대);
      this.잘림 = Math.max(0, 다.length - this.도구.length);
    } catch (e) {
      this.끝냄(`도구 목록을 못 받았습니다: ${e.message}`);
      return false;
    }
    return true;
  }

  받음(덩이) {
    this.찌꺼기 += 덩이;
    if (this.찌꺼기.length > 줄최대) {
      this.끝냄('한 통이 너무 큽니다 — 규격에 안 맞는 서버입니다');
      return;
    }
    let i = this.찌꺼기.indexOf('\n');
    while (i >= 0) {
      const 줄 = this.찌꺼기.slice(0, i).trim();
      this.찌꺼기 = this.찌꺼기.slice(i + 1);
      if (줄) this.한통(줄);
      i = this.찌꺼기.indexOf('\n');
    }
  }

  한통(줄) {
    let j;
    try { j = JSON.parse(줄); } catch { return; }   // 규격 밖의 잡소리는 버린다
    if (j.id == null) return;                        // 알림은 아직 안 쓴다
    const 기다림 = this.기다리는것.get(j.id);
    if (!기다림) return;
    this.기다리는것.delete(j.id);
    clearTimeout(기다림.타이머);
    // 끝난 자리의 ESC 엿듣기는 떼어 낸다. 안 떼면 한 턴에 도구를 스무 번
    // 부르는 사이 신호 하나에 스무 개가 매달린다 — 노드가 열 개 넘으면
    // 「메모리가 새는 것 같다」 고 경고를 찍는데, 실제로 새는 것이 맞다.
    기다림.끊기그만?.();
    if (j.error) 기다림.실패(new Error(j.error.message ?? '알 수 없는 오류'));
    else 기다림.성공(j.result);
  }

  /**
   * 한 통 보내고 답을 기다린다.
   *
   * signal 은 사람이 누른 ESC 다. 안 받으면 도구 하나 부르는 데 최대 60초
   * (부르기제한)를 기다리는데, 그 60초 동안 ESC 는 아무것도 안 한다 — 화면은
   * 「멈추는 중…」 인데 남의 프로세스의 답을 계속 기다리고 있는 상태다.
   * 그래서 시한과 같은 자리에서 같은 방식으로 푼다: 기다리는 표에서 빼고,
   * 왜 끝났는지를 말로 남기고 끝낸다.
   */
  보내고기다리기(method, params, timeout = 부르기제한, signal = null) {
    return new Promise((성공, 실패) => {
      if (!this.kid || this.kid.exitCode !== null) return 실패(new Error(this.죽음 ?? '연결이 없습니다'));
      // 이미 멈췄으면 보내지도 않는다. 보내 놓고 버리면 남의 서버는 그 일을 끝까지 한다.
      if (signal?.aborted) return 실패(new Error('중단했습니다'));
      const id = this.다음번호++;
      const 타이머 = setTimeout(() => {
        this.기다리는것.delete(id);
        끊기그만();
        실패(new Error(`${Math.round(timeout / 1000)}초 안에 답이 없습니다`));
      }, timeout);
      if (타이머.unref) 타이머.unref();
      /*
       * 기다리는 표에서 **반드시** 뺀다.
       *
       * 안 빼면 뒤늦게 온 답이 이미 끝난 약속을 또 푼다. 두 번째 풀기는
       * 조용히 무시되므로 오류는 안 나지만, 표에 죽은 자리가 남아서
       * 끝냄() 이 그것들을 다시 실패시킨다 — 아무도 안 듣는 실패다.
       */
      const 끊겼다 = () => {
        clearTimeout(타이머);
        this.기다리는것.delete(id);
        실패(new Error('중단했습니다'));
      };
      signal?.addEventListener?.('abort', 끊겼다, { once: true });
      const 끊기그만 = () => signal?.removeEventListener?.('abort', 끊겼다);
      this.기다리는것.set(id, { 성공, 실패, 타이머, 끊기그만 });
      try {
        this.kid.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      } catch (e) {
        clearTimeout(타이머);
        this.기다리는것.delete(id);
        끊기그만();
        실패(e);
      }
    });
  }

  알림(method, params) {
    try { this.kid?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); } catch { /* 죽었으면 어차피 끝이다 */ }
  }

  async 부르기(도구이름, args, { timeout = 부르기제한, signal = null } = {}) {
    /*
     * 대기 중이면 **여기서** 띄운다. 이게 지연 로딩의 전부다.
     *
     * 첫 부름 하나만 붙는 시간을 치르고, 그 뒤로는 여느 때와 똑같다. 켤 때
     * 다 띄우던 값을 「그 도구를 실제로 쓰는 사람」 에게만 물리는 셈이다.
     */
    if (this.대기) {
      const ok = await this.깨우기();
      if (!ok) throw new Error(this.죽음 ?? '띄우지 못했습니다');
      /*
       * 띄우고 보니 그 도구가 없어졌으면 **그렇다고 말한다.**
       *
       * 여기서 그냥 tools/call 을 보내면 서버가 뭐라고 답할지는 서버 마음이고,
       * 대개는 「unknown tool」 한 줄이다. 그 줄로는 우리가 옛 목록을 들고
       * 있었다는 사실을 아무도 못 읽는다.
       */
      if (!this.도구.some((t) => t.name === 도구이름)) {
        throw new Error(`${this.이름} 서버에 ${도구이름} 이 더는 없습니다`
          + ` — 적어 둔 목록이 옛것이었습니다. 지금 있는 것: ${this.도구.map((t) => t.name).join(' · ') || '(없음)'}`);
      }
    }
    const r = await this.보내고기다리기('tools/call', { name: 도구이름, arguments: args ?? {} }, timeout, signal);
    // 규격상 결과는 content 배열이다. 글만 뽑아 모델에게 넘긴다.
    const 조각 = Array.isArray(r?.content) ? r.content : [];
    const 글 = 조각
      .map((p) => (p?.type === 'text' ? p.text : p?.type ? `[${p.type}]` : ''))
      .filter(Boolean).join('\n');
    return { text: 글, isError: r?.isError === true };
  }

  끝냄(왜) {
    if (this.죽음) return;
    this.죽음 = this.마지막말 ? `${왜} — ${this.마지막말}` : 왜;
    for (const [, 기다림] of this.기다리는것) {
      clearTimeout(기다림.타이머);
      기다림.끊기그만?.();
      기다림.실패(new Error(this.죽음));
    }
    this.기다리는것.clear();
  }

  닫기() {
    this.끝냄('닫았습니다');
    띄운것들.delete(this);
    try {
      this.kid?.stdin?.end();
      this.kid?.kill();
      // 자식이 살아 있으면 우리 프로그램이 안 끝난다.
      this.kid?.unref?.();
    } catch { /* 이미 죽었다 */ }
  }
}

/**
 * 우리 환경변수를 통째로 넘기지 않는다.
 *
 * DEEL_* 에는 게이트웨이 열쇠가 들어 있을 수 있고, 그 값이 남의 프로세스로
 * 넘어가면 어디로 가는지 우리가 알 수 없다. 프로그램이 도는 데 꼭 필요한
 * 것만 남긴다.
 */
export function 깨끗한환경() {
  const 남길것 = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'SystemRoot', 'windir', 'COMSPEC', 'LANG', 'LC_ALL', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramData', 'NODE_PATH'];
  const out = {};
  for (const k of 남길것) if (process.env[k] != null) out[k] = process.env[k];
  return out;
}

/*
 * Bash·Jobs 가 자식에게 넘길 환경은 **여기 없다** — safety/shellenv.js 다.
 *
 * 여기 `열쇠뺀환경()` 이 있었다. 우리 열쇠(DEEL_API_KEY · DEEL_KEY_*)만 빼고
 * 나머지를 통째로 넘겼는데, 그러면 OPENAI_API_KEY·GITHUB_TOKEN·DB_PASSWORD
 * 가 그대로 넘어간다. 모델이 `env | grep -i proxy` 를 한 번 부르면 — 사내
 * 프록시를 확인하는 아주 정상적인 행동이다 — 그 값들이 도구 결과에 실려
 * 게이트웨이로 나가고 대화 기록으로 디스크에도 남는다.
 *
 * 두 벌로 두지 않고 옮겼다. 같은 판단이 두 자리에 있으면 늘 한쪽만 고쳐진다.
 */

/** 우리 도구 이름과 안 부딪히게 앞에 서버 이름을 붙인다. Claude Code 와 같은 꼴이다. */
export const 도구이름 = (서버, 도구) => `mcp__${서버}__${도구}`;

/** 붙인 이름에서 서버와 도구를 도로 뗀다. */
export function 이름풀기(전체) {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(String(전체 ?? ''));
  return m ? { 서버: m[1], 도구: m[2] } : null;
}

/**
 * 설정에 적힌 서버를 전부 띄운다.
 *
 * 하나가 안 떠도 나머지는 쓴다 — 서버 하나 때문에 프로그램이 못 뜨면 안 된다.
 * 안 뜬 것은 **안 떴다고 말한다.** 조용히 빠지면 "왜 그 도구가 없지" 를
 * 영영 알 수 없다.
 */
export async function 다붙이기(root, { offline = false, timeout = 붙기제한, audit = null, env = process.env } = {}) {
  const 설정 = 설정읽기(root);
  if (설정.오류) return { 서버들: [], 못한것: [{ 이름: '(설정)', 왜: 설정.오류 }], 설정 };
  // 규격 때문에 안 받은 것은 어느 길로 끝나든 같이 내놓는다 (설정읽기 머리말).
  const 안받은것 = 설정.못받은것 ?? [];
  if (!설정.서버들.length) return { 서버들: [], 못한것: [...안받은것], 설정 };

  /*
   * ── 믿는 폴더에서만 띄운다 ──────────────────────────────────────────
   *
   * 이 파일 머리말은 네 가지를 약속하는데(기본 꺼짐 · 자물쇠면 안 띄움 ·
   * 감사기록 · 범위 밖이라고 말함) **정작 제일 앞 문은 없었다.**
   *
   * `mcp.json` 은 프로젝트 폴더에 있고, 그러니 **저장소에 같이 딸려 온다.**
   * 남의 저장소를 clone 하고 그 안에서 deel 을 켜면, 거기 적힌 `command` 가
   * 이 계정 권한으로 자식 프로세스가 된다. 도구 승인 화면은 안 거친다 —
   * 모델이 부른 것이 아니라 우리가 「서버를 띄우려고」 부른 것이기 때문이다.
   *
   *     { "mcpServers": { "sync": { "command": "cmd", "args": ["/c", "…"] } } }
   *
   * 훅(safety/hooks.js)은 정확히 이 위협에 대해 `믿나(root)` 를 강제하고,
   * 그 파일 머리말은 「MCP 와 같은 무게로 다룬다」 고 적어 두었다. 그런데
   * 무게를 견주던 쪽에 그 문이 없었다. 프로젝트 설정(config.js)도 같은 문을
   * 지나간다 — 남의 프로그램을 띄우는 이 자리가 셋 중 제일 무거운데 혼자
   * 그냥 열려 있었다.
   *
   * 안 믿으면 **조용히 넘어가지 않는다.** 못 붙였다고 화면에 그대로 말하고,
   * 어떻게 하면 되는지(deel trust)까지 같이 말한다.
   */
  if (!믿나(root, { env })) {
    return {
      서버들: [],
      못한것: [...안받은것, ...설정.서버들.map((s) => ({
        이름: s.이름,
        왜: '믿는 폴더가 아닙니다 — 남의 저장소에 딸려 온 설정일 수 있어 안 띄웁니다 (deel trust)',
      }))],
      설정,
      안믿음: true,
    };
  }

  // 자물쇠가 걸려 있으면 아예 안 띄운다. 자식 프로세스가 어디로 나가는지
  // 우리는 못 막는다 — 막을 수 없는 것을 막았다고 말하지 않는다.
  if (offline) {
    return {
      서버들: [],
      못한것: [...안받은것, ...설정.서버들.map((s) => ({ 이름: s.이름, 왜: '오프라인 잠금 중에는 안 띄웁니다' }))],
      설정,
      잠김: true,
    };
  }

  /*
   * ── 적어 둔 목록이 있으면 안 띄운다 ─────────────────────────────────
   *
   * 지문과 나이를 본 다음, 쓸 만하면 그 목록으로 세워 두기만 한다. 그 서버는
   * 제 도구가 처음 불릴 때 뜬다(MCP서버.깨우기).
   *
   * 끄는 길을 둔다 — `DEEL_MCP_LAZY=off`. 사내에서 「켤 때 다 뜨는지」 를
   * 확인해야 하는 자리가 있고, 그때 끌 방법이 없으면 이 기능이 곧 걸림돌이
   * 된다. 그리고 무엇이 대기 중인지는 /mcp 가 말한다 — 안 말하면 사람은
   * 서버가 안 떴다고 여긴다.
   */
  const 게으르게 = String(env.DEEL_MCP_LAZY ?? '').trim().toLowerCase() !== 'off';
  const 메모들 = 게으르게 ? 메모읽기(root) : {};

  const 붙은것 = [];
  const 못한것 = [...안받은것];
  let 새로띄운게있나 = false;
  await Promise.all(설정.서버들.map(async (s) => {
    const 서버 = new MCP서버(s);
    const 메모 = 쓸만한메모(메모들[s.이름], s);
    if (메모) {
      붙은것.push(서버.메모로세우기(메모, root));
      audit?.write?.('mcp', { 이름: s.이름, command: s.command, 도구: 서버.도구.length, 대기: true });
      return;
    }
    const ok = await 서버.붙기({ timeout });
    if (ok) {
      새로띄운게있나 = true;
      붙은것.push(서버);
      audit?.write?.('mcp', { 이름: s.이름, command: s.command, 도구: 서버.도구.length });
    } else {
      못한것.push({ 이름: s.이름, 왜: 서버.죽음 ?? '알 수 없는 이유' });
      서버.닫기();
    }
  }));
  붙은것.sort((a, b) => a.이름.localeCompare(b.이름));
  /*
   * 이번에 정말 띄운 것이 하나라도 있으면 적어 둔다.
   *
   * 대기 중인 것은 이미 적혀 있던 그대로라 다시 안 적는다 — 그러면 적은때가
   * 매번 새로 찍혀서 「일주일이면 다시 확인한다」 가 영영 안 온다. 그건 세 겹
   * 그물 중 하나를 우리 손으로 걷는 것이다.
   */
  if (게으르게 && 새로띄운게있나) {
    // 대기 중인 것은 안 넘긴다(적은때를 새로 찍으면 안 된다). 그래도 그 메모는
    // 안 지워진다 — 메모쓰기 가 겹쳐 쓴다(그 머리말).
    메모쓰기(root, 붙은것.filter((s) => !s.대기), { 남길이름: 설정.서버들.map((s) => s.이름) });
  }
  return { 서버들: 붙은것, 못한것, 설정, 게으르게 };
}

/** 모델에게 넘길 도구 정의로 바꾼다. */
export function 도구정의(서버들) {
  const out = [];
  for (const s of 서버들) {
    for (const t of s.도구) {
      out.push({
        type: 'function',
        function: {
          name: 도구이름(s.이름, t.name),
          description: `[${s.이름}] ${t.description ?? t.name}`,
          parameters: t.inputSchema ?? { type: 'object', properties: {} },
        },
      });
    }
  }
  return out;
}
