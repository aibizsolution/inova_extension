# Current Handoff

Last updated: 2026-04-16

## Snapshot

- Public deployed baseline: `0.4.4`
- Current local candidate: `1.0.0`
- Active branch: `codex/hosted-first-extra-reduction`
- Latest full validation: `npm.cmd run verify` passed on `codex/hosted-first-extra-reduction` after the hosted-first state reduction, Firestore session/base reader commonization, prompt-store shared model extraction, open hydration guard, and shared text-normalization cleanup.
- Remaining work: Chrome smoke / release-go validation plus the hosted-first cleanup backlog captured below
- Worktree: expected clean after the current documentation correction commit
- Current architecture direction:
- `1.0.0` v2 lane is explicitly hosted-first.
- default location for tab UI, view state, action flow, and feature-local controllers is `hosting/*`.
- `extension` keeps only browser-only capabilities: iframe host, page DOM adapter, `postMessage`/runtime broker, popup/settings, content/background wiring.
- when docs still describe already-moved ownership as extension-owned, fix them in the same task instead of deferring to a later doc sweep.
- for remaining migration slices, treat legacy extension implementations as reference behavior, not code that must be preserved line-for-line.
- if reusing legacy code adds glue/adapters/mixed ownership, prefer a clean implementation in the target hosted ownership instead.
- pure panel v2 migration that does not change `DB/Functions` contracts should be judged against the current `1.0.0` v2 bundle, not against keeping legacy extension panel code alive in the active bundle.
- legacy extension panel code that is no longer in the active bundle should be isolated into `backup/legacy-panel/*` or removed, instead of staying interleaved under active `content/*` paths.
- isolated legacy panel code is now a `0.4.4 impact check` reference only. consult it when `DB/Functions` or shared server contracts change; do not use it as the default implementation target for pure panel migration.

## Where Ownership Stands

- `conversation`: hosted owns list/search/copy/jump UI state; extension only provides page adapter plus thin count/fingerprint snapshot signals.
- `release`: hosted owns latest/history/download surface and release count/view state; extension only keeps browser/runtime broker capability.
- `prompt-library`, `prompt-store`, `prompt-review`: hosted owns prompt/store/review UI and action routing; extension keeps page/runtime bridge, composer review float, review-trigger handoff, provider-identity persistence, and stable browser capability APIs. The prompt tab/review handoff residue has been reduced; the remaining prompt-adjacent shell residue is now mostly panel snapshot assembly.
- `meeting hub` / `meeting workspace`: hosted owns list/action UI, Firestore meeting-list subscription, and launch tracing; v2 hosted panel no longer falls back to top-panel `meeting-action` dispatch. The meeting reader now shares hosted panel auth/session and base Firestore subscription lifecycle with prompt readers, while keeping meeting-specific collection/query/snapshot logic local.

Short version:

- `hosting` is now the visible v2 app surface.
- `extension` is being reduced to the thin browser/page shell.

## 2026-04-15 Reviewer Findings To Carry Forward

Two separate reviews were merged into this handoff. They are related but not the same problem.

### Review 1: hosted/direct-read/commonization audit

What is already directionally correct:

- hosted panel owns the visible tab UI, hosted feature controllers, Firestore reads, and short action feedback.
- extension/content is mostly down to Chrome/browser-only duties: iframe host, postMessage bridge, page DOM adapter, local browser sensors, popup settings, background runtime broker.
- `content/features/conversation`, `content/features/meeting`, `content/features/prompt-library`, `content/features/prompt-store`, and `content/features/release` are documentation-only directories in the active lane; they are not active feature runtimes.
- prompt store list read has moved toward hosted Firestore direct subscription instead of Functions list fetch; side-effect actions still belong behind Functions/runtime capability.
- hosted Firestore auth/app/db bootstrap is now centralized in `hosting/extension-v2/panel/panel-firestore-session-client.js`, with meeting, prompt-library, and prompt-store readers expected to reuse one hosted panel auth session.

Valid remaining issues from Review 1:

- `content/features/prompt-review/*` is still active page DOM UI. This is not a simple hosted move because the floating button is anchored to the composer DOM, uses document body/focus/input/scroll behavior, and must survive page layout changes. Treat it as a separate hosted-overlay design, not a quick cleanup.
- Firestore auth/session and reader lifecycle are now shared by the active hosted readers. The remaining risk is behavioral: Chrome smoke should confirm tab switches reuse one hosted auth session and that each feature keeps only collection/query/snapshot-specific logic.
- `prompt-store` normalization/scoring/sorting/filtering now uses hosted/functions deploy-root copies of the same `prompt-store-model.js`; keep `scripts/verify-prompt-store-model.js` as the guard against drift.
- common hosted reader helpers are centralized in `panel-utils.js`; remaining controller-local helpers should only be extracted when they repeat across active hosted modules.
- Firestore collection names now resolve through `shared/firestore-collections.js`. Keep the guard that prevents collection names from drifting back into multiple shared config surfaces.

### Review 2: extension parallel state-machine audit

What the review found:

- `content/panel-v2-composition-controller.js` still builds a broad extension-side state object. Some fields are browser-only and valid, but hosted-owned view state is still mixed in.
- `content/panel-v2-shell-bridge.js` still duplicates panel snapshot assembly that hosted should continue reducing. Active tool/tab write persistence, the independent `state.activeTool` mirror, the global `state.open`/`state.preferredOpen` mirrors, extension-side handle count calculation, hosted close/Escape open calculation, external handle open calculation, and separate `panelTrace` shaping have been removed from content; the top snapshot now sends raw `uiPreferences` and hosted/trace helpers derive from the incoming snapshot.
- `content/panel-v2-prompt-controller.js` no longer opens prompt/review tabs from the composer review float. It now emits only the monotonic hosted review handoff signal.
- Hosted close/Escape and external handle click no longer need the old hosted/content toggle calculation cycle. Hosted review consumes Escape first, and external handle clicks are sent only as panel events; hosted updates local panel-open state and sends parent DOM visibility through `panel-chrome-sync`. Content keeps only a private lifecycle adapter for initial sessionStorage seeding and parent DOM application; hosted accepts content snapshot `open` only for the first hydration.
- Conversation count/fingerprint signals are intentionally compact, but the current bridge still constructs some view-shaped snapshots rather than sending the smallest raw page/capability facts.

Valid remaining issues from Review 2:

- The previous "actual move candidate: none" audit was too broad. Active extension JS may be browser-only at the file level, but some code inside those files still owns hosted-level view state and should be reduced.
- `content/panel-v2-composition-controller.js` should keep route/session/page sensors, provider identity sync, bookmarks residue, observer state, iframe bridge wiring, and page capability handoff.
- It should not keep tool summary view models or panel open preference as independent extension state. The canonical active tool is no longer mirrored as `state.activeTool` or sent as a prebuilt top snapshot field. Global `state.open` and `state.preferredOpen` are gone; content keeps only a private sessionStorage-backed lifecycle adapter value for initial snapshot seeding and parent DOM application. Handle count and hosted close/Escape/external-handle open state are now computed by hosted and synced back through `panel-chrome-sync`; hosted no longer accepts later content snapshot `open` values after initial hydration.
- The next cleanup should reduce extension payloads to raw facts: surface visibility, route/session identity, conversation count/fingerprint, composer capability, provider identity cache, and browser capability readiness.

### Combined work order

1. Stabilize the current Firestore session/direct-read slice first. Keep one hosted panel auth/session path for meeting, prompt-library, and prompt-store. Verify that switching tabs logs auth reuse, not repeated panel auth issuance.
2. Extract small panel utilities only where they are already repeated by active hosted panel readers/controllers. Do not move browser-only helpers into shared modules just to make file counts smaller.
3. Factor hosted Firestore reader lifecycle after auth/session reuse is stable. Feature clients should keep only collection/query and snapshot normalization.
4. Centralize Firestore collection constants after the reader lifecycle is stable, so `firebase-config` and `product-lane` do not drift.
5. Prompt-store normalization/scoring/filtering now uses deploy-root copies of the same `prompt-store-model.js`, with byte-for-byte parity verified by `scripts/verify-prompt-store-model.js`.
6. Shrink `panel-v2-composition-controller` and `panel-v2-shell-bridge` in a dedicated bridge-contract slice. Hosted now owns active tool derivation, handle count calculation, and close/Escape/external-handle panel-open state; remaining work is panel snapshot assembly.
7. Keep composer review float in content for now, but change it toward an event/anchor emitter only. Moving the visual float into hosted is a separate design task because it crosses iframe/page DOM boundaries.

Do not do in the same slice:

- Do not move page DOM sensors, route watchers, provider identity localStorage reads, iframe host, postMessage bridge, or background privileged runtime broker into hosted.
- Do not hide backend/rules/schema mismatch with frontend fallback.
- Do not treat documentation-only `content/features/*/AGENTS.md` folders as active runtime issues.
- Commit at green verification boundaries when the user explicitly asks to continue/commit; otherwise keep commit boundaries user-controlled.

Current progress in this slice:

- Step 1 is implemented in code through `panel-firestore-session-client.js` and guarded by hosted-panel verification.
- Step 2 is implemented for active hosted controllers/readers through hosted-local `panel-utils.js`; meeting, prompt-library, prompt-store, prompt-review, release, conversation, index, and the shared Firestore session coordinator now reuse the same hosted panel helper contract for common text normalization and related utilities.
- Step 3 is implemented with hosted-local `base-firestore-client.js`; meeting, prompt-library, and prompt-store now share subscribe/disconnect/cache/first-snapshot/publish/error lifecycle and keep feature-specific query/snapshot logic in their own files.
- Feature Firestore clients no longer keep dead SDK/app/auth/db/persistence state after the shared session coordinator took ownership; the hosted-panel guard now fails if that state is reintroduced.
- The shared v2 composition state no longer keeps a `promptReview` view bucket. Content prompt review now keeps only a private monotonic handoff request signal for hosted review activation.
- The v2 composition state also dropped unused hosted-owned/dead residue: `activeId`, `panelDebugUi`, and `feedbackTimer`. `scripts/verify-panel-v2-composition.js` now guards against reintroducing those fields.
- The v2 composer review float handoff no longer mutates `state.open`, `state.activeTool`, `activePromptTab`, or UI preference persistence in content. It only increments the hosted external review `requestId`; hosted prompt controllers own tab activation and preference writes.
- Hosted Escape handling now lets the hosted prompt review controller consume review dismiss first; when not consumed, hosted closes through hosted-owned panel-open state and `panel-chrome-sync`. The old content `escape` panel action and prompt-shell `handleEscape` callback are no longer part of the active v2 bridge surface.
- The old extension-side active tool/tab persistence lock path (`persistActiveTool`, `lockUiPreferenceSelection`, `applyUiPreferenceLock`, `uiPreferenceLock`) is removed from the active v2 shell. Tool/tab writes now stay on the hosted `storage.write-ui-preferences` path; content route state only normalizes storage snapshots.
- Content prompt snapshot residue now carries only the external review `requestId` signal. Prompt library/store counts are no longer mirrored as `promptCount` / `promptToolCount`; hosted prompt controllers compute visible prompt/store counts inside the iframe.
- Active tool normalization is no longer exported from `panel-v2-shell-bridge`, and active v2 composition state no longer keeps a separate `state.activeTool` mirror. Route state keeps only normalized `uiPreferences`; shell render sends those preferences in the bridge snapshot, and hosted `normalizePanelSnapshot` derives `activeTool` before controller sync/render.
- Handle position saves now persist only `handleRatios`; they no longer include a potentially stale content-side `activeTool` value. Active tool writes stay on the hosted `storage.write-ui-preferences` path.
- Extension shell render no longer calculates or sends `handleCount`. Hosted computes the effective active-tool count and hosted close/Escape/external-handle open state during render, then sends both back to the top host through `panel-chrome-sync`; content only applies the values to the external handle/container DOM.
- Extension shell render no longer duplicates `open`, `settings`, or `visible` as top-level render payload fields. The host runtime now derives those adapter values from the raw `panelSnapshot` only.
- Hosted panel accepts content snapshot `open` only as the initial hydration seed. After hosted `panelOpen` is hydrated, later content snapshots cannot override hosted-owned open state; hosted continues syncing parent DOM open/visible through `panel-chrome-sync`.
- Extension shell render no longer sends the content-only `settingsHydrated` render gate inside `panelSnapshot`; content still uses it locally to avoid rendering before route/settings hydration.
- Content host runtime now also reads `open`, `visible`, and `settings` from `panelSnapshot` only; the old top-level render payload fallback is removed from the active v2 host path.
- Top-panel snapshot trace payloads now also read `open` and `visible` from `panelSnapshot` only; removed top-level render payload fields are no longer accepted as trace fallback inputs.
- Content host runtime no longer reads top-level `handleCount` from render payloads; hosted-owned counts reach the parent DOM only through `panel-chrome-sync`.
- Active v2 composition state no longer carries `open`; route reset and surface restore call the private lifecycle adapter instead of mutating shared hosted-level open state.
- Step 4 has started with `shared/firestore-collections.js`; `shared/product-lane.js` and `shared/firebase-config.js` now consume the same browser-agnostic collection catalog instead of repeating prompt collection names.

## What Was Stabilized In This Session

- prompt review handoff no longer gets stuck in hosted `pending` after a successful external review result
- prompt review copy now delegates through top-page `clipboard.write-text` instead of iframe-local clipboard access
- active page adapter contract now uses canonical capability-shaped actions (`conversation.read-state`, `conversation.jump-item`, `composer.read-state`, `composer.apply-text`, `clipboard.write-text`, `debug.*`, `trace.log`) so hosted feature work can change without extension-side feature rewrites, and active alias shims are no longer left behind after the caller slice moves
- active page/runtime capability catalog is now expected to live in `contracts/extension-contract.json` + `scripts/verify-contracts.js`, so future hosted work has to reuse the declared browser capability API before it can add new extension surface
- active extension browser-only power owners are now expected to live behind `contracts/extension-contract.json` + `scripts/verify-browser-only-boundary.js`, so direct `fetch`, `chrome.tabs`, `chrome.cookies`, `chrome.storage`, `localStorage`, `sessionStorage`, Firebase SDK bootstrap, and raw Functions endpoint-family strings cannot quietly spread back into thin `content/popup/shared` shell files
- Functions endpoint family와 lane-specific endpoint override도 이제 active shared root를 떠나 `background/functions-runtime-config.js`가 소유한다. `shared/firebase-config.js` / `shared/product-lane.js`는 browser-agnostic panel/hosting/storage lane config만 유지하고, Firestore collection names는 `shared/firestore-collections.js`가 소유한다. background runtime modules가 같은 Functions runtime config를 재사용한다
- active hosted v2 feature controller/Firestore client now route page/runtime transport through `hosting/extension-v2/panel/extension-capability-client.js`, so raw capability action strings stay isolated in one hosted adapter instead of leaking across feature files
- active extension page adapter now routes `conversation/composer/clipboard/debug/trace` capability handling through `content/page-capability-router.js`, so DOM/clipboard/debug browser power also stays isolated in one extension adapter instead of leaking through the bridge shell
- active extension runtime broker now routes hosted panel privileged capability handling through `background/panel-runtime-capability-router.js`, so auth/functions/open-url/storage snapshot logic also stays isolated in one browser-only adapter instead of leaking through the invoke shim
- active `background/service-worker.js` no longer keeps feature-specific top-level prompt/store/release/meeting message branches; the live background message surface is now limited to `inova-panel:invoke` plus hosted meeting workspace `authorize/probe` bridge messages
- hosted meeting workspace browser capability implementation now lives in `background/meeting-workspace-capability.js`; `background/service-worker.js` keeps top-level gate + shared runtime wiring only
- popup과 background meeting workspace capability는 이제 `shared/firebase-config.js`의 shared meeting setting normalization을 같이 재사용한다
- background meeting workspace capability도 이제 `shared/provider-identity-cache.js`의 provider identity normalizer를 재사용한다
- generic `browser.open-url` 탭 열기 구현은 이제 `background/browser-capability.js`에 모이고, service worker와 meeting workspace capability가 같은 browser adapter를 재사용한다
- panel auth/access-token/prompt runtime config wrapper도 이제 `background/panel-session-capability.js`에 모이고, service worker는 top-level gate + helper wiring만 유지한다
- background-only auth/cloud helper도 이제 active shared root를 떠나 `background/inova-auth-client.js`, `background/cloud-api-client.js`에 있고, active `shared/*`는 browser-agnostic cache/state/config core만 유지한다
- active background root inventory도 이제 `browser-capability / cloud-api-client / functions-runtime-config / inova-auth-client / meeting-workspace-capability / panel-auth-cache / panel-runtime-capability-router / panel-runtime-invoke / panel-session-capability / service-worker` 열 파일로 고정했고, `contracts/extension-contract.json` + `scripts/verify-contracts.js`가 그 경계를 같이 잠근다
- active shared root inventory도 이제 `constants / firestore-collections / firebase-config / product-lane / provider-identity-cache / session / storage` 일곱 파일로 고정했고, `contracts/extension-contract.json` + `scripts/verify-contracts.js`가 그 경계를 같이 잠근다
- active content root inventory도 이제 `composer(.js/.css) / dom / provider-identity-sensor / frame-proxy(.html/.js/helper) / page-capability-router / hosted-panel-bridge / panel-console-trace / panel-host-* / panel-v2-* / panel.js / panel.css / route-* / main / meeting-workspace-bridge / prompt-review feature files`로 고정했고, main panel preload + hosted meeting bridge + frame proxy web-accessible resource까지 같은 계약/verify가 같이 잠근다
- active popup root inventory도 이제 `popup/index.html / popup/index.css / popup/index.js`로 고정했고, manifest `default_popup`과 icon/default_icon 자산 매핑도 같은 계약/verify가 같이 잠근다
- manifest browser privilege surface도 이제 `permissions / host_permissions / extension_pages frame-src / meeting workspace match / frame proxy web-accessible match` 기준으로 계약에 고정했고, 새 권한이나 origin 추가는 같은 contract/verify를 함께 갱신하지 않으면 못 들어오게 했다
- browser-only provider identity sensor도 active shared root를 떠나 `content/provider-identity-sensor.js`에 있고, legacy reference만 `backup/legacy-panel/shared/provider-identity.js`에 남긴다
- local hosted panel frame proxy resolver도 active shared root를 떠나 `content/frame-proxy-helper.js`에 있고, active shared root는 browser-agnostic core만 유지한다
- dormant prompt import/export helper도 active shared root를 떠나 `backup/legacy-panel/shared/prompt-library.js`에 있고, active root는 live browser/runtime core만 유지한다
- dormant prompt store normalization helper는 active shared root에 두지 않는다. legacy helper는 `backup/legacy-panel/shared/prompt-store.js`에 있고, active store lane은 hosted/functions deploy root별 `prompt-store-model.js` copy를 byte-for-byte 동일하게 유지하며 `scripts/verify-prompt-store-model.js`가 이를 검증한다
- active `shared/storage.js` no longer carries dormant release/meeting accessor surface; those backup-only helpers now live under `backup/legacy-panel/shared/legacy-storage-accessors.js`
- active `shared/constants.js` also no longer carries dormant release/meeting storage key/default contract; backup legacy helpers now own those fallback schema literals directly
- active `shared/constants.js` / `shared/storage.js` no longer carry dormant `promptLibrary` local storage schema either; backup prompt storage/reference helpers now own that cache contract directly
- prompt review runtime now surfaces `page.functions.review.*` / `prompt.review.request.*` traces in the top console and fails explicit timeout after `30s` instead of hanging forever
- top console trace visibility was restored for hosted `meeting panel-auth`, `Firestore listen/snapshot`, conversation snapshot reads, release fetches, and prompt review function calls
- panel layout now uses a fixed `420px` width with a `70px` left rail for the active v2 surface
- prompt scope buttons, meeting CTA alignment/dividers, bookmark spacing/copy icon alignment, and release tab section layout were visually normalized around the fixed-width panel shell
- panel chrome ownership (`tool rail`, `tool title`, `tool count`) moved out of extension
- release snapshot trimmed to hosted-owned signals
- conversation snapshot trimmed to hosted-owned count/fingerprint signals
- prompt snapshot trimmed to hosted-owned signals
- meeting list state moved into hosted hub controller
- meeting actions (`open-workspace`, `open-result`, `share`, `revoke-share`) moved into hosted hub controller
- v2 hosted meeting panel no longer falls back to extension-side `meeting-action` dispatch
- v2 meeting snapshot summary no longer depends on `backup/legacy-panel/meeting-manager.js` merge helpers
- `content/panel.js` keeps shrinking toward generic host + broker by delegating shell-level hosted requests to helper modules
- `content/panel.js` now delegates page adapter requests to a helper too, leaving runtime/page brokering as its main remaining responsibility
- `content/panel.js` now delegates runtime broker requests too, leaving mostly host/bridge routing responsibilities
- `content/panel.js` now delegates bridge-domain request routing too, leaving the file close to a pure iframe host + bridge endpoint
- v2 bootstrap now passes only the hosted panel callbacks that are still live in the hosted lane, instead of carrying prompt/meeting legacy action callbacks by default
- v2 composition now wires the hosted-owned prompt controller directly instead of keeping the extra `panelPromptBridgeController` proxy in the v2 lane
- current `1.0.0` manifest no longer loads the legacy prompt runtime bundle; v2 prompt shell now keeps only `content/panel-v2-prompt-controller.js` for minimal review handoff/composer review float
- current `1.0.0` extension bundle now boots `content/panel-v2-composition-controller.js` directly and stops loading the legacy panel composition/meeting/action lane in `manifest.json`
- current `1.0.0` manifest no longer loads the legacy release runtime/helper bundle; release summary/count state stays inside hosted v2 instead of `content/release-manager.js` or extension summary echo
- current `1.0.0` manifest no longer loads the legacy content bookmark view/style bundle; hosted bookmark view owns the visible conversation UI and `content` keeps only the compact snapshot bridge plus canonical page adapters
- current `1.0.0` manifest no longer loads `content/panel-bookmark-controller.js`; the active conversation bridge now lives inline in `content/panel-v2-composition-controller.js` and the old controller sits under `backup/legacy-panel/*`
- current `1.0.0` manifest no longer loads `content/panel-runtime-controller.js` or `content/panel-debug-controller.js`; active runtime/debug helpers now live inline in `content/panel-v2-composition-controller.js`
- current `1.0.0` manifest no longer loads `content/panel-state-factory.js` or `content/provider-identity-sync.js`; active state initialization and panel-local provider identity sync now live inline in `content/panel-v2-composition-controller.js`
- current `1.0.0` manifest no longer loads `content/panel-activity-controller.js`, `content/panel-surface-controller.js`, `content/panel-lifecycle-controller.js`, `content/panel-bootstrap-controller.js`, or `content/panel-shell-controller.js`; active shell tool/open/visibility/surface/bootstrap/render helpers now live in `content/panel-v2-shell-bridge.js`, and `content/panel-v2-composition-controller.js` only wires that bridge into the active v2 graph
- meeting open traces split correctly:
  - original `i-Nova` tab now logs only launch request/dispatch/completion
  - new hosted workspace tab owns workspace bootstrap/ready logs
- v2 meeting lifecycle coupling reduced across sync, snapshot, fallback, and bootstrap wiring
- v2 meeting summary residue is now count-only, and hosted meeting hub no longer uses top-panel fingerprint echo for reload decisions
- hosted meeting hub now treats top-panel `meeting` summary as outbound rail-count sync only; hosted count/state no longer re-hydrates from the echoed panel snapshot
- hosted meeting count now stays `0` until hosted realtime data arrives; active hosted render no longer borrows `panelState.meetingTool` count even as a temporary bootstrap seed
- active v2 createState no longer carries dead `meetingHub` / `meetingUi` buckets or the interim `toolSummaries` bucket; hosted meeting/release counts stay inside hosted controllers
- compact hosted `meeting` / `release` summaries no longer round-trip through extension `tool-summary-sync`; hosted render computes effective counts and syncs only parent chrome via `panel-chrome-sync`
- v2 composition no longer normalizes meeting/release residue through extension helper callbacks; meeting/release snapshot state is not part of the content render payload
- v2 shell/render no longer reads compact `meeting` / `release` state through tool-summary callbacks
- hosted release refresh/download actions no longer fall back to top-panel `release-action`; active v2 release actions now stay inside the hosted controller and only use runtime invoke for browser open-url
- `content/panel.js` no longer picks meeting/prompt runtime helpers directly; panel iframe target now resolves through shared `firebaseConfig.panel` runtime config
- `content/panel.js` no longer clones the full render payload into hosted bridge snapshots; v2 render now passes a prebuilt `panelSnapshot` and the host just brokers view + bridge envelope
- top-panel snapshot trace shaping now comes from raw panel snapshot fields in `panel-console-trace`; `content/panel-v2-shell-bridge.js` no longer builds a separate `panelTrace` payload, and `content/panel.js` no longer reads prompt review detail directly out of hosted tool state
- top console trace policy/summary formatting now lives in `content/panel-console-trace.js`; `content/panel.js` no longer carries feature-specific always-trace rules inline
- hosted panel iframe target/status/handshake/render batching now lives in `content/panel-host-runtime.js`; hosted bridge endpoint/page event emit now lives in `content/panel-host-bridge.js`; host markup/handle drag-click now lives in `content/panel-host-view.js`; `content/panel.js` keeps host element lifecycle + helper wiring only
- active hosted tool rail selection now persists `activeTool` through `storage.write-ui-preferences` instead of the old `panel/select-tool` fallback; `prompts` still pins `activePromptTab: library`
- active conversation bridge in `content/panel-v2-composition-controller.js` now keeps count/fingerprint residue only; query/filter/copy/jump view-model logic no longer lives in extension
- active `content/hosted-panel-bridge.js` no longer carries inactive legacy `meeting-action`, `release-action`, prompt action, conversation bookmark, tool-selection/search, separate `escape`, `tool-summary-sync`, or `toggle-panel` request paths; the live v2 panel request surface is now `panel-chrome-sync`, runtime, and page only
- backup legacy reference verify scripts now live under `scripts/legacy-panel/*` instead of the active root `scripts/` namespace
- active v2 prompt shell no longer keeps hosted-owned prompt store-load/storage/sync sidecars; extension prompt residue is now review float plus review handoff/persistence only
- active v2 prompt review no longer mirrors result/error/open/pending state through the top snapshot; extension now sends only a monotonic external `requestId` signal and hosted review owns the request lifecycle plus escape dismiss
- active `shared/storage.js` / `shared/provider-identity-cache.js` no longer carry dormant prompt-library CRUD/sync operation helpers; those backup-only prompt helpers now live under `backup/legacy-panel/shared/*`
- active hosted runtime broker no longer exposes generic storage read/write mutation to the v2 panel; the live runtime contract now converges on `storage.read-panel-state`, `storage.write-ui-preferences`, `auth.issue-panel-session`, `functions.invoke-endpoint`, `browser.open-url`, and `meeting.*` capability actions only
- active v2 shell now keeps generic `prompts/store` tool selection in `panel-v2-shell-bridge`; `panel-v2-prompt-controller.js` no longer intercepts normal prompt/store tool picks
- active v2 prompt snapshot no longer mirrors hosted prompt activeTab/search state back into extension state
- active v2 prompt state factory and route hydration no longer mirror hosted-owned prompt library/store/editor buckets inside extension state
- active v2 prompt shell/render/bootstrap wiring now uses `promptShellController`; the legacy `panelPromptController` contract name is no longer part of the live v2 lane
- active v2 route/shell no longer keeps legacy `activeTool: store`; old stored values normalize immediately to `activeTool: prompts` plus `activePromptTab: store`
- active hosted prompt shell now renders only through `prompt-tool-view.js`; the dead `prompt-hub-view.js` fallback is no longer loaded in the v2 panel bundle
- active hosted prompt shell interaction helper now uses `prompt-tool-panel.js`; legacy `prompt-hub-panel.js` naming stays in legacy lanes only
- active hosted prompt tool shell no longer carries `review/store` next-stage placeholder fallback; review/store tabs now read hosted controller state directly
- active hosted v2 panel no longer loads `legacy-panel.css`; the live bookmark/empty/header styling now sits with the active hosted shell styles instead of a dead panel-shell stylesheet
- active hosted v2 panel now loads a single `index.css`; live tool rail/prompt/store/meeting/release shell styling no longer depends on `legacy-tools.css`
- inactive meeting shared/runtime reference now lives under `backup/legacy-panel/shared/*` and `scripts/legacy-panel/*`, instead of mixed into the active root `shared/` and `scripts/` lane
- release path verify now checks lane-local `latest.json`, `history.json`, `downloads/latest.zip`, version ZIPs, and `releases/release-notes.json` curated 목록 coherence together
- release build/verify now also treat current public version artifact as curated metadata, so a version exposed in lane-local `latest.json` / `history.json` must carry matching `artifact` metadata in `releases/release-notes.json` too
- default `verify` now runs an explicit legacy-isolation guard so backup legacy paths stay out of the active manifest/content lane
- the same legacy-isolation guard now also keeps active hosted v2 entry assets and the live top-panel bridge request surface from reopening dead legacy CSS/script/action fallbacks
- hosted-first ownership and incremental doc-correction rules were written into root/docs guidance

## Recent High-Signal Commits

- `7671df0` Restore hosted panel trace visibility
- `7e6e115` Stabilize prompt review handoff
- `694e148` Align release panel with hosted tool layout
- `72d89d0` Tune hosted panel layout spacing
- `5ca2dd4` Document hosted-first ownership and doc upkeep rules
- `0b81aa0` Trim v2 meeting bootstrap sync wiring
- `db73fb3` Lazy-load v2 meeting fallback controller
- `bdb0e3d` Trim v2 meeting snapshot render dependencies
- `a1cef3e` Limit v2 meeting sync to core panel lifecycle
- `44c9538` Decouple v2 meeting shell lifecycle from meeting manager
- `7d6fe67` Move v2 meeting actions into hosted hub controller
- `29a407d` Move v2 meeting list state into hosted controller
- `b672e13` Trim v2 prompt snapshot to hosted-owned signals
- `725f518` Trim v2 conversation snapshot to hosted-owned signals
- `f1f19ed` Trim v2 release snapshot down to hosted-owned state
- `532d525` Move hosted panel chrome ownership out of extension
- `49cbec3` Split meeting launch and workspace traces
- `98248c7` Defer panel render until settings hydrate
- `d310db4` Clarify guard messages around responsibility splits

## Current Known State

### Good

- `npm.cmd run verify` is green with the panel shell controller guard included in the default verify chain.
- hosted panel Firestore auth/session commonization has a concrete implementation path through `panel-firestore-session-client.js`.
- prompt store list read is on the intended hosted Firestore direct-read path instead of forcing a Functions list fetch.
- new extension-side cleanup tasks are now identified and tracked in `2026-04-15 Reviewer Findings To Carry Forward`.
- current `1.0.0` lane also passes `npm.cmd run release:build`; lane-local `hosting/extension-v2/releases/latest.json`, `history.json`, `downloads/latest.zip`, version ZIP, and curated `releases/release-notes.json` artifact metadata regenerate together without verify drift.
- top console now shows the real active v2 read paths again:
  - `conversation`: `hosted.conversation.snapshot.*`
  - `meeting`: `hosted.panel-auth.*` + `hosted.firestore.*`
  - `prompt review`: `page.functions.review.*` + `prompt.review.request.*`
  - `release`: `hosted.release.fetch.*`
- local prompt review succeeds end-to-end again:
  - external review request returns
  - hosted review tab requests and owns the result
  - copy-reviewed-prompt succeeds through the top-page adapter
- `open-workspace` / `open-result` top-panel traces now close cleanly with launch-requested/launch-dispatched/completed semantics.
- conversation jump over-trigger is not currently confirmed; after click instrumentation, repeated jumps matched repeated user clicks rather than proven single-click duplication.
- docs now explicitly state hosted-first ownership and the rule to keep correcting stale ownership docs as they are encountered.

### Important nuance

`meeting` is hosted on the panel/workspace side, but backend endpoint naming is still legacy.

That means:

- v2 panel UI/controller is hosted
- but meeting Functions endpoints still use legacy exports like:
  - `listInovaMeetings`
  - `issueInovaMeetingPanelAuth`
  - `createInovaMeetingShareLink`

Do not rename meeting endpoints to `...V2` unless backend exports are added first.

Also:

- residual `top.panel.snapshot.push` noise still exists, but it is not the current migration blocker
- `hosted.firestore.listen.start` and `hosted.firestore.snapshot` are expected per active reader; the target problem is repeated panel auth/session issuance, not the existence of per-feature subscriptions
- `conversation` jump duplication should only be revisited if a single user click clearly produces multiple jump requests in the trace
- local Auth Emulator warning banners/messages may still appear; treat them as non-blocking local warning noise unless they are tied to a real capability failure

## Final Active JS Audit

Audit date:

- `2026-04-15`

Audit sources and guards:

- `manifest.json`
- `contracts/extension-contract.json`
- `scripts/verify-contracts.js`
- `scripts/verify-browser-only-boundary.js`
- `scripts/verify-legacy-isolation.js`

Classification summary:

- `browser-only owner`
  - page DOM/composer access: `content/dom.js`, `content/composer.js`, `content/page-capability-router.js`
  - iframe host and bridge/runtime wiring: `content/hosted-panel-bridge.js`, `content/panel-host-runtime.js`, `content/panel-host-bridge.js`, `content/panel-host-view.js`, `content/panel.js`
  - page/browser sensors and storage: `content/provider-identity-sensor.js`, `content/frame-proxy-helper.js`, `shared/storage.js`
  - background privileged adapters: `background/browser-capability.js`, `background/panel-runtime-capability-router.js`, `background/panel-session-capability.js`, `background/meeting-workspace-capability.js`, `background/cloud-api-client.js`, `background/inova-auth-client.js`, `background/functions-runtime-config.js`
  - popup/settings and browser target selection: `popup/index.js`, `shared/firebase-config.js`, `shared/firestore-collections.js`, `shared/product-lane.js`, `shared/session.js`, `shared/provider-identity-cache.js`, `shared/constants.js`
- `browser-only glue/composition`
  - active shell/bootstrap wiring: `content/main.js`, `content/panel-v2-composition-controller.js`, `content/panel-v2-shell-bridge.js`, `content/panel-v2-prompt-controller.js`
  - route/panel lifecycle glue: `content/route-state-controller.js`, `content/route-watch-controller.js`, `content/route-sync.js`, `content/panel-console-trace.js`
  - prompt review page handoff glue: `content/features/prompt-review/composer-review-float.js`, `content/features/prompt-review/prompt-review-manager.js`
- `active cleanup candidate`
  - hosted-level state residue inside `content/panel-v2-composition-controller.js`
  - hosted-level shell decision residue inside `content/panel-v2-shell-bridge.js`

Audit conclusion:

- active manifest JS is now either browser-only owner code or thin extension glue/composition
- file count alone is not a reason to move code; the relevant test is whether a specific block owns DOM, Chrome API, `postMessage`, runtime broker, popup/settings, or local browser cache responsibility
- the 2026-04-15 review found that some active glue files still contain hosted-owned decisions even though the files also contain valid browser-only wiring
- `content/panel-v2-prompt-controller.js` is no longer a tab/open cleanup candidate; it only wires the composer review float to a hosted review `requestId` signal.
- do not move those files wholesale; reduce the hosted-owned blocks and keep the browser-only bridge/adapter responsibilities in extension

## Hosted-First Ownership Status

- active manifest JS is still mostly browser-only owner code or thin glue/composition
- normal hosted v2 feature work that stays inside the current page/runtime capability catalog should not require extension deploy
- this status is not "cleanup complete"; it now has the explicit review backlog above
- this status describes current ownership only; it does not by itself prove that later `0.4.4` retirement is extension-patch-free

## `0.4.4` Retirement Readiness

Current status:

- the real `1.0.0 done` question is whether `0.4.4` can be retired later without shipping an extension follow-up release or ZIP
- server-side cleanup of `hosting/*` or Functions aliases is allowed and is not a blocker by itself
- current active manifest lane has no verified dependency on `backup/legacy-panel/*` or dead legacy panel assets inside the packaged extension path
- current audit does show hosted-owned state residue in active extension glue; finish or consciously defer that cleanup before calling hosted-first ownership complete

What counts as a blocker:

- any active `content/background/popup/shared/manifest` path that still boots `0.4.4`-only extension modules, assets, or deprecated extension-side action surfaces
- any later `0.4.4` retirement step that would force an extension `1.0.1` patch or ZIP re-release just to remove old support

Not blockers:

- server-side compat paths such as `extension/prompt-panel-bridge.html`
- legacy Functions export names such as `listInovaMeetings`, `issueInovaMeetingPanelAuth`, and `createInovaMeetingShareLink`
- `backup/legacy-panel/*` and other inactive reference files may remain for impact checks as long as active v2 runtime no longer loads them

## Remaining Manual Gates

1. Finish or consciously defer the two-review cleanup backlog above
2. User runs real Chrome smoke and rollout evidence for `1.0.0`
3. User confirms release rehearsal/package readiness when preparing the actual rollout
4. Engineering resumes if manual validation finds a regression or if a future change reopens an extension-side legacy reload blocker

## Local Rehearsal Notes

- Extension version: `1.0.0`
- v2 hosted panel local URL:
  - `http://127.0.0.1:5000/extension-v2/panel/index.html`
- Typical local flow:
  - start emulator
  - extension reload
  - set popup to local hosting
  - refresh `i-Nova` tab
- Meeting launch validation split:
  - original `i-Nova` tab should show launch request/dispatch/completion
  - new hosted workspace tab should show workspace bootstrap/ready

## Key Files To Read First Next Session

Minimal re-entry set:

- `docs/current-handoff.md`
- `AGENTS.md`
- `docs/development-philosophy.md`
- `docs/refactoring-plan.md`
- `docs/runtime-architecture.md`
- `shared/product-lane.js`
- `content/panel-v2-composition-controller.js`
- `content/panel-v2-shell-bridge.js`
- `content/panel-host-view.js`
- `content/panel-host-runtime.js`
- `content/page-capability-router.js`
- `content/panel.js`
- `content/hosted-panel-bridge.js`
- `hosting/extension-v2/panel/index.js`

Then read only the feature-local hosted controller for the chosen slice.

## Deployment Boundary

Current branch changes still span both extension and hosting across recent commits.

So real rollout still means:

- `hosting` deploy for hosted assets/controller changes
- extension reload or extension package update for `content/background/shared/manifest` changes
- docs-only changes need neither
- with the current audit, no additional engineering change is queued before user-owned validation

Long-term target remains:

- most UI/feature changes should become `hosting deploy + tab refresh`
- extension deploy should happen only for browser/page capability changes
