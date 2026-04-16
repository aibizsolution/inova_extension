(function initPanelUtils(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function normalizeText(value) {
    return namespace.session.normalizeText(value);
  }

  function normalizePanelTarget(value) {
    return normalizeText(value).toLowerCase() === "local" ? "local" : "production";
  }

  function isAuthExpiring(expiresAt, skewMs = 60000) {
    const expiryTime = Date.parse(normalizeText(expiresAt));
    return !(expiryTime > Date.now() + Math.max(0, Number(skewMs) || 0));
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function readErrorMessage(error, fallbackMessage) {
    const message = normalizeText(error instanceof Error ? error.message : error);
    return message || normalizeText(fallbackMessage);
  }

  function resolveBrowserCapabilities(options) {
    const providedCapabilities = options?.browserCapabilities;
    if (providedCapabilities && typeof providedCapabilities === "object") {
      return providedCapabilities;
    }
    return namespace.extensionCapabilityClient?.create?.({
      invokePage: options?.invokePage,
      invokeRuntime: options?.invokeRuntime,
    }) || {};
  }

  namespace.panelUtils = Object.freeze({
    cloneValue,
    isAuthExpiring,
    normalizePanelTarget,
    normalizeText,
    readErrorMessage,
    resolveBrowserCapabilities,
  });
})(globalThis);
