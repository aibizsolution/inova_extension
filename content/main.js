(function initContentMain(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const PANEL_OPEN_KEY = "inova-plus.panel-open";
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
    feedbackTimer: 0,
    bookmarks: [],
    store: {
      categoryId: "all",
      error: "",
      expandedEntryId: "",
      feedback: null,
      feedbackTimer: 0,
      actionPending: null,
      deleteConfirmEntryId: "",
      identityPending: false,
      items: [],
      loaded: false,
      loading: false,
      scope: "all",
      sortBy: "latest",
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
    lastError: "",
  };
  const promptManager = namespace.promptManager.create(state, {
    publishPrompt,
    persistActiveTool,
    render,
  });
  const storeManager = namespace.storeManager.create(state, {
    render,
  });
  const cloudSyncManager = namespace.cloudSyncManager.create(state, {
    render,
  });
  const routeSync = namespace.routeSync.create(state, {
    ensureStoreLoaded: () => storeManager.ensureLoaded(),
    normalizeToolId,
    render,
  });

  bootstrapContent().catch((error) => console.error("[i-Nova Bookmarks] bootstrap failed", error));

  async function bootstrapContent() {
    state.preferredOpen = readPanelOpenPreference();
    state.open = state.preferredOpen;
    namespace.contentPanel.ensurePanel({
      onCopyBookmark: copyBookmarkText,
      onHandlePositionChange: updateHandlePosition,
      onImportFile: promptManager.handleImportFile,
      onJumpBookmark: jumpToBookmark,
      onMovePrompt: movePromptItem,
      onPromptAction: promptManager.handleAction,
      onPromptDraftChange: promptManager.updateDraft,
      onStoreAction: storeManager.handleAction,
      onEscape: handleEscape,
      onSearch: updateQuery,
      onSelectTool: selectTool,
      onToggle: togglePanel,
    });
    routeSync.installRouteWatchers();
    installSurfaceWatchers();
    global.addEventListener("resize", render, { passive: true });
    global.addEventListener("focus", handleWindowFocus, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange, { passive: true });
    chrome.storage.onChanged?.addListener(routeSync.handleStorageChange);
    chrome.storage.onChanged?.addListener(cloudSyncManager.handleStorageChange);
    await routeSync.syncRouteState(true);
    cloudSyncManager.scheduleSync(1800);
    if (state.activeTool === "store") storeManager.ensureLoaded();
    [450, 1200].forEach((delay) => global.setTimeout(routeSync.scheduleRefresh, delay));
  }

  function render() {
    const visible = state.settings.enabled && isToolSurface() && !isPaused();
    const bookmarkItems = getFilteredBookmarks();
    const promptItems = getFilteredPrompts();
    const storeState = storeManager.buildViewState();
    const bookmarkCount = state.bookmarks.length;
    const promptCount = state.promptLibrary.items.length;
    const storeCount = state.store.items.length;

    namespace.contentPanel.renderPanel({
      activeTool: state.activeTool,
      bookmarksTool: {
        activeId: state.activeId,
        emptyText: buildBookmarkEmptyText(),
        items: bookmarkItems,
        metaText: state.queries.bookmarks ? `검색 결과 ${bookmarkItems.length}개` : buildBookmarkStatusText(),
        query: state.queries.bookmarks,
      },
      handleCount: state.activeTool === "prompts" ? promptCount : state.activeTool === "store" ? storeCount : bookmarkCount || promptCount || storeCount,
      handleRatio: namespace.storage.getHandleRatio(state.uiPreferences, global.innerWidth),
      open: state.open,
      promptTool: promptManager.buildViewState(promptItems),
      storeTool: storeState,
      toolCount: state.activeTool === "prompts" ? promptCount : state.activeTool === "store" ? storeState.totalCount : bookmarkCount,
      toolTitle: state.activeTool === "prompts" ? "자주 쓰는 요청" : state.activeTool === "store" ? "프롬프트 스토어" : "질문 모아보기",
      tools: [
        { id: "bookmarks", label: "질문", count: bookmarkCount },
        { id: "prompts", label: "요청", count: promptCount },
        { id: "store", label: "스토어", count: storeCount },
      ],
      visible,
    });
  }

  function buildBookmarkEmptyText() {
    if (state.queries.bookmarks) return "검색 결과가 없어요. 다른 표현으로 다시 찾아보세요.";
    if (!state.settings.autoBookmark) return "팝업에서 질문 자동 모으기를 켜면 질문 탭을 사용할 수 있어요.";
    if (state.awaitingRouteMessages) return "이 대화의 질문을 불러오는 중이에요.";
    return "아직 질문이 없어요.";
  }

  function buildBookmarkStatusText() {
    if (state.lastError) return "표시에 문제가 있어요. 새로고침 후 다시 시도해 주세요.";
    if (!state.settings.autoBookmark) return "질문 자동 모으기가 꺼져 있어요.";
    if (state.awaitingRouteMessages) return "질문을 불러오는 중";
    if (!state.bookmarks.length) return "아직 질문이 없어요";
    return "";
  }

  function getFilteredBookmarks() {
    const query = namespace.session.normalizeText(state.queries.bookmarks).toLowerCase();
    return query ? state.bookmarks.filter((bookmark) => bookmark.normalizedText.includes(query)) : state.bookmarks;
  }

  function getFilteredPrompts() {
    const query = namespace.session.normalizeText(state.queries.prompts).toLowerCase();
    return query ? state.promptLibrary.items.filter((item) => `${item.title} ${item.content}`.toLowerCase().includes(query)) : state.promptLibrary.items;
  }

  function updateQuery(toolId, value) {
    state.queries[normalizeToolId(toolId)] = value || "";
    render();
  }

  async function selectTool(toolId) {
    state.activeTool = normalizeToolId(toolId);
    if (state.activeTool === "store") storeManager.ensureLoaded(true);
    render();
    await persistActiveTool(state.activeTool);
  }

  async function persistActiveTool(nextTool = state.activeTool) {
    try {
      state.uiPreferences = await namespace.storage.updateUiPreferences({ activeTool: normalizeToolId(nextTool) });
    } catch (error) {
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

  async function movePromptItem(dragPromptId, targetPromptId, placement) {
    if (!dragPromptId || !targetPromptId || dragPromptId === targetPromptId) return;
    try {
      state.promptLibrary = await namespace.storage.movePromptItem(dragPromptId, targetPromptId, placement);
      render();
    } catch (error) {
      console.error("[i-Nova Bookmarks] prompt move failed", error);
    }
  }

  function togglePanel(nextOpen, persist = true) {
    state.open = typeof nextOpen === "boolean" ? nextOpen : !state.open;
    if (persist) {
      state.preferredOpen = state.open;
      writePanelOpenPreference(state.open);
    }
    if (state.open) cloudSyncManager.scheduleSync(220);
    if (state.open && state.activeTool === "store") storeManager.ensureLoaded();
    render();
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

  function readPanelOpenPreference() {
    try {
      const saved = global.sessionStorage?.getItem(PANEL_OPEN_KEY);
      return saved == null ? false : saved === "true";
    } catch {
      return false;
    }
  }

  function writePanelOpenPreference(open) {
    try {
      global.sessionStorage?.setItem(PANEL_OPEN_KEY, String(Boolean(open)));
    } catch {}
  }

  function normalizeToolId(toolId) {
    if (toolId === "prompts" || toolId === "store") {
      return toolId;
    }
    return "bookmarks";
  }

  function handleEscape() {
    return promptManager.consumeEscape();
  }

  function isToolSurface() {
    const conversation = namespace.contentDom.getConversationState();
    return conversation.hasComposer;
  }

  function installSurfaceWatchers() {
    state.surfaceSignature = getSurfaceSignature();
    if (state.surfacePollTimer) global.clearInterval(state.surfacePollTimer);
    state.surfacePollTimer = global.setInterval(() => {
      const nextSignature = getSurfaceSignature();
      if (nextSignature === state.surfaceSignature) return;
      const hadComposer = state.surfaceSignature.startsWith("true|");
      const hasComposer = nextSignature.startsWith("true|");
      state.surfaceSignature = nextSignature;
      if (!hadComposer && hasComposer && state.preferredOpen) state.open = true;
      if (!hadComposer && hasComposer && state.activeTool === "store") storeManager.ensureLoaded(true);
      render();
    }, 600);
  }

  function getSurfaceSignature() {
    const conversation = namespace.contentDom.getConversationState();
    return `${conversation.hasComposer}|${conversation.hasChatLog}|${conversation.articleCount}|${conversation.userCount}`;
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== "visible") return;
    cloudSyncManager.scheduleSync(320);
    render();
  }

  function handleWindowFocus() {
    cloudSyncManager.scheduleSync(320);
    render();
  }

  async function publishPrompt(promptId, categoryId, title) { return storeManager.publishPrompt(promptId, categoryId, title); }
})(globalThis);
