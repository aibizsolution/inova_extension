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
    scriptList.includes("content/panel-v2-prompt-controller.js"),
    "manifest should load the v2 prompt controller in the active 1.0.0 bundle"
  );
  [
    "hosting/meeting/debug-console.js",
    "shared/meeting-debug.js",
    "shared/meeting-bridge.js",
    "shared/release-info.js",
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
    mainSource.includes("namespace.panelV2CompositionController"),
    "content/main.js should reference the v2 composition root"
  );
  assert(
    !mainSource.includes("namespace.panelCompositionController"),
    "content/main.js should stop wiring the legacy panel composition into the active 1.0.0 bundle"
  );
  assert(
    v2CompositionSource.includes("namespace.panelBootstrapController.create"),
    "v2 composition should keep the existing bootstrap controller contract"
  );
  assert(
    v2CompositionSource.includes("namespace.panelDebugController.create"),
    "v2 composition should wire the debug controller"
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
    v2CompositionSource.includes("onRouteStateChanged: hostedOwnedIdleMeetingLifecycle.handleRouteStateChange"),
    "v2 route sync should stop delegating route refresh decisions to the legacy meeting manager"
  );
  assert(
    v2CompositionSource.includes("createHostedOwnedIdleMeetingLifecycleBridge"),
    "v2 composition should provide an idle meeting lifecycle bridge for unrelated shell sidecars"
  );
  assert(
    /const panelActivityController = namespace\.panelActivityController\.create\(state, \{[\s\S]*?meetingManager: hostedOwnedIdleMeetingLifecycle,/.test(v2CompositionSource),
    "v2 browser visibility/focus should stop waking extension meeting sync"
  );
  assert(
    /const panelShellController = namespace\.panelShellController\.create\(state, \{[\s\S]*?meetingManager: hostedOwnedIdleMeetingLifecycle,/.test(v2CompositionSource),
    "v2 shell tool transitions should stop waking extension meeting sync"
  );
  assert(
    /const panelLifecycleController = namespace\.panelLifecycleController\.create\(state, \{[\s\S]*?meetingManager: hostedOwnedIdleMeetingLifecycle,/.test(v2CompositionSource),
    "v2 panel toggle transitions should stop waking extension meeting sync"
  );
  assert(
    /const panelBootstrapController = namespace\.panelBootstrapController\.create\(state, \{[\s\S]*?meetingManager: hostedOwnedIdleMeetingLifecycle,/.test(v2CompositionSource),
    "v2 bootstrap should stop wiring meeting sync through the extension lifecycle bridge"
  );
  assert(
    /const panelSurfaceController = namespace\.panelSurfaceController\.create\(state, \{[\s\S]*?meetingManager: hostedOwnedIdleMeetingLifecycle,/.test(v2CompositionSource),
    "v2 composition should silence surface-driven meeting sync with the idle meeting lifecycle bridge"
  );
  assert(
    v2CompositionSource.includes("onPromptTabSelected: () => hostedOwnedIdleMeetingLifecycle.scheduleSync(0)"),
    "v2 prompt tab transitions should no longer wake meeting sync"
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
    v2CompositionSource.includes("createHostedOwnedPromptController"),
    "v2 composition should wrap prompt wiring for hosted-owned prompt tabs"
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
    v2CompositionSource.includes("createHostedOwnedIdleReleaseLifecycleBridge"),
    "v2 composition should provide an idle release bridge once hosted release owns release checks"
  );
  assert(
    v2CompositionSource.includes("handlePanelReleaseSummarySync: handleHostedReleaseSummarySync"),
    "v2 bootstrap wiring should accept compact hosted release summary sync callbacks"
  );
  assert(
    v2CompositionSource.includes("const hostedOwnedReleaseSnapshot = createHostedOwnedReleaseSnapshotBridge(() => state.releaseSummary);"),
    "v2 render wiring should shape release state from a compact hosted release summary"
  );
  assert(
    v2CompositionSource.includes("state.releaseSummary"),
    "v2 composition should keep hosted-owned release residue in a dedicated compact releaseSummary state bucket"
  );
  assert(
    !v2CompositionSource.includes("state.releaseInfo"),
    "v2 composition should stop reading legacy releaseInfo state directly"
  );
  assert(
    v2CompositionSource.includes("let hostedOwnedPromptController = null;"),
    "v2 composition should track the hosted-owned prompt controller directly"
  );
  assert(
    v2CompositionSource.includes("getPromptController: () => hostedOwnedPromptController"),
    "v2 shell wiring should read prompt tool behaviors directly from the hosted-owned prompt controller"
  );
  assert(
    v2CompositionSource.includes("panelPromptController: hostedOwnedPromptController"),
    "v2 render/bootstrap wiring should pass the hosted-owned prompt controller directly"
  );
  assert(
    v2CompositionSource.includes("createHostedOwnedPromptSnapshotBridge"),
    "v2 composition should wrap prompt snapshot shaping for hosted-owned prompt state"
  );
  assert(
    v2CompositionSource.includes("buildPromptSnapshot: hostedOwnedPromptSnapshot.buildPromptSnapshot"),
    "v2 render wiring should pass the hosted-owned prompt snapshot bridge"
  );
  assert(
    v2CompositionSource.includes("createHostedOwnedConversationSnapshotBridge"),
    "v2 composition should wrap conversation snapshot shaping for hosted-owned conversation state"
  );
  assert(
    v2CompositionSource.includes("buildConversationSnapshot: hostedOwnedConversationSnapshot.buildConversationSnapshot"),
    "v2 render wiring should pass the hosted-owned conversation snapshot bridge"
  );
  assert(
    v2CompositionSource.includes("createHostedOwnedMeetingSnapshotBridge"),
    "v2 composition should wrap meeting snapshot shaping for hosted-owned meeting state"
  );
  assert(
    v2CompositionSource.includes("const hostedOwnedMeetingSnapshot = createHostedOwnedMeetingSnapshotBridge();"),
    "v2 meeting snapshot bridge should derive snapshot state from the hosted meeting summary without the legacy meeting manager"
  );
  assert(
    !v2CompositionSource.includes("state.meetingHub"),
    "v2 composition should stop storing hosted-owned meeting summary residue in the legacy meetingHub state bucket"
  );
  assert(
    v2CompositionSource.includes("state.meetingSummary"),
    "v2 composition should keep hosted-owned meeting residue in a dedicated compact meetingSummary state bucket"
  );
  assert(
    v2CompositionSource.includes("const explicitFingerprint = normalizeText(meetingTool?.snapshotFingerprint);"),
    "v2 meeting snapshot bridge should honor an explicit hosted-owned meeting fingerprint"
  );
  assert(
    v2CompositionSource.includes("function normalizeHostedMeetingSummary(meetingTool)"),
    "v2 composition should normalize hosted meeting summary payloads locally"
  );
  assert(
    !v2CompositionSource.includes("dataFreshness: normalizedMeetingTool.dataFreshness"),
    "v2 meeting summary state should not keep hosted freshness flags once the extension only needs count and fingerprint"
  );
  assert(
    v2CompositionSource.includes("buildMeetingSnapshot: hostedOwnedMeetingSnapshot.buildMeetingSnapshot"),
    "v2 render wiring should pass the hosted-owned meeting snapshot bridge"
  );
  assert(
    !v2CompositionSource.includes("panelMeetingController.buildToolState?.(meetingHub)"),
    "v2 meeting snapshot shaping should not depend on panel meeting action UI state"
  );
  assert(
    v2CompositionSource.includes("handleStorageChange() {}"),
    "v2 hosted-owned prompt wrapper should silence legacy prompt storage listeners"
  );
  assert(
    v2CompositionSource.includes("scheduleCloudSyncIfNeeded() {}"),
    "v2 hosted-owned prompt wrapper should silence legacy prompt cloud sync scheduling"
  );
  assert(
    v2CompositionSource.includes("scheduleRealtimeSync() {}"),
    "v2 hosted-owned prompt wrapper should silence legacy prompt realtime scheduling"
  );
  assert(
    v2CompositionSource.includes("buildHostedPanelCallbacks: buildHostedOwnedPanelCallbacks"),
    "v2 bootstrap should provide a hosted-owned callback surface instead of passing the legacy default callback set through unchanged"
  );
  assert(
    v2CompositionSource.includes("handlePanelMeetingSummarySync: handleHostedMeetingSummarySync"),
    "v2 bootstrap should accept hosted-owned meeting summary sync callbacks"
  );
  assert(
    v2CompositionSource.includes("function buildHostedOwnedPanelCallbacks(deps = {})"),
    "v2 composition should define a hosted-owned callback builder for the panel host"
  );
  [
    "onCopyBookmark:",
    "onHandlePositionChange:",
    "onJumpBookmark:",
    "onMeetingSummarySync:",
    "onReleaseAction:",
    "onSearch:",
    "onSearchSubmit:",
    "onSelectTool:",
    "onEscape:",
    "onToggle:",
  ].forEach((pattern) => assert(
    v2CompositionSource.includes(pattern),
    `v2 hosted-owned callback builder should keep the active shell callback ${pattern}`
  ));
  [
    "onMeetingAction:",
    "onImportFile:",
    "onMovePrompt:",
    "onPromptAction:",
    "onPromptDraftChange:",
    "onSelectPromptTab:",
    "onStoreAction:",
  ].forEach((pattern) => assert(
    !v2CompositionSource.includes(pattern),
    `v2 hosted-owned callback builder should drop the legacy callback ${pattern}`
  ));
  assert(
    v2CompositionSource.includes("shouldListenMeetingStorageChanges: () => false"),
    "v2 bootstrap wiring should not subscribe meeting storage change listeners"
  );
  assert(
    v2CompositionSource.includes("shouldPrimeMeetingSync: () => false"),
    "v2 bootstrap wiring should stop priming extension meeting sync"
  );
  assert(
    v2CompositionSource.includes("panelDebugController"),
    "v2 render/bootstrap wiring should pass the debug controller through"
  );

  console.log("[verify-panel-v2-composition] V2 panel composition contract passed");
}

main();
