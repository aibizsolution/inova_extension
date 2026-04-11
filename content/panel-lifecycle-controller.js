(function initPanelLifecycleController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const PANEL_OPEN_KEY = "inova-plus.panel-open";

  function create(state, deps = {}) {
    const isStoreTabActive = typeof deps.isStoreTabActive === "function" ? deps.isStoreTabActive : () => false;
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
    const ensureStoreLoaded = typeof deps.ensureStoreLoaded === "function"
      ? deps.ensureStoreLoaded
      : () => {};

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

    function initializeOpenState() {
      state.preferredOpen = readPanelOpenPreference();
      state.open = state.preferredOpen;
    }

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
        if (!hadComposer && hasComposer && isStoreTabActive()) {
          ensureStoreLoaded();
        }
        meetingManager.scheduleSync(hasComposer ? 120 : 0);
        schedulePromptRealtimeSync(120);
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

    function togglePanel(nextOpen, persist = true) {
      state.open = typeof nextOpen === "boolean" ? nextOpen : !state.open;
      if (persist) {
        state.preferredOpen = state.open;
        writePanelOpenPreference(state.open);
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
      handleVisibilityChange,
      handleWindowFocus,
      initializeOpenState,
      installSurfaceWatchers,
      togglePanel,
    };
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

  namespace.panelLifecycleController = { create };
})(globalThis);
