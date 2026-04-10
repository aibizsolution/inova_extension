const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");

const FIREBASE_AUTH_SIGNING_SERVICE_ACCOUNT = process.env.FIREBASE_AUTH_SIGNING_SERVICE_ACCOUNT
  || "1027279095019-compute@developer.gserviceaccount.com";
const RUNNING_IN_FIREBASE_EMULATOR = isFirebaseEmulatorRuntime();

if (!admin.apps.length) {
  if (RUNNING_IN_FIREBASE_EMULATOR) {
    admin.initializeApp();
  } else {
    admin.initializeApp({
      serviceAccountId: FIREBASE_AUTH_SIGNING_SERVICE_ACCOUNT,
    });
  }
}

const db = admin.firestore();
const bucket = resolveStorageBucket(admin);
const REGION = "asia-northeast3";
const INOVA_ORIGIN = "https://inova.incross.com";
const HOSTING_ORIGIN = "https://browser-extension-main.web.app";
const LOCAL_HOSTING_ORIGINS = [
  "http://127.0.0.1:5000",
  "http://localhost:5000",
];
const HOSTED_MEETING_PAGE_URL = `${HOSTING_ORIGIN}/meeting/index.html`;
const CORS_ORIGINS = [INOVA_ORIGIN, HOSTING_ORIGIN, ...LOCAL_HOSTING_ORIGINS];
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
const MAX_TITLE_LENGTH = 120;
const MAX_CONTENT_LENGTH = 12000;

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
  STORE_CATEGORY_IDS,
  verifyInovaIdentity,
};

function resolveStorageBucket(adminSdk) {
  const bucketName = resolveStorageBucketName();
  return bucketName ? adminSdk.storage().bucket(bucketName) : null;
}

function resolveStorageBucketName() {
  const explicitBucket = normalizeStorageBucketName(process.env.STORAGE_BUCKET_URL);
  if (explicitBucket) {
    return explicitBucket;
  }

  const firebaseConfig = parseFirebaseConfig(process.env.FIREBASE_CONFIG);
  const configBucket = normalizeStorageBucketName(firebaseConfig?.storageBucket);
  if (configBucket) {
    return configBucket;
  }
  return "";
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

function isFirebaseEmulatorRuntime() {
  return ["1", "true", "yes", "on"].includes(normalizeText(process.env.FUNCTIONS_EMULATOR).toLowerCase())
    || Boolean(normalizeText(process.env.FIREBASE_AUTH_EMULATOR_HOST))
    || Boolean(normalizeText(process.env.FIRESTORE_EMULATOR_HOST))
    || Boolean(normalizeText(process.env.FIREBASE_STORAGE_EMULATOR_HOST));
}
