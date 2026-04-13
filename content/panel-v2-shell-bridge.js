(function initPanelV2ShellBridge(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function createHostedOwnedPanelActivityBridge(state, deps = {}) {
    const logPanelDebug = typeof deps.logPanelDebug === "function" ? deps.logPanelDebug : () => {};
    const meetingManager = deps.meetingManager || { scheduleSync() {} };
    const providerIdentitySync = deps.providerIdentitySync || { async syncToStorage() { return false; } };
    const releaseManager = deps.releaseManager || { ensureChecked() {} };
    const render = typeof deps.render === "function" ? deps.render : () => {};
    const schedulePromptCloudSyncIfNeeded = typeof deps.schedulePromptCloudSyncIfNeeded === "function"
      ? deps.schedulePromptCloudSyncIfNeeded
      : () => {};
    const schedulePromptRealtimeSync = typeof deps.schedulePromptRealtimeSync === "function"
      ? deps.schedulePromptRealtimeSync
      : () => {};

    return {
      handleVisibilityChange,
      handleWindowFocus,
    };

    function handleVisibilityChange() {
      if (global.document.visibilityState !== "visible") {
        meetingManager.scheduleSync(0);
        schedulePromptRealtimeSync(0);
        logPanelDebug("panel.ui.visibility.hidden", {
          scope: "panel-ui",
          tool: "panel",
        });
        render();
        return;
      }
      void providerIdentitySync.syncToStorage("visibility-visible");
      schedulePromptCloudSyncIfNeeded(320);
      meetingManager.scheduleSync(320);
      schedulePromptRealtimeSync(320);
      if (state.open) {
        releaseManager.ensureChecked();
      }
      logPanelDebug("panel.ui.visibility.visible", {
        scope: "panel-ui",
        tool: "panel",
      });
      render();
    }

    function handleWindowFocus() {
      void providerIdentitySync.syncToStorage("window-focus");
      schedulePromptCloudSyncIfNeeded(320);
      meetingManager.scheduleSync(320);
      schedulePromptRealtimeSync(320);
      if (state.open) {
        releaseManager.ensureChecked();
      }
      logPanelDebug("panel.ui.focus", {
        scope: "panel-ui",
        tool: "panel",
      });
      render();
    }
  }

  function createHostedOwnedPanelLifecycleBridge(state, deps = {}) {
    const isStoreTabActive = typeof deps.isStoreTabActive === "function" ? deps.isStoreTabActive : () => false;
    const logPanelDebug = typeof deps.logPanelDebug === "function" ? deps.logPanelDebug : () => {};
    const meetingManager = deps.meetingManager || { scheduleSync() {} };
    const releaseManager = deps.releaseManager || { ensureChecked() {} };
    const render = typeof deps.render === "function" ? deps.render : () => {};
    const schedulePromptCloudSyncIfNeeded = typeof deps.schedulePromptCloudSyncIfNeeded === "function"
      ? deps.schedulePromptCloudSyncIfNeeded
      : () => {};
    const schedulePromptRealtimeSync = typeof deps.schedulePromptRealtimeSync === "function"
      ? deps.schedulePromptRealtimeSync
      : () => {};
    const ensureStoreLoaded = typeof deps.ensureStoreLoaded === "function"
      ? deps.ensureStoreLoaded
      : () => {};
    const PANEL_OPEN_KEY = "inova-plus.panel-open";

    return {
      initializeOpenState,
      togglePanel,
    };

    function initializeOpenState() {
      state.preferredOpen = readPanelOpenPreference();
      state.open = state.preferredOpen;
    }

    function togglePanel(nextOpen, persist = true) {
      state.open = typeof nextOpen === "boolean" ? nextOpen : !state.open;
      if (persist) {
        state.preferredOpen = state.open;
        writePanelOpenPreference(state.open);
      }
      schedulePromptCloudSyncIfNeeded(220);
      meetingManager.scheduleSync(state.open ? 220 : 0);
      schedulePromptRealtimeSync(state.open ? 220 : 0);
      if (state.open && isStoreTabActive()) {
        ensureStoreLoaded();
      }
      if (state.open) {
        releaseManager.ensureChecked(false, state.activeTool === "release");
      }
      logPanelDebug("panel.ui.toggle", {
        open: state.open,
        scope: "panel-ui",
        tool: "panel",
      });
      render();
    }

    function readPanelOpenPreference() {
      try {
        const saved = global.sessionStorage?.getItem(PANEL_OPEN_KEY);
        return saved == null ? false : saved === "true";
      } catch (error) {
        console.warn("[i-Nova Bookmarks] panel open preference read failed", error);
        return false;
      }
    }

    function writePanelOpenPreference(open) {
      try {
        global.sessionStorage?.setItem(PANEL_OPEN_KEY, String(Boolean(open)));
      } catch (error) {
        console.warn("[i-Nova Bookmarks] panel open preference write failed", error);
      }
    }
  }

  function createHostedOwnedPanelSurfaceBridge(state, deps = {}) {
    const ensureStoreLoaded = typeof deps.ensureStoreLoaded === "function"
      ? deps.ensureStoreLoaded
      : () => {};
    const isStoreTabActive = typeof deps.isStoreTabActive === "function"
      ? deps.isStoreTabActive
      : () => false;
    const logPanelDebug = typeof deps.logPanelDebug === "function"
      ? deps.logPanelDebug
      : () => {};
    const meetingManager = deps.meetingManager || { scheduleSync() {} };
    const render = typeof deps.render === "function" ? deps.render : () => {};
    const schedulePromptRealtimeSync = typeof deps.schedulePromptRealtimeSync === "function"
      ? deps.schedulePromptRealtimeSync
      : () => {};

    return {
      installSurfaceWatchers,
    };

    function installSurfaceWatchers() {
      state.surfaceSignature = getSurfaceSignature();
      if (state.surfacePollTimer) {
        global.clearInterval(state.surfacePollTimer);
      }
      state.surfacePollTimer = global.setInterval(() => {
        const nextSignature = getSurfaceSignature();
        if (nextSignature === state.surfaceSignature) {
          return;
        }
        const previousSurface = parseSurfaceSignature(state.surfaceSignature);
        const nextSurface = parseSurfaceSignature(nextSignature);
        const hadComposer = previousSurface.hasComposer;
        const hasComposer = nextSurface.hasComposer;
        state.surfaceSignature = nextSignature;
        if (!hadComposer && hasComposer && state.preferredOpen) {
          state.open = true;
        }
        if (!hadComposer && hasComposer && isStoreTabActive()) {
          ensureStoreLoaded();
        }
        meetingManager.scheduleSync(hasComposer ? 120 : 0);
        schedulePromptRealtimeSync(120);
        if (previousSurface.hasComposer !== nextSurface.hasComposer || previousSurface.hasChatLog !== nextSurface.hasChatLog) {
          logPanelDebug("panel.ui.surface.changed", {
            hadChatLog: previousSurface.hasChatLog,
            hadComposer,
            hasChatLog: nextSurface.hasChatLog,
            hasComposer,
            scope: "panel-ui",
            tool: "panel",
          });
        }
        render();
      }, 600);
    }

    function getSurfaceSignature() {
      const conversation = namespace.contentDom.getConversationState();
      return `${conversation.hasComposer}|${conversation.hasChatLog}|${conversation.articleCount}|${conversation.userCount}`;
    }

    function parseSurfaceSignature(signature) {
      const [hasComposer, hasChatLog] = String(signature || "").split("|");
      return {
        hasChatLog: hasChatLog === "true",
        hasComposer: hasComposer === "true",
      };
    }
  }

  function createBootstrapController(state, deps = {}) {
    const handlePanelMeetingAction = typeof deps.handlePanelMeetingAction === "function"
      ? deps.handlePanelMeetingAction
      : async () => {};
    const handlePanelMeetingSummarySync = typeof deps.handlePanelMeetingSummarySync === "function"
      ? deps.handlePanelMeetingSummarySync
      : async () => false;
    const handlePanelReleaseSummarySync = typeof deps.handlePanelReleaseSummarySync === "function"
      ? deps.handlePanelReleaseSummarySync
      : async () => false;
    const buildHostedPanelCallbacks = typeof deps.buildHostedPanelCallbacks === "function"
      ? deps.buildHostedPanelCallbacks
      : buildDefaultHostedPanelCallbacks;
    const isStoreTabActive = typeof deps.isStoreTabActive === "function"
      ? deps.isStoreTabActive
      : () => false;
    const meetingManager = deps.meetingManager || { handleStorageChange() {}, scheduleSync() {} };
    const shouldListenMeetingStorageChanges = typeof deps.shouldListenMeetingStorageChanges === "function"
      ? deps.shouldListenMeetingStorageChanges
      : () => true;
    const shouldPrimeMeetingSync = typeof deps.shouldPrimeMeetingSync === "function"
      ? deps.shouldPrimeMeetingSync
      : () => true;
    const panelActivityController = deps.panelActivityController || { handleVisibilityChange() {}, handleWindowFocus() {} };
    const panelBookmarkController = deps.panelBookmarkController || { copyBookmarkText() {}, jumpToBookmark() {} };
    const panelDebugController = deps.panelDebugController || { installValidationApi() {} };
    const panelLifecycleController = deps.panelLifecycleController || { initializeOpenState() {}, togglePanel() {} };
    const panelPromptController = deps.panelPromptController || {
      ensureReviewFloat() {},
      ensureStoreLoaded() {},
      handleDraftChange() {},
      handleEscape() {},
      handleImportFile() {},
      handlePromptAction() {},
      handleStorageChange() {},
      handleStoreAction() {},
      movePromptItem() {},
      scheduleCloudSyncIfNeeded() {},
      scheduleRealtimeSync() {},
      selectPromptTab() {},
    };
    const panelShellController = deps.panelShellController || {
      selectTool() {},
      submitQuery() {},
      updateHandlePosition() {},
      updateQuery() {},
    };
    const panelSurfaceController = deps.panelSurfaceController || { installSurfaceWatchers() {} };
    const providerIdentitySync = deps.providerIdentitySync || { async syncToStorage() { return false; } };
    const releaseManager = deps.releaseManager || { ensureChecked() {}, handleAction() {}, handleStorageChange() {} };
    const render = typeof deps.render === "function" ? deps.render : () => {};
    const routeStateController = deps.routeStateController || { handleStorageChange() { return false; } };
    const routeSync = deps.routeSync || { scheduleRefresh() {}, syncRouteState: async () => {} };
    const routeWatchController = deps.routeWatchController || { installRouteWatchers() {} };

    return {
      bootstrap,
      handleRouteStorageChange,
    };

    async function bootstrap() {
      panelLifecycleController.initializeOpenState();
      void providerIdentitySync.syncToStorage("bootstrap");
      namespace.contentPanel.ensurePanel(buildHostedPanelCallbacks({
        handlePanelMeetingAction,
        handlePanelMeetingSummarySync,
        handlePanelReleaseSummarySync,
        panelBookmarkController,
        panelLifecycleController,
        panelPromptController,
        panelShellController,
        releaseManager,
      }));
      panelDebugController.installValidationApi();
      panelPromptController.ensureReviewFloat();
      routeWatchController.installRouteWatchers();
      panelSurfaceController.installSurfaceWatchers();
      global.addEventListener("resize", render, { passive: true });
      global.addEventListener("focus", panelActivityController.handleWindowFocus, { passive: true });
      global.document.addEventListener("visibilitychange", panelActivityController.handleVisibilityChange, { passive: true });
      global.chrome?.storage?.onChanged?.addListener(handleRouteStorageChange);
      global.chrome?.storage?.onChanged?.addListener(panelPromptController.handleStorageChange);
      if (shouldListenMeetingStorageChanges()) {
        global.chrome?.storage?.onChanged?.addListener(meetingManager.handleStorageChange);
      }
      global.chrome?.storage?.onChanged?.addListener(releaseManager.handleStorageChange);
      await routeSync.syncRouteState(true);
      if (shouldPrimeMeetingSync()) {
        meetingManager.scheduleSync(260);
      }
      panelPromptController.scheduleRealtimeSync(260);
      panelPromptController.scheduleCloudSyncIfNeeded(260);
      if (isStoreTabActive()) {
        panelPromptController.ensureStoreLoaded();
      }
      if (state.open || state.activeTool === "release") {
        releaseManager.ensureChecked(false, state.activeTool === "release");
      }
      [450, 1200].forEach((delay) => global.setTimeout(() => {
        if (shouldPrimeRouteRefresh()) {
          routeSync.scheduleRefresh();
        }
      }, delay));
    }

    function handleRouteStorageChange(changes, areaName) {
      if (routeStateController.handleStorageChange(changes, areaName)) {
        routeSync.scheduleRefresh();
      }
    }

    function shouldPrimeRouteRefresh() {
      return Boolean(
        state.awaitingRouteMessages
        || state.lastError
        || !Array.isArray(state.bookmarks)
        || !state.bookmarks.length
      );
    }
  }

  function buildDefaultHostedPanelCallbacks(deps = {}) {
    const handlePanelMeetingAction = typeof deps.handlePanelMeetingAction === "function"
      ? deps.handlePanelMeetingAction
      : async () => {};
    const handlePanelMeetingSummarySync = typeof deps.handlePanelMeetingSummarySync === "function"
      ? deps.handlePanelMeetingSummarySync
      : async () => false;
    const handlePanelReleaseSummarySync = typeof deps.handlePanelReleaseSummarySync === "function"
      ? deps.handlePanelReleaseSummarySync
      : async () => false;
    const panelBookmarkController = deps.panelBookmarkController || { copyBookmarkText() {}, jumpToBookmark() {} };
    const panelLifecycleController = deps.panelLifecycleController || { togglePanel() {} };
    const panelPromptController = deps.panelPromptController || {
      handleDraftChange() {},
      handleEscape() {},
      handleImportFile() {},
      handlePromptAction() {},
      handleStoreAction() {},
      movePromptItem() {},
      selectPromptTab() {},
    };
    const panelShellController = deps.panelShellController || {
      selectTool() {},
      submitQuery() {},
      updateHandlePosition() {},
      updateQuery() {},
    };
    const releaseManager = deps.releaseManager || { handleAction() {} };

    return {
      onCopyBookmark: panelBookmarkController.copyBookmarkText,
      onHandlePositionChange: panelShellController.updateHandlePosition,
      onImportFile: panelPromptController.handleImportFile,
      onJumpBookmark: panelBookmarkController.jumpToBookmark,
      onMeetingAction: handlePanelMeetingAction,
      onMeetingSummarySync: handlePanelMeetingSummarySync,
      onReleaseSummarySync: handlePanelReleaseSummarySync,
      onMovePrompt: panelPromptController.movePromptItem,
      onPromptAction: panelPromptController.handlePromptAction,
      onPromptDraftChange: panelPromptController.handleDraftChange,
      onSelectPromptTab: panelPromptController.selectPromptTab,
      onReleaseAction: releaseManager.handleAction,
      onSearch: panelShellController.updateQuery,
      onSearchSubmit: panelShellController.submitQuery,
      onSelectTool: panelShellController.selectTool,
      onStoreAction: panelPromptController.handleStoreAction,
      onEscape: panelPromptController.handleEscape,
      onToggle: panelLifecycleController.togglePanel,
    };
  }

  function createRenderController(state, deps = {}) {
    const isPaused = typeof deps.isPaused === "function" ? deps.isPaused : () => false;
    const isToolSurface = typeof deps.isToolSurface === "function" ? deps.isToolSurface : () => false;
    const panelBookmarkController = deps.panelBookmarkController || { buildToolState() { return { count: 0 }; } };
    const panelDebugController = deps.panelDebugController || {
      syncEnabled() {},
    };
    const panelMeetingController = deps.panelMeetingController || { buildToolState() { return { count: 0 }; } };
    const buildMeetingSnapshot = typeof deps.buildMeetingSnapshot === "function"
      ? deps.buildMeetingSnapshot
      : (meetingHub) => panelMeetingController.buildToolState(meetingHub);
    const getMeetingCount = typeof deps.getMeetingCount === "function"
      ? deps.getMeetingCount
      : (meetingTool) => Number(meetingTool?.count) || (Array.isArray(meetingTool?.items) ? meetingTool.items.length : 0);
    const buildConversationSnapshot = typeof deps.buildConversationSnapshot === "function"
      ? deps.buildConversationSnapshot
      : () => panelBookmarkController.buildToolState();
    const getConversationCount = typeof deps.getConversationCount === "function"
      ? deps.getConversationCount
      : (bookmarkTool) => Number(bookmarkTool?.count) || (Array.isArray(bookmarkTool?.items) ? bookmarkTool.items.length : 0);
    const panelPromptController = deps.panelPromptController || {
      buildReviewFloatState() { return { visible: false }; },
      buildToolState() { return { promptCount: 0, promptTool: {}, promptToolCount: 0 }; },
    };
    const buildPromptSnapshot = typeof deps.buildPromptSnapshot === "function"
      ? deps.buildPromptSnapshot
      : (promptToolState) => promptToolState?.promptTool || {};
    const getPromptCounts = typeof deps.getPromptCounts === "function"
      ? deps.getPromptCounts
      : (promptToolState) => ({
        promptCount: Number(promptToolState?.promptCount) || 0,
        promptToolCount: Number(promptToolState?.promptToolCount) || 0,
      });
    const panelShellController = deps.panelShellController || {
      buildHandleCount() { return 0; },
    };
    const releaseManager = deps.releaseManager || { buildViewState() { return { updateAvailable: false }; } };
    const buildReleaseSnapshot = typeof deps.buildReleaseSnapshot === "function"
      ? deps.buildReleaseSnapshot
      : () => releaseManager.buildViewState();
    const getReleaseCount = typeof deps.getReleaseCount === "function"
      ? deps.getReleaseCount
      : (releaseState) => (releaseState?.updateAvailable ? 1 : Number(releaseState?.count) || 0);

    return {
      render,
    };

    function render() {
      panelDebugController.syncEnabled();
      if (!state.settingsHydrated) {
        namespace.composerReviewFloat?.render?.(panelPromptController.buildReviewFloatState(false));
        return;
      }
      const visible = state.settings.enabled && isToolSurface() && !isPaused();
      const bookmarkTool = normalizeConversationSnapshot(buildConversationSnapshot());
      const conversationCount = normalizeCount(
        getConversationCount(bookmarkTool),
        Number(bookmarkTool.count) || (Array.isArray(bookmarkTool.items) ? bookmarkTool.items.length : 0)
      );
      const promptToolState = panelPromptController.buildToolState();
      const promptSnapshot = normalizePromptSnapshot(buildPromptSnapshot(promptToolState));
      const promptCounts = normalizePromptCounts(getPromptCounts(promptToolState), promptToolState);
      const meetingTool = normalizeMeetingSnapshot(buildMeetingSnapshot(state.meetingSummary));
      const meetingCount = normalizeCount(
        getMeetingCount(meetingTool),
        Number(meetingTool.count) || (Array.isArray(meetingTool.items) ? meetingTool.items.length : 0)
      );
      const releaseState = normalizeReleaseSnapshot(buildReleaseSnapshot());
      const releaseCount = normalizeCount(
        getReleaseCount(releaseState),
        releaseState.updateAvailable ? 1 : Number(releaseState.count) || 0
      );
      const handleCount = panelShellController.buildHandleCount({
        bookmarks: conversationCount,
        meeting: meetingCount,
        promptTool: promptCounts.promptToolCount,
        prompts: promptCounts.promptCount,
        release: releaseCount,
      });

      namespace.contentPanel.renderPanel({
        activeTool: state.activeTool,
        bookmarksTool: bookmarkTool,
        handleCount,
        meetingTool,
        releaseTool: releaseState,
        handleRatio: namespace.storage.getHandleRatio(state.uiPreferences, global.innerWidth),
        open: state.open,
        promptTool: promptSnapshot,
        settings: state.settings,
        settingsHydrated: Boolean(state.settingsHydrated),
        visible,
      });
      namespace.composerReviewFloat?.render?.(panelPromptController.buildReviewFloatState(visible));
    }

    function normalizeCount(value, fallback = 0) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    }

    function normalizeReleaseSnapshot(value) {
      return value && typeof value === "object" ? value : {};
    }

    function normalizeConversationSnapshot(value) {
      return value && typeof value === "object" ? value : {};
    }

    function normalizePromptSnapshot(value) {
      return value && typeof value === "object" ? value : {};
    }

    function normalizeMeetingSnapshot(value) {
      return value && typeof value === "object" ? value : {};
    }

    function normalizePromptCounts(value, fallbackPromptToolState = {}) {
      const promptCounts = value && typeof value === "object" ? value : {};
      return {
        promptCount: normalizeCount(
          promptCounts.promptCount,
          Number(fallbackPromptToolState.promptCount) || 0
        ),
        promptToolCount: normalizeCount(
          promptCounts.promptToolCount,
          Number(fallbackPromptToolState.promptToolCount) || 0
        ),
      };
    }
  }

  namespace.panelV2ShellBridge = {
    createBootstrapController,
    createHostedOwnedPanelActivityBridge,
    createHostedOwnedPanelLifecycleBridge,
    createHostedOwnedPanelSurfaceBridge,
    createRenderController,
  };
})(globalThis);
