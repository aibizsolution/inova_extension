(function initFrameProxyHelpers(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const normalizeText = namespace.session.normalizeText;
  const INVALIDATED_CONTEXT_MESSAGE = "확장프로그램이 갱신됐어요. 페이지를 새로고침해 주세요.";
  const PROXY_PATH = "content/frame-proxy.html";

  function resolveTarget(targetUrl) {
    const normalizedTargetUrl = normalizeText(targetUrl);
    if (!shouldWrap(normalizedTargetUrl)) {
      return {
        error: "",
        origin: readOrigin(normalizedTargetUrl),
        src: normalizedTargetUrl,
        targetUrl: normalizedTargetUrl,
        wrapped: false,
      };
    }
    const proxyResolution = buildProxyUrl(normalizedTargetUrl);
    const src = proxyResolution.url;
    return {
      error: proxyResolution.error,
      origin: readOrigin(src),
      src,
      targetUrl: normalizedTargetUrl,
      wrapped: true,
    };
  }

  function shouldWrap(targetUrl) {
    void targetUrl;
    return global.__INOVA_FORCE_FRAME_PROXY__ === true;
  }

  function buildProxyUrl(targetUrl) {
    const proxyBaseUrlResult = readProxyBaseUrl();
    if (!proxyBaseUrlResult.url) {
      return {
        error: proxyBaseUrlResult.error,
        url: "",
      };
    }
    const url = new URL(proxyBaseUrlResult.url);
    url.searchParams.set("target", targetUrl);
    return {
      error: "",
      url: url.toString(),
    };
  }

  function readProxyBaseUrl() {
    try {
      return {
        error: "",
        url: normalizeText(global.chrome?.runtime?.getURL?.(PROXY_PATH)),
      };
    } catch (error) {
      return {
        error: isInvalidatedContextError(error)
          ? INVALIDATED_CONTEXT_MESSAGE
          : normalizeText(error?.message || "프록시 iframe 주소를 만들지 못했어요."),
        url: "",
      };
    }
  }

  function readOrigin(value) {
    try {
      return new URL(String(value || "")).origin;
    } catch {
      return "";
    }
  }

  function isInvalidatedContextError(error) {
    const message = normalizeText(error?.message || error);
    return hasInvalidatedRuntimeSignal()
      || message.includes("Extension context invalidated")
      || message.includes("확장프로그램이 갱신");
  }

  function hasInvalidatedRuntimeSignal() {
    try {
      const runtime = global.chrome?.runtime;
      if (!runtime) {
        return false;
      }
      const runtimeIdMissing = Object.prototype.hasOwnProperty.call(runtime, "id") && !normalizeText(runtime.id);
      const lastErrorMessage = normalizeText(runtime.lastError?.message).toLowerCase();
      return runtimeIdMissing || lastErrorMessage.includes("extension context invalidated");
    } catch {
      return true;
    }
  }

  namespace.frameProxy = {
    resolveTarget,
  };
})(globalThis);
