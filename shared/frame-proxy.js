(function initFrameProxyHelpers(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
  const PROXY_PATH = "content/frame-proxy.html";

  function resolveTarget(targetUrl) {
    const normalizedTargetUrl = normalizeText(targetUrl);
    const proxyUrl = shouldWrap(normalizedTargetUrl) ? buildProxyUrl(normalizedTargetUrl) : "";
    const src = proxyUrl || normalizedTargetUrl;
    return {
      origin: readOrigin(src),
      src,
      targetUrl: normalizedTargetUrl,
      wrapped: Boolean(proxyUrl),
    };
  }

  function shouldWrap(targetUrl) {
    return LOOPBACK_HOSTNAMES.has(readHostname(targetUrl));
  }

  function buildProxyUrl(targetUrl) {
    const proxyBaseUrl = normalizeText(global.chrome?.runtime?.getURL?.(PROXY_PATH));
    if (!proxyBaseUrl) {
      return "";
    }
    const url = new URL(proxyBaseUrl);
    url.searchParams.set("target", targetUrl);
    return url.toString();
  }

  function readHostname(value) {
    try {
      return new URL(String(value || "")).hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  function readOrigin(value) {
    try {
      return new URL(String(value || "")).origin;
    } catch {
      return "";
    }
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value || "").trim();
  }

  namespace.frameProxy = {
    resolveTarget,
  };
})(globalThis);
