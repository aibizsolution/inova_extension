(function initPanelSessionCapability(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const INOVA_ORIGIN = "https://inova.incross.com";
  const meetingWorkspaceCapability = namespace.meetingWorkspaceCapability || {};
  const panelAuthCache = namespace.panelAuthCache?.create?.(getInovaAccessToken);

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

  async function issueMeetingPanelAuth(providerIdentity) {
    const functionsConfig = await meetingWorkspaceCapability.getMeetingFunctionsConfig();
    return panelAuthCache.issueMeetingPanelAuth(providerIdentity, { functionsConfig });
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

  namespace.panelSessionCapability = {
    getInovaAccessToken,
    getPromptFunctionsConfig,
    getPromptRuntimeConfig,
    issueMeetingPanelAuth,
    issuePromptPanelAuth,
  };
})(globalThis);
