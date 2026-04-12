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
    const buildMeetingSnapshot = typeof deps.buildMeetingSnapshot === "function"
      ? deps.buildMeetingSnapshot
      : (meetingHub) => panelMeetingController.buildToolState(meetingHub);
    const getMeetingCount = typeof deps.getMeetingCount === "function"
      ? deps.getMeetingCount
      : (meetingTool) => Number(meetingTool?.count) || (Array.isArray(meetingTool?.items) ? meetingTool.items.length : 0);
    const buildConversationSnapshot = typeof deps.buildConversationSnapshot === "function"
      ? deps.buildConversationSnapshot
      : () => panelBookmarkController.buildToolState();
    const getConversationCount = typeof deps.getConversationCount === "function"
      ? deps.getConversationCount
      : (bookmarkTool) => Number(bookmarkTool?.count) || (Array.isArray(bookmarkTool?.items) ? bookmarkTool.items.length : 0);
    const panelPromptController = deps.panelPromptController || {
      buildReviewFloatState() { return { visible: false }; },
      buildToolState() { return { promptCount: 0, promptTool: {}, promptToolCount: 0 }; },
    };
    const buildPromptSnapshot = typeof deps.buildPromptSnapshot === "function"
      ? deps.buildPromptSnapshot
      : (promptToolState) => promptToolState?.promptTool || {};
    const getPromptCounts = typeof deps.getPromptCounts === "function"
      ? deps.getPromptCounts
      : (promptToolState) => ({
        promptCount: Number(promptToolState?.promptCount) || 0,
        promptToolCount: Number(promptToolState?.promptToolCount) || 0,
      });
    const panelShellController = deps.panelShellController || {
      buildHandleCount() { return 0; },
    };
    const releaseManager = deps.releaseManager || { buildViewState() { return { updateAvailable: false }; } };
    const buildReleaseSnapshot = typeof deps.buildReleaseSnapshot === "function"
      ? deps.buildReleaseSnapshot
      : () => releaseManager.buildViewState();
    const getReleaseCount = typeof deps.getReleaseCount === "function"
      ? deps.getReleaseCount
      : (releaseState) => (releaseState?.updateAvailable ? 1 : Number(releaseState?.count) || 0);

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
      const bookmarkTool = normalizeConversationSnapshot(buildConversationSnapshot());
      const conversationCount = normalizeCount(
        getConversationCount(bookmarkTool),
        Number(bookmarkTool.count) || (Array.isArray(bookmarkTool.items) ? bookmarkTool.items.length : 0)
      );
      const promptToolState = panelPromptController.buildToolState();
      const promptSnapshot = normalizePromptSnapshot(buildPromptSnapshot(promptToolState));
      const promptCounts = normalizePromptCounts(getPromptCounts(promptToolState), promptToolState);
      const meetingTool = normalizeMeetingSnapshot(buildMeetingSnapshot(state.meetingHub));
      const meetingCount = normalizeCount(
        getMeetingCount(meetingTool),
        Number(meetingTool.count) || (Array.isArray(meetingTool.items) ? meetingTool.items.length : 0)
      );
      const releaseState = normalizeReleaseSnapshot(buildReleaseSnapshot());
      const releaseCount = normalizeCount(
        getReleaseCount(releaseState),
        releaseState.updateAvailable ? 1 : Number(releaseState.count) || 0
      );
      const handleCount = panelShellController.buildHandleCount({
        bookmarks: conversationCount,
        meeting: meetingCount,
        promptTool: promptCounts.promptToolCount,
        prompts: promptCounts.promptCount,
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
        promptTool: promptSnapshot,
        settings: state.settings,
        settingsHydrated: Boolean(state.settingsHydrated),
        visible,
      });
      namespace.composerReviewFloat?.render?.(panelPromptController.buildReviewFloatState(visible));
    }

    function normalizeCount(value, fallback = 0) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    }

    function normalizeReleaseSnapshot(value) {
      return value && typeof value === "object" ? value : {};
    }

    function normalizeConversationSnapshot(value) {
      return value && typeof value === "object" ? value : {};
    }

    function normalizePromptSnapshot(value) {
      return value && typeof value === "object" ? value : {};
    }

    function normalizeMeetingSnapshot(value) {
      return value && typeof value === "object" ? value : {};
    }

    function normalizePromptCounts(value, fallbackPromptToolState = {}) {
      const promptCounts = value && typeof value === "object" ? value : {};
      return {
        promptCount: normalizeCount(
          promptCounts.promptCount,
          Number(fallbackPromptToolState.promptCount) || 0
        ),
        promptToolCount: normalizeCount(
          promptCounts.promptToolCount,
          Number(fallbackPromptToolState.promptToolCount) || 0
        ),
      };
    }
  }

  namespace.panelRenderController = { create };
})(globalThis);
