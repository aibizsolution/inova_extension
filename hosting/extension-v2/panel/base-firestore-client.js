(function initBaseFirestoreClient(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const {
    cloneValue,
    isAuthExpiring,
    normalizePanelTarget,
    normalizeText,
    readErrorMessage,
    resolveBrowserCapabilities,
  } = namespace.panelUtils;

  function createBaseFirestoreClient(config = {}) {
    const reader = normalizeText(config.reader);
    if (!reader) {
      throw new Error("Firestore reader 이름이 필요해요.");
    }
    const panel = normalizeText(config.panel) || "prompt";
    const authErrorMessage = normalizeText(config.authErrorMessage) || "Firestore 인증 정보를 준비하지 못했어요.";
    const missingIdentityMessage = normalizeText(config.missingIdentityMessage) || "사용자 정보를 찾지 못했어요.";
    const subscriptionErrorMessage = normalizeText(config.subscriptionErrorMessage) || "Firestore 구독이 끊겼어요.";
    const asyncErrorMessage = normalizeText(config.asyncErrorMessage) || "Firestore 처리를 마치지 못했어요.";
    const resetSubscriptionOnError = Boolean(config.resetSubscriptionOnError);

    return {
      create,
    };

    function create(options = {}) {
      const browserCapabilities = resolveBrowserCapabilities(options);
      const onError = typeof options.onError === "function"
        ? options.onError
        : async () => {};
      const onSnapshot = typeof options.onSnapshot === "function"
        ? options.onSnapshot
        : async () => {};
      const traceFirestore = typeof options.traceFirestore === "function"
        ? options.traceFirestore
        : () => {};
      const state = {
        lastSnapshot: null,
        lastSnapshotSignature: "",
        panelAuth: null,
        refreshSerial: 0,
        settleFirstSnapshot: null,
        subscribePromise: null,
        subscriptionKey: "",
        subscriptionSerial: 0,
        unsubscribe: null,
      };

      return {
        disconnect,
        ensureSubscribed,
        hasActiveSubscription,
      };

      async function ensureSubscribed(request = {}) {
        if (state.subscribePromise) {
          await state.subscribePromise.catch(() => null);
        }
        const run = subscribe(request);
        const tracked = run.finally(() => {
          if (state.subscribePromise === tracked) {
            state.subscribePromise = null;
          }
        });
        state.subscribePromise = tracked;
        return tracked;
      }

      async function subscribe(request = {}) {
        const providerIdentity = request?.providerIdentity && typeof request.providerIdentity === "object"
          ? request.providerIdentity
          : {};
        const providerUserKey = normalizeText(providerIdentity.providerUserKey);
        const requestedTarget = normalizePanelTarget(request?.settings?.meetingWorkspaceTarget);
        if (!providerUserKey) {
          throw new Error(missingIdentityMessage);
        }
        const requestContext = buildRequestContext(request, providerIdentity, providerUserKey, requestedTarget);

        const currentSnapshot = cloneValue(state.lastSnapshot);
        if (canReuseSubscription(providerUserKey, requestedTarget, currentSnapshot)) {
          traceFirestore("34.hosted.firestore.reuse", {
            count: readSnapshotCount(currentSnapshot),
            fromCache: Boolean(currentSnapshot.fromCache),
            reader,
            target: state.panelAuth.target,
          });
          return currentSnapshot;
        }

        const subscriptionSerial = state.subscriptionSerial + 1;
        state.subscriptionSerial = subscriptionSerial;
        const session = await ensureFirestoreSession({
          browserCapabilities,
          providerIdentity,
          purpose: reader,
          settings: request?.settings,
          target: requestedTarget,
          traceFirestore,
        });
        if (!isActiveSubscriptionAttempt(subscriptionSerial)) {
          return cloneValue(state.lastSnapshot || currentSnapshot || null);
        }
        const panelAuth = normalizePanelAuth(session.panelAuth, requestContext);
        const nextSubscriptionKey = buildSubscriptionKey(panelAuth, requestContext);
        state.panelAuth = panelAuth;

        disconnect("subscription-change", { preserveSubscriptionAttempt: true });
        if (!isActiveSubscriptionAttempt(subscriptionSerial)) {
          return cloneValue(state.lastSnapshot || currentSnapshot || null);
        }
        const target = config.createTarget?.({
          context: requestContext,
          panelAuth,
          session,
          state,
        });
        if (!target?.onSnapshot) {
          throw new Error("Firestore 구독 대상을 준비하지 못했어요.");
        }

        traceFirestore("34.hosted.firestore.listen.start", {
          ...buildListenTrace(panelAuth, requestContext),
          reader,
          target: panelAuth.target,
        });

        state.subscriptionKey = nextSubscriptionKey;
        let firstSnapshotSettled = false;
        let resolveFirstSnapshot = () => {};
        let rejectFirstSnapshot = () => {};
        const firstSnapshotPromise = new Promise((resolve, reject) => {
          resolveFirstSnapshot = resolve;
          rejectFirstSnapshot = reject;
        });

        const settleFirstSnapshot = (value, error) => {
          if (firstSnapshotSettled) {
            return;
          }
          firstSnapshotSettled = true;
          if (error) {
            rejectFirstSnapshot(error);
            return;
          }
          resolveFirstSnapshot(cloneValue(value));
        };
        state.settleFirstSnapshot = settleFirstSnapshot;

        try {
          const cacheSnapshot = await loadCachedSnapshot(target);
          if (!isActiveSubscriptionAttempt(subscriptionSerial)) {
            return cloneValue(state.lastSnapshot || currentSnapshot || null);
          }
          if (cacheSnapshot) {
            const normalizedSnapshot = await normalizeSnapshot(cacheSnapshot, {
              context: requestContext,
              panelAuth,
              session,
              state,
            });
            if (!isActiveSubscriptionAttempt(subscriptionSerial)) {
              return cloneValue(state.lastSnapshot || currentSnapshot || null);
            }
            if (normalizedSnapshot) {
              publishSnapshot(normalizedSnapshot);
              settleFirstSnapshot(normalizedSnapshot);
            }
          }
        } catch (error) {
          void error;
        }

        state.unsubscribe = target.onSnapshot(
          { includeMetadataChanges: true },
          (snapshot) => {
            if (!isActiveSubscription(subscriptionSerial, nextSubscriptionKey)) {
              return;
            }
            const liveContext = buildLiveContext(state);
            handleAsync((async () => {
              const normalizedSnapshot = await normalizeSnapshot(snapshot, {
                context: requestContext,
                liveContext,
                panelAuth,
                session,
                state,
              });
              if (!isActiveSubscription(subscriptionSerial, nextSubscriptionKey)) {
                return;
              }
              if (!normalizedSnapshot) {
                return;
              }
              publishSnapshot(normalizedSnapshot);
              settleFirstSnapshot(normalizedSnapshot);
            })(), {
              onError: (error) => settleFirstSnapshot(null, error),
            });
          },
          (error) => {
            if (!isActiveSubscription(subscriptionSerial, nextSubscriptionKey)) {
              return;
            }
            if (resetSubscriptionOnError) {
              state.unsubscribe = null;
              state.subscriptionKey = "";
            }
            const nextError = error instanceof Error
              ? error
              : new Error(readErrorMessage(error, subscriptionErrorMessage));
            handleAsync(onError(nextError));
            traceFirestore("35.hosted.firestore.error", {
              error: nextError.message,
              reader,
              target: panelAuth.target,
            });
            settleFirstSnapshot(null, nextError);
          }
        );

        return firstSnapshotPromise.finally(() => {
          if (state.settleFirstSnapshot === settleFirstSnapshot) {
            state.settleFirstSnapshot = null;
          }
        });
      }

      function disconnect(reason, options = {}) {
        if (!options.preserveSubscriptionAttempt) {
          state.subscriptionSerial += 1;
          const settleFirstSnapshot = state.settleFirstSnapshot;
          state.settleFirstSnapshot = null;
          if (typeof settleFirstSnapshot === "function") {
            settleFirstSnapshot(cloneValue(state.lastSnapshot), null);
          }
        }
        const hadConnection = typeof state.unsubscribe === "function"
          || Boolean(state.subscriptionKey)
          || Boolean(state.lastSnapshotSignature);
        if (!hadConnection) {
          return;
        }
        if (typeof state.unsubscribe === "function") {
          state.unsubscribe();
        }
        state.unsubscribe = null;
        state.subscriptionKey = "";
        state.lastSnapshotSignature = "";
        traceFirestore("34.hosted.firestore.disconnect", {
          reader,
          reason: normalizeText(reason) || "manual",
        });
      }

      function hasActiveSubscription() {
        return typeof state.unsubscribe === "function" && Boolean(state.subscriptionKey);
      }

      function isActiveSubscriptionAttempt(subscriptionSerial) {
        return subscriptionSerial === state.subscriptionSerial;
      }

      function isActiveSubscription(subscriptionSerial, subscriptionKey) {
        return Boolean(
          isActiveSubscriptionAttempt(subscriptionSerial)
          && state.subscriptionKey === subscriptionKey
        );
      }

      function canReuseSubscription(providerUserKey, requestedTarget, currentSnapshot) {
        return Boolean(
          state.panelAuth
          && state.panelAuth.providerUserKey === providerUserKey
          && state.panelAuth.target === requestedTarget
          && !isAuthExpiring(state.panelAuth.expiresAt)
          && typeof state.unsubscribe === "function"
          && state.subscriptionKey
          && currentSnapshot
        );
      }

      async function ensureFirestoreSession(request = {}) {
        if (!namespace.panelFirestoreSessionClient?.ensureSession) {
          throw new Error("공용 Firestore session coordinator를 준비하지 못했어요.");
        }
        return namespace.panelFirestoreSessionClient.ensureSession({
          browserCapabilities: request.browserCapabilities,
          panel,
          providerIdentity: request.providerIdentity,
          purpose: request.purpose,
          settings: request.settings,
          target: request.target,
          traceFirestore: request.traceFirestore,
        });
      }

      async function loadCachedSnapshot(target) {
        if (!target?.get) {
          return null;
        }
        try {
          const snapshot = await target.get({ source: "cache" });
          return shouldUseCachedSnapshot(snapshot) ? snapshot : null;
        } catch {
          return null;
        }
      }

      function publishSnapshot(snapshot) {
        const nextSignature = buildSnapshotSignature(snapshot);
        if (nextSignature && nextSignature === state.lastSnapshotSignature) {
          return;
        }
        state.lastSnapshot = cloneValue(snapshot);
        state.lastSnapshotSignature = nextSignature;
        traceFirestore("35.hosted.firestore.snapshot", {
          count: readSnapshotCount(snapshot),
          fromCache: Boolean(snapshot?.fromCache),
          hasPendingWrites: Boolean(snapshot?.hasPendingWrites),
          reader,
          source: snapshot?.fromCache ? "cache" : "server",
        });
        handleAsync(onSnapshot(cloneValue(snapshot)));
      }

      function handleAsync(task, options = {}) {
        Promise.resolve(task).catch((error) => {
          const nextError = error instanceof Error
            ? error
            : new Error(readErrorMessage(error, asyncErrorMessage));
          if (typeof options.onError === "function") {
            options.onError(nextError);
          }
          traceFirestore("35.hosted.firestore.error", {
            error: readErrorMessage(nextError, asyncErrorMessage),
            reader,
          });
        });
      }
    }

    function buildRequestContext(request, providerIdentity, providerUserKey, requestedTarget) {
      if (typeof config.buildRequestContext === "function") {
        return config.buildRequestContext({
          providerIdentity,
          providerUserKey,
          request,
          target: requestedTarget,
        }) || {};
      }
      return {
        providerIdentity,
        providerUserKey,
        target: requestedTarget,
      };
    }

    function normalizePanelAuth(input, context) {
      if (typeof config.normalizePanelAuth === "function") {
        return config.normalizePanelAuth(input, context);
      }
      throw new Error(authErrorMessage);
    }

    function buildSubscriptionKey(panelAuth, context) {
      if (typeof config.buildSubscriptionKey === "function") {
        return config.buildSubscriptionKey(panelAuth, context);
      }
      return [
        panelAuth?.providerUserKey,
        panelAuth?.target,
        panelAuth?.expiresAt,
      ].map(normalizeText).join("::");
    }

    function buildListenTrace(panelAuth, context) {
      if (typeof config.buildListenTrace === "function") {
        return config.buildListenTrace(panelAuth, context) || {};
      }
      return {};
    }

    function buildLiveContext(state) {
      if (typeof config.buildLiveContext === "function") {
        return config.buildLiveContext(state) || {};
      }
      return {};
    }

    async function normalizeSnapshot(snapshot, context) {
      if (typeof config.normalizeSnapshot === "function") {
        return config.normalizeSnapshot(snapshot, context);
      }
      return null;
    }

    function shouldUseCachedSnapshot(snapshot) {
      if (typeof config.shouldUseCachedSnapshot === "function") {
        return config.shouldUseCachedSnapshot(snapshot);
      }
      return Boolean(snapshot);
    }

    function buildSnapshotSignature(snapshot) {
      if (typeof config.buildSnapshotSignature === "function") {
        return config.buildSnapshotSignature(snapshot);
      }
      return JSON.stringify(snapshot || {});
    }

    function readSnapshotCount(snapshot) {
      if (typeof config.readSnapshotCount === "function") {
        return config.readSnapshotCount(snapshot);
      }
      return Array.isArray(snapshot?.items) ? snapshot.items.length : 0;
    }
  }

  namespace.baseFirestoreClient = Object.freeze({
    createBaseFirestoreClient,
  });
})(globalThis);
