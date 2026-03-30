const OpenAI = require("openai");

const ALLOWED_CAPTURE_MODES = new Set(["tab-audio", "microphone", "mixed-audio"]);
const DEFAULT_INLINE_AUDIO_LIMIT_BYTES = 20 * 1024 * 1024;
const DEFAULT_MODEL = "gpt-4o-transcribe-diarize";
const JOB_COLLECTION = "integration_inova_meeting_jobs";
const ARTIFACT_COLLECTION = "integration_inova_meeting_artifacts";
const SESSION_COLLECTION = "integration_inova_meeting_sessions";
const TEMP_UPLOAD_TTL_MS = 60 * 60 * 1000;
const MAX_SESSION_RECENT_RESULTS = 12;

function registerMeetingHandlers(deps) {
  const {
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
  } = deps;

  let client = null;

  const createInovaMeetingJob = onRequest({ cors: CORS_ORIGINS, region: REGION, timeoutSeconds: 180 }, async (request, response) => {
    try {
      assertMethod(request);
      const owner = await verifyRequestIdentity(request);
      const meeting = normalizeMeetingRequest(request.body?.meeting);
      const options = normalizeMeetingOptions(request.body?.options);
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

      const audioBuffer = await loadSourceAudioBuffer(source);
      if (!audioBuffer.length) {
        throw createHttpError(400, "회의 원본 오디오가 비어 있어요.");
      }
      if (audioBuffer.length > getInlineAudioLimitBytes()) {
        throw createHttpError(413, `현재 inline 업로드 경로는 ${Math.floor(getInlineAudioLimitBytes() / (1024 * 1024))}MB 이하 녹음만 지원해요.`);
      }

      const jobId = db.collection(JOB_COLLECTION).doc().id;
      const artifactId = db.collection(ARTIFACT_COLLECTION).doc().id;
      const createdAt = new Date().toISOString();
      const tempStorageObject = normalizeText(source.storageObject) || buildTempStorageObjectPath(owner.providerUserKey, meeting.sessionId, jobId, source.fileName);
      const expiresAt = new Date(Date.now() + TEMP_UPLOAD_TTL_MS).toISOString();
      const sourceSnapshot = {
        captureMode: source.captureMode,
        channelCount: source.channelCount,
        durationMs: source.durationMs,
        expiresAt,
        fileName: source.fileName,
        mimeType: source.mimeType,
        sizeBytes: source.sizeBytes,
        storageObject: tempStorageObject,
        uploadStatus: "uploaded",
      };
      const queuedJob = buildQueuedJob(jobId, meeting, owner, options, sourceSnapshot, createdAt);
      const sessionRef = db.collection(SESSION_COLLECTION).doc(buildSessionDocId(owner.providerUserKey, meeting.sessionId));
      const jobRef = db.collection(JOB_COLLECTION).doc(jobId);
      const artifactRef = db.collection(ARTIFACT_COLLECTION).doc(artifactId);

      await uploadTemporarySource(bucket, tempStorageObject, audioBuffer, sourceSnapshot, owner, meeting, jobId);
      await Promise.all([
        upsertSessionJobSummary(sessionRef, meeting, owner, queuedJob),
        jobRef.set(queuedJob),
      ]);

      const processingAt = new Date().toISOString();
      const processingPatch = {
        progress: {
          percent: 42,
          phase: "transcribing",
        },
        status: "processing",
        transcription: {
          language: meeting.language,
          speakerLabels: options.speakerLabels,
        },
        updatedAt: processingAt,
      };
      await Promise.all([
        jobRef.set(processingPatch, { merge: true }),
        upsertSessionJobSummary(
          sessionRef,
          meeting,
          owner,
          {
            ...queuedJob,
            ...processingPatch,
          }
        ),
      ]);

      try {
        const transcript = await transcribeMeetingAudio(audioBuffer, meeting, options, source);
        const completedAt = new Date().toISOString();
        const artifact = buildTranscriptArtifact(artifactId, jobId, meeting.sessionId, owner, transcript, completedAt);

        const deletedAt = await deleteTemporarySource(bucket, tempStorageObject);
        const succeededPatch = buildSucceededJobPatch(artifact, meeting, options, sourceSnapshot, transcript, completedAt, deletedAt);
        const succeededJob = {
          ...queuedJob,
          ...processingPatch,
          ...succeededPatch,
        };
        await Promise.all([
          artifactRef.set(artifact),
          jobRef.set(succeededPatch, { merge: true }),
          upsertSessionJobSummary(sessionRef, meeting, owner, succeededJob, artifact),
        ]);

        logEvent("meeting.create.success", {
          artifactId,
          captureMode: source.captureMode,
          jobId,
          providerUserKey: owner.providerUserKey,
          sessionId: meeting.sessionId,
          speakerCount: transcript.speakerCount,
        });
        response.json({
          ok: true,
          data: {
            job: queuedJob,
          },
        });
      } catch (error) {
        const deletedAt = await deleteTemporarySource(bucket, tempStorageObject);
        const failedPatch = {
          cleanup: {
            deletedAt,
            sourceAudioDeleted: Boolean(deletedAt),
          },
          error: normalizeText(error?.message) || "회의 전사를 처리하지 못했어요.",
          progress: {
            percent: 100,
            phase: "failed",
          },
          source: {
            ...sourceSnapshot,
            uploadStatus: deletedAt ? "deleted" : sourceSnapshot.uploadStatus,
          },
          status: "failed",
          updatedAt: new Date().toISOString(),
        };
        await Promise.all([
          jobRef.set(failedPatch, { merge: true }),
          upsertSessionJobSummary(
            sessionRef,
            meeting,
            owner,
            {
              ...queuedJob,
              ...processingPatch,
              ...failedPatch,
            }
          ),
        ]);
        throw error;
      }
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

      const snapshot = await db.collection(JOB_COLLECTION).doc(input.jobId).get();
      if (!snapshot.exists) {
        throw createHttpError(404, "회의 job을 찾지 못했어요.");
      }
      const job = normalizeMeetingJob(snapshot.data());
      assertJobOwnership(job, owner, createHttpError);
      if (input.sessionId && input.sessionId !== job.sessionId) {
        throw createHttpError(404, "현재 세션과 맞지 않는 회의 job이에요.");
      }

      logEvent("meeting.get-job.success", {
        jobId: job.jobId,
        providerUserKey: owner.providerUserKey,
        sessionId: job.sessionId,
        status: job.status,
      });
      response.json({
        ok: true,
        data: {
          job,
        },
      });
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

      const jobSnapshot = await db.collection(JOB_COLLECTION).doc(input.jobId).get();
      if (!jobSnapshot.exists) {
        throw createHttpError(404, "회의 job을 찾지 못했어요.");
      }
      const job = normalizeMeetingJob(jobSnapshot.data());
      assertJobOwnership(job, owner, createHttpError);

      const artifactSnapshot = await db.collection(ARTIFACT_COLLECTION).doc(input.artifactId).get();
      if (!artifactSnapshot.exists) {
        throw createHttpError(404, "회의 artifact를 찾지 못했어요.");
      }
      const artifact = normalizeMeetingArtifact(artifactSnapshot.data());
      if (artifact.jobId !== job.jobId) {
        throw createHttpError(404, "회의 job과 연결되지 않는 artifact예요.");
      }

      logEvent("meeting.get-artifact.success", {
        artifactId: artifact.artifactId,
        jobId: job.jobId,
        providerUserKey: owner.providerUserKey,
      });
      response.json({
        ok: true,
        data: {
          artifact,
        },
      });
    } catch (error) {
      logEvent("meeting.get-artifact.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const listInovaMeetingResults = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const owner = await verifyRequestIdentity(request);
      const input = normalizeMeetingListRequest(request.body);

      if (!input.sessionId) {
        throw createHttpError(400, "회의 세션 ID가 없어요.");
      }

      const sessionRef = db.collection(SESSION_COLLECTION).doc(buildSessionDocId(owner.providerUserKey, input.sessionId));
      const snapshot = await sessionRef.get();
      if (!snapshot.exists) {
        response.json({
          ok: true,
          data: {
            items: [],
            session: normalizeMeetingSession({
              owner,
              sessionId: input.sessionId,
            }),
          },
        });
        return;
      }

      const session = normalizeMeetingSession(snapshot.data());
      assertSessionOwnership(session, owner, createHttpError);
      let items = Array.isArray(session.recentJobs) ? session.recentJobs.slice(0, input.limit) : [];

      if (!items.length && session.lastJobId) {
        const jobSnapshot = await db.collection(JOB_COLLECTION).doc(session.lastJobId).get();
        if (jobSnapshot.exists) {
          const job = normalizeMeetingJob(jobSnapshot.data());
          assertJobOwnership(job, owner, createHttpError);
          items = [buildMeetingResultSummary(job)];
        }
      }

      logEvent("meeting.list-results.success", {
        itemCount: items.length,
        providerUserKey: owner.providerUserKey,
        sessionId: session.sessionId || input.sessionId,
      });
      response.json({
        ok: true,
        data: {
          items,
          session,
        },
      });
    } catch (error) {
      logEvent("meeting.list-results.error", {
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
    listInovaMeetingResults,
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

  async function loadSourceAudioBuffer(source) {
    if (source.inlineAudioBase64) {
      try {
        return Buffer.from(source.inlineAudioBase64, "base64");
      } catch {
        throw createHttpError(400, "회의 원본 오디오를 읽지 못했어요.");
      }
    }
    if (source.storageObject) {
      const [buffer] = await bucket.file(source.storageObject).download();
      return buffer;
    }
    throw createHttpError(400, "회의 원본 오디오가 없어요.");
  }

  async function uploadTemporarySource(targetBucket, storageObject, audioBuffer, source, owner, meeting, jobId) {
    if (!targetBucket || !storageObject) {
      return;
    }
    await targetBucket.file(storageObject).save(audioBuffer, {
      contentType: source.mimeType || "application/octet-stream",
      metadata: {
        metadata: {
          captureMode: source.captureMode,
          jobId,
          providerUserKey: owner.providerUserKey,
          sessionId: meeting.sessionId,
        },
      },
      resumable: false,
    });
  }

  async function deleteTemporarySource(targetBucket, storageObject) {
    if (!targetBucket || !storageObject) {
      return new Date().toISOString();
    }
    try {
      await targetBucket.file(storageObject).delete({ ignoreNotFound: true });
    } catch {}
    return new Date().toISOString();
  }

  function getClient() {
    if (client) {
      return client;
    }
    const openaiFactory = typeof deps.openaiFactory === "function"
      ? deps.openaiFactory
      : (options) => new OpenAI(options);
    const apiKey = normalizeText(process.env.OPENAI_API_KEY)
      || (typeof deps.openaiFactory === "function" ? "fixture-openai-key" : "");
    if (!apiKey) {
      throw createHttpError(412, "OPENAI_API_KEY가 설정되지 않았어요.");
    }
    client = openaiFactory({ apiKey });
    return client;
  }

  function getMeetingModel() {
    return normalizeText(process.env.OPENAI_MEETING_TRANSCRIBE_MODEL)
      || normalizeText(process.env.OPENAI_MEETING_MODEL)
      || DEFAULT_MODEL;
  }

  async function transcribeMeetingAudio(audioBuffer, meeting, options, source) {
    const file = await OpenAI.toFile(audioBuffer, source.fileName, {
      type: source.mimeType || "audio/webm",
    });
    const request = {
      file,
      language: meeting.language,
      model: getMeetingModel(),
      response_format: options.speakerLabels ? "diarized_json" : "json",
    };
    if (options.speakerLabels && source.durationMs > 30000) {
      request.chunking_strategy = "auto";
    }
    const response = await getClient().audio.transcriptions.create(request);
    return normalizeTranscriptionResponse(response, source.durationMs);
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

function normalizeMeetingOptions(input) {
  return {
    redaction: normalizeText(input?.redaction) || "none",
    speakerLabels: input?.speakerLabels !== false,
    summary: Boolean(input?.summary),
  };
}

function normalizeMeetingSource(input) {
  const captureMode = normalizeText(input?.captureMode);
  return {
    captureMode: ALLOWED_CAPTURE_MODES.has(captureMode) ? captureMode : "",
    channelCount: Math.max(0, Number(input?.channelCount) || 0),
    durationMs: Math.max(0, Number(input?.durationMs) || 0),
    fileName: normalizeText(input?.fileName) || buildDefaultFileName(input?.mimeType),
    inlineAudioBase64: normalizeText(input?.inlineAudioBase64),
    mimeType: normalizeText(input?.mimeType),
    sizeBytes: Math.max(0, Number(input?.sizeBytes) || 0),
    storageObject: normalizeText(input?.storageObject),
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

function normalizeMeetingListRequest(input) {
  return {
    limit: Math.max(1, Math.min(MAX_SESSION_RECENT_RESULTS, Number(input?.limit) || 8)),
    sessionId: normalizeText(input?.sessionId),
  };
}

function buildQueuedJob(jobId, meeting, owner, options, source, createdAt) {
  return {
    artifacts: [],
    createdAt,
    jobId,
    meeting,
    options,
    owner: owner ? { ...owner } : {},
    progress: {
      percent: 0,
      phase: "queued",
    },
    queuedAt: createdAt,
    sessionId: meeting.sessionId,
    source,
    status: "queued",
    transcription: {
      language: meeting.language,
      speakerLabels: options.speakerLabels,
    },
    updatedAt: createdAt,
  };
}

function buildSucceededJobPatch(artifact, meeting, options, source, transcript, completedAt, deletedAt) {
  return {
    artifacts: [
      {
        artifactId: artifact.artifactId,
        createdAt: artifact.createdAt,
        format: artifact.format,
        jobId: artifact.jobId,
        kind: artifact.kind,
      },
    ],
    cleanup: {
      deletedAt,
      sourceAudioDeleted: Boolean(deletedAt),
    },
    progress: {
      percent: 100,
      phase: "completed",
    },
    source: {
      ...source,
      uploadStatus: deletedAt ? "deleted" : source.uploadStatus,
    },
    status: "succeeded",
    transcript: {
      artifactId: artifact.artifactId,
      segments: artifact.segments,
      text: artifact.text,
    },
    transcription: {
      language: meeting.language,
      speakerCount: transcript.speakerCount,
      speakerLabels: options.speakerLabels,
    },
    updatedAt: completedAt,
  };
}

function buildTranscriptArtifact(artifactId, jobId, sessionId, owner, transcript, createdAt) {
  return {
    artifactId,
    createdAt,
    format: "diarized_json",
    jobId,
    kind: "transcript",
    owner: owner ? { ...owner } : {},
    segments: transcript.segments,
    sessionId,
    text: transcript.text,
  };
}

function buildSessionDocument(meeting, owner, jobId, updatedAt) {
  return {
    endedAt: meeting.endedAt,
    recentJobs: [],
    language: meeting.language,
    owner: owner ? { ...owner } : {},
    sessionId: meeting.sessionId,
    startedAt: meeting.startedAt,
    title: meeting.title,
    updatedAt,
    lastJobId: jobId,
  };
}

function buildSessionDocId(providerUserKey, sessionId) {
  return `${normalizeText(providerUserKey)}__${normalizeText(sessionId)}`;
}

function buildTempStorageObjectPath(providerUserKey, sessionId, jobId, fileName) {
  return [
    "tmp",
    "meetings",
    normalizeText(providerUserKey) || "unknown-user",
    normalizeText(sessionId) || "unknown-session",
    `${normalizeText(jobId) || "meeting-job"}-${normalizeText(fileName) || "audio.webm"}`,
  ].join("/");
}

function buildDefaultFileName(mimeType) {
  return `meeting-source.${resolveAudioExtension(mimeType)}`;
}

function resolveAudioExtension(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("ogg")) return "ogg";
  return "bin";
}

function normalizeTranscriptionResponse(response, fallbackDurationMs) {
  const inputSegments = Array.isArray(response?.segments) ? response.segments : [];
  const speakerIds = [];
  const speakerMap = new Map();
  const segments = inputSegments
    .map((segment) => {
      const text = normalizeText(segment?.text);
      if (!text) {
        return null;
      }
      const speakerId = normalizeText(segment?.speaker) || "speaker-0";
      if (!speakerMap.has(speakerId)) {
        speakerMap.set(speakerId, `SPEAKER_${String(speakerIds.length).padStart(2, "0")}`);
        speakerIds.push(speakerId);
      }
      const startMs = Math.max(0, Math.round(Number(segment?.start) * 1000));
      const endMs = Math.max(startMs + 1, Math.round(Number(segment?.end) * 1000));
      return {
        endMs,
        speakerLabel: speakerMap.get(speakerId),
        startMs,
        text,
      };
    })
    .filter(Boolean);

  if (!segments.length) {
    const text = normalizeText(response?.text);
    if (text) {
      segments.push({
        endMs: Math.max(1, Math.round(Number(response?.duration) * 1000) || Math.max(1, Number(fallbackDurationMs) || 1)),
        speakerLabel: "SPEAKER_00",
        startMs: 0,
        text,
      });
    }
  }

  const transcriptText = segments.length
    ? segments.map((segment) => `${segment.speakerLabel}: ${segment.text}`).join(" ")
    : normalizeText(response?.text);

  return {
    segments,
    speakerCount: Math.max(segments.length ? new Set(segments.map((segment) => segment.speakerLabel)).size : 0, 0),
    text: transcriptText,
  };
}

function normalizeMeetingJob(input) {
  const job = input && typeof input === "object" ? input : {};
  return {
    artifacts: Array.isArray(job.artifacts) ? job.artifacts.map(normalizeArtifactSummary) : [],
    cleanup: {
      deletedAt: normalizeText(job.cleanup?.deletedAt),
      sourceAudioDeleted: Boolean(job.cleanup?.sourceAudioDeleted),
    },
    createdAt: normalizeText(job.createdAt),
    error: normalizeText(job.error),
    jobId: normalizeText(job.jobId),
    meeting: {
      endedAt: normalizeText(job.meeting?.endedAt),
      language: normalizeText(job.meeting?.language),
      startedAt: normalizeText(job.meeting?.startedAt),
      title: normalizeText(job.meeting?.title),
    },
    options: {
      redaction: normalizeText(job.options?.redaction),
      speakerLabels: Boolean(job.options?.speakerLabels),
      summary: Boolean(job.options?.summary),
    },
    owner: job.owner && typeof job.owner === "object" ? { ...job.owner } : {},
    progress: {
      percent: Math.max(0, Math.min(100, Number(job.progress?.percent) || 0)),
      phase: normalizeText(job.progress?.phase),
    },
    queuedAt: normalizeText(job.queuedAt),
    sessionId: normalizeText(job.sessionId),
    source: {
      captureMode: normalizeText(job.source?.captureMode),
      channelCount: Math.max(0, Number(job.source?.channelCount) || 0),
      durationMs: Math.max(0, Number(job.source?.durationMs) || 0),
      expiresAt: normalizeText(job.source?.expiresAt),
      fileName: normalizeText(job.source?.fileName),
      mimeType: normalizeText(job.source?.mimeType),
      sizeBytes: Math.max(0, Number(job.source?.sizeBytes) || 0),
      storageObject: normalizeText(job.source?.storageObject),
      uploadStatus: normalizeText(job.source?.uploadStatus),
    },
    status: normalizeText(job.status),
    transcript: {
      artifactId: normalizeText(job.transcript?.artifactId),
      segments: Array.isArray(job.transcript?.segments) ? job.transcript.segments.map(normalizeTranscriptSegment) : [],
      text: normalizeText(job.transcript?.text),
    },
    transcription: {
      language: normalizeText(job.transcription?.language),
      speakerCount: Math.max(0, Number(job.transcription?.speakerCount) || 0),
      speakerLabels: Boolean(job.transcription?.speakerLabels),
    },
    updatedAt: normalizeText(job.updatedAt),
  };
}

function normalizeMeetingArtifact(input) {
  const artifact = input && typeof input === "object" ? input : {};
  return {
    artifactId: normalizeText(artifact.artifactId),
    createdAt: normalizeText(artifact.createdAt),
    format: normalizeText(artifact.format),
    jobId: normalizeText(artifact.jobId),
    kind: normalizeText(artifact.kind),
    segments: Array.isArray(artifact.segments) ? artifact.segments.map(normalizeTranscriptSegment) : [],
    sessionId: normalizeText(artifact.sessionId),
    text: normalizeText(artifact.text),
  };
}

function normalizeArtifactSummary(input) {
  const artifact = input && typeof input === "object" ? input : {};
  return {
    artifactId: normalizeText(artifact.artifactId),
    createdAt: normalizeText(artifact.createdAt),
    format: normalizeText(artifact.format),
    jobId: normalizeText(artifact.jobId),
    kind: normalizeText(artifact.kind),
  };
}

function normalizeMeetingSession(input) {
  const session = input && typeof input === "object" ? input : {};
  return {
    endedAt: normalizeText(session.endedAt),
    language: normalizeText(session.language) || "ko",
    lastJobId: normalizeText(session.lastJobId),
    owner: session.owner && typeof session.owner === "object" ? { ...session.owner } : {},
    recentJobs: Array.isArray(session.recentJobs) ? session.recentJobs.map(normalizeMeetingResultSummary) : [],
    sessionId: normalizeText(session.sessionId),
    startedAt: normalizeText(session.startedAt),
    title: normalizeText(session.title),
    updatedAt: normalizeText(session.updatedAt),
  };
}

function normalizeMeetingResultSummary(input) {
  const item = input && typeof input === "object" ? input : {};
  return {
    artifactId: normalizeText(item.artifactId),
    captureMode: normalizeText(item.captureMode),
    createdAt: normalizeText(item.createdAt),
    durationMs: Math.max(0, Number(item.durationMs) || 0),
    error: normalizeText(item.error),
    excerpt: normalizeText(item.excerpt),
    jobId: normalizeText(item.jobId),
    sessionId: normalizeText(item.sessionId),
    speakerCount: Math.max(0, Number(item.speakerCount) || 0),
    status: normalizeText(item.status),
    title: normalizeText(item.title),
    transcriptAvailable: Boolean(item.transcriptAvailable),
    updatedAt: normalizeText(item.updatedAt),
  };
}

function buildMeetingResultSummary(jobInput, artifactInput) {
  const job = normalizeMeetingJob(jobInput);
  const artifact = artifactInput ? normalizeMeetingArtifact(artifactInput) : null;
  const transcriptText = normalizeText(artifact?.text || job.transcript?.text);
  return normalizeMeetingResultSummary({
    artifactId: normalizeText(artifact?.artifactId || job.transcript?.artifactId || job.artifacts?.[0]?.artifactId),
    captureMode: job.source.captureMode,
    createdAt: job.createdAt || job.queuedAt,
    durationMs: job.source.durationMs,
    error: job.error,
    excerpt: buildTranscriptExcerpt(transcriptText),
    jobId: job.jobId,
    sessionId: job.sessionId,
    speakerCount: Math.max(0, Number(artifact ? countTranscriptSpeakers(artifact.segments) : job.transcription.speakerCount) || 0),
    status: job.status,
    title: job.meeting.title,
    transcriptAvailable: Boolean(transcriptText || normalizeText(artifact?.artifactId || job.transcript?.artifactId)),
    updatedAt: job.updatedAt || job.createdAt || job.queuedAt,
  });
}

function mergeRecentJobs(currentItems, nextItem) {
  const map = new Map();
  for (const item of Array.isArray(currentItems) ? currentItems : []) {
    const normalized = normalizeMeetingResultSummary(item);
    if (normalized.jobId) {
      map.set(normalized.jobId, normalized);
    }
  }
  const normalizedNext = normalizeMeetingResultSummary(nextItem);
  if (normalizedNext.jobId) {
    map.set(normalizedNext.jobId, normalizedNext);
  }
  return Array.from(map.values())
    .sort(compareMeetingResults)
    .slice(0, MAX_SESSION_RECENT_RESULTS);
}

function compareMeetingResults(left, right) {
  return toTimestamp(right.updatedAt || right.createdAt) - toTimestamp(left.updatedAt || left.createdAt);
}

function toTimestamp(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return 0;
  }
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildTranscriptExcerpt(text) {
  const normalized = normalizeText(text).replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
}

function countTranscriptSpeakers(segments) {
  return new Set(
    (Array.isArray(segments) ? segments : [])
      .map((segment) => normalizeText(segment?.speakerLabel))
      .filter(Boolean)
  ).size;
}

async function upsertSessionJobSummary(sessionRef, meeting, owner, jobInput, artifactInput) {
  const snapshot = await sessionRef.get();
  const currentSession = snapshot.exists ? normalizeMeetingSession(snapshot.data()) : normalizeMeetingSession({
    owner,
    sessionId: meeting.sessionId,
  });
  const job = normalizeMeetingJob(jobInput);
  const recentJobs = mergeRecentJobs(currentSession.recentJobs, buildMeetingResultSummary(job, artifactInput));
  await sessionRef.set(
    {
      ...buildSessionDocument(
        meeting,
        owner,
        job.jobId || currentSession.lastJobId,
        job.updatedAt || new Date().toISOString()
      ),
      recentJobs,
    },
    { merge: true }
  );
}

function normalizeTranscriptSegment(input) {
  const segment = input && typeof input === "object" ? input : {};
  const startMs = Math.max(0, Number(segment.startMs) || 0);
  const endMs = Math.max(startMs + 1, Number(segment.endMs) || startMs + 1);
  return {
    endMs,
    speakerLabel: normalizeText(segment.speakerLabel),
    startMs,
    text: normalizeText(segment.text),
  };
}

function assertJobOwnership(job, owner, createHttpError) {
  if (normalizeText(job.owner?.providerUserKey) !== normalizeText(owner?.providerUserKey)) {
    throw createHttpError(403, "현재 사용자에게 허용되지 않은 회의 job이에요.");
  }
}

function assertSessionOwnership(session, owner, createHttpError) {
  if (normalizeText(session.owner?.providerUserKey) !== normalizeText(owner?.providerUserKey)) {
    throw createHttpError(403, "현재 사용자에게 허용되지 않은 회의 세션이에요.");
  }
}

function getInlineAudioLimitBytes() {
  return Math.max(1024, Number(process.env.OPENAI_MEETING_INLINE_AUDIO_LIMIT_BYTES) || DEFAULT_INLINE_AUDIO_LIMIT_BYTES);
}

function normalizeText(value) {
  return String(value || "").trim();
}

module.exports = {
  registerMeetingHandlers,
};
