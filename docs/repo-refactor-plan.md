# 저장소 전체 리팩터링 운영 계획

이 문서는 현재 진행 중인 저장소 리팩터링의 단일 기준 문서다. 임시 handoff 메모와 달리, 앞으로의 작업 우선순위와 진행률 계산은 이 문서를 기준으로 맞춘다.

## 목적과 운영 원칙

- 범위는 `저장소 전체 리팩터링`으로 잡고, 현재 active track은 `meeting`으로 유지한다.
- 공식 진행률은 active track이 아니라 `repo-wide roadmap` 기준으로만 계산한다.
- 한 턴에 `반드시 1개 단위`만 처리할 필요는 없다.
- 다만 같은 primary feature, 같은 검증 경계, 같은 의도를 공유하는 `1~3개의 안전한 하위 단위`만 한 턴에 묶는다.
- 여러 하위 단위를 묶더라도 안전성 기준은 완화하지 않는다.
- `docs/feature-first-refactor-handoff.md`는 역사 메모로 유지하고, 이 문서를 대체하지 않는다.

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

## weighted roadmap

| ID | milestone | weight | current state | 완료 조건 |
| --- | --- | ---: | ---: | --- |
| M1 | feature-first boundary / docs baseline | 15 | 100 | feature-first 문서, 라우팅 기준, AGENTS 경계가 기준선으로 정착 |
| M2 | meeting render-contract / surface alignment | 25 | 75 | panel/hosted meeting 공통 render contract 정리와 수동 UI 확인 종료 |
| M3 | hosted fallback / storage / queue degraded hardening | 20 | 100 | hosted session/storage/queue degraded surfacing 정리와 수동 failure 확인 종료 |
| M4 | prompt feature boundary cleanup | 20 | 0 | prompt 계열 shell/feature 경계 정리와 관련 문서 갱신 종료 |
| M5 | release + shared/platform fallback alignment | 10 | 50 | release와 shared/platform fallback 기준을 silent fallback 없이 맞춤 |
| M6 | manual browser validation + closeout docs | 10 | 0 | 실제 Chrome 검증과 마감 문서 정리 종료 |

### 현재 기준선

- 현재 공식 진행률: `59%`
- 계산 근거: `M1 100 / M2 75 / M3 100 / M4 0 / M5 50 / M6 0`
- `M3`는 2026-04-03 localhost Chrome queue sandbox에서 `queue-load-indexeddb-read`, `queue-persist-indexeddb-write`, `queue-cleanup-indexeddb-delete` 통과로 완료 처리했다.
- 현재 active track: `meeting`

## 한 턴에 1~3개 안전 단위를 묶을 수 있는 조건

### 묶어도 되는 경우

- 같은 primary feature 안에 있다
- 같은 파일 또는 강하게 연결된 `2~3개` 파일 안에서 끝난다
- 검증이 한 번의 `npm run verify`와 국소 syntax check로 닫힌다
- 문서/코드 경계가 더 선명해지고, 중간 커밋이 오히려 인공적으로 쪼개지는 경우다

### 나누어야 하는 경우

- 두 번째 primary feature로 번진다
- `content + functions + hosting` 3축 동시 수정이 필요하다
- 실제 Chrome 수동 검증 전후로 경계를 나누는 편이 안전하다
- 같은 turn 안에서 `진단 추가`와 `UI 의미 변경`이 동시에 일어나 리스크가 커진다

### 커밋 원칙

- 한 턴에 묶인 하위 단위들이 같은 의도를 공유하면 `1 commit`
- 의도가 달라지면 같은 턴 안에서도 `2 commits`까지 허용
- 커밋 메시지는 동작 변화보다 경계 정리 의도를 드러내는 이름을 우선한다

## 턴 종료 보고 형식

매 턴 종료 시 아래 5개만 남긴다.

- 변경 파일
- 왜 이 단위를 먼저 했는지
- 아직 안 건드린 위험 지점
- 다음 턴에 바로 이어갈 1개 작업
- 진행률

`진행률` 형식은 아래로 고정한다.

```text
진행률: 59% (repo-wide roadmap 기준, M1 100 / M2 75 / M3 100 / M4 0 / M5 50 / M6 0)
```

- milestone state가 바뀐 턴에는 같은 커밋 안에서 이 문서의 표도 함께 갱신한다.
- milestone state가 바뀌지 않은 턴에는 문서를 수정하지 않고, 종료 보고의 `진행률`만 유지한다.

## 사용 메모

- 새 세션이나 새 작업자가 들어오면 이 문서와 `docs/feature-routing.md`를 먼저 본다.
- 현재 active track이 `meeting`이라도, 진행률은 전체 로드맵 기준으로만 읽는다.
- 실제 Chrome 수동 검증이 남아 있는 milestone은 `75` 이상에서 멈춘 상태로 본다. 현재 이 기준으로 남아 있는 큰 축은 `M2`, `M6`다.
