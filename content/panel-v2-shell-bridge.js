(function initPanelV2ShellBridge(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function createHostedOwnedPanelActivityBridge(state, deps = {}) {
    const logPanelDebug = typeof deps.logPanelDebug === "function" ? deps.logPanelDebug : () => {};
    const providerIdentitySync = deps.providerIdentitySync || { async syncToStorage() { return false; } };
    const releaseManager = deps.releaseManager || { ensureChecked() {} };
    const render = typeof deps.render === "function" ? deps.render : () => {};

    return {
      handleVisibilityChange,
      handleWindowFocus,
    };

    function handleVisibilityChange() {
      if (global.document.visibilityState !== "visible") {
        logPanelDebug("panel.ui.visibility.hidden", {
          scope: "panel-ui",
          tool: "panel",
        });
        render();
        return;
      }
      void providerIdentitySync.syncToStorage("visibility-visible");
      if (state.open) {
        releaseManager.ensureChecked();
      }
      logPanelDebug("panel.ui.visibility.visible", {
        scope: "panel-ui",
        tool: "panel",
      });
      render();
    }

    function handleWindowFocus() {
      void providerIdentitySync.syncToStorage("window-focus");
      if (state.open) {
        releaseManager.ensureChecked();
      }
      logPanelDebug("panel.ui.focus", {
        scope: "panel-ui",
        tool: "panel",
      });
      render();
    }
  }

  function createHostedOwnedPanelLifecycleBridge(state, deps = {}) {
    const logPanelDebug = typeof deps.logPanelDebug === "function" ? deps.logPanelDebug : () => {};
    const releaseManager = deps.releaseManager || { ensureChecked() {} };
    const render = typeof deps.render === "function" ? deps.render : () => {};
    const PANEL_OPEN_KEY = "inova-plus.panel-open";

    return {
      initializeOpenState,
      togglePanel,
    };

    function initializeOpenState() {
      state.preferredOpen = readPanelOpenPreference();
      state.open = state.preferredOpen;
    }

    function togglePanel(nextOpen, persist = true) {
      state.open = typeof nextOpen === "boolean" ? nextOpen : !state.open;
      if (persist) {
        state.preferredOpen = state.open;
        writePanelOpenPreference(state.open);
      }
      if (state.open) {
        releaseManager.ensureChecked(false, state.activeTool === "release");
      }
      logPanelDebug("panel.ui.toggle", {
        open: state.open,
        scope: "panel-ui",
        tool: "panel",
      });
      render();
    }

    function readPanelOpenPreference() {
      try {
        const saved = global.sessionStorage?.getItem(PANEL_OPEN_KEY);
        return saved == null ? false : saved === "true";
      } catch (error) {
        console.warn("[i-Nova Bookmarks] panel open preference read failed", error);
        return false;
      }
    }

    function writePanelOpenPreference(open) {
      try {
        global.sessionStorage?.setItem(PANEL_OPEN_KEY, String(Boolean(open)));
      } catch (error) {
        console.warn("[i-Nova Bookmarks] panel open preference write failed", error);
      }
    }
  }

  function createHostedOwnedPanelSurfaceBridge(state, deps = {}) {
    const logPanelDebug = typeof deps.logPanelDebug === "function"
      ? deps.logPanelDebug
      : () => {};
    const render = typeof deps.render === "function" ? deps.render : () => {};

    return {
      installSurfaceWatchers,
    };

    function installSurfaceWatchers() {
      state.surfaceSignature = getSurfaceSignature();
      if (state.surfacePollTimer) {
        global.clearInterval(state.surfacePollTimer);
      }
      state.surfacePollTimer = global.setInterval(() => {
        const nextSignature = getSurfaceSignature();
        if (nextSignature === state.surfaceSignature) {
          return;
        }
        const previousSurface = parseSurfaceSignature(state.surfaceSignature);
        const nextSurface = parseSurfaceSignature(nextSignature);
        const hadComposer = previousSurface.hasComposer;
        const hasComposer = nextSurface.hasComposer;
        state.surfaceSignature = nextSignature;
        if (!hadComposer && hasComposer && state.preferredOpen) {
          state.open = true;
        }
        if (previousSurface.hasComposer !== nextSurface.hasComposer || previousSurface.hasChatLog !== nextSurface.hasChatLog) {
          logPanelDebug("panel.ui.surface.changed", {
            hadChatLog: previousSurface.hasChatLog,
            hadComposer,
            hasChatLog: nextSurface.hasChatLog,
            hasComposer,
            scope: "panel-ui",
            tool: "panel",
          });
        }
        render();
      }, 600);
    }

    function getSurfaceSignature() {
      const conversation = namespace.contentDom.getConversationState();
      return `${conversation.hasComposer}|${conversation.hasChatLog}|${conversation.articleCount}|${conversation.userCount}`;
    }

    function parseSurfaceSignature(signature) {
      const [hasComposer, hasChatLog] = String(signature || "").split("|");
      return {
        hasChatLog: hasChatLog === "true",
        hasComposer: hasComposer === "true",
      };
    }
  }

  function createBootstrapController(state, deps = {}) {
    const handlePanelToolSummarySync = typeof deps.handlePanelToolSummarySync === "function"
      ? deps.handlePanelToolSummarySync
      : async () => false;
    const buildHostedPanelCallbacks = typeof deps.buildHostedPanelCallbacks === "function"
      ? deps.buildHostedPanelCallbacks
      : buildDefaultHostedPanelCallbacks;
    const panelActivityController = deps.panelActivityController || { handleVisibilityChange() {}, handleWindowFocus() {} };
    const panelBookmarkController = deps.panelBookmarkController || { copyBookmarkText() {}, jumpToBookmark() {} };
    const panelDebugController = deps.panelDebugController || { installValidationApi() {} };
    const panelLifecycleController = deps.panelLifecycleController || { initializeOpenState() {}, togglePanel() {} };
    const panelPromptController = deps.panelPromptController || {
      ensureReviewFloat() {},
      handleEscape() {},
    };
    const panelShellController = deps.panelShellController || {
      selectTool() {},
      submitQuery() {},
      updateHandlePosition() {},
      updateQuery() {},
    };
    const panelSurfaceController = deps.panelSurfaceController || { installSurfaceWatchers() {} };
    const providerIdentitySync = deps.providerIdentitySync || { async syncToStorage() { return false; } };
    const releaseManager = deps.releaseManager || { ensureChecked() {}, handleAction() {}, handleStorageChange() {} };
    const render = typeof deps.render === "function" ? deps.render : () => {};
    const routeStateController = deps.routeStateController || { handleStorageChange() { return false; } };
    const routeSync = deps.routeSync || { scheduleRefresh() {}, syncRouteState: async () => {} };
    const routeWatchController = deps.routeWatchController || { installRouteWatchers() {} };

    return {
      bootstrap,
      handleRouteStorageChange,
    };

    async function bootstrap() {
      panelLifecycleController.initializeOpenState();
      void providerIdentitySync.syncToStorage("bootstrap");
      namespace.contentPanel.ensurePanel(buildHostedPanelCallbacks({
        handlePanelToolSummarySync,
        panelBookmarkController,
        panelLifecycleController,
        panelPromptController,
        panelShellController,
        releaseManager,
      }));
      panelDebugController.installValidationApi();
      panelPromptController.ensureReviewFloat();
      routeWatchController.installRouteWatchers();
      panelSurfaceController.installSurfaceWatchers();
      global.addEventListener("resize", render, { passive: true });
      global.addEventListener("focus", panelActivityController.handleWindowFocus, { passive: true });
      global.document.addEventListener("visibilitychange", panelActivityController.handleVisibilityChange, { passive: true });
      global.chrome?.storage?.onChanged?.addListener(handleRouteStorageChange);
      global.chrome?.storage?.onChanged?.addListener(releaseManager.handleStorageChange);
      await routeSync.syncRouteState(true);
      if (state.open || state.activeTool === "release") {
        releaseManager.ensureChecked(false, state.activeTool === "release");
      }
      [450, 1200].forEach((delay) => global.setTimeout(() => {
        if (shouldPrimeRouteRefresh()) {
          routeSync.scheduleRefresh();
        }
      }, delay));
    }

    function handleRouteStorageChange(changes, areaName) {
      if (routeStateController.handleStorageChange(changes, areaName)) {
        routeSync.scheduleRefresh();
      }
    }

    function shouldPrimeRouteRefresh() {
      return Boolean(
        state.awaitingRouteMessages
        || state.lastError
        || !Array.isArray(state.bookmarks)
        || !state.bookmarks.length
      );
    }
  }

  function buildDefaultHostedPanelCallbacks(deps = {}) {
    const handlePanelToolSummarySync = typeof deps.handlePanelToolSummarySync === "function"
      ? deps.handlePanelToolSummarySync
      : async () => false;
    const panelBookmarkController = deps.panelBookmarkController || { copyBookmarkText() {}, jumpToBookmark() {} };
    const panelLifecycleController = deps.panelLifecycleController || { togglePanel() {} };
    const panelPromptController = deps.panelPromptController || {
      handleEscape() {},
    };
    const panelShellController = deps.panelShellController || {
      selectTool() {},
      submitQuery() {},
      updateHandlePosition() {},
      updateQuery() {},
    };
    const releaseManager = deps.releaseManager || { handleAction() {} };

    return {
      onCopyBookmark: panelBookmarkController.copyBookmarkText,
      onHandlePositionChange: panelShellController.updateHandlePosition,
      onJumpBookmark: panelBookmarkController.jumpToBookmark,
      onToolSummarySync: handlePanelToolSummarySync,
      onReleaseAction: releaseManager.handleAction,
      onSearch: panelShellController.updateQuery,
      onSearchSubmit: panelShellController.submitQuery,
      onSelectTool: panelShellController.selectTool,
      onEscape: panelPromptController.handleEscape,
      onToggle: panelLifecycleController.togglePanel,
    };
  }

  function createRenderController(state, deps = {}) {
    const isPaused = typeof deps.isPaused === "function" ? deps.isPaused : () => false;
    const isToolSurface = typeof deps.isToolSurface === "function" ? deps.isToolSurface : () => false;
    const panelBookmarkController = deps.panelBookmarkController || { buildToolState() { return { count: 0 }; } };
    const panelDebugController = deps.panelDebugController || {
      syncEnabled() {},
    };
    const buildMeetingSnapshot = typeof deps.buildMeetingSnapshot === "function"
      ? deps.buildMeetingSnapshot
      : (meetingSummary) => meetingSummary && typeof meetingSummary === "object" ? meetingSummary : {};
    const getMeetingCount = typeof deps.getMeetingCount === "function"
      ? deps.getMeetingCount
      : (meetingTool) => Number(meetingTool?.count) || 0;
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
      const meetingTool = normalizeMeetingSnapshot(buildMeetingSnapshot(state.meetingSummary));
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
        handleCount,
        handleRatio: namespace.storage.getHandleRatio(state.uiPreferences, global.innerWidth),
        open: state.open,
        panelSnapshot: {
          activeTool: state.activeTool,
          bookmarksTool: bookmarkTool,
          meetingTool,
          open: state.open,
          promptTool: promptSnapshot,
          releaseTool: releaseState,
          settings: state.settings,
          settingsHydrated: Boolean(state.settingsHydrated),
          visible,
        },
        settings: state.settings,
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

  function createShellController(state, deps = {}) {
    const bookmarkController = deps.bookmarkController || {
      submitQuery() { return false; },
      updateQuery() { return false; },
    };
    const getPromptController = typeof deps.getPromptController === "function" ? deps.getPromptController : () => null;
    const isExtensionContextInvalidatedError = typeof deps.isExtensionContextInvalidatedError === "function"
      ? deps.isExtensionContextInvalidatedError
      : () => false;
    const releaseManager = deps.releaseManager || { ensureChecked() {} };
    const render = typeof deps.render === "function" ? deps.render : () => {};
    const UI_PREFERENCE_LOCK_MS = 1500;

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
      if (state.activeTool === "release") {
        releaseManager.ensureChecked(false, true);
      }
      render();
      await persistActiveTool(state.activeTool, nextPromptTab);
      return true;
    }

    function submitQuery(toolId, value) {
      const promptController = getPromptController();
      if (typeof promptController?.submitQuery === "function" && promptController.submitQuery(toolId, value)) {
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
      if (typeof promptController?.updateQuery === "function" && promptController.updateQuery(toolId, value, options)) {
        return true;
      }
      if (normalizeToolId(toolId) !== "bookmarks") {
        return false;
      }
      return bookmarkController.updateQuery(value);
    }

    function normalizeCount(value, fallback = 0) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    }

    function normalizePromptTab(activePromptTab) {
      return activePromptTab === "store" || activePromptTab === "review" ? activePromptTab : "library";
    }
  }

  namespace.panelV2ShellBridge = {
    createBootstrapController,
    createHostedOwnedPanelActivityBridge,
    createHostedOwnedPanelLifecycleBridge,
    createHostedOwnedPanelSurfaceBridge,
    createRenderController,
    createShellController,
  };
})(globalThis);
