(function initPromptLibraryFirestoreClient(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const utils = namespace.panelUtils || {};
  const normalizeText = typeof utils.normalizeText === "function"
    ? utils.normalizeText
    : namespace.session.normalizeText;
  const READER = "prompt-library";

  const client = namespace.baseFirestoreClient?.createBaseFirestoreClient?.({
    asyncErrorMessage: "프롬프트 보관함 Firestore 처리를 마치지 못했어요.",
    authErrorMessage: "프롬프트 보관함 Firestore 인증 정보를 준비하지 못했어요.",
    buildListenTrace(panelAuth) {
      return {
        collection: panelAuth.promptFirestoreCollections.accountsCollection,
      };
    },
    buildLiveContext(state) {
      return {
        refreshSerial: ++state.refreshSerial,
      };
    },
    buildRequestContext({ providerIdentity, providerUserKey, target }) {
      return {
        providerIdentity,
        providerUserKey,
        target,
      };
    },
    buildSnapshotSignature,
    buildSubscriptionKey,
    createTarget({ panelAuth, session }) {
      return session.db
        .collection(panelAuth.promptFirestoreCollections.accountsCollection)
        .doc(panelAuth.providerUserKey);
    },
    missingIdentityMessage: "프롬프트 사용자 정보를 찾지 못했어요.",
    normalizePanelAuth,
    normalizeSnapshot(snapshot, context) {
      const refreshSerial = Number(context?.liveContext?.refreshSerial) || Number(context?.state?.refreshSerial) || 0;
      return normalizeAccountSnapshot(
        context.session.db,
        snapshot,
        context.panelAuth,
        refreshSerial,
        context.state
      );
    },
    panel: "prompt",
    reader: READER,
    readSnapshotCount(snapshot) {
      return Array.isArray(snapshot?.promptLibrary?.items) ? snapshot.promptLibrary.items.length : 0;
    },
    subscriptionErrorMessage: "프롬프트 보관함 Firestore 구독이 끊겼어요.",
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
        accountsCollection: normalizeText(promptFirestoreCollections.accountsCollection),
        promptLibraryChunksCollection: normalizeText(promptFirestoreCollections.promptLibraryChunksCollection),
        promptLibraryOrdersCollection: normalizeText(promptFirestoreCollections.promptLibraryOrdersCollection),
      },
      promptLibraryId: normalizeText(panelAuth.promptLibraryId),
      promptPanelScope: normalizeText(panelAuth.panelScope || panelAuth.promptPanelScope) || "prompt-panel",
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

  async function normalizeAccountSnapshot(db, snapshot, panelAuth, refreshSerial, state) {
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

  namespace.promptLibraryFirestoreClient = { create: client.create };
})(globalThis);
