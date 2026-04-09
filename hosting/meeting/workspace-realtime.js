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
      const { clearWorkspaceAuthCache, ensureWorkspaceAuth, getCollections, readDocument, subscribeDocument } = ns.firebase;
      const { TERMINAL_REMOTE_STATUSES, isLikelyNetworkError, logDebug, normalizeText, normalizeTextBlock } = ns.shared;
      const FIRESTORE_COLLECTIONS = getCollections();
      const BOOT_INITIAL_SNAPSHOT_WAIT_MS = constants.BOOT_INITIAL_SNAPSHOT_WAIT_MS || 0;
      const DEGRADED_NOTICE_CODES = constants.DEGRADED_NOTICE_CODES || {};
      const SELECTED_DETAIL_POLL_INTERVAL_MS = constants.SELECTED_DETAIL_POLL_INTERVAL_MS || 10 * 1000;
      let selectedDetailPollTimer = 0;
      let selectedDetailPollVersion = 0;
      let selectedDetailPollInFlight = false;

      function controller(name) {
        return typeof helpers.controller === "function" ? helpers.controller(name) : null;
      }

      function shouldDeferSelectedDetailHydration(reason) {
        const normalizedReason = normalizeText(reason);
        return normalizedReason === "boot" || normalizedReason === "boot-deferred";
      }

      function isSelectedDetailRequestStale(expectedSelectionId, requestVersion) {
        if (requestVersion > 0 && Number(state.selectedDetailHydrateVersion) !== Number(requestVersion)) {
          return true;
        }
        return Boolean(normalizeText(expectedSelectionId))
          && normalizeText(state.currentDetailSelectionId) !== normalizeText(expectedSelectionId);
      }

      const setNotice = (...args) => helpers.setNotice?.(...args);
      const applyRender = (...args) => helpers.applyRender?.(...args);
      const clearDegradedNotice = (...args) => helpers.clearDegradedNotice?.(...args);
      const createEmptyNotesInputSnapshotState = (...args) => helpers.createEmptyNotesInputSnapshotState?.(...args);
      const createEmptySelectedRecordMemoState = (...args) => helpers.createEmptySelectedRecordMemoState?.(...args);
      const createEmptySectionEditState = (...args) => helpers.createEmptySectionEditState?.(...args);
      const createEmptyTermReplacementState = (...args) => helpers.createEmptyTermReplacementState?.(...args);
      const setDegradedNotice = (...args) => helpers.setDegradedNotice?.(...args);
      const renderBlocked = (...args) => helpers.renderBlocked?.(...args);
      const persistWorkspaceSession = (...args) => controller("session")?.persistSession?.(...args);
      const clearWorkspaceSession = (...args) => controller("session")?.clearSession?.(...args);
      const loadPendingUploads = (...args) => controller("pendingUploads")?.loadPendingUploads?.(...args);
      const reconcileRemoteRecordSummaries = (...args) => controller("pendingUploads")?.reconcileRemoteRecordSummaries?.(...args);
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
        const refreshStartedAt = Date.now();
        let pendingLoadMs;
        let realtimeConnectMs;
        try {
          logDebug("workspace.refresh.start", {
            hydrateSelection: Boolean(hydrateSelection),
            meetingId: state.session.meetingId,
            reason,
          });
          const pendingLoadStartedAt = Date.now();
          await loadPendingUploads();
          pendingLoadMs = Math.max(0, Date.now() - pendingLoadStartedAt);
          if (state.loadingReason === "boot") {
            // Show the workspace shell as soon as local state is ready.
            applyRender();
          }
          const shouldReconnect = Boolean(
            normalizeText(reason) === "boot"
            || normalizeText(reason) === "manual"
            || !state.realtime.unsubscribeMeeting
          );
          const realtimeConnectStartedAt = Date.now();
          await connectWorkspaceRealtime({
            forceReconnect: shouldReconnect,
            hydrateSelection: Boolean(hydrateSelection),
            reason,
          });
          realtimeConnectMs = Math.max(0, Date.now() - realtimeConnectStartedAt);
          if (!shouldReconnect) {
            await syncWorkspaceLocalState(Boolean(hydrateSelection), reason);
          }
          clearResolvedRefreshNotice();
          applyRender();
          logDebug("workspace.refresh.success", {
            elapsedMs: Math.max(0, Date.now() - refreshStartedAt),
            meetingId: state.meeting.meetingId,
            pendingLocalCount: state.pendingUploads.length,
            pendingLoadMs,
            reason,
            resultCount: state.records.length,
            realtimeConnectMs,
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
        const connectStartedAt = Date.now();
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
        if (!state.session.meetingId) {
          throw new Error("회의 작업실 접근 권한이 없어요. 패널에서 다시 열어 주세요.");
        }
        const authStartedAt = Date.now();
        const authPayload = await ensureWorkspaceAuth({
          forceRefresh: forceReconnect,
        });
        const authElapsedMs = Math.max(0, Date.now() - authStartedAt);
        const nextMeetingDocId = normalizeText(authPayload?.meetingDocumentId);
        if (!nextMeetingDocId) {
          throw new Error("회의 화면 Firestore 문서를 확인하지 못했어요.");
        }
      
        state.realtime.meetingDocId = nextMeetingDocId;
        state.realtime.workspaceAuthExpiresAt = "";
        state.realtime.workspaceSessionId = "";
      
        if (!forceReconnect && typeof state.realtime.unsubscribeMeeting === "function") {
          logDebug("workspace.realtime.connect.reuse-listener", {
            authElapsedMs,
            elapsedMs: Math.max(0, Date.now() - connectStartedAt),
            meetingId: state.session.meetingId,
            reason: normalizeText(options.reason),
          });
          return authPayload;
        }
      
        disconnectMeetingListener({ clearDetail: true });
        const listenerVersion = state.realtime.meetingListenerVersion + 1;
        state.realtime.meetingListenerVersion = listenerVersion;
      
        let awaitingInitialSnapshot = true;
        const initialSnapshotWaitStartedAt = Date.now();
        let initialSnapshotWaitMs = 0;
        let initialSnapshotHandleMs = 0;
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
                initialSnapshotWaitMs = Math.max(0, Date.now() - initialSnapshotWaitStartedAt);
                const initialSnapshotHandleStartedAt = Date.now();
                void handleMeetingSnapshot(snapshot, {
                  hydrateSelection: Boolean(snapshotOptions.hydrateSelection),
                  listenerVersion,
                  reason: snapshotOptions.reason,
                })
                  .then(() => {
                    initialSnapshotHandleMs = Math.max(0, Date.now() - initialSnapshotHandleStartedAt);
                    finishResolve();
                  })
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
          logDebug("workspace.realtime.connect.error", {
            authElapsedMs,
            elapsedMs: Math.max(0, Date.now() - connectStartedAt),
            initialSnapshotHandleMs,
            initialSnapshotWaitMs: Math.max(0, initialSnapshotWaitMs || (Date.now() - initialSnapshotWaitStartedAt)),
            meetingId: state.session.meetingId,
            reason: normalizeText(options.reason),
          });
          if (isRealtimePermissionError(initialSnapshotResult.error) && options.allowPermissionRetry !== false) {
            logDebug("workspace.refresh.permission-retry", {
              meetingId: state.session.meetingId,
              reason: options.reason,
            });
            // Keep the issued workspace token so the forced reconnect can sign
            // back into the same meeting instead of falling into an empty-auth error.
            disposeWorkspaceRealtime();
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
        logDebug("workspace.realtime.connect.success", {
          authElapsedMs,
          deferred: Boolean(initialSnapshotResult?.deferred),
          elapsedMs: Math.max(0, Date.now() - connectStartedAt),
          initialSnapshotHandleMs,
          initialSnapshotWaitMs,
          meetingId: state.session.meetingId,
          reason: normalizeText(options.reason),
        });
      
        return authPayload;
      }
      
      
      async function handleMeetingSnapshot(snapshot, options = {}) {
        const snapshotStartedAt = Date.now();
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
          termReplacements: ns.renderState.normalizeTermReplacements(meetingPayload?.termReplacements),
          title: normalizeText(meetingPayload?.title || refs.meetingTitleInput.value || state.session.title || "새 회의 룸"),
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
          elapsedMs: Math.max(0, Date.now() - snapshotStartedAt),
          exists: Boolean(snapshot?.exists),
          hydrateSelection: Boolean(options.hydrateSelection),
          meetingId: state.meeting.meetingId,
          reason: options.reason,
          resultCount: state.records.length,
        });
      }
      
      
      async function syncWorkspaceLocalState(hydrateSelection, reason) {
        const syncStartedAt = Date.now();
        const pendingSyncStartedAt = Date.now();
        await syncPendingUploadsWithRemote(reason);
        const pendingSyncMs = Math.max(0, Date.now() - pendingSyncStartedAt);
        const reconcileStartedAt = Date.now();
        await reconcileRemoteRecordSummaries(reason);
        const reconcileMs = Math.max(0, Date.now() - reconcileStartedAt);
        if (!state.selectedRecordId || hydrateSelection || !findHistoryEntry(state, state.selectedRecordId)) {
          state.selectedRecordId = chooseSelectedRecordId(state);
        }
        const detailHydrateStartedAt = Date.now();
        const detailHydrateDeferred = shouldDeferSelectedDetailHydration(reason);
        if (detailHydrateDeferred) {
          queueSelectedDetailHydration(Boolean(hydrateSelection), reason);
        } else {
          await runSelectedDetailHydration(Boolean(hydrateSelection), reason);
        }
        const detailHydrateMs = detailHydrateDeferred ? 0 : Math.max(0, Date.now() - detailHydrateStartedAt);
        persistWorkspaceSession();
        applyRender();
        logDebug("workspace.sync.state", {
          detailHydrateDeferred,
          detailHydrateMs,
          elapsedMs: Math.max(0, Date.now() - syncStartedAt),
          meetingId: state.meeting.meetingId,
          pendingLocalCount: state.pendingUploads.length,
          pendingSyncMs,
          reconcileMs,
          reason,
          resultCount: state.records.length,
          selectedRecordId: state.selectedRecordId,
        });
      }

      async function runSelectedDetailHydration(forceRefresh, reason) {
        const requestVersion = Number(state.selectedDetailHydrateVersion) + 1;
        state.selectedDetailHydrateVersion = requestVersion;
        state.selectedDetailHydrating = true;
        state.selectedDetailHydrateReason = normalizeText(reason);
        applyRender();
        try {
          await hydrateSelectedDetail(Boolean(forceRefresh), {
            reason,
            requestVersion,
          });
        } finally {
          if (Number(state.selectedDetailHydrateVersion) === requestVersion) {
            state.selectedDetailHydrating = false;
            state.selectedDetailHydrateReason = "";
            applyRender();
          }
        }
      }

      function queueSelectedDetailHydration(forceRefresh, reason) {
        logDebug("workspace.detail.hydrate.deferred", {
          forceRefresh: Boolean(forceRefresh),
          meetingId: state.meeting.meetingId,
          reason: normalizeText(reason),
          selectedRecordId: normalizeText(state.selectedRecordId),
        });
        void runSelectedDetailHydration(forceRefresh, reason).catch((error) => {
          handleRealtimeListenerError(normalizeRealtimeError(error), "detail-hydrate");
        });
      }

      function mergeLiveJobIntoRecords(job) {
        const normalizedJob = normalizeJob(job, state.meeting.title);
        const normalizedJobId = normalizeText(normalizedJob?.jobId);
        if (!normalizedJobId) {
          return;
        }
        const existingIndex = (Array.isArray(state.records) ? state.records : [])
          .findIndex((record) => normalizeText(record?.jobId) === normalizedJobId);
        if (existingIndex < 0) {
          return;
        }
        const nextRecord = normalizeRecord({
          ...state.records[existingIndex],
          artifactId: normalizedJob.artifactId,
          createdAt: normalizedJob.createdAt,
          durationMs: normalizedJob.durationMs,
          error: normalizedJob.error,
          jobId: normalizedJob.jobId,
          meetingId: state.meeting.meetingId,
          notesDegradedReason: normalizedJob.notesDegradedReason,
          notesGeneratedAt: normalizedJob.notesGeneratedAt,
          notesInputSnapshot: normalizedJob.notesInputSnapshot,
          notesStatus: normalizedJob.notesStatus,
          requestId: normalizedJob.requestId,
          resultTitle: normalizedJob.resultTitle,
          sharedMemoSnapshot: normalizedJob.sharedMemoSnapshot,
          status: normalizedJob.status,
          title: normalizedJob.title,
          updatedAt: normalizedJob.updatedAt,
          workspaceMutation: normalizedJob.workspaceMutation,
        });
        state.records = [
          ...state.records.slice(0, existingIndex),
          nextRecord,
          ...state.records.slice(existingIndex + 1),
        ];
      }

      function hasActiveWorkspaceMutation(mutation) {
        const status = normalizeText(mutation?.status);
        return ["queued", "processing"].includes(status);
      }
      
      
      async function hydrateSelectedDetail(forceRefresh, options = {}) {
        const entry = findHistoryEntry(state, state.selectedRecordId);
        if (!entry) {
          resetSelectedDetailState();
          return;
        }
        const requestVersion = Number(options.requestVersion) || 0;
        const requestedReason = normalizeText(options.reason);
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
      
        const snapshotMutationRequestId = normalizeText(entry.remote.workspaceMutation?.requestId);
        const pendingMutationJustCompleted = Boolean(
          snapshotMutationRequestId && state.pendingMutations?.[snapshotMutationRequestId]
        );
        const shouldRefreshRemoteSelection = Boolean(
          selectionChanged
          || normalizeText(state.realtime.jobDocId) !== normalizeText(entry.remote.jobId)
          || forceRefresh
          || !state.currentJob
          || pendingMutationJustCompleted
        );
        if (!shouldRefreshRemoteSelection) {
          ensureSelectedDetailPolling(entry);
          return;
        }

        disconnectJobListener();
        disconnectArtifactListener();
        state.currentArtifact = null;
        state.currentJob = normalizeJob({
          artifacts: entry.remote.artifactId
            ? [{ artifactId: entry.remote.artifactId }]
            : [],
          createdAt: entry.remote.createdAt,
          error: entry.remote.error,
          jobId: entry.remote.jobId,
          notesDegradedReason: entry.remote.notesDegradedReason,
          notesGeneratedAt: entry.remote.notesGeneratedAt,
          notesInputSnapshot: entry.remote.notesInputSnapshot,
          notesStatus: entry.remote.notesStatus,
          context: {
            sharedMemoSnapshot: entry.remote.sharedMemoSnapshot,
          },
          resultTitle: entry.remote.resultTitle,
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
        const skipJobRead = TERMINAL_REMOTE_STATUSES.has(normalizeText(entry.remote.status))
          && !hasActiveWorkspaceMutation(entry.remote.workspaceMutation)
          && !pendingMutationJustCompleted;
        await refreshSelectedRemoteDetail(entry, {
          expectedSelectionId: normalizeText(entry.id),
          forceArtifactRead: Boolean(selectionChanged || forceRefresh),
          requestVersion,
          skipJobRead,
          reason: requestedReason || (selectionChanged ? "selection" : forceRefresh ? "force-refresh" : "hydrate"),
        });
        restartSelectedDetailPolling(entry);
      }
      
      
      async function refreshSelectedRemoteDetail(entry, options = {}) {
        const detailStartedAt = Date.now();
        const jobId = normalizeText(entry?.remote?.jobId || state.currentJob?.jobId);
        const expectedSelectionId = normalizeText(options.expectedSelectionId || entry?.id);
        const requestVersion = Number(options.requestVersion) || 0;
        if (!jobId || typeof readDocument !== "function") {
          return;
        }
        state.realtime.jobDocId = jobId;
        const shouldReadJob = !options.skipJobRead;
        let jobReadMs = 0;
        if (shouldReadJob) {
          const jobReadStartedAt = Date.now();
          const jobSnapshot = await readDocument(FIRESTORE_COLLECTIONS.jobs, jobId);
          jobReadMs = Math.max(0, Date.now() - jobReadStartedAt);
          if (isSelectedDetailRequestStale(expectedSelectionId, requestVersion)) {
            return;
          }
          if (jobSnapshot?.exists && typeof jobSnapshot.data === "function") {
            state.currentJob = normalizeJob(jobSnapshot.data(), state.meeting.title);
            mergeLiveJobIntoRecords(jobSnapshot.data());
          }
        }
        const currentStatus = normalizeText(state.currentJob?.status || entry?.remote?.status);
        const canReadArtifact = TERMINAL_REMOTE_STATUSES.has(currentStatus);
        const artifactId = normalizeText(state.currentJob?.artifactId || entry?.remote?.artifactId);
        const shouldReadArtifact = Boolean(
          canReadArtifact
          && artifactId
          && (
            options.forceArtifactRead
            || normalizeText(state.currentArtifact?.artifactId) !== artifactId
            || !state.currentArtifact
          )
        );
        let artifactReadMs = 0;
        if (!artifactId || !canReadArtifact) {
          state.realtime.artifactDocId = "";
          state.currentArtifact = null;
        } else if (shouldReadArtifact && typeof readDocument === "function") {
          state.realtime.artifactDocId = artifactId;
          const artifactReadStartedAt = Date.now();
          const artifactSnapshot = await readDocument(FIRESTORE_COLLECTIONS.artifacts, artifactId);
          artifactReadMs = Math.max(0, Date.now() - artifactReadStartedAt);
          if (isSelectedDetailRequestStale(expectedSelectionId, requestVersion)) {
            return;
          }
          state.currentArtifact = artifactSnapshot?.exists && typeof artifactSnapshot.data === "function"
            ? normalizeArtifact(artifactSnapshot.data())
            : null;
          logDebug("workspace.detail.artifact-sync", {
            artifactId,
            exists: Boolean(artifactSnapshot?.exists),
            reason: normalizeText(options.reason),
            segmentCount: Array.isArray(state.currentArtifact?.segments) ? state.currentArtifact.segments.length : 0,
          });
        }
        if (isSelectedDetailRequestStale(expectedSelectionId, requestVersion)) {
          return;
        }
        syncSelectedRecordReviewState(findHistoryEntry(state, state.selectedRecordId));
        await resolvePendingMutationsFromSnapshots();
        applyRender();
        logDebug("workspace.detail.job-sync", {
          artifactId: canReadArtifact ? normalizeText(state.currentJob?.artifactId) : "",
          artifactReadMs,
          canReadArtifact,
          elapsedMs: Math.max(0, Date.now() - detailStartedAt),
          jobReadMs,
          jobId: normalizeText(state.currentJob?.jobId),
          jobReadSkipped: !shouldReadJob,
          reason: normalizeText(options.reason),
          status: currentStatus,
          updatedAt: normalizeText(state.currentJob?.updatedAt),
        });
      }

      function clearSelectedDetailPollTimer() {
        if (!selectedDetailPollTimer) {
          return;
        }
        global.clearTimeout(selectedDetailPollTimer);
        selectedDetailPollTimer = 0;
      }

      function stopSelectedDetailPolling() {
        clearSelectedDetailPollTimer();
        selectedDetailPollVersion += 1;
      }

      function shouldPollSelectedDetail(entry) {
        const jobId = normalizeText(entry?.remote?.jobId || state.currentJob?.jobId);
        if (!jobId || global.document.hidden) {
          return false;
        }
        const currentStatus = normalizeText(state.currentJob?.status || entry?.remote?.status);
        if (!TERMINAL_REMOTE_STATUSES.has(currentStatus)) {
          return true;
        }
        return Boolean(normalizeText(state.currentJob?.artifactId || entry?.remote?.artifactId)) && !state.currentArtifact;
      }

      function scheduleSelectedDetailPoll(generation, options = {}) {
        clearSelectedDetailPollTimer();
        if (generation !== selectedDetailPollVersion) {
          return;
        }
        const entry = findHistoryEntry(state, state.selectedRecordId);
        if (!shouldPollSelectedDetail(entry)) {
          return;
        }
        selectedDetailPollTimer = global.setTimeout(() => {
          selectedDetailPollTimer = 0;
          void runSelectedDetailPoll(generation);
        }, options.immediate ? 0 : SELECTED_DETAIL_POLL_INTERVAL_MS);
      }

      async function runSelectedDetailPoll(generation) {
        if (generation !== selectedDetailPollVersion || selectedDetailPollInFlight) {
          return;
        }
        const entry = findHistoryEntry(state, state.selectedRecordId);
        if (!shouldPollSelectedDetail(entry)) {
          return;
        }
        selectedDetailPollInFlight = true;
        try {
          await refreshSelectedRemoteDetail(entry, {
            forceArtifactRead: false,
            reason: "poll",
          });
        } catch (error) {
          const normalizedError = normalizeRealtimeError(error);
          handleRealtimeListenerError(normalizedError, "job-poll");
        } finally {
          selectedDetailPollInFlight = false;
          scheduleSelectedDetailPoll(generation);
        }
      }

      function restartSelectedDetailPolling(entry, options = {}) {
        stopSelectedDetailPolling();
        if (!shouldPollSelectedDetail(entry)) {
          return;
        }
        const generation = selectedDetailPollVersion + 1;
        selectedDetailPollVersion = generation;
        scheduleSelectedDetailPoll(generation, options);
      }

      function ensureSelectedDetailPolling(entry, options = {}) {
        if (!shouldPollSelectedDetail(entry)) {
          stopSelectedDetailPolling();
          return;
        }
        if (selectedDetailPollTimer || selectedDetailPollInFlight) {
          return;
        }
        if (selectedDetailPollVersion < 1) {
          restartSelectedDetailPolling(entry, options);
          return;
        }
        scheduleSelectedDetailPoll(selectedDetailPollVersion, options);
      }
      
      
      function resetSelectedDetailState() {
        disconnectJobListener();
        disconnectArtifactListener();
        state.currentArtifact = null;
        state.currentDetailSelectionId = "";
        state.currentJob = null;
        state.currentLocalRecord = null;
        state.selectedRecordMemo = createEmptySelectedRecordMemoState();
        state.selectedRecordNotesInputSnapshot = createEmptyNotesInputSnapshotState();
        state.sectionEdit = createEmptySectionEditState();
        state.termReplacementState = createEmptyTermReplacementState();
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
        stopSelectedDetailPolling();
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
        await runSelectedDetailHydration(false, "selection");
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
        if (state.blocked || state.loading) return;
        if (global.document.hidden) {
          stopSelectedDetailPolling();
          return;
        }
        restartSelectedDetailPolling(findHistoryEntry(state, state.selectedRecordId), { immediate: true });
        if (typeof state.realtime.unsubscribeMeeting === "function") return;
        void refreshWorkspace(false, "background");
      }

      function handleVisibilityChange() {
        if (global.document.hidden) {
          stopSelectedDetailPolling();
          logDebug("workspace.refresh.skipped", {
            reason: "document-hidden",
          });
          return;
        }
        handleBackgroundRefresh();
      }
      

      return {
        disposeRealtime: disposeWorkspaceRealtime,
        handleBackgroundRefresh,
        handleVisibilityChange,
        handleRecordListClick,
        hydrateSelectedDetail,
        refreshWorkspace,
        syncWorkspaceLocalState,
      };
    },
  };
})(globalThis);
