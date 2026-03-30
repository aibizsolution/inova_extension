const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { registerMeetingHandlers } = require("./meeting-service");
const { registerPromptReviewHandlers } = require("./prompt-review-service");
const { registerStoreHandlers } = require("./store-service");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const bucket = admin.storage().bucket();
const REGION = "asia-northeast3";
const CORS_ORIGINS = ["https://inova.incross.com"];
const STORE_CATEGORIES = [
  { id: "document", label: "문서 작성" },
  { id: "summary", label: "요약/정리" },
  { id: "analysis", label: "분석/리서치" },
  { id: "meeting", label: "회의/업무" },
  { id: "translation", label: "번역" },
  { id: "advertising", label: "광고/퍼포먼스" },
  { id: "marketing", label: "마케팅" },
  { id: "commerce", label: "커머스" },
  { id: "sales", label: "세일즈" },
  { id: "customer-success", label: "고객 성공/CS" },
  { id: "hr", label: "HR/피플" },
  { id: "finance", label: "재무/경영관리" },
  { id: "code", label: "코딩" },
  { id: "core-dev", label: "코어 개발" },
  { id: "language-specialists", label: "언어/프레임워크" },
  { id: "infrastructure", label: "인프라" },
  { id: "quality-security", label: "품질/보안" },
  { id: "data-ai", label: "데이터/AI" },
  { id: "developer-experience", label: "개발 경험" },
  { id: "specialized-domains", label: "전문 도메인" },
  { id: "business-product", label: "비즈니스/프로덕트" },
  { id: "meta-orchestration", label: "오케스트레이션" },
  { id: "research-analysis", label: "리서치/분석" },
  { id: "other", label: "기타" },
];
const STORE_CATEGORY_IDS = STORE_CATEGORIES.map((category) => category.id);
const MAX_PROMPT_ITEMS = 1000;
const MAX_TITLE_LENGTH = 120;
const MAX_CONTENT_LENGTH = 12000;
const PROMPT_LIBRARY_BUCKET_COUNT = 24;
const storeHandlers = registerStoreHandlers({
  admin,
  CORS_ORIGINS,
  REGION,
  STORE_CATEGORIES,
  STORE_CATEGORY_IDS,
  MAX_CONTENT_LENGTH,
  MAX_TITLE_LENGTH,
  createHttpError,
  db,
  logEvent,
  normalizeIdentity,
  normalizePromptContent,
  normalizeText,
  onRequest,
  sendError,
  verifyInovaIdentity,
});
const promptReviewHandlers = registerPromptReviewHandlers({
  admin,
  CORS_ORIGINS,
  REGION,
  createHttpError,
  db,
  logEvent,
  normalizeIdentity,
  normalizeText,
  onRequest,
  sendError,
  verifyInovaIdentity,
});
const meetingHandlers = registerMeetingHandlers({
  admin,
  bucket,
  CORS_ORIGINS,
  REGION,
  createHttpError,
  db,
  logEvent,
  normalizeIdentity,
  normalizeText,
  onRequest,
  sendError,
  verifyInovaIdentity,
});
exports.listPromptStoreEntries = storeHandlers.listPromptStoreEntries;
exports.publishPromptToStore = storeHandlers.publishPromptToStore;
exports.unpublishPromptFromStore = storeHandlers.unpublishPromptFromStore;
exports.importPromptStoreEntry = storeHandlers.importPromptStoreEntry;
exports.togglePromptStoreLike = storeHandlers.togglePromptStoreLike;
exports.recordPromptStoreView = storeHandlers.recordPromptStoreView;
exports.reviewInovaPrompt = promptReviewHandlers.reviewInovaPrompt;
exports.createInovaMeetingJob = meetingHandlers.createInovaMeetingJob;
exports.getInovaMeetingJob = meetingHandlers.getInovaMeetingJob;
exports.getInovaMeetingArtifact = meetingHandlers.getInovaMeetingArtifact;

exports.loadInovaPromptLibrary = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
  try {
    assertMethod(request, "POST");
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

exports.peekInovaPromptLibrary = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
  try {
    assertMethod(request, "POST");
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

exports.syncInovaPromptLibrary = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
  try {
    assertMethod(request, "POST");
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

async function verifyInovaIdentity(providerIdentity, request) {
  const owner = normalizeIdentity(providerIdentity);
  if (!owner.providerUserKey) {
    throw createHttpError(400, "i-Nova 사용자 키가 없어요.");
  }

  const accessToken = extractAccessToken(request);
  if (!accessToken) {
    throw createHttpError(401, "i-Nova access token이 없어요.");
  }

  const verifyResponse = await fetch(`https://inova.incross.com/api/users/${encodeURIComponent(owner.providerUserKey)}/settings`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    method: "GET",
  });

  if (!verifyResponse.ok) {
    throw createHttpError(401, "i-Nova 세션 검증에 실패했어요.");
  }

  return owner;
}

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

function normalizeIdentity(identity) {
  return {
    provider: normalizeText(identity?.provider) || "inova",
    providerUserKey: normalizeText(identity?.providerUserKey),
    email: normalizeText(identity?.email).toLowerCase(),
    displayName: normalizeText(identity?.displayName),
    numericUserId: Number.isFinite(Number(identity?.numericUserId)) ? Number(identity.numericUserId) : null,
  };
}

function normalizePromptContent(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
}

function normalizeText(value) {
  return String(value || "").trim();
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

function buildPromptLibraryId(providerUserKey) {
  return `inova__${providerUserKey}`;
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

function extractAccessToken(request) {
  const authorization = normalizeText(request.get("authorization"));
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return authorization.slice(7).trim();
}

function assertMethod(request, method) {
  if (request.method !== method) {
    throw createHttpError(405, `${method} 요청만 지원해요.`);
  }
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendError(response, error) {
  const status = Number(error?.status) || 500;
  response.status(status).json({
    ok: false,
    error: status >= 500 ? "클라우드 처리 중 문제가 생겼어요." : normalizeText(error?.message) || "요청을 처리하지 못했어요.",
  });
}

function logEvent(event, payload) {
  console.log(
    JSON.stringify({
      event,
      payload: payload || {},
      scope: "prompt-sync",
    })
  );
}
