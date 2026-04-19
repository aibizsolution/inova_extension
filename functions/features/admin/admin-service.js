const crypto = require("crypto");

const ADMIN_USER_COLLECTION = "ops_admin_users";
const ADMIN_LAUNCH_COLLECTION = "ops_admin_launches";
const ADMIN_SESSION_COLLECTION = "ops_admin_sessions";
const DEFAULT_LAUNCH_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ADMIN_SESSION_AUTH_SCHEME = "adminsession";

const ADMIN_COLLECTIONS = Object.freeze({
  launches: ADMIN_LAUNCH_COLLECTION,
  sessions: ADMIN_SESSION_COLLECTION,
  users: ADMIN_USER_COLLECTION,
});

function registerAdminHandlers(deps) {
  const {
    CORS_ORIGINS,
    REGION,
    createHttpError,
    logEvent,
    normalizeIdentity,
    normalizeText,
    onRequest,
    sendError,
    verifyInovaIdentity,
  } = deps;
  const domain = createAdminDomain(deps);

  const checkInovaAdminAccess = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertPostRequest(request, createHttpError);
      const owner = await verifyInovaIdentity(
        normalizeIdentity(request.body?.providerIdentity || request.body?.owner),
        request
      );
      const access = await domain.checkAdminAccess(owner);
      logEvent?.("admin.access.check", {
        allowed: access.allowed,
        providerUserKey: owner.providerUserKey,
        reason: access.reason,
      });
      response.json({
        ok: true,
        data: access,
      });
    } catch (error) {
      logEvent?.("admin.access.check.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const issueInovaAdminLaunch = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertPostRequest(request, createHttpError);
      const owner = await verifyInovaIdentity(
        normalizeIdentity(request.body?.providerIdentity || request.body?.owner),
        request
      );
      const result = await domain.issueAdminLaunch(owner);
      logEvent?.("admin.launch.issue.success", {
        expiresAt: result.expiresAt,
        providerUserKey: owner.providerUserKey,
      });
      response.json({
        ok: true,
        data: result,
      });
    } catch (error) {
      logEvent?.("admin.launch.issue.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const exchangeInovaAdminLaunch = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertPostRequest(request, createHttpError);
      const result = await domain.exchangeAdminLaunch(request.body?.launchToken);
      logEvent?.("admin.launch.exchange.success", {
        providerUserKey: result.viewer.providerUserKey,
        sessionExpiresAt: result.sessionExpiresAt,
      });
      response.json({
        ok: true,
        data: result,
      });
    } catch (error) {
      logEvent?.("admin.launch.exchange.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const readInovaAdminBootstrap = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertPostRequest(request, createHttpError);
      const adminSessionToken = readAdminSessionToken(request, normalizeText);
      const result = await domain.readAdminBootstrap(adminSessionToken);
      logEvent?.("admin.bootstrap.read.success", {
        providerUserKey: result.viewer.providerUserKey,
      });
      response.json({
        ok: true,
        data: result,
      });
    } catch (error) {
      logEvent?.("admin.bootstrap.read.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  return {
    checkInovaAdminAccess,
    exchangeInovaAdminLaunch,
    issueInovaAdminLaunch,
    readInovaAdminBootstrap,
  };
}

function createAdminDomain(deps) {
  const {
    createHttpError = createDefaultHttpError,
    db,
    now = () => Date.now(),
    normalizeIdentity = normalizeIdentityFallback,
    normalizeText = normalizeTextFallback,
    adminCollections,
    adminConfig,
  } = deps;
  const collections = {
    ...ADMIN_COLLECTIONS,
    ...(adminCollections && typeof adminCollections === "object" ? adminCollections : {}),
  };

  async function checkAdminAccess(ownerInput = {}) {
    const owner = normalizeOwner(ownerInput);
    if (!owner.providerUserKey) {
      throw createHttpError(401, "관리자 권한 확인에 필요한 i-Nova 사용자 정보가 없어요.");
    }

    const envAccess = readEnvAdminAccess(owner);
    if (envAccess.allowed) {
      return buildAccessResult(owner, {
        allowed: true,
        reason: "env-allowlist",
        role: envAccess.role,
        source: "env",
      });
    }

    const firestoreAccess = await readFirestoreAdminAccess(owner);
    if (firestoreAccess.allowed) {
      return buildAccessResult(owner, firestoreAccess);
    }

    return buildAccessResult(owner, {
      allowed: false,
      reason: firestoreAccess.reason || "not-admin",
      role: "",
      source: firestoreAccess.source || "none",
    });
  }

  async function issueAdminLaunch(ownerInput = {}) {
    assertDbReady();
    const owner = normalizeOwner(ownerInput);
    const access = await checkAdminAccess(owner);
    if (!access.allowed) {
      throw createHttpError(403, "관리자 권한이 없어요.");
    }

    const launchId = createDocumentId(collections.launches);
    const launchSecret = createSecret();
    const issuedAtMs = now();
    const issuedAt = new Date(issuedAtMs).toISOString();
    const expiresAt = new Date(issuedAtMs + DEFAULT_LAUNCH_TTL_MS).toISOString();
    await db.collection(collections.launches).doc(launchId).set({
      createdAt: issuedAt,
      expiresAt,
      launchId,
      owner: access.viewer,
      role: access.role,
      secretHash: hashSecret(launchSecret),
      status: "issued",
    });

    return {
      expiresAt,
      launchToken: `${launchId}.${launchSecret}`,
    };
  }

  async function exchangeAdminLaunch(launchTokenInput) {
    assertDbReady();
    const launch = await consumeLaunchToken(launchTokenInput);
    const access = await checkAdminAccess(launch.owner);
    if (!access.allowed) {
      throw createHttpError(403, "관리자 권한이 더 이상 유효하지 않아요.");
    }
    const sessionId = createDocumentId(collections.sessions);
    const sessionSecret = createSecret();
    const issuedAtMs = now();
    const issuedAt = new Date(issuedAtMs).toISOString();
    const sessionExpiresAt = new Date(issuedAtMs + DEFAULT_SESSION_TTL_MS).toISOString();
    await db.collection(collections.sessions).doc(sessionId).set({
      createdAt: issuedAt,
      expiresAt: sessionExpiresAt,
      owner: access.viewer,
      role: normalizeText(access.role) || normalizeText(launch.role) || "admin",
      secretHash: hashSecret(sessionSecret),
      sessionId,
      status: "active",
    });

    return {
      adminSessionToken: `${sessionId}.${sessionSecret}`,
      sessionExpiresAt,
      viewer: access.viewer,
      role: normalizeText(access.role) || normalizeText(launch.role) || "admin",
    };
  }

  async function readAdminBootstrap(adminSessionToken) {
    const session = await verifyAdminSession(adminSessionToken);
    return {
      checkedAt: new Date(now()).toISOString(),
      role: normalizeText(session.role) || "admin",
      sessionExpiresAt: normalizeText(session.expiresAt),
      viewer: normalizeOwner(session.owner),
    };
  }

  async function verifyAdminSession(adminSessionToken) {
    assertDbReady();
    const { id, secret } = splitToken(adminSessionToken, "admin session token");
    const sessionRef = db.collection(collections.sessions).doc(id);
    const snapshot = await sessionRef.get();
    if (!snapshot.exists) {
      throw createHttpError(401, "관리자 세션이 만료되었어요. 패널에서 다시 열어 주세요.");
    }
    const session = snapshot.data() || {};
    assertTokenSecret(session.secretHash, secret, "관리자 세션이 유효하지 않아요.");
    if (normalizeText(session.status) !== "active") {
      throw createHttpError(401, "관리자 세션이 더 이상 활성 상태가 아니에요.");
    }
    assertNotExpired(session.expiresAt, "관리자 세션이 만료되었어요. 패널에서 다시 열어 주세요.");
    const access = await checkAdminAccess(session.owner);
    if (!access.allowed) {
      throw createHttpError(403, "관리자 권한이 더 이상 유효하지 않아요.");
    }
    return {
      ...session,
      owner: access.viewer,
      role: normalizeText(access.role) || normalizeText(session.role) || "admin",
    };
  }

  async function consumeLaunchToken(launchTokenInput) {
    const { id, secret } = splitToken(launchTokenInput, "admin launch token");
    const launchRef = db.collection(collections.launches).doc(id);
    const snapshot = await launchRef.get();
    if (!snapshot.exists) {
      throw createHttpError(404, "관리 콘솔 열기 링크가 만료되었어요. 패널에서 다시 열어 주세요.");
    }
    const launch = snapshot.data() || {};
    assertTokenSecret(launch.secretHash, secret, "관리 콘솔 열기 링크가 유효하지 않아요.");
    if (normalizeText(launch.status) !== "issued") {
      throw createHttpError(410, "이미 사용된 관리 콘솔 열기 링크예요. 패널에서 다시 열어 주세요.");
    }
    assertNotExpired(launch.expiresAt, "관리 콘솔 열기 링크가 만료되었어요. 패널에서 다시 열어 주세요.");
    await launchRef.set({
      consumedAt: new Date(now()).toISOString(),
      status: "consumed",
    }, { merge: true });
    return launch;
  }

  async function readFirestoreAdminAccess(owner) {
    if (!db?.collection || !owner.providerUserKey) {
      return { allowed: false, reason: "admin-store-unavailable", source: "firestore" };
    }
    const snapshot = await db.collection(collections.users).doc(owner.providerUserKey).get();
    if (!snapshot.exists) {
      return { allowed: false, reason: "not-admin", source: "firestore" };
    }
    const data = snapshot.data() || {};
    const status = normalizeText(data.status || data.accessState || "active").toLowerCase();
    if (status !== "active") {
      return { allowed: false, reason: `admin-${status || "inactive"}`, source: "firestore" };
    }
    return {
      allowed: true,
      reason: "firestore-admin",
      role: normalizeAdminRole(data.role),
      source: "firestore",
    };
  }

  function readEnvAdminAccess(owner) {
    const config = adminConfig && typeof adminConfig === "object" ? adminConfig : {};
    const providerUserKeys = readConfiguredSet(
      config.providerUserKeys || process.env.INOVA_ADMIN_PROVIDER_USER_KEYS
    );
    const emails = readConfiguredSet(
      config.emails || process.env.INOVA_ADMIN_EMAILS,
      { lower: true }
    );
    const roles = config.roles && typeof config.roles === "object" ? config.roles : {};
    if (providerUserKeys.has(owner.providerUserKey)) {
      return {
        allowed: true,
        role: normalizeAdminRole(roles[owner.providerUserKey]),
      };
    }
    if (owner.email && emails.has(owner.email.toLowerCase())) {
      return {
        allowed: true,
        role: normalizeAdminRole(roles[owner.email.toLowerCase()]),
      };
    }
    return { allowed: false, role: "" };
  }

  function buildAccessResult(owner, access) {
    return {
      allowed: access.allowed === true,
      checkedAt: new Date(now()).toISOString(),
      reason: normalizeText(access.reason),
      role: access.allowed === true ? normalizeAdminRole(access.role) : "",
      source: normalizeText(access.source),
      viewer: normalizeOwner(owner),
    };
  }

  function normalizeOwner(ownerInput) {
    const owner = normalizeIdentity(ownerInput);
    return {
      displayName: normalizeText(owner.displayName),
      email: normalizeText(owner.email).toLowerCase(),
      numericUserId: owner.numericUserId === null || owner.numericUserId === undefined || owner.numericUserId === ""
        ? null
        : Number.isFinite(Number(owner.numericUserId))
          ? Number(owner.numericUserId)
          : null,
      provider: normalizeText(owner.provider) || "inova",
      providerUserKey: normalizeText(owner.providerUserKey),
    };
  }

  function createDocumentId(collectionName) {
    const ref = db.collection(collectionName).doc();
    return normalizeText(ref.id) || crypto.randomBytes(12).toString("hex");
  }

  function assertDbReady() {
    if (!db?.collection) {
      throw createHttpError(500, "관리자 저장소가 준비되지 않았어요.");
    }
  }

  function assertNotExpired(expiresAt, message) {
    const expiresAtMs = Date.parse(normalizeText(expiresAt));
    if (!(expiresAtMs > now())) {
      throw createHttpError(410, message);
    }
  }

  function assertTokenSecret(secretHash, secret, message) {
    const expectedHash = normalizeText(secretHash);
    const actualHash = hashSecret(secret);
    const expected = Buffer.from(expectedHash);
    const actual = Buffer.from(actualHash);
    if (
      !expectedHash
      || expected.length !== actual.length
      || !crypto.timingSafeEqual(expected, actual)
    ) {
      throw createHttpError(403, message);
    }
  }

  return {
    checkAdminAccess,
    exchangeAdminLaunch,
    issueAdminLaunch,
    readAdminBootstrap,
    verifyAdminSession,
  };
}

function assertPostRequest(request, createHttpError) {
  if (String(request?.method || "").toUpperCase() !== "POST") {
    throw createHttpError(405, "POST 요청만 지원합니다.");
  }
}

function readAdminSessionToken(request, normalizeText) {
  const authorization = normalizeText(request?.get?.("authorization"));
  if (!authorization.toLowerCase().startsWith(`${ADMIN_SESSION_AUTH_SCHEME} `)) {
    return "";
  }
  return authorization.slice(ADMIN_SESSION_AUTH_SCHEME.length + 1).trim();
}

function splitToken(tokenInput, label) {
  const token = String(tokenInput || "").trim();
  const [id, secret, ...rest] = token.split(".");
  if (!id || !secret || rest.length) {
    const error = new Error(`${label} 형식이 올바르지 않아요.`);
    error.status = 400;
    throw error;
  }
  return { id, secret };
}

function createSecret() {
  return crypto.randomBytes(24).toString("base64url");
}

function hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest("hex");
}

function normalizeAdminRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return ["owner", "admin", "viewer"].includes(normalized) ? normalized : "admin";
}

function readConfiguredSet(value, options = {}) {
  const values = Array.isArray(value)
    ? value
    : String(value || "").split(/[,\s]+/);
  return new Set(
    values
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .map((entry) => options.lower ? entry.toLowerCase() : entry)
  );
}

function createDefaultHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeIdentityFallback(identity = {}) {
  const numericUserId = identity?.numericUserId;
  return {
    displayName: normalizeTextFallback(identity?.displayName),
    email: normalizeTextFallback(identity?.email).toLowerCase(),
    numericUserId: numericUserId === null || numericUserId === undefined || numericUserId === ""
      ? null
      : Number.isFinite(Number(numericUserId))
        ? Number(numericUserId)
        : null,
    provider: normalizeTextFallback(identity?.provider) || "inova",
    providerUserKey: normalizeTextFallback(identity?.providerUserKey),
  };
}

function normalizeTextFallback(value) {
  return String(value || "").trim();
}

module.exports = {
  ADMIN_COLLECTIONS,
  createAdminDomain,
  registerAdminHandlers,
};
