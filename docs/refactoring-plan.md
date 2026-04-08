# Full Product V2 With Legacy 0.4.4 Freeze

이 문서는 단순 전략 메모가 아니라, 새 세션에서도 바로 이어서 작업할 수 있게 만드는 `living handoff` 문서다.  
lane 경계, migration 계약, 검증 상태, 추천 다음 작업 순서가 바뀌면 같은 커밋 안에서 이 문서도 함께 갱신한다.

리팩토링 기준일: 2026-04-08  
마지막 상태 갱신: 2026-04-08  
마지막 검증 성공: `npm.cmd run verify` at `ce38835`  
현재 공개 사용자 기준선: `0.4.4`  
현재 구현 상태: `legacy/v2 lane` 골격, v2 local storage 분리, v2 prompt-library cloud lane, lane-aware release build foundation

---

## 이 문서에서 가장 먼저 이해해야 할 것

- 이 문서에는 현재 유효한 설계와 진행 상태만 남긴다.
- 새 세션은 과거 대화나 초기 초안이 아니라, 이 문서의 `현재 상태 스냅샷`, `Phase 상태`, `세션 인계 로그`를 기준으로 시작한다.
- 현재 채택된 설계는 `legacy 0.4.4 동결 + full product v2 별도 lane`이다.

---

## 현재 채택된 설계 요약

- legacy lane은 기존 사용자 보호를 위한 운영면으로 유지한다.
- v2 lane은 새 확장, 새 hosted 경로, 새 backend, 새 mutable namespace를 가진다.
- migration은 `copy only`, `idempotent`, `resume 가능` 원칙을 따른다.
- 현재 진행 기준선은 `ce38835`까지 반영된 foundation 상태다.

---

## 진행 현황 요약

- 설계 상태: `legacy/v2 2-lane 전략 확정`
- 구현 상태: `foundation 완료, meeting lane 분리 미완료`
- 현재 next step: `meeting v2 hosted origin/site + meeting v2 backend/data namespace 분리`
- release 가능 상태: `아직 아님`

---

## 이 문서를 반드시 갱신해야 하는 경우

- lane별 origin, endpoint, collection namespace, release 경로가 바뀔 때
- migration marker shape 또는 migration 순서가 바뀔 때
- `완료됨/미완료` 상태가 바뀔 때
- 다음 세션 추천 시작점이 달라질 때
- 검증 결과가 새로 생기거나 기존 전제가 깨졌을 때

---

## 현재 상태 스냅샷

### 이미 끝난 것

- `0.4.x = legacy`, `1.x+ = v2`라는 lane 판단 규칙을 코드에 넣었다.
- v2 lane은 local storage를 `v2.` prefix로 분리하고, 첫 실행 시 legacy local state를 `copy only`로 가져온다.
- prompt-library는 v2 전용 Functions export와 v2 전용 Firestore namespace를 갖는다.
- release build는 버전 major를 보고 `hosting/extension/*`와 `hosting/extension-v2/*`를 나눠 산출한다.
- 현재 버전이 아직 `0.4.4`라서, 이 기반 작업만으로는 기존 공개 사용자 lane이 바뀌지 않는다.

### 아직 안 끝난 것

- meeting v2 hosted site/origin의 실제 분리
- meeting v2 Functions export와 mutable Firestore namespace 분리
- meeting domain lazy migration 설계와 구현
- legacy lane과 v2 lane 각각의 Chrome 실사용 smoke 기록
- v2 실제 cutover 체크리스트와 rollout 절차 확정

### 지금 이 문서를 읽는 새 세션이 바로 알아야 하는 사실

- 현재 기준 커밋 `ce38835`는 `v2 foundation`까지만 넣은 상태다.
- 아직 `manifest.json`과 `package.json`을 `1.0.0+`로 올리면 안 된다.
- prompt-library만 v2 cloud lane 골격이 있고, meeting은 아직 legacy lane 의존이 남아 있다.
- 따라서 다음 큰 작업의 primary feature는 기본적으로 `meeting`이다.

---

## 다음 세션 시작 체크리스트

1. `git status --short`로 작업 트리가 깨끗한지 먼저 확인한다.
2. 이 문서와 `docs/feature-routing.md`, 그리고 이번 세션의 primary feature `AGENTS.md`만 먼저 읽는다.
3. 현재 작업이 `meeting`, `prompt-library`, `release` 중 어디를 주로 건드리는지 먼저 고른다.
4. `content + hosting + functions` 3축을 동시에 건드리게 되면 커밋 경계 또는 세션 분리를 먼저 제안한다.
5. lane 경계나 migration 계약을 건드릴 예정이면, 코드 수정 전에 이 문서의 어떤 섹션을 같이 바꿀지 먼저 정한다.
6. 작업이 끝나면 `npm.cmd run verify`를 돌리고, 검증 결과와 다음 시작점을 이 문서에 남긴다.

---

## Legacy lane 절대 금지사항

- `0.4.4` 사용자를 새 hosted origin 또는 새 backend로 조용히 우회시키지 않는다.
- legacy endpoint 이름, hosted path, Firestore namespace를 sunset 전까지 rename/delete/retype 하지 않는다.
- migration 중 legacy 원본을 수정하거나 삭제하지 않는다.
- fallback이나 cached data를 migration 성공처럼 보이게 만들지 않는다.
- meeting v2 backend가 준비되기 전에는 버전만 `1.0.0+`로 올려 release cutover 하지 않는다.
- mutable 운영 데이터에 대해 legacy/v2 공용 write를 허용하지 않는다.

---

## 핵심 전략

- `0.4.4`는 더 이상 in-place refactor 대상으로 보지 않고 `legacy lane`으로 동결한다.
- 새 구조는 기존 경로를 덮어쓰지 않고 `v2 lane`을 별도로 만든다.
- 새 사용자는 새 lane으로 보낸다. 기존 사용자는 새 버전으로 올리기 전까지 기존 lane을 계속 쓴다.
- migration은 `move`가 아니라 `copy + verify + mark complete`를 기본으로 한다.

---

## Lane 정의

### Legacy lane

- 확장 버전: `0.4.x`
- local storage key: 기존 key 그대로 사용
- hosted meeting origin/path: 현재 `browser-extension-main` 기준 경로 유지
- Functions endpoint: 현재 export 이름 유지
- mutable data namespace: 현재 `integration_inova_*`, `prompt_libraries`, `prompt_library_orders`, `prompt_library_chunks`
- release lane: 현재 `hosting/extension/*`

### V2 lane

- 확장 버전: `1.0.0+`
- local storage key: `v2.` prefix 사용
- hosted meeting/release origin: `browser-extension-v2` 계열 origin을 기본값으로 둔다
- Functions endpoint: 필요 시 `*V2` export 이름 사용
- mutable data namespace: legacy와 분리
- release lane: `hosting/extension-v2/*`

---

## 반드시 유지할 공개 계약

- legacy 확장이 호출하는 기존 meeting hosted 경로
- legacy 확장이 호출하는 기존 Functions export 이름
- legacy가 이미 읽고 쓰는 Firestore namespace
- legacy release metadata와 다운로드 경로

위 계약은 `legacy sunset` 전까지 rename/delete/retype 하지 않는다.

---

## 이미 구현한 기반

### 1. Lane-aware runtime config

- `shared/product-lane.js`가 active lane을 결정한다.
- 기본 규칙은 `major >= 1 -> v2`, 그 외는 `legacy`다.
- `shared/firebase-config.js`는 lane별 functions/hosting/prompt config를 만든다.
- background와 content는 이 config를 통해 release/hosted/prompt bridge URL을 해석한다.

### 2. Lane-aware local storage + lazy local migration

- `shared/storage.js`는 lane별 실제 storage key를 사용한다.
- v2 lane 첫 실행 시 legacy local state를 `v2.*` key로 복사한다.
- migration marker는 `productLaneMigration` 상태로 남긴다.
- marker 필드:
  - `startedAt`
  - `completedAt`
  - `sourceLane`
  - `targetLane`
  - `sourceRevision`
  - `attemptCount`
  - `lastError`

### 3. V2 prompt-library cloud lane

- v2 prompt-library endpoint를 별도 export로 분리한다.
- v2 collection:
  - `integration_inova_accounts_v2`
  - `prompt_libraries_v2`
  - `prompt_library_orders_v2`
  - `prompt_library_chunks_v2`
  - `product_lane_migrations_v2`
- v2 첫 read/write 시 legacy prompt-library를 v2 namespace로 `copy only` migration 한다.
- Firestore rules는 `prompt-panel-v2` scope와 `integration_inova_accounts_v2` read를 허용한다.
- 공개 store feed/detail은 당분간 shared read-only data로 유지한다.

### 4. Lane-aware release build foundation

- `scripts/build-release-package.js`는 버전 major를 보고 release 산출 lane을 결정한다.
- `0.x`는 `hosting/extension/*`
- `1.x+`는 `hosting/extension-v2/*`
- v2 release metadata는 legacy lane과 섞지 않는다.

---

## 추천 다음 작업 순서

### 추천 순서 A: meeting lane 분리부터 시작

1. meeting v2 hosted origin/site를 어떤 식으로 분리할지 문서에 먼저 고정한다.
2. meeting runtime config가 lane별 origin을 실제로 바라보게 만든다.
3. meeting Functions export와 Firestore namespace를 v2용으로 분리한다.
4. meeting lazy migration marker shape를 prompt-library와 같은 원칙으로 고정한다.
5. legacy lane과 v2 lane Chrome smoke를 각각 수행하고 결과를 이 문서에 기록한다.

### 추천 순서 B: cutover 준비 문서 보강

- release cutover 전제조건 표 작성
- legacy sunset 측정 방식 정의
- rollback 시 legacy/v2 각각 무엇을 되돌리는지 표로 정리

현재 기본 추천은 `순서 A`다. 이유는 prompt-library만 먼저 분리된 상태라서, 제품 lane 전체를 실제로 여는 데 가장 큰 공백이 meeting에 남아 있기 때문이다.

---

## Phase 상태

### Phase 0. Legacy freeze 문서화

- 상태: `완료`
- 비고: legacy/v2 2-lane 전략과 legacy 금지사항을 문서에 고정했다.

### Phase 1. V2 routing skeleton 확장

- 상태: `부분 완료`
- 완료:
  - lane-aware runtime config
  - lane-aware release build
- 미완료:
  - meeting v2 hosted site/origin의 실제 분리
  - meeting runtime의 실제 운영 origin 연결

### Phase 2. V2 backend/data namespace 확장

- 상태: `부분 완료`
- 완료:
  - prompt-library v2 endpoint/namespace
- 미완료:
  - meeting Functions export 분리
  - meeting mutable namespace 분리

### Phase 3. Lazy migration 확대

- 상태: `부분 완료`
- 완료:
  - local storage migration
  - prompt-library cloud migration
- 미완료:
  - meeting summary/job/artifact/session migration
  - 사용자 단위 migration 운영 기록 정리

### Phase 4. V2 내부 리팩토링

- 상태: `미시작`
- 우선순위:
  1. meeting functions
  2. hosted meeting app
  3. content shell
  4. shared utility

### Phase 5. Legacy sunset

- 상태: `미시작`
- 기본 무트래픽 관찰 기간: `30일`
- sunset 조건:
  - legacy hosted/functions traffic 0
  - migration 오류율 안정
  - rollback 필요 없음

---

## 데이터 원칙

- mutable 운영 데이터는 legacy/v2 공용 write 금지
- shared 허용 범위는 read-only 또는 구조적으로 안정적인 공개 데이터만
- migration은 원본 legacy를 보존한다
- migration 실패 시 v2는 retry 가능 상태 또는 explicit degraded/blocked 상태를 보여 준다

---

## 테스트 기준

### 공통

- `npm.cmd run verify`
- lane별 smoke 분리 실행
- 실제 Chrome에서 legacy lane과 v2 lane을 따로 본다

### Legacy 회귀

- `0.4.4` 확장 + legacy hosting/functions 정상 동작
- legacy release panel이 legacy 최신 버전만 표시
- legacy flow에 v2 migration 코드가 섞이지 않음

### V2 신규

- 새 확장이 v2 local storage key를 사용
- prompt-library가 v2 account/library namespace를 사용
- v2 release build가 `hosting/extension-v2/*`에 산출됨
- v2 release/runtime가 legacy release URL을 보지 않음
- meeting이 준비되면 v2 hosted origin/functions/data namespace를 전부 legacy와 분리해 검증함

### Lazy migration

- 첫 실행 copy 성공
- 실패 후 재실행 성공
- 중복 실행 시 변질 없음
- migration 전후 legacy 원본 불변
- migration 완료 전에는 v2가 legacy mutable 데이터를 직접 write하지 않음

---

## 운영 메모

- v2 lane을 실제로 켜기 전에는 `manifest.json`/`package.json` 버전을 `1.0.0+`로 올리지 않는다.
- v2 hosted meeting origin/site와 meeting V2 backend가 준비되기 전까지는 release cutover를 하지 않는다.
- 새 lane이 열리기 전에도 legacy lane은 계속 운영면으로 유지한다. 새 구조를 legacy 경로에 직접 덮어쓰지 않는다.
- 이 문서만 읽고도 다음 세션이 시작될 수 있어야 한다. 새로 구현한 것과 아직 안 한 것을 모호하게 남기지 않는다.

---

## 세션 인계 로그

### 2026-04-08

- 기준 커밋: `ce38835`
- 완료:
  - lane-aware runtime config
  - lane-aware local storage migration
  - prompt-library v2 cloud lane foundation
  - lane-aware release build foundation
- 검증:
  - `npm.cmd run verify` green
- 다음 시작점:
  - meeting v2 hosted origin/site 분리 설계
  - meeting v2 Functions/data namespace 골격 추가
