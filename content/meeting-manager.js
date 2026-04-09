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
    let authState = { expiresAt: "", firebaseCustomToken: "", functionsBaseUrl: "", providerUserKey: "" };
    let authPromise = null;
    let authPromiseKey = "";
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
    let lastSnapshotRequestId = 0;
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
      const settingsChange = namespace.productLane?.getStorageChange?.(changes, namespace.constants.storageKeys.settings) || changes.settings;
      const cloudSyncChange = namespace.productLane?.getStorageChange?.(changes, namespace.constants.storageKeys.cloudSync) || changes.cloudSync;
      if (settingsChange || cloudSyncChange) {
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

    function resolveMeetingRuntimeConfig() {
      return namespace.firebaseConfig?.meeting?.resolveRuntime?.(state.settings) || {
        functions: namespace.firebaseConfig?.functions || {},
        hosting: namespace.firebaseConfig?.hosting || {},
        target: "production",
        web: namespace.firebaseConfig?.web || {},
      };
    }

    function closeBridgePort(context) {
      try {
        bridgePort?.close?.();
      } catch (error) {
        namespace.panelDebug?.log?.("panel.bridge.close.error", {
          context,
          error: error instanceof Error ? error.message : String(error || ""),
        });
      }
      bridgePort = null;
      bridgePortPromise = null;
    }

    async function ensureRealtime(providerIdentity, reason) {
      const runtimeConfig = resolveMeetingRuntimeConfig();
      const ownerKey = namespace.session.normalizeText(providerIdentity?.providerUserKey);
      const port = await ensureBridgePort(runtimeConfig);
      const auth = await ensurePanelAuth(providerIdentity, runtimeConfig);
      const connectionKey = [
        namespace.session.normalizeText(runtimeConfig?.target) || "production",
        namespace.session.normalizeText(runtimeConfig?.hosting?.originUrl),
        namespace.session.normalizeText(runtimeConfig?.functions?.baseUrl),
        ownerKey,
        namespace.session.normalizeText(auth.expiresAt),
      ].join("::");
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
          firebaseConfig: { ...(runtimeConfig?.web || namespace.firebaseConfig.web) },
          firebaseCustomToken: auth.firebaseCustomToken,
          providerUserKey: auth.providerUserKey,
          queryLimit: BRIDGE_QUERY_LIMIT,
        },
        requestId: currentRequestId,
        type: "init",
      });
    }

    async function ensurePanelAuth(providerIdentity, runtimeConfig) {
      const providerUserKey = namespace.session.normalizeText(providerIdentity?.providerUserKey);
      const functionsBaseUrl = namespace.session.normalizeText(runtimeConfig?.functions?.baseUrl);
      const expiryTime = Date.parse(authState.expiresAt || "");
      if (
        authState.firebaseCustomToken
        && authState.functionsBaseUrl === functionsBaseUrl
        && authState.providerUserKey === providerUserKey
        && expiryTime > Date.now() + 60000
      ) {
        return authState;
      }
      const nextAuthPromiseKey = `${providerUserKey}::${functionsBaseUrl}`;
      if (authPromise && authPromiseKey === nextAuthPromiseKey) {
        return authPromise;
      }

      namespace.panelDebug?.log?.("panel.auth.start", {
        functionsBaseUrl,
        providerUserKey,
      });
      authPromiseKey = nextAuthPromiseKey;
      authPromise = (async () => {
        const nextAuth = await namespace.meetingBridge.issuePanelAuth(providerIdentity);
        authState = {
          expiresAt: namespace.session.normalizeText(nextAuth?.expiresAt),
          firebaseCustomToken: namespace.session.normalizeText(nextAuth?.firebaseCustomToken),
          functionsBaseUrl,
          providerUserKey: namespace.session.normalizeText(nextAuth?.providerUserKey),
        };
        namespace.panelDebug?.log?.("panel.auth.success", {
          expiresAt: authState.expiresAt,
          functionsBaseUrl: authState.functionsBaseUrl,
          providerUserKey: authState.providerUserKey,
        });
        return authState;
      })();
      try {
        return await authPromise;
      } finally {
        authPromise = null;
        authPromiseKey = "";
      }
    }

    async function ensureBridgePort(runtimeConfig) {
      const expectedSrc = namespace.session.normalizeText(runtimeConfig?.hosting?.meetingPanelBridgeUrl) || namespace.firebaseConfig.hosting.meetingPanelBridgeUrl;
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
        bridgeAttached = false;
        bridgeConnected = false;
        bridgeConnecting = false;
        bridgeConnectionKey = "";
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
            namespace.session.normalizeText(runtimeConfig?.hosting?.originUrl) || namespace.firebaseConfig.hosting.originUrl,
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

    function ensureBridgeFrame(runtimeConfig) {
      const expectedSrc = namespace.session.normalizeText(runtimeConfig?.hosting?.meetingPanelBridgeUrl) || namespace.firebaseConfig.hosting.meetingPanelBridgeUrl;
      const existing = global.document.getElementById(BRIDGE_IFRAME_ID);
      if (existing instanceof global.HTMLIFrameElement) {
        if (existing.src === expectedSrc) {
          return existing;
        }
        closeBridgePort("iframe-recreate");
        bridgeAttached = false;
        bridgeConnected = false;
        bridgeConnecting = false;
        bridgeConnectionKey = "";
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
        warmRefresh(namespace.providerIdentity.getCurrent(), currentRequestId).catch(logRefreshError);
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
      lastSnapshotRequestId = Math.max(lastSnapshotRequestId, Number(payload.requestId) || currentRequestId);
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
      state.meetingHub = mergeMeetingHub({
        ...state.meetingHub,
        checkedAt: namespace.session.normalizeText(payload.checkedAt) || new Date().toISOString(),
        degraded: false,
        degradedReason: "",
        dataFreshness: "fresh",
        error: "",
        items,
        source: "realtime",
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
        state.meetingHub = mergeMeetingHub({
          ...state.meetingHub,
          checkedAt: new Date().toISOString(),
          degraded: true,
          degradedReason: "meeting-hub-realtime-failed",
          dataFreshness: "fresh",
          error: composeMeetingHubErrorMessage(error),
          items,
          source: "runtime-read",
          version: Math.max(1, Number(state.meetingHub?.version) || 1),
        });
        namespace.panelDebug?.log?.("panel.fallback.refresh.success", {
          count: items.length,
        });
      } catch (refreshError) {
        const cachedItems = Array.isArray(state.meetingHub?.items) ? state.meetingHub.items : [];
        const message = composeMeetingHubErrorMessage(error, refreshError);
        namespace.panelDebug?.log?.("panel.fallback.refresh.error", {
          error: message,
        });
        state.meetingHub = mergeMeetingHub({
          ...state.meetingHub,
          checkedAt: new Date().toISOString(),
          degraded: true,
          degradedReason: cachedItems.length ? "meeting-hub-stale-cache" : "meeting-hub-empty",
          dataFreshness: cachedItems.length ? "stale" : "empty",
          error: message,
          items: cachedItems,
          source: cachedItems.length ? "cache" : "none",
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
        } catch (error) {
          namespace.panelDebug?.log?.("panel.bridge.disconnect.error", {
            error: error instanceof Error ? error.message : String(error || ""),
            reason,
          });
        }
      }
      bridgeAttached = false;
      bridgeConnecting = false;
      bridgeConnected = false;
      bridgeConnectionKey = "";
      lastSnapshotRequestId = 0;
      namespace.panelDebug?.log?.("panel.bridge.detach", {
        reason,
      });
    }

    async function warmRefresh(providerIdentity, requestId) {
      if (!providerIdentity?.available || requestId !== currentRequestId || lastSnapshotRequestId >= requestId || fallbackInflight || !isMeetingHubPendingInitialLoad(state.meetingHub)) {
        return;
      }
      namespace.panelDebug?.log?.("panel.warm.refresh.request", {
        requestId,
      });
      const listPayload = await namespace.meetingBridge.listMeetings(
        {
          limit: BRIDGE_QUERY_LIMIT,
        },
        providerIdentity
      );
      if (requestId !== currentRequestId || lastSnapshotRequestId >= requestId || !isMeetingHubPendingInitialLoad(state.meetingHub)) {
        return;
      }
      const items = normalizeRealtimeItems(listPayload?.items);
      state.meetingHub = mergeMeetingHub({
        ...state.meetingHub,
        checkedAt: new Date().toISOString(),
        degraded: false,
        degradedReason: "",
        dataFreshness: "fresh",
        error: "",
        items,
        source: "runtime-read",
        version: Math.max(1, Number(state.meetingHub?.version) || 1),
      });
      namespace.panelDebug?.log?.("panel.warm.refresh.success", {
        count: items.length,
        requestId,
      });
      hooks.render?.();
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
      degraded: Boolean(nextHub?.degraded),
      degradedReason: Object.prototype.hasOwnProperty.call(nextHub || {}, "degradedReason")
        ? namespace.session.normalizeText(nextHub?.degradedReason)
        : namespace.session.normalizeText(defaults.degradedReason),
      dataFreshness: normalizeDataFreshness(nextHub?.dataFreshness),
      items: Array.isArray(nextHub?.items) ? nextHub.items : [],
      source: normalizeMeetingHubSource(nextHub?.source),
    };
  }

  function composeMeetingHubErrorMessage(primaryError, secondaryError) {
    const primaryMessage = namespace.session.normalizeText(primaryError instanceof Error ? primaryError.message : String(primaryError || ""));
    const secondaryMessage = namespace.session.normalizeText(secondaryError instanceof Error ? secondaryError.message : String(secondaryError || ""));
    if (!secondaryMessage) {
      return primaryMessage || "회의 목록을 불러오지 못했어요.";
    }
    if (!primaryMessage || primaryMessage === secondaryMessage) {
      return secondaryMessage;
    }
    return `${primaryMessage} 추가 읽기에도 실패했어요: ${secondaryMessage}`;
  }

  function normalizeDataFreshness(value) {
    const normalized = namespace.session.normalizeText(value).toLowerCase();
    return normalized === "fresh" || normalized === "stale" || normalized === "empty"
      ? normalized
      : defaults.dataFreshness;
  }

  function normalizeMeetingHubSource(value) {
    const normalized = namespace.session.normalizeText(value).toLowerCase();
    return normalized === "realtime"
      || normalized === "runtime-read"
      || normalized === "cache"
      || normalized === "local"
      || normalized === "none"
      ? normalized
      : defaults.source;
  }

  function isMeetingHubPendingInitialLoad(meetingHub) {
    const hub = meetingHub && typeof meetingHub === "object" ? meetingHub : null;
    return !(
      Array.isArray(hub?.items) && hub.items.length
      || namespace.session.normalizeText(hub?.checkedAt)
      || namespace.session.normalizeText(hub?.error)
    );
  }

  namespace.meetingManager = {
    create,
    mergeMeetingHub,
  };
})(globalThis);
