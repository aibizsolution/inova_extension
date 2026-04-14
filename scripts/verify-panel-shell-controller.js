#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyMeetingAndReleaseToolPersistence();
  await verifyPromptLibraryPersistence();
  await verifyStoreAliasPersistence();
  verifyQueryFallbackIsDropped();
  verifyHandleCountUsesActiveTool();
  verifyPromptSelectionStaysShellOwned();
  await verifyHandlePositionAndUiPreferenceLock();
  console.log("[verify-panel-shell-controller] V2 shell bridge shell contract passed");
}

async function verifyMeetingAndReleaseToolPersistence() {
  const harness = createHarness({
    activePromptTab: "store",
    activeTool: "prompts",
    uiPreferenceTool: "prompts",
  });

  await harness.controller.persistActiveTool("meeting");
  assert.equal(harness.state.uiPreferences.activeTool, "meeting");
  assert.deepEqual(harness.persistCalls[0], {
    activePromptTab: "store",
    activeTool: "meeting",
  });

  await harness.controller.persistActiveTool("release");
  assert.equal(harness.state.uiPreferences.activeTool, "release");
}

async function verifyPromptLibraryPersistence() {
  const harness = createHarness({
    activePromptTab: "store",
    activeTool: "meeting",
    uiPreferenceTool: "meeting",
  });

  await harness.controller.persistActiveTool("prompts", "library");
  assert.equal(harness.state.uiPreferences.activeTool, "prompts");
  assert.deepEqual(harness.persistCalls[0], {
    activePromptTab: "library",
    activeTool: "prompts",
  });
}

async function verifyStoreAliasPersistence() {
  const harness = createHarness();

  await harness.controller.persistActiveTool("store", "store");
  assert.equal(harness.state.uiPreferences.activeTool, "prompts");
  assert.deepEqual(harness.persistCalls[0], {
    activePromptTab: "store",
    activeTool: "prompts",
  });
}

function verifyHandleCountUsesActiveTool() {
  const harness = createHarness({
    activeTool: "bookmarks",
    uiPreferenceTool: "bookmarks",
  });

  const bookmarkHandleCount = harness.controller.buildHandleCount({
    bookmarks: 2,
    meeting: 1,
    promptTool: 3,
    prompts: 5,
    release: 1,
  });
  assert.equal(bookmarkHandleCount, 2);

  harness.state.activeTool = "prompts";
  const promptHandleCount = harness.controller.buildHandleCount({
    bookmarks: 2,
    meeting: 1,
    promptTool: 3,
    prompts: 5,
    release: 1,
  });
  assert.equal(promptHandleCount, 3);
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
}

async function verifyHandlePositionAndUiPreferenceLock() {
  const harness = createHarness();

  harness.controller.lockUiPreferenceSelection("store", "unknown");
  assert.equal(harness.state.uiPreferenceLock.activeTool, "prompts");
  assert.equal(harness.state.uiPreferenceLock.activePromptTab, "library");
  assert.deepEqual(harness.controller.applyUiPreferenceLock({
    activePromptTab: "review",
    activeTool: "meeting",
  }), {
    activePromptTab: "library",
    activeTool: "prompts",
  });

  await harness.controller.updateHandlePosition(0.55);
  assert.equal(harness.renderCalls.length, 1);
  assert.deepEqual(harness.handleUpdates[0], {
    activeTool: "prompts",
    handleRatios: { desktop: 0.55 },
  });
  assert.equal(harness.state.uiPreferences.handleRatios.desktop, 0.55);
}

function createHarness(options = {}) {
  const handleUpdates = [];
  const persistCalls = [];
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
        } else {
          persistCalls.push(cloneValue(patch));
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
    activeTool: options.activeTool || "prompts",
    uiPreferenceLock: null,
    uiPreferences: {
      activePromptTab: options.activePromptTab || "library",
      activeTool: options.uiPreferenceTool || options.activeTool || "prompts",
      handleRatios: {},
    },
  };

  const controller = context.InovaBookmarks.panelV2ShellBridge.createShellController(state, {
    isExtensionContextInvalidatedError() {
      return false;
    },
    render() {
      renderCalls.push(true);
    },
  });

  return {
    controller,
    handleUpdates,
    persistCalls,
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
