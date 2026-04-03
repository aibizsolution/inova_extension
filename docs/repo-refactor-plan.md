# 저장소 전체 리팩터링 운영 계획

이 문서는 현재 진행 중인 저장소 리팩터링의 단일 기준 문서다. 고정 불변 체크리스트가 아니라, 실제 리팩터링 흐름과 병목을 반영해 함께 정제하는 운영 문서로 다룬다. 진행률 계산식과 milestone state는 이 문서를 기준으로 유지하되, 작업을 불필요하게 잘게 쪼개거나 과도하게 보수적으로 만드는 운영 문구는 실제 흐름에 맞게 계속 보정한다.

## 문서의 역할

- 범위는 `저장소 전체 리팩터링`으로 유지한다.
- 현재 active track은 `meeting`이다.
- 공식 진행률은 active track 체감이 아니라 `repo-wide roadmap` 기준으로만 계산한다.
- 이 문서는 숫자를 방어하기 위한 문서가 아니라, 실제 리팩터링을 덜 흔들리게 하고 다음 변경을 더 안전하게 만드는 기준 문서다.
- milestone state가 바뀌었을 때뿐 아니라, 현재 운영 문구가 실제 작업을 불필요하게 쪼개거나 흐리게 만들 때도 이 문서를 함께 갱신한다.
- 같은 공식 진행률 안에서 같은 계층만 반복 수정하는 상황은 자동 진전으로 취급하지 않는다. 정체를 감지하고 다음 턴 선택을 바꾸는 것도 이 문서의 역할이다.
- `docs/feature-first-refactor-handoff.md`는 역사 메모로 유지하고, 이 문서를 대체하지 않는다.

## 운영 원칙

- 한 턴의 작업 단위는 숫자보다 `같은 구조 의도`, `같은 검증 경계`, `같은 feature boundary`를 우선 기준으로 정한다.
- 실제로 함께 바꾸는 편이 더 자연스럽고 안전한 인접 변경은 한 턴과 한 커밋으로 묶는다.
- 반대로 같은 파일 안에 있더라도 구조 의도나 실패 의미가 다르면 나눈다.
- `1~3개 안전 단위`는 경험적 가이드일 뿐 절대 규칙이 아니다. 같은 구조 의도와 같은 검증 경계를 공유하면 그보다 넓게 묶을 수 있고, 반대로 한 줄 수정이라도 의미가 다르면 쪼갠다.
- 여러 변경을 묶어도 안전성 기준은 완화하지 않는다. 묶는 이유는 속도를 높이기 위해서가 아니라, 인위적인 분할 때문에 생기는 마찰과 중간 상태를 줄이기 위해서다.
- 같은 의도를 공유하면 한 턴에 한 커밋으로 끝내고, 의도가 갈리면 같은 턴 안에서도 커밋을 분리한다.
- 한 턴을 잡기 전에 “어떤 구조 위험을 줄이는가”, “어떤 evidence를 새로 만들거나 어떤 milestone을 닫는가”를 먼저 설명할 수 있어야 한다. 이 설명이 안 되면 safe unit으로 잡지 않는다.

## active track 운용

- 현재 primary feature는 `meeting`으로 유지한다.
- 다만 `meeting` 경계를 닫기 위해 꼭 필요한 인접 수정은 제한적으로 허용한다.
  - `meeting` feature-owned shared module
  - `meeting`가 직접 의존하는 platform/shell 경계
  - `meeting` 정리 결과를 문서에 반영하는 `README.md`
  - `meeting` 경계를 닫는 데 필요한 최소한의 `prompt`/shared/platform 수정
- 허용 기준은 “같은 milestone을 닫기 위한 필수 인접 수정인가”이지, “손대기 쉬운 김에 같이 정리할까”가 아니다.
- active track을 핑계로 다른 milestone로 무의미하게 퍼지는 수정은 막는다.
- 두 번째 primary feature의 실질적 설계 변경이 필요해지면 커밋 경계를 먼저 세우고, 필요하면 다음 턴이나 다음 세션으로 분리한다.
- `meeting` active track 안의 우선 후보는 `hosting`, `content`, `functions`, `실제 Chrome 검증`이다. 한 계층만 반복해서 파는 대신, 현재 milestone을 실제로 닫는 데 필요한 계층을 우선 고른다.
- 같은 계층을 연속으로 만졌는데 공식 진행률과 milestone state가 그대로라면, 다음 턴은 원칙적으로 다른 계층이나 실제 검증으로 전환한다. 계속 같은 계층을 파야 한다면 닫히지 않은 구체적 위험을 먼저 문서와 종료 보고에 적는다.

## 정체 감지와 전환 규칙

- safe unit은 작기만 한 단위가 아니라, 현재 milestone을 닫거나 concrete risk를 실제로 줄이거나 primary-path/degraded evidence를 새로 만드는 단위여야 한다.
- 같은 공식 진행률이 연속으로 유지되면, 다음 턴 후보를 고를 때 먼저 “이 턴이 milestone state, 실제 검증, backend contract, degraded contract 중 무엇을 움직이는가”를 적어 본다. 답이 모호하면 그 턴은 기본값으로 기각한다.
- 같은 파일이나 같은 계층의 내부 미세 리팩토링이 반복되는데 공식 진행률, 수동 검증 범위, backend 계약 중 아무 것도 전진하지 않으면 정체로 간주한다.
- 정체 상태에서는 아래 우선순위로 전환한다.
  - 현재 milestone을 실제로 올릴 수 있는 수동 검증
  - 같은 active track 안의 backend/functions 계약 정리
  - 같은 active track 안의 다른 표면(panel/content/hosted) 검증 또는 경계 정리
- 이미 `100`인 milestone 안에서 같은 계층을 더 다듬는 작업은 기본값이 아니다. 그 턴이 없으면 남는 명시적 버그, 겹치는 계약, 잘못된 degraded/error 의미가 있을 때만 허용한다.
- `meeting` active track에서는 `hosting`만 계속 파는 것을 기본 경로로 두지 않는다. `functions/features/meeting/*`와 실제 Chrome 검증은 같은 우선순위의 닫기 수단으로 취급한다.

## 실제 리팩토링 판정 기준

### 리팩토링으로 인정하는 경우

- 같은 기능의 상태 전이나 실패 경로가 여러 곳에 흩어져 있던 것을, 실제 변경 지점을 줄이는 한 경계로 다시 묶는 경우
- 한 함수나 한 흐름 안에 섞여 있던 서로 다른 단계들을 분리해, 이후 수정 시 영향 범위를 좁히는 경우
- panel/hosted/shared처럼 인접 표면이 같은 contract를 반복할 때, adapter만 남기고 실질 계약을 공유 경계로 올리는 경우
- silent fallback이나 success-like fallback을 없애고, degraded state 또는 명시적 실패로 드러나게 바꾸는 경우
- 저장, 전송, 생성, 분석, 변환, 동기화처럼 핵심 결과가 중요한 흐름에서 “어디서 실패했고 무엇이 아직 유효한가”를 더 좁고 명확하게 표현하게 만드는 경우
- 다음 변경이 한두 곳만 수정해도 되게 만들어, 회귀 가능성과 수정 비용을 함께 낮추는 경우

### 리팩토링으로 인정하지 않는 경우

- generic `helper`, `util`, `common` 함수만 추가하고 실제 결정 지점이나 상태 전이는 그대로 남겨두는 경우
- 코드를 다른 파일로 옮기기만 하고 책임 경계나 실패 경계는 그대로인 경우
- 사람이 보기 좋은 이름 정리나 겉보기 정렬만 좋아지고, 영향 범위는 줄지 않는 경우
- 복잡한 분기를 새 wrapper로 감싸 숨기기만 하고, 구조 자체는 그대로인 경우
- 기본값, 빈값, 캐시, mock, 추정값을 설명 없이 정상 결과처럼 보이게 하는 경우

## fallback 기준

- silent fallback은 허용하지 않는다.
- 핵심 기능이 기대 결과를 만들지 못했으면 성공처럼 처리하지 않는다.
- 기본값, 빈값, 캐시, mock, 추정값은 설명 없이 정상 결과처럼 반환하지 않는다.
- fallback이 필요하면 반드시 degraded state 또는 명시적 실패로 드러나야 한다.
- 저장, 전송, 생성, 분석, 변환, 동기화처럼 성공 여부가 중요한 작업은 fallback으로 성공을 위장하지 않는다.
- retry가 가능한 오류도 결국 기대 결과를 만들지 못하면 degraded 또는 explicit error로 남긴다.

## 진행률 계산 규칙

### milestone state

- `0`: 시작 전
- `25`: 범위와 진입점만 정리됨
- `50`: 핵심 코드 경계는 반영됐지만 후속 정리 다수 남음
- `75`: 코드/문서/verify는 정리됐고 수동 검증 또는 마지막 edge 정리만 남음
- `100`: 계획된 코드, 문서, 수동 검증까지 종료

### 계산식

- 전체 진행률은 `sum(weight x state / 100)`으로 계산한다.
- milestone state가 바뀔 때만 퍼센트를 바꾼다.
- 같은 단계 안의 작은 커밋이나 같은 맥락의 하위 단위 묶음은 state가 바뀌지 않으면 퍼센트를 올리지 않는다.
- 공식 진행률과 active track 체감 진행도는 구분한다. 공식 수치는 roadmap 상태만 반영하고, 체감 진행도는 작업 설명을 돕는 보조 메모로만 쓴다.

## weighted roadmap

| ID | milestone | weight | current state | 완료 조건 |
| --- | --- | ---: | ---: | --- |
| M1 | feature-first boundary / docs baseline | 15 | 100 | feature-first 문서, 라우팅 기준, AGENTS 경계가 기준선으로 정착 |
| M2 | meeting render-contract / surface alignment | 25 | 75 | panel/hosted meeting 공통 render contract 정리와 수동 UI 확인 종료 |
| M3 | hosted fallback / storage / queue degraded hardening | 20 | 100 | hosted session/storage/queue degraded surfacing 정리와 수동 failure 확인 종료 |
| M4 | prompt feature boundary cleanup | 20 | 0 | prompt 계열 shell/feature 경계 정리와 관련 문서 갱신 종료 |
| M5 | release + shared/platform fallback alignment | 10 | 50 | release와 shared/platform fallback 기준을 silent fallback 없이 맞춤 |
| M6 | manual browser validation + closeout docs | 10 | 0 | 실제 Chrome 검증과 마감 문서 정리 종료 |

## 현재 기준선

- 현재 공식 진행률: `59%`
- 계산 근거: `M1 100 / M2 75 / M3 100 / M4 0 / M5 50 / M6 0`
- `M3`는 2026-04-03 localhost Chrome queue sandbox에서 `queue-load-indexeddb-read`, `queue-persist-indexeddb-write`, `queue-cleanup-indexeddb-delete` 통과로 완료 처리했다.
- 현재 active track: `meeting`

## 턴 구성과 검증 기준

### 함께 처리해도 되는 경우

- 같은 구조 의도를 공유한다
- 같은 feature boundary 안에서 닫힌다
- 같은 검증 경계에서 `npm run verify`와 국소 syntax check로 함께 확인할 수 있다
- 따로 나누면 중간 상태나 임시 계약이 늘어 오히려 회귀 위험이 커진다
- 이 묶음이 milestone state, 실제 검증 범위, backend 계약, degraded/error contract 중 적어도 하나를 앞으로 민다

### 나누는 편이 더 안전한 경우

- 다른 milestone의 실질 설계 변경이 섞인다
- `content + functions + hosting` 3축 동시 수정처럼 영향 범위가 넓어진다
- 같은 턴 안에서 `진단 추가`와 `UI 의미 변경`이 동시에 일어나 이해 비용이 커진다
- 실제 Chrome 수동 검증 전후로 기준을 명확히 끊는 편이 안전하다
- 같은 계층의 미세 리팩토링을 더 이어도 공식 진행률, 수동 검증 범위, backend 계약 중 아무 것도 움직이지 않는다

### 커밋 원칙

- 같은 구조 의도를 공유하면 `1 commit`
- 문서 개편과 코드 리팩토링처럼 의도가 다르면 같은 턴 안에서도 커밋을 분리한다
- 커밋 메시지는 “무엇이 예뻐졌는가”보다 “어떤 경계와 실패 의미를 바꿨는가”를 드러내는 이름을 쓴다
- 현재 턴 경계 안의 기능 수정이 끝났고 `npm run verify` 등 저장소 기준 검증이 녹색이며 남은 known issue가 없으면, 다음 요청을 기다리지 말고 바로 커밋한다
- 커밋을 미루는 경우는 미검증, 같은 턴 안의 추가 구조 의도, 같은 파일 foreign overlap, blocked evidence 부족처럼 이유를 분명히 설명할 수 있을 때만 허용한다

## 턴 종료 보고 형식

매 턴 종료 시 아래 항목을 짧게 남긴다.

- 변경 파일
- 이번에 바꾼 핵심
- 왜 이 단위를 먼저 했는지
- 왜 이 변경이 실제 리팩토링인지
- 아직 안 건드린 위험 지점
- 다음 턴에 바로 이어갈 1개 작업
- 진행률
- 진행률이 그대로라면 왜 그대로인지와, 다음 턴이 어떤 다른 계층 또는 검증 단계로 넘어가는지

`진행률` 형식은 아래로 유지한다.

```text
진행률: 59% (repo-wide roadmap 기준, M1 100 / M2 75 / M3 100 / M4 0 / M5 50 / M6 0)
```

- milestone state가 바뀐 턴에는 같은 커밋 안에서 이 문서의 표도 함께 갱신한다.
- milestone state가 바뀌지 않았더라도, 운영 기준이 실제 흐름을 막고 있다는 근거가 생기면 이 문서를 함께 고친다.
- 종료 보고는 “얼마나 예쁘게 정리했는가”가 아니라 “어떤 구조 위험을 줄였는가”가 드러나야 한다.

## 사용 메모

- 새 세션이나 새 작업자가 들어오면 이 문서와 `docs/feature-routing.md`를 먼저 본다.
- 현재 active track이 `meeting`이어도, 공식 진행률은 전체 로드맵 기준으로만 읽는다.
- 실제 Chrome 수동 검증이 남아 있는 milestone은 `75` 이상에서 멈춘 상태로 본다. 현재 이 기준으로 남아 있는 큰 축은 `M2`, `M6`다.
- active track 체감 진행도는 운영 감각을 돕는 보조 메모로만 쓰고, roadmap state를 대신하지 않는다.
