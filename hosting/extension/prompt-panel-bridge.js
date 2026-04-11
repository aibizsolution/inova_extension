(function initPromptPanelBridge(global) {
  const ALLOWED_PARENT_ORIGINS = buildAllowedParentOrigins();
  const DEFAULT_FIRESTORE_COLLECTIONS = Object.freeze({
    accountsCollection: "integration_inova_accounts",
    storeDetailCollection: "prompt_store_entry_details",
    storeFeedCollection: "prompt_store_feed_pages",
    storeSummaryCollection: "prompt_store_meta",
  });
  const DEFAULT_PROMPT_PANEL_SCOPE = "prompt-panel";
  const FIRESTORE_PERSISTENCE_OPTIONS = { synchronizeTabs: true };
  const LOCAL_BRIDGE_ORIGINS = new Set([
    "http://127.0.0.1:5000",
    "http://localhost:5000",
  ]);
  const PORT_CONNECT_SOURCE = "inova-prompt-panel-client";
  const STORE_SUMMARY_DOC_ID = "summary";
  const STORE_LATEST_LOCAL_LIMIT = 1000;
  const STORE_FEED_PAGE_SIZE = 500;
  const STORE_FEED_PAGE_COUNT = Math.max(1, Math.ceil(STORE_LATEST_LOCAL_LIMIT / STORE_FEED_PAGE_SIZE));
  let app = null;
  let auth = null;
  let db = null;
  let emulatorsConfigured = false;
  let firestorePersistencePromise = null;
  let port = null;
  let currentRequestId = 0;
  let storeFeedSnapshots = new Map();
  let storeFeedReadyPages = new Set();
  let storeSummarySnapshot = null;
  let storeLatestEmitTimer = 0;
  let lastStoreLatestSignature = "";
  let unsubscribePromptLibraryMeta = null;
  let unsubscribeStoreFeeds = new Map();
  let unsubscribeStoreSummary = null;
  let connectedFirestoreCollections = { ...DEFAULT_FIRESTORE_COLLECTIONS };
  let connectedPromptPanelScope = DEFAULT_PROMPT_PANEL_SCOPE;

  global.addEventListener("message", handleWindowMessage);

  function buildAllowedParentOrigins() {
    const origins = new Set(["https://inova.incross.com"]);
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

  async function handlePortMessage(event) {
    const data = event?.data && typeof event.data === "object" ? event.data : null;
    if (!data || !data.type) {
      return;
    }
    const payload = data.payload && typeof data.payload === "object" ? data.payload : {};
    if (Number(data.requestId)) {
      currentRequestId = Math.max(0, Number(data.requestId));
    }
    if (data.type === "disconnect") {
      disconnectAll();
      sendMessage("disconnected", {});
      return;
    }
    if (data.type === "connect") {
      try {
        await connect(payload);
        sendMessage("connected", {
          providerUserKey: normalizeText(payload.providerUserKey),
          requestId: currentRequestId,
        });
      } catch (error) {
        sendError("connect", error);
      }
      return;
    }
    if (data.type === "subscribe-prompt-library-meta") {
      subscribePromptLibraryMeta(payload);
      return;
    }
    if (data.type === "unsubscribe-prompt-library-meta") {
      clearPromptLibraryMeta();
      return;
    }
    if (data.type === "subscribe-store-latest") {
      subscribeStoreLatest(payload);
      return;
    }
    if (data.type === "unsubscribe-store-latest") {
      clearStoreLatest();
      return;
    }
    if (data.type === "load-store-detail") {
      loadStoreDetail(payload);
    }
  }

  async function connect(payload) {
    const firebaseConfig = payload.firebaseConfig && typeof payload.firebaseConfig === "object"
      ? payload.firebaseConfig
      : {};
    connectedFirestoreCollections = resolveFirestoreCollections(payload.firestoreCollections);
    connectedPromptPanelScope = normalizeText(payload.promptPanelScope) || DEFAULT_PROMPT_PANEL_SCOPE;
    const firebaseCustomToken = normalizeText(payload.firebaseCustomToken);
    const expectedProviderUserKey = normalizeText(payload.providerUserKey);
    const expectedPromptPanelExpMs = Math.max(0, Date.parse(normalizeText(payload.expiresAt)) || 0);
    if (!firebaseConfig.projectId || !firebaseCustomToken) {
      throw new Error("프롬프트 패널 Firestore 연결 정보가 비어 있어요.");
    }

    if (!app) {
      configureFirestoreLogging(global.firebase);
      app = global.firebase.initializeApp(firebaseConfig, "prompt-panel-bridge");
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
      return;
    }

    try {
      const tokenResult = await currentUser.getIdTokenResult();
      const claims = tokenResult?.claims && typeof tokenResult.claims === "object" ? tokenResult.claims : {};
      const sameProviderUserKey = normalizeText(claims.providerUserKey) === expectedProviderUserKey;
      const sameScope = normalizeText(claims.scope) === connectedPromptPanelScope;
      const activePromptPanelExpMs = Math.max(0, Number(claims.promptPanelExpMs) || 0);
      const canReuseSession = sameProviderUserKey
        && sameScope
        && activePromptPanelExpMs >= expectedPromptPanelExpMs;

      if (!canReuseSession) {
        await auth.signInWithCustomToken(firebaseCustomToken);
        return;
      }

      await currentUser.getIdToken();
    } catch {
      await auth.signInWithCustomToken(firebaseCustomToken);
    }
  }

  async function ensureFirestorePersistence() {
    if (!db?.enablePersistence) {
      return;
    }
    if (firestorePersistencePromise) {
      return firestorePersistencePromise;
    }
    firestorePersistencePromise = runWithSuppressedFirestorePersistenceWarning(() =>
      db.enablePersistence(FIRESTORE_PERSISTENCE_OPTIONS)
    ).catch((error) => {
      const code = normalizeText(error?.code);
      if (code !== "failed-precondition" && code !== "unimplemented") {
        throw error;
      }
    });
    return firestorePersistencePromise;
  }

  function readReferrerOrigin() {
    try {
      return new URL(global.document?.referrer || "").origin;
    } catch {
      return "";
    }
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

  function subscribePromptLibraryMeta(payload) {
    const providerUserKey = normalizeText(payload.providerUserKey);
    if (!providerUserKey || !db) {
      return;
    }
    clearPromptLibraryMeta();
    unsubscribePromptLibraryMeta = db
      .collection(connectedFirestoreCollections.accountsCollection)
      .doc(providerUserKey)
      .onSnapshot(
        (snapshot) => {
          sendMessage("prompt-library-meta", {
            hasPendingWrites: Boolean(snapshot?.metadata?.hasPendingWrites),
            fromCache: Boolean(snapshot?.metadata?.fromCache),
            remoteState: serializePromptLibraryMeta(snapshot, providerUserKey),
            requestId: currentRequestId,
          });
        },
        (error) => {
          sendError("prompt-library-meta", error);
        }
      );
  }

  function subscribeStoreLatest() {
    if (!db) {
      return;
    }
    clearStoreLatest();
    ensureStoreFeedSubscription(0);
    unsubscribeStoreSummary = db
      .collection(connectedFirestoreCollections.storeSummaryCollection)
      .doc(STORE_SUMMARY_DOC_ID)
      .onSnapshot(
        (snapshot) => {
          storeSummarySnapshot = snapshot;
          syncStoreFeedSubscriptions();
          emitStoreLatestSnapshot();
        },
        (error) => {
          sendError("store-latest", error);
        }
      );
  }

  function emitStoreLatestSnapshot() {
    global.clearTimeout(storeLatestEmitTimer);
    storeLatestEmitTimer = global.setTimeout(() => {
      flushStoreLatestSnapshot();
    }, 40);
  }

  function flushStoreLatestSnapshot() {
    const latestFeedPageId = buildLatestFeedPageId(0);
    const feedSnapshots = Array.from(storeFeedSnapshots.values());
    if (!storeSummarySnapshot || !storeFeedReadyPages.has(latestFeedPageId)) {
      return;
    }
    const sourceSnapshots = [storeSummarySnapshot, ...feedSnapshots].filter(Boolean);
    const payload = {
      categoryId: "all",
      checkedAt: new Date().toISOString(),
      fromCache: sourceSnapshots.length > 0 && sourceSnapshots.every((snapshot) => Boolean(snapshot?.metadata?.fromCache)),
      hasPendingWrites: sourceSnapshots.some((snapshot) => Boolean(snapshot?.metadata?.hasPendingWrites)),
      items: serializeStoreFeedItems(feedSnapshots),
      requestId: currentRequestId,
      summary: serializeStoreSummary(storeSummarySnapshot),
    };
    const signature = buildStoreLatestSignature(payload);
    if (signature === lastStoreLatestSignature) {
      return;
    }
    lastStoreLatestSignature = signature;
    sendMessage("store-latest", payload);
  }

  function disconnectAll() {
    clearPromptLibraryMeta();
    clearStoreLatest();
    connectedFirestoreCollections = { ...DEFAULT_FIRESTORE_COLLECTIONS };
    connectedPromptPanelScope = DEFAULT_PROMPT_PANEL_SCOPE;
  }

  async function loadStoreDetail(payload) {
    const entryId = normalizeText(payload.entryId);
    const detailRequestId = normalizeText(payload.detailRequestId);
    if (!entryId || !db) {
      return;
    }
    try {
      const snapshot = await db
        .collection(connectedFirestoreCollections.storeDetailCollection)
        .doc(entryId)
        .get();
      if (!snapshot?.exists) {
        throw new Error("스토어 상세를 찾지 못했어요.");
      }
      const data = snapshot.data() || {};
      sendMessage("store-detail", {
        content: normalizeContent(data.content),
        detailRequestId,
        entryId,
        fromCache: Boolean(snapshot?.metadata?.fromCache),
        hasPendingWrites: Boolean(snapshot?.metadata?.hasPendingWrites),
        requestId: currentRequestId,
        updatedAt: normalizeText(data.updatedAt),
      });
    } catch (error) {
      sendError("store-detail", error, {
        detailRequestId,
        entryId,
      });
    }
  }

  function clearPromptLibraryMeta() {
    if (typeof unsubscribePromptLibraryMeta === "function") {
      unsubscribePromptLibraryMeta();
    }
    unsubscribePromptLibraryMeta = null;
  }

  function clearStoreLatest() {
    global.clearTimeout(storeLatestEmitTimer);
    storeLatestEmitTimer = 0;
    lastStoreLatestSignature = "";
    if (typeof unsubscribeStoreSummary === "function") {
      unsubscribeStoreSummary();
    }
    for (const unsubscribe of unsubscribeStoreFeeds.values()) {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    }
    unsubscribeStoreSummary = null;
    unsubscribeStoreFeeds = new Map();
    storeSummarySnapshot = null;
    storeFeedSnapshots = new Map();
    storeFeedReadyPages = new Set();
  }

  function serializePromptLibraryMeta(snapshot, providerUserKey) {
    const data = snapshot?.data && typeof snapshot.data === "function" ? snapshot.data() || {} : {};
    const meta = normalizePromptLibraryMeta(data.promptLibraryMeta);
    return {
      checkedAt: new Date().toISOString(),
      found: Boolean(snapshot?.exists && normalizeText(data.promptLibraryId)),
      itemCount: meta.itemCount,
      lastRevision: meta.lastRevision,
      lastSyncedAt: meta.lastSyncedAt,
      providerUserKey: normalizeText(providerUserKey),
      updatedAt: meta.updatedAt,
      version: meta.version,
    };
  }

  function serializeStoreSummary(snapshot) {
    const data = snapshot?.data && typeof snapshot.data === "function" ? snapshot.data() || {} : {};
    const categories = {};
    for (const [categoryId, count] of Object.entries(data.categories || {})) {
      const normalizedCategoryId = normalizeCategoryId(categoryId);
      const normalizedCount = Math.max(0, Number(count) || 0);
      if (normalizedCategoryId !== "all" && normalizedCount > 0) {
        categories[normalizedCategoryId] = normalizedCount;
      }
    }
    return {
      categories,
      totalPublished: Math.max(0, Number(data.totalPublished) || 0),
      updatedAt: normalizeText(data.updatedAt),
    };
  }

  function serializeStoreFeedItems(snapshots) {
    if (!Array.isArray(snapshots)) {
      return [];
    }
    const items = [];
    for (const snapshot of snapshots.sort(compareFeedSnapshots)) {
      const data = snapshot?.data && typeof snapshot.data === "function" ? snapshot.data() || {} : {};
      const pageItems = Array.isArray(data.items)
        ? data.items.map((item) => cloneJson(item)).filter((item) => normalizeText(item?.entryId))
        : [];
      items.push(...pageItems);
      if (items.length >= STORE_LATEST_LOCAL_LIMIT) {
        break;
      }
    }
    return items.slice(0, STORE_LATEST_LOCAL_LIMIT);
  }

  function normalizePromptLibraryMeta(promptLibraryMeta) {
    return {
      itemCount: Math.max(0, Number(promptLibraryMeta?.itemCount) || 0),
      lastRevision: normalizeText(promptLibraryMeta?.lastRevision),
      lastSyncedAt: normalizeText(promptLibraryMeta?.lastSyncedAt),
      updatedAt: normalizeText(promptLibraryMeta?.updatedAt),
      version: Math.max(1, Number(promptLibraryMeta?.version) || 1),
    };
  }

  function buildLatestFeedPageId(pageNumber) {
    return `latest__all__${String(Math.max(0, Number(pageNumber) || 0)).padStart(4, "0")}`;
  }

  function normalizeCategoryId(value) {
    const normalized = normalizeText(value).toLowerCase();
    return normalized || "all";
  }

  function resolveFirestoreCollections(input) {
    const nextCollections = input && typeof input === "object" ? input : {};
    return {
      accountsCollection: normalizeText(nextCollections.accountsCollection) || DEFAULT_FIRESTORE_COLLECTIONS.accountsCollection,
      storeDetailCollection: normalizeText(nextCollections.storeDetailCollection) || DEFAULT_FIRESTORE_COLLECTIONS.storeDetailCollection,
      storeFeedCollection: normalizeText(nextCollections.storeFeedCollection) || DEFAULT_FIRESTORE_COLLECTIONS.storeFeedCollection,
      storeSummaryCollection: normalizeText(nextCollections.storeSummaryCollection) || DEFAULT_FIRESTORE_COLLECTIONS.storeSummaryCollection,
    };
  }

  function compareFeedSnapshots(left, right) {
    return getFeedPageNumber(left) - getFeedPageNumber(right);
  }

  function getFeedPageNumber(snapshot) {
    const data = snapshot?.data && typeof snapshot.data === "function" ? snapshot.data() || {} : {};
    return Math.max(0, Number(data.pageNumber) || 0);
  }

  function syncStoreFeedSubscriptions() {
    const totalPublished = Math.max(0, Number(storeSummarySnapshot?.data?.()?.totalPublished) || 0);
    const requiredPageCount = Math.max(1, Math.min(STORE_FEED_PAGE_COUNT, Math.ceil(totalPublished / STORE_FEED_PAGE_SIZE) || 1));
    for (let pageNumber = 0; pageNumber < requiredPageCount; pageNumber += 1) {
      ensureStoreFeedSubscription(pageNumber);
    }
    for (const [pageId, unsubscribe] of Array.from(unsubscribeStoreFeeds.entries())) {
      const pageNumber = parseFeedPageNumber(pageId);
      if (pageNumber < requiredPageCount) {
        continue;
      }
      try {
        unsubscribe?.();
      } catch {}
      unsubscribeStoreFeeds.delete(pageId);
      storeFeedSnapshots.delete(pageId);
      storeFeedReadyPages.delete(pageId);
    }
  }

  function ensureStoreFeedSubscription(pageNumber) {
    const pageId = buildLatestFeedPageId(pageNumber);
    if (unsubscribeStoreFeeds.has(pageId)) {
      return;
    }
    const unsubscribe = db
      .collection(connectedFirestoreCollections.storeFeedCollection)
      .doc(pageId)
      .onSnapshot(
        (snapshot) => {
          storeFeedReadyPages.add(pageId);
          if (snapshot?.exists) {
            storeFeedSnapshots.set(pageId, snapshot);
          } else {
            storeFeedSnapshots.delete(pageId);
          }
          emitStoreLatestSnapshot();
        },
        (error) => {
          sendError("store-latest", error);
        }
      );
    unsubscribeStoreFeeds.set(pageId, unsubscribe);
  }

  function parseFeedPageNumber(pageId) {
    const match = String(pageId || "").match(/__(\d{4})$/);
    return match ? Math.max(0, Number(match[1]) || 0) : 0;
  }

  function buildStoreLatestSignature(payload) {
    const items = Array.isArray(payload?.items)
      ? payload.items.map((item) => ({
        entryId: normalizeText(item?.entryId),
        imported: Boolean(item?.viewer?.imported),
        liked: Boolean(item?.viewer?.liked),
        likeCount: Math.max(0, Number(item?.metrics?.likeCount) || 0),
        title: normalizeText(item?.title),
        updatedAt: normalizeText(item?.updatedAt),
        viewCount: Math.max(0, Number(item?.metrics?.viewCount) || 0),
      }))
      : [];
    return JSON.stringify({
      categories: payload?.summary?.categories || {},
      fromCache: Boolean(payload?.fromCache),
      hasPendingWrites: Boolean(payload?.hasPendingWrites),
      items,
      requestId: Math.max(0, Number(payload?.requestId) || 0),
      totalPublished: Math.max(0, Number(payload?.summary?.totalPublished) || 0),
      updatedAt: normalizeText(payload?.summary?.updatedAt),
    });
  }

  function sendError(channel, error, payload = {}) {
    sendMessage("error", {
      channel: normalizeText(channel),
      error: normalizeText(error?.message) || "프롬프트 패널 Firestore 구독에 실패했어요.",
      ...cloneJson(payload),
      requestId: currentRequestId,
    });
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

  function normalizeContent(value) {
    return String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function isLocalBridgeOrigin() {
    return LOCAL_BRIDGE_ORIGINS.has(String(global.location?.origin || ""));
  }

  function resolveLocalEmulatorHost() {
    const hostname = normalizeText(global.location?.hostname).toLowerCase();
    return hostname === "localhost" ? "localhost" : "127.0.0.1";
  }
})(globalThis);
