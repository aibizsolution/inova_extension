# Version And Release Decision Note

이 문서는 구조 진행 일지나 세션 handoff가 아니라, `버전 결정`, `version lane`, `meeting legacy baseline`, `release decision boundary`만 빠르게 확인하기 위한 기준 문서다.  
ordinary feature 구현 변경, 탭별 hosted ownership 진행도, smoke 이슈 목록, git chronology는 이 문서의 대상이 아니다. 그런 내용은 `docs/current-handoff.md`, `docs/runtime-architecture.md`, feature `AGENTS.md`에서 관리한다.

마지막 상태 갱신: 2026-04-16
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

## `1.0.0` Done Criteria

- hosted-first ownership 정리만으로는 `1.0.0 done`으로 보지 않는다.
- 공식 종료 기준은 이렇다: `1.0.0` rollout 후 `0.4.4` 사용자가 0명이 되었을 때, `0.4.4` retirement 때문에 extension patch, ZIP 재배포, `1.0.1` follow-up이 필요하면 아직 완료가 아니다.
- 반대로 server-side `hosting/functions` cleanup이나 compat alias 유지 자체는 blocker가 아니다. 핵심은 active extension bundle이 나중 retirement 시점에도 새 ZIP 없이 그대로 남을 수 있느냐다.
- 현재 감사 기준으로는 refactor backlog보다 manual validation/release gate가 남은 상태다. 새 구현 작업은 validation이 실제 이슈를 드러낼 때만 다시 연다.

### Extension-bundle blockers

- 현재 감사 기준으로는 새 blocker가 확인되지 않았다. 이 섹션은 앞으로 무엇이 blocker인지 정의하는 용도다.
- active `content/background/popup/shared/manifest`가 `0.4.4` 전용 extension module, asset, deprecated extension-side action surface를 다시 싣거나 부팅하면 안 된다.
- verify는 active v2 bundle이 `backup/legacy-panel/*`, dead legacy hosted panel asset, deprecated extension-side controller path를 다시 로드하면 실패해야 한다.

### Not blockers

- `backup/legacy-panel/*`와 inactive reference 보관 자체는 blocker가 아니다.
- server-side compat path, legacy endpoint name, hosting alias처럼 나중에 서버 배포만으로 바꾸거나 유지할 수 있는 표면도 blocker가 아니다.
- 핵심 기준은 repo 안의 legacy 문자열 개수가 아니라, active v2 extension bundle이 future retirement 시점에 새 ZIP을 요구하는지다.

## Meeting Legacy Baseline

아래 baseline은 `1.0.0` v2 lane에서도 compat 이유로 계속 유지하는 값들이다.

## Version Lane Policy

- `0.x` legacy lane의 hosted panel 기본 경로는 `https://browser-extension-main.web.app/extension/panel/index.html`이다.
- `1.x+` v2 lane은 같은 규칙으로 `hosting/extension-v2/panel/*`와 `panelAppUrl`을 사용한다.
- 공개 기준선 `0.4.4`는 legacy lane에 남기고, 다음 공개 릴리스 `1.0.0`은 v2 lane을 기본으로 사용한다.
- 현재 `1.x+` extension bundle은 panel을 `content/panel-v2-composition-controller.js`로 직접 부팅한다. `backup/legacy-panel/panel-composition-controller.js`, `backup/legacy-panel/panel-action-controller.js`, `backup/legacy-panel/panel-meeting-controller.js`, `backup/legacy-panel/meeting-manager.js`, `backup/legacy-panel/meeting-view.js`, `backup/legacy-panel/meeting-panel-bridge-controller.js`는 legacy reference/source로만 남아 있고 현재 manifest에는 싣지 않는다.
- 현재 `1.x+` extension bundle은 legacy content render/view도 활성 manifest에 더 이상 싣지 않는다. `backup/legacy-panel/prompt-view.js`, `backup/legacy-panel/store-view.js`, `backup/legacy-panel/prompt-review-view.js`, `backup/legacy-panel/prompt-hub-view.js`, `backup/legacy-panel/release-view.js`는 inactive reference/source로만 남고, active prompt/release render ownership은 hosted v2 panel(`hosting/extension-v2/panel/*`)이 맡는다.
- 현재 `1.x+` extension bundle은 prompt legacy runtime도 활성 manifest에 싣지 않는다. `backup/legacy-panel/features/prompt-library/files.js`, `backup/legacy-panel/features/prompt-library/cloud-sync-manager.js`, `backup/legacy-panel/features/prompt-library/prompt-manager.js`, `backup/legacy-panel/features/prompt-store/prompt-realtime-manager.js`, `backup/legacy-panel/features/prompt-store/store-manager.js`, `backup/legacy-panel/prompt-hub-state.js`, `backup/legacy-panel/prompt-hub-panel.js`, `backup/legacy-panel/prompt-hub-controller.js`, `backup/legacy-panel/prompt-hub-runtime.js`, `backup/legacy-panel/panel-prompt-controller.js`는 legacy reference/source로 남고, active v2 bundle은 `content/panel-v2-prompt-controller.js`로 review handoff와 minimal prompt snapshot만 유지한다.
- 현재 `1.x+` extension bundle은 dormant prompt import/export helper도 활성 manifest에 싣지 않는다. `backup/legacy-panel/shared/prompt-library.js`는 import/export 정규화 reference용으로만 남고, active content preload baseline은 `shared/provider-identity-cache.js`, generic `shared/storage.js`, `content/provider-identity-sensor.js`, hosted prompt controller 쪽에 둔다. dormant prompt CRUD/sync operation helper는 `backup/legacy-panel/shared/prompt-cloud-sync.js`, `backup/legacy-panel/shared/prompt-storage.js` backup reference로만 남긴다.
- 현재 `1.x+` extension bundle은 dormant prompt store normalization helper를 active shared root에 싣지 않는다. legacy store taxonomy/entry normalization은 `backup/legacy-panel/shared/prompt-store.js` reference로만 남고, active hosted/functions store lane은 deploy root별 `prompt-store-model.js` copy를 쓴다. Prompt content normalization과 prompt id 생성은 deploy root별 `prompt-text-model.js` copy가 맡고, hosted prompt-library와 hosted/functions prompt-store 모델이 이 계약을 소비한다. Firebase 배포 루트가 `hosting`과 `functions`로 분리되어 있으므로 `scripts/verify-prompt-store-model.js`가 hosted/functions copy 동일성과 Functions 위임을 잠근다.
- 현재 `1.x+` extension bundle은 legacy cloud sync base helper도 active shared root에 남기지 않는다. `backup/legacy-panel/shared/cloud-sync.js`가 legacy fallback/sync reference를 맡고, active shared root는 browser-only provider identity cache/storage contract만 유지한다.
- 현재 `1.x+` extension bundle은 dormant release/meeting storage accessor도 active shared core에 남기지 않는다. active `shared/storage.js`는 generic local state/settings/ui-preferences/provider-identity-cache/product-lane migration만 유지하고, backup release/meeting storage accessor는 `backup/legacy-panel/shared/legacy-storage-accessors.js` reference로만 남긴다.
- 현재 `1.x+` extension bundle은 dormant release/meeting storage key/default schema도 active `shared/constants.js`에 남기지 않는다. active constants는 live browser shell 기본값만 유지하고, backup release/meeting helper가 필요한 schema literal을 직접 가진다.
- 현재 `1.x+` extension bundle은 dormant `promptLibrary` local cache schema도 active `shared/constants.js` / `shared/storage.js`에 남기지 않는다. active prompt lane은 Firestore/hosted state를 정본으로 보고, backup prompt helper가 legacy local cache key/default를 직접 가진다.
- 현재 `1.x+` extension bundle은 background-only auth/cloud/helper도 active shared root에 남기지 않는다. i-Nova access token refresh는 `background/inova-auth-client.js`, Functions-backed cloud POST helper는 `background/cloud-api-client.js`, lane-aware Functions endpoint/runtime resolution은 `background/functions-runtime-config.js`가 맡고, active `shared/*`는 browser-agnostic cache/state/config core만 유지한다.
- 현재 `1.x+` extension bundle은 active shared root inventory도 고정한다. live shared root는 `shared/constants.js`, `shared/firestore-collections.js`, `shared/firebase-config.js`, `shared/product-lane.js`, `shared/provider-identity-cache.js`, `shared/session.js`, `shared/storage.js`만 남기고, 이 목록 밖 helper는 ownership 위치를 다시 정한 뒤 해당 surface(`content/*`, `background/*`, `backup/legacy-panel/*`)에 둔다. `shared/firestore-collections.js`와 `shared/firebase-config.js`는 popup에서 `shared/session.js`보다 먼저 로드되므로 세션 helper에 의존하지 않는 독립 `trimString` / URL normalizer만 유지한다.
- 현재 `1.x+` extension bundle은 active background root inventory도 고정한다. live background root는 `background/browser-capability.js`, `background/capability-manifest-validator.js`, `background/cloud-api-client.js`, `background/functions-runtime-config.js`, `background/inova-auth-client.js`, `background/meeting-workspace-capability.js`, `background/panel-auth-cache.js`, `background/panel-runtime-capability-router.js`, `background/panel-runtime-invoke.js`, `background/panel-session-capability.js`, `background/service-worker.js`만 남기고, 이 목록 밖 helper는 ownership 위치를 다시 정한 뒤 해당 surface 또는 기존 capability module 안에 둔다.
- 현재 `1.x+` extension bundle은 active content root inventory도 고정한다. live content root는 `composer(.js/.css)`, `dom.js`, `provider-identity-sensor.js`, `frame-proxy(.html/.js/helper)`, `page-capability-router.js`, `hosted-panel-bridge.js`, `panel-console-trace.js`, `panel-host-*`, `panel-v2-*`, `panel.js`, `panel.css`, `route-*`, `main.js`, `meeting-workspace-bridge.js`, `content/features/prompt-review/*.js`만 남기고, 이 목록 밖 runtime asset은 ownership 위치를 다시 정한 뒤 해당 surface에 둔다.
- 현재 `1.x+` extension bundle은 active popup root inventory도 고정한다. live popup root는 `popup/index.html`, `popup/index.css`, `popup/index.js`만 남기고, manifest `default_popup`과 icon/default_icon 자산 매핑도 같은 contract/verify로 잠근다.
- 현재 `1.x+` extension bundle은 manifest browser privilege surface도 고정한다. live 권한 표면은 현재 `permissions`, `host_permissions`, `extension_pages frame-src`, meeting workspace bridge match, frame proxy web-accessible match만 유지하고, 새 권한/origin/match는 browser-only capability 필요성이 확인될 때만 contract + manifest를 같이 늘린다.
- 현재 `1.x+` extension bundle은 browser-only power owner도 고정한다. direct `fetch`, `chrome.tabs`, `chrome.cookies`, `chrome.storage`, page `localStorage`, panel `sessionStorage`는 선언된 adapter file에서만 허용하고, thin `content/*`/`popup/*` shell이나 generic shared core가 raw Functions endpoint family 이름 또는 Firebase SDK bootstrap을 다시 들면 `scripts/verify-browser-only-boundary.js`가 실패해야 한다.
- panel open 영속 상태는 active v2 lane에서 hosted-owned `uiPreferences.panelOpen`이 맡는다. content는 `PANEL_OPEN_KEY`나 panel-open `sessionStorage`를 읽고 쓰지 않고, 초기 snapshot seed와 hosted `panel-chrome-sync` DOM 반영만 담당한다.
- 현재 `1.x+` extension bundle은 meeting legacy/shared helper도 활성 manifest에 싣지 않는다. `backup/legacy-panel/shared/meeting-debug.js`, `backup/legacy-panel/shared/meeting-bridge.js`는 inactive reference로만 남고, hosted meeting debug는 화면 패널이 아니라 `hosting/meeting/workspace-debug.js`의 DevTools console trace가 맡는다.
- 현재 `1.x+` extension bundle은 release legacy runtime/helper도 활성 manifest에 싣지 않는다. `backup/legacy-panel/release-manager.js`, `backup/legacy-panel/shared/release-info.js`는 `0.4.4` 영향 판단용 reference로만 남고, active v2 bundle은 release count/view state를 hosted release controller 안에만 유지한다.
- 현재 `1.x+` extension bundle은 legacy content bookmark view/style도 활성 manifest에 싣지 않는다. `backup/legacy-panel/bookmark-view.js`, `backup/legacy-panel/tools.css`는 reference/source로만 남고, active conversation UI는 hosted `hosting/extension-v2/panel/bookmark-view.js`가 맡는다.
- 현재 `1.x+` extension bundle은 legacy bookmark runtime도 활성 manifest에 싣지 않는다. `backup/legacy-panel/panel-bookmark-controller.js`는 `0.4.4` 영향 판단용 reference로만 남고, active conversation glue는 `content/panel-v2-composition-controller.js` 안의 inline bridge가 맡는다.
- 현재 `1.x+` extension bundle은 standalone runtime/debug helper도 활성 manifest에 싣지 않는다. `backup/legacy-panel/panel-runtime-controller.js`, `backup/legacy-panel/panel-debug-controller.js`는 inactive reference로만 남고, active runtime/debug glue는 `content/panel-v2-composition-controller.js` 안으로 합친다.
- 현재 `1.x+` extension bundle은 standalone state/provider-identity helper도 활성 manifest에 싣지 않는다. active state initialization과 panel-local provider identity sync는 `content/panel-v2-composition-controller.js` 안에서 직접 처리한다.
- 현재 `1.x+` extension bundle은 browser-only provider identity sensor를 `shared/*`에 싣지 않는다. active lane은 `content/provider-identity-sensor.js`가 page localStorage 읽기만 맡고, legacy reference만 `backup/legacy-panel/shared/provider-identity.js`에 남긴다.
- 현재 `1.x+` extension bundle은 panel host 전용 frame proxy resolver도 `shared/*`에 싣지 않는다. active lane은 `content/frame-proxy-helper.js`가 local hosted panel wrapper URL 계산만 맡고, shared root는 browser-agnostic core만 유지한다.
- 현재 `1.x+` extension bundle은 standalone activity/surface/lifecycle/bootstrap/render/shell helper도 활성 manifest에 싣지 않는다. active tool/open/visibility/surface/bootstrap/render bridge는 `content/panel-v2-shell-bridge.js` 한 파일로만 유지하고, `content/panel-v2-composition-controller.js`는 그 bridge wiring만 맡는다.
- prompt shell controller baseline도 lane-aware로 단순화한다. legacy lane과 v2 lane 모두 extra `panelPromptBridgeController` proxy 없이 `backup/legacy-panel/panel-prompt-controller.js` 또는 v2 hosted-owned prompt controller를 shell/render/bootstrap wiring에 직접 넘긴다.
- `1.x+` active lane은 persisted legacy prompt store alias도 오래 끌고 가지 않는다. old `uiPreferences.activeTool === "store"` 값은 `shared/storage.js`에서 즉시 `activeTool: "prompts"` + `activePromptTab: "store"`로 흡수하고, active route/shell은 store를 별도 tool identity로 유지하지 않는다.
- 기본 `npm.cmd run verify`는 활성 v2 lane 기준 검증만 유지하고, `scripts/verify-legacy-isolation.js`로 active manifest/content lane이 `backup/legacy-panel/*`에 다시 기대지 않는지도 함께 고정한다. backup legacy prompt/runtime/view 검증은 `npm.cmd run verify:legacy-backup`으로 분리하고, backup reference verify 스크립트는 active 루트 `scripts/`와 섞지 않고 `scripts/legacy-panel/*` 아래에 모은다. backup reference는 `DB/Functions/shared contract` 변경 때만 다시 확인한다.
- content script bootstrap은 계속 `manifest.json` 로드 순서를 정본으로 삼고, `content/panel.js`가 직접 소비하는 hosted panel bridge/helper preload는 같은 manifest 배열에서 `content/panel.js`보다 먼저 로드해야 한다. 현재 baseline helper는 `content/panel-console-trace.js`, `content/page-capability-router.js`, `content/frame-proxy-helper.js`, `content/hosted-panel-bridge.js`, `content/panel-host-runtime.js`, `content/panel-host-bridge.js`, `content/panel-host-view.js`다.
- `1.x+` active lane의 browser-only page capability 구현은 `content/page-capability-router.js` 한 곳에서만 유지한다. `content/hosted-panel-bridge.js`는 `page/runtime/panel` request dispatch만 맡고, hosted caller는 canonical capability action만 쓴다.
- `1.x+` active lane의 browser-only privileged runtime capability 구현은 `background/panel-runtime-capability-router.js` 한 곳에서만 유지한다. `background/panel-runtime-invoke.js`는 hosted panel runtime request를 router에 dispatch하는 shim만 맡고, generic storage CRUD나 feature별 ad-hoc runtime action은 다시 열지 않는다. hosted meeting workspace open/share/auth/probe browser adapter는 `background/meeting-workspace-capability.js`로 분리하고, background top-level message surface도 `inova-panel:invoke`와 hosted meeting workspace `authorize/probe` bridge만 유지하며, feature별 prompt/store/release/meeting message 이름은 active lane에 다시 열지 않는다.
- `1.x+` active lane의 Functions endpoint family와 lane-aware local/prod runtime resolution은 `background/functions-runtime-config.js` 한 곳으로 모은다. `shared/firebase-config.js`와 `shared/product-lane.js`는 endpoint name/override를 다시 들지 않고, `background/cloud-api-client.js`, `background/panel-session-capability.js`, `background/meeting-workspace-capability.js`가 이 background-only runtime config를 재사용한다.
- 다음 구조 목표는 새 backend action 추가가 extension 재배포로 이어지지 않게 하는 것이다. `background/panel-runtime-capability-router.js`와 `background/functions-runtime-config.js`는 bundled manifest 모델과 trusted Hosting `capability-manifest.json` fetch/cache를 현재 baseline으로 두고, 후속 작업은 `docs/remote-capability-manifest-plan.md` 순서대로 endpoint/runtime config 원격화로 진행한다. 이 작업은 보안 경계 변경이므로 hosted가 raw URL을 background에 넘기는 방식으로 해결하지 않는다.
- remote capability alias, hosted page capability dispatch, remote workflow sandbox shell은 active `npm.cmd run verify` baseline에 포함한다. `scripts/verify-runtime-capability-router.js`는 background manifest alias/artifact 해석을, `scripts/verify-extension-capability-client.js`는 hosted capability client의 page/alias dispatch allowlist를, `scripts/verify-remote-workflow-sandbox.js`는 hosted sandbox iframe/bridge boundary를 고정한다.
- active page primitive catalog도 같은 verify baseline에 포함한다. `scripts/verify-page-capability-router.js`는 `content/page-capability-router.js`의 named primitive 호출, unknown key 거부, raw HTML/script param 거부를 고정한다.
- meeting notes generation guard도 active `npm.cmd run verify` baseline에 포함한다. `scripts/verify-meeting-notes-generation.js`는 자동 회의록이 항목 수를 맞추기 위해 결정/리스크/미결정 사항을 만들지 않는지와, 같은 안건이 다시 등장한 `discussionFlow` 라운드를 같은 heading만으로 제거하지 않는지를 고정한다.
- `1.x+` active lane의 generic tab/open-url browser adapter는 `background/browser-capability.js` 한 곳으로 모은다. service worker나 meeting workspace capability가 `chrome.tabs.create()`와 open-url payload shaping을 각자 다시 구현하지 않는다.
- `1.x+` active lane의 panel auth/access-token/prompt runtime config wrapper는 `background/panel-session-capability.js` 한 곳으로 모은다. service worker가 `getInovaAccessToken`, `issuePromptPanelAuth`, `issueMeetingPanelAuth`, `getPromptFunctionsConfig`, `getPromptRuntimeConfig`를 다시 직접 구현하지 않는다.
- `1.x+` active lane의 meeting workspace target/debug setting normalization도 표면별 임시 helper로 다시 복제하지 않는다. `shared/firebase-config.js`의 `firebaseConfig.meeting.normalizeSettings()`를 정본으로 두고, popup과 background meeting workspace capability가 같은 helper를 재사용한다.
- `content/panel.js`는 hosted panel iframe target을 feature별 helper에서 직접 고르지 않는다. lane/local target 판단은 `shared/firebase-config.js`의 `firebaseConfig.panel.resolveRuntime()`가 맡고, shell host는 그 generic panel runtime만 소비한다.
- `1.x+`에서 `release:build`는 `hosting/extension-v2/releases/*`와 `hosting/extension-v2/downloads/*`를 실제 served artifact 기준으로 채워야 한다. hosted v2 release panel은 이 lane-local 경로를 직접 읽으므로, curated history에 남긴 이전 공개 버전 ZIP도 현재 lane download 디렉터리에서 404 없이 열리도록 함께 복사한다. 같은 build는 current version ZIP의 `artifact` 메타도 `releases/release-notes.json` 현재 버전 엔트리에 즉시 backfill해야 한다.
- 기본 `npm.cmd run verify`와 `node scripts/verify-release-package.js`는 현재 lane의 `hosting/*/releases/latest.json`, `history.json`, `downloads/latest.zip`, version ZIP들, 그리고 curated `releases/release-notes.json`이 서로 같은 공개 baseline을 가리키는지 함께 검증해야 한다. history/latest에 노출된 공개 버전은 현재 버전까지 포함해 curated notes에도 반드시 artifact 메타가 있어야 한다.
- `1.x+` v2 lane은 hosted-first를 기본값으로 쓴다. 탭 UI/state/action flow의 기본 위치는 hosted이고, extension은 page DOM adapter + iframe host + runtime broker 같은 browser-only capability를 유지한다.
- `DB/Functions 계약을 바꾸지 않는 순수 panel v2 migration`은 현재 `1.x+` bundle이 정상 동작하는지만 먼저 확인한다. 이런 작업에서 legacy extension panel 코드는 활성 bundle 안에 계속 보존할 대상으로 보지 않는다.
- 현재 `1.x+` 활성 bundle과 공유 계약이 더 이상 쓰지 않는 legacy extension panel 코드는 `content/*` 안에 섞어 두지 않는다. 기본 정리 방향은 `backup/legacy-panel/*`로 격리해 참고본으로만 남기거나, 더 이상 필요 없으면 삭제하는 것이다.
- `backup/legacy-panel/*`는 평소 panel migration 경로가 아니라 `0.4.4` 영향 판단용 보관소다. `DB/Functions`나 shared server contract를 손댈 때만 backup legacy와 비교해 기존 사용자 영향이 없는지 확인한다.
- 문서가 이 ownership 이동을 뒤따르지 못하면, 발견한 같은 작업 안에서 바로 고친다.
- v2 lane이라고 해서 모든 backend endpoint family를 바로 분리하지 않는다. 현재 backend 분리가 준비된 것은 prompt-library 계열뿐이고, meeting Functions endpoint는 `1.0.0` v2 lane에서도 legacy 이름(`listInovaMeetings`, `issueInovaMeetingPanelAuth` 등)을 계속 사용한다. 이 상태는 server-side compat baseline으로 기록하되, 그 자체만으로 `1.0.0 done` blocker로 보지는 않는다.
- local rehearsal에서 hosted panel 기본 경로는 `http://127.0.0.1:5000/extension/panel/index.html`이다.
- local rehearsal에서 `1.x+` v2 lane hosted panel 기본 경로는 `http://127.0.0.1:5000/extension-v2/panel/index.html`이다.
- local rehearsal에서 page DOM에 삽입되는 hosted panel/meeting bridge/prompt bridge iframe src는 direct loopback URL이 아니라 extension `content/frame-proxy.html?target=...` wrapper를 사용한다. 실제 target URL baseline은 계속 `127.0.0.1:5000/*`로 유지하고, manifest는 이 proxy page와 extension frame-src allowlist를 함께 유지한다.
- local 작업 산출물 정리는 `prepare`로 설치되는 `.githooks/pre-commit`가 맡는다. 현재 baseline은 `scripts/cleanup-local-artifacts.js`이며, root `*.log`, `tmp-emulators-*.log`, `.codex-local`, `.codex-logs`, `.codex-temp`의 로그, `.playwright-cli`, `.playwright-mcp`의 `page-*.yml`, `output/*` 임시 산출물을 지우고 빈 폴더는 함께 제거한다. 실행 중 프로세스가 잡고 있는 로그는 skip한다.
- prompt bridge 자산 경로는 현재 temporary compat baseline으로 lane-stable 규칙을 따른다. `1.x+` v2 lane이어도 `panelAppUrl`만 `extension-v2/panel/*`로 이동하고, hidden prompt bridge target은 production/local 모두 계속 `extension/prompt-panel-bridge.html`을 사용한다. 이 경로 rename/delete 여부는 future hosting cleanup 문제로 보고, 그 자체만으로 `1.0.0 done` blocker로 보지는 않는다.
- `1.x+` v2 lane의 prompt-library read baseline은 `auth.issue-panel-session(panel=prompt) -> Firestore custom token sign-in -> integration_inova_accounts_v2.promptLibraryMeta onSnapshot -> prompt_library_orders_v2/prompt_library_chunks_v2 direct read`다. hosted v2 `내 요청` 목록 read를 다시 `loadInovaPromptLibraryV2` Functions fetch baseline으로 되돌리지 않는다.
- local rehearsal에서도 같은 baseline을 유지한다. prompt panel auth는 local Functions base URL을 향하고, hosted v2 panel은 local Auth/Firestore emulator에 붙어 `integration_inova_accounts_v2`, `prompt_library_orders_v2`, `prompt_library_chunks_v2`를 직접 읽을 수 있어야 한다.
- hosted panel 자산이 더 최신이어도 extension bridge capability가 부족하면 조용히 깨지지 않고 explicit update-needed 상태를 보여줘야 한다.

### Hosted origin/path

- hosted workspace: `https://browser-extension-main.web.app/meeting/index.html`
- hosted panel bridge: `https://browser-extension-main.web.app/meeting/panel-bridge.html`
- legacy path는 `0.4.4` 지원이 끝나기 전까지 rename/delete 하지 않는다. 나중 cleanup이 필요하면 server-side 일정으로 정리하고, `1.0.0 done` 기준은 그 정리에 extension follow-up 배포가 필요한지 여부로만 판단한다.

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
