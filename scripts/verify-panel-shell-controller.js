#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  verifyQueryFallbackIsDropped();
  verifyHandleCountMovedToHosted();
  verifyPromptSelectionStaysShellOwned();
  await verifyHandlePositionPersistence();
  console.log("[verify-panel-shell-controller] V2 shell bridge shell contract passed");
}

function verifyHandleCountMovedToHosted() {
  const source = fs.readFileSync(path.join(root, "content", "panel-v2-shell-bridge.js"), "utf8");
  assert.equal(
    source.includes("buildHandleCount"),
    false,
    "v2 shell bridge should not calculate handle counts after hosted panel chrome sync owns them"
  );
}

function verifyQueryFallbackIsDropped() {
  const source = fs.readFileSync(path.join(root, "content", "panel-v2-shell-bridge.js"), "utf8");

  [
    "async selectTool(",
    "submitQuery(toolId, value)",
    "updateQuery(toolId, value, options = {})",
    "const bookmarkController = deps.bookmarkController",
  ].forEach((pattern) => assert.equal(
    source.includes(pattern),
    false,
    `v2 shell bridge should drop the removed shell helper ${pattern}`
  ));
}

function verifyPromptSelectionStaysShellOwned() {
  const source = fs.readFileSync(path.join(root, "content", "panel-v2-shell-bridge.js"), "utf8");

  assert.equal(
    source.includes("getPromptController"),
    false,
    "v2 shell bridge should stop reading generic prompt tool selection back through the prompt controller"
  );
  assert.equal(
    source.includes("promptController && await promptController.selectTool(toolId)"),
    false,
    "v2 shell bridge should keep prompt/store tool selection inside the shell instead of delegating it back to the prompt controller"
  );
  [
    "persistActiveTool",
    "lockUiPreferenceSelection",
    "applyUiPreferenceLock",
    "normalizeToolId",
    "readActiveTool",
    "state.activeTool",
    "uiPreferenceLock",
  ].forEach((pattern) => assert.equal(
    source.includes(pattern),
    false,
    `v2 shell bridge should not keep hosted-owned tool/tab persistence residue ${pattern}`
  ));
}

async function verifyHandlePositionPersistence() {
  const harness = createHarness();

  await harness.controller.updateHandlePosition(0.55);
  assert.equal(harness.renderCalls.length, 1);
  assert.deepEqual(harness.handleUpdates[0], {
    handleRatios: { desktop: 0.55 },
  });
  assert.equal("activeTool" in harness.handleUpdates[0], false);
  assert.equal(harness.state.uiPreferences.handleRatios.desktop, 0.55);
  assert.equal(harness.state.uiPreferences.activeTool, "prompts");
}

function createHarness(options = {}) {
  const handleUpdates = [];
  const renderCalls = [];

  const context = vm.createContext({
    console,
    globalThis: null,
    innerWidth: 1280,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    session: {
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
    storage: {
      getViewportBucket() {
        return "desktop";
      },
      mergeUiPreferences(current = {}, patch = {}) {
        const merged = {
          activePromptTab: "library",
          activeTool: "bookmarks",
          handleRatios: {},
          ...cloneValue(current),
          ...cloneValue(patch),
        };
        if (merged.activeTool === "store") {
          merged.activeTool = "prompts";
          merged.activePromptTab = "store";
        }
        if (merged.activePromptTab !== "store" && merged.activePromptTab !== "review") {
          merged.activePromptTab = "library";
        }
        return merged;
      },
      normalizeHandleRatio(value) {
        return Number(value) || 0;
      },
      async updateUiPreferences(patch = {}) {
        if (patch.handleRatios) {
          handleUpdates.push(cloneValue(patch));
        }
        return {
          activePromptTab: "library",
          activeTool: "bookmarks",
          handleRatios: {},
          ...context.InovaBookmarks.storage.mergeUiPreferences(patch),
        };
      },
    },
  };

  loadScript("content/panel-v2-shell-bridge.js", context);

  const state = {
    uiPreferences: {
      activePromptTab: options.activePromptTab || "library",
      activeTool: options.uiPreferenceTool || options.activeTool || "prompts",
      handleRatios: {},
    },
  };

  const controller = context.InovaBookmarks.panelV2ShellBridge.createShellController(state, {
    render() {
      renderCalls.push(true);
    },
  });

  return {
    controller,
    handleUpdates,
    renderCalls,
    state,
  };
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-panel-shell-controller] ${error.stack || error.message}`);
  process.exit(1);
});
