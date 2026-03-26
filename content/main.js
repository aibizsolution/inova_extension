(function initContentMain(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const PANEL_OPEN_KEY = "inova-plus.panel-open";
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
    promptReview: { error: "", lastReviewedAt: "", open: false, pending: false, result: null, reviewedText: "" },
    feedbackTimer: 0,
    bookmarks: [],
    store: {
      availableCategories: [],
      categoryId: "all",
      error: "",
      expandedEntryId: "",
      feedback: null,
      feedbackTimer: 0,
      actionPending: null,
      deleteConfirmEntryId: "",
      hasMore: false,
      identityPending: false,
      items: [],
      limit: 500,
      loaded: false,
      loading: false,
      searchTimer: 0,
      scope: "all",
      sortBy: "latest",
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
  const promptManager = namespace.promptManager.create(state, { publishPrompt, persistActiveTool, render });
  const promptReviewManager = namespace.promptReviewManager.create(state, { render, showPromptTab });
  const storeManager = namespace.storeManager.create(state, { render });
  const releaseManager = namespace.releaseManager.create(state, { render });
  const cloudSyncManager = namespace.cloudSyncManager.create(state, { render });
  const routeSync = namespace.routeSync.create(state, { ensureStoreLoaded: () => storeManager.ensureLoaded(), normalizeToolId, render });
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
      onPromptAction: handlePromptAction,
      onPromptDraftChange: promptManager.updateDraft,
      onSelectPromptTab: selectPromptTab,
      onReleaseAction: releaseManager.handleAction,
      onStoreAction: storeManager.handleAction,
      onEscape: handleEscape,
      onSearch: updateQuery,
      onSelectTool: selectTool,
      onToggle: togglePanel,
    });
    namespace.composerReviewFloat?.ensure?.({
      buildState: buildPromptReviewFloatState,
      onAction: promptReviewManager.handleAction,
    });
    routeSync.installRouteWatchers();
    installSurfaceWatchers();
    global.addEventListener("resize", render, { passive: true });
    global.addEventListener("focus", handleWindowFocus, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange, { passive: true });
    chrome.storage.onChanged?.addListener(routeSync.handleStorageChange);
    chrome.storage.onChanged?.addListener(cloudSyncManager.handleStorageChange);
    chrome.storage.onChanged?.addListener(releaseManager.handleStorageChange);
    await routeSync.syncRouteState(true);
    cloudSyncManager.scheduleSync(1800, true);
    if (isStoreTabActive()) storeManager.ensureLoaded();
    if (state.open || state.activeTool === "release") releaseManager.ensureChecked(false, state.activeTool === "release");
    [450, 1200].forEach((delay) => global.setTimeout(routeSync.scheduleRefresh, delay));
  }
  function render() {
    const visible = state.settings.enabled && isToolSurface() && !isPaused();
    const bookmarkItems = getFilteredBookmarks();
    const promptItems = getFilteredPrompts();
    const promptState = promptManager.buildViewState(promptItems);
    const reviewState = promptReviewManager.buildViewState();
    const activePromptTab = getActivePromptTab(reviewState.open);
    const storeState = storeManager.buildViewState();
    const releaseState = releaseManager.buildViewState();
    const bookmarkCount = state.bookmarks.length;
    const promptCount = state.promptLibrary.items.length;
    const releaseCount = releaseState.updateAvailable ? 1 : 0;
    const storeCount = Math.max(0, Number(state.store.totalCount) || state.store.items.length);
    const promptToolCount = activePromptTab === "store" ? storeCount : promptCount;
    namespace.contentPanel.renderPanel({
      activeTool: state.activeTool,
      bookmarksTool: {
        activeId: state.activeId,
        emptyText: buildBookmarkEmptyText(),
        items: bookmarkItems,
        metaText: state.queries.bookmarks ? `검색 결과 ${bookmarkItems.length}개` : buildBookmarkStatusText(),
        query: state.queries.bookmarks,
      },
      handleCount: state.activeTool === "prompts" ? promptToolCount : state.activeTool === "release" ? releaseCount : bookmarkCount || promptCount || releaseCount,
      releaseTool: releaseState,
      handleRatio: namespace.storage.getHandleRatio(state.uiPreferences, global.innerWidth),
      open: state.open,
      promptTool: {
        activeTab: activePromptTab,
        prompt: promptState,
        review: reviewState,
        store: storeState,
        tabs: reviewState.open
          ? [{ id: "library", label: "내 요청", count: promptCount }, { id: "store", label: "스토어", count: storeCount }, { id: "review", label: "검토", count: null }]
          : [{ id: "library", label: "내 요청", count: promptCount }, { id: "store", label: "스토어", count: storeCount }],
      },
      toolCount: state.activeTool === "prompts" ? promptToolCount : state.activeTool === "release" ? releaseCount : bookmarkCount,
      toolTitle: state.activeTool === "prompts" ? "프롬프트" : state.activeTool === "release" ? "릴리스 안내" : "대화 탐색",
      tools: [
        { id: "bookmarks", label: "대화", count: bookmarkCount },
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
  function updateQuery(toolId, value) {
    const queryKey = toolId === "store" ? "store" : normalizeToolId(toolId);
    state.queries[queryKey] = value || "";
    if (toolId === "store") {
      storeManager.handleQueryChange(state.queries.store);
      return;
    }
    render();
  }
  async function selectTool(toolId) {
    if (toolId === "store") return void selectPromptTab("store");
    state.activeTool = normalizeToolId(toolId);
    state.uiPreferences = namespace.storage.mergeUiPreferences(state.uiPreferences, { activeTool: state.activeTool });
    lockUiPreferenceSelection(state.activeTool, getActivePromptTab());
    if (state.activeTool === "prompts" && getActivePromptTab() === "store") storeManager.ensureLoaded(true);
    if (state.activeTool === "release") releaseManager.ensureChecked(false, true);
    render();
    await persistActiveTool(state.activeTool);
  }
  async function selectPromptTab(promptTabId) {
    const nextPromptTab = normalizePromptTab(promptTabId);
    state.activeTool = "prompts";
    state.uiPreferences = namespace.storage.mergeUiPreferences(state.uiPreferences, { activePromptTab: nextPromptTab, activeTool: "prompts" });
    lockUiPreferenceSelection("prompts", nextPromptTab);
    if (nextPromptTab === "store") storeManager.ensureLoaded(true);
    render();
    await persistActiveTool("prompts", nextPromptTab);
  }
  async function persistActiveTool(nextTool = state.activeTool, nextPromptTab = getActivePromptTab()) {
    try {
      state.uiPreferences = await namespace.storage.updateUiPreferences({
        activePromptTab: normalizePromptTab(nextPromptTab),
        activeTool: normalizeToolId(nextTool),
      });
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
  function handlePromptAction(action, detail = {}) {
    if (action === "review-composer" || action === "apply-reviewed-prompt" || action === "dismiss-review") {
      return promptReviewManager.handleAction(action, detail);
    }
    return promptManager.handleAction(action, detail);
  }
  function togglePanel(nextOpen, persist = true) {
    state.open = typeof nextOpen === "boolean" ? nextOpen : !state.open;
    if (persist) {
      state.preferredOpen = state.open;
      writePanelOpenPreference(state.open);
    }
    if (state.open) cloudSyncManager.scheduleSync(220, true);
    if (state.open && isStoreTabActive()) storeManager.ensureLoaded();
    if (state.open) releaseManager.ensureChecked(false, state.activeTool === "release");
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
  function normalizeToolId(toolId) { return toolId === "release" || toolId === "prompts" ? toolId : toolId === "store" ? "prompts" : "bookmarks"; }
  function showPromptTab(promptTabId) {
    const nextPromptTab = normalizePromptTab(promptTabId);
    state.open = true;
    state.activeTool = "prompts";
    state.uiPreferences = namespace.storage.mergeUiPreferences(state.uiPreferences, {
      activePromptTab: nextPromptTab,
      activeTool: "prompts",
    });
    lockUiPreferenceSelection("prompts", nextPromptTab);
    persistActiveTool("prompts", nextPromptTab).catch((error) => {
      console.error("[i-Nova Bookmarks] prompt tab save failed", error);
    });
  }
  function lockUiPreferenceSelection(activeTool, activePromptTab) {
    state.uiPreferenceLock = {
      activePromptTab: normalizePromptTab(activePromptTab),
      activeTool: normalizeToolId(activeTool),
      until: Date.now() + UI_PREFERENCE_LOCK_MS,
    };
  }
  function handleEscape() { return promptReviewManager.consumeEscape() || (state.activeTool === "prompts" && getActivePromptTab() === "library" && promptManager.consumeEscape()); }
  function isToolSurface() { return namespace.contentDom.getConversationState().hasComposer; }
  function buildPromptReviewFloatState(visible = state.settings.enabled && isToolSurface() && !isPaused()) {
    return {
      ...promptReviewManager.buildViewState(),
      visible,
    };
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
      if (!hadComposer && hasComposer && isStoreTabActive()) storeManager.ensureLoaded(true);
      render();
    }, 600);
  }
  function getSurfaceSignature() {
    const conversation = namespace.contentDom.getConversationState();
    return `${conversation.hasComposer}|${conversation.hasChatLog}|${conversation.articleCount}|${conversation.userCount}`;
  }
  function handleVisibilityChange() { if (document.visibilityState !== "visible") return; cloudSyncManager.scheduleSync(320, true); if (state.open) releaseManager.ensureChecked(); render(); }
  function handleWindowFocus() { cloudSyncManager.scheduleSync(320, true); if (state.open) releaseManager.ensureChecked(); render(); }
  function getActivePromptTab(reviewOpen = state.promptReview.open) { const tab = state.uiPreferences.activeTool === "store" ? "store" : normalizePromptTab(state.uiPreferences.activePromptTab); return tab === "review" && !reviewOpen ? "library" : tab; }
  function isStoreTabActive() { return state.activeTool === "prompts" && getActivePromptTab() === "store"; }
  function normalizePromptTab(promptTabId) { return promptTabId === "store" || promptTabId === "review" ? promptTabId : "library"; }
  async function publishPrompt(promptId, categoryId, title) { return storeManager.publishPrompt(promptId, categoryId, title); }
})(globalThis);
