importScripts("../shared/constants.js");
importScripts("../shared/product-lane.js");
importScripts("../shared/session.js");
importScripts("../shared/provider-identity-cache.js");
importScripts("../shared/storage.js");
importScripts("../shared/firebase-config.js");
importScripts("capability-manifest-validator.js");
importScripts("functions-runtime-config.js");
importScripts("inova-auth-client.js");
importScripts("cloud-api-client.js");
importScripts("browser-capability.js");
importScripts("meeting-workspace-capability.js");
importScripts("admin-console-capability.js");
importScripts("panel-auth-cache.js");
importScripts("panel-session-capability.js");
importScripts("panel-runtime-capability-router.js");
importScripts("panel-runtime-invoke.js");

const namespace = globalThis.InovaBookmarks || {};
const INOVA_ORIGIN = "https://inova.incross.com";
const ACTIVE_BACKGROUND_MESSAGE_TYPES = Object.freeze([
  "inova-meeting:authorize-workspace-access",
  "inova-meeting:probe-workspace-bridge",
  "inova-panel:invoke",
]);
const browserCapability = namespace.browserCapability || {};
const functionsRuntimeConfig = namespace.functionsRuntimeConfig || {};
const meetingWorkspaceCapability = namespace.meetingWorkspaceCapability || {};
const adminConsoleCapability = namespace.adminConsoleCapability || {};
const panelSessionCapability = namespace.panelSessionCapability || {};

browserCapability.installLocalPanelCspRuleSync?.();

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

Object.assign(globalThis, {
  getInovaAccessToken: panelSessionCapability.getInovaAccessToken,
  createMeetingShareLink: meetingWorkspaceCapability.createShareLink,
  getMeetingFunctionsConfig: functionsRuntimeConfig.getMeetingFunctionsConfig,
  getPromptFunctionsConfig: functionsRuntimeConfig.getPromptFunctionsConfig,
  getPromptRuntimeConfig: functionsRuntimeConfig.getPromptRuntimeConfig,
  issueMeetingPanelAuth: panelSessionCapability.issueMeetingPanelAuth,
  issuePromptPanelAuth: panelSessionCapability.issuePromptPanelAuth,
  openAdminConsole: adminConsoleCapability.openConsole,
  openMeetingResult: meetingWorkspaceCapability.openResult,
  openMeetingWorkspace: meetingWorkspaceCapability.openWorkspace,
  prepareMeetingResultOpen: meetingWorkspaceCapability.prepareResultOpen,
  prepareMeetingWorkspaceOpen: meetingWorkspaceCapability.prepareWorkspaceOpen,
  openBrowserUrl: browserCapability.openUrl,
  revokeMeetingShareLink: meetingWorkspaceCapability.revokeShareLink,
});

function isAllowedSender(message, sender) {
  return isInovaPageSender(sender)
    || (
      [
        "inova-meeting:authorize-workspace-access",
        "inova-meeting:probe-workspace-bridge",
      ].includes(message.type)
      && meetingWorkspaceCapability.isHostedWorkspaceSender(sender)
    );
}

function isInovaPageSender(sender) {
  try {
    return new URL(String(sender?.url || "")).origin === INOVA_ORIGIN;
  } catch (error) {
    void error;
    return false;
  }
}
