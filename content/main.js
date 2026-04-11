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
  const panelPromptController = namespace.panelPromptController.create(state, {
    isPaused,
    isToolSurface,
    lockUiPreferenceSelection,
    onPromptTabSelected: () => meetingManager.scheduleSync(0),
    persistActiveTool,
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
      onImportFile: panelPromptController.handleImportFile,
      onJumpBookmark: jumpToBookmark,
      onMeetingAction: handlePanelMeetingAction,
      onMovePrompt: panelPromptController.movePromptItem,
      onPromptAction: panelPromptController.handlePromptAction,
      onPromptDraftChange: panelPromptController.handleDraftChange,
      onSelectPromptTab: panelPromptController.selectPromptTab,
      onReleaseAction: releaseManager.handleAction,
      onStoreAction: panelPromptController.handleStoreAction,
      onEscape: panelPromptController.handleEscape,
      onSearch: updateQuery,
      onSearchSubmit: submitQuery,
      onSelectTool: selectTool,
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
    const bookmarkItems = getFilteredBookmarks();
    const promptToolState = panelPromptController.buildToolState();
    const meetingTool = panelMeetingController.buildToolState(state.meetingHub);
    const panelDebug = panelDebugController.buildState();
    const releaseState = releaseManager.buildViewState();
    const bookmarkCount = state.bookmarks.length;
    const promptCount = promptToolState.promptCount;
    const meetingCount = meetingTool.count;
    const releaseCount = releaseState.updateAvailable ? 1 : 0;
    const promptToolCount = promptToolState.promptToolCount;
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
      promptTool: promptToolState.promptTool,
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
    namespace.composerReviewFloat?.render?.(panelPromptController.buildReviewFloatState(visible));
  }

  function buildBookmarkEmptyText() {
    return state.queries.bookmarks
      ? "검색 결과가 없어요. 다른 표현으로 다시 찾아보세요."
      : !state.settings.autoBookmark
          ? "팝업에서 대화 자동 모으기를 켜면 대화 탭을 사용할 수 있어요."
          : state.awaitingRouteMessages
              ? "이 대화의 흐름을 불러오는 중이에요."
              : "아직 대화가 없어요.";
  }

  function buildBookmarkStatusText() {
    return state.lastError
      ? "표시에 문제가 있어요. 새로고침 후 다시 시도해 주세요."
      : !state.settings.autoBookmark
          ? "대화 자동 모으기가 꺼져 있어요."
          : state.awaitingRouteMessages
              ? "대화를 불러오는 중"
              : !state.bookmarks.length
                  ? "아직 대화가 없어요"
                  : "";
  }

  function getFilteredBookmarks() {
    const query = namespace.session.normalizeText(state.queries.bookmarks).toLowerCase();
    return query ? state.bookmarks.filter((bookmark) => bookmark.normalizedText.includes(query)) : state.bookmarks;
  }

  function updateQuery(toolId, value, options = {}) {
    if (panelPromptController.updateQuery(toolId, value, options)) {
      return;
    }
    const queryKey = normalizeToolId(toolId);
    state.queries[queryKey] = value || "";
    render();
  }

  function submitQuery(toolId, value) {
    if (panelPromptController.submitQuery(toolId, value)) {
      return;
    }
    const queryKey = normalizeToolId(toolId);
    state.queries[queryKey] = value || "";
    render();
  }

  async function selectTool(toolId) {
    if (await panelPromptController.selectTool(toolId)) {
      return;
    }
    state.activeTool = normalizeToolId(toolId);
    const nextPromptTab = state.activeTool === "prompts"
      ? "library"
      : state.uiPreferences.activeTool === "store"
          ? "store"
          : state.uiPreferences.activePromptTab || "library";
    state.uiPreferences = namespace.storage.mergeUiPreferences(state.uiPreferences, {
      activePromptTab: nextPromptTab,
      activeTool: state.activeTool,
    });
    lockUiPreferenceSelection(state.activeTool, nextPromptTab);
    meetingManager.scheduleSync(state.activeTool === "meeting" ? 120 : 0);
    panelPromptController.scheduleRealtimeSync(120);
    if (state.activeTool === "release") {
      releaseManager.ensureChecked(false, true);
    }
    render();
    await persistActiveTool(state.activeTool, nextPromptTab);
  }

  async function persistActiveTool(nextTool = state.activeTool, nextPromptTab = state.uiPreferences.activePromptTab || "library") {
    try {
      state.uiPreferences = await namespace.storage.updateUiPreferences({
        activePromptTab: nextPromptTab || "library",
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
    if (!bookmark?.text) {
      return false;
    }
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

  function isStoreTabActive() {
    return state.activeTool === "prompts"
      && (state.uiPreferences.activeTool === "store" || state.uiPreferences.activePromptTab === "store");
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
      activePromptTab: activePromptTab || "library",
      activeTool: normalizeToolId(activeTool),
      until: Date.now() + UI_PREFERENCE_LOCK_MS,
    };
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
