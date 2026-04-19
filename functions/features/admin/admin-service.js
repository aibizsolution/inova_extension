const crypto = require("crypto");

const ADMIN_USER_COLLECTION = "ops_admin_users";
const ADMIN_LAUNCH_COLLECTION = "ops_admin_launches";
const ADMIN_SESSION_COLLECTION = "ops_admin_sessions";
const PANEL_NOTICE_COLLECTION = "ops_panel_notices";
const PANEL_NOTICE_SIGNAL_COLLECTION = "ops_panel_notice_signals";
const PANEL_NOTICE_STATE_COLLECTION = "ops_panel_notice_state";
const PANEL_NOTICE_SIGNAL_DOC_ID = "current";
const PANEL_NOTICE_STATE_DOC_ID = "current";
const PANEL_NOTICE_SCHEMA_VERSION = 1;
const DEFAULT_LAUNCH_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ADMIN_SESSION_AUTH_SCHEME = "adminsession";
const MAX_NOTICE_TITLE_LENGTH = 80;
const MAX_NOTICE_BODY_LENGTH = 800;
const MAX_NOTICE_CTA_LABEL_LENGTH = 32;
const ADMIN_NOTICE_LIST_LIMIT = 20;

const ADMIN_COLLECTIONS = Object.freeze({
  launches: ADMIN_LAUNCH_COLLECTION,
  panelNoticeState: PANEL_NOTICE_STATE_COLLECTION,
  panelNoticeSignals: PANEL_NOTICE_SIGNAL_COLLECTION,
  panelNotices: PANEL_NOTICE_COLLECTION,
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

  const readInovaPanelNotice = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertPostRequest(request, createHttpError);
      const owner = await verifyInovaIdentity(
        normalizeIdentity(request.body?.providerIdentity || request.body?.owner),
        request
      );
      const result = await domain.readPanelNotice(owner);
      logEvent?.("panel.notice.read.success", {
        hasNotice: Boolean(result.notice),
        noticeId: normalizeText(result.notice?.noticeId),
        providerUserKey: owner.providerUserKey,
      });
      response.json({
        ok: true,
        data: result,
      });
    } catch (error) {
      logEvent?.("panel.notice.read.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const listInovaAdminPanelNotices = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertPostRequest(request, createHttpError);
      const adminSessionToken = readAdminSessionToken(request, normalizeText);
      const result = await domain.listAdminPanelNotices(adminSessionToken);
      logEvent?.("admin.panel-notice.list.success", {
        count: Array.isArray(result.notices) ? result.notices.length : 0,
        providerUserKey: result.viewer.providerUserKey,
      });
      response.json({
        ok: true,
        data: result,
      });
    } catch (error) {
      logEvent?.("admin.panel-notice.list.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const saveInovaAdminPanelNotice = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertPostRequest(request, createHttpError);
      const adminSessionToken = readAdminSessionToken(request, normalizeText);
      const result = await domain.saveAdminPanelNotice(adminSessionToken, request.body?.notice || request.body);
      logEvent?.("admin.panel-notice.save.success", {
        noticeId: result.notice.noticeId,
        providerUserKey: result.viewer.providerUserKey,
      });
      response.json({
        ok: true,
        data: result,
      });
    } catch (error) {
      logEvent?.("admin.panel-notice.save.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const publishInovaAdminPanelNotice = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertPostRequest(request, createHttpError);
      const adminSessionToken = readAdminSessionToken(request, normalizeText);
      const result = await domain.publishAdminPanelNotice(adminSessionToken, request.body?.notice || request.body);
      logEvent?.("admin.panel-notice.publish.success", {
        noticeId: result.notice.noticeId,
        providerUserKey: result.viewer.providerUserKey,
        version: result.notice.version,
      });
      response.json({
        ok: true,
        data: result,
      });
    } catch (error) {
      logEvent?.("admin.panel-notice.publish.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const archiveInovaAdminPanelNotice = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertPostRequest(request, createHttpError);
      const adminSessionToken = readAdminSessionToken(request, normalizeText);
      const result = await domain.archiveAdminPanelNotice(adminSessionToken, request.body || {});
      logEvent?.("admin.panel-notice.archive.success", {
        noticeId: result.notice?.noticeId || "",
        providerUserKey: result.viewer.providerUserKey,
      });
      response.json({
        ok: true,
        data: result,
      });
    } catch (error) {
      logEvent?.("admin.panel-notice.archive.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const deleteInovaAdminPanelNotice = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertPostRequest(request, createHttpError);
      const adminSessionToken = readAdminSessionToken(request, normalizeText);
      const result = await domain.deleteAdminPanelNotice(adminSessionToken, request.body || {});
      logEvent?.("admin.panel-notice.delete.success", {
        noticeId: result.notice?.noticeId || "",
        providerUserKey: result.viewer.providerUserKey,
      });
      response.json({
        ok: true,
        data: result,
      });
    } catch (error) {
      logEvent?.("admin.panel-notice.delete.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const moveInovaAdminPanelNotice = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertPostRequest(request, createHttpError);
      const adminSessionToken = readAdminSessionToken(request, normalizeText);
      const result = await domain.moveAdminPanelNotice(adminSessionToken, request.body || {});
      logEvent?.("admin.panel-notice.move.success", {
        direction: normalizeText(request.body?.direction),
        noticeId: result.notice?.noticeId || "",
        providerUserKey: result.viewer.providerUserKey,
      });
      response.json({
        ok: true,
        data: result,
      });
    } catch (error) {
      logEvent?.("admin.panel-notice.move.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  return {
    archiveInovaAdminPanelNotice,
    checkInovaAdminAccess,
    deleteInovaAdminPanelNotice,
    exchangeInovaAdminLaunch,
    issueInovaAdminLaunch,
    listInovaAdminPanelNotices,
    moveInovaAdminPanelNotice,
    readInovaAdminBootstrap,
    readInovaPanelNotice,
    publishInovaAdminPanelNotice,
    saveInovaAdminPanelNotice,
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

  async function readPanelNotice(ownerInput = {}) {
    assertDbReady();
    const owner = normalizeOwner(ownerInput);
    if (!owner.providerUserKey) {
      throw createHttpError(401, "소식 확인에 필요한 i-Nova 사용자 정보가 없어요.");
    }
    const notices = (await readRecentPanelNotices())
      .filter(isPanelNoticeVisible)
      .map(toPublicPanelNotice);
    return {
      checkedAt: new Date(now()).toISOString(),
      notice: notices[0] || null,
      notices,
    };
  }

  async function listAdminPanelNotices(adminSessionToken) {
    const session = await verifyAdminSession(adminSessionToken);
    const [stateDoc, notices] = await Promise.all([
      readPanelNoticeState(),
      readRecentPanelNotices(),
    ]);
    const visibleNoticeIds = notices.filter(isPanelNoticeVisible).map((notice) => notice.noticeId);
    return {
      activeNoticeId: visibleNoticeIds[0] || normalizeText(stateDoc.activeNoticeId),
      checkedAt: new Date(now()).toISOString(),
      notices: notices.map(toAdminPanelNotice),
      visibleNoticeIds,
      viewer: normalizeOwner(session.owner),
    };
  }

  async function saveAdminPanelNotice(adminSessionToken, input = {}) {
    const session = await verifyAdminSession(adminSessionToken);
    const nowIso = new Date(now()).toISOString();
    const normalized = normalizePanelNoticeInput(input, { requireFutureEnd: false });
    const existing = await readPanelNoticeById(normalized.noticeId);
    const noticeId = existing ? existing.noticeId : createDocumentId(collections.panelNotices);
    const existingVersion = normalizeNoticeVersion(existing?.version) || 0;
    const nextNotice = {
      ...(existing || {}),
      ...normalized,
      archivedAt: "",
      createdAt: normalizeText(existing?.createdAt) || nowIso,
      noticeId,
      publishedAt: normalizeText(existing?.publishedAt) || nowIso,
      schemaVersion: PANEL_NOTICE_SCHEMA_VERSION,
      sortOrder: Number.isFinite(Number(existing?.sortOrder))
        ? Number(existing.sortOrder)
        : await readNextPanelNoticeSortOrder(),
      status: "published",
      updatedAt: nowIso,
      updatedBy: buildAdminNoticeActor(session),
      version: existingVersion ? existingVersion + 1 : 1,
    };
    await db.collection(collections.panelNotices).doc(noticeId).set(nextNotice);
    const nextActiveNotice = (await readRecentPanelNotices()).find(isPanelNoticeVisible);
    await writePanelNoticeState(session, nowIso, normalizeText(nextActiveNotice?.noticeId), "save");
    return {
      activeNoticeId: normalizeText(nextActiveNotice?.noticeId),
      notice: toAdminPanelNotice(nextNotice),
      viewer: normalizeOwner(session.owner),
    };
  }

  async function publishAdminPanelNotice(adminSessionToken, input = {}) {
    const session = await verifyAdminSession(adminSessionToken);
    const nowIso = new Date(now()).toISOString();
    const normalized = normalizePanelNoticeInput(input, { requireFutureEnd: true });
    const existing = await readPanelNoticeById(normalized.noticeId);
    const noticeId = existing ? existing.noticeId : createDocumentId(collections.panelNotices);
    const nextNotice = {
      ...(existing || {}),
      ...normalized,
      archivedAt: "",
      createdAt: normalizeText(existing?.createdAt) || nowIso,
      noticeId,
      publishedAt: nowIso,
      schemaVersion: PANEL_NOTICE_SCHEMA_VERSION,
      status: "published",
      updatedAt: nowIso,
      updatedBy: buildAdminNoticeActor(session),
      version: normalizeNoticeVersion(existing?.version) || 1,
    };
    await db.collection(collections.panelNotices).doc(noticeId).set(nextNotice);
    await writePanelNoticeState(session, nowIso, noticeId, "publish");
    return {
      activeNoticeId: noticeId,
      notice: toAdminPanelNotice(nextNotice),
      viewer: normalizeOwner(session.owner),
    };
  }

  async function archiveAdminPanelNotice(adminSessionToken, input = {}) {
    const session = await verifyAdminSession(adminSessionToken);
    const nowIso = new Date(now()).toISOString();
    const stateDoc = await readPanelNoticeState();
    const noticeId = normalizeText(input.noticeId) || normalizeText(stateDoc.activeNoticeId);
    const notice = noticeId ? await readPanelNoticeById(noticeId) : null;
    if (!notice) {
      return {
        activeNoticeId: normalizeText(stateDoc.activeNoticeId),
        notice: null,
        viewer: normalizeOwner(session.owner),
      };
    }
    const archivedNotice = {
      ...notice,
      archivedAt: nowIso,
      status: "archived",
      updatedAt: nowIso,
      updatedBy: buildAdminNoticeActor(session),
    };
    await db.collection(collections.panelNotices).doc(noticeId).set(archivedNotice);
    const nextActiveNotice = (await readRecentPanelNotices()).find(isPanelNoticeVisible);
    await writePanelNoticeState(session, nowIso, normalizeText(nextActiveNotice?.noticeId), "archive");
    return {
      activeNoticeId: normalizeText(nextActiveNotice?.noticeId),
      notice: toAdminPanelNotice(archivedNotice),
      viewer: normalizeOwner(session.owner),
    };
  }

  async function deleteAdminPanelNotice(adminSessionToken, input = {}) {
    const session = await verifyAdminSession(adminSessionToken);
    const nowIso = new Date(now()).toISOString();
    const noticeId = normalizeText(input.noticeId);
    if (!noticeId) {
      throw createHttpError(400, "삭제할 소식을 선택해 주세요.");
    }
    const notice = await readPanelNoticeById(noticeId);
    if (!notice) {
      return {
        activeNoticeId: normalizeText((await readPanelNoticeState()).activeNoticeId),
        notice: null,
        viewer: normalizeOwner(session.owner),
      };
    }
    await db.collection(collections.panelNotices).doc(noticeId).delete();
    const nextActiveNotice = (await readRecentPanelNotices()).find(isPanelNoticeVisible);
    await writePanelNoticeState(session, nowIso, normalizeText(nextActiveNotice?.noticeId), "delete");
    return {
      activeNoticeId: normalizeText(nextActiveNotice?.noticeId),
      notice: toAdminPanelNotice(notice),
      viewer: normalizeOwner(session.owner),
    };
  }

  async function moveAdminPanelNotice(adminSessionToken, input = {}) {
    const session = await verifyAdminSession(adminSessionToken);
    const nowIso = new Date(now()).toISOString();
    const noticeId = normalizeText(input.noticeId);
    const direction = normalizeText(input.direction).toLowerCase();
    if (!noticeId) {
      throw createHttpError(400, "이동할 소식을 선택해 주세요.");
    }
    if (direction !== "up" && direction !== "down") {
      throw createHttpError(400, "소식 이동 방향이 올바르지 않아요.");
    }
    const notices = await readRecentPanelNotices();
    const normalizedNotices = normalizeNoticeSortOrders(notices);
    const currentIndex = normalizedNotices.findIndex((notice) => notice.noticeId === noticeId);
    if (currentIndex < 0) {
      throw createHttpError(404, "이동할 소식을 찾지 못했어요.");
    }
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= normalizedNotices.length) {
      return {
        activeNoticeId: normalizeText((await readPanelNoticeState()).activeNoticeId),
        notice: toAdminPanelNotice(normalizedNotices[currentIndex]),
        notices: normalizedNotices.map(toAdminPanelNotice),
        viewer: normalizeOwner(session.owner),
      };
    }
    const currentNotice = normalizedNotices[currentIndex];
    const targetNotice = normalizedNotices[targetIndex];
    const currentSortOrder = currentNotice.sortOrder;
    currentNotice.sortOrder = targetNotice.sortOrder;
    targetNotice.sortOrder = currentSortOrder;
    await Promise.all([currentNotice, targetNotice].map((notice) => db.collection(collections.panelNotices).doc(notice.noticeId).set({
      sortOrder: notice.sortOrder,
      updatedAt: nowIso,
      updatedBy: buildAdminNoticeActor(session),
    }, { merge: true })));
    const nextActiveNotice = (await readRecentPanelNotices()).find(isPanelNoticeVisible);
    await writePanelNoticeState(session, nowIso, normalizeText(nextActiveNotice?.noticeId), "move");
    const movedNotice = await readPanelNoticeById(noticeId);
    return {
      activeNoticeId: normalizeText(nextActiveNotice?.noticeId),
      notice: toAdminPanelNotice(movedNotice || currentNotice),
      notices: (await readRecentPanelNotices()).map(toAdminPanelNotice),
      viewer: normalizeOwner(session.owner),
    };
  }

  async function writePanelNoticeState(session, nowIso, activeNoticeIdInput, reasonInput) {
    const activeNoticeId = normalizeText(activeNoticeIdInput);
    const reason = normalizeText(reasonInput) || "change";
    await Promise.all([
      db.collection(collections.panelNoticeState).doc(PANEL_NOTICE_STATE_DOC_ID).set({
        activeNoticeId,
        updatedAt: nowIso,
        updatedBy: buildAdminNoticeActor(session),
      }),
      db.collection(collections.panelNoticeSignals).doc(PANEL_NOTICE_SIGNAL_DOC_ID).set({
        reason,
        revision: createPanelNoticeSignalRevision(nowIso),
        schemaVersion: PANEL_NOTICE_SCHEMA_VERSION,
        updatedAt: nowIso,
      }),
    ]);
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

  async function readPanelNoticeState() {
    assertDbReady();
    const snapshot = await db.collection(collections.panelNoticeState).doc(PANEL_NOTICE_STATE_DOC_ID).get();
    return snapshot.exists ? snapshot.data() || {} : {};
  }

  async function readPanelNoticeById(noticeIdInput) {
    const noticeId = normalizeText(noticeIdInput);
    if (!noticeId) {
      return null;
    }
    const snapshot = await db.collection(collections.panelNotices).doc(noticeId).get();
    if (!snapshot.exists) {
      return null;
    }
    return normalizeStoredPanelNotice(snapshot.data() || {}, noticeId);
  }

  async function readRecentPanelNotices() {
    const collectionRef = db.collection(collections.panelNotices);
    let notices = [];
    if (typeof collectionRef.orderBy === "function") {
      const snapshot = await collectionRef.orderBy("updatedAt", "desc").limit(ADMIN_NOTICE_LIST_LIMIT).get();
      notices = readSnapshotDocs(snapshot).map((entry) => normalizeStoredPanelNotice(entry.data, entry.id));
    } else if (typeof collectionRef.get === "function") {
      const snapshot = await collectionRef.get();
      notices = readSnapshotDocs(snapshot).map((entry) => normalizeStoredPanelNotice(entry.data, entry.id));
    }
    return normalizeNoticeSortOrders(notices)
      .sort(comparePanelNoticeOrder)
      .slice(0, ADMIN_NOTICE_LIST_LIMIT);
  }

  function normalizeStoredPanelNotice(data, noticeId) {
    return {
      archivedAt: normalizeText(data.archivedAt),
      bodyMarkdown: normalizeText(data.bodyMarkdown),
      createdAt: normalizeText(data.createdAt),
      cta: normalizePanelNoticeCta(data.cta, { allowEmpty: true }),
      endsAt: normalizeText(data.endsAt),
      noticeId: normalizeText(data.noticeId) || normalizeText(noticeId),
      publishedAt: normalizeText(data.publishedAt),
      schemaVersion: Number(data.schemaVersion) || PANEL_NOTICE_SCHEMA_VERSION,
      sortOrder: readPanelNoticeSortOrder(data),
      startsAt: normalizeText(data.startsAt),
      status: normalizeText(data.status) || "draft",
      title: normalizeText(data.title),
      updatedAt: normalizeText(data.updatedAt),
      updatedBy: normalizeAdminNoticeActor(data.updatedBy),
      version: normalizeNoticeVersion(data.version),
    };
  }

  function normalizePanelNoticeInput(input = {}, options = {}) {
    const title = normalizeText(input.title);
    const bodyMarkdown = normalizeText(input.bodyMarkdown || input.body);
    if (!title) {
      throw createHttpError(400, "소식 제목이 없어요.");
    }
    if (title.length > MAX_NOTICE_TITLE_LENGTH) {
      throw createHttpError(400, `소식 제목은 ${MAX_NOTICE_TITLE_LENGTH}자 이하로 입력해 주세요.`);
    }
    if (!bodyMarkdown) {
      throw createHttpError(400, "소식 본문이 없어요.");
    }
    if (bodyMarkdown.length > MAX_NOTICE_BODY_LENGTH) {
      throw createHttpError(400, `소식 본문은 ${MAX_NOTICE_BODY_LENGTH}자 이하로 입력해 주세요.`);
    }
    validateMarkdownLinks(bodyMarkdown);
    const startsAt = normalizeOptionalIsoTimestamp(input.startsAt, "노출 시작일");
    const endsAt = normalizeRequiredIsoTimestamp(input.endsAt, "노출 종료일");
    if (options.requireFutureEnd === true && Date.parse(endsAt) <= now()) {
      throw createHttpError(400, "노출 종료일은 현재보다 이후여야 합니다.");
    }
    return {
      bodyMarkdown,
      cta: normalizePanelNoticeCta(input.cta || {
        label: input.ctaLabel,
        url: input.ctaUrl,
      }),
      endsAt,
      noticeId: normalizeText(input.noticeId),
      startsAt,
      title,
    };
  }

  async function readNextPanelNoticeSortOrder() {
    const notices = await readRecentPanelNotices();
    if (!notices.length) {
      return 1000;
    }
    return Math.min(...notices.map((notice) => readPanelNoticeSortOrder(notice))) - 1000;
  }

  function normalizeNoticeSortOrders(notices) {
    return (Array.isArray(notices) ? notices : []).map((notice, index) => ({
      ...notice,
      sortOrder: Number.isFinite(Number(notice.sortOrder))
        ? Number(notice.sortOrder)
        : readFallbackPanelNoticeSortOrder(notice, index),
    }));
  }

  function comparePanelNoticeOrder(left, right) {
    const sortDelta = readPanelNoticeSortOrder(left) - readPanelNoticeSortOrder(right);
    if (sortDelta !== 0) {
      return sortDelta;
    }
    return normalizeText(right.updatedAt).localeCompare(normalizeText(left.updatedAt));
  }

  function readPanelNoticeSortOrder(notice) {
    const sortOrder = Number(notice?.sortOrder);
    return Number.isFinite(sortOrder) ? sortOrder : readFallbackPanelNoticeSortOrder(notice);
  }

  function readFallbackPanelNoticeSortOrder(notice, index = 0) {
    const timestamp = Date.parse(normalizeText(notice?.updatedAt || notice?.createdAt));
    return Number.isFinite(timestamp) ? -timestamp : Number(index) || 0;
  }

  function normalizePanelNoticeCta(ctaInput = {}, options = {}) {
    const cta = ctaInput && typeof ctaInput === "object" ? ctaInput : {};
    const label = normalizeText(cta.label).slice(0, MAX_NOTICE_CTA_LABEL_LENGTH + 1);
    const url = normalizeText(cta.url);
    if (!label && !url && options.allowEmpty !== false) {
      return null;
    }
    if (!label || !url) {
      throw createHttpError(400, "CTA는 라벨과 URL을 함께 입력해 주세요.");
    }
    if (label.length > MAX_NOTICE_CTA_LABEL_LENGTH) {
      throw createHttpError(400, `CTA 라벨은 ${MAX_NOTICE_CTA_LABEL_LENGTH}자 이하로 입력해 주세요.`);
    }
    assertHttpsUrl(url, "CTA URL");
    return { label, url };
  }

  function normalizeOptionalIsoTimestamp(value, label) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return "";
    }
    return normalizeRequiredIsoTimestamp(normalized, label);
  }

  function normalizeRequiredIsoTimestamp(value, label) {
    const timestamp = Date.parse(normalizeText(value));
    if (!Number.isFinite(timestamp)) {
      throw createHttpError(400, `${label} 형식이 올바르지 않아요.`);
    }
    return new Date(timestamp).toISOString();
  }

  function validateMarkdownLinks(markdown) {
    const pattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
    let match = pattern.exec(markdown);
    while (match) {
      assertHttpsUrl(match[2], "Markdown 링크");
      match = pattern.exec(markdown);
    }
  }

  function assertHttpsUrl(urlInput, label) {
    let url;
    try {
      url = new URL(normalizeText(urlInput));
    } catch {
      throw createHttpError(400, `${label} 형식이 올바르지 않아요.`);
    }
    if (url.protocol !== "https:") {
      throw createHttpError(400, `${label}는 https:// URL만 사용할 수 있어요.`);
    }
  }

  function isPanelNoticeVisible(notice) {
    if (normalizeText(notice.status) === "archived") {
      return false;
    }
    const nowMs = now();
    const startsAtMs = Date.parse(normalizeText(notice.startsAt));
    const endsAtMs = Date.parse(normalizeText(notice.endsAt));
    return (!Number.isFinite(startsAtMs) || startsAtMs <= nowMs)
      && Number.isFinite(endsAtMs)
      && endsAtMs > nowMs;
  }

  function toPublicPanelNotice(notice) {
    return {
      bodyHtml: renderPanelNoticeMarkdown(notice.bodyMarkdown),
      cta: notice.cta ? { ...notice.cta } : null,
      endsAt: normalizeText(notice.endsAt),
      noticeId: normalizeText(notice.noticeId),
      publishedAt: normalizeText(notice.publishedAt),
      sortOrder: readPanelNoticeSortOrder(notice),
      startsAt: normalizeText(notice.startsAt),
      title: normalizeText(notice.title),
      version: normalizeNoticeVersion(notice.version),
    };
  }

  function toAdminPanelNotice(notice) {
    return {
      archivedAt: normalizeText(notice.archivedAt),
      bodyHtml: renderPanelNoticeMarkdown(notice.bodyMarkdown),
      bodyMarkdown: normalizeText(notice.bodyMarkdown),
      createdAt: normalizeText(notice.createdAt),
      cta: notice.cta ? { ...notice.cta } : null,
      endsAt: normalizeText(notice.endsAt),
      noticeId: normalizeText(notice.noticeId),
      publishedAt: normalizeText(notice.publishedAt),
      sortOrder: readPanelNoticeSortOrder(notice),
      startsAt: normalizeText(notice.startsAt),
      status: normalizeText(notice.status) || "draft",
      title: normalizeText(notice.title),
      updatedAt: normalizeText(notice.updatedAt),
      updatedBy: normalizeAdminNoticeActor(notice.updatedBy),
      version: normalizeNoticeVersion(notice.version),
    };
  }

  function renderPanelNoticeMarkdown(markdown) {
    const blocks = [];
    let paragraphLines = [];
    let listItems = [];
    normalizeText(markdown).split(/\r?\n/).forEach((line) => {
      const trimmed = normalizeText(line);
      if (!trimmed) {
        flushParagraph();
        flushList();
        return;
      }
      const listMatch = line.match(/^\s*-\s+(.+)$/);
      if (listMatch) {
        flushParagraph();
        listItems.push(`<li>${renderInlineNoticeMarkdown(listMatch[1])}</li>`);
        return;
      }
      flushList();
      paragraphLines.push(renderInlineNoticeMarkdown(line));
    });
    flushParagraph();
    flushList();
    return blocks.join("");

    function flushParagraph() {
      if (!paragraphLines.length) {
        return;
      }
      blocks.push(`<p>${paragraphLines.join("<br>")}</p>`);
      paragraphLines = [];
    }

    function flushList() {
      if (!listItems.length) {
        return;
      }
      blocks.push(`<ul>${listItems.join("")}</ul>`);
      listItems = [];
    }
  }

  function renderInlineNoticeMarkdown(value) {
    const source = String(value || "");
    const linkPattern = /\[([^\]\n]+)\]\((https:\/\/[^)\s]+)\)/g;
    let html = "";
    let lastIndex = 0;
    let match = linkPattern.exec(source);
    while (match) {
      html += renderInlineNoticeText(source.slice(lastIndex, match.index));
      html += `<a href="${escapeHtmlAttribute(match[2])}" target="_blank" rel="noopener noreferrer">${renderInlineNoticeText(match[1])}</a>`;
      lastIndex = match.index + match[0].length;
      match = linkPattern.exec(source);
    }
    html += renderInlineNoticeText(source.slice(lastIndex));
    return html;
  }

  function renderInlineNoticeText(value) {
    return escapeHtml(value)
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  }

  function buildAdminNoticeActor(session) {
    const owner = normalizeOwner(session.owner);
    return {
      displayName: owner.displayName,
      email: owner.email,
      providerUserKey: owner.providerUserKey,
      role: normalizeAdminRole(session.role),
    };
  }

  function normalizeAdminNoticeActor(actorInput = {}) {
    const actor = actorInput && typeof actorInput === "object" ? actorInput : {};
    return {
      displayName: normalizeText(actor.displayName),
      email: normalizeText(actor.email).toLowerCase(),
      providerUserKey: normalizeText(actor.providerUserKey),
      role: normalizeAdminRole(actor.role),
    };
  }

  function normalizeNoticeVersion(value) {
    const version = Number(value);
    return Number.isInteger(version) && version > 0 ? version : 1;
  }

  function readSnapshotDocs(snapshot) {
    return (Array.isArray(snapshot?.docs) ? snapshot.docs : []).map((doc) => ({
      data: typeof doc.data === "function" ? doc.data() || {} : {},
      id: normalizeText(doc.id),
    }));
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

  function createPanelNoticeSignalRevision(nowIso) {
    return `${normalizeText(nowIso) || new Date(now()).toISOString()}-${crypto.randomBytes(6).toString("hex")}`;
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
    archiveAdminPanelNotice,
    checkAdminAccess,
    deleteAdminPanelNotice,
    exchangeAdminLaunch,
    issueAdminLaunch,
    listAdminPanelNotices,
    moveAdminPanelNotice,
    publishAdminPanelNotice,
    readAdminBootstrap,
    readPanelNotice,
    saveAdminPanelNotice,
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

module.exports = {
  ADMIN_COLLECTIONS,
  createAdminDomain,
  registerAdminHandlers,
};
