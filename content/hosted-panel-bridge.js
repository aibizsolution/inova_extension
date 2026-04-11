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
