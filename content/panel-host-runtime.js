(function initPanelHostRuntime(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const defaultNormalizeText = namespace.session.normalizeText;

  function create(deps = {}) {
    const applyHandleRatio = typeof deps.applyHandleRatio === "function"
      ? deps.applyHandleRatio
      : () => {};
    const buildPanelSnapshotTracePayload = typeof deps.buildPanelSnapshotTracePayload === "function"
      ? deps.buildPanelSnapshotTracePayload
      : () => ({});
    const handshakeTimeoutMs = Number(deps.handshakeTimeoutMs) > 0
      ? Number(deps.handshakeTimeoutMs)
      : 4000;
    const logConsoleTrace = typeof deps.logConsoleTrace === "function"
      ? deps.logConsoleTrace
      : () => false;
    const normalizeText = typeof deps.normalizeText === "function"
      ? deps.normalizeText
      : defaultNormalizeText;
    const readExtensionVersion = typeof deps.readExtensionVersion === "function"
      ? deps.readExtensionVersion
      : () => "";

    return {
      handleBridgeReadyChange,
      handleFrameLoad,
      render,
      resolveElements,
      syncPanelChrome,
      updateStatusBanner,
    };

    function resolveElements(host) {
      return {
        frame: host.querySelector("#inova-hosted-panel-frame"),
        handle: host.querySelector("#inova-bookmark-handle"),
        handleCount: host.querySelector(".handle-count"),
        root: host.querySelector("#inova-bookmark-root"),
        status: host.querySelector("#inova-hosted-panel-status"),
      };
    }

    function render(host, state) {
      if (!(host instanceof global.HTMLElement)) {
        return;
      }
      host.__pendingPanelState = state;
      schedulePanelRender(host);
    }

    function handleFrameLoad(host) {
      if (!(host instanceof global.HTMLElement)) {
        return;
      }
      const elements = host.__panelElements || resolveElements(host);
      host.__panelElements = elements;
      const frame = elements.frame;
      logConsoleTrace("panel", "06.top.panel.frame.load", {
        bridgeReady: Boolean(host.__bridgeReady),
        frameSrc: normalizeText(frame?.getAttribute?.("src")),
        panelUrl: normalizeText(host.__panelUrl),
      });
      if (host.__bridgeReady) {
        return;
      }
      updateStatusBanner(host, {
        text: "호스팅 패널과 연결하는 중이에요.",
        tone: "info",
      });
    }

    function handleBridgeReadyChange(host, ready) {
      if (!(host instanceof global.HTMLElement)) {
        return;
      }
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
      const elements = host.__panelElements || resolveElements(host);
      host.__panelElements = elements;
      const { root } = elements;
      const panelState = readPanelSnapshot(state);
      const visible = Boolean(panelState.visible);
      const open = Boolean(panelState.open);

      if (root) {
        root.hidden = !visible;
        root.dataset.open = String(open);
      }
      document.body.classList.toggle("inova-bookmark-panel-open", Boolean(visible && open));
      applyHandleRatio(host, state.handleRatio);

      syncHostedFrame(host, state);

      if (host.__bridgeReady) {
        pushBridgeSnapshotIfChanged(host, state);
      }
    }

    function syncPanelChrome(host, chromeState = {}) {
      if (!(host instanceof global.HTMLElement)) {
        return false;
      }
      const elements = host.__panelElements || resolveElements(host);
      host.__panelElements = elements;
      const { root } = elements;
      const hasOpen = Object.hasOwn(chromeState || {}, "open");
      if (hasOpen && root) {
        root.dataset.open = String(Boolean(chromeState.open));
        const visible = Object.hasOwn(chromeState || {}, "visible")
          ? Boolean(chromeState.visible)
          : !root.hidden;
        document.body.classList.toggle("inova-bookmark-panel-open", visible && Boolean(chromeState.open));
      }
      const handleCount = elements.handleCount;
      if (Object.hasOwn(chromeState || {}, "handleCount")) {
        const nextHandleCount = String(normalizeCount(chromeState?.handleCount));
        if (handleCount?.textContent !== nextHandleCount) {
          handleCount.textContent = nextHandleCount;
        }
      }
      return true;
    }

    function syncHostedFrame(host, state) {
      const elements = host.__panelElements || resolveElements(host);
      const frame = elements.frame;
      if (!(frame instanceof global.HTMLIFrameElement)) {
        return;
      }
      const runtimeConfig = resolvePanelRuntimeConfig(readPanelSettings(state));
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
        host.__handshakeTimeout = 0;
        if (!host.isConnected) {
          return;
        }
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
      }, handshakeTimeoutMs);
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
        panel: cloneValue(state?.panelSnapshot || {}),
        panelAppUrl: normalizeText(host.__panelUrl),
      };
    }

    function readPanelSnapshot(state) {
      return state?.panelSnapshot && typeof state.panelSnapshot === "object"
        ? state.panelSnapshot
        : {};
    }

    function readPanelSettings(state) {
      const panelSnapshot = readPanelSnapshot(state);
      return panelSnapshot.settings && typeof panelSnapshot.settings === "object"
        ? panelSnapshot.settings
        : {};
    }

    function pushBridgeSnapshotIfChanged(host, state, options = {}) {
      const snapshot = buildBridgeSnapshot(state, host);
      const snapshotKey = serializeRenderState(snapshot);
      if (!snapshotKey) {
        updateStatusBanner(host, {
          text: "호스팅 패널 상태를 전송하지 못했어요. 페이지를 새로고침해 주세요.",
          tone: "warning",
        });
        return false;
      }
      const force = Boolean(options?.force);
      if (!force && host.__lastBridgeSnapshotKey === snapshotKey) {
        return false;
      }
      host.__lastBridgeSnapshotKey = snapshotKey;
      logConsoleTrace("panel", "10.top.panel.snapshot.push", buildPanelSnapshotTracePayload(state));
      host.__bridge.updateSnapshot(snapshot);
      return true;
    }

    function resolvePanelRuntimeConfig(settings) {
      return namespace.firebaseConfig?.panel?.resolveRuntime?.(settings)
        || {
          hosting: namespace.firebaseConfig?.hosting || {},
          target: "production",
        };
    }

    function updateStatusBanner(host, status) {
      const elements = host.__panelElements || resolveElements(host);
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
      } catch (error) {
        const message = normalizeText(error instanceof Error ? error.message : String(error || ""));
        console.warn("[i-Nova Bookmarks] hosted panel snapshot serialization failed", {
          message,
        });
        logConsoleTrace("panel", "10.top.panel.snapshot.serialize.error", {
          error: message,
        });
        return "";
      }
    }

    function normalizeCount(value) {
      return Math.max(0, Number(value) || 0);
    }
  }

  function toOrigin(url) {
    const normalized = defaultNormalizeText(url);
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
    const normalizedUrl = defaultNormalizeText(url);
    const normalizedKey = defaultNormalizeText(key);
    const normalizedValue = defaultNormalizeText(value);
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

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  namespace.panelHostRuntime = {
    ...(namespace.panelHostRuntime || {}),
    create,
  };
})(globalThis);
