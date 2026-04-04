#!/usr/bin/env node

const assert = require("assert");
const { registerMeetingLaunchHandlers } = require("../functions/features/meeting/meeting-launch-service");
const { registerMeetingHandlers } = require("../functions/features/meeting/meeting-service");
const {
  ARTIFACT_COLLECTION,
  JOB_COLLECTION,
  JOB_FINALIZER_COLLECTION,
  JOB_PART_COLLECTION,
  MEETING_COLLECTION,
  WORKSPACE_SESSION_COLLECTION,
  createDeps,
  createMemoryState,
  drainChunkedMeetingPipeline,
  invokeDeletionWriteTrigger,
  invokeHandler,
  invokeJobWriteTrigger,
} = require("../test-support/verify-meeting-service-support");

async function main() {
  const owner = {
    displayName: "Fixture User",
    email: "fixture@example.com",
    numericUserId: 1001,
    provider: "inova",
    providerUserKey: "fixture-user",
  };

  const state = createMemoryState();
  const deps = createDeps(state);
  const launchHandlers = registerMeetingLaunchHandlers(deps);
  const handlers = registerMeetingHandlers({
    ...deps,
    authorizeMeetingRequest: launchHandlers.authorizeMeetingRequest,
  });
  const removedJobHandlerName = ["get", "Inova", "Meeting", "Job"].join("");
  const removedArtifactHandlerName = ["get", "Inova", "Meeting", "Artifact"].join("");
  const removedResultsHandlerName = ["list", "Inova", "Meeting", "Results"].join("");
  const removedSessionCollectionName = ["integration", "inova", "meeting", "sessions"].join("_");

  assert.equal(typeof handlers[removedJobHandlerName], "undefined");
  assert.equal(typeof handlers[removedArtifactHandlerName], "undefined");
  assert.equal(typeof handlers[removedResultsHandlerName], "undefined");

  const issuedLaunch = await invokeHandler(launchHandlers.issueInovaMeetingLaunch, {
    body: {
      meetingId: "meeting-auth-1",
      mode: "create",
      owner,
      suggestedTitle: "인증 테스트 회의",
    },
    method: "POST",
  });
  assert.equal(issuedLaunch.statusCode, 200);

  const exchangedLaunch = await invokeHandler(launchHandlers.exchangeInovaMeetingLaunch, {
    body: {
      launchToken: issuedLaunch.jsonBody.data.launchToken,
    },
    method: "POST",
  });
  assert.equal(exchangedLaunch.statusCode, 200);

  const meetingSessionToken = exchangedLaunch.jsonBody.data.meetingSessionToken;
  const workspaceAuth = await invokeHandler(launchHandlers.issueInovaMeetingWorkspaceAuth, {
    body: {},
    headers: {
      authorization: `MeetingSession ${meetingSessionToken}`,
    },
    method: "POST",
  });
  assert.equal(workspaceAuth.statusCode, 200);
  assert.equal(workspaceAuth.jsonBody.data.meetingId, "meeting-auth-1");
  assert.equal(workspaceAuth.jsonBody.data.meetingDocumentId, "fixture-user__meeting-auth-1");

  const panelAuth = await invokeHandler(launchHandlers.issueInovaMeetingPanelAuth, {
    body: { owner },
    headers: { authorization: "Bearer fixture-token" },
    method: "POST",
  });
  assert.equal(panelAuth.statusCode, 200);
  assert.equal(panelAuth.jsonBody.data.providerUserKey, owner.providerUserKey);

  const expiredWorkspaceSessionId = String(meetingSessionToken).split(".")[0];
  getCollection(state, WORKSPACE_SESSION_COLLECTION).set(expiredWorkspaceSessionId, {
    ...getCollection(state, WORKSPACE_SESSION_COLLECTION).get(expiredWorkspaceSessionId),
    expiresAt: "2026-03-01T00:00:00.000Z",
  });
  const expiredWorkspaceAuth = await invokeHandler(launchHandlers.issueInovaMeetingWorkspaceAuth, {
    body: {},
    headers: {
      authorization: `MeetingSession ${meetingSessionToken}`,
    },
    method: "POST",
  });
  assert.equal(expiredWorkspaceAuth.statusCode, 410);

  const audioPayload = Buffer.from("fixture-audio-payload").toString("base64");
  const created = await invokeHandler(handlers.createInovaMeetingJob, {
    body: {
      meeting: {
        endedAt: "2026-03-30T08:31:00.000Z",
        language: "ko",
        meetingId: "meeting-planning-1",
        sessionId: "fixture-session",
        startedAt: "2026-03-30T08:20:00.000Z",
        title: "주간 스탠드업",
      },
      options: { redaction: "none", summary: true },
      owner,
      source: {
        captureMode: "tab-audio",
        channelCount: 1,
        durationMs: 65000,
        fileName: "fixture-session.webm",
        inlineAudioBase64: audioPayload,
        mimeType: "audio/webm;codecs=opus",
        requestId: "capture-fixture-1",
        sizeBytes: Buffer.from(audioPayload, "base64").length,
      },
      context: {
        sharedMemoSnapshot: "이번 회의는 일정과 담당자 확정이 우선입니다.",
      },
    },
    method: "POST",
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.jsonBody.data.job.status, "queued");
  const jobId = created.jsonBody.data.job.jobId;

  const duplicate = await invokeHandler(handlers.createInovaMeetingJob, {
    body: {
      meeting: {
        endedAt: "2026-03-30T08:31:00.000Z",
        language: "ko",
        meetingId: "meeting-planning-1",
        sessionId: "fixture-session",
        startedAt: "2026-03-30T08:20:00.000Z",
        title: "주간 스탠드업",
      },
      options: { redaction: "none", summary: true },
      owner,
      source: {
        captureMode: "tab-audio",
        channelCount: 1,
        durationMs: 65000,
        fileName: "fixture-session.webm",
        inlineAudioBase64: audioPayload,
        mimeType: "audio/webm;codecs=opus",
        requestId: "capture-fixture-1",
        sizeBytes: Buffer.from(audioPayload, "base64").length,
      },
      context: {
        sharedMemoSnapshot: "이번 회의는 일정과 담당자 확정이 우선입니다.",
      },
    },
    method: "POST",
  });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.jsonBody.data.reused, true);
  assert.equal(duplicate.jsonBody.data.job.jobId, jobId);

  await invokeJobWriteTrigger(handlers, state, jobId);

  const storedJob = getDoc(state, JOB_COLLECTION, jobId);
  assert(storedJob);
  assert.equal(storedJob.status, "succeeded");
  assert.equal(storedJob.meetingId, "meeting-planning-1");
  assert.equal(storedJob.source.uploadStatus, "deleted");
  assert.equal(storedJob.cleanup.sourceAudioDeleted, true);
  assert.equal(storedJob.context.sharedMemoSnapshot, "이번 회의는 일정과 담당자 확정이 우선입니다.");
  assert.equal(storedJob.meeting.sharedMemo, "이번 회의는 일정과 담당자 확정이 우선입니다.");
  assert(storedJob.meetingNotes.overview.length > 0);
  assert(storedJob.meetingNotes.discussionFlow.length > 0);
  assert(storedJob.meetingNotes.meetingMeta.title.length > 0);
  assert.equal(storedJob.notesStatus, "succeeded");

  const artifactId = storedJob.transcript.artifactId;
  const storedArtifact = getDoc(state, ARTIFACT_COLLECTION, artifactId);
  assert(storedArtifact);
  assert(storedArtifact.text.length > 0);
  assert(storedArtifact.segments.length >= 1);
  assert(storedArtifact.notes.overview.length > 0);
  assert(storedArtifact.notes.discussionFlow.length > 0);

  const storedMeeting = getDoc(state, MEETING_COLLECTION, "fixture-user__meeting-planning-1");
  assert(storedMeeting);
  assert.equal(storedMeeting.latestJobId, jobId);
  assert.equal(storedMeeting.recentJobs[0].jobId, jobId);
  assert.equal(storedMeeting.recentJobs[0].meetingId, "meeting-planning-1");
  assert.equal(state.collections.has(removedSessionCollectionName), false);

  const listedMeetings = await invokeHandler(handlers.listInovaMeetings, {
    body: { owner },
    method: "POST",
  });
  assert.equal(listedMeetings.statusCode, 200);
  assert.equal(listedMeetings.jsonBody.data.items.length >= 1, true);
  assert.equal(listedMeetings.jsonBody.data.items[0].meetingId, "meeting-planning-1");

  const updatedMeeting = await invokeHandler(handlers.updateInovaMeeting, {
    body: {
      meetingId: "meeting-planning-1",
      owner,
      sharedMemo: "업데이트된 공용 메모",
      title: "주간 스탠드업 v2",
    },
    method: "POST",
  });
  assert.equal(updatedMeeting.statusCode, 200);
  assert.equal(updatedMeeting.jsonBody.data.meeting.sharedMemo, "업데이트된 공용 메모");
  assert.equal(updatedMeeting.jsonBody.data.meeting.title, "주간 스탠드업 v2");
  assert.equal(getDoc(state, MEETING_COLLECTION, "fixture-user__meeting-planning-1").sharedMemo, "업데이트된 공용 메모");

  const summaryRequestsBeforeRegenerate = state.openaiSummaryRequests.length;
  const regenerated = await invokeHandler(handlers.regenerateInovaMeetingNotes, {
    body: {
      contextItems: [{ contextId: "ctx-1", text: "후속 일정 확인이 필요합니다." }],
      jobId,
      meetingId: "meeting-planning-1",
      owner,
      sharedMemo: "후속 일정 확인이 필요한 회의입니다.",
    },
    method: "POST",
  });
  assert.equal(regenerated.statusCode, 200);
  assert.equal(regenerated.jsonBody.data.job.notesContextItems.length, 1);
  assert.equal(regenerated.jsonBody.data.job.notesContextItems[0].text, "후속 일정 확인이 필요합니다.");
  assert.equal(regenerated.jsonBody.data.job.context.sharedMemoSnapshot, "후속 일정 확인이 필요한 회의입니다.");
  assert.equal(regenerated.jsonBody.data.artifact.notesContextItems.length, 1);
  assert(state.openaiSummaryRequests.length > summaryRequestsBeforeRegenerate);

  const updatedResult = await invokeHandler(handlers.updateInovaMeetingResult, {
    body: {
      contextItems: [
        { contextId: "ctx-1", text: "후속 일정 확인이 필요합니다." },
        { contextId: "ctx-2", text: "디자인 시안 리뷰 일정도 포함합니다." },
      ],
      jobId,
      meetingId: "meeting-planning-1",
      owner,
      sharedMemo: "회의 후속 조치와 디자인 시안 리뷰 일정까지 포함합니다.",
      title: "3월 30일 회의록",
    },
    method: "POST",
  });
  assert.equal(updatedResult.statusCode, 200);
  assert.equal(updatedResult.jsonBody.data.job.title, "3월 30일 회의록");
  assert.equal(updatedResult.jsonBody.data.job.notesContextItems.length, 2);
  assert.equal(updatedResult.jsonBody.data.job.context.sharedMemoSnapshot, "회의 후속 조치와 디자인 시안 리뷰 일정까지 포함합니다.");

  const deletedResult = await invokeHandler(handlers.deleteInovaMeetingResult, {
    body: {
      jobId,
      meetingId: "meeting-planning-1",
      owner,
    },
    method: "POST",
  });
  assert.equal(deletedResult.statusCode, 200);
  assert.equal(deletedResult.jsonBody.data.cleanupQueued, true);
  await invokeDeletionWriteTrigger(handlers, state, deletedResult.jsonBody.data.queueTaskId);
  assert.equal(getDoc(state, JOB_COLLECTION, jobId), null);
  assert.equal(getDoc(state, ARTIFACT_COLLECTION, artifactId), null);

  const deletedMeeting = await invokeHandler(handlers.deleteInovaMeeting, {
    body: {
      meetingId: "meeting-planning-1",
      owner,
    },
    method: "POST",
  });
  assert.equal(deletedMeeting.statusCode, 200);
  assert.equal(deletedMeeting.jsonBody.data.cleanupQueued, true);
  await invokeDeletionWriteTrigger(handlers, state, deletedMeeting.jsonBody.data.queueTaskId);
  assert.equal(getDoc(state, MEETING_COLLECTION, "fixture-user__meeting-planning-1"), null);

  const bucketlessState = createMemoryState();
  const bucketlessDeps = createDeps(bucketlessState, { bucket: null });
  const bucketlessLaunchHandlers = registerMeetingLaunchHandlers(bucketlessDeps);
  const bucketlessHandlers = registerMeetingHandlers({
    ...bucketlessDeps,
    authorizeMeetingRequest: bucketlessLaunchHandlers.authorizeMeetingRequest,
  });
  const bucketlessProdCreate = await invokeHandler(bucketlessHandlers.createInovaMeetingJob, {
    body: {
      meeting: {
        endedAt: "2026-03-30T09:05:00.000Z",
        language: "ko",
        meetingId: "meeting-inline-1",
        startedAt: "2026-03-30T09:00:00.000Z",
        title: "인라인 업로드 회의",
      },
      options: { redaction: "none", summary: true },
      owner,
      source: {
        captureMode: "microphone",
        channelCount: 1,
        durationMs: 12000,
        fileName: "inline-only.webm",
        inlineAudioBase64: audioPayload,
        mimeType: "audio/webm;codecs=opus",
        requestId: "capture-inline-1",
        sizeBytes: Buffer.from(audioPayload, "base64").length,
      },
    },
    method: "POST",
  });
  assert.equal(bucketlessProdCreate.statusCode, 500);
  assert.equal(bucketlessProdCreate.jsonBody.error, "회의 임시 오디오를 저장할 bucket이 설정되지 않았어요.");

  const previousInlineOnlyEnv = process.env.OPENAI_MEETING_ALLOW_INLINE_ONLY;
  let bucketlessLocalCreate;
  try {
    process.env.OPENAI_MEETING_ALLOW_INLINE_ONLY = "true";
    bucketlessLocalCreate = await invokeHandler(bucketlessHandlers.createInovaMeetingJob, {
      body: {
        meeting: {
          endedAt: "2026-03-30T09:05:00.000Z",
          language: "ko",
          meetingId: "meeting-inline-local-1",
          startedAt: "2026-03-30T09:00:00.000Z",
          title: "로컬 인라인 업로드 회의",
        },
        options: { redaction: "none", summary: true },
        owner,
        source: {
          captureMode: "microphone",
          channelCount: 1,
          durationMs: 12000,
          fileName: "inline-only-local.webm",
          inlineAudioBase64: audioPayload,
          mimeType: "audio/webm;codecs=opus",
          requestId: "capture-inline-local-1",
          sizeBytes: Buffer.from(audioPayload, "base64").length,
        },
      },
      method: "POST",
    });
  } finally {
    if (previousInlineOnlyEnv == null) {
      delete process.env.OPENAI_MEETING_ALLOW_INLINE_ONLY;
    } else {
      process.env.OPENAI_MEETING_ALLOW_INLINE_ONLY = previousInlineOnlyEnv;
    }
  }
  assert.equal(bucketlessLocalCreate.statusCode, 200);
  await invokeJobWriteTrigger(bucketlessHandlers, bucketlessState, bucketlessLocalCreate.jsonBody.data.job.jobId);
  const bucketlessLocalJob = getDoc(bucketlessState, JOB_COLLECTION, bucketlessLocalCreate.jsonBody.data.job.jobId);
  assert(bucketlessLocalJob);
  assert.equal(bucketlessLocalJob.source.uploadStatus, "inline-only");
  assert.equal(bucketlessLocalJob.cleanup.sourceAudioDeleted, false);

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

  const chunkedPartA = await invokeHandler(handlers.uploadInovaMeetingSource, {
    headers: { "content-type": "audio/wav" },
    method: "POST",
    query: {
      captureMode: "microphone",
      channelCount: "1",
      durationMs: "120000",
      endMs: "61000",
      fileName: "chunked-part-a.wav",
      meetingId: "meeting-chunked-1",
      overlapMs: "1500",
      parentRequestId: "capture-chunked-1",
      partCount: "2",
      partIndex: "0",
      requestId: "capture-chunked-1-part-0000",
      sizeBytes: "24",
      startMs: "0",
    },
    rawBody: Buffer.from("chunk-part-a"),
  });
  const chunkedPartB = await invokeHandler(handlers.uploadInovaMeetingSource, {
    headers: { "content-type": "audio/wav" },
    method: "POST",
    query: {
      captureMode: "microphone",
      channelCount: "1",
      durationMs: "120000",
      endMs: "120000",
      fileName: "chunked-part-b.wav",
      meetingId: "meeting-chunked-1",
      overlapMs: "1500",
      parentRequestId: "capture-chunked-1",
      partCount: "2",
      partIndex: "1",
      requestId: "capture-chunked-1-part-0001",
      sizeBytes: "24",
      startMs: "58500",
    },
    rawBody: Buffer.from("chunk-part-b"),
  });
  assert.equal(chunkedPartA.statusCode, 200);
  assert.equal(chunkedPartB.statusCode, 200);

  const chunkedCreated = await invokeHandler(handlers.createInovaMeetingJob, {
    body: {
      meeting: {
        endedAt: "2026-03-30T10:31:00.000Z",
        language: "ko",
        meetingId: "meeting-chunked-1",
        startedAt: "2026-03-30T10:20:00.000Z",
        title: "대용량 파일 회의",
      },
      options: { redaction: "none", summary: true },
      owner,
      source: {
        captureMode: "microphone",
        channelCount: 1,
        durationMs: 120000,
        fileName: "chunked-source.wav",
        mimeType: "audio/wav",
        mode: "chunked",
        originalSizeBytes: 30 * 1024 * 1024,
        parts: [
          { ...chunkedPartA.jsonBody.data, mimeType: "audio/wav" },
          { ...chunkedPartB.jsonBody.data, mimeType: "audio/wav" },
        ],
        requestId: "capture-chunked-1",
        sizeBytes: 30 * 1024 * 1024,
      },
      context: {
        sharedMemoSnapshot: "큰 파일도 단일 결과로 정리해야 합니다.",
      },
    },
    method: "POST",
  });
  assert.equal(chunkedCreated.statusCode, 200);
  assert.equal(chunkedCreated.jsonBody.data.job.source.mode, "chunked");
  assert.equal(chunkedCreated.jsonBody.data.job.source.parts.length, 2);

  await invokeJobWriteTrigger(handlers, state, chunkedCreated.jsonBody.data.job.jobId);
  await drainChunkedMeetingPipeline(handlers, state, chunkedCreated.jsonBody.data.job.jobId);

  const chunkedJob = getDoc(state, JOB_COLLECTION, chunkedCreated.jsonBody.data.job.jobId);
  assert(chunkedJob);
  assert.equal(chunkedJob.status, "succeeded");
  assert.equal(chunkedJob.source.mode, "chunked");
  assert.equal(chunkedJob.source.parts.length, 2);
  assert(chunkedJob.transcript.segments.length >= 1);
  assert.equal(
    Array.from(getCollection(state, JOB_PART_COLLECTION).values()).filter((part) => part.jobId === chunkedJob.jobId).length,
    0
  );
  assert.equal(getCollection(state, JOB_FINALIZER_COLLECTION).has(chunkedJob.jobId), false);

  console.log("[verify-meeting-service] hosted-only meeting service flow passed");
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

main().catch((error) => {
  console.error(`[verify-meeting-service] ${error.stack || error.message}`);
  process.exit(1);
});
