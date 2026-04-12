#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyBootstrapWiringAndScheduling();
  verifyRouteStorageChangeDelegation();
  console.log("[verify-panel-bootstrap-controller] Panel bootstrap controller contract passed");
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
  assert.equal(typeof harness.callbacks.onMeetingAction, "function");
  assert.equal(typeof harness.callbacks.onSearch, "function");
  assert.equal(typeof harness.callbacks.onToggle, "function");
  assert.equal(harness.debugInstallCalls, 1);
  assert.equal(harness.reviewFloatEnsureCalls, 1);
  assert.equal(harness.routeWatchInstallCalls, 1);
  assert.equal(harness.surfaceWatchInstallCalls, 1);
  assert.equal(typeof harness.windowListeners.resize, "function");
  assert.equal(typeof harness.windowListeners.focus, "function");
  assert.equal(typeof harness.documentListeners.visibilitychange, "function");
  assert.equal(harness.storageListeners.length, 4);
  assert.deepEqual(harness.routeSyncCalls, [true]);
  assert.deepEqual(harness.meetingScheduleCalls, [260]);
  assert.deepEqual(harness.promptRealtimeCalls, [260]);
  assert.deepEqual(harness.promptCloudCalls, [260]);
  assert.equal(harness.ensureStoreLoadedCalls, 1);
  assert.deepEqual(harness.releaseEnsureCalls, [{ allowCached: false, preferFresh: true }]);
  assert.deepEqual(harness.timeoutDelays, [450, 1200]);

  harness.timeoutCallbacks.forEach((callback) => callback());
  assert.equal(harness.routeRefreshCalls, 2);
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
  let ensureStoreLoadedCalls = 0;
  let debugInstallCalls = 0;
  let reviewFloatEnsureCalls = 0;
  let routeWatchInstallCalls = 0;
  let surfaceWatchInstallCalls = 0;
  let lifecycleInitializeCalls = 0;
  const providerIdentityReasons = [];
  const routeSyncCalls = [];
  const meetingScheduleCalls = [];
  const promptRealtimeCalls = [];
  const promptCloudCalls = [];
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

  loadScript("content/panel-bootstrap-controller.js", context);

  const state = {
    activeTool: options.activeTool || "bookmarks",
    open: Boolean(options.open),
  };

  const controller = context.InovaBookmarks.panelBootstrapController.create(state, {
    handlePanelMeetingAction: async () => {},
    isStoreTabActive() {
      return Boolean(options.storeTabActive);
    },
    meetingManager: {
      handleStorageChange() {},
      scheduleSync(delay) {
        meetingScheduleCalls.push(delay);
      },
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
      ensureStoreLoaded() {
        ensureStoreLoadedCalls += 1;
      },
      handleDraftChange() {},
      handleEscape() {},
      handleImportFile() {},
      handlePromptAction() {},
      handleStorageChange() {},
      handleStoreAction() {},
      movePromptItem() {},
      scheduleCloudSyncIfNeeded(delay) {
        promptCloudCalls.push(delay);
      },
      scheduleRealtimeSync(delay) {
        promptRealtimeCalls.push(delay);
      },
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
    get ensureStoreLoadedCalls() {
      return ensureStoreLoadedCalls;
    },
    get lifecycleInitializeCalls() {
      return lifecycleInitializeCalls;
    },
    get meetingScheduleCalls() {
      return meetingScheduleCalls;
    },
    get promptCloudCalls() {
      return promptCloudCalls;
    },
    get promptRealtimeCalls() {
      return promptRealtimeCalls;
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
