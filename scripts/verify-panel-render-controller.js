#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function main() {
  verifySnapshotCarriesUiPreferencesNotActiveTool();
  verifyRenderPayloadDoesNotCarryHandleCount();
  verifyRenderPayloadDoesNotCarryToolSummaries();
  verifyCustomConversationSnapshotBridge();
  verifyCustomPromptSnapshotBridge();
  verifyRenderPayloadAndReviewFloat();
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
  });

  harness.controller.render();

  assert.equal("handleCount" in harness.renderPayloads[0], false);
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
    open: true,
    settings: { enabled: true },
  });

  harness.controller.render();

  assert.equal(harness.debugSyncCalls, 1);
  assert.equal(harness.renderPayloads.length, 1);
  assert.equal("activeTool" in harness.renderPayloads[0].panelSnapshot, false);
  assert.equal(harness.renderPayloads[0].panelSnapshot.uiPreferences.activeTool, "meeting");
  assert.equal("handleCount" in harness.renderPayloads[0], false);
  assert.equal("open" in harness.renderPayloads[0], false);
  assert.equal("settings" in harness.renderPayloads[0], false);
  assert.equal("visible" in harness.renderPayloads[0], false);
  assert.equal("settingsHydrated" in harness.renderPayloads[0].panelSnapshot, false);
  assert.equal("meetingTool" in harness.renderPayloads[0].panelSnapshot, false);
  assert.equal("releaseTool" in harness.renderPayloads[0].panelSnapshot, false);
  assert.equal(harness.renderPayloads[0].panelSnapshot.providerIdentity.providerUserKey, "fixture-user");
  assert.equal(harness.renderPayloads[0].panelSnapshot.providerIdentity.email, "fixture@example.com");
  assert.equal("panelTrace" in harness.renderPayloads[0], false);
  assert.equal(harness.renderPayloads[0].panelSnapshot.open, true);
  assert.equal(harness.renderPayloads[0].panelSnapshot.visible, true);
  assert.deepEqual(harness.reviewFloatStates, [{ visible: true }]);
}

function verifyCustomPromptSnapshotBridge() {
  const harness = createHarness({
    activeTool: "prompts",
    uiPreferences: {
      activePromptTab: "review",
    },
    buildPromptSnapshot() {
      return {
        review: {
          requestId: 7,
        },
      };
    },
  });

  harness.controller.render();

  assert.equal("handleCount" in harness.renderPayloads[0], false);
  assert.deepEqual(harness.renderPayloads[0].panelSnapshot.promptTool, {
    review: {
      requestId: 7,
    },
  });
  assert.equal("panelTrace" in harness.renderPayloads[0], false);
  assert.equal(harness.renderPayloads[0].panelSnapshot.uiPreferences.activePromptTab, "review");
}

function verifyVisibleStateCalculation() {
  const harness = createHarness({
    settings: { enabled: false },
  });

  harness.controller.render();

  assert.equal(harness.renderPayloads[0].panelSnapshot.visible, false);
  assert.equal("visible" in harness.renderPayloads[0], false);
  assert.deepEqual(harness.reviewFloatStates, [{ visible: false }]);
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
      mergeUiPreferences(value = {}) {
        const merged = {
          activePromptTab: "library",
          activeTool: "bookmarks",
          handleRatios: {},
          ...cloneValue(value),
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
    },
    providerIdentity: {
      getCurrent() {
        return {
          available: true,
          displayName: "Fixture User",
          email: "fixture@example.com",
          numericUserId: 7,
          provider: "inova",
          providerUserKey: "fixture-user",
          rawSecret: "must-not-copy",
        };
      },
    },
    providerIdentityCache: {
      normalizeProviderIdentity(identity = {}) {
        return {
          available: Boolean(identity.available || identity.providerUserKey),
          displayName: String(identity.displayName || "").trim(),
          email: String(identity.email || "").trim().toLowerCase(),
          numericUserId: Number.isFinite(Number(identity.numericUserId)) ? Number(identity.numericUserId) : null,
          provider: String(identity.provider || "inova").trim() || "inova",
          providerUserKey: String(identity.providerUserKey || "").trim(),
        };
      },
    },
  };

  loadScript("content/panel-v2-shell-bridge.js", context);

  const state = {
    settings: {
      enabled: true,
      ...(options.settings || {}),
    },
    settingsHydrated: options.settingsHydrated !== false,
    uiPreferences: cloneValue({
      ...(options.uiPreferences || {}),
      activeTool: options.activeTool || options.uiPreferences?.activeTool || "bookmarks",
    }),
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
    buildConversationSnapshot: options.buildConversationSnapshot,
    promptShellController: {
      buildReviewFloatState(visible) {
        return { visible };
      },
      buildToolState() {
        return {
          promptTool: {
            activeTab: "library",
          },
        };
      },
    },
    buildPromptSnapshot: options.buildPromptSnapshot,
    readPanelOpen() {
      return Boolean(options.open);
    },
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

function verifySnapshotCarriesUiPreferencesNotActiveTool() {
  const source = fs.readFileSync(path.join(root, "content", "panel-v2-shell-bridge.js"), "utf8");
  assert(
    source.includes("uiPreferences: namespace.storage.mergeUiPreferences(state.uiPreferences),"),
    "top panel snapshot should carry raw uiPreferences for hosted active-tool derivation"
  );
  assert(
    !/panelSnapshot:\s*\{[\s\S]*?activeTool:/.test(source),
    "top panel snapshot should not send activeTool as a prebuilt hosted view field"
  );
}

function verifyRenderPayloadDoesNotCarryHandleCount() {
  const source = fs.readFileSync(path.join(root, "content", "panel-v2-shell-bridge.js"), "utf8");
  assert(
    !source.includes("buildHandleCount"),
    "v2 shell bridge should not calculate hosted-owned handle counts"
  );
  assert(
    !/renderPanel\(\{[\s\S]*?handleCount/.test(source),
    "v2 shell bridge render payload should not carry handleCount once hosted sync owns the value"
  );
  assert(
    !/renderPanel\(\{[\s\S]*?panelTrace/.test(source),
    "v2 shell bridge render payload should not carry panelTrace once top trace derives from raw snapshot"
  );
  assert(
    !source.includes("        open: state.open,\n        panelSnapshot:")
      && !source.includes("        settings: state.settings,\n        visible,"),
    "v2 shell bridge render payload should keep open/settings/visible inside the raw panel snapshot"
  );
  assert(
    !/panelSnapshot:\s*\{[\s\S]*?settingsHydrated:/.test(source),
    "v2 shell bridge render payload should not send the content-only settingsHydrated render gate"
  );
}

function verifyRenderPayloadDoesNotCarryToolSummaries() {
  const source = fs.readFileSync(path.join(root, "content", "panel-v2-shell-bridge.js"), "utf8");
  assert(
    !source.includes("buildToolSummarySnapshot"),
    "v2 shell bridge render payload should not request hosted-owned meeting/release summaries from extension callbacks"
  );
  assert(
    !/panelSnapshot:\s*\{[\s\S]*?meetingTool:/.test(source),
    "v2 shell bridge render payload should not carry hosted-owned meetingTool state"
  );
  assert(
    !/panelSnapshot:\s*\{[\s\S]*?releaseTool:/.test(source),
    "v2 shell bridge render payload should not carry hosted-owned releaseTool state"
  );
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main();
