const ALLOWED_CAPTURE_MODES = new Set(["tab-audio", "microphone", "mixed-audio"]);

function registerMeetingHandlers(deps) {
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

  const createInovaMeetingJob = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const owner = await verifyRequestIdentity(request);
      const meeting = normalizeMeetingRequest(request.body?.meeting);
      const source = normalizeMeetingSource(request.body?.source);

      if (!meeting.sessionId) {
        throw createHttpError(400, "회의 세션 ID가 없어요.");
      }
      if (!source.captureMode) {
        throw createHttpError(400, "녹음 source captureMode가 없어요.");
      }
      if (!(source.sizeBytes > 0) || !(source.durationMs > 0)) {
        throw createHttpError(400, "녹음 source 길이나 크기가 올바르지 않아요.");
      }

      logEvent("meeting.create.stub", {
        providerUserKey: owner.providerUserKey,
        sessionId: meeting.sessionId,
        captureMode: source.captureMode,
      });
      throw createHttpError(501, "회의 전사 job worker는 아직 연결되지 않았어요. 현재는 gateway 계약만 준비된 상태예요.");
    } catch (error) {
      logEvent("meeting.create.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const getInovaMeetingJob = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const owner = await verifyRequestIdentity(request);
      const input = normalizeMeetingJobLookup(request.body);

      if (!input.jobId) {
        throw createHttpError(400, "회의 job ID가 없어요.");
      }

      logEvent("meeting.get-job.stub", {
        jobId: input.jobId,
        providerUserKey: owner.providerUserKey,
        sessionId: input.sessionId,
      });
      throw createHttpError(501, "회의 전사 job 조회 worker는 아직 연결되지 않았어요. 현재는 gateway 계약만 준비된 상태예요.");
    } catch (error) {
      logEvent("meeting.get-job.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const getInovaMeetingArtifact = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const owner = await verifyRequestIdentity(request);
      const input = normalizeMeetingArtifactLookup(request.body);

      if (!input.jobId || !input.artifactId) {
        throw createHttpError(400, "회의 artifact 조회에 필요한 ID가 비어 있어요.");
      }

      logEvent("meeting.get-artifact.stub", {
        artifactId: input.artifactId,
        jobId: input.jobId,
        providerUserKey: owner.providerUserKey,
      });
      throw createHttpError(501, "회의 전사 artifact 조회 worker는 아직 연결되지 않았어요. 현재는 gateway 계약만 준비된 상태예요.");
    } catch (error) {
      logEvent("meeting.get-artifact.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  return {
    createInovaMeetingJob,
    getInovaMeetingArtifact,
    getInovaMeetingJob,
  };

  function assertMethod(request) {
    if (request.method !== "POST") {
      throw createHttpError(405, "POST 요청만 지원해요.");
    }
  }

  async function verifyRequestIdentity(request) {
    const providerIdentity = normalizeIdentity(request.body?.providerIdentity || request.body?.owner);
    return verifyInovaIdentity(providerIdentity, request);
  }
}

function normalizeMeetingRequest(input) {
  return {
    endedAt: normalizeText(input?.endedAt),
    language: normalizeText(input?.language) || "ko",
    sessionId: normalizeText(input?.sessionId),
    startedAt: normalizeText(input?.startedAt),
    title: normalizeText(input?.title),
  };
}

function normalizeMeetingSource(input) {
  const captureMode = normalizeText(input?.captureMode);
  return {
    captureMode: ALLOWED_CAPTURE_MODES.has(captureMode) ? captureMode : "",
    channelCount: Math.max(0, Number(input?.channelCount) || 0),
    durationMs: Math.max(0, Number(input?.durationMs) || 0),
    mimeType: normalizeText(input?.mimeType),
    sizeBytes: Math.max(0, Number(input?.sizeBytes) || 0),
  };
}

function normalizeMeetingJobLookup(input) {
  return {
    jobId: normalizeText(input?.jobId),
    sessionId: normalizeText(input?.sessionId),
  };
}

function normalizeMeetingArtifactLookup(input) {
  return {
    artifactId: normalizeText(input?.artifactId),
    jobId: normalizeText(input?.jobId),
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

module.exports = {
  registerMeetingHandlers,
};
