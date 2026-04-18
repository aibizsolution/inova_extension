const assert = require("assert");
const { registerMeetingLaunchHandlers } = require("../functions/features/meeting/meeting-launch-service");
const { registerMeetingHandlers } = require("../functions/features/meeting/meeting-service");
const {
  DELETION_COLLECTION,
  JOB_COLLECTION,
  createDeps,
  createMemoryState,
  invokeDeletionWriteTrigger,
  invokeHandler,
  invokeJobWriteTrigger,
} = require("./verify-meeting-service-support");

async function verifyMeetingCleanupFailureGuards({ audioPayload, owner }) {
  const uploadFailureState = createMemoryState();
  const uploadFailureDeps = createDeps(uploadFailureState, { bucket: createSaveFailingBucket(uploadFailureState, "forced-upload-failure") });
  const uploadFailureLaunchHandlers = registerMeetingLaunchHandlers(uploadFailureDeps);
  const uploadFailureHandlers = registerMeetingHandlers({
    ...uploadFailureDeps,
    authorizeMeetingRequest: uploadFailureLaunchHandlers.authorizeMeetingRequest,
  });
  const uploadFailureCreate = await invokeHandler(uploadFailureHandlers.createInovaMeetingJob, {
    body: {
      meeting: {
        endedAt: "2026-03-30T09:15:00.000Z",
        language: "ko",
        meetingId: "meeting-upload-failure-1",
        startedAt: "2026-03-30T09:10:00.000Z",
        title: "업로드 실패 회의",
      },
      options: { redaction: "none", summary: true },
      owner,
      source: {
        captureMode: "microphone",
        channelCount: 1,
        durationMs: 12000,
        fileName: "upload-failure.webm",
        inlineAudioBase64: audioPayload,
        mimeType: "audio/webm;codecs=opus",
        requestId: "capture-upload-failure-1",
        sizeBytes: Buffer.from(audioPayload, "base64").length,
      },
    },
    method: "POST",
  });
  assert.equal(uploadFailureCreate.statusCode, 500);
  assert.equal(uploadFailureCreate.jsonBody.error, "회의 임시 오디오 업로드를 저장하지 못했어요.");
  assert.equal(
    Array.from(uploadFailureState.uploads.values()).some((entry) => entry.deleted === true),
    true
  );

  const cleanupWarningState = createMemoryState();
  const cleanupWarningDeps = createDeps(cleanupWarningState, { bucket: createDeleteFailingBucket(cleanupWarningState, "forced-delete-failure") });
  const cleanupWarningLaunchHandlers = registerMeetingLaunchHandlers(cleanupWarningDeps);
  const cleanupWarningHandlers = registerMeetingHandlers({
    ...cleanupWarningDeps,
    authorizeMeetingRequest: cleanupWarningLaunchHandlers.authorizeMeetingRequest,
  });
  const cleanupWarningCreate = await invokeHandler(cleanupWarningHandlers.createInovaMeetingJob, {
    body: {
      meeting: {
        endedAt: "2026-03-30T09:25:00.000Z",
        language: "ko",
        meetingId: "meeting-cleanup-warning-1",
        startedAt: "2026-03-30T09:20:00.000Z",
        title: "정리 경고 회의",
      },
      options: { redaction: "none", summary: true },
      owner,
      source: {
        captureMode: "microphone",
        channelCount: 1,
        durationMs: 12000,
        fileName: "cleanup-warning.webm",
        inlineAudioBase64: audioPayload,
        mimeType: "audio/webm;codecs=opus",
        requestId: "capture-cleanup-warning-1",
        sizeBytes: Buffer.from(audioPayload, "base64").length,
      },
    },
    method: "POST",
  });
  assert.equal(cleanupWarningCreate.statusCode, 200);
  await invokeJobWriteTrigger(cleanupWarningHandlers, cleanupWarningState, cleanupWarningCreate.jsonBody.data.job.jobId);
  const cleanupWarningJob = getDoc(cleanupWarningState, JOB_COLLECTION, cleanupWarningCreate.jsonBody.data.job.jobId);
  assert(cleanupWarningJob);
  assert.equal(cleanupWarningJob.status, "succeeded");
  assert.equal(cleanupWarningJob.cleanup.sourceAudioDeleted, false);
  assert.equal(cleanupWarningJob.source.uploadStatus, "uploaded");
  assert.equal(
    cleanupWarningState.events.some((event) =>
      event.name === "meeting.process.cleanup.warning"
      && event.payload.jobId === cleanupWarningJob.jobId
      && Number(event.payload.failedStorageObjectCount) === 1
    ),
    true
  );

  const cleanupWarningDelete = await invokeHandler(cleanupWarningHandlers.deleteInovaMeetingResult, {
    body: {
      jobId: cleanupWarningJob.jobId,
      meetingId: "meeting-cleanup-warning-1",
      owner,
    },
    method: "POST",
  });
  assert.equal(cleanupWarningDelete.statusCode, 200);
  const cleanupTaskId = cleanupWarningDelete.jsonBody.data.queueTaskId;
  for (let attemptIndex = 0; attemptIndex < 5; attemptIndex += 1) {
    await invokeDeletionWriteTrigger(cleanupWarningHandlers, cleanupWarningState, cleanupTaskId);
    const task = getDoc(cleanupWarningState, DELETION_COLLECTION, cleanupTaskId);
    if (task?.status === "abandoned") {
      break;
    }
    getCollection(cleanupWarningState, DELETION_COLLECTION).set(cleanupTaskId, {
      ...task,
      nextRetryAt: "",
    });
  }
  const abandonedCleanupTask = getDoc(cleanupWarningState, DELETION_COLLECTION, cleanupTaskId);
  assert.equal(abandonedCleanupTask.status, "abandoned");
  assert.equal(abandonedCleanupTask.attemptCount, 5);
  assert.equal(
    cleanupWarningState.events.some((event) =>
      event.name === "meeting.deletion.process.abandoned"
      && event.payload.taskId === cleanupTaskId
    ),
    true
  );
}

function getCollection(state, collectionName) {
  if (!state.collections.has(collectionName)) {
    state.collections.set(collectionName, new Map());
  }
  return state.collections.get(collectionName);
}

function getDoc(state, collectionName, docId) {
  if (!docId) {
    return null;
  }
  const collection = getCollection(state, collectionName);
  const value = collection.get(docId);
  return value == null ? null : cloneValue(value);
}

function createSaveFailingBucket(state, message) {
  return {
    file(storageObject) {
      const normalizedStorageObject = String(storageObject || "").trim();
      return {
        async delete() {
          const current = state.uploads.get(normalizedStorageObject) || {};
          state.uploads.set(normalizedStorageObject, { ...current, deleted: true });
        },
        async download() {
          const current = state.uploads.get(normalizedStorageObject);
          return [Buffer.from(current?.buffer || Buffer.alloc(0))];
        },
        async save() {
          throw new Error(message);
        },
      };
    },
  };
}

function createDeleteFailingBucket(state, message) {
  return {
    file(storageObject) {
      const normalizedStorageObject = String(storageObject || "").trim();
      return {
        async delete() {
          throw new Error(message);
        },
        async download() {
          const current = state.uploads.get(normalizedStorageObject);
          return [Buffer.from(current?.buffer || Buffer.alloc(0))];
        },
        async save(buffer, options = {}) {
          state.uploads.set(normalizedStorageObject, {
            buffer: Buffer.from(buffer),
            contentType: options.contentType || "",
            deleted: false,
            metadata: cloneValue(options.metadata || {}),
          });
        },
      };
    },
  };
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

module.exports = {
  verifyMeetingCleanupFailureGuards,
};
