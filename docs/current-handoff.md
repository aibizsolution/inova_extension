# Current Handoff

Last updated: 2026-04-12

## Snapshot

- Public deployed baseline: `0.4.4`
- Current local candidate: `1.0.0`
- Active branch: `codex/prompt-review-6-dimensions`
- Current architecture direction:
  - `extension` keeps only iframe host, page/DOM adapter, runtime broker, popup/settings.
  - `hosting/extension-v2/panel/*` owns tool UI/state/controller.
- Latest full validation: `npm.cmd run verify` passed after `849e6e8`

## What Is Done

`1.0.0` v2 lane is now the local baseline.

Hosted ownership moved into `hosting/extension-v2/panel/*` for:

- `conversation`
- `prompt-library`
- `prompt-store`
- `prompt-review`
- `meeting hub`
- `release`
- `debug`

Important supporting changes already landed:

- `shared/product-lane.js`
  - manifest major `>= 1` activates `v2` lane
- `shared/firebase-config.js`
  - `1.x+` panel path resolves to `hosting/extension-v2/panel/index.html`
- `content/panel-v2-composition-controller.js`
  - v2 extension composition is shell/runtime/route/page-adapter only
- `content/panel.js`
  - page adapter now supports conversation/debug/composer actions for hosted v2
- `hosting/extension-v2/panel/debug-controller.js`
  - v2 debug UI/state/action now hosted

## Very Important Direction

Do not collapse feature responsibilities back together.

Keep the current style:

- one boundary at a time
- feature-local controller/model/view files stay separate
- move ownership without merging unrelated files
- do not reintroduce "one big v2 panel controller" refactors

The user explicitly wants:

- anything that only needs hosting should live in hosting
- extension should keep only browser-only capabilities
- responsibility-first refactoring should be preserved

## Recent Commits

- `849e6e8` Keep meeting functions on legacy endpoints in v2
- `8c71582` Move v2 debug ownership into hosted panel
- `54d8a01` Promote local candidate to v2 1.0.0 baseline
- `57bfdeb` Move v2 conversation ownership into hosted panel
- `892d95f` Move v2 release ownership into hosted panel
- `edeb92d` Move v2 meeting hub ownership into hosted panel
- `39a56c8` Move v2 prompt store ownership into hosted panel
- `b102fda` Move v2 prompt review ownership into hosted panel
- `a033963` Move v2 prompt library ownership into hosted panel
- `7bd60a7` Expand hosted panel page adapter contract
- `d883b40` Add v2 shell-only composition root
- `b4dad65` Add v2 hosted panel scaffold path

## Current Known State

### Good

- `npm.cmd run verify` is green.
- Worktree is clean.
- v2 panel assets load locally from `/extension-v2/panel/*`.
- prompt v2 runtime uses v2 prompt endpoints as intended.

### Important nuance

`meeting` is not fully backend-lane-split yet.

That means:

- v2 panel UI/controller is hosted
- but meeting Functions endpoints still use legacy names like:
  - `listInovaMeetings`
  - `issueInovaMeetingPanelAuth`
  - `createInovaMeetingShareLink`

This was fixed in `849e6e8`.
Do not switch meeting endpoints to `...V2` unless the backend exports are actually added first.

### Known follow-up item

Local emulator logs show repeated 404s for:

- `/extension-v2/releases/latest.json`
- `/extension-v2/releases/history.json`

This does not block the ownership move itself, but release local rehearsal likely still needs either:

- v2 release assets to exist under `hosting/extension-v2/releases/*`
- or release local URL resolution to keep using the legacy release path

Treat this as a separate follow-up, not part of the ownership migration itself.

## What Still Remains

The big ownership migration is effectively done.

Remaining work is mostly finish-up work:

1. Real Chrome smoke on `1.0.0` v2 local lane
2. Confirm "hosting-only edits -> tab refresh only" boundary in practice
3. Clean up any leftover legacy extension wiring that is no longer needed in v2
4. Decide release-path handling for local/prod v2 assets
5. Final release prep from `0.4.4` deployed baseline to `1.0.0`

## Recommended Next Steps

If continuing immediately, do this order:

1. Chrome extension `Reload`
2. Refresh the `i-Nova` tab
3. Smoke test in local emulator:
   - conversation search/jump/copy
   - prompt create/edit/delete/import/export
   - prompt store search/detail/import/like
   - prompt review run/copy/apply
   - meeting hub list/open/share/revoke
   - release tab
   - debug console
4. Fix only the concrete failures found in smoke
5. After smoke is stable, do small cleanup of leftover extension-only legacy wiring

## Local Rehearsal Notes

- Extension version: `1.0.0`
- v2 hosted panel local URL:
  - `http://127.0.0.1:5000/extension-v2/panel/index.html`
- Typical local flow:
  - start emulator
  - extension reload
  - set popup to local hosting
  - refresh `i-Nova` tab

Current emulator log files from this session:

- `C:\Users\parkyoungtack\Documents\code\inova_extension\.codex-logs\emulator-meeting-local-20260412-091736.out.log`
- `C:\Users\parkyoungtack\Documents\code\inova_extension\.codex-logs\emulator-meeting-local-20260412-091736.err.log`

## Key Files To Read First Next Session

Minimal re-entry set:

- `docs/current-handoff.md`
- `docs/refactoring-plan.md`
- `docs/runtime-architecture.md`
- `shared/product-lane.js`
- `shared/firebase-config.js`
- `content/panel-v2-composition-controller.js`
- `content/panel.js`
- `hosting/extension-v2/panel/index.html`
- `hosting/extension-v2/panel/index.js`

Then only read the feature-local v2 controller for the failing area.

## Deployment Boundary

Current migration commits touched both extension and hosting.

So real rollout still means:

- `hosting` deploy for hosted assets
- extension reload or extension package update for `content/background/shared/manifest` changes

Long-term target remains:

- hosting-only UI/feature changes should usually need only hosting deploy + tab refresh
- extension deploy should happen only for browser-only capability changes
