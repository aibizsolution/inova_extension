(function initHostedPanelApp(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const BRIDGE_VERSION = 1;
  const APP_SOURCE = "inova-hosted-panel-app";
  const EXTENSION_SOURCE = "inova-hosted-panel-extension";
  const REQUEST_TIMEOUT_MS = 15000;
  const APP_CAPABILITIES = Object.freeze([
    "panel.snapshot.v1",
    "panel.request.v1",
    "panel.response.v1",
    "panel.event.v1",
    "runtime.invoke.v1",
    "page.adapter.v1",
  ]);
  const REQUIRED_EXTENSION_CAPABILITIES = Object.freeze([
    "panel.snapshot.v1",
    "panel.request.v1",
    "panel.response.v1",
    "panel.event.v1",
    "runtime.invoke.v1",
    "page.adapter.v2",
  ]);

  const root = document.getElementById("inova-hosted-panel-root");
  const state = {
    bridgeReady: false,
    elements: null,
    extensionCapabilities: [],
    extensionVersion: "",
    panelAppUrl: "",
    panelSnapshot: null,
    parentOrigin: readParentOrigin(),
    pendingRequests: new Map(),
    readyPingCount: 0,
    renderCache: createPanelRenderCache(),
    renderDeferred: false,
    renderFrame: 0,
    requestSeq: 0,
    searchComposition: { active: false, toolId: "" },
    storeRenderKey: 0,
    storeScrollTop: 0,
  };
  const api = {
    invokePage,
    invokeRuntime,
    request,
  };
  const promptLibraryController = namespace.promptLibraryController?.create?.({
    invokePage,
    invokeRuntime,
    scheduleRender,
  }) || null;
  const callbacks = createCallbacks();

  namespace.hostedPanelApp = api;

  bootstrap();

  function bootstrap() {
    if (!(root instanceof global.HTMLElement)) {
      return;
    }
    root.addEventListener("click", handleRootClick);
    root.addEventListener("scroll", handleRootScroll, true);
    root.addEventListener("pointerdown", handleRootPointerDown);
    root.addEventListener("pointermove", handleRootPointerMove);
    root.addEventListener("pointerup", handleRootPointerEnd);
    root.addEventListener("pointercancel", handleRootPointerEnd);
    root.addEventListener("compositionstart", handleRootCompositionStart);
    root.addEventListener("compositionend", handleRootCompositionEnd);
    root.addEventListener("search", handleRootSearch, true);
    root.addEventListener("input", handleRootInput);
    root.addEventListener("change", handleRootChange);
    root.addEventListener("keydown", handleRootKeydown);
    global.addEventListener("message", handleWindowMessage);
    renderStatusCard({
      body: "확장 프로그램과 패널 상태를 연결하는 중입니다.",
      title: "호스팅 패널 준비 중",
      tone: "info",
    });
    sendReady();
    scheduleReadyPing();
  }

  function createCallbacks() {
    return {
      async onCopyBookmark(bookmarkId) {
        const response = await request("panel", {
          action: "bookmark-copy",
          bookmarkId,
        });
        return Boolean(response?.copied);
      },
      onEscape() {
        return request("panel", {
          action: "escape",
        });
      },
      onImportFile(file) {
        if (promptLibraryController?.handleImportFile) {
          return promptLibraryController.handleImportFile(file).then((handled) => {
            if (handled !== false) {
              return handled;
            }
            return request("panel", {
              action: "import-file",
              file,
            });
          });
        }
        return request("panel", {
          action: "import-file",
          file,
        });
      },
      onJumpBookmark(bookmarkId) {
        return request("panel", {
          action: "bookmark-jump",
          bookmarkId,
        });
      },
      onMeetingAction(meetingAction, detail = {}) {
        return request("panel", {
          action: "meeting-action",
          detail,
          meetingAction,
        });
      },
      onMovePrompt(dragPromptId, targetPromptId, placement) {
        if (promptLibraryController?.handleMovePrompt) {
          return promptLibraryController.handleMovePrompt(dragPromptId, targetPromptId, placement).then((handled) => {
            if (handled !== false) {
              return handled;
            }
            return request("panel", {
              action: "move-prompt",
              dragPromptId,
              placement,
              targetPromptId,
            });
          });
        }
        return request("panel", {
          action: "move-prompt",
          dragPromptId,
          placement,
          targetPromptId,
        });
      },
      onPromptAction(promptAction, detail = {}) {
        if (promptLibraryController?.handlePromptAction) {
          return promptLibraryController.handlePromptAction(promptAction, detail).then((handled) => {
            if (handled !== false) {
              return handled;
            }
            return request("panel", {
              action: "prompt-action",
              detail,
              promptAction,
            });
          });
        }
        return request("panel", {
          action: "prompt-action",
          detail,
          promptAction,
        });
      },
      onPromptDraftChange(field, value) {
        if (promptLibraryController?.handlePromptDraftChange?.(field, value) !== false) {
          return Promise.resolve(true);
        }
        return request("panel", {
          action: "prompt-draft-change",
          field,
          value,
        });
      },
      onReleaseAction(releaseAction, detail = {}) {
        return request("panel", {
          action: "release-action",
          detail,
          releaseAction,
        });
      },
      onSearch(toolId, value, options = {}) {
        if (promptLibraryController?.handleSearch?.(toolId, value, options) !== false) {
          return Promise.resolve(true);
        }
        return request("panel", {
          action: "search",
          options,
          toolId,
          value,
        });
      },
      onSearchSubmit(toolId, value) {
        if (promptLibraryController?.handleSearch?.(toolId, value, { submit: true }) !== false) {
          return Promise.resolve(true);
        }
        return request("panel", {
          action: "search-submit",
          toolId,
          value,
        });
      },
      onSelectPromptTab(promptTabId) {
        if (promptLibraryController?.handleSelectPromptTab) {
          return promptLibraryController.handleSelectPromptTab(promptTabId).then((handled) => {
            if (handled !== false) {
              return handled;
            }
            return request("panel", {
              action: "prompt-tab-select",
              promptTabId,
            });
          });
        }
        return request("panel", {
          action: "prompt-tab-select",
          promptTabId,
        });
      },
      onSelectTool(toolId) {
        return request("panel", {
          action: "select-tool",
          toolId,
        });
      },
      onStoreAction(storeAction, detail = {}) {
        return request("panel", {
          action: "store-action",
          detail,
          storeAction,
        });
      },
      onToggle(open) {
        return request("panel", {
          action: "toggle-panel",
          open,
        });
      },
    };
  }

  function scheduleReadyPing() {
    if (state.panelSnapshot || state.readyPingCount >= 5) {
      return;
    }
    state.readyPingCount += 1;
    global.setTimeout(() => {
      if (!state.panelSnapshot) {
        sendReady();
        scheduleReadyPing();
      }
    }, 700);
  }

  function sendReady() {
    postEnvelope({
      capabilities: APP_CAPABILITIES.slice(),
      type: "ready",
    });
  }

  function handleWindowMessage(event) {
    if (event.source !== global.parent || !isParentOrigin(event.origin)) {
      return;
    }
    const envelope = normalizeEnvelope(event.data);
    if (!envelope || envelope.source !== EXTENSION_SOURCE) {
      return;
    }
    if (!state.parentOrigin) {
      state.parentOrigin = normalizeOrigin(event.origin);
    }
    if (envelope.type === "snapshot") {
      handleSnapshotEnvelope(envelope);
      return;
    }
    if (envelope.type === "response") {
      settleRequest(envelope.requestId, null, envelope.payload);
      return;
    }
    if (envelope.type === "error") {
      settleRequest(
        envelope.requestId,
        normalizeText(envelope.payload?.error) || "호스팅 패널 요청을 처리하지 못했어요."
      );
      return;
    }
    if (envelope.type === "event") {
      handleEventEnvelope(envelope);
    }
  }

  function handleSnapshotEnvelope(envelope) {
    const payload = envelope.payload && typeof envelope.payload === "object"
      ? envelope.payload
      : {};
    state.bridgeReady = true;
    state.extensionCapabilities = normalizeCapabilities(
      payload.extensionCapabilities?.length ? payload.extensionCapabilities : envelope.capabilities
    );
    state.extensionVersion = normalizeText(payload.extensionVersion);
    state.panelAppUrl = normalizeText(payload.panelAppUrl);
    state.panelSnapshot = payload.panel && typeof payload.panel === "object"
      ? cloneValue(payload.panel)
      : null;
    scheduleRender();
  }

  function handleEventEnvelope(envelope) {
    if (envelope.domain !== "page") {
      return;
    }
    const action = normalizeText(envelope.payload?.action);
    if (action === "focus-bookmark") {
      namespace.bookmarkView?.focus?.(normalizeText(envelope.payload?.bookmarkId));
      return;
    }
    if (action === "set-active-bookmark") {
      namespace.bookmarkView?.setActive?.(normalizeText(envelope.payload?.bookmarkId));
    }
  }

  function request(domain, payload = {}) {
    const requestId = buildRequestId();
    postEnvelope({
      domain,
      payload,
      requestId,
      type: "request",
    });
    return new Promise((resolve, reject) => {
      const timeoutId = global.setTimeout(() => {
        state.pendingRequests.delete(requestId);
        reject(new Error("호스팅 패널 요청 시간이 초과되었어요."));
      }, REQUEST_TIMEOUT_MS);
      state.pendingRequests.set(requestId, {
        reject,
        resolve,
        timeoutId,
      });
    });
  }

  function invokeRuntime(payload = {}) {
    return request("runtime", payload);
  }

  function invokePage(payload = {}) {
    return request("page", payload);
  }

  function settleRequest(requestId, errorMessage, payload) {
    const entry = state.pendingRequests.get(requestId);
    if (!entry) {
      return;
    }
    state.pendingRequests.delete(requestId);
    global.clearTimeout(entry.timeoutId);
    if (errorMessage) {
      entry.reject(new Error(errorMessage));
      return;
    }
    if (payload?.handled === false) {
      entry.reject(new Error("확장 프로그램이 요청을 처리하지 않았어요."));
      return;
    }
    entry.resolve(payload?.result);
  }

  function postEnvelope(message = {}) {
    if (!global.parent || global.parent === global) {
      return false;
    }
    global.parent.postMessage(
      {
        bridgeVersion: BRIDGE_VERSION,
        capabilities: Array.isArray(message.capabilities)
          ? message.capabilities
          : APP_CAPABILITIES.slice(),
        domain: normalizeText(message.domain),
        payload: message.payload && typeof message.payload === "object" ? message.payload : {},
        requestId: normalizeText(message.requestId),
        source: APP_SOURCE,
        type: normalizeText(message.type),
      },
      state.parentOrigin || "*"
    );
    return true;
  }

  function normalizeEnvelope(value) {
    const data = value && typeof value === "object" ? value : null;
    if (!data || Number(data.bridgeVersion) !== BRIDGE_VERSION) {
      return null;
    }
    return {
      capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
      domain: normalizeText(data.domain),
      payload: data.payload && typeof data.payload === "object" ? data.payload : {},
      requestId: normalizeText(data.requestId),
      source: normalizeText(data.source),
      type: normalizeText(data.type),
    };
  }

  function normalizeCapabilities(value) {
    return Array.isArray(value)
      ? value.map((entry) => normalizeText(entry)).filter(Boolean)
      : [];
  }

  function isParentOrigin(origin) {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!state.parentOrigin) {
      return Boolean(normalizedOrigin);
    }
    return normalizedOrigin === state.parentOrigin;
  }

  function scheduleRender() {
    if (state.searchComposition.active) {
      state.renderDeferred = true;
      return;
    }
    if (state.renderFrame) {
      return;
    }
    const scheduleFrame = typeof global.requestAnimationFrame === "function"
      ? global.requestAnimationFrame.bind(global)
      : (callback) => global.setTimeout(() => callback(Date.now()), 16);
    state.renderFrame = scheduleFrame(() => {
      state.renderFrame = 0;
      flushRender();
      if (state.renderDeferred && !state.searchComposition.active) {
        state.renderDeferred = false;
        scheduleRender();
      }
    });
  }

  function flushRender() {
    const panelState = state.panelSnapshot;
    if (!panelState) {
      renderStatusCard({
        body: "패널 상태 스냅샷을 기다리고 있습니다.",
        meta: state.bridgeReady ? `extension ${state.extensionVersion || "unknown"}` : "",
        title: "패널을 준비하는 중",
        tone: "info",
      });
      return;
    }
    const missingCapabilities = readMissingCapabilities();
    if (missingCapabilities.length) {
      renderStatusCard({
        body: "호스팅 패널 자산은 더 최신인데, 현재 확장 프로그램 브리지가 필요한 계약을 아직 지원하지 않습니다.",
        items: missingCapabilities.map((capability) => `누락 capability: ${capability}`),
        meta: state.extensionVersion ? `현재 확장 버전 ${state.extensionVersion}` : "",
        title: "확장 업데이트 필요",
        tone: "warning",
      });
      return;
    }

    promptLibraryController?.syncPanelState?.(panelState, state.extensionCapabilities);
    ensureShell();
    const elements = state.elements;
    if (!elements) {
      return;
    }
    const effectivePromptTool = buildEffectivePromptToolState(panelState);
    const effectivePromptCount = readEffectivePromptCount(panelState, effectivePromptTool);
    const effectiveToolCount = panelState.activeTool === "prompts"
      ? readEffectivePromptToolCount(effectivePromptTool, effectivePromptCount)
      : Number(panelState.toolCount) || 0;
    const focusedControl = captureFocusedControl(elements.app);
    const previousStoreScrollTop = panelState.activeTool === "prompts" && effectivePromptTool?.activeTab === "store"
      ? elements.app.querySelector(".inova-store-list")?.scrollTop || state.storeScrollTop || 0
      : 0;

    const nextToolRailHtml = renderToolRail(
      buildEffectiveTools(panelState.tools || [], effectivePromptCount),
      panelState.activeTool
    );
    if (state.renderCache.toolRailHtml !== nextToolRailHtml) {
      elements.toolRail.innerHTML = nextToolRailHtml;
      state.renderCache.toolRailHtml = nextToolRailHtml;
    }

    const nextToolTitle = String(panelState.toolTitle || "");
    if (state.renderCache.toolTitle !== nextToolTitle) {
      elements.toolTitle.textContent = nextToolTitle;
      state.renderCache.toolTitle = nextToolTitle;
    }

    const nextToolTotal = String(effectiveToolCount || 0);
    if (state.renderCache.toolTotal !== nextToolTotal) {
      elements.toolTotal.textContent = nextToolTotal;
      state.renderCache.toolTotal = nextToolTotal;
    }

    renderToolContentIfNeeded(elements.toolContent, panelState);
    renderMeetingDebugLayerIfNeeded(elements.debugLayer, panelState);

    if (panelState.activeTool === "prompts" && effectivePromptTool?.activeTab === "store") {
      namespace.promptHubPanel?.syncStoreList?.(elements.app, callbacks, {
        renderKey: effectivePromptTool?.store?.renderKey,
        scrollTop: previousStoreScrollTop,
      });
    }
    namespace.bookmarkView?.setActive?.(panelState.bookmarksTool?.activeId);
    restoreFocusedControl(elements.app, focusedControl);
  }

  function ensureShell() {
    if (state.elements?.app?.isConnected) {
      return;
    }
    root.innerHTML = buildMarkup();
    state.elements = resolvePanelElements();
    state.renderCache = createPanelRenderCache();
    state.elements.fileInput?.addEventListener("change", handleImportFileChange);
  }

  function resolvePanelElements() {
    return {
      app: root.querySelector(".inova-hosted-panel-app"),
      debugLayer: root.querySelector("#inova-meeting-debug-layer"),
      fileInput: root.querySelector("#inova-prompt-import-file"),
      toolContent: root.querySelector("#inova-tool-content"),
      toolRail: root.querySelector("#inova-tool-rail"),
      toolTitle: root.querySelector("#inova-tool-title"),
      toolTotal: root.querySelector("#inova-tool-total"),
    };
  }

  function createPanelRenderCache() {
    return {
      debugHtml: "",
      debugKey: "",
      toolContentHtml: "",
      toolContentKey: "",
      toolRailHtml: "",
      toolTitle: "",
      toolTotal: "",
    };
  }

  function renderToolContentIfNeeded(toolContent, panelState) {
    if (!(toolContent instanceof global.HTMLElement)) {
      return;
    }
    const nextToolContentKey = buildToolContentKey(panelState);
    if (state.renderCache.toolContentKey !== nextToolContentKey) {
      state.renderCache.toolContentHtml = renderToolContent(panelState);
      state.renderCache.toolContentKey = nextToolContentKey;
    }
    if (toolContent.innerHTML !== state.renderCache.toolContentHtml) {
      toolContent.innerHTML = state.renderCache.toolContentHtml;
    }
  }

  function renderMeetingDebugLayerIfNeeded(debugLayer, panelState) {
    if (!(debugLayer instanceof global.HTMLElement)) {
      return;
    }
    const panelDebug = panelState.panelDebug && typeof panelState.panelDebug === "object"
      ? panelState.panelDebug
      : {};
    if (state.renderCache.debugHtml || debugLayer.innerHTML) {
      debugLayer.innerHTML = "";
    }
    state.renderCache.debugHtml = "";
    state.renderCache.debugKey = panelDebug.enabled ? "external-overlay" : "disabled";
    syncMeetingDebugLayerDataset(debugLayer, panelDebug);
  }

  function buildToolContentKey(panelState) {
    return `${panelState.activeTool}:${serializeRenderState(getActiveToolState(panelState))}`;
  }

  function getActiveToolState(panelState) {
    if (panelState.activeTool === "prompts") {
      return buildEffectivePromptToolState(panelState);
    }
    if (panelState.activeTool === "meeting") {
      return panelState.meetingTool;
    }
    if (panelState.activeTool === "release") {
      return panelState.releaseTool;
    }
    return panelState.bookmarksTool;
  }

  function renderToolContent(panelState) {
    try {
      if (panelState.activeTool === "prompts") {
        return namespace.promptToolView?.render?.(buildEffectivePromptToolState(panelState))
          || namespace.promptHubView?.render?.(panelState.promptTool)
          || renderToolFailure();
      }
      if (panelState.activeTool === "meeting") {
        return namespace.meetingView?.render?.(panelState.meetingTool) || renderToolFailure();
      }
      if (panelState.activeTool === "release") {
        return namespace.releaseView?.render?.(panelState.releaseTool) || renderToolFailure();
      }
      return namespace.bookmarkView?.renderTool?.(panelState.bookmarksTool) || renderToolFailure();
    } catch (error) {
      console.error("[i-Nova Hosted Panel] tool render failed", error);
      return renderToolFailure();
    }
  }

  function renderToolFailure() {
    return '<section class="inova-tool-section"><div class="inova-bookmark-empty">화면을 불러오지 못했어요. 페이지를 새로고침하거나 확장을 다시 로드해 주세요.</div></section>';
  }

  function renderToolRail(tools, activeTool) {
    return (Array.isArray(tools) ? tools : []).map((tool) => `
      <button type="button" class="inova-tool-rail__button ${tool.id === activeTool ? "is-active" : ""}" data-tool-id="${escapeHtml(tool.id)}" aria-pressed="${tool.id === activeTool}">
        <span class="inova-tool-rail__label">${escapeHtml(tool.label)}</span>
        <span class="inova-tool-rail__count">${Number(tool.count) || 0}</span>
      </button>
    `).join("");
  }

  function buildEffectivePromptToolState(panelState) {
    if (promptLibraryController?.hasRequiredCapabilities?.()) {
      return promptLibraryController.buildPromptToolState(panelState.promptTool || {});
    }
    return panelState.promptTool;
  }

  function buildEffectiveTools(tools, promptCount) {
    return (Array.isArray(tools) ? tools : []).map((tool) => tool?.id === "prompts"
      ? {
          ...tool,
          count: promptCount,
        }
      : tool);
  }

  function readEffectivePromptCount(panelState, effectivePromptTool) {
    const promptItems = Array.isArray(effectivePromptTool?.prompt?.items)
      ? effectivePromptTool.prompt.items
      : [];
    const promptTotal = Math.max(
      0,
      Number(effectivePromptTool?.prompt?.totalCount)
        || Number(effectivePromptTool?.tabs?.find?.((tab) => tab.id === "library")?.count)
        || promptItems.length
    );
    const snapshotPromptCount = Math.max(
      0,
      Number((panelState.tools || []).find((tool) => tool.id === "prompts")?.count)
    );
    return promptTotal || snapshotPromptCount;
  }

  function readEffectivePromptToolCount(effectivePromptTool, promptCount) {
    const activeTab = normalizeText(effectivePromptTool?.activeTab) || "library";
    if (activeTab === "store") {
      return Math.max(
        0,
        Number(effectivePromptTool?.tabs?.find?.((tab) => tab.id === "store")?.count)
          || Number(effectivePromptTool?.store?.totalCount)
          || 0
      );
    }
    if (activeTab === "review") {
      return 0;
    }
    return promptCount;
  }

  function renderStatusCard(options = {}) {
    root.innerHTML = `
      <div class="inova-hosted-panel-status-card is-${escapeHtml(options.tone || "info")}">
        <div class="inova-hosted-panel-status-card__body">
          <strong>${escapeHtml(options.title || "패널 상태를 확인하는 중")}</strong>
          <p>${escapeHtml(options.body || "")}</p>
          ${Array.isArray(options.items) && options.items.length
            ? `<ul>${options.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
            : ""}
          ${options.meta ? `<div class="inova-hosted-panel-status-card__meta">${escapeHtml(options.meta)}</div>` : ""}
        </div>
      </div>
    `;
    state.elements = null;
    state.renderCache = createPanelRenderCache();
  }

  function buildMarkup() {
    return `
      <div class="inova-hosted-panel-app">
        <div class="inova-tool-shell">
          <nav id="inova-tool-rail" aria-label="실험실 전환"></nav>
          <section class="inova-tool-body">
            <header id="inova-tool-header">
              <div class="bookmark-title-main">
                <strong id="inova-tool-title">실험실</strong>
                <span id="inova-tool-total" class="inova-bookmark-badge inova-bookmark-badge--header">0</span>
              </div>
              <button id="inova-tool-close" type="button" aria-label="도구 패널 닫기">닫기</button>
            </header>
            <div id="inova-tool-content"></div>
          </section>
        </div>
        <input id="inova-prompt-import-file" type="file" accept="application/json,.json" hidden />
        <div id="inova-meeting-debug-layer" class="inova-hosted-panel-debug-layer"></div>
      </div>
    `;
  }

  function readMissingCapabilities() {
    return REQUIRED_EXTENSION_CAPABILITIES.filter(
      (capability) => !state.extensionCapabilities.includes(capability)
    );
  }

  function handleRootClick(event) {
    const host = state.elements?.app;
    if (!(host instanceof global.HTMLElement)) {
      return;
    }
    if (!event.target.closest?.('[data-prompt-menu], [data-prompt-action="toggle-menu"]')) {
      void callbacks.onPromptAction("dismiss-menu");
    }
    const toolButton = event.target.closest?.("[data-tool-id]");
    if (toolButton) {
      void callbacks.onSelectTool(toolButton.dataset.toolId || "");
      return;
    }
    if (event.target.closest?.("#inova-tool-close")) {
      void callbacks.onToggle(false);
      return;
    }
    if (namespace.promptHubPanel?.handleClick?.(event, host, callbacks)) {
      return;
    }
    const copyButton = event.target.closest?.("[data-copy-bookmark-id]");
    if (copyButton) {
      callbacks.onCopyBookmark(copyButton.dataset.copyBookmarkId || "")
        .then((copied) => namespace.bookmarkView?.flashCopyState?.(copyButton, copied))
        .catch(() => namespace.bookmarkView?.flashCopyState?.(copyButton, false));
      return;
    }
    const bookmarkButton = event.target.closest?.("[data-bookmark-id]");
    if (bookmarkButton && !event.target.closest?.("[data-copy-bookmark-id]")) {
      bookmarkButton.closest(".inova-bookmark-item")?.focus({ preventScroll: true });
      void callbacks.onJumpBookmark(bookmarkButton.dataset.bookmarkId || "");
      return;
    }
    const meetingAction = event.target.closest?.("[data-meeting-action]");
    if (meetingAction) {
      void callbacks.onMeetingAction(meetingAction.dataset.meetingAction || "", {
        artifactId: meetingAction.dataset.meetingArtifactId || "",
        jobId: meetingAction.dataset.meetingJobId || "",
        meetingId: meetingAction.dataset.meetingId || "",
        title: meetingAction.dataset.meetingTitle || "",
      });
      return;
    }
    const releaseAction = event.target.closest?.("[data-release-action]");
    if (releaseAction) {
      void callbacks.onReleaseAction(releaseAction.dataset.releaseAction || "", {
        version: releaseAction.dataset.releaseVersion || "",
      });
    }
  }

  function handleRootScroll(event) {
    const host = state.elements?.app;
    if (!(host instanceof global.HTMLElement)) {
      return;
    }
    namespace.promptHubPanel?.handleScroll?.(event, host, callbacks);
  }

  function handleRootPointerDown(event) {
    const host = state.elements?.app;
    if (!(host instanceof global.HTMLElement)) {
      return;
    }
    namespace.promptHubPanel?.handlePointerDown?.(event, host);
  }

  function handleRootPointerMove(event) {
    const host = state.elements?.app;
    if (!(host instanceof global.HTMLElement)) {
      return;
    }
    namespace.promptHubPanel?.handlePointerMove?.(event, host);
  }

  function handleRootPointerEnd(event) {
    const host = state.elements?.app;
    if (!(host instanceof global.HTMLElement)) {
      return;
    }
    namespace.promptHubPanel?.handlePointerEnd?.(event, host, callbacks);
  }

  function handleRootCompositionStart(event) {
    const search = event.target.closest?.("[data-search-tool]");
    if (!(search instanceof global.HTMLElement)) {
      return;
    }
    state.searchComposition = {
      active: true,
      toolId: search.dataset.searchTool || "",
    };
  }

  function handleRootCompositionEnd(event) {
    const search = event.target.closest?.("[data-search-tool]");
    if (!(search instanceof global.HTMLElement)) {
      return;
    }
    state.searchComposition = {
      active: false,
      toolId: search.dataset.searchTool || "",
    };
    if (state.renderDeferred) {
      state.renderDeferred = false;
      scheduleRender();
    }
  }

  function handleRootInput(event) {
    const search = event.target.closest?.("[data-search-tool]");
    if (search) {
      void callbacks.onSearch(search.dataset.searchTool || "", search.value, {
        composing: Boolean(event.isComposing || state.searchComposition.active),
      });
      return;
    }
    namespace.promptHubPanel?.handleInput?.(event, callbacks);
  }

  function handleRootChange(event) {
    namespace.promptHubPanel?.handleChange?.(event, callbacks);
  }

  function handleRootSearch(event) {
    const search = event.target.closest?.("[data-search-tool]");
    if (!(search instanceof global.HTMLElement)) {
      return;
    }
    void callbacks.onSearchSubmit(search.dataset.searchTool || "", search.value);
  }

  function handleRootKeydown(event) {
    if (event.key === "Escape") {
      const storeSearch = event.target instanceof global.HTMLElement
        ? event.target.closest?.('[data-search-tool="store"]')
        : null;
      if (storeSearch instanceof global.HTMLInputElement && storeSearch.value) {
        storeSearch.value = "";
        void callbacks.onSearch("store", "", { composing: false });
        void callbacks.onSearchSubmit("store", "");
        event.preventDefault();
        return;
      }
      event.preventDefault();
      void callbacks.onEscape();
      return;
    }
    if (!(event.target instanceof global.HTMLElement)) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (namespace.bookmarkView?.moveFocus?.(event.target, event.key === "ArrowDown" ? 1 : -1)) {
        event.preventDefault();
      }
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const item = event.target.closest("[data-bookmark-id]");
    if (!item || event.target.closest("[data-copy-bookmark-id]")) {
      return;
    }
    event.preventDefault();
    void callbacks.onJumpBookmark(item.dataset.bookmarkId || "");
  }

  function handleImportFileChange() {
    const input = state.elements?.fileInput;
    const [file] = Array.from(input?.files || []);
    if (file) {
      void callbacks.onImportFile(file);
    }
    if (input) {
      input.value = "";
    }
  }

  function captureFocusedControl(host) {
    if (!(host instanceof global.HTMLElement)) {
      return null;
    }
    const active = document.activeElement;
    if (!(active instanceof global.HTMLElement) || !host.contains(active)) {
      return null;
    }
    const tagName = String(active.tagName || "").toLowerCase();
    if (!["input", "textarea", "select"].includes(tagName)) {
      return null;
    }
    const selector = buildFocusSelector(active);
    if (!selector) {
      return null;
    }
    return {
      end: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
      scrollLeft: typeof active.scrollLeft === "number" ? active.scrollLeft : 0,
      scrollTop: typeof active.scrollTop === "number" ? active.scrollTop : 0,
      selector,
      start: typeof active.selectionStart === "number" ? active.selectionStart : null,
      value: "value" in active ? String(active.value || "") : "",
    };
  }

  function restoreFocusedControl(host, snapshot) {
    if (!(host instanceof global.HTMLElement) || !snapshot?.selector) {
      return;
    }
    const next = host.querySelector(snapshot.selector);
    if (!(next instanceof global.HTMLElement)) {
      return;
    }
    next.focus({ preventScroll: true });
    if ("value" in next && typeof snapshot.value === "string" && String(next.value || "") !== snapshot.value) {
      next.value = snapshot.value;
    }
    if (typeof next.setSelectionRange === "function" && snapshot.start != null) {
      const valueLength = String(next.value || "").length;
      const start = Math.max(0, Math.min(valueLength, Number(snapshot.start) || 0));
      const end = Math.max(start, Math.min(valueLength, Number(snapshot.end) || start));
      next.setSelectionRange(start, end);
    }
    if (typeof next.scrollLeft === "number") {
      next.scrollLeft = Number(snapshot.scrollLeft) || 0;
    }
    if (typeof next.scrollTop === "number") {
      next.scrollTop = Number(snapshot.scrollTop) || 0;
    }
  }

  function buildFocusSelector(element) {
    if (!(element instanceof global.HTMLElement)) {
      return "";
    }
    const searchTool = element.dataset.searchTool;
    if (searchTool) {
      return `[data-search-tool="${escapeSelector(searchTool)}"]`;
    }
    const storeField = element.dataset.storeField;
    if (storeField) {
      return `[data-store-field="${escapeSelector(storeField)}"]`;
    }
    const promptField = element.dataset.promptField;
    if (promptField) {
      return `[data-prompt-field="${escapeSelector(promptField)}"]`;
    }
    const promptPublishField = element.dataset.promptPublishField;
    if (promptPublishField) {
      const promptId = element.dataset.promptId || "";
      return `[data-prompt-publish-field="${escapeSelector(promptPublishField)}"][data-prompt-id="${escapeSelector(promptId)}"]`;
    }
    if (element.id) {
      return `#${escapeSelector(element.id)}`;
    }
    return "";
  }

  function syncMeetingDebugLayerDataset(debugLayer, panelDebug) {
    const totalLogs = Math.max(0, Number(panelDebug?.statusSummary?.totalLogs) || 0);
    debugLayer.dataset.debugCollapsed = String(Boolean(panelDebug?.collapsed));
    debugLayer.dataset.debugEnabled = String(Boolean(panelDebug?.enabled));
    debugLayer.dataset.debugEntryCount = String(totalLogs);
    debugLayer.dataset.debugHasErrors = String(Boolean(panelDebug?.hasErrors));
    debugLayer.dataset.debugRendered = String(Boolean(debugLayer.innerHTML));
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
      console.warn("[i-Nova Hosted Panel] render cache key failed", error);
      return `cache-error:${Date.now()}`;
    }
  }

  function buildRequestId() {
    state.requestSeq += 1;
    return `hosted-panel-${Date.now()}-${state.requestSeq}`;
  }

  function readParentOrigin() {
    try {
      const configured = new URLSearchParams(global.location.search || "").get("inovaParentOrigin") || "";
      if (configured) {
        return normalizeOrigin(new URL(configured).origin);
      }
      return normalizeOrigin(new URL(document.referrer).origin);
    } catch {
      return "";
    }
  }

  function normalizeOrigin(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return "";
    }
    try {
      return new URL(normalized).origin;
    } catch {
      return normalized;
    }
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value || "").trim();
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function escapeSelector(value) {
    const text = String(value || "");
    if (global.CSS?.escape) {
      return global.CSS.escape(text);
    }
    return text.replace(/["\\]/g, "\\$&");
  }
})(globalThis);
