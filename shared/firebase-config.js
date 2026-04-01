(function initFirebaseConfig(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const DEFAULT_FUNCTIONS_BASE_URL = "https://asia-northeast3-browser-extension-main.cloudfunctions.net";
  const DEFAULT_HOSTING_BASE_URL = "https://browser-extension-main.web.app/extension";
  const DEFAULT_HOSTING_ORIGIN = "https://browser-extension-main.web.app";
  const FUNCTION_ENDPOINTS = {
    createInovaMeetingJobUrl: "createInovaMeetingJob",
    deleteInovaMeetingUrl: "deleteInovaMeeting",
    deleteInovaMeetingResultUrl: "deleteInovaMeetingResult",
    exchangeInovaMeetingLaunchUrl: "exchangeInovaMeetingLaunch",
    getInovaMeetingArtifactUrl: "getInovaMeetingArtifact",
    getInovaMeetingJobUrl: "getInovaMeetingJob",
    issueInovaMeetingLaunchUrl: "issueInovaMeetingLaunch",
    listInovaMeetingsUrl: "listInovaMeetings",
    listInovaMeetingResultsUrl: "listInovaMeetingResults",
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
    return buildUrlConfig(
      {
        baseUrl,
        meetingWorkspaceUrl: joinUrl(originUrl, "meeting/index.html"),
        originUrl,
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

  function normalizeOriginUrl(value) {
    const normalized = normalizeBaseUrl(value);
    try {
      return new URL(normalized).origin;
    } catch {
      return normalized;
    }
  }
})(globalThis);
