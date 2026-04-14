(function initLegacyPromptStorage(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const PROMPT_LIBRARY_STORAGE_KEY = "promptLibrary";
  const PROMPT_LIBRARY_DEFAULTS = Object.freeze({
    version: 1,
    items: [],
  });

  async function markPromptLibrarySynced(providerIdentity, syncedAt) {
    const current = await namespace.storage.getCloudSyncState();
    const cloudSync = namespace.cloudSync.markPromptLibrarySynced(current, providerIdentity, syncedAt);
    await namespace.storage.setLocal({ cloudSync });
    return cloudSync;
  }

  async function setPromptSyncError(errorMessage, providerIdentity, options = {}) {
    const current = await namespace.storage.getCloudSyncState();
    const cloudSync = namespace.cloudSync.setPromptSyncError(current, errorMessage, providerIdentity, options);
    await namespace.storage.setLocal({ cloudSync });
    return cloudSync;
  }

  async function setPromptSyncDegraded(errorMessage, providerIdentity, options = {}) {
    const current = await namespace.storage.getCloudSyncState();
    const cloudSync = namespace.cloudSync.setPromptSyncDegraded(current, errorMessage, providerIdentity, options);
    await namespace.storage.setLocal({ cloudSync });
    return cloudSync;
  }

  async function recordPromptLibraryRemoteState(remoteState, providerIdentity, options = {}) {
    const current = await namespace.storage.getCloudSyncState();
    const cloudSync = namespace.cloudSync.recordPromptLibraryRemoteState(current, remoteState, providerIdentity, options);
    await namespace.storage.setLocal({ cloudSync });
    return cloudSync;
  }

  async function getPromptLibrary() {
    const current = await readLegacyPromptLibraryState();
    return namespace.promptLibrary.mergePromptLibrary(current);
  }

  async function setPromptLibrary(nextPromptLibrary) {
    const promptLibraryState = namespace.promptLibrary.mergePromptLibrary(nextPromptLibrary);
    const { promptLibrary } = await persistPromptLibrary(
      promptLibraryState,
      "set-prompt-library",
      namespace.cloudSync.createReplaceLibraryOperation(promptLibraryState)
    );
    return promptLibrary;
  }

  async function savePromptItem(itemInput) {
    const current = await getPromptLibrary();
    const reason = current.items.some((item) => item.id === itemInput?.id) ? "update-prompt" : "create-prompt";
    const nextPromptLibrary = namespace.promptLibrary.upsertPromptItem(current, itemInput);
    const nextIndex = current.items.findIndex((item) => item.id === itemInput?.id);
    const nextPromptId = nextPromptLibrary.items[Math.max(0, nextIndex)]?.id || nextPromptLibrary.items[0]?.id;
    const result = await persistPromptLibrary(
      nextPromptLibrary,
      reason,
      namespace.cloudSync.createUpsertPromptOperation(nextPromptLibrary, nextPromptId, nextIndex === -1)
    );
    return result.promptLibrary;
  }

  async function removePromptItem(promptId) {
    const current = await getPromptLibrary();
    const nextPromptLibrary = namespace.promptLibrary.removePromptItem(current, promptId);
    const result = await persistPromptLibrary(
      nextPromptLibrary,
      "delete-prompt",
      namespace.cloudSync.createDeletePromptOperation(nextPromptLibrary, promptId)
    );
    return result.promptLibrary;
  }

  async function importPromptLibrary(payload, mode) {
    const current = await getPromptLibrary();
    const result = namespace.promptLibrary.applyImport(current, payload, mode);
    const syncResult = await persistPromptLibrary(
      result.library,
      mode === "replace" ? "replace-import" : mode === "merge" ? "merge-import" : "add-import",
      namespace.cloudSync.createReplaceLibraryOperation(result.library)
    );
    return {
      ...result,
      cloudSync: syncResult.cloudSync,
      library: syncResult.promptLibrary,
    };
  }

  async function movePromptItem(dragPromptId, targetPromptId, placement) {
    const current = await getPromptLibrary();
    const promptLibrary = namespace.promptLibrary.movePromptItem(current, dragPromptId, targetPromptId, placement);
    const result = await persistPromptLibrary(
      promptLibrary,
      "reorder-prompts",
      namespace.cloudSync.createReorderPromptOperation(promptLibrary)
    );
    return result.promptLibrary;
  }

  async function importStorePrompt(storeEntry) {
    const current = await getPromptLibrary();
    const promptLibrary = namespace.promptLibrary.importStoreEntry(current, storeEntry);
    const result = await persistPromptLibrary(
      promptLibrary,
      "import-store-prompt",
      namespace.cloudSync.createUpsertPromptOperation(promptLibrary, promptLibrary.items[0]?.id, true)
    );
    return result.promptLibrary;
  }

  async function markPromptPublished(promptId, publication) {
    const current = await getPromptLibrary();
    const promptLibrary = namespace.promptLibrary.markPromptPublished(current, promptId, publication);
    await writeLegacyPromptLibraryState(promptLibrary);
    return promptLibrary;
  }

  async function clearPromptPublication(promptId) {
    const current = await getPromptLibrary();
    const promptLibrary = namespace.promptLibrary.clearPromptPublication(current, promptId);
    await writeLegacyPromptLibraryState(promptLibrary);
    return promptLibrary;
  }

  async function buildPromptSyncDocument() {
    const [promptLibrary, cloudSync] = await Promise.all([getPromptLibrary(), namespace.storage.getCloudSyncState()]);
    return namespace.cloudSync.buildPromptSyncDocument(promptLibrary, cloudSync);
  }

  async function hydratePromptLibraryFromCloud(nextPromptLibrary, providerIdentity, syncedAt) {
    const promptLibrary = namespace.promptLibrary.mergePromptLibrary(nextPromptLibrary);
    const currentCloudSync = await namespace.storage.getCloudSyncState();
    const cloudSync = namespace.cloudSync.markPromptLibrarySynced(currentCloudSync, providerIdentity, syncedAt);
    await Promise.all([
      namespace.storage.setLocal({ cloudSync }),
      writeLegacyPromptLibraryState(promptLibrary),
    ]);
    return { cloudSync, promptLibrary };
  }

  async function persistPromptLibrary(nextPromptLibrary, reason, operation) {
    const promptLibrary = namespace.promptLibrary.mergePromptLibrary(nextPromptLibrary);
    const currentCloudSync = await namespace.storage.getCloudSyncState();
    const providerIdentity = namespace.providerIdentity?.getCurrent?.() || {};
    const cloudSync = namespace.cloudSync.queuePromptLibrarySyncOperation(
      currentCloudSync,
      reason,
      providerIdentity,
      promptLibrary,
      operation
    );
    await Promise.all([
      namespace.storage.setLocal({ cloudSync }),
      writeLegacyPromptLibraryState(promptLibrary),
    ]);
    return { cloudSync, promptLibrary };
  }

  async function readLegacyPromptLibraryState() {
    if (!global.chrome?.storage?.local) {
      return cloneValue(PROMPT_LIBRARY_DEFAULTS);
    }
    const rawState = await global.chrome.storage.local.get([PROMPT_LIBRARY_STORAGE_KEY]);
    return namespace.promptLibrary.mergePromptLibrary(rawState?.[PROMPT_LIBRARY_STORAGE_KEY] || PROMPT_LIBRARY_DEFAULTS);
  }

  async function writeLegacyPromptLibraryState(promptLibrary) {
    if (!global.chrome?.storage?.local) {
      return;
    }
    await global.chrome.storage.local.set({
      [PROMPT_LIBRARY_STORAGE_KEY]: namespace.promptLibrary.mergePromptLibrary(promptLibrary),
    });
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  namespace.storage = {
    ...namespace.storage,
    buildPromptSyncDocument,
    clearPromptPublication,
    getPromptLibrary,
    hydratePromptLibraryFromCloud,
    importPromptLibrary,
    importStorePrompt,
    markPromptLibrarySynced,
    markPromptPublished,
    movePromptItem,
    recordPromptLibraryRemoteState,
    removePromptItem,
    savePromptItem,
    setPromptLibrary,
    setPromptSyncDegraded,
    setPromptSyncError,
  };
})(globalThis);
