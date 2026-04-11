(function initContentMain(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const UI_PREFERENCE_LOCK_MS = 1500;
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

  const promptHubState = namespace.promptHubState;
  const normalizePromptTab = (promptTabId) => promptHubState.normalizePromptTab(promptTabId);
  const getActivePromptTab = (reviewOpen = state.promptReview.open) => promptHubState.getActivePromptTab(state, reviewOpen);
  const isStoreTabActive = () => promptHubState.isStoreTabActive(state);
  const shouldRunPromptCloudSync = () => promptHubState.shouldRunPromptCloudSync(state, {
    hasPendingPromptSync: (cloudSyncState) => namespace.cloudSync.hasPendingPromptSync(cloudSyncState),
    isToolSurface,
    visibilityState: document.visibilityState,
  });

  const releaseManager = namespace.releaseManager.create(state, { render });
  const cloudSyncManager = namespace.cloudSyncManager.create(state, { render });
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
  const {
    promptHubController,
    promptManager,
    promptRealtimeManager,
    promptReviewManager,
    storeManager,
  } = namespace.promptHubRuntime.create(state, {
    cloudSyncManager,
    getActivePromptTab,
    isToolSurface,
    lockUiPreferenceSelection,
    normalizePromptTab,
    onSelectPromptTab: () => meetingManager.scheduleSync(0),
    persistActiveTool,
    render,
  });
  const panelLifecycleController = namespace.panelLifecycleController.create(state, {
    cloudSyncManager,
    isPaused,
    isStoreTabActive,
    isToolSurface,
    logPanelDebug,
    meetingManager,
    promptRealtimeManager,
    providerIdentitySync,
    releaseManager,
    render,
    shouldRunPromptCloudSync,
    storeManager,
  });
  const routeSync = namespace.routeSync.create(state, {
    ensureStoreLoaded: () => storeManager.ensureLoaded(),
    normalizeToolId,
    onRouteStateChanged: meetingManager.handleRouteStateChange,
    render,
  });

  bootstrapContent().catch((error) => console.error("[i-Nova Bookmarks] bootstrap failed", error));

  async function bootstrapContent() {
    panelLifecycleController.initializeOpenState();
    void providerIdentitySync.syncToStorage("bootstrap");
    namespace.contentPanel.ensurePanel({
      onCopyBookmark: copyBookmarkText,
      onHandlePositionChange: updateHandlePosition,
      onImportFile: promptManager.handleImportFile,
      onJumpBookmark: jumpToBookmark,
      onMeetingAction: handlePanelMeetingAction,
      onMovePrompt: promptHubController.movePromptItem,
      onPromptAction: promptHubController.handlePromptAction,
      onPromptDraftChange: promptManager.updateDraft,
      onSelectPromptTab: promptHubController.selectPromptTab,
      onReleaseAction: releaseManager.handleAction,
      onStoreAction: promptHubController.handleStoreAction,
      onEscape: promptHubController.handleEscape,
      onSearch: updateQuery,
      onSearchSubmit: submitQuery,
      onSelectTool: selectTool,
      onToggle: panelLifecycleController.togglePanel,
    });
    panelDebugController.installValidationApi();
    namespace.composerReviewFloat?.ensure?.({
      buildState: buildPromptReviewFloatState,
      onAction: promptReviewManager.handleAction,
    });
    routeSync.installRouteWatchers();
    panelLifecycleController.installSurfaceWatchers();
    global.addEventListener("resize", render, { passive: true });
    global.addEventListener("focus", panelLifecycleController.handleWindowFocus, { passive: true });
    document.addEventListener("visibilitychange", panelLifecycleController.handleVisibilityChange, { passive: true });
    chrome.storage.onChanged?.addListener(routeSync.handleStorageChange);
    chrome.storage.onChanged?.addListener(cloudSyncManager.handleStorageChange);
    chrome.storage.onChanged?.addListener(meetingManager.handleStorageChange);
    chrome.storage.onChanged?.addListener(releaseManager.handleStorageChange);
    namespace.panelDebug?.subscribe?.(() => {
      render();
    });
    await routeSync.syncRouteState(true);
    meetingManager.scheduleSync(260);
    promptRealtimeManager.scheduleSync(260);
    if (shouldRunPromptCloudSync()) {
      cloudSyncManager.scheduleSync(1800);
    }
    if (isStoreTabActive()) storeManager.ensureLoaded();
    if (state.open || state.activeTool === "release") {
      releaseManager.ensureChecked(false, state.activeTool === "release");
    }
    [450, 1200].forEach((delay) => global.setTimeout(routeSync.scheduleRefresh, delay));
  }

  function render() {
    panelDebugController.syncEnabled();
    const visible = state.settings.enabled && isToolSurface() && !isPaused();
    const bookmarkItems = getFilteredBookmarks();
    const promptItems = getFilteredPrompts();
    const promptRenderState = promptHubState.buildPromptRenderState({
      promptItems,
      promptManager,
      promptReviewManager,
      state,
      storeManager,
    });
    const meetingTool = panelMeetingController.buildToolState(state.meetingHub);
    const panelDebug = panelDebugController.buildState();
    const releaseState = releaseManager.buildViewState();
    const bookmarkCount = state.bookmarks.length;
    const promptCount = promptRenderState.promptCount;
    const meetingCount = meetingTool.count;
    const releaseCount = releaseState.updateAvailable ? 1 : 0;
    const promptToolCount = promptRenderState.promptToolCount;
    const toolCounts = {
      bookmarks: bookmarkCount,
      meeting: meetingCount,
      prompts: promptToolCount,
      release: releaseCount,
    };
    const activeToolCount = Object.prototype.hasOwnProperty.call(toolCounts, state.activeTool)
      ? toolCounts[state.activeTool]
      : 0;
    namespace.contentPanel.renderPanel({
      activeTool: state.activeTool,
      bookmarksTool: {
        activeId: state.activeId,
        emptyText: buildBookmarkEmptyText(),
        items: bookmarkItems,
        metaText: state.queries.bookmarks ? `검색 결과 ${bookmarkItems.length}개` : buildBookmarkStatusText(),
        query: state.queries.bookmarks,
      },
      handleCount: state.activeTool === "bookmarks"
        ? bookmarkCount || promptCount || meetingCount || releaseCount
        : activeToolCount,
      meetingTool,
      releaseTool: releaseState,
      handleRatio: namespace.storage.getHandleRatio(state.uiPreferences, global.innerWidth),
      open: state.open,
      panelDebug,
      promptTool: promptRenderState.promptTool,
      toolCount: activeToolCount,
      toolTitle: state.activeTool === "prompts"
        ? "프롬프트"
        : state.activeTool === "meeting"
            ? "회의 룸"
            : state.activeTool === "release"
                ? "릴리스 안내"
                : "대화 탐색",
      tools: [
        { id: "bookmarks", label: "대화", count: bookmarkCount },
        { id: "meeting", label: "회의 룸", count: meetingCount },
        { id: "prompts", label: "프롬프트", count: promptCount },
        { id: "release", label: "릴리스", count: releaseCount },
      ],
      visible,
    });
    namespace.composerReviewFloat?.render?.(buildPromptReviewFloatState(visible));
  }

  function buildBookmarkEmptyText() { return state.queries.bookmarks ? "검색 결과가 없어요. 다른 표현으로 다시 찾아보세요." : !state.settings.autoBookmark ? "팝업에서 대화 자동 모으기를 켜면 대화 탭을 사용할 수 있어요." : state.awaitingRouteMessages ? "이 대화의 흐름을 불러오는 중이에요." : "아직 대화가 없어요."; }
  function buildBookmarkStatusText() { return state.lastError ? "표시에 문제가 있어요. 새로고침 후 다시 시도해 주세요." : !state.settings.autoBookmark ? "대화 자동 모으기가 꺼져 있어요." : state.awaitingRouteMessages ? "대화를 불러오는 중" : !state.bookmarks.length ? "아직 대화가 없어요" : ""; }
  function getFilteredBookmarks() { const query = namespace.session.normalizeText(state.queries.bookmarks).toLowerCase(); return query ? state.bookmarks.filter((bookmark) => bookmark.normalizedText.includes(query)) : state.bookmarks; }
  function getFilteredPrompts() { const query = namespace.session.normalizeText(state.queries.prompts).toLowerCase(); return query ? state.promptLibrary.items.filter((item) => `${item.title} ${item.content}`.toLowerCase().includes(query)) : state.promptLibrary.items; }

  function updateQuery(toolId, value, options = {}) {
    const queryKey = toolId === "store" ? "store" : normalizeToolId(toolId);
    state.queries[queryKey] = value || "";
    if (toolId === "store") {
      storeManager.handleQueryChange(state.queries.store, options);
      return;
    }
    render();
  }

  function submitQuery(toolId, value) {
    const queryKey = toolId === "store" ? "store" : normalizeToolId(toolId);
    state.queries[queryKey] = value || "";
    if (toolId === "store") {
      storeManager.submitQuery(state.queries.store);
      return;
    }
    render();
  }

  async function selectTool(toolId) {
    if (toolId === "store") return void promptHubController.selectPromptTab("store");
    state.activeTool = normalizeToolId(toolId);
    const nextPromptTab = state.activeTool === "prompts" ? "library" : getActivePromptTab();
    state.uiPreferences = namespace.storage.mergeUiPreferences(state.uiPreferences, {
      activePromptTab: nextPromptTab,
      activeTool: state.activeTool,
    });
    lockUiPreferenceSelection(state.activeTool, nextPromptTab);
    if (state.activeTool === "prompts" && nextPromptTab === "store") storeManager.ensureLoaded();
    meetingManager.scheduleSync(state.activeTool === "meeting" ? 120 : 0);
    promptRealtimeManager.scheduleSync(120);
    if (state.activeTool === "release") releaseManager.ensureChecked(false, true);
    render();
    await persistActiveTool(state.activeTool, nextPromptTab);
  }

  async function persistActiveTool(nextTool = state.activeTool, nextPromptTab = getActivePromptTab()) {
    try {
      state.uiPreferences = await namespace.storage.updateUiPreferences({
        activePromptTab: normalizePromptTab(nextPromptTab),
        activeTool: normalizeToolId(nextTool),
      });
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        return;
      }
      console.error("[i-Nova Bookmarks] active tool save failed", error);
    }
  }

  async function copyBookmarkText(bookmarkId) {
    const bookmark = state.bookmarks.find((entry) => entry.id === bookmarkId);
    if (!bookmark?.text) return false;
    try {
      await navigator.clipboard.writeText(bookmark.text);
      return true;
    } catch (error) {
      console.error("[i-Nova Bookmarks] copy failed", error);
      return false;
    }
  }

  async function updateHandlePosition(nextRatio) {
    const bucket = namespace.storage.getViewportBucket(global.innerWidth);
    const handleRatio = namespace.storage.normalizeHandleRatio(nextRatio, bucket);
    state.uiPreferences = namespace.storage.mergeUiPreferences(state.uiPreferences, {
      activeTool: state.activeTool,
      handleRatios: { [bucket]: handleRatio },
    });
    render();
    try {
      await namespace.storage.updateUiPreferences({
        activeTool: state.activeTool,
        handleRatios: { [bucket]: handleRatio },
      });
    } catch (error) {
      console.error("[i-Nova Bookmarks] handle position save failed", error);
    }
  }

  async function handlePanelMeetingAction(action, detail = {}) {
    if (panelDebugController.handlesAction(action)) {
      await panelDebugController.handleAction(action);
      return;
    }
    await panelMeetingController.handleAction(action, detail);
  }

  function jumpToBookmark(bookmarkId) {
    state.activeId = bookmarkId;
    namespace.contentPanel.setActiveBookmark(bookmarkId);
    namespace.contentPanel.focusBookmark(bookmarkId);
    namespace.contentDom.scrollToMessage(bookmarkId, { block: "start", behavior: "smooth" });
  }

  function isPaused() {
    return Boolean(state.sessionId && state.pausedSessions[state.sessionId]);
  }

  function normalizeToolId(toolId) {
    return toolId === "release" || toolId === "prompts" || toolId === "meeting"
      ? toolId
      : toolId === "store"
          ? "prompts"
          : "bookmarks";
  }

  function lockUiPreferenceSelection(activeTool, activePromptTab) {
    state.uiPreferenceLock = {
      activePromptTab: normalizePromptTab(activePromptTab),
      activeTool: normalizeToolId(activeTool),
      until: Date.now() + UI_PREFERENCE_LOCK_MS,
    };
  }

  function isToolSurface() { return namespace.contentDom.getConversationState().hasComposer; }

  function buildPromptReviewFloatState(visible = state.settings.enabled && isToolSurface() && !isPaused()) {
    return {
      ...promptReviewManager.buildViewState(),
      visible,
    };
  }

  function isExtensionContextInvalidatedError(error) {
    const message = namespace.session.normalizeText(error instanceof Error ? error.message : String(error || "")).toLowerCase();
    return message.includes("extension context invalidated");
  }

  function logPanelDebug(event, payload) {
    namespace.panelDebug?.log?.(event, payload || {});
  }
})(globalThis);
