const crypto = require("crypto");
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
require("../shared/prompt-text-model");
require("../shared/prompt-store-model");
const promptTextModel = globalThis.InovaBookmarks.promptTextModel;
const promptStoreModel = globalThis.InovaBookmarks.promptStoreModel;

const INOVA_AUTH_SIGNING_SERVICE_ACCOUNT = process.env.INOVA_AUTH_SIGNING_SERVICE_ACCOUNT
  || "1027279095019-compute@developer.gserviceaccount.com";
const RUNNING_IN_FIREBASE_EMULATOR = isFirebaseEmulatorRuntime();

if (!admin.apps.length) {
  if (RUNNING_IN_FIREBASE_EMULATOR) {
    admin.initializeApp();
  } else {
    admin.initializeApp({
      serviceAccountId: INOVA_AUTH_SIGNING_SERVICE_ACCOUNT,
    });
  }
}

const db = admin.firestore();
const bucket = resolveStorageBucket(admin);
const REGION = "asia-northeast3";
const INOVA_ORIGIN = "https://inova.incross.com";
const HOSTING_ORIGIN = "https://browser-extension-main.web.app";
const V2_HOSTING_ORIGIN = "https://browser-extension-v2.web.app";
const LOCAL_HOSTING_ORIGINS = [
  "http://127.0.0.1:5000",
  "http://localhost:5000",
];
const HOSTED_MEETING_PAGE_URL = `${HOSTING_ORIGIN}/meeting/index.html`;
const CORS_ORIGINS = [INOVA_ORIGIN, HOSTING_ORIGIN, V2_HOSTING_ORIGIN, ...LOCAL_HOSTING_ORIGINS];
const STORE_CATEGORIES = promptStoreModel.getDefaultStoreCategories();
const MAX_TITLE_LENGTH = 120;
const MAX_CONTENT_LENGTH = 12000;
const VERIFIED_INOVA_IDENTITY_CACHE_TTL_MS = 5 * 60 * 1000;
const VERIFIED_INOVA_IDENTITY_CACHE_LIMIT = 256;
const recentVerifiedInovaIdentities = new Map();
const pendingVerifiedInovaIdentities = new Map();

module.exports = {
  admin,
  bucket,
  buildPromptLibraryId,
  buildPromptPanelFirebaseUid,
  CORS_ORIGINS,
  createHttpError,
  db,
  HOSTED_MEETING_PAGE_URL,
  logEvent,
  MAX_CONTENT_LENGTH,
  MAX_TITLE_LENGTH,
  normalizeIdentity,
  normalizePromptContent,
  normalizeText,
  onDocumentWritten,
  onRequest,
  onSchedule,
  REGION,
  sendError,
  STORE_CATEGORIES,
  verifyInovaIdentity,
};

function resolveStorageBucket(adminSdk) {
  const bucketName = resolveStorageBucketName();
  return bucketName ? adminSdk.storage().bucket(bucketName) : null;
}

function resolveStorageBucketName() {
  const explicitBucket = normalizeStorageBucketName(process.env.STORAGE_BUCKET_URL);
  if (explicitBucket && !isReservedCloudFunctionsStorageBucket(explicitBucket)) {
    return explicitBucket;
  }

  const firebaseConfig = parseFirebaseConfig(process.env.FIREBASE_CONFIG);
  const configBucket = normalizeStorageBucketName(firebaseConfig?.storageBucket);
  if (configBucket) {
    return configBucket;
  }
  return "";
}

function isReservedCloudFunctionsStorageBucket(bucketName) {
  const normalizedBucketName = normalizeStorageBucketName(bucketName).toLowerCase();
  return normalizedBucketName.startsWith("gcf-v2-")
    || normalizedBucketName.startsWith("gcf-sources-")
    || normalizedBucketName.endsWith(".cloudfunctions.appspot.com");
}

function normalizeStorageBucketName(value) {
  return String(value || "")
    .replace(/^gs:\/\//i, "")
    .replace(/\/+$/, "")
    .trim();
}

function parseFirebaseConfig(rawValue) {
  if (!rawValue) {
    return null;
  }
  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

async function verifyInovaIdentity(providerIdentity, request) {
  const owner = normalizeIdentity(providerIdentity);
  if (!owner.providerUserKey) {
    throw createHttpError(400, "i-Nova 사용자 키가 없어요.");
  }

  const accessToken = extractAccessToken(request);
  if (!accessToken) {
    throw createHttpError(401, "i-Nova access token이 없어요.");
  }

  const cacheKey = buildVerifiedInovaIdentityCacheKey(owner.providerUserKey, accessToken);
  const recentOwner = readRecentVerifiedInovaIdentity(cacheKey);
  if (recentOwner) {
    return recentOwner;
  }

  if (cacheKey && pendingVerifiedInovaIdentities.has(cacheKey)) {
    return pendingVerifiedInovaIdentities.get(cacheKey);
  }

  const requestPromise = (async () => {
    const verifyResponse = await fetch(`https://inova.incross.com/api/users/${encodeURIComponent(owner.providerUserKey)}/settings`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      method: "GET",
    });

    if (!verifyResponse.ok) {
      throw createHttpError(401, "i-Nova 세션 검증에 실패했어요.");
    }

    cacheRecentVerifiedInovaIdentity(cacheKey, owner, accessToken);
    return { ...owner };
  })();

  if (cacheKey) {
    pendingVerifiedInovaIdentities.set(cacheKey, requestPromise);
  }

  try {
    return await requestPromise;
  } finally {
    if (cacheKey) {
      pendingVerifiedInovaIdentities.delete(cacheKey);
    }
  }
}

function normalizeIdentity(identity) {
  const numericUserId = identity?.numericUserId;
  return {
    provider: normalizeText(identity?.provider) || "inova",
    providerUserKey: normalizeText(identity?.providerUserKey),
    email: normalizeText(identity?.email).toLowerCase(),
    displayName: normalizeText(identity?.displayName),
    numericUserId: numericUserId === null || numericUserId === undefined || numericUserId === ""
      ? null
      : Number.isFinite(Number(numericUserId))
        ? Number(numericUserId)
        : null,
  };
}

function normalizePromptContent(text) {
  return promptTextModel.normalizePromptContent(text);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function buildPromptLibraryId(providerUserKey) {
  return `inova__${providerUserKey}`;
}

function buildPromptPanelFirebaseUid(providerUserKey) {
  return `prompt-panel__${providerUserKey}`;
}

function extractAccessToken(request) {
  const authorization = normalizeText(request.get("authorization"));
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return authorization.slice(7).trim();
}

function buildVerifiedInovaIdentityCacheKey(providerUserKey, accessToken) {
  const normalizedProviderUserKey = normalizeText(providerUserKey);
  const normalizedAccessToken = normalizeText(accessToken);
  if (!normalizedProviderUserKey || !normalizedAccessToken) {
    return "";
  }
  return `${normalizedProviderUserKey}::${crypto.createHash("sha256").update(normalizedAccessToken).digest("hex")}`;
}

function readRecentVerifiedInovaIdentity(cacheKey) {
  const key = normalizeText(cacheKey);
  const entry = key ? recentVerifiedInovaIdentities.get(key) : null;
  if (!entry || entry.expiresAt <= Date.now()) {
    if (key) {
      recentVerifiedInovaIdentities.delete(key);
    }
    return null;
  }
  return { ...entry.owner };
}

function cacheRecentVerifiedInovaIdentity(cacheKey, owner, accessToken) {
  const key = normalizeText(cacheKey);
  const expiresAt = resolveVerifiedInovaIdentityExpiry(accessToken);
  if (!key || expiresAt <= Date.now()) {
    return;
  }
  pruneRecentVerifiedInovaIdentities();
  recentVerifiedInovaIdentities.set(key, {
    expiresAt,
    owner: normalizeIdentity(owner),
  });
  while (recentVerifiedInovaIdentities.size > VERIFIED_INOVA_IDENTITY_CACHE_LIMIT) {
    const oldestKey = recentVerifiedInovaIdentities.keys().next().value;
    if (!oldestKey) {
      break;
    }
    recentVerifiedInovaIdentities.delete(oldestKey);
  }
}

function pruneRecentVerifiedInovaIdentities() {
  const now = Date.now();
  for (const [key, entry] of recentVerifiedInovaIdentities.entries()) {
    if (!entry || entry.expiresAt <= now) {
      recentVerifiedInovaIdentities.delete(key);
    }
  }
}

function resolveVerifiedInovaIdentityExpiry(accessToken) {
  const ttlExpiry = Date.now() + VERIFIED_INOVA_IDENTITY_CACHE_TTL_MS;
  const tokenExpiry = readJwtExpiryMs(accessToken);
  if (!tokenExpiry) {
    return ttlExpiry;
  }
  return Math.max(Date.now(), Math.min(ttlExpiry, tokenExpiry - 60000));
}

function readJwtExpiryMs(accessToken) {
  const normalizedAccessToken = normalizeText(accessToken);
  const parts = normalizedAccessToken.split(".");
  if (parts.length < 2) {
    return 0;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );
    const expSeconds = Number(payload?.exp) || 0;
    return expSeconds > 0 ? expSeconds * 1000 : 0;
  } catch {
    return 0;
  }
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendError(response, error) {
  const status = Number(error?.status) || 500;
  const message = normalizeText(error?.message) || "요청을 처리하지 못했어요.";
  response.status(status).json({
    ok: false,
    error: status >= 500 && !RUNNING_IN_FIREBASE_EMULATOR ? "클라우드 처리 중 문제가 생겼어요." : message,
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

function isFirebaseEmulatorRuntime() {
  return ["1", "true", "yes", "on"].includes(normalizeText(process.env.FUNCTIONS_EMULATOR).toLowerCase())
    || Boolean(normalizeText(process.env.FIREBASE_AUTH_EMULATOR_HOST))
    || Boolean(normalizeText(process.env.FIRESTORE_EMULATOR_HOST))
    || Boolean(normalizeText(process.env.FIREBASE_STORAGE_EMULATOR_HOST));
}
