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
  assert.equal(typeof harness.callbacks.onPromptAction, "function");
  assert.equal(typeof harness.callbacks.onSelectTool, "function");
  assert.equal(typeof harness.callbacks.onToggle, "function");

  const initialPayload = harness.renderPayloads.at(-1);
  assert(initialPayload, "Panel should render at least once");
  assert.equal(initialPayload.meetingTool.count, 2);
  assert.equal(initialPayload.bookmarksTool.count, 1);
  assert.equal(initialPayload.promptTool.activeTab, "library");
  assert.equal(initialPayload.panelDebug.enabled, true);
  assert.equal(harness.reviewFloatEnsured, 1);
  assert.equal(harness.reviewFloatStates.at(-1)?.visible, true);
  assert.equal(typeof harness.windowListeners.focus, "function");
  assert.equal(typeof harness.documentListeners.visibilitychange, "function");
  assert.equal(harness.activityControllerCreated, 1);
  assert.equal(harness.bootstrapControllerCreated, 1);
  assert.equal(harness.bootstrapCalls, 1);
  assert.equal(harness.renderControllerCreated, 1);
  assert.equal(harness.stateFactoryCreated, 1);
  assert.equal(harness.compositionControllerCreated, 1);
  assert.equal(harness.runtimeControllerCreated, 1);
  assert.equal(harness.actionControllerCreated, 1);
  assert.equal(harness.routeWatchInstallCalls, 1);
  assert.equal(harness.surfaceWatchInstallCalls, 1);

  await harness.callbacks.onCopyBookmark("bookmark-1");
  harness.callbacks.onJumpBookmark("bookmark-1");
  await harness.callbacks.onHandlePositionChange(0.61);
  harness.callbacks.onSearch("bookmarks", "회의");
  harness.callbacks.onSearchSubmit("bookmarks", "회의");

  assert.deepEqual(harness.bookmarkCopyCalls, ["bookmark-1"]);
  assert.deepEqual(harness.bookmarkJumpCalls, ["bookmark-1"]);
  assert.deepEqual(harness.handlePositionCalls, [0.61]);
  assert.deepEqual(harness.shellQueries, [{ options: {}, toolId: "bookmarks", value: "회의" }]);
  assert.deepEqual(harness.shellSubmitQueries, [{ toolId: "bookmarks", value: "회의" }]);

  await harness.callbacks.onMeetingAction("debug-toggle", {});
  assert.deepEqual(harness.debugActions, ["debug-toggle"]);
  assert.deepEqual(harness.meetingActions, []);

  await harness.callbacks.onMeetingAction("share", { meetingId: "meeting-alpha" });
  assert.deepEqual(harness.meetingActions, [{ action: "share", detail: { meetingId: "meeting-alpha" } }]);

  harness.callbacks.onPromptAction("save-prompt", { promptId: "prompt-1" });
  harness.callbacks.onPromptDraftChange("title", "새 제목");
  harness.callbacks.onSelectPromptTab("store");

  assert.deepEqual(harness.promptActions, [{ action: "save-prompt", detail: { promptId: "prompt-1" } }]);
  assert.deepEqual(harness.promptDrafts, [{ field: "title", value: "새 제목" }]);
  assert.deepEqual(harness.promptTabSelections, ["store"]);

  harness.callbacks.onToggle(false);
  assert.deepEqual(harness.toggleCalls, [false]);

  await harness.callbacks.onSelectTool("release");
  const releasePayload = harness.renderPayloads.at(-1);
  assert.equal(releasePayload.activeTool, "release");
  assert.deepEqual(harness.shellToolSelections, ["release"]);

  console.log("[verify-panel-shell] Panel shell assembly contract passed");
}

function createHarness() {
  const controllerEvents = {
    bookmarkCopyCalls: [],
    bookmarkJumpCalls: [],
    debugActions: [],
    handlePositionCalls: [],
    meetingActions: [],
    promptActions: [],
    promptDrafts: [],
    promptTabSelections: [],
    reviewFloatStates: [],
    shellQueries: [],
    shellSubmitQueries: [],
    shellToolSelections: [],
    toggleCalls: [],
  };
  const ensureCalls = [];
  const renderPayloads = [];
  const scheduledTimeouts = [];
  const storageListeners = [];
  const documentListeners = {};
  const windowListeners = {};

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
  context.addEventListener = (type, handler) => {
    windowListeners[type] = handler;
  };
  context.globalThis.addEventListener = context.addEventListener;

  context.InovaBookmarks = buildNamespace({
    controllerEvents,
    ensureCalls,
    renderPayloads,
    runtime: context,
  });

  loadScript("content/panel-composition-controller.js", context);
  const originalCompositionCreate = context.InovaBookmarks.panelCompositionController.create;
  context.InovaBookmarks.panelCompositionController.create = function instrumentedCreate(state) {
    controllerEvents.compositionControllerCreated = (controllerEvents.compositionControllerCreated || 0) + 1;
    return originalCompositionCreate.call(this, state);
  };
  loadScript("content/main.js", context);

  return {
    bookmarkCopyCalls: controllerEvents.bookmarkCopyCalls,
    bookmarkJumpCalls: controllerEvents.bookmarkJumpCalls,
    callbacks: ensureCalls[0]?.callbacks || null,
    activityControllerCreated: controllerEvents.activityControllerCreated || 0,
    actionControllerCreated: controllerEvents.actionControllerCreated || 0,
    bootstrapCalls: controllerEvents.bootstrapCalls || 0,
    bootstrapControllerCreated: controllerEvents.bootstrapControllerCreated || 0,
    compositionControllerCreated: controllerEvents.compositionControllerCreated || 0,
    debugActions: controllerEvents.debugActions,
    documentListeners,
    handlePositionCalls: controllerEvents.handlePositionCalls,
    meetingActions: controllerEvents.meetingActions,
    promptActions: controllerEvents.promptActions,
    promptDrafts: controllerEvents.promptDrafts,
    promptTabSelections: controllerEvents.promptTabSelections,
    renderPayloads,
    reviewFloatEnsured: controllerEvents.reviewFloatEnsured || 0,
    reviewFloatStates: controllerEvents.reviewFloatStates,
    renderControllerCreated: controllerEvents.renderControllerCreated || 0,
    routeWatchInstallCalls: controllerEvents.routeWatchInstallCalls || 0,
    runtimeControllerCreated: controllerEvents.runtimeControllerCreated || 0,
    stateFactoryCreated: controllerEvents.stateFactoryCreated || 0,
    surfaceWatchInstallCalls: controllerEvents.surfaceWatchInstallCalls || 0,
    shellQueries: controllerEvents.shellQueries,
    shellSubmitQueries: controllerEvents.shellSubmitQueries,
    shellToolSelections: controllerEvents.shellToolSelections,
    storageListeners,
    toggleCalls: controllerEvents.toggleCalls,
    windowListeners,
    async flush() {
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function buildNamespace({ controllerEvents, ensureCalls, renderPayloads, runtime }) {
  const namespace = {
    cloudSync: {
      mergeCloudSyncState() {
        return {
          providerIdentity: {
            available: true,
            providerUserKey: "fixture-user",
          },
        };
      },
    },
    composerReviewFloat: {
      render(payload) {
        controllerEvents.reviewFloatStates.push(cloneValue(payload));
      },
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
    },
    contentPanel: {
      ensurePanel(callbacks) {
        ensureCalls.push({ callbacks });
        return {};
      },
      renderPanel(payload) {
        renderPayloads.push(cloneValue(payload));
      },
    },
    panelBookmarkController: {
      create() {
        return {
          buildToolState() {
            return {
              activeId: "",
              count: 1,
              emptyText: "",
              items: [{ id: "bookmark-1" }],
              metaText: "",
              query: "",
            };
          },
          async copyBookmarkText(bookmarkId) {
            controllerEvents.bookmarkCopyCalls.push(bookmarkId);
            return true;
          },
          jumpToBookmark(bookmarkId) {
            controllerEvents.bookmarkJumpCalls.push(bookmarkId);
          },
        };
      },
    },
    panelDebug: {
      subscribe() {},
    },
    panelActionController: {
      create(_state, deps) {
        controllerEvents.actionControllerCreated = (controllerEvents.actionControllerCreated || 0) + 1;
        return {
          async handlePanelMeetingAction(action, detail = {}) {
            if (deps.panelDebugController.handlesAction(action)) {
              await deps.panelDebugController.handleAction(action);
              return;
            }
            await deps.panelMeetingController.handleAction(action, detail);
          },
        };
      },
    },
    panelStateFactory: {
      createState() {
        controllerEvents.stateFactoryCreated = (controllerEvents.stateFactoryCreated || 0) + 1;
        return {
          sessionId: "",
          sessionTitle: "",
          open: false,
          preferredOpen: false,
          activeId: "",
          activeTool: namespace.constants.defaults.uiPreferences.activeTool,
          queries: { bookmarks: "", prompts: "", store: "" },
          settings: { ...namespace.constants.defaults.settings },
          pausedSessions: {},
          meetingHub: { ...namespace.constants.defaults.meetingHub },
          meetingUi: {
            feedback: null,
            feedbackTimer: 0,
            pending: { action: "", jobId: "", meetingId: "", startedAt: 0, title: "" },
          },
          panelDebugUi: {
            collapsed: namespace.panelDebugController.readCollapsedPreference(),
            feedback: null,
            feedbackTimer: 0,
          },
          cloudSync: namespace.cloudSync.mergeCloudSyncState(),
          releaseInfo: namespace.releaseInfo.mergeReleaseInfo(),
          uiPreferences: namespace.storage.mergeUiPreferences(),
          promptLibrary: namespace.promptLibrary.mergePromptLibrary(),
          promptEditor: { open: false, mode: "create", id: "", title: "", content: "", error: "" },
          promptImportReview: null,
          promptMenuId: "",
          promptDeleteConfirmId: "",
          promptPendingInsert: null,
          promptActionPending: null,
          promptPublishPromptId: "",
          promptPublishCategoryId: "document",
          promptPublishTitle: "",
          promptPublishError: "",
          promptFeedback: null,
          promptReview: { ...namespace.constants.defaults.promptReview },
          feedbackTimer: 0,
          bookmarks: [],
          store: {
            availableCategories: [],
            categoryId: "all",
            dataFreshness: "empty",
            degraded: false,
            degradedReason: "",
            error: "",
            expandedEntryId: "",
            feedback: null,
            feedbackTimer: 0,
            actionPending: null,
            deleteConfirmEntryId: "",
            hasMore: false,
            identityPending: false,
            items: [],
            limit: 1000,
            loaded: false,
            loading: false,
            appliedQuery: "",
            searchTimer: 0,
            scope: "all",
            sortBy: "latest",
            source: "none",
            totalCount: 0,
          },
          observer: null,
          surfacePollTimer: 0,
          surfaceSignature: "",
          syncTimer: 0,
          routeWatchInstalled: false,
          routePollTimer: 0,
          routeRetryTimers: [],
          lastRouteKey: "",
          routeBaselineSignature: "",
          routeWaitStartedAt: 0,
          awaitingRouteMessages: false,
          uiPreferenceLock: null,
          lastError: "",
        };
      },
    },
    panelRuntimeController: {
      create(state) {
        controllerEvents.runtimeControllerCreated = (controllerEvents.runtimeControllerCreated || 0) + 1;
        return {
          isExtensionContextInvalidatedError(error) {
            const message = namespace.session.normalizeText(error instanceof Error ? error.message : String(error || "")).toLowerCase();
            return message.includes("extension context invalidated");
          },
          isPaused() {
            return Boolean(state.sessionId && state.pausedSessions[state.sessionId]);
          },
          isStoreTabActive() {
            return state.activeTool === "prompts"
              && (state.uiPreferences.activeTool === "store" || state.uiPreferences.activePromptTab === "store");
          },
          isToolSurface() {
            return namespace.contentDom.getConversationState().hasComposer;
          },
          logPanelDebug(event, payload) {
            namespace.panelDebug.log?.(event, payload || {});
          },
        };
      },
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
    panelActivityController: {
      create() {
        controllerEvents.activityControllerCreated = (controllerEvents.activityControllerCreated || 0) + 1;
        return {
          handleVisibilityChange() {},
          handleWindowFocus() {},
        };
      },
    },
    panelBootstrapController: {
      create(_state, deps) {
        controllerEvents.bootstrapControllerCreated = (controllerEvents.bootstrapControllerCreated || 0) + 1;
        return {
          async bootstrap() {
            controllerEvents.bootstrapCalls = (controllerEvents.bootstrapCalls || 0) + 1;
            deps.panelLifecycleController.initializeOpenState();
            void deps.providerIdentitySync.syncToStorage?.("bootstrap");
            namespace.contentPanel.ensurePanel({
              onCopyBookmark: deps.panelBookmarkController.copyBookmarkText,
              onHandlePositionChange: deps.panelShellController.updateHandlePosition,
              onImportFile: deps.panelPromptController.handleImportFile,
              onJumpBookmark: deps.panelBookmarkController.jumpToBookmark,
              onMeetingAction: deps.handlePanelMeetingAction,
              onMovePrompt: deps.panelPromptController.movePromptItem,
              onPromptAction: deps.panelPromptController.handlePromptAction,
              onPromptDraftChange: deps.panelPromptController.handleDraftChange,
              onSelectPromptTab: deps.panelPromptController.selectPromptTab,
              onReleaseAction: deps.releaseManager.handleAction,
              onSearch: deps.panelShellController.updateQuery,
              onSearchSubmit: deps.panelShellController.submitQuery,
              onSelectTool: deps.panelShellController.selectTool,
              onStoreAction: deps.panelPromptController.handleStoreAction,
              onEscape: deps.panelPromptController.handleEscape,
              onToggle: deps.panelLifecycleController.togglePanel,
            });
            deps.panelDebugController.installValidationApi();
            deps.panelPromptController.ensureReviewFloat();
            deps.routeWatchController.installRouteWatchers();
            deps.panelSurfaceController.installSurfaceWatchers();
            runtime.addEventListener("resize", deps.render, { passive: true });
            runtime.addEventListener("focus", deps.panelActivityController.handleWindowFocus, { passive: true });
            runtime.document.addEventListener("visibilitychange", deps.panelActivityController.handleVisibilityChange, { passive: true });
            runtime.chrome.storage.onChanged.addListener(() => {
              deps.routeSync.scheduleRefresh();
            });
            runtime.chrome.storage.onChanged.addListener(deps.panelPromptController.handleStorageChange);
            runtime.chrome.storage.onChanged.addListener(deps.meetingManager.handleStorageChange);
            runtime.chrome.storage.onChanged.addListener(deps.releaseManager.handleStorageChange);
            await deps.routeSync.syncRouteState(true);
            deps.meetingManager.scheduleSync(260);
            deps.panelPromptController.scheduleRealtimeSync(260);
            deps.panelPromptController.scheduleCloudSyncIfNeeded(260);
            if (deps.isStoreTabActive()) {
              deps.panelPromptController.ensureStoreLoaded();
            }
            if (_state.open || _state.activeTool === "release") {
              deps.releaseManager.ensureChecked(false, _state.activeTool === "release");
            }
            [450, 1200].forEach((delay) => runtime.setTimeout(() => {
              if (
                _state.awaitingRouteMessages
                || _state.lastError
                || !Array.isArray(_state.bookmarks)
                || !_state.bookmarks.length
              ) {
                deps.routeSync.scheduleRefresh();
              }
            }, delay));
          },
          handleRouteStorageChange() {},
        };
      },
    },
    panelLifecycleController: {
      create() {
        return {
          initializeOpenState() {},
          togglePanel(nextOpen) {
            controllerEvents.toggleCalls.push(nextOpen);
          },
        };
      },
    },
    panelSurfaceController: {
      create() {
        return {
          installSurfaceWatchers() {
            controllerEvents.surfaceWatchInstallCalls = (controllerEvents.surfaceWatchInstallCalls || 0) + 1;
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
    panelPromptController: {
      create() {
        return {
          buildReviewFloatState(visible) {
            return {
              open: false,
              visible,
            };
          },
          buildToolState() {
            return {
              promptCount: 1,
              promptTool: { activeTab: "library", tabs: [] },
              promptToolCount: 1,
            };
          },
          ensureReviewFloat() {
            controllerEvents.reviewFloatEnsured = (controllerEvents.reviewFloatEnsured || 0) + 1;
          },
          ensureStoreLoaded() {},
          handleDraftChange(field, value) {
            controllerEvents.promptDrafts.push({ field, value });
          },
          handleEscape() {
            return false;
          },
          handleImportFile() {},
          handlePromptAction(action, detail) {
            controllerEvents.promptActions.push({ action, detail: cloneValue(detail) });
          },
          handleStorageChange() {},
          handleStoreAction() {},
          movePromptItem() {},
          scheduleCloudSyncIfNeeded() {},
          scheduleRealtimeSync() {},
          selectPromptTab(promptTabId) {
            controllerEvents.promptTabSelections.push(promptTabId);
          },
          async selectTool(toolId) {
            return toolId === "prompts" || toolId === "store";
          },
        };
      },
    },
    panelRenderController: {
      create(state, deps) {
        controllerEvents.renderControllerCreated = (controllerEvents.renderControllerCreated || 0) + 1;
        return {
          render() {
            deps.panelDebugController.syncEnabled();
            const bookmarkTool = deps.panelBookmarkController.buildToolState();
            const promptToolState = deps.panelPromptController.buildToolState();
            const meetingTool = deps.panelMeetingController.buildToolState(state.meetingHub);
            const panelDebug = deps.panelDebugController.buildState();
            const releaseState = deps.releaseManager.buildViewState();
            const handleCount = deps.panelShellController.buildHandleCount({
              bookmarks: bookmarkTool.count,
              meeting: meetingTool.count,
              promptTool: promptToolState.promptToolCount,
              prompts: promptToolState.promptCount,
              release: releaseState.updateAvailable ? 1 : 0,
            });
            namespace.contentPanel.renderPanel({
              activeTool: state.activeTool,
              bookmarksTool: bookmarkTool,
              handleCount,
              meetingTool,
              open: state.open,
              panelDebug,
              promptTool: promptToolState.promptTool,
              releaseTool: releaseState,
              visible: true,
            });
            namespace.composerReviewFloat.render(deps.panelPromptController.buildReviewFloatState(true));
          },
        };
      },
    },
    panelShellController: {
      create(state, deps) {
        return {
          buildHandleCount(counts) {
            const releaseCount = Number(counts.release) || 0;
            const bookmarkCount = Number(counts.bookmarks) || 0;
            const meetingCount = Number(counts.meeting) || 0;
            const promptCount = Number(counts.prompts) || 0;
            const promptToolCount = Number(counts.promptTool) || 0;
            if (state.activeTool === "bookmarks") {
              return bookmarkCount || promptCount || meetingCount || releaseCount;
            }
            if (state.activeTool === "prompts") {
              return promptToolCount;
            }
            if (state.activeTool === "meeting") {
              return meetingCount;
            }
            if (state.activeTool === "release") {
              return releaseCount;
            }
            return 0;
          },
          lockUiPreferenceSelection() {},
          normalizeToolId(toolId) {
            return toolId === "release" || toolId === "prompts" || toolId === "meeting"
              ? toolId
              : toolId === "store"
                  ? "prompts"
                  : "bookmarks";
          },
          async persistActiveTool() {},
          async selectTool(toolId) {
            controllerEvents.shellToolSelections.push(toolId);
            const promptController = deps.getPromptController?.();
            if (promptController && await promptController.selectTool(toolId)) {
              return true;
            }
            state.activeTool = toolId === "release" || toolId === "meeting" ? toolId : "bookmarks";
            deps.render?.();
            return true;
          },
          submitQuery(toolId, value) {
            controllerEvents.shellSubmitQueries.push({ toolId, value });
            return true;
          },
          async updateHandlePosition(ratio) {
            controllerEvents.handlePositionCalls.push(ratio);
          },
          updateQuery(toolId, value, options = {}) {
            controllerEvents.shellQueries.push({ options: cloneValue(options), toolId, value });
            return true;
          },
        };
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
    routeStateController: {
      create(state) {
        return {
          handleStorageChange() {
            return false;
          },
          async refreshState() {
            state.bookmarks = [{ id: "bookmark-1", normalizedText: "hello", text: "Hello" }];
          },
          resetRouteState(nextSessionId) {
            state.sessionId = nextSessionId || "";
          },
        };
      },
    },
    routeWatchController: {
      create(_state, hooks) {
        return {
          installRouteWatchers() {
            controllerEvents.routeWatchInstallCalls = (controllerEvents.routeWatchInstallCalls || 0) + 1;
            hooks.scheduleRouteSync?.("verify-install");
          },
        };
      },
    },
    routeSync: {
      create(state, hooks) {
        return {
          scheduleRefresh() {},
          scheduleRouteSync() {},
          async syncRouteState() {
            hooks.resetRouteState("session-1", "");
            await hooks.refreshState();
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
      mergeUiPreferences(current = {}, patch = {}) {
        return {
          activePromptTab: "library",
          activeTool: "meeting",
          handleRatios: {},
          ...cloneValue(current || {}),
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
