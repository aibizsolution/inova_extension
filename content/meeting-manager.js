(function initMeetingManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const defaults = namespace.constants.defaults.meetingHub;
  const ACTIVE_SYNC_DELAY_MS = 220;
  const BRIDGE_IFRAME_ID = "inova-meeting-panel-bridge";
  const BRIDGE_IFRAME_READY_TIMEOUT_MS = 10000;
  const BRIDGE_MESSAGE_SOURCE = "inova-meeting-panel-client";
  const BRIDGE_QUERY_LIMIT = 24;
  const FALLBACK_REFRESH_COOLDOWN_MS = 15000;

  function create(state, hooks) {
    let authState = { expiresAt: "", firebaseCustomToken: "", providerUserKey: "" };
    let bridgeFrame = null;
    let bridgePort = null;
    let bridgePortPromise = null;
    let bridgeReadyReject = null;
    let bridgeReadyResolve = null;
    let currentRequestId = 0;
    let bridgeConnectionKey = "";
    let bridgeConnected = false;
    let bridgeConnecting = false;
    let bridgeAttached = false;
    let fallbackInflight = false;
    let fallbackCooldownUntil = 0;
    let timerId = 0;

    return {
      handleRouteStateChange,
      handleStorageChange,
      refreshState,
      scheduleSync,
    };

    function handleRouteStateChange() {
      scheduleSync(80);
      hooks.render?.();
    }

    function handleStorageChange(changes, areaName) {
      if (areaName !== "local") {
        return;
      }
      if (changes.meetingHub) {
        state.meetingHub = mergeMeetingHub(changes.meetingHub.newValue);
        hooks.render?.();
      }
      if (changes.settings || changes.cloudSync) {
        scheduleSync(240);
      }
    }

    function scheduleSync(delay = ACTIVE_SYNC_DELAY_MS) {
      global.clearTimeout(timerId);
      timerId = global.setTimeout(() => {
        refreshState("scheduled").catch(logRefreshError);
      }, delay);
    }

    async function refreshState(reason = "manual") {
      state.meetingHub = await namespace.storage.getMeetingHub();

      const providerIdentity = namespace.providerIdentity.getCurrent();
      if (!shouldUseRealtime(providerIdentity)) {
        disconnectRealtime(reason);
        hooks.render?.();
        return state.meetingHub;
      }

      try {
        await ensureRealtime(providerIdentity, reason);
      } catch (error) {
        await fallbackRefresh(providerIdentity, reason, error);
      }
      hooks.render?.();
      return state.meetingHub;
    }

    function shouldUseRealtime(providerIdentity) {
      return Boolean(
        providerIdentity?.available
        && state.open
        && state.activeTool === "meeting"
        && !global.document.hidden
      );
    }

    async function ensureRealtime(providerIdentity, reason) {
      const ownerKey = namespace.session.normalizeText(providerIdentity?.providerUserKey);
      const port = await ensureBridgePort();
      const auth = await ensurePanelAuth(providerIdentity);
      const connectionKey = `${ownerKey}::${namespace.session.normalizeText(auth.expiresAt)}`;
      if (
        bridgePort
        && connectionKey
        && bridgeConnectionKey === connectionKey
        && (bridgeAttached || bridgeConnected || bridgeConnecting)
      ) {
        return;
      }
      bridgeConnectionKey = connectionKey;
      bridgeAttached = true;
      bridgeConnecting = true;
      bridgeConnected = false;
      currentRequestId += 1;
      namespace.panelDebug?.log?.("panel.bridge.request", {
        providerUserKey: ownerKey,
        reason,
        requestId: currentRequestId,
      });
      port.postMessage({
        payload: {
          expiresAt: auth.expiresAt,
          firebaseConfig: { ...namespace.firebaseConfig.web },
          firebaseCustomToken: auth.firebaseCustomToken,
          providerUserKey: auth.providerUserKey,
          queryLimit: BRIDGE_QUERY_LIMIT,
        },
        requestId: currentRequestId,
        type: "init",
      });
    }

    async function ensurePanelAuth(providerIdentity) {
      const providerUserKey = namespace.session.normalizeText(providerIdentity?.providerUserKey);
      const expiryTime = Date.parse(authState.expiresAt || "");
      if (
        authState.firebaseCustomToken
        && authState.providerUserKey === providerUserKey
        && expiryTime > Date.now() + 60000
      ) {
        return authState;
      }

      namespace.panelDebug?.log?.("panel.auth.start", {
        providerUserKey,
      });
      const nextAuth = await namespace.meetingBridge.issuePanelAuth(providerIdentity);
      authState = {
        expiresAt: namespace.session.normalizeText(nextAuth?.expiresAt),
        firebaseCustomToken: namespace.session.normalizeText(nextAuth?.firebaseCustomToken),
        providerUserKey: namespace.session.normalizeText(nextAuth?.providerUserKey),
      };
      namespace.panelDebug?.log?.("panel.auth.success", {
        expiresAt: authState.expiresAt,
        providerUserKey: authState.providerUserKey,
      });
      return authState;
    }

    async function ensureBridgePort() {
      if (bridgePort) {
        return bridgePort;
      }
      if (bridgePortPromise) {
        return bridgePortPromise;
      }

      bridgeFrame = ensureBridgeFrame();
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
            namespace.panelDebug?.log?.("panel.bridge.error", {
              error: "패널 Firestore bridge 채널이 끊겼어요.",
            });
            bridgeAttached = false;
            bridgeConnected = false;
            bridgeConnecting = false;
            bridgeConnectionKey = "";
            bridgePort = null;
          };
          bridgePort.start?.();
          bridgeFrame.contentWindow.postMessage(
            {
              source: BRIDGE_MESSAGE_SOURCE,
              type: "connect-port",
            },
            namespace.firebaseConfig.hosting.originUrl,
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

    function ensureBridgeFrame() {
      const existing = global.document.getElementById(BRIDGE_IFRAME_ID);
      if (existing instanceof global.HTMLIFrameElement) {
        return existing;
      }
      const iframe = global.document.createElement("iframe");
      iframe.id = BRIDGE_IFRAME_ID;
      iframe.src = namespace.firebaseConfig.hosting.meetingPanelBridgeUrl;
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
      if (type === "ready") {
        namespace.panelDebug?.log?.("panel.bridge.ready", {});
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
        namespace.panelDebug?.log?.("panel.bridge.connected", payload);
        return;
      }
      if (type === "disconnected") {
        bridgeAttached = false;
        bridgeConnecting = false;
        bridgeConnected = false;
        bridgeConnectionKey = "";
        namespace.panelDebug?.log?.("panel.bridge.detached", payload);
        return;
      }
      if (Number(payload.requestId) && Number(payload.requestId) !== currentRequestId) {
        return;
      }
      if (type === "snapshot") {
        handleSnapshotPayload(payload).catch(logRefreshError);
        return;
      }
      if (type === "error") {
        handleBridgeError(payload).catch(logRefreshError);
      }
    }

    async function handleSnapshotPayload(payload) {
      const items = normalizeRealtimeItems(payload.items);
      bridgeAttached = true;
      bridgeConnecting = false;
      bridgeConnected = true;
      namespace.panelDebug?.log?.("panel.firestore.snapshot", {
        count: items.length,
        fromCache: Boolean(payload.fromCache),
        hasPendingWrites: Boolean(payload.hasPendingWrites),
        source: payload.fromCache ? "cache" : "server",
      });
      state.meetingHub = await namespace.storage.setMeetingHub({
        checkedAt: namespace.session.normalizeText(payload.checkedAt) || new Date().toISOString(),
        error: "",
        items,
        source: "firestore",
        version: Math.max(1, Number(state.meetingHub?.version) || 1),
      });
      hooks.render?.();
    }

    async function handleBridgeError(payload) {
      bridgeAttached = false;
      bridgeConnecting = false;
      bridgeConnected = false;
      const providerIdentity = namespace.providerIdentity.getCurrent();
      const error = new Error(namespace.session.normalizeText(payload.error) || "패널 Firestore 구독에 실패했어요.");
      namespace.panelDebug?.log?.("panel.firestore.error", {
        error: error.message,
      });
      await fallbackRefresh(providerIdentity, "bridge-error", error);
    }

    async function fallbackRefresh(providerIdentity, reason, error) {
      if (!providerIdentity?.available) {
        throw error;
      }
      if (fallbackInflight || fallbackCooldownUntil > Date.now()) {
        throw error;
      }
      fallbackInflight = true;
      fallbackCooldownUntil = Date.now() + FALLBACK_REFRESH_COOLDOWN_MS;
      namespace.panelDebug?.log?.("panel.fallback.refresh.request", {
        error: error instanceof Error ? error.message : namespace.session.normalizeText(error),
        reason,
      });
      try {
        const listPayload = await namespace.meetingBridge.listMeetings(
          {
            limit: BRIDGE_QUERY_LIMIT,
          },
          providerIdentity
        );
        const items = normalizeRealtimeItems(listPayload?.items);
        state.meetingHub = await namespace.storage.setMeetingHub({
          checkedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : namespace.session.normalizeText(error),
          items,
          source: "fallback",
          version: Math.max(1, Number(state.meetingHub?.version) || 1),
        });
        namespace.panelDebug?.log?.("panel.fallback.refresh.success", {
          count: items.length,
        });
      } catch (refreshError) {
        const message = refreshError instanceof Error
          ? refreshError.message
          : "회의 목록을 불러오지 못했어요.";
        namespace.panelDebug?.log?.("panel.fallback.refresh.error", {
          error: message,
        });
        state.meetingHub = await namespace.storage.setMeetingHub({
          checkedAt: new Date().toISOString(),
          error: message,
          items: Array.isArray(state.meetingHub?.items) ? state.meetingHub.items : [],
          source: "fallback",
          version: Math.max(1, Number(state.meetingHub?.version) || 1),
        });
      } finally {
        fallbackInflight = false;
        hooks.render?.();
      }
    }

    function disconnectRealtime(reason) {
      if (!bridgeAttached && !bridgeConnected && !bridgeConnecting && !bridgeConnectionKey) {
        return;
      }
      currentRequestId += 1;
      if (bridgePort && (bridgeAttached || bridgeConnected || bridgeConnecting || bridgeConnectionKey)) {
        try {
          bridgePort.postMessage({ type: "disconnect" });
        } catch {}
      }
      bridgeAttached = false;
      bridgeConnecting = false;
      bridgeConnected = false;
      bridgeConnectionKey = "";
      namespace.panelDebug?.log?.("panel.bridge.detach", {
        reason,
      });
    }

    function logRefreshError(error) {
      if (isInvalidatedContextError(error)) {
        hooks.render?.();
        return;
      }
      namespace.panelDebug?.log?.("panel.refresh.error", {
        error: error instanceof Error ? error.message : String(error || ""),
      });
      if (namespace.panelDebug?.isEnabled?.()) {
        console.error("[i-Nova Bookmarks] meeting hub refresh failed", error);
      }
      hooks.render?.();
    }

    function isInvalidatedContextError(error) {
      const message = namespace.session.normalizeText(error instanceof Error ? error.message : String(error || ""));
      return message.includes("Extension context invalidated")
        || message.includes("확장프로그램이 갱신됐어요.");
    }
  }

  function normalizeRealtimeItems(items) {
    return (Array.isArray(items) ? items : [])
      .filter((item) => !namespace.session.normalizeText(item?.deletedAt))
      .sort((left, right) =>
        Date.parse(namespace.session.normalizeText(right?.updatedAt || right?.createdAt || "")) - Date.parse(namespace.session.normalizeText(left?.updatedAt || left?.createdAt || ""))
      )
      .slice(0, BRIDGE_QUERY_LIMIT);
  }

  function mergeMeetingHub(nextHub) {
    return {
      ...defaults,
      ...(nextHub && typeof nextHub === "object" ? nextHub : {}),
      items: Array.isArray(nextHub?.items) ? nextHub.items : [],
      source: namespace.session.normalizeText(nextHub?.source),
    };
  }

  namespace.meetingManager = {
    create,
    mergeMeetingHub,
  };
})(globalThis);
