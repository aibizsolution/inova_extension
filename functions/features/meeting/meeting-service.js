const crypto = require("crypto");
const OpenAI = require("openai");

const ALLOWED_CAPTURE_MODES = new Set(["tab-audio", "microphone", "mixed-audio"]);
const DEFAULT_INLINE_AUDIO_LIMIT_BYTES = 25 * 1024 * 1024;
const DEFAULT_SOURCE_TARGET_PART_BYTES = 20 * 1024 * 1024;
const DEFAULT_SOURCE_MAX_BYTES = 200 * 1024 * 1024;
const DEFAULT_SOURCE_MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const DEFAULT_SOURCE_PART_OVERLAP_MS = 1500;
const DEFAULT_IN_PROCESS_CHUNK_TRANSCRIPTION_CONCURRENCY = 2;
const DEFAULT_IN_PROCESS_CHUNK_TRANSCRIPTION_MAX_CONCURRENCY = 5;
const DEFAULT_MEETING_PROCESS_RETRY_LIMIT = 2;
const DEFAULT_MODEL = "gpt-4o-transcribe-diarize";
const DEFAULT_SUMMARY_MODEL = "gpt-5.4-mini";
const DEFAULT_SPEAKER_RECONCILE_MODEL = "gpt-5.4-mini";
const JOB_COLLECTION = "integration_inova_meeting_jobs";
const JOB_FINALIZER_COLLECTION = "integration_inova_meeting_job_finalizers";
const JOB_PART_COLLECTION = "integration_inova_meeting_job_parts";
const ARTIFACT_COLLECTION = "integration_inova_meeting_artifacts";
const MEETING_COLLECTION = "integration_inova_meetings";
const SESSION_COLLECTION = "integration_inova_meeting_sessions";
const TEMP_UPLOAD_TTL_MS = 60 * 60 * 1000;
const MAX_MEETING_RECENT_RESULTS = 12;
const MAX_MEETING_LIST_LIMIT = 24;
const MAX_SUMMARY_TRANSCRIPT_CHARS = 12000;
const MAX_SHARED_MEMO_CHARS = 12000;
const MAX_SPEAKER_ALIAS_LENGTH = 80;
const NOTES_SCHEMA_VERSION = 2;
const DEFAULT_NOTES_MODE = "general";
const DEFAULT_NOTES_STYLE = "default";
const RETRYABLE_MEETING_PROCESS_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const SUPPORTED_NOTES_MODES = new Set(["general", "interview", "review", "planning"]);
const SUPPORTED_NOTES_STYLES = new Set(["default", "brief", "action"]);
const SUPPORTED_NOTES_STATUSES = new Set(["pending", "disabled", "skipped", "degraded", "succeeded"]);

function registerMeetingHandlers(deps) {
  const {
    authorizeMeetingRequest,
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

  const createInovaMeetingJob = onRequest({ cors: CORS_ORIGINS, region: REGION, timeoutSeconds: 540 }, async (request, response) => {
    let cleanupStorageObjects = [];
    let jobQueued = false;
    try {
      assertMethod(request);
      const meeting = normalizeMeetingRequest(request.body?.meeting);
      const options = normalizeMeetingOptions(request.body?.options);
      const source = normalizeMeetingSource(request.body?.source);
      const context = normalizeMeetingContext(request.body?.context);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;

      if (!meeting.meetingId) {
        throw createHttpError(400, "회의 ID가 없어요.");
      }
      assertWorkspaceMeetingAccess(access, meeting.meetingId, createHttpError);
      if (!meeting.title) {
        throw createHttpError(400, "회의 제목이 없어요.");
      }
      if (!source.captureMode) {
        throw createHttpError(400, "녹음 source captureMode가 없어요.");
      }
      if (!(source.sizeBytes > 0) || !(source.durationMs > 0)) {
        throw createHttpError(400, "녹음 source 길이나 크기가 올바르지 않아요.");
      }
      assertMeetingSourceWithinSupportedLimits(source, createHttpError);

      const requestId = normalizeText(source.requestId);
      const jobId = requestId
        ? buildStableMeetingEntityId("meeting-job", owner.providerUserKey, meeting.meetingId, requestId)
        : db.collection(JOB_COLLECTION).doc().id;
      const createdAt = new Date().toISOString();
      const jobRef = db.collection(JOB_COLLECTION).doc(jobId);
      const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, meeting.meetingId));
      const sessionRef = meeting.sessionId
        ? db.collection(SESSION_COLLECTION).doc(buildSessionDocId(owner.providerUserKey, meeting.sessionId))
        : null;
      if (requestId) {
        const existingSnapshot = await jobRef.get();
        if (existingSnapshot.exists) {
          const existingJob = normalizeMeetingJob(existingSnapshot.data());
          if (!existingJob.deletedAt && normalizeText(existingJob.status) !== "failed") {
            assertJobOwnership(existingJob, owner, createHttpError);
            await assertMeetingIsActive(owner, existingJob.meetingId || meeting.meetingId, createHttpError);
            const sourcePreparation = await ensureQueuedMeetingSourceReady(source, owner, meeting, jobId, createHttpError);
            const mergedSource = mergeQueuedMeetingSource(existingJob.source, sourcePreparation.source);
            let nextJob = existingJob;
            if (hasMeaningfulMeetingSourceUpdate(existingJob.source, mergedSource)) {
              nextJob = await persistMeetingJobPatch(
                jobRef,
                meetingRef,
                sessionRef,
                meeting,
                owner,
                existingJob,
                {
                  source: mergedSource,
                  updatedAt: new Date().toISOString(),
                }
              );
              if (mergedSource.mode === "chunked" && normalizeText(nextJob.status) === "processing") {
                await upsertQueuedMeetingJobParts(nextJob);
                const synchronized = await synchronizeChunkedMeetingJobProgress(
                  jobRef,
                  meetingRef,
                  sessionRef,
                  meeting,
                  owner,
                  nextJob,
                  options
                );
                nextJob = synchronized.currentJob;
                if (synchronized.isFullyTranscribed) {
                  await maybeQueueMeetingJobFinalizer(nextJob);
                }
              }
            }
            logEvent("meeting.create.deduped", {
              jobId: nextJob.jobId,
              meetingId: nextJob.meetingId || meeting.meetingId,
              providerUserKey: owner.providerUserKey,
              requestId,
            });
            response.json({
              ok: true,
              data: {
                job: nextJob,
                reused: true,
              },
            });
            return;
          }
        }
      }

      const sourcePreparation = await ensureQueuedMeetingSourceReady(source, owner, meeting, jobId, createHttpError);
      const sourceSnapshot = sourcePreparation.source;
      cleanupStorageObjects = sourcePreparation.cleanupStorageObjects;
      const effectiveMeeting = {
        ...meeting,
        sharedMemo: context.sharedMemoSnapshot,
      };
      const queuedJob = buildQueuedJob(jobId, effectiveMeeting, owner, options, sourceSnapshot, context, createdAt);
      await Promise.all([
        upsertMeetingJobSummary(meetingRef, effectiveMeeting, owner, queuedJob),
        sessionRef ? upsertLegacySessionJobSummary(sessionRef, effectiveMeeting, owner, queuedJob) : Promise.resolve(),
        jobRef.set(queuedJob),
      ]);
      jobQueued = true;

      logEvent("meeting.create.queued", {
        captureMode: source.captureMode,
        chunked: sourceSnapshot.mode === "chunked",
        jobId,
        meetingId: meeting.meetingId,
        partCount: Array.isArray(sourceSnapshot.parts) ? sourceSnapshot.parts.length : 0,
        providerUserKey: owner.providerUserKey,
      });
      response.json({
        ok: true,
        data: {
          job: queuedJob,
          reused: false,
        },
      });
    } catch (error) {
      if (!jobQueued) {
        await deleteTemporarySourceGroup(bucket, cleanupStorageObjects);
      }
      logEvent("meeting.create.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const uploadInovaMeetingSource = onRequest({
    concurrency: 1,
    cors: CORS_ORIGINS,
    memory: "1GiB",
    region: REGION,
    timeoutSeconds: 120,
  }, async (request, response) => {
    try {
      assertMethod(request);
      const input = normalizeMeetingSourceUploadRequest(request);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;

      if (!input.meetingId) {
        throw createHttpError(400, "회의 ID가 없어요.");
      }
      if (!input.requestId) {
        throw createHttpError(400, "업로드 requestId가 없어요.");
      }
      if (!input.captureMode) {
        throw createHttpError(400, "업로드 source captureMode가 없어요.");
      }
      if (!(input.sizeBytes > 0) || !(input.durationMs > 0)) {
        throw createHttpError(400, "업로드 source 길이나 크기가 올바르지 않아요.");
      }

      assertWorkspaceMeetingAccess(access, input.meetingId, createHttpError);
      await assertMeetingIsActive(owner, input.meetingId, createHttpError);
      if (!bucket) {
        throw createHttpError(500, "회의 임시 오디오를 저장할 bucket이 설정되지 않았어요.");
      }

      const audioBuffer = Buffer.isBuffer(request.rawBody)
        ? request.rawBody
        : Buffer.from(request.rawBody || []);
      if (!audioBuffer.length) {
        throw createHttpError(400, "업로드한 오디오가 비어 있어요.");
      }

      const parentRequestId = normalizeText(input.parentRequestId || input.requestId);
      const jobId = buildStableMeetingEntityId("meeting-job", owner.providerUserKey, input.meetingId, parentRequestId);
      const storageObject = buildTempStorageObjectPath(
        owner.providerUserKey,
        input.meetingId,
        jobId,
        input.partCount > 0
          ? `part-${String(input.partIndex).padStart(4, "0")}-${input.fileName}`
          : input.fileName
      );
      const uploaded = await uploadTemporarySource(
        bucket,
        storageObject,
        audioBuffer,
        input,
        owner,
        { meetingId: input.meetingId },
        jobId
      );
      if (!normalizeText(uploaded?.storageObject)) {
        throw createHttpError(500, "임시 오디오 업로드를 준비하지 못했어요.");
      }
      const syncedJob = await persistUploadedMeetingSourceToExistingJob(
        jobId,
        owner,
        input,
        normalizeText(uploaded?.storageObject)
      );

      logEvent("meeting.source-upload.success", {
        bytes: audioBuffer.length,
        jobId,
        meetingId: input.meetingId,
        partCount: input.partCount,
        partIndex: input.partIndex,
        providerUserKey: owner.providerUserKey,
        requestId: input.requestId,
        syncedJobSource: Boolean(syncedJob),
        storageObject: normalizeText(uploaded?.storageObject),
      });
      response.json({
        ok: true,
        data: {
          endMs: input.endMs,
          jobId,
          overlapMs: input.overlapMs,
          parentRequestId,
          partCount: input.partCount,
          partIndex: input.partIndex,
          requestId: input.requestId,
          sizeBytes: audioBuffer.length,
          startMs: input.startMs,
          storageObject: normalizeText(uploaded?.storageObject),
          uploadStatus: normalizeText(uploaded?.uploadStatus) || "uploaded",
          uploadedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      logEvent("meeting.source-upload.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const processQueuedMeetingJobWrite = async (event) => {
    const beforeSnapshot = event?.data?.before || null;
    const afterSnapshot = event?.data?.after || null;
    if (!afterSnapshot?.exists) {
      return;
    }
    const previousJob = beforeSnapshot?.exists ? normalizeMeetingJob(beforeSnapshot.data()) : null;
    const queuedJob = normalizeMeetingJob(afterSnapshot.data());
    if (!queuedJob.jobId || queuedJob.deletedAt) {
      return;
    }
    if (normalizeText(queuedJob.status) !== "queued" || normalizeText(previousJob?.status) === "queued") {
      return;
    }

    const owner = queuedJob.owner && typeof queuedJob.owner === "object" ? { ...queuedJob.owner } : {};
    const meeting = normalizeMeetingRequest(queuedJob.meeting);
    const options = normalizeMeetingOptions(queuedJob.options);
    const context = normalizeMeetingContext(queuedJob.context);
    const source = normalizeMeetingSource(queuedJob.source);
    const artifactId = getMeetingArtifactId(queuedJob.jobId, owner.providerUserKey, meeting.meetingId, source.requestId, db);
    const artifactRef = db.collection(ARTIFACT_COLLECTION).doc(artifactId);
    const jobRef = db.collection(JOB_COLLECTION).doc(queuedJob.jobId);
    const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, meeting.meetingId));
    const sessionRef = meeting.sessionId
      ? db.collection(SESSION_COLLECTION).doc(buildSessionDocId(owner.providerUserKey, meeting.sessionId))
      : null;
    let currentJob = queuedJob;

    const persistPatch = async (patch, artifact) => {
      currentJob = mergeMeetingJobPatch(currentJob, patch);
      await Promise.all([
        jobRef.set(patch, { merge: true }),
        upsertMeetingJobSummary(meetingRef, meeting, owner, currentJob, artifact),
        sessionRef ? upsertLegacySessionJobSummary(sessionRef, meeting, owner, currentJob, artifact) : Promise.resolve(),
      ]);
    };

    try {
      await persistPatch({
        progress: {
          currentPart: source.mode === "chunked" ? 0 : 1,
          parallelParts: 0,
          percent: 8,
          phase: source.mode === "chunked" ? "transcribing_chunks" : "transcribing",
          totalParts: source.mode === "chunked" ? Math.max(0, Array.isArray(source.parts) ? source.parts.length : 0) : 1,
        },
        status: "processing",
        transcription: {
          language: meeting.language,
          speakerLabels: options.speakerLabels,
        },
        updatedAt: new Date().toISOString(),
      });

      if (source.mode === "chunked" && Array.isArray(source.parts) && source.parts.length) {
        const refreshedJobSnapshot = await jobRef.get();
        if (refreshedJobSnapshot.exists) {
          currentJob = normalizeMeetingJob(refreshedJobSnapshot.data());
        }
        const partDocs = await upsertQueuedMeetingJobParts(currentJob);
        const synchronized = await synchronizeChunkedMeetingJobProgress(
          jobRef,
          meetingRef,
          sessionRef,
          meeting,
          owner,
          currentJob,
          options,
          {
            progress: {
              phase: "transcribing_chunks",
            },
          }
        );
        currentJob = synchronized.currentJob;
        if (synchronized.isFullyTranscribed) {
          await maybeQueueMeetingJobFinalizer(currentJob);
        }
        logEvent("meeting.process.chunk-dispatched", {
          jobId: queuedJob.jobId,
          meetingId: meeting.meetingId,
          parallelParts: getMeetingChunkWorkerQueueConcurrency(partDocs.length),
          partCount: partDocs.length,
          providerUserKey: owner.providerUserKey,
        });
        return;
      }

      const transcript = await transcribeQueuedMeetingSource(
        source,
        meeting,
        options,
        owner,
        queuedJob.jobId,
        async (progressPatch) => persistPatch(progressPatch)
      );
      await persistPatch({
        progress: {
          percent: 86,
          phase: "generating_notes",
        },
        updatedAt: new Date().toISOString(),
      });
      const meetingNotes = await maybeGenerateMeetingNotes(transcript, meeting, options, context, logEvent, owner, queuedJob.jobId);
      const completedAt = new Date().toISOString();
      const artifact = buildTranscriptArtifact(artifactId, queuedJob.jobId, meeting, owner, transcript, meetingNotes, completedAt);
      const deletion = await deleteTemporarySourceGroup(bucket, collectMeetingSourceStorageObjects(source));
      const succeededPatch = buildSucceededJobPatch(
        artifact,
        meeting,
        options,
        markMeetingSourceDeleted(source, deletion.deletedStorageObjects),
        context,
        transcript,
        meetingNotes,
        completedAt,
        deletion.deletedAt,
        currentJob.retry
      );
      const storedJob = await loadStoredMeetingJob(jobRef);
      if (!storedJob?.jobId || storedJob.deletedAt) {
        return;
      }
      currentJob = mergeMeetingJobPatch(storedJob, succeededPatch);
      await Promise.all([
        artifactRef.set(artifact),
        jobRef.set(succeededPatch, { merge: true }),
        upsertMeetingJobSummary(meetingRef, meeting, owner, currentJob, artifact),
        sessionRef ? upsertLegacySessionJobSummary(sessionRef, meeting, owner, currentJob, artifact) : Promise.resolve(),
      ]);

      logEvent("meeting.process.success", {
        artifactId,
        chunked: source.mode === "chunked",
        jobId: queuedJob.jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
        speakerCount: transcript.speakerCount,
      });
    } catch (error) {
      const errorMessage = formatMeetingProcessErrorMessage(error);
      const nextRetryCount = Math.max(0, Number(currentJob.retry?.count) || 0) + 1;
      const retryLimit = getMeetingProcessRetryLimit();
      if (isRetryableMeetingProcessError(error) && nextRetryCount <= retryLimit) {
        const retriedAt = new Date().toISOString();
        await persistPatch({
          error: "",
          progress: {
            currentPart: 0,
            parallelParts: 0,
            percent: 0,
            phase: "queued",
            totalParts: source.mode === "chunked" ? Math.max(0, Array.isArray(source.parts) ? source.parts.length : 0) : 1,
          },
          queuedAt: retriedAt,
          retry: {
            count: nextRetryCount,
            lastError: errorMessage,
            lastRetriedAt: retriedAt,
          },
          status: "queued",
          updatedAt: retriedAt,
        });
        logEvent("meeting.process.retry.queued", {
          error: normalizeText(error?.message),
          jobId: queuedJob.jobId,
          meetingId: meeting.meetingId,
          providerUserKey: owner.providerUserKey,
          retryCount: nextRetryCount,
          retryLimit,
        });
        return;
      }
      const deletion = await deleteTemporarySourceGroup(bucket, collectMeetingSourceStorageObjects(source));
      const failedPatch = {
        cleanup: {
          deletedAt: deletion.deletedAt,
          sourceAudioDeleted: Boolean(deletion.deletedAt),
        },
        error: errorMessage,
        progress: {
          parallelParts: 0,
          percent: 100,
          phase: "failed",
        },
        retry: {
          count: Math.max(0, Number(currentJob.retry?.count) || 0),
          lastError: errorMessage,
          lastRetriedAt: normalizeText(currentJob.retry?.lastRetriedAt),
        },
        source: markMeetingSourceDeleted(source, deletion.deletedStorageObjects),
        status: "failed",
        updatedAt: new Date().toISOString(),
      };
      await persistPatch(failedPatch);
      logEvent("meeting.process.error", {
        error: normalizeText(error?.message),
        jobId: queuedJob.jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });
    }
  };

  const processQueuedMeetingJobPartWrite = async (event) => {
    const beforeSnapshot = event?.data?.before || null;
    const afterSnapshot = event?.data?.after || null;
    if (!afterSnapshot?.exists) {
      return;
    }
    const previousPart = beforeSnapshot?.exists ? normalizeMeetingJobPart(beforeSnapshot.data()) : null;
    const queuedPart = normalizeMeetingJobPart(afterSnapshot.data());
    if (!queuedPart.jobId || normalizeText(queuedPart.status) !== "queued" || normalizeText(previousPart?.status) === "queued") {
      return;
    }

    const jobRef = db.collection(JOB_COLLECTION).doc(queuedPart.jobId);
    const partRef = db.collection(JOB_PART_COLLECTION).doc(afterSnapshot.id);
    const jobSnapshot = await jobRef.get();
    if (!jobSnapshot.exists) {
      await partRef.set({
        error: "상위 회의 job을 찾지 못했어요.",
        status: "failed",
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return;
    }

    let currentJob = normalizeMeetingJob(jobSnapshot.data());
    if (!currentJob.jobId || currentJob.deletedAt) {
      return;
    }
    const owner = currentJob.owner && typeof currentJob.owner === "object" ? { ...currentJob.owner } : {};
    const meeting = normalizeMeetingRequest(currentJob.meeting);
    const options = normalizeMeetingOptions(currentJob.options);
    const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, meeting.meetingId));
    const sessionRef = meeting.sessionId
      ? db.collection(SESSION_COLLECTION).doc(buildSessionDocId(owner.providerUserKey, meeting.sessionId))
      : null;

    const persistJobPatch = async (patch, artifact) => {
      currentJob = await persistMeetingJobPatch(
        jobRef,
        meetingRef,
        sessionRef,
        meeting,
        owner,
        currentJob,
        patch,
        artifact
      );
      return currentJob;
    };

    try {
      const startedAt = new Date().toISOString();
      await partRef.set({
        error: "",
        status: "processing",
        updatedAt: startedAt,
      }, { merge: true });
      const synchronizedStart = await synchronizeChunkedMeetingJobProgress(
        jobRef,
        meetingRef,
        sessionRef,
        meeting,
        owner,
        currentJob,
        options
      );
      currentJob = synchronizedStart.currentJob;

      const audioBuffer = await loadMeetingSourcePartAudioBuffer(queuedPart.part);
      const transcript = await transcribeMeetingAudio(
        audioBuffer,
        meeting,
        options,
        {
          captureMode: currentJob.source.captureMode,
          durationMs: Math.max(1, queuedPart.part.endMs - queuedPart.part.startMs),
          fileName: buildMeetingPartFileName(currentJob.source.fileName, queuedPart.index),
          mimeType: queuedPart.part.mimeType || currentJob.source.mimeType,
          storageObject: queuedPart.part.storageObject,
        }
      );
      const transcriptStorageObject = buildChunkTranscriptStorageObjectPath(
        owner.providerUserKey,
        meeting.meetingId,
        queuedPart.jobId,
        queuedPart.index
      );
      const transcriptMeta = await saveMeetingChunkTranscript(
        bucket,
        transcriptStorageObject,
        transcript,
        owner,
        meeting,
        queuedPart.jobId,
        queuedPart.index
      );
      const completedAt = new Date().toISOString();
      await partRef.set({
        error: "",
        status: "succeeded",
        transcript: transcriptMeta,
        updatedAt: completedAt,
      }, { merge: true });
      const synchronized = await synchronizeChunkedMeetingJobProgress(
        jobRef,
        meetingRef,
        sessionRef,
        meeting,
        owner,
        currentJob,
        options
      );
      currentJob = synchronized.currentJob;
      if (!synchronized.isFullyTranscribed) {
        await promoteWaitingMeetingJobParts(currentJob, synchronized.partDocs);
      }
      if (synchronized.isFullyTranscribed) {
        await maybeQueueMeetingJobFinalizer(currentJob);
      }
      logEvent("meeting.process.part.success", {
        jobId: queuedPart.jobId,
        meetingId: meeting.meetingId,
        partIndex: queuedPart.index,
        providerUserKey: owner.providerUserKey,
      });
    } catch (error) {
      const errorMessage = formatMeetingProcessErrorMessage(error);
      const nextRetryCount = Math.max(0, Number(queuedPart.retry?.count) || 0) + 1;
      const retryLimit = getMeetingProcessRetryLimit();
      if (isRetryableMeetingProcessError(error) && nextRetryCount <= retryLimit) {
        const retriedAt = new Date().toISOString();
        await partRef.set({
          error: "",
          queuedAt: retriedAt,
          retry: {
            count: nextRetryCount,
            lastError: errorMessage,
            lastRetriedAt: retriedAt,
          },
          status: "queued",
          updatedAt: retriedAt,
        }, { merge: true });
        const synchronized = await synchronizeChunkedMeetingJobProgress(
          jobRef,
          meetingRef,
          sessionRef,
          meeting,
          owner,
          currentJob,
          options
        );
        currentJob = synchronized.currentJob;
        logEvent("meeting.process.part.retry.queued", {
          error: normalizeText(error?.message),
          jobId: queuedPart.jobId,
          meetingId: meeting.meetingId,
          partIndex: queuedPart.index,
          providerUserKey: owner.providerUserKey,
          retryCount: nextRetryCount,
          retryLimit,
        });
        return;
      }

      await partRef.set({
        error: errorMessage,
        retry: {
          count: Math.max(0, Number(queuedPart.retry?.count) || 0),
          lastError: errorMessage,
          lastRetriedAt: normalizeText(queuedPart.retry?.lastRetriedAt),
        },
        status: "failed",
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      const synchronized = await synchronizeChunkedMeetingJobProgress(
        jobRef,
        meetingRef,
        sessionRef,
        meeting,
        owner,
        currentJob,
        options,
        {
          error: errorMessage,
          progress: {
            parallelParts: 0,
            percent: 100,
            phase: "failed",
          },
          retry: {
            count: Math.max(0, Number(currentJob.retry?.count) || 0),
            lastError: errorMessage,
            lastRetriedAt: normalizeText(currentJob.retry?.lastRetriedAt),
          },
          status: "failed",
        }
      );
      currentJob = synchronized.currentJob;
      logEvent("meeting.process.part.error", {
        error: normalizeText(error?.message),
        jobId: queuedPart.jobId,
        meetingId: meeting.meetingId,
        partIndex: queuedPart.index,
        providerUserKey: owner.providerUserKey,
      });
    }
  };

  const finalizeChunkedMeetingJobWrite = async (event) => {
    const beforeSnapshot = event?.data?.before || null;
    const afterSnapshot = event?.data?.after || null;
    if (!afterSnapshot?.exists) {
      return;
    }
    const previousFinalizer = beforeSnapshot?.exists ? normalizeMeetingJobFinalizer(beforeSnapshot.data()) : null;
    const queuedFinalizer = normalizeMeetingJobFinalizer(afterSnapshot.data());
    if (!queuedFinalizer.jobId || normalizeText(queuedFinalizer.status) !== "queued" || normalizeText(previousFinalizer?.status) === "queued") {
      return;
    }

    const finalizerRef = db.collection(JOB_FINALIZER_COLLECTION).doc(afterSnapshot.id);
    const jobRef = db.collection(JOB_COLLECTION).doc(queuedFinalizer.jobId);
    const jobSnapshot = await jobRef.get();
    if (!jobSnapshot.exists) {
      await finalizerRef.set({
        error: "상위 회의 job을 찾지 못했어요.",
        status: "failed",
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return;
    }

    let currentJob = normalizeMeetingJob(jobSnapshot.data());
    if (!currentJob.jobId || currentJob.deletedAt) {
      return;
    }
    const owner = currentJob.owner && typeof currentJob.owner === "object" ? { ...currentJob.owner } : {};
    const meeting = normalizeMeetingRequest(currentJob.meeting);
    const options = normalizeMeetingOptions(currentJob.options);
    const context = normalizeMeetingContext(currentJob.context);
    const source = normalizeMeetingSource(currentJob.source);
    const artifactId = getMeetingArtifactId(currentJob.jobId, owner.providerUserKey, meeting.meetingId, source.requestId, db);
    const artifactRef = db.collection(ARTIFACT_COLLECTION).doc(artifactId);
    const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, meeting.meetingId));
    const sessionRef = meeting.sessionId
      ? db.collection(SESSION_COLLECTION).doc(buildSessionDocId(owner.providerUserKey, meeting.sessionId))
      : null;

    const persistJobPatch = async (patch, artifact) => {
      currentJob = await persistMeetingJobPatch(
        jobRef,
        meetingRef,
        sessionRef,
        meeting,
        owner,
        currentJob,
        patch,
        artifact
      );
      return currentJob;
    };

    try {
      const startedAt = new Date().toISOString();
      await finalizerRef.set({
        error: "",
        status: "processing",
        updatedAt: startedAt,
      }, { merge: true });
      await persistJobPatch({
        progress: {
          currentPart: Math.max(0, Number(currentJob.progress?.currentPart) || 0),
          parallelParts: 0,
          percent: 80,
          phase: "assembling_transcript",
          totalParts: Math.max(0, Number(currentJob.progress?.totalParts) || (Array.isArray(source.parts) ? source.parts.length : 0)),
        },
        updatedAt: startedAt,
      });

      const partDocs = await loadMeetingJobPartDocs(currentJob.jobId);
      if (!partDocs.length || partDocs.some((part) => part.status !== "succeeded" || !normalizeText(part.transcript?.storageObject))) {
        throw createHttpError(409, "청크 전사 결과가 아직 모두 준비되지 않았어요.");
      }
      const chunkTranscripts = [];
      for (const partDoc of partDocs) {
        chunkTranscripts.push({
          part: partDoc.part,
          transcript: await loadMeetingChunkTranscript(bucket, partDoc.transcript.storageObject),
        });
      }
      const transcript = await mergeChunkTranscripts(chunkTranscripts, options, async (progressPatch) => {
        await persistJobPatch(progressPatch);
      });
      await persistJobPatch({
        progress: {
          currentPart: partDocs.length,
          parallelParts: 0,
          percent: 86,
          phase: "generating_notes",
          totalParts: partDocs.length,
        },
        updatedAt: new Date().toISOString(),
      });
      const meetingNotes = await maybeGenerateMeetingNotes(transcript, meeting, options, context, logEvent, owner, currentJob.jobId);
      const completedAt = new Date().toISOString();
      const artifact = buildTranscriptArtifact(artifactId, currentJob.jobId, meeting, owner, transcript, meetingNotes, completedAt);
      const deletion = await deleteTemporarySourceGroup(
        bucket,
        [
          ...collectMeetingSourceStorageObjects(source),
          ...collectMeetingChunkTranscriptStorageObjects(partDocs),
        ]
      );
      const succeededPatch = buildSucceededJobPatch(
        artifact,
        meeting,
        options,
        markMeetingSourceDeleted(source, deletion.deletedStorageObjects),
        context,
        transcript,
        meetingNotes,
        completedAt,
        deletion.deletedAt,
        currentJob.retry
      );
      const storedJob = await loadStoredMeetingJob(jobRef);
      if (!storedJob?.jobId || storedJob.deletedAt) {
        await Promise.all([
          deleteDocumentIfExists(finalizerRef),
          ...partDocs.map((partDoc) => deleteDocumentIfExists(db.collection(JOB_PART_COLLECTION).doc(partDoc.docId))),
        ]);
        return;
      }
      currentJob = mergeMeetingJobPatch(storedJob, succeededPatch);
      await Promise.all([
        artifactRef.set(artifact),
        jobRef.set(succeededPatch, { merge: true }),
        upsertMeetingJobSummary(meetingRef, meeting, owner, currentJob, artifact),
        sessionRef ? upsertLegacySessionJobSummary(sessionRef, meeting, owner, currentJob, artifact) : Promise.resolve(),
        deleteDocumentIfExists(finalizerRef),
        ...partDocs.map((partDoc) => deleteDocumentIfExists(db.collection(JOB_PART_COLLECTION).doc(partDoc.docId))),
      ]);
      logEvent("meeting.process.success", {
        artifactId,
        chunked: true,
        jobId: currentJob.jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
        speakerCount: transcript.speakerCount,
      });
    } catch (error) {
      const errorMessage = formatMeetingProcessErrorMessage(error);
      const nextRetryCount = Math.max(0, Number(queuedFinalizer.retry?.count) || 0) + 1;
      const retryLimit = getMeetingProcessRetryLimit();
      if (isRetryableMeetingProcessError(error) && nextRetryCount <= retryLimit) {
        const retriedAt = new Date().toISOString();
        await finalizerRef.set({
          error: "",
          queuedAt: retriedAt,
          retry: {
            count: nextRetryCount,
            lastError: errorMessage,
            lastRetriedAt: retriedAt,
          },
          status: "queued",
          updatedAt: retriedAt,
        }, { merge: true });
        await persistJobPatch({
          error: "",
          progress: {
            currentPart: Math.max(0, Number(currentJob.progress?.currentPart) || 0),
            parallelParts: 0,
            percent: Math.max(80, Number(currentJob.progress?.percent) || 80),
            phase: "assembling_transcript",
            totalParts: Math.max(0, Number(currentJob.progress?.totalParts) || (Array.isArray(source.parts) ? source.parts.length : 0)),
          },
          retry: {
            count: nextRetryCount,
            lastError: errorMessage,
            lastRetriedAt: retriedAt,
          },
          updatedAt: retriedAt,
        });
        logEvent("meeting.process.finalize.retry.queued", {
          error: normalizeText(error?.message),
          jobId: currentJob.jobId,
          meetingId: meeting.meetingId,
          providerUserKey: owner.providerUserKey,
          retryCount: nextRetryCount,
          retryLimit,
        });
        return;
      }

      await finalizerRef.set({
        error: errorMessage,
        retry: {
          count: Math.max(0, Number(queuedFinalizer.retry?.count) || 0),
          lastError: errorMessage,
          lastRetriedAt: normalizeText(queuedFinalizer.retry?.lastRetriedAt),
        },
        status: "failed",
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      await persistJobPatch({
        error: errorMessage,
        progress: {
          currentPart: Math.max(0, Number(currentJob.progress?.currentPart) || 0),
          parallelParts: 0,
          percent: 100,
          phase: "failed",
          totalParts: Math.max(0, Number(currentJob.progress?.totalParts) || (Array.isArray(source.parts) ? source.parts.length : 0)),
        },
        retry: {
          count: Math.max(0, Number(currentJob.retry?.count) || 0),
          lastError: errorMessage,
          lastRetriedAt: normalizeText(currentJob.retry?.lastRetriedAt),
        },
        status: "failed",
        updatedAt: new Date().toISOString(),
      });
      logEvent("meeting.process.error", {
        error: normalizeText(error?.message),
        jobId: currentJob.jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });
    }
  };

  const getInovaMeetingJob = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const input = normalizeMeetingJobLookup(request.body);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;

      if (!input.jobId) {
        throw createHttpError(400, "회의 job ID가 없어요.");
      }

      const snapshot = await db.collection(JOB_COLLECTION).doc(input.jobId).get();
      if (!snapshot.exists) {
        throw createHttpError(404, "회의 job을 찾지 못했어요.");
      }
      const job = normalizeMeetingJob(snapshot.data());
      if (job.deletedAt) {
        throw createHttpError(404, "삭제된 회의 결과예요.");
      }
      assertJobOwnership(job, owner, createHttpError);
      assertWorkspaceMeetingAccess(access, input.meetingId || job.meetingId, createHttpError);
      await assertMeetingIsActive(owner, job.meetingId, createHttpError);
      if (input.meetingId && input.meetingId !== job.meetingId) {
        throw createHttpError(404, "현재 회의와 맞지 않는 job이에요.");
      }
      if (input.sessionId && input.sessionId !== job.sessionId) {
        throw createHttpError(404, "현재 세션과 맞지 않는 회의 job이에요.");
      }

      logEvent("meeting.get-job.success", {
        jobId: job.jobId,
        meetingId: job.meetingId,
        providerUserKey: owner.providerUserKey,
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
      const input = normalizeMeetingArtifactLookup(request.body);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;

      if (!input.jobId || !input.artifactId) {
        throw createHttpError(400, "회의 artifact 조회에 필요한 ID가 비어 있어요.");
      }

      const jobSnapshot = await db.collection(JOB_COLLECTION).doc(input.jobId).get();
      if (!jobSnapshot.exists) {
        throw createHttpError(404, "회의 job을 찾지 못했어요.");
      }
      const job = normalizeMeetingJob(jobSnapshot.data());
      if (job.deletedAt) {
        throw createHttpError(404, "삭제된 회의 결과예요.");
      }
      assertJobOwnership(job, owner, createHttpError);
      assertWorkspaceMeetingAccess(access, input.meetingId || job.meetingId, createHttpError);
      await assertMeetingIsActive(owner, job.meetingId, createHttpError);
      if (input.meetingId && input.meetingId !== job.meetingId) {
        throw createHttpError(404, "현재 회의와 맞지 않는 회의 job이에요.");
      }

      const artifactSnapshot = await db.collection(ARTIFACT_COLLECTION).doc(input.artifactId).get();
      if (!artifactSnapshot.exists) {
        throw createHttpError(404, "회의 artifact를 찾지 못했어요.");
      }
      const artifact = normalizeMeetingArtifact(artifactSnapshot.data());
      if (artifact.deletedAt) {
        throw createHttpError(404, "삭제된 회의 결과 파일이에요.");
      }
      if (artifact.jobId !== job.jobId) {
        throw createHttpError(404, "회의 job과 연결되지 않는 artifact예요.");
      }
      if (input.meetingId && artifact.meetingId && artifact.meetingId !== input.meetingId) {
        throw createHttpError(404, "현재 회의와 연결되지 않는 artifact예요.");
      }

      logEvent("meeting.get-artifact.success", {
        artifactId: artifact.artifactId,
        jobId: job.jobId,
        meetingId: job.meetingId,
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

  const listInovaMeetings = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;
      const input = normalizeMeetingHubListRequest(request.body);
      const items = await loadOwnedMeetings(owner, input.limit, input.cursor);
      const nextCursor = items.length === input.limit ? normalizeText(items[items.length - 1]?.meetingId) : "";

      logEvent("meeting.list-hub.success", {
        itemCount: items.length,
        providerUserKey: owner.providerUserKey,
      });
      response.json({
        ok: true,
        data: {
          items,
          nextCursor,
        },
      });
    } catch (error) {
      logEvent("meeting.list-hub.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const listInovaMeetingResults = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const input = normalizeMeetingResultsListRequest(request.body);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;

      if (!input.meetingId && !input.sessionId) {
        throw createHttpError(400, "회의 ID가 없어요.");
      }
      assertWorkspaceMeetingAccess(access, input.meetingId, createHttpError);

      const meetingRecord = await loadMeetingSummaryRecord(owner, input, createHttpError);
      if (!meetingRecord) {
        response.json({
          ok: true,
          data: {
            items: [],
            meeting: normalizeMeetingSummary({
              meetingId: input.meetingId,
              owner,
              pendingLocalCount: 0,
              title: "",
              updatedAt: "",
            }),
          },
        });
        return;
      }

      logEvent("meeting.list-results.success", {
        itemCount: meetingRecord.recentJobs.length,
        meetingId: meetingRecord.meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });
      response.json({
        ok: true,
        data: {
          items: meetingRecord.recentJobs.slice(0, input.limit),
          meeting: {
            ...meetingRecord.meeting,
            pendingLocalCount: Math.max(0, Number(meetingRecord.meeting?.pendingLocalCount) || 0),
          },
          session: {
            endedAt: normalizeText(meetingRecord.meeting.endedAt),
            language: normalizeText(meetingRecord.meeting.language),
            sessionId: normalizeText(meetingRecord.meeting.sessionId),
            sharedMemo: normalizeText(meetingRecord.meeting.sharedMemo),
            startedAt: normalizeText(meetingRecord.meeting.startedAt),
            title: normalizeText(meetingRecord.meeting.title),
          },
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

  const updateInovaMeeting = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const input = normalizeMeetingMutationRequest(request.body);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;

      if (!input.meetingId) {
        throw createHttpError(400, "회의 ID가 없어요.");
      }
      if (!input.hasSharedMemo && !input.hasTitle) {
        throw createHttpError(400, "수정할 회의 내용이 없어요.");
      }
      if (input.hasTitle && !input.title) {
        throw createHttpError(400, "회의 제목을 입력해 주세요.");
      }
      assertWorkspaceMeetingAccess(access, input.meetingId, createHttpError);

      const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, input.meetingId));
      const snapshot = await meetingRef.get();
      const currentMeeting = snapshot.exists
        ? normalizeMeetingSummary(snapshot.data())
        : normalizeMeetingSummary({
            createdAt: new Date().toISOString(),
            meetingId: input.meetingId,
            owner,
            sessionId: normalizeText(access?.workspaceSession?.meeting?.sessionId),
            title: normalizeText(access?.workspaceSession?.meeting?.title),
          });
      if (snapshot.exists) {
        assertMeetingOwnership(currentMeeting, owner, createHttpError);
      }
      if (snapshot.exists && currentMeeting.deletedAt) {
        throw createHttpError(404, "이미 삭제된 회의예요.");
      }

      const previousTitle = normalizeText(currentMeeting.title);
      const nextTitle = input.hasTitle ? input.title : currentMeeting.title;
      const nextSharedMemo = input.hasSharedMemo ? input.sharedMemo : currentMeeting.sharedMemo;
      const recentJobs = currentMeeting.recentJobs.map((item) => (
        input.hasTitle && shouldSyncMeetingTitleToResult(item, previousTitle)
          ? {
              ...item,
              title: nextTitle,
            }
          : item
      ));
      const updatedAt = new Date().toISOString();
      await meetingRef.set({
        createdAt: currentMeeting.createdAt || updatedAt,
        meetingId: currentMeeting.meetingId || input.meetingId,
        owner: normalizeText(currentMeeting.owner?.providerUserKey) ? currentMeeting.owner : owner,
        recentJobs,
        sessionId: currentMeeting.sessionId,
        sharedMemo: nextSharedMemo,
        title: nextTitle,
        updatedAt,
      }, { merge: true });

      if (currentMeeting.sessionId) {
        const sessionRef = db.collection(SESSION_COLLECTION).doc(buildSessionDocId(owner.providerUserKey, currentMeeting.sessionId));
        const sessionSnapshot = await sessionRef.get();
        const currentSession = sessionSnapshot.exists ? normalizeMeetingSession(sessionSnapshot.data()) : normalizeMeetingSession({});
        const sessionRecentJobs = currentSession.recentJobs.map((item) => (
          input.hasTitle && shouldSyncMeetingTitleToResult(item, previousTitle)
            ? {
                ...item,
                title: nextTitle,
              }
            : item
        ));
        await sessionRef.set({
          language: currentSession.language || currentMeeting.language || "ko",
          owner: normalizeText(currentSession.owner?.providerUserKey) ? currentSession.owner : owner,
          recentJobs: sessionRecentJobs,
          sessionId: currentSession.sessionId || currentMeeting.sessionId,
          sharedMemo: nextSharedMemo,
          title: nextTitle,
          updatedAt,
        }, { merge: true });
      }

      if (input.hasTitle) {
        await Promise.all(
          currentMeeting.recentJobs
            .filter((item) => shouldSyncMeetingTitleToResult(item, previousTitle))
            .map((item) => (
              db.collection(JOB_COLLECTION).doc(item.jobId).set({
                meeting: {
                  title: nextTitle,
                },
              }, { merge: true })
            ))
        );
      }

      logEvent("meeting.update.success", {
        meetingId: input.meetingId,
        providerUserKey: owner.providerUserKey,
      });
      response.json({
        ok: true,
        data: {
          meeting: normalizeMeetingSummary({
            ...currentMeeting,
            recentJobs,
            sharedMemo: nextSharedMemo,
            title: nextTitle,
            updatedAt,
          }),
        },
      });
    } catch (error) {
      logEvent("meeting.update.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const updateInovaMeetingResult = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const input = normalizeMeetingResultMutationRequest(request.body);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;

      if (!input.meetingId || !input.jobId) {
        throw createHttpError(400, "회의 결과를 수정할 ID가 비어 있어요.");
      }
      if (!input.title && !input.speakerAliasesProvided) {
        throw createHttpError(400, "수정할 회의 결과 내용이 비어 있어요.");
      }
      assertWorkspaceMeetingAccess(access, input.meetingId, createHttpError);

      const jobRef = db.collection(JOB_COLLECTION).doc(input.jobId);
      const jobSnapshot = await jobRef.get();
      if (!jobSnapshot.exists) {
        throw createHttpError(404, "수정할 회의 결과를 찾지 못했어요.");
      }
      const job = normalizeMeetingJob(jobSnapshot.data());
      if (job.deletedAt) {
        throw createHttpError(404, "이미 삭제된 회의 결과예요.");
      }
      assertJobOwnership(job, owner, createHttpError);
      await assertMeetingIsActive(owner, job.meetingId, createHttpError);
      if (job.meetingId !== input.meetingId) {
        throw createHttpError(404, "현재 회의와 맞지 않는 결과예요.");
      }

      let nextSpeakerAliases = job.speakerAliases;
      if (input.speakerAliasesProvided) {
        const transcriptSource = await loadMeetingTranscriptForNotes(job, db, createHttpError);
        const allowedSpeakerLabels = collectTranscriptSpeakerLabels(transcriptSource.transcript);
        nextSpeakerAliases = normalizeSpeakerAliases(input.speakerAliases, allowedSpeakerLabels);
        if (transcriptSource.artifactRef) {
          await transcriptSource.artifactRef.set({
            speakerAliases: nextSpeakerAliases,
          }, { merge: true });
        }
      }

      const updatedAt = new Date().toISOString();
      const jobPatch = {
        updatedAt,
      };
      if (input.title) {
        jobPatch.title = input.title;
      }
      if (input.speakerAliasesProvided) {
        jobPatch.speakerAliases = nextSpeakerAliases;
      }
      await jobRef.set(jobPatch, { merge: true });

      if (input.title) {
        await updateMeetingSummaryRecordTitle(owner, job, input.title, updatedAt);
      }

      logEvent("meeting.result.update.success", {
        jobId: input.jobId,
        meetingId: input.meetingId,
        providerUserKey: owner.providerUserKey,
      });
      response.json({
        ok: true,
        data: {
          job: normalizeMeetingJob({
            ...job,
            ...jobPatch,
            updatedAt,
          }),
        },
      });
    } catch (error) {
      logEvent("meeting.result.update.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const regenerateInovaMeetingNotes = onRequest({ cors: CORS_ORIGINS, region: REGION, timeoutSeconds: 120 }, async (request, response) => {
    try {
      assertMethod(request);
      const input = normalizeMeetingNotesRegenerateRequest(request.body);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;

      if (!input.meetingId || !input.jobId) {
        throw createHttpError(400, "회의록을 다시 정리할 ID가 비어 있어요.");
      }
      assertWorkspaceMeetingAccess(access, input.meetingId, createHttpError);

      const jobRef = db.collection(JOB_COLLECTION).doc(input.jobId);
      const jobSnapshot = await jobRef.get();
      if (!jobSnapshot.exists) {
        throw createHttpError(404, "다시 정리할 회의 결과를 찾지 못했어요.");
      }
      const job = normalizeMeetingJob(jobSnapshot.data());
      if (job.deletedAt) {
        throw createHttpError(404, "이미 삭제된 회의 결과예요.");
      }
      assertJobOwnership(job, owner, createHttpError);
      await assertMeetingIsActive(owner, job.meetingId, createHttpError);
      if (job.meetingId !== input.meetingId) {
        throw createHttpError(404, "현재 회의와 맞지 않는 결과예요.");
      }

      const transcriptSource = await loadMeetingTranscriptForNotes(job, db, createHttpError);
      const artifactRef = transcriptSource.artifactRef;
      const artifact = transcriptSource.artifact;
      const speakerAliases = normalizeSpeakerAliases(
        {
          ...(artifact?.speakerAliases || {}),
          ...(job.speakerAliases || {}),
        },
        collectTranscriptSpeakerLabels(transcriptSource.transcript)
      );
      const meetingRecord = await loadMeetingSummaryRecord(owner, { meetingId: job.meetingId }, createHttpError);
      const effectiveMeeting = {
        ...job.meeting,
        meetingId: job.meetingId,
        sharedMemo: normalizeText(input.sharedMemo || meetingRecord?.meeting?.sharedMemo || job.context?.sharedMemoSnapshot),
        title: normalizeText(job.meeting?.title || job.title || meetingRecord?.meeting?.title),
      };
      const context = {
        sharedMemoSnapshot: normalizeText(effectiveMeeting.sharedMemo),
      };
      const meetingNotes = await generateMeetingNotesBundle({
        ...transcriptSource.transcript,
        speakerAliases,
      }, effectiveMeeting, context, input.notesMode, input.notesStyle);
      const updatedAt = new Date().toISOString();
      const resultTitle = resolveMeetingResultTitle(meetingNotes, job.title || effectiveMeeting.title);
      const jobPatch = {
        context,
        meeting: {
          ...job.meeting,
          sharedMemo: normalizeText(effectiveMeeting.sharedMemo),
          title: normalizeText(effectiveMeeting.title),
        },
        notesDegradedReason: meetingNotes.notesDegradedReason,
        meetingNotes: meetingNotes.notes,
        notesGeneratedAt: meetingNotes.notesGeneratedAt,
        notesModeConfidence: meetingNotes.notesModeConfidence,
        notesModeDetected: meetingNotes.notesModeDetected,
        notesModeSelected: meetingNotes.notesModeSelected,
        notesStatus: meetingNotes.notesStatus,
        notesStyleSelected: meetingNotes.notesStyleSelected,
        notesSchemaVersion: meetingNotes.notesSchemaVersion,
        speakerAliases,
        title: resultTitle,
        updatedAt,
      };
      const artifactPatch = {
        notesDegradedReason: meetingNotes.notesDegradedReason,
        notes: meetingNotes.notes,
        notesGeneratedAt: meetingNotes.notesGeneratedAt,
        notesModeConfidence: meetingNotes.notesModeConfidence,
        notesModeDetected: meetingNotes.notesModeDetected,
        notesModeSelected: meetingNotes.notesModeSelected,
        notesStatus: meetingNotes.notesStatus,
        notesStyleSelected: meetingNotes.notesStyleSelected,
        notesSchemaVersion: meetingNotes.notesSchemaVersion,
        speakerAliases,
      };
      const nextJob = normalizeMeetingJob({
        ...job,
        ...jobPatch,
      });
      const nextArtifact = normalizeMeetingArtifact({
        ...artifact,
        ...artifactPatch,
      });
      const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, job.meetingId));
      const sessionRef = job.sessionId
        ? db.collection(SESSION_COLLECTION).doc(buildSessionDocId(owner.providerUserKey, job.sessionId))
        : null;

      await Promise.all([
        jobRef.set(jobPatch, { merge: true }),
        artifactRef ? artifactRef.set(artifactPatch, { merge: true }) : Promise.resolve(),
        upsertMeetingJobSummary(meetingRef, effectiveMeeting, owner, nextJob, nextArtifact),
        sessionRef ? upsertLegacySessionJobSummary(sessionRef, effectiveMeeting, owner, nextJob, nextArtifact) : Promise.resolve(),
      ]);

      logEvent("meeting.notes.regenerate.success", {
        jobId: input.jobId,
        meetingId: input.meetingId,
        notesMode: input.notesMode || meetingNotes.notesModeSelected,
        notesStyle: input.notesStyle,
        providerUserKey: owner.providerUserKey,
      });
      response.json({
        ok: true,
        data: {
          artifact: nextArtifact,
          job: nextJob,
        },
      });
    } catch (error) {
      logEvent("meeting.notes.regenerate.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const deleteInovaMeetingResult = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const input = normalizeMeetingResultMutationRequest(request.body);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;

      if (!input.meetingId || !input.jobId) {
        throw createHttpError(400, "삭제할 회의 결과 ID가 비어 있어요.");
      }
      assertWorkspaceMeetingAccess(access, input.meetingId, createHttpError);

      const jobRef = db.collection(JOB_COLLECTION).doc(input.jobId);
      const jobSnapshot = await jobRef.get();
      if (!jobSnapshot.exists) {
        throw createHttpError(404, "삭제할 회의 결과를 찾지 못했어요.");
      }
      const job = normalizeMeetingJob(jobSnapshot.data());
      if (job.deletedAt) {
        throw createHttpError(404, "이미 삭제된 회의 결과예요.");
      }
      assertJobOwnership(job, owner, createHttpError);
      await assertMeetingIsActive(owner, job.meetingId, createHttpError);
      if (job.meetingId !== input.meetingId) {
        throw createHttpError(404, "현재 회의와 맞지 않는 결과예요.");
      }

      const deletedAt = new Date().toISOString();
      const deletion = await deleteMeetingJobRuntimeArtifacts(job, deletedAt);

      const meeting = await removeMeetingResultFromSummaries(owner, job, deletedAt);

      logEvent("meeting.result.delete.success", {
        artifactCount: deletion.artifactIds.length,
        jobId: input.jobId,
        meetingId: input.meetingId,
        providerUserKey: owner.providerUserKey,
        storageObjectDeleted: Boolean(deletion.deletedStorageObjects.length),
      });
      response.json({
        ok: true,
        data: {
          artifactCount: deletion.artifactIds.length,
          deletedAt,
          deletedJobId: input.jobId,
          meeting,
          storageObjectDeleted: Boolean(deletion.deletedStorageObjects.length),
        },
      });
    } catch (error) {
      logEvent("meeting.result.delete.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const deleteInovaMeeting = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const input = normalizeMeetingMutationRequest(request.body);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;

      if (!input.meetingId) {
        throw createHttpError(400, "삭제할 회의 ID가 없어요.");
      }
      assertWorkspaceMeetingAccess(access, input.meetingId, createHttpError);

      const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, input.meetingId));
      const snapshot = await meetingRef.get();
      if (!snapshot.exists) {
        throw createHttpError(404, "삭제할 회의를 찾지 못했어요.");
      }
      let meeting = normalizeMeetingSummary(snapshot.data());
      if (!normalizeText(meeting.owner?.providerUserKey)) {
        await meetingRef.set({
          meetingId: meeting.meetingId || meetingId,
          owner,
        }, { merge: true });
        meeting = normalizeMeetingSummary({
          ...meeting,
          meetingId: meeting.meetingId || meetingId,
          owner,
        });
      }
      assertMeetingOwnership(meeting, owner, createHttpError);
      if (meeting.deletedAt) {
        throw createHttpError(404, "이미 삭제된 회의예요.");
      }
      const jobs = await loadOwnedMeetingJobs(owner, meeting.meetingId);
      const deletedAt = new Date().toISOString();
      const deletions = [];
      for (const job of jobs) {
        deletions.push(await deleteMeetingJobRuntimeArtifacts(job, deletedAt));
      }
      const artifactIds = Array.from(new Set(deletions.flatMap((item) => item.artifactIds)));
      const storageObjects = Array.from(new Set(deletions.flatMap((item) => item.deletedStorageObjects)));

      if (meeting.sessionId) {
        const sessionRef = db.collection(SESSION_COLLECTION).doc(buildSessionDocId(owner.providerUserKey, meeting.sessionId));
        await sessionRef.set({
          deletedAt,
          recentJobs: [],
          updatedAt: deletedAt,
        }, { merge: true });
      }
      await meetingRef.set({
        deletedAt,
        recentJobs: [],
        updatedAt: deletedAt,
      }, { merge: true });

      logEvent("meeting.delete.success", {
        artifactCount: artifactIds.length,
        jobCount: jobs.length,
        meetingId: input.meetingId,
        providerUserKey: owner.providerUserKey,
        storageObjectCount: storageObjects.length,
      });
      response.json({
        ok: true,
        data: {
          artifactCount: artifactIds.length,
          deletedAt,
          jobCount: jobs.length,
          meetingId: input.meetingId,
          storageObjectCount: storageObjects.length,
        },
      });
    } catch (error) {
      logEvent("meeting.delete.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  return {
    createInovaMeetingJob,
    deleteInovaMeeting,
    deleteInovaMeetingResult,
    finalizeChunkedMeetingJobWrite,
    getInovaMeetingArtifact,
    getInovaMeetingJob,
    listInovaMeetings,
    listInovaMeetingResults,
    processQueuedMeetingJobWrite,
    processQueuedMeetingJobPartWrite,
    regenerateInovaMeetingNotes,
    uploadInovaMeetingSource,
    updateInovaMeeting,
    updateInovaMeetingResult,
  };

  function assertMethod(request) {
    if (request.method !== "POST") {
      throw createHttpError(405, "POST 요청만 지원해요.");
    }
  }

  async function verifyRequestIdentity(request) {
    if (typeof authorizeMeetingRequest === "function") {
      return authorizeMeetingRequest(request, request.body?.providerIdentity || request.body?.owner);
    }
    const providerIdentity = normalizeIdentity(request.body?.providerIdentity || request.body?.owner);
    return {
      authType: "access-token",
      owner: await verifyInovaIdentity(providerIdentity, request),
      workspaceSession: null,
    };
  }

  function assertWorkspaceMeetingAccess(access, meetingId, createHttpError) {
    const sessionMeetingId = normalizeText(access?.workspaceSession?.meeting?.meetingId);
    if (!sessionMeetingId) {
      return;
    }
    const requestedMeetingId = normalizeText(meetingId);
    if (requestedMeetingId && requestedMeetingId !== sessionMeetingId) {
      throw createHttpError(403, "다른 회의 결과에는 접근할 수 없어요.");
    }
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
      return {
        storageObject: "",
        uploadStatus: "inline-only",
      };
    }
    try {
      await targetBucket.file(storageObject).save(audioBuffer, {
        contentType: source.mimeType || "application/octet-stream",
        metadata: {
          metadata: {
            captureMode: source.captureMode,
            jobId,
            meetingId: meeting.meetingId,
            providerUserKey: owner.providerUserKey,
          },
        },
        resumable: false,
      });
      return {
        storageObject,
        uploadStatus: "uploaded",
      };
    } catch (error) {
      logEvent("meeting.source-upload.skipped", {
        error: normalizeText(error?.message),
        jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });
      return {
        storageObject: "",
        uploadStatus: "inline-only",
      };
    }
  }

  async function deleteTemporarySource(targetBucket, storageObject) {
    if (!targetBucket || !storageObject) {
      return "";
    }
    try {
      await targetBucket.file(storageObject).delete({ ignoreNotFound: true });
      return new Date().toISOString();
    } catch {
      return "";
    }
  }

  async function deleteTemporarySourceGroup(targetBucket, storageObjects) {
    const deletedStorageObjects = [];
    for (const storageObject of Array.from(new Set((storageObjects || []).map((value) => normalizeText(value)).filter(Boolean)))) {
      const deletedAt = await deleteTemporarySource(targetBucket, storageObject);
      if (deletedAt) {
        deletedStorageObjects.push(storageObject);
      }
    }
    return {
      deletedAt: deletedStorageObjects.length ? new Date().toISOString() : "",
      deletedStorageObjects,
    };
  }

  async function persistUploadedMeetingSourceToExistingJob(jobId, owner, uploadInput, storageObject) {
    const normalizedJobId = normalizeText(jobId);
    const normalizedStorageObject = normalizeText(storageObject);
    if (!normalizedJobId || !normalizedStorageObject) {
      return null;
    }
    const jobRef = db.collection(JOB_COLLECTION).doc(normalizedJobId);
    const uploadedAt = new Date().toISOString();
    let nextJob = null;
    let didWrite = false;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(jobRef);
      if (!snapshot.exists) {
        return;
      }
      const currentJob = normalizeMeetingJob(snapshot.data());
      if (!currentJob.jobId || currentJob.deletedAt) {
        return;
      }
      if (normalizeText(currentJob.owner?.providerUserKey) !== normalizeText(owner?.providerUserKey)) {
        return;
      }
      if (normalizeText(currentJob.meetingId) !== normalizeText(uploadInput?.meetingId)) {
        return;
      }
      const nextSource = buildUploadedMeetingSourcePatch(currentJob.source, uploadInput, normalizedStorageObject);
      if (!hasMeaningfulMeetingSourceUpdate(currentJob.source, nextSource)) {
        nextJob = currentJob;
        return;
      }
      nextJob = mergeMeetingJobPatch(currentJob, {
        source: nextSource,
        updatedAt: uploadedAt,
      });
      didWrite = true;
      transaction.set(jobRef, {
        source: nextSource,
        updatedAt: uploadedAt,
      }, { merge: true });
    });
    if (!nextJob || !didWrite) {
      return nextJob;
    }
    const meeting = normalizeMeetingRequest(nextJob.meeting);
    const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, meeting.meetingId));
    const sessionId = normalizeText(nextJob.sessionId || meeting.sessionId);
    const sessionRef = sessionId
      ? db.collection(SESSION_COLLECTION).doc(buildSessionDocId(owner.providerUserKey, sessionId))
      : null;
    await Promise.all([
      upsertMeetingJobSummary(meetingRef, meeting, owner, nextJob),
      sessionRef ? upsertLegacySessionJobSummary(sessionRef, meeting, owner, nextJob) : Promise.resolve(),
    ]);
    return nextJob;
  }

  function buildUploadedMeetingSourcePatch(sourceInput, uploadInput, storageObject) {
    const currentSource = normalizeMeetingSource(sourceInput);
    const normalizedStorageObject = normalizeText(storageObject);
    const normalizedParentRequestId = normalizeText(
      uploadInput?.parentRequestId || uploadInput?.requestId || currentSource.requestId
    );
    const normalizedCaptureMode = normalizeText(uploadInput?.captureMode) || currentSource.captureMode;
    const normalizedMimeType = normalizeText(uploadInput?.mimeType) || currentSource.mimeType;
    const normalizedFileName = normalizeText(uploadInput?.fileName) || currentSource.fileName;
    const normalizedDurationMs = Math.max(0, Number(uploadInput?.durationMs) || currentSource.durationMs || 0);
    const normalizedChannelCount = Math.max(0, Number(uploadInput?.channelCount) || currentSource.channelCount || 0);
    const normalizedOriginalSizeBytes = Math.max(
      0,
      Number(currentSource.originalSizeBytes) || 0,
      Number(currentSource.sizeBytes) || 0,
      Number(uploadInput?.sizeBytes) || 0
    );
    const targetPartCount = Math.max(
      0,
      Number(uploadInput?.partCount) || 0,
      Array.isArray(currentSource.parts) ? currentSource.parts.length : 0,
      Math.max(0, Number(uploadInput?.partIndex) || 0) + 1
    );

    if (targetPartCount > 0 || currentSource.mode === "chunked") {
      const existingPartsByIndex = new Map(
        (Array.isArray(currentSource.parts) ? currentSource.parts : []).map((part) => [Number(part.index), part])
      );
      const nextParts = [];
      for (let index = 0; index < targetPartCount; index += 1) {
        const existingPart = existingPartsByIndex.get(index);
        const isTargetPart = index === Math.max(0, Number(uploadInput?.partIndex) || 0);
        const nextPartInput = isTargetPart
          ? {
              ...(existingPart || {}),
              endMs: Math.max(0, Number(uploadInput?.endMs) || Number(existingPart?.endMs) || 0),
              index,
              mimeType: normalizedMimeType || normalizeText(existingPart?.mimeType),
              overlapMs: Math.max(0, Number(uploadInput?.overlapMs) || Number(existingPart?.overlapMs) || 0),
              requestId: normalizeText(uploadInput?.requestId) || normalizeText(existingPart?.requestId),
              sizeBytes: Math.max(0, Number(uploadInput?.sizeBytes) || Number(existingPart?.sizeBytes) || 0),
              startMs: Math.max(0, Number(uploadInput?.startMs) || Number(existingPart?.startMs) || 0),
              storageObject: normalizedStorageObject,
              uploadStatus: "uploaded",
            }
          : {
              ...(existingPart || {}),
              index,
              mimeType: normalizeText(existingPart?.mimeType) || normalizedMimeType,
              requestId: normalizeText(existingPart?.requestId),
              uploadStatus: normalizeText(existingPart?.uploadStatus) || "pending_upload",
            };
        nextParts.push(normalizeMeetingSourcePart(nextPartInput, index, normalizedParentRequestId));
      }
      const uploadedPartCount = nextParts.filter((part) => normalizeText(part.storageObject)).length;
      return normalizeMeetingSource({
        ...currentSource,
        captureMode: normalizedCaptureMode,
        channelCount: normalizedChannelCount,
        durationMs: Math.max(currentSource.durationMs, normalizedDurationMs),
        fileName: normalizedFileName || currentSource.fileName,
        inlineAudioBase64: "",
        mimeType: normalizedMimeType || currentSource.mimeType,
        mode: "chunked",
        originalSizeBytes: normalizedOriginalSizeBytes,
        parts: nextParts,
        requestId: normalizedParentRequestId || currentSource.requestId,
        sizeBytes: Math.max(currentSource.sizeBytes, normalizedOriginalSizeBytes),
        storageObject: "",
        uploadStatus: uploadedPartCount >= nextParts.length
          ? "uploaded"
          : uploadedPartCount > 0
            ? "partial"
            : "pending_upload",
      });
    }

    return normalizeMeetingSource({
      ...currentSource,
      captureMode: normalizedCaptureMode,
      channelCount: normalizedChannelCount,
      durationMs: Math.max(currentSource.durationMs, normalizedDurationMs),
      fileName: normalizedFileName || currentSource.fileName,
      inlineAudioBase64: "",
      mimeType: normalizedMimeType || currentSource.mimeType,
      mode: "single",
      originalSizeBytes: normalizedOriginalSizeBytes,
      requestId: normalizedParentRequestId || currentSource.requestId,
      sizeBytes: Math.max(currentSource.sizeBytes, normalizedOriginalSizeBytes),
      storageObject: normalizedStorageObject,
      uploadStatus: "uploaded",
    });
  }

  function assertMeetingSourceWithinSupportedLimits(source, errorFactory) {
    if (source.sizeBytes > getMeetingSourceMaxBytes()) {
      throw errorFactory(
        413,
        `현재 회의 원본은 ${Math.floor(getMeetingSourceMaxBytes() / (1024 * 1024))}MB 이하까지만 지원해요.`
      );
    }
    if (source.durationMs > getMeetingSourceMaxDurationMs()) {
      throw errorFactory(413, "현재 회의 원본은 최대 2시간까지만 지원해요.");
    }
  }

  async function ensureQueuedMeetingSourceReady(source, owner, meeting, jobId, errorFactory) {
    const expiresAt = new Date(Date.now() + TEMP_UPLOAD_TTL_MS).toISOString();
    const baseSource = {
      captureMode: source.captureMode,
      channelCount: source.channelCount,
      durationMs: source.durationMs,
      expiresAt,
      fileName: source.fileName,
      inlineAudioBase64: "",
      mimeType: source.mimeType,
      mode: normalizeMeetingSourceMode(source.mode || (source.parts.length ? "chunked" : "single")),
      originalSizeBytes: Math.max(source.originalSizeBytes || source.sizeBytes, source.sizeBytes),
      parts: [],
      requestId: normalizeText(source.requestId),
      sizeBytes: source.sizeBytes,
      storageObject: "",
      uploadStatus: "uploaded",
    };
    if (baseSource.mode === "chunked") {
      if (!source.parts.length) {
        throw errorFactory(400, "분할 업로드 part 정보가 없어요.");
      }
      const normalizedParts = source.parts
        .map((part, index) => normalizeMeetingSourcePart(part, index, source.requestId))
        .sort((left, right) => left.index - right.index || left.startMs - right.startMs);
      for (const part of normalizedParts) {
        if (!(part.sizeBytes > 0) || part.sizeBytes > getMeetingSourceTargetPartBytes()) {
          throw errorFactory(400, "분할 업로드 part 크기가 올바르지 않아요.");
        }
      }
      const uploadedPartCount = normalizedParts.filter((part) => normalizeText(part.storageObject)).length;
      return {
        cleanupStorageObjects: [],
        source: {
          ...baseSource,
          parts: normalizedParts.map((part) => ({
            endMs: part.endMs,
            index: part.index,
            mimeType: part.mimeType,
            overlapMs: part.overlapMs || DEFAULT_SOURCE_PART_OVERLAP_MS,
            requestId: part.requestId,
            sizeBytes: part.sizeBytes,
            startMs: part.startMs,
            storageObject: part.storageObject,
            uploadStatus: part.uploadStatus || (part.storageObject ? "uploaded" : "pending_upload"),
          })),
          uploadStatus: uploadedPartCount >= normalizedParts.length
            ? "uploaded"
            : uploadedPartCount > 0
              ? "partial"
              : "pending_upload",
        },
      };
    }

    if (normalizeText(source.storageObject)) {
      return {
        cleanupStorageObjects: [],
        source: {
          ...baseSource,
          storageObject: normalizeText(source.storageObject),
        },
      };
    }

    if (source.inlineAudioBase64) {
      const audioBuffer = await loadSourceAudioBuffer(source);
      if (!audioBuffer.length) {
        throw errorFactory(400, "회의 원본 오디오가 비어 있어요.");
      }
      if (audioBuffer.length > getInlineAudioLimitBytes()) {
        throw errorFactory(
          413,
          `현재 inline 업로드 경로는 ${Math.floor(getInlineAudioLimitBytes() / (1024 * 1024))}MB 이하 녹음만 지원해요.`
        );
      }
      if (!bucket) {
        return {
          cleanupStorageObjects: [],
          source: {
            ...baseSource,
            inlineAudioBase64: source.inlineAudioBase64,
            uploadStatus: "inline-only",
          },
        };
      }
      const storageObject = buildTempStorageObjectPath(owner.providerUserKey, meeting.meetingId, jobId, source.fileName);
      const uploadedSource = await uploadTemporarySource(bucket, storageObject, audioBuffer, baseSource, owner, meeting, jobId);
      if (!normalizeText(uploadedSource?.storageObject)) {
        throw errorFactory(500, "임시 오디오 업로드를 준비하지 못했어요.");
      }
      return {
        cleanupStorageObjects: [storageObject],
        source: {
          ...baseSource,
          storageObject,
          uploadStatus: normalizeText(uploadedSource?.uploadStatus) || "uploaded",
        },
      };
    }

    throw errorFactory(400, "회의 원본 오디오가 없어요.");
  }

  function collectMeetingSourceStorageObjects(source) {
    return Array.from(new Set([
      normalizeText(source?.storageObject),
      ...(Array.isArray(source?.parts) ? source.parts.map((part) => normalizeText(part?.storageObject)) : []),
    ].filter(Boolean)));
  }

  function markMeetingSourceDeleted(source, deletedStorageObjects) {
    const deletedSet = new Set((deletedStorageObjects || []).map((value) => normalizeText(value)).filter(Boolean));
    const nextSource = normalizeMeetingSource(source);
    const hasDeletedSingle = nextSource.storageObject && deletedSet.has(nextSource.storageObject);
    return {
      ...nextSource,
      parts: nextSource.parts.map((part) => ({
        ...part,
        uploadStatus: deletedSet.has(part.storageObject) ? "deleted" : "uploaded",
      })),
      storageObject: nextSource.storageObject,
      uploadStatus: hasDeletedSingle || nextSource.parts.some((part) => deletedSet.has(part.storageObject)) ? "deleted" : nextSource.uploadStatus,
    };
  }

  function mergeMeetingJobPatch(jobInput, patchInput) {
    const job = normalizeMeetingJob(jobInput);
    const patch = patchInput && typeof patchInput === "object" ? patchInput : {};
    return normalizeMeetingJob({
      ...job,
      ...patch,
      cleanup: {
        ...job.cleanup,
        ...(patch.cleanup || {}),
      },
      context: {
        ...job.context,
        ...(patch.context || {}),
      },
      meeting: {
        ...job.meeting,
        ...(patch.meeting || {}),
      },
      progress: {
        ...job.progress,
        ...(patch.progress || {}),
      },
      source: patch.source ? normalizeMeetingSource({ ...job.source, ...patch.source }) : job.source,
      transcript: patch.transcript
        ? {
            ...job.transcript,
            ...(patch.transcript || {}),
          }
        : job.transcript,
      transcription: {
        ...job.transcription,
        ...(patch.transcription || {}),
      },
    });
  }

  function mergeQueuedMeetingSource(existingSourceInput, incomingSourceInput) {
    const existingSource = normalizeMeetingSource(existingSourceInput);
    const incomingSource = normalizeMeetingSource(incomingSourceInput);
    const mergedStorageObject = normalizeText(incomingSource.storageObject) || normalizeText(existingSource.storageObject);
    if (incomingSource.mode !== "chunked") {
      return normalizeMeetingSource({
        ...existingSource,
        ...incomingSource,
        inlineAudioBase64: "",
        requestId: incomingSource.requestId || existingSource.requestId,
        storageObject: mergedStorageObject,
        uploadStatus: normalizeText(incomingSource.uploadStatus)
          || normalizeText(existingSource.uploadStatus)
          || (mergedStorageObject ? "uploaded" : ""),
      });
    }

    const existingByIndex = new Map(
      (Array.isArray(existingSource.parts) ? existingSource.parts : []).map((part) => [Number(part.index), part])
    );
    const mergedParts = (Array.isArray(incomingSource.parts) && incomingSource.parts.length
      ? incomingSource.parts
      : existingSource.parts
    )
      .map((part, index) => {
        const existingPart = existingByIndex.get(Number(part.index) || index);
        const storageObject = normalizeText(part.storageObject) || normalizeText(existingPart?.storageObject);
        return normalizeMeetingSourcePart({
          ...(existingPart || {}),
          ...part,
          requestId: normalizeText(part.requestId) || normalizeText(existingPart?.requestId),
          sizeBytes: Math.max(0, Number(part.sizeBytes) || Number(existingPart?.sizeBytes) || 0),
          storageObject,
          uploadStatus: normalizeText(part.uploadStatus)
            || normalizeText(existingPart?.uploadStatus)
            || (storageObject ? "uploaded" : "pending_upload"),
        }, index, incomingSource.requestId || existingSource.requestId);
      })
      .sort((left, right) => left.index - right.index || left.startMs - right.startMs);
    const uploadedPartCount = mergedParts.filter((part) => normalizeText(part.storageObject)).length;
    return normalizeMeetingSource({
      ...existingSource,
      ...incomingSource,
      inlineAudioBase64: "",
      originalSizeBytes: Math.max(
        Number(existingSource.originalSizeBytes) || 0,
        Number(incomingSource.originalSizeBytes) || 0,
        Number(existingSource.sizeBytes) || 0,
        Number(incomingSource.sizeBytes) || 0
      ),
      parts: mergedParts,
      requestId: incomingSource.requestId || existingSource.requestId,
      storageObject: mergedStorageObject,
      uploadStatus: mergedParts.length
        ? (uploadedPartCount >= mergedParts.length ? "uploaded" : uploadedPartCount > 0 ? "partial" : "pending_upload")
        : normalizeText(incomingSource.uploadStatus)
          || normalizeText(existingSource.uploadStatus)
          || (mergedStorageObject ? "uploaded" : ""),
      sizeBytes: Math.max(
        Number(existingSource.sizeBytes) || 0,
        Number(incomingSource.sizeBytes) || 0,
        Number(existingSource.originalSizeBytes) || 0,
        Number(incomingSource.originalSizeBytes) || 0
      ),
    });
  }

  function hasMeaningfulMeetingSourceUpdate(existingSourceInput, nextSourceInput) {
    return JSON.stringify(normalizeMeetingSource(existingSourceInput))
      !== JSON.stringify(normalizeMeetingSource(nextSourceInput));
  }

  function getMeetingArtifactId(jobId, providerUserKey, meetingId, requestId, targetDb) {
    return normalizeText(requestId)
      ? buildStableMeetingEntityId("meeting-artifact", providerUserKey, meetingId, requestId)
      : targetDb.collection(ARTIFACT_COLLECTION).doc().id;
  }

  async function deleteDocumentIfExists(ref) {
    if (!ref) {
      return false;
    }
    const snapshot = typeof ref.get === "function" ? await ref.get() : null;
    if (snapshot && !snapshot.exists) {
      return false;
    }
    if (typeof ref.delete === "function") {
      await ref.delete();
      return true;
    }
    return false;
  }

  async function loadOwnedMeetingJobs(owner, meetingId) {
    const collection = db.collection(JOB_COLLECTION);
    const normalizedMeetingId = normalizeText(meetingId);
    if (!normalizedMeetingId) {
      return [];
    }
    if (typeof collection.where === "function") {
      const snapshot = await collection
        .where("owner.providerUserKey", "==", owner.providerUserKey)
        .where("meetingId", "==", normalizedMeetingId)
        .get();
      return (Array.isArray(snapshot?.docs) ? snapshot.docs : [])
        .map((doc) => normalizeMeetingJob(doc.data()))
        .filter((job) => normalizeText(job.owner?.providerUserKey) === owner.providerUserKey)
        .filter((job) => normalizeText(job.meetingId) === normalizedMeetingId);
    }
    if (typeof collection.get === "function") {
      const snapshot = await collection.get();
      return (Array.isArray(snapshot?.docs) ? snapshot.docs : [])
        .map((doc) => normalizeMeetingJob(doc.data()))
        .filter((job) => normalizeText(job.owner?.providerUserKey) === owner.providerUserKey)
        .filter((job) => normalizeText(job.meetingId) === normalizedMeetingId);
    }
    return [];
  }

  async function loadOwnedMeetings(owner, limit, cursor) {
    const collection = db.collection(MEETING_COLLECTION);
    const cursorId = normalizeText(cursor);
    if (typeof collection.where === "function") {
      let query = collection
        .where("owner.providerUserKey", "==", owner.providerUserKey)
        .orderBy("updatedAt", "desc")
        .limit(limit);
      if (cursorId && typeof query.startAfter === "function") {
        const cursorSnapshot = await collection.doc(buildMeetingDocId(owner.providerUserKey, cursorId)).get();
        if (cursorSnapshot?.exists) {
          query = query.startAfter(cursorSnapshot);
        }
      }
      const snapshot = await query.get();
      return (Array.isArray(snapshot?.docs) ? snapshot.docs : [])
        .map((doc) => normalizeMeetingSummary(doc.data()))
        .filter((meeting) => normalizeText(meeting.owner?.providerUserKey) === owner.providerUserKey)
        .filter((meeting) => !meeting.deletedAt);
    }

    if (typeof collection.get === "function") {
      const snapshot = await collection.get();
      const items = (Array.isArray(snapshot?.docs) ? snapshot.docs : [])
        .map((doc) => normalizeMeetingSummary(doc.data()))
        .filter((meeting) => normalizeText(meeting.owner?.providerUserKey) === owner.providerUserKey)
        .filter((meeting) => !meeting.deletedAt)
        .sort(compareMeetings);
      if (!cursorId) {
        return items.slice(0, limit);
      }
      const cursorIndex = items.findIndex((meeting) => meeting.meetingId === cursorId);
      return (cursorIndex >= 0 ? items.slice(cursorIndex + 1) : items).slice(0, limit);
    }

    return [];
  }

  async function loadMeetingSummaryRecord(owner, input, createHttpError) {
    const meetingId = normalizeText(input.meetingId);
    if (meetingId) {
      const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, meetingId));
      const snapshot = await meetingRef.get();
      if (!snapshot.exists) {
        return null;
      }
      let meeting = normalizeMeetingSummary(snapshot.data());
      if (!normalizeText(meeting.owner?.providerUserKey)) {
        await meetingRef.set({
          meetingId: meeting.meetingId || meetingId,
          owner,
        }, { merge: true });
        meeting = normalizeMeetingSummary({
          ...meeting,
          meetingId: meeting.meetingId || meetingId,
          owner,
        });
      }
      assertMeetingOwnership(meeting, owner, createHttpError);
      if (meeting.deletedAt) {
        return null;
      }
      return {
        meeting,
        recentJobs: Array.isArray(meeting.recentJobs) ? meeting.recentJobs : [],
      };
    }

    const sessionRef = db.collection(SESSION_COLLECTION).doc(buildSessionDocId(owner.providerUserKey, input.sessionId));
    const snapshot = await sessionRef.get();
    if (!snapshot.exists) {
      return null;
    }
    let legacySession = normalizeMeetingSession(snapshot.data());
    if (!normalizeText(legacySession.owner?.providerUserKey)) {
      await sessionRef.set({
        owner,
        sessionId: legacySession.sessionId || input.sessionId,
      }, { merge: true });
      legacySession = normalizeMeetingSession({
        ...legacySession,
        owner,
        sessionId: legacySession.sessionId || input.sessionId,
      });
    }
    assertSessionOwnership(legacySession, owner, createHttpError);
    if (legacySession.deletedAt) {
      return null;
    }
    return {
      meeting: normalizeMeetingSummary({
        createdAt: legacySession.startedAt,
        endedAt: legacySession.endedAt,
        excerpt: normalizeText(legacySession.recentJobs?.[0]?.previewText),
        language: legacySession.language,
        latestArtifactId: normalizeText(legacySession.recentJobs?.[0]?.artifactId),
        latestJobId: normalizeText(legacySession.lastJobId),
        meetingId: legacySession.sessionId,
        owner: legacySession.owner,
        recentJobs: legacySession.recentJobs,
        sessionId: legacySession.sessionId,
        sharedMemo: legacySession.sharedMemo,
        startedAt: legacySession.startedAt,
        status: normalizeText(legacySession.recentJobs?.[0]?.status),
        title: legacySession.title,
        updatedAt: legacySession.updatedAt,
      }),
      recentJobs: legacySession.recentJobs,
    };
  }

  async function assertMeetingIsActive(owner, meetingId, createHttpError) {
    if (!meetingId) {
      return;
    }
    const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, meetingId));
    const snapshot = await meetingRef.get();
    if (!snapshot.exists) {
      return;
    }
    const meeting = normalizeMeetingSummary(snapshot.data());
    assertMeetingOwnership(meeting, owner, createHttpError);
    if (meeting.deletedAt) {
      throw createHttpError(404, "삭제된 회의예요.");
    }
  }

  async function updateMeetingSummaryRecordTitle(owner, job, title, updatedAt) {
    const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, job.meetingId));
    const meetingSnapshot = await meetingRef.get();
    if (meetingSnapshot.exists) {
      const currentMeeting = normalizeMeetingSummary(meetingSnapshot.data());
      const recentJobs = currentMeeting.recentJobs.map((item) => (
        item.jobId === job.jobId
          ? {
              ...item,
              title,
              updatedAt,
            }
          : item
      ));
      await meetingRef.set(buildMeetingRecentJobsPatch(currentMeeting, recentJobs, updatedAt), { merge: true });
    }

    if (job.sessionId) {
      const sessionRef = db.collection(SESSION_COLLECTION).doc(buildSessionDocId(owner.providerUserKey, job.sessionId));
      const sessionSnapshot = await sessionRef.get();
      if (sessionSnapshot.exists) {
        const currentSession = normalizeMeetingSession(sessionSnapshot.data());
        const recentJobs = currentSession.recentJobs.map((item) => (
          item.jobId === job.jobId
            ? {
                ...item,
                title,
                updatedAt,
              }
            : item
        ));
        await sessionRef.set(buildSessionRecentJobsPatch(currentSession, recentJobs, updatedAt), { merge: true });
      }
    }
  }

  async function removeMeetingResultFromSummaries(owner, job, deletedAt) {
    const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, job.meetingId));
    let nextMeeting = normalizeMeetingSummary({
      meetingId: job.meetingId,
      owner,
      title: job.meeting.title,
      updatedAt: deletedAt,
    });

    const meetingSnapshot = await meetingRef.get();
    if (meetingSnapshot.exists) {
      const currentMeeting = normalizeMeetingSummary(meetingSnapshot.data());
      const recentJobs = currentMeeting.recentJobs.filter((item) => item.jobId !== job.jobId);
      nextMeeting = normalizeMeetingSummary({
        ...currentMeeting,
        ...buildMeetingRecentJobsPatch(currentMeeting, recentJobs, deletedAt),
      });
      await meetingRef.set(buildMeetingRecentJobsPatch(currentMeeting, recentJobs, deletedAt), { merge: true });
    }

    if (job.sessionId) {
      const sessionRef = db.collection(SESSION_COLLECTION).doc(buildSessionDocId(owner.providerUserKey, job.sessionId));
      const sessionSnapshot = await sessionRef.get();
      if (sessionSnapshot.exists) {
        const currentSession = normalizeMeetingSession(sessionSnapshot.data());
        const recentJobs = currentSession.recentJobs.filter((item) => item.jobId !== job.jobId);
        await sessionRef.set(buildSessionRecentJobsPatch(currentSession, recentJobs, deletedAt), { merge: true });
      }
    }

    return nextMeeting;
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

  function getMeetingSummaryModel() {
    return normalizeText(process.env.OPENAI_MEETING_SUMMARY_MODEL)
      || normalizeText(process.env.OPENAI_SUMMARY_MODEL)
      || DEFAULT_SUMMARY_MODEL;
  }

  function getMeetingClassifierModel() {
    return normalizeText(process.env.OPENAI_MEETING_NOTES_CLASSIFIER_MODEL)
      || getMeetingSummaryModel();
  }

  function getMeetingSpeakerReconcileModel() {
    return normalizeText(process.env.OPENAI_MEETING_SPEAKER_RECONCILE_MODEL)
      || getMeetingSummaryModel()
      || DEFAULT_SPEAKER_RECONCILE_MODEL;
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

  function getMeetingChunkWorkerQueueConcurrency(totalParts) {
    const normalizedTotalParts = Math.max(1, Number(totalParts) || 1);
    const requested = Number.parseInt(
      normalizeText(process.env.OPENAI_MEETING_CHUNK_TRANSCRIPTION_CONCURRENCY),
      10
    );
    if (Number.isFinite(requested) && requested > 0) {
      return Math.max(1, Math.min(normalizedTotalParts, requested));
    }
    return normalizedTotalParts;
  }

  function getMeetingChunkTranscriptionConcurrency(totalParts) {
    const normalizedTotalParts = Math.max(1, Number(totalParts) || 1);
    const requested = Number.parseInt(
      normalizeText(process.env.OPENAI_MEETING_CHUNK_TRANSCRIPTION_CONCURRENCY),
      10
    );
    if (Number.isFinite(requested) && requested > 0) {
      return Math.max(1, Math.min(normalizedTotalParts, requested));
    }
    if (normalizedTotalParts <= DEFAULT_IN_PROCESS_CHUNK_TRANSCRIPTION_CONCURRENCY) {
      return normalizedTotalParts;
    }
    const adaptive = Math.max(
      DEFAULT_IN_PROCESS_CHUNK_TRANSCRIPTION_CONCURRENCY,
      Math.ceil(normalizedTotalParts / 2)
    );
    return Math.max(
      1,
      Math.min(
        normalizedTotalParts,
        DEFAULT_IN_PROCESS_CHUNK_TRANSCRIPTION_MAX_CONCURRENCY,
        adaptive
      )
    );
  }

  function getMeetingProcessRetryLimit() {
    const requested = Number.parseInt(
      normalizeText(process.env.OPENAI_MEETING_PROCESS_RETRY_LIMIT),
      10
    );
    const resolved = Number.isFinite(requested) && requested >= 0
      ? requested
      : DEFAULT_MEETING_PROCESS_RETRY_LIMIT;
    return Math.max(0, Math.min(5, resolved));
  }

  function extractMeetingProcessErrorStatus(error) {
    const candidates = [error?.status, error?.statusCode, error?.cause?.status];
    for (const candidate of candidates) {
      const parsed = Number.parseInt(String(candidate || ""), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    const messageStatus = normalizeText(error?.message).match(/\b(408|409|429|500|502|503|504)\b/);
    return messageStatus ? Number.parseInt(messageStatus[1], 10) : 0;
  }

  function extractMeetingProcessRequestId(error) {
    const message = normalizeText(error?.message);
    const match = message.match(/\b(req_[a-zA-Z0-9]+)\b/);
    return match?.[1] || normalizeText(error?.request_id || error?.requestId);
  }

  function isRetryableMeetingProcessError(error) {
    const status = extractMeetingProcessErrorStatus(error);
    if (RETRYABLE_MEETING_PROCESS_STATUSES.has(status)) {
      return true;
    }
    const message = normalizeText(error?.message).toLowerCase();
    if (!message) {
      return false;
    }
    return [
      "server had an error processing your request",
      "temporarily unavailable",
      "timed out",
      "timeout",
      "rate limit",
      "overloaded",
      "socket hang up",
      "connection error",
    ].some((token) => message.includes(token));
  }

  function formatMeetingProcessErrorMessage(error) {
    const rawMessage = normalizeText(error?.message) || "회의 전사를 처리하지 못했어요.";
    const status = extractMeetingProcessErrorStatus(error);
    const requestId = extractMeetingProcessRequestId(error);
    const requestSuffix = requestId ? ` 요청 ID: ${requestId}` : "";
    if (status === 429 || rawMessage.toLowerCase().includes("rate limit")) {
      return `전사 API 요청이 잠시 몰려 있어 처리에 실패했어요. 잠시 후 다시 시도해 주세요.${requestSuffix}`.trim();
    }
    if (RETRYABLE_MEETING_PROCESS_STATUSES.has(status) || rawMessage.toLowerCase().includes("server had an error processing your request")) {
      return `전사 API에서 일시적인 서버 오류가 발생했어요. 다시 시도해 주세요.${requestSuffix}`.trim();
    }
    return rawMessage;
  }

  async function mapWithConcurrency(items, concurrency, worker) {
    const normalizedItems = Array.isArray(items) ? items : [];
    if (!normalizedItems.length) {
      return [];
    }
    const limit = Math.max(1, Math.min(normalizedItems.length, Number(concurrency) || 1));
    const results = new Array(normalizedItems.length);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: limit }, async () => {
        while (cursor < normalizedItems.length) {
          const currentIndex = cursor;
          cursor += 1;
          results[currentIndex] = await worker(normalizedItems[currentIndex], currentIndex);
        }
      })
    );
    return results;
  }

  async function transcribeQueuedMeetingSource(source, meeting, options, owner, jobId, onProgress) {
    const normalizedSource = normalizeMeetingSource(source);
    if (normalizedSource.mode !== "chunked" || !normalizedSource.parts.length) {
      const audioBuffer = await loadSourceAudioBuffer(normalizedSource);
      if (!audioBuffer.length) {
        throw createHttpError(400, "회의 원본 오디오가 비어 있어요.");
      }
      return transcribeMeetingAudio(audioBuffer, meeting, options, normalizedSource);
    }

    const orderedParts = normalizedSource.parts
      .map((part, index) => normalizeMeetingSourcePart(part, index, normalizedSource.requestId))
      .sort((left, right) => left.index - right.index || left.startMs - right.startMs);
    const totalParts = orderedParts.length;
    const transcribeProgressEndPercent = options.speakerLabels ? 64 : 80;
    let completedTranscriptionCount = 0;
    const chunkTranscripts = await mapWithConcurrency(
      orderedParts,
      getMeetingChunkTranscriptionConcurrency(totalParts),
      async (part) => {
        const audioBuffer = await loadMeetingSourcePartAudioBuffer(part);
        const transcript = await transcribeMeetingAudio(
          audioBuffer,
          meeting,
          options,
          {
            captureMode: normalizedSource.captureMode,
            durationMs: Math.max(1, part.endMs - part.startMs),
            fileName: buildMeetingPartFileName(normalizedSource.fileName, part.index),
            mimeType: part.mimeType || normalizedSource.mimeType,
            storageObject: part.storageObject,
          }
        );
        completedTranscriptionCount += 1;
        if (typeof onProgress === "function") {
          await onProgress({
            progress: {
              currentPart: completedTranscriptionCount,
              percent: Math.max(
                8,
                Math.min(
                  transcribeProgressEndPercent,
                  Math.round(8 + (completedTranscriptionCount / totalParts) * (transcribeProgressEndPercent - 8))
                )
              ),
              phase: "transcribing_chunks",
              totalParts,
            },
            updatedAt: new Date().toISOString(),
          });
        }
        return { part, transcript };
      }
    );
    return mergeChunkTranscripts(chunkTranscripts, options, onProgress);
  }

  async function mergeChunkTranscripts(chunkTranscriptsInput, options, onProgress) {
    const chunkTranscripts = Array.isArray(chunkTranscriptsInput) ? chunkTranscriptsInput : [];
    let mergedSegments = [];
    let nextGlobalSpeakerIndex = 0;
    const totalParts = Math.max(1, chunkTranscripts.length);
    const reconcileProgressStartPercent = options.speakerLabels ? 64 : 80;
    const reconcileProgressEndPercent = 80;
    for (const [index, chunk] of chunkTranscripts.entries()) {
      const part = chunk?.part;
      const transcript = chunk?.transcript;
      if (!part || !transcript) {
        continue;
      }
      let adjustedSegments = offsetTranscriptSegments(transcript.segments, part.startMs);
      if (options.speakerLabels) {
        if (!mergedSegments.length) {
          const firstChunkLabels = collectTranscriptSpeakerLabels({ segments: adjustedSegments });
          nextGlobalSpeakerIndex = firstChunkLabels.length;
        } else if (adjustedSegments.length) {
          if (typeof onProgress === "function") {
            await onProgress({
              progress: {
                currentPart: index + 1,
                parallelParts: 0,
                percent: Math.max(
                  reconcileProgressStartPercent,
                  Math.min(
                    reconcileProgressEndPercent,
                    Math.round(
                      reconcileProgressStartPercent
                      + ((index + 1) / totalParts) * (reconcileProgressEndPercent - reconcileProgressStartPercent)
                    )
                  )
                ),
                phase: "reconciling_speakers",
                totalParts,
              },
              updatedAt: new Date().toISOString(),
            });
          }
          const reconciliation = await reconcileChunkSpeakerLabels(mergedSegments, adjustedSegments, nextGlobalSpeakerIndex);
          adjustedSegments = applySpeakerLabelMapping(adjustedSegments, reconciliation.mapping);
          nextGlobalSpeakerIndex = reconciliation.nextGlobalSpeakerIndex;
        }
      }
      mergedSegments = mergeTranscriptSegments(mergedSegments, adjustedSegments, part.overlapMs || DEFAULT_SOURCE_PART_OVERLAP_MS);
    }

    return {
      segments: mergedSegments,
      speakerCount: countTranscriptSpeakers(mergedSegments),
      text: buildTranscriptText(mergedSegments),
    };
  }

  async function loadMeetingSourcePartAudioBuffer(part) {
    if (!bucket || !normalizeText(part?.storageObject)) {
      throw createHttpError(400, "분할 업로드 오디오 원본을 찾지 못했어요.");
    }
    const [buffer] = await bucket.file(part.storageObject).download();
    return buffer;
  }

  async function reconcileChunkSpeakerLabels(existingSegments, currentSegments, nextGlobalSpeakerIndex) {
    const existingTail = Array.isArray(existingSegments) ? existingSegments.slice(-20) : [];
    const currentHead = Array.isArray(currentSegments) ? currentSegments.slice(0, 20) : [];
    const existingLabels = Array.from(collectTranscriptSpeakerLabels({ segments: existingTail }));
    const currentLabels = Array.from(collectTranscriptSpeakerLabels({ segments: currentHead }));
    const mapping = {};
    let nextIndex = Math.max(0, Number(nextGlobalSpeakerIndex) || 0);
    if (!currentLabels.length) {
      return { mapping, nextGlobalSpeakerIndex: nextIndex };
    }
    if (!existingLabels.length) {
      for (const label of currentLabels) {
        mapping[label] = allocateGlobalSpeakerLabel(nextIndex);
        nextIndex += 1;
      }
      return { mapping, nextGlobalSpeakerIndex: nextIndex };
    }

    let suggestedMappings = [];
    try {
      const completion = await getClient().chat.completions.create({
        messages: [
          {
            role: "system",
            content: [
              "너는 회의 전사 화자 정합기다.",
              "이전 chunk의 글로벌 화자 라벨과 현재 chunk의 로컬 화자 라벨을 비교해 같은 사람만 매핑한다.",
              "확신이 부족하면 target을 NEW로 돌리고 confidence를 낮게 준다.",
              "반드시 JSON만 반환한다.",
              "스키마는 {\"mappings\":[{\"localSpeaker\":\"SPEAKER_00\",\"target\":\"SPEAKER_01|NEW\",\"confidence\":0~1,\"reason\":\"짧은 근거\"}]} 이다.",
            ].join(" "),
          },
          {
            role: "user",
            content: buildSpeakerReconcilePrompt(existingTail, currentHead, existingLabels, currentLabels),
          },
        ],
        model: getMeetingSpeakerReconcileModel(),
        response_format: { type: "json_object" },
        temperature: 0,
      });
      suggestedMappings = normalizeSpeakerReconcileMappings(
        safeParseJson(normalizeCompletionContent(completion?.choices?.[0]?.message?.content))?.mappings
      );
    } catch {
      suggestedMappings = [];
    }

    const usedTargets = new Set();
    for (const suggestion of suggestedMappings.sort((left, right) => right.confidence - left.confidence)) {
      const localSpeaker = normalizeText(suggestion.localSpeaker);
      const target = normalizeText(suggestion.target);
      if (!currentLabels.includes(localSpeaker)) continue;
      if (mapping[localSpeaker]) continue;
      if (target === "NEW" || suggestion.confidence < 0.65 || !existingLabels.includes(target) || usedTargets.has(target)) {
        continue;
      }
      mapping[localSpeaker] = target;
      usedTargets.add(target);
    }
    for (const localSpeaker of currentLabels) {
      if (mapping[localSpeaker]) continue;
      mapping[localSpeaker] = allocateGlobalSpeakerLabel(nextIndex);
      nextIndex += 1;
    }
    return {
      mapping,
      nextGlobalSpeakerIndex: nextIndex,
    };
  }

  function buildSpeakerReconcilePrompt(existingSegments, currentSegments, existingLabels, currentLabels) {
    return [
      `기존 글로벌 화자: ${existingLabels.join(", ") || "없음"}`,
      `현재 chunk 로컬 화자: ${currentLabels.join(", ") || "없음"}`,
      "기존 chunk 말미 전사:",
      buildSpeakerReconcileTranscript(existingSegments),
      "현재 chunk 초반 전사:",
      buildSpeakerReconcileTranscript(currentSegments),
    ].join("\n\n");
  }

  function buildSpeakerReconcileTranscript(segments) {
    return (Array.isArray(segments) ? segments : [])
      .map((segment) => `${normalizeText(segment.speakerLabel)} [${segment.startMs}-${segment.endMs}]: ${normalizeText(segment.text)}`)
      .filter(Boolean)
      .join("\n");
  }

  function normalizeSpeakerReconcileMappings(input) {
    return (Array.isArray(input) ? input : []).map((item) => ({
      confidence: normalizeConfidence(item?.confidence),
      localSpeaker: normalizeText(item?.localSpeaker),
      target: normalizeText(item?.target).toUpperCase() === "NEW" ? "NEW" : normalizeText(item?.target),
    }));
  }

  function offsetTranscriptSegments(segments, offsetMs) {
    return (Array.isArray(segments) ? segments : [])
      .map((segment) => ({
        ...segment,
        endMs: Math.max(0, Number(segment.endMs) + Math.max(0, Number(offsetMs) || 0)),
        startMs: Math.max(0, Number(segment.startMs) + Math.max(0, Number(offsetMs) || 0)),
      }))
      .filter((segment) => normalizeText(segment.text));
  }

  function applySpeakerLabelMapping(segments, mapping) {
    const nextMapping = mapping && typeof mapping === "object" ? mapping : {};
    return (Array.isArray(segments) ? segments : []).map((segment) => ({
      ...segment,
      speakerLabel: normalizeText(nextMapping[normalizeText(segment.speakerLabel)]) || normalizeText(segment.speakerLabel),
    }));
  }

  function mergeTranscriptSegments(existingSegments, nextSegments, overlapMs) {
    const merged = Array.isArray(existingSegments) ? existingSegments.slice() : [];
    const overlapStartMs = merged.length
      ? Math.max(0, Number(merged[merged.length - 1]?.endMs) - Math.max(0, Number(overlapMs) || 0))
      : 0;
    for (const segment of Array.isArray(nextSegments) ? nextSegments : []) {
      if (isDuplicateTranscriptSegment(merged, segment, overlapStartMs)) {
        continue;
      }
      merged.push({
        endMs: Math.max(Number(segment.startMs) + 1, Number(segment.endMs) || 0),
        speakerLabel: normalizeText(segment.speakerLabel) || "SPEAKER_00",
        startMs: Math.max(0, Number(segment.startMs) || 0),
        text: normalizeText(segment.text),
      });
    }
    return merged;
  }

  function isDuplicateTranscriptSegment(existingSegments, segment, overlapStartMs) {
    const text = normalizeSegmentComparisonText(segment?.text);
    if (!text) {
      return true;
    }
    if (Number(segment?.startMs) < overlapStartMs) {
      const tail = (Array.isArray(existingSegments) ? existingSegments.slice(-6) : []);
      for (const previous of tail) {
        const previousText = normalizeSegmentComparisonText(previous?.text);
        if (!previousText) continue;
        if (previousText === text) {
          return true;
        }
        if (previousText.includes(text) || text.includes(previousText)) {
          return true;
        }
      }
    }
    return false;
  }

  async function persistMeetingJobPatch(jobRef, meetingRef, sessionRef, meeting, owner, currentJobInput, patch, artifactInput) {
    const storedJob = await loadStoredMeetingJob(jobRef);
    if (!storedJob?.jobId || storedJob.deletedAt) {
      return storedJob || normalizeMeetingJob(currentJobInput);
    }
    const nextJob = mergeMeetingJobPatch(storedJob, patch);
    await Promise.all([
      jobRef.set(patch, { merge: true }),
      upsertMeetingJobSummary(meetingRef, meeting, owner, nextJob, artifactInput),
      sessionRef ? upsertLegacySessionJobSummary(sessionRef, meeting, owner, nextJob, artifactInput) : Promise.resolve(),
    ]);
    return nextJob;
  }

  async function loadStoredMeetingJob(jobRef) {
    if (!jobRef || typeof jobRef.get !== "function") {
      return null;
    }
    const snapshot = await jobRef.get();
    if (!snapshot.exists) {
      return null;
    }
    return normalizeMeetingJob(snapshot.data());
  }

  async function deleteMeetingJobRuntimeArtifacts(jobInput, deletedAt) {
    const job = normalizeMeetingJob(jobInput);
    const jobRef = db.collection(JOB_COLLECTION).doc(job.jobId);
    const artifactIds = Array.from(new Set(collectMeetingArtifactIds(job)));
    const partDocs = await loadMeetingJobPartDocs(job.jobId);
    const storageObjects = Array.from(new Set([
      ...collectMeetingSourceStorageObjects(job.source),
      ...collectMeetingChunkTranscriptStorageObjects(partDocs),
    ]));
    const deletion = await deleteTemporarySourceGroup(bucket, storageObjects);
    await Promise.all([
      ...artifactIds.map((artifactId) => deleteDocumentIfExists(db.collection(ARTIFACT_COLLECTION).doc(artifactId))),
      deleteDocumentIfExists(db.collection(JOB_FINALIZER_COLLECTION).doc(job.jobId)),
      ...partDocs.map((partDoc) => deleteDocumentIfExists(db.collection(JOB_PART_COLLECTION).doc(partDoc.docId))),
    ]);
    await jobRef.set({
      cleanup: {
        deletedAt: deletion.deletedAt,
        sourceAudioDeleted: Boolean(deletion.deletedStorageObjects.length),
      },
      deletedAt,
      error: "",
      progress: {
        currentPart: Math.max(0, Number(job.progress?.currentPart) || 0),
        parallelParts: 0,
        percent: 100,
        phase: "deleted",
        totalParts: Math.max(0, Number(job.progress?.totalParts) || (Array.isArray(job.source?.parts) ? job.source.parts.length : 0)),
      },
      source: markMeetingSourceDeleted(job.source, deletion.deletedStorageObjects),
      status: "deleted",
      updatedAt: deletedAt,
    }, { merge: true });
    return {
      artifactIds,
      deletedStorageObjects: deletion.deletedStorageObjects,
      partCount: partDocs.length,
    };
  }

  async function loadMeetingJobPartDocs(jobId) {
    const snapshot = await db.collection(JOB_PART_COLLECTION).where("jobId", "==", normalizeText(jobId)).get();
    return snapshot.docs
      .map((doc) => ({ ...normalizeMeetingJobPart(doc.data()), docId: doc.id }))
      .sort((left, right) => left.index - right.index || left.part.startMs - right.part.startMs);
  }

  async function upsertQueuedMeetingJobParts(job) {
    const normalizedJob = normalizeMeetingJob(job);
    const existingParts = await loadMeetingJobPartDocs(normalizedJob.jobId);
    const existingByIndex = new Map(existingParts.map((part) => [Number(part.index), part]));
    const concurrency = getMeetingChunkWorkerQueueConcurrency(
      Array.isArray(normalizedJob.source.parts) ? normalizedJob.source.parts.length : 0
    );
    let activeSlotCount = existingParts.filter((part) => ["processing", "queued"].includes(normalizeText(part.status))).length;
    const batch = db.batch();
    const queuedAt = new Date().toISOString();
    const expectedIndexes = new Set();
    for (const sourcePart of normalizedJob.source.parts) {
      const index = Math.max(0, Number(sourcePart.index) || 0);
      expectedIndexes.add(index);
      const partRef = db.collection(JOB_PART_COLLECTION).doc(buildMeetingJobPartId(normalizedJob.jobId, index));
      const existingPart = existingByIndex.get(index);
      const existingStatus = normalizeText(existingPart?.status);
      const existingTranscriptStorageObject = normalizeText(existingPart?.transcript?.storageObject);
      const isSameSource = normalizeText(existingPart?.jobId) === normalizedJob.jobId
        && Number(existingPart?.index) === index
        && normalizeText(existingPart?.part?.storageObject) === normalizeText(sourcePart?.storageObject);
      const canReuseTranscript = isSameSource
        && existingTranscriptStorageObject
        && existingStatus === "succeeded";
      let nextStatus = "pending_upload";
      if (canReuseTranscript) {
        nextStatus = "succeeded";
      } else if (isSameSource && ["processing", "queued"].includes(existingStatus)) {
        nextStatus = existingStatus;
      } else if (isSameSource && existingStatus === "failed") {
        nextStatus = "failed";
      } else if (normalizeText(sourcePart?.storageObject)) {
        if (activeSlotCount < concurrency) {
          nextStatus = "queued";
          activeSlotCount += 1;
        } else {
          nextStatus = "waiting";
        }
      }
      const queuedPart = buildQueuedMeetingJobPart(
        normalizedJob,
        sourcePart,
        queuedAt,
        existingPart,
        nextStatus
      );
      batch.set(partRef, queuedPart);
    }
    for (const existingPart of existingParts) {
      if (!expectedIndexes.has(Number(existingPart.index))) {
        batch.delete(db.collection(JOB_PART_COLLECTION).doc(existingPart.docId));
      }
    }
    await batch.commit();
    return loadMeetingJobPartDocs(normalizedJob.jobId);
  }

  async function promoteWaitingMeetingJobParts(job, existingPartDocsInput) {
    const normalizedJob = normalizeMeetingJob(job);
    if (!normalizedJob.jobId) {
      return [];
    }
    const existingPartDocs = Array.isArray(existingPartDocsInput) && existingPartDocsInput.length
      ? existingPartDocsInput
      : await loadMeetingJobPartDocs(normalizedJob.jobId);
    const totalParts = existingPartDocs.length
      || Math.max(0, Array.isArray(normalizedJob.source.parts) ? normalizedJob.source.parts.length : 0);
    const concurrency = getMeetingChunkWorkerQueueConcurrency(totalParts);
    const processingCount = existingPartDocs.filter((part) => part.status === "processing").length;
    const queuedCount = existingPartDocs.filter((part) => part.status === "queued").length;
    const availableSlots = Math.max(0, concurrency - processingCount - queuedCount);
    if (availableSlots <= 0) {
      return existingPartDocs;
    }
    const waitingParts = existingPartDocs
      .filter((part) => part.status === "waiting")
      .sort((left, right) => left.index - right.index || left.part.startMs - right.part.startMs)
      .slice(0, availableSlots);
    if (!waitingParts.length) {
      return existingPartDocs;
    }
    const batch = db.batch();
    const queuedAt = new Date().toISOString();
    for (const waitingPart of waitingParts) {
      batch.set(
        db.collection(JOB_PART_COLLECTION).doc(waitingPart.docId),
        {
          error: "",
          queuedAt,
          status: "queued",
          updatedAt: queuedAt,
        },
        { merge: true }
      );
    }
    await batch.commit();
    return loadMeetingJobPartDocs(normalizedJob.jobId);
  }

  async function synchronizeChunkedMeetingJobProgress(jobRef, meetingRef, sessionRef, meeting, owner, currentJobInput, options, overridePatch) {
    const currentJob = normalizeMeetingJob(currentJobInput);
    const partDocs = await loadMeetingJobPartDocs(currentJob.jobId);
    const totalParts = Math.max(
      0,
      partDocs.length || Number(currentJob.progress?.totalParts) || (Array.isArray(currentJob.source?.parts) ? currentJob.source.parts.length : 0)
    );
    const processingCount = partDocs.filter((part) => part.status === "processing").length;
    const succeededCount = partDocs.filter((part) => part.status === "succeeded").length;
    const failedCount = partDocs.filter((part) => part.status === "failed").length;
    const queuedCount = partDocs.filter((part) => part.status === "queued").length;
    const transcribeProgressEndPercent = options.speakerLabels ? 64 : 80;
    const isFullyTranscribed = totalParts > 0 && succeededCount >= totalParts;
    const defaultPatch = {
      progress: {
        currentPart: succeededCount,
        parallelParts: processingCount,
        percent: isFullyTranscribed
          ? 80
          : Math.max(
              8,
              Math.min(
                transcribeProgressEndPercent,
                Math.round(8 + ((totalParts > 0 ? succeededCount / totalParts : 0) * (transcribeProgressEndPercent - 8)))
              )
            ),
        phase: failedCount > 0
          ? "failed"
          : isFullyTranscribed
            ? "assembling_transcript"
            : "transcribing_chunks",
        totalParts,
      },
      updatedAt: new Date().toISOString(),
    };
    const patch = {
      ...defaultPatch,
      ...(overridePatch || {}),
      progress: {
        ...defaultPatch.progress,
        ...((overridePatch && overridePatch.progress) || {}),
      },
    };
    const nextJob = await persistMeetingJobPatch(
      jobRef,
      meetingRef,
      sessionRef,
      meeting,
      owner,
      currentJob,
      patch
    );
    return {
      currentJob: nextJob,
      failedCount,
      isFullyTranscribed,
      partDocs,
      processingCount,
      queuedCount,
      succeededCount,
      totalParts,
    };
  }

  async function maybeQueueMeetingJobFinalizer(job, existingFinalizerInput) {
    const normalizedJob = normalizeMeetingJob(job);
    if (!normalizedJob.jobId || normalizedJob.deletedAt) {
      return false;
    }
    const jobRef = db.collection(JOB_COLLECTION).doc(normalizedJob.jobId);
    const storedJob = await loadStoredMeetingJob(jobRef);
    if (!storedJob?.jobId || storedJob.deletedAt) {
      return false;
    }
    const finalizerRef = db.collection(JOB_FINALIZER_COLLECTION).doc(storedJob.jobId);
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(finalizerRef);
      const currentFinalizer = snapshot.exists
        ? normalizeMeetingJobFinalizer(snapshot.data())
        : normalizeMeetingJobFinalizer(existingFinalizerInput);
      if (["queued", "processing", "succeeded"].includes(currentFinalizer.status)) {
        return false;
      }
      const queuedAt = new Date().toISOString();
      transaction.set(finalizerRef, buildQueuedMeetingJobFinalizer(storedJob, queuedAt, currentFinalizer));
      return true;
    });
  }

  function collectMeetingChunkTranscriptStorageObjects(partDocs) {
    return Array.from(new Set(
      (Array.isArray(partDocs) ? partDocs : [])
        .map((part) => normalizeText(part?.transcript?.storageObject))
        .filter(Boolean)
    ));
  }

  async function saveMeetingChunkTranscript(targetBucket, storageObject, transcript, owner, meeting, jobId, partIndex) {
    if (!targetBucket || !storageObject) {
      throw createHttpError(500, "청크 전사 결과를 저장할 bucket이 설정되지 않았어요.");
    }
    const payload = Buffer.from(JSON.stringify({
      segments: Array.isArray(transcript?.segments) ? transcript.segments : [],
      speakerCount: Math.max(0, Number(transcript?.speakerCount) || 0),
      text: normalizeText(transcript?.text),
    }), "utf8");
    await targetBucket.file(storageObject).save(payload, {
      contentType: "application/json; charset=utf-8",
      metadata: {
        metadata: {
          jobId,
          meetingId: meeting.meetingId,
          partIndex: String(Math.max(0, Number(partIndex) || 0)),
          providerUserKey: owner.providerUserKey,
        },
      },
      resumable: false,
    });
    return {
      segmentCount: Array.isArray(transcript?.segments) ? transcript.segments.length : 0,
      speakerCount: Math.max(0, Number(transcript?.speakerCount) || 0),
      storageObject,
      textLength: normalizeText(transcript?.text).length,
    };
  }

  async function loadMeetingChunkTranscript(targetBucket, storageObject) {
    if (!targetBucket || !storageObject) {
      throw createHttpError(400, "청크 전사 결과 storageObject가 없어요.");
    }
    const [buffer] = await targetBucket.file(storageObject).download();
    const parsed = JSON.parse(Buffer.from(buffer).toString("utf8"));
    const segments = Array.isArray(parsed?.segments) ? parsed.segments.map(normalizeTranscriptSegment) : [];
    const text = normalizeText(parsed?.text);
    return {
      segments,
      speakerCount: Math.max(0, Number(parsed?.speakerCount) || countTranscriptSpeakers(segments)),
      text,
    };
  }

  function normalizeSegmentComparisonText(value) {
    return normalizeText(value).replace(/\s+/g, " ").toLowerCase();
  }

  function buildTranscriptText(segments) {
    return (Array.isArray(segments) ? segments : [])
      .map((segment) => `${normalizeText(segment.speakerLabel) || "SPEAKER_00"}: ${normalizeText(segment.text)}`)
      .filter(Boolean)
      .join(" ");
  }

  function allocateGlobalSpeakerLabel(index) {
    return `SPEAKER_${String(Math.max(0, Number(index) || 0)).padStart(2, "0")}`;
  }

  function buildMeetingPartFileName(fileName, partIndex) {
    const normalizedFileName = normalizeText(fileName) || "meeting-source.wav";
    const extensionMatch = normalizedFileName.match(/(\.[^.]+)$/);
    const extension = extensionMatch?.[1] || ".wav";
    const baseName = extensionMatch ? normalizedFileName.slice(0, -extension.length) : normalizedFileName;
    return `${baseName}-part-${String(Math.max(0, Number(partIndex) || 0)).padStart(3, "0")}${extension}`;
  }

  async function maybeGenerateMeetingNotes(transcript, meeting, options, context, logEvent, owner, jobId) {
    if (!options.summary) {
      return createEmptyMeetingNotesBundle(null, null, null, "disabled");
    }
    try {
      return await generateMeetingNotesBundle(transcript, meeting, context);
    } catch (error) {
      logEvent("meeting.notes.skipped", {
        error: normalizeText(error?.message),
        jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });
      return createEmptyMeetingNotesBundle(
        null,
        null,
        null,
        "degraded",
        normalizeText(error?.message) || "회의록 자동 정리에 실패했어요."
      );
    }
  }

  async function generateMeetingNotesBundle(transcript, meeting, context, selectedMode, selectedStyle) {
    const promptTranscript = buildMeetingNotesTranscriptPrompt(transcript);
    if (!promptTranscript) {
      return createEmptyMeetingNotesBundle(selectedMode, null, selectedStyle, "skipped");
    }
    const detectedMode = await detectMeetingNotesMode(transcript, meeting, context);
    const notesModeSelected = normalizeMeetingNotesMode(selectedMode)
      || detectedMode.notesModeDetected
      || DEFAULT_NOTES_MODE;
    const notesStyleSelected = normalizeMeetingNotesStyle(selectedStyle) || DEFAULT_NOTES_STYLE;
    const completion = await getClient().chat.completions.create({
      messages: [
        {
          role: "system",
          content: buildMeetingNotesSystemPrompt(notesModeSelected, notesStyleSelected),
        },
        {
          role: "user",
          content: buildMeetingNotesUserPrompt(transcript, meeting, context, notesModeSelected, notesStyleSelected),
        },
      ],
      model: getMeetingSummaryModel(),
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const content = normalizeCompletionContent(completion?.choices?.[0]?.message?.content);
    if (!content) {
      return createEmptyMeetingNotesBundle(notesModeSelected, detectedMode, notesStyleSelected, "skipped");
    }
    return {
      notes: normalizeMeetingNotes(parseMeetingNotesJson(content), notesModeSelected),
      notesDegradedReason: "",
      notesGeneratedAt: new Date().toISOString(),
      notesModeConfidence: normalizeConfidence(detectedMode.notesModeConfidence),
      notesModeDetected: normalizeMeetingNotesMode(detectedMode.notesModeDetected) || DEFAULT_NOTES_MODE,
      notesModeSelected,
      notesStatus: "succeeded",
      notesStyleSelected,
      notesSchemaVersion: NOTES_SCHEMA_VERSION,
    };
  }

  async function detectMeetingNotesMode(transcript, meeting, context) {
    const promptTranscript = buildMeetingNotesTranscriptPrompt(transcript);
    if (!promptTranscript) {
      return {
        notesModeConfidence: 0,
        notesModeDetected: DEFAULT_NOTES_MODE,
      };
    }
    try {
      const completion = await getClient().chat.completions.create({
        messages: [
          {
            role: "system",
            content: [
              "너는 한국어 회의 전사 분류기다.",
              "전사와 회의 제목, 공용 메모를 바탕으로 가장 적절한 회의록 정리 방식 하나를 고른다.",
              "허용 mode는 general, interview, review, planning 뿐이다.",
              "반드시 JSON만 반환한다.",
              "스키마는 {\"mode\":\"general|interview|review|planning\",\"confidence\":0~1,\"reason\":\"짧은 설명\"} 이다.",
            ].join(" "),
          },
          {
            role: "user",
            content: buildMeetingNotesClassifierPrompt(transcript, meeting, context),
          },
        ],
        model: getMeetingClassifierModel(),
        response_format: { type: "json_object" },
        temperature: 0,
      });
      const parsed = parseMeetingNotesModeJson(normalizeCompletionContent(completion?.choices?.[0]?.message?.content));
      return {
        notesModeConfidence: parsed.confidence,
        notesModeDetected: parsed.mode,
      };
    } catch {
      return heuristicallyDetectMeetingNotesMode(transcript, meeting, context);
    }
  }

  function heuristicallyDetectMeetingNotesMode(transcript, meeting, context) {
    const corpus = [
      normalizeText(meeting?.title),
      normalizeTextBlock(context?.sharedMemoSnapshot),
      buildMeetingNotesTranscriptPrompt(transcript),
    ].join("\n").toLowerCase();
    if (/(면접|인터뷰|후보자|지원자|질문\s*답변|candidate)/.test(corpus)) {
      return { notesModeConfidence: 0.72, notesModeDetected: "interview" };
    }
    if (/(회고|리뷰|retrospective|버그|문제점|개선|장애|원인)/.test(corpus)) {
      return { notesModeConfidence: 0.7, notesModeDetected: "review" };
    }
    if (/(계획|플랜|roadmap|로드맵|일정|마일스톤|범위|우선순위|의존성)/.test(corpus)) {
      return { notesModeConfidence: 0.68, notesModeDetected: "planning" };
    }
    return { notesModeConfidence: 0.55, notesModeDetected: DEFAULT_NOTES_MODE };
  }

  function buildMeetingNotesClassifierPrompt(transcript, meeting, context) {
    return [
      `회의 제목: ${normalizeText(meeting?.title) || "미정"}`,
      `언어: ${normalizeText(meeting?.language) || "ko"}`,
      `공용 메모: ${normalizeTextBlock(context?.sharedMemoSnapshot) || "없음"}`,
      "아래 전사를 보고 가장 적절한 회의록 정리 mode 하나를 고르세요.",
      buildMeetingNotesTranscriptPrompt(transcript),
    ].join("\n\n");
  }

  function buildMeetingNotesSystemPrompt(notesMode, notesStyle) {
    const mode = normalizeMeetingNotesMode(notesMode) || DEFAULT_NOTES_MODE;
    const style = normalizeMeetingNotesStyle(notesStyle) || DEFAULT_NOTES_STYLE;
    const modeInstructionMap = {
      general: "일반 회의는 핵심 결론, 토픽별 정리, 결정사항, 액션, 미해결 질문, 리스크를 우선 정리한다.",
      interview: "인터뷰는 핵심 인사이트, 답변 요약, 강점, 우려, 후속 질문을 우선 정리한다.",
      planning: "계획 회의는 목표, 범위, 일정, 의존성, 결정, 액션을 우선 정리한다.",
      review: "리뷰/회고는 잘된 점, 문제점, 원인, 개선안, 리스크, 액션을 우선 정리한다.",
    };
    const styleInstructionMap = {
      action: "표현 방식이 실행 중심이면 결정사항, 액션 아이템, 리스크를 더 앞에 두고 문장을 단호하고 짧게 쓴다.",
      brief: "표현 방식이 간결 브리프면 항목 수를 줄이고 한 줄 요약 위주로 짧게 정리한다.",
      default: "표현 방식이 기본 회의록이면 중립적인 회의록 문체를 유지하고 설명 길이를 과하게 줄이지 않는다.",
    };
    return [
      "너는 한국어 회의록 작성자다.",
      "주어진 전사와 공용 메모만 근거로 구조화된 회의록 JSON을 만든다.",
      "추측하지 말고, 알 수 없으면 빈 문자열, 빈 배열, confidence가 낮은 항목으로 남긴다.",
      "사실은 전사 우선, 강조/의도는 공용 메모를 보조 근거로 사용한다.",
      "전사와 메모가 충돌하면 단정하지 말고 openQuestions 또는 sourceTrace에 남긴다.",
      "전문가 자문, 전략 평가, 타당성 판단처럼 들리는 표현은 피하고 회의에서 실제 언급된 내용만 중립적으로 정리한다.",
      "전사에 없는 결론, 추천, 당위, 우선순위 판단을 새로 만들지 않는다.",
      "각 문장은 가능하면 '논의되었다', '언급되었다', '검토가 필요하다'처럼 중립 표현을 사용한다.",
      "actionItems에는 전사나 메모에 실제로 나온 행동만 적고, 담당자나 기한이 없으면 임의로 만들지 않는다.",
      "topics와 executiveSummary는 회의 내용을 business meeting minutes처럼 구조적으로 요약하되, 잘 되었다/옳다/필수다 같은 평가형 문장은 피한다.",
      "결과는 상용 회의록 SaaS처럼 섹션이 분명한 한국어 회의 정리 톤으로 쓰되, 회의에서 실제로 언급된 내용만 근거로 사용한다.",
      "executiveSummary는 2~4개 항목까지 허용하고, 회의 배경, 핵심 논의, 결정된 내용, 남은 쟁점, 다음 단계 중 중요한 것을 우선 담는다.",
      "meetingMeta.purpose는 이 회의가 왜 열렸고 무엇을 검토·결정하려 했는지 2~4문장 안에서 회의 개요처럼 정리한다.",
      "topics[].topic은 짧은 주제명만 적고 문장형 설명이나 중간 구분점(예: ·, /)을 길게 이어 붙이지 않는다.",
      "topics[].summary는 해당 주제에서 실제로 논의된 배경, 쟁점, 맥락이 드러나도록 2~4문장까지 허용한다.",
      "topics[].keyPoints는 각각 독립된 항목으로 나누고, 필요하면 비즈니스 판단이나 논의 포인트가 읽히도록 한 줄 문장으로 적는다.",
      "speakerSummaries[]는 화자별로 주로 언급한 내용을 중립적으로 정리하는 배열이다.",
      "speakerSummaries[]는 {speakerLabel, summary, keyPoints} 형식이다.",
      "speakerSummaries[].speakerLabel은 전사에 나온 원래 화자 라벨을 그대로 사용한다. 예: SPEAKER_00",
      "speakerSummaries[].summary는 해당 화자가 주로 말한 내용을 1~2문장으로만 적고, 다른 화자의 발언을 섞지 않는다.",
      "speakerSummaries[].keyPoints는 해당 화자가 실제로 언급한 포인트만 짧게 나눈다.",
      `선택된 mode는 ${mode} 이다. ${modeInstructionMap[mode] || modeInstructionMap.general}`,
      `선택된 style은 ${style} 이다. ${styleInstructionMap[style] || styleInstructionMap.default}`,
      "반드시 JSON만 반환한다.",
      "스키마는 meetingMeta, executiveSummary, topics, decisions, actionItems, openQuestions, risksOrDependencies, speakerSummaries, memoHighlights, sourceTrace, modeSpecific 이다.",
      "topics[]는 {topic, summary, keyPoints, decisions, openQuestions, source:{transcript,memo}} 형식이다.",
      "decisions[]는 {text, owner, confidence} 형식이다.",
      "actionItems[]는 {task, assignee, dueDate, status, source} 형식이다.",
      "openQuestions[]는 짧은 문자열 배열로 작성하되, 아직 확정되지 않은 의사결정 항목이나 추가 검토 필요 사항도 포함할 수 있다.",
      "risksOrDependencies[]는 {text, severity} 형식이고, 리스크, 제약, 선행조건, 외부 의존성, 현실적인 난점을 담는다.",
      "meetingMeta.title은 이 기록을 구분할 짧고 구체적인 한국어 제목 한 줄로 작성한다.",
      "meetingMeta.title은 범용적인 '회의', '회의록', '미팅'만 단독으로 쓰지 말고 핵심 주제를 드러낸다.",
      "meetingMeta.participants는 전사나 메모에서 확인 가능한 참여자만 적고, 확실하지 않으면 비워 둔다.",
      "memoHighlights[]는 {text, linkedTopic, mergeStatus} 형식이다.",
      "sourceTrace[]는 {itemType, itemRef, evidence} 형식이다.",
      "modeSpecific은 mode별 추가 필드만 포함한다.",
    ].join(" ");
  }

function buildMeetingNotesUserPrompt(transcript, meeting, context, notesMode, notesStyle) {
  return [
    `회의 제목: ${normalizeText(meeting?.title) || "미정"}`,
    `언어: ${normalizeText(meeting?.language) || "ko"}`,
    `정리 형식(내부 판단): ${normalizeMeetingNotesMode(notesMode) || DEFAULT_NOTES_MODE}`,
    `표현 방식: ${normalizeMeetingNotesStyle(notesStyle) || DEFAULT_NOTES_STYLE}`,
    `공용 메모: ${normalizeTextBlock(context?.sharedMemoSnapshot) || "없음"}`,
    buildMeetingNotesSpeakerGuide(transcript),
    "아래 전사를 기반으로 회의록을 정리해 주세요.",
    buildMeetingNotesTranscriptPrompt(transcript),
  ].join("\n\n");
}
}

function normalizeMeetingRequest(input) {
  return {
    endedAt: normalizeText(input?.endedAt),
    language: normalizeText(input?.language) || "ko",
    meetingId: normalizeText(input?.meetingId || input?.sessionId),
    sessionId: normalizeText(input?.sessionId),
    sharedMemo: normalizeTextBlock(input?.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
    sourceTabId: Math.max(0, Number(input?.sourceTabId) || 0),
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
  const normalizedRequestId = normalizeText(input?.requestId);
  return {
    captureMode: ALLOWED_CAPTURE_MODES.has(captureMode) ? captureMode : "",
    channelCount: Math.max(0, Number(input?.channelCount) || 0),
    durationMs: Math.max(0, Number(input?.durationMs) || 0),
    fileName: normalizeText(input?.fileName) || buildDefaultFileName(input?.mimeType),
    inlineAudioBase64: normalizeText(input?.inlineAudioBase64),
    mimeType: normalizeText(input?.mimeType),
    mode: normalizeMeetingSourceMode(input?.mode),
    originalSizeBytes: Math.max(0, Number(input?.originalSizeBytes) || Number(input?.sizeBytes) || 0),
    parts: normalizeMeetingSourceParts(input?.parts, normalizedRequestId),
    requestId: normalizedRequestId,
    sizeBytes: Math.max(0, Number(input?.sizeBytes) || 0),
    storageObject: normalizeText(input?.storageObject),
    uploadStatus: normalizeText(input?.uploadStatus) || "",
  };
}

function normalizeMeetingSourceUploadRequest(request) {
  const query = request && typeof request.query === "object" ? request.query : {};
  const captureMode = normalizeText(query.captureMode);
  const headerMimeType = normalizeText(request?.headers?.["content-type"]);
  return {
    captureMode: ALLOWED_CAPTURE_MODES.has(captureMode) ? captureMode : "",
    channelCount: Math.max(0, Number(query.channelCount) || 0),
    durationMs: Math.max(0, Number(query.durationMs) || 0),
    fileName: normalizeText(query.fileName) || buildDefaultFileName(headerMimeType || query.mimeType),
    meetingId: normalizeText(query.meetingId),
    mimeType: headerMimeType || normalizeText(query.mimeType),
    overlapMs: Math.max(0, Number(query.overlapMs) || 0),
    parentRequestId: normalizeText(query.parentRequestId || query.requestId),
    partCount: Math.max(0, Number(query.partCount) || 0),
    partIndex: Math.max(0, Number(query.partIndex) || 0),
    requestId: normalizeText(query.requestId),
    startMs: Math.max(0, Number(query.startMs) || 0),
    endMs: Math.max(0, Number(query.endMs) || 0),
    sizeBytes: Math.max(0, Number(query.sizeBytes) || 0),
  };
}

function normalizeMeetingSourceMode(value) {
  const normalized = normalizeText(value);
  return normalized === "chunked" ? "chunked" : "single";
}

function normalizeMeetingSourceParts(parts, fallbackRequestId) {
  return (Array.isArray(parts) ? parts : [])
    .map((part, index) => normalizeMeetingSourcePart(part, index, fallbackRequestId))
    .filter((part) => part.requestId);
}

function normalizeMeetingSourcePart(input, index, fallbackRequestId) {
  const part = input && typeof input === "object" ? input : {};
  const requestId = normalizeText(part.requestId) || `${normalizeText(fallbackRequestId) || "meeting-source"}-part-${index}`;
  const startMs = Math.max(0, Number(part.startMs) || 0);
  const endMs = Math.max(startMs, Number(part.endMs) || startMs);
  return {
    endMs,
    index: Math.max(0, Number(part.index) || index),
    mimeType: normalizeText(part.mimeType) || "audio/wav",
    overlapMs: Math.max(0, Number(part.overlapMs) || 0),
    requestId,
    sizeBytes: Math.max(0, Number(part.sizeBytes) || 0),
    startMs,
    storageObject: normalizeText(part.storageObject),
    uploadStatus: normalizeText(part.uploadStatus) || (normalizeText(part.storageObject) ? "uploaded" : ""),
  };
}

function normalizeMeetingJobPart(input) {
  const part = input && typeof input === "object" ? input : {};
  const jobId = normalizeText(part.jobId);
  const normalizedPart = normalizeMeetingSourcePart(part.part, Number(part.index) || 0, part.requestId || jobId);
  return {
    error: normalizeText(part.error),
    index: normalizedPart.index,
    jobId,
    meetingId: normalizeText(part.meetingId),
    owner: part.owner && typeof part.owner === "object" ? { ...part.owner } : {},
    part: normalizedPart,
    queuedAt: normalizeText(part.queuedAt),
    retry: {
      count: Math.max(0, Number(part.retry?.count) || 0),
      lastError: normalizeText(part.retry?.lastError),
      lastRetriedAt: normalizeText(part.retry?.lastRetriedAt),
    },
    status: normalizeText(part.status),
    transcript: {
      segmentCount: Math.max(0, Number(part.transcript?.segmentCount) || 0),
      speakerCount: Math.max(0, Number(part.transcript?.speakerCount) || 0),
      storageObject: normalizeText(part.transcript?.storageObject),
      textLength: Math.max(0, Number(part.transcript?.textLength) || 0),
    },
    updatedAt: normalizeText(part.updatedAt),
  };
}

function buildQueuedMeetingJobPart(job, partInput, queuedAt, existingPartInput, nextStatusInput) {
  const normalizedJob = normalizeMeetingJob(job);
  const normalizedPart = normalizeMeetingSourcePart(
    partInput,
    Number(partInput?.index) || 0,
    normalizedJob.source?.requestId || normalizedJob.jobId
  );
  const existingPart = normalizeMeetingJobPart(existingPartInput);
  const existingStatus = normalizeText(existingPart.status);
  const normalizedNextStatus = normalizeText(nextStatusInput) || "pending_upload";
  const isSameSource = normalizeText(existingPart.jobId) === normalizedJob.jobId
    && Number(existingPart.index) === Number(normalizedPart.index)
    && normalizeText(existingPart.part?.storageObject) === normalizeText(normalizedPart.storageObject);
  const canReuseTranscript = isSameSource
    && normalizeText(existingPart.transcript?.storageObject)
    && existingStatus === "succeeded";
  const shouldPreserveExistingState = isSameSource
    && ["failed", "processing", "queued"].includes(existingStatus)
    && existingStatus === normalizedNextStatus;
  const shouldPreserveRetry = canReuseTranscript || shouldPreserveExistingState;
  return {
    error: shouldPreserveExistingState ? normalizeText(existingPart.error) : "",
    index: normalizedPart.index,
    jobId: normalizedJob.jobId,
    meetingId: normalizedJob.meetingId,
    owner: normalizedJob.owner && typeof normalizedJob.owner === "object" ? { ...normalizedJob.owner } : {},
    part: normalizedPart,
    queuedAt: shouldPreserveExistingState ? normalizeText(existingPart.queuedAt || queuedAt) : queuedAt,
    retry: {
      count: shouldPreserveRetry ? Math.max(0, Number(existingPart.retry?.count) || 0) : 0,
      lastError: shouldPreserveExistingState ? normalizeText(existingPart.retry?.lastError) : "",
      lastRetriedAt: shouldPreserveRetry ? normalizeText(existingPart.retry?.lastRetriedAt) : "",
    },
    status: canReuseTranscript ? "succeeded" : normalizedNextStatus,
    transcript: canReuseTranscript || shouldPreserveExistingState
      ? {
          segmentCount: Math.max(0, Number(existingPart.transcript?.segmentCount) || 0),
          speakerCount: Math.max(0, Number(existingPart.transcript?.speakerCount) || 0),
          storageObject: normalizeText(existingPart.transcript?.storageObject),
          textLength: Math.max(0, Number(existingPart.transcript?.textLength) || 0),
        }
      : {
          segmentCount: 0,
          speakerCount: 0,
          storageObject: "",
          textLength: 0,
        },
    updatedAt: canReuseTranscript || shouldPreserveExistingState ? normalizeText(existingPart.updatedAt || queuedAt) : queuedAt,
  };
}

function normalizeMeetingJobFinalizer(input) {
  const finalizer = input && typeof input === "object" ? input : {};
  return {
    error: normalizeText(finalizer.error),
    jobId: normalizeText(finalizer.jobId),
    meetingId: normalizeText(finalizer.meetingId),
    owner: finalizer.owner && typeof finalizer.owner === "object" ? { ...finalizer.owner } : {},
    queuedAt: normalizeText(finalizer.queuedAt),
    retry: {
      count: Math.max(0, Number(finalizer.retry?.count) || 0),
      lastError: normalizeText(finalizer.retry?.lastError),
      lastRetriedAt: normalizeText(finalizer.retry?.lastRetriedAt),
    },
    status: normalizeText(finalizer.status),
    updatedAt: normalizeText(finalizer.updatedAt),
  };
}

function buildQueuedMeetingJobFinalizer(job, queuedAt, existingFinalizerInput) {
  const normalizedJob = normalizeMeetingJob(job);
  const existingFinalizer = normalizeMeetingJobFinalizer(existingFinalizerInput);
  return {
    error: "",
    jobId: normalizedJob.jobId,
    meetingId: normalizedJob.meetingId,
    owner: normalizedJob.owner && typeof normalizedJob.owner === "object" ? { ...normalizedJob.owner } : {},
    queuedAt,
    retry: {
      count: Math.max(0, Number(existingFinalizer.retry?.count) || 0),
      lastError: "",
      lastRetriedAt: normalizeText(existingFinalizer.retry?.lastRetriedAt),
    },
    status: "queued",
    updatedAt: queuedAt,
  };
}

function normalizeMeetingContext(input) {
  return {
    sharedMemoSnapshot: normalizeTextBlock(input?.sharedMemoSnapshot).slice(0, MAX_SHARED_MEMO_CHARS),
  };
}

function createEmptyMeetingNotes() {
  return {
    actionItems: [],
    decisions: [],
    executiveSummary: [],
    meetingMeta: {
      datetime: "",
      participants: [],
      purpose: "",
      title: "",
      version: `v${NOTES_SCHEMA_VERSION}`,
    },
    memoHighlights: [],
    mode: DEFAULT_NOTES_MODE,
    modeSpecific: {},
    openQuestions: [],
    risksOrDependencies: [],
    speakerSummaries: [],
    sourceTrace: [],
    topics: [],
  };
}

function createEmptyMeetingNotesBundle(selectedMode, detectedMode, selectedStyle, statusInput, degradedReasonInput) {
  const selected = normalizeMeetingNotesMode(selectedMode) || normalizeMeetingNotesMode(detectedMode?.notesModeDetected) || DEFAULT_NOTES_MODE;
  const notesStyleSelected = normalizeMeetingNotesStyle(selectedStyle) || DEFAULT_NOTES_STYLE;
  return {
    notes: normalizeMeetingNotes({
      meetingMeta: {
        version: `v${NOTES_SCHEMA_VERSION}`,
      },
      mode: selected,
    }, selected),
    notesDegradedReason: normalizeText(degradedReasonInput),
    notesGeneratedAt: "",
    notesModeConfidence: normalizeConfidence(detectedMode?.notesModeConfidence),
    notesModeDetected: normalizeMeetingNotesMode(detectedMode?.notesModeDetected) || selected,
    notesModeSelected: selected,
    notesStatus: normalizeMeetingNotesStatus(statusInput) || "skipped",
    notesStyleSelected,
    notesSchemaVersion: NOTES_SCHEMA_VERSION,
  };
}

function normalizeMeetingNotes(input, preferredMode) {
  const notes = input && typeof input === "object" ? input : {};
  if (
    Array.isArray(notes.executiveSummary)
    || Array.isArray(notes.topics)
    || Array.isArray(notes.openQuestions)
    || Array.isArray(notes.risksOrDependencies)
    || Array.isArray(notes.memoHighlights)
    || Array.isArray(notes.speakerSummaries)
  ) {
    const normalizedMode = normalizeMeetingNotesMode(preferredMode || notes.mode) || DEFAULT_NOTES_MODE;
      return {
        actionItems: normalizeMeetingActionItems(notes.actionItems),
        decisions: normalizeMeetingDecisionItems(notes.decisions),
        executiveSummary: normalizeTextList(notes.executiveSummary),
      meetingMeta: {
        datetime: normalizeText(notes.meetingMeta?.datetime),
        participants: normalizeTextList(notes.meetingMeta?.participants),
        purpose: normalizeText(notes.meetingMeta?.purpose),
        title: normalizeText(notes.meetingMeta?.title),
        version: normalizeText(notes.meetingMeta?.version) || `v${NOTES_SCHEMA_VERSION}`,
      },
      memoHighlights: normalizeMeetingMemoHighlights(notes.memoHighlights),
        mode: normalizedMode,
        modeSpecific: normalizeMeetingModeSpecific(notes.modeSpecific, normalizedMode),
        openQuestions: normalizeTextList(notes.openQuestions),
        risksOrDependencies: normalizeMeetingRisks(notes.risksOrDependencies),
        speakerSummaries: normalizeMeetingSpeakerSummaries(notes.speakerSummaries),
        sourceTrace: normalizeMeetingSourceTrace(notes.sourceTrace),
        topics: normalizeMeetingTopics(notes.topics),
      };
  }

  const legacyActionItems = normalizeMeetingActionItems(notes.actionItems);
  const legacyNextSteps = normalizeTextList(notes.nextSteps).map((item) => ({
    assignee: "",
    dueDate: "",
    source: "transcript",
    status: "open",
    task: item,
  }));
  return {
    actionItems: [...legacyActionItems, ...legacyNextSteps],
    decisions: normalizeMeetingDecisionItems(notes.decisions),
    executiveSummary: normalizeTextList([notes.overview]),
    meetingMeta: {
      datetime: "",
      participants: [],
      purpose: "",
      title: "",
      version: "legacy-v1",
    },
    memoHighlights: [],
    mode: normalizeMeetingNotesMode(preferredMode || notes.mode) || DEFAULT_NOTES_MODE,
    modeSpecific: {},
    openQuestions: [],
    risksOrDependencies: [],
    speakerSummaries: [],
    sourceTrace: [],
    topics: normalizeTextList(notes.discussion).length
      ? [
          {
            decisions: [],
            keyPoints: normalizeTextList(notes.discussion),
            openQuestions: [],
            source: {
              memo: false,
              transcript: true,
            },
            summary: "",
            topic: "핵심 논의",
          },
        ]
      : [],
  };
}

function normalizeMeetingActionItems(input) {
  return (Array.isArray(input) ? input : [])
    .map((item) => {
      if (typeof item === "string") {
        return {
          assignee: "",
          dueDate: "",
          source: "transcript",
          status: "open",
          task: normalizeText(item),
        };
      }
      return {
        assignee: normalizeText(item?.assignee || item?.owner),
        dueDate: normalizeText(item?.dueDate || item?.dueAt),
        source: normalizeText(item?.source) || "transcript",
        status: normalizeText(item?.status) || "open",
        task: normalizeText(item?.task || item?.text),
      };
    })
    .filter((item) => item.task);
}

function normalizeMeetingDecisionItems(input) {
  return (Array.isArray(input) ? input : [])
    .map((item) => {
      if (typeof item === "string") {
        return {
          confidence: "medium",
          owner: "",
          text: normalizeText(item),
        };
      }
      return {
        confidence: normalizeText(item?.confidence) || "medium",
        owner: normalizeText(item?.owner),
        text: normalizeText(item?.text || item?.decision),
      };
    })
    .filter((item) => item.text);
}

function normalizeMeetingTopics(input) {
  return (Array.isArray(input) ? input : [])
    .map((item) => ({
      decisions: normalizeTextList(item?.decisions),
      keyPoints: normalizeTextList(item?.keyPoints),
      openQuestions: normalizeTextList(item?.openQuestions),
      source: {
        memo: Boolean(item?.source?.memo),
        transcript: item?.source?.transcript !== false,
      },
      summary: normalizeText(item?.summary),
      topic: normalizeText(item?.topic),
    }))
    .filter((item) => item.topic || item.summary || item.keyPoints.length || item.decisions.length || item.openQuestions.length);
}

function normalizeMeetingSpeakerSummaries(input) {
  return (Array.isArray(input) ? input : [])
    .map((item) => ({
      keyPoints: normalizeTextList(item?.keyPoints),
      speakerLabel: normalizeText(item?.speakerLabel),
      summary: normalizeText(item?.summary),
    }))
    .filter((item) => item.speakerLabel && (item.summary || item.keyPoints.length));
}

function normalizeMeetingRisks(input) {
  return (Array.isArray(input) ? input : [])
    .map((item) => {
      if (typeof item === "string") {
        return {
          severity: "medium",
          text: normalizeText(item),
        };
      }
      return {
        severity: normalizeText(item?.severity) || "medium",
        text: normalizeText(item?.text),
      };
    })
    .filter((item) => item.text);
}

function normalizeMeetingMemoHighlights(input) {
  return (Array.isArray(input) ? input : [])
    .map((item) => {
      if (typeof item === "string") {
        return {
          linkedTopic: "",
          mergeStatus: "merged",
          text: normalizeText(item),
        };
      }
      return {
        linkedTopic: normalizeText(item?.linkedTopic),
        mergeStatus: normalizeText(item?.mergeStatus) || "merged",
        text: normalizeText(item?.text),
      };
    })
    .filter((item) => item.text);
}

function normalizeMeetingSourceTrace(input) {
  return (Array.isArray(input) ? input : [])
    .map((item) => ({
      evidence: normalizeText(item?.evidence),
      itemRef: normalizeText(item?.itemRef),
      itemType: normalizeText(item?.itemType),
    }))
    .filter((item) => item.itemType || item.itemRef || item.evidence);
}

function normalizeMeetingModeSpecific(input, notesMode) {
  const mode = normalizeMeetingNotesMode(notesMode) || DEFAULT_NOTES_MODE;
  const data = input && typeof input === "object" ? input : {};
  if (mode === "interview") {
    return {
      concerns: normalizeTextList(data.concerns),
      followUpQuestions: normalizeTextList(data.followUpQuestions),
      strengths: normalizeTextList(data.strengths),
    };
  }
  if (mode === "review") {
    return {
      improvements: normalizeTextList(data.improvements),
      problems: normalizeTextList(data.problems),
      rootCauses: normalizeTextList(data.rootCauses),
      wins: normalizeTextList(data.wins),
    };
  }
  if (mode === "planning") {
    return {
      dependencies: normalizeTextList(data.dependencies),
      milestones: normalizeTextList(data.milestones),
      scopeItems: normalizeTextList(data.scopeItems),
    };
  }
  return {};
}

function normalizeNoteTextValue(input) {
  if (Array.isArray(input)) {
    return input.map((item) => normalizeNoteTextValue(item)).filter(Boolean).join(" · ");
  }
  if (input && typeof input === "object") {
    const primary = normalizeText(
      input?.text
      || input?.question
      || input?.summary
      || input?.topic
      || input?.title
      || input?.task
      || input?.decision
      || input?.label
      || input?.name
    );
    const details = [
      normalizeText(input?.owner || input?.assignee) ? `담당: ${normalizeText(input.owner || input.assignee)}` : "",
      normalizeText(input?.dueDate || input?.dueAt) ? `기한: ${normalizeText(input.dueDate || input.dueAt)}` : "",
      normalizeText(input?.status) ? `상태: ${normalizeText(input.status)}` : "",
      normalizeText(input?.severity) ? `심각도: ${normalizeText(input.severity)}` : "",
      normalizeText(input?.reason) ? `사유: ${normalizeText(input.reason)}` : "",
    ].filter(Boolean);
    if (primary || details.length) {
      return [primary, ...details].filter(Boolean).join(" · ");
    }
    return Object.values(input)
      .map((item) => normalizeNoteTextValue(item))
      .filter(Boolean)
      .join(" · ");
  }
  return normalizeText(input);
}

function normalizeTextList(input) {
  return (Array.isArray(input) ? input : [])
    .map((item) => normalizeNoteTextValue(item))
    .filter(Boolean);
}

function hasMeetingNotes(notes) {
  const normalized = normalizeMeetingNotes(notes);
  return Boolean(
    normalized.executiveSummary.length
    || normalized.topics.length
    || normalized.decisions.length
    || normalized.actionItems.length
    || normalized.openQuestions.length
    || normalized.risksOrDependencies.length
    || normalized.memoHighlights.length
  );
}

function parseMeetingNotesJson(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return createEmptyMeetingNotes();
  }
  const fenced = normalized.match(/```(?:json)?\s*([\s\S]+?)```/i);
  const candidate = fenced ? normalizeText(fenced[1]) : normalized;
  try {
    return JSON.parse(candidate);
  } catch {
    return createEmptyMeetingNotes();
  }
}

function normalizeCompletionContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        return normalizeText(item?.text || item?.content);
      })
      .filter(Boolean)
      .join("\n");
  }
  return normalizeText(content?.text || content?.content);
}

function buildMeetingNotesTranscriptPrompt(transcript) {
  const speakerAliases = normalizeSpeakerAliases(transcript?.speakerAliases);
  const segments = Array.isArray(transcript?.segments) ? transcript.segments : [];
  const fromSegments = segments
    .map((segment) => {
      const speakerLabel = normalizeText(segment?.speakerLabel);
      const speaker = resolveSpeakerDisplayName(speakerLabel, speakerAliases);
      const text = normalizeText(segment?.text);
      if (!text) return "";
      if (speakerLabel && speaker && speaker !== speakerLabel) {
        return `${speakerLabel} [${speaker}]: ${text}`;
      }
      return speakerLabel ? `${speakerLabel}: ${text}` : speaker ? `${speaker}: ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
  const rawText = normalizeText(fromSegments || transcript?.text);
  if (!rawText) {
    return "";
  }
  return rawText.length > MAX_SUMMARY_TRANSCRIPT_CHARS
    ? `${rawText.slice(0, MAX_SUMMARY_TRANSCRIPT_CHARS)}...`
    : rawText;
}

function buildMeetingNotesSpeakerGuide(transcript) {
  const speakerAliases = normalizeSpeakerAliases(transcript?.speakerAliases);
  const speakerLabels = Array.from(collectTranscriptSpeakerLabels(transcript));
  if (!speakerLabels.length) {
    return "화자 목록: 없음";
  }
  return [
    "화자 목록:",
    ...speakerLabels.map((speakerLabel) => `- ${speakerLabel}: ${resolveSpeakerDisplayName(speakerLabel, speakerAliases)}`),
  ].join("\n");
}

function normalizeSpeakerAliasValue(value) {
  return normalizeTextBlock(value)
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, MAX_SPEAKER_ALIAS_LENGTH);
}

function normalizeSpeakerAliases(input, allowedLabels) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const allowAll = !(allowedLabels instanceof Set);
  const normalized = {};
  for (const [rawLabel, rawAlias] of Object.entries(source)) {
    const label = normalizeText(rawLabel);
    const alias = normalizeSpeakerAliasValue(rawAlias);
    if (!label || !alias) continue;
    if (!allowAll && !allowedLabels.has(label)) continue;
    if (alias === label) continue;
    normalized[label] = alias;
  }
  return normalized;
}

function buildDefaultSpeakerDisplayName(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "화자";
  }
  const diarizedMatch = normalized.match(/^SPEAKER_(\d+)$/i);
  if (diarizedMatch) {
    return `화자 ${Number.parseInt(diarizedMatch[1], 10) + 1}`;
  }
  if (/^[A-Z]$/i.test(normalized)) {
    return `화자 ${normalized.toUpperCase()}`;
  }
  return normalized;
}

function resolveSpeakerDisplayName(value, speakerAliases) {
  const label = normalizeText(value);
  return normalizeText(speakerAliases?.[label]) || buildDefaultSpeakerDisplayName(label);
}

function collectTranscriptSpeakerLabels(transcript) {
  return new Set(
    (Array.isArray(transcript?.segments) ? transcript.segments : [])
      .map((segment) => normalizeText(segment?.speakerLabel))
      .filter(Boolean)
  );
}

function normalizeMeetingJobLookup(input) {
  return {
    jobId: normalizeText(input?.jobId),
    meetingId: normalizeText(input?.meetingId),
    sessionId: normalizeText(input?.sessionId),
  };
}

function normalizeMeetingArtifactLookup(input) {
  return {
    artifactId: normalizeText(input?.artifactId),
    jobId: normalizeText(input?.jobId),
    meetingId: normalizeText(input?.meetingId),
  };
}

function normalizeMeetingHubListRequest(input) {
  return {
    cursor: normalizeText(input?.cursor),
    limit: Math.max(1, Math.min(MAX_MEETING_LIST_LIMIT, Number(input?.limit) || 12)),
  };
}

function normalizeMeetingResultsListRequest(input) {
  return {
    limit: Math.max(1, Math.min(MAX_MEETING_RECENT_RESULTS, Number(input?.limit) || 8)),
    meetingId: normalizeText(input?.meetingId),
    sessionId: normalizeText(input?.sessionId),
  };
}

function normalizeMeetingMutationRequest(input) {
  return {
    hasSharedMemo: hasOwn(input, "sharedMemo"),
    hasTitle: hasOwn(input, "title"),
    meetingId: normalizeText(input?.meetingId),
    sharedMemo: normalizeTextBlock(input?.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
    title: normalizeText(input?.title),
  };
}

function normalizeMeetingResultMutationRequest(input) {
  const hasSpeakerAliases = Boolean(input && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, "speakerAliases"));
  return {
    jobId: normalizeText(input?.jobId),
    meetingId: normalizeText(input?.meetingId),
    speakerAliases: normalizeSpeakerAliases(input?.speakerAliases),
    speakerAliasesProvided: hasSpeakerAliases,
    title: normalizeText(input?.title),
  };
}

function normalizeMeetingNotesRegenerateRequest(input) {
  return {
    jobId: normalizeText(input?.jobId),
    meetingId: normalizeText(input?.meetingId),
    notesMode: normalizeMeetingNotesMode(input?.notesMode),
    notesStyle: normalizeMeetingNotesStyle(input?.notesStyle) || DEFAULT_NOTES_STYLE,
    sharedMemo: normalizeTextBlock(input?.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
  };
}

function buildQueuedJob(jobId, meeting, owner, options, source, context, createdAt) {
  return {
    artifacts: [],
    context: normalizeMeetingContext(context),
    createdAt,
    deletedAt: "",
    jobId,
    meeting: {
      ...meeting,
      createdAt: meeting.startedAt || createdAt,
      sharedMemo: normalizeTextBlock(meeting.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
    },
    meetingId: meeting.meetingId,
    notesDegradedReason: "",
    notesGeneratedAt: "",
    notesModeConfidence: 0,
    notesModeDetected: "",
    notesModeSelected: "",
    notesStatus: options.summary ? "pending" : "disabled",
    notesStyleSelected: DEFAULT_NOTES_STYLE,
    notesSchemaVersion: NOTES_SCHEMA_VERSION,
    options,
    owner: owner ? { ...owner } : {},
    progress: {
      currentPart: 0,
      parallelParts: 0,
      percent: 0,
      phase: "queued",
      totalParts: Math.max(0, Array.isArray(source?.parts) ? source.parts.length : 0) || 1,
    },
    retry: {
      count: 0,
      lastError: "",
      lastRetriedAt: "",
    },
    queuedAt: createdAt,
    sessionId: meeting.sessionId,
    source,
    status: "queued",
    title: normalizeText(meeting.title),
    transcription: {
      language: meeting.language,
      speakerLabels: options.speakerLabels,
    },
    updatedAt: createdAt,
  };
}

function buildSucceededJobPatch(artifact, meeting, options, source, context, transcript, meetingNotes, completedAt, deletedAt, retryInput) {
  const speakerAliases = normalizeSpeakerAliases(transcript?.speakerAliases);
  const resultTitle = resolveMeetingResultTitle(meetingNotes, meeting.title);
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
      currentPart: Math.max(1, Array.isArray(source?.parts) && source.parts.length ? source.parts.length : 1),
      parallelParts: 0,
      percent: 100,
      phase: "completed",
      totalParts: Math.max(1, Array.isArray(source?.parts) && source.parts.length ? source.parts.length : 1),
    },
    retry: {
      count: Math.max(0, Number(retryInput?.count) || 0),
      lastError: "",
      lastRetriedAt: normalizeText(retryInput?.lastRetriedAt),
    },
    source: {
      ...source,
      uploadStatus: deletedAt ? "deleted" : source.uploadStatus,
    },
    status: "succeeded",
    context: normalizeMeetingContext(context),
    notesDegradedReason: normalizeText(meetingNotes?.notesDegradedReason),
    meetingNotes: normalizeMeetingNotes(meetingNotes?.notes),
    notesGeneratedAt: normalizeText(meetingNotes?.notesGeneratedAt),
    notesModeConfidence: normalizeConfidence(meetingNotes?.notesModeConfidence),
    notesModeDetected: normalizeMeetingNotesMode(meetingNotes?.notesModeDetected),
    notesModeSelected: normalizeMeetingNotesMode(meetingNotes?.notesModeSelected),
    notesStatus: normalizeMeetingNotesStatus(meetingNotes?.notesStatus),
    notesStyleSelected: normalizeMeetingNotesStyle(meetingNotes?.notesStyleSelected) || DEFAULT_NOTES_STYLE,
    notesSchemaVersion: Math.max(1, Number(meetingNotes?.notesSchemaVersion) || NOTES_SCHEMA_VERSION),
    speakerAliases,
    title: resultTitle,
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

function resolveMeetingResultTitle(meetingNotes, fallbackTitle) {
  const suggestedTitle = normalizeText(meetingNotes?.notes?.meetingMeta?.title || meetingNotes?.meetingMeta?.title);
  return suggestedTitle || normalizeText(fallbackTitle);
}

function buildTranscriptArtifact(artifactId, jobId, meeting, owner, transcript, meetingNotes, createdAt) {
  const speakerAliases = normalizeSpeakerAliases(transcript?.speakerAliases);
  return {
    artifactId,
    createdAt,
    deletedAt: "",
    format: "diarized_json",
    jobId,
    kind: "transcript",
    meetingId: meeting.meetingId,
    notesDegradedReason: normalizeText(meetingNotes?.notesDegradedReason),
    notes: normalizeMeetingNotes(meetingNotes?.notes),
    notesGeneratedAt: normalizeText(meetingNotes?.notesGeneratedAt),
    notesModeConfidence: normalizeConfidence(meetingNotes?.notesModeConfidence),
    notesModeDetected: normalizeMeetingNotesMode(meetingNotes?.notesModeDetected),
    notesModeSelected: normalizeMeetingNotesMode(meetingNotes?.notesModeSelected),
    notesStatus: normalizeMeetingNotesStatus(meetingNotes?.notesStatus),
    notesStyleSelected: normalizeMeetingNotesStyle(meetingNotes?.notesStyleSelected) || DEFAULT_NOTES_STYLE,
    notesSchemaVersion: Math.max(1, Number(meetingNotes?.notesSchemaVersion) || NOTES_SCHEMA_VERSION),
    owner: owner ? { ...owner } : {},
    speakerAliases,
    segments: transcript.segments,
    sessionId: meeting.sessionId,
    text: transcript.text,
  };
}

function buildMeetingDocId(providerUserKey, meetingId) {
  return `${normalizeText(providerUserKey)}__${normalizeText(meetingId)}`;
}

function buildMeetingSummaryDocument(meeting, owner, jobSummary, currentSummary) {
  const normalizedCurrent = normalizeMeetingSummary(currentSummary);
  const normalizedJobSummary = normalizeMeetingResultSummary(jobSummary);
  return {
    createdAt: normalizedCurrent.createdAt || normalizedJobSummary.createdAt || normalizeText(meeting.startedAt) || new Date().toISOString(),
    endedAt: normalizeText(meeting.endedAt),
    excerpt: normalizeText(normalizedJobSummary.previewText),
    language: normalizeText(meeting.language) || normalizedCurrent.language || "ko",
    latestArtifactId: normalizeText(normalizedJobSummary.artifactId),
    latestJobId: normalizeText(normalizedJobSummary.jobId),
    meetingId: normalizeText(meeting.meetingId),
    owner: owner ? { ...owner } : {},
    recentJobs: mergeRecentJobs(normalizedCurrent.recentJobs, normalizedJobSummary),
    sharedMemo: normalizeTextBlock(meeting.sharedMemo || normalizedCurrent.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
    sessionId: normalizeText(meeting.sessionId),
    sourceTabId: Math.max(0, Number(meeting.sourceTabId) || 0),
    startedAt: normalizeText(meeting.startedAt),
    status: normalizeText(normalizedJobSummary.status),
    title: normalizeText(meeting.title),
    updatedAt: normalizeText(normalizedJobSummary.updatedAt || new Date().toISOString()),
  };
}

function buildMeetingRecentJobsPatch(currentMeetingInput, recentJobsInput, updatedAt) {
  const currentMeeting = normalizeMeetingSummary(currentMeetingInput);
  const recentJobs = Array.isArray(recentJobsInput)
    ? recentJobsInput.map(normalizeMeetingResultSummary).sort(compareMeetingResults).slice(0, MAX_MEETING_RECENT_RESULTS)
    : [];
  const latest = recentJobs[0] || null;
  return {
    excerpt: normalizeText(latest?.previewText),
    latestArtifactId: normalizeText(latest?.artifactId),
    latestJobId: normalizeText(latest?.jobId),
    recentJobs,
    status: normalizeText(latest?.status) || "idle",
    updatedAt: normalizeText(updatedAt || latest?.updatedAt || currentMeeting.updatedAt || new Date().toISOString()),
  };
}

function buildSessionDocument(meeting, owner, jobId, updatedAt) {
  return {
    endedAt: meeting.endedAt,
    recentJobs: [],
    language: meeting.language,
    owner: owner ? { ...owner } : {},
    sessionId: meeting.sessionId,
    sharedMemo: normalizeTextBlock(meeting.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
    startedAt: meeting.startedAt,
    title: meeting.title,
    updatedAt,
    lastJobId: jobId,
  };
}

function buildSessionRecentJobsPatch(currentSessionInput, recentJobsInput, updatedAt) {
  const currentSession = normalizeMeetingSession(currentSessionInput);
  const recentJobs = Array.isArray(recentJobsInput)
    ? recentJobsInput.map(normalizeMeetingResultSummary).sort(compareMeetingResults).slice(0, MAX_MEETING_RECENT_RESULTS)
    : [];
  return {
    lastJobId: normalizeText(recentJobs[0]?.jobId),
    recentJobs,
    updatedAt: normalizeText(updatedAt || recentJobs[0]?.updatedAt || currentSession.updatedAt || new Date().toISOString()),
  };
}

function buildSessionDocId(providerUserKey, sessionId) {
  return `${normalizeText(providerUserKey)}__${normalizeText(sessionId)}`;
}

function buildTempStorageObjectPath(providerUserKey, meetingId, jobId, fileName) {
  return [
    "tmp",
    "meetings",
    normalizeText(providerUserKey) || "unknown-user",
    normalizeText(meetingId) || "unknown-meeting",
    `${normalizeText(jobId) || "meeting-job"}-${normalizeText(fileName) || "audio.webm"}`,
  ].join("/");
}

function buildChunkTranscriptStorageObjectPath(providerUserKey, meetingId, jobId, partIndex) {
  return [
    "tmp",
    "meetings",
    normalizeText(providerUserKey) || "unknown-user",
    normalizeText(meetingId) || "unknown-meeting",
    "chunk-transcripts",
    `${normalizeText(jobId) || "meeting-job"}-part-${String(Math.max(0, Number(partIndex) || 0)).padStart(4, "0")}.json`,
  ].join("/");
}

function buildStableMeetingEntityId(prefix, providerUserKey, meetingId, requestId) {
  const digest = crypto
    .createHash("sha256")
    .update([
      normalizeText(prefix),
      normalizeText(providerUserKey),
      normalizeText(meetingId),
      normalizeText(requestId),
    ].join("::"))
    .digest("hex")
    .slice(0, 32);
  return `${normalizeText(prefix) || "meeting-entity"}-${digest}`;
}

function buildMeetingJobPartId(jobId, index) {
  return `${normalizeText(jobId)}__${String(Math.max(0, Number(index) || 0)).padStart(4, "0")}`;
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
    context: normalizeMeetingContext(job.context),
    createdAt: normalizeText(job.createdAt),
    deletedAt: normalizeText(job.deletedAt),
    error: normalizeText(job.error),
    jobId: normalizeText(job.jobId),
    meeting: {
      createdAt: normalizeText(job.meeting?.createdAt),
      endedAt: normalizeText(job.meeting?.endedAt),
      language: normalizeText(job.meeting?.language),
      meetingId: normalizeText(job.meeting?.meetingId),
      sessionId: normalizeText(job.meeting?.sessionId),
      sharedMemo: normalizeTextBlock(job.meeting?.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
      sourceTabId: Math.max(0, Number(job.meeting?.sourceTabId) || 0),
      startedAt: normalizeText(job.meeting?.startedAt),
      title: normalizeText(job.meeting?.title),
    },
    meetingId: normalizeText(job.meetingId || job.meeting?.meetingId),
    meetingNotes: normalizeMeetingNotes(job.meetingNotes),
    notesDegradedReason: normalizeText(job.notesDegradedReason),
    notesGeneratedAt: normalizeText(job.notesGeneratedAt),
    notesModeConfidence: normalizeConfidence(job.notesModeConfidence),
    notesModeDetected: normalizeMeetingNotesMode(job.notesModeDetected),
    notesModeSelected: normalizeMeetingNotesMode(job.notesModeSelected),
    notesStatus: normalizeMeetingNotesStatus(job.notesStatus),
    notesStyleSelected: normalizeMeetingNotesStyle(job.notesStyleSelected) || DEFAULT_NOTES_STYLE,
    notesSchemaVersion: Math.max(1, Number(job.notesSchemaVersion) || NOTES_SCHEMA_VERSION),
    options: {
      redaction: normalizeText(job.options?.redaction),
      speakerLabels: Boolean(job.options?.speakerLabels),
      summary: Boolean(job.options?.summary),
    },
    owner: job.owner && typeof job.owner === "object" ? { ...job.owner } : {},
    progress: {
      currentPart: Math.max(0, Number(job.progress?.currentPart) || 0),
      parallelParts: Math.max(0, Number(job.progress?.parallelParts) || 0),
      percent: Math.max(0, Math.min(100, Number(job.progress?.percent) || 0)),
      phase: normalizeText(job.progress?.phase),
      totalParts: Math.max(0, Number(job.progress?.totalParts) || 0),
    },
    retry: {
      count: Math.max(0, Number(job.retry?.count) || 0),
      lastError: normalizeText(job.retry?.lastError),
      lastRetriedAt: normalizeText(job.retry?.lastRetriedAt),
    },
    queuedAt: normalizeText(job.queuedAt),
    sessionId: normalizeText(job.sessionId || job.meeting?.sessionId),
    speakerAliases: normalizeSpeakerAliases(job.speakerAliases),
    source: normalizeMeetingSource(job.source),
    status: normalizeText(job.status),
    title: normalizeText(job.title || job.meeting?.title),
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
    deletedAt: normalizeText(artifact.deletedAt),
    format: normalizeText(artifact.format),
    jobId: normalizeText(artifact.jobId),
    kind: normalizeText(artifact.kind),
    meetingId: normalizeText(artifact.meetingId),
    notesDegradedReason: normalizeText(artifact.notesDegradedReason),
    notes: normalizeMeetingNotes(artifact.notes),
    notesGeneratedAt: normalizeText(artifact.notesGeneratedAt),
    notesModeConfidence: normalizeConfidence(artifact.notesModeConfidence),
    notesModeDetected: normalizeMeetingNotesMode(artifact.notesModeDetected),
    notesModeSelected: normalizeMeetingNotesMode(artifact.notesModeSelected),
    notesStatus: normalizeMeetingNotesStatus(artifact.notesStatus),
    notesStyleSelected: normalizeMeetingNotesStyle(artifact.notesStyleSelected) || DEFAULT_NOTES_STYLE,
    notesSchemaVersion: Math.max(1, Number(artifact.notesSchemaVersion) || NOTES_SCHEMA_VERSION),
    owner: artifact.owner && typeof artifact.owner === "object" ? { ...artifact.owner } : {},
    speakerAliases: normalizeSpeakerAliases(artifact.speakerAliases),
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

function normalizeMeetingSummary(input) {
  const meeting = input && typeof input === "object" ? input : {};
  return {
    createdAt: normalizeText(meeting.createdAt),
    deletedAt: normalizeText(meeting.deletedAt),
    endedAt: normalizeText(meeting.endedAt),
    excerpt: normalizeText(meeting.excerpt),
    language: normalizeText(meeting.language) || "ko",
    latestArtifactId: normalizeText(meeting.latestArtifactId),
    latestJobId: normalizeText(meeting.latestJobId),
    meetingId: normalizeText(meeting.meetingId),
    owner: meeting.owner && typeof meeting.owner === "object" ? { ...meeting.owner } : {},
    pendingLocalCount: Math.max(0, Number(meeting.pendingLocalCount) || 0),
    recentJobs: Array.isArray(meeting.recentJobs) ? meeting.recentJobs.map(normalizeMeetingResultSummary) : [],
    sessionId: normalizeText(meeting.sessionId),
    sharedMemo: normalizeTextBlock(meeting.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
    sourceTabId: Math.max(0, Number(meeting.sourceTabId) || 0),
    startedAt: normalizeText(meeting.startedAt),
    status: normalizeText(meeting.status),
    title: normalizeText(meeting.title),
    updatedAt: normalizeText(meeting.updatedAt),
  };
}

function normalizeMeetingSession(input) {
  const session = input && typeof input === "object" ? input : {};
  return {
    deletedAt: normalizeText(session.deletedAt),
    endedAt: normalizeText(session.endedAt),
    language: normalizeText(session.language) || "ko",
    lastJobId: normalizeText(session.lastJobId),
    owner: session.owner && typeof session.owner === "object" ? { ...session.owner } : {},
    recentJobs: Array.isArray(session.recentJobs) ? session.recentJobs.map(normalizeMeetingResultSummary) : [],
    sessionId: normalizeText(session.sessionId),
    sharedMemo: normalizeTextBlock(session.sharedMemo).slice(0, MAX_SHARED_MEMO_CHARS),
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
    meetingId: normalizeText(item.meetingId || item.sessionId),
    notesDegradedReason: normalizeText(item.notesDegradedReason),
    notesGeneratedAt: normalizeText(item.notesGeneratedAt),
    notesModeConfidence: normalizeConfidence(item.notesModeConfidence),
    notesModeDetected: normalizeMeetingNotesMode(item.notesModeDetected),
    notesModeSelected: normalizeMeetingNotesMode(item.notesModeSelected),
    notesStatus: normalizeMeetingNotesStatus(item.notesStatus),
    notesStyleSelected: normalizeMeetingNotesStyle(item.notesStyleSelected) || DEFAULT_NOTES_STYLE,
    notesSchemaVersion: Math.max(1, Number(item.notesSchemaVersion) || NOTES_SCHEMA_VERSION),
    previewText: normalizeText(item.previewText || item.excerpt),
    jobId: normalizeText(item.jobId),
    requestId: normalizeText(item.requestId),
    sessionId: normalizeText(item.sessionId),
    speakerAliases: normalizeSpeakerAliases(item.speakerAliases),
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
  const notesPreview = getMeetingNotesPreviewText(artifact?.notes || job.meetingNotes);
  return normalizeMeetingResultSummary({
    artifactId: normalizeText(artifact?.artifactId || job.transcript?.artifactId || job.artifacts?.[0]?.artifactId),
    captureMode: job.source.captureMode,
    createdAt: job.createdAt || job.queuedAt,
    durationMs: job.source.durationMs,
    error: job.error,
    jobId: job.jobId,
    meetingId: job.meetingId,
    notesDegradedReason: normalizeText(artifact?.notesDegradedReason || job.notesDegradedReason),
    notesGeneratedAt: normalizeText(artifact?.notesGeneratedAt || job.notesGeneratedAt),
    notesModeConfidence: normalizeConfidence(artifact?.notesModeConfidence || job.notesModeConfidence),
    notesModeDetected: normalizeMeetingNotesMode(artifact?.notesModeDetected || job.notesModeDetected),
    notesModeSelected: normalizeMeetingNotesMode(artifact?.notesModeSelected || job.notesModeSelected),
    notesStatus: normalizeMeetingNotesStatus(artifact?.notesStatus || job.notesStatus),
    notesStyleSelected: normalizeMeetingNotesStyle(artifact?.notesStyleSelected || job.notesStyleSelected) || DEFAULT_NOTES_STYLE,
    notesSchemaVersion: Math.max(1, Number(artifact?.notesSchemaVersion || job.notesSchemaVersion) || NOTES_SCHEMA_VERSION),
    previewText: notesPreview || buildTranscriptExcerpt(transcriptText),
    requestId: normalizeText(job.source.requestId),
    sessionId: job.sessionId,
    speakerAliases: {
      ...(artifact?.speakerAliases || {}),
      ...(job.speakerAliases || {}),
    },
    speakerCount: Math.max(0, Number(artifact ? countTranscriptSpeakers(artifact.segments) : job.transcription.speakerCount) || 0),
    status: job.status,
    title: job.title || job.meeting.title,
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
    .slice(0, MAX_MEETING_RECENT_RESULTS);
}

function compareMeetingResults(left, right) {
  return toTimestamp(right.updatedAt || right.createdAt) - toTimestamp(left.updatedAt || left.createdAt);
}

function compareMeetings(left, right) {
  return toTimestamp(right.updatedAt || right.createdAt) - toTimestamp(left.updatedAt || left.createdAt);
}

function shouldSyncMeetingTitleToResult(item, previousTitle) {
  const title = normalizeText(item?.title);
  const normalizedPrevious = normalizeText(previousTitle);
  return !title || title === normalizedPrevious;
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

function collectMeetingArtifactIds(jobInput) {
  const job = normalizeMeetingJob(jobInput);
  return Array.from(
    new Set([
      job.transcript.artifactId,
      ...job.artifacts.map((artifact) => normalizeText(artifact.artifactId)),
    ].filter(Boolean))
  );
}

function countTranscriptSpeakers(segments) {
  return new Set(
    (Array.isArray(segments) ? segments : [])
      .map((segment) => normalizeText(segment?.speakerLabel))
      .filter(Boolean)
  ).size;
}

async function upsertMeetingJobSummary(meetingRef, meeting, owner, jobInput, artifactInput) {
  const job = normalizeMeetingJob(jobInput);
  if (!job.jobId || job.deletedAt) {
    return;
  }
  const snapshot = await meetingRef.get();
  const currentMeeting = snapshot.exists ? normalizeMeetingSummary(snapshot.data()) : normalizeMeetingSummary({
    meetingId: meeting.meetingId,
    owner,
  });
  if (currentMeeting.deletedAt) {
    return;
  }
  const jobSummary = buildMeetingResultSummary(job, artifactInput);
  const nextDocument = buildMeetingSummaryDocument(meeting, owner, jobSummary, currentMeeting);
  await meetingRef.set(nextDocument, { merge: true });
}

async function upsertLegacySessionJobSummary(sessionRef, meeting, owner, jobInput, artifactInput) {
  const job = normalizeMeetingJob(jobInput);
  if (!job.jobId || job.deletedAt) {
    return;
  }
  const snapshot = await sessionRef.get();
  const currentSession = snapshot.exists ? normalizeMeetingSession(snapshot.data()) : normalizeMeetingSession({
    owner,
    sessionId: meeting.sessionId,
  });
  if (currentSession.deletedAt) {
    return;
  }
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

function assertMeetingOwnership(meeting, owner, createHttpError) {
  const storedOwnerKey = normalizeText(meeting.owner?.providerUserKey);
  if (storedOwnerKey && storedOwnerKey !== normalizeText(owner?.providerUserKey)) {
    throw createHttpError(403, "현재 사용자에게 허용되지 않은 회의예요.");
  }
}

function assertSessionOwnership(session, owner, createHttpError) {
  const storedOwnerKey = normalizeText(session.owner?.providerUserKey);
  if (storedOwnerKey && storedOwnerKey !== normalizeText(owner?.providerUserKey)) {
    throw createHttpError(403, "현재 사용자에게 허용되지 않은 회의 세션이에요.");
  }
}

function normalizeTextBlock(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function normalizeMeetingNotesMode(value) {
  const normalized = normalizeText(value).toLowerCase();
  return SUPPORTED_NOTES_MODES.has(normalized) ? normalized : "";
}

function normalizeMeetingNotesStatus(value) {
  const normalized = normalizeText(value).toLowerCase();
  return SUPPORTED_NOTES_STATUSES.has(normalized) ? normalized : "";
}

function normalizeMeetingNotesStyle(value) {
  const normalized = normalizeText(value).toLowerCase();
  return SUPPORTED_NOTES_STYLES.has(normalized) ? normalized : "";
}

function normalizeConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(1, Number(parsed.toFixed(4))));
}

function parseMeetingNotesModeJson(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return {
      confidence: 0,
      mode: DEFAULT_NOTES_MODE,
    };
  }
  const fenced = normalized.match(/```(?:json)?\s*([\s\S]+?)```/i);
  const candidate = fenced ? normalizeText(fenced[1]) : normalized;
  try {
    const parsed = JSON.parse(candidate);
    return {
      confidence: normalizeConfidence(parsed?.confidence),
      mode: normalizeMeetingNotesMode(parsed?.mode) || DEFAULT_NOTES_MODE,
    };
  } catch {
    return {
      confidence: 0,
      mode: DEFAULT_NOTES_MODE,
    };
  }
}

function getMeetingNotesPreviewText(notesInput) {
  const notes = normalizeMeetingNotes(notesInput);
  const candidates = [
    ...notes.executiveSummary,
    ...notes.topics.map((item) => normalizeText(item.summary || item.topic)),
    ...notes.decisions.map((item) => normalizeText(item.text)),
    ...notes.actionItems.map((item) => normalizeText(item.task)),
  ]
    .map((item) => normalizeText(item))
    .filter(Boolean);
  return buildTranscriptExcerpt(candidates.join(" "));
}

async function loadMeetingTranscriptForNotes(jobInput, db, createHttpError) {
  const job = normalizeMeetingJob(jobInput);
  const artifactId = normalizeText(job.transcript?.artifactId || job.artifacts?.[0]?.artifactId);
  const artifactRef = artifactId ? db.collection(ARTIFACT_COLLECTION).doc(artifactId) : null;
  if (artifactRef) {
    const snapshot = await artifactRef.get();
    if (snapshot.exists) {
      const artifact = normalizeMeetingArtifact(snapshot.data());
      const text = normalizeText(artifact.text);
      const segments = Array.isArray(artifact.segments) ? artifact.segments : [];
      if (text || segments.length) {
        const speakerLabels = collectTranscriptSpeakerLabels({ segments });
        const speakerAliases = normalizeSpeakerAliases(
          {
            ...(artifact.speakerAliases || {}),
            ...(job.speakerAliases || {}),
          },
          speakerLabels
        );
        return {
          artifact,
          artifactRef,
          transcript: {
            segments,
            speakerAliases,
            text,
          },
        };
      }
    }
  }
  const transcriptText = normalizeText(job.transcript?.text);
  const transcriptSegments = Array.isArray(job.transcript?.segments) ? job.transcript.segments : [];
  if (transcriptText || transcriptSegments.length) {
    const speakerLabels = collectTranscriptSpeakerLabels({ segments: transcriptSegments });
    const speakerAliases = normalizeSpeakerAliases(job.speakerAliases, speakerLabels);
    return {
      artifact: normalizeMeetingArtifact({
        artifactId,
        createdAt: normalizeText(job.updatedAt || job.createdAt || job.queuedAt),
        deletedAt: "",
        format: "diarized_json",
        jobId: job.jobId,
        kind: "transcript",
        meetingId: job.meetingId,
        notesDegradedReason: job.notesDegradedReason,
        notes: job.meetingNotes,
        notesGeneratedAt: job.notesGeneratedAt,
        notesModeConfidence: job.notesModeConfidence,
        notesModeDetected: job.notesModeDetected,
        notesModeSelected: job.notesModeSelected,
        notesStatus: job.notesStatus,
        notesSchemaVersion: job.notesSchemaVersion,
        owner: job.owner,
        speakerAliases,
        segments: transcriptSegments,
        sessionId: job.sessionId,
        text: transcriptText,
      }),
      artifactRef,
      transcript: {
        segments: transcriptSegments,
        speakerAliases,
        text: transcriptText,
      },
    };
  }

  if (!artifactId) {
    throw createHttpError(409, "전사 원본이 아직 준비되지 않았어요.");
  }
  throw createHttpError(404, "전사 원본을 찾지 못했어요.");
}

function hasOwn(input, key) {
  return Boolean(input && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, key));
}

function safeParseJson(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
}

function getInlineAudioLimitBytes() {
  return Math.max(1024, Number(process.env.OPENAI_MEETING_INLINE_AUDIO_LIMIT_BYTES) || DEFAULT_INLINE_AUDIO_LIMIT_BYTES);
}

function getMeetingSourceTargetPartBytes() {
  return Math.max(1024, Number(process.env.OPENAI_MEETING_SOURCE_TARGET_PART_BYTES) || DEFAULT_SOURCE_TARGET_PART_BYTES);
}

function getMeetingSourceMaxBytes() {
  return Math.max(getInlineAudioLimitBytes(), Number(process.env.OPENAI_MEETING_SOURCE_MAX_BYTES) || DEFAULT_SOURCE_MAX_BYTES);
}

function getMeetingSourceMaxDurationMs() {
  return Math.max(30 * 1000, Number(process.env.OPENAI_MEETING_SOURCE_MAX_DURATION_MS) || DEFAULT_SOURCE_MAX_DURATION_MS);
}

function normalizeText(value) {
  return String(value || "").trim();
}

module.exports = {
  registerMeetingHandlers,
};
