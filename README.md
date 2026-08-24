# deel-local-cli

로컬 모델·사내 게이트웨이 전용 코딩 에이전트. **외부 패키지를 하나도 쓰지 않습니다.**

> English guide: [README.en.md](README.en.md)

**3단계(편집 신뢰성)·5단계(스킬)까지 되어 있습니다.** 실제로 파일을 읽고 고치며, 그 PC 에 있는 스킬·명령을 찾아 씁니다.

---

## 왜 의존성이 0개인가

사내 반입 심사에서 "미승인 소프트웨어"로 걸리지 않기 위해서입니다.
`package.json`의 `dependencies`가 비어 있고, Node에 원래 들어 있는 기능만 씁니다.

```
확인 방법:  npm ls          →  의존성 없음
            cat package.json →  "dependencies": {}
```

필요한 것은 **Node 20 이상**뿐입니다. `npm install`을 하지 않습니다.

---

## 대화 시작하기

작업할 폴더에서:

```
deel        # 또는 설치 없이:  node <이폴더>/bin/deel.js
```

그 폴더가 **작업 범위**가 됩니다. 밖의 파일은 읽지도 쓰지도 못합니다.

```
  deel  sec-llm-01  ·  C:\work\myproject
  /help 로 명령 목록.  Ctrl+C 로 끝냅니다.

› 로그 형식 통일해줘

  ⏺ Grep(console.log)
    └ 1개 파일 · 1건

  ⏺ Read(src/runner.js)
    └ 5줄

  ⏺ Edit(src/runner.js)
    └ 1군데

  로그 호출을 logger 형식으로 통일했습니다.

  ─ 4.2초 · 도구 3회 · 180토큰
```

### 슬래시 명령

Claude Code / Codex 와 같은 이름을 씁니다.

| 명령 | 하는 일 |
|---|---|
| `/help` | 명령 목록 |
| `/context` | 컨텍스트 사용량 — 무엇이 자리를 먹는지 |
| `/compact` | 오래된 대화 줄이기 |
| `/clear` | 대화 비우기 |
| `/model` | 연결·모델 바꾸기 (대화는 이어짐) |
| `/think off\|low\|medium\|high\|max` | 추론 강도 |
| `/mode auto\|confirm\|strict` | 실행 모드 |
| `/undo [턴수]` | 되돌리기 |
| `/tools` | 도구 목록 |
| `/cost` | 이번 세션 사용량 |
| `/status` | 연결 상태 |
| `/init` | `DEEL.md` 규칙 파일 만들기 |
| `/exit` | 끝내기 |

### 도구 6종

이름과 인자를 Claude Code 와 같게 맞췄습니다. 그 관례로 쓰인 스킬·명령이 그대로 먹습니다.

| 도구 | 하는 일 |
|---|---|
| `Read` | 파일 읽기 (줄 번호 붙음) |
| `Write` | 파일 쓰기·덮어쓰기 |
| `Edit` | 정확한 문자열 하나 바꾸기 |
| `Glob` | 이름 패턴으로 파일 찾기 |
| `Grep` | 내용 정규식 검색 |
| `Bash` | 명령 실행 |
| `Skill` | 스킬 본문 펼쳐 읽기 (스킬이 있을 때만 모델에게 보임) |

#### 편집이 조금 틀려도 찾아냅니다

모델은 공백·들여쓰기·줄바꿈을 자주 틀립니다. 단계적으로 완화해 찾되, **모호하면 무조건 거부**합니다 —
엉뚱한 곳을 조용히 고치는 것이 못 찾는 것보다 훨씬 나쁘기 때문입니다.

```
정확히 일치  →  줄 끝 공백·CRLF 무시  →  들여쓰기 무시  →  모든 공백 무시
```

`npm run bench` 로 잰 결과: **정확히 일치만 쓰면 20%, 지금은 100%. 엉뚱한 곳을 고친 경우 0건.**

못 찾으면 파일에서 가장 비슷한 줄을 짚어 줍니다:

```
찾지 못했습니다.
  파일의 2번 줄이 가장 비슷합니다:
    console.log("실행 시작: " + id);
  이 줄을 그대로 옮겨 담아 다시 시도하세요.
```

---

## 스킬·명령 — 그 PC 에 있는 것을 씁니다

deel 는 스킬을 품고 다니지 않습니다. 켜질 때 아래를 훑어 **있는 것을 그대로** 씁니다.

```
프로젝트  ./.deel/skills   ./.claude/skills   ./.deel/commands   ./.claude/commands
사용자    ~/.deel/skills   ~/.claude/skills   ~/.claude/commands
플러그인  ~/.claude/plugins/**   (.claude-plugin/plugin.json 이 있는 폴더)
```

Claude Code 와 같은 형식(`SKILL.md` + YAML 앞머리, `commands/*.md`, `$ARGUMENTS`)을 읽습니다.

### 3단계로 나눠 올립니다

전부 올리면 컨텍스트가 죽습니다. 그래서:

| 단계 | 무엇을 | 비용 |
|---|---|---|
| 1 | 이름 + 설명 한 줄만 프롬프트에 | 40개 기준 약 1,800토큰 |
| 2 | 모델이 `Skill` 도구로 고른 것의 본문만 | 필요할 때 1개씩 |
| 3 | 본문이 가리키는 파일은 `Read` 로 | 그때 또 |

`/context` 에서 스킬 목록이 얼마나 먹는지 바로 보입니다.

```
/skills               지금 올라간 것 보기
/skills <검색어>       찾아보기
/skills on <검색어>    걸리는 것만 올리기
/skills all | off     전부 올리기 | 내리기
```

### 슬래시 명령도 그대로

찾은 명령은 `/<플러그인>:<이름>` 으로 부릅니다. `$ARGUMENTS` 가 치환됩니다.

```
› /ecc:code-review src/app.js
  ⌘ ecc:code-review plugin
```

### 안 넣은 것

| | 이유 |
|---|---|
| hooks | 실행 스크립트라 사내 반입 심사에 걸리고, 자율 실행에 사고 경로를 늘립니다 |
| 서브에이전트 | 모델 호출이 배로 늘어 게이트웨이 할당량을 먹습니다 |
| MCP | 별도 프로토콜이라 그 자체로 하나의 프로젝트입니다 |

### 안전망

승인 프롬프트 대신 **되돌릴 수 있게** 만들었습니다. 기본 모드는 `auto` — 묻지 않고 알아서 합니다.

| 장치 | 내용 |
|---|---|
| **되돌리기** | 파일을 고치기 전 항상 스냅샷. `/undo` 로 턴 단위 복구 |
| **작업 범위** | 시작한 폴더 밖은 모델이 시켜도 거부 |
| **위험 명령 차단** | 되돌릴 수 없는 것만 (디스크 포맷, 재귀 삭제, `--force` 푸시 등). 평범한 명령은 통과 |
| **재실행 금지** | 변경성 명령은 실패해도 다시 실행하지 않음 — 두 번 돌면 사고 |
| **감사 로그** | `.deel/audit.jsonl` 에 전부 기록 |

`/mode confirm` 은 되돌릴 수 없는 명령만, `/mode strict` 는 파일 변경·명령을 전부 물어봅니다.

---

## 사내망에서 진단 돌리기

압축을 풀고 그 폴더에서:

```
node bin/deel.js diagnose --url <게이트웨이주소> --key <키> --model <모델> --out report.txt
```

예시:

```
node bin/deel.js diagnose --url https://ai-gw.example.corp/v1 --key sk-xxxx --model sec-llm-01 --out report.txt
```

`report.txt` 파일 하나만 가져오시면 됩니다. 색 없는 평문이라 그대로 붙여넣을 수 있습니다.

### 키를 파일에 안 남기고 싶으면

```
set DEEL_API_KEY=sk-xxxx
node bin/deel.js diagnose --url https://ai-gw.example.corp/v1 --model sec-llm-01 --out report.txt
```

환경변수가 설정 파일보다 우선합니다.

---

## 대화형으로 설정하기

```
node bin/deel.js setup
```

이름 → 주소 → 키를 물어보고, 붙어보고, 모델 목록을 띄워 고르게 한 뒤,
진단까지 돌리고 저장합니다. 저장 위치는 `~/.deel/config.json`입니다.

이후에는:

```
node bin/deel.js              연결 상태 보기
node bin/deel.js diagnose     저장된 연결로 진단 다시 돌리기
```

---

## 무엇을 검사하는가

| 검사 | 왜 보는가 |
|---|---|
| 기본 대화 | 주소·키·모델 이름이 맞는지 |
| 시스템 메시지 | 규칙(DEEL.md)과 스킬이 먹는지 |
| 스트리밍 | 화면이 한 글자씩 흐를 수 있는지 |
| **도구 호출** | **파일을 읽고 고칠 수 있는지 — 가장 중요** |
| **도구 결과 되돌리기** | **여러 턴이 이어지는지 — 에이전트 루프의 전제** |
| 구조적 출력 | 편집 형식을 스키마로 강제할 수 있는지 |
| 추론 강도 조절 | `/think` 가 모델 층에서 먹는지 |
| 컨텍스트 길이 | 파일을 몇 개까지 한 번에 읽힐 수 있는지 |

마지막에 **판정**이 나옵니다.

| 판정 | 뜻 |
|---|---|
| 준비됨 | 에이전트 루프를 그대로 올릴 수 있음 |
| 제한적 | 돌아가지만 편집 신뢰성 보강이 필요 |
| 막힘 | 도구 호출이 안 됨 — 게이트웨이 설정을 확인해야 함 |
| 연결실패 | 주소·키·인증서·프록시 문제 |

---

## 붙는 서버

주소만 넣으면 규격을 알아서 찾습니다.

| | 주소 예 |
|---|---|
| 사내 AI 게이트웨이 (OpenAI 호환) | `https://ai-gw.example.corp/v1` |
| Ollama | `http://localhost:11434` |
| LM Studio | `http://localhost:1234/v1` |
| vLLM · LiteLLM | `http://호스트:포트/v1` |

인증 방식도 자동으로 맞춥니다 — `Authorization: Bearer`, `x-api-key`, `api-key`(Azure 계열), 인증 없음 순으로 시도합니다.

---

## 연결이 안 될 때

| 증상 | 확인할 것 |
|---|---|
| `주소를 찾을 수 없습니다` | 주소 오타, DNS, 사내망 접속 여부 |
| `연결이 거부되었습니다` | 서버가 꺼져 있거나 포트가 다름 |
| `인증서 문제` | `set NODE_EXTRA_CA_CERTS=C:\경로\사내CA.pem` |
| 프록시를 거쳐야 함 | `set HTTPS_PROXY=http://프록시:포트` |
| 401 / 403 | 키가 틀렸거나 인증 헤더 형식이 다름 (진단이 4가지를 자동 시도합니다) |

자세한 오류를 보려면 `set DEEL_DEBUG=1`.

---

## 폴더 구조

```
bin/deel.js            진입점
src/
  ui/                  색·한글 폭·입력·스피너
  config.js            연결 프로필 저장/읽기
  backend/http.js      HTTP 한 겹 + 인증 방식 4종
  backend/detect.js    규격·인증 자동 판별
  backend/adapter.js   OpenAI/Ollama 차이 흡수 + 스트리밍 파서
  backend/probe.js     진단 검사 8종
  tools/index.js       도구 6종
  tools/fsutil.js      glob·파일 훑기 (직접 구현)
  safety/guard.js      작업 범위 + 위험 명령 차단
  safety/undo.js       스냅샷·되돌리기
  safety/audit.js      감사 로그
  agent/session.js     대화 상태 + 컨텍스트 셈
  agent/loop.js        에이전트 루프
  commands.js          슬래시 명령
  repl.js              대화 화면
  report.js            진단 표 + 판정
  setup.js             마법사
test/                  검증 (배포 zip 에서 뺀다)
```

## 검증

```
npm test      도구 20건 + 엔진 16건
npm run demo  화면이 어떻게 보이는지 실제로 돌려 보기
```

엔진 검증은 **가짜 게이트웨이**를 띄워서 합니다. 실제 모델 없이 OpenAI 호환 규격 그대로
루프·스트리밍·도구 실행·되돌리기를 결정적으로 확인합니다.

---

## 다음 단계

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 연결 설정 + 진단 | 됨 |
| 2 | 엔진 — 루프 · 도구 6종 · 되돌리기 · 감사로그 | 됨 |
| 4 | 화면 — 스트리밍 · 도구 배지 · 슬래시 명령 · `/context` | 됨 (2단계에서 같이) |
| 7 | 추론 조절 — `/think`, `/mode`, 도구 호출 상한 | 반쯤 (모델 층·루프 층까지) |
| 3 | 편집 신뢰성 — 단계별 완화 매칭 · 실패 안내 · 성공률 측정 | 됨 (20%→100%) |
| 5 | 스킬·명령 발견 + 3단계 적재 | 됨 |
| **6** | **플러그인 — `/plugin install` · `/plugin pack`** | **다음** |
| 7 | 추론 조절 — 작업 층 (단계별 다른 모델) | 남음 |
| 8 | 반입 패키징 + 외부통신 0건 검증 | 남음 |
