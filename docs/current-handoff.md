# Current Handoff

Last updated: 2026-04-14

## Snapshot

- Public deployed baseline: `0.4.4`
- Current local candidate: `1.0.0`
- Active branch: `codex/prompt-review-6-dimensions`
- Latest full validation: `npm.cmd run verify` passed in the current working tree
- Worktree: clean
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

- `conversation`: hosted owns list/search/copy/jump UI state; extension only provides page adapter plus thin signals such as count/active/fingerprint.
- `release`: hosted owns latest/history/download surface and compact release summary sync; extension only keeps browser/runtime broker capability plus count-only `toolSummaries.release(count)`.
- `prompt-library`, `prompt-store`, `prompt-review`: hosted owns prompt tab transition plus prompt/store/review action routing and review state/result/dismiss; extension keeps page/runtime bridge, review float, monotonic review-trigger handoff, generic local-state/provider-identity persistence, and stable browser capability APIs only.
- `meeting hub` / `meeting workspace`: hosted owns list/action UI, Firestore meeting-list subscription, and launch tracing; v2 hosted panel no longer falls back to top-panel `meeting-action` dispatch, and v2 extension now carries only count-only `toolSummaries.meeting(count)` residue outside the hub path.

Short version:

- `hosting` is now the visible v2 app surface.
- `extension` is being reduced to the thin browser/page shell.

## What Was Stabilized In This Session

- prompt review handoff no longer gets stuck in hosted `pending` after a successful external review result
- prompt review copy now delegates through top-page `clipboard.write-text` instead of iframe-local clipboard access
- active page adapter contract is being normalized around capability-shaped actions (`conversation.read-state`, `conversation.jump-item`, `composer.read-state`, `composer.apply-text`, `clipboard.write-text`, `debug.*`, `trace.log`) so hosted feature work can change without extension-side feature rewrites
- prompt review runtime now surfaces `page.functions.review.*` / `prompt.review.request.*` traces in the top console and fails explicit timeout after `30s` instead of hanging forever
- top console trace visibility was restored for hosted `meeting panel-auth`, `Firestore listen/snapshot`, conversation snapshot reads, release fetches, and prompt review function calls
- panel layout now uses a fixed `420px` width with a `70px` left rail for the active v2 surface
- prompt scope buttons, meeting CTA alignment/dividers, bookmark spacing/copy icon alignment, and release tab section layout were visually normalized around the fixed-width panel shell
- panel chrome ownership (`tool rail`, `tool title`, `tool count`) moved out of extension
- release snapshot trimmed to hosted-owned signals
- conversation snapshot trimmed to hosted-owned signals
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
- current `1.0.0` manifest no longer loads the legacy release runtime/helper bundle; compact release summary now round-trips through hosted v2 instead of `content/release-manager.js`
- current `1.0.0` manifest no longer loads the legacy content bookmark view/style bundle; hosted bookmark view owns the visible conversation UI and `content` keeps only snapshot/jump/copy adapters
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
- active v2 createState no longer carries dead `meetingHub` / `meetingUi` buckets; extension compact hosted residue now lives under `toolSummaries`, with meeting staying count-only
- compact hosted `meeting` / `release` summaries now round-trip through a shared `tool-summary-sync` bridge contract instead of feature-specific summary actions
- v2 composition now normalizes compact `meeting` / `release` residue through shared `toolSummaries` helpers instead of per-feature snapshot bridge helpers
- v2 shell/render now reads compact `meeting` / `release` state through shared tool-summary callbacks instead of feature-specific render deps
- hosted release refresh/download actions no longer fall back to top-panel `release-action`; active v2 release actions now stay inside the hosted controller and only use runtime invoke for browser open-url
- `content/panel.js` no longer picks meeting/prompt runtime helpers directly; panel iframe target now resolves through shared `firebaseConfig.panel` runtime config
- `content/panel.js` no longer clones the full render payload into hosted bridge snapshots; v2 render now passes a prebuilt `panelSnapshot` and the host just brokers view + bridge envelope
- top-panel snapshot trace shaping now comes from v2 shell `panelTrace`; `content/panel.js` no longer reads prompt review detail directly out of hosted tool state
- top console trace policy/summary formatting now lives in `content/panel-console-trace.js`; `content/panel.js` no longer carries feature-specific always-trace rules inline
- hosted panel iframe target/status/handshake/render batching now lives in `content/panel-host-runtime.js`; hosted bridge endpoint/page event emit now lives in `content/panel-host-bridge.js`; host markup/handle drag-click now lives in `content/panel-host-view.js`; `content/panel.js` keeps host element lifecycle + helper wiring only
- active `content/hosted-panel-bridge.js` no longer carries inactive legacy `meeting-action`, `release-action`, or prompt action request paths; the live v2 request surface is now `tool-summary-sync`, conversation bookmark, shell, runtime, and page only
- backup legacy reference verify scripts now live under `scripts/legacy-panel/*` instead of the active root `scripts/` namespace
- active v2 prompt shell no longer keeps hosted-owned prompt store-load/storage/sync sidecars; extension prompt residue is now review float plus review handoff/persistence only
- active v2 prompt review no longer mirrors result/error/open/pending state through the top snapshot; extension now sends only a monotonic external `requestId` signal and hosted review owns the request lifecycle plus escape dismiss
- active `shared/storage.js` / `shared/cloud-sync.js` no longer carry dormant prompt-library CRUD/sync operation helpers; those backup-only prompt helpers now live under `backup/legacy-panel/shared/*`
- active hosted runtime broker no longer exposes generic storage read/write mutation to the v2 panel; `storage.get-state` is now a compact `cloudSync/settings/uiPreferences` snapshot and prompt tab persistence writes stay on `storage.update-ui-preferences` only
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

- `npm.cmd run verify` is green.
- Worktree is clean.
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
- `conversation` jump duplication should only be revisited if a single user click clearly produces multiple jump requests in the trace
- local Auth Emulator warning banners/messages may still appear; treat them as non-blocking local warning noise unless they are tied to a real capability failure

## What Is Still Not Fully Finished

The remaining work is no longer structural cleanup first.

The hosted-first boundary is effectively in place. What remains is rollout validation and release preparation for the `0.4.4 -> 1.0.0` switch.

1. Record real Chrome smoke on the current hosted-first `1.0.0` lane.
2. Prepare the actual rollout checklist and deployment boundary for release.

## Concrete Next Session Targets

### 1. Chrome smoke

Goal:

- confirm the real hosted-first `1.0.0` panel works in Chrome beyond static verify

Start files:

- `docs/runtime-architecture.md`
- `docs/current-handoff.md`
- `content/AGENTS.md`
- `docs/release-workflow.md`

Then validate only the user-facing hosted v2 flows that matter for release:

- panel boot/open
- conversation jump/copy
- prompt library/store/review
- meeting hub/workspace launch
- release latest/history/download

### 2. Rollout prep

Goal:

- prepare the actual public handoff from deployed `0.4.4` to hosted-first `1.0.0`

Start files:

- `docs/current-handoff.md`
- `docs/release-workflow.md`
- `docs/refactoring-plan.md`
- `releases/release-notes.json`

### Not the next priority

- console noise cleanup
- speculative conversation over-trigger fixes without single-click evidence
- Auth Emulator warning banner suppression

## Recommended Next Steps

1. Read `docs/current-handoff.md`, `docs/development-philosophy.md`, `docs/refactoring-plan.md`, and `docs/runtime-architecture.md`.
2. Start with real Chrome smoke, not with more structural cleanup, unless the smoke exposes the same hosted lane as the blocker.
3. If Chrome smoke passes, move directly to rollout prep instead of reopening minor refactors.
4. If a doc still describes the old ownership or old next-step order, fix it in the same task.
5. Run `npm.cmd run verify` and commit each bounded slice.

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
- `content/panel.js`
- `hosting/extension-v2/panel/index.js`

Then read only the feature-local hosted controller for the chosen slice.

## Deployment Boundary

Current branch changes still span both extension and hosting across recent commits.

So real rollout still means:

- `hosting` deploy for hosted assets/controller changes
- extension reload or extension package update for `content/background/shared/manifest` changes
- docs-only changes need neither

Long-term target remains:

- most UI/feature changes should become `hosting deploy + tab refresh`
- extension deploy should happen only for browser/page capability changes
