#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

async function main() {
  const harness = createHarness();
  await harness.flush();

  assert(harness.callbacks, "Panel callbacks should be registered");
  assert.equal(typeof harness.callbacks.onMeetingAction, "function");
  assert.equal(typeof harness.callbacks.onSelectTool, "function");
  assert.equal(typeof harness.callbacks.onToggle, "function");

  const initialPayload = harness.renderPayloads.at(-1);
  assert(initialPayload, "Panel should render at least once");
  assert.equal(initialPayload.meetingTool.count, 2);
  assert.equal(initialPayload.panelDebug.enabled, true);
  assert.equal(initialPayload.tools.length, 4);

  await harness.callbacks.onMeetingAction("debug-toggle", {});
  assert.deepEqual(harness.debugActions, ["debug-toggle"]);
  assert.deepEqual(harness.meetingActions, []);

  await harness.callbacks.onMeetingAction("share", { meetingId: "meeting-alpha" });
  assert.deepEqual(harness.meetingActions, [{ action: "share", detail: { meetingId: "meeting-alpha" } }]);

  harness.callbacks.onToggle(false);
  assert.deepEqual(harness.toggleCalls, [false]);

  await harness.callbacks.onSelectTool("release");
  const releasePayload = harness.renderPayloads.at(-1);
  assert.equal(releasePayload.activeTool, "release");
  assert.equal(releasePayload.toolTitle, "릴리스 안내");

  console.log("[verify-panel-shell] Panel shell assembly contract passed");
}

function createHarness() {
  const controllerEvents = {
    debugActions: [],
    meetingActions: [],
    toggleCalls: [],
  };
  const ensureCalls = [];
  const renderPayloads = [];
  const scheduledTimeouts = [];
  const storageListeners = [];

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
      addEventListener() {},
      visibilityState: "visible",
    },
    globalThis: null,
    innerWidth: 1280,
    navigator: {
      clipboard: {
        async writeText() {},
      },
    },
    setTimeout(callback, delay) {
      scheduledTimeouts.push({ callback, delay });
      return scheduledTimeouts.length;
    },
  });
  context.globalThis = context;
  context.addEventListener = () => {};

  context.InovaBookmarks = buildNamespace({
    controllerEvents,
    ensureCalls,
    renderPayloads,
  });

  loadScript("content/main.js", context);

  return {
    callbacks: ensureCalls[0]?.callbacks || null,
    debugActions: controllerEvents.debugActions,
    meetingActions: controllerEvents.meetingActions,
    renderPayloads,
    storageListeners,
    toggleCalls: controllerEvents.toggleCalls,
    async flush() {
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function buildNamespace({ controllerEvents, ensureCalls, renderPayloads }) {
  const namespace = {
    cloudSync: {
      hasPendingPromptSync() {
        return false;
      },
      mergeCloudSyncState() {
        return {
          providerIdentity: {
            available: true,
            providerUserKey: "fixture-user",
          },
        };
      },
    },
    cloudSyncManager: {
      create() {
        return {
          handleStorageChange() {},
          scheduleSync() {},
        };
      },
    },
    composerReviewFloat: {
      ensure() {},
      render() {},
    },
    constants: {
      defaults: {
        meetingHub: { items: [] },
        promptReview: { open: false },
        settings: {
          autoBookmark: true,
          enabled: true,
          meetingDebug: true,
        },
        uiPreferences: {
          activePromptTab: "library",
          activeTool: "meeting",
        },
      },
    },
    contentDom: {
      getConversationState() {
        return {
          articleCount: 1,
          hasChatLog: true,
          hasComposer: true,
          userCount: 1,
        };
      },
      scrollToMessage() {},
    },
    contentPanel: {
      ensurePanel(callbacks) {
        ensureCalls.push({ callbacks });
        return {};
      },
      focusBookmark() {},
      renderPanel(payload) {
        renderPayloads.push(cloneValue(payload));
      },
      setActiveBookmark() {},
    },
    panelDebug: {
      subscribe() {},
    },
    panelDebugController: {
      create() {
        return {
          buildState() {
            return {
              collapsed: false,
              enabled: true,
              hasErrors: false,
              statusSummary: { totalLogs: 0 },
            };
          },
          handleAction(action) {
            controllerEvents.debugActions.push(action);
            return Promise.resolve(true);
          },
          handlesAction(action) {
            return String(action || "").startsWith("debug");
          },
          installValidationApi() {},
          syncEnabled() {},
        };
      },
      readCollapsedPreference() {
        return false;
      },
    },
    panelLifecycleController: {
      create() {
        return {
          handleVisibilityChange() {},
          handleWindowFocus() {},
          initializeOpenState() {},
          installSurfaceWatchers() {},
          togglePanel(nextOpen) {
            controllerEvents.toggleCalls.push(nextOpen);
          },
        };
      },
    },
    panelMeetingController: {
      create(state) {
        return {
          buildToolState() {
            return {
              count: 2,
              feedback: state.meetingUi.feedback,
              items: [{ meetingId: "meeting-alpha" }, { meetingId: "meeting-beta" }],
              pending: state.meetingUi.pending,
            };
          },
          handleAction(action, detail) {
            controllerEvents.meetingActions.push({ action, detail: cloneValue(detail) });
            return Promise.resolve();
          },
        };
      },
    },
    promptHubRuntime: {
      create() {
        return {
          promptHubController: {
            handleEscape() {
              return false;
            },
            handlePromptAction() {},
            handleStoreAction() {},
            movePromptItem() {},
            selectPromptTab() {},
          },
          promptManager: {
            handleImportFile() {},
            updateDraft() {},
          },
          promptRealtimeManager: {
            scheduleSync() {},
          },
          promptReviewManager: {
            buildViewState() {
              return { open: false };
            },
            handleAction() {},
          },
          storeManager: {
            ensureLoaded() {},
            handleQueryChange() {},
            submitQuery() {},
          },
        };
      },
    },
    promptHubState: {
      buildPromptRenderState() {
        return {
          promptCount: 1,
          promptTool: { activeTab: "library", tabs: [] },
          promptToolCount: 1,
        };
      },
      getActivePromptTab() {
        return "library";
      },
      isStoreTabActive() {
        return false;
      },
      normalizePromptTab(promptTabId) {
        return promptTabId === "store" || promptTabId === "review" ? promptTabId : "library";
      },
      shouldRunPromptCloudSync() {
        return false;
      },
    },
    promptLibrary: {
      mergePromptLibrary() {
        return {
          items: [{ content: "본문", title: "프롬프트" }],
        };
      },
    },
    providerIdentitySync: {
      create() {
        return {
          syncToStorage() {
            return Promise.resolve(false);
          },
        };
      },
    },
    releaseInfo: {
      mergeReleaseInfo() {
        return {};
      },
    },
    releaseManager: {
      create() {
        return {
          buildViewState() {
            return { updateAvailable: false };
          },
          ensureChecked() {},
          handleAction() {},
          handleStorageChange() {},
        };
      },
    },
    routeSync: {
      create(state, hooks) {
        return {
          handleStorageChange() {},
          installRouteWatchers() {},
          scheduleRefresh() {},
          async syncRouteState() {
            state.bookmarks = [{ id: "bookmark-1", normalizedText: "hello", text: "Hello" }];
            hooks.render();
          },
        };
      },
    },
    session: {
      normalizeText(value) {
        return String(value || "").trim();
      },
    },
    storage: {
      getHandleRatio() {
        return 0.4;
      },
      getViewportBucket() {
        return "desktop";
      },
      mergeUiPreferences(current = {}, patch = {}) {
        return {
          activePromptTab: "library",
          activeTool: "meeting",
          handleRatios: {},
          ...cloneValue(current || {}),
          ...cloneValue(patch || {}),
        };
      },
      normalizeHandleRatio(value) {
        return Number(value) || 0;
      },
      async updateUiPreferences(patch = {}) {
        return {
          activePromptTab: "library",
          activeTool: "meeting",
          handleRatios: {},
          ...cloneValue(patch || {}),
        };
      },
    },
  };

  namespace.meetingManager = {
    create(state, hooks) {
      return {
        handleRouteStateChange() {
          hooks.render();
        },
        handleStorageChange() {},
        scheduleSync() {},
      };
    },
  };

  return namespace;
}

function loadScript(relativePath, context) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  new vm.Script(source, { filename: relativePath }).runInContext(context);
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-panel-shell] ${error.stack || error.message}`);
  process.exit(1);
});
