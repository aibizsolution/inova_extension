#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function main() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8")
  );
  const mainSource = fs.readFileSync(
    path.join(root, "content", "main.js"),
    "utf8"
  );
  const v2CompositionSource = fs.readFileSync(
    path.join(root, "content", "panel-v2-composition-controller.js"),
    "utf8"
  );

  const mainContentScript = manifest.content_scripts.find((entry) =>
    Array.isArray(entry?.matches) && entry.matches.includes("https://inova.incross.com/*")
  );
  const scriptList = Array.isArray(mainContentScript?.js) ? mainContentScript.js : [];

  assert(
    scriptList.includes("content/panel-console-trace.js"),
    "manifest should load the dedicated panel trace helper in the active 1.0.0 bundle"
  );
  assert(
    scriptList.includes("content/panel-v2-prompt-controller.js"),
    "manifest should load the v2 prompt controller in the active 1.0.0 bundle"
  );
  [
    "hosting/meeting/debug-console.js",
    "backup/legacy-panel/shared/meeting-debug.js",
    "backup/legacy-panel/shared/meeting-bridge.js",
    "shared/release-info.js",
    "content/bookmark-view.js",
    "content/panel-bookmark-controller.js",
    "content/panel-state-factory.js",
    "content/provider-identity-sync.js",
    "content/tools.css",
    "backup/legacy-panel/features/prompt-library/files.js",
    "backup/legacy-panel/features/prompt-library/cloud-sync-manager.js",
    "backup/legacy-panel/features/prompt-store/prompt-realtime-manager.js",
    "backup/legacy-panel/features/prompt-library/prompt-manager.js",
    "backup/legacy-panel/features/prompt-store/store-manager.js",
    "backup/legacy-panel/prompt-hub-panel.js",
    "backup/legacy-panel/prompt-hub-controller.js",
    "backup/legacy-panel/prompt-hub-runtime.js",
    "backup/legacy-panel/prompt-hub-state.js",
    "backup/legacy-panel/panel-prompt-controller.js",
    "content/release-manager.js",
  ].forEach((file) => assert(
    !scriptList.includes(file),
    `manifest should stop loading the inactive runtime file ${file} in the active 1.0.0 bundle`
  ));
  assert(
    scriptList.includes("content/panel-v2-composition-controller.js"),
    "manifest should load the v2 composition controller before content/main.js"
  );
  [
    "content/meeting-manager.js",
    "content/panel-meeting-controller.js",
    "content/panel-action-controller.js",
    "content/panel-composition-controller.js",
  ].forEach((file) => assert(
    !scriptList.includes(file),
    `manifest should stop loading the legacy panel lane file ${file} in the active 1.0.0 bundle`
  ));
  assert(
    mainSource.includes("namespace.panelV2CompositionController.create(state)"),
    "content/main.js should boot the current extension bundle through the v2 composition directly"
  );
  assert(
    mainSource.includes("namespace.panelV2CompositionController.createState()"),
    "content/main.js should source active panel state directly from the v2 composition root"
  );
  assert(
    mainSource.includes("namespace.panelV2CompositionController"),
    "content/main.js should reference the v2 composition root"
  );
  assert(
    !mainSource.includes("namespace.panelCompositionController"),
    "content/main.js should stop wiring the legacy panel composition into the active 1.0.0 bundle"
  );
  assert(
    v2CompositionSource.includes("panelV2ShellBridge.createBootstrapController"),
    "v2 composition should keep the bootstrap wiring inside the shared v2 shell bridge"
  );
  assert(
    v2CompositionSource.includes("panelV2ShellBridge.createRenderController"),
    "v2 composition should keep render wiring inside the shared v2 shell bridge"
  );
  assert(
    !v2CompositionSource.includes("namespace.panelDebugController.create"),
    "v2 composition should stop loading the standalone debug controller file in the active bundle"
  );
  assert(
    !v2CompositionSource.includes("namespace.panelRuntimeController.create"),
    "v2 composition should stop loading the standalone runtime controller file in the active bundle"
  );
  assert(
    v2CompositionSource.includes("createPanelRuntimeBridge"),
    "v2 composition should keep runtime helper ownership inline once the standalone runtime controller leaves the active bundle"
  );
  assert(
    v2CompositionSource.includes("createPanelDebugBridge"),
    "v2 composition should keep debug helper ownership inline once the standalone debug controller leaves the active bundle"
  );
  assert(
    v2CompositionSource.includes("createProviderIdentitySync"),
    "v2 composition should keep provider identity sync ownership inline once the standalone provider identity helper leaves the active bundle"
  );
  assert(
    v2CompositionSource.includes("namespace.panelV2CompositionController = { create, createState };"),
    "v2 composition should export createState for the active bundle bootstrap"
  );
  assert(
    !v2CompositionSource.includes("namespace.meetingManager.create"),
    "v2 composition should not instantiate the legacy meeting manager once hosted meeting actions and lifecycle are detached"
  );
  assert(
    !v2CompositionSource.includes("namespace.meetingManager.mergeMeetingHub"),
    "v2 composition should not normalize hosted meeting summaries through the legacy meeting manager"
  );
  assert(
    !v2CompositionSource.includes("let panelMeetingController = null;"),
    "v2 composition should not keep a meeting fallback controller once hosted meeting actions stay inside hosted ownership"
  );
  assert(
    !v2CompositionSource.includes("getPanelMeetingController"),
    "v2 composition should not provide a meeting fallback getter once hosted meeting actions stay inside hosted ownership"
  );
  assert(
    v2CompositionSource.includes("onRouteStateChanged: () => false"),
    "v2 route sync should no longer keep an extension-side meeting lifecycle callback just to return false"
  );
  assert(
    !v2CompositionSource.includes("createHostedOwnedIdleMeetingLifecycleBridge"),
    "v2 composition should drop the idle meeting lifecycle bridge once shell sidecars stop touching meeting sync"
  );
  assert(
    /const panelActivityController = panelV2ShellBridge\.createPanelActivityBridge\(state, \{[\s\S]*?providerIdentitySync,/.test(v2CompositionSource)
      && !/const panelActivityController = panelV2ShellBridge\.createPanelActivityBridge\(state, \{[\s\S]*?meetingManager:/.test(v2CompositionSource),
    "v2 browser visibility/focus should stop carrying extension meeting lifecycle wiring"
  );
  assert(
    v2CompositionSource.includes("const panelShellController = panelV2ShellBridge.createShellController(state, {")
      && !/const panelShellController = panelV2ShellBridge\.createShellController\(state, \{[\s\S]*?meetingManager:/.test(v2CompositionSource),
    "v2 shell tool transitions should stop carrying extension meeting lifecycle wiring"
  );
  assert(
    v2CompositionSource.includes("panelV2ShellBridge.createShellController"),
    "v2 composition should keep shell tool/query wiring inside the shared v2 shell bridge"
  );
  assert(
    v2CompositionSource.includes("const panelLifecycleController = panelV2ShellBridge.createPanelLifecycleBridge(state, {")
      && !/const panelLifecycleController = panelV2ShellBridge\.createPanelLifecycleBridge\(state, \{[\s\S]*?meetingManager:/.test(v2CompositionSource),
    "v2 panel toggle transitions should stop carrying extension meeting lifecycle wiring"
  );
  assert(
    v2CompositionSource.includes("const panelBootstrapController = panelV2ShellBridge.createBootstrapController(state, {")
      && !/const panelBootstrapController = panelV2ShellBridge\.createBootstrapController\(state, \{[\s\S]*?meetingManager:/.test(v2CompositionSource),
    "v2 bootstrap should stop wiring extension meeting lifecycle bridges"
  );
  assert(
    v2CompositionSource.includes("const panelSurfaceController = panelV2ShellBridge.createPanelSurfaceBridge(state, {")
      && !/const panelSurfaceController = panelV2ShellBridge\.createPanelSurfaceBridge\(state, \{[\s\S]*?meetingManager:/.test(v2CompositionSource),
    "v2 composition should stop carrying extension meeting lifecycle wiring in surface observers"
  );
  assert(
    !v2CompositionSource.includes("onPromptTabSelected:"),
    "v2 prompt tab transitions should no longer reference extension meeting lifecycle glue"
  );
  assert(
    !v2CompositionSource.includes("namespace.panelActionController.create"),
    "v2 composition should not wire the top-panel meeting action dispatcher once hosted meeting actions stay inside hosted ownership"
  );
  assert(
    !v2CompositionSource.includes("namespace.panelPromptBridgeController.create"),
    "v2 composition should not keep the prompt bridge proxy once hosted-owned prompt wiring can be passed directly"
  );
  assert(
    v2CompositionSource.includes("const promptShellController = namespace.panelV2PromptController.create(state, {"),
    "v2 composition should keep the active v2 prompt shell controller local once shell prompt sync sidecars are gone"
  );
  assert(
    v2CompositionSource.includes("namespace.panelV2PromptController.create"),
    "v2 composition should wire the v2-only prompt controller instead of the legacy prompt runtime"
  );
  assert(
    !v2CompositionSource.includes("namespace.panelPromptController.create"),
    "v2 composition should stop instantiating the legacy prompt runtime controller"
  );
  assert(
    !v2CompositionSource.includes("namespace.releaseManager.create"),
    "v2 composition should stop instantiating the legacy release manager in the active 1.0.0 bundle"
  );
  assert(
    !v2CompositionSource.includes("createHostedOwnedIdleReleaseLifecycleBridge"),
    "v2 composition should drop the idle release bridge once hosted release checks stay inside hosted ownership"
  );
  assert(
    v2CompositionSource.includes("handlePanelToolSummarySync: handleToolSummarySync"),
    "v2 bootstrap wiring should accept compact hosted tool summary sync callbacks"
  );
  assert(
    v2CompositionSource.includes('const releaseToolSummarySnapshot = createReleaseToolSummarySnapshotBridge('),
    "v2 render wiring should shape release state from the shared compact hosted tool summary helper"
  );
  assert(
    v2CompositionSource.includes("state.toolSummaries"),
    "v2 composition should keep hosted-owned compact tool residue in a shared toolSummaries state bucket"
  );
  assert(
    !v2CompositionSource.includes("state.releaseInfo"),
    "v2 composition should stop reading legacy releaseInfo state directly"
  );
  assert(
    !v2CompositionSource.includes("let hostedOwnedPromptController = null;"),
    "v2 composition should track the hosted-owned prompt controller directly"
  );
  assert(
    !v2CompositionSource.includes("getPromptController: () => hostedOwnedPromptController"),
    "v2 shell wiring should stop routing generic prompt tool selection back through the prompt controller"
  );
  assert(
    !v2CompositionSource.includes("panelPromptController:"),
    "v2 render/bootstrap wiring should drop the legacy panelPromptController contract name"
  );
  assert(
    v2CompositionSource.includes("promptShellController,"),
    "v2 render/bootstrap wiring should pass the active prompt shell controller directly"
  );
  assert(
    v2CompositionSource.includes("createPromptSnapshotBridge"),
    "v2 composition should wrap prompt snapshot shaping for hosted-owned prompt state"
  );
  assert(
    v2CompositionSource.includes("buildPromptSnapshot: promptSnapshotBridge.buildPromptSnapshot"),
    "v2 render wiring should pass the hosted-owned prompt snapshot bridge"
  );
  assert(
    v2CompositionSource.includes("createConversationBridge"),
    "v2 composition should wrap conversation snapshot shaping for hosted-owned conversation state"
  );
  assert(
    !v2CompositionSource.includes("namespace.panelBookmarkController.create"),
    "v2 composition should not instantiate the legacy bookmark controller once the active bundle keeps conversation glue inline"
  );
  assert(
    v2CompositionSource.includes("const conversationBridge = createConversationBridge(state, { render });"),
    "v2 composition should keep the active conversation bridge inline instead of loading the legacy bookmark controller file"
  );
  assert(
    v2CompositionSource.includes("buildConversationSnapshot: conversationBridge.buildConversationSnapshot"),
    "v2 render wiring should pass the hosted-owned conversation snapshot bridge"
  );
  assert(
    v2CompositionSource.includes("createCountToolSummarySnapshotBridge"),
    "v2 composition should wrap count-only hosted tool summary shaping for meeting state"
  );
  assert(
    v2CompositionSource.includes('const meetingToolSummarySnapshot = createCountToolSummarySnapshotBridge('),
    "v2 meeting snapshot bridge should derive snapshot state from the shared hosted tool summary helper without the legacy meeting manager"
  );
  assert(
    !v2CompositionSource.includes("state.meetingHub"),
    "v2 composition should stop storing hosted-owned meeting summary residue in the legacy meetingHub state bucket"
  );
  assert(
    !v2CompositionSource.includes("meetingHub:"),
    "v2 composition state should not keep a legacy meetingHub bucket once hosted meeting ownership is count-only"
  );
  assert(
    !v2CompositionSource.includes("meetingUi:"),
    "v2 composition state should not keep a legacy meetingUi bucket once hosted meeting action UI stays hosted"
  );
  assert(
    !v2CompositionSource.includes("state.meetingSummary"),
    "v2 composition should stop keeping hosted-owned meeting residue in a dedicated meetingSummary bucket"
  );
  assert(
    v2CompositionSource.includes("toolSummaries: {"),
    "v2 composition state should keep hosted-owned compact tool residue in a shared toolSummaries bucket"
  );
  assert(
    v2CompositionSource.includes('meeting: { count: 0 },'),
    "v2 composition should keep hosted-owned meeting residue count-only inside toolSummaries.meeting"
  );
  assert(
    v2CompositionSource.includes('release: { count: 0 },'),
    "v2 composition should keep hosted-owned release residue count-only inside toolSummaries.release"
  );
  assert(
    !v2CompositionSource.includes("function buildReleaseSnapshotFingerprint("),
    "v2 release summary bridge should stop carrying hosted release fingerprints once extension residue is count-only"
  );
  assert(
    v2CompositionSource.includes("function normalizeToolSummaryCount(value)"),
    "v2 composition should normalize compact hosted tool summary counts locally"
  );
  assert(
    !v2CompositionSource.includes("dataFreshness: normalizedMeetingTool.dataFreshness"),
    "v2 meeting summary state should not keep hosted freshness flags once the extension only needs the count"
  );
  assert(
    !v2CompositionSource.includes("function buildMeetingSnapshotFingerprint("),
    "v2 meeting snapshot bridge should stop carrying hosted-owned meeting fingerprints once extension residue is count-only"
  );
  assert(
    v2CompositionSource.includes("const toolSummarySnapshotBridges = {"),
    "v2 composition should keep compact meeting/release render summary helpers in a shared tool summary bridge map"
  );
  assert(
    v2CompositionSource.includes("buildToolSummarySnapshot(toolId) {"),
    "v2 render wiring should request meeting/release snapshots through a shared tool summary callback"
  );
  assert(
    v2CompositionSource.includes("getToolSummaryCount(toolId, toolSummary) {"),
    "v2 render wiring should request meeting/release rail counts through a shared tool summary callback"
  );
  assert(
    v2CompositionSource.includes("toolSummarySnapshotBridges[normalizeToolSummaryId(toolId)]?.buildSnapshot?.() || {}"),
    "v2 render wiring should resolve compact meeting/release snapshots from the shared tool summary bridge map"
  );
  assert(
    v2CompositionSource.includes("toolSummarySnapshotBridges[normalizeToolSummaryId(toolId)]?.getCount?.(toolSummary) || 0"),
    "v2 render wiring should resolve compact meeting/release rail counts from the shared tool summary bridge map"
  );
  assert(
    !v2CompositionSource.includes("panelMeetingController.buildToolState?.(meetingHub)"),
    "v2 meeting snapshot shaping should not depend on panel meeting action UI state"
  );
  [
    "const promptSyncBridge = {",
    "ensureStoreLoaded: promptSyncBridge.ensureStoreLoaded",
    "schedulePromptCloudSyncIfNeeded:",
    "schedulePromptRealtimeSync:",
    "isStoreTabActive: runtimeFlags.isStoreTabActive",
  ].forEach((pattern) => assert(
    !v2CompositionSource.includes(pattern),
    `v2 composition should drop dead prompt shell sidecar residue ${pattern}`
  ));
  assert(
    v2CompositionSource.includes("function handleToolSummarySync(toolId, toolState = {})"),
    "v2 composition should route compact hosted tool summary sync callbacks through a shared dispatcher"
  );
  assert(
    v2CompositionSource.includes("function normalizeToolSummary(toolId, toolSummary = {})"),
    "v2 composition should normalize compact hosted meeting/release residue through a shared tool summary helper"
  );
  assert(
    v2CompositionSource.includes("function shouldUpdateToolSummary(toolSummaries, toolId, nextSummary)"),
    "v2 composition should diff compact hosted meeting/release residue through a shared tool summary helper"
  );
  assert(
    !v2CompositionSource.includes("function buildHostedOwnedPanelCallbacks(deps = {})"),
    "v2 composition should rely on the shared shell callback builder once hosted release fallback is gone"
  );
  assert(
    !v2CompositionSource.includes("onReleaseAction:"),
    "v2 composition should stop carrying a release-action callback once hosted release actions stay local"
  );
  assert(
    !v2CompositionSource.includes("shouldListenMeetingStorageChanges:"),
    "v2 bootstrap wiring should no longer expose dead meeting storage listener toggles"
  );
  assert(
    !v2CompositionSource.includes("shouldPrimeMeetingSync:"),
    "v2 bootstrap wiring should no longer expose dead meeting sync priming toggles"
  );
  assert(
    v2CompositionSource.includes("panelDebugController"),
    "v2 render/bootstrap wiring should pass the debug controller through"
  );

  console.log("[verify-panel-v2-composition] V2 panel composition contract passed");
}

main();
