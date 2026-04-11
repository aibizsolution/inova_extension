(function initPanelPromptController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, deps = {}) {
    const isPaused = typeof deps.isPaused === "function" ? deps.isPaused : () => false;
    const isToolSurface = typeof deps.isToolSurface === "function" ? deps.isToolSurface : () => false;
    const lockUiPreferenceSelection = typeof deps.lockUiPreferenceSelection === "function" ? deps.lockUiPreferenceSelection : () => {};
    const onPromptTabSelected = typeof deps.onPromptTabSelected === "function" ? deps.onPromptTabSelected : () => {};
    const persistActiveTool = typeof deps.persistActiveTool === "function" ? deps.persistActiveTool : (async () => {});
    const render = typeof deps.render === "function" ? deps.render : () => {};

    const promptHubState = namespace.promptHubState;
    const normalizePromptTab = (promptTabId) => promptHubState.normalizePromptTab(promptTabId);
    const getActivePromptTab = (reviewOpen = state.promptReview.open) => promptHubState.getActivePromptTab(state, reviewOpen);

    const cloudSyncManager = namespace.cloudSyncManager.create(state, { render });
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
      onPromptTabSelected,
      persistActiveTool,
      render,
    });

    function buildToolState() {
      const promptItems = getFilteredPrompts();
      return promptHubState.buildPromptRenderState({
        promptItems,
        promptManager,
        promptReviewManager,
        state,
        storeManager,
      });
    }

    function buildReviewFloatState(visible = state.settings.enabled && isToolSurface() && !isPaused()) {
      return {
        ...promptReviewManager.buildViewState(),
        visible,
      };
    }

    function ensureReviewFloat() {
      namespace.composerReviewFloat?.ensure?.({
        buildState: buildReviewFloatState,
        onAction: promptReviewManager.handleAction,
      });
    }

    function handlePromptAction(action, detail = {}) {
      return promptHubController.handlePromptAction(action, detail);
    }

    function handleStoreAction(action, detail = {}) {
      return promptHubController.handleStoreAction(action, detail);
    }

    function handleDraftChange(field, value) {
      return promptManager.updateDraft(field, value);
    }

    function handleImportFile(file) {
      return promptManager.handleImportFile(file);
    }

    function movePromptItem(dragPromptId, targetPromptId, placement) {
      return promptHubController.movePromptItem(dragPromptId, targetPromptId, placement);
    }

    function selectPromptTab(promptTabId) {
      return promptHubController.selectPromptTab(promptTabId);
    }

    async function selectTool(toolId) {
      if (toolId === "store") {
        await promptHubController.selectPromptTab("store");
        return true;
      }
      if (toolId === "prompts") {
        await promptHubController.selectPromptTab("library");
        return true;
      }
      return false;
    }

    function updateQuery(toolId, value, options = {}) {
      if (toolId === "store") {
        state.queries.store = value || "";
        storeManager.handleQueryChange(state.queries.store, options);
        return true;
      }
      if (toolId === "prompts") {
        state.queries.prompts = value || "";
        render();
        return true;
      }
      return false;
    }

    function submitQuery(toolId, value) {
      if (toolId === "store") {
        state.queries.store = value || "";
        storeManager.submitQuery(state.queries.store);
        return true;
      }
      if (toolId === "prompts") {
        state.queries.prompts = value || "";
        render();
        return true;
      }
      return false;
    }

    function handleEscape() {
      return promptHubController.handleEscape();
    }

    function ensureStoreLoaded(...args) {
      return storeManager.ensureLoaded(...args);
    }

    function scheduleRealtimeSync(delay) {
      promptRealtimeManager.scheduleSync(delay);
    }

    function scheduleCloudSyncIfNeeded(delay) {
      if (shouldRunPromptCloudSync()) {
        cloudSyncManager.scheduleSync(delay);
      }
    }

    function handleStorageChange(changes, areaName) {
      cloudSyncManager.handleStorageChange(changes, areaName);
    }

    return {
      buildReviewFloatState,
      buildToolState,
      ensureReviewFloat,
      ensureStoreLoaded,
      handleDraftChange,
      handleEscape,
      handleImportFile,
      handlePromptAction,
      handleStorageChange,
      handleStoreAction,
      movePromptItem,
      scheduleCloudSyncIfNeeded,
      scheduleRealtimeSync,
      selectPromptTab,
      selectTool,
      submitQuery,
      updateQuery,
    };

    function getFilteredPrompts() {
      const query = namespace.session.normalizeText(state.queries.prompts).toLowerCase();
      if (!query) {
        return state.promptLibrary.items;
      }
      return state.promptLibrary.items.filter((item) => `${item.title} ${item.content}`.toLowerCase().includes(query));
    }

    function shouldRunPromptCloudSync() {
      return promptHubState.shouldRunPromptCloudSync(state, {
        hasPendingPromptSync: (cloudSyncState) => namespace.cloudSync.hasPendingPromptSync(cloudSyncState),
        isToolSurface,
        visibilityState: global.document.visibilityState,
      });
    }
  }

  namespace.panelPromptController = { create };
})(globalThis);
