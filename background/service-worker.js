importScripts("../shared/constants.js");
importScripts("../shared/product-lane.js");
importScripts("../shared/session.js");
importScripts("../shared/provider-identity-cache.js");
importScripts("../shared/storage.js");
importScripts("../shared/firebase-config.js");
importScripts("../shared/inova-auth.js");
importScripts("../shared/cloud-api.js");
importScripts("meeting-workspace-capability.js");
importScripts("panel-auth-cache.js");
importScripts("panel-runtime-capability-router.js");
importScripts("panel-runtime-invoke.js");

const namespace = globalThis.InovaBookmarks || {};
const INOVA_ORIGIN = "https://inova.incross.com";
const ACTIVE_BACKGROUND_MESSAGE_TYPES = Object.freeze([
  "inova-meeting:authorize-workspace-access",
  "inova-meeting:probe-workspace-bridge",
  "inova-panel:invoke",
]);
const meetingWorkspaceCapability = namespace.meetingWorkspaceCapability || {};
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
    return meetingWorkspaceCapability.authorizeWorkspaceAccess(message.input, message.providerIdentity, sender);
  }
  if (message.type === "inova-meeting:probe-workspace-bridge") {
    return meetingWorkspaceCapability.probeWorkspaceBridge(sender);
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

async function issueMeetingPanelAuth(providerIdentity) {
  const functionsConfig = await meetingWorkspaceCapability.getMeetingFunctionsConfig();
  return panelAuthCache.issueMeetingPanelAuth(providerIdentity, { functionsConfig });
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

async function getPromptFunctionsConfig() {
  const runtimeConfig = await getPromptRuntimeConfig();
  return runtimeConfig?.functions || namespace.firebaseConfig?.functions || {};
}

async function getPromptRuntimeConfig() {
  const normalizedSettings = await meetingWorkspaceCapability.reconcileSettings((await namespace.storage.getState())?.settings);
  return namespace.firebaseConfig?.prompt?.resolveRuntime?.(normalizedSettings) || {
    functions: namespace.firebaseConfig?.functions || {},
    hosting: namespace.firebaseConfig?.hosting || {},
    prompt: namespace.firebaseConfig?.prompt || {},
    target: "production",
    web: namespace.firebaseConfig?.web || {},
  };
}

Object.assign(globalThis, {
  getInovaAccessToken,
  createMeetingShareLink: meetingWorkspaceCapability.createShareLink,
  getMeetingFunctionsConfig: meetingWorkspaceCapability.getMeetingFunctionsConfig,
  getPromptFunctionsConfig,
  getPromptRuntimeConfig,
  issueMeetingPanelAuth,
  issuePromptPanelAuth,
  openMeetingResult: meetingWorkspaceCapability.openResult,
  openMeetingWorkspace: meetingWorkspaceCapability.openWorkspace,
  openReleaseUrl,
  revokeMeetingShareLink: meetingWorkspaceCapability.revokeShareLink,
});

function isAllowedSender(message, sender) {
  return String(sender?.url || "").startsWith(INOVA_ORIGIN)
    || (
      [
        "inova-meeting:authorize-workspace-access",
        "inova-meeting:probe-workspace-bridge",
      ].includes(message.type)
      && meetingWorkspaceCapability.isHostedWorkspaceSender(sender)
    );
}
