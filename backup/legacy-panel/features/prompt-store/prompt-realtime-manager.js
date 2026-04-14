(function initPromptRealtimeManager(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const ACTIVE_SYNC_DELAY_MS = 220;
  const BRIDGE_IFRAME_ID = "inova-prompt-panel-bridge";
  const BRIDGE_IFRAME_READY_TIMEOUT_MS = 10000;
  const BRIDGE_MESSAGE_SOURCE = "inova-prompt-panel-client";
  const RETRY_COOLDOWN_MS = 15000;
  const STORE_DETAIL_TIMEOUT_MS = 4000;
  const STORE_LATEST_READY_TIMEOUT_MS = 5000;
  function create(state, hooks) {
    let authState = buildEmptyAuthState();
    let authPromise = null;
    let authPromiseKey = "";
    let bridgeFrame = null;
    let bridgePort = null;
    let bridgePortPromise = null;
    let bridgeReadyReject = null;
    let bridgeReadyResolve = null;
    let bridgeConnectPromise = null;
    let bridgeConnectReject = null;
    let bridgeConnectResolve = null;
    let bridgeConnected = false;
    let bridgeConnecting = false;
    let bridgeConnectionKey = "";
    let runtimeConnectionKey = "";
    let currentRequestId = 0;
    let identityRetryTimer = 0;
    let promptMetaRetryUntil = 0;
    let promptMetaSubscriptionKey = "";
    let storeDetailRequestSequence = 0;
    let pendingStoreDetailRequests = new Map();
    let storeRetryUntil = 0;
    let storeSubscriptionKey = "";
    let storeLatestReady = false;
    let storeLatestReadyPromise = null;
    let storeLatestReadyResolve = null;
    let storeLatestReadyReject = null;
    let timerId = 0;
    return {
      disconnectRealtime,
      isStoreLatestRealtimeActive,
      shouldUseStoreLatestRealtime,
      loadStoreDetail,
      refreshState,
      scheduleSync,
    };
    function scheduleSync(delay = ACTIVE_SYNC_DELAY_MS) {
      global.clearTimeout(timerId);
      timerId = global.setTimeout(() => {
        refreshState("scheduled").catch(logRealtimeError);
      }, delay);
    }
    async function refreshState(reason = "manual") {
      const wantsPromptMeta = shouldUsePromptLibraryRealtime();
      const wantsStoreLatest = shouldUseStoreLatestRealtime();
      const promptMetaEligible = wantsPromptMeta && promptMetaRetryUntil <= Date.now();
      const storeLatestEligible = wantsStoreLatest && storeRetryUntil <= Date.now();
      if (!wantsPromptMeta && !wantsStoreLatest) {
        disconnectRealtime(reason);
        return;
      }
      const providerIdentity = namespace.providerIdentity.getCurrent();
      if (!providerIdentity.available) {
        disconnectRealtime(`${reason}-no-provider`);
        scheduleIdentityRetry();
        return;
      }
      global.clearTimeout(identityRetryTimer);
      const runtimeConfig = resolvePromptRuntimeConfig();
      ensureRuntimeConnection(runtimeConfig, reason);
      if (!wantsPromptMeta) {
        unsubscribePromptLibraryMeta("inactive");
      } else if (!promptMetaEligible) {
        unsubscribePromptLibraryMeta("cooldown");
      }
      if (!wantsStoreLatest) {
        unsubscribeStoreLatest("inactive");
      } else if (!storeLatestEligible) {
        unsubscribeStoreLatest("cooldown");
      }
      if (!promptMetaEligible && !storeLatestEligible) {
        return;
      }
      try {
        const auth = await ensurePanelAuth(providerIdentity, runtimeConfig);
        const port = await ensureBridgePort(runtimeConfig);
        await ensureBridgeConnected(port, auth, runtimeConfig, reason);
        if (promptMetaEligible) {
          subscribePromptLibraryMeta(auth, reason);
        }
        if (storeLatestEligible) {
          subscribeStoreLatest(auth, reason);
        }
      } catch (error) {
        await handleRealtimeFailure(reason, error, {
          providerIdentity,
          wantsPromptMeta: promptMetaEligible,
          wantsStoreLatest: storeLatestEligible,
        });
      }
    }
    function isPromptRealtimeSurfaceActive() {
      return Boolean(
        state.open
        && state.activeTool === "prompts"
        && hooks.isToolSurface?.()
        && !global.document.hidden
      );
    }
    function shouldUsePromptLibraryRealtime() {
      return Boolean(
        isPromptRealtimeSurfaceActive()
        && hooks.getActivePromptTab?.() === "library"
      );
    }
    function shouldUseStoreLatestRealtime() {
      return Boolean(
        isPromptRealtimeSurfaceActive()
        && hooks.getActivePromptTab?.() === "store"
        && state.store.scope === "all"
      );
    }
    function isStoreLatestRealtimeActive() {
      return Boolean(
        shouldUseStoreLatestRealtime()
        && storeRetryUntil <= Date.now()
        && storeSubscriptionKey
        && bridgeConnected
      );
    }
    function resolvePromptRuntimeConfig() {
      return namespace.firebaseConfig?.prompt?.resolveRuntime?.(state.settings)
        || { functions: namespace.firebaseConfig?.functions || {}, hosting: namespace.firebaseConfig?.hosting || {}, prompt: namespace.firebaseConfig?.prompt || {}, target: "production", web: namespace.firebaseConfig?.web || {} };
    }
    function ensureRuntimeConnection(runtimeConfig, reason) {
      const nextRuntimeKey = buildRuntimeConnectionKey(runtimeConfig);
      if (runtimeConnectionKey && runtimeConnectionKey !== nextRuntimeKey) {
        disconnectRealtime(`${reason}-runtime-change`);
      }
      runtimeConnectionKey = nextRuntimeKey;
    }
    async function ensurePanelAuth(providerIdentity, runtimeConfig) {
      const providerUserKey = namespace.session.normalizeText(providerIdentity?.providerUserKey);
      const requestKey = buildAuthPromiseKey(providerUserKey, runtimeConfig);
      const expiryTime = Date.parse(authState.expiresAt || "");
      if (
        authState.firebaseCustomToken
        && authState.providerUserKey === providerUserKey
        && authState.runtimeKey === requestKey
        && expiryTime > Date.now() + 60000
      ) {
        return authState;
      }
      if (authPromise && authPromiseKey === requestKey) {
        return authPromise;
      }
      authPromiseKey = requestKey;
      authPromise = (async () => {
        namespace.panelDebug?.log?.("prompt.panel.auth.start", { functionsBaseUrl: namespace.session.normalizeText(runtimeConfig?.functions?.baseUrl), providerUserKey, scope: "runtime", target: namespace.session.normalizeText(runtimeConfig?.target) || "production", tool: "prompts" });
        const nextAuth = await sendRuntimeMessage("inova-prompt:issue-panel-auth", {
          providerIdentity,
        });
        const nextAuthState = {
          expiresAt: namespace.session.normalizeText(nextAuth?.expiresAt),
          firebaseCustomToken: namespace.session.normalizeText(nextAuth?.firebaseCustomToken),
          promptFirestoreCollections:
            nextAuth?.promptFirestoreCollections && typeof nextAuth.promptFirestoreCollections === "object"
              ? { ...nextAuth.promptFirestoreCollections }
              : null,
          promptLibraryId: namespace.session.normalizeText(nextAuth?.promptLibraryId),
          promptPanelScope: namespace.session.normalizeText(nextAuth?.promptPanelScope),
          providerUserKey: namespace.session.normalizeText(nextAuth?.providerUserKey),
          runtimeKey: requestKey,
        };
        if (authPromiseKey === requestKey) {
          authState = nextAuthState;
        }
        namespace.panelDebug?.log?.("prompt.panel.auth.success", { expiresAt: nextAuthState.expiresAt, promptLibraryId: nextAuthState.promptLibraryId, providerUserKey: nextAuthState.providerUserKey, scope: "runtime", target: namespace.session.normalizeText(runtimeConfig?.target) || "production", tool: "prompts" });
        return authPromiseKey === requestKey ? authState : nextAuthState;
      })();
      try {
        return await authPromise;
      } finally {
        if (authPromiseKey === requestKey) {
          authPromise = null;
          authPromiseKey = "";
        }
      }
    }
    async function ensureBridgePort(runtimeConfig) {
      if (bridgePort) {
        return bridgePort;
      }
      if (bridgePortPromise) {
        return bridgePortPromise;
      }
      bridgeFrame = ensureBridgeFrame(runtimeConfig);
      bridgePortPromise = new Promise((resolve, reject) => {
        const timeoutId = global.setTimeout(() => {
          bridgeReadyResolve = null;
          bridgeReadyReject = null;
          bridgePortPromise = null;
          reject(new Error("프롬프트 패널 Firestore bridge 준비가 지연되고 있어요."));
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
          reject(error instanceof Error ? error : new Error(String(error || "프롬프트 패널 Firestore bridge를 준비하지 못했어요.")));
        };
        const connectPort = () => {
          if (!bridgeFrame?.contentWindow) {
            bridgeReadyReject?.(new Error("프롬프트 패널 Firestore bridge 창을 찾지 못했어요."));
            return;
          }
          const channel = new MessageChannel();
          bridgePort = channel.port1;
          bridgePort.onmessage = handleBridgeMessage;
          bridgePort.onmessageerror = () => {
            namespace.panelDebug?.log?.("prompt.panel.bridge.error", {
              error: "프롬프트 패널 Firestore bridge 채널이 끊겼어요.",
              scope: "runtime",
              tool: "prompts",
            });
            rejectBridgeConnect(new Error("프롬프트 패널 Firestore bridge 채널이 끊겼어요."));
            resetBridgeState();
            bridgePort = null;
          };
          bridgePort.start?.();
          bridgeFrame.contentWindow.postMessage(
            {
              source: BRIDGE_MESSAGE_SOURCE,
              type: "connect-port",
            },
            resolvePromptBridgeOrigin(runtimeConfig),
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
    async function ensureBridgeConnected(port, auth, runtimeConfig, reason) {
      const connectionKey = [
        runtimeConnectionKey,
        auth.providerUserKey,
        auth.expiresAt,
        auth.promptLibraryId,
        namespace.session.normalizeText(auth.promptPanelScope),
        JSON.stringify(auth.promptFirestoreCollections || {}),
      ].join("::");
      if (bridgeConnected && bridgeConnectionKey === connectionKey) {
        return;
      }
      if (bridgeConnecting && bridgeConnectionKey === connectionKey && bridgeConnectPromise) {
        return bridgeConnectPromise;
      }
      bridgeConnectionKey = connectionKey;
      bridgeConnected = false;
      bridgeConnecting = true;
      currentRequestId += 1;
      namespace.panelDebug?.log?.("prompt.panel.bridge.connect", { promptLibraryId: auth.promptLibraryId, providerUserKey: auth.providerUserKey, reason, requestId: currentRequestId, scope: "runtime", tool: "prompts" });
      bridgeConnectPromise = new Promise((resolve, reject) => {
        bridgeConnectResolve = resolve;
        bridgeConnectReject = reject;
      });
      port.postMessage({
        payload: {
          expiresAt: auth.expiresAt,
          firestoreCollections: {
            ...(runtimeConfig?.prompt?.firestoreCollections || {}),
            ...((auth.promptFirestoreCollections && typeof auth.promptFirestoreCollections === "object")
              ? auth.promptFirestoreCollections
              : {}),
          },
          firebaseConfig: { ...(runtimeConfig?.web || {}) },
          firebaseCustomToken: auth.firebaseCustomToken,
          promptPanelScope: namespace.session.normalizeText(auth.promptPanelScope || runtimeConfig?.prompt?.panelScope),
          promptLibraryId: auth.promptLibraryId,
          providerUserKey: auth.providerUserKey,
        },
        requestId: currentRequestId,
        type: "connect",
      });
      return bridgeConnectPromise;
    }
    function subscribePromptLibraryMeta(auth, reason) {
      if (promptMetaRetryUntil > Date.now()) {
        return;
      }
      const subscriptionKey = auth.providerUserKey;
      if (!bridgePort || !subscriptionKey || promptMetaSubscriptionKey === subscriptionKey) {
        return;
      }
      promptMetaSubscriptionKey = subscriptionKey;
      namespace.panelDebug?.log?.("prompt.panel.subscribe.meta", { providerUserKey: auth.providerUserKey, reason, scope: "runtime", tool: "prompts" });
      bridgePort.postMessage({
        payload: {
          providerUserKey: auth.providerUserKey,
        },
        requestId: currentRequestId,
        type: "subscribe-prompt-library-meta",
      });
    }
    function subscribeStoreLatest(auth, reason) {
      if (storeRetryUntil > Date.now()) {
        return;
      }
      const subscriptionKey = auth.providerUserKey;
      if (!bridgePort || storeSubscriptionKey === subscriptionKey) {
        return;
      }
      storeSubscriptionKey = subscriptionKey;
      resetStoreLatestReady();
      namespace.panelDebug?.log?.("prompt.panel.subscribe.store-latest", { categoryId: "all", providerUserKey: auth.providerUserKey, reason, scope: "runtime", tool: "prompts" });
      bridgePort.postMessage({
        payload: {},
        requestId: currentRequestId,
        type: "subscribe-store-latest",
      });
    }
    function unsubscribePromptLibraryMeta(reason) {
      if (!promptMetaSubscriptionKey) {
        return;
      }
      promptMetaSubscriptionKey = "";
      if (bridgePort) {
        try {
          bridgePort.postMessage({ type: "unsubscribe-prompt-library-meta" });
        } catch (error) {
          namespace.panelDebug?.log?.("prompt.panel.unsubscribe.meta.error", { error: error instanceof Error ? error.message : String(error || ""), reason, scope: "runtime", tool: "prompts" });
        }
      }
      namespace.panelDebug?.log?.("prompt.panel.unsubscribe.meta", { reason, scope: "runtime", tool: "prompts" });
    }
    function unsubscribeStoreLatest(reason) {
      if (!storeSubscriptionKey) {
        return;
      }
      storeSubscriptionKey = "";
      rejectStoreLatestReady(new Error("스토어 최신 목록 구독이 해제됐어요."));
      if (bridgePort) {
        try {
          bridgePort.postMessage({ type: "unsubscribe-store-latest" });
        } catch (error) {
          namespace.panelDebug?.log?.("prompt.panel.unsubscribe.store-latest.error", { error: error instanceof Error ? error.message : String(error || ""), reason, scope: "runtime", tool: "prompts" });
        }
      }
      namespace.panelDebug?.log?.("prompt.panel.unsubscribe.store-latest", { reason, scope: "runtime", tool: "prompts" });
    }
    function ensureBridgeFrame(runtimeConfig) {
      const bridgeTarget = namespace.frameProxy?.resolveTarget?.(resolvePromptBridgeUrl(runtimeConfig)) || {
        error: "",
        origin: readOrigin(resolvePromptBridgeUrl(runtimeConfig)),
        src: resolvePromptBridgeUrl(runtimeConfig),
      };
      if (bridgeTarget.error) {
        throw new Error(bridgeTarget.error);
      }
      const existing = global.document.getElementById(BRIDGE_IFRAME_ID);
      if (existing instanceof global.HTMLIFrameElement) {
        if (namespace.session.normalizeText(existing.src) === bridgeTarget.src) {
          return existing;
        }
        existing.remove();
      }
      if (bridgeFrame instanceof global.HTMLIFrameElement) {
        bridgeFrame.remove();
        bridgeFrame = null;
      }
      const iframe = global.document.createElement("iframe");
      iframe.id = BRIDGE_IFRAME_ID;
      iframe.src = bridgeTarget.src;
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
    function resolvePromptBridgeUrl(runtimeConfig) {
      return namespace.session.normalizeText(runtimeConfig?.hosting?.promptPanelBridgeUrl) || namespace.session.normalizeText(namespace.firebaseConfig?.hosting?.promptPanelBridgeUrl);
    }
    function resolvePromptBridgeOrigin(runtimeConfig) {
      const bridgeUrl = resolvePromptBridgeUrl(runtimeConfig);
      const runtimeOrigin = namespace.session.normalizeText(runtimeConfig?.hosting?.originUrl)
        || namespace.session.normalizeText(namespace.firebaseConfig?.hosting?.originUrl);
      const bridgeTarget = namespace.frameProxy?.resolveTarget?.(bridgeUrl);
      if (bridgeTarget?.error) {
        throw new Error(bridgeTarget.error);
      }
      return bridgeTarget?.origin || runtimeOrigin || readOrigin(bridgeUrl);
    }
    function buildRuntimeConnectionKey(runtimeConfig) {
      return [namespace.session.normalizeText(runtimeConfig?.target) || "production", namespace.session.normalizeText(runtimeConfig?.functions?.baseUrl), resolvePromptBridgeUrl(runtimeConfig)].join("::");
    }
    function buildAuthPromiseKey(providerUserKey, runtimeConfig) {
      const normalizedProviderUserKey = namespace.session.normalizeText(providerUserKey);
      const normalizedRuntimeKey = buildRuntimeConnectionKey(runtimeConfig);
      return normalizedProviderUserKey && normalizedRuntimeKey ? `${normalizedProviderUserKey}::${normalizedRuntimeKey}` : "";
    }
    function readOrigin(value) {
      try {
        return new URL(String(value || "")).origin;
      } catch {
        return "";
      }
    }
    function rejectBridgeReady(error) {
      if (typeof bridgeReadyReject === "function") {
        bridgeReadyReject(error instanceof Error ? error : new Error(String(error || "프롬프트 패널 Firestore bridge를 준비하지 못했어요.")));
      }
      bridgeReadyResolve = null;
      bridgeReadyReject = null;
      bridgePortPromise = null;
    }
    function resetAuthState() {
      authPromise = null;
      authPromiseKey = "";
      authState = buildEmptyAuthState();
    }
    function removeBridgeFrame() {
      const activeFrame = bridgeFrame instanceof global.HTMLIFrameElement
        ? bridgeFrame
        : global.document.getElementById(BRIDGE_IFRAME_ID);
      if (activeFrame instanceof global.HTMLIFrameElement) {
        activeFrame.remove();
      }
      bridgeFrame = null;
    }
    function resetBridgeState() {
      rejectBridgeReady(new Error("프롬프트 패널 Firestore bridge 연결이 닫혔어요."));
      if (bridgePort) {
        try {
          bridgePort.onmessage = null;
          bridgePort.onmessageerror = null;
          bridgePort.close?.();
        } catch (error) {
          void error;
        }
      }
      bridgePort = null;
      bridgeConnected = false;
      bridgeConnecting = false;
      bridgeConnectionKey = "";
      clearBridgeConnectPromise();
      removeBridgeFrame();
    }
    function handleBridgeMessage(event) {
      const data = event?.data && typeof event.data === "object" ? event.data : {};
      const type = namespace.session.normalizeText(data.type);
      const payload = data.payload && typeof data.payload === "object" ? data.payload : {};
      if (type === "ready") {
        namespace.panelDebug?.log?.("prompt.panel.bridge.ready", { scope: "runtime", tool: "prompts" });
        bridgeReadyResolve?.();
        return;
      }
      if (type === "connected") {
        if (Number(payload.requestId) && Number(payload.requestId) !== currentRequestId) {
          return;
        }
        bridgeConnecting = false;
        bridgeConnected = true;
        bridgeConnectResolve?.();
        clearBridgeConnectPromise();
        namespace.panelDebug?.log?.("prompt.panel.bridge.connected", { providerUserKey: namespace.session.normalizeText(payload.providerUserKey), scope: "runtime", tool: "prompts" });
        return;
      }
      if (type === "disconnected") {
        namespace.panelDebug?.log?.("prompt.panel.bridge.disconnected", { scope: "runtime", tool: "prompts" });
        rejectBridgeConnect(new Error("프롬프트 패널 Firestore bridge 연결이 해제됐어요."));
        resetBridgeState();
        return;
      }
      if (Number(payload.requestId) && Number(payload.requestId) !== currentRequestId) {
        return;
      }
      if (type === "prompt-library-meta") {
        handlePromptLibraryMetaPayload(payload).catch(logRealtimeError);
        return;
      }
      if (type === "store-latest") {
        handleStoreLatestPayload(payload).catch(logRealtimeError);
        return;
      }
      if (type === "store-detail") {
        handleStoreDetailPayload(payload);
        return;
      }
      if (type === "error") {
        handleBridgeError(payload).catch(logRealtimeError);
      }
    }
    async function handlePromptLibraryMetaPayload(payload) {
      promptMetaRetryUntil = 0;
      bridgeConnected = true;
      bridgeConnecting = false;
      namespace.panelDebug?.log?.("panel.firestore.prompt-meta.snapshot", {
        fromCache: Boolean(payload.fromCache),
        hasPendingWrites: Boolean(payload.hasPendingWrites),
        itemCount: Math.max(0, Number(payload?.remoteState?.itemCount) || 0),
        scope: "firestore",
        tool: "prompts",
      });
      await hooks.onPromptLibraryMeta?.(payload.remoteState || {});
    }
    async function handleStoreLatestPayload(payload) {
      storeRetryUntil = 0;
      bridgeConnected = true;
      bridgeConnecting = false;
      resolveStoreLatestReady();
      namespace.panelDebug?.log?.("panel.firestore.store-latest.snapshot", {
        categoryId: namespace.session.normalizeText(payload.categoryId || "all"),
        count: Array.isArray(payload.items) ? payload.items.length : 0,
        fromCache: Boolean(payload.fromCache),
        hasPendingWrites: Boolean(payload.hasPendingWrites),
        scope: "firestore",
        tool: "prompts",
      });
      hooks.onStoreLatestSnapshot?.({
        categoryId: namespace.session.normalizeText(payload.categoryId || "all"),
        items: Array.isArray(payload.items) ? payload.items : [],
        summary: payload.summary || {},
      });
    }
    function handleStoreDetailPayload(payload) {
      const entryId = namespace.session.normalizeText(payload.entryId);
      const pending = entryId ? pendingStoreDetailRequests.get(entryId) : null;
      if (!pending) {
        return;
      }
      pendingStoreDetailRequests.delete(entryId);
      namespace.panelDebug?.log?.("panel.firestore.store-detail.success", {
        backend: "firestore",
        entryId,
        fromCache: Boolean(payload.fromCache),
        hasPendingWrites: Boolean(payload.hasPendingWrites),
        operation: "read",
        scope: "firestore",
        tool: "prompts",
      });
      pending.resolve({
        content: normalizeDetailContent(payload.content),
        entryId,
        updatedAt: namespace.session.normalizeText(payload.updatedAt),
      });
    }
    async function handleBridgeError(payload) {
      const channel = namespace.session.normalizeText(payload.channel || "connect");
      const error = new Error(namespace.session.normalizeText(payload.error) || "프롬프트 패널 Firestore 구독에 실패했어요.");
      namespace.panelDebug?.log?.("panel.firestore.error", {
        channel,
        error: error.message,
        scope: "firestore",
        tool: "prompts",
      });
      if (channel === "prompt-library-meta") {
        promptMetaRetryUntil = Date.now() + RETRY_COOLDOWN_MS;
        unsubscribePromptLibraryMeta("bridge-error");
        hooks.onPromptLibraryFallback?.(error);
        return;
      }
      if (channel === "store-latest") {
        storeRetryUntil = Date.now() + RETRY_COOLDOWN_MS;
        unsubscribeStoreLatest("bridge-error");
        hooks.onStoreLatestFallback?.(error);
        return;
      }
      if (channel === "store-detail") {
        const entryId = namespace.session.normalizeText(payload.entryId);
        const pending = entryId ? pendingStoreDetailRequests.get(entryId) : null;
        if (pending) {
          pendingStoreDetailRequests.delete(entryId);
          pending.reject(error);
          return;
        }
      }
      rejectBridgeConnect(error);
      await handleRealtimeFailure("bridge-error", error, {
        providerIdentity: namespace.providerIdentity.getCurrent(),
        wantsPromptMeta: shouldUsePromptLibraryRealtime(),
        wantsStoreLatest: shouldUseStoreLatestRealtime(),
      });
    }
    async function handleRealtimeFailure(reason, error, context) {
      if (context?.wantsPromptMeta) {
        promptMetaRetryUntil = Date.now() + RETRY_COOLDOWN_MS;
        hooks.onPromptLibraryFallback?.(error);
      }
      if (context?.wantsStoreLatest) {
        storeRetryUntil = Date.now() + RETRY_COOLDOWN_MS;
        hooks.onStoreLatestFallback?.(error);
      }
      disconnectRealtime(reason);
    }
    function disconnectRealtime(reason) {
      global.clearTimeout(identityRetryTimer);
      global.clearTimeout(timerId);
      const hadPromptMeta = Boolean(promptMetaSubscriptionKey);
      const hadStoreLatest = Boolean(storeSubscriptionKey);
      const hadPendingDetail = pendingStoreDetailRequests.size > 0;
      const hadBridgeActivity = Boolean(
        bridgePortPromise
        || bridgeConnectPromise
        || bridgeConnected
        || bridgeConnecting
        || bridgeConnectionKey
      );
      const shouldLogDetach = hadPromptMeta || hadStoreLatest || hadPendingDetail || hadBridgeActivity;
      if (shouldLogDetach) {
        currentRequestId += 1;
      }
      unsubscribePromptLibraryMeta(reason);
      unsubscribeStoreLatest(reason);
      rejectPendingStoreDetailRequests(new Error("프롬프트 패널 Firestore bridge 연결이 닫혔어요."));
      if (bridgePort && (bridgeConnected || bridgeConnecting || bridgeConnectionKey)) {
        try {
          bridgePort.postMessage({ type: "disconnect" });
        } catch (error) {
          namespace.panelDebug?.log?.("prompt.panel.bridge.disconnect.error", {
            error: error instanceof Error ? error.message : String(error || ""),
            reason,
            scope: "runtime",
            tool: "prompts",
          });
        }
      }
      rejectBridgeConnect(new Error("프롬프트 패널 Firestore bridge 연결이 닫혔어요."));
      resetBridgeState();
      resetAuthState();
      runtimeConnectionKey = "";
      if (shouldLogDetach) {
        namespace.panelDebug?.log?.("prompt.panel.bridge.detach", {
          reason,
          scope: "runtime",
          tool: "prompts",
        });
      }
    }
    function rejectBridgeConnect(error) {
      if (typeof bridgeConnectReject === "function") {
        bridgeConnectReject(error instanceof Error ? error : new Error(String(error || "프롬프트 패널 Firestore bridge 연결에 실패했어요.")));
      }
      clearBridgeConnectPromise();
    }
    function clearBridgeConnectPromise() {
      bridgeConnectResolve = null;
      bridgeConnectReject = null;
      bridgeConnectPromise = null;
    }
    function resetStoreLatestReady() {
      storeLatestReady = false;
      storeLatestReadyPromise = null;
      storeLatestReadyResolve = null;
      storeLatestReadyReject = null;
    }
    function resolveStoreLatestReady() {
      storeLatestReady = true;
      storeLatestReadyResolve?.();
      storeLatestReadyPromise = null;
      storeLatestReadyResolve = null;
      storeLatestReadyReject = null;
    }
    function rejectStoreLatestReady(error) {
      storeLatestReady = false;
      if (typeof storeLatestReadyReject === "function") {
        storeLatestReadyReject(error instanceof Error ? error : new Error(String(error || "스토어 최신 목록을 준비하지 못했어요.")));
      }
      storeLatestReadyPromise = null;
      storeLatestReadyResolve = null;
      storeLatestReadyReject = null;
    }
    async function waitForStoreLatestReady() {
      if (storeLatestReady || !storeSubscriptionKey) {
        return;
      }
      if (!storeLatestReadyPromise) {
        storeLatestReadyPromise = new Promise((resolve, reject) => {
          storeLatestReadyResolve = resolve;
          storeLatestReadyReject = reject;
        });
      }
      const readyPromise = storeLatestReadyPromise;
      await Promise.race([
        readyPromise,
        new Promise((_, reject) => {
          global.setTimeout(() => {
            reject(new Error("스토어 목록을 준비하는 중이에요. 잠시 후 다시 열어 주세요."));
          }, STORE_LATEST_READY_TIMEOUT_MS);
        }),
      ]);
    }
    function rejectPendingStoreDetailRequests(error) {
      for (const pending of pendingStoreDetailRequests.values()) {
        pending.reject(error);
      }
      pendingStoreDetailRequests.clear();
    }
    async function loadStoreDetail(entryId) {
      const normalizedEntryId = namespace.session.normalizeText(entryId);
      if (!normalizedEntryId) {
        throw new Error("스토어 상세를 찾지 못했어요.");
      }
      const existing = pendingStoreDetailRequests.get(normalizedEntryId);
      if (existing?.promise) {
        return existing.promise;
      }
      let resolveRequest = null;
      let rejectRequest = null;
      const requestPromise = new Promise((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });
      pendingStoreDetailRequests.set(normalizedEntryId, {
        promise: requestPromise,
        timeoutId: 0,
        reject: (error) => {
          const pending = pendingStoreDetailRequests.get(normalizedEntryId);
          global.clearTimeout(Number(pending?.timeoutId) || 0);
          rejectRequest?.(error);
        },
        resolve: (value) => {
          const pending = pendingStoreDetailRequests.get(normalizedEntryId);
          global.clearTimeout(Number(pending?.timeoutId) || 0);
          resolveRequest?.(value);
        },
      });
      try {
        const providerIdentity = namespace.providerIdentity.getCurrent();
        if (!providerIdentity.available) {
          throw new Error("사용자 정보를 확인하지 못했어요.");
        }
        const runtimeConfig = resolvePromptRuntimeConfig();
        ensureRuntimeConnection(runtimeConfig, "store-detail");
        const auth = await ensurePanelAuth(providerIdentity, runtimeConfig);
        const port = await ensureBridgePort(runtimeConfig);
        await ensureBridgeConnected(port, auth, runtimeConfig, "store-detail");
        if (shouldUseStoreLatestRealtime() && storeRetryUntil <= Date.now()) {
          subscribeStoreLatest(auth, "store-detail");
          await waitForStoreLatestReady();
        }
        storeDetailRequestSequence += 1;
        const pending = pendingStoreDetailRequests.get(normalizedEntryId);
        if (!pending || pending.promise !== requestPromise) {
          throw new Error("스토어 상세 요청 상태가 바뀌었어요. 다시 시도해 주세요.");
        }
        pending.timeoutId = global.setTimeout(() => {
          const activePending = pendingStoreDetailRequests.get(normalizedEntryId);
          if (!activePending || activePending.promise !== requestPromise) {
            return;
          }
          pendingStoreDetailRequests.delete(normalizedEntryId);
          namespace.panelDebug?.log?.("panel.firestore.store-detail.timeout", {
            backend: "firestore",
            entryId: normalizedEntryId,
            operation: "read",
            scope: "firestore",
            tool: "prompts",
          });
          rejectRequest?.(new Error("스토어 상세 응답이 지연되고 있어요. 다시 열어 주세요."));
        }, STORE_DETAIL_TIMEOUT_MS);
        namespace.panelDebug?.log?.("panel.firestore.store-detail.request", {
          backend: "firestore",
          detailRequestId: String(storeDetailRequestSequence),
          entryId: normalizedEntryId,
          operation: "read",
          scope: "firestore",
          tool: "prompts",
        });
        port.postMessage({
          payload: {
            detailRequestId: String(storeDetailRequestSequence),
            entryId: normalizedEntryId,
          },
          requestId: currentRequestId,
          type: "load-store-detail",
        });
      } catch (error) {
        pendingStoreDetailRequests.delete(normalizedEntryId);
        throw error;
      }
      return requestPromise.finally(() => {
        const pending = pendingStoreDetailRequests.get(normalizedEntryId);
        if (pending?.promise === requestPromise) {
          pendingStoreDetailRequests.delete(normalizedEntryId);
        }
      });
    }
    function normalizeDetailContent(value) {
      return String(value || "")
        .replace(/\r\n/g, "\n")
        .replace(/\u00a0/g, " ")
        .trim();
    }
    function buildEmptyAuthState() {
      return { expiresAt: "", firebaseCustomToken: "", promptFirestoreCollections: null, promptLibraryId: "", promptPanelScope: "", providerUserKey: "", runtimeKey: "" };
    }
    function scheduleIdentityRetry() {
      global.clearTimeout(identityRetryTimer);
      identityRetryTimer = global.setTimeout(() => scheduleSync(120), 900);
    }
    function logRealtimeError(error) {
      if (isInvalidatedContextError(error)) {
        hooks.render?.();
        return;
      }
      namespace.panelDebug?.log?.("prompt.panel.refresh.error", {
        error: error instanceof Error ? error.message : String(error || ""),
        scope: "runtime",
        tool: "prompts",
      });
      console.error("[i-Nova Bookmarks] prompt realtime refresh failed", error);
      hooks.render?.();
    }
    function isInvalidatedContextError(error) {
      const message = namespace.session.normalizeText(error instanceof Error ? error.message : String(error || ""));
      return message.includes("Extension context invalidated")
        || message.includes("확장프로그램이 갱신됐어요.");
    }
    async function sendRuntimeMessage(type, payload) {
      const metadata = classifyPromptRuntimeMetadata(type);
      namespace.panelDebug?.log?.("prompt.panel.runtime.request", {
        backend: metadata.backend,
        operation: metadata.operation,
        scope: "runtime",
        tool: "prompts",
        type,
      });
      try {
        const response = await global.chrome.runtime.sendMessage({
          type,
          ...(payload || {}),
        });
        if (!response?.ok) {
          throw new Error(namespace.session.normalizeText(response?.error || "") || "프롬프트 패널 요청을 처리하지 못했어요.");
        }
        namespace.panelDebug?.log?.("prompt.panel.runtime.success", {
          backend: metadata.backend,
          operation: metadata.operation,
          scope: "runtime",
          tool: "prompts",
          type,
        });
        return response.data;
      } catch (error) {
        namespace.panelDebug?.log?.("prompt.panel.runtime.error", {
          backend: metadata.backend,
          error: error instanceof Error ? error.message : String(error || ""),
          operation: metadata.operation,
          scope: "runtime",
          tool: "prompts",
          type,
        });
        throw error;
      }
    }
    function classifyPromptRuntimeMetadata(type) {
      const normalized = namespace.session.normalizeText(type);
      if (normalized === "inova-prompt:issue-panel-auth") {
        return {
          backend: "firebase-function",
          operation: "auth",
        };
      }
      return {
        backend: "",
        operation: "",
      };
    }
  }
  namespace.promptRealtimeManager = {
    create,
  };
})(globalThis);
