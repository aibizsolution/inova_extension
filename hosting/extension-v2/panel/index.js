(function initHostedPanelApp(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const { cloneValue, normalizeText } = namespace.panelUtils;
  const BRIDGE_VERSION = 1;
  const APP_SOURCE = "inova-hosted-panel-app";
  const EXTENSION_SOURCE = "inova-hosted-panel-extension";
  const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
  const MAX_REQUEST_TIMEOUT_MS = 120000;
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
  const UI_PREFERENCES_WRITE_CAPABILITY_ID = "panel.ui-preferences.write";
  const HOSTED_PANEL_TOOLS = Object.freeze([
    { id: "bookmarks", label: "대화" },
    { id: "meeting", label: "회의 룸" },
    { id: "prompts", label: "프롬프트" },
    { id: "release", label: "릴리스" },
  ]);

  const root = document.getElementById("inova-hosted-panel-root");
  const state = {
    bridgeReady: false,
    capabilityCatalog: null,
    capabilityNegotiationError: "",
    capabilityNegotiationKey: "",
    capabilityNegotiationPending: false,
    conversationContextConfig: createEmptyConversationContextConfig(),
    elements: null,
    extensionCapabilities: [],
    extensionVersion: "",
    lastControllerSyncKey: "",
    lastPanelChromeSyncKey: "",
    panelAppUrl: "",
    panelOpen: false,
    panelOpenHydrated: false,
    panelSnapshot: null,
    parentOrigin: readParentOrigin(),
    pendingRequests: new Map(),
    readyPingCount: 0,
    renderCache: createPanelRenderCache(),
    renderDeferred: false,
    renderFrame: 0,
    requestSeq: 0,
    remoteCapabilityIds: [],
    startupStatusShown: false,
    startupStatusTimerId: 0,
    toast: null,
    toastSeq: 0,
    toastTimerId: 0,
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
  let remoteWorkflowHost = null;
  const browserCapabilities = namespace.extensionCapabilityClient?.create?.({
    invokePage,
    invokeRuntime,
    invokeWorkflow: (capability, input, options = {}) => {
      if (!remoteWorkflowHost) {
        throw new Error("remote workflow sandbox host is not ready");
      }
      return remoteWorkflowHost.runWorkflow({
        artifactId: capability?.artifactId,
        artifactVersion: capability?.artifactVersion,
        input,
        pilotEnabled: options?.pilotEnabled === true,
        workflowId: capability?.workflowId,
      });
    },
  }) || {};
  remoteWorkflowHost = namespace.remoteWorkflowHost?.create?.({
    browserCapabilities,
    document,
    trace: tracePanelFlow,
  }) || null;
  const featureUsageTracker = namespace.featureUsageTracker?.create?.({
    browserCapabilities,
    readProviderIdentity: () => state.panelSnapshot?.providerIdentity || null,
    readSource: () => ({
      extensionVersion: state.extensionVersion || "",
      surface: "hosted-panel",
    }),
  }) || null;
  featureUsageTracker?.start?.();
  const conversationController = namespace.conversationController?.create?.({
    browserCapabilities,
    featureUsageTracker,
    scheduleRender,
    traceConversation: traceConversationFlow,
  }) || null;
  let promptStoreController = null;
  const promptLibraryController = namespace.promptLibraryController?.create?.({
    browserCapabilities,
    getStoreCategories: () => promptStoreController?.getPublishCategories?.() || [],
    ensureStoreLoaded: (...args) => promptStoreController?.ensureLoaded?.(...args) || Promise.resolve(),
    featureUsageTracker,
    publishToast,
    scheduleRender,
    traceFirestore: traceFirestoreFlow,
    traceReview: traceReviewFlow,
  }) || null;
  const promptReviewController = namespace.promptReviewController?.create?.({
    browserCapabilities,
    getActivePromptTab: () => promptLibraryController?.getActiveTab?.() || "library",
    getProviderIdentity: () => promptLibraryController?.getProviderIdentity?.() || { available: false },
    getRuntimeVersion: () => state.extensionVersion || "",
    featureUsageTracker,
    publishToast,
    scheduleRender,
    traceReview: traceReviewFlow,
    setActivePromptTab: (promptTabId) => promptLibraryController?.handleSelectPromptTab?.(promptTabId) || Promise.resolve(false),
  }) || null;
  promptStoreController = namespace.promptStoreController?.create?.({
    browserCapabilities,
    getActivePromptTab: () => promptLibraryController?.getActiveTab?.() || "library",
    getProviderIdentity: () => promptLibraryController?.getProviderIdentity?.() || { available: false },
    featureUsageTracker,
    importStorePrompt: (storeEntry) => promptLibraryController?.importStorePrompt?.(storeEntry) || Promise.resolve(false),
    publishToast,
    scheduleRender,
    traceFirestore: traceFirestoreFlow,
  }) || null;
  const meetingHubController = namespace.meetingHubController?.create?.({
    browserCapabilities,
    featureUsageTracker,
    publishToast,
    scheduleRender,
    traceFirestore: traceFirestoreFlow,
    traceMeeting: traceMeetingFlow,
  }) || null;
  const releaseController = namespace.releaseController?.create?.({
    browserCapabilities,
    featureUsageTracker,
    getRuntimeVersion: () => state.extensionVersion || "",
    scheduleRender,
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
    void loadConversationContextConfig();
    scheduleStartupStatusCard();
    sendReady();
    scheduleReadyPing();
  }

  async function loadConversationContextConfig() {
    if (typeof global.fetch !== "function") {
      state.conversationContextConfig = {
        ...createEmptyConversationContextConfig(),
        error: "fetch-unavailable",
      };
      return;
    }
    const assetSuffix = global.__INOVA_HOSTED_PANEL_ASSET_SUFFIX__ || "";
    const configUrl = new URL(`./conversation-context-profiles.json${assetSuffix}`, global.location.href);
    try {
      const response = await global.fetch(configUrl, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response?.ok) {
        throw new Error(`context profile config fetch failed: ${response?.status || 0}`);
      }
      const payload = await response.json();
      state.conversationContextConfig = normalizeConversationContextConfig(payload);
      tracePanelFlow("20.hosted.conversation.context-config.loaded", {
        profileCount: state.conversationContextConfig.profiles.length,
        version: state.conversationContextConfig.version,
      });
    } catch (error) {
      state.conversationContextConfig = {
        ...createEmptyConversationContextConfig(),
        error: readErrorMessage(error, "context profile config failed"),
      };
      tracePanelFlow("20.hosted.conversation.context-config.error", {
        error: state.conversationContextConfig.error,
      });
    } finally {
      scheduleRender();
    }
  }

  function normalizeConversationContextConfig(payload = {}) {
    const config = payload && typeof payload === "object" ? payload : {};
    const defaultProfile = config.defaultProfile && typeof config.defaultProfile === "object"
      ? config.defaultProfile
      : {};
    return {
      defaultProfile: {
        availability: normalizeConversationContextAvailability(defaultProfile.availability, "fallback"),
        extendedLimit: readPositiveInteger(defaultProfile.extendedLimit),
        label: normalizeText(defaultProfile.label),
        limit: readPositiveInteger(defaultProfile.limit),
      },
      error: "",
      loaded: true,
      profiles: (Array.isArray(config.profiles) ? config.profiles : [])
        .map(normalizeConversationContextProfile)
        .filter(Boolean),
      signals: {
        growingRatio: readRatio(config.signals?.growingRatio, 0.25),
        heavyRatio: readRatio(config.signals?.heavyRatio, 0.75),
        longRatio: readRatio(config.signals?.longRatio, 0.5),
      },
      version: normalizeText(config.version),
    };
  }

  function normalizeConversationContextProfile(profile) {
    if (!profile || typeof profile !== "object") {
      return null;
    }
    const patterns = Array.isArray(profile.patterns)
      ? profile.patterns.map((pattern) => normalizeText(pattern)).filter(Boolean)
      : [];
    const limit = readPositiveInteger(profile.limit);
    if (!limit || !patterns.length) {
      return null;
    }
    return {
      availability: normalizeConversationContextAvailability(profile.availability, "standard"),
      extendedLimit: readPositiveInteger(profile.extendedLimit),
      id: normalizeText(profile.id),
      label: normalizeText(profile.label),
      limit,
      patterns,
      source: normalizeText(profile.source),
    };
  }

  function createEmptyConversationContextConfig() {
    return {
      defaultProfile: {
        availability: "fallback",
        extendedLimit: 0,
        label: "",
        limit: 0,
      },
      error: "",
      loaded: false,
      profiles: [],
      signals: {
        growingRatio: 0.25,
        heavyRatio: 0.75,
        longRatio: 0.5,
      },
      version: "",
    };
  }

  function readPositiveInteger(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      return 0;
    }
    return Math.floor(number);
  }

  function normalizeConversationContextAvailability(value, fallback) {
    const normalized = normalizeText(value).toLowerCase();
    return ["fallback", "optional", "standard"].includes(normalized)
      ? normalized
      : fallback;
  }

  function readRatio(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || number >= 1) {
      return fallback;
    }
    return number;
  }

  function createCallbacks() {
    return {
      async onCopyBookmark(bookmarkId) {
        const copied = conversationController?.handleCopyBookmark
          ? await conversationController.handleCopyBookmark(bookmarkId)
          : false;
        publishToast({
          contextId: normalizeText(bookmarkId),
          message: copied ? "질문을 복사했어요." : "질문을 복사하지 못했어요.",
          source: "conversation",
          tone: copied ? "success" : "error",
          ttlMs: copied ? 1800 : 3600,
        });
        return copied;
      },
      onEscape() {
        if (promptReviewController?.consumeEscape?.()) {
          return Promise.resolve(true);
        }
        return callbacks.onToggle(false);
      },
      onImportFile(file) {
        if (promptLibraryController?.handleImportFile) {
          return promptLibraryController.handleImportFile(file);
        }
        return Promise.resolve(false);
      },
      onJumpBookmark(bookmarkId) {
        return conversationController?.handleJumpBookmark
          ? conversationController.handleJumpBookmark(bookmarkId)
          : Promise.resolve(false);
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
        return Promise.resolve(false);
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
        return Promise.resolve(false);
      },
      onSelectPromptTab(promptTabId) {
        if (promptLibraryController?.handleSelectPromptTab) {
          return promptLibraryController.handleSelectPromptTab(promptTabId);
        }
        return Promise.resolve(false);
      },
      onSelectTool(toolId) {
        return persistHostedToolSelection(toolId);
      },
      onStoreAction(storeAction, detail = {}) {
        if (promptStoreController?.handleStoreAction) {
          return promptStoreController.handleStoreAction(storeAction, detail);
        }
        return Promise.resolve(false);
      },
      onToggle(open) {
        return setHostedPanelOpen(open);
      },
    };
  }

  function setHostedPanelOpen(nextOpen) {
    const open = typeof nextOpen === "boolean" ? nextOpen : !state.panelOpen;
    state.panelOpen = open;
    state.panelOpenHydrated = true;
    scheduleRender();
    void persistHostedPanelOpen(open);
    return Promise.resolve(true);
  }

  async function persistHostedPanelOpen(open) {
    try {
      await persistHostedUiPreferences({ panelOpen: open === true }, "panel-open");
    } catch (error) {
      tracePanelFlow("35.hosted.preferences.write.error", {
        context: "panel-open",
        error: readErrorMessage(error, "panel open save failed"),
      });
      console.error("[i-Nova Hosted Panel] panel open save failed", error);
    }
  }

  async function persistHostedToolSelection(toolId) {
    const nextTool = normalizeHostedToolId(toolId);
    const nextUiPreferences = nextTool === "prompts"
      ? {
        activePromptTab: "library",
        activeTool: "prompts",
      }
      : {
        activeTool: nextTool,
    };
    try {
      await persistHostedUiPreferences(nextUiPreferences, "active-tool");
      return true;
    } catch (error) {
      const message = readErrorMessage(error, "패널 선택 저장에 실패했어요.");
      tracePanelFlow("35.hosted.preferences.write.error", {
        context: "active-tool",
        error: message,
      });
      publishToast({
        contextId: "panel.ui-preferences.write",
        message,
        source: "panel",
        tone: "error",
        ttlMs: 3200,
      });
      console.error("[i-Nova Hosted Panel] active tool save failed", error);
      return false;
    }
  }

  async function persistHostedUiPreferences(partial, contextLabel = "ui-preferences") {
    if (!canInvokeNegotiatedCapability(UI_PREFERENCES_WRITE_CAPABILITY_ID)) {
      tracePanelFlow("35.hosted.preferences.write.blocked", {
        capabilityId: UI_PREFERENCES_WRITE_CAPABILITY_ID,
        context: contextLabel,
      });
      throw new Error("패널 설정 저장 기능이 현재 비활성화되어 있어요.");
    }
    return browserCapabilities.writeUiPreferences(partial);
  }

  function canInvokeNegotiatedCapability(capabilityId) {
    if (!state.capabilityCatalog) {
      return true;
    }
    return state.remoteCapabilityIds.includes(normalizeText(capabilityId));
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
    const nextPanelSnapshot = normalizePanelSnapshot(payload.panel);
    hydratePanelOpenState(nextPanelSnapshot);
    tracePanelFlow("17.hosted.snapshot.received", {
      activeTool: normalizeText(nextPanelSnapshot?.activeTool),
      extensionVersion: normalizeText(payload.extensionVersion),
      panelAppUrl: normalizeText(payload.panelAppUrl),
    });
    state.bridgeReady = true;
    state.extensionCapabilities = normalizeCapabilities(
      payload.extensionCapabilities?.length ? payload.extensionCapabilities : envelope.capabilities
    );
    state.extensionVersion = normalizeText(payload.extensionVersion);
    state.panelAppUrl = normalizeText(payload.panelAppUrl);
    state.panelSnapshot = nextPanelSnapshot;
    void negotiateCapabilityCatalog("snapshot");
    clearStartupStatusCard();
    tracePanelFlow("18.hosted.snapshot.applied", {
      activeTool: normalizeText(state.panelSnapshot?.activeTool),
      meetingCount: Number(state.panelSnapshot?.meetingTool?.count) || 0,
      toolTitle: buildHostedToolTitle(state.panelSnapshot?.activeTool),
    });
    scheduleRender();
  }

  async function negotiateCapabilityCatalog(reason = "manual") {
    if (!state.extensionCapabilities.includes("runtime.invoke.v1")) {
      return;
    }
    if (typeof browserCapabilities.readCapabilityCatalog !== "function") {
      return;
    }
    const negotiationKey = serializeRenderState({
      capabilities: state.extensionCapabilities,
      extensionVersion: state.extensionVersion,
      target: readRuntimeTargetForTrace(),
    });
    if (state.capabilityNegotiationPending || state.capabilityNegotiationKey === negotiationKey) {
      return;
    }
    state.capabilityNegotiationPending = true;
    try {
      const catalog = await browserCapabilities.readCapabilityCatalog({
        appCapabilities: APP_CAPABILITIES.slice(),
        reason,
      });
      const normalizedCatalog = normalizeCapabilityCatalog(catalog);
      state.capabilityCatalog = normalizedCatalog;
      state.capabilityNegotiationError = "";
      state.capabilityNegotiationKey = negotiationKey;
      state.remoteCapabilityIds = normalizeCapabilities(normalizedCatalog.enabledCapabilityIds);
      void bootRemoteWorkflowSandbox(normalizedCatalog);
      tracePanelFlow("18.hosted.capability.handshake.success", {
        capabilityCount: normalizedCatalog.capabilities.length,
        degraded: Boolean(normalizedCatalog.degraded),
        enabledCount: state.remoteCapabilityIds.length,
        source: normalizedCatalog.source,
      });
    } catch (error) {
      state.capabilityNegotiationError = readErrorMessage(error, "capability catalog negotiation failed");
      state.remoteCapabilityIds = [];
      tracePanelFlow("18.hosted.capability.handshake.error", {
        error: state.capabilityNegotiationError,
      });
    } finally {
      state.capabilityNegotiationPending = false;
      scheduleRender();
    }
  }

  async function bootRemoteWorkflowSandbox(catalog) {
    if (!remoteWorkflowHost || !catalog) {
      return;
    }
    if (!hasRemoteWorkflowArtifacts(catalog)) {
      remoteWorkflowHost.dispose?.();
      return;
    }
    try {
      const sandboxState = await remoteWorkflowHost.boot({
        bridgeApis: catalog.bridgeApis,
        workflowArtifacts: catalog.workflowArtifacts,
      });
      tracePanelFlow("18.hosted.remote.workflow.sandbox.ready", {
        bridgeApiCount: Array.isArray(sandboxState?.bridgeApis) ? sandboxState.bridgeApis.length : 0,
        workflowArtifactCount: Array.isArray(sandboxState?.workflowArtifactIds) ? sandboxState.workflowArtifactIds.length : 0,
      });
    } catch (error) {
      tracePanelFlow("18.hosted.remote.workflow.sandbox.error", {
        error: readErrorMessage(error, "remote workflow sandbox boot failed"),
      });
    }
  }

  function hasRemoteWorkflowArtifacts(catalog) {
    return Array.isArray(catalog?.workflowArtifacts) && catalog.workflowArtifacts.length > 0;
  }

  function hydratePanelOpenState(panelSnapshot) {
    if (!panelSnapshot || state.panelOpenHydrated) {
      return;
    }
    state.panelOpen = panelSnapshot.open === true;
    state.panelOpenHydrated = true;
  }

  function normalizePanelSnapshot(panel) {
    if (!panel || typeof panel !== "object") {
      return null;
    }
    const nextPanel = cloneValue(panel);
    const uiPreferences = normalizePanelUiPreferences(nextPanel.uiPreferences);
    return {
      ...nextPanel,
      activeTool: normalizeHostedToolId(nextPanel.activeTool || uiPreferences.activeTool),
      uiPreferences,
    };
  }

  function normalizePanelUiPreferences(uiPreferences) {
    const nextUiPreferences = uiPreferences && typeof uiPreferences === "object"
      ? { ...uiPreferences }
      : {};
    const rawActiveTool = normalizeText(nextUiPreferences.activeTool).toLowerCase();
    let activePromptTab = normalizeText(nextUiPreferences.activePromptTab).toLowerCase();
    if (rawActiveTool === "store") {
      activePromptTab = "store";
    }
    if (activePromptTab !== "store" && activePromptTab !== "review") {
      activePromptTab = "library";
    }
    return {
      ...nextUiPreferences,
      activePromptTab,
      activeTool: normalizeHostedToolId(rawActiveTool),
      panelOpen: nextUiPreferences.panelOpen === true,
    };
  }

  function handleEventEnvelope(envelope) {
    if (envelope.domain === "panel") {
      handlePanelEventEnvelope(envelope);
      return;
    }
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

  function handlePanelEventEnvelope(envelope) {
    const action = normalizeText(envelope.payload?.action);
    if (action === "external-toggle") {
      tracePanelFlow("23.hosted.panel.event.external-toggle", {
        open: !state.panelOpen,
      });
      void setHostedPanelOpen();
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
      const startedAtMs = Date.now();
      const timeoutMs = resolveRequestTimeoutMs(payload);
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
      }, timeoutMs);
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

  function resolveRequestTimeoutMs(payload = {}) {
    const requestedTimeoutMs = Number(payload?.requestTimeoutMs);
    if (!Number.isFinite(requestedTimeoutMs) || requestedTimeoutMs <= 0) {
      return DEFAULT_REQUEST_TIMEOUT_MS;
    }
    return Math.min(
      MAX_REQUEST_TIMEOUT_MS,
      Math.max(DEFAULT_REQUEST_TIMEOUT_MS, Math.round(requestedTimeoutMs))
    );
  }

  function syncPanelChromeIfNeeded(chromeState = {}) {
    const nextChromeState = {
      handleCount: Math.max(0, Number(chromeState.handleCount) || 0),
      open: chromeState.open === true,
      visible: chromeState.visible === true,
    };
    const nextChromeSyncKey = serializeRenderState(nextChromeState);
    if (state.lastPanelChromeSyncKey === nextChromeSyncKey) {
      return;
    }
    state.lastPanelChromeSyncKey = nextChromeSyncKey;
    request("panel", {
      action: "panel-chrome-sync",
      ...nextChromeState,
    }).catch((error) => {
      console.error("[i-Nova Hosted Panel] panel chrome sync failed", error);
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

  function normalizeCapabilityCatalog(value) {
    const catalog = value && typeof value === "object" ? value : {};
    const capabilities = Array.isArray(catalog.capabilities)
      ? catalog.capabilities
        .filter((capability) => capability && typeof capability === "object")
        .map((capability) => ({
          auditLevel: normalizeText(capability.auditLevel),
          artifactId: normalizeText(capability.artifactId),
          artifactVersion: normalizeText(capability.artifactVersion),
          authMode: normalizeText(capability.authMode),
          capabilityId: normalizeText(capability.capabilityId),
          deprecatedAt: normalizeText(capability.deprecatedAt),
          domain: normalizeText(capability.domain),
          enabled: capability.enabled === true,
          inputSchemaVersion: Number(capability.inputSchemaVersion) || 0,
          killSwitch: capability.killSwitch === true,
          kind: normalizeText(capability.kind),
          lane: normalizeText(capability.lane),
          minExtensionVersion: normalizeText(capability.minExtensionVersion),
          minExtensionVersionSupported: capability.minExtensionVersionSupported === true,
          outputSchemaVersion: Number(capability.outputSchemaVersion) || 0,
          owner: normalizeText(capability.owner),
          pageCapabilityId: normalizeText(capability.pageCapabilityId),
          pilot: capability.pilot === true,
          replacementId: normalizeText(capability.replacementId),
          schemaVersion: Number(capability.schemaVersion) || 0,
          testOnly: capability.testOnly === true,
          workflowId: normalizeText(capability.workflowId),
        }))
        .filter((capability) => Boolean(capability.capabilityId))
      : [];
    return {
      bridgeApis: normalizeCapabilities(catalog.bridgeApis),
      capabilityAliases: normalizeCapabilityAliases(catalog.capabilityAliases),
      capabilities,
      degraded: catalog.degraded === true,
      degradedReason: normalizeText(catalog.degradedReason),
      enabledCapabilityIds: normalizeCapabilities(catalog.enabledCapabilityIds),
      lane: normalizeText(catalog.lane),
      manifestUrl: normalizeText(catalog.manifestUrl),
      manifestVersion: normalizeText(catalog.manifestVersion),
      pageCapabilityIds: normalizeCapabilities(catalog.pageCapabilityIds),
      runtimeActions: normalizeCapabilities(catalog.runtimeActions),
      schemaVersion: Number(catalog.schemaVersion) || 0,
      source: normalizeText(catalog.source),
      workflowArtifacts: normalizeWorkflowArtifacts(catalog.workflowArtifacts),
    };
  }

  function normalizeCapabilityAliases(value) {
    return Array.isArray(value)
      ? value
        .filter((alias) => alias && typeof alias === "object")
        .map((alias) => ({
          aliasId: normalizeText(alias.aliasId),
          owner: normalizeText(alias.owner),
          removeAfter: normalizeText(alias.removeAfter),
          replacementId: normalizeText(alias.replacementId),
          replacementKind: normalizeText(alias.replacementKind),
        }))
        .filter((alias) => Boolean(alias.aliasId && alias.replacementId))
      : [];
  }

  function normalizeWorkflowArtifacts(value) {
    return Array.isArray(value)
      ? value
        .filter((artifact) => artifact && typeof artifact === "object")
        .map((artifact) => ({
          artifactId: normalizeText(artifact.artifactId),
          artifactVersion: normalizeText(artifact.artifactVersion),
          bundleId: normalizeText(artifact.bundleId),
          integrity: normalizeText(artifact.integrity),
          scriptSlot: normalizeText(artifact.scriptSlot),
        }))
        .filter((artifact) => Boolean(
          artifact.artifactId
            && artifact.artifactVersion
            && artifact.bundleId
            && artifact.integrity
            && artifact.scriptSlot
        ))
      : [];
  }

  function readErrorMessage(error, fallbackMessage) {
    return normalizeText(error instanceof Error ? error.message : error) || normalizeText(fallbackMessage);
  }

  function normalizeHostedToolId(toolId) {
    const normalizedToolId = normalizeText(toolId).toLowerCase();
    return normalizedToolId === "meeting" || normalizedToolId === "prompts" || normalizedToolId === "release"
      ? normalizedToolId
      : normalizedToolId === "store"
        ? "prompts"
        : "bookmarks";
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
    const panelState = buildEffectivePanelState(state.panelSnapshot);
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
    syncPanelChromeIfNeeded({
      handleCount: effectiveToolCount,
      open: panelState.open,
      visible: panelState.visible,
    });
    const focusedControl = captureFocusedControl(elements.app);
    const previousStoreScrollTop = panelState.activeTool === "prompts" && effectivePromptTool?.activeTab === "store"
      ? elements.app.querySelector(".inova-store-list")?.scrollTop || state.storeScrollTop || 0
      : 0;

    const nextToolRailHtml = renderToolRail(buildHostedToolItems(), panelState.activeTool);
    if (state.renderCache.toolRailHtml !== nextToolRailHtml) {
      elements.toolRail.innerHTML = nextToolRailHtml;
      state.renderCache.toolRailHtml = nextToolRailHtml;
    }

    const nextToolTitle = buildHostedToolTitle(panelState.activeTool);
    if (state.renderCache.toolTitle !== nextToolTitle) {
      elements.toolTitle.textContent = nextToolTitle;
      state.renderCache.toolTitle = nextToolTitle;
    }

    const shouldShowToolTotal = Number(effectiveToolCount) > 0;
    const nextToolTotal = shouldShowToolTotal ? String(effectiveToolCount) : "";
    const nextToolTotalKey = `${shouldShowToolTotal ? "visible" : "hidden"}:${nextToolTotal}`;
    if (state.renderCache.toolTotal !== nextToolTotalKey) {
      elements.toolTotal.textContent = nextToolTotal;
      elements.toolTotal.hidden = !shouldShowToolTotal;
      state.renderCache.toolTotal = nextToolTotalKey;
    }

    renderToastIfNeeded(elements.toolToast);
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

  function buildEffectivePanelState(panelSnapshot) {
    if (!panelSnapshot) {
      return null;
    }
    return {
      ...panelSnapshot,
      open: state.panelOpenHydrated ? state.panelOpen : panelSnapshot.open === true,
    };
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
      toolToast: root.querySelector("#inova-tool-toast-slot"),
      toolTitle: root.querySelector("#inova-tool-title"),
      toolTotal: root.querySelector("#inova-tool-total"),
    };
  }

  function syncHostedControllersIfNeeded(panelState) {
    const effectiveCapabilities = readEffectiveExtensionCapabilities();
    const nextControllerSyncKey = serializeRenderState({
      extensionCapabilities: effectiveCapabilities,
      panel: panelState,
    });
    if (state.lastControllerSyncKey === nextControllerSyncKey) {
      return;
    }
    state.lastControllerSyncKey = nextControllerSyncKey;
    conversationController?.syncPanelState?.(panelState, effectiveCapabilities);
    promptLibraryController?.syncPanelState?.(panelState, effectiveCapabilities);
    promptReviewController?.syncPanelState?.(panelState, effectiveCapabilities);
    promptStoreController?.syncPanelState?.(panelState, effectiveCapabilities);
    meetingHubController?.syncPanelState?.(panelState, effectiveCapabilities);
    releaseController?.syncPanelState?.(panelState, effectiveCapabilities);
  }

  function createPanelRenderCache() {
    return {
      toolToastKey: "",
      toolContentHtml: "",
      toolContentKey: "",
      toolRailHtml: "",
      toolTitle: "",
      toolTotal: "",
    };
  }

  function renderToastIfNeeded(toolToast) {
    if (!(toolToast instanceof global.HTMLElement)) {
      return;
    }
    const nextToastKey = state.toast ? serializeRenderState(state.toast) : "";
    if (state.renderCache.toolToastKey === nextToastKey) {
      return;
    }
    state.renderCache.toolToastKey = nextToastKey;
    if (!state.toast?.message) {
      toolToast.hidden = true;
      toolToast.innerHTML = "";
      return;
    }
    toolToast.hidden = false;
    toolToast.innerHTML = renderToastMarkup(state.toast);
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

  function renderToastMarkup(toast) {
    const tone = normalizeToastTone(toast?.tone);
    const role = normalizeText(toast?.role) || (tone === "error" ? "alert" : "status");
    const live = role === "alert" ? "assertive" : "polite";
    return `
      <div class="inova-tool-toast is-${escapeHtml(tone)}" role="${escapeHtml(role)}" aria-live="${escapeHtml(live)}" aria-atomic="true">
        <span class="inova-tool-toast__message">${escapeHtml(toast?.message)}</span>
      </div>
    `;
  }

  function renderToolRail(tools, activeTool) {
    return (Array.isArray(tools) ? tools : []).map((tool) => {
      return `
      <button type="button" class="inova-tool-rail__button ${tool.id === activeTool ? "is-active" : ""}" data-tool-id="${escapeHtml(tool.id)}" aria-pressed="${tool.id === activeTool}" aria-label="${escapeHtml(tool.label)}">
        <span class="inova-tool-rail__icon" aria-hidden="true">${renderToolRailIcon(tool.id)}</span>
        <span class="inova-tool-rail__label">${escapeHtml(tool.label)}</span>
      </button>
    `;
    }).join("");
  }

  function renderToolRailIcon(toolId) {
    const normalizedTool = normalizeText(toolId);
    // Lucide icon paths are inlined to keep the hosted panel CDN-free.
    if (normalizedTool === "meeting") {
      return `
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          <path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"></path>
        </svg>
      `;
    }
    if (normalizedTool === "prompts") {
      return `
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M2 6h4"></path>
          <path d="M2 10h4"></path>
          <path d="M2 14h4"></path>
          <path d="M2 18h4"></path>
          <rect width="16" height="20" x="4" y="2" rx="2"></rect>
          <path d="M9.5 8h5"></path>
          <path d="M9.5 12H16"></path>
          <path d="M9.5 16H14"></path>
        </svg>
      `;
    }
    if (normalizedTool === "release") {
      return `
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M12 15V3"></path>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <path d="m7 10 5 5 5-5"></path>
        </svg>
      `;
    }
    return `
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"></path>
        <path d="M7 11h10"></path>
        <path d="M7 15h6"></path>
        <path d="M7 7h8"></path>
      </svg>
    `;
  }

  function buildHostedToolItems() {
    return HOSTED_PANEL_TOOLS.map((tool) => ({ ...tool }));
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
    const contextProfileConfig = state.conversationContextConfig;
    if (conversationController?.hasRequiredCapabilities?.()) {
      return {
        ...conversationController.buildViewState(panelState.bookmarksTool || {}),
        contextProfileConfig,
      };
    }
    return {
      ...(panelState.bookmarksTool || {}),
      contextProfileConfig,
    };
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
    return panelState.meetingTool || {};
  }

  function buildEffectiveReleaseToolState(panelState) {
    if (releaseController?.hasRequiredCapabilities?.()) {
      return releaseController.buildViewState(panelState.releaseTool || {});
    }
    return panelState.releaseTool || {};
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
              <div id="inova-tool-toast-slot" hidden></div>
            </header>
            <div id="inova-tool-content"></div>
          </section>
        </div>
        <input id="inova-prompt-import-file" name="inova-prompt-import-file" type="file" accept="application/json,.json" hidden />
      </div>
    `;
  }

  function readMissingCapabilities() {
    const effectiveCapabilities = readEffectiveExtensionCapabilities();
    return REQUIRED_EXTENSION_CAPABILITIES.filter(
      (capability) => !effectiveCapabilities.includes(capability)
    );
  }

  function readEffectiveExtensionCapabilities() {
    return Array.from(new Set([
      ...state.extensionCapabilities,
      ...state.remoteCapabilityIds,
    ]));
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
    if (!getTextInputBinding(target)) {
      flushActiveTextInputComposition(host);
    }
    const promptMenu = target.closest?.("[data-prompt-menu]");
    const storeMenu = target.closest?.("[data-store-menu]");
    if (!promptMenu && !target.closest?.('[data-prompt-action="toggle-menu"]')) {
      void callbacks.onPromptAction("dismiss-menu");
      host.querySelectorAll("[data-prompt-menu][open]").forEach((menu) => {
        menu.removeAttribute("open");
      });
    } else if (promptMenu instanceof global.HTMLElement) {
      host.querySelectorAll("[data-prompt-menu][open]").forEach((menu) => {
        if (menu !== promptMenu) {
          menu.removeAttribute("open");
        }
      });
    }
    if (!storeMenu) {
      host.querySelectorAll("[data-store-menu][open]").forEach((menu) => {
        menu.removeAttribute("open");
      });
    } else if (storeMenu instanceof global.HTMLElement) {
      host.querySelectorAll("[data-store-menu][open]").forEach((menu) => {
        if (menu !== storeMenu) {
          menu.removeAttribute("open");
        }
      });
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
      void callbacks.onCopyBookmark(copyButton.dataset.copyBookmarkId || "").catch(() => {
        publishToast({
          contextId: normalizeText(copyButton.dataset.copyBookmarkId),
          message: "질문을 복사하지 못했어요.",
          source: "conversation",
          tone: "error",
          ttlMs: 3600,
        });
      });
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
      if (meetingAction.getAttribute?.("aria-disabled") === "true") {
        return;
      }
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

  function flushActiveTextInputComposition(host) {
    if (!state.inputComposition.active && !state.renderDeferred) {
      return false;
    }
    const activeElement = global.document?.activeElement;
    const activeBinding = getTextInputBinding(activeElement);
    const binding = activeBinding || getStoredCompositionBinding(host);
    const handled = binding ? applyTextInputBinding(binding, { composing: false }) : false;
    state.inputComposition = createInputCompositionState();
    if (state.renderDeferred) {
      state.renderDeferred = false;
      if (!state.renderFrame) {
        scheduleRender();
      }
    }
    return handled;
  }

  function getStoredCompositionBinding(host) {
    if (!(host instanceof global.HTMLElement)) {
      return null;
    }
    const composition = state.inputComposition || {};
    const kind = normalizeText(composition.kind);
    let selector = "";
    if (kind === "search" && composition.toolId) {
      selector = `[data-search-tool="${escapeSelector(composition.toolId)}"]`;
    } else if (kind === "prompt-field" && composition.field) {
      selector = `[data-prompt-field="${escapeSelector(composition.field)}"]`;
    } else if (kind === "prompt-publish-field" && composition.field && composition.promptId) {
      selector = `[data-prompt-publish-field="${escapeSelector(composition.field)}"][data-prompt-id="${escapeSelector(composition.promptId)}"]`;
    }
    return selector ? getTextInputBinding(host.querySelector(selector)) : null;
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
    const meetingCard = target.closest?.('[data-meeting-card="true"]');
    if (meetingCard instanceof global.HTMLElement) {
      const closestMeetingAction = target.closest?.("[data-meeting-action]");
      if (closestMeetingAction === meetingCard && meetingCard.getAttribute("aria-disabled") !== "true") {
        event.preventDefault();
        traceMeetingFlow("41.hosted.key.detected", {
          action: meetingCard.dataset.meetingAction || "",
          artifactId: meetingCard.dataset.meetingArtifactId || "",
          jobId: meetingCard.dataset.meetingJobId || "",
          meetingId: meetingCard.dataset.meetingId || "",
          reason: event.key === " " ? "space" : "enter",
        });
        void callbacks.onMeetingAction(meetingCard.dataset.meetingAction || "", {
          artifactId: meetingCard.dataset.meetingArtifactId || "",
          jobId: meetingCard.dataset.meetingJobId || "",
          meetingId: meetingCard.dataset.meetingId || "",
          title: meetingCard.dataset.meetingTitle || "",
        });
      }
      return;
    }
    const promptCard = target.closest?.('[data-prompt-card="true"]');
    if (promptCard instanceof global.HTMLElement) {
      const interactivePromptChild = target.closest?.('button, input, textarea, select, label, summary, details, [data-prompt-menu], [data-prompt-action], [data-prompt-field], [data-prompt-publish-field], [data-prompt-select], [data-import-mode]');
      const blockedPromptRegion = target.closest?.(".inova-inline-feedback, .inova-prompt-editor, .inova-import-review");
      if ((!interactivePromptChild || interactivePromptChild === promptCard) && !(blockedPromptRegion instanceof global.HTMLElement)) {
        event.preventDefault();
        tracePanelFlow("41.hosted.key.detected", {
          action: "use",
          message: promptCard.dataset.promptId || "",
          reason: event.key === " " ? "space" : "enter",
        });
        void callbacks.onPromptAction("use", {
          promptId: promptCard.dataset.promptId || "",
        });
      }
      return;
    }
    const storeCard = target.closest?.('[data-store-card="true"]');
    if (storeCard instanceof global.HTMLElement) {
      const interactiveStoreChild = target.closest?.('button, input, textarea, select, label, summary, details, [data-store-menu], [data-store-action], [data-store-field], [data-store-owner-info]');
      const blockedStoreRegion = target.closest?.(".inova-inline-feedback");
      if ((!interactiveStoreChild || interactiveStoreChild === storeCard) && !(blockedStoreRegion instanceof global.HTMLElement)) {
        event.preventDefault();
        tracePanelFlow("41.hosted.key.detected", {
          action: "toggle-expand",
          message: storeCard.dataset.storeEntryId || "",
          reason: event.key === " " ? "space" : "enter",
        });
        void callbacks.onStoreAction("toggle-expand", {
          entryId: storeCard.dataset.storeEntryId || "",
        });
      }
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

  function getEventElementTarget(event) {
    const target = event?.target;
    if (target instanceof global.HTMLElement) {
      return target;
    }
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    const pathElement = path.find((entry) => entry instanceof global.HTMLElement);
    if (pathElement) {
      return pathElement;
    }
    if (target?.parentElement instanceof global.HTMLElement) {
      return target.parentElement;
    }
    return null;
  }

  function publishToast(payload = {}) {
    const nextToast = normalizeToastPayload(payload);
    clearToastTimer();
    state.toast = nextToast;
    scheduleRender();
    if (!nextToast || nextToast.ttlMs <= 0) {
      return Boolean(nextToast);
    }
    const toastId = nextToast.id;
    state.toastTimerId = global.setTimeout(() => {
      dismissToast(toastId);
    }, nextToast.ttlMs);
    return true;
  }

  function dismissToast(toastId = "") {
    if (!state.toast) {
      return false;
    }
    if (toastId && toastId !== state.toast.id) {
      return false;
    }
    clearToastTimer();
    state.toast = null;
    scheduleRender();
    return true;
  }

  function clearToastTimer() {
    if (!state.toastTimerId) {
      return;
    }
    global.clearTimeout(state.toastTimerId);
    state.toastTimerId = 0;
  }

  function normalizeToastPayload(payload = {}) {
    const message = normalizeText(payload?.message);
    if (!message) {
      return null;
    }
    state.toastSeq += 1;
    const tone = normalizeToastTone(payload?.tone);
    const ttlMs = Math.max(0, Number(payload?.ttlMs) || 0);
    return {
      contextId: normalizeText(payload?.contextId),
      id: normalizeText(payload?.id) || `toast-${Date.now()}-${state.toastSeq}`,
      message,
      role: normalizeText(payload?.role) || (tone === "error" ? "alert" : "status"),
      source: normalizeText(payload?.source),
      tone,
      ttlMs,
    };
  }

  function normalizeToastTone(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === "success" || normalized === "error") {
      return normalized;
    }
    return "info";
  }

  function isPageTraceAction(action) {
    return normalizeText(action) === "trace.log";
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
      return normalizeText(payload?.action) || "page";
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
    if (runtimeAction === "functions.invoke-endpoint" || runtimeAction === "capabilities.invoke") {
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
        errorStep: "35.hosted.functions.invoke.error",
        startStep: "34.hosted.functions.invoke.start",
        successStep: "35.hosted.functions.invoke.success",
        trace: traceFunctionsFlow,
        timeoutStep: "35.hosted.functions.invoke.timeout",
      };
    }
    if (runtimeAction === "auth.issue-panel-session") {
      const panel = normalizeText(payload?.panel).toLowerCase();
      const purpose = normalizeText(payload?.purpose);
      const scope = panel === "hosted" ? "hosted-panel" : panel === "prompt" ? "prompt-panel" : panel === "meeting" ? "meeting-panel" : "panel-session";
      return {
        buildResultPayload(durationMs) {
          return {
            message: scope,
            purpose,
            reason: `${Math.max(0, Number(durationMs) || 0)}ms`,
            target: readRuntimeTargetForTrace(),
          };
        },
        buildStartPayload() {
          return {
            message: scope,
            purpose,
            target: readRuntimeTargetForTrace(),
          };
        },
        buildTimeoutPayload(durationMs) {
          return {
            message: scope,
            purpose,
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
    const capabilityId = normalizeText(payload?.capabilityId);
    if (capabilityId) {
      return capabilityId;
    }
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
