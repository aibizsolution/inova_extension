(function initContentPanel(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const normalizeText = namespace.session.normalizeText;
  const HANDSHAKE_TIMEOUT_MS = 4000;
  let panelHost = null;
  const panelConsoleTrace = namespace.panelConsoleTrace;
  const panelHostBridge = namespace.panelHostBridge;
  const panelHostRuntime = namespace.panelHostRuntime;
  const panelHostView = namespace.panelHostView;
  if (!panelConsoleTrace || typeof panelConsoleTrace.create !== "function") {
    throw new Error("panelConsoleTrace must load before contentPanel");
  }
  if (!panelHostBridge || typeof panelHostBridge.create !== "function") {
    throw new Error("panelHostBridge must load before contentPanel");
  }
  if (!panelHostRuntime || typeof panelHostRuntime.create !== "function") {
    throw new Error("panelHostRuntime must load before contentPanel");
  }
  if (!panelHostView || typeof panelHostView.create !== "function") {
    throw new Error("panelHostView must load before contentPanel");
  }
  const hostView = panelHostView.create();
  const traceController = panelConsoleTrace.create({
    isDebugEnabled: () => Boolean(namespace.panelDebug?.isEnabled?.()),
    normalizeText,
  });
  const logConsoleTrace = traceController.log;
  const hostRuntime = panelHostRuntime.create({
    applyHandleRatio: hostView.applyHandleRatio,
    buildPanelSnapshotTracePayload: traceController.buildPanelSnapshotTracePayload,
    handshakeTimeoutMs: HANDSHAKE_TIMEOUT_MS,
    logConsoleTrace,
    normalizeText,
    readExtensionVersion,
  });
  const hostBridge = panelHostBridge.create({
    hostRuntime,
    logConsoleTrace,
    normalizeText,
  });

  function ensurePanel(callbacks) {
    let host = getPanelHost();
    if (host) {
      logConsoleTrace("panel", "01.top.panel.ensure.reuse", {
        bridgeReady: Boolean(host.__bridgeReady),
        frameSrc: normalizeText(host.__panelFrameSrc),
      });
      host.__callbacks = callbacks;
      host.__panelElements = host.__panelElements || hostRuntime.resolveElements(host);
      host.__bridge = host.__bridge || hostBridge.createHostedBridge(host);
      return host;
    }
    host = document.createElement("div");
    host.id = "inova-bookmark-host";
    host.__callbacks = callbacks;
    host.innerHTML = hostView.buildMarkup();
    document.body.appendChild(host);
    panelHost = host;
    logConsoleTrace("panel", "02.top.panel.host.created", {
      hostId: host.id,
    });
    host.__panelElements = hostRuntime.resolveElements(host);
    host.__bridge = hostBridge.createHostedBridge(host);
    const { frame, handle } = host.__panelElements;
    hostView.installHandleInteractions(host, handle, callbacks);
    frame?.addEventListener("load", () => hostRuntime.handleFrameLoad(host));
    return host;
  }

  function renderPanel(state) {
    const host = getPanelHost();
    if (!host) {
      return;
    }
    hostRuntime.render(host, state);
  }

  function syncPanelChrome(chromeState) {
    const host = getPanelHost();
    if (!host) {
      return false;
    }
    return hostRuntime.syncPanelChrome(host, chromeState);
  }

  function getPanelHost() {
    if (panelHost?.isConnected) {
      return panelHost;
    }
    panelHost = document.getElementById("inova-bookmark-host");
    return panelHost;
  }

  function readExtensionVersion() {
    try {
      return normalizeText(global.chrome?.runtime?.getManifest?.()?.version);
    } catch {
      return "";
    }
  }

  namespace.contentPanel = {
    ensurePanel,
    focusBookmark(bookmarkId) {
      hostBridge.emitPageEvent(panelHost, "focus-bookmark", {
        bookmarkId: normalizeText(bookmarkId),
      });
    },
    emitPanelEvent(action, payload = {}) {
      return hostBridge.emitPanelEvent(panelHost, normalizeText(action), payload);
    },
    renderPanel,
    setActiveBookmark(bookmarkId) {
      hostBridge.emitPageEvent(panelHost, "set-active-bookmark", {
        bookmarkId: normalizeText(bookmarkId),
      });
    },
    syncPanelChrome,
  };
  panelConsoleTrace.buildPanelSnapshotTracePayload = traceController.buildPanelSnapshotTracePayload;
  panelConsoleTrace.log = logConsoleTrace;
  namespace.panelConsoleTrace = panelConsoleTrace;
})(globalThis);
