#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  await verifyBootstrapWiringAndScheduling();
  await verifyBootstrapSkipsMeetingLifecycleWiring();
  await verifyExternalToggleDoesNotFallbackToContentOpenState();
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
  assert.equal(typeof harness.callbacks.onHandlePositionChange, "function");
  assert.equal(typeof harness.callbacks.onPanelChromeSync, "function");
  assert.equal(typeof harness.callbacks.onToggle, "function");
  assert.equal(harness.callbacks.onToggle(), true);
  assert.deepEqual(harness.panelEvents, ["external-toggle"]);
  [
    "onEscape",
    "onCopyBookmark",
    "onJumpBookmark",
    "onMeetingSummarySync",
    "onMeetingAction",
    "onImportFile",
    "onMovePrompt",
    "onPromptAction",
    "onPromptDraftChange",
    "onReleaseAction",
    "onReleaseSummarySync",
    "onSearch",
    "onSearchSubmit",
    "onSelectTool",
    "onSelectPromptTab",
    "onStoreAction",
    "onToolSummarySync",
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
  assert.equal(harness.storageListeners.length, 1);
  assert.deepEqual(harness.routeSyncCalls, [true]);
  assert.deepEqual(harness.timeoutDelays, [450, 1200]);

  harness.timeoutCallbacks.forEach((callback) => callback());
  assert.equal(harness.routeRefreshCalls, 2);
}

async function verifyBootstrapSkipsMeetingLifecycleWiring() {
  const harness = createHarness();
  await harness.controller.bootstrap();
  await harness.flush();

  assert.equal(harness.storageListeners.length, 1);
}

async function verifyExternalToggleDoesNotFallbackToContentOpenState() {
  const harness = createHarness({
    emitPanelEventResult: false,
  });
  await harness.controller.bootstrap();
  await harness.flush();

  assert.equal(harness.callbacks.onToggle(), false);
  assert.deepEqual(harness.panelEvents, ["external-toggle"]);
  assert.equal(
    harness.lifecycleToggleCalls,
    0,
    "external handle toggle should not mutate content-side open state when hosted event delivery is unavailable"
  );
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
  let lifecycleToggleCalls = 0;
  const panelEvents = [];
  const providerIdentityReasons = [];
  const routeSyncCalls = [];
  context.InovaBookmarks = {
    contentPanel: {
      emitPanelEvent(action) {
        panelEvents.push(String(action || ""));
        return options.emitPanelEventResult !== false;
      },
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
    isStoreTabActive() {
      return Boolean(options.storeTabActive);
    },
    panelActivityController: {
      handleVisibilityChange() {},
      handleWindowFocus() {},
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
      togglePanel() {
        lifecycleToggleCalls += 1;
      },
    },
    promptShellController: {
      ensureReviewFloat() {
        reviewFloatEnsureCalls += 1;
      },
      handleDraftChange() {},
      handleImportFile() {},
      handlePromptAction() {},
      handleStoreAction() {},
      movePromptItem() {},
      selectPromptTab() {},
    },
    panelShellController: {
      updateHandlePosition() {},
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
    get lifecycleToggleCalls() {
      return lifecycleToggleCalls;
    },
    get panelEvents() {
      return panelEvents;
    },
    get providerIdentityReasons() {
      return providerIdentityReasons;
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
