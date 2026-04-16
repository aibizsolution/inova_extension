(function initFunctionsRuntimeConfig(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const DEFAULT_FUNCTIONS_BASE_URL = "https://asia-northeast3-browser-extension-main.cloudfunctions.net";
  const LOCAL_RUNTIME_DEFAULTS = Object.freeze({
    authPort: 9099,
    firestorePort: 8080,
    functionsPort: 5001,
    host: "127.0.0.1",
    storagePort: 9199,
  });
  const BUNDLED_FUNCTIONS_MANIFEST = deepFreeze({
    endpointKeys: {
      authorizeInovaMeetingWorkspaceAccessUrl: {
        endpoint: "authorizeInovaMeetingWorkspaceAccess",
        method: "POST",
      },
      createInovaMeetingShareLinkUrl: {
        endpoint: "createInovaMeetingShareLink",
        method: "POST",
      },
      deleteInovaMeetingUrl: {
        endpoint: "deleteInovaMeeting",
        method: "POST",
      },
      deleteInovaMeetingResultUrl: {
        endpoint: "deleteInovaMeetingResult",
        method: "POST",
      },
      exchangeInovaMeetingLaunchUrl: {
        endpoint: "exchangeInovaMeetingLaunch",
        method: "POST",
      },
      issueInovaMeetingLaunchUrl: {
        endpoint: "issueInovaMeetingLaunch",
        method: "POST",
      },
      issueInovaMeetingPanelAuthUrl: {
        endpoint: "issueInovaMeetingPanelAuth",
        method: "POST",
      },
      issueInovaPromptPanelAuthUrl: {
        endpoint: "issueInovaPromptPanelAuth",
        method: "POST",
      },
      issueInovaMeetingWorkspaceAuthUrl: {
        endpoint: "issueInovaMeetingWorkspaceAuth",
        method: "POST",
      },
      listInovaMeetingsUrl: {
        endpoint: "listInovaMeetings",
        method: "POST",
      },
      moveInovaMeetingResultUrl: {
        endpoint: "moveInovaMeetingResult",
        method: "POST",
      },
      uploadInovaMeetingSourceUrl: {
        endpoint: "uploadInovaMeetingSource",
        method: "POST",
      },
      updateInovaMeetingUrl: {
        endpoint: "updateInovaMeeting",
        method: "POST",
      },
      updateInovaMeetingResultUrl: {
        endpoint: "updateInovaMeetingResult",
        method: "POST",
      },
      loadInovaPromptLibraryUrl: {
        endpoint: "loadInovaPromptLibrary",
        method: "POST",
      },
      listPromptStoreEntriesUrl: {
        endpoint: "listPromptStoreEntries",
        method: "POST",
      },
      peekInovaPromptLibraryUrl: {
        endpoint: "peekInovaPromptLibrary",
        method: "POST",
      },
      reviewInovaPromptUrl: {
        endpoint: "reviewInovaPrompt",
        method: "POST",
      },
      publishPromptToStoreUrl: {
        endpoint: "publishPromptToStore",
        method: "POST",
      },
      unpublishPromptFromStoreUrl: {
        endpoint: "unpublishPromptFromStore",
        method: "POST",
      },
      importPromptStoreEntryUrl: {
        endpoint: "importPromptStoreEntry",
        method: "POST",
      },
      revokeInovaMeetingShareLinkUrl: {
        endpoint: "revokeInovaMeetingShareLink",
        method: "POST",
      },
      togglePromptStoreLikeUrl: {
        endpoint: "togglePromptStoreLike",
        method: "POST",
      },
      recordPromptStoreViewUrl: {
        endpoint: "recordPromptStoreView",
        method: "POST",
      },
      syncInovaPromptLibraryUrl: {
        endpoint: "syncInovaPromptLibrary",
        method: "POST",
      },
    },
    lanes: {
      legacy: {
        baseUrl: DEFAULT_FUNCTIONS_BASE_URL,
        endpointOverrides: {},
      },
      v2: {
        baseUrl: DEFAULT_FUNCTIONS_BASE_URL,
        endpointOverrides: {
          issueInovaPromptPanelAuthUrl: "issueInovaPromptPanelAuthV2",
          loadInovaPromptLibraryUrl: "loadInovaPromptLibraryV2",
          peekInovaPromptLibraryUrl: "peekInovaPromptLibraryV2",
          syncInovaPromptLibraryUrl: "syncInovaPromptLibraryV2",
        },
      },
    },
    manifestVersion: "2026-04-bundled-functions-v1",
    minExtensionVersion: "1.0.0",
    schemaVersion: 1,
    targets: {
      local: {
        functionsPort: LOCAL_RUNTIME_DEFAULTS.functionsPort,
        host: LOCAL_RUNTIME_DEFAULTS.host,
        projectIdFallback: "browser-extension-main",
        regionFallback: "asia-northeast3",
      },
      production: {
        functionsBaseUrl: DEFAULT_FUNCTIONS_BASE_URL,
      },
    },
  });
  const FUNCTION_ENDPOINTS = Object.freeze(buildFunctionEndpointMap(BUNDLED_FUNCTIONS_MANIFEST.endpointKeys));
  const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
  const LANE_FUNCTION_OVERRIDES = Object.freeze({
    legacy: Object.freeze({
      baseUrl: BUNDLED_FUNCTIONS_MANIFEST.lanes.legacy.baseUrl,
      endpointOverrides: Object.freeze({ ...BUNDLED_FUNCTIONS_MANIFEST.lanes.legacy.endpointOverrides }),
    }),
    v2: Object.freeze({
      baseUrl: BUNDLED_FUNCTIONS_MANIFEST.lanes.v2.baseUrl,
      endpointOverrides: Object.freeze({ ...BUNDLED_FUNCTIONS_MANIFEST.lanes.v2.endpointOverrides }),
    }),
  });

  namespace.functionsRuntimeConfig = {
    getBundledCapabilityManifest,
    getDefaultFunctionsConfig,
    getMeetingFunctionsConfig,
    getMeetingRuntimeConfig,
    getPromptFunctionsConfig,
    getPromptRuntimeConfig,
    reconcileSettings,
  };

  function getBundledCapabilityManifest() {
    return cloneValue(BUNDLED_FUNCTIONS_MANIFEST);
  }

  function getDefaultFunctionsConfig() {
    const laneConfig = resolveLaneFunctionsConfig();
    return buildFunctionsConfig(laneConfig.baseUrl, laneConfig.endpointOverrides);
  }

  async function getMeetingFunctionsConfig(settings) {
    const runtimeConfig = await getMeetingRuntimeConfig(settings);
    return runtimeConfig?.functions || getDefaultFunctionsConfig();
  }

  async function getPromptFunctionsConfig(settings) {
    const runtimeConfig = await getPromptRuntimeConfig(settings);
    return runtimeConfig?.functions || getDefaultFunctionsConfig();
  }

  async function getPromptRuntimeConfig(settings) {
    const normalizedSettings = await reconcileSettings(settings);
    if (normalizedSettings.meetingWorkspaceTarget !== "local") {
      return buildProductionPromptRuntimeConfig(normalizedSettings);
    }
    return buildLocalPromptRuntimeConfig(normalizedSettings);
  }

  async function getMeetingRuntimeConfig(settings) {
    const normalizedSettings = await reconcileSettings(settings);
    if (normalizedSettings.meetingWorkspaceTarget !== "local") {
      return buildProductionMeetingRuntimeConfig(normalizedSettings);
    }

    const workspaceUrl = normalizeWorkspaceUrl(normalizedSettings);
    const workspaceOrigin = normalizeOriginUrl(workspaceUrl);
    const promptRuntimeConfig = buildLocalPromptRuntimeConfig(normalizedSettings);
    return {
      ...promptRuntimeConfig,
      debugConsoleEnabled: normalizedSettings.meetingDebugConsoleEnabled,
      hosting: {
        ...promptRuntimeConfig.hosting,
        meetingPanelBridgeUrl: joinUrl(workspaceOrigin, "meeting/panel-bridge.html"),
        meetingWorkspaceUrl: workspaceUrl,
        originUrl: workspaceOrigin,
      },
    };
  }

  async function reconcileSettings(settings) {
    const currentSettings = settings && typeof settings === "object"
      ? settings
      : await readStoredSettings();
    const normalizedSettings = namespace.firebaseConfig?.meeting?.normalizeSettings?.(currentSettings)
      || normalizeMeetingSettingsFallback(currentSettings);
    const nextSettings = {
      ...currentSettings,
      ...normalizedSettings,
    };
    if (
      typeof namespace.storage?.updateSettings !== "function"
      || (
        nextSettings.meetingDebugConsoleEnabled === currentSettings?.meetingDebugConsoleEnabled
        && nextSettings.meetingWorkspaceTarget === currentSettings?.meetingWorkspaceTarget
        && nextSettings.meetingWorkspaceUrlOverride === normalizeText(currentSettings?.meetingWorkspaceUrlOverride)
      )
    ) {
      return nextSettings;
    }
    return namespace.storage.updateSettings({
      meetingDebugConsoleEnabled: nextSettings.meetingDebugConsoleEnabled,
      meetingWorkspaceTarget: nextSettings.meetingWorkspaceTarget,
      meetingWorkspaceUrlOverride: nextSettings.meetingWorkspaceUrlOverride,
    });
  }

  function buildProductionPromptRuntimeConfig(normalizedSettings) {
    return {
      emulators: {
        authUrl: "",
        enabled: false,
        firestoreHost: "",
        firestorePort: 0,
        functionsBaseUrl: "",
        functionsHost: "",
        functionsPort: 0,
        storageHost: "",
        storagePort: 0,
      },
      functions: getDefaultFunctionsConfig(),
      hosting: cloneValue(namespace.firebaseConfig?.hosting || {}),
      prompt: cloneValue(namespace.firebaseConfig?.prompt || {}),
      settings: normalizedSettings,
      target: "production",
      web: cloneValue(namespace.firebaseConfig?.web || {}),
    };
  }

  function buildProductionMeetingRuntimeConfig(normalizedSettings) {
    return {
      debugConsoleEnabled: normalizedSettings.meetingDebugConsoleEnabled,
      emulators: {
        authUrl: "",
        enabled: false,
        firestoreHost: "",
        firestorePort: 0,
        functionsBaseUrl: "",
        functionsHost: "",
        functionsPort: 0,
        storageHost: "",
        storagePort: 0,
      },
      functions: getDefaultFunctionsConfig(),
      hosting: cloneValue(namespace.firebaseConfig?.hosting || {}),
      settings: normalizedSettings,
      target: "production",
      web: cloneValue(namespace.firebaseConfig?.web || {}),
    };
  }

  function buildLocalPromptRuntimeConfig(normalizedSettings) {
    const workspaceUrl = normalizeWorkspaceUrl(normalizedSettings);
    const workspaceOrigin = normalizeOriginUrl(workspaceUrl);
    const workspaceHost = resolveLoopbackHost(readHostname(workspaceUrl));
    const functionsConfig = buildFunctionsConfig(
      buildLocalFunctionsBaseUrl(
        workspaceHost,
        namespace.firebaseConfig?.project?.projectId,
        namespace.firebaseConfig?.project?.region
      ),
      resolveLaneFunctionsConfig().endpointOverrides
    );
    return {
      emulators: {
        authUrl: `http://${workspaceHost}:${LOCAL_RUNTIME_DEFAULTS.authPort}`,
        enabled: true,
        firestoreHost: workspaceHost,
        firestorePort: LOCAL_RUNTIME_DEFAULTS.firestorePort,
        functionsBaseUrl: functionsConfig.baseUrl,
        functionsHost: workspaceHost,
        functionsPort: LOCAL_RUNTIME_DEFAULTS.functionsPort,
        storageHost: workspaceHost,
        storagePort: LOCAL_RUNTIME_DEFAULTS.storagePort,
      },
      functions: functionsConfig,
      hosting: buildLocalHostingConfig(workspaceOrigin),
      prompt: cloneValue(namespace.firebaseConfig?.prompt || {}),
      settings: normalizedSettings,
      target: "local",
      web: cloneValue(namespace.firebaseConfig?.web || {}),
    };
  }

  function buildLocalHostingConfig(workspaceOrigin) {
    const lane = normalizeText(namespace.productLane?.getActiveLane?.() || "legacy").toLowerCase();
    const currentHosting = cloneValue(namespace.firebaseConfig?.hosting || {});
    const endpointPaths = currentHosting.endpointPaths && typeof currentHosting.endpointPaths === "object"
      ? cloneValue(currentHosting.endpointPaths)
      : {};
    const hostingBaseUrl = joinUrl(workspaceOrigin, lane === "v2" ? "extension-v2" : "extension");
    const promptPanelBridgeAssetVersion = normalizeText(currentHosting.promptPanelBridgeAssetVersion);
    const hostingConfig = {
      ...currentHosting,
      baseUrl: hostingBaseUrl,
      endpointPaths,
      meetingPanelBridgeUrl: joinUrl(workspaceOrigin, "meeting/panel-bridge.html"),
      meetingWorkspaceUrl: joinUrl(workspaceOrigin, "meeting/index.html"),
      originUrl: workspaceOrigin,
      panelAppUrl: joinUrl(hostingBaseUrl, "panel/index.html"),
      promptPanelBridgeUrl: appendQueryParam(
        joinUrl(workspaceOrigin, "extension/prompt-panel-bridge.html"),
        "v",
        promptPanelBridgeAssetVersion
      ),
    };
    for (const [configKey, endpointPath] of Object.entries(endpointPaths)) {
      hostingConfig[configKey] = joinUrl(hostingBaseUrl, endpointPath);
    }
    return hostingConfig;
  }

  function resolveLaneFunctionsConfig() {
    const activeLane = normalizeText(namespace.productLane?.getActiveLane?.() || "legacy").toLowerCase();
    return cloneValue(LANE_FUNCTION_OVERRIDES[activeLane] || LANE_FUNCTION_OVERRIDES.legacy);
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
        baseUrl,
        region: normalizeText(overrideConfig.region || namespace.firebaseConfig?.project?.region) || "asia-northeast3",
      },
      endpointMap,
      baseUrl
    );
  }

  function buildFunctionEndpointMap(endpointDefinitions) {
    return Object.entries(endpointDefinitions || {}).reduce((endpointMap, [configKey, definition]) => {
      endpointMap[configKey] = String(definition?.endpoint || "");
      return endpointMap;
    }, {});
  }

  function buildUrlConfig(baseConfig, endpointMap, baseUrl) {
    const config = {
      ...baseConfig,
    };
    for (const [configKey, endpointPath] of Object.entries(endpointMap || {})) {
      config[configKey] = joinUrl(baseUrl, endpointPath);
    }
    return {
      ...config,
      endpointPaths: cloneValue(endpointMap),
    };
  }

  function normalizeMeetingSettingsFallback(settings) {
    const nextSettings = settings && typeof settings === "object" ? settings : {};
    return {
      meetingDebugConsoleEnabled: normalizeBoolean(nextSettings.meetingDebugConsoleEnabled),
      meetingWorkspaceTarget: normalizeWorkspaceTarget(nextSettings.meetingWorkspaceTarget),
      meetingWorkspaceUrlOverride:
        normalizeWorkspaceTarget(nextSettings.meetingWorkspaceTarget) === "local"
          ? normalizeWorkspaceUrl(nextSettings)
          : "",
    };
  }

  function normalizeWorkspaceUrl(settings) {
    return namespace.firebaseConfig?.meeting?.normalizeWorkspaceUrlOverride?.(settings?.meetingWorkspaceUrlOverride)
      || `http://${LOCAL_RUNTIME_DEFAULTS.host}:5000/meeting/index.html`;
  }

  function normalizeWorkspaceTarget(value) {
    return normalizeText(value).toLowerCase() === "local" ? "local" : "production";
  }

  async function readStoredSettings() {
    try {
      const storageState = await namespace.storage?.getState?.();
      return storageState?.settings && typeof storageState.settings === "object"
        ? storageState.settings
        : {};
    } catch {
      return {};
    }
  }

  function buildLocalFunctionsBaseUrl(hostname, projectId, region) {
    const resolvedHost = resolveLoopbackHost(hostname);
    const localTarget = BUNDLED_FUNCTIONS_MANIFEST.targets.local;
    const normalizedProjectId = normalizeText(projectId) || localTarget.projectIdFallback;
    const normalizedRegion = normalizeText(region) || localTarget.regionFallback;
    return `http://${resolvedHost}:${localTarget.functionsPort}/${normalizedProjectId}/${normalizedRegion}`;
  }

  function readHostname(value) {
    try {
      return new URL(String(value || "")).hostname;
    } catch {
      return String(value || "");
    }
  }

  function resolveLoopbackHost(value) {
    const normalized = normalizeText(value).toLowerCase();
    return LOOPBACK_HOSTNAMES.has(normalized) ? normalized : LOCAL_RUNTIME_DEFAULTS.host;
  }

  function normalizeOriginUrl(value) {
    const normalized = normalizeBaseUrl(value);
    try {
      return new URL(normalized).origin;
    } catch {
      return normalized;
    }
  }

  function appendQueryParam(url, key, value) {
    const normalizedUrl = normalizeText(url);
    const normalizedKey = normalizeText(key);
    const normalizedValue = normalizeText(value);
    if (!normalizedUrl || !normalizedKey || !normalizedValue) {
      return normalizedUrl;
    }
    try {
      const nextUrl = new URL(normalizedUrl);
      nextUrl.searchParams.set(normalizedKey, normalizedValue);
      return nextUrl.toString();
    } catch {
      return normalizedUrl;
    }
  }

  function joinUrl(baseUrl, pathName) {
    return `${normalizeBaseUrl(baseUrl)}/${String(pathName || "").replace(/^\/+/, "")}`;
  }

  function normalizeBaseUrl(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function normalizeText(value) {
    return namespace.session.normalizeText(value);
  }

  function normalizeBoolean(value) {
    if (typeof value === "boolean") {
      return value;
    }
    const normalized = normalizeText(value).toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
      return value;
    }
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  }
})(globalThis);
