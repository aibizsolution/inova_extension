(function initContentPanel(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const HANDSHAKE_TIMEOUT_MS = 4000;
  let panelHost = null;

  function ensurePanel(callbacks) {
    let host = getPanelHost();
    if (host) {
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
    host.__panelElements = resolvePanelElements(host);
    host.__bridge = createHostedBridge(host);
    const { debugLayer, frame, handle } = host.__panelElements;
    installHandleInteractions(host, handle, callbacks);
    installDebugLayerInteractions(host, debugLayer);
    frame?.addEventListener("load", () => {
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
      debugLayer: host.querySelector("#inova-meeting-debug-layer"),
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
        updateStatusBanner(host, {
          text: message,
          tone: "error",
        });
      },
      onReadyChange: ({ ready }) => {
        host.__bridgeReady = Boolean(ready);
        clearHandshakeTimeout(host);
        if (ready) {
          updateStatusBanner(host, null);
          if (host.__lastRenderedState) {
            bridge.updateSnapshot(buildBridgeSnapshot(host.__lastRenderedState, host));
          }
          return;
        }
        if (host.__panelUrl) {
          updateStatusBanner(host, {
            text: "호스팅 패널과 다시 연결하는 중이에요.",
            tone: "info",
          });
        }
      },
      onRequest: async (request) => handleBridgeRequest(host, request),
    });
    bridge.attach();
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

    syncDebugLayer(host, state.panelDebug);
    syncHostedFrame(host, state);

    if (host.__bridgeReady) {
      host.__bridge.updateSnapshot(buildBridgeSnapshot(state, host));
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
      updateStatusBanner(host, {
        text: "호스팅 패널 주소를 찾지 못했어요.",
        tone: "error",
      });
      return;
    }
    if (frameTarget.error) {
      host.__panelUrl = panelFrameUrl;
      host.__panelFrameSrc = "";
      host.__bridgeReady = false;
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
    host.__bridge.reset("frame-src-change");
    clearHandshakeTimeout(host);
    host.__handshakeTimeout = global.setTimeout(() => {
      if (!host.__bridgeReady) {
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

  async function handleBridgeRequest(host, request) {
    const domain = normalizeText(request?.domain);
    if (domain === "runtime") {
      return {
        handled: true,
        result: await handleRuntimeRequest(request?.payload),
      };
    }
    if (domain === "page") {
      return {
        handled: true,
        result: await handlePageRequest(request?.payload),
      };
    }
    if (domain === "panel") {
      return {
        handled: true,
        result: await handlePanelRequest(host, request?.payload),
      };
    }
    return {
      handled: false,
      result: null,
    };
  }

  async function handleRuntimeRequest(payload) {
    if (!global.chrome?.runtime?.sendMessage) {
      throw new Error("확장 런타임에 연결할 수 없어요.");
    }
    const response = await global.chrome.runtime.sendMessage({
      request: payload && typeof payload === "object" ? payload : {},
      type: "inova-panel:invoke",
    });
    if (!response?.ok) {
      throw new Error(normalizeText(response?.error) || "호스팅 패널 요청을 처리하지 못했어요.");
    }
    return response.data;
  }

  async function handlePageRequest(payload) {
    const action = normalizeText(payload?.action);
    if (action === "copy-text") {
      const text = String(payload?.text || "");
      if (!text) {
        return { copied: false };
      }
      await global.navigator.clipboard.writeText(text);
      return { copied: true };
    }
    if (action === "copy-debug-log") {
      return copyDebugLog(Boolean(payload?.errorsOnly));
    }
    if (action === "clear-debug-log") {
      namespace.panelDebug?.clearEntries?.();
      return buildDebugState();
    }
    if (action === "get-composer-state") {
      return namespace.composer?.getComposerState?.() || { available: false, text: "" };
    }
    if (action === "apply-prompt-text") {
      return {
        applied: Boolean(namespace.composer?.applyPromptText?.(String(payload?.text || ""), normalizeText(payload?.mode) || "replace")),
      };
    }
    if (action === "get-conversation-state" || action === "get-conversation-snapshot") {
      return buildConversationSnapshot();
    }
    if (action === "jump-conversation-item") {
      const bookmarkId = normalizeText(payload?.bookmarkId || payload?.itemId);
      if (!bookmarkId) {
        return { jumped: false };
      }
      namespace.contentPanel.setActiveBookmark(bookmarkId);
      namespace.contentPanel.focusBookmark(bookmarkId);
      return {
        jumped: Boolean(namespace.contentDom?.scrollToMessage?.(bookmarkId, {
          behavior: "smooth",
          block: "start",
        })),
      };
    }
    if (action === "get-debug-state") {
      return buildDebugState();
    }
    if (action === "set-debug-enabled") {
      namespace.panelDebug?.setEnabled?.(Boolean(payload?.enabled));
      return buildDebugState();
    }
    throw new Error("지원하지 않는 page adapter 요청이에요.");
  }

  async function copyDebugLog(errorsOnly) {
    const entries = namespace.panelDebug?.getEntries?.() || [];
    const text = errorsOnly
      ? namespace.panelDebug?.buildErrorCopyText?.(entries)
      : namespace.panelDebug?.buildCopyText?.(entries);
    const normalizedText = String(text || "").trim();
    if (!normalizedText) {
      return {
        copied: false,
        text: "",
      };
    }
    await global.navigator.clipboard.writeText(normalizedText);
    return {
      copied: true,
      text: normalizedText,
    };
  }

  async function handlePanelRequest(host, payload) {
    const callbacks = host.__callbacks || {};
    const action = normalizeText(payload?.action);
    const detail = payload?.detail && typeof payload.detail === "object" ? payload.detail : {};

    if (action === "toggle-panel") {
      callbacks.onToggle?.(payload?.open);
      return { open: payload?.open !== false };
    }
    if (action === "escape") {
      const consumed = Boolean(callbacks.onEscape?.());
      if (!consumed) {
        callbacks.onToggle?.(false);
      }
      return { consumed };
    }
    if (action === "select-tool") {
      return { selected: Boolean(await callbacks.onSelectTool?.(normalizeText(payload?.toolId))) };
    }
    if (action === "search") {
      callbacks.onSearch?.(normalizeText(payload?.toolId), String(payload?.value || ""), payload?.options || {});
      return { searched: true };
    }
    if (action === "search-submit") {
      callbacks.onSearchSubmit?.(normalizeText(payload?.toolId), String(payload?.value || ""));
      return { submitted: true };
    }
    if (action === "bookmark-copy") {
      return { copied: Boolean(await callbacks.onCopyBookmark?.(normalizeText(payload?.bookmarkId))) };
    }
    if (action === "bookmark-jump") {
      callbacks.onJumpBookmark?.(normalizeText(payload?.bookmarkId));
      return { jumped: true };
    }
    if (action === "meeting-action") {
      await callbacks.onMeetingAction?.(normalizeText(payload?.meetingAction), detail);
      return { handled: true };
    }
    if (action === "release-action") {
      await callbacks.onReleaseAction?.(normalizeText(payload?.releaseAction), detail);
      return { handled: true };
    }
    if (action === "prompt-action") {
      callbacks.onPromptAction?.(normalizeText(payload?.promptAction), detail);
      return { handled: true };
    }
    if (action === "prompt-draft-change") {
      callbacks.onPromptDraftChange?.(normalizeText(payload?.field), payload?.value);
      return { handled: true };
    }
    if (action === "prompt-tab-select") {
      callbacks.onSelectPromptTab?.(normalizeText(payload?.promptTabId));
      return { handled: true };
    }
    if (action === "store-action") {
      callbacks.onStoreAction?.(normalizeText(payload?.storeAction), detail);
      return { handled: true };
    }
    if (action === "import-file") {
      const file = payload?.file instanceof global.File ? payload.file : null;
      if (!file) {
        throw new Error("가져올 파일을 찾지 못했어요.");
      }
      await callbacks.onImportFile?.(file);
      return { imported: true };
    }
    if (action === "move-prompt") {
      callbacks.onMovePrompt?.(
        normalizeText(payload?.dragPromptId),
        normalizeText(payload?.targetPromptId),
        normalizeText(payload?.placement) || "before"
      );
      return { handled: true };
    }
    throw new Error("지원하지 않는 hosted panel action이에요.");
  }

  function buildBridgeSnapshot(state, host) {
    return {
      extensionCapabilities: host.__bridge?.getCapabilities?.() || [],
      extensionVersion: readExtensionVersion(),
      panel: cloneValue(state),
      panelAppUrl: normalizeText(host.__panelUrl),
    };
  }

  function buildConversationSnapshot() {
    const sessionId = namespace.session?.getSessionId?.() || "";
    const items = namespace.contentDom?.collectUserMessages?.(sessionId) || [];
    return {
      conversation: cloneValue(namespace.contentDom?.getConversationState?.() || {}),
      items: cloneValue(items),
      sessionId,
      sessionTitle: normalizeText(namespace.contentDom?.getSessionTitle?.())
        || namespace.session?.formatSessionLabel?.(sessionId)
        || "현재 세션",
      visibleMessageId: normalizeText(namespace.contentDom?.getVisibleMessageId?.(items)),
    };
  }

  function buildDebugState() {
    const entries = namespace.panelDebug?.getEntries?.() || [];
    const statusSummary = namespace.panelDebug?.summarizeEntries?.(entries) || {};
    return {
      enabled: Boolean(namespace.panelDebug?.isEnabled?.()),
      entries: cloneValue(entries),
      errorsText: String(namespace.panelDebug?.buildErrorCopyText?.(entries) || ""),
      hasErrors: Math.max(0, Number(statusSummary.errorCount) || 0) > 0,
      statusSummary: cloneValue(statusSummary),
      text: String(namespace.panelDebug?.buildCopyText?.(entries) || ""),
    };
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

  function syncDebugLayer(host, panelDebug) {
    const elements = host.__panelElements || resolvePanelElements(host);
    const debugLayer = elements.debugLayer;
    if (!(debugLayer instanceof global.HTMLElement)) {
      return;
    }
    const nextPanelDebug = panelDebug && typeof panelDebug === "object" ? panelDebug : {};
    if (!nextPanelDebug.enabled) {
      if (debugLayer.innerHTML) {
        debugLayer.innerHTML = "";
      }
      host.__panelDebugHtml = "";
      host.__panelDebugKey = "disabled";
      syncMeetingDebugLayerDataset(debugLayer, nextPanelDebug);
      return;
    }
    const nextDebugKey = `enabled:${serializeRenderState(nextPanelDebug)}`;
    if (host.__panelDebugKey !== nextDebugKey) {
      namespace.panelDebug?.captureViewport?.(
        "panel-overlay",
        debugLayer.querySelector(".inova-meeting-debug-console__log")
      );
      host.__panelDebugHtml = namespace.meetingDebugConsole?.renderPanel?.(nextPanelDebug) || "";
      host.__panelDebugKey = nextDebugKey;
      if (debugLayer.innerHTML !== host.__panelDebugHtml) {
        debugLayer.innerHTML = host.__panelDebugHtml;
      }
      namespace.panelDebug?.restoreViewport?.(
        "panel-overlay",
        debugLayer.querySelector(".inova-meeting-debug-console__log")
      );
    }
    syncMeetingDebugLayerDataset(debugLayer, nextPanelDebug);
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

  function installDebugLayerInteractions(host, debugLayer) {
    if (!(debugLayer instanceof global.HTMLElement)) {
      return;
    }
    debugLayer.addEventListener("click", (event) => {
      const action = normalizeText(event.target?.closest?.("[data-meeting-action]")?.dataset?.meetingAction);
      if (!action) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void host.__callbacks?.onMeetingAction?.(action, {});
    });
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
      <div id="inova-meeting-debug-layer"></div>
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

  function syncMeetingDebugLayerDataset(debugLayer, panelDebug) {
    const totalLogs = Math.max(0, Number(panelDebug?.statusSummary?.totalLogs) || 0);
    debugLayer.dataset.debugCollapsed = String(Boolean(panelDebug?.collapsed));
    debugLayer.dataset.debugEnabled = String(Boolean(panelDebug?.enabled));
    debugLayer.dataset.debugEntryCount = String(totalLogs);
    debugLayer.dataset.debugHasErrors = String(Boolean(panelDebug?.hasErrors));
    debugLayer.dataset.debugRendered = String(Boolean(debugLayer.innerHTML));
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value || "").trim();
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
})(globalThis);
