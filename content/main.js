(function initContentMain(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const state = {
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
      collapsed: namespace.panelDebugController?.readCollapsedPreference?.() ?? true,
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

  const releaseManager = namespace.releaseManager.create(state, { render });
  const meetingManager = namespace.meetingManager.create(state, { render });
  const providerIdentitySync = namespace.providerIdentitySync.create(state, {
    isExtensionContextInvalidatedError,
    logPanelDebug,
    render,
  });
  const panelMeetingController = namespace.panelMeetingController.create(state, {
    meetingManager,
    providerIdentitySync,
    render,
  });
  const panelDebugController = namespace.panelDebugController.create(state, {
    isPaused,
    isToolSurface,
    render,
  });
  const panelBookmarkController = namespace.panelBookmarkController.create(state, { render });
  let panelPromptController = null;
  const panelShellController = namespace.panelShellController.create(state, {
    bookmarkController: panelBookmarkController,
    getPromptController: () => panelPromptController,
    isExtensionContextInvalidatedError,
    meetingManager,
    releaseManager,
    render,
  });
  panelPromptController = namespace.panelPromptController.create(state, {
    isPaused,
    isToolSurface,
    lockUiPreferenceSelection: panelShellController.lockUiPreferenceSelection,
    onPromptTabSelected: () => meetingManager.scheduleSync(0),
    persistActiveTool: panelShellController.persistActiveTool,
    render,
  });
  const panelLifecycleController = namespace.panelLifecycleController.create(state, {
    ensureStoreLoaded: () => panelPromptController.ensureStoreLoaded(),
    isStoreTabActive,
    logPanelDebug,
    meetingManager,
    providerIdentitySync,
    releaseManager,
    render,
    schedulePromptCloudSyncIfNeeded: (delay) => panelPromptController.scheduleCloudSyncIfNeeded(delay),
    schedulePromptRealtimeSync: (delay) => panelPromptController.scheduleRealtimeSync(delay),
  });
  const routeSync = namespace.routeSync.create(state, {
    ensureStoreLoaded: () => panelPromptController.ensureStoreLoaded(),
    normalizeToolId: panelShellController.normalizeToolId,
    onRouteStateChanged: meetingManager.handleRouteStateChange,
    render,
  });

  bootstrapContent().catch((error) => console.error("[i-Nova Bookmarks] bootstrap failed", error));

  async function bootstrapContent() {
    panelLifecycleController.initializeOpenState();
    void providerIdentitySync.syncToStorage("bootstrap");
    namespace.contentPanel.ensurePanel({
      onCopyBookmark: panelBookmarkController.copyBookmarkText,
      onHandlePositionChange: panelShellController.updateHandlePosition,
      onImportFile: panelPromptController.handleImportFile,
      onJumpBookmark: panelBookmarkController.jumpToBookmark,
      onMeetingAction: handlePanelMeetingAction,
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
    });
    panelDebugController.installValidationApi();
    panelPromptController.ensureReviewFloat();
    routeSync.installRouteWatchers();
    panelLifecycleController.installSurfaceWatchers();
    global.addEventListener("resize", render, { passive: true });
    global.addEventListener("focus", panelLifecycleController.handleWindowFocus, { passive: true });
    document.addEventListener("visibilitychange", panelLifecycleController.handleVisibilityChange, { passive: true });
    chrome.storage.onChanged?.addListener(routeSync.handleStorageChange);
    chrome.storage.onChanged?.addListener(panelPromptController.handleStorageChange);
    chrome.storage.onChanged?.addListener(meetingManager.handleStorageChange);
    chrome.storage.onChanged?.addListener(releaseManager.handleStorageChange);
    namespace.panelDebug?.subscribe?.(() => {
      render();
    });
    await routeSync.syncRouteState(true);
    meetingManager.scheduleSync(260);
    panelPromptController.scheduleRealtimeSync(260);
    panelPromptController.scheduleCloudSyncIfNeeded(1800);
    if (isStoreTabActive()) {
      panelPromptController.ensureStoreLoaded();
    }
    if (state.open || state.activeTool === "release") {
      releaseManager.ensureChecked(false, state.activeTool === "release");
    }
    [450, 1200].forEach((delay) => global.setTimeout(routeSync.scheduleRefresh, delay));
  }

  function render() {
    panelDebugController.syncEnabled();
    const visible = state.settings.enabled && isToolSurface() && !isPaused();
    const bookmarkTool = panelBookmarkController.buildToolState();
    const promptToolState = panelPromptController.buildToolState();
    const meetingTool = panelMeetingController.buildToolState(state.meetingHub);
    const panelDebug = panelDebugController.buildState();
    const releaseState = releaseManager.buildViewState();
    const releaseCount = releaseState.updateAvailable ? 1 : 0;
    const shellChrome = panelShellController.buildRenderChrome({
      bookmarks: bookmarkTool.count,
      meeting: meetingTool.count,
      promptTool: promptToolState.promptToolCount,
      prompts: promptToolState.promptCount,
      release: releaseCount,
    });

    namespace.contentPanel.renderPanel({
      activeTool: state.activeTool,
      bookmarksTool: bookmarkTool,
      handleCount: shellChrome.handleCount,
      meetingTool,
      releaseTool: releaseState,
      handleRatio: namespace.storage.getHandleRatio(state.uiPreferences, global.innerWidth),
      open: state.open,
      panelDebug,
      promptTool: promptToolState.promptTool,
      toolCount: shellChrome.toolCount,
      toolTitle: shellChrome.toolTitle,
      tools: shellChrome.tools,
      visible,
    });
    namespace.composerReviewFloat?.render?.(panelPromptController.buildReviewFloatState(visible));
  }

  async function handlePanelMeetingAction(action, detail = {}) {
    if (panelDebugController.handlesAction(action)) {
      await panelDebugController.handleAction(action);
      return;
    }
    await panelMeetingController.handleAction(action, detail);
  }

  function isPaused() {
    return Boolean(state.sessionId && state.pausedSessions[state.sessionId]);
  }

  function isStoreTabActive() {
    return state.activeTool === "prompts"
      && (state.uiPreferences.activeTool === "store" || state.uiPreferences.activePromptTab === "store");
  }

  function isToolSurface() {
    return namespace.contentDom.getConversationState().hasComposer;
  }

  function isExtensionContextInvalidatedError(error) {
    const message = namespace.session.normalizeText(error instanceof Error ? error.message : String(error || "")).toLowerCase();
    return message.includes("extension context invalidated");
  }

  function logPanelDebug(event, payload) {
    namespace.panelDebug?.log?.(event, payload || {});
  }
})(globalThis);
