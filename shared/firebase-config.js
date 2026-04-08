(function initFirebaseConfig(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const PROMPT_PANEL_BRIDGE_CACHE_TOKEN = "20260402-1";
  const FUNCTION_ENDPOINTS = {
    authorizeInovaMeetingWorkspaceAccessUrl: "authorizeInovaMeetingWorkspaceAccess",
    createInovaMeetingShareLinkUrl: "createInovaMeetingShareLink",
    deleteInovaMeetingUrl: "deleteInovaMeeting",
    deleteInovaMeetingResultUrl: "deleteInovaMeetingResult",
    exchangeInovaMeetingLaunchUrl: "exchangeInovaMeetingLaunch",
    issueInovaMeetingLaunchUrl: "issueInovaMeetingLaunch",
    issueInovaMeetingPanelAuthUrl: "issueInovaMeetingPanelAuth",
    issueInovaPromptPanelAuthUrl: "issueInovaPromptPanelAuth",
    issueInovaMeetingWorkspaceAuthUrl: "issueInovaMeetingWorkspaceAuth",
    listInovaMeetingsUrl: "listInovaMeetings",
    uploadInovaMeetingSourceUrl: "uploadInovaMeetingSource",
    updateInovaMeetingUrl: "updateInovaMeeting",
    updateInovaMeetingResultUrl: "updateInovaMeetingResult",
    loadInovaPromptLibraryUrl: "loadInovaPromptLibrary",
    listPromptStoreEntriesUrl: "listPromptStoreEntries",
    peekInovaPromptLibraryUrl: "peekInovaPromptLibrary",
    reviewInovaPromptUrl: "reviewInovaPrompt",
    publishPromptToStoreUrl: "publishPromptToStore",
    unpublishPromptFromStoreUrl: "unpublishPromptFromStore",
    importPromptStoreEntryUrl: "importPromptStoreEntry",
    revokeInovaMeetingShareLinkUrl: "revokeInovaMeetingShareLink",
    togglePromptStoreLikeUrl: "togglePromptStoreLike",
    recordPromptStoreViewUrl: "recordPromptStoreView",
    syncInovaPromptLibraryUrl: "syncInovaPromptLibrary",
  };
  const HOSTING_ENDPOINTS = {
    latestReleaseUrl: "releases/latest.json",
    releaseHistoryUrl: "releases/history.json",
  };
  const DEFAULT_WEB_CONFIG = {
    apiKey: "AIzaSyDnVS7MmQs7wWjVPihr1MNmcALxJ0a1qPM",
    appId: "1:1027279095019:web:755f1f1a02cbae0d262aae",
    authDomain: "browser-extension-main.firebaseapp.com",
    messagingSenderId: "1027279095019",
    projectId: "browser-extension-main",
    storageBucket: "browser-extension-main.firebasestorage.app",
  };

  namespace.firebaseConfig = buildFirebaseConfig(global.__INOVA_FIREBASE_CONFIG_OVERRIDE__);

  function buildFirebaseConfig(overrideConfig) {
    const override = overrideConfig && typeof overrideConfig === "object" ? overrideConfig : {};
    const activeLane = namespace.productLane?.getActiveLane?.() || "legacy";
    const laneConfig = namespace.productLane?.getLaneConfig?.(activeLane) || {
      functions: { baseUrl: "", endpointOverrides: {} },
      hosting: { baseUrl: "", originUrl: "" },
      id: activeLane,
      prompt: {
        firestoreCollections: {
          accountsCollection: "integration_inova_accounts",
          storeDetailCollection: "prompt_store_entry_details",
          storeFeedCollection: "prompt_store_feed_pages",
          storeSummaryCollection: "prompt_store_meta",
        },
        panelScope: "prompt-panel",
      },
      storagePrefix: "",
    };

    return {
      activeLane: laneConfig.id,
      project: {
        displayName: "browser-extension",
        projectId: DEFAULT_WEB_CONFIG.projectId,
        region: "asia-northeast3",
        ...(override.project || {}),
      },
      functions: buildFunctionsConfig(
        laneConfig.functions?.baseUrl,
        laneConfig.functions?.endpointOverrides,
        override.functions || {}
      ),
      hosting: buildHostingConfig(
        laneConfig.hosting?.baseUrl,
        laneConfig.hosting?.originUrl,
        override.hosting || {}
      ),
      prompt: buildPromptConfig(laneConfig.prompt, override.prompt || {}),
      storage: {
        prefix: normalizeText(laneConfig.storagePrefix),
      },
      web: buildWebConfig(laneConfig.web || {}, override.web || {}),
    };
  }

  function buildFunctionsConfig(defaultBaseUrl, endpointOverrides = {}, overrideConfig = {}) {
    const baseUrl = normalizeBaseUrl(overrideConfig.baseUrl || defaultBaseUrl);
    const endpointMap = {
      ...FUNCTION_ENDPOINTS,
      ...(endpointOverrides && typeof endpointOverrides === "object" ? endpointOverrides : {}),
      ...(overrideConfig.endpointPaths && typeof overrideConfig.endpointPaths === "object" ? overrideConfig.endpointPaths : {}),
    };
    return buildUrlConfig(
      {
        region: "asia-northeast3",
        baseUrl,
      },
      endpointMap,
      baseUrl,
      overrideConfig
    );
  }

  function buildHostingConfig(defaultBaseUrl, defaultOriginUrl, overrideConfig = {}) {
    const baseUrl = normalizeBaseUrl(overrideConfig.baseUrl || defaultBaseUrl);
    const originUrl = normalizeOriginUrl(overrideConfig.originUrl || defaultOriginUrl || baseUrl);
    const promptPanelBridgeAssetVersion = normalizeText(
      overrideConfig.promptPanelBridgeAssetVersion
      || [readRuntimeManifestVersion(), PROMPT_PANEL_BRIDGE_CACHE_TOKEN].filter(Boolean).join("-")
    );
    const endpointMap = {
      ...HOSTING_ENDPOINTS,
      ...(overrideConfig.endpointPaths && typeof overrideConfig.endpointPaths === "object" ? overrideConfig.endpointPaths : {}),
    };
    return buildUrlConfig(
      {
        baseUrl,
        meetingPanelBridgeUrl: joinUrl(originUrl, "meeting/panel-bridge.html"),
        meetingWorkspaceUrl: joinUrl(originUrl, "meeting/index.html"),
        promptPanelBridgeAssetVersion,
        promptPanelBridgeUrl: appendQueryParam(joinUrl(baseUrl, "prompt-panel-bridge.html"), "v", promptPanelBridgeAssetVersion),
        originUrl,
      },
      endpointMap,
      baseUrl,
      overrideConfig
    );
  }

  function buildPromptConfig(defaultPromptConfig = {}, overrideConfig = {}) {
    const defaultCollections = defaultPromptConfig.firestoreCollections || {};
    return {
      firestoreCollections: {
        accountsCollection: normalizeText(overrideConfig?.firestoreCollections?.accountsCollection || defaultCollections.accountsCollection) || "integration_inova_accounts",
        storeDetailCollection: normalizeText(overrideConfig?.firestoreCollections?.storeDetailCollection || defaultCollections.storeDetailCollection) || "prompt_store_entry_details",
        storeFeedCollection: normalizeText(overrideConfig?.firestoreCollections?.storeFeedCollection || defaultCollections.storeFeedCollection) || "prompt_store_feed_pages",
        storeSummaryCollection: normalizeText(overrideConfig?.firestoreCollections?.storeSummaryCollection || defaultCollections.storeSummaryCollection) || "prompt_store_meta",
      },
      panelScope: normalizeText(overrideConfig.panelScope || defaultPromptConfig.panelScope) || "prompt-panel",
    };
  }

  function buildWebConfig(defaultConfig = {}, overrideConfig = {}) {
    return {
      ...DEFAULT_WEB_CONFIG,
      ...(defaultConfig || {}),
      ...(overrideConfig || {}),
    };
  }

  function buildUrlConfig(baseConfig, endpointMap, baseUrl, overrideConfig) {
    const config = {
      ...baseConfig,
    };

    for (const [configKey, endpointPath] of Object.entries(endpointMap || {})) {
      config[configKey] = joinUrl(baseUrl, endpointPath);
    }

    return {
      ...config,
      ...(overrideConfig || {}),
      baseUrl,
    };
  }

  function joinUrl(baseUrl, pathName) {
    return `${normalizeBaseUrl(baseUrl)}/${String(pathName || "").replace(/^\/+/, "")}`;
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeBaseUrl(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function normalizeOriginUrl(value) {
    const normalized = normalizeBaseUrl(value);
    try {
      return new URL(normalized).origin;
    } catch {
      return normalized;
    }
  }

  function readRuntimeManifestVersion() {
    try {
      return normalizeText(global.chrome?.runtime?.getManifest?.()?.version);
    } catch {
      return "";
    }
  }

  function appendQueryParam(url, key, value) {
    const normalizedUrl = String(url || "");
    const normalizedKey = String(key || "").trim();
    const normalizedValue = String(value || "").trim();
    if (!normalizedUrl || !normalizedKey || !normalizedValue) {
      return normalizedUrl;
    }
    const separator = normalizedUrl.includes("?") ? "&" : "?";
    return `${normalizedUrl}${separator}${encodeURIComponent(normalizedKey)}=${encodeURIComponent(normalizedValue)}`;
  }
})(globalThis);
