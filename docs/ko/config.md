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
| Ollama | `http://localhost:11434` |
| LM Studio | `http://localhost:1234/v1` |
| llama.cpp · vLLM · LiteLLM | `http://호스트:포트/v1` |

인증도 자동으로 맞춥니다 — `Authorization: Bearer` → `x-api-key` → `api-key`(Azure 계열) → 인증 없음.

### 환경변수

| 변수 | 쓰임 |
|---|---|
| `DEEL_API_KEY` | 키를 파일에 안 남기고 싶을 때 (파일보다 우선) |
| `DEEL_KEY_<프로필ID>` | 프로필별 키 |
| `NODE_EXTRA_CA_CERTS` | 사내 인증서를 쓰는 게이트웨이 |
| `HTTPS_PROXY` · `HTTP_PROXY` | 프록시를 거쳐야 할 때 — `http://user:pw@프록시:포트`. 소문자 이름도 봅니다. CONNECT 터널을 직접 열므로 Node 판과 상관없이 먹습니다 |
| `NO_PROXY` | 프록시를 안 거칠 곳 — `.corp.com, 10.1.2.3, intra:8443, *`. 이 컴퓨터(localhost · 127.*)는 언제나 직접 갑니다 |
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
