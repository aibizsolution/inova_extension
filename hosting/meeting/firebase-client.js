(function initHostedMeetingFirebase(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const shared = ns.shared;
  if (!shared) {
    throw new Error("Hosted meeting shared helpers are required before Firebase helpers.");
  }

  const { logDebug, normalizeText, resolveConfig } = shared;
  const CONFIG = resolveConfig(global.__INOVA_HOSTED_MEETING_CONFIG__);
  const APP_NAME = "inova-hosted-meeting";
  // Workspace auth claims are meeting-scoped, so cross-tab synchronized persistence
  // lets one meeting tab invalidate another tab's Firestore reads.
  const FIRESTORE_PERSISTENCE_OPTIONS = null;
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

  async function sha256Hex(input) {
    const text = String(input || "");
    if (typeof global.crypto?.subtle === "object" && typeof global.TextEncoder === "function") {
      const bytes = new global.TextEncoder().encode(text);
      const digest = await global.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
    }
    throw new Error("브라우저 SHA-256 해시를 사용할 수 없어요.");
  }

  function extractOwnerProviderUserKey(meetingDocumentId, meetingId) {
    const normalizedMeetingDocumentId = normalizeText(meetingDocumentId);
    const normalizedMeetingId = normalizeText(meetingId);
    const suffix = normalizedMeetingId ? `__${normalizedMeetingId}` : "";
    if (normalizedMeetingDocumentId && suffix && normalizedMeetingDocumentId.endsWith(suffix)) {
      return normalizedMeetingDocumentId.slice(0, -suffix.length);
    }
    const separatorIndex = normalizedMeetingDocumentId.lastIndexOf("__");
    return separatorIndex > 0 ? normalizedMeetingDocumentId.slice(0, separatorIndex) : "";
  }

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
          await runWithSuppressedFirestorePersistenceWarning(() => (
            FIRESTORE_PERSISTENCE_OPTIONS
              ? nextServices.firestore.enablePersistence(FIRESTORE_PERSISTENCE_OPTIONS)
              : nextServices.firestore.enablePersistence()
          ));
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

  async function hasMatchingWorkspaceAuthSession() {
    if (!authState.firebaseCustomToken || !authState.meetingDocumentId || !authState.meetingId) {
      return false;
    }
    const expectedOwnerProviderUserKey = extractOwnerProviderUserKey(authState.meetingDocumentId, authState.meetingId);
    if (!expectedOwnerProviderUserKey) {
      return false;
    }
    const { auth } = await ensureFirestoreReady();
    const currentUser = auth.currentUser;
    if (!currentUser || typeof currentUser.getIdTokenResult !== "function") {
      return false;
    }
    try {
      const tokenResult = await currentUser.getIdTokenResult();
      const claims = tokenResult?.claims && typeof tokenResult.claims === "object" ? tokenResult.claims : {};
      const activeMeetingId = normalizeText(claims.meetingId);
      const activeOwnerProviderUserKey = normalizeText(claims.ownerProviderUserKey || claims.providerUserKey);
      return activeMeetingId === normalizeText(authState.meetingId)
        && activeOwnerProviderUserKey === expectedOwnerProviderUserKey;
    } catch {
      return false;
    }
  }

  async function ensureWorkspaceAuth(options = {}) {
    const forceRefresh = Boolean(options?.forceRefresh);
    if (!authState.firebaseCustomToken || !authState.meetingDocumentId || !authState.meetingId) {
      throw new Error("회의 작업실 접근 권한을 아직 확인하지 못했어요.");
    }

    if (!forceRefresh && await hasMatchingWorkspaceAuthSession()) {
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

  async function readDocument(collectionName, documentId) {
    const normalizedCollection = normalizeText(collectionName);
    const normalizedDocumentId = normalizeText(documentId);
    if (!normalizedCollection || !normalizedDocumentId) {
      return null;
    }
    if (authState.firebaseCustomToken) {
      await ensureWorkspaceAuth();
    }
    const { firestore } = await ensureFirestoreReady();
    logDebug("firestore.document.read.start", {
      collection: normalizedCollection,
      documentId: normalizedDocumentId,
    });
    const snapshot = await firestore.collection(normalizedCollection).doc(normalizedDocumentId).get();
    logDebug("firestore.document.read.success", {
      collection: normalizedCollection,
      documentId: normalizedDocumentId,
      exists: Boolean(snapshot?.exists),
      fromCache: Boolean(snapshot?.metadata?.fromCache),
      hasPendingWrites: Boolean(snapshot?.metadata?.hasPendingWrites),
    });
    return snapshot;
  }

  async function buildWorkspaceMeetingJobId(requestId) {
    const normalizedRequestId = normalizeText(requestId);
    const ownerProviderUserKey = extractOwnerProviderUserKey(authState.meetingDocumentId, authState.meetingId);
    if (!normalizedRequestId || !ownerProviderUserKey || !authState.meetingId) {
      return "";
    }
    const digest = await sha256Hex([
      "meeting-job",
      normalizeText(ownerProviderUserKey),
      normalizeText(authState.meetingId),
      normalizedRequestId,
    ].join("::"));
    return `meeting-job-${digest.slice(0, 32)}`;
  }

  async function queryDocuments(collectionName, options = {}) {
    const normalizedCollection = normalizeText(collectionName);
    const filters = Array.isArray(options?.filters) ? options.filters : [];
    const limit = Math.max(1, Number(options?.limit) || 1);
    if (!normalizedCollection || !filters.length) {
      return [];
    }
    if (authState.firebaseCustomToken) {
      await ensureWorkspaceAuth();
    }
    const { firestore } = await ensureFirestoreReady();
    let query = firestore.collection(normalizedCollection);
    const normalizedFilters = filters
      .map((filter) => ({
        field: normalizeText(filter?.field),
        op: normalizeText(filter?.op) || "==",
        value: filter?.value,
      }))
      .filter((filter) => filter.field);
    if (!normalizedFilters.length) {
      return [];
    }
    logDebug("firestore.query.start", {
      collection: normalizedCollection,
      filters: normalizedFilters.map((filter) => ({
        field: filter.field,
        op: filter.op,
        value: normalizeText(filter.value),
      })),
      limit,
    });
    for (const filter of normalizedFilters) {
      query = query.where(filter.field, filter.op, filter.value);
    }
    const snapshot = await query.limit(limit).get();
    logDebug("firestore.query.success", {
      collection: normalizedCollection,
      count: Math.max(0, Number(snapshot?.size) || 0),
      filters: normalizedFilters.map((filter) => ({
        field: filter.field,
        op: filter.op,
        value: normalizeText(filter.value),
      })),
      fromCache: Boolean(snapshot?.metadata?.fromCache),
      hasPendingWrites: Boolean(snapshot?.metadata?.hasPendingWrites),
      limit,
    });
    return Array.isArray(snapshot?.docs) ? snapshot.docs : [];
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
    buildWorkspaceMeetingJobId,
    clearWorkspaceAuthCache,
    ensureWorkspaceAuth,
    getWorkspaceRequestAuth,
    getCollections() {
      return { ...CONFIG.firestoreCollections };
    },
    queryDocuments,
    readDocument,
    setWorkspaceAccess,
    subscribeDocument,
  };
})(globalThis);
