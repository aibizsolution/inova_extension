/* global createMeetingShareLink, getInovaAccessToken, getMeetingFunctionsConfig, getPromptFunctionsConfig, getPromptRuntimeConfig, issueMeetingPanelAuth, issuePromptPanelAuth, openBrowserUrl, openMeetingResult, openMeetingWorkspace, revokeMeetingShareLink */

(() => {
const namespace = globalThis.InovaBookmarks || {};

const PANEL_RUNTIME_STORAGE_STATE_KEYS = Object.freeze([
  "providerIdentityCache",
  "settings",
  "uiPreferences",
]);
const SANDBOX_BRIDGE_API_ALLOWLIST = Object.freeze([
  "emitTrace",
  "invokeCapability",
  "invokePageCapability",
  "openUrl",
  "readPanelState",
  "writeUiPreferences",
]);

const PANEL_RUNTIME_CAPABILITY_MANIFEST = deepFreeze({
  functionEndpointCapabilities: {
    meeting: {
      authorizeInovaMeetingWorkspaceAccessUrl: {
        allowedAuthModes: ["access-token", "none"],
        capabilityId: "meeting.workspace.authorize-access",
        defaultAuthMode: "access-token",
        method: "POST",
      },
      createInovaMeetingShareLinkUrl: {
        allowedAuthModes: ["access-token", "none"],
        capabilityId: "meeting.share.create-function",
        defaultAuthMode: "access-token",
        method: "POST",
      },
      issueInovaMeetingPanelAuthUrl: {
        allowedAuthModes: ["access-token", "none"],
        capabilityId: "meeting.panel-auth.issue-function",
        defaultAuthMode: "access-token",
        method: "POST",
      },
      listInovaMeetingsUrl: {
        allowedAuthModes: ["access-token", "none"],
        capabilityId: "meeting.list",
        defaultAuthMode: "access-token",
        method: "POST",
      },
      revokeInovaMeetingShareLinkUrl: {
        allowedAuthModes: ["access-token", "none"],
        capabilityId: "meeting.share.revoke-function",
        defaultAuthMode: "access-token",
        method: "POST",
      },
    },
    prompt: {
      importPromptStoreEntryUrl: {
        allowedAuthModes: ["access-token", "none"],
        capabilityId: "prompt.store.import",
        defaultAuthMode: "access-token",
        method: "POST",
      },
      issueInovaPromptPanelAuthUrl: {
        allowedAuthModes: ["access-token", "none"],
        capabilityId: "prompt.panel-auth.issue-function",
        defaultAuthMode: "access-token",
        method: "POST",
      },
      listPromptStoreEntriesUrl: {
        allowedAuthModes: ["access-token", "none"],
        capabilityId: "prompt.store.list",
        defaultAuthMode: "access-token",
        method: "POST",
      },
      publishPromptToStoreUrl: {
        allowedAuthModes: ["access-token", "none"],
        capabilityId: "prompt.store.publish",
        defaultAuthMode: "access-token",
        method: "POST",
      },
      recordPromptStoreViewUrl: {
        allowedAuthModes: ["access-token", "none"],
        capabilityId: "prompt.store.record-view",
        defaultAuthMode: "access-token",
        method: "POST",
      },
      reviewInovaPromptUrl: {
        allowedAuthModes: ["access-token", "none"],
        capabilityId: "prompt.review.run",
        defaultAuthMode: "access-token",
        method: "POST",
      },
      syncInovaPromptLibraryUrl: {
        allowedAuthModes: ["access-token", "none"],
        capabilityId: "prompt.library.sync",
        defaultAuthMode: "access-token",
        method: "POST",
      },
      togglePromptStoreLikeUrl: {
        allowedAuthModes: ["access-token", "none"],
        capabilityId: "prompt.store.toggle-like",
        defaultAuthMode: "access-token",
        method: "POST",
      },
      unpublishPromptFromStoreUrl: {
        allowedAuthModes: ["access-token", "none"],
        capabilityId: "prompt.store.unpublish",
        defaultAuthMode: "access-token",
        method: "POST",
      },
    },
  },
  manifestVersion: "2026-04-bundled-panel-runtime-v1",
  minExtensionVersion: "1.0.0",
  runtimeCapabilities: {
    "auth.issue-panel-session": {
      adapter: "auth.issue-panel-session",
      panels: {
        hosted: {
          enricher: "hosted",
          issuer: "prompt",
        },
        meeting: {
          enricher: "meeting",
          issuer: "meeting",
        },
        prompt: {
          enricher: "prompt",
          issuer: "prompt",
        },
      },
    },
    "browser.open-url": {
      adapter: "browser.open-url",
    },
    "capabilities.handshake": {
      adapter: "capabilities.handshake",
    },
    "capabilities.invoke": {
      adapter: "capabilities.invoke",
    },
    "functions.invoke-endpoint": {
      adapter: "functions.invoke-endpoint",
    },
    "meeting.result.open": {
      adapter: "meeting.result.open",
    },
    "meeting.share.create": {
      adapter: "meeting.share.create",
    },
    "meeting.share.revoke": {
      adapter: "meeting.share.revoke",
    },
    "meeting.workspace.open": {
      adapter: "meeting.workspace.open",
    },
    "storage.read-panel-state": {
      adapter: "storage.read-panel-state",
    },
    "storage.write-ui-preferences": {
      adapter: "storage.write-ui-preferences",
    },
  },
  schemaVersion: 1,
});

const PANEL_RUNTIME_ADAPTERS = Object.freeze({
  "auth.issue-panel-session": issuePanelSession,
  "browser.open-url": (request) => openBrowserUrl(request?.url),
  "capabilities.handshake": buildCapabilityHandshake,
  "capabilities.invoke": invokeManifestCapability,
  "functions.invoke-endpoint": invokeHostedPanelFunctionFetch,
  "meeting.result.open": (request) => openMeetingResult(request?.input, request?.providerIdentity),
  "meeting.share.create": (request) => createMeetingShareLink(request?.input, request?.providerIdentity),
  "meeting.share.revoke": (request) => revokeMeetingShareLink(request?.input, request?.providerIdentity),
  "meeting.workspace.open": (request) => openMeetingWorkspace(request?.input, request?.providerIdentity),
  "storage.read-panel-state": () => readHostedPanelStorageState(),
  "storage.write-ui-preferences": (request) => namespace.storage.updateUiPreferences(
    request?.partial && typeof request.partial === "object" ? request.partial : {}
  ),
});

const PANEL_AUTH_ISSUERS = Object.freeze({
  meeting: (request) => issueMeetingPanelAuth(request?.providerIdentity),
  prompt: (request) => issuePromptPanelAuth(request?.providerIdentity),
});

const PANEL_AUTH_ENRICHERS = Object.freeze({
  hosted: enrichHostedPanelAuth,
  meeting: enrichMeetingPanelAuth,
  prompt: enrichPromptPanelAuth,
});

const PANEL_FUNCTION_CONFIG_RESOLVERS = Object.freeze({
  meeting: () => getMeetingFunctionsConfig(),
  prompt: () => getPromptFunctionsConfig(),
});

async function handle(request) {
  const action = namespace.session.normalizeText(request?.action).toLowerCase();
  const capability = resolveRuntimeCapability(action);
  return dispatchRuntimeCapability(capability, request);
}

function resolveRuntimeCapability(action) {
  const capability = PANEL_RUNTIME_CAPABILITY_MANIFEST.runtimeCapabilities?.[action];
  if (!capability) {
    throw new Error("허용되지 않은 hosted panel runtime 요청이에요.");
  }
  return capability;
}

async function dispatchRuntimeCapability(capability, request) {
  const adapterId = namespace.session.normalizeText(capability?.adapter);
  const adapter = PANEL_RUNTIME_ADAPTERS[adapterId];
  if (typeof adapter !== "function") {
    throw new Error("hosted panel runtime adapter를 찾지 못했어요.");
  }
  return adapter(request, capability);
}

async function issuePanelSession(request, capability) {
  const panel = namespace.session.normalizeText(request?.panel).toLowerCase();
  const panelCapability = capability?.panels?.[panel];
  if (!panelCapability) {
    throw new Error("허용되지 않은 hosted panel auth scope예요.");
  }
  const issuer = PANEL_AUTH_ISSUERS[namespace.session.normalizeText(panelCapability.issuer)];
  const enricher = PANEL_AUTH_ENRICHERS[namespace.session.normalizeText(panelCapability.enricher)];
  if (typeof issuer !== "function" || typeof enricher !== "function") {
    throw new Error("hosted panel auth adapter를 찾지 못했어요.");
  }
  return enricher(await issuer(request));
}

async function buildCapabilityHandshake(request) {
  const manifestResult = await readActiveCapabilityManifest();
  const manifest = manifestResult?.manifest || {};
  const activeLane = namespace.session.normalizeText(namespace.productLane?.getActiveLane?.() || "legacy").toLowerCase();
  const capabilities = Object.entries(manifest.capabilities || {})
    .map(([capabilityId, capability]) => buildHandshakeCapability(capabilityId, capability, activeLane))
    .sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  const requestedCapabilityIds = Array.isArray(request?.requestedCapabilityIds)
    ? request.requestedCapabilityIds.map((value) => namespace.session.normalizeText(value)).filter(Boolean)
    : [];
  return {
    bridgeApis: SANDBOX_BRIDGE_API_ALLOWLIST.slice(),
    capabilities,
    degraded: Boolean(manifestResult?.degraded),
    degradedReason: namespace.session.normalizeText(manifestResult?.degradedReason),
    enabledCapabilityIds: capabilities
      .filter((capability) => capability.enabled)
      .map((capability) => capability.capabilityId),
    lane: activeLane,
    manifestUrl: namespace.session.normalizeText(manifestResult?.manifestUrl),
    manifestVersion: namespace.session.normalizeText(manifest.manifestVersion),
    requestedCapabilityIds,
    runtimeActions: Object.keys(PANEL_RUNTIME_CAPABILITY_MANIFEST.runtimeCapabilities).sort(),
    schemaVersion: Number(manifest.schemaVersion) || 0,
    source: namespace.session.normalizeText(manifestResult?.source),
  };
}

function buildHandshakeCapability(capabilityId, capability, activeLane) {
  const normalizedCapabilityId = namespace.session.normalizeText(capabilityId);
  const capabilityLane = namespace.session.normalizeText(capability?.lane).toLowerCase();
  const killSwitch = capability?.killSwitch;
  const killSwitchEnabled = capability?.killed === true || killSwitch === true || killSwitch?.enabled === true;
  const laneMatches = !capabilityLane || capabilityLane === "all" || capabilityLane === activeLane;
  return {
    auditLevel: namespace.session.normalizeText(capability?.auditLevel),
    authMode: namespace.session.normalizeText(capability?.authMode || capability?.auth),
    capabilityId: normalizedCapabilityId,
    deprecatedAt: namespace.session.normalizeText(capability?.deprecatedAt),
    domain: namespace.session.normalizeText(capability?.domain),
    enabled: capability?.enabled !== false && !killSwitchEnabled && laneMatches,
    inputSchemaVersion: Number(capability?.inputSchemaVersion) || 0,
    killSwitch: killSwitchEnabled,
    kind: namespace.session.normalizeText(capability?.kind),
    lane: capabilityLane || "all",
    minExtensionVersion: namespace.session.normalizeText(capability?.minExtensionVersion),
    outputSchemaVersion: Number(capability?.outputSchemaVersion) || 0,
    owner: namespace.session.normalizeText(capability?.owner),
    replacementId: namespace.session.normalizeText(capability?.replacementId),
    schemaVersion: Number(capability?.schemaVersion) || 0,
  };
}

async function invokeHostedPanelFunctionFetch(request) {
  const endpointCapability = await resolveFunctionEndpointCapability(request);
  return invokeFunctionEndpointFetch(endpointCapability, request?.body, request);
}

async function invokeManifestCapability(request) {
  const capabilityId = namespace.session.normalizeText(request?.capabilityId);
  const capability = await resolveManifestCapability(capabilityId);
  if (capability.kind === "function") {
    const endpointCapability = await buildManifestFunctionEndpointCapability(capabilityId, capability);
    return invokeFunctionEndpointFetch(endpointCapability, request?.input, request);
  }
  if (capability.kind === "browser.open-url") {
    return invokeBrowserOpenUrlCapability(capabilityId, capability, request?.input);
  }
  throw new Error("지원하지 않는 remote capability kind예요.");
}

async function invokeBrowserOpenUrlCapability(capabilityId, capability, input = {}) {
  const templateKey = namespace.session.normalizeText(input?.templateKey);
  const allowedTemplateKeys = Array.isArray(capability?.templateKeys)
    ? capability.templateKeys.map((value) => namespace.session.normalizeText(value))
    : [];
  if (!allowedTemplateKeys.includes(templateKey)) {
    throw new Error(`허용되지 않은 URL template capability예요: ${capabilityId}`);
  }
  if (templateKey === "release.download") {
    return openBrowserUrl(await buildReleaseDownloadUrl(input?.fileName));
  }
  throw new Error(`지원하지 않는 URL template capability예요: ${capabilityId}`);
}

async function buildReleaseDownloadUrl(fileName) {
  const artifactFileName = normalizeArtifactFileName(fileName);
  const runtimeConfig = await getPromptRuntimeConfig();
  const hostingBaseUrl = namespace.session.normalizeText(runtimeConfig?.hosting?.baseUrl);
  if (!hostingBaseUrl) {
    throw new Error("release download base URL을 찾지 못했어요.");
  }
  return new URL(`downloads/${encodeURIComponent(artifactFileName)}`, `${hostingBaseUrl.replace(/\/+$/, "")}/`).href;
}

function normalizeArtifactFileName(fileName) {
  const artifactFileName = namespace.session.normalizeText(fileName);
  if (!/^[A-Za-z0-9._-]+\.zip$/.test(artifactFileName)) {
    throw new Error("허용되지 않은 release download 파일명이에요.");
  }
  return artifactFileName;
}

async function invokeFunctionEndpointFetch(endpointCapability, body, request) {
  const endpointTarget = await resolveFunctionEndpointTarget(endpointCapability);
  const targetUrl = namespace.session.normalizeText(endpointTarget?.targetUrl);
  if (!targetUrl) {
    throw new Error("Functions endpoint를 찾지 못했어요.");
  }

  const method = namespace.session.normalizeText(endpointTarget?.method || endpointCapability.method).toUpperCase() || "POST";
  if (method !== "POST") {
    throw new Error("허용되지 않은 Functions method예요.");
  }

  const authMode = resolveFunctionAuthMode(request, endpointCapability);
  const headers = {
    "Content-Type": "application/json",
  };
  if (authMode === "access-token") {
    const accessToken = await getInovaAccessToken();
    if (!namespace.session.normalizeText(accessToken)) {
      throw new Error("로그인 토큰을 확인하지 못했어요.");
    }
    headers.Authorization = `Bearer ${accessToken}`;
  } else if (authMode !== "none") {
    throw new Error("허용되지 않은 인증 모드예요.");
  }

  const response = await fetch(namespace.session.normalizeText(targetUrl), {
    body: JSON.stringify(body && typeof body === "object" ? body : {}),
    headers,
    method,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(namespace.session.normalizeText(payload?.error || payload?.message) || "Functions 요청에 실패했어요.");
  }
  return payload?.data || {};
}

async function resolveFunctionEndpointCapability(request) {
  const service = namespace.session.normalizeText(request?.service).toLowerCase();
  const endpointKey = namespace.session.normalizeText(request?.endpointKey);
  const endpointCapability =
    PANEL_RUNTIME_CAPABILITY_MANIFEST.functionEndpointCapabilities?.[service]?.[endpointKey];
  if (!endpointCapability) {
    throw new Error("허용되지 않은 Functions endpoint 요청이에요.");
  }
  const endpointDefinition = await readFunctionEndpointDefinition(endpointKey);
  await assertManifestCapabilityRunnable(endpointCapability.capabilityId);
  return {
    ...endpointDefinition,
    ...endpointCapability,
    endpointKey,
    service,
  };
}

async function resolveManifestCapability(capabilityId) {
  if (!capabilityId) {
    throw new Error("capabilityId가 필요해요.");
  }
  const manifestResult = await readActiveCapabilityManifest();
  const capability = manifestResult?.manifest?.capabilities?.[capabilityId];
  if (!capability || typeof capability !== "object") {
    throw new Error("허용되지 않은 capabilityId예요.");
  }
  assertCapabilityRunnable(capability, capabilityId);
  return {
    ...capability,
    capabilityId,
    kind: namespace.session.normalizeText(capability.kind).toLowerCase(),
  };
}

async function buildManifestFunctionEndpointCapability(capabilityId, capability) {
  const endpointKey = namespace.session.normalizeText(capability?.endpointKey);
  const endpointDefinition = await readFunctionEndpointDefinition(endpointKey);
  const authMode = namespace.session.normalizeText(capability?.authMode || capability?.auth || "access-token").toLowerCase();
  return {
    ...endpointDefinition,
    allowedAuthModes: [authMode],
    capabilityId,
    defaultAuthMode: authMode,
    endpointKey,
    method: endpointDefinition.method || capability.method || "POST",
    service: namespace.session.normalizeText(capability?.service).toLowerCase(),
  };
}

async function readFunctionEndpointDefinition(endpointKey) {
  const manifestResult = await readActiveCapabilityManifest();
  const endpointDefinition = manifestResult?.manifest?.endpointKeys?.[endpointKey];
  if (!endpointDefinition?.endpoint) {
    throw new Error("Functions endpoint manifest를 찾지 못했어요.");
  }
  return endpointDefinition;
}

async function assertManifestCapabilityRunnable(capabilityId) {
  const normalizedCapabilityId = namespace.session.normalizeText(capabilityId);
  if (!normalizedCapabilityId) {
    return;
  }
  const manifestResult = await readActiveCapabilityManifest();
  const capability = manifestResult?.manifest?.capabilities?.[normalizedCapabilityId];
  if (!capability) {
    return;
  }
  assertCapabilityRunnable(capability, normalizedCapabilityId);
}

function assertCapabilityRunnable(capability, capabilityId) {
  if (capability?.enabled === false) {
    throw new Error(`capability가 비활성화되어 있어요: ${capabilityId}`);
  }
  const killSwitch = capability?.killSwitch;
  if (capability?.killed === true || killSwitch === true || killSwitch?.enabled === true) {
    throw new Error(`capability kill switch가 켜져 있어요: ${capabilityId}`);
  }
  const activeLane = namespace.session.normalizeText(namespace.productLane?.getActiveLane?.() || "legacy").toLowerCase();
  const capabilityLane = namespace.session.normalizeText(capability?.lane).toLowerCase();
  if (capabilityLane && capabilityLane !== "all" && capabilityLane !== activeLane) {
    throw new Error(`현재 lane에서 capability를 사용할 수 없어요: ${capabilityId}`);
  }
}

async function resolveFunctionEndpointTarget(endpointCapability) {
  const resolver = namespace.functionsRuntimeConfig?.resolveCapabilityFunctionEndpoint;
  if (typeof resolver === "function") {
    return resolver({
      endpointKey: endpointCapability.endpointKey,
      service: endpointCapability.service,
    });
  }
  const functionsConfig = await resolveFunctionsConfigForService(endpointCapability.service);
  return {
    method: endpointCapability.method,
    targetUrl: namespace.session.normalizeText(functionsConfig?.[endpointCapability.endpointKey]),
  };
}

async function resolveFunctionsConfigForService(service) {
  const resolver = PANEL_FUNCTION_CONFIG_RESOLVERS[service];
  if (typeof resolver !== "function") {
    throw new Error("허용되지 않은 Functions service예요.");
  }
  return resolver();
}

async function readActiveCapabilityManifest() {
  return typeof namespace.functionsRuntimeConfig?.getActiveCapabilityManifest === "function"
    ? namespace.functionsRuntimeConfig.getActiveCapabilityManifest()
    : { manifest: namespace.functionsRuntimeConfig?.getBundledCapabilityManifest?.() };
}

function resolveFunctionAuthMode(request, endpointCapability) {
  const defaultAuthMode = namespace.session.normalizeText(endpointCapability?.defaultAuthMode).toLowerCase()
    || "access-token";
  const authMode = namespace.session.normalizeText(request?.authMode).toLowerCase() || defaultAuthMode;
  const allowedModes = new Set(
    Array.isArray(endpointCapability?.allowedAuthModes) && endpointCapability.allowedAuthModes.length
      ? endpointCapability.allowedAuthModes.map((mode) => namespace.session.normalizeText(mode).toLowerCase())
      : [defaultAuthMode]
  );
  if (!allowedModes.has(authMode)) {
    throw new Error("허용되지 않은 인증 모드예요.");
  }
  return authMode;
}

async function readHostedPanelStorageState() {
  const storageState = await namespace.storage.getState().catch(() => ({}));
  const normalizedStorageState = storageState && typeof storageState === "object"
    ? storageState
    : {};
  return PANEL_RUNTIME_STORAGE_STATE_KEYS.reduce((snapshot, key) => {
    if (!Object.prototype.hasOwnProperty.call(normalizedStorageState, key)) {
      return snapshot;
    }
    snapshot[key] = cloneHostedPanelStorageValue(normalizedStorageState[key]);
    return snapshot;
  }, {});
}

function cloneHostedPanelStorageValue(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice();
  }
  return { ...value };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

async function enrichMeetingPanelAuth(payload) {
  const runtimeConfig = await resolveMeetingRuntimeConfig();
  return {
    ...(payload && typeof payload === "object" ? payload : {}),
    emulators: runtimeConfig?.emulators && typeof runtimeConfig.emulators === "object"
      ? { ...runtimeConfig.emulators }
      : {
          authUrl: "",
          enabled: false,
          firestoreHost: "",
          firestorePort: 0,
        },
    firebaseConfig: runtimeConfig?.web && typeof runtimeConfig.web === "object"
      ? { ...runtimeConfig.web }
      : { ...(namespace.firebaseConfig?.web || {}) },
    target: namespace.session.normalizeText(runtimeConfig?.target) || "production",
  };
}

async function enrichHostedPanelAuth(payload) {
  const promptAuth = await enrichPromptPanelAuth(payload);
  const panelScope = namespace.session.normalizeText(promptAuth?.promptPanelScope || promptAuth?.panelScope) || "prompt-panel-v2";
  return {
    ...promptAuth,
    panelScope,
  };
}

async function enrichPromptPanelAuth(payload) {
  const runtimeConfig = await getPromptRuntimeConfig();
  const promptFirestoreCollections = {
    ...(runtimeConfig?.prompt?.firestoreCollections && typeof runtimeConfig.prompt.firestoreCollections === "object"
      ? { ...runtimeConfig.prompt.firestoreCollections }
      : {}),
    ...(payload?.promptFirestoreCollections && typeof payload.promptFirestoreCollections === "object"
      ? { ...payload.promptFirestoreCollections }
      : {}),
  };
  return {
    ...(payload && typeof payload === "object" ? payload : {}),
    emulators: runtimeConfig?.emulators && typeof runtimeConfig.emulators === "object"
      ? { ...runtimeConfig.emulators }
      : {
          authUrl: "",
          enabled: false,
          firestoreHost: "",
          firestorePort: 0,
        },
    firebaseConfig: runtimeConfig?.web && typeof runtimeConfig.web === "object"
      ? { ...runtimeConfig.web }
      : { ...(namespace.firebaseConfig?.web || {}) },
    promptFirestoreCollections,
    target: namespace.session.normalizeText(runtimeConfig?.target) || "production",
  };
}

async function resolveMeetingRuntimeConfig() {
  const storageState = await readHostedPanelStorageState();
  const settings = storageState?.settings && typeof storageState.settings === "object"
    ? storageState.settings
    : {};
  return namespace.firebaseConfig?.meeting?.resolveRuntime?.(settings) || {
    emulators: {
      authUrl: "",
      enabled: false,
      firestoreHost: "",
      firestorePort: 0,
    },
    target: "production",
    web: namespace.firebaseConfig?.web || {},
  };
}

namespace.panelRuntimeCapabilityRouter = {
  handle,
};
})();
