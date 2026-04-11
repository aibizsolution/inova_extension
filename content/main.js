(function initContentMain(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  let panelRenderController = null;
  const render = () => panelRenderController?.render();
  const state = namespace.panelStateFactory.createState();
  const panelRuntimeController = namespace.panelRuntimeController.create(state);

  const releaseManager = namespace.releaseManager.create(state, { render });
  const meetingManager = namespace.meetingManager.create(state, { render });
  const providerIdentitySync = namespace.providerIdentitySync.create(state, {
    isExtensionContextInvalidatedError: panelRuntimeController.isExtensionContextInvalidatedError,
    logPanelDebug: panelRuntimeController.logPanelDebug,
    render,
  });
  const panelMeetingController = namespace.panelMeetingController.create(state, {
    meetingManager,
    providerIdentitySync,
    render,
  });
  const panelDebugController = namespace.panelDebugController.create(state, {
    isPaused: panelRuntimeController.isPaused,
    isToolSurface: panelRuntimeController.isToolSurface,
    render,
  });
  const panelActionController = namespace.panelActionController.create(state, {
    panelDebugController,
    panelMeetingController,
  });
  const panelBookmarkController = namespace.panelBookmarkController.create(state, { render });
  let panelPromptBridgeController = null;
  const panelShellController = namespace.panelShellController.create(state, {
    bookmarkController: panelBookmarkController,
    getPromptController: () => panelPromptBridgeController,
    isExtensionContextInvalidatedError: panelRuntimeController.isExtensionContextInvalidatedError,
    meetingManager,
    releaseManager,
    render,
  });
  const panelPromptController = namespace.panelPromptController.create(state, {
    isPaused: panelRuntimeController.isPaused,
    isToolSurface: panelRuntimeController.isToolSurface,
    lockUiPreferenceSelection: panelShellController.lockUiPreferenceSelection,
    onPromptTabSelected: () => meetingManager.scheduleSync(0),
    persistActiveTool: panelShellController.persistActiveTool,
    render,
  });
  panelPromptBridgeController = namespace.panelPromptBridgeController.create(state, {
    panelPromptController,
  });
  const routeStateController = namespace.routeStateController.create(state, {
    applyUiPreferenceLock: panelShellController.applyUiPreferenceLock,
    ensureStoreLoaded: panelPromptBridgeController.ensureStoreLoaded,
    normalizeToolId: panelShellController.normalizeToolId,
  });
  const panelLifecycleController = namespace.panelLifecycleController.create(state, {
    ensureStoreLoaded: panelPromptBridgeController.ensureStoreLoaded,
    isStoreTabActive: panelRuntimeController.isStoreTabActive,
    logPanelDebug: panelRuntimeController.logPanelDebug,
    meetingManager,
    releaseManager,
    render,
    schedulePromptCloudSyncIfNeeded: panelPromptBridgeController.schedulePromptCloudSyncIfNeeded,
    schedulePromptRealtimeSync: panelPromptBridgeController.schedulePromptRealtimeSync,
  });
  const panelActivityController = namespace.panelActivityController.create(state, {
    logPanelDebug: panelRuntimeController.logPanelDebug,
    meetingManager,
    providerIdentitySync,
    releaseManager,
    render,
    schedulePromptCloudSyncIfNeeded: panelPromptBridgeController.schedulePromptCloudSyncIfNeeded,
    schedulePromptRealtimeSync: panelPromptBridgeController.schedulePromptRealtimeSync,
  });
  const panelSurfaceController = namespace.panelSurfaceController.create(state, {
    ensureStoreLoaded: panelPromptBridgeController.ensureStoreLoaded,
    isStoreTabActive: panelRuntimeController.isStoreTabActive,
    logPanelDebug: panelRuntimeController.logPanelDebug,
    meetingManager,
    render,
    schedulePromptRealtimeSync: panelPromptBridgeController.schedulePromptRealtimeSync,
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
    isPaused: panelRuntimeController.isPaused,
    isToolSurface: panelRuntimeController.isToolSurface,
    panelBookmarkController,
    panelDebugController,
    panelMeetingController,
    panelPromptController: panelPromptBridgeController,
    panelShellController,
    releaseManager,
  });
  const panelBootstrapController = namespace.panelBootstrapController.create(state, {
    handlePanelMeetingAction: panelActionController.handlePanelMeetingAction,
    isStoreTabActive: panelRuntimeController.isStoreTabActive,
    meetingManager,
    panelActivityController,
    panelBookmarkController,
    panelDebugController,
    panelLifecycleController,
    panelPromptController: panelPromptBridgeController,
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
})(globalThis);
