const crypto = require("crypto");
const OpenAI = require("openai");
const {
  buildDefaultFileName,
  buildTranscriptExcerpt,
  hasOwn,
  normalizeText,
  normalizeTextBlock,
  normalizeTranscriptSegment,
  safeParseJson,
} = require("./meeting-common-domain");
const { createMeetingNotesInputDomain } = require("./meeting-notes-context-domain");
const { createMeetingCreationDomain } = require("./meeting-creation-domain");
const { createMeetingDeletionDomain } = require("./meeting-deletion-domain");
const { createMeetingNotesDocumentDomain } = require("./meeting-notes-document-domain");
const { createMeetingNotesRuntimeDomain } = require("./meeting-notes-runtime-domain");
const { createMeetingNotesSourceDomain } = require("./meeting-notes-source-domain");
const { createMeetingMutationDomain } = require("./meeting-mutation-domain");
const { createMeetingProcessingDomain } = require("./meeting-processing-domain");
const { createMeetingRecordDomain } = require("./meeting-record-domain");
const { createMeetingSourceDomain } = require("./meeting-source-domain");
const { createMeetingSummarySyncDomain } = require("./meeting-summary-sync-domain");
const { createMeetingStateDomain } = require("./meeting-state-domain");
const { createMeetingTranscriptDomain } = require("./meeting-transcript-domain");

const ALLOWED_CAPTURE_MODES = new Set(["tab-audio", "microphone", "mixed-audio"]);
const DEFAULT_INLINE_AUDIO_LIMIT_BYTES = 25 * 1024 * 1024;
const DEFAULT_SOURCE_TARGET_PART_BYTES = 28 * 1024 * 1024;
const DEFAULT_SOURCE_MAX_BYTES = 200 * 1024 * 1024;
const DEFAULT_SOURCE_MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const DEFAULT_SOURCE_PART_OVERLAP_MS = 1500;
const DEFAULT_MEETING_PROCESS_RETRY_LIMIT = 2;
const DEFAULT_MODEL = "gpt-4o-transcribe";
const DEFAULT_SUMMARY_MODEL = "gpt-5.4";
const JOB_COLLECTION = "integration_inova_meeting_jobs";
const JOB_FINALIZER_COLLECTION = "integration_inova_meeting_job_finalizers";
const JOB_PART_COLLECTION = "integration_inova_meeting_job_parts";
const COMMAND_COLLECTION = "integration_inova_meeting_commands";
const DELETION_COLLECTION = "integration_inova_meeting_deletions";
const ARTIFACT_COLLECTION = "integration_inova_meeting_artifacts";
const LAUNCH_COLLECTION = "integration_inova_meeting_launches";
const MEETING_COLLECTION = "integration_inova_meetings";
const WORKSPACE_SESSION_COLLECTION = "integration_inova_meeting_workspace_sessions";
const TEMP_UPLOAD_TTL_MS = 60 * 60 * 1000;
const DELETION_RETRY_DELAY_MS = 60 * 60 * 1000;
const DELETION_PROCESSING_STALE_MS = 15 * 60 * 1000;
const MAX_MEETING_RECENT_RESULTS = 12;
const MAX_MEETING_LIST_LIMIT = 24;
const MAX_SUMMARY_TRANSCRIPT_CHARS = 12000;
const MAX_MEETING_NOTES_SECTION_CHARS = 9000;
const MAX_MEETING_NOTES_SECTION_COUNT = 8;
const MAX_MEETING_NOTES_GATE_TRANSCRIPT_CHARS = 1800;
const MIN_MEETING_NOTES_DIRECT_TEXT_CHARS = 180;
const MIN_MEETING_NOTES_DIRECT_SEGMENTS = 4;
const MIN_MEETING_NOTES_DIRECT_SENTENCES = 3;
const TARGET_REVIEW_SEGMENT_CHARS = 320;
const MAX_REVIEW_SEGMENT_CHARS = 420;
const MIN_REVIEW_SEGMENT_CHARS = 90;
const TARGET_REVIEW_SEGMENT_DURATION_MS = 30 * 1000;
const MAX_REVIEW_SEGMENT_DURATION_MS = 45 * 1000;
const MIN_REVIEW_SEGMENT_DURATION_MS = 12 * 1000;
const MAX_MEETING_NOTES_SUMMARY_ITEMS = 3;
const MAX_MEETING_NOTES_TOPIC_COUNT = 4;
const MAX_MEETING_NOTES_TOPIC_KEY_POINTS = 4;
const MAX_MEETING_NOTES_TOPIC_DECISIONS = 3;
const MAX_MEETING_NOTES_TOPIC_OPEN_QUESTIONS = 2;
const MAX_MEETING_NOTES_DECISIONS = 5;
const MAX_MEETING_NOTES_ACTION_ITEMS = 5;
const MAX_MEETING_NOTES_OPEN_QUESTIONS = 3;
const MAX_MEETING_NOTES_RISKS = 3;
const MAX_MEETING_NOTES_SOURCE_TRACE = 6;
const MAX_COMPACT_MEETING_NOTES_OVERVIEW_CHARS = 180;
const MAX_COMPACT_MEETING_NOTES_TITLE_CHARS = 48;
const MAX_COMPACT_MEETING_NOTES_LINE_CHARS = 96;
const MAX_MEETING_SECTION_EDIT_INSTRUCTION_CHARS = 1600;
const MAX_MEETING_TERM_REPLACEMENTS = 24;
const MAX_MEETING_TERM_REPLACEMENT_FROM_CHARS = 120;
const MAX_MEETING_TERM_REPLACEMENT_TO_CHARS = 120;
const MAX_SHARED_MEMO_CHARS = 12000;
const NOTES_SCHEMA_VERSION = 3;
const RETRYABLE_MEETING_PROCESS_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const SUPPORTED_NOTES_STATUSES = new Set(["pending", "disabled", "skipped", "degraded", "succeeded"]);
const SUPPORTED_MEETING_COMMAND_STATUSES = new Set(["queued", "processing", "succeeded", "failed"]);
const SUPPORTED_MEETING_COMMAND_TYPES = new Set(["regenerate_notes"]);
const SUPPORTED_DELETION_SCOPES = new Set(["meeting", "result"]);
const SUPPORTED_DELETION_STATUSES = new Set(["queued", "processing", "retry"]);
const SUPPORTED_WORKSPACE_MUTATION_STATUSES = new Set(["queued", "processing", "succeeded", "failed"]);
const SUPPORTED_WORKSPACE_MUTATION_TYPES = new Set([
  "applySectionEdit",
  "deleteMeeting",
  "deleteRecord",
  "saveMeetingMemo",
  "saveMeetingTermReplacements",
  "saveMeetingTitle",
  "saveRecordMemo",
  "saveRecordTitle",
]);
const EDITABLE_MEETING_SECTION_KEYS = new Set([
  "overview",
  "discussionFlow",
  "decisions",
  "openQuestions",
  "risksOrDependencies",
  "actionItems",
]);

const {
  applyMeetingTermReplacements,
  createEmptyMeetingNotes,
  dedupeMeetingItems,
  getMeetingNotesPreviewText,
  hasMeetingNotes,
  normalizeMeetingComparisonText,
  normalizeMeetingNotes,
  normalizeMeetingNotesStatus,
  parseMeetingNotesJson,
} = createMeetingNotesDocumentDomain({
  buildTranscriptExcerpt,
  crypto,
  normalizeText,
  normalizeTextBlock,
  supportedNotesStatuses: SUPPORTED_NOTES_STATUSES,
  limits: {
    MAX_MEETING_NOTES_ACTION_ITEMS,
    MAX_MEETING_NOTES_DECISIONS,
    MAX_MEETING_NOTES_OPEN_QUESTIONS,
    MAX_MEETING_NOTES_RISKS,
    MAX_MEETING_NOTES_SOURCE_TRACE,
    MAX_MEETING_NOTES_TOPIC_COUNT,
    MAX_MEETING_NOTES_TOPIC_KEY_POINTS,
  },
});

const {
  normalizeMeetingContext,
  normalizeMeetingNotesInputSnapshot,
  normalizeMeetingTermReplacements,
} = createMeetingNotesInputDomain({
  hasOwn,
  normalizeText,
  normalizeTextBlock,
  limits: {
    MAX_MEETING_TERM_REPLACEMENTS,
    MAX_MEETING_TERM_REPLACEMENT_FROM_CHARS,
    MAX_MEETING_TERM_REPLACEMENT_TO_CHARS,
    MAX_SHARED_MEMO_CHARS,
  },
});

const {
  createEmptyMeetingNotesBundle,
  createMeetingNotesBundleFromNotes,
  normalizeCompletionContent,
} = createMeetingNotesRuntimeDomain({
  createEmptyMeetingNotes,
  hasMeetingNotes,
  normalizeMeetingNotes,
  normalizeMeetingNotesStatus,
  normalizeText,
  notesSchemaVersion: NOTES_SCHEMA_VERSION,
});

const {
  buildMeetingDeletionTaskId,
  buildWorkspaceMutation,
  normalizeMeetingCommand,
  normalizeMeetingDeletionTask,
  normalizeMeetingHubListRequest,
  normalizeMeetingMutationRequest,
  normalizeMeetingResultMutationRequest,
  normalizeMeetingSectionEditApplyRequest,
  normalizeMeetingSectionEditPreviewRequest,
  normalizeMeetingTaskOwner,
  normalizeWorkspaceMutation,
} = createMeetingMutationDomain({
  editableMeetingSectionKeys: EDITABLE_MEETING_SECTION_KEYS,
  hasOwn,
  normalizeMeetingTermReplacements,
  normalizeText,
  normalizeTextBlock,
  supportedMeetingCommandStatuses: SUPPORTED_MEETING_COMMAND_STATUSES,
  supportedMeetingCommandTypes: SUPPORTED_MEETING_COMMAND_TYPES,
  supportedDeletionScopes: SUPPORTED_DELETION_SCOPES,
  supportedDeletionStatuses: SUPPORTED_DELETION_STATUSES,
  supportedWorkspaceMutationStatuses: SUPPORTED_WORKSPACE_MUTATION_STATUSES,
  supportedWorkspaceMutationTypes: SUPPORTED_WORKSPACE_MUTATION_TYPES,
  limits: {
    MAX_MEETING_LIST_LIMIT,
    MAX_MEETING_SECTION_EDIT_INSTRUCTION_CHARS,
    MAX_SHARED_MEMO_CHARS,
  },
});

const {
  buildMeetingNotesTranscriptPrompt,
  buildMeetingNotesTranscriptSections,
  buildTranscriptText,
  resegmentTranscriptForReview,
} = createMeetingTranscriptDomain({
  normalizeText,
  normalizeTextBlock,
  normalizeTranscriptSegment,
  limits: {
    MAX_MEETING_NOTES_SECTION_CHARS,
    MAX_MEETING_NOTES_SECTION_COUNT,
    MAX_REVIEW_SEGMENT_CHARS,
    MAX_REVIEW_SEGMENT_DURATION_MS,
    MAX_SUMMARY_TRANSCRIPT_CHARS,
    MIN_REVIEW_SEGMENT_CHARS,
    MIN_REVIEW_SEGMENT_DURATION_MS,
    TARGET_REVIEW_SEGMENT_CHARS,
    TARGET_REVIEW_SEGMENT_DURATION_MS,
  },
});

const {
  buildQueuedMeetingJobFinalizer,
  buildQueuedMeetingJobPart,
  normalizeMeetingJobFinalizer,
  normalizeMeetingJobPart,
  normalizeMeetingOptions,
  normalizeMeetingRequest,
  normalizeMeetingSource,
  normalizeMeetingSourceMode,
  normalizeMeetingSourcePart,
  normalizeMeetingSourceUploadRequest,
} = createMeetingSourceDomain({
  allowedCaptureModes: ALLOWED_CAPTURE_MODES,
  buildDefaultFileName,
  normalizeMeetingJob: normalizeMeetingJobForSource,
  normalizeText,
  normalizeTextBlock,
  limits: {
    MAX_SHARED_MEMO_CHARS,
  },
});

const {
  buildMeetingResultSummary,
  compareMeetingResults,
  compareMeetings,
  mergeRecentJobs,
  normalizeArtifactSummary,
  normalizeMeetingArtifact,
  normalizeMeetingJob,
  normalizeMeetingResultSummary,
  normalizeMeetingShareSummary,
  normalizeMeetingSummary,
  normalizeTranscriptionResponse,
} = createMeetingStateDomain({
  buildTranscriptExcerpt,
  getMeetingNotesPreviewText,
  normalizeMeetingContext,
  normalizeMeetingNotes,
  normalizeMeetingNotesInputSnapshot,
  normalizeMeetingNotesStatus,
  normalizeMeetingSource,
  normalizeMeetingTermReplacements,
  normalizeTranscriptSegment,
  normalizeWorkspaceMutation,
  resegmentTranscriptForReview,
  normalizeText,
  normalizeTextBlock,
  limits: {
    MAX_MEETING_RECENT_RESULTS,
    MAX_SHARED_MEMO_CHARS,
    NOTES_SCHEMA_VERSION,
  },
});

const {
  buildChunkTranscriptStorageObjectPath,
  buildMeetingDocId,
  buildMeetingJobPartId,
  buildMeetingRecentJobsPatch,
  buildMeetingSummaryDocument,
  buildQueuedJob,
  buildStableMeetingEntityId,
  buildSucceededJobPatch,
  buildTempStorageObjectPath,
  buildTranscriptArtifact,
  resolveMeetingResultTitle,
} = createMeetingRecordDomain({
  compareMeetingResults,
  crypto,
  mergeRecentJobs,
  normalizeMeetingContext,
  normalizeMeetingNotes,
  normalizeMeetingNotesInputSnapshot,
  normalizeMeetingNotesStatus,
  normalizeMeetingResultSummary,
  normalizeMeetingSummary,
  normalizeMeetingTermReplacements,
  normalizeText,
  normalizeTextBlock,
  limits: {
    MAX_MEETING_RECENT_RESULTS,
    MAX_SHARED_MEMO_CHARS,
    NOTES_SCHEMA_VERSION,
  },
});

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

  const {
    loadMeetingArtifactSource,
    loadMeetingNotesSource,
    loadMeetingTranscriptForNotes,
  } = createMeetingNotesSourceDomain({
    artifactCollection: ARTIFACT_COLLECTION,
    db,
    maxSharedMemoChars: MAX_SHARED_MEMO_CHARS,
    normalizeMeetingArtifact,
    normalizeMeetingJob,
    normalizeMeetingNotesInputSnapshot,
    normalizeText,
    normalizeTextBlock,
  });

  const {
    assertMeetingIsActive,
    loadMeetingSummaryRecord,
    removeMeetingResultFromSummaries,
    updateMeetingSummaryRecordResult,
    upsertMeetingJobSummary,
  } = createMeetingSummarySyncDomain({
    assertMeetingOwnership,
    buildMeetingDocId,
    buildMeetingRecentJobsPatch,
    buildMeetingResultSummary,
    buildMeetingSummaryDocument,
    db,
    meetingCollection: MEETING_COLLECTION,
    mergeRecentJobs,
    normalizeMeetingArtifact,
    normalizeMeetingJob,
    normalizeMeetingSummary,
    normalizeText,
  });

  const {
    enqueueMeetingDeletionTask,
    isMeetingDeletionRetryDue,
    processMeetingDeletionTask,
    shouldProcessMeetingDeletionTask,
  } = createMeetingDeletionDomain({
    artifactCollection: ARTIFACT_COLLECTION,
    buildMeetingDeletionTaskId,
    buildMeetingDocId,
    collectMeetingArtifactIds,
    db,
    deleteDocumentIfExists,
    deleteMeetingJobRuntimeArtifacts,
    deleteMeetingScopedRuntimeArtifacts,
    deletionCollection: DELETION_COLLECTION,
    deletionProcessingStaleMs: DELETION_PROCESSING_STALE_MS,
    deletionRetryDelayMs: DELETION_RETRY_DELAY_MS,
    jobCollection: JOB_COLLECTION,
    jobFinalizerCollection: JOB_FINALIZER_COLLECTION,
    loadMeetingCommandDocsByJobId,
    loadMeetingCommandDocsByMeetingId,
    loadMeetingJobPartDocs,
    loadMeetingLaunchDocs,
    loadMeetingWorkspaceSessionDocs,
    loadOwnedMeetingJobs,
    loadStoredMeetingJob,
    logEvent,
    meetingCollection: MEETING_COLLECTION,
    normalizeIdentity,
    normalizeMeetingDeletionTask,
    normalizeMeetingJob,
    normalizeMeetingSource,
    normalizeMeetingSummary,
    normalizeText,
  });

  const {
    finalizeChunkedMeetingJobWrite,
    maybeQueueMeetingJobFinalizer,
    persistMeetingJobPatch,
    processQueuedMeetingJobPartWrite,
    processQueuedMeetingJobWrite,
    promoteWaitingMeetingJobParts,
    synchronizeChunkedMeetingJobProgress,
    upsertQueuedMeetingJobParts,
  } = createMeetingProcessingDomain({
    artifactCollection: ARTIFACT_COLLECTION,
    bucket,
    buildChunkTranscriptStorageObjectPath,
    buildMeetingDocId,
    buildMeetingJobPartId,
    buildMeetingPartFileName,
    buildQueuedMeetingJobFinalizer,
    buildQueuedMeetingJobPart,
    buildSucceededJobPatch,
    buildTranscriptArtifact,
    collectMeetingChunkTranscriptStorageObjects,
    collectMeetingSourceStorageObjects,
    createHttpError,
    db,
    deleteDocumentIfExists,
    deleteTemporarySourceGroup,
    finalizeCollection: JOB_FINALIZER_COLLECTION,
    formatMeetingProcessErrorMessage,
    getMeetingArtifactId,
    getMeetingChunkWorkerQueueConcurrency,
    getMeetingProcessRetryLimit,
    isRetryableMeetingProcessError,
    jobCollection: JOB_COLLECTION,
    jobPartCollection: JOB_PART_COLLECTION,
    loadMeetingChunkTranscript,
    loadMeetingJobPartDocs,
    loadMeetingSourcePartAudioBuffer,
    loadStoredMeetingJob,
    logEvent,
    logMeetingCleanupWarning,
    markMeetingSourceDeleted,
    maybeGenerateMeetingNotes,
    meetingCollection: MEETING_COLLECTION,
    mergeChunkTranscripts,
    mergeMeetingJobPatch,
    normalizeMeetingContext,
    normalizeMeetingJob,
    normalizeMeetingJobFinalizer,
    normalizeMeetingJobPart,
    normalizeMeetingOptions,
    normalizeMeetingRequest,
    normalizeMeetingSource,
    normalizeText,
    saveMeetingChunkTranscript,
    transcribeMeetingAudio,
    transcribeQueuedMeetingSource,
    upsertMeetingJobSummary,
  });

  const {
    createMeetingJob,
    persistUploadedMeetingSourceToExistingJob,
  } = createMeetingCreationDomain({
    assertInlineOnlyFallbackAllowed,
    assertJobOwnership,
    assertMeetingIsActive,
    assertWorkspaceMeetingAccess,
    buildMeetingDocId,
    buildQueuedJob,
    buildStableMeetingEntityId,
    buildTempStorageObjectPath,
    bucket,
    createHttpError,
    db,
    defaultSourcePartOverlapMs: DEFAULT_SOURCE_PART_OVERLAP_MS,
    deleteTemporarySourceGroup,
    getInlineAudioLimitBytes,
    getMeetingSourceMaxBytes,
    getMeetingSourceMaxDurationMs,
    getMeetingSourceTargetPartBytes,
    jobCollection: JOB_COLLECTION,
    loadSourceAudioBuffer,
    logEvent,
    logMeetingCleanupWarning,
    maybeQueueMeetingJobFinalizer,
    meetingCollection: MEETING_COLLECTION,
    mergeMeetingJobPatch,
    normalizeMeetingContext,
    normalizeMeetingJob,
    normalizeMeetingOptions,
    normalizeMeetingRequest,
    normalizeMeetingSource,
    normalizeMeetingSourceMode,
    normalizeMeetingSourcePart,
    normalizeText,
    persistMeetingJobPatch,
    synchronizeChunkedMeetingJobProgress,
    tempUploadTtlMs: TEMP_UPLOAD_TTL_MS,
    upsertMeetingJobSummary,
    upsertQueuedMeetingJobParts,
    uploadTemporarySource,
  });

  const createInovaMeetingJob = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const access = await verifyRequestIdentity(request);
      const inlineOnlyOptions = {
        allowInlineOnly: shouldAllowInlineOnlyMeetingSource(),
        requestOrigin: resolveRequestOrigin(request),
      };
      const result = await createMeetingJob({
        access,
        context: request.body?.context,
        inlineOnlyOptions,
        meeting: request.body?.meeting,
        options: request.body?.options,
        source: request.body?.source,
      });
      response.json({
        ok: true,
        data: result,
      });
    } catch (error) {
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
    maxInstances: 150,
    memory: "512MiB",
    region: REGION,
    timeoutSeconds: 60,
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

  const updateInovaMeeting = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const input = normalizeMeetingMutationRequest(request.body);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;

      if (!input.meetingId) {
        throw createHttpError(400, "회의 ID가 없어요.");
      }
      if (!input.hasSharedMemo && !input.hasTitle && !input.hasTermReplacements) {
        throw createHttpError(400, "수정할 회의 내용이 없어요.");
      }
      if (input.hasTitle && !input.title) {
        throw createHttpError(400, "회의 제목을 입력해 주세요.");
      }
      assertValidMeetingTermReplacementRequest(request.body?.termReplacements, input.termReplacements, input.hasTermReplacements, createHttpError);
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
      const nextTermReplacements = input.hasTermReplacements
        ? input.termReplacements
        : currentMeeting.termReplacements;
      const recentJobs = currentMeeting.recentJobs.map((item) => (
        input.hasTitle && shouldSyncMeetingTitleToResult(item, previousTitle)
          ? {
              ...item,
              title: nextTitle,
            }
          : item
      ));
      const updatedAt = new Date().toISOString();
      const workspaceMutation = buildWorkspaceMutation({
        completedAt: updatedAt,
        requestId: input.clientRequestId,
        requestedAt: updatedAt,
        status: "succeeded",
        type: input.hasTermReplacements
          ? "saveMeetingTermReplacements"
          : input.hasTitle
            ? "saveMeetingTitle"
            : "saveMeetingMemo",
      });
      const nextMeetingPatch = {
        createdAt: currentMeeting.createdAt || updatedAt,
        meetingId: currentMeeting.meetingId || input.meetingId,
        owner: normalizeText(currentMeeting.owner?.providerUserKey) ? currentMeeting.owner : owner,
        recentJobs,
        sessionId: currentMeeting.sessionId,
        sharedMemo: nextSharedMemo,
        termReplacements: nextTermReplacements,
        title: nextTitle,
        updatedAt,
        ...(workspaceMutation.requestId ? { workspaceMutation } : {}),
      };
      await meetingRef.set(nextMeetingPatch, { merge: true });
      const nextMeeting = normalizeMeetingSummary({
        ...currentMeeting,
        ...nextMeetingPatch,
      });

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
      if (input.hasTermReplacements) {
        await applyMeetingTermReplacementsAcrossMeeting(owner, input.meetingId, nextTermReplacements, updatedAt);
      }

      const refreshedSnapshot = await meetingRef.get();
      const responseMeeting = refreshedSnapshot.exists
        ? normalizeMeetingSummary(refreshedSnapshot.data())
        : nextMeeting;

      logEvent("meeting.update.success", {
        meetingId: input.meetingId,
        mutation: workspaceMutation.type,
        providerUserKey: owner.providerUserKey,
      });
      response.json({
        ok: true,
        data: {
          accepted: true,
          meeting: responseMeeting,
          requestId: input.clientRequestId,
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
      if (!input.titleProvided && !input.sharedMemoProvided) {
        throw createHttpError(400, "수정할 회의 결과 내용이 비어 있어요.");
      }
      if (input.titleProvided && !input.title) {
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

      const {
        artifact,
        artifactRef,
        notesInputSnapshot: existingNotesInputSnapshot,
        sharedMemoSnapshot: currentSharedMemoSnapshot,
      } = await loadMeetingNotesSource(job);
      const updatedAt = new Date().toISOString();
      const mutationType = input.titleProvided
        ? "saveRecordTitle"
        : "saveRecordMemo";
      const workspaceMutation = buildWorkspaceMutation({
        completedAt: updatedAt,
        requestId: input.clientRequestId,
        requestedAt: updatedAt,
        status: "succeeded",
        type: mutationType,
      });
      const persistedSharedMemo = input.sharedMemoProvided
        ? input.sharedMemo
        : currentSharedMemoSnapshot;
      const shouldInitializeNotesInputSnapshot = !normalizeText(existingNotesInputSnapshot.updatedAt)
        && Boolean(normalizeText(artifact?.notesGeneratedAt || job.notesGeneratedAt));
      const baselineNotesInputSnapshot = shouldInitializeNotesInputSnapshot
        ? normalizeMeetingNotesInputSnapshot({
            sharedMemo: currentSharedMemoSnapshot,
            updatedAt: normalizeText(artifact?.notesGeneratedAt || job.notesGeneratedAt || job.updatedAt || updatedAt),
          })
        : existingNotesInputSnapshot;
      const nextContext = normalizeMeetingContext({
        ...job.context,
        sharedMemoSnapshot: persistedSharedMemo,
      });
      const jobPatch = {};
      if (input.titleProvided) {
        jobPatch.title = input.title;
        jobPatch.updatedAt = updatedAt;
      }
      if (input.sharedMemoProvided) {
        jobPatch.context = nextContext;
        jobPatch.updatedAt = updatedAt;
      }
      if (shouldInitializeNotesInputSnapshot) {
        jobPatch.notesInputSnapshot = baselineNotesInputSnapshot;
      }
      if (workspaceMutation.requestId) {
        jobPatch.workspaceMutation = workspaceMutation;
      }
      const artifactPatch = {};
      if (shouldInitializeNotesInputSnapshot) {
        artifactPatch.notesInputSnapshot = baselineNotesInputSnapshot;
      }

      const nextJob = normalizeMeetingJob({
        ...job,
        ...jobPatch,
      });
      const nextArtifact = artifact
        ? normalizeMeetingArtifact({
            ...artifact,
            ...artifactPatch,
          })
        : null;

      const writes = [];
      if (Object.keys(jobPatch).length) {
        writes.push(jobRef.set(jobPatch, { merge: true }));
      }
      if (artifactRef && Object.keys(artifactPatch).length) {
        writes.push(artifactRef.set(artifactPatch, { merge: true }));
      }
      if (writes.length) {
        await Promise.all(writes);
        await updateMeetingSummaryRecordResult(owner, nextJob, nextArtifact, updatedAt);
      }

      logEvent("meeting.result.update.success", {
        jobId: input.jobId,
        meetingId: input.meetingId,
        providerUserKey: owner.providerUserKey,
      });
      response.json({
        ok: true,
        data: {
          accepted: true,
          requestId: input.clientRequestId,
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

  const previewInovaMeetingResultSectionEdit = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const input = normalizeMeetingSectionEditPreviewRequest(request.body);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;

      if (!input.meetingId || !input.jobId) {
        throw createHttpError(400, "회의 결과를 수정할 ID가 비어 있어요.");
      }
      if (!input.sectionKey) {
        throw createHttpError(400, "수정할 섹션을 확인해 주세요.");
      }
      if (!input.instruction) {
        throw createHttpError(400, "섹션 수정 요청을 입력해 주세요.");
      }
      assertWorkspaceMeetingAccess(access, input.meetingId, createHttpError);
      const preview = await previewMeetingNotesSectionEdit(input, owner);
      response.json({
        ok: true,
        data: {
          baseRevisionToken: preview.baseRevisionToken,
          sectionData: preview.sectionData,
          sectionKey: preview.sectionKey,
          warning: normalizeTextBlock(preview.warning),
        },
      });
    } catch (error) {
      logEvent("meeting.notes.section-edit.preview.error", {
        error: normalizeText(error?.message),
        status: Number(error?.status) || 500,
      });
      sendError(response, error);
    }
  });

  const applyInovaMeetingResultSectionEdit = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const input = normalizeMeetingSectionEditApplyRequest(request.body);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;

      if (!input.meetingId || !input.jobId) {
        throw createHttpError(400, "회의 결과를 수정할 ID가 비어 있어요.");
      }
      if (!input.sectionKey) {
        throw createHttpError(400, "수정할 섹션을 확인해 주세요.");
      }
      if (!input.baseRevisionToken) {
        throw createHttpError(400, "미리보기 기준 버전을 확인해 주세요.");
      }
      assertWorkspaceMeetingAccess(access, input.meetingId, createHttpError);
      const applied = await applyMeetingNotesSectionEdit(input, owner);
      response.json({
        ok: true,
        data: {
          accepted: true,
          notes: applied.notes,
          requestId: applied.requestId,
          sectionKey: applied.sectionKey,
          title: applied.title,
        },
      });
    } catch (error) {
      logEvent("meeting.notes.section-edit.apply.error", {
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
      assertJobOwnership(job, owner, createHttpError);
      if (job.meetingId !== input.meetingId) {
        throw createHttpError(404, "현재 회의와 맞지 않는 결과예요.");
      }

      const deletedAt = new Date().toISOString();
      const workspaceMutation = buildWorkspaceMutation({
        completedAt: deletedAt,
        requestId: input.clientRequestId,
        requestedAt: deletedAt,
        status: "succeeded",
        type: "deleteRecord",
      });
      await softDeleteMeetingJob(job, deletedAt, {
        workspaceMutation,
      });
      await removeMeetingResultFromSummaries(owner, job, deletedAt);
      const deletionTask = await enqueueMeetingDeletionTask({
        deletedAt,
        jobId: job.jobId,
        meetingId: job.meetingId,
        owner,
        scope: "result",
        sessionId: job.sessionId,
      });

      logEvent("meeting.result.delete.success", {
        jobId: input.jobId,
        meetingId: input.meetingId,
        providerUserKey: owner.providerUserKey,
        queueTaskId: deletionTask.taskId,
      });
      response.json({
        ok: true,
        data: {
          accepted: true,
          cleanupQueued: true,
          deletedAt,
          jobId: input.jobId,
          meetingId: input.meetingId,
          queueTaskId: deletionTask.taskId,
          requestId: input.clientRequestId,
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
          meetingId: meeting.meetingId || input.meetingId,
          owner,
        }, { merge: true });
        meeting = normalizeMeetingSummary({
          ...meeting,
          meetingId: meeting.meetingId || input.meetingId,
          owner,
        });
      }
      assertMeetingOwnership(meeting, owner, createHttpError);
      const jobs = await loadOwnedMeetingJobs(owner, meeting.meetingId);
      const deletedAt = new Date().toISOString();
      for (const job of jobs) {
        await softDeleteMeetingJob(job, deletedAt);
      }

      const workspaceMutation = buildWorkspaceMutation({
        completedAt: deletedAt,
        requestId: input.clientRequestId,
        requestedAt: deletedAt,
        status: "succeeded",
        type: "deleteMeeting",
      });
      await meetingRef.set({
        deletedAt,
        recentJobs: [],
        updatedAt: deletedAt,
        workspaceMutation,
      }, { merge: true });
      const deletionTask = await enqueueMeetingDeletionTask({
        deletedAt,
        jobIds: jobs.map((job) => job.jobId),
        meetingId: input.meetingId,
        owner,
        scope: "meeting",
      });

      logEvent("meeting.delete.success", {
        jobCount: jobs.length,
        meetingId: input.meetingId,
        providerUserKey: owner.providerUserKey,
        queueTaskId: deletionTask.taskId,
      });
      response.json({
        ok: true,
        data: {
          accepted: true,
          cleanupQueued: true,
          deletedAt,
          meetingId: input.meetingId,
          queueTaskId: deletionTask.taskId,
          requestId: input.clientRequestId,
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

  const processQueuedMeetingCommandWrite = async (event) => {
    const beforeSnapshot = event?.data?.before || null;
    const afterSnapshot = event?.data?.after || null;
    if (!afterSnapshot?.exists) {
      return;
    }
    const previousCommand = beforeSnapshot?.exists ? normalizeMeetingCommand(beforeSnapshot.data()) : null;
    const queuedCommand = normalizeMeetingCommand(afterSnapshot.data());
    if (!queuedCommand.clientRequestId) {
      return;
    }
    if (queuedCommand.status !== "queued" || normalizeText(previousCommand?.status) === "queued") {
      return;
    }
    const completedAt = new Date().toISOString();
    await afterSnapshot.ref.set({
      completedAt,
      error: "지원이 종료된 회의 명령입니다.",
      status: "failed",
      updatedAt: completedAt,
    }, { merge: true });
  };

  const processMeetingDeletionWrite = async (event) => {
    const beforeSnapshot = event?.data?.before || null;
    const afterSnapshot = event?.data?.after || null;
    if (!afterSnapshot?.exists) {
      return;
    }
    const previousTask = beforeSnapshot?.exists ? normalizeMeetingDeletionTask(beforeSnapshot.data()) : null;
    const queuedTask = normalizeMeetingDeletionTask(afterSnapshot.data());
    if (!queuedTask.taskId) {
      return;
    }
    if (!shouldProcessMeetingDeletionTask(queuedTask, previousTask)) {
      return;
    }
    await processMeetingDeletionTask(afterSnapshot.ref, "firestore");
  };

  const sweepQueuedMeetingDeletions = async () => {
    const snapshot = await db.collection(DELETION_COLLECTION).get();
    const tasks = (Array.isArray(snapshot?.docs) ? snapshot.docs : [])
      .map((doc) => ({
        docId: doc.id,
        ref: doc.ref,
        task: normalizeMeetingDeletionTask(doc.data()),
      }))
      .filter((entry) => entry.task.taskId)
      .filter((entry) => isMeetingDeletionRetryDue(entry.task));
    let processedCount = 0;
    for (const entry of tasks) {
      const processed = await processMeetingDeletionTask(entry.ref, "schedule");
      if (processed) {
        processedCount += 1;
      }
    }
    logEvent("meeting.deletion.sweep.success", {
      processedCount,
      queuedCount: tasks.length,
    });
  };

  return {
    applyInovaMeetingResultSectionEdit,
    createInovaMeetingJob,
    deleteInovaMeeting,
    deleteInovaMeetingResult,
    finalizeChunkedMeetingJobWrite,
    listInovaMeetings,
    previewInovaMeetingResultSectionEdit,
    processQueuedMeetingCommandWrite,
    processMeetingDeletionWrite,
    processQueuedMeetingJobWrite,
    processQueuedMeetingJobPartWrite,
    sweepQueuedMeetingDeletions,
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
      readOnly: false,
      workspaceSession: null,
    };
  }

  function assertWorkspaceMeetingAccess(access, meetingId, createHttpError) {
    if (access?.readOnly) {
      throw createHttpError(403, "공유 링크는 읽기 전용이라 수정할 수 없어요.");
    }
    const sessionMeetingId = normalizeText(
      access?.firebaseSession?.meetingId
      || access?.workspaceSession?.meeting?.meetingId
    );
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
    if (!targetBucket) {
      throw createHttpError(500, "회의 임시 오디오를 저장할 bucket이 설정되지 않았어요.");
    }
    if (!storageObject) {
      throw createHttpError(500, "회의 임시 오디오 저장 경로를 준비하지 못했어요.");
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
      throw createHttpError(500, "회의 임시 오디오 업로드를 저장하지 못했어요.");
    }
  }

  async function deleteTemporarySource(targetBucket, storageObject) {
    const normalizedStorageObject = normalizeText(storageObject);
    if (!normalizedStorageObject) {
      return {
        deletedAt: "",
        error: "",
        storageObject: "",
      };
    }
    if (!targetBucket) {
      return {
        deletedAt: "",
        error: "storage-bucket-missing",
        storageObject: normalizedStorageObject,
      };
    }
    try {
      await targetBucket.file(normalizedStorageObject).delete({ ignoreNotFound: true });
      return {
        deletedAt: new Date().toISOString(),
        error: "",
        storageObject: normalizedStorageObject,
      };
    } catch (error) {
      return {
        deletedAt: "",
        error: normalizeText(error?.message) || "storage-delete-failed",
        storageObject: normalizedStorageObject,
      };
    }
  }

  async function deleteTemporarySourceGroup(targetBucket, storageObjects) {
    const deletedStorageObjects = [];
    const failedStorageObjects = [];
    for (const storageObject of Array.from(new Set((storageObjects || []).map((value) => normalizeText(value)).filter(Boolean)))) {
      const deletion = await deleteTemporarySource(targetBucket, storageObject);
      if (deletion.deletedAt) {
        deletedStorageObjects.push(storageObject);
        continue;
      }
      if (deletion.error) {
        failedStorageObjects.push(storageObject);
      }
    }
    return {
      deletedAt: deletedStorageObjects.length ? new Date().toISOString() : "",
      deletedStorageObjects,
      failedStorageObjects,
      warningMessage: failedStorageObjects.length ? `임시 오디오 정리 ${failedStorageObjects.length}건이 남았어요.` : "",
    };
  }

  function logMeetingCleanupWarning(eventName, deletion, context = {}) {
    const failedStorageObjects = Array.isArray(deletion?.failedStorageObjects) ? deletion.failedStorageObjects : [];
    if (!failedStorageObjects.length) {
      return;
    }
    logEvent(eventName, {
      ...context,
      failedStorageObjectCount: failedStorageObjects.length,
      failedStorageObjects: failedStorageObjects.slice(0, 5),
      warning: normalizeText(deletion?.warningMessage),
    });
  }

  function shouldAllowInlineOnlyMeetingSource() {
    const explicitFlag = normalizeText(process.env.OPENAI_MEETING_ALLOW_INLINE_ONLY).toLowerCase();
    if (["1", "true", "yes", "on"].includes(explicitFlag)) {
      return true;
    }
    if (normalizeText(process.env.NODE_ENV).toLowerCase() === "test") {
      return true;
    }
    return normalizeText(process.env.FUNCTIONS_EMULATOR).toLowerCase() === "true";
  }

  function resolveRequestOrigin(request) {
    return normalizeText(
      request?.headers?.origin
      || request?.get?.("origin")
      || request?.rawRequest?.headers?.origin
    );
  }

  function assertInlineOnlyFallbackAllowed(options, error) {
    if (!options.allowInlineOnly) {
      throw error;
    }
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

  async function loadMeetingCommandDocsByJobId(jobId) {
    const normalizedJobId = normalizeText(jobId);
    if (!normalizedJobId) {
      return [];
    }
    const snapshot = await db.collection(COMMAND_COLLECTION).where("jobId", "==", normalizedJobId).get();
    return (Array.isArray(snapshot?.docs) ? snapshot.docs : [])
      .map((doc) => ({ command: normalizeMeetingCommand(doc.data()), docId: doc.id, ref: doc.ref }))
      .filter((entry) => normalizeText(entry.command.jobId) === normalizedJobId);
  }

  async function loadMeetingCommandDocsByMeetingId(meetingId) {
    const normalizedMeetingId = normalizeText(meetingId);
    if (!normalizedMeetingId) {
      return [];
    }
    const snapshot = await db.collection(COMMAND_COLLECTION).where("meetingId", "==", normalizedMeetingId).get();
    return (Array.isArray(snapshot?.docs) ? snapshot.docs : [])
      .map((doc) => ({ command: normalizeMeetingCommand(doc.data()), docId: doc.id, ref: doc.ref }))
      .filter((entry) => normalizeText(entry.command.meetingId) === normalizedMeetingId);
  }

  async function loadMeetingWorkspaceSessionDocs(meetingId) {
    const normalizedMeetingId = normalizeText(meetingId);
    if (!normalizedMeetingId) {
      return [];
    }
    const snapshot = await db.collection(WORKSPACE_SESSION_COLLECTION).where("meeting.meetingId", "==", normalizedMeetingId).get();
    return Array.isArray(snapshot?.docs) ? snapshot.docs.map((doc) => ({ docId: doc.id, ref: doc.ref })) : [];
  }

  async function loadMeetingLaunchDocs(meetingId) {
    const normalizedMeetingId = normalizeText(meetingId);
    if (!normalizedMeetingId) {
      return [];
    }
    const snapshot = await db.collection(LAUNCH_COLLECTION).where("meeting.meetingId", "==", normalizedMeetingId).get();
    return Array.isArray(snapshot?.docs) ? snapshot.docs.map((doc) => ({ docId: doc.id, ref: doc.ref })) : [];
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

  async function softDeleteMeetingJob(jobInput, deletedAt, options = {}) {
    const job = normalizeMeetingJob(jobInput);
    if (!job.jobId) {
      return null;
    }
    const nextDeletedAt = normalizeText(deletedAt) || new Date().toISOString();
    const totalParts = Math.max(
      0,
      Number(job.progress?.totalParts) || (Array.isArray(job.source?.parts) ? job.source.parts.length : 0)
    );
    const patch = {
      deletedAt: nextDeletedAt,
      error: "",
      progress: {
        currentPart: Math.max(0, Number(job.progress?.currentPart) || 0),
        parallelParts: 0,
        percent: 100,
        phase: "deleted",
        totalParts,
      },
      status: "deleted",
      updatedAt: nextDeletedAt,
    };
    const workspaceMutation = buildWorkspaceMutation(options.workspaceMutation);
    if (workspaceMutation.requestId) {
      patch.workspaceMutation = workspaceMutation;
    }
    await db.collection(JOB_COLLECTION).doc(job.jobId).set(patch, { merge: true });
    return normalizeMeetingJob({
      ...job,
      ...patch,
    });
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
      response_format: "json",
    };
    const response = await getClient().audio.transcriptions.create(request);
    return normalizeTranscriptionResponse(response, source.durationMs);
  }

  function getMeetingChunkWorkerQueueConcurrency(totalParts) {
    const normalizedTotalParts = Math.max(1, Number(totalParts) || 1);
    const override = resolveMeetingChunkTranscriptionConcurrencyOverride(normalizedTotalParts);
    return override || normalizedTotalParts;
  }

  function getMeetingChunkTranscriptionConcurrency(totalParts) {
    const normalizedTotalParts = Math.max(1, Number(totalParts) || 1);
    const override = resolveMeetingChunkTranscriptionConcurrencyOverride(normalizedTotalParts);
    return override || normalizedTotalParts;
  }

  function resolveMeetingChunkTranscriptionConcurrencyOverride(totalParts) {
    const normalizedTotalParts = Math.max(1, Number(totalParts) || 1);
    const requested = Number.parseInt(
      normalizeText(process.env.OPENAI_MEETING_CHUNK_TRANSCRIPTION_CONCURRENCY),
      10
    );
    if (!Number.isFinite(requested) || requested <= 0) {
      return null;
    }
    // Keep the env override as an emergency throttle even though the default is now full fan-out.
    return Math.max(1, Math.min(normalizedTotalParts, requested));
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
    const transcribeProgressEndPercent = 80;
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
    const totalParts = Math.max(1, chunkTranscripts.length);
    const mergeProgressStartPercent = 80;
    const mergeProgressEndPercent = 88;
    for (const [index, chunk] of chunkTranscripts.entries()) {
      const part = chunk?.part;
      const transcript = chunk?.transcript;
      if (!part || !transcript) {
        continue;
      }
      let adjustedSegments = offsetTranscriptSegments(transcript.segments, part.startMs);
      if (mergedSegments.length && adjustedSegments.length && typeof onProgress === "function") {
        await onProgress({
          progress: {
            currentPart: index + 1,
            parallelParts: 0,
            percent: Math.max(
              mergeProgressStartPercent,
              Math.min(
                mergeProgressEndPercent,
                Math.round(
                  mergeProgressStartPercent
                  + ((index + 1) / totalParts) * (mergeProgressEndPercent - mergeProgressStartPercent)
                )
              )
            ),
            phase: "assembling_transcript",
            totalParts,
          },
          updatedAt: new Date().toISOString(),
        });
      }
      mergedSegments = mergeTranscriptSegments(mergedSegments, adjustedSegments, part.overlapMs || DEFAULT_SOURCE_PART_OVERLAP_MS);
    }

    const reviewSegments = resegmentTranscriptForReview(mergedSegments);
    return {
      segments: reviewSegments,
      text: buildTranscriptText(reviewSegments),
    };
  }

  async function loadMeetingSourcePartAudioBuffer(part) {
    if (!bucket || !normalizeText(part?.storageObject)) {
      throw createHttpError(400, "분할 업로드 오디오 원본을 찾지 못했어요.");
    }
    const [buffer] = await bucket.file(part.storageObject).download();
    return buffer;
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
    const commandDocs = await loadMeetingCommandDocsByJobId(job.jobId);
    const partDocs = await loadMeetingJobPartDocs(job.jobId);
    const storageObjects = Array.from(new Set([
      ...collectMeetingSourceStorageObjects(job.source),
      ...collectMeetingChunkTranscriptStorageObjects(partDocs),
    ]));
    const deletion = await deleteTemporarySourceGroup(bucket, storageObjects);
    logMeetingCleanupWarning("meeting.delete.cleanup.warning", deletion, {
      jobId: job.jobId,
      meetingId: job.meetingId,
      providerUserKey: job.owner?.providerUserKey,
    });
    await Promise.all([
      ...artifactIds.map((artifactId) => deleteDocumentIfExists(db.collection(ARTIFACT_COLLECTION).doc(artifactId))),
      ...commandDocs.map((commandDoc) => deleteDocumentIfExists(commandDoc.ref)),
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
      commandIds: commandDocs.map((commandDoc) => commandDoc.docId),
      deletedStorageObjects: deletion.deletedStorageObjects,
      partCount: partDocs.length,
    };
  }

  async function deleteMeetingScopedRuntimeArtifacts(task) {
    if (task.scope !== "meeting" || !normalizeText(task.meetingId)) {
      return {
        commandIds: [],
        launchIds: [],
        workspaceSessionIds: [],
      };
    }
    const [commandDocs, launchDocs, workspaceSessionDocs] = await Promise.all([
      loadMeetingCommandDocsByMeetingId(task.meetingId),
      loadMeetingLaunchDocs(task.meetingId),
      loadMeetingWorkspaceSessionDocs(task.meetingId),
    ]);
    await Promise.all([
      ...commandDocs.map((commandDoc) => deleteDocumentIfExists(commandDoc.ref)),
      ...launchDocs.map((launchDoc) => deleteDocumentIfExists(launchDoc.ref)),
      ...workspaceSessionDocs.map((sessionDoc) => deleteDocumentIfExists(sessionDoc.ref)),
    ]);
    return {
      commandIds: commandDocs.map((commandDoc) => commandDoc.docId),
      launchIds: launchDocs.map((launchDoc) => launchDoc.docId),
      workspaceSessionIds: workspaceSessionDocs.map((sessionDoc) => sessionDoc.docId),
    };
  }

  async function loadMeetingJobPartDocs(jobId) {
    const snapshot = await db.collection(JOB_PART_COLLECTION).where("jobId", "==", normalizeText(jobId)).get();
    return snapshot.docs
      .map((doc) => ({ ...normalizeMeetingJobPart(doc.data()), docId: doc.id }))
      .sort((left, right) => left.index - right.index || left.part.startMs - right.part.startMs);
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
      text,
    };
  }

  function normalizeSegmentComparisonText(value) {
    return normalizeText(value).replace(/\s+/g, " ").toLowerCase();
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
      return createEmptyMeetingNotesBundle("disabled");
    }
    try {
      let termReplacements = [];
      try {
        const meetingRecord = await loadMeetingSummaryRecord(owner, { meetingId: meeting.meetingId }, createHttpError);
        termReplacements = normalizeMeetingTermReplacements(meetingRecord?.meeting?.termReplacements);
      } catch {}
      const gateDecision = await classifyMeetingNotesSignal(transcript);
      logEvent("meeting.notes.gate", {
        decision: gateDecision.decision,
        jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
        reason: gateDecision.reason,
        segmentCount: gateDecision.segmentCount,
        sentenceCount: gateDecision.sentenceCount,
        summaryProfile: gateDecision.summaryProfile,
        strategy: gateDecision.strategy,
        textLength: gateDecision.textLength,
      });
      if (gateDecision.decision === "skip") {
        return createEmptyMeetingNotesBundle("skipped", gateDecision.reason);
      }
      const notesBundle = await generateMeetingNotesBundle(
        transcript,
        meeting,
        context,
        gateDecision.summaryProfile
      );
      return {
        ...notesBundle,
        notes: applyMeetingTermReplacements(notesBundle.notes, termReplacements),
      };
    } catch (error) {
      logEvent("meeting.notes.skipped", {
        error: normalizeText(error?.message),
        jobId,
        meetingId: meeting.meetingId,
        providerUserKey: owner.providerUserKey,
      });
      return createEmptyMeetingNotesBundle(
        "degraded",
        normalizeText(error?.message) || "회의록 자동 정리에 실패했어요."
      );
    }
  }

  async function generateMeetingNotesBundle(transcript, meeting, context, summaryProfileInput) {
    const summaryProfile = normalizeMeetingNotesSummaryProfile(summaryProfileInput);
    if (summaryProfile === "compact") {
      return generateCompactMeetingNotesBundle(transcript, meeting, context);
    }
    const transcriptSections = buildMeetingNotesTranscriptSections(transcript);
    if (!transcriptSections.length) {
      return createEmptyMeetingNotesBundle("skipped");
    }
    if (transcriptSections.length === 1) {
      return await generateMeetingNotesBundleFromPrompt(
        transcript,
        meeting,
        context,
        transcriptSections[0]
      );
    }
    const partialSummaries = [];
    for (const [index, sectionPrompt] of transcriptSections.entries()) {
      partialSummaries.push(await summarizeMeetingNotesSection(
        transcript,
        meeting,
        context,
        sectionPrompt,
        index,
        transcriptSections.length
      ));
    }
    const completion = await getClient().chat.completions.create({
      messages: [
        {
          role: "system",
          content: buildMeetingNotesSystemPrompt(),
        },
        {
          role: "user",
          content: buildMeetingNotesReducerPrompt(
            transcript,
            meeting,
            context,
            partialSummaries
          ),
        },
      ],
      model: getMeetingSummaryModel(),
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const content = normalizeCompletionContent(completion?.choices?.[0]?.message?.content);
    if (!content) {
      return createEmptyMeetingNotesBundle("skipped");
    }
    return createMeetingNotesBundleFromNotes(parseMeetingNotesJson(content), context);
  }

  async function generateCompactMeetingNotesBundle(transcript, meeting, context) {
    const transcriptPrompt = buildMeetingNotesTranscriptPrompt(transcript, { strategy: "balanced" });
    if (!normalizeTextBlock(transcriptPrompt)) {
      return createEmptyMeetingNotesBundle("skipped");
    }
    const completion = await getClient().chat.completions.create({
      messages: [
        {
          role: "system",
          content: buildCompactMeetingNotesSystemPrompt(),
        },
        {
          role: "user",
          content: buildCompactMeetingNotesUserPrompt(meeting, context, transcriptPrompt),
        },
      ],
      model: getMeetingSummaryModel(),
      response_format: { type: "json_object" },
      temperature: 0.1,
    });
    const content = normalizeCompletionContent(completion?.choices?.[0]?.message?.content);
    if (!content) {
      return createEmptyMeetingNotesBundle("skipped");
    }
    return createMeetingNotesBundleFromNotes(
      normalizeCompactMeetingNotes(parseMeetingNotesJson(content), transcript),
      context
    );
  }

  async function generateMeetingNotesBundleFromPrompt(
    transcript,
    meeting,
    context,
    transcriptPrompt
  ) {
    const completion = await getClient().chat.completions.create({
      messages: [
        {
          role: "system",
          content: buildMeetingNotesSystemPrompt(),
        },
        {
          role: "user",
          content: buildMeetingNotesUserPromptFromText(
            transcript,
            meeting,
            context,
            transcriptPrompt
          ),
        },
      ],
      model: getMeetingSummaryModel(),
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    const content = normalizeCompletionContent(completion?.choices?.[0]?.message?.content);
    if (!content) {
      return createEmptyMeetingNotesBundle("skipped");
    }
    return createMeetingNotesBundleFromNotes(parseMeetingNotesJson(content), context);
  }

  async function summarizeMeetingNotesSection(
    transcript,
    meeting,
    context,
    transcriptPrompt,
    sectionIndex,
    totalSections
  ) {
    const completion = await getClient().chat.completions.create({
      messages: [
        {
          role: "system",
          content: buildMeetingNotesSectionSystemPrompt(),
        },
        {
          role: "user",
          content: buildMeetingNotesSectionUserPrompt(
            transcript,
            meeting,
            context,
            transcriptPrompt,
            sectionIndex,
            totalSections
          ),
        },
      ],
      model: getMeetingSummaryModel(),
      response_format: { type: "json_object" },
      temperature: 0.2,
    });
    return normalizeMeetingNotesSectionSummary(
      parseMeetingNotesJson(normalizeCompletionContent(completion?.choices?.[0]?.message?.content))
    );
  }

  async function classifyMeetingNotesSignal(transcript) {
    const signal = buildMeetingNotesSignal(transcript);
    if (!signal.textLength) {
      return {
        decision: "skip",
        reason: "인식된 발화가 없어 자동 회의 정리를 만들지 않았습니다.",
        segmentCount: signal.segmentCount,
        sentenceCount: signal.sentenceCount,
        summaryProfile: "skip",
        strategy: "empty-transcript",
        textLength: signal.textLength,
      };
    }
    if (isClearlySummarizableMeetingSignal(signal)) {
      return {
        decision: "generate",
        reason: "",
        segmentCount: signal.segmentCount,
        sentenceCount: signal.sentenceCount,
        summaryProfile: "full",
        strategy: "direct-full",
        textLength: signal.textLength,
      };
    }
    try {
      const completion = await getClient().chat.completions.create({
        messages: [
          {
            role: "system",
            content: buildMeetingNotesGateSystemPrompt(),
          },
          {
            role: "user",
            content: buildMeetingNotesGateUserPrompt(signal),
          },
        ],
        model: getMeetingClassifierModel(),
        response_format: { type: "json_object" },
        temperature: 0,
      });
      const gate = parseMeetingNotesGateResult(
        normalizeCompletionContent(completion?.choices?.[0]?.message?.content)
      );
      return {
        decision: "generate",
        reason: gate.profile === "compact"
          ? gate.reason || "짧은 테스트성 또는 저신호 전사라 compact 회의록으로 정리했습니다."
          : "",
        segmentCount: signal.segmentCount,
        sentenceCount: signal.sentenceCount,
        summaryProfile: gate.profile === "full" ? "full" : "compact",
        strategy: "llm-profile",
        textLength: signal.textLength,
      };
    } catch {
      return {
        decision: "generate",
        reason: "",
        segmentCount: signal.segmentCount,
        sentenceCount: signal.sentenceCount,
        summaryProfile: "compact",
        strategy: "profile-fallback-compact",
        textLength: signal.textLength,
      };
    }
  }

  function buildMeetingNotesSignal(transcript) {
    const segmentTexts = (Array.isArray(transcript?.segments) ? transcript.segments : [])
      .map((segment) => normalizeText(segment?.text))
      .filter(Boolean);
    const plainText = normalizeTextBlock(segmentTexts.join("\n") || transcript?.text);
    const sentenceCount = plainText
      ? plainText
        .split(/[\n.!?。！？…]+/g)
        .map((line) => normalizeText(line))
        .filter(Boolean)
        .length
      : 0;
    const excerpt = plainText.length > MAX_MEETING_NOTES_GATE_TRANSCRIPT_CHARS
      ? `${plainText.slice(0, MAX_MEETING_NOTES_GATE_TRANSCRIPT_CHARS)}...`
      : plainText;
    return {
      excerpt,
      segmentCount: segmentTexts.length,
      sentenceCount,
      textLength: plainText.length,
    };
  }

  function isClearlySummarizableMeetingSignal(signal) {
    return signal.textLength >= MIN_MEETING_NOTES_DIRECT_TEXT_CHARS
      || signal.segmentCount >= MIN_MEETING_NOTES_DIRECT_SEGMENTS
      || (signal.sentenceCount >= MIN_MEETING_NOTES_DIRECT_SENTENCES && signal.textLength >= 140);
  }

  function buildMeetingNotesGateSystemPrompt() {
    return [
      "너는 회의 전사 요약 프로필 분류기다.",
      "빈 전사는 여기 들어오지 않는다.",
      "전사 텍스트만 보고 이 기록이 full 회의록이 맞는지, compact 회의록이 맞는지 판단한다.",
      "full은 실제 결정, 요청, 일정, 후속 행동, 여러 논의 흐름이 보여 정식 회의록 구조가 자연스러운 경우다.",
      "compact는 짧은 테스트, 상태 점검, 기기 확인, 단일 질문, 저신호 대화처럼 정식 회의 서사를 만들면 과장되는 경우다.",
      "애매하면 무조건 compact를 선택한다.",
      "반드시 JSON 하나만 반환한다.",
      '형식: {"profile":"full|compact","reason":"compact일 때만 짧은 한국어 이유"}',
    ].join(" ");
  }

  function buildMeetingNotesGateUserPrompt(signal) {
    return [
      `전사 길이: ${signal.textLength}자`,
      `구간 수: ${signal.segmentCount}개`,
      `문장 수: ${signal.sentenceCount}개`,
      "아래 전사가 정식 full 회의록에 맞는지, compact 회의록에 맞는지 판단해 주세요.",
      signal.excerpt ? `전사:\n${signal.excerpt}` : "전사: 없음",
    ].join("\n\n");
  }

  function parseMeetingNotesGateResult(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
      return { profile: "", reason: "" };
    }
    try {
      const parsed = JSON.parse(normalized);
      const profile = normalizeText(parsed?.profile).toLowerCase();
      return {
        profile: profile === "full" ? "full" : profile === "compact" ? "compact" : "",
        reason: normalizeTextBlock(parsed?.reason).slice(0, 200),
      };
    } catch {
      return { profile: "", reason: "" };
    }
  }

  function buildMeetingNotesSystemPrompt() {
    return [
      "너는 한국어 회의록 작성자다.",
      "주어진 전사와 공용 메모만 근거로 구조화된 회의록 JSON을 만든다.",
      "추측하지 말고, 알 수 없으면 빈 문자열이나 빈 배열로 남긴다.",
      "사실은 전사 우선, 강조/의도는 공용 메모를 보조 근거로 사용한다.",
      "전사와 메모가 충돌하면 단정하지 말고 openQuestions 또는 risksOrDependencies에 남긴다.",
      "전문가 자문, 전략 평가, 타당성 판단처럼 들리는 표현은 피하고 회의에서 실제 언급된 내용만 중립적으로 정리한다.",
      "전사에 없는 결론, 추천, 당위, 우선순위 판단을 새로 만들지 않는다.",
      "문장은 단순히 '논의되었다'를 반복하지 말고, 왜 이 논의가 나왔는지, 어떤 쟁점이 있었는지, 그래서 무엇이 정리되었는지가 짧게 이어지도록 쓴다.",
      "회의록을 읽는 사람이 배경 없이도 흐름을 이해할 수 있게, 배경 -> 핵심 쟁점 -> 결론 또는 미결정 -> 다음 단계 순서를 의식해 정리한다.",
      "actionItems에는 전사나 메모에 실제로 나온 행동만 적고, 담당자나 기한이 없으면 임의로 만들지 않는다.",
      "actionItems는 누가 무엇을 할지 비교적 분명한 항목만 포함하고, 단순한 추가 검토 필요·논의 필요 같은 일반론은 openQuestions 또는 risksOrDependencies로 돌린다.",
      "overview와 discussionFlow는 단순 항목 나열이 아니라 회의 맥락이 드러나는 짧은 서술형 회의록처럼 정리하되, 잘 되었다/옳다/필수다 같은 평가형 문장은 피한다.",
      "결과는 상용 회의록 SaaS처럼 사람이 바로 읽는 문서 톤으로 쓰되, 회의에서 실제 언급된 내용만 근거로 사용한다.",
      "overview는 회의 배경, 목적, 핵심 논의 방향, 결론 또는 남은 쟁점을 2~5문장 안에서 하나의 문단으로 정리한다.",
      "meetingMeta.purpose는 이 회의가 왜 열렸고 어떤 배경에서 무엇을 검토·결정하려 했는지 2~4문장 안에서 회의 개요처럼 정리한다.",
      "discussionFlow[].heading은 짧은 주제명만 적고 문장형 설명이나 중간 구분점(예: ·, /)을 길게 이어 붙이지 않는다.",
      "discussionFlow[].narrative는 해당 논의가 왜 중요했고 어떤 배경과 쟁점이 있었고 무엇이 정리되었는지가 보이도록 2~4문장 안에서 적는다.",
      "discussionFlow[].keyPoints는 2~4개 이내의 핵심 포인트만 남기고, 서로 비슷한 표현은 합친다.",
      "discussionFlow 수는 최대 4개, decisions는 최대 5개, actionItems는 최대 5개, openQuestions는 최대 3개, risksOrDependencies는 최대 3개를 넘기지 않는다.",
      "openQuestions는 실제로 미결정된 승인, 의사결정, 외부 확인, 의존성 문제만 포함하고, 없으면 빈 배열로 둔다.",
      "반드시 JSON만 반환한다.",
      "스키마는 meetingMeta, overview, discussionFlow, decisions, actionItems, openQuestions, risksOrDependencies, sourceTrace 이다.",
      "meetingMeta는 {title, datetime, participants, purpose} 형식이다.",
      "discussionFlow[]는 {heading, narrative, keyPoints} 형식이다.",
      "decisions[]는 {text, owner, confidence} 형식이다.",
      "actionItems[]는 {task, assignee, dueDate, status, source} 형식이다.",
      "openQuestions[]는 짧은 문자열 배열로 작성하되, 아직 확정되지 않은 의사결정이나 외부 확인 필요 사항만 포함한다.",
      "risksOrDependencies[]는 {text, severity} 형식이고, 리스크, 제약, 선행조건, 외부 의존성, 현실적인 난점을 담는다.",
      "meetingMeta.title은 이 기록을 구분할 짧고 구체적인 한국어 제목 한 줄로 작성한다.",
      "meetingMeta.title은 범용적인 '회의', '회의록', '미팅'만 단독으로 쓰지 말고 핵심 주제를 드러낸다.",
      "meetingMeta.participants는 전사와 메모에서 확인 가능한 참여자만 적고, 확실하지 않으면 비워 둔다.",
      "sourceTrace[]는 {itemType, itemRef, evidence} 형식이다.",
      "sourceTrace[] itemType은 transcript, sharedMemo 중 근거에 맞게 적는다.",
    ].join(" ");
  }

  function buildCompactMeetingNotesSystemPrompt() {
    return [
      "너는 짧은 테스트성 또는 저신호 전사를 정리하는 한국어 기록 메모 작성자다.",
      "정식 회의록처럼 배경, 쟁점, 결론을 억지로 만들지 않는다.",
      "전사에 직접 나온 사실만 짧게 적고, 해석이나 확장 서사를 붙이지 않는다.",
      "짧은 테스트 발화는 그대로 테스트성 기록 톤으로 남긴다.",
      "overview는 1~2문장 안의 짧은 메모로 작성한다.",
      "meetingMeta.purpose는 보통 빈 문자열로 두고, 정말 명시된 목적이 있을 때만 한 문장으로 쓴다.",
      "discussionFlow는 보통 빈 배열이며, 분명한 단일 주제가 있을 때만 최대 1개 남긴다.",
      "decisions, actionItems, risksOrDependencies는 전사에 직접 근거가 없으면 빈 배열로 둔다.",
      "openQuestions는 실제로 확인이 필요하거나 모르겠다고 말한 내용만 최대 1개 남긴다.",
      "원문에 없는 결론, 실패 판정, 의도, 배경 설명을 만들지 않는다.",
      "반드시 JSON만 반환한다.",
      "스키마는 meetingMeta, overview, discussionFlow, decisions, actionItems, openQuestions, risksOrDependencies, sourceTrace 이다.",
    ].join(" ");
  }

  function buildMeetingNotesSectionSystemPrompt() {
    return [
      buildMeetingNotesSystemPrompt(),
      "지금 입력되는 전사는 전체 회의 중 일부 구간이다.",
      "이 구간에 실제로 나온 내용만 정리하고, 전체 회의 결론처럼 과하게 단정하지 않는다.",
      "meetingMeta는 필요 최소한만 채워도 되며, section 요약에서는 sourceTrace에 꼭 필요한 근거만 남긴다.",
      "구간 요약에서는 overview는 1개 문단, discussionFlow 최대 2개, decisions/actionItems 각각 최대 2개, openQuestions/risksOrDependencies는 정말 필요한 경우만 남긴다.",
      "구간 요약도 맥락이 보이게 정리하고, discussionFlow[].narrative에는 왜 이 논의가 나왔고 어떤 판단이나 미결정으로 이어졌는지 짧게 남긴다.",
    ].join(" ");
  }

  function buildMeetingNotesReducerPrompt(transcript, meeting, context, partialSummaries) {
    return [
      `언어: ${normalizeText(meeting?.language) || "ko"}`,
      `공용 메모: ${normalizeTextBlock(context?.sharedMemoSnapshot) || "없음"}`,
      "아래는 긴 전사를 여러 구간으로 나눈 중간 정리 결과입니다. 중복을 제거하고 회의 전체 관점에서 하나의 최종 회의록 JSON으로 통합해 주세요.",
      "최종 결과는 사람이 바로 읽는 회의록처럼 간결하게 정리하고, 비슷한 토픽/결정/액션은 합친다.",
      "특히 overview와 discussionFlow[].narrative는 전체 흐름이 이해되게 다시 써야 한다. 무엇이 배경이었고, 어떤 쟁점이 오갔고, 무엇이 정리되었는지가 보이게 만든다.",
      "최종 결과의 상한은 discussionFlow 최대 4개, decisions 최대 5개, actionItems 최대 5개, openQuestions 최대 3개, risksOrDependencies 최대 3개다.",
      "후속 실행 항목에는 실제 행동만 남기고, 단순한 검토 필요나 논의 필요 문구는 openQuestions 또는 risksOrDependencies로 정리한다.",
      `전사 발췌:\n${buildMeetingNotesTranscriptPrompt(transcript, { strategy: "balanced" })}`,
      partialSummaries
        .map((summary, index) => `[구간 ${index + 1}/${partialSummaries.length}]\n${JSON.stringify(summary)}`)
        .join("\n\n"),
    ].join("\n\n");
  }

  function buildMeetingNotesSectionUserPrompt(
    transcript,
    meeting,
    context,
    transcriptPrompt,
    sectionIndex,
    totalSections
  ) {
    return [
      `언어: ${normalizeText(meeting?.language) || "ko"}`,
      `공용 메모: ${normalizeTextBlock(context?.sharedMemoSnapshot) || "없음"}`,
      `전체 ${totalSections}개 구간 중 ${sectionIndex + 1}번째 구간입니다.`,
      "아래 구간 전사에서 실제로 언급된 논의, 결정, 액션, 쟁점을 정리해 주세요. 단순 키워드 추출보다 왜 이 얘기가 나왔고 어떤 판단으로 이어졌는지가 드러나게 써 주세요.",
      transcriptPrompt,
    ].join("\n\n");
  }

  function buildMeetingNotesUserPromptFromText(transcript, meeting, context, transcriptPrompt) {
    return [
      `언어: ${normalizeText(meeting?.language) || "ko"}`,
      `공용 메모: ${normalizeTextBlock(context?.sharedMemoSnapshot) || "없음"}`,
      "아래 전사를 기반으로 회의록을 정리해 주세요. 왜 이 회의가 열렸고, 어떤 논의 흐름으로 결론이나 미결정 사항이 나왔는지가 보이게 써 주세요.",
      transcriptPrompt,
    ].join("\n\n");
  }

  function buildCompactMeetingNotesUserPrompt(meeting, context, transcriptPrompt) {
    return [
      `언어: ${normalizeText(meeting?.language) || "ko"}`,
      `공용 메모: ${normalizeTextBlock(context?.sharedMemoSnapshot) || "없음"}`,
      "아래 전사는 짧은 테스트나 저신호 기록일 수 있습니다. 정식 회의처럼 부풀리지 말고, 사람이 나중에 다시 볼 때 필요한 사실만 짧게 정리해 주세요.",
      "핵심은 무엇을 테스트하거나 확인했는지, 무엇이 바로 확인되지 않았는지, 추가 확인이 필요한 항목이 있는지 정도만 남기는 것입니다.",
      transcriptPrompt,
    ].join("\n\n");
  }

  function normalizeMeetingNotesSectionSummary(input) {
    return normalizeMeetingNotes(input, {
      maxActionItems: 2,
      maxDecisions: 2,
      maxDiscussionFlow: 2,
      maxKeyPoints: 3,
      maxOpenQuestions: 2,
      maxRisks: 2,
      maxSourceTrace: 3,
    });
  }

  function normalizeMeetingNotesSummaryProfile(input) {
    return normalizeText(input).toLowerCase() === "compact" ? "compact" : normalizeText(input).toLowerCase() === "skip" ? "skip" : "full";
  }

  function normalizeCompactMeetingNotes(notesInput, transcriptInput) {
    const transcriptText = buildCompactMeetingTranscriptText(transcriptInput);
    const normalized = normalizeMeetingNotes(notesInput, {
      maxActionItems: 1,
      maxDecisions: 1,
      maxDiscussionFlow: 1,
      maxKeyPoints: 2,
      maxOpenQuestions: 1,
      maxRisks: 1,
      maxSourceTrace: 2,
    });
    const hasDecisionCue = /(결정|확정|승인|합의|정하기로|하기로|진행하기로)/.test(transcriptText);
    const hasActionCue = /(하겠습니다|하겠습니|정리하겠습니다|확인하겠습니다|보내겠습니다|준비하겠습니다|담당|까지\b)/.test(transcriptText);
    const hasQuestionCue = /(\?|모르겠|모르겠습니다|어디|확인해야|확인이 필요|궁금)/.test(transcriptText);
    const hasRiskCue = /(문제|어렵|어려|지연|막히|불가|오류|리스크|제약|장애)/.test(transcriptText);
    const discussionFlow = transcriptText.length >= 140 && !hasQuestionCue
      ? normalized.discussionFlow.slice(0, 1).map((item) => ({
          heading: clampCompactMeetingTitle(item.heading),
          keyPoints: item.keyPoints.map((value) => clampCompactMeetingLine(value)).filter(Boolean).slice(0, 2),
          narrative: clampCompactMeetingBody(item.narrative, 2),
        })).filter((item) => item.heading || item.narrative || item.keyPoints.length)
      : [];
    const openQuestions = hasQuestionCue
      ? normalized.openQuestions.map((item) => clampCompactMeetingLine(item)).filter(Boolean).slice(0, 1)
      : [];
    const compactNotes = normalizeMeetingNotes({
      actionItems: hasActionCue
        ? normalized.actionItems.slice(0, 1).map((item) => ({
            ...item,
            source: "transcript",
            task: clampCompactMeetingLine(item.task),
          })).filter((item) => item.task)
        : [],
      decisions: hasDecisionCue
        ? normalized.decisions.slice(0, 1).map((item) => ({
            ...item,
            text: clampCompactMeetingLine(item.text),
          })).filter((item) => item.text)
        : [],
      discussionFlow,
      meetingMeta: {
        ...normalized.meetingMeta,
        purpose: "",
        title: clampCompactMeetingTitle(normalized.meetingMeta.title) || buildCompactMeetingFallbackTitle(transcriptText),
      },
      openQuestions,
      overview: clampCompactMeetingBody(normalized.overview, 2) || buildCompactMeetingFallbackOverview(transcriptText),
      risksOrDependencies: hasRiskCue && !hasQuestionCue
        ? normalized.risksOrDependencies.slice(0, 1).map((item) => ({
            ...item,
            text: clampCompactMeetingLine(item.text),
          })).filter((item) => item.text)
        : [],
      sourceTrace: normalized.sourceTrace
        .filter((item) => normalizeText(item.itemType) !== "sharedMemo")
        .slice(0, 2),
    });
    return compactNotes;
  }

  function buildCompactMeetingTranscriptText(transcript) {
    return normalizeTextBlock(
      (Array.isArray(transcript?.segments) ? transcript.segments : [])
        .map((segment) => normalizeText(segment?.text))
        .filter(Boolean)
        .join("\n")
      || transcript?.text
    );
  }

  function clampCompactMeetingBody(textInput, maxSentences = 2) {
    const text = normalizeTextBlock(textInput);
    if (!text) {
      return "";
    }
    const sentences = text
      .match(/[^.!?。！？…]+[.!?。！？…]?/g)
      ?.map((item) => normalizeTextBlock(item))
      .filter(Boolean)
      || [text];
    const limited = sentences.slice(0, Math.max(1, maxSentences)).join(" ");
    return limited.length > MAX_COMPACT_MEETING_NOTES_OVERVIEW_CHARS
      ? normalizeTextBlock(limited.slice(0, MAX_COMPACT_MEETING_NOTES_OVERVIEW_CHARS))
      : limited;
  }

  function clampCompactMeetingLine(textInput) {
    const text = normalizeTextBlock(textInput);
    if (!text) {
      return "";
    }
    return text.length > MAX_COMPACT_MEETING_NOTES_LINE_CHARS
      ? normalizeTextBlock(text.slice(0, MAX_COMPACT_MEETING_NOTES_LINE_CHARS))
      : text;
  }

  function clampCompactMeetingTitle(textInput) {
    const text = normalizeText(textInput);
    if (!text) {
      return "";
    }
    return text.length > MAX_COMPACT_MEETING_NOTES_TITLE_CHARS
      ? normalizeText(text.slice(0, MAX_COMPACT_MEETING_NOTES_TITLE_CHARS))
      : text;
  }

  function buildCompactMeetingFallbackTitle(transcriptTextInput) {
    const transcriptText = normalizeTextBlock(transcriptTextInput);
    if (!transcriptText) {
      return "짧은 회의 기록";
    }
    if (/녹음/.test(transcriptText) && /마이크/.test(transcriptText)) {
      return "녹음 테스트 및 마이크 위치 확인";
    }
    if (/테스트|점검|확인/.test(transcriptText)) {
      return "테스트 및 상태 확인";
    }
    return clampCompactMeetingTitle(buildTranscriptExcerpt(transcriptText).replace(/\.\.\.$/, "")) || "짧은 회의 기록";
  }

  function buildCompactMeetingFallbackOverview(transcriptTextInput) {
    const transcriptText = normalizeTextBlock(transcriptTextInput);
    if (!transcriptText) {
      return "짧은 발화가 기록되었지만 추가 맥락은 확인되지 않았습니다.";
    }
    if (/녹음/.test(transcriptText) && /테스트/.test(transcriptText) && /마이크/.test(transcriptText)) {
      return "녹음 테스트와 수정 반영 여부 확인이 언급됐다. 마이크 위치를 몰라 테스트 진행이 어렵다는 말이 나왔다.";
    }
    return clampCompactMeetingBody(buildTranscriptExcerpt(transcriptText).replace(/\.\.\.$/, ""), 2);
  }

  function buildMeetingNotesSectionEditSystemPrompt(sectionKey, options = {}) {
    const retryReason = normalizeTextBlock(options.retryReason);
    return [
      "너는 한국어 회의록 편집기다.",
      "사용자 요청은 가장 높은 우선순위다.",
      "정상적인 편집 요청은 최대한 그대로 따른다. 길이, 형식, 문체, 강조 범위, 삭제, 축약, 재구성 요청은 완곡하게 해석하지 말고 직접 반영한다.",
      "전사와 현재 섹션은 참고 자료일 뿐이며, 현재 회의록 문구를 유지하려 하지 말고 사용자 요청에 맞게 대상 섹션을 새로 다시 써도 된다.",
      "요청된 섹션 하나만 수정한다. 다른 섹션 문맥을 끌어와 덧붙이거나 설명을 늘리지 않는다.",
      "절대 전체 회의록을 다시 쓰지 않는다.",
      "요청된 섹션 외 다른 섹션 내용, sourceTrace, 원문 근거를 바꾸지 않는다.",
      "전사에 없는 사실, 결정, 액션, 담당자, 일정은 만들지 않는다.",
      "용어 치환 사전이 있으면 그 표현을 우선 사용한다.",
      retryReason ? `직전 시도는 형식이 맞지 않았다. 이번에는 특히 ${retryReason}` : "",
      "반드시 JSON 하나만 반환한다.",
      buildMeetingNotesSectionEditSchemaPrompt(sectionKey),
    ].filter(Boolean).join(" ");
  }

  function buildMeetingNotesSectionEditUserPrompt(input, options = {}) {
    const retryReason = normalizeTextBlock(options.retryReason);
    return [
      `섹션 키: ${input.sectionKey}`,
      "편집 우선순위: 사용자 요청 > 전사 근거 > 현재 대상 섹션",
      input.termReplacements.length
        ? `용어 치환 사전:\n${input.termReplacements.map((item) => `- ${item.from} -> ${item.to}`).join("\n")}`
        : "용어 치환 사전: 없음",
      `사용자 요청:\n${input.instruction}`,
      `전사 발췌:\n${buildMeetingNotesTranscriptPrompt(input.transcript, { strategy: "balanced" })}`,
      `현재 대상 섹션 JSON(교체 대상):\n${JSON.stringify(input.currentSectionData)}`,
      retryReason ? `재시도 사유:\n${retryReason}` : "",
    ].filter(Boolean).join("\n\n");
  }

  function buildMeetingNotesSectionEditSchemaPrompt(sectionKey) {
    switch (sectionKey) {
      case "overview":
        return "overview 섹션은 {meetingMeta:{title, datetime, participants, purpose}, overview:\"...\"} 형식으로만 반환한다. meetingMeta.title/datetime/participants는 사용자가 바꾸라고 하지 않았다면 현재 값을 유지하고, purpose는 회의 개요 본문이 아니라 보조 메타다. 사용자가 회의 개요를 짧게 요약하거나 길이를 줄여 달라고 하면 purpose는 빈 문자열로 두고 overview에만 최종 문구를 담는다.";
      case "discussionFlow":
        return "discussionFlow 섹션은 {discussionFlow:[{heading, narrative, keyPoints}]} 형식으로만 반환한다.";
      case "decisions":
        return "decisions 섹션은 {decisions:[{text, owner, confidence}]} 형식으로만 반환한다.";
      case "openQuestions":
        return "openQuestions 섹션은 {openQuestions:[\"...\"]} 형식으로만 반환한다.";
      case "risksOrDependencies":
        return "risksOrDependencies 섹션은 {risksOrDependencies:[{text, severity}]} 형식으로만 반환한다.";
      case "actionItems":
        return "actionItems 섹션은 {actionItems:[{task, assignee, dueDate, status, source}]} 형식으로만 반환한다.";
      default:
        return "요청된 섹션 하나만 JSON으로 반환한다.";
    }
  }

  async function generateMeetingNotesSectionEditPayload(input) {
    let retryReason = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let content;
      try {
        const completion = await getClient().chat.completions.create({
          messages: [
            {
              role: "system",
              content: buildMeetingNotesSectionEditSystemPrompt(input.sectionKey, { retryReason }),
            },
            {
              role: "user",
              content: buildMeetingNotesSectionEditUserPrompt(input, { retryReason }),
            },
          ],
          model: getMeetingSummaryModel(),
          response_format: { type: "json_object" },
          temperature: 0.2,
        });
        content = normalizeCompletionContent(completion?.choices?.[0]?.message?.content);
      } catch (error) {
        retryReason = normalizeText(error?.message) || "JSON 응답을 만들지 못했다.";
        continue;
      }
      if (!content) {
        retryReason = "빈 응답이 아니라 요청을 반영한 JSON 하나를 반환해야 한다.";
        continue;
      }
      try {
        const normalizedPayload = normalizeMeetingNotesSectionPayload(input.sectionKey, parseMeetingNotesJson(content));
        return {
          payload: normalizedPayload,
          warning: "",
        };
      } catch (error) {
        retryReason = normalizeText(error?.message) || "스키마에 맞는 JSON을 반환해야 한다.";
      }
    }
    throw createHttpError(502, retryReason || "섹션 미리보기를 만들지 못했어요.");
  }

  function assertValidMeetingTermReplacementRequest(rawInput, normalizedInput, provided, createHttpError) {
    if (!provided) {
      return;
    }
    if (!Array.isArray(rawInput)) {
      throw createHttpError(400, "용어 치환 목록 형식이 올바르지 않아요.");
    }
    if (rawInput.length !== normalizedInput.length) {
      throw createHttpError(400, "용어 치환에는 비어 있는 항목이나 중복된 원문을 넣을 수 없어요.");
    }
  }

  async function applyMeetingTermReplacementsAcrossMeeting(owner, meetingId, termReplacementsInput, updatedAtInput) {
    const updatedAt = normalizeText(updatedAtInput) || new Date().toISOString();
    const termReplacements = normalizeMeetingTermReplacements(termReplacementsInput);
    const jobs = await loadOwnedMeetingJobs(owner, meetingId);
    for (const job of jobs) {
      await applyMeetingTermReplacementsToResult(owner, job, termReplacements, updatedAt);
    }
  }

  async function applyMeetingTermReplacementsToResult(owner, jobInput, termReplacementsInput, updatedAtInput) {
    const job = normalizeMeetingJob(jobInput);
    if (!job.jobId || job.deletedAt) {
      return;
    }
    const updatedAt = normalizeText(updatedAtInput) || new Date().toISOString();
    const termReplacements = normalizeMeetingTermReplacements(termReplacementsInput);
    const { artifact, artifactRef } = await loadMeetingArtifactSource(job);
    const currentNotes = normalizeMeetingNotes(artifact?.notes || job.meetingNotes);
    const nextNotes = applyMeetingTermReplacements(currentNotes, termReplacements);
    const notesChanged = JSON.stringify(currentNotes) !== JSON.stringify(nextNotes);
    const shouldSyncTitle = shouldAutoSyncResultTitleFromNotes(job, currentNotes);
    const nextTitle = shouldSyncTitle
      ? resolveMeetingResultTitle({ notes: nextNotes }, job.title)
      : job.title;
    if (!notesChanged && normalizeText(nextTitle) === normalizeText(job.title)) {
      return;
    }

    const jobPatch = {
      updatedAt,
    };
    const artifactPatch = {};
    if (notesChanged) {
      jobPatch.meetingNotes = nextNotes;
      artifactPatch.notes = nextNotes;
    }
    if (normalizeText(nextTitle) !== normalizeText(job.title)) {
      jobPatch.title = nextTitle;
    }

    const nextJob = normalizeMeetingJob({
      ...job,
      ...jobPatch,
    });
    const nextArtifact = artifact
      ? normalizeMeetingArtifact({
          ...artifact,
          ...artifactPatch,
        })
      : null;

    await Promise.all([
      db.collection(JOB_COLLECTION).doc(job.jobId).set(jobPatch, { merge: true }),
      artifactRef && Object.keys(artifactPatch).length ? artifactRef.set(artifactPatch, { merge: true }) : Promise.resolve(),
    ]);
    await updateMeetingSummaryRecordResult(owner, nextJob, nextArtifact, updatedAt);
  }

  async function previewMeetingNotesSectionEdit(input, owner) {
    const source = await loadMeetingNotesSectionEditSource(input, owner);
    const previewPayload = await generateMeetingNotesSectionEditPayload({
      currentNotes: source.currentNotes,
      currentSectionData: readMeetingNotesSectionData(source.currentNotes, input.sectionKey),
      instruction: input.instruction,
      sectionKey: input.sectionKey,
      termReplacements: source.termReplacements,
      transcript: source.transcript,
    });
    const mergedNotes = applyMeetingNotesSectionPayload(source.currentNotes, input.sectionKey, previewPayload.payload);
    const nextNotes = applyMeetingTermReplacements(mergedNotes, source.termReplacements);
    if (previewPayload.warning) {
      logEvent("meeting.notes.section-edit.preview.warning", {
        jobId: source.job.jobId,
        meetingId: source.job.meetingId,
        providerUserKey: owner.providerUserKey,
        sectionKey: input.sectionKey,
        warning: previewPayload.warning,
      });
    }
    return {
      baseRevisionToken: source.baseRevisionToken,
      sectionData: readMeetingNotesSectionData(nextNotes, input.sectionKey),
      sectionKey: input.sectionKey,
      warning: previewPayload.warning,
    };
  }

  async function applyMeetingNotesSectionEdit(input, owner) {
    const source = await loadMeetingNotesSectionEditSource(input, owner);
    if (input.baseRevisionToken !== source.baseRevisionToken) {
      throw createHttpError(409, "회의 정리가 바뀌어 미리보기가 오래됐어요. 새 미리보기를 다시 만들어 주세요.");
    }
    const normalizedPayload = normalizeMeetingNotesSectionPayload(input.sectionKey, input.sectionData);
    const mergedNotes = applyMeetingNotesSectionPayload(source.currentNotes, input.sectionKey, normalizedPayload);
    const nextNotes = applyMeetingTermReplacements(mergedNotes, source.termReplacements);
    const requestId = normalizeText(input.clientRequestId) || db.collection(JOB_COLLECTION).doc().id;
    const updatedAt = new Date().toISOString();
    const shouldSyncTitle = shouldAutoSyncResultTitleFromNotes(source.job, source.currentNotes);
    const nextTitle = shouldSyncTitle
      ? resolveMeetingResultTitle({ notes: nextNotes }, source.job.title)
      : source.job.title;
    const workspaceMutation = buildWorkspaceMutation({
      completedAt: updatedAt,
      requestId,
      requestedAt: updatedAt,
      status: "succeeded",
      type: "applySectionEdit",
    });
    const jobPatch = {
      meetingNotes: nextNotes,
      updatedAt,
      workspaceMutation,
    };
    if (normalizeText(nextTitle) !== normalizeText(source.job.title)) {
      jobPatch.title = nextTitle;
    }
    const artifactPatch = {
      notes: nextNotes,
    };

    const nextJob = normalizeMeetingJob({
      ...source.job,
      ...jobPatch,
    });
    const nextArtifact = source.artifact
      ? normalizeMeetingArtifact({
          ...source.artifact,
          ...artifactPatch,
        })
      : null;
    await Promise.all([
      source.jobRef.set(jobPatch, { merge: true }),
      source.artifactRef ? source.artifactRef.set(artifactPatch, { merge: true }) : Promise.resolve(),
    ]);
    await updateMeetingSummaryRecordResult(owner, nextJob, nextArtifact, updatedAt);

    logEvent("meeting.notes.section-edit.apply.success", {
      jobId: source.job.jobId,
      meetingId: source.job.meetingId,
      providerUserKey: owner.providerUserKey,
      sectionKey: input.sectionKey,
    });

    return {
      notes: nextNotes,
      requestId,
      sectionKey: input.sectionKey,
      title: nextTitle,
    };
  }

  async function loadMeetingNotesSectionEditSource(input, owner) {
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

    const transcriptSource = await loadMeetingTranscriptForNotes(job, createHttpError);
    const currentNotes = normalizeMeetingNotes(transcriptSource.artifact?.notes || job.meetingNotes);
    if (!hasMeetingNotes(currentNotes)) {
      throw createHttpError(409, "수정할 회의 정리가 아직 준비되지 않았어요.");
    }
    const meetingRecord = await loadMeetingSummaryRecord(owner, { meetingId: job.meetingId }, createHttpError);
    const termReplacements = normalizeMeetingTermReplacements(meetingRecord?.meeting?.termReplacements);
    return {
      artifact: transcriptSource.artifact,
      artifactRef: transcriptSource.artifactRef,
      baseRevisionToken: buildMeetingNotesRevisionToken(job, transcriptSource.artifact, currentNotes),
      currentNotes,
      job,
      jobRef,
      termReplacements,
      transcript: transcriptSource.transcript,
    };
  }

  function buildMeetingNotesRevisionToken(jobInput, artifactInput, notesInput) {
    const job = normalizeMeetingJob(jobInput);
    const artifact = artifactInput ? normalizeMeetingArtifact(artifactInput) : null;
    return crypto
      .createHash("sha256")
      .update(JSON.stringify({
        artifactId: normalizeText(artifact?.artifactId),
        jobId: normalizeText(job.jobId),
        notes: normalizeMeetingNotes(notesInput),
        updatedAt: normalizeText(artifact?.notesGeneratedAt || artifact?.createdAt || job.notesGeneratedAt || job.updatedAt),
      }))
      .digest("hex")
      .slice(0, 24);
  }

  function readMeetingNotesSectionData(notesInput, sectionKey) {
    const notes = normalizeMeetingNotes(notesInput);
    switch (sectionKey) {
      case "overview":
        return {
          meetingMeta: notes.meetingMeta,
          overview: notes.overview,
        };
      case "discussionFlow":
        return {
          discussionFlow: notes.discussionFlow,
        };
      case "decisions":
        return {
          decisions: notes.decisions,
        };
      case "openQuestions":
        return {
          openQuestions: notes.openQuestions,
        };
      case "risksOrDependencies":
        return {
          risksOrDependencies: notes.risksOrDependencies,
        };
      case "actionItems":
        return {
          actionItems: notes.actionItems,
        };
      default:
        return {};
    }
  }

  function normalizeMeetingNotesSectionPayload(sectionKey, input) {
    const payload = input && typeof input === "object" ? input : {};
    switch (sectionKey) {
      case "overview": {
        const normalized = normalizeMeetingNotes({
          meetingMeta: payload.meetingMeta,
          overview: payload.overview,
        });
        return {
          meetingMeta: normalized.meetingMeta,
          overview: normalized.overview,
        };
      }
      case "discussionFlow":
        return {
          discussionFlow: normalizeMeetingNotes({ discussionFlow: payload.discussionFlow }).discussionFlow,
        };
      case "decisions":
        return {
          decisions: normalizeMeetingNotes({ decisions: payload.decisions }).decisions,
        };
      case "openQuestions":
        return {
          openQuestions: normalizeMeetingNotes({ openQuestions: payload.openQuestions }).openQuestions,
        };
      case "risksOrDependencies":
        return {
          risksOrDependencies: normalizeMeetingNotes({ risksOrDependencies: payload.risksOrDependencies }).risksOrDependencies,
        };
      case "actionItems":
        return {
          actionItems: normalizeMeetingNotes({ actionItems: payload.actionItems }).actionItems,
        };
      default:
        return {};
    }
  }

  function applyMeetingNotesSectionPayload(currentNotesInput, sectionKey, sectionPayload) {
    const currentNotes = normalizeMeetingNotes(currentNotesInput);
    const payload = normalizeMeetingNotesSectionPayload(sectionKey, sectionPayload);
    switch (sectionKey) {
      case "overview":
        return normalizeMeetingNotes({
          ...currentNotes,
          meetingMeta: {
            ...currentNotes.meetingMeta,
            title: normalizeText(payload.meetingMeta?.title) || currentNotes.meetingMeta.title,
            datetime: normalizeText(payload.meetingMeta?.datetime) || currentNotes.meetingMeta.datetime,
            participants: Array.isArray(payload.meetingMeta?.participants) && payload.meetingMeta.participants.length
              ? payload.meetingMeta.participants
              : currentNotes.meetingMeta.participants,
            purpose: normalizeTextBlock(payload.meetingMeta?.purpose),
          },
          overview: payload.overview,
        });
      case "discussionFlow":
        return normalizeMeetingNotes({
          ...currentNotes,
          discussionFlow: payload.discussionFlow,
        });
      case "decisions":
        return normalizeMeetingNotes({
          ...currentNotes,
          decisions: payload.decisions,
        });
      case "openQuestions":
        return normalizeMeetingNotes({
          ...currentNotes,
          openQuestions: payload.openQuestions,
        });
      case "risksOrDependencies":
        return normalizeMeetingNotes({
          ...currentNotes,
          risksOrDependencies: payload.risksOrDependencies,
        });
      case "actionItems":
        return normalizeMeetingNotes({
          ...currentNotes,
          actionItems: payload.actionItems,
        });
      default:
        return currentNotes;
    }
  }

}

function shouldSyncMeetingTitleToResult(item, previousTitle) {
  const title = normalizeText(item?.title);
  const normalizedPrevious = normalizeText(previousTitle);
  return !title || title === normalizedPrevious;
}

function shouldAutoSyncResultTitleFromNotes(jobInput, currentNotesInput) {
  const job = normalizeMeetingJob(jobInput);
  const currentNotes = normalizeMeetingNotes(currentNotesInput);
  const currentSuggestedTitle = normalizeText(currentNotes.meetingMeta?.title);
  const currentTitle = normalizeText(job.title);
  return !currentTitle || !currentSuggestedTitle || currentTitle === currentSuggestedTitle;
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

function normalizeMeetingJobForSource(input) {
  return normalizeMeetingJob(input);
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

module.exports = {
  registerMeetingHandlers,
};
