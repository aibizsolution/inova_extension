(function initPanelLifecycleController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const PANEL_OPEN_KEY = "inova-plus.panel-open";

  function create(state, deps = {}) {
    const cloudSyncManager = deps.cloudSyncManager || { scheduleSync() {} };
    const isPaused = typeof deps.isPaused === "function" ? deps.isPaused : () => false;
    const isStoreTabActive = typeof deps.isStoreTabActive === "function" ? deps.isStoreTabActive : () => false;
    const isToolSurface = typeof deps.isToolSurface === "function" ? deps.isToolSurface : () => false;
    const logPanelDebug = typeof deps.logPanelDebug === "function" ? deps.logPanelDebug : () => {};
    const meetingManager = deps.meetingManager || { scheduleSync() {} };
    const promptRealtimeManager = deps.promptRealtimeManager || { scheduleSync() {} };
    const providerIdentitySync = deps.providerIdentitySync || { async syncToStorage() { return false; } };
    const releaseManager = deps.releaseManager || { ensureChecked() {} };
    const render = typeof deps.render === "function" ? deps.render : () => {};
    const shouldRunPromptCloudSync = typeof deps.shouldRunPromptCloudSync === "function" ? deps.shouldRunPromptCloudSync : () => false;
    const storeManager = deps.storeManager || { ensureLoaded() {} };

    function handleVisibilityChange() {
      if (global.document.visibilityState !== "visible") {
        meetingManager.scheduleSync(0);
        promptRealtimeManager.scheduleSync(0);
        logPanelDebug("panel.ui.visibility.hidden", {
          scope: "panel-ui",
          tool: "panel",
        });
        render();
        return;
      }
      void providerIdentitySync.syncToStorage("visibility-visible");
      if (shouldRunPromptCloudSync()) {
        cloudSyncManager.scheduleSync(320);
      }
      meetingManager.scheduleSync(320);
      promptRealtimeManager.scheduleSync(320);
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
      if (shouldRunPromptCloudSync()) {
        cloudSyncManager.scheduleSync(320);
      }
      meetingManager.scheduleSync(320);
      promptRealtimeManager.scheduleSync(320);
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
          storeManager.ensureLoaded();
        }
        meetingManager.scheduleSync(hasComposer ? 120 : 0);
        promptRealtimeManager.scheduleSync(120);
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
      if (shouldRunPromptCloudSync()) {
        cloudSyncManager.scheduleSync(220);
      }
      meetingManager.scheduleSync(state.open ? 220 : 0);
      promptRealtimeManager.scheduleSync(state.open ? 220 : 0);
      if (state.open && isStoreTabActive()) {
        storeManager.ensureLoaded();
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
