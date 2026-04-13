(function initPanelBootstrapController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, deps = {}) {
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

  namespace.panelBootstrapController = { create };
})(globalThis);
