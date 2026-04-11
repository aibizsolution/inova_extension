(function initPanelActivityController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, deps = {}) {
    const logPanelDebug = typeof deps.logPanelDebug === "function" ? deps.logPanelDebug : () => {};
    const meetingManager = deps.meetingManager || { scheduleSync() {} };
    const providerIdentitySync = deps.providerIdentitySync || { async syncToStorage() { return false; } };
    const releaseManager = deps.releaseManager || { ensureChecked() {} };
    const render = typeof deps.render === "function" ? deps.render : () => {};
    const schedulePromptCloudSyncIfNeeded = typeof deps.schedulePromptCloudSyncIfNeeded === "function"
      ? deps.schedulePromptCloudSyncIfNeeded
      : () => {};
    const schedulePromptRealtimeSync = typeof deps.schedulePromptRealtimeSync === "function"
      ? deps.schedulePromptRealtimeSync
      : () => {};

    return {
      handleVisibilityChange,
      handleWindowFocus,
    };

    function handleVisibilityChange() {
      if (global.document.visibilityState !== "visible") {
        meetingManager.scheduleSync(0);
        schedulePromptRealtimeSync(0);
        logPanelDebug("panel.ui.visibility.hidden", {
          scope: "panel-ui",
          tool: "panel",
        });
        render();
        return;
      }
      void providerIdentitySync.syncToStorage("visibility-visible");
      schedulePromptCloudSyncIfNeeded(320);
      meetingManager.scheduleSync(320);
      schedulePromptRealtimeSync(320);
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
      schedulePromptCloudSyncIfNeeded(320);
      meetingManager.scheduleSync(320);
      schedulePromptRealtimeSync(320);
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

  namespace.panelActivityController = { create };
})(globalThis);
