# Current Handoff

Last updated: 2026-04-12

## Snapshot

- Public deployed baseline: `0.4.4`
- Current local candidate: `1.0.0`
- Active branch: `codex/prompt-review-6-dimensions`
- Latest full validation: `npm.cmd run verify` passed after `a28279d`
- Current architecture direction:
  - `hosting/extension-v2/panel/*` owns v2 panel UI, feature-local state, and controller/render flow.
  - `extension` keeps only browser-only capabilities: iframe host, page/DOM adapter, runtime broker, popup/settings, content/background wiring.

## Where Ownership Stands

For the `1.0.0` v2 lane, hosted ownership is effectively in place for:

- `conversation`
- `prompt-library`
- `prompt-store`
- `prompt-review`
- `meeting hub`
- `release`

This means the visible panel app is now mostly hosted.

What still remains in the extension on purpose:

- iframe host and panel shell bootstrap
- page DOM read/write adapter
- `chrome.*` / browser-only runtime calls
- popup/settings
- content/background message bridge
- page-side composer/conversation/meeting adapters that only the extension can execute

Short version:

- `hosting` is now the app surface
- `extension` is now the thin browser/page shell

## What Was Stabilized In This Session

The current branch moved past the raw ownership migration and focused on smoke-fix work for the hosted v2 lane.

Major fixes already landed here:

- local v2 panel path and bridge wiring corrected
- hosted debug UI removed; top console trace is now the primary debug surface
- function-call trace added to top console, including local vs production target
- prompt IME/composition bugs fixed across:
  - `my requests`
  - `store`
  - `review`
  - `conversation` search
- prompt review activation/result sync fixed so hosted review state can follow snapshot/runtime review state
- prompt store publishing restored in hosted v2
- prompt store category flow changed to:
  - choose existing category when available
  - otherwise create a new category on publish
- release downloads now resolve correctly against the local v2 lane
- bookmark accessibility warning fixed by removing hidden interactive bookmark jump buttons

## Recent High-Signal Commits

- `a28279d` Fix bookmark jump accessibility warning
- `e9d6232` Fix hosted review snapshot precedence
- `a59d44c` Tighten hosted prompt tab reloads and meeting traces
- `d0360fa` Resolve local hosted release download URLs
- `2c97589` Make hosted prompt tab switches optimistic
- `d3cdc84` Add dynamic prompt store categories
- `2ce3db2` Enable hosted prompt store publishing
- `d57176a` Autofocus hosted review on external requests
- `2cd2fc8` Propagate prompt review tab activation
- `ad64b9c` Keep hosted review tab selection during init
- `fd09204` Use snapshot review state in hosted prompt tab
- `47dbf71` Trace prompt review flow before fixing logic
- `d0676fb` Debounce hosted store search renders
- `cd2729e` Debounce hosted conversation search renders
- `b0ac128` Stop forced render after IME composition end
- `f281911` Debounce hosted prompt text input renders
- `0a323b2` Fix hosted panel IME composition handling

## Current Known State

### Good

- `npm.cmd run verify` is green.
- v2 hosted panel assets load locally from `http://127.0.0.1:5000/extension-v2/panel/index.html`.
- prompt review/store/library flows are now hosted-owned and functionally connected again.
- release tab local download path is wired to the v2 local lane.
- top console traces are readable enough to drive root-cause debugging without the old debug UI.

### Important nuance

`meeting` is hosted on the panel side, but backend endpoint naming is still legacy.

That means:

- v2 panel UI/controller is hosted
- but meeting Functions endpoints still use legacy exports like:
  - `listInovaMeetings`
  - `issueInovaMeetingPanelAuth`
  - `createInovaMeetingShareLink`

Do not rename meeting endpoints to `...V2` unless backend exports are added first.

### Worktree nuance

The worktree is not fully clean.

These local changes were already present and were intentionally left untouched:

- `hosting/extension-v2/panel/legacy-tools.css`
- `hosting/extension-v2/panel/meeting-view.js`

Do not accidentally fold those into unrelated cleanup unless the task is explicitly about them.

## What Is Still Not Fully Finished

The large ownership move is effectively done.

What remains is finish-up and cleanup work:

1. Reduce residual console/snapshot noise after tool switches
2. Investigate conversation bookmark jump over-triggering
3. Split meeting open traces between top-panel launch and hosted workspace boot
   - `open-workspace`
   - `open-result`
4. Continue trimming extension-side leftover wiring that no longer needs to own UI decisions
5. Final release prep from deployed `0.4.4` baseline to hosted v2 `1.0.0`

## Concrete Outstanding Issues To Pick Up Next

These are the highest-value next-session follow-ups.

### 1. Conversation jump over-trigger

Recent local logs showed `page/jump-conversation-item` firing many times from a single conversation click sequence.

This is the clearest remaining behavior issue in the current smoke pass.

Start by tracing:

- `hosting/extension-v2/panel/index.js`
- `hosting/extension-v2/panel/conversation-controller.js`
- `content/panel.js`
- `content/bookmark-view.js`
- `hosting/extension-v2/panel/bookmark-view.js`

The accessibility warning is fixed, but click/request duplication still needs confirmation and likely reduction.

### 2. Meeting open trace split

`share` / `revoke-share` now emit both start and completion traces.

`open-workspace` and `open-result` open a new hosted tab, so the top panel console should only tell the launch story. Hosted workspace boot/ready should be checked in the new tab debug console instead of forcing the original tab logs to represent both surfaces.

Start by tracing:

- `content/panel-meeting-controller.js`
- `content/panel.js`
- `hosting/extension-v2/panel/index.js`
- `hosting/meeting/index.js`

### 3. Residual prompt/store/release noise

Functionality is mostly working, but there is still repeated:

- `top.panel.snapshot.push`
- `runtime/storage.update-ui-preferences`
- `prompt/loadInovaPromptLibraryUrl`
- `prompt/listPromptStoreEntriesUrl`

These no longer look like hard failures, but they are still optimization candidates.

## Recommended Next Steps

If continuing immediately, do this order:

1. Chrome extension `Reload`
2. Refresh the `i-Nova` tab
3. Re-run targeted smoke in local emulator:
   - conversation click/jump/copy
   - meeting open-result/open-workspace/share/revoke
   - hosted workspace `workspace.ready`
   - prompt review second-run behavior
   - prompt store publish/import
   - release download/open
4. Only fix concrete issues confirmed by console trace
5. After smoke is stable, remove leftover extension-owned UI wiring only where clearly unnecessary

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

Then read only the feature-local hosted controller for the failing area.

## Deployment Boundary

Current branch changes span both extension and hosting.

So real rollout still means:

- `hosting` deploy for hosted assets
- extension reload or extension package update for `content/background/shared/manifest` changes

Long-term target remains:

- hosting-only UI/feature changes should usually need only hosting deploy + tab refresh
- extension deploy should happen only for browser-only capability changes
