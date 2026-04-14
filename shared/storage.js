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

  async function setCloudSyncState(nextCloudSync) {
    const cloudSync = namespace.cloudSync.mergeCloudSyncState(nextCloudSync);
    await setLocal({ cloudSync });
    return cloudSync;
  }

  function mergeUiPreferences(...preferenceSets) {
    const merged = preferenceSets.reduce(
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
    if (merged.activeTool === "store") {
      merged.activeTool = "prompts";
      merged.activePromptTab = "store";
    }
    if (merged.activePromptTab !== "store" && merged.activePromptTab !== "review") {
      merged.activePromptTab = "library";
    }
    return merged;
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
    ensureProductLaneLocalMigration,
    getHandleRatio,
    getCloudSyncState,
    getProductLaneMigrationState,
    getState,
    getViewportBucket,
    mergeUiPreferences,
    normalizeHandleRatio,
    setCloudSyncState,
    setLocal,
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
