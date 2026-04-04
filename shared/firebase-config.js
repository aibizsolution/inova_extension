(function initFirebaseConfig(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const DEFAULT_FUNCTIONS_BASE_URL = "https://asia-northeast3-browser-extension-main.cloudfunctions.net";
  const DEFAULT_HOSTING_BASE_URL = "https://browser-extension-main.web.app/extension";
  const DEFAULT_HOSTING_ORIGIN = "https://browser-extension-main.web.app";
  const PROMPT_PANEL_BRIDGE_CACHE_TOKEN = "20260402-1";
  const FUNCTION_ENDPOINTS = {
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
    togglePromptStoreLikeUrl: "togglePromptStoreLike",
    recordPromptStoreViewUrl: "recordPromptStoreView",
    syncInovaPromptLibraryUrl: "syncInovaPromptLibrary",
  };
  const HOSTING_ENDPOINTS = {
    latestReleaseUrl: "releases/latest.json",
    releaseHistoryUrl: "releases/history.json",
  };

  namespace.firebaseConfig = mergeConfig({
    project: {
      displayName: "browser-extension",
      projectId: "browser-extension-main",
      region: "asia-northeast3",
    },
    functions: buildFunctionsConfig(DEFAULT_FUNCTIONS_BASE_URL),
    hosting: buildHostingConfig(DEFAULT_HOSTING_BASE_URL, DEFAULT_HOSTING_ORIGIN),
    web: buildWebConfig(),
  }, global.__INOVA_FIREBASE_CONFIG_OVERRIDE__);

  function mergeConfig(baseConfig, overrideConfig) {
    const override = overrideConfig && typeof overrideConfig === "object" ? overrideConfig : {};
    return {
      project: {
        ...baseConfig.project,
        ...(override.project || {}),
      },
      functions: buildFunctionsConfig(baseConfig.functions.baseUrl, override.functions || {}),
      hosting: buildHostingConfig(baseConfig.hosting.baseUrl, baseConfig.hosting.originUrl, override.hosting || {}),
      web: buildWebConfig(override.web || {}),
    };
  }

  function buildFunctionsConfig(defaultBaseUrl, overrideConfig = {}) {
    const baseUrl = normalizeBaseUrl(overrideConfig.baseUrl || defaultBaseUrl);
    return buildUrlConfig(
      {
        region: "asia-northeast3",
        baseUrl,
      },
      FUNCTION_ENDPOINTS,
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
    return buildUrlConfig(
      {
        baseUrl,
        meetingPanelBridgeUrl: joinUrl(originUrl, "meeting/panel-bridge.html"),
        meetingWorkspaceUrl: joinUrl(originUrl, "meeting/index.html"),
        promptPanelBridgeAssetVersion,
        promptPanelBridgeUrl: appendQueryParam(joinUrl(baseUrl, "prompt-panel-bridge.html"), "v", promptPanelBridgeAssetVersion),
        originUrl,
      },
      HOSTING_ENDPOINTS,
      baseUrl,
      overrideConfig
    );
  }

  function buildWebConfig(overrideConfig = {}) {
    return {
      apiKey: "AIzaSyDnVS7MmQs7wWjVPihr1MNmcALxJ0a1qPM",
      appId: "1:1027279095019:web:755f1f1a02cbae0d262aae",
      authDomain: "browser-extension-main.firebaseapp.com",
      messagingSenderId: "1027279095019",
      projectId: "browser-extension-main",
      storageBucket: "browser-extension-main.firebasestorage.app",
      ...(overrideConfig || {}),
    };
  }

  function buildUrlConfig(baseConfig, endpointMap, baseUrl, overrideConfig) {
    const config = {
      ...baseConfig,
    };

    for (const [configKey, endpointPath] of Object.entries(endpointMap)) {
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
