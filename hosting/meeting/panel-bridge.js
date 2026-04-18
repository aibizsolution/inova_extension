(function initMeetingPanelBridge(global) {
  const ALLOWED_PARENT_ORIGINS = buildAllowedParentOrigins();
  // Meeting panel auth is scoped to the current runtime target/user; keep
  // Firestore persistence single-tab so another meeting panel cannot reuse it.
  const FIRESTORE_PERSISTENCE_OPTIONS = null;
  const LOCAL_BRIDGE_ORIGINS = new Set([
    "http://127.0.0.1:5000",
    "http://localhost:5000",
  ]);
  const PORT_CONNECT_SOURCE = "inova-meeting-panel-client";
  let app = null;
  let auth = null;
  let db = null;
  let emulatorsConfigured = false;
  let firestorePersistencePromise = null;
  let lastSnapshotSignature = "";
  let port = null;
  let unsubscribeMeetings = null;
  let currentRequestId = 0;

  global.addEventListener("message", handleWindowMessage);

  function buildAllowedParentOrigins() {
    const origins = new Set(["https://inova.incross.com"]);
    const configuredParentOrigin = readConfiguredParentOrigin();
    if (configuredParentOrigin) {
      origins.add(configuredParentOrigin);
    }
    const referrerOrigin = readReferrerOrigin();
    if (referrerOrigin.startsWith("chrome-extension://")) {
      origins.add(referrerOrigin);
    }
    return origins;
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

  function handleWindowMessage(event) {
    if (!ALLOWED_PARENT_ORIGINS.has(String(event.origin || ""))) {
      return;
    }
    const data = event.data && typeof event.data === "object" ? event.data : null;
    if (!data || data.source !== PORT_CONNECT_SOURCE || data.type !== "connect-port") {
      return;
    }
    const [nextPort] = Array.isArray(event.ports) ? event.ports : [];
    if (!nextPort) {
      return;
    }
    if (port) {
      try {
        port.close();
      } catch {}
    }
    port = nextPort;
    port.onmessage = handlePortMessage;
    port.start?.();
    sendMessage("ready", {});
  }

  function readReferrerOrigin() {
    try {
      return new URL(global.document?.referrer || "").origin;
    } catch {
      return "";
    }
  }

  function readConfiguredParentOrigin() {
    try {
      const configured = new URLSearchParams(global.location.search || "").get("inovaParentOrigin") || "";
      const origin = new URL(configured).origin;
      if (origin === "https://inova.incross.com" || origin.startsWith("chrome-extension://")) {
        return origin;
      }
      return "";
    } catch {
      return "";
    }
  }

  async function handlePortMessage(event) {
    const data = event?.data && typeof event.data === "object" ? event.data : null;
    if (!data || !data.type) {
      return;
    }
    if (data.type === "disconnect") {
      disconnect();
      sendMessage("disconnected", {});
      return;
    }
    if (data.type !== "init") {
      return;
    }

    const payload = data.payload && typeof data.payload === "object" ? data.payload : {};
    currentRequestId = Math.max(0, Number(data.requestId) || Date.now());
    try {
      await connect(payload);
      sendMessage("connected", {
        expiresAt: normalizeText(payload.expiresAt),
        providerUserKey: normalizeText(payload.providerUserKey),
        requestId: currentRequestId,
      });
    } catch (error) {
      sendMessage("error", {
        error: normalizeText(error?.message) || "패널 Firestore 연결에 실패했어요.",
        requestId: currentRequestId,
      });
    }
  }

  async function connect(payload) {
    const firebaseConfig = payload.firebaseConfig && typeof payload.firebaseConfig === "object"
      ? payload.firebaseConfig
      : {};
    const providerUserKey = normalizeText(payload.providerUserKey);
    const firebaseCustomToken = normalizeText(payload.firebaseCustomToken);
    const expectedPanelExpMs = Math.max(0, Date.parse(normalizeText(payload.expiresAt)) || 0);
    const queryLimit = Math.max(1, Math.min(24, Number(payload.queryLimit) || 24));
    if (!providerUserKey || !firebaseCustomToken || !firebaseConfig.projectId) {
      throw new Error("패널 Firestore 연결 정보가 비어 있어요.");
    }

    if (!app) {
      configureFirestoreLogging(global.firebase);
      app = global.firebase.initializeApp(firebaseConfig, "meeting-panel-bridge");
      auth = app.auth();
      db = app.firestore();
      configureFirebaseEmulators();
      await ensureFirestorePersistence();
      await auth.setPersistence(global.firebase.auth.Auth.Persistence.SESSION);
    }

    const currentUser = auth.currentUser || null;
    const currentToken = normalizeText(await currentUser?.getIdToken?.().catch(() => ""));
    if (!currentToken || !currentUser) {
      await auth.signInWithCustomToken(firebaseCustomToken);
    } else {
      try {
        const tokenResult = await currentUser.getIdTokenResult();
        const claims = tokenResult?.claims && typeof tokenResult.claims === "object" ? tokenResult.claims : {};
        const sameProviderUserKey = normalizeText(claims.providerUserKey) === providerUserKey;
        const sameScope = normalizeText(claims.scope) === "meeting-panel";
        const activePanelExpMs = Math.max(0, Number(claims.panelExpMs) || 0);
        const canReuseSession = sameProviderUserKey
          && sameScope
          && activePanelExpMs >= expectedPanelExpMs;

        if (!canReuseSession) {
          await auth.signInWithCustomToken(firebaseCustomToken);
        } else {
          await currentUser.getIdToken();
        }
      } catch {
        await auth.signInWithCustomToken(firebaseCustomToken);
      }
    }

    disconnect();
    const meetingsQuery = db
      .collection("integration_inova_meetings")
      .where("owner.providerUserKey", "==", providerUserKey)
      .orderBy("updatedAt", "desc")
      .limit(queryLimit);

    const cacheSnapshot = await loadCachedSnapshot(meetingsQuery);
    if (cacheSnapshot) {
      sendSnapshot(cacheSnapshot);
    }

    unsubscribeMeetings = meetingsQuery.onSnapshot(
        { includeMetadataChanges: true },
        (snapshot) => {
          sendSnapshot(snapshot);
        },
        (error) => {
          sendMessage("error", {
            error: normalizeText(error?.message) || "패널 Firestore 구독이 끊겼어요.",
            requestId: currentRequestId,
          });
        }
      );
  }

  async function ensureFirestorePersistence() {
    if (!db?.enablePersistence) {
      return;
    }
    if (firestorePersistencePromise) {
      return firestorePersistencePromise;
    }
    firestorePersistencePromise = runWithSuppressedFirestorePersistenceWarning(() => (
      FIRESTORE_PERSISTENCE_OPTIONS
        ? db.enablePersistence(FIRESTORE_PERSISTENCE_OPTIONS)
        : db.enablePersistence()
    )).catch((error) => {
      const code = normalizeText(error?.code);
      if (code !== "failed-precondition" && code !== "unimplemented") {
        throw error;
      }
    });
    return firestorePersistencePromise;
  }

  function configureFirebaseEmulators() {
    if (emulatorsConfigured || !isLocalBridgeOrigin()) {
      return;
    }
    const emulatorHost = resolveLocalEmulatorHost();
    if (typeof auth?.useEmulator === "function") {
      auth.useEmulator(`http://${emulatorHost}:9099`);
    }
    if (typeof db?.useEmulator === "function") {
      db.useEmulator(emulatorHost, 8080);
    }
    emulatorsConfigured = true;
  }

  function disconnect() {
    if (typeof unsubscribeMeetings === "function") {
      unsubscribeMeetings();
    }
    lastSnapshotSignature = "";
    unsubscribeMeetings = null;
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

  function sendSnapshot(snapshot) {
    const nextSignature = buildSnapshotSignature(snapshot);
    if (nextSignature && nextSignature === lastSnapshotSignature) {
      return;
    }
    lastSnapshotSignature = nextSignature;
    sendMessage("snapshot", {
      checkedAt: new Date().toISOString(),
      fromCache: Boolean(snapshot?.metadata?.fromCache),
      hasPendingWrites: Boolean(snapshot?.metadata?.hasPendingWrites),
      items: (Array.isArray(snapshot?.docs) ? snapshot.docs : []).map(serializeDocument),
      requestId: currentRequestId,
    });
  }

  function buildSnapshotSignature(snapshot) {
    const docs = (Array.isArray(snapshot?.docs) ? snapshot.docs : []).map((doc) => {
      const data = doc?.data && typeof doc.data === "function" ? doc.data() : {};
      const share = data?.share && typeof data.share === "object" ? data.share : {};
      return `${normalizeText(doc?.id)}:${normalizeText(data?.updatedAt || data?.createdAt)}:${normalizeText(data?.status)}:${normalizeText(share?.status)}:${normalizeText(share?.shareId)}:${normalizeText(share?.revokedAt)}`;
    });
    return JSON.stringify({
      docs,
      fromCache: Boolean(snapshot?.metadata?.fromCache),
      hasPendingWrites: Boolean(snapshot?.metadata?.hasPendingWrites),
    });
  }

  function serializeDocument(doc) {
    const data = doc?.data && typeof doc.data === "function" ? doc.data() : {};
    const share = normalizeShareMetadata(data?.share);
    return {
      ...cloneJson(data),
      docId: normalizeText(doc?.id),
      share,
    };
  }

  function normalizeShareMetadata(input) {
    const share = input && typeof input === "object" ? input : {};
    const status = normalizeText(share.status);
    const shareId = normalizeText(share.shareId);
    return {
      ...cloneJson(share),
      active: status === "active" && Boolean(shareId),
      createdAt: normalizeText(share.createdAt),
      createdBy: share.createdBy && typeof share.createdBy === "object" ? cloneJson(share.createdBy) : {},
      revokedAt: normalizeText(share.revokedAt),
      shareId,
      status,
    };
  }

  function sendMessage(type, payload) {
    if (!port) {
      return;
    }
    port.postMessage({
      payload: payload && typeof payload === "object" ? payload : {},
      type: normalizeText(type),
    });
  }

  function cloneJson(value) {
    try {
      return JSON.parse(JSON.stringify(value || {}));
    } catch {
      return {};
    }
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function isLocalBridgeOrigin() {
    return LOCAL_BRIDGE_ORIGINS.has(String(global.location?.origin || ""));
  }

  function resolveLocalEmulatorHost() {
    const hostname = normalizeText(global.location?.hostname).toLowerCase();
    return hostname === "localhost" ? "localhost" : "127.0.0.1";
  }
})(globalThis);
