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

  namespace.panelV2ShellBridge = {
    createBootstrapController,
    createHostedOwnedPanelActivityBridge,
    createHostedOwnedPanelLifecycleBridge,
    createHostedOwnedPanelSurfaceBridge,
  };
})(globalThis);
