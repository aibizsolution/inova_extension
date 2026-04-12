(function initPromptHubController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, options = {}) {
    const cloudSyncManager = options.cloudSyncManager || {
      async movePromptItem() {
        return state.promptLibrary;
      },
      scheduleSync() {},
    };
    const promptManager = options.promptManager;
    const promptReviewManager = options.promptReviewManager;
    const promptRealtimeManager = options.promptRealtimeManager;
    const storeManager = options.storeManager;
    const render = options.render || (() => {});
    const persistActiveTool = options.persistActiveTool || (async () => {});
    const normalizePromptTab = options.normalizePromptTab || ((promptTabId) => promptTabId);
    const getActivePromptTab = options.getActivePromptTab || (() => "library");
    const lockUiPreferenceSelection = options.lockUiPreferenceSelection || (() => {});
    const onSelectPromptTab = options.onSelectPromptTab || (() => {});

    async function movePromptItem(dragPromptId, targetPromptId, placement) {
      if (!dragPromptId || !targetPromptId || dragPromptId === targetPromptId) return;
      try {
        state.promptLibrary = await cloudSyncManager.movePromptItem(dragPromptId, targetPromptId, placement);
        render();
      } catch (error) {
        console.error("[i-Nova Bookmarks] prompt move failed", error);
      }
    }

    function handlePromptAction(action, detail = {}) {
      if (action === "review-composer" || action === "apply-reviewed-prompt" || action === "copy-reviewed-prompt" || action === "dismiss-review") {
        return promptReviewManager.handleAction(action, detail);
      }
      return promptManager.handleAction(action, detail);
    }

    async function selectPromptTab(promptTabId) {
      const nextPromptTab = normalizePromptTab(promptTabId);
      state.activeTool = "prompts";
      state.uiPreferences = namespace.storage.mergeUiPreferences(state.uiPreferences, {
        activePromptTab: nextPromptTab,
        activeTool: "prompts",
      });
      lockUiPreferenceSelection("prompts", nextPromptTab);
      onSelectPromptTab(nextPromptTab);
      promptRealtimeManager.scheduleSync(120);
      if (nextPromptTab === "library") {
        cloudSyncManager.scheduleSync(120, !state.promptLibraryRemoteReady);
      }
      if (nextPromptTab === "store") storeManager.ensureLoaded();
      render();
      await persistActiveTool("prompts", nextPromptTab);
    }

    function showPromptTab(promptTabId) {
      const nextPromptTab = normalizePromptTab(promptTabId);
      state.open = true;
      state.activeTool = "prompts";
      state.uiPreferences = namespace.storage.mergeUiPreferences(state.uiPreferences, {
        activePromptTab: nextPromptTab,
        activeTool: "prompts",
      });
      lockUiPreferenceSelection("prompts", nextPromptTab);
      onSelectPromptTab(nextPromptTab);
      persistActiveTool("prompts", nextPromptTab).catch((error) => {
        console.error("[i-Nova Bookmarks] prompt tab save failed", error);
      });
      if (nextPromptTab === "library") {
        cloudSyncManager.scheduleSync(120, !state.promptLibraryRemoteReady);
      }
      if (nextPromptTab === "store") {
        storeManager.ensureLoaded();
      }
      render();
    }

    function handleEscape() {
      return promptReviewManager.consumeEscape()
        || (state.activeTool === "prompts" && getActivePromptTab() === "library" && promptManager.consumeEscape());
    }

    async function handleStoreAction(action, detail = {}) {
      const result = storeManager.handleAction(action, detail);
      if (shouldScheduleStoreRealtimeSync(action)) {
        promptRealtimeManager.scheduleSync(80);
      }
      return result;
    }

    async function publishPrompt(promptId, categoryId, title) {
      const result = await storeManager.publishPrompt(promptId, categoryId, title);
      promptRealtimeManager.scheduleSync(80);
      return result;
    }

    return {
      handleEscape,
      handlePromptAction,
      handleStoreAction,
      movePromptItem,
      publishPrompt,
      selectPromptTab,
      showPromptTab,
    };

    function shouldScheduleStoreRealtimeSync(action) {
      return action === "import" || action === "toggle-like" || action === "unpublish";
    }
  }

  namespace.promptHubController = { create };
})(globalThis);
