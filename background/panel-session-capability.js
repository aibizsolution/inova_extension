(function initPanelSessionCapability(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const INOVA_ORIGIN = "https://inova.incross.com";
  const functionsRuntimeConfig = namespace.functionsRuntimeConfig || {};
  const panelAuthCache = namespace.panelAuthCache?.create?.(getInovaAccessToken);

  async function getInovaAccessToken(forceRefresh = false) {
    if (forceRefresh) {
      return namespace.inovaAuth.getAccessToken(true);
    }
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
    const functionsConfig = await getMeetingFunctionsConfig();
    return panelAuthCache.issueMeetingPanelAuth(providerIdentity, { functionsConfig });
  }

  async function getPromptFunctionsConfig() {
    const runtimeConfig = await getPromptRuntimeConfig();
    return runtimeConfig?.functions || {};
  }

  async function getMeetingFunctionsConfig() {
    const runtimeConfig = await functionsRuntimeConfig.getMeetingRuntimeConfig?.();
    return runtimeConfig?.functions || {};
  }

  async function getPromptRuntimeConfig() {
    return functionsRuntimeConfig.getPromptRuntimeConfig?.() || {
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
