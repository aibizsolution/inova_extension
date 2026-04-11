#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function main() {
  verifyRenderPayloadAndReviewFloat();
  verifyVisibleStateCalculation();
  console.log("[verify-panel-render-controller] Panel render controller contract passed");
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
  assert.equal(harness.renderPayloads[0].activeTool, "meeting");
  assert.equal(harness.renderPayloads[0].handleCount, 2);
  assert.equal(harness.renderPayloads[0].meetingTool.count, 2);
  assert.equal(harness.renderPayloads[0].toolTitle, "회의 룸");
  assert.equal(harness.renderPayloads[0].visible, true);
  assert.deepEqual(harness.reviewFloatStates, [{ visible: true }]);
}

function verifyVisibleStateCalculation() {
  const harness = createHarness({
    settings: { enabled: false },
  });

  harness.controller.render();

  assert.equal(harness.renderPayloads[0].visible, false);
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
    },
  };

  loadScript("content/panel-render-controller.js", context);

  const state = {
    activeTool: options.activeTool || "bookmarks",
    meetingHub: { items: [] },
    open: Boolean(options.open),
    settings: {
      enabled: true,
      ...(options.settings || {}),
    },
    uiPreferences: {},
  };

  const controller = context.InovaBookmarks.panelRenderController.create(state, {
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
    panelMeetingController: {
      buildToolState() {
        return {
          count: 2,
        };
      },
    },
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
    panelShellController: {
      buildRenderChrome(counts) {
        return {
          handleCount: counts.meeting,
          toolCount: counts.meeting,
          toolTitle: "회의 룸",
          tools: [
            { count: counts.bookmarks, id: "bookmarks", label: "대화" },
            { count: counts.meeting, id: "meeting", label: "회의 룸" },
            { count: counts.prompts, id: "prompts", label: "프롬프트" },
            { count: counts.release, id: "release", label: "릴리스" },
          ],
        };
      },
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

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main();
