#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyRefreshStateLoadsStorageAndBookmarks();
  verifyLaneAwareStorageChangeHandling();
  verifyPromptLibraryStorageChangesAreIgnored();
  await verifySameSessionPartialRefreshKeepsStableBookmarks();
  await verifyRouteWaitLifecycle();
  await verifyRouteWaitSettlesAfterMutationQuiet();
  console.log("[verify-route-state-controller] Route state controller contract passed");
}

async function verifyRefreshStateLoadsStorageAndBookmarks() {
  const harness = createHarness({
    sessionId: "session-1",
    routeBaselineSignature: "sig-before",
    routeWaitStartedAt: Date.now(),
    awaitingRouteMessages: true,
    storageState: {
      pausedSessions: { "session-2": true },
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
  assert.equal(harness.state.uiPreferences.activeTool, "prompts");
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
    "lane:pausedSessionsKey": { newValue: { "session-3": true } },
    "lane:settingsKey": { newValue: { autoBookmark: false, enabled: true } },
    "lane:uiPreferencesKey": { newValue: { activePromptTab: "review", activeTool: "store" } },
  }, "local");

  assert.equal(changed, true);
  assert.equal(harness.state.settings.autoBookmark, false);
  assert.equal(harness.state.activeTool, "prompts");
  assert.equal(harness.state.uiPreferences.activeTool, "prompts");
  assert.equal(harness.state.uiPreferences.activePromptTab, "store");
  assert.deepEqual(harness.state.pausedSessions, { "session-3": true });
}

function verifyPromptLibraryStorageChangesAreIgnored() {
  const harness = createHarness();

  const changed = harness.controller.handleStorageChange({
    "lane:promptLibraryKey": { newValue: { items: [{ title: "변경", content: "됨" }] } },
  }, "local");

  assert.equal(changed, false);
  assert.equal("promptLibrary" in harness.state, false);
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

async function verifySameSessionPartialRefreshKeepsStableBookmarks() {
  const harness = createHarness({
    awaitingRouteMessages: false,
    liveBookmarks: [{ id: "bookmark-2", order: 2, text: "둘째 질문" }],
    liveSignature: "sig-partial",
    routeBaselineSignature: "sig-full",
    sessionId: "session-2",
  });

  harness.state.bookmarks = [
    { id: "bookmark-1", order: 1, text: "첫 질문" },
    { id: "bookmark-2", order: 2, text: "둘째 질문" },
    { id: "bookmark-3", order: 3, text: "셋째 질문" },
  ];

  await harness.controller.refreshState();

  assert.deepEqual(harness.state.bookmarks, [
    { id: "bookmark-1", order: 1, text: "첫 질문" },
    { id: "bookmark-2", order: 2, text: "둘째 질문" },
    { id: "bookmark-3", order: 3, text: "셋째 질문" },
  ]);
}

async function verifyRouteWaitSettlesAfterMutationQuiet() {
  const harness = createHarness({
    awaitingRouteMessages: true,
    liveBookmarks: [{ id: "bookmark-2", text: "둘째 질문" }],
    liveSignature: "sig-next",
    routeBaselineSignature: "sig-start",
    routeLastMutationAt: Date.now(),
    routeWaitStartedAt: Date.now(),
    sessionId: "session-2",
  });

  await harness.controller.refreshState();
  assert.equal(harness.state.awaitingRouteMessages, true);
  assert.deepEqual(harness.state.bookmarks, []);

  harness.state.routeLastMutationAt = Date.now() - 400;
  await harness.controller.refreshState();
  assert.equal(harness.state.awaitingRouteMessages, false);
  assert.deepEqual(harness.state.bookmarks, [{ id: "bookmark-2", text: "둘째 질문" }]);
}

function createHarness(options = {}) {
  const debugEvents = [];
  const storageState = cloneValue(options.storageState || {
    pausedSessions: {},
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
        pausedSessions: "pausedSessionsKey",
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
  };

  loadScript("content/route-state-controller.js", context);

  const state = {
    activeId: "",
    activeTool: options.activeTool || "bookmarks",
    awaitingRouteMessages: Boolean(options.awaitingRouteMessages),
    bookmarks: [],
    lastError: "",
    open: false,
    pausedSessions: options.pausedSessions || {},
    preferredOpen: true,
    promptReview: { open: true },
    routeBaselineSignature: options.routeBaselineSignature || "",
    routeLastMutationAt: options.routeLastMutationAt || 0,
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
