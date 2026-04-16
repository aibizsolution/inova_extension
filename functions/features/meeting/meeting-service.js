const crypto = require("crypto");
const OpenAI = require("openai");
const {
  buildDefaultFileName,
  buildTranscriptExcerpt,
  hasOwn,
  normalizeText,
  normalizeTextBlock,
  normalizeTranscriptSegment,
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
const { createMeetingOwnedQueryDomain } = require("./meeting-owned-query-domain");
const { createMeetingProcessingDomain } = require("./meeting-processing-domain");
const { createMeetingProcessingRuntimeDomain } = require("./meeting-processing-runtime-domain");
const { createMeetingRuntimeArtifactDomain } = require("./meeting-runtime-artifact-domain");
const { createMeetingResultDomain } = require("./meeting-result-domain");
const { createMeetingRecordDomain } = require("./meeting-record-domain");
const { createMeetingSourceDomain } = require("./meeting-source-domain");
const { createMeetingSummarySyncDomain } = require("./meeting-summary-sync-domain");
const { createMeetingStateDomain } = require("./meeting-state-domain");
const { createMeetingTranscriptDomain } = require("./meeting-transcript-domain");

const ALLOWED_CAPTURE_MODES = new Set(["tab-audio", "microphone", "mixed-audio"]);
const DEFAULT_INLINE_AUDIO_LIMIT_BYTES = 25 * 1024 * 1024;
const DEFAULT_SOURCE_TARGET_PART_BYTES = 24 * 1024 * 1024;
const DEFAULT_SOURCE_MAX_BYTES = 200 * 1024 * 1024;
const DEFAULT_SOURCE_MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS = 23 * 60 * 1000;
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
const MAX_MEETING_NOTES_TOPIC_COUNT = 4;
const MAX_MEETING_NOTES_TOPIC_KEY_POINTS = 4;
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
  getMeetingNotesPreviewText,
  hasMeetingNotes,
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
  normalizeMeetingArtifact,
  normalizeMeetingJob,
  normalizeMeetingResultSummary,
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

  const meetingOwnedQueryDomain = createMeetingOwnedQueryDomain({
    buildMeetingDocId,
    compareMeetings,
    db,
    jobCollection: JOB_COLLECTION,
    meetingCollection: MEETING_COLLECTION,
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
    loadOwnedMeetingJobs: meetingOwnedQueryDomain.loadOwnedMeetingJobs,
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

  const meetingProcessingRuntimeDomain = createMeetingProcessingRuntimeDomain({
    OpenAI,
    buildTranscriptText,
    bucket,
    createHttpError,
    defaultMeetingProcessRetryLimit: DEFAULT_MEETING_PROCESS_RETRY_LIMIT,
    defaultSourcePartOverlapMs: DEFAULT_SOURCE_PART_OVERLAP_MS,
    getClient,
    getMeetingModel,
    normalizeMeetingSource,
    normalizeMeetingSourcePart,
    normalizeText,
    normalizeTranscriptionResponse,
    retryableMeetingProcessStatuses: RETRYABLE_MEETING_PROCESS_STATUSES,
    resegmentTranscriptForReview,
  });

  const meetingRuntimeArtifactDomain = createMeetingRuntimeArtifactDomain({
    artifactCollection: ARTIFACT_COLLECTION,
    bucket,
    collectMeetingArtifactIds,
    commandCollection: COMMAND_COLLECTION,
    createHttpError,
    db,
    jobCollection: JOB_COLLECTION,
    jobFinalizerCollection: JOB_FINALIZER_COLLECTION,
    jobPartCollection: JOB_PART_COLLECTION,
    launchCollection: LAUNCH_COLLECTION,
    logEvent,
    normalizeMeetingCommand,
    normalizeMeetingJob,
    normalizeMeetingJobPart,
    normalizeMeetingSource,
    normalizeText,
    normalizeTranscriptSegment,
    workspaceSessionCollection: WORKSPACE_SESSION_COLLECTION,
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
    softDeleteMeetingJob,
    shouldProcessMeetingDeletionTask,
  } = createMeetingDeletionDomain({
    artifactCollection: ARTIFACT_COLLECTION,
    buildMeetingDeletionTaskId,
    buildMeetingDocId,
    buildWorkspaceMutation,
    collectMeetingArtifactIds,
    db,
    deleteDocumentIfExists: meetingRuntimeArtifactDomain.deleteDocumentIfExists,
    deleteMeetingJobRuntimeArtifacts: meetingRuntimeArtifactDomain.deleteMeetingJobRuntimeArtifacts,
    deleteMeetingScopedRuntimeArtifacts: meetingRuntimeArtifactDomain.deleteMeetingScopedRuntimeArtifacts,
    deletionCollection: DELETION_COLLECTION,
    deletionProcessingStaleMs: DELETION_PROCESSING_STALE_MS,
    deletionRetryDelayMs: DELETION_RETRY_DELAY_MS,
    jobCollection: JOB_COLLECTION,
    jobFinalizerCollection: JOB_FINALIZER_COLLECTION,
    loadMeetingCommandDocsByJobId: meetingRuntimeArtifactDomain.loadMeetingCommandDocsByJobId,
    loadMeetingCommandDocsByMeetingId: meetingRuntimeArtifactDomain.loadMeetingCommandDocsByMeetingId,
    loadMeetingJobPartDocs: meetingRuntimeArtifactDomain.loadMeetingJobPartDocs,
    loadMeetingLaunchDocs: meetingRuntimeArtifactDomain.loadMeetingLaunchDocs,
    loadMeetingWorkspaceSessionDocs: meetingRuntimeArtifactDomain.loadMeetingWorkspaceSessionDocs,
    loadOwnedMeetingJobs: meetingOwnedQueryDomain.loadOwnedMeetingJobs,
    loadStoredMeetingJob: meetingRuntimeArtifactDomain.loadStoredMeetingJob,
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
    synchronizeChunkedMeetingJobProgress,
    upsertQueuedMeetingJobParts,
  } = createMeetingProcessingDomain({
    artifactCollection: ARTIFACT_COLLECTION,
    bucket,
    buildChunkTranscriptStorageObjectPath,
    buildMeetingDocId,
    buildMeetingJobPartId,
    buildQueuedMeetingJobFinalizer,
    buildQueuedMeetingJobPart,
    buildSucceededJobPatch,
    buildTranscriptArtifact,
    collectMeetingChunkTranscriptStorageObjects: meetingRuntimeArtifactDomain.collectMeetingChunkTranscriptStorageObjects,
    collectMeetingSourceStorageObjects: meetingRuntimeArtifactDomain.collectMeetingSourceStorageObjects,
    createHttpError,
    db,
    deleteDocumentIfExists: meetingRuntimeArtifactDomain.deleteDocumentIfExists,
    deleteTemporarySourceGroup: meetingRuntimeArtifactDomain.deleteTemporarySourceGroup,
    finalizeCollection: JOB_FINALIZER_COLLECTION,
    formatMeetingProcessErrorMessage: meetingProcessingRuntimeDomain.formatMeetingProcessErrorMessage,
    getMeetingArtifactId,
    getMeetingChunkWorkerQueueConcurrency: meetingProcessingRuntimeDomain.getMeetingChunkWorkerQueueConcurrency,
    getMeetingProcessRetryLimit: meetingProcessingRuntimeDomain.getMeetingProcessRetryLimit,
    isRetryableMeetingProcessError: meetingProcessingRuntimeDomain.isRetryableMeetingProcessError,
    jobCollection: JOB_COLLECTION,
    jobPartCollection: JOB_PART_COLLECTION,
    loadMeetingChunkTranscript: meetingRuntimeArtifactDomain.loadMeetingChunkTranscript,
    loadMeetingJobPartDocs: meetingRuntimeArtifactDomain.loadMeetingJobPartDocs,
    loadStoredMeetingJob: meetingRuntimeArtifactDomain.loadStoredMeetingJob,
    logEvent,
    logMeetingCleanupWarning: meetingRuntimeArtifactDomain.logMeetingCleanupWarning,
    markMeetingSourceDeleted: meetingRuntimeArtifactDomain.markMeetingSourceDeleted,
    maybeGenerateMeetingNotes: meetingNotesGenerationDomain.maybeGenerateMeetingNotes,
    meetingCollection: MEETING_COLLECTION,
    mergeChunkTranscripts: meetingProcessingRuntimeDomain.mergeChunkTranscripts,
    mergeMeetingJobPatch,
    normalizeMeetingContext,
    normalizeMeetingJob,
    normalizeMeetingJobFinalizer,
    normalizeMeetingJobPart,
    normalizeMeetingOptions,
    normalizeMeetingRequest,
    normalizeMeetingSource,
    normalizeText,
    saveMeetingChunkTranscript: meetingRuntimeArtifactDomain.saveMeetingChunkTranscript,
    transcribeMeetingSourcePart: meetingProcessingRuntimeDomain.transcribeMeetingSourcePart,
    transcribeQueuedMeetingSource: meetingProcessingRuntimeDomain.transcribeQueuedMeetingSource,
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
    deleteTemporarySourceGroup: meetingRuntimeArtifactDomain.deleteTemporarySourceGroup,
    getInlineAudioLimitBytes,
    getMeetingSingleTranscribeMaxDurationMs,
    getMeetingSourceMaxBytes,
    getMeetingSourceMaxDurationMs,
    getMeetingSourceTargetPartBytes,
    jobCollection: JOB_COLLECTION,
    loadSourceAudioBuffer: meetingRuntimeArtifactDomain.loadSourceAudioBuffer,
    logEvent,
    logMeetingCleanupWarning: meetingRuntimeArtifactDomain.logMeetingCleanupWarning,
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
    uploadTemporarySource: meetingRuntimeArtifactDomain.uploadTemporarySource,
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
      const uploaded = await meetingRuntimeArtifactDomain.uploadTemporarySource(
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
      const items = await meetingOwnedQueryDomain.loadOwnedMeetings(owner, input.limit, input.cursor);
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
      const jobs = await meetingOwnedQueryDomain.loadOwnedMeetingJobs(owner, meeting.meetingId);
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

function getMeetingSingleTranscribeMaxDurationMs() {
  return Math.max(
    30 * 1000,
    Number(process.env.OPENAI_MEETING_SINGLE_TRANSCRIBE_MAX_DURATION_MS)
      || DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS
  );
}

module.exports = {
  registerMeetingHandlers,
};
