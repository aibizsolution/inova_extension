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
      importPromptLibrary: (...args) => cloudSyncManager.importPromptLibrary(...args),
      publishPrompt: (...args) => promptHubController.publishPrompt(...args),
      persistActiveTool,
      render,
      removePromptItem: (...args) => cloudSyncManager.removePromptItem(...args),
      savePromptItem: (...args) => cloudSyncManager.savePromptItem(...args),
    });
    const promptReviewManager = namespace.promptReviewManager.create(state, {
      render,
      showPromptTab: (...args) => promptHubController.showPromptTab(...args),
    });

    let promptRealtimeManager = null;
    const storeManager = namespace.storeManager.create(state, {
      importStorePrompt: (...args) => cloudSyncManager.importStorePrompt(...args),
      loadStoreDetail: (entryId) => promptRealtimeManager?.loadStoreDetail?.(entryId),
      refreshStoreLatestRealtime: () => {
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
      loadPromptLibraryNow: (...args) => cloudSyncManager.loadPromptLibraryNow(...args),
      onPromptLibraryFallback: (error) => {
        cloudSyncManager.markPromptLibraryFallback?.(error, {
          degradedReason: "prompt-library-realtime-failed",
          source: "realtime",
        }).catch((fallbackError) => {
          console.error("[i-Nova Bookmarks] prompt library fallback state failed", fallbackError);
        });
      },
      onPromptLibraryMeta: (remoteState) => cloudSyncManager.handleRealtimeRemoteState(remoteState),
      onStoreLatestFallback: (error) => {
        const hasRenderableStoreData = storeManager.markRealtimeFallback(error);
        if (hasRenderableStoreData) {
          return;
        }
        storeManager.ensureLoaded(true, "fallback", {
          degradedReason: "store-realtime-failed",
          errorMessage: error instanceof Error ? error.message : String(error || ""),
        }).catch((fallbackError) => {
          console.error("[i-Nova Bookmarks] store fallback refresh failed", fallbackError);
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
      cloudSyncManager,
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
