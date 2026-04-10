const assert = require("assert");
const {
  ARTIFACT_COLLECTION,
  JOB_COLLECTION,
  MEETING_COLLECTION,
  invokeHandler,
} = require("./verify-meeting-service-support");

async function verifyMoveMeetingResultFlow(input) {
  const {
    audioPayload,
    compactArtifactId,
    compactJobId,
    handlers,
    invokeJobWriteTrigger,
    owner,
    state,
  } = input || {};
  const moveTargetMeetingId = "meeting-move-target-1";
  const moveTargetMeetingTitle = "이동 대상 회의 룸";
  getCollection(state, MEETING_COLLECTION).set(`fixture-user__${moveTargetMeetingId}`, {
    createdAt: "2026-03-30T10:00:00.000Z",
    latestArtifactId: "",
    latestJobId: "",
    meetingId: moveTargetMeetingId,
    owner,
    recentJobs: [],
    sharedMemo: "",
    status: "idle",
    title: moveTargetMeetingTitle,
    updatedAt: "2026-03-30T10:00:00.000Z",
  });
  getCollection(state, MEETING_COLLECTION).set("fixture-user__meeting-move-deleted-target", {
    createdAt: "2026-03-30T10:05:00.000Z",
    deletedAt: "2026-03-30T10:06:00.000Z",
    meetingId: "meeting-move-deleted-target",
    owner,
    recentJobs: [],
    status: "idle",
    title: "삭제된 이동 대상",
    updatedAt: "2026-03-30T10:06:00.000Z",
  });
  getCollection(state, MEETING_COLLECTION).set("fixture-user__meeting-move-owner-mismatch", {
    createdAt: "2026-03-30T10:07:00.000Z",
    meetingId: "meeting-move-owner-mismatch",
    owner: {
      ...owner,
      providerUserKey: "other-user",
    },
    recentJobs: [],
    status: "idle",
    title: "권한 불일치 회의 룸",
    updatedAt: "2026-03-30T10:07:00.000Z",
  });

  const moveSameMeeting = await invokeHandler(handlers.moveInovaMeetingResult, {
    body: {
      clientRequestId: "move-same-fixture-1",
      jobId: compactJobId,
      meetingId: "meeting-compact-1",
      owner,
      targetMeetingId: "meeting-compact-1",
    },
    method: "POST",
  });
  assert.equal(moveSameMeeting.statusCode, 400);

  const moveMissingTarget = await invokeHandler(handlers.moveInovaMeetingResult, {
    body: {
      clientRequestId: "move-missing-fixture-1",
      jobId: compactJobId,
      meetingId: "meeting-compact-1",
      owner,
      targetMeetingId: "meeting-missing-target",
    },
    method: "POST",
  });
  assert.equal(moveMissingTarget.statusCode, 404);

  const moveDeletedTarget = await invokeHandler(handlers.moveInovaMeetingResult, {
    body: {
      clientRequestId: "move-deleted-target-fixture-1",
      jobId: compactJobId,
      meetingId: "meeting-compact-1",
      owner,
      targetMeetingId: "meeting-move-deleted-target",
    },
    method: "POST",
  });
  assert.equal(moveDeletedTarget.statusCode, 404);

  const moveOwnerMismatch = await invokeHandler(handlers.moveInovaMeetingResult, {
    body: {
      clientRequestId: "move-owner-mismatch-fixture-1",
      jobId: compactJobId,
      meetingId: "meeting-compact-1",
      owner,
      targetMeetingId: "meeting-move-owner-mismatch",
    },
    method: "POST",
  });
  assert.equal(moveOwnerMismatch.statusCode, 403);

  const compactVisibleTitleBeforeMove = getDoc(state, MEETING_COLLECTION, "fixture-user__meeting-compact-1").recentJobs[0].title;
  getCollection(state, JOB_COLLECTION).set(compactJobId, {
    ...getDoc(state, JOB_COLLECTION, compactJobId),
    title: "",
  });

  const movedResult = await invokeHandler(handlers.moveInovaMeetingResult, {
    body: {
      clientRequestId: "move-record-fixture-1",
      jobId: compactJobId,
      meetingId: "meeting-compact-1",
      owner,
      targetMeetingId: moveTargetMeetingId,
    },
    method: "POST",
  });
  assert.equal(movedResult.statusCode, 200);
  assert.equal(movedResult.jsonBody.data.accepted, true);
  assert.equal(movedResult.jsonBody.data.jobId, compactJobId);
  assert.equal(movedResult.jsonBody.data.meetingId, "meeting-compact-1");
  assert.equal(movedResult.jsonBody.data.targetMeetingId, moveTargetMeetingId);

  const movedJob = getDoc(state, JOB_COLLECTION, compactJobId);
  const movedArtifact = getDoc(state, ARTIFACT_COLLECTION, compactArtifactId);
  const compactSourceMeetingAfterMove = getDoc(state, MEETING_COLLECTION, "fixture-user__meeting-compact-1");
  const moveTargetMeeting = getDoc(state, MEETING_COLLECTION, `fixture-user__${moveTargetMeetingId}`);
  assert.equal(movedJob.jobId, compactJobId);
  assert.equal(movedArtifact.artifactId, compactArtifactId);
  assert.equal(movedJob.meetingId, moveTargetMeetingId);
  assert.equal(movedJob.meeting.meetingId, moveTargetMeetingId);
  assert.equal(movedJob.meeting.title, moveTargetMeetingTitle);
  assert.equal(movedJob.title, compactVisibleTitleBeforeMove);
  assert.equal(movedArtifact.meetingId, moveTargetMeetingId);
  assert.equal(compactSourceMeetingAfterMove.latestJobId, "");
  assert.equal(compactSourceMeetingAfterMove.latestArtifactId, "");
  assert.equal(compactSourceMeetingAfterMove.excerpt, "");
  assert.equal(compactSourceMeetingAfterMove.status, "idle");
  assert.equal(compactSourceMeetingAfterMove.recentJobs.length, 0);
  assert.equal(moveTargetMeeting.latestJobId, compactJobId);
  assert.equal(moveTargetMeeting.latestArtifactId, compactArtifactId);
  assert.equal(moveTargetMeeting.recentJobs.length, 1);
  assert.equal(moveTargetMeeting.recentJobs[0].jobId, compactJobId);
  assert.equal(moveTargetMeeting.recentJobs[0].meetingId, moveTargetMeetingId);
  assert.equal(moveTargetMeeting.recentJobs[0].title, compactVisibleTitleBeforeMove);

  const pendingMoveCreated = await invokeHandler(handlers.createInovaMeetingJob, {
    body: {
      meeting: {
        endedAt: "2026-03-30T10:31:00.000Z",
        language: "ko",
        meetingId: "meeting-move-pending-1",
        startedAt: "2026-03-30T10:30:00.000Z",
        title: "이동 대기 회의",
      },
      options: { redaction: "none", summary: true },
      owner,
      source: {
        captureMode: "microphone",
        channelCount: 1,
        durationMs: 12000,
        fileName: "move-pending.webm",
        inlineAudioBase64: audioPayload,
        mimeType: "audio/webm;codecs=opus",
        requestId: "capture-move-pending-1",
        sizeBytes: Buffer.from(audioPayload, "base64").length,
      },
    },
    method: "POST",
  });
  assert.equal(pendingMoveCreated.statusCode, 200);
  const pendingMoveJobId = pendingMoveCreated.jsonBody.data.job.jobId;
  if (!getCollection(state, MEETING_COLLECTION).has("fixture-user__meeting-move-pending-1")) {
    getCollection(state, MEETING_COLLECTION).set("fixture-user__meeting-move-pending-1", {
      createdAt: "2026-03-30T10:30:00.000Z",
      meetingId: "meeting-move-pending-1",
      owner,
      recentJobs: [],
      status: "queued",
      title: "이동 대기 회의",
      updatedAt: "2026-03-30T10:30:00.000Z",
    });
  }
  const movePendingResult = await invokeHandler(handlers.moveInovaMeetingResult, {
    body: {
      clientRequestId: "move-pending-fixture-1",
      jobId: pendingMoveJobId,
      meetingId: "meeting-move-pending-1",
      owner,
      targetMeetingId: moveTargetMeetingId,
    },
    method: "POST",
  });
  assert.equal(movePendingResult.statusCode, 409);

  const deletedMoveCreated = await invokeHandler(handlers.createInovaMeetingJob, {
    body: {
      meeting: {
        endedAt: "2026-03-30T10:41:00.000Z",
        language: "ko",
        meetingId: "meeting-move-deleted-1",
        startedAt: "2026-03-30T10:40:00.000Z",
        title: "삭제된 이동 테스트",
      },
      options: { redaction: "none", summary: true },
      owner,
      source: {
        captureMode: "microphone",
        channelCount: 1,
        durationMs: 12000,
        fileName: "move-deleted.webm",
        inlineAudioBase64: audioPayload,
        mimeType: "audio/webm;codecs=opus",
        requestId: "capture-move-deleted-1",
        sizeBytes: Buffer.from(audioPayload, "base64").length,
      },
    },
    method: "POST",
  });
  assert.equal(deletedMoveCreated.statusCode, 200);
  const deletedMoveJobId = deletedMoveCreated.jsonBody.data.job.jobId;
  await invokeJobWriteTrigger(handlers, state, deletedMoveJobId);
  getCollection(state, JOB_COLLECTION).set(deletedMoveJobId, {
    ...getDoc(state, JOB_COLLECTION, deletedMoveJobId),
    deletedAt: "2026-03-30T10:42:00.000Z",
  });
  const moveDeletedResult = await invokeHandler(handlers.moveInovaMeetingResult, {
    body: {
      clientRequestId: "move-deleted-fixture-1",
      jobId: deletedMoveJobId,
      meetingId: "meeting-move-deleted-1",
      owner,
      targetMeetingId: moveTargetMeetingId,
    },
    method: "POST",
  });
  assert.equal(moveDeletedResult.statusCode, 404);
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
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

module.exports = {
  verifyMoveMeetingResultFlow,
};
