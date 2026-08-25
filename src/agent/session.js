// 대화 상태와 컨텍스트 셈. /context 가 보여주는 숫자가 여기서 나온다.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { get as workMode, DEFAULT as WORK_DEFAULT } from './modes.js';
import { toolSchemas } from '../tools/index.js';
import { normalize as normLevel, DEFAULT as LEVEL_DEFAULT } from '../ui/level.js';

// 토큰 추정 — 정확한 토크나이저 없이 대략만 센다.
// 한글은 글자당 약 1토큰, 영문·코드는 약 4글자당 1토큰으로 본다.
export function estimateTokens(text) {
  const s = String(text ?? '');
  let cjk = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x4e00 && cp <= 0x9fff)) cjk++;
  }
  const rest = s.length - cjk;
  return Math.ceil(cjk + rest / 3.6);
}

const BASE_RULES = `너는 deel 다. 사용자의 작업 폴더 안에서 코드를 읽고 고치는 도구다.

원칙:
- 추측하지 말고 도구로 확인한다. 파일을 고치기 전에는 반드시 Read 로 읽는다.
- Edit 의 old_string 은 공백과 들여쓰기까지 파일과 정확히 같아야 한다. 짧게 자르지 말고 앞뒤로 넉넉히 포함한다.
- 한 번에 하나씩 고치고, 고친 뒤에는 무엇을 왜 고쳤는지 한 줄로 말한다.
- 큰 파일은 한 번에 다 담지 않는다. 앞부분 300줄쯤을 Write 로 만들고, 나머지는 Append 를
  여러 번 불러 끝까지 이어 붙인다. Append 는 Read 없이 바로 쓸 수 있다.
  이어 붙일 때 앞부분을 다시 보내지 않는다 — 그러면 또 같은 자리에서 잘린다.
- 같은 도구를 같은 인자로 다시 부르지 않는다. 결과는 같다. 본 것은 기억하고 다음으로 넘어간다.
- 사용자가 볼 범위를 좁혀 말하면 그대로 따른다. 시키지 않은 폴더를 뒤지지 않는다.
- 명령 실행이 필요하면 Bash 를 쓴다. 되돌릴 수 없는 명령은 막히니 다른 방법을 찾는다.
- 사용자에게 답할 때는 한국어로, 짧게. 코드를 통째로 붙여넣지 말고 무엇이 달라졌는지 말한다.`;

export class Session {
  constructor(conn, { root, mode = 'auto', work = null, level = null, think = 'medium', effort = 'save', web = true, maxSteps = 24 } = {}) {
    this.conn = conn;
    this.root = root;
    this.mode = mode;        // 승인 정책 — 얼마나 물어보나 (auto/confirm/strict)
    this.work = work ?? WORK_DEFAULT;   // 작업 모드 — 무슨 일을 하는 중인가 (modes.js)
    // 이번 한마디에만 쓸 모드. 종합 모드일 때 요청을 보고 골라 넣는다 (agent/route.js).
    // 기본 모드(this.work)는 안 건드린다 — 다음 한마디는 다시 처음부터 고른다.
    this.routed = null;
    // 사용자 수준 — 화면에 무엇을 내놓을지만 정한다. 안전 장치는 안 바꾼다 (ui/level.js)
    this.level = normLevel(level) ?? LEVEL_DEFAULT;
    this.think = think;      // 기준 강도
    this.effort = effort;    // 그 강도를 단계별로 어떻게 나눌지 (effort.js)
    this.web = web;          // 웹 읽기 도구를 줄지 (오프라인이면 무조건 안 준다)
    this.maxSteps = maxSteps;
    this.messages = [];
    this.filesRead = new Map();   // 경로 → 추정 토큰
    this.changes = new Map();     // 경로 → {added, removed, times}. /diff 가 본다
    this.skills = [];             // 켜질 때 이 PC 에서 찾은 것들
    this.commands = [];
    this.plugins = [];
    this.maxSkillsListed = 40;    // 프롬프트에 올릴 최대 개수
    this.maxSkillDesc = 140;      // 설명 한 줄 최대 길이
    this.usage = { in: 0, out: 0, calls: 0, ms: 0 };
    this.startedAt = Date.now();
    this.rules = this.#loadRules();
  }

  #loadRules() {
    for (const name of ['DEEL.md', 'CLAUDE.md', 'AGENTS.md']) {
      const p = join(this.root, name);
      if (existsSync(p)) {
        try { return { name, text: readFileSync(p, 'utf8').slice(0, 20000) }; } catch {}
      }
    }
    return null;
  }

  /**
   * 지금 이 순간 실제로 쓰는 작업 모드.
   *
   * 종합 모드에서는 한마디마다 골라 넣은 것(routed)이 있고, 그때는 그것이 답이다.
   * 직접 고른 모드가 있으면 routed 는 비어 있으므로 기본 모드가 그대로 답이 된다.
   * 도구·추론·프롬프트가 전부 이 값을 봐야 한다. 하나라도 빠뜨리면 어긋난다.
   */
  effectiveWork() {
    return this.routed ?? this.work;
  }

  systemPrompt() {
    const parts = [BASE_RULES];
    parts.push(`\n작업 폴더: ${this.root}\n이 폴더 밖의 파일은 읽지도 쓰지도 못한다.`);

    // 지금 무슨 일을 하는 중인지. 도구 목록도 이 모드에 맞춰 이미 걸러져 있다.
    const w = workMode(this.effectiveWork());
    parts.push(`\n--- 지금 모드: ${w.name} (${w.en}) ---\n${w.say}`);
    if (this.rules) parts.push(`\n--- ${this.rules.name} (사용자 규칙, 위 원칙보다 우선) ---\n${this.rules.text}`);
    const listed = this.listedSkills();
    if (listed.length) {
      parts.push(
        '\n--- 쓸 수 있는 스킬 ---\n' +
        '필요한 것이 있으면 Skill 도구로 이름을 불러 본문을 받아라. 없으면 그냥 진행해라.\n' +
        // 설명이 없는 스킬이 섞일 수 있다 — 남의 폴더에서 오는 파일이라
        // 앞머리(frontmatter)가 빠지곤 한다. 여기서 터지면 시스템 프롬프트를
        // 못 만들어 **매 턴** 죽는다. 목록 명령 하나가 아니라 대화 전체가 막힌다.
        listed.map((s) => `- ${s.name}: ${String(s.description ?? '').slice(0, this.maxSkillDesc)}`).join('\n')
      );
      const rest = this.skills.filter((s) => s.enabled).length - listed.length;
      if (rest > 0) parts.push(`(그 밖에 ${rest}개가 더 있으나 자리가 모자라 안 실었다.)`);
    }
    return parts.join('\n');
  }

  // 프롬프트에 실제로 올릴 스킬: 가까운 자리(프로젝트 > 사용자 > 플러그인) 순으로 상한까지.
  listedSkills() {
    const rank = { project: 0, user: 1, plugin: 2 };
    return this.skills
      .filter((s) => s.enabled)
      .slice()
      .sort((a, b) => (rank[a.source] ?? 3) - (rank[b.source] ?? 3))
      .slice(0, this.maxSkillsListed);
  }

  push(msg) { this.messages.push(msg); return this; }
  clear() { this.messages = []; this.filesRead.clear(); return this; }

  noteRead(path, text) { this.filesRead.set(path, estimateTokens(text)); }

  /**
   * 이번 대화에서 어느 파일이 얼마나 바뀌었는지 적어 둔다. /diff 가 이걸 본다.
   *
   * 견준 결과를 통째로 들고 있지는 않는다 — 파일 내용 두 벌이 딸려 온다.
   * 스무 번 고치면 그것만으로 수십 MB 다. 여기서는 숫자만 센다.
   */
  noteChange(path, d) {
    if (!path || !d) return;
    const 앞 = this.changes.get(path) ?? { added: 0, removed: 0, times: 0 };
    앞.added += d.added ?? 0;
    앞.removed += d.removed ?? 0;
    앞.times += 1;
    this.changes.set(path, 앞);
  }

  // 모델에 실제로 보낼 배열.
  wire() {
    return [{ role: 'system', content: this.systemPrompt() }, ...this.messages];
  }

  /**
   * /context 가 그릴 내역.
   *
   * 여기서 나온 used 는 화면 숫자로만 쓰이는 게 아니다. effort.js 가 이 값으로
   * '남은 자리' 를 셈해 출력 상한을 정한다. 그래서 여기서 덜 세면 **매 요청마다
   * 그만큼 몰래 나간다** — 다 찼는데 안 찼다고 알고 있는 상태가 된다.
   *
   * 전에는 두 가지를 안 셌다.
   *   · 도구 스키마 JSON — 도구 9종의 설명과 인자 정의. 약 1,400토큰이다.
   *     매 요청에 통째로 들어가는데 어느 칸에도 안 잡혔다.
   *   · 지금 모드 문구 — modes.js 의 say. 모드마다 수백 토큰이다.
   */
  breakdown() {
    const sys = estimateTokens(BASE_RULES) + estimateTokens(`작업 폴더: ${this.root}`)
      + estimateTokens(workMode(this.effectiveWork()).say ?? '');
    const rules = this.rules ? estimateTokens(this.rules.text) : 0;
    const listed = this.listedSkills();
    const skills = listed.length
      ? estimateTokens(listed.map((s) => `${s.name}: ${String(s.description ?? '').slice(0, this.maxSkillDesc)}`).join('\n'))
      : 0;

    let history = 0;
    let files = 0;
    for (const m of this.messages) {
      const t = estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''))
        + estimateTokens(JSON.stringify(m.tool_calls ?? ''));
      if (m.role === 'tool') files += t; else history += t;
    }

    // 도구 정의도 매 요청에 실려 나간다. 세는 값이라기보다 '이미 나간 값' 이다.
    const 도구 = this.#도구토큰();

    const rows = [
      { label: '시스템 프롬프트', n: sys },
      { label: this.rules ? `규칙 (${this.rules.name})` : '규칙 (없음)', n: rules },
      { label: `스킬 목록 (${listed.length}/${this.skills.length}개)`, n: skills },
      { label: '도구 정의', n: 도구 },
      { label: '대화 이력', n: history },
      { label: `도구 결과 (파일 ${this.filesRead.size}개)`, n: files },
    ];
    const used = rows.reduce((a, r) => a + r.n, 0);
    const total = this.conn.ctx ?? 32768;
    return { rows, used, total, left: Math.max(0, total - used) };
  }

  /**
   * 도구 정의가 몇 토큰인가.
   *
   * 모드가 바뀌면 도구 목록도 바뀌므로 모드별로 한 번씩만 재고 넣어 둔다.
   * 매 턴 JSON.stringify 를 하면 그 자체가 아깝다 — 값은 안 바뀌는데.
   */
  #도구잰것 = new Map();
  #도구토큰() {
    const 열쇠 = `${this.effectiveWork()}|${this.skills?.length ? 'skill' : ''}|${this.web !== false ? 'web' : ''}`;
    if (this.#도구잰것.has(열쇠)) return this.#도구잰것.get(열쇠);
    let n = 0;
    try {
      const list = toolSchemas(null, {
        hasSkills: (this.skills?.length ?? 0) > 0,
        web: this.web !== false,
        work: this.effectiveWork(),
      });
      n = estimateTokens(JSON.stringify(list));
    } catch { n = 0; }
    this.#도구잰것.set(열쇠, n);
    return n;
  }

  /**
   * 오래된 대화를 잘라낸다. 앞의 2턴과 최근 절반만 남긴다.
   *
   * 자르는 자리를 **아무 데나 잡으면 안 된다.** 도구 호출과 그 결과는 한 몸이라,
   * 사이를 끊으면 규격 위반이 되어 그 뒤 모든 요청이 400 으로 거절당한다.
   *
   * 이게 실제로 있었던 길이다 — 접기(compact)가 요약을 못 받으면 여기로
   * 물러섰는데, 여기가 짝을 안 맞췄다. 화면에는 노란 안내 한 줄이 뜨고,
   * 그 뒤로 무엇을 해도 400 이 났다. 원인은 두 화면 전이라 이어 붙일 수 없고,
   * /clear 말고는 길이 없었다. 물러설 자리가 더 큰 사고를 만든 셈이다.
   */
  trim() {
    if (this.messages.length < 12) return 0;
    const keepHead = safeHead(this.messages, 2);
    const keepTail = safeCut(this.messages, this.messages.length - Math.floor(this.messages.length / 2));
    const dropped = keepTail - keepHead;
    if (dropped <= 0) return 0;
    this.messages = [
      ...this.messages.slice(0, keepHead),
      { role: 'user', content: `(앞선 대화 ${dropped}개를 줄였습니다. 필요하면 파일을 다시 읽으세요.)` },
      ...this.messages.slice(keepTail),
    ];
    return dropped;
  }
}

/**
 * 도구 호출과 결과가 갈라지지 않는 자리를 찾는다.
 * i 번째부터 남긴다고 할 때, 안전한 i 로 옮겨 준다.
 *
 * 접기(compact.js)와 그냥 줄이기(trim)가 **같은 함수**를 쓴다. 전에는 접기에만
 * 있었고 줄이기는 제멋대로 잘랐다. 그래서 접기가 실패해 줄이기로 물러선 순간
 * 대화가 망가졌다 — 안전망이 사고를 만드는 자리는 늘 이런 모양이다.
 */
export function safeCut(messages, i) {
  let k = Math.max(0, Math.min(i, messages.length));
  // tool 결과로 시작하면 그 앞의 assistant(tool_calls) 가 없어 규격이 깨진다. 앞으로 당긴다.
  while (k > 0 && messages[k]?.role === 'tool') k--;
  return k;
}

/**
 * 머리 쪽 자르는 자리.
 * 머리가 '결과를 기다리는 도구 호출' 로 끝나면 그 결과가 접혀 없어져 짝이 깨진다.
 * 그런 assistant 는 머리에서 뺀다 — 접히는 쪽에 같이 넘긴다.
 */
export function safeHead(messages, k) {
  let h = Math.max(0, Math.min(k, messages.length));
  while (h > 0 && messages[h - 1]?.tool_calls?.length) h--;
  return h;
}
