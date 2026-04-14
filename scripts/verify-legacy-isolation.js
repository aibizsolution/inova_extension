#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function main() {
  verifyDefaultVerifyKeepsLegacyChecksSeparate();
  verifyActiveManifestStaysOutOfBackupLegacyFiles();
  verifyActiveManifestDropsDormantPromptLibraryHelper();
  verifyActiveContentSourcesDoNotDependOnBackupPaths();
  verifyActiveHostedPanelAssetsStayOutOfDeadLegacyFiles();
  verifyActiveHostedBridgeRequestSurfaceStaysGeneric();
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
