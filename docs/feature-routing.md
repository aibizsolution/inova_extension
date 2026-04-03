# Feature Routing

이 문서는 이 저장소에서 새 요청을 받을 때 어떤 feature부터 읽고, 언제 범위를 넓혀도 되는지 정하는 가장 얇은 라우터다.

## 기본 규칙

- 먼저 primary feature를 하나 고른다.
- cue가 두 feature 이상에 걸리면 저장소 전체 탐색 대신 짧게 `이 기능이 맞나요?`를 확인한다.
- 읽기 순서는 `feature-local -> feature-owned shared -> platform/shell -> 인접 feature`다.
- `popup`, `background/service-worker.js`, `content/main.js`, `content/panel.js`, `functions/index.js`, `manifest.json`, `shared/*`는 platform/shell이다.
- 두 번째 primary feature를 읽어야 하거나 `content + functions + hosting` 3축을 함께 수정해야 하면 먼저 커밋 또는 다음 세션 분리를 제안한다.

## Feature Map

### `conversation`

| 항목 | 내용 |
| --- | --- |
| 기능 목적 | 현재 대화 화면의 질문 수집, 탐색, 이동 |
| 요청 cue | 질문 모아보기, 대화 안에서 찾기, 북마크, route sync, 질문 이동 |
| 먼저 볼 파일 | `content/dom.js`, `content/bookmark-view.js`, `content/route-sync.js` |
| 관련 프론트 경로 | `content/main.js`, `content/panel.js` |
| 관련 functions 경로 | 없음 |
| feature-owned shared | `shared/session.js`, `shared/constants.js` |
| 관련 데이터 경계 | DOM 수집 결과, `sid`, UI 상태 |
| 보통 건드리지 말 범위 | `functions/*`, `hosting/meeting/*`, prompt/release 관련 파일 |
| 최소 검증 | i-Nova 대화 탭에서 질문이 수집되고 항목 클릭으로 원문 위치 이동 |
| 언제 다시 물을지 | 질문 수집인지 프롬프트 주입인지, 대화 탭인지 패널 shell인지 구분이 모호할 때 |
| 언제 범위를 확장할지 | 질문 UI 자체가 아니라 패널 shell 동작이나 storage 상태와 연결될 때만 platform/shell로 확장 |

### `prompt-library`

| 항목 | 내용 |
| --- | --- |
| 기능 목적 | 내 요청 보관함 CRUD, 가져오기/내보내기, 클라우드 백업 동기화 |
| 요청 cue | 자주 쓰는 요청, 내 요청, import/export, prompt library, cloud sync |
| 먼저 볼 파일 | `content/prompt-manager.js`, `content/prompt-view.js`, `shared/prompt-library.js`, `content/cloud-sync-manager.js` |
| 관련 프론트 경로 | `content/main.js`, `content/prompt-hub-view.js` |
| 관련 functions 경로 | `functions/features/prompt-library/register.js` |
| feature-owned shared | `shared/prompt-library.js`, `shared/cloud-sync.js`, `shared/provider-identity.js` |
| 관련 데이터 경계 | `prompt_libraries`, `prompt_library_orders`, `prompt_library_chunks`, `integration_inova_accounts.promptLibraryMeta` |
| 보통 건드리지 말 범위 | meeting, prompt-store, prompt-review, release |
| 최소 검증 | 프롬프트 탭의 `내 요청`, import/export, 백업 동기화 흐름 확인 |
| 언제 다시 물을지 | 스토어 공개 항목 문제인지, 평가 버튼 문제인지, 로컬 보관함 문제인지 모호할 때 |
| 언제 범위를 확장할지 | 로컬 보관함만으로 해결되지 않고 panel auth나 platform cache가 얽힐 때만 platform/shell로 확장 |

### `prompt-store`

| 항목 | 내용 |
| --- | --- |
| 기능 목적 | 스토어 목록, 상세 보기, 좋아요, 가져오기, 등록/삭제 |
| 요청 cue | 스토어, 공개 프롬프트, 좋아요, 조회수, 가져오기, publish/unpublish |
| 먼저 볼 파일 | `content/store-manager.js`, `content/store-view.js`, `content/prompt-realtime-manager.js`, `shared/prompt-store.js` |
| 관련 프론트 경로 | `content/prompt-hub-view.js`, `content/main.js` |
| 관련 functions 경로 | `functions/features/prompt-store/store-service.js` |
| feature-owned shared | `shared/prompt-store.js`, `shared/provider-identity.js` |
| 관련 데이터 경계 | `prompt_store_entries`, `prompt_store_entry_details`, `prompt_store_feed_pages`, `prompt_store_meta`, 하위 likes/imports/views |
| 보통 건드리지 말 범위 | meeting, prompt-library, release |
| 최소 검증 | 스토어 탭 목록, 상세 보기, 좋아요/가져오기/등록/삭제 |
| 언제 다시 물을지 | 내 요청 보관함 문제인지 스토어 공개 흐름 문제인지 섞여 있을 때 |
| 언제 범위를 확장할지 | realtime bridge, panel auth cache, background read 경로가 원인일 때만 platform/shell로 확장 |

### `prompt-review`

| 항목 | 내용 |
| --- | --- |
| 기능 목적 | 현재 입력 프롬프트 평가, 보완안 생성, 평가 UI |
| 요청 cue | 프롬프트 평가, 검토 버튼, refined prompt, review score |
| 먼저 볼 파일 | `content/prompt-review-manager.js`, `content/prompt-review-view.js`, `content/composer-review-float.js` |
| 관련 프론트 경로 | `content/main.js`, `content/composer.js` |
| 관련 functions 경로 | `functions/features/prompt-review/prompt-review-service.js` |
| feature-owned shared | `shared/provider-identity.js` |
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
| 먼저 볼 파일 | `content/meeting-manager.js`, `content/meeting-view.js`, `hosting/meeting/index.js`, `popup/index.js` |
| 관련 프론트 경로 | `background/service-worker.js`, `meeting/index.js`, `hosting/meeting/*` |
| 관련 functions 경로 | `functions/features/meeting/meeting-launch-service.js`, `functions/features/meeting/meeting-service.js` |
| feature-owned shared | `shared/meeting-state.js`, `shared/meeting-bridge.js`, `shared/meeting-debug.js`, `shared/firebase-config.js` |
| 관련 데이터 경계 | `integration_inova_meetings`, `integration_inova_meeting_jobs`, `integration_inova_meeting_job_parts`, `integration_inova_meeting_job_finalizers`, `integration_inova_meeting_artifacts`, launch/session 컬렉션 |
| 보통 건드리지 말 범위 | prompt-library, prompt-store, prompt-review, release |
| 최소 검증 | 팝업 target 설정, 회의 탭 목록, hosted meeting 진입, 최소 1개 결과 조회 |
| 언제 다시 물을지 | 패널 회의 허브 문제인지 hosted 작업실 문제인지, 회의 auth인지 전사 backend인지 모호할 때 |
| 언제 범위를 확장할지 | feature-local과 owned-shared만으로 해결되지 않고 launch/session 발급 또는 panel cache가 얽힐 때만 platform/shell로 확장 |

### `release`

| 항목 | 내용 |
| --- | --- |
| 기능 목적 | 릴리스 패널, 최신 버전 확인, 정적 JSON/ZIP 링크 |
| 요청 cue | 릴리스, 최신 버전, 업데이트 ZIP, 롤백, release notes |
| 먼저 볼 파일 | `content/release-manager.js`, `content/release-view.js`, `shared/release-info.js` |
| 관련 프론트 경로 | `background/service-worker.js`, `releases/release-notes.json` |
| 관련 functions 경로 | 없음 |
| feature-owned shared | `shared/release-info.js` |
| 관련 데이터 경계 | `releases/release-notes.json`, `hosting/extension/releases/latest.json`, `hosting/extension/releases/history.json`, 다운로드 ZIP |
| 보통 건드리지 말 범위 | meeting, prompts 전 영역 |
| 최소 검증 | 릴리스 탭에서 현재 버전, 최신 버전, ZIP 링크 표시 |
| 언제 다시 물을지 | 릴리스 UI 문제인지 실제 배포 메타 생성 문제인지 구분이 모호할 때 |
| 언제 범위를 확장할지 | 정적 메타만으로 해결되지 않고 background fetch나 배포 스크립트가 얽힐 때만 platform/shell로 확장 |
