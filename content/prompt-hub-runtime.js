(function initPromptHubRuntime(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(state, options = {}) {
    const cloudSyncManager = options.cloudSyncManager;
    const getActivePromptTab = options.getActivePromptTab || (() => "library");
    const isToolSurface = options.isToolSurface || (() => false);
    const lockUiPreferenceSelection = options.lockUiPreferenceSelection || (() => {});
    const normalizePromptTab = options.normalizePromptTab || ((promptTabId) => promptTabId);
    const onPromptTabSelected = options.onPromptTabSelected || (() => {});
    const persistActiveTool = options.persistActiveTool || (async () => {});
    const render = options.render || (() => {});

    let promptHubController = null;
    const promptManager = namespace.promptManager.create(state, {
      publishPrompt: (...args) => promptHubController.publishPrompt(...args),
      persistActiveTool,
      render,
    });
    const promptReviewManager = namespace.promptReviewManager.create(state, {
      render,
      showPromptTab: (...args) => promptHubController.showPromptTab(...args),
    });

    let promptRealtimeManager = null;
    const storeManager = namespace.storeManager.create(state, {
      loadStoreDetail: (entryId) => promptRealtimeManager?.loadStoreDetail?.(entryId),
      refreshStoreLatestRealtime: (reason) => {
        promptRealtimeManager?.scheduleSync?.(80);
      },
      shouldReloadAfterMutation: () => {
        const storeTabActive = state.activeTool === "prompts" && getActivePromptTab() === "store";
        if (!storeTabActive) {
          return false;
        }
        if (state.store.scope !== "all") {
          return true;
        }
        return !promptRealtimeManager?.isStoreLatestRealtimeActive?.();
      },
      shouldUseStoreLatestRealtime: () => Boolean(promptRealtimeManager?.shouldUseStoreLatestRealtime?.()),
      render,
    });

    promptRealtimeManager = namespace.promptRealtimeManager.create(state, {
      getActivePromptTab,
      isToolSurface,
      onPromptLibraryFallback: () => {},
      onPromptLibraryMeta: (remoteState) => cloudSyncManager.handleRealtimeRemoteState(remoteState),
      onStoreLatestFallback: () => {
        const hasRenderableStoreData = Boolean(
          state.store.loaded
          || (Array.isArray(state.store.items) && state.store.items.length)
          || Number(state.store.totalCount || 0) > 0
        );
        if (hasRenderableStoreData) {
          render();
          return;
        }
        storeManager.ensureLoaded(true, "fallback").catch((error) => {
          console.error("[i-Nova Bookmarks] store fallback refresh failed", error);
        });
      },
      onStoreLatestSnapshot: (payload) => storeManager.applyLatestRealtimeSnapshot(payload),
      render,
    });

    promptHubController = namespace.promptHubController.create(state, {
      getActivePromptTab,
      lockUiPreferenceSelection,
      normalizePromptTab,
      onSelectPromptTab: onPromptTabSelected,
      persistActiveTool,
      promptManager,
      promptRealtimeManager,
      promptReviewManager,
      render,
      storeManager,
    });

    return {
      promptHubController,
      promptManager,
      promptRealtimeManager,
      promptReviewManager,
      storeManager,
    };
  }

  namespace.promptHubRuntime = { create };
})(globalThis);
