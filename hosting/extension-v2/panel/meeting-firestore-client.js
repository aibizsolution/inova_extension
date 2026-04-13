(function initMeetingFirestoreClient(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const APP_NAME = "inova-hosted-panel-meeting";
  const FIREBASE_VERSION = "10.12.5";
  const FIRESTORE_PERSISTENCE_OPTIONS = { synchronizeTabs: true };
  const SDK_SOURCES = Object.freeze([
    `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app-compat.js`,
    `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth-compat.js`,
    `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore-compat.js`,
  ]);

  function create(options = {}) {
    const invokeRuntime = typeof options.invokeRuntime === "function"
      ? options.invokeRuntime
      : async () => ({});
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
      app: null,
      auth: null,
      db: null,
      lastSnapshot: null,
      lastSnapshotSignature: "",
      panelAuth: null,
      persistencePromise: null,
      runtimeKey: "",
      sdkPromise: null,
      subscriptionKey: "",
      unsubscribe: null,
    };

    return {
      disconnect,
      ensureSubscribed,
    };

    async function ensureSubscribed(request = {}) {
      const providerIdentity = request?.providerIdentity && typeof request.providerIdentity === "object"
        ? request.providerIdentity
        : {};
      const providerUserKey = normalizeText(providerIdentity.providerUserKey);
      const requestedTarget = normalizeMeetingTarget(request?.settings?.meetingWorkspaceTarget);
      const queryLimit = Math.max(1, Math.min(24, Number(request?.queryLimit) || 24));
      if (!providerUserKey) {
        throw new Error("회의 사용자 정보를 찾지 못했어요.");
      }

      const currentSnapshot = cloneValue(state.lastSnapshot);
      const canReusePanelAuth = Boolean(
        state.panelAuth
        && state.panelAuth.providerUserKey === providerUserKey
        && state.panelAuth.target === requestedTarget
        && !isAuthExpiring(state.panelAuth.expiresAt)
      );
      if (
        canReusePanelAuth
        && typeof state.unsubscribe === "function"
        && state.subscriptionKey
        && currentSnapshot
      ) {
        traceFirestore("34.hosted.firestore.reuse", {
          count: Array.isArray(currentSnapshot.items) ? currentSnapshot.items.length : 0,
          fromCache: Boolean(currentSnapshot.fromCache),
          target: state.panelAuth.target,
        });
        return currentSnapshot;
      }

      const panelAuth = canReusePanelAuth
        ? state.panelAuth
        : normalizePanelAuth(
          await invokeRuntime({
            action: "auth.issue-meeting-panel",
            providerIdentity,
          })
        );
      const nextSubscriptionKey = buildSubscriptionKey(panelAuth, queryLimit);
      state.panelAuth = panelAuth;

      if (shouldResetServices(panelAuth)) {
        await resetServices("runtime-change");
        state.panelAuth = panelAuth;
      } else {
        disconnect("subscription-change");
      }

      const services = await ensureServices(panelAuth);
      await ensurePanelSession(services.auth, panelAuth);
      const query = services.db
        .collection("integration_inova_meetings")
        .where("owner.providerUserKey", "==", panelAuth.providerUserKey)
        .orderBy("updatedAt", "desc")
        .limit(queryLimit);

      traceFirestore("34.hosted.firestore.listen.start", {
        limit: queryLimit,
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

      try {
        const cacheSnapshot = await loadCachedSnapshot(query);
        if (cacheSnapshot) {
          const normalizedSnapshot = normalizeQuerySnapshot(cacheSnapshot);
          publishSnapshot(normalizedSnapshot);
          settleFirstSnapshot(normalizedSnapshot);
        }
      } catch (error) {
        void error;
      }

      state.unsubscribe = query.onSnapshot(
        { includeMetadataChanges: true },
        (snapshot) => {
          const normalizedSnapshot = normalizeQuerySnapshot(snapshot);
          publishSnapshot(normalizedSnapshot);
          settleFirstSnapshot(normalizedSnapshot);
        },
        (error) => {
          const nextError = error instanceof Error
            ? error
            : new Error(readErrorMessage(error, "회의 목록 Firestore 구독이 끊겼어요."));
          handleAsync(onError(nextError));
          traceFirestore("35.hosted.firestore.error", {
            error: nextError.message,
            target: panelAuth.target,
          });
          settleFirstSnapshot(null, nextError);
        }
      );

      return firstSnapshotPromise;
    }

    function disconnect(reason) {
      if (typeof state.unsubscribe === "function") {
        state.unsubscribe();
      }
      state.unsubscribe = null;
      state.subscriptionKey = "";
      state.lastSnapshotSignature = "";
      traceFirestore("34.hosted.firestore.disconnect", {
        reason: normalizeText(reason) || "manual",
      });
    }

    async function ensureServices(panelAuth) {
      const firebase = await ensureFirebaseSdk();
      if (state.app && state.auth && state.db) {
        return {
          app: state.app,
          auth: state.auth,
          db: state.db,
          firebase,
        };
      }
      const existingApp = Array.isArray(firebase.apps)
        ? firebase.apps.find((entry) => normalizeText(entry?.name) === APP_NAME)
        : null;
      state.app = existingApp || firebase.initializeApp(panelAuth.firebaseConfig, APP_NAME);
      state.auth = state.app.auth();
      state.db = state.app.firestore();
      configureFirebaseEmulators(panelAuth);
      await ensureFirestorePersistence();
      if (firebase?.auth?.Auth?.Persistence?.SESSION) {
        await state.auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
      }
      state.runtimeKey = buildRuntimeKey(panelAuth);
      return {
        app: state.app,
        auth: state.auth,
        db: state.db,
        firebase,
      };
    }

    async function ensureFirebaseSdk() {
      if (global.firebase?.initializeApp) {
        return global.firebase;
      }
      if (state.sdkPromise) {
        return state.sdkPromise;
      }
      state.sdkPromise = SDK_SOURCES.reduce(
        (promise, src) => promise.then(() => loadScript(src)),
        Promise.resolve()
      ).then(() => {
        if (!global.firebase?.initializeApp) {
          throw new Error("Firebase SDK를 불러오지 못했어요.");
        }
        return global.firebase;
      }).catch((error) => {
        state.sdkPromise = null;
        throw error;
      });
      return state.sdkPromise;
    }

    async function ensurePanelSession(auth, panelAuth) {
      const currentUser = auth?.currentUser || null;
      const expectedPanelExpMs = Math.max(0, Date.parse(panelAuth.expiresAt) || 0);
      if (!currentUser) {
        traceFirestore("34.hosted.firestore.auth.sign-in", {
          target: panelAuth.target,
        });
        await auth.signInWithCustomToken(panelAuth.firebaseCustomToken);
        return;
      }
      try {
        const tokenResult = await currentUser.getIdTokenResult();
        const claims = tokenResult?.claims && typeof tokenResult.claims === "object"
          ? tokenResult.claims
          : {};
        const sameProviderUserKey = normalizeText(claims.providerUserKey) === panelAuth.providerUserKey;
        const sameScope = normalizeText(claims.scope) === "meeting-panel";
        const activePanelExpMs = Math.max(0, Number(claims.panelExpMs) || 0);
        if (sameProviderUserKey && sameScope && activePanelExpMs >= expectedPanelExpMs) {
          traceFirestore("34.hosted.firestore.auth.reuse", {
            target: panelAuth.target,
          });
          await currentUser.getIdToken();
          return;
        }
      } catch (error) {
        void error;
      }
      traceFirestore("34.hosted.firestore.auth.refresh", {
        target: panelAuth.target,
      });
      await auth.signInWithCustomToken(panelAuth.firebaseCustomToken);
    }

    function configureFirebaseEmulators(panelAuth) {
      const emulators = panelAuth?.emulators && typeof panelAuth.emulators === "object"
        ? panelAuth.emulators
        : {};
      if (!emulators.enabled) {
        return;
      }
      if (typeof state.auth?.useEmulator === "function") {
        state.auth.useEmulator(normalizeText(emulators.authUrl));
      }
      if (typeof state.db?.useEmulator === "function") {
        state.db.useEmulator(
          normalizeText(emulators.firestoreHost),
          Number(emulators.firestorePort) || 8080
        );
      }
    }

    async function ensureFirestorePersistence() {
      if (!state.db?.enablePersistence) {
        return;
      }
      if (state.persistencePromise) {
        return state.persistencePromise;
      }
      state.persistencePromise = state.db.enablePersistence(FIRESTORE_PERSISTENCE_OPTIONS).catch((error) => {
        const code = normalizeText(error?.code);
        if (code !== "failed-precondition" && code !== "unimplemented") {
          throw error;
        }
      });
      return state.persistencePromise;
    }

    async function loadCachedSnapshot(query) {
      if (!query?.get) {
        return null;
      }
      try {
        const snapshot = await query.get({ source: "cache" });
        const docs = Array.isArray(snapshot?.docs) ? snapshot.docs : [];
        return docs.length ? snapshot : null;
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
        count: Array.isArray(snapshot?.items) ? snapshot.items.length : 0,
        fromCache: Boolean(snapshot?.fromCache),
        hasPendingWrites: Boolean(snapshot?.hasPendingWrites),
        source: snapshot?.fromCache ? "cache" : "server",
      });
      handleAsync(onSnapshot(cloneValue(snapshot)));
    }

    async function resetServices(reason) {
      disconnect(reason);
      const currentApp = state.app;
      state.app = null;
      state.auth = null;
      state.db = null;
      state.persistencePromise = null;
      state.panelAuth = null;
      state.runtimeKey = "";
      if (currentApp && typeof currentApp.delete === "function") {
        try {
          await currentApp.delete();
        } catch (error) {
          void error;
        }
      }
    }

    function shouldResetServices(panelAuth) {
      if (!state.app) {
        return false;
      }
      return state.runtimeKey !== buildRuntimeKey(panelAuth);
    }

    function normalizePanelAuth(input) {
      const panelAuth = input && typeof input === "object" ? input : {};
      const firebaseConfig = panelAuth.firebaseConfig && typeof panelAuth.firebaseConfig === "object"
        ? { ...panelAuth.firebaseConfig }
        : {};
      const emulators = panelAuth.emulators && typeof panelAuth.emulators === "object"
        ? { ...panelAuth.emulators }
        : {};
      const normalized = {
        emulators: {
          authUrl: normalizeText(emulators.authUrl),
          enabled: Boolean(emulators.enabled),
          firestoreHost: normalizeText(emulators.firestoreHost),
          firestorePort: Number(emulators.firestorePort) || 0,
        },
        expiresAt: normalizeText(panelAuth.expiresAt),
        firebaseConfig,
        firebaseCustomToken: normalizeText(panelAuth.firebaseCustomToken),
        providerUserKey: normalizeText(panelAuth.providerUserKey),
        target: normalizeText(panelAuth.target).toLowerCase() === "local" ? "local" : "production",
      };
      if (!normalized.providerUserKey || !normalized.firebaseCustomToken || !normalized.firebaseConfig.projectId) {
        throw new Error("회의 목록 Firestore 인증 정보를 준비하지 못했어요.");
      }
      return normalized;
    }

    function normalizeQuerySnapshot(snapshot) {
      return {
        checkedAt: new Date().toISOString(),
        fromCache: Boolean(snapshot?.metadata?.fromCache),
        hasPendingWrites: Boolean(snapshot?.metadata?.hasPendingWrites),
        items: (Array.isArray(snapshot?.docs) ? snapshot.docs : []).map(serializeDocument),
      };
    }

    function serializeDocument(doc) {
      const data = doc?.data && typeof doc.data === "function" ? doc.data() : {};
      const share = normalizeShareMetadata(data?.share);
      return {
        ...cloneValue(data),
        docId: normalizeText(doc?.id),
        share,
      };
    }

    function normalizeShareMetadata(input) {
      const share = input && typeof input === "object" ? input : {};
      const status = normalizeText(share.status);
      const shareId = normalizeText(share.shareId);
      return {
        ...cloneValue(share),
        active: status === "active" && Boolean(shareId),
        createdAt: normalizeText(share.createdAt),
        createdBy: share.createdBy && typeof share.createdBy === "object" ? cloneValue(share.createdBy) : {},
        revokedAt: normalizeText(share.revokedAt),
        shareId,
        status,
      };
    }

    function buildSnapshotSignature(snapshot) {
      return JSON.stringify({
        docs: (Array.isArray(snapshot?.items) ? snapshot.items : []).map((item) => [
          normalizeText(item?.meetingId),
          normalizeText(item?.updatedAt || item?.createdAt),
          normalizeText(item?.status),
          normalizeText(item?.share?.status),
          normalizeText(item?.share?.shareId),
          normalizeText(item?.share?.revokedAt),
        ].join("~")),
        fromCache: Boolean(snapshot?.fromCache),
        hasPendingWrites: Boolean(snapshot?.hasPendingWrites),
      });
    }

    function buildSubscriptionKey(panelAuth, queryLimit) {
      return [
        buildRuntimeKey(panelAuth),
        panelAuth.providerUserKey,
        panelAuth.expiresAt,
        String(queryLimit),
      ].join("::");
    }

    function buildRuntimeKey(panelAuth) {
      return JSON.stringify({
        authUrl: normalizeText(panelAuth?.emulators?.authUrl),
        enabled: Boolean(panelAuth?.emulators?.enabled),
        firestoreHost: normalizeText(panelAuth?.emulators?.firestoreHost),
        firestorePort: Number(panelAuth?.emulators?.firestorePort) || 0,
        projectId: normalizeText(panelAuth?.firebaseConfig?.projectId),
        target: normalizeText(panelAuth?.target),
      });
    }

    function handleAsync(task) {
      Promise.resolve(task).catch((error) => {
        traceFirestore("35.hosted.firestore.error", {
          error: readErrorMessage(error, "회의 목록 Firestore 처리를 마치지 못했어요."),
        });
      });
    }

    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const script = global.document.createElement("script");
        script.src = src;
        script.async = false;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`스크립트를 불러오지 못했어요: ${src}`));
        global.document.head.appendChild(script);
      });
    }
  }

  function readErrorMessage(error, fallbackMessage) {
    const message = normalizeText(error instanceof Error ? error.message : error);
    return message || fallbackMessage;
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
  }

  function normalizeMeetingTarget(value) {
    return normalizeText(value).toLowerCase() === "local" ? "local" : "production";
  }

  function isAuthExpiring(expiresAt) {
    const expiryTime = Date.parse(normalizeText(expiresAt));
    return !(expiryTime > Date.now() + 60000);
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  namespace.meetingFirestoreClient = { create };
})(globalThis);
