const crypto = require("crypto");
const OpenAI = require("openai");

const ALLOWED_CAPTURE_MODES = new Set(["tab-audio", "microphone", "mixed-audio"]);
const DEFAULT_INLINE_AUDIO_LIMIT_BYTES = 25 * 1024 * 1024;
const DEFAULT_MODEL = "gpt-4o-transcribe-diarize";
const DEFAULT_SUMMARY_MODEL = "gpt-5.4-mini";
const JOB_COLLECTION = "integration_inova_meeting_jobs";
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
const SUPPORTED_NOTES_MODES = new Set(["general", "interview", "review", "planning"]);
const SUPPORTED_NOTES_STYLES = new Set(["default", "brief", "action"]);

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
    let usesStorageSource = false;
    let tempStorageObject = "";
    try {
      assertMethod(request);
      const meeting = normalizeMeetingRequest(request.body?.meeting);
      const options = normalizeMeetingOptions(request.body?.options);
      const source = normalizeMeetingSource(request.body?.source);
      const context = normalizeMeetingContext(request.body?.context);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;
      usesStorageSource = Boolean(normalizeText(source.storageObject));
      tempStorageObject = normalizeText(source.storageObject);

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

      const requestId = normalizeText(source.requestId);
      const jobId = requestId
        ? buildStableMeetingEntityId("meeting-job", owner.providerUserKey, meeting.meetingId, requestId)
        : db.collection(JOB_COLLECTION).doc().id;
      const artifactId = requestId
        ? buildStableMeetingEntityId("meeting-artifact", owner.providerUserKey, meeting.meetingId, requestId)
        : db.collection(ARTIFACT_COLLECTION).doc().id;
      const createdAt = new Date().toISOString();
      const jobRef = db.collection(JOB_COLLECTION).doc(jobId);
      const artifactRef = db.collection(ARTIFACT_COLLECTION).doc(artifactId);
      if (requestId) {
        const existingSnapshot = await jobRef.get();
        if (existingSnapshot.exists) {
          const existingJob = normalizeMeetingJob(existingSnapshot.data());
          if (!existingJob.deletedAt && normalizeText(existingJob.status) !== "failed") {
            assertJobOwnership(existingJob, owner, createHttpError);
            await assertMeetingIsActive(owner, existingJob.meetingId || meeting.meetingId, createHttpError);
            logEvent("meeting.create.deduped", {
              jobId: existingJob.jobId,
              meetingId: existingJob.meetingId || meeting.meetingId,
              providerUserKey: owner.providerUserKey,
              requestId,
            });
            response.json({
              ok: true,
              data: {
                job: existingJob,
                reused: true,
              },
            });
            return;
          }
        }
      }
      const audioBuffer = await loadSourceAudioBuffer(source);
      if (!audioBuffer.length) {
        throw createHttpError(400, "회의 원본 오디오가 비어 있어요.");
      }
      if (audioBuffer.length > getInlineAudioLimitBytes()) {
        throw createHttpError(
          413,
          usesStorageSource
            ? `현재 서버 전사 경로는 ${Math.floor(getInlineAudioLimitBytes() / (1024 * 1024))}MB 이하 원본만 바로 처리해요. 더 큰 파일 분할 전사는 아직 준비 중입니다.`
            : `현재 inline 업로드 경로는 ${Math.floor(getInlineAudioLimitBytes() / (1024 * 1024))}MB 이하 녹음만 지원해요.`
        );
      }
      tempStorageObject = normalizeText(source.storageObject)
        || buildTempStorageObjectPath(owner.providerUserKey, meeting.meetingId, jobId, source.fileName);
      const expiresAt = new Date(Date.now() + TEMP_UPLOAD_TTL_MS).toISOString();
      const sourceSnapshot = {
        captureMode: source.captureMode,
        channelCount: source.channelCount,
        durationMs: source.durationMs,
        expiresAt,
        fileName: source.fileName,
        mimeType: source.mimeType,
        requestId,
        sizeBytes: source.sizeBytes,
        storageObject: usesStorageSource ? tempStorageObject : "",
        uploadStatus: usesStorageSource ? "uploaded" : "inline-only",
      };
      const effectiveMeeting = {
        ...meeting,
        sharedMemo: context.sharedMemoSnapshot,
      };
      const queuedJob = buildQueuedJob(jobId, effectiveMeeting, owner, options, sourceSnapshot, context, createdAt);
      const meetingRef = db.collection(MEETING_COLLECTION).doc(buildMeetingDocId(owner.providerUserKey, meeting.meetingId));
      const sessionRef = meeting.sessionId
        ? db.collection(SESSION_COLLECTION).doc(buildSessionDocId(owner.providerUserKey, meeting.sessionId))
        : null;

      const uploadedSource = usesStorageSource
        ? {
            storageObject: tempStorageObject,
            uploadStatus: "uploaded",
          }
        : await uploadTemporarySource(bucket, tempStorageObject, audioBuffer, sourceSnapshot, owner, meeting, jobId);
      sourceSnapshot.storageObject = normalizeText(uploadedSource?.storageObject);
      sourceSnapshot.uploadStatus = normalizeText(uploadedSource?.uploadStatus) || sourceSnapshot.uploadStatus;
      await Promise.all([
        upsertMeetingJobSummary(meetingRef, effectiveMeeting, owner, queuedJob),
        sessionRef ? upsertLegacySessionJobSummary(sessionRef, effectiveMeeting, owner, queuedJob) : Promise.resolve(),
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
        upsertMeetingJobSummary(
          meetingRef,
          effectiveMeeting,
          owner,
          {
            ...queuedJob,
            ...processingPatch,
          }
        ),
        sessionRef
          ? upsertLegacySessionJobSummary(
              sessionRef,
              effectiveMeeting,
              owner,
              {
                ...queuedJob,
                ...processingPatch,
              }
            )
          : Promise.resolve(),
      ]);

      try {
        const transcript = await transcribeMeetingAudio(audioBuffer, meeting, options, source);
        const meetingNotes = await maybeGenerateMeetingNotes(transcript, effectiveMeeting, options, context, logEvent, owner, jobId);
        const completedAt = new Date().toISOString();
        const artifact = buildTranscriptArtifact(artifactId, jobId, effectiveMeeting, owner, transcript, meetingNotes, completedAt);
        const deletedAt = await deleteTemporarySource(bucket, tempStorageObject);
        const succeededPatch = buildSucceededJobPatch(artifact, effectiveMeeting, options, sourceSnapshot, context, transcript, meetingNotes, completedAt, deletedAt);
        const succeededJob = {
          ...queuedJob,
          ...processingPatch,
          ...succeededPatch,
        };
        await Promise.all([
          artifactRef.set(artifact),
          jobRef.set(succeededPatch, { merge: true }),
          upsertMeetingJobSummary(meetingRef, effectiveMeeting, owner, succeededJob, artifact),
          sessionRef ? upsertLegacySessionJobSummary(sessionRef, effectiveMeeting, owner, succeededJob, artifact) : Promise.resolve(),
        ]);

        logEvent("meeting.create.success", {
          artifactId,
          captureMode: source.captureMode,
          jobId,
          meetingId: meeting.meetingId,
          providerUserKey: owner.providerUserKey,
          speakerCount: transcript.speakerCount,
        });
        response.json({
          ok: true,
          data: {
            job: queuedJob,
            reused: false,
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
          upsertMeetingJobSummary(
            meetingRef,
            effectiveMeeting,
            owner,
            {
              ...queuedJob,
              ...processingPatch,
              ...failedPatch,
            }
          ),
          sessionRef
            ? upsertLegacySessionJobSummary(
                sessionRef,
                effectiveMeeting,
                owner,
                {
                  ...queuedJob,
                  ...processingPatch,
                  ...failedPatch,
                }
              )
            : Promise.resolve(),
        ]);
        throw error;
      }
    } catch (error) {
      if (usesStorageSource && tempStorageObject) {
        await deleteTemporarySource(bucket, tempStorageObject);
      }
      logEvent("meeting.create.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const uploadInovaMeetingSource = onRequest({ cors: CORS_ORIGINS, region: REGION, timeoutSeconds: 540 }, async (request, response) => {
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

      const audioBuffer = Buffer.isBuffer(request.rawBody)
        ? request.rawBody
        : Buffer.from(request.rawBody || []);
      if (!audioBuffer.length) {
        throw createHttpError(400, "업로드한 오디오가 비어 있어요.");
      }

      const jobId = buildStableMeetingEntityId("meeting-job", owner.providerUserKey, input.meetingId, input.requestId);
      const storageObject = buildTempStorageObjectPath(owner.providerUserKey, input.meetingId, jobId, input.fileName);
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

      logEvent("meeting.source-upload.success", {
        bytes: audioBuffer.length,
        jobId,
        meetingId: input.meetingId,
        providerUserKey: owner.providerUserKey,
        requestId: input.requestId,
        storageObject: normalizeText(uploaded?.storageObject),
      });
      response.json({
        ok: true,
        data: {
          jobId,
          requestId: input.requestId,
          sizeBytes: audioBuffer.length,
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
        recentJobs,
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
          recentJobs: sessionRecentJobs,
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
        meetingNotes: meetingNotes.notes,
        notesGeneratedAt: meetingNotes.notesGeneratedAt,
        notesModeConfidence: meetingNotes.notesModeConfidence,
        notesModeDetected: meetingNotes.notesModeDetected,
        notesModeSelected: meetingNotes.notesModeSelected,
        notesStyleSelected: meetingNotes.notesStyleSelected,
        notesSchemaVersion: meetingNotes.notesSchemaVersion,
        speakerAliases,
        title: resultTitle,
        updatedAt,
      };
      const artifactPatch = {
        notes: meetingNotes.notes,
        notesGeneratedAt: meetingNotes.notesGeneratedAt,
        notesModeConfidence: meetingNotes.notesModeConfidence,
        notesModeDetected: meetingNotes.notesModeDetected,
        notesModeSelected: meetingNotes.notesModeSelected,
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
      if (job.status === "queued" || job.status === "processing") {
        throw createHttpError(409, "처리 중인 회의 결과는 아직 삭제할 수 없어요.");
      }

      const deletedAt = new Date().toISOString();
      const artifactIds = collectMeetingArtifactIds(job);
      const storageObject = normalizeText(job.source?.storageObject);

      if (storageObject) {
        await deleteTemporarySource(bucket, storageObject);
      }
      await Promise.all(
        artifactIds.map((artifactId) => deleteDocumentIfExists(db.collection(ARTIFACT_COLLECTION).doc(artifactId)))
      );
      await deleteDocumentIfExists(jobRef);

      const meeting = await removeMeetingResultFromSummaries(owner, job, deletedAt);

      logEvent("meeting.result.delete.success", {
        artifactCount: artifactIds.length,
        jobId: input.jobId,
        meetingId: input.meetingId,
        providerUserKey: owner.providerUserKey,
        storageObjectDeleted: Boolean(storageObject),
      });
      response.json({
        ok: true,
        data: {
          artifactCount: artifactIds.length,
          deletedAt,
          deletedJobId: input.jobId,
          meeting,
          storageObjectDeleted: Boolean(storageObject),
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
      const meeting = normalizeMeetingSummary(snapshot.data());
      assertMeetingOwnership(meeting, owner, createHttpError);
      if (meeting.deletedAt) {
        throw createHttpError(404, "이미 삭제된 회의예요.");
      }
      const jobs = await loadOwnedMeetingJobs(owner, meeting.meetingId);
      if (jobs.some((job) => job.status === "queued" || job.status === "processing")) {
        throw createHttpError(409, "처리 중인 기록이 있어 지금은 작업실 삭제를 할 수 없어요.");
      }

      const deletedAt = new Date().toISOString();
      const artifactIds = Array.from(new Set(jobs.flatMap((job) => collectMeetingArtifactIds(job))));
      const storageObjects = Array.from(new Set(
        jobs
          .map((job) => normalizeText(job.source?.storageObject))
          .filter(Boolean)
      ));

      await Promise.all(storageObjects.map((storageObject) => deleteTemporarySource(bucket, storageObject)));
      await Promise.all(artifactIds.map((artifactId) => deleteDocumentIfExists(db.collection(ARTIFACT_COLLECTION).doc(artifactId))));
      await Promise.all(jobs.map((job) => deleteDocumentIfExists(db.collection(JOB_COLLECTION).doc(job.jobId))));

      if (meeting.sessionId) {
        const sessionRef = db.collection(SESSION_COLLECTION).doc(buildSessionDocId(owner.providerUserKey, meeting.sessionId));
        await deleteDocumentIfExists(sessionRef);
      }
      await deleteDocumentIfExists(meetingRef);

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
    getInovaMeetingArtifact,
    getInovaMeetingJob,
    listInovaMeetings,
    listInovaMeetingResults,
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
      const meeting = normalizeMeetingSummary(snapshot.data());
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
    const legacySession = normalizeMeetingSession(snapshot.data());
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

  async function maybeGenerateMeetingNotes(transcript, meeting, options, context, logEvent, owner, jobId) {
    if (!options.summary) {
      return createEmptyMeetingNotesBundle();
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
      return createEmptyMeetingNotesBundle();
    }
  }

  async function generateMeetingNotesBundle(transcript, meeting, context, selectedMode, selectedStyle) {
    const promptTranscript = buildMeetingNotesTranscriptPrompt(transcript);
    if (!promptTranscript) {
      return createEmptyMeetingNotesBundle(selectedMode, null, selectedStyle);
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
      return createEmptyMeetingNotesBundle(notesModeSelected, detectedMode, notesStyleSelected);
    }
    return {
      notes: normalizeMeetingNotes(parseMeetingNotesJson(content), notesModeSelected),
      notesGeneratedAt: new Date().toISOString(),
      notesModeConfidence: normalizeConfidence(detectedMode.notesModeConfidence),
      notesModeDetected: normalizeMeetingNotesMode(detectedMode.notesModeDetected) || DEFAULT_NOTES_MODE,
      notesModeSelected,
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
      "topics와 executiveSummary는 회의 내용을 짧게 요약하되, 잘 되었다/옳다/필수다 같은 평가형 문장은 피한다.",
      "결과를 전문가 제안서, 컨설팅 보고서, 경영 판단 메모처럼 쓰지 말고 회의에서 나온 내용을 정리된 회의록처럼만 작성한다.",
      "executiveSummary는 1~3개의 짧은 항목으로 작성하고, 각 항목은 한두 문장 안에서 끝낸다.",
      "topics[].topic은 짧은 주제명만 적고 문장형 설명이나 중간 구분점(예: ·, /)을 길게 이어 붙이지 않는다.",
      "topics[].summary는 해당 주제에서 실제로 논의된 내용을 1~2문장으로만 적는다.",
      "topics[].keyPoints는 각각 독립된 짧은 항목으로 나누고, 여러 내용을 한 줄에 / 나 · 로 붙여 쓰지 않는다.",
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
      "openQuestions[]는 짧은 문자열 배열로 작성한다. 객체를 넣지 않는다.",
      "risksOrDependencies[]는 {text, severity} 형식이다.",
      "meetingMeta.title은 이 기록을 구분할 짧고 구체적인 한국어 제목 한 줄로 작성한다.",
      "meetingMeta.title은 범용적인 '회의', '회의록', '미팅'만 단독으로 쓰지 말고 핵심 주제를 드러낸다.",
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
  return {
    captureMode: ALLOWED_CAPTURE_MODES.has(captureMode) ? captureMode : "",
    channelCount: Math.max(0, Number(input?.channelCount) || 0),
    durationMs: Math.max(0, Number(input?.durationMs) || 0),
    fileName: normalizeText(input?.fileName) || buildDefaultFileName(input?.mimeType),
    inlineAudioBase64: normalizeText(input?.inlineAudioBase64),
    mimeType: normalizeText(input?.mimeType),
    requestId: normalizeText(input?.requestId),
    sizeBytes: Math.max(0, Number(input?.sizeBytes) || 0),
    storageObject: normalizeText(input?.storageObject),
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
    requestId: normalizeText(query.requestId),
    sizeBytes: Math.max(0, Number(query.sizeBytes) || 0),
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

function createEmptyMeetingNotesBundle(selectedMode, detectedMode, selectedStyle) {
  const selected = normalizeMeetingNotesMode(selectedMode) || normalizeMeetingNotesMode(detectedMode?.notesModeDetected) || DEFAULT_NOTES_MODE;
  const notesStyleSelected = normalizeMeetingNotesStyle(selectedStyle) || DEFAULT_NOTES_STYLE;
  return {
    notes: normalizeMeetingNotes({
      meetingMeta: {
        version: `v${NOTES_SCHEMA_VERSION}`,
      },
      mode: selected,
    }, selected),
    notesGeneratedAt: "",
    notesModeConfidence: normalizeConfidence(detectedMode?.notesModeConfidence),
    notesModeDetected: normalizeMeetingNotesMode(detectedMode?.notesModeDetected) || selected,
    notesModeSelected: selected,
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
    notesGeneratedAt: "",
    notesModeConfidence: 0,
    notesModeDetected: "",
    notesModeSelected: "",
    notesStyleSelected: DEFAULT_NOTES_STYLE,
    notesSchemaVersion: NOTES_SCHEMA_VERSION,
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
    title: normalizeText(meeting.title),
    transcription: {
      language: meeting.language,
      speakerLabels: options.speakerLabels,
    },
    updatedAt: createdAt,
  };
}

function buildSucceededJobPatch(artifact, meeting, options, source, context, transcript, meetingNotes, completedAt, deletedAt) {
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
      percent: 100,
      phase: "completed",
    },
    source: {
      ...source,
      uploadStatus: deletedAt ? "deleted" : source.uploadStatus,
    },
    status: "succeeded",
    context: normalizeMeetingContext(context),
    meetingNotes: normalizeMeetingNotes(meetingNotes?.notes),
    notesGeneratedAt: normalizeText(meetingNotes?.notesGeneratedAt || completedAt),
    notesModeConfidence: normalizeConfidence(meetingNotes?.notesModeConfidence),
    notesModeDetected: normalizeMeetingNotesMode(meetingNotes?.notesModeDetected),
    notesModeSelected: normalizeMeetingNotesMode(meetingNotes?.notesModeSelected),
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
    notes: normalizeMeetingNotes(meetingNotes?.notes),
    notesGeneratedAt: normalizeText(meetingNotes?.notesGeneratedAt || createdAt),
    notesModeConfidence: normalizeConfidence(meetingNotes?.notesModeConfidence),
    notesModeDetected: normalizeMeetingNotesMode(meetingNotes?.notesModeDetected),
    notesModeSelected: normalizeMeetingNotesMode(meetingNotes?.notesModeSelected),
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
    notesGeneratedAt: normalizeText(job.notesGeneratedAt),
    notesModeConfidence: normalizeConfidence(job.notesModeConfidence),
    notesModeDetected: normalizeMeetingNotesMode(job.notesModeDetected),
    notesModeSelected: normalizeMeetingNotesMode(job.notesModeSelected),
    notesStyleSelected: normalizeMeetingNotesStyle(job.notesStyleSelected) || DEFAULT_NOTES_STYLE,
    notesSchemaVersion: Math.max(1, Number(job.notesSchemaVersion) || NOTES_SCHEMA_VERSION),
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
    sessionId: normalizeText(job.sessionId || job.meeting?.sessionId),
    speakerAliases: normalizeSpeakerAliases(job.speakerAliases),
    source: {
      captureMode: normalizeText(job.source?.captureMode),
      channelCount: Math.max(0, Number(job.source?.channelCount) || 0),
      durationMs: Math.max(0, Number(job.source?.durationMs) || 0),
      expiresAt: normalizeText(job.source?.expiresAt),
      fileName: normalizeText(job.source?.fileName),
      mimeType: normalizeText(job.source?.mimeType),
      requestId: normalizeText(job.source?.requestId),
      sizeBytes: Math.max(0, Number(job.source?.sizeBytes) || 0),
      storageObject: normalizeText(job.source?.storageObject),
      uploadStatus: normalizeText(job.source?.uploadStatus),
    },
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
    notes: normalizeMeetingNotes(artifact.notes),
    notesGeneratedAt: normalizeText(artifact.notesGeneratedAt),
    notesModeConfidence: normalizeConfidence(artifact.notesModeConfidence),
    notesModeDetected: normalizeMeetingNotesMode(artifact.notesModeDetected),
    notesModeSelected: normalizeMeetingNotesMode(artifact.notesModeSelected),
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
    notesGeneratedAt: normalizeText(item.notesGeneratedAt),
    notesModeConfidence: normalizeConfidence(item.notesModeConfidence),
    notesModeDetected: normalizeMeetingNotesMode(item.notesModeDetected),
    notesModeSelected: normalizeMeetingNotesMode(item.notesModeSelected),
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
    notesGeneratedAt: normalizeText(artifact?.notesGeneratedAt || job.notesGeneratedAt),
    notesModeConfidence: normalizeConfidence(artifact?.notesModeConfidence || job.notesModeConfidence),
    notesModeDetected: normalizeMeetingNotesMode(artifact?.notesModeDetected || job.notesModeDetected),
    notesModeSelected: normalizeMeetingNotesMode(artifact?.notesModeSelected || job.notesModeSelected),
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
  const snapshot = await meetingRef.get();
  const currentMeeting = snapshot.exists ? normalizeMeetingSummary(snapshot.data()) : normalizeMeetingSummary({
    meetingId: meeting.meetingId,
    owner,
  });
  const jobSummary = buildMeetingResultSummary(jobInput, artifactInput);
  const nextDocument = buildMeetingSummaryDocument(meeting, owner, jobSummary, currentMeeting);
  await meetingRef.set(nextDocument, { merge: true });
}

async function upsertLegacySessionJobSummary(sessionRef, meeting, owner, jobInput, artifactInput) {
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

function assertMeetingOwnership(meeting, owner, createHttpError) {
  if (normalizeText(meeting.owner?.providerUserKey) !== normalizeText(owner?.providerUserKey)) {
    throw createHttpError(403, "현재 사용자에게 허용되지 않은 회의예요.");
  }
}

function assertSessionOwnership(session, owner, createHttpError) {
  if (normalizeText(session.owner?.providerUserKey) !== normalizeText(owner?.providerUserKey)) {
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
        notes: job.meetingNotes,
        notesGeneratedAt: job.notesGeneratedAt,
        notesModeConfidence: job.notesModeConfidence,
        notesModeDetected: job.notesModeDetected,
        notesModeSelected: job.notesModeSelected,
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

function getInlineAudioLimitBytes() {
  return Math.max(1024, Number(process.env.OPENAI_MEETING_INLINE_AUDIO_LIMIT_BYTES) || DEFAULT_INLINE_AUDIO_LIMIT_BYTES);
}

function normalizeText(value) {
  return String(value || "").trim();
}

module.exports = {
  registerMeetingHandlers,
};
