(function initPanelRuntimeController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state) {
    return {
      isExtensionContextInvalidatedError,
      isPaused,
      isStoreTabActive,
      isToolSurface,
      logPanelDebug,
    };

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
  }

  namespace.panelRuntimeController = { create };
})(globalThis);
