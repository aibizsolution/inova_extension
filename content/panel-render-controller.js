(function initPanelRenderController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, deps = {}) {
    const isPaused = typeof deps.isPaused === "function" ? deps.isPaused : () => false;
    const isToolSurface = typeof deps.isToolSurface === "function" ? deps.isToolSurface : () => false;
    const panelBookmarkController = deps.panelBookmarkController || { buildToolState() { return { count: 0 }; } };
    const panelDebugController = deps.panelDebugController || {
      syncEnabled() {},
    };
    const panelMeetingController = deps.panelMeetingController || { buildToolState() { return { count: 0 }; } };
    const panelPromptController = deps.panelPromptController || {
      buildReviewFloatState() { return { visible: false }; },
      buildToolState() { return { promptCount: 0, promptTool: {}, promptToolCount: 0 }; },
    };
    const panelShellController = deps.panelShellController || {
      buildHandleCount() { return 0; },
    };
    const releaseManager = deps.releaseManager || { buildViewState() { return { updateAvailable: false }; } };

    return {
      render,
    };

    function render() {
      panelDebugController.syncEnabled();
      if (!state.settingsHydrated) {
        namespace.composerReviewFloat?.render?.(panelPromptController.buildReviewFloatState(false));
        return;
      }
      const visible = state.settings.enabled && isToolSurface() && !isPaused();
      const bookmarkTool = panelBookmarkController.buildToolState();
      const promptToolState = panelPromptController.buildToolState();
      const meetingTool = panelMeetingController.buildToolState(state.meetingHub);
      const releaseState = releaseManager.buildViewState();
      const releaseCount = releaseState.updateAvailable ? 1 : 0;
      const handleCount = panelShellController.buildHandleCount({
        bookmarks: bookmarkTool.count,
        meeting: meetingTool.count,
        promptTool: promptToolState.promptToolCount,
        prompts: promptToolState.promptCount,
        release: releaseCount,
      });

      namespace.contentPanel.renderPanel({
        activeTool: state.activeTool,
        bookmarksTool: bookmarkTool,
        handleCount,
        meetingTool,
        releaseTool: releaseState,
        handleRatio: namespace.storage.getHandleRatio(state.uiPreferences, global.innerWidth),
        open: state.open,
        promptTool: promptToolState.promptTool,
        settings: state.settings,
        settingsHydrated: Boolean(state.settingsHydrated),
        visible,
      });
      namespace.composerReviewFloat?.render?.(panelPromptController.buildReviewFloatState(visible));
    }
  }

  namespace.panelRenderController = { create };
})(globalThis);
