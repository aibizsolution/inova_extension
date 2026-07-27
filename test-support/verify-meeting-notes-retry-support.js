const assert = require("assert");
const {
  COMMAND_COLLECTION,
  JOB_COLLECTION,
  invokeCommandWriteTrigger,
  invokeHandler,
} = require("./verify-meeting-service-support");

async function verifyMeetingResultUpdateAndNotesRetryFlow({ handlers, jobId, meetingId, owner, state }) {
  const updated = await invokeHandler(handlers.updateInovaMeetingResult, {
    body: {
      jobId,
      meetingId,
      owner,
      sharedMemo: "회의 후속 조치와 디자인 시안 리뷰 일정까지 포함합니다.",
      title: "3월 30일 회의록",
    },
    method: "POST",
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.jsonBody.data.accepted, true);
  const updatedJob = readDoc(state, JOB_COLLECTION, jobId);
  assert.equal(updatedJob.title, "3월 30일 회의록");
  assert.equal(updatedJob.context.sharedMemoSnapshot, "회의 후속 조치와 디자인 시안 리뷰 일정까지 포함합니다.");
  assert.equal(typeof updatedJob.notesContextItems, "undefined");

  const jobs = getCollection(state, JOB_COLLECTION);
  jobs.set(jobId, {
    ...updatedJob,
    meetingNotes: {},
    notesDegradedReason: "회의 정리 모델 응답이 비어 있어요.",
    notesFailure: {
      attemptCount: 1,
      code: "empty_response",
      failedAt: "2026-07-27T00:00:00.000Z",
      finishReason: "stop",
      model: "fixture-model",
      stage: "generation",
    },
    notesGeneratedAt: "",
    notesStatus: "degraded",
  });

  const requestId = "notes-retry-fixture-1";
  const accepted = await invokeHandler(handlers.updateInovaMeetingResult, {
    body: {
      action: "retry_notes",
      clientRequestId: requestId,
      jobId,
      meetingId,
      owner,
    },
    method: "POST",
  });
  assert.equal(accepted.statusCode, 202);
  assert.equal(accepted.jsonBody.data.requestId, requestId);
  assert.equal(readDoc(state, COMMAND_COLLECTION, requestId).status, "queued");

  await invokeCommandWriteTrigger(handlers, state, requestId);

  const retriedJob = readDoc(state, JOB_COLLECTION, jobId);
  assert.equal(readDoc(state, COMMAND_COLLECTION, requestId).status, "succeeded");
  assert.equal(retriedJob.notesStatus, "succeeded");
  assert.equal(retriedJob.notesFailure, null);
  assert.equal(retriedJob.workspaceMutation.type, "retryNotes");
  assert.equal(retriedJob.workspaceMutation.status, "succeeded");
}

function getCollection(state, collectionName) {
  if (!state.collections.has(collectionName)) {
    state.collections.set(collectionName, new Map());
  }
  return state.collections.get(collectionName);
}

function readDoc(state, collectionName, docId) {
  return cloneValue(getCollection(state, collectionName).get(docId));
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

module.exports = {
  verifyMeetingResultUpdateAndNotesRetryFlow,
};
