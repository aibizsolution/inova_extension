(function initHostedMeetingWorkspaceRealtime(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};

  ns.workspaceRealtime = {
    createController(deps) {
      const globalObject = deps?.global || global;
      const refs = deps?.refs || {};
      const state = deps?.state || {};
      const constants = deps?.constants || {};
      const helpers = deps?.helpers || {};
      const { buildLocalPendingJob, chooseSelectedRecordId, findHistoryEntry, normalizeArtifact, normalizeJob, normalizeRecord, normalizeWorkspaceMutation } = ns.render;
      const { clearWorkspaceAuthCache, ensureWorkspaceAuth, getCollections, subscribeDocument } = ns.firebase;
      const { isLikelyNetworkError, logDebug, normalizeText, normalizeTextBlock } = ns.shared;
      const FIRESTORE_COLLECTIONS = getCollections();
      const BOOT_INITIAL_SNAPSHOT_WAIT_MS = constants.BOOT_INITIAL_SNAPSHOT_WAIT_MS || 0;
      const DEGRADED_NOTICE_CODES = constants.DEGRADED_NOTICE_CODES || {};

      function controller(name) {
        return typeof helpers.controller === "function" ? helpers.controller(name) : null;
      }

      const setNotice = (...args) => helpers.setNotice?.(...args);
      const applyRender = (...args) => helpers.applyRender?.(...args);
      const clearDegradedNotice = (...args) => helpers.clearDegradedNotice?.(...args);
      const createEmptyNotesContextState = (...args) => helpers.createEmptyNotesContextState?.(...args);
      const createEmptyNotesInputSnapshotState = (...args) => helpers.createEmptyNotesInputSnapshotState?.(...args);
      const createEmptySelectedRecordMemoState = (...args) => helpers.createEmptySelectedRecordMemoState?.(...args);
      const setDegradedNotice = (...args) => helpers.setDegradedNotice?.(...args);
      const renderBlocked = (...args) => helpers.renderBlocked?.(...args);
      const persistWorkspaceSession = (...args) => controller("session")?.persistSession?.(...args);
      const clearWorkspaceSession = (...args) => controller("session")?.clearSession?.(...args);
      const loadPendingUploads = (...args) => controller("pendingUploads")?.loadPendingUploads?.(...args);
      const syncPendingUploadsWithRemote = (...args) => controller("pendingUploads")?.syncPendingUploadsWithRemote?.(...args);
      const handleLocalQueueAction = (...args) => controller("pendingUploads")?.handleLocalQueueAction?.(...args);
      const resolvePendingMutationsFromSnapshots = (...args) => controller("mutations")?.resolvePendingMutationsFromSnapshots?.(...args);
      const syncSelectedRecordReviewState = (...args) => controller("mutations")?.syncSelectedRecordReviewState?.(...args);

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
          setNotice("회의 정보를 다시 불러오는 중입니다.", "highlight");
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
          throw new Error("회의 작업 세션이 없어요. 패널에서 다시 열어 주세요.");
        }
        const authPayload = await ensureWorkspaceAuth(state.session.meetingSessionToken, {
          forceRefresh: forceReconnect,
        });
        const nextMeetingDocId = normalizeText(authPayload?.meetingDocumentId);
        if (!nextMeetingDocId) {
          throw new Error("회의 화면 Firestore 문서를 확인하지 못했어요.");
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
        let pendingSnapshotOptions = {
          hydrateSelection: Boolean(options.hydrateSelection),
          reason: normalizeText(options.reason) || "snapshot",
        };
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
                const snapshotOptions = pendingSnapshotOptions || {
                  hydrateSelection: false,
                  reason: "snapshot",
                };
                pendingSnapshotOptions = null;
                void handleMeetingSnapshot(snapshot, {
                  hydrateSelection: Boolean(snapshotOptions.hydrateSelection),
                  listenerVersion,
                  reason: snapshotOptions.reason,
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
          deletedAt: normalizeText(meetingPayload?.deletedAt),
          meetingId: normalizeText(meetingPayload?.meetingId) || state.session.meetingId,
          pendingLocalCount: state.pendingUploads.length,
          sharedMemo: normalizeTextBlock(meetingPayload?.sharedMemo || state.session.sharedMemo),
          title: normalizeText(meetingPayload?.title || refs.meetingTitleInput.value || state.session.title || "새 회의"),
          updatedAt: normalizeText(meetingPayload?.updatedAt),
          workspaceMutation: normalizeWorkspaceMutation(meetingPayload?.workspaceMutation),
        };
        state.session.title = state.meeting.title;
        if (
          global.document.activeElement !== refs.meetingTitleInput
          && normalizeText(state.meetingTitleDraft) === previousMeetingTitle
        ) {
          state.meetingTitleDraft = state.meeting.title;
        }
        await syncWorkspaceLocalState(Boolean(options.hydrateSelection), options.reason || "snapshot");
        await resolvePendingMutationsFromSnapshots();
        if (normalizeText(state.meeting?.deletedAt) && !state.blocked) {
          clearWorkspaceSession();
          renderBlocked("이 회의는 더 이상 열어 둘 수 없어요. 필요할 때 i-Nova 패널에서 다시 시작해 주세요.", {
            eyebrow: "회의 종료",
            title: "회의가 삭제되었습니다",
            tone: "complete",
          });
          return;
        }
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
          syncSelectedRecordReviewState(entry);
          return;
        }
      
        const shouldReconnect = Boolean(
          selectionChanged
          || normalizeText(state.realtime.jobDocId) !== normalizeText(entry.remote.jobId)
          || typeof state.realtime.unsubscribeJob !== "function"
          || (forceRefresh && !state.currentJob)
        );
        if (!shouldReconnect) {
          await ensureArtifactRealtimeSubscription(entry, { forceReconnect: false });
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
          notesContextItems: entry.remote.notesContextItems,
          notesInputSnapshot: entry.remote.notesInputSnapshot,
          context: {
            sharedMemoSnapshot: entry.remote.sharedMemoSnapshot,
          },
          source: {
            durationMs: entry.remote.durationMs,
            requestId: entry.remote.requestId,
          },
          status: entry.remote.status,
          title: entry.remote.title,
          updatedAt: entry.remote.updatedAt,
          workspaceMutation: entry.remote.workspaceMutation,
        }, state.meeting.title);
        syncSelectedRecordReviewState(entry);
        await subscribeSelectedJobRealtime(entry);
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
          await ensureArtifactRealtimeSubscription(entry, { forceReconnect: true });
          applyRender();
          return;
        }
        state.currentJob = normalizeJob(snapshot.data(), state.meeting.title);
        syncSelectedRecordReviewState(entry);
        await ensureArtifactRealtimeSubscription(entry, { forceReconnect: false });
        await resolvePendingMutationsFromSnapshots();
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
        syncSelectedRecordReviewState(findHistoryEntry(state, state.selectedRecordId));
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
        state.notesContext = createEmptyNotesContextState();
        state.selectedRecordMemo = createEmptySelectedRecordMemoState();
        state.selectedRecordNotesInputSnapshot = createEmptyNotesInputSnapshotState();
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
        const normalized = new Error(normalizeText(error?.message) || "실시간 회의 화면 연결을 복구하지 못했어요.");
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
          renderBlocked("회의 작업 세션이 만료되었거나 읽기 권한을 확인하지 못했어요. 패널에서 다시 열어 주세요.", {
            eyebrow: "회의 세션 종료",
            title: "실시간 회의 연결이 종료되었습니다",
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
      
      
      function hasWorkspaceData() {
        return Boolean(state.records.length || state.pendingUploads.length || state.currentJob || state.currentArtifact || state.selectedRecordId);
      }
      
      function isSlowResponseMessage(message) {
        return normalizeText(message).includes("회의 작업 화면 응답이 늦어지고 있어요");
      }
      
      function clearResolvedRefreshNotice() {
        clearDegradedNotice(DEGRADED_NOTICE_CODES.refresh);
      }
      
      
      function buildRefreshDegradedNotice(message, reason) {
        const normalizedMessage = normalizeText(message) || "회의 최신 상태를 다시 읽지 못했어요.";
        const normalizedReason = normalizeText(reason);
        const surfaceLabel = normalizedReason === "background"
          ? "백그라운드 동기화"
          : normalizedReason === "workflow"
            ? "작업 후 동기화"
            : "회의 동기화";
        return `${surfaceLabel}에 실패해 이전 회의 데이터를 그대로 보여주고 있습니다. 최신 기록이나 상태는 아직 반영되지 않았을 수 있습니다. 원인: ${normalizedMessage}`;
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
      

      return {
        disposeRealtime: disposeWorkspaceRealtime,
        handleBackgroundRefresh,
        handleRecordListClick,
        hydrateSelectedDetail,
        refreshWorkspace,
        syncWorkspaceLocalState,
      };
    },
  };
})(globalThis);
