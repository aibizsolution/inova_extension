(function initFunctionsRuntimeConfig(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const DEFAULT_FUNCTIONS_BASE_URL = "https://asia-northeast3-browser-extension-main.cloudfunctions.net";
  const CAPABILITY_MANIFEST_PATH = "capability-manifest.json";
  const CAPABILITY_MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000;
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
  let cachedRemoteManifestRecord = null;
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
    getActiveCapabilityManifest,
    getBundledCapabilityManifest,
    getDefaultFunctionsConfig,
    getMeetingFunctionsConfig,
    getMeetingRuntimeConfig,
    getPromptFunctionsConfig,
    getPromptRuntimeConfig,
    reconcileSettings,
  };

  async function getActiveCapabilityManifest(settings) {
    const remoteResult = await fetchRemoteCapabilityManifest(settings);
    if (remoteResult?.manifest) {
      return remoteResult;
    }
    return buildBundledManifestResult(remoteResult?.status || {});
  }

  function getBundledCapabilityManifest() {
    return cloneValue(BUNDLED_FUNCTIONS_MANIFEST);
  }

  async function fetchRemoteCapabilityManifest(settings) {
    const manifestUrl = await resolveRemoteCapabilityManifestUrl(settings);
    const now = Date.now();
    const cached = cachedRemoteManifestRecord;
    if (cached?.manifest && cached.manifestUrl === manifestUrl && cached.freshUntilMs > now) {
      return {
        degraded: false,
        manifest: cloneValue(cached.manifest),
        manifestUrl,
        source: "remote-cache",
      };
    }
    try {
      const response = await fetch(manifestUrl, {
        cache: "no-store",
      });
      if (!response?.ok) {
        throw new Error(`remote capability manifest fetch failed: ${response?.status || "unknown"}`);
      }
      const remoteManifest = await response.json();
      const normalizedManifest = validateRemoteCapabilityManifest(remoteManifest, manifestUrl);
      cachedRemoteManifestRecord = {
        freshUntilMs: now + CAPABILITY_MANIFEST_CACHE_TTL_MS,
        manifest: normalizedManifest,
        manifestUrl,
      };
      return {
        degraded: false,
        manifest: cloneValue(normalizedManifest),
        manifestUrl,
        source: "remote",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "");
      if (cached?.manifest && cached.manifestUrl === manifestUrl) {
        warnCapabilityManifestDegraded("remote-cache-stale", message, manifestUrl);
        return {
          degraded: true,
          degradedReason: message,
          manifest: cloneValue(cached.manifest),
          manifestUrl,
          source: "remote-cache-stale",
        };
      }
      warnCapabilityManifestDegraded("bundled-fallback", message, manifestUrl);
      return buildBundledManifestResult({
        degradedReason: message,
        manifestUrl,
      });
    }
  }

  function buildBundledManifestResult(status = {}) {
    return {
      degraded: Boolean(status.degradedReason),
      degradedReason: normalizeText(status.degradedReason),
      manifest: getBundledCapabilityManifest(),
      manifestUrl: normalizeText(status.manifestUrl),
      source: status.degradedReason ? "bundled-fallback" : "bundled",
    };
  }

  async function resolveRemoteCapabilityManifestUrl(settings) {
    const normalizedSettings = await reconcileSettings(settings);
    if (normalizedSettings.meetingWorkspaceTarget === "local") {
      const workspaceUrl = normalizeWorkspaceUrl(normalizedSettings);
      const workspaceOrigin = normalizeOriginUrl(workspaceUrl);
      const lane = normalizeText(namespace.productLane?.getActiveLane?.() || "legacy").toLowerCase();
      return joinUrl(joinUrl(workspaceOrigin, lane === "v2" ? "extension-v2" : "extension"), CAPABILITY_MANIFEST_PATH);
    }
    const hostingBaseUrl = normalizeText(namespace.firebaseConfig?.hosting?.baseUrl)
      || normalizeText(namespace.productLane?.getLaneConfig?.()?.hosting?.baseUrl);
    return joinUrl(hostingBaseUrl, CAPABILITY_MANIFEST_PATH);
  }

  function validateRemoteCapabilityManifest(manifest, manifestUrl) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new Error("remote capability manifest is not an object");
    }
    assertTrustedManifestUrl(manifestUrl);
    const normalizedManifest = cloneValue(manifest);
    if (Number(normalizedManifest.schemaVersion) !== BUNDLED_FUNCTIONS_MANIFEST.schemaVersion) {
      throw new Error("remote capability manifest schemaVersion mismatch");
    }
    if (!normalizeText(normalizedManifest.manifestVersion)) {
      throw new Error("remote capability manifestVersion is missing");
    }
    if (!isMinimumExtensionVersionSupported(normalizedManifest.minExtensionVersion)) {
      throw new Error("remote capability manifest requires a newer extension");
    }
    if (!isFutureIsoTimestamp(normalizedManifest.expiresAt)) {
      throw new Error("remote capability manifest is expired or missing expiresAt");
    }
    validateEndpointDefinitions(normalizedManifest.endpointKeys);
    validateLaneDefinitions(normalizedManifest.lanes);
    validateManifestTargets(normalizedManifest.targets);
    return normalizedManifest;
  }

  function assertTrustedManifestUrl(manifestUrl) {
    let parsedUrl;
    try {
      parsedUrl = new URL(normalizeText(manifestUrl));
    } catch (error) {
      throw new Error("remote capability manifest URL is invalid", { cause: error });
    }
    const allowedOrigins = new Set(namespace.productLane?.getKnownHostingOrigins?.() || []);
    if (!allowedOrigins.has(parsedUrl.origin)) {
      throw new Error("remote capability manifest origin is not allowed");
    }
  }

  function isMinimumExtensionVersionSupported(minVersion) {
    const required = parseVersionParts(minVersion);
    const current = parseVersionParts(namespace.productLane?.readManifestVersion?.() || "1.0.0");
    for (let index = 0; index < 3; index += 1) {
      if (current[index] > required[index]) return true;
      if (current[index] < required[index]) return false;
    }
    return true;
  }

  function parseVersionParts(version) {
    return normalizeText(version).split(".").slice(0, 3).map((part) => {
      const parsed = Number.parseInt(part, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    }).concat([0, 0, 0]).slice(0, 3);
  }

  function isFutureIsoTimestamp(value) {
    const timestamp = Date.parse(normalizeText(value));
    return Number.isFinite(timestamp) && timestamp > Date.now();
  }

  function validateEndpointDefinitions(endpointDefinitions) {
    if (!endpointDefinitions || typeof endpointDefinitions !== "object") {
      throw new Error("remote capability manifest endpointKeys are missing");
    }
    Object.keys(BUNDLED_FUNCTIONS_MANIFEST.endpointKeys).forEach((endpointKey) => {
      const definition = endpointDefinitions[endpointKey];
      if (!definition || typeof definition !== "object") {
        throw new Error(`remote capability manifest endpoint is missing: ${endpointKey}`);
      }
      if (!normalizeText(definition.endpoint)) {
        throw new Error(`remote capability manifest endpoint path is missing: ${endpointKey}`);
      }
      const method = normalizeText(definition.method || "POST").toUpperCase();
      if (method !== "POST") {
        throw new Error(`remote capability manifest endpoint method is not allowed: ${endpointKey}`);
      }
    });
  }

  function validateLaneDefinitions(lanes) {
    if (!lanes || typeof lanes !== "object") {
      throw new Error("remote capability manifest lanes are missing");
    }
    namespace.productLane?.getKnownLanes?.().forEach((lane) => {
      const laneConfig = lanes[lane];
      if (!laneConfig || typeof laneConfig !== "object") {
        throw new Error(`remote capability manifest lane is missing: ${lane}`);
      }
      if (!isAllowedFunctionsBaseUrl(laneConfig.baseUrl)) {
        throw new Error(`remote capability manifest lane baseUrl is not allowed: ${lane}`);
      }
    });
  }

  function validateManifestTargets(targets) {
    if (!targets || typeof targets !== "object") {
      throw new Error("remote capability manifest targets are missing");
    }
    if (!isAllowedFunctionsBaseUrl(targets.production?.functionsBaseUrl)) {
      throw new Error("remote capability manifest production target is not allowed");
    }
    if (!isAllowedFunctionsBaseUrl(targets.local?.functionsBaseUrl)) {
      throw new Error("remote capability manifest local target is not allowed");
    }
  }

  function isAllowedFunctionsBaseUrl(value) {
    const normalized = normalizeBaseUrl(value);
    if (!normalized) {
      return false;
    }
    try {
      const parsedUrl = new URL(normalized);
      return parsedUrl.origin === "https://asia-northeast3-browser-extension-main.cloudfunctions.net"
        || (
          ["http://127.0.0.1:5001", "http://localhost:5001"].includes(parsedUrl.origin)
          && /^\/browser-extension-main\/asia-northeast3$/i.test(parsedUrl.pathname)
        );
    } catch {
      return false;
    }
  }

  function warnCapabilityManifestDegraded(source, reason, manifestUrl) {
    console.warn("[i-Nova Service Worker] capability manifest degraded", {
      manifestUrl: normalizeText(manifestUrl),
      reason: normalizeText(reason),
      source,
    });
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
