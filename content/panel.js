(function initContentPanel(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const HANDSHAKE_TIMEOUT_MS = 4000;
  const TRACE_REPEAT_IDLE_MS = 1600;
  let panelHost = null;
  let traceSequence = 0;
  let lastTraceEntry = null;
  let traceRepeatTimer = 0;

  function ensurePanel(callbacks) {
    let host = getPanelHost();
    if (host) {
      logConsoleTrace("panel", "01.top.panel.ensure.reuse", {
        bridgeReady: Boolean(host.__bridgeReady),
        frameSrc: normalizeText(host.__panelFrameSrc),
      });
      host.__callbacks = callbacks;
      host.__panelElements = host.__panelElements || resolvePanelElements(host);
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
    host.__panelElements = resolvePanelElements(host);
    host.__bridge = createHostedBridge(host);
    const { frame, handle } = host.__panelElements;
    installHandleInteractions(host, handle, callbacks);
    frame?.addEventListener("load", () => {
      logConsoleTrace("panel", "06.top.panel.frame.load", {
        bridgeReady: Boolean(host.__bridgeReady),
        frameSrc: normalizeText(frame.getAttribute("src")),
        panelUrl: normalizeText(host.__panelUrl),
      });
      if (host.__bridgeReady) {
        return;
      }
      updateStatusBanner(host, {
        text: "호스팅 패널과 연결하는 중이에요.",
        tone: "info",
      });
    });
    return host;
  }

  function renderPanel(state) {
    const host = getPanelHost();
    if (!host) {
      return;
    }
    host.__pendingPanelState = state;
    schedulePanelRender(host);
  }

  function getPanelHost() {
    if (panelHost?.isConnected) {
      return panelHost;
    }
    panelHost = document.getElementById("inova-bookmark-host");
    return panelHost;
  }

  function resolvePanelElements(host) {
    return {
      frame: host.querySelector("#inova-hosted-panel-frame"),
      handle: host.querySelector("#inova-bookmark-handle"),
      handleCount: host.querySelector(".handle-count"),
      root: host.querySelector("#inova-bookmark-root"),
      status: host.querySelector("#inova-hosted-panel-status"),
    };
  }

  function createHostedBridge(host) {
    const bridge = namespace.hostedPanelBridge.create({
      onError: ({ error }) => {
        const message = normalizeText(error instanceof Error ? error.message : error) || "호스팅 패널과 연결하지 못했어요.";
        logConsoleTrace("panel", "09.top.panel.bridge.error", {
          message,
        });
        updateStatusBanner(host, {
          text: message,
          tone: "error",
        });
      },
      onReadyChange: ({ ready }) => {
        host.__bridgeReady = Boolean(ready);
        clearHandshakeTimeout(host);
        logConsoleTrace("panel", ready ? "08.top.panel.bridge.ready" : "08.top.panel.bridge.not-ready", {
          frameSrc: normalizeText(host.__panelFrameSrc),
          panelUrl: normalizeText(host.__panelUrl),
          ready: Boolean(ready),
        });
        if (ready) {
          updateStatusBanner(host, null);
          if (host.__lastRenderedState) {
            pushBridgeSnapshotIfChanged(host, host.__lastRenderedState, { force: true });
          }
          return;
        }
        host.__lastBridgeSnapshotKey = "";
        if (host.__panelUrl) {
          updateStatusBanner(host, {
            text: "호스팅 패널과 다시 연결하는 중이에요.",
            tone: "info",
          });
        }
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

  function schedulePanelRender(host) {
    if (!(host instanceof global.HTMLElement) || host.__panelFrame) {
      return;
    }
    const scheduleFrame = typeof global.requestAnimationFrame === "function"
      ? global.requestAnimationFrame.bind(global)
      : (callback) => global.setTimeout(() => callback(Date.now()), 16);
    host.__panelFrame = scheduleFrame(() => {
      host.__panelFrame = 0;
      flushPanelRender(host);
      if (host.__pendingPanelState) {
        schedulePanelRender(host);
      }
    });
  }

  function flushPanelRender(host) {
    if (!(host instanceof global.HTMLElement)) {
      return;
    }
    const state = host.__pendingPanelState;
    delete host.__pendingPanelState;
    if (!state) {
      return;
    }
    host.__lastRenderedState = state;
    const elements = host.__panelElements || resolvePanelElements(host);
    host.__panelElements = elements;
    const { handleCount, root } = elements;

    if (root) {
      root.hidden = !state.visible;
      root.dataset.open = String(Boolean(state.open));
    }
    document.body.classList.toggle("inova-bookmark-panel-open", Boolean(state.visible && state.open));
    applyHandleRatio(host, state.handleRatio);

    const nextHandleCount = String(state.handleCount || 0);
    if (handleCount?.textContent !== nextHandleCount) {
      handleCount.textContent = nextHandleCount;
    }

    syncHostedFrame(host, state);

    if (host.__bridgeReady) {
      pushBridgeSnapshotIfChanged(host, state);
    }
  }

  function syncHostedFrame(host, state) {
    const elements = host.__panelElements || resolvePanelElements(host);
    const frame = elements.frame;
    if (!(frame instanceof global.HTMLIFrameElement)) {
      return;
    }
    const runtimeConfig = resolvePanelRuntimeConfig(state?.settings);
    const panelUrl = normalizeText(runtimeConfig?.hosting?.panelAppUrl || namespace.firebaseConfig?.hosting?.panelAppUrl);
    const panelFrameUrl = buildHostedPanelFrameUrl(host, panelUrl, runtimeConfig);
    const frameTarget = namespace.frameProxy?.resolveTarget?.(panelFrameUrl) || {
      origin: toOrigin(panelFrameUrl),
      src: panelFrameUrl,
      targetUrl: panelFrameUrl,
      wrapped: false,
    };

    if (!panelUrl) {
      logConsoleTrace("panel", "04.top.panel.frame.error", {
        reason: "missing-panel-url",
        target: normalizeText(runtimeConfig?.target) || "production",
      });
      updateStatusBanner(host, {
        text: "호스팅 패널 주소를 찾지 못했어요.",
        tone: "error",
      });
      return;
    }
    if (frameTarget.error) {
      logConsoleTrace("panel", "04.top.panel.frame.error", {
        frameSrc: normalizeText(frameTarget.src),
        panelUrl: normalizeText(panelFrameUrl),
        reason: normalizeText(frameTarget.error),
        wrapped: Boolean(frameTarget.wrapped),
      });
      host.__panelUrl = panelFrameUrl;
      host.__panelFrameSrc = "";
      host.__bridgeReady = false;
      host.__lastBridgeSnapshotKey = "";
      host.__bridge.reset("frame-proxy-error");
      host.__bridge.setAllowedOrigin("");
      clearHandshakeTimeout(host);
      frame.setAttribute("src", "about:blank");
      updateStatusBanner(host, {
        text: frameTarget.error,
        tone: "warning",
      });
      return;
    }

    host.__bridge.setAllowedOrigin(frameTarget.origin);
    if (host.__panelUrl === panelFrameUrl && frame.getAttribute("src") === frameTarget.src) {
      return;
    }

    host.__panelUrl = panelFrameUrl;
    host.__panelFrameSrc = frameTarget.src;
    host.__bridgeReady = false;
    host.__lastBridgeSnapshotKey = "";
    host.__bridge.reset("frame-src-change");
    clearHandshakeTimeout(host);
    host.__handshakeTimeout = global.setTimeout(() => {
      if (!host.__bridgeReady) {
        logConsoleTrace("panel", "07.top.panel.handshake.timeout", {
          frameSrc: normalizeText(host.__panelFrameSrc),
          panelUrl: normalizeText(host.__panelUrl),
        });
        updateStatusBanner(host, {
          text: "호스팅 패널을 아직 연결하지 못했어요. 페이지를 새로고침하거나 확장을 다시 로드해 주세요.",
          tone: "warning",
        });
      }
    }, HANDSHAKE_TIMEOUT_MS);
    updateStatusBanner(host, {
      text: "호스팅 패널을 여는 중이에요.",
      tone: "info",
    });
    logConsoleTrace("panel", "04.top.panel.frame.src.set", {
      frameSrc: normalizeText(frameTarget.src),
      panelUrl: normalizeText(panelFrameUrl),
      target: normalizeText(runtimeConfig?.target) || "production",
      wrapped: Boolean(frameTarget.wrapped),
    });
    frame.setAttribute("src", frameTarget.src);
  }

  function buildHostedPanelFrameUrl(host, panelUrl, runtimeConfig) {
    const normalizedPanelUrl = normalizeText(panelUrl);
    if (!normalizedPanelUrl) {
      return "";
    }
    if (normalizeText(runtimeConfig?.target) !== "local") {
      host.__panelLocalAssetVersion = "";
      return normalizedPanelUrl;
    }
    host.__panelLocalAssetVersion = normalizeText(host.__panelLocalAssetVersion) || String(Date.now());
    return appendQueryParam(normalizedPanelUrl, "v", host.__panelLocalAssetVersion);
  }

  function buildBridgeSnapshot(state, host) {
    return {
      extensionCapabilities: host.__bridge?.getCapabilities?.() || [],
      extensionVersion: readExtensionVersion(),
      panel: cloneValue(state),
      panelAppUrl: normalizeText(host.__panelUrl),
    };
  }

  function pushBridgeSnapshotIfChanged(host, state, options = {}) {
    const snapshot = buildBridgeSnapshot(state, host);
    const snapshotKey = serializeRenderState(snapshot);
    const force = Boolean(options?.force);
    if (!force && host.__lastBridgeSnapshotKey === snapshotKey) {
      return false;
    }
    host.__lastBridgeSnapshotKey = snapshotKey;
    logConsoleTrace("panel", "10.top.panel.snapshot.push", { activeTool: normalizeText(state?.activeTool), open: Boolean(state?.open), promptTab: normalizeText(state?.uiPreferences?.activePromptTab), reviewOpen: Boolean(state?.promptReview?.open), visible: Boolean(state?.visible) });
    host.__bridge.updateSnapshot(snapshot);
    return true;
  }

  function readExtensionVersion() {
    try {
      return normalizeText(global.chrome?.runtime?.getManifest?.()?.version);
    } catch {
      return "";
    }
  }

  function resolvePanelRuntimeConfig(settings) {
    return namespace.firebaseConfig?.meeting?.resolveRuntime?.(settings)
      || namespace.firebaseConfig?.prompt?.resolveRuntime?.(settings)
      || {
        hosting: namespace.firebaseConfig?.hosting || {},
        target: "production",
      };
  }

  function toOrigin(url) {
    const normalized = normalizeText(url);
    if (!normalized) {
      return "";
    }
    try {
      return new URL(normalized).origin;
    } catch {
      return "";
    }
  }

  function appendQueryParam(url, key, value) {
    const normalizedUrl = normalizeText(url);
    const normalizedKey = normalizeText(key);
    const normalizedValue = normalizeText(value);
    if (!normalizedUrl || !normalizedKey || !normalizedValue) {
      return normalizedUrl;
    }
    try {
      const nextUrl = new URL(normalizedUrl);
      nextUrl.searchParams.set(normalizedKey, normalizedValue);
      return nextUrl.toString();
    } catch {
      return normalizedUrl;
    }
  }

  function updateStatusBanner(host, status) {
    const elements = host.__panelElements || resolvePanelElements(host);
    const banner = elements.status;
    if (!(banner instanceof global.HTMLElement)) {
      return;
    }
    const text = normalizeText(status?.text);
    if (!text) {
      banner.hidden = true;
      banner.textContent = "";
      banner.dataset.tone = "";
      return;
    }
    banner.hidden = false;
    banner.textContent = text;
    banner.dataset.tone = normalizeText(status?.tone) || "info";
  }

  function clearHandshakeTimeout(host) {
    if (!host?.__handshakeTimeout) {
      return;
    }
    global.clearTimeout(host.__handshakeTimeout);
    host.__handshakeTimeout = 0;
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

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function serializeRenderState(value) {
    try {
      return JSON.stringify(value, (_key, current) => {
        if (typeof current === "function") {
          return undefined;
        }
        if (current instanceof global.HTMLElement) {
          return undefined;
        }
        return current;
      }) || "";
    } catch {
      return "";
    }
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value || "").trim();
  }

  function isTraceTransportRequest(request) {
    return normalizeText(request?.domain) === "page"
      && normalizeText(request?.payload?.action) === "log-trace";
  }

  function logConsoleTrace(channel, step, payload = {}) {
    const normalizedChannel = normalizeText(channel) || "trace";
    const normalizedStep = normalizeText(step) || "trace";
    const normalizedLabel = normalizedStep.replace(/^\d+\./, "") || "trace";
    const detail = payload && typeof payload === "object" ? payload : {};
    const debugEnabled = Boolean(namespace.panelDebug?.isEnabled?.());
    if (!debugEnabled && !shouldAlwaysTraceStep(normalizedLabel)) {
      return false;
    }
    if (shouldSkipTraceStep(normalizedLabel, detail)) {
      return false;
    }
    const summary = buildTraceSummary(normalizedLabel, detail);
    const fingerprint = `${normalizedChannel}|${normalizedLabel}|${summary}`;
    if (lastTraceEntry?.fingerprint === fingerprint) {
      lastTraceEntry.repeatCount += 1;
      scheduleTraceRepeatFlush();
      return true;
    }
    flushRepeatedTraceSummary();
    lastTraceEntry = {
      channel: normalizedChannel,
      fingerprint,
      label: normalizedLabel,
      repeatCount: 0,
      summary,
    };
    emitTraceLine(normalizedChannel, formatTraceLine(normalizedLabel, summary));
    scheduleTraceRepeatFlush();
    return true;
  }

  function shouldAlwaysTraceStep(label) { return ["hosted.click.detected", "top.panel.bridge.attached", "top.panel.bridge.error", "top.panel.bridge.not-ready", "top.panel.bridge.ready", "top.panel.ensure.reuse", "top.panel.frame.error", "top.panel.frame.load", "top.panel.frame.src.set", "top.panel.handshake.timeout", "top.panel.host.created", "top.panel.snapshot.push"].includes(label); }

  function shouldSkipTraceStep(label, payload) {
    const quietLabels = new Set(["hosted.listeners.bound", "hosted.message.received", "hosted.ready.ping.fire", "hosted.ready.ping.scheduled", "hosted.render.flush", "hosted.request.success", "hosted.snapshot.applied", "hosted.snapshot.received", "top.panel.bridge.request.completed", "top.panel.bridge.request.received"]);
    if (quietLabels.has(label)) {
      return true;
    }
    return label === "top.panel.snapshot.push"
      && !payload?.activeTool
      && !payload?.open
      && !payload?.visible;
  }

  function buildTraceSummary(label, payload = {}) {
    const parts = [];
    const requestAction = normalizeText(payload.action);
    const requestDomain = normalizeText(payload.domain);
    const requestTarget = [requestDomain, requestAction].filter(Boolean).join("/");
    if (requestTarget) {
      parts.push(requestTarget);
    }
    [
      ["meeting", payload.meetingId],
      ["job", payload.jobId],
      ["artifact", payload.artifactId],
      ["tool", payload.activeTool],
      ["tab", payload.promptTab],
      ["title", payload.toolTitle],
      ["meetings", normalizeTraceCount(payload.meetingCount)],
      ["open", normalizeTraceBoolean(payload, "open")],
      ["review", normalizeTraceBoolean(payload, "reviewOpen")],
      ["snapshot", normalizeTraceBoolean(payload, "snapshotOpen")],
      ["available", normalizeTraceBoolean(payload, "available")],
      ["pending", normalizeTraceBoolean(payload, "pending")],
      ["result", normalizeTraceBoolean(payload, "hasResult")],
      ["text", normalizeTraceBoolean(payload, "hasText")],
      ["visible", normalizeTraceBoolean(payload, "visible")],
      ["ready", normalizeTraceBoolean(payload, "ready")],
      ["target", payload.target],
      ["wrapped", normalizeTraceBoolean(payload, "wrapped")],
      ["reason", payload.reason],
      ["message", payload.message],
      ["error", payload.error],
      ["src", summarizeTraceUrl(payload.frameSrc)],
      ["url", summarizeTraceUrl(payload.panelUrl)],
      ["origin", summarizeTraceUrl(payload.origin)],
      ["file", summarizeTraceUrl(payload.filename)],
    ].forEach(([key, value]) => appendTracePart(parts, key, value));
    if (!parts.length && label === "hosted.render.waiting-snapshot") {
      appendTracePart(parts, "ready", normalizeTraceBoolean(payload, "bridgeReady"));
    }
    return parts.filter(Boolean).join(", ");
  }
  function appendTracePart(parts, key, value) {
    const normalizedValue = normalizeText(value);
    if (normalizedValue) parts.push(`${key}=${normalizedValue}`);
  }

  function normalizeTraceBoolean(payload, key) {
    return !payload || !Object.prototype.hasOwnProperty.call(payload, key) ? "" : payload[key] ? "yes" : "no";
  }

  function normalizeTraceCount(value) { if (value == null || value === "") return ""; const numeric = Number(value); return Number.isFinite(numeric) ? String(numeric) : normalizeText(value); }

  function summarizeTraceUrl(value) {
    const normalized = normalizeText(value);
    if (!normalized) return "";
    try {
      const parsed = new URL(normalized);
      const path = `${parsed.host}${parsed.pathname}`;
      return path.length > 72 ? `${path.slice(0, 48)}...${path.slice(-18)}` : path;
    } catch {
      return normalized.length > 72 ? `${normalized.slice(0, 48)}...${normalized.slice(-18)}` : normalized;
    }
  }

  function formatTraceLine(label, summary) { return summary ? `${label} | ${summary}` : label; }

  function emitTraceLine(channel, text) {
    traceSequence += 1;
    const style = channel === "functions"
      ? "color:#b45309;font-weight:600"
      : channel === "meeting"
        ? "color:#0f766e"
        : channel === "firestore"
          ? "color:#1d4ed8;font-weight:600"
          : "";
    style
      ? console.log(`%c[inova:${channel} #${traceSequence}] ${text}`, style)
      : console.log(`[inova:${channel} #${traceSequence}] ${text}`);
  }

  function scheduleTraceRepeatFlush() {
    global.clearTimeout(traceRepeatTimer);
    traceRepeatTimer = global.setTimeout(() => { traceRepeatTimer = 0; flushRepeatedTraceSummary(); }, TRACE_REPEAT_IDLE_MS);
  }

  function flushRepeatedTraceSummary() {
    if (!lastTraceEntry) return;
    global.clearTimeout(traceRepeatTimer);
    traceRepeatTimer = 0;
    if (lastTraceEntry.repeatCount > 0) emitTraceLine(lastTraceEntry.channel, `same event repeated ${lastTraceEntry.repeatCount} more times | ${formatTraceLine(lastTraceEntry.label, lastTraceEntry.summary)}`);
    lastTraceEntry = null;
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
  namespace.panelConsoleTrace = {
    log: logConsoleTrace,
  };
})(globalThis);
