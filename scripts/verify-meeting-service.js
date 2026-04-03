#!/usr/bin/env node
const assert = require("assert");
const { registerMeetingLaunchHandlers } = require("../functions/features/meeting/meeting-launch-service");
const { registerMeetingHandlers } = require("../functions/features/meeting/meeting-service");
const {
  DELETION_COLLECTION,
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
  invokePartWriteTrigger,
} = require("../test-support/verify-meeting-service-support");
async function main() {
  const state = createMemoryState();
  const owner = {
    displayName: "Fixture User",
    email: "fixture@example.com",
    numericUserId: 1001,
    provider: "inova",
    providerUserKey: "fixture-user",
  };
  const deps = createDeps(state);
  const launchHandlers = registerMeetingLaunchHandlers(deps);
  const handlers = registerMeetingHandlers({
    ...deps,
    authorizeMeetingRequest: launchHandlers.authorizeMeetingRequest,
  });
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
  assert.equal(workspaceAuth.jsonBody.data.meetingDocumentId, "fixture-user__meeting-auth-1");
  assert.equal(workspaceAuth.jsonBody.data.meetingId, "meeting-auth-1");
  assert.equal(workspaceAuth.jsonBody.data.workspaceSessionId.length > 0, true);
  assert.equal(workspaceAuth.jsonBody.data.firebaseCustomToken, "custom-token:inova-workspace__fixture-user");
  assert.equal(state.customTokens.length, 1);
  assert.equal(state.customTokens[0].claims.scope, "meeting-workspace");
  assert.equal(state.customTokens[0].claims.providerUserKey, owner.providerUserKey);
  assert.equal(state.customTokens[0].claims.meetingId, "meeting-auth-1");
  assert.equal(typeof state.customTokens[0].claims.workspaceExpMs, "number");
  const panelAuth = await invokeHandler(launchHandlers.issueInovaMeetingPanelAuth, {
    body: {
      owner,
    },
    headers: {
      authorization: "Bearer fixture-token",
    },
    method: "POST",
  });
  assert.equal(panelAuth.statusCode, 200);
  assert.equal(panelAuth.jsonBody.data.providerUserKey, owner.providerUserKey);
  assert.equal(panelAuth.jsonBody.data.firebaseCustomToken, "custom-token:inova-panel__fixture-user");
  assert.equal(state.customTokens.length, 2);
  assert.equal(state.customTokens[1].claims.scope, "meeting-panel");
  assert.equal(state.customTokens[1].claims.providerUserKey, owner.providerUserKey);
  assert.equal(typeof state.customTokens[1].claims.panelExpMs, "number");
  const missingWorkspaceAuth = await invokeHandler(launchHandlers.issueInovaMeetingWorkspaceAuth, {
    body: {},
    headers: {},
    method: "POST",
  });
  assert.equal(missingWorkspaceAuth.statusCode, 401);
  const expiredWorkspaceSessionId = String(meetingSessionToken).split(".")[0];
  state.collections.get(WORKSPACE_SESSION_COLLECTION).set(expiredWorkspaceSessionId, {
    ...state.collections.get(WORKSPACE_SESSION_COLLECTION).get(expiredWorkspaceSessionId),
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
  assert.equal(created.jsonBody.data.job.source.uploadStatus, "uploaded");
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
  const storedJob = await invokeHandler(handlers.getInovaMeetingJob, {
    body: { jobId, owner },
    method: "POST",
  });
  assert.equal(storedJob.statusCode, 200);
  assert.equal(storedJob.jsonBody.data.job.status, "succeeded");
  assert.equal(storedJob.jsonBody.data.job.cleanup.sourceAudioDeleted, true);
  assert.equal(storedJob.jsonBody.data.job.context.sharedMemoSnapshot, "이번 회의는 일정과 담당자 확정이 우선입니다.");
  assert.equal(storedJob.jsonBody.data.job.meeting.sharedMemo, "이번 회의는 일정과 담당자 확정이 우선입니다.");
  assert.equal(storedJob.jsonBody.data.job.notesModeDetected, "planning");
  assert.equal(storedJob.jsonBody.data.job.notesModeSelected, "planning");
  assert.equal(storedJob.jsonBody.data.job.meetingNotes.mode, "planning");
  assert.equal(storedJob.jsonBody.data.job.meetingNotes.meetingMeta.title, "프로모션 일정·예산 실행 계획");
  assert.equal(storedJob.jsonBody.data.job.title, "프로모션 일정·예산 실행 계획");
  assert(storedJob.jsonBody.data.job.meetingNotes.executiveSummary.length > 0);
  assert(storedJob.jsonBody.data.job.meetingNotes.modeSpecific.milestones.length > 0);
  assert.equal(storedJob.jsonBody.data.job.meetingNotes.speakerSummaries, undefined);
  const artifactId = storedJob.jsonBody.data.job.transcript.artifactId;
  const artifact = await invokeHandler(handlers.getInovaMeetingArtifact, {
    body: { artifactId, jobId, owner },
    method: "POST",
  });
  assert.equal(artifact.statusCode, 200);
  assert.equal(artifact.jsonBody.data.artifact.notesModeSelected, "planning");
  assert.equal(artifact.jsonBody.data.artifact.notes.mode, "planning");
  assert(artifact.jsonBody.data.artifact.segments.length >= 1);
  assert(artifact.jsonBody.data.artifact.segments.every((segment) => String(segment?.text || "").trim()));
  assert(artifact.jsonBody.data.artifact.segments.every((segment) => segment.speakerLabel === undefined));
  assert.equal(state.openaiRequests.length, 1);
  assert.equal(state.openaiSummaryRequests.length, 2);
  assert.equal(state.openaiSummaryRequests[0].kind, "classifier");
  assert.equal(state.openaiSummaryRequests[1].kind, "notes");
  assert.equal(state.openaiSummaryRequests[0].model, "gpt-5.4-mini");
  assert.equal(state.openaiSummaryRequests[1].model, "gpt-5.4-mini");
  assert(state.openaiSummaryRequests[1].systemPrompt.includes("meetingMeta.title은 이 기록을 구분할 짧고 구체적인 한국어 제목 한 줄로 작성한다."));
  const listed = await invokeHandler(handlers.listInovaMeetingResults, {
    body: { meetingId: "meeting-planning-1", owner },
    method: "POST",
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.jsonBody.data.meeting.sharedMemo, "이번 회의는 일정과 담당자 확정이 우선입니다.");
  assert.equal(listed.jsonBody.data.items[0].title, "프로모션 일정·예산 실행 계획");
  assert.equal(listed.jsonBody.data.items[0].requestId, "capture-fixture-1");
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
  const blankMeeting = await invokeHandler(handlers.updateInovaMeeting, {
    body: {
      meetingId: "meeting-empty-1",
      owner,
      title: "외부 미팅",
    },
    method: "POST",
  });
  assert.equal(blankMeeting.statusCode, 200);
  const blankMeetingListed = await invokeHandler(handlers.listInovaMeetingResults, {
    body: { meetingId: "meeting-empty-1", owner },
    method: "POST",
  });
  assert.equal(blankMeetingListed.statusCode, 200);
  assert.equal(blankMeetingListed.jsonBody.data.meeting.title, "외부 미팅");
  assert.equal(blankMeetingListed.jsonBody.data.meeting.owner.providerUserKey, owner.providerUserKey);
  const meetingCollection = state.collections.get(MEETING_COLLECTION) || new Map();
  state.collections.set(MEETING_COLLECTION, meetingCollection);
  meetingCollection.set("fixture-user__meeting-orphaned-1", {
    createdAt: "2026-03-30T11:00:00.000Z",
    meetingId: "meeting-orphaned-1",
    recentJobs: [],
    title: "owner 누락 회의",
    updatedAt: "2026-03-30T11:00:00.000Z",
  });
  const orphanMeetingListed = await invokeHandler(handlers.listInovaMeetingResults, {
    body: { meetingId: "meeting-orphaned-1", owner },
    method: "POST",
  });
  assert.equal(orphanMeetingListed.statusCode, 200);
  assert.equal(orphanMeetingListed.jsonBody.data.meeting.owner.providerUserKey, owner.providerUserKey);
  assert.equal(
    state.collections.get(MEETING_COLLECTION).get("fixture-user__meeting-orphaned-1").owner.providerUserKey,
    owner.providerUserKey
  );
  const regenerated = await invokeHandler(handlers.regenerateInovaMeetingNotes, {
    body: {
      jobId,
      meetingId: "meeting-planning-1",
      notesMode: "interview",
      owner,
      sharedMemo: "후보자 평가 관점도 같이 정리합니다.",
    },
    method: "POST",
  });
  assert.equal(regenerated.statusCode, 200);
  assert.equal(regenerated.jsonBody.data.job.notesModeSelected, "interview");
  assert.equal(regenerated.jsonBody.data.artifact.notesModeSelected, "interview");
  assert.equal(regenerated.jsonBody.data.job.meetingNotes.mode, "interview");
  assert.equal(regenerated.jsonBody.data.job.title, "후보자 응답 및 후속 인터뷰 정리");
  assert(regenerated.jsonBody.data.job.meetingNotes.modeSpecific.followUpQuestions.length > 0);
  assert.equal(regenerated.jsonBody.data.job.meetingNotes.speakerSummaries, undefined);
  assert.equal(state.openaiRequests.length, 1, "Notes regeneration should not retrigger transcription");
  assert.equal(state.openaiSummaryRequests.length, 4, "Regeneration should run classifier + notes only");
  const updatedResult = await invokeHandler(handlers.updateInovaMeetingResult, {
    body: {
      jobId,
      meetingId: "meeting-planning-1",
      owner,
      title: "3월 30일 회의록",
    },
    method: "POST",
  });
  assert.equal(updatedResult.statusCode, 200);
  assert.equal(updatedResult.jsonBody.data.job.title, "3월 30일 회의록");
  assert.equal(updatedResult.jsonBody.data.job.speakerAliases, undefined);
  const planningRegenerated = await invokeHandler(handlers.regenerateInovaMeetingNotes, {
    body: {
      jobId,
      meetingId: "meeting-planning-1",
      notesMode: "planning",
      owner,
      sharedMemo: "실행 계획을 다시 정리합니다.",
    },
    method: "POST",
  });
  assert.equal(planningRegenerated.statusCode, 200);
  assert.equal(planningRegenerated.jsonBody.data.job.speakerAliases, undefined);
  assert.equal(planningRegenerated.jsonBody.data.artifact.speakerAliases, undefined);
  assert.equal(planningRegenerated.jsonBody.data.job.title, "프로모션 일정·예산 실행 계획");
  assert.equal(state.openaiSummaryRequests.length, 6, "Planning regeneration should run classifier + notes once more");
  const generalRegenerated = await invokeHandler(handlers.regenerateInovaMeetingNotes, {
    body: {
      jobId,
      meetingId: "meeting-planning-1",
      notesMode: "general",
      owner,
      sharedMemo: "일반 회의 형식으로 다시 정리합니다.",
    },
    method: "POST",
  });
  assert.equal(generalRegenerated.statusCode, 200);
  assert.equal(generalRegenerated.jsonBody.data.job.notesModeSelected, "general");
  assert.equal(generalRegenerated.jsonBody.data.job.meetingNotes.mode, "general");
  assert.equal(generalRegenerated.jsonBody.data.job.meetingNotes.openQuestions[0], "운영 구조와 명분이 아직 정리되지 않았습니다. · 상태: open");
  assert.equal(generalRegenerated.jsonBody.data.artifact.notes.openQuestions[1], "외부 협업 일정을 언제까지 확정할지 추가 논의가 필요합니다.");
  assert.equal(state.openaiSummaryRequests.length, 8, "General regeneration should run classifier + notes once more");
  assert(state.openaiSummaryRequests[7].prompt.includes("왜 이 회의가 열렸고"));
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
  assert.equal(deletedResult.jsonBody.data.deletedJobId, jobId);
  await invokeDeletionWriteTrigger(handlers, state, deletedResult.jsonBody.data.queueTaskId);
  const deletedWorkspace = await invokeHandler(handlers.deleteInovaMeeting, {
    body: {
      meetingId: "meeting-planning-1",
      owner,
    },
    method: "POST",
  });
  assert.equal(deletedWorkspace.statusCode, 200);
  assert.equal(deletedWorkspace.jsonBody.data.cleanupQueued, true);
  assert.equal(deletedWorkspace.jsonBody.data.meetingId, "meeting-planning-1");
  assert.equal(deletedWorkspace.jsonBody.data.jobCount, 0);
  await invokeDeletionWriteTrigger(handlers, state, deletedWorkspace.jsonBody.data.queueTaskId);
  const deletedJobLookup = await invokeHandler(handlers.getInovaMeetingJob, {
    body: { jobId, owner },
    method: "POST",
  });
  assert.equal(deletedJobLookup.statusCode, 404);
  const bucketlessState = createMemoryState();
  const bucketlessDeps = createDeps(bucketlessState, { bucket: null });
  const bucketlessLaunchHandlers = registerMeetingLaunchHandlers(bucketlessDeps);
  const bucketlessHandlers = registerMeetingHandlers({
    ...bucketlessDeps,
    authorizeMeetingRequest: bucketlessLaunchHandlers.authorizeMeetingRequest,
  });
  const bucketless = await invokeHandler(bucketlessHandlers.createInovaMeetingJob, {
    body: {
      meeting: {
        endedAt: "2026-03-30T09:05:00.000Z",
        language: "ko",
        meetingId: "meeting-microphone-1",
        startedAt: "2026-03-30T09:00:00.000Z",
        title: "마이크 테스트 회의",
      },
      options: { redaction: "none", summary: false },
      owner,
      source: {
        captureMode: "microphone",
        channelCount: 1,
        durationMs: 12000,
        fileName: "microphone-test.webm",
        inlineAudioBase64: audioPayload,
        mimeType: "audio/webm;codecs=opus",
        sizeBytes: Buffer.from(audioPayload, "base64").length,
      },
    },
    method: "POST",
  });
  assert.equal(bucketless.statusCode, 200);
  await invokeJobWriteTrigger(bucketlessHandlers, bucketlessState, bucketless.jsonBody.data.job.jobId);
  const bucketlessStoredJob = await invokeHandler(bucketlessHandlers.getInovaMeetingJob, {
    body: { jobId: bucketless.jsonBody.data.job.jobId, owner },
    method: "POST",
  });
  assert.equal(bucketlessStoredJob.jsonBody.data.job.source.uploadStatus, "inline-only");
  assert.equal(bucketlessStoredJob.jsonBody.data.job.cleanup.sourceAudioDeleted, false);
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
  const chunkedStoredJob = await invokeHandler(handlers.getInovaMeetingJob, {
    body: { jobId: chunkedCreated.jsonBody.data.job.jobId, owner },
    method: "POST",
  });
  assert.equal(chunkedStoredJob.statusCode, 200);
  assert.equal(chunkedStoredJob.jsonBody.data.job.status, "succeeded");
  assert.equal(chunkedStoredJob.jsonBody.data.job.source.mode, "chunked");
  assert.equal(chunkedStoredJob.jsonBody.data.job.source.parts.length, 2);
  assert(chunkedStoredJob.jsonBody.data.job.transcript.segments.length >= 1);
  assert(chunkedStoredJob.jsonBody.data.job.transcript.segments.every((segment) => String(segment?.text || "").trim()));
  assert(chunkedStoredJob.jsonBody.data.job.transcript.segments.every((segment) => segment.speakerLabel === undefined));
  assert.equal(state.openaiRequests.length, 3);
  console.log("[verify-meeting-service] Meeting service flow passed");
}

main().catch((error) => {
  console.error(`[verify-meeting-service] ${error.stack || error.message}`);
  process.exit(1);
});
