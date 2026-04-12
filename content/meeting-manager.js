(function initMeetingManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const defaults = namespace.constants.defaults.meetingHub;
  const ACTIVE_SYNC_DELAY_MS = 220;
  const BRIDGE_QUERY_LIMIT = 24;
  const FALLBACK_REFRESH_COOLDOWN_MS = 15000;

  function create(state, hooks) {
    let authState = { expiresAt: "", firebaseCustomToken: "", functionsBaseUrl: "", providerUserKey: "" };
    let authPromise = null;
    let authPromiseKey = "";
    let currentRequestId = 0;
    let fallbackInflight = false;
    let fallbackCooldownUntil = 0;
    let lastSnapshotRequestId = 0;
    let realtimeActive = false;
    let timerId = 0;
    const meetingPanelBridgeController = namespace.meetingPanelBridgeController.create({
      getCurrentRequestId: () => currentRequestId,
      log: (event, payload) => namespace.panelDebug?.log?.(event, payload),
      onAsyncError: logRefreshError,
      onConnected: () => warmRefresh(namespace.providerIdentity.getCurrent(), currentRequestId),
      onError: handleBridgeError,
      onSnapshot: handleSnapshotPayload,
    });

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
      if (!shouldScheduleRefresh()) {
        if (realtimeActive) {
          global.clearTimeout(timerId);
          timerId = global.setTimeout(() => {
            disconnectRealtime("inactive");
            hooks.render?.();
          }, Math.max(0, Number(delay) || 0));
        }
        return false;
      }
      traceMeetingFlow("70.top.meeting.sync.scheduled", {
        activeTool: namespace.session.normalizeText(state.activeTool),
        delay,
        open: Boolean(state.open),
      });
      global.clearTimeout(timerId);
      timerId = global.setTimeout(() => {
        refreshState("scheduled").catch(logRefreshError);
      }, delay);
    }

    async function refreshState(reason = "manual") {
      const providerIdentity = namespace.providerIdentity.getCurrent();
      traceMeetingFlow("71.top.meeting.refresh.start", {
        activeTool: namespace.session.normalizeText(state.activeTool),
        open: Boolean(state.open),
        providerAvailable: Boolean(providerIdentity?.available),
        reason,
        visibility: global.document.hidden ? "hidden" : "visible",
      });
      if (!shouldUseRealtime(providerIdentity)) {
        if (realtimeActive) {
          traceMeetingFlow("72.top.meeting.refresh.skip-realtime", {
            activeTool: namespace.session.normalizeText(state.activeTool),
            open: Boolean(state.open),
            providerAvailable: Boolean(providerIdentity?.available),
            reason,
            visibility: global.document.hidden ? "hidden" : "visible",
          });
          disconnectRealtime(reason);
          hooks.render?.();
        }
        return state.meetingHub;
      }

      try {
        await ensureRealtime(providerIdentity, reason);
      } catch (error) {
        traceMeetingFlow("78.top.meeting.realtime.error", {
          error: error instanceof Error ? error.message : String(error || ""),
          reason,
        });
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

    async function ensureRealtime(providerIdentity, reason) {
      const runtimeConfig = resolveMeetingRuntimeConfig();
      const ownerKey = namespace.session.normalizeText(providerIdentity?.providerUserKey);
      traceMeetingFlow("73.top.meeting.realtime.ensure.start", {
        functionsBaseUrl: namespace.session.normalizeText(runtimeConfig?.functions?.baseUrl),
        ownerKey,
        reason,
        target: namespace.session.normalizeText(runtimeConfig?.target) || "production",
      });
      const port = await meetingPanelBridgeController.ensurePort(runtimeConfig);
      traceMeetingFlow("74.top.meeting.realtime.port.ready", {
        hasPort: Boolean(port),
        ownerKey,
        reason,
      });
      const auth = await ensurePanelAuth(providerIdentity, runtimeConfig);
      const connectionKey = [
        namespace.session.normalizeText(runtimeConfig?.target) || "production",
        namespace.session.normalizeText(runtimeConfig?.hosting?.originUrl),
        namespace.session.normalizeText(runtimeConfig?.functions?.baseUrl),
        ownerKey,
        namespace.session.normalizeText(auth.expiresAt),
      ].join("::");
      if (meetingPanelBridgeController.hasActiveConnection(connectionKey)) {
        realtimeActive = true;
        traceMeetingFlow("76.top.meeting.realtime.reuse", {
          ownerKey,
          reason,
          requestId: currentRequestId,
        });
        return;
      }
      currentRequestId += 1;
      realtimeActive = true;
      traceMeetingFlow("76.top.meeting.realtime.init", {
        ownerKey,
        reason,
        requestId: currentRequestId,
      });
      meetingPanelBridgeController.beginConnection({
        connectionKey,
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
        traceMeetingFlow("75.top.meeting.auth.cached", {
          functionsBaseUrl,
          providerUserKey,
        });
        return authState;
      }
      const nextAuthPromiseKey = `${providerUserKey}::${functionsBaseUrl}`;
      if (authPromise && authPromiseKey === nextAuthPromiseKey) {
        traceMeetingFlow("75.top.meeting.auth.pending", {
          functionsBaseUrl,
          providerUserKey,
        });
        return authPromise;
      }

      traceMeetingFlow("75.top.meeting.auth.start", {
        functionsBaseUrl,
        providerUserKey,
      });
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
        traceMeetingFlow("75.top.meeting.auth.success", {
          expiresAt: authState.expiresAt,
          functionsBaseUrl: authState.functionsBaseUrl,
          providerUserKey: authState.providerUserKey,
        });
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

    async function handleSnapshotPayload(payload) {
      lastSnapshotRequestId = Math.max(lastSnapshotRequestId, Number(payload.requestId) || currentRequestId);
      const items = normalizeRealtimeItems(payload.items);
      traceMeetingFlow("77.top.meeting.snapshot", {
        count: items.length,
        fromCache: Boolean(payload.fromCache),
        hasPendingWrites: Boolean(payload.hasPendingWrites),
        requestId: Number(payload.requestId) || currentRequestId,
        source: payload.fromCache ? "cache" : "server",
      });
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
      const providerIdentity = namespace.providerIdentity.getCurrent();
      const error = new Error(namespace.session.normalizeText(payload.error) || "패널 Firestore 구독에 실패했어요.");
      traceMeetingFlow("78.top.meeting.bridge.error", {
        error: error.message,
      });
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
        traceMeetingFlow("79.top.meeting.fallback.skipped", {
          cooldownUntil: fallbackCooldownUntil,
          inflight: fallbackInflight,
          reason,
        });
        throw error;
      }
      fallbackInflight = true;
      fallbackCooldownUntil = Date.now() + FALLBACK_REFRESH_COOLDOWN_MS;
      traceMeetingFlow("79.top.meeting.fallback.start", {
        error: error instanceof Error ? error.message : namespace.session.normalizeText(error),
        reason,
      });
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
        traceMeetingFlow("79.top.meeting.fallback.success", {
          count: items.length,
          reason,
          source: "runtime-read",
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
        traceMeetingFlow("79.top.meeting.fallback.error", {
          error: message,
          hasCachedItems: Boolean(cachedItems.length),
          reason,
        });
      } finally {
        fallbackInflight = false;
        hooks.render?.();
      }
    }

    function disconnectRealtime(reason) {
      if (!realtimeActive) {
        return;
      }
      realtimeActive = false;
      currentRequestId += 1;
      traceMeetingFlow("80.top.meeting.realtime.disconnect", {
        reason,
        requestId: currentRequestId,
      });
      meetingPanelBridgeController.disconnect(reason);
      lastSnapshotRequestId = 0;
    }

    async function warmRefresh(providerIdentity, requestId) {
      if (!providerIdentity?.available || requestId !== currentRequestId || lastSnapshotRequestId >= requestId || fallbackInflight || !isMeetingHubPendingInitialLoad(state.meetingHub)) {
        traceMeetingFlow("81.top.meeting.warm.skip", {
          fallbackInflight,
          hasSnapshot: lastSnapshotRequestId >= requestId,
          pendingInitialLoad: isMeetingHubPendingInitialLoad(state.meetingHub),
          providerAvailable: Boolean(providerIdentity?.available),
          requestId,
        });
        return;
      }
      traceMeetingFlow("81.top.meeting.warm.start", {
        requestId,
      });
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
        traceMeetingFlow("81.top.meeting.warm.skip-after-read", {
          hasSnapshot: lastSnapshotRequestId >= requestId,
          pendingInitialLoad: isMeetingHubPendingInitialLoad(state.meetingHub),
          requestId,
        });
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
      traceMeetingFlow("81.top.meeting.warm.success", {
        count: items.length,
        requestId,
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
      traceMeetingFlow("82.top.meeting.refresh.error", {
        error: error instanceof Error ? error.message : String(error || ""),
      });
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

    function shouldScheduleRefresh() {
      return state.activeTool === "meeting" || realtimeActive;
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

  function traceMeetingFlow(step, payload = {}) {
    if (!namespace.panelDebug?.isEnabled?.()) {
      return false;
    }
    const detail = payload && typeof payload === "object" ? payload : {};
    if (namespace.panelConsoleTrace?.log) {
      return namespace.panelConsoleTrace.log("meeting", step, detail);
    }
    console.info(`[inova:meeting] ${namespace.session.normalizeText(step) || "trace"}`, detail);
    namespace.panelDebug?.log?.(`trace.meeting.${namespace.session.normalizeText(step) || "trace"}`, detail);
    return true;
  }

  namespace.meetingManager = {
    create,
    mergeMeetingHub,
  };
})(globalThis);
