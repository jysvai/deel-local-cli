[← README 로](../../README.ko.md)

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

지금 **전체 90%** — 재는 곳에 따라 다릅니다.

| 어디서 | 얼마 | | 언제 잰 것 |
|---|---|---|---|
| 윈도우 | 90.6% | 20,947/23,119 | 1.15.0 |
| 리눅스 | 90.0% | 20,800/23,119 | 1.15.0 (CI) |

윈도우 전용 길(`tools/excel-com.js` 등)이 리눅스에서 안 밟혀서 생기는 차이라,
어느 쪽이 맞는 값이 아니라 **둘 다 맞는 값**입니다. 판마다 몇 줄씩 더
흔들립니다.

「언제 잰 것」 칸이 있는 까닭: 리눅스는 개발 PC 에서 못 잽니다. 그러니 여기
적힌 리눅스 값은 **그 판의 CI 가 마지막으로 말한 값**이고, 지금 소스의 값이
아닙니다. 두 수를 한 줄에 나란히 적어 놓고 잰 때가 다른 것을 안 적으면,
그게 바로 1.14.0 에서 문턱을 잘못 걸었던 그 실수입니다.

CI 는 **리눅스에서 88% 아래**로 내려가면 멈춥니다 — 낮은 쪽에서 내림하고 한
점 더 뺀 값입니다. 딱 붙여 놓으면 관문이 아니라 제비뽑기가 됩니다(처음에 90
으로 걸었다가 0.04점 차이로 빨개진 적이 있습니다). 올리려면 리눅스에서 먼저
재고 올립니다. 파일별이 아니라 **전체**에 겁니다 — 아래 셋을 억지로 올리면
검사가 거짓말을 시작합니다.

일부러 못 채운 곳이 셋 있습니다.

| 파일 | 지금 | 왜 못 채우나 |
|---|---|---|
| `tools/excel.js` | 71% | 암호 걸린 엑셀을 여는 길. 이 PC 에 엑셀이 깔려 있고 암호 걸린 진짜 파일이 있어야 합니다. 흉내 내면 '되는 것처럼 보이는' 검사가 됩니다 |
| `repl.js` | 73% | 사람이 키를 누르는 길 — Shift+Tab, Ctrl+C, 암호 입력, 붙여넣기. 가짜 터미널(pty)이 있어야 밟히는데 그건 의존성입니다. 대신 화면에 나가는 **글**은 값으로 재 봅니다(`ui`·`tui` 검사) |
| `plugins/manage.js` | 79% | GitHub 에서 내려받는 길. **검사가 바깥으로 안 나간다**는 약속이 먼저입니다. 폴더에서 설치하는 길은 검사합니다 |

### 검사가 정말 지키는가

```bash
npm run mutate                            지켜야 할 줄을 일부러 어긋내 본다
node tools/mutate.mjs --json              기계가 읽을 형태로
```

커버리지는 「밟았나」 만 말해 줍니다. 밟고 지나갔는데 아무것도 안 재는 검사도
100% 로 나옵니다. 그래서 반대로도 잽니다 — 지켜야 할 줄을 **일부러 어긋내
놓고**, 짝지은 검사가 빨개지는지 봅니다. 안 빨개지면 그 검사는 그 자리를
안 지키고 있는 것입니다.

무엇을 어긋내는지와 「그러면 무슨 일이 나는지」 는 `test/mutants.json` 에
있습니다. 새로 넣을 때는 **검사 하나만** 짝지으세요 — 여럿을 걸면 무엇이
잡았는지 모르고, 느린 검사를 걸면 이 판이 통째로 느려집니다.

소스는 제자리에서 안 고칩니다. 임시 폴더로 한 벌 베껴 놓고 거기서만
어긋냅니다 — 도중에 죽어도 작업 트리에 어긋난 소스가 안 남습니다.
어긋내기 **전에** 맨 검사가 초록인지 먼저 봅니다. 원래 빨간 검사는 무엇을
해도 빨개서 전부 잡은 것처럼 보이기 때문입니다.

CI 는 `npm test` 뒤에 한 판 돕니다. 하나라도 새면 그 자리에서 실패합니다.

### 폴더 구조

```
bin/deel.js              진입점
src/
  repl.js                대화 화면 — 사람이 마주하는 자리
  oneshot.js             한 번 돌리고 끝내기 (-p)
  commands.js            / 명령 49종
  cmdnames.js            그 이름표만 — 배치 모드도 봐야 해서 따로
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
  backend/retry.js       잠깐 막혔을 때(429 · 5xx · 끊김) 기다렸다 다시 부르는 규칙
  backend/proxy.js       HTTPS_PROXY · NO_PROXY 읽기 — 어느 길로 나갈지 고르기
  backend/learn.js       서버가 한 말에서 한계 배우기 (컨텍스트 · 답 길이)
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

### 열쇠는 저장할 것이 없습니다

이 저장소는 **믿는 발행자**(trusted publishing · OIDC)로 올립니다. npmjs.com 의
이 패키지 Settings 에 저장소 이름과 **워크플로 파일 이름**(`publish.yml`)이
등록되어 있고, 워크플로는 그 자리에서 받은 짧은 신분증으로 올립니다.

**`NPM_TOKEN` 시크릿을 넣지 마세요.** 토큰이 있으면 `setup-node` 가 그것을
`.npmrc` 에 적고, 그러면 npm 은 OIDC 로 안 갑니다. 이 패키지는 토큰 발행을
막아 두었으므로(`mfa=publish`) 그 길은 **403 으로 끝납니다.** 예전 이 문서는
Automation 토큰을 만들라고 했었는데, 그 길은 막혔습니다.

`publish.yml` 의 **이름을 바꾸면 npmjs.com 쪽 등록도 같이 바꿔야 합니다.**
안 바꾸면 「등록 안 된 워크플로」 가 되어 그 자리에서 튕깁니다.

### 줄바꿈은 LF 만

배포에 담기는 파일은 **전부 LF** 여야 합니다. `.gitattributes` 가 `eol=lf` 로
못박고 있고, `npm run check` 가 판마다 확인합니다.

윈도우에서 작업한다면 한 가지를 알아 두세요. **git 은 이미 체크아웃해 둔
파일을 `.gitattributes` 가 생겼다고 소급해서 고쳐 주지 않습니다.** 규칙이
생기기 전에 `core.autocrlf=true` 로 받아 둔 파일은 디스크에 CRLF 로 남아
있고, `npm pack` 은 git 이 아니라 **작업 트리**를 담습니다. 그래서
`git status` 는 깨끗한데 올라간 물건만 어긋날 수 있습니다.

실제로 1.13.0 이 그렇게 나갔습니다 — 148개 중 47개가 CRLF 였고, CI 가 만든
tarball 과 shasum 이 달랐습니다. 셰뱅이 걸렸다면 리눅스·맥에서 실행 자체가
안 됐을 겁니다(`env: 'node\r': No such file or directory`).

`npm run check` 가 CRLF 를 잡으면 이렇게 되돌립니다:

```bash
# 어긋난 파일 목록
git ls-files --eol | grep 'w/crlf'

# 지우고 다시 받는다 (작업 트리가 깨끗할 때만)
git ls-files --eol | grep 'w/crlf' | sed 's/.*\t//' | while read -r f; do rm -f "$f"; done
git checkout -- .
```

`git add --renormalize .` 로는 안 고쳐집니다. 인덱스는 이미 LF 로 올바르고,
어긋난 것은 작업 트리뿐이기 때문입니다.

제대로 됐는지는 shasum 으로 확인합니다 — 같은 커밋이면 어느 OS 에서 만들든
`npm pack` 의 shasum 이 같아야 합니다.

---

[← README 로](../../README.ko.md)
