(function initFirebaseConfig(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const PROMPT_PANEL_BRIDGE_CACHE_TOKEN = "20260402-1";
  const HOSTING_ENDPOINTS = {
    latestReleaseUrl: "releases/latest.json",
    releaseHistoryUrl: "releases/history.json",
  };
  const LOCAL_MEETING_DEFAULTS = {
    authPort: 9099,
    firestorePort: 8080,
    host: "127.0.0.1",
    hostingPort: 5000,
    storagePort: 9199,
  };
  const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
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
    const defaultPromptCollections = getPromptFirestoreCollections(activeLane);
    const laneConfig = namespace.productLane?.getLaneConfig?.(activeLane) || {
      hosting: { baseUrl: "", originUrl: "" },
      id: activeLane,
      prompt: {
        firestoreCollections: defaultPromptCollections,
        panelScope: "prompt-panel",
      },
      storagePrefix: "",
    };

    const config = {
      activeLane: laneConfig.id,
      project: {
        displayName: "browser-extension",
        projectId: DEFAULT_WEB_CONFIG.projectId,
        region: "asia-northeast3",
        ...(override.project || {}),
      },
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
    config.meeting = buildMeetingConfigHelpers(config);
    config.prompt = buildPromptConfigHelpers(config, config.prompt);
    config.panel = buildPanelConfigHelpers(config);
    return config;
  }

  function buildHostingConfig(defaultBaseUrl, defaultOriginUrl, overrideConfig = {}) {
    const baseUrl = normalizeBaseUrl(overrideConfig.baseUrl || defaultBaseUrl);
    const originUrl = normalizeOriginUrl(overrideConfig.originUrl || defaultOriginUrl || baseUrl);
    const promptPanelBridgeBaseUrl = buildPromptPanelBridgeBaseUrl(originUrl);
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
        panelAppUrl: joinUrl(baseUrl, "panel/index.html"),
        meetingPanelBridgeUrl: joinUrl(originUrl, "meeting/panel-bridge.html"),
        meetingWorkspaceUrl: joinUrl(originUrl, "meeting/index.html"),
        promptPanelBridgeAssetVersion,
        promptPanelBridgeUrl: appendQueryParam(
          joinUrl(promptPanelBridgeBaseUrl, "prompt-panel-bridge.html"),
          "v",
          promptPanelBridgeAssetVersion
        ),
        originUrl,
      },
      endpointMap,
      baseUrl,
      overrideConfig
    );
  }

  function buildPromptConfig(defaultPromptConfig = {}, overrideConfig = {}) {
    const defaultCollections = {
      ...getPromptFirestoreCollections(),
      ...(defaultPromptConfig.firestoreCollections || {}),
    };
    const overrideCollections = overrideConfig?.firestoreCollections && typeof overrideConfig.firestoreCollections === "object"
      ? overrideConfig.firestoreCollections
      : {};
    const firestoreCollections = namespace.firestoreCollections?.normalizePromptFirestoreCollections?.(
      {
        ...defaultCollections,
        ...overrideCollections,
      },
      defaultPromptConfig.panelScope === "prompt-panel-v2" ? "v2" : "legacy"
    ) || {};
    return {
      firestoreCollections,
      panelScope: normalizeText(overrideConfig.panelScope || defaultPromptConfig.panelScope) || "prompt-panel",
    };
  }

  function buildPromptConfigHelpers(baseConfig, promptConfig) {
    return {
      ...promptConfig,
      resolveRuntime(settings) {
        return resolvePromptRuntimeConfig(baseConfig, settings);
      },
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
      endpointPaths: cloneValue(endpointMap),
      ...(overrideConfig || {}),
      baseUrl,
    };
  }

  function buildMeetingConfigHelpers(baseConfig) {
    return {
      normalizeSettings: normalizeMeetingSettings,
      normalizeWorkspaceTarget,
      normalizeWorkspaceUrlOverride,
      resolveRuntime(settings) {
        return resolveMeetingRuntimeConfig(baseConfig, settings);
      },
    };
  }

  function buildPanelConfigHelpers(baseConfig) {
    return {
      resolveRuntime(settings) {
        if (typeof baseConfig.meeting?.resolveRuntime === "function") {
          return baseConfig.meeting.resolveRuntime(settings);
        }
        if (typeof baseConfig.prompt?.resolveRuntime === "function") {
          return baseConfig.prompt.resolveRuntime(settings);
        }
        return {
          hosting: cloneValue(baseConfig.hosting),
          settings: normalizeMeetingSettings(settings),
          target: "production",
        };
      },
    };
  }

  function getPromptFirestoreCollections(lane = "legacy") {
    return namespace.firestoreCollections?.getPromptFirestoreCollections?.(lane) || {};
  }

  function resolvePromptRuntimeConfig(baseConfig, settings) {
    const normalizedSettings = normalizeMeetingSettings(settings);
    if (normalizedSettings.meetingWorkspaceTarget !== "local") {
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
        hosting: cloneValue(baseConfig.hosting),
        prompt: cloneValue(baseConfig.prompt),
        settings: normalizedSettings,
        target: "production",
        web: cloneValue(baseConfig.web),
      };
    }

    const workspaceUrl = normalizeWorkspaceUrlOverride(normalizedSettings.meetingWorkspaceUrlOverride);
    return buildLocalPromptRuntimeConfig(baseConfig, normalizedSettings, workspaceUrl);
  }

  function resolveMeetingRuntimeConfig(baseConfig, settings) {
    const normalizedSettings = normalizeMeetingSettings(settings);
    if (normalizedSettings.meetingWorkspaceTarget !== "local") {
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
        hosting: cloneValue(baseConfig.hosting),
        settings: normalizedSettings,
        target: "production",
        web: cloneValue(baseConfig.web),
      };
    }

    const workspaceUrl = normalizeWorkspaceUrlOverride(normalizedSettings.meetingWorkspaceUrlOverride);
    const promptRuntimeConfig = buildLocalPromptRuntimeConfig(baseConfig, normalizedSettings, workspaceUrl);
    const workspaceOrigin = normalizeOriginUrl(workspaceUrl);
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

  function buildLocalPromptRuntimeConfig(baseConfig, normalizedSettings, workspaceUrl) {
    const workspaceOrigin = normalizeOriginUrl(workspaceUrl);
    const workspaceHost = resolveLoopbackHost(readHostname(workspaceUrl));
    const hostingBaseUrl = buildLocalExtensionBaseUrl(workspaceOrigin, baseConfig.activeLane);
    const hostingConfig = buildHostingConfig(hostingBaseUrl, workspaceOrigin, {
      baseUrl: hostingBaseUrl,
      endpointPaths: cloneValue(baseConfig.hosting?.endpointPaths),
      originUrl: workspaceOrigin,
    });
    const emulatorConfig = {
      authUrl: `http://${workspaceHost}:${LOCAL_MEETING_DEFAULTS.authPort}`,
      enabled: true,
      firestoreHost: workspaceHost,
      firestorePort: LOCAL_MEETING_DEFAULTS.firestorePort,
      functionsBaseUrl: "",
      functionsHost: "",
      functionsPort: 0,
      storageHost: workspaceHost,
      storagePort: LOCAL_MEETING_DEFAULTS.storagePort,
    };

    return {
      emulators: emulatorConfig,
      hosting: hostingConfig,
      prompt: cloneValue(baseConfig.prompt),
      settings: normalizedSettings,
      target: "local",
      web: cloneValue(baseConfig.web),
    };
  }

  function normalizeMeetingSettings(settings) {
    const nextSettings = settings && typeof settings === "object" ? settings : {};
    return {
      meetingDebugConsoleEnabled: normalizeBoolean(nextSettings.meetingDebugConsoleEnabled),
      meetingWorkspaceTarget: normalizeWorkspaceTarget(nextSettings.meetingWorkspaceTarget),
      meetingWorkspaceUrlOverride:
        normalizeWorkspaceTarget(nextSettings.meetingWorkspaceTarget) === "local"
          ? normalizeWorkspaceUrlOverride(nextSettings.meetingWorkspaceUrlOverride)
          : "",
    };
  }

  function normalizeWorkspaceTarget(value) {
    return normalizeText(value).toLowerCase() === "local" ? "local" : "production";
  }

  function normalizeWorkspaceUrlOverride(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return buildDefaultLocalMeetingWorkspaceUrl(LOCAL_MEETING_DEFAULTS.host);
    }
    try {
      const url = new URL(normalized);
      const hostname = resolveLoopbackHost(url.hostname);
      url.hostname = hostname;
      url.port = String(LOCAL_MEETING_DEFAULTS.hostingPort);
      url.pathname = "/meeting/index.html";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return buildDefaultLocalMeetingWorkspaceUrl(LOCAL_MEETING_DEFAULTS.host);
    }
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

  function buildDefaultLocalMeetingWorkspaceUrl(hostname) {
    const resolvedHost = resolveLoopbackHost(hostname);
    return `http://${resolvedHost}:${LOCAL_MEETING_DEFAULTS.hostingPort}/meeting/index.html`;
  }

  function buildLocalExtensionBaseUrl(originUrl, lane = "legacy") {
    const panelBasePath = normalizeText(lane).toLowerCase() === "v2" ? "extension-v2" : "extension";
    return joinUrl(normalizeOriginUrl(originUrl), panelBasePath);
  }

  function buildPromptPanelBridgeBaseUrl(originUrl) {
    return joinUrl(normalizeOriginUrl(originUrl), "extension");
  }

  function resolveLoopbackHost(value) {
    const normalized = normalizeText(value).toLowerCase();
    return LOOPBACK_HOSTNAMES.has(normalized) ? normalized : LOCAL_MEETING_DEFAULTS.host;
  }

  function readHostname(value) {
    try {
      return new URL(String(value || "")).hostname;
    } catch {
      return String(value || "");
    }
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
})(globalThis);
