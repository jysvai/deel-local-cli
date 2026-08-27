[← README 로](../../README.md)

# 개발

검사 돌리기 · 어디를 밟았는지 · 폴더 구조

---

## 개발

<sub>어디를 밟았는지 · 폴더 구조</sub>

### 어디를 밟았는지

```bash
npm run coverage                          전체 요약
node test/coverage.mjs --file src/repl.js  한 파일 자세히
node test/coverage.mjs --json              기계가 읽을 형태로
```

의존성이 0개라 c8·nyc 를 못 씁니다. 대신 Node 에 원래 들어 있는
`NODE_V8_COVERAGE` 를 읽습니다 — 새로 반입 심사할 것이 하나도 안 늡니다.
자식 프로세스까지 잡히므로 `deel` 을 띄워 보는 `cli` 검사도 그대로 집계됩니다.

지금 **전체 92%** (7,646줄 중 7,056줄). 일부러 못 채운 곳이 셋 있습니다.

| 파일 | 지금 | 왜 못 채우나 |
|---|---|---|
| `tools/excel.js` | 67% | 암호 걸린 엑셀을 여는 길. 이 PC 에 엑셀이 깔려 있고 암호 걸린 진짜 파일이 있어야 합니다. 흉내 내면 '되는 것처럼 보이는' 검사가 됩니다 |
| `repl.js` | 77% | 사람이 키를 누르는 길 — Shift+Tab, Ctrl+C, 암호 입력, 붙여넣기. 가짜 터미널(pty)이 있어야 밟히는데 그건 의존성입니다. 대신 화면에 나가는 **글**은 값으로 재 봅니다(`ui`·`tui` 검사) |
| `plugins/manage.js` | 79% | GitHub 에서 내려받는 길. **검사가 바깥으로 안 나간다**는 약속이 먼저입니다. 폴더에서 설치하는 길은 검사합니다 |

### 폴더 구조

```
bin/deel.js              진입점
src/
  repl.js                대화 화면 — 사람이 마주하는 자리
  oneshot.js             한 번 돌리고 끝내기 (-p)
  commands.js            / 명령 35종
  setup.js               처음 켤 때 연결 잡기
  config.js              설정 읽고 쓰기

  ui/ansi.js             색 · 한글 폭 계산
  ui/screen.js           화면 고르기 (줄 화면 / 상자 화면)
  ui/inputbox.js         맨 아래 입력 상자 — 덮어 그리기·커서 자리
  ui/status.js           상태줄 — 모델·컨텍스트·모드·승인
  ui/working.js          일하는 중 문구 — 지금 하는 일을 따라간다
  ui/motion.js           문구 옆에서 도는 점자 그림
  ui/intro.js            켤 때 도는 시작 모션
  ui/banner.js           켤 때 뜨는 큰 이름 — 선이 닫히며 경계를 말한다
  ui/approve.js          승인 방식 표시 (자동/위험만/모두)
  ui/diff.js             고친 자리를 그 자리에서 보여 주기
  ui/export.js           대화 → 보고서 한 장 (/export)
  ui/wrap.js             색을 지키며 폭에 맞춰 접기
  ui/level.js            쉬움 · 개발자

  agent/loop.js          에이전트 루프
  agent/session.js       대화 상태 + 컨텍스트 셈
  agent/modes.js         작업 모드 (종합·코드·계획·설계·디버그·묻기·총괄)
  agent/route.js         말을 보고 알맞은 모드 고르기
  agent/effort.js        단계별 추론 강도 배분
  agent/budget.js        창 크기에 맞춘 몫 — 읽을 줄·설명 길이·걸음 수
  agent/project.js       이 폴더가 무슨 프로젝트인지 읽기
  agent/compact.js       요약 압축
  agent/store.js         대화 저장·이어하기
  agent/recall.js        지난 대화 찾기 (색인 없이, 예산 안에서)
  agent/memory.js        대화가 끝나도 남는 것
  agent/mention.js       `@파일` 붙이기
  agent/card.js          겪어 본 버릇 → 하네스 조정 (/model 카드)
  agent/preset.js        겪기 전에 아는 모델 — 국산 모델 이름표

  backend/http.js        HTTP 한 겹 (바깥으로 나가는 유일한 문)
  backend/detect.js      규격·인증 자동 판별
  backend/adapter.js     OpenAI/Ollama 차이 흡수 + 스트리밍 파서
  backend/ctxsize.js     컨텍스트 길이를 모델에서 긁어오기
  backend/probe.js       진단 검사 8종
  backend/scan.js        로컬 서버 훑기
  backend/mcp.js         밖에서 도구 붙이기 (MCP, stdio)

  tools/index.js         도구 17종
  tools/edit-match.js    단계별 완화 편집 매칭
  tools/outline.js       파일 모양만 싸게 보기
  tools/verify.js        만든 것 확인
  tools/task.js          큰 일을 떼어 따로 돌리기
  tools/jobs.js          뒤에서 도는 명령
  tools/todo.js          할 일 목록
  tools/webfetch.js      웹 읽기 (읽기 전용)
  tools/encoding.js      읽은 인코딩 그대로 되돌려 쓰기
  tools/xlsx.js          엑셀 → CSV (직접 구현)
  tools/docs.js          hwpx·docx·pptx → 글 (직접 구현)
  tools/lsp.js           Def · Refs — 언어 서버에게 묻기

  lsp/rpc.js             LSP 말틀 (Content-Length + JSON-RPC, 직접 구현)
  lsp/servers.js         깔린 언어 서버 찾기 (안 깔아 준다)
  lsp/client.js          서버 하나 띄워 놓고 주고받기 · 시한 · 정리
  lsp/diag.js            고친 직후 그 파일이 성한지

  preview/serve.js       만든 웹 띄우기 (127.0.0.1 에만)
  skills/discover.js     그 PC 의 스킬·명령·플러그인 찾기
  plugins/manage.js      플러그인 설치·삭제·묶기
  pack/zip.js            ZIP 쓰기 (직접 구현, 한글 이름 보존)
  pack/tar.js            TAR 읽기 (직접 구현)
  pack/selfpack.js       반입 심사서 + 소스 묶기

  safety/network.js      나가는 자리 자물쇠
  safety/guard.js        작업 범위 + 위험 명령 차단
  safety/undo.js         스냅샷·되돌리기
  safety/audit.js        무엇을 언제 했는지 남기기
test/                    검증 (배포 묶음에서 뺀다)
```

## 판 올리기

npm 에는 **손으로 안 올립니다.** 태그를 밀면 GitHub Actions 가 검사를 다 돌리고
올리면서, "이 판은 이 저장소의 이 커밋에서 나왔다" 는 서명을 붙입니다
(npm provenance). 받는 사람이 npm 페이지에서 커밋 해시까지 확인할 수 있습니다 —
사내 심사에서 "받은 묶음이 공개된 그 소스가 맞나" 를 물을 때, 말이 아니라
링크로 답하는 자리입니다.

```bash
# package.json 의 판을 올리고 커밋한 뒤
git tag v1.4.0
git push origin v1.4.0
```

태그와 `package.json` 의 판이 다르면 올리기 전에 멈춥니다. npm 은 같은 판을
다시 못 올리므로, 어긋난 채 나가면 되돌릴 수가 없습니다.

한 번만 해 두어야 하는 것이 있습니다 — npm 에서 **Automation 형 토큰**을 만들어
저장소 `Settings → Secrets and variables → Actions` 에 `NPM_TOKEN` 으로 넣습니다.
Automation 토큰은 2FA 를 안 묻는 형이라 CI 에서 쓸 수 있습니다(사람이 손으로
올릴 때는 그대로 OTP 를 묻습니다).

---

[← README 로](../../README.md)
