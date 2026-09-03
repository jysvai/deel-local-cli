// 대화 상태와 컨텍스트 셈. /context 가 보여주는 숫자가 여기서 나온다.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { 그림장수, 글만, 그림한장토큰 } from '../backend/vision.js';
import { get as workMode, 말 as 모드말, DEFAULT as WORK_DEFAULT } from './modes.js';
import { toolSchemas } from '../tools/index.js';
import { normalize as normLevel, DEFAULT as LEVEL_DEFAULT } from '../ui/level.js';
import { 매김, 급말, 값 as 급값, 지켜본것 } from './grade.js';
import { 지문 } from './project.js';
import { 프롬프트토막 as 기억토막 } from './memory.js';
import { 못박기 } from './pins.js';
import { 파일기억 } from './filemem.js';
import { 언어, 지시말, 말 as 옮긴말 } from '../i18n/index.js';
import { 셸안내 } from '../tools/shell.js';

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
- 그래도 물어야 하면 **Ask 도구로 묻는다.** 글로 "알려주세요" 하고 끝내지 마라 — 그러면 그 턴이
  끝나서 여태 읽은 것이 다 버려지고, 사람은 아무것도 안 된 화면을 본다. Ask 는 답이 그 자리로
  돌아와 하던 일이 이어진다. 고를 것을 2~4개 같이 준다.
- **이미 시킨 것을 다시 묻지 마라.** "파일 정리해 줘" 는 이미 답이다. 어떻게 정리할지 정하는
  것이 네 일이지, 그걸 되물으면 사람은 같은 말을 두 번 하게 된다.
- 도구가 자꾸 실패하면 **그것을 말해라.** 못 읽은 파일이 몇 개인지 적고 무엇이 막혔는지 알려라.
  실패를 삼킨 채 "무엇을 도와드릴까요" 로 끝내면, 사람은 왜 안 됐는지 영영 모른다.
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
- 중간 파일이 필요하면 /tmp 말고 .deel/tmp/ 에 쓴다. 작업 폴더 밖은 막힌다.
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
- 그래도 물어야 하면 Ask 도구로 묻는다. 글로 묻고 끝내면 턴이 끝나 여태 읽은 것이 버려진다.
- 이미 시킨 것을 다시 묻지 마라. 도구가 자꾸 실패하면 몇 개가 막혔는지 말해라.
- 파일이 여럿이면 다 만든다. 하나만 하고 멈추지 마라.
- 끝내기 전에 Verify 로 확인한다. 확인 못 했으면 "확인 못 했다" 고 말한다.

- 고칠 파일은 먼저 Read 한다.
- Edit 의 old_string 은 공백까지 파일과 똑같아야 한다. 앞뒤를 넉넉히 넣어라.
- 긴 파일은 Write 로 앞부분만, 나머지는 Append 로 잇는다. 앞부분을 다시 보내지 마라.
- 같은 도구를 같은 인자로 또 부르지 마라. 결과는 같다.
- 답은 한국어로 짧게. 코드를 통째로 붙여넣지 마라.
- 사용자가 정한 규칙은 Remember 로 한 줄 남긴다. "저번에" 라고 하면 Recall 로 찾는다.`;

/*
 * ── 영어판 ──────────────────────────────────────────────────────────────
 *
 * /lang en 일 때 **모델이 읽는 글도** 영어로 간다. 화면 말만 바꾸는 1단계와
 * 여기가 다른 점이고, 다르게 한 데는 두 가지 이유가 있다.
 *
 * 1) 안 바꾸면 답이 한국어로 온다. 위 규칙에 "사용자에게 답할 때는 한국어로"
 *    가 박혀 있어서다. 화면 글자만 영어로 갈아 끼워 놓고 모델은 계속 한국어로
 *    답하면, 영어권 사람에게는 아무것도 안 고친 것과 같다.
 *
 * 2) 토큰이 눈에 띄게 싸다. 한글은 글자당 약 1토큰이고 영문·코드는 약 3.6자당
 *    1토큰이다(estimateTokens 를 볼 것). 32k 창에서 고정 몫이 15% 를 먹고
 *    있었는데, 그 몫이 줄면 그만큼 대화가 쓸 자리가 는다. 작은 창에서는
 *    이게 '파일 한 개를 더 읽을 수 있나' 를 가르는 크기다.
 *
 * 규칙 자체는 한 줄도 안 뺐다. 옮기면서 규칙이 느슨해지면 영어로 켠 사람만
 * 다른 프로그램을 쓰는 셈이 된다 — 특히 "확인 못 했으면 확인 못 했다고 말해라"
 * 같은 줄은 이 프로그램이 거짓말을 안 하게 하는 자리라 글자 그대로 옮겼다.
 */
const BASE_RULES_EN = `You are deel, a tool that reads and edits code inside the user's working folder.

**Finish the job.** Do not stop at a plan.

- Start now. Create missing files and folders — that is part of the job.
- Ask back **only when no tool can tell you**. If you can decide, decide, and say what you decided it from.
- When you truly must ask, **ask with the Ask tool.** Do not write "let me know what you want" and stop — that ends
  the turn, everything you read is thrown away, and the user sees a screen where nothing happened. An Ask answer
  comes straight back to where you are, so the work carries on. Give 2–4 options to pick from.
- **Never ask back what you were already told.** "Tidy up the files" is already the answer. Deciding how to tidy
  them is your job; asking it back makes the person say the same thing twice.
- If tools keep failing, **say so.** Report how many files you could not read and what blocked you. Swallowing
  the failures and ending with "what can I help you with?" leaves the person with no idea why nothing happened.
- If the job needs several files, make them all. Do not touch one and stop.
- When you are done, check. Run it, and fix it if it fails. If you could not check, say "I could not verify this."

Rules:
- Do not guess — confirm with a tool. Always Read an existing file before editing it.
- Edit's old_string must match the file exactly, whitespace and indentation included. Do not trim it short; include plenty of surrounding context.
- Do not put a large file in one call. Write the first ~300 lines, then call Append repeatedly until the rest is in place.
  Append needs no Read first. Do not resend the earlier part when appending — it will just get cut at the same place again.
- Do not call the same tool with the same arguments twice. The result will be the same. Remember what you saw and move on.
- If the user names the scope to look at, stay inside it. Otherwise look as far as you need.
- Use Bash when you need to run a command. Commands that cannot be undone are blocked, so find another way.
- If you need a scratch file, write it under .deel/tmp/, not /tmp. Outside the working folder is blocked.
- Answer the user in English, briefly. Do not paste whole files back — say what changed.

Keep what will be needed again:
- When the user sets a rule or tells you not to do something, leave one line with Remember. That line rides on every
  later request, so keep it to one sentence. Do not record anything that only applies to this one job.
- When the user points back ("last time", "as we decided"), search with Recall before asking again.
- When you finish a procedure you will do again, write it to .deel/skills/<name>/SKILL.md.
  Put name and description in the front matter (fenced with ---) and the steps below. If you find a mistake in a
  skill you used, fix that file.`;

/*
 * 작은 창을 위한 짧은 영어판. 위 짧은 판과 같은 생각이다 —
 * 빠진 규칙은 없고 설득하는 문장만 없다.
 */
const BASE_RULES_짧게_EN = `You are deel. You read and edit code in the user's working folder.

Finish the job. Do not stop at a plan.
- Start now. Create missing files and folders.
- If a tool can tell you, decide instead of asking. Say what you decided it from.
- If you must ask, use the Ask tool. Asking in prose ends the turn and throws away what you read.
- Never ask back what you were told. If tools keep failing, say how many failed.
- If there are several files, make them all. Do not do one and stop.
- Verify before you finish. If you could not verify, say so.

- Read a file before you edit it.
- Edit's old_string must match the file exactly, whitespace included. Include plenty of context.
- For a long file, Write the first part and Append the rest. Do not resend the earlier part.
- Do not call the same tool with the same arguments twice. The result will be the same.
- Answer in English, briefly. Do not paste whole files.
- Record rules the user sets with Remember. When they say "last time", search with Recall.`;

/**
 * 이 창 크기에 맞는 기본 규칙.
 *
 * 24k 를 경계로 삼는다. 그 아래에서는 긴 판이 창의 10% 를 넘어가기 시작한다 —
 * 도구 정의(budget.js 의 설명길이)가 줄어드는 자리와 같은 경계다. 두 개가
 * 같이 움직여야 '작은 창에서는 고정 몫을 줄인다' 가 한 가지 결정이 된다.
 */
function 기본규칙(ctx) {
  const 짧게 = Number(ctx) > 0 && Number(ctx) < 24000;
  /*
   * 시키는 말은 지시말() 이 정한다 — 화면 말과 다른 축이다(i18n/index.js).
   *
   * 그래서 "영어로 시키고 한국어로 받기" 가 된다. 규칙 글은 영어판을 쓰되,
   * **답하는 말**만 다시 못 박는다. 안 박으면 영어 규칙 안의
   * "Answer the user in English" 가 그대로 먹어서, 한국 사람이 영어 답을
   * 받는다 — 값을 아끼려다 읽을 수 없는 답을 받는 셈이다.
   */
  const 시키는말 = 지시말();
  const 글 = 시키는말 === 'en'
    ? (짧게 ? BASE_RULES_짧게_EN : BASE_RULES_EN)
    : (짧게 ? BASE_RULES_짧게 : BASE_RULES);
  if (시키는말 === 언어()) return 글;
  return `${글}\n\n${언어() === 'ko'
    ? '**답은 한국어로 해라.** 위 규칙이 영어로 적혀 있어도 사용자에게 하는 말은 한국어다.'
    : '**Answer in English.** The rules above are in Korean, but what you say to the user is English.'}`;
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
    /*
     * 읽은 파일을 들고 있다가 **바뀐 만큼만** 다시 싣는다 (agent/filemem.js).
     *
     * filesRead 와 둘로 나눠 둔 이유: 저쪽은 `/context` 가 「몇 개 읽었나」 를
     * 세는 자리라 값이 토큰 수뿐이다. 여기는 글 자체를 들고 있어야 한다.
     * 한 맵에 두 가지를 담으면 화면 셈이 글자까지 들고 다니게 된다.
     */
    this.파일기억 = new 파일기억();
    /*
     * 접거나 줄여도 잃으면 안 되는 두 가지 (아래 못박을것).
     *
     *   이번요청 — 이번 턴에 사람이 시킨 말 원문. loop.js 가 턴마다 채운다.
     *   할일     — 마지막 TodoWrite 목록. loop.js 가 그 결과에서 채운다.
     *
     * 요약은 요약이라 「네 가지를 고쳐 달라고 했다」로 뭉개지고, 할 일 목록은
     * 도구 결과 자리에만 살아서 접히면 통째로 사라진다. 둘 다 접는 자리에서
     * 다시 박으려면 세션이 들고 있어야 한다 — ctx 에만 두면 우리 코드만 보고
     * 모델은 못 본다.
     */
    this.이번요청 = '';
    this.할일 = [];
    this.changes = new Map();     // 경로 → {added, removed, times}. /diff 가 본다
    /*
     * 상태줄이 보는 두 숫자.
     *
     * 여기 들고 있는 이유는 **화면을 그릴 때마다 디스크를 읽지 않기 위해서**다.
     * 상태줄은 사람이 글자 하나 칠 때마다 다시 그려진다. 거기서 되돌리기
     * 이력 파일을 열면 타이핑이 끊긴다 — 화면 꾸미기가 입력을 느리게 만드는
     * 것만큼 나쁜 것이 없다. repl 이 턴이 끝날 때 한 번씩 채워 준다.
     */
    this.되돌릴턴 = 0;
    this.검증 = { 돈횟수: 0, 확인: 0, 탈: 0 };
    this.skills = [];             // 켜질 때 이 PC 에서 찾은 것들
    /*
     * 이 자리에 언어 서버가 있나 (Def·Refs 를 목록에 넣을지).
     *
     * 켤 때 repl 이 한 번 재서 넣어 준다. 여기서 직접 안 재는 이유는 폴더를
     * 훑어야 알 수 있어서다 — 세션은 시험에서도 수없이 만들어지는데, 그때마다
     * 폴더를 훑으면 시험이 느려지고 그 자리에 뭐가 깔렸는지에 따라 결과가
     * 달라진다. 기본은 꺼짐이고, 켜 주는 자리가 딱 하나다.
     */
    this.lsp = false;
    this.commands = [];
    this.plugins = [];
    this.maxSkillsListed = 40;    // 프롬프트에 올릴 최대 개수
    this.maxSkillDesc = 140;      // 설명 한 줄 최대 길이
    this.usage = { in: 0, out: 0, calls: 0, ms: 0, retries: 0 };
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
    /** 규칙 파일이 있는데 못 읽었나. `{이름, 까닭}` — /status 가 이걸 말한다. */
    this.규칙못읽음 = null;
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

  /**
   * 이 폴더의 규칙 파일. DEEL.md → CLAUDE.md → AGENTS.md 중 먼저 읽히는 하나.
   *
   * 없는 것은 그냥 없는 것이라 아무 말도 안 한다. 그런데 **있는데 못 읽는**
   * 것까지 같이 삼키면 안 된다 — 권한이 막혔거나 같은 이름의 폴더가 있으면
   * 그렇게 된다. 사람은 규칙을 적어 뒀으니 걸려 있다고 믿는데 실제로는 하나도
   * 안 걸린 채로 일이 돈다. 「운영 DB 는 건드리지 마라」 를 적어 놓고 그게
   * 안 걸린 것이 여기서 나올 수 있는 제일 나쁜 모양이다.
   * 못 읽은 것은 적어 두고 /status 가 '없음' 대신 그 까닭을 말한다.
   */
  #loadRules() {
    for (const name of ['DEEL.md', 'CLAUDE.md', 'AGENTS.md']) {
      try { return { name, text: readFileSync(join(this.root, name), 'utf8').slice(0, 20000) }; }
      catch (err) {
        // 없으면 그냥 없는 것이다 — 말할 일이 아니다. existsSync 로 먼저 보지
        // 않는 이유도 여기 있다: 보고 나서 읽는 사이에 지워지면 그 ENOENT 를
        // 「있는데 못 읽었다」 로 적게 된다.
        if (err?.code === 'ENOENT') continue;
        // 첫 번째 것만 적어 둔다. 뒤엣것이 읽히면 그게 규칙이 되지만, 사람이
        // 적어 둔 자리를 못 읽었다는 사실은 그래도 남아야 한다.
        if (!this.규칙못읽음) this.규칙못읽음 = { 이름: name, 까닭: err?.code ?? err?.message ?? String(err) };
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
    const 영 = 언어() === 'en';
    const parts = [기본규칙(this.conn?.ctx)];
    // 범위를 못 박는 줄. 이건 모델이 읽는 글이라 화면 말을 따라간다.
    parts.push(영
      ? `\nWorking folder: ${this.root}\nYou can neither read nor write files outside this folder.`
      : `\n작업 폴더: ${this.root}\n이 폴더 밖의 파일은 읽지도 쓰지도 못한다.`);
    // 어느 셸에서 명령이 도는지 한 줄 (tools/shell.js). 모델이 ls 를 칠지 dir 를 칠지가
    // 여기서 갈린다 — cmd 에서 유닉스 명령을 치면 한 번에 20~40초짜리 헛걸음이다.
    // 세션 안에서는 안 변하는 줄이라 앞머리(캐시되는 자리)에 둔다.
    parts.push(셸안내(영));

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

    if (this.rules) {
      // 사용자 규칙 파일의 **내용은 안 건드린다.** 사람이 쓴 글이고, 그 사람의
      // 말로 모델에게 가야 한다. 여기서 바뀌는 것은 그것을 소개하는 머리말뿐이다.
      parts.push(영
        ? `\n--- ${this.rules.name} (user rules — these win over the principles above) ---\n${this.rules.text}`
        : `\n--- ${this.rules.name} (사용자 규칙, 위 원칙보다 우선) ---\n${this.rules.text}`);
    }

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
        (영
          ? '\n--- skills available ---\nCall the Skill tool with a name to get its body. If none fits, just carry on.\n'
          : '\n--- 쓸 수 있는 스킬 ---\n필요한 것이 있으면 Skill 도구로 이름을 불러 본문을 받아라. 없으면 그냥 진행해라.\n') +
        // 설명이 없는 스킬이 섞일 수 있다 — 남의 폴더에서 오는 파일이라
        // 앞머리(frontmatter)가 빠지곤 한다. 여기서 터지면 시스템 프롬프트를
        // 못 만들어 **매 턴** 죽는다. 목록 명령 하나가 아니라 대화 전체가 막힌다.
        listed.map((s) => `- ${s.name}: ${String(s.description ?? '').slice(0, this.maxSkillDesc)}`).join('\n')
      );
      const rest = this.skills.filter((s) => s.enabled).length - listed.length;
      if (rest > 0) {
        parts.push(영
          ? `(${rest} more exist but did not fit.)`
          : `(그 밖에 ${rest}개가 더 있으나 자리가 모자라 안 실었다.)`);
      }
    }
    /*
     * 지금 무슨 일을 하는 중인지 — **일부러 끝쪽에** 둔다.
     *
     * 이 절은 이 프롬프트에서 유일하게 **매 턴 바뀔 수 있는** 자리다. 말을
     * 던질 때마다 알맞은 모드로 저절로 옮겨 가기 때문이다(route.js). 그런데
     * Ollama·llama.cpp 의 프리픽스 캐시는 앞부분이 지난 요청과 같을 때만
     * 계산을 재쓴다 — 이 절이 앞쪽에 있으면 모드가 바뀌는 순간 그 뒤 전부,
     * 시스템 프롬프트 나머지에 대화 전체까지 다시 계산된다. 긴 대화일수록
     * 매 턴 몇천 토큰이고, 로컬에서는 그게 그대로 몇 초다.
     *
     * 그래서 변하지 않는 것들(규칙·폴더·급말·지문·사용자 규칙·기억·스킬)을
     * 앞에 굳히고 이 절을 뒤로 보냈다. 읽기 쪽으로도 손해가 아니다 — 끝자리는
     * 가운데보다 오히려 잘 읽힌다(lost in the middle 의 반대편이다).
     * 이 차례는 test/cache.test.js 가 지킨다.
     *
     * 도구 목록도 이 모드에 맞춰 이미 걸러져 있다. 창이 좁으면 짧은 판을
     * 쓴다 (modes.js 의 말()) — 규칙은 같고 설득하는 문장만 빠진다.
     */
    const w = workMode(this.effectiveWork());
    parts.push(영
      ? `\n--- current mode: ${w.en} ---\n${모드말(this.effectiveWork(), this.conn?.ctx)}`
      : `\n--- 지금 모드: ${w.name} (${w.en}) ---\n${모드말(this.effectiveWork(), this.conn?.ctx)}`);
    /*
     * 못 박은 것은 **맨 끝**에 붙인다 (agent/pins.js).
     *
     * 긴 글의 가운데는 흘려 읽힌다 — 'lost in the middle' 이라 부르는 것이고,
     * 어느 모델에서나 잰다. 사람이 직접 못 박은 말은 그 가운데에 묻히면 안 되므로
     * 가장 마지막, 대화 바로 앞에 둔다. 모드 절보다도 뒤인 것도 그래서다.
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

  /*
   * ── 턴이 어디서 시작했는지 ────────────────────────────────────────────
   *
   * 되돌리기(/undo)는 파일만 되돌렸다. 대화에는 "src/runner.js 를 고쳤습니다" 가
   * 그대로 남아 있어서, 되돌린 다음 턴에 모델은 **이미 고쳐 놓은 줄 알고** 그
   * 위에 이어 일했다 — 없는 코드를 고치려 들고, 없는 함수를 부른다. 사람 눈에는
   * 모델이 헛소리하는 것으로 보이지만, 사실은 우리가 모델에게 거짓말을 남겨 둔
   * 것이다. 그러니 파일을 되감을 때 말도 같이 걷어내야 한다.
   *
   * 자리를 **숫자로 적어 두지 않는다.** 접기(compact)와 줄이기(trim)가 messages
   * 를 통째로 갈아 끼우기 때문에, 적어 둔 3번은 다음 순간 엉뚱한 말을 가리킨다.
   * 잘못된 자리에서 자르는 되돌리기는 안 하느니만 못하다. 그래서 **메시지 객체
   * 자체**를 들고 있다가 그때그때 indexOf 로 찾는다. 접혀서 사라졌으면 못 찾고,
   * 못 찾으면 그 턴은 되감을 수 없다고 정직하게 말한다.
   */
  #턴표 = [];
  #다음턴 = null;
  static #표최대 = 200;

  /** 새 턴을 연다. 바로 다음에 push 되는 말이 이 턴의 첫 말이 된다. */
  턴시작(턴) {
    if (턴 == null) return this;
    // 접혀 없어진 표는 여기서 턴다 — 안 그러면 긴 대화에서 끝없이 쌓인다.
    this.#턴표 = this.#턴표.filter((x) => this.messages.includes(x.표));
    if (this.#턴표.length > Session.#표최대) this.#턴표 = this.#턴표.slice(-Session.#표최대);
    this.#다음턴 = 턴;
    return this;
  }

  /** 살아 있는 턴 표시들. 접혀 사라진 것은 빠진다. @returns {{턴:number, 자리:number}[]} */
  턴자리() {
    const out = [];
    for (const x of this.#턴표) {
      const i = this.messages.indexOf(x.표);
      if (i >= 0) out.push({ 턴: x.턴, 자리: i });
    }
    return out.sort((a, b) => a.자리 - b.자리);
  }

  /**
   * 주어진 턴들의 말을 걷어낸다.
   *
   * 여러 턴이면 그중 **제일 이른** 자리까지 간다 — 그 뒤는 어차피 되돌린 파일
   * 위에서 나눈 이야기라 남겨 둘 이유가 없다. 사람이 쳤던 말은 돌려준다,
   * 다시 치기 쉽게.
   *
   * 자르고 나서 repairToolPairs 를 반드시 한 번 돌린다. 도구를 부른 assistant
   * 만 남고 그 결과가 없으면 그 뒤 모든 요청이 400 으로 튕긴다 — 되돌리기가
   * 대화를 아예 못 쓰게 만드는 셈이다. 턴 경계는 보통 깨끗하지만, 여기서만은
   * '보통' 에 기대지 않는다.
   */
  되감기(턴들) {
    const 찾을것 = new Set((Array.isArray(턴들) ? 턴들 : []).filter((t) => t != null));
    const 빈것 = { 걷은것: 0, 고친것: 0, 사람말: null, 턴: [] };
    if (!찾을것.size) return 빈것;

    const 표들 = this.턴자리().filter((x) => 찾을것.has(x.턴));
    if (!표들.length) return 빈것;

    const 자리 = 표들[0].자리;
    const 첫말 = this.messages[자리];
    const 사람말 = 첫말?.role === 'user' && typeof 첫말.content === 'string' ? 첫말.content : null;

    const 전 = this.messages.length;
    const 고침 = repairToolPairs(this.messages.slice(0, 자리));
    this.messages = 고침.messages;
    this.#턴표 = this.#턴표.filter((x) => this.messages.includes(x.표));
    this.#다음턴 = null;
    /*
     * 들고 있던 파일 내용도 같이 버린다. clear() 가 하는 것과 같은 까닭이다.
     *
     * 되감기는 그 턴의 Read 결과까지 대화에서 **진짜로 지운다.** 그런데 파일
     * 기억은 그대로 남아서, 같은 파일을 다시 읽으면 「앞에서 읽은 그대로입니다」
     * 나 「나머지는 앞에 실린 그대로입니다」 를 내민다 — 그 「앞엣것」 은 방금
     * 이 줄이 지웠다.
     *
     * /undo 는 특히 그렇다. 파일을 고치고(기억에 담김) 되돌리면 디스크는 옛
     * 모습으로 돌아가는데 기억은 고친 모습이라, 다시 읽을 때 있지도 않은 차이를
     * 적어 보내게 된다. 여기서 한 줄 지우면 그냥 통째로 다시 읽는다.
     */
    this.파일기억?.잊기();
    return { 걷은것: 전 - this.messages.length, 고친것: 고침.고친것, 사람말, 턴: 표들.map((x) => x.턴) };
  }

  push(msg) {
    if (this.#다음턴 != null) { this.#턴표.push({ 턴: this.#다음턴, 표: msg }); this.#다음턴 = null; }
    this.messages.push(msg);
    return this;
  }

  clear() {
    this.messages = [];
    this.filesRead.clear();
    this.파일기억.잊기();
    /*
     * 할 일 목록과 시킨 말도 같이 버린다.
     *
     * 이 둘은 접거나 줄일 때 다시 박히는 것들이다(못박을것). 대화를 지운 뒤에도
     * 들고 있으면, 새로 시작한 일이 처음 접히는 순간 **지운 대화의 할 일**이
     * 되살아나 붙는다. 모델은 그걸 지금 시킨 것으로 알고 하러 간다 —
     * 안 지운 것만 못하다.
     */
    this.할일 = [];
    this.이번요청 = '';
    this.#턴표 = [];
    this.#다음턴 = null;
    return this;
  }

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
      /*
       * 그림은 글자 수로 세지 않는다.
       *
       * 그림은 base64 로 실려 있어서 글로 세면 4MB 짜리 한 장이 150만 토큰으로
       * 잡힌다. 그러면 창이 다 찬 줄 알고 대화를 통째로 접는다 — 화면 사진 한 장
       * 보여 준 값으로 하던 일을 잃는 셈이다. 한 장에 얼마인지는 서버가 정하는
       * 것이라 우리는 모르므로, 정해 둔 값으로 세고 서버가 알려주는 실제 값으로
       * 고쳐 나간다 (backend/vision.js 의 그림한장토큰 머리말).
       */
      const 장수 = 그림장수(m);
      const t = estimateTokens(장수 ? 글만(m) : (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')))
        + 장수 * 그림한장토큰
        + estimateTokens(JSON.stringify(m.tool_calls ?? ''));
      if (m.role === 'tool') files += t; else history += t;
    }

    // 도구 정의도 매 요청에 실려 나간다. 세는 값이라기보다 '이미 나간 값' 이다.
    const 도구 = this.#도구토큰();

    // 기억도 매 요청에 통째로 나간다. 안 세면 '남은 자리' 가 그만큼 뻥튀기되고,
    // effort.js 가 그 값으로 출력 상한을 잡으므로 답이 조용히 잘리기 시작한다.
    const 기억 = this.memory ? estimateTokens(this.memory) : 0;
    const 기억줄 = this.memory ? this.memory.split('\n').filter((l) => l.startsWith('- ')).length : 0;

    /*
     * 이름은 화면에 그대로 나간다(`/context`). 그래서 여기서 말 표를 거친다.
     * 여기만 한국어로 두면 영어로 켠 사람의 컨텍스트 표가 통째로 한국어가
     * 되는데, `/lang` 은 그 사이에도 100% 라고 답한다 — 표에 없는 글은
     * 세지지 못하기 때문이다. test/langleak.test.js 가 이 자리를 지킨다.
     */
    const rows = [
      { label: 옮긴말('ctx.system'), n: sys },
      { label: this.rules ? 옮긴말('ctx.rules', { 이름: this.rules.name }) : 옮긴말('ctx.rulesNone'), n: rules },
      { label: 옮긴말('ctx.memory', { n: 기억줄 }), n: 기억 },
      { label: 옮긴말('ctx.learned'), n: this.배움요약 ? estimateTokens(this.배움요약) : 0 },
      { label: 옮긴말('ctx.skills', { 실림: listed.length, 전체: this.skills.length }), n: skills },
      { label: 옮긴말('ctx.tools'), n: 도구 },
      { label: 옮긴말('ctx.history'), n: history },
      { label: 옮긴말('ctx.toolResults', { n: this.filesRead.size }), n: files },
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
    const 열쇠 = `${this.effectiveWork()}|${this.skills?.length ? 'skill' : ''}|${this.web !== false ? 'web' : ''}|${this.lsp ? 'lsp' : ''}|mcp${mcp수}|c${this.conn?.ctx ?? 0}`;
    if (this.#도구잰것.has(열쇠)) return this.#도구잰것.get(열쇠);
    let n = 0;
    try {
      const list = toolSchemas(null, {
        hasSkills: (this.skills?.length ?? 0) > 0,
        web: this.web !== false,
        work: this.effectiveWork(),
        mcp: this.mcp ?? null,
        lsp: this.lsp === true,
        // 실제로 나가는 것과 **같은 것**을 재야 한다. 안 넘기면 안 줄인 것을
        // 재게 되고, 그러면 /context 가 실제보다 크게 말한다 — 그 값으로
        // effort.js 가 출력 상한을 잡으므로 답이 이유 없이 짧아진다.
        ctx: this.conn?.ctx ?? null,
        vision: this.conn?.vision === true,
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
      {
        role: 'user',
        /*
         * 줄일 때도 시킨 말과 남은 할 일을 다시 박는다.
         *
         * 이 길은 **요약을 못 받아 물러선** 길이다. 서버가 흔들릴 때 지나가는
         * 길이라 제일 자주 밟히는데, 여태 여기에는 못 박는 것이 없었다.
         * 머리 2개만 남기므로, 사용자가 세 번째 턴에서 네 가지를 시켰다면
         * 그 네 가지가 그냥 사라진다. 접기(compact) 쪽에만 못 박아 두면
         * 정작 제일 자주 지나가는 길에서만 조용히 어긋난다.
         */
        content: `(앞선 대화 ${dropped}개를 줄였습니다. 필요하면 파일을 다시 읽으세요.)\n\n` + 못박을것(this),
      },
      ...this.messages.slice(keepTail),
    ];
    return dropped;
  }
}

/*
 * ── 접거나 줄여도 이것만은 글자 그대로 남긴다 ──────────────────────────
 *
 * 요약은 요약이다. 네 가지를 적어 준 요청이 「네 가지를 고쳐 달라고 했다」
 * 한 줄로 뭉개지고, **그 네 가지가 무엇이었는지는 사라진다.** 접힌 뒤로는
 * 원문이 어디에도 없으니 남은 것을 이어 하려 해도 무엇이 남았는지 모른다.
 *
 * 할 일 목록도 같다. 목록이 사는 자리가 도구 결과 하나뿐이라, 55%에서 한 줄로
 * 접히고 80%에서 요약에 뭉개진다. 접힘 문구는 「필요하면 다시 읽으세요」인데
 * 할 일 목록은 **다시 읽을 파일이 없다.**
 *
 * 그래서 둘 다 접는 자리·줄이는 자리에서 다시 박는다. 끝난 항목은 안 싣는다 —
 * 자리를 먹기만 하고, 이 쪽지가 답할 질문은 「무엇이 남았나」 하나다.
 *
 * compact.js 가 이 두 함수를 그대로 내보낸다. safeCut·safeHead 와 같은 까닭이다 —
 * 접기와 줄이기가 **같은 것**을 박아야 하고, 한쪽만 고치면 물러서는 순간
 * 대화가 어긋난다.
 */
const 못박을길이 = 1200;

export function 못박은요청(session) {
  const 원문 = String(session?.이번요청 ?? '').trim();
  if (!원문) return '';
  const 실을것 = 원문.length > 못박을길이
    ? `${원문.slice(0, 못박을길이)}\n…(뒷부분 줄임)`
    : 원문;
  return `[이번에 시킨 말 — 요약이 아니라 원문 그대로입니다. 여기 적힌 것을 빠짐없이 하세요.]\n${실을것}\n\n`;
}

export function 못박은할일(session) {
  const 남은 = (session?.할일 ?? []).filter((x) => x?.state !== 'done');
  if (!남은.length) return '';
  const 줄 = 남은.map((x) => `${x.state === 'doing' ? '▶ (하는 중)' : '☐'} ${String(x.text ?? '').trim()}`);
  return `[아직 안 끝난 할 일 — 접히기 전 목록 그대로입니다. 이걸 이어서 하세요.]\n${줄.join('\n')}\n\n`;
}

export function 못박을것(session) {
  return 못박은요청(session) + 못박은할일(session);
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
