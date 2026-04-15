(function initPromptReviewManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, hooks = {}) {
    const render = typeof hooks.render === "function" ? hooks.render : () => {};
    let externalActivationRequestId = 0;

    return {
      buildReviewSignalState,
      buildViewState,
      consumeEscape,
      handleAction,
    };

    function buildReviewSignalState() {
      return externalActivationRequestId ? { requestId: externalActivationRequestId } : {};
    }

    function buildViewState() {
      const composerState = namespace.composer?.getComposerState?.() || { available: false, text: "" };
      return {
        available: Boolean(composerState.available),
        hasText: Boolean(normalizeText(composerState.text)),
        pending: false,
        result: null,
      };
    }

    function consumeEscape() {
      return false;
    }

    async function handleAction(action) {
      if (normalizeText(action) !== "activate-review") {
        return;
      }
      const composerState = namespace.composer?.getComposerState?.() || { available: false, text: "" };
      if (!composerState.available || !normalizeText(composerState.text)) {
        render();
        return;
      }
      externalActivationRequestId += 1;
      render();
    }
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
  }

  namespace.promptReviewManager = {
    create,
  };
})(globalThis);
