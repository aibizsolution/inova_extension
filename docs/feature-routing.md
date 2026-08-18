# Feature Routing

이 문서는 이 저장소에서 새 요청을 받을 때 어떤 feature부터 읽고, 언제 범위를 넓혀도 되는지 정하는 가장 얇은 라우터다.

## 기본 규칙

- 먼저 primary feature를 하나 고른다.
- 단순 실행/운영 요청(`에뮬레이터 켜기`, `dev server`, `lint/test/build/verify`, `로그 확인`)은 primary feature 분류보다 명령 실행이 우선이다. 이 경우 `package.json`, 관련 워크플로 문서, 환경 메모만 보고 바로 실행한다.
- 위 fast path에서는 feature map 전체를 다시 읽지 않는다. 실행 실패나 스크립트 선택 ambiguity가 생겼을 때만 해당 feature로 라우팅한다.
- 사용자가 `로컬 에뮬레이터`만 요청하면 기본 명령은 `npm.cmd run emulator:meeting-local`이다. `hosting only`나 빠른 hosted smoke를 명시했을 때만 `npm.cmd run emulator:hosting`을 고른다.
- `README.md`는 상위 개요만 유지하고, feature-local 세부 규칙과 변경 기록은 각 feature `AGENTS.md`나 전용 docs를 우선한다.
- cue가 두 feature 이상에 걸리면 현재 근거로 가장 좁은 primary feature를 고른다. 선택에 따라 구현이나 결과가 실질적으로 달라지고 저장소 문맥으로 안전하게 판단할 수 없을 때만 사용자에게 확인한다.
- 읽기 순서는 `feature-local -> feature-owned shared -> platform/shell -> 인접 feature`다.
- `1.0.0+` v2 lane에서는 먼저 `hosting/extension-v2/panel/*`에서 해당 탭의 UI/state/action ownership이 이미 hosted로 넘어갔는지 확인한다.
- 브라우저 확장이라서만 가능한 책임이 아니면, 기본 수정 위치는 extension보다 hosted 쪽으로 본다.
- `popup`, `background/service-worker.js`, `content/main.js`, `content/panel.js`, `content/hosted-panel-bridge.js`, `hosting/extension/panel/*`, `functions/index.js`, `manifest.json`, `shared/*`는 platform/shell이다.
- prompt 계열의 active v2 extension shell은 `content/panel-v2-prompt-controller.js`가 맡는다. retired legacy prompt hub 구현은 backup reference로 유지하지 않는다.
- 여러 실험실 feature의 사용량 계측은 `feature-usage` 공통 feature로 본다. 새 action을 추가할 때는 확장 ZIP 배포를 반복하지 않도록 기존 `metrics.feature-usage.commit` capability와 hosted tracker를 재사용한다.
- 두 번째 primary feature까지 실제 구현 범위가 넓어지거나 `content + functions + hosting` 3축을 함께 수정해야 하면 변경을 검증 가능한 커밋 경계로 나눈다. 사용자 선택이 필요한 범위 확장일 때만 다음 세션 분리를 확인한다.
- 이유: 내부 ZIP 배포 환경에서는 세 축이 서로 다른 시점에 섞여 적용될 수 있어 mixed-version 검증 매트릭스와 rollback 범위가 급격히 커진다.

## Feature Map

### `conversation`

| 항목 | 내용 |
| --- | --- |
| 기능 목적 | 현재 대화 화면의 질문/응답 수집, 예상 컨텍스트와 길이 신호 표시, 탐색, 이동 |
| 요청 cue | 질문 모아보기, 대화 안에서 찾기, 북마크, route sync, 질문 이동, 컨텍스트 길이, 대화 길이 |
| 먼저 볼 파일 | `content/dom.js`, `hosting/extension-v2/panel/conversation-dom-parser.js`, `hosting/extension-v2/panel/conversation-controller.js`, `content/route-state-controller.js`, `content/route-watch-controller.js`, `content/panel-v2-composition-controller.js`, `content/panel-v2-shell-bridge.js`, `content/route-sync.js` |
| 관련 프론트 경로 | `content/main.js`, `content/panel.js`, `content/panel-v2-composition-controller.js`, `content/panel-v2-shell-bridge.js`, `hosting/extension/panel/bookmark-view.js`, `hosting/extension-v2/panel/conversation-dom-parser.js`, `hosting/extension-v2/panel/conversation-controller.js`, `hosting/extension-v2/panel/bookmark-view.js` |
| 관련 functions 경로 | 없음 |
| feature-owned shared | `shared/session.js`, `shared/constants.js` |
| 관련 데이터 경계 | sanitized DOM snapshot, Q/A 예상 컨텍스트, 선택 모델 라벨, hosted 모델 컨텍스트 프로필 설정, `sid`, UI 상태 |
| 보통 건드리지 말 범위 | `functions/*` (단 `functions/features/conversation/*` 제외), `hosting/meeting/*`, prompt/release 관련 파일 |
| 최소 검증 | i-Nova 대화 탭에서 질문이 수집되고 예상 컨텍스트/길이 신호가 표시되며 항목 클릭으로 원문 위치 이동 |
| 언제 다시 물을지 | 질문 수집인지 프롬프트 주입인지, 대화 탭인지 패널 shell인지 구분이 모호할 때 |
| 언제 범위를 확장할지 | 질문 UI 자체가 아니라 패널 shell 동작이나 storage 상태와 연결될 때만 platform/shell로 확장 |

### `prompt-library`

| 항목 | 내용 |
| --- | --- |
| 기능 목적 | 내 요청 보관함 CRUD, 가져오기/내보내기, DB 정본(remote-first) 동기화 |
| 요청 cue | 자주 쓰는 요청, 내 요청, import/export, prompt library, cloud sync |
| 먼저 볼 파일 | `hosting/extension-v2/panel/prompt-library-controller.js`, `hosting/extension-v2/panel/prompt-library-firestore-client.js`, `hosting/extension-v2/panel/prompt-view.js`, `content/panel-v2-prompt-controller.js` |
| 관련 프론트 경로 | `content/main.js`, `content/panel-v2-prompt-controller.js`, `hosting/extension-v2/panel/prompt-library-controller.js`, `hosting/extension-v2/panel/prompt-view.js`, `hosting/extension-v2/panel/prompt-tool-view.js` |
| 관련 functions 경로 | `functions/features/prompt-library/register.js` |
| feature-owned shared | `shared/provider-identity-cache.js` (generic provider identity cache only), `shared/storage.js` (generic local storage only), `content/provider-identity-sensor.js` (page localStorage identity sensor) |
| 관련 데이터 경계 | `prompt_libraries`, `prompt_library_orders`, `prompt_library_chunks`, `integration_inova_accounts.promptLibraryMeta` |
| 보통 건드리지 말 범위 | meeting, prompt-store, prompt-review, release |
| 최소 검증 | 프롬프트 탭의 `내 요청` 렌더링, 항목 1건 저장/수정, 입력창 주입 1회 |
| 언제 다시 물을지 | 스토어 공개 항목 문제인지, 평가 버튼 문제인지, 로컬 보관함 문제인지 모호할 때 |
| 언제 범위를 확장할지 | 로컬 보관함만으로 해결되지 않고 panel auth나 platform cache가 얽힐 때만 platform/shell로 확장 |

### `prompt-store`

| 항목 | 내용 |
| --- | --- |
| 기능 목적 | 스토어 목록, 상세 보기, 좋아요, 가져오기, 등록/삭제 |
| 요청 cue | 스토어, 공개 프롬프트, 좋아요, 조회수, 가져오기, publish/unpublish |
| 먼저 볼 파일 | `hosting/extension-v2/panel/prompt-store-controller.js`, `hosting/extension-v2/panel/store-view.js`, `content/panel-v2-prompt-controller.js` |
| 관련 프론트 경로 | `content/main.js`, `content/panel-v2-prompt-controller.js`, `hosting/extension-v2/panel/prompt-store-controller.js`, `hosting/extension-v2/panel/store-view.js`, `hosting/extension-v2/panel/prompt-tool-view.js` |
| 관련 functions 경로 | `functions/features/prompt-store/store-service.js` |
| feature-owned shared | `content/provider-identity-sensor.js` |
| 관련 데이터 경계 | `prompt_store_entries`, `prompt_store_entry_details`, `prompt_store_feed_pages`, `prompt_store_meta`, 하위 likes/imports/views |
| 보통 건드리지 말 범위 | meeting, prompt-library, release |
| 최소 검증 | 스토어 탭 `전체` 목록, 상세 보기 1건, 좋아요 또는 가져오기 1회, 탭 복귀 시 목록 유지 |
| 언제 다시 물을지 | 내 요청 보관함 문제인지 스토어 공개 흐름 문제인지 섞여 있을 때 |
| 언제 범위를 확장할지 | realtime bridge, panel auth cache, background read 경로가 원인일 때만 platform/shell로 확장 |

### `prompt-review`

| 항목 | 내용 |
| --- | --- |
| 기능 목적 | 현재 입력 프롬프트 평가, 보완안 생성, 평가 UI |
| 요청 cue | 프롬프트 평가, 검토 버튼, refined prompt, review score |
| 먼저 볼 파일 | `content/features/prompt-review/prompt-review-manager.js`, `hosting/extension-v2/panel/prompt-review-controller.js`, `hosting/extension-v2/panel/prompt-review-view.js`, `content/features/prompt-review/composer-review-float.js` |
| 관련 프론트 경로 | `content/main.js`, `content/composer.js`, `content/panel-v2-prompt-controller.js`, `hosting/extension-v2/panel/prompt-review-controller.js`, `hosting/extension-v2/panel/prompt-review-view.js`, `hosting/extension-v2/panel/prompt-tool-view.js` |
| 관련 functions 경로 | `functions/features/prompt-review/prompt-review-service.js` |
| feature-owned shared | `content/provider-identity-sensor.js` |
| 관련 데이터 경계 | 원격 저장소 없음, Functions `reviewInovaPrompt` 호출과 rate-limit 기록 |
| 보통 건드리지 말 범위 | meeting, prompt-store, release |
| 최소 검증 | 입력창 우측 상단 평가 버튼 노출, 평가 결과 표시, 보완 프롬프트 반영 |
| 언제 다시 물을지 | 평가 UX 문제인지, 실제 프롬프트 보관함/스토어 문제인지 모호할 때 |
| 언제 범위를 확장할지 | 입력창 주입이나 panel shell 상태와 충돌할 때만 platform/shell로 확장 |

### `meeting`

| 항목 | 내용 |
| --- | --- |
| 기능 목적 | 회의 허브, hosted 작업실, 녹음, 전사, 결과 검토 |
| 요청 cue | 회의 허브, 새 회의하기, 작업실, launch/session auth, 녹음, 전사, chunk |
| 먼저 볼 파일 | `hosting/extension-v2/panel/meeting-hub-controller.js`, `hosting/extension-v2/panel/meeting-firestore-client.js`, `hosting/extension-v2/panel/meeting-participation-firestore-client.js`, `hosting/extension-v2/panel/meeting-usage-firestore-client.js`, `content/panel-v2-composition-controller.js`, `hosting/meeting/index.js`, `hosting/meeting/workspace-*.js`, `popup/index.js` |
| 관련 프론트 경로 | `background/service-worker.js`, `hosting/meeting/*`, `hosting/extension-v2/panel/meeting-hub-controller.js`, `hosting/extension-v2/panel/meeting-firestore-client.js`, `hosting/extension-v2/panel/meeting-participation-firestore-client.js`, `hosting/extension-v2/panel/meeting-usage-firestore-client.js`, `hosting/extension/panel/meeting-view.js`, `popup/index.js` |
| 관련 functions 경로 | `functions/features/meeting/meeting-launch-service.js`, `functions/features/meeting/meeting-service.js` |
| feature-owned shared | `shared/firebase-config.js`, `shared/storage.js` |
| 관련 데이터 경계 | `integration_inova_meetings`, `integration_inova_meeting_participations`, `integration_inova_meeting_jobs`, `integration_inova_meeting_job_parts`, `integration_inova_meeting_job_finalizers`, `integration_inova_meeting_artifacts`, `integration_inova_meeting_usage_events`, `integration_inova_meeting_usage_user_months`, `integration_inova_meeting_usage_user_totals`, `integration_inova_meeting_usage_admin_months`, `integration_inova_meeting_usage_admin_days`, launch/session 컬렉션 |
| 보통 건드리지 말 범위 | prompt-library, prompt-store, prompt-review, release |
| 최소 검증 | 팝업 target 설정, 회의 탭 목록, hosted meeting 진입, 최소 1개 결과 조회 |
| 언제 다시 물을지 | 패널 회의 허브 문제인지 hosted 작업실 문제인지, 회의 auth인지 전사 backend인지 모호할 때 |
| 언제 범위를 확장할지 | feature-local과 owned-shared만으로 해결되지 않고 launch/session 발급 또는 panel cache가 얽힐 때만 platform/shell로 확장 |

### `release`

| 항목 | 내용 |
| --- | --- |
| 기능 목적 | 릴리스 패널, 최신 버전 확인, 정적 JSON/ZIP 링크 |
| 요청 cue | 릴리스, 최신 버전, 업데이트 ZIP, 롤백, release notes |
| 먼저 볼 파일 | `hosting/extension-v2/panel/release-controller.js`, `hosting/extension-v2/panel/release-view.js` |
| 관련 프론트 경로 | `background/service-worker.js`, `hosting/extension-v2/panel/release-controller.js`, `hosting/extension-v2/panel/release-view.js`, `hosting/extension/panel/release-view.js`, `releases/release-notes.json` |
| 관련 functions 경로 | 없음 |
| feature-owned shared | 없음. active v2 lane은 hosted release summary만 유지한다. |
| 관련 데이터 경계 | `releases/release-notes.json`, `hosting/extension/releases/latest.json`, `hosting/extension/releases/history.json`, 다운로드 ZIP |
| 보통 건드리지 말 범위 | meeting, prompts 전 영역 |
| 최소 검증 | 릴리스 탭에서 현재 버전, 최신 버전, ZIP 링크 표시 |
| 언제 다시 물을지 | 릴리스 UI 문제인지 실제 배포 메타 생성 문제인지 구분이 모호할 때 |
| 언제 범위를 확장할지 | 정적 메타만으로 해결되지 않고 background fetch나 배포 스크립트가 얽힐 때만 platform/shell로 확장 |

### `admin`

| 항목 | 내용 |
| --- | --- |
| 기능 목적 | 권한이 확인된 사용자에게만 관리자 콘솔 진입점을 제공하고, 별도 hosted 관리자 페이지에서 운영 기능을 붙이는 기반 |
| 요청 cue | 관리자, admin, 운영자, 권한 확인, 관리자 페이지, 관리자 메뉴 |
| 먼저 볼 파일 | `functions/features/admin/AGENTS.md`, `hosting/extension-v2/panel/admin-entry-controller.js`, `hosting/admin/index.js`, `background/admin-console-capability.js`, `functions/features/admin/admin-service.js` |
| 관련 프론트 경로 | `hosting/extension-v2/panel/index.js`, `hosting/extension-v2/panel/admin-entry-controller.js`, `hosting/extension-v2/panel/extension-capability-client.js`, `hosting/admin/*`, `background/panel-runtime-capability-router.js`, `background/admin-console-capability.js` |
| 관련 functions 경로 | `functions/features/admin/admin-service.js`, `functions/index.js` |
| feature-owned shared | 없음. 클라이언트 role/admin flag는 신뢰하지 않고 서버 allowlist 또는 `ops_admin_users/{providerUserKey}`만 기준으로 본다. |
| 관련 데이터 경계 | `ops_admin_users`, `ops_admin_launches`, `ops_admin_sessions`; `사용자 및 권한` 회원 후보 read는 `integration_inova_accounts_v2`, `integration_inova_accounts`, `integration_inova_feature_usage_user_months` identity snapshot을 합쳐 쓰고, `lastUsedAt`은 읽기 전용 `lastActivityAt`으로만 보여준다. 목록 기본 정렬은 `lastActivityAt` 최신순이며 저장은 `status`와 `organization` 메타데이터만 다룬다. |
| 보통 건드리지 말 범위 | 회의 녹음/전사, prompt-library/store/review의 feature-local 구현, content page adapter |
| 최소 검증 | `npm.cmd run verify:admin-service`, `npm.cmd run verify:admin-entry`, `npm.cmd run verify:runtime-capability-router`, `npm.cmd run verify:hosted-panel`, `npm.cmd run verify:panel-render` |
| 언제 다시 물을지 | 관리자 페이지의 실제 운영 기능 범위가 회의/프롬프트/사용량 중 어디인지 모호할 때 |
| 언제 범위를 확장할지 | 새 관리자 기능이 특정 feature 데이터에 접근해야 할 때만 해당 feature의 read-only summary API부터 별도 endpoint로 확장 |

### `feature-usage`

| 항목 | 내용 |
| --- | --- |
| 기능 목적 | 실험실/후보 기능의 meaningful action 사용량을 비용 최적화된 cumulative snapshot으로 집계 |
| 요청 cue | 사용량 계측, 실험실 통계, 누가 얼마나 썼는지, 인터뷰 대상, feature usage, metrics |
| 먼저 볼 파일 | `hosting/extension-v2/panel/feature-usage-tracker.js`, `functions/features/feature-usage/feature-usage-service.js`, `functions/features/feature-usage/AGENTS.md`, `scripts/check-feature-usage.js` |
| 관련 프론트 경로 | `hosting/extension-v2/panel/index.js`, 각 hosted feature controller의 `featureUsageTracker.record(...)` 호출부 |
| 관련 functions 경로 | `functions/features/feature-usage/feature-usage-service.js`, `functions/index.js` |
| feature-owned shared | 없음 |
| 관련 데이터 경계 | `integration_inova_feature_usage_client_days`, `integration_inova_feature_usage_user_days`, `integration_inova_feature_usage_user_months`, `integration_inova_feature_usage_admin_days`, `integration_inova_feature_usage_admin_months` |
| 보통 건드리지 말 범위 | Firebase Storage, Firestore client rules read/list, raw event ledger |
| 최소 검증 | `npm.cmd run verify:feature-usage-service`, `npm.cmd run verify:feature-usage-tracker`, `npm.cmd run check:feature-usage -- --fixture --days 30`; 실제 Chrome 풀 테스트에서는 meaningful action 1회 후 `npm.cmd run check:feature-usage -- --days 1 --limit 20`로 aggregate 반영 확인 |
| 언제 다시 물을지 | 계측 대상이 meaningful action인지 비용성 처리량 accounting인지 구분이 모호할 때 |
| 언제 범위를 확장할지 | 새 브라우저 권한이나 새 runtime capability가 꼭 필요한 경우에만 platform/shell로 확장 |
