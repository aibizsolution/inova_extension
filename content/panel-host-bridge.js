(function initPanelHostBridge(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});

  function create(deps = {}) {
    const hostRuntime = deps.hostRuntime || {
      handleBridgeReadyChange() {},
      updateStatusBanner() {},
    };
    const logConsoleTrace = typeof deps.logConsoleTrace === "function"
      ? deps.logConsoleTrace
      : () => {};
    const normalizeText = typeof deps.normalizeText === "function"
      ? deps.normalizeText
      : (value) => String(value || "").trim();

    return {
      createHostedBridge,
      emitPanelEvent,
      emitPageEvent,
    };

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
              callbacks: host?.__callbacks || {},
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

    function emitPageEvent(host, action, payload = {}) {
      return emitHostedEvent(host, "page", action, payload);
    }

    function emitPanelEvent(host, action, payload = {}) {
      return emitHostedEvent(host, "panel", action, payload);
    }

    function emitHostedEvent(host, domain, action, payload = {}) {
      const normalizedAction = normalizeText(action);
      if (!host?.__bridge || !normalizedAction) {
        return false;
      }
      return Boolean(host.__bridge.emitEvent?.(domain, {
        ...payload,
        action: normalizedAction,
      }));
    }

    function isTraceTransportRequest(request) {
      return normalizeText(request?.domain) === "page"
        && isPageTraceAction(request?.payload?.action);
    }

    function isPageTraceAction(action) {
      const normalizedAction = normalizeText(action);
      return normalizedAction === "trace.log";
    }
  }

  namespace.panelHostBridge = { create };
})(globalThis);
