(function initPanelSurfaceController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, deps = {}) {
    const ensureStoreLoaded = typeof deps.ensureStoreLoaded === "function"
      ? deps.ensureStoreLoaded
      : () => {};
    const isStoreTabActive = typeof deps.isStoreTabActive === "function"
      ? deps.isStoreTabActive
      : () => false;
    const logPanelDebug = typeof deps.logPanelDebug === "function"
      ? deps.logPanelDebug
      : () => {};
    const meetingManager = deps.meetingManager || { scheduleSync() {} };
    const render = typeof deps.render === "function" ? deps.render : () => {};
    const schedulePromptRealtimeSync = typeof deps.schedulePromptRealtimeSync === "function"
      ? deps.schedulePromptRealtimeSync
      : () => {};

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

  namespace.panelSurfaceController = { create };
})(globalThis);
