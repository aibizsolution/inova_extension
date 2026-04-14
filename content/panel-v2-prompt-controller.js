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
      selectTool,
      submitQuery,
      updateQuery,
    };

    function buildToolState() {
      const reviewState = promptReviewManager.buildViewState();
      const activePromptTab = getActivePromptTab(reviewState.open);
      return {
        promptCount: 0,
        promptTool: {
          activeTab: activePromptTab,
          review: reviewState,
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
      return promptReviewManager.consumeEscape();
    }

    async function selectTool(toolId) {
      if (toolId === "store") {
        await setPromptToolState("store");
        return true;
      }
      if (toolId === "prompts") {
        await setPromptToolState("library");
        return true;
      }
      return false;
    }

    function updateQuery(toolId, value) {
      if (toolId !== "store" && toolId !== "prompts") {
        return false;
      }
      state.queries[toolId === "store" ? "store" : "prompts"] = String(value || "");
      render();
      return true;
    }

    function submitQuery(toolId, value) {
      return updateQuery(toolId, value);
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

    async function setPromptToolState(promptTabId) {
      const nextPromptTab = normalizePromptTab(promptTabId);
      state.activeTool = "prompts";
      state.uiPreferences = namespace.storage.mergeUiPreferences(state.uiPreferences, {
        activePromptTab: nextPromptTab,
        activeTool: "prompts",
      });
      lockUiPreferenceSelection("prompts", nextPromptTab);
      render();
      await persistActiveTool("prompts", nextPromptTab);
    }

    function getActivePromptTab(reviewOpen = state?.promptReview?.open) {
      const activeTool = normalizeText(state?.uiPreferences?.activeTool);
      const nextPromptTab = activeTool === "store"
        ? "store"
        : normalizePromptTab(state?.uiPreferences?.activePromptTab);
      return nextPromptTab === "review" && !reviewOpen ? "library" : nextPromptTab;
    }

    function normalizePromptTab(promptTabId) {
      return promptTabId === "store" || promptTabId === "review" ? promptTabId : "library";
    }

    function normalizeText(value) {
      return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
    }
  }

  namespace.panelV2PromptController = { create };
})(globalThis);
