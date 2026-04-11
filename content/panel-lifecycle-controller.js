(function initPanelLifecycleController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, deps = {}) {
    const isStoreTabActive = typeof deps.isStoreTabActive === "function" ? deps.isStoreTabActive : () => false;
    const logPanelDebug = typeof deps.logPanelDebug === "function" ? deps.logPanelDebug : () => {};
    const meetingManager = deps.meetingManager || { scheduleSync() {} };
    const releaseManager = deps.releaseManager || { ensureChecked() {} };
    const render = typeof deps.render === "function" ? deps.render : () => {};
    const schedulePromptCloudSyncIfNeeded = typeof deps.schedulePromptCloudSyncIfNeeded === "function"
      ? deps.schedulePromptCloudSyncIfNeeded
      : () => {};
    const schedulePromptRealtimeSync = typeof deps.schedulePromptRealtimeSync === "function"
      ? deps.schedulePromptRealtimeSync
      : () => {};
    const ensureStoreLoaded = typeof deps.ensureStoreLoaded === "function"
      ? deps.ensureStoreLoaded
      : () => {};

    function initializeOpenState() {
      state.preferredOpen = false;
      state.open = false;
    }

    function togglePanel(nextOpen, persist = true) {
      state.open = typeof nextOpen === "boolean" ? nextOpen : !state.open;
      if (persist) {
        state.preferredOpen = state.open;
      }
      schedulePromptCloudSyncIfNeeded(220);
      meetingManager.scheduleSync(state.open ? 220 : 0);
      schedulePromptRealtimeSync(state.open ? 220 : 0);
      if (state.open && isStoreTabActive()) {
        ensureStoreLoaded();
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

    return {
      initializeOpenState,
      togglePanel,
    };
  }

  namespace.panelLifecycleController = { create };
})(globalThis);
