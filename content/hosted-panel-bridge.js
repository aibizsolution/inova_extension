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
      : namespace.session.normalizeText;
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
      const handledPageRequest = await namespace.panelPageCapabilityRouter?.handle?.(request?.payload, {
        logConsoleTrace,
      }) || {
        handled: false,
        result: null,
      };
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
      : namespace.session.normalizeText;

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

  async function handlePanelRequest(payload, callbacks, helpers = {}) {
    const normalizeText = typeof helpers.normalizeText === "function"
      ? helpers.normalizeText
      : namespace.session.normalizeText;
    const action = normalizeText(payload?.action);
    return handleShellRequest(action, payload, callbacks);
  }

  function handleShellRequest(action, payload, callbacks) {
    if (action === "panel-chrome-sync") {
      const chromeState = {
        handleCount: Math.max(0, Number(payload?.handleCount) || 0),
      };
      if (Object.hasOwn(payload || {}, "open")) {
        chromeState.open = payload.open === true;
      }
      if (Object.hasOwn(payload || {}, "visible")) {
        chromeState.visible = payload.visible === true;
      }
      callbacks.onPanelChromeSync?.(chromeState);
      return Promise.resolve({
        handled: true,
        result: { handled: true },
      });
    }

    return Promise.resolve({
      handled: false,
      result: null,
    });
  }

  namespace.panelHostedBridgeRequest = { handle };
})(globalThis);
