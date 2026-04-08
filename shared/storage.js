(function initStorage(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { defaults, storageKeys } = namespace.constants;
  const activeLane = namespace.productLane?.getActiveLane?.() || "legacy";
  const activeStorageKeyMap = namespace.productLane?.getStorageKeyMap?.(storageKeys, activeLane) || storageKeys;
  const legacyStorageKeyMap = namespace.productLane?.getStorageKeyMap?.(storageKeys, "legacy") || storageKeys;
  const STORAGE_ERROR_CODES = {
    unavailable: "storage-unavailable",
    invalidated: "extension-context-invalidated",
  };
  let productLaneMigrationPromise = null;

  async function getRawLocal(keys) {
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

  async function setRawLocal(partial) {
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
    await ensureProductLaneLocalMigration();
    const rawState = await getRawLocal(Object.values(activeStorageKeyMap));
    return buildCanonicalState(rawState, activeStorageKeyMap);
  }

  async function setLocal(partial) {
    await ensureProductLaneLocalMigration();
    const nextPartial = buildCanonicalPartial(partial, activeStorageKeyMap);
    await setRawLocal(nextPartial);
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

  async function ensureProductLaneLocalMigration() {
    if (activeLane !== "v2") {
      return namespace.constants.defaults.productLaneMigration;
    }
    if (productLaneMigrationPromise) {
      return productLaneMigrationPromise;
    }
    productLaneMigrationPromise = migrateLegacyLocalStateForV2();
    try {
      return await productLaneMigrationPromise;
    } finally {
      productLaneMigrationPromise = null;
    }
  }

  async function getProductLaneMigrationState() {
    const state = await getState();
    return mergeProductLaneMigrationState(state.productLaneMigration);
  }

  async function migrateLegacyLocalStateForV2() {
    const migrationStorageKey = activeStorageKeyMap.productLaneMigration;
    const rawState = await getRawLocal([
      ...Object.values(activeStorageKeyMap),
      ...Object.values(legacyStorageKeyMap),
    ]);
    const currentMigration = mergeProductLaneMigrationState(rawState[migrationStorageKey]);
    if (currentMigration.completedAt) {
      return currentMigration;
    }

    const startedAt = currentMigration.startedAt || new Date().toISOString();
    const attemptCount = Math.max(0, Number(currentMigration.attemptCount) || 0) + 1;
    const startedMigration = mergeProductLaneMigrationState({
      ...currentMigration,
      attemptCount,
      lastError: "",
      sourceLane: "legacy",
      startedAt,
      targetLane: "v2",
    });

    try {
      await setRawLocal({ [migrationStorageKey]: startedMigration });
      const hasV2Data = hasStoredLaneData(rawState, activeStorageKeyMap);
      const copiedState = buildLegacyMigrationPayload(rawState);
      const nextMigration = mergeProductLaneMigrationState({
        ...startedMigration,
        completedAt: new Date().toISOString(),
        lastError: "",
        sourceRevision: inferLegacySourceRevision(rawState),
      });
      await setRawLocal({
        ...(hasV2Data ? {} : copiedState),
        [migrationStorageKey]: nextMigration,
      });
      return nextMigration;
    } catch (error) {
      const failedMigration = mergeProductLaneMigrationState({
        ...startedMigration,
        lastError: error instanceof Error ? error.message : String(error || ""),
      });
      await setRawLocal({ [migrationStorageKey]: failedMigration }).catch(() => {});
      throw error;
    }
  }

  function hasStoredLaneData(rawState, keyMap) {
    return Object.entries(storageKeys).some(([name, baseKey]) => {
      if (name === "productLaneMigration") {
        return false;
      }
      const actualStorageKey = keyMap[name] || baseKey;
      return Object.prototype.hasOwnProperty.call(rawState || {}, actualStorageKey);
    });
  }

  function buildLegacyMigrationPayload(rawState) {
    const nextState = {};
    for (const [name, baseKey] of Object.entries(storageKeys)) {
      if (name === "productLaneMigration") {
        continue;
      }
      const legacyStorageKey = legacyStorageKeyMap[name] || baseKey;
      const nextStorageKey = activeStorageKeyMap[name] || baseKey;
      if (!Object.prototype.hasOwnProperty.call(rawState || {}, legacyStorageKey)) {
        continue;
      }
      nextState[nextStorageKey] = cloneValue(rawState[legacyStorageKey]);
    }
    return nextState;
  }

  function inferLegacySourceRevision(rawState) {
    const legacyReleaseKey = legacyStorageKeyMap.releaseInfo || "releaseInfo";
    const releaseInfo = namespace.releaseInfo?.mergeReleaseInfo
      ? namespace.releaseInfo.mergeReleaseInfo(rawState?.[legacyReleaseKey])
      : rawState?.[legacyReleaseKey] || {};
    const version = normalizeText(
      releaseInfo?.checkedForVersion
      || releaseInfo?.latest?.version
      || releaseInfo?.history?.[0]?.version
    );
    return version || "legacy-local-empty";
  }

  function buildCanonicalState(rawState, keyMap) {
    const nextState = cloneValue(defaults);
    for (const [name, baseKey] of Object.entries(storageKeys)) {
      const actualStorageKey = keyMap[name] || baseKey;
      if (!Object.prototype.hasOwnProperty.call(rawState || {}, actualStorageKey)) {
        continue;
      }
      nextState[name] = cloneValue(rawState[actualStorageKey]);
    }
    nextState.productLaneMigration = mergeProductLaneMigrationState(nextState.productLaneMigration);
    return nextState;
  }

  function buildCanonicalPartial(partial, keyMap) {
    const nextPartial = {};
    for (const [name, value] of Object.entries(partial || {})) {
      if (!Object.prototype.hasOwnProperty.call(storageKeys, name)) {
        continue;
      }
      const actualStorageKey = keyMap[name] || storageKeys[name];
      nextPartial[actualStorageKey] = cloneValue(value);
    }
    return nextPartial;
  }

  function mergeProductLaneMigrationState(nextState) {
    return {
      ...cloneValue(defaults.productLaneMigration),
      ...(nextState && typeof nextState === "object" ? cloneValue(nextState) : {}),
      attemptCount: Math.max(0, Number(nextState?.attemptCount) || 0),
      completedAt: normalizeText(nextState?.completedAt),
      lastError: normalizeText(nextState?.lastError),
      sourceLane: normalizeText(nextState?.sourceLane),
      sourceRevision: normalizeText(nextState?.sourceRevision),
      startedAt: normalizeText(nextState?.startedAt),
      targetLane: normalizeText(nextState?.targetLane),
      version: Math.max(1, Number(nextState?.version) || 1),
    };
  }

  namespace.storage = {
    buildPromptSyncDocument,
    ensureProductLaneLocalMigration,
    getCloudSyncState,
    getHandleRatio,
    getMeetingHub,
    getMeetingStateByMeetingId,
    getProductLaneMigrationState,
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

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
})(globalThis);
