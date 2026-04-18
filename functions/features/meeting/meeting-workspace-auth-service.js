const crypto = require("crypto");
const { normalizeText: normalizeString } = require("./meeting-common-domain");

const LOCAL_WORKSPACE_ORIGINS = new Set([
  "http://127.0.0.1:5000",
  "http://localhost:5000",
]);
const MEETING_COLLECTION = "integration_inova_meetings";
const OWNER_ACCESS_MODE = "owner-secure";
const OWNER_SCOPE = "meeting-workspace-owner";
const SHARE_ACTIVE_STATUS = "active";
const SHARE_ACCESS_MODE = "share-readonly";
const SHARE_REVOKED_STATUS = "revoked";
const SHARE_SCOPE = "meeting-workspace-share";
const WORKSPACE_SESSION_COLLECTION = "integration_inova_meeting_workspace_sessions";
const DEFAULT_WORKSPACE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function registerMeetingWorkspaceAuthHandlers(deps) {
  const {
    CORS_ORIGINS,
    REGION,
    createFirebaseCustomToken,
    createHttpError,
    db,
    logEvent,
    normalizeIdentity,
    normalizeText,
    onRequest,
    sendError,
    verifyFirebaseIdToken,
    verifyInovaIdentity,
  } = deps;

  const authorizeInovaMeetingWorkspaceAccess = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request, createHttpError);
      if (typeof createFirebaseCustomToken !== "function") {
        throw createHttpError(500, "작업실 접근 인증을 준비하지 못했어요.");
      }
      const input = normalizeWorkspaceAuthorizeRequest(request.body);
      const bypassMode = resolveDebugBypassMode(request, input.debugAuthBypass);
      if (bypassMode) {
        const payload = await buildBypassAccessPayload(input, bypassMode);
        response.json({ ok: true, data: payload });
        return;
      }

      const viewer = await verifyBearerViewer(request, request.body?.providerIdentity || request.body?.owner);
      const payload = input.shareToken
        ? await buildShareAccessPayload(input, viewer)
        : await buildOwnerAccessPayload(input, viewer);
      response.json({ ok: true, data: payload });
    } catch (error) {
      logEvent?.("meeting.workspace-authorize.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const createInovaMeetingShareLink = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request, createHttpError);
      const owner = await verifyBearerViewer(request, request.body?.owner || request.body?.providerIdentity);
      const input = normalizeShareLinkRequest(request.body);
      if (!input.meetingId) {
        throw createHttpError(400, "공유 링크를 만들 회의 ID가 없어요.");
      }

      const { currentShare, nextShare } = await createMeetingShareLinkTransaction(owner, input);

      logEvent?.("meeting.share-link.create.success", {
        clientRequestId: input.clientRequestId,
        meetingId: input.meetingId,
        providerUserKey: owner.providerUserKey,
        reused: Boolean(currentShare.active && currentShare.shareId),
        shareId: nextShare.shareId,
      });

      response.json({
        ok: true,
        data: {
          meetingId: input.meetingId,
          share: buildShareResponse(nextShare),
          shareToken: buildShareToken(nextShare.shareId, input.meetingId, owner.providerUserKey),
        },
      });
    } catch (error) {
      logEvent?.("meeting.share-link.create.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const revokeInovaMeetingShareLink = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request, createHttpError);
      const owner = await verifyBearerViewer(request, request.body?.owner || request.body?.providerIdentity);
      const input = normalizeShareLinkRequest(request.body);
      if (!input.meetingId) {
        throw createHttpError(400, "공유 링크를 해제할 회의 ID가 없어요.");
      }

      const { currentShare, nextShare } = await revokeMeetingShareLinkTransaction(owner, input);

      logEvent?.("meeting.share-link.revoke.success", {
        clientRequestId: input.clientRequestId,
        meetingId: input.meetingId,
        providerUserKey: owner.providerUserKey,
        shareId: currentShare.shareId,
      });

      response.json({
        ok: true,
        data: {
          meetingId: input.meetingId,
          revoked: true,
          share: buildShareResponse(nextShare),
        },
      });
    } catch (error) {
      logEvent?.("meeting.share-link.revoke.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  return {
    authorizeInovaMeetingWorkspaceAccess,
    authorizeMeetingRequest,
    createInovaMeetingShareLink,
    revokeInovaMeetingShareLink,
  };

  async function authorizeMeetingRequest(request, ownerHint, options = {}) {
    const authHeader = normalizeText(request?.headers?.authorization);
    const allowAccessToken = options.allowAccessToken !== false;
    const allowWorkspaceSession = options.allowWorkspaceSession !== false;
    const allowFirebaseSession = options.allowFirebaseSession !== false;

    if (allowFirebaseSession && authHeader.toLowerCase().startsWith("firebasesession ")) {
      const firebaseSessionToken = authHeader.slice("FirebaseSession ".length).trim();
      return verifyWorkspaceFirebaseSession(firebaseSessionToken);
    }

    if (allowWorkspaceSession && authHeader.toLowerCase().startsWith("meetingsession ")) {
      const workspaceSessionToken = authHeader.slice("MeetingSession ".length).trim();
      const workspaceSession = await verifyWorkspaceSession(workspaceSessionToken);
      return {
        accessMode: OWNER_ACCESS_MODE,
        authType: "meeting-session",
        owner: workspaceSession.owner,
        readOnly: false,
        viewer: workspaceSession.owner,
        workspaceSession,
      };
    }

    if (!allowAccessToken) {
      throw createHttpError(401, "회의 작업실 인증이 필요해요. 패널에서 다시 열어 주세요.");
    }

    const viewer = await verifyBearerViewer(request, ownerHint);
    return {
      accessMode: OWNER_ACCESS_MODE,
      authType: "access-token",
      owner: viewer,
      readOnly: false,
      viewer,
      workspaceSession: null,
    };
  }

  async function verifyBearerViewer(request, identityHint) {
    const providerIdentity = normalizeIdentity(identityHint);
    return verifyInovaIdentity(providerIdentity, request);
  }

  async function verifyWorkspaceFirebaseSession(firebaseSessionToken) {
    if (typeof verifyFirebaseIdToken !== "function") {
      throw createHttpError(500, "작업실 Firebase 세션 검증을 준비하지 못했어요.");
    }
    const token = normalizeText(firebaseSessionToken);
    if (!token) {
      throw createHttpError(401, "작업실 Firebase 세션이 없어요.");
    }
    let decoded;
    try {
      decoded = await verifyFirebaseIdToken(token);
    } catch {
      throw createHttpError(401, "작업실 Firebase 세션 검증에 실패했어요.");
    }

    const scope = normalizeText(decoded?.scope);
    const accessMode = normalizeText(decoded?.accessMode);
    const meetingId = normalizeText(decoded?.meetingId);
    const ownerProviderUserKey = normalizeText(decoded?.ownerProviderUserKey || decoded?.providerUserKey);
    const viewerProviderUserKey = normalizeText(decoded?.viewerProviderUserKey || decoded?.providerUserKey);
    if (!meetingId || !ownerProviderUserKey) {
      throw createHttpError(401, "작업실 Firebase 세션 정보가 올바르지 않아요.");
    }
    const readOnly = scope === SHARE_SCOPE || accessMode === SHARE_ACCESS_MODE || Boolean(decoded?.readOnly);
    return {
      accessMode: readOnly ? SHARE_ACCESS_MODE : OWNER_ACCESS_MODE,
      authType: "firebase-session",
      firebaseSession: {
        accessMode: readOnly ? SHARE_ACCESS_MODE : OWNER_ACCESS_MODE,
        meetingId,
        ownerProviderUserKey,
        readOnly,
        shareId: normalizeText(decoded?.shareId),
        viewerProviderUserKey,
      },
      owner: normalizeIdentity({
        email: normalizeText(decoded?.ownerEmail),
        providerUserKey: ownerProviderUserKey,
      }),
      readOnly,
      viewer: normalizeIdentity({
        email: normalizeText(decoded?.viewerEmail),
        providerUserKey: viewerProviderUserKey,
      }),
      workspaceSession: {
        meeting: {
          meetingId,
        },
      },
    };
  }

  async function verifyWorkspaceSession(workspaceSessionToken) {
    const { id, secret } = splitToken(workspaceSessionToken, "meeting session token");
    const snapshot = await db.collection(WORKSPACE_SESSION_COLLECTION).doc(id).get();
    if (!snapshot.exists) {
      throw createHttpError(401, "회의 작업실 세션이 없어요. 패널에서 다시 열어 주세요.");
    }
    const workspaceSession = snapshot.data() || {};
    assertHasValidSecret(workspaceSession.secretHash, secret, "회의 작업실 세션이 올바르지 않아요.");
    if (normalizeText(workspaceSession.status) !== "active") {
      throw createHttpError(401, "회의 작업실 세션이 종료되었어요. 패널에서 다시 열어 주세요.");
    }
    assertNotExpired(workspaceSession.expiresAt, "회의 작업실 세션이 만료되었어요. 패널에서 다시 열어 주세요.");
    return {
      ...workspaceSession,
      jobId: normalizeText(workspaceSession.jobId),
      meeting: {
        meetingId: normalizeText(workspaceSession?.meeting?.meetingId),
        title: normalizeText(workspaceSession?.meeting?.title),
      },
      mode: normalizeText(workspaceSession.mode) || "create",
      owner: normalizeIdentity(workspaceSession.owner),
    };
  }

  async function buildOwnerAccessPayload(input, viewer) {
    const existingMeeting = await loadMeetingSummarySafely(viewer, input.meetingId);
    if (existingMeeting.errorStatus === 403) {
      return buildBlockedAccessPayload(input, "owner-only", {
        inovaLogin: true,
        viewer,
      });
    }
    return buildAllowedAccessPayload({
      accessMode: OWNER_ACCESS_MODE,
      bypassMode: "",
      input,
      owner: viewer,
      readOnly: false,
      viewer,
    });
  }

  async function buildShareAccessPayload(input, viewer) {
    const meetingRecord = await loadMeetingRecordByMeetingId(input.meetingId);
    if (!meetingRecord?.meeting?.meetingId || meetingRecord.meeting.deletedAt) {
      return buildBlockedAccessPayload(input, "share-invalid", {
        inovaLogin: true,
        viewer,
      });
    }
    const owner = normalizeIdentity(meetingRecord.meeting.owner);
    const share = normalizeShareMetadata(meetingRecord.meeting.share);
    const tokenParts = safeSplitShareToken(input.shareToken);
    const expectedSecret = buildShareSecret(share.shareId, input.meetingId, owner.providerUserKey);
    const providedSecretHash = hashSecret(tokenParts.secret);
    if (!share.shareId || tokenParts.id !== share.shareId) {
      return buildBlockedAccessPayload(input, "share-invalid", {
        inovaLogin: true,
        viewer,
      });
    }
    if (share.status === SHARE_REVOKED_STATUS) {
      return buildBlockedAccessPayload(input, "share-revoked", {
        inovaLogin: true,
        viewer,
      });
    }
    if (!share.active || !share.secretHash || share.secretHash !== providedSecretHash || tokenParts.secret !== expectedSecret) {
      return buildBlockedAccessPayload(input, "share-invalid", {
        inovaLogin: true,
        viewer,
      });
    }
    if (!hasSameEmailDomain(owner?.email, viewer?.email)) {
      return buildBlockedAccessPayload(input, "share-domain-mismatch", {
        inovaLogin: true,
        viewer,
      });
    }
    return buildAllowedAccessPayload({
      accessMode: SHARE_ACCESS_MODE,
      bypassMode: "",
      input,
      owner,
      readOnly: true,
      shareId: share.shareId,
      viewer,
    });
  }

  async function buildBypassAccessPayload(input, bypassMode) {
    const meetingRecord = await loadMeetingRecordByMeetingId(input.meetingId);
    const owner = normalizeIdentity(meetingRecord?.meeting?.owner?.providerUserKey
      ? meetingRecord.meeting.owner
      : {
          email: "dev-bypass@local.test",
          providerUserKey: "debug-bypass-owner",
        });
    const viewer = normalizeIdentity({
      email: bypassMode === "readonly" ? "dev-bypass-readonly@local.test" : owner.email,
      providerUserKey: bypassMode === "readonly" ? "debug-bypass-viewer" : owner.providerUserKey,
    });
    return buildAllowedAccessPayload({
      accessMode: bypassMode === "readonly" ? SHARE_ACCESS_MODE : OWNER_ACCESS_MODE,
      bypassMode,
      input,
      owner,
      readOnly: bypassMode === "readonly",
      shareId: bypassMode === "readonly" ? "debug-bypass-share" : "",
      viewer,
    });
  }

  async function buildAllowedAccessPayload(options) {
    const accessMode = normalizeText(options.accessMode) === SHARE_ACCESS_MODE ? SHARE_ACCESS_MODE : OWNER_ACCESS_MODE;
    const input = options.input || {};
    const owner = normalizeIdentity(options.owner);
    const viewer = normalizeIdentity(options.viewer || owner);
    const meetingId = normalizeText(input.meetingId);
    const readOnly = Boolean(options.readOnly);
    const shareId = normalizeText(options.shareId);
    const bypassMode = normalizeText(options.bypassMode);
    const meetingDocumentId = buildMeetingDocId(owner.providerUserKey, meetingId);
    const workspaceSession = readOnly
      ? null
      : await issueWorkspaceSession({ input, owner });
    const firebaseCustomToken = await createFirebaseCustomToken(
      buildWorkspaceFirebaseUid(owner.providerUserKey, viewer.providerUserKey, readOnly),
      {
        accessMode,
        meetingId,
        ownerEmail: normalizeText(owner.email),
        ownerProviderUserKey: owner.providerUserKey,
        providerUserKey: owner.providerUserKey,
        readOnly,
        scope: readOnly ? SHARE_SCOPE : OWNER_SCOPE,
        shareId,
        viewerEmail: normalizeText(viewer.email),
        viewerProviderUserKey: viewer.providerUserKey || owner.providerUserKey,
      }
    );
    logEvent?.("meeting.workspace-authorize.success", {
      accessMode,
      meetingDocumentId,
      meetingId,
      providerUserKey: owner.providerUserKey,
      readOnly,
      viewerProviderUserKey: viewer.providerUserKey || owner.providerUserKey,
    });
    return {
      accessDecision: "allowed",
      accessMode,
      expiresAt: normalizeText(workspaceSession?.expiresAt),
      bypassApplied: Boolean(bypassMode),
      bypassMode,
      firebaseCustomToken,
      inovaLogin: true,
      meetingDocumentId,
      meetingId,
      meetingSessionToken: normalizeText(workspaceSession?.meetingSessionToken),
      readOnly,
      reason: "",
      shareId,
      viewer: buildViewerSummary(viewer),
      workspaceSessionId: normalizeText(workspaceSession?.workspaceSessionId),
    };
  }

  async function issueWorkspaceSession(options) {
    const input = options?.input || {};
    const owner = normalizeIdentity(options?.owner);
    const meetingId = normalizeText(input.meetingId);
    if (!meetingId || !owner?.providerUserKey) {
      throw createHttpError(400, "회의 작업실 세션 발급에 필요한 정보가 비어 있어요.");
    }
    const workspaceSessionId = db.collection(WORKSPACE_SESSION_COLLECTION).doc().id;
    const workspaceSecret = createSecret();
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + DEFAULT_WORKSPACE_SESSION_TTL_MS).toISOString();
    const workspaceSessionToken = `${workspaceSessionId}.${workspaceSecret}`;
    await db.collection(WORKSPACE_SESSION_COLLECTION).doc(workspaceSessionId).set({
      expiresAt,
      issuedAt,
      jobId: normalizeText(input.jobId),
      meeting: {
        meetingId,
        title: "",
      },
      mode: normalizeText(input.jobId) ? "detail" : "create",
      owner: { ...owner },
      secretHash: hashSecret(workspaceSecret),
      status: "active",
      workspaceSessionId,
    });
    return {
      expiresAt,
      meetingSessionToken: workspaceSessionToken,
      workspaceSessionId,
    };
  }

  function buildBlockedAccessPayload(input, reason, options = {}) {
    return {
      accessDecision: "denied",
      accessMode: "blocked",
      bypassApplied: false,
      bypassMode: "",
      firebaseCustomToken: "",
      inovaLogin: options.inovaLogin !== false,
      meetingDocumentId: "",
      meetingId: normalizeText(input?.meetingId),
      readOnly: false,
      reason: normalizeText(reason),
      shareId: "",
      viewer: buildViewerSummary(options.viewer),
    };
  }

  async function loadOwnedMeetingRecord(owner, meetingId) {
    const normalizedMeetingId = normalizeText(meetingId);
    if (!normalizedMeetingId || !owner?.providerUserKey) {
      return null;
    }
    const ref = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, normalizedMeetingId));
    const snapshot = await ref.get();
    const meeting = readOwnedMeetingRecordFromSnapshot(owner, snapshot);
    return meeting ? { meeting, ref } : null;
  }

  function readOwnedMeetingRecordFromSnapshot(owner, snapshot) {
    if (!snapshot.exists) {
      return null;
    }
    const meeting = normalizeMeetingRecord(snapshot.data());
    if (meeting.deletedAt) {
      return null;
    }
    if (normalizeText(meeting.owner?.providerUserKey) && normalizeText(meeting.owner?.providerUserKey) !== owner.providerUserKey) {
      throw createHttpError(403, "다른 사용자의 회의 기록에는 접근할 수 없어요.");
    }
    return meeting;
  }

  async function createMeetingShareLinkTransaction(owner, input) {
    const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, input.meetingId));
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(meetingRef);
      const meeting = readOwnedMeetingRecordFromSnapshot(owner, snapshot);
      if (!meeting?.meetingId) {
        throw createHttpError(404, "공유할 회의를 찾지 못했어요.");
      }
      const currentShare = normalizeShareMetadata(meeting.share);
      if (currentShare.active && currentShare.shareId) {
        return { currentShare, nextShare: currentShare };
      }
      const shareId = db.collection(MEETING_COLLECTION).doc().id;
      const secret = buildShareSecret(shareId, input.meetingId, owner.providerUserKey);
      const nextShare = {
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: owner ? { ...owner } : {},
        revokedAt: "",
        secretHash: hashSecret(secret),
        shareId,
        status: SHARE_ACTIVE_STATUS,
      };
      transaction.set(meetingRef, {
        share: {
          createdAt: nextShare.createdAt,
          createdBy: nextShare.createdBy,
          revokedAt: "",
          secretHash: nextShare.secretHash,
          shareId: nextShare.shareId,
          status: nextShare.status,
        },
      }, { merge: true });
      return { currentShare, nextShare };
    });
  }

  async function revokeMeetingShareLinkTransaction(owner, input) {
    const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, input.meetingId));
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(meetingRef);
      const meeting = readOwnedMeetingRecordFromSnapshot(owner, snapshot);
      if (!meeting?.meetingId) {
        throw createHttpError(404, "공유 해제할 회의를 찾지 못했어요.");
      }
      const currentShare = normalizeShareMetadata(meeting.share);
      const nextShare = {
        ...currentShare,
        active: false,
        revokedAt: new Date().toISOString(),
        status: SHARE_REVOKED_STATUS,
      };
      transaction.set(meetingRef, {
        share: {
          createdAt: currentShare.createdAt,
          createdBy: currentShare.createdBy,
          revokedAt: nextShare.revokedAt,
          secretHash: currentShare.secretHash,
          shareId: currentShare.shareId,
          status: SHARE_REVOKED_STATUS,
        },
      }, { merge: true });
      return { currentShare, nextShare };
    });
  }

  async function loadMeetingRecordByMeetingId(meetingId) {
    const normalizedMeetingId = normalizeText(meetingId);
    if (!normalizedMeetingId) {
      return null;
    }
    const collection = db.collection(MEETING_COLLECTION);
    const snapshot = await collection.where("meetingId", "==", normalizedMeetingId).limit(2).get();
    const docs = Array.isArray(snapshot?.docs) ? snapshot.docs : [];
    if (!docs.length) {
      return null;
    }
    const doc = docs[0];
    return {
      meeting: normalizeMeetingRecord(doc.data()),
      ref: doc.ref,
    };
  }

  async function loadMeetingSummarySafely(owner, meetingId) {
    try {
      const record = await loadOwnedMeetingRecord(owner, meetingId);
      return {
        errorStatus: 0,
        meeting: record?.meeting || null,
      };
    } catch (error) {
      return {
        errorStatus: Number(error?.status) || 500,
        meeting: null,
      };
    }
  }

  function normalizeWorkspaceAuthorizeRequest(input) {
    const nextInput = input && typeof input === "object" ? input : {};
    return {
      debugAuthBypass: normalizeText(nextInput.debugAuthBypass),
      jobId: normalizeText(nextInput.jobId),
      meetingId: normalizeText(nextInput.meetingId),
      shareToken: normalizeText(nextInput.shareToken || nextInput.share),
    };
  }

  function normalizeShareLinkRequest(input) {
    const nextInput = input && typeof input === "object" ? input : {};
    return {
      clientRequestId: normalizeText(nextInput.clientRequestId),
      jobId: normalizeText(nextInput.jobId),
      meetingId: normalizeText(nextInput.meetingId),
    };
  }

  function resolveDebugBypassMode(request, requestedMode) {
    const normalizedMode = normalizeText(requestedMode).toLowerCase();
    if (!["owner", "readonly"].includes(normalizedMode)) {
      return "";
    }
    if (!isTrustedDebugBypassRuntime()) {
      return "";
    }
    return isLocalWorkspaceRequest(request) ? normalizedMode : "";
  }

  function isLocalWorkspaceRequest(request) {
    const origin = normalizeText(request.get("origin"));
    const referer = normalizeText(request.get("referer"));
    if (LOCAL_WORKSPACE_ORIGINS.has(origin)) {
      return true;
    }
    for (const allowedOrigin of LOCAL_WORKSPACE_ORIGINS) {
      if (referer.startsWith(allowedOrigin)) {
        return true;
      }
    }
    return false;
  }
}

function isTrustedDebugBypassRuntime() {
  return ["1", "true", "yes", "on"].includes(normalizeString(process.env.FUNCTIONS_EMULATOR).toLowerCase())
    || Boolean(normalizeString(process.env.FIREBASE_AUTH_EMULATOR_HOST))
    || Boolean(normalizeString(process.env.FIRESTORE_EMULATOR_HOST))
    || Boolean(normalizeString(process.env.FIREBASE_STORAGE_EMULATOR_HOST));
}

function assertMethod(request, createHttpError) {
  if (request.method !== "POST") {
    throw createHttpError(405, "POST 요청만 지원해요.");
  }
}

function normalizeMeetingRecord(input) {
  const meeting = input && typeof input === "object" ? input : {};
  return {
    deletedAt: normalizeString(meeting.deletedAt),
    meetingId: normalizeString(meeting.meetingId),
    owner: normalizeIdentityLike(meeting.owner),
    share: normalizeShareMetadata(meeting.share),
    title: normalizeString(meeting.title),
  };
}

function normalizeShareMetadata(input) {
  const share = input && typeof input === "object" ? input : {};
  const status = normalizeString(share.status);
  return {
    active: status === SHARE_ACTIVE_STATUS && Boolean(normalizeString(share.shareId)),
    createdAt: normalizeString(share.createdAt),
    createdBy: normalizeIdentityLike(share.createdBy),
    revokedAt: normalizeString(share.revokedAt),
    secretHash: normalizeString(share.secretHash),
    shareId: normalizeString(share.shareId),
    status: status || "",
  };
}

function buildShareResponse(share) {
  const normalized = normalizeShareMetadata(share);
  return {
    active: normalized.active,
    createdAt: normalized.createdAt,
    createdBy: buildViewerSummary(normalized.createdBy),
    revokedAt: normalized.revokedAt,
    shareId: normalized.shareId,
    status: normalized.status,
  };
}

function buildViewerSummary(identity) {
  const normalized = normalizeIdentityLike(identity);
  return {
    displayName: normalizeString(normalized.displayName),
    email: normalizeString(normalized.email),
    providerUserKey: normalizeString(normalized.providerUserKey),
  };
}

function buildMeetingDocId(providerUserKey, meetingId) {
  return `${normalizeString(providerUserKey)}__${normalizeString(meetingId)}`;
}

function buildWorkspaceFirebaseUid(ownerProviderUserKey, viewerProviderUserKey, readOnly) {
  const safeOwnerKey = normalizeString(ownerProviderUserKey).replace(/[^A-Za-z0-9._-]/g, "_");
  const safeViewerKey = normalizeString(viewerProviderUserKey || ownerProviderUserKey).replace(/[^A-Za-z0-9._-]/g, "_");
  return readOnly
    ? `inova-workspace-share__${safeOwnerKey}__${safeViewerKey}`
    : `inova-workspace__${safeOwnerKey}`;
}

function buildShareSecret(shareId, meetingId, providerUserKey) {
  return hashSecret(`meeting-share:${normalizeString(shareId)}:${normalizeString(meetingId)}:${normalizeString(providerUserKey)}`).slice(0, 36);
}

function buildShareToken(shareId, meetingId, providerUserKey) {
  const normalizedShareId = normalizeString(shareId);
  return normalizedShareId
    ? `${normalizedShareId}.${buildShareSecret(normalizedShareId, meetingId, providerUserKey)}`
    : "";
}

function safeSplitShareToken(token) {
  try {
    return splitToken(token, "share token");
  } catch {
    return {
      id: "",
      secret: "",
    };
  }
}

function normalizeIdentityLike(identity) {
  return {
    displayName: normalizeString(identity?.displayName),
    email: normalizeString(identity?.email).toLowerCase(),
    numericUserId: Number.isFinite(Number(identity?.numericUserId)) ? Number(identity.numericUserId) : null,
    provider: normalizeString(identity?.provider) || "inova",
    providerUserKey: normalizeString(identity?.providerUserKey),
  };
}

function getEmailDomain(email) {
  const normalized = normalizeString(email).toLowerCase();
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex <= 0 || atIndex >= normalized.length - 1) {
    return "";
  }
  return normalized.slice(atIndex + 1);
}

function hasSameEmailDomain(leftEmail, rightEmail) {
  const leftDomain = getEmailDomain(leftEmail);
  const rightDomain = getEmailDomain(rightEmail);
  return Boolean(leftDomain) && leftDomain === rightDomain;
}

function createSecret() {
  return crypto.randomBytes(18).toString("hex");
}

function hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest("hex");
}

function splitToken(token, label) {
  const normalized = normalizeString(token);
  const separatorIndex = normalized.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex >= normalized.length - 1) {
    const error = new Error(`${label} 형식이 올바르지 않아요.`);
    error.status = 400;
    throw error;
  }
  return {
    id: normalized.slice(0, separatorIndex),
    secret: normalized.slice(separatorIndex + 1),
  };
}

function assertHasValidSecret(expectedHash, secret, message) {
  const providedHash = hashSecret(secret);
  if (!expectedHash || expectedHash !== providedHash) {
    const error = new Error(message);
    error.status = 401;
    throw error;
  }
}

function assertNotExpired(expiresAt, message) {
  const expiryTime = Date.parse(String(expiresAt || ""));
  if (!expiryTime || expiryTime <= Date.now()) {
    const error = new Error(message);
    error.status = 410;
    throw error;
  }
}

module.exports = {
  registerMeetingWorkspaceAuthHandlers,
};
