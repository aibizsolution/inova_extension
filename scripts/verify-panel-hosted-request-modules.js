#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function main() {
  verifyHostedBridgeRequestModuleContract();
  verifyHostedMeetingRequestModuleContract();
  verifyHostedPromptRequestModuleContract();
  verifyHostedRuntimeRequestModuleContract();
  verifyHostedPageRequestModuleContract();
  verifyHostedShellRequestModuleContract();
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

  const mainContentScript = manifest.content_scripts.find((entry) =>
    Array.isArray(entry?.matches) && entry.matches.includes("https://inova.incross.com/*")
  );
  const scriptList = Array.isArray(mainContentScript?.js) ? mainContentScript.js : [];
  const helperIndex = scriptList.indexOf("content/panel-hosted-bridge-request.js");
  const panelIndex = scriptList.indexOf("content/panel.js");

  assert(helperIndex !== -1, "manifest should load the hosted bridge request helper");
  assert(panelIndex !== -1 && helperIndex < panelIndex, "manifest should load the bridge request helper before content/panel.js");
  assert(
    topPanelSource.includes("namespace.panelHostedBridgeRequest?.handle?."),
    "content/panel.js should delegate bridge-domain request routing to the dedicated helper module"
  );
  assert(
    !topPanelSource.includes("function handleBridgeRequest("),
    "content/panel.js should not keep inline bridge request routing once the bridge helper exists"
  );
}

function verifyHostedMeetingRequestModuleContract() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8")
  );
  const bridgeRequestSource = fs.readFileSync(
    path.join(root, "content", "panel-hosted-bridge-request.js"),
    "utf8"
  );

  const mainContentScript = manifest.content_scripts.find((entry) =>
    Array.isArray(entry?.matches) && entry.matches.includes("https://inova.incross.com/*")
  );
  const scriptList = Array.isArray(mainContentScript?.js) ? mainContentScript.js : [];
  const helperIndex = scriptList.indexOf("content/panel-hosted-meeting-request.js");
  const panelIndex = scriptList.indexOf("content/panel.js");

  assert(helperIndex !== -1, "manifest should load the hosted meeting request helper");
  assert(panelIndex !== -1 && helperIndex < panelIndex, "manifest should load the meeting request helper before content/panel.js");
  assert(
    bridgeRequestSource.includes("namespace.panelHostedMeetingRequest?.handle?."),
    "content bridge routing should delegate meeting-specific hosted requests to the dedicated helper module"
  );
  const meetingRequestSource = fs.readFileSync(
    path.join(root, "content", "panel-hosted-meeting-request.js"),
    "utf8"
  );
  [
    'typeof callbacks.onMeetingAction !== "function"',
    'typeof callbacks.onMeetingSummarySync !== "function"',
  ].forEach((pattern) => assert(
    meetingRequestSource.includes(pattern),
    `meeting request helper should return unhandled when the lane does not expose ${pattern}`
  ));
}

function verifyHostedPromptRequestModuleContract() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8")
  );
  const bridgeRequestSource = fs.readFileSync(
    path.join(root, "content", "panel-hosted-bridge-request.js"),
    "utf8"
  );

  const mainContentScript = manifest.content_scripts.find((entry) =>
    Array.isArray(entry?.matches) && entry.matches.includes("https://inova.incross.com/*")
  );
  const scriptList = Array.isArray(mainContentScript?.js) ? mainContentScript.js : [];
  const helperIndex = scriptList.indexOf("content/panel-hosted-prompt-request.js");
  const panelIndex = scriptList.indexOf("content/panel.js");

  assert(helperIndex !== -1, "manifest should load the hosted prompt request helper");
  assert(panelIndex !== -1 && helperIndex < panelIndex, "manifest should load the prompt request helper before content/panel.js");
  assert(
    bridgeRequestSource.includes("namespace.panelHostedPromptRequest?.handle?."),
    "content bridge routing should delegate prompt-specific hosted requests to the dedicated helper module"
  );
  const promptRequestSource = fs.readFileSync(
    path.join(root, "content", "panel-hosted-prompt-request.js"),
    "utf8"
  );
  [
    'typeof callbacks.onPromptAction !== "function"',
    'typeof callbacks.onPromptDraftChange !== "function"',
    'typeof callbacks.onSelectPromptTab !== "function"',
    'typeof callbacks.onStoreAction !== "function"',
    'typeof callbacks.onImportFile !== "function"',
    'typeof callbacks.onMovePrompt !== "function"',
  ].forEach((pattern) => assert(
    promptRequestSource.includes(pattern),
    `prompt request helper should return unhandled when the lane does not expose ${pattern}`
  ));
  assert(
    !bridgeRequestSource.includes('if (action === "prompt-action")'),
    "content bridge routing should not keep inline prompt-action hosted request handling once the prompt helper exists"
  );
  assert(
    !bridgeRequestSource.includes('if (action === "prompt-draft-change")'),
    "content bridge routing should not keep inline prompt-draft-change hosted request handling once the prompt helper exists"
  );
  assert(
    !bridgeRequestSource.includes('if (action === "prompt-tab-select")'),
    "content bridge routing should not keep inline prompt-tab-select hosted request handling once the prompt helper exists"
  );
  assert(
    !bridgeRequestSource.includes('if (action === "store-action")'),
    "content bridge routing should not keep inline store-action hosted request handling once the prompt helper exists"
  );
  assert(
    !bridgeRequestSource.includes('if (action === "import-file")'),
    "content bridge routing should not keep inline import-file hosted request handling once the prompt helper exists"
  );
  assert(
    !bridgeRequestSource.includes('if (action === "move-prompt")'),
    "content bridge routing should not keep inline move-prompt hosted request handling once the prompt helper exists"
  );
}

function verifyHostedRuntimeRequestModuleContract() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8")
  );
  const bridgeRequestSource = fs.readFileSync(
    path.join(root, "content", "panel-hosted-bridge-request.js"),
    "utf8"
  );

  const mainContentScript = manifest.content_scripts.find((entry) =>
    Array.isArray(entry?.matches) && entry.matches.includes("https://inova.incross.com/*")
  );
  const scriptList = Array.isArray(mainContentScript?.js) ? mainContentScript.js : [];
  const helperIndex = scriptList.indexOf("content/panel-hosted-runtime-request.js");
  const panelIndex = scriptList.indexOf("content/panel.js");

  assert(helperIndex !== -1, "manifest should load the hosted runtime request helper");
  assert(panelIndex !== -1 && helperIndex < panelIndex, "manifest should load the runtime request helper before content/panel.js");
  assert(
    bridgeRequestSource.includes("namespace.panelHostedRuntimeRequest?.handle?."),
    "content bridge routing should delegate runtime broker requests to the dedicated helper module"
  );
}

function verifyHostedPageRequestModuleContract() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8")
  );
  const bridgeRequestSource = fs.readFileSync(
    path.join(root, "content", "panel-hosted-bridge-request.js"),
    "utf8"
  );

  const mainContentScript = manifest.content_scripts.find((entry) =>
    Array.isArray(entry?.matches) && entry.matches.includes("https://inova.incross.com/*")
  );
  const scriptList = Array.isArray(mainContentScript?.js) ? mainContentScript.js : [];
  const helperIndex = scriptList.indexOf("content/panel-hosted-page-request.js");
  const panelIndex = scriptList.indexOf("content/panel.js");

  assert(helperIndex !== -1, "manifest should load the hosted page request helper");
  assert(panelIndex !== -1 && helperIndex < panelIndex, "manifest should load the page request helper before content/panel.js");
  assert(
    bridgeRequestSource.includes("namespace.panelHostedPageRequest?.handle?."),
    "content bridge routing should delegate page adapter requests to the dedicated helper module"
  );
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
    !bridgeRequestSource.includes(pattern),
    `content bridge routing should not keep inline page adapter handling for ${pattern}`
  ));
}

function verifyHostedShellRequestModuleContract() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8")
  );
  const bridgeRequestSource = fs.readFileSync(
    path.join(root, "content", "panel-hosted-bridge-request.js"),
    "utf8"
  );

  const mainContentScript = manifest.content_scripts.find((entry) =>
    Array.isArray(entry?.matches) && entry.matches.includes("https://inova.incross.com/*")
  );
  const scriptList = Array.isArray(mainContentScript?.js) ? mainContentScript.js : [];
  const helperIndex = scriptList.indexOf("content/panel-hosted-shell-request.js");
  const panelIndex = scriptList.indexOf("content/panel.js");

  assert(helperIndex !== -1, "manifest should load the hosted shell request helper");
  assert(panelIndex !== -1 && helperIndex < panelIndex, "manifest should load the shell request helper before content/panel.js");
  assert(
    bridgeRequestSource.includes("namespace.panelHostedShellRequest?.handle?."),
    "content bridge routing should delegate shell-level hosted requests to the dedicated helper module"
  );
  [
    'if (action === "toggle-panel")',
    'if (action === "escape")',
    'if (action === "select-tool")',
    'if (action === "search")',
    'if (action === "search-submit")',
    'if (action === "bookmark-copy")',
    'if (action === "bookmark-jump")',
    'if (action === "release-summary-sync")',
    'if (action === "release-action")',
  ].forEach((pattern) => assert(
    !bridgeRequestSource.includes(pattern),
    `content bridge routing should not keep inline hosted shell handling for ${pattern}`
  ));
}

main();
