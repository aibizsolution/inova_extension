(function initHostedMeetingWorkspace(global) {
  const ns = global.__INOVA_HOSTED_MEETING__;
  const {
    AUTO_RETRY_PENDING_STATUSES,
    DEFAULT_CREATE_JOB_TIMEOUT_MS,
    DEFAULT_INLINE_AUDIO_LIMIT_BYTES,
    DEFAULT_SOURCE_CHUNK_DURATION_MS,
    DEFAULT_SOURCE_CHUNK_OVERLAP_MS,
    DEFAULT_SOURCE_MAX_BYTES,
    DEFAULT_SOURCE_MAX_DURATION_MS,
    DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS,
    DEFAULT_SOURCE_TARGET_PART_BYTES,
    DEFAULT_SOURCE_UPLOAD_TIMEOUT_MS,
    formatDateTime,
    isDebugPanelEnabled,
    isLocalWorkspaceOrigin,
    logDebug,
    normalizeText,
    normalizeTextBlock,
    parseParams,
    resolveConfig,
    resolveRecordingProfile,
    safeLocalStorageGet,
  } = ns.shared;
  const { createPendingUploadStore } = ns.storage;
  const { renderWorkspace } = ns.render;
  const CONFIG = resolveConfig(global.__INOVA_HOSTED_MEETING_CONFIG__);
  const DEBUG_PANEL_COLLAPSED_STORAGE_KEY = "__INOVA_MEETING_DEBUG_PANEL_COLLAPSED__";
  const DEBUG_LOCAL_QUEUE_SANDBOX_PARAM = "debugQueueSandbox";
  const MAX_SHARED_MEMO_CHARS = 12000;
  const MAX_NOTES_CONTEXT_ITEMS = 8;
  const MAX_NOTES_CONTEXT_ITEM_CHARS = 1200;
  const SUPERSEDED_REMOTE_JOBS_STORAGE_KEY_PREFIX = "__INOVA_MEETING_SUPERSEDED_REMOTE_JOBS__";
  const BOOT_INITIAL_SNAPSHOT_WAIT_MS = 450;
  const DEGRADED_NOTICE_CODES = Object.freeze({
    pendingUploadCleanup: "pending-upload-cleanup-degraded",
    pendingUploadChunkResyncPersist: "pending-upload-chunk-resync-persist-degraded",
    pendingUploadPersist: "pending-upload-persist-degraded",
    pendingUploadRemoteSyncPersist: "pending-upload-remote-sync-persist-degraded",
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
    [DEGRADED_NOTICE_CODES.pendingUploadRemoteSyncPersist]: Object.freeze({ priority: 22 }),
    [DEGRADED_NOTICE_CODES.pendingUploadChunkResyncPersist]: Object.freeze({ priority: 21 }),
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
  let controllers = null;

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
  
  
  function createEmptyNotesContextState() {
    return { draft: "", editingId: "", items: [], recordId: "" };
  }
  
  
  function createEmptySelectedRecordMemoState() {
    return { draft: "", recordId: "", saved: "" };
  }
  
  
  function createEmptyNotesInputSnapshotState() {
    return { contextItems: [], recordId: "", sharedMemo: "", updatedAt: "" };
  }
  
  
  function createEmptyWorkspaceMutationState() {
    return { completedAt: "", error: "", requestedAt: "", requestId: "", status: "", type: "" };
  }
  
  
  function createInitialState() {
    const recordingProfile = resolveRecordingProfile(global);
    return {
      auth: {
        accessDecision: "unknown",
        accessMode: "",
        bypassMode: "",
        extensionBridge: "not-requested",
        inovaLogin: false,
        readOnly: false,
        reason: "",
        viewer: "",
      },
      blocked: false,
      blockedEyebrow: "회의 작업",
      blockedTitle: "이 회의 화면은 패널에서 다시 열어야 합니다",
      blockedTone: "blocked",
      blockedMessage: "",
      busy: {
        deleteMeeting: false,
        deleteRecord: false,
        queue: Object.create(null),
        regenerateNotes: false,
        saveMeetingMemo: false,
        saveMeetingTitle: false,
        saveRecordContext: false,
        saveRecordMemo: false,
        saveRecordTitle: false,
      },
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
      meeting: { deletedAt: "", meetingId: "", pendingLocalCount: 0, sharedMemo: "", title: "", updatedAt: "", workspaceMutation: createEmptyWorkspaceMutationState() },
      mode: "create",
      notice: createEmptyNotice(),
      noticeTimer: 0,
      notesContext: createEmptyNotesContextState(),
      pendingMutations: Object.create(null),
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
      pendingUploadRemoteSyncPersist: {
        degradedReason: "",
        issueCodes: [],
      },
      pendingUploadChunkResyncPersist: {
        degradedReason: "",
        issueCodes: [],
      },
      pendingUploadCleanup: {
        degradedReason: "",
        issueCodes: [],
      },
      queueStore: createPendingUploadStore(global),
      recordMemoDraft: "",
      recordMemoSaved: "",
      recordingProfile,
      records: [],
      reviewTab: "notes",
      selectedRecordMemo: createEmptySelectedRecordMemoState(),
      selectedRecordNotesInputSnapshot: createEmptyNotesInputSnapshotState(),
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
      session: { accessMode: "", expiresAt: "", meetingId: "", meetingSessionToken: "", mode: "create", shareToken: "", sharedMemo: "", title: "" },
      supersededRemoteJobIds: [],
      unsubscribeDebug: null,
    };
  }
  
  
  function readDebugPanelCollapsed() {
    return normalizeText(safeLocalStorageGet(global, DEBUG_PANEL_COLLAPSED_STORAGE_KEY)) === "1";
  }

  function cacheRefs() {
    for (const id of ["meetingShell", "blockedMessage", "blockedEyebrow", "blockedTitle", "blockedState", "workspace", "pageTitle", "pageSummary", "workspaceBadge", "offlineQueueBadge", "refreshButton", "meetingTitleInput", "saveMeetingTitleButton", "deleteMeetingButton", "meetingStatusChip", "currentBadge", "currentSummary", "currentHint", "currentNotice", "currentTimer", "startButton", "importAudioButton", "importAudioInput", "pauseButton", "resumeButton", "stopButton", "discardButton", "sharedMemoInput", "saveSharedMemoButton", "clearSharedMemoButton", "sharedMemoNotice", "recordCountBadge", "recordList", "detailTitle", "detailBadge", "detailSummary", "recordTitleGroup", "recordTitleInput", "saveRecordTitleButton", "downloadRecordButton", "deleteRecordButton", "detailMeta", "reviewSectionHeader", "reviewSegmentsToolbar", "copySegmentsButton", "detailMemoInput", "saveRecordMemoButton", "reviewTabSummary", "reviewTabMemo", "reviewTabNotes", "reviewTabSegments", "reviewTabSegmentsCount", "reviewTabContext", "reviewTabActions", "reviewPanelSummary", "summaryStatusPill", "summaryStatusGrid", "summaryActionCard", "reviewPanelMemo", "meetingNotesCard", "reviewPanelSegments", "reviewPanelContext", "copyMeetingNotesButton", "updateMeetingNotesButton", "meetingNotesOverview", "meetingNotesSections", "detailNotice", "segmentList", "debugPanel", "confirmOverlay", "confirmDialog", "confirmDialogEyebrow", "confirmDialogTitle", "confirmDialogBody", "confirmDialogCancel", "confirmDialogConfirm", "notesContextList", "notesContextInput", "notesContextAddButton", "notesContextResetButton"]) {
      refs[id] = global.document.getElementById(id);
    }
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
  
  
  function getWorkspaceTitleDraft() {
    return normalizeText(refs.meetingTitleInput?.value || state.meeting.title || state.session.title);
  }
  
  
  function getWorkspaceTitleOrFallback() {
    return getWorkspaceTitleDraft() || "새 회의";
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

  function shouldWarnOnRecordingUnload(status) {
    return ["recording", "paused", "stopping"].includes(normalizeText(status));
  }

  function shouldWarnOnPendingUploadUnload(status) {
    return ["preparing_chunks", "uploading", "uploading_chunks"].includes(normalizeText(status));
  }

  function getUnloadWarningState() {
    const captureStatus = normalizeText(state.capture?.status);
    const activeUploadCount = (Array.isArray(state.pendingUploads) ? state.pendingUploads : [])
      .filter((pending) => shouldWarnOnPendingUploadUnload(pending?.status))
      .length;
    return {
      activeUploadCount,
      captureStatus,
      shouldWarn: shouldWarnOnRecordingUnload(captureStatus) || activeUploadCount > 0,
    };
  }

  function handleBeforeUnload(event) {
    const unloadWarningState = getUnloadWarningState();
    if (!unloadWarningState.shouldWarn) {
      return undefined;
    }
    logDebug("workspace.beforeunload.warn", {
      activeUploadCount: unloadWarningState.activeUploadCount,
      captureStatus: unloadWarningState.captureStatus,
      meetingId: state.session.meetingId,
    });
    event.preventDefault();
    event.returnValue = "";
    return "";
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
  
  
  function cloneNotesContextItems(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        contextId: normalizeText(item?.contextId || item?.id),
        createdAt: normalizeText(item?.createdAt),
        text: normalizeTextBlock(item?.text || item?.context || item?.value).slice(0, MAX_NOTES_CONTEXT_ITEM_CHARS),
        updatedAt: normalizeText(item?.updatedAt || item?.createdAt),
      }))
      .filter((item) => item.text);
  }
  
  
  function cloneNotesInputSnapshot(snapshot, fallback = {}) {
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    return {
      contextItems: cloneNotesContextItems(
        Array.isArray(source.contextItems)
          ? source.contextItems
          : fallback.contextItems
      ),
      sharedMemo: normalizeTextBlock(
        Object.prototype.hasOwnProperty.call(source, "sharedMemo")
          ? source.sharedMemo
          : fallback.sharedMemo
      ).slice(0, MAX_SHARED_MEMO_CHARS),
      updatedAt: normalizeText(source.updatedAt || fallback.updatedAt),
    };
  }
  
  
  function renderBlocked(message, options = {}) {
    logDebug("workspace.blocked", { message, tone: options?.tone, title: options?.title });
    state.blocked = true;
    state.blockedEyebrow = normalizeText(options?.eyebrow) || "회의 작업";
    state.blockedTitle = normalizeText(options?.title) || "이 회의 화면은 패널에서 다시 열어야 합니다";
    state.blockedTone = normalizeText(options?.tone) || "blocked";
    state.blockedMessage = normalizeText(message);
    refs.workspace.hidden = true;
    refs.blockedState.hidden = false;
    refs.blockedState.dataset.tone = state.blockedTone;
    if (refs.blockedEyebrow) refs.blockedEyebrow.textContent = state.blockedEyebrow;
    if (refs.blockedTitle) refs.blockedTitle.textContent = state.blockedTitle;
    refs.blockedMessage.textContent = state.blockedMessage;
    controllers?.debug?.forceExpand?.();
  }

  function buildControllerHelpers() {
    return {
      applyDegradedDiagnostics,
      applyRender,
      buildDegradedNoticeRegistrySnapshot,
      buildImportedRecordTitle,
      buildRecordTitle,
      clearDegradedNotice,
      cloneDegradedDiagnosticsSnapshot,
      cloneNoticeSnapshot,
      cloneNotesContextItems,
      cloneNotesInputSnapshot,
      controller(name) {
        return controllers?.[name] || null;
      },
      createEmptyNotesContextState,
      createEmptyNotesInputSnapshotState,
      createEmptySelectedRecordMemoState,
      createEmptyWorkspaceMutationState,
      createIdleCapture,
      getDebugEntries: ns.shared.getDebugEntries,
      getWorkspaceTitleOrFallback,
      getHighestPriorityDegradedNotice,
      renderBlocked,
      requestConfirmation,
      resolveConfirmation,
      setDebugNotice,
      setDegradedNotice,
      setNotice,
      setScopedNotice,
    };
  }

  function createControllers() {
    controllers = {};
    const deps = {
      constants: {
        AUTO_RETRY_PENDING_STATUSES,
        BOOT_INITIAL_SNAPSHOT_WAIT_MS,
        CONFIG,
        DEBUG_LOCAL_QUEUE_SANDBOX_PARAM,
        DEBUG_PANEL_COLLAPSED_STORAGE_KEY,
        DEFAULT_CREATE_JOB_TIMEOUT_MS,
        DEFAULT_INLINE_AUDIO_LIMIT_BYTES,
        DEFAULT_SOURCE_CHUNK_DURATION_MS,
        DEFAULT_SOURCE_CHUNK_OVERLAP_MS,
        DEFAULT_SOURCE_MAX_BYTES,
        DEFAULT_SOURCE_MAX_DURATION_MS,
        DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS,
        DEFAULT_SOURCE_TARGET_PART_BYTES,
        DEFAULT_SOURCE_UPLOAD_TIMEOUT_MS,
        DEGRADED_NOTICE_CODES,
        DEGRADED_NOTICE_SPECS,
        MAX_NOTES_CONTEXT_ITEMS,
        MAX_NOTES_CONTEXT_ITEM_CHARS,
        MAX_SHARED_MEMO_CHARS,
        PENDING_UPLOAD_QUEUE_OPERATION_SCOPES,
        SUPERSEDED_REMOTE_JOBS_STORAGE_KEY_PREFIX,
      },
      global,
      helpers: buildControllerHelpers(),
      refs,
      state,
    };
    Object.assign(controllers, {
      pendingUploads: ns.workspacePendingUploads.createController(deps),
      mutations: ns.workspaceMutations.createController(deps),
      realtime: ns.workspaceRealtime.createController(deps),
      session: ns.workspaceSession.createController(deps),
      capture: ns.workspaceCapture.createController(deps),
      debug: ns.workspaceDebug.createController(deps),
    });
    return controllers;
  }

  function bindEvents() {
    const blockReadOnlyAction = (label) => {
      if (!state.auth?.readOnly) return false;
      setNotice(`${label}은 읽기 전용 모드에서 사용할 수 없습니다.`, "warning");
      applyRender();
      return true;
    };
    const runWritableAction = (label, handler) => (...args) => {
      if (blockReadOnlyAction(label)) {
        return;
      }
      return handler(...args);
    };
    refs.refreshButton?.addEventListener("click", () => controllers.realtime.refreshWorkspace(false, "manual"));
    refs.meetingTitleInput.addEventListener("input", () => controllers.mutations.updateMeetingTitleDraft(refs.meetingTitleInput.value));
    refs.meetingTitleInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      if (state.auth?.readOnly) {
        blockReadOnlyAction("회의 이름 저장");
        return;
      }
      if (!refs.saveMeetingTitleButton.disabled) {
        void controllers.mutations.saveMeetingTitle();
      }
    });
    refs.recordTitleInput.addEventListener("input", applyRender);
    refs.recordTitleInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      if (state.auth?.readOnly) {
        blockReadOnlyAction("기록 이름 저장");
        return;
      }
      if (!refs.saveRecordTitleButton.disabled) {
        void controllers.mutations.saveCurrentRecordTitle();
      }
    });
    refs.sharedMemoInput.addEventListener("input", () => controllers.mutations.updateRecordMemoDraft(refs.sharedMemoInput.value));
    refs.detailMemoInput?.addEventListener("input", () => controllers.mutations.updateSelectedRecordMemoDraft(refs.detailMemoInput.value));
    refs.saveMeetingTitleButton.addEventListener("click", runWritableAction("회의 이름 저장", () => void controllers.mutations.saveMeetingTitle()));
    refs.saveSharedMemoButton.addEventListener("click", runWritableAction("기록 메모 저장", () => void controllers.mutations.saveSharedMemo()));
    refs.clearSharedMemoButton.addEventListener("click", runWritableAction("기록 메모 비우기", () => void controllers.mutations.clearSharedMemo()));
    refs.saveRecordMemoButton?.addEventListener("click", runWritableAction("기록 메모 저장", () => void controllers.mutations.saveSelectedRecordMemo()));
    refs.deleteMeetingButton.addEventListener("click", runWritableAction("회의 삭제", () => void controllers.mutations.deleteMeeting()));
    for (const tabId of ["reviewTabSummary", "reviewTabNotes", "reviewTabMemo", "reviewTabSegments", "reviewTabContext"]) {
      const tab = refs[tabId];
      if (!tab) continue;
      tab.addEventListener("click", () => {
        state.reviewTab = normalizeText(tab.dataset.reviewTab) || "summary";
        applyRender();
      });
    }
    refs.startButton.addEventListener("click", runWritableAction("녹음 시작", () => void controllers.capture.startCapture()));
    refs.importAudioButton?.addEventListener("click", runWritableAction("파일 불러오기", controllers.capture.openImportAudioPicker));
    refs.importAudioInput?.addEventListener("change", runWritableAction("파일 불러오기", (event) => void controllers.capture.handleImportAudioSelection(event)));
    refs.pauseButton.addEventListener("click", runWritableAction("녹음 일시중지", () => void controllers.capture.pauseCapture()));
    refs.resumeButton.addEventListener("click", runWritableAction("녹음 재개", () => void controllers.capture.resumeCapture()));
    refs.stopButton.addEventListener("click", runWritableAction("종료하고 전사", () => void controllers.capture.stopCapture()));
    refs.discardButton.addEventListener("click", runWritableAction("녹음 버리기", controllers.capture.discardCapture));
    refs.recordList.addEventListener("click", (event) => void controllers.realtime.handleRecordListClick(event));
    refs.saveRecordTitleButton.addEventListener("click", runWritableAction("기록 이름 저장", () => void controllers.mutations.saveCurrentRecordTitle()));
    refs.downloadRecordButton.addEventListener("click", runWritableAction("기록 다운로드", controllers.capture.downloadCurrentRecord));
    refs.deleteRecordButton.addEventListener("click", runWritableAction("기록 삭제", () => void controllers.mutations.deleteCurrentRecord()));
    refs.copyMeetingNotesButton?.addEventListener("click", () => void controllers.debug.copyMeetingNotes());
    refs.updateMeetingNotesButton?.addEventListener("click", runWritableAction("회의록 업데이트", () => void controllers.mutations.regenerateNotes()));
    refs.copySegmentsButton?.addEventListener("click", () => void controllers.debug.copySegmentsText());
    refs.notesContextInput?.addEventListener("input", () => controllers.mutations.updateNotesContextDraft(refs.notesContextInput.value));
    refs.notesContextAddButton?.addEventListener("click", runWritableAction("추가 맥락 저장", () => void controllers.mutations.upsertNotesContextDraft()));
    refs.notesContextResetButton?.addEventListener("click", runWritableAction("추가 맥락 입력 비우기", controllers.mutations.resetNotesContextDraft));
    refs.notesContextList?.addEventListener("click", runWritableAction("추가 맥락 편집", (event) => controllers.mutations.handleNotesContextListClick(event)));
    refs.debugPanel?.addEventListener("click", (event) => controllers.debug.handlePanelClick(event));
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
    global.addEventListener("focus", controllers.realtime.handleBackgroundRefresh, { passive: true });
    global.document.addEventListener("visibilitychange", () => {
      controllers.realtime.handleVisibilityChange();
    }, { passive: true });
    global.addEventListener("online", () => {
      setNotice("인터넷 연결이 돌아왔습니다. 보관한 녹음을 다시 확인합니다.", "highlight");
      controllers.pendingUploads.retryPendingUploads("online-retry");
      applyRender();
    }, { passive: true });
    global.addEventListener("offline", () => {
      setNotice("인터넷이 끊겨도 종료된 녹음은 브라우저에 보관합니다. 연결이 돌아오면 이어서 업로드합니다.", "highlight");
      applyRender();
    }, { passive: true });
    global.addEventListener("beforeunload", handleBeforeUnload);
    global.addEventListener("pagehide", controllers.realtime.disposeRealtime, { passive: true });
  }

  async function bootWorkspace() {
    const debugSandboxRequested = controllers.pendingUploads.isDebugLocalQueueSandboxRequested?.();
    await controllers.session.bootSession();
    if (state.auth.accessDecision !== "allowed") {
      if (!debugSandboxRequested) {
        const blockedOptions = controllers.session.buildMissingSessionBlockedOptions();
        renderBlocked(blockedOptions.message, blockedOptions);
        applyRender();
        return;
      }
    }
    if (debugSandboxRequested) {
      controllers.pendingUploads.activateDebugLocalQueueSandbox();
    } else {
      controllers.session.surfaceSessionRestoreNotice();
    }
    state.meetingTitleDraft = normalizeText(state.meeting.title || state.session.title);
    state.recordMemoDraft = normalizeTextBlock(state.session.sharedMemo);
    state.recordMemoSaved = state.recordMemoDraft;
    applyRender();
    await controllers.realtime.refreshWorkspace(true, "boot");
    controllers.pendingUploads.retryPendingUploads("boot-retry");
  }

  async function bootstrap() {
    cacheRefs();
    createControllers();
    bindEvents();
    controllers.debug.setup();
    controllers.debug.exposeDebugApi();
    logDebug("workspace.recording.profile", state.recordingProfile);
    logDebug("workspace.bootstrap", {
      href: global.location.href,
      params: state.params,
    });
    await bootWorkspace();
  }

  function setScopedNotice(key, timerKey, text, tone, options = {}) {
    state[key] = buildNoticeState(text, tone, { code: options.code, sticky: options.sticky });
    if (state[timerKey]) {
      global.clearTimeout(state[timerKey]);
      state[timerKey] = 0;
    }
    if (!state[key].sticky && state[key].text) {
      state[timerKey] = global.setTimeout(() => {
        state[key] = buildNoticeState("", "");
        state[timerKey] = 0;
        applyRender();
      }, Math.max(1200, Number(options.durationMs) || 3200));
    }
  }

  function setNotice(text, tone, options = {}) {
    setScopedNotice("notice", "noticeTimer", text, tone, options);
  }

  function setDebugNotice(text, tone, options = {}) {
    setScopedNotice("debugNotice", "debugNoticeTimer", text, tone, options);
  }

  function applyRender() {
    if (state.blocked) {
      refs.workspace.hidden = true;
      refs.blockedState.hidden = false;
      refs.blockedState.dataset.tone = state.blockedTone || "blocked";
      if (refs.blockedEyebrow) refs.blockedEyebrow.textContent = state.blockedEyebrow || "회의 작업";
      if (refs.blockedTitle) refs.blockedTitle.textContent = state.blockedTitle || "이 회의 화면은 패널에서 다시 열어야 합니다";
      refs.blockedMessage.textContent = state.blockedMessage || refs.blockedMessage.textContent;
      controllers?.debug?.render?.();
      return;
    }
    refs.blockedState.hidden = true;
    refs.workspace.hidden = false;
    renderWorkspace(state, refs);
    controllers?.debug?.render?.();
    refs.confirmOverlay.hidden = !state.confirmation.open;
    if (refs.confirmDialog) {
      refs.confirmDialog.dataset.tone = state.confirmation.tone || "danger";
    }
    if (refs.confirmDialogEyebrow) refs.confirmDialogEyebrow.textContent = state.confirmation.eyebrow || "확인";
    if (refs.confirmDialogTitle) refs.confirmDialogTitle.textContent = state.confirmation.title || "이 작업을 진행할까요?";
    if (refs.confirmDialogBody) refs.confirmDialogBody.textContent = state.confirmation.body || "";
    if (refs.confirmDialogConfirm) refs.confirmDialogConfirm.textContent = state.confirmation.confirmLabel || "확인";
    controllers?.mutations?.renderNotesContextList?.();
    if (refs.notesContextInput && refs.notesContextInput.value !== state.notesContext.draft) {
      refs.notesContextInput.value = state.notesContext.draft;
    }
    const selectedRecordMutationBusy = state.busy.deleteRecord
      || state.busy.regenerateNotes
      || state.busy.saveRecordContext
      || state.busy.saveRecordMemo
      || state.busy.saveRecordTitle;
    const readOnly = Boolean(state.auth?.readOnly);
    if (refs.notesContextInput) {
      refs.notesContextInput.disabled = readOnly || selectedRecordMutationBusy;
    }
    if (refs.notesContextAddButton) {
      const canAddDraft = Boolean(controllers?.mutations?.normalizeNotesContextDraftValue?.(state.notesContext.draft));
      refs.notesContextAddButton.disabled = readOnly || !canAddDraft || selectedRecordMutationBusy;
      refs.notesContextAddButton.hidden = readOnly;
      refs.notesContextAddButton.textContent = state.notesContext.editingId ? "수정 저장" : "항목 추가";
    }
    if (refs.notesContextResetButton) {
      const hasDraft = Boolean(state.notesContext.editingId || normalizeText(state.notesContext.draft));
      refs.notesContextResetButton.hidden = readOnly || !hasDraft;
      refs.notesContextResetButton.disabled = readOnly || selectedRecordMutationBusy;
      refs.notesContextResetButton.textContent = state.notesContext.editingId ? "수정 취소" : "입력 비우기";
    }
  }
})(globalThis);
