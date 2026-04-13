(function initPanelDebugController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const DEBUG_ACTIONS = new Set(["debug-toggle", "debug-copy", "debug-copy-errors", "debug-clear"]);

  function create(state, deps = {}) {
    const isPaused = typeof deps.isPaused === "function" ? deps.isPaused : () => false;
    const isToolSurface = typeof deps.isToolSurface === "function" ? deps.isToolSurface : () => false;

    return {
      buildState() {
        return {};
      },
      async handleAction(action) {
        const normalizedAction = namespace.session.normalizeText(action);
        if (normalizedAction === "debug-copy") {
          await copyEntries(false);
          return true;
        }
        if (normalizedAction === "debug-copy-errors") {
          await copyEntries(true);
          return true;
        }
        if (normalizedAction === "debug-clear") {
          namespace.panelDebug?.clearEntries?.();
          return true;
        }
        return normalizedAction === "debug-toggle";
      },
      handlesAction(action) {
        return DEBUG_ACTIONS.has(namespace.session.normalizeText(action));
      },
      installValidationApi() {
        delete namespace.panelDebugValidation;
      },
      syncEnabled() {
        namespace.panelDebug?.setEnabled?.(shouldEnable());
      },
    };

    async function copyEntries(errorsOnly) {
      const entries = namespace.panelDebug?.getEntries?.() || [];
      const text = errorsOnly
        ? namespace.panelDebug?.buildErrorCopyText?.(entries)
        : namespace.panelDebug?.buildCopyText?.(entries);
      if (!namespace.session.normalizeText(text)) {
        return;
      }
      try {
        await global.navigator.clipboard.writeText(text);
      } catch (error) {
        namespace.panelDebug?.log?.("panel.debug.copy.error", {
          error: error instanceof Error ? error.message : String(error || ""),
          errorsOnly: Boolean(errorsOnly),
        });
      }
    }

    function shouldEnable() {
      return Boolean(
        namespace.panelDebug?.isLocalDebugEnabled?.(state.settings)
        && state.settings.enabled
        && isToolSurface()
        && !isPaused()
        && global.document.visibilityState === "visible"
      );
    }
  }

  namespace.panelDebugController = {
    create,
    readCollapsedPreference() {
      return true;
    },
  };
})(globalThis);
