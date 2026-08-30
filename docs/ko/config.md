[← README 로](../../README.md)

# 설정

붙는 서버 · 환경변수 · 실행 옵션 · 프로젝트 규칙

---

## 설정

<sub>붙는 서버 · 환경변수 · 실행 옵션 · 프로젝트 규칙</sub>

### 붙는 서버

주소만 넣으면 규격을 알아서 찾습니다.

| | 주소 예 |
|---|---|
| 사내 AI 게이트웨이 (OpenAI 호환) | `https://ai-gw.example.corp/v1` |
| Azure OpenAI | `https://<이름>.openai.azure.com/openai/deployments/<배포>` |
| Ollama | `http://localhost:11434` |
| LM Studio | `http://localhost:1234/v1` |
| llama.cpp · vLLM · LiteLLM | `http://호스트:포트/v1` |

인증도 자동으로 맞춥니다 — `Authorization: Bearer` → `x-api-key` → `api-key` → 인증 없음.
Azure 주소는 순서가 다릅니다: `api-key` → `Bearer` → 인증 없음 (`x-api-key` 는 안 씁니다).
**해 본 방식 중 하나가 되면 그것으로 정합니다** — 첫 401 에서 멈추지 않습니다. Azure 앞단을
Entra ID 로 감싼 곳은 `api-key` 에 401 을 주고 `Bearer` 를 받기 때문입니다.

### Azure OpenAI

Azure 는 OpenAI 호환이라면서 **주소 모양만 다릅니다.** 모델 이름이 주소 안에 있고,
`?api-version=` 이 없으면 400 이고, 모델 목록은 `/models` 가 아니라 `/openai/deployments`
에 있고, 열쇠는 `api-key` 헤더입니다. 포털에서 복사한 주소를 그대로 넣으세요 —
`/openai/deployments/<배포이름>` 까지 붙어 있으면 그 배포로 바로 붙고, 회사 주소만
넣으면 배포 목록을 받아 고르게 합니다. 뒤에 `/chat/completions?api-version=…` 이
딸려 와도 알아서 떼어 냅니다.

`api-version` 은 주소에 적혀 있으면 그 값을 쓰고, 없으면 GA 판(`2024-10-21`)을 씁니다.
사내에서 판을 고정해 뒀다면 설정 파일의 `"apiVersion"` 이나 환경변수
`DEEL_AZURE_API_VERSION` 으로 바꾸세요.

APIM 같은 앞단에 한 겹 아래로 매달아 둔 주소(`https://apim.사내/azure-openai/openai/...`)도
그 앞길을 그대로 지킵니다.

배포 목록은 권한이 따로라 막아 둔 곳이 많습니다. 목록을 못 받아도 **연결 실패로 치지
않습니다** — 주소에 배포 이름이 있으면 그것으로 그냥 붙고, 못 본 것은 못 봤다고 적습니다.
다만 서버에서 **아무 대답도 못 받으면** 그건 연결 실패로 칩니다. 포트가 닫혔거나 VPN 이
안 올라온 것을 "목록만 못 봤다" 로 넘기면, 초록색 화면을 믿고 엉뚱한 데를 뒤지게 됩니다.
Azure 는 컨텍스트 길이를 API 로 알려주지 않으므로 그 값은 `/ctx` 나 설정에서 직접 넣으세요.

### 늘 허락할 것과 절대 안 할 것

승인 모드는 세 가지뿐이라 그 사이가 없습니다. `npm test` 는 하루에 스무 번 돌리는데
스무 번 묻고, `curl` 은 한 번도 돌리고 싶지 않은데 묻기만 합니다. **묻는 것은 막는 것이
아닙니다** — 스무 번 `y` 를 친 손은 스물한 번째도 칩니다.

`.deel/config.json` 에 적어 두세요.

```json
{
  "permissions": {
    "allow": ["Bash(npm test*)", "Read", "Grep"],
    "deny":  ["Bash(curl*)", "Bash(*rm -rf*)", "WebFetch"]
  }
}
```

`도구(무늬)` 꼴입니다. 무늬를 안 쓰면 그 도구 전부입니다. 무늬에서 뜻을 갖는 것은
별표 하나뿐이고 나머지는 글자 그대로입니다 — 정규식을 받으면 적는 사람이 실수하기 쉽고,
**실수한 금지 규칙은 조용히 안 걸립니다.**

순서는 **금지 > 허락 > 모드** 입니다. 둘 다 걸리면 금지입니다. 금지된 것은 물어보지도
않습니다. 막히면 어느 규칙 때문인지, 그 규칙이 **어디에 적혀 있는지**까지 말해 줍니다 —
그 말이 없으면 제 설정을 고쳐야 할지 관리자에게 말해야 할지 알 수 없습니다.
지금 걸려 있는 규칙은 `/mode` 에 다 나옵니다.

### 관리 정책 (IT 가 정하는 것)

설정 파일은 **쓰는 사람의 것**입니다. 지우고 고칠 수 있으니 "이번 배포 동안은 이
게이트웨이만" 을 적어 둘 자리가 아닙니다. 그건 사용자가 못 고치는 곳에 둡니다.

| | |
|---|---|
| 윈도우 | `%ProgramData%\deel\policy.json` |
| 맥·리눅스 | `/etc/deel/policy.json` |
| 시험용 | `DEEL_POLICY` 환경변수로 자리를 직접 지정 |

```json
{
  "baseUrl": "https://ai-gw.example.corp/v1",
  "offline": false,
  "permissions": { "deny": ["Bash(curl*)", "WebFetch"] }
}
```

정책은 설정을 **이깁니다.** 다만 **넓히지는 못합니다** — 오프라인을 켤 수는 있어도 끌 수
없고, 금지를 더할 수는 있어도 사용자가 적어 둔 금지를 지우지 못합니다. 정책 파일 한 줄로
안전장치가 헐거워지는 길은 안 냅니다. 정책 파일이 망가져 있으면 없는 것으로 치고 돌되,
못 읽었다고 `/mode` 에 적습니다 — 조용히 넘어가면 관리자는 걸린 줄 알고 사용자는 안
걸린 채로 씁니다.

### 환경변수

| 변수 | 쓰임 |
|---|---|
| `DEEL_API_KEY` | 키를 파일에 안 남기고 싶을 때 (파일보다 우선) |
| `DEEL_KEY_<프로필ID>` | 프로필별 키 |
| `NODE_EXTRA_CA_CERTS` | 사내 인증서를 쓰는 게이트웨이 |
| `HTTPS_PROXY` · `HTTP_PROXY` | 프록시를 거쳐야 할 때 — `http://user:pw@프록시:포트`. 소문자 이름도 봅니다. CONNECT 터널을 직접 열므로 Node 판과 상관없이 먹습니다 |
| `NO_PROXY` | 프록시를 안 거칠 곳 — `.corp.com, 10.1.2.3, intra:8443, *`. 이 컴퓨터(localhost · 127.*)는 언제나 직접 갑니다. CIDR(`10.0.0.0/8`) 꼴은 못 읽습니다 — 주소는 하나씩, 아니면 도메인 뒷부분으로 적으세요 |
| `DEEL_SHELL` | 윈도우에서 `Bash` 도구가 명령을 돌릴 셸 — `auto`(기본: Git Bash 가 있으면 bash, 없으면 cmd) · `bash` · `cmd` · `powershell`. 설정 파일의 `"shell"` 로도 됩니다. 고른 셸은 `/status` 와 모델에게 주는 `Shell:` 줄에 나옵니다 |
| `DEEL_KEYSTORE=off` | 열쇠를 이 PC 잠금장치(윈도우 DPAPI · 맥 키체인)에 안 맡기고 파일에 그대로 둡니다. 파워셸이 정책으로 막힌 곳에서 쓰세요 — 어디에 어떻게 두고 있는지는 `/status` 의 `열쇠 보관` 줄에 그대로 나옵니다 |
| `DEEL_DEBUG=1` | 자세한 오류 |
| `NO_COLOR` | 색 끄기 |
| `DEEL_NO_MOTION=1` | 일하는 중 그림 끄기 (한 칸짜리 돌림표로) |
| `DEEL_MOTION` | 그 그림 바꾸기 — `기사`(knight) · `동물`(animal). 이 한 번만 다르게 볼 때 씁니다. 늘 그렇게 두려면 `/motion` 이 낫습니다. [보기](interface.md#그림을-바꾸고-싶다면) |
| `DEEL_OFFICE=1` | 입력 상자 위에 사무실 12줄. 지금 무슨 일이 도는지를 방으로 (`/motion 사무실` 과 같음). [보기](interface.md#사무실--지금-무슨-일이-도는지를-방-하나로) |

프록시는 설정 파일로도 정합니다 — `"proxy": "http://user:pw@프록시:포트"` 는 환경변수보다 우선하고, `"proxy": "none"` 이면 환경변수가 있어도 안 거칩니다. 거치는 중이면 첫 화면과 `/status` 에 `프록시 …` 가 뜹니다. 지원하는 것은 `http://` 프록시(인증은 Basic)뿐이고, NTLM · Negotiate 만 받는 프록시는 못 씁니다.

### 실행 옵션

```bash
deel --root <폴더>       작업 범위. 기본은 지금 폴더
deel --mode <모드>       auto(기본) / confirm / strict
deel --work <모드>       auto(기본·종합) / code / plan / architect / debug / ask / orchestrator
deel --level <수준>      쉬움 / 개발자
deel --ctx <길이>        컨텍스트 길이 직접 지정 (655360 · 640k · 128k)
deel --max-tokens <길이> 한 번에 받을 답 길이 상한 (32k) — /out 과 같은 값
deel --think <강도>      off / low / medium(기본) / high / max
deel --effort <배분>     even / save(기본) / deep
deel --offline           이 컴퓨터 밖으로 아무것도 안 보냄
deel --continue          가장 최근 대화 이어하기
deel --resume <id>       골라서 이어하기
deel --no-tui            입력 상자를 끄고 줄 화면으로 (아래 참고)
```

### 프로젝트 규칙

작업 폴더에 `DEEL.md` · `CLAUDE.md` · `AGENTS.md` 중 하나가 있으면 읽어서 규칙으로 씁니다.
`/init` 으로 틀을 만들 수 있습니다.

---

[← README 로](../../README.md)
