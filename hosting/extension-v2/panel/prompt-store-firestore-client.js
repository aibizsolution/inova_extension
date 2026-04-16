(function initPromptStoreFirestoreClient(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const utils = namespace.panelUtils || {};
  const cloneValue = typeof utils.cloneValue === "function"
    ? utils.cloneValue
    : (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
  const normalizeText = typeof utils.normalizeText === "function"
    ? utils.normalizeText
    : namespace.session.normalizeText;
  const ENTRY_COLLECTION = "prompt_store_entries";
  const READER = "prompt-store";

  const client = namespace.baseFirestoreClient?.createBaseFirestoreClient?.({
    asyncErrorMessage: "스토어 Firestore 처리를 마치지 못했어요.",
    authErrorMessage: "스토어 Firestore 인증 정보를 준비하지 못했어요.",
    buildListenTrace(panelAuth, context) {
      return {
        collection: panelAuth.promptFirestoreCollections.storeEntriesCollection,
        limit: context.queryLimit,
      };
    },
    buildRequestContext({ providerIdentity, providerUserKey, request, target }) {
      return {
        providerIdentity,
        providerUserKey,
        queryLimit: Math.max(1, Math.min(1000, Number(request?.queryLimit) || 1000)),
        target,
      };
    },
    buildSnapshotSignature,
    buildSubscriptionKey,
    createTarget({ context, panelAuth, session }) {
      return session.db
        .collection(panelAuth.promptFirestoreCollections.storeEntriesCollection)
        .where("status", "==", "published")
        .orderBy("publishedAt", "desc")
        .limit(context.queryLimit);
    },
    missingIdentityMessage: "프롬프트 사용자 정보를 찾지 못했어요.",
    normalizePanelAuth,
    normalizeSnapshot: normalizeQuerySnapshot,
    panel: "prompt",
    reader: READER,
    readSnapshotCount(snapshot) {
      return Array.isArray(snapshot?.items) ? snapshot.items.length : 0;
    },
    resetSubscriptionOnError: true,
    subscriptionErrorMessage: "스토어 목록 Firestore 구독이 끊겼어요.",
  });

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
        storeEntriesCollection: normalizeText(promptFirestoreCollections.storeEntriesCollection) || ENTRY_COLLECTION,
      },
      promptPanelScope: normalizeText(panelAuth.panelScope || panelAuth.promptPanelScope) || "prompt-panel",
      providerUserKey: normalizeText(panelAuth.providerUserKey),
      target: normalizeText(panelAuth.target).toLowerCase() === "local" ? "local" : "production",
    };
    if (!normalized.providerUserKey || !normalized.firebaseCustomToken || !normalized.firebaseConfig.projectId) {
      throw new Error("스토어 Firestore 인증 정보를 준비하지 못했어요.");
    }
    return normalized;
  }

  function normalizeQuerySnapshot(snapshot) {
    const items = (Array.isArray(snapshot?.docs) ? snapshot.docs : []).map(serializeDocument);
    return {
      availableCategories: buildAvailableCategories(items),
      checkedAt: new Date().toISOString(),
      fromCache: Boolean(snapshot?.metadata?.fromCache),
      hasPendingWrites: Boolean(snapshot?.metadata?.hasPendingWrites),
      items,
      totalCount: items.length,
    };
  }

  function serializeDocument(doc) {
    const data = doc?.data && typeof doc.data === "function" ? doc.data() : {};
    return {
      ...cloneValue(data),
      entryId: normalizeText(data?.entryId || doc?.id),
    };
  }

  function buildAvailableCategories(items) {
    const categories = new Map();
    categories.set("all", { id: "all", label: "전체" });
    for (const item of Array.isArray(items) ? items : []) {
      const categoryId = normalizeText(item?.categoryId).toLowerCase();
      if (!categoryId || categoryId === "all") {
        continue;
      }
      if (!categories.has(categoryId)) {
        categories.set(categoryId, {
          id: categoryId,
          label: normalizeText(item?.categoryLabel) || categoryId,
        });
      }
    }
    return Array.from(categories.values());
  }

  function buildSnapshotSignature(snapshot) {
    return JSON.stringify({
      docs: (Array.isArray(snapshot?.items) ? snapshot.items : []).map((item) => [
        normalizeText(item?.entryId),
        normalizeText(item?.updatedAt || item?.publishedAt),
        String(Number(item?.metrics?.viewCount) || 0),
        String(Number(item?.metrics?.importCount) || 0),
        String(Number(item?.metrics?.likeCount) || 0),
      ].join("~")),
      fromCache: Boolean(snapshot?.fromCache),
      hasPendingWrites: Boolean(snapshot?.hasPendingWrites),
    });
  }

  function buildSubscriptionKey(panelAuth, context) {
    return [
      buildRuntimeKey(panelAuth),
      panelAuth.providerUserKey,
      panelAuth.expiresAt,
      panelAuth.promptFirestoreCollections.storeEntriesCollection,
      String(context.queryLimit),
    ].join("::");
  }

  function buildRuntimeKey(panelAuth) {
    return JSON.stringify({
      authUrl: normalizeText(panelAuth?.emulators?.authUrl),
      enabled: Boolean(panelAuth?.emulators?.enabled),
      firestoreHost: normalizeText(panelAuth?.emulators?.firestoreHost),
      firestorePort: Number(panelAuth?.emulators?.firestorePort) || 0,
      projectId: normalizeText(panelAuth?.firebaseConfig?.projectId),
      storeEntriesCollection: normalizeText(panelAuth?.promptFirestoreCollections?.storeEntriesCollection),
      target: normalizeText(panelAuth?.target),
    });
  }

  namespace.promptStoreFirestoreClient = { create: client.create };
})(globalThis);
