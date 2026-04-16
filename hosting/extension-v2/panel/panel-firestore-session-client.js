(function initPanelFirestoreSessionClient(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const utils = namespace.panelUtils || {};
  const isAuthExpiring = typeof utils.isAuthExpiring === "function"
    ? utils.isAuthExpiring
    : (expiresAt) => !(Date.parse(normalizeText(expiresAt)) > Date.now() + 60000);
  const normalizePanelTarget = typeof utils.normalizePanelTarget === "function"
    ? utils.normalizePanelTarget
    : (value) => (normalizeText(value).toLowerCase() === "local" ? "local" : "production");
  const normalizeText = typeof utils.normalizeText === "function"
    ? utils.normalizeText
    : namespace.session.normalizeText;
  const resolveBrowserCapabilities = typeof utils.resolveBrowserCapabilities === "function"
    ? utils.resolveBrowserCapabilities
    : (options) => {
      const providedCapabilities = options?.browserCapabilities;
      if (providedCapabilities && typeof providedCapabilities === "object") {
        return providedCapabilities;
      }
      return namespace.extensionCapabilityClient?.create?.({
        invokePage: options?.invokePage,
        invokeRuntime: options?.invokeRuntime,
      }) || {};
    };
  const AUTH_PANEL = "hosted";
  const HOSTED_APP_NAME = "inova-hosted-panel";
  const APP_NAME_BY_PANEL = Object.freeze({
    meeting: HOSTED_APP_NAME,
    prompt: HOSTED_APP_NAME,
  });
  const FIREBASE_VERSION = "10.12.5";
  const FIRESTORE_PERSISTENCE_OPTIONS = { synchronizeTabs: true };
  const SDK_SOURCES = Object.freeze([
    `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app-compat.js`,
    `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth-compat.js`,
    `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore-compat.js`,
  ]);
  const DEFAULT_COLLECTIONS = Object.freeze({
    accountsCollection: "integration_inova_accounts",
    promptLibraryChunksCollection: "prompt_library_chunks",
    promptLibraryOrdersCollection: "prompt_library_orders",
    storeEntriesCollection: "prompt_store_entries",
  });
  const state = {
    sessions: new Map(),
    sdkPromise: null,
  };

  async function ensureSession(request = {}) {
    const panel = normalizePanel(request?.panel);
    const session = getPanelSession(panel);
    const browserCapabilities = resolveBrowserCapabilities(request);
    const issuePanelSession = typeof browserCapabilities.issuePanelSession === "function"
      ? browserCapabilities.issuePanelSession
      : async () => ({});
    const providerIdentity = request?.providerIdentity && typeof request.providerIdentity === "object"
      ? request.providerIdentity
      : {};
    const providerUserKey = normalizeText(providerIdentity.providerUserKey);
    const requestedTarget = normalizePanelTarget(request?.settings?.meetingWorkspaceTarget || request?.target);
    const purpose = normalizeText(request?.purpose) || panel;
    const traceFirestore = typeof request.traceFirestore === "function"
      ? request.traceFirestore
      : () => {};
    if (!providerUserKey) {
      throw new Error(panel === "meeting" ? "회의 사용자 정보를 찾지 못했어요." : "프롬프트 사용자 정보를 찾지 못했어요.");
    }

    const panelAuth = canReusePanelAuth(session, providerUserKey, requestedTarget)
      ? session.panelAuth
      : normalizePanelAuth(
        panel,
        await issuePanelSession(AUTH_PANEL, providerIdentity, {
          purpose,
          target: requestedTarget,
        })
      );
    session.panelAuth = panelAuth;

    if (shouldResetServices(session, panelAuth)) {
      await resetServices(session, "runtime-change", traceFirestore);
      session.panelAuth = panelAuth;
    }

    const services = await ensureServices(session, panelAuth);
    await ensurePanelSession(session, services.auth, panelAuth, { purpose, traceFirestore });
    return {
      ...services,
      panelAuth,
    };
  }

  function getPanelSession(panel) {
    const key = AUTH_PANEL;
    const existing = state.sessions.get(key);
    if (existing) {
      return existing;
    }
    const nextSession = {
      app: null,
      appName: APP_NAME_BY_PANEL[normalizePanel(panel)] || HOSTED_APP_NAME,
      auth: null,
      authKey: "",
      authPromise: null,
      db: null,
      panel: AUTH_PANEL,
      panelAuth: null,
      persistencePromise: null,
      runtimeKey: "",
    };
    state.sessions.set(key, nextSession);
    return nextSession;
  }

  function canReusePanelAuth(session, providerUserKey, requestedTarget) {
    return Boolean(
      session.panelAuth
      && session.panelAuth.providerUserKey === providerUserKey
      && session.panelAuth.target === requestedTarget
      && !isAuthExpiring(session.panelAuth.expiresAt)
    );
  }

  async function ensureServices(session, panelAuth) {
    const firebase = await ensureFirebaseSdk();
    if (session.app && session.auth && session.db) {
      return {
        app: session.app,
        auth: session.auth,
        db: session.db,
        firebase,
      };
    }

    const existingApp = Array.isArray(firebase.apps)
      ? firebase.apps.find((entry) => normalizeText(entry?.name) === session.appName)
      : null;
    if (shouldUseEphemeralAuthSession(panelAuth)) {
      clearStoredAuthSession(panelAuth.firebaseConfig, session.appName);
    }
    session.app = existingApp || firebase.initializeApp(panelAuth.firebaseConfig, session.appName);
    session.auth = session.app.auth();
    session.db = session.app.firestore();
    configureFirebaseEmulators(session, panelAuth);
    await ensureFirestorePersistence(session);
    const authPersistence = resolveAuthPersistence(firebase, panelAuth);
    if (authPersistence) {
      await session.auth.setPersistence(authPersistence);
    }
    session.runtimeKey = buildRuntimeKey(panelAuth);
    return {
      app: session.app,
      auth: session.auth,
      db: session.db,
      firebase,
    };
  }

  async function ensureFirebaseSdk() {
    if (isFirebaseSdkReady()) {
      return global.firebase;
    }
    if (state.sdkPromise) {
      return state.sdkPromise;
    }
    state.sdkPromise = SDK_SOURCES.reduce(
      (promise, src) => promise.then(() => loadScript(src)),
      Promise.resolve()
    ).then(() => {
      if (!isFirebaseSdkReady()) {
        throw new Error("Firebase SDK를 불러오지 못했어요.");
      }
      return global.firebase;
    }).catch((error) => {
      state.sdkPromise = null;
      throw error;
    });
    return state.sdkPromise;
  }

  function isFirebaseSdkReady() {
    return Boolean(
      global.firebase?.initializeApp
      && global.firebase?.auth
      && global.firebase?.firestore
    );
  }

  async function ensurePanelSession(session, auth, panelAuth, options = {}) {
    const authKey = buildAuthKey(panelAuth);
    if (session.authPromise && session.authKey === authKey) {
      return session.authPromise;
    }
    session.authKey = authKey;
    session.authPromise = signInPanelSession(auth, panelAuth, options).finally(() => {
      if (session.authKey === authKey) {
        session.authPromise = null;
      }
    });
    return session.authPromise;
  }

  async function signInPanelSession(auth, panelAuth, options = {}) {
    const traceFirestore = typeof options.traceFirestore === "function"
      ? options.traceFirestore
      : () => {};
    const reader = normalizeText(options.purpose) || "prompt";
    const currentUser = auth?.currentUser || null;
    const expectedPanelExpMs = Math.max(0, Date.parse(panelAuth.expiresAt) || 0);
    if (!currentUser) {
      traceFirestore("34.hosted.firestore.auth.sign-in", {
        reader,
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
      const sameScope = normalizeText(claims.scope) === panelAuth.panelScope;
      const activePanelExpMs = Math.max(0, Number(claims[panelAuth.expClaim]) || 0);
      if (sameProviderUserKey && sameScope && activePanelExpMs >= expectedPanelExpMs) {
        traceFirestore("34.hosted.firestore.auth.reuse", {
          reader,
          target: panelAuth.target,
        });
        await currentUser.getIdToken();
        return;
      }
    } catch (error) {
      void error;
    }
    traceFirestore("34.hosted.firestore.auth.refresh", {
      reader,
      target: panelAuth.target,
    });
    await auth.signInWithCustomToken(panelAuth.firebaseCustomToken);
  }

  function configureFirebaseEmulators(session, panelAuth) {
    const emulators = panelAuth?.emulators && typeof panelAuth.emulators === "object"
      ? panelAuth.emulators
      : {};
    if (!emulators.enabled) {
      return;
    }
    if (typeof session.auth?.useEmulator === "function") {
      session.auth.useEmulator(normalizeText(emulators.authUrl));
    }
    if (typeof session.db?.useEmulator === "function") {
      session.db.useEmulator(
        normalizeText(emulators.firestoreHost),
        Number(emulators.firestorePort) || 8080
      );
    }
  }

  async function ensureFirestorePersistence(session) {
    if (!session.db?.enablePersistence) {
      return;
    }
    if (session.persistencePromise) {
      return session.persistencePromise;
    }
    session.persistencePromise = runWithSuppressedFirestorePersistenceWarning(() =>
      session.db.enablePersistence(FIRESTORE_PERSISTENCE_OPTIONS)
    ).catch((error) => {
      const code = normalizeText(error?.code);
      if (code !== "failed-precondition" && code !== "unimplemented") {
        throw error;
      }
    });
    return session.persistencePromise;
  }

  async function resetServices(session, reason, traceFirestore) {
    const currentApp = session.app;
    session.app = null;
    session.auth = null;
    session.authKey = "";
    session.authPromise = null;
    session.db = null;
    session.persistencePromise = null;
    session.panelAuth = null;
    session.runtimeKey = "";
    if (currentApp && typeof currentApp.delete === "function") {
      try {
        await currentApp.delete();
      } catch (error) {
        void error;
      }
    }
    if (typeof traceFirestore === "function") {
      traceFirestore("34.hosted.firestore.session.reset", {
        reason: normalizeText(reason) || "manual",
      });
    }
  }

  function shouldResetServices(session, panelAuth) {
    if (!session.app) {
      return false;
    }
    return session.runtimeKey !== buildRuntimeKey(panelAuth);
  }

  function normalizePanelAuth(panel, input) {
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
    const panelScope = normalizeText(panelAuth.panelScope || panelAuth.promptPanelScope)
      || (panel === "meeting" ? "meeting-panel" : "prompt-panel");
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
      panel,
      panelScope,
      promptFirestoreCollections: {
        accountsCollection: normalizeText(promptFirestoreCollections.accountsCollection) || DEFAULT_COLLECTIONS.accountsCollection,
        promptLibraryChunksCollection:
          normalizeText(promptFirestoreCollections.promptLibraryChunksCollection)
          || DEFAULT_COLLECTIONS.promptLibraryChunksCollection,
        promptLibraryOrdersCollection:
          normalizeText(promptFirestoreCollections.promptLibraryOrdersCollection)
          || DEFAULT_COLLECTIONS.promptLibraryOrdersCollection,
        storeEntriesCollection:
          normalizeText(promptFirestoreCollections.storeEntriesCollection)
          || DEFAULT_COLLECTIONS.storeEntriesCollection,
      },
      expClaim: panelScope === "meeting-panel" ? "panelExpMs" : "promptPanelExpMs",
      promptLibraryId: normalizeText(panelAuth.promptLibraryId),
      providerUserKey: normalizeText(panelAuth.providerUserKey),
      target: normalizeText(panelAuth.target).toLowerCase() === "local" ? "local" : "production",
    };
    if (!normalized.providerUserKey || !normalized.firebaseCustomToken || !normalized.firebaseConfig.projectId) {
      throw new Error(panel === "meeting" ? "회의 Firestore 인증 정보를 준비하지 못했어요." : "프롬프트 Firestore 인증 정보를 준비하지 못했어요.");
    }
    return normalized;
  }

  function buildAuthKey(panelAuth) {
    return [
      buildRuntimeKey(panelAuth),
      panelAuth.providerUserKey,
      panelAuth.panelScope,
      panelAuth.expiresAt,
    ].join("::");
  }

  function buildRuntimeKey(panelAuth) {
    return JSON.stringify({
      authUrl: normalizeText(panelAuth?.emulators?.authUrl),
      enabled: Boolean(panelAuth?.emulators?.enabled),
      firestoreHost: normalizeText(panelAuth?.emulators?.firestoreHost),
      firestorePort: Number(panelAuth?.emulators?.firestorePort) || 0,
      projectId: normalizeText(panelAuth?.firebaseConfig?.projectId),
      scope: normalizeText(panelAuth?.panelScope),
      target: normalizeText(panelAuth?.target),
    });
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
      } catch {}
    }
  }

  function shouldClearStoredAuthSessionKey(key, apiKey, appName) {
    return key.startsWith("firebase:")
      && key.includes(apiKey)
      && key.includes(appName);
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

  function normalizePanel(value) {
    return normalizeText(value).toLowerCase() === "meeting" ? "meeting" : "prompt";
  }

  namespace.panelFirestoreSessionClient = {
    ensureSession,
  };
})(globalThis);
