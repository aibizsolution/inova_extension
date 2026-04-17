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
  const panelHostBridgeSource = fs.readFileSync(
    path.join(root, "content", "panel-host-bridge.js"),
    "utf8"
  );
  const pageCapabilityRouterSource = fs.readFileSync(
    path.join(root, "content", "page-capability-router.js"),
    "utf8"
  );
  const bridgeRequestSource = fs.readFileSync(
    path.join(root, "content", "hosted-panel-bridge.js"),
    "utf8"
  );
  const shellBridgeSource = fs.readFileSync(
    path.join(root, "content", "panel-v2-shell-bridge.js"),
    "utf8"
  );
  const hostedPanelSource = fs.readFileSync(
    path.join(root, "hosting", "extension-v2", "panel", "index.js"),
    "utf8"
  );

  const mainContentScript = manifest.content_scripts.find((entry) =>
    Array.isArray(entry?.matches) && entry.matches.includes("https://inova.incross.com/*")
  );
  const scriptList = Array.isArray(mainContentScript?.js) ? mainContentScript.js : [];
  const pageCapabilityRouterIndex = scriptList.indexOf("content/page-capability-router.js");
  const contractHelperIndex = scriptList.indexOf("content/hosted-panel-bridge.js");
  const hostBridgeIndex = scriptList.indexOf("content/panel-host-bridge.js");
  const hostViewIndex = scriptList.indexOf("content/panel-host-view.js");
  const panelIndex = scriptList.indexOf("content/panel.js");

  assert(pageCapabilityRouterIndex !== -1, "manifest should load the page capability router");
  assert(contractHelperIndex !== -1, "manifest should load the hosted panel bridge contract helper");
  assert(hostBridgeIndex !== -1, "manifest should load the panel host bridge helper");
  assert(hostViewIndex !== -1, "manifest should load the panel host view helper");
  assert(panelIndex !== -1 && pageCapabilityRouterIndex < contractHelperIndex, "manifest should load the page capability router before the hosted panel bridge");
  assert(panelIndex !== -1 && contractHelperIndex < panelIndex, "manifest should load the hosted panel bridge contract helper before content/panel.js");
  assert(panelIndex !== -1 && hostBridgeIndex < panelIndex, "manifest should load the panel host bridge helper before content/panel.js");
  assert(panelIndex !== -1 && hostViewIndex < panelIndex, "manifest should load the panel host view helper before content/panel.js");
  assert(
    topPanelSource.includes("panelHostBridge.create"),
    "content/panel.js should delegate hosted bridge endpoint wiring to the dedicated helper module"
  );
  assert(
    topPanelSource.includes("panelHostView.create"),
    "content/panel.js should delegate host markup and handle interaction wiring to the dedicated host view helper"
  );
  assert(
    !topPanelSource.includes("function handleBridgeRequest("),
    "content/panel.js should not keep inline bridge request routing once the bridge helper exists"
  );
  assert(
    !topPanelSource.includes("function createHostedBridge("),
    "content/panel.js should not keep inline hosted bridge creation once the panel host bridge helper exists"
  );
  assert(
    panelHostBridgeSource.includes("namespace.panelHostedBridgeRequest?.handle?."),
    "panel host bridge helper should delegate bridge-domain request routing to the dedicated hosted bridge request helper"
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
    "namespace.panelPageCapabilityRouter?.handle?.(",
    "handlePanelRequest(",
    'if (action === "panel-chrome-sync")',
    "global.chrome?.runtime?.sendMessage",
  ].forEach((pattern) => assert(
    bridgeRequestSource.includes(pattern),
    `hosted bridge request helper should keep the inline contract for ${pattern}`
  ));
  [
    "handleConversationRequest(",
    'if (action === "select-tool")',
    'if (action === "search")',
    'if (action === "search-submit")',
    'if (action === "bookmark-copy")',
    'if (action === "bookmark-jump")',
    "handlePanelSummaryRequest(",
    'if (action === "tool-summary-sync")',
    'typeof callbacks.onToolSummarySync !== "function"',
    "const toolId = normalizeText(payload?.toolId)",
    "const toolState = payload?.toolState && typeof payload.toolState === \"object\"",
    'if (action === "toggle-panel")',
  ].forEach((pattern) => assert(
    !bridgeRequestSource.includes(pattern),
    `hosted bridge request helper should drop the removed panel fallback/sync surface ${pattern}`
  ));
  [
    "onHandlePositionChange: panelShellController.updateHandlePosition",
    "onPanelChromeSync(chromeState)",
    'emitPanelEvent?.("external-toggle")',
  ].forEach((pattern) => assert(
    shellBridgeSource.includes(pattern),
    `v2 shell bridge should keep the compact hosted callback surface ${pattern}`
  ));
  [
    "onToolSummarySync",
    "handlePanelToolSummarySync",
    "panelLifecycleController.togglePanel",
    "function togglePanel(",
  ].forEach((pattern) => assert(
    !shellBridgeSource.includes(pattern),
    `v2 shell bridge should drop the removed hosted/content callback or fallback ${pattern}`
  ));
  assert(
    !bridgeRequestSource.includes('if (action === "escape")')
      && !shellBridgeSource.includes("onEscape:"),
    "v2 shell bridge should not keep the legacy panel escape callback once hosted review consumes Escape before close"
  );
  [
    "onCopyBookmark:",
    "onJumpBookmark:",
    "onSearch:",
    "onSearchSubmit:",
    "onSelectTool:",
  ].forEach((pattern) => assert(
    !shellBridgeSource.includes(pattern),
    `v2 shell bridge should drop the removed hosted callback ${pattern}`
  ));
  assert(
    hostedPanelSource.includes("async function persistHostedToolSelection(toolId)"),
    "hosted panel should keep tool rail persistence in a dedicated helper"
  );
  assert(
    hostedPanelSource.includes("resolveRequestTimeoutMs(payload)")
      && hostedPanelSource.includes("MAX_REQUEST_TIMEOUT_MS"),
    "hosted panel should honor per-request timeout metadata with a client-side cap"
  );
  assert(
    hostedPanelSource.includes("await persistHostedUiPreferences(nextUiPreferences, \"active-tool\");")
      && hostedPanelSource.includes("function canInvokeNegotiatedCapability(capabilityId)")
      && hostedPanelSource.includes("UI_PREFERENCES_WRITE_CAPABILITY_ID"),
    "hosted panel should persist tool rail selection through negotiated storage.write-ui-preferences"
  );
  assert(
    hostedPanelSource.includes('activePromptTab: "library"')
      && hostedPanelSource.includes('activeTool: "prompts"'),
    "hosted panel should keep prompts rail selection pinned to the library tab"
  );
  [
    /request\("panel",\s*\{\s*action:\s*"escape"/,
    /request\("panel",\s*\{\s*action:\s*"select-tool"/,
    /request\("panel",\s*\{\s*action:\s*"search"/,
    /request\("panel",\s*\{\s*action:\s*"search-submit"/,
    /request\("panel",\s*\{\s*action:\s*"bookmark-copy"/,
    /request\("panel",\s*\{\s*action:\s*"bookmark-jump"/,
  ].forEach((pattern) => assert(
    !pattern.test(hostedPanelSource),
    `hosted panel should stop routing hosted-owned actions through the panel request fallback ${pattern}`
  ));
  assert(
    pageCapabilityRouterSource.includes("PAGE_CAPABILITY_MANIFEST")
      && pageCapabilityRouterSource.includes("PAGE_CAPABILITY_ADAPTERS")
      && pageCapabilityRouterSource.includes("buildPageCapabilityContext"),
    "page capability router should dispatch through a manifest lookup and adapter table"
  );
  [
    "clipboard.write-text",
    "debug.copy-log",
    "debug.clear-log",
    "trace.log",
    "composer.read-state",
    "composer.apply-text",
    "conversation.read-state",
    "conversation.read-dom-snapshot",
    "conversation.jump-item",
    "debug.read-state",
    "debug.set-enabled",
  ].forEach((capabilityId) => assert(
    pageCapabilityRouterSource.includes(`"${capabilityId}"`),
    `page capability router should keep the canonical page capability contract for ${capabilityId}`
  ));
  [
    "function handlePageRequest(",
    'if (action === "clipboard.write-text")',
    'if (action === "debug.copy-log")',
    'if (action === "trace.log")',
    'if (action === "composer.read-state")',
    'if (action === "composer.apply-text")',
    'if (action === "conversation.read-state")',
    'if (action === "conversation.jump-item")',
    'if (action === "debug.read-state")',
    'if (action === "debug.set-enabled")',
  ].forEach((pattern) => assert(
    !bridgeRequestSource.includes(pattern),
    `hosted bridge request helper should delegate page capability handling instead of inlining ${pattern}`
  ));
  [
    "function normalizePageAction(",
    'normalizedAction === "log-trace"',
  ].forEach((pattern) => assert(
    !panelHostBridgeSource.includes(pattern),
    `active panel host bridge should not keep legacy page alias handling ${pattern}`
  ));
  [
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
  ].forEach((pattern) => assert(
    !pageCapabilityRouterSource.includes(pattern),
    `page capability router should stop branching directly on the pre-capability page action ${pattern}`
  ));
  [
    "handleLegacyPanelRequest(",
    "handleLegacyMeetingRequest(",
    "handleLegacyPromptRequest(",
    'if (action === "meeting-summary-sync")',
    'if (action === "release-summary-sync")',
    'typeof callbacks.onMeetingSummarySync !== "function"',
    'typeof callbacks.onReleaseSummarySync !== "function"',
    'if (action === "meeting-action")',
    'if (action === "release-action")',
    'typeof callbacks.onMeetingAction !== "function"',
    'typeof callbacks.onReleaseAction !== "function"',
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
