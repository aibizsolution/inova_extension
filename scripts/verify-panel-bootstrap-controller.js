#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyBootstrapWiringAndScheduling();
  await verifyBootstrapSkipsMeetingLifecycleWiring();
  verifyRouteStorageChangeDelegation();
  console.log("[verify-panel-bootstrap-controller] V2 shell bridge bootstrap contract passed");
}

async function verifyBootstrapWiringAndScheduling() {
  const harness = createHarness({
    activeTool: "release",
    open: true,
    storeTabActive: true,
  });

  await harness.controller.bootstrap();
  await harness.flush();

  assert.equal(harness.lifecycleInitializeCalls, 1);
  assert.deepEqual(harness.providerIdentityReasons, ["bootstrap"]);
  assert.equal(typeof harness.callbacks.onToolSummarySync, "function");
  assert.equal(typeof harness.callbacks.onSearch, "function");
  assert.equal(typeof harness.callbacks.onToggle, "function");
  [
    "onMeetingSummarySync",
    "onMeetingAction",
    "onImportFile",
    "onMovePrompt",
    "onPromptAction",
    "onPromptDraftChange",
    "onReleaseSummarySync",
    "onSelectPromptTab",
    "onStoreAction",
  ].forEach((callbackKey) => assert.equal(
    callbackKey in harness.callbacks,
    false,
    `bootstrap default callback surface should drop the legacy callback ${callbackKey}`
  ));
  assert.equal(harness.debugInstallCalls, 1);
  assert.equal(harness.reviewFloatEnsureCalls, 1);
  assert.equal(harness.routeWatchInstallCalls, 1);
  assert.equal(harness.surfaceWatchInstallCalls, 1);
  assert.equal(typeof harness.windowListeners.resize, "function");
  assert.equal(typeof harness.windowListeners.focus, "function");
  assert.equal(typeof harness.documentListeners.visibilitychange, "function");
  assert.equal(harness.storageListeners.length, 2);
  assert.deepEqual(harness.routeSyncCalls, [true]);
  assert.deepEqual(harness.releaseEnsureCalls, [{ allowCached: false, preferFresh: true }]);
  assert.deepEqual(harness.timeoutDelays, [450, 1200]);

  harness.timeoutCallbacks.forEach((callback) => callback());
  assert.equal(harness.routeRefreshCalls, 2);
}

async function verifyBootstrapSkipsMeetingLifecycleWiring() {
  const harness = createHarness();
  await harness.controller.bootstrap();
  await harness.flush();

  assert.equal(harness.storageListeners.length, 2);
}

function verifyRouteStorageChangeDelegation() {
  const harness = createHarness();
  harness.routeStateShouldRefresh = false;
  harness.controller.handleRouteStorageChange({}, "local");
  assert.equal(harness.routeRefreshCalls, 0);

  harness.routeStateShouldRefresh = true;
  harness.controller.handleRouteStorageChange({}, "local");
  assert.equal(harness.routeRefreshCalls, 1);
}

function createHarness(options = {}) {
  const documentListeners = {};
  const windowListeners = {};
  const storageListeners = [];
  const timeoutCallbacks = [];
  const timeoutDelays = [];

  const context = vm.createContext({
    chrome: {
      storage: {
        onChanged: {
          addListener(listener) {
            storageListeners.push(listener);
          },
        },
      },
    },
    console,
    document: {
      addEventListener(type, handler) {
        documentListeners[type] = handler;
      },
      visibilityState: "visible",
    },
    globalThis: null,
    setTimeout(callback, delay) {
      timeoutCallbacks.push(callback);
      timeoutDelays.push(delay);
      return timeoutCallbacks.length;
    },
  });
  context.globalThis = context;
  context.addEventListener = (type, handler) => {
    windowListeners[type] = handler;
  };

  let callbacks = null;
  let routeStateShouldRefresh = true;
  let routeRefreshCalls = 0;
  let debugInstallCalls = 0;
  let reviewFloatEnsureCalls = 0;
  let routeWatchInstallCalls = 0;
  let surfaceWatchInstallCalls = 0;
  let lifecycleInitializeCalls = 0;
  const providerIdentityReasons = [];
  const routeSyncCalls = [];
  const releaseEnsureCalls = [];

  context.InovaBookmarks = {
    contentPanel: {
      ensurePanel(nextCallbacks) {
        callbacks = nextCallbacks;
        return {};
      },
    },
    panelDebug: {
      subscribe() {},
    },
  };

  loadScript("content/panel-v2-shell-bridge.js", context);

  const state = {
    activeTool: options.activeTool || "bookmarks",
    awaitingRouteMessages: Boolean(options.awaitingRouteMessages),
    bookmarks: Array.isArray(options.bookmarks) ? options.bookmarks.slice() : [],
    lastError: options.lastError || "",
    open: Boolean(options.open),
  };

  const controller = context.InovaBookmarks.panelV2ShellBridge.createBootstrapController(state, {
    handlePanelMeetingAction: async () => {},
    handlePanelToolSummarySync: async () => {},
    isStoreTabActive() {
      return Boolean(options.storeTabActive);
    },
    panelActivityController: {
      handleVisibilityChange() {},
      handleWindowFocus() {},
    },
    panelBookmarkController: {
      async copyBookmarkText() {},
      jumpToBookmark() {},
    },
    panelDebugController: {
      installValidationApi() {
        debugInstallCalls += 1;
      },
    },
    panelLifecycleController: {
      initializeOpenState() {
        lifecycleInitializeCalls += 1;
      },
      togglePanel() {},
    },
    panelPromptController: {
      ensureReviewFloat() {
        reviewFloatEnsureCalls += 1;
      },
      handleDraftChange() {},
      handleEscape() {},
      handleImportFile() {},
      handlePromptAction() {},
      handleStoreAction() {},
      movePromptItem() {},
      selectPromptTab() {},
    },
    panelShellController: {
      selectTool() {},
      submitQuery() {},
      updateHandlePosition() {},
      updateQuery() {},
    },
    panelSurfaceController: {
      installSurfaceWatchers() {
        surfaceWatchInstallCalls += 1;
      },
    },
    providerIdentitySync: {
      async syncToStorage(reason) {
        providerIdentityReasons.push(reason);
        return true;
      },
    },
    releaseManager: {
      ensureChecked(allowCached, preferFresh) {
        releaseEnsureCalls.push({
          allowCached: Boolean(allowCached),
          preferFresh: Boolean(preferFresh),
        });
      },
      handleAction() {},
      handleStorageChange() {},
    },
    render() {},
    routeStateController: {
      handleStorageChange() {
        return routeStateShouldRefresh;
      },
    },
    routeSync: {
      scheduleRefresh() {
        routeRefreshCalls += 1;
      },
      async syncRouteState(force) {
        routeSyncCalls.push(Boolean(force));
      },
    },
    routeWatchController: {
      installRouteWatchers() {
        routeWatchInstallCalls += 1;
      },
    },
  });

  return {
    controller,
    documentListeners,
    flush() {
      return Promise.resolve();
    },
    get callbacks() {
      return callbacks;
    },
    get debugInstallCalls() {
      return debugInstallCalls;
    },
    get lifecycleInitializeCalls() {
      return lifecycleInitializeCalls;
    },
    get providerIdentityReasons() {
      return providerIdentityReasons;
    },
    get releaseEnsureCalls() {
      return releaseEnsureCalls;
    },
    get reviewFloatEnsureCalls() {
      return reviewFloatEnsureCalls;
    },
    get routeRefreshCalls() {
      return routeRefreshCalls;
    },
    get routeStateShouldRefresh() {
      return routeStateShouldRefresh;
    },
    get routeSyncCalls() {
      return routeSyncCalls;
    },
    get routeWatchInstallCalls() {
      return routeWatchInstallCalls;
    },
    set routeStateShouldRefresh(value) {
      routeStateShouldRefresh = Boolean(value);
    },
    get surfaceWatchInstallCalls() {
      return surfaceWatchInstallCalls;
    },
    timeoutCallbacks,
    timeoutDelays,
    windowListeners,
    storageListeners,
  };
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

main().catch((error) => {
  console.error(`[verify-panel-bootstrap-controller] ${error.stack || error.message}`);
  process.exit(1);
});
