(function initMeetingPanelBridgeController(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const BRIDGE_IFRAME_ID = "inova-meeting-panel-bridge";
  const BRIDGE_IFRAME_READY_TIMEOUT_MS = 10000;
  const BRIDGE_MESSAGE_SOURCE = "inova-meeting-panel-client";

  function create(hooks = {}) {
    let bridgeFrame = null;
    let bridgePort = null;
    let bridgePortPromise = null;
    let bridgeReadyReject = null;
    let bridgeReadyResolve = null;
    let bridgeConnectionKey = "";
    let bridgeConnected = false;
    let bridgeConnecting = false;
    let bridgeAttached = false;

    return {
      beginConnection,
      disconnect,
      ensurePort,
      hasActiveConnection,
    };

    function beginConnection({ connectionKey, providerUserKey, reason, requestId }) {
      bridgeConnectionKey = connectionKey;
      bridgeAttached = true;
      bridgeConnecting = true;
      bridgeConnected = false;
      hooks.log?.("panel.bridge.request", {
        providerUserKey,
        reason,
        requestId,
      });
    }

    function disconnect(reason) {
      if (!bridgeAttached && !bridgeConnected && !bridgeConnecting && !bridgeConnectionKey) {
        return;
      }
      if (bridgePort && (bridgeAttached || bridgeConnected || bridgeConnecting || bridgeConnectionKey)) {
        try {
          bridgePort.postMessage({ type: "disconnect" });
        } catch (error) {
          hooks.log?.("panel.bridge.disconnect.error", {
            error: error instanceof Error ? error.message : String(error || ""),
            reason,
          });
        }
      }
      resetBridgeState({ clearConnectionKey: true });
      hooks.log?.("panel.bridge.detach", {
        reason,
      });
    }

    async function ensurePort(runtimeConfig) {
      const expectedSrc = resolveBridgeSrc(runtimeConfig);
      if (
        bridgePort
        && bridgeFrame instanceof global.HTMLIFrameElement
        && bridgeFrame.src === expectedSrc
      ) {
        return bridgePort;
      }
      if (
        bridgePortPromise
        && bridgeFrame instanceof global.HTMLIFrameElement
        && bridgeFrame.src === expectedSrc
      ) {
        return bridgePortPromise;
      }
      if (bridgeFrame instanceof global.HTMLIFrameElement && bridgeFrame.src !== expectedSrc) {
        closeBridgePort("runtime-change");
        resetBridgeState({ clearConnectionKey: true });
        bridgeFrame.remove();
        bridgeFrame = null;
      }

      bridgeFrame = ensureBridgeFrame(runtimeConfig);
      bridgePortPromise = new Promise((resolve, reject) => {
        const timeoutId = global.setTimeout(() => {
          bridgeReadyResolve = null;
          bridgeReadyReject = null;
          bridgePortPromise = null;
          reject(new Error("패널 Firestore bridge 준비가 지연되고 있어요."));
        }, BRIDGE_IFRAME_READY_TIMEOUT_MS);

        bridgeReadyResolve = () => {
          global.clearTimeout(timeoutId);
          bridgeReadyResolve = null;
          bridgeReadyReject = null;
          bridgePortPromise = null;
          resolve(bridgePort);
        };
        bridgeReadyReject = (error) => {
          global.clearTimeout(timeoutId);
          bridgeReadyResolve = null;
          bridgeReadyReject = null;
          bridgePortPromise = null;
          reject(error instanceof Error ? error : new Error(String(error || "패널 Firestore bridge를 준비하지 못했어요.")));
        };

        const connectPort = () => {
          if (!bridgeFrame?.contentWindow) {
            bridgeReadyReject?.(new Error("패널 Firestore bridge 창을 찾지 못했어요."));
            return;
          }
          const channel = new MessageChannel();
          bridgePort = channel.port1;
          bridgePort.onmessage = handleBridgeMessage;
          bridgePort.onmessageerror = () => {
            hooks.log?.("panel.bridge.error", {
              error: "패널 Firestore bridge 채널이 끊겼어요.",
            });
            resetBridgeState({ clearConnectionKey: true });
            bridgePort = null;
            bridgePortPromise = null;
          };
          bridgePort.start?.();
          bridgeFrame.contentWindow.postMessage(
            {
              source: BRIDGE_MESSAGE_SOURCE,
              type: "connect-port",
            },
            resolveBridgeOrigin(runtimeConfig),
            [channel.port2]
          );
        };

        if (bridgeFrame.dataset.loaded === "1") {
          connectPort();
          return;
        }

        const handleLoad = () => {
          bridgeFrame.removeEventListener("load", handleLoad);
          bridgeFrame.dataset.loaded = "1";
          connectPort();
        };
        bridgeFrame.addEventListener("load", handleLoad, { once: true });
      });

      return bridgePortPromise;
    }

    function hasActiveConnection(connectionKey) {
      return Boolean(
        bridgePort
        && connectionKey
        && bridgeConnectionKey === connectionKey
        && (bridgeAttached || bridgeConnected || bridgeConnecting)
      );
    }

    function closeBridgePort(context) {
      try {
        bridgePort?.close?.();
      } catch (error) {
        hooks.log?.("panel.bridge.close.error", {
          context,
          error: error instanceof Error ? error.message : String(error || ""),
        });
      }
      bridgePort = null;
      bridgePortPromise = null;
    }

    function ensureBridgeFrame(runtimeConfig) {
      const expectedSrc = resolveBridgeSrc(runtimeConfig);
      const existing = global.document.getElementById(BRIDGE_IFRAME_ID);
      if (existing instanceof global.HTMLIFrameElement) {
        if (existing.src === expectedSrc) {
          return existing;
        }
        closeBridgePort("iframe-recreate");
        resetBridgeState({ clearConnectionKey: true });
        existing.remove();
      }
      const iframe = global.document.createElement("iframe");
      iframe.id = BRIDGE_IFRAME_ID;
      iframe.src = expectedSrc;
      iframe.hidden = true;
      iframe.tabIndex = -1;
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.display = "none";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      global.document.body.appendChild(iframe);
      return iframe;
    }

    function handleBridgeMessage(event) {
      const data = event?.data && typeof event.data === "object" ? event.data : {};
      const type = namespace.session.normalizeText(data.type);
      const payload = data.payload && typeof data.payload === "object" ? data.payload : {};
      const currentRequestId = Number(hooks.getCurrentRequestId?.()) || 0;

      if (type === "ready") {
        hooks.log?.("panel.bridge.ready", {});
        bridgeReadyResolve?.();
        return;
      }
      if (type === "connected") {
        if (Number(payload.requestId) && Number(payload.requestId) !== currentRequestId) {
          return;
        }
        bridgeAttached = true;
        bridgeConnecting = false;
        bridgeConnected = true;
        hooks.log?.("panel.bridge.connected", payload);
        runAsyncHook(hooks.onConnected, payload);
        return;
      }
      if (type === "disconnected") {
        resetBridgeState({ clearConnectionKey: true });
        hooks.log?.("panel.bridge.detached", payload);
        runAsyncHook(hooks.onDisconnected, payload);
        return;
      }
      if (Number(payload.requestId) && Number(payload.requestId) !== currentRequestId) {
        return;
      }
      if (type === "snapshot") {
        bridgeAttached = true;
        bridgeConnecting = false;
        bridgeConnected = true;
        runAsyncHook(hooks.onSnapshot, payload);
        return;
      }
      if (type === "error") {
        resetBridgeState({ clearConnectionKey: false });
        runAsyncHook(hooks.onError, payload);
      }
    }

    function resetBridgeState({ clearConnectionKey }) {
      bridgeAttached = false;
      bridgeConnecting = false;
      bridgeConnected = false;
      if (clearConnectionKey) {
        bridgeConnectionKey = "";
      }
    }

    function resolveBridgeOrigin(runtimeConfig) {
      return namespace.session.normalizeText(runtimeConfig?.hosting?.originUrl) || namespace.firebaseConfig.hosting.originUrl;
    }

    function resolveBridgeSrc(runtimeConfig) {
      return namespace.session.normalizeText(runtimeConfig?.hosting?.meetingPanelBridgeUrl) || namespace.firebaseConfig.hosting.meetingPanelBridgeUrl;
    }

    function runAsyncHook(handler, payload) {
      Promise.resolve(handler?.(payload)).catch((error) => hooks.onAsyncError?.(error));
    }
  }

  namespace.meetingPanelBridgeController = { create };
})(globalThis);
