/* global createMeetingShareLink, getInovaAccessToken, getMeetingFunctionsConfig, getPromptFunctionsConfig, getPromptRuntimeConfig, issueMeetingPanelAuth, issuePromptPanelAuth, openBrowserUrl, openMeetingResult, openMeetingWorkspace, revokeMeetingShareLink */

(() => {
const namespace = globalThis.InovaBookmarks || {};

const PANEL_RUNTIME_STORAGE_STATE_KEYS = Object.freeze([
  "providerIdentityCache",
  "settings",
  "uiPreferences",
]);

const PANEL_ALLOWED_FUNCTION_ENDPOINT_KEYS = Object.freeze({
  meeting: new Set([
    "authorizeInovaMeetingWorkspaceAccessUrl",
    "createInovaMeetingShareLinkUrl",
    "issueInovaMeetingPanelAuthUrl",
    "listInovaMeetingsUrl",
    "revokeInovaMeetingShareLinkUrl",
  ]),
  prompt: new Set([
    "importPromptStoreEntryUrl",
    "issueInovaPromptPanelAuthUrl",
    "listPromptStoreEntriesUrl",
    "publishPromptToStoreUrl",
    "recordPromptStoreViewUrl",
    "reviewInovaPromptUrl",
    "syncInovaPromptLibraryUrl",
    "togglePromptStoreLikeUrl",
    "unpublishPromptFromStoreUrl",
  ]),
});

async function handle(request) {
  const action = namespace.session.normalizeText(request?.action).toLowerCase();
  if (action === "storage.read-panel-state") {
    return readHostedPanelStorageState();
  }
  if (action === "storage.write-ui-preferences") {
    return namespace.storage.updateUiPreferences(request?.partial && typeof request.partial === "object" ? request.partial : {});
  }
  if (action === "browser.open-url") {
    return openBrowserUrl(request?.url);
  }
  if (action === "meeting.workspace.open") {
    return openMeetingWorkspace(request?.input, request?.providerIdentity);
  }
  if (action === "meeting.result.open") {
    return openMeetingResult(request?.input, request?.providerIdentity);
  }
  if (action === "meeting.share.create") {
    return createMeetingShareLink(request?.input, request?.providerIdentity);
  }
  if (action === "meeting.share.revoke") {
    return revokeMeetingShareLink(request?.input, request?.providerIdentity);
  }
  if (action === "auth.issue-panel-session") {
    const panel = namespace.session.normalizeText(request?.panel).toLowerCase();
    if (panel === "hosted") {
      return enrichHostedPanelAuth(
        await issuePromptPanelAuth(request?.providerIdentity)
      );
    }
    if (panel === "prompt") {
      return enrichPromptPanelAuth(
        await issuePromptPanelAuth(request?.providerIdentity)
      );
    }
    if (panel === "meeting") {
      return enrichMeetingPanelAuth(
        await issueMeetingPanelAuth(request?.providerIdentity)
      );
    }
    throw new Error("허용되지 않은 hosted panel auth scope예요.");
  }
  if (action === "functions.invoke-endpoint") {
    return invokeHostedPanelFunctionFetch(request);
  }
  throw new Error("허용되지 않은 hosted panel runtime 요청이에요.");
}

async function invokeHostedPanelFunctionFetch(request) {
  const service = namespace.session.normalizeText(request?.service).toLowerCase();
  const endpointKey = namespace.session.normalizeText(request?.endpointKey);
  const allowedEndpoints = PANEL_ALLOWED_FUNCTION_ENDPOINT_KEYS[service];
  if (!allowedEndpoints?.has(endpointKey)) {
    throw new Error("허용되지 않은 Functions endpoint 요청이에요.");
  }
  const functionsConfig = service === "meeting"
    ? await getMeetingFunctionsConfig()
    : await getPromptFunctionsConfig();
  const targetUrl = namespace.session.normalizeText(functionsConfig?.[endpointKey]);
  if (!targetUrl) {
    throw new Error("Functions endpoint를 찾지 못했어요.");
  }

  const authMode = namespace.session.normalizeText(request?.authMode).toLowerCase() || "access-token";
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
    body: JSON.stringify(request?.body && typeof request.body === "object" ? request.body : {}),
    headers,
    method: "POST",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(namespace.session.normalizeText(payload?.error || payload?.message) || "Functions 요청에 실패했어요.");
  }
  return payload?.data || {};
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
