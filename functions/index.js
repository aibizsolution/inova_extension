const { registerAdminHandlers } = require("./features/admin/admin-service");
const { registerMeetingLaunchHandlers } = require("./features/meeting/meeting-launch-service");
const { registerMeetingWorkspaceAuthHandlers } = require("./features/meeting/meeting-workspace-auth-service");
const { registerMeetingHandlers } = require("./features/meeting/meeting-service");
const { registerFeatureUsageHandlers } = require("./features/feature-usage/feature-usage-service");
const { registerPromptLibraryHandlers } = require("./features/prompt-library/register");
const { registerPromptReviewHandlers } = require("./features/prompt-review/prompt-review-service");
const { registerStoreHandlers } = require("./features/prompt-store/store-service");
const { defineSecret } = require("firebase-functions/params");
const {
  admin,
  bucket,
  buildPromptLibraryId,
  buildPromptPanelFirebaseUid,
  CORS_ORIGINS,
  createHttpError,
  db,
  HOSTED_MEETING_PAGE_URL,
  logEvent,
  MAX_CONTENT_LENGTH,
  MAX_TITLE_LENGTH,
  normalizeIdentity,
  normalizePromptContent,
  normalizeText,
  onDocumentWritten,
  onRequest,
  onSchedule,
  REGION,
  sendError,
  STORE_CATEGORIES,
  verifyInovaIdentity,
} = require("./platform/runtime");

const OPENAI_API_KEY_SECRET = defineSecret("OPENAI_API_KEY");

function withOpenAISecret(options = {}) {
  const existingSecrets = Array.isArray(options.secrets) ? options.secrets : [];
  return {
    ...options,
    secrets: existingSecrets.includes(OPENAI_API_KEY_SECRET)
      ? existingSecrets
      : [...existingSecrets, OPENAI_API_KEY_SECRET],
  };
}

function onOpenAIRequest(options, handler) {
  return onRequest(withOpenAISecret(options), handler);
}

const sharedHttpDeps = {
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
};

const storeHandlers = registerStoreHandlers({
  ...sharedHttpDeps,
  admin,
  MAX_CONTENT_LENGTH,
  MAX_TITLE_LENGTH,
  normalizePromptContent,
  STORE_CATEGORIES,
});

const promptReviewHandlers = registerPromptReviewHandlers({
  ...sharedHttpDeps,
  admin,
  onRequest: onOpenAIRequest,
});

const meetingLaunchHandlers = registerMeetingLaunchHandlers({
  ...sharedHttpDeps,
  createFirebaseCustomToken: (uid, claims) => admin.auth().createCustomToken(uid, claims),
  hostedMeetingPageUrl: HOSTED_MEETING_PAGE_URL,
});

const meetingWorkspaceAuthHandlers = registerMeetingWorkspaceAuthHandlers({
  ...sharedHttpDeps,
  createFirebaseCustomToken: (uid, claims) => admin.auth().createCustomToken(uid, claims),
  verifyFirebaseIdToken: (token) => admin.auth().verifyIdToken(token),
});

const meetingHandlers = registerMeetingHandlers({
  ...sharedHttpDeps,
  admin,
  authorizeMeetingRequest: meetingWorkspaceAuthHandlers.authorizeMeetingRequest,
  bucket,
  onOpenAIRequest,
});

const featureUsageHandlers = registerFeatureUsageHandlers({
  ...sharedHttpDeps,
  FieldValue: admin.firestore.FieldValue,
});

const adminHandlers = registerAdminHandlers({
  ...sharedHttpDeps,
});

const promptLibraryHandlers = registerPromptLibraryHandlers({
  ...sharedHttpDeps,
  admin,
  buildPromptLibraryId,
  buildPromptPanelFirebaseUid,
  MAX_CONTENT_LENGTH,
  MAX_TITLE_LENGTH,
  normalizePromptContent,
});

const promptLibraryV2Handlers = registerPromptLibraryHandlers({
  ...sharedHttpDeps,
  admin,
  buildPromptLibraryId: (providerUserKey) => `v2__${buildPromptLibraryId(providerUserKey)}`,
  buildPromptPanelFirebaseUid: (providerUserKey) => `prompt-panel-v2__${providerUserKey}`,
  MAX_CONTENT_LENGTH,
  MAX_TITLE_LENGTH,
  normalizePromptContent,
  promptAccountsCollection: "integration_inova_accounts_v2",
  promptLibrariesCollection: "prompt_libraries_v2",
  promptLibraryChunksCollection: "prompt_library_chunks_v2",
  promptLibraryMigrationCollection: "product_lane_migrations_v2",
  promptLibraryOrdersCollection: "prompt_library_orders_v2",
  promptLegacySource: {
    accounts: "integration_inova_accounts",
    buildPromptLibraryId,
    promptLibraries: "prompt_libraries",
    promptLibraryChunks: "prompt_library_chunks",
    promptLibraryOrders: "prompt_library_orders",
  },
  promptPanelScope: "prompt-panel-v2",
});

exports.listPromptStoreEntries = storeHandlers.listPromptStoreEntries;
exports.publishPromptToStore = storeHandlers.publishPromptToStore;
exports.unpublishPromptFromStore = storeHandlers.unpublishPromptFromStore;
exports.importPromptStoreEntry = storeHandlers.importPromptStoreEntry;
exports.togglePromptStoreLike = storeHandlers.togglePromptStoreLike;
exports.recordPromptStoreView = storeHandlers.recordPromptStoreView;

exports.reviewInovaPrompt = promptReviewHandlers.reviewInovaPrompt;
exports.commitInovaFeatureUsageBatch = featureUsageHandlers.commitInovaFeatureUsageBatch;
exports.checkInovaAdminAccess = adminHandlers.checkInovaAdminAccess;
exports.exchangeInovaAdminLaunch = adminHandlers.exchangeInovaAdminLaunch;
exports.issueInovaAdminLaunch = adminHandlers.issueInovaAdminLaunch;
exports.readInovaAdminBootstrap = adminHandlers.readInovaAdminBootstrap;

exports.issueInovaPromptPanelAuth = promptLibraryHandlers.issueInovaPromptPanelAuth;
exports.issueInovaPromptPanelAuthV2 = promptLibraryV2Handlers.issueInovaPromptPanelAuth;
exports.loadInovaPromptLibrary = promptLibraryHandlers.loadInovaPromptLibrary;
exports.loadInovaPromptLibraryV2 = promptLibraryV2Handlers.loadInovaPromptLibrary;
exports.peekInovaPromptLibrary = promptLibraryHandlers.peekInovaPromptLibrary;
exports.peekInovaPromptLibraryV2 = promptLibraryV2Handlers.peekInovaPromptLibrary;
exports.syncInovaPromptLibrary = promptLibraryHandlers.syncInovaPromptLibrary;
exports.syncInovaPromptLibraryV2 = promptLibraryV2Handlers.syncInovaPromptLibrary;

exports.createInovaMeetingJob = meetingHandlers.createInovaMeetingJob;
exports.processQueuedInovaMeetingJob = onDocumentWritten(
  withOpenAISecret({
    concurrency: 1,
    document: "integration_inova_meeting_jobs/{jobId}",
    maxInstances: 80,
    memory: "1GiB",
    region: REGION,
    timeoutSeconds: 120,
  }),
  meetingHandlers.processQueuedMeetingJobWrite
);
exports.processQueuedInovaMeetingJobPart = onDocumentWritten(
  withOpenAISecret({
    document: "integration_inova_meeting_job_parts/{partId}",
    concurrency: 2,
    cpu: 1,
    maxInstances: 200,
    memory: "2GiB",
    region: REGION,
    timeoutSeconds: 180,
  }),
  meetingHandlers.processQueuedMeetingJobPartWrite
);
exports.finalizeChunkedInovaMeetingJob = onDocumentWritten(
  withOpenAISecret({
    concurrency: 1,
    document: "integration_inova_meeting_job_finalizers/{jobId}",
    maxInstances: 80,
    memory: "1GiB",
    region: REGION,
    timeoutSeconds: 180,
  }),
  meetingHandlers.finalizeChunkedMeetingJobWrite
);
exports.processQueuedInovaMeetingCommand = onDocumentWritten(
  withOpenAISecret({
    concurrency: 1,
    document: "integration_inova_meeting_commands/{commandId}",
    maxInstances: 20,
    memory: "512MiB",
    region: REGION,
    timeoutSeconds: 120,
  }),
  meetingHandlers.processQueuedMeetingCommandWrite
);
exports.processQueuedInovaMeetingDeletion = onDocumentWritten(
  {
    concurrency: 1,
    document: "integration_inova_meeting_deletions/{taskId}",
    maxInstances: 5,
    memory: "512MiB",
    region: REGION,
    timeoutSeconds: 120,
  },
  meetingHandlers.processMeetingDeletionWrite
);
exports.sweepQueuedInovaMeetingDeletions = onSchedule(
  {
    concurrency: 1,
    maxInstances: 1,
    memory: "256MiB",
    region: REGION,
    schedule: "every 60 minutes",
    timeoutSeconds: 60,
    timeZone: "Asia/Seoul",
  },
  meetingHandlers.sweepQueuedMeetingDeletions
);
exports.deleteInovaMeeting = meetingHandlers.deleteInovaMeeting;
exports.deleteInovaMeetingResult = meetingHandlers.deleteInovaMeetingResult;
exports.authorizeInovaMeetingWorkspaceAccess = meetingWorkspaceAuthHandlers.authorizeInovaMeetingWorkspaceAccess;
exports.applyInovaMeetingResultSectionEdit = meetingHandlers.applyInovaMeetingResultSectionEdit;
exports.createInovaMeetingShareLink = meetingWorkspaceAuthHandlers.createInovaMeetingShareLink;
exports.exchangeInovaMeetingLaunch = meetingLaunchHandlers.exchangeInovaMeetingLaunch;
exports.hideInovaMeetingParticipation = meetingWorkspaceAuthHandlers.hideInovaMeetingParticipation;
exports.issueInovaMeetingLaunch = meetingLaunchHandlers.issueInovaMeetingLaunch;
exports.issueInovaMeetingPanelAuth = meetingLaunchHandlers.issueInovaMeetingPanelAuth;
exports.issueInovaMeetingWorkspaceAuth = meetingLaunchHandlers.issueInovaMeetingWorkspaceAuth;
exports.listInovaMeetings = meetingHandlers.listInovaMeetings;
exports.moveInovaMeetingResult = meetingHandlers.moveInovaMeetingResult;
exports.previewInovaMeetingResultSectionEdit = meetingHandlers.previewInovaMeetingResultSectionEdit;
exports.revokeInovaMeetingShareLink = meetingWorkspaceAuthHandlers.revokeInovaMeetingShareLink;
exports.updateInovaMeeting = meetingHandlers.updateInovaMeeting;
exports.updateInovaMeetingResult = meetingHandlers.updateInovaMeetingResult;
exports.uploadInovaMeetingSource = meetingHandlers.uploadInovaMeetingSource;
