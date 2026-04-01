(function initMeetingWorkspace(global) {
  const namespace = (global.InovaBookmarks = global.InovaBookmarks || {});
  const ACTIVE_POLL_DELAY_MS = 1800;
  const state = {
    loading: false,
    params: parseParams(global.location.href),
    providerIdentity: normalizeProviderIdentity(null),
    selectedArtifact: null,
    selectedJob: null,
    selectedJobId: "",
    sessionState: namespace.meetingState.mergeMeetingState(),
    syncTimer: 0,
  };
  const refs = {};

  document.addEventListener("DOMContentLoaded", bootstrap);

  async function bootstrap() {
    cacheRefs();
    bindEvents();
    chrome.storage.onChanged?.addListener(handleStorageChange);
    await refreshWorkspace(true);
  }

  function cacheRefs() {
    for (const id of [
      "pageTitle",
      "pageSummary",
      "sessionBadge",
      "refreshButton",
      "currentTitle",
      "currentBadge",
      "currentSummary",
      "currentHint",
      "meetingTitleInput",
      "startButton",
      "stopButton",
      "transcribeButton",
      "durationStat",
      "sizeStat",
      "updatedStat",
      "recordCountBadge",
      "recordList",
      "detailTitle",
      "detailBadge",
      "detailSummary",
      "detailMeta",
      "detailNotice",
      "transcriptText",
      "segmentList",
    ]) {
      refs[id] = document.getElementById(id);
    }
  }

  function bindEvents() {
    refs.refreshButton.addEventListener("click", () => refreshWorkspace(false));
    refs.meetingTitleInput.addEventListener("input", handleTitleInput);
    refs.startButton.addEventListener("click", startCapture);
    refs.stopButton.addEventListener("click", stopCapture);
    refs.transcribeButton.addEventListener("click", createJob);
    refs.recordList.addEventListener("click", handleRecordClick);
  }

  async function refreshWorkspace(hydrateSelection) {
    if (state.loading) {
      return;
    }
    state.loading = true;
    try {
      const storage = await namespace.storage.getState();
      state.providerIdentity = normalizeProviderIdentity(storage.cloudSync?.providerIdentity);
      state.sessionState = await namespace.storage.getMeetingState(state.params.meetingId);
      if (!state.params.meetingId) {
        state.params.meetingId = normalizeText(state.sessionState.meeting.meetingId || state.sessionState.session.sessionId);
      }
      if (!(Number(state.params.sourceTabId) > 0)) {
        state.params.sourceTabId = Math.max(0, Number(state.sessionState.meeting.sourceTabId) || 0);
      }
      if (!normalizeText(state.params.title)) {
        state.params.title = getMeetingTitle(state.sessionState);
      }
      state.sessionState = await refreshMeetingRecords(state.sessionState);
      if (hydrateSelection) {
        state.selectedJobId = chooseSelectedJobId();
      }
      await hydrateSelectedDetail();
      render();
    } finally {
      state.loading = false;
    }
  }

  async function startCapture() {
    try {
      renderNotice("detailNotice", "녹음을 시작하는 중입니다.", "highlight");
      await namespace.meetingBridge.startMeetingCapture(await buildCaptureStartInput());
      await refreshWorkspace(false);
      renderNotice("detailNotice", "녹음이 시작되었습니다. 종료 후 전사까지 이 페이지에서 이어서 진행할 수 있습니다.", "highlight");
    } catch (error) {
      renderNotice("detailNotice", error instanceof Error ? error.message : "녹음을 시작하지 못했어요.", "error");
    }
  }

  async function stopCapture() {
    if (!state.params.meetingId) {
      renderNotice("detailNotice", "현재 회의를 찾지 못했어요.", "error");
      return;
    }
    try {
      renderNotice("detailNotice", "녹음을 저장하는 중입니다.", "highlight");
      await namespace.meetingBridge.stopMeetingCapture({ meetingId: state.params.meetingId });
      await refreshWorkspace(false);
      renderNotice("detailNotice", "녹음이 저장되었습니다. 이제 전사를 시작할 수 있어요.", "highlight");
    } catch (error) {
      renderNotice("detailNotice", error instanceof Error ? error.message : "녹음을 종료하지 못했어요.", "error");
    }
  }

  async function createJob() {
    const meetingTitle = getMeetingTitle();
    const sessionState = namespace.meetingState.mergeMeetingState(state.sessionState, {
      meeting: {
        meetingId: state.params.meetingId,
        sourceTabId: state.params.sourceTabId,
        title: meetingTitle,
      },
      session: {
        title: meetingTitle,
      },
    });
    if (!state.providerIdentity.available) {
      renderNotice("detailNotice", "현재 사용자 정보를 찾지 못했어요. i-Nova 탭을 다시 연 뒤 시도해 주세요.", "error");
      return;
    }
    if (sessionState.capture.status !== "captured") {
      renderNotice("detailNotice", "먼저 녹음을 저장한 뒤 전사를 시작해 주세요.", "error");
      return;
    }
    try {
      renderNotice("detailNotice", "전사 작업을 접수하는 중입니다.", "highlight");
      const payload = await namespace.meetingBridge.createMeetingJob(
        namespace.meetingState.buildMeetingJobCreateInput(sessionState, {
          meeting: {
            endedAt: sessionState.session.endedAt || new Date().toISOString(),
            meetingId: state.params.meetingId,
            sourceTabId: state.params.sourceTabId,
            title: meetingTitle,
          },
          options: {
            redaction: "none",
            speakerLabels: true,
            summary: false,
          },
        }),
        state.providerIdentity
      );
      state.sessionState = await namespace.storage.setMeetingState(
        state.params.meetingId,
        namespace.meetingState.applyMeetingJobCreated(sessionState, payload)
      );
      state.selectedJobId = normalizeText(state.sessionState.job.jobId);
      await hydrateSelectedDetail();
      render();
      renderNotice("detailNotice", "전사 작업이 접수되었습니다. 상세 진행 상태는 이 페이지에서 계속 갱신됩니다.", "highlight");
      scheduleSync();
    } catch (error) {
      renderNotice("detailNotice", error instanceof Error ? error.message : "전사 작업을 접수하지 못했어요.", "error");
    }
  }

  async function handleRecordClick(event) {
    const button = event.target.closest("[data-record-job-id]");
    if (!(button instanceof HTMLElement)) {
      return;
    }
    state.selectedJobId = normalizeText(button.dataset.recordJobId);
    updateUrl();
    await hydrateSelectedDetail();
    render();
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "local" || (!changes.meetingStateByMeetingId && !changes.meetingStateBySession && !changes.meetingState && !changes.cloudSync)) {
      return;
    }
    global.clearTimeout(state.syncTimer);
    state.syncTimer = global.setTimeout(() => {
      refreshWorkspace(false).catch((error) => console.error("[i-Nova Meeting] refresh failed", error));
    }, 220);
  }

  async function hydrateSelectedDetail() {
    const sessionState = namespace.meetingState.mergeMeetingState(state.sessionState);
    const selectedRecord = getSelectedRecord();
    state.selectedJob = selectedRecord ? buildJobFromRecord(selectedRecord) : buildJobFromSessionState(sessionState);
    state.selectedArtifact = buildArtifactFromSessionState(sessionState, state.selectedJob?.jobId);
    if (!state.providerIdentity.available || !state.selectedJob?.jobId) {
      return;
    }
    await refreshSelectedJobFromServer();
    await persistCurrentSessionSnapshot();
    if (shouldPollSelectedJob()) {
      scheduleSync();
    }
  }

  async function refreshMeetingRecords(meetingState) {
    const normalizedMeetingState = namespace.meetingState.mergeMeetingState(meetingState);
    if (!state.providerIdentity.available || !state.params.meetingId) {
      return normalizedMeetingState;
    }
    try {
      const listPayload = await namespace.meetingBridge.listMeetingResults(
        {
          limit: 12,
          meetingId: state.params.meetingId,
        },
        state.providerIdentity
      );
      const meetingPayload = listPayload?.meeting && typeof listPayload.meeting === "object"
        ? listPayload.meeting
        : {};
      const sessionPayload = listPayload?.session && typeof listPayload.session === "object"
        ? listPayload.session
        : {};
      const nextMeetingState = namespace.meetingState.mergeMeetingState(normalizedMeetingState, {
        meeting: {
          createdAt: normalizeText(meetingPayload.createdAt) || normalizeText(normalizedMeetingState.meeting.createdAt),
          meetingId: normalizeText(meetingPayload.meetingId) || normalizeText(state.params.meetingId),
          sourceTabId: Math.max(0, Number(meetingPayload.sourceTabId) || Number(normalizedMeetingState.meeting.sourceTabId) || 0),
          title: normalizeText(meetingPayload.title)
            || normalizeText(state.params.title)
            || normalizeText(normalizedMeetingState.meeting.title)
            || normalizeText(normalizedMeetingState.session.title),
          updatedAt: normalizeText(meetingPayload.updatedAt) || normalizeText(normalizedMeetingState.meeting.updatedAt),
        },
        records: Array.isArray(listPayload?.items) ? listPayload.items : [],
        session: {
          endedAt: normalizeText(sessionPayload.endedAt) || normalizeText(normalizedMeetingState.session.endedAt),
          language: normalizeText(sessionPayload.language) || normalizeText(normalizedMeetingState.session.language),
          sessionId: normalizeText(sessionPayload.sessionId) || normalizeText(normalizedMeetingState.session.sessionId),
          startedAt: normalizeText(sessionPayload.startedAt) || normalizeText(normalizedMeetingState.session.startedAt),
          title: normalizeText(sessionPayload.title)
            || normalizeText(state.params.title)
            || normalizeText(normalizedMeetingState.meeting.title)
            || normalizeText(normalizedMeetingState.session.title),
        },
      });
      if (isSameMeetingState(normalizedMeetingState, nextMeetingState)) {
        return nextMeetingState;
      }
      return await namespace.storage.setMeetingState(state.params.meetingId, nextMeetingState);
    } catch (error) {
      console.error("[i-Nova Meeting] record hydrate failed", error);
      return normalizedMeetingState;
    }
  }

  async function refreshSelectedJobFromServer() {
    try {
      const jobPayload = await namespace.meetingBridge.getMeetingJob(
        {
          jobId: state.selectedJob.jobId,
          meetingId: state.params.meetingId,
        },
        state.providerIdentity
      );
      const nextJob = normalizeJobPayload(jobPayload?.job);
      if (nextJob?.jobId) {
        state.selectedJob = nextJob;
      }
      const artifactId = normalizeText(
        state.selectedJob?.artifactId
        || jobPayload?.job?.artifacts?.[0]?.artifactId
        || state.selectedArtifact?.artifactId
      );
      if (!artifactId) {
        return;
      }
      const artifactPayload = await namespace.meetingBridge.getMeetingArtifact(
        {
          artifactId,
          jobId: state.selectedJob.jobId,
          meetingId: state.params.meetingId,
        },
        state.providerIdentity
      );
      state.selectedArtifact = normalizeArtifactPayload(artifactPayload?.artifact);
    } catch (error) {
      console.error("[i-Nova Meeting] detail hydrate failed", error);
    }
  }

  async function persistCurrentSessionSnapshot() {
    if (!state.params.meetingId) {
      return;
    }
    const currentJobId = normalizeText(state.sessionState?.job?.jobId);
    const selectedJobId = normalizeText(state.selectedJob?.jobId);
    if (!currentJobId || currentJobId !== selectedJobId) {
      return;
    }

    let nextMeetingState = namespace.meetingState.mergeMeetingState(state.sessionState);
    if (state.selectedJob?.jobId) {
      nextMeetingState = namespace.meetingState.applyMeetingJobSnapshot(nextMeetingState, {
        job: state.selectedJob,
      });
    }
    if (state.selectedArtifact?.artifactId) {
      nextMeetingState = namespace.meetingState.applyMeetingArtifact(nextMeetingState, {
        artifact: state.selectedArtifact,
      });
    }
    if (isSameMeetingState(state.sessionState, nextMeetingState)) {
      state.sessionState = namespace.meetingState.mergeMeetingState(nextMeetingState);
      return;
    }
    state.sessionState = await namespace.storage.setMeetingState(state.params.meetingId, nextMeetingState);
  }

  function scheduleSync(delay = ACTIVE_POLL_DELAY_MS) {
    global.clearTimeout(state.syncTimer);
    state.syncTimer = global.setTimeout(() => {
      refreshWorkspace(false).catch((error) => console.error("[i-Nova Meeting] poll refresh failed", error));
    }, delay);
  }

  function handleTitleInput() {
    state.params.title = normalizeText(refs.meetingTitleInput.value);
    state.sessionState = namespace.meetingState.mergeMeetingState(state.sessionState, {
      meeting: {
        meetingId: state.params.meetingId,
        sourceTabId: state.params.sourceTabId,
        title: state.params.title,
      },
      session: {
        title: state.params.title,
      },
    });
    render();
  }

  function render() {
    const sessionState = namespace.meetingState.mergeMeetingState(state.sessionState);
    const records = namespace.meetingState.normalizeRecords(sessionState.records);
    const currentView = buildCurrentView(sessionState);
    const detailView = buildDetailView();

    const meetingTitle = getMeetingTitle(sessionState);
    refs.pageTitle.textContent = meetingTitle || "아이노바 회의 작업실";
    refs.pageSummary.textContent = currentView.pageSummary;
    refs.sessionBadge.textContent = state.params.meetingId ? `회의 ${state.params.meetingId}` : "새 회의";
    refs.currentTitle.textContent = currentView.title;
    refs.currentBadge.textContent = currentView.badgeLabel;
    refs.currentBadge.dataset.status = currentView.badgeStatus;
    refs.currentSummary.textContent = currentView.summary;
    refs.currentHint.textContent = currentView.hint;
    if (document.activeElement !== refs.meetingTitleInput) {
      refs.meetingTitleInput.value = meetingTitle;
    }
    refs.meetingTitleInput.disabled = !currentView.canEditTitle;
    refs.startButton.disabled = !currentView.canStart;
    refs.stopButton.hidden = !currentView.showStop;
    refs.stopButton.disabled = !currentView.showStop;
    refs.transcribeButton.disabled = !currentView.canTranscribe;
    refs.durationStat.textContent = currentView.durationText;
    refs.sizeStat.textContent = currentView.sizeText;
    refs.updatedStat.textContent = currentView.updatedText;

    refs.recordCountBadge.textContent = `${records.length}건`;
    refs.recordList.innerHTML = records.length
      ? records.map((record) => renderRecordButton(record, record.jobId === state.selectedJobId)).join("")
      : `<div class="notice-box">아직 저장된 이력이 없습니다. 녹음을 시작하거나 전사를 접수하면 같은 회의의 결과가 여기에 쌓입니다.</div>`;

    refs.detailTitle.textContent = detailView.title;
    refs.detailBadge.textContent = detailView.badgeLabel;
    refs.detailBadge.dataset.status = detailView.badgeStatus;
    refs.detailSummary.textContent = detailView.summary;
    refs.detailMeta.innerHTML = detailView.meta.length
      ? detailView.meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")
      : "";
    renderNotice("detailNotice", detailView.notice, detailView.noticeTone);
    refs.transcriptText.hidden = !detailView.transcriptText;
    refs.transcriptText.textContent = detailView.transcriptText;
    refs.segmentList.hidden = !detailView.segments.length;
    refs.segmentList.innerHTML = detailView.segments.map(renderSegment).join("");
  }

  function renderRecordButton(record, active) {
    const meta = [
      formatDateTime(record.updatedAt || record.createdAt, ""),
      record.speakerCount > 0 ? `화자 ${record.speakerCount}명` : "",
      record.jobId ? `job ${record.jobId}` : "",
    ].filter(Boolean).join(" · ");
    return `
      <button type="button" class="record-item${active ? " is-active" : ""}" data-record-job-id="${escapeHtml(record.jobId)}">
        <div class="record-item__head">
          <strong class="record-item__title">${escapeHtml(record.title || record.meetingId || "회의 결과")}</strong>
          <span class="status-badge" data-status="${escapeHtml(normalizeStatus(record.status))}">${escapeHtml(formatStatusLabel(record.status))}</span>
        </div>
        <div class="record-item__meta">${escapeHtml(meta || "상세 결과 확인 가능")}</div>
        <p class="record-item__summary">${escapeHtml(record.previewText || record.error || "선택하면 오른쪽에서 전체 결과를 다시 확인할 수 있습니다.")}</p>
      </button>
    `;
  }

  function renderSegment(segment) {
    return `
      <article class="segment-item">
        <div class="segment-item__head">
          <span class="segment-item__speaker">${escapeHtml(formatSpeakerLabel(segment.speakerLabel))}</span>
          <span>${escapeHtml(formatSegmentRange(segment.startMs, segment.endMs))}</span>
        </div>
        <p>${escapeHtml(segment.text)}</p>
      </article>
    `;
  }

  function buildCurrentView(sessionState) {
    const captureStatus = normalizeText(sessionState.capture.status) || "idle";
    const jobStatus = normalizeText(sessionState.job.status) || "idle";
    const canStartFresh = canStartCapture();
    const hasHistory = namespace.meetingState.normalizeRecords(sessionState.records).length > 0 || Boolean(normalizeText(sessionState.job.jobId));
    if (captureStatus === "recording") {
      return createCurrentView("녹음 중", "recording", false, true, false, false, "현재 회의 녹음이 진행 중입니다.", "브라우저 탭 오디오를 녹음 중입니다. 종료 후 전사를 시작할 수 있습니다.", sessionState);
    }
    if (captureStatus === "captured" && jobStatus === "idle") {
      return createCurrentView("녹음 완료", "captured", false, false, true, false, "전사 시작 전 단계입니다.", "원본 녹음이 저장되었습니다. 전사 시작 버튼으로 다음 단계로 넘길 수 있습니다.", sessionState);
    }
    if (jobStatus === "queued") {
      return createCurrentView("대기", "queued", false, false, false, false, "전사 작업이 접수되었습니다.", "상세 진행 상태를 확인하는 중입니다.", sessionState);
    }
    if (jobStatus === "processing") {
      const percent = Math.round(Number(sessionState.job.progress.percent) || 0);
      const phase = formatPhase(sessionState.job.progress.phase);
      return createCurrentView("진행 중", "processing", false, false, false, false, "회의 전사를 처리 중입니다.", phase ? `${phase}${percent > 0 ? ` · ${percent}%` : ""}` : "상세 진행 상태를 확인하는 중입니다.", sessionState);
    }
    if (jobStatus === "succeeded") {
      const speakerCount = Math.max(0, Number(sessionState.transcript.speakerCount) || 0);
      return createCurrentView("완료", "succeeded", canStartFresh, false, false, false, speakerCount > 0 ? `${speakerCount}명 화자 기준 결과가 준비되었습니다.` : "전사 결과가 준비되었습니다.", "왼쪽 리스트에서 다른 결과를 골라 다시 확인할 수 있습니다.", sessionState);
    }
    if (jobStatus === "failed" || captureStatus === "error") {
      return createCurrentView("오류", "failed", canStartFresh, false, false, false, "회의 처리 중 문제가 생겼습니다.", normalizeText(sessionState.job.error || sessionState.capture.error) || "새 녹음으로 다시 시도할 수 있습니다.", sessionState);
    }
    return createCurrentView(
      "대기",
      "idle",
      canStartFresh,
      false,
      false,
      !hasHistory,
      hasHistory ? "기존 결과를 다시 확인하거나 새 녹음을 이어서 시작할 수 있습니다." : "회의 제목을 정하고 새 녹음을 시작할 수 있습니다.",
      describeCaptureEntryHint(canStartFresh),
      sessionState
    );
  }

  function createCurrentView(badgeLabel, badgeStatus, canStart, showStop, canTranscribe, canEditTitle, summary, hint, sessionState) {
    return {
      badgeLabel,
      badgeStatus,
      canEditTitle,
      canStart,
      canTranscribe,
      durationText: Number(sessionState.capture.durationMs) > 0 ? formatDuration(sessionState.capture.durationMs) : "-",
      hint,
      pageSummary: "패널은 회의 목록만 보여주고, 실제 회의 생성과 결과 상세는 이 작업실에서 처리합니다.",
      showStop,
      sizeText: Number(sessionState.capture.sizeBytes) > 0 ? formatBytes(sessionState.capture.sizeBytes) : "-",
      summary,
      title: getMeetingTitle(sessionState) || "아이노바 회의 작업실",
      updatedText: formatDateTime(sessionState.job.updatedAt || sessionState.transcript.loadedAt || sessionState.session.endedAt || sessionState.session.startedAt, "-"),
    };
  }

  function buildDetailView() {
    const job = state.selectedJob;
    const artifact = state.selectedArtifact;
    if (!job?.jobId) {
      return { badgeLabel: "대기", badgeStatus: "idle", meta: [], notice: "왼쪽 결과 리스트에서 항목을 고르면 상세가 여기에 표시됩니다.", noticeTone: "", segments: [], summary: "아직 선택된 결과가 없습니다.", title: "결과를 선택해 주세요", transcriptText: "" };
    }
    const meta = [
      job.jobId ? `job ${job.jobId}` : "",
      formatDateTime(job.updatedAt || job.createdAt || job.queuedAt, ""),
      artifact?.segments?.length ? `${artifact.segments.length}구간` : "",
      artifact?.speakerCount > 0 ? `화자 ${artifact.speakerCount}명` : "",
    ].filter(Boolean);
    const transcriptText = normalizeTextBlock(artifact?.text);
    const segments = Array.isArray(artifact?.segments) ? artifact.segments.filter((segment) => normalizeText(segment.text)) : [];
    if (normalizeText(job.status) === "succeeded" && (transcriptText || segments.length)) {
      return { badgeLabel: formatStatusLabel(job.status), badgeStatus: normalizeStatus(job.status), meta, notice: transcriptText ? "전체 전사 본문과 화자 구간을 함께 볼 수 있습니다." : "화자 구간을 먼저 불러왔습니다.", noticeTone: "highlight", segments, summary: "선택한 회의 결과 상세입니다.", title: job.title || state.params.title || "회의 결과", transcriptText };
    }
    if (normalizeText(job.status) === "failed") {
      return { badgeLabel: "오류", badgeStatus: "failed", meta, notice: normalizeText(job.error) || "회의 처리 중 오류가 발생했습니다.", noticeTone: "error", segments: [], summary: "선택한 결과는 오류 상태입니다.", title: job.title || state.params.title || "회의 결과", transcriptText: "" };
    }
    return { badgeLabel: formatStatusLabel(job.status), badgeStatus: normalizeStatus(job.status), meta, notice: normalizeText(job.status) === "queued" ? "전사 대기열에 있습니다." : "결과를 준비 중입니다. 이 페이지에서 계속 상태를 갱신합니다.", noticeTone: "highlight", segments: [], summary: "선택한 결과의 진행 상태입니다.", title: job.title || state.params.title || "회의 결과", transcriptText: "" };
  }

  function chooseSelectedJobId() {
    if (state.selectedJobId) {
      return state.selectedJobId;
    }
    const explicitJobId = normalizeText(state.params.jobId);
    if (explicitJobId) {
      return explicitJobId;
    }
    const records = namespace.meetingState.normalizeRecords(state.sessionState.records);
    if (records.length) {
      return records[0].jobId;
    }
    return normalizeText(state.sessionState.job.jobId);
  }

  function getSelectedRecord() {
    return namespace.meetingState.normalizeRecords(state.sessionState.records)
      .find((record) => record.jobId === state.selectedJobId) || null;
  }

  function buildJobFromSessionState(sessionState) {
    const jobId = normalizeText(sessionState.job.jobId);
    if (!jobId) {
      return null;
    }
    return {
      artifactId: normalizeText(sessionState.job.artifactId || sessionState.transcript.artifactId),
      createdAt: normalizeText(sessionState.job.createdAt),
      error: normalizeText(sessionState.job.error),
      jobId,
      progress: {
        percent: Math.max(0, Math.min(100, Number(sessionState.job.progress?.percent) || 0)),
        phase: normalizeText(sessionState.job.progress?.phase),
      },
      queuedAt: normalizeText(sessionState.job.queuedAt),
      status: normalizeText(sessionState.job.status) || "idle",
      title: getMeetingTitle(sessionState),
      updatedAt: normalizeText(sessionState.job.updatedAt),
    };
  }

  function buildArtifactFromSessionState(sessionState, jobId) {
    const currentJobId = normalizeText(sessionState.job.jobId);
    if (!jobId || !currentJobId || jobId !== currentJobId) {
      return null;
    }
    const transcriptText = normalizeTextBlock(sessionState.transcript.text);
    const segments = Array.isArray(sessionState.transcript.segments)
      ? sessionState.transcript.segments.filter((segment) => normalizeText(segment.text))
      : [];
    if (!transcriptText && !segments.length) {
      return null;
    }
    return {
      artifactId: normalizeText(sessionState.transcript.artifactId || sessionState.job.artifactId),
      segments,
      speakerCount: Math.max(0, Number(sessionState.transcript.speakerCount) || countSpeakers(segments)),
      text: transcriptText,
    };
  }

  function buildJobFromRecord(record) {
    return {
      artifactId: normalizeText(record.artifactId),
      createdAt: normalizeText(record.createdAt),
      error: normalizeText(record.error),
      jobId: normalizeText(record.jobId),
      progress: { percent: 0, phase: "" },
      queuedAt: normalizeText(record.createdAt),
      status: normalizeText(record.status) || "idle",
      title: normalizeText(record.title),
      updatedAt: normalizeText(record.updatedAt),
    };
  }

  function normalizeJobPayload(job) {
    if (!job || typeof job !== "object") {
      return null;
    }
    return {
      artifactId: normalizeText(job.artifacts?.[0]?.artifactId || job.transcript?.artifactId),
      createdAt: normalizeText(job.createdAt),
      error: normalizeText(job.error),
      jobId: normalizeText(job.jobId),
      progress: {
        percent: Math.max(0, Math.min(100, Number(job.progress?.percent) || 0)),
        phase: normalizeText(job.progress?.phase),
      },
      queuedAt: normalizeText(job.queuedAt),
      status: normalizeText(job.status) || "idle",
      title: normalizeText(job.meeting?.title) || normalizeText(state.params.title),
      updatedAt: normalizeText(job.updatedAt),
    };
  }

  function normalizeArtifactPayload(artifact) {
    if (!artifact || typeof artifact !== "object") {
      return null;
    }
    const segments = Array.isArray(artifact.segments)
      ? artifact.segments
          .map((segment) => ({
            endMs: Math.max(0, Number(segment.endMs) || 0),
            speakerLabel: normalizeText(segment.speakerLabel),
            startMs: Math.max(0, Number(segment.startMs) || 0),
            text: normalizeText(segment.text),
          }))
          .filter((segment) => segment.text)
      : [];
    return {
      artifactId: normalizeText(artifact.artifactId),
      segments,
      speakerCount: countSpeakers(segments),
      text: normalizeTextBlock(artifact.text),
    };
  }

  function shouldPollSelectedJob() {
    return ["queued", "processing"].includes(normalizeText(state.selectedJob?.status));
  }

  function updateUrl() {
    const nextUrl = new URL(global.location.href);
    if (state.selectedJobId) {
      nextUrl.searchParams.set("jobId", state.selectedJobId);
    } else {
      nextUrl.searchParams.delete("jobId");
    }
    global.history.replaceState({}, "", nextUrl.toString());
  }

  function renderNotice(id, text, tone) {
    const element = refs[id];
    if (!element) {
      return;
    }
    element.className = "notice-box";
    if (tone === "error") {
      element.classList.add("is-error");
    }
    if (tone === "highlight") {
      element.classList.add("is-highlight");
    }
    element.textContent = text;
  }

  function parseParams(urlValue) {
    const url = new URL(urlValue || "https://example.com");
    return {
      artifactId: normalizeText(url.searchParams.get("artifactId")),
      captureEntry: normalizeText(url.searchParams.get("captureEntry")),
      jobId: normalizeText(url.searchParams.get("jobId")),
      meetingId: normalizeText(url.searchParams.get("meetingId") || url.searchParams.get("sessionId")),
      sourceTabId: Math.max(0, Number(url.searchParams.get("sourceTabId") || url.searchParams.get("tabId")) || 0),
      title: normalizeText(url.searchParams.get("title")),
    };
  }

  async function buildCaptureStartInput() {
    if (!state.params.meetingId) {
      throw new Error("회의 ID를 찾지 못했어요.");
    }
    if (shouldUseDesktopPickerCapture()) {
      const streamId = await requestDesktopAudioStream();
      return {
        captureMode: "desktop-audio",
        meetingId: state.params.meetingId,
        sourceTabId: state.params.sourceTabId,
        streamId,
        title: getMeetingTitle(),
      };
    }
    if (!(Number(state.params.sourceTabId) > 0)) {
      throw new Error("녹음을 시작할 원본 탭 정보를 찾지 못했어요. 패널이나 팝업에서 새 회의를 다시 열어 주세요.");
    }
    return {
      captureMode: "tab-audio",
      meetingId: state.params.meetingId,
      sourceTabId: state.params.sourceTabId,
      title: getMeetingTitle(),
    };
  }

  function canStartCapture() {
    return Boolean(state.params.meetingId && (shouldUseDesktopPickerCapture() || Number(state.params.sourceTabId) > 0));
  }

  function shouldUseDesktopPickerCapture() {
    return normalizeText(state.params.captureEntry) === "panel";
  }

  function describeCaptureEntryHint(canStartFresh) {
    if (shouldUseDesktopPickerCapture()) {
      return canStartFresh
        ? "녹음 시작을 누르면 크롬 탭 공유 선택창이 열립니다. 원본 i-Nova 탭을 고르고 오디오 공유를 켜 주세요."
        : "패널에서 연 작업실은 크롬 탭 공유 선택창으로 녹음을 시작합니다.";
    }
    if (canStartFresh) {
      return "이 회의에 연결된 원본 탭에서 바로 녹음을 시작할 수 있습니다.";
    }
    return "패널이나 팝업의 새 회의하기로 열면 바로 녹음을 시작할 수 있습니다.";
  }

  async function requestDesktopAudioStream() {
    if (typeof global.chrome?.desktopCapture?.chooseDesktopMedia !== "function") {
      throw new Error("현재 브라우저에서 탭 공유 선택창을 열 수 없어요.");
    }
    return new Promise((resolve, reject) => {
      try {
        global.chrome.desktopCapture.chooseDesktopMedia(["tab", "audio"], (streamId, options) => {
          const normalizedStreamId = normalizeText(streamId);
          if (!normalizedStreamId) {
            reject(new Error("탭 공유 선택이 취소되었어요. 다시 시도해 주세요."));
            return;
          }
          if (options && options.canRequestAudioTrack === false) {
            reject(new Error("탭 공유 창에서 오디오 공유를 켠 뒤 다시 시도해 주세요."));
            return;
          }
          resolve(normalizedStreamId);
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  function getMeetingTitle(meetingState = state.sessionState) {
    const normalizedState = namespace.meetingState.mergeMeetingState(meetingState);
    return normalizeText(state.params.title)
      || normalizeText(normalizedState.meeting.title)
      || normalizeText(normalizedState.session.title)
      || "새 회의";
  }

  function normalizeProviderIdentity(identity) {
    const providerUserKey = normalizeText(identity?.providerUserKey);
    return {
      available: Boolean(identity?.available) && Boolean(providerUserKey),
      displayName: normalizeText(identity?.displayName),
      email: normalizeText(identity?.email).toLowerCase(),
      numericUserId: Number.isFinite(Number(identity?.numericUserId)) ? Number(identity.numericUserId) : null,
      provider: normalizeText(identity?.provider) || "inova",
      providerUserKey,
    };
  }

  function formatStatusLabel(status) {
    const normalized = normalizeText(status);
    if (normalized === "recording") return "녹음 중";
    if (normalized === "captured") return "녹음 완료";
    if (normalized === "queued") return "대기";
    if (normalized === "processing") return "진행 중";
    if (normalized === "succeeded") return "완료";
    if (normalized === "failed") return "오류";
    return "대기";
  }

  function normalizeStatus(status) {
    const normalized = normalizeText(status);
    return ["recording", "captured", "queued", "processing", "succeeded", "failed"].includes(normalized) ? normalized : "idle";
  }

  function formatPhase(phase) {
    const normalized = normalizeText(phase);
    if (normalized === "uploading") return "업로드 중";
    if (normalized === "queued") return "대기 중";
    if (normalized === "transcribing") return "텍스트 변환";
    if (normalized === "diarizing") return "화자 분리";
    if (normalized === "finalizing") return "결과 정리";
    return normalized || "처리 중";
  }

  function formatDuration(durationMs) {
    const totalSeconds = Math.max(0, Math.round(Number(durationMs) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes <= 0 ? `${seconds}초` : `${minutes}분 ${seconds.toString().padStart(2, "0")}초`;
  }

  function formatBytes(sizeBytes) {
    const mb = Number(sizeBytes) / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.max(1, Math.round(Number(sizeBytes) / 1024))}KB`;
  }

  function formatDateTime(value, fallback = "") {
    const normalized = normalizeText(value);
    if (!normalized) {
      return fallback;
    }
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return fallback;
    }
    return parsed.toLocaleString("ko-KR", {
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      month: "numeric",
    });
  }

  function formatSpeakerLabel(value) {
    return normalizeText(value) || "화자";
  }

  function formatSegmentRange(startMs, endMs) {
    return `${formatSegmentTime(startMs)} - ${formatSegmentTime(endMs)}`;
  }

  function formatSegmentTime(value) {
    const totalSeconds = Math.max(0, Math.round(Number(value) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  function countSpeakers(segments) {
    return new Set((Array.isArray(segments) ? segments : []).map((segment) => normalizeText(segment.speakerLabel)).filter(Boolean)).size;
  }

  function isSameMeetingState(left, right) {
    return JSON.stringify(namespace.meetingState.mergeMeetingState(left)) === JSON.stringify(namespace.meetingState.mergeMeetingState(right));
  }

  function normalizeText(value) {
    return namespace.session.normalizeText(value);
  }

  function normalizeTextBlock(value) {
    return String(value || "").replace(/\r\n?/g, "\n").trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})(globalThis);
