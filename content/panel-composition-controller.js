(function initPanelCompositionController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state) {
    let promptBridgeController = null;
    let renderController = null;
    const render = () => renderController?.render();

    // Runtime foundation: surface state, diagnostics, and remote managers.
    const panelRuntimeController = namespace.panelRuntimeController.create(state);
    const runtimeFlags = {
      isPaused: panelRuntimeController.isPaused,
      isStoreTabActive: panelRuntimeController.isStoreTabActive,
      isToolSurface: panelRuntimeController.isToolSurface,
    };
    const runtimeDiagnostics = {
      isExtensionContextInvalidatedError: panelRuntimeController.isExtensionContextInvalidatedError,
      logPanelDebug: panelRuntimeController.logPanelDebug,
    };
    const releaseManager = namespace.releaseManager.create(state, { render });
    const meetingManager = namespace.meetingManager.create(state, { render });
    const providerIdentitySync = namespace.providerIdentitySync.create(state, {
      ...runtimeDiagnostics,
      render,
    });

    // Tool shell: bookmark/meeting/debug/prompt entry points that the panel exposes.
    const panelMeetingController = namespace.panelMeetingController.create(state, {
      meetingManager,
      providerIdentitySync,
      render,
    });
    const panelDebugController = namespace.panelDebugController.create(state, {
      ...runtimeFlags,
      render,
    });
    const panelActionController = namespace.panelActionController.create(state, {
      panelDebugController,
      panelMeetingController,
    });
    const panelBookmarkController = namespace.panelBookmarkController.create(state, { render });
    const panelShellController = namespace.panelShellController.create(state, {
      bookmarkController: panelBookmarkController,
      getPromptController: () => promptBridgeController,
      isExtensionContextInvalidatedError: runtimeDiagnostics.isExtensionContextInvalidatedError,
      meetingManager,
      releaseManager,
      render,
    });
    const panelPromptController = namespace.panelPromptController.create(state, {
      ...runtimeFlags,
      lockUiPreferenceSelection: panelShellController.lockUiPreferenceSelection,
      onPromptTabSelected: () => meetingManager.scheduleSync(0),
      persistActiveTool: panelShellController.persistActiveTool,
      render,
    });
    promptBridgeController = namespace.panelPromptBridgeController.create(state, {
      panelPromptController,
    });
    const promptSyncBridge = {
      ensureStoreLoaded: promptBridgeController.ensureStoreLoaded,
      schedulePromptCloudSyncIfNeeded: promptBridgeController.schedulePromptCloudSyncIfNeeded,
      schedulePromptRealtimeSync: promptBridgeController.schedulePromptRealtimeSync,
    };

    // Route and lifecycle: browser events, sync scheduling, and visibility-driven reactions.
    const routeStateController = namespace.routeStateController.create(state, {
      applyUiPreferenceLock: panelShellController.applyUiPreferenceLock,
      ensureStoreLoaded: promptSyncBridge.ensureStoreLoaded,
      normalizeToolId: panelShellController.normalizeToolId,
    });
    const panelLifecycleController = namespace.panelLifecycleController.create(state, {
      ensureStoreLoaded: promptSyncBridge.ensureStoreLoaded,
      isStoreTabActive: runtimeFlags.isStoreTabActive,
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      meetingManager,
      releaseManager,
      render,
      schedulePromptCloudSyncIfNeeded: promptSyncBridge.schedulePromptCloudSyncIfNeeded,
      schedulePromptRealtimeSync: promptSyncBridge.schedulePromptRealtimeSync,
    });
    const panelActivityController = namespace.panelActivityController.create(state, {
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      meetingManager,
      providerIdentitySync,
      releaseManager,
      render,
      schedulePromptCloudSyncIfNeeded: promptSyncBridge.schedulePromptCloudSyncIfNeeded,
      schedulePromptRealtimeSync: promptSyncBridge.schedulePromptRealtimeSync,
    });
    const panelSurfaceController = namespace.panelSurfaceController.create(state, {
      ensureStoreLoaded: promptSyncBridge.ensureStoreLoaded,
      isStoreTabActive: runtimeFlags.isStoreTabActive,
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      meetingManager,
      render,
      schedulePromptRealtimeSync: promptSyncBridge.schedulePromptRealtimeSync,
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

    // Final assembly: render payloads plus bootstrap wiring for the live panel.
    renderController = namespace.panelRenderController.create(state, {
      isPaused: runtimeFlags.isPaused,
      isToolSurface: runtimeFlags.isToolSurface,
      panelBookmarkController,
      panelDebugController,
      panelMeetingController,
      panelPromptController: promptBridgeController,
      panelShellController,
      releaseManager,
    });
    const panelBootstrapController = namespace.panelBootstrapController.create(state, {
      handlePanelMeetingAction: panelActionController.handlePanelMeetingAction,
      isStoreTabActive: runtimeFlags.isStoreTabActive,
      meetingManager,
      panelActivityController,
      panelBookmarkController,
      panelDebugController,
      panelLifecycleController,
      panelPromptController: promptBridgeController,
      panelShellController,
      panelSurfaceController,
      providerIdentitySync,
      releaseManager,
      render,
      routeStateController,
      routeSync,
      routeWatchController,
    });

    return {
      bootstrap() {
        return panelBootstrapController.bootstrap();
      },
    };
  }

  namespace.panelCompositionController = { create };
})(globalThis);
