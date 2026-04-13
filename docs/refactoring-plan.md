# Version And Release Decision Note

이 문서는 구조 진행 일지나 세션 handoff가 아니라, `버전 결정`, `version lane`, `meeting legacy baseline`, `release decision boundary`만 빠르게 확인하기 위한 기준 문서다.  
ordinary feature 구현 변경, 탭별 hosted ownership 진행도, smoke 이슈 목록, git chronology는 이 문서의 대상이 아니다. 그런 내용은 `docs/current-handoff.md`, `docs/runtime-architecture.md`, feature `AGENTS.md`에서 관리한다.

마지막 상태 갱신: 2026-04-13  
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
  - 다만 최종 candidate ready로 올리려면 실제 Chrome 기준의 주요 회의 smoke 기록이 남아 있어야 한다.

## Meeting Legacy Baseline

아래 baseline은 `1.0.0` v2 lane에서도 compat 이유로 계속 유지하는 값들이다.

## Version Lane Policy

- `0.x` legacy lane의 hosted panel 기본 경로는 `https://browser-extension-main.web.app/extension/panel/index.html`이다.
- `1.x+` v2 lane은 같은 규칙으로 `hosting/extension-v2/panel/*`와 `panelAppUrl`을 사용한다.
- 공개 기준선 `0.4.4`는 legacy lane에 남기고, 다음 공개 릴리스 `1.0.0`은 v2 lane을 기본으로 사용한다.
- 현재 `1.x+` extension bundle은 panel을 `content/panel-v2-composition-controller.js`로 직접 부팅한다. `backup/legacy-panel/panel-composition-controller.js`, `backup/legacy-panel/panel-action-controller.js`, `backup/legacy-panel/panel-meeting-controller.js`, `backup/legacy-panel/meeting-manager.js`, `backup/legacy-panel/meeting-view.js`, `backup/legacy-panel/meeting-panel-bridge-controller.js`는 legacy reference/source로만 남아 있고 현재 manifest에는 싣지 않는다.
- 현재 `1.x+` extension bundle은 legacy content render/view도 활성 manifest에 더 이상 싣지 않는다. `backup/legacy-panel/prompt-view.js`, `backup/legacy-panel/store-view.js`, `backup/legacy-panel/prompt-review-view.js`, `backup/legacy-panel/prompt-hub-view.js`, `backup/legacy-panel/release-view.js`는 inactive reference/source로만 남고, active prompt/release render ownership은 hosted v2 panel(`hosting/extension-v2/panel/*`)이 맡는다.
- 현재 `1.x+` extension bundle은 prompt legacy runtime도 활성 manifest에 싣지 않는다. `backup/legacy-panel/features/prompt-library/files.js`, `backup/legacy-panel/features/prompt-library/cloud-sync-manager.js`, `backup/legacy-panel/features/prompt-library/prompt-manager.js`, `backup/legacy-panel/features/prompt-store/prompt-realtime-manager.js`, `backup/legacy-panel/features/prompt-store/store-manager.js`, `backup/legacy-panel/prompt-hub-state.js`, `backup/legacy-panel/prompt-hub-panel.js`, `backup/legacy-panel/prompt-hub-controller.js`, `backup/legacy-panel/prompt-hub-runtime.js`, `backup/legacy-panel/panel-prompt-controller.js`는 legacy reference/source로 남고, active v2 bundle은 `content/panel-v2-prompt-controller.js`로 review handoff와 minimal prompt snapshot만 유지한다.
- 현재 `1.x+` extension bundle은 meeting legacy/shared helper도 활성 manifest에 싣지 않는다. `shared/meeting-debug.js`, `shared/meeting-bridge.js`, `hosting/meeting/debug-console.js`는 inactive reference 또는 hosted-only asset로 남고, active v2 content bundle은 hosted meeting hub와 browser-only runtime broker만 유지한다.
- 현재 `1.x+` extension bundle은 release legacy runtime/helper도 활성 manifest에 싣지 않는다. `backup/legacy-panel/release-manager.js`, `backup/legacy-panel/shared/release-info.js`는 `0.4.4` 영향 판단용 reference로만 남고, active v2 bundle은 hosted release controller가 올린 compact `releaseSummary`만 유지한다.
- 현재 `1.x+` extension bundle은 legacy content bookmark view/style도 활성 manifest에 싣지 않는다. `backup/legacy-panel/bookmark-view.js`, `backup/legacy-panel/tools.css`는 reference/source로만 남고, active conversation UI는 hosted `hosting/extension-v2/panel/bookmark-view.js`가 맡는다.
- 현재 `1.x+` extension bundle은 legacy bookmark runtime도 활성 manifest에 싣지 않는다. `backup/legacy-panel/panel-bookmark-controller.js`는 `0.4.4` 영향 판단용 reference로만 남고, active conversation glue는 `content/panel-v2-composition-controller.js` 안의 inline bridge가 맡는다.
- 현재 `1.x+` extension bundle은 standalone runtime/debug helper도 활성 manifest에 싣지 않는다. `backup/legacy-panel/panel-runtime-controller.js`, `backup/legacy-panel/panel-debug-controller.js`는 inactive reference로만 남고, active runtime/debug glue는 `content/panel-v2-composition-controller.js` 안으로 합친다.
- prompt shell controller baseline도 lane-aware로 단순화한다. legacy lane과 v2 lane 모두 extra `panelPromptBridgeController` proxy 없이 `backup/legacy-panel/panel-prompt-controller.js` 또는 v2 hosted-owned prompt controller를 shell/render/bootstrap wiring에 직접 넘긴다.
- 기본 `npm.cmd run verify`는 활성 v2 lane 기준 검증만 유지하고, backup legacy prompt runtime 검증은 `npm.cmd run verify:legacy-backup`으로 분리한다. backup reference는 `DB/Functions/shared contract` 변경 때만 다시 확인한다.
- content script bootstrap은 계속 `manifest.json` 로드 순서를 정본으로 삼고, `content/panel.js`가 직접 소비하는 hosted panel helper 모듈은 같은 manifest 배열에서 `content/panel.js`보다 먼저 로드해야 한다. 현재 baseline helper는 `content/panel-hosted-bridge-request.js`, `content/panel-hosted-meeting-request.js`, `content/panel-hosted-prompt-request.js`, `content/panel-hosted-runtime-request.js`, `content/panel-hosted-page-request.js`, `content/panel-hosted-shell-request.js`다.
- `1.x+`에서 `release:build`는 `hosting/extension-v2/releases/*`와 `hosting/extension-v2/downloads/*`를 실제 served artifact 기준으로 채워야 한다. hosted v2 release panel은 이 lane-local 경로를 직접 읽으므로, curated history에 남긴 이전 공개 버전 ZIP도 현재 lane download 디렉터리에서 404 없이 열리도록 함께 복사한다.
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
- `1.x+` v2 lane의 prompt-library read baseline은 `auth.issue-prompt-panel -> Firestore custom token sign-in -> integration_inova_accounts_v2.promptLibraryMeta onSnapshot -> prompt_library_orders_v2/prompt_library_chunks_v2 direct read`다. hosted v2 `내 요청` 목록 read를 다시 `loadInovaPromptLibraryV2` Functions fetch baseline으로 되돌리지 않는다.
- local rehearsal에서도 같은 baseline을 유지한다. prompt panel auth는 local Functions base URL을 향하고, hosted v2 panel은 local Auth/Firestore emulator에 붙어 `integration_inova_accounts_v2`, `prompt_library_orders_v2`, `prompt_library_chunks_v2`를 직접 읽을 수 있어야 한다.
- hosted panel 자산이 더 최신이어도 extension bridge capability가 부족하면 조용히 깨지지 않고 explicit update-needed 상태를 보여줘야 한다.

### Hosted origin/path

- hosted workspace: `https://browser-extension-main.web.app/meeting/index.html`
- hosted panel bridge: `https://browser-extension-main.web.app/meeting/panel-bridge.html`
- legacy path는 `0.4.4` 지원이 끝나기 전까지 rename/delete 하지 않는다.

### Local rehearsal boundary

- popup에서 `settings.meetingWorkspaceTarget=local`을 고르면 rehearsal target은 `http://127.0.0.1:5000/meeting/index.html`과 `http://127.0.0.1:5000/meeting/panel-bridge.html`이다.
- local target은 hosted page만이 아니라 meeting Functions/Auth/Firestore/Storage emulator까지 함께 보는 full-local 경로다.
- 같은 local target은 prompt와 hosted panel도 full-local rehearsal로 같이 본다. prompt read/write/review/panel auth는 `http://127.0.0.1:5001/browser-extension-main/asia-northeast3/*`를 향하고, hidden prompt bridge target은 `http://127.0.0.1:5000/extension/prompt-panel-bridge.html`, hosted panel target은 legacy lane `http://127.0.0.1:5000/extension/panel/index.html`, v2 lane `http://127.0.0.1:5000/extension-v2/panel/index.html`이다. 다만 페이지에 꽂히는 실제 iframe src는 둘 다 extension frame proxy를 거쳐 local Auth/Firestore emulator와 hosted 자산을 연다.
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
