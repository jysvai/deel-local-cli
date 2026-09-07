// 작업 모드. 지금 무슨 일을 하는 중인지에 따라 도구·추론·말투를 한꺼번에 바꾼다.
//
// 승인 정책(auto/confirm/strict)과는 다른 축이다. 헷갈리면 안 된다.
//   승인 정책 = 얼마나 물어보나
//   작업 모드 = 무슨 일을 하는 중인가
// 둘은 곱해진다. '설계 모드 + strict' 도, '코드 모드 + auto' 도 말이 된다.
//
// 왜 도구를 아예 빼는가:
//   설계 모드에서 파일을 고치면 안 된다고 프롬프트로 부탁할 수도 있다.
//   그런데 모델은 부탁을 잊는다. 아예 목록에서 빼면 잊을 것이 없다.
//   오프라인일 때 웹 도구를 숨기는 것과 같은 방식이다.

// 읽기만 하는 도구. 무엇을 바꾸지 않는다.
// Recall 은 지난 대화를 찾는다 — 파일은 안 건드리므로 읽기 쪽이다.
// 묻기 모드에도 준다: "저번에 이거 어떻게 했더라" 가 딱 묻기 모드의 일이다.
// Def·Refs 도 읽기다 — 아무것도 안 바꾼다. 언어 서버가 없는 자리에서는
// toolSchemas 가 알아서 빼므로 여기서는 갈래만 정한다.
// Ask 는 **모든 모드**에 있다(읽기 갈래에 둔 이유가 그것이다). 갈림길은
// 어느 모드에서나 생기고, 물어볼 길이 없으면 모델은 글로 "알려주세요" 하고
// 턴을 끝내 버린다 — 그러면 여태 조사한 것이 통째로 버려진다.
const 읽기 = ['Read', 'Outline', 'Glob', 'Grep', 'Def', 'Refs', 'WebFetch', 'Skill', 'Recall', 'Ask'];
// 계획을 적는 도구. 파일을 안 건드리므로 읽기 전용 모드에서도 준다.
//
// Remember 도 여기 있다. 기억은 사용자의 소스를 안 건드리고 .deel/memory.md
// 한 줄을 더할 뿐이다. 오히려 계획·설계 모드에서 정한 것이야말로 다음에
// 이어질 때 필요하다 — 거기서 못 적으면 정한 것이 그대로 날아간다.
const 계획 = ['TodoWrite', 'Remember'];
// 바꾸는 도구.
// Append 는 Write 와 짝이다 — 출력 상한이 작은 모델이 큰 파일을 나눠 쓰는 길이다.
// Write 를 주는 자리에는 반드시 같이 준다. 하나만 주면 나눠 쓸 방법이 없어진다.
// Jobs 는 Bash 와 짝이다. Bash 를 주는 자리에는 반드시 같이 준다 —
// background 로 띄워 놓고 읽을 길이 없으면 띄운 것이 그냥 유령이 된다.
// Move 는 구조를 바꾸는 유일한 길이다. 이게 없으면 "폴더를 역할대로 나눠 줘"
// 에 남는 길이 Bash mv 뿐인데, 그건 매번 승인을 묻고 되돌리기에 안 잡힌다.
const 쓰기 = ['Write', 'Append', 'Edit', 'Move', 'Bash', 'Jobs'];
// 만든 것을 확인하는 도구. 아무것도 안 바꾸지만 **쓰는 모드에만** 준다 —
// 안 만든 모드에서 확인할 것이 없고, 도구 정의로 나가는 자리만 먹는다.
const 확인 = ['Verify'];
/*
 * 일을 쪼개는 도구.
 *
 * 파일을 바꾸는 모드에만 준다. 읽기만 하는 모드(설계·계획·묻기)는 한 창 안에서
 * 답을 내는 것이 일이고, 거기에 하위 작업을 얹으면 얻는 것보다 도구 정의로
 * 나가는 자리가 더 아깝다.
 *
 * 안전 쪽으로도 그렇다. 하위 작업은 제 모드를 스스로 고르는데, 읽기 전용
 * 모드에 이걸 쥐여 주면 "파일을 안 바꾼다" 는 약속을 하위가 깨고 나갈 길이
 * 하나 생긴다. 그 길은 loop.js 와 task.js 에서 두 겹으로 막아 두었지만,
 * 애초에 안 주는 것이 제일 확실하다.
 */
const 쪼개기 = ['Task'];

/*
 * ── 남의 코드를 읽는 법 ─────────────────────────────────────────────────
 *
 * 모드마다 따로 적지 않는다. 따로 적으면 언젠가 한쪽만 고쳐지고, 그때부터
 * 「모드에 따라 읽는 법이 다르다」 는 없던 규칙이 생긴다.
 *
 * 프롬프트에는 **한 번에 한 모드의 글만** 실리므로, 여기 모아 둬도 전선에
 * 나가는 양은 똑같다.
 *
 * ── 왜 이 두 줄인가 ─────────────────────────────────────────────────────
 *
 * 같은 프로젝트에 같은 질문을 두 벌 돌려서 재 봤다. 갈린 자리가 여기였다.
 *
 *   통째로 읽은 쪽:  도구 결과 10개, 평균 14,000자. 한 번은 상한(30,000자)에
 *                    걸려 잘렸다. 자른 것은 아무도 안 말해 준다.
 *   좁게 읽은 쪽:    도구 결과 30여 개, 평균 5,000자. 같은 자리를 두 번 읽은
 *                    적이 없다.
 *
 * 창에 부어 넣은 양은 앞쪽이 세 배인데, 답이 얕았다. 많이 넣는 것과 많이
 * 아는 것은 다르다 — 앞엣것이 접혀 나가면 안 읽은 것과 같아진다.
 *
 * 두 번째 줄(나란히 부르기)은 값이 아니라 **시간**이다. 읽기 도구는 같이
 * 돌게 되어 있는데(loop.js 의 묶기), 한 개씩 부르면 그 수만큼 왕복이 는다.
 */
const 읽는법 = [
  '- 남의 코드는 Outline 으로 모양부터 본다. Grep 으로 그 말이 닿는 자리를 다 모은 뒤,',
  '  **짚은 자리 앞뒤만** Read 한다 (offset·limit). 통째로 읽지 마라 — 한 번에 다',
  '  부어 넣으면 뒤로 갈수록 앞엣것이 접혀 나가고, 잊은 채로 「없다」 고 답하게 된다.',
  '- 서로 상관없는 읽기는 **한 번에 같이 부른다.** 읽기 도구는 나란히 돈다.',
  '  한 개씩 부르면 그 수만큼 왕복이 늘고, 그게 그대로 사람이 기다리는 시간이다.',
];
const 읽는법짧게 = [
  '- 남의 코드는 Outline → Grep → **짚은 자리 앞뒤만** Read (offset·limit). 통째로 읽지 마라.',
  '- 상관없는 읽기는 한 번에 같이 부른다 — 나란히 돈다.',
];
const 읽는법En = [
  '- For code you did not write, get the shape with Outline. Use Grep to gather every place it touches,',
  '  then Read **only around the lines you found** (offset/limit). Do not read whole files - pour it all',
  '  in at once and the earlier turns fold away, and you answer having forgotten them.',
  '- Fire unrelated reads **together in one message.** Read tools run side by side; one call at a time',
  '  adds that many round trips, and that is the waiting the person feels.',
];
const 읽는법짧게En = [
  '- Code you did not write: Outline -> Grep -> Read **only around what you found** (offset/limit). Never whole files.',
  '- Fire unrelated reads together in one message - they run side by side.',
];

import { 언어, 지시말 } from '../i18n/index.js';

export const MODES = {
  // 처음에는 여기서 시작한다.
  //
  // 무슨 일을 시킬지 미리 정해 두고 켜는 사람은 드물다. 그래서 기본은 '종합' 이고,
  // 한마디를 할 때마다 그 말이 무슨 일인지 보고 알맞은 모드로 저절로 옮겨 간다
  // (agent/route.js). 애매하면 안 옮기고 여기 그대로 둔다.
  //
  // 사용자가 /plan 처럼 직접 고르면 저절로 옮기는 것은 멈춘다. 사람이 고른 것을
  // 뒤집지 않는다. 다시 맡기려면 /work 종합 이다.
  auto: {
    id: 'auto',
    hintEn: "picks the right mode for what you ask",
    sayEn: "You are in **Auto** mode. What comes next is not fixed.\n\n- Work out what kind of job this is first, then do it that way.\n  If it is an edit, read before editing. If it is a diagnosis, confirm before concluding.\n  If it is an explanation, back it with the files.\n- For a large job, break it into steps with TodoWrite and **finish everything you wrote down.**\n  Do not write the list and then ask. If there are several chunks, hand them off with Task —\n  a subtask runs in its own window, so yours does not fill up.\n- For code you did not write, get the shape with Outline. Use Grep to gather every place it\n  touches, then Read **only around the lines you found** (offset/limit). Do not read whole\n  files - pour it all in at once and the earlier turns fold away, and you answer having\n  forgotten them.\n- Fire unrelated reads **together in one message.** Read tools run side by side; one call at\n  a time adds that many round trips, and that is the waiting the person feels.\n- Making several files: one Write call (files array). Do not call it once per file.\n  Several places to edit: one Edit call the same way (edits array).\n- Commands that never end (dev servers, watch) need background: true on Bash. Called plainly\n  they die on timeout. After starting one, read its output with Jobs, and end it with Jobs when done.\n- Verify what can be verified — call Verify. Do not call something done that you did not check.\n- Do what the job needs. Do not start work the job did not ask for.",
    say짧게En: "**Auto** mode. What comes next is not fixed.\n- Work out what kind of job this is, then do it that way.\n- Large job: break it up with TodoWrite and **finish it all.** Several chunks: hand off with Task.\n- Code you did not write: Outline -> Grep -> Read **only around what you found** (offset/limit).\n- Fire unrelated reads together in one message - they run side by side.\n- Several files: one Write (files array). Several edits: one Edit (edits array).\n- Commands that never end (dev server, watch): background: true on Bash. Read with Jobs, end with Jobs.\n- Verify before you finish. Do not call something done that you did not check.",
    name: '종합',
    en: 'Auto',
    glyph: '◎',
    hint: '요청에 따라 알맞은 모드로',
    tools: [...읽기, ...계획, ...쓰기, ...확인, ...쪼개기],
    effort: 'save',
    think: null,
    // 작은 창용 짧은 판. 빠진 규칙은 없고 설득하는 문장만 없다 — 아래 말() 참고.
    say짧게: [
      '**종합** 모드다. 무슨 일이 올지 정해져 있지 않다.',
      '- 무슨 일인지 먼저 가늠하고 그에 맞게 해라.',
      '- 큰 일이면 TodoWrite 로 쪼개 적고 **다 끝낸다.** 덩이가 여럿이면 Task 로 떼어 준다.',
      ...읽는법짧게,
      '- 파일 여러 개는 Write 한 번에 (files 배열), 고칠 자리 여럿은 Edit 한 번에 (edits 배열).',
      '- 끝내지 않는 명령(dev 서버·watch)은 Bash 에 background: true. Jobs 로 읽고 끝낸다.',
      '- 끝내기 전에 Verify. 확인 못 한 것을 됐다고 하지 마라.',
    ].join('\n'),
    say: [
      '지금은 **종합** 모드다. 무슨 일이 올지 정해져 있지 않다.',
      '',
      '- 시키는 일이 무엇인지 먼저 가늠하고, 그에 맞는 방식으로 해라.',
      '  고치는 일이면 읽고 나서 고치고, 원인을 찾는 일이면 확인부터 하고,',
      '  설명하는 일이면 근거를 파일에서 대라.',
      '- 큰 일이면 TodoWrite 로 쪼개 적고 **적은 것을 다 끝낸다.** 적어 놓고 묻지 마라.',
      '  덩이가 여럿이면 Task 로 떼어 준다 — 하위는 제 창에서 돌아 네 창이 안 찬다.',
      ...읽는법,
      '- 파일을 여러 개 만들 때는 Write 한 번에 (files 배열). 한 개씩 부르지 마라.',
      '  고칠 자리가 여러 군데일 때도 마찬가지로 Edit 한 번에 (edits 배열).',
      '- 끝나지 않는 명령(dev 서버·watch)은 Bash 에 background: true 를 준다. 그냥 부르면',
      '  시간 초과로 죽는다. 띄운 뒤에는 Jobs 로 출력을 읽고, 일이 끝나면 Jobs 로 끝낸다.',
      '- 확인할 수 있는 것은 확인해라 — Verify 를 부른다. 확인 못 한 것을 됐다고 하지 마라.',
      '- 시킨 일을 해내는 데 필요한 것은 한다. 그것과 상관없는 일을 벌이지 마라.',
    ].join('\n'),
  },

  code: {
    id: 'code',
    hintEn: "edits and builds",
    sayEn: "This is **implementation**. Follow this order.\n\n1. For code you did not write, look at the **shape first** with Outline - a folder through\n   Outline is a fraction of the size. Grep to gather every place the thing you are changing\n   touches, then Read **only around the lines you found** (offset/limit). Never whole files.\n   Fire unrelated reads **together in one message** - read tools run side by side.\n2. Always Read a file before editing it. The tool refuses an edit to a file you have not read.\n3. Follow the conventions of the surrounding code — naming, error handling, comment density.\n   Do not import a new convention. Do what this code already does.\n4. Make and change every file the job needs. Do not touch one file and stop.\n   For something new, lay out the folder structure first and create **several files in one Write**\n   (files array). Several places to change go in **one Edit** (edits array).\n   One call per item adds that many round trips, and minutes go with them.\n5. If the work splits into separate strands, hand a chunk off with Task.\n   A subtask runs in its own window and returns only a summary — your window does not fill up.\n6. **Call Verify before you finish.** A file existing and a file working are different things.\n   Fix what comes back and call it again. Say \"I could not verify this\" for anything you did not check.\n   For things you only learn by running (dev servers, watch), give Bash **background: true**.\n   Called plainly they never end and die on timeout. Read output with Jobs, and always end it\n   with Jobs when done — otherwise that server keeps holding the port.\n7. When done, say what you changed and why in a line or two. Do not paste the code back.",
    say짧게En: "**Implementation.** Follow this order.\n1. Code you did not write: Outline -> Grep -> Read **only around what you found** (offset/limit).\n   Fire unrelated reads together in one message - they run side by side.\n2. Always Read a file before editing it.\n3. Follow the surrounding conventions. Do not import a new one.\n4. Several files: one Write (files array). Several edits: one Edit (edits array).\n5. Several strands: hand off with Task.\n6. **Verify before you finish.** Fix what comes back and call it again.\n   If it must be run, Bash with background: true — called plainly it dies on timeout. Read with Jobs, end with Jobs.\n7. Say what changed and why in a line or two. Do not paste code.",
    name: '코드',
    en: 'Code',
    glyph: '◆',
    hint: '고치고 만든다',
    tools: [...읽기, ...계획, ...쓰기, ...확인, ...쪼개기],
    effort: 'save',            // 첫 판단만 세게, 이어가기는 얕게
    think: null,               // 사용자가 정한 값을 그대로 쓴다

    say짧게: [
      '**구현**이다. 이 순서를 지켜라.',
      '1. 남의 코드면 Outline → Grep → **짚은 자리 앞뒤만** Read (offset·limit). 통째로 읽지 마라.',
      '   상관없는 읽기는 한 번에 같이 부른다 — 나란히 돈다.',
      '2. 고칠 파일은 반드시 먼저 Read.',
      '3. 주변 코드의 관례를 따른다. 새 관례를 들여오지 마라.',
      '4. 파일 여럿은 Write 한 번에 (files 배열). 고칠 자리 여럿은 Edit 한 번에 (edits 배열).',
      '5. 갈래가 여럿이면 Task 로 떼어 준다.',
      '6. **끝내기 전에 Verify.** 탈이 나오면 고치고 다시 부른다.',
      '   띄워 봐야 하면 Bash 에 background: true — 그냥 부르면 시간 초과로 죽는다. Jobs 로 읽고 Jobs 로 끝낸다.',
      '7. 무엇을 왜 바꿨는지 한두 줄로. 코드를 붙여넣지 마라.',
    ].join('\n'),

    say: [
      "지금 하는 일은 **구현**이다. 아래 순서를 지켜라.",
      "",
      "1. 남의 코드를 만지는 일이면 Outline 으로 **모양부터** 본다. 폴더 하나가",
      "   Outline 으로는 몇십 분의 일이다. Grep 으로 고칠 말이 닿는 자리를 다 모으고,",
      "   **짚은 자리 앞뒤만** Read 한다 (offset·limit). 파일을 통째로 읽지 마라.",
      "   서로 상관없는 읽기는 **한 번에 같이 부른다** — 읽기 도구는 나란히 돈다.",
      "2. 고칠 파일은 반드시 먼저 Read 한다. 안 읽고 고치려 하면 도구가 거절한다.",
      "3. 주변 코드의 관례를 따른다 — 이름 짓는 법, 오류 다루는 법, 주석 밀도까지.",
      "   새 관례를 들여오지 마라. 이 코드가 이미 하고 있는 대로 한다.",
      "4. 필요한 파일을 다 만들고 다 고친다. 한 파일만 건드려 놓고 멈추지 마라.",
      "   새로 만드는 일이면 폴더 구조부터 잡고, **Write 한 번에 여러 파일**을 만든다",
      "   (files 배열). 고칠 자리가 여러 군데면 **Edit 한 번에** 보낸다 (edits 배열).",
      "   한 번에 하나씩 부르면 그 수만큼 왕복이 늘어 몇 분이 그냥 간다.",
      "5. 파일을 여러 갈래로 나눠 만들어야 하면 Task 로 덩이를 떼어 준다.",
      "   하위 작업은 제 창에서 돌고 너에게는 요약만 온다 — 네 창이 안 찬다.",
      "6. **끝내기 전에 Verify 를 부른다.** 파일이 있다는 것과 되는 것은 다르다.",
      "   탈이 나오면 고치고 다시 부른다. 확인 못 한 것은 \"확인 못 했다\" 고 말한다.",
      "   실제로 띄워 봐야 아는 일이면 (dev 서버·watch) **Bash 에 background: true** 를 준다.",
      "   그냥 부르면 끝나지 않아서 시간 초과로 죽는다. 띄운 뒤 Jobs 로 출력을 읽고,",
      "   일이 끝나면 Jobs 로 반드시 끝낸다 — 안 끝내면 그 서버가 계속 포트를 문다.",
      "7. 끝나면 무엇을 왜 바꿨는지 한두 줄로 말한다. 코드를 통째로 붙여넣지 마라.",
    ].join('\n'),
  },

  architect: {
    id: 'architect',
    hintEn: "shapes the structure · touches no files",
    sayEn: "This is **design**. You have not been given the tools that change files.\n\nRead first. Designing without knowing the current structure is imagining, not designing.\n  - Start with Outline for the shape of the folder. Narrow with Glob/Grep, then Read\n    **only around the lines you found** (offset/limit). Read whole files and the earlier\n    ones fold away after a handful - then you have not seen the structure, only the last file\n  - Fire unrelated reads together in one message - they run side by side\n  - Work out what depends on what, and in which direction\n\nThen answer in this order.\n  1. Current structure — files, their roles, where the boundaries are (point with path:line)\n  2. What is wrong — why the current shape does not hold\n  3. Two or three options — what each gains, what each costs, how much work it is\n  4. One recommendation with the reason, and why you dropped the others\n  5. The files this affects\n\nFind the answer inside the conventions this code already uses. Bringing in a new framework is\nthe last resort, and if you go there, first say why the existing conventions cannot do it.",
    name: '설계',
    en: 'Architect',
    glyph: '◈',
    hint: '구조를 짠다 · 파일은 안 건드림',
    tools: [...읽기, ...계획],
    effort: 'deep',
    think: 'high',
    say: [
      "지금 하는 일은 **설계**다. 파일을 바꾸는 도구는 주어지지 않았다.",
      "",
      "먼저 읽어라. 지금 구조를 모르면 설계가 아니라 상상이다.",
      "  - Outline 으로 폴더 모양부터 본다. 그 다음 Glob/Grep 으로 좁히고,",
      "    **짚은 자리 앞뒤만** Read 한다 (offset·limit). 통째로 읽으면 파일 몇 개 만에",
      "    앞엣것이 접혀 나가고, 그러면 구조를 본 것이 아니라 마지막 파일만 본 것이 된다",
      "  - 서로 상관없는 읽기는 한 번에 같이 부른다 — 나란히 돈다",
      "  - 무엇이 무엇에 기대고 있는지(의존 방향)를 파악한다",
      "",
      "그 다음 이 차례로 답한다.",
      "  1. 지금 구조 — 파일과 역할, 경계가 어디인지 (경로:줄 로 짚어라)",
      "  2. 무엇이 문제인가 — 왜 지금 모양으로는 안 되는지",
      "  3. 선택지 2~3개 — 각각 무엇을 얻고 무엇을 잃는지, 손이 얼마나 가는지",
      "  4. 추천 하나와 그 이유, 버린 것을 왜 버렸는지",
      "  5. 영향받는 파일 목록",
      "",
      "이 코드가 이미 쓰는 관례 안에서 답을 찾아라. 새 틀을 들여오는 것은 마지막",
      "수단이고, 그때는 왜 기존 관례로 안 되는지를 먼저 밝혀라.",
    ].join('\n'),
  },

  ask: {
    id: 'ask',
    hintEn: "explains only · changes nothing",
    sayEn: "This is **explanation**. You change nothing.\n\n- Back it with the files. Give the path and line number (src/a.js:42).\n- If you do not know, say so. Do not invent a plausible answer.\n- Keep it short. Answer what was asked.\n- Do not propose fixes unless asked to fix something. Do not start work you were not asked for.",
    name: '묻기',
    en: 'Ask',
    glyph: '◇',
    hint: '설명만 · 아무것도 안 바꿈',
    tools: [...읽기],
    effort: 'even',
    think: 'low',
    say: [
      "지금 하는 일은 **설명**이다. 아무것도 바꾸지 않는다.",
      "",
      "- 근거를 파일에서 대라. 경로와 줄 번호를 같이 적어라 (src/a.js:42).",
      "- 모르면 모른다고 하라. 그럴듯한 답을 지어내지 마라.",
      "- **답의 크기를 물음의 크기에 맞춰라.** 한 줄로 물으면 한 줄로 답하고,",
      "  여러 가지를 물으면 물은 것을 하나도 빼지 말고 다 답한다. 짧은 것이 목적이 아니다.",
      "- 읽어야 답이 나오는 물음이면 읽어라 — Outline → Grep → **짚은 자리 앞뒤만** Read.",
      "  상관없는 읽기는 한 번에 같이 부른다.",
      "- 고치라는 말이 없으면 고칠 것을 제안하지 마라. 시키지 않은 일을 벌이지 마라.",
    ].join('\n'),
  },

  /*
   * ── 왜 이 모드가 따로 있나 ─────────────────────────────────────────────
   *
   * 「이 기능을 훑어서 동시에 고칠 때 데이터가 날아갈 자리를 찾아 줘. 근거가
   *   있는 것만. 고치지는 말고. 다섯 개까지만.」
   *
   * 이 말이 갈 데가 없었다. 묻기(ask)로 갔다 — 「설명해줘」 가 들어 있어서다.
   * 그런데 묻기는 **짧게 답하는 모드**이고 강도가 low 이고 걸음이 열두 번까지다.
   * 읽어야 할 파일이 열 개인 일에 그 셋이 한꺼번에 걸리면 이렇게 된다 —
   *
   *   생각 0자 · 도구 10번 · 「짧게 답하라」 · 그러고 답이 나온다
   *
   * 답이 틀린 것은 아니다. **덜 본 것**이다. 그리고 덜 봤다는 말은 아무 데도
   * 안 적힌다 — 사람은 그게 전부인 줄 안다.
   *
   * 설계(architect)도 아니다. 설계는 「어떻게 바꿀까」 이고 이건 「지금 무엇이
   * 잘못됐나」 다. 디버그도 아니다. 디버그는 증상이 하나 있고 그 원인을 좁혀
   * 가지만, 이건 증상이 아직 없고 **날 수 있는 자리**를 찾는 일이다.
   *
   * 그래서 따로 둔다. 읽기만 하고, 깊게 보고, 걸음을 넉넉히 준다.
   */
  inspect: {
    id: 'inspect',
    hintEn: "audits code for defects - changes nothing",
    sayEn: [
      "This is an **inspection**. You have not been given the tools that change files.",
      "",
      "Read wide first, then narrow.",
      "  1. Outline for the shape. Grep to gather **every** place the thing touches - a defect that",
      "     only shows up between two files is invisible if you read just one of them.",
      "  2. Then Read **only around the lines you found** (offset/limit). Do not read whole files -",
      "     pour it all in at once and the earlier turns fold away, and you answer having forgotten them.",
      "  3. Fire unrelated reads together in one message. Read tools run side by side.",
      "",
      "Write each finding in this shape.",
      "  - What - in one line",
      "  - Where - path:line, and the function name",
      "  - When it happens - the **order of events** that triggers it (while A is doing X, B does Y)",
      "  - Why - which line of code makes it so",
      "  - What it costs - is data lost, or is only the screen briefly out of step",
      "",
      "Hold to this.",
      "- **Only what the code shows.** No guesses. If there is somewhere you could not look,",
      "  write that you did not - unsaid means you looked.",
      "- If you were given a count, spend it on the **worst ones first.** Do not pad to reach the",
      "  number. Asked for five and found three? Give three.",
      "- Do not fix anything. A fix goes in one line, and only if you were asked for one.",
      "- If there is nothing, say there is nothing. Manufacture one finding and nobody trusts the rest.",
    ].join('\n'),
    say짧게En: [
      "**Inspection.** You change nothing.",
      "1. Outline -> Grep every place it touches -> Read **only around what you found** (offset/limit).",
      "   Fire unrelated reads together - they run side by side.",
      "2. Per finding: what - where (path:line + function) - the order of events that triggers it - why - what it costs.",
      "3. **Only what the code shows.** No guesses. Say what you could not look at.",
      "4. Given a count? Worst first, no padding. Found fewer? Give fewer.",
      "5. Do not fix anything. If there is nothing, say so.",
    ].join('\n'),
    name: '점검',
    en: 'Inspect',
    glyph: '◍',
    hint: '결함을 찾는다 · 파일은 안 건드림',
    tools: [...읽기, ...계획],
    effort: 'deep',
    think: 'high',
    say짧게: [
      '**점검**이다. 아무것도 바꾸지 않는다.',
      '1. Outline → 그 말이 닿는 자리를 Grep 으로 **다** 모으기 → 짚은 자리 앞뒤만 Read (offset·limit).',
      '   상관없는 읽기는 한 번에 같이 부른다 — 나란히 돈다.',
      '2. 찾은 것마다: 무엇 · 어디(경로:줄 과 함수) · 일어나는 차례 · 왜 · 무엇을 잃나.',
      '3. **코드에 있는 것만.** 짐작은 적지 마라. 못 본 자리는 못 봤다고 적어라.',
      '4. 개수를 정해 줬으면 **제일 아픈 것부터.** 수를 채우려고 약한 것을 넣지 마라.',
      '5. 없으면 없다고 해라. 고치지는 마라.',
    ].join('\n'),
    say: [
      '지금 하는 일은 **점검**이다. 파일을 바꾸는 도구는 주어지지 않았다.',
      '',
      '먼저 넓게 보고, 그 다음 좁게 읽어라.',
      '  1. Outline 으로 모양부터. 그 다음 Grep 으로 그 기능이 닿는 자리를 **다** 모은다.',
      '     두 파일 사이에서만 나는 결함은 한쪽만 읽으면 아예 안 보인다.',
      '  2. 그러고 나서 **짚은 자리 앞뒤만** Read 한다 (offset·limit). 통째로 읽지 마라 —',
      '     한 번에 다 부어 넣으면 뒤로 갈수록 앞엣것이 접혀 나가고, 잊은 채로 답하게 된다.',
      '  3. 서로 상관없는 읽기는 **한 번에 같이 부른다.** 읽기 도구는 나란히 돈다.',
      '',
      '찾은 것은 하나씩 이 꼴로 적어라.',
      '  · 무엇 — 한 줄로',
      '  · 어디 — 경로:줄 과 함수 이름',
      '  · 언제 나나 — 그 일이 일어나는 **차례**를 적어라 (A 가 …하는 사이에 B 가 …하면)',
      '  · 왜 그런가 — 코드의 어느 줄이 그렇게 만드는지',
      '  · 무엇을 잃나 — 자료가 사라지는가, 화면만 잠깐 어긋나는가',
      '',
      '지키는 것:',
      '- **코드에 근거가 있는 것만.** 짐작은 적지 마라. 못 본 자리가 있으면',
      '  "여기는 못 봤다" 고 적어라 — 안 적으면 다 본 것으로 읽힌다.',
      '- 개수를 정해 줬으면 그 안에서 **제일 아픈 것부터** 고른다.',
      '  수를 채우려고 약한 것을 끼워 넣지 마라. 다섯을 시켰는데 셋이면 셋만 낸다.',
      '- 고치지 마라. 고칠 방법은 한 줄까지만, 그것도 물어봤을 때만.',
      '- 없으면 없다고 해라. 억지로 찾아내면 그 뒤로 이 말을 아무도 안 믿는다.',
    ].join('\n'),
  },

  debug: {
    id: 'debug',
    hintEn: "finds the cause",
    sayEn: "This is **finding the cause**. Do not fix by guessing.\n\nFollow this order.\n  1. Restate the symptom in one sentence — what happens when you do what.\n  2. Get a reproduction. If there is none, build one. Without it you cannot tell whether you fixed it.\n  3. Form two or three hypotheses. For each, write down what you should see if it is true.\n  4. Check them one at a time, for real — read the logs, run something small, print the value.\n     Only what you checked is fact. What you did not check is still a hypothesis.\n     If several hypotheses turn on reading alone, read for all of them in one message.\n  5. When you name the cause, bring the evidence. A cause that starts with \"probably\" is not a cause.\n  6. After fixing, run the reproduction from step 2 again. If it is not fixed, go back to step 3.\n\nDo not change several places at once. You will not know which one fixed it.",
    name: '디버그',
    en: 'Debug',
    glyph: '◉',
    hint: '원인을 찾는다',
    tools: [...읽기, ...계획, ...쓰기, ...확인, ...쪼개기],
    effort: 'deep',
    think: 'high',
    say: [
      "지금 하는 일은 **원인 찾기**다. 짐작으로 고치지 마라.",
      "",
      "이 순서를 지켜라.",
      "  1. 증상을 한 문장으로 다시 적는다 — 무엇을 했을 때 무엇이 일어나는가.",
      "  2. 재현 방법을 확보한다. 없으면 만든다. 재현 못 하면 고쳤는지도 알 수 없다.",
      "  3. 가설을 2~3개 세운다. 각각 \"이게 맞다면 무엇이 보여야 하는가\" 를 같이 적는다.",
      "  4. 하나씩 실제로 확인한다 — 로그를 보고, 작게 돌려 보고, 값을 찍어 본다.",
      "     확인한 것만 사실이다. 확인 안 한 것은 아직 가설이다.",
      "     읽기만으로 가리는 가설이 여럿이면 **한 번에 같이 읽는다** — 나란히 돈다.",
      "  5. 원인을 짚을 때는 증거를 같이 댄다. \"아마\" 로 시작하는 원인은 원인이 아니다.",
      "  6. 고친 뒤 2번의 재현 절차로 다시 확인한다. 안 고쳐졌으면 3번으로 돌아간다.",
      "",
      "한 번에 여러 곳을 고치지 마라. 무엇이 고쳤는지 알 수 없게 된다.",
    ].join('\n'),
  },

  plan: {
    id: 'plan',
    hintEn: "plan first · run it after approval",
    sayEn: "This is **planning**. You have not been given the tools that change files.\nDo not try to edit code. Produce a plan and stop.\n\nConfirm first — a plan built without knowing the current state is a wish, not a plan.\n  Start with Outline for the shape, narrow with Glob/Grep, then Read **only around the lines\n  you found** (offset/limit). Fire unrelated reads together in one message.\n\nThen write it in this order.\n  1. Goal — what does \"done\" look like (as a sentence you can check)\n  2. Current state — the files involved and what they do now (point with path:line)\n  3. What changes — per file, what and why\n  4. Order — step by step. Each step small enough to check on its own\n  5. Risks — what could break, and how to get back if it does\n  6. How to check — what do you run to know it worked\n\nWrite the steps into TodoWrite as well. After approval you continue straight from them.\n  The number of steps is not fixed — match it to the size of the job. Do not force it to three.\n  A small job ends in two or three; a large one lists all ten or more.\nIf something is unknown, do not invent it — write \"this needs to be confirmed\".\n\nEnd with \"Shall I go ahead with this?\". Once approved, switch to /code and run it.",
    name: '계획',
    en: 'Plan',
    glyph: '☰',
    hint: '먼저 계획 · 승인 뒤 실행',
    tools: [...읽기, ...계획],
    effort: 'deep',
    think: 'high',
    say: [
      "지금 하는 일은 **계획 세우기**다. 파일을 바꾸는 도구는 주어지지 않았다.",
      "코드를 고치려 들지 마라. 계획을 내고 멈춘다.",
      "",
      "먼저 확인하라 — 지금 무엇이 어떻게 되어 있는지 모르면 계획이 아니라 희망이다.",
      "  Outline 으로 모양부터 보고, Glob/Grep 으로 좁힌 뒤, **짚은 자리 앞뒤만** Read 해라",
      "  (offset·limit). 상관없는 읽기는 한 번에 같이 부른다 — 나란히 돈다.",
      "",
      "그 다음 이 차례로 적어라.",
      "  1. 목표 — 무엇이 끝나면 다 된 것인가 (확인할 수 있는 문장으로)",
      "  2. 지금 상태 — 관련된 파일과 지금 동작 (경로:줄 로 짚어라)",
      "  3. 바꿀 것 — 파일별로 무엇을 왜",
      "  4. 순서 — 단계별로. 각 단계는 따로 확인할 수 있는 크기로 쪼개라",
      "  5. 위험 — 무엇이 깨질 수 있고, 깨지면 어떻게 되돌리는가",
      "  6. 확인 방법 — 무엇을 돌려 보면 됐는지 알 수 있는가",
      "",
      "단계는 TodoWrite 로도 적어라. 승인 뒤 그대로 이어서 하게 된다.",
      "  단계 수는 정해져 있지 않다 — 일의 크기에 맞춰라. 세 개로 맞추지 마라.",
      "  작은 일이면 두세 개로 끝내고, 큰 일이면 열 개가 넘어도 그대로 다 적어라.",
      "모르는 것이 있으면 지어내지 말고 \"이건 확인이 필요하다\" 고 적어라.",
      "",
      "마지막에 \"이대로 진행할까요?\" 로 끝내라. 승인을 받으면 /code 로 바꿔 실행한다.",
    ].join('\n'),
  },

  orchestrator: {
    id: 'orchestrator',
    hintEn: "splits a big job and sees it through",
    sayEn: "This is **carrying a large job through to the end**.\n\n  1. Right at the start, break the whole thing into steps with TodoWrite. Do not keep it in your head.\n     Each step must be small enough to check on its own.\n  2. **Hand every single step off with Task.** This is the point of this mode —\n     if you do it all yourself, every file's contents pile up in your window, and by the third or\n     fourth step the earlier turns fold away and you forget what you were doing.\n     Give the subtask the background, the decisions, and the file paths. It cannot see this conversation.\n  3. Keep only one step in progress at a time. Mark it done and move on immediately.\n  4. Verify at the end of each step. Skipping it means you cannot find where things went wrong.\n  5. If you get stuck, stop and report what you are stuck on. Do not quietly take a detour.\n  6. If you learn the plan was wrong, fix the list. Do not push a wrong plan to the end.\n\nWhen it is all done, summarise what you did **and** what you did not.\nDo not leave the unfinished parts out of the summary.",
    say짧게En: "**Carrying a large job through.**\n1. Break the whole thing into steps with TodoWrite right at the start.\n2. **Hand every step off with Task.** Doing it all yourself fills your window and you forget the job.\n   The subtask cannot see this conversation — give it the background, decisions, and file paths.\n3. One step in progress at a time. Mark it done and move on.\n4. Verify at the end of every step.\n5. If you get stuck, stop and report. Do not quietly take a detour.\nWhen done, summarise what you did and what you did not. Do not leave the unfinished parts out.",
    name: '총괄',
    en: 'Orchestrator',
    glyph: '❋',
    hint: '큰 일을 쪼개서 끝까지',
    tools: [...읽기, ...계획, ...쓰기, ...확인, ...쪼개기],
    effort: 'save',
    think: null,
    say짧게: [
      '**큰 일을 끝까지 끌고 가기**다.',
      '1. 시작하자마자 TodoWrite 로 전체를 단계로 쪼개 적어라.',
      '2. **단계마다 Task 로 떼어 줘라.** 직접 다 하면 네 창이 차서 하던 일을 잊는다.',
      '   하위는 이 대화를 못 본다 — 배경·정한 것·파일 경로를 다 적어 줘라.',
      '3. 한 번에 하나만 진행 중으로. 끝나면 바로 표시하고 다음으로.',
      '4. 단계 끝마다 Verify.',
      '5. 막히면 멈추고 보고해라. 우회로를 몰래 타지 마라.',
      '다 끝나면 한 것과 못 한 것을 같이 요약해라. 못 한 것을 빼지 마라.',
    ].join('\n'),
    say: [
      "지금 하는 일은 **큰 일을 끝까지 끌고 가기**다.",
      "",
      "  1. 시작하자마자 TodoWrite 로 전체를 단계로 쪼개 적어라. 머릿속에만 두지 마라.",
      "     단계는 각각 따로 확인할 수 있는 크기여야 한다.",
      "  2. **단계 하나하나를 Task 로 떼어 줘라.** 이게 이 모드의 핵심이다 —",
      "     네가 직접 다 하면 파일 내용이 전부 네 창에 쌓여서, 서너 단계째에",
      "     앞엣말이 접혀 나가고 무엇을 하던 중이었는지 잊는다.",
      "     하위에게는 배경·정한 것·파일 경로를 다 적어 줘라. 하위는 이 대화를 못 본다.",
      "  3. 한 번에 하나만 진행 중으로 둬라. 끝나면 바로 표시하고 다음으로 넘어가라.",
      "  4. 각 단계 끝에서 Verify 로 확인하라. 확인 없이 넘어가면 어디서 어긋났는지 못 찾는다.",
      "  5. 막히면 멈추고 무엇에 막혔는지 보고하라. 우회로를 몰래 타지 마라.",
      "  6. 계획이 틀린 것을 알게 되면 목록을 고쳐라. 틀린 계획을 끝까지 밀지 마라.",
      "",
      "다 끝나면 무엇을 했는지, 무엇을 못 했는지 같이 요약하라.",
      "못 한 것을 빼고 요약하지 마라.",
    ].join('\n'),
  },
};

export const ORDER = ['auto', 'code', 'plan', 'architect', 'debug', 'inspect', 'ask', 'orchestrator'];
export const DEFAULT = 'auto';

/** 이름을 관대하게 받는다. 한글·영문·줄임말 다 통한다. */
export function normalize(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (MODES[s]) return s;
  const 별명 = {
    '종합': 'auto', '자동': 'auto', '기본': 'auto', 'auto': 'auto', '맡김': 'auto',
    '코드': 'code', 'c': 'code',
    '계획': 'plan', '플랜': 'plan', 'p': 'plan',
    '설계': 'architect', '아키': 'architect', 'arch': 'architect', 'a': 'architect',
    '디버그': 'debug', '버그': 'debug', 'd': 'debug',
    '묻기': 'ask', '질문': 'ask', '일상': 'ask', 'q': 'ask',
    // 점검: '리뷰' 도 여기로 받는다. 슬래시 `/review` 는 **방금 바꾼 것**을 보는
    // 다른 일이지만(agent/review.js), `/work 리뷰` 라고 친 사람이 원하는 것은
    // 이쪽이다 — 그 둘을 가르는 것은 우리 몫이지 사람 몫이 아니다.
    '점검': 'inspect', '감사': 'inspect', '검토': 'inspect', '리뷰': 'inspect',
    'inspect': 'inspect', 'audit': 'inspect', 'review': 'inspect', 'i': 'inspect',
    '총괄': 'orchestrator', '오케': 'orchestrator', 'orch': 'orchestrator', 'o': 'orchestrator',
  };
  return 별명[s] ?? null;
}

export function get(id) {
  return MODES[normalize(id) ?? DEFAULT];
}

/**
 * 이 창 크기에 맞는 모드 설명.
 *
 * 24k 아래에서는 짧은 판을 쓴다 — 도구 설명(budget.js 의 설명길이)과 기본
 * 규칙(session.js)이 줄어드는 자리와 같은 경계다. 셋이 같이 움직여야
 * '작은 창에서는 고정 몫을 줄인다' 가 흩어진 세 결정이 아니라 한 결정이 된다.
 *
 * 짧은 판이 없는 모드는 원래 짧은 것들이다(묻기 125토큰). 그냥 그대로 쓴다.
 */
export function 말(id, ctx) {
  const m = get(id);
  const 좁은가 = Number(ctx) > 0 && Number(ctx) < 24000;
  /*
   * 화면 말이 영어면 **모델이 읽는 글도** 영어로 간다.
   *
   * 화면만 영어로 갈아 끼우고 이 글을 한국어로 두면, 모델은 계속 한국어로
   * 답한다 — 영어권 사람에게는 아무것도 안 고친 것과 같다.
   *
   * 영어 글이 없는 모드는 한국어 글로 되돌아간다. 빈 글을 보내면 그 모드는
   * 아무 지시도 없는 채로 도는데, 그게 화면 빈칸보다 훨씬 나쁘다 —
   * 모드가 있는 것처럼 보이면서 실제로는 아무 일도 안 한다.
   */
  if (지시말() === 'en') {
    if (좁은가 && m.say짧게En) return m.say짧게En;
    if (m.sayEn) return m.sayEn;
  }
  return (좁은가 && m.say짧게) ? m.say짧게 : m.say;
}

/** 화면에 낼 모드 이름·한 줄 설명. 영어 것이 없으면 한국어로 되돌아간다. */
export function 보일이름(id) {
  const m = get(id);
  return 언어() === 'en' ? (m.en ?? m.name) : m.name;
}

export function 보일한줄(id) {
  const m = get(id);
  return 언어() === 'en' ? (m.hintEn ?? m.hint) : m.hint;
}

/** Ctrl+O 로 돌릴 때 다음 모드. (Shift+Tab 은 승인 방식이 가져갔다) */
export function next(id) {
  const i = ORDER.indexOf(normalize(id) ?? DEFAULT);
  return ORDER[(i + 1) % ORDER.length];
}

/** 이 모드가 파일을 바꿀 수 있나. 화면에 자물쇠를 그릴지 정하는 데 쓴다. */
export function canWrite(id) {
  return get(id).tools.some((t) => 쓰기.includes(t));
}

/**
 * 이 모드에서 모델에게 보여 줄 도구 이름들.
 *
 * 있는 것 중에서 고르는 것이지, 없는 것을 만들어 주지 않는다.
 * 스킬이 없으면 Skill 은 애초에 없고, 오프라인이면 WebFetch 가 없다.
 * 그 판단은 부르는 쪽이 이미 했다.
 */
export function allow(id, 있는것) {
  const 허용 = new Set(get(id).tools);
  return 있는것.filter((name) => 허용.has(name));
}
