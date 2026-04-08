# Full Product V2 With Legacy 0.4.4 Freeze

리팩토링 기준일: 2026-04-08  
현재 공개 사용자 기준선: `0.4.4`  
현재 구현 상태: `legacy/v2 lane` 골격, v2 local storage 분리, v2 prompt-library cloud lane, lane-aware release build foundation

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

## 남은 단계

### Phase 1. Legacy freeze 문서화

- meeting/release/prompt-library 문서에 legacy freeze와 lane 분리 규칙을 고정한다.
- legacy는 기능 개선이 아니라 보안/운영 hotfix만 허용한다.

### Phase 2. V2 routing skeleton 확장

- v2 hosted meeting site를 실제 별도 Hosting origin/site에 배치한다.
- background가 v2 workspace URL을 실제 운영 origin으로 열게 한다.
- release panel이 v2 metadata만 읽는지 실제 브라우저에서 확인한다.

### Phase 3. V2 backend/data namespace 확장

- meeting lane의 Functions export와 mutable Firestore namespace를 분리한다.
- prompt-library처럼 lane migration marker와 lazy copy 규칙을 동일하게 적용한다.
- `content + hosting + functions`를 한 번에 바꾸지 않고 lane별 facade 뒤에서 진행한다.

### Phase 4. Lazy migration 확대

- user-owned cloud data를 도메인별로 나눠 migration 한다.
- 대상:
  - prompt-library
  - meeting summary/job/artifact/session
  - 필요 시 user preference meta
- migration은 항상 사용자 단위, idempotent, resume 가능해야 한다.

### Phase 5. V2 내부 리팩토링

- 실제 구조 분해는 v2 lane 안에서만 한다.
- 우선순위:
  1. meeting functions
  2. hosted meeting app
  3. content shell
  4. shared utility

### Phase 6. Legacy sunset

- 기본 무트래픽 관찰 기간: `30일`
- sunset 조건:
  - legacy hosted/functions traffic 0
  - migration 오류율 안정
  - rollback 필요 없음
- 위 조건 충족 후 별도 cleanup PR에서 legacy endpoint/hosting/release lane/data namespace를 제거한다.

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

### Lazy migration

- 첫 실행 copy 성공
- 실패 후 재실행 성공
- 중복 실행 시 변질 없음
- migration 전후 legacy 원본 불변

---

## 운영 메모

- v2 lane을 실제로 켜기 전에는 `manifest.json`/`package.json` 버전을 `1.0.0+`로 올리지 않는다.
- v2 hosted meeting origin/site와 meeting V2 backend가 준비되기 전까지는 release cutover를 하지 않는다.
- 새 lane이 열리기 전에도 legacy lane은 계속 운영면으로 유지한다. 새 구조를 legacy 경로에 직접 덮어쓰지 않는다.
