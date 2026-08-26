// 대화 상태와 컨텍스트 셈. /context 가 보여주는 숫자가 여기서 나온다.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { get as workMode, 말 as 모드말, DEFAULT as WORK_DEFAULT } from './modes.js';
import { toolSchemas } from '../tools/index.js';
import { normalize as normLevel, DEFAULT as LEVEL_DEFAULT } from '../ui/level.js';
import { 매김, 급말, 값 as 급값, 지켜본것 } from './grade.js';
import { 지문 } from './project.js';
import { 프롬프트토막 as 기억토막 } from './memory.js';
import { 못박기 } from './pins.js';

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

시킨 일을 **끝까지 해낸다.** 계획만 세우고 멈추지 않는다.

- 바로 시작한다. 없는 파일·폴더는 만든다. 그게 시킨 일의 일부다.
- 되묻는 것은 **도구로도 못 알아낼 때뿐**이다. 정할 수 있으면 정하고 무엇으로 정했는지 말한다.
- 여러 파일을 만들고 나눠 담아야 하는 일이면 그렇게 한다. 하나만 건드려 놓고 멈추지 마라.
- 다 했으면 확인한다. 돌려 보고 안 되면 고친다. 확인 못 했으면 "확인 못 했다" 고 말한다.

지키는 것:
- 추측하지 말고 도구로 확인한다. 있는 파일을 고치기 전에는 반드시 Read 로 읽는다.
- Edit 의 old_string 은 공백과 들여쓰기까지 파일과 정확히 같아야 한다. 짧게 자르지 말고 앞뒤로 넉넉히 포함한다.
- 큰 파일은 한 번에 다 담지 않는다. 앞부분 300줄쯤을 Write 로 만들고, 나머지는 Append 를
  여러 번 불러 끝까지 이어 붙인다. Append 는 Read 없이 바로 쓸 수 있다.
  이어 붙일 때 앞부분을 다시 보내지 않는다 — 그러면 또 같은 자리에서 잘린다.
- 같은 도구를 같은 인자로 다시 부르지 않는다. 결과는 같다. 본 것은 기억하고 다음으로 넘어간다.
- 사용자가 볼 범위를 못 박아 말하면 그 범위를 지킨다. 안 그러면 필요한 만큼 찾아본다.
- 명령 실행이 필요하면 Bash 를 쓴다. 되돌릴 수 없는 명령은 막히니 다른 방법을 찾는다.
- 사용자에게 답할 때는 한국어로, 짧게. 코드를 통째로 붙여넣지 말고 무엇이 달라졌는지 말한다.

다음에도 쓸 것은 남긴다:
- 사용자가 규칙을 정하거나 하지 말라고 하면 Remember 로 한 줄 남긴다. 그 글은 앞으로
  모든 요청에 실리니 한 문장으로. 이번 일에서만 쓰는 것은 안 남긴다.
- "저번에"·"전에 정한 대로" 처럼 앞선 대화를 가리키면 되묻기 전에 Recall 로 찾는다.
- 또 하게 될 절차를 끝냈으면 .deel/skills/<이름>/SKILL.md 로 적어 둔다.
  앞머리에 name 과 description 을 넣고(--- 로 감싼다) 아래에 순서를 적는다.
  쓰던 스킬에서 틀린 데를 찾으면 그 파일을 고친다.`;

/*
 * 작은 창을 위한 짧은 판.
 *
 * 같은 규칙이다 — 빠진 것은 없고, 설득하는 문장만 없다. 8k 모델에서 위의 긴
 * 판은 창의 13% 를 먹는데, 그 자리는 대화가 써야 하는 자리다.
 *
 * 짧게 쓰되 **더 못 박아** 쓴다. 작은 모델이 못하는 것이 '긴 글을 끝까지
 * 따라가기' 라서, 짧고 단정적인 쪽이 오히려 잘 지켜진다. (grade.js 도 같은
 * 생각으로 되어 있다 — 거기는 급, 여기는 창 크기라는 점만 다르다.)
 */
const BASE_RULES_짧게 = `너는 deel 다. 사용자의 작업 폴더에서 코드를 읽고 고친다.

시킨 일을 끝까지 해낸다. 계획만 내고 멈추지 마라.
- 바로 시작한다. 없는 파일·폴더는 만든다.
- 도구로 알아낼 수 있으면 되묻지 말고 정한다. 무엇으로 정했는지는 말한다.
- 파일이 여럿이면 다 만든다. 하나만 하고 멈추지 마라.
- 끝내기 전에 Verify 로 확인한다. 확인 못 했으면 "확인 못 했다" 고 말한다.

- 고칠 파일은 먼저 Read 한다.
- Edit 의 old_string 은 공백까지 파일과 똑같아야 한다. 앞뒤를 넉넉히 넣어라.
- 긴 파일은 Write 로 앞부분만, 나머지는 Append 로 잇는다. 앞부분을 다시 보내지 마라.
- 같은 도구를 같은 인자로 또 부르지 마라. 결과는 같다.
- 답은 한국어로 짧게. 코드를 통째로 붙여넣지 마라.
- 사용자가 정한 규칙은 Remember 로 한 줄 남긴다. "저번에" 라고 하면 Recall 로 찾는다.`;

/**
 * 이 창 크기에 맞는 기본 규칙.
 *
 * 24k 를 경계로 삼는다. 그 아래에서는 긴 판이 창의 10% 를 넘어가기 시작한다 —
 * 도구 정의(budget.js 의 설명길이)가 줄어드는 자리와 같은 경계다. 두 개가
 * 같이 움직여야 '작은 창에서는 고정 몫을 줄인다' 가 한 가지 결정이 된다.
 */
function 기본규칙(ctx) {
  return Number(ctx) > 0 && Number(ctx) < 24000 ? BASE_RULES_짧게 : BASE_RULES;
}

export class Session {
  constructor(conn, { root, mode = 'auto', work = null, level = null, think = 'medium', effort = 'save', web = true, maxSteps = null } = {}) {
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
    /*
     * 걸음 수 상한.
     *
     * 보통은 **작업 모드가 정한다** — 묻기는 8, 코드는 60, 총괄은 100 처럼
     * 일의 성격에 맞는 값이 다르기 때문이다. 여기 값은 부를 때 직접 준 경우에만
     * 이긴다(loop.js 가 stepsSet 을 본다).
     *
     * 전에는 stepsSet 을 아무 데서도 안 넣어서, 직접 준 값이 **조용히 무시**됐다.
     * 부르는 쪽에서는 4를 줬는데 60을 도는 식이라, 검사에서야 겨우 드러났다.
     */
    this.stepsSet = maxSteps != null;
    this.maxSteps = maxSteps ?? 24;
    this.messages = [];
    // 추정 × 보정 = 실제. 서버가 알려 주는 진짜 토큰 수로 매 턴 고쳐 나간다.
    // 1 은 '아직 안 배웠다' 이고, 그때는 추정을 그대로 쓴다. 배운다() 를 볼 것.
    this.보정 = 1;
    this.보정잰것 = 0;
    // 겪어 본 것 요약 (agent/evolve.js). 켤 때 repl 이 채운다.
    this.배움요약 = null;
    /*
     * 못 박은 것 (agent/pins.js).
     *
     * 여기에 두는 것이 핵심이다. messages 안에 넣으면 접기와 요약이 언젠가
     * 가져간다 — 그래서 아예 그 바깥, 시스템 프롬프트 쪽에 둔다.
     */
    this.못박은것 = new 못박기();
    this.filesRead = new Map();   // 경로 → 추정 토큰
    this.changes = new Map();     // 경로 → {added, removed, times}. /diff 가 본다
    this.skills = [];             // 켜질 때 이 PC 에서 찾은 것들
    this.commands = [];
    this.plugins = [];
    this.maxSkillsListed = 40;    // 프롬프트에 올릴 최대 개수
    this.maxSkillDesc = 140;      // 설명 한 줄 최대 길이
    this.usage = { in: 0, out: 0, calls: 0, ms: 0 };
    /*
     * 지금 붙은 모델이 얼마나 하는가 (agent/grade.js).
     *
     * 창 크기와는 다른 축이다. 창은 '얼마나 담나', 급은 '얼마나 알아서 하나'.
     * 128k 짜리 3B 모델과 32k 짜리 좋은 모델을 같은 값으로 다루면 둘 다 손해다.
     *
     * 처음에는 이름으로 짐작하고, 대화가 돌수록 **실제로 본 것**으로 고쳐 잡는다.
     * 사람이 /grade 로 정하면 그것이 이긴다.
     */
    this.본것 = new 지켜본것();
    this.급정한것 = null;
    this.startedAt = Date.now();
    this.rules = this.#loadRules();
    /*
     * 이 폴더가 무슨 프로젝트인가 (agent/project.js).
     *
     * 규칙(DEEL.md)과 같은 자리에서 읽는다 — 켤 때 한 번이다. 매 턴 다시 읽으면
     * 긴 대화에서 수십 번이 되고, 그 사이 사람이 package.json 을 고쳐 놓으면
     * 대화 도중에 프롬프트가 바뀐다. 무엇 때문에 답이 달라졌는지 알 길이 없어진다.
     */
    this.프로젝트 = 지문(this.root, this.conn?.ctx ?? null);
    /*
     * 지난 대화에서 정한 것도 여기서 읽는다.
     *
     * 전에는 대화 화면(repl.js)에서만 넣었다. 그래서 `deel run` — 야간 배치로
     * 도는 쪽 — 에는 기억이 안 실렸다. "우리 문서는 CP949 다" 를 사람이 앉아
     * 있을 때만 지키고 배치에서는 안 지키는 셈이라, 그게 제일 나쁜 어긋남이다.
     * 규칙과 같은 자리로 옮겨서 두 길이 같은 것을 들고 시작하게 한다.
     */
    this.memory = 기억토막(this.root);
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

  /** 지금 매겨진 모델 급. 화면과 프롬프트가 같은 것을 봐야 한다. */
  급() { return 매김(this.conn, this.본것, this.급정한것); }

  /** 이 급에서 쓸 손잡이 값들 (한 번에 만들 파일 수 같은 것). */
  급값() { return 급값(this.급().급); }

  systemPrompt() {
    const parts = [기본규칙(this.conn?.ctx)];
    parts.push(`\n작업 폴더: ${this.root}\n이 폴더 밖의 파일은 읽지도 쓰지도 못한다.`);

    // 지금 무슨 일을 하는 중인지. 도구 목록도 이 모드에 맞춰 이미 걸러져 있다.
    const w = workMode(this.effectiveWork());
    // 창이 좁으면 짧은 판을 쓴다 (modes.js 의 말()). 규칙은 같고 설득하는 문장만 빠진다.
    parts.push(`\n--- 지금 모드: ${w.name} (${w.en}) ---\n${모드말(this.effectiveWork(), this.conn?.ctx)}`);
    /*
     * 모델 급에 맞춘 한 문단 (grade.js).
     *
     * 큰 모델에는 아무것도 안 붙는다 — 이미 아는 것을 다시 읽느라 자리만 먹는다.
     * 작은 모델에만, 짧게, 못 박아서 붙는다. 그 급이 못하는 것이 바로
     * '긴 글을 끝까지 따라가기' 라서, 길게 쓰면 오히려 나빠진다.
     */
    const 급글 = 급말(this.급().급);
    if (급글) parts.push(`\n${급글}`);

    /*
     * 이 폴더가 무슨 프로젝트인가 (agent/project.js).
     *
     * 규칙보다 **앞에** 둔다. 사용자 규칙은 "이 프로젝트에서는 이렇게 해라" 는
     * 말이라, 무슨 프로젝트인지를 먼저 읽은 뒤에 와야 말이 이어진다.
     */
    if (this.프로젝트) parts.push(this.프로젝트);

    if (this.rules) parts.push(`\n--- ${this.rules.name} (사용자 규칙, 위 원칙보다 우선) ---\n${this.rules.text}`);

    /*
     * 지난 대화에서 정한 것.
     *
     * 이건 '찾으면 나오는' 것이 아니라 **처음부터 들어가 있어야** 하는 것이다.
     * "우리 문서는 CP949 다" 를 매번 다시 설명하게 하면 두 번째부터 짜증이 나고
     * 세 번째부터는 그냥 안 쓴다.
     *
     * 켤 때 한 번 읽어 들고 있는다. 매 턴 파일을 읽으면 긴 대화에서 그 횟수가
     * 수십 번이 되고, 그 사이 사람이 파일을 고쳐 놓으면 대화 도중에 규칙이
     * 바뀌는 셈이 된다 — 무엇 때문에 답이 달라졌는지 알 길이 없어진다.
     */
    if (this.memory) parts.push(this.memory);
    /*
     * 이 PC·이 폴더에서 겪어 본 것 (agent/evolve.js).
     *
     * 기억(memory)은 사람이 적어 주는 것이고, 이건 **겪어서 저절로 쌓인 것**이다.
     * 여기 한 줄이 헛도는 걸음 서너 개를 없앤다 — 안 되는 명령을 또 부르고,
     * 잘릴 걸 알면서 큰 Write 를 또 보내는 걸음들이다. 그래서 자리를 내줄 값이 있다.
     * 상한은 evolve.js 가 못 박는다(220토큰).
     */
    if (this.배움요약) parts.push(this.배움요약);
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
    /*
     * 못 박은 것은 **맨 끝**에 붙인다 (agent/pins.js).
     *
     * 긴 글의 가운데는 흘려 읽힌다 — 'lost in the middle' 이라 부르는 것이고,
     * 어느 모델에서나 잰다. 사람이 직접 못 박은 말은 그 가운데에 묻히면 안 되므로
     * 가장 마지막, 대화 바로 앞에 둔다.
     */
    const 못박은글 = this.못박은것?.요약();
    if (못박은글) parts.push(못박은글);
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
   *   · 도구 스키마 JSON — 도구 11종의 설명과 인자 정의. 약 1,800토큰이다.
   *     매 요청에 통째로 들어가는데 어느 칸에도 안 잡혔다.
   *   · 지금 모드 문구 — modes.js 의 say. 모드마다 수백 토큰이다.
   */
  /**
   * 추정을 실제에 맞춰 간다.
   *
   * estimateTokens 는 추정이다 — 토크나이저를 안 싣기 때문이다(의존성 0개).
   * 그런데 서버는 매 응답에 **진짜 값**을 실어 준다(usage.prompt_tokens ·
   * prompt_eval_count). 여태 그 값은 /cost 에만 쓰고 버렸다.
   *
   * 안 맞으면 두 가지가 조용히 나빠진다.
   *   · 적게 잡으면 — 남은 자리를 넉넉히 보고 답 상한을 크게 잡는다. 답이 잘린다.
   *   · 많이 잡으면 — 아직 자리가 있는데 접기 시작한다. 창을 놀린다.
   * 둘 다 화면에는 아무 말도 안 뜬다. 그래서 스스로 재게 한다.
   *
   * 조심한 것:
   *   · 실제값을 안 주는 서버가 있다. 0 이면 아무것도 안 배운다.
   *   · 표본이 작으면 비율이 튄다. 첫 몇백 토큰짜리 대화는 건너뛴다.
   *   · 0.5~2배 밖은 안 믿는다. 서버가 딴 것을 세고 있을 수 있다.
   *   · 되먹임이 겹치지 않게, 비교는 **보정 안 먹인 추정**으로 한다.
   *
   * @returns {number|null} 새 보정 배수. 못 배웠으면 null
   */
  배운다(실제) {
    const n = Number(실제);
    if (!Number.isFinite(n) || n <= 0) return null;
    const 추정 = this.#원추정().used;
    if (추정 < 200) return null;
    const 비율 = n / 추정;
    if (비율 < 0.5 || 비율 > 2) return null;
    // 첫 번은 그대로 받고, 그 뒤로는 천천히 따라간다. 한 번 튄 값에 안 휘둘린다.
    this.보정 = this.보정잰것 ? this.보정 + (비율 - this.보정) * 0.3 : 비율;
    this.보정잰것++;
    return this.보정;
  }

  /** 보정을 안 먹인 날 추정. 배운다() 가 견주는 값이다. */
  #원추정() {
    // 폴더 지문도 매 요청에 통째로 나간다. 시스템 프롬프트 쪽에 같이 센다 —
    // 안 세면 '남은 자리' 가 그만큼 뻥튀기되고, effort.js 가 그 값으로 출력
    // 상한을 잡으므로 답이 조용히 잘리기 시작한다.
    const sys = estimateTokens(기본규칙(this.conn?.ctx)) + estimateTokens(`작업 폴더: ${this.root}`)
      + estimateTokens(모드말(this.effectiveWork(), this.conn?.ctx) ?? '')
      + estimateTokens(this.프로젝트 ?? '');
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

    // 기억도 매 요청에 통째로 나간다. 안 세면 '남은 자리' 가 그만큼 뻥튀기되고,
    // effort.js 가 그 값으로 출력 상한을 잡으므로 답이 조용히 잘리기 시작한다.
    const 기억 = this.memory ? estimateTokens(this.memory) : 0;
    const 기억줄 = this.memory ? this.memory.split('\n').filter((l) => l.startsWith('- ')).length : 0;

    const rows = [
      { label: '시스템 프롬프트', n: sys },
      { label: this.rules ? `규칙 (${this.rules.name})` : '규칙 (없음)', n: rules },
      { label: `기억 (${기억줄}줄)`, n: 기억 },
      { label: '겪어 본 것', n: this.배움요약 ? estimateTokens(this.배움요약) : 0 },
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
   * 화면과 예산이 보는 값. 배운 보정을 먹여서 내놓는다.
   *
   * 줄마다 보정을 먹인다 — 합계만 고치면 표의 줄을 더한 값과 합계가 안 맞아서,
   * 보는 사람이 어느 쪽을 믿어야 할지 모르게 된다.
   */
  breakdown() {
    const 날것 = this.#원추정();
    if (!(this.보정잰것 > 0) || this.보정 === 1) return 날것;
    const rows = 날것.rows.map((r) => ({ ...r, n: Math.round(r.n * this.보정) }));
    const used = rows.reduce((a, r) => a + r.n, 0);
    return {
      rows,
      used,
      total: 날것.total,
      left: Math.max(0, 날것.total - used),
      보정: this.보정,
      보정잰것: this.보정잰것,
    };
  }

  /**
   * 도구 정의가 몇 토큰인가.
   *
   * 모드가 바뀌면 도구 목록도 바뀌므로 모드별로 한 번씩만 재고 넣어 둔다.
   * 매 턴 JSON.stringify 를 하면 그 자체가 아깝다 — 값은 안 바뀌는데.
   */
  #도구잰것 = new Map();
  #도구토큰() {
    // 밖에서 붙인 도구 수까지 열쇠에 넣는다. 서버가 붙고 떨어지면 값이 달라진다.
    const mcp수 = (this.mcp ?? []).reduce((n, s) => n + (s.도구?.length ?? 0), 0);
    // 창 크기도 열쇠에 넣는다. 설명을 창에 맞춰 줄여 싣기 때문에(budget.js),
    // /ctx 로 창을 다시 잡으면 이 값도 달라져야 한다. 안 넣으면 옛 값이 남는다.
    const 열쇠 = `${this.effectiveWork()}|${this.skills?.length ? 'skill' : ''}|${this.web !== false ? 'web' : ''}|mcp${mcp수}|c${this.conn?.ctx ?? 0}`;
    if (this.#도구잰것.has(열쇠)) return this.#도구잰것.get(열쇠);
    let n = 0;
    try {
      const list = toolSchemas(null, {
        hasSkills: (this.skills?.length ?? 0) > 0,
        web: this.web !== false,
        work: this.effectiveWork(),
        mcp: this.mcp ?? null,
        // 실제로 나가는 것과 **같은 것**을 재야 한다. 안 넘기면 안 줄인 것을
        // 재게 되고, 그러면 /context 가 실제보다 크게 말한다 — 그 값으로
        // effort.js 가 출력 상한을 잡으므로 답이 이유 없이 짧아진다.
        ctx: this.conn?.ctx ?? null,
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

/**
 * 도중에 죽은 대화를 다시 쓸 수 있게 손본다.
 *
 * 왜 필요한가:
 *   store 는 메시지가 오갈 때마다 즉시 적는다(jsonl). 그래서 도구를 **돌리는
 *   도중에** 죽으면 `assistant(tool_calls)` 만 적히고 그 결과가 없다. 긴 Bash 를
 *   돌리는 중, 전원이 나가는 중, 창을 닫는 중 — 흔한 자리다.
 *
 *   그 이력을 그대로 이어받아 보내면 OpenAI 규격 서버는 400 을 낸다. 호출 뒤에는
 *   결과가 와야 한다는 규격이다. compact.js 가 safeCut 으로 막고 있는 바로 그
 *   사고인데, **이어받기 길에는 그 안전망이 없었다.** 이어받자마자 첫 마디에서
 *   죽으니, 사람 눈에는 '이어하기가 고장 났다' 로 보인다.
 *
 * 무엇을 하나:
 *   결과가 없는 호출을 **지운다.** 가짜 결과를 채우지 않는다 — 안 돌아간 도구를
 *   돌았다고 적으면 모델이 그 거짓말 위에서 계속한다. 파일을 안 고쳤는데 고친
 *   줄 알고 다음 단계로 넘어가는 것이 제일 나쁘다.
 *   호출이 전부 빠졌는데 할 말도 없으면 그 메시지째 지운다.
 *   짝 없는 결과(앞에 호출이 없는 tool)도 지운다 — 머리가 잘려 나간 이력이다.
 *
 * 규격이 둘이라 짝짓는 법도 둘이다 (adapter.js 의 toolMessage):
 *   OpenAI  { role:'tool', tool_call_id }  → id 로 짝짓는다
 *   Ollama  { role:'tool', tool_name }     → id 가 없다. 순서로 짝짓는다
 *
 * @returns {{messages: object[], 고친것: number}} 고친것 = 걷어낸 호출·결과 수
 */
export function repairToolPairs(messages) {
  const out = [];
  let 고친것 = 0;

  for (let i = 0; i < (messages?.length ?? 0); i++) {
    const m = messages[i];

    // 적다 만 줄. 도중에 죽으면 JSONL 한 줄이 반만 적히고, 그 자리가 빈 값이나
    // role 없는 조각으로 읽힌다. 그대로 보내면 서버가 거절한다 — 걷어내는 것이
    // 이 함수의 일이므로 여기서 같이 턴다.
    if (!m || typeof m !== 'object' || typeof m.role !== 'string') { 고친것++; continue; }

    // 호출 없이 굴러다니는 결과. 앞이 잘려 나간 이력이다.
    if (m.role === 'tool') { 고친것++; continue; }

    if (m?.role !== 'assistant' || !m.tool_calls?.length) { out.push(m); continue; }

    // 이 호출에 딸린 결과 묶음 — 바로 뒤에 붙어 있는 tool 들이 전부다.
    const 결과 = [];
    let j = i + 1;
    while (j < messages.length && messages[j]?.role === 'tool') 결과.push(messages[j++]);
    i = j - 1;   // 결과는 여기서 같이 처리한다

    const 있는id = new Set(결과.map((r) => r?.tool_call_id).filter(Boolean));
    const 남길호출 = 있는id.size
      ? m.tool_calls.filter((c) => 있는id.has(c?.id))
      : m.tool_calls.slice(0, 결과.length);      // id 가 없는 규격 — 순서로 본다
    const 남길id = new Set(남길호출.map((c) => c?.id).filter(Boolean));
    const 남길결과 = 있는id.size
      ? 결과.filter((r) => 남길id.has(r.tool_call_id))
      : 결과.slice(0, 남길호출.length);

    고친것 += (m.tool_calls.length - 남길호출.length) + (결과.length - 남길결과.length);

    if (남길호출.length) {
      out.push(남길호출.length === m.tool_calls.length ? m : { ...m, tool_calls: 남길호출 });
      out.push(...남길결과);
      continue;
    }
    // 남은 호출이 없다. 할 말이라도 있으면 그건 살린다.
    const 글 = typeof m.content === 'string' ? m.content.trim() : '';
    if (글) { const { tool_calls: _버림, ...나머지 } = m; out.push(나머지); }
  }

  return { messages: out, 고친것 };
}
