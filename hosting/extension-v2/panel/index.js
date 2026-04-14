(function initHostedPanelApp(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const BRIDGE_VERSION = 1;
  const APP_SOURCE = "inova-hosted-panel-app";
  const EXTENSION_SOURCE = "inova-hosted-panel-extension";
  const REQUEST_TIMEOUT_MS = 15000;
  const STARTUP_STATUS_CARD_DELAY_MS = 450;
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
  const HOSTED_PANEL_TOOLS = Object.freeze([
    { id: "bookmarks", label: "대화" },
    { id: "meeting", label: "회의 룸" },
    { id: "prompts", label: "프롬프트" },
    { id: "release", label: "릴리스" },
  ]);

  const root = document.getElementById("inova-hosted-panel-root");
  const state = {
    bridgeReady: false,
    elements: null,
    extensionCapabilities: [],
    extensionVersion: "",
    lastControllerSyncKey: "",
    panelAppUrl: "",
    panelSnapshot: null,
    parentOrigin: readParentOrigin(),
    pendingRequests: new Map(),
    readyPingCount: 0,
    renderCache: createPanelRenderCache(),
    renderDeferred: false,
    renderFrame: 0,
    requestSeq: 0,
    startupStatusShown: false,
    startupStatusTimerId: 0,
    traceRequestIds: new Set(),
    inputComposition: createInputCompositionState(),
    storeRenderKey: 0,
    storeScrollTop: 0,
  };
  const api = {
    invokePage,
    invokeRuntime,
    request,
  };
  const conversationController = namespace.conversationController?.create?.({
    invokePage,
    scheduleRender,
    traceConversation: traceConversationFlow,
  }) || null;
  let promptStoreController = null;
  const promptLibraryController = namespace.promptLibraryController?.create?.({
    getStoreCategories: () => promptStoreController?.getPublishCategories?.() || [],
    ensureStoreLoaded: (...args) => promptStoreController?.ensureLoaded?.(...args) || Promise.resolve(),
    invokePage,
    invokeRuntime,
    scheduleRender,
    traceFirestore: traceFirestoreFlow,
    traceReview: traceReviewFlow,
  }) || null;
  const promptReviewController = namespace.promptReviewController?.create?.({
    getActivePromptTab: () => promptLibraryController?.getActiveTab?.() || "library",
    getProviderIdentity: () => promptLibraryController?.getProviderIdentity?.() || { available: false },
    getRuntimeVersion: () => state.extensionVersion || "",
    invokePage,
    invokeRuntime,
    scheduleRender,
    traceReview: traceReviewFlow,
    setActivePromptTab: (promptTabId) => promptLibraryController?.handleSelectPromptTab?.(promptTabId) || Promise.resolve(false),
  }) || null;
  promptStoreController = namespace.promptStoreController?.create?.({
    getActivePromptTab: () => promptLibraryController?.getActiveTab?.() || "library",
    getProviderIdentity: () => promptLibraryController?.getProviderIdentity?.() || { available: false },
    importStorePrompt: (storeEntry) => promptLibraryController?.importStorePrompt?.(storeEntry) || Promise.resolve(false),
    invokeRuntime,
    scheduleRender,
  }) || null;
  const meetingHubController = namespace.meetingHubController?.create?.({
    invokePage,
    invokeRuntime,
    scheduleRender,
    syncTopPanelSummary: (meetingTool = {}) => syncToolSummary("meeting", meetingTool),
    traceFirestore: traceFirestoreFlow,
    traceMeeting: traceMeetingFlow,
  }) || null;
  const releaseController = namespace.releaseController?.create?.({
    getRuntimeVersion: () => state.extensionVersion || "",
    invokeRuntime,
    scheduleRender,
    syncTopPanelSummary: (releaseTool = {}) => syncToolSummary("release", releaseTool),
    traceRelease: traceReleaseFlow,
  }) || null;
  const callbacks = createCallbacks();

  namespace.hostedPanelApp = api;

  bootstrap();

  function bootstrap() {
    if (!(root instanceof global.HTMLElement)) {
      return;
    }
    tracePanelFlow("11.hosted.bootstrap.start", {
      parentOrigin: state.parentOrigin || "*",
    });
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
    global.addEventListener("error", handleWindowError);
    global.addEventListener("unhandledrejection", handleUnhandledRejection);
    global.addEventListener("message", handleWindowMessage);
    global.document.addEventListener("visibilitychange", handleDocumentVisibilityChange, { passive: true });
    tracePanelFlow("12.hosted.listeners.bound", {});
    scheduleStartupStatusCard();
    sendReady();
    scheduleReadyPing();
  }

  function createCallbacks() {
    return {
      async onCopyBookmark(bookmarkId) {
        if (conversationController?.handleCopyBookmark) {
          const handled = await conversationController.handleCopyBookmark(bookmarkId);
          if (handled !== false) {
            return handled;
          }
        }
        const response = await request("panel", {
          action: "bookmark-copy",
          bookmarkId,
        });
        return Boolean(response?.copied);
      },
      onEscape() {
        if (promptReviewController?.consumeEscape?.()) {
          return Promise.resolve(true);
        }
        return request("panel", {
          action: "escape",
        });
      },
      onImportFile(file) {
        if (promptLibraryController?.handleImportFile) {
          return promptLibraryController.handleImportFile(file);
        }
        return Promise.resolve(false);
      },
      onJumpBookmark(bookmarkId) {
        if (conversationController?.handleJumpBookmark) {
          return conversationController.handleJumpBookmark(bookmarkId).then((handled) => {
            if (handled !== false) {
              return handled;
            }
            return request("panel", {
              action: "bookmark-jump",
              bookmarkId,
            });
          });
        }
        return request("panel", {
          action: "bookmark-jump",
          bookmarkId,
        });
      },
      onMeetingAction(meetingAction, detail = {}) {
        traceMeetingFlow("41.hosted.callback.enter", {
          detail,
          meetingAction,
        });
        if (meetingHubController?.handleMeetingAction) {
          return Promise.resolve(meetingHubController.handleMeetingAction(meetingAction, detail)).then((handled) => {
            traceMeetingFlow("42.hosted.controller.result", {
              handled,
              meetingAction,
            });
            return handled;
          });
        }
        return Promise.resolve(false);
      },
      onMovePrompt(dragPromptId, targetPromptId, placement) {
        if (promptLibraryController?.handleMovePrompt) {
          return promptLibraryController.handleMovePrompt(dragPromptId, targetPromptId, placement);
        }
        return Promise.resolve(false);
      },
      onPromptAction(promptAction, detail = {}) {
        if (promptReviewController?.handlePromptAction) {
          return promptReviewController.handlePromptAction(promptAction, detail).then((handled) => {
            if (handled !== false) {
              return handled;
            }
            if (promptLibraryController?.handlePromptAction) {
              return promptLibraryController.handlePromptAction(promptAction, detail);
            }
            return false;
          });
        }
        if (promptLibraryController?.handlePromptAction) {
          return promptLibraryController.handlePromptAction(promptAction, detail);
        }
        return Promise.resolve(false);
      },
      onPromptDraftChange(field, value) {
        if (promptLibraryController?.handlePromptDraftChange) {
          return Promise.resolve(promptLibraryController.handlePromptDraftChange(field, value));
        }
        return Promise.resolve(false);
      },
      onReleaseAction(releaseAction, detail = {}) {
        if (releaseController?.handleReleaseAction) {
          return releaseController.handleReleaseAction(releaseAction, detail);
        }
        return Promise.resolve(false);
      },
      onSearch(toolId, value, options = {}) {
        if (conversationController?.handleSearch?.(toolId, value, options) !== false) {
          return Promise.resolve(true);
        }
        if (promptStoreController?.handleSearch?.(toolId, value, options) !== false) {
          return Promise.resolve(true);
        }
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
        if (conversationController?.handleSearch?.(toolId, value, { submit: true }) !== false) {
          return Promise.resolve(true);
        }
        if (promptStoreController?.handleSearch?.(toolId, value, { submit: true }) !== false) {
          return Promise.resolve(true);
        }
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
          return promptLibraryController.handleSelectPromptTab(promptTabId);
        }
        return Promise.resolve(false);
      },
      onSelectTool(toolId) {
        return request("panel", {
          action: "select-tool",
          toolId,
        });
      },
      onStoreAction(storeAction, detail = {}) {
        if (promptStoreController?.handleStoreAction) {
          return promptStoreController.handleStoreAction(storeAction, detail);
        }
        return Promise.resolve(false);
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
    tracePanelFlow("14.hosted.ready.ping.scheduled", {
      count: state.readyPingCount,
    });
    global.setTimeout(() => {
      if (!state.panelSnapshot) {
        tracePanelFlow("15.hosted.ready.ping.fire", {
          count: state.readyPingCount,
        });
        sendReady();
        scheduleReadyPing();
      }
    }, 700);
  }

  function sendReady() {
    tracePanelFlow("13.hosted.ready.post", {
      capabilities: APP_CAPABILITIES.slice(),
    });
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
    if (isTraceTransportEnvelope(envelope)) {
      state.traceRequestIds.delete(envelope.requestId);
      return;
    }
    tracePanelFlow("16.hosted.message.received", {
      domain: envelope.domain,
      origin: normalizeText(event.origin),
      requestId: envelope.requestId,
      type: envelope.type,
    });
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
    tracePanelFlow("17.hosted.snapshot.received", {
      activeTool: normalizeText(payload?.panel?.activeTool),
      extensionVersion: normalizeText(payload.extensionVersion),
      panelAppUrl: normalizeText(payload.panelAppUrl),
    });
    state.bridgeReady = true;
    state.extensionCapabilities = normalizeCapabilities(
      payload.extensionCapabilities?.length ? payload.extensionCapabilities : envelope.capabilities
    );
    state.extensionVersion = normalizeText(payload.extensionVersion);
    state.panelAppUrl = normalizeText(payload.panelAppUrl);
    state.panelSnapshot = payload.panel && typeof payload.panel === "object"
      ? cloneValue(payload.panel)
      : null;
    clearStartupStatusCard();
    tracePanelFlow("18.hosted.snapshot.applied", {
      activeTool: normalizeText(state.panelSnapshot?.activeTool),
      meetingCount: Number(state.panelSnapshot?.meetingTool?.count) || 0,
      toolTitle: buildHostedToolTitle(state.panelSnapshot?.activeTool),
    });
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
      conversationController?.setActiveBookmark?.(normalizeText(envelope.payload?.bookmarkId));
      namespace.bookmarkView?.setActive?.(normalizeText(envelope.payload?.bookmarkId));
    }
  }

  function request(domain, payload = {}) {
    const requestId = buildRequestId();
    const traceAction = readTraceAction(domain, payload);
    const traceSpec = buildRequestTraceSpec(domain, payload);
    if (traceSpec) {
      traceSpec.trace(traceSpec.startStep, {
        ...traceSpec.buildStartPayload?.(),
        requestId,
      });
    } else if (!(normalizeText(domain) === "page" && isPageTraceAction(traceAction))) {
      tracePanelFlow("30.hosted.request.start", {
        action: traceAction,
        domain,
        requestId,
      });
    }
    postEnvelope({
      domain,
      payload,
      requestId,
      type: "request",
    });
    return new Promise((resolve, reject) => {
      const timeoutId = global.setTimeout(() => {
        state.pendingRequests.delete(requestId);
        if (traceSpec) {
          traceSpec.trace(traceSpec.timeoutStep, {
            ...traceSpec.buildTimeoutPayload?.(Date.now() - startedAtMs),
            error: "호스팅 패널 요청 시간이 초과되었어요.",
            requestId,
          });
        } else if (!(normalizeText(domain) === "page" && isPageTraceAction(traceAction))) {
          tracePanelFlow("31.hosted.request.timeout", {
            action: traceAction,
            domain,
            requestId,
          });
        }
        reject(new Error("호스팅 패널 요청 시간이 초과되었어요."));
      }, REQUEST_TIMEOUT_MS);
      const startedAtMs = Date.now();
      state.pendingRequests.set(requestId, {
        action: traceAction,
        domain,
        reject,
        resolve,
        startedAtMs,
        traceSpec,
        timeoutId,
      });
    });
  }

  function syncToolSummary(toolId, toolState = {}) {
    return request("panel", {
      action: "tool-summary-sync",
      toolId: normalizeText(toolId),
      toolState,
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
      if (entry.traceSpec) {
        entry.traceSpec.trace(entry.traceSpec.errorStep, {
          ...entry.traceSpec.buildResultPayload?.(Date.now() - entry.startedAtMs),
          error: normalizeText(errorMessage),
          requestId,
        });
      } else if (!(normalizeText(entry.domain) === "page" && isPageTraceAction(entry.action))) {
        tracePanelFlow("32.hosted.request.error", {
          action: entry.action,
          domain: entry.domain,
          error: normalizeText(errorMessage),
          requestId,
        });
      }
      entry.reject(new Error(errorMessage));
      return;
    }
    if (payload?.handled === false) {
      if (entry.traceSpec) {
        entry.traceSpec.trace(entry.traceSpec.errorStep, {
          ...entry.traceSpec.buildResultPayload?.(Date.now() - entry.startedAtMs),
          error: "확장 프로그램이 요청을 처리하지 않았어요.",
          requestId,
        });
      } else if (!(normalizeText(entry.domain) === "page" && isPageTraceAction(entry.action))) {
        tracePanelFlow("32.hosted.request.error", {
          action: entry.action,
          domain: entry.domain,
          error: "확장 프로그램이 요청을 처리하지 않았어요.",
          requestId,
        });
      }
      entry.reject(new Error("확장 프로그램이 요청을 처리하지 않았어요."));
      return;
    }
    if (entry.traceSpec) {
      entry.traceSpec.trace(entry.traceSpec.successStep, {
        ...entry.traceSpec.buildResultPayload?.(Date.now() - entry.startedAtMs),
        requestId,
      });
    } else if (!(normalizeText(entry.domain) === "page" && isPageTraceAction(entry.action))) {
      tracePanelFlow("33.hosted.request.success", {
        action: entry.action,
        domain: entry.domain,
        requestId,
      });
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
    if (state.inputComposition.active) {
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
      if (state.renderDeferred && !state.inputComposition.active) {
        state.renderDeferred = false;
        scheduleRender();
      }
    });
  }

  function flushRender() {
    const panelState = state.panelSnapshot;
    if (!panelState) {
      tracePanelFlow("19.hosted.render.waiting-snapshot", {
        bridgeReady: Boolean(state.bridgeReady),
      });
      scheduleStartupStatusCard();
      if (state.startupStatusShown) {
        renderPendingSnapshotStatusCard();
      }
      return;
    }
    tracePanelFlow("19.hosted.render.flush", {
      activeTool: normalizeText(panelState.activeTool),
      bridgeReady: Boolean(state.bridgeReady),
      meetingCount: Number(panelState.meetingTool?.count) || 0,
      toolTitle: buildHostedToolTitle(panelState.activeTool),
    });
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

    syncHostedControllersIfNeeded(panelState);
    ensureShell();
    const elements = state.elements;
    if (!elements) {
      return;
    }
    const effectiveConversationTool = buildEffectiveConversationToolState(panelState);
    const effectiveConversationCount = readEffectiveConversationCount(panelState, effectiveConversationTool);
    const effectivePromptTool = buildEffectivePromptToolState(panelState);
    const effectivePromptCount = readEffectivePromptCount(panelState, effectivePromptTool);
    const effectiveMeetingTool = buildEffectiveMeetingToolState(panelState);
    const effectiveMeetingCount = readEffectiveMeetingCount(panelState, effectiveMeetingTool);
    const effectiveReleaseTool = buildEffectiveReleaseToolState(panelState);
    const effectiveReleaseCount = readEffectiveReleaseCount(panelState, effectiveReleaseTool);
    const effectiveToolCount = panelState.activeTool === "prompts"
      ? readEffectivePromptToolCount(effectivePromptTool, effectivePromptCount)
      : panelState.activeTool === "meeting"
        ? effectiveMeetingCount
        : panelState.activeTool === "release"
          ? effectiveReleaseCount
          : effectiveConversationCount;
    const focusedControl = captureFocusedControl(elements.app);
    const previousStoreScrollTop = panelState.activeTool === "prompts" && effectivePromptTool?.activeTab === "store"
      ? elements.app.querySelector(".inova-store-list")?.scrollTop || state.storeScrollTop || 0
      : 0;

    const nextToolRailHtml = renderToolRail(
      buildHostedToolItems(
        effectiveConversationCount,
        effectivePromptCount,
        effectiveMeetingCount,
        effectiveReleaseCount
      ),
      panelState.activeTool
    );
    if (state.renderCache.toolRailHtml !== nextToolRailHtml) {
      elements.toolRail.innerHTML = nextToolRailHtml;
      state.renderCache.toolRailHtml = nextToolRailHtml;
    }

    const nextToolTitle = buildHostedToolTitle(panelState.activeTool);
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

    if (panelState.activeTool === "prompts" && effectivePromptTool?.activeTab === "store") {
      namespace.promptToolPanel?.syncStoreList?.(elements.app, callbacks, {
        renderKey: effectivePromptTool?.store?.renderKey,
        scrollTop: previousStoreScrollTop,
      });
    }
    namespace.bookmarkView?.setActive?.(effectiveConversationTool?.activeId);
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
      fileInput: root.querySelector("#inova-prompt-import-file"),
      toolContent: root.querySelector("#inova-tool-content"),
      toolRail: root.querySelector("#inova-tool-rail"),
      toolTitle: root.querySelector("#inova-tool-title"),
      toolTotal: root.querySelector("#inova-tool-total"),
    };
  }

  function syncHostedControllersIfNeeded(panelState) {
    const nextControllerSyncKey = serializeRenderState({
      extensionCapabilities: state.extensionCapabilities,
      panel: panelState,
    });
    if (state.lastControllerSyncKey === nextControllerSyncKey) {
      return;
    }
    state.lastControllerSyncKey = nextControllerSyncKey;
    conversationController?.syncPanelState?.(panelState, state.extensionCapabilities);
    promptLibraryController?.syncPanelState?.(panelState, state.extensionCapabilities);
    promptReviewController?.syncPanelState?.(panelState, state.extensionCapabilities);
    promptStoreController?.syncPanelState?.(panelState, state.extensionCapabilities);
    meetingHubController?.syncPanelState?.(panelState, state.extensionCapabilities);
    releaseController?.syncPanelState?.(panelState, state.extensionCapabilities);
  }

  function createPanelRenderCache() {
    return {
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

  function buildToolContentKey(panelState) {
    return `${panelState.activeTool}:${serializeRenderState(getActiveToolState(panelState))}`;
  }

  function getActiveToolState(panelState) {
    if (panelState.activeTool === "bookmarks") {
      return buildEffectiveConversationToolState(panelState);
    }
    if (panelState.activeTool === "prompts") {
      return buildEffectivePromptToolState(panelState);
    }
    if (panelState.activeTool === "meeting") {
      return buildEffectiveMeetingToolState(panelState);
    }
    if (panelState.activeTool === "release") {
      return buildEffectiveReleaseToolState(panelState);
    }
    return panelState.bookmarksTool;
  }

  function renderToolContent(panelState) {
    try {
      if (panelState.activeTool === "bookmarks") {
        return namespace.bookmarkView?.renderTool?.(buildEffectiveConversationToolState(panelState)) || renderToolFailure();
      }
      if (panelState.activeTool === "prompts") {
        return namespace.promptToolView?.render?.(buildEffectivePromptToolState(panelState)) || renderToolFailure();
      }
      if (panelState.activeTool === "meeting") {
        return namespace.meetingView?.render?.(buildEffectiveMeetingToolState(panelState)) || renderToolFailure();
      }
      if (panelState.activeTool === "release") {
        return namespace.releaseView?.render?.(buildEffectiveReleaseToolState(panelState)) || renderToolFailure();
      }
      return renderToolFailure();
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

  function buildHostedToolItems(conversationCount, promptCount, meetingCount, releaseCount) {
    return HOSTED_PANEL_TOOLS.map((tool) => ({
      ...tool,
      count: tool.id === "bookmarks"
        ? conversationCount
        : tool.id === "prompts"
          ? promptCount
          : tool.id === "meeting"
            ? meetingCount
            : releaseCount,
    }));
  }

  function buildHostedToolTitle(activeTool) {
    const normalizedTool = normalizeText(activeTool);
    if (normalizedTool === "prompts") {
      return "프롬프트";
    }
    if (normalizedTool === "meeting") {
      return "회의 룸";
    }
    if (normalizedTool === "release") {
      return "릴리스 안내";
    }
    return "대화 탐색";
  }

  function buildEffectiveConversationToolState(panelState) {
    if (conversationController?.hasRequiredCapabilities?.()) {
      return conversationController.buildViewState(panelState.bookmarksTool || {});
    }
    return panelState.bookmarksTool;
  }

  function buildEffectivePromptToolState(panelState) {
    if (promptLibraryController?.hasRequiredCapabilities?.()) {
      const snapshotReviewState = panelState.promptTool?.review || null;
      const hostedReviewState = promptReviewController?.buildViewState
        ? promptReviewController.buildViewState()
        : snapshotReviewState;
      const reviewState = resolveEffectivePromptReviewState(snapshotReviewState, hostedReviewState);
      const storeState = promptStoreController?.buildViewState
        ? promptStoreController.buildViewState()
        : null;
      const storeCount = Math.max(
        0,
        Number(promptStoreController?.getStoreCount?.() || storeState?.totalCount) || 0
      );
      const promptToolState = promptLibraryController.buildPromptToolState(panelState.promptTool || {}, {
        reviewOpen: Boolean(reviewState?.open),
        storeCount,
      });
      if (storeState) {
        promptToolState.store = storeState;
      }
      promptToolState.review = reviewState;
      if (
        promptToolState.activeTab === "review"
        || snapshotReviewState?.open
        || reviewState?.open
        || snapshotReviewState?.result
        || reviewState?.result
      ) {
        traceReviewFlow("70.hosted.review.state", {
          available: Boolean(reviewState?.available),
          hasResult: Boolean(reviewState?.result),
          open: Boolean(reviewState?.open),
          pending: Boolean(reviewState?.pending),
          promptTab: normalizeText(promptToolState.activeTab),
          snapshotOpen: Boolean(snapshotReviewState?.open),
          reason: hostedReviewState?.result
            ? "hosted-has-result"
            : snapshotReviewState?.result
            ? "snapshot-has-result"
            : "review-visible",
          reviewOpen: Boolean(reviewState?.open),
        });
      }
      return promptToolState;
    }
    return panelState.promptTool;
  }

  function resolveEffectivePromptReviewState(snapshotReviewState, hostedReviewState) {
    const snapshotState = snapshotReviewState && typeof snapshotReviewState === "object"
      ? snapshotReviewState
      : null;
    const hostedState = hostedReviewState && typeof hostedReviewState === "object"
      ? hostedReviewState
      : null;
    if (!snapshotState) {
      return hostedState;
    }
    if (!hostedState) {
      return snapshotState;
    }
    const snapshotHasActiveState = Boolean(
      snapshotState.open
      || snapshotState.pending
      || snapshotState.result
    );
    const hostedHasActiveState = Boolean(
      hostedState.open
      || hostedState.pending
      || hostedState.result
    );
    if (snapshotState.pending && !hostedState.pending) {
      return mergeSnapshotReviewState(snapshotState, hostedState, { preserveHostedError: false });
    }
    if (hostedState.pending) {
      return hostedState;
    }
    if (snapshotHasActiveState && !hostedHasActiveState) {
      return mergeSnapshotReviewState(snapshotState, hostedState, { preserveHostedError: false });
    }
    if (hostedHasActiveState) {
      return hostedState;
    }
    if (hostedState.error || hostedState.available) {
      return hostedState;
    }
    return mergeSnapshotReviewState(snapshotState, hostedState, { preserveHostedError: true });
  }

  function mergeSnapshotReviewState(snapshotState, hostedState, options = {}) {
    return {
      ...snapshotState,
      copyState: hostedState.copyState,
      error: options.preserveHostedError
        ? hostedState.error || snapshotState.error
        : snapshotState.error,
      placeholderConfirmation: Boolean(hostedState.placeholderConfirmation || snapshotState.placeholderConfirmation),
    };
  }

  function buildEffectiveMeetingToolState(panelState) {
    if (meetingHubController?.hasRequiredCapabilities?.()) {
      return meetingHubController.buildViewState();
    }
    return panelState.meetingTool;
  }

  function buildEffectiveReleaseToolState(panelState) {
    if (releaseController?.hasRequiredCapabilities?.()) {
      return releaseController.buildViewState(panelState.releaseTool || {});
    }
    return panelState.releaseTool;
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
    return promptTotal;
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

  function readEffectiveConversationCount(panelState, effectiveConversationTool) {
    return Math.max(
      0,
      Number(effectiveConversationTool?.count)
        || Number(panelState.bookmarksTool?.count)
        || (Array.isArray(effectiveConversationTool?.items) ? effectiveConversationTool.items.length : 0)
    );
  }

  function readEffectiveMeetingCount(panelState, effectiveMeetingTool) {
    if (meetingHubController?.hasRequiredCapabilities?.()) {
      return Math.max(
        0,
        Number(effectiveMeetingTool?.count)
          || (Array.isArray(effectiveMeetingTool?.items) ? effectiveMeetingTool.items.length : 0)
      );
    }
    return Math.max(
      0,
      Number(effectiveMeetingTool?.count)
        || Number(panelState.meetingTool?.count)
        || (Array.isArray(effectiveMeetingTool?.items) ? effectiveMeetingTool.items.length : 0)
    );
  }

  function readEffectiveReleaseCount(panelState, effectiveReleaseTool) {
    return Math.max(
      0,
      Number(effectiveReleaseTool?.updateAvailable ? 1 : 0)
        || Number(effectiveReleaseTool?.count)
        || Number(panelState.releaseTool?.updateAvailable ? 1 : 0)
        || Number(panelState.releaseTool?.count)
        || 0
    );
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

  function scheduleStartupStatusCard() {
    if (state.panelSnapshot || state.startupStatusTimerId || state.startupStatusShown) {
      return;
    }
    state.startupStatusTimerId = global.setTimeout(() => {
      state.startupStatusTimerId = 0;
      if (state.panelSnapshot) {
        return;
      }
      state.startupStatusShown = true;
      renderPendingSnapshotStatusCard();
    }, STARTUP_STATUS_CARD_DELAY_MS);
  }

  function clearStartupStatusCard() {
    if (state.startupStatusTimerId) {
      global.clearTimeout(state.startupStatusTimerId);
      state.startupStatusTimerId = 0;
    }
    state.startupStatusShown = false;
  }

  function renderPendingSnapshotStatusCard() {
    renderStatusCard({
      body: state.bridgeReady
        ? "패널 상태 스냅샷을 기다리고 있습니다."
        : "확장 프로그램과 패널 상태를 연결하는 중입니다.",
      meta: state.bridgeReady ? `extension ${state.extensionVersion || "unknown"}` : "",
      title: state.bridgeReady ? "패널을 준비하는 중" : "호스팅 패널 준비 중",
      tone: "info",
    });
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
    const target = getEventElementTarget(event);
    if (!target) {
      return;
    }
    if (!target.closest?.('[data-prompt-menu], [data-prompt-action="toggle-menu"]')) {
      void callbacks.onPromptAction("dismiss-menu");
    }
    const toolButton = target.closest?.("[data-tool-id]");
    if (toolButton) {
      tracePanelFlow("40.hosted.click.detected", {
        action: "select-tool",
        message: toolButton.dataset.toolId || "",
        reason: "click",
      });
      void callbacks.onSelectTool(toolButton.dataset.toolId || "");
      return;
    }
    if (target.closest?.("#inova-tool-close")) {
      void callbacks.onToggle(false);
      return;
    }
    const promptTabButton = target.closest?.("[data-prompt-tab-id]");
    if (promptTabButton) {
      tracePanelFlow("40.hosted.click.detected", {
        action: "select-prompt-tab",
        message: promptTabButton.dataset.promptTabId || "",
        reason: "click",
      });
    }
    const promptActionButton = target.closest?.("[data-prompt-action]");
    if (promptActionButton) {
      tracePanelFlow("40.hosted.click.detected", {
        action: promptActionButton.dataset.promptAction || "",
        message: promptActionButton.dataset.promptId || "",
        reason: "click",
      });
    }
    if (namespace.promptToolPanel?.handleClick?.(event, host, callbacks)) {
      return;
    }
    const copyButton = target.closest?.("[data-copy-bookmark-id]");
    if (copyButton) {
      tracePanelFlow("40.hosted.click.detected", {
        action: "bookmark-copy",
        message: copyButton.dataset.copyBookmarkId || "",
        reason: "click",
      });
      callbacks.onCopyBookmark(copyButton.dataset.copyBookmarkId || "")
        .then((copied) => namespace.bookmarkView?.flashCopyState?.(copyButton, copied))
        .catch(() => namespace.bookmarkView?.flashCopyState?.(copyButton, false));
      return;
    }
    const bookmarkButton = target.closest?.("[data-bookmark-id]");
    if (bookmarkButton && !target.closest?.("[data-copy-bookmark-id]")) {
      tracePanelFlow("40.hosted.click.detected", {
        action: "bookmark-jump",
        message: bookmarkButton.dataset.bookmarkId || "",
        reason: "click",
      });
      bookmarkButton.closest(".inova-bookmark-item")?.focus({ preventScroll: true });
      void callbacks.onJumpBookmark(bookmarkButton.dataset.bookmarkId || "");
      return;
    }
    const meetingAction = target.closest?.("[data-meeting-action]");
    if (meetingAction) {
      traceMeetingFlow("40.hosted.click.detected", {
        action: meetingAction.dataset.meetingAction || "",
        artifactId: meetingAction.dataset.meetingArtifactId || "",
        jobId: meetingAction.dataset.meetingJobId || "",
        meetingId: meetingAction.dataset.meetingId || "",
      });
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
    namespace.promptToolPanel?.handleScroll?.(event, host, callbacks);
  }

  function handleRootPointerDown(event) {
    const host = state.elements?.app;
    if (!(host instanceof global.HTMLElement)) {
      return;
    }
    namespace.promptToolPanel?.handlePointerDown?.(event, host);
  }

  function handleRootPointerMove(event) {
    const host = state.elements?.app;
    if (!(host instanceof global.HTMLElement)) {
      return;
    }
    namespace.promptToolPanel?.handlePointerMove?.(event, host);
  }

  function handleRootPointerEnd(event) {
    const host = state.elements?.app;
    if (!(host instanceof global.HTMLElement)) {
      return;
    }
    namespace.promptToolPanel?.handlePointerEnd?.(event, host, callbacks);
  }

  function handleRootCompositionStart(event) {
    const binding = getTextInputBinding(getEventElementTarget(event));
    if (!binding) {
      return;
    }
    state.inputComposition = createInputCompositionState({
      active: true,
      field: binding.field || "",
      kind: binding.kind,
      promptId: binding.promptId || "",
      toolId: binding.toolId || "",
    });
  }

  function handleRootCompositionEnd(event) {
    const binding = getTextInputBinding(getEventElementTarget(event));
    if (!binding) {
      return;
    }
    state.renderDeferred = false;
    state.inputComposition = createInputCompositionState({
      field: binding.field || "",
      kind: binding.kind,
      promptId: binding.promptId || "",
      toolId: binding.toolId || "",
    });
    const handled = applyTextInputBinding(binding, { composing: false });
    if (!handled && !state.renderFrame) {
      scheduleRender();
    }
  }

  function handleRootInput(event) {
    const target = getEventElementTarget(event);
    const binding = getTextInputBinding(target);
    if (binding) {
      const composing = Boolean(event.isComposing || state.inputComposition.active);
      if (composing) {
        state.inputComposition = createInputCompositionState({
          active: true,
          field: binding.field || "",
          kind: binding.kind,
          promptId: binding.promptId || "",
          toolId: binding.toolId || "",
        });
        state.renderDeferred = true;
        return;
      }
      applyTextInputBinding(binding, { composing: false });
      return;
    }
    namespace.promptToolPanel?.handleInput?.(event, callbacks);
  }

  function handleRootChange(event) {
    namespace.promptToolPanel?.handleChange?.(event, callbacks);
  }

  function handleRootSearch(event) {
    const target = getEventElementTarget(event);
    const search = target?.closest?.("[data-search-tool]");
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
    const target = getEventElementTarget(event);
    if (!(target instanceof global.HTMLElement)) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (namespace.bookmarkView?.moveFocus?.(target, event.key === "ArrowDown" ? 1 : -1)) {
        event.preventDefault();
      }
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const item = target.closest("[data-bookmark-id]");
    if (!item || target.closest("[data-copy-bookmark-id]")) {
      return;
    }
    event.preventDefault();
    tracePanelFlow("41.hosted.key.detected", {
      action: "bookmark-jump",
      message: item.dataset.bookmarkId || "",
      reason: event.key === " " ? "space" : "enter",
    });
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

  function createInputCompositionState(overrides = {}) {
    return {
      active: false,
      field: "",
      kind: "",
      promptId: "",
      toolId: "",
      ...overrides,
    };
  }

  function getTextInputBinding(target) {
    if (!(target instanceof global.HTMLElement)) {
      return null;
    }
    const search = target.closest?.("[data-search-tool]");
    if (search instanceof global.HTMLInputElement || search instanceof global.HTMLTextAreaElement) {
      return {
        element: search,
        kind: "search",
        toolId: search.dataset.searchTool || "",
      };
    }
    const promptField = target.closest?.("[data-prompt-field]");
    if (promptField instanceof global.HTMLInputElement || promptField instanceof global.HTMLTextAreaElement) {
      return {
        element: promptField,
        field: promptField.dataset.promptField || "",
        kind: "prompt-field",
      };
    }
    const promptPublishField = target.closest?.("[data-prompt-publish-field]");
    if (promptPublishField instanceof global.HTMLInputElement || promptPublishField instanceof global.HTMLTextAreaElement) {
      return {
        element: promptPublishField,
        field: promptPublishField.dataset.promptPublishField || "",
        kind: "prompt-publish-field",
        promptId: promptPublishField.dataset.promptId || "",
      };
    }
    return null;
  }

  function applyTextInputBinding(binding, options = {}) {
    if (!binding?.element) {
      return false;
    }
    if (binding.kind === "search") {
      void callbacks.onSearch(binding.toolId || "", binding.element.value, {
        composing: Boolean(options.composing),
      });
      return true;
    }
    if (binding.kind === "prompt-field") {
      void callbacks.onPromptDraftChange(binding.field || "", binding.element.value);
      return true;
    }
    if (binding.kind === "prompt-publish-field" && binding.field === "title") {
      void callbacks.onPromptAction("set-publish-title", {
        promptId: binding.promptId || "",
        title: binding.element.value || "",
      });
      return true;
    }
    if (binding.kind === "prompt-publish-field" && binding.field === "category-label") {
      void callbacks.onPromptAction("set-publish-category-label", {
        categoryLabel: binding.element.value || "",
        promptId: binding.promptId || "",
      });
      return true;
    }
    return false;
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

  function getEventElementTarget(event) {
    const target = event?.target;
    if (target instanceof global.HTMLElement) {
      return target;
    }
    if (target?.parentElement instanceof global.HTMLElement) {
      return target.parentElement;
    }
    return null;
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value || "").trim();
  }

  function normalizePageAction(action) {
    const normalizedAction = normalizeText(action);
    if (normalizedAction === "log-trace") {
      return "trace.log";
    }
    if (normalizedAction === "copy-text") {
      return "clipboard.write-text";
    }
    if (normalizedAction === "get-conversation-state" || normalizedAction === "get-conversation-snapshot") {
      return "conversation.read-state";
    }
    if (normalizedAction === "jump-conversation-item") {
      return "conversation.jump-item";
    }
    if (normalizedAction === "get-composer-state") {
      return "composer.read-state";
    }
    if (normalizedAction === "apply-prompt-text") {
      return "composer.apply-text";
    }
    if (normalizedAction === "get-debug-state") {
      return "debug.read-state";
    }
    if (normalizedAction === "set-debug-enabled") {
      return "debug.set-enabled";
    }
    if (normalizedAction === "copy-debug-log") {
      return "debug.copy-log";
    }
    if (normalizedAction === "clear-debug-log") {
      return "debug.clear-log";
    }
    return normalizedAction;
  }

  function isPageTraceAction(action) {
    return normalizePageAction(action) === "trace.log";
  }

  function tracePanelFlow(step, payload = {}) {
    postTrace("panel", step, payload);
  }

  function traceMeetingFlow(step, payload = {}) {
    postTrace("meeting", step, payload);
  }

  function traceConversationFlow(step, payload = {}) {
    postTrace("conversation", step, payload);
  }

  function traceReviewFlow(step, payload = {}) {
    postTrace("review", step, payload);
  }

  function traceFunctionsFlow(step, payload = {}) {
    postTrace("functions", step, payload);
  }

  function traceFirestoreFlow(step, payload = {}) {
    postTrace("firestore", step, payload);
  }

  function traceReleaseFlow(step, payload = {}) {
    postTrace("release", step, payload);
  }

  function postTrace(channel, step, payload = {}) {
    const requestId = buildRequestId();
    state.traceRequestIds.add(requestId);
    postEnvelope({
      domain: "page",
      payload: {
        action: "trace.log",
        channel,
        payload: payload && typeof payload === "object" ? payload : {},
        step,
      },
      requestId,
      type: "request",
    });
  }

  function isTraceTransportEnvelope(envelope) {
    if (!envelope || typeof envelope !== "object") {
      return false;
    }
    if (state.traceRequestIds.has(normalizeText(envelope.requestId))) {
      return true;
    }
    return normalizeText(envelope.domain) === "page"
      && isPageTraceAction(envelope.payload?.action);
  }

  function readTraceAction(domain, payload = {}) {
    if (normalizeText(domain) === "page") {
      return normalizePageAction(payload?.action) || "page";
    }
    return normalizeText(
      payload?.action
      || payload?.meetingAction
      || payload?.promptAction
      || payload?.releaseAction
      || payload?.storeAction
      || payload?.toolId
      || domain
    );
  }

  function buildRequestTraceSpec(domain, payload = {}) {
    if (normalizeText(domain) !== "runtime") {
      return null;
    }
    const runtimeAction = normalizeText(payload?.action).toLowerCase();
    if (runtimeAction === "functions.fetch") {
      const functionLabel = buildFunctionsFetchLabel(payload);
      const authMode = normalizeText(payload?.authMode) || "access-token";
      return {
        buildResultPayload(durationMs) {
          return {
            message: functionLabel,
            reason: `${Math.max(0, Number(durationMs) || 0)}ms`,
            target: readRuntimeTargetForTrace(),
          };
        },
        buildStartPayload() {
          return {
            message: functionLabel,
            reason: `auth:${authMode}`,
            target: readRuntimeTargetForTrace(),
          };
        },
        buildTimeoutPayload(durationMs) {
          return {
            message: functionLabel,
            reason: `${Math.max(0, Number(durationMs) || 0)}ms`,
            target: readRuntimeTargetForTrace(),
          };
        },
        errorStep: "35.hosted.functions.fetch.error",
        startStep: "34.hosted.functions.fetch.start",
        successStep: "35.hosted.functions.fetch.success",
        trace: traceFunctionsFlow,
        timeoutStep: "35.hosted.functions.fetch.timeout",
      };
    }
    if (runtimeAction === "auth.issue-prompt-panel" || runtimeAction === "auth.issue-meeting-panel") {
      const scope = runtimeAction === "auth.issue-prompt-panel" ? "prompt-panel" : "meeting-panel";
      return {
        buildResultPayload(durationMs) {
          return {
            message: scope,
            reason: `${Math.max(0, Number(durationMs) || 0)}ms`,
            target: readRuntimeTargetForTrace(),
          };
        },
        buildStartPayload() {
          return {
            message: scope,
            target: readRuntimeTargetForTrace(),
          };
        },
        buildTimeoutPayload(durationMs) {
          return {
            message: scope,
            reason: `${Math.max(0, Number(durationMs) || 0)}ms`,
            target: readRuntimeTargetForTrace(),
          };
        },
        errorStep: "35.hosted.panel-auth.error",
        startStep: "34.hosted.panel-auth.start",
        successStep: "35.hosted.panel-auth.success",
        trace: traceFunctionsFlow,
        timeoutStep: "35.hosted.panel-auth.timeout",
      };
    }
    return null;
  }

  function buildFunctionsFetchLabel(payload = {}) {
    const service = normalizeText(payload?.service) || "service";
    const endpointKey = normalizeText(payload?.endpointKey) || "endpoint";
    return `${service}/${endpointKey}`;
  }

  function readRuntimeTargetForTrace() {
    return normalizeText(state.panelSnapshot?.settings?.meetingWorkspaceTarget).toLowerCase() === "local"
      ? "local"
      : "production";
  }

  function handleWindowError(event) {
    tracePanelFlow("90.hosted.window.error", {
      colno: Number(event?.colno) || 0,
      filename: normalizeText(event?.filename),
      lineno: Number(event?.lineno) || 0,
      message: normalizeText(event?.message),
    });
  }

  function handleDocumentVisibilityChange() {
    if (global.document.visibilityState === "visible") {
      void meetingHubController?.handleHostActivity?.("visibility-visible");
      return;
    }
    void meetingHubController?.handleHostActivity?.("visibility-hidden");
  }

  function handleUnhandledRejection(event) {
    tracePanelFlow("91.hosted.window.rejection", {
      reason: normalizeText(event?.reason instanceof Error ? event.reason.message : String(event?.reason || "")),
    });
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
