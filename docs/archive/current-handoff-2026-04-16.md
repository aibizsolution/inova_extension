# Current Handoff

> Archived reference. 이 문서는 기본 작업 시작 시 읽지 않으며, 최신 운영 기준으로 유지보수하지 않는다. 현재 기준은 루트 `README.md`, `AGENTS.md`, `docs/feature-routing.md`, `docs/runtime-architecture.md`, `docs/release-workflow.md`, feature별 `AGENTS.md`를 우선한다.

Last updated: 2026-04-16

## Snapshot

- Public deployed baseline: `0.4.4`
- Current local candidate: `1.0.0`
- Current merged baseline: `main` at `81af793` / PR #42.
- Current working branch: `codex/bundled-capability-manifest`.
- Latest targeted validation: page capability router, runtime capability router, meeting hub, and contracts passed after the reviewer cleanup code changes. Run full `npm.cmd run verify` before commit.
- Worktree may be dirty during the reviewer cleanup slice.

## Current Goal

The active architecture goal is no-deploy feature expansion for the extension runtime platform.

- extension is the privileged runtime shell.
- server can deploy feature definitions through capability manifest and versioned workflow artifacts.
- remote logic runs only in sandboxed hosted context.
- privileged boundary stays in extension-owned adapters.
- new Chrome permission, host permission, content DOM primitive, privileged bridge, or native integration still requires extension redeploy.
- new Cloud Function endpoint, endpoint path, capability routing, UI action exposure, and lightweight workflow should be server/hosting deploy whenever the existing primitive catalog can cover it.

Archived primary design doc at the time:

- `docs/archive/remote-capability-manifest-plan.md`

Generated/runtime catalog:

- `docs/capability-catalog.md`
- `hosting/extension/capability-manifest.json`
- `hosting/extension-v2/capability-manifest.json`

## Remote Platform Status

Implemented:

- bundled + remote `capability-manifest.json` model.
- manifest fetch/cache/fallback with explicit degraded status.
- endpoint/target/lane resolution through `background/functions-runtime-config.js`.
- semantic capability catalog with `function`, `browser.open-url`, `storage.write-ui-preferences`, `page.capability`, and gated `workflow` kinds.
- `capabilities.handshake` catalog negotiation from background to hosted panel.
- killed/disabled/lane/minVersion/test-only capability exclusion from `enabledCapabilityIds`.
- capability alias/deprecation metadata and generated catalog docs.
- raw URL, raw runtime action, unknown kind, missing schema, unsafe endpoint, bad workflow artifact, and permanent compatibility drift guards.
- sandboxed remote workflow host/runtime foundation.
- workflow artifact registry with same-origin artifact fetch, integrity check, script slot allowlist, and raw code/url payload rejection.
- sandbox bridge allowlist: `emitTrace`, `invokeCapability`, `invokePageCapability`, `metrics`, `openUrl`, `readPanelState`, `writeUiPreferences`.
- hosted controller capability gating for prompt review, prompt library, prompt store, release download, meeting share, conversation read/jump/copy, and panel preference writes.
- named page primitives for `page.scroll-to`, `page.highlight-range`, `page.show-banner`, `page.read-selection`, and `page.dispatch-named-event`.
- data-driven `urlTemplates` for `browser.open-url` capabilities.
- production manifest seed entries for kill switch, v2 lane gate, and alias handling.
- meeting share create/revoke execution moved to `invokeCapability()` and manifest function endpoint resolution.

Still intentionally closed:

- production remote workflow pilot.
- arbitrary remote JS.
- arbitrary selector or DOM script.
- unrestricted fetch bridge.
- new privileged bridge without docs/verify/guard.

## Pilot State

The member-info remote workflow pilot was used only to validate the platform.

- Added by `9721ba8` / `082f85b`.
- Reverted by `0c4075a` / `821265d`.
- Do not treat member-info UI, controller, or workflow artifact files as active.
- The platform pieces remain active; only the pilot feature was removed.

Next pilot requires an explicit choice. Current candidates in the plan:

- release help/open flow.
- prompt store import confirmation flow.
- prompt review post-action flow.

Pilot rules:

- read/light-write only at first.
- must have kill switch, lane gate, version-pinned artifact, audit/debug metadata, degraded reason, and verify coverage.
- production must stay disabled unless those gates are present.

## Hosted-First Status

The active `1.0.0` lane remains hosted-first.

- `hosting/extension-v2/panel/*` owns visible tab UI, view state, and feature-local action flow.
- `content/*` owns page DOM sensors/adapters, iframe host, postMessage bridge, route/surface glue, and prompt-review page float.
- `background/*` owns privileged runtime adapters, auth/session, Functions endpoint resolution, browser tab open, and capability manifest validation.
- `shared/*` should stay browser-agnostic unless a file is explicitly listed in the contracts.
- `backup/legacy-panel/*` is reference only and must not return to active manifest/runtime paths.

Known hosted-first nuance:

- `content/features/prompt-review/*` is still active page DOM UI because the composer float anchors to the page DOM. Moving the visual into hosted would be a separate overlay design, not a quick cleanup.
- meeting Functions endpoint names are still legacy exports such as `listInovaMeetings`, `issueInovaMeetingPanelAuth`, and `createInovaMeetingShareLink`. Do not rename them unless backend exports exist first.

## Next Engineering Work

Reviewer cleanup is active. Finish docs/catalog regeneration, full verify, and commit.

After that, no new engineering slice is queued before choosing a new pilot. If continuing remote platform work, pick one:

1. Choose and implement a Phase 8 sandboxed workflow pilot.
2. Expand named page primitives only if a real pilot cannot be expressed with the current catalog.
3. Add debug UI for workflow artifact/run metadata.
4. Start removing `functions.invoke-endpoint` compatibility after the documented `2026-05-31` target, with guard updates.

Do not start these by default:

- Chrome smoke / release-go validation. That is user/manual gate unless explicitly requested.
- broad hosted-first cleanup unrelated to remote capability platform.
- new privileged extension primitive without an explicit feature need.

## Files To Read First

Remote platform:

- `docs/archive/remote-capability-manifest-plan.md`
- `docs/capability-catalog.md`
- `background/functions-runtime-config.js`
- `background/capability-manifest-validator.js`
- `background/panel-runtime-capability-router.js`
- `hosting/extension-v2/panel/extension-capability-client.js`
- `hosting/extension-v2/panel/remote-workflow-host.js`
- `hosting/extension-v2/panel/remote-workflow-sandbox.js`
- `scripts/verify-runtime-capability-router.js`
- `scripts/verify-remote-workflow-sandbox.js`
- `scripts/verify-extension-capability-client.js`
- `scripts/verify-page-capability-router.js`

Hosted controller gating:

- `hosting/extension-v2/panel/index.js`
- `hosting/extension-v2/panel/conversation-controller.js`
- `hosting/extension-v2/panel/meeting-hub-controller.js`
- `hosting/extension-v2/panel/prompt-library-controller.js`
- `hosting/extension-v2/panel/prompt-review-controller.js`
- `hosting/extension-v2/panel/prompt-store-controller.js`
- `hosting/extension-v2/panel/release-controller.js`

## Validation

Default validation:

- `npm.cmd run verify`

Useful targeted checks:

- `npm.cmd run verify:runtime-capability-router`
- `npm.cmd run verify:remote-workflow-sandbox`
- `npm.cmd run verify:extension-capability-client`
- `npm.cmd run verify:panel-render`
- `npm.cmd run verify:panel-hosted-requests`
- `npm.cmd run verify:meeting-hub`
- `npm.cmd run verify:docs`

Recent full validation:

- `npm.cmd run verify` passed on `codex/bundled-capability-manifest`.

## Deployment Boundary

Current branch spans extension, hosted assets, and docs across recent commits.

- `background/*`, `content/*`, `shared/*`, `manifest.json`, or contract changes require extension reload/package update.
- `hosting/*` changes require Hosting deploy.
- `functions/*` changes require Functions deploy.
- docs-only changes require no deploy.

For this remote-platform branch, real rollout should assume:

- extension reload/package update for background/content/shared/platform changes.
- Hosting deploy for hosted panel, manifests, sandbox files, and generated catalog assets.
- no Functions deploy unless a later commit touches `functions/*`.

Long-term target remains:

- most feature changes become Hosting/server deploy plus tab refresh.
- extension deploy is reserved for new privileged primitives, permissions, host permissions, content DOM adapters, web accessible resources, or native browser integration.
