(function initStorage(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { defaults } = namespace.constants;
  const STORAGE_ERROR_CODES = {
    unavailable: "storage-unavailable",
    invalidated: "extension-context-invalidated",
  };

  async function getLocal(keys) {
    if (!global.chrome?.storage?.local) {
      throw createStorageAccessError(
        STORAGE_ERROR_CODES.unavailable,
        "chrome.storage.local을 사용할 수 없어요."
      );
    }
    try {
      return await global.chrome.storage.local.get(keys);
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        throw createStorageAccessError(
          STORAGE_ERROR_CODES.invalidated,
          "Extension context invalidated. 확장프로그램이 갱신되어 저장소에 접근할 수 없어요.",
          error
        );
      }
      throw error;
    }
  }

  async function setLocal(partial) {
    if (!global.chrome?.storage?.local) {
      throw createStorageAccessError(
        STORAGE_ERROR_CODES.unavailable,
        "chrome.storage.local을 사용할 수 없어요."
      );
    }
    try {
      await global.chrome.storage.local.set(partial);
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) {
        throw createStorageAccessError(
          STORAGE_ERROR_CODES.invalidated,
          "Extension context invalidated. 확장프로그램이 갱신되어 저장소에 저장할 수 없어요.",
          error
        );
      }
      throw error;
    }
  }

  async function getState() {
    return getLocal(defaults);
  }

  async function updateSettings(partialSettings) {
    const current = await getState();
    const nextSettings = {
      ...defaults.settings,
      ...(current.settings || {}),
      ...partialSettings,
    };
    await setLocal({ settings: nextSettings });
    return nextSettings;
  }

  async function setSessionPaused(sessionId, paused) {
    const current = await getState();
    const next = { ...(current.pausedSessions || {}) };
    if (!sessionId) {
      return next;
    }

    if (paused) {
      next[sessionId] = true;
    } else {
      delete next[sessionId];
    }

    await setLocal({ pausedSessions: next });
    return next;
  }

  async function updateUiPreferences(partialPreferences) {
    const current = await getState();
    const nextUiPreferences = mergeUiPreferences(current.uiPreferences, partialPreferences);
    await setLocal({ uiPreferences: nextUiPreferences });
    return nextUiPreferences;
  }

  async function getCloudSyncState() {
    const current = await getState();
    return namespace.cloudSync.mergeCloudSyncState(current.cloudSync);
  }

  async function getReleaseInfo() {
    const current = await getState();
    return namespace.releaseInfo.mergeReleaseInfo(current.releaseInfo);
  }

  async function getMeetingHub() {
    const current = await getState();
    const nextHub = current.meetingHub && typeof current.meetingHub === "object"
      ? current.meetingHub
      : defaults.meetingHub;
    return {
      ...cloneValue(defaults.meetingHub),
      ...cloneValue(nextHub),
      items: Array.isArray(nextHub?.items) ? cloneValue(nextHub.items) : [],
    };
  }

  async function getMeetingStateByMeetingId() {
    const current = await getState();
    const nextState = current.meetingStateByMeetingId;
    return nextState && typeof nextState === "object"
      ? cloneValue(nextState)
      : cloneValue(defaults.meetingStateByMeetingId);
  }

  async function setCloudSyncState(nextCloudSync) {
    const cloudSync = namespace.cloudSync.mergeCloudSyncState(nextCloudSync);
    await setLocal({ cloudSync });
    return cloudSync;
  }

  async function setReleaseInfo(nextReleaseInfo) {
    const releaseInfo = namespace.releaseInfo.mergeReleaseInfo(nextReleaseInfo);
    await setLocal({ releaseInfo });
    return releaseInfo;
  }

  async function setMeetingHub(nextMeetingHub) {
    const meetingHub = {
      ...cloneValue(defaults.meetingHub),
      ...(nextMeetingHub && typeof nextMeetingHub === "object" ? cloneValue(nextMeetingHub) : {}),
      items: Array.isArray(nextMeetingHub?.items) ? cloneValue(nextMeetingHub.items) : [],
    };
    await setLocal({ meetingHub });
    return meetingHub;
  }

  async function markPromptLibrarySynced(providerIdentity, syncedAt) {
    const current = await getCloudSyncState();
    const cloudSync = namespace.cloudSync.markPromptLibrarySynced(current, providerIdentity, syncedAt);
    await setLocal({ cloudSync });
    return cloudSync;
  }

  async function setPromptSyncError(errorMessage, providerIdentity, options = {}) {
    const current = await getCloudSyncState();
    const cloudSync = namespace.cloudSync.setPromptSyncError(current, errorMessage, providerIdentity, options);
    await setLocal({ cloudSync });
    return cloudSync;
  }

  async function setPromptSyncDegraded(errorMessage, providerIdentity, options = {}) {
    const current = await getCloudSyncState();
    const cloudSync = namespace.cloudSync.setPromptSyncDegraded(current, errorMessage, providerIdentity, options);
    await setLocal({ cloudSync });
    return cloudSync;
  }

  async function recordPromptLibraryRemoteState(remoteState, providerIdentity, options = {}) {
    const current = await getCloudSyncState();
    const cloudSync = namespace.cloudSync.recordPromptLibraryRemoteState(current, remoteState, providerIdentity, options);
    await setLocal({ cloudSync });
    return cloudSync;
  }

  async function getPromptLibrary() {
    const current = await getState();
    return namespace.promptLibrary.mergePromptLibrary(current.promptLibrary);
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
    await setLocal({ promptLibrary });
    return promptLibrary;
  }

  async function clearPromptPublication(promptId) {
    const current = await getPromptLibrary();
    const promptLibrary = namespace.promptLibrary.clearPromptPublication(current, promptId);
    await setLocal({ promptLibrary });
    return promptLibrary;
  }

  async function buildPromptSyncDocument() {
    const [promptLibrary, cloudSync] = await Promise.all([getPromptLibrary(), getCloudSyncState()]);
    return namespace.cloudSync.buildPromptSyncDocument(promptLibrary, cloudSync);
  }

  async function hydratePromptLibraryFromCloud(nextPromptLibrary, providerIdentity, syncedAt) {
    const promptLibrary = namespace.promptLibrary.mergePromptLibrary(nextPromptLibrary);
    const currentCloudSync = await getCloudSyncState();
    const cloudSync = namespace.cloudSync.markPromptLibrarySynced(currentCloudSync, providerIdentity, syncedAt);
    await setLocal({ cloudSync, promptLibrary });
    return { cloudSync, promptLibrary };
  }

  function mergeUiPreferences(...preferenceSets) {
    return preferenceSets.reduce(
      (merged, nextPreferences) => ({
        ...merged,
        ...(nextPreferences || {}),
        handleRatios: {
          ...merged.handleRatios,
          ...((nextPreferences || {}).handleRatios || {}),
        },
      }),
      {
        ...defaults.uiPreferences,
        handleRatios: { ...(defaults.uiPreferences.handleRatios || {}) },
      }
    );
  }

  function getViewportBucket(width = global.innerWidth) {
    return Number(width) <= 1280 ? "compact" : "wide";
  }

  function normalizeHandleRatio(value, bucket = getViewportBucket()) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return defaults.uiPreferences.handleRatios[bucket];
    }
    return Math.min(1, Math.max(0, number));
  }

  function getHandleRatio(uiPreferences, width = global.innerWidth) {
    const bucket = getViewportBucket(width);
    const ratios = mergeUiPreferences(uiPreferences).handleRatios || {};
    return normalizeHandleRatio(ratios[bucket], bucket);
  }

  async function persistPromptLibrary(nextPromptLibrary, reason, operation) {
    const promptLibrary = namespace.promptLibrary.mergePromptLibrary(nextPromptLibrary);
    const currentCloudSync = await getCloudSyncState();
    const providerIdentity = namespace.providerIdentity.getCurrent();
    const cloudSync = namespace.cloudSync.queuePromptLibrarySyncOperation(
      currentCloudSync,
      reason,
      providerIdentity,
      promptLibrary,
      operation
    );
    await setLocal({ cloudSync, promptLibrary });
    return { cloudSync, promptLibrary };
  }

  namespace.storage = {
    buildPromptSyncDocument,
    getCloudSyncState,
    getHandleRatio,
    getMeetingHub,
    getMeetingStateByMeetingId,
    getPromptLibrary,
    getReleaseInfo,
    getState,
    getViewportBucket,
    hydratePromptLibraryFromCloud,
    importStorePrompt,
    importPromptLibrary,
    markPromptLibrarySynced,
    markPromptPublished,
    mergeUiPreferences,
    movePromptItem,
    normalizeHandleRatio,
    recordPromptLibraryRemoteState,
    clearPromptPublication,
    removePromptItem,
    savePromptItem,
    setCloudSyncState,
    setLocal,
    setMeetingHub,
    setPromptSyncDegraded,
    setPromptSyncError,
    setPromptLibrary,
    setReleaseInfo,
    setSessionPaused,
    updateUiPreferences,
    updateSettings,
    STORAGE_ERROR_CODES,
    isStorageAccessError,
  };

  function createStorageAccessError(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause !== undefined) {
      error.cause = cause;
    }
    return error;
  }

  function isStorageAccessError(error, code = "") {
    if (!error || typeof error !== "object") {
      return false;
    }
    const currentCode = String(error.code || "").trim();
    return code ? currentCode === code : Boolean(currentCode && Object.values(STORAGE_ERROR_CODES).includes(currentCode));
  }

  function isExtensionContextInvalidatedError(error) {
    const message = namespace.session?.normalizeText
      ? namespace.session.normalizeText(error instanceof Error ? error.message : String(error || ""))
      : String(error || "").trim();
    return message.toLowerCase().includes("extension context invalidated");
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
})(globalThis);
