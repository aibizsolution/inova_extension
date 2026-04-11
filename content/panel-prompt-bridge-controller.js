(function initPanelPromptBridgeController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(_state, deps = {}) {
    const panelPromptController = deps.panelPromptController || {
      buildReviewFloatState() { return {}; },
      buildToolState() { return {}; },
      ensureReviewFloat() {},
      ensureStoreLoaded() {},
      handleDraftChange() {},
      handleEscape() { return false; },
      handleImportFile() {},
      handlePromptAction() {},
      handleStorageChange() {},
      handleStoreAction() {},
      movePromptItem() {},
      scheduleCloudSyncIfNeeded() {},
      scheduleRealtimeSync() {},
      selectPromptTab() {},
      selectTool() { return false; },
      submitQuery() { return false; },
      updateQuery() { return false; },
    };

    return {
      buildReviewFloatState: (...args) => panelPromptController.buildReviewFloatState(...args),
      buildToolState: (...args) => panelPromptController.buildToolState(...args),
      ensureReviewFloat: (...args) => panelPromptController.ensureReviewFloat(...args),
      ensureStoreLoaded: (...args) => panelPromptController.ensureStoreLoaded(...args),
      handleDraftChange: (...args) => panelPromptController.handleDraftChange(...args),
      handleEscape: (...args) => panelPromptController.handleEscape(...args),
      handleImportFile: (...args) => panelPromptController.handleImportFile(...args),
      handlePromptAction: (...args) => panelPromptController.handlePromptAction(...args),
      handleStorageChange: (...args) => panelPromptController.handleStorageChange(...args),
      handleStoreAction: (...args) => panelPromptController.handleStoreAction(...args),
      movePromptItem: (...args) => panelPromptController.movePromptItem(...args),
      scheduleCloudSyncIfNeeded: (...args) => panelPromptController.scheduleCloudSyncIfNeeded(...args),
      schedulePromptCloudSyncIfNeeded: (...args) => panelPromptController.scheduleCloudSyncIfNeeded(...args),
      schedulePromptRealtimeSync: (...args) => panelPromptController.scheduleRealtimeSync(...args),
      scheduleRealtimeSync: (...args) => panelPromptController.scheduleRealtimeSync(...args),
      selectPromptTab: (...args) => panelPromptController.selectPromptTab(...args),
      selectTool: (...args) => panelPromptController.selectTool(...args),
      submitQuery: (...args) => panelPromptController.submitQuery(...args),
      updateQuery: (...args) => panelPromptController.updateQuery(...args),
    };
  }

  namespace.panelPromptBridgeController = { create };
})(globalThis);
