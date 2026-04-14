(function initPanelV2PromptController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, deps = {}) {
    const isPaused = typeof deps.isPaused === "function" ? deps.isPaused : () => false;
    const isToolSurface = typeof deps.isToolSurface === "function" ? deps.isToolSurface : () => false;
    const lockUiPreferenceSelection = typeof deps.lockUiPreferenceSelection === "function" ? deps.lockUiPreferenceSelection : () => {};
    const persistActiveTool = typeof deps.persistActiveTool === "function" ? deps.persistActiveTool : (async () => {});
    const render = typeof deps.render === "function" ? deps.render : () => {};

    const promptReviewManager = namespace.promptReviewManager.create(state, {
      render,
      showPromptTab,
    });

    return {
      buildReviewFloatState,
      buildToolState,
      ensureReviewFloat,
      handleEscape,
    };

    function buildToolState() {
      return {
        promptCount: 0,
        promptTool: {
          review: promptReviewManager.buildReviewSignalState(),
        },
        promptToolCount: 0,
      };
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

    function handleEscape() {
      return false;
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
      render();
      persistActiveTool("prompts", nextPromptTab).catch((error) => {
        console.error("[i-Nova Bookmarks] prompt tab save failed", error);
      });
    }

    function normalizePromptTab(promptTabId) {
      return promptTabId === "store" || promptTabId === "review" ? promptTabId : "library";
    }
  }

  namespace.panelV2PromptController = { create };
})(globalThis);
