(function initHostedMeetingWorkspacePendingUploads(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};

  ns.workspacePendingUploads = {
    createController(deps) {
      const globalObject = deps?.global || global;
      const refs = deps?.refs || {};
      const state = deps?.state || {};
      const constants = deps?.constants || {};
      const helpers = deps?.helpers || {};
      const { buildLocalPendingJob, chooseSelectedRecordId, findHistoryEntry, findRemoteForPending, normalizeArtifact, normalizeJob, normalizeRecord } = ns.render;
      const { prepareAudioSourceChunks } = ns.audioChunker;
      const { blobToBase64, collapseSupersededPendingUploads, normalizePendingUpload, PENDING_UPLOAD_DEBUG_SCENARIOS } = ns.storage;
      const {
        AUTO_RETRY_PENDING_STATUSES,
        DEFAULT_CREATE_JOB_TIMEOUT_MS,
        DEFAULT_INLINE_AUDIO_LIMIT_BYTES,
        DEFAULT_SOURCE_CHUNK_DURATION_MS,
        DEFAULT_SOURCE_CHUNK_OVERLAP_MS,
        DEFAULT_SOURCE_MAX_DURATION_MS,
        DEFAULT_SOURCE_MAX_BYTES,
        DEFAULT_SOURCE_SINGLE_TRANSCRIBE_MAX_DURATION_MS,
        DEFAULT_SOURCE_TARGET_PART_BYTES,
        DEFAULT_SOURCE_UPLOAD_TIMEOUT_MS,
        buildLocalSelectionId,
        buildRemoteSelectionId,
        buildWorkspaceSessionStorageKey,
        formatDateTime,
        isDebugPanelEnabled,
        isOnline,
        logDebug,
        normalizeText,
        normalizeTextBlock,
        postJson,
        safeLocalStorageGet,
        SESSION_STORAGE_KEY,
      } = ns.shared;
      const DEGRADED_NOTICE_CODES = constants.DEGRADED_NOTICE_CODES || {};
      const DEGRADED_NOTICE_SPECS = constants.DEGRADED_NOTICE_SPECS || {};
      const PENDING_UPLOAD_QUEUE_OPERATION_SCOPES = constants.PENDING_UPLOAD_QUEUE_OPERATION_SCOPES || {};
      const SUPERSEDED_REMOTE_JOBS_STORAGE_KEY_PREFIX = constants.SUPERSEDED_REMOTE_JOBS_STORAGE_KEY_PREFIX || "";
      const MAX_SHARED_MEMO_CHARS = constants.MAX_SHARED_MEMO_CHARS || 0;
      const CONFIG = constants.CONFIG || {};
      const DEBUG_LOCAL_QUEUE_SANDBOX_PARAM = constants.DEBUG_LOCAL_QUEUE_SANDBOX_PARAM || "debugQueueSandbox";

      function controller(name) {
        return typeof helpers.controller === "function" ? helpers.controller(name) : null;
      }

      const setNotice = (...args) => helpers.setNotice?.(...args);
      const applyRender = (...args) => helpers.applyRender?.(...args);
      const renderBlocked = (...args) => helpers.renderBlocked?.(...args);
      const requestConfirmation = (...args) => helpers.requestConfirmation?.(...args);
      const createEmptyWorkspaceMutationState = (...args) => helpers.createEmptyWorkspaceMutationState?.(...args);
      const setDegradedNotice = (...args) => helpers.setDegradedNotice?.(...args);
      const clearDegradedNotice = (...args) => helpers.clearDegradedNotice?.(...args);
      const applyDegradedDiagnostics = (...args) => helpers.applyDegradedDiagnostics?.(...args);
      const getWorkspaceTitleOrFallback = (...args) => helpers.getWorkspaceTitleOrFallback?.(...args);
      const persistWorkspaceSession = (...args) => controller("session")?.persistSession?.(...args);
      const clearWorkspaceSession = (...args) => controller("session")?.clearSession?.(...args);
      const inferAudioExtension = (...args) => controller("capture")?.inferAudioExtension?.(...args);
      const refreshWorkspace = (...args) => controller("realtime")?.refreshWorkspace?.(...args);
      const syncWorkspaceLocalState = (...args) => controller("realtime")?.syncWorkspaceLocalState?.(...args);
      const saveRecordTitleForEntry = (...args) => controller("mutations")?.saveRecordTitleForEntry?.(...args);

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

      function shouldBypassPendingUploadQueue() {
        return Boolean(state.auth?.readOnly) || normalizeText(state.auth?.accessMode) === "share-readonly";
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
          deletedAt: "",
          meetingId,
          pendingLocalCount: 0,
          sharedMemo: "",
          title: state.session.title,
          updatedAt: "",
          workspaceMutation: createEmptyWorkspaceMutationState(),
        };
        state.selectedRecordId = "";
        logDebug("workspace.debug.local-queue-sandbox", {
          meetingId,
          requested: true,
        });
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
          return `${normalizedReason || "브라우저에 남아 있던 로컬 업로드 대기 기록을 완전하게 읽지 못했어요."} 회의 화면은 계속 열리지만, 일부 임시 녹음이나 업로드 대기 상태는 이번 진입에서 빠져 있을 수 있습니다.`;
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
        if (["chunk-resync-succeeded", "chunk-resync-update", "chunk-resync-reset"].includes(normalizedContext.phase)) {
          return `${normalizedReason || "chunk 후속 원격 상태 재확인 결과를 브라우저 로컬 큐에 반영하지 못했어요."} 다음 새로고침 뒤에는 방금 다시 확인한 원격 처리 상태가 잠시 이전 값으로 보일 수 있습니다.`;
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
          return `${normalizedReason || "회의에 남은 로컬 원본을 정리하지 못했어요."} 회의 삭제 후에도 일부 브라우저 원본이 다음 새로고침 뒤 다시 보일 수 있습니다.`;
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
        const isRemoteSyncPersistPhase = ["remote-sync-succeeded", "remote-sync-update", "remote-sync-reset"].includes(normalizedContext.phase);
        const isChunkResyncPersistPhase = ["chunk-resync-succeeded", "chunk-resync-update", "chunk-resync-reset"].includes(normalizedContext.phase);
        if (isRemoteSyncPersistPhase) {
          applyDegradedDiagnostics("pendingUploadRemoteSyncPersist", result, {
            buildNotice: (degradedReason) => buildPendingUploadPersistPhaseDegradedNotice(normalizedContext, degradedReason),
            degradedEvent: "workspace.pending-uploads.remote-sync.persist.degraded",
            getLogDetails: (normalized) => ({
              operation: normalized.operation,
              ...normalizedContext,
            }),
            noticeCode: DEGRADED_NOTICE_CODES.pendingUploadRemoteSyncPersist,
            recoveredEvent: "workspace.pending-uploads.remote-sync.persist.recovered",
          });
          return;
        }
        if (isChunkResyncPersistPhase) {
          applyDegradedDiagnostics("pendingUploadChunkResyncPersist", result, {
            buildNotice: (degradedReason) => buildPendingUploadPersistPhaseDegradedNotice(normalizedContext, degradedReason),
            degradedEvent: "workspace.pending-uploads.chunk-resync.persist.degraded",
            getLogDetails: (normalized) => ({
              operation: normalized.operation,
              ...normalizedContext,
            }),
            noticeCode: DEGRADED_NOTICE_CODES.pendingUploadChunkResyncPersist,
            recoveredEvent: "workspace.pending-uploads.chunk-resync.persist.recovered",
          });
          return;
        }
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
            chunkResyncPersist: cloneDegradedDiagnosticsSnapshot(state.pendingUploadChunkResyncPersist),
            load: cloneDegradedDiagnosticsSnapshot(state.pendingUploadStorage),
            persist: cloneDegradedDiagnosticsSnapshot(state.pendingUploadPersist),
            remoteSyncPersist: cloneDegradedDiagnosticsSnapshot(state.pendingUploadRemoteSyncPersist),
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
              label: "회의 화면이 blocked로 끝나지 않음",
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
        if (shouldBypassPendingUploadQueue()) {
          applyLoadedPendingUploads([]);
          logDebug("workspace.pending-uploads.load.skipped", {
            accessMode: normalizeText(state.auth?.accessMode),
            meetingId: state.session.meetingId,
            reason: "read-only-share",
          });
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
            outcome: "active",
            resolution: "reconciled",
            resyncCacheAction: "",
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
            outcome: "succeeded",
            resolution: "reconcile-completed",
            resyncCacheAction: "clear",
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
            outcome: "failed",
            resolution: "reconcile-remote-failed",
            resyncCacheAction: "reset-parts",
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
        const normalizedRequestId = normalizeText(pending?.requestId);
        const shouldCleanupPending = normalizeText(transition?.outcome) === "succeeded";
        const nextPending = shouldCleanupPending
          ? normalizePendingUpload(transition.nextPending)
          : await upsertPendingUpload(transition.nextPending, {
            context: options?.queueContext,
          });
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
        if (shouldCleanupPending) {
          await removePendingUploadQueueEntry(normalizedRequestId, {
            context: options?.queueContext,
            nextSelectedRecordId: options?.applySelectedRecordTransition ? transition.nextSelectedRecordId : "",
            persistSession: false,
          });
          persistWorkspaceSession();
        }
        return nextPending;
      }
      
      
      async function commitPendingUploadRemoteSnapshotTransition(pending, transition) {
        if (!transition?.nextPending) {
          return null;
        }
        const normalizedRequestId = normalizeText(pending?.requestId);
        const queueContext = {
          phase: transition.outcome === "succeeded"
            ? "remote-sync-succeeded"
            : transition.outcome === "failed"
              ? "remote-sync-reset"
              : "remote-sync-update",
          previousRequestId: pending.requestId,
          reason: "remote-sync",
          requestId: transition.nextPending.requestId,
          shouldResetSource: transition.resetChunkCache === "reset-parts",
        };
        const shouldCleanupPending = normalizeText(transition?.outcome) === "succeeded";
        const nextPending = shouldCleanupPending
          ? normalizePendingUpload(transition.nextPending)
          : await upsertPendingUpload(transition.nextPending, {
            preserveUpdatedAt: true,
            context: queueContext,
          });
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
        if (shouldCleanupPending) {
          await removePendingUploadQueueEntry(normalizedRequestId, {
            context: queueContext,
            nextSelectedRecordId: transition.nextSelectedRecordId,
            persistSession: false,
          });
          persistWorkspaceSession();
        }
        return nextPending;
      }
      
      
      async function commitChunkedPendingUploadRemoteResyncTransition(pending, transition) {
        if (!transition?.nextPending) {
          return null;
        }
        const phase = transition.outcome === "succeeded"
          ? "chunk-resync-succeeded"
          : transition.outcome === "failed"
            ? "chunk-resync-reset"
            : "chunk-resync-update";
        const normalizedRequestId = normalizeText(pending?.requestId);
        const queueContext = {
          phase,
          previousRequestId: pending.requestId,
          reason: "chunk-resync",
          requestId: transition.nextPending.requestId,
          shouldResetSource: transition.resyncCacheAction === "reset-parts",
        };
        const shouldCleanupPending = normalizeText(transition?.outcome) === "succeeded";
        const nextPending = shouldCleanupPending
          ? normalizePendingUpload(transition.nextPending)
          : await upsertPendingUpload(transition.nextPending, {
            context: queueContext,
          });
        if (!normalizedRequestId) {
          return nextPending;
        }
        if (transition.resyncCacheAction === "clear") {
          delete state.runtimeChunkCache[normalizedRequestId];
        } else if (transition.resyncCacheAction === "reset-parts" && state.runtimeChunkCache[normalizedRequestId]) {
          state.runtimeChunkCache[normalizedRequestId] = {
            ...state.runtimeChunkCache[normalizedRequestId],
            parts: (state.runtimeChunkCache[normalizedRequestId].parts || []).map((part) => ({
              ...part,
              storageObject: "",
              uploadStatus: "",
            })),
          };
        }
        if (shouldCleanupPending) {
          await removePendingUploadQueueEntry(normalizedRequestId, {
            context: queueContext,
            persistSession: false,
          });
          persistWorkspaceSession();
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
          options: { redaction: "none", summary: true },
          source,
          context: { sharedMemoSnapshot: item.sharedMemoSnapshot },
        };
      }
      
      
      function buildLatestPendingUploadSnapshot(item) {
        const normalizedRequestId = normalizeText(item?.requestId);
        const currentPending = normalizedRequestId
          ? state.pendingUploads.find((entry) => normalizeText(entry?.requestId) === normalizedRequestId)
          : null;
        const latestPending = normalizePendingUpload({
          ...(item || {}),
          ...(currentPending || {}),
          blob: currentPending?.blob instanceof global.Blob
            ? currentPending.blob
            : item?.blob instanceof global.Blob
              ? item.blob
              : null,
        });
        if (normalizeText(latestPending?.sourceMode) !== "chunked") {
          return latestPending;
        }
        const runtimeChunk = normalizedRequestId ? state.runtimeChunkCache[normalizedRequestId] : null;
        const pendingParts = Array.isArray(latestPending?.parts) ? latestPending.parts : [];
        const cachedParts = Array.isArray(runtimeChunk?.parts) ? runtimeChunk.parts : [];
        const indexedParts = new Map();
        for (const part of [...cachedParts, ...pendingParts]) {
          const normalizedPart = part && typeof part === "object" ? part : {};
          const partIndex = Math.max(0, Number(normalizedPart.index) || 0);
          const previous = indexedParts.get(partIndex) || {};
          const storageObject = normalizeText(normalizedPart.storageObject) || normalizeText(previous.storageObject);
          indexedParts.set(partIndex, {
            ...previous,
            ...normalizedPart,
            index: partIndex,
            requestId: normalizeText(normalizedPart.requestId) || normalizeText(previous.requestId),
            sizeBytes: Math.max(0, Number(normalizedPart.sizeBytes) || Number(previous.sizeBytes) || 0),
            storageObject,
            uploadStatus: normalizeText(normalizedPart.uploadStatus)
              || normalizeText(previous.uploadStatus)
              || (storageObject ? "uploaded" : ""),
          });
        }
        const mergedParts = Array.from(indexedParts.values())
          .sort((left, right) => left.index - right.index)
          .map((part) => ({
            ...part,
            endMs: Math.max(0, Number(part.endMs) || 0),
            overlapMs: Math.max(0, Number(part.overlapMs) || 0),
            startMs: Math.max(0, Number(part.startMs) || 0),
          }));
        return normalizePendingUpload({
          ...latestPending,
          parts: mergedParts,
          preparedPartCount: Math.max(
            mergedParts.length,
            Number(latestPending?.preparedPartCount) || 0,
            Number(runtimeChunk?.parts?.length) || 0
          ),
          uploadedPartCount: mergedParts.filter((part) => normalizeText(part.storageObject)).length,
        });
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
          options: { redaction: "none", summary: true },
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
        const latestItem = buildLatestPendingUploadSnapshot(item);
        const transitionAction = normalizeText(options?.transitionAction);
        if (transitionAction !== "single-start") {
          throw new Error("single source 원격 시작 action이 없어 업로드 결과를 안전하게 확정할 수 없어요.");
        }
        if (normalizeText(latestItem?.sourceMode) === "chunked") {
          throw new Error("chunked source는 single 원격 시작 경로로 보낼 수 없어요.");
        }
        const createdJob = await requestPendingUploadRemoteMutationState(latestItem, {
          allowInlineSource: Boolean(options?.allowInlineSource),
          inlineSourceError: normalizeText(options?.inlineSourceError),
        });
        const result = await commitSinglePendingUploadRemoteStart(latestItem, createdJob, options);
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
        const latestItem = buildLatestPendingUploadSnapshot(item);
        const transitionAction = normalizeText(options?.transitionAction);
        if (transitionAction !== "chunk-start") {
          throw new Error("chunk source 원격 시작 action이 없어 업로드 결과를 안전하게 확정할 수 없어요.");
        }
        if (normalizeText(latestItem?.sourceMode) !== "chunked") {
          throw new Error("chunk 원격 시작은 chunked source에서만 실행할 수 있어요.");
        }
        if (Math.max(0, Number(latestItem?.uploadedPartCount) || 0) < 1) {
          throw new Error("올라간 청크 없이 원격 chunk 작업을 시작할 수 없어요.");
        }
        const createdJob = await requestPendingUploadRemoteMutationState(latestItem);
        const result = await commitChunkedPendingUploadRemoteStart(latestItem, createdJob, options);
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
        const latestItem = buildLatestPendingUploadSnapshot(item);
        const transitionAction = normalizeText(options?.transitionAction);
        if (transitionAction !== "chunk-publish") {
          throw new Error("원격 chunk publish action이 없어 추가 청크 반영 결과를 안전하게 확정할 수 없어요.");
        }
        if (!normalizeText(latestItem?.jobId)) {
          throw new Error("기존 원격 작업 없이 추가 청크 publish를 이어갈 수 없어요.");
        }
        const queueContext = normalizePendingUploadQueueContext({
          requestId: latestItem?.requestId,
          ...(options?.context || {}),
        });
        const remoteJob = await requestPendingUploadRemoteMutationState(latestItem);
        const allChunksUploaded = Math.max(0, Number(latestItem?.uploadedPartCount) || 0) >= Math.max(0, Number(latestItem?.preparedPartCount) || 0);
        const transition = buildPendingUploadRemotePublishTransition(latestItem, remoteJob, {
          action: transitionAction,
          awaitingMoreUploads: !allChunksUploaded,
        });
        if (!transition?.nextPending) {
          const transitionErrorMessage = normalizeText(transition?.errorMessage) || "원격 작업 상태를 확인하지 못해 추가 청크 반영을 이어갈 수 없어요.";
          logDebug("workspace.pending-upload.chunk-publish.invalid-status", {
            action: transitionAction,
            error: transitionErrorMessage,
            jobId: normalizeText(remoteJob?.jobId || latestItem?.jobId),
            remoteStatus: normalizeText(transition?.remoteStatus),
            requestId: normalizeText(latestItem?.requestId),
          });
          throw new Error(transitionErrorMessage);
        }
        const nextPending = await commitPendingUploadRemoteMutationTransition(latestItem, transition, {
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
        const latestItem = buildLatestPendingUploadSnapshot(item);
        const transitionAction = normalizeText(options?.transitionAction);
        if (transitionAction !== "chunk-resync") {
          throw new Error("원격 chunk resync action이 없어 브라우저 보관 상태를 안전하게 유지할 수 없어요.");
        }
        let remoteState = null;
        try {
          remoteState = await requestChunkedPendingUploadRemoteReconcileState(latestItem);
        } catch (error) {
          const degradedMessage = error instanceof Error
            ? `${error.message} 브라우저 보관 상태는 그대로 두고 다음 동기화에서 원격 상태를 다시 확인합니다.`
            : "원격 작업 상태를 다시 확인하지 못해 브라우저 보관 상태를 그대로 유지합니다.";
          logDebug("workspace.pending-upload.chunk-resync.degraded", {
            action: transitionAction,
            error,
            jobId: normalizeText(latestItem?.jobId),
            requestId: normalizeText(latestItem?.requestId),
          });
          setNotice(degradedMessage, "warning");
          applyRender();
          return { degraded: true, pending: latestItem, remoteState: null, resolution: "" };
        }
        const allChunksUploaded = Math.max(0, Number(latestItem?.uploadedPartCount) || 0) >= Math.max(0, Number(latestItem?.preparedPartCount) || 0);
        const transition = buildChunkedPendingUploadRemoteResyncTransition(latestItem, remoteState, {
          awaitingMoreUploads: !allChunksUploaded,
        });
        if (!transition?.nextPending) {
          const transitionErrorMessage = normalizeText(transition?.errorMessage) || "원격 작업 상태를 다시 확인하지 못해 브라우저 보관 상태를 그대로 유지합니다.";
          logDebug("workspace.pending-upload.chunk-resync.degraded", {
            action: transitionAction,
            error: transitionErrorMessage,
            jobId: normalizeText(remoteState?.jobId || latestItem?.jobId),
            remoteStatus: normalizeText(transition?.remoteStatus),
            requestId: normalizeText(latestItem?.requestId),
          });
          setNotice(transitionErrorMessage, "warning");
          applyRender();
          return { degraded: true, pending: latestItem, remoteState, resolution: "" };
        }
        const nextPending = await commitChunkedPendingUploadRemoteResyncTransition(latestItem, transition);
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
      
      
      async function removePendingUploadQueueEntry(requestId, options = {}) {
        const normalizedRequestId = normalizeText(requestId);
        if (!normalizedRequestId) {
          return;
        }
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
        if (state.selectedRecordId === ns.shared.buildLocalSelectionId(normalizedRequestId)) {
          state.selectedRecordId = normalizeText(options?.nextSelectedRecordId) || chooseSelectedRecordId(state);
        }
        state.meeting.pendingLocalCount = state.pendingUploads.length;
        if (options?.persistSession !== false) {
          persistWorkspaceSession();
        }
      }


      async function deletePendingUpload(requestId, options = {}) {
        await removePendingUploadQueueEntry(requestId, options);
        setNotice("브라우저에 보관하던 녹음을 삭제했습니다.", "highlight");
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

      return {
        activateDebugLocalQueueSandbox,
        attemptPendingUpload,
        buildPendingUploadQueueStateSnapshot,
        clearDebugLocalQueueSandboxPendingUploads,
        collectSupersededRemoteJobIds,
        createOrUpdatePendingUpload: upsertPendingUpload,
        deletePendingUpload,
        handleLocalQueueAction,
        inferSourceMode,
        isDebugLocalQueueSandboxRequested,
        loadPendingUploads,
        loadSupersededRemoteJobIds,
        retryPendingUploads,
        runDebugLocalQueueSandboxAction,
        seedDebugLocalQueueSandboxPendingUpload,
        showPendingUploadQueueOperationError,
        syncPendingUploadsWithRemote,
        validatePendingUploadQueueScenario,
      };
    },
  };
})(globalThis);
