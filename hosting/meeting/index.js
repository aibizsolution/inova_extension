(function initHostedMeetingWorkspace(global) {
  const ns = global.__INOVA_HOSTED_MEETING__;
  const { AUTO_RETRY_PENDING_STATUSES, DEFAULT_CREATE_JOB_TIMEOUT_MS, DEFAULT_INLINE_AUDIO_LIMIT_BYTES, DEFAULT_SOURCE_CHUNK_DURATION_MS, DEFAULT_SOURCE_CHUNK_OVERLAP_MS, DEFAULT_SOURCE_MAX_BYTES, DEFAULT_SOURCE_MAX_DURATION_MS, DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS, DEFAULT_SOURCE_TARGET_PART_BYTES, DEFAULT_SOURCE_UPLOAD_TIMEOUT_MS, SESSION_STORAGE_KEY, buildRemoteSelectionId, buildWorkspaceHash, buildWorkspaceSessionStorageKey, clearDebugEntries, formatDateTime, formatDebugEntry, getDebugEntries, isDebugPanelEnabled, isLikelyNetworkError, isLocalWorkspaceOrigin, isOnline, loadPersistedWorkspaceSession, logDebug, normalizeSpeakerAliases, normalizeText, normalizeTextBlock, parseParams, pickRecorderMimeType, postJson, resolveConfig, resolveRecordingProfile, safeLocalStorageGet, safeLocalStorageRemove, safeLocalStorageSet, safeSessionStorageSet, stopTracks, subscribeDebugEntries } = ns.shared;
  const { clearWorkspaceAuthCache, ensureWorkspaceAuth, getCollections, subscribeDocument } = ns.firebase;
  const { prepareAudioSourceChunks } = ns.audioChunker;
  const { blobToBase64, createPendingUploadStore, normalizePendingUpload } = ns.storage;
  const { buildDetailView, buildLocalPendingJob, buildPendingNotice, buildPendingSummary, buildSegmentCopyText, chooseSelectedRecordId, findHistoryEntry, findRemoteForPending, normalizeArtifact, normalizeJob, normalizeRecord, renderWorkspace } = ns.render;

  const CONFIG = resolveConfig(global.__INOVA_HOSTED_MEETING_CONFIG__);
  const FIRESTORE_COLLECTIONS = getCollections();
  const DEBUG_PANEL_COLLAPSED_STORAGE_KEY = "__INOVA_MEETING_DEBUG_PANEL_COLLAPSED__";
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
      debugPanelCollapsed: readDebugPanelCollapsed(),
      isLocalWorkspace: isLocalWorkspaceOrigin(global),
      loading: false,
      loadingReason: "",
      meetingTitleDraft: "",
      media: createEmptyMediaState(),
      meeting: { meetingId: "", pendingLocalCount: 0, sharedMemo: "", title: "", updatedAt: "" },
      mode: "create",
      notice: { sticky: false, text: "", tone: "" },
      noticeTimer: 0,
      params: parseParams(global.location.href),
      pendingUploads: [],
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
      runtimeChunkCache: Object.create(null),
      selectedRecordId: "",
      session: { expiresAt: "", meetingId: "", meetingSessionToken: "", mode: "create", sharedMemo: "", title: "" },
      speakerAliasDraftRecordId: "",
      speakerAliasDrafts: Object.create(null),
      unsubscribeDebug: null,
    };
  }

  function readDebugPanelCollapsed() {
    return normalizeText(safeLocalStorageGet(global, DEBUG_PANEL_COLLAPSED_STORAGE_KEY)) === "1";
  }

  function cacheRefs() {
    for (const id of ["meetingShell", "blockedMessage", "blockedEyebrow", "blockedTitle", "blockedState", "workspace", "pageTitle", "pageSummary", "workspaceBadge", "offlineQueueBadge", "refreshButton", "meetingTitleInput", "saveMeetingTitleButton", "deleteMeetingButton", "meetingStatusChip", "currentBadge", "currentSummary", "currentHint", "currentNotice", "currentTimer", "startButton", "importAudioButton", "importAudioInput", "pauseButton", "resumeButton", "stopButton", "discardButton", "sharedMemoInput", "saveSharedMemoButton", "clearSharedMemoButton", "sharedMemoNotice", "recordCountBadge", "recordList", "detailTitle", "detailBadge", "detailSummary", "recordTitleGroup", "recordTitleInput", "saveRecordTitleButton", "downloadRecordButton", "deleteRecordButton", "detailMeta", "speakerEditor", "speakerAliasList", "saveSpeakerAliasesButton", "saveSpeakerAliasesAndRegenerateButton", "copySegmentsButton", "detailMemoText", "reviewTabSummary", "reviewTabMemo", "reviewTabNotes", "reviewTabSegments", "reviewTabSegmentsCount", "reviewTabSpeakers", "reviewPanelSummary", "summaryStatusPill", "summaryStatusGrid", "summaryActionCard", "reviewPanelMemo", "meetingNotesCard", "reviewPanelSegments", "reviewPanelSpeakers", "speakerDigestList", "notesSummaryMeta", "notesStyleSelect", "regenerateNotesButton", "meetingNotesOverview", "meetingNotesSections", "detailNotice", "segmentList", "debugPanel", "debugPanelCard", "debugPanelBody", "debugStatus", "debugLog", "debugFabButton", "debugFabBadge", "copyDebugButton", "copyDebugErrorsButton", "clearDebugButton", "toggleDebugPanelButton", "confirmOverlay", "confirmDialog", "confirmDialogEyebrow", "confirmDialogTitle", "confirmDialogBody", "confirmDialogCancel", "confirmDialogConfirm"]) {
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
    if (refs.copyDebugButton) {
      refs.copyDebugButton.addEventListener("click", copyDebugLog);
    }
    if (refs.copyDebugErrorsButton) {
      refs.copyDebugErrorsButton.addEventListener("click", copyDebugErrors);
    }
    if (refs.clearDebugButton) {
      refs.clearDebugButton.addEventListener("click", clearDebugLogPanel);
    }
    if (refs.toggleDebugPanelButton) {
      refs.toggleDebugPanelButton.addEventListener("click", toggleDebugPanelCollapsed);
    }
    if (refs.debugFabButton) {
      refs.debugFabButton.addEventListener("click", toggleDebugPanelCollapsed);
    }
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

  async function bootstrap() {
    cacheRefs();
    bindEvents();
    setupDebugPanel();
    logDebug("workspace.recording.profile", state.recordingProfile);
    logDebug("workspace.bootstrap", {
      href: global.location.href,
      params: state.params,
    });
    await bootWorkspace();
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
        return renderBlocked("직접 주소를 붙여 넣어 열면 회의 세션을 확인할 수 없습니다. i-Nova 패널의 회의 허브에서 다시 열어 주세요.");
      }
      state.meetingTitleDraft = normalizeText(state.meeting.title || state.session.title);
      refs.meetingTitleInput.value = state.meetingTitleDraft;
      state.recordMemoSaved = normalizeTextBlock(state.session.sharedMemo);
      state.recordMemoDraft = state.recordMemoSaved;
      refs.sharedMemoInput.value = state.recordMemoDraft;
      await loadPendingUploads();
      await refreshWorkspace(true, "boot");
      retryPendingUploads();
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
    logDebug("workspace.session.restore", {
      hasRestoredPayload: Boolean(restored?.payload),
      meetingId: state.params.meetingId,
      source: restored?.source || "",
      workspaceToken: Boolean(state.params.workspaceToken),
    });
    if (!restored?.payload) return;
    const parsed = restored.payload;
    state.mode = normalizeText(parsed?.mode) === "detail" ? "detail" : "create";
    state.session = { expiresAt: normalizeText(parsed?.expiresAt), meetingId: normalizeText(parsed?.meetingId), meetingSessionToken: normalizeText(parsed?.meetingSessionToken), mode: state.mode, sharedMemo: normalizeTextBlock(parsed?.sharedMemo), title: normalizeText(parsed?.title) };
    state.meeting = { meetingId: state.session.meetingId, pendingLocalCount: 0, sharedMemo: state.session.sharedMemo, title: state.session.title, updatedAt: "" };
    state.selectedRecordId = normalizeText(state.params.jobId || parsed?.jobId) ? buildRemoteSelectionId(state.params.jobId || parsed?.jobId) : "";
  }

  async function refreshWorkspace(hydrateSelection, reason) {
    if (state.blocked || state.loading) return null;
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
      clearTransientRefreshNotice();
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
      if (shouldSuppressRefreshError(error, message, reason)) {
        clearTransientRefreshNotice();
        applyRender();
        return null;
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

  async function loadPendingUploads() {
    state.pendingUploads = state.session.meetingId
      ? (await state.queueStore.listByMeeting(state.session.meetingId))
        .map(normalizePendingUpload)
        .map((item) => ["uploading", "uploading_chunks", "preparing_chunks"].includes(item.status)
          ? { ...item, status: "upload_queued", lastError: item.lastError || "페이지를 다시 열어 업로드를 이어갑니다." }
          : item)
        .sort(ns.storage.comparePendingUploads)
      : [];
    state.meeting.pendingLocalCount = state.pendingUploads.length;
  }

  async function syncPendingUploadsWithRemote() {
    const nextItems = [];
    for (const pending of state.pendingUploads) {
      const matched = findRemoteForPending(state, pending);
      if (!matched) nextItems.push(pending);
      else if (matched.status === "succeeded") {
        const nextPending = normalizePendingUpload({
          ...pending,
          hold: false,
          jobId: normalizeText(matched.jobId || pending.jobId),
          lastError: "",
          status: "succeeded",
          updatedAt: normalizeText(matched.updatedAt || pending.updatedAt),
        });
        await state.queueStore.put(nextPending);
        delete state.runtimeChunkCache[normalizeText(pending.requestId)];
        if (state.selectedRecordId === ns.shared.buildLocalSelectionId(pending.requestId)) state.selectedRecordId = buildRemoteSelectionId(matched.jobId);
        nextItems.push(nextPending);
      } else {
        const nextPending = normalizePendingUpload({ ...pending, jobId: normalizeText(matched.jobId || pending.jobId), lastError: normalizeText(matched.error || pending.lastError), status: matched.status === "processing" ? "remote_processing" : matched.status === "queued" ? "remote_queued" : matched.status === "failed" ? (pending.hold ? "on_hold" : "failed") : pending.status, updatedAt: normalizeText(matched.updatedAt || pending.updatedAt) });
        await state.queueStore.put(nextPending);
        if (state.selectedRecordId === ns.shared.buildLocalSelectionId(pending.requestId) && nextPending.jobId) state.selectedRecordId = buildRemoteSelectionId(nextPending.jobId);
        nextItems.push(nextPending);
      }
    }
    state.pendingUploads = nextItems.sort(ns.storage.comparePendingUploads);
    state.meeting.pendingLocalCount = state.pendingUploads.length;
  }

  async function connectWorkspaceRealtime(options = {}) {
    const forceReconnect = Boolean(options.forceReconnect);
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
      state.realtime.unsubscribeMeeting = subscribeDocument(FIRESTORE_COLLECTIONS.meetings, nextMeetingDocId, {
        error: (error) => {
          if (listenerVersion !== state.realtime.meetingListenerVersion) return;
          const normalizedError = normalizeRealtimeError(error);
          handleRealtimeListenerError(normalizedError, "meeting");
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
              handleRealtimeListenerError(normalizedError, "meeting");
              finishReject(normalizedError);
            });
        },
      });
    });

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
      forceRefresh
      || selectionChanged
      || normalizeText(state.realtime.jobDocId) !== normalizeText(entry.remote.jobId)
      || typeof state.realtime.unsubscribeJob !== "function"
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
    await upsertPendingUpload(pending);
    state.recordMemoDraft = "";
    state.recordMemoSaved = "";
    state.session.sharedMemo = "";
    refs.sharedMemoInput.value = "";
    refs.sharedMemoNotice.hidden = true;
    refs.sharedMemoNotice.textContent = "";
    state.reviewTab = "summary";
    state.selectedRecordId = ns.shared.buildLocalSelectionId(pending.requestId);
    setNotice("파일을 불러왔고 자동 전사를 시작했습니다.", "highlight");
    applyRender();
    void attemptPendingUpload(pending.requestId);
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
    const pending = normalizePendingUpload({ blob, captureMode: "microphone", channelCount: state.capture.channelCount, createdAt: endedAt, durationMs: state.capture.durationMs, endedAt, hold: false, jobId: "", lastError: "", meetingId: state.session.meetingId, meetingTitleSnapshot: buildRecordTitle(endedAt), mimeType: blob.type, originalSizeBytes: blob.size, parts: [], preparedPartCount: 0, requestId: state.capture.requestId || ns.shared.generateCaptureRequestId(global), sharedMemoSnapshot: normalizeTextBlock(refs.sharedMemoInput.value || state.recordMemoDraft || state.recordMemoSaved), sizeBytes: blob.size, sourceMode: inferSourceMode(blob.size, state.capture.durationMs), startedAt: state.capture.startedAt, status: "local_saved", uploadedPartCount: 0, updatedAt: endedAt });
    await upsertPendingUpload(pending);
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
      setNotice("녹음을 브라우저에 저장했고 자동 전사를 시작했습니다. 지금 바로 다음 녹음을 시작할 수 있습니다.", "highlight");
      applyRender();
    }
    void attemptPendingUpload(pending.requestId);
  }

  async function attemptPendingUpload(requestId) {
    const pending = state.pendingUploads.find((item) => item.requestId === normalizeText(requestId));
    if (!pending || pending.hold || state.busy.queue[requestId]) return;
    if (!isOnline(global)) { await upsertPendingUpload({ ...pending, lastError: "인터넷이 돌아오면 자동으로 업로드합니다.", status: "upload_queued" }); return applyRender(); }
    state.busy.queue[requestId] = true;
    await upsertPendingUpload({ ...pending, lastError: "", status: shouldUseChunkedSource(pending) ? "preparing_chunks" : "uploading" });
    applyRender();
    try {
      let latest = state.pendingUploads.find((item) => item.requestId === normalizeText(requestId));
      const sourceSizeBytes = Math.max(0, Number(latest?.originalSizeBytes) || Number(latest?.sizeBytes) || Number(latest?.blob?.size) || 0);
      if (sourceSizeBytes > DEFAULT_SOURCE_MAX_BYTES) {
        throw new Error(`현재 회의 원본은 ${Math.floor(DEFAULT_SOURCE_MAX_BYTES / (1024 * 1024))}MB 이하까지만 지원해요.`);
      }
      if (Math.max(0, Number(latest?.durationMs) || 0) > DEFAULT_SOURCE_MAX_DURATION_MS) {
        throw new Error("현재 회의 원본은 최대 2시간까지만 지원해요.");
      }
      if (shouldUseChunkedSource(latest)) {
        latest = await upsertPendingUpload({
          ...latest,
          lastError: "",
          sourceMode: "chunked",
          status: "preparing_chunks",
        });
        const prepared = await getOrPrepareChunkedSource(latest);
        latest = await upsertPendingUpload({
          ...latest,
          lastError: "",
          mimeType: prepared.mimeType,
          originalSizeBytes: sourceSizeBytes,
          parts: prepared.parts,
          preparedPartCount: prepared.parts.length,
          sourceMode: "chunked",
          status: "uploading_chunks",
          uploadedPartCount: prepared.parts.filter((part) => normalizeText(part.storageObject)).length,
        });
        for (const preparedPart of prepared.parts) {
          const currentPending = state.pendingUploads.find((item) => item.requestId === normalizeText(requestId));
          const currentPart = (currentPending?.parts || []).find((part) => Number(part.index) === Number(preparedPart.index));
          if (normalizeText(currentPart?.storageObject)) {
            continue;
          }
          const uploaded = await uploadPendingSource(currentPending || latest, {
            blob: preparedPart.blob,
            endMs: preparedPart.endMs,
            fileName: buildChunkPartFileName(currentPending || latest, preparedPart.index),
            mimeType: prepared.mimeType,
            overlapMs: preparedPart.overlapMs,
            parentRequestId: normalizeText((currentPending || latest)?.requestId),
            partCount: prepared.parts.length,
            partIndex: preparedPart.index,
            requestId: preparedPart.requestId,
            sizeBytes: preparedPart.sizeBytes,
            startMs: preparedPart.startMs,
          });
          latest = await updatePendingChunkUploadState(normalizeText((currentPending || latest)?.requestId), preparedPart.index, uploaded);
        }
      } else if (!normalizeText(latest?.storageObject)) {
        latest = await upsertPendingUpload({
          ...latest,
          lastError: "",
          originalSizeBytes: sourceSizeBytes,
          sourceMode: "single",
          status: "uploading",
        });
        try {
          const uploaded = await uploadPendingSource(latest);
          latest = await upsertPendingUpload({
            ...latest,
            lastError: "",
            originalSizeBytes: sourceSizeBytes,
            sizeBytes: Math.max(sourceSizeBytes, Number(uploaded?.sizeBytes) || 0),
            sourceMode: "single",
            status: "uploading",
            storageObject: normalizeText(uploaded?.storageObject),
          });
        } catch (uploadError) {
          logDebug("workspace.source-upload.fallback-inline", {
            error: uploadError,
            requestId,
            sizeBytes: sourceSizeBytes,
          });
          latest = await upsertPendingUpload({
            ...latest,
            lastError: "",
            originalSizeBytes: sourceSizeBytes,
            sourceMode: "single",
            status: "uploading",
            storageObject: "",
          });
          setNotice("임시 오디오 업로드가 실패해도 현재 파일은 바로 전사 경로로 이어갑니다.", "highlight");
          applyRender();
        }
      }
      const created = await postJson(global, CONFIG.createJobUrl, await buildCreateJobPayload(latest), state.session.meetingSessionToken, {
        timeoutMs: DEFAULT_CREATE_JOB_TIMEOUT_MS,
      });
      const createdJob = normalizeJob(created?.job, latest.meetingTitleSnapshot);
      await upsertPendingUpload({ ...latest, jobId: normalizeText(createdJob?.jobId), lastError: "", status: normalizeText(createdJob?.status) === "processing" ? "remote_processing" : "remote_queued" });
      if (createdJob?.jobId && latest.meetingTitleSnapshot && latest.meetingTitleSnapshot !== getWorkspaceTitleOrFallback()) {
        try {
          await postJson(global, CONFIG.updateMeetingResultUrl, {
            jobId: createdJob.jobId,
            meetingId: state.session.meetingId,
            title: latest.meetingTitleSnapshot,
          }, state.session.meetingSessionToken);
        } catch (renameError) {
          logDebug("workspace.record.rename.after-create.error", {
            error: renameError,
            jobId: createdJob.jobId,
            recordTitle: latest.meetingTitleSnapshot,
          });
        }
      }
      setNotice("자동 전사를 접수했습니다. 결과를 계속 확인하는 중입니다.", "highlight");
      await syncWorkspaceLocalState(false, "workflow");
    } catch (error) {
      const latest = state.pendingUploads.find((item) => item.requestId === normalizeText(requestId));
      if (latest) await upsertPendingUpload({ ...latest, lastError: error instanceof Error ? error.message : "업로드를 이어가지 못했어요.", status: isLikelyNetworkError(global, error) ? "upload_queued" : "failed" });
      setNotice(error instanceof Error ? error.message : "업로드를 이어가지 못했어요.", "error");
      applyRender();
    } finally {
      delete state.busy.queue[requestId];
      applyRender();
    }
  }

  async function buildCreateJobPayload(item) {
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
      }));
    } else if (normalizeText(item.storageObject)) {
      source.storageObject = normalizeText(item.storageObject);
    } else {
      source.inlineAudioBase64 = await blobToBase64(item.blob);
    }
    return {
      meeting: { endedAt: item.endedAt, language: "ko", meetingId: state.session.meetingId, sharedMemo: item.sharedMemoSnapshot, startedAt: item.startedAt, title: getWorkspaceTitleOrFallback() },
      options: { redaction: "none", speakerLabels: true, summary: true },
      source,
      context: { sharedMemoSnapshot: item.sharedMemoSnapshot },
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

  async function updatePendingChunkUploadState(requestId, partIndex, uploaded) {
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
      if (entry.pending?.requestId) await deletePendingUpload(entry.pending.requestId);
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
      await state.queueStore.clearMeeting(state.session.meetingId);
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
        await upsertPendingUpload(nextPending);
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
    const pending = state.pendingUploads.find((item) => item.requestId === normalizeText(requestId));
    if (!pending) return;
    if (normalizeText(action) === "retry") return attemptPendingUpload(requestId);
    if (normalizeText(action) === "hold") return upsertPendingUpload({ ...pending, hold: true, status: "on_hold", lastError: pending.lastError || "업로드를 잠시 멈췄습니다." }).then(applyRender);
    if (normalizeText(action) === "resume") { await upsertPendingUpload({ ...pending, hold: false, status: "upload_queued", lastError: "" }); return retryPendingUploads(); }
    if (normalizeText(action) === "delete") {
      if (!await requestConfirmation({
        body: "아직 원격 처리 전이면 복구할 수 없습니다.",
        confirmLabel: "로컬 기록 삭제",
        eyebrow: "로컬 삭제",
        title: "이 로컬 기록을 삭제할까요?",
        tone: "danger",
      })) return;
      return deletePendingUpload(requestId);
    }
  }

  async function deletePendingUpload(requestId) {
    delete state.runtimeChunkCache[normalizeText(requestId)];
    await state.queueStore.delete(requestId);
    state.pendingUploads = state.pendingUploads.filter((item) => item.requestId !== normalizeText(requestId));
    if (state.selectedRecordId === ns.shared.buildLocalSelectionId(requestId)) state.selectedRecordId = chooseSelectedRecordId(state);
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
    if (refs.meetingShell) {
      refs.meetingShell.dataset.debugPanel = String(enabled);
    }
    refs.debugPanel.hidden = !enabled;
    if (!enabled) return;
    syncDebugPanelCollapsedUi({ persist: false });
    renderDebugEntries(getDebugEntries());
    state.unsubscribeDebug = subscribeDebugEntries(renderDebugEntries);
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
    if (refs.debugPanelCard) {
      refs.debugPanelCard.hidden = Boolean(state.debugPanelCollapsed);
    }
    if (refs.debugPanelBody) {
      refs.debugPanelBody.hidden = Boolean(state.debugPanelCollapsed);
    }
    if (refs.debugFabButton) {
      refs.debugFabButton.hidden = !state.debugPanelCollapsed;
    }
    if (refs.toggleDebugPanelButton) {
      refs.toggleDebugPanelButton.textContent = "접기";
      refs.toggleDebugPanelButton.setAttribute("aria-expanded", String(!state.debugPanelCollapsed));
    }
    if (persist) {
      safeLocalStorageSet(global, DEBUG_PANEL_COLLAPSED_STORAGE_KEY, state.debugPanelCollapsed ? "1" : "0");
    }
  }

  function renderDebugEntries(entries) {
    if (!refs.debugPanel || refs.debugPanel.hidden) return;
    const normalizedEntries = Array.isArray(entries) ? entries : [];
    const summary = summarizeDebugEntries(normalizedEntries);
    const nextText = normalizedEntries.length
      ? normalizedEntries.map((entry) => formatDebugEntry(entry)).join("\n\n")
      : "아직 로그가 없습니다.";
    if (refs.debugStatus) {
      refs.debugStatus.textContent = `로그 ${summary.totalLogs}건 · 함수 ${summary.functionCalls}건 · 스냅샷 ${summary.firestoreListenerEvents}건 · 오류 ${summary.totalErrors}건`;
    }
    if (refs.debugFabBadge) {
      refs.debugFabBadge.hidden = summary.totalErrors < 1;
    }
    syncDebugLogViewport(refs.debugLog, nextText);
  }

  function readDebugLogViewport(element) {
    if (!(element instanceof global.HTMLElement)) {
      return null;
    }
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    return {
      scrollTop: Math.max(0, Number(element.scrollTop) || 0),
      stickToBottom: maxScrollTop - element.scrollTop <= 28,
    };
  }

  function syncDebugLogViewport(element, text) {
    if (!(element instanceof global.HTMLElement)) {
      return;
    }
    const previousViewport = readDebugLogViewport(element);
    if (element.textContent !== text) {
      element.textContent = text;
    }
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    if (!previousViewport || previousViewport.stickToBottom) {
      element.scrollTop = maxScrollTop;
      return;
    }
    element.scrollTop = Math.min(previousViewport.scrollTop, maxScrollTop);
  }

  function summarizeDebugEntries(entries) {
    const endpointCounts = new Map();
    const listenerCounts = new Map();
    let functionCalls = 0;
    let functionResponses = 0;
    let functionErrorLogs = 0;
    let firestoreAuthEvents = 0;
    let firestoreErrorLogs = 0;
    let firestoreListenerEvents = 0;

    for (const entry of entries) {
      const classification = classifyDebugEntry(entry);
      if (classification.type === "function-request") {
        functionCalls += 1;
        endpointCounts.set(
          classification.endpoint,
          (endpointCounts.get(classification.endpoint) || 0) + 1
        );
        continue;
      }
      if (classification.type === "function-response") {
        functionResponses += 1;
        continue;
      }
      if (classification.type === "function-error") {
        functionErrorLogs += 1;
        continue;
      }
      if (classification.type === "firestore-auth") {
        firestoreAuthEvents += 1;
        continue;
      }
      if (classification.type === "firestore-listener") {
        firestoreListenerEvents += 1;
        if (classification.endpoint) {
          listenerCounts.set(
            classification.endpoint,
            (listenerCounts.get(classification.endpoint) || 0) + 1
          );
        }
        continue;
      }
      if (classification.type === "firestore-error") {
        firestoreErrorLogs += 1;
      }
    }

    const functionSummary = endpointCounts.size
      ? Array.from(endpointCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ko-KR"))
        .slice(0, 3)
        .map(([endpoint, count]) => `${endpoint} ${count}회`)
        .join(" · ")
      : "";
    const listenerSummary = listenerCounts.size
      ? Array.from(listenerCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ko-KR"))
        .slice(0, 3)
        .map(([endpoint, count]) => `${endpoint} ${count}건`)
        .join(" · ")
      : "";
    const endpointSummary = [functionSummary, listenerSummary].filter(Boolean).join(" · ")
      || "아직 함수/Firestore 연결 로그가 없습니다.";

    return {
      endpointSummary,
      firestoreAuthEvents,
      firestoreErrorLogs,
      firestoreListenerEvents,
      functionCalls,
      functionErrorLogs,
      functionResponses,
      otherLogs: Math.max(
        0,
        entries.length
          - functionCalls
          - functionResponses
          - functionErrorLogs
          - firestoreAuthEvents
          - firestoreListenerEvents
          - firestoreErrorLogs
      ),
      totalErrors: functionErrorLogs + firestoreErrorLogs,
      totalLogs: entries.length,
    };
  }

  function classifyDebugEntry(entry) {
    const event = normalizeText(entry?.event);
    const url = normalizeText(entry?.payload?.url);
    if (event === "http.request" || event === "workspace.source-upload.request") {
      return {
        endpoint: extractFunctionEndpointLabel(url, event),
        type: "function-request",
      };
    }
    if (event === "http.response" || event === "workspace.source-upload.response") {
      return {
        endpoint: extractFunctionEndpointLabel(url, event),
        type: "function-response",
      };
    }
    if (
      event === "http.error"
      || event === "http.timeout"
      || event === "workspace.source-upload.error"
      || event === "workspace.source-upload.timeout"
    ) {
      return {
        endpoint: extractFunctionEndpointLabel(url, event),
        type: "function-error",
      };
    }
    if (event === "firestore.auth.start" || event === "firestore.auth.success") {
      return {
        endpoint: "workspace-auth",
        type: "firestore-auth",
      };
    }
    if (event === "firestore.auth.error" || event === "firestore.listener.error") {
      return {
        endpoint: normalizeText(entry?.payload?.collection) || "firestore",
        type: "firestore-error",
      };
    }
    if (
      event === "firestore.listener.attach"
      || event === "firestore.listener.detach"
      || event === "firestore.listener.snapshot"
    ) {
      return {
        endpoint: normalizeText(entry?.payload?.collection) || "firestore-doc",
        type: "firestore-listener",
      };
    }
    return {
      endpoint: "",
      type: "local-log",
    };
  }

  function extractFunctionEndpointLabel(url, event) {
    const normalizedUrl = normalizeText(url);
    if (!normalizedUrl) {
      return normalizeText(event) || "unknown";
    }
    try {
      const parsed = new URL(normalizedUrl);
      return normalizeText(parsed.pathname.split("/").filter(Boolean).pop()) || normalizeText(event) || "unknown";
    } catch {
      return normalizeText(event) || "unknown";
    }
  }

  function clearDebugLogPanel() {
    clearDebugEntries();
    logDebug("workspace.debug.cleared", {});
  }

  async function copyDebugLog() {
    const text = normalizeText(refs.debugLog?.textContent);
    if (!text) return;
    try {
      if (typeof global.navigator?.clipboard?.writeText === "function") {
        await global.navigator.clipboard.writeText(text);
        setNotice("디버그 로그를 복사했습니다.", "highlight");
      } else {
        throw new Error("Clipboard API unavailable");
      }
    } catch {
      setNotice("클립보드 권한이 없어 로그 복사를 완료하지 못했어요.", "error");
    }
    applyRender();
  }

  async function copyDebugErrors() {
    const entries = getDebugEntries();
    const errorEntries = entries.filter((entry) => {
      const classification = classifyDebugEntry(entry);
      return classification.type === "function-error" || classification.type === "firestore-error";
    });
    const text = normalizeText(errorEntries.map((entry) => formatDebugEntry(entry)).join("\n\n"));
    if (!text) {
      setNotice("복사할 오류 로그가 없습니다.", "highlight");
      applyRender();
      return;
    }
    try {
      if (typeof global.navigator?.clipboard?.writeText === "function") {
        await global.navigator.clipboard.writeText(text);
        setNotice("오류 로그를 복사했습니다.", "highlight");
      } else {
        throw new Error("Clipboard API unavailable");
      }
    } catch {
      setNotice("클립보드 권한이 없어 오류 로그 복사를 완료하지 못했어요.", "error");
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

  function retryPendingUploads() {
    for (const pending of state.pendingUploads) {
      if (!pending.hold && AUTO_RETRY_PENDING_STATUSES.has(pending.status)) attemptPendingUpload(pending.requestId);
    }
  }

  function handleOnline() { setNotice("인터넷 연결이 돌아왔습니다. 보관한 녹음을 다시 확인합니다.", "highlight"); retryPendingUploads(); applyRender(); }
  function handleOffline() { setNotice("인터넷이 끊겨도 종료된 녹음은 브라우저에 보관합니다. 연결이 돌아오면 이어서 업로드합니다.", "highlight"); applyRender(); }

  async function upsertPendingUpload(item) { const normalized = normalizePendingUpload({ ...item, updatedAt: new Date().toISOString() }); await state.queueStore.put(normalized); state.pendingUploads = [normalized, ...state.pendingUploads.filter((current) => current.requestId !== normalized.requestId)].sort(ns.storage.comparePendingUploads); state.meeting.pendingLocalCount = state.pendingUploads.length; return normalized; }
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
  function setNotice(text, tone, options = {}) {
    global.clearTimeout(state.noticeTimer);
    const nextText = normalizeText(text);
    const nextTone = normalizeText(tone);
    const sticky = Boolean(options?.sticky || nextTone === "error");
    state.notice = { sticky, text: nextText, tone: nextTone };
    if (!nextText || sticky) {
      state.noticeTimer = 0;
      return;
    }
    state.noticeTimer = global.setTimeout(() => {
      if (state.notice.text === nextText && state.notice.tone === nextTone) {
        state.notice = { sticky: false, text: "", tone: "" };
        state.noticeTimer = 0;
        applyRender();
      }
    }, 2600);
  }
  function persistWorkspaceSession() { const entry = findHistoryEntry(state, state.selectedRecordId); const payload = { expiresAt: state.session.expiresAt, jobId: normalizeText(entry?.remote?.jobId || entry?.pending?.jobId), meetingId: state.session.meetingId, meetingSessionToken: state.session.meetingSessionToken, mode: state.mode, sharedMemo: normalizeTextBlock(state.recordMemoDraft || state.recordMemoSaved), title: normalizeText(state.meeting.title || state.session.title) }; safeSessionStorageSet(global, SESSION_STORAGE_KEY, JSON.stringify(payload)); if (payload.meetingId) safeLocalStorageSet(global, buildWorkspaceSessionStorageKey(payload.meetingId), JSON.stringify(payload)); replaceCleanUrl(); }
  function clearWorkspaceSession() { try { global.sessionStorage.removeItem(SESSION_STORAGE_KEY); } catch {} if (state.session.meetingId) safeLocalStorageRemove(global, buildWorkspaceSessionStorageKey(state.session.meetingId)); disposeWorkspaceRealtime({ clearAuthCache: true }); }
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
      return;
    }
    refs.blockedState.hidden = true;
    refs.workspace.hidden = false;
    renderWorkspace(state, refs);
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
  function clearTransientRefreshNotice() {
    if (!state.notice.text) return;
    if (!state.notice.sticky) {
      setNotice("", "");
      return;
    }
    if (state.notice.tone !== "error") return;
    if (isSlowResponseMessage(state.notice.text) || isLikelyNetworkError(global, state.notice.text)) {
      setNotice("", "");
    }
  }
  function shouldSuppressRefreshError(error, message, reason) {
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
