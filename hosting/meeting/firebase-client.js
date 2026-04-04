(function initHostedMeetingFirebase(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const shared = ns.shared;
  if (!shared) {
    throw new Error("Hosted meeting shared helpers are required before Firebase helpers.");
  }

  const { logDebug, normalizeText, resolveConfig } = shared;
  const CONFIG = resolveConfig(global.__INOVA_HOSTED_MEETING_CONFIG__);
  const APP_NAME = "inova-hosted-meeting";
  const FIRESTORE_PERSISTENCE_OPTIONS = { synchronizeTabs: true };
  let authState = {
    accessMode: "",
    firebaseCustomToken: "",
    inovaLogin: false,
    meetingDocumentId: "",
    meetingId: "",
    promise: null,
    readOnly: false,
    viewer: null,
  };
  let services = null;
  let firestoreReadyPromise = null;

  function getFirebaseGlobal() {
    const firebase = global.firebase;
    if (!firebase?.initializeApp || !firebase?.auth || !firebase?.firestore) {
      throw new Error("Firebase Web SDK를 불러오지 못했어요.");
    }
    configureFirestoreLogging(firebase);
    return firebase;
  }

  function configureFirestoreLogging(firebase) {
    try {
      const setLogLevel = firebase?.firestore?.setLogLevel;
      if (typeof setLogLevel === "function") {
        setLogLevel("silent");
      }
    } catch {}
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

  function getServices() {
    if (services) {
      return services;
    }
    const firebase = getFirebaseGlobal();
    const existingApp = firebase.apps.find((app) => app.name === APP_NAME);
    const app = existingApp || firebase.initializeApp(CONFIG.firebaseWebConfig, APP_NAME);
    services = {
      app,
      auth: firebase.auth(app),
      firestore: firebase.firestore(app),
    };
    return services;
  }

  async function ensureFirestoreReady() {
    const nextServices = getServices();
    if (firestoreReadyPromise) {
      return firestoreReadyPromise;
    }
    firestoreReadyPromise = (async () => {
      if (typeof nextServices.firestore?.enablePersistence === "function") {
        try {
          await runWithSuppressedFirestorePersistenceWarning(() =>
            nextServices.firestore.enablePersistence(FIRESTORE_PERSISTENCE_OPTIONS)
          );
        } catch (error) {
          const code = normalizeText(error?.code);
          if (code !== "failed-precondition" && code !== "unimplemented") {
            throw error;
          }
          logDebug("firestore.persistence.unavailable", {
            code,
            message: normalizeText(error?.message),
          });
        }
      }
      return nextServices;
    })();
    return firestoreReadyPromise;
  }

  function setWorkspaceAccess(payload) {
    const nextPayload = payload && typeof payload === "object" ? payload : {};
    authState = {
      accessMode: normalizeText(nextPayload.accessMode),
      firebaseCustomToken: normalizeText(nextPayload.firebaseCustomToken),
      inovaLogin: nextPayload.inovaLogin !== false,
      meetingDocumentId: normalizeText(nextPayload.meetingDocumentId),
      meetingId: normalizeText(nextPayload.meetingId),
      promise: null,
      readOnly: Boolean(nextPayload.readOnly),
      viewer: nextPayload.viewer && typeof nextPayload.viewer === "object" ? { ...nextPayload.viewer } : null,
    };
  }

  async function ensureWorkspaceAuth(options = {}) {
    const forceRefresh = Boolean(options?.forceRefresh);
    if (!authState.firebaseCustomToken || !authState.meetingDocumentId || !authState.meetingId) {
      throw new Error("회의 작업실 접근 권한을 아직 확인하지 못했어요.");
    }

    if (
      !forceRefresh
      && authState.meetingDocumentId
    ) {
      return {
        accessMode: authState.accessMode,
        meetingDocumentId: authState.meetingDocumentId,
        meetingId: authState.meetingId,
        readOnly: authState.readOnly,
        viewer: authState.viewer,
      };
    }

    if (!forceRefresh && authState.promise) {
      return authState.promise;
    }

    authState.promise = (async () => {
      logDebug("firestore.auth.start", {
        accessMode: authState.accessMode,
        hasFirebaseCustomToken: Boolean(authState.firebaseCustomToken),
        meetingId: authState.meetingId,
      });
      const { auth } = await ensureFirestoreReady();
      const firebase = getFirebaseGlobal();
      await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
      await auth.signInWithCustomToken(authState.firebaseCustomToken);
      logDebug("firestore.auth.success", {
        accessMode: authState.accessMode,
        meetingDocumentId: authState.meetingDocumentId,
        meetingId: authState.meetingId,
        readOnly: authState.readOnly,
      });
      authState.promise = null;
      return {
        accessMode: authState.accessMode,
        meetingDocumentId: authState.meetingDocumentId,
        meetingId: authState.meetingId,
        readOnly: authState.readOnly,
        viewer: authState.viewer,
      };
    })().catch((error) => {
      authState = {
        accessMode: "",
        firebaseCustomToken: "",
        inovaLogin: false,
        meetingDocumentId: "",
        meetingId: "",
        promise: null,
        readOnly: false,
        viewer: null,
      };
      logDebug("firestore.auth.error", { error });
      throw error;
    });

    return authState.promise;
  }

  async function getWorkspaceRequestAuth() {
    const { auth } = await ensureFirestoreReady();
    const currentUser = auth.currentUser;
    if (!currentUser || typeof currentUser.getIdToken !== "function") {
      return {
        firebaseSessionToken: "",
      };
    }
    const firebaseSessionToken = normalizeText(await currentUser.getIdToken());
    return {
      firebaseSessionToken,
    };
  }

  function subscribeDocument(collectionName, documentId, handlers = {}) {
    const normalizedCollection = normalizeText(collectionName);
    const normalizedDocumentId = normalizeText(documentId);
    if (!normalizedCollection || !normalizedDocumentId) {
      return () => {};
    }
    const { firestore } = getServices();
    logDebug("firestore.listener.attach", {
      collection: normalizedCollection,
      documentId: normalizedDocumentId,
    });
    const unsubscribe = firestore
      .collection(normalizedCollection)
      .doc(normalizedDocumentId)
      .onSnapshot(
        (snapshot) => {
          logDebug("firestore.listener.snapshot", {
            collection: normalizedCollection,
            documentId: normalizedDocumentId,
            exists: Boolean(snapshot?.exists),
            fromCache: Boolean(snapshot?.metadata?.fromCache),
            hasPendingWrites: Boolean(snapshot?.metadata?.hasPendingWrites),
          });
          if (typeof handlers.next === "function") {
            handlers.next(snapshot);
          }
        },
        (error) => {
          logDebug("firestore.listener.error", {
            collection: normalizedCollection,
            documentId: normalizedDocumentId,
            error,
          });
          if (typeof handlers.error === "function") {
            handlers.error(error);
          }
        }
      );
    return () => {
      logDebug("firestore.listener.detach", {
        collection: normalizedCollection,
        documentId: normalizedDocumentId,
      });
      try {
        unsubscribe();
      } catch {}
    };
  }

  function clearWorkspaceAuthCache() {
    authState = {
      accessMode: "",
      firebaseCustomToken: "",
      inovaLogin: false,
      meetingDocumentId: "",
      meetingId: "",
      promise: null,
      readOnly: false,
      viewer: null,
    };
  }

  ns.firebase = {
    clearWorkspaceAuthCache,
    ensureWorkspaceAuth,
    getWorkspaceRequestAuth,
    getCollections() {
      return { ...CONFIG.firestoreCollections };
    },
    setWorkspaceAccess,
    subscribeDocument,
  };
})(globalThis);
