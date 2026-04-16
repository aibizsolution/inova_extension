(function initPanelV2PromptController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, deps = {}) {
    const isPaused = typeof deps.isPaused === "function" ? deps.isPaused : () => false;
    const isToolSurface = typeof deps.isToolSurface === "function" ? deps.isToolSurface : () => false;
    const render = typeof deps.render === "function" ? deps.render : () => {};

    const promptReviewManager = namespace.promptReviewManager.create(state, {
      render,
    });

    return {
      buildReviewFloatState,
      buildToolState,
      ensureReviewFloat,
    };

    function buildToolState() {
      return {
        promptTool: {
          review: promptReviewManager.buildReviewSignalState(),
        },
      };
    }

    function buildReviewFloatState(visible = state.settings.enabled && isToolSurface() && !isPaused()) {
      return {
        ...promptReviewManager.buildViewState(),
        visible,
      };
    }

    function ensureReviewFloat() {
      namespace.composerReviewFloat?.ensure?.({
        buildState: buildReviewFloatState,
        onAction: promptReviewManager.handleAction,
      });
    }

  }

  namespace.panelV2PromptController = { create };
})(globalThis);
