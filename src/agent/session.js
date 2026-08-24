// 대화 상태와 컨텍스트 셈. /context 가 보여주는 숫자가 여기서 나온다.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { get as workMode, DEFAULT as WORK_DEFAULT } from './modes.js';

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
- 명령 실행이 필요하면 Bash 를 쓴다. 되돌릴 수 없는 명령은 막히니 다른 방법을 찾는다.
- 사용자에게 답할 때는 한국어로, 짧게. 코드를 통째로 붙여넣지 말고 무엇이 달라졌는지 말한다.`;

export class Session {
  constructor(conn, { root, mode = 'auto', work = null, think = 'medium', effort = 'save', web = true, maxSteps = 24 } = {}) {
    this.conn = conn;
    this.root = root;
    this.mode = mode;        // 승인 정책 — 얼마나 물어보나 (auto/confirm/strict)
    this.work = work ?? WORK_DEFAULT;   // 작업 모드 — 무슨 일을 하는 중인가 (modes.js)
    this.think = think;      // 기준 강도
    this.effort = effort;    // 그 강도를 단계별로 어떻게 나눌지 (effort.js)
    this.web = web;          // 웹 읽기 도구를 줄지 (오프라인이면 무조건 안 준다)
    this.maxSteps = maxSteps;
    this.messages = [];
    this.filesRead = new Map();   // 경로 → 추정 토큰
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

  systemPrompt() {
    const parts = [BASE_RULES];
    parts.push(`\n작업 폴더: ${this.root}\n이 폴더 밖의 파일은 읽지도 쓰지도 못한다.`);

    // 지금 무슨 일을 하는 중인지. 도구 목록도 이 모드에 맞춰 이미 걸러져 있다.
    const w = workMode(this.work);
    parts.push(`\n--- 지금 모드: ${w.name} (${w.en}) ---\n${w.say}`);
    if (this.rules) parts.push(`\n--- ${this.rules.name} (사용자 규칙, 위 원칙보다 우선) ---\n${this.rules.text}`);
    const listed = this.listedSkills();
    if (listed.length) {
      parts.push(
        '\n--- 쓸 수 있는 스킬 ---\n' +
        '필요한 것이 있으면 Skill 도구로 이름을 불러 본문을 받아라. 없으면 그냥 진행해라.\n' +
        listed.map((s) => `- ${s.name}: ${s.description.slice(0, this.maxSkillDesc)}`).join('\n')
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

  // 모델에 실제로 보낼 배열.
  wire() {
    return [{ role: 'system', content: this.systemPrompt() }, ...this.messages];
  }

  // /context 가 그릴 내역.
  breakdown() {
    const sys = estimateTokens(BASE_RULES) + estimateTokens(`작업 폴더: ${this.root}`);
    const rules = this.rules ? estimateTokens(this.rules.text) : 0;
    const listed = this.listedSkills();
    const skills = listed.length
      ? estimateTokens(listed.map((s) => `${s.name}: ${s.description.slice(0, this.maxSkillDesc)}`).join('\n'))
      : 0;

    let history = 0;
    let files = 0;
    for (const m of this.messages) {
      const t = estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''))
        + estimateTokens(JSON.stringify(m.tool_calls ?? ''));
      if (m.role === 'tool') files += t; else history += t;
    }

    const rows = [
      { label: '시스템 프롬프트', n: sys },
      { label: this.rules ? `규칙 (${this.rules.name})` : '규칙 (없음)', n: rules },
      { label: `스킬 목록 (${listed.length}/${this.skills.length}개)`, n: skills },
      { label: '대화 이력', n: history },
      { label: `도구 결과 (파일 ${this.filesRead.size}개)`, n: files },
    ];
    const used = rows.reduce((a, r) => a + r.n, 0);
    const total = this.conn.ctx ?? 32768;
    return { rows, used, total, left: Math.max(0, total - used) };
  }

  // 오래된 대화를 잘라낸다. 앞의 2턴과 최근 절반만 남긴다.
  trim() {
    if (this.messages.length < 12) return 0;
    const keepHead = 2;
    const keepTail = Math.floor(this.messages.length / 2);
    const dropped = this.messages.length - keepHead - keepTail;
    if (dropped <= 0) return 0;
    this.messages = [
      ...this.messages.slice(0, keepHead),
      { role: 'user', content: `(앞선 대화 ${dropped}개를 줄였습니다. 필요하면 파일을 다시 읽으세요.)` },
      ...this.messages.slice(-keepTail),
    ];
    return dropped;
  }
}
