#!/usr/bin/env node

const assert = require("assert");
const { registerMeetingLaunchHandlers } = require("../functions/features/meeting/meeting-launch-service");
const { registerMeetingWorkspaceAuthHandlers } = require("../functions/features/meeting/meeting-workspace-auth-service");
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
const { verifyMeetingCleanupFailureGuards } = require("../test-support/verify-meeting-cleanup-support");
const { verifyMoveMeetingResultFlow } = require("../test-support/verify-meeting-record-move-support");
const { verifyMeetingResultUpdateAndNotesRetryFlow } = require("../test-support/verify-meeting-notes-retry-support");
const {
  assertUsageCommitted,
  assertUsageEvent,
  readUsageAggregateSnapshot,
  verifyUsageAccountingDomainIdempotency,
} = require("../test-support/verify-meeting-usage-support");

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

  await verifyDebugAuthBypassGate();

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
  const initialUsageEvent = assertUsageCommitted(state, {
    expectedDurationMs: 65000,
    jobId,
    meetingId: "meeting-planning-1",
    providerUserKey: owner.providerUserKey,
  });

  const storedMeeting = getDoc(state, MEETING_COLLECTION, "fixture-user__meeting-planning-1");
  assert(storedMeeting);
  assert.equal(storedMeeting.latestJobId, jobId);
  assert.equal(storedMeeting.recentJobs[0].jobId, jobId);
  assert.equal(storedMeeting.recentJobs[0].meetingId, "meeting-planning-1");
  assert.equal(state.collections.has(removedSessionCollectionName), false);
  assert.equal(
    state.openaiSummaryRequests.some((request) => request.kind === "notes" && request.model === "gpt-5.5"),
    true
  );
  assert.equal(
    state.openaiSummaryRequests
      .filter((request) => request.model === "gpt-5.5")
      .every((request) => request.temperature === undefined),
    true,
    "GPT-5.5 meeting notes requests must omit temperature because the model only supports the default value"
  );

  const compactCreated = await invokeHandler(handlers.createInovaMeetingJob, {
    body: {
      meeting: {
        endedAt: "2026-03-30T09:01:00.000Z",
        language: "ko",
        meetingId: "meeting-compact-1",
        sessionId: "fixture-session-compact",
        startedAt: "2026-03-30T09:00:00.000Z",
        title: "장비 테스트",
      },
      options: { redaction: "none", summary: true },
      owner,
      source: {
        captureMode: "microphone",
        channelCount: 1,
        durationMs: 22000,
        fileName: "microphone-test.webm",
        inlineAudioBase64: audioPayload,
        mimeType: "audio/webm;codecs=opus",
        requestId: "capture-fixture-compact-1",
        sizeBytes: Buffer.from(audioPayload, "base64").length,
      },
      context: {
        sharedMemoSnapshot: "",
      },
    },
    method: "POST",
  });
  assert.equal(compactCreated.statusCode, 200);
  const compactJobId = compactCreated.jsonBody.data.job.jobId;
  await invokeJobWriteTrigger(handlers, state, compactJobId);
  const compactStoredJob = getDoc(state, JOB_COLLECTION, compactJobId);
  assert(compactStoredJob);
  const compactArtifactId = compactStoredJob.transcript.artifactId;
  assert.equal(compactStoredJob.notesStatus, "succeeded");
  assert.equal(compactStoredJob.meetingNotes.meetingMeta.title, "녹음 테스트 및 마이크 위치 확인");
  assert.equal(compactStoredJob.meetingNotes.meetingMeta.purpose, "");
  assert.equal(compactStoredJob.meetingNotes.summary, "녹음 테스트와 마이크 위치 확인이 언급됐다.");
  assert.equal(compactStoredJob.meetingNotes.discussionFlow.length, 0);
  assert.equal(compactStoredJob.meetingNotes.decisions.length, 0);
  assert.equal(compactStoredJob.meetingNotes.actionItems.length, 0);
  assert.equal(compactStoredJob.meetingNotes.risksOrDependencies.length, 0);
  assert.equal(compactStoredJob.meetingNotes.openQuestions.length, 1);
  assert.equal(compactStoredJob.meetingNotes.openQuestions[0], "마이크 위치 확인 필요");
  assert.equal(
    compactStoredJob.meetingNotes.overview,
    "녹음 테스트와 수정 반영 여부 확인이 언급됐다. 마이크 위치를 몰라 테스트 진행이 어렵다는 말이 나왔다."
  );
  assert.equal(
    state.events.some((event) =>
      event.name === "meeting.notes.gate"
      && event.payload?.meetingId === "meeting-compact-1"
      && event.payload?.summaryProfile === "compact"
    ),
    true
  );

  const listedMeetings = await invokeHandler(handlers.listInovaMeetings, {
    body: { owner },
    method: "POST",
  });
  assert.equal(listedMeetings.statusCode, 200);
  assert.equal(listedMeetings.jsonBody.data.items.length >= 1, true);
  assert.equal(
    listedMeetings.jsonBody.data.items.some((item) => item.meetingId === "meeting-planning-1"),
    true
  );

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
  const originalNotesTitle = storedJob.meetingNotes.meetingMeta.title;
  const originalDecisionText = storedJob.meetingNotes.decisions[0]?.text || "";

  const updatedTermReplacements = await invokeHandler(handlers.updateInovaMeeting, {
    body: {
      meetingId: "meeting-planning-1",
      owner,
      termReplacements: [
        { from: originalNotesTitle, to: "치환된 회의 제목" },
        { from: originalDecisionText, to: "치환된 결정" },
      ],
    },
    method: "POST",
  });
  assert.equal(updatedTermReplacements.statusCode, 200);
  assert.equal(updatedTermReplacements.jsonBody.data.accepted, true);
  assert.equal(updatedTermReplacements.jsonBody.data.meeting.termReplacements.length, 2);
  const patchedMeeting = getDoc(state, MEETING_COLLECTION, "fixture-user__meeting-planning-1");
  assert.equal(patchedMeeting.termReplacements.length, 2);
  assert.equal(patchedMeeting.termReplacements[0].from, originalNotesTitle);
  const termReplacementJob = getDoc(state, JOB_COLLECTION, jobId);
  const termReplacementArtifact = getDoc(state, ARTIFACT_COLLECTION, artifactId);
  assert.equal(termReplacementJob.meetingNotes.meetingMeta.title, "치환된 회의 제목");
  assert.equal(termReplacementJob.meetingNotes.decisions[0].text, "치환된 결정");
  assert.equal(termReplacementArtifact.notes.meetingMeta.title, "치환된 회의 제목");
  assert.equal(termReplacementArtifact.notes.decisions[0].text, "치환된 결정");

  await verifyMeetingResultUpdateAndNotesRetryFlow({
    handlers,
    jobId,
    meetingId: "meeting-planning-1",
    owner,
    state,
  });

  const summaryRequestsBeforePreview = state.openaiSummaryRequests.length;
  const previewedSection = await invokeHandler(handlers.previewInovaMeetingResultSectionEdit, {
    body: {
      instruction: "회의 개요를 더 간결하게 다시 정리해 주세요.",
      jobId,
      meetingId: "meeting-planning-1",
      owner,
      sectionKey: "overview",
    },
    method: "POST",
  });
  assert.equal(previewedSection.statusCode, 200);
  assert.equal(previewedSection.jsonBody.data.sectionKey, "overview");
  assert(previewedSection.jsonBody.data.baseRevisionToken);
  assert(previewedSection.jsonBody.data.sectionData);
  assert(previewedSection.jsonBody.data.sectionData.overview.length > 0);
  const originalSummary = storedJob.meetingNotes.summary;
  assert.equal(
    state.openaiSummaryRequests
      .slice(summaryRequestsBeforePreview)
      .some((request) => request.kind === "notes" && request.model === "gpt-5.5"),
    true
  );
  const shortPreviewRequestsBefore = state.openaiSummaryRequests.length;
  const shortPreviewedSection = await invokeHandler(handlers.previewInovaMeetingResultSectionEdit, {
    body: {
      instruction: "20글자 이내로 요약해줘",
      jobId,
      meetingId: "meeting-planning-1",
      owner,
      sectionKey: "overview",
    },
    method: "POST",
  });
  assert.equal(shortPreviewedSection.statusCode, 200);
  const compactShortPreviewLength = [
    shortPreviewedSection.jsonBody.data.sectionData.meetingMeta?.purpose || "",
    shortPreviewedSection.jsonBody.data.sectionData.overview || "",
  ].join("").replace(/\s+/g, "").length;
  assert.equal(compactShortPreviewLength <= 20, true);
  const shortPreviewRequests = state.openaiSummaryRequests.slice(shortPreviewRequestsBefore);
  assert.equal(shortPreviewRequests.length, 1);
  assert.equal(shortPreviewRequests[0].systemPrompt.includes("사용자 요청은 절대 우선순위다."), true);
  assert.equal(shortPreviewRequests[0].systemPrompt.includes("전사에 없는 설명, 부연, 예시도 사용자 요청이면 반영할 수 있다."), true);
  assert.equal(shortPreviewRequests[0].systemPrompt.includes("전사에 없는 사실, 결정, 액션, 담당자, 일정은 만들지 않는다."), false);
  assert.equal(shortPreviewRequests[0].prompt.includes("현재 전체 회의록 요약 JSON"), false);
  assert.equal(String(shortPreviewedSection.jsonBody.data.warning || "").trim(), "");

  const caravanPreview = await invokeHandler(handlers.previewInovaMeetingResultSectionEdit, {
    body: {
      instruction: "카라반에 대해 설명해줘",
      jobId,
      meetingId: "meeting-planning-1",
      owner,
      sectionKey: "summary",
    },
    method: "POST",
  });
  assert.equal(caravanPreview.statusCode, 200);
  assert.equal(caravanPreview.jsonBody.data.sectionKey, "summary");
  assert.equal(caravanPreview.jsonBody.data.sectionData.summary.includes("카라반"), true);

  const acrosticPreview = await invokeHandler(handlers.previewInovaMeetingResultSectionEdit, {
    body: {
      instruction: "박영택 3행시",
      jobId,
      meetingId: "meeting-planning-1",
      owner,
      sectionKey: "summary",
    },
    method: "POST",
  });
  assert.equal(acrosticPreview.statusCode, 200);
  assert.equal(acrosticPreview.jsonBody.data.sectionKey, "summary");
  assert.equal(acrosticPreview.jsonBody.data.sectionData.summary.includes("박:"), true);

  const staleAppliedSection = await invokeHandler(handlers.applyInovaMeetingResultSectionEdit, {
    body: {
      baseRevisionToken: `${previewedSection.jsonBody.data.baseRevisionToken}-stale`,
      jobId,
      meetingId: "meeting-planning-1",
      owner,
      sectionData: previewedSection.jsonBody.data.sectionData,
      sectionKey: "overview",
    },
    method: "POST",
  });
  assert.equal(staleAppliedSection.statusCode, 409);

  const appliedSection = await invokeHandler(handlers.applyInovaMeetingResultSectionEdit, {
    body: {
      baseRevisionToken: previewedSection.jsonBody.data.baseRevisionToken,
      clientRequestId: "section-apply-fixture-1",
      jobId,
      meetingId: "meeting-planning-1",
      owner,
      sectionData: previewedSection.jsonBody.data.sectionData,
      sectionKey: "overview",
    },
    method: "POST",
  });
  assert.equal(appliedSection.statusCode, 200);
  assert.equal(appliedSection.jsonBody.data.accepted, true);
  assert.equal(appliedSection.jsonBody.data.sectionKey, "overview");
  const sectionEditedJob = getDoc(state, JOB_COLLECTION, jobId);
  const sectionEditedArtifact = getDoc(state, ARTIFACT_COLLECTION, artifactId);
  assert.equal(sectionEditedJob.meetingNotes.summary, originalSummary);
  assert.equal(sectionEditedArtifact.notes.summary, originalSummary);
  assert.equal(sectionEditedJob.meetingNotes.overview, previewedSection.jsonBody.data.sectionData.overview);
  assert.equal(sectionEditedArtifact.notes.overview, previewedSection.jsonBody.data.sectionData.overview);
  assert.equal(sectionEditedJob.meetingNotes.meetingMeta.title, previewedSection.jsonBody.data.sectionData.meetingMeta.title);

  const summaryPreview = await invokeHandler(handlers.previewInovaMeetingResultSectionEdit, {
    body: {
      instruction: "핵심 요약을 더 짧게 정리해줘",
      jobId,
      meetingId: "meeting-planning-1",
      owner,
      sectionKey: "summary",
    },
    method: "POST",
  });
  assert.equal(summaryPreview.statusCode, 200);
  assert.equal(summaryPreview.jsonBody.data.sectionKey, "summary");
  assert.equal(String(summaryPreview.jsonBody.data.sectionData.summary || "").trim().length > 0, true);

  const summaryAppliedSection = await invokeHandler(handlers.applyInovaMeetingResultSectionEdit, {
    body: {
      baseRevisionToken: summaryPreview.jsonBody.data.baseRevisionToken,
      clientRequestId: "section-apply-fixture-summary-1",
      jobId,
      meetingId: "meeting-planning-1",
      owner,
      sectionData: summaryPreview.jsonBody.data.sectionData,
      sectionKey: "summary",
    },
    method: "POST",
  });
  assert.equal(summaryAppliedSection.statusCode, 200);
  const summaryEditedJob = getDoc(state, JOB_COLLECTION, jobId);
  const summaryEditedArtifact = getDoc(state, ARTIFACT_COLLECTION, artifactId);
  assert.equal(summaryEditedJob.meetingNotes.summary, summaryPreview.jsonBody.data.sectionData.summary);
  assert.equal(summaryEditedArtifact.notes.summary, summaryPreview.jsonBody.data.sectionData.summary);
  assert.equal(summaryEditedJob.meetingNotes.overview, previewedSection.jsonBody.data.sectionData.overview);

  const missingBaseRevisionSection = await invokeHandler(handlers.applyInovaMeetingResultSectionEdit, {
    body: {
      clientRequestId: "section-apply-missing-token-1",
      jobId,
      meetingId: "meeting-planning-1",
      owner,
      sectionData: { summary: "미리보기 없는 AI 적용은 거부되어야 합니다." },
      sectionKey: "summary",
    },
    method: "POST",
  });
  assert.equal(missingBaseRevisionSection.statusCode, 400);

  const manuallyAppliedSection = await invokeHandler(handlers.applyInovaMeetingResultSectionEdit, {
    body: {
      clientRequestId: "section-manual-summary-1",
      editMode: "manual",
      jobId,
      meetingId: "meeting-planning-1",
      owner,
      sectionData: { summary: "직접 고친 핵심 요약" },
      sectionKey: "summary",
    },
    method: "POST",
  });
  assert.equal(manuallyAppliedSection.statusCode, 200);
  const manuallyEditedJob = getDoc(state, JOB_COLLECTION, jobId);
  const manuallyEditedArtifact = getDoc(state, ARTIFACT_COLLECTION, artifactId);
  assert.equal(manuallyEditedJob.meetingNotes.summary, "직접 고친 핵심 요약");
  assert.equal(manuallyEditedArtifact.notes.summary, "직접 고친 핵심 요약");
  assert.equal(manuallyEditedJob.meetingNotes.overview, previewedSection.jsonBody.data.sectionData.overview);

  const manualOverviewSectionData = {
    meetingMeta: { datetime: "", participants: [], purpose: "직접 고친 회의 목적" },
    overview: "참여자를 직접 비운 회의 개요",
  };
  const manualOverviewAppliedSection = await invokeHandler(handlers.applyInovaMeetingResultSectionEdit, {
    body: { clientRequestId: "section-manual-overview-participants-1", editMode: "manual", jobId, meetingId: "meeting-planning-1", owner, sectionData: manualOverviewSectionData, sectionKey: "overview" },
    method: "POST",
  });
  assert.equal(manualOverviewAppliedSection.statusCode, 200);
  const manualOverviewEditedJob = getDoc(state, JOB_COLLECTION, jobId);
  const manualOverviewEditedArtifact = getDoc(state, ARTIFACT_COLLECTION, artifactId);
  for (const notes of [manualOverviewEditedJob.meetingNotes, manualOverviewEditedArtifact.notes]) {
    assert.equal(notes.overview, manualOverviewSectionData.overview);
    assert.equal(notes.meetingMeta.datetime, "");
    assert.deepEqual(notes.meetingMeta.participants, []);
    assert.equal(notes.meetingMeta.purpose, manualOverviewSectionData.meetingMeta.purpose);
  }

  const deletedQuestionsSection = await invokeHandler(handlers.applyInovaMeetingResultSectionEdit, {
    body: {
      clientRequestId: "section-delete-open-questions-1",
      editMode: "manual",
      jobId,
      meetingId: "meeting-planning-1",
      owner,
      sectionData: { deleteSection: true, openQuestions: [] },
      sectionKey: "openQuestions",
    },
    method: "POST",
  });
  assert.equal(deletedQuestionsSection.statusCode, 200);
  const questionDeletedJob = getDoc(state, JOB_COLLECTION, jobId);
  const questionDeletedArtifact = getDoc(state, ARTIFACT_COLLECTION, artifactId);
  assert.equal(questionDeletedJob.meetingNotes.openQuestions.length, 0);
  assert.equal(questionDeletedArtifact.notes.openQuestions.length, 0);
  assert.equal(questionDeletedJob.meetingNotes.summary, "직접 고친 핵심 요약");

  await verifyMoveMeetingResultFlow({
    audioPayload,
    compactArtifactId,
    compactJobId,
    handlers,
    invokeJobWriteTrigger,
    owner,
    state,
  });

  const usageBeforeDeletion = readUsageAggregateSnapshot(state, {
    dayKey: initialUsageEvent.dayKey,
    monthKey: initialUsageEvent.monthKey,
    providerUserKey: owner.providerUserKey,
  });

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
  assert.deepEqual(
    readUsageAggregateSnapshot(state, {
      dayKey: initialUsageEvent.dayKey,
      monthKey: initialUsageEvent.monthKey,
      providerUserKey: owner.providerUserKey,
    }),
    usageBeforeDeletion,
    "meeting/result deletion should not decrement committed usage aggregates"
  );

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

  await verifyMeetingCleanupFailureGuards({ audioPayload, owner });

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
  assertUsageEvent(state, {
    expectedDurationMs: 120000,
    jobId: chunkedJob.jobId,
    meetingId: "meeting-chunked-1",
    providerUserKey: owner.providerUserKey,
  });

  await verifyUsageAccountingDomainIdempotency();

  console.log("[verify-meeting-service] hosted-only meeting service flow passed");
}

async function verifyDebugAuthBypassGate() {
  const previousFunctionsEmulator = process.env.FUNCTIONS_EMULATOR;
  const previousAuthEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const previousFirestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  const previousStorageEmulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;

  try {
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;

    const productionState = createMemoryState();
    const productionDeps = createDeps(productionState);
    productionDeps.verifyInovaIdentity = async () => {
      const error = new Error("strict auth required");
      error.status = 401;
      throw error;
    };
    const productionHandlers = registerMeetingWorkspaceAuthHandlers(productionDeps);
    const spoofedProductionBypass = await invokeHandler(productionHandlers.authorizeInovaMeetingWorkspaceAccess, {
      body: {
        debugAuthBypass: "owner",
        meetingId: "meeting-debug-bypass-1",
      },
      get: createHeaderGetter({
        origin: "http://127.0.0.1:5000",
        referer: "http://127.0.0.1:5000/meeting/index.html?debugAuthBypass=owner",
      }),
      headers: {},
      method: "POST",
    });
    assert.equal(spoofedProductionBypass.statusCode, 401);
    assert.equal(productionState.customTokens.length, 0);

    process.env.FUNCTIONS_EMULATOR = "true";
    const emulatorState = createMemoryState();
    const emulatorDeps = createDeps(emulatorState);
    emulatorDeps.verifyInovaIdentity = async () => {
      throw new Error("debug bypass should not verify bearer identity in emulator");
    };
    const emulatorHandlers = registerMeetingWorkspaceAuthHandlers(emulatorDeps);
    const emulatorBypass = await invokeHandler(emulatorHandlers.authorizeInovaMeetingWorkspaceAccess, {
      body: {
        debugAuthBypass: "owner",
        meetingId: "meeting-debug-bypass-1",
      },
      get: createHeaderGetter({
        origin: "http://127.0.0.1:5000",
        referer: "http://127.0.0.1:5000/meeting/index.html?debugAuthBypass=owner",
      }),
      headers: {},
      method: "POST",
    });
    assert.equal(emulatorBypass.statusCode, 200);
    assert.equal(emulatorBypass.jsonBody.data.bypassApplied, true);
    assert.equal(emulatorBypass.jsonBody.data.accessMode, "owner-secure");
    assert.equal(emulatorState.customTokens.length, 1);
  } finally {
    restoreProcessEnv("FUNCTIONS_EMULATOR", previousFunctionsEmulator);
    restoreProcessEnv("FIREBASE_AUTH_EMULATOR_HOST", previousAuthEmulatorHost);
    restoreProcessEnv("FIRESTORE_EMULATOR_HOST", previousFirestoreEmulatorHost);
    restoreProcessEnv("FIREBASE_STORAGE_EMULATOR_HOST", previousStorageEmulatorHost);
  }
}

function createHeaderGetter(headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key || "").toLowerCase(), String(value || "")])
  );
  return (name) => normalized[String(name || "").toLowerCase()] || "";
}

function restoreProcessEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
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

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-meeting-service] ${error.stack || error.message}`);
  process.exit(1);
});
