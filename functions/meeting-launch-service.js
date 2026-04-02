const crypto = require("crypto");

const LAUNCH_COLLECTION = "integration_inova_meeting_launches";
const WORKSPACE_SESSION_COLLECTION = "integration_inova_meeting_workspace_sessions";
const MEETING_COLLECTION = "integration_inova_meetings";
const DEFAULT_LAUNCH_TTL_MS = 10 * 60 * 1000;
const DEFAULT_WORKSPACE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function registerMeetingLaunchHandlers(deps) {
  const {
    CORS_ORIGINS,
    REGION,
    createFirebaseCustomToken,
    createHttpError,
    db,
    hostedMeetingPageUrl,
    logEvent,
    normalizeIdentity,
    normalizeText,
    onRequest,
    sendError,
    verifyInovaIdentity,
  } = deps;

  const issueInovaMeetingLaunch = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request, createHttpError);
      const owner = await verifyBearerOwner(request, request.body?.owner || request.body?.providerIdentity);
      const input = normalizeLaunchIssueRequest(request.body);
      const meeting = await resolveMeetingForLaunch(owner, input);
      const launchId = db.collection(LAUNCH_COLLECTION).doc().id;
      const launchSecret = createSecret();
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + DEFAULT_LAUNCH_TTL_MS).toISOString();
      const launchRef = db.collection(LAUNCH_COLLECTION).doc(launchId);
      const launchToken = `${launchId}.${launchSecret}`;
      const launchRecord = {
        createdAt,
        expiresAt,
        jobId: input.jobId,
        launchId,
        meeting: {
          meetingId: meeting.meetingId,
          title: meeting.title,
        },
        mode: input.mode,
        owner,
        secretHash: hashSecret(launchSecret),
        status: "issued",
      };

      await launchRef.set(launchRecord);

      const workspaceUrl = new URL(hostedMeetingPageUrl);
      workspaceUrl.searchParams.set("launch", launchToken);

      logEvent?.("meeting.launch.issue.success", {
        meetingId: meeting.meetingId,
        mode: input.mode,
        providerUserKey: owner.providerUserKey,
      });

      response.json({
        ok: true,
        data: {
          expiresAt,
          jobId: input.jobId,
          launchToken,
          meeting,
          mode: input.mode,
          workspaceUrl: workspaceUrl.toString(),
        },
      });
    } catch (error) {
      logEvent?.("meeting.launch.issue.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const exchangeInovaMeetingLaunch = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request, createHttpError);
      const launchToken = normalizeText(request.body?.launchToken);
      if (!launchToken) {
        throw createHttpError(400, "launch token이 없어요.");
      }
      const launch = await consumeLaunchToken(launchToken);
      const workspaceSessionId = db.collection(WORKSPACE_SESSION_COLLECTION).doc().id;
      const workspaceSecret = createSecret();
      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + DEFAULT_WORKSPACE_SESSION_TTL_MS).toISOString();
      const workspaceSessionToken = `${workspaceSessionId}.${workspaceSecret}`;
      const workspaceRef = db.collection(WORKSPACE_SESSION_COLLECTION).doc(workspaceSessionId);
      const workspaceRecord = {
        expiresAt,
        issuedAt,
        jobId: normalizeText(launch.jobId),
        meeting: {
          meetingId: normalizeText(launch.meeting?.meetingId),
          title: normalizeText(launch.meeting?.title),
        },
        mode: normalizeText(launch.mode) || "create",
        owner: launch.owner && typeof launch.owner === "object" ? { ...launch.owner } : {},
        secretHash: hashSecret(workspaceSecret),
        status: "active",
        workspaceSessionId,
      };

      await workspaceRef.set(workspaceRecord);

      logEvent?.("meeting.launch.exchange.success", {
        meetingId: workspaceRecord.meeting.meetingId,
        providerUserKey: workspaceRecord.owner.providerUserKey,
        workspaceSessionId,
      });

      response.json({
        ok: true,
        data: {
          expiresAt,
          jobId: workspaceRecord.jobId,
          meeting: {
            meetingId: workspaceRecord.meeting.meetingId,
            title: workspaceRecord.meeting.title,
          },
          meetingSessionToken: workspaceSessionToken,
          mode: workspaceRecord.mode,
        },
      });
    } catch (error) {
      logEvent?.("meeting.launch.exchange.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const issueInovaMeetingWorkspaceAuth = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request, createHttpError);
      if (typeof createFirebaseCustomToken !== "function") {
        throw createHttpError(500, "작업실 Firebase 인증을 준비하지 못했어요.");
      }
      const access = await authorizeMeetingRequest(request, null, {
        allowAccessToken: false,
        allowWorkspaceSession: true,
      });
      const workspaceSession = access.workspaceSession;
      const owner = access.owner;
      const meetingId = normalizeText(workspaceSession?.meeting?.meetingId);
      const workspaceSessionId = normalizeText(workspaceSession?.workspaceSessionId);
      const expiresAt = normalizeText(workspaceSession?.expiresAt);
      if (!meetingId || !workspaceSessionId || !owner?.providerUserKey) {
        throw createHttpError(400, "작업실 Firebase 인증에 필요한 세션 정보가 비어 있어요.");
      }

      const workspaceExpMs = Date.parse(expiresAt);
      if (!(workspaceExpMs > Date.now())) {
        throw createHttpError(401, "회의 작업실 세션이 만료되었어요. 패널에서 다시 열어 주세요.");
      }

      const firebaseUid = buildWorkspaceFirebaseUid(owner.providerUserKey);
      const meetingDocumentId = buildMeetingDocId(owner.providerUserKey, meetingId);
      const meetingRef = db.collection(MEETING_COLLECTION).doc(meetingDocumentId);
      const meetingSnapshot = await meetingRef.get();
      if (meetingSnapshot.exists && !normalizeText(meetingSnapshot.data()?.owner?.providerUserKey)) {
        await meetingRef.set({
          owner: { ...owner },
        }, { merge: true });
      }
      const firebaseCustomToken = await createFirebaseCustomToken(firebaseUid, {
        meetingId,
        providerUserKey: owner.providerUserKey,
        scope: "meeting-workspace",
        workspaceExpMs,
        workspaceSessionId,
      });

      logEvent?.("meeting.workspace-auth.issue.success", {
        meetingDocumentId,
        meetingId,
        providerUserKey: owner.providerUserKey,
        workspaceSessionId,
      });

      response.json({
        ok: true,
        data: {
          expiresAt,
          firebaseCustomToken,
          meetingDocumentId,
          meetingId,
          workspaceSessionId,
        },
      });
    } catch (error) {
      logEvent?.("meeting.workspace-auth.issue.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  return {
    authorizeMeetingRequest,
    exchangeInovaMeetingLaunch,
    issueInovaMeetingLaunch,
    issueInovaMeetingWorkspaceAuth,
  };

  async function authorizeMeetingRequest(request, ownerHint, options = {}) {
    const authHeader = normalizeText(request?.headers?.authorization);
    const allowAccessToken = options.allowAccessToken !== false;
    const allowWorkspaceSession = options.allowWorkspaceSession !== false;

    if (allowWorkspaceSession && authHeader.toLowerCase().startsWith("meetingsession ")) {
      const workspaceSessionToken = authHeader.slice("MeetingSession ".length).trim();
      const workspaceSession = await verifyWorkspaceSession(workspaceSessionToken);
      return {
        authType: "meeting-session",
        owner: workspaceSession.owner,
        workspaceSession,
      };
    }

    if (!allowAccessToken) {
      throw createHttpError(401, "회의 작업실 세션이 만료되었어요. 패널에서 다시 열어 주세요.");
    }

    const owner = await verifyBearerOwner(request, ownerHint);
    return {
      authType: "access-token",
      owner,
      workspaceSession: null,
    };
  }

  async function verifyBearerOwner(request, ownerHint) {
    const providerIdentity = normalizeIdentity(ownerHint);
    return verifyInovaIdentity(providerIdentity, request);
  }

  async function resolveMeetingForLaunch(owner, input) {
    if (input.mode === "detail") {
      if (!input.meetingId) {
        throw createHttpError(400, "결과 페이지를 열 meeting ID가 없어요.");
      }
      const meeting = await loadMeetingSummary(owner, input.meetingId);
      if (!meeting) {
        throw createHttpError(404, "열 수 있는 회의 기록을 찾지 못했어요.");
      }
      return {
        meetingId: meeting.meetingId,
        title: meeting.title || input.suggestedTitle || "회의 결과",
      };
    }

    const meetingId = input.meetingId || createMeetingId();
    const existing = input.meetingId ? await loadMeetingSummary(owner, input.meetingId) : null;
    return {
      meetingId,
      title: normalizeText(existing?.title || input.suggestedTitle) || "새 회의",
    };
  }

  async function loadMeetingSummary(owner, meetingId) {
    const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, meetingId));
    const snapshot = await meetingRef.get();
    if (!snapshot.exists) {
      return null;
    }
    const meeting = snapshot.data() || {};
    const storedOwnerKey = normalizeText(meeting?.owner?.providerUserKey);
    if (storedOwnerKey && storedOwnerKey !== owner.providerUserKey) {
      throw createHttpError(403, "다른 사용자의 회의 기록에는 접근할 수 없어요.");
    }
    if (!storedOwnerKey) {
      await meetingRef.set({
        owner: { ...owner },
      }, { merge: true });
    }
    if (normalizeText(meeting.deletedAt)) {
      return null;
    }
    return {
      meetingId: normalizeText(meeting.meetingId),
      title: normalizeText(meeting.title),
    };
  }

  async function consumeLaunchToken(launchToken) {
    const { id, secret } = splitToken(launchToken, "launch token");
    const launchRef = db.collection(LAUNCH_COLLECTION).doc(id);
    const snapshot = await launchRef.get();
    if (!snapshot.exists) {
      throw createHttpError(404, "열기 링크가 만료되었어요. 패널에서 다시 열어 주세요.");
    }
    const launch = snapshot.data() || {};
    assertHasValidSecret(launch.secretHash, secret, "열기 링크가 유효하지 않아요.");
    if (normalizeText(launch.status) !== "issued") {
      throw createHttpError(410, "이미 사용된 열기 링크예요. 패널에서 다시 열어 주세요.");
    }
    assertNotExpired(launch.expiresAt, "열기 링크가 만료되었어요. 패널에서 다시 열어 주세요.");
    await launchRef.set({
      consumedAt: new Date().toISOString(),
      status: "consumed",
    }, { merge: true });
    return launch;
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
}

function assertMethod(request, createHttpError) {
  if (request.method !== "POST") {
    throw createHttpError(405, "POST 요청만 지원해요.");
  }
}

function normalizeLaunchIssueRequest(input) {
  const mode = normalizeMode(input?.mode);
  return {
    jobId: normalizeString(input?.jobId),
    meetingId: normalizeString(input?.meetingId),
    mode,
    suggestedTitle: normalizeString(input?.suggestedTitle || input?.title),
  };
}

function normalizeMode(value) {
  return normalizeString(value) === "detail" ? "detail" : "create";
}

function normalizeString(value) {
  return String(value || "").trim();
}

function createMeetingId() {
  return `meeting-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
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

function buildMeetingDocId(providerUserKey, meetingId) {
  return `${normalizeString(providerUserKey)}__${normalizeString(meetingId)}`;
}

function buildWorkspaceFirebaseUid(providerUserKey) {
  return `inova-workspace__${normalizeString(providerUserKey).replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

module.exports = {
  registerMeetingLaunchHandlers,
};
