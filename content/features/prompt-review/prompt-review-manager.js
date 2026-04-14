(function initPromptReviewManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, hooks = {}) {
    const render = typeof hooks.render === "function" ? hooks.render : () => {};
    const showPromptTab = typeof hooks.showPromptTab === "function" ? hooks.showPromptTab : () => {};

    return {
      buildReviewSignalState,
      buildViewState,
      consumeEscape,
      handleAction,
    };

    function buildReviewSignalState() {
      const requestId = Math.max(0, Number(state?.promptReview?.requestId) || 0);
      return requestId ? { requestId } : {};
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
      const nextRequestId = Math.max(0, Number(state?.promptReview?.requestId) || 0) + 1;
      state.promptReview = {
        ...(namespace.constants?.defaults?.promptReview || {}),
        requestId: nextRequestId,
      };
      showPromptTab("review");
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
