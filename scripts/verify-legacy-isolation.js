#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function main() {
  verifyDefaultVerifyKeepsLegacyChecksSeparate();
  verifyActiveManifestStaysOutOfBackupLegacyFiles();
  verifyActiveManifestDropsDormantPromptLibraryHelper();
  verifyActiveSharedRootDropsLegacyCloudSyncHelper();
  verifyActiveContentSourcesDoNotDependOnBackupPaths();
  verifyActiveHostedPanelAssetsStayOutOfDeadLegacyFiles();
  verifyActiveHostedBridgeRequestSurfaceStaysGeneric();
  verifyActiveHostedRuntimeStorageSurfaceStaysCompact();
  verifyActiveBackgroundMessageSurfaceStaysNarrow();
  verifyActivePromptShellContractDropsLegacyName();
  console.log("[verify-legacy-isolation] Active v2 legacy isolation contract passed");
}

function verifyDefaultVerifyKeepsLegacyChecksSeparate() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const defaultVerify = String(packageJson.scripts?.verify || "");
  const legacyVerify = String(packageJson.scripts?.["verify:legacy-backup"] || "");

  assert(
    defaultVerify.includes("node scripts/verify-legacy-isolation.js"),
    "default verify should include the active legacy isolation guard"
  );
  assert(
    !defaultVerify.includes("scripts/legacy-panel/"),
    "default verify should keep backup legacy checks out of the active v2 lane"
  );
  assert(
    legacyVerify.includes("scripts/legacy-panel/"),
    "backup legacy checks should stay behind verify:legacy-backup"
  );
}

function verifyActiveManifestStaysOutOfBackupLegacyFiles() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const mainContentScript = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts.find((entry) => Array.isArray(entry?.matches) && entry.matches.includes("https://inova.incross.com/*"))
    : null;
  const jsFiles = Array.isArray(mainContentScript?.js) ? mainContentScript.js : [];
  const cssFiles = Array.isArray(mainContentScript?.css) ? mainContentScript.css : [];

  assert(
    jsFiles.every((file) => !String(file).startsWith("backup/legacy-panel/")),
    "active manifest should not load backup legacy panel scripts"
  );
  assert(
    cssFiles.every((file) => !String(file).startsWith("backup/legacy-panel/")),
    "active manifest should not load backup legacy panel styles"
  );
}

function verifyActiveManifestDropsDormantPromptLibraryHelper() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const mainContentScript = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts.find((entry) => Array.isArray(entry?.matches) && entry.matches.includes("https://inova.incross.com/*"))
    : null;
  const jsFiles = Array.isArray(mainContentScript?.js) ? mainContentScript.js : [];

  assert(
    !jsFiles.includes("shared/prompt-library.js"),
    "active manifest should not preload the dormant shared/prompt-library.js helper"
  );
}

function verifyActiveSharedRootDropsLegacyCloudSyncHelper() {
  assert(
    !fs.existsSync(path.join(root, "shared", "cloud-sync.js")),
    "active shared root should not keep the legacy cloud-sync helper"
  );
  assert(
    fs.existsSync(path.join(root, "backup", "legacy-panel", "shared", "cloud-sync.js")),
    "backup legacy shared lane should keep the legacy cloud-sync helper"
  );
}

function verifyActiveContentSourcesDoNotDependOnBackupPaths() {
  [
    "content/main.js",
    "content/panel.js",
    "content/panel-host-runtime.js",
    "content/panel-host-view.js",
    "content/hosted-panel-bridge.js",
    "content/panel-v2-composition-controller.js",
    "content/panel-v2-shell-bridge.js",
    "content/panel-v2-prompt-controller.js",
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert(
      !source.includes("backup/legacy-panel/"),
      `${relativePath} should not directly depend on backup legacy panel paths`
    );
  });
}

function verifyActiveHostedPanelAssetsStayOutOfDeadLegacyFiles() {
  const hostedIndexHtml = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.html"),
    "utf8"
  );

  [
    "legacy-panel.css",
    "legacy-tools.css",
    "prompt-hub-view.js",
    "prompt-hub-panel.js",
    "prompt-hub-controller.js",
    "prompt-hub-runtime.js",
  ].forEach((legacyAsset) => {
    assert(
      !hostedIndexHtml.includes(legacyAsset),
      `active hosted panel should not load the dead legacy asset ${legacyAsset}`
    );
  });

  assert(
    hostedIndexHtml.includes("./index.css"),
    "active hosted panel should load the single live index.css stylesheet"
  );
  assert(
    hostedIndexHtml.includes("./prompt-tool-panel.js"),
    "active hosted panel should load the live prompt-tool-panel helper"
  );
}

function verifyActiveHostedBridgeRequestSurfaceStaysGeneric() {
  const bridgeSource = fs.readFileSync(path.join(root, "content", "hosted-panel-bridge.js"), "utf8");

  [
    'action === "meeting-action"',
    'action === "release-action"',
    'action === "prompt-tab-select"',
    'action === "prompt-action"',
    'action === "prompt-draft-change"',
    'action === "store-action"',
    'action === "import-file"',
    'action === "move-prompt"',
  ].forEach((legacyActionSurface) => {
    assert(
      !bridgeSource.includes(legacyActionSurface),
      `active hosted bridge should not reopen the legacy panel request surface ${legacyActionSurface}`
    );
  });

  assert(
    bridgeSource.includes('if (action === "tool-summary-sync") {'),
    "active hosted bridge should keep the shared tool-summary-sync request surface"
  );
}

function verifyActiveHostedRuntimeStorageSurfaceStaysCompact() {
  const serviceWorkerSource = fs.readFileSync(path.join(root, "background", "service-worker.js"), "utf8");
  const routerSource = fs.readFileSync(path.join(root, "background", "panel-runtime-capability-router.js"), "utf8");
  const invokeSource = fs.readFileSync(path.join(root, "background", "panel-runtime-invoke.js"), "utf8");

  assert(
    serviceWorkerSource.includes('importScripts("panel-runtime-capability-router.js");'),
    "active hosted runtime should preload the dedicated runtime capability router"
  );
  assert(
    routerSource.includes("PANEL_RUNTIME_STORAGE_STATE_KEYS"),
    "active hosted runtime should keep a dedicated compact storage-state contract"
  );
  assert(
    invokeSource.includes("panelRuntimeCapabilityRouter.handle"),
    "active hosted runtime invoke shim should delegate to the runtime capability router"
  );
  [
    'action === "storage.get"',
    'action === "storage.set"',
    'action === "storage.update-settings"',
    'action === "storage.set-session-paused"',
  ].forEach((actionSurface) => assert(
    !routerSource.includes(actionSurface),
    `active hosted runtime should not reopen the dormant storage action ${actionSurface}`
  ));
  [
    '"meetingHub"',
    '"meetingStateByMeetingId"',
    '"pausedSessions"',
    '"productLaneMigration"',
    '"promptLibrary"',
    '"releaseInfo"',
  ].forEach((storageKey) => assert(
    !routerSource.includes(storageKey),
    `active hosted runtime should not leak dormant storage state ${storageKey}`
  ));
}

function verifyActiveBackgroundMessageSurfaceStaysNarrow() {
  const serviceWorkerSource = fs.readFileSync(path.join(root, "background", "service-worker.js"), "utf8");

  assert(
    serviceWorkerSource.includes("ACTIVE_BACKGROUND_MESSAGE_TYPES"),
    "background service worker should keep a dedicated active top-level message catalog"
  );
  [
    '"inova-meeting:authorize-workspace-access"',
    '"inova-meeting:probe-workspace-bridge"',
    '"inova-panel:invoke"',
  ].forEach((messageType) => assert(
    serviceWorkerSource.includes(messageType),
    `background service worker should keep the active top-level message ${messageType}`
  ));
  [
    "inova-sync:load-prompt-library",
    "inova-sync:peek-prompt-library",
    "inova-sync:sync-prompt-library",
    "inova-store:list",
    "inova-store:publish",
    "inova-store:unpublish",
    "inova-store:import",
    "inova-store:toggle-like",
    "inova-store:view",
    "inova-review:prompt",
    "inova-meeting:list-meetings",
    "inova-meeting:issue-panel-auth",
    "inova-prompt:issue-panel-auth",
    "inova-meeting:open-workspace",
    "inova-meeting:open-result",
    "inova-meeting:create-share-link",
    "inova-meeting:revoke-share-link",
    "inova-release:latest",
    "inova-release:history",
    "inova-release:open-url",
  ].forEach((legacyMessageType) => assert(
    !serviceWorkerSource.includes(legacyMessageType),
    `background service worker should not reopen the legacy top-level message ${legacyMessageType}`
  ));
  [
    'importScripts("meeting-list-cache.js");',
    "meetingListCache",
    "recentLoadResults",
    "recentPeekResults",
    "recentReleaseResults",
    "recentSyncResults",
  ].forEach((legacySurface) => assert(
    !serviceWorkerSource.includes(legacySurface),
    `background service worker should drop the dormant legacy surface ${legacySurface}`
  ));
  assert(
    !fs.existsSync(path.join(root, "background", "meeting-list-cache.js")),
    "active background root should not keep the dormant meeting-list-cache helper"
  );
  assert(
    fs.existsSync(path.join(root, "backup", "legacy-panel", "background", "meeting-list-cache.js")),
    "backup legacy lane should keep the dormant meeting-list-cache helper"
  );
}

function verifyActivePromptShellContractDropsLegacyName() {
  const shellBridgeSource = fs.readFileSync(path.join(root, "content", "panel-v2-shell-bridge.js"), "utf8");
  const compositionSource = fs.readFileSync(path.join(root, "content", "panel-v2-composition-controller.js"), "utf8");

  assert(
    !shellBridgeSource.includes("panelPromptController"),
    "active v2 shell bridge should stop using the legacy panelPromptController contract name"
  );
  assert(
    !compositionSource.includes("panelPromptController"),
    "active v2 composition should stop using the legacy panelPromptController contract name"
  );
  assert(
    shellBridgeSource.includes("promptShellController"),
    "active v2 shell bridge should use the promptShellController contract name"
  );
  assert(
    compositionSource.includes("promptShellController"),
    "active v2 composition should pass the prompt shell controller through the shared shell contract"
  );
}

main();
