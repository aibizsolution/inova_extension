(function initPromptHubState(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function normalizePromptTab(promptTabId) {
    return promptTabId === "store" || promptTabId === "review" ? promptTabId : "library";
  }

  function getActivePromptTab(state, reviewOpen = state?.promptReview?.open) {
    const tab = state?.uiPreferences?.activeTool === "store"
      ? "store"
      : normalizePromptTab(state?.uiPreferences?.activePromptTab);
    return tab === "review" && !reviewOpen ? "library" : tab;
  }

  function isStoreTabActive(state, reviewOpen = state?.promptReview?.open) {
    return state?.activeTool === "prompts" && getActivePromptTab(state, reviewOpen) === "store";
  }

  function isPromptLibraryTabActive(state, reviewOpen = state?.promptReview?.open) {
    return state?.activeTool === "prompts" && getActivePromptTab(state, reviewOpen) === "library";
  }

  function shouldRunPromptCloudSync(state, options = {}) {
    const hasPendingPromptSync = typeof options.hasPendingPromptSync === "function"
      ? options.hasPendingPromptSync
      : () => false;
    const isToolSurface = typeof options.isToolSurface === "function"
      ? options.isToolSurface
      : () => false;
    const visibilityState = options.visibilityState || global.document?.visibilityState || "";

    return Boolean(
      hasPendingPromptSync(state?.cloudSync)
      || (
        state?.open
        && isPromptLibraryTabActive(state)
        && isToolSurface()
        && visibilityState === "visible"
      )
    );
  }

  function buildPromptTabs(reviewOpen, promptCount, storeCount) {
    return reviewOpen
      ? [
          { id: "library", label: "내 요청", count: promptCount },
          { id: "store", label: "스토어", count: storeCount },
          { id: "review", label: "검토", count: null },
        ]
      : [
          { id: "library", label: "내 요청", count: promptCount },
          { id: "store", label: "스토어", count: storeCount },
        ];
  }

  function getPromptToolCount(activePromptTab, promptCount, storeCount) {
    return activePromptTab === "store" ? storeCount : promptCount;
  }

  function buildPromptToolState(options = {}) {
    return {
      activeTab: options.activePromptTab || "library",
      prompt: options.promptState,
      review: options.reviewState,
      store: options.storeState,
      tabs: buildPromptTabs(
        Boolean(options.reviewState?.open),
        Number(options.promptCount) || 0,
        Number(options.storeCount) || 0
      ),
    };
  }

  function buildPromptRenderState(options = {}) {
    const promptItems = Array.isArray(options.promptItems) ? options.promptItems : [];
    const promptManager = options.promptManager;
    const promptReviewManager = options.promptReviewManager;
    const storeManager = options.storeManager;
    const promptCount = Math.max(0, Number(options.promptCount) || 0);
    const promptState = promptManager.buildViewState(promptItems, {
      loading: Boolean(options.promptLibraryLoading),
      totalCount: promptCount,
    });
    const reviewState = promptReviewManager.buildViewState();
    const activePromptTab = getActivePromptTab(options.state, reviewState.open);
    const storeState = storeManager.buildViewState();
    const storeItems = Array.isArray(options.state?.store?.items) ? options.state.store.items : [];
    const storeCount = Math.max(0, Number(options.state?.store?.totalCount) || storeItems.length);

    return {
      activePromptTab,
      promptCount,
      promptState,
      promptTool: buildPromptToolState({
        activePromptTab,
        promptCount,
        promptState,
        reviewState,
        storeCount,
        storeState,
      }),
      promptToolCount: getPromptToolCount(activePromptTab, promptCount, storeCount),
      reviewState,
      storeCount,
      storeState,
    };
  }

  namespace.promptHubState = {
    buildPromptRenderState,
    buildPromptToolState,
    getActivePromptTab,
    getPromptToolCount,
    isPromptLibraryTabActive,
    isStoreTabActive,
    normalizePromptTab,
    shouldRunPromptCloudSync,
  };
})(globalThis);
