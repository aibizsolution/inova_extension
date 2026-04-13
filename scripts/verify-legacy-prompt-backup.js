#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function main() {
  verifyLegacyPromptHubShowPromptTabContract();
  verifyLegacyPromptRuntimeLocalWiring();
  verifyLegacyPromptLibraryRemoteFirstWiring();
  console.log("[verify-legacy-prompt-backup] Legacy prompt backup contract passed");
}

function verifyLegacyPromptHubShowPromptTabContract() {
  const promptHubControllerSource = read(path.join("backup", "legacy-panel", "prompt-hub-controller.js"));

  assert(
    promptHubControllerSource.includes("onSelectPromptTab(nextPromptTab);"),
    "legacy prompt hub should notify prompt tab observers when showPromptTab changes tabs"
  );
  assert(
    promptHubControllerSource.includes("if (nextPromptTab === \"store\") {\r\n        storeManager.ensureLoaded();")
      || promptHubControllerSource.includes("if (nextPromptTab === \"store\") {\n        storeManager.ensureLoaded();"),
    "legacy prompt hub should load the store when showPromptTab opens the store tab"
  );
  assert(
    promptHubControllerSource.includes("render();"),
    "legacy prompt hub should rerender immediately when showPromptTab changes the active tab"
  );
}

function verifyLegacyPromptRuntimeLocalWiring() {
  const promptRealtimeManager = read(path.join("backup", "legacy-panel", "features", "prompt-store", "prompt-realtime-manager.js"));

  assert(
    /namespace\.firebaseConfig\?\.prompt\?\.resolveRuntime\?\.\(state\.settings\)/.test(promptRealtimeManager),
    "legacy prompt realtime manager가 state.settings 기준 runtime을 계산해야 합니다."
  );
  assert(
    /runtimeConfig\?\.hosting\?\.promptPanelBridgeUrl/.test(promptRealtimeManager),
    "legacy prompt realtime manager가 runtime bridge URL을 써야 합니다."
  );
  assert(
    /runtimeConfig\?\.hosting\?\.originUrl/.test(promptRealtimeManager),
    "legacy prompt realtime manager가 runtime bridge origin을 써야 합니다."
  );
}

function verifyLegacyPromptLibraryRemoteFirstWiring() {
  const cloudSyncManager = read(path.join("backup", "legacy-panel", "features", "prompt-library", "cloud-sync-manager.js"));
  assert(/savePromptItem/.test(cloudSyncManager), "legacy cloud sync manager가 remote save entrypoint를 가져야 합니다.");
  assert(/removePromptItem/.test(cloudSyncManager), "legacy cloud sync manager가 remote delete entrypoint를 가져야 합니다.");
  assert(/movePromptItem/.test(cloudSyncManager), "legacy cloud sync manager가 remote reorder entrypoint를 가져야 합니다.");
  assert(/importPromptLibrary/.test(cloudSyncManager), "legacy cloud sync manager가 remote import entrypoint를 가져야 합니다.");
  assert(/importStorePrompt/.test(cloudSyncManager), "legacy cloud sync manager가 remote store import entrypoint를 가져야 합니다.");
  assert(/loadPromptLibraryNow/.test(cloudSyncManager), "legacy cloud sync manager가 remote load entrypoint를 가져야 합니다.");
  assert(/sendRuntimeMessage\("inova-sync:load-prompt-library"/.test(cloudSyncManager), "legacy cloud sync manager가 remote load를 직접 호출해야 합니다.");
  assert(/sendRuntimeMessage\("inova-sync:sync-prompt-library"/.test(cloudSyncManager), "legacy cloud sync manager가 remote sync를 직접 호출해야 합니다.");

  const promptManager = read(path.join("backup", "legacy-panel", "features", "prompt-library", "prompt-manager.js"));
  assert(!/namespace\.storage\.savePromptItem/.test(promptManager), "legacy prompt manager는 local-first save를 직접 호출하면 안 됩니다.");
  assert(!/namespace\.storage\.removePromptItem/.test(promptManager), "legacy prompt manager는 local-first delete를 직접 호출하면 안 됩니다.");
  assert(!/namespace\.storage\.importPromptLibrary/.test(promptManager), "legacy prompt manager는 local-first import를 직접 호출하면 안 됩니다.");
  assert(/hooks\.savePromptItem/.test(promptManager), "legacy prompt manager는 remote save hook을 써야 합니다.");
  assert(/hooks\.removePromptItem/.test(promptManager), "legacy prompt manager는 remote delete hook을 써야 합니다.");
  assert(/hooks\.importPromptLibrary/.test(promptManager), "legacy prompt manager는 remote import hook을 써야 합니다.");

  const promptHubController = read(path.join("backup", "legacy-panel", "prompt-hub-controller.js"));
  assert(!/namespace\.storage\.movePromptItem/.test(promptHubController), "legacy prompt hub controller는 local-first reorder를 직접 호출하면 안 됩니다.");
  assert(/cloudSyncManager\.movePromptItem/.test(promptHubController), "legacy prompt hub controller는 remote reorder를 써야 합니다.");

  const storeManager = read(path.join("backup", "legacy-panel", "features", "prompt-store", "store-manager.js"));
  assert(/hooks\.importStorePrompt/.test(storeManager), "legacy store manager는 remote store import hook을 지원해야 합니다.");
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

main();
