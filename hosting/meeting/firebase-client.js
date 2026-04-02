(function initHostedMeetingFirebase(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};
  const shared = ns.shared;
  if (!shared) {
    throw new Error("Hosted meeting shared helpers are required before Firebase helpers.");
  }

  const { isExpired, logDebug, normalizeText, postJson, resolveConfig } = shared;
  const CONFIG = resolveConfig(global.__INOVA_HOSTED_MEETING_CONFIG__);
  const APP_NAME = "inova-hosted-meeting";
  let authState = {
    expiresAt: "",
    meetingDocumentId: "",
    meetingId: "",
    promise: null,
    sessionToken: "",
    workspaceSessionId: "",
  };
  let services = null;

  function getFirebaseGlobal() {
    const firebase = global.firebase;
    if (!firebase?.initializeApp || !firebase?.auth || !firebase?.firestore) {
      throw new Error("Firebase Web SDK를 불러오지 못했어요.");
    }
    return firebase;
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

  async function ensureWorkspaceAuth(meetingSessionToken, options = {}) {
    const normalizedToken = normalizeText(meetingSessionToken);
    const forceRefresh = Boolean(options?.forceRefresh);
    if (!normalizedToken) {
      throw new Error("회의 작업실 세션이 없어요. 패널에서 다시 열어 주세요.");
    }

    if (
      !forceRefresh
      && authState.sessionToken === normalizedToken
      && authState.meetingDocumentId
      && !isExpired(authState.expiresAt)
    ) {
      return {
        expiresAt: authState.expiresAt,
        meetingDocumentId: authState.meetingDocumentId,
        meetingId: authState.meetingId,
        workspaceSessionId: authState.workspaceSessionId,
      };
    }

    if (!forceRefresh && authState.sessionToken === normalizedToken && authState.promise) {
      return authState.promise;
    }

    authState = {
      expiresAt: authState.expiresAt,
      meetingDocumentId: authState.meetingDocumentId,
      meetingId: authState.meetingId,
      promise: null,
      sessionToken: normalizedToken,
      workspaceSessionId: authState.workspaceSessionId,
    };

    authState.promise = (async () => {
      logDebug("firestore.auth.start", {
        hasMeetingSessionToken: true,
      });
      const payload = await postJson(global, CONFIG.issueWorkspaceAuthUrl, {}, normalizedToken);
      const { auth } = getServices();
      const firebase = getFirebaseGlobal();
      await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
      await auth.signInWithCustomToken(normalizeText(payload?.firebaseCustomToken));
      authState = {
        expiresAt: normalizeText(payload?.expiresAt),
        meetingDocumentId: normalizeText(payload?.meetingDocumentId),
        meetingId: normalizeText(payload?.meetingId),
        promise: null,
        sessionToken: normalizedToken,
        workspaceSessionId: normalizeText(payload?.workspaceSessionId),
      };
      logDebug("firestore.auth.success", {
        expiresAt: authState.expiresAt,
        meetingDocumentId: authState.meetingDocumentId,
        meetingId: authState.meetingId,
        workspaceSessionId: authState.workspaceSessionId,
      });
      return {
        expiresAt: authState.expiresAt,
        meetingDocumentId: authState.meetingDocumentId,
        meetingId: authState.meetingId,
        workspaceSessionId: authState.workspaceSessionId,
      };
    })().catch((error) => {
      authState = {
        expiresAt: "",
        meetingDocumentId: "",
        meetingId: "",
        promise: null,
        sessionToken: "",
        workspaceSessionId: "",
      };
      logDebug("firestore.auth.error", { error });
      throw error;
    });

    return authState.promise;
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
      expiresAt: "",
      meetingDocumentId: "",
      meetingId: "",
      promise: null,
      sessionToken: "",
      workspaceSessionId: "",
    };
  }

  ns.firebase = {
    clearWorkspaceAuthCache,
    ensureWorkspaceAuth,
    getCollections() {
      return { ...CONFIG.firestoreCollections };
    },
    subscribeDocument,
  };
})(globalThis);
