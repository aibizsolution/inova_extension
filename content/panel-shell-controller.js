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

    function buildRenderChrome(counts = {}) {
      const bookmarkCount = normalizeCount(counts.bookmarks);
      const promptCount = normalizeCount(counts.prompts);
      const promptToolCount = normalizeCount(counts.promptTool, promptCount);
      const meetingCount = normalizeCount(counts.meeting);
      const releaseCount = normalizeCount(counts.release);
      const toolCounts = {
        bookmarks: bookmarkCount,
        meeting: meetingCount,
        prompts: promptToolCount,
        release: releaseCount,
      };
      const toolCount = Object.prototype.hasOwnProperty.call(toolCounts, state.activeTool)
        ? toolCounts[state.activeTool]
        : 0;

      return {
        handleCount: state.activeTool === "bookmarks"
          ? bookmarkCount || promptCount || meetingCount || releaseCount
          : toolCount,
        toolCount,
        toolTitle: state.activeTool === "prompts"
          ? "프롬프트"
          : state.activeTool === "meeting"
              ? "회의 룸"
              : state.activeTool === "release"
                  ? "릴리스 안내"
                  : "대화 탐색",
        tools: [
          { count: bookmarkCount, id: "bookmarks", label: "대화" },
          { count: meetingCount, id: "meeting", label: "회의 룸" },
          { count: promptCount, id: "prompts", label: "프롬프트" },
          { count: releaseCount, id: "release", label: "릴리스" },
        ],
      };
    }

    function lockUiPreferenceSelection(activeTool, activePromptTab) {
      state.uiPreferenceLock = {
        activePromptTab: normalizePromptTab(activePromptTab),
        activeTool: normalizeToolId(activeTool),
        until: Date.now() + UI_PREFERENCE_LOCK_MS,
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
      buildRenderChrome,
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
