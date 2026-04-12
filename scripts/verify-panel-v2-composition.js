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
    scriptList.includes("content/panel-v2-composition-controller.js"),
    "manifest should load the v2 composition controller before content/main.js"
  );
  assert(
    mainSource.includes("namespace.productLane?.isV2Lane?.()"),
    "content/main.js should select the v2 composition by lane"
  );
  assert(
    mainSource.includes("namespace.panelV2CompositionController"),
    "content/main.js should reference the v2 composition root"
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
    v2CompositionSource.includes("namespace.meetingManager.create"),
    "v2 composition should still instantiate the meeting manager while hosted ownership is partial"
  );
  assert(
    v2CompositionSource.includes("createHostedOwnedMeetingLifecycleBridge"),
    "v2 composition should wrap meeting shell lifecycle with a hosted-owned bridge"
  );
  assert(
    v2CompositionSource.includes("let panelMeetingController = null;"),
    "v2 composition should keep meeting fallback controller creation lazy"
  );
  assert(
    v2CompositionSource.includes("getPanelMeetingController"),
    "v2 composition should provide a lazy getter for meeting fallback handling"
  );
  assert(
    v2CompositionSource.includes("onRouteStateChanged: hostedOwnedMeetingLifecycle.handleRouteStateChange"),
    "v2 route sync should stop delegating route refresh decisions to the legacy meeting manager"
  );
  assert(
    v2CompositionSource.includes("createHostedOwnedIdleMeetingLifecycleBridge"),
    "v2 composition should provide an idle meeting lifecycle bridge for unrelated shell sidecars"
  );
  assert(
    v2CompositionSource.includes("meetingManager: hostedOwnedMeetingLifecycle"),
    "v2 composition should pass the hosted-owned meeting lifecycle bridge into shared shell controllers"
  );
  assert(
    v2CompositionSource.includes("meetingManager: hostedOwnedIdleMeetingLifecycle"),
    "v2 composition should silence unrelated surface-driven meeting sync in v2"
  );
  assert(
    v2CompositionSource.includes("onPromptTabSelected: () => hostedOwnedIdleMeetingLifecycle.scheduleSync(0)"),
    "v2 prompt tab transitions should no longer wake meeting sync"
  );
  assert(
    v2CompositionSource.includes("namespace.panelActionController.create"),
    "v2 composition should wire the shared panel action controller"
  );
  assert(
    v2CompositionSource.includes("getPanelMeetingController,"),
    "v2 action wiring should defer meeting fallback controller creation until needed"
  );
  assert(
    v2CompositionSource.includes("namespace.panelPromptBridgeController.create"),
    "v2 composition should wire the prompt bridge controller"
  );
  assert(
    v2CompositionSource.includes("createHostedOwnedPromptController"),
    "v2 composition should wrap prompt wiring for hosted-owned prompt tabs"
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
    v2CompositionSource.includes("createHostedOwnedMeetingSnapshotBridge(namespace.meetingManager)"),
    "v2 meeting snapshot bridge should derive snapshot state from the raw meeting hub summary"
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
    v2CompositionSource.includes("handlePanelMeetingAction: panelActionController.handlePanelMeetingAction"),
    "v2 bootstrap should forward hosted meeting actions into the shared top-panel dispatcher"
  );
  assert(
    v2CompositionSource.includes("shouldListenMeetingStorageChanges: () => false"),
    "v2 bootstrap wiring should not subscribe meeting storage change listeners"
  );
  assert(
    v2CompositionSource.includes("shouldPrimeMeetingSync: () => state.activeTool === \"meeting\""),
    "v2 bootstrap wiring should only prime meeting sync when the meeting tool starts active"
  );
  assert(
    v2CompositionSource.includes("panelDebugController"),
    "v2 render/bootstrap wiring should pass the debug controller through"
  );

  console.log("[verify-panel-v2-composition] V2 panel composition contract passed");
}

main();
