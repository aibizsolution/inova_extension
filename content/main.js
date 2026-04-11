(function initContentMain(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  let panelRenderController = null;
  const render = () => panelRenderController?.render();
  const state = namespace.panelStateFactory.createState();

  const releaseManager = namespace.releaseManager.create(state, { render });
  const meetingManager = namespace.meetingManager.create(state, { render });
  const providerIdentitySync = namespace.providerIdentitySync.create(state, {
    isExtensionContextInvalidatedError,
    logPanelDebug,
    render,
  });
  const panelMeetingController = namespace.panelMeetingController.create(state, {
    meetingManager,
    providerIdentitySync,
    render,
  });
  const panelDebugController = namespace.panelDebugController.create(state, {
    isPaused,
    isToolSurface,
    render,
  });
  const panelBookmarkController = namespace.panelBookmarkController.create(state, { render });
  let panelPromptController = null;
  const panelShellController = namespace.panelShellController.create(state, {
    bookmarkController: panelBookmarkController,
    getPromptController: () => panelPromptController,
    isExtensionContextInvalidatedError,
    meetingManager,
    releaseManager,
    render,
  });
  panelPromptController = namespace.panelPromptController.create(state, {
    isPaused,
    isToolSurface,
    lockUiPreferenceSelection: panelShellController.lockUiPreferenceSelection,
    onPromptTabSelected: () => meetingManager.scheduleSync(0),
    persistActiveTool: panelShellController.persistActiveTool,
    render,
  });
  const routeStateController = namespace.routeStateController.create(state, {
    applyUiPreferenceLock: panelShellController.applyUiPreferenceLock,
    ensureStoreLoaded: () => panelPromptController.ensureStoreLoaded(),
    normalizeToolId: panelShellController.normalizeToolId,
  });
  const panelLifecycleController = namespace.panelLifecycleController.create(state, {
    ensureStoreLoaded: () => panelPromptController.ensureStoreLoaded(),
    isStoreTabActive,
    logPanelDebug,
    meetingManager,
    releaseManager,
    render,
    schedulePromptCloudSyncIfNeeded: (delay) => panelPromptController.scheduleCloudSyncIfNeeded(delay),
    schedulePromptRealtimeSync: (delay) => panelPromptController.scheduleRealtimeSync(delay),
  });
  const panelActivityController = namespace.panelActivityController.create(state, {
    logPanelDebug,
    meetingManager,
    providerIdentitySync,
    releaseManager,
    render,
    schedulePromptCloudSyncIfNeeded: (delay) => panelPromptController.scheduleCloudSyncIfNeeded(delay),
    schedulePromptRealtimeSync: (delay) => panelPromptController.scheduleRealtimeSync(delay),
  });
  const panelSurfaceController = namespace.panelSurfaceController.create(state, {
    ensureStoreLoaded: () => panelPromptController.ensureStoreLoaded(),
    isStoreTabActive,
    logPanelDebug,
    meetingManager,
    render,
    schedulePromptRealtimeSync: (delay) => panelPromptController.scheduleRealtimeSync(delay),
  });
  const routeSync = namespace.routeSync.create(state, {
    onRouteStateChanged: meetingManager.handleRouteStateChange,
    refreshState: routeStateController.refreshState,
    render,
    resetRouteState: routeStateController.resetRouteState,
  });
  const routeWatchController = namespace.routeWatchController.create(state, {
    scheduleRouteSync: routeSync.scheduleRouteSync,
  });
  panelRenderController = namespace.panelRenderController.create(state, {
    isPaused,
    isToolSurface,
    panelBookmarkController,
    panelDebugController,
    panelMeetingController,
    panelPromptController,
    panelShellController,
    releaseManager,
  });
  const panelBootstrapController = namespace.panelBootstrapController.create(state, {
    handlePanelMeetingAction,
    isStoreTabActive,
    meetingManager,
    panelActivityController,
    panelBookmarkController,
    panelDebugController,
    panelLifecycleController,
    panelPromptController,
    panelShellController,
    panelSurfaceController,
    providerIdentitySync,
    releaseManager,
    render,
    routeStateController,
    routeSync,
    routeWatchController,
  });

  panelBootstrapController.bootstrap().catch((error) => console.error("[i-Nova Bookmarks] bootstrap failed", error));

  async function handlePanelMeetingAction(action, detail = {}) {
    if (panelDebugController.handlesAction(action)) {
      await panelDebugController.handleAction(action);
      return;
    }
    await panelMeetingController.handleAction(action, detail);
  }

  function isPaused() {
    return Boolean(state.sessionId && state.pausedSessions[state.sessionId]);
  }

  function isStoreTabActive() {
    return state.activeTool === "prompts"
      && (state.uiPreferences.activeTool === "store" || state.uiPreferences.activePromptTab === "store");
  }

  function isToolSurface() {
    return namespace.contentDom.getConversationState().hasComposer;
  }

  function isExtensionContextInvalidatedError(error) {
    const message = namespace.session.normalizeText(error instanceof Error ? error.message : String(error || "")).toLowerCase();
    return message.includes("extension context invalidated");
  }

  function logPanelDebug(event, payload) {
    namespace.panelDebug?.log?.(event, payload || {});
  }
})(globalThis);
