const { registerMeetingLaunchHandlers } = require("./features/meeting/meeting-launch-service");
const { registerMeetingWorkspaceAuthHandlers } = require("./features/meeting/meeting-workspace-auth-service");
const { registerMeetingHandlers } = require("./features/meeting/meeting-service");
const { registerPromptLibraryHandlers } = require("./features/prompt-library/register");
const { registerPromptReviewHandlers } = require("./features/prompt-review/prompt-review-service");
const { registerStoreHandlers } = require("./features/prompt-store/store-service");
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
  STORE_CATEGORY_IDS,
  verifyInovaIdentity,
} = require("./platform/runtime");

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
  STORE_CATEGORY_IDS,
});

const promptReviewHandlers = registerPromptReviewHandlers({
  ...sharedHttpDeps,
  admin,
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

exports.listPromptStoreEntries = storeHandlers.listPromptStoreEntries;
exports.publishPromptToStore = storeHandlers.publishPromptToStore;
exports.unpublishPromptFromStore = storeHandlers.unpublishPromptFromStore;
exports.importPromptStoreEntry = storeHandlers.importPromptStoreEntry;
exports.togglePromptStoreLike = storeHandlers.togglePromptStoreLike;
exports.recordPromptStoreView = storeHandlers.recordPromptStoreView;

exports.reviewInovaPrompt = promptReviewHandlers.reviewInovaPrompt;

exports.issueInovaPromptPanelAuth = promptLibraryHandlers.issueInovaPromptPanelAuth;
exports.loadInovaPromptLibrary = promptLibraryHandlers.loadInovaPromptLibrary;
exports.peekInovaPromptLibrary = promptLibraryHandlers.peekInovaPromptLibrary;
exports.syncInovaPromptLibrary = promptLibraryHandlers.syncInovaPromptLibrary;

exports.createInovaMeetingJob = meetingHandlers.createInovaMeetingJob;
exports.processQueuedInovaMeetingJob = onDocumentWritten(
  {
    concurrency: 1,
    document: "integration_inova_meeting_jobs/{jobId}",
    maxInstances: 20,
    memory: "1GiB",
    region: REGION,
    timeoutSeconds: 120,
  },
  meetingHandlers.processQueuedMeetingJobWrite
);
exports.processQueuedInovaMeetingJobPart = onDocumentWritten(
  {
    document: "integration_inova_meeting_job_parts/{partId}",
    concurrency: 1,
    maxInstances: 80,
    memory: "1GiB",
    region: REGION,
    timeoutSeconds: 180,
  },
  meetingHandlers.processQueuedMeetingJobPartWrite
);
exports.finalizeChunkedInovaMeetingJob = onDocumentWritten(
  {
    concurrency: 1,
    document: "integration_inova_meeting_job_finalizers/{jobId}",
    maxInstances: 20,
    memory: "1GiB",
    region: REGION,
    timeoutSeconds: 180,
  },
  meetingHandlers.finalizeChunkedMeetingJobWrite
);
exports.processQueuedInovaMeetingCommand = onDocumentWritten(
  {
    concurrency: 1,
    document: "integration_inova_meeting_commands/{commandId}",
    maxInstances: 10,
    memory: "512MiB",
    region: REGION,
    timeoutSeconds: 120,
  },
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
exports.createInovaMeetingShareLink = meetingWorkspaceAuthHandlers.createInovaMeetingShareLink;
exports.exchangeInovaMeetingLaunch = meetingLaunchHandlers.exchangeInovaMeetingLaunch;
exports.issueInovaMeetingLaunch = meetingLaunchHandlers.issueInovaMeetingLaunch;
exports.issueInovaMeetingPanelAuth = meetingLaunchHandlers.issueInovaMeetingPanelAuth;
exports.issueInovaMeetingWorkspaceAuth = meetingLaunchHandlers.issueInovaMeetingWorkspaceAuth;
exports.listInovaMeetings = meetingHandlers.listInovaMeetings;
exports.regenerateInovaMeetingNotes = meetingHandlers.regenerateInovaMeetingNotes;
exports.revokeInovaMeetingShareLink = meetingWorkspaceAuthHandlers.revokeInovaMeetingShareLink;
exports.updateInovaMeeting = meetingHandlers.updateInovaMeeting;
exports.updateInovaMeetingResult = meetingHandlers.updateInovaMeetingResult;
exports.uploadInovaMeetingSource = meetingHandlers.uploadInovaMeetingSource;
