importScripts("../shared/constants.js");
importScripts("../shared/product-lane.js");
importScripts("../shared/session.js");
importScripts("../shared/provider-identity-cache.js");
importScripts("../shared/storage.js");
importScripts("../shared/firebase-config.js");
importScripts("../shared/inova-auth.js");
importScripts("../shared/cloud-api.js");
importScripts("panel-auth-cache.js");
importScripts("panel-runtime-capability-router.js");
importScripts("panel-runtime-invoke.js");

const namespace = globalThis.InovaBookmarks || {};
const INOVA_ORIGIN = "https://inova.incross.com";
const HOSTED_MEETING_ALLOWED_ORIGINS = new Set(namespace.productLane?.getKnownHostingOrigins?.() || [
  "https://browser-extension-main.web.app",
  "https://browser-extension-v2.web.app",
  "http://127.0.0.1:5000",
  "http://localhost:5000",
]);
const ACTIVE_BACKGROUND_MESSAGE_TYPES = Object.freeze([
  "inova-meeting:authorize-workspace-access",
  "inova-meeting:probe-workspace-bridge",
  "inova-panel:invoke",
]);
const panelAuthCache = namespace.panelAuthCache?.create?.(getInovaAccessToken);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = String(message?.type || "");
  if (!ACTIVE_BACKGROUND_MESSAGE_TYPES.includes(type)) {
    return false;
  }
  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error), ok: false }));
  return true;
});

async function handleMessage(message, sender) {
  if (!isAllowedSender(message, sender)) {
    throw new Error("허용되지 않은 browser capability 호출이에요.");
  }
  if (message.type === "inova-meeting:authorize-workspace-access") {
    return authorizeMeetingWorkspaceAccess(message.input, message.providerIdentity, sender);
  }
  if (message.type === "inova-meeting:probe-workspace-bridge") {
    return probeMeetingWorkspaceBridge(sender);
  }
  if (message.type === "inova-panel:invoke") {
    return globalThis.invokeHostedPanelRequest(message.request);
  }
  throw new Error("지원하지 않는 background capability 메시지예요.");
}

async function getInovaAccessToken() {
  const cookie = await chrome.cookies.get({
    name: "accessToken",
    url: INOVA_ORIGIN,
  });
  if (cookie?.value) {
    return cookie.value;
  }
  return namespace.inovaAuth.getAccessToken(true);
}

async function issuePromptPanelAuth(providerIdentity) {
  const functionsConfig = await getPromptFunctionsConfig();
  return panelAuthCache.issuePromptPanelAuth(providerIdentity, { functionsConfig });
}

async function openReleaseUrl(url) {
  const nextUrl = namespace.session.normalizeText(url);
  if (!nextUrl) throw new Error("열 링크가 없어요.");
  const openedTab = createBrowserTab(nextUrl);
  return {
    opened: true,
    tabId: Number(openedTab?.id) || 0,
    url: nextUrl,
  };
}

async function openMeetingWorkspace(input, providerIdentity, sender) {
  return openHostedMeetingPage("create", input, providerIdentity, sender);
}

async function openMeetingResult(input, providerIdentity, sender) {
  return openHostedMeetingPage("detail", input, providerIdentity, sender);
}

async function issueMeetingPanelAuth(providerIdentity) {
  const functionsConfig = await getMeetingFunctionsConfig();
  return panelAuthCache.issueMeetingPanelAuth(providerIdentity, { functionsConfig });
}

async function authorizeMeetingWorkspaceAccess(input, providerIdentity, sender) {
  try {
    const owner = await resolveMeetingProviderIdentity(providerIdentity);
    const accessToken = await getInovaAccessToken();
    const functionsConfig = await getMeetingFunctionsConfig();
    if (!namespace.session.normalizeText(accessToken)) {
      return buildMeetingWorkspaceBlockedAuthPayload(input, owner, "login-required", {
        extensionBridge: "connected",
        inovaLogin: false,
      });
    }
    if (!namespace.session.normalizeText(owner?.providerUserKey)) {
      return buildMeetingWorkspaceBlockedAuthPayload(input, owner, "identity-required", {
        extensionBridge: "connected",
        inovaLogin: true,
      });
    }
    const payload = await namespace.cloudApi.authorizeInovaMeetingWorkspaceAccess({
      debugAuthBypass: namespace.session.normalizeText(input?.debugAuthBypass),
      jobId: namespace.session.normalizeText(input?.jobId),
      meetingId: namespace.session.normalizeText(input?.meetingId),
      shareToken: namespace.session.normalizeText(input?.shareToken || input?.share),
    }, owner, accessToken, { functionsConfig });
    return {
      ...payload,
      extensionBridge: "connected",
      inovaLogin: payload?.inovaLogin !== false,
      senderUrl: namespace.session.normalizeText(sender?.url),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (looksLikeMeetingLoginError(message)) {
      return buildMeetingWorkspaceBlockedAuthPayload(input, providerIdentity, "login-required", {
        extensionBridge: "connected",
        inovaLogin: false,
      });
    }
    if (looksLikeMeetingIdentityError(message)) {
      return buildMeetingWorkspaceBlockedAuthPayload(input, providerIdentity, "identity-required", {
        extensionBridge: "connected",
        inovaLogin: true,
      });
    }
    throw error;
  }
}

async function createMeetingShareLink(input, providerIdentity, sender) {
  const owner = await resolveMeetingProviderIdentity(providerIdentity);
  const accessToken = await getInovaAccessToken();
  const functionsConfig = await getMeetingFunctionsConfig();
  const payload = await namespace.cloudApi.createInovaMeetingShareLink({
    jobId: namespace.session.normalizeText(input?.jobId),
    meetingId: namespace.session.normalizeText(input?.meetingId),
  }, owner, accessToken, { functionsConfig });
  return {
    ...payload,
    shareUrl: await buildHostedMeetingCleanUrl({
      jobId: namespace.session.normalizeText(input?.jobId),
      meetingId: namespace.session.normalizeText(input?.meetingId),
      shareToken: namespace.session.normalizeText(payload?.shareToken),
    }),
    senderUrl: namespace.session.normalizeText(sender?.url),
  };
}

async function revokeMeetingShareLink(input, providerIdentity, sender) {
  const owner = await resolveMeetingProviderIdentity(providerIdentity);
  const accessToken = await getInovaAccessToken();
  const functionsConfig = await getMeetingFunctionsConfig();
  const payload = await namespace.cloudApi.revokeInovaMeetingShareLink({
    jobId: namespace.session.normalizeText(input?.jobId),
    meetingId: namespace.session.normalizeText(input?.meetingId),
  }, owner, accessToken, { functionsConfig });
  return {
    ...payload,
    senderUrl: namespace.session.normalizeText(sender?.url),
  };
}

async function probeMeetingWorkspaceBridge(sender) {
  const senderUrl = namespace.session.normalizeText(sender?.url);
  const cookie = await chrome.cookies.get({
    name: "accessToken",
    url: INOVA_ORIGIN,
  }).catch(() => null);
  const accessTokenCookiePresent = Boolean(namespace.session.normalizeText(cookie?.value));

  return {
    accessTokenCookiePresent,
    inovaLoggedIn: accessTokenCookiePresent,
    loginCheckMode: "cookie-only",
    senderUrl,
    tokenRefreshError: "",
    tokenRefreshOk: false,
    tokenRefreshSkipped: true,
    verifiedAt: new Date().toISOString(),
  };
}

async function openHostedMeetingPage(mode, input, providerIdentity, sender) {
  try {
    const owner = await resolveMeetingProviderIdentity(providerIdentity);
    const meetingId = namespace.session.normalizeText(input?.meetingId) || buildMeetingId();
    const jobId = mode === "detail"
      ? namespace.session.normalizeText(input?.jobId)
      : namespace.session.normalizeText(input?.jobId);
    const finalUrl = await buildHostedMeetingCleanUrl({
      jobId,
      meetingId,
    });
    logMeetingDebug("open.start", {
      input: input || {},
      mode,
      providerUserKey: owner.providerUserKey,
      senderTabId: Number(sender?.tab?.id) || 0,
      senderTitle: namespace.session.normalizeText(sender?.tab?.title),
      senderUrl: namespace.session.normalizeText(sender?.url),
    });
    logMeetingDebug("tabs.create", {
      finalUrl,
      hasWorkspaceHash: String(finalUrl || "").includes("#ws="),
      meetingId,
      mode,
    });
    const openedTab = createBrowserTab(finalUrl);
    logMeetingDebug("open.success", {
      finalUrl,
      meetingId,
      mode,
      tabId: Number(openedTab?.id) || 0,
    });
    return {
      expiresAt: "",
      meeting: {
        meetingId,
        title: namespace.session.normalizeText(input?.title || sender?.tab?.title) || "새 회의 룸",
      },
      opened: true,
      tabId: Number(openedTab?.id) || 0,
      url: finalUrl,
    };
  } catch (error) {
    logMeetingDebug("open.error", {
      error: error instanceof Error ? error.message : String(error || ""),
      mode,
    });
    throw error;
  }
}

function createBrowserTab(url) {
  const nextUrl = namespace.session.normalizeText(url);
  if (!nextUrl) {
    throw new Error("열 링크가 없어요.");
  }
  let openedTab = null;
  chrome.tabs.create({ url: nextUrl }, (tab) => {
    const runtimeError = chrome.runtime?.lastError;
    if (runtimeError) {
      console.warn("[i-Nova Service Worker] tab open failed", namespace.session.normalizeText(runtimeError.message) || runtimeError);
      return;
    }
    openedTab = tab || null;
  });
  return openedTab;
}

async function buildHostedMeetingCleanUrl(input) {
  const normalizedSettings = await reconcileMeetingWorkspaceSettings((await namespace.storage.getState())?.settings);
  const url = new URL(await resolveMeetingWorkspacePageUrl());
  if (normalizeMeetingDebugConsoleEnabled(normalizedSettings.meetingDebugConsoleEnabled)) url.searchParams.set("debug", "1");
  const meetingId = namespace.session.normalizeText(input?.meetingId);
  const jobId = namespace.session.normalizeText(input?.jobId);
  const shareToken = namespace.session.normalizeText(input?.shareToken || input?.share);
  if (meetingId) url.searchParams.set("meetingId", meetingId);
  if (jobId) url.searchParams.set("jobId", jobId);
  if (shareToken) url.searchParams.set("share", shareToken);
  return url.toString();
}

async function resolveMeetingWorkspacePageUrl() {
  const runtimeConfig = await getMeetingRuntimeConfig();
  const url = namespace.session.normalizeText(runtimeConfig?.hosting?.meetingWorkspaceUrl) || namespace.firebaseConfig?.hosting?.meetingWorkspaceUrl;
  logMeetingDebug("workspace.target", {
    functionsBaseUrl: namespace.session.normalizeText(runtimeConfig?.functions?.baseUrl),
    target: namespace.session.normalizeText(runtimeConfig?.target) || "production",
    url,
  });
  return url;
}
function normalizeMeetingWorkspaceTarget(value) { return namespace.session.normalizeText(value).toLowerCase() === "local" ? "local" : "production"; }

async function getMeetingFunctionsConfig() {
  const runtimeConfig = await getMeetingRuntimeConfig();
  return runtimeConfig?.functions || namespace.firebaseConfig?.functions || {};
}

async function getPromptFunctionsConfig() {
  const runtimeConfig = await getPromptRuntimeConfig();
  return runtimeConfig?.functions || namespace.firebaseConfig?.functions || {};
}

async function getMeetingRuntimeConfig() {
  const normalizedSettings = await reconcileMeetingWorkspaceSettings((await namespace.storage.getState())?.settings);
  return namespace.firebaseConfig?.meeting?.resolveRuntime?.(normalizedSettings) || {
    functions: namespace.firebaseConfig?.functions || {},
    hosting: namespace.firebaseConfig?.hosting || {},
    target: "production",
  };
}

async function getPromptRuntimeConfig() {
  const normalizedSettings = await reconcileMeetingWorkspaceSettings((await namespace.storage.getState())?.settings);
  return namespace.firebaseConfig?.prompt?.resolveRuntime?.(normalizedSettings) || {
    functions: namespace.firebaseConfig?.functions || {},
    hosting: namespace.firebaseConfig?.hosting || {},
    prompt: namespace.firebaseConfig?.prompt || {},
    target: "production",
    web: namespace.firebaseConfig?.web || {},
  };
}

Object.assign(globalThis, {
  createMeetingShareLink,
  getInovaAccessToken,
  getMeetingFunctionsConfig,
  getPromptFunctionsConfig,
  getPromptRuntimeConfig,
  issueMeetingPanelAuth,
  issuePromptPanelAuth,
  openMeetingResult,
  openMeetingWorkspace,
  openReleaseUrl,
  revokeMeetingShareLink,
});

async function reconcileMeetingWorkspaceSettings(settings) {
  const currentTarget = normalizeMeetingWorkspaceTarget(settings?.meetingWorkspaceTarget);
  const currentDebugEnabled = normalizeMeetingDebugConsoleEnabled(settings?.meetingDebugConsoleEnabled);
  const rawOverride = namespace.session.normalizeText(settings?.meetingWorkspaceUrlOverride);
  const currentOverride = currentTarget === "local"
    ? normalizeMeetingWorkspaceOverrideUrl(rawOverride)
    : rawOverride;
  const nextSettings = {
    meetingDebugConsoleEnabled: currentDebugEnabled,
    meetingWorkspaceTarget: currentTarget,
    meetingWorkspaceUrlOverride: currentTarget === "local"
      ? normalizeLocalMeetingWorkspaceSettingValue(currentOverride)
      : "",
  };
  if (currentTarget === namespace.session.normalizeText(settings?.meetingWorkspaceTarget) && currentDebugEnabled === settings?.meetingDebugConsoleEnabled && nextSettings.meetingWorkspaceUrlOverride === currentOverride) return nextSettings;
  await namespace.storage.updateSettings(nextSettings);
  return nextSettings;
}

function normalizeMeetingDebugConsoleEnabled(value) { if (typeof value === "boolean") return value; const normalized = namespace.session.normalizeText(value).toLowerCase(); return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes"; }

function normalizeMeetingWorkspaceOverrideUrl(value) {
  const normalized = namespace.session.normalizeText(value);
  if (!normalized) {
    return "";
  }
  try {
    const url = new URL(normalized);
    const pathname = String(url.pathname || "");
    if (/\/meeting\/index\.html$/i.test(pathname)) {
      url.search = "";
      url.hash = "";
      return url.toString();
    }
    const basePath = pathname.replace(/\/+$/, "");
    url.pathname = `${basePath}/meeting/index.html`.replace(/\/{2,}/g, "/");
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (error) {
    logMeetingDebug("workspace.override.invalid", {
      error: error instanceof Error ? error.message : String(error || ""),
      value: normalized,
    });
    throw new Error("회의 작업실 주소가 올바르지 않아요. 팝업 설정을 확인해 주세요.", { cause: error });
  }
}

function normalizeLocalMeetingWorkspaceSettingValue(value) {
  const normalized = namespace.session.normalizeText(value);
  if (!normalized) {
    return "";
  }
  return normalizeLocalMeetingWorkspaceUrl(normalized);
}

function normalizeLocalMeetingWorkspaceUrl(value) {
  const normalized = normalizeMeetingWorkspaceOverrideUrl(value);
  const url = new URL(normalized);
  if (!isLoopbackHostname(url.hostname)) {
    logMeetingDebug("workspace.override.non-loopback", { value: normalized });
    throw new Error("로컬 회의 작업실 주소는 localhost 또는 127.0.0.1만 사용할 수 있어요.");
  }
  url.port = "5000";
  url.pathname = "/meeting/index.html";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function buildMeetingId() {
  const partA = Date.now().toString(36);
  const partB = Math.random().toString(36).slice(2, 8);
  return `meeting-${partA}-${partB}`;
}

function buildMeetingWorkspaceBlockedAuthPayload(input, viewer, reason, options = {}) {
  return {
    accessDecision: "denied",
    accessMode: "blocked",
    bypassApplied: false,
    bypassMode: "",
    extensionBridge: namespace.session.normalizeText(options?.extensionBridge) || "connected",
    firebaseCustomToken: "",
    inovaLogin: options?.inovaLogin !== false,
    meetingDocumentId: "",
    meetingId: namespace.session.normalizeText(input?.meetingId),
    readOnly: false,
    reason: namespace.session.normalizeText(reason),
    shareId: "",
    viewer: {
      displayName: namespace.session.normalizeText(viewer?.displayName),
      email: namespace.session.normalizeText(viewer?.email),
      providerUserKey: namespace.session.normalizeText(viewer?.providerUserKey),
    },
  };
}

function looksLikeMeetingLoginError(message) {
  const normalized = namespace.session.normalizeText(message).toLowerCase();
  return normalized.includes("로그인")
    || normalized.includes("access token")
    || normalized.includes("refresh")
    || normalized.includes("unauth")
    || normalized.includes("401")
    || normalized.includes("403");
}

function looksLikeMeetingIdentityError(message) {
  const normalized = namespace.session.normalizeText(message).toLowerCase();
  return normalized.includes("사용자 키")
    || normalized.includes("provideruserkey")
    || normalized.includes("provider user key");
}

function isLoopbackHostname(value) {
  return ["127.0.0.1", "localhost"].includes(namespace.session.normalizeText(value).toLowerCase());
}

function logMeetingDebug() {
  return;
}

async function resolveMeetingProviderIdentity(providerIdentity) {
  const normalized = normalizeProviderIdentity(providerIdentity);
  if (normalized.providerUserKey) {
    await persistMeetingProviderIdentity(normalized);
    return normalized;
  }
  const persisted = await loadStoredMeetingProviderIdentity();
  if (persisted.providerUserKey) {
    return persisted;
  }
  const activeInovaIdentity = await requestMeetingProviderIdentityFromInovaTabs();
  return activeInovaIdentity.providerUserKey ? activeInovaIdentity : normalized;
}

function normalizeProviderIdentity(providerIdentity) {
  return {
    displayName: namespace.session.normalizeText(providerIdentity?.displayName),
    email: namespace.session.normalizeText(providerIdentity?.email).toLowerCase(),
    numericUserId: Number.isFinite(Number(providerIdentity?.numericUserId)) ? Number(providerIdentity.numericUserId) : null,
    provider: namespace.session.normalizeText(providerIdentity?.provider) || "inova",
    providerUserKey: namespace.session.normalizeText(providerIdentity?.providerUserKey),
  };
}

async function loadStoredMeetingProviderIdentity() {
  try {
    if (typeof namespace.storage.getProviderIdentityCacheState === "function") {
      const providerIdentityCache = await namespace.storage.getProviderIdentityCacheState();
      return normalizeProviderIdentity(providerIdentityCache?.providerIdentity);
    }
    const storageState = await namespace.storage.getState();
    return normalizeProviderIdentity(storageState?.providerIdentityCache?.providerIdentity);
  } catch (error) {
    void error;
    return normalizeProviderIdentity(null);
  }
}

async function persistMeetingProviderIdentity(providerIdentity) {
  const normalized = normalizeProviderIdentity(providerIdentity);
  if (
    !normalized.providerUserKey
    || typeof namespace.storage.getProviderIdentityCacheState !== "function"
    || typeof namespace.storage.setProviderIdentityCacheState !== "function"
  ) {
    return normalized;
  }
  try {
    const current = await namespace.storage.getProviderIdentityCacheState();
    const currentIdentity = normalizeProviderIdentity(current?.providerIdentity);
    if (
      currentIdentity.providerUserKey === normalized.providerUserKey
      && currentIdentity.email === normalized.email
      && currentIdentity.displayName === normalized.displayName
      && currentIdentity.numericUserId === normalized.numericUserId
    ) {
      return normalized;
    }
    await namespace.storage.setProviderIdentityCacheState({
      ...(current && typeof current === "object" ? current : {}),
      providerIdentity: {
        ...currentIdentity,
        ...normalized,
        available: true,
      },
    });
  } catch (error) {
    void error;
  }
  return normalized;
}

async function requestMeetingProviderIdentityFromInovaTabs() {
  if (!chrome.tabs?.query || !chrome.tabs?.sendMessage) {
    return normalizeProviderIdentity(null);
  }
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: `${INOVA_ORIGIN}/*` });
  } catch (error) {
    void error;
    return normalizeProviderIdentity(null);
  }
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    const tabId = Number(tab?.id) || 0;
    if (!tabId) continue;
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "inova-meeting:get-provider-identity",
      });
      const normalized = normalizeProviderIdentity(response?.providerIdentity);
      if (normalized.providerUserKey) {
        await persistMeetingProviderIdentity(normalized);
        return normalized;
      }
    } catch (error) {
      void error;
    }
  }
  return normalizeProviderIdentity(null);
}

function isAllowedSender(message, sender) {
  return String(sender?.url || "").startsWith(INOVA_ORIGIN)
    || (
      [
        "inova-meeting:authorize-workspace-access",
        "inova-meeting:probe-workspace-bridge",
      ].includes(message.type)
      && isHostedMeetingWorkspaceSender(sender)
    );
}

function isHostedMeetingWorkspaceSender(sender) {
  try {
    const url = new URL(String(sender?.url || ""));
    return HOSTED_MEETING_ALLOWED_ORIGINS.has(url.origin)
      && /\/meeting\/index\.html$/i.test(String(url.pathname || ""));
  } catch (error) {
    void error;
    return false;
  }
}
