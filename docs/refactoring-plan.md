# Version And Release Decision Note

이 문서는 구조 진행 일지나 세션 handoff가 아니라, `버전 결정`, `version lane`, `meeting legacy baseline`, `release decision boundary`만 빠르게 확인하기 위한 기준 문서다.  
ordinary feature 구현 변경, 탭별 hosted ownership 진행도, smoke 이슈 목록, git chronology는 이 문서의 대상이 아니다. 그런 내용은 `docs/current-handoff.md`, `docs/runtime-architecture.md`, feature `AGENTS.md`에서 관리한다.

마지막 상태 갱신: 2026-04-14  
현재 공개 사용자 기준선: `0.4.4`

## 현재 결정 요약

- 기본 전략은 `major`다.
- 다음 공개 릴리스 목표는 `1.0.0`이다.
- 현재 구조 작업은 계속 진행 중이지만, 그 진행 현황 자체는 이 문서가 아니라 handoff/architecture 문서에서 추적한다.
- green 선언 권한은 유지보수자에게 있고, 구현자는 판단 근거와 candidate 상태까지만 갱신한다.

## 이 문서에 남길 것

- `minor` / `major` 결정 게이트
- `0.4.4` legacy lane과 `1.0.0` v2 lane 기준
- hosted path, local rehearsal path, mixed-version gate
- meeting legacy endpoint/auth/namespace baseline
- release build와 배포 판단에 직접 영향을 주는 장기 규칙

## 이 문서에 두지 않을 것

- feature migration 진행률
- hosted ownership 세부 상태
- 세션별 smoke 이슈와 디버그 로그
- 커밋 chronology나 작업 일지

## Version Decision Gate

### Minor 유지 조건

아래 항목을 모두 유지할 수 있으면 `0.5.x` 같은 minor로 간다.

- hosted meeting origin/path를 그대로 유지할 수 있다.
- 현재 Functions export 이름을 그대로 유지할 수 있다.
- mutable Firestore namespace를 그대로 유지할 수 있다.
- auth scope, workspace URL, response envelope 의미를 그대로 유지할 수 있다.
- 사용자가 새 ZIP으로 교체해도 추가 migration 없이 동작한다.
- compat shim 없이도 `현재 minor + 이전 minor` 지원이 가능하다.

### Major 승격 조건

아래 항목 중 하나라도 실제로 필요하고 compat shim으로 흡수할 수 없으면 `1.0.0`을 검토한다.

- 별도 hosted origin/site가 필요하다.
- 별도 Functions endpoint family가 필요하다.
- mutable data namespace 분리 또는 copy migration이 필요하다.
- 기존 auth scope, URL, schema 의미를 유지할 수 없다.
- `현재 minor + 이전 minor`를 같은 backend/hosting에서 안전하게 지원하기 어렵다.

### 최종 결정 규칙

- 결정 전 기본값은 `minor 유지`였다.
- `major 가능성`만으로 먼저 버전을 올리지 않는다.
- 실제 구현과 smoke 결과가 `Major 승격 조건`에 해당한다고 기록된 뒤에만 `major`를 선택한다.
- 현재는 유지보수자 판단으로 `major 확정 (1.0.0)` 상태다.

## Version Decision Record

- 현재 가설: `major 가설`
- candidate ready 상태: `in-progress`
- 유지보수자 최종 결정: `major 확정 (다음 공개 릴리스 1.0.0)`
- 현재 근거 요약:
  - legacy hosted origin/path, Functions export 이름, mutable namespace, auth scope baseline은 유지 중이다.
  - 공개 사용자 기준선은 여전히 `0.4.4`지만, 다음 공개 릴리스는 `1.0.0`으로 잡고 local rehearsal도 manifest/package `1.0.0` 기준 v2 lane을 기본 활성화한다.
  - `1.0.0` candidate baseline부터 우측 `실험실` 패널 기본 UI는 hosted `panelAppUrl` iframe을 쓰고, 기본 hosted 경로는 `hosting/extension-v2/panel/index.html`이다. 이 변경은 extension 브리지/host와 hosted panel 자산의 mixed-version capability gate를 전제로 한다.
  - popup `로컬 호스팅` rehearsal target은 meeting만이 아니라 prompt-library sync/read, prompt-review, prompt-store panel auth/write, hidden prompt bridge까지 local Functions/Hosting emulator로 함께 전환해야 한다.
  - local rehearsal 부팅 확인과 기존 사용자의 기존 회의 데이터 read-path 확인은 pass 후보다.
  - hosted-first 구조 경계와 release metadata/release-package coherence 가드는 대부분 닫혔고, current `1.0.0` lane은 `release:build` rehearsal도 통과했다.
  - 다만 최종 candidate ready로 올리려면 실제 Chrome 기준의 주요 회의/프롬프트/릴리스 smoke 기록과 public rollout checklist가 남아 있어야 한다.

## Meeting Legacy Baseline

아래 baseline은 `1.0.0` v2 lane에서도 compat 이유로 계속 유지하는 값들이다.

## Version Lane Policy

- `0.x` legacy lane의 hosted panel 기본 경로는 `https://browser-extension-main.web.app/extension/panel/index.html`이다.
- `1.x+` v2 lane은 같은 규칙으로 `hosting/extension-v2/panel/*`와 `panelAppUrl`을 사용한다.
- 공개 기준선 `0.4.4`는 legacy lane에 남기고, 다음 공개 릴리스 `1.0.0`은 v2 lane을 기본으로 사용한다.
- 현재 `1.x+` extension bundle은 panel을 `content/panel-v2-composition-controller.js`로 직접 부팅한다. `backup/legacy-panel/panel-composition-controller.js`, `backup/legacy-panel/panel-action-controller.js`, `backup/legacy-panel/panel-meeting-controller.js`, `backup/legacy-panel/meeting-manager.js`, `backup/legacy-panel/meeting-view.js`, `backup/legacy-panel/meeting-panel-bridge-controller.js`는 legacy reference/source로만 남아 있고 현재 manifest에는 싣지 않는다.
- 현재 `1.x+` extension bundle은 legacy content render/view도 활성 manifest에 더 이상 싣지 않는다. `backup/legacy-panel/prompt-view.js`, `backup/legacy-panel/store-view.js`, `backup/legacy-panel/prompt-review-view.js`, `backup/legacy-panel/prompt-hub-view.js`, `backup/legacy-panel/release-view.js`는 inactive reference/source로만 남고, active prompt/release render ownership은 hosted v2 panel(`hosting/extension-v2/panel/*`)이 맡는다.
- 현재 `1.x+` extension bundle은 prompt legacy runtime도 활성 manifest에 싣지 않는다. `backup/legacy-panel/features/prompt-library/files.js`, `backup/legacy-panel/features/prompt-library/cloud-sync-manager.js`, `backup/legacy-panel/features/prompt-library/prompt-manager.js`, `backup/legacy-panel/features/prompt-store/prompt-realtime-manager.js`, `backup/legacy-panel/features/prompt-store/store-manager.js`, `backup/legacy-panel/prompt-hub-state.js`, `backup/legacy-panel/prompt-hub-panel.js`, `backup/legacy-panel/prompt-hub-controller.js`, `backup/legacy-panel/prompt-hub-runtime.js`, `backup/legacy-panel/panel-prompt-controller.js`는 legacy reference/source로 남고, active v2 bundle은 `content/panel-v2-prompt-controller.js`로 review handoff와 minimal prompt snapshot만 유지한다.
- 현재 `1.x+` extension bundle은 dormant prompt import/export helper도 활성 manifest에 싣지 않는다. `shared/prompt-library.js`는 import/export 정규화 reference용으로만 남고, active content preload baseline은 `shared/provider-identity-cache.js`, generic `shared/storage.js`, `shared/provider-identity.js`, hosted prompt controller 쪽에 둔다. dormant prompt CRUD/sync operation helper는 `backup/legacy-panel/shared/prompt-cloud-sync.js`, `backup/legacy-panel/shared/prompt-storage.js` backup reference로만 남긴다.
- 현재 `1.x+` extension bundle은 legacy cloud sync base helper도 active shared root에 남기지 않는다. `backup/legacy-panel/shared/cloud-sync.js`가 legacy fallback/sync reference를 맡고, active shared root는 browser-only provider identity cache/storage contract만 유지한다.
- 현재 `1.x+` extension bundle은 dormant release/meeting storage accessor도 active shared core에 남기지 않는다. active `shared/storage.js`는 generic local state/settings/ui-preferences/provider-identity-cache/product-lane migration만 유지하고, backup release/meeting storage accessor는 `backup/legacy-panel/shared/legacy-storage-accessors.js` reference로만 남긴다.
- 현재 `1.x+` extension bundle은 dormant release/meeting storage key/default schema도 active `shared/constants.js`에 남기지 않는다. active constants는 live browser shell 기본값만 유지하고, backup release/meeting helper가 필요한 schema literal을 직접 가진다.
- 현재 `1.x+` extension bundle은 dormant `promptLibrary` local cache schema도 active `shared/constants.js` / `shared/storage.js`에 남기지 않는다. active prompt lane은 Firestore/hosted state를 정본으로 보고, backup prompt helper가 legacy local cache key/default를 직접 가진다.
- 현재 `1.x+` extension bundle은 meeting legacy/shared helper도 활성 manifest에 싣지 않는다. `backup/legacy-panel/shared/meeting-debug.js`, `backup/legacy-panel/shared/meeting-bridge.js`, `hosting/meeting/debug-console.js`는 inactive reference 또는 hosted-only asset로 남고, active v2 content bundle은 hosted meeting hub와 browser-only runtime broker만 유지한다.
- 현재 `1.x+` extension bundle은 release legacy runtime/helper도 활성 manifest에 싣지 않는다. `backup/legacy-panel/release-manager.js`, `backup/legacy-panel/shared/release-info.js`는 `0.4.4` 영향 판단용 reference로만 남고, active v2 bundle은 hosted release controller가 올린 compact `toolSummaries.release`만 유지한다.
- 현재 `1.x+` extension bundle은 legacy content bookmark view/style도 활성 manifest에 싣지 않는다. `backup/legacy-panel/bookmark-view.js`, `backup/legacy-panel/tools.css`는 reference/source로만 남고, active conversation UI는 hosted `hosting/extension-v2/panel/bookmark-view.js`가 맡는다.
- 현재 `1.x+` extension bundle은 legacy bookmark runtime도 활성 manifest에 싣지 않는다. `backup/legacy-panel/panel-bookmark-controller.js`는 `0.4.4` 영향 판단용 reference로만 남고, active conversation glue는 `content/panel-v2-composition-controller.js` 안의 inline bridge가 맡는다.
- 현재 `1.x+` extension bundle은 standalone runtime/debug helper도 활성 manifest에 싣지 않는다. `backup/legacy-panel/panel-runtime-controller.js`, `backup/legacy-panel/panel-debug-controller.js`는 inactive reference로만 남고, active runtime/debug glue는 `content/panel-v2-composition-controller.js` 안으로 합친다.
- 현재 `1.x+` extension bundle은 standalone state/provider-identity helper도 활성 manifest에 싣지 않는다. active state initialization과 panel-local provider identity sync는 `content/panel-v2-composition-controller.js` 안에서 직접 처리한다.
- 현재 `1.x+` extension bundle은 standalone activity/surface/lifecycle/bootstrap/render/shell helper도 활성 manifest에 싣지 않는다. active tool/open/visibility/surface/bootstrap/render bridge는 `content/panel-v2-shell-bridge.js` 한 파일로만 유지하고, `content/panel-v2-composition-controller.js`는 그 bridge wiring만 맡는다.
- prompt shell controller baseline도 lane-aware로 단순화한다. legacy lane과 v2 lane 모두 extra `panelPromptBridgeController` proxy 없이 `backup/legacy-panel/panel-prompt-controller.js` 또는 v2 hosted-owned prompt controller를 shell/render/bootstrap wiring에 직접 넘긴다.
- `1.x+` active lane은 persisted legacy prompt store alias도 오래 끌고 가지 않는다. old `uiPreferences.activeTool === "store"` 값은 `shared/storage.js`에서 즉시 `activeTool: "prompts"` + `activePromptTab: "store"`로 흡수하고, active route/shell은 store를 별도 tool identity로 유지하지 않는다.
- 기본 `npm.cmd run verify`는 활성 v2 lane 기준 검증만 유지하고, `scripts/verify-legacy-isolation.js`로 active manifest/content lane이 `backup/legacy-panel/*`에 다시 기대지 않는지도 함께 고정한다. backup legacy prompt/runtime/view 검증은 `npm.cmd run verify:legacy-backup`으로 분리하고, backup reference verify 스크립트는 active 루트 `scripts/`와 섞지 않고 `scripts/legacy-panel/*` 아래에 모은다. backup reference는 `DB/Functions/shared contract` 변경 때만 다시 확인한다.
- content script bootstrap은 계속 `manifest.json` 로드 순서를 정본으로 삼고, `content/panel.js`가 직접 소비하는 hosted panel bridge/helper preload는 같은 manifest 배열에서 `content/panel.js`보다 먼저 로드해야 한다. 현재 baseline helper는 `content/panel-console-trace.js`, `content/page-capability-router.js`, `content/hosted-panel-bridge.js`, `content/panel-host-runtime.js`, `content/panel-host-bridge.js`, `content/panel-host-view.js`다.
- `1.x+` active lane의 browser-only page capability 구현은 `content/page-capability-router.js` 한 곳에서만 유지한다. `content/hosted-panel-bridge.js`는 `page/runtime/panel` request dispatch만 맡고, hosted caller는 canonical capability action만 쓴다.
- `1.x+` active lane의 browser-only privileged runtime capability 구현은 `background/panel-runtime-capability-router.js` 한 곳에서만 유지한다. `background/panel-runtime-invoke.js`는 hosted panel runtime request를 router에 dispatch하는 shim만 맡고, generic storage CRUD나 feature별 ad-hoc runtime action은 다시 열지 않는다. hosted meeting workspace open/share/auth/probe browser adapter는 `background/meeting-workspace-capability.js`로 분리하고, background top-level message surface도 `inova-panel:invoke`와 hosted meeting workspace `authorize/probe` bridge만 유지하며, feature별 prompt/store/release/meeting message 이름은 active lane에 다시 열지 않는다.
- `1.x+` active lane의 meeting workspace target/debug setting normalization도 표면별 임시 helper로 다시 복제하지 않는다. `shared/firebase-config.js`의 `firebaseConfig.meeting.normalizeSettings()`를 정본으로 두고, popup과 background meeting workspace capability가 같은 helper를 재사용한다.
- `content/panel.js`는 hosted panel iframe target을 feature별 helper에서 직접 고르지 않는다. lane/local target 판단은 `shared/firebase-config.js`의 `firebaseConfig.panel.resolveRuntime()`가 맡고, shell host는 그 generic panel runtime만 소비한다.
- `1.x+`에서 `release:build`는 `hosting/extension-v2/releases/*`와 `hosting/extension-v2/downloads/*`를 실제 served artifact 기준으로 채워야 한다. hosted v2 release panel은 이 lane-local 경로를 직접 읽으므로, curated history에 남긴 이전 공개 버전 ZIP도 현재 lane download 디렉터리에서 404 없이 열리도록 함께 복사한다. 같은 build는 current version ZIP의 `artifact` 메타도 `releases/release-notes.json` 현재 버전 엔트리에 즉시 backfill해야 한다.
- 기본 `npm.cmd run verify`와 `node scripts/verify-release-package.js`는 현재 lane의 `hosting/*/releases/latest.json`, `history.json`, `downloads/latest.zip`, version ZIP들, 그리고 curated `releases/release-notes.json`이 서로 같은 공개 baseline을 가리키는지 함께 검증해야 한다. history/latest에 노출된 공개 버전은 현재 버전까지 포함해 curated notes에도 반드시 artifact 메타가 있어야 한다.
- `1.x+` v2 lane은 hosted-first를 기본값으로 쓴다. 탭 UI/state/action flow의 기본 위치는 hosted이고, extension은 page DOM adapter + iframe host + runtime broker 같은 browser-only capability를 유지한다.
- `DB/Functions 계약을 바꾸지 않는 순수 panel v2 migration`은 현재 `1.x+` bundle이 정상 동작하는지만 먼저 확인한다. 이런 작업에서 legacy extension panel 코드는 활성 bundle 안에 계속 보존할 대상으로 보지 않는다.
- 현재 `1.x+` 활성 bundle과 공유 계약이 더 이상 쓰지 않는 legacy extension panel 코드는 `content/*` 안에 섞어 두지 않는다. 기본 정리 방향은 `backup/legacy-panel/*`로 격리해 참고본으로만 남기거나, 더 이상 필요 없으면 삭제하는 것이다.
- `backup/legacy-panel/*`는 평소 panel migration 경로가 아니라 `0.4.4` 영향 판단용 보관소다. `DB/Functions`나 shared server contract를 손댈 때만 backup legacy와 비교해 기존 사용자 영향이 없는지 확인한다.
- 문서가 이 ownership 이동을 뒤따르지 못하면, 발견한 같은 작업 안에서 바로 고친다.
- v2 lane이라고 해서 모든 backend endpoint family를 바로 분리하지 않는다. 현재 backend 분리가 준비된 것은 prompt-library 계열뿐이고, meeting Functions endpoint는 `1.0.0` v2 lane에서도 legacy 이름(`listInovaMeetings`, `issueInovaMeetingPanelAuth` 등)을 계속 사용한다.
- local rehearsal에서 hosted panel 기본 경로는 `http://127.0.0.1:5000/extension/panel/index.html`이다.
- local rehearsal에서 `1.x+` v2 lane hosted panel 기본 경로는 `http://127.0.0.1:5000/extension-v2/panel/index.html`이다.
- local rehearsal에서 page DOM에 삽입되는 hosted panel/meeting bridge/prompt bridge iframe src는 direct loopback URL이 아니라 extension `content/frame-proxy.html?target=...` wrapper를 사용한다. 실제 target URL baseline은 계속 `127.0.0.1:5000/*`로 유지하고, manifest는 이 proxy page와 extension frame-src allowlist를 함께 유지한다.
- local 작업 산출물 정리는 `prepare`로 설치되는 `.githooks/pre-commit`가 맡는다. 현재 baseline은 `scripts/cleanup-local-artifacts.js`이며, root `*.log`, `tmp-emulators-*.log`, `.codex-local`, `.codex-logs`, `.codex-temp`의 로그, `.playwright-cli`, `.playwright-mcp`의 `page-*.yml`, `output/*` 임시 산출물을 지우고 빈 폴더는 함께 제거한다. 실행 중 프로세스가 잡고 있는 로그는 skip한다.
- prompt bridge 자산 경로는 lane-stable 규칙을 따른다. `1.x+` v2 lane이어도 `panelAppUrl`만 `extension-v2/panel/*`로 이동하고, hidden prompt bridge target은 production/local 모두 계속 `extension/prompt-panel-bridge.html`을 사용한다.
- `1.x+` v2 lane의 prompt-library read baseline은 `auth.issue-panel-session(panel=prompt) -> Firestore custom token sign-in -> integration_inova_accounts_v2.promptLibraryMeta onSnapshot -> prompt_library_orders_v2/prompt_library_chunks_v2 direct read`다. hosted v2 `내 요청` 목록 read를 다시 `loadInovaPromptLibraryV2` Functions fetch baseline으로 되돌리지 않는다.
- local rehearsal에서도 같은 baseline을 유지한다. prompt panel auth는 local Functions base URL을 향하고, hosted v2 panel은 local Auth/Firestore emulator에 붙어 `integration_inova_accounts_v2`, `prompt_library_orders_v2`, `prompt_library_chunks_v2`를 직접 읽을 수 있어야 한다.
- hosted panel 자산이 더 최신이어도 extension bridge capability가 부족하면 조용히 깨지지 않고 explicit update-needed 상태를 보여줘야 한다.

### Hosted origin/path

- hosted workspace: `https://browser-extension-main.web.app/meeting/index.html`
- hosted panel bridge: `https://browser-extension-main.web.app/meeting/panel-bridge.html`
- legacy path는 `0.4.4` 지원이 끝나기 전까지 rename/delete 하지 않는다.

### Local rehearsal boundary

- popup에서 `settings.meetingWorkspaceTarget=local`을 고르면 rehearsal target은 `http://127.0.0.1:5000/meeting/index.html`과 `http://127.0.0.1:5000/meeting/panel-bridge.html`이다.
- local target은 hosted page만이 아니라 meeting Functions/Auth/Firestore/Storage emulator까지 함께 보는 full-local 경로다.
- 사용자가 `로컬 에뮬레이터`만 요청하면 local rehearsal 기본 부팅 명령은 `npm.cmd run emulator:meeting-local`이다. `hosting only`나 빠른 hosted smoke를 명시했을 때만 `npm.cmd run emulator:hosting`으로 낮춘다.
- 이런 단순 실행/운영 요청은 feature 구현 탐색보다 명령 시작이 우선이다. `cwd`/Git/셸 확인 뒤 `package.json`과 관련 환경 메모만 보고 먼저 부팅하고, 실패하거나 스크립트 선택이 모호할 때만 feature 문서로 확장한다.
- 같은 local target은 prompt와 hosted panel도 full-local rehearsal로 같이 본다. prompt read/write/review/panel auth는 `http://127.0.0.1:5001/browser-extension-main/asia-northeast3/*`를 향하고, hidden prompt bridge target은 `http://127.0.0.1:5000/extension/prompt-panel-bridge.html`, hosted panel target은 legacy lane `http://127.0.0.1:5000/extension/panel/index.html`, v2 lane `http://127.0.0.1:5000/extension-v2/panel/index.html`이다. 다만 페이지에 꽂히는 실제 iframe src는 둘 다 extension frame proxy를 거쳐 local Auth/Firestore emulator와 hosted 자산을 연다.
- 같은 local/prod panel target handoff는 feature helper 선택이 아니라 `firebaseConfig.panel.resolveRuntime()`를 정본으로 삼는다. `meetingWorkspaceTarget`이 local이면 panel host는 lane-aware local `panelAppUrl`을 받고, production이면 해당 lane의 hosted `panelAppUrl`을 그대로 쓴다.
- `1.0.0` v2 baseline에서도 panel render payload는 `settings.meetingWorkspaceTarget`을 iframe host까지 반드시 전달해야 한다. 이 local/prod handoff는 `npm.cmd run verify` 안의 `verify-panel-render`로 계속 고정한다.
- 나머지 hosted-first/runtime 계약은 `npm.cmd run verify`에 포함된 lane/runtime/hosted 계약 검증으로 계속 고정한다.

### Auth scope와 URL 의미

- panel auth 기본 scope: `meeting-panel`
- workspace auth 기본 scope: `meeting-workspace`
- rules 공존 기준상 owner/share workspace scope는 `meeting-workspace-owner`, `meeting-workspace-share`도 함께 고려한다.
- workspace URL은 launch/session 기반 열기 흐름을 유지한다.

### Functions family

#### launch/session auth

- `issueInovaMeetingLaunch`
- `exchangeInovaMeetingLaunch`
- `issueInovaMeetingPanelAuth`
- `issueInovaMeetingWorkspaceAuth`
- `authorizeInovaMeetingWorkspaceAccess`

#### meeting CRUD/share

- `listInovaMeetings`
- `updateInovaMeeting`
- `updateInovaMeetingResult`
- `moveInovaMeetingResult`
- `previewInovaMeetingResultSectionEdit`
- `applyInovaMeetingResultSectionEdit`
- `deleteInovaMeeting`
- `deleteInovaMeetingResult`
- `createInovaMeetingShareLink`
- `revokeInovaMeetingShareLink`

#### processing

- `createInovaMeetingJob`
- `uploadInovaMeetingSource`
- `processQueuedInovaMeetingJob`
- `processQueuedInovaMeetingJobPart`
- `finalizeChunkedInovaMeetingJob`
- `processQueuedInovaMeetingCommand`
- `processQueuedInovaMeetingDeletion`
- `sweepQueuedInovaMeetingDeletions`

### Mutable data namespace

- `integration_inova_meetings`
- `integration_inova_meeting_jobs`
- `integration_inova_meeting_job_parts`
- `integration_inova_meeting_job_finalizers`
- `integration_inova_meeting_artifacts`
- `integration_inova_meeting_commands`
- `integration_inova_meeting_deletions`

## 문서 갱신 규칙

- 아래 범위가 바뀌면 이 문서를 같은 작업 안에서 갱신한다.
  - version lane 정책
  - meeting legacy baseline
  - release decision 기준
- ordinary feature 구현이나 git으로 복구 가능한 작업 이력은 이 문서에 누적하지 않는다.
- 세션 인계 로그, split chronology, milestone diary는 이 문서 범위 밖이다.
