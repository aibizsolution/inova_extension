(function initProductLane(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const LEGACY_LANE = "legacy";
  const V2_LANE = "v2";
  const DEFAULT_FUNCTIONS_BASE_URL = "https://asia-northeast3-browser-extension-main.cloudfunctions.net";
  const DEFAULT_LEGACY_HOSTING_ORIGIN = "https://browser-extension-main.web.app";
  const DEFAULT_V2_HOSTING_ORIGIN = "https://browser-extension-v2.web.app";
  const DEFAULT_LEGACY_HOSTING_BASE_URL = `${DEFAULT_LEGACY_HOSTING_ORIGIN}/extension`;
  const DEFAULT_V2_HOSTING_BASE_URL = `${DEFAULT_V2_HOSTING_ORIGIN}/extension-v2`;
  const KNOWN_LANES = Object.freeze([LEGACY_LANE, V2_LANE]);
  const STORAGE_PREFIX_BY_LANE = Object.freeze({
    [LEGACY_LANE]: "",
    [V2_LANE]: "v2.",
  });
  const KNOWN_HOSTING_ORIGINS = Object.freeze([
    DEFAULT_LEGACY_HOSTING_ORIGIN,
    DEFAULT_V2_HOSTING_ORIGIN,
    "http://127.0.0.1:5000",
    "http://localhost:5000",
  ]);
  const LANE_CONFIGS = Object.freeze({
    [LEGACY_LANE]: Object.freeze({
      functions: Object.freeze({
        baseUrl: DEFAULT_FUNCTIONS_BASE_URL,
        endpointOverrides: Object.freeze({}),
      }),
      hosting: Object.freeze({
        baseUrl: DEFAULT_LEGACY_HOSTING_BASE_URL,
        originUrl: DEFAULT_LEGACY_HOSTING_ORIGIN,
      }),
      prompt: Object.freeze({
        firestoreCollections: Object.freeze({
          accountsCollection: "integration_inova_accounts",
          storeDetailCollection: "prompt_store_entry_details",
          storeFeedCollection: "prompt_store_feed_pages",
          storeSummaryCollection: "prompt_store_meta",
        }),
        panelScope: "prompt-panel",
      }),
      storagePrefix: STORAGE_PREFIX_BY_LANE[LEGACY_LANE],
    }),
    [V2_LANE]: Object.freeze({
      functions: Object.freeze({
        baseUrl: DEFAULT_FUNCTIONS_BASE_URL,
        endpointOverrides: Object.freeze({
          authorizeInovaMeetingWorkspaceAccessUrl: "authorizeInovaMeetingWorkspaceAccessV2",
          createInovaMeetingShareLinkUrl: "createInovaMeetingShareLinkV2",
          deleteInovaMeetingResultUrl: "deleteInovaMeetingResultV2",
          deleteInovaMeetingUrl: "deleteInovaMeetingV2",
          exchangeInovaMeetingLaunchUrl: "exchangeInovaMeetingLaunchV2",
          issueInovaMeetingLaunchUrl: "issueInovaMeetingLaunchV2",
          issueInovaMeetingPanelAuthUrl: "issueInovaMeetingPanelAuthV2",
          issueInovaMeetingWorkspaceAuthUrl: "issueInovaMeetingWorkspaceAuthV2",
          issueInovaPromptPanelAuthUrl: "issueInovaPromptPanelAuthV2",
          listInovaMeetingsUrl: "listInovaMeetingsV2",
          loadInovaPromptLibraryUrl: "loadInovaPromptLibraryV2",
          peekInovaPromptLibraryUrl: "peekInovaPromptLibraryV2",
          revokeInovaMeetingShareLinkUrl: "revokeInovaMeetingShareLinkV2",
          syncInovaPromptLibraryUrl: "syncInovaPromptLibraryV2",
          updateInovaMeetingResultUrl: "updateInovaMeetingResultV2",
          updateInovaMeetingUrl: "updateInovaMeetingV2",
          uploadInovaMeetingSourceUrl: "uploadInovaMeetingSourceV2",
        }),
      }),
      hosting: Object.freeze({
        baseUrl: DEFAULT_V2_HOSTING_BASE_URL,
        originUrl: DEFAULT_V2_HOSTING_ORIGIN,
      }),
      prompt: Object.freeze({
        firestoreCollections: Object.freeze({
          accountsCollection: "integration_inova_accounts_v2",
          storeDetailCollection: "prompt_store_entry_details",
          storeFeedCollection: "prompt_store_feed_pages",
          storeSummaryCollection: "prompt_store_meta",
        }),
        panelScope: "prompt-panel-v2",
      }),
      storagePrefix: STORAGE_PREFIX_BY_LANE[V2_LANE],
    }),
  });

  namespace.productLane = {
    buildStorageKey,
    getActiveLane,
    getKnownHostingOrigins,
    getKnownLanes,
    getLaneConfig,
    getStorageChange,
    getStorageKeyMap,
    isLegacyLane,
    isV2Lane,
    normalizeLane,
    readManifestVersion,
  };

  function normalizeLane(value) {
    return String(value || "").trim().toLowerCase() === V2_LANE ? V2_LANE : LEGACY_LANE;
  }

  function isLegacyLane(value = getActiveLane()) {
    return normalizeLane(value) === LEGACY_LANE;
  }

  function isV2Lane(value = getActiveLane()) {
    return normalizeLane(value) === V2_LANE;
  }

  function readManifestVersion() {
    try {
      return String(global.chrome?.runtime?.getManifest?.()?.version || "").trim();
    } catch {
      return "";
    }
  }

  function parseManifestMajorVersion(version) {
    const [major] = String(version || "").split(".");
    const parsed = Number.parseInt(major, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function getActiveLane() {
    const rawOverride = typeof global.__INOVA_PRODUCT_LANE_OVERRIDE__ === "string"
      ? global.__INOVA_PRODUCT_LANE_OVERRIDE__
      : "";
    const explicitOverride = normalizeLane(rawOverride);
    if (rawOverride.trim()) {
      return explicitOverride;
    }
    return parseManifestMajorVersion(readManifestVersion()) >= 1 ? V2_LANE : LEGACY_LANE;
  }

  function getLaneConfig(lane = getActiveLane()) {
    const resolvedLane = normalizeLane(lane);
    const laneConfig = LANE_CONFIGS[resolvedLane] || LANE_CONFIGS[LEGACY_LANE];
    return cloneValue({
      id: resolvedLane,
      ...laneConfig,
    });
  }

  function buildStorageKey(baseKey, lane = getActiveLane()) {
    const normalizedBaseKey = String(baseKey || "").trim();
    const storagePrefix = STORAGE_PREFIX_BY_LANE[normalizeLane(lane)] || "";
    return normalizedBaseKey ? `${storagePrefix}${normalizedBaseKey}` : "";
  }

  function getStorageKeyMap(storageKeys, lane = getActiveLane()) {
    const output = {};
    for (const [name, baseKey] of Object.entries(storageKeys || {})) {
      output[name] = buildStorageKey(baseKey, lane);
    }
    return output;
  }

  function getStorageChange(changes, baseKey, lane = getActiveLane()) {
    const storageKey = buildStorageKey(baseKey, lane);
    return storageKey ? changes?.[storageKey] || null : null;
  }

  function getKnownHostingOrigins() {
    return KNOWN_HOSTING_ORIGINS.slice();
  }

  function getKnownLanes() {
    return KNOWN_LANES.slice();
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
})(globalThis);
