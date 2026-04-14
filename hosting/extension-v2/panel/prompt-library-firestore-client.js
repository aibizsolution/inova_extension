(function initPromptLibraryFirestoreClient(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const APP_NAME = "inova-hosted-panel-prompt-library";
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
      refreshSerial: 0,
      runtimeKey: "",
      sdkPromise: null,
      subscriptionKey: "",
      unsubscribe: null,
    };

    return {
      disconnect,
      ensureSubscribed,
      hasActiveSubscription,
    };

    async function ensureSubscribed(request = {}) {
      const providerIdentity = request?.providerIdentity && typeof request.providerIdentity === "object"
        ? request.providerIdentity
        : {};
      const providerUserKey = normalizeText(providerIdentity.providerUserKey);
      const requestedTarget = normalizePanelTarget(request?.settings?.meetingWorkspaceTarget);
      if (!providerUserKey) {
        throw new Error("프롬프트 사용자 정보를 찾지 못했어요.");
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
          count: Array.isArray(currentSnapshot.promptLibrary?.items) ? currentSnapshot.promptLibrary.items.length : 0,
          fromCache: Boolean(currentSnapshot.fromCache),
          target: state.panelAuth.target,
        });
        return currentSnapshot;
      }

      const panelAuth = canReusePanelAuth
        ? state.panelAuth
        : normalizePanelAuth(
          await invokeRuntime({
            action: "auth.issue-panel-session",
            panel: "prompt",
            providerIdentity,
          })
        );
      const nextSubscriptionKey = buildSubscriptionKey(panelAuth);
      state.panelAuth = panelAuth;

      if (shouldResetServices(panelAuth)) {
        await resetServices("runtime-change");
        state.panelAuth = panelAuth;
      } else {
        disconnect("subscription-change");
      }

      const services = await ensureServices(panelAuth);
      await ensurePanelSession(services.auth, panelAuth);
      const accountRef = services.db
        .collection(panelAuth.promptFirestoreCollections.accountsCollection)
        .doc(panelAuth.providerUserKey);

      traceFirestore("34.hosted.firestore.listen.start", {
        collection: panelAuth.promptFirestoreCollections.accountsCollection,
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
        const cacheSnapshot = await loadCachedSnapshot(accountRef);
        if (cacheSnapshot) {
          const normalizedSnapshot = await normalizeAccountSnapshot(services.db, cacheSnapshot, panelAuth);
          publishSnapshot(normalizedSnapshot);
          settleFirstSnapshot(normalizedSnapshot);
        }
      } catch (error) {
        void error;
      }

      state.unsubscribe = accountRef.onSnapshot(
        { includeMetadataChanges: true },
        (snapshot) => {
          const refreshSerial = ++state.refreshSerial;
          handleAsync((async () => {
            const normalizedSnapshot = await normalizeAccountSnapshot(services.db, snapshot, panelAuth, refreshSerial);
            if (!normalizedSnapshot) {
              return;
            }
            publishSnapshot(normalizedSnapshot);
            settleFirstSnapshot(normalizedSnapshot);
          })());
        },
        (error) => {
          const nextError = error instanceof Error
            ? error
            : new Error(readErrorMessage(error, "프롬프트 보관함 Firestore 구독이 끊겼어요."));
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
        reason: normalizeText(reason) || "manual",
      });
    }

    function hasActiveSubscription() {
      return typeof state.unsubscribe === "function" && Boolean(state.subscriptionKey);
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
      if (shouldUseEphemeralAuthSession(panelAuth)) {
        clearStoredAuthSession(panelAuth.firebaseConfig, APP_NAME);
      }
      state.app = existingApp || firebase.initializeApp(panelAuth.firebaseConfig, APP_NAME);
      state.auth = state.app.auth();
      state.db = state.app.firestore();
      configureFirebaseEmulators(panelAuth);
      await ensureFirestorePersistence();
      const authPersistence = resolveAuthPersistence(firebase, panelAuth);
      if (authPersistence) {
        await state.auth.setPersistence(authPersistence);
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
        const sameScope = normalizeText(claims.scope) === panelAuth.promptPanelScope;
        const activePanelExpMs = Math.max(0, Number(claims.promptPanelExpMs) || 0);
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
      state.persistencePromise = runWithSuppressedFirestorePersistenceWarning(() =>
        state.db.enablePersistence(FIRESTORE_PERSISTENCE_OPTIONS)
      ).catch((error) => {
        const code = normalizeText(error?.code);
        if (code !== "failed-precondition" && code !== "unimplemented") {
          throw error;
        }
      });
      return state.persistencePromise;
    }

    function resolveAuthPersistence(firebase, panelAuth) {
      const persistence = firebase?.auth?.Auth?.Persistence;
      if (!persistence) {
        return "";
      }
      if (shouldUseEphemeralAuthSession(panelAuth)) {
        return persistence.NONE || "";
      }
      return persistence.SESSION || "";
    }

    function shouldUseEphemeralAuthSession(panelAuth) {
      return Boolean(panelAuth?.emulators?.enabled)
        || normalizeText(panelAuth?.target).toLowerCase() === "local";
    }

    function clearStoredAuthSession(firebaseConfig, appName) {
      const apiKey = normalizeText(firebaseConfig?.apiKey);
      const normalizedAppName = normalizeText(appName);
      if (!apiKey || !normalizedAppName) {
        return;
      }
      clearStoredAuthSessionEntries(global.sessionStorage, apiKey, normalizedAppName);
      clearStoredAuthSessionEntries(global.localStorage, apiKey, normalizedAppName);
    }

    function clearStoredAuthSessionEntries(storage, apiKey, appName) {
      if (!storage || typeof storage.length !== "number" || typeof storage.key !== "function") {
        return;
      }
      const keysToRemove = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = normalizeText(storage.key(index));
        if (shouldClearStoredAuthSessionKey(key, apiKey, appName)) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        try {
          storage.removeItem(key);
        } catch {
          // Ignore storage cleanup failures and continue with a fresh sign-in attempt.
        }
      }
    }

    function shouldClearStoredAuthSessionKey(key, apiKey, appName) {
      return key.startsWith("firebase:")
        && key.includes(apiKey)
        && key.includes(appName);
    }

    async function loadCachedSnapshot(accountRef) {
      if (!accountRef?.get) {
        return null;
      }
      try {
        return await accountRef.get({ source: "cache" });
      } catch {
        return null;
      }
    }

    async function normalizeAccountSnapshot(db, snapshot, panelAuth, refreshSerial = state.refreshSerial) {
      const data = snapshot?.data && typeof snapshot.data === "function"
        ? snapshot.data()
        : {};
      const promptLibraryMeta = normalizePromptLibraryMeta(data?.promptLibraryMeta);
      const promptLibraryId = normalizeText(data?.promptLibraryId || panelAuth.promptLibraryId);
      const promptLibrary = await loadPromptLibraryDocuments(db, panelAuth, promptLibraryId, promptLibraryMeta);
      if (refreshSerial !== state.refreshSerial && state.refreshSerial !== 0) {
        return null;
      }
      return {
        checkedAt: new Date().toISOString(),
        fromCache: Boolean(snapshot?.metadata?.fromCache) || Boolean(promptLibrary.fromCache),
        hasPendingWrites: Boolean(snapshot?.metadata?.hasPendingWrites) || Boolean(promptLibrary.hasPendingWrites),
        promptLibrary: {
          itemCount: promptLibrary.itemCount,
          items: promptLibrary.items,
          updatedAt: promptLibrary.updatedAt,
          version: promptLibrary.version,
        },
        promptLibraryId,
        promptLibraryMeta,
      };
    }

    async function loadPromptLibraryDocuments(db, panelAuth, promptLibraryId, promptLibraryMeta) {
      const version = Math.max(1, Number(promptLibraryMeta?.version) || 1);
      if (!promptLibraryId) {
        return {
          fromCache: false,
          hasPendingWrites: false,
          itemCount: 0,
          items: [],
          updatedAt: normalizeText(promptLibraryMeta?.updatedAt),
          version,
        };
      }

      const orderRef = db
        .collection(panelAuth.promptFirestoreCollections.promptLibraryOrdersCollection)
        .doc(promptLibraryId);
      const chunkRefs = normalizeBucketIds(promptLibraryMeta?.bucketIds).map((bucketId) => db
        .collection(panelAuth.promptFirestoreCollections.promptLibraryChunksCollection)
        .doc(`${promptLibraryId}__${bucketId}`));
      const [orderSnapshot, ...chunkSnapshots] = await Promise.all([
        orderRef.get(),
        ...chunkRefs.map((chunkRef) => chunkRef.get()),
      ]);

      const orderedIds = normalizeOrderedIds(orderSnapshot?.data?.()?.orderedIds);
      const itemMap = new Map();
      for (const chunkSnapshot of chunkSnapshots) {
        for (const item of normalizePromptItems(chunkSnapshot?.data?.()?.items)) {
          itemMap.set(item.id, item);
        }
      }

      const items = [];
      for (const orderedId of orderedIds) {
        const item = itemMap.get(orderedId);
        if (!item) {
          continue;
        }
        items.push(item);
        itemMap.delete(orderedId);
      }

      const remainingItems = Array.from(itemMap.values()).sort((left, right) =>
        normalizeText(right?.updatedAt).localeCompare(normalizeText(left?.updatedAt))
      );
      const mergedLibrary = mergePromptLibrary({
        items: [...items, ...remainingItems],
        version,
      });
      return {
        fromCache: Boolean(orderSnapshot?.metadata?.fromCache)
          || chunkSnapshots.some((entry) => Boolean(entry?.metadata?.fromCache)),
        hasPendingWrites: Boolean(orderSnapshot?.metadata?.hasPendingWrites)
          || chunkSnapshots.some((entry) => Boolean(entry?.metadata?.hasPendingWrites)),
        itemCount: mergedLibrary.items.length,
        items: mergedLibrary.items,
        updatedAt: normalizeText(promptLibraryMeta?.updatedAt) || getLatestUpdatedAt(mergedLibrary.items),
        version,
      };
    }

    function publishSnapshot(snapshot) {
      const nextSignature = buildSnapshotSignature(snapshot);
      if (nextSignature && nextSignature === state.lastSnapshotSignature) {
        return;
      }
      state.lastSnapshot = cloneValue(snapshot);
      state.lastSnapshotSignature = nextSignature;
      traceFirestore("35.hosted.firestore.snapshot", {
        count: Array.isArray(snapshot?.promptLibrary?.items) ? snapshot.promptLibrary.items.length : 0,
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
      const promptFirestoreCollections = panelAuth.promptFirestoreCollections && typeof panelAuth.promptFirestoreCollections === "object"
        ? { ...panelAuth.promptFirestoreCollections }
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
        promptFirestoreCollections: {
          accountsCollection: normalizeText(promptFirestoreCollections.accountsCollection),
          promptLibraryChunksCollection: normalizeText(promptFirestoreCollections.promptLibraryChunksCollection),
          promptLibraryOrdersCollection: normalizeText(promptFirestoreCollections.promptLibraryOrdersCollection),
        },
        promptLibraryId: normalizeText(panelAuth.promptLibraryId),
        promptPanelScope: normalizeText(panelAuth.promptPanelScope) || "prompt-panel",
        providerUserKey: normalizeText(panelAuth.providerUserKey),
        target: normalizeText(panelAuth.target).toLowerCase() === "local" ? "local" : "production",
      };
      if (
        !normalized.providerUserKey
        || !normalized.promptLibraryId
        || !normalized.firebaseCustomToken
        || !normalized.firebaseConfig.projectId
        || !normalized.promptFirestoreCollections.accountsCollection
        || !normalized.promptFirestoreCollections.promptLibraryChunksCollection
        || !normalized.promptFirestoreCollections.promptLibraryOrdersCollection
      ) {
        throw new Error("프롬프트 보관함 Firestore 인증 정보를 준비하지 못했어요.");
      }
      return normalized;
    }

    function buildSnapshotSignature(snapshot) {
      return JSON.stringify({
        docs: (Array.isArray(snapshot?.promptLibrary?.items) ? snapshot.promptLibrary.items : []).map((item) => [
          normalizeText(item?.id),
          normalizeText(item?.updatedAt || item?.createdAt),
          normalizeText(item?.title),
        ].join("~")),
        fromCache: Boolean(snapshot?.fromCache),
        hasPendingWrites: Boolean(snapshot?.hasPendingWrites),
        lastRevision: normalizeText(snapshot?.promptLibraryMeta?.lastRevision),
      });
    }

    function buildSubscriptionKey(panelAuth) {
      return [
        buildRuntimeKey(panelAuth),
        panelAuth.providerUserKey,
        panelAuth.promptLibraryId,
        panelAuth.expiresAt,
      ].join("::");
    }

    function buildRuntimeKey(panelAuth) {
      return JSON.stringify({
        accountsCollection: normalizeText(panelAuth?.promptFirestoreCollections?.accountsCollection),
        authUrl: normalizeText(panelAuth?.emulators?.authUrl),
        chunksCollection: normalizeText(panelAuth?.promptFirestoreCollections?.promptLibraryChunksCollection),
        enabled: Boolean(panelAuth?.emulators?.enabled),
        firestoreHost: normalizeText(panelAuth?.emulators?.firestoreHost),
        firestorePort: Number(panelAuth?.emulators?.firestorePort) || 0,
        ordersCollection: normalizeText(panelAuth?.promptFirestoreCollections?.promptLibraryOrdersCollection),
        projectId: normalizeText(panelAuth?.firebaseConfig?.projectId),
        scope: normalizeText(panelAuth?.promptPanelScope),
        target: normalizeText(panelAuth?.target),
      });
    }

    function handleAsync(task) {
      Promise.resolve(task).catch((error) => {
        traceFirestore("35.hosted.firestore.error", {
          error: readErrorMessage(error, "프롬프트 보관함 Firestore 처리를 마치지 못했어요."),
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

    async function runWithSuppressedFirestorePersistenceWarning(task) {
      if (typeof task !== "function") {
        return null;
      }
      const consoleRef = global.console;
      const originalWarn = typeof consoleRef?.warn === "function" ? consoleRef.warn : null;
      if (!originalWarn) {
        return task();
      }
      consoleRef.warn = function patchedFirestoreWarn(...args) {
        if (shouldSuppressFirestorePersistenceWarning(args)) {
          return;
        }
        return originalWarn.apply(this, args);
      };
      try {
        return await task();
      } finally {
        consoleRef.warn = originalWarn;
      }
    }

    function shouldSuppressFirestorePersistenceWarning(args) {
      const text = args
        .map((value) => normalizeText(typeof value === "string" ? value : value?.message || value))
        .join(" ");
      return text.includes("enableMultiTabIndexedDbPersistence()")
        || text.includes("enableIndexedDbPersistence()")
        || text.includes("FirestoreSettings.cache");
    }
  }

  function normalizePromptLibraryMeta(promptLibraryMeta) {
    return {
      bucketIds: normalizeBucketIds(promptLibraryMeta?.bucketIds),
      itemCount: Math.max(0, Number(promptLibraryMeta?.itemCount) || 0),
      lastRevision: normalizeText(promptLibraryMeta?.lastRevision),
      lastSyncedAt: normalizeText(promptLibraryMeta?.lastSyncedAt),
      updatedAt: normalizeText(promptLibraryMeta?.updatedAt),
      version: Math.max(1, Number(promptLibraryMeta?.version) || 1),
    };
  }

  function normalizePromptItems(items) {
    return mergePromptLibrary({ items: Array.isArray(items) ? items : [] }).items;
  }

  function mergePromptLibrary(promptLibrary) {
    return namespace.promptLibraryModel?.mergePromptLibrary?.(promptLibrary) || {
      items: Array.isArray(promptLibrary?.items) ? promptLibrary.items.slice() : [],
      version: Math.max(1, Number(promptLibrary?.version) || 1),
    };
  }

  function normalizeOrderedIds(orderedIds) {
    return Array.from(new Set((orderedIds || []).map((orderedId) => normalizeText(orderedId)).filter(Boolean)));
  }

  function normalizeBucketIds(bucketIds) {
    return Array.from(new Set((bucketIds || []).map((bucketId) => normalizeText(bucketId)).filter(Boolean))).sort();
  }

  function getLatestUpdatedAt(items) {
    let latest = "";
    for (const item of items || []) {
      const updatedAt = normalizeText(item?.updatedAt);
      if (updatedAt && (!latest || updatedAt > latest)) {
        latest = updatedAt;
      }
    }
    return latest;
  }

  function readErrorMessage(error, fallbackMessage) {
    const message = normalizeText(error instanceof Error ? error.message : error);
    return message || fallbackMessage;
  }

  function normalizeText(value) {
    return namespace.session?.normalizeText?.(value) || String(value ?? "").trim();
  }

  function normalizePanelTarget(value) {
    return normalizeText(value).toLowerCase() === "local" ? "local" : "production";
  }

  function isAuthExpiring(expiresAt) {
    const expiryTime = Date.parse(normalizeText(expiresAt));
    return !(expiryTime > Date.now() + 60000);
  }

  function cloneValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  namespace.promptLibraryFirestoreClient = { create };
})(globalThis);
