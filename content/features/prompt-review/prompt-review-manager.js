(function initPromptReviewManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const normalizeText = namespace.session?.normalizeText || ((value) => String(value ?? "").trim());

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

  namespace.promptReviewManager = {
    create,
  };
})(globalThis);
