#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyMeetingAndReleaseToolSelection();
  await verifyPromptAliasDelegation();
  await verifyBookmarkQueryRoutingAndHandleCount();
  verifyPromptQueryFallbackIsDropped();
  await verifyHandlePositionAndUiPreferenceLock();
  console.log("[verify-panel-shell-controller] V2 shell bridge shell contract passed");
}

async function verifyMeetingAndReleaseToolSelection() {
  const harness = createHarness({
    activePromptTab: "store",
    activeTool: "prompts",
    uiPreferenceTool: "prompts",
  });

  await harness.controller.selectTool("meeting");
  assert.equal(harness.state.activeTool, "meeting");
  assert.deepEqual(harness.persistCalls[0], {
    activePromptTab: "store",
    activeTool: "meeting",
  });

  await harness.controller.selectTool("release");
  assert.equal(harness.state.activeTool, "release");
  assert.deepEqual(harness.releaseEnsureCalls[0], {
    allowCached: false,
    preferFresh: true,
  });
}

async function verifyPromptAliasDelegation() {
  const harness = createHarness();

  assert.equal(await harness.controller.selectTool("store"), true);
  assert.deepEqual(harness.promptSelectToolCalls, ["store"]);
  assert.deepEqual(harness.persistCalls, []);
}

async function verifyBookmarkQueryRoutingAndHandleCount() {
  const harness = createHarness({
    activeTool: "bookmarks",
    uiPreferenceTool: "bookmarks",
  });

  assert.equal(harness.controller.updateQuery("bookmarks", "대화"), true);
  assert.deepEqual(harness.bookmarkQueryCalls, ["대화"]);

  assert.equal(harness.controller.submitQuery("bookmarks", "질문"), true);
  assert.deepEqual(harness.bookmarkSubmitCalls, ["질문"]);

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

function verifyPromptQueryFallbackIsDropped() {
  const harness = createHarness();

  assert.equal(harness.controller.updateQuery("prompts", "회의", { composing: true }), false);
  assert.equal(harness.controller.submitQuery("store", "공개"), false);
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
  const bookmarkQueryCalls = [];
  const bookmarkSubmitCalls = [];
  const handleUpdates = [];
  const persistCalls = [];
  const promptSelectToolCalls = [];
  const releaseEnsureCalls = [];
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
    queries: { bookmarks: "" },
    uiPreferenceLock: null,
    uiPreferences: {
      activePromptTab: options.activePromptTab || "library",
      activeTool: options.uiPreferenceTool || options.activeTool || "prompts",
      handleRatios: {},
    },
  };

  const promptController = {
    async selectTool(toolId) {
      if (toolId === "prompts" || toolId === "store") {
        promptSelectToolCalls.push(toolId);
        return true;
      }
      return false;
    },
  };

  const controller = context.InovaBookmarks.panelV2ShellBridge.createShellController(state, {
    bookmarkController: {
      submitQuery(value) {
        bookmarkSubmitCalls.push(value);
        return true;
      },
      updateQuery(value) {
        bookmarkQueryCalls.push(value);
        return true;
      },
    },
    getPromptController() {
      return promptController;
    },
    isExtensionContextInvalidatedError() {
      return false;
    },
    releaseManager: {
      ensureChecked(allowCached, preferFresh) {
        releaseEnsureCalls.push({
          allowCached: Boolean(allowCached),
          preferFresh: Boolean(preferFresh),
        });
      },
    },
    render() {
      renderCalls.push(true);
    },
  });

  return {
    bookmarkQueryCalls,
    bookmarkSubmitCalls,
    controller,
    handleUpdates,
    persistCalls,
    promptSelectToolCalls,
    releaseEnsureCalls,
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
