(function initHostedMeetingWorkspace(global) {
  const ns = global.__INOVA_HOSTED_MEETING__;
  const { AUTO_RETRY_PENDING_STATUSES, DEFAULT_CREATE_JOB_TIMEOUT_MS, DEFAULT_INLINE_AUDIO_LIMIT_BYTES, DEFAULT_SOURCE_CHUNK_DURATION_MS, DEFAULT_SOURCE_CHUNK_OVERLAP_MS, DEFAULT_SOURCE_MAX_BYTES, DEFAULT_SOURCE_MAX_DURATION_MS, DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS, DEFAULT_SOURCE_TARGET_PART_BYTES, DEFAULT_SOURCE_UPLOAD_TIMEOUT_MS, buildCopyText, buildErrorCopyText, buildRemoteSelectionId, buildWorkspaceHash, buildWorkspaceSessionStorageKey, clearDebugEntries, clearPersistedWorkspaceSession, formatDateTime, getDebugEntries, isDebugPanelEnabled, isLikelyNetworkError, isLocalWorkspaceOrigin, isOnline, loadPersistedWorkspaceSession, logDebug, normalizeSpeakerAliases, normalizeText, normalizeTextBlock, parseParams, pickRecorderMimeType, persistWorkspaceSessionPayload, postJson, resolveConfig, resolveRecordingProfile, safeLocalStorageGet, safeLocalStorageSet, setEnabled: setDebugEnabled, stopTracks, subscribeDebugEntries, summarizeEntries } = ns.shared;
  const { clearWorkspaceAuthCache, ensureWorkspaceAuth, getCollections, subscribeDocument } = ns.firebase;
  const { prepareAudioSourceChunks } = ns.audioChunker;
  const { DEBUG_SCENARIOS: PENDING_UPLOAD_DEBUG_SCENARIOS, blobToBase64, collapseSupersededPendingUploads, createPendingUploadStore, normalizePendingUpload } = ns.storage;
  const { buildDetailView, buildLocalPendingJob, buildPendingNotice, buildPendingSummary, buildSegmentCopyText, chooseSelectedRecordId, findHistoryEntry, findRemoteForPending, normalizeArtifact, normalizeJob, normalizeRecord, renderWorkspace } = ns.render;
  const debugConsole = ns.debugConsole;

  const CONFIG = resolveConfig(global.__INOVA_HOSTED_MEETING_CONFIG__);
  const FIRESTORE_COLLECTIONS = getCollections();
  const DEBUG_PANEL_COLLAPSED_STORAGE_KEY = "__INOVA_MEETING_DEBUG_PANEL_COLLAPSED__";
  const DEBUG_LOCAL_QUEUE_SANDBOX_PARAM = "debugQueueSandbox";
  const SUPERSEDED_REMOTE_JOBS_STORAGE_KEY_PREFIX = "__INOVA_MEETING_SUPERSEDED_REMOTE_JOBS__";
  const BOOT_INITIAL_SNAPSHOT_WAIT_MS = 450;
  const DEGRADED_NOTICE_CODES = Object.freeze({
    pendingUploadCleanup: "pending-upload-cleanup-degraded",
    pendingUploadPersist: "pending-upload-persist-degraded",
    pendingUploads: "pending-uploads-degraded",
    refresh: "refresh-degraded",
    sessionPersist: "session-persist-degraded",
    sessionRestore: "session-restore-degraded",
  });
  const DEGRADED_NOTICE_SPECS = Object.freeze({
    [DEGRADED_NOTICE_CODES.refresh]: Object.freeze({ priority: 60 }),
    [DEGRADED_NOTICE_CODES.sessionRestore]: Object.freeze({ priority: 50 }),
    [DEGRADED_NOTICE_CODES.sessionPersist]: Object.freeze({ priority: 40 }),
    [DEGRADED_NOTICE_CODES.pendingUploads]: Object.freeze({ priority: 30 }),
    [DEGRADED_NOTICE_CODES.pendingUploadPersist]: Object.freeze({ priority: 20 }),
    [DEGRADED_NOTICE_CODES.pendingUploadCleanup]: Object.freeze({ priority: 10 }),
  });
  const PENDING_UPLOAD_QUEUE_OPERATION_SCOPES = Object.freeze({
    cleanup: "cleanup",
    load: "load",
    persist: "persist",
  });
  const refs = {};
  const state = createInitialState();

  global.document.addEventListener("DOMContentLoaded", bootstrap);

  function createIdleCapture(recordingProfile) {
    return {
      audioBitsPerSecond: Math.max(0, Number(recordingProfile?.audioBitsPerSecond) || 0),
      channelCount: 1,
      durationMs: 0,
      endedAt: "",
      error: "",
      maxDurationMs: Math.max(0, Number(recordingProfile?.maxDurationMs) || 0),
      mimeType: "",
      requestId: "",
      sizeBytes: 0,
      startedAt: "",
      status: "idle",
    };
  }

  function createEmptyMediaState() {
    return {
      accumulatedDurationMs: 0,
      audioStream: null,
      autoStopPending: false,
      chunkTimer: 0,
      chunks: [],
      recordedBlob: null,
      recorder: null,
      resumeStartedAtMs: 0,
      stopContext: null,
      stopResolver: null,
    };
  }

  function createEmptyNotice() {
    return { code: "", sticky: false, text: "", tone: "" };
  }

  function createInitialState() {
    const recordingProfile = resolveRecordingProfile(global);
    return {
      blocked: false,
      blockedEyebrow: "회의 작업실",
      blockedTitle: "이 작업실은 패널에서 다시 열어야 합니다",
      blockedTone: "blocked",
      blockedMessage: "",
      busy: { deleteMeeting: false, deleteRecord: false, queue: Object.create(null), regenerateNotes: false, saveMeetingMemo: false, saveMeetingTitle: false, saveRecordTitle: false, saveSpeakerAliases: false },
      capture: createIdleCapture(recordingProfile),
      confirmation: { body: "", confirmLabel: "확인", eyebrow: "확인", open: false, resolve: null, title: "", tone: "danger" },
      currentArtifact: null,
      currentDetailSelectionId: "",
      currentJob: null,
      currentLocalRecord: null,
      debugLocalQueueSandbox: false,
      debugNotice: createEmptyNotice(),
      debugNoticeTimer: 0,
      degradedNotices: Object.create(null),
      debugPanelCollapsed: readDebugPanelCollapsed(),
      isLocalWorkspace: isLocalWorkspaceOrigin(global),
      loading: false,
      loadingReason: "",
      meetingTitleDraft: "",
      media: createEmptyMediaState(),
      meeting: { meetingId: "", pendingLocalCount: 0, sharedMemo: "", title: "", updatedAt: "" },
      mode: "create",
      notice: createEmptyNotice(),
      noticeTimer: 0,
      params: parseParams(global.location.href),
      pendingUploads: [],
      pendingUploadStorage: {
        degradedReason: "",
        issueCodes: [],
      },
      pendingUploadPersist: {
        degradedReason: "",
        issueCodes: [],
      },
      pendingUploadCleanup: {
        degradedReason: "",
        issueCodes: [],
      },
      notesStyleSelection: "",
      queueStore: createPendingUploadStore(global),
      recordMemoDraft: "",
      recordMemoSaved: "",
      recordingProfile,
      records: [],
      reviewTab: "notes",
      realtime: {
        artifactDocId: "",
        artifactListenerVersion: 0,
        jobDocId: "",
        jobListenerVersion: 0,
        meetingDocId: "",
        meetingListenerVersion: 0,
        unsubscribeArtifact: null,
        unsubscribeJob: null,
        unsubscribeMeeting: null,
        workspaceAuthExpiresAt: "",
        workspaceSessionId: "",
      },
      sessionRestore: {
        degradedReason: "",
        hasBlockingIssue: false,
        hasWarningIssue: false,
        issueCodes: [],
        source: "",
      },
      sessionPersist: {
        degradedReason: "",
        issueCodes: [],
      },
      runtimeChunkCache: Object.create(null),
      selectedRecordId: "",
      session: { expiresAt: "", meetingId: "", meetingSessionToken: "", mode: "create", sharedMemo: "", title: "" },
      speakerAliasDraftRecordId: "",
      speakerAliasDrafts: Object.create(null),
      supersededRemoteJobIds: [],
      unsubscribeDebug: null,
    };
  }

  function readDebugPanelCollapsed() {
    return normalizeText(safeLocalStorageGet(global, DEBUG_PANEL_COLLAPSED_STORAGE_KEY)) === "1";
  }

  function cacheRefs() {
    for (const id of ["meetingShell", "blockedMessage", "blockedEyebrow", "blockedTitle", "blockedState", "workspace", "pageTitle", "pageSummary", "workspaceBadge", "offlineQueueBadge", "refreshButton", "meetingTitleInput", "saveMeetingTitleButton", "deleteMeetingButton", "meetingStatusChip", "currentBadge", "currentSummary", "currentHint", "currentNotice", "currentTimer", "startButton", "importAudioButton", "importAudioInput", "pauseButton", "resumeButton", "stopButton", "discardButton", "sharedMemoInput", "saveSharedMemoButton", "clearSharedMemoButton", "sharedMemoNotice", "recordCountBadge", "recordList", "detailTitle", "detailBadge", "detailSummary", "recordTitleGroup", "recordTitleInput", "saveRecordTitleButton", "downloadRecordButton", "deleteRecordButton", "detailMeta", "speakerEditor", "speakerAliasList", "saveSpeakerAliasesButton", "saveSpeakerAliasesAndRegenerateButton", "copySegmentsButton", "detailMemoText", "reviewTabSummary", "reviewTabMemo", "reviewTabNotes", "reviewTabSegments", "reviewTabSegmentsCount", "reviewTabSpeakers", "reviewPanelSummary", "summaryStatusPill", "summaryStatusGrid", "summaryActionCard", "reviewPanelMemo", "meetingNotesCard", "reviewPanelSegments", "reviewPanelSpeakers", "speakerDigestList", "notesSummaryMeta", "notesStyleSelect", "regenerateNotesButton", "meetingNotesOverview", "meetingNotesSections", "detailNotice", "segmentList", "debugPanel", "confirmOverlay", "confirmDialog", "confirmDialogEyebrow", "confirmDialogTitle", "confirmDialogBody", "confirmDialogCancel", "confirmDialogConfirm"]) {
      refs[id] = global.document.getElementById(id);
    }
  }

  function bindEvents() {
    refs.refreshButton.addEventListener("click", () => refreshWorkspace(false, "manual"));
    refs.meetingTitleInput.addEventListener("input", () => updateMeetingTitleDraft(refs.meetingTitleInput.value));
    refs.meetingTitleInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      if (!refs.saveMeetingTitleButton.disabled) {
        saveMeetingTitle();
      }
    });
    refs.recordTitleInput.addEventListener("input", applyRender);
    refs.recordTitleInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      if (!refs.saveRecordTitleButton.disabled) {
        saveCurrentRecordTitle();
      }
    });
    refs.sharedMemoInput.addEventListener("input", () => updateRecordMemoDraft(refs.sharedMemoInput.value));
    refs.saveMeetingTitleButton.addEventListener("click", saveMeetingTitle);
    refs.saveSharedMemoButton.addEventListener("click", saveSharedMemo);
    refs.clearSharedMemoButton.addEventListener("click", clearSharedMemo);
    refs.deleteMeetingButton.addEventListener("click", deleteMeeting);
    refs.notesStyleSelect.addEventListener("change", () => {
      state.notesStyleSelection = normalizeText(refs.notesStyleSelect.value);
      applyRender();
    });
    for (const tabId of ["reviewTabSummary", "reviewTabMemo", "reviewTabNotes", "reviewTabSegments", "reviewTabSpeakers"]) {
      const tab = refs[tabId];
      if (!tab) continue;
      tab.addEventListener("click", () => {
        state.reviewTab = normalizeText(tab.dataset.reviewTab) || "summary";
        applyRender();
      });
    }
    refs.startButton.addEventListener("click", startCapture);
    refs.importAudioButton?.addEventListener("click", openImportAudioPicker);
    refs.importAudioInput?.addEventListener("change", handleImportAudioSelection);
    refs.pauseButton.addEventListener("click", pauseCapture);
    refs.resumeButton.addEventListener("click", resumeCapture);
    refs.stopButton.addEventListener("click", stopCapture);
    refs.discardButton.addEventListener("click", discardCapture);
    refs.recordList.addEventListener("click", handleRecordListClick);
    refs.saveRecordTitleButton.addEventListener("click", saveCurrentRecordTitle);
    refs.downloadRecordButton.addEventListener("click", downloadCurrentRecord);
    refs.deleteRecordButton.addEventListener("click", () => deleteCurrentRecord());
    refs.speakerAliasList?.addEventListener("input", handleSpeakerAliasInput);
    refs.saveSpeakerAliasesButton?.addEventListener("click", () => saveSpeakerAliases());
    refs.saveSpeakerAliasesAndRegenerateButton?.addEventListener("click", () => saveSpeakerAliases({ regenerateAfterSave: true }));
    refs.copySegmentsButton?.addEventListener("click", copySegmentsText);
    refs.regenerateNotesButton.addEventListener("click", regenerateNotes);
    refs.debugPanel?.addEventListener("click", handleDebugPanelClick);
    refs.confirmDialogCancel?.addEventListener("click", () => resolveConfirmation(false));
    refs.confirmDialogConfirm?.addEventListener("click", () => resolveConfirmation(true));
    refs.confirmOverlay?.addEventListener("click", (event) => {
      if (event.target === refs.confirmOverlay) {
        resolveConfirmation(false);
      }
    });
    global.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.confirmation.open) {
        event.preventDefault();
        resolveConfirmation(false);
      }
    });
    global.addEventListener("focus", handleBackgroundRefresh, { passive: true });
    global.document.addEventListener("visibilitychange", () => {
      if (global.document.hidden) {
        logDebug("workspace.refresh.skipped", {
          reason: "document-hidden",
        });
        return;
      }
      handleBackgroundRefresh();
    }, { passive: true });
    global.addEventListener("online", handleOnline, { passive: true });
    global.addEventListener("offline", handleOffline, { passive: true });
    global.addEventListener("beforeunload", disposeWorkspaceRealtime, { passive: true });
  }

  function handleDebugPanelClick(event) {
    const action = normalizeText(event.target?.closest?.("[data-debug-action]")?.dataset?.debugAction);
    if (!action) {
      return;
    }
    if (action === "copy") {
      void copyDebugLog();
      return;
    }
    if (action === "copy-errors") {
      void copyDebugErrors();
      return;
    }
    if (action === "clear") {
      clearDebugLogPanel();
      return;
    }
    if (action === "toggle") {
      toggleDebugPanelCollapsed();
    }
  }

  async function bootstrap() {
    cacheRefs();
    bindEvents();
    setupDebugPanel();
    syncWorkspaceDebugApi();
    logDebug("workspace.recording.profile", state.recordingProfile);
    logDebug("workspace.bootstrap", {
      href: global.location.href,
      params: state.params,
    });
    await bootWorkspace();
  }

  function hasSessionRestoreBlockingIssue(issueCodes) {
    const normalizedCodes = Array.isArray(issueCodes) ? issueCodes : [];
    return normalizedCodes.some((code) => ["storage-invalid-payload", "storage-parse-failed", "storage-read-failed"].includes(normalizeText(code)));
  }

  function hasSessionRestoreWarningIssue(issueCodes) {
    const normalizedCodes = Array.isArray(issueCodes) ? issueCodes : [];
    return normalizedCodes.some((code) => ["storage-invalid-payload", "storage-parse-failed", "storage-read-failed", "storage-write-failed"].includes(normalizeText(code)));
  }

  function buildMissingSessionBlockedOptions() {
    if (!state.sessionRestore.hasBlockingIssue) {
      return {
        message: "직접 주소를 붙여 넣어 열면 회의 세션을 확인할 수 없습니다. i-Nova 패널의 회의 허브에서 다시 열어 주세요.",
      };
    }
    return {
      eyebrow: "세션 복원 실패",
      message: `${state.sessionRestore.degradedReason || "브라우저 저장소에서 작업실 세션을 다시 읽지 못했어요."} i-Nova 패널의 회의 허브에서 작업실을 다시 열어 새 세션을 받아 주세요.`,
      title: "저장된 작업실 세션을 다시 읽지 못했습니다",
      tone: "warning",
    };
  }

  function buildSessionRestoreDegradedNotice() {
    const reason = normalizeText(state.sessionRestore.degradedReason) || "브라우저 저장소에 작업실 세션을 다시 저장하거나 읽는 중 문제가 있었습니다.";
    return `${reason} 현재 작업실은 계속 사용할 수 있지만, 다음 새로고침이나 재진입에서 세션 복원이 제한될 수 있습니다.`;
  }

  function isDebugLocalQueueSandboxRequested() {
    if (!state.isLocalWorkspace || !isDebugPanelEnabled(global)) {
      return false;
    }
    try {
      const currentUrl = new URL(global.location.href);
      return normalizeText(currentUrl.searchParams.get(DEBUG_LOCAL_QUEUE_SANDBOX_PARAM)) === "1";
    } catch {
      return false;
    }
  }

  function activateDebugLocalQueueSandbox() {
    const meetingId = normalizeText(state.params.meetingId) || "debug-local-queue";
    state.debugLocalQueueSandbox = true;
    state.mode = "create";
    state.session = {
      expiresAt: "",
      meetingId,
      meetingSessionToken: "__debug-local-queue__",
      mode: "create",
      sharedMemo: "",
      title: "로컬 queue sandbox",
    };
    state.meeting = {
      meetingId,
      pendingLocalCount: 0,
      sharedMemo: "",
      title: state.session.title,
      updatedAt: "",
    };
    state.selectedRecordId = "";
    logDebug("workspace.debug.local-queue-sandbox", {
      meetingId,
      requested: true,
    });
  }

  function buildSessionPersistDegradedNotice(reason) {
    const normalizedReason = normalizeText(reason) || "브라우저 저장소에 작업실 세션을 저장하지 못했어요.";
    return `${normalizedReason} 현재 탭에서는 작업을 계속할 수 있지만, 다음 새로고침이나 재진입에서는 최신 작업실 상태가 복원되지 않을 수 있습니다.`;
  }

  function buildPendingUploadStorageDegradedNotice(reason) {
    const normalizedReason = normalizeText(reason) || "브라우저 로컬 보관 큐를 완전하게 읽지 못했어요.";
    return `${normalizedReason} 일부 임시 녹음이나 업로드 대기 상태가 화면에 아직 반영되지 않았을 수 있습니다.`;
  }

  function buildPendingUploadPersistDegradedNotice(reason) {
    const normalizedReason = normalizeText(reason) || "브라우저 로컬 보관 큐를 저장하지 못했어요.";
    return `${normalizedReason} 현재 탭에서는 계속 진행하지만, 다음 새로고침 뒤에는 방금 바뀐 임시 녹음 상태가 다시 복원되지 않을 수 있습니다.`;
  }

  function buildPendingUploadCleanupDegradedNotice(reason) {
    const normalizedReason = normalizeText(reason) || "브라우저 로컬 보관 큐를 정리하지 못했어요.";
    return `${normalizedReason} 삭제했거나 비운 임시 녹음이 다음 새로고침 뒤 다시 보일 수 있습니다.`;
  }

  function buildPendingUploadLoadPhaseDegradedNotice(context = {}, reason) {
    const normalizedContext = normalizePendingUploadQueueContext(context);
    const normalizedReason = normalizeText(reason);
    if (normalizedContext.phase === "load-pending-uploads") {
      return `${normalizedReason || "브라우저에 남아 있던 로컬 업로드 대기 기록을 완전하게 읽지 못했어요."} 작업실은 계속 열리지만, 일부 임시 녹음이나 업로드 대기 상태는 이번 진입에서 빠져 있을 수 있습니다.`;
    }
    return buildPendingUploadStorageDegradedNotice(normalizedReason);
  }

  function buildPendingUploadPersistPhaseDegradedNotice(context = {}, reason) {
    const normalizedContext = normalizePendingUploadQueueContext(context);
    const normalizedReason = normalizeText(reason);
    if (normalizedContext.phase === "transition-start") {
      return `${normalizedReason || "재시작할 로컬 원본 상태를 브라우저에 보관하지 못했어요."} 현재 탭에서는 이전 원본을 유지하지만, 다시 시작 준비 상태가 다음 새로고침 뒤 다시 보이지 않을 수 있습니다.`;
    }
    if (["import-save", "capture-save", "capture-save-continue", "offline-queued"].includes(normalizedContext.phase)) {
      return `${normalizedReason || "새 로컬 원본 상태를 브라우저에 보관하지 못했어요."} 지금 탭에서는 계속 진행하지만, 다음 새로고침 뒤에는 방금 가져오거나 녹음한 원본이 다시 보이지 않을 수 있습니다.`;
    }
    if (["chunk-prepare", "chunk-uploading", "chunk-part-uploaded", "single-uploading", "single-uploaded", "single-inline-fallback"].includes(normalizedContext.phase)) {
      return `${normalizedReason || "업로드 진행 상태를 브라우저에 보관하지 못했어요."} 지금 탭에서는 처리를 이어가지만, 다음 새로고침 뒤에는 진행 상태가 일부 뒤로 보일 수 있습니다.`;
    }
    if (["chunk-remote-job-start", "chunk-remote-job-refresh", "chunk-remote-job-resync", "single-remote-job-start"].includes(normalizedContext.phase)) {
      return `${normalizedReason || "원격 전사 작업 연결 상태를 브라우저에 보관하지 못했어요."} 지금 탭에서는 결과를 계속 확인하지만, 다음 새로고침 뒤에는 원격 작업 연결 상태가 잠시 비어 보일 수 있습니다.`;
    }
    if (["remote-sync-succeeded", "remote-sync-update", "remote-sync-reset"].includes(normalizedContext.phase)) {
      return `${normalizedReason || "원격 동기화 결과를 브라우저 로컬 큐에 반영하지 못했어요."} 다음 새로고침 뒤에는 최신 원격 처리 상태가 잠시 이전 값으로 보일 수 있습니다.`;
    }
    if (normalizedContext.phase === "failure-state") {
      return `${normalizedReason || "업로드 실패 상태를 브라우저에 보관하지 못했어요."} 다음 새로고침 뒤에는 방금 실패 이유가 다시 보이지 않을 수 있습니다.`;
    }
    if (normalizedContext.phase === "record-title") {
      return `${normalizedReason || "기록 이름 변경을 브라우저 로컬 큐에 보관하지 못했어요."} 다음 새로고침 뒤에는 방금 바꾼 로컬 기록 이름이 이전 값으로 다시 보일 수 있습니다.`;
    }
    if (normalizedContext.phase === "manual-hold") {
      return `${normalizedReason || "보류 상태를 브라우저에 보관하지 못했어요."} 다음 새로고침 뒤에는 방금 멈춘 업로드가 다시 대기 상태로 보일 수 있습니다.`;
    }
    if (normalizedContext.phase === "manual-resume-state") {
      return `${normalizedReason || "재개 상태를 브라우저에 보관하지 못했어요."} 다음 새로고침 뒤에는 방금 다시 시작한 업로드가 이전 상태로 보일 수 있습니다.`;
    }
    return buildPendingUploadPersistDegradedNotice(normalizedReason);
  }

  function buildPendingUploadCleanupPhaseDegradedNotice(context = {}, reason) {
    const normalizedContext = normalizePendingUploadQueueContext(context);
    const normalizedReason = normalizeText(reason);
    if (normalizedContext.phase === "manual-delete") {
      return `${normalizedReason || "로컬 기록을 브라우저 보관함에서 정리하지 못했어요."} 방금 지운 로컬 기록이 다음 새로고침 뒤 다시 보일 수 있습니다.`;
    }
    if (normalizedContext.phase === "record-delete") {
      return `${normalizedReason || "선택한 기록의 로컬 원본을 정리하지 못했어요."} 기록 삭제 후에도 브라우저 원본이 다음 새로고침 뒤 다시 보일 수 있습니다.`;
    }
    if (normalizedContext.phase === "workspace-delete") {
      return `${normalizedReason || "작업실에 남은 로컬 원본을 정리하지 못했어요."} 작업실 삭제 후에도 일부 브라우저 원본이 다음 새로고침 뒤 다시 보일 수 있습니다.`;
    }
    return buildPendingUploadCleanupDegradedNotice(normalizedReason);
  }

  function buildPendingUploadQueueOperationFailureMessage(scope, diagnostics, error, context = {}) {
    const normalizedScope = normalizeText(scope);
    const fallbackReason = normalizeText(diagnostics?.degradedReason) || (error instanceof Error ? error.message : "");
    if (normalizedScope === PENDING_UPLOAD_QUEUE_OPERATION_SCOPES.persist) {
      return buildPendingUploadPersistPhaseDegradedNotice(context, fallbackReason);
    }
    if (normalizedScope === PENDING_UPLOAD_QUEUE_OPERATION_SCOPES.cleanup) {
      return buildPendingUploadCleanupPhaseDegradedNotice(context, fallbackReason);
    }
    return buildPendingUploadLoadPhaseDegradedNotice(context, fallbackReason);
  }

  function normalizePendingUploadQueueContext(context = {}) {
    const nextContext = {};
    const requestId = normalizeText(context?.requestId);
    const previousRequestId = normalizeText(context?.previousRequestId);
    const reason = normalizeText(context?.reason);
    const phase = normalizeText(context?.phase);
    if (requestId) nextContext.requestId = requestId;
    if (previousRequestId) nextContext.previousRequestId = previousRequestId;
    if (reason) nextContext.reason = reason;
    if (phase) nextContext.phase = phase;
    if (Object.prototype.hasOwnProperty.call(context || {}, "shouldResetSource")) {
      nextContext.shouldResetSource = Boolean(context.shouldResetSource);
    }
    return nextContext;
  }

  function buildPendingUploadQueueOperationError(scope, diagnostics, error, context = {}) {
    const message = buildPendingUploadQueueOperationFailureMessage(scope, diagnostics, error, context);
    if (!normalizeText(message)) {
      return error instanceof Error ? error : new Error("브라우저 로컬 보관 큐 작업을 완료하지 못했어요.");
    }
    const normalizedContext = normalizePendingUploadQueueContext(context);
    const nextError = new Error(message);
    nextError.pendingUploadQueueDegradedReason = normalizeText(diagnostics?.degradedReason);
    nextError.pendingUploadQueueContext = normalizedContext;
    nextError.pendingUploadQueueNoticeShown = false;
    nextError.pendingUploadQueueOperation = normalizeText(diagnostics?.operation);
    nextError.pendingUploadQueueOperationError = true;
    nextError.pendingUploadQueueScope = normalizeText(scope);
    if (error instanceof Error) {
      nextError.stack = error.stack;
      nextError.cause = error;
    }
    return nextError;
  }

  function showPendingUploadQueueOperationError(error, fallbackMessage) {
    const message = normalizeText(error?.message) || normalizeText(fallbackMessage);
    if (!message || error?.pendingUploadQueueNoticeShown) {
      return;
    }
    setNotice(message, "error");
    if (error && typeof error === "object") {
      error.pendingUploadQueueNoticeShown = true;
    }
    applyRender();
  }

  function buildNoticeState(text, tone, options = {}) {
    const nextText = normalizeText(text);
    const nextTone = normalizeText(tone);
    return {
      code: normalizeText(options?.code),
      sticky: Boolean(options?.sticky || nextTone === "error"),
      text: nextText,
      tone: nextTone,
    };
  }

  function isDegradedNoticeCode(code) {
    const normalizedCode = normalizeText(code);
    return Boolean(normalizedCode) && Object.prototype.hasOwnProperty.call(DEGRADED_NOTICE_SPECS, normalizedCode);
  }

  function getDegradedNoticePriority(code) {
    const normalizedCode = normalizeText(code);
    return Number(DEGRADED_NOTICE_SPECS[normalizedCode]?.priority) || 0;
  }

  function getHighestPriorityDegradedNotice() {
    const degradedEntries = Object.values(state.degradedNotices || {})
      .filter((entry) => normalizeText(entry?.text) && isDegradedNoticeCode(entry?.code))
      .sort((left, right) => {
        const priorityGap = getDegradedNoticePriority(right?.code) - getDegradedNoticePriority(left?.code);
        if (priorityGap !== 0) return priorityGap;
        return normalizeText(left?.code).localeCompare(normalizeText(right?.code));
      });
    return degradedEntries[0] ? { ...degradedEntries[0] } : null;
  }

  function syncNoticeFromDegradedRegistry() {
    const currentCode = normalizeText(state.notice.code);
    const currentIsDegraded = isDegradedNoticeCode(currentCode);
    const activeDegradedNotice = getHighestPriorityDegradedNotice();
    if (!activeDegradedNotice) {
      if (currentIsDegraded) {
        state.notice = createEmptyNotice();
      }
      return;
    }
    if (!normalizeText(state.notice.text) || currentIsDegraded) {
      state.notice = activeDegradedNotice;
    }
  }

  function setDegradedNotice(code, text, tone = "warning") {
    const normalizedCode = normalizeText(code);
    if (!normalizedCode) return;
    const nextNotice = buildNoticeState(text, tone, {
      code: normalizedCode,
      sticky: true,
    });
    if (!normalizeText(nextNotice.text)) {
      clearDegradedNotice(normalizedCode);
      return;
    }
    state.degradedNotices[normalizedCode] = nextNotice;
    syncNoticeFromDegradedRegistry();
  }

  function clearDegradedNotice(code) {
    const normalizedCode = normalizeText(code);
    if (!normalizedCode) return;
    delete state.degradedNotices[normalizedCode];
    syncNoticeFromDegradedRegistry();
  }

  function normalizeDegradedDiagnosticsResult(result) {
    const issues = Array.isArray(result?.issues) ? result.issues : [];
    return {
      degradedReason: normalizeText(result?.degradedReason),
      issueCodes: issues.map((issue) => normalizeText(issue?.code)).filter(Boolean),
      issues,
      operation: normalizeText(result?.operation),
    };
  }

  function buildDegradedDiagnosticsSignature(entry) {
    return [
      normalizeText(entry?.degradedReason),
      ...(Array.isArray(entry?.issueCodes) ? entry.issueCodes : []),
    ]
      .filter(Boolean)
      .join("|");
  }

  function applyDegradedDiagnostics(stateKey, result, options) {
    const normalized = normalizeDegradedDiagnosticsResult(result);
    const previousSignature = buildDegradedDiagnosticsSignature(state[stateKey]);
    const nextSignature = buildDegradedDiagnosticsSignature(normalized);
    state[stateKey] = {
      degradedReason: normalized.degradedReason,
      issueCodes: normalized.issueCodes,
    };
    if (!normalized.degradedReason) {
      if (previousSignature) {
        logDebug(options.recoveredEvent, {
          meetingId: state.session.meetingId,
        });
      }
      clearDegradedNotice(options.noticeCode);
      return;
    }
    if (previousSignature === nextSignature) {
      return;
    }
    logDebug(options.degradedEvent, {
      degradedReason: normalized.degradedReason,
      issueCodes: normalized.issueCodes,
      issues: normalized.issues,
      meetingId: state.session.meetingId,
      ...(typeof options.getLogDetails === "function" ? options.getLogDetails(normalized) : {}),
    });
    setDegradedNotice(options.noticeCode, options.buildNotice(normalized.degradedReason, normalized), "warning");
  }

  function surfaceSessionRestoreNotice() {
    if (!state.sessionRestore.hasWarningIssue || !state.session.meetingSessionToken || !state.session.meetingId) {
      return;
    }
    setDegradedNotice(DEGRADED_NOTICE_CODES.sessionRestore, buildSessionRestoreDegradedNotice(), "warning");
  }

  function applyPersistWorkspaceSessionResult(result) {
    applyDegradedDiagnostics("sessionPersist", result, {
      buildNotice: (degradedReason) => buildSessionPersistDegradedNotice(degradedReason),
      degradedEvent: "workspace.session.persist.degraded",
      noticeCode: DEGRADED_NOTICE_CODES.sessionPersist,
      recoveredEvent: "workspace.session.persist.recovered",
    });
  }

  function applyPendingUploadStorageDiagnostics(result, context = {}) {
    const normalizedContext = normalizePendingUploadQueueContext(context);
    applyDegradedDiagnostics("pendingUploadStorage", result, {
      buildNotice: (degradedReason) => buildPendingUploadStorageDegradedNotice(degradedReason),
      degradedEvent: "workspace.pending-uploads.storage.degraded",
      getLogDetails: (normalized) => ({
        operation: normalized.operation,
        ...normalizedContext,
      }),
      noticeCode: DEGRADED_NOTICE_CODES.pendingUploads,
      recoveredEvent: "workspace.pending-uploads.storage.recovered",
    });
  }

  function applyPendingUploadPersistDiagnostics(result, context = {}) {
    const normalizedContext = normalizePendingUploadQueueContext(context);
    applyDegradedDiagnostics("pendingUploadPersist", result, {
      buildNotice: (degradedReason) => buildPendingUploadPersistDegradedNotice(degradedReason),
      degradedEvent: "workspace.pending-uploads.persist.degraded",
      getLogDetails: (normalized) => ({
        operation: normalized.operation,
        ...normalizedContext,
      }),
      noticeCode: DEGRADED_NOTICE_CODES.pendingUploadPersist,
      recoveredEvent: "workspace.pending-uploads.persist.recovered",
    });
  }

  function applyPendingUploadCleanupDiagnostics(result, context = {}) {
    const normalizedContext = normalizePendingUploadQueueContext(context);
    applyDegradedDiagnostics("pendingUploadCleanup", result, {
      buildNotice: (degradedReason) => buildPendingUploadCleanupDegradedNotice(degradedReason),
      degradedEvent: "workspace.pending-uploads.cleanup.degraded",
      getLogDetails: (normalized) => ({
        operation: normalized.operation,
        ...normalizedContext,
      }),
      noticeCode: DEGRADED_NOTICE_CODES.pendingUploadCleanup,
      recoveredEvent: "workspace.pending-uploads.cleanup.recovered",
    });
  }

  function cloneNoticeSnapshot(notice) {
    return {
      code: normalizeText(notice?.code),
      sticky: Boolean(notice?.sticky),
      text: normalizeText(notice?.text),
      tone: normalizeText(notice?.tone),
    };
  }

  function cloneDegradedDiagnosticsSnapshot(entry) {
    return {
      degradedReason: normalizeText(entry?.degradedReason),
      issueCodes: (Array.isArray(entry?.issueCodes) ? entry.issueCodes : []).map((code) => normalizeText(code)).filter(Boolean),
    };
  }

  function buildDegradedNoticeRegistrySnapshot() {
    const snapshot = {};
    for (const [code, notice] of Object.entries(state.degradedNotices || {})) {
      const normalizedCode = normalizeText(code);
      if (!normalizedCode) continue;
      snapshot[normalizedCode] = cloneNoticeSnapshot(notice);
    }
    return snapshot;
  }

  function buildPendingUploadSnapshotItem(item) {
    return {
      hold: Boolean(item?.hold),
      jobId: normalizeText(item?.jobId),
      publishedPartCount: Math.max(0, Number(item?.publishedPartCount) || 0),
      preparedPartCount: Math.max(0, Number(item?.preparedPartCount) || 0),
      requestId: normalizeText(item?.requestId),
      sourceMode: normalizeText(item?.sourceMode),
      status: normalizeText(item?.status),
      supersededRequestIds: (Array.isArray(item?.supersededRequestIds) ? item.supersededRequestIds : []).map((requestId) => normalizeText(requestId)).filter(Boolean),
      updatedAt: normalizeText(item?.updatedAt),
      uploadedPartCount: Math.max(0, Number(item?.uploadedPartCount) || 0),
    };
  }

  function buildRecentPendingUploadEventSnapshot(limit = 12) {
    const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 12));
    return getDebugEntries()
      .filter((entry) => {
        const event = normalizeText(entry?.event);
        return event.startsWith("workspace.pending-upload") || event.startsWith("workspace.pending-uploads");
      })
      .slice(-normalizedLimit)
      .map((entry) => ({
        event: normalizeText(entry?.event),
        payload: entry?.payload && typeof entry.payload === "object" ? { ...entry.payload } : entry?.payload ?? null,
        timestamp: normalizeText(entry?.timestamp),
      }));
  }

  function buildPendingUploadQueueStateSnapshot(options = {}) {
    return {
      activeDegradedNotice: cloneNoticeSnapshot(getHighestPriorityDegradedNotice()),
      blocked: {
        message: normalizeText(state.blockedMessage),
        tone: normalizeText(state.blockedTone),
        value: Boolean(state.blocked),
      },
      debugLocalQueueSandbox: Boolean(state.debugLocalQueueSandbox),
      degradedNotices: buildDegradedNoticeRegistrySnapshot(),
      diagnostics: {
        cleanup: cloneDegradedDiagnosticsSnapshot(state.pendingUploadCleanup),
        load: cloneDegradedDiagnosticsSnapshot(state.pendingUploadStorage),
        persist: cloneDegradedDiagnosticsSnapshot(state.pendingUploadPersist),
      },
      meetingId: normalizeText(state.session.meetingId),
      notice: cloneNoticeSnapshot(state.notice),
      pendingLocalCount: Math.max(0, Number(state.meeting?.pendingLocalCount) || 0),
      pendingUploads: state.pendingUploads.map(buildPendingUploadSnapshotItem),
      recentQueueEvents: buildRecentPendingUploadEventSnapshot(options.limit),
      runtimeChunkCacheKeys: Object.keys(state.runtimeChunkCache || {}).map((key) => normalizeText(key)).filter(Boolean).sort(),
      selectedRecordId: normalizeText(state.selectedRecordId),
    };
  }

  function findPendingUploadDebugScenario(name) {
    const normalizedName = normalizeText(name);
    if (!normalizedName) return null;
    return Object.values(PENDING_UPLOAD_DEBUG_SCENARIOS || {}).find((scenario) => (
      normalizeText(scenario?.key) === normalizedName
      || normalizeText(scenario?.fault) === normalizedName
    )) || null;
  }

  function hasPendingUploadQueueEvent(snapshot, eventName) {
    const normalizedEventName = normalizeText(eventName);
    return (Array.isArray(snapshot?.recentQueueEvents) ? snapshot.recentQueueEvents : [])
      .some((entry) => normalizeText(entry?.event) === normalizedEventName);
  }

  function buildPendingUploadQueueValidationChecks(scenario, snapshot) {
    const checks = [];
    const scenarioKey = normalizeText(scenario?.key);
    const noticeCode = normalizeText(snapshot?.activeDegradedNotice?.code);
    const noticeTone = normalizeText(snapshot?.notice?.tone);
    const degradedNotices = snapshot?.degradedNotices && typeof snapshot.degradedNotices === "object"
      ? snapshot.degradedNotices
      : {};
    if (scenarioKey.startsWith("queue-load-")) {
      checks.push(
        {
          label: "작업실이 blocked로 끝나지 않음",
          passed: !Boolean(snapshot?.blocked?.value),
          actual: snapshot?.blocked?.value ? normalizeText(snapshot?.blocked?.message) : "open",
        },
        {
          label: "load diagnostics가 degraded reason을 가짐",
          passed: Boolean(normalizeText(snapshot?.diagnostics?.load?.degradedReason)),
          actual: normalizeText(snapshot?.diagnostics?.load?.degradedReason),
        },
        {
          label: "load degraded notice가 registry에 남음",
          passed: Boolean(normalizeText(degradedNotices[DEGRADED_NOTICE_CODES.pendingUploads]?.text)),
          actual: normalizeText(degradedNotices[DEGRADED_NOTICE_CODES.pendingUploads]?.text),
        },
        {
          label: "load degraded debug event가 최근 로그에 남음",
          passed: hasPendingUploadQueueEvent(snapshot, "workspace.pending-uploads.load.degraded"),
          actual: hasPendingUploadQueueEvent(snapshot, "workspace.pending-uploads.load.degraded")
            ? "workspace.pending-uploads.load.degraded"
            : "",
        }
      );
      return checks;
    }
    if (scenarioKey.startsWith("queue-persist-")) {
      checks.push(
        {
          label: "persist diagnostics가 degraded reason을 가짐",
          passed: Boolean(normalizeText(snapshot?.diagnostics?.persist?.degradedReason)),
          actual: normalizeText(snapshot?.diagnostics?.persist?.degradedReason),
        },
        {
          label: "persist degraded notice가 registry에 남음",
          passed: Boolean(normalizeText(degradedNotices[DEGRADED_NOTICE_CODES.pendingUploadPersist]?.text)),
          actual: normalizeText(degradedNotices[DEGRADED_NOTICE_CODES.pendingUploadPersist]?.text),
        },
        {
          label: "사용자 notice가 error tone으로 보임",
          passed: noticeTone === "error",
          actual: `${noticeTone || "none"}:${normalizeText(snapshot?.notice?.text)}`,
        },
        {
          label: "persist degraded debug event가 최근 로그에 남음",
          passed: hasPendingUploadQueueEvent(snapshot, "workspace.pending-uploads.persist.degraded"),
          actual: hasPendingUploadQueueEvent(snapshot, "workspace.pending-uploads.persist.degraded")
            ? "workspace.pending-uploads.persist.degraded"
            : "",
        }
      );
      return checks;
    }
    if (scenarioKey.startsWith("queue-cleanup-")) {
      checks.push(
        {
          label: "cleanup diagnostics가 degraded reason을 가짐",
          passed: Boolean(normalizeText(snapshot?.diagnostics?.cleanup?.degradedReason)),
          actual: normalizeText(snapshot?.diagnostics?.cleanup?.degradedReason),
        },
        {
          label: "cleanup degraded notice가 registry에 남음",
          passed: Boolean(normalizeText(degradedNotices[DEGRADED_NOTICE_CODES.pendingUploadCleanup]?.text)),
          actual: normalizeText(degradedNotices[DEGRADED_NOTICE_CODES.pendingUploadCleanup]?.text),
        },
        {
          label: "사용자 notice가 error tone으로 보임",
          passed: noticeTone === "error",
          actual: `${noticeTone || "none"}:${normalizeText(snapshot?.notice?.text)}`,
        },
        {
          label: "cleanup degraded debug event가 최근 로그에 남음",
          passed: hasPendingUploadQueueEvent(snapshot, "workspace.pending-uploads.cleanup.degraded"),
          actual: hasPendingUploadQueueEvent(snapshot, "workspace.pending-uploads.cleanup.degraded")
            ? "workspace.pending-uploads.cleanup.degraded"
            : "",
        }
      );
      return checks;
    }
    checks.push({
      label: "active degraded notice가 있음",
      passed: Boolean(noticeCode),
      actual: noticeCode,
    });
    return checks;
  }

  function validatePendingUploadQueueScenario(name, options = {}) {
    const scenario = findPendingUploadDebugScenario(name);
    if (!scenario) {
      throw new Error(`알 수 없는 pending upload queue validation scenario: ${normalizeText(name) || "(empty)"}`);
    }
    const snapshot = buildPendingUploadQueueStateSnapshot(options);
    const checks = buildPendingUploadQueueValidationChecks(scenario, snapshot);
    return {
      checks,
      expectedFlow: normalizeText(scenario.expectedFlow),
      passed: checks.every((check) => Boolean(check?.passed)),
      scenario: normalizeText(scenario.key),
      snapshot,
      summary: normalizeText(scenario.summary),
      trigger: normalizeText(scenario.trigger),
    };
  }

  function buildHostedDebugConsoleButtonsSnapshot(panelElement) {
    const buttons = panelElement?.querySelectorAll?.("[data-debug-action]");
    return Array.from(buttons || []).map((button) => ({
      action: normalizeText(button?.dataset?.debugAction),
      disabled: Boolean(button?.disabled),
      id: normalizeText(button?.id),
      label: normalizeText(button?.textContent),
    }));
  }

  function buildHostedDebugConsoleStateSnapshot(entries = getDebugEntries()) {
    const normalizedEntries = Array.isArray(entries) ? entries : [];
    const panelElement = refs.debugPanel;
    const stateSnapshot = buildDebugPanelState(normalizedEntries);
    const buttons = buildHostedDebugConsoleButtonsSnapshot(panelElement);
    const statusElement = panelElement?.querySelector?.("#debugStatus");
    const noticeElement = panelElement?.querySelector?.("#debugNotice");
    const logElement = panelElement?.querySelector?.("#debugLog");
    return {
      buttons,
      collapsed: Boolean(stateSnapshot?.collapsed),
      enabled: Boolean(stateSnapshot?.enabled),
      entryCount: normalizedEntries.length,
      feedback: {
        text: normalizeText(stateSnapshot?.feedback?.text),
        tone: normalizeText(stateSnapshot?.feedback?.tone) || "info",
      },
      hasErrors: Boolean(stateSnapshot?.hasErrors),
      hasFabBadge: Boolean(panelElement?.querySelector?.("#debugFabBadge")),
      hasFabButton: Boolean(panelElement?.querySelector?.("#debugFabButton")),
      hasLog: Boolean(logElement),
      hasSegmentCluster: Boolean(panelElement?.querySelector?.(".segment-cluster")),
      hasToolbar: Boolean(panelElement?.querySelector?.(".debug-panel__toolbar")),
      logText: normalizeText(logElement?.textContent || stateSnapshot?.text),
      noticeText: normalizeText(noticeElement?.textContent || stateSnapshot?.feedback?.text),
      rendered: Boolean(panelElement && panelElement.innerHTML),
      statusText: normalizeText(statusElement?.textContent || stateSnapshot?.statusText),
    };
  }

  function buildHostedDebugConsoleValidationChecks(snapshot) {
    const checks = [
      {
        label: "hosted debug console이 활성화됨",
        passed: Boolean(snapshot?.enabled),
        actual: snapshot?.enabled ? "enabled" : "disabled",
      },
      {
        label: "debug console markup이 렌더됨",
        passed: Boolean(snapshot?.rendered),
        actual: snapshot?.rendered ? "rendered" : "empty",
      },
    ];
    const actions = Array.isArray(snapshot?.buttons)
      ? snapshot.buttons.map((button) => normalizeText(button?.action)).filter(Boolean)
      : [];
    if (snapshot?.collapsed) {
      checks.push(
        {
          label: "collapsed 상태에서는 fab toggle이 보임",
          passed: Boolean(snapshot?.hasFabButton) && actions.includes("toggle"),
          actual: actions.join(","),
        },
        {
          label: "오류가 있으면 fab badge가 보임",
          passed: !snapshot?.hasErrors || Boolean(snapshot?.hasFabBadge),
          actual: snapshot?.hasFabBadge ? "badge" : "no-badge",
        }
      );
      return checks;
    }
    const requiredActions = ["copy", "copy-errors", "clear", "toggle"];
    checks.push(
      {
        label: "expanded 상태에서는 toolbar가 보임",
        passed: Boolean(snapshot?.hasToolbar),
        actual: snapshot?.hasToolbar ? "toolbar" : "missing",
      },
      {
        label: "segment-cluster 구조가 유지됨",
        passed: Boolean(snapshot?.hasSegmentCluster),
        actual: snapshot?.hasSegmentCluster ? "segment-cluster" : "missing",
      },
      {
        label: "expanded 버튼 4종이 모두 렌더됨",
        passed: requiredActions.every((action) => actions.includes(action)),
        actual: actions.join(","),
      },
      {
        label: "status text가 비어 있지 않음",
        passed: Boolean(normalizeText(snapshot?.statusText)),
        actual: normalizeText(snapshot?.statusText),
      },
      {
        label: "log text가 비어 있지 않음",
        passed: Boolean(normalizeText(snapshot?.logText)),
        actual: normalizeText(snapshot?.logText).slice(0, 120),
      }
    );
    return checks;
  }

  function validateHostedDebugConsoleWorkspace(options = {}) {
    const snapshot = buildHostedDebugConsoleStateSnapshot(options?.entries);
    const checks = buildHostedDebugConsoleValidationChecks(snapshot);
    return {
      checks,
      collapsed: Boolean(snapshot?.collapsed),
      entryCount: Math.max(0, Number(snapshot?.entryCount) || 0),
      passed: checks.every((check) => Boolean(check?.passed)),
      snapshot,
    };
  }

  function ensureDebugLocalQueueSandboxActive() {
    if (!state.debugLocalQueueSandbox) {
      throw new Error("로컬 queue sandbox에서만 사용할 수 있는 debug helper입니다.");
    }
  }

  async function clearDebugLocalQueueSandboxPendingUploads() {
    ensureDebugLocalQueueSandboxActive();
    const clearedCount = state.pendingUploads.length;
    await runPendingUploadQueueOperation(
      () => state.queueStore.clearMeeting(state.session.meetingId),
      {
        context: {
          phase: "sandbox-clear",
          reason: "sandbox-clear",
        },
        scope: PENDING_UPLOAD_QUEUE_OPERATION_SCOPES.cleanup,
      }
    );
    delete state.runtimeChunkCache;
    state.runtimeChunkCache = Object.create(null);
    applyLoadedPendingUploads([]);
    state.selectedRecordId = "";
    applyRender();
    return {
      clearedCount,
      meetingId: state.session.meetingId,
    };
  }

  async function seedDebugLocalQueueSandboxPendingUpload(options = {}) {
    ensureDebugLocalQueueSandboxActive();
    const timestamp = new Date().toISOString();
    const requestId = normalizeText(options?.requestId) || ns.shared.generateCaptureRequestId(global);
    const sizeBytes = Math.max(1, Number(options?.sizeBytes) || 16);
    const durationMs = Math.max(1000, Number(options?.durationMs) || 1500);
    const pending = normalizePendingUpload({
      blob: new global.Blob(["debug-local-queue"], { type: normalizeText(options?.mimeType) || "audio/webm" }),
      captureMode: "microphone",
      channelCount: 1,
      createdAt: timestamp,
      durationMs,
      endedAt: timestamp,
      hold: Boolean(options?.hold),
      jobId: "",
      lastError: normalizeText(options?.lastError),
      meetingId: state.session.meetingId,
      meetingTitleSnapshot: normalizeText(options?.title) || "sandbox pending record",
      mimeType: normalizeText(options?.mimeType) || "audio/webm",
      originalSizeBytes: sizeBytes,
      parts: [],
      publishedPartCount: 0,
      preparedPartCount: 0,
      requestId,
      sharedMemoSnapshot: normalizeTextBlock(options?.sharedMemo),
      sizeBytes,
      sourceMode: normalizeText(options?.sourceMode) || "single",
      startedAt: normalizeText(options?.startedAt) || new Date(Date.now() - durationMs).toISOString(),
      status: normalizeText(options?.status) || "local_saved",
      uploadedPartCount: 0,
      updatedAt: timestamp,
    });
    const saved = await upsertPendingUpload(pending, {
      context: {
        phase: "sandbox-seed",
        reason: "sandbox-seed",
      },
    });
    state.selectedRecordId = ns.shared.buildLocalSelectionId(saved.requestId);
    applyRender();
    return buildPendingUploadSnapshotItem(saved);
  }

  async function runDebugLocalQueueSandboxAction(action, options = {}) {
    ensureDebugLocalQueueSandboxActive();
    const normalizedAction = normalizeText(action);
    const requestId = normalizeText(options?.requestId) || normalizeText(state.pendingUploads[0]?.requestId);
    if (!requestId) {
      throw new Error("로컬 queue sandbox action을 실행할 pending requestId가 없습니다.");
    }
    const pending = state.pendingUploads.find((item) => item.requestId === requestId);
    if (!pending) {
      throw new Error(`pending requestId를 찾지 못했습니다: ${requestId}`);
    }
    if (normalizedAction === "hold") {
      await upsertPendingUpload(
        { ...pending, hold: true, status: "on_hold", lastError: pending.lastError || "업로드를 잠시 멈췄습니다." },
        { context: { phase: "manual-hold", reason: "manual-hold" } }
      );
      applyRender();
      return buildPendingUploadSnapshotItem(
        state.pendingUploads.find((item) => item.requestId === requestId) || pending
      );
    }
    if (normalizedAction === "resume") {
      await upsertPendingUpload(
        { ...pending, hold: false, status: "upload_queued", lastError: "" },
        { context: { phase: "manual-resume-state", reason: "manual-resume" } }
      );
      applyRender();
      return buildPendingUploadSnapshotItem(
        state.pendingUploads.find((item) => item.requestId === requestId) || pending
      );
    }
    if (normalizedAction === "rename") {
      const recordId = ns.shared.buildLocalSelectionId(requestId);
      const nextTitle = normalizeText(options?.title) || "sandbox renamed record";
      await saveRecordTitleForEntry(recordId, nextTitle);
      return {
        requestId,
        title: nextTitle,
      };
    }
    if (normalizedAction === "delete") {
      await deletePendingUpload(requestId, {
        context: {
          phase: "manual-delete",
          reason: "manual-delete",
        },
      });
      return {
        deleted: true,
        requestId,
      };
    }
    throw new Error(`알 수 없는 로컬 queue sandbox action: ${normalizedAction || "(empty)"}`);
  }

  function syncWorkspaceDebugApi() {
    const debugApi = global.__INOVA_HOSTED_MEETING_DEBUG__ = global.__INOVA_HOSTED_MEETING_DEBUG__ || {};
    debugApi.debugConsoleState = buildHostedDebugConsoleStateSnapshot;
    debugApi.debugConsoleValidation = {
      checkWorkspace: validateHostedDebugConsoleWorkspace,
    };
    debugApi.queueState = buildPendingUploadQueueStateSnapshot;
    debugApi.queueSandbox = {
      active: () => Boolean(state.debugLocalQueueSandbox),
      clear: clearDebugLocalQueueSandboxPendingUploads,
      runAction: runDebugLocalQueueSandboxAction,
      seedPending: seedDebugLocalQueueSandboxPendingUpload,
    };
    debugApi.queueValidation = {
      check: validatePendingUploadQueueScenario,
    };
  }

  function consumePendingUploadQueueDiagnostics(context = {}) {
    const diagnostics = typeof state.queueStore.consumeDiagnostics === "function"
      ? state.queueStore.consumeDiagnostics()
      : null;
    const operation = normalizeText(diagnostics?.operation);
    if (operation === "put") {
      applyPendingUploadPersistDiagnostics(diagnostics, context);
      return diagnostics;
    }
    if (operation === "delete" || operation === "clearMeeting") {
      applyPendingUploadCleanupDiagnostics(diagnostics, context);
      return diagnostics;
    }
    applyPendingUploadStorageDiagnostics(diagnostics, context);
    return diagnostics;
  }

  async function runPendingUploadQueueOperation(action, options = {}) {
    const scope = normalizeText(options?.scope) || PENDING_UPLOAD_QUEUE_OPERATION_SCOPES.load;
    const context = normalizePendingUploadQueueContext(options?.context);
    try {
      const result = await action();
      consumePendingUploadQueueDiagnostics(context);
      return result;
    } catch (error) {
      const diagnostics = consumePendingUploadQueueDiagnostics(context);
      const issueCodes = Array.isArray(diagnostics?.issues)
        ? diagnostics.issues.map((issue) => normalizeText(issue?.code)).filter(Boolean)
        : [];
      logDebug("workspace.pending-uploads.operation.error", {
        degradedReason: normalizeText(diagnostics?.degradedReason),
        error,
        issueCodes,
        operation: normalizeText(diagnostics?.operation),
        scope,
        ...context,
      });
      throw buildPendingUploadQueueOperationError(scope, diagnostics, error, context);
    }
  }

  async function bootWorkspace() {
    try {
      logDebug("workspace.boot.start", {
        launchToken: Boolean(state.params.launchToken),
        meetingId: state.params.meetingId,
        workspaceToken: Boolean(state.params.workspaceToken),
      });
      if (state.params.launchToken) {
        await exchangeLaunch(state.params.launchToken);
      } else {
        restoreWorkspaceSession();
      }
      logDebug("workspace.boot.session", {
        hasMeetingId: Boolean(state.session.meetingId),
        hasMeetingSessionToken: Boolean(state.session.meetingSessionToken),
        mode: state.mode,
      });
      if (!state.session.meetingSessionToken || !state.session.meetingId) {
        if (isDebugLocalQueueSandboxRequested()) {
          activateDebugLocalQueueSandbox();
        }
      }
      if (!state.session.meetingSessionToken || !state.session.meetingId) {
        const blockedState = buildMissingSessionBlockedOptions();
        return renderBlocked(blockedState.message, blockedState);
      }
      surfaceSessionRestoreNotice();
      state.meetingTitleDraft = normalizeText(state.meeting.title || state.session.title);
      refs.meetingTitleInput.value = state.meetingTitleDraft;
      state.recordMemoSaved = normalizeTextBlock(state.session.sharedMemo);
      state.recordMemoDraft = state.recordMemoSaved;
      refs.sharedMemoInput.value = state.recordMemoDraft;
      await loadPendingUploads();
      if (state.debugLocalQueueSandbox) {
        setNotice("로컬 queue sandbox를 켰습니다. import/hold/delete/reload로 queue degraded 흐름만 확인합니다.", "highlight");
        applyRender();
        return;
      }
      await refreshWorkspace(true, "boot");
      retryPendingUploads("boot-retry");
    } catch (error) {
      logDebug("workspace.boot.error", { error });
      renderBlocked(error instanceof Error ? error.message : "회의 작업실을 열지 못했어요. 패널에서 다시 시도해 주세요.");
    }
  }

  function getWorkspaceTitleDraft() {
    return normalizeText(refs.meetingTitleInput?.value || state.meeting.title || state.session.title);
  }

  function getWorkspaceTitleOrFallback() {
    return getWorkspaceTitleDraft() || "새 작업실";
  }

  function buildRecordTitle(seedAt) {
    const workspaceTitle = getWorkspaceTitleDraft();
    const stamp = formatDateTime(seedAt, "");
    if (workspaceTitle && stamp) return `${workspaceTitle} · ${stamp}`;
    if (workspaceTitle) return workspaceTitle;
    if (stamp) return `새 기록 · ${stamp}`;
    return "새 기록";
  }

  function buildImportedRecordTitle(file, seedAt) {
    const fileName = normalizeText(String(file?.name || "").replace(/\.[^.]+$/, ""));
    if (fileName) return fileName;
    return buildRecordTitle(seedAt);
  }

  function requestConfirmation(options = {}) {
    if (state.confirmation.open) {
      resolveConfirmation(false);
    }
    return new Promise((resolve) => {
      state.confirmation = {
        body: normalizeTextBlock(options.body),
        confirmLabel: normalizeText(options.confirmLabel) || "확인",
        eyebrow: normalizeText(options.eyebrow) || "확인",
        open: true,
        resolve,
        title: normalizeText(options.title) || "이 작업을 진행할까요?",
        tone: normalizeText(options.tone) || "danger",
      };
      applyRender();
      global.setTimeout(() => refs.confirmDialogConfirm?.focus(), 0);
    });
  }

  function resolveConfirmation(confirmed) {
    const resolver = typeof state.confirmation.resolve === "function" ? state.confirmation.resolve : null;
    state.confirmation = { body: "", confirmLabel: "확인", eyebrow: "확인", open: false, resolve: null, title: "", tone: "danger" };
    applyRender();
    if (resolver) {
      resolver(Boolean(confirmed));
    }
  }

  async function exchangeLaunch(launchToken) {
    logDebug("workspace.launch.exchange.start", { launchToken: Boolean(normalizeText(launchToken)) });
    const payload = await postJson(global, CONFIG.exchangeLaunchUrl, { launchToken });
    const meetingId = normalizeText(payload?.meeting?.meetingId);
    if (!meetingId || !normalizeText(payload?.meetingSessionToken)) throw new Error("회의 작업실 세션을 만들지 못했어요. 패널에서 다시 시도해 주세요.");
    state.mode = normalizeText(payload?.mode) === "detail" ? "detail" : "create";
    state.session = { expiresAt: normalizeText(payload?.expiresAt), meetingId, meetingSessionToken: normalizeText(payload?.meetingSessionToken), mode: state.mode, sharedMemo: normalizeTextBlock(payload?.meeting?.sharedMemo), title: normalizeText(payload?.meeting?.title) };
    state.meeting = { meetingId, pendingLocalCount: 0, sharedMemo: state.session.sharedMemo, title: state.session.title, updatedAt: "" };
    state.selectedRecordId = normalizeText(payload?.jobId) ? buildRemoteSelectionId(payload.jobId) : "";
    logDebug("workspace.launch.exchange.success", {
      jobId: payload?.jobId,
      meetingId,
      mode: state.mode,
    });
    persistWorkspaceSession();
  }

  function restoreWorkspaceSession() {
    const restored = loadPersistedWorkspaceSession(global, normalizeText(state.params.meetingId), state.params.workspaceToken, state.params.jobId);
    const restoreIssues = Array.isArray(restored?.issues) ? restored.issues : [];
    const degradedReason = normalizeText(restored?.degradedReason);
    const issueCodes = restoreIssues.map((issue) => normalizeText(issue?.code)).filter(Boolean);
    state.sessionRestore = {
      degradedReason,
      hasBlockingIssue: hasSessionRestoreBlockingIssue(issueCodes),
      hasWarningIssue: hasSessionRestoreWarningIssue(issueCodes),
      issueCodes,
      source: normalizeText(restored?.source),
    };
    logDebug("workspace.session.restore", {
      degradedReason,
      hasRestoredPayload: Boolean(restored?.payload),
      issueCodes,
      issueCount: restoreIssues.length,
      meetingId: state.params.meetingId,
      source: restored?.source || "",
      workspaceToken: Boolean(state.params.workspaceToken),
    });
    if (degradedReason) {
      logDebug("workspace.session.restore.degraded", {
        degradedReason,
        issues: restoreIssues,
        meetingId: state.params.meetingId,
        source: restored?.source || "",
      });
    }
    if (!restored?.payload) return;
    const parsed = restored.payload;
    state.mode = normalizeText(parsed?.mode) === "detail" ? "detail" : "create";
    state.session = { expiresAt: normalizeText(parsed?.expiresAt), meetingId: normalizeText(parsed?.meetingId), meetingSessionToken: normalizeText(parsed?.meetingSessionToken), mode: state.mode, sharedMemo: normalizeTextBlock(parsed?.sharedMemo), title: normalizeText(parsed?.title) };
    state.meeting = { meetingId: state.session.meetingId, pendingLocalCount: 0, sharedMemo: state.session.sharedMemo, title: state.session.title, updatedAt: "" };
    state.selectedRecordId = normalizeText(state.params.jobId || parsed?.jobId) ? buildRemoteSelectionId(state.params.jobId || parsed?.jobId) : "";
    state.supersededRemoteJobIds = loadSupersededRemoteJobIds(state.session.meetingId);
  }

  function collectSupersededRemoteJobIds() {
    return Array.from(new Set(
      (Array.isArray(state.pendingUploads) ? state.pendingUploads : [])
        .flatMap((pending) => Array.isArray(pending?.supersededJobIds) ? pending.supersededJobIds : [pending?.supersededJobId])
        .map((jobId) => normalizeText(jobId))
        .filter(Boolean)
    ));
  }

  function loadSupersededRemoteJobIds(meetingId) {
    const normalizedMeetingId = normalizeText(meetingId);
    const rawEntries = [];
    if (normalizedMeetingId) {
      rawEntries.push(safeLocalStorageGet(global, buildWorkspaceSessionStorageKey(normalizedMeetingId)));
    }
    try {
      rawEntries.push(global.sessionStorage?.getItem?.(SESSION_STORAGE_KEY) || "");
    } catch {}
    for (const rawEntry of rawEntries) {
      if (!normalizeText(rawEntry)) continue;
      try {
        const parsed = JSON.parse(rawEntry);
        if (normalizedMeetingId && normalizeText(parsed?.meetingId) && normalizeText(parsed.meetingId) !== normalizedMeetingId) {
          continue;
        }
        return Array.from(new Set(
          (Array.isArray(parsed?.supersededRemoteJobIds) ? parsed.supersededRemoteJobIds : [])
            .map((jobId) => normalizeText(jobId))
            .filter(Boolean)
        ));
      } catch {}
    }
    return [];
  }

  async function refreshWorkspace(hydrateSelection, reason) {
    if (state.blocked || state.loading) return null;
    if (state.debugLocalQueueSandbox) {
      logDebug("workspace.refresh.skipped", {
        reason: "local-queue-sandbox",
        requestedReason: normalizeText(reason),
      });
      if (normalizeText(reason) === "manual") {
        setNotice("로컬 queue sandbox에서는 원격 새로고침을 건너뜁니다.", "highlight");
        applyRender();
      }
      return null;
    }
    state.loading = true;
    state.loadingReason = normalizeText(reason);
    if (state.loadingReason === "manual") {
      setNotice("작업실을 다시 불러오는 중입니다.", "highlight");
      applyRender();
    }
    try {
      logDebug("workspace.refresh.start", {
        hydrateSelection: Boolean(hydrateSelection),
        meetingId: state.session.meetingId,
        reason,
      });
      await loadPendingUploads();
      if (state.loadingReason === "boot") {
        // Show the workspace shell as soon as local state is ready.
        applyRender();
      }
      const shouldReconnect = Boolean(
        normalizeText(reason) === "boot"
        || normalizeText(reason) === "manual"
        || !state.realtime.unsubscribeMeeting
      );
      await connectWorkspaceRealtime({
        forceReconnect: shouldReconnect,
        hydrateSelection: Boolean(hydrateSelection),
        reason,
      });
      if (!shouldReconnect) {
        await syncWorkspaceLocalState(Boolean(hydrateSelection), reason);
      }
      clearResolvedRefreshNotice();
      applyRender();
      logDebug("workspace.refresh.success", {
        meetingId: state.meeting.meetingId,
        pendingLocalCount: state.pendingUploads.length,
        reason,
        resultCount: state.records.length,
      });
      return {
        items: state.records,
        meeting: state.meeting,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "기록 정보를 읽지 못했어요.";
      logDebug("workspace.refresh.error", {
        error,
        message,
        reason,
      });
      if (message.includes("패널에서 다시")) {
        clearWorkspaceSession();
        return renderBlocked(message);
      }
      if (shouldDegradeRefreshError(error, message, reason)) {
        logDebug("workspace.refresh.degraded", {
          error,
          hasWorkspaceData: hasWorkspaceData(),
          message,
          reason,
        });
        setDegradedNotice(DEGRADED_NOTICE_CODES.refresh, buildRefreshDegradedNotice(message, reason), "warning");
        applyRender();
        return {
          degraded: true,
          items: state.records,
          meeting: state.meeting,
        };
      }
      setNotice(message, "error");
      applyRender();
      return null;
    } finally {
      state.loading = false;
      state.loadingReason = "";
      applyRender();
    }
  }

  function applyLoadedPendingUploads(items) {
    state.pendingUploads = collapseSupersededPendingUploads(items)
      .map((item) => ["uploading", "uploading_chunks", "preparing_chunks"].includes(item.status)
        ? { ...item, status: "upload_queued", lastError: item.lastError || "페이지를 다시 열어 업로드를 이어갑니다." }
        : item)
      .sort(ns.storage.comparePendingUploads);
    state.meeting.pendingLocalCount = state.pendingUploads.length;
  }

  async function loadPendingUploads() {
    if (!state.session.meetingId) {
      applyLoadedPendingUploads([]);
      return;
    }
    try {
      const loadedItems = await runPendingUploadQueueOperation(
        () => state.queueStore.listByMeeting(state.session.meetingId),
        {
          context: {
            phase: "load-pending-uploads",
            reason: "workspace-load",
          },
          scope: PENDING_UPLOAD_QUEUE_OPERATION_SCOPES.load,
        }
      );
      applyLoadedPendingUploads(loadedItems);
    } catch (error) {
      logDebug("workspace.pending-uploads.load.degraded", {
        degradedReason: normalizeText(state.pendingUploadStorage.degradedReason),
        error,
        issueCodes: Array.isArray(state.pendingUploadStorage.issueCodes) ? state.pendingUploadStorage.issueCodes : [],
        meetingId: state.session.meetingId,
        retainedPendingLocalCount: state.pendingUploads.length,
      });
      state.meeting.pendingLocalCount = state.pendingUploads.length;
    }
  }

  function buildPendingUploadRemoteStartTransition(pending, remoteState, options = {}) {
    const action = normalizeText(options?.action);
    if (!["single-start", "chunk-start"].includes(action)) {
      throw new Error("원격 start action이 없어 업로드 결과를 안전하게 확정할 수 없어요.");
    }
    const awaitingMoreUploads = Boolean(options?.awaitingMoreUploads);
    const remoteStatus = normalizeText(remoteState?.status);
    const nextJobId = normalizeText(remoteState?.jobId || pending?.jobId);
    const nextUpdatedAt = normalizeText(remoteState?.updatedAt || pending?.updatedAt);
    const nextError = normalizeText(remoteState?.error || pending?.lastError);
    const uploadedPartCount = Math.max(0, Number(pending?.uploadedPartCount) || 0);

    if (!remoteStatus) {
      return {
        errorMessage: "원격 작업 시작 응답에 상태가 없어 업로드 결과를 확정할 수 없어요.",
        remoteStatus,
      };
    }

    if (!nextJobId) {
      return {
        errorMessage: `원격 작업 시작 응답 상태(${remoteStatus})에 jobId가 없어 업로드 결과를 확정할 수 없어요.`,
        remoteStatus,
      };
    }

    if (remoteStatus === "processing" || remoteStatus === "queued") {
      return {
        nextPending: normalizePendingUpload({
          ...pending,
          jobId: nextJobId,
          lastError: "",
          publishedPartCount: normalizeText(pending?.sourceMode) === "chunked" ? uploadedPartCount : 0,
          status: awaitingMoreUploads
            ? "uploading_chunks"
            : remoteStatus === "processing"
              ? "remote_processing"
              : "remote_queued",
          storageObject: pending.storageObject,
          updatedAt: nextUpdatedAt,
        }),
        nextSelectedRecordId: nextJobId ? buildRemoteSelectionId(nextJobId) : "",
        outcome: "active",
        resolution: "started",
        resetChunkCache: "",
      };
    }

    if (remoteStatus === "succeeded") {
      if (awaitingMoreUploads) {
        return {
          errorMessage: "남은 chunk 업로드가 끝나기 전에 원격 작업이 완료 상태로 응답해 결과를 확정할 수 없어요.",
          remoteStatus,
        };
      }
      return {
        nextPending: normalizePendingUpload({
          ...pending,
          hold: false,
          jobId: nextJobId,
          lastError: "",
          publishedPartCount: normalizeText(pending?.sourceMode) === "chunked" ? uploadedPartCount : 0,
          status: "succeeded",
          updatedAt: nextUpdatedAt,
        }),
        nextSelectedRecordId: nextJobId ? buildRemoteSelectionId(nextJobId) : "",
        outcome: "succeeded",
        resolution: "completed",
        resetChunkCache: "clear",
      };
    }

    if (remoteStatus === "failed") {
      return {
        errorMessage: nextError || "원격 작업이 시작 직후 실패해 업로드를 이어갈 수 없어요.",
        remoteStatus,
      };
    }

    return {
      errorMessage: `원격 작업 시작 응답 상태(${remoteStatus})를 이해하지 못해 업로드 결과를 확정할 수 없어요.`,
      remoteStatus,
    };
  }

  function buildPendingUploadRemotePublishTransition(pending, remoteState, options = {}) {
    const action = normalizeText(options?.action);
    if (action !== "chunk-publish") {
      throw new Error("원격 publish action이 없어 추가 chunk 반영 결과를 안전하게 확정할 수 없어요.");
    }
    const awaitingMoreUploads = Boolean(options?.awaitingMoreUploads);
    const remoteStatus = normalizeText(remoteState?.status);
    const nextJobId = normalizeText(remoteState?.jobId || pending?.jobId);
    const nextUpdatedAt = normalizeText(remoteState?.updatedAt || pending?.updatedAt);
    const nextError = normalizeText(remoteState?.error || pending?.lastError);
    const uploadedPartCount = Math.max(0, Number(pending?.uploadedPartCount) || 0);

    if (!remoteStatus) {
      return {
        errorMessage: "추가 chunk 반영 응답에 상태가 없어 결과를 확정할 수 없어요.",
        remoteStatus,
      };
    }

    if (!nextJobId) {
      return {
        errorMessage: `추가 chunk 반영 응답 상태(${remoteStatus})에 jobId가 없어 결과를 확정할 수 없어요.`,
        remoteStatus,
      };
    }

    if (remoteStatus === "processing" || remoteStatus === "queued") {
      return {
        nextPending: normalizePendingUpload({
          ...pending,
          jobId: nextJobId,
          lastError: "",
          publishedPartCount: uploadedPartCount,
          status: awaitingMoreUploads
            ? "uploading_chunks"
            : remoteStatus === "processing"
              ? "remote_processing"
              : "remote_queued",
          storageObject: pending.storageObject,
          updatedAt: nextUpdatedAt,
        }),
        nextSelectedRecordId: nextJobId ? buildRemoteSelectionId(nextJobId) : "",
        outcome: "active",
        resolution: "published",
        resetChunkCache: "",
      };
    }

    if (remoteStatus === "succeeded") {
      if (awaitingMoreUploads) {
        return {
          errorMessage: "남은 chunk 업로드가 끝나기 전에 추가 chunk 반영 응답이 완료 상태로 와 결과를 확정할 수 없어요.",
          remoteStatus,
        };
      }
      return {
        nextPending: normalizePendingUpload({
          ...pending,
          hold: false,
          jobId: nextJobId,
          lastError: "",
          publishedPartCount: uploadedPartCount,
          status: "succeeded",
          updatedAt: nextUpdatedAt,
        }),
        nextSelectedRecordId: nextJobId ? buildRemoteSelectionId(nextJobId) : "",
        outcome: "succeeded",
        resolution: "completed",
        resetChunkCache: "clear",
      };
    }

    if (remoteStatus === "failed") {
      return {
        errorMessage: nextError || "원격 작업이 추가 chunk 반영 직후 실패해 업로드를 이어갈 수 없어요.",
        remoteStatus,
      };
    }

    return {
      errorMessage: `추가 chunk 반영 응답 상태(${remoteStatus})를 이해하지 못해 결과를 확정할 수 없어요.`,
      remoteStatus,
    };
  }

  function buildPendingUploadRemoteSnapshotTransition(pending, remoteState) {
    const remoteStatus = normalizeText(remoteState?.status);
    const nextJobId = normalizeText(remoteState?.jobId || pending?.jobId);
    const nextUpdatedAt = normalizeText(remoteState?.updatedAt || pending?.updatedAt);
    const nextError = normalizeText(remoteState?.error || pending?.lastError);
    const uploadedPartCount = Math.max(0, Number(pending?.uploadedPartCount) || 0);
    const publishedPartCount = normalizeText(pending?.sourceMode) === "chunked"
      ? Math.min(uploadedPartCount, Math.max(0, Number(pending?.publishedPartCount) || 0))
      : 0;

    if (!remoteStatus) {
      return {
        errorMessage: "원격 작업 상태가 비어 있어 브라우저 보관 큐를 그대로 유지합니다.",
        remoteStatus,
      };
    }

    if (!nextJobId) {
      return {
        errorMessage: `원격 작업 상태(${remoteStatus})에 jobId가 없어 브라우저 보관 큐를 그대로 유지합니다.`,
        remoteStatus,
      };
    }

    if (remoteStatus === "processing" || remoteStatus === "queued") {
      return {
        nextPending: normalizePendingUpload({
          ...pending,
          jobId: nextJobId,
          lastError: nextError,
          publishedPartCount,
          status: remoteStatus === "processing" ? "remote_processing" : "remote_queued",
          storageObject: pending.storageObject,
          updatedAt: nextUpdatedAt,
        }),
        nextSelectedRecordId: nextJobId ? buildRemoteSelectionId(nextJobId) : "",
        outcome: "active",
        resolution: "reconciled",
        resetChunkCache: "",
      };
    }

    if (remoteStatus === "succeeded") {
      return {
        nextPending: normalizePendingUpload({
          ...pending,
          hold: false,
          jobId: nextJobId,
          lastError: "",
          publishedPartCount: normalizeText(pending?.sourceMode) === "chunked" ? uploadedPartCount : 0,
          status: "succeeded",
          updatedAt: nextUpdatedAt,
        }),
        nextSelectedRecordId: nextJobId ? buildRemoteSelectionId(nextJobId) : "",
        outcome: "succeeded",
        resolution: "completed",
        resetChunkCache: "clear",
      };
    }

    if (remoteStatus === "failed") {
      return {
        nextPending: normalizePendingUpload({
          ...pending,
          jobId: nextJobId,
          lastError: nextError,
          parts: (Array.isArray(pending?.parts) ? pending.parts : []).map((part) => ({
            ...part,
            storageObject: "",
            uploadStatus: "",
          })),
          publishedPartCount: 0,
          status: pending?.hold ? "on_hold" : "failed",
          storageObject: "",
          updatedAt: nextUpdatedAt,
        }),
        nextSelectedRecordId: nextJobId ? buildRemoteSelectionId(nextJobId) : "",
        outcome: "failed",
        resolution: "remote-failed",
        resetChunkCache: "reset-parts",
      };
    }

    return {
      errorMessage: `원격 작업 상태(${remoteStatus})를 이해하지 못해 브라우저 보관 큐를 그대로 유지합니다.`,
      remoteStatus,
    };
  }

  function buildChunkedPendingUploadRemoteResyncTransition(pending, remoteState, options = {}) {
    const awaitingMoreUploads = Boolean(options?.awaitingMoreUploads);
    const remoteStatus = normalizeText(remoteState?.status);
    const nextJobId = normalizeText(remoteState?.jobId || pending?.jobId);
    const nextUpdatedAt = normalizeText(remoteState?.updatedAt || pending?.updatedAt);
    const nextError = normalizeText(remoteState?.error || pending?.lastError);
    const uploadedPartCount = Math.max(0, Number(pending?.uploadedPartCount) || 0);
    const publishedPartCount = normalizeText(pending?.sourceMode) === "chunked"
      ? Math.min(uploadedPartCount, Math.max(0, Number(pending?.publishedPartCount) || 0))
      : 0;

    if (!remoteStatus) {
      return {
        errorMessage: "원격 작업 상태가 비어 있어 브라우저 보관 큐를 그대로 유지합니다.",
        remoteStatus,
      };
    }

    if (!nextJobId) {
      return {
        errorMessage: `원격 작업 상태(${remoteStatus})에 jobId가 없어 브라우저 보관 큐를 그대로 유지합니다.`,
        remoteStatus,
      };
    }

    if (remoteStatus === "processing" || remoteStatus === "queued") {
      return {
        nextPending: normalizePendingUpload({
          ...pending,
          jobId: nextJobId,
          lastError: nextError,
          publishedPartCount,
          status: awaitingMoreUploads
            ? "uploading_chunks"
            : remoteStatus === "processing"
              ? "remote_processing"
              : "remote_queued",
          storageObject: pending.storageObject,
          updatedAt: nextUpdatedAt,
        }),
        nextSelectedRecordId: nextJobId ? buildRemoteSelectionId(nextJobId) : "",
        outcome: "active",
        resolution: "reconciled",
        resetChunkCache: "",
      };
    }

    if (remoteStatus === "succeeded") {
      if (awaitingMoreUploads) {
        return {
          errorMessage: "남은 chunk 업로드가 끝나기 전에 원격 작업이 완료 상태로 응답해 브라우저 보관 상태를 안전하게 정리할 수 없어요.",
          remoteStatus,
        };
      }
      return {
        nextPending: normalizePendingUpload({
          ...pending,
          hold: false,
          jobId: nextJobId,
          lastError: "",
          publishedPartCount: normalizeText(pending?.sourceMode) === "chunked" ? uploadedPartCount : 0,
          status: "succeeded",
          updatedAt: nextUpdatedAt,
        }),
        nextSelectedRecordId: nextJobId ? buildRemoteSelectionId(nextJobId) : "",
        outcome: "succeeded",
        resolution: "reconcile-completed",
        resetChunkCache: "clear",
      };
    }

    if (remoteStatus === "failed") {
      return {
        nextPending: normalizePendingUpload({
          ...pending,
          jobId: nextJobId,
          lastError: nextError,
          parts: (Array.isArray(pending?.parts) ? pending.parts : []).map((part) => ({
            ...part,
            storageObject: "",
            uploadStatus: "",
          })),
          publishedPartCount: 0,
          status: pending?.hold ? "on_hold" : "failed",
          storageObject: "",
          updatedAt: nextUpdatedAt,
        }),
        nextSelectedRecordId: nextJobId ? buildRemoteSelectionId(nextJobId) : "",
        outcome: "failed",
        resolution: "reconcile-remote-failed",
        resetChunkCache: "reset-parts",
      };
    }

    return {
      errorMessage: `원격 작업 상태(${remoteStatus})를 이해하지 못해 브라우저 보관 큐를 그대로 유지합니다.`,
      remoteStatus,
    };
  }

  async function commitPendingUploadRemoteMutationTransition(pending, transition, options = {}) {
    if (!transition?.nextPending) {
      return null;
    }
    const nextPending = await upsertPendingUpload(transition.nextPending, {
      context: options?.queueContext,
    });
    const normalizedRequestId = normalizeText(pending?.requestId);
    if (!normalizedRequestId) {
      return nextPending;
    }
    if (transition.resetChunkCache === "clear") {
      delete state.runtimeChunkCache[normalizedRequestId];
    } else if (transition.resetChunkCache === "reset-parts" && state.runtimeChunkCache[normalizedRequestId]) {
      state.runtimeChunkCache[normalizedRequestId] = {
        ...state.runtimeChunkCache[normalizedRequestId],
        parts: (state.runtimeChunkCache[normalizedRequestId].parts || []).map((part) => ({
          ...part,
          storageObject: "",
          uploadStatus: "",
        })),
      };
    }
    if (
      options?.applySelectedRecordTransition
      && transition.nextSelectedRecordId
      && state.selectedRecordId === ns.shared.buildLocalSelectionId(normalizedRequestId)
    ) {
      state.selectedRecordId = transition.nextSelectedRecordId;
    }
    return nextPending;
  }

  async function commitPendingUploadRemoteSnapshotTransition(pending, transition) {
    if (!transition?.nextPending) {
      return null;
    }
    const nextPending = await upsertPendingUpload(transition.nextPending, {
      preserveUpdatedAt: true,
      context: {
        phase: transition.outcome === "succeeded"
          ? "remote-sync-succeeded"
          : transition.outcome === "failed"
            ? "remote-sync-reset"
            : "remote-sync-update",
        previousRequestId: pending.requestId,
        reason: "remote-sync",
        requestId: transition.nextPending.requestId,
        shouldResetSource: transition.resetChunkCache === "reset-parts",
      },
    });
    const normalizedRequestId = normalizeText(pending?.requestId);
    if (!normalizedRequestId) {
      return nextPending;
    }
    if (transition.resetChunkCache === "clear") {
      delete state.runtimeChunkCache[normalizedRequestId];
    } else if (transition.resetChunkCache === "reset-parts" && state.runtimeChunkCache[normalizedRequestId]) {
      state.runtimeChunkCache[normalizedRequestId] = {
        ...state.runtimeChunkCache[normalizedRequestId],
        parts: (state.runtimeChunkCache[normalizedRequestId].parts || []).map((part) => ({
          ...part,
          storageObject: "",
          uploadStatus: "",
        })),
      };
    }
    if (
      transition.nextSelectedRecordId
      && state.selectedRecordId === ns.shared.buildLocalSelectionId(normalizedRequestId)
    ) {
      state.selectedRecordId = transition.nextSelectedRecordId;
    }
    return nextPending;
  }

  async function commitChunkedPendingUploadRemoteResyncTransition(pending, transition, queueContext) {
    if (!transition?.nextPending) {
      return null;
    }
    const nextPending = await upsertPendingUpload(transition.nextPending, {
      context: queueContext,
    });
    const normalizedRequestId = normalizeText(pending?.requestId);
    if (!normalizedRequestId) {
      return nextPending;
    }
    if (transition.resetChunkCache === "clear") {
      delete state.runtimeChunkCache[normalizedRequestId];
    } else if (transition.resetChunkCache === "reset-parts" && state.runtimeChunkCache[normalizedRequestId]) {
      state.runtimeChunkCache[normalizedRequestId] = {
        ...state.runtimeChunkCache[normalizedRequestId],
        parts: (state.runtimeChunkCache[normalizedRequestId].parts || []).map((part) => ({
          ...part,
          storageObject: "",
          uploadStatus: "",
        })),
      };
    }
    return nextPending;
  }

  async function applyPendingUploadRemoteSnapshotState(pending, remoteState) {
    const transition = buildPendingUploadRemoteSnapshotTransition(pending, remoteState);
    if (!transition?.nextPending) {
      logDebug("workspace.pending-uploads.remote-sync.unknown-status", {
        error: transition?.errorMessage,
        jobId: normalizeText(remoteState?.jobId),
        remoteStatus: normalizeText(transition?.remoteStatus),
        requestId: normalizeText(pending?.requestId),
      });
      setNotice(normalizeText(transition?.errorMessage) || "원격 작업 상태를 이해하지 못해 브라우저 보관 상태를 그대로 유지합니다.", "warning");
      applyRender();
      return { degraded: true, pending, resolution: "" };
    }
    const nextPending = await commitPendingUploadRemoteSnapshotTransition(pending, transition);
    return {
      degraded: false,
      outcome: normalizeText(transition?.outcome),
      pending: nextPending,
      resolution: normalizeText(transition?.resolution),
    };
  }

  async function syncPendingUploadsWithRemote() {
    const pendingItems = Array.isArray(state.pendingUploads) ? [...state.pendingUploads] : [];
    for (const pending of pendingItems) {
      const matched = findRemoteForPending(state, pending);
      if (!matched) continue;
      await applyPendingUploadRemoteSnapshotState(pending, matched);
    }
    state.meeting.pendingLocalCount = state.pendingUploads.length;
  }
  async function connectWorkspaceRealtime(options = {}) {
    const forceReconnect = Boolean(options.forceReconnect);
    const shouldDeferInitialSnapshot = (
      normalizeText(options.reason) === "boot"
      && !normalizeText(state.params.jobId)
      && state.pendingUploads.length < 1
      && state.records.length < 1
      && !state.currentJob
      && !state.currentArtifact
      && !normalizeText(state.selectedRecordId)
    );
    if (!state.session.meetingSessionToken || !state.session.meetingId) {
      throw new Error("회의 작업실 세션이 없어요. 패널에서 다시 열어 주세요.");
    }
    const authPayload = await ensureWorkspaceAuth(state.session.meetingSessionToken, {
      forceRefresh: forceReconnect,
    });
    const nextMeetingDocId = normalizeText(authPayload?.meetingDocumentId);
    if (!nextMeetingDocId) {
      throw new Error("회의 작업실 Firestore 문서를 확인하지 못했어요.");
    }

    state.realtime.meetingDocId = nextMeetingDocId;
    state.realtime.workspaceAuthExpiresAt = normalizeText(authPayload?.expiresAt);
    state.realtime.workspaceSessionId = normalizeText(authPayload?.workspaceSessionId);

    if (!forceReconnect && typeof state.realtime.unsubscribeMeeting === "function") {
      return authPayload;
    }

    disconnectMeetingListener({ clearDetail: true });
    const listenerVersion = state.realtime.meetingListenerVersion + 1;
    state.realtime.meetingListenerVersion = listenerVersion;

    let awaitingInitialSnapshot = true;
    const initialSnapshotResult = await Promise.race([
      new Promise((resolve) => {
        let settled = false;
        const finishResolve = () => {
          if (settled) return;
          settled = true;
          resolve({ ok: true });
        };
        const finishReject = (error) => {
          if (settled) return;
          settled = true;
          resolve({ error, ok: false });
        };
        state.realtime.unsubscribeMeeting = subscribeDocument(FIRESTORE_COLLECTIONS.meetings, nextMeetingDocId, {
          error: (error) => {
            if (listenerVersion !== state.realtime.meetingListenerVersion) return;
            const normalizedError = normalizeRealtimeError(error);
            if (!awaitingInitialSnapshot) {
              handleRealtimeListenerError(normalizedError, "meeting");
            }
            finishReject(normalizedError);
          },
          next: (snapshot) => {
            void handleMeetingSnapshot(snapshot, {
              hydrateSelection: Boolean(options.hydrateSelection),
              listenerVersion,
              reason: options.reason,
            })
              .then(finishResolve)
              .catch((error) => {
                const normalizedError = normalizeRealtimeError(error);
                if (!awaitingInitialSnapshot) {
                  handleRealtimeListenerError(normalizedError, "meeting");
                }
                finishReject(normalizedError);
              });
          },
        });
      }),
      ...(shouldDeferInitialSnapshot
        ? [
            new Promise((resolve) => {
              global.setTimeout(() => resolve({ deferred: true, ok: true }), BOOT_INITIAL_SNAPSHOT_WAIT_MS);
            }),
          ]
        : []),
    ]);
    awaitingInitialSnapshot = false;

    if (!initialSnapshotResult?.ok) {
      if (isRealtimePermissionError(initialSnapshotResult.error) && options.allowPermissionRetry !== false) {
        logDebug("workspace.refresh.permission-retry", {
          meetingId: state.session.meetingId,
          reason: options.reason,
        });
        disposeWorkspaceRealtime({ clearAuthCache: true });
        setNotice("읽기 권한을 다시 확인하는 중입니다.", "highlight");
        applyRender();
        return connectWorkspaceRealtime({
          ...options,
          allowPermissionRetry: false,
          forceReconnect: true,
        });
      }
      handleRealtimeListenerError(initialSnapshotResult.error, "meeting");
      throw initialSnapshotResult.error;
    }
    if (initialSnapshotResult?.deferred) {
      await syncWorkspaceLocalState(Boolean(options.hydrateSelection), options.reason || "boot-deferred");
      logDebug("workspace.refresh.deferred-snapshot", {
        meetingId: state.session.meetingId,
        waitMs: BOOT_INITIAL_SNAPSHOT_WAIT_MS,
      });
    }

    return authPayload;
  }

  async function handleMeetingSnapshot(snapshot, options = {}) {
    if (options.listenerVersion !== state.realtime.meetingListenerVersion) {
      return;
    }
    const previousMeetingTitle = normalizeText(state.meeting.title || state.session.title);
    const meetingPayload = snapshot?.exists ? snapshot.data() : null;
    state.records = Array.isArray(meetingPayload?.recentJobs)
      ? meetingPayload.recentJobs.map(normalizeRecord).filter((record) => record.jobId)
      : [];
    state.meeting = {
      meetingId: normalizeText(meetingPayload?.meetingId) || state.session.meetingId,
      pendingLocalCount: state.pendingUploads.length,
      sharedMemo: normalizeTextBlock(meetingPayload?.sharedMemo || state.session.sharedMemo),
      title: normalizeText(meetingPayload?.title || refs.meetingTitleInput.value || state.session.title || "새 작업실"),
      updatedAt: normalizeText(meetingPayload?.updatedAt),
    };
    state.session.title = state.meeting.title;
    if (
      global.document.activeElement !== refs.meetingTitleInput
      && normalizeText(state.meetingTitleDraft) === previousMeetingTitle
    ) {
      state.meetingTitleDraft = state.meeting.title;
    }
    await syncWorkspaceLocalState(Boolean(options.hydrateSelection), options.reason || "snapshot");
    logDebug("workspace.snapshot.meeting", {
      exists: Boolean(snapshot?.exists),
      hydrateSelection: Boolean(options.hydrateSelection),
      meetingId: state.meeting.meetingId,
      reason: options.reason,
      resultCount: state.records.length,
    });
  }

  async function syncWorkspaceLocalState(hydrateSelection, reason) {
    await syncPendingUploadsWithRemote();
    if (!state.selectedRecordId || hydrateSelection || !findHistoryEntry(state, state.selectedRecordId)) {
      state.selectedRecordId = chooseSelectedRecordId(state);
    }
    await hydrateSelectedDetail(Boolean(hydrateSelection));
    persistWorkspaceSession();
    applyRender();
    logDebug("workspace.sync.state", {
      meetingId: state.meeting.meetingId,
      pendingLocalCount: state.pendingUploads.length,
      reason,
      resultCount: state.records.length,
      selectedRecordId: state.selectedRecordId,
    });
  }

  async function hydrateSelectedDetail(forceRefresh) {
    const entry = findHistoryEntry(state, state.selectedRecordId);
    if (!entry) {
      resetSelectedDetailState();
      syncSpeakerAliasDrafts(true);
      return;
    }
    state.currentLocalRecord = entry.pending || null;
    const selectionChanged = normalizeText(state.currentDetailSelectionId) !== normalizeText(entry.id);
    state.currentDetailSelectionId = entry.id;
    if (!entry.remote?.jobId) {
      disconnectJobListener();
      disconnectArtifactListener();
      state.currentArtifact = null;
      state.currentJob = buildLocalPendingJob(entry.pending);
      syncSpeakerAliasDrafts(true);
      return;
    }

    const shouldReconnect = Boolean(
      selectionChanged
      || normalizeText(state.realtime.jobDocId) !== normalizeText(entry.remote.jobId)
      || typeof state.realtime.unsubscribeJob !== "function"
      || (forceRefresh && !state.currentJob)
    );
    if (!shouldReconnect) {
      await ensureArtifactRealtimeSubscription(entry, {
        forceReconnect: false,
        forceResetAliases: false,
      });
      syncSpeakerAliasDrafts(false);
      return;
    }

    disconnectJobListener();
    disconnectArtifactListener();
    state.currentArtifact = null;
    state.currentJob = normalizeJob({
      createdAt: entry.remote.createdAt,
      error: entry.remote.error,
      jobId: entry.remote.jobId,
      notesGeneratedAt: entry.remote.notesGeneratedAt,
      notesModeConfidence: entry.remote.notesModeConfidence,
      notesModeDetected: entry.remote.notesModeDetected,
      notesModeSelected: entry.remote.notesModeSelected,
      notesStyleSelected: entry.remote.notesStyleSelected,
      source: {
        durationMs: entry.remote.durationMs,
        requestId: entry.remote.requestId,
      },
      status: entry.remote.status,
      title: entry.remote.title,
      updatedAt: entry.remote.updatedAt,
    }, state.meeting.title);
    await subscribeSelectedJobRealtime(entry, {
      forceResetAliases: true,
    });
  }

  async function subscribeSelectedJobRealtime(entry, options = {}) {
    const jobId = normalizeText(entry?.remote?.jobId);
    if (!jobId) {
      return;
    }
    const listenerVersion = state.realtime.jobListenerVersion + 1;
    state.realtime.jobDocId = jobId;
    state.realtime.jobListenerVersion = listenerVersion;

    await new Promise((resolve, reject) => {
      let settled = false;
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      state.realtime.unsubscribeJob = subscribeDocument(FIRESTORE_COLLECTIONS.jobs, jobId, {
        error: (error) => {
          if (listenerVersion !== state.realtime.jobListenerVersion) return;
          const normalizedError = normalizeRealtimeError(error);
          handleRealtimeListenerError(normalizedError, "job");
          finishReject(normalizedError);
        },
        next: (snapshot) => {
          void handleJobSnapshot(snapshot, entry, {
            forceResetAliases: Boolean(options.forceResetAliases),
            listenerVersion,
          })
            .then(finishResolve)
            .catch((error) => {
              const normalizedError = normalizeRealtimeError(error);
              handleRealtimeListenerError(normalizedError, "job");
              finishReject(normalizedError);
            });
        },
      });
    });
  }

  async function handleJobSnapshot(snapshot, entry, options = {}) {
    if (options.listenerVersion !== state.realtime.jobListenerVersion) {
      return;
    }
    if (!snapshot?.exists) {
      await ensureArtifactRealtimeSubscription(entry, {
        forceReconnect: true,
        forceResetAliases: Boolean(options.forceResetAliases),
      });
      syncSpeakerAliasDrafts(Boolean(options.forceResetAliases));
      applyRender();
      return;
    }
    state.currentJob = normalizeJob(snapshot.data(), state.meeting.title);
    state.notesStyleSelection = normalizeText(
      state.currentArtifact?.notesStyleSelected
      || state.currentJob?.notesStyleSelected
      || state.notesStyleSelection
    );
    await ensureArtifactRealtimeSubscription(entry, {
      forceReconnect: false,
      forceResetAliases: Boolean(options.forceResetAliases),
    });
    syncSpeakerAliasDrafts(Boolean(options.forceResetAliases));
    applyRender();
    logDebug("workspace.snapshot.job", {
      artifactId: normalizeText(state.currentJob?.artifactId),
      jobId: normalizeText(state.currentJob?.jobId),
      status: normalizeText(state.currentJob?.status),
      updatedAt: normalizeText(state.currentJob?.updatedAt),
    });
  }

  async function ensureArtifactRealtimeSubscription(entry, options = {}) {
    const artifactId = normalizeText(state.currentJob?.artifactId || entry?.remote?.artifactId);
    if (!artifactId) {
      disconnectArtifactListener();
      state.currentArtifact = null;
      return;
    }
    const shouldReconnect = Boolean(
      options.forceReconnect
      || normalizeText(state.realtime.artifactDocId) !== artifactId
      || typeof state.realtime.unsubscribeArtifact !== "function"
    );
    if (!shouldReconnect) {
      return;
    }

    disconnectArtifactListener();
    state.currentArtifact = null;
    state.realtime.artifactDocId = artifactId;
    const listenerVersion = state.realtime.artifactListenerVersion + 1;
    state.realtime.artifactListenerVersion = listenerVersion;

    await new Promise((resolve, reject) => {
      let settled = false;
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      state.realtime.unsubscribeArtifact = subscribeDocument(FIRESTORE_COLLECTIONS.artifacts, artifactId, {
        error: (error) => {
          if (listenerVersion !== state.realtime.artifactListenerVersion) return;
          const normalizedError = normalizeRealtimeError(error);
          handleRealtimeListenerError(normalizedError, "artifact");
          finishReject(normalizedError);
        },
        next: (snapshot) => {
          void handleArtifactSnapshot(snapshot, {
            forceResetAliases: Boolean(options.forceResetAliases),
            listenerVersion,
          })
            .then(finishResolve)
            .catch((error) => {
              const normalizedError = normalizeRealtimeError(error);
              handleRealtimeListenerError(normalizedError, "artifact");
              finishReject(normalizedError);
            });
        },
      });
    });
  }

  async function handleArtifactSnapshot(snapshot, options = {}) {
    if (options.listenerVersion !== state.realtime.artifactListenerVersion) {
      return;
    }
    state.currentArtifact = snapshot?.exists ? normalizeArtifact(snapshot.data()) : null;
    state.notesStyleSelection = normalizeText(
      state.currentArtifact?.notesStyleSelected
      || state.currentJob?.notesStyleSelected
      || state.notesStyleSelection
    );
    syncSpeakerAliasDrafts(Boolean(options.forceResetAliases));
    applyRender();
    logDebug("workspace.snapshot.artifact", {
      artifactId: normalizeText(state.currentArtifact?.artifactId || state.realtime.artifactDocId),
      exists: Boolean(snapshot?.exists),
      segmentCount: Array.isArray(state.currentArtifact?.segments) ? state.currentArtifact.segments.length : 0,
    });
  }

  function resetSelectedDetailState() {
    disconnectJobListener();
    disconnectArtifactListener();
    state.currentArtifact = null;
    state.currentDetailSelectionId = "";
    state.currentJob = null;
    state.currentLocalRecord = null;
  }

  function disconnectMeetingListener(options = {}) {
    if (typeof state.realtime.unsubscribeMeeting === "function") {
      state.realtime.unsubscribeMeeting();
    }
    state.realtime.meetingDocId = "";
    state.realtime.unsubscribeMeeting = null;
    if (options.clearDetail) {
      disconnectJobListener();
      disconnectArtifactListener();
    }
  }

  function disconnectJobListener() {
    if (typeof state.realtime.unsubscribeJob === "function") {
      state.realtime.unsubscribeJob();
    }
    state.realtime.jobDocId = "";
    state.realtime.unsubscribeJob = null;
  }

  function disconnectArtifactListener() {
    if (typeof state.realtime.unsubscribeArtifact === "function") {
      state.realtime.unsubscribeArtifact();
    }
    state.realtime.artifactDocId = "";
    state.realtime.unsubscribeArtifact = null;
  }

  function disposeWorkspaceRealtime(options = {}) {
    disconnectMeetingListener({ clearDetail: true });
    if (options.clearAuthCache) {
      clearWorkspaceAuthCache();
    }
  }

  function normalizeRealtimeError(error) {
    if (error instanceof Error) {
      return error;
    }
    const normalized = new Error(normalizeText(error?.message) || "실시간 작업실 연결을 복구하지 못했어요.");
    normalized.code = normalizeText(error?.code);
    return normalized;
  }

  function isRealtimePermissionError(error) {
    const code = normalizeText(error?.code).toLowerCase();
    const message = normalizeText(error?.message).toLowerCase();
    return code === "permission-denied"
      || code === "unauthenticated"
      || message.includes("permission-denied")
      || message.includes("missing or insufficient permissions");
  }

  function handleRealtimeListenerError(error, scope) {
    if (isRealtimePermissionError(error)) {
      clearWorkspaceSession();
      renderBlocked("회의 작업실 세션이 만료되었거나 읽기 권한을 확인하지 못했어요. 패널에서 다시 열어 주세요.", {
        eyebrow: "작업실 세션 종료",
        title: "실시간 작업실 연결이 종료되었습니다",
      });
      return;
    }
    if (isLikelyNetworkError(global, error)) {
      setNotice("실시간 연결이 잠시 끊겼습니다. 연결이 돌아오면 자동으로 다시 붙습니다.", "highlight");
      applyRender();
      return;
    }
    setNotice(
      error instanceof Error ? error.message : `${scope} 실시간 연결을 유지하지 못했어요.`,
      "error"
    );
    applyRender();
  }

  function openImportAudioPicker() {
    if (!state.isLocalWorkspace || !refs.importAudioInput || ["recording", "paused", "stopping"].includes(state.capture.status)) return;
    refs.importAudioInput.value = "";
    refs.importAudioInput.click();
  }

  async function handleImportAudioSelection(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (!file) return;
    try {
      await importAudioFile(file);
    } catch (error) {
      showPendingUploadQueueOperationError(error, "파일 불러오기를 이어가지 못했어요.");
    } finally {
      if (input) input.value = "";
    }
  }

  async function importAudioFile(file) {
    if (!state.isLocalWorkspace) {
      setNotice("파일 불러오기는 로컬 작업실에서만 사용할 수 있습니다.", "error");
      applyRender();
      return;
    }
    if (["recording", "paused", "stopping"].includes(state.capture.status)) {
      setNotice("현재 녹음을 먼저 마친 뒤 파일을 불러와 주세요.", "warning");
      applyRender();
      return;
    }
    const sizeBytes = Math.max(0, Number(file?.size) || 0);
    if (!(sizeBytes > 0)) {
      setNotice("오디오 파일을 읽지 못했습니다.", "error");
      applyRender();
      return;
    }
    if (sizeBytes > DEFAULT_SOURCE_MAX_BYTES) {
      setNotice(`현재 회의 원본은 ${Math.floor(DEFAULT_SOURCE_MAX_BYTES / (1024 * 1024))}MB 이하까지만 지원합니다.`, "warning");
      applyRender();
      return;
    }
    let durationMs = 0;
    try {
      durationMs = await measureAudioDuration(file);
    } catch (error) {
      logDebug("workspace.import.duration.error", {
        error,
        fileName: normalizeText(file.name),
        sizeBytes,
      });
    }
    if (!(durationMs > 0)) {
      setNotice("이 파일의 길이를 확인하지 못해 바로 전사할 수 없습니다.", "error");
      applyRender();
      return;
    }
    if (durationMs > DEFAULT_SOURCE_MAX_DURATION_MS) {
      setNotice("현재 회의 원본은 최대 2시간까지만 지원합니다.", "warning");
      applyRender();
      return;
    }
    const endedAt = new Date().toISOString();
    const startedAt = new Date(Date.now() - durationMs).toISOString();
    const pending = normalizePendingUpload({
      blob: file,
      captureMode: "microphone",
      channelCount: 1,
      createdAt: endedAt,
      durationMs,
      endedAt,
      hold: false,
      jobId: "",
      lastError: "",
      meetingId: state.session.meetingId,
      meetingTitleSnapshot: buildImportedRecordTitle(file, endedAt),
      mimeType: normalizeText(file.type) || "audio/mp4",
      originalSizeBytes: sizeBytes,
      parts: [],
      publishedPartCount: 0,
      preparedPartCount: 0,
      requestId: ns.shared.generateCaptureRequestId(global),
      sharedMemoSnapshot: normalizeTextBlock(refs.sharedMemoInput.value || state.recordMemoDraft || state.recordMemoSaved),
      sizeBytes,
      sourceMode: inferSourceMode(sizeBytes, durationMs),
      startedAt,
      status: "local_saved",
      uploadedPartCount: 0,
      updatedAt: endedAt,
    });
    logDebug("workspace.import.selected", {
      durationMs,
      fileName: normalizeText(file.name),
      mimeType: pending.mimeType,
      sizeBytes,
    });
    await upsertPendingUpload(pending, {
      context: {
        phase: "import-save",
        reason: "import-upload",
      },
    });
    state.recordMemoDraft = "";
    state.recordMemoSaved = "";
    state.session.sharedMemo = "";
    refs.sharedMemoInput.value = "";
    refs.sharedMemoNotice.hidden = true;
    refs.sharedMemoNotice.textContent = "";
    state.reviewTab = "summary";
    state.selectedRecordId = ns.shared.buildLocalSelectionId(pending.requestId);
    setNotice(
      state.debugLocalQueueSandbox
        ? "파일을 불러왔습니다. 로컬 queue sandbox에서는 원격 전사를 건너뛰고 브라우저 queue 상태만 확인합니다."
        : "파일을 불러왔고 자동 전사를 시작했습니다.",
      "highlight"
    );
    applyRender();
    if (!state.debugLocalQueueSandbox) {
      void attemptPendingUpload(pending.requestId, { reason: "import-upload" });
    }
  }

  async function measureAudioDuration(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = global.URL.createObjectURL(file);
      const audio = global.document.createElement("audio");
      const cleanup = () => {
        audio.removeAttribute("src");
        audio.load?.();
        global.URL.revokeObjectURL(objectUrl);
      };
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        const durationSeconds = Number(audio.duration);
        cleanup();
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
          reject(new Error("duration-unavailable"));
          return;
        }
        resolve(Math.round(durationSeconds * 1000));
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error("duration-read-failed"));
      };
      audio.src = objectUrl;
    });
  }

  async function startCapture(options = {}) {
    if (["recording", "paused", "stopping"].includes(state.capture.status)) return;
    try {
      const stream = await global.navigator.mediaDevices.getUserMedia({ audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true }, video: false });
      const recorderMimeType = pickRecorderMimeType(global);
      const recorderOptions = {};
      if (recorderMimeType) recorderOptions.mimeType = recorderMimeType;
      if (state.recordingProfile.audioBitsPerSecond > 0) recorderOptions.audioBitsPerSecond = state.recordingProfile.audioBitsPerSecond;
      const recorder = Object.keys(recorderOptions).length ? new global.MediaRecorder(stream, recorderOptions) : new global.MediaRecorder(stream);
      state.media.audioStream = stream;
      state.media.autoStopPending = false;
      state.media.recorder = recorder;
      state.media.chunks = [];
      state.media.accumulatedDurationMs = 0;
      state.media.resumeStartedAtMs = Date.now();
      state.media.stopContext = null;
      state.capture = {
        ...createIdleCapture(state.recordingProfile),
        channelCount: Math.max(1, Number(stream.getAudioTracks?.().length) || 1),
        mimeType: normalizeText(recorder.mimeType),
        requestId: ns.shared.generateCaptureRequestId(global),
        startedAt: new Date().toISOString(),
        status: "recording",
      };
      recorder.addEventListener("dataavailable", (event) => event?.data && Number(event.data.size) > 0 && state.media.chunks.push(event.data));
      recorder.addEventListener("stop", () => finalizeRecording().catch((error) => { setNotice(error instanceof Error ? error.message : "녹음을 정리하지 못했어요.", "error"); resolveRecorderStop(); }));
      recorder.start(1000);
      state.media.chunkTimer = global.setInterval(updateRecordingDuration, 500);
      logDebug("workspace.capture.start", {
        audioBitsPerSecond: state.capture.audioBitsPerSecond,
        continuedFromLimit: Boolean(options?.continuedFromLimit),
        maxDurationMs: state.capture.maxDurationMs,
        mimeType: state.capture.mimeType,
        requestId: state.capture.requestId,
      });
      setNotice(options?.continuedFromLimit ? "이전 기록을 전사로 넘기고 다음 기록 녹음을 이어갑니다." : "녹음을 시작했습니다.", "highlight");
      applyRender();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "녹음을 시작하지 못했어요.", "error");
      applyRender();
    }
  }

  async function pauseCapture() { if (state.capture.status !== "recording" || !state.media.recorder) return; state.media.recorder.pause?.(); global.clearInterval(state.media.chunkTimer); state.media.accumulatedDurationMs += Math.max(0, Date.now() - state.media.resumeStartedAtMs); state.capture.durationMs = state.media.accumulatedDurationMs; state.capture.status = "paused"; setNotice("녹음을 일시중지했습니다.", "highlight"); applyRender(); }
  async function resumeCapture() { if (state.capture.status !== "paused" || !state.media.recorder) return; state.media.recorder.resume?.(); state.media.resumeStartedAtMs = Date.now(); state.capture.status = "recording"; state.media.chunkTimer = global.setInterval(updateRecordingDuration, 500); setNotice("녹음을 다시 이어갑니다.", "highlight"); applyRender(); }
  async function stopCapture(stopContext = {}) {
    if (!["recording", "paused"].includes(state.capture.status) || !state.media.recorder) return;
    if (state.capture.status === "recording") {
      state.media.accumulatedDurationMs += Math.max(0, Date.now() - state.media.resumeStartedAtMs);
      state.capture.durationMs = state.media.accumulatedDurationMs;
    }
    state.media.stopContext = {
      autoLimit: Boolean(stopContext?.autoLimit),
      continueRecording: Boolean(stopContext?.continueRecording),
    };
    state.capture.status = "stopping";
    setNotice(
      state.media.stopContext.autoLimit
        ? "설정한 시간에 도달해 현재 기록을 전사로 넘기고 다음 기록 녹음을 준비합니다."
        : "녹음을 로컬에 저장하고 바로 전사를 시작합니다.",
      "highlight"
    );
    applyRender();
    await stopRecorder();
  }
  function discardCapture() { if (state.capture.status !== "captured" || !state.media.recordedBlob) return; state.media.recordedBlob = null; resetCaptureState(); setNotice("임시 녹음을 버렸습니다.", "highlight"); applyRender(); }

  async function finalizeRecording() {
    global.clearInterval(state.media.chunkTimer);
    const stopContext = state.media.stopContext || { autoLimit: false, continueRecording: false };
    const blob = new global.Blob(state.media.chunks, { type: normalizeText(state.media.recorder?.mimeType || state.capture.mimeType) || "audio/webm" });
    if (Number(blob.size) > DEFAULT_SOURCE_MAX_BYTES) {
      cleanupMedia();
      resetCaptureState();
      resolveRecorderStop();
      setNotice(`현재 회의 원본은 ${Math.floor(DEFAULT_SOURCE_MAX_BYTES / (1024 * 1024))}MB 이하까지만 지원합니다.`, "error");
      applyRender();
      return;
    }
    const endedAt = new Date().toISOString();
    const pending = normalizePendingUpload({ blob, captureMode: "microphone", channelCount: state.capture.channelCount, createdAt: endedAt, durationMs: state.capture.durationMs, endedAt, hold: false, jobId: "", lastError: "", meetingId: state.session.meetingId, meetingTitleSnapshot: buildRecordTitle(endedAt), mimeType: blob.type, originalSizeBytes: blob.size, parts: [], publishedPartCount: 0, preparedPartCount: 0, requestId: state.capture.requestId || ns.shared.generateCaptureRequestId(global), sharedMemoSnapshot: normalizeTextBlock(refs.sharedMemoInput.value || state.recordMemoDraft || state.recordMemoSaved), sizeBytes: blob.size, sourceMode: inferSourceMode(blob.size, state.capture.durationMs), startedAt: state.capture.startedAt, status: "local_saved", uploadedPartCount: 0, updatedAt: endedAt });
    await upsertPendingUpload(pending, {
      context: {
        phase: stopContext.continueRecording ? "capture-save-continue" : "capture-save",
        reason: stopContext.continueRecording ? "capture-continue" : "capture-upload",
      },
    });
    state.recordMemoDraft = "";
    state.recordMemoSaved = "";
    state.session.sharedMemo = "";
    refs.sharedMemoInput.value = "";
    refs.sharedMemoNotice.hidden = true;
    refs.sharedMemoNotice.textContent = "";
    cleanupMedia();
    resetCaptureState();
    state.reviewTab = "summary";
    state.selectedRecordId = ns.shared.buildLocalSelectionId(pending.requestId);
    resolveRecorderStop();
    if (stopContext.continueRecording) {
      setNotice("현재 기록을 전사로 넘기고 다음 기록 녹음을 이어갑니다.", "highlight");
      applyRender();
      void startCapture({ continuedFromLimit: true });
    } else {
      setNotice(
        state.debugLocalQueueSandbox
          ? "녹음을 브라우저 queue에 저장했습니다. 로컬 queue sandbox에서는 원격 전사를 건너뜁니다."
          : "녹음을 브라우저에 저장했고 자동 전사를 시작했습니다. 지금 바로 다음 녹음을 시작할 수 있습니다.",
        "highlight"
      );
      applyRender();
    }
    if (!state.debugLocalQueueSandbox) {
      void attemptPendingUpload(pending.requestId, { reason: "capture-upload" });
    }
  }

  function resolvePendingUploadAttemptReason(pending, options = {}) {
    const explicitReason = normalizeText(options?.reason);
    if (explicitReason) return explicitReason;
    if (Boolean(options?.forceRestart)) return "manual-restart";
    if (normalizeText(pending?.status) === "failed") return "failed-retry";
    return "retry";
  }

  function buildPendingUploadAttemptPlan(pending, options = {}) {
    const forceRestart = Boolean(options?.forceRestart);
    const normalizedRequestId = normalizeText(pending?.requestId);
    const previousRemoteJobId = normalizeText(pending?.jobId);
    const previousRemoteSelectionId = previousRemoteJobId ? buildRemoteSelectionId(previousRemoteJobId) : "";
    const shouldResetSource = normalizeText(pending?.status) === "failed" || forceRestart;
    const retryRequestId = shouldResetSource ? ns.shared.generateCaptureRequestId(global) : normalizedRequestId;
    const retryBase = shouldResetSource
      ? {
          ...pending,
          jobId: "",
          lastError: "",
          parts: (Array.isArray(pending.parts) ? pending.parts : []).map((part, index) => ({
            ...part,
            requestId: buildPendingPartRequestId(retryRequestId, index),
            storageObject: "",
            uploadStatus: "",
          })),
          requestId: retryRequestId,
          storageObject: "",
          supersededJobIds: Array.from(new Set([
            ...(Array.isArray(pending.supersededJobIds) ? pending.supersededJobIds : []),
            previousRemoteJobId,
          ].map((jobId) => normalizeText(jobId)).filter(Boolean))),
          supersededRequestIds: Array.from(new Set([
            ...(Array.isArray(pending.supersededRequestIds) ? pending.supersededRequestIds : []),
            normalizedRequestId,
          ].map((value) => normalizeText(value)).filter((value) => Boolean(value) && value !== retryRequestId))),
          publishedPartCount: 0,
          uploadedPartCount: 0,
        }
      : pending;
    return {
      forceRestart,
      nextUploadStatus: shouldUseChunkedSource(retryBase) ? "preparing_chunks" : "uploading",
      normalizedRequestId,
      noticeText: shouldResetSource
        ? (forceRestart
          ? "멈춘 처리 상태를 정리하고 브라우저 원본으로 다시 시작합니다."
          : "실패한 임시 원본은 다시 올린 뒤 처리를 재시작합니다.")
        : "",
      previousRemoteJobId,
      previousRemoteSelectionId,
      reason: resolvePendingUploadAttemptReason(pending, options),
      retryBase,
      retryRequestId,
      shouldResetSource,
    };
  }

  function announcePendingUploadAttempt(plan, activeRequestId) {
    logDebug("workspace.pending-upload.transition", {
      phase: "transition",
      previousRequestId: normalizeText(plan?.normalizedRequestId),
      previousRemoteJobId: normalizeText(plan?.previousRemoteJobId),
      reason: normalizeText(plan?.reason),
      requestId: normalizeText(activeRequestId || plan?.retryRequestId || plan?.normalizedRequestId),
      status: normalizeText(plan?.nextUploadStatus),
      shouldResetSource: Boolean(plan?.shouldResetSource),
      supersededJobIds: Array.isArray(plan?.retryBase?.supersededJobIds) ? plan.retryBase.supersededJobIds : [],
      supersededRequestIds: Array.isArray(plan?.retryBase?.supersededRequestIds) ? plan.retryBase.supersededRequestIds : [],
    });
    if (normalizeText(plan?.noticeText)) {
      setNotice(plan.noticeText, "highlight");
    }
  }

  function buildPendingUploadTransitionQueueContext(plan, requestId, phase) {
    return normalizePendingUploadQueueContext({
      phase,
      previousRequestId: normalizeText(plan?.normalizedRequestId),
      reason: normalizeText(plan?.reason),
      requestId: normalizeText(requestId || plan?.retryRequestId || plan?.normalizedRequestId),
      shouldResetSource: Boolean(plan?.shouldResetSource),
    });
  }

  function buildChunkRemoteStartRequest(pending) {
    const uploadedPartCount = Math.max(0, Number(pending?.uploadedPartCount) || 0);
    const publishedPartCount = Math.max(0, Number(pending?.publishedPartCount) || 0);
    const jobId = normalizeText(pending?.jobId);

    if (jobId || uploadedPartCount <= 0 || uploadedPartCount <= publishedPartCount) {
      return null;
    }

    return {
      contextPhase: "chunk-remote-job-start",
      noticeText: "첫 청크를 올려 자동 전사를 바로 시작했습니다. 남은 청크를 이어서 업로드합니다.",
      transitionAction: "chunk-start",
    };
  }

  function buildChunkRemotePublishRequest(pending) {
    const uploadedPartCount = Math.max(0, Number(pending?.uploadedPartCount) || 0);
    const publishedPartCount = Math.max(0, Number(pending?.publishedPartCount) || 0);
    const jobId = normalizeText(pending?.jobId);

    if (!jobId || uploadedPartCount <= publishedPartCount) {
      return null;
    }

    return {
      contextPhase: "chunk-remote-job-refresh",
      transitionAction: "chunk-publish",
    };
  }

  function buildChunkRemoteResyncRequest(pending) {
    const jobId = normalizeText(pending?.jobId);

    if (jobId) {
      return {
        contextPhase: "chunk-remote-job-resync",
        transitionAction: "chunk-resync",
      };
    }
    return null;
  }

  async function continueChunkedPendingUploadAttempt(latest, buildAttemptQueueContext, activeRequestId, sourceSizeBytes) {
    let nextPending = await upsertPendingUpload({
      ...latest,
      lastError: "",
      sourceMode: "chunked",
      status: "preparing_chunks",
    }, { context: buildAttemptQueueContext(activeRequestId, "chunk-prepare") });
    const prepared = await getOrPrepareChunkedSource(nextPending);
    nextPending = await upsertPendingUpload({
      ...nextPending,
      lastError: "",
      mimeType: prepared.mimeType,
      originalSizeBytes: sourceSizeBytes,
      parts: prepared.parts,
      preparedPartCount: prepared.parts.length,
      sourceMode: "chunked",
      status: "uploading_chunks",
      uploadedPartCount: prepared.parts.filter((part) => normalizeText(part.storageObject)).length,
    }, { context: buildAttemptQueueContext(activeRequestId, "chunk-uploading") });

    const findMissingPreparedParts = (pendingState) => prepared.parts.filter((preparedPart) => {
      const currentPart = (pendingState?.parts || []).find((part) => Number(part.index) === Number(preparedPart.index));
      return !normalizeText(currentPart?.storageObject);
    });
    const uploadPreparedPart = async (pendingState, preparedPart) => {
      const uploaded = await uploadPendingSource(pendingState, {
        blob: preparedPart.blob,
        endMs: preparedPart.endMs,
        fileName: buildChunkPartFileName(pendingState, preparedPart.index),
        mimeType: prepared.mimeType,
        overlapMs: preparedPart.overlapMs,
        parentRequestId: normalizeText(pendingState?.requestId),
        partCount: prepared.parts.length,
        partIndex: preparedPart.index,
        requestId: preparedPart.requestId,
        sizeBytes: preparedPart.sizeBytes,
        startMs: preparedPart.startMs,
      });
      return updatePendingChunkUploadState(
        normalizeText(pendingState?.requestId),
        preparedPart.index,
        uploaded,
        { context: buildAttemptQueueContext(activeRequestId, "chunk-part-uploaded") }
      );
    };

    let mutationChangedRemoteStateThisAttempt = false;
    let terminalRemoteStateObservedThisAttempt = false;
    let uploadedChunkCountThisAttempt = 0;
    if (!normalizeText(nextPending?.jobId)) {
      const bootstrapPart = findMissingPreparedParts(nextPending)[0];
      if (bootstrapPart) {
        nextPending = await uploadPreparedPart(nextPending, bootstrapPart);
        uploadedChunkCountThisAttempt += 1;
        const bootstrapResult = await startChunkedPendingUploadRemoteJob(nextPending, {
          context: buildAttemptQueueContext(activeRequestId, "chunk-remote-job-start"),
          noticeText: "첫 청크를 올려 자동 전사를 바로 시작했습니다. 남은 청크를 이어서 업로드합니다.",
          syncWorkspace: false,
          transitionAction: "chunk-start",
        });
        nextPending = bootstrapResult.pending;
        mutationChangedRemoteStateThisAttempt = !bootstrapResult.degraded
          && normalizeText(bootstrapResult.resolution) !== "reconciled";
      }
    }

    for (const preparedPart of findMissingPreparedParts(nextPending)) {
      nextPending = await uploadPreparedPart(nextPending, preparedPart);
      uploadedChunkCountThisAttempt += 1;
    }

    const remoteStartRequest = buildChunkRemoteStartRequest(nextPending);
    if (remoteStartRequest) {
      const mutationResult = await startChunkedPendingUploadRemoteJob(nextPending, {
        context: buildAttemptQueueContext(activeRequestId, remoteStartRequest.contextPhase),
        noticeText: remoteStartRequest.noticeText,
        syncWorkspace: false,
        transitionAction: remoteStartRequest.transitionAction,
      });
      nextPending = mutationResult.pending;
      mutationChangedRemoteStateThisAttempt = mutationChangedRemoteStateThisAttempt
        || (!mutationResult.degraded && normalizeText(mutationResult.resolution) !== "reconciled");
    } else {
      const remotePublishRequest = buildChunkRemotePublishRequest(nextPending);
      if (remotePublishRequest) {
        const publishResult = await publishPendingUploadRemoteChunks(nextPending, {
          context: buildAttemptQueueContext(activeRequestId, remotePublishRequest.contextPhase),
          transitionAction: remotePublishRequest.transitionAction,
        });
        nextPending = publishResult.pending;
        mutationChangedRemoteStateThisAttempt = mutationChangedRemoteStateThisAttempt
          || (!publishResult.degraded && normalizeText(publishResult.resolution) !== "reconciled");
      } else {
        const shouldResyncRemoteState = normalizeText(nextPending?.jobId)
          && uploadedChunkCountThisAttempt === 0
          && !mutationChangedRemoteStateThisAttempt;
        if (shouldResyncRemoteState) {
          const remoteResyncRequest = buildChunkRemoteResyncRequest(nextPending);
          const reconcileResult = await reconcileChunkedPendingUploadRemoteState(nextPending, {
            context: buildAttemptQueueContext(activeRequestId, remoteResyncRequest.contextPhase),
            transitionAction: remoteResyncRequest.transitionAction,
          });
          nextPending = reconcileResult.pending;
          terminalRemoteStateObservedThisAttempt = !reconcileResult.degraded
            && ["reconcile-completed", "reconcile-remote-failed"].includes(normalizeText(reconcileResult.resolution));
        }
      }
    }

    if (mutationChangedRemoteStateThisAttempt) {
      await syncWorkspaceLocalState(false, "workflow-chunk-mutation");
    } else if (terminalRemoteStateObservedThisAttempt) {
      await syncWorkspaceLocalState(false, "workflow-chunk-reconcile");
    }
    return nextPending;
  }

  async function continueSinglePendingUploadAttempt(latest, buildAttemptQueueContext, activeRequestId, sourceSizeBytes) {
    let nextPending = latest;
    let allowInlineSource = false;
    let inlineSourceError = "";
    if (!normalizeText(nextPending?.storageObject)) {
      nextPending = await upsertPendingUpload({
        ...nextPending,
        lastError: "",
        originalSizeBytes: sourceSizeBytes,
        sourceMode: "single",
        status: "uploading",
      }, { context: buildAttemptQueueContext(activeRequestId, "single-uploading") });
      try {
        const uploaded = await uploadPendingSource(nextPending);
        nextPending = await upsertPendingUpload({
          ...nextPending,
          lastError: "",
          originalSizeBytes: sourceSizeBytes,
          sizeBytes: Math.max(sourceSizeBytes, Number(uploaded?.sizeBytes) || 0),
          sourceMode: "single",
          status: "uploading",
          storageObject: normalizeText(uploaded?.storageObject),
        }, { context: buildAttemptQueueContext(activeRequestId, "single-uploaded") });
      } catch (uploadError) {
        logDebug("workspace.source-upload.fallback-inline", {
          error: uploadError,
          requestId: activeRequestId,
          sizeBytes: sourceSizeBytes,
        });
        nextPending = await upsertPendingUpload({
          ...nextPending,
          lastError: "",
          originalSizeBytes: sourceSizeBytes,
          sourceMode: "single",
          status: "uploading",
          storageObject: "",
        }, { context: buildAttemptQueueContext(activeRequestId, "single-inline-fallback") });
        allowInlineSource = true;
        inlineSourceError = "브라우저 임시 오디오 업로드가 실패해 현재 탭의 원본으로만 전사를 이어갑니다.";
        setNotice("브라우저 임시 오디오 업로드가 실패했습니다. 현재 탭의 원본으로만 전사를 이어가며, 다음 새로고침 뒤에는 다시 업로드 대기로 돌아올 수 있습니다.", "warning");
        applyRender();
      }
    }
    return (await startSinglePendingUploadRemoteJob(nextPending, {
      allowInlineSource,
      context: buildAttemptQueueContext(activeRequestId, "single-remote-job-start"),
      inlineSourceError,
      noticeText: allowInlineSource
        ? "브라우저 원본으로 전사를 접수했습니다. 현재 탭을 닫기 전까지 결과를 계속 확인합니다."
        : "자동 전사를 접수했습니다. 결과를 계속 확인하는 중입니다.",
      syncWorkspace: true,
      transitionAction: "single-start",
    })).pending;
  }

  async function attemptPendingUpload(requestId, options = {}) {
    const normalizedRequestId = normalizeText(requestId);
    const pending = state.pendingUploads.find((item) => item.requestId === normalizedRequestId);
    if (!pending || pending.hold || state.busy.queue[normalizedRequestId]) return;
    if (!isOnline(global)) {
      await upsertPendingUpload(
        { ...pending, lastError: "인터넷이 돌아오면 자동으로 업로드합니다.", status: "upload_queued" },
        {
          context: {
            phase: "offline-queued",
            reason: normalizeText(options?.reason) || "offline-queued",
            requestId: normalizedRequestId,
          },
        }
      );
      return applyRender();
    }
    state.busy.queue[normalizedRequestId] = true;
    const attemptPlan = buildPendingUploadAttemptPlan(pending, options);
    const buildAttemptQueueContext = (requestIdValue, phase) => buildPendingUploadTransitionQueueContext(attemptPlan, requestIdValue, phase);
    let activeRequestId = normalizedRequestId;
    try {
      let latest = await upsertPendingUpload(
        { ...attemptPlan.retryBase, lastError: "", status: attemptPlan.nextUploadStatus },
        { context: buildAttemptQueueContext(attemptPlan.retryBase.requestId, "transition-start") }
      );
      if (attemptPlan.shouldResetSource) {
        delete state.busy.queue[normalizedRequestId];
        state.busy.queue[attemptPlan.retryRequestId] = true;
        activeRequestId = latest.requestId;
        delete state.runtimeChunkCache[normalizedRequestId];
        if (
          state.selectedRecordId === ns.shared.buildLocalSelectionId(normalizedRequestId)
          || (attemptPlan.previousRemoteSelectionId && state.selectedRecordId === attemptPlan.previousRemoteSelectionId)
        ) {
          state.selectedRecordId = ns.shared.buildLocalSelectionId(activeRequestId);
        }
        if (state.params.jobId === attemptPlan.previousRemoteJobId) {
          state.params = { ...state.params, jobId: "" };
        }
      }
      announcePendingUploadAttempt(attemptPlan, activeRequestId);
      persistWorkspaceSession();
      applyRender();
      latest = state.pendingUploads.find((item) => item.requestId === activeRequestId) || latest;
      const sourceSizeBytes = Math.max(0, Number(latest?.originalSizeBytes) || Number(latest?.sizeBytes) || Number(latest?.blob?.size) || 0);
      if (sourceSizeBytes > DEFAULT_SOURCE_MAX_BYTES) {
        throw new Error(`현재 회의 원본은 ${Math.floor(DEFAULT_SOURCE_MAX_BYTES / (1024 * 1024))}MB 이하까지만 지원해요.`);
      }
      if (Math.max(0, Number(latest?.durationMs) || 0) > DEFAULT_SOURCE_MAX_DURATION_MS) {
        throw new Error("현재 회의 원본은 최대 2시간까지만 지원해요.");
      }
      if (shouldUseChunkedSource(latest)) {
        latest = await continueChunkedPendingUploadAttempt(latest, buildAttemptQueueContext, activeRequestId, sourceSizeBytes);
      } else {
        latest = await continueSinglePendingUploadAttempt(latest, buildAttemptQueueContext, activeRequestId, sourceSizeBytes);
      }
    } catch (error) {
      const latest = state.pendingUploads.find((item) => item.requestId === activeRequestId);
      if (latest) await upsertPendingUpload(
        { ...latest, lastError: error instanceof Error ? error.message : "업로드를 이어가지 못했어요.", status: isLikelyNetworkError(global, error) ? "upload_queued" : "failed" },
        { context: buildAttemptQueueContext(activeRequestId, "failure-state") }
      );
      setNotice(error instanceof Error ? error.message : "업로드를 이어가지 못했어요.", "error");
      applyRender();
    } finally {
      delete state.busy.queue[activeRequestId];
      delete state.busy.queue[normalizedRequestId];
      applyRender();
    }
  }

  async function buildPendingUploadRemoteMutationPayload(item, options = {}) {
    const extension = inferAudioExtension(normalizeText(item.mimeType || item.blob?.type));
    const fileName = `${state.session.meetingId || "meeting"}-${item.requestId}.${extension}`;
    const source = {
      captureMode: item.captureMode,
      channelCount: item.channelCount,
      durationMs: item.durationMs,
      fileName,
      mimeType: item.mimeType,
      mode: normalizeText(item.sourceMode) || (Array.isArray(item.parts) && item.parts.length ? "chunked" : "single"),
      originalSizeBytes: Math.max(0, Number(item.originalSizeBytes) || Number(item.sizeBytes) || Number(item.blob?.size) || 0),
      requestId: item.requestId,
      sizeBytes: Math.max(0, Number(item.originalSizeBytes) || Number(item.sizeBytes) || Number(item.blob?.size) || 0),
      uploadStatus: normalizeText(item.uploadStatus),
    };
    if (Array.isArray(item.parts) && item.parts.length) {
      source.parts = item.parts.map((part) => ({
        endMs: Math.max(0, Number(part.endMs) || 0),
        index: Math.max(0, Number(part.index) || 0),
        mimeType: "audio/wav",
        overlapMs: Math.max(0, Number(part.overlapMs) || 0),
        requestId: normalizeText(part.requestId),
        sizeBytes: Math.max(0, Number(part.sizeBytes) || 0),
        startMs: Math.max(0, Number(part.startMs) || 0),
        storageObject: normalizeText(part.storageObject),
        uploadStatus: normalizeText(part.uploadStatus),
      }));
    } else if (normalizeText(item.storageObject)) {
      source.storageObject = normalizeText(item.storageObject);
    } else {
      if (!options?.allowInlineSource) {
        throw new Error(
          normalizeText(options?.inlineSourceError)
          || "브라우저 임시 오디오 업로드가 완료되지 않아 원격 작업을 만들 수 없어요."
        );
      }
      source.inlineAudioBase64 = await blobToBase64(item.blob);
    }
    return {
      meeting: { endedAt: item.endedAt, language: "ko", meetingId: state.session.meetingId, sharedMemo: item.sharedMemoSnapshot, startedAt: item.startedAt, title: getWorkspaceTitleOrFallback() },
      options: { redaction: "none", speakerLabels: true, summary: true },
      source,
      context: { sharedMemoSnapshot: item.sharedMemoSnapshot },
    };
  }

  function buildChunkedPendingUploadRemoteReconcilePayload(item) {
    if (normalizeText(item?.sourceMode) !== "chunked") {
      throw new Error("chunked source만 원격 상태 재조정 요청으로 다시 확인할 수 있어요.");
    }
    if (!normalizeText(item?.jobId)) {
      throw new Error("기존 원격 작업 없이 chunk 상태 재조정을 요청할 수 없어요.");
    }
    if (!Array.isArray(item?.parts) || item.parts.length < 1) {
      throw new Error("chunk source 정보가 없어 원격 상태 재조정을 안전하게 요청할 수 없어요.");
    }
    const extension = inferAudioExtension(normalizeText(item.mimeType || item.blob?.type));
    const fileName = `${state.session.meetingId || "meeting"}-${item.requestId}.${extension}`;
    return {
      meeting: {
        endedAt: item.endedAt,
        language: "ko",
        meetingId: state.session.meetingId,
        sharedMemo: item.sharedMemoSnapshot,
        startedAt: item.startedAt,
        title: getWorkspaceTitleOrFallback(),
      },
      options: { redaction: "none", speakerLabels: true, summary: true },
      source: {
        captureMode: item.captureMode,
        channelCount: item.channelCount,
        durationMs: item.durationMs,
        fileName,
        mimeType: item.mimeType,
        mode: "chunked",
        originalSizeBytes: Math.max(0, Number(item.originalSizeBytes) || Number(item.sizeBytes) || Number(item.blob?.size) || 0),
        parts: item.parts.map((part) => ({
          endMs: Math.max(0, Number(part.endMs) || 0),
          index: Math.max(0, Number(part.index) || 0),
          mimeType: "audio/wav",
          overlapMs: Math.max(0, Number(part.overlapMs) || 0),
          requestId: normalizeText(part.requestId),
          sizeBytes: Math.max(0, Number(part.sizeBytes) || 0),
          startMs: Math.max(0, Number(part.startMs) || 0),
          storageObject: normalizeText(part.storageObject),
          uploadStatus: normalizeText(part.uploadStatus),
        })),
        requestId: item.requestId,
        sizeBytes: Math.max(0, Number(item.originalSizeBytes) || Number(item.sizeBytes) || Number(item.blob?.size) || 0),
        uploadStatus: normalizeText(item.uploadStatus),
      },
      context: { sharedMemoSnapshot: item.sharedMemoSnapshot },
    };
  }

  async function requestPendingUploadRemoteMutationState(item, options = {}) {
    const response = await postJson(global, CONFIG.createJobUrl, await buildPendingUploadRemoteMutationPayload(item, {
      allowInlineSource: Boolean(options?.allowInlineSource),
      inlineSourceError: normalizeText(options?.inlineSourceError),
    }), state.session.meetingSessionToken, {
      timeoutMs: DEFAULT_CREATE_JOB_TIMEOUT_MS,
    });
    return normalizeJob(response?.job, item.meetingTitleSnapshot);
  }

  async function requestChunkedPendingUploadRemoteReconcileState(item) {
    const response = await postJson(
      global,
      CONFIG.createJobUrl,
      buildChunkedPendingUploadRemoteReconcilePayload(item),
      state.session.meetingSessionToken,
      { timeoutMs: DEFAULT_CREATE_JOB_TIMEOUT_MS }
    );
    return normalizeJob(response?.job, item.meetingTitleSnapshot);
  }

  async function renameCreatedMeetingResultAfterStart(previousJobId, createdJob, item, logKey) {
    if (
      !createdJob?.jobId
      || (previousJobId && previousJobId === normalizeText(createdJob.jobId))
      || !item?.meetingTitleSnapshot
      || item.meetingTitleSnapshot === getWorkspaceTitleOrFallback()
    ) {
      return;
    }
    try {
      await postJson(global, CONFIG.updateMeetingResultUrl, {
        jobId: createdJob.jobId,
        meetingId: state.session.meetingId,
        title: item.meetingTitleSnapshot,
      }, state.session.meetingSessionToken);
    } catch (renameError) {
      logDebug(logKey, {
        error: renameError,
        jobId: createdJob.jobId,
        recordTitle: item.meetingTitleSnapshot,
      });
    }
  }

  async function commitSinglePendingUploadRemoteStart(item, createdJob, options = {}) {
    const previousJobId = normalizeText(item?.jobId);
    const queueContext = normalizePendingUploadQueueContext({
      requestId: item?.requestId,
      ...(options?.context || {}),
    });
    const transition = buildPendingUploadRemoteStartTransition(item, createdJob, {
      action: "single-start",
      awaitingMoreUploads: false,
    });
    if (!transition?.nextPending) {
      const transitionErrorMessage = normalizeText(transition?.errorMessage) || "원격 single 작업 상태를 확인하지 못해 업로드를 이어갈 수 없어요.";
      logDebug("workspace.pending-upload.single-start.invalid-status", {
        action: "single-start",
        error: transitionErrorMessage,
        jobId: normalizeText(createdJob?.jobId),
        remoteStatus: normalizeText(transition?.remoteStatus),
        requestId: normalizeText(item?.requestId),
      });
      throw new Error(transitionErrorMessage);
    }
    const nextPending = await commitPendingUploadRemoteMutationTransition(item, transition, {
      applySelectedRecordTransition: true,
      queueContext,
    });
    const resolution = normalizeText(transition?.resolution);
    logDebug("workspace.pending-upload.single-start.applied", {
      action: "single-start",
      jobId: normalizeText(nextPending?.jobId),
      publishedPartCount: Math.max(0, Number(nextPending?.publishedPartCount) || 0),
      remoteStatus: normalizeText(createdJob?.status),
      requestId: normalizeText(nextPending?.requestId),
      resolution,
      status: normalizeText(nextPending?.status),
      uploadedPartCount: Math.max(0, Number(nextPending?.uploadedPartCount) || 0),
    });
    await renameCreatedMeetingResultAfterStart(previousJobId, createdJob, item, "workspace.record.rename.after-single-start.error");
    return {
      createdJob,
      degraded: false,
      pending: nextPending,
      resolution,
    };
  }

  async function commitChunkedPendingUploadRemoteStart(item, createdJob, options = {}) {
    const previousJobId = normalizeText(item?.jobId);
    const queueContext = normalizePendingUploadQueueContext({
      requestId: item?.requestId,
      ...(options?.context || {}),
    });
    const allChunksUploaded = Math.max(0, Number(item?.uploadedPartCount) || 0) >= Math.max(0, Number(item?.preparedPartCount) || 0);
    const transition = buildPendingUploadRemoteStartTransition(item, createdJob, {
      action: "chunk-start",
      awaitingMoreUploads: !allChunksUploaded,
    });
    if (!transition?.nextPending) {
      const transitionErrorMessage = normalizeText(transition?.errorMessage) || "원격 chunk 시작 상태를 확인하지 못해 업로드를 이어갈 수 없어요.";
      logDebug("workspace.pending-upload.chunk-start.invalid-status", {
        action: "chunk-start",
        error: transitionErrorMessage,
        jobId: normalizeText(createdJob?.jobId),
        remoteStatus: normalizeText(transition?.remoteStatus),
        requestId: normalizeText(item?.requestId),
      });
      throw new Error(transitionErrorMessage);
    }
    const nextPending = await commitPendingUploadRemoteMutationTransition(item, transition, {
      applySelectedRecordTransition: true,
      queueContext,
    });
    const resolution = normalizeText(transition?.resolution);
    logDebug("workspace.pending-upload.chunk-start.applied", {
      action: "chunk-start",
      jobId: normalizeText(nextPending?.jobId),
      publishedPartCount: Math.max(0, Number(nextPending?.publishedPartCount) || 0),
      remoteStatus: normalizeText(createdJob?.status),
      requestId: normalizeText(nextPending?.requestId),
      resolution,
      status: normalizeText(nextPending?.status),
      uploadedPartCount: Math.max(0, Number(nextPending?.uploadedPartCount) || 0),
    });
    await renameCreatedMeetingResultAfterStart(previousJobId, createdJob, item, "workspace.record.rename.after-chunk-start.error");
    return {
      createdJob,
      degraded: false,
      pending: nextPending,
      resolution,
    };
  }

  async function startSinglePendingUploadRemoteJob(item, options = {}) {
    const transitionAction = normalizeText(options?.transitionAction);
    if (transitionAction !== "single-start") {
      throw new Error("single source 원격 시작 action이 없어 업로드 결과를 안전하게 확정할 수 없어요.");
    }
    if (normalizeText(item?.sourceMode) === "chunked") {
      throw new Error("chunked source는 single 원격 시작 경로로 보낼 수 없어요.");
    }
    const createdJob = await requestPendingUploadRemoteMutationState(item, {
      allowInlineSource: Boolean(options?.allowInlineSource),
      inlineSourceError: normalizeText(options?.inlineSourceError),
    });
    const result = await commitSinglePendingUploadRemoteStart(item, createdJob, options);
    if (normalizeText(options?.noticeText)) {
      setNotice(normalizeText(options.noticeText), "highlight");
      applyRender();
    }
    if (options?.syncWorkspace) {
      await syncWorkspaceLocalState(false, "workflow");
    }
    return result;
  }

  async function startChunkedPendingUploadRemoteJob(item, options = {}) {
    const transitionAction = normalizeText(options?.transitionAction);
    if (transitionAction !== "chunk-start") {
      throw new Error("chunk source 원격 시작 action이 없어 업로드 결과를 안전하게 확정할 수 없어요.");
    }
    if (normalizeText(item?.sourceMode) !== "chunked") {
      throw new Error("chunk 원격 시작은 chunked source에서만 실행할 수 있어요.");
    }
    if (Math.max(0, Number(item?.uploadedPartCount) || 0) < 1) {
      throw new Error("올라간 청크 없이 원격 chunk 작업을 시작할 수 없어요.");
    }
    const createdJob = await requestPendingUploadRemoteMutationState(item);
    const result = await commitChunkedPendingUploadRemoteStart(item, createdJob, options);
    if (normalizeText(options?.noticeText)) {
      setNotice(normalizeText(options.noticeText), "highlight");
      applyRender();
    }
    if (options?.syncWorkspace) {
      await syncWorkspaceLocalState(false, "workflow");
    }
    return result;
  }

  async function publishPendingUploadRemoteChunks(item, options = {}) {
    const transitionAction = normalizeText(options?.transitionAction);
    if (transitionAction !== "chunk-publish") {
      throw new Error("원격 chunk publish action이 없어 추가 청크 반영 결과를 안전하게 확정할 수 없어요.");
    }
    if (!normalizeText(item?.jobId)) {
      throw new Error("기존 원격 작업 없이 추가 청크 publish를 이어갈 수 없어요.");
    }
    const queueContext = normalizePendingUploadQueueContext({
      requestId: item?.requestId,
      ...(options?.context || {}),
    });
    const remoteJob = await requestPendingUploadRemoteMutationState(item);
    const allChunksUploaded = Math.max(0, Number(item?.uploadedPartCount) || 0) >= Math.max(0, Number(item?.preparedPartCount) || 0);
    const transition = buildPendingUploadRemotePublishTransition(item, remoteJob, {
      action: transitionAction,
      awaitingMoreUploads: !allChunksUploaded,
    });
    if (!transition?.nextPending) {
      const transitionErrorMessage = normalizeText(transition?.errorMessage) || "원격 작업 상태를 확인하지 못해 추가 청크 반영을 이어갈 수 없어요.";
      logDebug("workspace.pending-upload.chunk-publish.invalid-status", {
        action: transitionAction,
        error: transitionErrorMessage,
        jobId: normalizeText(remoteJob?.jobId || item?.jobId),
        remoteStatus: normalizeText(transition?.remoteStatus),
        requestId: normalizeText(item?.requestId),
      });
      throw new Error(transitionErrorMessage);
    }
    const nextPending = await commitPendingUploadRemoteMutationTransition(item, transition, {
      queueContext,
    });
    const resolution = normalizeText(transition?.resolution);
    logDebug("workspace.pending-upload.chunk-publish.applied", {
      action: transitionAction,
      jobId: normalizeText(nextPending?.jobId),
      publishedPartCount: Math.max(0, Number(nextPending?.publishedPartCount) || 0),
      remoteStatus: normalizeText(remoteJob?.status),
      requestId: normalizeText(nextPending?.requestId),
      resolution,
      status: normalizeText(nextPending?.status),
      uploadedPartCount: Math.max(0, Number(nextPending?.uploadedPartCount) || 0),
    });
    return {
      remoteJob,
      degraded: false,
      pending: nextPending,
      resolution,
    };
  }

  async function reconcileChunkedPendingUploadRemoteState(item, options = {}) {
    const transitionAction = normalizeText(options?.transitionAction);
    if (transitionAction !== "chunk-resync") {
      throw new Error("원격 chunk resync action이 없어 브라우저 보관 상태를 안전하게 유지할 수 없어요.");
    }
    const queueContext = normalizePendingUploadQueueContext({
      requestId: item?.requestId,
      ...(options?.context || {}),
    });
    let remoteState = null;
    try {
      remoteState = await requestChunkedPendingUploadRemoteReconcileState(item);
    } catch (error) {
      const degradedMessage = error instanceof Error
        ? `${error.message} 브라우저 보관 상태는 그대로 두고 다음 동기화에서 원격 상태를 다시 확인합니다.`
        : "원격 작업 상태를 다시 확인하지 못해 브라우저 보관 상태를 그대로 유지합니다.";
      logDebug("workspace.pending-upload.chunk-resync.degraded", {
        action: transitionAction,
        error,
        jobId: normalizeText(item?.jobId),
        requestId: normalizeText(item?.requestId),
      });
      setNotice(degradedMessage, "warning");
      applyRender();
      return { degraded: true, pending: item, remoteState: null, resolution: "" };
    }
    const allChunksUploaded = Math.max(0, Number(item?.uploadedPartCount) || 0) >= Math.max(0, Number(item?.preparedPartCount) || 0);
    const transition = buildChunkedPendingUploadRemoteResyncTransition(item, remoteState, {
      awaitingMoreUploads: !allChunksUploaded,
    });
    if (!transition?.nextPending) {
      const transitionErrorMessage = normalizeText(transition?.errorMessage) || "원격 작업 상태를 다시 확인하지 못해 브라우저 보관 상태를 그대로 유지합니다.";
      logDebug("workspace.pending-upload.chunk-resync.degraded", {
        action: transitionAction,
        error: transitionErrorMessage,
        jobId: normalizeText(remoteState?.jobId || item?.jobId),
        remoteStatus: normalizeText(transition?.remoteStatus),
        requestId: normalizeText(item?.requestId),
      });
      setNotice(transitionErrorMessage, "warning");
      applyRender();
      return { degraded: true, pending: item, remoteState, resolution: "" };
    }
    const nextPending = await commitChunkedPendingUploadRemoteResyncTransition(item, transition, queueContext);
    const resolution = normalizeText(transition?.resolution);
    logDebug("workspace.pending-upload.chunk-resync.applied", {
      action: transitionAction,
      jobId: normalizeText(nextPending?.jobId),
      publishedPartCount: Math.max(0, Number(nextPending?.publishedPartCount) || 0),
      remoteStatus: normalizeText(remoteState?.status),
      requestId: normalizeText(nextPending?.requestId),
      resolution,
      status: normalizeText(nextPending?.status),
      uploadedPartCount: Math.max(0, Number(nextPending?.uploadedPartCount) || 0),
    });
    return {
      degraded: false,
      pending: nextPending,
      remoteState,
      resolution,
    };
  }
  async function uploadPendingSource(item, override = {}) {
    const requestId = normalizeText(override.requestId || item?.requestId);
    if (!requestId) {
      throw new Error("업로드 requestId가 비어 있어요.");
    }
    const blob = override.blob instanceof global.Blob ? override.blob : (item?.blob instanceof global.Blob ? item.blob : null);
    if (!blob || Number(blob.size) <= 0) {
      throw new Error("업로드할 오디오 원본이 비어 있어요.");
    }
    const mimeType = normalizeText(override.mimeType || item.mimeType || blob.type) || "application/octet-stream";
    const extension = inferAudioExtension(mimeType);
    const url = new URL(CONFIG.uploadSourceUrl);
    url.searchParams.set("captureMode", normalizeText(item.captureMode) || "microphone");
    url.searchParams.set("channelCount", String(Math.max(1, Number(item.channelCount) || 1)));
    url.searchParams.set("durationMs", String(Math.max(0, Number(override.durationMs) || Number(item.durationMs) || 0)));
    url.searchParams.set("fileName", normalizeText(override.fileName) || `${state.session.meetingId || "meeting"}-${requestId}.${extension}`);
    url.searchParams.set("meetingId", normalizeText(state.session.meetingId));
    if (normalizeText(override.parentRequestId)) url.searchParams.set("parentRequestId", normalizeText(override.parentRequestId));
    if (Number.isFinite(Number(override.partCount)) && Number(override.partCount) > 0) url.searchParams.set("partCount", String(Math.max(0, Number(override.partCount) || 0)));
    if (Number.isFinite(Number(override.partIndex)) && Number(override.partIndex) >= 0) url.searchParams.set("partIndex", String(Math.max(0, Number(override.partIndex) || 0)));
    url.searchParams.set("requestId", requestId);
    if (Number.isFinite(Number(override.startMs)) && Number(override.startMs) >= 0) url.searchParams.set("startMs", String(Math.max(0, Number(override.startMs) || 0)));
    if (Number.isFinite(Number(override.endMs)) && Number(override.endMs) >= 0) url.searchParams.set("endMs", String(Math.max(0, Number(override.endMs) || 0)));
    if (Number.isFinite(Number(override.overlapMs)) && Number(override.overlapMs) >= 0) url.searchParams.set("overlapMs", String(Math.max(0, Number(override.overlapMs) || 0)));
    url.searchParams.set("sizeBytes", String(Math.max(0, Number(override.sizeBytes) || Number(item.sizeBytes) || Number(blob.size) || 0)));

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutMs = Math.max(1000, DEFAULT_SOURCE_UPLOAD_TIMEOUT_MS);
    const timeoutId = controller ? global.setTimeout(() => controller.abort(), timeoutMs) : 0;
    const token = normalizeText(state.session.meetingSessionToken);
    const headers = {
      "Content-Type": mimeType,
    };
    if (token) {
      headers.Authorization = `MeetingSession ${token}`;
    }
    logDebug("workspace.source-upload.request", {
      hasMeetingSessionToken: Boolean(token),
      parentRequestId: normalizeText(override.parentRequestId),
      partCount: Math.max(0, Number(override.partCount) || 0),
      partIndex: Math.max(0, Number(override.partIndex) || 0),
      requestId,
      sizeBytes: Math.max(0, Number(override.sizeBytes) || Number(item.sizeBytes) || Number(blob.size) || 0),
      timeoutMs,
      url: url.toString(),
    });
    try {
      const response = await global.fetch(url.toString(), {
        body: blob,
        headers,
        method: "POST",
        signal: controller?.signal,
      });
      const payload = await response.json().catch(() => null);
      logDebug("workspace.source-upload.response", {
        ok: Boolean(response.ok && payload?.ok),
        payload,
        requestId,
        status: Number(response.status) || 0,
        url: url.toString(),
      });
      if (!response.ok || !payload?.ok) {
        throw new Error(normalizeText(payload?.error || payload?.message) || "오디오 원본 업로드에 실패했어요.");
      }
      return payload.data || {};
    } catch (error) {
      if (error?.name === "AbortError") {
        logDebug("workspace.source-upload.timeout", {
          requestId,
          url: url.toString(),
        });
        throw new Error("오디오 원본 업로드 응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.");
      }
      logDebug("workspace.source-upload.error", {
        error,
        requestId,
        url: url.toString(),
      });
      throw error;
    } finally {
      if (timeoutId) {
        global.clearTimeout(timeoutId);
      }
    }
  }

  function inferSourceMode(sizeBytes, durationMs) {
    return requiresChunkedSource(sizeBytes, durationMs) ? "chunked" : "single";
  }

  function requiresChunkedSource(sizeBytes, durationMs) {
    return Math.max(0, Number(sizeBytes) || 0) > DEFAULT_SOURCE_TARGET_PART_BYTES
      || Math.max(0, Number(durationMs) || 0) > DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS;
  }

  function shouldUseChunkedSource(item) {
    const pending = normalizePendingUpload(item);
    return normalizeText(pending.sourceMode) === "chunked"
      || requiresChunkedSource(
        Number(pending.originalSizeBytes) || Number(pending.sizeBytes) || Number(pending.blob?.size) || 0,
        Number(pending.durationMs) || 0
      );
  }

  async function getOrPrepareChunkedSource(item) {
    const pending = normalizePendingUpload(item);
    const cacheKey = normalizeText(pending.requestId);
    const cached = state.runtimeChunkCache[cacheKey];
    if (cached && Math.max(0, Number(cached.originalSizeBytes) || 0) === Math.max(0, Number(pending.originalSizeBytes) || Number(pending.sizeBytes) || 0)) {
      const mergedCachedParts = cached.parts.map((part) => {
        const persisted = (pending.parts || []).find((entry) => Number(entry.index) === Number(part.index)) || {};
        return {
          ...part,
          storageObject: normalizeText(persisted.storageObject) || normalizeText(part.storageObject),
          uploadStatus: normalizeText(persisted.uploadStatus) || normalizeText(part.uploadStatus),
        };
      });
      state.runtimeChunkCache[cacheKey] = {
        ...cached,
        parts: mergedCachedParts,
      };
      return state.runtimeChunkCache[cacheKey];
    }
    const blob = pending.blob instanceof global.Blob ? pending.blob : null;
    if (!blob || Number(blob.size) <= 0) {
      throw new Error("분할 준비할 오디오 원본이 비어 있어요.");
    }
    const prepared = await prepareAudioSourceChunks(blob, {
      chunkDurationMs: DEFAULT_SOURCE_CHUNK_DURATION_MS,
      durationMs: pending.durationMs,
      maxBytes: DEFAULT_SOURCE_MAX_BYTES,
      maxDurationMs: DEFAULT_SOURCE_MAX_DURATION_MS,
      overlapMs: DEFAULT_SOURCE_CHUNK_OVERLAP_MS,
    });
    const previousParts = Array.isArray(pending.parts) ? pending.parts : [];
    const normalizedParts = prepared.parts.map((part, index) => {
      const previous = previousParts.find((entry) => Number(entry.index) === index) || {};
      return {
        blob: part.blob,
        endMs: Math.max(0, Number(part.endMs) || 0),
        index,
        overlapMs: Math.max(0, Number(part.overlapMs) || 0),
        requestId: normalizeText(previous.requestId) || buildPendingPartRequestId(pending.requestId, index),
        sizeBytes: Math.max(0, Number(part.sizeBytes) || Number(part.blob?.size) || 0),
        startMs: Math.max(0, Number(part.startMs) || 0),
        storageObject: normalizeText(previous.storageObject),
        uploadStatus: normalizeText(previous.uploadStatus) || (normalizeText(previous.storageObject) ? "uploaded" : ""),
      };
    });
    const preparedSource = {
      mimeType: prepared.mimeType,
      originalSizeBytes: Math.max(0, Number(pending.originalSizeBytes) || Number(pending.sizeBytes) || Number(blob.size) || 0),
      parts: normalizedParts,
    };
    state.runtimeChunkCache[cacheKey] = preparedSource;
    return preparedSource;
  }

  async function updatePendingChunkUploadState(requestId, partIndex, uploaded, options = {}) {
    const current = state.pendingUploads.find((item) => item.requestId === normalizeText(requestId));
    if (!current) {
      throw new Error("업로드 상태를 갱신할 기록을 찾지 못했어요.");
    }
    const nextParts = (Array.isArray(current.parts) ? current.parts : []).map((part) => (
      Number(part.index) === Number(partIndex)
        ? {
            ...part,
            sizeBytes: Math.max(0, Number(uploaded?.sizeBytes) || Number(part.sizeBytes) || 0),
            storageObject: normalizeText(uploaded?.storageObject),
            uploadStatus: normalizeText(uploaded?.uploadStatus) || "uploaded",
          }
        : part
    ));
    const nextPending = await upsertPendingUpload({
      ...current,
      lastError: "",
      parts: nextParts,
      preparedPartCount: nextParts.length,
      status: "uploading_chunks",
      uploadedPartCount: nextParts.filter((part) => normalizeText(part.storageObject)).length,
      updatedAt: new Date().toISOString(),
    }, {
      context: normalizePendingUploadQueueContext({
        requestId,
        ...(options?.context || {}),
      }),
    });
    if (state.runtimeChunkCache[normalizeText(requestId)]) {
      state.runtimeChunkCache[normalizeText(requestId)] = {
        ...state.runtimeChunkCache[normalizeText(requestId)],
        parts: state.runtimeChunkCache[normalizeText(requestId)].parts.map((part) => (
          Number(part.index) === Number(partIndex)
            ? {
                ...part,
                storageObject: normalizeText(uploaded?.storageObject),
                uploadStatus: normalizeText(uploaded?.uploadStatus) || "uploaded",
              }
            : part
        )),
      };
    }
    return nextPending;
  }

  function buildPendingPartRequestId(requestId, partIndex) {
    return `${normalizeText(requestId) || "meeting-source"}-part-${String(Math.max(0, Number(partIndex) || 0)).padStart(4, "0")}`;
  }

  function buildChunkPartFileName(item, partIndex) {
    return `${state.session.meetingId || "meeting"}-${normalizeText(item?.requestId) || "source"}-part-${String(Math.max(0, Number(partIndex) || 0)).padStart(4, "0")}.wav`;
  }

  async function saveMeetingTitle() { return saveMeetingPatch({ title: normalizeText(state.meetingTitleDraft || refs.meetingTitleInput.value) }, "작업실 이름을 저장했습니다.", "작업실 이름을 먼저 입력해 주세요."); }
  async function saveSharedMemo() {
    updateRecordMemoDraft(refs.sharedMemoInput.value);
    setNotice(state.recordMemoDraft ? "현재 기록 메모를 자동 보관했습니다." : "현재 기록 메모를 비웠습니다.", "highlight");
    applyRender();
  }
  async function clearSharedMemo() {
    refs.sharedMemoInput.value = "";
    state.recordMemoDraft = "";
    state.recordMemoSaved = "";
    state.session.sharedMemo = "";
    persistWorkspaceSession();
    refs.sharedMemoNotice.hidden = true;
    refs.sharedMemoNotice.textContent = "";
    setNotice("현재 기록 메모를 비웠습니다.", "highlight");
    applyRender();
  }

  async function saveMeetingPatch(patch, successMessage, emptyMessage) {
    if (!state.session.meetingId) return;
    if ("title" in patch && !patch.title && emptyMessage) { setNotice(emptyMessage, "error"); return applyRender(); }
    state.busy.saveMeetingTitle = "title" in patch;
    state.busy.saveMeetingMemo = "sharedMemo" in patch;
    Object.assign(state.meeting, patch);
    Object.assign(state.session, patch);
    persistWorkspaceSession();
    applyRender();
    try {
      const payload = await postJson(global, CONFIG.updateMeetingTitleUrl, { meetingId: state.session.meetingId, ...patch }, state.session.meetingSessionToken);
      state.meeting.title = normalizeText(payload?.meeting?.title || state.meeting.title);
      state.session.title = state.meeting.title;
      if ("title" in patch) {
        state.meetingTitleDraft = state.meeting.title;
      }
      setNotice(successMessage, "highlight");
      await syncWorkspaceLocalState(false, "workflow");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "작업실 정보를 저장하지 못했어요.", "error");
      applyRender();
    } finally {
      state.busy.saveMeetingTitle = false;
      state.busy.saveMeetingMemo = false;
      applyRender();
    }
  }

  async function saveCurrentRecordTitle() {
    return saveRecordTitleForEntry(state.selectedRecordId, refs.recordTitleInput.value);
  }

  function downloadCurrentRecord() {
    const entry = findHistoryEntry(state, state.selectedRecordId);
    const pending = entry?.pending;
    const blob = pending?.blob instanceof global.Blob ? pending.blob : null;
    if (!blob || Number(blob.size) <= 0) {
      setNotice("브라우저에 남아 있는 녹음 사본이 없어 다운로드할 수 없습니다.", "warning");
      applyRender();
      return;
    }
    const extension = inferAudioExtension(normalizeText(pending.mimeType || blob.type));
    const filename = buildDownloadFileName(
      normalizeText(pending.meetingTitleSnapshot || state.currentJob?.title || state.meeting.title || "recording"),
      normalizeText(pending.requestId),
      extension
    );
    const objectUrl = global.URL.createObjectURL(blob);
    const link = global.document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    global.document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(() => global.URL.revokeObjectURL(objectUrl), 1000);
    setNotice("브라우저에 보관 중인 녹음을 다운로드했습니다.", "highlight");
    applyRender();
  }

  async function deleteCurrentRecord(recordId = state.selectedRecordId) {
    const normalizedRecordId = recordId instanceof global.Event ? state.selectedRecordId : recordId;
    const entry = findHistoryEntry(state, normalizedRecordId);
    if (!entry) return;
    if (!entry.remote?.jobId && entry.pending?.requestId) {
      return handleLocalQueueAction("delete", entry.pending.requestId);
    }
    if (!entry.remote?.jobId) return;
    if (!await requestConfirmation({
      body: "전사와 정리 결과가 함께 삭제되며, 되돌릴 수 없습니다.",
      confirmLabel: "기록 삭제",
      eyebrow: "기록 삭제",
      title: "선택한 기록을 삭제할까요?",
      tone: "danger",
    })) return;
    state.busy.deleteRecord = true;
    applyRender();
    try {
      await postJson(global, CONFIG.deleteMeetingResultUrl, { jobId: entry.remote.jobId, meetingId: state.session.meetingId }, state.session.meetingSessionToken);
      if (entry.pending?.requestId) {
        await deletePendingUpload(entry.pending.requestId, {
          context: {
            phase: "record-delete",
            reason: "record-delete",
          },
        });
      }
      state.records = state.records.filter((record) => normalizeText(record.jobId) !== normalizeText(entry.remote.jobId));
      state.selectedRecordId = "";
      setNotice("선택한 기록을 삭제했습니다.", "highlight");
      await syncWorkspaceLocalState(true, "workflow");
    } finally {
      state.busy.deleteRecord = false;
      applyRender();
    }
  }

  async function deleteMeeting() {
    if (!state.session.meetingId) return;
    if (!await requestConfirmation({
      body: "작업실에 연결된 기록, 산출물, 남아 있는 임시 원본까지 함께 정리합니다. 처리 중인 기록이 있으면 삭제할 수 없습니다.",
      confirmLabel: "작업실 삭제",
      eyebrow: "작업실 삭제",
      title: "이 작업실 전체를 삭제할까요?",
      tone: "danger",
    })) return;
    state.busy.deleteMeeting = true;
    applyRender();
    try {
      await postJson(global, CONFIG.deleteMeetingUrl, { meetingId: state.session.meetingId }, state.session.meetingSessionToken);
      await runPendingUploadQueueOperation(
        () => state.queueStore.clearMeeting(state.session.meetingId),
        {
          context: {
            phase: "workspace-delete",
            reason: "workspace-delete",
          },
          scope: PENDING_UPLOAD_QUEUE_OPERATION_SCOPES.cleanup,
        }
      );
      clearWorkspaceSession();
      renderBlocked("이 탭은 여기까지입니다. 필요할 때 i-Nova 패널에서 새 작업실을 열어 주세요.", {
        eyebrow: "작업실 삭제 완료",
        title: "작업실을 삭제했습니다",
        tone: "complete",
      });
    } finally {
      state.busy.deleteMeeting = false;
    }
  }

  async function regenerateNotes() {
    const entry = findHistoryEntry(state, state.selectedRecordId);
    if (!entry?.remote?.jobId) return;
    state.busy.regenerateNotes = true;
    applyRender();
    try {
      state.notesStyleSelection = normalizeText(refs.notesStyleSelect.value);
      const payload = await postJson(global, CONFIG.regenerateNotesUrl, { jobId: entry.remote.jobId, meetingId: state.session.meetingId, notesStyle: normalizeText(refs.notesStyleSelect.value), sharedMemo: normalizeTextBlock(state.currentJob?.sharedMemoSnapshot) }, state.session.meetingSessionToken);
      state.currentJob = normalizeJob(payload?.job, state.currentJob?.title || state.meeting.title);
      state.currentArtifact = normalizeArtifact(payload?.artifact);
      state.notesStyleSelection = normalizeText(state.currentArtifact?.notesStyleSelected || state.currentJob?.notesStyleSelected || state.notesStyleSelection);
      state.reviewTab = "notes";
      setNotice("표현 방식을 반영해 회의 정리를 다시 만들었습니다.", "highlight");
      await syncWorkspaceLocalState(false, "workflow");
    } finally {
      state.busy.regenerateNotes = false;
      applyRender();
    }
  }

  async function handleRecordListClick(event) {
    const actionButton = event.target.closest("[data-local-action]");
    if (actionButton instanceof global.HTMLElement) return handleLocalQueueAction(actionButton.dataset.localAction, actionButton.dataset.requestId);
    const target = event.target.closest("[data-record-id]");
    if (!(target instanceof global.HTMLElement)) return;
    state.selectedRecordId = normalizeText(target.dataset.recordId);
    state.reviewTab = "notes";
    persistWorkspaceSession();
    await hydrateSelectedDetail();
    applyRender();
  }

  function collectCurrentSpeakerLabels() {
    return Array.from(
      new Set(
        (Array.isArray(state.currentArtifact?.segments) ? state.currentArtifact.segments : Array.isArray(state.currentJob?.transcript?.segments) ? state.currentJob.transcript.segments : [])
          .map((segment) => normalizeText(segment?.speakerLabel))
          .filter(Boolean)
      )
    );
  }

  function getCurrentSpeakerAliases() {
    return normalizeSpeakerAliases({
      ...(state.currentArtifact?.speakerAliases || {}),
      ...(state.currentJob?.speakerAliases || {}),
    });
  }

  function syncSpeakerAliasDrafts(forceReset) {
    const recordId = normalizeText(state.selectedRecordId);
    const speakerLabels = collectCurrentSpeakerLabels();
    if (!recordId || !speakerLabels.length) {
      state.speakerAliasDraftRecordId = recordId;
      state.speakerAliasDrafts = Object.create(null);
      return;
    }
    const savedAliases = getCurrentSpeakerAliases();
    const reuseDrafts = !forceReset && state.speakerAliasDraftRecordId === recordId;
    const nextDrafts = Object.create(null);
    for (const speakerLabel of speakerLabels) {
      const nextValue = normalizeText(
        reuseDrafts
          ? state.speakerAliasDrafts?.[speakerLabel] || savedAliases?.[speakerLabel]
          : savedAliases?.[speakerLabel]
      );
      if (nextValue) {
        nextDrafts[speakerLabel] = nextValue;
      }
    }
    state.speakerAliasDraftRecordId = recordId;
    state.speakerAliasDrafts = nextDrafts;
  }

  function areSpeakerAliasMapsEqual(left, right) {
    const leftKeys = Object.keys(left || {}).sort();
    const rightKeys = Object.keys(right || {}).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key, index) => key === rightKeys[index] && normalizeText(left[key]) === normalizeText(right[key]));
  }

  function updateSpeakerAliasActionButtons() {
    if (!refs.saveSpeakerAliasesButton || !refs.saveSpeakerAliasesAndRegenerateButton) return;
    const speakerLabels = collectCurrentSpeakerLabels();
    const activeEntry = findHistoryEntry(state, state.selectedRecordId);
    const canEdit = Boolean(activeEntry?.remote?.jobId) && speakerLabels.length > 0;
    const allowedLabels = new Set(speakerLabels);
    const savedAliases = normalizeSpeakerAliases(getCurrentSpeakerAliases(), allowedLabels);
    const draftAliases = normalizeSpeakerAliases(state.speakerAliasDrafts, allowedLabels);
    const isDirty = !areSpeakerAliasMapsEqual(savedAliases, draftAliases);
    refs.saveSpeakerAliasesButton.disabled = !canEdit || state.busy.saveSpeakerAliases || !isDirty;
    refs.saveSpeakerAliasesButton.textContent = state.busy.saveSpeakerAliases ? "저장 중" : isDirty ? "화자명 저장" : "저장됨";
    refs.saveSpeakerAliasesAndRegenerateButton.disabled = !canEdit || state.busy.saveSpeakerAliases || state.busy.regenerateNotes || !isDirty;
    refs.saveSpeakerAliasesAndRegenerateButton.textContent = state.busy.regenerateNotes ? "정리 중" : "저장 후 다시 정리";
  }

  function handleSpeakerAliasInput(event) {
    const target = event?.target;
    if (!(target instanceof global.HTMLInputElement)) return;
    const speakerLabel = normalizeText(target.dataset.speakerLabel);
    if (!speakerLabel) return;
    const nextDrafts = { ...state.speakerAliasDrafts };
    const nextAlias = normalizeTextBlock(target.value).replace(/\n+/g, " ").replace(/\s+/g, " ").slice(0, 80);
    if (target.value !== nextAlias) {
      target.value = nextAlias;
    }
    if (nextAlias) {
      nextDrafts[speakerLabel] = nextAlias;
    } else {
      delete nextDrafts[speakerLabel];
    }
    state.speakerAliasDraftRecordId = normalizeText(state.selectedRecordId);
    state.speakerAliasDrafts = nextDrafts;
    updateSpeakerAliasActionButtons();
  }

  function getCurrentRecordTitleForMutation(entry) {
    const activeInputValue = global.document.activeElement === refs.recordTitleInput
      ? refs.recordTitleInput?.value
      : "";
    return normalizeText(
      activeInputValue
      || refs.recordTitleInput?.value
      || state.currentJob?.title
      || entry?.remote?.title
      || entry?.pending?.meetingTitleSnapshot
      || state.meeting.title
      || state.session.title
      || "새 기록"
    );
  }

  async function saveSpeakerAliases(options = {}) {
    const entry = findHistoryEntry(state, state.selectedRecordId);
    if (!entry?.remote?.jobId) return;
    const speakerLabels = collectCurrentSpeakerLabels();
    if (!speakerLabels.length) return;
    const nextSpeakerAliases = normalizeSpeakerAliases(state.speakerAliasDrafts, new Set(speakerLabels));
    const currentRecordTitle = getCurrentRecordTitleForMutation(entry);
    state.busy.saveSpeakerAliases = true;
    applyRender();
    try {
      const savePayload = await postJson(
        global,
        CONFIG.updateMeetingResultUrl,
        {
          jobId: entry.remote.jobId,
          meetingId: state.session.meetingId,
          speakerAliases: nextSpeakerAliases,
          title: currentRecordTitle,
        },
        state.session.meetingSessionToken
      );
      state.currentJob = normalizeJob(savePayload?.job, state.currentJob?.title || state.meeting.title);
      if (state.currentArtifact) {
        state.currentArtifact = normalizeArtifact({
          ...state.currentArtifact,
          speakerAliases: nextSpeakerAliases,
        });
      }
      syncSpeakerAliasDrafts(true);
      if (options?.regenerateAfterSave) {
        state.busy.regenerateNotes = true;
        applyRender();
        state.notesStyleSelection = normalizeText(refs.notesStyleSelect.value || state.notesStyleSelection || state.currentJob?.notesStyleSelected);
        const regeneratePayload = await postJson(
          global,
          CONFIG.regenerateNotesUrl,
          {
            jobId: entry.remote.jobId,
            meetingId: state.session.meetingId,
            notesStyle: normalizeText(refs.notesStyleSelect.value || state.notesStyleSelection),
            sharedMemo: normalizeTextBlock(state.currentJob?.sharedMemoSnapshot),
          },
          state.session.meetingSessionToken
        );
        state.currentJob = normalizeJob(regeneratePayload?.job, state.currentJob?.title || state.meeting.title);
        state.currentArtifact = normalizeArtifact(regeneratePayload?.artifact);
        state.notesStyleSelection = normalizeText(state.currentArtifact?.notesStyleSelected || state.currentJob?.notesStyleSelected || state.notesStyleSelection);
        syncSpeakerAliasDrafts(true);
        state.reviewTab = "notes";
        setNotice("화자명과 표현 방식을 반영해 회의 정리를 다시 만들었습니다.", "highlight");
      } else {
        setNotice("화자명을 저장했습니다.", "highlight");
      }
      await syncWorkspaceLocalState(true, "workflow");
    } finally {
      state.busy.regenerateNotes = false;
      state.busy.saveSpeakerAliases = false;
      applyRender();
    }
  }

  async function saveRecordTitleForEntry(recordId, nextTitleInput) {
    const entry = findHistoryEntry(state, recordId);
    const nextTitle = normalizeText(nextTitleInput);
    if (!entry || !nextTitle) return;
    state.busy.saveRecordTitle = true;
    applyRender();
    try {
      if (entry.remote?.jobId) {
        const payload = await postJson(global, CONFIG.updateMeetingResultUrl, { jobId: entry.remote.jobId, meetingId: state.session.meetingId, title: nextTitle }, state.session.meetingSessionToken);
        state.currentJob = normalizeJob(payload?.job, nextTitle);
      }
      if (entry.pending?.requestId) {
        const nextPending = { ...entry.pending, meetingTitleSnapshot: nextTitle };
        await upsertPendingUpload(nextPending, {
          context: {
            phase: "record-title",
            reason: "record-title",
          },
        });
        if (!entry.remote?.jobId) {
          state.currentJob = buildLocalPendingJob(nextPending);
        }
      }
      setNotice("기록 이름을 저장했습니다.", "highlight");
      await syncWorkspaceLocalState(true, "workflow");
    } finally {
      state.busy.saveRecordTitle = false;
      applyRender();
    }
  }

  async function handleLocalQueueAction(action, requestId) {
    try {
      const pending = state.pendingUploads.find((item) => item.requestId === normalizeText(requestId));
      if (!pending) return;
      if (state.debugLocalQueueSandbox && ["retry", "restart"].includes(normalizeText(action))) {
        setNotice("로컬 queue sandbox에서는 retry/restart 대신 hold, title 변경, delete로 queue 상태를 확인합니다.", "warning");
        applyRender();
        return;
      }
      if (normalizeText(action) === "retry") return attemptPendingUpload(requestId, { reason: "manual-retry" });
      if (normalizeText(action) === "restart") return attemptPendingUpload(requestId, { forceRestart: true, reason: "manual-restart" });
      if (normalizeText(action) === "hold") {
        return upsertPendingUpload(
          { ...pending, hold: true, status: "on_hold", lastError: pending.lastError || "업로드를 잠시 멈췄습니다." },
          { context: { phase: "manual-hold", reason: "manual-hold" } }
        ).then(applyRender);
      }
      if (normalizeText(action) === "resume") {
        await upsertPendingUpload(
          { ...pending, hold: false, status: "upload_queued", lastError: "" },
          { context: { phase: "manual-resume-state", reason: "manual-resume" } }
        );
        return retryPendingUploads("manual-resume");
      }
      if (normalizeText(action) === "delete") {
        if (!await requestConfirmation({
          body: "아직 원격 처리 전이면 복구할 수 없습니다.",
          confirmLabel: "로컬 기록 삭제",
          eyebrow: "로컬 삭제",
          title: "이 로컬 기록을 삭제할까요?",
          tone: "danger",
        })) return;
        return deletePendingUpload(requestId, {
          context: {
            phase: "manual-delete",
            reason: "manual-delete",
          },
        });
      }
    } catch (error) {
      showPendingUploadQueueOperationError(error, "로컬 업로드 큐 작업을 이어가지 못했어요.");
    }
  }

  async function deletePendingUpload(requestId, options = {}) {
    const normalizedRequestId = normalizeText(requestId);
    try {
      await runPendingUploadQueueOperation(
        () => state.queueStore.delete(requestId),
        {
          context: normalizePendingUploadQueueContext({
            requestId,
            ...(options?.context || {}),
          }),
          scope: PENDING_UPLOAD_QUEUE_OPERATION_SCOPES.cleanup,
        }
      );
    } catch (error) {
      showPendingUploadQueueOperationError(error, "브라우저에 보관한 녹음을 정리하지 못했어요.");
      throw error;
    }
    delete state.runtimeChunkCache[normalizedRequestId];
    state.pendingUploads = state.pendingUploads.filter((item) => item.requestId !== normalizedRequestId);
    if (state.selectedRecordId === ns.shared.buildLocalSelectionId(normalizedRequestId)) state.selectedRecordId = chooseSelectedRecordId(state);
    persistWorkspaceSession();
    setNotice("브라우저에 보관하던 녹음을 삭제했습니다.", "highlight");
    applyRender();
  }

  function updateMeetingTitleDraft(value) {
    state.meetingTitleDraft = normalizeText(value);
    applyRender();
  }

  function updateRecordMemoDraft(value) {
    const nextValue = normalizeTextBlock(value);
    state.recordMemoDraft = nextValue;
    state.recordMemoSaved = nextValue;
    state.session.sharedMemo = nextValue;
    persistWorkspaceSession();
    refs.sharedMemoNotice.hidden = true;
    refs.sharedMemoNotice.textContent = "";
    applyRender();
  }

  function setupDebugPanel() {
    if (!refs.debugPanel) return;
    const enabled = isDebugPanelEnabled(global);
    setDebugEnabled(enabled);
    if (refs.meetingShell) {
      refs.meetingShell.dataset.debugPanel = String(enabled);
    }
    state.unsubscribeDebug?.();
    state.unsubscribeDebug = null;
    refs.debugPanel.hidden = !enabled;
    renderDebugPanel(getDebugEntries());
    if (!enabled) return;
    syncDebugPanelCollapsedUi({ persist: false });
    state.unsubscribeDebug = subscribeDebugEntries((entries) => renderDebugPanel(entries));
    logDebug("workspace.debug.enabled", {
      href: global.location.href,
    });
  }

  function toggleDebugPanelCollapsed() {
    state.debugPanelCollapsed = !state.debugPanelCollapsed;
    syncDebugPanelCollapsedUi({ persist: true });
  }

  function syncDebugPanelCollapsedUi(options = {}) {
    const persist = options.persist !== false;
    if (persist) {
      safeLocalStorageSet(global, DEBUG_PANEL_COLLAPSED_STORAGE_KEY, state.debugPanelCollapsed ? "1" : "0");
    }
    renderDebugPanel(getDebugEntries());
  }

  function buildDebugPanelState(entries = getDebugEntries()) {
    const normalizedEntries = Array.isArray(entries) ? entries : [];
    const summary = summarizeEntries(normalizedEntries);
    return debugConsole?.buildState?.({
      collapsed: state.debugPanelCollapsed,
      enabled: Boolean(refs.debugPanel && !refs.debugPanel.hidden),
      feedback: state.debugNotice,
      statusSummary: summary,
      text: buildCopyText(normalizedEntries),
    }) || {
      collapsed: state.debugPanelCollapsed,
      enabled: Boolean(refs.debugPanel && !refs.debugPanel.hidden),
      feedback: state.debugNotice,
      hasErrors: Math.max(0, Number(summary?.errorCount) || 0) > 0,
      statusSummary: summary,
      statusText: "",
      text: normalizeText(buildCopyText(normalizedEntries)) || "아직 로그가 없습니다.",
    };
  }

  function renderDebugPanel(entries = getDebugEntries()) {
    if (!refs.debugPanel) {
      return;
    }
    if (refs.debugPanel.hidden) {
      refs.debugPanel.innerHTML = "";
      return;
    }
    const previousViewport = debugConsole?.captureLogViewport?.(refs.debugPanel.querySelector("#debugLog")) || null;
    refs.debugPanel.innerHTML = debugConsole?.renderWorkspace?.(buildDebugPanelState(entries)) || "";
    const nextLog = refs.debugPanel.querySelector("#debugLog");
    if (!nextLog) {
      return;
    }
    debugConsole?.restoreLogViewport?.(nextLog, previousViewport);
  }

  function clearDebugLogPanel() {
    clearDebugEntries();
    logDebug("workspace.debug.cleared", {});
    setDebugNotice("디버그 로그를 비웠습니다.", "highlight");
    applyRender();
  }

  async function copyDebugLog() {
    const text = normalizeText(buildCopyText(getDebugEntries()));
    if (!text) return;
    try {
      if (typeof global.navigator?.clipboard?.writeText === "function") {
        await global.navigator.clipboard.writeText(text);
        setDebugNotice("디버그 로그를 복사했습니다.", "highlight");
      } else {
        throw new Error("Clipboard API unavailable");
      }
    } catch {
      setDebugNotice("클립보드 권한이 없어 로그 복사를 완료하지 못했어요.", "error");
    }
    applyRender();
  }

  async function copyDebugErrors() {
    const text = normalizeText(buildErrorCopyText(getDebugEntries()));
    if (!text) {
      setDebugNotice("복사할 오류 로그가 없습니다.", "highlight");
      applyRender();
      return;
    }
    try {
      if (typeof global.navigator?.clipboard?.writeText === "function") {
        await global.navigator.clipboard.writeText(text);
        setDebugNotice("오류 로그를 복사했습니다.", "highlight");
      } else {
        throw new Error("Clipboard API unavailable");
      }
    } catch {
      setDebugNotice("클립보드 권한이 없어 오류 로그 복사를 완료하지 못했어요.", "error");
    }
    applyRender();
  }

  async function copySegmentsText() {
    const entry = findHistoryEntry(state, state.selectedRecordId);
    const detailView = buildDetailView(state, entry);
    const text = buildSegmentCopyText(detailView.segments, detailView.transcriptText, detailView.speakerAliases);
    if (!text) {
      setNotice("복사할 전사가 아직 없습니다.", "warning");
      applyRender();
      return;
    }
    try {
      if (typeof global.navigator?.clipboard?.writeText === "function") {
        await global.navigator.clipboard.writeText(text);
        setNotice("발화 구간을 시간대 포함 텍스트로 복사했습니다.", "highlight");
      } else {
        throw new Error("Clipboard API unavailable");
      }
    } catch {
      setNotice("클립보드 권한이 없어 전사 복사를 완료하지 못했어요.", "error");
    }
    applyRender();
  }

  function retryPendingUploads(reason = "auto-retry") {
    if (state.debugLocalQueueSandbox) {
      logDebug("workspace.pending-upload.retry.skipped", {
        reason: normalizeText(reason),
        sandbox: "local-queue",
      });
      return;
    }
    for (const pending of state.pendingUploads) {
      if (!pending.hold && AUTO_RETRY_PENDING_STATUSES.has(pending.status)) attemptPendingUpload(pending.requestId, { reason });
    }
  }

  function handleOnline() { setNotice("인터넷 연결이 돌아왔습니다. 보관한 녹음을 다시 확인합니다.", "highlight"); retryPendingUploads("online-retry"); applyRender(); }
  function handleOffline() { setNotice("인터넷이 끊겨도 종료된 녹음은 브라우저에 보관합니다. 연결이 돌아오면 이어서 업로드합니다.", "highlight"); applyRender(); }

  async function upsertPendingUpload(item, options = {}) {
    const updatedAt = options?.preserveUpdatedAt
      ? normalizeText(item?.updatedAt) || new Date().toISOString()
      : new Date().toISOString();
    const normalized = normalizePendingUpload({ ...item, updatedAt });
    try {
      await runPendingUploadQueueOperation(
        () => state.queueStore.put(normalized),
        {
          context: normalizePendingUploadQueueContext({
            requestId: normalized.requestId,
            ...(options?.context || {}),
          }),
          scope: PENDING_UPLOAD_QUEUE_OPERATION_SCOPES.persist,
        }
      );
    } catch (error) {
      showPendingUploadQueueOperationError(error, "브라우저 로컬 보관 큐를 저장하지 못했어요.");
      throw error;
    }
    state.pendingUploads = collapseSupersededPendingUploads([
      normalized,
      ...state.pendingUploads.filter((current) => current.requestId !== normalized.requestId),
    ]).sort(ns.storage.comparePendingUploads);
    state.meeting.pendingLocalCount = state.pendingUploads.length;
    return normalized;
  }
  function updateRecordingDuration() {
    if (state.capture.status !== "recording") return;
    state.capture.durationMs = Math.max(0, (Number(state.media.accumulatedDurationMs) || 0) + (Date.now() - state.media.resumeStartedAtMs));
    if (state.capture.maxDurationMs > 0 && state.capture.durationMs >= state.capture.maxDurationMs && !state.media.autoStopPending) {
      state.media.autoStopPending = true;
      logDebug("workspace.capture.limit-reached", {
        durationMs: state.capture.durationMs,
        maxDurationMs: state.capture.maxDurationMs,
        requestId: state.capture.requestId,
      });
      setNotice("설정한 시간에 도달해 현재 기록을 전사로 넘기고 다음 기록 녹음을 이어갑니다.", "highlight");
      applyRender();
      void stopCapture({ autoLimit: true, continueRecording: true });
      return;
    }
    applyRender();
  }
  function stopRecorder() { return new Promise((resolve) => { if (!state.media.recorder || state.media.recorder.state === "inactive") return resolve(); state.media.stopResolver = resolve; state.media.recorder.stop(); }); }
  function resolveRecorderStop() { if (typeof state.media.stopResolver === "function") { state.media.stopResolver(); state.media.stopResolver = null; } }
  function cleanupMedia() {
    global.clearInterval(state.media.chunkTimer);
    stopTracks(state.media.audioStream);
    state.media.audioStream = null;
    state.media.autoStopPending = false;
    state.media.chunks = [];
    state.media.recorder = null;
    state.media.accumulatedDurationMs = 0;
    state.media.resumeStartedAtMs = 0;
    state.media.stopContext = null;
  }
  function resetCaptureState() { state.capture = createIdleCapture(state.recordingProfile); }
  function inferAudioExtension(mimeType) {
    const normalized = normalizeText(mimeType).toLowerCase();
    if (normalized.includes("webm")) return "webm";
    if (normalized.includes("wav")) return "wav";
    if (normalized.includes("ogg")) return "ogg";
    if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
    if (normalized.includes("mp4") || normalized.includes("m4a") || normalized.includes("aac")) return "m4a";
    return "webm";
  }
  function buildDownloadFileName(title, requestId, extension) {
    const baseName = normalizeText(title)
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim() || "recording";
    const suffix = normalizeText(requestId).slice(0, 8);
    return `${baseName}${suffix ? `-${suffix}` : ""}.${extension || "webm"}`;
  }
  function setScopedNotice(key, timerKey, text, tone, options = {}) {
    global.clearTimeout(state[timerKey]);
    const nextNotice = buildNoticeState(text, tone, options);
    state[key] = nextNotice;
    if (!normalizeText(nextNotice.text) || nextNotice.sticky) {
      state[timerKey] = 0;
      if (key === "notice" && !normalizeText(nextNotice.text)) {
        syncNoticeFromDegradedRegistry();
      }
      return;
    }
    state[timerKey] = global.setTimeout(() => {
      if (state[key].text === nextNotice.text && state[key].tone === nextNotice.tone && normalizeText(state[key].code) === nextNotice.code) {
        state[key] = createEmptyNotice();
        state[timerKey] = 0;
        if (key === "notice") {
          syncNoticeFromDegradedRegistry();
        }
        applyRender();
      }
    }, 2600);
  }
  function setNotice(text, tone, options = {}) {
    setScopedNotice("notice", "noticeTimer", text, tone, options);
  }
  function setDebugNotice(text, tone, options = {}) {
    setScopedNotice("debugNotice", "debugNoticeTimer", text, tone, options);
  }
  function persistWorkspaceSession() {
    const entry = findHistoryEntry(state, state.selectedRecordId);
    const payload = {
      expiresAt: state.session.expiresAt,
      jobId: normalizeText(entry?.remote?.jobId || entry?.pending?.jobId),
      meetingId: state.session.meetingId,
      meetingSessionToken: state.session.meetingSessionToken,
      mode: state.mode,
      sharedMemo: normalizeTextBlock(state.recordMemoDraft || state.recordMemoSaved),
      supersededRemoteJobIds: collectSupersededRemoteJobIds(),
      title: normalizeText(state.meeting.title || state.session.title),
    };
    state.supersededRemoteJobIds = payload.supersededRemoteJobIds;
    applyPersistWorkspaceSessionResult(persistWorkspaceSessionPayload(global, payload));
    replaceCleanUrl();
  }
  function clearWorkspaceSession() {
    const cleared = clearPersistedWorkspaceSession(global, state.session.meetingId);
    const degradedReason = normalizeText(cleared?.degradedReason);
    const issues = Array.isArray(cleared?.issues) ? cleared.issues : [];
    if (degradedReason) {
      logDebug("workspace.session.clear.degraded", {
        degradedReason,
        issues,
        meetingId: state.session.meetingId,
      });
    }
    disposeWorkspaceRealtime({ clearAuthCache: true });
  }
  function replaceCleanUrl() { const currentUrl = new URL(global.location.href); const preserveDebug = currentUrl.searchParams.get("debug") === "1"; const nextUrl = new URL(global.location.href); nextUrl.search = ""; nextUrl.hash = ""; if (preserveDebug) nextUrl.searchParams.set("debug", "1"); if (state.session.meetingId) nextUrl.searchParams.set("meetingId", state.session.meetingId); const entry = findHistoryEntry(state, state.selectedRecordId); const jobId = normalizeText(entry?.remote?.jobId || entry?.pending?.jobId); if (jobId) nextUrl.searchParams.set("jobId", jobId); if (state.session.meetingSessionToken) nextUrl.hash = buildWorkspaceHash(state.session.meetingSessionToken); global.history.replaceState({}, "", nextUrl.toString()); state.params = parseParams(nextUrl.toString()); }
  function renderBlocked(message, options = {}) {
    logDebug("workspace.blocked", { message, tone: options?.tone, title: options?.title });
    state.blocked = true;
    state.blockedEyebrow = normalizeText(options?.eyebrow) || "회의 작업실";
    state.blockedTitle = normalizeText(options?.title) || "이 작업실은 패널에서 다시 열어야 합니다";
    state.blockedTone = normalizeText(options?.tone) || "blocked";
    state.blockedMessage = normalizeText(message);
    refs.workspace.hidden = true;
    refs.blockedState.hidden = false;
    refs.blockedState.dataset.tone = state.blockedTone;
    if (refs.blockedEyebrow) refs.blockedEyebrow.textContent = state.blockedEyebrow;
    if (refs.blockedTitle) refs.blockedTitle.textContent = state.blockedTitle;
    refs.blockedMessage.textContent = state.blockedMessage;
  }
  function applyRender() {
    const activeElement = global.document.activeElement;
    const speakerInputFocusState = activeElement instanceof global.HTMLInputElement && refs.speakerAliasList?.contains(activeElement)
      ? {
          selectionDirection: activeElement.selectionDirection || "none",
          selectionEnd: typeof activeElement.selectionEnd === "number" ? activeElement.selectionEnd : null,
          selectionStart: typeof activeElement.selectionStart === "number" ? activeElement.selectionStart : null,
          speakerLabel: normalizeText(activeElement.dataset.speakerLabel),
        }
      : null;
    if (state.blocked) {
      refs.workspace.hidden = true;
      refs.blockedState.hidden = false;
      refs.blockedState.dataset.tone = state.blockedTone || "blocked";
      if (refs.blockedEyebrow) refs.blockedEyebrow.textContent = state.blockedEyebrow || "회의 작업실";
      if (refs.blockedTitle) refs.blockedTitle.textContent = state.blockedTitle || "이 작업실은 패널에서 다시 열어야 합니다";
      refs.blockedMessage.textContent = state.blockedMessage || refs.blockedMessage.textContent;
      renderDebugPanel();
      return;
    }
    refs.blockedState.hidden = true;
    refs.workspace.hidden = false;
    renderWorkspace(state, refs);
    renderDebugPanel();
    if (speakerInputFocusState?.speakerLabel && refs.speakerAliasList) {
      const speakerInput = Array.from(refs.speakerAliasList.querySelectorAll("input[data-speaker-label]"))
        .find((element) => normalizeText(element.dataset.speakerLabel) === speakerInputFocusState.speakerLabel);
      if (speakerInput) {
        speakerInput.focus();
        if (speakerInputFocusState.selectionStart != null && speakerInputFocusState.selectionEnd != null) {
          try {
            speakerInput.setSelectionRange(
              speakerInputFocusState.selectionStart,
              speakerInputFocusState.selectionEnd,
              speakerInputFocusState.selectionDirection
            );
          } catch {}
        }
      }
    }
    refs.confirmOverlay.hidden = !state.confirmation.open;
    if (refs.confirmDialog) {
      refs.confirmDialog.dataset.tone = state.confirmation.tone || "danger";
    }
    if (refs.confirmDialogEyebrow) refs.confirmDialogEyebrow.textContent = state.confirmation.eyebrow || "확인";
    if (refs.confirmDialogTitle) refs.confirmDialogTitle.textContent = state.confirmation.title || "이 작업을 진행할까요?";
    if (refs.confirmDialogBody) refs.confirmDialogBody.textContent = state.confirmation.body || "";
    if (refs.confirmDialogConfirm) refs.confirmDialogConfirm.textContent = state.confirmation.confirmLabel || "확인";
  }
  function hasWorkspaceData() {
    return Boolean(state.records.length || state.pendingUploads.length || state.currentJob || state.currentArtifact || state.selectedRecordId);
  }
  function isSlowResponseMessage(message) {
    return normalizeText(message).includes("회의 작업실 응답이 늦어지고 있어요");
  }
  function clearResolvedRefreshNotice() {
    clearDegradedNotice(DEGRADED_NOTICE_CODES.refresh);
  }

  function buildRefreshDegradedNotice(message, reason) {
    const normalizedMessage = normalizeText(message) || "작업실 최신 상태를 다시 읽지 못했어요.";
    const normalizedReason = normalizeText(reason);
    const surfaceLabel = normalizedReason === "background"
      ? "백그라운드 동기화"
      : normalizedReason === "workflow"
        ? "작업 후 동기화"
        : "작업실 동기화";
    return `${surfaceLabel}에 실패해 이전 작업실 데이터를 그대로 보여주고 있습니다. 최신 기록이나 상태는 아직 반영되지 않았을 수 있습니다. 원인: ${normalizedMessage}`;
  }

  function shouldDegradeRefreshError(error, message, reason) {
    const normalizedReason = normalizeText(reason);
    if (!["background", "workflow"].includes(normalizedReason)) return false;
    if (!hasWorkspaceData()) return false;
    return isSlowResponseMessage(message) || isLikelyNetworkError(global, error);
  }
  function handleBackgroundRefresh() {
    if (state.blocked || state.loading || global.document.hidden) return;
    if (typeof state.realtime.unsubscribeMeeting === "function") return;
    void refreshWorkspace(false, "background");
  }
})(globalThis);
