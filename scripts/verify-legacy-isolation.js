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
  assert(
    !jsFiles.includes("shared/provider-identity.js"),
    "active manifest should not preload the browser-only provider identity sensor from shared root"
  );
  assert(
    jsFiles.includes("content/provider-identity-sensor.js"),
    "active manifest should preload the content-owned provider identity sensor"
  );
  assert(
    !jsFiles.includes("shared/frame-proxy.js"),
    "active manifest should not preload the browser-only frame proxy helper from shared root"
  );
  assert(
    jsFiles.includes("content/frame-proxy-helper.js"),
    "active manifest should preload the content-owned frame proxy helper"
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
  assert(
    !fs.existsSync(path.join(root, "shared", "prompt-library.js")),
    "active shared root should not keep the dormant prompt library helper"
  );
  assert(
    !fs.existsSync(path.join(root, "shared", "prompt-store.js")),
    "active shared root should not keep the dormant prompt store helper"
  );
  assert(
    !fs.existsSync(path.join(root, "shared", "provider-identity.js")),
    "active shared root should not keep the browser-only provider identity sensor"
  );
  assert(
    !fs.existsSync(path.join(root, "shared", "frame-proxy.js")),
    "active shared root should not keep the browser-only frame proxy helper"
  );
  assert(
    !fs.existsSync(path.join(root, "shared", "cloud-api.js")),
    "active shared root should not keep the background-only cloud API helper"
  );
  assert(
    !fs.existsSync(path.join(root, "shared", "inova-auth.js")),
    "active shared root should not keep the background-only i-Nova auth helper"
  );
  assert(
    fs.existsSync(path.join(root, "backup", "legacy-panel", "shared", "provider-identity.js")),
    "backup legacy shared lane should keep the legacy provider identity sensor"
  );
  assert(
    fs.existsSync(path.join(root, "backup", "legacy-panel", "shared", "prompt-library.js")),
    "backup legacy shared lane should keep the dormant prompt library helper"
  );
  assert(
    fs.existsSync(path.join(root, "backup", "legacy-panel", "shared", "prompt-store.js")),
    "backup legacy shared lane should keep the dormant prompt store helper"
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
    !bridgeSource.includes('if (action === "tool-summary-sync")'),
    "active hosted bridge should not keep the removed tool-summary-sync request surface"
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
  const browserCapabilitySource = fs.readFileSync(path.join(root, "background", "browser-capability.js"), "utf8");
  const cloudApiClientSource = fs.readFileSync(path.join(root, "background", "cloud-api-client.js"), "utf8");
  const capabilityManifestValidatorSource = fs.readFileSync(path.join(root, "background", "capability-manifest-validator.js"), "utf8");
  const functionsRuntimeSource = fs.readFileSync(path.join(root, "background", "functions-runtime-config.js"), "utf8");
  const inovaAuthClientSource = fs.readFileSync(path.join(root, "background", "inova-auth-client.js"), "utf8");
  const panelSessionCapabilitySource = fs.readFileSync(path.join(root, "background", "panel-session-capability.js"), "utf8");
  const meetingWorkspaceCapabilitySource = fs.readFileSync(
    path.join(root, "background", "meeting-workspace-capability.js"),
    "utf8"
  );

  assert(
    serviceWorkerSource.includes("ACTIVE_BACKGROUND_MESSAGE_TYPES"),
    "background service worker should keep a dedicated active top-level message catalog"
  );
  assert(
    serviceWorkerSource.includes('importScripts("browser-capability.js");'),
    "background service worker should preload the dedicated browser capability module"
  );
  assert(
    serviceWorkerSource.includes('importScripts("inova-auth-client.js");'),
    "background service worker should preload the dedicated i-Nova auth client module"
  );
  assert(
    serviceWorkerSource.includes('importScripts("cloud-api-client.js");'),
    "background service worker should preload the dedicated cloud API client module"
  );
  assert(
    serviceWorkerSource.includes('importScripts("functions-runtime-config.js");'),
    "background service worker should preload the dedicated functions runtime config module"
  );
  assert(
    serviceWorkerSource.includes('importScripts("capability-manifest-validator.js");')
      && serviceWorkerSource.indexOf('importScripts("capability-manifest-validator.js");')
        < serviceWorkerSource.indexOf('importScripts("functions-runtime-config.js");'),
    "background service worker should preload the capability manifest validator before functions runtime config"
  );
  assert(
    inovaAuthClientSource.includes("namespace.inovaAuth = {"),
    "background i-Nova auth client should expose the shared auth namespace"
  );
  assert(
    cloudApiClientSource.includes("namespace.cloudApi = {"),
    "background cloud API client should expose the shared cloud API namespace"
  );
  assert(
    functionsRuntimeSource.includes("namespace.functionsRuntimeConfig = {"),
    "background functions runtime config should expose the shared runtime config namespace"
  );
  assert(
    capabilityManifestValidatorSource.includes("namespace.capabilityManifestValidator = {"),
    "background capability manifest validator should expose the shared validator namespace"
  );
  assert(
    browserCapabilitySource.includes("chrome.tabs.create({ url: nextUrl }"),
    "background browser capability should own the direct tab open adapter"
  );
  assert(
    browserCapabilitySource.includes("namespace.browserCapability = {"),
    "background browser capability should expose the shared browser capability namespace"
  );
  assert(
    serviceWorkerSource.includes('importScripts("meeting-workspace-capability.js");'),
    "background service worker should preload the dedicated meeting workspace capability module"
  );
  assert(
    serviceWorkerSource.includes('importScripts("panel-session-capability.js");'),
    "background service worker should preload the dedicated panel session capability module"
  );
  assert(
    panelSessionCapabilitySource.includes("namespace.panelAuthCache?.create?.(getInovaAccessToken)"),
    "panel session capability should own the panel auth cache wrapper"
  );
  assert(
    panelSessionCapabilitySource.includes("functionsRuntimeConfig.getPromptRuntimeConfig?.()"),
    "panel session capability should delegate prompt runtime resolution to the background functions runtime config"
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
    "openHostedMeetingPage(",
    "buildHostedMeetingCleanUrl(",
    "resolveMeetingProviderIdentity(",
    "requestMeetingProviderIdentityFromInovaTabs(",
    "HOSTED_MEETING_ALLOWED_ORIGINS",
    "async function getInovaAccessToken(",
    "async function issuePromptPanelAuth(",
    "async function issueMeetingPanelAuth(",
    "async function getPromptFunctionsConfig(",
    "async function getPromptRuntimeConfig(",
    "issueInovaPromptPanelAuthUrl: \"issueInovaPromptPanelAuthV2\"",
    "loadInovaPromptLibraryUrl: \"loadInovaPromptLibraryV2\"",
    "peekInovaPromptLibraryUrl: \"peekInovaPromptLibraryV2\"",
    "syncInovaPromptLibraryUrl: \"syncInovaPromptLibraryV2\"",
    "async function openReleaseUrl(",
    "function createBrowserTab(",
    "meetingListCache",
    "recentLoadResults",
    "recentPeekResults",
    "recentReleaseResults",
    "recentSyncResults",
    'importScripts("../shared/inova-auth.js");',
    'importScripts("../shared/cloud-api.js");',
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
  assert(
    meetingWorkspaceCapabilitySource.includes("namespace.providerIdentityCache?.normalizeProviderIdentity"),
    "meeting workspace capability should reuse the shared provider identity cache normalizer"
  );
  assert(
    meetingWorkspaceCapabilitySource.includes("browserCapability.openUrl"),
    "meeting workspace capability should reuse the shared browser open-url adapter"
  );
  assert(
    !serviceWorkerSource.includes("chrome.tabs.create("),
    "background service worker should not open browser tabs directly"
  );
  assert(
    !serviceWorkerSource.includes("chrome.cookies.get("),
    "background service worker should not read panel auth cookies directly"
  );
  assert(
    !meetingWorkspaceCapabilitySource.includes("chrome.tabs.create("),
    "meeting workspace capability should not open browser tabs directly"
  );
  assert(
    !meetingWorkspaceCapabilitySource.includes("function normalizeProviderIdentity("),
    "meeting workspace capability should not redefine its own provider identity normalizer"
  );
  assert(
    !meetingWorkspaceCapabilitySource.includes("function createBrowserTab("),
    "meeting workspace capability should not redefine its own browser tab opener"
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
