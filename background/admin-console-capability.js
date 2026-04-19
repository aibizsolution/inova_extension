(function initAdminConsoleCapability(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const browserCapability = namespace.browserCapability || {};
  const functionsRuntimeConfig = namespace.functionsRuntimeConfig || {};
  const normalizeProviderIdentity = typeof namespace.providerIdentityCache?.normalizeProviderIdentity === "function"
    ? namespace.providerIdentityCache.normalizeProviderIdentity
    : (providerIdentity) => providerIdentity && typeof providerIdentity === "object" ? { ...providerIdentity } : {};

  async function openConsole(input = {}, providerIdentity) {
    const launchToken = namespace.session.normalizeText(input?.launchToken);
    if (!launchToken) {
      throw new Error("관리 콘솔 열기 토큰이 없어요.");
    }
    const adminUrl = await buildAdminConsoleUrl(launchToken);
    const opened = await browserCapability.openUrl(adminUrl);
    return {
      opened: true,
      providerUserKey: namespace.session.normalizeText(providerIdentity?.providerUserKey),
      tabId: Number(opened?.tabId) || 0,
      url: adminUrl,
    };
  }

  async function buildAdminConsoleUrl(launchToken) {
    const runtimeConfig = await getPanelRuntimeConfig();
    const originUrl = namespace.session.normalizeText(runtimeConfig?.hosting?.originUrl)
      || namespace.session.normalizeText(namespace.firebaseConfig?.hosting?.originUrl);
    if (!originUrl) {
      throw new Error("관리 콘솔 hosting origin을 찾지 못했어요.");
    }
    const url = new URL("/admin/index.html", originUrl);
    url.searchParams.set("launch", namespace.session.normalizeText(launchToken));
    return url.toString();
  }

  async function getPanelRuntimeConfig() {
    const storageState = await namespace.storage?.getState?.().catch(() => ({}));
    const settings = storageState?.settings && typeof storageState.settings === "object"
      ? storageState.settings
      : {};
    if (typeof functionsRuntimeConfig.getPromptRuntimeConfig === "function") {
      return functionsRuntimeConfig.getPromptRuntimeConfig(settings);
    }
    return {
      hosting: namespace.firebaseConfig?.hosting || {},
      target: "production",
    };
  }

  function normalizeIdentity(providerIdentity) {
    return normalizeProviderIdentity(providerIdentity);
  }

  namespace.adminConsoleCapability = {
    normalizeIdentity,
    openConsole,
  };
})(globalThis);
