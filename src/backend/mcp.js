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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from '../version.js';

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
  for (const [이름, v] of Object.entries(표)) {
    if (v?.disabled === true) continue;
    // stdio 만 받는다. http/sse 규격은 바깥으로 나가는 것이라 자물쇠와 부딪힌다.
    if (v?.type && v.type !== 'stdio') continue;
    if (!v?.command) continue;
    서버들.push({
      이름,
      command: String(v.command),
      args: Array.isArray(v.args) ? v.args.map(String) : [],
      env: v.env && typeof v.env === 'object' ? v.env : null,
      cwd: v.cwd ? String(v.cwd) : root,
    });
  }
  return { 서버들, 자리: p, 있음: true };
}

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
  }

  살아있나() { return !!this.kid && this.kid.exitCode === null && !this.죽음; }

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
    if (j.error) 기다림.실패(new Error(j.error.message ?? '알 수 없는 오류'));
    else 기다림.성공(j.result);
  }

  보내고기다리기(method, params, timeout = 부르기제한) {
    return new Promise((성공, 실패) => {
      if (!this.kid || this.kid.exitCode !== null) return 실패(new Error(this.죽음 ?? '연결이 없습니다'));
      const id = this.다음번호++;
      const 타이머 = setTimeout(() => {
        this.기다리는것.delete(id);
        실패(new Error(`${Math.round(timeout / 1000)}초 안에 답이 없습니다`));
      }, timeout);
      if (타이머.unref) 타이머.unref();
      this.기다리는것.set(id, { 성공, 실패, 타이머 });
      try {
        this.kid.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      } catch (e) {
        clearTimeout(타이머);
        this.기다리는것.delete(id);
        실패(e);
      }
    });
  }

  알림(method, params) {
    try { this.kid?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); } catch { /* 죽었으면 어차피 끝이다 */ }
  }

  async 부르기(도구이름, args, { timeout = 부르기제한 } = {}) {
    const r = await this.보내고기다리기('tools/call', { name: 도구이름, arguments: args ?? {} }, timeout);
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
      기다림.실패(new Error(this.죽음));
    }
    this.기다리는것.clear();
  }

  닫기() {
    this.끝냄('닫았습니다');
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
function 깨끗한환경() {
  const 남길것 = ['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'SystemRoot', 'windir', 'COMSPEC', 'LANG', 'LC_ALL', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramData', 'NODE_PATH'];
  const out = {};
  for (const k of 남길것) if (process.env[k] != null) out[k] = process.env[k];
  return out;
}

/**
 * 게이트웨이 열쇠 **하나만** 뺀 환경. Bash 와 Jobs 가 자식에게 넘길 것.
 *
 * 위 깨끗한환경 은 남의 프로그램(MCP 서버)에 주는 것이라 통째로 씻는다.
 * 여기는 다르다 — Bash 로 도는 것은 **사용자 제 프로젝트**다. PATH·NODE_ENV·
 * DEEL_HOME·사내 프록시 설정이 다 있어야 하고(사용자는 이 프로그램의 검사
 * 자체를 Bash 로 돌린다), 하나라도 빠지면 「내 터미널에서는 되는데」 가 된다.
 *
 * 그래서 딱 하나만 뺀다. 안 빼면 `env` 한 줄로 열쇠가 화면에 찍히고, 그 화면이
 * 대화에 실려 게이트웨이로 나가고 `.deel/sessions/*.jsonl` 로 디스크에도 남는다 —
 * 열쇠를 그 열쇠의 주인에게 보내는 셈이다(guard.js 가 막는 것과 같은 길).
 * 자식이 무엇을 하든 이 값이 필요할 일은 없다. 게이트웨이로 나가는 것은 우리다.
 */
export function 열쇠뺀환경(env = process.env) {
  const out = { ...env };
  delete out.DEEL_API_KEY;
  return out;
}

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
export async function 다붙이기(root, { offline = false, timeout = 붙기제한, audit = null } = {}) {
  const 설정 = 설정읽기(root);
  if (설정.오류) return { 서버들: [], 못한것: [{ 이름: '(설정)', 왜: 설정.오류 }], 설정 };
  if (!설정.서버들.length) return { 서버들: [], 못한것: [], 설정 };

  // 자물쇠가 걸려 있으면 아예 안 띄운다. 자식 프로세스가 어디로 나가는지
  // 우리는 못 막는다 — 막을 수 없는 것을 막았다고 말하지 않는다.
  if (offline) {
    return {
      서버들: [],
      못한것: 설정.서버들.map((s) => ({ 이름: s.이름, 왜: '오프라인 잠금 중에는 안 띄웁니다' })),
      설정,
      잠김: true,
    };
  }

  const 붙은것 = [];
  const 못한것 = [];
  await Promise.all(설정.서버들.map(async (s) => {
    const 서버 = new MCP서버(s);
    const ok = await 서버.붙기({ timeout });
    if (ok) {
      붙은것.push(서버);
      audit?.write?.('mcp', { 이름: s.이름, command: s.command, 도구: 서버.도구.length });
    } else {
      못한것.push({ 이름: s.이름, 왜: 서버.죽음 ?? '알 수 없는 이유' });
      서버.닫기();
    }
  }));
  붙은것.sort((a, b) => a.이름.localeCompare(b.이름));
  return { 서버들: 붙은것, 못한것, 설정 };
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
