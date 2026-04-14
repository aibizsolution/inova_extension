(function initFrameProxy(global) {
  const ALLOWED_TARGET_ORIGINS = new Set([
    "http://127.0.0.1:5000",
    "http://localhost:5000",
    "https://browser-extension-main.web.app",
    "https://browser-extension-v2.web.app",
  ]);
  const PARENT_ORIGIN_PARAM = "inovaParentOrigin";
  const state = {
    innerLoaded: false,
    parentOrigin: readReferrerOrigin(),
    pendingMessages: [],
    targetOrigin: "",
    targetUrl: "",
  };

  const body = global.document.body;
  const status = global.document.getElementById("inova-frame-proxy-status");
  const targetFrame = global.document.getElementById("inova-frame-proxy-target");

  bootstrap();

  function bootstrap() {
    const resolvedTarget = resolveTargetUrl();
    if (!(targetFrame instanceof global.HTMLIFrameElement) || !resolvedTarget) {
      renderError("프록시할 호스팅 주소를 찾지 못했어요.");
      return;
    }
    state.targetUrl = resolvedTarget;
    state.targetOrigin = readOrigin(resolvedTarget);
    global.addEventListener("message", handleWindowMessage);
    targetFrame.addEventListener("load", handleTargetLoad, { once: false });
    targetFrame.src = buildTargetFrameUrl(resolvedTarget);
  }

  function handleTargetLoad() {
    state.innerLoaded = true;
    setBodyStatus("ready");
    flushPendingMessages();
  }

  function handleWindowMessage(event) {
    if (!(targetFrame instanceof global.HTMLIFrameElement)) {
      return;
    }
    if (event.source === global.parent) {
      handleParentMessage(event);
      return;
    }
    if (event.source === targetFrame.contentWindow) {
      handleTargetMessage(event);
    }
  }

  function handleParentMessage(event) {
    const nextParentOrigin = readOrigin(event.origin);
    if (state.parentOrigin && nextParentOrigin && state.parentOrigin !== nextParentOrigin) {
      return;
    }
    if (!state.parentOrigin) {
      state.parentOrigin = nextParentOrigin;
    }
    const payload = {
      data: event.data,
      ports: Array.isArray(event.ports) ? event.ports : [],
    };
    if (!state.innerLoaded || !targetFrame.contentWindow) {
      state.pendingMessages.push(payload);
      return;
    }
    postToTarget(payload);
  }

  function handleTargetMessage(event) {
    if (readOrigin(event.origin) !== state.targetOrigin) {
      return;
    }
    const ports = Array.isArray(event.ports) ? event.ports : [];
    global.parent.postMessage(
      event.data,
      state.parentOrigin || "*",
      ports
    );
  }

  function flushPendingMessages() {
    if (!state.innerLoaded || !targetFrame.contentWindow) {
      return;
    }
    for (const payload of state.pendingMessages.splice(0)) {
      postToTarget(payload);
    }
  }

  function postToTarget(payload) {
    if (!targetFrame.contentWindow || !state.targetOrigin) {
      return;
    }
    targetFrame.contentWindow.postMessage(
      payload?.data,
      state.targetOrigin,
      Array.isArray(payload?.ports) ? payload.ports : []
    );
  }

  function resolveTargetUrl() {
    const params = new URLSearchParams(global.location.search || "");
    const target = String(params.get("target") || "").trim();
    const targetOrigin = readOrigin(target);
    if (!target || !targetOrigin || !ALLOWED_TARGET_ORIGINS.has(targetOrigin)) {
      return "";
    }
    return target;
  }

  function buildTargetFrameUrl(targetUrl) {
    try {
      const url = new URL(targetUrl);
      if (!url.searchParams.get(PARENT_ORIGIN_PARAM)) {
        url.searchParams.set(PARENT_ORIGIN_PARAM, global.location.origin || "");
      }
      return url.toString();
    } catch {
      return targetUrl;
    }
  }

  function renderError(message) {
    if (status instanceof global.HTMLElement) {
      status.textContent = String(message || "호스팅 프레임을 열지 못했어요.");
    }
    setBodyStatus("error");
  }

  function setBodyStatus(value) {
    if (!(body instanceof global.HTMLElement)) {
      return;
    }
    body.dataset.status = String(value || "loading");
  }

  function readReferrerOrigin() {
    try {
      return new URL(global.document.referrer || "").origin;
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
})(globalThis);
