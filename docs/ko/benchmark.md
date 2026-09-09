[← 문서 차례](../../README.ko.md)

# 벤치마크 — Claude CLI 와 deel

같은 프로젝트에 같은 일을 시켜 놓고 잰 기록입니다.

원본: [`pdf/cli_benchmark_anonymized_v4.pdf`](../../pdf/cli_benchmark_anonymized_v4.pdf)

---

## 먼저, 이 자료로 말할 수 없는 것

홍보 자료를 읽을 때 제일 알고 싶은 것이 그것이라 맨 앞에 둡니다.

- **표본이 2회입니다.** 「deel 이 일반적으로 16.8% 싸다」 는 이 자료로 못 합니다.
- **조건이 대칭이 아닙니다.** Claude 쪽에는 외부 절감 패키지(`claude-token-saver`)가
  붙어 있었고 deel 은 자체 기능만 썼습니다. 그래서 $1.33 차이를 **엔진 자체의
  효율 차이라고 단정할 수 없습니다.**
- **전체 회귀 범위는 Claude 가 넓었습니다.** 우리가 진 항목입니다.
- 백분위는 **두 실행 중 더 나은 관측값을 100 으로 둔 상대지수**입니다. 바깥
  모집단에 대한 백분위가 아닙니다.

---

## 조건

|  | Claude CLI | deel |
|---|---|---|
| 모델 | Claude Opus 5 (AWS Bedrock) | Claude Opus 5 (AWS Bedrock) |
| 대상 | 같은 프로젝트 (공동 편집기) | 같은 프로젝트 |
| 시킨 일 | 동시 편집의 데이터 손실 결함 탐지·수정 | 같음 |
| 곁들인 것 | `claude-token-saver` (별도 npm) | 없음 — 자체 기능만 |
| 관측 비용 | **$7.90** | **$6.57** |
| 소요 시간 | **38분 00초** | **36분 59초** (2,219초) |

비용 차 **-$1.33 (16.8%)** · 시간 차 **-61초 (2.7%)**

---

## 두 실행은 서로 다른 결함을 잡았습니다

같은 버그를 두 번 찾은 것이 아니라, 공동작업 동기화의 **다른 실패 경로**를
각각 하나씩 제거했습니다.

**Claude CLI — IME 조합 중 base 오염**
A 가 한글을 조합하는 동안 B 의 원격 변경이 도착합니다. 화면 적용은 보류하는데
**기준값(base)만 먼저 최신화**됩니다. 그러면 다음 delta 가 B 의 변경을 되돌리고,
서버는 그것을 정상 편집으로 오인합니다.

**deel — receive 경로의 await / TOCTOU 경쟁**
원격 변경을 받으려고 `GET /api/state` 를 기다리는 사이에 A 가 새로 입력합니다.
응답이 온 뒤 **재확인이 없어서** 서버 문서가 A 의 입력을 덮어씁니다.
`await` 이전의 안전성 검사가 응답 이후에도 유효하다고 가정한 문제입니다.

deel 쪽 탐지 경로는 「서버 50개 기준선 → 아직 안 재 본 클라이언트 → 호출부
비대칭(`apply` 호출부 중 receive 경로에만 rebase 가 없음) → 재현」 순서로
좁혀 들어갔습니다.

---

## 항목별

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/jysvai/deel-local-cli/main/docs/assets/benchmark-dark.svg">
  <img alt="항목별 상대지수" src="https://raw.githubusercontent.com/jysvai/deel-local-cli/main/docs/assets/benchmark-light.svg" width="900">
</picture>

| 항목 | Claude | deel |
|---|---|---|
| 실제 문제 가치 | 100% | 100% |
| 원인 분석 깊이 | 100% | 100% |
| 조사 체계성 | 95% | **100%** |
| 재현 신뢰성 | 100% | 100% |
| 수정 최소성 | 95% | **100%** |
| 테스트 설계 | 100% | 100% |
| **전체 회귀 범위** | **100%** | 85% |
| 자기 검증 | 100% | 100% |
| 실환경 검증 | 100% | 100% |
| 비용 효율 | 89% | **100%** |
| **종합 상대지수** | **97.9%** | **98.5%** |

차이 2%p 이내 — 품질은 **사실상 동급**으로 읽는 것이 맞습니다.

---

## 우리가 진 항목, 그리고 그래서 고친 것

**전체 회귀 범위 85%.** Claude 는 그 프로젝트의 검사를 `50 + 11 + 18` 까지
돌렸고, deel 은 `신규 6 + collaboration 50 + syntax` 에 그쳤습니다.

원인은 실력이 아니라 **목록**이었습니다. 그 프로젝트의 검사는 `scripts/` 밑의
독립 실행 파일 셋(`qa-collaboration.js` · `qa-presets.js` · `qa-design-studio.js`)
이었는데, deel 의 `Verify` 는 `package.json` 의 `test` 한 칸만 보고 있었습니다.
못 본 검사는 안 돌고, 안 돈 검사는 회귀를 못 잡습니다.

**1.17.7 에서 고쳤습니다** — `Verify` 가 이제 확인 방법을 **전부** 찾아
알려 줍니다(`src/tools/확인법.js`). npm 스크립트의 `test`·`lint`·`typecheck`·
`e2e` 칸, `scripts/`·`test/`·`tools/` 밑의 독립 검사 파일, 그리고 표식이 실재할
때의 `cargo test`·`go test`·`pytest`·`make test` 까지 봅니다.

없는 것은 지어내지 않습니다. `Makefile` 에 `test:` 칸이 진짜로 있을 때만
`make test` 를 담습니다 — 없는 명령을 알려 주면 모델이 그걸 부르고, 실패를
받고, 또 부릅니다.

이 저장소에 대고 돌리면 1개에서 **6개**로 늘어납니다.

---

## 다음에 제대로 재려면

이 자료를 만든 쪽의 권고를 그대로 옮깁니다.

같은 유형 작업을 **5~10회** × **Claude 순정 / Claude+token-saver / deel** 의
3조건으로 반복하고, 비용·시간·발견 결함 심각도·수정 LOC·재현 성공·회귀 범위·
재작업 횟수를 함께 기록하면 도구 자체 효율을 훨씬 분명하게 가를 수 있습니다.
