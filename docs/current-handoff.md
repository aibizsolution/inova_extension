# Current Handoff

Last updated: 2026-04-13

## Snapshot

- Public deployed baseline: `0.4.4`
- Current local candidate: `1.0.0`
- Active branch: `codex/prompt-review-6-dimensions`
- Latest full validation: `npm.cmd run verify`, `npm.cmd run verify:legacy-backup` passed in the current working tree
- Worktree: active slice pending commit
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
- `release`: hosted owns latest/history/download surface and compact release summary sync; extension only brokers browser/runtime actions plus compact `releaseSummary(count + snapshotFingerprint)`.
- `prompt-library`, `prompt-store`, `prompt-review`: hosted owns prompt tab transition plus prompt/store/review action routing; extension keeps page/runtime bridge and legacy fallback handlers outside the v2 request path.
- `meeting hub` / `meeting workspace`: hosted owns list/action UI, Firestore meeting-list subscription, and launch tracing; v2 hosted panel no longer falls back to top-panel `meeting-action` dispatch, and v2 extension now carries only `meetingSummary(count + snapshotFingerprint)` residue outside the hub path.

Short version:

- `hosting` is now the visible v2 app surface.
- `extension` is being reduced to the thin browser/page shell.

## What Was Stabilized In This Session

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
- current `1.0.0` manifest no longer loads `content/panel-activity-controller.js`, `content/panel-surface-controller.js`, `content/panel-lifecycle-controller.js`, or `content/panel-bootstrap-controller.js`; active shell visibility/open/surface/bootstrap helpers now live in `content/panel-v2-shell-bridge.js`, and `content/panel-v2-composition-controller.js` only wires that bridge into the active v2 graph
- meeting open traces split correctly:
  - original `i-Nova` tab now logs only launch request/dispatch/completion
  - new hosted workspace tab owns workspace bootstrap/ready logs
- v2 meeting lifecycle coupling reduced across sync, snapshot, fallback, and bootstrap wiring
- hosted-first ownership and incremental doc-correction rules were written into root/docs guidance

## Recent High-Signal Commits

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

## What Is Still Not Fully Finished

The remaining work is no longer smoke-fix first. It is mostly structural cleanup to finish the hosted-first boundary.

1. Isolate inactive legacy extension panel files into `backup/legacy-panel/*` and stop leaving dead reference code mixed into active `content/*` paths.
2. Reduce the remaining compact `meeting` summary residue in v2 so extension keeps only browser/page capability.
3. Trim remaining prompt shell residue and legacy fallback surface in extension.
4. Keep trimming panel shell/bootstrap/composition so the `content/panel.js` path becomes generic host + broker only.
5. Prepare final release path from deployed `0.4.4` baseline to hosted v2 `1.0.0`.

## Concrete Next Session Targets

### 1. Meeting residue

Goal:

- replace or shrink the remaining v2 dependency on extension-side meeting lifecycle/state

Start files:

- `content/panel-v2-composition-controller.js`
- `content/panel-v2-shell-bridge.js`
- `hosting/extension-v2/panel/meeting-hub-controller.js`

### 2. Legacy isolation

Goal:

- move inactive extension-side legacy panel code out of active `content/*` paths into `backup/legacy-panel/*`

Start files:

- `manifest.json`
- `content/main.js`
- `content/AGENTS.md`
- `backup/legacy-panel/README.md`

Then read only the legacy files that are already outside the active bundle and can be relocated without touching `DB/Functions` or shared contracts.

### 3. Prompt shell residue

Goal:

- move remaining prompt tab shell/transition decisions into hosted controllers

Start files:

- `content/panel-v2-composition-controller.js`
- `content/panel-render-controller.js`
- `backup/legacy-panel/panel-action-controller.js`
- `hosting/extension-v2/panel/index.js`

Then read only the feature-local hosted prompt controllers that the chosen path actually touches.

### 4. Common panel shell cleanup

Goal:

- make the extension panel path a generic host + bridge instead of a feature-aware UI owner

Start files:

- `content/panel.js`
- `content/panel-render-controller.js`
- `content/panel-v2-shell-bridge.js`
- `backup/legacy-panel/panel-action-controller.js`

### Not the next priority

- console noise cleanup
- speculative conversation over-trigger fixes without single-click evidence

## Recommended Next Steps

1. Read `docs/current-handoff.md`, `docs/development-philosophy.md`, `docs/refactoring-plan.md`, and `docs/runtime-architecture.md`.
2. Pick one remaining extension-owned responsibility and move only that slice.
3. If a doc still describes the old ownership, fix it in the same task.
4. Run `npm.cmd run verify` and commit each bounded slice.
5. Only smoke-test the paths needed to validate the boundary that moved.

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
- `content/panel-render-controller.js`
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
