#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyRefreshStateLoadsStorageAndBookmarks();
  verifyLaneAwareStorageChangeHandling();
  await verifyRouteWaitLifecycle();
  console.log("[verify-route-state-controller] Route state controller contract passed");
}

async function verifyRefreshStateLoadsStorageAndBookmarks() {
  const harness = createHarness({
    sessionId: "session-1",
    routeBaselineSignature: "sig-before",
    routeWaitStartedAt: Date.now(),
    awaitingRouteMessages: true,
    storageState: {
      cloudSync: { source: "runtime" },
      pausedSessions: { "session-2": true },
      promptLibrary: { items: [{ title: "알림", content: "본문" }] },
      settings: { autoBookmark: true, enabled: true, meetingDebug: false },
      uiPreferences: { activePromptTab: "review", activeTool: "store" },
    },
    uiPreferenceLockResult: {
      activePromptTab: "store",
      activeTool: "prompts",
      handleRatios: {},
    },
  });

  await harness.controller.refreshState();

  assert.equal(harness.state.sessionTitle, "테스트 세션");
  assert.equal(harness.state.activeTool, "prompts");
  assert.equal(harness.state.uiPreferences.activePromptTab, "store");
  assert.deepEqual(harness.state.bookmarks, [{ id: "bookmark-1", text: "첫 질문" }]);
  assert.equal(harness.state.awaitingRouteMessages, false);
  assert.equal(harness.state.routeBaselineSignature, "sig-after");
  assert.equal(harness.state.lastError, "");
}

function verifyLaneAwareStorageChangeHandling() {
  const harness = createHarness({
    uiPreferenceLockResult: {
      activePromptTab: "store",
      activeTool: "store",
      handleRatios: {},
    },
  });

  const changed = harness.controller.handleStorageChange({
    "lane:cloudSyncKey": { newValue: { source: "cache" } },
    "lane:pausedSessionsKey": { newValue: { "session-3": true } },
    "lane:promptLibraryKey": { newValue: { items: [{ title: "변경", content: "됨" }] } },
    "lane:settingsKey": { newValue: { autoBookmark: false, enabled: true } },
    "lane:uiPreferencesKey": { newValue: { activePromptTab: "review", activeTool: "store" } },
  }, "local");

  assert.equal(changed, true);
  assert.equal(harness.state.settings.autoBookmark, false);
  assert.equal(harness.state.activeTool, "prompts");
  assert.equal(harness.state.uiPreferences.activePromptTab, "store");
  assert.deepEqual(harness.state.pausedSessions, { "session-3": true });
  assert.deepEqual(harness.state.promptLibrary.items, [{ title: "변경", content: "됨" }]);
  assert.deepEqual(harness.state.cloudSync, { mergedSource: "cache" });
}

async function verifyRouteWaitLifecycle() {
  const harness = createHarness({
    conversationState: {
      articleCount: 2,
      hasChatLog: true,
      hasComposer: false,
    },
    sessionId: "",
  });

  harness.controller.resetRouteState("session-2", "sig-start");
  assert.equal(harness.state.sessionId, "session-2");
  assert.equal(harness.state.sessionTitle, "테스트 세션");
  assert.equal(harness.state.open, false);
  assert.equal(harness.state.awaitingRouteMessages, true);
  assert.equal(harness.state.routeBaselineSignature, "sig-start");

  harness.liveBookmarks = [];
  harness.liveSignature = "sig-start";
  harness.state.settings = { autoBookmark: true, enabled: true };
  harness.state.routeWaitStartedAt = Date.now();
  await harness.controller.refreshState();
  assert.equal(harness.state.awaitingRouteMessages, true);
  assert.deepEqual(harness.state.bookmarks, []);

  harness.state.routeWaitStartedAt = Date.now() - 2000;
  await harness.controller.refreshState();
  assert.equal(harness.state.awaitingRouteMessages, false);
  assert.deepEqual(harness.state.bookmarks, []);
}

function createHarness(options = {}) {
  const debugEvents = [];
  const storageState = cloneValue(options.storageState || {
    cloudSync: {},
    pausedSessions: {},
    promptLibrary: { items: [] },
    settings: { autoBookmark: true, enabled: true },
    uiPreferences: { activePromptTab: "library", activeTool: "bookmarks" },
  });
  const conversationState = {
    articleCount: 1,
    hasChatLog: true,
    hasComposer: true,
    ...(options.conversationState || {}),
  };
  const context = vm.createContext({
    console,
    Date,
    globalThis: null,
  });
  context.globalThis = context;
  context.InovaBookmarks = {
    cloudSync: {
      mergeCloudSyncState(value) {
        return {
          mergedSource: value?.source || "none",
        };
      },
    },
    constants: {
      defaults: {
        promptReview: { open: false },
        settings: {
          autoBookmark: true,
          enabled: true,
          meetingDebug: true,
        },
      },
      storageKeys: {
        cloudSync: "cloudSyncKey",
        pausedSessions: "pausedSessionsKey",
        promptLibrary: "promptLibraryKey",
        settings: "settingsKey",
        uiPreferences: "uiPreferencesKey",
      },
    },
    contentDom: {
      collectUserMessages() {
        return cloneValue(harness.liveBookmarks);
      },
      getConversationState() {
        return cloneValue(conversationState);
      },
      getSessionTitle() {
        return "테스트 세션";
      },
      getUserMessageSignature() {
        return harness.liveSignature;
      },
    },
    panelDebug: {
      log(event, payload) {
        debugEvents.push({ event, payload: cloneValue(payload) });
      },
    },
    productLane: {
      getStorageChange(changes, storageKey) {
        return changes[`lane:${storageKey}`];
      },
    },
    promptLibrary: {
      mergePromptLibrary(value) {
        return {
          items: Array.isArray(value?.items) ? cloneValue(value.items) : [],
        };
      },
    },
    session: {
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
    storage: {
      async getState() {
        return cloneValue(storageState);
      },
      mergeUiPreferences(value = {}) {
        return {
          activePromptTab: "library",
          activeTool: "bookmarks",
          handleRatios: {},
          ...cloneValue(value),
        };
      },
    },
  };

  loadScript("content/route-state-controller.js", context);

  const state = {
    activeId: "",
    activeTool: options.activeTool || "bookmarks",
    awaitingRouteMessages: Boolean(options.awaitingRouteMessages),
    bookmarks: [],
    cloudSync: {},
    lastError: "",
    open: false,
    pausedSessions: options.pausedSessions || {},
    preferredOpen: true,
    promptLibrary: { items: [] },
    promptReview: { open: true },
    routeBaselineSignature: options.routeBaselineSignature || "",
    routeWaitStartedAt: options.routeWaitStartedAt || 0,
    sessionId: options.sessionId || "",
    sessionTitle: "",
    settings: {
      autoBookmark: true,
      enabled: true,
      meetingDebug: true,
    },
    uiPreferences: {
      activePromptTab: "library",
      activeTool: "bookmarks",
    },
  };

  const harness = {
    controller: null,
    debugEvents,
    liveBookmarks: cloneValue(options.liveBookmarks || [{ id: "bookmark-1", text: "첫 질문" }]),
    liveSignature: options.liveSignature || "sig-after",
    state,
  };

  harness.controller = context.InovaBookmarks.routeStateController.create(state, {
    applyUiPreferenceLock(uiPreferences) {
      return cloneValue(options.uiPreferenceLockResult || uiPreferences);
    },
    normalizeToolId(toolId) {
      return toolId === "release" || toolId === "prompts" || toolId === "meeting"
        ? toolId
        : toolId === "store"
            ? "prompts"
            : "bookmarks";
    },
  });

  return harness;
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-route-state-controller] ${error.stack || error.message}`);
  process.exit(1);
});
