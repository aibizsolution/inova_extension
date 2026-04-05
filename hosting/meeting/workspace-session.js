(function initHostedMeetingWorkspaceSession(global) {
  const ns = global.__INOVA_HOSTED_MEETING__ = global.__INOVA_HOSTED_MEETING__ || {};

  const EXTENSION_BRIDGE_PAGE_SOURCE = "inova-meeting-workspace-page";
  const EXTENSION_BRIDGE_RESPONSE_SOURCE = "inova-meeting-workspace-extension";
  const AUTHORIZE_REQUEST_TYPE = "authorize-workspace-access";
  const AUTHORIZE_RESPONSE_TYPE = "authorize-workspace-access-result";
  const AUTHORIZE_TIMEOUT_MS = 12000;

  function createController(deps) {
    const shared = ns.shared;
    const render = ns.render;
    const state = deps?.state || {};
    const constants = deps?.constants || {};
    const helpers = deps?.helpers || {};
    const CONFIG = constants.CONFIG || {};
    const DEGRADED_NOTICE_CODES = constants.DEGRADED_NOTICE_CODES || {};
    const {
      buildRemoteSelectionId,
      buildWorkspaceSessionStorageKey,
      clearPersistedWorkspaceSession,
      isLocalWorkspaceOrigin,
      loadPersistedWorkspaceSession,
      logDebug,
      normalizeText,
      normalizeTextBlock,
      parseParams,
      persistWorkspaceSessionPayload,
      postJson,
      safeLocalStorageGet,
      SESSION_STORAGE_KEY,
    } = shared;
    const { findHistoryEntry } = render;

    function controller(name) {
      return typeof helpers.controller === "function" ? helpers.controller(name) : null;
    }

    const applyDegradedDiagnostics = (...args) => helpers.applyDegradedDiagnostics?.(...args);
    const createEmptyWorkspaceMutationState = (...args) => helpers.createEmptyWorkspaceMutationState?.(...args);
    const disposeWorkspaceRealtime = (...args) => controller("realtime")?.disposeRealtime?.(...args);
    const setDegradedNotice = (...args) => helpers.setDegradedNotice?.(...args);

    function hasSessionRestoreBlockingIssue(issueCodes) {
      const normalizedCodes = Array.isArray(issueCodes) ? issueCodes : [];
      return normalizedCodes.some((code) => ["storage-invalid-payload", "storage-parse-failed", "storage-read-failed"].includes(normalizeText(code)));
    }

    function hasSessionRestoreWarningIssue(issueCodes) {
      const normalizedCodes = Array.isArray(issueCodes) ? issueCodes : [];
      return normalizedCodes.some((code) => ["storage-invalid-payload", "storage-parse-failed", "storage-read-failed", "storage-write-failed"].includes(normalizeText(code)));
    }

    function buildBlockedOptionsFromReason(reason) {
      const normalizedReason = normalizeText(reason);
      if (normalizedReason === "legacy-link") {
        return {
          message: "이전 `launch/#ws` 링크는 더 이상 권한을 주지 않습니다. i-Nova 패널에서 다시 열거나 현재 공유 링크를 사용해 주세요.",
          title: "이전 링크는 더 이상 사용할 수 없습니다",
          tone: "warning",
        };
      }
      if (normalizedReason === "meeting-id-missing") {
        return {
          message: "회의 ID가 없는 주소로는 작업실을 열 수 없습니다. i-Nova 패널의 회의 허브에서 다시 열어 주세요.",
          title: "회의 ID가 없는 주소입니다",
        };
      }
      if (normalizedReason === "extension-required") {
        return {
          eyebrow: "확장 확인 필요",
          message: "회의 작업실은 i-Nova 확장프로그램과 통신해 접근 권한을 확인합니다. 확장을 설치하거나 새로고침한 뒤 다시 열어 주세요.",
          title: "확장프로그램 연결이 필요합니다",
          tone: "warning",
        };
      }
      if (normalizedReason === "login-required") {
        return {
          eyebrow: "로그인 필요",
          message: "i-Nova 로그인 상태를 확인하지 못해 작업실을 열 수 없습니다. i-Nova 사이트에 로그인한 뒤 다시 열어 주세요.",
          title: "i-Nova 로그인이 필요합니다",
          tone: "warning",
        };
      }
      if (normalizedReason === "identity-required") {
        return {
          eyebrow: "사용자 확인 필요",
          message: "확장프로그램이 현재 i-Nova 사용자 정보를 아직 확인하지 못했습니다. 로그인된 i-Nova 탭이나 패널을 한 번 연 뒤 다시 열어 주세요.",
          title: "i-Nova 사용자 정보를 확인해야 합니다",
          tone: "warning",
        };
      }
      if (normalizedReason === "owner-only") {
        return {
          eyebrow: "소유자 전용",
          message: "기본 작업실은 회의 소유자 본인만 열 수 있습니다. 공유가 필요하면 패널의 `공유` 버튼으로 읽기 전용 링크를 사용해 주세요.",
          title: "소유자만 편집 작업실을 열 수 있습니다",
          tone: "warning",
        };
      }
      if (normalizedReason === "share-revoked") {
        return {
          eyebrow: "공유 해제됨",
          message: "이 공유 링크는 이미 해제되었습니다. 소유자에게 새 공유 링크를 요청해 주세요.",
          title: "공유 링크가 해제되었습니다",
          tone: "warning",
        };
      }
      if (normalizedReason === "share-invalid") {
        return {
          eyebrow: "공유 링크 오류",
          message: "공유 링크가 올바르지 않거나 더 이상 유효하지 않습니다.",
          title: "공유 링크를 확인할 수 없습니다",
          tone: "warning",
        };
      }
      if (normalizedReason === "share-domain-mismatch") {
        return {
          eyebrow: "공유 범위 제한",
          message: "이 공유 링크는 회의 소유자와 같은 이메일 도메인으로 로그인한 i-Nova 사용자만 열 수 있습니다.",
          title: "같은 이메일 도메인에서만 공유 회의를 열 수 있습니다",
          tone: "warning",
        };
      }
      if (!state.sessionRestore.hasBlockingIssue) {
        return {
          message: "직접 주소를 붙여 넣어 열면 회의 작업 세션을 확인할 수 없습니다. i-Nova 패널의 회의 허브에서 다시 열어 주세요.",
        };
      }
      return {
        eyebrow: "세션 복원 실패",
        message: `${state.sessionRestore.degradedReason || "브라우저 저장소에서 회의 작업 세션을 다시 읽지 못했어요."} i-Nova 패널의 회의 허브에서 회의 화면을 다시 열어 새 세션을 받아 주세요.`,
        title: "저장된 회의 작업 세션을 다시 읽지 못했습니다",
        tone: "warning",
      };
    }

    function buildMissingSessionBlockedOptions() {
      return buildBlockedOptionsFromReason(state.auth?.reason || "");
    }

    function buildSessionRestoreDegradedNotice() {
      const reason = normalizeText(state.sessionRestore.degradedReason) || "브라우저 저장소에 회의 작업 세션을 다시 저장하거나 읽는 중 문제가 있었습니다.";
      return `${reason} 현재 화면은 계속 사용할 수 있지만, 다음 새로고침이나 재진입에서 세션 복원이 제한될 수 있습니다.`;
    }

    function buildSessionPersistDegradedNotice(reason) {
      const normalizedReason = normalizeText(reason) || "브라우저 저장소에 회의 작업 세션을 저장하지 못했어요.";
      return `${normalizedReason} 현재 탭에서는 작업을 계속할 수 있지만, 다음 새로고침이나 재진입에서는 최신 회의 상태가 복원되지 않을 수 있습니다.`;
    }

    function surfaceSessionRestoreNotice() {
      if (!state.sessionRestore.hasWarningIssue || !state.session.meetingId) {
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

    function restoreWorkspaceSession() {
      if (normalizeText(state.params.shareToken)) {
        state.sessionRestore = {
          degradedReason: "",
          hasBlockingIssue: false,
          hasWarningIssue: false,
          issueCodes: [],
          source: "share-link-bypassed",
        };
        logDebug("workspace.session.restore", {
          degradedReason: "",
          hasRestoredPayload: false,
          issueCodes: [],
          issueCount: 0,
          meetingId: state.params.meetingId,
          source: "share-link-bypassed",
          workspaceToken: Boolean(state.params.workspaceToken),
        });
        return;
      }
      const restored = loadPersistedWorkspaceSession(global, normalizeText(state.params.meetingId), "", state.params.jobId);
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
      if (!restored?.payload) return;
      const parsed = restored.payload;
      state.mode = normalizeText(parsed?.mode) === "detail" ? "detail" : "create";
      state.session = {
        accessMode: normalizeText(parsed?.accessMode),
        expiresAt: normalizeText(parsed?.expiresAt),
        meetingId: normalizeText(parsed?.meetingId),
        meetingSessionToken: normalizeText(parsed?.meetingSessionToken),
        mode: state.mode,
        sharedMemo: normalizeTextBlock(parsed?.sharedMemo),
        shareToken: normalizeText(parsed?.shareToken),
        title: normalizeText(parsed?.title),
      };
      state.meeting = {
        deletedAt: "",
        meetingId: state.session.meetingId,
        pendingLocalCount: 0,
        sharedMemo: state.session.sharedMemo,
        title: state.session.title,
        updatedAt: "",
        workspaceMutation: createEmptyWorkspaceMutationState(),
      };
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

    function maskEmail(email) {
      const normalized = normalizeText(email).toLowerCase();
      const [local, domain] = normalized.split("@");
      if (!local || !domain) return "";
      const nextLocal = local.length <= 2
        ? `${local.slice(0, 1)}*`
        : `${local.slice(0, 2)}***`;
      return `${nextLocal}@${domain}`;
    }

    function summarizeViewer(viewer) {
      const normalizedEmail = maskEmail(viewer?.email);
      if (normalizedEmail) return normalizedEmail;
      const providerUserKey = normalizeText(viewer?.providerUserKey);
      if (!providerUserKey) return "";
      return `${providerUserKey.slice(0, 6)}...`;
    }

    function applyAccessState(accessPayload) {
      const payload = accessPayload && typeof accessPayload === "object" ? accessPayload : {};
      const accessMode = normalizeText(payload.accessMode);
      const readOnly = Boolean(payload.readOnly);
      const meetingId = normalizeText(payload.meetingId || state.params.meetingId || state.session.meetingId);
      state.auth = {
        accessDecision: normalizeText(payload.accessDecision) || "denied",
        accessMode,
        bypassMode: normalizeText(payload.bypassMode),
        extensionBridge: normalizeText(payload.extensionBridge) || (isLocalWorkspaceOrigin(global) ? "bypass" : "connected"),
        inovaLogin: payload.inovaLogin !== false,
        readOnly,
        reason: normalizeText(payload.reason),
        viewer: summarizeViewer(payload.viewer),
      };
      if (state.auth.accessDecision !== "allowed") {
        return;
      }
      state.mode = normalizeText(state.params.jobId) ? "detail" : "create";
      const resolvedMeetingSessionToken = readOnly
        ? ""
        : normalizeText(payload.meetingSessionToken || state.session.meetingSessionToken);
      const resolvedExpiresAt = readOnly
        ? ""
        : normalizeText(payload.expiresAt || state.session.expiresAt);
      state.session = {
        accessMode,
        expiresAt: resolvedExpiresAt,
        meetingId,
        meetingSessionToken: resolvedMeetingSessionToken,
        mode: state.mode,
        sharedMemo: normalizeTextBlock(state.session.sharedMemo),
        shareToken: normalizeText(state.params.shareToken),
        title: normalizeText(state.session.title),
      };
      state.meeting.meetingId = meetingId;
      state.meeting.sharedMemo = normalizeTextBlock(state.session.sharedMemo);
      state.meeting.title = normalizeText(state.session.title);
      state.selectedRecordId = normalizeText(state.params.jobId)
        ? buildRemoteSelectionId(state.params.jobId)
        : normalizeText(state.selectedRecordId);
      ns.firebase?.setWorkspaceAccess?.(payload);
    }

    function buildAuthorizeInput() {
      return {
        debugAuthBypass: normalizeText(state.params.debugAuthBypass),
        jobId: normalizeText(state.params.jobId),
        meetingId: normalizeText(state.params.meetingId || state.session.meetingId),
        shareToken: normalizeText(state.params.shareToken),
      };
    }

    function isLocalBypassAllowed() {
      const bypassMode = normalizeText(state.params.debugAuthBypass);
      return Boolean(bypassMode) && isLocalWorkspaceOrigin(global);
    }

    async function authorizeViaBypass() {
      return postJson(global, CONFIG.authorizeWorkspaceAccessUrl, buildAuthorizeInput(), null, {
        timeoutMs: AUTHORIZE_TIMEOUT_MS,
      });
    }

    async function authorizeViaExtensionBridge() {
      const requestId = `auth-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      return new Promise((resolve, reject) => {
        const timeoutId = global.setTimeout(() => {
          cleanup();
          reject(new Error("확장 bridge 응답이 없어요."));
        }, AUTHORIZE_TIMEOUT_MS);

        const handleMessage = (event) => {
          if (event.origin !== global.location.origin) {
            return;
          }
          const data = event?.data && typeof event.data === "object" ? event.data : {};
          if (
            normalizeText(data.source) !== EXTENSION_BRIDGE_RESPONSE_SOURCE
            || normalizeText(data.type) !== AUTHORIZE_RESPONSE_TYPE
          ) {
            return;
          }
          const payload = data.payload && typeof data.payload === "object" ? data.payload : {};
          if (normalizeText(payload.requestId) !== requestId) {
            return;
          }
          cleanup();
          if (!payload.ok) {
            reject(new Error(normalizeText(payload.error) || "확장 bridge authorize에 실패했어요."));
            return;
          }
          resolve(payload.data && typeof payload.data === "object" ? payload.data : {});
        };

        const cleanup = () => {
          global.clearTimeout(timeoutId);
          global.removeEventListener("message", handleMessage);
        };

        global.addEventListener("message", handleMessage);
        global.postMessage(
          {
            payload: buildAuthorizeInput(),
            requestId,
            source: EXTENSION_BRIDGE_PAGE_SOURCE,
            type: AUTHORIZE_REQUEST_TYPE,
          },
          global.location.origin
        );
      });
    }

    function persistWorkspaceSession() {
      if (!state.session.meetingId) {
        return;
      }
      if (state.auth?.readOnly || normalizeText(state.auth?.accessMode) === "share-readonly") {
        replaceCleanUrl();
        return;
      }
      const entry = findHistoryEntry(state, state.selectedRecordId);
      const selectedJobId = normalizeText(entry?.remote?.jobId || entry?.pending?.jobId || state.params.jobId);
      const payload = {
        accessMode: normalizeText(state.auth.accessMode),
        bypassMode: normalizeText(state.auth.bypassMode),
        expiresAt: normalizeText(state.session.expiresAt),
        jobId: selectedJobId,
        meetingId: state.session.meetingId,
        meetingSessionToken: normalizeText(state.session.meetingSessionToken),
        mode: state.mode,
        readOnly: Boolean(state.auth.readOnly),
        sharedMemo: normalizeTextBlock(state.recordMemoDraft || state.recordMemoSaved || state.session.sharedMemo),
        shareToken: normalizeText(state.params.shareToken || state.session.shareToken),
        supersededRemoteJobIds: collectSupersededRemoteJobIds(),
        title: normalizeText(state.meeting.title || state.session.title),
        viewer: normalizeText(state.auth.viewer),
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

    function replaceCleanUrl() {
      const currentUrl = new URL(global.location.href);
      const preserveDebug = currentUrl.searchParams.get("debug") === "1";
      const nextUrl = new URL(global.location.href);
      nextUrl.search = "";
      nextUrl.hash = "";
      if (preserveDebug) nextUrl.searchParams.set("debug", "1");
      if (state.session.meetingId) nextUrl.searchParams.set("meetingId", state.session.meetingId);
      const entry = findHistoryEntry(state, state.selectedRecordId);
      const jobId = normalizeText(entry?.remote?.jobId || entry?.pending?.jobId || state.params.jobId);
      if (jobId) nextUrl.searchParams.set("jobId", jobId);
      const shareToken = normalizeText(state.params.shareToken || state.session.shareToken);
      if (shareToken) nextUrl.searchParams.set("share", shareToken);
      if (preserveDebug && isLocalWorkspaceOrigin(global) && normalizeText(state.auth.bypassMode)) {
        nextUrl.searchParams.set("debugAuthBypass", normalizeText(state.auth.bypassMode));
      }
      global.history.replaceState({}, "", nextUrl.toString());
      state.params = parseParams(nextUrl.toString());
    }

    async function bootSession() {
      restoreWorkspaceSession();

      if (state.params.launchToken || state.params.workspaceToken) {
        applyAccessState({
          accessDecision: "denied",
          accessMode: "blocked",
          extensionBridge: "not-requested",
          inovaLogin: false,
          reason: "legacy-link",
          viewer: {},
        });
        replaceCleanUrl();
        return state.session;
      }

      const meetingId = normalizeText(state.params.meetingId || state.session.meetingId);
      if (!meetingId) {
        applyAccessState({
          accessDecision: "denied",
          accessMode: "blocked",
          extensionBridge: "not-requested",
          inovaLogin: false,
          reason: "meeting-id-missing",
          viewer: {},
        });
        return state.session;
      }

      state.session.meetingId = meetingId;
      state.session.shareToken = normalizeText(state.params.shareToken);
      state.mode = normalizeText(state.params.jobId) ? "detail" : "create";
      state.session.mode = state.mode;

      try {
        const accessPayload = isLocalBypassAllowed()
          ? await authorizeViaBypass()
          : await authorizeViaExtensionBridge();
        applyAccessState(accessPayload);
      } catch (error) {
        const errorMessage = normalizeText(error instanceof Error ? error.message : String(error || ""));
        logDebug("workspace.session.authorize.error", {
          error,
          meetingId,
        });
        applyAccessState({
          accessDecision: "denied",
          accessMode: "blocked",
          extensionBridge: errorMessage.includes("bridge 응답이 없어요.") ? "failed" : "connected",
          inovaLogin: !errorMessage.includes("로그인"),
          reason: errorMessage.includes("사용자 키")
            ? "identity-required"
            : errorMessage.includes("로그인")
              ? "login-required"
              : "extension-required",
          viewer: {},
        });
      }

      if (state.auth.accessDecision === "allowed") {
        persistWorkspaceSession();
      }
      return state.session;
    }

    return {
      bootSession,
      buildMissingSessionBlockedOptions,
      clearSession: clearWorkspaceSession,
      persistSession: persistWorkspaceSession,
      replaceCleanUrl,
      restoreSession: restoreWorkspaceSession,
      surfaceSessionRestoreNotice,
    };
  }

  ns.workspaceSession = { createController };
})(globalThis);
