(function initHostedPanelBridge(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const BRIDGE_VERSION = 1;
  const APP_SOURCE = "inova-hosted-panel-app";
  const EXTENSION_SOURCE = "inova-hosted-panel-extension";
  const EXTENSION_CAPABILITIES = Object.freeze([
    "panel.snapshot.v1",
    "panel.request.v1",
    "panel.response.v1",
    "panel.event.v1",
    "runtime.invoke.v1",
    "page.adapter.v1",
    "page.adapter.v2",
  ]);

  function create(options = {}) {
    const onError = typeof options.onError === "function" ? options.onError : () => {};
    const onReadyChange = typeof options.onReadyChange === "function" ? options.onReadyChange : () => {};
    const onRequest = typeof options.onRequest === "function"
      ? options.onRequest
      : async () => ({ handled: false });

    let allowedOrigin = "";
    let attached = false;
    let ready = false;
    let targetWindow = null;
    let appCapabilities = [];

    return {
      attach,
      emitEvent,
      getCapabilities,
      getState,
      reset,
      setAllowedOrigin,
      updateSnapshot,
    };

    function attach() {
      if (attached) {
        return;
      }
      attached = true;
      global.addEventListener("message", handleWindowMessage);
    }

    function emitEvent(domain, payload = {}, messageOptions = {}) {
      return postEnvelope({
        domain,
        payload,
        requestId: messageOptions.requestId,
        type: "event",
      });
    }

    function getCapabilities() {
      return EXTENSION_CAPABILITIES.slice();
    }

    function getState() {
      return {
        allowedOrigin,
        appCapabilities: appCapabilities.slice(),
        ready,
      };
    }

    function reset(reason = "") {
      const wasReady = ready;
      ready = false;
      targetWindow = null;
      appCapabilities = [];
      if (wasReady) {
        onReadyChange({
          appCapabilities: [],
          ready: false,
          reason: namespace.session.normalizeText(reason),
        });
      }
    }

    function setAllowedOrigin(nextOrigin) {
      allowedOrigin = normalizeOrigin(nextOrigin);
      if (!allowedOrigin) {
        reset("missing-origin");
      }
    }

    function updateSnapshot(payload = {}) {
      return postEnvelope({
        domain: "panel",
        payload,
        type: "snapshot",
      });
    }

    async function handleWindowMessage(event) {
      if (!isAllowedOrigin(event.origin) || !isTargetSource(event.source)) {
        return;
      }
      const envelope = normalizeEnvelope(event.data);
      if (!envelope || envelope.source !== APP_SOURCE) {
        return;
      }

      targetWindow = event.source;
      if (envelope.type === "ready") {
        ready = true;
        appCapabilities = Array.isArray(envelope.capabilities)
          ? envelope.capabilities.map((value) => namespace.session.normalizeText(value)).filter(Boolean)
          : [];
        onReadyChange({
          appCapabilities: appCapabilities.slice(),
          ready: true,
          requestId: envelope.requestId,
        });
        return;
      }

      if (envelope.type !== "request") {
        return;
      }

      try {
        const result = await onRequest({
          appCapabilities: appCapabilities.slice(),
          domain: envelope.domain,
          payload: envelope.payload,
          requestId: envelope.requestId,
          type: envelope.type,
        });
        postEnvelope({
          domain: envelope.domain,
          payload: {
            handled: result?.handled !== false,
            result: result?.result,
          },
          requestId: envelope.requestId,
          type: "response",
        });
      } catch (error) {
        onError({
          error: error instanceof Error ? error : new Error(String(error || "Hosted panel request failed.")),
          requestId: envelope.requestId,
          stage: "request",
        });
        postEnvelope({
          domain: envelope.domain,
          payload: {
            error: error instanceof Error ? error.message : String(error || "Hosted panel request failed."),
          },
          requestId: envelope.requestId,
          type: "error",
        });
      }
    }

    function isAllowedOrigin(origin) {
      if (!allowedOrigin) {
        return false;
      }
      return namespace.session.normalizeText(origin) === allowedOrigin;
    }

    function isTargetSource(source) {
      return Boolean(source && typeof source.postMessage === "function");
    }

    function normalizeEnvelope(value) {
      const data = value && typeof value === "object" ? value : null;
      if (!data || Number(data.bridgeVersion) !== BRIDGE_VERSION) {
        return null;
      }
      return {
        bridgeVersion: BRIDGE_VERSION,
        capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
        domain: namespace.session.normalizeText(data.domain),
        payload: data.payload && typeof data.payload === "object" ? data.payload : {},
        requestId: namespace.session.normalizeText(data.requestId),
        source: namespace.session.normalizeText(data.source),
        type: namespace.session.normalizeText(data.type),
      };
    }

    function normalizeOrigin(value) {
      const normalized = namespace.session.normalizeText(value);
      if (!normalized) {
        return "";
      }
      try {
        return new URL(normalized).origin;
      } catch (error) {
        onError({
          error: error instanceof Error ? error : new Error(String(error || "Hosted panel origin parse failed.")),
          stage: "origin",
        });
        return "";
      }
    }

    function postEnvelope(message = {}) {
      if (!ready || !targetWindow || !allowedOrigin) {
        return false;
      }
      targetWindow.postMessage(
        {
          bridgeVersion: BRIDGE_VERSION,
          capabilities: EXTENSION_CAPABILITIES.slice(),
          domain: namespace.session.normalizeText(message.domain),
          payload: message.payload,
          requestId: namespace.session.normalizeText(message.requestId),
          source: EXTENSION_SOURCE,
          type: namespace.session.normalizeText(message.type),
        },
        allowedOrigin
      );
      return true;
    }
  }

  namespace.hostedPanelBridge = {
    BRIDGE_VERSION,
    SOURCE_APP: APP_SOURCE,
    SOURCE_EXTENSION: EXTENSION_SOURCE,
    create,
    EXTENSION_CAPABILITIES,
  };
})(globalThis);

(function initPanelHostedBridgeRequest(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  async function handle(request, helpers = {}) {
    const normalizeText = typeof helpers.normalizeText === "function"
      ? helpers.normalizeText
      : (value) => namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
    const callbacks = helpers.callbacks && typeof helpers.callbacks === "object"
      ? helpers.callbacks
      : {};
    const logConsoleTrace = typeof helpers.logConsoleTrace === "function"
      ? helpers.logConsoleTrace
      : () => {};
    const domain = normalizeText(request?.domain);

    if (domain === "runtime") {
      const handledRuntimeRequest = await handleRuntimeRequest(request?.payload, {
        normalizeText,
      });
      if (handledRuntimeRequest?.handled) {
        return {
          handled: true,
          result: handledRuntimeRequest.result,
        };
      }
      throw new Error("지원하지 않는 runtime broker 요청이에요.");
    }

    if (domain === "page") {
      const handledPageRequest = await handlePageRequest(request?.payload, {
        logConsoleTrace,
      });
      if (handledPageRequest?.handled) {
        return {
          handled: true,
          result: handledPageRequest.result,
        };
      }
      throw new Error("지원하지 않는 page adapter 요청이에요.");
    }

    if (domain === "panel") {
      const handledPanelRequest = await handlePanelRequest(request?.payload, callbacks, {
        logConsoleTrace,
        normalizeText,
      });
      if (handledPanelRequest?.handled) {
        return {
          handled: true,
          result: handledPanelRequest.result,
        };
      }

      throw new Error("지원하지 않는 hosted panel action이에요.");
    }

    return {
      handled: false,
      result: null,
    };
  }

  async function handleRuntimeRequest(payload, helpers = {}) {
    const normalizeText = typeof helpers.normalizeText === "function"
      ? helpers.normalizeText
      : (value) => namespace.session?.normalizeText?.(value) || String(value ?? "").trim();

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
    return {
      handled: true,
      result: response.data,
    };
  }

  function handlePageRequest(payload, helpers = {}) {
    const action = normalizePageAction(payload?.action);
    const buildConversationSnapshot = typeof helpers.buildConversationSnapshot === "function"
      ? helpers.buildConversationSnapshot
      : defaultBuildConversationSnapshot;
    const buildDebugState = typeof helpers.buildDebugState === "function"
      ? helpers.buildDebugState
      : defaultBuildDebugState;
    const copyDebugLog = typeof helpers.copyDebugLog === "function"
      ? helpers.copyDebugLog
      : defaultCopyDebugLog;
    const logConsoleTrace = typeof helpers.logConsoleTrace === "function"
      ? helpers.logConsoleTrace
      : () => {};

    if (action === "clipboard.write-text") {
      const text = String(payload?.text || "");
      if (!text) {
        return Promise.resolve({
          handled: true,
          result: { copied: false },
        });
      }
      return global.navigator.clipboard.writeText(text).then(() => ({
        handled: true,
        result: { copied: true },
      }));
    }

    if (action === "debug.copy-log") {
      return Promise.resolve(copyDebugLog(Boolean(payload?.errorsOnly))).then((result) => ({
        handled: true,
        result,
      }));
    }

    if (action === "debug.clear-log") {
      namespace.panelDebug?.clearEntries?.();
      return Promise.resolve({
        handled: true,
        result: buildDebugState(),
      });
    }

    if (action === "trace.log") {
      logConsoleTrace(
        normalizeText(payload?.channel) || "trace",
        normalizeText(payload?.step) || "trace",
        payload?.payload && typeof payload.payload === "object" ? payload.payload : {}
      );
      return Promise.resolve({
        handled: true,
        result: { logged: true },
      });
    }

    if (action === "composer.read-state") {
      return Promise.resolve({
        handled: true,
        result: namespace.composer?.getComposerState?.() || { available: false, text: "" },
      });
    }

    if (action === "composer.apply-text") {
      return Promise.resolve({
        handled: true,
        result: {
          applied: Boolean(namespace.composer?.applyPromptText?.(String(payload?.text || ""), normalizeText(payload?.mode) || "replace")),
        },
      });
    }

    if (action === "conversation.read-state") {
      return Promise.resolve({
        handled: true,
        result: buildConversationSnapshot(),
      });
    }

    if (action === "conversation.jump-item") {
      const bookmarkId = normalizeText(payload?.bookmarkId || payload?.itemId);
      if (!bookmarkId) {
        return Promise.resolve({
          handled: true,
          result: { jumped: false },
        });
      }
      namespace.contentPanel.setActiveBookmark(bookmarkId);
      namespace.contentPanel.focusBookmark(bookmarkId);
      return Promise.resolve({
        handled: true,
        result: {
          jumped: Boolean(namespace.contentDom?.scrollToMessage?.(bookmarkId, {
            behavior: "smooth",
            block: "start",
          })),
        },
      });
    }

    if (action === "debug.read-state") {
      return Promise.resolve({
        handled: true,
        result: buildDebugState(),
      });
    }

    if (action === "debug.set-enabled") {
      namespace.panelDebug?.setEnabled?.(Boolean(payload?.enabled));
      return Promise.resolve({
        handled: true,
        result: buildDebugState(),
      });
    }

    return Promise.resolve({
      handled: false,
      result: null,
    });
  }

  async function handlePanelRequest(payload, callbacks, helpers = {}) {
    const normalizeText = typeof helpers.normalizeText === "function"
      ? helpers.normalizeText
      : (value) => namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
    const action = normalizeText(payload?.action);
    const handledSummaryRequest = await handlePanelSummaryRequest(action, payload, callbacks, {
      normalizeText,
    });
    if (handledSummaryRequest?.handled) {
      return handledSummaryRequest;
    }

    const handledConversationRequest = await handleConversationRequest(action, payload, callbacks, {
      normalizeText,
    });
    if (handledConversationRequest?.handled) {
      return handledConversationRequest;
    }

    return handleShellRequest(action, payload, callbacks, {
      normalizeText,
    });
  }

  function handlePanelSummaryRequest(action, payload, callbacks, helpers = {}) {
    const normalizeText = typeof helpers.normalizeText === "function"
      ? helpers.normalizeText
      : (value) => namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
    if (action === "tool-summary-sync") {
      if (typeof callbacks.onToolSummarySync !== "function") {
        return Promise.resolve({
          handled: false,
          result: null,
        });
      }
      const toolId = normalizeText(payload?.toolId);
      const toolState = payload?.toolState && typeof payload.toolState === "object"
        ? payload.toolState
        : {};
      return Promise.resolve(callbacks.onToolSummarySync?.(toolId, toolState)).then(() => ({
        handled: true,
        result: { handled: true },
      }));
    }

    return Promise.resolve({
      handled: false,
      result: null,
    });
  }

  function handleConversationRequest(action, payload, callbacks, helpers = {}) {
    const normalizeText = typeof helpers.normalizeText === "function"
      ? helpers.normalizeText
      : (value) => namespace.session?.normalizeText?.(value) || String(value ?? "").trim();

    if (action === "bookmark-copy") {
      return Promise.resolve(callbacks.onCopyBookmark?.(normalizeText(payload?.bookmarkId))).then((copied) => ({
        handled: true,
        result: { copied: Boolean(copied) },
      }));
    }

    if (action === "bookmark-jump") {
      callbacks.onJumpBookmark?.(normalizeText(payload?.bookmarkId));
      return Promise.resolve({
        handled: true,
        result: { jumped: true },
      });
    }

    return Promise.resolve({
      handled: false,
      result: null,
    });
  }

  function handleShellRequest(action, payload, callbacks, helpers = {}) {
    const normalizeText = typeof helpers.normalizeText === "function"
      ? helpers.normalizeText
      : (value) => namespace.session?.normalizeText?.(value) || String(value ?? "").trim();

    if (action === "toggle-panel") {
      callbacks.onToggle?.(payload?.open);
      return Promise.resolve({
        handled: true,
        result: { open: payload?.open !== false },
      });
    }

    if (action === "escape") {
      const consumed = Boolean(callbacks.onEscape?.());
      if (!consumed) {
        callbacks.onToggle?.(false);
      }
      return Promise.resolve({
        handled: true,
        result: { consumed },
      });
    }

    if (action === "select-tool") {
      return Promise.resolve(callbacks.onSelectTool?.(normalizeText(payload?.toolId))).then((selected) => ({
        handled: true,
        result: { selected: Boolean(selected) },
      }));
    }

    if (action === "search") {
      callbacks.onSearch?.(normalizeText(payload?.toolId), String(payload?.value || ""), payload?.options || {});
      return Promise.resolve({
        handled: true,
        result: { searched: true },
      });
    }

    if (action === "search-submit") {
      callbacks.onSearchSubmit?.(normalizeText(payload?.toolId), String(payload?.value || ""));
      return Promise.resolve({
        handled: true,
        result: { submitted: true },
      });
    }

    return Promise.resolve({
      handled: false,
      result: null,
    });
  }

  async function defaultCopyDebugLog(errorsOnly) {
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

  function defaultBuildConversationSnapshot() {
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

  function defaultBuildDebugState() {
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

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function normalizePageAction(value) {
    const action = normalizeText(value);
    if (action === "copy-text") {
      return "clipboard.write-text";
    }
    if (action === "copy-debug-log") {
      return "debug.copy-log";
    }
    if (action === "clear-debug-log") {
      return "debug.clear-log";
    }
    if (action === "log-trace") {
      return "trace.log";
    }
    if (action === "get-composer-state") {
      return "composer.read-state";
    }
    if (action === "apply-prompt-text") {
      return "composer.apply-text";
    }
    if (action === "get-conversation-state" || action === "get-conversation-snapshot") {
      return "conversation.read-state";
    }
    if (action === "jump-conversation-item") {
      return "conversation.jump-item";
    }
    if (action === "get-debug-state") {
      return "debug.read-state";
    }
    if (action === "set-debug-enabled") {
      return "debug.set-enabled";
    }
    return action;
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
  }

  namespace.panelHostedBridgeRequest = { handle };
})(globalThis);
