(function initPanelV2CompositionController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state) {
    let renderController = null;
    const render = () => renderController?.render();

    // v2 shell baseline: extension keeps only shell/runtime wiring and page adapters.
    const panelRuntimeController = namespace.panelRuntimeController.create(state);
    const runtimeFlags = {
      isPaused: panelRuntimeController.isPaused,
      isToolSurface: panelRuntimeController.isToolSurface,
    };
    const runtimeDiagnostics = {
      isExtensionContextInvalidatedError: panelRuntimeController.isExtensionContextInvalidatedError,
      logPanelDebug: panelRuntimeController.logPanelDebug,
    };
    const providerIdentitySync = namespace.providerIdentitySync.create(state, {
      ...runtimeDiagnostics,
      render,
    });
    const panelBookmarkController = namespace.panelBookmarkController.create(state, { render });
    const panelShellController = namespace.panelShellController.create(state, {
      bookmarkController: panelBookmarkController,
      getPromptController: () => null,
      isExtensionContextInvalidatedError: runtimeDiagnostics.isExtensionContextInvalidatedError,
      render,
    });

    // Route/lifecycle wiring stays in extension because it depends on the live page DOM surface.
    const routeStateController = namespace.routeStateController.create(state, {
      applyUiPreferenceLock: panelShellController.applyUiPreferenceLock,
      normalizeToolId: panelShellController.normalizeToolId,
    });
    const panelLifecycleController = namespace.panelLifecycleController.create(state, {
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      render,
    });
    const panelActivityController = namespace.panelActivityController.create(state, {
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      providerIdentitySync,
      render,
    });
    const panelSurfaceController = namespace.panelSurfaceController.create(state, {
      logPanelDebug: runtimeDiagnostics.logPanelDebug,
      render,
    });
    const routeSync = namespace.routeSync.create(state, {
      refreshState: routeStateController.refreshState,
      render,
      resetRouteState: routeStateController.resetRouteState,
    });
    const routeWatchController = namespace.routeWatchController.create(state, {
      scheduleRouteSync: routeSync.scheduleRouteSync,
    });

    renderController = namespace.panelRenderController.create(state, {
      isPaused: runtimeFlags.isPaused,
      isToolSurface: runtimeFlags.isToolSurface,
      panelBookmarkController,
      panelShellController,
    });
    const panelBootstrapController = namespace.panelBootstrapController.create(state, {
      panelActivityController,
      panelBookmarkController,
      panelLifecycleController,
      panelShellController,
      panelSurfaceController,
      providerIdentitySync,
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

  namespace.panelV2CompositionController = { create };
})(globalThis);
