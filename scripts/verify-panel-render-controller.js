#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function main() {
  verifyCustomConversationSnapshotBridge();
  verifyCustomPromptSnapshotBridge();
  verifyCustomMeetingSnapshotBridge();
  verifyRenderPayloadAndReviewFloat();
  verifyCustomReleaseSnapshotBridge();
  verifyVisibleStateCalculation();
  console.log("[verify-panel-render-controller] V2 shell bridge render contract passed");
}

function verifyCustomConversationSnapshotBridge() {
  const harness = createHarness({
    activeTool: "bookmarks",
    buildConversationSnapshot() {
      return {
        activeId: "bookmark-hosted",
        count: 4,
        snapshotFingerprint: "bookmark-hosted|4|first|last",
      };
    },
    getConversationCount() {
      return 4;
    },
  });

  harness.controller.render();

  assert.equal(harness.renderPayloads[0].handleCount, 4);
  assert.deepEqual(harness.renderPayloads[0].panelSnapshot.bookmarksTool, {
    activeId: "bookmark-hosted",
    count: 4,
    snapshotFingerprint: "bookmark-hosted|4|first|last",
  });
  assert.equal(harness.renderPayloads[0].bookmarksTool, undefined);
}

function verifyRenderPayloadAndReviewFloat() {
  const harness = createHarness({
    activeTool: "meeting",
    meetingSummary: { count: 2 },
    open: true,
    settings: { enabled: true },
  });

  harness.controller.render();

  assert.equal(harness.debugSyncCalls, 1);
  assert.equal(harness.renderPayloads.length, 1);
  assert.equal(harness.renderPayloads[0].panelSnapshot.activeTool, "meeting");
  assert.equal(harness.renderPayloads[0].handleCount, 2);
  assert.equal(harness.renderPayloads[0].panelSnapshot.meetingTool.count, 2);
  assert.equal(harness.renderPayloads[0].visible, true);
  assert.deepEqual(harness.reviewFloatStates, [{ visible: true }]);
}

function verifyCustomPromptSnapshotBridge() {
  const harness = createHarness({
    activeTool: "prompts",
    buildPromptSnapshot() {
      return {
        activeTab: "review",
        review: {
          open: true,
          pending: true,
          result: {
            summary: "검토 결과",
          },
        },
      };
    },
    getPromptCounts() {
      return {
        promptCount: 7,
        promptToolCount: 5,
      };
    },
  });

  harness.controller.render();

  assert.equal(harness.renderPayloads[0].handleCount, 5);
  assert.deepEqual(harness.renderPayloads[0].panelSnapshot.promptTool, {
    activeTab: "review",
    review: {
      open: true,
      pending: true,
      result: {
        summary: "검토 결과",
      },
    },
  });
}

function verifyCustomMeetingSnapshotBridge() {
  const harness = createHarness({
    activeTool: "meeting",
    buildMeetingSnapshot() {
      return {
        count: 9,
        snapshotFingerprint: "meeting-alpha|9|fresh",
      };
    },
    getMeetingCount() {
      return 9;
    },
  });

  harness.controller.render();

  assert.equal(harness.renderPayloads[0].handleCount, 9);
  assert.deepEqual(harness.renderPayloads[0].panelSnapshot.meetingTool, {
    count: 9,
    snapshotFingerprint: "meeting-alpha|9|fresh",
  });
}

function verifyVisibleStateCalculation() {
  const harness = createHarness({
    settings: { enabled: false },
  });

  harness.controller.render();

  assert.equal(harness.renderPayloads[0].visible, false);
  assert.deepEqual(harness.reviewFloatStates, [{ visible: false }]);
}

function verifyCustomReleaseSnapshotBridge() {
  const harness = createHarness({
    activeTool: "release",
    buildReleaseSnapshot() {
      return {
        count: 1,
        updateAvailable: true,
      };
    },
    getReleaseCount() {
      return 1;
    },
  });

  harness.controller.render();

  assert.equal(harness.renderPayloads[0].handleCount, 1);
  assert.deepEqual(harness.renderPayloads[0].panelSnapshot.releaseTool, {
    count: 1,
    updateAvailable: true,
  });
}

function createHarness(options = {}) {
  let debugSyncCalls = 0;
  const renderPayloads = [];
  const reviewFloatStates = [];

  const context = vm.createContext({
    console,
    globalThis: null,
    innerWidth: 1440,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    composerReviewFloat: {
      render(payload) {
        reviewFloatStates.push(cloneValue(payload));
      },
    },
    contentPanel: {
      renderPanel(payload) {
        renderPayloads.push(cloneValue(payload));
      },
    },
    storage: {
      getHandleRatio() {
        return 0.42;
      },
    },
  };

  loadScript("content/panel-v2-shell-bridge.js", context);

  const state = {
    activeTool: options.activeTool || "bookmarks",
    meetingSummary: cloneValue(options.meetingSummary || { count: 0 }),
    open: Boolean(options.open),
    settings: {
      enabled: true,
      ...(options.settings || {}),
    },
    settingsHydrated: options.settingsHydrated !== false,
    uiPreferences: {},
  };

  const controller = context.InovaBookmarks.panelV2ShellBridge.createRenderController(state, {
    isPaused() {
      return false;
    },
    isToolSurface() {
      return true;
    },
    panelBookmarkController: {
      buildToolState() {
        return {
          activeId: "",
          count: 1,
        };
      },
    },
    panelDebugController: {
      buildState() {
        return {
          enabled: true,
        };
      },
      syncEnabled() {
        debugSyncCalls += 1;
      },
    },
    buildMeetingSnapshot: options.buildMeetingSnapshot,
    getMeetingCount: options.getMeetingCount,
    buildConversationSnapshot: options.buildConversationSnapshot,
    getConversationCount: options.getConversationCount,
    panelPromptController: {
      buildReviewFloatState(visible) {
        return { visible };
      },
      buildToolState() {
        return {
          promptCount: 3,
          promptTool: {
            activeTab: "library",
          },
          promptToolCount: 3,
        };
      },
    },
    buildPromptSnapshot: options.buildPromptSnapshot,
    getPromptCounts: options.getPromptCounts,
    panelShellController: {
      buildHandleCount(counts) {
        if (state.activeTool === "bookmarks") {
          return counts.bookmarks || counts.prompts || counts.meeting || counts.release;
        }
        if (state.activeTool === "prompts") {
          return counts.promptTool || counts.prompts;
        }
        if (state.activeTool === "meeting") {
          return counts.meeting;
        }
        if (state.activeTool === "release") {
          return counts.release;
        }
        return 0;
      },
    },
    buildReleaseSnapshot: options.buildReleaseSnapshot,
    getReleaseCount: options.getReleaseCount,
    releaseManager: {
      buildViewState() {
        return {
          updateAvailable: false,
        };
      },
    },
  });

  return {
    controller,
    get debugSyncCalls() {
      return debugSyncCalls;
    },
    renderPayloads,
    reviewFloatStates,
  };
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main();
