#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function main() {
  verifyHostedMeetingRequestModuleContract();
  verifyHostedPromptRequestModuleContract();
  verifyHostedPageRequestModuleContract();
  verifyHostedShellRequestModuleContract();
  console.log("[verify-panel-hosted-request-modules] Hosted panel request helper contract passed");
}

function verifyHostedMeetingRequestModuleContract() {
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
  const helperIndex = scriptList.indexOf("content/panel-hosted-meeting-request.js");
  const panelIndex = scriptList.indexOf("content/panel.js");

  assert(helperIndex !== -1, "manifest should load the hosted meeting request helper");
  assert(panelIndex !== -1 && helperIndex < panelIndex, "manifest should load the meeting request helper before content/panel.js");
  assert(
    topPanelSource.includes("namespace.panelHostedMeetingRequest?.handle?."),
    "content/panel.js should delegate meeting-specific hosted requests to the dedicated helper module"
  );
}

function verifyHostedPromptRequestModuleContract() {
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
  const helperIndex = scriptList.indexOf("content/panel-hosted-prompt-request.js");
  const panelIndex = scriptList.indexOf("content/panel.js");

  assert(helperIndex !== -1, "manifest should load the hosted prompt request helper");
  assert(panelIndex !== -1 && helperIndex < panelIndex, "manifest should load the prompt request helper before content/panel.js");
  assert(
    topPanelSource.includes("namespace.panelHostedPromptRequest?.handle?."),
    "content/panel.js should delegate prompt-specific hosted requests to the dedicated helper module"
  );
  assert(
    !topPanelSource.includes('if (action === "prompt-action")'),
    "content/panel.js should not keep inline prompt-action hosted request handling once the prompt helper exists"
  );
  assert(
    !topPanelSource.includes('if (action === "prompt-draft-change")'),
    "content/panel.js should not keep inline prompt-draft-change hosted request handling once the prompt helper exists"
  );
  assert(
    !topPanelSource.includes('if (action === "prompt-tab-select")'),
    "content/panel.js should not keep inline prompt-tab-select hosted request handling once the prompt helper exists"
  );
  assert(
    !topPanelSource.includes('if (action === "store-action")'),
    "content/panel.js should not keep inline store-action hosted request handling once the prompt helper exists"
  );
  assert(
    !topPanelSource.includes('if (action === "import-file")'),
    "content/panel.js should not keep inline import-file hosted request handling once the prompt helper exists"
  );
  assert(
    !topPanelSource.includes('if (action === "move-prompt")'),
    "content/panel.js should not keep inline move-prompt hosted request handling once the prompt helper exists"
  );
}

function verifyHostedPageRequestModuleContract() {
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
  const helperIndex = scriptList.indexOf("content/panel-hosted-page-request.js");
  const panelIndex = scriptList.indexOf("content/panel.js");

  assert(helperIndex !== -1, "manifest should load the hosted page request helper");
  assert(panelIndex !== -1 && helperIndex < panelIndex, "manifest should load the page request helper before content/panel.js");
  assert(
    topPanelSource.includes("namespace.panelHostedPageRequest?.handle?."),
    "content/panel.js should delegate page adapter requests to the dedicated helper module"
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
    !topPanelSource.includes(pattern),
    `content/panel.js should not keep inline page adapter handling for ${pattern}`
  ));
}

function verifyHostedShellRequestModuleContract() {
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
  const helperIndex = scriptList.indexOf("content/panel-hosted-shell-request.js");
  const panelIndex = scriptList.indexOf("content/panel.js");

  assert(helperIndex !== -1, "manifest should load the hosted shell request helper");
  assert(panelIndex !== -1 && helperIndex < panelIndex, "manifest should load the shell request helper before content/panel.js");
  assert(
    topPanelSource.includes("namespace.panelHostedShellRequest?.handle?."),
    "content/panel.js should delegate shell-level hosted requests to the dedicated helper module"
  );
  [
    'if (action === "toggle-panel")',
    'if (action === "escape")',
    'if (action === "select-tool")',
    'if (action === "search")',
    'if (action === "search-submit")',
    'if (action === "bookmark-copy")',
    'if (action === "bookmark-jump")',
    'if (action === "release-action")',
  ].forEach((pattern) => assert(
    !topPanelSource.includes(pattern),
    `content/panel.js should not keep inline hosted shell handling for ${pattern}`
  ));
}

main();
