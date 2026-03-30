(function initFirebaseConfig(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const DEFAULT_FUNCTIONS_BASE_URL = "https://asia-northeast3-browser-extension-main.cloudfunctions.net";
  const DEFAULT_HOSTING_BASE_URL = "https://browser-extension-main.web.app/extension";
  const FUNCTION_ENDPOINTS = {
    createInovaMeetingJobUrl: "createInovaMeetingJob",
    getInovaMeetingArtifactUrl: "getInovaMeetingArtifact",
    getInovaMeetingJobUrl: "getInovaMeetingJob",
    listInovaMeetingResultsUrl: "listInovaMeetingResults",
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
    hosting: buildHostingConfig(DEFAULT_HOSTING_BASE_URL),
  }, global.__INOVA_FIREBASE_CONFIG_OVERRIDE__);

  function mergeConfig(baseConfig, overrideConfig) {
    const override = overrideConfig && typeof overrideConfig === "object" ? overrideConfig : {};
    return {
      project: {
        ...baseConfig.project,
        ...(override.project || {}),
      },
      functions: buildFunctionsConfig(baseConfig.functions.baseUrl, override.functions || {}),
      hosting: buildHostingConfig(baseConfig.hosting.baseUrl, override.hosting || {}),
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

  function buildHostingConfig(defaultBaseUrl, overrideConfig = {}) {
    const baseUrl = normalizeBaseUrl(overrideConfig.baseUrl || defaultBaseUrl);
    return buildUrlConfig(
      {
        baseUrl,
      },
      HOSTING_ENDPOINTS,
      baseUrl,
      overrideConfig
    );
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

  function normalizeBaseUrl(value) {
    return String(value || "").replace(/\/+$/, "");
  }
})(globalThis);
