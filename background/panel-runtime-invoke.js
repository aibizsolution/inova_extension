/* global createMeetingShareLink, getInovaAccessToken, getMeetingFunctionsConfig, getPromptFunctionsConfig, getPromptRuntimeConfig, issueMeetingPanelAuth, issuePromptPanelAuth, openMeetingResult, openMeetingWorkspace, openReleaseUrl, revokeMeetingShareLink */

(() => {
const namespace = globalThis.InovaBookmarks || {};

const PANEL_ALLOWED_STORAGE_KEYS = new Set([
  "cloudSync",
  "meetingHub",
  "meetingStateByMeetingId",
  "pausedSessions",
  "productLaneMigration",
  "promptLibrary",
  "releaseInfo",
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

globalThis.invokeHostedPanelRequest = async function invokeHostedPanelRequest(request) {
  const action = namespace.session.normalizeText(request?.action).toLowerCase();
  if (action === "storage.get-state") {
    return namespace.storage.getState();
  }
  if (action === "storage.get") {
    return readHostedPanelStorageValue(request);
  }
  if (action === "storage.set") {
    return writeHostedPanelStorageValue(request);
  }
  if (action === "storage.update-settings") {
    return namespace.storage.updateSettings(request?.partial && typeof request.partial === "object" ? request.partial : {});
  }
  if (action === "storage.update-ui-preferences") {
    return namespace.storage.updateUiPreferences(request?.partial && typeof request.partial === "object" ? request.partial : {});
  }
  if (action === "storage.set-session-paused") {
    return namespace.storage.setSessionPaused(
      namespace.session.normalizeText(request?.sessionId),
      Boolean(request?.paused)
    );
  }
  if (action === "browser.open-url" || action === "release.open-url") {
    return openReleaseUrl(request?.url);
  }
  if (action === "meeting.open-workspace") {
    return openMeetingWorkspace(request?.input, request?.providerIdentity);
  }
  if (action === "meeting.open-result") {
    return openMeetingResult(request?.input, request?.providerIdentity);
  }
  if (action === "meeting.create-share-link") {
    return createMeetingShareLink(request?.input, request?.providerIdentity);
  }
  if (action === "meeting.revoke-share-link") {
    return revokeMeetingShareLink(request?.input, request?.providerIdentity);
  }
  if (action === "auth.issue-prompt-panel") {
    return enrichPromptPanelAuth(
      await issuePromptPanelAuth(request?.providerIdentity)
    );
  }
  if (action === "auth.issue-meeting-panel") {
    return enrichMeetingPanelAuth(
      await issueMeetingPanelAuth(request?.providerIdentity)
    );
  }
  if (action === "functions.fetch") {
    return invokeHostedPanelFunctionFetch(request);
  }
  throw new Error("허용되지 않은 hosted panel runtime 요청이에요.");
};

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

async function readHostedPanelStorageValue(request) {
  const key = namespace.session.normalizeText(request?.key);
  if (!PANEL_ALLOWED_STORAGE_KEYS.has(key)) {
    throw new Error("허용되지 않은 storage read 요청이에요.");
  }
  const state = await namespace.storage.getState();
  return state?.[key];
}

async function writeHostedPanelStorageValue(request) {
  const partial = request?.partial && typeof request.partial === "object" ? request.partial : {};
  const nextPartial = {};
  for (const [key, value] of Object.entries(partial)) {
    if (!PANEL_ALLOWED_STORAGE_KEYS.has(namespace.session.normalizeText(key))) {
      throw new Error("허용되지 않은 storage write 요청이에요.");
    }
    nextPartial[key] = value;
  }
  await namespace.storage.setLocal(nextPartial);
  return namespace.storage.getState();
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
  const storageState = await namespace.storage.getState().catch(() => ({}));
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
})();
