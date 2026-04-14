#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function main() {
  verifyHostedBridgeRequestModuleContract();
  console.log("[verify-panel-hosted-request-modules] Hosted panel request helper contract passed");
}

function verifyHostedBridgeRequestModuleContract() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8")
  );
  const topPanelSource = fs.readFileSync(
    path.join(root, "content", "panel.js"),
    "utf8"
  );
  const bridgeRequestSource = fs.readFileSync(
    path.join(root, "content", "hosted-panel-bridge.js"),
    "utf8"
  );

  const mainContentScript = manifest.content_scripts.find((entry) =>
    Array.isArray(entry?.matches) && entry.matches.includes("https://inova.incross.com/*")
  );
  const scriptList = Array.isArray(mainContentScript?.js) ? mainContentScript.js : [];
  const helperIndex = scriptList.indexOf("content/hosted-panel-bridge.js");
  const panelIndex = scriptList.indexOf("content/panel.js");

  assert(helperIndex !== -1, "manifest should load the hosted panel bridge helper");
  assert(panelIndex !== -1 && helperIndex < panelIndex, "manifest should load the hosted panel bridge helper before content/panel.js");
  assert(
    topPanelSource.includes("namespace.panelHostedBridgeRequest?.handle?."),
    "content/panel.js should delegate bridge-domain request routing to the dedicated helper module"
  );
  assert(
    !topPanelSource.includes("function handleBridgeRequest("),
    "content/panel.js should not keep inline bridge request routing once the bridge helper exists"
  );
  [
    "content/panel-hosted-meeting-request.js",
    "content/panel-hosted-prompt-request.js",
    "content/panel-hosted-runtime-request.js",
    "content/panel-hosted-page-request.js",
    "content/panel-hosted-shell-request.js",
  ].forEach((file) => assert(
    !scriptList.includes(file),
    `manifest should stop loading the inlined hosted helper ${file}`
  ));
  assert(
    !scriptList.includes("content/panel-hosted-bridge-request.js"),
    "manifest should stop loading the separate hosted bridge request helper once hosted-panel-bridge.js owns both responsibilities"
  );
  [
    "namespace.panelHostedMeetingRequest?.handle?.",
    "namespace.panelHostedPromptRequest?.handle?.",
    "namespace.panelHostedRuntimeRequest?.handle?.",
    "namespace.panelHostedPageRequest?.handle?.",
    "namespace.panelHostedShellRequest?.handle?.",
  ].forEach((pattern) => assert(
    !bridgeRequestSource.includes(pattern),
    `hosted bridge request helper should stop delegating through ${pattern}`
  ));
  [
    'if (domain === "runtime")',
    'if (domain === "page")',
    'if (domain === "panel")',
    "handleRuntimeRequest(",
    "handlePageRequest(",
    "handlePanelRequest(",
    "handlePanelSummaryRequest(",
    "handleReleaseRequest(",
    "handleConversationRequest(",
    'if (action === "meeting-summary-sync")',
    'typeof callbacks.onMeetingSummarySync !== "function"',
    'if (action === "toggle-panel")',
    'if (action === "escape")',
    'if (action === "select-tool")',
    'if (action === "search")',
    'if (action === "search-submit")',
    'if (action === "bookmark-copy")',
    'if (action === "bookmark-jump")',
    'if (action === "release-summary-sync")',
    'if (action === "release-action")',
    'if (action === "copy-text")',
    'if (action === "copy-debug-log")',
    'if (action === "clear-debug-log")',
    'if (action === "log-trace")',
    'if (action === "get-composer-state")',
    'if (action === "apply-prompt-text")',
    'if (action === "get-conversation-state" || action === "get-conversation-snapshot")',
    'if (action === "jump-conversation-item")',
    'if (action === "get-debug-state")',
    'if (action === "set-debug-enabled")',
    "global.chrome?.runtime?.sendMessage",
  ].forEach((pattern) => assert(
    bridgeRequestSource.includes(pattern),
    `hosted bridge request helper should keep the inline contract for ${pattern}`
  ));
  [
    "handleLegacyPanelRequest(",
    "handleLegacyMeetingRequest(",
    "handleLegacyPromptRequest(",
    'if (action === "meeting-action")',
    'typeof callbacks.onMeetingAction !== "function"',
    'if (action === "prompt-action")',
    'if (action === "prompt-draft-change")',
    'if (action === "prompt-tab-select")',
    'if (action === "store-action")',
    'if (action === "import-file")',
    'if (action === "move-prompt")',
    'typeof callbacks.onPromptAction !== "function"',
    'typeof callbacks.onPromptDraftChange !== "function"',
    'typeof callbacks.onSelectPromptTab !== "function"',
    'typeof callbacks.onStoreAction !== "function"',
    'typeof callbacks.onImportFile !== "function"',
    'typeof callbacks.onMovePrompt !== "function"',
  ].forEach((pattern) => assert(
    !bridgeRequestSource.includes(pattern),
    `hosted bridge request helper should drop the inactive legacy request surface ${pattern}`
  ));
}

main();
