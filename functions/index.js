const { registerMeetingLaunchHandlers } = require("./features/meeting/meeting-launch-service");
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

const meetingHandlers = registerMeetingHandlers({
  ...sharedHttpDeps,
  admin,
  authorizeMeetingRequest: meetingLaunchHandlers.authorizeMeetingRequest,
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
    document: "integration_inova_meeting_jobs/{jobId}",
    memory: "1GiB",
    region: REGION,
    timeoutSeconds: 540,
  },
  meetingHandlers.processQueuedMeetingJobWrite
);
exports.processQueuedInovaMeetingJobPart = onDocumentWritten(
  {
    document: "integration_inova_meeting_job_parts/{partId}",
    concurrency: 1,
    memory: "1GiB",
    region: REGION,
    timeoutSeconds: 540,
  },
  meetingHandlers.processQueuedMeetingJobPartWrite
);
exports.finalizeChunkedInovaMeetingJob = onDocumentWritten(
  {
    document: "integration_inova_meeting_job_finalizers/{jobId}",
    memory: "1GiB",
    region: REGION,
    timeoutSeconds: 540,
  },
  meetingHandlers.finalizeChunkedMeetingJobWrite
);
exports.deleteInovaMeeting = meetingHandlers.deleteInovaMeeting;
exports.deleteInovaMeetingResult = meetingHandlers.deleteInovaMeetingResult;
exports.exchangeInovaMeetingLaunch = meetingLaunchHandlers.exchangeInovaMeetingLaunch;
exports.getInovaMeetingArtifact = meetingHandlers.getInovaMeetingArtifact;
exports.getInovaMeetingJob = meetingHandlers.getInovaMeetingJob;
exports.issueInovaMeetingLaunch = meetingLaunchHandlers.issueInovaMeetingLaunch;
exports.issueInovaMeetingPanelAuth = meetingLaunchHandlers.issueInovaMeetingPanelAuth;
exports.issueInovaMeetingWorkspaceAuth = meetingLaunchHandlers.issueInovaMeetingWorkspaceAuth;
exports.listInovaMeetingResults = meetingHandlers.listInovaMeetingResults;
exports.listInovaMeetings = meetingHandlers.listInovaMeetings;
exports.regenerateInovaMeetingNotes = meetingHandlers.regenerateInovaMeetingNotes;
exports.updateInovaMeeting = meetingHandlers.updateInovaMeeting;
exports.updateInovaMeetingResult = meetingHandlers.updateInovaMeetingResult;
exports.uploadInovaMeetingSource = meetingHandlers.uploadInovaMeetingSource;
