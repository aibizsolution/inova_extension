const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { registerStoreHandlers } = require("./store-service");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "asia-northeast3";
const CORS_ORIGINS = ["https://inova.incross.com"];
const STORE_CATEGORIES = [
  { id: "document", label: "문서 작성" },
  { id: "summary", label: "요약/정리" },
  { id: "analysis", label: "분석/리서치" },
  { id: "meeting", label: "회의/업무" },
  { id: "translation", label: "번역" },
  { id: "marketing", label: "마케팅" },
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
const MAX_PROMPT_ITEMS = 200;
const MAX_TITLE_LENGTH = 120;
const MAX_CONTENT_LENGTH = 12000;
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
exports.listPromptStoreEntries = storeHandlers.listPromptStoreEntries;
exports.publishPromptToStore = storeHandlers.publishPromptToStore;
exports.unpublishPromptFromStore = storeHandlers.unpublishPromptFromStore;
exports.importPromptStoreEntry = storeHandlers.importPromptStoreEntry;
exports.togglePromptStoreLike = storeHandlers.togglePromptStoreLike;
exports.recordPromptStoreView = storeHandlers.recordPromptStoreView;

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
    if (!snapshot.exists) {
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

    const data = snapshot.data() || {};
    const promptLibrary = normalizeStoredPromptLibrary(data.promptLibrary);
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
        owner: normalizeIdentity(data.owner || providerIdentity),
        promptLibrary,
        syncedAt: normalizeText(data?.sync?.lastSyncedAt),
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
    const promptLibrary = normalizePromptLibrary(syncDocument.promptLibrary);
    const promptLibraryMeta = buildPromptLibraryMeta(promptLibrary, syncDocument.sync.revision, syncedAt);

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
          schemaVersion: 1,
          libraryId,
          source: {
            integration: "inova",
            kind: "prompt-library-sync",
          },
          owner,
          promptLibrary,
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
  return {
    owner: normalizeIdentity(input?.owner),
    projectId: normalizeText(input?.projectId),
    promptLibrary: normalizePromptLibrary(input?.promptLibrary),
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
    itemCount: Math.max(0, Number(promptLibraryMeta?.itemCount) || 0),
    lastRevision: normalizeText(promptLibraryMeta?.lastRevision),
    lastSyncedAt: normalizeText(promptLibraryMeta?.lastSyncedAt),
    updatedAt: normalizeText(promptLibraryMeta?.updatedAt),
    version: Math.max(1, Number(promptLibraryMeta?.version) || 1),
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

function buildPromptLibraryMeta(promptLibrary, revision, syncedAt) {
  return {
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
