(function initContentPanel(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const HANDSHAKE_TIMEOUT_MS = 4000;
  let panelHost = null;
  const panelConsoleTrace = namespace.panelConsoleTrace;
  const panelHostRuntime = namespace.panelHostRuntime;
  if (!panelConsoleTrace || typeof panelConsoleTrace.create !== "function") {
    throw new Error("panelConsoleTrace must load before contentPanel");
  }
  if (!panelHostRuntime || typeof panelHostRuntime.create !== "function") {
    throw new Error("panelHostRuntime must load before contentPanel");
  }
  const traceController = panelConsoleTrace.create({
    isDebugEnabled: () => Boolean(namespace.panelDebug?.isEnabled?.()),
    normalizeText,
  });
  const logConsoleTrace = traceController.log;
  const hostRuntime = panelHostRuntime.create({
    applyHandleRatio,
    buildPanelSnapshotTracePayload: traceController.buildPanelSnapshotTracePayload,
    handshakeTimeoutMs: HANDSHAKE_TIMEOUT_MS,
    logConsoleTrace,
    normalizeText,
    readExtensionVersion,
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
      host.__bridge = host.__bridge || createHostedBridge(host);
      return host;
    }
    host = document.createElement("div");
    host.id = "inova-bookmark-host";
    host.__callbacks = callbacks;
    host.innerHTML = buildMarkup();
    document.body.appendChild(host);
    panelHost = host;
    logConsoleTrace("panel", "02.top.panel.host.created", {
      hostId: host.id,
    });
    host.__panelElements = hostRuntime.resolveElements(host);
    host.__bridge = createHostedBridge(host);
    const { frame, handle } = host.__panelElements;
    installHandleInteractions(host, handle, callbacks);
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

  function getPanelHost() {
    if (panelHost?.isConnected) {
      return panelHost;
    }
    panelHost = document.getElementById("inova-bookmark-host");
    return panelHost;
  }

  function createHostedBridge(host) {
    const bridge = namespace.hostedPanelBridge.create({
      onError: ({ error }) => {
        const message = normalizeText(error instanceof Error ? error.message : error) || "호스팅 패널과 연결하지 못했어요.";
        logConsoleTrace("panel", "09.top.panel.bridge.error", {
          message,
        });
        hostRuntime.updateStatusBanner(host, {
          text: message,
          tone: "error",
        });
      },
      onReadyChange: ({ ready }) => {
        hostRuntime.handleBridgeReadyChange(host, ready);
      },
      onRequest: async (request) => {
        const isTransportTrace = isTraceTransportRequest(request);
        if (!isTransportTrace) {
          logConsoleTrace("panel", "20.top.panel.bridge.request.received", {
            action: normalizeText(request?.payload?.action),
            domain: normalizeText(request?.domain),
            requestId: normalizeText(request?.requestId),
          });
        }
        try {
          const result = (await namespace.panelHostedBridgeRequest?.handle?.(request, {
            callbacks: host.__callbacks || {},
            logConsoleTrace,
            normalizeText,
          })) || {
            handled: false,
            result: null,
          };
          if (!isTransportTrace) {
            logConsoleTrace("panel", "21.top.panel.bridge.request.completed", {
              action: normalizeText(request?.payload?.action),
              domain: normalizeText(request?.domain),
              requestId: normalizeText(request?.requestId),
            });
          }
          return result;
        } catch (error) {
          if (!isTransportTrace) {
            logConsoleTrace("panel", "21.top.panel.bridge.request.error", {
              action: normalizeText(request?.payload?.action),
              domain: normalizeText(request?.domain),
              error: normalizeText(error instanceof Error ? error.message : String(error || "")),
              requestId: normalizeText(request?.requestId),
            });
          }
          throw error;
        }
      },
    });
    bridge.attach();
    logConsoleTrace("panel", "03.top.panel.bridge.attached", {});
    return bridge;
  }

  function readExtensionVersion() {
    try {
      return normalizeText(global.chrome?.runtime?.getManifest?.()?.version);
    } catch {
      return "";
    }
  }

  function installHandleInteractions(host, handle, callbacks) {
    const dragState = { dragging: false, moved: false, pointerId: -1, startRatio: 0, startY: 0 };
    handle.addEventListener("click", (event) => {
      if (dragState.moved) {
        event.preventDefault();
        dragState.moved = false;
        return;
      }
      callbacks.onToggle?.();
    });
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      dragState.dragging = true;
      dragState.moved = false;
      dragState.pointerId = event.pointerId;
      dragState.startY = event.clientY;
      dragState.startRatio = readHandleRatio(host);
      handle.classList.add("is-dragging");
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!dragState.dragging || event.pointerId !== dragState.pointerId) {
        return;
      }
      const deltaY = event.clientY - dragState.startY;
      if (Math.abs(deltaY) > 6) {
        dragState.moved = true;
      }
      applyHandleRatio(host, clampRatio(dragState.startRatio + deltaY / getHandleTrackHeight(handle.offsetHeight)));
    });
    ["pointerup", "pointercancel"].forEach((type) => handle.addEventListener(type, (event) => finishHandleDrag(event, host, handle, callbacks, dragState)));
  }

  function finishHandleDrag(event, host, handle, callbacks, dragState) {
    if (!dragState.dragging || event.pointerId !== dragState.pointerId) {
      return;
    }
    dragState.dragging = false;
    dragState.pointerId = -1;
    handle.classList.remove("is-dragging");
    handle.releasePointerCapture?.(event.pointerId);
    if (dragState.moved) {
      callbacks.onHandlePositionChange?.(readHandleRatio(host));
    }
  }

  function getHandleTrackHeight(handleHeight) {
    const viewportHeight = global.innerHeight || document.documentElement.clientHeight || 0;
    return Math.max(1, viewportHeight - (viewportHeight <= 760 ? 90 : 120) - handleHeight);
  }

  function applyHandleRatio(host, value) {
    host.style.setProperty("--handle-ratio", String(clampRatio(value)));
  }

  function readHandleRatio(host) {
    const ratio = Number.parseFloat(host.style.getPropertyValue("--handle-ratio"));
    return clampRatio(Number.isFinite(ratio) ? ratio : 0.4);
  }

  function clampRatio(value) {
    return Math.min(1, Math.max(0, Number(value) || 0));
  }

  function buildMarkup() {
    return `
      <div id="inova-bookmark-root" data-open="false" aria-live="polite">
        <button id="inova-bookmark-handle" type="button" aria-label="실험실 패널 열기" title="드래그해서 위치를 바꿀 수 있어요">
          <span class="handle-count">0</span>
          <span class="handle-label"><span>실</span><span>험</span><span>실</span></span>
        </button>
        <div id="inova-bookmark-panel">
          <section class="inova-hosted-panel-shell">
            <div id="inova-hosted-panel-status" class="inova-hosted-panel-status" hidden></div>
            <iframe
              id="inova-hosted-panel-frame"
              class="inova-hosted-panel-frame"
              title="i-Nova 실험실"
              referrerpolicy="no-referrer"
            ></iframe>
          </section>
        </div>
      </div>
    `;
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value || "").trim();
  }

  function isTraceTransportRequest(request) {
    return normalizeText(request?.domain) === "page"
      && normalizeText(request?.payload?.action) === "log-trace";
  }

  namespace.contentPanel = {
    ensurePanel,
    focusBookmark(bookmarkId) {
      panelHost?.__bridge?.emitEvent?.("page", {
        action: "focus-bookmark",
        bookmarkId: normalizeText(bookmarkId),
      });
    },
    renderPanel,
    setActiveBookmark(bookmarkId) {
      panelHost?.__bridge?.emitEvent?.("page", {
        action: "set-active-bookmark",
        bookmarkId: normalizeText(bookmarkId),
      });
    },
  };
  panelConsoleTrace.buildPanelSnapshotTracePayload = traceController.buildPanelSnapshotTracePayload;
  panelConsoleTrace.log = logConsoleTrace;
  namespace.panelConsoleTrace = panelConsoleTrace;
})(globalThis);
