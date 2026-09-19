// 슬래시 명령 이름표. 이름과 인자 유무만 — 사람이 읽는 글은 i18n 쪽에 있다.
//
// ── 왜 파일이 따로인가 ──────────────────────────────────────────────────
//
// 이 표를 보고 싶은 자리가 commands.js 바깥에도 있다. `deel run /이름` 이
// 그렇다 — 비대화 모드는 「이 이름이 대화 화면 전용인가」 를 알아야 "모르는
// 명령" 대신 "그건 대화 화면에서만 됩니다" 라고 말해 줄 수 있다.
//
// 그렇다고 oneshot.js 가 commands.js 를 부를 수는 없다. 그쪽은 대화 화면
// 한 벌을 통째로 끌고 온다 — 미리보기 서버 · 클립보드 · 화면 그리기까지.
// 배치로 도는 길에 그것이 딸려 들어오면 켜는 데만 시간이 늘고, 언젠가 그
// 안의 무엇이 사람을 기다리기 시작하면 배치가 그 자리에서 선다. 이 파일이
// 들여오는 것이 하나도 없는 것은 그래서다 — 표는 그냥 표다.
//
// desc·arg 를 게터로 만드는 일(COMMANDS)은 commands.js 에 그대로 뒀다.
// 그쪽은 i18n 을 부르므로 여기 두면 이 파일이 더는 순수한 표가 아니다.

export const 명령들 = {
  help: { arg: false },
  clear: { arg: false },
  context: { arg: false },
  ctx: { arg: true },
  out: { arg: true },
  grade: { arg: true },
  compact: { arg: false },
  model: { arg: true },
  think: { arg: true },
  mode: { arg: true },
  work: { arg: true },
  auto: { arg: false },
  code: { arg: false },
  plan: { arg: false },
  architect: { arg: false },
  debug: { arg: false },
  ask: { arg: false },
  inspect: { arg: false },
  orchestrator: { arg: false },
  undo: { arg: true },
  diff: { arg: true },
  preview: { arg: true },
  tools: { arg: false },
  skills: { arg: true },
  plugin: { arg: true },
  cost: { arg: false },
  status: { arg: false },
  scan: { arg: true },
  thread: { arg: true },
  learned: { arg: true },
  pin: { arg: true },
  evidence: { arg: true },
  commit: { arg: true },
  review: { arg: false },
  paste: { arg: false },
  sessions: { arg: false },
  recall: { arg: true },
  mcp: { arg: false },
  hooks: { arg: false },
  agents: { arg: false },
  memory: { arg: true },
  level: { arg: true },
  bell: { arg: true },
  keys: { arg: false },
  motion: { arg: true },
  consult: { arg: true },
  lang: { arg: true },
  lsp: { arg: true },
  export: { arg: true },
  init: { arg: false },
  exit: { arg: false },
  quit: { arg: false },
};

/*
 * 이름표에 없지만 `commands.js` 가 받아 주는 **딴이름**.
 *
 * 왜 따로 두나 — 도움말·자동완성에는 정식 이름 하나만 뜨는 게 맞다. 그런데
 * 「이게 명령 이름인가」 를 묻는 자리(`경로처럼보이나`)가 이 표만 보면,
 * `plugins/` 나 `serve/` 폴더가 있는 저장소에서 `/plugins` 가 **경로로 읽혀**
 * 명령이 안 돌고 모델에게 그대로 넘어간다. 딴이름도 이름이다.
 *
 * `test/commands.test.js` 가 `commands.js` 의 `case '…'` 이름이 전부
 * 이 둘 중 한 표에 있는지 본다 — 새 딴이름을 만들고 여기 안 적으면 빨개진다.
 */
export const 딴이름들 = {
  serve: 'preview',
  plugins: 'plugin',
};
