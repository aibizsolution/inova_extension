(function initPanelShellController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const UI_PREFERENCE_LOCK_MS = 1500;

  function create(state, deps = {}) {
    const bookmarkController = deps.bookmarkController || {
      submitQuery() { return false; },
      updateQuery() { return false; },
    };
    const getPromptController = typeof deps.getPromptController === "function" ? deps.getPromptController : () => null;
    const isExtensionContextInvalidatedError = typeof deps.isExtensionContextInvalidatedError === "function"
      ? deps.isExtensionContextInvalidatedError
      : () => false;
    const meetingManager = deps.meetingManager || { scheduleSync() {} };
    const releaseManager = deps.releaseManager || { ensureChecked() {} };
    const render = typeof deps.render === "function" ? deps.render : () => {};

    function buildHandleCount(counts = {}) {
      const bookmarkCount = normalizeCount(counts.bookmarks);
      const promptCount = normalizeCount(counts.prompts);
      const promptToolCount = normalizeCount(counts.promptTool, promptCount);
      const meetingCount = normalizeCount(counts.meeting);
      const releaseCount = normalizeCount(counts.release);
      if (state.activeTool === "bookmarks") {
        return bookmarkCount || promptCount || meetingCount || releaseCount;
      }
      if (state.activeTool === "prompts") {
        return promptToolCount;
      }
      if (state.activeTool === "meeting") {
        return meetingCount;
      }
      if (state.activeTool === "release") {
        return releaseCount;
      }
      return 0;
    }

    function lockUiPreferenceSelection(activeTool, activePromptTab) {
      state.uiPreferenceLock = {
        activePromptTab: normalizePromptTab(activePromptTab),
        activeTool: normalizeToolId(activeTool),
        until: Date.now() + UI_PREFERENCE_LOCK_MS,
      };
    }

    function applyUiPreferenceLock(uiPreferences) {
      const lock = state.uiPreferenceLock;
      if (!lock) {
        return uiPreferences;
      }
      if ((Number(lock.until) || 0) <= Date.now()) {
        state.uiPreferenceLock = null;
        return uiPreferences;
      }
      return {
        ...uiPreferences,
        activePromptTab: normalizePromptTab(lock.activePromptTab),
        activeTool: normalizeToolId(lock.activeTool || uiPreferences.activeTool),
      };
    }

    function normalizeToolId(toolId) {
      return toolId === "release" || toolId === "prompts" || toolId === "meeting"
        ? toolId
        : toolId === "store"
            ? "prompts"
            : "bookmarks";
    }

    async function persistActiveTool(nextTool = state.activeTool, nextPromptTab = state.uiPreferences.activePromptTab || "library") {
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

    async function selectTool(toolId) {
      const promptController = getPromptController();
      if (promptController && await promptController.selectTool(toolId)) {
        return true;
      }

      state.activeTool = normalizeToolId(toolId);
      const nextPromptTab = state.activeTool === "prompts"
        ? "library"
        : state.uiPreferences.activeTool === "store"
            ? "store"
            : normalizePromptTab(state.uiPreferences.activePromptTab);
      state.uiPreferences = namespace.storage.mergeUiPreferences(state.uiPreferences, {
        activePromptTab: nextPromptTab,
        activeTool: state.activeTool,
      });
      lockUiPreferenceSelection(state.activeTool, nextPromptTab);
      meetingManager.scheduleSync(state.activeTool === "meeting" ? 120 : 0);
      promptController?.scheduleRealtimeSync?.(120);
      if (state.activeTool === "release") {
        releaseManager.ensureChecked(false, true);
      }
      render();
      await persistActiveTool(state.activeTool, nextPromptTab);
      return true;
    }

    function submitQuery(toolId, value) {
      const promptController = getPromptController();
      if (promptController?.submitQuery(toolId, value)) {
        return true;
      }
      if (normalizeToolId(toolId) !== "bookmarks") {
        return false;
      }
      return bookmarkController.submitQuery(value);
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

    function updateQuery(toolId, value, options = {}) {
      const promptController = getPromptController();
      if (promptController?.updateQuery(toolId, value, options)) {
        return true;
      }
      if (normalizeToolId(toolId) !== "bookmarks") {
        return false;
      }
      return bookmarkController.updateQuery(value);
    }

    return {
      applyUiPreferenceLock,
      buildHandleCount,
      lockUiPreferenceSelection,
      normalizeToolId,
      persistActiveTool,
      selectTool,
      submitQuery,
      updateHandlePosition,
      updateQuery,
    };

    function normalizeCount(value, fallback = 0) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    }

    function normalizePromptTab(activePromptTab) {
      return activePromptTab === "store" || activePromptTab === "review" ? activePromptTab : "library";
    }
  }

  namespace.panelShellController = { create };
})(globalThis);
