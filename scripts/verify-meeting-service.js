#!/usr/bin/env node

const assert = require("assert");
const { registerMeetingLaunchHandlers } = require("../functions/meeting-launch-service");
const { registerMeetingHandlers } = require("../functions/meeting-service");

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
      options: { redaction: "none", speakerLabels: true, summary: true },
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
      options: { redaction: "none", speakerLabels: true, summary: true },
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
  assert.equal(storedJob.jsonBody.data.job.notesStyleSelected, "default");
  assert.equal(storedJob.jsonBody.data.job.meetingNotes.mode, "planning");
  assert.equal(storedJob.jsonBody.data.job.meetingNotes.meetingMeta.title, "프로모션 일정·예산 실행 계획");
  assert.equal(storedJob.jsonBody.data.job.title, "프로모션 일정·예산 실행 계획");
  assert(storedJob.jsonBody.data.job.meetingNotes.executiveSummary.length > 0);
  assert(storedJob.jsonBody.data.job.meetingNotes.modeSpecific.milestones.length > 0);
  assert.equal(storedJob.jsonBody.data.job.meetingNotes.speakerSummaries[0].speakerLabel, "SPEAKER_00");
  assert(storedJob.jsonBody.data.job.meetingNotes.speakerSummaries[0].summary.includes("일정"));

  const artifactId = storedJob.jsonBody.data.job.transcript.artifactId;
  const artifact = await invokeHandler(handlers.getInovaMeetingArtifact, {
    body: { artifactId, jobId, owner },
    method: "POST",
  });
  assert.equal(artifact.statusCode, 200);
  assert.equal(artifact.jsonBody.data.artifact.notesModeSelected, "planning");
  assert.equal(artifact.jsonBody.data.artifact.notesStyleSelected, "default");
  assert.equal(artifact.jsonBody.data.artifact.notes.mode, "planning");
  assert.equal(artifact.jsonBody.data.artifact.segments.length, 2);

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
  assert.equal(regenerated.jsonBody.data.job.notesStyleSelected, "default");
  assert.equal(regenerated.jsonBody.data.job.meetingNotes.mode, "interview");
  assert.equal(regenerated.jsonBody.data.job.title, "후보자 응답 및 후속 인터뷰 정리");
  assert(regenerated.jsonBody.data.job.meetingNotes.modeSpecific.followUpQuestions.length > 0);
  assert.equal(regenerated.jsonBody.data.job.meetingNotes.speakerSummaries[1].speakerLabel, "SPEAKER_01");
  assert.equal(state.openaiRequests.length, 1, "Notes regeneration should not retrigger transcription");
  assert.equal(state.openaiSummaryRequests.length, 4, "Regeneration should run classifier + notes only");

  const updatedResult = await invokeHandler(handlers.updateInovaMeetingResult, {
    body: {
      jobId,
      meetingId: "meeting-planning-1",
      owner,
      speakerAliases: {
        SPEAKER_00: "박영택",
        SPEAKER_01: "마케팅 팀",
      },
      title: "3월 30일 회의록",
    },
    method: "POST",
  });
  assert.equal(updatedResult.statusCode, 200);
  assert.equal(updatedResult.jsonBody.data.job.title, "3월 30일 회의록");
  assert.equal(updatedResult.jsonBody.data.job.speakerAliases.SPEAKER_00, "박영택");
  assert.equal(updatedResult.jsonBody.data.job.speakerAliases.SPEAKER_01, "마케팅 팀");

  const aliasRegenerated = await invokeHandler(handlers.regenerateInovaMeetingNotes, {
    body: {
      jobId,
      meetingId: "meeting-planning-1",
      notesMode: "planning",
      owner,
      sharedMemo: "실행 계획을 다시 정리합니다.",
    },
    method: "POST",
  });
  assert.equal(aliasRegenerated.statusCode, 200);
  assert.equal(aliasRegenerated.jsonBody.data.job.speakerAliases.SPEAKER_00, "박영택");
  assert.equal(aliasRegenerated.jsonBody.data.artifact.speakerAliases.SPEAKER_01, "마케팅 팀");
  assert.equal(aliasRegenerated.jsonBody.data.job.title, "프로모션 일정·예산 실행 계획");
  assert.equal(state.openaiSummaryRequests.length, 6, "Alias regeneration should run classifier + notes once more");
  assert(state.openaiSummaryRequests[5].prompt.includes("박영택"), "Notes regeneration prompt should use saved speaker aliases");

  const generalRegenerated = await invokeHandler(handlers.regenerateInovaMeetingNotes, {
    body: {
      jobId,
      meetingId: "meeting-planning-1",
      notesMode: "general",
      notesStyle: "action",
      owner,
      sharedMemo: "일반 회의 형식으로 다시 정리합니다.",
    },
    method: "POST",
  });
  assert.equal(generalRegenerated.statusCode, 200);
  assert.equal(generalRegenerated.jsonBody.data.job.notesModeSelected, "general");
  assert.equal(generalRegenerated.jsonBody.data.job.notesStyleSelected, "action");
  assert.equal(generalRegenerated.jsonBody.data.job.meetingNotes.mode, "general");
  assert.equal(generalRegenerated.jsonBody.data.job.meetingNotes.openQuestions[0], "운영 구조와 명분이 아직 정리되지 않았습니다. · 상태: open");
  assert.equal(generalRegenerated.jsonBody.data.artifact.notes.openQuestions[1], "외부 협업 일정을 언제까지 확정할지 추가 논의가 필요합니다.");
  assert.equal(state.openaiSummaryRequests.length, 8, "General regeneration should run classifier + notes once more");
  assert(state.openaiSummaryRequests[7].prompt.includes("표현 방식: action"));

  const deletedResult = await invokeHandler(handlers.deleteInovaMeetingResult, {
    body: {
      jobId,
      meetingId: "meeting-planning-1",
      owner,
    },
    method: "POST",
  });
  assert.equal(deletedResult.statusCode, 200);
  assert.equal(deletedResult.jsonBody.data.deletedJobId, jobId);
  assert.equal(deletedResult.jsonBody.data.artifactCount, 1);

  const deletedWorkspace = await invokeHandler(handlers.deleteInovaMeeting, {
    body: {
      meetingId: "meeting-planning-1",
      owner,
    },
    method: "POST",
  });
  assert.equal(deletedWorkspace.statusCode, 200);
  assert.equal(deletedWorkspace.jsonBody.data.meetingId, "meeting-planning-1");
  assert.equal(deletedWorkspace.jsonBody.data.jobCount, 0);
  assert.equal(deletedWorkspace.jsonBody.data.artifactCount, 0);

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
      options: { redaction: "none", speakerLabels: true, summary: false },
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
  const bucketlessStoredJob = await invokeHandler(bucketlessHandlers.getInovaMeetingJob, {
    body: { jobId: bucketless.jsonBody.data.job.jobId, owner },
    method: "POST",
  });
  assert.equal(bucketlessStoredJob.jsonBody.data.job.source.uploadStatus, "inline-only");
  assert.equal(bucketlessStoredJob.jsonBody.data.job.cleanup.sourceAudioDeleted, false);

  console.log("[verify-meeting-service] Meeting service flow passed");
}

function createDeps(state, overrides = {}) {
  return {
    CORS_ORIGINS: ["https://inova.incross.com"],
    REGION: "asia-northeast3",
    bucket: Object.prototype.hasOwnProperty.call(overrides, "bucket") ? overrides.bucket : createBucket(state),
    createHttpError(status, message) {
      const error = new Error(message);
      error.status = status;
      return error;
    },
    db: createDb(state),
    hostedMeetingPageUrl: "https://browser-extension-main.web.app/meeting/index.html",
    logEvent(name, payload) {
      state.events.push({ name, payload: cloneValue(payload) });
    },
    normalizeIdentity(input) {
      return {
        displayName: String(input?.displayName || "").trim(),
        email: String(input?.email || "").trim(),
        numericUserId: Number(input?.numericUserId) || 0,
        provider: String(input?.provider || "").trim(),
        providerUserKey: String(input?.providerUserKey || "").trim(),
      };
    },
    normalizeText(value) {
      return String(value || "").trim();
    },
    onRequest(_options, handler) {
      return handler;
    },
    openaiFactory() {
      return {
        audio: {
          transcriptions: {
            async create(request) {
              state.openaiRequests.push({
                chunking_strategy: request.chunking_strategy || "",
                language: request.language || "",
                model: request.model || "",
                response_format: request.response_format || "",
              });
              return {
                duration: 10.4,
                language: "ko",
                segments: [
                  {
                    end: 5.3,
                    speaker: "A",
                    start: 0,
                    text: "신규 프로모션 일정을 이번 주 안에 확정합시다.",
                  },
                  {
                    end: 10.4,
                    speaker: "B",
                    start: 5.4,
                    text: "예산과 랜딩 문구는 오늘 초안으로 정리하겠습니다.",
                  },
                ],
                task: "transcribe",
                text: "신규 프로모션 일정을 이번 주 안에 확정합시다. 예산과 랜딩 문구는 오늘 초안으로 정리하겠습니다.",
              };
            },
          },
        },
        chat: {
          completions: {
            async create(request) {
              const firstSystemMessage = Array.isArray(request.messages) ? String(request.messages[0]?.content || "") : "";
              const userPrompt = Array.isArray(request.messages) ? String(request.messages[1]?.content || "") : "";
              if (firstSystemMessage.includes("회의 전사 분류기")) {
                state.openaiSummaryRequests.push({ kind: "classifier", model: request.model || "", prompt: userPrompt, systemPrompt: firstSystemMessage });
                const mode = userPrompt.includes("인터뷰") ? "interview" : "planning";
                return {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          confidence: mode === "interview" ? 0.74 : 0.88,
                          mode,
                        }),
                      },
                    },
                  ],
                };
              }

              state.openaiSummaryRequests.push({ kind: "notes", model: request.model || "", prompt: userPrompt, systemPrompt: firstSystemMessage });
              const mode = userPrompt.includes("정리 형식(내부 판단): interview")
                ? "interview"
                : userPrompt.includes("정리 형식(내부 판단): review")
                  ? "review"
                  : userPrompt.includes("정리 형식(내부 판단): planning")
                    ? "planning"
                    : "general";
              const style = userPrompt.includes("표현 방식: action")
                ? "action"
                : userPrompt.includes("표현 방식: brief")
                  ? "brief"
                  : "default";
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify(createNotesFixture(mode, style)),
                    },
                  },
                ],
              };
            },
          },
        },
      };
    },
    sendError(response, error) {
      response.status(Number(error?.status) || 500).json({
        error: String(error?.message || "Unexpected error"),
        ok: false,
      });
    },
    async verifyInovaIdentity(providerIdentity) {
      return providerIdentity;
    },
  };
}

function createNotesFixture(mode, style = "default") {
  if (mode === "interview") {
    return {
      actionItems: [{ assignee: "채용 리드", dueDate: "다음 주", status: "open", task: "후속 인터뷰 질문을 정리합니다." }],
      decisions: [{ confidence: "medium", owner: "채용 리드", text: "다음 라운드 인터뷰를 진행합니다." }],
      executiveSummary: [style === "brief" ? "후보자 강점과 후속 확인 포인트를 짧게 정리한 인터뷰다." : "후보자의 문제 구조화와 커뮤니케이션이 핵심 인사이트였습니다."],
      meetingMeta: {
        title: "후보자 응답 및 후속 인터뷰 정리",
      },
      memoHighlights: [{ linkedTopic: "후속 질문", mergeStatus: "merged", text: "서비스 운영 경험을 더 확인합니다." }],
      mode: "interview",
      modeSpecific: {
        concerns: ["대규모 운영 경험은 추가 확인이 필요합니다."],
        followUpQuestions: ["장애 대응 경험을 구체적으로 질문합니다."],
        strengths: ["문제 구조화가 빠릅니다."],
      },
      openQuestions: [],
      risksOrDependencies: [],
      speakerSummaries: [
        { keyPoints: ["데이터 기반 의사결정", "문제 구조화"], speakerLabel: "SPEAKER_00", summary: "첫 번째 화자는 후보자의 강점과 응답 내용을 중심으로 말했다." },
        { keyPoints: ["운영 경험 확인 필요"], speakerLabel: "SPEAKER_01", summary: "두 번째 화자는 추가 확인이 필요한 운영 경험과 후속 질문을 언급했다." },
      ],
      topics: [{ decisions: [], keyPoints: ["후보자는 데이터 기반 의사결정을 강조했습니다."], openQuestions: [], source: { memo: true, transcript: true }, summary: "응답 정리입니다.", topic: "응답 요약" }],
    };
  }
  if (mode === "general") {
    return {
      actionItems: [{ assignee: "운영 팀", dueDate: "", status: "open", task: "외부 협업 일정 초안을 정리합니다." }],
      decisions: [{ confidence: "medium", owner: "", text: "전체 일정은 운영 준비와 외부 협업 일정에 맞춰 다시 조정하기로 했다." }],
      executiveSummary: [style === "action" ? "운영 일정과 외부 협업 이슈를 중심으로 후속 실행 항목을 정리했다." : "플랫폼 준비와 운영 준비를 함께 보며 일정을 다시 맞춰야 한다는 점이 논의되었다."],
      meetingMeta: {
        title: "플랫폼 구축 및 운영 일정 일반 회의 정리",
      },
      memoHighlights: [],
      mode: "general",
      modeSpecific: {},
      openQuestions: [
        { question: "운영 구조와 명분이 아직 정리되지 않았습니다.", status: "open" },
        { text: "외부 협업 일정을 언제까지 확정할지 추가 논의가 필요합니다." },
      ],
      risksOrDependencies: [
        { severity: "medium", text: "업체 계약이 늦어지면 전체 오픈 일정이 밀릴 수 있습니다." },
      ],
      speakerSummaries: [
        { keyPoints: ["운영 구조 검토"], speakerLabel: "SPEAKER_00", summary: "첫 번째 화자는 플랫폼 구조와 운영 명분을 중심으로 말했다." },
        { keyPoints: ["외부 협업 일정"], speakerLabel: "SPEAKER_01", summary: "두 번째 화자는 업체 계약과 입점 일정 쪽 이슈를 언급했다." },
      ],
      topics: [
        {
          decisions: [],
          keyPoints: ["운영 구조와 외부 협업 일정 검토"],
          openQuestions: [{ question: "오픈 시점을 어떻게 잡을지 추가 검토 필요" }],
          source: { memo: true, transcript: true },
          summary: "일정과 운영 구조를 함께 검토했다.",
          topic: "운영 일정",
        },
      ],
    };
  }
  return {
    actionItems: [{ assignee: "마케팅 팀", dueDate: "오늘", status: "open", task: "예산과 랜딩 문구 초안을 정리합니다." }],
    decisions: [{ confidence: "high", owner: "팀 리드", text: "신규 프로모션 일정은 이번 주 안에 확정합니다." }],
    executiveSummary: [style === "brief" ? "프로모션 일정과 초안 준비를 짧게 정리한 회의다." : "신규 프로모션 일정과 예산·랜딩 문구 초안을 정리하기로 합의한 회의입니다."],
    meetingMeta: {
      title: "프로모션 일정·예산 실행 계획",
    },
    memoHighlights: [{ linkedTopic: "일정 계획", mergeStatus: "merged", text: "담당자 확정이 우선입니다." }],
    mode: "planning",
    modeSpecific: {
      dependencies: ["디자인 시안 최종본"],
      milestones: ["오늘 초안 정리", "이번 주 일정 확정"],
      scopeItems: ["프로모션 일정", "예산", "랜딩 문구"],
    },
    openQuestions: [],
    risksOrDependencies: [{ severity: "medium", text: "디자인 시안 확정이 늦어질 수 있습니다." }],
    speakerSummaries: [
      { keyPoints: ["이번 주 일정 확정"], speakerLabel: "SPEAKER_00", summary: "첫 번째 화자는 신규 프로모션 일정을 이번 주 안에 확정하자는 방향을 말했다." },
      { keyPoints: ["예산 초안", "랜딩 문구 초안"], speakerLabel: "SPEAKER_01", summary: "두 번째 화자는 예산과 랜딩 문구 초안을 오늘 안에 정리하겠다고 말했다." },
    ],
    topics: [{ decisions: ["이번 주 일정 확정"], keyPoints: ["예산과 랜딩 문구 초안 정리"], openQuestions: [], source: { memo: true, transcript: true }, summary: "실행 순서를 정리했습니다.", topic: "일정 계획" }],
  };
}

function createDb(state) {
  return {
    collection(name) {
      if (!state.collections.has(name)) {
        state.collections.set(name, new Map());
      }
      const collectionState = state.collections.get(name);
      return {
        doc(id) {
          const resolvedId = String(id || `doc-${state.nextId++}`);
          return {
            id: resolvedId,
            async get() {
              return {
                data() {
                  return cloneValue(collectionState.get(resolvedId));
                },
                exists: collectionState.has(resolvedId),
              };
            },
            async delete() {
              collectionState.delete(resolvedId);
            },
            async set(value, options = {}) {
              const nextValue = cloneValue(value);
              if (options.merge && collectionState.has(resolvedId)) {
                collectionState.set(resolvedId, deepMerge(collectionState.get(resolvedId), nextValue));
                return;
              }
              collectionState.set(resolvedId, nextValue);
            },
          };
        },
      };
    },
  };
}

function createBucket(state) {
  return {
    file(path) {
      const normalizedPath = String(path || "").trim();
      return {
        async delete() {
          const current = state.uploads.get(normalizedPath) || {};
          state.uploads.set(normalizedPath, { ...current, deleted: true });
        },
        async download() {
          const current = state.uploads.get(normalizedPath);
          return [Buffer.from(current?.buffer || Buffer.alloc(0))];
        },
        async save(buffer, options = {}) {
          state.uploads.set(normalizedPath, {
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

function createMemoryState() {
  return {
    collections: new Map(),
    events: [],
    nextId: 1,
    openaiRequests: [],
    openaiSummaryRequests: [],
    uploads: new Map(),
  };
}

async function invokeHandler(handler, request) {
  const response = createResponse();
  await handler(request, response);
  return response;
}

function createResponse() {
  return {
    jsonBody: null,
    statusCode: 200,
    json(payload) {
      this.jsonBody = cloneValue(payload);
      return this;
    },
    status(code) {
      this.statusCode = Number(code) || 500;
      return this;
    },
  };
}

function deepMerge(base, patch) {
  const nextBase = base && typeof base === "object" ? base : {};
  const nextPatch = patch && typeof patch === "object" ? patch : {};
  const result = Array.isArray(nextPatch) ? [] : { ...cloneValue(nextBase) };
  for (const [key, value] of Object.entries(nextPatch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = deepMerge(nextBase[key], value);
      continue;
    }
    result[key] = cloneValue(value);
  }
  return result;
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error(`[verify-meeting-service] ${error.message}`);
  process.exit(1);
});
