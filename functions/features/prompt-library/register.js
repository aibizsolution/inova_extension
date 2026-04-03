const MAX_PROMPT_ITEMS = 1000;
const PROMPT_LIBRARY_BUCKET_COUNT = 24;
const DEFAULT_PROMPT_PANEL_SESSION_TTL_MS = 60 * 60 * 1000;

function registerPromptLibraryHandlers(deps) {
  const {
    admin,
    buildPromptLibraryId,
    buildPromptPanelFirebaseUid,
    CORS_ORIGINS,
    createHttpError,
    db,
    logEvent,
    MAX_CONTENT_LENGTH,
    MAX_TITLE_LENGTH,
    normalizeIdentity,
    normalizePromptContent,
    normalizeText,
    onRequest,
    REGION,
    sendError,
    verifyInovaIdentity,
  } = deps;

  const issueInovaPromptPanelAuth = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const providerIdentity = normalizeIdentity(request.body?.providerIdentity || request.body?.owner);
      const owner = await verifyInovaIdentity(providerIdentity, request);
      const expiresAt = new Date(Date.now() + DEFAULT_PROMPT_PANEL_SESSION_TTL_MS).toISOString();
      const promptPanelExpMs = Date.parse(expiresAt);
      const promptLibraryId = buildPromptLibraryId(owner.providerUserKey);
      const firebaseCustomToken = await admin.auth().createCustomToken(buildPromptPanelFirebaseUid(owner.providerUserKey), {
        promptLibraryId,
        promptPanelExpMs,
        providerUserKey: owner.providerUserKey,
        scope: "prompt-panel",
      });

      logEvent("prompt.panel-auth.issue.success", {
        promptLibraryId,
        providerUserKey: owner.providerUserKey,
      });
      response.json({
        ok: true,
        data: {
          expiresAt,
          firebaseCustomToken,
          promptLibraryId,
          providerUserKey: owner.providerUserKey,
        },
      });
    } catch (error) {
      logEvent("prompt.panel-auth.issue.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const loadInovaPromptLibrary = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const providerIdentity = normalizeIdentity(request.body?.providerIdentity || request.body?.owner);
      logEvent("load.start", {
        providerUserKey: providerIdentity.providerUserKey,
      });
      await verifyInovaIdentity(providerIdentity, request);

      const libraryId = buildPromptLibraryId(providerIdentity.providerUserKey);
      const snapshot = await db.collection("prompt_libraries").doc(libraryId).get();
      const libraryState = await loadPersistedPromptLibrary(libraryId, snapshot);
      if (!libraryState.found) {
        logEvent("load.success", {
          found: false,
          itemCount: 0,
          libraryId,
          providerUserKey: providerIdentity.providerUserKey,
        });
        response.json({
          ok: true,
          data: {
            found: false,
            libraryId,
            owner: providerIdentity,
            promptLibrary: { itemCount: 0, items: [], updatedAt: "", version: 1 },
            syncedAt: "",
          },
        });
        return;
      }

      const promptLibrary = libraryState.promptLibrary;
      logEvent("load.success", {
        found: true,
        itemCount: promptLibrary.itemCount,
        libraryId,
        providerUserKey: providerIdentity.providerUserKey,
      });
      response.json({
        ok: true,
        data: {
          found: true,
          libraryId,
          owner: normalizeIdentity(libraryState.owner || providerIdentity),
          promptLibrary,
          syncedAt: libraryState.syncedAt,
        },
      });
    } catch (error) {
      logEvent("load.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const peekInovaPromptLibrary = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const providerIdentity = normalizeIdentity(request.body?.providerIdentity || request.body?.owner);
      logEvent("peek.start", {
        providerUserKey: providerIdentity.providerUserKey,
      });
      const owner = await verifyInovaIdentity(providerIdentity, request);
      const snapshot = await db.collection("integration_inova_accounts").doc(owner.providerUserKey).get();
      const checkedAt = new Date().toISOString();

      if (!snapshot.exists) {
        logEvent("peek.success", {
          found: false,
          itemCount: 0,
          providerUserKey: owner.providerUserKey,
        });
        response.json({
          ok: true,
          data: {
            checkedAt,
            found: false,
            itemCount: 0,
            lastRevision: "",
            lastSyncedAt: "",
            providerUserKey: owner.providerUserKey,
            updatedAt: "",
            version: 1,
          },
        });
        return;
      }

      const data = snapshot.data() || {};
      const meta = normalizePromptLibraryMeta(data.promptLibraryMeta);
      logEvent("peek.success", {
        found: true,
        itemCount: meta.itemCount,
        providerUserKey: owner.providerUserKey,
      });
      response.json({
        ok: true,
        data: {
          checkedAt,
          found: Boolean(data.promptLibraryId),
          itemCount: meta.itemCount,
          lastRevision: meta.lastRevision,
          lastSyncedAt: meta.lastSyncedAt,
          providerUserKey: owner.providerUserKey,
          updatedAt: meta.updatedAt,
          version: meta.version,
        },
      });
    } catch (error) {
      logEvent("peek.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const syncInovaPromptLibrary = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const syncDocument = normalizeSyncDocument(request.body);
      logEvent("sync.start", {
        itemCount: syncDocument.promptLibrary.itemCount,
        providerUserKey: syncDocument.owner.providerUserKey,
        reason: syncDocument.sync.reason,
        revision: syncDocument.sync.revision,
      });
      const owner = await verifyInovaIdentity(syncDocument.owner, request);
      const libraryId = buildPromptLibraryId(owner.providerUserKey);
      const syncedAt = new Date().toISOString();
      const librarySnapshot = await db.collection("prompt_libraries").doc(libraryId).get();
      const currentState = await loadPersistedPromptLibraryRecord(libraryId, librarySnapshot);
      const { bucketIds, promptLibrary } = await syncPromptLibraryState(libraryId, currentState, syncDocument);
      const promptLibraryMeta = buildPromptLibraryMeta(promptLibrary, syncDocument.sync.revision, syncedAt, bucketIds);

      await Promise.all([
        db.collection("integration_inova_accounts").doc(owner.providerUserKey).set(
          {
            provider: owner.provider,
            providerUserKey: owner.providerUserKey,
            email: owner.email,
            displayName: owner.displayName,
            numericUserId: owner.numericUserId,
            lastPromptSyncAt: syncedAt,
            promptLibraryId: libraryId,
            promptLibraryMeta,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        ),
        db.collection("prompt_libraries").doc(libraryId).set(
          {
            schemaVersion: 2,
            libraryId,
            source: {
              integration: "inova",
              kind: "prompt-library-sync",
            },
            owner,
            promptLibrary: {
              itemCount: promptLibrary.itemCount,
              updatedAt: promptLibrary.updatedAt,
              version: promptLibrary.version,
            },
            promptLibraryMeta,
            sync: {
              lastReason: normalizeText(syncDocument?.sync?.reason),
              lastRevision: normalizeText(syncDocument?.sync?.revision),
              lastSyncedAt: syncedAt,
              projectId: normalizeText(syncDocument?.projectId),
              region: normalizeText(syncDocument?.region),
              status: "synced",
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        ),
      ]);

      logEvent("sync.success", {
        itemCount: promptLibrary.itemCount,
        libraryId,
        providerUserKey: owner.providerUserKey,
        reason: syncDocument.sync.reason,
        revision: syncDocument.sync.revision,
        syncedAt,
      });
      response.json({
        ok: true,
        data: {
          libraryId,
          owner,
          promptLibrary: {
            itemCount: promptLibrary.itemCount,
            updatedAt: promptLibrary.updatedAt,
            version: promptLibrary.version,
          },
          syncedAt,
        },
      });
    } catch (error) {
      logEvent("sync.error", {
        error: normalizeText(error?.message),
        reason: normalizeText(request.body?.sync?.reason),
        revision: normalizeText(request.body?.sync?.revision),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  return {
    issueInovaPromptPanelAuth,
    loadInovaPromptLibrary,
    peekInovaPromptLibrary,
    syncInovaPromptLibrary,
  };

  function normalizeSyncDocument(input) {
    const legacyPromptLibrary = Array.isArray(input?.promptLibrary?.items) ? normalizePromptLibrary(input?.promptLibrary) : null;
    return {
      owner: normalizeIdentity(input?.owner),
      projectId: normalizeText(input?.projectId),
      operation: normalizeSyncOperation(input?.operation, legacyPromptLibrary),
      promptLibrary: normalizePromptLibraryDescriptor(input?.promptLibrary, legacyPromptLibrary),
      region: normalizeText(input?.region),
      sync: {
        reason: normalizeText(input?.sync?.reason),
        revision: normalizeText(input?.sync?.revision),
      },
    };
  }

  function normalizeStoredPromptLibrary(promptLibrary) {
    const normalized = normalizePromptLibrary(promptLibrary);
    return {
      itemCount: normalized.itemCount,
      items: normalized.items,
      updatedAt: normalized.updatedAt,
      version: normalized.version,
    };
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

  function normalizePromptLibraryDescriptor(promptLibrary, legacyPromptLibrary) {
    if (legacyPromptLibrary) {
      return {
        itemCount: legacyPromptLibrary.itemCount,
        updatedAt: legacyPromptLibrary.updatedAt,
        version: legacyPromptLibrary.version,
      };
    }

    return {
      itemCount: Math.max(0, Number(promptLibrary?.itemCount) || 0),
      updatedAt: normalizeText(promptLibrary?.updatedAt),
      version: Math.max(1, Number(promptLibrary?.version) || 1),
    };
  }

  function normalizePromptLibrary(promptLibrary) {
    const items = Array.isArray(promptLibrary?.items) ? promptLibrary.items.slice(0, MAX_PROMPT_ITEMS) : [];
    const normalizedItems = items
      .map(normalizePromptItem)
      .filter(Boolean);

    return {
      itemCount: normalizedItems.length,
      items: normalizedItems,
      updatedAt: normalizeText(promptLibrary?.updatedAt) || getLatestUpdatedAt(normalizedItems),
      version: Number(promptLibrary?.version) || 1,
    };
  }

  function normalizeSyncOperation(operation, legacyPromptLibrary) {
    if (legacyPromptLibrary) {
      return {
        orderedIds: legacyPromptLibrary.items.map((item) => item.id),
        promptLibrary: legacyPromptLibrary,
        type: "replace-library",
      };
    }

    const type = normalizeText(operation?.type);
    if (type === "upsert-item") {
      const item = normalizePromptItem(operation?.item);
      return item ? { item, orderedIds: normalizeOrderedIds(operation?.orderedIds), type } : createEmptyReplaceOperation();
    }
    if (type === "delete-item") {
      const promptId = normalizeText(operation?.promptId);
      return promptId ? { orderedIds: normalizeOrderedIds(operation?.orderedIds), promptId, type } : createEmptyReplaceOperation();
    }
    if (type === "reorder-library") {
      return {
        orderedIds: normalizeOrderedIds(operation?.orderedIds),
        type,
      };
    }
    if (type === "replace-library") {
      const promptLibrary = normalizePromptLibrary(operation?.promptLibrary);
      return {
        orderedIds: promptLibrary.items.map((item) => item.id),
        promptLibrary,
        type,
      };
    }
    return createEmptyReplaceOperation();
  }

  function normalizePromptItem(item) {
    const title = normalizeText(item?.title).slice(0, MAX_TITLE_LENGTH);
    const content = normalizePromptContent(item?.content).slice(0, MAX_CONTENT_LENGTH);
    if (!title || !content) {
      return null;
    }

    return {
      id: normalizeText(item?.id) || createFallbackPromptId(title),
      title,
      content,
      createdAt: normalizeText(item?.createdAt) || new Date().toISOString(),
      updatedAt: normalizeText(item?.updatedAt) || new Date().toISOString(),
    };
  }

  function getLatestUpdatedAt(items) {
    let latest = "";
    for (const item of items) {
      const updatedAt = normalizeText(item?.updatedAt);
      if (updatedAt && (!latest || updatedAt > latest)) {
        latest = updatedAt;
      }
    }
    return latest;
  }

  function buildPromptLibraryMeta(promptLibrary, revision, syncedAt, bucketIds) {
    return {
      bucketIds: normalizeBucketIds(bucketIds),
      itemCount: promptLibrary.itemCount,
      lastRevision: normalizeText(revision),
      lastSyncedAt: normalizeText(syncedAt),
      updatedAt: normalizeText(promptLibrary.updatedAt),
      version: promptLibrary.version,
    };
  }

  async function loadPersistedPromptLibrary(libraryId, snapshot) {
    const record = await loadPersistedPromptLibraryRecord(libraryId, snapshot);
    if (!record.found) {
      return record;
    }
    return {
      ...record,
      promptLibrary: record.legacy
        ? record.promptLibrary
        : await buildPromptLibraryFromStoredChunks(libraryId, record.meta),
    };
  }

  async function loadPersistedPromptLibraryRecord(libraryId, snapshot) {
    if (!snapshot?.exists) {
      return {
        found: false,
        legacy: false,
        meta: normalizePromptLibraryMeta(null),
        owner: null,
        promptLibrary: normalizeStoredPromptLibrary(null),
        syncedAt: "",
      };
    }

    const data = snapshot.data() || {};
    const legacyPromptLibrary = Array.isArray(data?.promptLibrary?.items) ? normalizeStoredPromptLibrary(data.promptLibrary) : null;
    return {
      found: true,
      legacy: Boolean(legacyPromptLibrary),
      meta: legacyPromptLibrary
        ? buildPromptLibraryMeta(legacyPromptLibrary, data?.sync?.lastRevision, data?.sync?.lastSyncedAt, getBucketIdsFromPromptLibrary(legacyPromptLibrary))
        : normalizePromptLibraryMeta(data.promptLibraryMeta || data.promptLibrary),
      owner: normalizeIdentity(data.owner),
      promptLibrary: legacyPromptLibrary,
      syncedAt: normalizeText(data?.sync?.lastSyncedAt),
    };
  }

  async function buildPromptLibraryFromStoredChunks(libraryId, meta) {
    const [orderedIds, chunkGroups] = await Promise.all([
      loadPromptLibraryOrder(libraryId),
      loadPromptLibraryChunks(libraryId, meta.bucketIds),
    ]);
    const itemMap = new Map();
    for (const items of chunkGroups) {
      for (const item of items) {
        itemMap.set(item.id, item);
      }
    }

    const nextItems = [];
    for (const orderedId of orderedIds) {
      const item = itemMap.get(orderedId);
      if (!item) continue;
      nextItems.push(item);
      itemMap.delete(orderedId);
    }

    const remainingItems = Array.from(itemMap.values()).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    return {
      itemCount: nextItems.length + remainingItems.length,
      items: [...nextItems, ...remainingItems],
      updatedAt: meta.updatedAt || getLatestUpdatedAt([...nextItems, ...remainingItems]),
      version: meta.version,
    };
  }

  async function syncPromptLibraryState(libraryId, currentState, syncDocument) {
    if (currentState.legacy) {
      const promptLibrary = applyPromptLibraryOperation(currentState.promptLibrary, syncDocument.operation);
      const bucketIds = await writePromptLibrarySnapshot(libraryId, promptLibrary, currentState.meta.bucketIds);
      return { bucketIds, promptLibrary };
    }

    if (syncDocument.operation.type === "replace-library") {
      const promptLibrary = normalizeStoredPromptLibrary(syncDocument.operation.promptLibrary);
      const bucketIds = await writePromptLibrarySnapshot(libraryId, promptLibrary, currentState.meta.bucketIds);
      return { bucketIds, promptLibrary };
    }

    if (syncDocument.operation.type === "upsert-item") {
      return syncPromptLibraryUpsert(libraryId, currentState.meta, syncDocument);
    }

    if (syncDocument.operation.type === "delete-item") {
      return syncPromptLibraryDelete(libraryId, currentState.meta, syncDocument);
    }

    return syncPromptLibraryReorder(libraryId, currentState.meta, syncDocument);
  }

  async function syncPromptLibraryUpsert(libraryId, meta, syncDocument) {
    const operation = syncDocument.operation;
    const bucketId = getPromptLibraryBucketId(operation.item.id);
    const chunkRef = getPromptLibraryChunkRef(libraryId, bucketId);
    const chunkItems = normalizePromptChunkItems((await chunkRef.get()).data()?.items);
    const currentIndex = chunkItems.findIndex((item) => item.id === operation.item.id);
    if (currentIndex >= 0) {
      chunkItems[currentIndex] = operation.item;
    } else {
      chunkItems.push(operation.item);
    }

    const batch = db.batch();
    batch.set(chunkRef, buildPromptLibraryChunkDocument(libraryId, bucketId, chunkItems));
    batch.set(getPromptLibraryOrderRef(libraryId), buildPromptLibraryOrderDocument(libraryId, operation.orderedIds));
    await batch.commit();

    const bucketIds = normalizeBucketIds([...meta.bucketIds, bucketId]);
    return {
      bucketIds,
      promptLibrary: {
        itemCount: operation.orderedIds.length || Math.max(meta.itemCount, chunkItems.length),
        items: [],
        updatedAt: syncDocument.promptLibrary.updatedAt || getLatestUpdatedAt([operation.item]),
        version: syncDocument.promptLibrary.version,
      },
    };
  }

  async function syncPromptLibraryDelete(libraryId, meta, syncDocument) {
    const operation = syncDocument.operation;
    const bucketId = getPromptLibraryBucketId(operation.promptId);
    const chunkRef = getPromptLibraryChunkRef(libraryId, bucketId);
    const chunkItems = normalizePromptChunkItems((await chunkRef.get()).data()?.items).filter((item) => item.id !== operation.promptId);
    const batch = db.batch();
    if (chunkItems.length) {
      batch.set(chunkRef, buildPromptLibraryChunkDocument(libraryId, bucketId, chunkItems));
    } else {
      batch.delete(chunkRef);
    }
    batch.set(getPromptLibraryOrderRef(libraryId), buildPromptLibraryOrderDocument(libraryId, operation.orderedIds));
    await batch.commit();

    return {
      bucketIds: chunkItems.length ? normalizeBucketIds([...meta.bucketIds, bucketId]) : meta.bucketIds.filter((entry) => entry !== bucketId),
      promptLibrary: {
        itemCount: operation.orderedIds.length,
        items: [],
        updatedAt: syncDocument.promptLibrary.updatedAt,
        version: syncDocument.promptLibrary.version,
      },
    };
  }

  async function syncPromptLibraryReorder(libraryId, meta, syncDocument) {
    await getPromptLibraryOrderRef(libraryId).set(buildPromptLibraryOrderDocument(libraryId, syncDocument.operation.orderedIds), { merge: true });
    return {
      bucketIds: meta.bucketIds,
      promptLibrary: {
        itemCount: syncDocument.operation.orderedIds.length || syncDocument.promptLibrary.itemCount,
        items: [],
        updatedAt: syncDocument.promptLibrary.updatedAt,
        version: syncDocument.promptLibrary.version,
      },
    };
  }

  async function writePromptLibrarySnapshot(libraryId, promptLibrary, previousBucketIds) {
    const bucketMap = groupPromptItemsByBucket(promptLibrary.items);
    const nextBucketIds = Object.keys(bucketMap).sort();
    const batch = db.batch();
    batch.set(getPromptLibraryOrderRef(libraryId), buildPromptLibraryOrderDocument(libraryId, promptLibrary.items.map((item) => item.id)));
    for (const bucketId of nextBucketIds) {
      batch.set(getPromptLibraryChunkRef(libraryId, bucketId), buildPromptLibraryChunkDocument(libraryId, bucketId, bucketMap[bucketId]));
    }
    for (const bucketId of normalizeBucketIds(previousBucketIds).filter((bucketId) => !nextBucketIds.includes(bucketId))) {
      batch.delete(getPromptLibraryChunkRef(libraryId, bucketId));
    }
    await batch.commit();
    return nextBucketIds;
  }

  function applyPromptLibraryOperation(promptLibrary, operation) {
    const current = normalizeStoredPromptLibrary(promptLibrary);
    if (operation.type === "replace-library") {
      return normalizeStoredPromptLibrary(operation.promptLibrary);
    }

    const itemMap = new Map(current.items.map((item) => [item.id, item]));
    if (operation.type === "upsert-item") {
      itemMap.set(operation.item.id, operation.item);
    } else if (operation.type === "delete-item") {
      itemMap.delete(operation.promptId);
    }

    const orderedIds = operation.type === "reorder-library" ? operation.orderedIds : operation.orderedIds.length ? operation.orderedIds : current.items.map((item) => item.id);
    const nextItems = [];
    for (const orderedId of orderedIds) {
      const item = itemMap.get(orderedId);
      if (!item) continue;
      nextItems.push(item);
      itemMap.delete(orderedId);
    }
    const remainingItems = Array.from(itemMap.values());
    return normalizeStoredPromptLibrary({
      itemCount: nextItems.length + remainingItems.length,
      items: [...nextItems, ...remainingItems],
      updatedAt: getLatestUpdatedAt([...nextItems, ...remainingItems]),
      version: Math.max(1, Number(operation?.promptLibrary?.version) || current.version || 1),
    });
  }

  function groupPromptItemsByBucket(items) {
    return normalizePromptChunkItems(items).reduce((groups, item) => {
      const bucketId = getPromptLibraryBucketId(item.id);
      if (!groups[bucketId]) groups[bucketId] = [];
      groups[bucketId].push(item);
      return groups;
    }, {});
  }

  async function loadPromptLibraryOrder(libraryId) {
    const snapshot = await getPromptLibraryOrderRef(libraryId).get();
    return normalizeOrderedIds(snapshot.data()?.orderedIds);
  }

  async function loadPromptLibraryChunks(libraryId, bucketIds) {
    return Promise.all(normalizeBucketIds(bucketIds).map(async (bucketId) => normalizePromptChunkItems((await getPromptLibraryChunkRef(libraryId, bucketId).get()).data()?.items)));
  }

  function getPromptLibraryOrderRef(libraryId) {
    return db.collection("prompt_library_orders").doc(libraryId);
  }

  function getPromptLibraryChunkRef(libraryId, bucketId) {
    return db.collection("prompt_library_chunks").doc(`${libraryId}__${bucketId}`);
  }

  function buildPromptLibraryOrderDocument(libraryId, orderedIds) {
    return {
      libraryId,
      orderedIds: normalizeOrderedIds(orderedIds),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
  }

  function buildPromptLibraryChunkDocument(libraryId, bucketId, items) {
    const chunkItems = normalizePromptChunkItems(items);
    return {
      bucketId,
      itemCount: chunkItems.length,
      items: chunkItems,
      libraryId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
  }

  function normalizePromptChunkItems(items) {
    return (Array.isArray(items) ? items : []).map(normalizePromptItem).filter(Boolean);
  }

  function normalizeOrderedIds(orderedIds) {
    return Array.from(new Set((orderedIds || []).map((orderedId) => normalizeText(orderedId)).filter(Boolean)));
  }

  function normalizeBucketIds(bucketIds) {
    return Array.from(new Set((bucketIds || []).map((bucketId) => normalizeText(bucketId)).filter(Boolean))).sort();
  }

  function getBucketIdsFromPromptLibrary(promptLibrary) {
    return normalizeBucketIds((promptLibrary?.items || []).map((item) => getPromptLibraryBucketId(item.id)));
  }

  function getPromptLibraryBucketId(promptId) {
    let hash = 0;
    for (const character of String(promptId || "")) {
      hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    }
    return `b${String(hash % PROMPT_LIBRARY_BUCKET_COUNT).padStart(2, "0")}`;
  }

  function createEmptyReplaceOperation() {
    return {
      orderedIds: [],
      promptLibrary: normalizePromptLibrary(null),
      type: "replace-library",
    };
  }

  function createFallbackPromptId(seed) {
    return `prompt-${Buffer.from(seed).toString("base64url").slice(0, 16)}`;
  }

  function assertMethod(request) {
    if (request.method !== "POST") {
      throw createHttpError(405, "POST 요청만 지원해요.");
    }
  }
}

module.exports = {
  registerPromptLibraryHandlers,
};
