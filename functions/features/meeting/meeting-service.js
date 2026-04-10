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
const { createMeetingNotesEditDomain } = require("./meeting-notes-edit-domain");
const { createMeetingCreationDomain } = require("./meeting-creation-domain");
const { createMeetingDeletionDomain } = require("./meeting-deletion-domain");
const { createMeetingNotesDocumentDomain } = require("./meeting-notes-document-domain");
const { createMeetingNotesGenerationDomain } = require("./meeting-notes-generation-domain");
const { createMeetingNotesRuntimeDomain } = require("./meeting-notes-runtime-domain");
const { createMeetingNotesSourceDomain } = require("./meeting-notes-source-domain");
const { createMeetingMutationDomain } = require("./meeting-mutation-domain");
const { createMeetingProcessingDomain } = require("./meeting-processing-domain");
const { createMeetingResultDomain } = require("./meeting-result-domain");
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
  "moveRecord",
  "saveMeetingMemo",
  "saveMeetingTermReplacements",
  "saveMeetingTitle",
  "saveRecordMemo",
  "saveRecordTitle",
]);
const EDITABLE_MEETING_SECTION_KEYS = new Set([
  "summary",
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
  normalizeMeetingResultMoveRequest,
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

  const meetingNotesEditDomain = createMeetingNotesEditDomain({
    applyMeetingTermReplacements,
    assertJobOwnership,
    assertMeetingIsActive,
    buildMeetingNotesTranscriptPrompt,
    buildWorkspaceMutation,
    createHttpError,
    crypto,
    db,
    getClient,
    getMeetingSummaryModel,
    hasMeetingNotes,
    jobCollection: JOB_COLLECTION,
    loadMeetingArtifactSource,
    loadMeetingSummaryRecord,
    loadMeetingTranscriptForNotes,
    loadOwnedMeetingJobs,
    logEvent,
    normalizeCompletionContent,
    normalizeMeetingArtifact,
    normalizeMeetingJob,
    normalizeMeetingNotes,
    normalizeMeetingTermReplacements,
    normalizeText,
    normalizeTextBlock,
    parseMeetingNotesJson,
    resolveMeetingResultTitle,
    updateMeetingSummaryRecordResult,
  });

  const meetingNotesGenerationDomain = createMeetingNotesGenerationDomain({
    applyMeetingTermReplacements,
    buildMeetingNotesTranscriptPrompt,
    buildMeetingNotesTranscriptSections,
    buildTranscriptExcerpt,
    createEmptyMeetingNotesBundle,
    createHttpError,
    createMeetingNotesBundleFromNotes,
    getClient,
    getMeetingClassifierModel,
    getMeetingSummaryModel,
    loadMeetingSummaryRecord,
    normalizeCompletionContent,
    normalizeMeetingNotes,
    normalizeMeetingTermReplacements,
    normalizeText,
    normalizeTextBlock,
    parseMeetingNotesJson,
    limits: {
      MAX_COMPACT_MEETING_NOTES_LINE_CHARS,
      MAX_COMPACT_MEETING_NOTES_OVERVIEW_CHARS,
      MAX_COMPACT_MEETING_NOTES_TITLE_CHARS,
      MAX_MEETING_NOTES_GATE_TRANSCRIPT_CHARS,
      MIN_MEETING_NOTES_DIRECT_SEGMENTS,
      MIN_MEETING_NOTES_DIRECT_SENTENCES,
      MIN_MEETING_NOTES_DIRECT_TEXT_CHARS,
    },
  });

  const meetingResultDomain = createMeetingResultDomain({
    artifactCollection: ARTIFACT_COLLECTION,
    assertJobOwnership,
    assertMeetingIsActive,
    assertMeetingOwnership,
    buildMeetingDocId,
    buildMeetingRecentJobsPatch,
    buildMeetingResultSummary,
    buildWorkspaceMutation,
    createHttpError,
    db,
    jobCollection: JOB_COLLECTION,
    loadMeetingNotesSource,
    meetingCollection: MEETING_COLLECTION,
    mergeRecentJobs,
    normalizeMeetingArtifact,
    normalizeMeetingContext,
    normalizeMeetingJob,
    normalizeMeetingNotesInputSnapshot,
    normalizeMeetingSummary,
    normalizeText,
    updateMeetingSummaryRecordResult,
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
    maybeGenerateMeetingNotes: meetingNotesGenerationDomain.maybeGenerateMeetingNotes,
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
      meetingNotesEditDomain.assertValidMeetingTermReplacementRequest(
        request.body?.termReplacements,
        input.termReplacements,
        input.hasTermReplacements
      );
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
        await meetingNotesEditDomain.applyMeetingTermReplacementsAcrossMeeting(owner, input.meetingId, nextTermReplacements, updatedAt);
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
      const updated = await meetingResultDomain.updateMeetingResult(input, owner);

      logEvent("meeting.result.update.success", {
        jobId: updated.jobId,
        meetingId: updated.meetingId,
        providerUserKey: owner.providerUserKey,
      });
      response.json({
        ok: true,
        data: {
          accepted: true,
          requestId: updated.requestId,
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
      const preview = await meetingNotesEditDomain.previewMeetingNotesSectionEdit(input, owner);
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
      const applied = await meetingNotesEditDomain.applyMeetingNotesSectionEdit(input, owner);
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

  const moveInovaMeetingResult = onRequest({ cors: CORS_ORIGINS, region: REGION }, async (request, response) => {
    try {
      assertMethod(request);
      const input = normalizeMeetingResultMoveRequest(request.body);
      const access = await verifyRequestIdentity(request);
      const owner = access.owner;

      if (!input.meetingId || !input.jobId || !input.targetMeetingId) {
        throw createHttpError(400, "이동할 회의 결과 ID가 비어 있어요.");
      }
      if (input.meetingId === input.targetMeetingId) {
        throw createHttpError(400, "같은 회의 룸으로는 이동할 수 없어요.");
      }
      assertWorkspaceMeetingAccess(access, input.meetingId, createHttpError);
      const moved = await meetingResultDomain.moveMeetingResult(input, owner);

      logEvent("meeting.result.move.success", {
        artifactId: moved.artifactId,
        jobId: moved.jobId,
        meetingId: moved.meetingId,
        providerUserKey: owner.providerUserKey,
        targetMeetingId: moved.targetMeetingId,
      });
      response.json({
        ok: true,
        data: {
          accepted: true,
          jobId: moved.jobId,
          meetingId: moved.meetingId,
          requestId: moved.requestId,
          targetMeetingId: moved.targetMeetingId,
        },
      });
    } catch (error) {
      logEvent("meeting.result.move.error", {
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
    moveInovaMeetingResult,
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

}

function shouldSyncMeetingTitleToResult(item, previousTitle) {
  const title = normalizeText(item?.title);
  const normalizedPrevious = normalizeText(previousTitle);
  return !title || title === normalizedPrevious;
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
